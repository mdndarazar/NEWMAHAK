import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { inventoryService } from './InventoryService'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import { faDigits, toClock, toJalaliDate } from '@shared/jalali'
import { AuditAction, SecondaryStockAction } from '@shared/enums'
import {
  DEFAULT_CENTRAL_WAREHOUSE_LABEL,
  MATCH_REASON_LABELS_FALLBACK,
  STOCK_PLAN_STALE_CODE,
  STORE_SOURCE_LABEL,
  StockSourceKind,
  normalizePlan,
  optionKey,
  planShapeErrors,
  sourceLabel,
  storeLinesOf,
  summarizePlan,
  summaryShortLine,
  summaryTextLines
} from '@shared/stockSource'
import type {
  ShortageSummaryGroup,
  StockAllocationEntry,
  StockAllocationPlan,
  StockSourceLine,
  StockSourceOption,
  StockSourcePreview,
  StockSourceRowInfo
} from '@shared/stockSource'
import { MATCH_REASON_LABELS, matchRank, variantTitle } from './SecondaryStockService'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * ===========================================================================
 * جلسه ۴۷ — «از کدام انبار کسر شود؟» (فقط فاکتور فروش عمده)
 * ---------------------------------------------------------------------------
 * سه کارِ کاملاً جدا در یک سرویس، و مرزشان عمدی است:
 *
 *   ۱) `preview()` — **هیچ چیز نمی‌نویسد.** برای هر قلم، موجودی همه‌ی منبع‌ها
 *      (انبار فروشگاه + ردیف‌های تطبیق‌خورده‌ی هر `SecondaryWarehouse`) را با
 *      نام و کد هر ردیف برمی‌گرداند، تا کاربر *ببیند* تطبیق متنی چه پیدا کرده.
 *
 *   ۲) `applyPlan()` — «برنامه‌ی کسر»ی که کاربر در پنجره ساخته را **داخل همان
 *      تراکنشِ ثبت فاکتور** دوباره اعتبارسنجی و اعمال می‌کند. اگر موجودی بین
 *      پنجره و ثبت عوض شده باشد، خطای مشخصِ `STOCK_PLAN_STALE` می‌دهد (و کل
 *      تراکنش برمی‌گردد) — هیچ‌وقت بی‌صدا چیز دیگری اجرا نمی‌کند.
 *
 *   ۳) `reverseForSaleItems()` — برگشت/ویرایش/حذف **دقیقاً از دفتر
 *      `SaleItemStockAllocation`** برمی‌گردند و کالا به همان انبارها می‌رود.
 *
 * ⚠️ مرز با انبار فروشگاه: سهم `STORE` همیشه از `inventoryService` می‌گذرد
 * (موجودی منفی مجاز است، حرکت انبار ثبت می‌شود). سهم انبارها **هیچ‌وقت** به
 * `ProductVariant.stock` دست نمی‌زند: مستقیم از ردیف‌های همان انبار کم می‌شود.
 *
 * ⚠️ تطبیق متنی تنها یک پیاده‌سازی دارد: `matchRank` در `SecondaryStockService`.
 * اینجا فقط «محدود به همان `warehouseId`» می‌شود و ترتیب رتبه‌ی فعلی حفظ می‌گردد.
 * ===========================================================================
 */

const REASONS: Record<number, string> = MATCH_REASON_LABELS ?? MATCH_REASON_LABELS_FALLBACK

interface VariantInfo {
  id: number
  code: string
  barcode: string | null
  stock: number
  size: string | null
  color: string | null
  product: { name: string; unit: string | null } | null
}

interface StockRow {
  id: number
  name: string
  code: string | null
  qty: number
  warehouseId: number | null
}

const VARIANT_SELECT = {
  id: true,
  code: true,
  barcode: true,
  stock: true,
  size: true,
  color: true,
  product: { select: { name: true, unit: true } }
} as const

/** هر lookup گروهی در SQLite/Prisma حداکثر ۵۰۰ شناسه داشته باشد. */
const STOCK_ALLOCATION_IN_CHUNK = 500

