import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '../db/client'
import { custodyService, type CustodyFence } from './CustodyService'
import { audit, auditOrThrow } from './AuditService'
import { BusinessError } from '../errors'
import { assertManagerPassword, assertPanelPasswordStrict } from './AuthService'
import {
  toJalaliDate,
  jalaliToday,
  jalaliStartOfDay,
  jalaliEndOfDay,
  jalaliAddDays,
  fromJalaliDate,
  faDigits, toClock,
  toLatinDigits,
  isValidJalaliDate
} from '@shared/jalali'
import {
  SETTING_KEYS,
  parseShiftConfig,
  parseOfficialTimeConfig,
  applyOfficialOffset,
  shiftNameOf,
  findShiftSlot,
  findShiftTemplate,
  isWithinTemplate,
  resolveShiftSlot,
  sessionLabelOf,
  shiftWindowLabel,
  type OfficialTimeConfig,
  type ShiftConfig,
  type ShiftTemplate
} from '@shared/receipt'
import { AuditAction } from '@shared/enums'
import type { PagedRows, ShiftInfo, ShiftSessionForm, ShiftStatusInfo, ShiftStaleOpen, ShiftSuggestion } from '@shared/types'
import { shapeSaleRow, sumTotals } from './reportShape'
import { PANEL_KEYS } from '@shared/panels'

/**
 * ممیزی A106-01 (AUDIT-D37) — تاریخ ورودی فهرست نشست‌ها / overrideها.
 * قبلاً «از/تا» خالی مستقیم در مقایسه‌ی رشته‌ای dayJalali می‌نشست ⇒ فهرست خالی به‌جای امروز
 * (سیگنال override مدیر بی‌صدا «هیچ»)، و تاریخ نیمه‌تایپ/نامعتبر هم بی‌صدا خالی. قاعده‌ی ممیزی:
 * خالی ⇒ امروز، نامعتبر ⇒ خطای فارسی (هم‌الگوی fraudReportDate / staffReportDate).
 */
