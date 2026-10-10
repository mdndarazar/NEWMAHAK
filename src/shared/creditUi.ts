/**
 * ===========================================================================
 * «مدیریت اعتبار خرید» — لایه‌ی *نمایش* (جلسه ۲۲).
 *
 * ⚠️ این فایل هیچ قاعده‌ی امنیتی/مالی تازه‌ای ندارد و نمی‌تواند داشته باشد.
 * تنها منبع قواعد همان `src/shared/credit.ts` است و تنها نقطه‌ی اعمال، سرویس
 * main (`StoreCreditService.ts`). چیزی که اینجا می‌نشیند فقط سه دسته است:
 *
 *   ۱) **شکل‌دهی ورودی فرم‌ها به Payload کانال‌ها** (`buildIssuePayload`,
 *      `buildBulkPayload`, `buildSettingsPayload`). دلیل وجودشان: فرم‌های این
 *      ماژول بزرگ‌اند و اگر نرمال‌سازی داخل JSX می‌ماند، نه قابل تست بود و نه
 *      قابل بازبینی. Backend *دوباره* همه‌چیز را می‌سنجد (§۲۱) — این لایه فقط
 *      جلوی رفت‌و‌برگشت بی‌فایده و پیام خطای دیرهنگام را می‌گیرد.
 *   ۲) **ردیف‌سازی جدول‌ها و خروجی اکسل** (`CREDIT_LIST_HEADERS` و برادرانش).
 *   ۳) **کارت‌های داشبورد** و برچسب/رنگ وضعیت.
 *
 * چرا shared و نه داخل خود صفحه؟ چون بدون node_modules هیچ تستی نمی‌تواند یک
 * فایل `.tsx` را اجرا کند، ولی همین منطقِ خالص را می‌شود *واقعاً* تست کرد
 * (`test/credit-ui-logic-session22.ts`). پس هر چیزی که «تصمیم» است از JSX
 * بیرون کشیده شده و اینجا نشسته است.
 * ===========================================================================
 */

import {
  CREDIT_ALPHABET_LABELS,
  CREDIT_REPRINT_LABEL,
  CREDIT_PAPER_LABELS,
  CREDIT_SCOPE_LABELS,
  CREDIT_STATUS_LABELS,
  CREDIT_SOURCE_LABELS,
  CreditCodeAlphabet,
  CreditPaper,
  CreditRestrictScope,
  CreditSource,
  CreditStatus,
  MAX_CREDIT_CODE_LENGTH,
  MIN_CREDIT_CODE_LENGTH,
  assessCodeSpace,
  creditAlphabet,
  creditPaperSize,
  isCreditReprint,
  normalizeCreditPrefix,
  normalizeRestrictScope,
  rulesForSource,
  type CreditSettings
} from './credit'

// ---------------------------------------------------------------------------
// ۰) کمک‌کننده‌های کوچک (همه خالص)
// ---------------------------------------------------------------------------

export const intOf = (v: unknown, fallback = 0): number => {
  const n = Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')))
  return Number.isFinite(n) ? n : fallback
}

/**
 * نشست ۱۷۹ (S179-D1، مشاهده‌ی ۱۴۳): خواندن سخت‌گیرانه‌ی عدد صحیح ورودی فرم.
 * هم‌معنای مو‌به‌موی `parseGroupedInteger` در `jalali.ts` (ارقام فارسی/عربی ⇒ لاتین،
 * حذف جداکننده‌ی هزارگان/فاصله، خالی ⇒ ۰، هر چیز دیگر ⇒ null) ولی این‌جا تکرار شده
 * چون این فایل عمداً فقط به `./credit` وابسته است (سوییت‌های test/credit-ui-logic-*.ts
 * همین دو فایل را جدا کپی و اجرا می‌کنند). برابری دو تابع در تست fix-s179 سنجیده می‌شود.
 * بر خلاف `intOf` (فقط نمایش) هیچ چیزی را گرد یا حذف نمی‌کند.
 */
