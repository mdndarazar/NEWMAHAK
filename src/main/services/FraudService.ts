import { prisma } from '../db/client'
import { audit } from './AuditService'
import { salesService } from './SalesService'
import { AuditAction, ReturnKind, RefundMethod, StoreCreditStatus, PaymentEntryKind, ChequeStatus, SaleStatus } from '@shared/enums'
import { jalaliStartOfDay, jalaliEndOfDay, jalaliToday, money, faDigits, isValidJalaliDate, toLatinDigits, toJalaliDate } from '@shared/jalali'
import { BusinessError } from '../errors'
import { toNumberRial } from '@shared/money'
import { absRial } from '@shared/money'

/**
 * ===========================================================================
 * جلسه ۱۴ · مرحله ۷ — «بخش هشدار مدیریتی» (ضدتقلب).
 *
 * ================== فلسفه‌ی این فایل ==================
 * این ماژول **هیچ‌کس را متهم نمی‌کند** و هیچ چیزی را مسدود نمی‌کند. کارش فقط
 * این است که الگوهایی را که *به‌تنهایی* بی‌ضررند ولی *با هم* بوی بد می‌دهند روی
 * یک صفحه بیاورد، با لینک به سند مبدأ، تا مدیر خودش قضاوت کند.
 *
 * چرا «هشدار» و نه «مسدودسازی»؟ چون هر یک از این الگوها یک توضیح مشروع هم
 * دارد (مشتری واقعاً پشیمان شده، کارت‌خوان خراب بوده، …). مسدود کردنشان کار
 * فروشگاه را می‌خواباند؛ نشان دادنشان دزدی را گران می‌کند.
 *
 * ⚠️ هر بار که این گزارش خوانده شود در `AuditLog` می‌نشیند (چه کسی، چه بازه‌ای).
 * خودِ ابزارِ نظارت هم باید قابل نظارت باشد.
 * ===========================================================================
 */

export interface FraudFlag {
  key: string
  title: string
  /** HIGH = نیاز به بررسی فوری · MEDIUM = الگوی مشکوک · INFO = فقط اطلاع */
  severity: 'HIGH' | 'MEDIUM' | 'INFO'
  detail: string
  amount: number
  count: number
  /** اسناد مبدأ، برای بازشدن با کلیک */
  sources: {
    kind: string
    id: number
    label: string
    amount: number
    dateJalali: string | null
    /**
     * ممیزی A110-01 — ستون‌های «شماره فیش»/«کاربر» چاپ و Excel (fraudOutputRows) و کلیک ردیف تب (invoiceId)
     * از همین فیلدها خوانده می‌شوند؛ منبع غیرفاکتوری (شیفت/کاربر/چک/Audit) آن‌ها را ندارد.
     */
    receiptNo?: number | null
    userName?: string | null
    invoiceId?: number | null
  }[]
  /** تعداد واقعی اسناد مبدأ، حتی وقتی برای جلوگیری از سنگین‌شدن پاسخ برش خورده‌اند */
  sourcesTotal: number
  /** اگر true باشد، UI/خروجی باید به کاربر بگوید همه‌ی اسناد در این پاسخ نیستند */
  sourcesTruncated: boolean
}

/**
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` عمداً اضافه شد و عمداً از `toNumberRial` می‌گذرد.
 *
 * مسیر قدیمی (`Number(v)`) روی `bigint` هم *کار می‌کرد*، ولی هر مبلغ بالاتر از
 * `Number.MAX_SAFE_INTEGER` را **بی‌صدا** گرد می‌کرد — یعنی همان رفتاری که کل
 * مهاجرت به BigInt برای حذفش انجام شد، از پنجره برمی‌گشت. `toNumberRial` در آن
 * حالت خطا می‌دهد تا عدد غلط روی گزارش ننشیند.
 */
const n = (v: unknown): number =>
  typeof v === 'bigint' ? toNumberRial(v) : Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0
const FRAUD_READ_PAGE = 2000
const FRAUD_IN_CHUNK = 500
const FRAUD_SOURCE_CAP = 200

async function readAll<T>(readPage: (page: { skip: number; take: number }) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  let skip = 0
  while (true) {
    const page = await readPage({ skip, take: FRAUD_READ_PAGE })
    rows.push(...page)
    if (page.length < FRAUD_READ_PAGE) return rows
    skip += page.length
  }
}

