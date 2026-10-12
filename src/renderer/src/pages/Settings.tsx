import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
// نشست ۲۲۲ · فاز ۳ — کارت‌های چاپگر و بخش پیشرفته‌ی تب چاپ
import { PrinterCards, PrintAdvanced } from '../components/PrintSettingsCards'
/** نشست ۲۲۲ · فاز ۰ طرح چاپ — فرابر داده‌ی «آزمایش‌گر چاپ» (حالت‌ها و مقادیر پیشنهادی) */
import { DIAGNOSE_MODES, diagnoseModeInfo } from '@shared/printDiagnose'
import { labelRowDims } from '@shared/printSpec'
import { useManagerSession } from '../hooks/useManagerSession'
import Modal from '../components/Modal'
import JalaliDateInput from '../components/JalaliDateInput'
import PasswordField from '../components/PasswordField'
import { CustodyChip } from '../components/CustodyChip'
import { CustodyAdminChip } from '../components/CustodyAdminChip'
import { exportTable } from '../lib/exportCsv'
/** کار الف — سه ستون مقصد پول در جدول «حذف گزارشات/واریانت» (همان تابع مشترک) */
import { destinationCells, DESTINATION_HEADERS_SHORT } from '../lib/destinationCells'
import {
  faDigits,
  money,
  toLatinDigits,
  toJalaliDateTime,
  jalaliToday,
  jalaliAddDays,
  jalaliMonthStart,
  isValidJalaliDate,
  parseGroupedInteger
} from '@shared/jalali'
import type {
  CustomerDeleteResult,
  CustomerDirectoryRow,
  CustomerKind,
  BackupEntry,
  DbStats,
  MaintenancePreview,
  MaintenanceResult,
  MergeReport,
  SalesPurgePreview,
  PanelAuthState,
  PanelPasswordReveal,
  PanelLockState
} from '@shared/types'
import {
  applyLabelPreset,
  resetLabelPreset,
  labelPresetOf,
  resolveLabelBrand,
  LABEL_PRESETS,
  DEFAULT_LABEL_TEMPLATE,
  DEFAULT_RECEIPT_TEMPLATE,
  DEFAULT_SALE_DEFAULTS,
  mergeFreshPosToggles,
  mergeFreshPrinter,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_SHIFT_CONFIG,
  createShiftTemplateId,
  normalizeTime,
  formatClockForDisplay,
  parseLabelTemplate,
  parseSecurityConfig,
  parseShiftConfig,
  parseOfficialTimeConfig,
  DEFAULT_OFFICIAL_TIME_CONFIG,
  type OfficialTimeConfig,
  type LabelTemplate,
  type ReceiptTemplate,
  type SaleDefaults,
  type SecurityConfig,
  type ShiftConfig,
  type ShiftTemplate,
  /** جلسه ۱۸ · بند ۳ — «آستانه‌ی درصد تخفیف غیرعادی» داخل همین سیاست حسابداری است */
  DEFAULT_ACCOUNTING_POLICY,
  parseAccountingPolicy,
  type AccountingPolicy
} from '@shared/receipt'

/** تنظیمات بکاپ خودکار به‌همراه مسیر واقعیِ در حال استفاده (مورد ۶). */
interface BackupConfigView {
  autoDir: string
  everyDays: number
  keep: number
  lastAutoAt: string
  effectiveDir: string
  defaultDir: string
  fallback: boolean
}
import { CHARGE_KINDS, CHARGE_SCOPES, CHARGE_KIND_LABELS, CHARGE_SCOPE_LABELS } from '@shared/charges'
import { LOCKED_PANELS } from '@shared/panels'
import { STAFF_ROLES, STAFF_ROLE_LABELS } from '@shared/enums'
import { broadcastPanelLocksChanged } from '../hooks/usePanelLocks'
import { broadcastSettingsChanged } from '../hooks/useSettings'
import {
  DEFAULT_DISCOUNT_POLICY,
  DISCOUNT_POLICY_LABELS,
  PRICE_ADJUST_MODE_LABELS,
  describeDiscountPolicy,
  fixedDiscountFor,
  parseDiscountPolicy,
  type DiscountPolicy,
  type DiscountPolicyMode,
  type PriceAdjustMode
} from '@shared/priceAdjust'

/**
 * ===================== تنظیمات =====================
 * چهار بخش:
 *   • قالب فاکتور چاپی — همان رسید حرارتی فروشگاه: هر فیلد را می‌توان روشن/
 *     خاموش کرد، متن برچسب‌ها و پیام‌های پایانی را عوض کرد، و نتیجه را در
 *     «پیش‌نمایش زنده» همان لحظه دید. چیدمان کلی رسید ثابت می‌ماند (عمدی).
 *   • چاپ — عرض کاغذ، اندازه‌ی فونت، تعداد نسخه، چاپگر پیش‌فرض، و این‌که رسید
 *     بعد از ثبت فاکتور خودکار چاپ شود یا نه.
 *   • فروش — نام فروشنده و قواعد «کد فاکتور» (طول کد و مدت اعتبارش برای برگشت
 *     از فروش). ⚠️ «درصد حق سرویس/مالیات» از اینجا حذف شد: عوارض و حق سرویس حالا
 *     فقط از پنل‌های دسته‌بندی‌محور می‌آید (چهار زیرپنل مستقل، لینکشان همان‌جاست).
 *   • شیفت‌ها — تعریف دستی شیفت‌ها (نام + ساعت شروع/پایان با دکمه‌ی «+») و سوییچ
 *     «تعیین شیفت بر اساس ساعت». خاموش = همان رفتار خودکار قبلی.
 *   • بکاپ و بازگردانی — تهیه بکاپ با انتخاب مسیر، و بازگردانی یک فایل بکاپ با دو
 *     حالت «جایگزینی کامل» یا «ادغام با داده‌ی فعلی».
 *   • سبک‌سازی — وزن فعلی دیتابیس، «آرشیو و پاک‌سازی» داده‌ی قدیمی‌تر از یک تاریخ،
 *     و فشرده‌سازی فایل (VACUUM).
 *   • حذف گزارشات فروش — انتخاب یک بازه‌ی تاریخی، دیدن فاکتورهای همان بازه، و
 *     حذفشان. در لحظه‌ی حذف پرسیده می‌شود «آیا بعد از حذف، موجودی‌ها به انبار
 *     بازگردند؟» و همان انتخاب (بله/خیر) به سرویس حذف فرستاده می‌شود؛ کل کار در
 *     یک تراکنش و با ثبت در AuditLog انجام می‌گردد.
 *
 * ذخیره‌سازی روی جدول Setting است (JSON)، پس اضافه شدن گزینه‌ی جدید هیچ
 * migration ای لازم ندارد. IPC: settings:bundle · settings:saveBundle ·
 * print:previewHtml · system:printers
 * ===================================================
 */

type Tab =
  | 'receipt'
  | 'print'
  | 'sale'
  | 'shift'
  | 'manager'
  /** بند ۳ — «سیاست تخفیف پنل فروش» (آزاد / تخفیف ثابت مدیر / غیرفعال) */
  | 'discount'
  | 'purge'
  | 'backup'
  | 'slim'
  | 'customers'
  /**
   * جلسه ۱۸ · بند ۳ — «سیاست حسابداری»، شامل فیلد «آستانه‌ی درصد تخفیف غیرعادی».
   * تا امروز این سیاست فقط روی دیتابیس بود و هیچ فرمی نداشت (فقط پیش‌فرض‌هایش
   * کار می‌کرد)، پس مدیر راهی برای تعیین یا تغییر آستانه نداشت.
   */
  | 'accounting'
  /**
   * «کارمندان» — ثبت/ویرایش/غیرفعال‌سازی کارمندان فروشگاه.
   *
   * ⚠️ جلسه ۱۹ — بخش «انتخاب کارمند فعالِ پشت سیستم» از همین تب **حذف شد**:
   * کارمند هر سند دیگر از یک تنظیم سراسری نمی‌آید، بلکه از **کارمند همان نشستِ
   * صندوق** خوانده می‌شود (فرم «نشست»، بند ۳). ثبت/ویرایش خودِ کارمندان
   * دست‌نخورده سر جایش است.
   */
  | 'staff'
  /** پیکربندی ساختاری حضانت؛ عملیات روزانه فقط در Header می‌ماند. */
  | 'custody'
  /** جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی» (افست دستی + بررسی ساعت سیستم) */
  | 'time'

/**
 * ===========================================================================
 * مورد ۱ — «پیش‌نمایش زنده‌ی رسید فقط در تب‌های مربوطه».
 *
 * پیش‌نمایش فقط برای تب‌هایی معنی دارد که واقعاً روی *ظاهر برگه‌ی چاپی* اثر
 * می‌گذارند: «قالب فاکتور چاپی»، «چاپ و چاپگر» و «فروش و کد فاکتور».
 * در بقیه‌ی تب‌ها (شیفت‌ها، مشتریان، رمز مدیر، تخفیف، بکاپ، سبک‌سازی، حذف
 * گزارشات) کاملاً مخفی است و ستون محتوا تمام عرض صفحه را می‌گیرد.
 *
 * ⚠️ این یک فهرست *سفید* است: تب جدیدی که بعداً اضافه شود، تا وقتی اسمش
 * این‌جا نیامده باشد پیش‌نمایش نمی‌گیرد (پیش‌فرض = مخفی).
 * ===========================================================================
 */
const PREVIEW_TABS: readonly Tab[] = ['receipt', 'print', 'sale']
/** همان ترتیب Date#getDay و ShiftPlan قدیمی؛ فقط برچسب نمایش در Shift Settings. */
const SHIFT_WEEKDAY_NAMES = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']

/** این تب پیش‌نمایش زنده‌ی رسید را نشان می‌دهد؟ */
function showsPreview(tab: Tab): boolean {
  return PREVIEW_TABS.includes(tab)
}

/** حجم فایل به شکل خوانا (بایت → کیلوبایت/مگابایت) */
function fileSize(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return `${faDigits(n)} بایت`
  if (n < 1024 * 1024) return `${faDigits((n / 1024).toFixed(1))} کیلوبایت`
  return `${faDigits((n / 1024 / 1024).toFixed(1))} مگابایت`
}

/** کلیدهای بولی (چک‌باکس‌های «نمایش/عدم نمایش») و متنی (برچسب‌ها) قالب رسید. */
type FlagKey = {
  [K in keyof ReceiptTemplate]: ReceiptTemplate[K] extends boolean ? K : never
}[keyof ReceiptTemplate]
type TextKey = {
  [K in keyof ReceiptTemplate]: ReceiptTemplate[K] extends string ? K : never
}[keyof ReceiptTemplate]

type StaffDraft = {
  id: number | null
  name: string
  role: string
  isActive: boolean
  jobTitle: string
  phone: string
  nationalId: string
  employmentStartJalali: string
  employmentEndJalali: string
  employmentStatus: 'ACTIVE' | 'LEAVE' | 'SUSPENDED' | 'TERMINATED'
  bankName: string
  bankAccountNo: string
  bankIban: string
  bankAccountHolder: string
}

const blankStaffDraft = (): StaffDraft => ({
  id: null,
  name: '',
  role: 'CASHIER',
  isActive: true,
  jobTitle: '',
  phone: '',
  nationalId: '',
  employmentStartJalali: '',
  employmentEndJalali: '',
  employmentStatus: 'ACTIVE',
  bankName: '',
  bankAccountNo: '',
  bankIban: '',
  bankAccountHolder: ''
})

/** Only the presence count reaches this marker; sensitive values stay inside the
 * manager-only form and are never copied to the directory. */
const STAFF_PROFILE_COMPLETION_FIELDS: readonly (keyof StaffDraft)[] = [
  'jobTitle',
  'phone',
  'nationalId',
  'employmentStartJalali',
  'bankName',
  'bankAccountNo',
  'bankIban',
  'bankAccountHolder'
]

function staffProfileCompletion(draft: StaffDraft) {
  const completed = STAFF_PROFILE_COMPLETION_FIELDS.filter((key) => String(draft[key] ?? '').trim().length > 0).length
  return { completed, total: STAFF_PROFILE_COMPLETION_FIELDS.length, isComplete: completed === STAFF_PROFILE_COMPLETION_FIELDS.length }
}

type LegacyShiftPlanReview = {
  state: 'EMPTY' | 'REVIEW_REQUIRED'
  total: number
  plans: Array<{ id: number; title: string; startMinute: number; durationMinutes: number; daysMask: number; isActive: boolean; staffIds: number[]; migrationState: 'REVIEW_REQUIRED'; migrationNote: string }>
}