export function parseFormInteger(raw: unknown): number | null {
  const s = String(raw ?? '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\u060C\u066C\s]/g, '')
  if (s === '') return 0
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/** فیلد عددی فرم ⇒ عدد صحیح نامنفی، یا پیام فارسی با نام فیلد/واحد/مقدار (هرگز گرد بی‌صدا). */
export function formIntField(raw: unknown, label: string, unit: string): { value: number; error: null } | { value: null; error: string } {
  const n = parseFormInteger(raw)
  if (n != null) return { value: n, error: null }
  return {
    value: null,
    error:
      `«${label}» باید عدد صحیح و نامنفی (${unit}) باشد؛ مقدار واردشده «${String(raw)}» پذیرفته نیست ` +
      '(اعشار، علامت منفی، حروف یا عدد خیلی بزرگ گرد یا اصلاح نمی‌شود) و چیزی صادر نشد.'
  }
}

export const trimmed = (v: unknown): string => String(v ?? '').trim()
export const orNull = (v: unknown): string | null => trimmed(v) || null

/** فهرست شناسه‌ها ⇒ یکتا، مثبت، مرتب (ورودی خراب = آرایه‌ی خالی). */
export function cleanIds(list: unknown): number[] {
  if (!Array.isArray(list)) return []
  const out: number[] = []
  for (const x of list) {
    const n = Math.round(Number(x))
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

/**
 * کلید Idempotency یک عملیات مصرف (§۲۱).
 *
 * **هر بار زدن دکمه‌ی ثبت** یک کلید تازه می‌گیرد؛ ولی اگر همان درخواست به‌خاطر
 * Timeout یا دوبار-کلیکِ *همان* ثبت دوبار به main برسد، کلید یکی است و مصرف
 * دوبار کم نمی‌شود. پس تصادفی‌بودن اینجا لازم است، نه مضر.
 */
export function newIdempotencyKey(prefix = 'pos'): string {
  let rand = ''
  try {
    const c: any = (globalThis as any).crypto
    if (c?.getRandomValues) {
      const buf = new Uint32Array(2)
      c.getRandomValues(buf)
      rand = `${buf[0].toString(36)}${buf[1].toString(36)}`
    }
  } catch {
    /* پایین می‌افتیم روی Math.random */
  }
  if (!rand) rand = `${Math.floor(Math.random() * 0xffffffff).toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`
  return `${prefix}:${Date.now().toString(36)}:${rand}`
}

/** رنگ‌بندی وضعیت، یکسان در فهرست و داشبورد و جزئیات. */
export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'muted' | 'plain' {
  switch (String(status ?? '').toUpperCase()) {
    case CreditStatus.ACTIVE:
      return 'good'
    case CreditStatus.PARTIALLY_USED:
      return 'warn'
    case CreditStatus.USED:
      return 'muted'
    case CreditStatus.EXPIRED:
      return 'warn'
    case CreditStatus.CANCELED:
      return 'bad'
    case CreditStatus.SUSPENDED:
      return 'bad'
    case CreditStatus.DRAFT:
      return 'plain'
    default:
      return 'plain'
  }
}

export const TONE_CLASS: Record<string, string> = {
  good: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  warn: 'bg-amber-50 border-amber-300 text-amber-900',
  bad: 'bg-rose-50 border-rose-300 text-rose-900',
  muted: 'bg-slate-50 border-slate-300 text-slate-600',
  plain: 'bg-white border-slate-300 text-slate-800'
}

/** فهرست وضعیت‌ها برای هر `<select>` فیلتر (ترتیب = ترتیب عمر اعتبار). */
export const CREDIT_STATUS_OPTIONS: { value: string; label: string }[] = [
  CreditStatus.DRAFT,
  CreditStatus.ACTIVE,
  CreditStatus.PARTIALLY_USED,
  CreditStatus.USED,
  CreditStatus.EXPIRED,
  CreditStatus.CANCELED,
  CreditStatus.SUSPENDED
].map((s) => ({ value: s, label: CREDIT_STATUS_LABELS[s] ?? s }))

export const CREDIT_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: CreditSource.MANUAL, label: CREDIT_SOURCE_LABELS.MANUAL },
  { value: CreditSource.EXCHANGE, label: CREDIT_SOURCE_LABELS.EXCHANGE },
  /** نشست ۶۱ — فقط برای فیلتر گزارش؛ صدور دستی این نوع در main رد می‌شود */
  { value: CreditSource.OVERPAY, label: CREDIT_SOURCE_LABELS.OVERPAY }
]

export const CREDIT_SCOPE_OPTIONS: { value: string; label: string }[] = [
  CreditRestrictScope.ALL,
  CreditRestrictScope.CATEGORY,
  CreditRestrictScope.VARIANTS
].map((s) => ({ value: s, label: CREDIT_SCOPE_LABELS[s] ?? s }))

// ---------------------------------------------------------------------------
// ۱) داشبورد (§۱۵) — کارت‌ها یک بار اینجا تعریف می‌شوند، نه داخل JSX
// ---------------------------------------------------------------------------

/**
 * جلسه ۴۹ — `CreditTone` در `CreditBadge` استفاده می‌شد ولی **تعریف نشده بود**
 * (خطای واقعی `TS2552`). عیناً همان یونیونِ `DashboardCard.tone` است و حالا
 * هر دو از یک منبع می‌آیند، پس دو تعریف موازی ساخته نشد.
 */
export type CreditTone = 'good' | 'warn' | 'bad' | 'muted' | 'plain'

export interface DashboardCard {
  key: string
  title: string
  /** مقدار عددی خام (نمایشش با money/faDigits در UI) */
  value: number
  kind: 'money' | 'count'
  tone: CreditTone
  hint?: string
}

/** ورودی حداقلیِ کارت‌ساز — عیناً همان `CreditDashboard` سرویس. */
export interface DashboardLike {
  issuedCount: number
  issuedTotal: number
  usedTotal: number
  remainingTotal: number
  activeCount: number
  activeValue: number
  unusedCount: number
  fullyUsedCount: number
  expiredCount: number
  canceledCount: number
  suspendedCount: number
  draftCount: number
  nearExpiryCount: number
  todayCount: number
  liability: number
  liabilityReported: boolean
}

export function dashboardCards(d: DashboardLike | null): DashboardCard[] {
  if (!d) return []
  const cards: DashboardCard[] = [
    { key: 'issuedTotal', title: 'مجموع اعتبار صادرشده', value: d.issuedTotal, kind: 'money', tone: 'plain' },
    { key: 'usedTotal', title: 'مجموع مصرف‌شده', value: d.usedTotal, kind: 'money', tone: 'muted' },
    {
      key: 'remainingTotal',
      title: 'مجموع باقی‌مانده',
      value: d.remainingTotal,
      kind: 'money',
      tone: 'warn',
      hint: 'باقی‌ماندهٔ همه‌ی اعتبارهای این بازه (شامل منقضی و باطل هم می‌شود؛ «تعهد» فقط زنده‌ها را می‌شمارد).'
    },
    {
      key: 'activeValue',
      title: 'ارزش ریالی اعتبارهای فعال',
      value: d.activeValue,
      kind: 'money',
      tone: 'good',
      hint: 'باقی‌ماندهٔ واقعیِ اعتبارهایی که همین حالا قابل مصرف‌اند.'
    },
    { key: 'issuedCount', title: 'تعداد صادرشده', value: d.issuedCount, kind: 'count', tone: 'plain' },
    { key: 'activeCount', title: 'تعداد فعال', value: d.activeCount, kind: 'count', tone: 'good' },
    {
      key: 'unusedCount',
      title: 'استفاده‌نشده',
      value: d.unusedCount,
      kind: 'count',
      tone: 'warn',
      hint: 'هیچ مصرفی نداشته‌اند (نه جزئی و نه کامل).'
    },
    { key: 'fullyUsedCount', title: 'مصرف‌شده', value: d.fullyUsedCount, kind: 'count', tone: 'muted' },
    { key: 'expiredCount', title: 'منقضی', value: d.expiredCount, kind: 'count', tone: 'warn' },
    { key: 'canceledCount', title: 'ابطال‌شده', value: d.canceledCount, kind: 'count', tone: 'bad' },
    { key: 'suspendedCount', title: 'معلق', value: d.suspendedCount, kind: 'count', tone: 'bad' },
    { key: 'draftCount', title: 'پیش‌نویس', value: d.draftCount, kind: 'count', tone: 'plain' },
    {
      key: 'nearExpiryCount',
      title: 'نزدیک به انقضا',
      value: d.nearExpiryCount,
      kind: 'count',
      tone: 'warn',
      hint: 'بر اساس «چند روز قبل از انقضا» در تنظیمات یادآوری.'
    },
    { key: 'todayCount', title: 'صادرشده‌ی امروز', value: d.todayCount, kind: 'count', tone: 'plain' }
  ]
  if (d.liabilityReported)
    cards.push({
      key: 'liability',
      title: 'تعهد فروشگاه (بدهی اعتباری)',
      value: d.liability,
      kind: 'money',
      tone: 'bad',
      hint: 'مجموع (مبلغ − مصرف‌شده) روی اعتبارهای زنده و منقضی‌نشده. این عدد بدهی فروشگاه است، نه فروش.'
    })
  return cards
}

// ---------------------------------------------------------------------------
// ۲) جدول‌ها و خروجی اکسل (§۱۵ و §۱۶)
// ---------------------------------------------------------------------------

export const CREDIT_LIST_HEADERS = [
  'شناسهٔ امن اعتبار',
  'نوع',
  'وضعیت',
  'مبلغ',
  'مصرف‌شده',
  'باقی‌مانده',
  'دفعات مجاز',
  'دفعات مصرف',
  'قواعد مصرف',
  'محدودیت',
  'حداقل خرید',
  'سقف هر تراکنش',
  'دارنده',
  'شرکت',
  'تلفن',
  'تاریخ صدور',
  'ساعت صدور',
  'تاریخ انقضا',
  'روز باقی‌مانده',
  'آخرین مصرف',
  'فیش مصرف',
  'دسته‌ی گروهی',
  'تعداد چاپ',
  'یادآوری',
  'آرشیو',
  'توضیح'
]

/** یک ردیف امن اعتبار ⇒ یک ردیف اکسل؛ credential هرگز وارد خروجی نمی‌شود. */
export function creditListRow(r: any): (string | number | null)[] {
  return [
    String(r.publicReference ?? `اعتبار #${intOf(r.id)}`),
    String(r.sourceLabel ?? CREDIT_SOURCE_LABELS[String(r.source ?? '')] ?? ''),
    String(r.statusLabel ?? CREDIT_STATUS_LABELS[String(r.status ?? '')] ?? ''),
    intOf(r.amount),
    intOf(r.usedAmount),
    intOf(r.remaining),
    intOf(r.maxUses, 1),
    intOf(r.usedCount),
    String(r.usesLabel ?? ''),
    String(r.restrictScopeLabel ?? CREDIT_SCOPE_LABELS[String(r.restrictScope ?? 'ALL')] ?? ''),
    intOf(r.minPurchase),
    intOf(r.maxPerTransaction),
    String(r.customerName ?? ''),
    String(r.holderCompany ?? ''),
    String(r.holderPhone ?? ''),
    String(r.issuedAtJalali ?? ''),
    String(r.issuedAtTime ?? ''),
    String(r.expiresAtJalali ?? 'بدون انقضا'),
    r.daysLeft == null ? '' : intOf(r.daysLeft),
    String(r.usedAtJalali ?? ''),
    r.usedReceiptNo == null ? '' : intOf(r.usedReceiptNo),
    r.batchId == null ? '' : intOf(r.batchId),
    intOf(r.printCount),
    r.reminderOptOut ? 'نمی‌خواهد' : `${intOf(r.reminderCount)} بار`,
    r.archived ? 'آرشیو' : '',
    String(r.note ?? '')
  ]
}

export const CREDIT_REDEMPTION_HEADERS = [
  'ردیف',
  'تاریخ',
  'ساعت',
  'مبلغ مصرف',
  'باقی‌مانده بعد از مصرف',
  'شماره فیش',
  'کاربر',
  'کلید Idempotency',
  'برگشت‌خورده',
  'دلیل برگشت',
  'توضیح'
]

export function redemptionRow(r: any): (string | number | null)[] {
  return [
    intOf(r.seq),
    String(r.atJalali ?? ''),
    String(r.atTime ?? ''),
    intOf(r.amount),
    intOf(r.remainderAfter),
    r.receiptNo == null ? '' : intOf(r.receiptNo),
    String(r.userName ?? ''),
    String(r.idempotencyKey ?? ''),
    r.reversed ? 'بله' : '',
    String(r.reversedReason ?? ''),
    String(r.note ?? '')
  ]
}

export const CREDIT_TIMELINE_HEADERS = ['تاریخ', 'ساعت', 'رویداد', 'کاربر', 'مقدار قبل', 'مقدار بعد', 'توضیح']

export function timelineRow(e: any): (string | number | null)[] {
  return [
    String(e.atJalali ?? ''),
    String(e.atTime ?? ''),
    String(e.actionLabel ?? e.action ?? ''),
    String(e.userName ?? ''),
    String(e.before ?? ''),
    String(e.after ?? ''),
    String(e.note ?? '')
  ]
}

export const CREDIT_REMINDER_HEADERS = [
  'شناسهٔ امن اعتبار',
  'دارنده',
  'تلفن',
  'مبلغ',
  'باقی‌مانده',
  'تاریخ صدور',
  'تاریخ انقضا',
  'روز از صدور',
  'روز تا انقضا',
  'باید یادآوری شود؟',
  'نوع',
  'دلیل',
  'تعداد یادآوری قبلی'
]

export function reminderCandidateRow(c: any): (string | number | null)[] {
  const r = c?.credit ?? {}
  return [
    String(r.publicReference ?? `اعتبار #${intOf(r.id)}`),
    String(c.holderName ?? r.customerName ?? ''),
    String(c.phone ?? ''),
    intOf(r.amount),
    intOf(r.remaining),
    String(r.issuedAtJalali ?? ''),
    String(r.expiresAtJalali ?? 'بدون انقضا'),
    intOf(c.daysSinceIssue),
    c.daysToExpiry == null ? '' : intOf(c.daysToExpiry),
    c.should ? 'بله' : 'خیر',
    String(c.kindLabel ?? ''),
    String(c.reason ?? ''),
    intOf(r.reminderCount)
  ]
}

export const CREDIT_REMINDER_LOG_HEADERS = ['تاریخ', 'ساعت', 'شناسهٔ امن اعتبار', 'نوع پیام', 'وضعیت', 'تلفن', 'متن پیام', 'دلیل', 'کاربر']

export function reminderLogRow(r: any): (string | number | null)[] {
  return [
    String(r.atJalali ?? ''),
    String(r.atTime ?? ''),
    String(r.publicReference ?? `اعتبار #${intOf(r.creditId)}`),
    String(r.kindLabel ?? r.kind ?? ''),
    String(r.statusLabel ?? r.status ?? ''),
    String(r.phone ?? ''),
    String(r.text ?? ''),
    String(r.reason ?? ''),
    String(r.userName ?? '')
  ]
}

export const CREDIT_BATCH_HEADERS = ['شناسه دسته', 'عنوان', 'تعداد واقعی', 'مبلغ هر اعتبار', 'جمع مبلغ', 'تاریخ', 'ساعت', 'نوع', 'طول کد رشد کرد؟', 'توضیح']

export function batchRow(b: any): (string | number | null)[] {
  return [
    intOf(b.id),
    String(b.title ?? ''),
    intOf(b.count),
    intOf(b.amountEach),
    intOf(b.totalAmount),
    String(b.createdAtJalali ?? ''),
    String(b.createdAtTime ?? ''),
    String(CREDIT_SOURCE_LABELS[String(b.source ?? '')] ?? b.source ?? ''),
    b.lengthGrown ? 'بله' : '',
    String(b.note ?? '')
  ]
}

// ---------------------------------------------------------------------------
// ۳) فرم صدور تکی (§۲، §۳، §۴، §۱۲، §۱۸)
// ---------------------------------------------------------------------------

export interface IssueDraft {
  amount: number
  /** خالی = مدت پیش‌فرض همان نوع · 'none' = بدون انقضا · 'days' = عدد دستی */
  expiryMode: 'default' | 'none' | 'days'
  days: number
  usesMode: 'single' | 'count' | 'unlimited'
  maxUses: number
  restrictScope: string
  restrictCategoryIds: number[]
  restrictVariantIds: number[]
  minPurchase: number
  maxPerTransaction: number
  customerId: number | null
  customerName: string
  customerLocked: boolean
  holderCompany: string
  holderNationalId: string
  holderPhone: string
  holderAddress: string
  holderAgent: string
  holderNote: string
  note: string
  prefix: string
  asDraft: boolean
  reminderOptOut: boolean
  overrideReason: string
}

export const EMPTY_ISSUE_DRAFT: IssueDraft = {
  amount: 0,
  expiryMode: 'default',
  days: 30,
  usesMode: 'single',
  maxUses: 1,
  restrictScope: CreditRestrictScope.ALL,
  restrictCategoryIds: [],
  restrictVariantIds: [],
  minPurchase: 0,
  maxPerTransaction: 0,
  customerId: null,
  customerName: '',
  customerLocked: false,
  holderCompany: '',
  holderNationalId: '',
  holderPhone: '',
  holderAddress: '',
  holderAgent: '',
  holderNote: '',
  note: '',
  prefix: '',
  asDraft: false,
  reminderOptOut: false,
  overrideReason: ''
}

export interface BuildResult<T> {
  ok: boolean
  /** خطای مسدودکننده (فارسی). `ok=false` ⇒ درخواستی فرستاده نمی‌شود. */
  error: string | null
  /** هشدارهای غیرمسدودکننده — باید در UI *دیده* شوند */
  warnings: string[]
  payload: T | null
  /** این صدور از پیش‌فرض نوعش خارج شده است؟ (§۳ — استثنا روی همان رکورد) */
  override: boolean
}

/** دفعات نهایی از حالت انتخابی — «چندباره تا پایان مبلغ» عدد دفعات نمی‌خواهد. */
export function usesOf(draft: Pick<IssueDraft, 'usesMode' | 'maxUses'>): { maxUses: number; multiUse: boolean } {
  if (draft.usesMode === 'unlimited') return { maxUses: 1, multiUse: true }
  if (draft.usesMode === 'count') return { maxUses: Math.max(2, intOf(draft.maxUses, 2)), multiUse: true }
  return { maxUses: 1, multiUse: false }
}

/** روزهای نهایی: `undefined` = «پیش‌فرض نوع را خودت حساب کن» · `null` = بدون انقضا. */
export function daysOf(draft: Pick<IssueDraft, 'expiryMode' | 'days'>): number | null | undefined {
  if (draft.expiryMode === 'default') return undefined
  if (draft.expiryMode === 'none') return null
  return Math.max(1, intOf(draft.days, 1))
}

/**
 * فرم صدور ⇒ Payload کانال `credit:issue`.
 *
 * ⚠️ «تصمیم» هیچ‌کدام از این چک‌ها اینجا نیست: Backend همه را دوباره می‌سنجد.
 * هدف فقط این است که کاربر پیام فارسی را *قبل از* رفت‌و‌برگشت ببیند و فرم
 * ناقص نرود. تنها چیزی که این تابع «اجبار» می‌کند و Backend نمی‌کند، نوشتن
 * **دلیل استثنا** است (§۳): اگر قواعد این اعتبار از پیش‌فرض نوعش فاصله بگیرد،
 * دلیلش باید روی همان رکورد بنشیند وگرنه شش ماه بعد هیچ‌کس نمی‌داند چرا این
 * یک اعتبار دو بار مصرف داشت.
 */
export function buildIssuePayload(draft: IssueDraft, settings: CreditSettings): BuildResult<Record<string, unknown>> {
  const warnings: string[] = []
  const fail = (error: string): BuildResult<Record<string, unknown>> => ({ ok: false, error, warnings, payload: null, override: false })

  // نشست ۱۷۹ (S179-D1): هر عدد فرم سخت‌گیرانه خوانده می‌شود؛ intOf قبلی «5۰۰۰۰۰» را ۵ ریال،
  // ۱۰۰۰۰۰٫۶ را ۱۰۰۰۰۱ و حداقل خرید ‎-۵ را بی‌صدا ۰ می‌کرد. فیلدی که در حالت انتخاب‌شده
  // استفاده نمی‌شود (مدت در «پیش‌فرض/بدون انقضا»، دفعات در غیر «چندباره تا N») سنجیده نمی‌شود.
  const amountF = formIntField(draft.amount, 'مبلغ اعتبار', 'ریال')
  if (amountF.error != null) return fail(amountF.error)
  const minF = formIntField(draft.minPurchase, 'حداقل مبلغ خرید', 'ریال')
  if (minF.error != null) return fail(minF.error)
  const maxTxF = formIntField(draft.maxPerTransaction, 'سقف مصرف در هر تراکنش', 'ریال')
  if (maxTxF.error != null) return fail(maxTxF.error)
  const daysF = draft.expiryMode === 'days' ? formIntField(draft.days, 'مدت اعتبار', 'روز') : { value: 0, error: null }
  if (daysF.error != null) return fail(daysF.error)
  const usesF = draft.usesMode === 'count' ? formIntField(draft.maxUses, 'تعداد دفعات مصرف', 'بار') : { value: 0, error: null }
  if (usesF.error != null) return fail(usesF.error)

  const amount = amountF.value
  const clean = {
    ...draft,
    days: draft.expiryMode === 'days' ? daysF.value : draft.days,
    maxUses: draft.usesMode === 'count' ? usesF.value : draft.maxUses
  }
  const rules = rulesForSource(settings, CreditSource.MANUAL)
  const { maxUses, multiUse } = usesOf(clean)
  const days = daysOf(clean)
  const scope = normalizeRestrictScope(draft.restrictScope)
  const cats = cleanIds(draft.restrictCategoryIds)
  const vars = cleanIds(draft.restrictVariantIds)
  const minPurchase = minF.value
  const maxPerTransaction = maxTxF.value

  if (amount <= 0) return fail('مبلغ اعتبار را وارد کنید (باید بزرگ‌تر از صفر باشد).')
  if (draft.expiryMode === 'days' && daysF.value <= 0)
    return fail('مدت اعتبار را به روز وارد کنید، یا گزینه‌ی «بدون انقضا» را انتخاب کنید.')
  if (scope === CreditRestrictScope.CATEGORY && !cats.length)
    return fail('برای محدود کردن اعتبار به دسته‌بندی، حداقل یک دسته‌بندی انتخاب کنید.')
  if (scope === CreditRestrictScope.VARIANTS && !vars.length)
    return fail('برای محدود کردن اعتبار به کالا، حداقل یک کالا انتخاب کنید.')
  if (draft.usesMode === 'count' && usesF.value < 2)
    return fail('برای «چندباره (تا N بار)» عدد دفعات باید حداقل ۲ باشد؛ برای یک بار، گزینه‌ی «یک‌بارمصرف» را انتخاب کنید.')

  if (draft.customerLocked && draft.customerId == null)
    warnings.push(
      'گزینه‌ی «فقط برای همین مشتری» روشن است ولی مشتری‌ای انتخاب نشده؛ در این حالت محدودیت مشتری عملاً اعمال نمی‌شود.'
    )
  if (maxPerTransaction > 0 && maxPerTransaction >= amount)
    warnings.push('سقف هر تراکنش از مبلغ کل اعتبار کمتر نیست، پس عملاً محدودیتی ایجاد نمی‌کند.')
  if (minPurchase > 0 && minPurchase < amount)
    warnings.push('حداقل مبلغ خرید از مبلغ خود اعتبار کمتر است؛ مطمئن شوید همین را می‌خواهید.')
  if (draft.reminderOptOut) warnings.push('این اعتبار از فهرست یادآوری بیرون می‌ماند (Opt-out مشتری).')
  if (draft.asDraft)
    warnings.push('این اعتبار به‌صورت «پیش‌نویس» ساخته می‌شود و تا فعال‌سازی قابل مصرف نیست.')

  const restricted = scope !== CreditRestrictScope.ALL
  const override =
    maxUses !== rules.maxUses ||
    multiUse !== rules.multiUse ||
    restricted ||
    minPurchase > 0 ||
    maxPerTransaction > 0 ||
    draft.customerLocked ||
    (days !== undefined && (days ?? 0) !== rules.days)

  if (override && trimmed(draft.overrideReason).length < 3)
    return fail(
      'قواعد این اعتبار از پیش‌فرض «صادرشده توسط مدیریت» فاصله دارد ' +
        `(پیش‌فرض: ${rules.days > 0 ? `${rules.days} روز` : 'بدون انقضا'} / ${rules.maxUses} بار).\n` +
        'برای ثبت این استثنا، «دلیل استثنا» را بنویسید (حداقل ۳ کاراکتر) تا روی همان رکورد و در تاریخچه بماند.'
    )

  const payload: Record<string, unknown> = {
    amount,
    source: CreditSource.MANUAL,
    maxUses,
    multiUse,
    restrictScope: scope,
    restrictCategoryIds: scope === CreditRestrictScope.CATEGORY ? cats : [],
    restrictVariantIds: scope === CreditRestrictScope.VARIANTS ? vars : [],
    minPurchase,
    maxPerTransaction,
    customerId: draft.customerId ?? null,
    customerName: orNull(draft.customerName),
    customerLocked: draft.customerLocked === true,
    holderCompany: orNull(draft.holderCompany),
    holderNationalId: orNull(draft.holderNationalId),
    holderPhone: orNull(draft.holderPhone),
    holderAddress: orNull(draft.holderAddress),
    holderAgent: orNull(draft.holderAgent),
    holderNote: orNull(draft.holderNote),
    note: orNull(draft.note),
    prefix: normalizeCreditPrefix(draft.prefix, '') || null,
    reminderOptOut: draft.reminderOptOut === true,
    overrideReason: override ? trimmed(draft.overrideReason) : null,
    status: draft.asDraft ? CreditStatus.DRAFT : CreditStatus.ACTIVE
  }
  // `undefined` یعنی «پیش‌فرض نوع»؛ فرستادنش اشتباه است چون JSON آن را حذف
  // می‌کند و سمت main هم همان `undefined` را «پیش‌فرض» می‌فهمد — پس فقط وقتی
  // کاربر صریح انتخاب کرده باشد، کلید `days` می‌گذاریم.
  if (days !== undefined) payload.days = days

  return { ok: true, error: null, warnings, payload, override }
}

// ---------------------------------------------------------------------------
// ۴) تولید گروهی (§۵ و §۶)
// ---------------------------------------------------------------------------

export interface BulkDraft extends Omit<IssueDraft, 'asDraft'> {
  count: number
  title: string
  codeLength: number
}

export const EMPTY_BULK_DRAFT: BulkDraft = {
  ...EMPTY_ISSUE_DRAFT,
  count: 10,
  title: '',
  codeLength: 0
}

/**
 * سنجش *پیش‌نمایشیِ* فضای کد سمت UI (§۶).
 *
 * ⚠️ این عدد «تصمیم» نیست — تصمیم قطعی همان `assertCodeSpace` سمت main است که
 * تعداد کدهای *موجود در دیتابیس* را هم می‌داند (این‌جا صفر فرض می‌شود، چون
 * renderer به دیتابیس دسترسی ندارد). هدفش فقط این است که کاربر *قبل از* زدن
 * دکمه ببیند «۵۰۰۰ کد با طول ۶ و فقط عدد» از پایه غیرممکن است.
 */
export function previewCodeSpace(
  count: number,
  settings: CreditSettings,
  codeLength: number,
  prefix: string
): { ok: boolean; message: string | null; capacity: number; length: number } {
  const length = codeLength > 0 ? codeLength : settings.codeLength
  const alphabet = creditAlphabet(settings.codeAlphabet, settings.excludeSimilar)
  const res = assessCodeSpace({
    count: Math.max(1, intOf(count, 1)),
    length,
    prefixLength: normalizeCreditPrefix(prefix, '').length,
    alphabetSize: alphabet.length,
    existing: 0,
    ratio: settings.bulkCapacityRatio,
    autoGrow: settings.autoGrowLength
  })
  return { ok: res.ok, message: res.message, capacity: res.capacity, length: res.length }
}

export function buildBulkPayload(draft: BulkDraft, settings: CreditSettings): BuildResult<Record<string, unknown>> {
  const base = buildIssuePayload({ ...draft, asDraft: false }, settings)
  if (!base.ok || !base.payload) return { ...base, payload: null }
  const warnings = [...base.warnings]

  const fail = (error: string): BuildResult<Record<string, unknown>> => ({ ok: false, error, warnings, payload: null, override: base.override })

  // نشست ۱۷۹ (S179-D1): تعداد و طول کد هم سخت‌گیرانه؛ مبلغ/حداقل/سقف/مدت/دفعات از payload
  // سنجیده‌شده‌ی buildIssuePayload برداشته می‌شوند تا دو خواندن متفاوت از یک فرم نداشته باشیم.
  const countF = formIntField(draft.count, 'تعداد اعتبارهای درخواستی', 'عدد')
  if (countF.error != null) return fail(countF.error)
  const count = countF.value

  if (count <= 0) return fail('تعداد اعتبارهای درخواستی را وارد کنید (حداقل ۱).')
  if (count > settings.bulkMaxCount)
    return fail(
      `سقف تولید گروهی در تنظیمات ${settings.bulkMaxCount} اعتبار است و شما ${count} خواسته‌اید، پس چیزی ساخته نمی‌شود.\n` +
        'یا تعداد را کم کنید، یا سقف را در «تنظیمات اعتبار خرید» بالا ببرید.'
    )
  const codeLengthF = formIntField(draft.codeLength, 'طول کد', 'کاراکتر')
  if (codeLengthF.error != null) return fail(codeLengthF.error)
  const codeLength = codeLengthF.value
  if (codeLength > 0 && (codeLength < MIN_CREDIT_CODE_LENGTH || codeLength > MAX_CREDIT_CODE_LENGTH))
    return fail(`طول کد باید بین ${MIN_CREDIT_CODE_LENGTH} و ${MAX_CREDIT_CODE_LENGTH} کاراکتر باشد.`)

  const space = previewCodeSpace(count, settings, codeLength, draft.prefix)
  if (!space.ok) return fail(space.message ?? 'فضای کدهای ممکن برای این تعداد کافی نیست.')
  if (space.message) warnings.push(space.message)
  if (count >= 500)
    warnings.push(
      `${count} رکورد مستقل ساخته می‌شود و هر کدام کد/بارکد/سابقه‌ی خودش را دارد؛ ساختش چند ثانیه طول می‌کشد و در همین مدت پنجره را نبندید.`
    )

  const { maxUses, multiUse } = base.payload as { maxUses: number; multiUse: boolean }
  const days = base.payload.days as number | null | undefined
  const payload: Record<string, unknown> = {
    count,
    amountEach: base.payload.amount,
    source: CreditSource.MANUAL,
    title: orNull(draft.title),
    maxUses,
    multiUse,
    codeLength: codeLength > 0 ? codeLength : null,
    prefix: normalizeCreditPrefix(draft.prefix, '') || null,
    restrictScope: normalizeRestrictScope(draft.restrictScope),
    restrictCategoryIds: cleanIds(draft.restrictCategoryIds),
    restrictVariantIds: cleanIds(draft.restrictVariantIds),
    minPurchase: base.payload.minPurchase,
    maxPerTransaction: base.payload.maxPerTransaction,
    customerId: draft.customerId ?? null,
    customerName: orNull(draft.customerName),
    customerLocked: draft.customerLocked === true,
    holderCompany: orNull(draft.holderCompany),
    holderPhone: orNull(draft.holderPhone),
    note: orNull(draft.note)
  }
  if (days !== undefined) payload.days = days
  return { ok: true, error: null, warnings, payload, override: base.override }
}

// ---------------------------------------------------------------------------
// ۵) عملیات مدیریتی (§۸ و §۱۰) — رمز مدیر + دلیل، هر دو اجباری
// ---------------------------------------------------------------------------

export const CreditOp = {
  VOID: 'VOID',
  SUSPEND: 'SUSPEND',
  REACTIVATE: 'REACTIVATE',
  EXPIRY: 'EXPIRY',
  AMOUNT: 'AMOUNT',
  USES: 'USES',
  HOLDER: 'HOLDER',
  RESTRICTION: 'RESTRICTION',
  DELETE: 'DELETE'
} as const
export type CreditOp = (typeof CreditOp)[keyof typeof CreditOp]

export const CREDIT_OP_TITLES: Record<CreditOp, string> = {
  VOID: 'ابطال اعتبار',
  SUSPEND: 'تعلیق موقت',
  REACTIVATE: 'فعال‌سازی مجدد',
  EXPIRY: 'تغییر تاریخ انقضا',
  AMOUNT: 'تغییر مبلغ',
  USES: 'تغییر دفعات مصرف',
  HOLDER: 'تغییر دارنده',
  RESTRICTION: 'تغییر محدودیت',
  DELETE: 'حذف اعتبار'
}

/** توضیح «این عملیات چه می‌کند» — همان متنی که کاربر قبل از زدن دکمه می‌بیند. */
export const CREDIT_OP_HELP: Record<CreditOp, string> = {
  VOID: 'ابطال یعنی تغییر وضعیت به «باطل»، نه حذف. وضعیت پایانی است: اعتبار باطل دیگر به هیچ وضعیتی برنمی‌گردد.',
  SUSPEND: 'تعلیق موقت و قابل برگشت است: اعتبار تا فعال‌سازی مجدد قابل مصرف نیست ولی سابقه‌اش دست‌نخورده می‌ماند.',
  REACTIVATE:
    'فعال‌سازی از «معلق» یا «منقضی». اگر اعتبار منقضی شده باشد، تمدید تاریخ اجباری است — وگرنه یک ثانیه بعد دوباره منقضی است.',
  EXPIRY: 'تاریخ انقضای جدید (خالی = بدون انقضا). مقدار قبل و بعد در تاریخچه ثبت می‌شود.',
  AMOUNT:
    'تغییر مبلغ فقط روی اعتباری که **هیچ مصرفی نداشته** مجاز است. روی اعتبار مصرف‌شده ممنوع است، چون سند حسابداری و دفتر مصرفش را خراب می‌کند؛ راه درست ابطال + صدور اعتبار جدید است.',
  USES: 'دفعات مجاز، حالت چندباره و سقف هر تراکنش. سقف دفعات هیچ‌وقت نمی‌تواند کمتر از دفعاتی باشد که تا حالا مصرف شده است.',
  HOLDER: 'اطلاعات گیرنده (شخص/شرکت/سازمان). هیچ فیلدی اجباری نیست، ولی دلیل تغییر اجباری است.',
  RESTRICTION: 'محدودیت کالا/دسته‌بندی، حداقل مبلغ خرید و سقف هر تراکنش. هر سه در Backend اعمال می‌شوند، نه فقط UI.',
  DELETE:
    'حذف اعتبار هیچ‌وقت پاک‌کردن واقعی نیست (بند ۴-۲۲): اعتبار **ابطال و آرشیو** می‌شود (Soft Delete)، از فهرست‌ها و از مسیر مصرف بیرون می‌رود، ولی رکورد، کد، مبلغ، پرداختی و دفتر مصرفش به‌عنوان مدرک می‌مانند.'
}

/** کانال هر عملیات — یک نقشه، تا هیچ‌جای UI اسم کانال را دوباره ننویسد. */
export const CREDIT_OP_CHANNEL: Record<CreditOp, string> = {
  VOID: 'creditVoid',
  SUSPEND: 'creditSuspend',
  REACTIVATE: 'creditReactivate',
  EXPIRY: 'creditExpiryChange',
  AMOUNT: 'creditAmountChange',
  USES: 'creditUsesChange',
  HOLDER: 'creditHolderChange',
  RESTRICTION: 'creditRestrictionChange',
  DELETE: 'creditDelete'
}

export interface OpDraft {
  op: CreditOp
  id: number
  reason: string
  managerPassword: string
  // --- فیلدهای اختصاصیِ بعضی عملیات ---
  expiresAtJalali: string
  extendDays: number
  amount: number
  usesMode: 'single' | 'count' | 'unlimited'
  maxUses: number
  maxPerTransaction: number
  restrictScope: string
  restrictCategoryIds: number[]
  restrictVariantIds: number[]
  minPurchase: number
  customerId: number | null
  customerName: string
  customerLocked: boolean
  holderCompany: string
  holderNationalId: string
  holderPhone: string
  holderAddress: string
  holderAgent: string
  holderNote: string
  reminderOptOut: boolean
}

export function emptyOpDraft(op: CreditOp, id: number): OpDraft {
  return {
    op,
    id,
    reason: '',
    managerPassword: '',
    expiresAtJalali: '',
    extendDays: 30,
    amount: 0,
    usesMode: 'single',
    maxUses: 2,
    maxPerTransaction: 0,
    restrictScope: CreditRestrictScope.ALL,
    restrictCategoryIds: [],
    restrictVariantIds: [],
    minPurchase: 0,
    customerId: null,
    customerName: '',
    customerLocked: false,
    holderCompany: '',
    holderNationalId: '',
    holderPhone: '',
    holderAddress: '',
    holderAgent: '',
    holderNote: '',
    reminderOptOut: false
  }
}

/**
 * فرم عملیات مدیریتی ⇒ Payload کانالش.
 *
 * ⚠️ **رمز مدیر و دلیل، هر دو اجباری‌اند** — نه به‌خاطر سلیقه‌ی UI، بلکه چون
 * سرویس main بدون این دو درخواست را رد می‌کند (`assertManagerPassword` +
 * `requireReason`). پس فرم بدون آن‌ها حتی درخواست هم نمی‌فرستد: کاربر پیام
 * فارسی را همان‌جا می‌بیند، نه بعد از یک رفت‌و‌برگشت.
 */
export function buildOpPayload(draft: OpDraft, credit: any): BuildResult<Record<string, unknown>> {
  const warnings: string[] = []
  const fail = (error: string): BuildResult<Record<string, unknown>> => ({ ok: false, error, warnings, payload: null, override: false })
  const reason = trimmed(draft.reason)
  const managerPassword = trimmed(draft.managerPassword)
  const title = CREDIT_OP_TITLES[draft.op] ?? 'این عملیات'

  if (!draft.id) return fail('اول یک اعتبار را از فهرست انتخاب کنید.')
  if (!managerPassword)
    return fail(`برای «${title}» رمز مدیر لازم است؛ سرویس بدون رمز این درخواست را رد می‌کند.`)
  if (reason.length < 3) return fail(`برای «${title}» نوشتن دلیل اجباری است (حداقل ۳ کاراکتر) و در تاریخچه ثبت می‌شود.`)

  const base: Record<string, unknown> = { id: draft.id, reason, managerPassword }

  switch (draft.op) {
    case CreditOp.VOID:
    case CreditOp.SUSPEND:
      return { ok: true, error: null, warnings, payload: base, override: false }

    case CreditOp.REACTIVATE: {
      const expired = credit?.expired === true || String(credit?.status ?? '') === CreditStatus.EXPIRED
      const extendDays = Math.max(0, intOf(draft.extendDays))
      if (expired && extendDays <= 0)
        return fail(
          'این اعتبار منقضی شده است، پس فعال‌سازی بدون تمدید تاریخ بی‌معناست (یک ثانیه بعد دوباره منقضی می‌شود).\n' +
            'تعداد روز تمدید را وارد کنید.'
        )
      return { ok: true, error: null, warnings, payload: { ...base, extendDays: extendDays || null }, override: false }
    }

    case CreditOp.EXPIRY: {
      const target = trimmed(draft.expiresAtJalali)
      if (!target) warnings.push('تاریخ خالی گذاشته شد، پس این اعتبار «بدون انقضا» می‌شود.')
      return { ok: true, error: null, warnings, payload: { ...base, expiresAtJalali: target || null }, override: false }
    }

    case CreditOp.AMOUNT: {
      const amount = intOf(draft.amount)
      if (amount <= 0) return fail('مبلغ جدید باید بزرگ‌تر از صفر باشد.')
      if (intOf(credit?.usedAmount) > 0 || intOf(credit?.usedCount) > 0)
        return fail(
          'این اعتبار قبلاً مصرف شده است، پس تغییر مبلغش مجاز نیست — سند حسابداری و دفتر مصرفش را خراب می‌کند.\n' +
            'راه درست: همین اعتبار را باطل کنید و یک اعتبار جدید با مبلغ درست صادر کنید.'
        )
      return { ok: true, error: null, warnings, payload: { ...base, amount }, override: false }
    }

    case CreditOp.USES: {
      const { maxUses, multiUse } = usesOf(draft)
      const usedCount = intOf(credit?.usedCount)
      if (!multiUse && usedCount > 1)
        return fail(
          `این اعتبار تا حالا ${usedCount} بار مصرف شده است، پس نمی‌تواند «یک‌بارمصرف» شود. ` +
            'سقف دفعات هیچ‌وقت کمتر از دفعات مصرف‌شده نمی‌شود.'
        )
      if (draft.usesMode === 'count' && maxUses < usedCount)
        return fail(`سقف دفعات نمی‌تواند کمتر از ${usedCount} (دفعات مصرف‌شده) باشد.`)
      return {
        ok: true,
        error: null,
        warnings,
        payload: { ...base, maxUses, multiUse, maxPerTransaction: Math.max(0, intOf(draft.maxPerTransaction)) },
        override: false
      }
    }

    case CreditOp.HOLDER:
      if (draft.customerLocked && draft.customerId == null)
        warnings.push('«فقط برای همین مشتری» روشن است ولی مشتری انتخاب نشده؛ محدودیت مشتری اعمال نمی‌شود.')
      return {
        ok: true,
        error: null,
        warnings,
        payload: {
          ...base,
          customerId: draft.customerId ?? null,
          customerName: orNull(draft.customerName),
          customerLocked: draft.customerLocked === true,
          holderCompany: orNull(draft.holderCompany),
          holderNationalId: orNull(draft.holderNationalId),
          holderPhone: orNull(draft.holderPhone),
          holderAddress: orNull(draft.holderAddress),
          holderAgent: orNull(draft.holderAgent),
          holderNote: orNull(draft.holderNote),
          reminderOptOut: draft.reminderOptOut === true
        },
        override: false
      }

    case CreditOp.RESTRICTION: {
      const scope = normalizeRestrictScope(draft.restrictScope)
      const cats = cleanIds(draft.restrictCategoryIds)
      const vars = cleanIds(draft.restrictVariantIds)
      if (scope === CreditRestrictScope.CATEGORY && !cats.length)
        return fail('برای محدود کردن اعتبار به دسته‌بندی، حداقل یک دسته‌بندی انتخاب کنید.')
      if (scope === CreditRestrictScope.VARIANTS && !vars.length)
        return fail('برای محدود کردن اعتبار به کالا، حداقل یک کالا انتخاب کنید.')
      return {
        ok: true,
        error: null,
        warnings,
        payload: {
          ...base,
          restrictScope: scope,
          restrictCategoryIds: cats,
          restrictVariantIds: vars,
          minPurchase: Math.max(0, intOf(draft.minPurchase)),
          maxPerTransaction: Math.max(0, intOf(draft.maxPerTransaction))
        },
        override: false
      }
    }

    case CreditOp.DELETE: {
      const hasUse = intOf(credit?.usedAmount) > 0 || intOf(credit?.usedCount) > 0
      warnings.push(
        hasUse
          ? 'این اعتبار مصرف داشته است، پس **حذف واقعی نمی‌شود**: آرشیو می‌گردد تا پرداختی و سابقه‌ی حسابداری‌اش نشکند.'
          : 'این اعتبار هیچ مصرفی نداشته است؛ **ابطال و آرشیو می‌شود** و دیگر قابل مصرف نیست، ولی رکوردش به‌عنوان مدرک می‌ماند.'
      )
      return { ok: true, error: null, warnings, payload: base, override: false }
    }

    default:
      return fail('این عملیات شناخته نشد.')
  }
}

// ---------------------------------------------------------------------------
// ۶) تنظیمات مرکزی (§۲۲)
// ---------------------------------------------------------------------------

/**
 * فرم تنظیمات ⇒ Payload کانال `credit:settings:set`.
 * پارس نهایی با `parseCreditSettings` سمت main است (همان الگوی بقیه‌ی
 * تنظیمات پروژه)، پس اینجا فقط عددها تمیز می‌شوند و هیچ مقدار بی‌معنایی
 * نمی‌تواند از صافی رد شود.
 */
export function buildSettingsPayload(form: CreditSettings): { settings: CreditSettings } {
  return { settings: form }
}

/** هشدارهای «این تنظیم را با آگاهی عوض کن» (§۶ و §۱۴). */
export function settingsWarnings(form: CreditSettings): string[] {
  const out: string[] = []
  const alphabet = creditAlphabet(form.codeAlphabet, form.excludeSimilar)
  const space = assessCodeSpace({
    count: Math.max(1, form.bulkMaxCount),
    length: form.codeLength,
    alphabetSize: alphabet.length,
    existing: 0,
    ratio: form.bulkCapacityRatio,
    autoGrow: form.autoGrowLength
  })
  if (!space.ok)
    out.push(
      `با طول کد ${form.codeLength} و این مجموعه‌ی کاراکتر، سقف تولید گروهی ${form.bulkMaxCount} عملاً قابل تولید نیست ` +
        `(${space.capacity} کد ممکن). طول کد را بیشتر کنید یا «افزایش خودکار طول» را روشن بگذارید.`
    )
  if (form.codeAlphabet === 'NUM' && form.codeLength <= 8)
    out.push('کد فقط-عددی با طول کم، حدس‌زدنی‌تر است. قفل موقت کد اشتباه روشن است، ولی طول بیشتر یا الفبای ترکیبی امن‌تر است.')
  if (!form.reminder.enabled) out.push('یادآوری خاموش است، پس فهرست «واجد شرایط یادآوری» خالی می‌ماند.')
  if (form.reminder.maxCount === 0 && form.reminder.enabled)
    out.push('سقف تعداد یادآوری صفر است؛ با این مقدار هیچ یادآوری‌ای مجاز نمی‌شود.')
  if (!form.reportLiability)
    out.push('گزارش «تعهد فروشگاه» خاموش است؛ اعتبار صادرشده‌ی مصرف‌نشده در داشبورد به‌عنوان بدهی نشان داده نمی‌شود.')
  return out
}

// ---------------------------------------------------------------------------
// ۷) پنل فروش — پرداخت ترکیبی (§۱۷)
// ---------------------------------------------------------------------------

export interface CreditPreviewLike {
  ok: boolean
  applied: number
  error: string | null
  notes: string[]
  eligibleVariantIds: number[]
  excludedVariantIds: number[]
}

export interface PosCreditPlan {
  /** مبلغی که از این اعتبار روی این فاکتور خرج می‌شود */
  applied: number
  /** نقد/کارتی که واقعاً باید از مشتری گرفته شود */
  cashDue: number
  /** مبلغی که فرم باید به‌عنوان `storeCreditAmount` بفرستد (null = حداکثر ممکن) */
  requested: number | null
  /** اقلامی که این اعتبار رویشان قابل استفاده *نیست* (برای علامت زدن در سبد) */
  excludedVariantIds: number[]
  notes: string[]
  error: string | null
}

/**
 * «چقدر اعتبار، چقدر نقد؟» — تنها جایی که پنل فروش این تقسیم را حساب می‌کند.
 *
 * ⚠️ عددی که این تابع می‌دهد **پیشنهاد** است: سمت main همان `decideRedeem`
 * دوباره سقف را می‌سنجد و بیشتر از آن را قبول نمی‌کند (§۲۱). پس اگر کاربر با
 * DevTools این عدد را دست بکارد، هیچ اتفاقی نمی‌افتد.
 *
 * `requestedInput`:
 *   • null/0  ⇒ «حداکثر ممکن» (رفتار مو‌به‌موی نسخه‌های قبل).
 *   • عدد     ⇒ پرداخت ترکیبی: همان مقدار، ولی هرگز بیشتر از سقف پیش‌نمایش.
 */
export function posCreditPlan(input: {
  payable: number
  preview: CreditPreviewLike | null
  requestedInput: number | null
}): PosCreditPlan {
  const payable = Math.max(0, intOf(input.payable))
  const p = input.preview
  if (!p || !p.ok)
    return {
      applied: 0,
      cashDue: payable,
      requested: null,
      excludedVariantIds: p?.excludedVariantIds ?? [],
      notes: p?.notes ?? [],
      error: p?.error ?? null
    }
  const ceiling = Math.min(payable, Math.max(0, intOf(p.applied)))
  const asked = input.requestedInput == null ? 0 : Math.max(0, intOf(input.requestedInput))
  const applied = asked > 0 ? Math.min(asked, ceiling) : ceiling
  const notes = [...(p.notes ?? [])]
  if (asked > ceiling)
    notes.push(
      `مبلغ درخواستی از سقف قابل‌مصرف این اعتبار روی این فاکتور بیشتر بود، پس تا ${ceiling} ریال کوتاه شد.`
    )
  return {
    applied,
    cashDue: Math.max(0, payable - applied),
    // «حداکثر ممکن» را عمداً به‌صورت null می‌فرستیم تا main خودش سقف را حساب
    // کند؛ فرستادن عدد یعنی قفل کردن مبلغ روی محاسبه‌ی UI.
    requested: asked > 0 ? applied : null,
    excludedVariantIds: p.excludedVariantIds ?? [],
    notes,
    error: null
  }
}

// ---------------------------------------------------------------------------
// ۸) جلسه ۲۷ — گزارش‌های تفکیکی، جزئیات کامل، و علامت‌گذاری سبد در پنل فروش
//
// هر چیزی که این بخش اضافه می‌کند «نمایش» است، نه قاعده: تصمیم مصرف همان
// `decideRedeem` سمت `credit.ts` است و اعمالش همان سرویس main. دلیل نشستن این
// توابع اینجا (و نه داخل JSX) همان دلیل بالای فایل است: `.tsx` بدون
// node_modules قابل تست نیست، این‌ها هستند (`test/credit-ui-logic-session27.ts`).
// ---------------------------------------------------------------------------

/** یک ردیف تفکیک داشبورد (هم `byStatus` و هم `bySource` همین شکل را دارند). */
export interface CreditBreakdownLike {
  count: number
  amount: number
  usedAmount: number
  status?: string
  statusLabel?: string
  source?: string
  sourceLabel?: string
}

export const CREDIT_BREAKDOWN_HEADERS = ['عنوان', 'تعداد', 'مجموع مبلغ', 'مصرف‌شده', 'باقی‌مانده']

/**
 * ردیف تفکیکیِ گزارش مالی (§۱۵ — «گزارش مالی جدا برای هرکدام از این دسته‌ها»).
 * باقی‌مانده *محاسبه* می‌شود و نه خوانده: سرویس فقط `amount` و `usedAmount` را
 * به‌ازای هر دسته می‌دهد و همین دو عدد مبنای هر جمعی‌اند.
 */
export function breakdownRow(b: CreditBreakdownLike): (string | number | null)[] {
  const amount = intOf(b.amount)
  const used = intOf(b.usedAmount)
  return [
    String(b.statusLabel ?? b.sourceLabel ?? b.status ?? b.source ?? ''),
    intOf(b.count),
    amount,
    used,
    Math.max(0, amount - used)
  ]
}

export const CREDIT_DASHBOARD_HEADERS = ['شاخص', 'مقدار', 'واحد', 'توضیح']

/**
 * کارت‌های داشبورد ⇒ ردیف‌های اکسل (§۱۵). عمداً از همان `dashboardCards`
 * ساخته می‌شود تا خروجی اکسل و کارت‌های روی صفحه هیچ‌وقت از هم جدا نشوند.
 */
export function dashboardExportRows(d: DashboardLike | null): (string | number | null)[][] {
  return dashboardCards(d).map((c) => [c.title, c.value, c.kind === 'money' ? 'ریال' : 'تعداد', String(c.hint ?? '')])
}

/**
 * خلاصه‌ی فارسی محدودیت‌های یک اعتبار (§۱۸) — برای صفحه‌ی جزئیات و پنل فروش.
 * هیچ‌وقت رشته‌ی خالی نمی‌دهد: «بدون محدودیت» هم یک خبر است.
 */
export function describeRestrictions(r: any): string {
  const scope = normalizeRestrictScope(r?.restrictScope)
  const cats = cleanIds(r?.restrictCategoryIds)
  const vars = cleanIds(r?.restrictVariantIds)
  const parts: string[] = []
  if (scope === CreditRestrictScope.CATEGORY)
    parts.push(`فقط روی ${cats.length} دسته‌بندی مشخص (${cats.join('، ')})`)
  else if (scope === CreditRestrictScope.VARIANTS)
    parts.push(`فقط روی ${vars.length} کالای مشخص (${vars.join('، ')})`)
  else parts.push('روی همه‌ی کالاها')
  const min = intOf(r?.minPurchase)
  const max = intOf(r?.maxPerTransaction)
  if (min > 0) parts.push(`حداقل مبلغ خرید ${min} ریال`)
  if (max > 0) parts.push(`حداکثر ${max} ریال در هر تراکنش`)
  if (r?.customerLocked === true) parts.push('فقط برای همان مشتریِ ثبت‌شده')
  return parts.join(' · ')
}

/** یک قلم «برچسب: مقدار» برای بلوک‌های صفحه‌ی جزئیات. */
export interface CreditFact {
  key: string
  label: string
  value: string
}

/**
 * اطلاعات گیرنده (§۱۲) — فیلدهای خالی حذف می‌شوند تا بلوک جزئیات پر از «—» نشود.
 * اگر هیچ‌کدام پر نباشد آرایه‌ی خالی برمی‌گردد و UI خودِ بلوک را نشان نمی‌دهد.
 */
export function holderFacts(r: any): CreditFact[] {
  const out: CreditFact[] = []
  const push = (key: string, label: string, raw: unknown) => {
    const v = trimmed(raw)
    if (v) out.push({ key, label, value: v })
  }
  push('customerName', 'نام دارنده', r?.customerName)
  if (r?.customerId != null) out.push({ key: 'customerId', label: 'شناسه مشتری', value: String(intOf(r.customerId)) })
  push('holderCompany', 'شرکت / سازمان', r?.holderCompany)
  push('holderNationalId', 'شناسه ملی', r?.holderNationalId)
  push('holderPhone', 'تلفن', r?.holderPhone)
  push('holderAgent', 'نماینده', r?.holderAgent)
  push('holderAddress', 'آدرس', r?.holderAddress)
  push('holderNote', 'توضیح دارنده', r?.holderNote)
  if (r?.customerLocked === true)
    out.push({ key: 'customerLocked', label: 'قفل مشتری', value: 'فقط همین مشتری می‌تواند مصرف کند' })
  if (r?.reminderOptOut === true)
    out.push({ key: 'reminderOptOut', label: 'یادآوری', value: 'مشتری یادآوری نمی‌خواهد (Opt-out)' })
  return out
}

/**
 * پیوندهای سند (§۱۹ و §۴) — فاکتور اصلی، سند تعویض، برگشتی، اعتبار باقی‌مانده و
 * دسته‌ی تولید گروهی. تا امروز سرویس همه‌ی این‌ها را می‌داد و هیچ‌جا دیده نمی‌شد.
 */
export function creditLinkFacts(detail: any): CreditFact[] {
  const c = detail?.credit ?? {}
  const out: CreditFact[] = []
  const withReceipt = (id: unknown, receiptNo: unknown): string => {
    const n = intOf(receiptNo)
    return n > 0 ? `#${intOf(id)} (فیش ${n})` : `#${intOf(id)}`
  }
  if (c.sourceInvoiceId != null)
    out.push({ key: 'sourceInvoice', label: 'فاکتور اصلی مشتری', value: withReceipt(c.sourceInvoiceId, c.sourceReceiptNo) })
  if (c.exchangeInvoiceId != null)
    out.push({ key: 'exchangeInvoice', label: 'سند تعویض', value: withReceipt(c.exchangeInvoiceId, c.exchangeReceiptNo) })
  if (c.returnId != null) out.push({ key: 'return', label: 'برگشتی/تعویضی', value: `#${intOf(c.returnId)}` })
  if (c.usedInvoiceId != null)
    out.push({ key: 'usedInvoice', label: 'فاکتور مصرف', value: withReceipt(c.usedInvoiceId, c.usedReceiptNo) })
  if (detail?.remainderCredit)
    out.push({
      key: 'remainder',
      label: 'اعتبار باقی‌مانده',
      value: `${String(detail.remainderCredit.publicReference ?? `اعتبار #${intOf(detail.remainderCredit.id)}`)} (${intOf(detail.remainderCredit.amount)} ریال)`
    })
  if (detail?.batch)
    out.push({
      key: 'batch',
      label: 'دسته‌ی تولید گروهی',
      value: `#${intOf(detail.batch.id)} ${trimmed(detail.batch.title)}`.trim()
    })
  if (c.settingsOverride === true)
    out.push({
      key: 'override',
      label: 'استثنای تنظیمات',
      value: trimmed(c.overrideReason) || 'بدون دلیل ثبت‌شده (رکورد قدیمی)'
    })
  return out
}

// --- پنل فروش: کدام اقلام سبد با این اعتبار پوشش داده می‌شوند؟ (§۱۸) ---------

export interface CartLineLike {
  variantId: number
  name?: string | null
  qty?: number
  lineTotal?: number
}

export interface CreditCartCoverage {
  /** این اعتبار محدودیت کالا/دسته دارد؟ (اگر نه، هیچ ردیفی علامت نمی‌خورد) */
  restricted: boolean
  coveredIds: number[]
  excludedIds: number[]
  coveredTotal: number
  excludedTotal: number
  /** پیام فارسی بالای سبد · null = چیزی برای گفتن نیست */
  message: string | null
}

/** همین یک تابع مرجع «این ردیف خط‌خورده است یا نه» در JSX است. */
export function isLineExcluded(variantId: unknown, excludedVariantIds: unknown): boolean {
  return cleanIds(excludedVariantIds).includes(intOf(variantId))
}

/**
 * پیش‌نمایش سرویس، `excludedVariantIds` را از همان `evaluateEligibility` می‌دهد.
 * تا جلسه ۲۶ این آرایه تا `Pos.tsx` می‌آمد و **دور ریخته می‌شد** — یعنی §۱۸
 * صریحاً می‌گفت «در UI مصرف اعتبار مشخص شود کدام اقلام سبد قابل پوشش‌اند» و
 * نمی‌شد. این تابع همان تقسیم را انجام می‌دهد و مبلغ هر طرف را هم می‌دهد تا
 * فروشنده بفهمد چرا سقف اعتبار از جمع فاکتور کمتر شد.
 */
export function creditCartCoverage(input: {
  lines: CartLineLike[]
  excludedVariantIds: unknown
  scopeLabel?: string | null
}): CreditCartCoverage {
  const excluded = cleanIds(input.excludedVariantIds)
  const lines = Array.isArray(input.lines) ? input.lines : []
  const coveredIds: number[] = []
  const excludedIds: number[] = []
  let coveredTotal = 0
  let excludedTotal = 0
  for (const l of lines) {
    const id = intOf(l?.variantId)
    const total = Math.max(0, intOf(l?.lineTotal))
    if (id > 0 && excluded.includes(id)) {
      if (!excludedIds.includes(id)) excludedIds.push(id)
      excludedTotal += total
    } else {
      if (id > 0 && !coveredIds.includes(id)) coveredIds.push(id)
      coveredTotal += total
    }
  }
  const restricted = excluded.length > 0
  let message: string | null = null
  if (restricted && !coveredIds.length)
    message =
      'هیچ‌کدام از اقلام این سبد در دامنه‌ی مجاز این اعتبار نیست' +
      (input.scopeLabel ? ` (${input.scopeLabel})` : '') +
      '، پس این اعتبار روی این فاکتور قابل استفاده نیست.'
  else if (restricted)
    message =
      `این اعتبار فقط روی ${coveredIds.length} قلم از سبد قابل استفاده است` +
      (input.scopeLabel ? ` (${input.scopeLabel})` : '') +
      `؛ ${excludedIds.length} قلم به مبلغ ${excludedTotal} ریال خارج از دامنه است و باید نقد/کارتی پرداخت شود.`
  return { restricted, coveredIds, excludedIds, coveredTotal, excludedTotal, message }
}

// ---------------------------------------------------------------------------
// ۹) جلسه ۲۸ — تصمیم‌هایی که تا دیروز داخل JSX بودند (یا هیچ‌جا نبودند)
//
// قاعده‌ی این فایل عوض نشده است: هیچ قاعده‌ی مالی/امنیتی تازه‌ای اینجا نیست.
// چیزی که این بخش اضافه می‌کند، همان «تصمیم‌های نمایشی» است که فرم‌های تازه‌ی
// `components/CreditForms.tsx` و `components/CreditPickers.tsx` و صفحه‌ی جزئیات
// لازم دارند — و دلیل نشستن‌شان اینجا همان دلیل بالای فایل است: در این محیط
// `.tsx` قابل اجرا/تست نیست و این‌ها هستند (`test/credit-ui-logic-session28.ts`).
// ---------------------------------------------------------------------------

/** گزینه‌های کشوییِ الفبای کد (§۶ و §۲۲) — ترتیب از امن‌ترین به حدس‌زدنی‌ترین. */
export const CREDIT_ALPHABET_OPTIONS: { value: string; label: string }[] = [
  CreditCodeAlphabet.ALNUM,
  CreditCodeAlphabet.ALPHA,
  CreditCodeAlphabet.NUM
].map((k) => ({ value: k, label: CREDIT_ALPHABET_LABELS[k] ?? k }))

/** گزینه‌های کشوییِ اندازه‌ی کاغذ سند اعتبار (§۱۳). */
export const CREDIT_PAPER_OPTIONS: { value: string; label: string }[] = [
  CreditPaper.A4,
  CreditPaper.A5,
  CreditPaper.A6,
  CreditPaper.T80,
  CreditPaper.T58,
  CreditPaper.CUSTOM
].map((k) => ({ value: k, label: CREDIT_PAPER_LABELS[k] ?? k }))

// ===== نشست ۳۱۷ · طرح کلاد (برنده) — کارت «چاپ سند اعتبار» (§۷ + §۱۳) =====

/** گزینه‌های اندازه‌ی فونت چاپ سند (مثل سایه‌های فاکتور/لیبل: ثابت و خوانا). */
export const CREDIT_FONT_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '8', label: 'ریز (۸)' },
  { value: '10', label: 'کوچک (۱۰)' },
  { value: '11', label: 'پیش‌فرض (۱۱)' },
  { value: '12', label: 'متوسط (۱۲)' },
  { value: '14', label: 'درشت (۱۴)' },
  { value: '16', label: 'خیلی درشت (۱۶)' }
]

