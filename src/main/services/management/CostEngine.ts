/**
 * دفتر هزینه گزارش مدیریت.
 * جهت حرکت انبار: افزایش موجودی = ورود به لات، کاهش = خروج از لات.
 * برگشت به همان لاتی برمی‌گردد که از آن فروخته شده.
 * ویرایش فاکتور فروش اقلام را از نو می‌سازد؛ اینجا قلم بدون فی قفل می‌شود
 * و قلم حذف‌شده به لات برمی‌گردد — بدون دست زدن به SalesService.
 */
import { prisma } from '../../db/client'
import { TX_OPTIONS } from '../../db/tx'
import { allocateLineNet, goodsPayableOf } from '@shared/returnValue'
import { toRial } from '@shared/money'
import { lastPurchaseUnit } from './replacement'
import { activeReturnConsumptions } from './returnShare'
import { faDigits } from '@shared/jalali'

const db = prisma as any
const PAGE = 200
const LOCK_STALE_MS = 120_000

/** کلاینت جاری (داخل تراکنش = tx، بیرون = prisma). */
let cx: any = null
function X(): any {
  return cx ?? prisma
}
function Y(): any {
  return cx ?? db
}

function bi(v: unknown): bigint {
  return toRial(v as any)
}

function isHistoryOnlyMovement(m: { note?: string | null }): boolean {
  return String(m.note || '').includes('فقط سند تاریخی')
}

const pendingReprice = new Set<number>()
const PENDING_KEY = 'mgmt.pendingReprice'
const RECONCILE_ERR_KEY = 'mgmt.reconcileError'
/**
 * B3 (بازبینی نهم) — «هم‌خوان‌سازی ویرایش‌ها» قبلاً یک‌جا روی کل تاریخچه می‌چرخید و
 * همان را داخل **یک تراکنش ۱۵ ثانیه‌ای** (سقف `TX_OPTIONS`) انجام می‌داد: روی دیتابیس
 * چندساله timeout می‌خورد، هر اجرا دوباره می‌خورد، و تا وقتی قفلِ نوشتنِ SQLite دستِ
 * همان تراکنش است ثبتِ فروشِ صندوق هم می‌تواند معطل شود. حالا جارو تکه‌تکه است: هر
 * اجرا یک پنجرهٔ شناسه‌ای از `SaleInvoiceItem` را بررسی می‌کند و مکان‌نمای بعدی را در
 * `Setting` نگه می‌دارد؛ بعد از رسیدن به انتها از اول (تا دادهٔ تازه هم دیده شود).
 * معنا عوض نشده: برای فاکتورهای کاندید، اقلام و ردیف‌های هزینه **کاملِ همان فاکتور**
 * خوانده می‌شود — وگرنه «تطبیق قلمِ ویرایش‌شده با قلمِ تازه» (همان چیزی که فی قفل‌شده
 * را نگه می‌دارد) به‌اسر می‌رفت؛ یعنی رفعِ کندی نباید فیِ یک قلم را جابه‌جا کند.
 */
const RECONCILE_CURSOR_KEY = 'mgmt.reconcileCursor'
const RECONCILE_PAGE_KEY = 'mgmt.reconcilePage'
const RECONCILE_SPAN = 4000
/**
 * B5 (بازبینی دهم) — بودجهٔ زمانیِ هر پنجره. کل جارو داخل یک تراکنش ۱۵ ثانیه‌ای
 * (`TX_OPTIONS`) می‌چرخد؛ اگر روی دیتابیس چندساله از بودجه رد شدیم، همان‌جا
 * می‌ایستیم و مکان‌نما را جلو می‌بریم (چرخه ادواری است، چیزی گم نمی‌شود) — وگرنه
 * تراکنش منقضی می‌شود، کارِ آن دور برمی‌گردد و خطای `reconcileError` تا ابد تکرار
 * می‌شود.
 */
const RECONCILE_BUDGET_MS = 6000
/** کلیدِ تنظیمِ اندازهٔ پنجره و بودجهٔ زمانی (۰ = بی‌سقف) — برای دیتابیس‌های خیلی بزرگ و برای تست. */
const RECONCILE_BUDGET_KEY = 'mgmt.reconcileBudgetMs'
const RECONCILE_BUDGET_ITEMS_KEY = 'mgmt.reconcileBudgetItems'
/**
 * خلاصهٔ آخرین «اصلاح فی فاکتور خرید». عمداً در `Setting` می‌نشیند تا بعد از
 * تمام‌شدن فراخوانی هم برای صفحه قابل نمایش باشد (یادآوری، نه عدد مالی).
 */
const LAST_REPRICE_KEY = 'mgmt.lastReprice'

async function persistLastReprice(info: {
  at: string
  lots: number
  saleItems: number
  replacementFixed: number
  replacementStale: number
}) {
  await prisma.setting
    .upsert({
      where: { key: LAST_REPRICE_KEY },
      create: { key: LAST_REPRICE_KEY, value: JSON.stringify(info) },
      update: { value: JSON.stringify(info) }
    })
    .catch(() => null)
}

async function readLastReprice(): Promise<{
  lots: number
  saleItems: number
  replacementFixed: number
  replacementStale: number
} | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_REPRICE_KEY } }).catch(() => null)
  if (!row?.value) return null
  try {
    const j = JSON.parse(String(row.value))
    if (!j || typeof j !== 'object') return null
    return {
      lots: Number(j.lots ?? 0),
      saleItems: Number(j.saleItems ?? 0),
      replacementFixed: Number(j.replacementFixed ?? 0),
      replacementStale: Number(j.replacementStale ?? 0)
    }
  } catch {
    return null
  }
}

async function hydratePending() {
  const row = await prisma.setting.findUnique({ where: { key: PENDING_KEY } }).catch(() => null)
  if (!row?.value) return
  try {
    const ids = JSON.parse(String(row.value))
    if (Array.isArray(ids)) for (const id of ids) if (Number(id) > 0) pendingReprice.add(Number(id))
  } catch {
    /* نادیده */
  }
}

async function persistPending() {
  const ids = [...pendingReprice]
  await prisma.setting
    .upsert({
      where: { key: PENDING_KEY },
      create: { key: PENDING_KEY, value: JSON.stringify(ids) },
      update: { value: JSON.stringify(ids) }
    })
    .catch(() => null)
}

async function readReconcileCursor(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: RECONCILE_CURSOR_KEY } }).catch(() => null)
  if (!row?.value) return 0
  try {
    const j = JSON.parse(String(row.value))
    return Math.max(0, Number(j?.cur ?? 0) || 0)
  } catch {
    return 0
  }
}

async function persistReconcileCursor(cur: number, maxId: number, span: number, budget = false) {
  const value = JSON.stringify({ cur, maxId, span, budget, at: new Date().toISOString() })
  await prisma.setting
    .upsert({ where: { key: RECONCILE_CURSOR_KEY }, create: { key: RECONCILE_CURSOR_KEY, value }, update: { value } })
    .catch(() => null)
}

/** اندازهٔ پنجره — برای تستِ «تکه‌تکه» و برای تنظیم روی دیتابیس‌های خیلی بزرگ. */
async function readReconcileSpan(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: RECONCILE_PAGE_KEY } }).catch(() => null)
  const raw = Number(row?.value ?? 0) || 0
  if (raw > 0) return Math.min(20000, Math.max(4, Math.round(raw)))
  /**
   * اگر تنظیم دستی‌ای نبود، اندازهٔ پنجره‌ای که خودِ جارو روی مکان‌نما نگه داشته معتبر
   * است (B5 — بعد از مهلک نصف می‌شود)؛ در غیر این صورت اندازهٔ پیش‌فرض.
   */
  const info = await readReconcileInfo()
  const last = Number(info?.span ?? 0) || 0
  if (last > 0 && last < RECONCILE_SPAN) return Math.max(4, last)
  return RECONCILE_SPAN
}

/** B5 — بعد از مهلک، پنجره را نصف کن تا دورِ بعدی داخل ۱۵ ثانیه جا شود. */
async function shrinkReconcileSpan() {
  const info = await readReconcileInfo()
  const cur = Number(info?.cur ?? 0) || 0
  const maxId = Number(info?.maxId ?? 0) || 0
  const last = Number(info?.span ?? 0) || RECONCILE_SPAN
  if (last <= 4) return
  await persistReconcileCursor(cur, maxId, Math.max(4, Math.floor(last / 2)))
}

/**
 * B5 — سقفِ هر دورِ جارو: هم زمانی (`mgmt.reconcileBudgetMs`) و هم تعدادِ فاکتور
 * (`mgmt.reconcileBudgetItems`). صفر یعنی بی‌سقف. سقفِ تعدادی برای این است که روی
 * دیتابیسِ کند «شش ثانیه» هم کم باشد و دور بی‌پایان نچرخد — و همان چیزی است که
 * رفتارِ «این دور نیمه‌کاره ماند» را در تست قطعی می‌سنجد (زمان در تست نوسان دارد).
 */
async function readReconcileLimits(): Promise<{ ms: number; items: number }> {
  const msRow = await prisma.setting.findUnique({ where: { key: RECONCILE_BUDGET_KEY } }).catch(() => null)
  let ms = RECONCILE_BUDGET_MS
  if (msRow?.value) {
    const v = Number(msRow.value)
    if (!Number.isFinite(v) || v < 0) ms = RECONCILE_BUDGET_MS
    else if (v === 0) ms = 0
    // مقادیر ریز (۱..۲۰۰ میلی‌ثانیه) فقط برای تست/عیب‌یابی است — همان مسیرِ کد را می‌رود.
    else ms = Math.min(60000, Math.max(1, Math.round(v)))
  }
  let items = 0
  const itemsRow = await prisma.setting.findUnique({ where: { key: RECONCILE_BUDGET_ITEMS_KEY } }).catch(() => null)
  if (itemsRow?.value) {
    const v = Number(itemsRow.value)
    if (Number.isFinite(v) && v > 0) items = Math.min(10000, Math.round(v))
  }
  return { ms, items }
}

async function readReconcileInfo(): Promise<{ cur: number; maxId: number; span: number; at?: string; budget?: boolean } | null> {
  const row = await prisma.setting.findUnique({ where: { key: RECONCILE_CURSOR_KEY } }).catch(() => null)
  if (!row?.value) return null
  try {
    const j = JSON.parse(String(row.value))
    if (!j || typeof j !== 'object') return null
    return {
      cur: Number(j.cur ?? 0) || 0,
      maxId: Number(j.maxId ?? 0) || 0,
      span: Number(j.span ?? 0) || 0,
      at: j.at ? String(j.at) : undefined,
      budget: !!j.budget
    }
  } catch {
    return null
  }
}

async function persistReconcileError(msg: string) {
  await prisma.setting
    .upsert({
      where: { key: RECONCILE_ERR_KEY },
      create: { key: RECONCILE_ERR_KEY, value: msg },
      update: { value: msg }
    })
    .catch(() => null)
}

/** درآمد سود = سهم قلم از پرداختنی کالا، بدون مالیات و حق سرویس. */
function lineGoodsRevenue(invoice: any, itemId: number, consumeQty: number, lineQty: number): number {
  if (!invoice || lineQty <= 0 || consumeQty <= 0) return 0
  const lineRev = allocateLineNet(invoice as any).get(itemId) ?? 0
  const pay = goodsPayableOf(invoice as any)
  if (pay <= 0) return 0
  const extra =
    Math.max(0, Math.round(Number(invoice.taxTotal ?? 0))) +
    Math.max(0, Math.round(Number(invoice.serviceCharge ?? 0)))
  const goods = Math.max(0, pay - extra)
  return Math.round(lineRev * (goods / pay) * (consumeQty / lineQty))
}

/** `in` بزرگ در SQLite به سقف متغیرها می‌خورد؛ فهرست شناسه را تکه‌تکه می‌کنیم. */
async function chunkMap<T>(ids: number[], size: number, fn: (slice: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  const uniq = [...new Set(ids.map((x) => Number(x)).filter((x) => x > 0))]
  for (let i = 0; i < uniq.length; i += size) {
    const part = await fn(uniq.slice(i, i + size)).catch(() => [] as T[])
    out.push(...(part || []))
  }
  return out
}

async function historyOnlyInvoiceIds(invoiceIds: number[]): Promise<Set<number>> {
  const out = new Set<number>()
  const ids = [...new Set(invoiceIds.filter((id) => Number(id) > 0))]
  if (!ids.length) return out
  const CHUNK = 400
  const by = new Map<number, boolean[]>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const moves = await X()
      .stockMovement.findMany({
        where: { refType: 'SaleInvoice', refId: { in: slice }, reason: { in: ['SALE', 'SALE_EDIT'] } },
        select: { refId: true, note: true }
      })
      .catch(() => [])
    for (const m of moves) {
      const id = Number(m.refId)
      const list = by.get(id) ?? []
      list.push(isHistoryOnlyMovement(m))
      by.set(id, list)
    }
  }
  for (const [id, flags] of by) {
    if (flags.length && flags.every(Boolean)) out.add(id)
  }
  return out
}

