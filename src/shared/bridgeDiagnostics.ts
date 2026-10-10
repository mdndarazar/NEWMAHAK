/**
 * ===========================================================================
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۱ — «راهنمای تشخیص پل تطبیق» (خالص).
 *
 * متن چه می‌خوانیم اگر بخواهیم محتاطانه باشیم:
 *   • این فایل حتی «+» هم روی مبلغ‌ها نمی‌زند: نه `reduce` حسابی (فقط
 *     reduce برچسب‌سازی)، نه ضرب «sign» (خواندن مستقیم)، نه ساختِ عدد جدید.
 *   • فقط «برابری»، «ترتیب» و «مقایسه‌ی تاریخ رشتهای»؛ خروجی هر محاسبه
 *     «برچسب نمایشی» با برچسب «غیرقطعی» است و در هیچ عددی اثر ندارد.
 *   • ورودی فریزشده نباید هیچ تغییری بکند؛ amount/sign/target/unexplained در
 *     خروجی دقیقاً همان مرجع ورودی برمی‌گردند (==) تا رندرر «همان» را چاپ کند.
 * نکته‌ی پایداری (فاز ۰): explore/->reportRows-گولdon lock/sha256 guard
 * برش‌های متن اصل معادله و HINTS را نگه می‌کند — این فایل با آن‌ها سوار می‌شود.
 * ===========================================================================
 */

export interface BridgeDiagFlag {
  code: 'sign' | 'largest' | 'equals-unexplained' | 'date' | 'note'
  text: string
  certainty: 'TENTATIVE'
}

export interface BridgeDiagRow extends BridgeLikeRow {
  flags: BridgeDiagFlag[]
}

export interface BridgeLikeRow {
  key: string
  label: string
  amount: number
  sign: number
  hint?: string
  sources?: unknown[]
  sourcesPage?: { totalCount?: number } | null | undefined
}

export interface BridgeLike {
  rows: BridgeLikeRow[]
  target: number
  explainedTotal: number
  unexplained: number
  balanced: boolean
}

export interface BridgeGuide {
  rows: BridgeDiagRow[]
  /** راهنمای کلی (جهت علامت + «هم‌مبلغ» + توضیح)؛ در بالای مودال نمایش داده می‌شود. */
  guide: BridgeDiagFlag[]
}

const fmt = (v: number) => v.toLocaleString('en-US')

const DIR_POS =
  'بخشی از «خالص فروش این بازه» در هیچ یک از ردیفها توضیح نشده (نه پول شده، نه نسیه، نه اعتبار). محتمل‌ترین عامل: یک پرداخت/رویداد بیرون از همین بازه یا یک سندِ همراهِ بازه‌ی قبل.'
const DIR_NEG =
  'ردیفها بیش از «خالص فروش» صاف درنظر گرفته‌اند. محتمل‌ترین عامل: یک «وصول نسیه‌ی دوره‌ی قبل» یا «دریافت پول اضافه» یا یک چکِ پاس‌شده که فروشِ این بازه پشتش نیست.'

const unnestNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Math.round(Number(v ?? 0)))

const isLargeRow = (frozen: readonly BridgeLikeRow[], row: BridgeLikeRow): boolean =>
  frozen.some((other) => other === undefined || other === row || unnestNumber(other.amount) < unnestNumber(row.amount))

/**
 * رتبه‌ی نزولیِ «بزرگ‌ترین ردیفهای غیرصفر» بدون تقسیمبندی: بدون جمع زدن،
 * فقط از روی compare.
 */
const largestRows = <T extends BridgeLikeRow>(frozen: readonly T[], take = 3): T[] => {
  const nonzero = frozen.filter((r) => unnestNumber(r.amount) !== 0)
  const sorted = [...nonzero].sort((a, b) => unnestNumber(b.amount) - unnestNumber(a.amount))
  return sorted.slice(0, take)
}

const matchesUnexplained = (absUnexplained: number, row: BridgeLikeRow): boolean =>
  absUnexplained > 0 && unnestNumber(row.amount) === absUnexplained