/**
 * برچسب کوتاهِ کاغذ/فونت/حاشیه‌ی فعلی برای نمایش داخل کارت و هشدار ویژگی‌ها.
 * (شبیه سربرگِ «چاپ: فونت X · حاشیه Y×Zmm · کاغذ D»)
 */
export function creditPrintSummaryLabel(form: CreditSettings): string {
  return `فونت ${form.printFontPx}px · حاشیه ${form.printMarginYMm}×${form.printMarginXMm}mm · ${CREDIT_PAPER_LABELS[form.paper] ?? form.paper}`
}

/**
 * هشدارهای نمایشی کارت چاپ سند (صرفاً اخطار UI؛ clamp نهایی همیشه در main
 * انجام می‌شود — §۶: هیچ‌کدام سند واقعی چاپ نمی‌کنند).
 */
export function creditPrintWarnings(form: CreditSettings): string[] {
  const out: string[] = []
  const width = creditPaperSize(form.paper, form.customWidthMm, form.customHeightMm).widthMm
  if (form.printFontPx >= 14 && width < 105)
    out.push('فونت درشت روی کاغذ باریک (کمتر از A6) ممکن است سطرها بپیچد یا از عرض بیرون بزند — پیش‌نمایش را ببینید.')
  if (form.printMarginXMm >= 8 && width <= 80)
    out.push('حاشیه‌ی افقی پهن روی رول حرارتی، عرض مفید لایه را بیش از حد کوچک می‌کند — پیش‌نمایش را ببینید.')
  if (form.printFontPx <= 8)
    out.push('فونت ریز ممکن است روی برگه‌ی باطل‌شده/نمونه هم خوانا نباشد — رعایت کنید هر سند بدون استثنا خوانا شود.')
  return out
}