/**
 * B4 (بازبینی هشتم) — «آیا این فاکتور واقعاً چیزی از انبار کم کرده؟» از خودِ دفتر
 * پرسیده می‌شود، نه از فرمول تازه: جمع حرکت‌های SALE/SALE_EDITِ **پردازش‌شده**
 * (شناسه‌اش تا `lastMovementId` همین اجرا). سه حالت:
 *   • حرکتی هست ولی صاف شده (ابطال/لغو: منفی + مثبت) ⇒ کسری در کار نیست.
 *   • حرکتی نیست و فاکتور DRAFT/CANCELED است ⇒ هرگز نباید لات مصرف کند.
 *   • حرکتی نیست و فاکتور قطعیِ قدیمی است ⇒ مثل دیروز قفل می‌شود (دادهٔ پیش از فعال‌سازی).
 */
async function saleNetByInvoice(invoiceIds: number[], upToId: number): Promise<Map<number, { neg: number; pos: number }>> {
  const out = new Map<number, { neg: number; pos: number }>()
  const ids = [...new Set(invoiceIds.filter((id) => Number(id) > 0))]
  if (!ids.length) return out
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const moves = await X()
      .stockMovement.findMany({
        where: {
          refType: 'SaleInvoice',
          refId: { in: slice },
          reason: { in: ['SALE', 'SALE_EDIT'] },
          id: { lte: upToId }
        },
        select: { refId: true, delta: true }
      })
      .catch(() => [])
    for (const m of moves) {
      const id = Number(m.refId)
      if (!id) continue
      const cur = out.get(id) ?? { neg: 0, pos: 0 }
      const d = Number(m.delta)
      if (d < 0) cur.neg += -d
      else cur.pos += d
      out.set(id, cur)
    }
  }
  return out
}

/** سهم انبار فروشگاه از قلم؛ بدون ردیف تخصیص = کل قلم از فروشگاه (فاکتورهای قدیمی). */
async function shopConsumeQty(it: { id: number; invoiceId: number; qty: number }): Promise<number> {
  const inv = await X().saleInvoice.findUnique({
    where: { id: it.invoiceId },
    select: { deductInventory: true }
  })
  if (!inv || inv.deductInventory === false) return 0
  const allocs = await X()
    .saleItemStockAllocation.findMany({ where: { saleItemId: it.id }, select: { sourceKind: true, qty: true } })
    .catch(() => [])
  if (!allocs.length) return Math.max(0, Number(it.qty))
  return allocs
    .filter((a: any) => String(a.sourceKind) === 'STORE')
    .reduce((s: number, a: any) => s + Number(a.qty || 0), 0)
}

async function state() {
  let s = await Y().costEngineState.findUnique({ where: { key: 'main' } })
  if (!s) {
    s = await Y().costEngineState.create({
      data: { key: 'main', lastMovementId: 0, openingMode: 'fromActivation', activatedAt: new Date() }
    })
  }
  return s
}

async function consumeFifo(opts: {
  variantId: number
  qty: number
  movementId: number
  kind: string
  saleItemId: number | null
  preferPurchaseId?: number | null
  at?: Date | null
}): Promise<{ fifo: bigint; status: string }> {
  let left = Math.max(0, Math.round(opts.qty))
  let fifo = 0n
  let status = 'EXACT'
  /**
   * B2 + B3 (بازبینی یازدهم) — لاتِ صفرریال (موجودیِ دستیِ پنل کالا بدون فاکتور خرید،
   * یا بدهیِ نیمه‌پر) با برچسب `approx` یعنی «فی‌اش را نمی‌دانیم»، نه «فی تقریبی دارد».
   * تا امروز این ردیف‌ها APPROX می‌شدند و قلم با هزینهٔ صفر داخل سود می‌ماند ⇒ حاشیهٔ
   * ۱۰۰٪ برای مغازه‌ای که موجودی اول را دستی زده، و یادداشتِ صفحه («N قلم فی صفر داشت و
   * از سود کنار گذاشته شد») هم دروغ می‌شد. پس هر واحدِ بی‌فی، وضعیتِ قلم را UNKNOWN
   * می‌کند تا همان گاردِ واقعی رویش بیفتد (و وقتی فاکتور خریدش آمد، خودش برمی‌گردد).
   */
  let zeroFee = false
  if (left <= 0) return { fifo, status }

  const preferred = opts.preferPurchaseId
    ? await Y().purchaseLot.findMany({
        where: { variantId: opts.variantId, purchaseInvoiceId: opts.preferPurchaseId, qtyLeft: { gt: 0 } },
        orderBy: [{ id: 'desc' }]
      })
    : []
  const rest = await Y().purchaseLot.findMany({
    where: {
      variantId: opts.variantId,
      qtyLeft: { gt: 0 },
      ...(opts.preferPurchaseId ? { NOT: { purchaseInvoiceId: opts.preferPurchaseId } } : {})
    },
    orderBy: [{ lotDate: 'asc' }, { id: 'asc' }]
  })
  const lots = [...preferred, ...rest]

  for (const lot of lots) {
    if (left <= 0) break
    const take = Math.min(Number(lot.qtyLeft), left)
    const unit = bi(lot.unitCost)
    await Y().purchaseLot.update({ where: { id: lot.id }, data: { qtyLeft: Number(lot.qtyLeft) - take } })
    await Y().costConsumption.create({
      data: {
        movementId: opts.movementId,
        lotId: lot.id,
        saleItemId: opts.saleItemId,
        qty: take,
        unitCost: unit,
        kind: opts.kind
      }
    })
    fifo += unit * BigInt(take)
    if (lot.approx) status = 'APPROX'
    if (unit === 0n) zeroFee = true
    left -= take
  }
  if (left > 0) {
    const at = opts.at instanceof Date ? opts.at : opts.at ? new Date(opts.at) : new Date()
    // B1 — لاتِ بدهی هم با فیِ «همان روز» بسته می‌شود، نه فیِ لحظهٔ اجرای دفتر.
    const { unit } = await lastPurchaseUnit(opts.variantId, at)
    const lot = await Y().purchaseLot.create({
      data: {
        variantId: opts.variantId,
        qtyIn: 0,
        qtyLeft: -left,
        unitCost: unit,
        lotDate: at,
        source: 'BACKORDER',
        approx: true
      }
    })
    await Y().costConsumption.create({
      data: {
        movementId: opts.movementId,
        lotId: lot.id,
        saleItemId: opts.saleItemId,
        qty: left,
        unitCost: unit,
        kind: opts.kind
      }
    })
    fifo += unit * BigInt(left)
    status = unit === 0n ? 'UNKNOWN' : 'APPROX'
    if (unit === 0n) zeroFee = true
  }
  if (zeroFee) status = 'UNKNOWN'
  return { fifo, status }
}

async function restoreLot(
  lotId: number,
  qty: number,
  movementId: number,
  saleItemId: number | null,
  kind = 'RETURN',
  restored?: { qty: number; fifoCost: bigint }
) {
  const lot = await Y().purchaseLot.findUnique({ where: { id: lotId } })
  if (!lot || qty <= 0) return 0
  const room = Math.max(0, Number(lot.qtyIn) - Number(lot.qtyLeft))
  const take = Math.min(room, qty)
  if (take <= 0) return 0
  const unit = bi(lot.unitCost)
  await Y().purchaseLot.update({ where: { id: lot.id }, data: { qtyLeft: Number(lot.qtyLeft) + take } })
  await Y().costConsumption.create({
    data: {
      movementId,
      lotId: lot.id,
      saleItemId,
      qty: take,
      unitCost: unit,
      kind
    }
  })
  if (restored) {
    restored.qty += take
    restored.fifoCost += unit * BigInt(take)
  }
  return take
}

async function restoreFromSaleItem(
  saleItemId: number,
  qty: number,
  movementId: number,
  kind = 'RETURN',
  restored?: { qty: number; fifoCost: bigint }
) {
  let left = Math.max(0, Math.round(qty))
  const cons = await Y().costConsumption.findMany({
    where: { saleItemId, kind: 'SALE' },
    orderBy: { id: 'desc' }
  })
  const rets = await Y().costConsumption.findMany({
    where: { saleItemId, kind: { in: ['RETURN', 'EDIT_ADJ'] } },
    select: { lotId: true, qty: true, movementId: true, kind: true }
  })
  // برگشتِ مشتری فقط با برگشت‌های معتبر جمع می‌شود؛ اصلاحِ ویرایش هم برای جلوگیری
  // از بازگرداندن دوبارهٔ همان واحد، سهمِ لاتِ قبلاً اصلاح‌شده را اشغال می‌کند.
  const activeRets = await activeReturnConsumptions(Y(), rets.filter((r: any) => String(r.kind) === 'RETURN') as any[])
  const already = new Map<number, number>()
  for (const r of activeRets.rows) already.set(Number(r.lotId), (already.get(Number(r.lotId)) ?? 0) + Number(r.qty))
  for (const r of rets) {
    if (String(r.kind) !== 'EDIT_ADJ') continue
    already.set(Number(r.lotId), (already.get(Number(r.lotId)) ?? 0) + Number(r.qty))
  }
  for (const c of cons) {
    if (left <= 0) break
    const avail = Math.max(0, Number(c.qty) - (already.get(c.lotId) ?? 0))
    if (avail <= 0) continue
    const take = await restoreLot(c.lotId, Math.min(left, avail), movementId, saleItemId, kind, restored)
    already.set(c.lotId, (already.get(c.lotId) ?? 0) + take)
    left -= take
  }
  return left
}

async function restoreFromReturn(m: {
  id: number
  variantId: number
  delta: number
  refId: number | null
  createdAt?: Date
}) {
  const qty = Math.max(0, Number(m.delta))
  if (qty <= 0) return
  const returnId = m.refId && Number(m.refId) > 0 ? Number(m.refId) : null
  if (!returnId) {
    // B8 — تاریخ لاتِ بازگشتی همان تاریخ حرکت است نه «الان» (مثل restoreFromSaleInvoice).
    await restoreFifoFallback(m.variantId, qty, m.id, m.createdAt)
    return
  }
  const items = await X().saleReturnItem.findMany({
    where: { returnId, variantId: m.variantId }
  })
  let left = qty
  for (const it of items) {
    if (left <= 0) break
    const take = Math.min(left, Number(it.qty))
    const remain = await restoreFromSaleItem(it.saleItemId, take, m.id)
    left -= take - remain
  }
  // B8 — بقیه‌ی جا‌مانده هم با تاریخ حرکت ثبت می‌شود تا ترتیب FIFO به هم نریزد.
  if (left > 0) await restoreFifoFallback(m.variantId, left, m.id, m.createdAt)
}

async function restoreFifoFallback(variantId: number, qty: number, movementId: number, at?: Date | null, kind = 'RETURN') {
  let left = Math.max(0, Math.round(qty))
  const lots = await Y().purchaseLot.findMany({
    where: { variantId },
    orderBy: [{ lotDate: 'desc' }, { id: 'desc' }]
  })
  for (const lot of lots) {
    if (left <= 0) break
    const take = await restoreLot(lot.id, left, movementId, null, kind)
    left -= take
  }
  if (left > 0) {
    const when = at instanceof Date ? at : at ? new Date(at) : new Date()
    // B1 — این لات «امروزِ» قفسه را برای یک حرکتِ گذشته می‌سازد؛ فی‌اش هم باید فیِ
    // همان روز باشد، وگرنه «بازسازی دفتر» عددِ تاریخچه را با قیمتِ امروز بازنویسی می‌کند.
    const { unit } = await lastPurchaseUnit(variantId, when)
    await Y().purchaseLot.create({
      data: {
        variantId,
        qtyIn: left,
        qtyLeft: left,
        unitCost: unit,
        lotDate: when,
        source: 'NO_INVOICE',
        approx: true
      }
    })
  }
}