function chunksOf<T>(values: T[], size = FRAUD_IN_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}
/**
 * ممیزی A104-01 — خالی/null ⇒ «امروز» (بند ۴-۲۳)؛ نیمه‌تایپ یا نامعتبر (۱۴۰۵/۰۷/۰، ۱۴۰۵/۱۳/۰۱) ⇒ خطای فارسی.
 * قبلاً '' به Invalid Date می‌رسید و گزارش ضدتقلب بی‌هیچ پرچمی (کسری پنهان) برمی‌گشت و ماه ۱۳ سال بعد می‌شد.
 */
export function fraudReportDate(raw: string | null | undefined, label: string, fallback: string): string {
  const clean = toLatinDigits(String(raw ?? '')).trim()
  if (!clean) return fallback
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» گزارش ضدتقلب معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید؛ گزارشی برای بازه‌ی نامعتبر ساخته نشد.`
    )
  return clean
}
/**
 * نشست ۱۷۹ (S179-D3) — کلید مقایسه‌ی شماره چک: ارقام فارسی/عربی ⇒ لاتین، حذف فاصله/خط‌تیره/
 * اسلش/نقطه/نیم‌فاصله، حروف بزرگ. فقط برای تشخیص تکرار؛ متن ذخیره‌شده دست نمی‌خورد.
 */
export function chequeNoKey(raw: unknown): string {
  return toLatinDigits(String(raw ?? ''))
    .replace(/[\s\-_/.\u200c\u200f\u200e]/g, '')
    .toUpperCase()
}
/** نسبت اعتبار به ارزش فاکتور اصلی، بالاتر از این ⇒ مشکوک (سند مرجع: ~۶۰٪) */
const CREDIT_RATIO_LIMIT = 0.6
/** برگشت در این تعداد دقیقه‌ی آخر شیفت ⇒ مشکوک */
const SHIFT_TAIL_MINUTES = 30

export interface ReturnRateStat {
  userId: number
  returnTotal: number
  returnCount: number
  salesTotal: number
}

export interface ReturnRateOutlier extends ReturnRateStat {
  rate: number | null
  baseline: number | null
  threshold: number
}

/**
 * نرخ برگشت را با مبلغ فروش همان بازه می‌سنجد، نه با میانگین خام مبلغ برگشت.
 * برای نمونه‌ی کوچک، هر کارمند با همتایان خودش مقایسه می‌شود؛ اگر همتایی
 * نباشد کف مطلق ۲۵٪ اعمال می‌شود تا یک فروشنده به‌خاطر «میانگین خودش» کور نشود.
 * یک برگشت منفرد عمداً هشدار نمی‌سازد، اما چند برگشت بدون فروش هم‌بازه پنهان
 * نمی‌ماند و باید بررسی شود.
 */
export function detectReturnRateOutliers(stats: ReturnRateStat[] = []): ReturnRateOutlier[] {
  const normalized = stats
    .map((s) => ({
      userId: Number(s.userId),
      returnTotal: Math.max(0, n(s.returnTotal)),
      returnCount: Math.max(0, Math.floor(Number(s.returnCount) || 0)),
      salesTotal: Math.max(0, n(s.salesTotal))
    }))
    /**
     * نشست ۱۷۸ (S178-D3، مشاهده‌ی ردیف ۸۹) — همتای دارای فروش هم‌دامنه ولی بدون برگشت، نرخ ۰ است و باید در میانه
     * بیاید؛ قبلاً حذف می‌شد ⇒ baseline به بالا متمایل و برگشت ۵۵٪ کنار سه همکار ۰٪ و یک همکار ۳۰٪ بی‌هشدار می‌ماند.
     * نامزد هشدار همچنان فقط کاربر دارای برگشت (حداقل دو برگشت) است.
     */
    .filter((s) => Number.isFinite(s.userId) && s.userId > 0 && (s.salesTotal > 0 || (s.returnTotal > 0 && s.returnCount > 0)))

  const median = (values: number[]): number | null => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  return normalized
    .filter((s) => s.returnTotal > 0 && s.returnCount >= 2)
    .map((s) => {
      const rate = s.salesTotal > 0 ? s.returnTotal / s.salesTotal : null
      const peerRates = normalized
        .filter((peer) => peer.userId !== s.userId && peer.salesTotal > 0)
        .map((peer) => peer.returnTotal / peer.salesTotal)
      const baseline = median(peerRates)
      const threshold = Math.max(0.25, baseline == null ? 0 : Math.max(baseline * 2, baseline + 0.1))
      const suspicious = rate == null || rate >= threshold
      return { ...s, rate, baseline, threshold, suspicious }
    })
    .filter((s) => s.suspicious)
    .map(({ suspicious: _suspicious, ...s }) => s)
}

export const fraudService = {
  async review(
    input: {
      fromJalali?: string
      toJalali?: string
      userId?: number | null
      shiftId?: number | null
      /**
       * نشست ۱۷۹ (S179-D2) — actor مرور برای Audit؛ فقط IPC آن را از نشست باز main می‌گذارد.
       * `userId` بالا *فیلتر کارمند* است و قبلاً به‌اشتباه actor Audit ثبت می‌شد.
       */
      actorId?: number | null
      /** خروجی صریح مدیر برای چاپ/Excel؛ سقف ۲۰۰ منبع را برمی‌دارد. */
      allSources?: boolean
    } = {}
  ): Promise<{ flags: FraudFlag[]; period: { fromJalali: string; toJalali: string }; notes: string[] }> {
    const fromJalali = fraudReportDate(input.fromJalali, 'از تاریخ', jalaliToday())
    const toJalali = fraudReportDate(input.toJalali, 'تا تاریخ', fromJalali)
    const from = jalaliStartOfDay(fromJalali)
    const to = jalaliEndOfDay(toJalali)
    const flags: FraudFlag[] = []
    const notes: string[] = []
    const includeAllSources = input.allSources === true

    const push = (f: Omit<FraudFlag, 'sourcesTotal' | 'sourcesTruncated'>) => {
      if (f.count > 0) {
        const sourcesTotal = f.sources.length
        flags.push({
          ...f,
          sources: includeAllSources ? f.sources : f.sources.slice(0, FRAUD_SOURCE_CAP),
          sourcesTotal,
          sourcesTruncated: !includeAllSources && sourcesTotal > FRAUD_SOURCE_CAP
        })
      }
    }

    // ---------------- ۱) کسری صندوق به تفکیک شیفت ----------------
    const sessions = await readAll((page) => prisma.cashSession.findMany({
      where: { closedAt: { gte: from, lte: to }, reportVersion: 'session14' },
      include: { shift: true },
      orderBy: { id: 'desc' },
      ...page
    }))
    const short = sessions.filter((c) => c.countedTotal != null && c.cashDifference < 0)
    push({
      key: 'cashShortage',
      title: 'کسری صندوق به تفکیک شیفت',
      severity: 'HIGH',
      detail:
        short.length
          ? `${faDigits(short.length)} شیفت با کسری نقدی بسته شده است؛ جمع کسری ${money(
              short.reduce((s, c) => s + n(absRial(c.cashDifference)), 0)
            )} ریال.`
          : 'کسری صندوقی ثبت نشده است.',
      // نشست ۱۸۱: `Math.abs` روی BigInt استثنا می‌دهد ⇒ `absRial` (و سپس `n`
      // برای قرارداد `number` این ردیف گزارش).
      amount: short.reduce((s, c) => s + n(absRial(c.cashDifference)), 0),
      count: short.length,
      sources: short.map((c) => ({
        kind: 'CASH_SESSION',
        id: c.id,
        label: `${c.shift?.name ?? 'بازه‌ای'} · انتظاری ${money(c.expectedCash)} / شمرده‌شده ${money(c.countedTotal ?? 0)}`,
        amount: n(absRial(c.cashDifference)),
        dateJalali: c.dayJalali || null
      }))
    })
    if (!sessions.length)
      notes.push(
        'هیچ رکورد بستن صندوقِ نسخه‌ی جدید در این بازه نیست. رکوردهای قدیمی «انتظاری/شمرده‌شده» ندارند و ' +
          'کسری‌شان قابل بازمحاسبه نیست — این بخش فقط از صندوق‌های بسته‌شده با نسخه‌ی جلسه ۱۴ حساب می‌شود.'
      )

    // ---------------- ۲) نرخ برگشت غیرعادی به تفکیک فروشنده ----------------
    const returns = await readAll((page) => prisma.saleReturn.findMany({
      where: {
        voidedAt: null,
        returnedAt: { gte: from, lte: to },
        ...(input.shiftId != null ? { shiftId: input.shiftId } : {}),
        ...(input.userId != null ? { userId: input.userId } : {})
      },
      include: {
        invoice: { select: { receiptNo: true, grandTotal: true, customerId: true, userId: true, issuedAt: true } }
      },
      orderBy: { id: 'desc' },
      ...page
    }))

    const byUser = new Map<number, { total: number; count: number }>()
    for (const r of returns) {
      const uid = r.userId ?? 0
      const cur = byUser.get(uid) ?? { total: 0, count: 0 }
      cur.total += n(r.total)
      cur.count++
      byUser.set(uid, cur)
    }
    const sales = await readAll((page) => prisma.saleInvoice.findMany({
      where: {
        voidedAt: null,
        /**
         * ممیزی A89-01 — مخرج هم‌دامنه‌ی صورت: فیلتر شیفت برگشت‌ها روی فروش هم اعمال می‌شود
         * و فاکتور لغوشده/پیش‌نویس فروش نیست؛ وگرنه نرخ رقیق و هشدار پنهان می‌شد.
         */
        status: { notIn: [SaleStatus.DRAFT, SaleStatus.CANCELED] },
        issuedAt: { gte: from, lte: to },
        ...(input.shiftId != null ? { shiftId: input.shiftId } : {}),
        ...(input.userId != null ? { userId: input.userId } : {})
      },
      select: { userId: true, grandTotal: true },
      // ممیزی A104-01 — صفحه‌خوانی skip/take بدون ترتیب ثابت قطعی نیست (ردیف تکراری/جاافتاده بین صفحه‌ها)
      orderBy: { id: 'asc' },
      ...page
    }))
    const salesByUser = new Map<number, number>()
    for (const sale of sales) {
      const uid = sale.userId ?? 0
      salesByUser.set(uid, (salesByUser.get(uid) ?? 0) + n(sale.grandTotal))
    }
    // S178-D3 — همتایان = همه‌ی کاربران دارای فروش یا برگشت در همان دامنه (بازه/شیفت/کاربر)، نه فقط برگشت‌دارها
    const rateUserIds = [...new Set([...byUser.keys(), ...salesByUser.keys()])].filter((userId) => userId > 0).sort((a, b) => a - b)
    const rateStats: ReturnRateStat[] = rateUserIds.map((userId) => ({
      userId,
      returnTotal: byUser.get(userId)?.total ?? 0,
      returnCount: byUser.get(userId)?.count ?? 0,
      salesTotal: salesByUser.get(userId) ?? 0
    }))
    const outlierStats = detectReturnRateOutliers(rateStats)
    const userIds = [...byUser.keys()].filter((x) => x > 0)
    const users = userIds.length
      ? (
          await Promise.all(
            chunksOf(userIds).map((ids) =>
              prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
            )
          )
        ).flat()
      : []
    const umap = new Map(users.map((u) => [u.id, u.displayName]))
    // ممیزی A110-01 — ارجاع فاکتور/کاربر منابع برگشت (شماره فیش خالی در خروجی ضدتقلب)
    const returnSourceRefs = (r: (typeof returns)[number]) => ({
      receiptNo: r.invoice?.receiptNo ?? null,
      userName: r.userId != null ? umap.get(r.userId) ?? null : null,
      invoiceId: r.invoiceId ?? null
    })
    push({
      key: 'returnRateByUser',
      title: 'نرخ برگشت غیرعادی به تفکیک فروشنده',
      severity: 'MEDIUM',
      detail: outlierStats.length
        ? `${faDigits(outlierStats.length)} کاربر نسبت برگشت غیرعادی دارند؛ مقایسه با فروش همان بازه و حداقل دو برگشت انجام شده است.`
        : 'نسبت برگشت کاربران از آستانه‌ی بررسی عبور نکرده است.',
      amount: outlierStats.reduce((s, v) => s + v.returnTotal, 0),
      count: outlierStats.length,
      sources: outlierStats.map((v) => ({
        kind: 'USER',
        id: v.userId,
        label: `${umap.get(v.userId) ?? 'مدیر'} · ${faDigits(v.returnCount)} برگشت · ${
          v.rate == null ? 'فروش هم‌بازه ندارد' : `نسبت ${faDigits(Math.round(v.rate * 100))}٪`
        }`,
        amount: v.returnTotal,
        dateJalali: null
      }))
    })

    // ---------------- ۳) برگشت بدون مشتری (مشتری عمومی) ----------------
    const anonymous = returns.filter((r) => r.invoice?.customerId == null)
    push({
      key: 'returnWithoutCustomer',
      title: 'برگشت روی فاکتور «مشتری عمومی»',
      severity: 'MEDIUM',
      detail:
        'برگشت بدون مشتریِ ثبت‌شده قابل پیگیری نیست؛ اگر بازپرداخت نقدی هم داشته باشد، ' +
        'هیچ‌کس نمی‌تواند بعداً تایید کند پول به چه کسی داده شد.',
      amount: anonymous.reduce((s, r) => s + n(r.total), 0),
      count: anonymous.length,
      sources: anonymous.map((r) => ({
        kind: 'RETURN',
        id: r.id,
        label: `سند ${r.id} · فاکتور ${r.invoice?.receiptNo ?? '—'}`,
        ...returnSourceRefs(r),
        amount: n(r.total),
        dateJalali: r.returnedAtJalali
      }))
    })

    // ---------------- ۴) برگشت در دقایق پایانی شیفت ----------------
    const shiftIds = [...new Set(returns.map((r) => r.shiftId).filter((x): x is number => !!x))]
    const shifts = shiftIds.length
      ? (
          await Promise.all(
            chunksOf(shiftIds).map((ids) =>
              prisma.shift.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, closedAt: true } })
            )
          )
        ).flat()
      : []
    const closeAt = new Map(shifts.filter((sh) => sh.closedAt).map((sh) => [sh.id, sh.closedAt as Date]))
    const tail = returns.filter((r) => {
      const c = r.shiftId != null ? closeAt.get(r.shiftId) : null
      if (!c) return false
      const gap = (c.getTime() - new Date(r.returnedAt).getTime()) / 60000
      return gap >= 0 && gap <= SHIFT_TAIL_MINUTES
    })
    push({
      key: 'returnAtShiftEnd',
      title: `برگشت در ${faDigits(SHIFT_TAIL_MINUTES)} دقیقه‌ی آخر شیفت`,
      severity: 'HIGH',
      detail:
        'برگشت درست قبل از بستن صندوق، کلاسیک‌ترین راه پوشاندن کسری است: کسری با یک سند برگشت ' +
        '«توضیح داده» می‌شود و کالا هم واقعاً برنمی‌گردد.',
      amount: tail.reduce((s, r) => s + n(r.total), 0),
      count: tail.length,
      sources: tail.map((r) => ({
        kind: 'RETURN',
        id: r.id,
        label: `سند ${r.id} · فاکتور ${r.invoice?.receiptNo ?? '—'}`,
        ...returnSourceRefs(r),
        amount: n(r.total),
        dateJalali: r.returnedAtJalali
      }))
    })

    // ---------------- ۵) ثبت برگشت با تاریخ گذشته ----------------
    const backdated = returns.filter((r) => {
      const issued = r.invoice?.issuedAt ? new Date(r.invoice.issuedAt).getTime() : null
      return issued != null && new Date(r.returnedAt).getTime() < issued
    })
    push({
      key: 'backdatedReturn',
      title: 'برگشت با تاریخی قبل از خودِ فاکتور',
      severity: 'HIGH',
      detail: 'تاریخ برگشت از تاریخ فاکتور جلوتر نیست — یعنی تاریخ دستی دستکاری شده است.',
      amount: backdated.reduce((s, r) => s + n(r.total), 0),
      count: backdated.length,
      sources: backdated.map((r) => ({
        kind: 'RETURN',
        id: r.id,
        label: `سند ${r.id} · فاکتور ${r.invoice?.receiptNo ?? '—'}`,
        ...returnSourceRefs(r),
        amount: n(r.total),
        dateJalali: r.returnedAtJalali
      }))
    })

    // ---------------- ۶) اعتبار بزرگ نسبت به فاکتور مبدأ + مشتری عمومی ----------------
    const credits = await readAll((page) => prisma.storeCredit.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      orderBy: { id: 'desc' },
      ...page
    }))
    const sourceIds = [...new Set(credits.map((c) => c.sourceInvoiceId).filter((x): x is number => !!x))]
    const sourceInvoices = sourceIds.length
      ? (
          await Promise.all(
            chunksOf(sourceIds).map((ids) =>
              prisma.saleInvoice.findMany({
                where: { id: { in: ids } },
                select: { id: true, receiptNo: true, grandTotal: true }
              })
            )
          )
        ).flat()
      : []
    const smap = new Map(sourceInvoices.map((i) => [i.id, i]))
    // ممیزی A110-01 — نام صادرکننده‌ی اعتبار (کاربرانی که در نقشه‌ی برگشت نیستند جدا خوانده می‌شوند)
    const creditUserIds = [...new Set(credits.map((c) => c.userId).filter((x): x is number => !!x && !umap.has(x)))]
    if (creditUserIds.length) {
      const extra = (
        await Promise.all(
          chunksOf(creditUserIds).map((ids) =>
            prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
          )
        )
      ).flat()
      for (const u of extra) umap.set(u.id, u.displayName)
    }
    const creditSourceRefs = (c: (typeof credits)[number]) => ({
      receiptNo: c.sourceInvoiceId != null ? smap.get(c.sourceInvoiceId)?.receiptNo ?? null : null,
      userName: c.userId != null ? umap.get(c.userId) ?? null : null,
      invoiceId: c.sourceInvoiceId ?? null
    })
    const bigRatio = credits.filter((c) => {
      const src = c.sourceInvoiceId != null ? smap.get(c.sourceInvoiceId) : null
      return !!src && n(src.grandTotal) > 0 && n(c.amount) / n(src.grandTotal) > CREDIT_RATIO_LIMIT
    })
    push({
      key: 'creditRatio',
      title: `اعتبار بالای ${faDigits(Math.round(CREDIT_RATIO_LIMIT * 100))}٪ ارزش فاکتور اصلی`,
      severity: 'HIGH',
      detail:
        'اعتباری که تقریباً به اندازه‌ی کل فاکتور اصلی است، معنایش این است که مشتری تقریباً همه‌چیز را ' +
        'برگردانده و یک بارکد قابل‌انتقال گرفته — مسیر کلاسیکِ «فروش کاغذی».',
      amount: bigRatio.reduce((s, c) => s + n(c.amount), 0),
      count: bigRatio.length,
      sources: bigRatio.map((c) => ({
        kind: 'STORE_CREDIT',
        id: c.id,
        // کد اعتبار یک credential قابل‌مصرف است؛ گزارش ضدتقلب فقط شناسه‌ی داخلی
        // غیرقابل‌مصرف را می‌خواهد. reveal کد مسیر manager-only مستقل دارد.
        label: `اعتبار #${c.id} · فاکتور مبدأ ${smap.get(c.sourceInvoiceId ?? 0)?.receiptNo ?? '—'}`,
        ...creditSourceRefs(c),
        amount: n(c.amount),
        dateJalali: c.issuedAtJalali || null
      }))
    })

    const anonCredits = credits.filter((c) => c.customerId == null)
    push({
      key: 'creditForAnonymous',
      title: 'اعتبار خرید برای «مشتری عمومی»',
      severity: 'MEDIUM',
      detail: 'اعتبار بی‌نام یک بارکد آزادِ قابل‌انتقال است و هیچ‌وقت قابل اثبات نیست چه کسی گرفتش.',
      amount: anonCredits.reduce((s, c) => s + n(c.amount), 0),
      count: anonCredits.length,
      sources: anonCredits.map((c) => ({
        kind: 'STORE_CREDIT',
        id: c.id,
        // این هم همان credential است؛ شناسه‌ی ردیف برای پیگیری کافی و غیرقابل‌مصرف است.
        label: `اعتبار #${c.id}`,
        ...creditSourceRefs(c),
        amount: n(c.amount),
        dateJalali: c.issuedAtJalali || null
      }))
    })

    // ---------------- ۷) چک‌های تکراری/مشکوک ----------------
    // نشست ۱۷۹ (S179-D3، مشاهده‌ی ۱۱۱): قبلاً groupBy فقط داخل بازه ⇒ چکی که ماه قبل یک بار و امروز
    // دوباره خرج شده هرگز هشدار نمی‌گرفت؛ «۱۲۳۴۵»/«12 345»/«12345» سه شماره‌ی جدا بودند و ترتیب
    // منابع (برش ۲۰۰) قطعی نبود. حالا همه‌ی چک‌های باطل‌نشده (تعدادشان در این فروشگاه کم است)
    // صفحه‌ای خوانده و با کلید نرمال‌شده گروه می‌شوند؛ هشدار = تکرار در کل زمان + حداقل یک
    // استفاده داخل بازه؛ مبلغ و count فقط از همان بازه (عدد دوره با دوره‌ی دیگر قاطی نمی‌شود).
    const chequeRows = await readAll((page) => prisma.payment.findMany({
      where: { kind: PaymentEntryKind.CHEQUE, voidedAt: null, chequeNo: { not: null } },
      select: { id: true, chequeNo: true, amount: true, paidAt: true },
      orderBy: { id: 'asc' },
      ...page
    }))
    const fromMs = from.getTime()
    const toMs = to.getTime()
    const chequeGroups = new Map<string, { chequeNo: string; total: number; inRange: number; amount: number }>()
    for (const c of chequeRows) {
      const key = chequeNoKey(c.chequeNo)
      if (!key) continue
      const g = chequeGroups.get(key) ?? { chequeNo: key, total: 0, inRange: 0, amount: 0 }
      g.total++
      const at = c.paidAt instanceof Date ? c.paidAt.getTime() : new Date(c.paidAt as unknown as string).getTime()
      if (at >= fromMs && at <= toMs) {
        g.inRange++
        g.amount += n(c.amount)
      }
      chequeGroups.set(key, g)
    }
    const dup = [...chequeGroups.values()]
      .filter((g) => g.total > 1 && g.inRange > 0)
      .sort((a, b) => (a.chequeNo < b.chequeNo ? -1 : a.chequeNo > b.chequeNo ? 1 : 0))
    push({
      key: 'duplicateCheques',
      title: 'چک با شماره‌ی تکراری',
      severity: 'MEDIUM',
      detail: 'یک شماره چک روی چند پرداختی؛ یا اشتباه تایپی است یا یک چک دو بار خرج شده.',
      amount: dup.reduce((s, r) => s + r.amount, 0),
      count: dup.length,
      sources: dup.map((r, i) => ({
        kind: 'CHEQUE',
        id: i,
        label:
          `شماره چک ${r.chequeNo} · ${faDigits(r.total)} بار` +
          (r.inRange < r.total ? ` (${faDigits(r.inRange)} بار در این بازه، بقیه در بازه‌های دیگر)` : ''),
        amount: r.amount,
        dateJalali: null
      }))
    })

    const bounced = await prisma.payment.aggregate({
      where: {
        kind: PaymentEntryKind.CHEQUE,
        voidedAt: null,
        chequeStatus: ChequeStatus.BOUNCED,
        paidAt: { gte: from, lte: to }
      },
      _sum: { amount: true },
      _count: { _all: true }
    })
    push({
      key: 'bouncedCheques',
      title: 'چک برگشتی',
      severity: 'HIGH',
      detail: 'چک برگشتی اثر نقدی صفر دارد ولی فاکتورش ممکن است «تسویه‌شده» مانده باشد.',
      amount: n(bounced._sum.amount),
      count: n(bounced._count?._all),
      sources: []
    })

    // ---------------- ۸) تغییر بعد از قفل دوره ----------------
    const overrides = await readAll((page) => prisma.auditLog.findMany({
      where: {
        // نشست ۱۵۴ (S151-b، S153-D3) — قیمت دستی فروش/ویرایش فاکتور کنار قیمت دستی تعویض
        action: {
          in: [
            AuditAction.CLOSED_PERIOD_OVERRIDE,
            AuditAction.EXCHANGE_PRICE_OVERRIDE,
            AuditAction.SALE_PRICE_OVERRIDE,
            // نشست ۱۵۶ (S151-c2) — عوارض/حق سرویس دستی فاکتور عمده
            AuditAction.SALE_CHARGE_OVERRIDE,
            AuditAction.STORE_CREDIT_OVER_LIMIT
          ]
        },
        // نشست ۸۴ · خوشه I: ستون زمانِ AuditLog در schema «at» است، نه createdAt؛
        // نام غلط باعث خطای validation و کور شدن کل تب ضدتقلب می‌شد.
        at: { gte: from, lte: to }
      },
      orderBy: { id: 'desc' },
      ...page
    }))
    push({
      key: 'closedPeriodOverride',
      title: 'تغییر با تایید مدیر روی دوره‌ی بسته یا قیمت دستی',
      severity: 'INFO',
      detail: 'این‌ها با تایید مدیر انجام شده‌اند و مشکل نیستند؛ فهرستشان برای مرور دوره‌ای اینجاست.',
      amount: 0,
      count: overrides.length,
      sources: overrides.map((a) => ({
        kind: 'AUDIT',
        id: a.id,
        label: `${a.action} · ${a.note ?? ''}`.slice(0, 160),
        amount: 0,
        dateJalali: null
      }))
    })

    // ---------------- ۹) برگشت نقدی روی فاکتور نسیه‌ی پرداخت‌نشده ----------------
    const cashOnUnpaid = returns.filter(
      (r) => r.refundMethod === RefundMethod.CASH && n(r.invoice?.grandTotal) > 0 && n(r.refundAmount) > 0
    )
    const suspiciousCash: typeof cashOnUnpaid = []
    for (const r of cashOnUnpaid) {
      const paid = await prisma.saleInvoice.findUnique({ where: { id: r.invoiceId }, select: { paidTotal: true } })
      if (n(paid?.paidTotal) < n(r.refundAmount)) suspiciousCash.push(r)
    }
    push({
      key: 'cashRefundOnUnpaid',
      title: 'بازپرداخت نقدی بیشتر از پولِ دریافتیِ همان فاکتور',
      severity: 'HIGH',
      detail:
        'از این فاکتور پول نقد بیرون رفته که هرگز وارد نشده بود. مسیر ثبتِ فعلی این را مسدود می‌کند، ' +
        'پس وجودِ چنین ردیفی یعنی داده‌ی قبل از جلسه ۱۴ یا ویرایش دستی دیتابیس.',
      amount: suspiciousCash.reduce((s, r) => s + n(r.refundAmount), 0),
      count: suspiciousCash.length,
      sources: suspiciousCash.map((r) => ({
        kind: 'RETURN',
        id: r.id,
        label: `سند ${r.id} · فاکتور ${r.invoice?.receiptNo ?? '—'}`,
        ...returnSourceRefs(r),
        amount: n(r.refundAmount),
        dateJalali: r.returnedAtJalali
      }))
    })

    // ---------------- ۱۰) ویرایش/ابطال پرداخت بعد از ثبت ----------------
    const paymentMutations = await readAll((page) =>
      prisma.auditLog.findMany({
        where: {
          action: { in: [AuditAction.SALE_PAYMENT_UPDATE, AuditAction.SALE_PAYMENT_DELETE] },
          at: { gte: from, lte: to }
        },
        orderBy: { id: 'desc' },
        ...page
      })
    )
    const parseAudit = (raw: unknown): Record<string, unknown> => {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
      try {
        const v = JSON.parse(String(raw ?? '{}'))
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    push({
      key: 'paymentEditedAfterSale',
      title: 'ویرایش یا ابطال پرداخت بعد از ثبت',
      severity: 'HIGH',
      detail:
        'پرداخت بعد از ثبت فاکتور عوض یا باطل شده است. حتی با رمز مدیر باید مرور شود: مبلغ قبل و بعد و مقصد پول در سابقه است. ' +
        'بدون این پرچم، تبدیل نقد به کارت یا کم‌کردن مبلغ در شیفت باز از ضدتقلب پنهان می‌ماند.',
      amount: paymentMutations.reduce((s, a) => {
        const before = parseAudit(a.before)
        const after = parseAudit(a.after)
        const b = n(before.amount)
        const nxt = a.action === AuditAction.SALE_PAYMENT_DELETE ? 0 : n(after.amount ?? before.amount)
        return s + Math.abs(b - nxt)
      }, 0),
      count: paymentMutations.length,
      sources: paymentMutations.map((a) => {
        const before = parseAudit(a.before)
        return {
          kind: 'AUDIT',
          id: a.id,
          label: `${a.action} · ${a.note ?? ''}`.slice(0, 160),
          amount: n(before.amount),
          dateJalali: a.at ? toJalaliDate(a.at) : null
        }
      })
    })

    notes.push(
      'سود ناخالص (gross profit) عمداً در هیچ‌کدام از این هشدارها نیست، چون `purchasePrice` snapshot قطعی ' +
        'در لحظه‌ی فروش ندارد و هر عدد سودی که بسازیم قابل دفاع نخواهد بود.'
    )

    await audit(prisma, {
      action: AuditAction.FRAUD_REVIEW,
      entity: 'Report',
      entityId: 0,
      userId: input.actorId ?? null,
      after: JSON.stringify({
        fromJalali,
        toJalali,
        flagCount: flags.length,
        filterUserId: input.userId ?? null,
        filterShiftId: input.shiftId ?? null
      }),
      note: `مرور هشدارهای ضدتقلب بازه ${fromJalali} تا ${toJalali} · ${flags.length} هشدار`
    })

    return { flags, period: { fromJalali, toJalali }, notes }
  }
}