export const CREDIT_EXPIRY_MODE_OPTIONS: { value: IssueDraft['expiryMode']; label: string }[] = [
  { value: 'default', label: 'پیش‌فرض همین نوع اعتبار' },
  { value: 'days', label: 'تعداد روز دلخواه' },
  { value: 'none', label: 'بدون انقضا' }
]

export const CREDIT_USES_MODE_OPTIONS: { value: OpDraft['usesMode']; label: string }[] = [
  { value: 'single', label: 'یک‌بارمصرف' },
  { value: 'count', label: 'چندباره (تا N بار)' },
  { value: 'unlimited', label: 'چندباره تا پایان مبلغ' }
]

// --- کدام عملیات مدیریتی چه فیلدهایی می‌خواهد؟ (§۱۰ و §۱۱) -------------------

/**
 * نام بلوک‌های *اضافه‌ی* فرم عملیات. «رمز مدیر» و «دلیل» در همه‌ی عملیات‌ها
 * اجباری‌اند و جزء این فهرست نیستند.
 */
export type CreditOpField = 'extendDays' | 'expiry' | 'amount' | 'uses' | 'holder' | 'restriction'

const OP_FIELDS: Record<CreditOp, CreditOpField[]> = {
  VOID: [],
  SUSPEND: [],
  REACTIVATE: ['extendDays'],
  EXPIRY: ['expiry'],
  AMOUNT: ['amount'],
  USES: ['uses'],
  HOLDER: ['holder'],
  RESTRICTION: ['restriction'],
  DELETE: []
}