async function restoreExternalSync(m: { id: number; variantId: number; delta: number; refId: number | null; createdAt?: Date }) {
  let left = Math.max(0, Number(m.delta))
  if (left <= 0) return
  const event = m.refId ? await Y().wooInboundEvent.findUnique({ where: { id: Number(m.refId) } }).catch(() => null) : null
  const orderId = event?.orderId ? String(event.orderId) : ''
  if (!event || !orderId) {
    await restoreFifoFallback(m.variantId, left, m.id, m.createdAt, 'EXTERNAL_SYNC')
    return
  }
  const orderItemId = event.orderItemId ? String(event.orderItemId) : null
  const whereKey: any = { variantId: m.variantId, orderId, movementId: { not: null } }
  if (orderItemId) whereKey.orderItemId = orderItemId
  const [outs, ins] = await Promise.all([
    Y().wooInboundEvent.findMany({ where: { ...whereKey, delta: { lt: 0 } }, select: { movementId: true }, orderBy: { id: 'asc' } }),
    Y().wooInboundEvent.findMany({ where: { ...whereKey, delta: { gt: 0 }, id: { not: event.id } }, select: { movementId: true } })
  ])
  const outMovementIds = outs.map((x: any) => Number(x.movementId)).filter((x: number) => Number.isFinite(x) && x > 0)
  if (!outMovementIds.length) {
    await restoreFifoFallback(m.variantId, left, m.id, m.createdAt, 'EXTERNAL_SYNC')
    return
  }
  const inMovementIds = ins.map((x: any) => Number(x.movementId)).filter((x: number) => Number.isFinite(x) && x > 0)
  const [consumed, restoredRows] = await Promise.all([
    Y().costConsumption.findMany({ where: { movementId: { in: outMovementIds }, kind: 'EXTERNAL_SYNC' }, orderBy: { id: 'asc' } }),
    inMovementIds.length ? Y().costConsumption.findMany({ where: { movementId: { in: inMovementIds }, kind: 'EXTERNAL_SYNC' }, select: { lotId: true, qty: true } }) : Promise.resolve([])
  ])
  const already = new Map<number, number>()
  for (const r of restoredRows as any[]) already.set(Number(r.lotId), (already.get(Number(r.lotId)) ?? 0) + Number(r.qty || 0))
  for (const c of consumed) {
    if (left <= 0) break
    const lotId = Number(c.lotId)
    const avail = Math.max(0, Number(c.qty || 0) - (already.get(lotId) ?? 0))
    if (avail <= 0) continue
    const take = await restoreLot(lotId, Math.min(left, avail), m.id, null, 'EXTERNAL_SYNC')
    already.set(lotId, (already.get(lotId) ?? 0) + take)
    left -= take
  }
  if (left > 0) await restoreFifoFallback(m.variantId, left, m.id, m.createdAt, 'EXTERNAL_SYNC')
}


async function restoreFromSaleInvoice(m: {
  id: number
  variantId: number
  delta: number
  refId: number | null
  createdAt?: Date
}) {
  const qty = Math.max(0, Number(m.delta))
  if (qty <= 0) return
  const invoiceId = m.refId && Number(m.refId) > 0 ? Number(m.refId) : null
  if (!invoiceId) {
    await restoreFifoFallback(m.variantId, qty, m.id, m.createdAt)
    return
  }
  const items = await X().saleInvoiceItem.findMany({
    where: { invoiceId, variantId: m.variantId },
    select: { id: true, qty: true }
  })
  let left = qty
  for (const it of items) {
    if (left <= 0) break
    const take = Math.min(left, Number(it.qty))
    const remain = await restoreFromSaleItem(it.id, take, m.id)
    left -= take - remain
  }
  if (left > 0) await restoreFifoFallback(m.variantId, left, m.id, m.createdAt)
}

async function unitCostFromPurchase(invoiceId: number, variantId: number) {
  const inv = await X().purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: { items: true }
  })
  const items = (inv?.items ?? []).filter((it: any) => it.variantId === variantId)
  if (!inv || !items.length) {
    const r = await lastPurchaseUnit(variantId)
    return { unit: r.unit, approx: true }
  }
  const qty = items.reduce((s: number, it: any) => s + Number(it.qty), 0)
  if (qty <= 0) return { unit: 0n, approx: true }
  let cost = items.reduce((s: bigint, it: any) => s + bi(it.lineTotal), 0n)
  const goods = bi(inv.goodsTotal)
  const grand = bi(inv.grandTotal)
  if (goods > 0n && grand >= 0n && grand !== goods) cost = (cost * grand) / goods
  return { unit: cost / BigInt(qty), approx: false }
}

/**
 * B3-lite (بازبینی دوازدهم) — «کسریِ دستی را بعداً با اصلاحِ مثبت جبران کردی» (تایپِ اشتباهِ همان
 * روز که یک عدد را ۵− زدی و بعد ۵+ کردی): مصرفِ همان حرکتِ منفی در `costConsumption` نوشته شده و
 * بهای واقعیِ جنسی که از قفسه رفته را می‌داند. تا پیش از این، ورودِ جبرانی لاتِ تازه‌ای با «فیِ آخرین
 * خریدِ همان روز» (و اگر فاکتوری نبود، فیِ کارتِ کالا) می‌ساخت — یعنی همان جنس با بهای دیگری دوباره
 * روی قفسه می‌نشست و ارزشِ موجودی/سودِ جایگزینیِ بعدی کج می‌شد.
 *
 * عمداً فقط در حالتِ **بدون‌ابهام** قیمت از مصرف برداشته می‌شود: دقیقاً یک حرکتِ منفیِ هم‌کالا و
 * هم‌دلیل در ۲۴ ساعتِ قبل، با تعدادِ مساوی، که ردیف‌های مصرفش هست. «جفت‌کردنِ حدسی» وقتی چند اصلاح
 * روی یک کالا باشد فیِ اشتباه روی موجودی می‌گذارد — خطرناک‌تر از خودِ مشکل — پس بقیهٔ حالت‌ها مثلِ
 * قبل می‌مانند. مصرفِ لات‌ها دست‌نخورده است (برگرداندنِ ردیفِ مصرف، ترتیبِ FIFO را به هم می‌ریزد —
 * چیزی که مالکِ داده نخواسته).
 */
async function compensatingShrinkUnit(m: {
  variantId: number
  delta: number
  reason?: string
  createdAt: Date
}): Promise<bigint | null> {
  const reason = String(m.reason || '')
  if (reason !== 'ADJUSTMENT' && reason !== 'STOCKTAKE') return null
  const qty = Math.max(0, Math.round(Number(m.delta) || 0))
  if (!qty) return null
  const at = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt as any)
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null
  const negs = await Y()
    .stockMovement.findMany({
      where: {
        variantId: m.variantId,
        reason,
        delta: { lt: 0 },
        state: 'FINAL',
        createdAt: { gte: new Date(at.getTime() - 24 * 3600 * 1000), lte: at }
      },
      select: { id: true, delta: true },
      take: 4
    })
    .catch(() => [] as any[])
  const cand = (negs as any[]).filter((x) => Math.abs(Number(x.delta)) === qty)
  if (cand.length !== 1) return null
  const cons = await Y()
    .costConsumption.findMany({
      where: { movementId: Number(cand[0].id) },
      select: { qty: true, unitCost: true }
    })
    .catch(() => [] as any[])
  if (!cons.length) return null
  let cost = 0n
  let taken = 0
  for (const c of cons as any[]) {
    if (taken >= qty) break
    const part = Math.min(Math.round(Number(c.qty) || 0), qty - taken)
    if (part <= 0) continue
    cost += bi(c.unitCost) * BigInt(part)
    taken += part
  }
  if (taken <= 0) return null
  return cost / BigInt(taken)
}

async function applyPurchase(m: {
  id: number
  variantId: number
  delta: number
  refId: number | null
  createdAt: Date
  reason?: string
}) {
  const qty = Math.max(0, Number(m.delta))
  if (qty <= 0) return
  const invoiceId = m.refId && Number(m.refId) > 0 ? Number(m.refId) : null
  const at = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)
  // B1 — «ادیتِ موجودیِ دیروز که امروز پردازش می‌شود» نباید فیِ امروز بخورد.
  const { unit, approx } = invoiceId
    ? await unitCostFromPurchase(invoiceId, m.variantId)
    : await (async () => {
        const back = await compensatingShrinkUnit(m)
        if (back != null && back > 0n) return { unit: back, approx: true }
        return { unit: (await lastPurchaseUnit(m.variantId, at)).unit, approx: true }
      })()
  let incoming = qty
  const debts = await Y().purchaseLot.findMany({
    where: { variantId: m.variantId, source: 'BACKORDER', qtyLeft: { lt: 0 } },
    orderBy: [{ id: 'asc' }]
  })
  for (const d of debts) {
    if (incoming <= 0) break
    const need = -Number(d.qtyLeft)
    const take = Math.min(need, incoming)
    const filled = await Y().purchaseLot.create({
      data: {
        purchaseInvoiceId: invoiceId,
        variantId: m.variantId,
        qtyIn: take,
        qtyLeft: 0,
        unitCost: unit,
        lotDate: at,
        source: invoiceId ? 'PURCHASE' : 'NO_INVOICE',
        approx
      }
    })
    let left = take
    const cons = await Y().costConsumption.findMany({
      where: { lotId: d.id, kind: 'SALE' },
      orderBy: { id: 'asc' }
    })
    const touched = new Set<number>()
    for (const c of cons) {
      if (left <= 0) break
      const part = Math.min(Number(c.qty), left)
      if (part <= 0) continue
      if (part === Number(c.qty)) {
        await Y().costConsumption.update({ where: { id: c.id }, data: { lotId: filled.id, unitCost: unit } })
      } else {
        await Y().costConsumption.update({ where: { id: c.id }, data: { qty: Number(c.qty) - part } })
        await Y().costConsumption.create({
          data: {
            movementId: c.movementId,
            lotId: filled.id,
            saleItemId: c.saleItemId,
            qty: part,
            unitCost: unit,
            kind: 'SALE'
          }
        })
      }
      left -= part
      if (c.saleItemId) touched.add(c.saleItemId)
    }
    for (const id of touched) await recalcSaleItemFifo(id)
    await Y().purchaseLot.update({
      where: { id: d.id },
      data: { qtyLeft: Number(d.qtyLeft) + take }
    })
    incoming -= take
  }
  if (incoming <= 0) return
  await Y().purchaseLot.create({
    data: {
      purchaseInvoiceId: invoiceId,
      variantId: m.variantId,
      qtyIn: incoming,
      qtyLeft: incoming,
      unitCost: unit,
      lotDate: at,
      source: invoiceId ? 'PURCHASE' : 'NO_INVOICE',
      approx
    }
  })
}

async function recalcSaleItemFifo(saleItemId: number) {
  const rows = await Y().costConsumption.findMany({ where: { saleItemId, kind: 'SALE' } })
  if (!rows.length) return
  let fifo = 0n
  let status = 'EXACT'
  let zeroFee = false
  /**
   * بازبینی (B6) — لات‌ها یک‌جا خوانده می‌شوند. قبلاً به‌ازای هر ردیف مصرف یک
   * `findUnique` جدا اجرا می‌شد؛ روی دفتر پرفروش همین حلقه، زمان «بازسازی دفتر»
   * را چند برابر می‌کرد. خروجی (fifoCost و costStatus) کلم‌به‌کلم همان است.
   */
  const lotIds = [...new Set(rows.map((r: any) => Number(r.lotId)).filter((id: number) => id > 0))]
  const lotRows = lotIds.length ? await Y().purchaseLot.findMany({ where: { id: { in: lotIds } } }) : []
  const lotById = new Map<number, any>(lotRows.map((l: any) => [Number(l.id), l]))
  for (const r of rows) {
    const unit = bi(r.unitCost)
    fifo += unit * BigInt(Number(r.qty))
    const lot = lotById.get(Number(r.lotId))
    if (lot?.approx || lot?.source === 'BACKORDER' || lot?.source === 'NO_INVOICE') status = 'APPROX'
    // B3 — «یک عدد از سه عددِ بدهی پر شد» نباید قلم را از UNKNOWN به APPROX بر گرداند:
    // تا وقتی حتی یک واحد بی‌فی است، نیمی از هزینه هنوز مجهول است.
    if (unit === 0n) zeroFee = true
  }
  const editRestores = await Y().costConsumption.findMany({ where: { saleItemId, kind: 'EDIT_ADJ' } })
  for (const r of editRestores) fifo -= bi(r.unitCost) * BigInt(Number(r.qty))
  if (fifo < 0n) fifo = 0n
  if (zeroFee) status = 'UNKNOWN'
  await Y().saleItemCost.update({ where: { saleItemId }, data: { fifoCost: fifo, costStatus: status } }).catch(() => null)
}

