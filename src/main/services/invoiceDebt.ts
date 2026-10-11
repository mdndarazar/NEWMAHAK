import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import {
  allocateOverpay,
  debtAdjustmentsOf,
  remainingOf,
  refundFromReceivedOf,
  type DebtAdjustments,
  type RemainingResult
} from '@shared/settlement'
import { toNumberRial } from '@shared/money'

/**
 * ===========================================================================
 * نشست ۵۸ — خوشه C / C2 + C3: لایه‌ی دیتابیسیِ «بدهی واحد».
 *
 * هر مسیری که «باقی‌مانده/تسویه/اضافه‌دریافت» می‌خواهد (addPayment، creditList،
 * payments، chequeList، recalcSettlement، گزارش فروش، صورت‌های حسابداری) از همین
 * دو تابع می‌خواند و فرمول را فقط از `remainingOf` در `@shared/settlement` می‌گیرد.
 * ===========================================================================
 */

type Client = Prisma.TransactionClient | typeof prisma

const EMPTY: DebtAdjustments = { returnedValue: 0, refundFromReceived: 0 }

/**
 * اثر برگشت‌های ساده (با بازپرداخت) روی بدهی، برای یک دسته فاکتور.
 * نشست ۱۶۲ · Y20 (S162-D4) — `asOf` اختیاری: فقط برگشت‌هایی که تا آن لحظه (returnedAt ≤ asOf) ثبت
 * شده‌اند؛ برای «بدهی در پایان بازه‌ی گذشته». بدون `asOf` رفتار قبلی (همه‌ی برگشت‌های فعال).
 */
export async function debtAdjustmentsByInvoice(client: Client, ids: number[], asOf: Date | null = null): Promise<Map<number, DebtAdjustments>> {
  const out = new Map<number, DebtAdjustments>()
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x) && x > 0))]
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500)
    const rets = await (client as any).saleReturn.findMany({
      // نشست ۶۴ · بند ۴-۲۲ — برگشت باطل‌شده بدهی را کم نمی‌کند
      where: { invoiceId: { in: chunk }, voidedAt: null, ...(asOf ? { returnedAt: { lte: asOf } } : {}) },
      select: { id: true, invoiceId: true, kind: true, total: true, refundMethod: true, refundAmount: true, exchangeDiff: true, debtReduction: true }
    })
    if (!rets.length) continue
    /**
     * اثر «اصلاح جبرانی» با سند برگشت یکی نیست: منبعِ اولیه برای گزارشِ همان
     * صبح می‌ماند، اما از لحظه‌ی اصلاح به بعد نباید دوباره بدهی را کم کند. `asOf`
     * این تفکیک را برای گزارش تاریخی حفظ می‌کند (اصلاح فردا، گذشته را بازنویسی
     * نمی‌کند). جدول جدید یک ردیف نهایی به‌ازای هر برگشت دارد.
     */
    const corrected = new Set<number>(
      (
        await (client as any).returnCorrection.findMany({
          where: {
            returnId: { in: rets.map((r: any) => r.id) },
            status: 'POSTED',
            ...(asOf ? { createdAt: { lte: asOf } } : {})
          },
          select: { returnId: true }
        })
      ).map((row: any) => Number(row.returnId))
    )
    const activeRets = rets.filter((r: any) => !corrected.has(Number(r.id)))
    if (!activeRets.length) continue
    // کارت‌به‌کارتِ لغوشده: پولی به مشتری نرسید ⇒ بازپرداخت حساب نمی‌شود
    /**
     * نشست ۱۷۴ (بند ۳ نقطه‌ی شروع ۱۷۳) — c2cIds بی‌سقف بود: یک دسته‌ی ۵۰۰ فاکتور با چند برگشت
     * کارت‌به‌کارت روی هر فاکتور ⇒ ۵۰۱+ شناسه در `returnId in` (عبور از سقف IN گزارش‌ها). حالا
     * همان دسته‌ی ۵۰۰تایی؛ Set «لغوشده» از همه‌ی دسته‌ها جمع می‌شود و منطق بدهی دست نمی‌خورد.
     */
    const c2cIds: number[] = activeRets.filter((r: any) => r.refundMethod === 'CARD_TO_CARD').map((r: any) => r.id)
    const canceled = new Set<number>()
    for (let j = 0; j < c2cIds.length; j += 500) {
      const reqs = await (client as any).cardTransferRequest.findMany({
        where: { returnId: { in: c2cIds.slice(j, j + 500) }, status: 'CANCELED' },
        select: { returnId: true }
      })
      for (const q of reqs) canceled.add(q.returnId)
    }
    const byInv = new Map<number, any[]>()
    for (const r of activeRets) {
      const list = byInv.get(r.invoiceId) ?? []
      list.push({ ...r, refundCanceled: canceled.has(r.id) })
      byInv.set(r.invoiceId, list)
    }
    for (const [id, list] of byInv) out.set(id, debtAdjustmentsOf(list))

    /**
     * نشست ۱۹۹ — برگشت کالای جایگزین روی سند تعویض (روش NONE / بدون نقد)
     * بدهی فاکتور مادر را کم می‌کند. وگرنه نسیه ۱۰۰۰ → تعویض ۶۰۰ با ۲۰۰
     * (مانده ۶۰۰) → برگشت همان ۲۰۰ ⇒ مشتری کالای ۴۰۰ دارد ولی مانده ۶۰۰
     * و پل −۲۰۰ باز می‌ماند. بازپرداخت نقدی/اعتباری همان برگشت اینجا دوباره
     * از بدهی مادر کم نمی‌شود.
     */
    const children = await (client as any).saleInvoice.findMany({
      where: { sourceInvoiceId: { in: chunk }, voidedAt: null, orderType: 'EXCHANGE' },
      select: { id: true, sourceInvoiceId: true }
    })
    if (!children.length) continue
    const childIds = children.map((c: { id: number }) => c.id)
    const sourceOf = new Map<number, number>(
      children.map((c: { id: number; sourceInvoiceId: number | null }) => [c.id, Number(c.sourceInvoiceId)])
    )
    const childRets = await (client as any).saleReturn.findMany({
      where: {
        invoiceId: { in: childIds },
        kind: 'RETURN',
        voidedAt: null,
        ...(asOf ? { returnedAt: { lte: asOf } } : {})
      },
      select: { invoiceId: true, kind: true, total: true, refundMethod: true, refundAmount: true }
    })
    for (const r of childRets) {
      if (refundFromReceivedOf(r) > 0) continue
      const srcId = sourceOf.get(r.invoiceId)
      if (srcId == null || !Number.isFinite(srcId)) continue
      const prev = out.get(srcId) ?? { returnedValue: 0, refundFromReceived: 0 }
      prev.returnedValue += Math.max(0, toNumberRial(r.total))
      out.set(srcId, prev)
    }
  }
  return out
}