/**
 * تا جلسه ۲۷، فرم عملیات فقط `extendDays` و `amount` را می‌شناخت، پس چهار
 * عملیاتِ EXPIRY/USES/HOLDER/RESTRICTION از UI **قابل انجام نبودند** با این‌که
 * `buildOpPayload` از جلسه ۲۲ هر چهار را پشتیبانی می‌کرد. این نقشه همان گپ را
 * می‌بندد و «کدام فیلد در کدام عملیات» یک تصمیم *تست‌شده* می‌شود، نه یک زنجیره‌ی
 * `&&` داخل JSX.
 */
export function opFields(op: CreditOp): CreditOpField[] {
  return [...(OP_FIELDS[op] ?? [])]
}

/** حالت دفعاتِ یک رکورد موجود ⇒ همان سه گزینه‌ی فرم. */
export function usesModeOf(credit: any): OpDraft['usesMode'] {
  if (credit?.multiUse !== true) return 'single'
  return intOf(credit?.maxUses, 1) > 1 ? 'count' : 'unlimited'
}

/**
 * فرم عملیات با **مقدار فعلی همان اعتبار** پر می‌شود، نه با صفر.
 *
 * چرا این یک «تصمیم» است و نه سلیقه: عملیات HOLDER و RESTRICTION مقدار را
 * *جایگزین* می‌کنند (Payload کامل می‌فرستند، نه Patch). اگر فرم خالی باز شود،
 * مدیری که فقط می‌خواهد تلفن گیرنده را عوض کند، ناخواسته شرکت/شناسه ملی/آدرس و
 * حتی دامنه‌ی کالایی اعتبار را پاک می‌کند. پس پیش‌پُرکردن اینجا جلوی یک خرابیِ
 * واقعی را می‌گیرد.
 */
export function prefillOpDraft(op: CreditOp, credit: any): OpDraft {
  const d = emptyOpDraft(op, intOf(credit?.id))
  if (!credit) return d
  switch (op) {
    case CreditOp.EXPIRY:
      return { ...d, expiresAtJalali: trimmed(credit.expiresAtJalali) }
    case CreditOp.AMOUNT:
      return { ...d, amount: intOf(credit.amount) }
    case CreditOp.USES:
      return {
        ...d,
        usesMode: usesModeOf(credit),
        maxUses: Math.max(2, intOf(credit.maxUses, 2)),
        maxPerTransaction: intOf(credit.maxPerTransaction)
      }
    case CreditOp.HOLDER:
      return {
        ...d,
        customerId: credit.customerId == null ? null : intOf(credit.customerId),
        customerName: trimmed(credit.customerName),
        customerLocked: credit.customerLocked === true,
        holderCompany: trimmed(credit.holderCompany),
        holderNationalId: trimmed(credit.holderNationalId),
        holderPhone: trimmed(credit.holderPhone),
        holderAddress: trimmed(credit.holderAddress),
        holderAgent: trimmed(credit.holderAgent),
        holderNote: trimmed(credit.holderNote),
        reminderOptOut: credit.reminderOptOut === true
      }
    case CreditOp.RESTRICTION:
      return {
        ...d,
        restrictScope: normalizeRestrictScope(credit.restrictScope),
        restrictCategoryIds: cleanIds(credit.restrictCategoryIds),
        restrictVariantIds: cleanIds(credit.restrictVariantIds),
        minPurchase: intOf(credit.minPurchase),
        maxPerTransaction: intOf(credit.maxPerTransaction)
      }
    default:
      return d
  }
}

/** یک قاعده‌ی تنظیماتِ هر نوع را عوض می‌کند، بدون له‌کردن بقیه‌ی نوع‌ها (§۳ و §۲۲). */
export function setTypeRule(settings: CreditSettings, key: string, patch: Record<string, unknown>): CreditSettings {
  const current = settings.types[key] ?? rulesForSource(settings, key)
  return {
    ...settings,
    types: {
      ...settings.types,
      [key]: {
        days: patch.days === undefined ? current.days : Math.max(0, intOf(patch.days)),
        maxUses: patch.maxUses === undefined ? current.maxUses : Math.max(1, intOf(patch.maxUses, 1)),
        multiUse: patch.multiUse === undefined ? current.multiUse : patch.multiUse === true,
        // نشست ۱۸۳ — تکلیف باقی‌مانده‌ی اعتبار یک‌بارمصرف (بارکد جدید یا سوختن)
        carryRemainder:
          patch.carryRemainder === undefined ? current.carryRemainder : patch.carryRemainder === true
      }
    }
  }
}

// --- یادآوری: فیلتر «فقط واجد شرایط» (§۱۴) ----------------------------------

/**
 * تب یادآوری همیشه `onlyDue:false` می‌خواست و هر دو گروه «باید» و «نباید» را
 * قاطیِ هم نشان می‌داد، پس عملاً غیرقابل استفاده بود. فیلتر سمت UI انجام
 * می‌شود تا کاربر بتواند بدون رفت‌و‌برگشت بین دو نما جابه‌جا شود و *دلیلِ*
 * ناواجدشرایط بودن هم از دست نرود.
 */
export function reminderFilter(
  rows: any[],
  onlyEligible: boolean
): { rows: any[]; total: number; eligible: number; hidden: number } {
  const all = Array.isArray(rows) ? rows : []
  const eligible = all.filter((r) => r?.should === true)
  const visible = onlyEligible ? eligible : all
  return { rows: visible, total: all.length, eligible: eligible.length, hidden: all.length - visible.length }
}

// --- پنل فروش: Payload وفادارِ پیش‌نمایش (§۱۸) -------------------------------

export interface PosPreviewLine {
  variantId: number
  qty: number
  categoryId?: number | null
  /** مبلغ *خالص* همین ردیف (بعد از تخفیف ردیف) */
  lineTotal: number
}

/**
 * Payload کانال `credit:preview`.
 *
 * تا جلسه ۲۷، پنل فروش این payload را دستی می‌ساخت و دو چیز را خراب می‌فرستاد:
 * `customerId: null` (پس «قفل مشتری» هیچ‌وقت در پیش‌نمایش دیده نمی‌شد) و بدون
 * `categoryId` هر خط (پس محدودیت دسته‌بندی در پیش‌نمایش بی‌اثر بود). نتیجه:
 * فروشنده عددی می‌دید که Backend قبولش نداشت — بدترین حالت.
 *
 * ⚠️ همین حالا هم این payload «تصمیم» نیست: سرویس main خودش اقلام فاکتور را از
 * دیتابیس می‌خواند و `decideRedeem` را دوباره اجرا می‌کند (§۲۱).
 */
export function posPreviewPayload(input: {
  code: string
  payable: number
  requested: number | null
  customerId: number | null
  lines: PosPreviewLine[]
}): Record<string, unknown> | null {
  const code = trimmed(input.code).toUpperCase()
  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((l) => ({
      variantId: intOf(l?.variantId),
      qty: Math.max(0, intOf(l?.qty)),
      categoryId: l?.categoryId == null ? null : intOf(l.categoryId),
      lineTotal: Math.max(0, intOf(l?.lineTotal))
    }))
    .filter((l) => l.variantId > 0)
  if (!code || !lines.length) return null
  const payable = Math.max(0, intOf(input.payable))
  const requested = input.requested == null ? null : Math.max(0, intOf(input.requested))
  return {
    code,
    applicable: payable,
    invoiceTotal: payable,
    requested,
    customerId: input.customerId == null ? null : intOf(input.customerId),
    lines
  }
}

// --- خروجی اکسل هر گزارش (§۱۵ و Q3) -----------------------------------------

export type CreditExportKind =
  | 'list'
  | 'dashboard'
  | 'byStatus'
  | 'bySource'
  | 'redemptions'
  | 'timeline'
  | 'reminders'
  | 'reminderLogs'
  | 'batches'

export interface CreditExportSheet {
  fileName: string
  sheetName: string
  headers: string[]
  rows: (string | number | null)[][]
  totals?: (string | number | null)[]
}

/**
 * «خروجی اکسل برای *هر* گزارش» (§۱۵ می‌خواست «گزارش مالی جدا برای هرکدام از
 * این دسته‌ها»؛ تا جلسه ۲۷ فقط فهرست اعتبارها خروجی داشت).
 *
 * چرا یک تابع و نه ۹ تا دکمه‌ی دست‌ساز: چون سرستون و ردیف‌ساز هر گزارش از قبل
 * در همین فایل هست و تنها چیزی که می‌ماند «کدام سرستون با کدام ردیف‌ساز» است —
 * یعنی دقیقاً همان چیزی که اگر در JSX بنشیند، روزی یکی‌شان جابه‌جا می‌شود و
 * هیچ تستی نمی‌فهمد. `null` یعنی «چیزی برای خروجی نیست».
 */
