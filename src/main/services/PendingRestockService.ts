import { prisma } from '../db/client'
import { toJalaliDate, faDigits } from '@shared/jalali'
import { AuditAction, CardTransferKind, CardTransferStatus } from '@shared/enums'
import {
  ageInDays,
  EMPTY_PENDING_RESTOCK,
  itemNeedsRestock,
  pendingQtyOfItems,
  releasedStockNote,
  type PendingRestockItem,
  type PendingRestockSummary
} from '@shared/pendingRestock'
import { inventoryService } from './InventoryService'
import { stockAllocationService } from './StockAllocationService'
import { toNumberRial } from '@shared/money'

const PENDING_RESTOCK_READ_PAGE = 2000
const PENDING_RESTOCK_IN_CHUNK = 500

async function readAll<T>(
  readPage: (page: { skip: number; take: number }) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = []
  let skip = 0
  while (true) {
    const page = await readPage({ skip, take: PENDING_RESTOCK_READ_PAGE })
    rows.push(...page)
    if (page.length < PENDING_RESTOCK_READ_PAGE) return rows
    skip += page.length
  }
}

function chunksOf<T>(values: T[], size = PENDING_RESTOCK_IN_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

/**
 * ===========================================================================
 * جلسه ۴۰ · کار ب — «کالای برگشتیِ در انتظار تأیید مدیر»: لایه‌ی main.
 *
 * دو کار، و فقط همین دو کار:
 *   ۱) `summary` — یک تابع مشترک که **هر پنج صفحه** از همان استفاده می‌کند
 *      (انبار فروشگاه، گزارشات فروش، انبارگردانی، بستن صندوق، پنل کارت‌به‌کارت).
 *      هیچ صفحه‌ای اجازه ندارد این عدد را خودش بسازد.
 *   ۲) `releaseReturnStock` — تنها نقطه‌ای در کل برنامه که کالای معلق را به
 *      موجودی قابل‌فروش برمی‌گرداند. `CardTransferService.pay` و مسیر
 *      «آزادسازی صریح مدیر» هر دو همین را صدا می‌زنند و هر دو پشت قفل
 *      `PANEL_KEYS.cardTransfers` هستند.
 *
 * ⚠️ این سرویس هیچ مدل جدیدی ندارد و هیچ جدول موجودی موازی نمی‌سازد. منبع
 * حقیقت همان `SaleReturnItem.restockedQty` + پرچم `SaleReturn.restockPending`
 * است (دلیلش در `src/shared/pendingRestock.ts` نوشته شده).
 *
 * ⚠️ `releaseReturnStock` **idempotent** است: فقط اقلامی را برمی‌گرداند که
 * `restockedQty < qty`. پس دو بار زدن «پرداخت شد» (یا یک retry) هیچ‌وقت کالا
 * را دو بار اضافه نمی‌کند.
 * ===========================================================================
 */

/**
 * نشست ۱۸۰ (S180-D3، گام ۰ خوشه M) — شکل ردیف برگشتِ معلق.
 *
 * `client` عمداً `any` است (هارنس تست و Prisma واقعی هر دو باید کار کنند)، پس
 * `findMany` تایپ `any` می‌داد و `readAll<T>` نمی‌توانست `T` را استنتاج کند ⇒
 * `unknown[]` و ۱۰ خطای TS18046 روی `r`. این تایپ دقیقاً همان فیلدهایی است که
 * `include` بالا برمی‌گرداند و بدنه‌ی سرویس مصرف می‌کند. هیچ تغییر زمان‌اجرا.
 */
type PendingReturnRow = {
  id: number
  kind: string | null
  returnedAt: Date
  returnedAtJalali: string | null
  items: Array<{
    variantId: number
    /** در schema هر دو `Int` غیرنال‌اند (`restockedQty` با پیش‌فرض ۰). */
    qty: number
    restockedQty: number
    variantName: string | null
    variantCode: string | null
  }>
  invoice: { id: number; receiptNo: number } | null
}

/** فقط برگشت‌های معلق را می‌خواند (یک کوئری، با ایندکس `restockPending`). */
async function pendingReturns(client: any = prisma): Promise<PendingReturnRow[]> {
  return readAll<PendingReturnRow>((page) => client.saleReturn.findMany({
    where: { restockPending: true, voidedAt: null },
    orderBy: [{ returnedAt: 'asc' }, { id: 'asc' }],
    include: {
      items: true,
      invoice: { select: { id: true, receiptNo: true } }
    },
    ...page
  }))
}

export const pendingRestockService = {
  /**
   * خلاصه‌ی «معلق برگشتی» — همان شکلی که پنج صفحه مصرف می‌کنند.
   * فقط خواندنی است و هیچ‌چیزی را تغییر نمی‌دهد.
   */
  async summary(client: any = prisma): Promise<PendingRestockSummary> {
    const returns = await pendingReturns(client)
    if (!returns.length) return { ...EMPTY_PENDING_RESTOCK, byVariant: {}, items: [] }

    const returnIds = returns.map((r: any) => r.id)
    /**
     * درخواست کارت‌به‌کارتِ مرجع. با `kind = REQUEST` فیلتر می‌شود تا ردیف‌های
     * `ADJUSTMENT` (که همان `returnId` را دارند) مبلغ را دو بار نشمارند.
     */
    const requests = returnIds.length
      ? (
          await Promise.all(
            chunksOf(returnIds).map((ids) =>
              client.cardTransferRequest.findMany({
                where: { returnId: { in: ids }, kind: CardTransferKind.REQUEST },
                orderBy: { id: 'asc' }
              })
            )
          )
        ).flat()
      : []
    const reqByReturn = new Map<number, any>()
    for (const q of requests) reqByReturn.set(q.returnId, q)

    const variantIds = [...new Set(returns.flatMap((r: any) => r.items.map((i: any) => i.variantId)))]
    const variants = variantIds.length
      ? (
          await Promise.all(
            chunksOf(variantIds).map((ids) =>
              client.productVariant.findMany({
                where: { id: { in: ids } },
                select: { id: true, code: true, size: true, color: true, product: { select: { name: true } } }
              })
            )
          )
        ).flat()
      : []
    const vmap = new Map(variants.map((v: any) => [v.id, v]))
    const now = new Date()

    const items: PendingRestockItem[] = []
    const byVariant: Record<number, number> = {}
    let totalQty = 0
    let pendingAmount = 0
    let needsAttentionQty = 0
    const countedReturns = new Set<number>()

    for (const r of returns) {
      const req = reqByReturn.get(r.id) ?? null
      const canceled = req?.status === CardTransferStatus.CANCELED
      const age = ageInDays(req?.createdAt ?? r.returnedAt, now)
      const retPending = pendingQtyOfItems(r.items)
      if (retPending <= 0) continue
      countedReturns.add(r.id)
      totalQty += retPending
      /** مبلغ فقط یک بار و فقط از درخواستِ در انتظار پرداخت شمرده می‌شود. */
      // نشست ۱۸۱: `req.amount` از ردیف Prisma می‌آید و حالا BigInt است.
      if (req && req.status === CardTransferStatus.PENDING) pendingAmount += Math.max(0, toNumberRial(req.amount ?? 0))
      if (canceled) needsAttentionQty += retPending

      for (const it of r.items) {
        const qty = Math.max(0, Math.round(it.qty ?? 0) - Math.round(it.restockedQty ?? 0))
        if (qty <= 0) continue
        const v: any = vmap.get(it.variantId)
        byVariant[it.variantId] = (byVariant[it.variantId] ?? 0) + qty
        items.push({
          variantId: it.variantId,
          name: v
            ? `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
            : it.variantName || 'کالای حذف‌شده از سیستم',
          code: it.variantCode ?? v?.code ?? null,
          qty,
          returnId: r.id,
          receiptNo: r.invoice?.receiptNo ?? null,
          returnedAtJalali: r.returnedAtJalali ?? '—',
          requestId: req?.id ?? null,
          amount: Math.max(0, toNumberRial(req?.amount ?? 0)),
          operationKind: req?.operationKind ?? r.kind ?? 'RETURN',
          ageDays: age,
          canceled
        })
      }
    }

    items.sort((a, b) => b.ageDays - a.ageDays || a.returnId - b.returnId)

    return {
      totalQty,
      returnCount: countedReturns.size,
      variantCount: Object.keys(byVariant).length,
      pendingAmount,
      oldestAgeDays: items.reduce((m, i) => Math.max(m, i.ageDays), 0),
      items,
      byVariant,
      needsAttentionQty
    }
  },

  /** فقط نقشه‌ی «کالا ⇒ تعداد معلق» (برای صفحه‌ی انبار و snapshot انبارگردانی). */
  async byVariant(client: any = prisma): Promise<Record<number, number>> {
    const returns = await pendingReturns(client)
    const out: Record<number, number> = {}
    for (const r of returns)
      for (const it of r.items) {
        const qty = Math.max(0, Math.round(it.qty ?? 0) - Math.round(it.restockedQty ?? 0))
        if (qty > 0) out[it.variantId] = (out[it.variantId] ?? 0) + qty
      }
    return out
  },

  /**
   * -------------------------------------------------------------------------
   * تنها نقطه‌ی آزادسازی کالای معلق. همیشه با `tx` صدا زده می‌شود (قاعده‌ی ۶
   * README) و صدازننده **باید قبلاً تأیید مدیر را گرفته باشد**.
   *
   * idempotent: اقلامی که `restockedQty >= qty` دارند نادیده گرفته می‌شوند، پس
   * هیچ مسیری نمی‌تواند کالا را دو بار به موجودی اضافه کند.
   * -------------------------------------------------------------------------
   */
  async releaseReturnStock(
    tx: any,
    params: {
      returnId: number
      userId?: number | null
      /** برای متن AuditLog: «پرداخت مدیر» یا «آزادسازی صریح مدیر» */
      reason: string
      requestId?: number | null
      at?: Date
    }
  ): Promise<{
    releasedQty: number
    variants: { variantId: number; qty: number }[]
    restoredToWarehouses?: number
    alreadyDone: boolean
  }> {
    const returnId = Number(params.returnId ?? 0)
    if (!returnId) return { releasedQty: 0, variants: [], alreadyDone: true }

    const ret = await tx.saleReturn.findUnique({
      where: { id: returnId },
      include: { items: true, invoice: { select: { id: true, receiptNo: true, deductInventory: true } } }
    })
    if (!ret) throw new Error('سند برگشت مرجع پیدا نشد، پس کالایی به انبار برنگشت.')

    /**
     * اگر این سند اصلاً معلق نیست، هیچ کاری انجام نمی‌شود. دو حالتِ ممکن:
     *   • قبلاً آزاد شده (پرداخت دوباره / retry) ⇒ idempotent
     *   • برگشتِ بازپرداخت نقدی/کارتی یا فاکتور بدون کسر موجودی ⇒ اصلاً معلق نبود
     * هر دو حالت باید *بی‌صدا* رد شوند، نه با خطا: مدیر حق دارد «پرداخت شد» را
     * روی درخواستی بزند که هیچ کالای معلقی ندارد (مثلاً مابه‌التفاوت تعویض).
     */
    if (ret.restockPending !== true) return { releasedQty: 0, variants: [], alreadyDone: true }
    // نشست ۶۴ · بند ۴-۲۲ — سند باطل‌شده هیچ کالایی به موجودی اضافه نمی‌کند
    if ((ret as any).voidedAt != null) return { releasedQty: 0, variants: [], alreadyDone: true }

    const targets = (ret.items ?? []).filter((it: any) => itemNeedsRestock(it))
    const now = params.at ?? new Date()

    if (!targets.length) {
      await tx.saleReturn.update({
        where: { id: returnId },
        data: { restockPending: false, restockReleasedAt: now, restockReleasedAtJalali: toJalaliDate(now) }
      })
      return { releasedQty: 0, variants: [], alreadyDone: true }
    }

    const changes = new Map<number, number>()
    /** جلسه ۴۷ — همان اقلام، ولی با `saleItemId` تا دفتر مبدأ کسر پیدا شود. */
    const allocTargets: { saleItemId: number; variantId: number; qty: number }[] = []
    for (const it of targets) {
      const delta = Math.max(0, Math.round(it.qty ?? 0) - Math.round(it.restockedQty ?? 0))
      if (delta <= 0) continue
      changes.set(it.variantId, (changes.get(it.variantId) ?? 0) + delta)
      if (it.saleItemId) allocTargets.push({ saleItemId: it.saleItemId, variantId: it.variantId, qty: delta })
      await tx.saleReturnItem.update({ where: { id: it.id }, data: { restockedQty: Math.round(it.qty ?? 0) } })
    }

    const variants = [...changes.entries()].map(([variantId, qty]) => ({ variantId, qty }))
    const releasedQty = variants.reduce((s, c) => s + c.qty, 0)

    /**
     * =====================================================================
     * جلسه ۴۷ — هماهنگی با «از کدام انبار کسر شود؟».
     *
     * کالای معلقِ یک فاکتور فروش عمده باید به **همان انباری** آزاد شود که از آن
     * کم شده بود، نه لزوماً به انبار فروشگاه. پس مبدأها از دفتر
     * `SaleItemStockAllocation` خوانده و سهم انبارها همان‌جا برگردانده می‌شود؛
     * فقط سهم فروشگاه به `inventoryService.increase` می‌رسد.
     *
     * ⚠️ فاکتورِ بی‌دفتر (هر برگشتِ قبل از این نسخه و هر فروش تکی) ⇒ سهم
     * فروشگاه عیناً همان `variants` است و این مسیر مو‌به‌مو مثل قبل کار می‌کند.
     * «تنها نقطه‌ی آزادسازی» بودنِ همین تابع هم دست‌نخورده می‌ماند.
     * =====================================================================
     */
    const split =
      ret.invoice?.id && allocTargets.length
        ? await stockAllocationService.reverseForSaleItems(tx, {
            invoiceId: ret.invoice.id,
            receiptNo: ret.invoice.receiptNo ?? null,
            targets: allocTargets,
            userId: params.userId ?? null,
            reason: `آزادسازی کالای برگشتیِ معلق · ${params.reason}`
          })
        : null
    const storeLines = split ? split.storeLines : variants
    const warehouseQty = split?.warehouseQty ?? 0

    if (storeLines.length) {
      await inventoryService.increase(
        storeLines,
        {
          reason: 'SALE_RETURN',
          refType: 'SaleReturn',
          refId: returnId,
          userId: params.userId ?? null,
          note:
            `ورود کالای برگشتیِ معلق به موجودی قابل‌فروش · فاکتور ${faDigits(ret.invoice?.receiptNo ?? 0)} · ` +
            params.reason
        },
        tx
      )
    }

    await tx.saleReturn.update({
      where: { id: returnId },
      data: { restockPending: false, restockReleasedAt: now, restockReleasedAtJalali: toJalaliDate(now) }
    })

    await tx.auditLog.create({
      data: {
        action: AuditAction.CARD_TRANSFER_RESTOCK,
        entity: 'SaleReturn',
        entityId: returnId,
        userId: params.userId ?? null,
        after: JSON.stringify({
          returnId,
          requestId: params.requestId ?? null,
          receiptNo: ret.invoice?.receiptNo ?? null,
          releasedQty,
          variants,
          /** جلسه ۴۷ — چه مقدار به انبارهای مبدأ آزاد شد (نه انبار فروشگاه) */
          restoredToWarehouses: warehouseQty
        }),
        note:
          `${releasedStockNote(releasedQty, faDigits)} · ${params.reason}` +
          (warehouseQty > 0 ? ` · ${faDigits(warehouseQty)} عدد به انبارهای مبدأ` : '')
      }
    })

    return { releasedQty, variants, restoredToWarehouses: warehouseQty, alreadyDone: false }
  }
}