async function latestSaleEditMovement(invoiceId: number, variantId: number, direction: 'increase' | 'decrease' | 'any' = 'any') {
  const delta = direction === 'increase' ? { lt: 0 } : direction === 'decrease' ? { gt: 0 } : undefined
  return X()
    .stockMovement.findFirst({
      where: {
        refType: 'SaleInvoice',
        refId: invoiceId,
        variantId,
        reason: 'SALE_EDIT',
        ...(delta ? { delta } : {})
      },
      orderBy: { id: 'desc' },
      select: { id: true, delta: true, createdAt: true }
    })
    .catch(() => null)
}

function mergedCostStatus(a: string, b: string): string {
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 'UNKNOWN'
  if (a === 'APPROX' || b === 'APPROX') return 'APPROX'
  return 'EXACT'
}

/**
 * اختلافِ سهمِ انبارِ یک قلمِ ویرایش‌شده را به‌صورت delta تطبیق می‌دهد: فیِ واحدهای
 * قبلی می‌ماند، واحد افزوده‌شده از لاتِ تاریخ SALE_EDIT می‌آید، و واحد حذف‌شده همان
 * مصرفِ FIFO را به لات برمی‌گرداند (با EDIT_ADJ، نه برگشتِ مشتری).
 */
async function adjustSaleItemCostForEdit(
  it: { id: number; invoiceId: number; variantId: number; qty: number },
  cost: any,
  invoice: any,
  targetQty: number,
  movement: any,
  sourceItemId = it.id
) {
  const outside = String(cost.costStatus) === 'OUTSIDE'
  const oldQty = outside ? 0 : Math.max(0, Math.round(Number(cost.qty) || 0))
  const qty = Math.max(0, Math.round(targetQty))
  const atValue = movement?.createdAt ?? invoice?.issuedAt
  const at = atValue instanceof Date ? atValue : atValue ? new Date(atValue) : new Date()
  const movementId = Number(movement?.id ?? 0)
  let fifoCost = outside ? 0n : bi(cost.fifoCost)
  let replacementCost = outside ? 0n : bi(cost.replacementCost)
  let costStatus = outside ? 'EXACT' : String(cost.costStatus || 'EXACT')
  let replacementSource = String(cost.replacementSource || 'LEGACY')
  let replacementPurchaseInvoiceId =
    cost.replacementPurchaseInvoiceId == null ? null : Number(cost.replacementPurchaseInvoiceId)

  if (qty > oldQty) {
    const add = qty - oldQty
    const added = await consumeFifo({
      variantId: it.variantId,
      qty: add,
      movementId,
      kind: 'SALE',
      saleItemId: it.id,
      at
    })
    const replacement = await lastPurchaseUnit(it.variantId, at)
    fifoCost += added.fifo
    replacementCost += replacement.unit * BigInt(add)
    costStatus = oldQty > 0 ? mergedCostStatus(costStatus, added.status) : added.status
    if (oldQty <= 0) {
      replacementSource = replacement.source
      replacementPurchaseInvoiceId = replacement.purchaseInvoiceId
    } else if (
      replacementSource !== replacement.source ||
      (replacement.source === 'PURCHASE_INVOICE' && replacementPurchaseInvoiceId !== replacement.purchaseInvoiceId)
    ) {
      // یک ردیف SaleItemCost فقط یک شناسهٔ منبع دارد؛ MIXED علامت می‌زند که repricing
      // باید سهم هر SALE/SALE_EDIT را از تاریخ حرکت خودش بازسازی کند.
      replacementSource = 'MIXED'
      replacementPurchaseInvoiceId = null
    }
  } else if (qty < oldQty) {
    const remove = oldQty - qty
    const restored = { qty: 0, fifoCost: 0n }
    await restoreFromSaleItem(sourceItemId, remove, movementId, 'EDIT_ADJ', restored)
    fifoCost -= restored.fifoCost
    const removedReplacement = (replacementCost * BigInt(remove)) / BigInt(oldQty || 1)
    replacementCost -= removedReplacement
    if (fifoCost < 0n) fifoCost = 0n
    if (replacementCost < 0n) replacementCost = 0n
  }

  return {
    qty,
    fifoCost,
    replacementCost,
    revenue: BigInt(lineGoodsRevenue(invoice, it.id, qty, Number(it.qty) || qty)),
    costStatus,
    replacementSource,
    replacementPurchaseInvoiceId
  }
}

async function lockSaleItem(
  it: { id: number; invoiceId: number; variantId: number; qty: number },
  movementId: number,
  consumeQty?: number,
  atOverride?: Date | null
) {
  const exists = await Y().saleItemCost.findUnique({ where: { saleItemId: it.id } })
  if (exists) return
  const invoice = await X().saleInvoice.findUnique({
    where: { id: it.invoiceId },
    include: { items: true }
  })
  const lineQty = Number(it.qty)
  const deduct = invoice?.deductInventory !== false
  const q =
    consumeQty != null
      ? Math.max(0, Math.round(consumeQty))
      : deduct
        ? await shopConsumeQty(it)
        : 0
  const rev = invoice ? lineGoodsRevenue(invoice, it.id, q, lineQty) : 0
  const at =
    atOverride instanceof Date
      ? atOverride
      : invoice?.issuedAt instanceof Date
        ? invoice.issuedAt
        : invoice?.issuedAt
          ? new Date(invoice.issuedAt)
          : new Date()
  if (q <= 0) {
    await Y().saleItemCost.create({
      data: {
        saleItemId: it.id,
        invoiceId: it.invoiceId,
        variantId: it.variantId,
        qty: lineQty,
        fifoCost: 0n,
        replacementCost: 0n,
        revenue: 0n,
        costStatus: 'OUTSIDE',
        lockedAt: new Date()
      }
    })
    return
  }
  /**
   * B1 (بازبینی یازدهم) — `at` تاریخِ خودِ فاکتور فروش است، پس «سود جایگزینی» و
   * «سود تورمی» یک قلم دیگر بستگی به این ندارد که دفتر کِی به آن قلم رسیده (تب سود
   * امروز باز شود یا شش ماه بعد، یا «بازسازی دفتر» زده شود): همان عدد در می‌آید.
   * قاعدهٔ مالک دست‌نخورده — «فی لحظهٔ قفل» برای کالای رفته؛ «امروز» فقط ارزش
   * ماندهٔ قفسه است که آن از این تابع بدون `asOf` خوانده می‌شود.
   */
  const {
    unit: replUnit,
    source: replacementSource,
    purchaseInvoiceId: replacementPurchaseInvoiceId
  } = await lastPurchaseUnit(it.variantId, at)
  const { fifo, status } = await consumeFifo({
    variantId: it.variantId,
    qty: q,
    movementId,
    kind: 'SALE',
    saleItemId: it.id,
    at
  })
  await Y().saleItemCost.create({
    data: {
      saleItemId: it.id,
      invoiceId: it.invoiceId,
      variantId: it.variantId,
      qty: q,
      fifoCost: fifo,
      replacementCost: replUnit * BigInt(q),
      replacementSource,
      replacementPurchaseInvoiceId,
      revenue: BigInt(rev),
      costStatus: status,
      lockedAt: new Date()
    }
  })
}

async function applySale(m: { id: number; variantId: number; delta: number; refId: number | null; createdAt?: Date }) {
  let qty = Math.max(0, -Number(m.delta))
  if (qty <= 0) return
  const invoiceId = m.refId && Number(m.refId) > 0 ? Number(m.refId) : null
  if (!invoiceId) {
    await consumeFifo({
      variantId: m.variantId,
      qty,
      movementId: m.id,
      kind: 'SALE',
      saleItemId: null,
      at: m.createdAt
    })
    return
  }
  const invoice = await X().saleInvoice.findUnique({
    where: { id: invoiceId },
    include: { items: true }
  })
  if (!invoice) {
    await consumeFifo({
      variantId: m.variantId,
      qty,
      movementId: m.id,
      kind: 'SALE',
      saleItemId: null,
      at: m.createdAt
    })
    return
  }
  const items = invoice.items.filter((it: any) => it.variantId === m.variantId)
  const storeWantByItem = new Map<number, number>()
  let currentStoreQty = 0
  for (const it of items) {
    const storeWant = await shopConsumeQty(it)
    storeWantByItem.set(Number(it.id), storeWant)
    currentStoreQty += Math.min(Math.max(0, Number(it.qty) || 0), storeWant)
  }

  let hasSaleEdits = false
  // معمولاً فروشِ پایه با سهمِ جاری یکی است و اصلاً کوئریِ اضافه لازم ندارد. فقط وقتی
  // حرکت از تصویرِ جاری بزرگ‌تر است (کاهش/حذفِ پیش از اولین اجرا)، تغییرهای بعدی را
  // می‌خوانیم تا واحدهای افزوده و برگشتی دوباره‌شماری نشوند.
  if (qty > currentStoreQty) {
    const laterEdits = await X().stockMovement.findMany({
      where: {
        refType: 'SaleInvoice',
        refId: invoiceId,
        variantId: m.variantId,
        reason: 'SALE_EDIT',
        id: { gt: m.id }
      },
      orderBy: { id: 'asc' },
      select: { delta: true, note: true }
    })
    const saleEdits = laterEdits.filter((edit: any) => !isHistoryOnlyMovement(edit))
    hasSaleEdits = saleEdits.length > 0
    // کاهش بعدی ابتدا واحدهایی را خنثی می‌کند که ویرایش قبلی افزوده بود؛ فقط اگر از آن
    // واحدها بیشتر کم شود، سهمِ فروشِ پایه پایین می‌آید.
    const pendingAdds: number[] = []
    for (const edit of saleEdits) {
      const delta = Math.round(Number(edit.delta) || 0)
      if (delta < 0) {
        pendingAdds.push(-delta)
        continue
      }
      let remove = delta
      for (let i = pendingAdds.length - 1; i >= 0 && remove > 0; i--) {
        const take = Math.min(pendingAdds[i], remove)
        pendingAdds[i] -= take
        remove -= take
      }
      if (remove > 0) qty = Math.max(0, qty - remove)
    }
  }
  if (qty <= 0) return

  let remaining = qty
  for (const it of items) {
    const exists = await Y().saleItemCost.findUnique({ where: { saleItemId: it.id } })
    if (exists) {
      remaining -= exists.costStatus === 'OUTSIDE' ? 0 : Number(exists.qty)
      continue
    }
    const storeWant = storeWantByItem.get(Number(it.id)) ?? 0
    const take = Math.min(storeWant, Number(it.qty), Math.max(0, remaining))
    await lockSaleItem(it, m.id, take)
    remaining -= take
  }
  if (remaining > 0 && !hasSaleEdits) {
    // داده‌های قدیمیِ بدون SALE_EDIT همان رفتار قبلی را نگه می‌دارند؛ وقتی حرکتِ ویرایش
    // هست، اختلاف فقط با ردیف‌های جاری reconcile می‌شود و بی‌صاحب مصرف نمی‌گردد.
    await consumeFifo({
      variantId: m.variantId,
      qty: remaining,
      movementId: m.id,
      kind: 'SALE',
      saleItemId: null,
      at: m.createdAt
    })
  }
}

/**
 * اقلامِ فاکتورِ ویرایش‌شده را با سهمِ جاری STORE تطبیق می‌دهد. واحدهای مانده فی قفل‌شده
 * را نگه می‌دارند؛ delta افزوده با تاریخ SALE_EDIT از FIFO می‌آید و delta حذف‌شده به لات
 * قبلی برمی‌گردد. ویرایشِ بدون حرکت انباری (مثل تخفیف) فقط ردیف هزینه را به قلم تازه
 * وصل و درآمدش را به‌روز می‌کند.
 */