export function adjustmentsOrEmpty(map: Map<number, DebtAdjustments>, id: number): DebtAdjustments {
  return map.get(id) ?? EMPTY
}

/** بدهی یک فاکتور با فرمول واحد. */
export async function invoiceRemaining(
  client: Client,
  invoiceId: number,
  grandTotal: number,
  received: number
): Promise<RemainingResult> {
  const adj = adjustmentsOrEmpty(await debtAdjustmentsByInvoice(client, [invoiceId]), invoiceId)
  return remainingOf({ grandTotal, received, ...adj })
}

const isReceived = (p: { kind?: string | null; chequeStatus?: string | null }) =>
  (p.kind ?? 'CASH') !== 'CHEQUE' || p.chequeStatus === 'CLEARED'

/**
 * C3 — `recalcPaymentOverpay` واحد: بعد از ثبت/ویرایش/حذف پرداخت، پاس/برگشت چک،
 * و ثبت/ویرایش/حذف برگشت صدا زده می‌شود. اضافه‌دریافت هر ردیف از وضعیت *فعلی*
 * فاکتور بازسازی می‌شود، پس ویرایش ۲۵۰ ⇒ ۵۰ دیگر ۱۵۰ اضافه‌ی کاذب جا نمی‌گذارد.
 * خروجی: فهرست تغییرها (برای Audit).
 */
export async function recalcPaymentOverpay(
  client: Client,
  invoiceId: number,
  info: { payable: number; refundFromReceived: number }
): Promise<{ total: number; changes: { id: number; before: number; after: number }[] }> {
  const rows = await (client as any).payment.findMany({
    where: { invoiceId, voidedAt: null },
    select: { id: true, amount: true, kind: true, chequeStatus: true, overpayAmount: true, seq: true },
    orderBy: [{ seq: 'asc' }, { id: 'asc' }]
  })
  const alloc = allocateOverpay(
    // نشست ۱۸۱: `p` عمداً `any` است، پس typecheck این را نگرفت؛ هارنس وفادار گرفت.
    rows.map((p: any) => ({ id: p.id, amount: toNumberRial(p.amount ?? 0), received: isReceived(p) })),
    info
  )
  const changes: { id: number; before: number; after: number }[] = []
  let total = 0
  for (const p of rows) {
    const next = alloc.get(p.id) ?? 0
    total += next
    // نشست ۱۸۱: علاوه بر استثنای زمان اجرا، `prev !== next` بین bigint و number
    // همیشه true می‌شد ⇒ هر بار یک UPDATE بی‌مورد روی همان مقدار.
    const prev = Math.max(0, toNumberRial(p.overpayAmount ?? 0))
    if (prev !== next) {
      await (client as any).payment.update({ where: { id: p.id }, data: { overpayAmount: next } })
      changes.push({ id: p.id, before: prev, after: next })
    }
  }
  return { total, changes }
}
