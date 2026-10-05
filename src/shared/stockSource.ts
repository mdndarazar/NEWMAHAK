/**
 * ===========================================================================
 * جلسه ۴۷ — «از کدام انبار کسر شود؟» (فقط فاکتور فروش عمده)
 * ---------------------------------------------------------------------------
 * این فایل **تنها منبع حقیقتِ قواعد و شکلِ داده‌ی انتخاب انبار** است. نه سرویس
 * main و نه هیچ صفحه‌ی رندرری اجازه ندارد این منطق را دوباره پیاده کند:
 *
 *   • رندرر با `resolveLine()` زنجیره‌ی سؤال‌های بند ۲ را جلو می‌برد،
 *   • سرویس main با همان `resolveLine()` **دوباره** (داخل تراکنش) می‌سنجد که
 *     «برنامه‌ی کسر» با موجودیِ همان لحظه هم‌خوان است یا نه،
 *   • هر دو طرف «خلاصه‌ی کسری‌ها» را با `summarizePlan()` می‌سازند، پس پنجره‌ی
 *     تأیید و نتیجه‌ی ثبت‌شده هیچ‌وقت دو عدد متفاوت نشان نمی‌دهند.
 *
 * دلیل جدا بودنش از سرویس: در این پروژه `npm` نیست، پس منطق خالص تنها چیزی است
 * که بدون node_modules هم می‌شود واقعاً تست کرد (همان قاعده‌ی `credit.ts` و
 * `pendingRestock.ts`).
 *
 * ⚠️ قاعده‌ی ثابت: این فایل **هیچ‌وقت چیزی نمی‌نویسد** و هیچ import ی از main
 * یا renderer ندارد.
 * ===========================================================================
 */

/** منبع کسر موجودی. `STORE` = انبار فروشگاه (`ProductVariant.stock`). */
export const StockSourceKind = {
  /** انبار فروشگاه — همان موجودی واقعی کالا در پنل کالاها */
  STORE: 'STORE',
  /** یکی از انبارهای ماژول «انبار مرکزی» (`SecondaryWarehouse`) */
  WAREHOUSE: 'WAREHOUSE'
} as const
export type StockSourceKind = (typeof StockSourceKind)[keyof typeof StockSourceKind]

export const STORE_SOURCE_LABEL = 'انبار فروشگاه'
/** نام انبار پیش‌فرض ماژول انبار مرکزی (`warehouseId = null`). */
export const DEFAULT_CENTRAL_WAREHOUSE_LABEL = 'انبار مرکزی'

/** شناسه‌ی انبار پیش‌فرض در سطح UI/برنامه (در دیتابیس `null` است). */
export const DEFAULT_WAREHOUSE_ID = 0

/**
 * کدِ خطای «برنامه‌ی کسر دیگر معتبر نیست». پنجره‌ی انتخاب انبار با دیدن این
 * رشته در پیام خطا می‌فهمد که باید **دوباره اجرا شود**، نه این‌که یک خطای
 * عمومی نشان بدهد. عمداً یک رشته‌ی ثابت است تا هیچ‌جا با تطبیق متن فارسی
 * (که ممکن است عوض شود) تشخیص داده نشود.
 */
export const STOCK_PLAN_STALE_CODE = 'STOCK_PLAN_STALE'

/** متن‌های ثابتِ پنجره — یک‌جا، تا پنل و تست و گزارش یک جمله بگویند. */
export const STOCK_SOURCE_TEXT = {
  question: 'از کدام انبار کسر شود؟',
  noDefaultHint: 'هیچ گزینه‌ای پیش‌فرض انتخاب نشده است؛ انبار را خودتان انتخاب کنید.',
  shortageTitle: 'خلاصه‌ی کسری‌ها',
  confirmNegative: 'با موجودی منفی ادامه بدهم؟',
  askOther: 'از آن‌ها کم کنم؟',
  cancelAll: 'لغو کل ثبت فاکتور',
  staleTitle: 'موجودی بین پنجره و ثبت عوض شد',
  staleHint:
    'موجودی یکی از انبارها بین لحظه‌ای که انتخاب کردید و لحظه‌ی ثبت عوض شده است. ' +
    'پنجره‌ی انتخاب انبار دوباره با موجودی تازه اجرا می‌شود؛ هیچ چیزی ثبت نشد.'
} as const

// ===========================================================================
// شکل داده — پیش‌نمایش (خواندنی، بدون نوشتن)
// ===========================================================================

/** یک ردیف واقعیِ `SecondaryStockItem` که با تطبیق متنی به این کالا خورده است. */
export interface StockSourceRowInfo {
  id: number
  name: string
  code: string | null
  qty: number
  /** چرا این ردیف «همین کالا» شمرده شد: کد / بارکد / نام کامل / نام پایه */
  matchReason: string
}

/** یک منبع ممکن برای یک قلم (انبار فروشگاه یا یک انبار مشخص). */
export interface StockSourceOption {
  kind: StockSourceKind
  /** `null` برای فروشگاه و برای انبار پیش‌فرض ماژول انبار مرکزی */
  warehouseId: number | null
  /** نام آماده‌ی نمایش */
  name: string
  location: string | null
  isDefaultWarehouse: boolean
  /** موجودی قابل برداشت از این منبع برای همین کالا (می‌تواند منفی باشد) */
  available: number
  /** ردیف‌های تطبیق‌خورده (برای فروشگاه خالی است) */
  rows: StockSourceRowInfo[]
  /**
   * آیا این منبع اصلاً «همین کالا» را می‌شناسد؟
   * فروشگاه همیشه `true` (کالا رکورد دارد، حتی با موجودی صفر). یک انبار مرکزی
   * فقط وقتی `true` است که تطبیق متنی حداقل یک ردیف پیدا کرده باشد.
   */
  matched: boolean
}

/** پیش‌نمایش یک قلم فاکتور: موجودی همه‌ی منبع‌ها، بدون هیچ نوشتنی. */
export interface StockSourceLine {
  variantId: number
  name: string
  code: string
  barcode: string | null
  unit: string
  /** تعداد فروش همین قلم */
  requested: number
  sources: StockSourceOption[]
}

export interface StockSourcePreview {
  lines: StockSourceLine[]
  /** فهرست انبارهای فعال (برای سؤال «از کدام انبار کسر شود؟») */
  options: { kind: StockSourceKind; warehouseId: number | null; name: string; location: string | null; isDefaultWarehouse: boolean }[]
  /** لحظه‌ی گرفتن پیش‌نمایش (فقط نمایشی) */
  at: string
}