async function reconcileSaleEdits() {
  /**
   * B5 — این تابع داخل **یک** تراکنش روی کل `SaleInvoiceItem` می‌چرخد و تا امروز
   * هیچ ضربانی نمی‌زد؛ بعد از `LOCK_STALE_MS` (۱۲۰ ثانیه) قفل «کهنه» حساب می‌شد
   * و اجرای دوم می‌توانست همان لحظه قفل را بگیرد. حالا هر ۲۰۰ ردیف، ضربان روی
   * همان اتصالِ تراکنش نوشته می‌شود (نه اتصال بیرون، تا قفل SQLite قفل نشود) و
   * اگر هر طور نشد، بی‌صدا رد می‌شویم — وضعیت بدتر از امروز نمی‌شود.
   */
  let beatCount = 0
  /** B5 — بودجهٔ زمانیِ همین پنجره (تقریبی؛ فقط برای ایستادنِ مؤدبانه). */
  const t0 = Date.now()
  let overBudget = false
  let invDone = 0
  const keepLockAlive = async () => {
    if (++beatCount % 200 !== 0) return
    try {
      await Y().costEngineLock.upsert({
        where: { key: 'main' },
        create: { key: 'main', busyAt: new Date() },
        update: { busyAt: new Date() }
      })
    } catch {
      /* قفل داخل تراکنش نوشته نشد؛ همان رفتار قبل */
    }
  }
  const span = await readReconcileSpan()
  const { ms: budgetMs, items: budgetItems } = await readReconcileLimits()
  const headRow = await X().saleInvoiceItem.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
  const maxId = Number(headRow?.id ?? 0)
  // maxIdِ دور قبل high-water است: هر قلمی که از آن زمان ساخته شده، به‌ویژه قلم
  // تازه‌ای که ویرایش فاکتور ساخته، جلوتر از پنجرهٔ چرخشی بررسی می‌شود.
  const previousMaxId = Number((await readReconcileInfo())?.maxId ?? 0)
  let cur = await readReconcileCursor()
  if (!(cur > 0) || cur >= maxId) cur = 0
  const winHi = cur + span
  const winItems = maxId
    ? await X().saleInvoiceItem.findMany({
        where: { id: { gt: cur, lte: winHi } },
        orderBy: { id: 'asc' },
        select: { id: true, invoiceId: true, variantId: true, qty: true }
      })
    : []
  const hi = winItems.length ? Math.max(cur, Number(winItems[winItems.length - 1].id)) : winHi
  /**
   * B2 — ردیف‌های تازه‌ساخته‌شده از maxId قبلی یک «صفِ جلوتر از پنجره» می‌سازند.
   * تخفیف‌ویرایش ممکن است هیچ حرکت انباری نسازد، اما SaleInvoiceItem را از نو می‌سازد؛
   * این high-water بدون تغییر SalesService همان فاکتور را در اجرای بعدی پیدا می‌کند.
   * سقف ۴۰۰۰، هزینهٔ مسیر فوری را محدود می‌کند؛ جاروی چرخشی بقیه را همچنان می‌بیند.
   */
  const priorityItems: any[] =
    maxId > previousMaxId
      ? await X().saleInvoiceItem.findMany({
          where: { id: { gt: Math.max(0, previousMaxId), lte: maxId } },
          orderBy: { id: 'desc' },
          take: RECONCILE_SPAN,
          select: { id: true, invoiceId: true, variantId: true, qty: true }
        })
      : []
  const priorityInvIds = [...new Set<number>(priorityItems.map((i: any) => Number(i.invoiceId)).filter((id: number) => id > 0))]
  await keepLockAlive()
  const winCosts = await Y().saleItemCost.findMany({ where: { saleItemId: { gt: cur, lte: hi } } })
  const liveWin = new Set(winItems.map((i: any) => Number(i.id)))
  const hasCostWin = new Set(winCosts.map((c: any) => Number(c.saleItemId)))
  const candInvIds = [
    ...new Set<number>([
      ...winCosts.filter((c: any) => !liveWin.has(Number(c.saleItemId))).map((c: any) => Number(c.invoiceId)),
      ...winItems.filter((i: any) => !hasCostWin.has(Number(i.id))).map((i: any) => Number(i.invoiceId))
    ])
  ].filter((id) => id > 0)
  const scanInvIds = [...new Set<number>([...candInvIds, ...priorityInvIds])]
  /**
   * پنجره فقط «کاندید» را پیدا می‌کند؛ تصویرِ کاملِ همان فاکتورها دوباره خوانده می‌شود.
   * دلیل: در فاکتورِ ویرایش‌شده قلمِ کهنه (با ردیف هزینه) و قلمِ تازه دو شناسهٔ دور از
   * هم‌اند؛ اگر فقط پنجره را می‌دیدیم، تطبیقِ «همان کالا و همان تعداد ⇒ همان فی قفل»
   * شکست می‌خورد و قلم از لاتِ امروز دوباره فی می‌گرفت — یعنی رفعِ کندی، عدد را عوض
   * می‌کرد. این‌جا اولویتِ درستیِ عدد بر سرعت، با هزینهٔ یک کوئری اضافه حفظ شده است.
   */
  const invItems: any[] = scanInvIds.length
    ? await chunkMap<any>(scanInvIds, 400, (slice) =>
        X().saleInvoiceItem.findMany({
          where: { invoiceId: { in: slice } },
          select: { id: true, invoiceId: true, variantId: true, qty: true }
        })
      )
    : []
  const invCosts: any[] = scanInvIds.length
    ? await chunkMap<any>(scanInvIds, 400, (slice) => Y().saleItemCost.findMany({ where: { invoiceId: { in: slice } } }))
    : []
  const byId = new Map<number, any>()
  for (const i of [...winItems, ...invItems]) byId.set(Number(i.id), i)
  const items = [...byId.values()]
  /** سهمِ فروشگاهِ هر قلم، یک‌بار برای هر قلم (حلقهٔ تطبیق و حلقهٔ قفل همان را می‌خوانند). */
  const shopQtyOf = new Map<number, number>()
  const itemsByInv = new Map<number, any[]>()
  for (const i of items) {
    const list = itemsByInv.get(Number(i.invoiceId)) ?? []
    list.push(i)
    itemsByInv.set(Number(i.invoiceId), list)
  }
  const costsByInv = new Map<number, any[]>()
  for (const c of invCosts) {
    const list = costsByInv.get(Number(c.invoiceId)) ?? []
    list.push(c)
    costsByInv.set(Number(c.invoiceId), list)
  }
  const orphansByInv = new Map<number, any[]>()
  const newbornsByInv = new Map<number, any[]>()
  for (const invoiceId of scanInvIds) {
    const its = itemsByInv.get(invoiceId) ?? []
    const cs = costsByInv.get(invoiceId) ?? []
    const ids = new Set(its.map((i: any) => Number(i.id)))
    const costIds = new Set(cs.map((c: any) => Number(c.saleItemId)))
    for (const c of cs) {
      if (ids.has(Number(c.saleItemId))) continue
      const list = orphansByInv.get(invoiceId) ?? []
      list.push(c)
      orphansByInv.set(invoiceId, list)
    }
    for (const it of its) {
      if (costIds.has(Number(it.id))) continue
      const list = newbornsByInv.get(invoiceId) ?? []
      list.push(it)
      newbornsByInv.set(invoiceId, list)
    }
  }
  const invIds = new Set<number>([...orphansByInv.keys(), ...newbornsByInv.keys()])
  const historyInvEarly = await historyOnlyInvoiceIds([...invIds])

  /**
   * B4 + کندیِ گزارش‌شده: وضعیت/«بدون کسر» و جمع حرکت‌های هر فاکتور یک‌جا خوانده
   * می‌شود (قبلاً به‌ازای هر فاکتور یک `findUnique` داخل حلقه بود).
   */
  const liveInvIds: number[] = [...new Set<number>(items.map((i: any) => Number(i.invoiceId)))]
  const liveInvs: any[] = await chunkMap<any>(liveInvIds, 400, (slice) =>
    X().saleInvoice.findMany({
      where: { id: { in: slice } },
      select: { id: true, deductInventory: true, status: true }
    })
  )
  const invMeta = new Map<number, { deduct: boolean; status: string }>(
    liveInvs.map((i: any) => [i.id, { deduct: i.deductInventory !== false, status: String(i.status || '') }])
  )
  const lastIdForGate = Number((await state()).lastMovementId || 0)
  const netOf = await saleNetByInvoice(liveInvIds, lastIdForGate)
  /** قلمی که واقعاً انبار را کم کرده؛ قلم‌های بی‌حرکتِ پیش‌نویس/لغوشده نه. */
  const lockableItem = (it: { invoiceId: number }): boolean => {
    const meta = invMeta.get(Number(it.invoiceId))
    if (meta && !meta.deduct) return true
    const net = netOf.get(Number(it.invoiceId))
    if (net && net.neg + net.pos > 0) return net.neg - net.pos > 0
    if (meta && (meta.status === 'DRAFT' || meta.status === 'CANCELED')) return false
    return true
  }

  for (const invoiceId of invIds) {
    await keepLockAlive()
    if (budgetMs > 0 && Date.now() - t0 > budgetMs) {
      overBudget = true
      break
    }
    if (budgetItems > 0 && invDone >= budgetItems) {
      overBudget = true
      break
    }
    invDone++
    const oList = orphansByInv.get(invoiceId) ?? []
    const nList = newbornsByInv.get(invoiceId) ?? []
    const invoiceExists = invMeta.has(invoiceId) || (await X().saleInvoice.findUnique({ where: { id: invoiceId }, select: { id: true } }))
    if (!invoiceExists) {
      for (const orphan of oList) {
        await Y().saleItemCost.delete({ where: { saleItemId: orphan.saleItemId } }).catch(() => null)
      }
      continue
    }
    const used = new Set<number>()
    /**
     * B2 (بازبینی دهم) — تطبیق بر پایهٔ **سهم انبار فروشگاه** است، نه qty کل فاکتور؛
     * یک خط ممکن است بخشی از STORE و بخشی از WAREHOUSE باشد.
     */
    for (const it of nList) {
      if (shopQtyOf.has(Number(it.id))) continue
      shopQtyOf.set(Number(it.id), await shopConsumeQty(it))
    }
    for (const orphan of oList) {
      // تطبیقِ دقیق را ترجیح بده؛ اگر تعداد تغییر کرده، همان واریانت را هم جفت کن تا
      // واحدهای قبلی فیِ قفل‌شده‌شان را نگه دارند و فقط delta به FIFO اضافه/کم شود.
      const exactIdx = nList.findIndex(
        (it, idx) =>
          !used.has(idx) &&
          it.variantId === orphan.variantId &&
          (shopQtyOf.get(Number(it.id)) ?? 0) === Number(orphan.qty)
      )
      const matchIdx =
        exactIdx >= 0
          ? exactIdx
          : nList.findIndex((it, idx) => !used.has(idx) && it.variantId === orphan.variantId)
      if (matchIdx < 0) {
        const editMove = await latestSaleEditMovement(invoiceId, Number(orphan.variantId), 'decrease')
        if (String(orphan.costStatus) !== 'OUTSIDE' && Number(orphan.qty) > 0) {
          const restored = { qty: 0, fifoCost: 0n }
          await restoreFromSaleItem(orphan.saleItemId, Number(orphan.qty), Number(editMove?.id ?? 0), 'EDIT_ADJ', restored)
        }
        await Y().saleItemCost.delete({ where: { saleItemId: orphan.saleItemId } }).catch(() => null)
        continue
      }

      used.add(matchIdx)
      const match = nList[matchIdx]
      const targetQty = shopQtyOf.get(Number(match.id)) ?? 0
      const invoice = await X().saleInvoice.findUnique({ where: { id: invoiceId }, include: { items: true } })
      const oldQty = String(orphan.costStatus) === 'OUTSIDE' ? 0 : Math.max(0, Number(orphan.qty) || 0)
      const direction = targetQty > oldQty ? 'increase' : targetQty < oldQty ? 'decrease' : 'any'
      const editMove = await latestSaleEditMovement(invoiceId, Number(match.variantId), direction)
      const at = editMove?.createdAt instanceof Date ? editMove.createdAt : editMove?.createdAt ? new Date(editMove.createdAt) : null

      // بدون حرکت SALE_EDIT تغییر سهم از روی مصرفِ واقعیِ لات قابل اثبات نیست؛ مثل قبل
      // ردیف را کامل باز و دوباره قفل می‌کنیم. ویرایش واقعی SalesService برای delta
      // انبار حرکت دارد و در مسیر بعدی فقط همان واحدهای افزوده/حذف‌شده اصلاح می‌شوند.
      if (oldQty !== targetQty && !editMove) {
        if (oldQty > 0 && String(orphan.costStatus) !== 'OUTSIDE') {
          const restored = { qty: 0, fifoCost: 0n }
          await restoreFromSaleItem(orphan.saleItemId, oldQty, 0, 'EDIT_ADJ', restored)
        }
        await Y().saleItemCost.delete({ where: { saleItemId: orphan.saleItemId } }).catch(() => null)
        if (lockableItem(match)) await lockSaleItem(match, 0, targetQty)
        continue
      }

      if (targetQty <= 0) {
        if (oldQty > 0 && invoice)
          await adjustSaleItemCostForEdit(
            match,
            orphan,
            invoice,
            0,
            editMove,
            Number(orphan.saleItemId)
          )
        await Y().saleItemCost.delete({ where: { saleItemId: orphan.saleItemId } }).catch(() => null)
        // مصرف/اصلاحِ خط حذف‌شده روی شناسهٔ یتیم می‌ماند؛ ردیف OUTSIDE تازه نباید
        // مصرف تاریخیِ واحدهای حذف‌شده را به خودش جذب کند.
        if (lockableItem(match)) await lockSaleItem(match, Number(editMove?.id ?? 0), 0, at)
        continue
      }

      if (String(orphan.costStatus) === 'OUTSIDE') {
        await Y().saleItemCost.delete({ where: { saleItemId: orphan.saleItemId } }).catch(() => null)
        if (lockableItem(match)) await lockSaleItem(match, Number(editMove?.id ?? 0), targetQty, at)
        continue
      }

      if (invoice) {
        const adjusted = await adjustSaleItemCostForEdit(
          match,
          orphan,
          invoice,
          targetQty,
          editMove,
          Number(orphan.saleItemId)
        )
        await Y().saleItemCost.update({
          where: { saleItemId: orphan.saleItemId },
          data: { ...adjusted, saleItemId: match.id }
        })
        await Y().costConsumption.updateMany({ where: { saleItemId: orphan.saleItemId }, data: { saleItemId: match.id } })
      }
    }
    for (let i = 0; i < nList.length; i++) {
      if (used.has(i)) continue
      // B4 — پیش‌نویس/معلقِ بی‌حرکت و فاکتور لغو‌شده: هیچ لاتِ فروشنده‌ای نباید مصرف شود.
      if (!lockableItem(nList[i])) continue
      if (historyInvEarly.has(invoiceId)) {
        await lockSaleItem(nList[i], 0, 0)
        continue
      }
      const storeQty = shopQtyOf.get(Number(nList[i].id)) ?? (await shopConsumeQty(nList[i]))
      const editMove = storeQty > 0 ? await latestSaleEditMovement(invoiceId, Number(nList[i].variantId), 'increase') : null
      const at = editMove?.createdAt instanceof Date ? editMove.createdAt : editMove?.createdAt ? new Date(editMove.createdAt) : null
      await lockSaleItem(nList[i], Number(editMove?.id ?? 0), storeQty, at)
    }
  }

  if (overBudget) {
    /**
     * B5 — بودجهٔ همین اجرا تمام شد. همان‌جا بی‌صدا بیرون می‌آییم (نه خطا): باقی
     * فاکتورها و حلقهٔ «مغایرتِ سهم انبار» در ادامهٔ همین چرخه دیده می‌شوند، چون
     * مکان‌نما جلو رفته و در پایانِ جدول به صفر برمی‌گردد. صفحه با `reconcile.budget`
     * می‌فهمد این دور نیمه‌کاره مانده بود.
     */
    return { scanned: items.length, from: cur, to: hi, maxId, span, next: hi, budget: true }
  }
  const deductOf = new Map<number, boolean>([...invMeta.entries()].map(([k, v]) => [k, v.deduct]))
  const allAllocs: any[] = await chunkMap<any>(
    items.map((i: any) => Number(i.id)),
    400,
    (slice) =>
      X()
        .saleItemStockAllocation.findMany({
          where: { saleItemId: { in: slice } },
          select: { saleItemId: true, sourceKind: true, qty: true }
        })
        .catch(() => [] as any[])
  )
  const hasAlloc = new Set(allAllocs.map((a: any) => a.saleItemId))
  const storeOf = new Map<number, number>()
  for (const a of allAllocs) {
    if (String(a.sourceKind) !== 'STORE') continue
    storeOf.set(a.saleItemId, (storeOf.get(a.saleItemId) ?? 0) + Number(a.qty || 0))
  }
  const historyInv = await historyOnlyInvoiceIds(liveInvIds)
  const expectedStore = (it: any) => {
    if (!lockableItem(it)) return 0
    if (historyInv.has(it.invoiceId)) return 0
    if (!deductOf.get(it.invoiceId)) return 0
    if (!hasAlloc.has(it.id)) return Math.max(0, Number(it.qty))
    return storeOf.get(it.id) ?? 0
  }
  const costNow =
    scanInvIds.length && items.length > winItems.length
      ? await Y().saleItemCost.findMany({
          where: { OR: [{ saleItemId: { gt: cur, lte: hi } }, { invoiceId: { in: scanInvIds } }] }
        })
      : await Y().saleItemCost.findMany({ where: { saleItemId: { gt: cur, lte: hi } } })
  const costByItem = new Map<number, any>(costNow.map((c: any) => [Number(c.saleItemId), c] as const))
  const invoiceCache = new Map<number, any>()
  const invoiceForEdit = async (invoiceId: number) => {
    if (!invoiceCache.has(invoiceId))
      invoiceCache.set(invoiceId, await X().saleInvoice.findUnique({ where: { id: invoiceId }, include: { items: true } }))
    return invoiceCache.get(invoiceId)
  }
  for (const it of items) {
    await keepLockAlive()
    const cost = costByItem.get(it.id)
    if (!cost) continue
    const storeQty = expectedStore(it)
    const outside = String(cost.costStatus) === 'OUTSIDE'
    const currentQty = outside ? 0 : Math.max(0, Number(cost.qty) || 0)
    if (outside && storeQty > 0) {
      const editMove = await latestSaleEditMovement(Number(it.invoiceId), Number(it.variantId), 'increase')
      const at = editMove?.createdAt instanceof Date ? editMove.createdAt : editMove?.createdAt ? new Date(editMove.createdAt) : null
      await Y().saleItemCost.delete({ where: { saleItemId: it.id } }).catch(() => null)
      await lockSaleItem(it, Number(editMove?.id ?? 0), storeQty, at)
    } else if (!outside && storeQty === 0 && currentQty > 0) {
      // مصرفِ اشتباه برگردانده می‌شود؛ EDIT_ADJ آن را با برگشتِ واقعی اشتباه نمی‌گذارد.
      const editMove = await latestSaleEditMovement(Number(it.invoiceId), Number(it.variantId), 'decrease')
      const invoice = await invoiceForEdit(Number(it.invoiceId))
      if (invoice) await adjustSaleItemCostForEdit(it, cost, invoice, 0, editMove)
      await Y().saleItemCost.delete({ where: { saleItemId: it.id } }).catch(() => null)
      if (deductOf.get(it.invoiceId) === false) await lockSaleItem(it, 0, 0)
    } else if (!outside && storeQty > 0 && currentQty !== storeQty) {
      const direction = storeQty > currentQty ? 'increase' : 'decrease'
      const editMove = await latestSaleEditMovement(Number(it.invoiceId), Number(it.variantId), direction)
      const invoice = await invoiceForEdit(Number(it.invoiceId))
      if (invoice) {
        const adjusted = await adjustSaleItemCostForEdit(it, cost, invoice, storeQty, editMove)
        await Y().saleItemCost.update({ where: { saleItemId: it.id }, data: adjusted })
      }
    }
  }
  /** پنجرهٔ بعدی از ادامه؛ بعد از انتها از اول (جاروی ادواری، نه جاروی کاملِ هر اجرا). */
  return { scanned: items.length, from: cur, to: hi, maxId, span, next: hi >= maxId ? 0 : hi }
}