export function creditExport(kind: CreditExportKind, data: any): CreditExportSheet | null {
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
  const sum = (rows: (string | number | null)[][], col: number): number =>
    rows.reduce((s, r) => s + intOf(r[col]), 0)
  const breakdown = (rows: any[], sheet: string, file: string): CreditExportSheet | null => {
    if (!rows.length) return null
    const body = rows.map(breakdownRow)
    return {
      fileName: file,
      sheetName: sheet,
      headers: CREDIT_BREAKDOWN_HEADERS,
      rows: body,
      totals: ['جمع', sum(body, 1), sum(body, 2), sum(body, 3), sum(body, 4)]
    }
  }

  switch (kind) {
    case 'list': {
      const rows = list(data)
      if (!rows.length) return null
      const body = rows.map(creditListRow)
      /**
       * جلسه ۳۰ — ردیف «جمع» هم از همین‌جا می‌آید، نه از صفحه.
       * تا دیروز فقط تب گزارشات یک ردیف جمعِ دست‌ساز داشت (با `Array(len - 6)`
       * دستی) و صفحه‌ی مدیریت اعتبار هیچ جمعی نداشت؛ یعنی دو خروجی از یک داده
       * دو شکل داشتند و هم‌ترازیِ ستون جمع با سرستون، تصمیمی بود که هیچ‌کس
       * تستش نمی‌کرد. حالا هر دو صفحه یک ردیف جمع می‌گیرند و هم‌ترازی‌اش با
       * `CREDIT_LIST_TOTAL_COLUMNS` تست می‌شود.
       */
      return {
        fileName: 'اعتبار-خرید',
        sheetName: 'اعتبارها',
        headers: CREDIT_LIST_HEADERS,
        rows: body,
        totals: creditListTotals(body)
      }
    }
    case 'dashboard': {
      const rows = dashboardExportRows(data ?? null)
      if (!rows.length) return null
      return { fileName: 'داشبورد-اعتبار', sheetName: 'داشبورد', headers: CREDIT_DASHBOARD_HEADERS, rows }
    }
    case 'byStatus':
      return breakdown(list(data?.byStatus ?? data), 'تفکیک بر اساس وضعیت', 'اعتبار-تفکیک-وضعیت')
    case 'bySource':
      return breakdown(list(data?.bySource ?? data), 'تفکیک بر اساس نوع', 'اعتبار-تفکیک-نوع')
    case 'redemptions': {
      const rows = list(data)
      if (!rows.length) return null
      const body = rows.map(redemptionRow)
      return {
        fileName: 'سوابق-مصرف-اعتبار',
        sheetName: 'دفتر مصرف',
        headers: CREDIT_REDEMPTION_HEADERS,
        rows: body,
        totals: ['جمع', '', '', sum(body, 3), '', '', '', '', '', '', '']
      }
    }
    case 'timeline': {
      const rows = list(data)
      if (!rows.length) return null
      return { fileName: 'تاریخچه-اعتبار', sheetName: 'Timeline', headers: CREDIT_TIMELINE_HEADERS, rows: rows.map(timelineRow) }
    }
    case 'reminders': {
      const rows = list(data)
      if (!rows.length) return null
      return { fileName: 'نامزدهای-یادآوری', sheetName: 'یادآوری', headers: CREDIT_REMINDER_HEADERS, rows: rows.map(reminderCandidateRow) }
    }
    case 'reminderLogs': {
      const rows = list(data)
      if (!rows.length) return null
      return { fileName: 'لاگ-یادآوری', sheetName: 'لاگ یادآوری', headers: CREDIT_REMINDER_LOG_HEADERS, rows: rows.map(reminderLogRow) }
    }
    case 'batches': {
      const rows = list(data)
      if (!rows.length) return null
      const body = rows.map(batchRow)
      return {
        fileName: 'دسته‌های-اعتبار',
        sheetName: 'دسته‌ها',
        headers: CREDIT_BATCH_HEADERS,
        rows: body,
        totals: ['جمع', '', sum(body, 2), '', sum(body, 4), '', '', '', '', '']
      }
    }
    default:
      return null
  }
}

// --- صفحه‌ی جزئیات: بلوک‌های «برچسب: مقدار» (§۱۶ و Q1) -----------------------

export interface CreditFactBlock {
  key: string
  title: string
  facts: CreditFact[]
}

/**
 * سه بلوکی که سرویس از جلسه ۲۱ برمی‌گرداند و صفحه‌ی جزئیات دور می‌ریخت:
 * گیرنده (§۱۲)، محدودیت مصرف (§۱۸)، و پیوندهای سند (§۱۹). بلوک خالی حذف
 * می‌شود تا صفحه پر از «—» نشود.
 */
export function detailFactBlocks(detail: any): CreditFactBlock[] {
  const c = detail?.credit ?? {}
  const blocks: CreditFactBlock[] = []
  const holder = holderFacts(c)
  if (holder.length) blocks.push({ key: 'holder', title: 'گیرنده‌ی اعتبار', facts: holder })

  const restriction: CreditFact[] = [{ key: 'scope', label: 'دامنه‌ی مصرف', value: describeRestrictions(c) }]
  if (c.usesLabel) restriction.push({ key: 'uses', label: 'قواعد دفعات', value: trimmed(c.usesLabel) })
  if (intOf(c.usesLeft) >= 0 && intOf(c.maxUses, 1) > 1)
    restriction.push({ key: 'usesLeft', label: 'دفعات باقی‌مانده', value: String(intOf(c.usesLeft)) })
  blocks.push({ key: 'restriction', title: 'محدودیت مصرف', facts: restriction })

  const links = creditLinkFacts(detail)
  const issuedBy = trimmed(detail?.issuedByName)
  if (issuedBy) links.unshift({ key: 'issuedBy', label: 'صادرکننده', value: issuedBy })
  if (links.length) blocks.push({ key: 'links', title: 'پیوندهای سند و سابقه', facts: links })
  return blocks
}

// ---------------------------------------------------------------------------
// ۱۰) جلسه ۳۰ — تصمیم‌های *نمایشی* تازه (§۱۳ لوگوی سند · §۱۵ خروجی تب گزارشات)
//
// یادآوری قاعده‌ی جلسه ۲۹: قاعده‌ی مالی/امنیتی در `credit.ts` می‌نشیند و این
// فایل فقط تصمیم نمایشی دارد. هر سه چیزِ این بخش «چه چیزی روی کاغذ/در فایل
// دیده شود» است، نه «چه چیزی مجاز است».
// ---------------------------------------------------------------------------

/** ستون‌هایی از فهرست اعتبار که ردیف «جمع» دارند (شماره‌ی ستون در `CREDIT_LIST_HEADERS`). */
export const CREDIT_LIST_TOTAL_COLUMNS: readonly number[] = [3, 4, 5]

/**
 * ردیف «جمع» فهرست اعتبار — هم‌تراز با سرستون‌ها و مستقل از تعداد ستون‌ها.
 *
 * نسخه‌ی قبلی (در JSX تب گزارشات) با `Array(CREDIT_LIST_HEADERS.length - 6)`
 * دستی pad می‌شد: یعنی اضافه شدن یک ستون *وسط* جدول، بی‌صدا جمع را زیر ستون
 * اشتباه می‌برد. اینجا طول ردیف از خودِ سرستون می‌آید و ستون‌های جمع‌دار صریح‌اند.
 */
export function creditListTotals(rows: (string | number | null)[][]): (string | number | null)[] {
  const out: (string | number | null)[] = new Array(CREDIT_LIST_HEADERS.length).fill('')
  out[0] = 'جمع'
  for (const col of CREDIT_LIST_TOTAL_COLUMNS)
    out[col] = (rows ?? []).reduce((sum, r) => sum + intOf(r?.[col]), 0)
  return out
}

export interface CreditDocLogo {
  show: boolean
  src: string
  heightMm: number
}

/**
 * §۱۳ — لوگوی سند اعتبار.
 *
 * وضعیت واقعی که ممیزی پیدا کرد: `ReceiptTemplate` هیچ فیلد لوگویی نداشت، ولی
 * `LabelTemplate.logoDataUrl` یک لوگوی *مشترک همه‌ی قالب‌ها* داشت که کاربر یک
 * بار آپلود کرده است. تصمیم (طبق پیشنهاد HANDOFF جلسه ۲۹): فیلدهای لوگو به
 * قالب رسید اضافه می‌شوند، ولی اگر `logoDataUrl` رسید خالی بود از همان لوگوی
 * لیبل پر می‌شود تا کاربر دو بار یک تصویر را آپلود نکند.
 *
 * ⚠️ «خالی» فقط رشته‌ی خالی نیست: یک dataURL ناقص (بدون `data:`) هم روی کاغذ
 * یک آیکن شکسته می‌شود، پس همین‌جا رد می‌شود.
 */
export function creditDocLogo(input: {
  showLogo?: unknown
  logoDataUrl?: unknown
  fallbackDataUrl?: unknown
  logoHeightMm?: unknown
}): CreditDocLogo {
  const usable = (v: unknown): string => {
    const s = trimmed(v)
    return s.startsWith('data:') ? s : ''
  }
  const src = usable(input?.logoDataUrl) || usable(input?.fallbackDataUrl)
  const heightMm = Math.min(Math.max(intOf(input?.logoHeightMm, 10) || 10, 3), 40)
  return { show: input?.showLogo === true && !!src, src, heightMm }
}

/** یک dataURL واقعی است یا آشغال؟ (همان معیار `creditDocLogo`, یک جا) */
export const usableLogoDataUrl = (v: unknown): string => (trimmed(v).startsWith('data:') ? trimmed(v) : '')

/**
 * بند ۷ (جلسه ۳۱) — ارث‌بری لوگو از تنظیمات لیبل، **زنده**.
 *
 * `receiptTemplate()` وقتی `logoDataUrl` قالب رسید خالی است آن را از
 * `labelTemplate().logoDataUrl` پر می‌کند (کاربر یک تصویر را دو بار آپلود
 * نکند). ولی همین پر کردن یک تله دارد: صفحه‌ی تنظیمات همان مقدارِ پرشده را
 * دوباره ذخیره می‌کند ⇒ کپیِ *منجمد* لوگو داخل کلید رسید می‌نشیند و از آن به
 * بعد عوض کردن لوگوی لیبل روی سند اعتبار هیچ اثری ندارد (و یک dataURL بزرگ هم
 * بی‌دلیل دو بار در دیتابیس می‌ماند).
 *
 * پس دو تابع قرینه لازم است: یکی برای *خواندن* (ارث‌بری) و یکی برای *نوشتن*
 * (اگر همان لوگوی لیبل بود، خالی ذخیره شود تا ارث‌بری زنده بماند). لوگوی
 * متفاوتِ کاربر دست‌نخورده ذخیره می‌شود.
 */
export function receiptLogoInherit(logoDataUrl: unknown, labelLogoDataUrl: unknown): string {
  return usableLogoDataUrl(logoDataUrl) || usableLogoDataUrl(labelLogoDataUrl)
}

export function receiptLogoForSave(logoDataUrl: unknown, labelLogoDataUrl: unknown): string {
  const own = usableLogoDataUrl(logoDataUrl)
  const label = usableLogoDataUrl(labelLogoDataUrl)
  return !own || own === label ? '' : own
}

/**
 * §۱۵ — کدام گزارش‌های اعتبار در *تب گزارشات* (بازه‌ای) خروجی می‌گیرند.
 *
 * تب گزارشات یک بازه را نشان می‌دهد، پس فقط گزارش‌های بازه‌ای معنا دارند.
 * `redemptions` و `timeline` عمداً اینجا نیستند: هر دو گزارشِ *یک اعتبار*اند و
 * فقط از صفحه‌ی جزئیات (`CreditManagement`) می‌آیند — اگر در تب بازه‌ای هم
 * دکمه می‌شدند، یا خالی برمی‌گشتند یا ناچار می‌شدیم دفتر مصرف کل بازه را
 * بی‌دلیل بار کنیم.
 *
 * `lazy: true` یعنی داده‌اش در بار اول تب خوانده نمی‌شود و فقط با کلیک همان
 * دکمه گرفته می‌شود (تب گزارشات سبک بماند).
 */
export interface CreditRangeExport {
  kind: CreditExportKind
  label: string
  lazy: boolean
}

export const CREDIT_RANGE_EXPORTS: readonly CreditRangeExport[] = [
  { kind: 'list', label: 'فهرست اعتبارها', lazy: false },
  { kind: 'dashboard', label: 'داشبورد', lazy: false },
  { kind: 'byStatus', label: 'تفکیک وضعیت', lazy: false },
  { kind: 'bySource', label: 'تفکیک نوع', lazy: false },
  { kind: 'batches', label: 'دسته‌های گروهی', lazy: true },
  { kind: 'reminders', label: 'نامزدهای یادآوری', lazy: true },
  { kind: 'reminderLogs', label: 'لاگ یادآوری', lazy: true }
]

/** همان فهرست بالا، فقط کلیدها (برای تست و برای JSX). */
export const CREDIT_RANGE_EXPORT_KINDS: readonly CreditExportKind[] = CREDIT_RANGE_EXPORTS.map((e) => e.kind)

/** گزارش‌های *تک‌اعتباری* که فقط در صفحه‌ی جزئیات دیده می‌شوند (§۱۶). */
export const CREDIT_DETAIL_EXPORT_KINDS: readonly CreditExportKind[] = ['redemptions', 'timeline']

// ---------------------------------------------------------------------------
// ۱۱) جلسه ۳۲ — تصمیم‌های *نمایشی* تبِ بازه‌ایِ گزارشات (ادامه‌ی §۱۵)
//
// بخش ۱۰ گفت «کدام گزارش‌ها در تب گزارشات دکمه دارند» (`CREDIT_RANGE_EXPORTS`)
// ولی نگفت «داده‌ی هر دکمه از کجا می‌آید». تا دیروز همین نگفتن، کل تب را دست‌ساز
// نگه داشته بود: یک دکمه‌ی «خروجی اکسل»، سرستون و ردیف‌ساز جفت‌شده در JSX، و یک
// ردیف جمع با `Array(CREDIT_LIST_HEADERS.length - 6)` دستی.
//
// سه تله‌ی واقعی که این بخش می‌بندد:
//   ۱) `reminderCandidates` پاکت `{ enabled, rows }` برمی‌گرداند، نه آرایه. اگر
//      JSX خودِ پاکت را به `creditExport` بدهد، `list(data)` آرایه نمی‌بیند ⇒
//      `null` ⇒ کاربر پیام «این گزارش خالی است» می‌گیرد در حالی که داده هست.
//   ۲) `list` از ردیف‌های صفحه می‌آید و `dashboard`/`byStatus`/`bySource` از
//      خودِ داشبورد. جابه‌جا شدنشان در JSX هیچ خطای کامپایلی نمی‌دهد (`any`).
//   ۳) `redemptions`/`timeline` گزارش *یک اعتبار*اند و اصلاً منبعی در تب بازه‌ای
//      ندارند ⇒ `none`، تا سهواً دکمه‌ی خالی برایشان ساخته نشود.
// ---------------------------------------------------------------------------

/** داده‌ی هر خروجی بازه‌ای از کجا می‌آید؛ `none` = این گزارش در تب بازه‌ای جا ندارد. */
export type CreditRangeExportOrigin = 'rows' | 'dashboard' | 'fetch' | 'none'

/** کانال‌های خروجی‌های `lazy` — عیناً کلیدهای `shared/ipc.ts`. */
export type CreditRangeExportChannel = 'creditBatchList' | 'creditReminderCandidates' | 'creditReminderLogs'

export interface CreditRangeExportRequest {
  channel: CreditRangeExportChannel
  payload: Record<string, unknown>
  /** شکل پاسخ: `rows` یعنی پاکت `{ enabled, rows }` است و باید باز شود. */
  envelope: 'array' | 'rows'
}

export interface CreditRangeFilterLike {
  fromJalali?: string
  toJalali?: string
  source?: string
  status?: string
  take?: number
}

/** کدام گزارشِ `lazy` از کدام کانال. تنها جای این جفت‌شدن. */
export const CREDIT_RANGE_EXPORT_CHANNELS: Readonly<Partial<Record<CreditExportKind, CreditRangeExportChannel>>> = {
  batches: 'creditBatchList',
  reminders: 'creditReminderCandidates',
  reminderLogs: 'creditReminderLogs'
}