// ===========================================================================
// شکل داده — «برنامه‌ی کسر»
// ===========================================================================

/** یک برداشت مشخص از یک منبع مشخص. */
export interface StockAllocationEntry {
  kind: StockSourceKind
  /** `null` = فروشگاه، یا انبار پیش‌فرض ماژول انبار مرکزی */
  warehouseId: number | null
  /** snapshot نام انبار در همان لحظه (سابقه نباید با تغییر نام انبار بشکند) */
  warehouseName: string
  qty: number
  /** موجودی این منبع بعد از کسر، به روایتِ پنجره (سرور خودش بازحساب می‌کند) */
  balanceAfter: number | null
  /** این برداشت موجودی منبع را منفی کرد؟ */
  wentNegative: boolean
}

export interface StockPlanLine {
  variantId: number
  entries: StockAllocationEntry[]
}

/** خروجی پنجره‌ی انتخاب انبار — همان چیزی که `SalesService.create` می‌گیرد. */
export interface StockAllocationPlan {
  lines: StockPlanLine[]
}

// ===========================================================================
// کلید و برچسب
// ===========================================================================

/** کلید یکتای یک منبع. `STORE` · `WH:null` (پیش‌فرض) · `WH:3` */
export function sourceKey(kind: StockSourceKind, warehouseId: number | null | undefined): string {
  if (kind === StockSourceKind.STORE) return 'STORE'
  const id = warehouseId == null || Number(warehouseId) <= 0 ? null : Math.round(Number(warehouseId))
  return `WH:${id == null ? 'null' : id}`
}

export const optionKey = (o: { kind: StockSourceKind; warehouseId: number | null }): string =>
  sourceKey(o.kind, o.warehouseId)

/** `warehouseId` را نرمال می‌کند: صفر/منفی/خالی ⇒ `null` (انبار پیش‌فرض). */
export function normalizeWarehouseId(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function sourceLabel(kind: StockSourceKind, name?: string | null): string {
  if (kind === StockSourceKind.STORE) return STORE_SOURCE_LABEL
  return String(name ?? '').trim() || DEFAULT_CENTRAL_WAREHOUSE_LABEL
}

// ===========================================================================
// زنجیره‌ی سؤال‌های بند ۲ — قلب منطق، کاملاً خالص
// ===========================================================================

/** پاسخ کاربر در هر حلقه‌ی زنجیره. */
export type StockLineDecision =
  /** «بله» + انتخاب یکی از انبارهای موجود (کلیدش) */
  | { type: 'PICK'; key: string }
  /** «نه» ⇒ باقی‌مانده از همان آخرین انبار کم شود و منفی برود */
  | { type: 'NEGATIVE' }

export interface StockLinePending {
  /** انباری که کسری آورد */
  source: StockSourceOption
  /** چه مقدار از همین انبار برداشته شد (می‌تواند صفر باشد) */
  taken: number
  /** چه مقدار هنوز مانده */
  shortfall: number
  /**
   * انبارهایی که **همین کالا** را دارند و موجودی‌شان بیشتر از صفر است و هنوز
   * استفاده نشده‌اند. خالی بودنش یعنی سؤال «از دیگری کم کنم؟» نباید پرسیده شود
   * و فقط باید تأیید صریحِ «موجودی منفی» گرفته شود (بند ۲، حالت سوم).
   */
  candidates: StockSourceOption[]
}

export interface StockLineResolution {
  variantId: number
  entries: StockAllocationEntry[]
  /** منبع‌هایی که در این زنجیره مصرف شده‌اند (برای جلوگیری از تکرار) */
  usedKeys: string[]
  /** سؤال بازِ همین لحظه (null = این قلم تمام است) */
  pending: StockLinePending | null
  complete: boolean
  /** خطای شکلی (کلید ناشناس، منبع تکراری، …) */
  error: string | null
}

const entryOf = (o: StockSourceOption, qty: number, balanceAfter: number, wentNegative: boolean): StockAllocationEntry => ({
  kind: o.kind,
  warehouseId: o.kind === StockSourceKind.STORE ? null : o.warehouseId,
  warehouseName: sourceLabel(o.kind, o.name),
  qty: Math.round(qty),
  balanceAfter: Math.round(balanceAfter),
  wentNegative
})

/**
 * زنجیره‌ی بند ۲ را برای **یک قلم** جلو می‌برد.
 *
 * `primaryKey` = انباری که کاربر در سؤال اول انتخاب کرده (بی هیچ پیش‌فرضی).
 * `decisions` = پاسخ‌های بعدی، به همان ترتیبی که پرسیده شده‌اند.
 *
 * برمی‌گرداند: ردیف‌های کسر تا این لحظه، و اگر هنوز کسری مانده، **سؤال بعدی**.
 * هیچ‌جا حدس نمی‌زند و هیچ‌وقت خودش انبار دیگری را انتخاب نمی‌کند.
 */
export function resolveLine(
  line: StockSourceLine,
  primaryKey: string | null,
  decisions: StockLineDecision[] = []
): StockLineResolution {
  const byKey = new Map(line.sources.map((s) => [optionKey(s), s]))
  const base: StockLineResolution = {
    variantId: line.variantId,
    entries: [],
    usedKeys: [],
    pending: null,
    complete: false,
    error: null
  }
  if (!primaryKey) return base

  let cursor = byKey.get(primaryKey)
  if (!cursor) return { ...base, error: `منبع «${primaryKey}» برای این قلم شناخته نشد.` }

  const used = new Set<string>()
  /** جمع برداشت از هر منبع (چون یک منبع می‌تواند دو بار در زنجیره بیاید) */
  const taken = new Map<string, number>()
  const order: string[] = []
  let remaining = Math.max(0, Math.round(line.requested))
  let i = 0

  const addTaken = (key: string, qty: number) => {
    if (!order.includes(key)) order.push(key)
    taken.set(key, (taken.get(key) ?? 0) + qty)
  }

  // حالت مرزی: قلم با تعداد صفر (نباید پیش بیاید، ولی بی‌صدا هم نباید بشکند)
  if (remaining === 0) return { ...base, usedKeys: [], complete: true }

  for (;;) {
    const key = optionKey(cursor)
    if (used.has(key)) return { ...base, error: `انبار «${cursor.name}» دو بار در زنجیره‌ی همین قلم آمده است.` }
    used.add(key)

    const available = Math.max(0, Math.round(cursor.available))
    const take = Math.min(remaining, available)
    if (take > 0) addTaken(key, take)
    remaining -= take

    if (remaining <= 0) break

    const candidates = line.sources.filter((s) => !used.has(optionKey(s)) && s.matched && Math.round(s.available) > 0)

    const decision = decisions[i]
    if (!decision) {
      return {
        ...base,
        entries: buildEntries(order, byKey, taken),
        usedKeys: [...used],
        pending: { source: cursor, taken: take, shortfall: remaining, candidates },
        complete: false
      }
    }
    i++

    if (decision.type === 'NEGATIVE') {
      addTaken(key, remaining)
      remaining = 0
      break
    }

    const next = byKey.get(decision.key)
    if (!next) return { ...base, error: `انبار انتخاب‌شده «${decision.key}» برای این قلم شناخته نشد.` }
    if (!next.matched)
      return { ...base, error: `انبار «${next.name}» این کالا را ندارد، پس نمی‌تواند منبع کسر باشد.` }
    cursor = next
  }

  return {
    ...base,
    entries: buildEntries(order, byKey, taken),
    usedKeys: [...used],
    pending: null,
    complete: true
  }
}

function buildEntries(
  order: string[],
  byKey: Map<string, StockSourceOption>,
  taken: Map<string, number>
): StockAllocationEntry[] {
  const out: StockAllocationEntry[] = []
  for (const key of order) {
    const o = byKey.get(key)
    if (!o) continue
    const qty = Math.round(taken.get(key) ?? 0)
    if (qty <= 0) continue
    const after = Math.round(o.available) - qty
    out.push(entryOf(o, qty, after, after < 0))
  }
  return out
}

/** آیا این قلم با انبارِ انتخاب‌شده بدون هیچ سؤالی تمام می‌شود؟ */
export function lineIsCovered(line: StockSourceLine, primaryKey: string): boolean {
  const r = resolveLine(line, primaryKey, [])
  return r.complete && !r.error
}

// ===========================================================================
// اعتبارسنجی شکلی — همان چیزی که سرور *قبل از* هر نوشتنی می‌سنجد
// ===========================================================================

export function normalizePlan(raw: unknown): StockAllocationPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const lines = (raw as any).lines
  if (!Array.isArray(lines)) return null
  const out: StockPlanLine[] = []
  for (const l of lines) {
    const variantId = Number(l?.variantId)
    if (!Number.isInteger(variantId) || variantId <= 0) continue
    const entries: StockAllocationEntry[] = []
    for (const e of Array.isArray(l?.entries) ? l.entries : []) {
      const qty = Math.round(Number(e?.qty) || 0)
      if (qty <= 0) continue
      const kind = e?.kind === StockSourceKind.WAREHOUSE ? StockSourceKind.WAREHOUSE : StockSourceKind.STORE
      entries.push({
        kind,
        warehouseId: kind === StockSourceKind.STORE ? null : normalizeWarehouseId(e?.warehouseId),
        warehouseName: sourceLabel(kind, e?.warehouseName),
        qty,
        balanceAfter: e?.balanceAfter == null ? null : Math.round(Number(e.balanceAfter) || 0),
        wentNegative: e?.wentNegative === true
      })
    }
    if (entries.length) out.push({ variantId, entries })
  }
  return out.length ? { lines: out } : null
}