async function applyOne(m: {
  id: number
  variantId: number
  delta: number
  reason: string
  refId: number | null
  createdAt: Date
}) {
  const reason = String(m.reason || '')
  const delta = Number(m.delta)
  if (!delta) return

  if (delta > 0) {
    /** WooCommerce فقط موجودی را هم‌تراز می‌کند؛ ورود مثبت سایت از قیمت/مبلغ سایت فی نمی‌گیرد. */
    if (reason === 'WOO_SYNC_IN') {
      await restoreExternalSync(m)
      return
    }
    if (reason === 'WOO_SYNC_ADJUST') {
      await restoreFifoFallback(m.variantId, delta, m.id, m.createdAt, 'EXTERNAL_SYNC')
      return
    }
    if (reason === 'PURCHASE' || reason === 'PURCHASE_EDIT' || reason === 'INITIAL') {
      await applyPurchase(m)
      return
    }
    if (reason === 'SALE_RETURN') {
      await restoreFromReturn(m)
      return
    }
    if (reason === 'SALE') {
      await restoreFromSaleInvoice(m)
      return
    }
    // هر دو جهت SALE_EDIT عمداً در سطح حرکت no-op می‌مانند؛ reconcile پایین‌تر delta را
    // به قلم/سهم STORE فعلی وصل می‌کند تا «حرکتِ پایه + ویرایش» دوباره شمرده نشود.
    if (reason === 'SALE_EDIT') return
    await applyPurchase({ ...m, refId: null })
    return
  }

  if (reason === 'WOO_SYNC_OUT' || reason === 'WOO_SYNC_ADJUST') {
    await consumeFifo({
      variantId: m.variantId,
      qty: -delta,
      movementId: m.id,
      kind: 'EXTERNAL_SYNC',
      saleItemId: null,
      at: m.createdAt
    })
    return
  }

  if (reason === 'SALE') {
    await applySale(m)
    return
  }
  // جهت منفیِ SALE_EDIT هم پایین‌تر، پس از تطبیق سهم فعلی STORE با ردیف قفل، مصرف می‌شود.
  if (reason === 'SALE_EDIT') return
  if (reason === 'SALE_RETURN') {
    await consumeFifo({
      variantId: m.variantId,
      qty: -delta,
      movementId: m.id,
      kind: 'SALE',
      saleItemId: null,
      at: m.createdAt
    })
    return
  }
  if (reason === 'PURCHASE_EDIT') {
    await consumeFifo({
      variantId: m.variantId,
      qty: -delta,
      movementId: m.id,
      kind: 'EDIT_ADJ',
      saleItemId: null,
      preferPurchaseId: m.refId,
      at: m.createdAt
    })
    return
  }
  await consumeFifo({
    variantId: m.variantId,
    qty: -delta,
    movementId: m.id,
    kind: 'SHRINK',
    saleItemId: null,
    at: m.createdAt
  })
}

/**
 * B10 (بازبینی هشتم) — قفل `costEngineLock` یک ردیفِ اشتراکی است و *تنها* راه
 * جداسازی اجراها نبود: اجرای A موقع خروج `releaseLock` را صدا می‌زد و همان ردیف را
 * `busyAt = null` می‌کرد، یعنی قفل اجرای B را هم آزاد می‌کرد (و ضربان داخل
 * تراکنش بیرون دیده نمی‌شد ⇒ آن ۱۲۰ ثانیهٔ «کهنه» هم کاری نمی‌کرد).
 * همهٔ اجراها در **یک پروسهٔ main** می‌چرخند، پس قفل واقعی همین‌جاست: یک
 * دَرِ هم‌روندی درون‌روشی. ردیف دیتابیس می‌ماند تا (الف) پس از کرش پروسه قفل
 * بعد از `LOCK_STALE_MS` خودش باز شود و (ب) صفحه «در حال پردازش» را نشان دهد.
 */
let heldInProcess = false

async function acquireLock(): Promise<boolean> {
  if (heldInProcess) return false
  const now = new Date()
  const stale = new Date(now.getTime() - LOCK_STALE_MS)
  const row = await db.costEngineLock.findUnique({ where: { key: 'main' } })
  if (!row) {
    try {
      await db.costEngineLock.create({ data: { key: 'main', busyAt: now } })
      heldInProcess = true
      return true
    } catch {
      /* ردیف را دیگری ساخت */
    }
  }
  const n = await db.costEngineLock.updateMany({
    where: {
      key: 'main',
      OR: [{ busyAt: null }, { busyAt: { lt: stale } }]
    },
    data: { busyAt: now }
  })
  if (Number(n?.count ?? 0) > 0) heldInProcess = true
  return Number(n?.count ?? 0) > 0
}

async function heartbeat() {
  await db.costEngineLock.upsert({
    where: { key: 'main' },
    create: { key: 'main', busyAt: new Date() },
    update: { busyAt: new Date() }
  })
}

async function releaseLock() {
  // فقط وقتی آزاد می‌کنیم که خودمان گرفته باشیم — وگرنه قفل اجرای دیگر پاک می‌شود.
  if (!heldInProcess) return
  heldInProcess = false
  await db.costEngineLock.upsert({
    where: { key: 'main' },
    create: { key: 'main', busyAt: null },
    update: { busyAt: null }
  })
}

async function applyOneInTx(m: any) {
  await prisma.$transaction(async (tx) => {
    cx = tx
    try {
      if (!isHistoryOnlyMovement(m)) await applyOne(m)
      await Y().costEngineState.update({ where: { key: 'main' }, data: { lastMovementId: m.id } })
    } finally {
      cx = null
    }
  }, TX_OPTIONS)
}