export { matchesUnexplained }

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const normalizeDate = (d: string | null | undefined): string | null => {
  if (!d) return null
  let out = ''
  for (const ch of d) {
    const i = FA_DIGITS.indexOf(ch)
    out += i >= 0 ? String(i) : ch
  }
  // صفرکِ یک/دو رقمی یعنی هر بخش دو-رقمی: ۱۴۰۵/۷/۱۵ ⇇ ۱۴۰۵/۰۷/۱۵
  const parts = out.split('/').map((p) => (p.length === 1 ? `0${p}` : p))
  return parts.join('/')
}

/**
 * تاریخ‌دانِ پل: هر رویداد سند باید *داخل خود بازه* بیفتت. هر خروج از این
 * قاعده ⇒ نشان. مقایسه فقط lexicographic رشته‌ی yyyy/MM/dd دو-رقمی است
 * (ارقام فارسی و یک/دو رقمی‌ها اول نرمال می‌شوند).
 */
export function flagSourceDate(source: { dateJalali?: string | null } | null | undefined, period: { fromJalali: string; toJalali: string }): BridgeDiagFlag | null {
  const d = normalizeDate(source?.dateJalali)
  if (!d) return { code: 'date', text: 'تاریخی برای این سند ثبت نشده', certainty: 'TENTATIVE' }
  // ثابتbella R8: صورت «کل بازه» toJalali برابر '?' است ⇒ بالا حد ندارد.
  const hi = period.toJalali === '?' ? '9999/99/99' : period.toJalali
  const lo = period.fromJalali
  if (d < lo || d > hi)
    return { code: 'date', text: 'رویداد این سند خارج از بازه است', certainty: 'TENTATIVE' }
  return null
}

export function annotateBridge(bridge: BridgeLike | null | undefined): BridgeGuide {
  if (!bridge?.rows?.length) return { rows: [], guide: [] }
  const guide: BridgeDiagFlag[] = []
  const rows: BridgeDiagRow[] = bridge.rows.map((r) => ({ ...r, flags: [] }))

  const abs = Math.abs(unnestNumber(bridge.unexplained))
  if (!bridge.balanced && abs > 0) {
    guide.push({
      code: 'sign',
      text: bridge.unexplained > 0 ? DIR_POS : DIR_NEG,
      certainty: 'TENTATIVE'
    })
    const equals = rows.find((r) => matchesUnexplained(abs, r))
    if (equals)
      equals.flags.push({ code: 'equals-unexplained', text: 'مبلغش دقیقاً برابر |باقیماندهٔ بی‌توضیح| است — احتمالاً همان یک سند است', certainty: 'TENTATIVE' })
    for (const big of largestRows(rows, 3))
      big.flags.push({ code: 'largest', text: isLargeRow(rows, big) ? 'بزرگ‌ترین ردیفها هستند — از این‌ها شروع کنید' : 'از بزرگ‌ها هست — از این‌ها شروع کنید', certainty: 'TENTATIVE' })
  }
  return { rows, guide }
}

/** ردیفِ «هم‌مبلغ» را همان‌طور که معادله می‌گوید پیدا می‌کند: دقیقاً |unexplained| ≠ ۰. */
export function findEqualsUnexplained(bridge: BridgeLike | null | undefined): BridgeLikeRow[] {
  if (!bridge?.rows?.length) return []
  const abs = Math.abs(unnestNumber(bridge.unexplained))
  if (!abs || bridge.balanced) return []
  return (bridge.rows as BridgeLikeRow[]).filter((r) => unnestNumber(r.amount) === abs)
}

/** هشدار ضدسرقتِ هشدارِ‌ان‌عصار (warning «هشدارهای گزارش» تغییر نمی‌کند) — فقط نمایش. */
export function diagWarningSignature(bridge: BridgeLike | null | undefined): string | null {
  if (!bridge?.balanced) return bridge ? `unexplained=${fmt(unnestNumber(bridge.unexplained))}` : null
  return null
}