/**
 * قاعده‌های شکلی برنامه (بی هیچ دسترسی به دیتابیس):
 *   ۱) هر قلم فاکتور باید دقیقاً یک ردیف در برنامه داشته باشد،
 *   ۲) جمع تعدادهای هر قلم = تعداد فروش همان قلم،
 *   ۳) هیچ منبعی در یک قلم تکرار نشده باشد،
 *   ۴) برنامه قلمی نداشته باشد که در فاکتور نیست.
 */
export function planShapeErrors(
  plan: StockAllocationPlan | null,
  lines: { variantId: number; qty: number; name?: string }[]
): string[] {
  const errors: string[] = []
  if (!plan) return ['برنامه‌ی کسر موجودی خالی است.']
  const want = new Map<number, number>()
  const nameOf = new Map<number, string>()
  for (const l of lines) {
    const id = Number(l.variantId)
    want.set(id, (want.get(id) ?? 0) + Math.round(l.qty))
    if (l.name) nameOf.set(id, l.name)
  }
  const seen = new Set<number>()
  for (const pl of plan.lines) {
    if (seen.has(pl.variantId)) {
      errors.push(`کالای ${pl.variantId} دو بار در برنامه‌ی کسر آمده است.`)
      continue
    }
    seen.add(pl.variantId)
    if (!want.has(pl.variantId)) {
      errors.push(`«${nameOf.get(pl.variantId) ?? pl.variantId}» در فاکتور نیست ولی در برنامه‌ی کسر آمده است.`)
      continue
    }
    const keys = new Set<string>()
    for (const e of pl.entries) {
      const k = optionKey(e)
      if (keys.has(k)) errors.push(`در «${nameOf.get(pl.variantId) ?? pl.variantId}» منبع «${e.warehouseName}» دو بار آمده است.`)
      keys.add(k)
    }
    const sum = pl.entries.reduce((s, e) => s + e.qty, 0)
    const need = want.get(pl.variantId) ?? 0
    if (sum !== need)
      errors.push(
        `جمع کسر «${nameOf.get(pl.variantId) ?? pl.variantId}» ${sum} است ولی تعداد فروشش ${need} — برنامه‌ی کسر کامل نیست.`
      )
  }
  for (const [id, qty] of want)
    if (!seen.has(id) && qty > 0) errors.push(`برای «${nameOf.get(id) ?? id}» هیچ انباری انتخاب نشده است.`)
  return errors
}

// ===========================================================================
// خلاصه‌ی کسری‌ها (بند ۳) — یک تابع، دو مصرف‌کننده (پنجره و نتیجه‌ی فاکتور)
// ===========================================================================

export interface ShortageSummaryRow {
  variantId: number
  itemName: string
  qty: number
  balanceAfter: number | null
  wentNegative: boolean
}

export interface ShortageSummaryGroup {
  sourceKey: string
  kind: StockSourceKind
  warehouseId: number | null
  warehouseName: string
  rows: ShortageSummaryRow[]
  totalQty: number
  negativeCount: number
}