async function mixedReplacementCostFromMovements(c: any): Promise<{ value: bigint; complete: boolean }> {
  const sales: any[] = await db.costConsumption.findMany({
    where: { saleItemId: Number(c.saleItemId), kind: 'SALE' },
    orderBy: { id: 'asc' },
    select: { movementId: true, lotId: true, qty: true }
  })
  if (!sales.length) return { value: 0n, complete: false }
  const restores: any[] = await db.costConsumption.findMany({
    where: { saleItemId: Number(c.saleItemId), kind: 'EDIT_ADJ' },
    select: { lotId: true, qty: true }
  })
  const restoreByLot = new Map<number, number>()
  for (const r of restores) {
    const lotId = Number(r.lotId)
    restoreByLot.set(lotId, (restoreByLot.get(lotId) ?? 0) + Math.max(0, Number(r.qty) || 0))
  }
  // EDIT_ADJ آزادسازیِ جدیدترین مصرف‌هاست؛ برای هر لات همان ترتیبِ معکوسِ FIFO
  // که restoreFromSaleItem استفاده می‌کند، سهم هر SALE را از سرِ صف کم می‌کنیم.
  const active: { movementId: number; qty: number }[] = []
  for (let i = sales.length - 1; i >= 0; i--) {
    const row = sales[i]
    const lotId = Number(row.lotId)
    const pending = restoreByLot.get(lotId) ?? 0
    const qty = Math.max(0, Number(row.qty) || 0)
    const removed = Math.min(qty, pending)
    restoreByLot.set(lotId, pending - removed)
    if (qty > removed) active.push({ movementId: Number(row.movementId) || 0, qty: qty - removed })
  }
  if (active.reduce((sum, row) => sum + row.qty, 0) !== Math.max(0, Number(c.qty) || 0))
    return { value: 0n, complete: false }

  const movementIds = [...new Set(active.map((row) => row.movementId).filter((id) => id > 0))]
  const movements: any[] = movementIds.length
    ? await chunkMap<any>(movementIds, 400, (slice) =>
        db.stockMovement.findMany({ where: { id: { in: slice } }, select: { id: true, createdAt: true, reason: true } })
      )
    : []
  const movementById = new Map<number, any>(movements.map((m: any) => [Number(m.id), m]))
  const invoice = await db.saleInvoice.findUnique({ where: { id: Number(c.invoiceId) }, select: { issuedAt: true } })
  let value = 0n
  for (const row of active) {
    const movement = movementById.get(row.movementId)
    const atValue = movement?.reason === 'SALE_EDIT'
      ? movement.createdAt
      : invoice?.issuedAt ?? movement?.createdAt ?? (row.movementId === 0 ? invoice?.issuedAt : null)
    if (!atValue) return { value: 0n, complete: false }
    const at = atValue instanceof Date ? atValue : new Date(atValue)
    const replacement = await lastPurchaseUnit(Number(c.variantId), at)
    if (replacement.approx) return { value: 0n, complete: false }
    value += replacement.unit * BigInt(row.qty)
  }
  return { value, complete: true }
}

/**
 * B1 — هم‌راستایی «سود جایگزینی» بعد از اصلاح فی فاکتور خرید.
 *
 * `repriceLocked` فی لات و `costConsumption` را بازنویسی می‌کرد و
 * `recalcSaleItemFifo` فقط `fifoCost` را دوباره حساب می‌کرد؛ `replacementCost`
 * روی فی غلطِ لحظهٔ قفل می‌ماند. نتیجه: «سود تورمی» منفیِ بی‌معنی روی فروش
 * قفل‌شده، بدون هیچ هشداری.
 *
 * قاعدهٔ قیمت در لحظهٔ قفل هنوز همان است (`replacement.ts`)، اما صرفِ برابر بودن
 * مبلغ، منبع را ثابت نمی‌کند: دو فاکتورِ هم‌قیمت می‌توانند فروش‌های متفاوتی را
 * ساخته باشند. پس منبعِ فاکتور خرید کنار `replacementCost` ثبت می‌شود و اصلاح،
 * ردیف‌هایی را بازنویسی می‌کند که شناسهٔ منبعشان دقیقاً همین فاکتور است. ردیفِ
 * `MIXED` منبعِ تک‌شناسه ندارد؛ سهم‌ها از تاریخ فاکتور فروش برای `SALE` و از
 * تاریخ حرکت برای `SALE_EDIT` بازسازی می‌شوند، و اگر بازسازی دقیق نباشد stale می‌ماند.
 * قیمت کارت کالا، لاتِ بی‌فاکتور و فاکتور خرید دیگرِ دارای منبع مستقل عمداً دست‌نخورده
 * می‌مانند. دادهٔ قدیمیِ بی‌منبع نیز بدون حدسِ مبتنی بر مبلغ در stale دیده می‌شود.
 * هیچ فاکتور فروش یا عدد فروش این‌جا عوض نمی‌شود.
 *
 * `itemIds` (مصرف‌کننده‌های لات‌های همین فاکتور) کافی نیست: فروشِ مرتبط ممکن است
 * از لات دیگری مصرف شده باشد ولی فی جایگزینی‌اش از همین فاکتور آمده باشد. برای
 * همین، دامنهٔ جست‌وجو همهٔ ردیف‌های هزینهٔ همان واریانت‌هاست؛ اتصال فقط با
 * `replacementPurchaseInvoiceId` انجام می‌شود، نه با قیاس مبلغ.
 */
async function alignReplacementCost(
  itemIds: Set<number>,
  invoiceId: number,
  units: Map<number, { invoiceUnit: bigint; sourceAvailable: boolean }>
): Promise<{ fixed: number; stale: number; scanned: number }> {
  let fixed = 0
  let stale = 0
  let scanned = 0
  if (!units.size) return { fixed, stale, scanned: 0 }
  const variantIds = [...units.keys()]
  const rows: any[] = await chunkMap<any>(variantIds, 400, (slice) =>
    db.saleItemCost.findMany({ where: { variantId: { in: slice } } })
  )
  const extra: any[] = await chunkMap<any>([...itemIds].map((x) => Number(x)), 400, (slice) =>
    db.saleItemCost.findMany({ where: { saleItemId: { in: slice } } })
  )
  const seen = new Set(rows.map((c: any) => Number(c.saleItemId)))
  const all = [...rows, ...extra.filter((c: any) => !seen.has(Number(c.saleItemId)))]
  for (const c of all as any[]) {
    if (String(c.costStatus) === 'OUTSIDE') continue
    const u = units.get(Number(c.variantId))
    if (!u) continue
    const source = String(c.replacementSource || 'LEGACY')
    const sourceInvoice = c.replacementPurchaseInvoiceId == null ? null : Number(c.replacementPurchaseInvoiceId)
    const isExactSource = source === 'PURCHASE_INVOICE' && sourceInvoice === invoiceId

    if (source === 'MIXED') {
      scanned += 1
      if (!u.sourceAvailable) {
        stale += 1
        continue
      }
      const mixed = await mixedReplacementCostFromMovements(c)
      if (!mixed.complete) {
        stale += 1
        continue
      }
      if (mixed.value !== bi(c.replacementCost)) {
        await db.saleItemCost.update({ where: { saleItemId: c.saleItemId }, data: { replacementCost: mixed.value } })
        fixed += 1
      }
      continue
    }

    // منبعِ دیگری را به‌خاطر برابر بودنِ مبلغ لمس نمی‌کنیم. LEGACY/منبع خراب را
    // هم حدس نمی‌زنیم؛ آن را در stale می‌شماریم تا نیاز به بازبینی پنهان نماند.
    if (!isExactSource) {
      const sourceUncertain =
        source === 'LEGACY' ||
        (source === 'PURCHASE_INVOICE' && sourceInvoice == null) ||
        !['PURCHASE_INVOICE', 'PRODUCT_CARD', 'NO_INVOICE'].includes(source)
      if (sourceUncertain) {
        scanned += 1
        stale += 1
      }
      continue
    }

    scanned += 1
    const qty = Math.max(0, Math.round(Number(c.qty)))
    if (!qty) continue
    if (!u.sourceAvailable) {
      stale += 1
      continue
    }
    const stored = bi(c.replacementCost)
    const want = u.invoiceUnit * BigInt(qty)
    if (want === stored) continue
    await db.saleItemCost.update({ where: { saleItemId: c.saleItemId }, data: { replacementCost: want } })
    fixed += 1
  }
  return { fixed, stale, scanned }
}

async function repriceLocked(invoiceId: number) {
  const lots = await db.purchaseLot.findMany({ where: { purchaseInvoiceId: invoiceId } })
  if (!lots.length) return { updated: 0, needRun: true as const }
  const byVar = new Map<number, any[]>()
  for (const lot of lots) {
    const list = byVar.get(lot.variantId) ?? []
    list.push(lot)
    byVar.set(lot.variantId, list)
  }
  let updated = 0
  const itemIds = new Set<number>()
  const units = new Map<number, { invoiceUnit: bigint; sourceAvailable: boolean }>()
  for (const [variantId, list] of byVar) {
    const { unit, approx } = await unitCostFromPurchase(invoiceId, variantId)
    for (const lot of list) {
      /**
       * B4 (بازبینی یازدهم) — اصلاح فی بیرون از تراکنشِ فاکتور خرید می‌چرخد؛ اگر میانِ
       * «آپدیت لات/مصرف» و `recalcSaleItemFifo` خطا بخورد یا برنامه بسته شود، مصرف‌ها
       * فیِ تازه دارند ولی `fifoCost` قلم کهنه می‌ماند و «لات عوض نشده» دیگر هرگز
       * درستش نمی‌کرد. پس ردیف‌های مصرفِ هر لاتِ همین فاکتور خوانده می‌شوند (چه لات
       * عوض شده چه نه) و قلم‌هایشان از نو محاسبه می‌شوند — تابع idempotent شد.
       */
      const cons = await db.costConsumption.findMany({
        where: { lotId: lot.id, kind: 'SALE', saleItemId: { not: null } }
      })
      for (const c of cons) if (c.saleItemId) itemIds.add(c.saleItemId)
      if (bi(lot.unitCost) === unit) continue
      await db.purchaseLot.update({ where: { id: lot.id }, data: { unitCost: unit, approx } })
      await db.costConsumption.updateMany({ where: { lotId: lot.id }, data: { unitCost: unit } })
      updated += 1
    }
    // حتی اگر لات از قبل فیِ جدید را داشته، ردیف‌های صریحاً منتسب به این فاکتور
    // باید بررسی شوند؛ اصلاح/بازیابیِ نیمه‌تمام idempotent می‌ماند.
    units.set(Number(variantId), { invoiceUnit: unit, sourceAvailable: !approx })
  }
  for (const saleItemId of itemIds) await recalcSaleItemFifo(saleItemId)
  const rep = await alignReplacementCost(itemIds, invoiceId, units)
  // دامنهٔ هم‌راستایی از لات‌ها بازتر است (B1) ⇒ شمارش «چه چیزی لمس شد» هم باید همان
  // دامنه را بگوید، وگرنه یادآوری صفحه «۰ قلم لمس شد؛ ۱ قلم درست شد» می‌نویسد.
  const touched = Math.max(itemIds.size, rep.scanned)
  await persistLastReprice({
    at: new Date().toISOString(),
    lots: updated,
    saleItems: touched,
    replacementFixed: rep.fixed,
    replacementStale: rep.stale
  })
  return { updated, saleItems: touched, replacementFixed: rep.fixed, replacementStale: rep.stale }
}

/** ده خطای اول دفتر، با کالا و دلیل — برای بنر قرمزِ صفحهٔ سود. */
async function listFailures(): Promise<
  { movementId: number; message: string; at: string; reason: string; delta: number; productName?: string; size?: string }[]
> {
  const fails = await db.costEngineFailure
    .findMany({ orderBy: { movementId: 'asc' }, take: 10 })
    .catch(() => [])
  if (!fails.length) return []
  const ids = fails.map((f: any) => Number(f.movementId)).filter((id: number) => id > 0)
  const moves = ids.length
    ? await db.stockMovement.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          delta: true,
          reason: true,
          createdAt: true,
          variant: { select: { size: true, product: { select: { name: true } } } }
        }
      }).catch(() => [])
    : []
  const byId = new Map<number, any>((moves as any[]).map((m: any) => [Number(m.id), m]))
  return fails.map((f: any) => {
    const m = byId.get(Number(f.movementId)) ?? null
    return {
      movementId: Number(f.movementId),
      message: String(f.message ?? ''),
      at: m?.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : '',
      reason: String(m?.reason ?? '—'),
      delta: Number(m?.delta ?? 0),
      productName: m?.variant?.product?.name,
      size: m?.variant?.size
    }
  })
}

