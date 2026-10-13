import { prisma } from '../db/client'
import type { Prisma } from '@prisma/client'
import { inventoryService } from './InventoryService'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import { TX_OPTIONS } from '../db/tx'
import { AuditAction } from '@shared/enums'
import { assertPanelPassword } from './AuthService'
import { PANEL_KEYS } from '@shared/panels'
import { toJalaliDate, jalaliToDateTime, isValidJalaliDate, faDigits } from '@shared/jalali'
import type { CreatePurchaseInput, UpdatePurchaseInput } from '@shared/types'
import { partyService } from './PartyService'
import { custodyService } from './CustodyService'

async function resolveSupplierId(input: { supplierId?: number | null; supplierName?: string | null }) {
  if (input.supplierId != null && Number(input.supplierId) > 0) return Number(input.supplierId)
  const name = String(input.supplierName ?? '').trim()
  if (!name) return null
  const s = await partyService.ensureSupplier({ name })
  return s.id
}

type PLine = { variantId: number; warehouseId?: number | null; qty: number; unitPrice: number }

/** جمع تعداد هر واریانت (چند ردیف از یک کالا با هم جمع می‌شوند). */
function qtyByVariant(lines: { variantId: number; qty: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const l of lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + Math.round(l.qty))
  return m
}

/** پاک‌سازی و اعتبارسنجی مشترک ثبت و ویرایش. */
function cleanLines(input: { lines?: PLine[]; force?: boolean; issuedAtJalali?: string }): PLine[] {
  /**
   * نشست ۱۶۹ (S168-D3، بند ۳ «کمیت فقط عدد صحیح» و «مبالغ به ریال»، بند ۴-۴۲، بند ۵ «هر گیت در main») —
   * قبلاً ردیف اعشاری/متنی بی‌صدا حذف (پیام گمراه «بدون قلم») یا در update با Math.round گرد می‌شد
   * (۲٫۵ ⇒ ۳ عدد اضافه به موجودی) و create قیمت اعشاری را عیناً می‌نوشت. حالا هر ردیف دارای کالا که
   * تعدادش خالی/صفر نیست باید تعداد صحیح مثبت و قیمت واحد صحیح (ریال) داشته باشد؛ ردیف تعداد صفر مثل قبل
   * نادیده گرفته می‌شود؛ قیمت منفی مثل قبل فقط با force. این سنجش پیش از رمز و تراکنش است.
   */
  ;(input.lines ?? []).forEach((l, i) => {
    if (!l || !l.variantId) return
    const q = l.qty as unknown
    if (q === 0 || q === null || q === undefined || q === '') return
    const row = `ردیف ${faDigits(i + 1)}`
    if (typeof q !== 'number' || !Number.isSafeInteger(q) || q <= 0)
      throw new BusinessError(
        `${row}: تعداد «${faDigits(String(q))}» معتبر نیست؛ تعداد کالا باید عدد صحیح مثبت باشد (کالای اعشاری خرید/فروش نمی‌شود).`
      )
    const p = l.unitPrice as unknown
    if (typeof p !== 'number' || !Number.isSafeInteger(p))
      throw new BusinessError(
        `${row}: قیمت واحد «${faDigits(String(p))}» معتبر نیست؛ قیمت باید عدد صحیح به ریال باشد (بدون اعشار).`
      )
  })
  const lines = (input.lines ?? []).filter((l) => l && l.variantId && l.qty > 0)
  if (!lines.length) throw new BusinessError('فاکتور خرید بدون قلم قابل ثبت نیست')
  if (lines.some((l) => l.unitPrice < 0))
    throw new BusinessError('قیمت واحد نمی‌تواند منفی باشد؛ هیچ تاییدی این را مجاز نمی‌کند.')
  if (input.issuedAtJalali && !isValidJalaliDate(input.issuedAtJalali))
    throw new BusinessError('تاریخ فاکتور معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
  return lines
}

/** مبلغِ ورودی فاکتور خرید فقط ریالِ صحیح و نامنفی است؛ گردکردن یا coercion مجاز نیست. */
function safeNonNegativeRial(raw: unknown, label: string): number {
  const value = raw ?? 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new BusinessError(`«${label}» باید عدد صحیحِ نامنفی به ریال باشد؛ اعشار، متن و عدد خیلی بزرگ پذیرفته نمی‌شود.`)
  return value
}

/** برای سازگاری با کد قبلی؛ منبع واحد تایپ در src/shared/types.ts است. */
export type PurchaseInput = CreatePurchaseInput

async function nextInvoiceNo(client: Prisma.TransactionClient = prisma): Promise<number> {
  const last = await client.purchaseInvoice.findFirst({
    orderBy: { invoiceNo: 'desc' },
    select: { invoiceNo: true }
  })
  return (last?.invoiceNo ?? 364) + 1
}

/** نشست ۱۱۵ — سقف و پیش‌فرض هر صفحه‌ی فهرست خرید (بند ۴-۴۶: تا حدود ۵٬۰۰۰ ردیف یک‌جا) */
const PURCHASE_PAGE_MAX = 5000

export const purchaseService = {
  nextNo: () => nextInvoiceNo(),

  /**
   * ثبت فاکتور خرید → افزایش خودکار و اتمیک موجودی.
   * فاکتور + اقلام + حرکات انبار همه در یک $transaction هستند؛ نوشتن موجودی
   * فقط از طریق InventoryService انجام می‌شود (قاعده‌ی ۱ README).
   */
  async create(input: CreatePurchaseInput & { panelPassword?: string | null; supplierName?: string | null; custodyFence?: any }) {
    const lines = cleanLines(input)
    // PUR-002: مبلغ‌های ورودی پیش از رمز و تراکنش به‌طور سخت‌گیرانه بررسی می‌شوند.
    const requestedDiscount = safeNonNegativeRial(input.discountTotal, 'تخفیف فاکتور خرید')
    const paidTotal = safeNonNegativeRial(input.paidTotal, 'مبلغ پرداخت‌شده‌ی فاکتور خرید')
    /**
     * نشست ۱۵۵ (S151-c1، بند ۴-۳۹ «ثبت خرید» و بند ۵ «هر گیت در main») — قفل پنل خرید فقط در
     * UI بود؛ هر تماس IPC موجودی را بی‌رمز بالا می‌برد و قیمت خرید را عوض می‌کرد. حالا بعد از
     * اعتبارسنجی ورودی (ورودی خراب تلاش رمز مصرف نکند) و *پیش از* تراکنش (نوشتن AuthLockout
     * وسط تراکنش = بن‌بست SQLite): رمز پنل خرید؛ رمز مدیر همه را باز می‌کند؛ قفل خاموش ⇒ OPEN.
     */
    await assertPanelPassword(PANEL_KEYS.purchase, input?.panelPassword ?? null, 'ثبت فاکتور خرید (افزایش موجودی و قیمت خرید)')
    const supplierId = await resolveSupplierId(input)

    const issuedAt = input.issuedAtJalali ? jalaliToDateTime(input.issuedAtJalali) : new Date()
    const goodsTotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
    if (!Number.isSafeInteger(goodsTotal))
      throw new BusinessError('جمع کالاهای فاکتور خرید از محدوده‌ی مبلغ صحیحِ قابل‌ثبت خارج است.')
    const discountTotal = Math.min(requestedDiscount, goodsTotal)
    const grandTotal = goodsTotal - discountTotal

    return prisma.$transaction(async (tx) => {
      if (input.custodyFence) await custodyService.assertFenceInTx(tx, input.custodyFence)
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNo: await nextInvoiceNo(tx),
          supplierId,
          issuedAt,
          issuedAtJalali: toJalaliDate(issuedAt),
          goodsTotal,
          discountTotal,
          grandTotal,
          paidTotal,
          settlementType: input.settlementType ?? 'CASH',
          note: input.note,
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId,
              warehouseId: l.warehouseId ?? null,
              qty: l.qty,
              unitPrice: l.unitPrice,
              lineTotal: l.qty * l.unitPrice
            }))
          }
        },
        include: { items: true, supplier: true }
      })

      await inventoryService.increase(
        lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        {
          reason: 'PURCHASE',
          refType: 'PurchaseInvoice',
          refId: invoice.id,
          userId: input.userId ?? null,
          note: `فاکتور خرید ${invoice.invoiceNo}`
        },
        tx
      )

      // قیمت خرید آخرین فاکتور روی واریانت به‌روز می‌شود
      for (const l of lines) {
        await tx.productVariant.update({ where: { id: l.variantId }, data: { purchasePrice: l.unitPrice } })
      }

      // ⚠️ tx و نه prisma سراسری (منبع باگ «Transaction already closed»)
      await audit(tx, {
        action: 'PURCHASE_CREATE',
        entity: 'PurchaseInvoice',
        entityId: invoice.id,
        userId: input.userId ?? null,
        after: JSON.stringify({
          invoiceNo: invoice.invoiceNo,
          supplierId: invoice.supplierId,
          issuedAtJalali: invoice.issuedAtJalali,
          lines: lines.length,
          goodsTotal,
          discountTotal,
          grandTotal,
          settlementType: invoice.settlementType
        }),
        note: 'افزایش موجودی از طریق InventoryService'
      })

      return invoice
    }, TX_OPTIONS)
  },

  /**
   * ---------------------------------------------------------------------
   * ویرایش یک فاکتور خرید ثبت‌شده.
   *
   * `input.lines` حالت *نهایی* فاکتور است؛ شماره فاکتور عوض نمی‌شود.
   *
   * موجودی با delta اعمال می‌شود، نه با حذف کل و ثبت دوباره از صفر:
   * اگر ۱۰ عدد اضافه ثبت شده بود و الان آن ۱۰ عدد را از فاکتور بردارید،
   * دقیقاً همان ۱۰ عدد از موجودی انبار کم می‌شود و حرکات انبار قبلی هم پاک
   * نمی‌شوند (ردپا کامل می‌ماند). نوشتن موجودی فقط از InventoryService.
   *
   * همه‌چیز در یک $transaction اتمیک، با ثبت before/after در AuditLog.
   * ---------------------------------------------------------------------
   */
  async update(input: UpdatePurchaseInput & { panelPassword?: string | null; supplierName?: string | null; custodyFence?: any }) {
    const lines = cleanLines(input)
    // PUR-002: همان قرارداد سخت‌گیرانه‌ی create، پیش از رمز و transaction.
    const requestedDiscount = safeNonNegativeRial(input.discountTotal, 'تخفیف فاکتور خرید')
    const paidTotal = safeNonNegativeRial(input.paidTotal, 'مبلغ پرداخت‌شده‌ی فاکتور خرید')
    if (!input.id) throw new BusinessError('فاکتوری برای ویرایش مشخص نشده است')
    // نشست ۱۵۵ (S151-c1) — همان گیت ثبت خرید، پیش از تراکنش
    await assertPanelPassword(PANEL_KEYS.purchase, input?.panelPassword ?? null, 'ویرایش فاکتور خرید (اصلاح موجودی و قیمت خرید)')
    const supplierId = await resolveSupplierId(input)

    const invoice = await prisma.$transaction(async (tx) => {
      if (input.custodyFence) await custodyService.assertFenceInTx(tx, input.custodyFence)
      const current = await tx.purchaseInvoice.findUnique({
        where: { id: input.id },
        include: { items: true }
      })
      if (!current)
        throw new BusinessError('این فاکتور خرید پیدا نشد؛ ممکن است حذف شده باشد. لیست فاکتورها را تازه کنید.')

      const issuedAt = input.issuedAtJalali ? jalaliToDateTime(input.issuedAtJalali) : current.issuedAt
      const goodsTotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
      if (!Number.isSafeInteger(goodsTotal))
        throw new BusinessError('جمع کالاهای فاکتور خرید از محدوده‌ی مبلغ صحیحِ قابل‌ثبت خارج است.')
      const discountTotal = Math.min(requestedDiscount, goodsTotal)
      const grandTotal = goodsTotal - discountTotal

      // delta موجودی: مثبت = باید اضافه شود، منفی = باید کم شود.
      const old = qtyByVariant(current.items)
      const next = qtyByVariant(lines)
      const increase: { variantId: number; qty: number }[] = []
      const decrease: { variantId: number; qty: number }[] = []
      for (const variantId of new Set([...old.keys(), ...next.keys()])) {
        const delta = (next.get(variantId) ?? 0) - (old.get(variantId) ?? 0)
        if (delta > 0) increase.push({ variantId, qty: delta })
        else if (delta < 0) decrease.push({ variantId, qty: -delta })
      }

      const before = {
        invoiceNo: current.invoiceNo,
        issuedAtJalali: current.issuedAtJalali,
        supplierId: current.supplierId,
        goodsTotal: current.goodsTotal,
        discountTotal: current.discountTotal,
        grandTotal: current.grandTotal,
        paidTotal: current.paidTotal,
        settlementType: current.settlementType,
        items: current.items.map((i) => ({ variantId: i.variantId, qty: i.qty, unitPrice: i.unitPrice }))
      }

      await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: current.id } })

      const invoice = await tx.purchaseInvoice.update({
        where: { id: current.id },
        data: {
          supplierId,
          issuedAt,
          issuedAtJalali: toJalaliDate(issuedAt),
          goodsTotal,
          discountTotal,
          grandTotal,
          paidTotal,
          settlementType: input.settlementType ?? current.settlementType,
          note: input.note ?? null,
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId,
              warehouseId: l.warehouseId ?? null,
              qty: Math.round(l.qty),
              unitPrice: Math.round(l.unitPrice),
              lineTotal: Math.round(l.qty * l.unitPrice)
            }))
          }
        },
        include: { items: true, supplier: true }
      })

      const ctx = {
        refType: 'PurchaseInvoice',
        refId: current.id,
        userId: input.userId ?? null,
        note: `اصلاح فاکتور خرید ${faDigits(current.invoiceNo)}`
      }
      if (increase.length) await inventoryService.increase(increase, { ...ctx, reason: 'PURCHASE_EDIT' }, tx)
      if (decrease.length) await inventoryService.decrease(decrease, { ...ctx, reason: 'PURCHASE_EDIT' }, tx)

      // قیمت خرید واریانت با آخرین مقدار همین فاکتور به‌روز می‌شود (مثل create)
      for (const l of lines) {
        await tx.productVariant.update({ where: { id: l.variantId }, data: { purchasePrice: Math.round(l.unitPrice) } })
      }

      await audit(tx, {
        action: AuditAction.PURCHASE_UPDATE,
        entity: 'PurchaseInvoice',
        entityId: current.id,
        userId: input.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify({
          invoiceNo: invoice.invoiceNo,
          issuedAtJalali: invoice.issuedAtJalali,
          supplierId: invoice.supplierId,
          goodsTotal,
          discountTotal,
          grandTotal,
          paidTotal: invoice.paidTotal,
          settlementType: invoice.settlementType,
          items: invoice.items.map((i) => ({ variantId: i.variantId, qty: i.qty, unitPrice: i.unitPrice })),
          stockDelta: { increase, decrease }
        }),
        note: `ویرایش فاکتور خرید · اختلاف موجودی اعمال شد (افزایش ${increase.length} قلم، کاهش ${decrease.length} قلم)`
      })

      return invoice
    }, TX_OPTIONS)
    try {
      const { costEngine } = await import('./management/CostEngine')
      let r = await costEngine.repricePurchase(invoice.id)
      if ((r as any)?.needRun || (r as any)?.queued) {
        await costEngine.run()
        r = await costEngine.repricePurchase(invoice.id)
      }
    } catch (e) {
      console.error('[purchase] reprice lots after edit', e)
    }
    return invoice
  },

  get(id: number) {
    return prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { supplier: true, items: { include: { variant: { include: { product: true } } } } }
    })
  },

  /**
   * نشست ۱۱۵ · خوشه G · بند ۴-۴۶ — فهرست فاکتورهای خرید بازه.
   * قبلاً با `take: 500` ثابت بی‌صدا بریده می‌شد و پنل جمع خرید را از همان ردیف‌های
   * بریده می‌ساخت. حالا: خروجی همچنان آرایه (سازگاری)، به‌علاوه‌ی `page`،
   * `warnings` فارسی و `totals` روی کل بازه (aggregate با همان where).
   * پیش‌فرض و سقف هر صفحه ۵٬۰۰۰ ردیف؛ `skip` برای صفحه‌ی بعد.
   */
  async list(filter: { from?: string; to?: string; supplierId?: number; take?: number; skip?: number }) {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      issuedAt:
        filter.from || filter.to
          ? { gte: filter.from ? new Date(filter.from) : undefined, lte: filter.to ? new Date(filter.to) : undefined }
          : undefined,
      supplierId: filter.supplierId
    }
    const agg = await prisma.purchaseInvoice.aggregate({
      where,
      _count: { _all: true },
      _sum: { goodsTotal: true, discountTotal: true, grandTotal: true, paidTotal: true }
    })
    const totalCount = Number(agg._count?._all ?? 0)
    const t = Math.round(Number(filter.take ?? PURCHASE_PAGE_MAX))
    const k = Math.round(Number(filter.skip ?? 0))
    const take = Math.min(Math.max(Number.isFinite(t) ? t : PURCHASE_PAGE_MAX, 1), PURCHASE_PAGE_MAX)
    const skip = Math.max(Number.isFinite(k) ? k : 0, 0)
    const rows = await prisma.purchaseInvoice.findMany({
      where,
      include: { supplier: true, items: { include: { variant: { include: { product: true } } } } },
      orderBy: { invoiceNo: 'desc' },
      skip,
      take
    })
    const page = { skip, take, totalCount, truncated: totalCount > skip + rows.length || skip > 0 }
    const hidden = totalCount - rows.length
    const warnings =
      hidden > 0
        ? [
            `نمایش ${faDigits(rows.length.toLocaleString('en-US').replace(/,/g, '٬'))} از ${faDigits(
              totalCount.toLocaleString('en-US').replace(/,/g, '٬')
            )} فاکتور خرید (از ردیف ${faDigits(skip + 1)})؛ جمع‌های پایین جدول روی کل بازه حساب شده‌اند، ` +
              'ولی بقیه‌ی ردیف‌ها در صفحه‌ی دیگرند؛ با «صفحه‌ی بعد» یا بازه‌ی کوچک‌تر ببینید.'
          ]
        : []
    const totals = {
      count: totalCount,
      goodsTotal: Number(agg._sum?.goodsTotal ?? 0),
      discountTotal: Number(agg._sum?.discountTotal ?? 0),
      grandTotal: Number(agg._sum?.grandTotal ?? 0),
      paidTotal: Number(agg._sum?.paidTotal ?? 0)
    }
    return Object.assign(rows, { page, warnings, totals })
  }
}