export default function Settings() {
  const nav = useNavigate()
  /** رمز دوم Settings فقط بخش‌های غیرحساس را می‌بیند؛ پرونده کارکنان و حضانت مدیر اصلی می‌خواهند. */
  const { logout, isManager } = useManagerSession()
  const [tab, setTab] = useState<Tab>('receipt')
  // ---- رمز مدیریتی ----
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptTemplate>(DEFAULT_RECEIPT_TEMPLATE)
  const [sale, setSale] = useState<SaleDefaults>(DEFAULT_SALE_DEFAULTS)
  const [shift, setShift] = useState<ShiftConfig>(DEFAULT_SHIFT_CONFIG)
  /** legacy ShiftPlanها تا بازبینی صریح مدیر به تنظیمات canonical تبدیل نمی‌شوند. */
  const [legacyShiftPlanReview, setLegacyShiftPlanReview] = useState<LegacyShiftPlanReview | null>(null)
  const [legacyShiftPlanBusy, setLegacyShiftPlanBusy] = useState(false)
  /**
   * جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی».
   * `timeCheck` خروجی دکمه‌ی «بررسی ساعت سیستم» است (بدون نیاز به اینترنت).
   */
  const [time, setTime] = useState<OfficialTimeConfig>(DEFAULT_OFFICIAL_TIME_CONFIG)
  const [timeOffset, setTimeOffset] = useState('0')
  const [timeCheck, setTimeCheck] = useState<any | null>(null)
  const [timeNow, setTimeNow] = useState(new Date())
  const [timeBusy, setTimeBusy] = useState(false)
  /** تنظیمات چاپ لیبل (مورد ۵ و ۸) — مستقل از تنظیمات چاپ فاکتور */
  const [label, setLabel] = useState<LabelTemplate>(DEFAULT_LABEL_TEMPLATE)
  /**
   * بخش ۲ — تنظیمات «قفل موقت بعد از رمز اشتباه». همان مقداری که `AuthService`
   * برای قفل کردن گیت‌ها می‌خواند، پس فرم و رفتار برنامه همیشه یکی هستند.
   */
  const [security, setSecurity] = useState<SecurityConfig>(DEFAULT_SECURITY_CONFIG)
  const [securityBusy, setSecurityBusy] = useState(false)
  /**
   * بند ۳ — «سیاست تخفیف پنل فروش». همان مقداری که `useSettings().discount` به
   * پنل فروش می‌دهد، پس این فرم و رفتار پنل فروش هیچ‌وقت دو چیز متفاوت نیستند.
   * مثل تنظیمات امنیتی، دکمه‌ی ذخیره‌ی *فوری* خودش را دارد (پایین‌تر: چرا).
   */
  const [discount, setDiscount] = useState<DiscountPolicy>(DEFAULT_DISCOUNT_POLICY)
  const [discountBusy, setDiscountBusy] = useState(false)
  /** نشست ۱۵۴ (S151-b) — رمز مدیر یا رمز دوم پنل تنظیمات؛ سرور می‌سنجد، بعد از هر تلاش پاک می‌شود */
  const [discountPw, setDiscountPw] = useState('')
  /**
   * نشست ۱۵۵ (S151-c1، یافته‌ی Y10) — رمز مدیر برای بخش‌های حساس ذخیره‌ی کلی (فروش، شیفت،
   * ساعت رسمی) و ذخیره‌ی فوری تنظیمات امنیتی؛ و رمز حذف مشتری دارای فاکتور. سرور فقط وقتی
   * بخش حساس واقعاً تغییر کرده رمز می‌خواهد؛ رمز بعد از هر تلاش پاک می‌شود.
   */
  const [bundlePw, setBundlePw] = useState('')
  const [securityPw, setSecurityPw] = useState('')
  // نشست ۱۵۷ (Y13) — رمز مدیر برای دو کانال فوری: افست ساعت رسمی و سوییچ «شیفت بر اساس ساعت»
  const [timePw, setTimePw] = useState('')
  const [byTimePw, setByTimePw] = useState('')
  /** نشست ۳۱۰ · فاز ۲ — سقف اضافه‌کاری شیفت؛ ذخیره‌ی فوری با همان فیلد رمز مدیر */
  const [overtimeCap, setOvertimeCap] = useState('0')
  const [custDelPw, setCustDelPw] = useState('')
  /** رمز شخصی مدیر برای تأیید اصلاح/ابطال دیرهنگام؛ هرگز از سرور خوانده نمی‌شود. */
  const [staffCorrectionApprovalPw, setStaffCorrectionApprovalPw] = useState('')
  const [printers, setPrinters] = useState<string[]>([])
  /**
   * نشست ۲۲۲ · فاز ۳ — فهرست «کامل» چاپگرها (پیش‌فرض ویندوز + نوع حدسی) برای
   * کارت‌های چاپ. اگر این کانال در دسترس نباشد، همان فهرست ساده‌ی `printers`
   * می‌ماند و هیچ چیزی نمی‌شکند.
   */
  const [printerList, setPrinterList] = useState<{ name: string; displayName: string; isDefault: boolean; kindGuess?: 'RECEIPT' | 'LABEL' | 'PAGE' | 'UNKNOWN' }[]>([])
  const [printerBusy, setPrinterBusy] = useState(false)
  const [printerMsg, setPrinterMsg] = useState<string | null>(null)
  /**
   * نشست ۲۲۲ · فاز ۰ طرح چاپ — وضعیت «آزمایش‌گر چاپ».
   * این ابزار هیچ تنظیمی را ذخیره نمی‌کند و فقط وقتی صدا زده می‌شود که کاربر
   * خودش دکمه‌ی «اجرای آزمایش» را بزند.
   */
  const [diag, setDiag] = useState<{
    mode: 'A' | 'B' | 'C' | 'D' | 'E'
    deviceName: string
    widthMm: number
    heightMm: number
    columns: number
    gapXMm: number
    silent: boolean
  }>({ mode: 'A', deviceName: '', widthMm: 80, heightMm: 140, columns: 1, gapXMm: 2, silent: true })
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagResult, setDiagResult] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  /** پیش‌نمایش زنده‌ی لیبل (مثل پیش‌نمایش رسید، ولی برای برچسب کالا) */
  const [labelPreview, setLabelPreview] = useState('')
  // ---- رمز دوم اختصاصی پنل‌ها ----
  const [panelAuth, setPanelAuth] = useState<PanelAuthState[]>([])
  /** رمز مدیر، برای تایید تعیین/حذف رمز دوم پنل‌ها */
  const [panelManagerPw, setPanelManagerPw] = useState('')
  /** رمز دومِ تایپ‌شده برای هر پنل (کلید پنل → رمز) */
  const [panelPw, setPanelPw] = useState<Record<string, string>>({})
  const [panelBusy, setPanelBusy] = useState('')
  /**
   * -------------------------------------------------------------------------
   * مورد ۷ — «رمز سوم»، مختص هر ترکیب «پنل × شیفت».
   *
   * پیش‌فرض همه‌ی آکاردئون‌ها بسته است تا این صفحه شلوغ نشود؛ کلید هر ردیفِ
   * زیرجدول `panelKey#shiftNumber` است، پس رمزِ تایپ‌شده‌ی شیفت صبحِ یک پنل با
   * شیفت صبحِ پنل دیگر قاطی نمی‌شود.
   * -------------------------------------------------------------------------
   */
  const [panelExpanded, setPanelExpanded] = useState<string[]>([])
  const [shiftPw, setShiftPw] = useState<Record<string, string>>({})
  const [shiftBusy, setShiftBusy] = useState('')
  /**
   * مورد ۴ — رمزهای ذخیره‌شده‌ای که همین حالا «نمایش» داده شده‌اند
   * (کلید: `panelKey` برای رمز دوم، `panelKey#shiftNumber` برای رمز سوم).
   * هیچ‌جا ذخیره نمی‌شوند و با هر بار بسته شدن صفحه از بین می‌روند.
   */
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [revealBusy, setRevealBusy] = useState('')
  // ---- بند ۱: قفل ماژول‌ها (روشن/خاموش کردن قفل رمز دوم هر بخش) ----
  const [panelLocks, setPanelLocks] = useState<PanelLockState>({ locks: {}, openCount: 0, alwaysLocked: [] })
  const [lockBusy, setLockBusy] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  /**
   * نام چاپگرِ رسید/لیبل در لحظه‌ی بارگذاری (یا آخرین ذخیره‌ی موفق) صفحه. save() با مقایسه‌ی نام فعلیِ
   * فرم با این مقدار می‌فهمد کاربر *خودش* چاپگر را روی همین صفحه عوض کرده یا نه (ضد‌کهنگیِ mergeFreshPrinter
   * فقط برای حالت «دست‌نخورده» می‌ماند).
   */
  const receiptPrinterAtLoad = useRef('')
  const labelPrinterAtLoad = useRef('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // ---- بکاپ و بازگردانی ----
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  /** بکاپی که کاربر برای اعمال انتخاب کرده (مودال «چگونه اعمال شود؟») */
  const [applyTarget, setApplyTarget] = useState<BackupEntry | null>(null)
  /** نشست ۱۸۱ — رمز مدیر برای بازگردانی/ادغام بکاپ (گیت در BackupService است، نه اینجا). */
  const [applyPassword, setApplyPassword] = useState('')
  /** نشست ۲۰۶ — رمز حذف بکاپ و ذخیرهٔ تنظیمات خودکار (گیت در BackupService). */
  const [backupGatePw, setBackupGatePw] = useState('')
  const [mergeReport, setMergeReport] = useState<MergeReport | null>(null)
  // ---- سبک‌سازی ----
  const [stats, setStats] = useState<DbStats | null>(null)
  /** پیش‌فرض باید از گیت دو ساله‌ی main عبور کند، نه این‌که همان ابتدا رد شود. */
  const [slimBefore, setSlimBefore] = useState(jalaliAddDays(jalaliToday(), -730))
  const [slimPreview, setSlimPreview] = useState<MaintenancePreview | null>(null)
  const [slimResult, setSlimResult] = useState<MaintenanceResult | null>(null)
  const [slimBusy, setSlimBusy] = useState(false)
  const [slimBackup, setSlimBackup] = useState(true)
  const [slimAudit, setSlimAudit] = useState(true)
  /**
   * بند ۸ · §۱۰ (جلسه ۳۱) — رمز مدیر برای پاک‌سازی لاگ عملیات.
   * مثل بقیه‌ی رمزهای این صفحه جایی ذخیره نمی‌شود و بعد از هر اجرا خالی می‌گردد.
   */
  const [slimManagerPw, setSlimManagerPw] = useState('')
  const [askSlim, setAskSlim] = useState(false)
  // ---- حذف گزارشات فروش یک بازه ----
  const [purgeFrom, setPurgeFrom] = useState(jalaliMonthStart())
  const [purgeTo, setPurgeTo] = useState(jalaliToday())
  const [purge, setPurge] = useState<SalesPurgePreview | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeReason, setPurgeReason] = useState('')
  /** پرسش «موجودی‌ها به انبار بازگردند؟» باز است؟ */
  const [askRestore, setAskRestore] = useState(false)
  /**
   * مورد ۱ — حذف تک‌فاکتوری: فاکتورهای تیک‌خورده‌ی جدول.
   * 'range' = حذف همه‌ی فاکتورهای بازه (رفتار قبلی، دست‌نخورده)
   * 'selected' = فقط همین فاکتورهای انتخاب‌شده، با *همان* منطق و همان پرسش
   * بازگشت موجودی به انبار.
   */
  const [selected, setSelected] = useState<number[]>([])
  const [purgeMode, setPurgeMode] = useState<'range' | 'selected'>('range')
  /** پیش‌نمایش فاکتورهای انتخاب‌شده (تعداد، جمع، و آنچه به انبار برمی‌گردد) */
  const [selPurge, setSelPurge] = useState<SalesPurgePreview | null>(null)
  // ---- بکاپ خودکار: مسیر و بازه‌ی زمانی (مورد ۶) ----
  const [backupCfg, setBackupCfg] = useState<BackupConfigView | null>(null)
  const [backupEvery, setBackupEvery] = useState('1')
  const [backupKeep, setBackupKeep] = useState('30')
  // ---- بانک شماره مشتریان (مورد ۶) ----
  const [customers, setCustomers] = useState<CustomerDirectoryRow[]>([])
  /** نشست ۱۱۵ · بند ۴-۴۶ — metadata صفحه و هشدار برش بانک مشتریان */
  const [customerMeta, setCustomerMeta] = useState<{
    page?: { skip: number; take: number; totalCount: number; truncated: boolean }
    warnings: string[]
  }>({ warnings: [] })
  const [customerSearch, setCustomerSearch] = useState('')
  const [onlyWithPhone, setOnlyWithPhone] = useState(true)
  /** مورد ۶: فیلتر نوع مشتری (همه / تکی / عمده) */
  const [customerKind, setCustomerKind] = useState<CustomerKind>('all')
  /** مورد ۳: حداقل «جمع خرید» — انتخاب مشتریان قرعه‌کشی */
  const [customerMinTotal, setCustomerMinTotal] = useState('')
  /** مورد ۳: فرم ثبت/ویرایش دستی مشتری */
  const [custDraft, setCustDraft] = useState<{
    id: number | null
    name: string
    phone: string
    isWholesale: boolean
    manualPurchaseTotal: string
  }>({ id: null, name: '', phone: '', isWholesale: false, manualPurchaseTotal: '' })
  const [custBusy, setCustBusy] = useState(false)
  /** مشتریِ در انتظار تایید حذف (مورد ۳) */
  const [delCustomer, setDelCustomer] = useState<CustomerDirectoryRow | null>(null)

  // ---------------- جلسه ۱۸ · بند ۳ — سیاست حسابداری ----------------
  const [policy, setPolicy] = useState<AccountingPolicy>(DEFAULT_ACCOUNTING_POLICY)
  const [policyDirty, setPolicyDirty] = useState(false)
  const [policyBusy, setPolicyBusy] = useState(false)
  /** نشست ۱۵۴ (S151-b، بند ۴-۲۹) — رمز مدیر همیشه لازم؛ بعد از هر تلاش پاک می‌شود */
  const [policyPw, setPolicyPw] = useState('')

  // ---------------- جلسه ۱۸ · بند ۲ — کارمندان ----------------
  const [staffRows, setStaffRows] = useState<
    {
      id: number
      username: string
      name: string
      role: string
      roleLabel: string
      isActive: boolean
      hasCorrectionApprovalPassword?: boolean
    }[]
  >([])

  const [staffDraft, setStaffDraft] = useState<StaffDraft>(blankStaffDraft)
  const [staffBusy, setStaffBusy] = useState(false)
  /** فرم کارمند بالای فهرست است؛ پس «ویرایش» باید کاربر را واقعاً به فرم ببرد،
   * نه این‌که state تغییر کند و پایین جدول بی‌صدا بماند. */
  const staffFormRef = useRef<HTMLDivElement | null>(null)
  const staffNameInputRef = useRef<HTMLInputElement | null>(null)
  const [staffError, setStaffError] = useState<string | null>(null)
  const staffProfileProgress = useMemo(() => staffProfileCompletion(staffDraft), [staffDraft])
  const [delMessage, setDelMessage] = useState('')

  const revealStaffForm = () => {
    window.requestAnimationFrame(() => {
      staffFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  /** خطای فرم نباید فقط در اعلان کلیِ بالای صفحه بماند؛ کاربر معمولاً پس از پر
   * کردن اطلاعات در انتهای فرم است و باید همان‌جا علت را ببیند. */
  const showStaffError = (message: string) => {
    setStaffError(message)
    setErr(message)
    revealStaffForm()
  }

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 6000)
  }

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const b = await call<{
        receipt: ReceiptTemplate
        sale: SaleDefaults
        shift: ShiftConfig
        label: LabelTemplate
        security: SecurityConfig
        /** بند ۳ — سیاست تخفیف (`SettingsBundle.discount`) */
        discount: DiscountPolicy
        /** جلسه ۱۹ · بند ۹ — افست دستی ساعت رسمی */
        time: OfficialTimeConfig
      }>(CH.settingsBundle)
      const loadedReceipt = { ...DEFAULT_RECEIPT_TEMPLATE, ...b.receipt }
      const loadedLabel = parseLabelTemplate(b.label)
      receiptPrinterAtLoad.current = loadedReceipt.printerName
      labelPrinterAtLoad.current = loadedLabel.printerName
      setReceipt(loadedReceipt)
      setSale({ ...DEFAULT_SALE_DEFAULTS, ...b.sale })
      const loadedShift = parseShiftConfig(b.shift)
      setShift(loadedShift)
      setOvertimeCap(String(loadedShift.overtimeMaxMinutes ?? 0))
      setLabel(loadedLabel)
      setSecurity(parseSecurityConfig(b.security))
      // مقدار خراب یا نبودِ کلید ⇒ پیش‌فرض FREE (رفتار نسخه‌های قبل)، بدون کرش
      setDiscount(parseDiscountPolicy(b.discount))
      // بند ۹ — افست ساعت رسمی (نبودِ کلید ⇒ صفر = رفتار مو‌به‌موی قبل)
      const t = parseOfficialTimeConfig(b.time)
      setTime(t)
      setTimeOffset(String(t.offsetHours))
      setDirty(false)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
    call<string[]>(CH.printers)
      .then(setPrinters)
      .catch(() => setPrinters([]))
    void refreshPrintersDetailed()
  }, [load])

  // پیش‌نمایش زنده‌ی رسید با همان تنظیمات *ذخیره‌نشده*
  useEffect(() => {
    const t = window.setTimeout(() => {
      call<string>(CH.printPreviewHtml, { template: receipt })
        .then(setPreview)
        .catch(() => setPreview(''))
    }, 350)
    return () => window.clearTimeout(t)
  }, [receipt])

  /**
   * پیش‌نمایش زنده‌ی لیبل: با هر تغییر در تنظیمات لیبل، HTML یک لیبل نمونه از
   * main گرفته و در iframe نشان داده می‌شود — دقیقاً همان مکانیزم پیش‌نمایش رسید،
   * پس آنچه می‌بینید همان چیزی است که چاپ می‌شود.
   */
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      call<string>(CH.printLabelPreviewHtml, { template: label })
        .then((html) => alive && setLabelPreview(html || ''))
        .catch(() => alive && setLabelPreview(''))
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [label])

  /** وضعیت رمز دوم پنل‌ها (فعال/غیرفعال) */
  const loadPanelAuth = useCallback(async () => {
    try {
      setPanelAuth(await call<PanelAuthState[]>(CH.managerPanelInfo))
    } catch {
      setPanelAuth([])
    }
  }, [])

  useEffect(() => {
    void loadPanelAuth()
  }, [loadPanelAuth])

  /**
   * ---------------- بند ۱ — قفل ماژول‌ها ----------------
   * خواندن سیاست قفل آزاد است، ولی *نوشتنش* رمز مدیر می‌خواهد (نه رمز دوم پنل
   * تنظیمات) — وگرنه کسی که فقط رمز تنظیمات را دارد می‌توانست قفل کل برنامه را
   * بردارد.
   */
  const loadPanelLocks = useCallback(async () => {
    try {
      setPanelLocks(await call<PanelLockState>(CH.managerPanelLocks))
    } catch {
      // نشدنِ خواندن نباید صفحه را بخواباند؛ نمایش پیش‌فرض = همه قفل
      setPanelLocks({ locks: {}, openCount: 0, alwaysLocked: [] })
    }
  }, [])

  useEffect(() => {
    void loadPanelLocks()
  }, [loadPanelLocks])

  /** چند ماژول قفلشان خاموش است (برای نوار خلاصه‌ی همان بخش). */
  const lockOpenCount = useMemo(
    () => LOCKED_PANELS.filter((p) => !panelLocks.alwaysLocked.includes(p.key) && panelLocks.locks[p.key] === false).length,
    [panelLocks]
  )

  /**
   * روشن/خاموش کردن قفل یک ماژول. فقط *همان یک کلید* فرستاده می‌شود، پس بقیه‌ی
   * ماژول‌ها دست‌نخورده می‌مانند. بعد از ذخیره، همه‌ی گیت‌های باز برنامه با یک
   * رویداد تازه می‌شوند تا وضعیت جدید همان لحظه اعمال شود (نه بعد از ری‌استارت).
   */
  const togglePanelLock = async (key: string, enabled: boolean) => {
    const manager = toLatinDigits(panelManagerPw).trim()
    if (!manager) {
      setErr('برای تغییر قفل ماژول‌ها، اول «رمز مدیر» را در همین بخش وارد کنید.')
      return
    }
    setLockBusy(key)
    try {
      await call(CH.managerPanelLocksSet, { managerPassword: manager, locks: { [key]: enabled } })
      await loadPanelLocks()
      broadcastPanelLocksChanged()
      const title = LOCKED_PANELS.find((x) => x.key === key)?.title ?? key
      setErr(null)
      flash(
        enabled
          ? `قفل ماژول «${title}» روشن شد؛ از این پس با رمز مدیر (یا رمز دوم خودش) باز می‌شود.`
          : `قفل ماژول «${title}» خاموش شد؛ از این پس بدون رمز باز می‌شود. رمز دوم این ماژول پاک نشده است.`
      )
    } catch (e: any) {
      setErr(e.message)
      // ذخیره نشد ⇒ وضعیت واقعی سرور را برگردان تا چک‌باکس دروغ نگوید
      await loadPanelLocks()
    } finally {
      setLockBusy('')
    }
  }

  /** تعیین یا حذف رمز دوم یک پنل (رمز مدیر لازم است). */
  const savePanelPassword = async (key: string, remove = false) => {
    const manager = toLatinDigits(panelManagerPw).trim()
    if (!manager) {
      setErr('برای تعیین یا حذف رمز دوم، اول «رمز مدیر» را در همین بخش وارد کنید.')
      return
    }
    setPanelBusy(key)
    try {
      await call(CH.managerPanelSetPassword, {
        panel: key,
        managerPassword: manager,
        password: remove ? '' : toLatinDigits(panelPw[key] ?? '').trim()
      })
      setPanelPw((prev) => ({ ...prev, [key]: '' }))
      // رمزِ نمایش‌داده‌شده‌ی قبلی دیگر معتبر نیست ⇒ همان لحظه از صفحه برداشته شود
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      await loadPanelAuth()
      const title = LOCKED_PANELS.find((x) => x.key === key)?.title ?? key
      setErr(null)
      flash(
        remove
          ? `رمز دوم پنل «${title}» حذف شد. رمزهای سوم شیفتی همین پنل (اگر تعریف کرده باشید) دست‌نخورده‌اند، پس این پنل با رمز مدیر یا رمز سومِ همان شیفت باز می‌شود.`
          : `رمز دوم اختصاصی پنل «${title}» ثبت شد. این پنل از این پس با رمز مدیر *یا* همین رمز باز می‌شود.`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPanelBusy('')
    }
  }

  /**
   * =========================================================================
   * مورد ۵ — «یادآوری وارد‌نکردن رمز مدیر».
   *
   * تا این نسخه، اگر کادر «رمز مدیر (برای تایید همین بخش)» خالی می‌ماند و کاربر
   * دکمه‌ی «ثبت رمز» یا چک‌باکس قفل را می‌زد، فقط یک خط قرمزِ کوچک بالای صفحه
   * می‌آمد و کاربر گیج می‌شد که چرا کار نکرد. حالا *قبل* از هر تلاشی، یک هشدار
   * زرد روشن بالای همان جدول‌ها نشان داده می‌شود و با پر کردن کادر خودش محو
   * می‌شود. رفتار سرور دست‌نخورده است (آن هم مثل قبل رمز مدیر می‌خواهد).
   * =========================================================================
   */
  const managerPwEmpty = !toLatinDigits(panelManagerPw).trim()

  /** کلید یکتای یک ترکیب «پنل × شیفت» در stateهای این صفحه. */
  const shiftKey = (panel: string, shiftNo: number) => `${panel}#${shiftNo}`

  /** باز/بسته کردن آکاردئون رمزهای سومِ یک پنل (مورد ۷). */
  const togglePanelExpanded = (key: string) =>
    setPanelExpanded((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  /**
   * مورد ۷ — تعیین یا حذف «رمز سوم» یک ترکیب «پنل × شیفت» (رمز مدیر لازم است).
   * اولویت ورود، همان چیزی است که سرور پیاده کرده و اینجا فقط یادآوری می‌شود:
   * رمز مدیر (همیشه) > رمز دوم پنل (همه‌ی شیفت‌ها) > رمز سوم همان شیفت جاری.
   */
  const savePanelShiftPassword = async (key: string, shiftNo: number, shiftName: string, remove = false) => {
    const manager = toLatinDigits(panelManagerPw).trim()
    if (!manager) {
      setErr('برای تعیین یا حذف رمز سوم، اول «رمز مدیر» را در همین بخش وارد کنید.')
      return
    }
    const id = shiftKey(key, shiftNo)
    setShiftBusy(id)
    try {
      await call(CH.managerPanelShiftSetPassword, {
        panel: key,
        shift: shiftNo,
        managerPassword: manager,
        password: remove ? '' : toLatinDigits(shiftPw[id] ?? '').trim()
      })
      setShiftPw((prev) => ({ ...prev, [id]: '' }))
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await loadPanelAuth()
      const title = LOCKED_PANELS.find((x) => x.key === key)?.title ?? key
      setErr(null)
      flash(
        remove
          ? `رمز سوم «${title} × ${shiftName}» حذف شد.`
          : `رمز سوم «${title} × ${shiftName}» ثبت شد؛ این رمز فقط در همین شیفت و فقط همین پنل را باز می‌کند.`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setShiftBusy('')
    }
  }

  /**
   * مورد ۴ — نمایش دوباره‌ی یک رمز ذخیره‌شده (رمز دوم پنل، یا رمز سوم یک شیفت).
   * `shiftNo = null` یعنی رمز دوم خودِ پنل. رمز مدیر لازم است و خودِ رمز هرگز در
   * لاگ ثبت نمی‌شود (توضیح کامل تصمیم رمزنگاری در AuthService، بخش «گاوصندوق»).
   */
  const revealPassword = async (key: string, shiftNo: number | null) => {
    const manager = toLatinDigits(panelManagerPw).trim()
    if (!manager) {
      setErr('برای دیدن رمز ذخیره‌شده، اول «رمز مدیر» را در همین بخش وارد کنید.')
      return
    }
    const id = shiftNo == null ? key : shiftKey(key, shiftNo)
    // اگر همین حالا نمایش داده شده، دکمه نقش «مخفی کن» را دارد
    if (revealed[id]) {
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    setRevealBusy(id)
    try {
      const r = await call<PanelPasswordReveal>(CH.managerPanelReveal, {
        panel: key,
        shift: shiftNo ?? undefined,
        managerPassword: manager
      })
      setRevealed((prev) => ({ ...prev, [id]: r?.password ?? '' }))
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setRevealBusy('')
    }
  }

  /** هشدار زرد «رمز مدیر را وارد کنید» — یک متن، دو جای مصرف (مورد ۵). */
  const managerPwWarning = (what: string) =>
    managerPwEmpty ? (
      <div className="rounded px-3 py-2 border-2 bg-amber-100 border-amber-500 leading-7">
        <b>⚠️ کادر «رمز مدیر» خالی است.</b> برای {what} اول رمز مدیر خودتان را در کادر بالا وارد کنید؛ وگرنه این تغییر
        ثبت نمی‌شود.
        <div className="kbd leading-6">
          این کادر عمداً هر بار خالی شروع می‌شود و جایی ذخیره نمی‌شود: تغییر رمز و قفلِ پنل‌ها نباید با نشستن یک نفر
          پشت سیستمِ بازمانده انجام‌شدنی باشد.
        </div>
      </div>
    ) : null

  const setR = (patch: Partial<ReceiptTemplate>) => {
    setReceipt((p) => ({ ...p, ...patch }))
    setDirty(true)
  }
  /** روشن/خاموش کردن یک فیلد رسید (کلید داینامیک، ولی type-safe) */
  const setFlag = (key: FlagKey, value: boolean) => {
    setReceipt((p) => ({ ...p, [key]: value }) as ReceiptTemplate)
    setDirty(true)
  }
  /** تغییر یک متن/برچسب رسید */
  const setText = (key: TextKey, value: string) => {
    setReceipt((p) => ({ ...p, [key]: value }) as ReceiptTemplate)
    setDirty(true)
  }
  const setS = (patch: Partial<SaleDefaults>) => {
    setSale((p) => ({ ...p, ...patch }))
    setDirty(true)
  }
  /** تغییر تنظیمات چاپ لیبل (مستقل از قالب و چاپگر فاکتور — مورد ۵ و ۸) */
  const setL = (patch: Partial<LabelTemplate>) => {
    setLabel((p) => ({ ...p, ...patch }))
    setDirty(true)
  }
  /** ویرایش یک شیفت تعریف‌شده (نام / ساعت شروع / ساعت پایان). */
  const setShiftRow = (idx: number, patch: Partial<ShiftTemplate>) => {
    setShift((p) => {
      const templates = p.templates.map((t, i) => (i === idx ? { ...t, ...patch } : t))
      return { ...p, templates, names: templates.map((t) => t.name) }
    })
    setDirty(true)
  }

  /** افزودن شیفت جدید («+»): ساعت شروعش، پایان شیفت قبلی است. */
  const addShift = () => {
    setShift((p) => {
      const last = p.templates[p.templates.length - 1]
      const start = last ? normalizeTime(last.endTime) : '08:00'
      const endHour = (Number(start.slice(0, 2)) + 6) % 24
      const templates = [
        ...p.templates,
        {
          // نام/ساعت قابل‌ویرایش‌اند؛ شناسه از لحظهٔ ساخت ثابت می‌ماند تا برنامه و
          // تاریخچهٔ آینده هرگز به شماره/جایگاه آرایه وابسته نباشند.
          id: createShiftTemplateId(),
          name: `شیفت ${p.templates.length + 1}`,
          startTime: start,
          endTime: `${String(endHour).padStart(2, '0')}:${start.slice(3)}`,
          isActive: true,
          daysMask: 127,
          staffIds: [],
          reminderRepeatMin: 15,
          allowMidDayHandover: false
        }
      ]
      return { ...p, templates, names: templates.map((t) => t.name) }
    })
    setDirty(true)
  }

  const removeShift = (idx: number) => {
    setShift((p) => {
      const templates = p.templates.filter((_, i) => i !== idx)
      return { ...p, templates, names: templates.map((t) => t.name) }
    })
    setDirty(true)
  }

  /**
   * ⚡ مورد ۱: سوییچ «تعیین شیفت بر اساس ساعت» *فوری* ذخیره می‌شود و منتظر
   * دکمه‌ی «ذخیره‌ی تنظیمات» نمی‌ماند. تاثیرش رفتاری و حیاتی است (با خاموش
   * شدنش، هر بستن صندوق یک شیفت جدید باز می‌کند)، پس «یادم رفت ذخیره کنم»
   * نباید باعث سردرگمی شود. تعریف/ویرایش خود شیفت‌ها مثل قبل با دکمه‌ی ذخیره‌ی
   * عمومی است.
   */
  const loadLegacyShiftPlanReview = async () => {
    if (!isManager) return
    setLegacyShiftPlanBusy(true)
    setErr(null)
    try {
      setLegacyShiftPlanReview(await call<LegacyShiftPlanReview>(CH.custodyPlanLegacyReview, {}))
    } catch (e: any) {
      setErr(e?.message ?? 'برنامه‌های قدیمی برای بازبینی خوانده نشدند.')
    } finally {
      setLegacyShiftPlanBusy(false)
    }
  }

  const setByTime = async (byTime: boolean) => {
    const previous = shift.byTime
    setShift((p) => ({ ...p, byTime })) // نمایش فوری
    try {
      await call(CH.settingsShiftByTime, { byTime, managerPassword: byTimePw })
      flash(
        byTime
          ? 'ذخیره شد · از همین حالا شیفت هر فاکتور از ساعت لحظه‌ی فروش تعیین می‌شود.'
          : 'ذخیره شد · از همین حالا با هر بار بستن صندوق، شیفت بعدی همان روز خودکار باز می‌شود (حتی روزی ۱۰ بار).'
      )
    } catch (e: any) {
      setShift((p) => ({ ...p, byTime: previous })) // برگشت به حالت قبل
      setErr(`ذخیره‌ی سوییچ شیفت انجام نشد: ${e.message}`)
    } finally {
      setByTimePw('')
    }
  }

  /**
   * نشست ۳۱۰ · فاز ۲ — سقف اضافه‌کاری هم *فوری* ذخیره می‌شود (مثل خودِ سوییچ):
   * رمز مدیر همان فیلد byTimePw است و خودِ سرویس باز هم رمز را و محدوده‌ی
   * ۰..۲۴۰ را سروری بازبینی می‌کند.
   */
  const saveOvertimeMax = async () => {
    const mins = Math.trunc(Number(toLatinDigits(overtimeCap).replace(/[^0-9-]/g, '')))
    if (!Number.isFinite(mins) || mins < 0 || mins > 240) {
      return setErr('سقف اضافه‌کاری باید عددی صحیح بین ۰ تا ۲۴۰ دقیقه باشد (۰ یعنی خاموش).')
    }
    try {
      const next = await call<ShiftConfig>(CH.settingsShiftOvertimeMax, { minutes: mins, managerPassword: byTimePw })
      setShift(next)
      flash(
        mins > 0
          ? `ذخیره شد · اضافه‌کاری شیفت شب تا ${faDigits(mins)} دقیقه بعد از پایان بازه فعال است.`
          : 'ذخیره شد · اضافه‌کاری خاموش است؛ نشستِ بازِ دیروز بیرون از بازه همیشه باید بسته شود.'
      )
    } catch (e: any) {
      setErr(`ذخیره‌ی سقف اضافه‌کاری انجام نشد: ${e.message}`)
    } finally {
      setByTimePw('')
    }
  }

  /**
   * بانک شماره مشتریان (مورد ۶): همه‌ی مشتری‌های ثبت‌شده — از پنل فروش، فاکتور
   * عمده یا هر جای دیگر — با تعداد و جمع خریدشان. فعلاً فقط نمایش + کپی همه‌ی
   * شماره‌ها در حافظه (برای چسباندن در پنل پیامک).
   */
  const loadCustomers = useCallback(
    async (kindOverride?: CustomerKind, skip = 0) => {
    try {
      const r = await call<CustomerDirectoryRow[] & { page?: any; warnings?: string[] }>(CH.customerDirectory, {
        search: customerSearch,
        onlyWithPhone,
        kind: kindOverride ?? customerKind,
        minTotal: Number(toLatinDigits(customerMinTotal).replace(/[^0-9]/g, '')) || 0,
        skip
      })
      setCustomers(r)
      setCustomerMeta({ page: r.page, warnings: r.warnings ?? [] })
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    }
    },
    [customerSearch, onlyWithPhone, customerKind, customerMinTotal]
  )

  /**
   * -------------------------------------------------------------------------
   * مدیریت دستی مشتریان (مورد ۳): ثبت مشتری جدید، ویرایش، و ثبت «مجموع مبلغ
   * خرید» دستی.
   *
   * چرا مبلغ خرید دستی؟ جمع خرید واقعی همیشه از فاکتورهای ثبت‌شده حساب می‌شود؛
   * این عدد برای مشتری‌ای است که سابقه‌اش در برنامه نیست (مثلاً خرید قبل از
   * نصب) و «جمع خرید» = جمع فاکتورها + همین عدد. فیلتر «حداقل مبلغ خرید» روی
   * همین جمع نهایی کار می‌کند، پس انتخاب مشتریان قرعه‌کشی با یک عدد انجام
   * می‌شود.
   *
   * شماره تلفن تکراری هیچ‌وقت رکورد دوم نمی‌سازد: سمت main همان مشتری قبلی پیدا
   * می‌شود (با تحمل قالب ۰۹۱۲…/۹۸۹۱۲…/۹۱۲…) و فقط تعداد فاکتورش زیاد می‌گردد.
   * -------------------------------------------------------------------------
   */
  const resetCustDraft = () =>
    setCustDraft({ id: null, name: '', phone: '', isWholesale: false, manualPurchaseTotal: '' })

  const saveCustomer = async () => {
    const name = custDraft.name.trim()
    if (!name) return setErr('نام مشتری را وارد کنید.')
    // نشست ۱۵۰ — «۱۲٫۵» دیگر با حذف غیررقم ۱۲۵ نمی‌شود؛ نامعتبر ⇒ پیام فارسی
    const manualPurchaseTotal = parseGroupedInteger(custDraft.manualPurchaseTotal)
    if (manualPurchaseTotal == null)
      return setErr('مجموع مبلغ خرید دستی باید عدد صحیح صفر یا بیشتر به ریال باشد (بدون اعشار و علامت منفی).')
    setCustBusy(true)
    try {
      const payload = {
        name,
        phone: toLatinDigits(custDraft.phone).trim() || null,
        isWholesale: custDraft.isWholesale,
        manualPurchaseTotal
      }
      if (custDraft.id) await call(CH.customerUpdate, { ...payload, id: custDraft.id })
      else await call(CH.customerCreate, payload)
      resetCustDraft()
      await loadCustomers()
      flash(
        custDraft.id
          ? 'مشتری ویرایش شد.'
          : `مشتری ${payload.isWholesale ? 'عمده' : 'تکی'} ثبت شد. (اگر همین شماره از قبل بود، همان مشتری استفاده شد و رکورد تکراری ساخته نشد.)`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCustBusy(false)
    }
  }

  /** ثبت سریع فقط «مجموع مبلغ خرید» یک ردیف، بدون باز کردن فرم */
  const saveCustomerTotal = async (c: CustomerDirectoryRow, raw: string) => {
    const value = parseGroupedInteger(raw)
    if (value == null)
      return setErr(
        `مجموع مبلغ خرید دستی باید عدد صحیح صفر یا بیشتر به ریال باشد؛ «${raw}» برای «${c.name}» ذخیره نشد.`
      )
    if (value === c.manualPurchaseTotal) return
    try {
      await call(CH.customerUpdate, { id: c.id, manualPurchaseTotal: value })
      await loadCustomers()
      flash(`مبلغ خرید دستی «${c.name}» ذخیره شد.`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /** تغییر نوع مشتری (تکی ⇄ عمده) — مورد ۶ */
  const toggleCustomerKind = async (c: CustomerDirectoryRow) => {
    try {
      await call(CH.customerUpdate, { id: c.id, isWholesale: !c.isWholesale })
      await loadCustomers()
      flash(`«${c.name}» به مشتری ${!c.isWholesale ? 'عمده' : 'تکی'} تغییر کرد.`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /**
   * حذف مشتری: بار اول بدون `force` می‌رود. اگر فاکتور داشته باشد، سرویس حذف
   * نمی‌کند و فقط می‌گوید چند فاکتور به او وصل است (قاعده‌ی «هشدار، نه دیوار»)؛
   * با تایید کاربر، فاکتورها به «مشتری عمومی» منتقل و مشتری حذف می‌شود.
   */
  const removeCustomer = async (c: CustomerDirectoryRow, force = false) => {
    setCustBusy(true)
    try {
      const res = await call<CustomerDeleteResult>(CH.customerDelete, { id: c.id, force, panelPassword: force ? custDelPw : undefined })
      if (!res.deleted) {
        setDelCustomer(c)
        setDelMessage(res.message)
        return
      }
      setDelCustomer(null)
      setDelMessage('')
      if (custDraft.id === c.id) resetCustDraft()
      await loadCustomers()
      flash(res.message)
    } catch (e: any) {
      setDelCustomer(null)
      setErr(e.message)
    } finally {
      if (force) setCustDelPw('')
      setCustBusy(false)
    }
  }

  const copyPhones = async () => {
    const list = customers.map((c) => c.phone).filter(Boolean).join('\n')
    if (!list) return setErr('شماره‌ای برای کپی وجود ندارد.')
    try {
      await navigator.clipboard.writeText(list)
      flash(`${faDigits(customers.filter((c) => c.phone).length)} شماره در حافظه کپی شد.`)
    } catch {
      setErr('کپی در حافظه ممکن نشد.')
    }
  }

  /**
   * مورد ۸ — خروجی اکسل فهرست مشتریان.
   *
   * از همان مسیر خروجی گزارش‌های برنامه رد می‌شود (`system:exportExcel`): اول
   * پنجره‌ی «ذخیره به‌عنوان» ویندوز باز می‌شود و بعد یک فایل xlsx *واقعی* و
   * استاندارد ساخته می‌شود (ستون‌بندی درست، سرستون ثابت، مبالغ به‌صورت عدد)، نه
   * یک CSV با پسوند اکسل. شماره‌ها با ارقام لاتین نوشته می‌شوند تا در اکسل
   * قابل جستجو و کپی‌کردن برای پنل پیامک باشند.
   */
  const exportCustomers = async () => {
    if (!customers.length) return setErr('فهرست مشتریان خالی است؛ اول «تازه‌سازی» را بزنید.')
    try {
      const res = await exportTable({
        fileName: 'مشتریان-و-شماره-تلفن',
        sheetName: 'مشتریان',
        title:
          `فهرست مشتریان${onlyWithPhone ? ' (فقط دارای شماره تلفن)' : ''}` +
          `${customerSearch.trim() ? ` · جستجو: ${customerSearch.trim()}` : ''} · ${customers.length} مشتری`,
        headers: ['کد', 'نام', 'شماره تلفن', 'تعداد فاکتور', 'جمع خرید (ریال)', 'آخرین خرید', 'تاریخ ثبت'],
        rows: customers.map((c) => [
          c.code,
          c.name,
          c.phone ?? '',
          c.invoiceCount,
          c.totalBought,
          c.lastBuyJalali ?? '',
          c.createdAtJalali
        ]),
        totals: [
          'جمع',
          `${customers.length} مشتری`,
          `${customers.filter((c) => c.phone).length} شماره`,
          customers.reduce((sum, c) => sum + c.invoiceCount, 0),
          customers.reduce((sum, c) => sum + c.totalBought, 0),
          '',
          ''
        ]
      })
      if (res.canceled) return flash('خروجی اکسل لغو شد؛ فایلی ساخته نشد.')
      flash(`فایل اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /** خواندن فهرست کامل چاپگرها (فاز ۳). خطا ⇒ همان فهرست ساده، بدون شکستن صفحه. */
  const refreshPrintersDetailed = async () => {
    try {
      setPrinterList(await call<{ name: string; displayName: string; isDefault: boolean; kindGuess?: 'RECEIPT' | 'LABEL' | 'PAGE' | 'UNKNOWN' }[]>(CH.printersDetailed))
    } catch {
      setPrinterList([])
    }
  }

  /**
   * ذخیره‌ی فوری «چاپگر پیش‌فرض این بخش» — بدون رمز (تصمیم مالک برای فاز ۳).
   * اعتبارسنجی نام فقط در main انجام می‌شود؛ اگر نام پیدا نشود پیام فارسی می‌آید
   * و هیچ چاپگری عوض نمی‌شود.
   */
  const savePrinterDefault = async (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', printerName: string) => {
    setPrinterBusy(true)
    setPrinterMsg(null)
    try {
      await call(CH.printSetDefault, { profile, printerName })
      setPrinterMsg(`چاپگر «${printerName}» به‌عنوان پیش‌فرض ذخیره شد.`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPrinterBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      /**
       * نشست ۱۵۴ (S151-b) — سیاست تخفیف دیگر از ذخیره‌ی کلی فرستاده نمی‌شود؛ فقط
       * دکمه‌ی اختصاصی خودش (با رمز) آن را می‌نویسد. سرور هم تغییر discount از
       * این کانال را بی‌رمز رد می‌کند.
       */
      /**
       * نشست ۱۶۸ (S168-D1) — «چاپ فاکتور» و «برداشت خودکار از انبار مرکزی» اینجا ویرایش نمی‌شوند و
       * ممکن است بعد از بازشدن این صفحه از پنل فروش (با رمز پنل) عوض شده باشند. پیش از ذخیره مقدار تازه‌ی
       * سرور را می‌خوانیم تا مقدار کهنه‌ی صفحه نه بی‌صدا برگردد و نه ذخیره‌ی بی‌ربط به رمز پنل گیر کند.
       */
      const fresh = await call<{ sale: SaleDefaults; receipt: ReceiptTemplate; label: LabelTemplate }>(CH.settingsBundle)
      const saleToSave = mergeFreshPosToggles(sale, { ...DEFAULT_SALE_DEFAULTS, ...fresh.sale })
      /**
       * فاز ۳ — نام چاپگر را از نسخه‌ی *تازه‌ی* دیتابیس برمی‌داریم تا اگر کاربر
       * در پنجره‌ی انتخاب چاپگر «ذخیره به‌عنوان پیش‌فرض» زده، این ذخیره‌ی کهنه
       * آن انتخاب را برنگرداند (همان نقش mergeFreshPosToggles برای چاپگر).
       */
      const receiptToSave =
        receipt.printerName !== receiptPrinterAtLoad.current
          ? receipt // کاربر خودش روی همین صفحه چاپگر را عوض کرده ⇒ انتخاب صفحه ذخیره شود
          : mergeFreshPrinter(receipt, { ...DEFAULT_RECEIPT_TEMPLATE, ...fresh.receipt })
      const labelToSave =
        label.printerName !== labelPrinterAtLoad.current
          ? label
          : mergeFreshPrinter(label, { ...DEFAULT_LABEL_TEMPLATE, ...fresh.label })
      /**
       * ⚠️ این خط عمداً یک‌خطی و با همین کلیدها/ترتیب می‌ماند: تست
       * `fix-s168-settings-stale-pos-toggles` این payload را به‌صورت متن دقیق
       * بررسی می‌کند (قرارداد «صفحه‌ی کهنه نباید مقدار POS را برگرداند»).
       */
      await call(CH.settingsSaveBundle, { receipt: receiptToSave, sale: saleToSave, shift, label: labelToSave, security, time, managerPassword: bundlePw })
      receiptPrinterAtLoad.current = receiptToSave.printerName
      labelPrinterAtLoad.current = labelToSave.printerName
      setReceipt(receiptToSave)
      setLabel(labelToSave)
      setSale(saleToSave)
      setDirty(false)
      /**
       * بند ۳ — پنل‌های *باز* (پنل فروش، فاکتور عمده) با این رویداد تنظیماتشان را
       * همان لحظه تازه می‌کنند. بدون آن، فروشنده‌ای که پنل فروش را باز گذاشته تا
       * بستن و باز کردن صفحه با سیاست تخفیفِ کهنه کار می‌کرد.
       */
      broadcastSettingsChanged()
      flash('تنظیمات ذخیره شد و از همین حالا روی رسیدها و پنل فروش اعمال می‌شود.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBundlePw('')
      setBusy(false)
    }
  }

  /**
   * ذخیره‌ی *فوری* تنظیمات امنیتی (بخش ۲) — مثل سوییچ «شیفت بر اساس ساعت».
   * چرا جدا از دکمه‌ی کلی؟ چون تاثیرش امنیتی و رفتاری است: اگر مدیر عدد را عوض
   * کند و یادش برود ذخیره بزند، قفل با مقدار قدیمی کار می‌کند و این دقیقاً همان
   * چیزی است که نباید اتفاق بیفتد.
   */
  const saveSecurity = async () => {
    setSecurityBusy(true)
    setErr(null)
    try {
      const next = parseSecurityConfig(security)
      await call(CH.settingsSaveBundle, { security: next, managerPassword: securityPw })
      setSecurity(next)
      broadcastSettingsChanged()
      flash(
        `قفل خودکار بی‌کاری: ${faDigits(next.idleLockMinutes)} دقیقه. ` +
          (next.lockoutEnabled
            ? `قفل موقت رمز اشتباه: بعد از ${faDigits(next.maxAttempts)} بار، همان نقطه ${faDigits(
                next.lockMinutes
              )} دقیقه قفل می‌شود.`
            : 'قفل موقت رمز اشتباه خاموش است.')
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSecurityPw('')
      setSecurityBusy(false)
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * بند ۳ — ذخیره‌ی *فوری* سیاست تخفیف، دقیقاً به همان دلیل تنظیمات امنیتی:
   * این یک «قالب چاپ» نیست، یک **مجوز مالی** است. اگر مدیر سیاست را روی
   * «غیرفعال» بگذارد و یادش برود دکمه‌ی کلی ذخیره را بزند، فروشنده تا پایان شیفت
   * با سیاست قبلی تخفیف می‌دهد — یعنی همان چیزی که این بند برای بستنش نوشته شد.
   *
   * از کانال اختصاصی `discountPolicy:save` استفاده می‌کنیم (نه `saveBundle`) تا
   * فقط همین کلید نوشته شود و بقیه‌ی تنظیمات *ذخیره‌نشده‌ی* روی فرم به‌اشتباه
   * ثبت نشوند.
   * ---------------------------------------------------------------------------
   */
  const saveDiscount = async () => {
    setDiscountBusy(true)
    setErr(null)
    try {
      const next = await call<DiscountPolicy>(CH.discountPolicySave, { policy: discount, panelPassword: discountPw })
      const clean = parseDiscountPolicy(next ?? discount)
      setDiscount(clean)
      // پنل‌های باز (پنل فروش) همین لحظه سقف جدید را می‌خوانند
      broadcastSettingsChanged()
      flash('سیاست تخفیف ذخیره شد · ' + describeDiscountPolicy(clean))
    } catch (e: any) {
      setErr(e.message)
      // ذخیره نشد ⇒ مقدار واقعی سرور برگردد تا فرم دروغ نگوید
      await load()
    } finally {
      setDiscountBusy(false)
      setDiscountPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  /** یک تغییر روی فرم سیاست تخفیف (بدون ذخیره؛ ذخیره با دکمه‌ی خودش). */
  const setD = (patch: Partial<DiscountPolicy>) => setDiscount((p) => ({ ...p, ...patch }))

  /** تغییر رمز مدیریتی (رمز فعلی لازم است؛ رمز جدید دو بار وارد می‌شود). */
  const changePassword = async () => {
    const current = toLatinDigits(curPw).trim()
    const next = toLatinDigits(newPw).trim()
    const confirm = toLatinDigits(newPw2).trim()
    if (!current) return setErr('رمز فعلی را وارد کنید.')
    if (next.length < 4) return setErr('رمز جدید باید حداقل ۴ رقم/کاراکتر باشد.')
    if (next !== confirm) return setErr('رمز جدید و تکرارش یکی نیستند.')
    setPwBusy(true)
    setErr(null)
    try {
      await call(CH.managerChangePassword, { current, next })
      setCurPw('')
      setNewPw('')
      setNewPw2('')
      flash('رمز مدیریتی عوض شد. از این به بعد پنل تنظیمات، کالاها و فاکتور خرید با همین رمز جدید باز می‌شوند.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPwBusy(false)
    }
  }

  /**
   * Main-first: تا وقتی Main خروج را تأیید نکرده، صفحه ظاهراً «کارمند» نمی‌شود.
   * در خطا، hook پنل‌های حساس را fail-closed نگه می‌دارد و پیام همین صفحه دیده
   * می‌شود؛ حضانت و فروش جاری در هیچ‌حالتی دست‌کاری نمی‌شوند.
   */
  const exitManager = async () => {
    setErr(null)
    try {
      await logout()
      nav('/')
    } catch (error: any) {
      setErr(error?.message || 'خروج مدیر قابل تأیید نیست؛ دوباره تلاش کنید.')
    }
  }

  /** پیش‌نمایش بازه: چه فاکتورهایی حذف می‌شوند و در حالت «بله» چه چیزی برمی‌گردد. */
  const loadPurgePreview = useCallback(async () => {
    if (!isValidJalaliDate(purgeFrom) || !isValidJalaliDate(purgeTo))
      return setErr('بازه‌ی تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
    setPurgeBusy(true)
    setErr(null)
    try {
      const res = await call<SalesPurgePreview>(CH.salePurgePreview, { fromJalali: purgeFrom, toJalali: purgeTo })
      setPurge(res)
      setSelected([]) // انتخاب قبلی با تازه شدن فهرست پاک می‌شود
      if (!res.rows.length) setErr(`در بازه‌ی ${faDigits(purgeFrom)} تا ${faDigits(purgeTo)} هیچ فاکتور فروشی نیست.`)
    } catch (e: any) {
      setPurge(null)
      setErr(e.message)
    } finally {
      setPurgeBusy(false)
    }
  }, [purgeFrom, purgeTo])

  /**
   * حذف واقعی گزارشات بازه.
   * `restoreStock` همان پاسخ بله/خیرِ کاربر است و مستقیم به سرویس می‌رود؛ منطق
   * بازگرداندن موجودی از قبل آنجا نوشته شده.
   */
  const doPurge = useCallback(
    async (restoreStock: boolean) => {
      setAskRestore(false)
      setPurgeBusy(true)
      setErr(null)
      const onlySelected = purgeMode === 'selected' && selected.length > 0
      try {
        const res = await call<any>(CH.salePurge, {
          fromJalali: purgeFrom,
          toJalali: purgeTo,
          restoreStock,
          managerPassword: toLatinDigits(panelManagerPw).trim(),
          overrideReason: purgeReason.trim(),
          // مورد ۱: خالی = کل بازه (رفتار قبلی) · پرشده = فقط همین فاکتورها
          invoiceIds: onlySelected ? selected : null
        })
        setPanelManagerPw('')
        setSelected([])
        setSelPurge(null)
        flash(
          (onlySelected
            ? `${faDigits(res.voidedInvoices ?? res.deletedInvoices ?? 0)} فاکتور انتخاب‌شده باطل شد`
            : `گزارشات فروش بازه‌ی ${faDigits(res.fromJalali)} تا ${faDigits(res.toJalali)} باطل شد · ` +
              `${faDigits(res.voidedInvoices ?? res.deletedInvoices ?? 0)} فاکتور`) +
            ` · ${faDigits(res.voidedReturns ?? res.deletedReturns ?? 0)} برگشت از فروش · جمع ${money(res.grandTotal)} ریال · ` +
            (res.restoreStock
              ? `${faDigits(res.restoredQty)} عدد از ${faDigits(res.restoredVariants)} کالا به موجودی انبار برگشت`
              : 'موجودی انبار دست‌نخورده ماند') +
            /* §۸ (جلسه ۲۸) — اگر فاکتوری اعتبار خرید مصرف کرده بود، مصرفش برگشت خورد و باید دیده شود */
            (res.reversedCreditRedemptions
              ? `\n· ${faDigits(res.reversedCreditRedemptions)} مصرف «اعتبار خرید» برگشت خورد و مبلغش به همان اعتبارها بازگشت.`
              : '')
        )
        // فهرست همان بازه دوباره خوانده می‌شود تا ردیف‌های باقی‌مانده دیده شوند
        if (onlySelected) await loadPurgePreview()
        else setPurge(null)
      } catch (e: any) {
        setErr(e.message)
      } finally {
        setPurgeBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelManagerPw, purgeFrom, purgeReason, purgeTo, purgeMode, selected]
  )

  /** باز کردن پرسش حذف برای *کل بازه* (رفتار قبلی). */
  const askPurgeRange = () => {
    setPurgeMode('range')
    setSelPurge(null)
    setAskRestore(true)
  }

  /**
   * باز کردن پرسش حذف برای فاکتورهای تیک‌خورده (مورد ۱).
   * پیش‌نمایش همان بازه، ولی محدود به انتخاب: تعداد، جمع مبلغ، و اینکه با «بله»
   * چه تعدادی به انبار برمی‌گردد — تا قبل از حذف دقیقاً معلوم باشد.
   */
  const askPurgeSelected = async () => {
    if (!selected.length) return setErr('هیچ فاکتوری تیک نخورده است.')
    setPurgeBusy(true)
    setErr(null)
    try {
      const res = await call<SalesPurgePreview>(CH.salePurgePreview, {
        fromJalali: purgeFrom,
        toJalali: purgeTo,
        invoiceIds: selected
      })
      setSelPurge(res)
      setPurgeMode('selected')
      setAskRestore(true)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPurgeBusy(false)
    }
  }

  /** ردیف‌های نمایش‌داده‌شده‌ی جدول حذف (همان ۳۰۰ ردیف اول) */
  const purgeVisible = useMemo(() => purge?.rows.slice(0, 300) ?? [], [purge])
  const allVisibleSelected = purgeVisible.length > 0 && purgeVisible.every((r) => selected.includes(r.id))
  const toggleRow = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleAllVisible = () =>
    setSelected((p) =>
      allVisibleSelected ? p.filter((id) => !purgeVisible.some((r) => r.id === id)) : [...new Set([...p, ...purgeVisible.map((r) => r.id)])]
    )
  /** پیش‌نمایشی که در مودال پرسش نشان داده می‌شود (بازه یا انتخاب‌شده‌ها) */
  const purgeTarget = purgeMode === 'selected' ? selPurge : purge

  // ---------------- بکاپ و بازگردانی ----------------
  /** تنظیمات بکاپ خودکار: مسیر ذخیره‌سازی و بازه‌ی زمانی (مورد ۶) */
  const loadBackupConfig = useCallback(async () => {
    try {
      const c = await call<BackupConfigView>(CH.backupConfig)
      setBackupCfg(c)
      setBackupEvery(String(c.everyDays))
      setBackupKeep(String(c.keep))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  /** ذخیره‌ی بازه و تعداد نسخه‌ی بکاپ خودکار (مسیر با دکمه‌ی خودش انتخاب می‌شود) */
  const saveBackupConfig = async (patch: { autoDir?: string; everyDays?: number; keep?: number }) => {
    setBackupBusy(true)
    try {
      const c = await call<BackupConfigView>(CH.backupConfigSave, {
        ...patch,
        managerPassword: backupGatePw.trim() || undefined
      })
      setBackupCfg(c)
      setBackupEvery(String(c.everyDays))
      setBackupKeep(String(c.keep))
      flash(
        c.everyDays > 0
          ? `تنظیمات بکاپ خودکار ذخیره شد · هر ${faDigits(c.everyDays)} روز یک‌بار · مسیر: ${c.effectiveDir}`
          : 'بکاپ خودکار خاموش شد (بکاپ دستی و «تهیه بکاپ» مثل قبل کار می‌کنند).'
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  /** انتخاب پوشه‌ی بکاپ خودکار با پنجره‌ی ویندوز (مورد ۶) */
  const pickBackupDir = async () => {
    setBackupBusy(true)
    try {
      const res = await call<{ canceled: boolean; config: BackupConfigView }>(CH.backupPickDir, {
        managerPassword: backupGatePw.trim() || undefined
      })
      if (res.canceled) flash('مسیر عوض نشد.')
      else {
        setBackupCfg(res.config)
        flash(`از این به بعد بکاپ‌های خودکار در «${res.config.effectiveDir}» ذخیره می‌شوند.`)
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  /** «بکاپ فوری» در همان مسیر تنظیم‌شده، بدون پنجره‌ی ذخیره */
  const backupNow = async () => {
    setBackupBusy(true)
    try {
      const res = await call<{ path: string | null; size: number }>(CH.backupNow, {
        managerPassword: backupGatePw.trim() || undefined
      })
      await Promise.all([loadBackups(), loadBackupConfig()])
      flash(res.path ? `بکاپ گرفته شد (${fileSize(res.size)}):\n${res.path}` : 'بکاپ گرفته نشد.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  const loadBackups = useCallback(async () => {
    setBackupBusy(true)
    try {
      setBackups(await call<BackupEntry[]>(CH.backupList))
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }, [])

  /** «تهیه بکاپ»: پنجره‌ی ذخیره‌ی ویندوز باز می‌شود و مسیر را خودتان می‌دهید. */
  const createBackup = async () => {
    setBackupBusy(true)
    try {
      const res = await call<{ canceled: boolean; path: string | null; size: number }>(CH.backupCreate, {
        managerPassword: backupGatePw.trim() || undefined
      })
      if (res.canceled) flash('تهیه‌ی بکاپ لغو شد؛ هیچ فایلی ساخته نشد.')
      else flash(`بکاپ ساخته شد (${fileSize(res.size)}):\n${res.path}`)
      await loadBackups()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  /** انتخاب فایل بکاپ از دیسک و افزودنش به فهرست (بدون اعمال). */
  const importBackup = async () => {
    setBackupBusy(true)
    try {
      const res = await call<{ canceled: boolean; entry: BackupEntry | null }>(CH.backupImport)
      if (res.canceled) flash('فایلی انتخاب نشد.')
      else {
        await loadBackups()
        flash(
          `فایل «${res.entry?.fileName}» به فهرست اضافه شد` +
            (res.entry?.summary
              ? ` · ${faDigits(res.entry.summary.invoiceCount)} فاکتور` +
                (res.entry.summary.firstJalali
                  ? ` از ${faDigits(res.entry.summary.firstJalali)} تا ${faDigits(res.entry.summary.lastJalali ?? '')}`
                  : '')
              : '') +
            ' · برای اعمال، دکمه‌ی «بازگردانی» همان ردیف را بزنید.'
        )
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  /** اعمال بکاپ: جایگزینی کامل یا ادغام با داده‌ی فعلی. */
  const applyBackup = async (mode: 'replace' | 'merge') => {
    if (!applyTarget) return
    const entry = applyTarget
    const managerPassword = applyPassword.trim()
    setApplyTarget(null)
    setApplyPassword('')
    setBackupBusy(true)
    setMergeReport(null)
    try {
      const res = await call<{ mode: string; report?: MergeReport; safetyBackup?: string; willRestart?: boolean }>(
        CH.backupApply,
        // نشست ۱۸۱: رمز مدیر همراه درخواست می‌رود. تصمیم‌گیرنده همچنان
        // BackupService است؛ این فقط مقدار را می‌رساند.
        { id: entry.id, mode, managerPassword: managerPassword || undefined }
      )
      if (mode === 'merge' && res.report) {
        setMergeReport(res.report)
        const r = res.report
        flash(
          `ادغام «${entry.fileName}» انجام شد · ` +
            `${faDigits(r.inserted.saleInvoice ?? 0)} فاکتور فروش، ` +
            `${faDigits(r.inserted.saleInvoiceItem ?? 0)} قلم و ` +
            `${faDigits(r.inserted.productVariant ?? 0)} کالای جدید اضافه شد. ` +
            `داده‌ی قبلی شما دست‌نخورده است و گزارش‌ها از این به بعد هر دو را با هم نشان می‌دهند.`
        )
      } else {
        flash(
          `داده‌ی فعلی با بکاپ «${entry.fileName}» جایگزین شد و برنامه همین حالا دوباره باز می‌شود.\n` +
            `یک بکاپ ایمنی از وضعیت قبلی گرفته شد: ${res.safetyBackup ?? '—'}`
        )
      }
      await loadBackups()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  const forgetBackup = async (entry: BackupEntry) => {
    setBackupBusy(true)
    try {
      await call(CH.backupForget, { id: entry.id, managerPassword: backupGatePw.trim() || undefined })
      await loadBackups()
      flash(`«${entry.fileName}» از فهرست حذف شد.`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBackupBusy(false)
    }
  }

  // ---------------- سبک‌سازی ----------------
  const loadStats = useCallback(async () => {
    try {
      setStats(await call<DbStats>(CH.dbStats))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  const loadSlimPreview = async () => {
    if (!isValidJalaliDate(slimBefore)) return setErr('تاریخ مرز پاک‌سازی معتبر نیست (قالب صحیح: ۱۴۰۵/۰۱/۰۱)')
    setSlimBusy(true)
    setSlimResult(null)
    try {
      const res = await call<MaintenancePreview>(CH.maintenancePreview, { beforeJalali: slimBefore })
      setSlimPreview(res)
      setErr(null)
    } catch (e: any) {
      setSlimPreview(null)
      setErr(e.message)
    } finally {
      setSlimBusy(false)
    }
  }

  const runArchivePurge = async () => {
    setAskSlim(false)
    setSlimBusy(true)
    try {
      const res = await call<MaintenanceResult>(CH.maintenanceArchivePurge, {
        beforeJalali: slimBefore,
        backup: slimBackup,
        purgeAudit: slimAudit,
        // گیت main برای کل آرشیو و پاک‌سازی اجباری است، نه فقط لاگ.
        managerPassword: slimManagerPw
      })
      setSlimResult(res)
      setSlimPreview(null)
      setSlimManagerPw('')
      await Promise.all([loadStats(), loadBackups()])
      flash(
        `پاک‌سازی انجام شد · ${faDigits(res.saleInvoices)} فاکتور فروش، ${faDigits(
          res.purchaseInvoices
        )} فاکتور خرید · ${faDigits(res.stockMovements)} حرکت انبار قدیمی حفظ شد (دفتر append-only) · ` +
          `حجم فایل از ${fileSize(res.sizeBefore)} به ${fileSize(res.sizeAfter)} رسید` +
          (res.backupPath ? ` · بکاپ قبل از پاک‌سازی: ${res.backupPath}` : '') +
          // هشدار مرحله‌ی ردشده (مثلاً رمز مدیر نیامد) نباید بی‌صدا بماند
          (res.warnings?.length ? ` · ${res.warnings.join(' · ')}` : '')
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSlimBusy(false)
    }
  }

  const runVacuum = async () => {
    setSlimBusy(true)
    try {
      const res = await call<{ sizeBefore: number; sizeAfter: number }>(CH.maintenanceVacuum)
      await loadStats()
      flash(`فشرده‌سازی انجام شد · ${fileSize(res.sizeBefore)} ← ${fileSize(res.sizeAfter)}`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSlimBusy(false)
    }
  }

  /**
   * =========================================================================
   * جلسه ۱۸ · بند ۳ — «سیاست حسابداری» (شامل آستانه‌ی تخفیف غیرعادی).
   *
   * ⚠️ عمداً *جدا* از دکمه‌ی «ذخیره‌ی تنظیمات» بالای صفحه ذخیره می‌شود، چون
   * `settings:saveBundle` این کلید را نمی‌شناسد و اگر قاطی می‌شد باید آن سرویس
   * سالم عوض می‌شد. کانال اختصاصی‌اش (`settings:accountingPolicy:set`) از جلسه
   * ۱۴ ثبت‌شده و آماده بود.
   * =========================================================================
   */
  const loadPolicy = useCallback(async () => {
    try {
      setPolicy(parseAccountingPolicy(await call<AccountingPolicy>(CH.settingsAccountingPolicy)))
      setPolicyDirty(false)
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  const savePolicy = async () => {
    setPolicyBusy(true)
    try {
      const saved = await call<AccountingPolicy>(CH.settingsAccountingPolicySet, { policy, managerPassword: policyPw })
      setPolicy(parseAccountingPolicy(saved))
      setPolicyDirty(false)
      flash(
        'سیاست حسابداری ذخیره شد · آستانه‌ی تخفیف غیرعادی: ' +
          (saved.abnormalDiscountPercent > 0 ? `${faDigits(saved.abnormalDiscountPercent)}٪` : 'خاموش')
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPolicyBusy(false)
      setPolicyPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  /**
   * ---------------- جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی» ----------------
   * «بررسی ساعت سیستم» فقط ساعت و تاریخِ خوانده‌شده از کامپیوتر را (کنار ساعت
   * رسمیِ با افست) دوباره نشان می‌دهد و هیچ اینترنتی لازم ندارد.
   */
  const runTimeCheck = useCallback(async () => {
    setTimeBusy(true)
    try {
      setTimeCheck(await call<any>(CH.settingsTimeCheck))
      setTimeNow(new Date())
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setTimeBusy(false)
    }
  }, [])

  /** ذخیره‌ی فوری افست (مثل سوییچ شیفت، چون اثرش رفتاری است). */
  const saveOfficialTime = async () => {
    setTimeBusy(true)
    try {
      const offsetHours = Number(toLatinDigits(timeOffset).replace(/[^0-9.+-]/g, '')) || 0
      const next = await call<OfficialTimeConfig>(CH.settingsOfficialTimeSet, { offsetHours, managerPassword: timePw })
      setTime(next)
      setTimeOffset(String(next.offsetHours))
      await runTimeCheck()
      flash(
        next.offsetHours === 0
          ? 'افست دستی صفر شد: همه‌ی محاسبات ساعتی دقیقاً با ساعت خودِ کامپیوتر انجام می‌شود.'
          : `افست دستی ${next.offsetHours} ساعت ذخیره شد و از همین حالا روی تشخیص شیفت و گزارش‌های زمانی اعمال می‌شود.`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setTimePw('')
      setTimeBusy(false)
    }
  }

  // ---------------- جلسه ۱۸ · بند ۲ — کارمندان ----------------
  const loadStaff = useCallback(async () => {
    try {
      const res = await call<{
        rows: {
          id: number
          username: string
          name: string
          role: string
          roleLabel: string
          isActive: boolean
          hasCorrectionApprovalPassword?: boolean
        }[]
        activeUserId: number | null
      }>(CH.staffDirectory, {})
      setStaffRows(res?.rows ?? [])
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  const saveStaff = async () => {
    if (!staffDraft.name.trim()) return showStaffError('نام کارمند را وارد کنید.')
    // نام و نقش، رکورد پایه‌اند. داده‌های شغلی/هویتی/بانکی اختیاری‌اند، اما هر
    // مقداری که وارد شود در Main دوباره و مستقل از UI اعتبارسنجی می‌شود.
    if (staffDraft.employmentStatus === 'TERMINATED' && !staffDraft.employmentEndJalali.trim())
      return showStaffError('برای وضعیت «پایان همکاری»، تاریخ پایان همکاری لازم است.')
    setStaffBusy(true)
    setStaffError(null)
    try {
      /** یک IPC تراکنشی: User پایه و پروندهٔ محرمانه یا هر دو ثبت می‌شوند یا هیچ‌کدام. */
      await call(CH.staffPersonnelSaveComplete, {
        id: staffDraft.id,
        name: staffDraft.name.trim(),
        role: staffDraft.role,
        isActive: staffDraft.isActive,
        correctionApprovalPassword: staffCorrectionApprovalPw || undefined,
        jobTitle: staffDraft.jobTitle,
        phone: staffDraft.phone,
        nationalId: staffDraft.nationalId,
        employmentStartJalali: staffDraft.employmentStartJalali,
        employmentEndJalali: staffDraft.employmentEndJalali,
        employmentStatus: staffDraft.employmentStatus,
        bankName: staffDraft.bankName,
        bankAccountNo: staffDraft.bankAccountNo,
        bankIban: staffDraft.bankIban,
        bankAccountHolder: staffDraft.bankAccountHolder
      })
      setStaffDraft(blankStaffDraft())
      await loadStaff()
      flash(staffDraft.id ? 'اطلاعات کارمند ذخیره شد.' : 'کارمند ثبت شد؛ تکمیل پروندهٔ محرمانه را می‌توانید بعداً انجام دهید.')
    } catch (e: any) {
      showStaffError(e?.message ?? 'ثبت پروندهٔ کارمند انجام نشد.')
    } finally {
      setStaffBusy(false)
      setStaffCorrectionApprovalPw('')
    }
  }

  const editStaff = async (row: { id: number; name: string; role: string; isActive: boolean }) => {
    setStaffBusy(true)
    setStaffError(null)
    setErr(null)
    try {
      const result = await call<{ profile: Partial<StaffDraft> }>(CH.staffPersonnelGet, { userId: row.id })
      const p = result.profile
      setStaffDraft({
        id: row.id,
        name: row.name,
        role: row.role,
        isActive: row.isActive,
        jobTitle: p.jobTitle ?? '',
        phone: p.phone ?? '',
        nationalId: p.nationalId ?? '',
        employmentStartJalali: p.employmentStartJalali ?? '',
        employmentEndJalali: p.employmentEndJalali ?? '',
        employmentStatus: p.employmentStatus ?? 'ACTIVE',
        bankName: p.bankName ?? '',
        bankAccountNo: p.bankAccountNo ?? '',
        bankIban: p.bankIban ?? '',
        bankAccountHolder: p.bankAccountHolder ?? ''
      })
      /** فرم بالای جدول است. بدون این حرکت، کلیک «ویرایش» برای کاربری که پایین
       * فهرست است هیچ اثر ظاهری ندارد و به‌اشتباه خرابی دکمه برداشت می‌شود. */
      window.requestAnimationFrame(() => {
        staffFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        staffNameInputRef.current?.focus()
      })
    } catch (e: any) {
      showStaffError(e?.message ?? 'بازکردن پروندهٔ کارمند انجام نشد.')
    } finally {
      setStaffBusy(false)
    }
  }

  /**
   * ⚠️ جلسه ۱۹ — تابع «تعیین کارمند فعالِ پشت سیستم» حذف شد.
   * منبع «چه کسی پشت صندوق است» دیگر یک تنظیم سراسری نیست: کارمند هر سند از
   * **کارمند همان نشستِ صندوق** خوانده می‌شود (فرم «نشست»، بند ۳).
   */

  useEffect(() => {
    /** نشست مدیر منقضی/خارج شد: دادهٔ خامی که فقط برای فرم محرمانه خوانده شده
     * نباید در state زنده بماند تا در remount یا ورود بعدی نشان داده شود. */
    if (!isManager) {
      setStaffDraft(blankStaffDraft())
      setStaffRows([])
      setStaffCorrectionApprovalPw('')
      setStaffError(null)
      setLegacyShiftPlanReview(null)
    }
    if (!isManager && (tab === 'staff' || tab === 'custody')) {
      setTab('receipt')
      return
    }
    if (tab === 'backup') {
      void loadBackups()
      void loadBackupConfig()
    }
    if (tab === 'slim') void loadStats()
    if (tab === 'accounting') void loadPolicy()
    if (tab === 'time') {
      const t = window.setInterval(() => setTimeNow(new Date()), 1000)
      return () => window.clearInterval(t)
    }
    if (tab === 'staff' || (tab === 'shift' && isManager)) void loadStaff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isManager])

  const resetReceipt = () => {
    // نام چاپگر جزو «قالب» نیست؛ ریست قالب نباید آن را خالی کند (همان رفتار قبلِ ذخیره: چاپگر دست‌نخورده)
    setReceipt((p) => ({ ...DEFAULT_RECEIPT_TEMPLATE, printerName: p.printerName }))
    setDirty(true)
    flash('قالب رسید به حالت پیش‌فرض برگشت (برای اعمال، ذخیره کنید).')
  }

  const testPrint = async () => {
    try {
      await call(CH.printReceipt, {
        data: {
          receiptNo: 0,
          items: [{ name: 'کالای نمونه', qty: 1, unitPrice: 1000000, lineTotal: 1000000 }],
          goodsTotal: 1000000,
          grandTotal: 1000000,
          customerName: 'مشتری عمومی',
          customerCode: '1000',
          orderTypeLabel: 'داخلی',
          payments: [{ label: 'نقدی', amount: 1000000 }],
          returnCode: 'TEST12'
        },
        template: receipt,
        silent: false
      })
      flash('رسید آزمایشی به چاپگر فرستاده شد')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /**
   * نشست ۲۲۲ · فاز ۰ طرح چاپ — یک آزمایش از «آزمایش‌گر چاپ» را اجرا می‌کند.
   * فقط نتیجه را نشان می‌دهد؛ هیچ تنظیمی ذخیره یا عوض نمی‌شود.
   */
  const runDiagnose = async () => {
    setDiagBusy(true)
    setDiagResult(null)
    setErr(null)
    try {
      const res = await call<{
        mode: string
        modeTitle: string
        printed: boolean
        pageSizeLabel: string
        pages?: number
        expectedPages?: number
      }>(CH.printDiagnose, { ...diag })
      if (res.printed) {
        setDiagResult(
          `انجام شد (${res.modeTitle}) — اندازه‌ی ارسالی به چاپگر: ${res.pageSizeLabel}. ` +
            'حالا برگه را با خط‌کش اندازه بگیرید و نتیجه را در docs/print-diagnosis.md ثبت کنید.'
        )
      } else {
        setDiagResult(
          `بدون چاپ (${res.modeTitle}) — تعداد صفحه‌ی PDF: ${faDigits(res.pages ?? 0)} · تعداد مورد انتظار: ` +
            `${faDigits(res.expectedPages ?? 1)}. اگر بیشتر بود، Chromium صفحه‌ی خالی اضافه می‌سازد (فرضیه‌ی لیبل خالی).`
        )
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDiagBusy(false)
    }
  }

  const toggles: [FlagKey, string][] = useMemo(
    () => [
      ['showDateTime', 'تاریخ و ساعت'],
      ['showReceiptNo', 'شماره فیش'],
      ['showOrderType', 'نوع سفارش (داخلی / بیرون‌بر ...)'],
      ['showTable', 'شماره میز'],
      ['showCustomer', 'اشتراک و نام مشتری'],
      ['showCashier', 'نام فروشنده و شیفت'],
      ['showRowNumber', 'ستون ردیف'],
      ['showUnitPrice', 'ستون قیمت واحد'],
      ['showGoodsTotal', 'جمع کل'],
      ['showServiceCharge', 'حق سرویس'],
      ['showDiscount', 'تخفیف'],
      ['showTax', 'مالیات و عوارض'],
      ['showPayable', 'قابل پرداخت'],
      ['showPaid', 'مبلغ پرداختی (فاکتور عمده)'],
      ['showRemaining', 'مانده حساب (فاکتور عمده)'],
      ['showPaymentMethod', 'نحوه پرداخت'],
      ['showReturnCode', 'کد فاکتور (برای برگشت از فروش)'],
      ['showReturnBarcode', 'بارکد کد فاکتور (قابل اسکن)'],
      ['showReturnDeadline', 'نمایش مهلت برگشت روی فاکتور (خاموش = کد و بارکد و مهلت هیچ‌کدام چاپ نمی‌شوند)'],
      ['showPhone', 'تلفن فروشگاه'],
      ['showWebsite', 'نشانی سایت'],
      // بند ۷ (جلسه ۳۱) — §۱۳: بدون این تیک، `showLogo` پیش‌فرضِ خاموش می‌ماند و
      // کاربر هیچ راهی برای روشن کردن لوگوی سند اعتبار ندارد.
      ['showLogo', 'لوگوی فروشگاه (بالای سند اعتبار خرید)']
    ],
    []
  )

  const labels: [TextKey, string][] = useMemo(
    () => [
      ['receiptNoLabel', 'برچسب شماره فیش'],
      ['tableLabel', 'برچسب میز'],
      ['customerLabel', 'برچسب اشتراک'],
      ['goodsTotalLabel', 'برچسب جمع کل'],
      ['serviceChargeLabel', 'برچسب حق سرویس'],
      ['discountLabel', 'برچسب تخفیف'],
      ['taxLabel', 'برچسب مالیات و عوارض'],
      ['payableLabel', 'برچسب قابل پرداخت'],
      ['paidLabel', 'برچسب مبلغ پرداختی'],
      ['remainingLabel', 'برچسب مانده حساب'],
      ['paymentLabel', 'برچسب نحوه پرداخت'],
      ['returnCodeLabel', 'برچسب کد فاکتور']
    ],
    []
  )

  return (
    /* بند ۵ — `page` به‌جای `h-full`: پنل تنظیمات هم مثل بقیه‌ی ماژول‌ها به قدِ
       محتوایش باز می‌شود و با چرخ ماوس اسکرول می‌شود (نه اسکرول تودرتو). */
    <div className="page">
      {/* نوار تب‌ها و دکمه‌ی «ذخیره‌ی تنظیمات» چسبان است تا در جدول‌های بلند هم
          همیشه در دید بماند (وگرنه با اسکرول صفحه بالا می‌رفت). */}
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap sticky top-0 z-30">
        <h1 className="text-lg font-bold">تنظیمات</h1>
        <div className="flex gap-1 flex-wrap">
          <button className={`btn ${tab === 'receipt' ? 'btn-primary' : ''}`} onClick={() => setTab('receipt')}>
            قالب فاکتور چاپی
          </button>
          <button className={`btn ${tab === 'print' ? 'btn-primary' : ''}`} onClick={() => setTab('print')}>
            چاپ و چاپگر
          </button>
          <button className={`btn ${tab === 'sale' ? 'btn-primary' : ''}`} onClick={() => setTab('sale')}>
            فروش و کد فاکتور
          </button>
          <button className={`btn ${tab === 'shift' ? 'btn-primary' : ''}`} onClick={() => setTab('shift')}>
            شیفت‌ها
          </button>
          <button
            className={`btn ${tab === 'customers' ? 'btn-primary' : ''}`}
            onClick={() => {
              setTab('customers')
              void loadCustomers()
            }}
            title="بانک شماره مشتریان (برای پیامک تبلیغاتی)"
          >
            مشتریان
          </button>
          <button className={`btn ${tab === 'manager' ? 'btn-primary' : ''}`} onClick={() => setTab('manager')}>
            رمز مدیر و خروج
          </button>
          {/* بند ۳ — سیاست تخفیف پنل فروش (سقف اختیار فروشنده) */}
          <button
            className={`btn ${tab === 'discount' ? 'btn-primary' : ''}`}
            onClick={() => setTab('discount')}
            title="آزاد / فقط تخفیف ثابت مدیر / غیرفعال — سقف اختیار فروشنده در پنل فروش"
          >
            تخفیف
          </button>
          {/* ---------------- جلسه ۱۸ · بندهای ۲ و ۳ ---------------- */}
          <button
            className={`btn ${tab === 'accounting' ? 'btn-primary' : ''}`}
            onClick={() => setTab('accounting')}
            title="آستانه‌ی مغایرت صندوق، سقف اعتبار خرید، گیت قیمت دستی، قفل دوره‌ی بسته و آستانه‌ی تخفیف غیرعادی"
          >
            سیاست حسابداری
          </button>
          {isManager ? (
            <>
              <button
                className={`btn ${tab === 'staff' ? 'btn-primary' : ''}`}
                onClick={() => setTab('staff')}
                title="ثبت، ویرایش و غیرفعال‌سازی کارمندان فروشگاه — مبنای تب عملکرد کارمندان"
              >
                کارمندان
              </button>
              <button
                className={`btn ${tab === 'custody' ? 'btn-primary' : ''}`}
                onClick={() => setTab('custody')}
                title="پیکربندی کارکنانِ حضانت، برنامه‌ها و تنظیمات ساختاری صندوق"
              >
                حضانت صندوق
              </button>
            </>
          ) : null}
          {/* ---------------- جلسه ۱۹ · بند ۹ ---------------- */}
          <button
            className={`btn ${tab === 'time' ? 'btn-primary' : ''}`}
            onClick={() => {
              setTab('time')
              void runTimeCheck()
            }}
            title="ساعت و تاریخی که برنامه از کامپیوتر می‌خواند + افست دستی ساعت رسمی کشور"
          >
            تاریخ و ساعت رسمی
          </button>
          <button className={`btn ${tab === 'backup' ? 'btn-primary' : ''}`} onClick={() => setTab('backup')}>
            بکاپ و بازگردانی
          </button>
          <button className={`btn ${tab === 'slim' ? 'btn-primary' : ''}`} onClick={() => setTab('slim')}>
            سبک‌سازی
          </button>
          <button className={`btn ${tab === 'purge' ? 'btn-primary' : ''}`} onClick={() => setTab('purge')}>
            حذف گزارشات فروش
          </button>
        </div>
        <div className="ms-auto flex gap-1">
          {dirty && <span className="kbd text-amber-700 self-center font-bold">تغییرات ذخیره نشده</span>}
          <button className="btn" onClick={() => void load()} disabled={busy}>
            بازگردانی از دیتابیس
          </button>
          {/* نشست ۱۵۵ (S151-c1): فقط وقتی بخش فروش/شیفت/ساعت رسمی تغییر کرده لازم است؛ سرور می‌سنجد */}
          <div className="w-44" title="رمز مدیر — فقط اگر تنظیمات فروش، شیفت یا ساعت رسمی را تغییر داده‌اید">
            <PasswordField value={bundlePw} placeholder="رمز مدیر (بخش حساس)" onChange={(e) => setBundlePw(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره‌ی تنظیمات'}
          </button>
          <button className="btn btn-danger" onClick={exitManager} title="بازگشت به وضعیت کارمند و قفل شدن پنل‌های موجودی">
            خروج مدیر
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>
      </div>

      {(msg || err) && (
        <div
          className={`rounded px-3 py-2 border whitespace-pre-line ${
            err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          {err ?? msg}
        </div>
      )}

      <div className="grid grid-cols-12 gap-2 items-start">
        <div
          className={`col-span-12 ${
            /* مورد ۱ — فقط وقتی پیش‌نمایش دیده می‌شود، محتوا ۸ ستون است؛ وگرنه تمام عرض */
            showsPreview(tab) ? 'xl:col-span-8' : ''
          } bg-white rounded shadow p-3 space-y-4`}
        >
          {tab === 'receipt' && (
            <>
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">سرصفحه‌ی رسید</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="نام فروشگاه (تیتر رسید)">
                    <input className="inp" value={receipt.shopName} onChange={(e) => setR({ shopName: e.target.value })} />
                  </Field>
                  <Field label="تلفن">
                    <input className="inp" dir="ltr" value={receipt.phone} onChange={(e) => setR({ phone: e.target.value })} />
                  </Field>
                  <Field label="نشانی سایت">
                    <input className="inp" dir="ltr" value={receipt.website} onChange={(e) => setR({ website: e.target.value })} />
                  </Field>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">فیلدهای رسید (روشن / خاموش)</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {toggles.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={!!receipt[key]}
                        onChange={(e) => setFlag(key, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {/* بند ۷ (جلسه ۳۱) — ارتفاع لوگو. خودِ تصویر همان لوگوی آپلودشده در
                    «چاپ لیبل» است (یک بار آپلود، همه‌ی قالب‌ها) پس اینجا فقط
                    روشن/خاموش و ارتفاع تنظیم می‌شود. */}
                {receipt.showLogo && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Field label="ارتفاع لوگو روی سند (میلی‌متر)">
                      <input
                        type="number"
                        min={3}
                        max={40}
                        className="inp"
                        value={receipt.logoHeightMm}
                        onChange={(e) => setR({ logoHeightMm: Math.min(40, Math.max(3, +e.target.value || 10)) })}
                      />
                    </Field>
                    <div className="text-xs text-gray-600 self-end pb-2 md:col-span-2">
                      {receipt.logoDataUrl
                        ? 'تصویر لوگو از تنظیمات «چاپ لیبل» خوانده می‌شود (همان فایل آپلودشده).'
                        : 'هنوز لوگویی آپلود نشده است: از تب «چاپ لیبل» لوگو را آپلود کنید، وگرنه این تیک روی کاغذ اثری ندارد.'}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">پیام‌های پایانی رسید</h2>
                <div className="grid grid-cols-1 gap-2">
                  <Field label="پیام اول (داخل کادر)">
                    <input className="inp" value={receipt.footerLine1} onChange={(e) => setR({ footerLine1: e.target.value })} />
                  </Field>
                  <Field label="پیام دوم (داخل کادر)">
                    <input className="inp" value={receipt.footerLine2} onChange={(e) => setR({ footerLine2: e.target.value })} />
                  </Field>
                  <Field label="پیام سوم (اختیاری)">
                    <input className="inp" value={receipt.footerLine3} onChange={(e) => setR({ footerLine3: e.target.value })} />
                  </Field>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">برچسب‌ها</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {labels.map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        className="inp"
                        value={String(receipt[key] ?? '')}
                        onChange={(e) => setText(key, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </section>

              <div className="flex gap-2">
                <button className="btn" onClick={resetReceipt}>
                  بازگشت قالب به پیش‌فرض
                </button>
                <button className="btn" onClick={() => void testPrint()}>
                  چاپ رسید آزمایشی
                </button>
              </div>
            </>
          )}

          {tab === 'print' && (
            <section className="space-y-2">
              <h2 className="font-bold border-b pb-1">چاپ</h2>
              {/**
               * فاز ۳ — «حالت ساده»: فقط چاپگر و «بدون پرسش» برای هر سه کارت.
               * حالت پیشرفته پایین‌تر (پیش‌فرض بسته) برای تکنسین است.
               */}
              <PrinterCards
                receipt={receipt}
                label={label}
                setR={setR}
                setL={setL}
                printers={printerList}
                onRefresh={() => void refreshPrintersDetailed()}
                onSavePrinter={(profile, name) => void savePrinterDefault(profile, name)}
                busy={printerBusy}
                savedMsg={printerMsg}
              />
              <PrintAdvanced receipt={receipt} label={label} setR={setR} setL={setL} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="عرض کاغذ (میلی‌متر)">
                  <input
                    type="number"
                    min={50}
                    max={110}
                    className="inp"
                    value={receipt.paperWidthMm}
                    onChange={(e) => setR({ paperWidthMm: Math.min(110, Math.max(50, +e.target.value || 72)) })}
                  />
                </Field>
                <Field label="اندازه‌ی فونت (px)">
                  <input
                    type="number"
                    min={8}
                    max={20}
                    className="inp"
                    value={receipt.fontSizePx}
                    onChange={(e) => setR({ fontSizePx: Math.min(20, Math.max(8, +e.target.value || 12)) })}
                  />
                </Field>
                <Field label="تعداد نسخه">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className="inp"
                    value={receipt.copies}
                    onChange={(e) => setR({ copies: Math.min(5, Math.max(1, +e.target.value || 1)) })}
                  />
                </Field>
                <Field label="چاپگر پیش‌فرض رسید">
                  <select className="inp" value={receipt.printerName} onChange={(e) => setR({ printerName: e.target.value })}>
                    <option value="">(چاپگر پیش‌فرض ویندوز)</option>
                    {printers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={receipt.autoPrint}
                  onChange={(e) => setR({ autoPrint: e.target.checked })}
                />
                چاپ خودکار رسید بعد از ثبت فاکتور در پنل فروش تکی
              </label>
              <div className="kbd">
                اگر خاموش باشد، فاکتور ثبت می‌شود و دکمه‌ی «چاپ فاکتور» در پنل فروش برای چاپ دستی می‌ماند. با چک‌باکس
                «چاپ فاکتور» در خودِ پنل فروش تکی هم می‌توانید چاپ را کاملاً خاموش کنید (نه خودکار و نه دستی)؛ ثبت
                فاکتور در گزارشات فروش در هر حالت عادی انجام می‌شود.
              </div>

              {/* ==================== چاپ لیبل (مورد ۵ و ۸) ==================== */}
              <h2 className="font-bold border-b pb-1 pt-3">چاپ لیبل (برچسب کالا) — مستقل از فاکتور</h2>
              <div className="kbd leading-6">
                لیبل روی <b>دستگاه برچسب‌زن</b> چاپ می‌شود، نه روی چاپگر فاکتور؛ پس چاپگرش، ابعادش و اجزایش کاملاً جدا
                تنظیم می‌شوند و هیچ‌کدام از این مقدارها روی فاکتور اثر ندارند. پیش‌فرض = لیبل ۵ سانتی‌متر طول × ۳
                سانتی‌متر عرض با نام کالا، بارکد و قیمت (مطابق نمونه‌ی چسبان فروشگاه).
              </div>
              {/* ---------- قالب‌های آماده‌ی لیبل ---------- */}
              <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-2">
                <div className="font-bold">قالب آماده‌ی لیبل</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {LABEL_PRESETS.map((preset) => {
                    const active = label.activeTemplate === preset.key
                    return (
                      <button
                        key={preset.key}
                        className={`text-right border-2 rounded p-2 ${
                          active ? 'bg-emerald-50 border-emerald-400' : 'bg-white border-slate-300 hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          setLabel((cur) => applyLabelPreset(cur, preset.key))
                          setDirty(true)
                        }}
                      >
                        <div className="font-bold">
                          {preset.title}
                          {active ? <span className="kbd"> (فعال)</span> : null}
                        </div>
                        <div className="kbd">{preset.desc}</div>
                      </button>
                    )
                  })}
                </div>
                <div className="kbd leading-6">
                  قالب فقط یک «نقطه‌ی شروع» است: بعد از انتخابش همه‌ی گزینه‌های پایین را طبق سلیقه‌ی خودتان عوض کنید —
                  تنظیمات <b>هر قالب جدا</b> ذخیره می‌شود، پس با برگشتن به قالب قبلی، شخصی‌سازی‌اش سر جایش است.
                  <button
                    className="text-brand font-bold ms-2"
                    onClick={() => {
                      setLabel((cur) => resetLabelPreset(cur))
                      setDirty(true)
                    }}
                  >
                    بازگرداندن «{labelPresetOf(label.activeTemplate).title}» به حالت پیش‌فرض
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="چاپگر مخصوص لیبل">
                  <select className="inp" value={label.printerName} onChange={(e) => setL({ printerName: e.target.value })}>
                    <option value="">(چاپگر پیش‌فرض ویندوز)</option>
                    {printers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="طول لیبل (میلی‌متر)">
                  <input
                    type="number"
                    min={10}
                    max={200}
                    className="inp"
                    value={label.widthMm}
                    onChange={(e) => setL({ widthMm: Math.min(200, Math.max(10, +e.target.value || 50)) })}
                  />
                </Field>
                <Field label="عرض لیبل (میلی‌متر)">
                  <input
                    type="number"
                    min={10}
                    max={200}
                    className="inp"
                    value={label.heightMm}
                    onChange={(e) => setL({ heightMm: Math.min(200, Math.max(10, +e.target.value || 30)) })}
                  />
                </Field>
                <Field label="ارتفاع بارکد (میلی‌متر)">
                  <input
                    type="number"
                    min={4}
                    max={100}
                    className="inp"
                    value={label.barcodeHeightMm}
                    onChange={(e) => setL({ barcodeHeightMm: Math.min(100, Math.max(4, +e.target.value || 13)) })}
                  />
                </Field>
                <Field label="اندازه‌ی فونت اسم (px)">
                  <input
                    type="number"
                    min={5}
                    max={24}
                    className="inp"
                    value={label.nameFontPx}
                    onChange={(e) => setL({ nameFontPx: Math.min(24, Math.max(5, +e.target.value || 9)) })}
                  />
                </Field>
                <Field label="اندازه‌ی فونت قیمت (px)">
                  <input
                    type="number"
                    min={5}
                    max={24}
                    className="inp"
                    value={label.priceFontPx}
                    onChange={(e) => setL({ priceFontPx: Math.min(24, Math.max(5, +e.target.value || 10)) })}
                  />
                </Field>
                <Field label="حاشیه‌ی داخلی لیبل (میلی‌متر)">
                  <input
                    type="number"
                    min={0}
                    max={20}
                    className="inp"
                    value={label.gapMm}
                    onChange={(e) => setL({ gapMm: Math.min(20, Math.max(0, +e.target.value || 0)) })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                <label className="flex items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={label.showName}
                    onChange={(e) => setL({ showName: e.target.checked })}
                  />
                  اسم کالا روی لیبل چاپ شود
                  <span className="kbd">خاموش = لیبل بدون اسم (فقط بارکد و قیمت)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={label.showPrice}
                    onChange={(e) => setL({ showPrice: e.target.checked })}
                  />
                  قیمت روی لیبل چاپ شود
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={label.showCode}
                    onChange={(e) => setL({ showCode: e.target.checked })}
                  />
                  کد کالا هم روی لیبل چاپ شود
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={label.showBarcodeText}
                    onChange={(e) => setL({ showBarcodeText: e.target.checked })}
                  />
                  ارقام بارکد زیر خطوط چاپ شوند
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={label.autoPrint}
                    /**
                     * نشست ۲۲۲ · فاز ۲ — `askEachTime` منبع حقیقت است و
                     * `autoPrint` از آن مشتق می‌شود؛ پس این تیک هر دو را با هم
                     * عوض می‌کند وگرنه مقدار تازه در ذخیره‌ی بعدی بی‌صدا برمی‌گشت.
                     */
                    onChange={(e) => setL({ autoPrint: e.target.checked, askEachTime: !e.target.checked })}
                  />
                  چاپ بی‌درنگ روی چاپگر لیبل (بدون پنجره‌ی چاپ ویندوز)
                </label>
              </div>
              {/* ---------- برند و لوگوی فروشگاه روی لیبل ---------- */}
              <div className="bg-white border border-slate-200 rounded p-2 space-y-2">
                <div className="font-bold">نام برند و لوگوی فروشگاه روی لیبل</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  <label className="flex items-center gap-2 font-bold">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={label.showBrand}
                      onChange={(e) => setL({ showBrand: e.target.checked })}
                    />
                    نام برند فروشگاه روی لیبل چاپ شود
                  </label>
                  <label className="flex items-center gap-2 font-bold">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={label.showLogo}
                      onChange={(e) => setL({ showLogo: e.target.checked })}
                    />
                    لوگوی تصویری روی لیبل چاپ شود
                  </label>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Field label="متن برند">
                    <input
                      className="inp"
                      value={label.brandName}
                      placeholder={receipt.shopName || 'نام فروشگاه'}
                      onChange={(e) => setL({ brandName: e.target.value })}
                    />
                  </Field>
                  <Field label="اندازه‌ی فونت برند (px)">
                    <input
                      type="number"
                      min={5}
                      max={28}
                      className="inp"
                      value={label.brandFontPx}
                      onChange={(e) => setL({ brandFontPx: Math.min(28, Math.max(5, +e.target.value || 10)) })}
                    />
                  </Field>
                  <Field label="محل برند روی لیبل">
                    <select
                      className="inp"
                      value={label.brandPosition}
                      onChange={(e) => setL({ brandPosition: e.target.value === 'BOTTOM' ? 'BOTTOM' : 'TOP' })}
                    >
                      <option value="TOP">بالای لیبل</option>
                      <option value="BOTTOM">پایین لیبل</option>
                    </select>
                  </Field>
                  <Field label="چیدمان متن‌ها">
                    <select
                      className="inp"
                      value={label.align}
                      onChange={(e) => setL({ align: e.target.value === 'RIGHT' ? 'RIGHT' : 'CENTER' })}
                    >
                      <option value="CENTER">وسط‌چین</option>
                      <option value="RIGHT">راست‌چین</option>
                    </select>
                  </Field>
                  <Field label="ارتفاع لوگو (میلی‌متر)">
                    <input
                      type="number"
                      min={2}
                      max={60}
                      className="inp"
                      value={label.logoHeightMm}
                      onChange={(e) => setL({ logoHeightMm: Math.min(60, Math.max(2, +e.target.value || 7)) })}
                    />
                  </Field>
                  <div className="md:col-span-3">
                    <div className="mb-1">فایل لوگو</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="text-xs"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (!file) return
                          if (file.size > 512 * 1024) {
                            setErr('حجم فایل لوگو بیشتر از ۵۱۲ کیلوبایت است؛ یک تصویر کوچک‌تر (مثلاً PNG کم‌حجم) انتخاب کنید.')
                            return
                          }
                          const reader = new FileReader()
                          reader.onload = () => {
                            setL({ logoDataUrl: String(reader.result ?? ''), showLogo: true })
                            setErr(null)
                            flash('لوگو انتخاب شد؛ با «ذخیره‌ی تنظیمات» ثبت می‌شود (پیش‌نمایش لیبل همین حالا نشانش می‌دهد).')
                          }
                          reader.onerror = () => setErr('خواندن فایل لوگو ناموفق بود؛ فایل دیگری را امتحان کنید.')
                          reader.readAsDataURL(file)
                        }}
                      />
                      {label.logoDataUrl ? (
                        <>
                          <img src={label.logoDataUrl} alt="لوگو" className="h-8 border border-slate-200 rounded bg-white" />
                          <button className="btn py-1" onClick={() => setL({ logoDataUrl: '', showLogo: false })}>
                            حذف لوگو
                          </button>
                        </>
                      ) : (
                        <span className="kbd">لوگویی انتخاب نشده است</span>
                      )}
                    </div>
                    <div className="kbd">
                      خالی گذاشتن «متن برند» یعنی همان نام فروشگاه قالب رسید ({receipt.shopName || '—'}) چاپ شود. برند
                      مؤثر فعلی: <b>{resolveLabelBrand(label, receipt.shopName) || '—'}</b>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kbd leading-6">
                این مقدارها با دکمه‌ی «ذخیره‌ی تنظیمات» ذخیره می‌شوند و از همان لحظه در پنجره‌ی «چاپ لیبل / بارکد» پنل
                کالاها اعمال می‌گردند (پیش‌نمایش همان‌جا با همین ابعاد ساخته می‌شود). هر لیبل روی یک برچسب جدا چاپ
                می‌شود.
              </div>

              {/* ==================== آزمایش‌گر چاپ (فاز ۰ طرح چاپ — ابزار فنی) ==================== */}
              <details className="bg-slate-50 border border-slate-200 rounded p-2 mt-3">
                <summary className="font-bold cursor-pointer">آزمایش‌گر چاپ (فنی) — اندازه‌ی کاغذ</summary>
                <div className="kbd leading-6 mt-1">
                  این ابزار یک «برگه‌ی اندازه‌گیری» به چاپگر می‌فرستد تا معلوم شود درایور چه اندازه‌ای را می‌پذیرد؛
                  نتیجه‌ی هر آزمایش را در فایل <b>docs/print-diagnosis.md</b> ثبت کنید. این بخش هیچ‌کدام از تنظیمات
                  بالا را عوض یا ذخیره نمی‌کند.
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  <Field label="آزمایش">
                    <select
                      className="inp"
                      value={diag.mode}
                      onChange={(e) => {
                        const info = diagnoseModeInfo(e.target.value)
                        setDiag((cur) => ({ ...cur, mode: info.mode, ...info.defaults }))
                        setDiagResult(null)
                      }}
                    >
                      {DIAGNOSE_MODES.map((m) => (
                        <option key={m.mode} value={m.mode}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="چاپگر">
                    <select
                      className="inp"
                      value={diag.deviceName}
                      onChange={(e) => setDiag((cur) => ({ ...cur, deviceName: e.target.value }))}
                    >
                      <option value="">(چاپگر پیش‌فرض ویندوز)</option>
                      {printers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="عرض کاغذ (میلی‌متر)">
                    <input
                      type="number"
                      min={10}
                      max={600}
                      className="inp"
                      value={diag.widthMm}
                      onChange={(e) => setDiag((cur) => ({ ...cur, widthMm: Math.min(600, Math.max(10, +e.target.value || 80)) }))}
                    />
                  </Field>
                  <Field label="ارتفاع کاغذ (میلی‌متر)">
                    <input
                      type="number"
                      min={10}
                      max={2000}
                      className="inp"
                      value={diag.heightMm}
                      onChange={(e) => setDiag((cur) => ({ ...cur, heightMm: Math.min(2000, Math.max(10, +e.target.value || 140)) }))}
                    />
                  </Field>
                  <Field label="تعداد ستون (لیبل)">
                    <input
                      type="number"
                      min={1}
                      max={3}
                      className="inp"
                      value={diag.columns}
                      onChange={(e) => setDiag((cur) => ({ ...cur, columns: Math.min(3, Math.max(1, +e.target.value || 1)) }))}
                    />
                  </Field>
                  <Field label="فاصله‌ی افقی ستون‌ها (میلی‌متر)">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      className="inp"
                      value={diag.gapXMm}
                      onChange={(e) => setDiag((cur) => ({ ...cur, gapXMm: Math.min(20, Math.max(0, +e.target.value || 0)) }))}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 font-bold mt-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={diag.silent}
                    onChange={(e) => setDiag((cur) => ({ ...cur, silent: e.target.checked }))}
                  />
                  بی‌صدا روی چاپگر انتخاب‌شده چاپ کن (بدون دیالوگ ویندوز)
                </label>
                <div className="kbd mt-1">{diagnoseModeInfo(diag.mode).hint}</div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button className="btn btn-primary" onClick={() => void runDiagnose()} disabled={diagBusy}>
                    {diagBusy ? 'در حال اجرا…' : diag.mode === 'D' ? 'شمارش صفحه (بدون چاپ)' : 'چاپ برگه‌ی آزمایش'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => setDiag((cur) => ({ ...cur, ...diagnoseModeInfo(cur.mode).defaults }))}
                  >
                    مقادیر پیشنهادی این آزمایش
                  </button>
                </div>
                {diagResult && <div className="kbd mt-2 text-emerald-700">{diagResult}</div>}
              </details>
            </section>
          )}

          {tab === 'sale' && (
            <>
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">پیش‌فرض‌های فروش</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <Field label="نام فروشنده روی رسید">
                    <input className="inp" value={sale.cashierName} onChange={(e) => setS({ cashierName: e.target.value })} />
                  </Field>
                </div>
                <label className="flex items-start gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4"
                    checked={sale.debtPaymentReceiptPrint === true}
                    onChange={(e) => setS({ debtPaymentReceiptPrint: e.target.checked })}
                  />
                  <span>
                    <div className="font-bold">بعد از ثبت وصول نسیه، فیش پرداخت برای مشتری چاپ شود</div>
                    <div className="kbd leading-6">
                      پیش‌فرض خاموش است: فروشنده پرداخت را مثل امروز ثبت می‌کند و تمام. اگر روشن باشد، بعد از ثبت موفق
                      فیش مبلغ همین پرداخت و باقی‌مانده چاپ می‌شود. اگر چاپگر کار نکرد، پرداخت سر جایش می‌ماند.
                    </div>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4"
                    checked={sale.splitStoreCreditPayment !== false}
                    onChange={(e) => setS({ splitStoreCreditPayment: e.target.checked })}
                  />
                  <span>
                    <div className="font-bold">پرداخت ترکیبی اعتبار خرید در پنل فروش فعال باشد</div>
                    <div className="kbd leading-6">
                      روشن: فروشنده می‌تواند مشخص کند چه مقدار از اعتبار خرید مصرف و باقی فاکتور نقدی یا کارتی دریافت شود.
                      خاموش: اعتبار معتبر فقط تا سقف مجاز کامل مصرف می‌شود. این محدودیت در سرور هم اعمال می‌شود.
                    </div>
                  </span>
                </label>
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">عوارض و مالیات · حق سرویس</h2>
                <div className="kbd leading-6">
                  این دو دیگر «یک درصد سراسری که هر بار دستی وارد می‌کردید» نیستند: مقدارشان بر اساس *دسته‌بندی کالا*
                  (با ارث‌بری از دسته‌ی بالاتر) تعیین می‌شود و خودکار روی هر ردیف فاکتور اعمال می‌گردد — و تنظیمات
                  «پنل فروش خرد» و «فاکتور فروش عمده» کاملاً از هم مستقل‌اند. مقدار قدیمی شما به‌صورت «مقدار پیش‌فرض
                  همه‌ی کالاها» به همین سیستم منتقل شد. در خودِ فاکتور هم با دکمه‌ی «دستی» می‌توانید مبلغ را برای همان
                  یک فاکتور override کنید.
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {CHARGE_SCOPES.map((sc) =>
                    CHARGE_KINDS.map((kd) => (
                      <button
                        key={`${kd}-${sc}`}
                        className="btn"
                        onClick={() => nav(`/charges/${kd}/${sc}`)}
                        title={`${CHARGE_KIND_LABELS[kd]} برای ${CHARGE_SCOPE_LABELS[sc]}`}
                      >
                        {CHARGE_KIND_LABELS[kd]} · {CHARGE_SCOPE_LABELS[sc]}
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">کد فاکتور (برگشت از فروش)</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <Field label="طول کد (کاراکتر)">
                    <input
                      type="number"
                      min={4}
                      max={12}
                      className="inp"
                      value={sale.returnCodeLength}
                      onChange={(e) => setS({ returnCodeLength: Math.min(12, Math.max(4, +e.target.value || 6)) })}
                    />
                  </Field>
                  <Field label="مهلت برگشت — حالت عادی (روز)">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="inp"
                      value={sale.returnCodeDays}
                      onChange={(e) => setS({ returnCodeDays: Math.min(365, Math.max(1, +e.target.value || 7)) })}
                    />
                  </Field>
                  <Field label="مهلت برگشت — مشتری راه دور (روز)">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="inp"
                      value={sale.returnCodeDaysRemote}
                      onChange={(e) => setS({ returnCodeDaysRemote: Math.min(365, Math.max(1, +e.target.value || 14)) })}
                    />
                  </Field>
                </div>
                <div className="kbd">
                  «مشتری راه دور» یک مهلت مستقل و بلندتر است (پیش‌فرض ۱۴ روز): کارمند در پنل فروش چک‌باکس «مشتری راه
                  دور» را می‌زند و مهلت برگشت همان فاکتور از این عدد حساب می‌شود، نه از مهلت عادی. با چک‌باکس «نمایش
                  مهلت برگشت روی فاکتور» در تب «قالب فاکتور چاپی» هم می‌توانید کل بلوک برگشت (کد، بارکد و مهلت) را از
                  رسید بردارید — برای فروشگاهی که مرجوعی قبول نمی‌کند. کد همچنان داخل سیستم ساخته می‌شود، پس اگر بعداً
                  نظرتان عوض شد فاکتورهای همان بازه هم قابل برگشت‌اند. <b>این مهلت فقط مهلت کد/فرایند برگشت فاکتور است؛
                  مدت اعتبار خرید را از «مدیریت اعتبار خرید → قواعد پیش‌فرض» تنظیم کنید.</b>
                </div>
                {/* ---------- مورد ۷: همان تنظیمات، برای فاکتور فروش عمده ---------- */}
                <div className="border-2 border-emerald-300 rounded p-2 space-y-2 bg-emerald-50/40">
                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={sale.wholesaleReturnCode}
                      onChange={(e) => setS({ wholesaleReturnCode: e.target.checked })}
                    />
                    کد فاکتور و مهلت برگشت برای «فاکتور فروش عمده» هم صادر شود
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <Field label="طول کد فاکتور عمده (کاراکتر)">
                      <input
                        type="number"
                        min={4}
                        max={12}
                        className="inp"
                        disabled={!sale.wholesaleReturnCode}
                        value={sale.wholesaleReturnCodeLength}
                        onChange={(e) =>
                          setS({ wholesaleReturnCodeLength: Math.min(12, Math.max(4, +e.target.value || 6)) })
                        }
                      />
                    </Field>
                    <Field label="مهلت برگشت عمده — حالت عادی (روز)">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        className="inp"
                        disabled={!sale.wholesaleReturnCode}
                        value={sale.wholesaleReturnCodeDays}
                        onChange={(e) =>
                          setS({ wholesaleReturnCodeDays: Math.min(365, Math.max(1, +e.target.value || 7)) })
                        }
                      />
                    </Field>
                    <Field label="مهلت برگشت عمده — مشتری راه دور (روز)">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        className="inp"
                        disabled={!sale.wholesaleReturnCode}
                        value={sale.wholesaleReturnCodeDaysRemote}
                        onChange={(e) =>
                          setS({ wholesaleReturnCodeDaysRemote: Math.min(365, Math.max(1, +e.target.value || 14)) })
                        }
                      />
                    </Field>
                  </div>
                  <div className="kbd leading-6">
                    این سه عدد <b>کاملاً مستقل</b> از اعداد بالا (فروش تکی) هستند: با روشن بودن این گزینه، هر فاکتور
                    فروش عمده هم یک کد رندوم می‌گیرد که روی رسید به‌صورت متن و بارکد چاپ می‌شود و در پنل «برگشت از
                    فروش» با اسکن همان بارکد پیدا می‌گردد — دقیقاً همان منطقی که الان برای پنل فروش تکی کار می‌کند. در
                    خودِ پنل فاکتور فروش عمده هم چک‌باکس «مشتری راه دور» هست تا مهلت بلندتر روی همان فاکتور اعمال شود.
                    فاکتورهای عمده‌ی قدیمی که کد نداشتند، با اولین ویرایش کد می‌گیرند.
                  </div>
                </div>

                <div className="kbd">
                  هر فاکتور فروش تکی یک کد رندوم (حروف + عدد) می‌گیرد که روی رسید به‌صورت متن و بارکد چاپ می‌شود.
                  یکتایی کد فقط در بازه‌ی اعتبار تضمین می‌شود؛ بعد از انقضا همان کد می‌تواند برای فاکتور جدیدی تولید
                  شود. پیش‌فرض ۷ روز است.
                </div>
              </section>
            </>
          )}

          {tab === 'manager' && (
            <>
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">تغییر رمز مدیریتی</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="رمز فعلی">
                    <PasswordField value={curPw} onChange={(e) => setCurPw(e.target.value)} />
                  </Field>
                  <Field label="رمز جدید">
                    <PasswordField value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  </Field>
                  <Field label="تکرار رمز جدید">
                    <PasswordField value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
                  </Field>
                </div>
                <button className="btn btn-primary" onClick={() => void changePassword()} disabled={pwBusy}>
                  {pwBusy ? 'در حال تغییر…' : 'تغییر رمز'}
                </button>
                <div className="kbd leading-6">
                  رمز اولیه‌ی برنامه ۱۱۱۱ است (اگر قبلاً رمز را عوض کرده‌اید، همان رمز خودتان معتبر است). رمز به‌صورت هش‌شده ذخیره می‌شود و هیچ‌جا خام نگه داشته نمی‌شود.
                  همین یک رمز، قفل پنل تنظیمات و پنل کالاها و پنل فاکتور خرید است.
                </div>
              </section>

              {/* ============ بخش ۲ — قفل موقت بعد از رمز اشتباه ============ */}
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">رمز و امنیت — قفل موقت بعد از رمز اشتباه</h2>
                <div className="kbd leading-6">
                  <b>قفل خودکار بی‌کاری (بند ۴-۴۰):</b> اگر مدیر یا فروشنده‌ی دارای رمز دوم، به مدت تعیین‌شده
                  (پیش‌فرض ۵ دقیقه) با سیستم کار نکند، نشست قفل‌دار بسته می‌شود تا صفحه برای نفر بعدی باز نماند.
                  همین عدد سمت سرور هم برای کانال‌های خواندنی اعمال می‌شود.
                  <br />
                  اگر روی یک نقطه‌ی ورود رمز (صفحه‌ی رمز مدیر، یا هر پنل قفل‌دار) چند بار پشت‌سرهم رمز اشتباه وارد شود،
                  <b> همان نقطه</b> برای مدت تعیین‌شده قفل می‌شود و تا پایان آن مدت <b>حتی رمز درست هم پذیرفته نمی‌شود</b>.
                  شمارنده و زمان پایان قفل روی دیتابیس ذخیره می‌شوند، پس بستن و باز کردن برنامه قفل را دور نمی‌زند. هر
                  گیت شمارنده‌ی جدا دارد: رمز اشتباه روی «کالاها» باعث قفل شدن «بستن صندوق» نمی‌شود.
                </div>
                <label
                  className={`flex items-center gap-2 font-bold cursor-pointer rounded p-2 border-2 ${
                    security.lockoutEnabled ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={security.lockoutEnabled}
                    onChange={(e) => setSecurity((c) => ({ ...c, lockoutEnabled: e.target.checked }))}
                  />
                  فعال‌کردن قفل موقت
                  <span className="kbd font-normal">
                    {security.lockoutEnabled ? 'روشن (پیش‌فرض برنامه)' : 'خاموش = رفتار نسخه‌های قبل، بدون هیچ قفلی'}
                  </span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="قفل خودکار بی‌کاری (دقیقه، ۱ تا ۱۴۴۰)">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      className="inp text-center"
                      value={security.idleLockMinutes}
                      onChange={(e) =>
                        setSecurity((c) => ({ ...c, idleLockMinutes: Math.round(+e.target.value || 0) }))
                      }
                    />
                  </Field>
                  <Field label="حداکثر تلاش ناموفق (۱ تا ۲۰)">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className="inp text-center"
                      disabled={!security.lockoutEnabled}
                      value={security.maxAttempts}
                      onChange={(e) => setSecurity((c) => ({ ...c, maxAttempts: Math.round(+e.target.value || 0) }))}
                    />
                  </Field>
                  <Field label="مدت قفل به دقیقه (۱ تا ۱۴۴۰)">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      className="inp text-center"
                      disabled={!security.lockoutEnabled}
                      value={security.lockMinutes}
                      onChange={(e) => setSecurity((c) => ({ ...c, lockMinutes: Math.round(+e.target.value || 0) }))}
                    />
                  </Field>
                  <Field label="رمز مدیر (تغییر تنظیمات امنیتی)">
                    <PasswordField value={securityPw} onChange={(e) => setSecurityPw(e.target.value)} />
                  </Field>
                  <div className="flex items-end">
                    <button
                      className="btn btn-primary w-full"
                      onClick={() => void saveSecurity()}
                      disabled={securityBusy || !securityPw.trim()}
                    >
                      {securityBusy ? 'در حال ذخیره…' : 'ذخیره‌ی تنظیمات امنیتی'}
                    </button>
                  </div>
                </div>
                <div className="kbd leading-6">
                  وضعیت فعلی: قفل بی‌کاری <b>{faDigits(security.idleLockMinutes)} دقیقه</b>
                  {' · '}
                  {security.lockoutEnabled ? (
                    <b>
                      {faDigits(security.maxAttempts)} رمز اشتباه پشت‌سرهم ⇒ {faDigits(security.lockMinutes)} دقیقه قفل
                    </b>
                  ) : (
                    <b>قفل موقت رمز اشتباه خاموش است</b>
                  )}
                  . عددهای بی‌معنا خودکار به بازه‌ی مجاز اصلاح می‌شوند، پس هیچ‌وقت برنامه با یک عدد اشتباه برای همیشه
                  قفل نمی‌شود. صفحه‌ی ورود رمز، ثانیه‌های باقی‌مانده‌ی قفل را به‌صورت شمارش معکوس نشان می‌دهد.
                  <b> این بخش با همین دکمه، همان لحظه ذخیره می‌شود</b> (نیازی به دکمه‌ی «ذخیره‌ی تنظیمات» بالا نیست).
                </div>
              </section>

              {/* ============ بند ۱ — قفل رمز دوم به‌صورت ماژولار ============ */}
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">رمز — قفل ماژول‌ها (روشن / خاموش کردن قفل هر بخش)</h2>
                <div className="kbd leading-6">
                  پیش‌فرض برنامه این است که <b>همه‌ی ماژول‌های حساس قفل‌اند</b>. در این بخش می‌توانید — به‌عنوان مدیر —
                  برای هر ماژول جداگانه قفل رمز دوم را <b>خاموش</b> کنید؛ مثلاً فروشگاهی که فقط خودتان پشت سیستم
                  هستید و نمی‌خواهید هر بار برای «گزارشات فروش» رمز بزنید.
                  <br />
                  قفلِ خاموش یعنی آن ماژول <b>بدون هیچ رمزی</b> باز می‌شود. رمز دوم اختصاصی همان ماژول (بخش پایین) پاک
                  نمی‌شود و اگر قفل را دوباره روشن کنید، همان رمز قبلی کار می‌کند.
                  <br />
                  <b>تغییر این بخش «رمز مدیر» می‌خواهد</b> (نه رمز دوم پنل تنظیمات) و هر تغییر همان لحظه ذخیره می‌شود.
                  پنل «تنظیمات» عمداً در فهرست نیست: بازگردانی بکاپ، حذف گزارشات و سبک‌سازی دیتابیس داخل همین پنل است،
                  پس قفلش قابل برداشتن نیست.
                </div>
                <div className="md:w-1/3">
                  <Field label="رمز مدیر (برای تایید تغییر قفل‌ها)">
                    <PasswordField value={panelManagerPw} onChange={(e) => setPanelManagerPw(e.target.value)} />
                  </Field>
                </div>
                {/* مورد ۵ — هشدار زرد جای «شکست بی‌صدا» */}
                {managerPwWarning('روشن یا خاموش کردن قفل هر ماژول')}
                <div
                  className={`rounded px-3 py-2 border-2 leading-6 ${
                    lockOpenCount > 0 ? 'bg-amber-50 border-amber-400' : 'bg-emerald-50 border-emerald-300'
                  }`}
                >
                  {lockOpenCount > 0 ? (
                    <b>
                      هم‌اکنون قفل {faDigits(lockOpenCount)} ماژول خاموش است — این ماژول‌ها بدون رمز باز می‌شوند.
                    </b>
                  ) : (
                    <b>قفل همه‌ی ماژول‌ها روشن است (حالت پیش‌فرض و امن برنامه).</b>
                  )}
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead className="sticky top-0">
                      <tr>
                        <th>ماژول</th>
                        <th className="w-40">وضعیت قفل</th>
                        <th className="w-56">قفل رمز دوم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LOCKED_PANELS.map((panel) => {
                        const always = panelLocks.alwaysLocked.includes(panel.key)
                        const on = always || panelLocks.locks[panel.key] !== false
                        return (
                          <tr key={`lock-${panel.key}`} className={!on ? 'bg-amber-50' : ''}>
                            <td>
                              <div className="font-bold">{panel.title}</div>
                              <div className="kbd">{panel.hint}</div>
                            </td>
                            <td className={on ? 'font-bold' : 'text-amber-700 font-bold'}>
                              {on ? '🔒 قفل روشن' : '🔓 قفل خاموش — بدون رمز باز می‌شود'}
                            </td>
                            <td>
                              {always ? (
                                <span className="kbd">
                                  قفلش قابل برداشتن نیست (بکاپ و حذف گزارشات داخل همین پنل است)
                                </span>
                              ) : (
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4"
                                    checked={on}
                                    disabled={lockBusy === panel.key}
                                    onChange={(e) => void togglePanelLock(panel.key, e.target.checked)}
                                  />
                                  <span className="font-bold">
                                    {lockBusy === panel.key ? 'در حال ذخیره…' : on ? 'قفل فعال است' : 'قفل غیرفعال است'}
                                  </span>
                                </label>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ============ رمز دوم اختصاصی هر پنل ============ */}
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">رمز دوم اختصاصی پنل‌ها</h2>
                <div className="kbd leading-6">
                  برای هر پنل قفل‌دار می‌توانید — در صورت تمایل — یک <b>رمز دوم اختصاصی</b> بگذارید و آن را فقط به کارمند
                  همان بخش بدهید (مثلاً رمز «فاکتورهای فروش عمده» به حسابدار). ورود با رمز دوم <b>فقط همان یک پنل</b> را
                  باز می‌کند و به بقیه‌ی برنامه دسترسی نمی‌دهد.
                  <br />
                  <b>رمز مدیر همیشه و بی‌استثنا همه‌ی این قفل‌ها را باز می‌کند</b>، چه رمز دوم برایشان تعریف شده باشد چه
                  نشده باشد. تا وقتی برای پنلی رمز دوم تعریف نشده، رفتار همان قبل است: فقط رمز مدیر بازش می‌کند.
                </div>
                <div className="md:w-1/3">
                  <Field label="رمز مدیر (برای تایید همین بخش)">
                    <PasswordField value={panelManagerPw} onChange={(e) => setPanelManagerPw(e.target.value)} />
                  </Field>
                </div>
                {/* مورد ۵ — هشدار زرد جای «شکست بی‌صدا» */}
                {managerPwWarning('تعیین، تغییر، حذف یا دیدنِ رمز دوم و رمز سوم پنل‌ها')}

                {/* ============ مورد ۷ — راهنمای اولویت رمزها ============ */}
                <div className="rounded px-3 py-2 border bg-slate-50 leading-7">
                  <b>اولویت ورود به یک پنل قفل‌دار — بدون استثنا:</b>
                  <ol className="list-decimal ps-6 leading-7">
                    <li>
                      <b>رمز مدیر</b> — همیشه، همه‌جا، در همه‌ی شیفت‌ها.
                    </li>
                    <li>
                      <b>رمز دوم همان پنل</b> (اگر تعریف شده باشد) — در <b>همه‌ی شیفت‌ها</b> کار می‌کند.
                    </li>
                    <li>
                      <b>رمز سوم همان شیفت</b> (اگر تعریف شده باشد) — <b>فقط در همان شیفت</b> و فقط همان پنل. رمز سومِ
                      یک شیفت در شیفت دیگر کار نمی‌کند.
                    </li>
                  </ol>
                  <div className="kbd leading-6">
                    کاربرد رمز سوم: اگر در شیفت صبح اشتباه یا کم‌و‌کاستی رخ داد، فروشنده‌ی صبح نمی‌تواند بگوید «شیفت
                    بعدی این کار را کرد»، چون رمز هر شیفت مجزاست و فقط دست خودِ همان فروشنده است. رمز سوم چیزی از رمز
                    دوم کم نمی‌کند: رمز دوم یک لایه‌ی «همیشه‌کار» بالاتر از آن است.
                    <br />
                    پیش‌فرض همه‌ی ترکیب‌های «پنل × شیفت» <b>تعریف‌نشده</b> است — هر کدام را خودتان آگاهانه فعال
                    می‌کنید. «قفل» پنل‌ها (بخش بالا) کاملاً جداست و پیش‌فرض امنش دست‌نخورده مانده است.
                  </div>
                </div>

                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="w-10 text-center" title="رمزهای سوم هر شیفت">
                          +
                        </th>
                        <th>پنل</th>
                        <th>وضعیت رمز دوم</th>
                        <th className="w-56">رمز دوم جدید</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {LOCKED_PANELS.map((panel) => {
                        const state = panelAuth.find((x) => x.key === panel.key)
                        const enabled = !!state?.enabled
                        const shifts = state?.shifts ?? []
                        const expanded = panelExpanded.includes(panel.key)
                        const activeShiftPws = shifts.filter((sh) => sh.enabled).length
                        const shown = revealed[panel.key]
                        return (
                          <Fragment key={panel.key}>
                            <tr>
                              {/* ---- مورد ۷: آکاردئون رمزهای سوم؛ پیش‌فرض بسته ---- */}
                              <td className="text-center">
                                <button
                                  className="btn py-0 px-2 font-bold"
                                  onClick={() => togglePanelExpanded(panel.key)}
                                  title={
                                    expanded
                                      ? 'بستن فهرست رمزهای سوم (هر شیفت)'
                                      : 'رمز سوم مخصوص هر شیفت برای همین پنل'
                                  }
                                >
                                  {expanded ? '−' : '+'}
                                </button>
                              </td>
                              <td>
                                <div className="font-bold">{panel.title}</div>
                                <div className="kbd">{panel.hint}</div>
                              </td>
                              <td className={enabled ? 'text-emerald-700 font-bold' : ''}>
                                {enabled ? 'تعریف شده (فعال)' : 'تعریف نشده — فقط رمز مدیر'}
                                {activeShiftPws > 0 && (
                                  <div className="kbd text-sky-800">
                                    {faDigits(activeShiftPws)} رمز سوم شیفتی هم برای این پنل تعریف شده است
                                  </div>
                                )}
                                {/* ---- مورد ۴: رمز ذخیره‌شده، وقتی نمایش داده شود ---- */}
                                {shown != null && (
                                  <div className="mt-1 rounded border-2 border-emerald-400 bg-emerald-50 px-2 py-1 font-bold" dir="ltr">
                                    {shown}
                                  </div>
                                )}
                              </td>
                              <td>
                                <PasswordField
                                  placeholder="حداقل ۴ رقم"
                                  value={panelPw[panel.key] ?? ''}
                                  onChange={(e) => setPanelPw((prev) => ({ ...prev, [panel.key]: e.target.value }))}
                                />
                              </td>
                              <td className="whitespace-nowrap">
                                <button
                                  className="btn py-1"
                                  onClick={() => void savePanelPassword(panel.key)}
                                  disabled={panelBusy === panel.key}
                                >
                                  {panelBusy === panel.key ? '…' : enabled ? 'تغییر رمز' : 'ثبت رمز'}
                                </button>
                                {/* ---- مورد ۴: «رمز ذخیره‌شده را نشانم بده» ---- */}
                                {enabled && (
                                  <button
                                    className="btn py-1 ms-1"
                                    onClick={() => void revealPassword(panel.key, null)}
                                    disabled={revealBusy === panel.key || !state?.recoverable}
                                    title={
                                      state?.recoverable
                                        ? 'رمز دومِ ذخیره‌شده‌ی این پنل را نشان بده (رمز مدیر لازم است)'
                                        : 'این رمز قبل از این نسخه ثبت شده و فقط هش‌شده روی دیتابیس است؛ یک بار دوباره ثبتش کنید تا قابل نمایش شود.'
                                    }
                                  >
                                    {revealBusy === panel.key ? '…' : shown != null ? '🙈 مخفی کن' : '👁 دیدن رمز'}
                                  </button>
                                )}
                                {enabled && (
                                  <button
                                    className="btn btn-danger py-1 ms-1"
                                    onClick={() => void savePanelPassword(panel.key, true)}
                                    disabled={panelBusy === panel.key}
                                    title="این پنل به حالت پیش‌فرض برمی‌گردد: فقط با رمز مدیر باز می‌شود"
                                  >
                                    حذف رمز دوم
                                  </button>
                                )}
                              </td>
                            </tr>

                            {/* ============ مورد ۷ — زیرجدول رمزهای سوم همین پنل ============ */}
                            {expanded && (
                              <tr>
                                <td></td>
                                <td colSpan={4} className="bg-slate-50">
                                  <div className="font-bold mb-1">
                                    رمز سوم «{panel.title}» — مخصوص هر شیفت
                                    {enabled && (
                                      <span className="kbd font-normal ms-2">
                                        رمز دومِ این پنل فعال است، پس در همه‌ی شیفت‌ها کار می‌کند؛ رمز سوم یک لایه‌ی
                                        اضافه‌ی مخصوص هر شیفت است.
                                      </span>
                                    )}
                                  </div>
                                  {!shifts.length ? (
                                    <div className="kbd text-amber-800 leading-6">
                                      هنوز هیچ شیفتی در «تنظیمات → شیفت» تعریف نشده است. اول شیفت‌ها (صبح / ظهر / شب یا
                                      هر چه می‌خواهید) را بسازید، بعد برای هرکدام رمز سوم بگذارید.
                                    </div>
                                  ) : (
                                    <div className="tbl-wrap">
                                      <table className="tbl">
                                        <thead>
                                          <tr>
                                            <th>شیفت</th>
                                            <th>وضعیت رمز سوم</th>
                                            <th className="w-56">رمز سوم جدید</th>
                                            <th></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {shifts.map((sh) => {
                                            const id = shiftKey(panel.key, sh.number)
                                            const shShown = revealed[id]
                                            const rowBusy = shiftBusy === id
                                            return (
                                              <tr key={id} className={sh.isCurrent ? 'bg-sky-50' : ''}>
                                                <td>
                                                  <div className="font-bold">{sh.name}</div>
                                                  <div className="kbd">
                                                    {sh.windowLabel || '—'}
                                                    {sh.isCurrent ? ' · شیفت جاری' : ''}
                                                  </div>
                                                </td>
                                                <td className={sh.enabled ? 'text-emerald-700 font-bold' : ''}>
                                                  {sh.enabled ? 'تعریف شده (فعال)' : 'تعریف نشده'}
                                                  {shShown != null && (
                                                    <div
                                                      className="mt-1 rounded border-2 border-emerald-400 bg-emerald-50 px-2 py-1 font-bold"
                                                      dir="ltr"
                                                    >
                                                      {shShown}
                                                    </div>
                                                  )}
                                                </td>
                                                <td>
                                                  <PasswordField
                                                    placeholder="حداقل ۴ رقم"
                                                    value={shiftPw[id] ?? ''}
                                                    onChange={(e) =>
                                                      setShiftPw((prev) => ({ ...prev, [id]: e.target.value }))
                                                    }
                                                  />
                                                </td>
                                                <td className="whitespace-nowrap">
                                                  <button
                                                    className="btn py-1"
                                                    onClick={() =>
                                                      void savePanelShiftPassword(panel.key, sh.number, sh.name)
                                                    }
                                                    disabled={rowBusy}
                                                  >
                                                    {rowBusy ? '…' : sh.enabled ? 'تغییر رمز' : 'ثبت رمز'}
                                                  </button>
                                                  {sh.enabled && (
                                                    <button
                                                      className="btn py-1 ms-1"
                                                      onClick={() => void revealPassword(panel.key, sh.number)}
                                                      disabled={revealBusy === id || !sh.recoverable}
                                                      title={
                                                        sh.recoverable
                                                          ? 'رمز سومِ ذخیره‌شده‌ی این شیفت را نشان بده (رمز مدیر لازم است)'
                                                          : 'این رمز قبل از این نسخه ثبت شده و قابل بازیابی نیست؛ یک بار دوباره ثبتش کنید.'
                                                      }
                                                    >
                                                      {revealBusy === id ? '…' : shShown != null ? '🙈 مخفی کن' : '👁 دیدن رمز'}
                                                    </button>
                                                  )}
                                                  {sh.enabled && (
                                                    <button
                                                      className="btn btn-danger py-1 ms-1"
                                                      onClick={() =>
                                                        void savePanelShiftPassword(panel.key, sh.number, sh.name, true)
                                                      }
                                                      disabled={rowBusy}
                                                      title="رمز سوم این شیفت حذف شود (رمز دوم و رمز مدیر دست‌نخورده می‌مانند)"
                                                    >
                                                      حذف
                                                    </button>
                                                  )}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">نشست مدیر</h2>
                <div className="kbd leading-6">
                  تا وقتی مدیر خارج نشده باشد، پنل کالاها (تعریف و حذف کالا و ورود موجودی) و پنل فاکتور خرید باز
                  می‌مانند. با زدن «خروج مدیر»، وضعیت همان لحظه به «کارمند» برمی‌گردد و هر سه پنل قفل می‌شوند؛ باز
                  کردنشان دوباره رمز می‌خواهد. بستن و باز کردن برنامه هم مثل خروج مدیر عمل می‌کند (پیش‌فرض = کارمند).
                </div>
                <button className="btn btn-danger" onClick={exitManager}>
                  خروج مدیر و قفل کردن پنل‌های موجودی
                </button>
              </section>
            </>
          )}


          {/**
            * ================== بند ۳ — سیاست تخفیف پنل فروش ==================
            * مسئله‌ی مالک نرم‌افزار: «فروشنده نباید خودسرانه تخفیف بزند.»
            * دو ابزار مستقل، و هر دو لازم:
            *   ۱) قفل رمز دومِ خودِ کادر تخفیف (`PANEL_KEYS.posDiscount`) — «چه
            *      کسی». تنظیمش در همین صفحه، بخش «رمز — قفل ماژول‌ها» است.
            *   ۲) همین سیاست — «چقدر».
            * محاسبه‌اش در `src/shared/priceAdjust.ts` است و پنل فروش *همان* توابع
            * را صدا می‌زند، پس عددی که اینجا تعیین می‌شود و عددی که روی فاکتور
            * می‌نشیند از یک جا می‌آیند.
            * ==================================================================
            */}
          {tab === 'discount' && (
            <>
              <section className="space-y-3">
                <h2 className="font-bold border-b pb-1">سیاست تخفیف پنل فروش</h2>

                <div className="kbd leading-6">
                  این سیاست <b>سقف اختیار فروشنده</b> را تعیین می‌کند و روی «پنل فروش تکی» اعمال می‌شود (هم تخفیف
                  ستون جدول و هم تخفیف کل فاکتور). جدا از این، کادر تخفیف پنل فروش یک <b>قفل رمز دوم اختصاصی</b> هم
                  دارد («تخفیف پنل فروش» در بخش رمزها) — یکی می‌گوید «چه کسی»، دیگری می‌گوید «چقدر».
                </div>

                {/* ---------- حالت سیاست ---------- */}
                <Field label="حالت">
                  <select
                    className="inp"
                    value={discount.mode}
                    onChange={(e) => setD({ mode: e.target.value as DiscountPolicyMode })}
                  >
                    {(Object.keys(DISCOUNT_POLICY_LABELS) as DiscountPolicyMode[]).map((m) => (
                      <option key={m} value={m}>
                        {DISCOUNT_POLICY_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* ---------- فقط در حالت FIXED: تخفیف ثابتِ مدیر ---------- */}
                {discount.mode === 'FIXED' && (
                  <div className="rounded p-2 border-2 bg-sky-50 border-sky-300 space-y-2">
                    <div className="font-bold">تخفیف ثابتِ مدیر</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Field label="مقدار">
                        <input
                          type="number"
                          min={0}
                          max={discount.fixedMode === 'PERCENT' ? 100 : undefined}
                          className="inp"
                          value={discount.fixedValue}
                          onChange={(e) =>
                            setD({
                              fixedValue:
                                discount.fixedMode === 'PERCENT'
                                  ? Math.min(100, Math.max(0, Math.round(+e.target.value || 0)))
                                  : Math.max(0, Math.round(+e.target.value || 0))
                            })
                          }
                        />
                      </Field>
                      <Field label="واحد">
                        <select
                          className="inp"
                          value={discount.fixedMode}
                          onChange={(e) => setD({ fixedMode: e.target.value as PriceAdjustMode })}
                        >
                          {(Object.keys(PRICE_ADJUST_MODE_LABELS) as PriceAdjustMode[]).map((m) => (
                            <option key={m} value={m}>
                              {PRICE_ADJUST_MODE_LABELS[m]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="kbd leading-6">
                      در این حالت عدد تخفیف در پنل فروش <b>قابل تایپ نیست</b>: فروشنده فقط یک سوییچ می‌بیند و همین
                      تخفیف را روشن یا خاموش می‌کند. تخفیف ستون جدول (روی خودِ کالا) هم بسته می‌شود.
                      {discount.fixedValue > 0 ? (
                        <>
                          {' '}
                          نمونه: روی فاکتور ۱٬۰۰۰٬۰۰۰ ریالی ⇒{' '}
                          <b>{money(fixedDiscountFor({ ...discount, mode: 'FIXED' }, 1000000))} ریال</b> تخفیف.
                        </>
                      ) : (
                        ' ⚠️ مقدارش صفر است، پس عملاً هیچ تخفیفی اعمال نمی‌شود.'
                      )}
                    </div>
                  </div>
                )}

                {/* ---------- دو سوییچ مستقل: تخفیف کالا / تخفیف فاکتور ---------- */}
                <div className="rounded p-2 border space-y-2">
                  <div className="font-bold">کجا تخفیف مجاز است؟</div>
                  <label
                    className="flex items-start gap-2 cursor-pointer"
                    title="ستون «تخفیف» جدول پنل فروش (تخفیف روی همان یک کالا)"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 mt-0.5"
                      checked={discount.allowLine}
                      disabled={discount.mode !== 'FREE'}
                      onChange={(e) => setD({ allowLine: e.target.checked })}
                    />
                    <span>
                      <b>تخفیف روی خودِ کالا</b> (ستون تخفیف جدول)
                      <span className="block kbd leading-6">
                        {discount.mode === 'FREE'
                          ? 'در پوشاک معمول است که تخفیف کل فاکتور آزاد باشد ولی دست‌کاری قیمت تک‌تک کالاها ممنوع.'
                          : 'در حالت‌های «تخفیف ثابت» و «غیرفعال» این گزینه بی‌اثر است و تخفیف کالا همیشه بسته می‌ماند.'}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer" title="کادر «تخفیف فاکتور» کنار جمع‌ها">
                    <input
                      type="checkbox"
                      className="w-4 h-4 mt-0.5"
                      checked={discount.allowInvoice}
                      disabled={discount.mode === 'OFF'}
                      onChange={(e) => setD({ allowInvoice: e.target.checked })}
                    />
                    <span>
                      <b>تخفیف کل فاکتور</b> (کادر تخفیف کنار جمع‌ها)
                      <span className="block kbd leading-6">
                        خاموش که باشد، کادر تخفیف فاکتور در پنل فروش نمایش داده نمی‌شود.
                      </span>
                    </span>
                  </label>
                </div>

                {/* ---------- سقف‌ها: فقط در حالت FREE معنا دارند ---------- */}
                <div
                  className={`rounded p-2 border-2 space-y-2 ${
                    discount.mode === 'FREE' ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50'
                  }`}
                >
                  <div className="font-bold">سقف تخفیف (فقط در حالت «آزاد»)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="حداکثر درصد تخفیف هر فاکتور (۱۰۰ = بی‌سقف)">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="inp"
                        value={discount.maxPercent}
                        disabled={discount.mode !== 'FREE'}
                        onChange={(e) => setD({ maxPercent: Math.min(100, Math.max(0, Math.round(+e.target.value || 0))) })}
                      />
                    </Field>
                    <Field label="حداکثر مبلغ تخفیف هر فاکتور — ریال (۰ = بی‌سقف)">
                      <input
                        type="number"
                        min={0}
                        className="inp"
                        value={discount.maxAmount}
                        disabled={discount.mode !== 'FREE'}
                        onChange={(e) => setD({ maxAmount: Math.max(0, Math.round(+e.target.value || 0)) })}
                      />
                    </Field>
                  </div>
                  <div className="kbd leading-6">
                    هر دو سقف با هم اعمال می‌شوند و <b>سخت‌گیرانه‌ترینشان</b> برنده است. سقف روی <b>کل تخفیف</b> فاکتور
                    است (تخفیف ردیف‌ها + تخفیف فاکتور)، نه روی هر کدام جدا. اگر فروشنده عددی بزرگ‌تر بزند، پنل فروش
                    مبلغ را تا سقف کوتاه می‌کند و <b>صریح می‌گوید</b> چقدر اعمال نشد (کوتاه‌کردن بی‌صدا، گزارش را با
                    فاکتور چاپی واگرا می‌کند).
                  </div>
                </div>

                {/*
                  🔴 نشست ۱۸۵ · بند ۴-۲۶ — سقف جدا برای فاکتور عمده.

                  سیاست بالا عمداً روی عمده اعمال نمی‌شود (تصمیم S151-D4): قیمت
                  عمده ذاتاً پایین‌تر است و تخفیف ۲۰–۳۰٪ روی آن کار روزمره است.
                  ولی تا امروز عمده **هیچ** سقفی نداشت و تخفیف ۹۰٪ بی‌مانع ثبت
                  می‌شد. حالا بازه‌ی خودش را دارد و مثل بالا، عبور از آن **رد**
                  می‌شود — با رمز مدیر هم دور زده نمی‌شود.
                */}
                <div className="rounded p-2 border-2 border-sky-400 bg-sky-50 space-y-2">
                  <div className="font-bold">سقف تخفیف فاکتور عمده (مستقل از سیاست بالا)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="حداکثر درصد تخفیف فاکتور عمده (۱۰۰ = بی‌سقف)">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="inp"
                        value={discount.wholesaleMaxPercent}
                        onChange={(e) =>
                          setD({ wholesaleMaxPercent: Math.min(100, Math.max(0, Math.round(+e.target.value || 0))) })
                        }
                      />
                    </Field>
                    <Field label="حداکثر مبلغ تخفیف فاکتور عمده — ریال (۰ = بی‌سقف)">
                      <input
                        type="number"
                        min={0}
                        className="inp"
                        value={discount.wholesaleMaxAmount}
                        onChange={(e) => setD({ wholesaleMaxAmount: Math.max(0, Math.round(+e.target.value || 0)) })}
                      />
                    </Field>
                  </div>
                  <div className="kbd leading-6">
                    پیش‌فرض <b>بی‌سقف</b> است تا به‌روزرسانی چیزی را نشکند. عبور از این سقف در سمت سرور <b>رد</b>
                    می‌شود (نه کوتاه‌کردن و نه گیت رمز)، پس با رمز مدیر هم دور زده نمی‌شود. اگر می‌خواهید تخفیف‌های
                    بزرگ عمده جلوی چشمتان باشد، عددی مثل ۴۰٪ بگذارید.
                  </div>
                </div>

                {/* ---------- خلاصه‌ی یک‌خطی + ذخیره‌ی فوری ---------- */}
                <div className="rounded p-2 border-2 bg-white border-brand leading-7">
                  <b>نتیجه:</b> {describeDiscountPolicy(discount)}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="flex flex-col gap-1">
                    <span className="kbd">رمز مدیر یا رمز دوم «تنظیمات» (سمت سرور هم بررسی می‌شود)</span>
                    <PasswordField value={discountPw} onChange={(e) => setDiscountPw(e.target.value)} />
                  </label>
                  <button
                    className="btn btn-primary"
                    onClick={() => void saveDiscount()}
                    disabled={discountBusy || !discountPw.trim()}
                  >
                    {discountBusy ? 'در حال ذخیره…' : 'ذخیره‌ی سیاست تخفیف'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => setDiscount({ ...DEFAULT_DISCOUNT_POLICY })}
                    disabled={discountBusy}
                    title="بازگشت فرم به پیش‌فرض برنامه (آزاد و بی‌سقف) — تا دکمه‌ی ذخیره زده نشود، چیزی نوشته نمی‌شود"
                  >
                    بازگشت به پیش‌فرض
                  </button>
                  <button className="btn" onClick={() => void load()} disabled={discountBusy}>
                    بازخوانی از دیتابیس
                  </button>
                  <span className="kbd">
                    این بخش دکمه‌ی ذخیره‌ی <b>فوری</b> خودش را دارد (مثل «قفل موقت»): سیاست تخفیف یک مجوز مالی است و
                    نباید منتظر دکمه‌ی کلی «ذخیره‌ی تنظیمات» بماند. پنل‌های باز همان لحظه تازه می‌شوند.
                  </span>
                </div>
              </section>

              {/* ---------- راه دوم و مستقل: ماژول تغییر گروهی قیمت ---------- */}
              <section className="space-y-2">
                <h2 className="font-bold border-b pb-1">تخفیف روی خودِ قیمت کالاها</h2>
                <div className="kbd leading-6">
                  سیاست بالا فقط درباره‌ی <b>تخفیف لحظه‌ی فروش</b> است و به قیمت ثبت‌شده‌ی کالاها دست نمی‌زند. اگر
                  می‌خواهید قیمت فروش گروهی از کالاها را واقعاً کم یا زیاد کنید (حراج پایان فصل، گران‌کردن یک دسته)، از
                  ماژول «تخفیف و افزایش/کاهش قیمت» استفاده کنید: پیش‌نمایش دارد، قیمت قبلی هر کالا را ذخیره می‌کند و
                  با یک کلیک قابل بازگردانی است.
                </div>
                <button className="btn btn-primary" onClick={() => nav('/price-adjust')}>
                  رفتن به ماژول تخفیف و افزایش/کاهش قیمت
                </button>
              </section>
            </>
          )}

          {tab === 'shift' && (
            <section className="space-y-3">
              <h2 className="font-bold border-b pb-1">شیفت‌های روز</h2>

              {/* انتقالِ بدون حدس: ShiftPlan قدیمی هرگز با خواندن تنظیمات تبدیل یا حذف نمی‌شود. */}
              <div className="rounded border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
                <div className="font-bold text-amber-950">بازبینی برنامه‌های قدیمی حضانت</div>
                <p className="text-sm leading-6 text-amber-950">
                  برنامه‌های قدیمیِ حضانت هنوز مستقل‌اند. تا زمانی که مدیر هر مورد را با قالب شیفت جدید بررسی و تصمیم
                  نگرفته، هیچ برنامه، کارمند زمان‌بندی‌شده یا یادآوری به‌صورت خودکار تبدیل یا حذف نمی‌شود.
                </p>
                {isManager ? (
                  <button className="btn" disabled={legacyShiftPlanBusy} onClick={() => void loadLegacyShiftPlanReview()}>
                    {legacyShiftPlanBusy ? 'در حال خواندن…' : 'بررسی فقط‌خواندنی برنامه‌های قدیمی'}
                  </button>
                ) : (
                  <p className="kbd">بازبینی انتقال فقط با نشست سراسری مدیر ممکن است.</p>
                )}
                {legacyShiftPlanReview?.state === 'EMPTY' && <p className="text-sm text-emerald-800">برنامهٔ قدیمی برای انتقال پیدا نشد.</p>}
                {legacyShiftPlanReview?.state === 'REVIEW_REQUIRED' && (
                  <div className="overflow-auto rounded border border-amber-200 bg-white">
                    <table className="tbl text-sm">
                      <thead><tr><th>برنامهٔ قدیمی</th><th>شروع</th><th>مدت</th><th>کارکنان</th><th>وضعیت</th></tr></thead>
                      <tbody>{legacyShiftPlanReview.plans.map((plan) => (
                        <tr key={plan.id}>
                          <td>{plan.title}</td>
                          <td dir="ltr">{String(Math.floor(plan.startMinute / 60)).padStart(2, '0')}:{String(plan.startMinute % 60).padStart(2, '0')}</td>
                          <td>{faDigits(plan.durationMinutes)} دقیقه</td>
                          <td>{faDigits(plan.staffIds.length)} نفر</td>
                          <td title={plan.migrationNote}>نیازمند تصمیم مدیر</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded border-2 border-indigo-300 bg-indigo-50 p-3 space-y-2">
                <div className="font-bold text-indigo-950">حالت مسئولیت و برنامه‌ریزی حضانت</div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={shift.custodyMode === 'MULTI_SHIFT'}
                    onChange={(e) => {
                      setShift((current) => ({ ...current, custodyMode: e.target.checked ? 'MULTI_SHIFT' : 'SINGLE_SHIFT' }))
                      setDirty(true)
                    }}
                  />
                  <span>
                    <b>{shift.custodyMode === 'MULTI_SHIFT' ? 'چندشیفت' : 'تک‌شیفت'}</b>
                    <span className="block kbd leading-6">در تک‌شیفت، مدیر برای بازهٔ فعال مسئول ثبت‌شده را انتخاب می‌کند؛ در چندشیفت، کارکنان همان قالب‌های پایین برنامه‌ریزی می‌شوند. در هر دو حالت، مسئولیت مالی فقط بعد از احراز هویت شخصی و بازکردن صندوق واقعی شروع می‌شود.</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={shift.reminderEnabled} onChange={(e) => { setShift((current) => ({ ...current, reminderEnabled: e.target.checked })); setDirty(true) }} />
                  یادآوری پایان برنامه روشن باشد
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span>مهلت هشدار بعد از پایان (دقیقه)</span>
                  <input className="inp w-24" inputMode="numeric" value={String(shift.overrunGraceMinutes)} onChange={(e) => { const minutes = Math.max(0, Math.min(1440, Math.round(Number(toLatinDigits(e.target.value).replace(/\D/g, '')) || 0))); setShift((current) => ({ ...current, overrunGraceMinutes: minutes })); setDirty(true) }} />
                </label>
                <p className="kbd leading-6">این تنظیمات با «ذخیرهٔ تنظیمات» اصلی ذخیره می‌شوند. برنامهٔ legacy حضانت از اینجا نوشته نمی‌شود و تا تصمیم انتقال مدیر دست‌نخورده می‌ماند.</p>
              </div>

              {/* ---------- سوییچ حالت ---------- */}
              <div
                className={`rounded p-2 border-2 space-y-1 ${
                  shift.byTime ? 'bg-emerald-50 border-emerald-400' : 'bg-slate-50 border-slate-300'
                }`}
              >
                <label className="flex items-center gap-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={shift.byTime}
                    disabled={!byTimePw.trim()}
                    onChange={(e) => void setByTime(e.target.checked)}
                  />
                  تعیین شیفت بر اساس ساعت
                  <span className="kbd">(همین لحظه ذخیره می‌شود — نیازی به دکمه‌ی ذخیره‌ی تنظیمات نیست)</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="kbd">رمز مدیر (برای تغییر این سوییچ):</span>
                  <PasswordField value={byTimePw} onChange={(e) => setByTimePw(e.target.value)} />
                </label>
                <div className="kbd leading-6">
                  {shift.byTime ? (
                    <>
                      روشن: شیفت هر فاکتور — و شیفتی که در پنل «بستن صندوق» نشان داده می‌شود — از <b>ساعت همان
                      لحظه</b> پیدا می‌شود، نه از تعداد بار بستن صندوق. اگر شیفت اول ۰۸:۰۰ تا ۱۴:۰۰ باشد و صندوق ساعت
                      ۱۰ بسته شود، فاکتور ساعت ۱۱ هم به <b>همان شیفت اول همان روز</b> می‌چسبد (شماره‌ی جدید ساخته
                      نمی‌شود). اگر ساعت در هیچ بازه‌ای نیفتد، نزدیک‌ترین شیفت با برچسب «خارج از بازه» نشان داده
                      می‌شود. شیفتی که ساعت پایانش کوچک‌تر یا برابر ساعت شروع باشد (مثل ۲۰:۰۰ تا ۰۲:۰۰) شبانه حساب
                      می‌شود و به روزی که شروع شده تعلق دارد.
                    </>
                  ) : (
                    <>
                      خاموش (پیش‌فرض): همان رفتار همیشگی — هر بار صندوق بسته شود و فروش جدیدی شروع شود، شیفت بعدی همان
                      روز خودکار باز می‌شود (حتی اگر روزی ۱۰ بار). در این حالت فقط <b>نام</b> شیفت‌ها از فهرست پایین
                      خوانده می‌شود و ساعت‌ها بی‌اثرند.
                    </>
                  )}
                </div>
              </div>

              {/* ---------- نشست ۳۱۰ · فاز ۲ — سقف اضافه‌کاری شیفت شب ---------- */}
              <div className="rounded p-2 border bg-slate-50 space-y-1">
                <div className="font-bold">سقف اضافه‌کاری شیفت شب</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span className="kbd">سقف (دقیقه، ۰ تا ۲۴۰؛ ۰ = خاموش):</span>
                    <input
                      className="inp w-24"
                      type="text"
                      inputMode="numeric"
                      value={overtimeCap}
                      onChange={(e) => setOvertimeCap(e.target.value)}
                    />
                  </label>
                  <button className="btn" disabled={!byTimePw.trim()} onClick={() => void saveOvertimeMax()}>
                    ذخیره‌ی فوری (با رمز مدیر بالا)
                  </button>
                </div>
                <div className="kbd leading-6">
                  خاموش (پیش‌فرض ۰): نشستِ بازِ دیروز که از بازه‌اش گذشته باشد، همیشه باید با دلیل و رمز مدیر بسته
                  شود. روشن: کارمند همان نشست از مودال «نشست صندوق» می‌تواند <b>فقط یک‌بار</b> و تا «پایان بازه +
                  این سقف» اضافه‌کاری اعلام کند — با دلیلِ اجباری که برای همیشه در حسابرسی می‌ماند (رمز مدیر لازم
                  نیست، چون فاکتورها به کارمند همان نشست نسبت داده می‌شوند). این گزینه فقط وقتی اثر دارد که «تعیین
                  شیفت بر اساس ساعت» روشن باشد.
                </div>
              </div>

              {/* ---------- جلسه ۱۹ · بند ۷ — فرمت نمایش ساعت شروع/پایان ---------- */}
              <div className="rounded p-2 border bg-slate-50 space-y-1">
                <div className="font-bold">فرمت نمایش ساعت شروع/پایان شیفت‌ها</div>
                <div className="flex flex-wrap gap-1 items-center">
                  {(
                    [
                      ['12', '۱۲ساعته با AM/PM (پیش‌فرض)'],
                      ['24', '۲۴ساعته (مثل ۱۸:۰۰ برای ۶ عصر)']
                    ] as ['12' | '24', string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      className={`btn ${shift.clockFormat === k ? 'btn-primary' : ''}`}
                      onClick={() => {
                        setShift((p) => ({ ...p, clockFormat: k }))
                        setDirty(true)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="kbd leading-6">
                  این گزینه <b>فقط نمایشی</b> است: مقدار ذخیره‌شده همیشه همان ۲۴ساعته می‌ماند و هیچ اثری روی تشخیص
                  شیفت یا هیچ محاسبه‌ای ندارد. با انتخاب حالت ۲۴ساعته، فیلدهای ساعت به‌صورت متنی (مثل ۱۸:۰۰) نشان داده
                  می‌شوند؛ در حالت ۱۲ساعته همان فیلد ساعت ویندوز با AM/PM باقی می‌ماند.
                </div>
              </div>

              {/* ---------- فهرست شیفت‌ها ---------- */}
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>نام شیفت</th>
                      <th className="w-40">ساعت شروع</th>
                      <th className="w-40">ساعت پایان</th>
                      <th className="w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shift.templates.map((t, i) => (
                      <tr key={t.id}>
                        <td className="font-bold">{faDigits(i + 1)}</td>
                        <td>
                          <input
                            className="inp py-0.5"
                            value={t.name}
                            onChange={(e) => setShiftRow(i, { name: e.target.value })}
                          />
                        </td>
                        {/**
                          * بند ۷ — فقط *نمایش* عوض می‌شود:
                          *   ۱۲ساعته ⇒ همان فیلد ساعت ویندوز (AM/PM)، دست‌نخورده.
                          *   ۲۴ساعته ⇒ فیلد متنی که با نرمال‌سازی ذخیره می‌شود.
                          * مقدار ذخیره‌شده در هر دو حالت همان 'HH:mm' است.
                          */}
                        <td>
                          {shift.clockFormat === '24' ? (
                            <input
                              dir="ltr"
                              className="inp py-0.5 text-center"
                              value={t.startTime}
                              placeholder="18:00"
                              onChange={(e) => setShiftRow(i, { startTime: e.target.value })}
                              onBlur={(e) => setShiftRow(i, { startTime: normalizeTime(e.target.value, t.startTime) })}
                            />
                          ) : (
                            <input
                              type="time"
                              dir="ltr"
                              className="inp py-0.5 text-center"
                              value={t.startTime}
                              onChange={(e) => setShiftRow(i, { startTime: e.target.value })}
                            />
                          )}
                          <div className="kbd text-center" dir="ltr">
                            {faDigits(formatClockForDisplay(t.startTime, shift.clockFormat))}
                          </div>
                        </td>
                        <td>
                          {shift.clockFormat === '24' ? (
                            <input
                              dir="ltr"
                              className="inp py-0.5 text-center"
                              value={t.endTime}
                              placeholder="02:00"
                              onChange={(e) => setShiftRow(i, { endTime: e.target.value })}
                              onBlur={(e) => setShiftRow(i, { endTime: normalizeTime(e.target.value, t.endTime) })}
                            />
                          ) : (
                            <input
                              type="time"
                              dir="ltr"
                              className="inp py-0.5 text-center"
                              value={t.endTime}
                              onChange={(e) => setShiftRow(i, { endTime: e.target.value })}
                            />
                          )}
                          <div className="kbd text-center" dir="ltr">
                            {faDigits(formatClockForDisplay(t.endTime, shift.clockFormat))}
                          </div>
                        </td>
                        <td>
                          <button
                            className="text-red-500"
                            onClick={() => removeShift(i)}
                            disabled={shift.templates.length <= 1}
                            title={shift.templates.length <= 1 ? 'حداقل یک شیفت باید بماند' : 'حذف این شیفت'}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <div className="font-bold">برنامه، کارکنان و مجوز تحویل میان‌روز هر شیفت</div>
                <p className="kbd leading-6">این بخش منبع canonical برنامه‌های جدید است. کارمند برنامه‌ریزی‌شده فقط «واجد انتخاب» می‌شود؛ تا PIN خودش را وارد و صندوق را باز نکند، هیچ مسئولیت مالی ندارد.</p>
                {shift.templates.map((template, index) => (
                  <details key={`schedule-${template.id}`} className="rounded border bg-slate-50 p-3" open={shift.templates.length === 1}>
                    <summary className="cursor-pointer font-bold">{template.name || `شیفت ${faDigits(index + 1)}`} · {faDigits(index + 1)}</summary>
                    <div className="mt-3 grid gap-3">
                      <div className="flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={template.isActive} onChange={(e) => setShiftRow(index, { isActive: e.target.checked })} /> قالب فعال</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={template.allowMidDayHandover} onChange={(e) => setShiftRow(index, { allowMidDayHandover: e.target.checked })} /> تحویل میان‌روز با تأیید مستقل گیرنده مجاز است</label>
                        <label className="flex items-center gap-2">یادآوری هر <input className="inp w-16 py-0.5" inputMode="numeric" value={String(template.reminderRepeatMin)} onChange={(e) => setShiftRow(index, { reminderRepeatMin: Math.max(5, Math.min(60, Math.round(Number(toLatinDigits(e.target.value).replace(/\D/g, '')) || 5))) })} /> دقیقه</label>
                      </div>
                      <div className="text-sm">
                        <div className="mb-1 font-bold">روزهای برنامه</div>
                        <div className="flex flex-wrap gap-1">{SHIFT_WEEKDAY_NAMES.map((day, dayIndex) => {
                          const selected = (template.daysMask & (1 << dayIndex)) !== 0
                          return <button key={`${template.id}-day-${dayIndex}`} type="button" className={`w-9 h-8 rounded ${selected ? 'bg-brand text-white' : 'bg-slate-200'}`} onClick={() => setShiftRow(index, { daysMask: selected ? template.daysMask & ~(1 << dayIndex) : template.daysMask | (1 << dayIndex) })}>{day}</button>
                        })}</div>
                      </div>
                      <div className="text-sm">
                        <div className="mb-1 font-bold">کارکنان برنامه‌ریزی‌شده</div>
                        {isManager ? (
                          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">{staffRows.filter((staff) => staff.isActive && (staff.role === 'MANAGER' || staff.role === 'CASHIER')).map((staff) => (
                            <label key={`${template.id}-staff-${staff.id}`} className="flex items-center gap-2"><input type="checkbox" checked={template.staffIds.includes(staff.id)} onChange={() => setShiftRow(index, { staffIds: template.staffIds.includes(staff.id) ? template.staffIds.filter((id) => id !== staff.id) : [...template.staffIds, staff.id] })} />{staff.name}</label>
                          ))}</div>
                        ) : <span className="kbd">مشاهده و ویرایش برنامهٔ کارکنان فقط برای مدیر ممکن است.</span>}
                      </div>
                    </div>
                  </details>
                ))}
              </div>

              <div className="flex gap-2 flex-wrap items-center">
                <button className="btn btn-primary" onClick={addShift}>
                  + افزودن شیفت
                </button>
                <button className="btn" onClick={() => nav('/cash-close')}>
                  بستن صندوق
                </button>
                <span className="kbd">
                  ساعت‌ها به قالب ۲۴ ساعته‌اند و بازه به‌صورت «از ساعت شروع تا لحظه‌ی قبل از ساعت پایان» حساب می‌شود،
                  پس ۱۴:۰۰ دقیقاً شروع شیفت بعدی است نه پایان مشترک.
                </span>
              </div>

              <div className="rounded p-2 border-2 border-emerald-300 bg-emerald-50 leading-7">
                <b>مدل «نشست»:</b> هر بار که صندوق واقعاً دست‌به‌دست می‌شود (بستن و باز کردن صندوق، یا تعویض کارمند وسط
                کار)، یک <b>نشست تازه</b> ثبت می‌شود و نشست قبلی با کارمند خودش بسته می‌ماند — هیچ‌کدام رونویسی یا حذف
                نمی‌شوند. اگر «شیفت شب» در یک روز دو بار باز شود، در گزارش‌ها «شیفت شب — نشست ۱» و «شیفت شب — نشست ۲»
                دیده می‌شوند و سرجمع «شیفت شب» مجموع هر دو است. نام شیفتِ هر نشست را سیستم بر اساس ساعت <b>پیشنهاد</b>
                می‌دهد و اگر کاربر نام دیگری انتخاب کند، نوشتن دلیل اجباری است و در گزارش «نشست‌های با نام
                override‌شده» (گزارشات فروش) دیده می‌شود.
              </div>

              <div className="kbd leading-6">
                گزارش فروش با چک‌باکس «جداسازی بر اساس شیفت»، فروش هر شیفت را جدا نشان می‌دهد. اگر در حالت زمان‌بندی
                ساعتی در هیچ بازه‌ای نیفتد (مثلاً بستن صندوق ساعت ۱۴:۳۰ در حالی که بازه‌ها ۲۰:۰۰–۱۲:۰۰ تعریف شده‌اند)،
                برنامه <b>شماره‌ی شیفت جدید نمی‌سازد</b>: نزدیک‌ترین شیفت تعریف‌شده انتخاب و همان نام (مثلاً «شیفت ۳»)
                با برچسب «خارج از بازه‌های تعریف‌شده» در پنل بستن صندوق نشان داده می‌شود. تا وقتی این چک‌باکس روشن است،
                شماره‌ی شیفت هیچ‌وقت پشت‌سرهم زیاد نمی‌شود؛ هیچ فاکتوری هم به‌خاطر تنظیمات شیفت زمین نمی‌ماند.
              </div>
            </section>
          )}

          {/* ==================== بانک شماره مشتریان (مورد ۶) ==================== */}
          {tab === 'customers' && (
            <section className="space-y-2">
              <h2 className="font-bold border-b pb-1">مشتریان و شماره تلفن‌ها</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  className="inp max-w-xs"
                  placeholder="جستجو در نام / کد / شماره"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                <label className="flex items-center gap-1 whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={onlyWithPhone}
                    onChange={(e) => setOnlyWithPhone(e.target.checked)}
                  />
                  فقط مشتری‌های دارای شماره
                </label>
                <button className="btn" onClick={() => void loadCustomers()}>
                  تازه‌سازی
                </button>
                <button className="btn btn-primary" onClick={() => void copyPhones()}>
                  کپی همه‌ی شماره‌ها
                </button>
                <button className="btn btn-primary" onClick={() => void exportCustomers()}>
                  خروجی اکسل (xlsx)
                </button>
                <span className="kbd">
                  {faDigits(customers.length)}
                  {customerMeta.page && customerMeta.page.totalCount > customers.length
                    ? ` از ${faDigits(customerMeta.page.totalCount)}`
                    : ''}{' '}
                  مشتری
                </span>
              </div>

              {/* نشست ۱۱۵ · بند ۴-۴۶ — هشدار برش صریح + صفحه‌ی قبل/بعد (نه سقف بی‌صدا) */}
              {customerMeta.warnings.length > 0 && (
                <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
                  <span>{customerMeta.warnings.join(' ')}</span>
                  {customerMeta.page && (
                    <>
                      <button
                        className="btn py-1"
                        disabled={customerMeta.page.skip <= 0}
                        onClick={() =>
                          void loadCustomers(undefined, Math.max(0, customerMeta.page!.skip - customerMeta.page!.take))
                        }
                      >
                        صفحه‌ی قبل
                      </button>
                      <button
                        className="btn py-1"
                        disabled={customerMeta.page.skip + customers.length >= customerMeta.page.totalCount}
                        onClick={() => void loadCustomers(undefined, customerMeta.page!.skip + customerMeta.page!.take)}
                      >
                        صفحه‌ی بعد
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ---------- فیلتر نوع مشتری و حداقل مبلغ خرید (مورد ۳ و ۶) ---------- */}
              <div className="flex gap-2 items-center flex-wrap border rounded p-2 bg-slate-50">
                <span className="font-bold">نوع مشتری:</span>
                {(
                  [
                    ['all', 'همه'],
                    ['retail', 'مشتریان تکی (پنل فروش)'],
                    ['wholesale', 'مشتریان عمده (فاکتور عمده)']
                  ] as [CustomerKind, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    className={`btn py-1 ${customerKind === k ? 'btn-primary' : ''}`}
                    /**
                     * مورد ۲ — رفع باگ «با کلیک روی تکی/عمده لیست خالی می‌شد».
                     * نوعِ انتخاب‌شده *همان لحظه* و به‌صورت صریح به فهرست‌گیری
                     * پاس داده می‌شود (قبلاً setTimeout مقدار قبلیِ فیلتر را
                     * می‌فرستاد). این فیلتر فقط نمایش را محدود می‌کند و هیچ
                     * مشتری‌ای حذف نمی‌شود.
                     */
                    onClick={() => {
                      setCustomerKind(k)
                      void loadCustomers(k)
                    }}
                  >
                    {label}
                  </button>
                ))}
                <label className="flex items-center gap-1 whitespace-nowrap ms-2">
                  <span className="kbd">حداقل جمع خرید (ریال) — برای قرعه‌کشی</span>
                  <input
                    className="inp w-32 py-1 text-center"
                    dir="ltr"
                    value={customerMinTotal}
                    onChange={(e) => setCustomerMinTotal(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <button className="btn py-1" onClick={() => void loadCustomers()}>
                  اعمال فیلتر
                </button>
              </div>

              {/* ---------- ثبت / ویرایش دستی مشتری (مورد ۳) ---------- */}
              <div className="border rounded p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-end bg-white">
                <label className="md:col-span-3">
                  <div className="kbd">نام مشتری</div>
                  <input
                    className="inp"
                    value={custDraft.name}
                    onChange={(e) => setCustDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <label className="md:col-span-3">
                  <div className="kbd">شماره تلفن</div>
                  <input
                    className="inp text-center"
                    dir="ltr"
                    placeholder="09xxxxxxxxx"
                    value={custDraft.phone}
                    onChange={(e) => setCustDraft((d) => ({ ...d, phone: e.target.value }))}
                  />
                </label>
                <label className="md:col-span-3">
                  <div className="kbd">مجموع مبلغ خرید (دستی · ریال)</div>
                  <input
                    className="inp text-center"
                    dir="ltr"
                    value={custDraft.manualPurchaseTotal}
                    onChange={(e) => setCustDraft((d) => ({ ...d, manualPurchaseTotal: e.target.value }))}
                  />
                </label>
                <label className="md:col-span-2 flex items-center gap-2 pb-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={custDraft.isWholesale}
                    onChange={(e) => setCustDraft((d) => ({ ...d, isWholesale: e.target.checked }))}
                  />
                  مشتری عمده
                </label>
                <div className="md:col-span-1 flex gap-1">
                  <button className="btn btn-primary w-full" onClick={() => void saveCustomer()} disabled={custBusy}>
                    {custDraft.id ? 'ذخیره' : 'افزودن'}
                  </button>
                  {custDraft.id ? (
                    <button className="btn" onClick={resetCustDraft} disabled={custBusy}>
                      نو
                    </button>
                  ) : null}
                </div>
                <div className="md:col-span-12 kbd leading-6">
                  «جمع خرید» هر مشتری = جمع فاکتورهای ثبت‌شده‌اش + همین مبلغ دستی. اگر شماره‌ی واردشده از قبل ثبت شده
                  باشد، مشتری تکراری ساخته نمی‌شود و همان رکورد قبلی استفاده می‌گردد؛ خرید بعدیِ همان شماره (حتی ۱۲ ماه
                  بعد) فقط «تعداد فاکتور» همان مشتری را زیاد می‌کند.
                </div>
              </div>

              <div className="tbl-wrap">
                <table className="tbl">
                  <thead className="sticky top-0">
                    <tr>
                      <th>کد</th>
                      <th>نام</th>
                      <th>نوع</th>
                      <th>شماره تلفن</th>
                      <th>تعداد فاکتور</th>
                      <th>جمع خرید فاکتورها</th>
                      <th>مبلغ خرید دستی</th>
                      <th>جمع خرید</th>
                      <th>آخرین خرید</th>
                      <th>تاریخ ثبت</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id} className={custDraft.id === c.id ? 'sel' : ''}>
                        <td>{faDigits(c.code)}</td>
                        <td>{c.name}</td>
                        {/* مورد ۶: برچسب جدا برای مشتری عمده و مشتری تکی */}
                        <td className="text-center">
                          <button
                            className={`px-2 py-0.5 rounded font-bold ${
                              c.isDefault
                                ? 'bg-slate-200'
                                : c.isWholesale
                                  ? 'bg-emerald-100 border border-emerald-400'
                                  : 'bg-sky-100 border border-sky-300'
                            }`}
                            onClick={() => (c.isDefault ? undefined : void toggleCustomerKind(c))}
                            title={c.isDefault ? 'مشتری عمومی پیش‌فرض برنامه' : 'کلیک = تغییر نوع مشتری (تکی ⇄ عمده)'}
                          >
                            {c.isDefault ? 'عمومی' : c.isWholesale ? 'عمده' : 'تکی'}
                          </button>
                        </td>
                        <td dir="ltr" className="text-center">
                          {c.phone ? faDigits(c.phone) : '—'}
                        </td>
                        <td>{faDigits(c.invoiceCount)}</td>
                        <td>{money(c.invoiceTotal)}</td>
                        {/* مورد ۳: ثبت/ویرایش «مجموع مبلغ خرید» همان‌جا */}
                        <td className="w-36">
                          <input
                            className="inp py-0.5 text-center"
                            dir="ltr"
                            defaultValue={c.manualPurchaseTotal || ''}
                            onBlur={(e) => void saveCustomerTotal(c, e.target.value)}
                            title="عدد را بنویسید و کلیک بیرون از فیلد = ذخیره"
                          />
                        </td>
                        <td className="font-bold">{money(c.totalBought)}</td>
                        <td>{c.lastBuyJalali ? faDigits(c.lastBuyJalali) : '—'}</td>
                        <td>{faDigits(c.createdAtJalali)}</td>
                        <td className="whitespace-nowrap">
                          <button
                            className="text-brand"
                            onClick={() =>
                              setCustDraft({
                                id: c.id,
                                name: c.name,
                                phone: c.phone ?? '',
                                isWholesale: c.isWholesale,
                                manualPurchaseTotal: String(c.manualPurchaseTotal || '')
                              })
                            }
                          >
                            ویرایش
                          </button>
                          {!c.isDefault && (
                            <>
                              <span className="opacity-40 px-1">|</span>
                              <button className="text-red-500" onClick={() => void removeCustomer(c)} disabled={custBusy}>
                                حذف
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!customers.length && (
                      <tr>
                        <td colSpan={11} className="text-center py-8 text-slate-400">
                          {customerKind !== 'all' || onlyWithPhone || customerSearch.trim() || customerMinTotal.trim()
                            ? 'با این فیلترها مشتری‌ای پیدا نشد. (فیلتر فقط نمایش را محدود می‌کند و هیچ مشتری‌ای حذف نمی‌شود؛ برای دیدن همه، «همه» را بزنید و تیک «فقط دارای شماره» را بردارید.)'
                            : 'هنوز مشتری‌ای ثبت نشده است. در پنل فروش، شماره‌ی مشتری را در فیلد «شماره تلفن مشتری» بنویسید تا با ثبت فاکتور همین‌جا بیاید.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="kbd leading-6">
                هر شماره‌ای که در پنل فروش وارد شود (و هر مشتری‌ای که در فاکتور فروش عمده ثبت گردد) خودکار همین‌جا
                می‌آید. با «کپی همه‌ی شماره‌ها» فهرست شماره‌ها در حافظه کپی می‌شود تا در پنل پیامک تبلیغاتی بچسبانید، و
                با «خروجی اکسل» همین جدول (با نام و شماره تلفن) به‌صورت یک فایل xlsx استاندارد ذخیره می‌شود — مسیر
                ذخیره را خودتان انتخاب می‌کنید و فایل مستقیم در اکسل باز می‌شود. فیلترهای بالا (جستجو و «فقط دارای
                شماره») روی خروجی هم اعمال می‌شوند. با کلیک روی برچسب «تکی/عمده» نوع مشتری عوض می‌شود، فیلد «مبلغ خرید
                دستی» با کلیک بیرون از خودش ذخیره می‌گردد، و «حذف» فاکتورهای مشتری را پاک نمی‌کند (فقط خریدارشان
                «مشتری عمومی» می‌شود).
              </div>

              {/* ---------- تایید حذف مشتریِ دارای فاکتور (مورد ۳) ---------- */}
              <Modal
                open={!!delCustomer}
                title="حذف مشتری"
                onClose={() => setDelCustomer(null)}
                width="max-w-lg"
                footer={
                  <>
                    <button className="btn" onClick={() => setDelCustomer(null)} disabled={custBusy}>
                      انصراف
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => (delCustomer ? void removeCustomer(delCustomer, true) : undefined)}
                      disabled={custBusy || !custDelPw.trim()}
                    >
                      بله، حذف کن
                    </button>
                  </>
                }
              >
                <p className="leading-7 whitespace-pre-line">{delMessage}</p>
                {/* نشست ۱۵۵ (S151-c1، Y5): حذف مشتری دارای فاکتور فقط با رمز؛ مشتری بدهکار اصلاً حذف نمی‌شود */}
                <Field label="رمز مدیر (یا رمز دوم پنل تنظیمات) برای حذف مشتری دارای فاکتور">
                  <PasswordField value={custDelPw} onChange={(e) => setCustDelPw(e.target.value)} />
                </Field>
              </Modal>
            </section>
          )}

          {/* ==================== بکاپ و بازگردانی ==================== */}
          {/* ==================== جلسه ۱۸ · بند ۳ — سیاست حسابداری ==================== */}
          {tab === 'accounting' && (
            <>
              <h2 className="font-bold text-lg">سیاست حسابداری</h2>
              <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7">
                هیچ‌کدام از این عددها <b>چیزی را قفل تجاری نمی‌کند</b>: آستانه‌ها فقط تعیین می‌کنند چه وقت یک یادداشت
                اجباری شود، چه وقت رمز مدیر پرسیده شود، و چه فاکتوری در فهرست «تخفیف‌های غیرعادی» دیده شود. اصل کار همان
                «هشدار، نه دیوار» است.
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <Field label="آستانه‌ی مغایرت صندوق (ریال) — بالاتر از این، نوشتن یادداشت اجباری می‌شود">
                  <input
                    dir="ltr"
                    className="inp text-center tabular-nums"
                    value={String(policy.cashDifferenceThreshold)}
                    onChange={(e) => {
                      setPolicy({ ...policy, cashDifferenceThreshold: Number(toLatinDigits(e.target.value).replace(/[^\d]/g, '') || 0) })
                      setPolicyDirty(true)
                    }}
                  />
                </Field>
                <Field label="سقف صدور اعتبار خرید بدون رمز مدیر (ریال) — ۰ = بدون سقف">
                  <input
                    dir="ltr"
                    className="inp text-center tabular-nums"
                    value={String(policy.storeCreditLimit)}
                    onChange={(e) => {
                      setPolicy({ ...policy, storeCreditLimit: Number(toLatinDigits(e.target.value).replace(/[^\d]/g, '') || 0) })
                      setPolicyDirty(true)
                    }}
                  />
                </Field>
              </div>

              {/* ---------- بند ۳: همان فیلدی که سند جلسه ۱۷ خواسته بود ---------- */}
              <div className="rounded border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                <div className="font-bold text-amber-900">آستانه‌ی درصد تخفیف غیرعادی</div>
                <div className="flex flex-wrap items-end gap-3">
                  <label>
                    <div className="mb-1">درصد (۰ = خاموش)</div>
                    <input
                      dir="ltr"
                      className="inp w-32 text-center tabular-nums"
                      value={String(policy.abnormalDiscountPercent)}
                      onChange={(e) => {
                        const n = Number(toLatinDigits(e.target.value).replace(/[^\d]/g, '') || 0)
                        setPolicy({ ...policy, abnormalDiscountPercent: Math.min(100, n) })
                        setPolicyDirty(true)
                      }}
                    />
                  </label>
                  <span className="kbd leading-6 flex-1 min-w-[260px]">
                    فاکتوری که درصد تخفیفش از این عدد بالاتر باشد، در فهرست «تخفیف‌های غیرعادی» تب <b>عملکرد کارمندان</b>{' '}
                    (گزارشات فروش) دیده می‌شود، همراه با این‌که کدام کارمند و در چه تاریخی ثبتش کرده است. این آستانه هیچ
                    تخفیفی را مسدود نمی‌کند؛ سقف اختیار فروشنده جای دیگری است (تنظیمات → تخفیف).
                  </span>
                </div>
                {policy.abnormalDiscountPercent <= 0 && (
                  <div className="kbd text-amber-900 font-bold">
                    روی صفر، این هشدار کاملاً خاموش است و عمداً «همه‌ی فاکتورها غیرعادی» نشان داده نمی‌شود.
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={policy.requireManagerForPriceOverride}
                  onChange={(e) => {
                    setPolicy({ ...policy, requireManagerForPriceOverride: e.target.checked })
                    setPolicyDirty(true)
                  }}
                />
                قیمت کمتر از قیمت مرجع در فروش، ویرایش فاکتور و کالای جایگزین تعویض، رمز مدیر لازم دارد
              </label>
              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={policy.lockClosedPeriods}
                  onChange={(e) => {
                    setPolicy({ ...policy, lockClosedPeriods: e.target.checked })
                    setPolicyDirty(true)
                  }}
                />
                ثبت/ویرایش در دوره‌ی «تجمیع‌شده» یا «صندوق‌بسته»، رمز مدیر لازم دارد
              </label>

              <div className="flex gap-2 items-center flex-wrap">
                <label className="flex flex-col gap-1">
                  <span className="kbd">رمز مدیر (تغییر سیاست حسابداری همیشه رمز مدیر می‌خواهد)</span>
                  <PasswordField value={policyPw} onChange={(e) => setPolicyPw(e.target.value)} />
                </label>
                <button
                  className="btn btn-primary"
                  onClick={() => void savePolicy()}
                  disabled={policyBusy || !policyPw.trim()}
                >
                  {policyBusy ? 'در حال ذخیره…' : 'ذخیره‌ی سیاست حسابداری'}
                </button>
                <button className="btn" onClick={() => void loadPolicy()} disabled={policyBusy}>
                  بازگردانی از دیتابیس
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPolicy(DEFAULT_ACCOUNTING_POLICY)
                    setPolicyDirty(true)
                  }}
                >
                  بازگشت به پیش‌فرض‌ها
                </button>
                {policyDirty && <span className="kbd text-amber-700 font-bold">تغییرات ذخیره نشده</span>}
                <span className="kbd">
                  این بخش دکمه‌ی ذخیره‌ی خودش را دارد و با «ذخیره‌ی تنظیمات» بالای صفحه ذخیره نمی‌شود.
                </span>
              </div>
            </>
          )}

          {/* ==================== جلسه ۱۸ · بند ۲ — کارمندان ==================== */}
          {isManager && tab === 'staff' && (
            <>
              <h2 className="font-bold text-lg">کارمندان فروشگاه</h2>
              <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7">
                این بخش <b>سیستم ورود کاربر نیست</b>. ثبت کارمند و پروندهٔ او فقط با نشست اصلی مدیر انجام می‌شود؛ رمز دوم
                پنل تنظیمات به این بخش دسترسی نمی‌دهد. اطلاعات هویتی و بانکی از فهرست عمومی کارکنان و تب
                <b>عملکرد کارمندان</b> جدا هستند.
              </div>

              {/* ---------- جلسه ۱۹ · بند ۳ — «کارمند فعال» حذف شد ---------- */}
              <div className="rounded border-2 border-emerald-400 bg-emerald-50 p-3 leading-7">
                <b>«انتخاب کارمند فعالِ پشت سیستم» از اینجا حذف شد.</b> یک تنظیم سراسری نمی‌توانست بفهمد صندوق چند بار
                دست‌به‌دست شده است، پس سهم فروش کارمندها قابل تفکیک نبود. حالا کارمند هر فاکتور از <b>کارمند همان
                نشستِ صندوق</b> خوانده می‌شود و هر بار که صندوق دست‌به‌دست می‌شود (حتی موقت) در فرم «نشست» یک نشست تازه
                با کارمند خودش ثبت می‌شود.
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn" onClick={() => nav('/cash-close')}>
                    رفتن به بستن صندوق (ثبت نشست / تعویض کارمند)
                  </button>
                  <span className="kbd">
                    نشان «نشست جاری» در نوار بالای برنامه هم همان فرم را باز می‌کند.
                  </span>
                </div>
              </div>

              {/* ---------- فرم ثبت/ویرایش ---------- */}
              <div ref={staffFormRef} className="rounded border p-3 space-y-2 scroll-mt-24">
                <div className="font-bold">{staffDraft.id ? `ویرایش کارمند شماره ${faDigits(staffDraft.id)}` : 'ثبت کارمند تازه'}</div>
                <p className="kbd leading-6">برای ثبت اولیه فقط «نام کارمند» و «نقش» لازم است. پروندهٔ شغلی، هویتی و بانکی را می‌توانید اکنون یا بعداً تکمیل کنید؛ دکمهٔ کلی «ذخیرهٔ تنظیمات» بالای صفحه برای پروندهٔ کارمندان نیست.</p>
                {staffError && <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">{staffError}</div>}
                <div className="flex flex-wrap items-end gap-2">
                  <label>
                    <div className="mb-1">نام کارمند</div>
                    <input
                      ref={staffNameInputRef}
                      className="inp w-56"
                      value={staffDraft.name}
                      onChange={(e) => setStaffDraft({ ...staffDraft, name: e.target.value })}
                    />
                  </label>
                  <label>
                    <div className="mb-1">نقش</div>
                    <select
                      className="inp min-w-[200px]"
                      value={staffDraft.role}
                      onChange={(e) => {
                        const role = e.target.value
                        setStaffDraft({ ...staffDraft, role })
                        if (role !== 'MANAGER') setStaffCorrectionApprovalPw('')
                      }}
                    >
                      {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {STAFF_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 font-bold pb-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={staffDraft.isActive}
                      onChange={(e) => setStaffDraft({ ...staffDraft, isActive: e.target.checked })}
                    />
                    فعال
                  </label>
                  {staffDraft.role === 'MANAGER' && (
                    <label title="فقط هنگام اصلاح/ابطال دیرهنگام یا دوره‌بسته استفاده می‌شود؛ خالی گذاشتن آن رمز قبلی مدیر را تغییر نمی‌دهد.">
                      <div className="mb-1 font-bold">رمز شخصی تأیید اصلاح دیرهنگام</div>
                      <PasswordField
                        value={staffCorrectionApprovalPw}
                        onChange={(e) => setStaffCorrectionApprovalPw(e.target.value)}
                        placeholder={staffDraft.id ? 'خالی = بدون تغییر' : 'حداقل ۴ نویسه'}
                      />
                    </label>
                  )}
                </div>
                <fieldset className="rounded border border-rose-200 bg-rose-50/50 p-3 space-y-3">
                  <legend className="px-1 font-bold text-rose-950">پروندهٔ پرسنلی محرمانه — فقط مدیر</legend>
                  <p className="text-sm leading-6 text-slate-700">این اطلاعات در فهرست کارکنان، گزارش‌ها، خروجی‌ها و لاگ‌های عادی نشان داده نمی‌شوند. فقط نشست اصلی مدیر در همین پنجره اجازهٔ مشاهده یا تغییر دارد.</p>
                  <div className={`rounded border px-3 py-2 text-sm ${staffProfileProgress.isComplete ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
                    <b>{staffProfileProgress.isComplete ? 'پرونده کامل است' : 'پرونده در حال تکمیل است'}</b>
                    {' · '}
                    {faDigits(staffProfileProgress.completed)} از {faDigits(staffProfileProgress.total)} بخش تکمیل شده. خالی‌بودن این بخش‌ها ثبت یا ویرایش پایهٔ کارمند را متوقف نمی‌کند؛ برای احراز صلاحیت صندوق و مسئولیت شیفت، شرایط جداگانه اعمال می‌شود.
                  </div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <label><div className="mb-1">عنوان شغلی</div><input className="inp w-full" value={staffDraft.jobTitle} onChange={(e) => setStaffDraft({ ...staffDraft, jobTitle: e.target.value })} /></label>
                    <label><div className="mb-1">شماره تماس</div><input className="inp w-full" inputMode="tel" value={staffDraft.phone} onChange={(e) => setStaffDraft({ ...staffDraft, phone: e.target.value })} /></label>
                    <label><div className="mb-1">کد ملی</div><input className="inp w-full" inputMode="numeric" value={staffDraft.nationalId} onChange={(e) => setStaffDraft({ ...staffDraft, nationalId: e.target.value })} /></label>
                    <label><div className="mb-1">شروع همکاری (۱۴۰۳/۰۱/۳۱)</div><input className="inp w-full" value={staffDraft.employmentStartJalali} onChange={(e) => setStaffDraft({ ...staffDraft, employmentStartJalali: e.target.value })} /></label>
                    <label><div className="mb-1">پایان همکاری</div><input className="inp w-full" value={staffDraft.employmentEndJalali} onChange={(e) => setStaffDraft({ ...staffDraft, employmentEndJalali: e.target.value })} /></label>
                    <label><div className="mb-1">وضعیت استخدام</div><select className="inp w-full" value={staffDraft.employmentStatus} onChange={(e) => setStaffDraft({ ...staffDraft, employmentStatus: e.target.value as StaffDraft['employmentStatus'] })}><option value="ACTIVE">فعال</option><option value="LEAVE">مرخصی / غیبت</option><option value="SUSPENDED">تعلیق</option><option value="TERMINATED">پایان همکاری</option></select></label>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3 border-t border-rose-200 pt-3">
                    <label><div className="mb-1">نام بانک</div><input className="inp w-full" value={staffDraft.bankName} onChange={(e) => setStaffDraft({ ...staffDraft, bankName: e.target.value })} /></label>
                    <label><div className="mb-1">نام صاحب حساب</div><input className="inp w-full" value={staffDraft.bankAccountHolder} onChange={(e) => setStaffDraft({ ...staffDraft, bankAccountHolder: e.target.value })} /></label>
                    <label><div className="mb-1">شماره حساب</div><input className="inp w-full" inputMode="numeric" value={staffDraft.bankAccountNo} onChange={(e) => setStaffDraft({ ...staffDraft, bankAccountNo: e.target.value })} /></label>
                    <label><div className="mb-1">شماره شبا (IR…)</div><input className="inp w-full uppercase" value={staffDraft.bankIban} onChange={(e) => setStaffDraft({ ...staffDraft, bankIban: e.target.value })} /></label>
                  </div>
                </fieldset>
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <button className="btn btn-primary" onClick={() => void saveStaff()} disabled={staffBusy}>
                    {staffBusy ? 'در حال ذخیره…' : staffDraft.id ? 'ذخیرهٔ ویرایش کارمند' : 'ثبت کارمند'}
                  </button>
                  {staffDraft.id && (
                    <button
                      className="btn"
                      onClick={() => setStaffDraft(blankStaffDraft())}
                      disabled={staffBusy}
                    >
                      انصراف از ویرایش
                    </button>
                  )}
                  <span className="kbd">پس از ذخیره، اطلاعات عمومی و پروندهٔ محرمانه با هم ثبت می‌شوند.</span>
                </div>
                <div className="kbd leading-6">
                  ثبت ساختاری کارمند و این پرونده فقط با <b>نشست اصلی مدیر</b> انجام می‌شود؛ رمز دوم Settings کافی نیست. کارمند هیچ‌وقت <b>حذف</b> نمی‌شود، فقط «غیرفعال» می‌شود؛ وگرنه سابقه‌ی فروش و برگشتِ گذشته‌اش بی‌صاحب می‌ماند.
                </div>
              </div>

              {/* ---------- فهرست کارمندان ---------- */}
              <table className="tbl text-sm">
                <thead>
                  <tr>
                    <th>شماره</th>
                    <th>نام</th>
                    <th>نقش</th>
                    <th>رمز تأیید اصلاح</th>
                    <th>وضعیت</th>
                    <th>ویرایش</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((r) => (
                    <tr key={r.id} className={r.isActive ? '' : 'opacity-60'}>
                      <td className="tabular-nums">{faDigits(r.id)}</td>
                      <td className="font-bold">{r.name}</td>
                      <td>{r.roleLabel}</td>
                      <td>
                        {r.role === 'MANAGER' ? (r.hasCorrectionApprovalPassword ? 'تعریف شده' : 'تعریف نشده') : '—'}
                      </td>
                      <td>{r.isActive ? 'فعال' : 'غیرفعال'}</td>
                      <td>
                        <button
                          className="btn"
                          onClick={() => void editStaff(r)}
                        >
                          ویرایش
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!staffRows.length && (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-slate-500">
                        هنوز کارمندی ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {/* ==================== حضانت صندوق — فقط پیکربندی ساختاری ==================== */}
          {isManager && tab === 'custody' && (
            <section className="space-y-4" dir="rtl">
              <div>
                <h2 className="font-bold text-lg">تنظیمات حضانت صندوق</h2>
                <p className="text-sm text-slate-600 mt-1 leading-7">
                  راه‌اندازی حضانت و صدور رمز موقت از این بخش انجام می‌شود. نام، زمان، روزها، کارکنان برنامه‌ریزی‌شده، یادآوری و اجازهٔ تحویل میان‌روز فقط در تب «شیفت‌ها» تعریف می‌شوند.
                  نوار بالای برنامه فقط برای عملیات روزانهٔ صندوق، تحویل و بستن نهایی است.
                </p>
              </div>
              <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7 text-sm">
                برنامهٔ شیفت فقط انتظار حضور است؛ مسئول مالی صندوق تنها پس از احراز رمز شخصی و بازشدن واقعی صندوق تعیین می‌شود.
                نبود برنامه یا کارمند برنامه‌ریزی‌شده، فروش را متوقف نمی‌کند.
              </div>
              <div className="rounded border p-4 space-y-3 bg-white">
                <div className="font-bold">راه‌اندازی اولیه</div>
                <p className="text-sm text-slate-600">
                  اگر حضانت هنوز فعال نشده، مدیر ابتدا رمز شخصی حضانت خود را تعریف و سپس ماژول را فعال می‌کند. این کار فروش یا نشست‌های قدیمی را تغییر نمی‌دهد.
                </p>
                <CustodyChip showOperations={false} />
              </div>
              <div className="rounded border p-4 space-y-3 bg-white">
                <div className="font-bold">رمزهای موقت و بازبینی دادهٔ قدیمی</div>
                <p className="text-sm text-slate-600">
                  پس از فعال‌سازی، رمز موقت شخصی صادر یا بازنشانی می‌شود و برنامه‌های Legacy فقط قابل بازبینی‌اند؛ هیچ رمز خام قبلی نمایش داده نمی‌شود. برای ساخت یا ویرایش برنامهٔ جدید به تب «شیفت‌ها» بروید.
                </p>
                <CustodyAdminChip />
              </div>
            </section>
          )}

          {/* ==================== جلسه ۱۹ · بند ۹ — تاریخ و ساعت رسمی ==================== */}
          {tab === 'time' && (
            <section className="space-y-3">
              <h2 className="font-bold border-b pb-1">تاریخ و ساعت رسمی</h2>

              <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7">
                هدف این بخش <b>آماده بودن برای تغییرات احتمالی آینده</b>ی قانون ساعت رسمی کشور است، بدون این‌که لازم
                باشد منطق شیفت‌ها بازنویسی شود. اگر روزی تغییر ساعت فصلی دوباره برقرار شد (یا هر دلیل مشابه دیگری پیش
                آمد)، خودتان یک ساعت جلو/عقب را همین‌جا اعمال می‌کنید. پیش‌فرض <b>صفر</b> است، یعنی همه‌چیز دقیقاً با
                ساعت خودِ کامپیوتر کار می‌کند.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="rounded border p-3 space-y-1">
                  <div className="font-bold">ساعت و تاریخ فعلی کامپیوتر (زنده)</div>
                  <div className="text-2xl font-bold tabular-nums">{faDigits(toJalaliDateTime(timeNow))}</div>
                  <div className="kbd leading-6">
                    اگر این عدد با ساعت واقعی فروشگاه نمی‌خواند، اول ساعت خودِ ویندوز را درست کنید؛ همه‌ی گزارش‌های
                    زمانی و تشخیص شیفت روی همین ساعت بنا می‌شوند.
                  </div>
                </div>

                <div className="rounded border p-3 space-y-1">
                  <div className="font-bold">ساعت رسمیِ محاسباتی (با افست)</div>
                  <div className="text-2xl font-bold tabular-nums">
                    {timeCheck ? faDigits(`${timeCheck.officialJalali} ${timeCheck.officialClock}`) : '—'}
                  </div>
                  <div className="kbd leading-6">
                    {timeCheck?.note ?? 'برای دیدن، دکمه‌ی «بررسی ساعت سیستم» را بزنید.'}
                    {timeCheck?.timeZone ? ` · منطقه‌ی زمانی ویندوز: ${timeCheck.timeZone}` : ''}
                  </div>
                </div>
              </div>

              <div className="rounded border-2 border-emerald-400 bg-emerald-50 p-3 space-y-2">
                <div className="font-bold">افست دستی ساعت رسمی کشور</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label>
                    <div className="kbd mb-1">افست به ساعت (پیش‌فرض: صفر · مثال: 1 یا -1)</div>
                    <input
                      className="inp w-40 text-center"
                      dir="ltr"
                      value={timeOffset}
                      onChange={(e) => setTimeOffset(e.target.value)}
                    />
                  </label>
                  <label>
                    <div className="kbd mb-1">رمز مدیر (تغییر افست)</div>
                    <PasswordField value={timePw} onChange={(e) => setTimePw(e.target.value)} />
                  </label>
                  <button
                    className="btn btn-primary"
                    onClick={() => void saveOfficialTime()}
                    disabled={timeBusy || !timePw.trim()}
                  >
                    {timeBusy ? 'در حال ذخیره…' : 'ذخیره‌ی افست'}
                  </button>
                  <button className="btn" onClick={() => void runTimeCheck()} disabled={timeBusy}>
                    بررسی ساعت سیستم
                  </button>
                  <span className="kbd leading-6">
                    افست ذخیره‌شده‌ی فعلی: <b>{faDigits(time.offsetHours)}</b> ساعت
                  </span>
                </div>
                <div className="kbd leading-6">
                  این افست روی <b>همه‌ی محاسبات مبتنی‌بر‌ساعت</b> اعمال می‌شود: نام شیفتی که برای نشست تازه پیشنهاد
                  می‌شود و گزارش «تراکنش‌های خارج از بازه‌ی شیفت». ساعت ذخیره‌شده‌ی خودِ فاکتورها دست‌نخورده می‌ماند، پس
                  هیچ سند گذشته‌ای تغییر نمی‌کند. دکمه‌ی «بررسی ساعت سیستم» به اینترنت نیازی ندارد.
                </div>
              </div>
            </section>
          )}

          {tab === 'backup' && (
            <section className="space-y-3">
              <h2 className="font-bold border-b pb-1">تهیه بکاپ</h2>
              <div className="flex gap-2 flex-wrap items-center">
                <button className="btn btn-primary" onClick={() => void createBackup()} disabled={backupBusy}>
                  {backupBusy ? 'در حال کار…' : 'تهیه بکاپ (انتخاب مسیر)'}
                </button>
                <button className="btn" onClick={() => void importBackup()} disabled={backupBusy}>
                  افزودن فایل بکاپ برای بازگردانی
                </button>
                <button className="btn" onClick={() => void loadBackups()} disabled={backupBusy}>
                  تازه‌سازی فهرست
                </button>
                <span className="kbd">
                  «تهیه بکاپ» پنجره‌ی ذخیره‌ی ویندوز را باز می‌کند و یک کپی کامل از دیتابیس همان‌جا می‌سازد. یک بکاپ
                  خودکار روزانه هم همیشه در پوشه‌ی داخلی برنامه گرفته می‌شود (۳۰ نسخه‌ی آخر).
                </span>
              </div>

              {/* ==================== بکاپ خودکار: مسیر و بازه (مورد ۶) ==================== */}
              <h2 className="font-bold border-b pb-1">بکاپ خودکار (مسیر و بازه‌ی زمانی)</h2>
              <div className="border rounded p-2 space-y-1">
                <b>رمز مدیر برای تهیه، حذف و تنظیم بکاپ</b>
                <div className="kbd leading-6">
                  تهیه‌ی نسخهٔ کامل، بکاپ فوری، حذف فایل و کم‌کردن تعداد نسخه‌ها به داده یا ردّ آن دسترسی دارند. رمز مدیر
                  (یا رمز دوم پنل تنظیمات) لازم است.
                </div>
                <PasswordField
                  className="inp max-w-xs"
                  value={backupGatePw}
                  onChange={(e: any) => setBackupGatePw(e.target.value)}
                  placeholder="رمز مدیر"
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-6">
                  <div className="kbd mb-1">پوشه‌ی ذخیره‌ی بکاپ‌های خودکار</div>
                  <input className="inp" dir="ltr" readOnly value={backupCfg?.effectiveDir ?? ''} />
                </div>
                <div className="md:col-span-3 flex gap-1">
                  <button className="btn btn-primary w-full" onClick={() => void pickBackupDir()} disabled={backupBusy}>
                    انتخاب مسیر…
                  </button>
                  <button
                    className="btn"
                    onClick={() => void saveBackupConfig({ autoDir: '' })}
                    disabled={backupBusy || !backupCfg?.autoDir}
                    title="بازگشت به پوشه‌ی داخلی برنامه"
                  >
                    پیش‌فرض
                  </button>
                </div>
                <div className="md:col-span-3">
                  <div className="kbd mb-1">هر چند روز یک‌بار بکاپ کامل (۰ = خاموش)</div>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      className="inp text-center"
                      dir="ltr"
                      value={backupEvery}
                      onChange={(e) => setBackupEvery(e.target.value)}
                    />
                    <input
                      type="number"
                      min={1}
                      max={500}
                      className="inp text-center"
                      dir="ltr"
                      value={backupKeep}
                      title="چند نسخه‌ی آخر نگه داشته شود"
                      onChange={(e) => setBackupKeep(e.target.value)}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={backupBusy}
                      onClick={() =>
                        void saveBackupConfig({
                          everyDays: Math.max(0, Math.min(365, Number(toLatinDigits(backupEvery)) || 0)),
                          keep: Math.max(1, Math.min(500, Number(toLatinDigits(backupKeep)) || 30))
                        })
                      }
                    >
                      ذخیره
                    </button>
                  </div>
                </div>
                <div className="md:col-span-12 flex gap-2 flex-wrap items-center">
                  <button className="btn" onClick={() => void backupNow()} disabled={backupBusy}>
                    بکاپ فوری در همین مسیر
                  </button>
                  <span className="kbd leading-6">
                    {backupCfg?.everyDays
                      ? `هر ${faDigits(backupCfg.everyDays)} روز یک‌بار، خودکار بکاپ کامل گرفته می‌شود و ${faDigits(
                          backupCfg.keep
                        )} نسخه‌ی آخر نگه داشته می‌شود.`
                      : 'بکاپ خودکار خاموش است؛ فقط بکاپ دستی گرفته می‌شود.'}
                    {backupCfg?.lastAutoAt
                      ? ` آخرین بکاپ خودکار: ${faDigits(new Date(backupCfg.lastAutoAt).toLocaleString('fa-IR'))}`
                      : ''}
                    {backupCfg?.fallback
                      ? ' ⚠️ مسیر انتخابی در دسترس نیست (مثلاً فلش جدا شده)، پس موقتاً پوشه‌ی داخلی برنامه استفاده می‌شود.'
                      : ''}
                  </span>
                </div>
              </div>

              <h2 className="font-bold border-b pb-1">بازگردانی از بکاپ</h2>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead className="sticky top-0">
                    <tr>
                      <th>فایل</th>
                      <th>منبع</th>
                      <th>تاریخ</th>
                      <th>حجم</th>
                      <th>وضعیت</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.id} className={b.missing ? 'text-slate-400' : ''}>
                        <td className="font-bold">{b.fileName}</td>
                        <td>{b.source === 'auto' ? 'خودکار روزانه' : 'واردشده توسط شما'}</td>
                        <td>{faDigits(b.atJalali)}</td>
                        <td>{fileSize(b.size)}</td>
                        <td>
                          {b.missing
                            ? 'فایل پیدا نشد'
                            : b.appliedAt
                              ? b.appliedMode === 'merge'
                                ? 'قبلاً ادغام شده'
                                : 'قبلاً جایگزین شده'
                              : '—'}
                        </td>
                        <td className="whitespace-nowrap">
                          <button
                            className="text-brand font-bold"
                            onClick={() => setApplyTarget(b)}
                            disabled={backupBusy || b.missing}
                          >
                            بازگردانی
                          </button>
                          <span className="opacity-40 px-1">|</span>
                          <button className="text-red-500" onClick={() => void forgetBackup(b)} disabled={backupBusy}>
                            حذف از فهرست
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!backups.length && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-slate-400">
                          هنوز بکاپی نیست. با «افزودن فایل بکاپ» یک فایل از دیسک انتخاب کنید.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {mergeReport && (
                <details className="border rounded" open>
                  <summary className="px-3 py-2 cursor-pointer font-bold">
                    گزارش آخرین ادغام — {mergeReport.fileName}
                  </summary>
                  <div className="p-3 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Info label="فاکتور فروش افزوده‌شده" value={faDigits(mergeReport.inserted.saleInvoice ?? 0)} strong />
                      <Info label="اقلام افزوده‌شده" value={faDigits(mergeReport.inserted.saleInvoiceItem ?? 0)} />
                      <Info label="کالای جدید" value={faDigits(mergeReport.inserted.productVariant ?? 0)} />
                      <Info
                        label="کالای یکی‌شده با کالای فعلی"
                        value={faDigits(mergeReport.matched.ProductVariant ?? 0)}
                      />
                      <Info label="دسته‌بندی جدید" value={faDigits(mergeReport.inserted.Category ?? 0)} />
                      <Info label="دسته‌بندی یکی‌شده" value={faDigits(mergeReport.matched.Category ?? 0)} />
                      <Info
                        label="شماره فیش‌های تازه"
                        value={
                          mergeReport.renumbered.firstReceiptNo
                            ? `${faDigits(mergeReport.renumbered.firstReceiptNo)} تا ${faDigits(
                                mergeReport.renumbered.lastReceiptNo ?? 0
                              )}`
                            : '—'
                        }
                      />
                      <Info label="مدت ادغام" value={`${faDigits((mergeReport.ms / 1000).toFixed(1))} ثانیه`} />
                    </div>
                    {!!mergeReport.warnings.length && (
                      <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 space-y-1">
                        <b>هشدارها (داده‌ای گم نشده، فقط بدانید چه شد):</b>
                        <ul className="list-disc pe-5 space-y-1">
                          {mergeReport.warnings.map((w, i) => (
                            <li key={i}>{faDigits(w)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              )}

              <div className="kbd leading-6">
                <b>جایگزینی کامل</b> = داده‌ی فعلی کنار می‌رود و فقط همین بکاپ می‌نشیند (قبلش یک بکاپ ایمنی از وضعیت
                فعلی گرفته می‌شود و برنامه دوباره باز می‌شود). <b>ادغام</b> = داده‌ی بکاپ به داده‌ی فعلی اضافه می‌شود
                بدون پاک کردن چیزی، پس گزارش‌ها هر دو را با هم نشان می‌دهند — همان کاری که برای دیدن گزارش ۱۰ سال
                بایگانی لازم است. در ادغام، شماره‌ی فیش‌های بکاپ (که با شماره‌های فعلی برخورد دارند) دوباره شماره‌گذاری
                می‌شوند و شماره‌ی اصلی در یادداشت همان فاکتور می‌ماند؛ موجودی انبار هم دست‌نخورده می‌ماند و حرکات بکاپ
                فقط به‌عنوان سند تاریخی وارد می‌شوند.
              </div>
            </section>
          )}

          {/* ==================== سبک‌سازی ==================== */}
          {tab === 'slim' && (
            <section className="space-y-3">
              <h2 className="font-bold border-b pb-1">وزن فعلی دیتابیس</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Info label="حجم فایل دیتابیس" value={fileSize(stats?.size ?? 0)} strong />
                <Info label="فضای قابل آزادسازی (فشرده‌سازی)" value={fileSize(stats?.freeBytes ?? 0)} />
                <Info
                  label="فاکتور فروش"
                  value={faDigits(stats?.tables.find((t) => t.name === 'SaleInvoice')?.rows ?? 0)}
                  strong
                />
                <Info
                  label="حرکت انبار"
                  value={faDigits(stats?.tables.find((t) => t.name === 'StockMovement')?.rows ?? 0)}
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn" onClick={() => void loadStats()} disabled={slimBusy}>
                  تازه‌سازی آمار
                </button>
                <button className="btn" onClick={() => void runVacuum()} disabled={slimBusy}>
                  فشرده‌سازی فایل (بدون حذف داده)
                </button>
              </div>
              {!!stats?.tables.length && (
                <details className="border rounded">
                  <summary className="px-3 py-2 cursor-pointer font-bold">تعداد ردیف هر جدول</summary>
                  <div className="overflow-x-auto border-t">
                    {/*
                      اصلاح نشست دوازدهم (مورد ۳) — این تنها جدول برنامه بود که
                      `<thead>` نداشت، و چون «کشیدن عرض ستون» از مرز سرستون‌ها
                      شروع می‌شود، تغییر اندازه در همین یک جدول کار نمی‌کرد. با
                      افزودن سرستون، قابلیت واقعاً در ۱۰۰٪ جدول‌ها یکسان است.
                    */}
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>نام جدول دیتابیس</th>
                          <th>تعداد ردیف</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.tables.map((t) => (
                          <tr key={t.name}>
                            <td dir="ltr">{t.name}</td>
                            <td className="font-bold">{faDigits(t.rows)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <h2 className="font-bold border-b pb-1">آرشیو و پاک‌سازی داده‌ی قدیمی</h2>
              <p className="kbd leading-6">
                حذف فیزیکی فقط برای داده‌های حداقل {faDigits(slimPreview?.retentionDays ?? 730)} روز قدیمی مجاز است؛
                cutoff باید {faDigits(slimPreview?.minimumCutoffJalali ?? '—')} یا قدیمی‌تر باشد. دفتر گردش انبار
                append-only است و همیشه حفظ می‌شود.
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <div className="mb-1">حذف داده‌ی قبل از تاریخ</div>
                  <JalaliDateInput value={slimBefore} onChange={setSlimBefore} />
                </div>
                <button className="btn btn-primary" onClick={() => void loadSlimPreview()} disabled={slimBusy}>
                  {slimBusy ? 'در حال بررسی…' : 'نمایش آنچه پاک می‌شود'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setAskSlim(true)}
                  disabled={slimBusy || !slimPreview}
                  title="اول بکاپ، بعد حذف، در پایان فشرده‌سازی"
                >
                  آرشیو و پاک‌سازی
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label>
                  <div className="mb-1">رمز مدیر برای پاک‌سازی اجباری</div>
                  <PasswordField value={panelManagerPw} onChange={(e) => setPanelManagerPw(e.target.value)} />
                </label>
                <label>
                  <div className="mb-1">دلیل پاک‌سازی / اصلاح دوره</div>
                  <input
                    className="inp w-full"
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    placeholder="مثلاً حذف فاکتورهای آزمایشی با تأیید مدیر"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="w-4 h-4" checked={slimBackup} onChange={(e) => setSlimBackup(e.target.checked)} />
                  قبل از پاک‌سازی، بکاپ بگیر (توصیه می‌شود)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="w-4 h-4" checked={slimAudit} onChange={(e) => setSlimAudit(e.target.checked)} />
                  لاگ عملیات قدیمی هم پاک شود
                </label>
              </div>

              {/* آرشیو فیزیکی اسناد مالی همیشه با رمز مدیر باز می‌شود. */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="w-56">
                  <div className="mb-1">رمز مدیر برای آرشیو و پاک‌سازی اجباری</div>
                  <PasswordField value={slimManagerPw} onChange={(e) => setSlimManagerPw(e.target.value)} />
                </div>
                <div className="kbd leading-6 flex-1 min-w-[16rem]">
                  بدون رمز صحیح، کل آرشیو اجرا نمی‌شود؛ حتی اگر گزینه‌ی پاک‌سازی لاگ خاموش باشد.
                  سابقه‌ی اعتبار خرید (صدور، مصرف، تغییرات، چاپ) در هیچ حالتی پاک نمی‌شود.
                </div>
              </div>

              {slimPreview && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Info label="فاکتور فروش" value={faDigits(slimPreview.saleInvoices)} strong />
                  <Info label="اقلام فاکتور" value={faDigits(slimPreview.saleItems)} />
                  <Info label="برگشت از فروش" value={faDigits(slimPreview.saleReturns)} />
                  <Info label="فاکتور خرید" value={faDigits(slimPreview.purchaseInvoices)} />
                  <Info label="حرکت انبار قدیمی (حفظ می‌شود)" value={faDigits(slimPreview.stockMovements)} />
                  <Info label="لاگ عملیات (پاک می‌شود)" value={faDigits(slimPreview.auditLogs)} />
                  <Info
                    label="سابقه‌ی محافظت‌شده (پاک نمی‌شود)"
                    value={faDigits(slimPreview.auditLogsProtected)}
                  />
                  <Info label="بستن صندوق / تجمیع" value={`${faDigits(slimPreview.cashSessions)} / ${faDigits(slimPreview.consolidations)}`} />
                  {(slimPreview.consolidationsRetained ?? 0) > 0 && (
                    <Info label="تجمیع وصل به دفتر انبار (حفظ می‌شود)" value={faDigits(slimPreview.consolidationsRetained)} />
                  )}
                  <Info label="جمع فروش این بازه" value={`${money(slimPreview.grandTotal)} ریال`} strong />
                </div>
              )}

              {slimResult && (
                <div className="bg-emerald-50 border border-emerald-300 rounded px-3 py-2 leading-7">
                  <b>پاک‌سازی انجام شد.</b> حجم فایل: {fileSize(slimResult.sizeBefore)} ←{' '}
                  <b>{fileSize(slimResult.sizeAfter)}</b>
                  {slimResult.vacuumed ? ' (با فشرده‌سازی واقعی فایل)' : ''}
                  {slimResult.backupPath ? (
                    <>
                      <br />
                      بکاپ قبل از پاک‌سازی: <span dir="ltr">{slimResult.backupPath}</span>
                    </>
                  ) : null}
                  {slimResult.auditLogsProtected ? (
                    <>
                      <br />
                      {faDigits(slimResult.auditLogsProtected)} ردیف سابقه‌ی محافظت‌شده (اعتبار خرید) پاک نشد.
                    </>
                  ) : null}
                  {slimResult.warnings?.length ? (
                    <div className="mt-1 text-amber-800">
                      {slimResult.warnings.map((w, i) => (
                        <div key={i}>⚠️ {w}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="kbd leading-6">
                این کار سه مرحله است: <b>۱)</b> بکاپ کامل (اگر تیکش روشن باشد)، <b>۲)</b> حذف فاکتورهای فروش و خرید و
                برگشت‌ها و حرکات انبار و لاگ‌های قدیمی‌تر از تاریخ انتخابی، <b>۳)</b> اجرای VACUUM تا فضای دیسک واقعاً
                آزاد شود (SQLite بعد از حذف، فایل را خودش کوچک نمی‌کند).
                <br />
                <b>موجودی انبار عوض نمی‌شود:</b> پاک کردن حرکات قدیمی، عدد موجودی فعلی کالاها را دست نمی‌زند؛ فقط
                تاریخِ گردش کوتاه می‌شود. کالاها، دسته‌بندی‌ها، مشتریان و تنظیمات هم اصلاً حذف نمی‌شوند.
                <br />
                برای گزارش‌گیریِ سریع در حجم بالا، ایندکس‌های لازم روی جدول‌های پرترافیک (فاکتور فروش، اقلام، حرکات
                انبار، لاگ) از قبل ساخته شده‌اند، پس تا وقتی سالانه آرشیو کنید، برنامه با میلیون‌ها ردیف هم کند نمی‌شود.
              </div>
            </section>
          )}

          {tab === 'purge' && (
            <section className="space-y-3">
              <h2 className="font-bold border-b pb-1">حذف گزارشات فروش یک بازه‌ی تاریخی</h2>

              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <div className="mb-1">از تاریخ</div>
                  <JalaliDateInput value={purgeFrom} onChange={setPurgeFrom} />
                </div>
                <div>
                  <div className="mb-1">تا تاریخ</div>
                  <JalaliDateInput value={purgeTo} onChange={setPurgeTo} />
                </div>
                <button className="btn btn-primary" onClick={() => void loadPurgePreview()} disabled={purgeBusy}>
                  {purgeBusy ? 'در حال بررسی…' : 'نمایش گزارشات این بازه'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={askPurgeRange}
                  disabled={purgeBusy || !purge?.rows.length}
                  title="حذف همه‌ی فاکتورهای فروش این بازه"
                >
                  حذف گزارشات این بازه
                </button>
                {/* ---------- مورد ۱: حذف فقط فاکتورهای تیک‌خورده ---------- */}
                <button
                  className="btn btn-danger"
                  onClick={() => void askPurgeSelected()}
                  disabled={purgeBusy || !selected.length}
                  title="حذف فقط همان فاکتورهایی که در جدول تیک زده‌اید (با همان پرسش بازگشت موجودی)"
                >
                  حذف {faDigits(selected.length)} فاکتور انتخاب‌شده
                </button>
                {!!selected.length && (
                  <button className="btn" onClick={() => setSelected([])} disabled={purgeBusy}>
                    برداشتن تیک‌ها
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => {
                    setPurgeFrom(jalaliToday())
                    setPurgeTo(jalaliToday())
                    setPurge(null)
                  }}
                  disabled={purgeBusy}
                >
                  امروز
                </button>
              </div>

              {!purge ? (
                <div className="bg-slate-50 border rounded px-3 py-6 text-center text-slate-500">
                  بازه را انتخاب کنید و «نمایش گزارشات این بازه» را بزنید تا قبل از حذف، دقیقاً ببینید چه فاکتورهایی
                  حذف می‌شوند.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Info label="تعداد فاکتور" value={faDigits(purge.totals.count)} strong />
                    <Info label="جمع کل فروش بازه" value={`${money(purge.totals.grandTotal)} ریال`} strong />
                    <Info label="برگشت از فروش‌های همین فاکتورها" value={`${faDigits(purge.returnCount)} برگشت`} />
                    <Info
                      label="در حالت «بله» به انبار برمی‌گردد"
                      value={`${faDigits(purge.restoreQty)} عدد از ${faDigits(purge.restoreLines.length)} کالا`}
                    />
                  </div>
                  {!!purge.warnings?.length && (
                    <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 whitespace-pre-line">
                      {purge.warnings.join('\n')}
                    </div>
                  )}

                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead className="sticky top-0">
                        <tr>
                          {/* مورد ۱: انتخاب فاکتور برای حذف تکی/چندتایی */}
                          <th className="w-10">
                            <input
                              type="checkbox"
                              className="w-4 h-4"
                              checked={allVisibleSelected}
                              onChange={toggleAllVisible}
                              title="انتخاب / برداشتن همه‌ی ردیف‌های نمایش‌داده‌شده"
                            />
                          </th>
                          <th>شماره فیش</th>
                          <th>تاریخ</th>
                          <th>ساعت</th>
                          <th>شیفت</th>
                          <th>خریدار</th>
                          <th>وضعیت</th>
                          <th>جمع کل</th>
                          <th>نقدی</th>
                          {/* کار الف — سه ستون مقصد پول، از همان تابع مشترکِ بقیه‌ی جدول‌ها */}
                          {DESTINATION_HEADERS_SHORT.map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {purgeVisible.map((r) => (
                          <tr key={r.id} className={selected.includes(r.id) ? 'sel' : ''}>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                className="w-4 h-4"
                                checked={selected.includes(r.id)}
                                onChange={() => toggleRow(r.id)}
                                title={`انتخاب فاکتور ${faDigits(r.receiptNo)} برای حذف`}
                              />
                            </td>
                            <td className="font-bold">{faDigits(r.receiptNo)}</td>
                            <td>{faDigits(r.dateJalali)}</td>
                            <td>{faDigits(r.time)}</td>
                            <td>{r.shiftName}</td>
                            <td>{r.customerName}</td>
                            <td>{r.statusLabel}</td>
                            <td className="font-bold">{money(r.grandTotal)}</td>
                            <td>{money(r.cashTotal)}</td>
                            {destinationCells(r).map((v, i) => (
                              <td key={`dest-${r.id}-${i}`}>{money(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 font-bold">
                          <td colSpan={7}>
                            جمع {faDigits(purge.totals.count)} فاکتور
                            {selected.length ? ` · ${faDigits(selected.length)} فاکتور تیک‌خورده` : ''}
                          </td>
                          <td>{money(purge.totals.grandTotal)}</td>
                          <td>{money(purge.totals.cashTotal)}</td>
                          {destinationCells(purge.totals).map((v, i) => (
                            <td key={`dest-total-${i}`}>{money(v)}</td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {purge.rows.length > 300 && (
                    <div className="kbd">
                      فقط ۳۰۰ ردیف اول نمایش داده شده؛ حذف روی همه‌ی {faDigits(purge.rows.length)} فاکتور بازه انجام
                      می‌شود.
                    </div>
                  )}

                  {!!purge.restoreLines.length && (
                    <details className="border rounded">
                      <summary className="px-3 py-2 cursor-pointer font-bold">
                        کالاهایی که با انتخاب «بله» به انبار برمی‌گردند ({faDigits(purge.restoreLines.length)} کالا ·{' '}
                        {faDigits(purge.restoreQty)} عدد)
                      </summary>
                      <div className="overflow-x-auto border-t">
                        <table className="tbl">
                          <thead className="sticky top-0">
                            <tr>
                              <th>کد</th>
                              <th>نام کالا</th>
                              <th>تعداد بازگشتی</th>
                              <th>موجودی فعلی</th>
                              <th>موجودی بعد از بازگشت</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purge.restoreLines.map((l) => (
                              <tr key={l.variantId}>
                                <td>{faDigits(l.code)}</td>
                                <td>{l.name}</td>
                                <td className="text-center font-bold">
                                  {faDigits(l.qty)} {l.unit}
                                </td>
                                <td className="text-center">{faDigits(l.stock)}</td>
                                <td className="text-center text-emerald-700 font-bold">{faDigits(l.stock + l.qty)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </>
              )}

              <div className="kbd leading-6">
                <b>حذف تکی یا چندتایی:</b> کنار هر ردیف یک چک‌باکس هست؛ هر تعداد فاکتور که خواستید تیک بزنید و
                «حذف … فاکتور انتخاب‌شده» را بزنید. همان پرسش «موجودی‌ها به انبار بازگردند؟» با همان منطق برای
                فاکتورهای انتخاب‌شده هم اجرا می‌شود و بقیه‌ی فاکتورهای بازه دست‌نخورده می‌مانند.
                <br />
                حذف، همه‌ی فاکتورهای فروش بازه را با اقلام، دریافتی‌ها، برگشت‌های از فروش و حرکات انباری‌شان پاک می‌کند
                و در AuditLog ثبت می‌شود. در لحظه‌ی حذف پرسیده می‌شود که موجودی‌ها به انبار بازگردند یا نه؛ «بله» یعنی
                هر کالای فروخته‌شده‌ی این فاکتورها به موجودی انبار اضافه می‌شود (آنچه قبلاً با برگشت از فروش برگشته،
                دوباره شمرده نمی‌شود) و «خیر» یعنی فقط گزارش پاک می‌شود و انبار دست‌نخورده می‌ماند.
              </div>
            </section>
          )}
        </div>

        {/* ---------------- پیش‌نمایش زنده‌ی رسید ---------------- */}
        <div
          className={`col-span-12 xl:col-span-4 bg-white rounded shadow p-2 flex flex-col xl:sticky xl:top-16 ${
            /* مورد ۱ — فقط سه تب «قالب فاکتور چاپی»، «چاپ و چاپگر» و «فروش و کد فاکتور» */
            showsPreview(tab) ? '' : 'hidden'
          }`}
        >
          <div className="font-bold border-b pb-1 mb-2">پیش‌نمایش زنده‌ی رسید</div>
          <div className="overflow-auto bg-slate-50 rounded p-2 max-h-[70vh]">
            {preview ? (
              <iframe title="preview" className="w-full h-full min-h-[420px] bg-white" srcDoc={preview} />
            ) : (
              <div className="text-slate-400 text-center py-10">در حال ساخت پیش‌نمایش…</div>
            )}
          </div>
          <div className="kbd mt-1">
            این پیش‌نمایش با تنظیمات *ذخیره‌نشده‌ی* فعلی ساخته می‌شود؛ هر تغییری را همان لحظه می‌بینید.
          </div>

          {/* ---------------- پیش‌نمایش زنده‌ی لیبل (فقط در تب چاپ) ---------------- */}
          {tab === 'print' && (
            <div className="mt-3 border-t pt-2">
              <div className="font-bold mb-2">پیش‌نمایش لیبل</div>
              <div className="bg-slate-50 rounded p-2 flex items-start justify-center">
                {labelPreview ? (
                  /**
                   * ⚠️ فاز ۲/۴: واحد چاپ یک **ردیف** است، نه یک لیبل. روی رول دوستونه
                   * قالب یک ردیف ۱۰۲ میلی‌متری می‌سازد؛ اگر قاب پیش‌نمایش را به عرض یک
                   * لیبل (۵۰mm) ببندیم، ستون دوم بیرون کادر می‌ماند و پیش‌نمایش دروغ
                   * می‌گوید. پس عرض/ارتفاع از `labelRowDims` می‌آید.
                   */
                  <iframe
                    title="label-preview"
                    className="bg-white border border-dashed border-slate-300"
                    style={{ width: `${labelRowDims(label).rowWidthMm + 4}mm`, height: `${label.heightMm + 4}mm` }}
                    srcDoc={labelPreview}
                  />
                ) : (
                  <div className="text-slate-400 text-center py-6">در حال ساخت پیش‌نمایش لیبل…</div>
                )}
              </div>
              <div className="kbd mt-1 leading-6">
                لیبل نمونه با ابعاد واقعی هر لیبل ({faDigits(label.widthMm)} × {faDigits(label.heightMm)} میلی‌متر) و
                همین تنظیمات ذخیره‌نشده ساخته می‌شود؛ روی رول چندستونه، عرض نمایش برابر عرض ردیف است
                ({faDigits(labelRowDims(label).rowWidthMm)} میلی‌متر) — قالب فعال: <b>{labelPresetOf(label.activeTemplate).title}</b>.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- «این بکاپ چگونه اعمال شود؟» ---------------- */}
      <Modal
        open={!!applyTarget}
        title="بازگردانی از بکاپ"
        onClose={() => {
          setApplyTarget(null)
          setApplyPassword('')
        }}
        width="max-w-2xl"
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setApplyTarget(null)
                setApplyPassword('')
              }}
              disabled={backupBusy}
            >
              انصراف
            </button>
            <button className="btn btn-danger" onClick={() => void applyBackup('replace')} disabled={backupBusy}>
              جایگزینی کامل
            </button>
            <button className="btn btn-primary" onClick={() => void applyBackup('merge')} disabled={backupBusy}>
              ادغام با داده‌ی فعلی
            </button>
          </>
        }
      >
        <p className="font-bold text-base">این بکاپ چگونه اعمال شود؟</p>
        <p>
          فایل: <b>{applyTarget?.fileName}</b> · {fileSize(applyTarget?.size ?? 0)} · {faDigits(applyTarget?.atJalali ?? '')}
        </p>
        <div className="space-y-2">
          <div className="border rounded p-2">
            <b>گزینه ۱ — جایگزینی کامل</b>
            <div className="kbd leading-6">
              داده‌ی فعلی سیستم کنار گذاشته می‌شود و فقط همین بکاپ جای آن می‌نشیند. قبل از این کار، یک بکاپ ایمنی از
              وضعیت فعلی گرفته می‌شود (در پوشه‌ی بکاپ‌های برنامه) و بعد از جایگزینی، برنامه خودش دوباره باز می‌شود.
            </div>
          </div>
          <div className="border rounded p-2">
            <b>گزینه ۲ — ادغام با داده‌ی فعلی</b>
            <div className="kbd leading-6">
              اطلاعات این بکاپ به داده‌ی فعلی <b>اضافه</b> می‌شود، بدون پاک کردن چیزی؛ هم داده‌ی الان و هم داده‌ی بکاپ
              با هم در گزارش‌ها دیده می‌شوند. کالاها و دسته‌بندی‌های هم‌نام یکی در نظر گرفته می‌شوند (بارکد و مسیر نام
              دسته مبنا است) و شماره‌ی فیش‌های تکراری دوباره شماره‌گذاری می‌شوند. موجودی انبار فعلی تغییر نمی‌کند.
            </div>
          </div>
        </div>
        {/* نشست ۱۸۱ — گیت رمز مدیر (بند ۴-۳۰/۵). سرور بدون این رمز عملیات را رد می‌کند. */}
        <div className="border rounded p-2 space-y-1">
          <b>رمز مدیر</b>
          <div className="kbd leading-6">
            بازگردانی و ادغام بکاپ، داده‌ی مالی را تغییر می‌دهند، پس تأیید مدیر لازم دارند. رمز مدیر (یا رمز دوم پنل
            تنظیمات) را وارد کنید.
          </div>
          <PasswordField
            className="inp"
            value={applyPassword}
            onChange={(e: any) => setApplyPassword(e.target.value)}
            placeholder="رمز مدیر"
            autoComplete="off"
          />
        </div>
        <p className="kbd">
          هر دو حالت در AuditLog ثبت می‌شوند (همراه با اینکه تأیید با رمز مدیر بوده یا رمز دوم پنل). ادغام روی یک
          تراکنش انجام می‌شود: اگر وسط کار خطایی رخ دهد، هیچ‌چیز اضافه نمی‌شود و داده‌ی فعلی مو‌به‌مو مثل قبل می‌ماند.
        </p>
      </Modal>

      {/* ---------------- تایید «آرشیو و پاک‌سازی» ---------------- */}
      <Modal
        open={askSlim}
        title="آرشیو و پاک‌سازی داده‌ی قدیمی"
        onClose={() => setAskSlim(false)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn" onClick={() => setAskSlim(false)} disabled={slimBusy}>
              انصراف
            </button>
            <button className="btn btn-danger" onClick={() => void runArchivePurge()} disabled={slimBusy}>
              {slimBusy ? 'در حال انجام…' : 'بله، آرشیو و پاک کن'}
            </button>
          </>
        }
      >
        <p className="font-bold text-base">
          همه‌ی داده‌ی قبل از {faDigits(slimBefore)} برای همیشه از جدول‌های اصلی پاک می‌شود.
        </p>
        <p className="leading-7">
          {faDigits(slimPreview?.saleInvoices ?? 0)} فاکتور فروش · {faDigits(slimPreview?.purchaseInvoices ?? 0)} فاکتور
          خرید · {faDigits(slimPreview?.saleReturns ?? 0)} برگشت از فروش ·{' '}
          {faDigits(slimPreview?.stockMovements ?? 0)} حرکت انبار قدیمی (دفتر append-only، حفظ می‌شود) · جمع فروش{' '}
          {money(slimPreview?.grandTotal ?? 0)} ریال
        </p>
        <p className="leading-7">
          {slimBackup ? (
            <b>اول یک بکاپ کامل گرفته می‌شود</b>
          ) : (
            <b className="text-red-600">بدون بکاپ! (تیک بکاپ خاموش است)</b>
          )}{' '}
          و در پایان فایل دیتابیس فشرده می‌شود. موجودی فعلی کالاها، خودِ کالاها، مشتریان و تنظیمات دست‌نخورده می‌مانند.
        </p>
        {/* بند ۸ · §۱۰ (جلسه ۳۱) — وضعیت لاگ، صریح در همان لحظه‌ی تایید */}
        <p className="leading-7">
          این عملیات برای کل آرشیو به رمز مدیر نیاز دارد.{' '}
          {slimAudit ? (
            <>
              {faDigits(slimPreview?.auditLogs ?? 0)} ردیف لاگ عملیات پاک می‌شود و{' '}
              <b>{faDigits(slimPreview?.auditLogsProtected ?? 0)} ردیف سابقه‌ی اعتبار خرید محافظت‌شده است</b> و پاک
              نمی‌شود.
            </>
          ) : (
            'پاک‌سازی لاگ عملیات خاموش است و هیچ AuditLog قدیمی حذف نمی‌شود.'
          )}
        </p>
        <p className="kbd">
          این کار برگشت‌پذیر نیست (به‌جز از طریق همان فایل بکاپ). اگر بعداً گزارش این سال‌ها را خواستید، بکاپ را با
          گزینه‌ی «ادغام» برگردانید.
        </p>
      </Modal>

      {/* ---------------- پرسش بازگشت موجودی در لحظه‌ی حذف ---------------- */}
      <Modal
        open={askRestore}
        title={purgeMode === 'selected' ? 'حذف فاکتورهای انتخاب‌شده' : 'حذف گزارشات فروش این بازه'}
        onClose={() => setAskRestore(false)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn" onClick={() => setAskRestore(false)} disabled={purgeBusy}>
              انصراف
            </button>
            <button className="btn" onClick={() => void doPurge(false)} disabled={purgeBusy}>
              خیر، موجودی تغییر نکند
            </button>
            <button className="btn btn-primary" onClick={() => void doPurge(true)} disabled={purgeBusy}>
              بله، موجودی‌ها برگردند
            </button>
          </>
        }
      >
        <p className="font-bold text-base">آیا بعد از حذف، موجودی‌ها به انبار بازگردند؟</p>
        <p className="text-red-700">
          پاک‌سازی فقط با رمز مدیر انجام می‌شود. اگر دوره بسته باشد، دلیل بالا باید حداقل ۳ نویسه باشد.
        </p>
        <p>
          {purgeMode === 'selected'
            ? `${faDigits(selected.length)} فاکتور انتخاب‌شده`
            : `بازه‌ی ${faDigits(purgeFrom)} تا ${faDigits(purgeTo)}`}{' '}
          · {faDigits(purgeTarget?.totals.count ?? 0)} فاکتور · {money(purgeTarget?.totals.grandTotal ?? 0)} ریال
          {purgeTarget?.returnCount
            ? ` · ${faDigits(purgeTarget.returnCount)} برگشت از فروش همین فاکتورها هم حذف می‌شود`
            : ''}
        </p>
        {purgeMode === 'selected' && (
          <p className="kbd leading-6">
            شماره فیش‌های انتخاب‌شده:{' '}
            {faDigits(
              (purgeTarget?.rows ?? [])
                .slice(0, 30)
                .map((r) => r.receiptNo)
                .join('، ')
            )}
            {(purgeTarget?.rows?.length ?? 0) > 30 ? ' …' : ''}
            <br />
            بقیه‌ی فاکتورهای این بازه دست‌نخورده می‌مانند.
          </p>
        )}
        <p className="leading-7">
          <b>بله</b> = {faDigits(purgeTarget?.restoreQty ?? 0)} عدد کالا از{' '}
          {faDigits(purgeTarget?.restoreLines.length ?? 0)} کالا به موجودی انبار اضافه می‌شود (مناسب وقتی این فروش‌ها
          اشتباه ثبت شده‌اند).
          <br />
          <b>خیر</b> = فقط گزارش‌ها پاک می‌شوند و موجودی انبار دست‌نخورده می‌ماند.
        </p>
        <p className="kbd">این کار برگشت‌پذیر نیست؛ همه‌چیز در یک تراکنش انجام و در AuditLog ثبت می‌شود.</p>
      </Modal>
    </div>
  )
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="kbd">{label}</div>
      <div className={`inp bg-slate-50 truncate ${strong ? 'font-bold' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1">{label}</div>
      {children}
    </label>
  )
}