async function runLocked() {
  await hydratePending()
  const s = await state()
  let lastId = Number(s.lastMovementId || 0)
  let stoppedEarly = false
  for (;;) {
    const batch = await prisma.stockMovement.findMany({
      where: { id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take: PAGE
    })
    if (!batch.length) break
    for (const m of batch) {
      await heartbeat()
      try {
        await applyOneInTx(m)
        await db.costEngineFailure.deleteMany({ where: { movementId: m.id } }).catch(() => null)
        lastId = m.id
      } catch (e: any) {
        const message = String(e?.message ?? e).slice(0, 400)
        console.error('[costEngine] movement', m.id, message)
        await db.costEngineFailure
          .upsert({
            where: { movementId: m.id },
            create: { movementId: m.id, message },
            update: { message }
          })
          .catch(() => null)
        stoppedEarly = true
        break
      }
    }
    if (batch.length && lastId < batch[batch.length - 1].id) break
  }
  if (!stoppedEarly) {
    try {
      const rec = await prisma.$transaction(
        async (tx) => {
          cx = tx
          try {
            return await reconcileSaleEdits()
          } finally {
            cx = null
          }
        },
        TX_OPTIONS
      )
      if (rec?.maxId) {
        const nextCur = Number(rec.next ?? 0)
        /**
         * B5 — «اندازهٔ پنجرهٔ دورِ بعدی» روی مکان‌نما می‌نشیند: وسطِ چرخه همان چیزی که
         * همین دور استفاده شد (شاید بعد از مهلک نصفه باشد) و وقتی چرخه تمام شد به
         * اندازهٔ پیش‌فرض برمی‌گردد، تا یک مهلکِ موقت برای همیشه جارو را کند نگذارد.
         */
        const keepSpan = nextCur > 0 ? Number(rec.span ?? 0) || RECONCILE_SPAN : RECONCILE_SPAN
        await persistReconcileCursor(nextCur, Number(rec.maxId ?? 0), keepSpan, !!rec.budget)
      }
      await persistReconcileError('')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[costEngine] reconcile', e)
      await persistReconcileError(message.slice(0, 400))
      /** B5 — اگر تراکنش به مهلت خورد، دورِ بعدی با پنجرهٔ کوچک‌تر تلاش می‌کند. */
      await shrinkReconcileSpan()
    }
  }
  const queued = [...pendingReprice]
  pendingReprice.clear()
  await persistPending()
  for (const id of queued) {
    try {
      await repriceLocked(id)
    } catch (e) {
      console.error('[costEngine] queued reprice', id, e)
      pendingReprice.add(id)
    }
  }
  await persistPending()
}

export const costEngine = {
  /**
   * B6 (بازبینی یازدهم) — `state()` داخل `cx` می‌خواند تا جاروی داخلِ تراکنش همان
   * نگاهِ تراکنش را ببیند. ولی `status()` از IPC هم صدا زده می‌شود و `run()` روی
   * مسیرِ busy همان را صدا می‌زند: اگر هم‌زمان یک اجرای دیگر وسطِ تراکنشِ
   * `reconcileSaleEdits` بود، این خواندنِ بی‌ضرر روی تراکنشِ آن می‌نشست (و بدترینش:
   * `state()` می‌توانست ردیف بسازد!) و با commit شدنِ آن تراکنش، صفحه خطا می‌گرفت و
   * `engine` صفر می‌شد — یعنی چراغِ «دفتر عقب است» بی‌دلیل غیب می‌شد. مسیرهای
   * فقط‌خواندنیِ بیرونِ اجرا باید همیشه روی خودِ `db` بخوانند.
   */
  async status() {
    const s =
      (await db.costEngineState.findUnique({ where: { key: 'main' } }).catch(() => null)) ??
      ({ lastMovementId: 0, activatedAt: null, openingMode: 'fromActivation' } as any)
    const last = await prisma.stockMovement.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    const failCount = await db.costEngineFailure.count().catch(() => 0)
    const rec = await prisma.setting.findUnique({ where: { key: RECONCILE_ERR_KEY } }).catch(() => null)
    const reconcileError = rec?.value ? String(rec.value) : ''
    const h = await this.health()
    await hydratePending()
    return {
      lastMovementId: Number(s.lastMovementId || 0),
      headMovementId: last?.id ?? 0,
      behind: (last?.id ?? 0) - Number(s.lastMovementId || 0),
      activatedAt: s.activatedAt,
      openingMode: s.openingMode,
      failCount,
      /**
       * B3 (بازبینی هشتم) — یک حرکت خراب دفتر را متوقف می‌کند و تا دیروز فقط
       * «تعداد خطا» روی صفحه بود: کاربر نمی‌فهمید کدام حرکت و چرا، و «راه خروجی»
       * را هیچ‌جا نمی‌خواند. لیستِ همان حرکت‌ها این‌جا می‌آید (ده تای اول) تا صفحه
       * بتواند بگوید «کدام حرکت را کجا درست کن». عمداً *رد نمی‌کنیم*: ردکردنِ یک
       * حرکت یعنی سازندهٔ عددِ غلط بی‌صدا؛ به‌جایش عدد ایستادن را فریاد می‌زنیم.
       */
      failures: await listFailures(),
      reconcileError: reconcileError || undefined,
      /** اصلاح فی‌های منتظرِ اجرای بعدی دفتر هزینه (صف، نه خطا). */
      repriceQueued: pendingReprice.size,
      /** خلاصهٔ آخرین «اصلاح فی فاکتور خرید» برای یادآوری روی صفحهٔ سود. */
      lastReprice: await readLastReprice(),
      /**
       * #7 طرحِ بازبینی نهم — نشانگر دفتر «به زبان آدمیزاد»: شمارهٔ خودِ حرکت برای
       * صاحب مغازه بی‌معنی است، پس مرجعش (فیش فروش/فاکتور خرید) هم می‌آید.
       * فقط خواندنی است و هیچ عددی از آن ساخته نمی‌شود.
       */
      cursorRef: await (async () => {
        const cur = Number(s.lastMovementId || 0)
        if (!cur) return null
        const m = await prisma.stockMovement
          .findUnique({ where: { id: cur }, select: { id: true, reason: true, refType: true, refId: true, createdAt: true } })
          .catch(() => null)
        if (!m) return null
        return {
          movementId: Number(m.id),
          reason: String(m.reason || ''),
          refType: m.refType ? String(m.refType) : null,
          refId: m.refId != null ? Number(m.refId) : null,
          at: m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : null
        }
      })(),
      /** جاروی تکه‌تکهٔ ویرایش‌ها (B3) — صفحه با این می‌گوید «تا کجای تاریخچه رسید». */
      reconcile: await readReconcileInfo(),
      healthOk: h.ok,
      mismatchCount: h.mismatchCount,
      mismatches: h.mismatches.slice(0, 20)
    }
  },

  async health() {
    const lots = await db.purchaseLot
      .groupBy({
        by: ['variantId'],
        _sum: { qtyLeft: true }
      })
      .catch(() => [])
    const lotMap = new Map<number, number>()
    for (const r of lots) lotMap.set(r.variantId, Number(r._sum?.qtyLeft ?? 0))
    const variants = await prisma.productVariant.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, stock: true, code: true, product: { select: { name: true } } }
    })
    const mismatches: { variantId: number; code: string; productName?: string; stock: number; lots: number }[] = []
    for (const v of variants) {
      const L = lotMap.get(v.id) ?? 0
      if (L !== v.stock)
        mismatches.push({
          variantId: v.id,
          code: v.code,
          productName: v.product?.name,
          stock: v.stock,
          lots: L
        })
    }
    return { ok: mismatches.length === 0, mismatches, mismatchCount: mismatches.length }
  },

  async run() {
    const got = await acquireLock()
    if (!got) return { ...(await this.status()), busy: true }
    try {
      await runLocked()
      return { ...(await this.status()), busy: false }
    } finally {
      await releaseLock()
    }
  },

  /**
   * اصلاح قیمت فاکتور خرید: فی لات و سود فروش‌هایی که از همین خرید آمده‌اند
   * خودکار به‌روز می‌شود (بدون دست زدن به فاکتور فروش).
   */
  async repricePurchase(invoiceId: number) {
    if (!invoiceId) return { updated: 0 }
    const got = await acquireLock()
    if (!got) {
      await hydratePending()
      pendingReprice.add(invoiceId)
      await persistPending()
      return { updated: 0, queued: true }
    }
    try {
      pendingReprice.delete(invoiceId)
      await persistPending()
      return await repriceLocked(invoiceId)
    } catch (e) {
      /**
       * B4 — قبلاً خطای همین‌جا فقط `console.error` می‌شد (در `PurchaseService.update`)
       * و آن اصلاحِ فی برای همیشه نصفه می‌ماند. حالا همان شناسه برمی‌گردد توی صفِ
       * `mgmt.pendingReprice`: اجرای بعدیِ دفتر دوباره تلاش می‌کند و شمارنده‌اش
       * (`status().repriceQueued`) روی صفحه هم دیده می‌شود.
       */
      pendingReprice.add(invoiceId)
      await persistPending()
      throw e
    } finally {
      await releaseLock()
    }
  },

  /** پاک کردن فقط جدول‌های دفتر هزینه و ساخت دوباره از حرکت انبار + اقلام فروش. */
  async rebuild() {
    const got = await acquireLock()
    if (!got) return { ...(await this.status()), busy: true }
    try {
      /**
       * B4 (بازبینی نهم) — بازسازی «اول پاک می‌کند و بعد می‌سازد» است. اگر یک حرکت
       * خراب باعث ایستادنِ اجرا شود، نتیجه‌اش بدتر از قبل است: دفترِ خالی و همهٔ
       * فروش‌های بعد از آن حرکت بی‌فی. پس تا وقتی خطایِ **زنده‌ای** روی حرکتِ موجود
       * هست، پاک کردن انجام نمی‌شود و همان پیامِ بنر راه‌حل را می‌گوید. خطاهای
       * یتیم (حرکتی که دیگر نیست) قبل از شمارش پاک می‌شوند تا بازسازی برای همیشه
       * قفل نشود؛ عمداً «رد کردنِ حرکتِ خراب» نمی‌کنیم — آن عدد را بی‌صدا غلط
       * می‌کند و تصمیمِ عددِ ایستاده را فریادزدن ترجیح می‌دهیم (تصمیم نشست ۲۱۷).
       */
      const ghosts = await db.costEngineFailure.findMany({ select: { movementId: true }, take: 200 }).catch(() => [])
      for (const g of ghosts as any[]) {
        const id = Number(g.movementId)
        if (!id) continue
        const still = await db.stockMovement.findUnique({ where: { id }, select: { id: true } }).catch(() => null)
        if (!still) await db.costEngineFailure.deleteMany({ where: { movementId: id } }).catch(() => null)
      }
      const blocked = await db.costEngineFailure.count().catch(() => 0)
      if (blocked > 0) {
        return {
          ...(await this.status()),
          rebuilt: false,
          refused: true,
          busy: false,
          refuseReason:
            faDigits(blocked) +
            ' حرکت انبار هست که دفتر هزینه روی آن‌ها خطا می‌دهد. تا این‌ها درست نشوند بازسازی نمی‌کنیم: ' +
            'اولِ کار کل دفتر پاک می‌شود و بعد روی همان حرکت می‌ایستد، یعنی «همه‌چیز بی‌فی» به‌جای «دفترِ کامل ' +
            'با یک چراغ قرمز». فهرست حرکت‌ها و کالا در بنر بالای همین صفحه است؛ معمولاً با ویرایش همان فاکتور ' +
            'خرید/فروش (یا حذف حرکتِ تکراری/نیمه‌کاره) درست می‌شود و اجرای بعدی خودش خطا را پاک می‌کند.'
        }
      }
      await db.costConsumption.deleteMany({})
      await db.saleItemCost.deleteMany({})
      await db.purchaseLot.deleteMany({})
      await db.costEngineFailure.deleteMany({})
      await db.costEngineState.upsert({
        where: { key: 'main' },
        create: { key: 'main', lastMovementId: 0, openingMode: 'fromActivation', activatedAt: new Date() },
        update: { lastMovementId: 0, openingMode: 'fromActivation', activatedAt: new Date() }
      })
      await runLocked()
      return { ...(await this.status()), rebuilt: true, busy: false }
    } finally {
      await releaseLock()
    }
  }
}