/** برنامه را «به تفکیک انبار» گروه می‌کند — ترتیب: فروشگاه اول، بعد انبارها. */
export function summarizePlan(
  plan: StockAllocationPlan | null,
  nameOf: (variantId: number) => string
): ShortageSummaryGroup[] {
  if (!plan) return []
  const groups = new Map<string, ShortageSummaryGroup>()
  for (const line of plan.lines) {
    for (const e of line.entries) {
      const key = optionKey(e)
      let g = groups.get(key)
      if (!g) {
        g = {
          sourceKey: key,
          kind: e.kind,
          warehouseId: e.warehouseId,
          warehouseName: sourceLabel(e.kind, e.warehouseName),
          rows: [],
          totalQty: 0,
          negativeCount: 0
        }
        groups.set(key, g)
      }
      g.rows.push({
        variantId: line.variantId,
        itemName: nameOf(line.variantId),
        qty: e.qty,
        balanceAfter: e.balanceAfter,
        wentNegative: e.wentNegative
      })
      g.totalQty += e.qty
      if (e.wentNegative) g.negativeCount++
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === StockSourceKind.STORE ? -1 : 1
    return (a.warehouseId ?? 0) - (b.warehouseId ?? 0)
  })
}

/**
 * همان خلاصه، به‌صورت خطِ متنی آماده — برای رسید چاپی، پیام پنل و AuditLog.
 * مثال: «انبار مرکزی: شلوار مردانه ۲ عدد (بعد از کسر ۲−)»
 */
export function summaryTextLines(
  groups: ShortageSummaryGroup[],
  fa: (v: string | number) => string = String
): string[] {
  return groups.map((g) => {
    const parts = g.rows.map((r) => {
      const after =
        r.balanceAfter == null
          ? ''
          : ` (بعد از کسر ${r.balanceAfter < 0 ? `${fa(Math.abs(r.balanceAfter))}−` : fa(r.balanceAfter)})`
      return `${r.itemName} ${fa(r.qty)}${after}`
    })
    return `${g.warehouseName}: ${parts.join(' · ')}`
  })
}

/**
 * توضیح تطبیق متنی، برای وقتی که سمت main در دسترس نیست (فقط پشتیبان نمایشی).
 * منبع اصلی همان `MATCH_REASON_LABELS` در `SecondaryStockService` است.
 */
export const MATCH_REASON_LABELS_FALLBACK: Record<number, string> = {
  1: 'کد ردیف = کد کالا',
  2: 'کد ردیف = بارکد کالا',
  3: 'نام ردیف = نام کامل کالا',
  4: 'نام ردیف = نام پایه‌ی کالا'
}

/** یک خط کوتاه برای ستون جدول/رسید: «فروشگاه ۳ · انبار شعبه ۲ ⚠» */
export function summaryShortLine(
  groups: ShortageSummaryGroup[],
  fa: (v: string | number) => string = String
): string {
  return groups
    .map((g) => `${g.warehouseName} ${fa(g.totalQty)}${g.negativeCount > 0 ? ' ⚠' : ''}`)
    .join(' · ')
}

/**
 * جلسه ۵۳ — آیا این خلاصه جایی موجودی را منفی کرده است؟ همان علامتی که
 * `summaryShortLine` با ⚠ می‌گذارد، به شکل بولین (برای رسید چاپی و رنگ ستون).
 */
export const summaryHasNegative = (groups: ShortageSummaryGroup[]): boolean =>
  groups.some((g) => g.negativeCount > 0)

/** آیا این برنامه جایی موجودی را منفی می‌کند؟ */
export const planHasNegative = (plan: StockAllocationPlan | null): boolean =>
  !!plan && plan.lines.some((l) => l.entries.some((e) => e.wentNegative))

/** جمع سهم انبار فروشگاه در برنامه — همان چیزی که `inventoryService.decrease` می‌گیرد. */
export function storeLinesOf(plan: StockAllocationPlan | null): { variantId: number; qty: number }[] {
  if (!plan) return []
  const map = new Map<number, number>()
  for (const l of plan.lines)
    for (const e of l.entries)
      if (e.kind === StockSourceKind.STORE) map.set(l.variantId, (map.get(l.variantId) ?? 0) + e.qty)
  return [...map.entries()].filter(([, qty]) => qty > 0).map(([variantId, qty]) => ({ variantId, qty }))
}

/** جمع سهم انبارهای ماژول انبار مرکزی. */
export function warehouseEntriesOf(
  plan: StockAllocationPlan | null
): { variantId: number; entry: StockAllocationEntry }[] {
  if (!plan) return []
  const out: { variantId: number; entry: StockAllocationEntry }[] = []
  for (const l of plan.lines)
    for (const e of l.entries) if (e.kind === StockSourceKind.WAREHOUSE) out.push({ variantId: l.variantId, entry: e })
  return out
}

// ===========================================================================
// جلسه ۵۰ · مرحله ۱-ب — «برداشت از کدام انبار» در سند تعویض، قابل‌ردیابی
// ---------------------------------------------------------------------------
// تعویض کالا (`SalesService.createExchange`) از قبل کمبود کالای جایگزین را — و
// فقط با تیک روشن — از **انبار مرکزی پیش‌فرض** برمی‌دارد. رفتارش درست است و
// عوض نمی‌شود؛ تنها مشکل این بود که **هیچ‌جا ثبت نمی‌شد**: نه در نتیجه‌ی
// برگشتی به پنل، نه در سابقه، نه در گزارش. پس اگر بعداً بین موجودی انبار مرکزی
// و انبار فروشگاه مغایرتی دیده می‌شد، راهی برای ردیابی‌اش نبود.
//
// چرا در `SaleReturn.note` و نه یک ستون تازه؟ چون `exchangeList` از قبل
// `note` هر ردیف را در گزارش تعویض برمی‌گرداند، پس بی هیچ migration و بی هیچ
// ستون تازه‌ای در دیتابیس، سابقه پایدار می‌شود. برای اینکه خواندنش «تطبیق متن
// شکننده» نباشد، یک **تگ ثابت** + دو تابع خالص (ساخت/خواندن) اینجا زندگی
// می‌کنند و همین‌جا تست می‌شوند.
//
// ⚠️ متن پشت تگ عمداً **خوانا** است (نه JSON)، چون همین `note` روی «سند برگشت/
// تعویض» چاپ می‌شود (`PrintService` ⇒ `d.note`) و در خروجی اکسل تب برگشت هم
// می‌آید. پس هم آدم می‌خواندش، هم `parseCentralWithdrawNote` می‌فهمدش.
// ===========================================================================

/** تگ ثابتِ بخش «برداشت از انبار» در `SaleReturn.note`. هیچ‌وقت ترجمه/عوض نشود. */
export const CENTRAL_WITHDRAW_TAG = '[برداشت-انبار]'