function shiftListDate(raw: string | null | undefined, label: string, fallback: string): string {
  const clean = toLatinDigits(String(raw ?? '')).trim()
  if (!clean) return fallback
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» فهرست نشست‌ها معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.`
    )
  return clean
}

type Client = Prisma.TransactionClient | typeof prisma

function assertPositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new BusinessError(
      `${label} باید عدد صحیح بزرگ‌تر از صفر باشد؛ اعشار، منفی، NaN، بی‌نهایت یا عدد خارج از سقف امن پذیرفته نیست.`
    )
  return value
}

function openSessionFingerprint(input: {
  name?: string | null
  reason?: string | null
  staffId?: number | null
  day?: string
  note?: string | null
  handover?: boolean
  userId?: number | null
  overrideReason?: string | null
}) {
  const stable = JSON.stringify([
    input.name ?? null,
    input.reason ?? null,
    input.staffId ?? null,
    input.day ?? null,
    input.note ?? null,
    !!input.handover,
    input.userId ?? null,
    input.overrideReason ?? null
  ])
  return createHash('sha256').update(stable).digest('hex')
}

/**
 * ===========================================================================
 * مدیریت شیفت — بازطراحی جلسه ۱۹ روی مفهوم «نشست» (Session)
 *
 * ────────────────────────── مشکلی که حل شد ──────────────────────────
 * تا دیروز در حالت «تعیین شیفت بر اساس ساعت»، هر بازه‌ی ساعتی دقیقاً *یک رکورد
 * ثابت* در روز داشت که صرفاً از ساعت دیواری انتخاب و هر بار بازنویسی/بازباز
 * می‌شد و هیچ override دستی هم نداشت. سه اشتباه واقعی می‌ساخت:
 *   ۱) تحویل زودهنگام: شیفت ظهر ۱۳:۴۵ شروع می‌کرد و فروشش زیر «شیفت صبح» می‌رفت.
 *   ۲) وقفه و بازگشت: دو تکه‌ی جدای «شیفت شب» از هم قابل تفکیک نبودند.
 *   ۳) جایگزین موقت: `userId` رکورد بازنویسی می‌شد و سهم کارمند اول گم می‌شد.
 *
 * ────────────────────────── مدل تازه ──────────────────────────
 * هر ردیف جدول `Shift` = یک «نشست». هر بار که صندوق واقعاً دست‌به‌دست شود (بستن
 * و باز کردن صندوق، یا ثبت دستی تعویض کارمند وسط کار) یک نشست *تازه* ساخته
 * می‌شود:
 *   • `name`          نام شیفت نهایی (از جدول تنظیمات «شیفت‌های روز»)
 *   • `sessionSeq`    شماره‌ی نشست *مستقل برای هر نام‌شیفت در هر روز*
 *                     ⇒ نمایش: «شیفت شب — نشست ۲»
 *   • `suggestedName` نامی که سیستم بر اساس ساعت پیشنهاد داده بود
 *   • `overrideReason`دلیل اجباری، وقتی کاربر نام دیگری انتخاب کند
 *   • `userId`        کارمند همان نشست (اجباری، با تأیید صریح کاربر)
 * هیچ نشستی هیچ‌وقت رونویسی یا حذف نمی‌شود؛ تعویض کارمند = نشست تازه.
 *
 * ────────────────────── دو قاعده‌ی سختِ این سرویس ──────────────────────
 * ۱) **نشستِ باز هیچ‌وقت خودکار عوض نمی‌شود.** گذر ساعت از یک بازه به بازه‌ی
 *    بعد، نشست باز را نمی‌بندد و نامش را عوض نمی‌کند (وگرنه override کاربر
 *    همان ۱۵ دقیقه بعد بی‌اثر می‌شد). نشست تازه فقط با بستن صندوق یا ثبت دستی
 *    تعویض ساخته می‌شود. همین قاعده، پرش ناگهانی ساعت سیستم (بند ۸) را هم بی‌خطر
 *    می‌کند: هیچ کرش و قفلی رخ نمی‌دهد و اگر دوباره وارد بازه‌ی شیفت قبلی شویم،
 *    نشست بعدی به‌طور طبیعی شماره‌ی بعدیِ همان نام را می‌گیرد.
 * ۲) شیفت یک «سهولت» است، نه شرط ثبت فاکتور: هیچ خطایی در این سرویس نباید فروش
 *    را زمین بزند. کارمندِ تأییدنشده ⇒ هشدار واضح و غیرقابل‌نادیده‌گرفتن در UI،
 *    نه بسته شدن صندوق فروش.
 *
 * ⚠️ قاعده‌ی تراکنش پروژه: همه‌ی متدها یک `client` اختیاری می‌گیرند. اگر از داخل
 * تراکنشِ ثبت فاکتور صدا زده می‌شوند، حتماً همان `tx` پاس داده می‌شود (خواندن/
 * نوشتن با کلاینت سراسری داخل تراکنشِ باز روی SQLite بن‌بست می‌سازد).
 * ===========================================================================
 */

/** تنظیمات شیفت با همان کلاینت جاری (بدون شکستن تراکنش). */
async function shiftSettings(client: Client): Promise<ShiftConfig> {
  try {
    const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.shiftConfig } })
    return parseShiftConfig(row?.value)
  } catch {
    return parseShiftConfig(null)
  }
}

/** تنظیمات «تاریخ و ساعت رسمی» (بند ۹) با همان کلاینت جاری. */
async function officialTimeConfig(client: Client): Promise<OfficialTimeConfig> {
  try {
    const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.officialTime } })
    return parseOfficialTimeConfig(row?.value)
  } catch {
    return parseOfficialTimeConfig(null)
  }
}

/** نام شیفت‌ها از تنظیمات، با همان کلاینت جاری. */
async function shiftNames(client: Client): Promise<string[]> {
  return (await shiftSettings(client)).names
}

/**
 * روزِ شمسیِ یک نشست، طبق قالب نام انتخاب‌شده.
 * شیفت شبانه (پایان ≤ شروع) به روزی تعلق دارد که *شروع* شده است، پس فروش ساعت ۱
 * بامداد در گزارش همان روز قبل می‌نشیند.
 */
function dayForTemplate(t: ShiftTemplate | null, at: Date): string {
  const today = toJalaliDate(at)
  if (!t) return today
  const slotStart = t.startTime
  const slotEnd = t.endTime
  const toMin = (v: string) => {
    const [h, m] = String(v ?? '00:00').split(':')
    return (Number(h) || 0) * 60 + (Number(m) || 0)
  }
  const overnight = toMin(slotEnd) <= toMin(slotStart)
  const now = at.getHours() * 60 + at.getMinutes()
  if (overnight && now < toMin(slotEnd)) return jalaliAddDays(today, -1)
  return today
}

/** ساختار مینیمال ردیف نشست برای خلاصه‌ی stale (ساختاری؛ اضافه‌فیلدها اشکالی ندارند). */
type ShiftRowLite = { id: number; name: string; sessionSeq: number; dayJalali: string | null; userId: number | null }

/**
 * خلاصه‌ی «نشست جامانده» (تک‌منبع برای sessionForm و status): فقط وقتی ردیفِ
 * باز، dayJalali پر و مخالف امروز باشد — دقیقاً همان قاعده‌ی staleOvernight در
 * openSession؛ ردیف‌های قدیمیِ بدون dayJalali مثل سرور stale حساب نمی‌شوند.
 */
async function staleSummaryOf(client: Client, row: ShiftRowLite | null): Promise<ShiftStaleOpen | null> {
  if (!row || !row.dayJalali || row.dayJalali === jalaliToday()) return null
  let userName: string | null = null
  if (row.userId != null) {
    const su = await client.user.findUnique({
      where: { id: row.userId },
      select: { displayName: true, username: true }
    })
    userName = su?.displayName || su?.username || null
  }
  return {
    id: row.id,
    name: row.name,
    sessionLabel: sessionLabelOf(row.name, row.sessionSeq),
    dayJalali: row.dayJalali,
    userId: row.userId,
    userName
  }
}

/** ساختار مینیمال ردیف نشست برای محاسبه‌ی اضافه‌کاری (فاز ۲ نشست ۳۱۰). */
type ShiftOvertimeRow = ShiftRowLite & { overtimeUntil?: Date | null }

/**
 * پایان مطلقِ بازه‌ی یک نشست در روز dayJalali. شیفت شبانه (پایان ≤ شروع) روزِ
 * بعد تمام می‌شود — دقیقاً همان قاعده‌ای که `dayForTemplate` برای تعلق روزی
 * استفاده می‌کند؛ پس محاسبه‌های «خارج از بازه» و «سقف اضافه‌کاری» یک پایه‌ی
 * زمانی واحد با باز شدن/نسبت‌دادن فاکتور دارند.
 */
function shiftWindowEndDate(template: ShiftTemplate, dayJalali: string): Date {
  const toMin = (v: unknown) => {
    const [h, m] = String(v ?? '00:00').split(':')
    return (Number(h) || 0) * 60 + (Number(m) || 0)
  }
  const startMin = toMin(template.startTime)
  const endMin = toMin(template.endTime)
  const end = new Date(fromJalaliDate(dayJalali).getTime() + endMin * 60_000)
  if (endMin <= startMin) return new Date(end.getTime() + 86_400_000)
  return end
}

/**
 * آیا اعلام اضافه‌کاری برای «نشست بازِ دیروز» این لحظه ممکن است؟ خروجی فقط
 * محاسبه‌ی سخت‌گیرانه‌ی زمانی است (بدون نوشتن): ساعت پایان مجاز و سقف.
 * گیت‌های باقی (دلیل، کارمند تعیین‌شده، یک‌بارگی) خودِ `declareOvertime` می‌سنجد.
 */
function overtimeEligibility(
  row: ShiftOvertimeRow | null,
  cfg: ShiftConfig,
  now: Date
): { until: Date; windowEnd: Date; capMinutes: number } | null {
  if (!row || row.overtimeUntil != null) return null
  if (!row.dayJalali || row.dayJalali !== jalaliAddDays(jalaliToday(), -1)) return null
  const cap = cfg.overtimeMaxMinutes
  if (!cfg.byTime || !(cap > 0)) return null
  const found = findShiftTemplate(cfg, row.name)
  if (!found) return null
  const windowEnd = shiftWindowEndDate(found.template, row.dayJalali)
  if (now <= windowEnd) return null
  const until = new Date(windowEnd.getTime() + cap * 60_000)
  if (now >= until) return null
  return { until, windowEnd, capMinutes: cap }
}

/** برچسب فارسی «HH:mm» یک تاریخ برای نمایش در کارت/پیام اضافه‌کاری. */
function overtimeClockLabel(d: Date): string {
  return faDigits(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
}

export const shiftService = {
  // =========================================================================
  // ۱) خواندن وضعیت
  // =========================================================================

  /** «همین حالا» طبق تنظیمات ساعت رسمی (بند ۹). افست صفر ⇒ ساعت خودِ کامپیوتر. */
  async officialNow(client: Client = prisma, at: Date = new Date()): Promise<Date> {
    return applyOfficialOffset(at, await officialTimeConfig(client))
  },

  /**
   * نشستِ باز (بدون ساختن هیچ چیزی).
   *
   * عمداً بدون فیلتر روز جستجو می‌کند تا شیفت شبانه‌ای که دیشب باز شده و بسته
   * نشده، بعد از نیمه‌شب هم همان نشست خودش بماند. `day` اگر داده شود، فقط همان
   * روز نگاه می‌شود (مسیر سندهای با تاریخ صریح).
   */
  /**
   * 🔴 نشست ۱۸۴ · خوشه E — «هر نشست بازی، بدون توجه به ساعت».
   *
   * `openShift()` پایین‌تر عمداً بازه‌ی ساعتی را لحاظ می‌کند: نشست شبانه‌ای که
   * از بازه‌اش بیرون زده «نشست جاری» نیست. برای *کار روزمره* درست است.
   *
   * ولی برای تصمیمِ «آیا تحویل صندوق لازم است؟» فاجعه بود: نشست دیشبِ
   * بسته‌نشده `null` برمی‌گشت، پس `openSession` فکر می‌کرد هیچ نشستی باز
   * نیست و بدون رمز مدیر، بدون دلیل و بدون شمارش نقد یک نشست تازه می‌ساخت.
   * پول کشوی شب هیچ‌وقت شمرده و تطبیق نمی‌شد و آن نشست تا ابد باز می‌ماند.
   *
   * این تابع فقط همان سؤال خام را می‌پرسد: «الان رکورد بازی هست یا نه؟»
   */
  async anyOpenShift(client: Client = prisma) {
    return client.shift.findFirst({ where: { closedAt: null }, orderBy: { id: 'desc' } })
  },

  async openShift(client: Client = prisma, day?: string) {
    if (day) return client.shift.findFirst({ where: { dayJalali: day, closedAt: null }, orderBy: { id: 'desc' } })

    const today = jalaliToday()
    const open = await client.shift.findFirst({ where: { closedAt: null }, orderBy: { id: 'desc' } })
    if (!open) return null
    if (open.dayJalali === today || !open.dayJalali) return open

    /**
     * نشست شبانه‌ای که *دیشب* باز شده و بسته نشده: فقط در حالت زمان‌بندی ساعتی و
     * فقط تا وقتی ساعت جاری هنوز داخل بازه‌ی خودش است، همان نشست جاری می‌ماند
     * (پس فروش ساعت ۱ بامداد در گزارش همان روز قبل می‌نشیند — رفتار قبلی).
     * وگرنه دقیقاً مثل قبل: نشست تازه‌ی امروز ساخته می‌شود و آن یکی دست‌نخورده
     * باز می‌ماند (هیچ رکوردی رونویسی نمی‌شود).
     */
    try {
      const cfg = await shiftSettings(client)
      if (cfg.byTime && open.dayJalali === jalaliAddDays(today, -1)) {
        const found = findShiftTemplate(cfg, open.name)
        const now = await this.officialNow(client)
        if (found && isWithinTemplate(found.template, now)) return open
        /**
         * نشست ۳۱۰ · فاز ۲ — اضافه‌کاری اعلام‌شده: نشست دیروز تا overtimeUntil
         * «جاری» می‌ماند؛ فروش‌ها به کارمند همان نشست نسبت داده می‌شوند. بعد از
         * آن، همان رفتار قبلی برمی‌گردد (جامانده ⇒ بستن با دلیل + رمز مدیر).
         */
        if (open.overtimeUntil && now <= new Date(open.overtimeUntil)) return open
      }
    } catch (e) {
      console.error('[shift] openShift overnight check failed', e)
    }
    return null
  },

  /** «تعیین شیفت بر اساس ساعت» روشن است؟ (بدون ساختن یا تغییر هیچ رکوردی) */
  async byTimeEnabled(client: Client = prisma): Promise<boolean> {
    const cfg = await shiftSettings(client)
    return cfg.byTime && cfg.templates.length > 0
  },

  /**
   * ---------------------------------------------------------------------
   * بند ۲ — نام شیفتِ *پیشنهادی* سیستم برای همین لحظه.
   *
   * همان منطق `resolveShiftSlot` قبلی، فقط با یک تفاوت مهم: خروجی‌اش دیگر
   * «رکوردی که باید بازنویسی شود» نیست، بلکه صرفاً یک **پیشنهاد** است که در فرم
   * باز کردن نشست به‌صورت پیش‌فرض انتخاب‌شده نشان داده می‌شود و کاربر می‌تواند
   * عوضش کند (با ثبت دلیل اجباری).
   *
   * هر خطایی (تنظیمات خراب، پرش ساعت، …) ⇒ پیشنهادِ خالی، نه استثنا.
   * ---------------------------------------------------------------------
   */
  async suggest(client: Client = prisma, at?: Date): Promise<ShiftSuggestion> {
    try {
      const cfg = await shiftSettings(client)
      const now = await this.officialNow(client, at ?? new Date())
      const templates = (cfg.templates ?? []).map((t, i) => ({
        number: i + 1,
        name: t.name || 'شیفت ' + (i + 1),
        startTime: t.startTime,
        endTime: t.endTime,
        windowLabel: shiftWindowLabel(t)
      }))

      if (!cfg.byTime || !cfg.templates.length) {
        /**
         * بند ۵ — حالت «بدون زمان‌بندی ساعتی»: نام پیشنهادی همان شماره‌گذاری
         * پشت‌سرهم قبلی است (شیفت اول، دوم، …) و هیچ بازه‌ای در کار نیست.
         */
        const day = jalaliToday()
        const last = await client.shift.findFirst({ where: { dayJalali: day }, orderBy: { number: 'desc' } })
        const number = (last?.number ?? 0) + 1
        return {
          byTime: false,
          name: shiftNameOf({ names: cfg.names }, number),
          slotNumber: null,
          outside: false,
          windowLabel: null,
          dayJalali: day,
          clockNow: toClock(now, false),
          templates
        }
      }

      const slot = resolveShiftSlot(cfg, now)
      if (!slot) {
        const day = jalaliToday()
        return {
          byTime: true,
          name: templates[0]?.name ?? 'شیفت ۱',
          slotNumber: templates.length ? 1 : null,
          outside: true,
          windowLabel: templates[0]?.windowLabel ?? null,
          dayJalali: day,
          clockNow: toClock(now, false),
          templates
        }
      }
      return {
        byTime: true,
        name: slot.name,
        slotNumber: slot.number,
        outside: !!slot.outside,
        windowLabel: `${slot.startTime} تا ${slot.endTime}`,
        dayJalali: slot.dayOffset === -1 ? jalaliAddDays(toJalaliDate(now), -1) : toJalaliDate(now),
        clockNow: toClock(now, false),
        templates
      }
    } catch (e) {
      console.error('[shift] suggest failed', e)
      return {
        byTime: false,
        name: 'شیفت ۱',
        slotNumber: null,
        outside: false,
        windowLabel: null,
        dayJalali: jalaliToday(),
        clockNow: toClock(new Date(), false),
        templates: []
      }
    }
  },

  /**
   * ---------------------------------------------------------------------
   * داده‌ی کامل فرم «باز کردن نشست / تعویض کارمند».
   *
   * بند ۳: آخرین کارمندی که برای نشست قبلی انتخاب شده بود، به‌عنوان پیش‌فرضِ
   * *highlight‌شده* برمی‌گردد — ولی هیچ‌وقت خودکار تأیید نمی‌شود؛ کاربر باید
   * صریحاً کلیک کند.
   * ---------------------------------------------------------------------
   */
  async sessionForm(): Promise<ShiftSessionForm> {
    // The old modal only knows a selected name, never a custody PIN/count.
    // Do not even disclose an operational picker once custody governs the
    // drawer; direct IPC callers receive the same fail-closed rule as the UI.
    await custodyService.guardLegacyPath()
    const suggestion = await this.suggest(prisma)
    const open = await this.openShift(prisma)
    const anyOpen = await this.anyOpenShift(prisma)
    /**
     * نشست جامانده‌ی روزِ دیگر: openShift آن را پنهان می‌کند (current=null) ولی
     * openSession بستنش را با دلیل + رمز مدیر می‌خواهد. خلاصه از همان قاعده‌ی
     * سرور (staleOvernight) ساخته می‌شود تا UI قبل از submit بفهمد.
     * نشست ۳۱۲: stale فقط وقتی که openShift همان ردیف را «جاری» نکند —
     * وگرنه در شیفت شبانه‌ی داخل‌بازه یا پنجره‌ی اضافه‌کاری، یک ردیف هم‌زمان
     * هم current و هم staleOpen می‌شد (تناقض فرم).
     */
    const stale = open == null ? await staleSummaryOf(prisma, anyOpen) : null
    /**
     * نشست ۳۱۰ · فاز ۲ — ورود کارت «اعلام اضافه‌کاری» به فرم: فقط روی همان ردیف
     * جامانده و فقط وقتی همه‌ی گیت‌های زمانی برقرار باشند؛ modal صرفاً دلیل
     * می‌گیرد، خودِ اعلام دوباره همه‌ی گیت‌ها را سروری بازبینی می‌کند.
     */
    const ot =
      stale && anyOpen != null
        ? overtimeEligibility(anyOpen, await shiftSettings(prisma), await this.officialNow(prisma))
        : null
    const overtimePreview = ot ? { untilLabel: overtimeClockLabel(ot.until), capMinutes: ot.capMinutes } : null
    const lastWithStaff = await prisma.shift.findFirst({
      where: { userId: { not: null } },
      orderBy: { id: 'desc' },
      select: { userId: true, user: { select: { displayName: true, username: true, isActive: true } } }
    })
    const staff = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true, username: true, role: true },
      orderBy: { id: 'asc' }
    })
    const currentInfo = open ? await this.info(open.id) : null
    return {
      suggestion,
      staff: staff.map((u) => ({ id: u.id, name: u.displayName || u.username, role: u.role })),
      defaultStaffId: lastWithStaff?.user?.isActive ? lastWithStaff.userId ?? null : null,
      current: currentInfo,
      staleOpen: stale,
      blockReason: overtimePreview
        ? 'OVERTIME_ELIGIBLE'
        : stale
          ? 'STALE_OPEN'
          : currentInfo && currentInfo.userId == null
            ? 'STAFF_PENDING'
            : 'NONE',
      overtimePreview,
      /** بند ۴ — راهنمای همیشه‌قابل‌مشاهده‌ی همین فرم (متن از سرور، یک‌جا) */
      guide:
        'هر بار که صندوق دست‌به‌دست می‌شود (حتی موقت)، حتماً همین‌جا یک نشست جدید ثبت کنید؛ ' +
        'در غیر این صورت سیستم نمی‌تواند تشخیص دهد چه کسی واقعاً پشت صندوق بوده است.'
    }
  },

  // =========================================================================
  // ۲) ساختن و بستن نشست
  // =========================================================================

  /** شماره‌ی نشست بعدی زیر همان نام شیفت در همان روز (بند ۱). */
  async nextSessionSeq(client: Client, day: string, name: string): Promise<number> {
    const last = await client.shift.findFirst({
      where: { dayJalali: day, name },
      orderBy: { sessionSeq: 'desc' },
      select: { sessionSeq: true }
    })
    return (last?.sessionSeq ?? 0) + 1
  },

  /** شماره‌ی ترتیبی نشست در همان روز (مستقل از نام). */
  async nextDayNumber(client: Client, day: string): Promise<number> {
    const last = await client.shift.findFirst({
      where: { dayJalali: day },
      orderBy: { number: 'desc' },
      select: { number: true }
    })
    return (last?.number ?? 0) + 1
  },

  /**
   * -------------------------------------------------------------------------
   * ساختن یک نشست تازه — تنها جایی که رکورد شیفت ساخته می‌شود.
   *
   * `mode`:
   *   • 'AUTO'     خودکار (اولین فعالیت روز یا بعد از بستن صندوق). کارمند تأیید
   *                نشده می‌ماند تا UI صریحاً بپرسد (بند ۳).
   *   • 'MANUAL'   کاربر خودش فرم را پر کرده است.
   *   • 'HANDOVER' تعویض کارمند وسط کار (نشست قبلی بسته می‌شود).
   *   • 'EMERGENCY_COVER' پوشش اضطراری با PIN و شمارش کارمند جایگزین.
   *   • 'MASTER_OVERRIDE' انتقال استثنایی مسئولیت به مدیر منتخب با رمز مشترک مدیر و شمارش فیزیکی.
   * -------------------------------------------------------------------------
   */
  async createSession(
    client: Client,
    input: {
      name?: string | null
      reason?: string | null
      staffId?: number | null
      staffConfirmed?: boolean
      day?: string
      note?: string | null
      mode?: 'AUTO' | 'MANUAL' | 'HANDOVER' | 'HANDOVER_FORCED' | 'EMERGENCY_COVER' | 'MASTER_OVERRIDE'
      actorId?: number | null
      at?: Date
      openIdempotencyKey?: string | null
      openIdempotencyFingerprint?: string | null
    }
  ) {
    const cfg = await shiftSettings(client)
    const suggestion = await this.suggest(client, input.at)
    const mode = input.mode ?? 'AUTO'
    const explicit = String(input.name ?? '').trim()
    const now = await this.officialNow(client, input.at ?? new Date())
    const byTime = cfg.byTime && cfg.templates.length > 0

    let day: string
    let number: number
    let finalName: string
    let suggestedName: string
    let suggestedSlot: number | null
    let tpl: { template: ShiftTemplate; number: number } | null

    if (byTime) {
      finalName = explicit || suggestion.name
      tpl = findShiftTemplate(cfg, finalName)
      day = input.day ?? dayForTemplate(tpl?.template ?? null, now)
      number = await this.nextDayNumber(client, day)
      suggestedName = suggestion.name
      suggestedSlot = suggestion.slotNumber ?? null
    } else {
      /**
       * بند ۵ — «بدون زمان‌بندی ساعتی»: شماره‌گذاری خودکار و پشت‌سرهم، دقیقاً
       * همان رفتار قبلی. نام از شماره‌ی همان روز می‌آید (نه از ساعت)، پس سند با
       * تاریخ گذشته هم مثل قبل شماره و نام درست می‌گیرد.
       */
      day = input.day ?? jalaliToday()
      number = await this.nextDayNumber(client, day)
      suggestedName = shiftNameOf({ names: cfg.names }, number)
      finalName = explicit || suggestedName
      suggestedSlot = null
      tpl = null
    }

    /**
     * بند ۲ — override بی‌ردپا ممنوع: اگر نام نهایی با پیشنهادِ *ساعتی* سیستم فرق
     * داشت، دلیل **اجباری** است و روی خود نشست ذخیره می‌شود. در حالت «بدون
     * زمان‌بندی ساعتی» بازه‌ای وجود ندارد که نامی خارج از آن باشد، پس چیزی
     * override حساب نمی‌شود (و هیچ دلیلی هم خواسته نمی‌شود).
     */
    const overridden = byTime && finalName !== suggestedName
    const reason = String(input.reason ?? '').trim()
    if (overridden && !reason)
      throw new BusinessError(
        `نام این نشست («${finalName}») با نام پیشنهادی سیستم بر اساس ساعت («${suggestedName}»` +
          `${suggestion.windowLabel ? ` · بازه ${suggestion.windowLabel}` : ''}) فرق دارد. ` +
          'برای ثبت، نوشتن دلیل اجباری است (مثلاً «تحویل زودهنگام صندوق به شیفت شب»).'
      )

    const sessionSeq = await this.nextSessionSeq(client, day, finalName)
    const staffId = input.staffId == null ? null : assertPositiveSafeInteger(input.staffId, 'شناسه کارمند')

    const created = await client.shift.create({
      data: {
        name: finalName,
        number,
        dayJalali: day,
        sessionSeq,
        suggestedName,
        suggestedSlot,
        slotNumber: tpl?.number ?? null,
        nameOverridden: overridden,
        overrideReason: overridden ? reason : null,
        staffConfirmed: !!input.staffConfirmed && staffId != null,
        openedVia: mode,
        openIdempotencyKey: input.openIdempotencyKey ?? null,
        openIdempotencyFingerprint: input.openIdempotencyFingerprint ?? null,
        userId: staffId,
        note: input.note ?? null
      }
    })

    /**
     * ممیزی A75-01 — نشست دستی/تعویضی بدون سابقه باز نمی‌شود (fail-closed داخل
     * همان تراکنش openSession). نشست خودکار (AUTO) عمداً fail-open می‌ماند تا
     * خرابی لاگ، فروش را متوقف نکند؛ خودِ ردیف Shift سند آن است.
     */
    await (mode === 'AUTO' ? audit : auditOrThrow)(client, {
      action: AuditAction.SHIFT_OPEN,
      entity: 'Shift',
      entityId: created.id,
      userId: input.actorId ?? staffId ?? null,
      after: JSON.stringify({
        session: sessionLabelOf(created.name, created.sessionSeq),
        dayJalali: created.dayJalali,
        number: created.number,
        suggestedName: created.suggestedName,
        nameOverridden: created.nameOverridden,
        overrideReason: created.overrideReason,
        userId: created.userId,
        openedVia: created.openedVia
      }),
      note:
        `نشست تازه باز شد: ${sessionLabelOf(created.name, created.sessionSeq)}` +
        (byTime ? ` · پیشنهاد سیستم بر اساس ساعت ${faDigits(suggestion.clockNow)}: «${suggestedName}»` : '') +
        (overridden ? ` · نام دستی override شد · دلیل: ${reason}` : '') +
        (mode === 'HANDOVER'
          ? ' · تعویض کارمند وسط کار'
          : mode === 'HANDOVER_FORCED'
            ? ' · تعویض اجباری با تأیید مدیر'
            : mode === 'EMERGENCY_COVER'
              ? ' · پوشش اضطراری با PIN و شمارش کارمند جایگزین'
              : mode === 'MASTER_OVERRIDE'
                ? ' · Master Override با مدیر منتخب، رمز مشترک مدیر و شمارش فیزیکی'
                : mode === 'AUTO'
              ? ' · خودکار با اولین فعالیت'
              : '')
    })
    return created
  },

  /**
   * نشست جاری؛ اگر هیچ نشستی باز نباشد، یک نشست خودکار ساخته می‌شود.
   *
   * ⚠️ نشست باز هیچ‌وقت خودکار عوض یا بازنویسی نمی‌شود (قاعده‌ی ۱ بالای فایل)،
   * پس گذر ساعت و حتی پرش ناگهانی ساعت سیستم هم نه کرش می‌کند و نه چیزی را
   * خراب می‌کند.
   */
  async ensureCurrent(client: Client = prisma, opts: { userId?: number | null; day?: string } = {}) {
    const open = await this.openShift(client, opts.day)
    if (open) return open
    /**
     * نشست ۱۸۸ · بازبینی ۱۸۶ مورد ۱۲ — `openShift` نشست دیشبِ خارج از بازه‌ی
     * ساعتی را `null` می‌دهد. قبلاً اینجا بی‌چک `anyOpenShift` یک AUTO تازه
     * می‌ساخت ⇒ دو نشست باز هم‌زمان، پول دیشب شمرده نمی‌شد.
     */
    const leftover = await this.anyOpenShift(client)
    if (leftover)
      throw new BusinessError(
        `نشست «${sessionLabelOf(leftover.name, leftover.sessionSeq)}» از ${faDigits(leftover.dayJalali)} هنوز باز است و بسته نشده. ` +
          'قبل از شروع کار امروز باید آن نشست را ببندید (شمارش صندوق) تا دو نشست هم‌زمان باز نماند.'
      )
    return this.createSession(client, { mode: 'AUTO', day: opts.day, actorId: opts.userId ?? null })
  },

  /**
   * سازگاری با صدازننده‌های قبلی (`CashboxService`): «شیفتِ همین حالا».
   * در مدل نشست، این دقیقاً همان *نشست باز* است و هیچ رکوردی ساخته یا بازباز
   * نمی‌شود؛ چون نامِ نشست باز، خودش تأییدشده و منبعِ حقیقت است.
   */
  async shiftForNow(client: Client = prisma, opts: { userId?: number | null; at?: Date; custodyFence?: CustodyFence | null } = {}) {
    try {
      if (opts.custodyFence) return custodyService.assertFenceInTx(client, opts.custodyFence)
      if (await custodyService.isGoverned()) {
        const state = await custodyService.status()
        if (state.state !== 'ACTIVE' || !state.activeShiftId) return null
        return client.shift.findUnique({ where: { id: state.activeShiftId } })
      }
      return await this.openShift(client)
    } catch (e) {
      if (opts.custodyFence) throw e
      console.error('[shift] shiftForNow failed', e)
      return null
    }
  },

  /** فقط شناسه‌ی نشست جاری (برای گره زدن فاکتور در لحظه‌ی ثبت). */
  async currentId(client: Client = prisma, userId?: number | null, custodyFence?: CustodyFence | null): Promise<number | null> {
    try {
      if (custodyFence) return (await custodyService.assertFenceInTx(client, custodyFence)).id
      // Financial writers may call this compatibility helper. Once custody is
      // governing, creating a legacy AUTO Shift here would bypass PIN custody.
      if (await custodyService.isGoverned()) {
        const state = await custodyService.status()
        return state.state === 'ACTIVE' && state.activeShiftId ? state.activeShiftId : null
      }
      const s = await this.ensureCurrent(client, { userId })
      return s?.id ?? null
    } catch (e) {
      // custody must fail closed: turning a stale request into a null shift would
      // recreate the exact actor/shift race this feature prevents.
      if (custodyFence) throw e
      // شیفت یک «سهولت» است، نه شرط ثبت فاکتور: اگر ساختنش نشد، فروش نباید بخوابد.
      console.error('[shift] ensureCurrent failed', e)
      return null
    }
  },

  /**
   * وضعیت زنده‌ی نشست برای UI (کانال shift:status) — خواندنیِ خالص: برخلاف
   * current() نه خطای «نشست جامانده» پرتاب می‌کند و نه نشست AUTO می‌سازد؛ تا
   * چیپ و صفحه‌ها در همان حالت به‌جای سکوت، هشدار/راهنمای روشن نشان دهند.
   */
  async status(): Promise<ShiftStatusInfo> {
    const open = await this.openShift(prisma)
    if (open) {
      return { state: open.userId == null ? 'STAFF_PENDING' : 'OK', shift: await this.info(open.id) }
    }
    const anyOpen = await this.anyOpenShift(prisma)
    const stale = await staleSummaryOf(prisma, anyOpen)
    if (stale) {
      /**
       * نشست ۳۱۰ · فاز ۲ — اگر اضافه‌کاری ممکن است، ساعت پایان مجازش هم برمی‌آید
       * تا پیام SESSION_REQUIRED و چیپ گزینه‌ی «اعلام اضافه‌کاری» را نشان دهند.
       */
      const ot = overtimeEligibility(anyOpen, await shiftSettings(prisma), await this.officialNow(prisma))
      return { state: 'STALE', stale, overtimeUntilLabel: ot ? overtimeClockLabel(ot.until) : null }
    }
    return { state: 'NONE' }
  },

  /**
   * بند ۳ — «چه کسی این سند را ثبت کرد؟» فقط و فقط از نشست جاری خوانده می‌شود
   * (جایگزین «کارمند فعالِ پشت سیستم» جلسه ۱۸). خالی بودنش ⇒ رفتار قبلی
   * (`userId = null` و ردیف «نامشخص» در گزارش‌ها).
   */
  async currentStaffId(): Promise<number | null> {
    try {
      const open = await this.openShift(prisma)
      return open?.userId ?? null
    } catch {
      return null
    }
  },

  /**
   * -------------------------------------------------------------------------
   * باز کردن نشست از روی فرم (بستن/باز کردن صندوق یا تعویض کارمند وسط کار).
   *
   * • کارمند **اجباری** است (بند ۳) و باید صریح تأیید شده باشد.
   * • نام، پیش‌فرض همان پیشنهاد سیستم است؛ هر نام دیگری دلیل اجباری می‌خواهد.
   * • اگر نشست بازی وجود داشته باشد، اول بسته می‌شود (با کارمند خودش) و بعد
   *   نشست تازه ساخته می‌شود ⇒ هیچ‌کدام رونویسی/حذف نمی‌شوند.
   * -------------------------------------------------------------------------
   */
  async openSession(input: {
    name?: string | null
    reason?: string | null
    staffId?: number | null
    day?: string
    note?: string | null
    handover?: boolean
    userId?: number | null
    managerPassword?: string | null
    overrideReason?: string | null
    idempotencyKey?: string | null
  } = {}): Promise<ShiftInfo | null> {
    await custodyService.guardLegacyPath()
    const staffId = assertPositiveSafeInteger(input.staffId, 'شناسه کارمند')
    const idempotencyKey = String(input.idempotencyKey ?? '').trim() || null
    if (idempotencyKey && idempotencyKey.length > 200)
      throw new BusinessError('کلید تکرارنشدن درخواست بیش از ۲۰۰ نویسه است؛ درخواست را دوباره با کلید کوتاه بفرستید.')
    const idempotencyFingerprint = idempotencyKey
      ? openSessionFingerprint(input)
      : null
    if (idempotencyKey) {
      const prior = await prisma.shift.findUnique({
        where: { openIdempotencyKey: idempotencyKey },
        select: { id: true, openIdempotencyFingerprint: true }
      })
      if (prior) {
        if (prior.openIdempotencyFingerprint !== idempotencyFingerprint)
          throw new BusinessError('این کلید قبلاً برای یک درخواست متفاوت استفاده شده است؛ کلید تازه بسازید.')
        return this.info(prior.id)
      }
    }
    const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { id: true, isActive: true, displayName: true } })
    if (!staff) throw new BusinessError('این کارمند پیدا نشد.')
    if (!staff.isActive) throw new BusinessError('این کارمند غیرفعال است؛ یک کارمند فعال را انتخاب کنید.')

    /**
     * نشست ۷۸ · خوشه A:
     * بستن نشستِ کارمند دیگر یک «تعویض عادی» نیست. قبلاً هر caller می‌توانست
     * با یک staffId تازه، نشست بازِ کارمند قبلی را بی‌رمز ببندد و Audit هم آن را
     * مثل handover معمولی ثبت می‌کرد. گیت قبل از تراکنش است چون assertManagerPassword
     * برای شمارنده‌ی تلاش ناموفق روی کلاینت اصلی می‌نویسد و داخل transaction روی
     * SQLite می‌تواند بن‌بست بسازد.
     */
    const requestedReason = String(input.overrideReason ?? input.reason ?? '').trim()
    /**
     * نشست ۱۸۴ — عمداً `anyOpenShift` و نه `openShift`.
     * نشست فراموش‌شده‌ی دیشب هم باید کشف شود، وگرنه مسیر تحویل اجباری
     * (رمز مدیر + دلیل) بی‌صدا دور زده می‌شود.
     */
    const initialOpen = await this.anyOpenShift(prisma)
    const initialForced = !!initialOpen && initialOpen.userId != null && initialOpen.userId !== staffId
    /**
     * و اگر نشستِ باز مالِ *روز دیگری* باشد، حتی برای همان کارمند هم تحویل
     * اجباری است: پول آن روز باید قبل از شروع روز تازه شمرده و بسته شود.
     */
    const staleOvernight =
      !!initialOpen && !!initialOpen.dayJalali && initialOpen.dayJalali !== jalaliToday()
    if (staleOvernight && !initialForced) {
      if (requestedReason.length < 3)
        throw new BusinessError(
          `نشست «${sessionLabelOf(initialOpen!.name, initialOpen!.sessionSeq)}» از ${faDigits(initialOpen!.dayJalali)} هنوز باز است و بسته نشده. ` +
            'برای باز کردن نشست تازه باید دلیل بنویسید تا معلوم باشد پول آن نشست چه شد.'
        )
      /**
       * 🔴 نشست ۱۸۶ · خوشه E — نسخه‌ی «همیشه رمز».
       * `assertPanelPassword` با قفلِ خاموشِ پنل بستن صندوق مقدار `OPEN`
       * برمی‌گرداند؛ یعنی نشست جامانده‌ی دیشب فقط با یک دلیل سه‌حرفی و بدون
       * هیچ رمزی بسته می‌شد و پول آن شیفت بی‌شمارش می‌ماند.
       */
      await assertPanelPasswordStrict(
        PANEL_KEYS.cashClose,
        input.managerPassword,
        `بستن نشست جامانده‌ی ${faDigits(initialOpen!.dayJalali)} و باز کردن نشست تازه`
      )
    }
    if (initialForced) {
      if (requestedReason.length < 3)
        throw new BusinessError(
          'بستن نشستِ کارمند دیگر نیازمند دلیل اجباری است؛ دلیل کوتاه و روشن را وارد کنید.'
        )
      // نشست ۱۸۳ — رمز دوم/سوم پنل «بستن صندوق» هم پذیرفته می‌شود (سرشیفت مورد اعتماد)
      /**
       * 🔴 نشست ۱۸۶ · خوشه E — بستن نشستِ *کارمند دیگر* هیچ‌وقت بی‌رمز نیست.
       * با قفل خاموش، نسخه‌ی معمولی `OPEN` می‌داد و هر کسی می‌توانست نشست
       * همکارش را ببندد و صندوقش را به نام خودش باز کند.
       */
      await assertPanelPasswordStrict(PANEL_KEYS.cashClose, input.managerPassword, 'تعویض اجباری کارمند نشست')
    }

    /**
     * بستن نشست قبلی و ساخت نشست تازه باید یک واحد اتمیک باشد. قبل از این
     * اصلاح، اگر ساخت نشست تازه وسط کار fail می‌شد، نشست قبلی بسته می‌ماند و
     * صندوق بدون نشست باز رها می‌شد؛ یعنی هم عملیات مالی می‌خوابید و هم
     * نقطه‌ی تحویل صندوق از بین می‌رفت.
     */
    let created: Awaited<ReturnType<typeof this.createSession>>
    try {
      created = await prisma.$transaction(async (tx) => {
        // نشست ۱۸۴ — همان دلیل بالا: نشست جامانده نباید از چشم تراکنش پنهان بماند
        const open = await this.anyOpenShift(tx)
        if (open) {
          const forced = open.userId != null && open.userId !== staffId
          if (forced && !initialForced)
            throw new BusinessError(
              'نشستِ کارمند دیگری هم‌زمان باز شد. برای بستن آن باید رمز مدیر و دلیل اجباری ثبت شود؛ دوباره با تأیید مدیر تلاش کنید.'
            )
          if (forced && requestedReason.length < 3)
            throw new BusinessError('بستن نشستِ کارمند دیگر بدون دلیل اجباری مجاز نیست.')
          const closed = await tx.shift.updateMany({
            where: { id: open.id, closedAt: null },
            data: { closedAt: new Date() }
          })
          if (closed.count !== 1)
            throw new BusinessError(`نشست «${sessionLabelOf(open.name, open.sessionSeq)}» هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.`)
          /**
           * ممیزی A75-01 — ادعای S75-1 «بستن + Audit اتمیک» با `audit` fail-open
           * برقرار نبود؛ حالا شکست لاگ کل تعویض را rollback می‌کند.
           * ممیزی A78-01 — actor واقعی (کاربر جلسه/کارمند تازه) ثبت می‌شود، نه صاحب
           * نشست بسته‌شده؛ و دلیل اجباری تعویض که قبلاً هیچ‌جا ذخیره نمی‌شد، در
           * سابقه می‌نشیند.
           */
          await auditOrThrow(tx, {
            action: AuditAction.SHIFT_CLOSE,
            entity: 'Shift',
            entityId: open.id,
            userId: input.userId ?? staffId,
            before: JSON.stringify({ closedAt: null, userId: open.userId }),
            after: JSON.stringify({
              session: sessionLabelOf(open.name, open.sessionSeq),
              previousUserId: open.userId,
              nextStaffId: staffId,
              forced,
              managerApproved: forced,
              reason: forced ? requestedReason : requestedReason || null
            }),
            note:
              `نشست «${sessionLabelOf(open.name, open.sessionSeq)}» با کارمند خودش بسته شد ` +
              `(${forced ? 'تعویض اجباری با تأیید مدیر' : input.handover ? 'تعویض کارمند وسط کار' : 'باز کردن نشست تازه'})` +
              (forced ? ` · دلیل: ${requestedReason}` : '') +
              ' — هیچ چیزی رونویسی نشد.'
          })
        }

        return this.createSession(tx, {
          name: input.name ?? null,
          reason: input.reason ?? null,
          staffId,
          staffConfirmed: true,
          day: input.day,
          note: input.note ?? null,
          mode: initialForced ? 'HANDOVER_FORCED' : input.handover ? 'HANDOVER' : 'MANUAL',
          actorId: input.userId ?? null,
          openIdempotencyKey: idempotencyKey,
          openIdempotencyFingerprint: idempotencyFingerprint
        })
      })
    } catch (error: any) {
      /**
       * دو caller ممکن است هر دو pre-check را قبل از commit caller اول رد
       * کنند. یکتایی دیتابیس خطای دوم را می‌گیرد؛ اگر همان fingerprint است،
       * retry باید نتیجه‌ی commit اول را تحویل بدهد، نه این‌که کاربر مجبور شود
       * نشست سوم بسازد. خطای کلید متفاوت هرگز بلعیده نمی‌شود.
       */
      if (idempotencyKey && error?.code === 'P2002') {
        const persisted = await prisma.shift.findUnique({
          where: { openIdempotencyKey: idempotencyKey },
          select: { id: true, openIdempotencyFingerprint: true }
        })
        if (persisted?.openIdempotencyFingerprint === idempotencyFingerprint)
          return this.info(persisted.id)
        if (persisted)
          throw new BusinessError('این کلید برای درخواست متفاوت ثبت شده است؛ ادامه‌ی عملیات متوقف شد.')
      }
      throw error
    }
    if (idempotencyKey) {
      const persisted = await prisma.shift.findUnique({
        where: { openIdempotencyKey: idempotencyKey },
        select: { id: true, openIdempotencyFingerprint: true }
      })
      if (persisted && persisted.openIdempotencyFingerprint !== idempotencyFingerprint)
        throw new BusinessError('این کلید برای درخواست متفاوت ثبت شده است؛ ادامه‌ی عملیات متوقف شد.')
      if (persisted) return this.info(persisted.id)
    }
    return this.info(created.id)
  },

  /**
   * -------------------------------------------------------------------------
   * نشست ۳۱۰ · مرحله ۲ — اعلام اضافه‌کاری برای نشستِ بازِ دیروز (شیفت شب).
   *
   * گیت‌ها (همه‌ی سروری؛ **بدون رمز مدیر**، چون هر فاکتور به کارمند همان نشست
   * نسبت داده می‌شود و خودِ نشستِ باز بدون تغییر می‌ماند):
   *   ۱) دلیل ≥ ۳ نویسه (در حسابرسی و روی ردیف، دائم)؛
   *   ۲) «تعیین شیفت بر اساس ساعت» روشن؛  ۳) `overtimeMaxMinutes > 0`؛
   *   ۴) نشست باز مالِ فقط «دیروز» باشد (dayJalali = دیروز)؛
   *   ۵) کارمند همان نشست تعیین‌شده باشد (userId پر) — actor حسابرسی همین
   *      ردیفِ سرور است و از payload رندرر خوانده نمی‌شود؛
   *   ۶) قالب زمان‌بندی متناسب با نام نشست پیدا شود؛
   *   ۷) ساعت رسمی خارج از بازه باشد (هنوز داخل بودن = اضافه‌کاری بی‌معنا)؛
   *   ۸) ساعت رسمی قبل از «پایان بازه + سقف»؛
   *   ۹) فقط یک‌بار: `updateMany` اتمیک با شرط `overtimeUntil IS NULL`؛
   *      اعلامِ دوم (هم‌زمان یا تکراری) با خطای فارسی رد می‌شود.
   *   پس از اتمام سقف، رفتار مرحله‌ی ۱ برمی‌گردد: جامانده ⇒ بستن با دلیل + رمز مدیر.
   */
  async declareOvertime(input: { reason?: string | null } = {}): Promise<{ until: string; untilLabel: string }> {
    await custodyService.guardLegacyPath()
    const reason = String(input?.reason ?? '').trim()
    if (reason.length < 3)
      throw new BusinessError(
        'برای اعلام اضافه‌کاری، دلیل کوتاه و روشن بنویسید (حداقل ۳ حرف)؛ این اعلام همراه دلیل در حسابرسی می‌ماند.'
      )
    const cfg = await shiftSettings(prisma)
    if (!cfg.byTime || !cfg.templates.length)
      throw new BusinessError(
        'اضافه‌کاری فقط وقتی معنا دارد که «تعیین شیفت بر اساس ساعت» روشن باشد؛ ابتدا آن را از تنظیمات روشن کنید.'
      )
    const cap = cfg.overtimeMaxMinutes
    if (!(cap > 0))
      throw new BusinessError(
        'اضافه‌کاری غیرفعال است؛ مدیر باید «سقف اضافه‌کاری شیفت» را در تنظیمات مشخص کند (تغییر این مقدار رمز مدیر می‌خواهد).'
      )
    const open = await this.anyOpenShift(prisma)
    if (!open || !open.dayJalali || open.dayJalali !== jalaliAddDays(jalaliToday(), -1))
      throw new BusinessError('اضافه‌کاری فقط برای نشستِ بازِ دیروز (شیفت شبانه) ممکن است؛ چنین نشستی باز نیست.')
    if (open.userId == null)
      throw new BusinessError('کارمند این نشست هنوز تعیین نشده است؛ تا کارمندِ همان نشست مشخص نشود، اضافه‌کاری اعلام نمی‌شود.')
    const found = findShiftTemplate(cfg, open.name)
    if (!found)
      throw new BusinessError(`قالب زمان‌بندی‌ای با نام «${open.name}» در تنظیمات نیست؛ نشست با یک بازه‌ی تعریف‌شده جوری نیست.`)
    const now = await this.officialNow(prisma)
    const windowEnd = shiftWindowEndDate(found.template, open.dayJalali)
    if (now <= windowEnd)
      throw new BusinessError('هنوز داخل بازه‌ی همین شیفت هستید؛ اضافه‌کاری وقتی لازم است که از پایان بازه گذشته باشید.')
    const until = new Date(windowEnd.getTime() + cap * 60_000)
    if (now >= until)
      throw new BusinessError(
        `فرصت اضافه‌کاری (سقف ${faDigits(cap)} دقیقه) تمام شده است؛ نشست را با دلیل و رمز مدیر ببندید تا روز تازه شروع شود.`
      )
    const untilIso = until.toISOString()
    const untilLabel = overtimeClockLabel(until)
    await prisma.$transaction(async (tx) => {
      const set = await tx.shift.updateMany({
        where: { id: open.id, closedAt: null, overtimeUntil: null },
        data: { overtimeDeclaredAt: now, overtimeUntil: until, overtimeReason: reason }
      })
      if (set.count !== 1)
        throw new BusinessError('اضافه‌کاری همین نشست قبلاً اعلام شده یا نشست هم‌زمان تغییر کرده است؛ اعلام فقط یک‌بار ممکن است.')
      await auditOrThrow(tx, {
        action: AuditAction.SHIFT_OVERTIME,
        entity: 'Shift',
        entityId: open.id,
        /** actor = کارمندِ همان نشستِ باز — از ردیفِ سرور (گیت ۵)، نه payload رندرر */
        userId: open.userId,
        before: JSON.stringify({ overtimeUntil: null }),
        after: JSON.stringify({
          session: sessionLabelOf(open.name, open.sessionSeq),
          dayJalali: open.dayJalali,
          overtimeUntil: untilIso,
          capMinutes: cap,
          reason
        }),
        note:
          `اعلام اضافه‌کاری برای نشست «${sessionLabelOf(open.name, open.sessionSeq)}» (${faDigits(open.dayJalali)}) ` +
          `تا ساعت ${untilLabel} · سقف ${faDigits(cap)} دقیقه · دلیل: ${reason}`
      })
    })
    return { until: untilIso, untilLabel }
  },

  /**
   * تأیید/اصلاح کارمند همان نشست باز (وقتی نشست خودکار ساخته شده و سیستم دارد
   * اجباراً می‌پرسد «چه کسی پشت صندوق است؟»).
   *
   * برای *همین نشست* و فقط جاهایی که `userId` خالی است، برچسب کارمند نشانده
   * می‌شود (سند قبلی با کارمند مشخص، هیچ‌وقت بازنویسی نمی‌شود). داده‌ی قدیمیِ
   * نشست‌های *دیگر* هم دست‌نخورده می‌ماند ⇒ همان «نامشخص» قبلی.
   */
  async confirmStaff(input: { shiftId?: number | null; staffId?: number | null; userId?: number | null } = {}): Promise<ShiftInfo | null> {
    await custodyService.guardLegacyPath()
    const staffId = assertPositiveSafeInteger(input.staffId, 'شناسه کارمند')
    const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { id: true, isActive: true, displayName: true } })
    if (!staff) throw new BusinessError('این کارمند پیدا نشد.')
    if (!staff.isActive) throw new BusinessError('این کارمند غیرفعال است؛ یک کارمند فعال را انتخاب کنید.')

    const shiftId = input.shiftId == null ? null : assertPositiveSafeInteger(input.shiftId, 'شناسه نشست')
    const target = shiftId
      ? await prisma.shift.findUnique({ where: { id: shiftId } })
      : await this.openShift(prisma)
    if (!target) throw new BusinessError('نشست بازی برای ثبت کارمند پیدا نشد. اول یک نشست باز کنید.')
    /**
     * ممیزی AUDIT-S140-01 (AUDIT-D70) — confirmStaff فقط برای نشستِ باز «در انتظار تأیید کارمند» است.
     * قبلاً نشست تأییدشده‌ی کارمند دیگر بی‌رمز منتقل می‌شد (دور زدن گیت «تعویض اجباری کارمند نشست»
     * A78) و نشست بسته هم با shiftId صریح به کارمند دیگری نسبت داده می‌شد (مسئول کسری صندوق عوض می‌شد).
     */
    if (target.closedAt)
      throw new BusinessError('این نشست بسته شده است؛ کارمند نشست بسته قابل تغییر نیست.')
    if (target.staffConfirmed && target.userId != null && Number(target.userId) !== staffId)
      throw new BusinessError(
        'کارمند این نشست قبلاً تأیید شده است. برای سپردن صندوق به کارمند دیگر از «تعویض کارمند» (با دلیل و رمز مدیر) استفاده کنید.'
      )

    const before = target.userId
    const lock = await prisma.shift.updateMany({
      where: { id: target.id, closedAt: null, userId: target.userId ?? null, staffConfirmed: !!target.staffConfirmed },
      data: { userId: staffId, staffConfirmed: true }
    })
    if (lock.count !== 1) throw new BusinessError('این نشست هم‌زمان تغییر کرد؛ دوباره تلاش کنید.')
    const updated = (await prisma.shift.findUnique({ where: { id: target.id } }))!

    /**
     * سندهای *همین نشست* که هنوز بدون کارمند ثبت شده‌اند (مثلاً دو فاکتور اول
     * روز، قبل از این‌که کاربر تأیید کند) برچسب همین کارمند را می‌گیرند. فرمول
     * هیچ گزارشی عوض نمی‌شود؛ فقط منبع پر شدن `userId` همان نشست است.
     */
    const invoices = await prisma.saleInvoice.updateMany({
      where: { shiftId: target.id, userId: null },
      data: { userId: staffId }
    })
    const returns = await prisma.saleReturn.updateMany({
      where: { shiftId: target.id, userId: null },
      data: { userId: staffId }
    })

    await audit(prisma, {
      action: AuditAction.SHIFT_OPEN,
      entity: 'Shift',
      entityId: updated.id,
      userId: input.userId ?? staffId,
      before: JSON.stringify({ userId: before }),
      after: JSON.stringify({ userId: staffId, staffConfirmed: true }),
      note:
        `کارمند نشست «${sessionLabelOf(updated.name, updated.sessionSeq)}» تأیید شد: ${staff.displayName}` +
        (invoices.count || returns.count
          ? ` · ${faDigits(invoices.count)} فاکتور و ${faDigits(returns.count)} برگشت/تعویضِ بی‌کارمندِ همین نشست برچسب خوردند`
          : '')
    })
    return this.info(updated.id)
  },

  /**
   * باز کردن دستی شیفت — مسیر قدیمی `shift:open`.
   * حالا دقیقاً همان «باز کردن نشست» است (با کارمند اجباری).
   */
  async open(input: { userId?: number | null; name?: string; note?: string; day?: string; staffId?: number | null; reason?: string | null; handover?: boolean } = {}) {
    return this.openSession({
      name: input.name ?? null,
      reason: input.reason ?? null,
      staffId: input.staffId ?? null,
      day: input.day,
      note: input.note ?? null,
      handover: input.handover,
      userId: input.userId ?? null
    })
  },

  /**
   * مرز مالکیت برای بستن نشست/صندوق.
   *
   * `userId` در مسیر IPC فقط از نشست باز main می‌آید، اما `shiftId` هنوز ورودی
   * رندرر است. بدون این تطبیق، کارمندِ نشست A می‌توانست شناسه‌ی نشست باز B را
   * بفرستد و بستنِ B (یا snapshot صندوق آن) را به نام خود ثبت کند. مسیرهای
   * سیستمی حضانت هم actor همان ردیف Shift را صریح پاس می‌دهند، پس این قاعده یک
   * منبع واحد برای هر دو مسیر است.
   */
  assertClosingActor(
    shift: { id: number; userId: number | null },
    actorId: number | null | undefined,
    operation: string
  ): number {
    if (actorId == null || shift.userId == null || actorId !== shift.userId)
      throw new BusinessError(
        `برای ${operation} فقط کارمندِ ثبت‌شده برای همان نشست مجاز است. ` +
          'نشست انتخاب‌شده متعلق به کاربر جاری نیست؛ از نشست خودتان یا روند رسمی تحویل صندوق استفاده کنید.',
        'SHIFT_OWNERSHIP_REQUIRED'
      )
    return actorId
  },

  /**
   * بستن نشست داخل تراکنشِ فراخوان (بدون commit جدا).
   * نشست ۱۸۹ · ۱-۵ — بستن صندوق همین را داخل تراکنش CashSession صدا می‌زند تا
   * «صندوق بسته / شیفت باز» ساخته نشود. `close()` همین بدنه را در تراکنش خودش می‌پیچد.
   */
  async closeInTx(
    tx: Prisma.TransactionClient,
    input: { shiftId?: number | null; userId?: number | null; note?: string } = {}
  ) {
    const shift = input.shiftId
      ? await tx.shift.findUnique({ where: { id: input.shiftId } })
      : await this.openShift(tx)
    if (!shift) throw new BusinessError('نشست بازی برای بستن پیدا نشد.')
    if (shift.closedAt)
      throw new BusinessError(
        // بخش ۳: لحظه‌ی بستن صندوق همیشه با «ساعت» نشان داده می‌شود، نه فقط تاریخ
        `«${sessionLabelOf(shift.name, shift.sessionSeq)}» قبلاً در ${faDigits(toJalaliDate(shift.closedAt))} ساعت ${faDigits(
          toClock(shift.closedAt)
        )} بسته شده است.`
      )

    const actorId = this.assertClosingActor(shift, input.userId, 'بستن نشست')
    const changed = await tx.shift.updateMany({
      // تطبیق actor دوباره داخل CAS می‌آید تا تغییر هم‌زمان کارمند، حتی بین read
      // و update، نتواند مرز مالکیت را دور بزند.
      where: { id: shift.id, closedAt: null, userId: actorId },
      data: { closedAt: new Date(), note: input.note ?? shift.note ?? null }
    })
    if (changed.count !== 1)
      throw new BusinessError(`نشست «${sessionLabelOf(shift.name, shift.sessionSeq)}» هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.`)

    const closed = await tx.shift.findUnique({ where: { id: shift.id } })
    if (!closed) throw new BusinessError('نشست بسته‌شده پیدا نشد؛ عملیات برگشت داده شد.')
    // ممیزی A75-01 — بستن نشست بدون سابقه ممنوع (fail-closed داخل همین تراکنش)
    await auditOrThrow(tx, {
      action: AuditAction.SHIFT_CLOSE,
      entity: 'Shift',
      entityId: closed.id,
      userId: input.userId ?? closed.userId ?? null,
      after: JSON.stringify({
        session: sessionLabelOf(closed.name, closed.sessionSeq),
        name: closed.name,
        number: closed.number,
        dayJalali: closed.dayJalali
      }),
      note: `پایان نشست ${sessionLabelOf(closed.name, closed.sessionSeq)}`
    })
    return closed
  },

  /**
   * بستن نشست (پایان شیفت). اگر shiftId داده نشود، *نشست باز* بسته می‌شود.
   * بستن شیفت هیچ چیزی از انبار کم نمی‌کند؛ کسر نهایی انبار فقط با «تجمیع و
   * انتقال» انجام می‌شود.
   */
  async close(input: { shiftId?: number | null; userId?: number | null; note?: string } = {}) {
    await custodyService.guardLegacyPath()
    const closed = await prisma.$transaction(async (tx) => this.closeInTx(tx, input))
    return this.info(closed.id)
  },

  // =========================================================================
  // ۳) نمایش و گزارش
  // =========================================================================

  /** جمع‌های یک نشست + اطلاعات نمایشی آن. */
  async info(shiftId: number): Promise<ShiftInfo | null> {
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { user: true } })
    if (!shift) return null

    const cfg = await shiftSettings(prisma)
    const now = await this.officialNow(prisma)
    const coveredFromJalali = toJalaliDate(shift.openedAt)
    const coveredToJalali = toJalaliDate(shift.closedAt ?? now)
    const multiDayWarning =
      coveredFromJalali !== coveredToJalali
        ? `⚠ این نشست بیش از یک روز شمسی را پوشش می‌دهد: از ${faDigits(coveredFromJalali)} تا ${faDigits(
            coveredToJalali
          )}. در بستن صندوق، شمارش نقد هر دو روز را جداگانه بررسی کنید.`
        : null
    /**
     * بازه‌ی ساعتی همین نشست از *نام* آن پیدا می‌شود، نه از شماره‌ی ردیفش؛ چون
     * در مدل نشست، `number` شماره‌ی ترتیبی نشست در روز است و هیچ ربطی به ترتیب
     * جدول تنظیمات ندارد.
     */
    const found = cfg.byTime ? findShiftTemplate(cfg, shift.name) : null
    const template = found?.template
    /**
     * «ساعت جاری داخل بازه‌ی نام همین نشست نیست» — فقط یک برچسب اطلاعاتی.
     * هیچ چیزی را مسدود نمی‌کند و هیچ نشستی را عوض نمی‌کند.
     */
    const outsideWindow = cfg.byTime
      ? template
        ? !isWithinTemplate(template, now)
        : findShiftSlot(cfg, now) == null
      : false

    const invoices = await prisma.saleInvoice.findMany({
      where: { shiftId, voidedAt: null },
      include: {
        customer: true,
        user: true,
        shift: true,
        payments: { include: { method: true } },
        returns: { where: { voidedAt: null }, select: { total: true } }
      }
    })
    /**
     * نشست ۱۸۰ (S180-D11، گام ۰ خوشه M): `.map(shapeSaleRow)` آرگومان دومِ
     * `Array.map` (یعنی index عددی) را به پارامتر `opts?: ShapeSaleRowOptions`
     * پاس می‌داد (TS2345). زمان اجرا بی‌خطر بود (عدد به‌جای آبجکت ⇒ همه‌ی
     * `opts?.x` برابر undefined)، ولی امضا دروغ بود و هر گزینه‌ای که بعداً به
     * ShapeSaleRowOptions اضافه شود، بی‌صدا از index خوانده می‌شد.
     */
    const totals = sumTotals(invoices.map((inv) => shapeSaleRow(inv)))
    return {
      id: shift.id,
      name: shift.name,
      number: shift.number,
      dayJalali: shift.dayJalali || toJalaliDate(shift.openedAt),
      openedAt: shift.openedAt.toISOString(),
      // بخش ۳: ساعت دقیق باز و بسته شدن شیفت، کنار تاریخ شمسی
      openedAtTime: toClock(shift.openedAt),
      closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
      closedAtJalali: shift.closedAt ? toJalaliDate(shift.closedAt) : null,
      closedAtTime: shift.closedAt ? toClock(shift.closedAt) : null,
      closed: !!shift.closedAt,
      userId: shift.userId ?? null,
      userName: shift.user?.displayName ?? null,
      invoiceCount: totals.count,
      grandTotal: totals.grandTotal,
      cashTotal: totals.cashTotal,
      /**
       * ⚠️ کار الف (جلسه ۳۶) — «سایر» دیگر بی‌صدا در «کارت» جمع نمی‌شود.
       * چکِ پاس‌شده در سبد «سایر» می‌نشست و از همین‌جا به «انتظار کارتخوان» اضافه
       * می‌شد، در حالی که همان مبلغ در «انتظار نقد» هم شمرده شده بود ⇒ هر چک
       * پاس‌شده دو بار در انتظارهای صندوق می‌آمد. حالا هر سبد عدد خودش را دارد و
       * پنل تصمیم می‌گیرد کدام‌ها را کنار هم نشان بدهد.
       */
      cardTotal: totals.cardTotal,
      otherTotal: totals.otherTotal,
      /** دریافتیِ حساب مدیر و «نامشخص» — ردیف جدا و توضیح‌دار، بیرون از نقد/کارت */
      managerAccountTotal: totals.managerAccountTotal,
      destinationUnknownTotal: totals.destinationUnknownTotal,
      creditTotal: totals.creditTotal,
      byTime: cfg.byTime,
      windowLabel: template ? shiftWindowLabel(template) : null,
      outsideWindow,
      // ---- جلسه ۱۹ · مدل نشست ----
      sessionSeq: shift.sessionSeq,
      sessionLabel: sessionLabelOf(shift.name, shift.sessionSeq),
      suggestedName: shift.suggestedName ?? null,
      suggestedSlot: shift.suggestedSlot ?? null,
      slotNumber: shift.slotNumber ?? null,
      nameOverridden: !!shift.nameOverridden,
      overrideReason: shift.overrideReason ?? null,
      staffConfirmed: !!shift.staffConfirmed,
      openedVia: shift.openedVia ?? 'AUTO',
      /**
       * بند ۳ — تا وقتی کارمند این نشست صریح تأیید نشده باشد، UI باید هشدار
       * غیرقابل‌نادیده‌گرفتن نشان دهد. (چیزی قفل نمی‌شود؛ فروش نمی‌خوابد.)
       */
      staffPending: !shift.closedAt && !(shift.staffConfirmed && shift.userId != null),
      multiDayWarning
    }
  },

  /** نشست جاری به‌همراه جمع‌ها؛ اگر باز نبود، خودکار باز می‌شود. */
  async current(userId?: number | null): Promise<ShiftInfo | null> {
    // Never let `shift:current` manufacture an AUTO legacy session while a
    // durable custody state/resolution still governs this drawer.
    if (await custodyService.isGoverned()) {
      const state = await custodyService.status()
      return state.activeShiftId ? this.info(state.activeShiftId) : null
    }
    const s = await this.ensureCurrent(prisma, { userId })
    return s ? this.info(s.id) : null
  },

  /** فهرست نشست‌های یک بازه‌ی شمسی (پیش‌فرض: امروز). */
  async list(filter: { fromJalali?: string; toJalali?: string; take?: number } = {}): Promise<PagedRows<ShiftInfo>> {
    const from = shiftListDate(filter.fromJalali, 'از تاریخ', jalaliToday())
    const to = shiftListDate(filter.toJalali, 'تا تاریخ', from)
    const where = {
      OR: [
        { dayJalali: { gte: from, lte: to } },
        // شیفت‌های قدیمی که dayJalali نداشتند: با تاریخ باز شدن فیلتر می‌شوند
        { AND: [{ dayJalali: '' }, { openedAt: { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) } }] }
      ]
    }
    const take = Math.min(5000, Math.max(1, Math.round(filter.take ?? 5000)))
    const [shifts, totalCount] = await Promise.all([
      prisma.shift.findMany({
        where,
        orderBy: [{ dayJalali: 'asc' }, { number: 'asc' }],
        take: take + 1,
        select: { id: true }
      }),
      prisma.shift.count({ where })
    ])
    /**
     * نشست ۱۸۰ (S180-D12): `PagedRows<T>` یک آرایه است که `page`/`warnings`
     * بعداً روی همان شیء ست می‌شوند؛ `[] as PagedRows<...>` مستقیم رد می‌شد
     * (TS2352، همان چیزی که خود کامپایلر پیشنهاد `unknown` می‌داد). الگو حفظ شد.
     */
    const out = [] as unknown as PagedRows<ShiftInfo>
    for (const s of shifts) {
      const info = await this.info(s.id)
      if (info) out.push(info)
    }
    const truncated = totalCount > take
    out.splice(take)
    out.page = { skip: 0, take, totalCount, truncated }
    out.warnings = truncated
      ? [`فهرست نشست‌ها ${faDigits(totalCount)} ردیف دارد؛ فقط ${faDigits(take)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`]
      : []
    return out
  },

  /**
   * -------------------------------------------------------------------------
   * بند ۲ — گزارش مستقل «نشست‌های با نام override‌شده».
   *
   * یک سیگنال کنترل داخلی برای مدیر: هر نشستی که نام نهایی‌اش با پیشنهاد سیستم
   * (بر اساس ساعت) فرق داشته، با نام پیشنهادی، نام نهایی، دلیل، کارمند و زمان.
   * هیچ قضاوتی نمی‌کند و هیچ چیزی را مسدود نمی‌کند.
   * -------------------------------------------------------------------------
   */
  async overrides(filter: { fromJalali?: string; toJalali?: string } = {}) {
    const from = shiftListDate(filter.fromJalali, 'از تاریخ', jalaliToday())
    const to = shiftListDate(filter.toJalali, 'تا تاریخ', from)
    const cfg = await shiftSettings(prisma)

    const where = { nameOverridden: true, dayJalali: { gte: from, lte: to } }
    const take = 5000
    const [rows, totalCount] = await Promise.all([
      prisma.shift.findMany({
        where,
        orderBy: [{ dayJalali: 'asc' }, { openedAt: 'asc' }],
        include: { user: { select: { displayName: true, username: true } } },
        take: take + 1
      }),
      prisma.shift.count({ where })
    ])
    const truncated = totalCount > take

    const windowOf = (name: string | null): string | null => {
      const f = findShiftTemplate(cfg, name)
      return f ? shiftWindowLabel(f.template) : null
    }

    return {
      byTime: cfg.byTime,
      fromJalali: from,
      toJalali: to,
      rows: rows.slice(0, take).map((s) => ({
        id: s.id,
        dayJalali: s.dayJalali,
        sessionSeq: s.sessionSeq,
        sessionLabel: sessionLabelOf(s.name, s.sessionSeq),
        finalName: s.name,
        finalWindow: windowOf(s.name),
        suggestedName: s.suggestedName ?? '—',
        suggestedWindow: windowOf(s.suggestedName ?? null),
        reason: s.overrideReason ?? '',
        staffName: s.user?.displayName || s.user?.username || 'نامشخص',
        staffConfirmed: !!s.staffConfirmed,
        openedAtTime: toClock(s.openedAt, false),
        closedAtTime: s.closedAt ? toClock(s.closedAt, false) : null,
        openedVia: s.openedVia ?? 'AUTO'
      })),
      note:
        'این فهرست هیچ‌کس را متهم نمی‌کند: فقط نشست‌هایی را نشان می‌دهد که نام نهایی‌شان با نام پیشنهادی ' +
        'سیستم (بر اساس ساعت) فرق داشته است، همراه با دلیلی که همان لحظه ثبت شده. ' +
        'توجه: override کردن نام نشست، هشدار «تراکنش‌های خارج از بازه‌ی شیفت» را خاموش نمی‌کند.',
      page: { skip: 0, take, totalCount, truncated },
      warnings: truncated
        ? [`فهرست overrideها ${faDigits(totalCount)} ردیف دارد؛ فقط ${faDigits(take)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`]
        : []
    }
  }
}