function uniquePositiveIds(values: Iterable<number>): number[] {
  return [...new Set([...values].map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

function chunksOf<T>(values: readonly T[], size = STOCK_ALLOCATION_IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/** lookup واریانت‌ها برای preview، ثبت عمده و خلاصه‌ی چاپ، بدون IN بزرگ. */
async function productVariantsByIds(client: Client, ids: Iterable<number>): Promise<VariantInfo[]> {
  const rows: VariantInfo[] = []
  for (const chunk of chunksOf(uniquePositiveIds(ids))) {
    rows.push(
      ...((await client.productVariant.findMany({
        where: { id: { in: chunk } },
        select: VARIANT_SELECT
      })) as unknown as VariantInfo[])
    )
  }
  return rows
}

/** خلاصه‌ی export ممکن است چند هزار فاکتور صفحه‌ی جاری داشته باشد. */
async function allocationsByInvoiceIds(invoiceIds: Iterable<number>): Promise<any[]> {
  const rows: any[] = []
  for (const chunk of chunksOf(uniquePositiveIds(invoiceIds))) {
    rows.push(
      ...(await prisma.saleItemStockAllocation.findMany({
        where: { invoiceId: { in: chunk } },
        orderBy: { id: 'asc' }
      }))
    )
  }
  return rows.sort((a, b) => Number(a.id) - Number(b.id))
}

/** خطای «برنامه دیگر معتبر نیست» — پنجره با دیدن کد، خودش را دوباره اجرا می‌کند. */
export class StalePlanError extends BusinessError {
  readonly code = STOCK_PLAN_STALE_CODE
  constructor(detail: string) {
    super(
      `${STOCK_PLAN_STALE_CODE}: موجودی بین لحظه‌ی انتخاب انبار و لحظه‌ی ثبت عوض شده است، پس این فاکتور ثبت نشد.\n` +
        `${detail}\n` +
        'پنجره‌ی «از کدام انبار کسر شود؟» دوباره با موجودی تازه باز می‌شود.'
    )
  }
}

/** ردیف‌های یک انبار مشخص که با تطبیق متنی «همین کالا» شمرده می‌شوند. */
function matchedRowsIn(rows: StockRow[], warehouseId: number | null, v: VariantInfo) {
  return rows
    .filter((r) => (r.warehouseId ?? null) === warehouseId)
    .map((r) => ({ row: r, rank: matchRank(r, v as any) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => a.rank - b.rank || b.row.qty - a.row.qty || a.row.id - b.row.id)
}

const rowInfoOf = (x: { row: StockRow; rank: number }): StockSourceRowInfo => ({
  id: x.row.id,
  name: x.row.name,
  code: x.row.code ?? null,
  qty: Math.round(x.row.qty),
  matchReason: REASONS[x.rank] ?? 'تطبیق متنی'
})

/** جمع موجودیِ *مثبتِ* ردیف‌های تطبیق‌خورده (ردیف منفی چیزی برای برداشت ندارد). */
const positiveSum = (rows: { row: StockRow }[]): number =>
  rows.reduce((s, x) => s + Math.max(0, Math.round(x.row.qty)), 0)

export const stockAllocationService = {
  /**
   * =========================================================================
   * ۱) پیش‌نمایش — فقط خواندن. هیچ ردیفی، هیچ لاگی، هیچ حرکتی نوشته نمی‌شود.
   * =========================================================================
   */
  async preview(input: { lines?: { variantId?: number; qty?: number }[] } = {}): Promise<StockSourcePreview> {
    const need = new Map<number, number>()
    for (const l of input.lines ?? []) {
      const id = Number(l?.variantId)
      const qty = Math.round(Number(l?.qty) || 0)
      if (Number.isInteger(id) && id > 0 && qty > 0) need.set(id, (need.get(id) ?? 0) + qty)
    }

    const [variants, houses, rows] = await Promise.all([
      need.size ? productVariantsByIds(prisma, need.keys()) : Promise.resolve([] as VariantInfo[]),
      prisma.secondaryWarehouse.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.secondaryStockItem.findMany({
        select: { id: true, name: true, code: true, qty: true, warehouseId: true },
        orderBy: { id: 'asc' }
      })
    ])

    /**
     * فهرست انبارهای ماژول انبار مرکزی:
     *   • انبار پیش‌فرض («انبار مرکزی») همیشه هست — `warehouseId = null`. اگر
     *     ردیف واقعیِ `isDefault` وجود داشته باشد، همان استفاده می‌شود.
     *   • بعد هر انبار **فعال** دیگر (انبار X). انبار غیرفعال گزینه نمی‌شود.
     */
    const realDefault = houses.find((h) => h.isDefault) ?? null
    const warehouseDefs: { warehouseId: number | null; name: string; location: string | null; isDefault: boolean }[] = [
      {
        /**
         * ⚠️ قرارداد بخش ۵ بدون استثنا: **انبار پیش‌فرض همیشه `warehouseId = null`
         * است**، حتی اگر ردیف واقعیِ `isDefault` هم وجود داشته باشد. فقط نامش از
         * آن ردیف خوانده می‌شود و ردیف‌های هر دو طرف با هم شمرده می‌شوند
         * (`idsOfWarehouse`). اگر اینجا شناسه‌ی واقعی برمی‌گشت، دفتر مبدأ دو
         * نمایشِ متفاوت برای یک انبار پیدا می‌کرد.
         */
        warehouseId: null,
        name: realDefault?.name ?? DEFAULT_CENTRAL_WAREHOUSE_LABEL,
        location: realDefault?.location ?? null,
        isDefault: true
      }
    ]
    for (const h of houses) {
      if (h.isDefault) continue
      if (!h.isActive) continue
      warehouseDefs.push({ warehouseId: h.id, name: h.name, location: h.location ?? null, isDefault: false })
    }

    const lines: StockSourceLine[] = []
    for (const v of variants as VariantInfo[]) {
      const sources: StockSourceOption[] = [
        {
          kind: StockSourceKind.STORE,
          warehouseId: null,
          name: STORE_SOURCE_LABEL,
          location: null,
          isDefaultWarehouse: false,
          available: Math.round(v.stock ?? 0),
          rows: [],
          /** فروشگاه همیشه «این کالا را می‌شناسد» (رکورد واقعی دارد) */
          matched: true
        }
      ]
      for (const w of warehouseDefs) {
        /**
         * ⚠️ نکته‌ی مهمِ انبار پیش‌فرض: ردیف‌هایی که `warehouseId = null` دارند و
         * ردیف‌هایی که به ردیف واقعیِ `isDefault` وصل‌اند، **هر دو** انبار
         * پیش‌فرض‌اند (قرارداد بخش ۵). پس هر دو با هم شمرده می‌شوند.
         */
        const ids: (number | null)[] = w.isDefault ? [null, ...(realDefault ? [realDefault.id] : [])] : [w.warehouseId]
        const matched = ids.flatMap((id) => matchedRowsIn(rows as StockRow[], id, v))
        matched.sort((a, b) => a.rank - b.rank || b.row.qty - a.row.qty || a.row.id - b.row.id)
        sources.push({
          kind: StockSourceKind.WAREHOUSE,
          warehouseId: w.warehouseId,
          name: w.name,
          location: w.location,
          isDefaultWarehouse: w.isDefault,
          available: positiveSum(matched),
          rows: matched.map(rowInfoOf),
          matched: matched.length > 0
        })
      }
      lines.push({
        variantId: v.id,
        name: variantTitle(v as any),
        code: v.code,
        barcode: v.barcode ?? null,
        unit: v.product?.unit ?? 'عدد',
        requested: need.get(v.id) ?? 0,
        sources
      })
    }
    lines.sort((a, b) => a.name.localeCompare(b.name, 'fa'))

    return {
      lines,
      options: [
        {
          kind: StockSourceKind.STORE,
          warehouseId: null,
          name: STORE_SOURCE_LABEL,
          location: null,
          isDefaultWarehouse: false
        },
        ...warehouseDefs.map((w) => ({
          kind: StockSourceKind.WAREHOUSE,
          warehouseId: w.warehouseId,
          name: w.name,
          location: w.location,
          isDefaultWarehouse: w.isDefault
        }))
      ],
      at: new Date().toISOString()
    }
  },

  /**
   * =========================================================================
   * ۲) اعمال برنامه‌ی کسر — **داخل تراکنشِ ثبت/ویرایش فاکتور**.
   *
   * ترتیب عمدی: اول اعتبارسنجی کامل (بی هیچ نوشتنی)، بعد نوشتن. پس یا همه‌ی
   * برنامه اجرا می‌شود یا هیچ‌کدام، و خطای `STOCK_PLAN_STALE` هیچ‌وقت وسط کار
   * نصفه‌نیمه نمی‌ماند.
   *
   * سهم `STORE` **اینجا کسر نمی‌شود**: برمی‌گردد تا صدازننده با همان
   * `inventoryService.decrease` همیشگی (و همان `reason`/`state`) کسرش کند.
   * دلیلش این است که حرکت انبار فروشگاه باید عیناً همان شکل قبلی را داشته باشد.
   * =========================================================================
   */
  async applyPlan(
    tx: Prisma.TransactionClient,
    params: {
      plan: unknown
      invoiceId: number
      receiptNo: number
      items: { id: number; variantId: number; qty: number }[]
      userId?: number | null
      /** متن سابقه: «ثبت فاکتور فروش عمده» یا «ویرایش فاکتور فروش عمده» */
      what?: string
    }
  ): Promise<{
    plan: StockAllocationPlan
    storeLines: { variantId: number; qty: number }[]
    groups: ShortageSummaryGroup[]
    summaryLines: string[]
    warnings: string[]
    warehouseTakenQty: number
  }> {
    const plan = normalizePlan(params.plan)
    if (!plan) throw new BusinessError('برنامه‌ی کسر موجودی خالی است؛ پنجره‌ی «از کدام انبار کسر شود؟» را کامل کنید.')

    const itemsByVariant = new Map<number, { id: number; variantId: number; qty: number }[]>()
    for (const it of params.items) {
      const list = itemsByVariant.get(it.variantId) ?? []
      list.push(it)
      itemsByVariant.set(it.variantId, list)
    }

    const variants = await productVariantsByIds(tx, itemsByVariant.keys())
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const nameOf = (id: number) => {
      const v = vmap.get(id)
      return v ? variantTitle(v as any) : `کالای ${id}`
    }

    // ---- الف) قاعده‌های شکلی (بی دیتابیس) ----
    const shapeErrors = planShapeErrors(
      plan,
      params.items.map((i) => ({ variantId: i.variantId, qty: i.qty, name: nameOf(i.variantId) }))
    )
    if (shapeErrors.length)
      throw new BusinessError('برنامه‌ی کسر موجودی کامل یا سازگار نیست:\n' + shapeErrors.map((e) => `• ${e}`).join('\n'))

    // ---- ب) اعتبارسنجی دوباره با موجودیِ همین لحظه ----
    const rows = (await tx.secondaryStockItem.findMany({
      select: { id: true, name: true, code: true, qty: true, warehouseId: true },
      orderBy: { id: 'asc' }
    })) as unknown as StockRow[]
    const houses = await tx.secondaryWarehouse.findMany({ select: { id: true, name: true, isDefault: true } })
    const realDefault = houses.find((h) => h.isDefault) ?? null
    /** نسخه‌ی کاری: تا دو قلمِ یک فاکتور یک ردیف را دو بار خالی نکنند. */
    const live = new Map(rows.map((r) => [r.id, { ...r }]))
    const liveRows = () => [...live.values()]

    const idsOfWarehouse = (warehouseId: number | null): (number | null)[] => {
      const isDefault = warehouseId == null || (realDefault != null && warehouseId === realDefault.id)
      if (!isDefault) return [warehouseId]
      return [null, ...(realDefault ? [realDefault.id] : [])]
    }

    const rowsFor = (warehouseId: number | null, v: VariantInfo) => {
      const out = idsOfWarehouse(warehouseId).flatMap((id) => matchedRowsIn(liveRows(), id, v))
      out.sort((a, b) => a.rank - b.rank || b.row.qty - a.row.qty || a.row.id - b.row.id)
      return out
    }

    /** موجودی فروشگاه هم از همین لحظه خوانده می‌شود، نه از snapshot پنجره. */
    const storeStock = new Map<number, number>(variants.map((v) => [v.id, Math.round(v.stock ?? 0)]))

    const stale: string[] = []
    for (const line of plan.lines) {
      const v = vmap.get(line.variantId)
      if (!v) {
        stale.push(`کالای ${line.variantId} دیگر در سیستم نیست.`)
        continue
      }
      for (const e of line.entries) {
        if (e.wentNegative) continue // کاربر صریحاً منفی شدن را تأیید کرده
        const available =
          e.kind === StockSourceKind.STORE ? (storeStock.get(v.id) ?? 0) : positiveSum(rowsFor(e.warehouseId, v))
        if (available < e.qty)
          stale.push(
            `«${nameOf(line.variantId)}» در «${sourceLabel(e.kind, e.warehouseName)}»: ` +
              `${faDigits(e.qty)} خواسته شده بود ولی الآن ${faDigits(available)} موجود است.`
          )
      }
    }
    if (stale.length) throw new StalePlanError(stale.map((s) => `• ${s}`).join('\n'))

    // ---- ج) نوشتن ----
    const now = new Date()
    const appliedEntries: { variantId: number; entry: StockAllocationEntry }[] = []
    const warnings: string[] = []
    let warehouseTakenQty = 0

    for (const line of plan.lines) {
      const v = vmap.get(line.variantId)!
      const unit = v.product?.unit ?? 'عدد'
      const title = variantTitle(v as any)
      const saleItems = [...(itemsByVariant.get(line.variantId) ?? [])]

      /**
       * اگر یک کالا دو ردیف در فاکتور داشته باشد (مثلاً دو بار اضافه شده)،
       * برنامه در سطح *کالا* است. سهم هر ردیفِ فاکتور به‌ترتیب و به‌اندازه‌ی
       * تعداد خودش از همان برنامه برداشته می‌شود، پس دفتر مبدأ در سطح
       * `saleItemId` هم درست می‌ماند (و برگشت جزئی همان قلم را پیدا می‌کند).
       */
      let cursor = 0
      let cursorLeft = saleItems.length ? saleItems[0].qty : 0

      for (const e of line.entries) {
        let qtyLeft = e.qty
        let balanceAfter = e.balanceAfter
        let wentNegative = e.wentNegative
        let rowDetails: { id: number; name: string; code: string | null; taken: number; remaining: number }[] = []

        if (e.kind === StockSourceKind.WAREHOUSE) {
          const picked = rowsFor(e.warehouseId, v)
          let need = e.qty
          for (const x of picked) {
            if (need <= 0) break
            const row = live.get(x.row.id)
            if (!row || row.qty <= 0) continue
            const take = Math.min(need, row.qty)
            row.qty -= take
            need -= take
            await tx.secondaryStockItem.update({ where: { id: row.id }, data: { qty: row.qty } })
            rowDetails.push({ id: row.id, name: row.name, code: row.code ?? null, taken: take, remaining: row.qty })
            await this.logRow(tx, {
              row,
              warehouseName: sourceLabel(e.kind, e.warehouseName),
              action: SecondaryStockAction.SALE_WHOLESALE,
              qtyBefore: row.qty + take,
              qtyAfter: row.qty,
              userId: params.userId ?? null,
              note:
                `${params.what ?? 'فاکتور فروش عمده'} ${faDigits(params.receiptNo)} · ` +
                `${faDigits(take)} ${unit} از «${title}» کسر شد`
            })
          }

          if (need > 0) {
            /**
             * کاربر «نه» را انتخاب کرده و می‌داند موجودی این انبار منفی می‌شود.
             * دو حالت:
             *   • ردیفی هست ⇒ باقی‌مانده روی قوی‌ترین تطبیق منفی می‌رود.
             *   • هیچ ردیفی نیست ⇒ یک ردیف تازه با نام/کد همین کالا ساخته می‌شود
             *     و منفی ثبت می‌گردد. عمداً «ساختن» است و نه «نادیده گرفتن»:
             *     وگرنه بدهی انبار هیچ‌جا دیده نمی‌شد.
             */
            const target = picked.length ? live.get(picked[0].row.id) : null
            if (target) {
              const before = target.qty
              target.qty -= need
              await tx.secondaryStockItem.update({ where: { id: target.id }, data: { qty: target.qty } })
              const hit = rowDetails.find((d) => d.id === target.id)
              if (hit) {
                hit.taken += need
                hit.remaining = target.qty
              } else
                rowDetails.push({
                  id: target.id,
                  name: target.name,
                  code: target.code ?? null,
                  taken: need,
                  remaining: target.qty
                })
              await this.logRow(tx, {
                row: target,
                warehouseName: sourceLabel(e.kind, e.warehouseName),
                action: SecondaryStockAction.SALE_WHOLESALE,
                qtyBefore: before,
                qtyAfter: target.qty,
                userId: params.userId ?? null,
                note:
                  `${params.what ?? 'فاکتور فروش عمده'} ${faDigits(params.receiptNo)} · ` +
                  `${faDigits(need)} ${unit} بیشتر از موجودی برداشته شد (تأیید صریح کاربر) ⇒ موجودی منفی`
              })
            } else {
              const createdWarehouseId =
                e.warehouseId == null && realDefault ? realDefault.id : (e.warehouseId ?? null)
              const created = await tx.secondaryStockItem.create({
                data: {
                  name: title,
                  code: v.code,
                  qty: -need,
                  warehouseId: createdWarehouseId,
                  note:
                    `ردیف خودکار: در «${sourceLabel(e.kind, e.warehouseName)}» ردیفی برای این کالا نبود و ` +
                    `کاربر تأیید کرد که فروش با موجودی منفی ثبت شود (فاکتور ${faDigits(params.receiptNo)}).`
                }
              })
              live.set(created.id, {
                id: created.id,
                name: created.name,
                code: created.code ?? null,
                qty: created.qty,
                warehouseId: created.warehouseId ?? null
              })
              rowDetails.push({ id: created.id, name: created.name, code: created.code ?? null, taken: need, remaining: created.qty })
              await this.logRow(tx, {
                row: { id: created.id, name: created.name, code: created.code ?? null, qty: created.qty, warehouseId: created.warehouseId ?? null },
                warehouseName: sourceLabel(e.kind, e.warehouseName),
                action: SecondaryStockAction.SALE_WHOLESALE,
                qtyBefore: 0,
                qtyAfter: created.qty,
                userId: params.userId ?? null,
                note:
                  `${params.what ?? 'فاکتور فروش عمده'} ${faDigits(params.receiptNo)} · ` +
                  `این انبار ردیفی برای «${title}» نداشت؛ ردیف تازه با موجودی منفی ساخته شد (تأیید صریح کاربر)`
              })
            }
            wentNegative = true
            warehouseTakenQty += e.qty
            const total = rowDetails.reduce((s, d) => s + d.remaining, 0)
            balanceAfter = total
            warnings.push(
              `«${title}»: ${faDigits(need)} ${unit} بیشتر از موجودیِ «${sourceLabel(e.kind, e.warehouseName)}» فروخته شد ` +
                `و موجودی آن انبار منفی رفت (با تأیید صریح خودتان).`
            )
          } else {
            warehouseTakenQty += e.qty
            balanceAfter = positiveSum(rowsFor(e.warehouseId, v))
            wentNegative = false
          }
        } else {
          // سهم فروشگاه: خودِ کسر بیرون انجام می‌شود، اینجا فقط عددِ خلاصه
          const after = (storeStock.get(v.id) ?? 0) - e.qty
          storeStock.set(v.id, after)
          balanceAfter = after
          wentNegative = after < 0
          if (wentNegative)
            warnings.push(
              `«${title}»: موجودی «${STORE_SOURCE_LABEL}» بعد از این فروش ${faDigits(Math.abs(after))}− می‌شود ` +
                '(همان رفتار همیشگیِ موجودی منفی فروشگاه).'
            )
        }

        const applied: StockAllocationEntry = {
          kind: e.kind,
          warehouseId: e.kind === StockSourceKind.STORE ? null : e.warehouseId,
          warehouseName: sourceLabel(e.kind, e.warehouseName),
          qty: e.qty,
          balanceAfter,
          wentNegative
        }
        appliedEntries.push({ variantId: line.variantId, entry: applied })

        // ---- تقسیم این برداشت بین ردیف‌های فاکتورِ همین کالا ----
        while (qtyLeft > 0 && cursor < saleItems.length) {
          const chunk = Math.min(qtyLeft, cursorLeft)
          if (chunk > 0) {
            await tx.saleItemStockAllocation.create({
              data: {
                invoiceId: params.invoiceId,
                saleItemId: saleItems[cursor].id,
                variantId: line.variantId,
                sourceKind: applied.kind,
                warehouseId: applied.warehouseId,
                warehouseName: applied.warehouseName,
                qty: chunk,
                balanceAfter: applied.balanceAfter,
                wentNegative: applied.wentNegative,
                rowDetails: rowDetails.length ? JSON.stringify(rowDetails) : null,
                restoredQty: 0,
                createdAt: now
              }
            })
          }
          qtyLeft -= chunk
          cursorLeft -= chunk
          if (cursorLeft <= 0) {
            cursor++
            cursorLeft = cursor < saleItems.length ? saleItems[cursor].qty : 0
          }
          if (chunk <= 0) break
        }
      }
    }

    const appliedPlan: StockAllocationPlan = { lines: [] }
    for (const { variantId, entry } of appliedEntries) {
      let l = appliedPlan.lines.find((x) => x.variantId === variantId)
      if (!l) {
        l = { variantId, entries: [] }
        appliedPlan.lines.push(l)
      }
      l.entries.push(entry)
    }

    const groups = summarizePlan(appliedPlan, nameOf)
    const summaryLines = summaryTextLines(groups, faDigits)

    await audit(tx, {
      action: AuditAction.SALE_STOCK_SOURCE,
      entity: 'SaleInvoice',
      entityId: params.invoiceId,
      userId: params.userId ?? null,
      after: JSON.stringify({ receiptNo: params.receiptNo, plan: appliedPlan.lines, warehouseTakenQty }),
      note: `${params.what ?? 'ثبت فاکتور فروش عمده'} · مبدأ کسر: ${summaryLines.join(' | ')}`
    })

    return {
      plan: appliedPlan,
      storeLines: storeLinesOf(appliedPlan),
      groups,
      summaryLines,
      warnings,
      warehouseTakenQty
    }
  },

  /** یک سطر در سابقه‌ی انبار مرکزی (هیچ‌وقت خطا پرتاب نمی‌کند). */
  async logRow(
    tx: Client,
    p: {
      row: StockRow
      warehouseName: string
      action: string
      qtyBefore: number
      qtyAfter: number
      userId?: number | null
      note: string
    }
  ): Promise<void> {
    try {
      const at = new Date()
      await tx.secondaryStockLog.create({
        data: {
          itemId: p.row.id,
          warehouseId: p.row.warehouseId ?? null,
          warehouseName: p.warehouseName,
          action: p.action,
          name: p.row.name,
          code: p.row.code ?? null,
          qtyBefore: Math.round(p.qtyBefore),
          qtyAfter: Math.round(p.qtyAfter),
          delta: Math.round(p.qtyAfter) - Math.round(p.qtyBefore),
          note: p.note,
          userId: p.userId ?? null,
          at,
          atJalali: toJalaliDate(at),
          atTime: toClock(at)
        }
      })
    } catch (err) {
      console.error('[stockAllocation:log]', err)
    }
  },

  /** آیا این فاکتور دفتر مبدأ کسر دارد؟ (نبودنش = فاکتور قدیمی / فقط فروشگاه) */
  async hasAllocations(tx: Client, invoiceId: number): Promise<boolean> {
    const n = await tx.saleItemStockAllocation.count({ where: { invoiceId } })
    return n > 0
  },

  /**
   * =========================================================================
   * ۳) برگشت — **دقیقاً از همین دفتر**. کالا به همان انبارها برمی‌گردد.
   *
   * ترتیب برگشت LIFO است (آخرین منبعی که از آن برداشته شد، اول پر می‌شود):
   * همان چیزی که کاربر انتظار دارد، چون منبع آخر همان انباری است که آگاهانه
   * انتخابش کرد (و شاید منفی هم رفته باشد).
   *
   * سهم `STORE` **اینجا اضافه نمی‌شود**: برمی‌گردد تا صدازننده با همان
   * `inventoryService.increase` همیشگی و همان `reason` اضافه‌اش کند.
   *
   * ⚠️ بی‌دفتر = بی‌تغییر: اگر فاکتور هیچ ردیفی در این جدول نداشته باشد،
   * `storeLines` عیناً همان چیزی است که به این تابع داده شده ⇒ مسیر تاریخی
   * (همه از انبار فروشگاه) مو‌به‌مو دست‌نخورده می‌ماند.
   * =========================================================================
   */
  async reverseForSaleItems(
    tx: Prisma.TransactionClient,
    params: {
      invoiceId: number
      receiptNo?: number | null
      targets: { saleItemId: number; variantId: number; qty: number }[]
      userId?: number | null
      reason: string
    }
  ): Promise<{
    storeLines: { variantId: number; qty: number }[]
    warehouseLines: { variantId: number; warehouseId: number | null; warehouseName: string; qty: number }[]
    warehouseQty: number
    notes: string[]
  }> {
    const store = new Map<number, number>()
    const warehouse: { variantId: number; warehouseId: number | null; warehouseName: string; qty: number }[] = []
    const notes: string[] = []
    let warehouseQty = 0

    const addStore = (variantId: number, qty: number) => {
      if (qty > 0) store.set(variantId, (store.get(variantId) ?? 0) + qty)
    }

    for (const t of params.targets) {
      let left = Math.max(0, Math.round(t.qty))
      if (left <= 0) continue

      const allocations = await tx.saleItemStockAllocation.findMany({
        where: { invoiceId: params.invoiceId, saleItemId: t.saleItemId },
        orderBy: { id: 'desc' }
      })

      if (!allocations.length) {
        // فاکتور قدیمی / بی‌دفتر ⇒ مو‌به‌مو مثل قبل: همه به انبار فروشگاه
        addStore(t.variantId, left)
        continue
      }

      for (const a of allocations) {
        if (left <= 0) break
        const capacity = Math.max(0, Math.round(a.qty) - Math.round(a.restoredQty ?? 0))
        if (capacity <= 0) continue
        const take = Math.min(left, capacity)
        left -= take

        if (a.sourceKind === StockSourceKind.STORE) {
          addStore(t.variantId, take)
        } else {
          await this.restoreWarehouseRows(tx, {
            allocation: a,
            qty: take,
            alreadyRestored: Math.round(a.restoredQty ?? 0),
            variantId: t.variantId,
            userId: params.userId ?? null,
            receiptNo: params.receiptNo ?? null,
            reason: params.reason
          })
          warehouse.push({
            variantId: t.variantId,
            warehouseId: a.warehouseId ?? null,
            warehouseName: a.warehouseName || DEFAULT_CENTRAL_WAREHOUSE_LABEL,
            qty: take
          })
          warehouseQty += take
          notes.push(`${faDigits(take)} عدد به «${a.warehouseName || DEFAULT_CENTRAL_WAREHOUSE_LABEL}» برگشت`)
        }

        await tx.saleItemStockAllocation.update({
          where: { id: a.id },
          data: { restoredQty: Math.round(a.restoredQty ?? 0) + take }
        })
      }

      /**
       * اگر دفتر کمتر از تعداد برگشتی ظرفیت داشت (نباید پیش بیاید؛ ولی
       * بی‌صدا هم نباید گم شود)، باقی‌مانده مثل مسیر تاریخی به انبار فروشگاه
       * می‌رود و در سابقه هم گفته می‌شود.
       */
      if (left > 0) {
        addStore(t.variantId, left)
        notes.push(
          `${faDigits(left)} عدد مبدأ ثبت‌شده نداشت و مثل قبل به «${STORE_SOURCE_LABEL}» برگشت.`
        )
      }
    }

    if (warehouseQty > 0)
      await audit(tx, {
        action: AuditAction.SALE_STOCK_SOURCE_RESTORE,
        entity: 'SaleInvoice',
        entityId: params.invoiceId,
        userId: params.userId ?? null,
        after: JSON.stringify({ receiptNo: params.receiptNo ?? null, warehouse, warehouseQty }),
        note: `${params.reason} · ${faDigits(warehouseQty)} عدد به انبارهای مبدأ برگشت`
      })

    return {
      storeLines: [...store.entries()].map(([variantId, qty]) => ({ variantId, qty })),
      warehouseLines: warehouse,
      warehouseQty,
      notes
    }
  },

  /** برگشت همه‌ی مبدأهای یک فاکتور (ویرایش / حذف فاکتور). */
  async reverseWholeInvoice(
    tx: Prisma.TransactionClient,
    params: { invoiceId: number; receiptNo?: number | null; userId?: number | null; reason: string }
  ) {
    const allocations = await tx.saleItemStockAllocation.findMany({
      where: { invoiceId: params.invoiceId },
      orderBy: { id: 'asc' }
    })
    const byItem = new Map<number, { saleItemId: number; variantId: number; qty: number }>()
    for (const a of allocations) {
      const left = Math.max(0, Math.round(a.qty) - Math.round(a.restoredQty ?? 0))
      if (left <= 0) continue
      const hit = byItem.get(a.saleItemId)
      if (hit) hit.qty += left
      else byItem.set(a.saleItemId, { saleItemId: a.saleItemId, variantId: a.variantId, qty: left })
    }
    if (!byItem.size)
      return { storeLines: [] as { variantId: number; qty: number }[], warehouseLines: [], warehouseQty: 0, notes: [] }
    return this.reverseForSaleItems(tx, { ...params, targets: [...byItem.values()] })
  },

  /** حذف دفتر مبدأ یک فاکتور (فقط وقتی خودِ فاکتور حذف/بازنویسی می‌شود). */
  async dropAllocations(tx: Prisma.TransactionClient, invoiceIds: number[]): Promise<number> {
    if (!invoiceIds.length) return 0
    let count = 0
    for (const chunk of chunksOf(uniquePositiveIds(invoiceIds)))
      count += (await tx.saleItemStockAllocation.deleteMany({ where: { invoiceId: { in: chunk } } })).count
    return count
  },

  /**
   * برگرداندن کالا به ردیف‌های همان انبار، با همان ترتیبی که از آن‌ها برداشته
   * شده بود (`rowDetails`). اگر ردیفی حذف شده باشد، با تطبیق متنیِ همان انبار
   * پیدا می‌شود و اگر آن هم نبود، ردیف تازه ساخته می‌شود — کالا هیچ‌وقت گم
   * نمی‌شود.
   */
  async restoreWarehouseRows(
    tx: Prisma.TransactionClient,
    p: {
      allocation: any
      qty: number
      alreadyRestored: number
      variantId: number
      userId?: number | null
      receiptNo?: number | null
      reason: string
    }
  ): Promise<void> {
    const warehouseName = p.allocation.warehouseName || DEFAULT_CENTRAL_WAREHOUSE_LABEL
    let details: { id: number; name: string; code: string | null; taken: number; remaining: number }[] = []
    try {
      const parsed = p.allocation.rowDetails ? JSON.parse(p.allocation.rowDetails) : []
      if (Array.isArray(parsed)) details = parsed
    } catch {
      details = []
    }

    /**
     * «چه مقدار از این برداشت قبلاً برگشته» را روی همان ترتیبِ ردیف‌ها جلو
     * می‌بریم، پس برگشت‌های جزئیِ پشت‌سرهم هیچ ردیفی را دو بار پر نمی‌کنند.
     */
    let skip = Math.max(0, Math.round(p.alreadyRestored))
    let left = Math.max(0, Math.round(p.qty))

    for (const d of details) {
      if (left <= 0) break
      let capacity = Math.max(0, Math.round(d.taken))
      if (skip >= capacity) {
        skip -= capacity
        continue
      }
      capacity -= skip
      skip = 0
      const give = Math.min(left, capacity)
      if (give <= 0) continue
      const row = await tx.secondaryStockItem.findUnique({ where: { id: d.id } })
      if (row) {
        const before = row.qty
        await tx.secondaryStockItem.update({ where: { id: row.id }, data: { qty: before + give } })
        await this.logRow(tx, {
          row: { id: row.id, name: row.name, code: row.code ?? null, qty: before + give, warehouseId: row.warehouseId ?? null },
          warehouseName,
          action: SecondaryStockAction.SALE_WHOLESALE_RESTORE,
          qtyBefore: before,
          qtyAfter: before + give,
          userId: p.userId ?? null,
          note: `${p.reason}${p.receiptNo ? ` · فاکتور ${faDigits(p.receiptNo)}` : ''} · ${faDigits(give)} عدد برگشت`
        })
        left -= give
      } else {
        await this.restoreByMatch(tx, { ...p, warehouseName, qty: give })
        left -= give
      }
    }

    if (left > 0) await this.restoreByMatch(tx, { ...p, warehouseName, qty: left })
  },

  /** ردیف مبدأ حذف شده بود ⇒ تطبیق متنی در همان انبار، وگرنه ردیف تازه. */
  async restoreByMatch(
    tx: Prisma.TransactionClient,
    p: {
      allocation: any
      qty: number
      variantId: number
      warehouseName: string
      userId?: number | null
      receiptNo?: number | null
      reason: string
    }
  ): Promise<void> {
    const v = (await tx.productVariant.findUnique({
      where: { id: p.variantId },
      select: VARIANT_SELECT
    })) as unknown as VariantInfo | null
    const warehouseId = p.allocation.warehouseId ?? null
    const rows = (await tx.secondaryStockItem.findMany({
      where: { warehouseId },
      select: { id: true, name: true, code: true, qty: true, warehouseId: true }
    })) as unknown as StockRow[]
    const hit = v ? matchedRowsIn(rows, warehouseId, v)[0]?.row : undefined

    if (hit) {
      const before = hit.qty
      await tx.secondaryStockItem.update({ where: { id: hit.id }, data: { qty: before + p.qty } })
      await this.logRow(tx, {
        row: { ...hit, qty: before + p.qty },
        warehouseName: p.warehouseName,
        action: SecondaryStockAction.SALE_WHOLESALE_RESTORE,
        qtyBefore: before,
        qtyAfter: before + p.qty,
        userId: p.userId ?? null,
        note:
          `${p.reason}${p.receiptNo ? ` · فاکتور ${faDigits(p.receiptNo)}` : ''} · ` +
          `ردیف مبدأ پیدا نشد؛ با تطبیق متنی به ردیف «${hit.name}» برگشت`
      })
      return
    }

    const created = await tx.secondaryStockItem.create({
      data: {
        name: v ? variantTitle(v as any) : `کالای ${p.variantId}`,
        code: v?.code ?? null,
        qty: p.qty,
        warehouseId,
        note: `ردیف خودکار: ${p.reason}${p.receiptNo ? ` (فاکتور ${faDigits(p.receiptNo)})` : ''} — ردیف مبدأ دیگر وجود نداشت.`
      }
    })
    await this.logRow(tx, {
      row: { id: created.id, name: created.name, code: created.code ?? null, qty: created.qty, warehouseId: created.warehouseId ?? null },
      warehouseName: p.warehouseName,
      action: SecondaryStockAction.SALE_WHOLESALE_RESTORE,
      qtyBefore: 0,
      qtyAfter: created.qty,
      userId: p.userId ?? null,
      note: `${p.reason}${p.receiptNo ? ` · فاکتور ${faDigits(p.receiptNo)}` : ''} · ردیف مبدأ نبود؛ ردیف تازه ساخته شد`
    })
  },

  /**
   * =========================================================================
   * خواندنِ «خلاصه‌ی کسری‌ها»ی یک فاکتور ثبت‌شده — برای رسید چاپی، فهرست
   * فاکتورهای عمده و گزارش فروش. فقط خواندن.
   * =========================================================================
   */
  async summaryOf(invoiceId: number): Promise<{ groups: ShortageSummaryGroup[]; lines: string[]; short: string }> {
    const rows = await prisma.saleItemStockAllocation.findMany({
      where: { invoiceId },
      orderBy: { id: 'asc' }
    })
    if (!rows.length) return { groups: [], lines: [], short: '' }

    const variantIds = [...new Set(rows.map((r) => r.variantId))]
    const variants = await productVariantsByIds(prisma, variantIds)
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const nameOf = (id: number) => {
      const v = vmap.get(id)
      return v ? variantTitle(v as any) : `کالای ${id}`
    }

    /** ردیف‌های یک کالا از یک منبع، برای خلاصه با هم جمع می‌شوند. */
    const plan: StockAllocationPlan = { lines: [] }
    for (const r of rows) {
      let line = plan.lines.find((l) => l.variantId === r.variantId)
      if (!line) {
        line = { variantId: r.variantId, entries: [] }
        plan.lines.push(line)
      }
      const entry: StockAllocationEntry = {
        kind: r.sourceKind === StockSourceKind.WAREHOUSE ? StockSourceKind.WAREHOUSE : StockSourceKind.STORE,
        warehouseId: r.warehouseId ?? null,
        warehouseName: r.warehouseName || DEFAULT_CENTRAL_WAREHOUSE_LABEL,
        qty: Math.round(r.qty),
        balanceAfter: r.balanceAfter == null ? null : Math.round(r.balanceAfter),
        wentNegative: r.wentNegative === true
      }
      const twin = line.entries.find((e) => optionKey(e) === optionKey(entry))
      if (twin) {
        twin.qty += entry.qty
        // آخرین snapshot معتبرتر است (ردیف‌ها به ترتیب id خوانده شده‌اند)
        twin.balanceAfter = entry.balanceAfter
        twin.wentNegative = twin.wentNegative || entry.wentNegative
      } else line.entries.push(entry)
    }

    const groups = summarizePlan(plan, nameOf)
    return { groups, lines: summaryTextLines(groups, faDigits), short: summaryShortLine(groups, faDigits) }
  },

  /** همان خلاصه، برای چند فاکتور با هم (فهرست فاکتورها و گزارش فروش). */
  async summaryForInvoices(invoiceIds: number[]): Promise<Record<number, { lines: string[]; short: string }>> {
    const out: Record<number, { lines: string[]; short: string }> = {}
    if (!invoiceIds.length) return out
    const rows = await allocationsByInvoiceIds(invoiceIds)
    if (!rows.length) return out

    const variantIds = [...new Set(rows.map((r) => r.variantId))]
    const variants = await productVariantsByIds(prisma, variantIds)
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const nameOf = (id: number) => {
      const v = vmap.get(id)
      return v ? variantTitle(v as any) : `کالای ${id}`
    }

    const byInvoice = new Map<number, StockAllocationPlan>()
    for (const r of rows) {
      let plan = byInvoice.get(r.invoiceId)
      if (!plan) {
        plan = { lines: [] }
        byInvoice.set(r.invoiceId, plan)
      }
      let line = plan.lines.find((l) => l.variantId === r.variantId)
      if (!line) {
        line = { variantId: r.variantId, entries: [] }
        plan.lines.push(line)
      }
      const entry: StockAllocationEntry = {
        kind: r.sourceKind === StockSourceKind.WAREHOUSE ? StockSourceKind.WAREHOUSE : StockSourceKind.STORE,
        warehouseId: r.warehouseId ?? null,
        warehouseName: r.warehouseName || DEFAULT_CENTRAL_WAREHOUSE_LABEL,
        qty: Math.round(r.qty),
        balanceAfter: r.balanceAfter == null ? null : Math.round(r.balanceAfter),
        wentNegative: r.wentNegative === true
      }
      const twin = line.entries.find((e) => optionKey(e) === optionKey(entry))
      if (twin) {
        twin.qty += entry.qty
        twin.balanceAfter = entry.balanceAfter
        twin.wentNegative = twin.wentNegative || entry.wentNegative
      } else line.entries.push(entry)
    }

    for (const [invoiceId, plan] of byInvoice) {
      const groups = summarizePlan(plan, nameOf)
      out[invoiceId] = { lines: summaryTextLines(groups, faDigits), short: summaryShortLine(groups, faDigits) }
    }
    return out
  }
}