/** جداکننده‌ی بین دو انبار در متن تگ. */
const WITHDRAW_PAIR_SEP = '؛'
/** جداکننده‌ی «نام انبار» از «تعداد». */
const WITHDRAW_KV_SEP = ':'
/** جداکننده‌ی بخش‌های خودِ `note` (همان چیزی که پروژه از قبل استفاده می‌کند). */
const NOTE_PART_SEP = ' · '

/** جمع برداشت از یک انبار مشخص. */
export interface CentralWithdrawNoteLine {
  /** snapshot نام انبار در همان لحظه */
  name: string
  qty: number
}

export interface CentralWithdrawNoteInfo {
  warehouses: CentralWithdrawNoteLine[]
  totalQty: number
}

/** رقم فارسی/عربی ⇒ رقم لاتین. فقط برای *خواندن* عددی که خودمان نوشته‌ایم. */
function latinDigits(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0) // ۰-۹ فارسی
    else if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660) // ٠-٩ عربی
    else out += ch
  }
  return out
}

/**
 * نام انبار را برای نشستن داخل تگ بی‌خطر می‌کند: جداکننده‌ها و خودِ کاراکترهای
 * تگ به فاصله تبدیل می‌شوند تا خواندن دوباره هیچ‌وقت ابهام پیدا نکند. داده‌ی
 * معتبر همان فیلدهای برگشتی سرویس است؛ این متن *سابقه‌ی خوانا*ست.
 */