export function creditRangeExportOrigin(kind: CreditExportKind): CreditRangeExportOrigin {
  if (!CREDIT_RANGE_EXPORT_KINDS.includes(kind)) return 'none'
  if (CREDIT_RANGE_EXPORT_CHANNELS[kind]) return 'fetch'
  return kind === 'list' ? 'rows' : 'dashboard'
}

/**
 * درخواستِ داده‌ی یک خروجیِ `lazy` (فقط با کلیک زده می‌شود). `null` یعنی داده‌ی
 * این خروجی از قبل روی صفحه است و کانالی لازم نیست.
 *
 * ⚠️ `creditReminderCandidates` بازه نمی‌گیرد (نامزدهای «همین حالا»اند: سرویس
 * فقط `onlyDue`/`source`/`take` دارد) پس بازه سهواً به آن فرستاده نمی‌شود؛
 * `lazy` بودنش به‌خاطر سنگینیِ داده است نه بازه‌ای بودن. `onlyDue: false` هم
 * تصمیم همین‌جاست: خروجیِ تب گزارشات عکسِ کاملِ نامزدهاست و صافیِ «فقط واجد
 * شرایط» کار صفحه‌ی مدیریت اعتبار است (`reminderFilter`).
 */
export function creditRangeExportRequest(
  kind: CreditExportKind,
  filter: CreditRangeFilterLike = {}
): CreditRangeExportRequest | null {
  const channel = CREDIT_RANGE_EXPORT_CHANNELS[kind]
  if (!channel) return null
  const take = Math.min(Math.max(intOf(filter.take, 500) || 500, 1), 2000)
  const from = trimmed(filter.fromJalali)
  const to = trimmed(filter.toJalali)
  const range: Record<string, unknown> = {}
  if (from) range.fromJalali = from
  if (to) range.toJalali = to
  if (channel === 'creditReminderCandidates') {
    const source = trimmed(filter.source)
    return { channel, payload: { onlyDue: false, ...(source ? { source } : {}), take }, envelope: 'rows' }
  }
  return { channel, payload: { ...range, take }, envelope: 'array' }
}

/** پاسخ کانال ⇒ آرایه‌ی آماده‌ی `creditExport` (پاکت `{ rows }` همین‌جا باز می‌شود). */
export function creditRangeExportRows(request: CreditRangeExportRequest | null, raw: unknown): any[] {
  if (request?.envelope === 'rows') {
    const rows = (raw as any)?.rows
    return Array.isArray(rows) ? rows : []
  }
  return Array.isArray(raw) ? raw : []
}

// ---------------------------------------------------------------------------
// ۱۲) جلسه ۳۳ — «فهرست اعتبار روی صفحه»: کدام ستون‌ها دیده می‌شوند و هر سلول
//     با چه قالبی نوشته می‌شود.
//
// بخش ۲ گفت «ردیف اکسل چه ستون‌هایی دارد» (`CREDIT_LIST_HEADERS`/`creditListRow`)
// و بخش ۱۱ گفت «داده‌ی هر خروجی از کجا می‌آید» — ولی هیچ‌کدام نگفت *روی صفحه*
// چه چیزی دیده می‌شود. نتیجه‌اش این بود که هر دو جدولِ فهرست (صفحه‌ی مدیریت
// اعتبار و تب گزارشات) سه تصمیم را دستی تکرار می‌کردند:
//
//   ۱) `CREDIT_LIST_HEADERS.slice(0, 14)` — عددِ ۱۴ در سه نقطه‌ی JSX تکرار شده
//      بود (دو سرستون + `colSpan={14}`) و هیچ‌کس نمی‌دانست از کجا آمده.
//   ۲) چهارده `<td>` دست‌نویس به همان ترتیبِ فرضیِ سرستون. **تله‌ی واقعی:** این
//      ترتیب با `creditListRow` هیچ پیوندی نداشت، پس اضافه‌شدن یک ستون *وسط*
//      `CREDIT_LIST_HEADERS` بی‌صدا سرستون را از داده جدا می‌کرد — همان کلاس
//      باگی که ردیف جمع در جلسه ۳۲ گرفتارش بود. (و همین حالا هم یک واگرایی
//      داشتیم: صفحه `r.sourceLabel || CREDIT_SOURCE_LABELS[r.source]` می‌نوشت و
//      تب گزارشات فقط `r.sourceLabel` ⇒ ستون «نوع» در تب برای ردیف‌های قدیمی
//      خالی می‌ماند.)
//   ۳) «این ستون پول است یا شمارش» به‌صورت `money(r.amount)`/`faDigits(r.maxUses)`
//      در دو فایل پخش بود، و در ردیف جمع با `typeof cell === 'number'` حدس
//      زده می‌شد.
//
// از این نشست: ردیفِ روی صفحه هم از همان `creditListRow` می‌آید (فقط بریده‌شده)
// و قالب هر ستون یک تصمیمِ تست‌شده است. صفحه فقط `money`/`faDigits` را *چاپ*
// می‌کند.
// ---------------------------------------------------------------------------

/** چند ستونِ اولِ فهرست اعتبار روی صفحه دیده می‌شود (بقیه فقط در فایل اکسل). */
export const CREDIT_LIST_SCREEN_COLUMNS = 14

/** سرستون‌های همان ستون‌های دیده‌شده — تنها منبع `<thead>` هر دو جدول. */
export const CREDIT_LIST_SCREEN_HEADERS: readonly string[] = CREDIT_LIST_HEADERS.slice(0, CREDIT_LIST_SCREEN_COLUMNS)

/** قالب نمایش یک سلول: مبلغ (سه‌رقمی + ریال) · شمارش (فقط رقم فارسی) · متن. */
export type CreditCellFormat = 'money' | 'count' | 'text'

/** ستون‌های *مبلغی* فهرست اعتبار (شماره‌ی ستون در `CREDIT_LIST_HEADERS`). */
export const CREDIT_LIST_MONEY_COLUMNS: readonly number[] = [3, 4, 5, 10, 11]

/** ستون‌های *شمارشی* فهرست اعتبار (عدد است ولی پول نیست ⇒ بی‌جداکننده). */
export const CREDIT_LIST_COUNT_COLUMNS: readonly number[] = [6, 7, 18, 20, 21, 22]

/** قالب ستون شماره‌ی `col` از فهرست اعتبار. ستون ناشناس ⇒ `text` (امن‌ترین). */
export function creditListCellFormat(col: unknown): CreditCellFormat {
  const i = Math.round(Number(col))
  if (!Number.isFinite(i)) return 'text'
  if (CREDIT_LIST_MONEY_COLUMNS.includes(i)) return 'money'
  if (CREDIT_LIST_COUNT_COLUMNS.includes(i)) return 'count'
  return 'text'
}

/**
 * یک ردیف فهرست برای *نمایش روی صفحه* — عیناً ردیفِ فایل اکسل، فقط بریده به
 * ستون‌های دیده‌شده. هیچ‌جای JSX دیگر `r.amount`/`r.usedCount` را دستی نمی‌چیند.
 */
export function creditListScreenRow(r: any): (string | number | null)[] {
  return creditListRow(r).slice(0, CREDIT_LIST_SCREEN_COLUMNS)
}

/** ردیف جمعِ *روی صفحه* — همان `creditListTotals`، بریده به ستون‌های دیده‌شده. */
export function creditListScreenTotals(rows: (string | number | null)[][]): (string | number | null)[] {
  return creditListTotals(rows).slice(0, CREDIT_LIST_SCREEN_COLUMNS)
}

/**
 * برچسب خانه‌ی اولِ ردیف جمع روی صفحه. رقم‌ها لاتین برمی‌گردند و صفحه با
 * `faDigits` فارسی‌شان می‌کند (این فایل عمداً به `jalali.ts` وابسته نیست).
 */
export function creditListTotalsLabel(count: unknown): string {
  return `جمع ${Math.max(0, Math.round(Number(count) || 0))} اعتبار`
}

/** ستون *شمارشی* جدول‌های تفکیک داشبورد؛ بقیه‌ی ستون‌های عددی مبلغ‌اند. */
export const CREDIT_BREAKDOWN_COUNT_COLUMNS: readonly number[] = [1]

/** قالب ستون شماره‌ی `col` از جدول تفکیک (`CREDIT_BREAKDOWN_HEADERS`). */
export function creditBreakdownCellFormat(col: unknown): CreditCellFormat {
  const i = Math.round(Number(col))
  if (!Number.isFinite(i) || i === 0) return 'text'
  return CREDIT_BREAKDOWN_COUNT_COLUMNS.includes(i) ? 'count' : 'money'
}

// ---------------------------------------------------------------------------
// ۱۳) جلسه ۳۳ — «هر نمای این ماژول از کدام کانال، با چه بار داده‌ای می‌خواند».
//
// بخش ۱۱ همین کار را برای دکمه‌های خروجیِ تب گزارشات کرد. اما دو مصرف‌کننده‌ی
// دیگر همچنان بار داده را داخل JSX می‌ساختند و سه چیز آنجا پنهان مانده بود:
//
//   ۱) `take` — صفحه‌ی مدیریت اعتبار ۵۰۰ می‌فرستاد و تب گزارشات ۱۰۰۰، بدون هیچ
//      دلیلِ نوشته‌شده‌ای. سرویس خودش `clampInt(take ?? 1000, 1, 5000, 1000)`
//      می‌زند، پس هر دو عدد «مجاز» بودند و هیچ‌کس واگرایی را نمی‌دید.
//   ۲) **`onlyWithRemaining` فقط روی `creditList` اثر دارد** (سرویس آن را بعد از
//      کوئری روی ردیف‌ها اعمال می‌کند) ولی تب گزارشات همان شیء فیلتر را به
//      `creditDashboard` هم می‌داد ⇒ کاربر تیک را می‌زد، جدول کم می‌شد و کارت‌های
//      بالا دست‌نخورده می‌ماندند، بدون هیچ توضیحی. حالا کلید سهواً فرستاده
//      نمی‌شود و متنِ همین محدودیت هم از همین‌جا می‌آید.
//   ۳) بازه‌ی خالی: `creditList` بدون `search`/`batchId` و بدون `fromJalali`
//      پیش‌فرض «امروز» می‌گذارد. کلیدِ خالی هرگز فرستاده نمی‌شود تا این پیش‌فرضِ
//      سرویس خراب نشود (همان قاعده‌ی بخش ۱۱).
// ---------------------------------------------------------------------------

/** نماهای صفحه‌ی «مدیریت اعتبار خرید». `detail` تب ندارد (از فهرست باز می‌شود). */
export type CreditView = 'dashboard' | 'list' | 'detail' | 'reminders' | 'reminderLogs' | 'batches' | 'settings'

/** تب‌های بالای صفحه، به همین ترتیب. تنها منبع نوار تب‌ها. */
export const CREDIT_VIEW_TABS: readonly { view: CreditView; label: string }[] = [
  { view: 'dashboard', label: 'داشبورد' },
  { view: 'list', label: 'فهرست' },
  { view: 'reminders', label: 'یادآوری' },
  { view: 'reminderLogs', label: 'لاگ یادآوری' },
  { view: 'batches', label: 'دسته‌ها' },
  { view: 'settings', label: 'تنظیمات' }
]

/** سقف ردیفِ یک نما/گزارش — یک عدد برای هر دو مصرف‌کننده. */
export const CREDIT_LIST_TAKE = 1000

/** کدام نما از کدام کانال می‌خواند (عیناً کلیدهای `shared/ipc.ts`). */
export const CREDIT_VIEW_CHANNELS: Record<CreditView, string> = {
  dashboard: 'creditDashboard',
  list: 'creditList',
  detail: 'creditList',
  reminders: 'creditReminderCandidates',
  reminderLogs: 'creditReminderLogs',
  batches: 'creditBatchList',
  settings: 'creditSettingsGet'
}

/** کلیدهایی که فقط `creditList` به آن‌ها اثر می‌دهد؛ داشبورد بی‌صدا ردشان می‌کند. */
export const CREDIT_LIST_ONLY_FILTERS: readonly string[] = ['onlyWithRemaining', 'take', 'skip']

/** متنِ همین محدودیت، کنار تیکِ «فقط دارای باقی‌مانده». */
export const CREDIT_LIST_ONLY_HINT = 'این تیک روی فهرست و خروجی اثر دارد، نه روی کارت‌های خلاصه‌ی بالا.'

export interface CreditViewFilterLike {
  fromJalali?: string
  toJalali?: string
  search?: string
  source?: string
  status?: string
  /** فقط نمای «یادآوری»: نامزدهای واجد شرایطِ همین حالا. */
  onlyDue?: boolean
  onlyWithRemaining?: boolean
  take?: number
  /** صفحه‌ی فعلی فهرست مدیریت اعتبار؛ صفر یعنی صفحه‌ی اول. */
  skip?: number
}

export interface CreditViewRequest {
  channel: string
  /** `null` = این کانال هیچ ورودی نمی‌گیرد (`creditSettingsGet`). */
  payload: Record<string, unknown> | null
  /** شکل پاسخ: `rows` یعنی پاکت `{ enabled, rows }` است و باید باز شود. */
  envelope: 'array' | 'rows' | 'object'
}

/** `take` معتبر برای کانال‌های فهرست‌مانند (سرویس هم دوباره کلمپ می‌کند). */
export function creditTake(take?: unknown): number {
  return Math.min(Math.max(intOf(take, CREDIT_LIST_TAKE) || CREDIT_LIST_TAKE, 1), 5000)
}

/** بازه‌ی تاریخ ⇒ فقط کلیدهای ناخالی (بازه‌ی خالی هیچ کلیدی نمی‌سازد). */
function rangeKeys(filter: CreditViewFilterLike): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const from = trimmed(filter.fromJalali)
  const to = trimmed(filter.toJalali)
  if (from) out.fromJalali = from
  if (to) out.toJalali = to
  return out
}

/**
 * درخواستِ یک نمای صفحه‌ی «مدیریت اعتبار خرید».
 * `null` یعنی این نما داده‌ی تازه‌ای نمی‌خواهد (هیچ‌وقت اتفاق نمی‌افتد، ولی نمای
 * ناشناس نباید سهواً یک کانال دیگر را صدا بزند).
 */
export function creditViewRequest(view: CreditView, filter: CreditViewFilterLike = {}): CreditViewRequest | null {
  const channel = CREDIT_VIEW_CHANNELS[view]
  if (!channel) return null
  const take = creditTake(filter.take)
  const source = trimmed(filter.source)
  const status = trimmed(filter.status)
  const search = trimmed(filter.search)
  switch (view) {
    case 'settings':
      return { channel, payload: null, envelope: 'object' }
    case 'dashboard':
      return {
        channel,
        payload: { ...rangeKeys(filter), ...(source ? { source } : {}), ...(status ? { status } : {}) },
        envelope: 'object'
      }
    case 'list':
    case 'detail':
      return {
        channel,
        payload: {
          ...rangeKeys(filter),
          ...(search ? { search } : {}),
          ...(source ? { source } : {}),
          ...(status ? { status } : {}),
          ...(filter.onlyWithRemaining ? { onlyWithRemaining: true } : {}),
          ...(filter.skip ? { skip: Math.max(0, Math.round(filter.skip)) } : {}),
          take
        },
        envelope: 'array'
      }
    case 'reminders':
      return {
        channel,
        payload: { onlyDue: filter.onlyDue === true, ...(source ? { source } : {}), take },
        envelope: 'rows'
      }
    case 'reminderLogs':
    case 'batches':
      return {
        channel,
        payload: {
          ...rangeKeys(filter),
          ...(filter.skip ? { skip: Math.max(0, Math.round(filter.skip)) } : {}),
          take
        },
        envelope: 'array'
      }
    default:
      return null
  }
}

/**
 * جفتِ درخواست‌های بار اولِ تب گزارشات: داشبورد + فهرست، از یک فیلتر.
 * کلیدهای `CREDIT_LIST_ONLY_FILTERS` عمداً از بار داده‌ی داشبورد حذف می‌شوند.
 */