const safeWarehouseName = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/[;؛:[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || DEFAULT_CENTRAL_WAREHOUSE_LABEL

/**
 * `CentralWithdrawLine[]` (خروجی `secondaryStockService.coverShortage`) را به
 * «جمع برداشت به تفکیک انبار» تبدیل می‌کند. ساختاری تایپ شده تا این فایل
 * `@shared/types` را هم import نکند (قاعده‌ی «بی وابستگی» همین فایل).
 *
 * منبع عدد، `sources[].taken` است (نه `line.taken`)، چون فقط همان ردیف‌ها
 * می‌گویند برداشت از *کدام* انبار بوده است. اگر ردیفی نام انبار نداشت،
 * «انبار مرکزی» (انبار پیش‌فرض) شمرده می‌شود — همان قاعده‌ی `sourceLabel`.
 */
export function centralWithdrawGroups(
  taken: readonly {
    sources?: readonly { taken?: number; warehouseName?: string | null }[] | null
  }[] | null | undefined
): CentralWithdrawNoteLine[] {
  const sums = new Map<string, number>()
  for (const line of taken ?? []) {
    for (const s of line?.sources ?? []) {
      const qty = Math.round(Number(s?.taken) || 0)
      if (qty <= 0) continue
      const name = safeWarehouseName(s?.warehouseName)
      sums.set(name, (sums.get(name) ?? 0) + qty)
    }
  }
  return [...sums.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
}

/** جمع کل برداشت. */
export const centralWithdrawTotal = (warehouses: readonly CentralWithdrawNoteLine[]): number =>
  warehouses.reduce((s, w) => s + Math.max(0, Math.round(w.qty)), 0)

/**
 * یک خط کوتاه و خوانا: «انبار مرکزی ۲ · انبار شعبه ۳».
 * برای پیام نتیجه‌ی پنل، ستون گزارش و متن AuditLog — یک جمله در هر سه جا.
 */
export function centralWithdrawShortLine(
  warehouses: readonly CentralWithdrawNoteLine[],
  fa: (v: string | number) => string = String
): string {
  return warehouses.map((w) => `${w.name} ${fa(w.qty)}`).join(NOTE_PART_SEP)
}

/**
 * جمله‌ی کاملِ «چه چیزی از کجا برداشته شد» — همان متنی که پنل تعویض، سابقه و
 * گزارش نشان می‌دهند.
 */
export function centralWithdrawSentence(
  warehouses: readonly CentralWithdrawNoteLine[],
  fa: (v: string | number) => string = String
): string {
  if (!warehouses.length) return ''
  const total = centralWithdrawTotal(warehouses)
  return (
    `کمبود کالای جایگزین از انبار مرکزی برداشته شد: ${fa(total)} عدد · ` +
    centralWithdrawShortLine(warehouses, fa)
  )
}

/**
 * متن تگ را به `note` می‌چسباند. اگر برداشتی نبوده، `base` **دست‌نخورده**
 * برمی‌گردد (پس فاکتورهای بی‌برداشت مو‌به‌مو همان note قبلی را دارند).
 *
 * عدد داخل تگ با همان `fa` نوشته می‌شود که بقیه‌ی پروژه استفاده می‌کند؛
 * `parseCentralWithdrawNote` هر دو شکل رقم را می‌خواند.
 */
export function buildCentralWithdrawNote(
  base: string | null | undefined,
  warehouses: readonly CentralWithdrawNoteLine[],
  fa: (v: string | number) => string = String
): string {
  const head = String(base ?? '').trim()
  const live = warehouses.filter((w) => Math.round(w.qty) > 0)
  if (!live.length) return head
  const body = live
    .map((w) => `${safeWarehouseName(w.name)}${WITHDRAW_KV_SEP} ${fa(Math.round(w.qty))}`)
    .join(`${WITHDRAW_PAIR_SEP} `)
  const tagged = `${CENTRAL_WITHDRAW_TAG} ${body}`
  return head ? `${head}${NOTE_PART_SEP}${tagged}` : tagged
}

/**
 * تگ را از `note` می‌خواند. `null` یعنی این سند هیچ برداشتی از انبار مرکزی
 * نداشته (یا از قبل از جلسه ۵۰ است) — که **دقیقاً همان معنای «کسر از انبار
 * فروشگاه»** است و نباید خطا شمرده شود.
 */
export function parseCentralWithdrawNote(note: string | null | undefined): CentralWithdrawNoteInfo | null {
  const text = String(note ?? '')
  const at = text.indexOf(CENTRAL_WITHDRAW_TAG)
  if (at < 0) return null
  const body = text.slice(at + CENTRAL_WITHDRAW_TAG.length).trim()
  if (!body) return null
  const warehouses: CentralWithdrawNoteLine[] = []
  for (const part of body.split(WITHDRAW_PAIR_SEP)) {
    const chunk = part.trim()
    if (!chunk) continue
    const cut = chunk.lastIndexOf(WITHDRAW_KV_SEP)
    if (cut <= 0) continue
    const name = chunk.slice(0, cut).trim()
    const qty = parseInt(latinDigits(chunk.slice(cut + 1)).replace(/[^\d-]/g, ''), 10)
    if (!name || !Number.isFinite(qty) || qty <= 0) continue
    warehouses.push({ name, qty })
  }
  if (!warehouses.length) return null
  return { warehouses, totalQty: centralWithdrawTotal(warehouses) }
}

/** همان `note` بی بخشِ تگ — برای جایی که فقط «توضیح کاربر» باید دیده شود. */
export function stripCentralWithdrawNote(note: string | null | undefined): string {
  const text = String(note ?? '')
  const at = text.indexOf(CENTRAL_WITHDRAW_TAG)
  if (at < 0) return text.trim()
  let head = text.slice(0, at).trim()
  if (head.endsWith('·')) head = head.slice(0, -1).trim()
  return head
}

// ===========================================================================
// جلسه ۵۱ · مرحله ۲-الف — «کسر از انبار» در فاکتور فروش عمده
// ---------------------------------------------------------------------------
// در این مرحله کاربر **یک انبار** را برای کل فاکتور انتخاب می‌کند (پیش‌فرض
// «انبار فروشگاه») و همه‌ی اقلام از همان انبار کم می‌شوند. پنجره‌ی زنجیره‌ای
// (مرحله ۲-ب) هنوز ساخته نشده است، پس اگر برای قلمی کسری بیفتد **فقط یک تأیید
// صریحِ «با منفی ادامه بدهم؟»** گرفته می‌شود و باقی‌مانده روی همان انبارِ
// انتخاب‌شده منفی می‌رود. هیچ‌جا انبار دیگری حدس زده نمی‌شود — همان قاعده‌ی
// مالک: «سیستم هرگز خودش از انبار دیگری کم نکند مگر تیک روشن باشد».
//
// چرا همه‌ی منطقش اینجاست و نه در `SalesInvoice.tsx`؟ چون این فایل بی
// `node_modules` تست می‌شود؛ صفحه‌ی رندرر فقط «سؤال بپرس و بفرست» است.
//
// ⚠️ بدون شکستن هیچ چیزِ قبلی: همه‌ی صادرشده‌های این بخش **تازه** اند.
// ===========================================================================

/** متن‌های ثابت انتخاب انبار در فاکتور عمده (مرحله ۲-الف). */
export const STOCK_PICK_TEXT = {
  label: 'کسر از انبار',
  hintStore:
    'پیش‌فرض: همه‌ی اقلام از «انبار فروشگاه» کم می‌شوند (مثل قبل). با تیک «برداشت خودکار از انبار مرکزی»، کمبود هر قلم بی هیچ سؤالی از انبار مرکزی پیش‌فرض برداشته می‌شود.',
  hintWarehouse:
    'همه‌ی اقلام این فاکتور از همین انبار کم می‌شوند و موجودی انبار فروشگاه دست‌نخورده می‌ماند. اگر موجودی کم بیاید، قبل از ثبت پرسیده می‌شود.',
  autoOnlyStore: 'تیک «برداشت خودکار از انبار مرکزی» فقط برای «انبار فروشگاه» معنا دارد.',
  cancelled: 'ثبت فاکتور لغو شد؛ هیچ چیزی ثبت نشد و موجودی هیچ انباری عوض نشد.',
  summaryTitle: 'مبدأ کسر این فاکتور',
  /**
   * جلسه ۵۳ · مرحله ۴ — متن‌های *نمایشی*. یک‌جا نگه داشته می‌شوند تا رسید چاپی،
   * ستون فهرست فاکتورهای عمده، جدول گزارش فروش، چاپ A4 و خروجی اکسل هیچ‌وقت
   * سه عنوان متفاوت نشان ندهند.
   */
  columnTitle: 'مبدأ کسر',
  columnExplainer:
    'اقلام این فاکتور از این انبار(ها) کم شده‌اند. علامت ⚠ یعنی موجودی آن انبار منفی شده است. ' +
    'خالی («—») یعنی این فاکتور «دفتر مبدأ» ندارد و مثل قبل کاملاً از انبار فروشگاه کم شده است — ' +
    'رفتار همه‌ی فاکتورهای قبل از جلسه ۴۷ و فروش تکیِ بی‌برنامه.',
  /** خانه‌ی خالی ستون — همان چیزی که فاکتور بی‌دفتر نشان می‌دهد. */
  emptyCell: '—',
  /** تیتر بلوک کوچکِ روی رسید چاپی و چاپ A4 */
  receiptTitle: 'مبدأ کسر',
  /** خط هشدار رسید، فقط وقتی جایی منفی شده باشد */
  receiptNegativeNote: '⚠ موجودی این انبار با این کسر منفی شد.',
  /** ویرایش فاکتورِ قبل از جلسه ۴۷ (بی دفتر مبدأ) — همان مسیر قدیمی می‌ماند. */
  legacyEdit:
    'این فاکتور قبلاً بی «مبدأ کسر» ثبت شده است، پس ویرایشش مثل قبل از انبار فروشگاه حساب می‌شود و انتخاب انبار روی آن اثری ندارد.'
} as const

/** یک گزینه‌ی منوی «کسر از انبار» — دقیقاً همان شکل `StockSourcePreview.options` + کلید. */
export interface StockPickOption {
  key: string
  kind: StockSourceKind
  warehouseId: number | null
  name: string
  location: string | null
  isDefaultWarehouse: boolean
}

/** کلید گزینه‌ی «انبار فروشگاه» — پیش‌فرض منو. */
export const STORE_PICK_KEY = sourceKey(StockSourceKind.STORE, null)

/**
 * منوی «کسر از انبار» را از همان `warehouseList` موجود می‌سازد (بی هیچ کانال
 * تازه‌ای). ترتیب و کلیدها **مو‌به‌مو** همان چیزی است که
 * `StockAllocationService.preview` برمی‌گرداند، پس کلید انتخابیِ منو همیشه در
 * `line.sources` پیدا می‌شود:
 *   ۱) انبار فروشگاه · ۲) انبار پیش‌فرض ماژول انبار مرکزی (همیشه `WH:null`،
 *   حتی اگر ردیف واقعی داشته باشد) · ۳) هر انبار **فعال** دیگر.
 * انبار غیرفعال گزینه نمی‌شود.
 */
export function stockPickOptions(
  warehouses:
    | readonly {
        id?: number | null
        name?: string | null
        isDefault?: boolean | null
        isActive?: boolean | null
        location?: string | null
      }[]
    | null
    | undefined
): StockPickOption[] {
  const list = warehouses ?? []
  const realDefault = list.find((w) => w?.isDefault === true) ?? null
  const out: StockPickOption[] = [
    {
      key: STORE_PICK_KEY,
      kind: StockSourceKind.STORE,
      warehouseId: null,
      name: STORE_SOURCE_LABEL,
      location: null,
      isDefaultWarehouse: false
    },
    {
      key: sourceKey(StockSourceKind.WAREHOUSE, null),
      kind: StockSourceKind.WAREHOUSE,
      warehouseId: null,
      name: String(realDefault?.name ?? '').trim() || DEFAULT_CENTRAL_WAREHOUSE_LABEL,
      location: realDefault?.location ?? null,
      isDefaultWarehouse: true
    }
  ]
  for (const w of list) {
    if (w?.isDefault === true) continue
    if (w?.isActive === false) continue
    const id = normalizeWarehouseId(w?.id)
    if (id == null) continue
    const key = sourceKey(StockSourceKind.WAREHOUSE, id)
    if (out.some((o) => o.key === key)) continue
    out.push({
      key,
      kind: StockSourceKind.WAREHOUSE,
      warehouseId: id,
      name: String(w?.name ?? '').trim() || `انبار ${id}`,
      location: w?.location ?? null,
      isDefaultWarehouse: false
    })
  }
  return out
}

/** یک قلمِ کسری‌دار در انبارِ انتخاب‌شده. */
export interface StockPickShortage {
  variantId: number
  itemName: string
  unit: string
  sourceKey: string
  sourceName: string
  requested: number
  /** موجودی قابل برداشت همان انبار در لحظه‌ی پیش‌نمایش */
  available: number
  taken: number
  shortfall: number
  /** انبارهای دیگری که همین کالا را دارند — فقط برای *نمایش* (مرحله ۲-ب مصرفش می‌کند). */
  candidates: { key: string; name: string; available: number }[]
}

export interface StockPickDraft {
  /** برنامه‌ی آماده‌ی ارسال. `null` یعنی هنوز کامل نیست (کسری یا خطا). */
  plan: StockAllocationPlan | null
  shortages: StockPickShortage[]
  errors: string[]
  complete: boolean
}

/**
 * برنامه‌ی کسر «همه از یک انبار» را از خروجی `preview` می‌سازد.
 *
 * دو بار صدا زده می‌شود:
 *   ۱) `allowNegative: false` (کاوش) ⇒ اگر همه‌ی اقلام کافی بودند، `plan` آماده
 *      است و هیچ سؤالی لازم نیست. وگرنه `shortages` می‌گوید کدام قلم چقدر کم است.
 *   ۲) `allowNegative: true` (بعد از تأیید صریح کاربر) ⇒ باقی‌مانده‌ی هر قلم روی
 *      **همان انبار انتخاب‌شده** منفی می‌رود و `plan` کامل می‌شود.
 *
 * هیچ‌وقت خودش انبار دیگری را انتخاب نمی‌کند و هیچ‌وقت چیزی نمی‌نویسد.
 */
export function buildSingleSourcePlan(
  lines: readonly StockSourceLine[] | null | undefined,
  primaryKey: string,
  opts: { allowNegative?: boolean } = {}
): StockPickDraft {
  const decisions: StockLineDecision[] = opts.allowNegative === true ? [{ type: 'NEGATIVE' }] : []
  const planLines: StockPlanLine[] = []
  const shortages: StockPickShortage[] = []
  const errors: string[] = []
  let complete = true

  for (const line of lines ?? []) {
    if (Math.round(line.requested) <= 0) continue
    const r = resolveLine(line, primaryKey, decisions)
    if (r.error) {
      errors.push(r.error)
      complete = false
      continue
    }
    if (r.pending) {
      const p = r.pending
      shortages.push({
        variantId: line.variantId,
        itemName: line.name,
        unit: line.unit,
        sourceKey: optionKey(p.source),
        sourceName: sourceLabel(p.source.kind, p.source.name),
        requested: Math.round(line.requested),
        available: Math.max(0, Math.round(p.source.available)),
        taken: Math.round(p.taken),
        shortfall: Math.round(p.shortfall),
        candidates: p.candidates.map((c) => ({
          key: optionKey(c),
          name: sourceLabel(c.kind, c.name),
          available: Math.round(c.available)
        }))
      })
      complete = false
      continue
    }
    if (r.entries.length) planLines.push({ variantId: line.variantId, entries: r.entries })
  }

  return {
    plan: complete && planLines.length ? { lines: planLines } : null,
    shortages,
    errors,
    complete: complete && errors.length === 0
  }
}

/** یک خط توضیح برای هر قلمِ کسری‌دار. */
export function shortageTextLines(
  shortages: readonly StockPickShortage[],
  fa: (v: string | number) => string = String
): string[] {
  return shortages.map(
    (s) =>
      `«${s.itemName}» در «${s.sourceName}» — نیاز ${fa(s.requested)} ${s.unit} · ` +
      `موجودی ${fa(s.available)} · کسری ${fa(s.shortfall)}` +
      (s.candidates.length
        ? ` (موجود در: ${s.candidates.map((c) => `${c.name} ${fa(c.available)}`).join(' · ')})`
        : '')
  )
}

/** جمله‌ی سرِ تأیید: «موجودی «انبار …» برای «…» کم است». */
export function shortageHeadline(
  shortages: readonly StockPickShortage[],
  fa: (v: string | number) => string = String
): string {
  if (!shortages.length) return ''
  const houses = [...new Set(shortages.map((s) => s.sourceName))]
  const where = houses.map((h) => `«${h}»`).join(' و ')
  if (shortages.length === 1) return `موجودی ${where} برای «${shortages[0].itemName}» کم است.`
  return `موجودی ${where} برای ${fa(shortages.length)} قلم این فاکتور کم است.`
}

/** آیا این خطا همان «برنامه دیگر معتبر نیست» است؟ (⇒ preview دوباره اجرا شود) */
export const isStalePlanMessage = (msg: unknown): boolean =>
  String((msg as any)?.message ?? msg ?? '').includes(STOCK_PLAN_STALE_CODE)

/** خط کوتاه خلاصه‌ی یک برنامه — «انبار فروشگاه ۳ · انبار شعبه ۲ ⚠». */
export function planShortLine(
  plan: StockAllocationPlan | null,
  nameOf: (variantId: number) => string,
  fa: (v: string | number) => string = String
): string {
  return summaryShortLine(summarizePlan(plan, nameOf), fa)
}

/**
 * تصمیم «این ثبت/ویرایش با چه مسیری برود؟» — عمداً یک تابع خالص، چون همین چند
 * بولین تمام قاعده‌ی مالک را تعیین می‌کنند و باید بی رندرر تست شوند:
 *
 *   • `autoPath`  ⇒ انبار فروشگاه + تیک روشن: **هیچ برنامه‌ای فرستاده نمی‌شود** و
 *     رفتار خودکار قبلی (کمبود از انبار مرکزی پیش‌فرض، بی سؤال) دست‌نخورده می‌ماند.
 *   • `planPath`  ⇒ برنامه‌ی کسر ساخته و فرستاده می‌شود (با سؤال در صورت کسری).
 *   • `legacyEdit` ⇒ ویرایش فاکتوری که **دفتر مبدأ ندارد** (قبل از جلسه ۴۷).
 *     برایش عمداً برنامه فرستاده نمی‌شود: مسیر ویرایشِ سرور فقط وقتی مبدأهای قبلی
 *     را برمی‌گرداند که دفتر داشته باشد، پس فرستادن برنامه برای فاکتور بی‌دفتر
 *     باعث کسر دوباره می‌شد. (شرح کامل در CHANGELOG جلسه ۵۱.)
 *   • ویرایش فاکتورِ **دفتردار** همیشه `planPath` است، چون سرور ویرایشِ بی‌برنامه‌ی
 *     چنین فاکتوری را رد می‌کند.
 */
export interface StockPathInput {
  /** سوییچ «کسر از موجودی انبار» همین فاکتور */
  deductInventory: boolean
  /** مبدأ انتخاب‌شده «انبار فروشگاه» است؟ */
  storePicked: boolean
  /** تیک «برداشت خودکار از انبار مرکزی» */
  autoCentral: boolean
  /** در حالت ویرایش فاکتور ثبت‌شده هستیم؟ */
  editing: boolean
  /** همان فاکتور دفتر مبدأ (`SaleItemStockAllocation`) دارد؟ */
  hasLedger: boolean
}

export interface StockPathDecision {
  legacyEdit: boolean
  autoPath: boolean
  planPath: boolean
  /** تیک خودکار اجازه‌ی تغییر دارد؟ (فقط برای «انبار فروشگاه») */
  autoAllowed: boolean
}

export function stockPathFor(input: StockPathInput): StockPathDecision {
  const legacyEdit = input.editing === true && input.hasLedger !== true
  const autoAllowed = input.storePicked === true
  const ledgerEdit = input.editing === true && input.hasLedger === true
  const autoPath = autoAllowed && input.autoCentral === true && !ledgerEdit
  const planPath = input.deductInventory === true && !autoPath && !legacyEdit
  return { legacyEdit, autoPath, planPath, autoAllowed }
}

// ===========================================================================
// جلسه ۵۱ · مرحله ۲-ب — زنجیره‌ی سؤال‌های کسری برای **همه‌ی اقلام در یک پنجره**
// ---------------------------------------------------------------------------
// `resolveLine` زنجیره‌ی *یک قلم* را جلو می‌برد. پنجره باید همه‌ی اقلام کسری‌دار
// را با هم نشان بدهد، پس این تابع همان `resolveLine` را برای هر قلم صدا می‌زند و
// وضعیت کل فاکتور را در یک شکل می‌دهد: «سؤال باز هر قلم» + «برنامه‌ی نهایی، اگر
// همه تمام شده‌اند». هیچ منطق تازه‌ای اینجا نیست و هیچ انباری حدس زده نمی‌شود —
// پنجره فقط نمایش‌دهنده است.
// ===========================================================================

export interface StockChainLine {
  variantId: number
  itemName: string
  unit: string
  requested: number
  /** انباری که کاربر در سؤال اول انتخاب کرده (مبدأ همین قلم) */
  primaryName: string
  entries: StockAllocationEntry[]
  /** سؤال بازِ همین لحظه (null = این قلم تمام است) */
  pending: StockLinePending | null
  complete: boolean
  error: string | null
  /** چند تصمیم تا حالا برای این قلم گرفته شده (برای دکمه‌ی «یک قدم به عقب») */
  steps: number
}

export interface StockChainState {
  lines: StockChainLine[]
  /** فقط قلم‌هایی که همین حالا سؤال باز دارند */
  open: StockChainLine[]
  errors: string[]
  complete: boolean
  /** برنامه‌ی نهایی — `null` تا وقتی همه‌ی قلم‌ها تمام نشده‌اند */
  plan: StockAllocationPlan | null
}

/**
 * وضعیت زنجیره‌ی کل فاکتور را می‌سازد.
 * `decisionsFor(variantId)` پاسخ‌های داده‌شده‌ی همان قلم را به ترتیب می‌دهد.
 */
export function resolveChain(
  lines: readonly StockSourceLine[] | null | undefined,
  primaryKey: string,
  decisionsFor: (variantId: number) => StockLineDecision[] = () => []
): StockChainState {
  const out: StockChainLine[] = []
  const planLines: StockPlanLine[] = []
  const errors: string[] = []
  let complete = true

  for (const l of lines ?? []) {
    if (Math.round(l.requested) <= 0) continue
    const decisions = decisionsFor(l.variantId) ?? []
    const r = resolveLine(l, primaryKey, decisions)
    const primary = l.sources.find((s) => optionKey(s) === primaryKey) ?? null
    const row: StockChainLine = {
      variantId: l.variantId,
      itemName: l.name,
      unit: l.unit,
      requested: Math.round(l.requested),
      primaryName: primary ? sourceLabel(primary.kind, primary.name) : primaryKey,
      entries: r.entries,
      pending: r.pending,
      complete: r.complete && !r.error,
      error: r.error,
      steps: decisions.length
    }
    out.push(row)
    if (r.error) errors.push(r.error)
    if (!row.complete) complete = false
    else if (r.entries.length) planLines.push({ variantId: l.variantId, entries: r.entries })
  }

  return {
    lines: out,
    open: out.filter((r) => r.pending != null),
    errors,
    complete: complete && errors.length === 0,
    plan: complete && errors.length === 0 && planLines.length ? { lines: planLines } : null
  }
}

/** متن یک سؤال باز: «موجودی «انبار …» تمام شد — کسری «کالا» ۳ عدد». */
export function pendingQuestionText(
  row: StockChainLine,
  fa: (v: string | number) => string = String
): string {
  if (!row.pending) return ''
  const p = row.pending
  return (
    `«${row.itemName}» — نیاز ${fa(row.requested)} ${row.unit} · ` +
    `از «${sourceLabel(p.source.kind, p.source.name)}» ${fa(p.taken)} برداشته شد · ` +
    `کسری ${fa(p.shortfall)} ${row.unit}`
  )
}