export function creditReportRequests(filter: CreditViewFilterLike = {}): {
  dashboard: CreditViewRequest
  list: CreditViewRequest
} {
  return {
    dashboard: creditViewRequest('dashboard', filter) as CreditViewRequest,
    list: creditViewRequest('list', filter) as CreditViewRequest
  }
}

// ---------------------------------------------------------------------------
// ۱۴) جلسه ۳۴ — «چاپ و انتخاب روی صفحه»: آخرین تصمیم‌هایی که در JSX مانده بودند
//
// بخش ۱۲ و ۱۳ ردیف و کانالِ هر نما را بیرون کشیدند. چیزی که ماند، چهار چیز بود
// و هر چهار، کلاسِ باگِ «کد هرگز اجرانشده» را داشتند:
//
//   ۱) **چاپِ یک سلول** دو کپیِ هم‌نام‌ولی‌جدا داشت (`cellText` در
//      `CreditManagement.tsx` و `creditCell` در `SalesReports.tsx`). امروز
//      بایت‌به‌بایت یکی‌اند؛ فردا یکی‌شان `null` را `—` می‌کند و دیگری `۰`.
//   ۲) **انتخابِ ردیف‌ها** (`allSelected`/`toggleAll`) و — مهم‌تر — فهرست
//      فیلترهایی که انتخاب را پاک می‌کنند. اگر فیلتر تازه‌ای به بار داده‌ی
//      `creditViewRequest` اضافه شود و به این فهرست اضافه نشود، کاربر با فیلترِ
//      عوض‌شده ردیف‌های *قبلی* را چاپ می‌کند. این یعنی کاغذ اشتباه، با شمارنده‌ی
//      واقعی و ردیف AuditLog واقعی.
//   ۳) **بار داده‌ی چاپ/PDF** (`{ ids }` یا `{ batchId }` یا `{ id, copies }`)
//      در پنج نقطه‌ی JSX دستی ساخته می‌شد، از جمله `markPrinted: true` که
//      قاعده‌ی ضدتقلبِ §۲۴ است.
//   ۴) **متنِ نتیجه** (سقف‌خوردگی، تعداد نسخه‌ی مجدد، «لغو شد») سه بار جدا
//      نوشته شده بود؛ بندهای ۱۷ و ۱۸ هارنس ۲۵ فقط *وجودِ* رشته‌اش را می‌دیدند.
//
// قاعده‌ی محل تصمیم‌ها رعایت شده: آستانه‌ی «نسخه‌ی مجدد» و شکلِ لاگ در
// `credit.ts` (بخش ۹.۲ و ۹.۳) می‌مانند و اینجا فقط *مصرف* می‌شوند؛ رقم فارسی
// هم مثل بقیه‌ی این فایل تزریق می‌شود (این فایل به `jalali.ts` وابسته نیست).
// ---------------------------------------------------------------------------

/** قالب‌گرهای نمایشی که صفحه تزریق می‌کند (`money`/`faDigits` واقعی). */
export interface CreditCellFormatters {
  money: (v: number) => string
  fa: (v: string | number) => string
}

/** جای خالی — هر سلولِ خالیِ این ماژول یک شکل دارد. */
export const CREDIT_EMPTY_CELL = '—'

/**
 * *چاپِ* یک سلول: تصمیمِ «پول/شمارش/متن» از `creditListCellFormat` و
 * `creditBreakdownCellFormat` می‌آید و اینجا فقط اعمال می‌شود. تنها نسخه‌ی این
 * تابع در کل پروژه همین است (دو کپیِ JSX حذف شدند).
 */
export function creditCellText(cell: string | number | null | undefined, fmt: CreditCellFormat, f: CreditCellFormatters): string {
  if (cell === '' || cell == null) return CREDIT_EMPTY_CELL
  if (fmt === 'money') return f.money(Number(cell))
  if (fmt === 'count') return f.fa(cell)
  return f.fa(String(cell))
}

/**
 * فیلترهایی که با تغییرشان **انتخابِ ردیف‌ها پاک می‌شود**.
 * عیناً همان کلیدهایی که بار داده‌ی `creditViewRequest('list')` از آن‌ها ساخته
 * می‌شود (سوییت جلسه ۳۴ همین هم‌پوشانی را می‌سنجد)، به‌جز `take` که ردیف‌ها را
 * عوض نمی‌کند بلکه فقط تعدادشان را زیاد می‌کند.
 */
export const CREDIT_SELECTION_RESET_KEYS: readonly string[] = ['fromJalali', 'toJalali', 'search', 'source', 'status', 'onlyWithRemaining']

/**
 * امضای همان فیلترها. صفحه به *این یک رشته* وابسته می‌شود، نه به یک آرایه‌ی
 * دستیِ `[from, to, search, source, status]` در `useEffect`: اگر فیلتر تازه‌ای
 * به `CREDIT_SELECTION_RESET_KEYS` اضافه شود، پاک‌شدن انتخاب خودکار درست می‌ماند.
 */
export function creditSelectionResetSignature(filter: CreditViewFilterLike = {}): string {
  const src = filter as Record<string, unknown>
  return CREDIT_SELECTION_RESET_KEYS.map((k) => `${k}=${trimmed(src[k])}`).join('|')
}

/** همه‌ی ردیف‌های *دیده‌شده* انتخاب شده‌اند؟ (فهرست خالی ⇒ نه) */
export function creditAllSelected(selected: readonly number[], rows: readonly { id: number }[]): boolean {
  if (!rows.length) return false
  const ids = new Set(cleanIds(selected.slice()))
  return rows.every((r) => ids.has(Math.round(Number(r.id))))
}

/** تیکِ سرستون: یا همه‌ی ردیف‌های همین صفحه، یا هیچ. */
export function creditToggleAll(selected: readonly number[], rows: readonly { id: number }[]): number[] {
  return creditAllSelected(selected, rows) ? [] : cleanIds(rows.map((r) => r.id))
}

/** تیکِ یک ردیف. */
export function creditToggleRow(selected: readonly number[], id: unknown): number[] {
  const n = Math.round(Number(id) || 0)
  if (!n) return cleanIds(selected.slice())
  const has = selected.some((x) => Math.round(Number(x)) === n)
  return cleanIds(has ? selected.filter((x) => Math.round(Number(x)) !== n) : [...selected, n])
}

/** عملیات چاپ/PDFِ این ماژول ⇒ کانالِ `shared/ipc.ts`. */
export const CREDIT_PRINT_OP_CHANNELS = {
  print: 'printCredit',
  batch: 'printCreditBatch',
  pdf: 'creditPdf'
} as const
export type CreditPrintOp = keyof typeof CREDIT_PRINT_OP_CHANNELS

/** هدفِ عملیات: یک سند، فهرست انتخاب‌شده‌ها، یا کل یک دسته. */
export interface CreditPrintTarget {
  id?: number | null
  ids?: readonly number[]
  batchId?: number | null
  copies?: number
  perPage?: number
}

export interface CreditPrintOpRequest {
  channel: string
  payload: Record<string, unknown>
}

/**
 * بار داده‌ی هر عملیات چاپ/PDF.
 *
 * `markPrinted: true` عمدی و **قاعده** است (§۱۳ · §۲۴): بدون آن، از یک اعتبار
 * هر تعداد کاغذِ «اصل» بیرون می‌آید و هیچ ردی در AuditLog نمی‌ماند. `ask`/`reveal`
 * هم فقط در مسیر PDF معنا دارند و در JSX دستی نوشته می‌شدند.
 */
export function creditPrintOpRequest(op: CreditPrintOp, target: CreditPrintTarget = {}): CreditPrintOpRequest | null {
  const channel = CREDIT_PRINT_OP_CHANNELS[op]
  if (!channel) return null
  const id = Math.round(Number(target.id) || 0)
  const ids = cleanIds((target.ids ?? []).slice())
  const batchId = Math.round(Number(target.batchId) || 0)
  const scope: Record<string, unknown> = {}
  if (ids.length) scope.ids = ids
  else if (batchId) scope.batchId = batchId
  else if (id) scope.id = id
  if (op === 'print') {
    if (!id) return null
    return { channel, payload: { id, copies: Math.min(Math.max(intOf(target.copies, 1) || 1, 1), 5), silent: false, markPrinted: true } }
  }
  if (!Object.keys(scope).length) return null
  if (op === 'pdf') return { channel, payload: { ...scope, ask: true, reveal: true } }
  return { channel, payload: { ...scope, ...(target.perPage ? { perPage: intOf(target.perPage, 0) } : {}) } }
}

export interface CreditPrintOutcome {
  saved?: boolean
  file?: string | null
  copies?: number
  count?: number
  total?: number
  capped?: boolean
  marked?: number
  reprints?: number
  markFailed?: boolean
  warnings?: string[]
}

/**
 * متنِ نتیجه‌ی هر سه عملیات — یک جا، چون هر سه یک چیز را باید بگویند:
 * چند سند رفت، چند تا نسخه‌ی مجدد بود، و **اگر سقف خورده، چند سند جا ماند**
 * (بند ۱۷ هارنس ۲۵: کاربر باید بفهمد فایلش کامل نیست).
 */
export function creditPrintFlash(op: CreditPrintOp, res: CreditPrintOutcome | null | undefined, fa: (v: string | number) => string = String): string {
  const r = res ?? {}
  const count = Math.max(0, Math.round(Number(r.count) || 0))
  const total = Math.max(0, Math.round(Number(r.total) || 0))
  const reprints = Math.max(0, Math.round(Number(r.reprints) || 0))
  const capNote = r.capped === true ? `\n⚠️ از ${fa(total)} سند فقط ${fa(count)} سند در این فایل آمد (سقف هر فایل). بقیه را با انتخاب دستی در چند نوبت بگیرید.` : ''
  const warningNote = Array.isArray(r.warnings) && r.warnings.length ? `\n⚠️ ${r.warnings.filter(Boolean).join('\n⚠️ ')}` : ''
  if (op === 'print') {
    const copies = Math.max(1, Math.round(Number(r.copies) || 1))
    return `سند اعتبار به چاپگر رفت (${fa(copies)} نسخه). چاپ‌های بعدی برچسب «نسخه‌ی مجدد» می‌گیرند.${warningNote}`
  }
  if (op === 'batch') {
    return (
      `چاپ دسته‌ای به‌صورت یک سند چندصفحه‌ای به چاپگر رفت: ${fa(count)} سند` +
      (reprints ? ` · ${fa(reprints)} مورد نسخه‌ی مجدد` : '') +
      capNote +
      warningNote
    )
  }
  if (r.saved !== true) return 'ذخیره‌ی PDF لغو شد؛ هیچ فایلی ساخته نشد و شمارنده‌ی چاپ هم دست نخورد.'
  return (
    `PDF ساخته شد (${fa(count)} سند): ${r.file ?? ''}` +
    capNote +
    '\nاین نسخه در شمارنده‌ی چاپ ثبت شد؛ نسخه‌ی بعدی برچسب «نسخه‌ی مجدد» می‌گیرد.'
  )
}

export interface CreditBadge {
  key: string
  text: string
  tone: CreditTone
}

/**
 * نشان‌های بالای صفحه‌ی جزئیات: «چاپ‌شده N بار» و — فقط وقتی واقعاً درست است —
 * «چاپ بعدی نسخه‌ی مجدد خواهد بود». آستانه از `isCreditReprint` می‌آید، نه از
 * یک `printed >= 1` دستی در JSX (که تا امروز آنجا بود و هارنس فقط متنش را
 * می‌دید).
 */
export function creditDetailPrintBadges(printCount: unknown, fa: (v: string | number) => string = String): CreditBadge[] {
  const printed = Math.max(0, Math.round(Number(printCount) || 0))
  const out: CreditBadge[] = [{ key: 'printed', text: `چاپ‌شده: ${fa(printed)} بار`, tone: 'plain' }]
  if (isCreditReprint(printed)) out.push({ key: 'reprint', text: `چاپ بعدی «${CREDIT_REPRINT_LABEL}» خواهد بود`, tone: 'warn' })
  return out
}

/**
 * دکمه‌ی خروجیِ بازه‌ای که داده‌اش *همین حالا روی صفحه* خالی است، غیرفعال
 * می‌شود. تصمیمش از `creditRangeExportOrigin` (بخش ۱۱) می‌آید: خروجی‌های `fetch`
 * داده‌شان را با کلیک می‌گیرند، پس هیچ‌وقت به این دلیل غیرفعال نمی‌شوند.
 */
export function creditRangeExportDisabled(
  kind: CreditExportKind,
  state: { rows?: readonly unknown[] | null; dashboard?: unknown }
): boolean {
  const origin = creditRangeExportOrigin(kind)
  if (origin === 'rows') return !(state.rows ?? []).length
  if (origin === 'dashboard') return state.dashboard == null
  if (origin === 'none') return true
  return false
}

// ---------------------------------------------------------------------------
// ممیزی A101-01 (AUDIT-D32) — صفحه‌بندی فهرست اعتبار (مدیریت اعتبار + تب گزارشات)
// ---------------------------------------------------------------------------
//   ۱) `skip` به *امضای فیلتر* گره می‌خورد: با عوض شدن بازه/جست‌وجو/نوع/وضعیت/تیک، صفحه
//      خودکار به اول برمی‌گردد. قبلاً بازه (prop) skip را صفر نمی‌کرد ⇒ صفحه‌ی ۳ (skip=۲۰۰۰)
//      روی بازه‌ی ۳۰۰تایی جدول خالی و «نمایش ۲٬۰۰۱ تا ۳۰۰ از ۳۰۰» ⇒ مدیر فکر می‌کرد اعتباری نیست.
//   ۲) صفحه‌ی «مدیریت اعتبار خرید» اصلاً page را نمی‌خواند ⇒ برش بی‌صدای ۱٬۰۰۰ ردیف (بند ۴-۴۶).

export interface CreditSkipState {
  signature: string
  skip: number
}

/** skip مؤثر: اگر فیلتر از زمان انتخاب صفحه عوض شده، صفحه‌ی اول. */
export function creditEffectiveSkip(state: CreditSkipState | null | undefined, signature: string): number {
  if (!state || state.signature !== signature) return 0
  const n = Math.round(Number(state.skip))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export interface CreditListPager {
  /** نوار صفحه‌بندی دیده شود؟ (فقط وقتی بیش از یک صفحه هست یا skip>0) */
  visible: boolean
  from: number
  to: number
  total: number
  prevSkip: number | null
  nextSkip: number | null
  /** هشدار صریح برش؛ null یعنی همه‌ی ردیف‌ها روی صفحه‌اند */
  warning: string | null
}

/** نوار صفحه‌بندی از page سرویس (list) و تعداد ردیف دیده‌شده. */
export function creditListPager(
  page: { skip?: number; take?: number; totalCount?: number; truncated?: boolean } | null | undefined,
  shown: number,
  fa: (v: number | string) => string = (v) => String(v)
): CreditListPager {
  const total = Math.max(0, Math.round(Number(page?.totalCount ?? shown) || 0))
  const skip = Math.max(0, Math.round(Number(page?.skip ?? 0) || 0))
  const take = Math.max(1, Math.round(Number(page?.take ?? (shown || 1)) || 1))
  const n = Math.max(0, Math.round(Number(shown) || 0))
  const hasNext = skip + n < total
  const from = n ? skip + 1 : 0
  const to = skip + n
  const visible = skip > 0 || hasNext
  let warning: string | null = null
  if (visible)
    warning =
      n === 0 && total > 0
        ? `این صفحه خالی است ولی ${fa(total)} ردیف با این فیلتر هست؛ به صفحه‌ی اول برگردید.`
        : `فقط ردیف‌های ${fa(from)} تا ${fa(to)} از ${fa(total)} نمایش داده شده؛ خروجی و انتخاب فقط همین صفحه را می‌گیرند.`
  return {
    visible,
    from,
    to,
    total,
    prevSkip: skip > 0 ? Math.max(0, skip - take) : null,
    nextSkip: hasNext ? skip + take : null,
    warning
  }
}
