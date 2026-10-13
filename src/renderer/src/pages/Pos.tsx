import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { isUnknownPrintMessage } from '../lib/printErrors'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { useHotkeys } from '../hooks/useHotkeys'
import { broadcastSettingsChanged, useSettings } from '../hooks/useSettings'
import { usePanelLock, usePanelOpen } from '../hooks/usePanelLocks'
import { useAutoCentralWithdraw } from '../hooks/useAutoCentralWithdraw'
import { useManagerSession } from '../hooks/useManagerSession'
import AutoCentralPasswordBox from '../components/AutoCentralPasswordBox'
import PasswordField from '../components/PasswordField'
import { useCharges } from '../hooks/useCharges'
import VariantSearchBox, { type VariantSearchBoxHandle } from '../components/VariantSearchBox'
import { ColGroup, ResizableHeaderCells, useResizableColumns } from '../components/ResizableColumns'
import { money, faDigits, parseGroupedInteger } from '@shared/jalali'
import { digitsOnly, groupThousands } from '../lib/moneyInput'
import { withFreshSale, type SaleDefaults } from '@shared/receipt'
import { describeChargeRule } from '@shared/charges'
import { describeDiscountPolicy, discountCeilingFor, fixedDiscountFor, scaleLineDiscounts } from '@shared/priceAdjust'
import ManagerGate from '../components/ManagerGate'
import { CENTRAL_WITHDRAW_GATE, PANEL_KEYS } from '@shared/panels'
import type { ActiveDiscountInfo, CartLine, ShiftInfo, StoreCreditSafeRow } from '@shared/types'
import {
  creditCartCoverage,
  isLineExcluded,
  newIdempotencyKey,
  posCreditPlan,
  posPreviewPayload,
  type CreditPreviewLike
} from '@shared/creditUi'

/** کار الف — کادر مشترک «مقصد پول» (بدون پیش‌فرض) */
import PaymentDestinationBox from '../components/PaymentDestinationBox'
import { allowedDestinationsFor, paymentDestinationLabel, PaymentDestination } from '@shared/enums'

/** جلسه ۵۲ · مرحله ۳ — پنجره‌ی «از کدام انبار کسر شود؟» و لایه‌ی خالصِ همان جلسه ۵۱ */
import StockSourceModal from '../components/StockSourceModal'
import {
  STOCK_PICK_TEXT,
  STORE_PICK_KEY,
  buildSingleSourcePlan,
  isStalePlanMessage,
  planShapeErrors,
  planShortLine,
  stockPathFor,
  type StockAllocationPlan,
  type StockSourcePreview
} from '@shared/stockSource'

interface Method {
  id: number
  key: string
  label: string
  kind: string
}

type CustodyOperatorStaff = {
  id: number
  name: string
  role: string
  isActive: boolean
  hasCustodyPin: boolean
  mustChangePin: boolean
}

type CustodyOperatorStatus = {
  enabled: boolean
  governed?: boolean
  custodian?: { id: number; name: string | null } | null
}

/**
 * ===========================================================================
 * مورد ۳ — سرستون‌های جدول اقلام پنل فروش، با «تغییر اندازه‌ی ستون مثل اکسل».
 *
 * همان الگوی آماده‌ی برنامه (`components/ResizableColumns.tsx` + کلاس‌های
 * `th-resizable` / `col-grip` / `tbl-fixed` در styles.css) که از قبل در
 * گزارشات فروش استفاده می‌شد، حالا این جدول را هم می‌پوشاند: نشانگر را روی مرز
 * دو سرستون بگذارید و بکشید تا عرض همان ستون — از جمله ستون تنگِ «مقدار» —
 * دستی تنظیم شود. دوبار کلیک روی مرز = عرض خودکار همان ستون، و دکمه‌ی
 * «بازنشانی عرض ستون‌ها» کل جدول را به حالت اول برمی‌گرداند.
 *
 * عرض‌ها با کلید `pos-items` در همان مخزن همیشگی ذخیره می‌شوند، پس بعد از بستن
 * و باز کردن برنامه هم سر جایشان هستند. تا اولین کشیدن، جدول *مو‌به‌مو* مثل قبل
 * و با چیدمان خودکار مرورگر نمایش داده می‌شود.
 * ===========================================================================
 */
const POS_ITEM_HEADERS = [
  'کد',
  'بارکد',
  'کالا',
  'مقدار',
  'قیمت',
  'تخفیف (درصد / مبلغ)',
  'عوارض و مالیات',
  'مبلغ کل'
]

/** فاکتور تازه ثبت‌شده — برای دکمه‌ی «چاپ فاکتور» و نمایش کد برگشت. */
interface LastInvoice {
  id: number
  receiptNo: number
  returnCode: string | null
  grandTotal: number
  methodLabel: string
  /** true = چاپ قطعی، false = چاپ نشده، UNKNOWN = نتیجه نامعلوم و نباید کاربر را به چاپ دوباره هل بدهیم. */
  printed: boolean | 'UNKNOWN'
  /** مهلت برگشت همین فاکتور (عادی یا «مشتری راه دور») */
  returnCodeDays?: number
  /** بخش ۶: «بارکد اعتبار» مصرف‌شده روی همین فاکتور (پول نقد نیست) */
  storeCredit?: StoreCreditSafeRow | null
  storeCreditApplied?: number
  /** اگر مبلغ اعتبار از فاکتور بیشتر بود، شناسهٔ امنِ باقی‌مانده */
  storeCreditRemainder?: StoreCreditSafeRow | null
  /**
   * بخش ۷ — فروش نسیه: باقی‌ماندهٔ بدهی همین فاکتور در لحظه‌ی ثبت.
   * صفر = تسویه‌ی کامل (رفتار همیشگی پنل فروش).
   */
  remaining?: number
  settled?: boolean
}

/**
 * ===================== پنل فروش تکی (POS) =====================
 * جستجو و اسکن با هم: فیلد بالای صفحه هم نام کالا را جستجو می‌کند و هم ورودی
 * بارکدخوان را می‌شناسد و کالا را مستقیم اضافه می‌کند (VariantSearchBox +
 * useBarcodeScanner). دکمه‌ی «همه کالاها» هم فهرست کامل انبار را برای انتخاب
 * دستی باز می‌کند.
 *
 * بعد از تسویه:
 *   • فاکتور با شیفت جاری و یک «کد فاکتور» رندوم ثبت می‌شود (اعتبار یک هفته).
 *   • رسید با قالب تنظیمات چاپ می‌شود؛ اگر «چاپ خودکار» خاموش باشد، دکمه‌ی
 *     «چاپ فاکتور» برای چاپ دستی همان‌جا می‌ماند و کد فاکتور هم نمایش داده
 *     می‌شود (همان کدی که در پنل «برگشت از فروش» اسکن/وارد می‌شود).
 *   • فاکتور خودکار در «گزارشات فروش» دیده می‌شود (هیچ ثبت دستی لازم نیست).
 *
 * عوارض و مالیات / حق سرویس (بازنویسی‌شده):
 *   دیگر «یک درصد سراسری که هر بار دستی وارد می‌کردید» وجود ندارد. مقدار هر
 *   ردیف از پنل «عوارض و مالیات · پنل فروش» و «حق سرویس · پنل فروش» و بر اساس
 *   *دسته‌بندی همان کالا* (با ارث‌بری از دسته‌ی بالاتر) خودکار حساب می‌شود —
 *   همان `chargeForLine` مشترک در src/shared/charges.ts با اسکوپ `pos`.
 *
 * تخفیف (دو سطح، مستقل و جمع‌شدنی):
 *   • «تخفیف» هر ردیف جدول، با یک کشویی کنارش: «درصد» یا «مبلغ (ریال)». درصد
 *     روی مبلغ همان ردیف حساب می‌شود و در سند به‌صورت مبلغ ریالی ثبت می‌گردد
 *     (پس گزارش «جمع تخفیف» و رسید دست‌نخورده می‌مانند).
 *   • «تخفیف فاکتور» پنل کنار، مثل قبل روی کل فاکتور.
 *   اگر هر دو وارد شوند، هر دو با هم جمع و اعمال می‌شوند؛ اگر یکی وارد شود،
 *   فقط همان.
 *
 * «برداشت خودکار از انبار مرکزی» (چک‌باکس کنار تخفیف فاکتور):
 *   خاموش (پیش‌فرض) = رفتار همیشگی؛ کمبود موجودی، موجودی کالا را منفی می‌کند و
 *   فقط هشدار می‌دهد. روشن = کمبود در لحظه‌ی ثبت فاکتور از «انبار مرکزی» کسر و
 *   به انبار فروشگاه منتقل می‌شود و یک هشدار زرد جزئیاتش را می‌گوید.
 *   ⚠️ فقط مدیر (نشست مدیر فعال) می‌تواند این تیک را عوض کند؛ برای کارمند
 *   قفل است. همین یک تنظیم در «فاکتور فروش عمده» و «تنظیمات انبار مرکزی» هم
 *   نشان داده می‌شود و هر سه محل همیشه یک وضعیت واحد دارند.
 *
 * بند ۲ — «override دستی عوارض و حق سرویس حذف شد»:
 *   تا نسخه‌ی قبل، کنار هر دو عدد یک دکمه‌ی «دستی» بود و فروشنده می‌توانست مبلغ
 *   عوارض/حق سرویس همین فاکتور را هر چه خواست بگذارد. آن مسیر **کامل برداشته
 *   شد**: هر دو عدد حالا فقط‌خواندنی‌اند و تنها منبعشان پنل‌های «عوارض و مالیات ·
 *   پنل فروش» و «حق سرویس · پنل فروش» است (که خودشان قفل رمز دارند). دلیلش
 *   خواسته‌ی صریح مالک نرم‌افزار است: عددی که روی فاکتور مشتری می‌نشیند نباید
 *   سلیقه‌ای باشد، و «جمع مالیات» گزارش‌ها باید با تنظیمات دسته‌بندی بخواند.
 *   ⇒ از این پس عوارض همیشه روی *ردیف‌ها* ثبت می‌شود و `invoiceTax` سند صفر است،
 *     پس هیچ‌وقت دو بار حساب نمی‌شود.
 *
 * بند ۳ — «سیاست تخفیف» (src/shared/priceAdjust.ts):
 *   کادر تخفیف فاکتور داخل `<ManagerGate panel={PANEL_KEYS.posDiscount} inline>`
 *   است، و *علاوه بر آن* سیاست تخفیفِ مدیر سقف اختیار را تعیین می‌کند:
 *     • OFF   ⇒ کادر تخفیف اصلاً نمایش داده نمی‌شود و ستون تخفیف جدول قفل است.
 *     • FIXED ⇒ عدد قابل تایپ نیست؛ فقط یک سوییچ روشن/خاموش برای همان تخفیف
 *               ثابتِ مدیر (`fixedDiscountFor`).
 *     • FREE  ⇒ هر عددی، ولی حداکثر تا `discountCeilingFor` (درصد و مبلغ سقف).
 *   دو سوییچ `allowLine` و `allowInvoice` مستقل‌اند، پس می‌شود «تخفیف کل فاکتور
 *   آزاد، تخفیف تک‌تک کالاها ممنوع» را داشت.
 * ==============================================================
 */
export default function Pos() {
  const nav = useNavigate()
  const { settings, setSettings } = useSettings()
  const { isManager } = useManagerSession()
  // عوارض/حق سرویس بر اساس دسته‌بندی کالا — اسکوپ «پنل فروش خرد»
  const charges = useCharges('pos')
  const [lines, setLines] = useState<CartLine[]>([])
  const [methods, setMethods] = useState<Method[]>([])
  /** CREDIT نسیه است، نه دکمهٔ وصول؛ اعتبارهای سیستمی هم فقط مسیر اختصاصی دارند. */
  const directPaymentMethods = useMemo(
    () => methods.filter((method) => !['CREDIT', 'STORE_CREDIT', 'EXCHANGE_CREDIT'].includes(method.kind)),
    [methods]
  )
  /**
   * پرداخت ترکیبی واقعی نقد + کارت؛ هر سهم به Payment مستقل تبدیل می‌شود.
   * draftها عمداً رشته‌ی خام‌اند تا نمایش سه‌رقم‌سه‌رقم، ارقام فارسی و paste
   * امن باشند؛ فقط `parseGroupedInteger` اجازه دارد آن‌ها را مبلغ کند.
   */
  const [splitPayment, setSplitPayment] = useState(false)
  const [splitCash, setSplitCash] = useState('')
  const [splitCard, setSplitCard] = useState('')
  const [splitCardMethodId, setSplitCardMethodId] = useState<number | null>(null)
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  /** تخفیف فاکتور به‌صورت مبلغ ریالی یا درصدی از جمع کل */
  const [discountMode, setDiscountMode] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT')
  const [discountPercent, setDiscountPercent] = useState(0)
  /**
   * ---------------- بند ۳: سیاست تخفیف پنل فروش ----------------
   * `settings.discount` از همان `SettingsBundle` می‌آید که «تنظیمات → تخفیف»
   * می‌نویسد، پس با هر ذخیره (و رویداد `mahak:settings-changed`) همین لحظه تازه
   * می‌شود و پنل فروش هیچ‌وقت با سقفِ کهنه کار نمی‌کند.
   */
  const policy = settings.discount
  /**
   * قفل ریز «تخفیف پنل فروش». `usePanelOpen` همان تصمیم `ManagerGate` را
   * به‌صورت یک بولین می‌دهد (نشست مدیر / رمز دوم همین قفل / قفلِ خاموش‌شده‌ی
   * ماژول) و قاعده‌ی fail-closed دارد: تا خوانده نشدن سیاست قفل، بسته است.
   * از آن برای *محاسبه* استفاده می‌کنیم تا حتی اگر عددی در state مانده باشد، در
   * جمع فاکتور اثر نکند.
   */
  const discountOpen = usePanelOpen(PANEL_KEYS.posDiscount)
  /** حالت FIXED: فروشنده فقط همان تخفیف ثابتِ مدیر را روشن/خاموش می‌کند */
  const [fixedDiscountOn, setFixedDiscountOn] = useState(false)
  const [tableNo, setTableNo] = useState('')
  /** فیلد مشتری (مورد ۶): شماره تلفن الزامی نیست؛ خالی = «مشتری عمومی» */
  const [customerPhone, setCustomerPhone] = useState('')
  /**
   * §۱۸ — شناسه‌ی مشتریِ پیداشده با تلفن. تا جلسه ۲۷ پیش‌نمایش اعتبار همیشه
   * `customerId: null` می‌فرستاد، پس اعتبارِ «قفل‌شده روی یک مشتری» در پیش‌نمایش
   * بی‌محدودیت به‌نظر می‌رسید و فقط لحظه‌ی ثبت رد می‌شد.
   */
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerHint, setCustomerHint] = useState<string | null>(null)
  /** «مشتری راه دور» (مورد ۷): مهلت برگشت این فاکتور از تنظیم مستقل خوانده می‌شود */
  const [remoteCustomer, setRemoteCustomer] = useState(false)
  /**
   * چک‌باکس «چاپ فاکتور» (مورد ۳) — کلید اصلی چاپ در همین پنل.
   * روشن (پیش‌فرض) = رفتار فعلی؛ خاموش = هیچ فاکتوری چاپ نمی‌شود، نه چاپ خودکار
   * و نه چاپ دستی. ثبت فاکتور و ثبتش در گزارشات فروش هیچ تغییری نمی‌کند.
   * مقدارش در تنظیمات ذخیره می‌شود تا با بستن برنامه پاک نشود.
   */
  const [printEnabled, setPrintEnabled] = useState(settings.sale.printEnabled !== false)
  /** هشدار کمبود موجودی فاکتور ثبت‌شده (مورد ۳) — مانع صدور فاکتور نیست */
  const [warn, setWarn] = useState<string | null>(null)
  const [shift, setShift] = useState<ShiftInfo | null>(null)
  const [last, setLast] = useState<LastInvoice | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /**
   * بنر قابل‌اقدام «نشست لازم است» — با کد SESSION_REQUIRED از main می‌آید و
   * برخلاف خطاهای عادی سبد (lines) دست‌نخورده می‌ماند؛ بعد از ریکاوری نشست،
   * کاربر همان فاکتور را دوباره ثبت می‌کند (بدون retry خودکار). ready فقط بعد
   * از رویداد mahak:shift-changed و درصورتی‌که بنر باز بوده روشن می‌شود.
   */
  const [sessionBlock, setSessionBlock] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const sessionBlockedRef = useRef(false)
  const [busy, setBusy] = useState(false)
  /** In custody mode a POS operator is separate evidence from the drawer
   * custodian. PIN is intentionally cleared after every successful sale. */
  const [custodyPos, setCustodyPos] = useState<CustodyOperatorStatus | null>(null)
  const [operatorStaff, setOperatorStaff] = useState<CustodyOperatorStaff[]>([])
  const [saleOperatorMode, setSaleOperatorMode] = useState<'CUSTODIAN' | 'OPERATOR_PIN' | 'MANAGER_SESSION'>('CUSTODIAN')
  const [saleOperatorUserId, setSaleOperatorUserId] = useState<number | ''>('')
  const [saleOperatorPassword, setSaleOperatorPassword] = useState('')
  const custodyGoverned = custodyPos?.enabled === true || custodyPos?.governed === true
  useEffect(() => {
    if (!isManager && saleOperatorMode === 'MANAGER_SESSION') setSaleOperatorMode('CUSTODIAN')
  }, [isManager, saleOperatorMode])
  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  const [modalOpen, setModalOpen] = useState(false)
  /**
   * ---------------- بخش ۶: «بارکد اعتبار خرید بعدی» ----------------
   * کد روی سند تعویض، که مشتری در خرید بعدی می‌آورد. اسکن یا تایپ می‌شود و با
   * ثبت فاکتور در `CreateSaleInput.storeCreditCode` می‌رود؛ اعتبارسنجی و مصرف
   * یک‌بارمصرفش کامل سمت main و داخل همان تراکنش فاکتور انجام می‌گیرد.
   */
  const [creditCode, setCreditCode] = useState('')
  const [creditInfo, setCreditInfo] = useState<StoreCreditSafeRow | null>(null)
  const [creditErr, setCreditErr] = useState<string | null>(null)
  const [creditBusy, setCreditBusy] = useState(false)
  const [creditPreview, setCreditPreview] = useState<CreditPreviewLike | null>(null)
  const [creditRequested, setCreditRequested] = useState<number | null>(null)
  /**
   * feature flag مدیر: خاموش‌بودن فقط «مبلغ دلخواه اعتبار» را می‌بندد؛ مصرف کامل
   * اعتبارِ معتبر، همان رفتار قدیمی POS، همچنان در دسترس است.
   */
  const splitStoreCreditPayment = settings.sale.splitStoreCreditPayment !== false
  const effectiveCreditRequested = splitStoreCreditPayment ? creditRequested : null
  /**
   * وقتی فوکوس داخل فیلد بارکد اعتبار است، بارکدخوان *سراسری* خاموش می‌شود؛
   * وگرنه کد اعتبار را به‌عنوان بارکد کالا جست‌وجو می‌کرد و «کالا پیدا نشد»
   * می‌داد.
   */
  const [creditFocus, setCreditFocus] = useState(false)
  /**
   * ---------------- بخش ۷: فروش نسیه و پرداخت جزئی ----------------
   * خاموش (پیش‌فرض) = رفتار همیشگی پنل فروش: کل «قابل پرداخت» همان لحظه دریافت
   * می‌شود. روشن = «مبلغ پرداختی» را خودتان می‌نویسید (پیش‌فرض صفر = نسیه‌ی
   * کامل) و باقی‌ماندهٔ بدهی زیر همان فیلد زنده نشان داده می‌شود. سرویس
   * `sales.createSale` از قبل پرداختی کمتر از جمع کل را می‌پذیرد و فاکتور را با
   * `settledAt = null` ثبت می‌کند، پس هیچ تغییری در لایه‌ی داده لازم نیست.
   */
  const [creditMode, setCreditMode] = useState(false)
  const [creditPaid, setCreditPaid] = useState(0)
  /**
   * ---- کار الف: مقصد پولِ «پرداخت جزئی» لحظه‌ی فروش ----
   * `null` = فروشنده چیزی انتخاب نکرده ⇒ سرور مقصد را از روش پرداختی که زده
   * می‌شود *مشتق* می‌کند (نقدی ⇒ کشو، کارت ⇒ کارتخوان). کادر فقط برای همان یک
   * حالتی لازم است که مشتق کردن جوابش را نمی‌دهد: پولی که به حساب مدیر رفته.
   */
  const [creditDestination, setCreditDestination] = useState<string | null>(null)
  const searchRef = useRef<VariantSearchBoxHandle>(null)
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  useEffect(() => {
    call<Method[]>(CH.paymentMethods).then(setMethods).catch(() => {})
    call<ShiftInfo | null>(CH.shiftCurrent, {})
      .then(setShift)
      .catch(() => {})
    void call<CustodyOperatorStatus>(CH.custodyStatus, {})
      .then(async (status) => {
        setCustodyPos(status)
        if (status.enabled || status.governed) {
          const staff = await call<CustodyOperatorStaff[]>(CH.custodyStaffList, {})
          setOperatorStaff(staff.filter((row) => row.isActive && row.hasCustodyPin && !row.mustChangePin && (row.role === 'CASHIER' || row.role === 'MANAGER')))
        }
      })
      .catch(() => {
        // A pre-custody/old database remains on its established POS path.
        setCustodyPos(null)
        setOperatorStaff([])
      })
    searchRef.current?.focus() // فوکوس پیش‌فرض روی فیلد اسکن/جستجو
  }, [])

  const notify = (m: string) => {
    setMsg(m)
    setErr(null)
  }

  /**
   * مشتری با شماره تلفن پیدا می‌شود (مورد ۶). اگر بود، نامش خودکار می‌آید؛
   * اگر نبود، با ثبت فاکتور ساخته می‌شود. این فیلد کاملاً اختیاری است.
   */
  const lookupCustomer = useCallback(async (phone: string) => {
    const p = phone.trim()
    if (p.length < 4) return setCustomerHint(null)
    try {
      const c = await call<any>(CH.customerByPhone, { phone: p })
      if (c) {
        setCustomerName((n) => n || c.name || '')
        setCustomerId(c.id ?? null)
        setCustomerHint(`مشتری موجود: ${c.name} (کد ${c.code})`)
      } else {
        setCustomerId(null)
        setCustomerHint('مشتری جدید است و با ثبت فاکتور ذخیره می‌شود')
      }
    } catch {
      setCustomerId(null)
      setCustomerHint(null)
    }
  }, [])

  // مقدار ذخیره‌شده‌ی چک‌باکس چاپ (و تغییری که در پنل تنظیمات داده شده باشد)
  useEffect(() => {
    setPrintEnabled(settings.sale.printEnabled !== false)
  }, [settings.sale.printEnabled])

  /**
   * روشن/خاموش کردن چاپ فاکتور. همان لحظه ذخیره می‌شود (مثل سوییچ‌های رفتاری
   * دیگر برنامه) تا «یادم رفت ذخیره کنم» باعث چاپ ناخواسته نشود.
   */
  // نشست ۱۶۶ (S166-D4/D6) — سرور تغییر چاپ را با رمز پنل posPrintToggle می‌سنجد (قفل خاموش ⇒ بی‌رمز)؛
  // باز شدن ManagerGate فقط چک‌باکس را نشان می‌دهد، پس رمز کنار چک‌باکس گرفته و بعد از هر تلاش پاک می‌شود.
  const { lockEnabled: printLockOn, loaded: printLockLoaded } = usePanelLock(PANEL_KEYS.posPrintToggle)
  const printNeedPw = !printLockLoaded || printLockOn
  const [printPw, setPrintPw] = useState('')
  const togglePrintEnabled = useCallback(
    async (next: boolean) => {
      if (printNeedPw && !printPw.trim()) {
        setErr('برای روشن/خاموش کردن چاپ فاکتور، رمز مدیر (یا رمز دوم همین گزینه) را در کادر کنار آن وارد کنید.')
        return
      }
      setPrintEnabled(next) // نمایش فوری
      try {
        /**
         * نشست ۱۶۸ (S168-D2) — sale تازه‌ی سرور، نه sale لحظه‌ی بازشدن پنل؛ فقط printEnabled عوض می‌شود تا
         * تغییر تازه‌ی مدیر (نام صندوق‌دار، مهلت کد برگشت…) نه بازنویسی شود و نه درخواست را به رمز مدیر گیر دهد.
         */
        const fresh = await call<{ sale: SaleDefaults }>(CH.settingsBundle)
        const nextSale = withFreshSale(fresh.sale, { printEnabled: next })
        await call(CH.settingsSaveBundle, { sale: nextSale, panelPassword: printNeedPw ? printPw : undefined })
        setSettings((p) => ({ ...p, sale: nextSale }))
        broadcastSettingsChanged()
        setErr(null)
        setMsg(
          next
            ? 'چاپ فاکتور روشن شد · فاکتورها مثل قبل چاپ می‌شوند.'
            : 'چاپ فاکتور خاموش شد · هیچ فاکتوری چاپ نمی‌شود (نه خودکار، نه دستی)، ولی ثبت فاکتور در گزارشات فروش کاملاً عادی انجام می‌شود.'
        )
      } catch (e: any) {
        setPrintEnabled(!next)
        setErr(`ذخیره‌ی وضعیت چاپ انجام نشد: ${e.message}`)
      } finally {
        setPrintPw('')
      }
    },
    [settings.sale, setSettings, printNeedPw, printPw]
  )

  /**
   * چک‌باکس «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی» (مورد ۳ و ۱).
   * یک تنظیم مشترک بین پنل فروش تکی، فاکتور فروش عمده و تنظیمات انبار مرکزی؛
   * فقط مدیر می‌تواند عوضش کند و هر سه محل همیشه همگام‌اند.
   */
  const autoCentralBox = useAutoCentralWithdraw(settings.sale, setSettings)
  const autoCentral = autoCentralBox.value

  /**
   * =========================================================================
   * جلسه ۵۲ · مرحله ۳ — «انتخاب انبار مبدأ کسر» در **فروش تکی**، با قفل.
   *
   * قاعده‌ی مالک، مو‌به‌مو و بی تفسیر اضافه:
   *   • حالت پیش‌فرض (قفل بسته) ⇒ فروشنده **هیچ سؤالی و هیچ انتخابی نمی‌بیند**.
   *     تیک روشن ⇒ همان برداشت خودکار از انبار مرکزی پیش‌فرض (بی سؤال). تیک
   *     خاموش ⇒ همان رفتار امروز (کسر از فروشگاه، موجودی منفی، هشدار زرد).
   *     یعنی در این حالت **هیچ `stockPlan` ای فرستاده نمی‌شود** و مسیر ثبت
   *     بایت‌به‌بایت همان مسیر قبل است.
   *   • فقط وقتی مدیر قفل را باز کند (نشست مدیر، یا رمز دوم اختصاصیِ همین
   *     گزینه، یا خاموش کردن قفل همین ماژول) پنجره‌ی سؤال کسری فعال می‌شود.
   *   • «منوی انتخاب انبار مبدأ» عمداً ساخته نشد: مالک گفت سرعت صندوق مهم است و
   *     فقط پنجره‌ی سؤالِ **هنگام کمبود** لازم است. پس مبدأ همیشه «انبار فروشگاه»
   *     است (`STORE_PICK_KEY`) و پنجره فقط وقتی باز می‌شود که کم بیاید.
   *
   * ⚠️ کلید قفل تازه‌ای ساخته نشد: همان `PANEL_KEYS.posCentralWithdrawToggle`
   * استفاده می‌شود، چون مالک صریحاً «یک قفل واحد» خواست و این گزینه و «برداشت
   * خودکار» دو روی یک تصمیم‌اند. پس قانون بالای `shared/panels.ts` و چک‌لیست
   * README «افزودن ماژول جدید» لازم نشد (ردیف `LOCKED_PANELS` از قبل هست و مدیر
   * می‌تواند همان‌جا رمز دومش را بگذارد).
   *
   * ⚠️ `unlocked` همان بولینی است که `ManagerGate` با این کلید می‌گیرد
   * (`usePanelOpen(...) || isManager`)، پس دو منطق موازی وجود ندارد.
   */
  const stockPickUnlocked = autoCentralBox.unlocked
  /**
   * قفلِ *ماژول* روشن است؟ اگر روشن باشد، سرور برای پذیرفتن `stockPlan` رمز
   * می‌خواهد (`assertPanelPassword`)، پس پنجره هم رمز می‌گیرد. اگر مدیر آگاهانه
   * قفل همین کلید را خاموش کرده باشد، سرور بی رمز `OPEN` می‌دهد و پنجره هم
   * رمز نمی‌پرسد — همان سیاست موجود «قفل ماژول‌ها»، بی اختراع تازه.
   */
  const { lockEnabled: stockPickLockOn } = usePanelLock(PANEL_KEYS.posCentralWithdrawToggle)

  /** پنجره‌ی باز (یا `null`). `decide` جواب کاربر را به `settle` برمی‌گرداند. */
  const [stockChain, setStockChain] = useState<{
    preview: StockSourcePreview
    decide: (plan: StockAllocationPlan | null, password: string | null) => void
  } | null>(null)
  /** خلاصه‌ی «مبدأ کسر» آخرین فیش (فقط وقتی برنامه‌ای فرستاده شده باشد) */
  const [stockPlanNote, setStockPlanNote] = useState<string | null>(null)

  // خطای ذخیره / پیام قفل مدیر، در همان کادر خطای صفحه دیده می‌شود
  useEffect(() => {
    if (autoCentralBox.error) setErr(autoCentralBox.error)
  }, [autoCentralBox.error])

  /**
   * ---------------- بند ۳: سه بولینِ «اجازه» ----------------
   *   • ستون تخفیف جدول فقط در حالت FREE معنا دارد: در FIXED، «تخفیف ثابت مدیر»
   *     تنها تخفیف مجاز است و دست‌کاری قیمت تک‌تک کالاها دقیقاً همان چیزی است که
   *     این حالت جلویش را می‌گیرد.
   *   • کادر تخفیف فاکتور در OFF اصلاً ساخته نمی‌شود (نه غیرفعال: ساخته نمی‌شود).
   */
  const lineDiscountAllowed = discountOpen && policy.mode === 'FREE' && policy.allowLine
  const invoiceDiscountAllowed = discountOpen && policy.mode !== 'OFF' && policy.allowInvoice
  /** کادر تخفیف باید *دیده* شود؟ (مستقل از باز بودن قفل؛ قفل را خود گیت می‌گیرد) */
  const discountBoxVisible = policy.mode !== 'OFF' && policy.allowInvoice

  /** چرا ستون تخفیف جدول قفل است — متن دقیق، نه یک «غیرفعال» بی‌دلیل. */
  const lineDiscountReason = useMemo(() => {
    if (policy.mode === 'OFF') return 'سیاست تخفیف «غیرفعال» است؛ هیچ تخفیفی قابل ثبت نیست.'
    if (policy.mode === 'FIXED')
      return 'سیاست تخفیف «فقط تخفیف ثابت مدیر» است؛ تخفیف تک‌تک کالاها بسته است.'
    if (!policy.allowLine) return 'مدیر «تخفیف روی خودِ کالا» را بسته است؛ فقط تخفیف کل فاکتور مجاز است.'
    return 'قفل «تخفیف پنل فروش» باز نشده است؛ رمز را در کادر تخفیف کنار فاکتور وارد کنید.'
  }, [policy.mode, policy.allowLine])

  // سیاست که عوض شود (OFF/FREE)، سوییچ تخفیف ثابت نباید روشن بماند
  useEffect(() => {
    if (policy.mode !== 'FIXED') setFixedDiscountOn(false)
  }, [policy.mode])

  /** افزودن یک واریانت به سبد (اگر بود، فقط تعدادش زیاد می‌شود). */
  const addVariant = useCallback((v: any) => {
    if (!v) return
    setErr(null)
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === v.id)
      if (i >= 0) {
        const copy = [...prev]
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 }
        return copy
      }
      return [
        ...prev,
        {
          variantId: v.id,
          code: v.code,
          barcode: v.barcode,
          name: `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`,
          qty: 1,
          unitPrice: v.salePrice ?? 0,
          discount: 0,
          tax: 0,
          // برای محاسبه‌ی عوارض/حق سرویس بر اساس دسته‌بندی همین کالا
          categoryId: v.product?.categoryId ?? null,
          // موجودی لحظه‌ی افزودن — فقط برای هشدار زودهنگام کمبود موجودی
          stock: v.stock ?? 0,
          discountMode: 'AMOUNT',
          discountValue: 0
        }
      ]
    })
  }, [])

  /** مسیر بارکدخوان فیزیکی: تطبیق کامل بارکد. */
  const addByBarcode = useCallback(
    async (barcode: string) => {
      const now = performance.now()
      if (lastScan.current.code === barcode && now - lastScan.current.at < 350) return
      lastScan.current = { code: barcode, at: now }
      try {
        const v = await call<any>(CH.variantByBarcode, { barcode })
        searchRef.current?.clear()
        if (!v) return setErr(`کالایی با بارکد ${faDigits(barcode)} پیدا نشد`)
        addVariant(v)
      } catch (e: any) {
        setErr(e.message)
      }
    },
    [addVariant]
  )

  // بارکدخوان سراسری: در این صفحه همیشه فعال (به‌جز وقتی مودال باز است)
  useBarcodeScanner(addByBarcode, { enabled: !modalOpen && !creditFocus && stockChain == null })

  /** بررسی بارکد اعتبار *بدون* مصرف کردنش (دکمه‌ی «بررسی»). */
  const lookupCredit = useCallback(async (raw: string) => {
    const code = raw.trim()
    setCreditInfo(null)
    setCreditErr(null)
    if (!code) return
    setCreditBusy(true)
    try {
      const row = await call<StoreCreditSafeRow>(CH.storeCreditLookup, { code })
      setCreditInfo(row)
    } catch (e: any) {
      // پیام‌های فارسی تفکیک‌شده از main می‌آیند («قبلاً مصرف شده» / «منقضی» / …)
      setCreditErr(e.message)
    } finally {
      setCreditBusy(false)
    }
  }, [])

  /**
   * ===================== جمع‌های فاکتور (بند ۲ و ۳) =====================
   * دو تغییر نسبت به نسخه‌ی قبل، و هر دو عمدی:
   *
   * ۱) **عوارض و حق سرویس دیگر override ندارند** (بند ۲): هر دو مستقیماً از
   *    `charges.compute` — یعنی از تنظیمات دسته‌بندی کالا — می‌آیند. هیچ مسیری
   *    برای «عدد دلخواه این فاکتور» باقی نمانده است.
   *
   * ۲) **تخفیف از صافیِ سیاست عبور می‌کند** (بند ۳). سقف با
   *    `discountCeilingFor(policy, goods)` گرفته می‌شود. از نشست ۱۵۴ (S151-b) همین
   *    تابع سمت main هم در `SalesService.create/update` (`preverifySalePolicy`) بازه را
   *    enforce می‌کند و عبور از آن حتی با رمز مدیر رد می‌شود؛ پیش از آن این بازه فقط
   *    در UI بود. نشست ۱۶۷ · Y11 (S167-D2): گرد ردیف‌های کوتاه‌شده دیگر با
   *    Math.round جداگانه نیست؛ `scaleLineDiscounts` جمع را دقیقاً برابر سقف نگه می‌دارد
   *    تا سرور (بدون هیچ tolerance) فروش را رد نکند. اگر خواسته‌ی فروشنده از
   *    سقف بیشتر بود، *اول* تخفیف فاکتور کوتاه می‌شود و بعد تخفیف ردیف‌ها
   *    (`lineScale`)، و `clipped` می‌گوید چقدر کوتاه شد تا در UI صریح گفته شود.
   *    کوتاه‌کردن بی‌صدا، همان باگی است که فاکتور چاپی و گزارش را واگرا می‌کند.
   * =====================================================================
   */
  const totals = useMemo(() => {
    const goods = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)

    /** سقف کل تخفیف مجاز این فاکتور (قفل بسته ⇒ صفر؛ fail-closed) */
    const ceiling = discountOpen ? discountCeilingFor(policy, goods) : 0

    const rawLineDisc = lineDiscountAllowed ? lines.reduce((s, l) => s + l.discount, 0) : 0
    const rawInvoiceDisc = !invoiceDiscountAllowed
      ? 0
      : policy.mode === 'FIXED'
        ? fixedDiscountOn
          ? fixedDiscountFor(policy, goods)
          : 0
        : discountMode === 'PERCENT'
          ? Math.round((goods * Math.min(100, Math.max(0, discountPercent || 0))) / 100)
          : Math.max(0, Math.round(invoiceDiscount || 0))

    const lineDisc = Math.min(rawLineDisc, ceiling)
    const invoiceDisc = Math.min(rawInvoiceDisc, Math.max(0, ceiling - lineDisc))
    const clipped = Math.max(0, rawLineDisc + rawInvoiceDisc - (lineDisc + invoiceDisc))
    /** ضریب کوتاه‌شدن تخفیف ردیف‌ها (۱ = دست‌نخورده) — هم در نمایش، هم در سند */
    const lineScale = rawLineDisc > 0 ? lineDisc / rawLineDisc : 1
    /**
     * نشست ۱۶۷ · Y11 (S167-D2) — تخفیف نهایی هر ردیف با یک توزیع مشترک که جمعش دقیقاً = lineDisc است
     * (نه Math.round جداگانه که جمعش چند ریال از سقف رد می‌شد و سرور فروش را رد می‌کرد).
     */
    const scaledArr = lineDiscountAllowed ? scaleLineDiscounts(lines.map((l) => l.discount), lineDisc) : lines.map(() => 0)
    const scaledLineDisc = new Map<CartLine, number>(lines.map((l, i) => [l, scaledArr[i]]))
    const disc = lineDisc + invoiceDisc

    // سهم تخفیف فاکتور روی هر ردیف، تا «مبلغ خالص ردیف» مبنای درست درصد عوارض
    // باشد (وگرنه عوارضِ درصدی روی مبلغی حساب می‌شد که مشتری نپرداخته است).
    const grossAfterLineDisc = Math.max(0, goods - lineDisc)
    const share = grossAfterLineDisc > 0 ? Math.min(1, invoiceDisc / grossAfterLineDisc) : 0
    const breakdown = charges.compute(
      lines.map((l, i) => {
        const lineGross = l.unitPrice * l.qty - scaledArr[i]
        return { categoryId: l.categoryId ?? null, lineNet: Math.max(0, Math.round(lineGross * (1 - share))), qty: l.qty }
      })
    )

    const tax = breakdown.taxTotal
    const service = breakdown.serviceTotal
    const netAfterDiscount = Math.max(0, goods - disc)
    return {
      goods,
      lineDisc,
      invoiceDisc,
      disc,
      /** سقف کل تخفیف مجاز (برای راهنمای کنار کادر تخفیف) */
      ceiling,
      /** چقدر از خواسته‌ی فروشنده به‌خاطر سقف سیاست کوتاه شد */
      clipped,
      lineScale,
      /** نشست ۱۶۷ · Y11 — تخفیف نهایی هر ردیف (جمع = lineDisc) */
      scaledLineDisc,
      /** عوارض هر ردیف — همیشه روی همان ردیف ثبت و چاپ می‌شود (بند ۲) */
      taxPerLine: breakdown.taxPerLine,
      service,
      tax,
      payable: netAfterDiscount + service + tax
    }
  }, [
    lines,
    invoiceDiscount,
    discountMode,
    discountPercent,
    charges.compute,
    policy,
    discountOpen,
    lineDiscountAllowed,
    invoiceDiscountAllowed,
    fixedDiscountOn
  ])

  /** تخفیف *نهایی* یک ردیف (با ضریب سقف سیاست) — یک تابع، دو مصرف‌کننده. */
  const lineDiscountOf = useCallback(
    // نشست ۱۶۷ · Y11 — از همان نقشه‌ی جمع‌دقیق؛ ردیف ناشناخته (نباید پیش بیاید) با کف، که هرگز از سقف رد نمی‌شود
    (l: CartLine) =>
      lineDiscountAllowed ? (totals.scaledLineDisc.get(l) ?? Math.min(l.discount, Math.floor(l.discount * totals.lineScale))) : 0,
    [lineDiscountAllowed, totals.scaledLineDisc, totals.lineScale]
  )

  /**
   * ---------------- بخش ۶ — سهم «بارکد اعتبار» از همین فاکتور ----------------
   * تا سقف «قابل پرداخت» همین فاکتور. اگر اعتبار بیشتر باشد، مابقی سمت main به
   * شکل یک بارکد اعتبار *جدید* به مشتری برمی‌گردد (سوخت نمی‌شود).
   *
   * ⚠️ این عدد باید *قبل از ثبت* از مبلغ نقدِ دریافتی کم شود: سمت main سقف جذب
   * اعتبار = «باقی‌ماندهٔ فاکتور» است، پس اگر کل مبلغ را نقد بفرستیم باقی‌مانده
   * صفر می‌شود و اعتبار جایی برای خرج‌شدن ندارد.
   */
  /**
   * ردیف‌های سبد به شکلی که ماژول اعتبار می‌فهمد: مبلغ *خالصِ* ردیف (بعد از
   * تخفیف ردیف و با سقف سیاست) و `categoryId` همان ردیف.
   *
   * §۱۸ — تا جلسه ۲۷ payload پیش‌نمایش `lineTotal: l.price * l.qty` می‌فرستاد
   * (فیلدی که روی `CartLine` وجود ندارد ⇒ `NaN/undefined`) و `categoryId` را هم
   * نمی‌فرستاد، پس محدودیت دسته‌بندی در پیش‌نمایش عملاً بی‌اثر بود.
   */
  const creditLines = useMemo(
    () =>
      lines.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        categoryId: l.categoryId ?? null,
        lineTotal: Math.max(0, l.unitPrice * l.qty - lineDiscountOf(l))
      })),
    [lines, lineDiscountOf]
  )

  const creditPlan = useMemo(
    () => posCreditPlan({ payable: totals.payable, preview: creditPreview, requestedInput: effectiveCreditRequested }),
    [creditPreview, effectiveCreditRequested, totals.payable]
  )
  const creditApplied = creditPlan.applied

  /**
   * §۱۸ — «در UI مصرف اعتبار مشخص شود کدام اقلام سبد قابل پوشش‌اند».
   * `excludedVariantIds` از جلسه ۲۱ تا `Pos.tsx` می‌آمد و دور ریخته می‌شد؛
   * تقسیمش تنها در `creditCartCoverage` انجام می‌شود (تصمیمِ تست‌شده).
   */
  const creditCoverage = useMemo(
    () =>
      creditCartCoverage({
        lines: creditLines,
        excludedVariantIds: creditPlan.excludedVariantIds,
        scopeLabel: creditInfo?.restrictScopeLabel ?? null
      }),
    [creditLines, creditPlan.excludedVariantIds, creditInfo]
  )

  /** نقدی/کارتی که *واقعاً* باید از مشتری گرفته شود: قابل پرداخت منهای اعتبار. */
  const cashDue = useMemo(() => Math.max(0, totals.payable - creditApplied), [totals.payable, creditApplied])

  /**
   * `null` یعنی متن واردشده (اعشار/منفی/حرف/بزرگ‌تر از عدد امن) مبلغ معتبر نیست.
   * با این تفکیک، هیچ ورودی نمایشی پیش از ثبت با `Number` یا `Math.round` تغییر
   * معنا نمی‌دهد؛ به‌ویژه «۱.۲» هرگز به‌اشتباه «۱۲» ریال نمی‌شود.
   */
  const splitCashAmount = useMemo(() => parseGroupedInteger(splitCash), [splitCash])
  const splitCardAmount = useMemo(() => parseGroupedInteger(splitCard), [splitCard])
  const splitTotal = useMemo(() => {
    if (splitCashAmount == null || splitCardAmount == null) return null
    const total = splitCashAmount + splitCardAmount
    return Number.isSafeInteger(total) ? total : null
  }, [splitCashAmount, splitCardAmount])

  useEffect(() => {
    const payload = creditInfo
      ? posPreviewPayload({
          code: creditCode,
          payable: totals.payable,
          requested: effectiveCreditRequested,
          customerId,
          lines: creditLines
        })
      : null
    if (!payload) {
      setCreditPreview(null)
      return
    }
    let alive = true
    call<CreditPreviewLike>(CH.creditPreview, payload)
      .then((p) => alive && setCreditPreview(p))
      .catch(() => alive && setCreditPreview(null))
    return () => {
      alive = false
    }
  }, [creditCode, creditInfo, effectiveCreditRequested, creditLines, totals.payable, customerId])

  /**
   * بخش ۷ — «بدهی باقی‌مانده» زنده: قابل پرداخت منهای اعتبار مصرف‌شده و منهای
   * مبلغ پرداختی واردشده. در حالت عادی (تیک نسیه خاموش) همیشه صفر است.
   */
  const creditRemaining = useMemo(
    () => (creditMode ? Math.max(0, cashDue - Math.min(Math.max(0, Math.round(creditPaid || 0)), cashDue)) : 0),
    [creditMode, creditPaid, cashDue]
  )

  /**
   * هشدار زودهنگام کمبود موجودی، همان لحظه‌ی اسکن/انتخاب کالا (مورد ۳).
   * فقط اطلاع‌رسانی است و جلوی هیچ کاری را نمی‌گیرد؛ برداشت واقعی از انبار
   * مرکزی سمت main و در لحظه‌ی ثبت فاکتور (اتمیک) انجام می‌شود.
   */
  const shortLines = useMemo(
    () => lines.filter((l) => l.stock != null && l.qty > (l.stock ?? 0)),
    [lines]
  )

  const shortageNotice = useMemo(() => {
    if (!shortLines.length) return null
    const detail = shortLines
      .map(
        (l) =>
          `«${l.name}» (موجودی فروشگاه ${faDigits(l.stock ?? 0)} · درخواست ${faDigits(l.qty)} ⇒ کمبود ${faDigits(
            l.qty - (l.stock ?? 0)
          )})`
      )
      .join(' · ')
    return autoCentral
      ? `موجودی انبار فروشگاه برای ${faDigits(shortLines.length)} قلم کافی نیست: ${detail}\n` +
          'با ثبت فاکتور، این کمبود به‌صورت خودکار از «انبار مرکزی» کسر و به انبار فروشگاه منتقل می‌شود.'
      : /**
         * جلسه ۵۲ · مرحله ۳ — با قفل *باز*، راه سومی هم وجود دارد: هنگام ثبت،
         * پنجره‌ی «از کدام انبار کسر شود؟» پرسیده می‌شود. با قفل بسته، متن
         * مو‌به‌مو همان قبل است تا فروشنده چیزی از این قابلیت نبیند.
         */
        `موجودی انبار فروشگاه برای ${faDigits(shortLines.length)} قلم کافی نیست: ${detail}\n` +
          (stockPickUnlocked
            ? 'هنگام ثبت پرسیده می‌شود که کسری هر قلم از کدام انبار برداشته شود (یا با منفی شدن همان انبار ادامه دهید). ' +
              'اگر می‌خواهید بی هیچ سؤالی از انبار مرکزی پیش‌فرض برداشته شود، چک‌باکس «برداشت خودکار از انبار مرکزی» را روشن کنید.'
            : 'فاکتور ثبت می‌شود ولی موجودی این کالاها منفی خواهد شد. اگر می‌خواهید کمبود از انبار مرکزی برداشته شود، ' +
              'مدیر باید چک‌باکس «برداشت خودکار از انبار مرکزی» را روشن کند (این تیک برای کارمند قفل است).')
  }, [shortLines, autoCentral, stockPickUnlocked])

  const printInvoice = useCallback(
    async (invoiceId: number) => {
      // مورد ۳: با خاموش بودن چک‌باکس چاپ، چاپ دستی هم انجام نمی‌شود
      if (!printEnabled)
        return setErr(
          'چاپ فاکتور در این پنل خاموش است، پس هیچ فاکتوری چاپ نمی‌شود. برای چاپ، چک‌باکس «چاپ فاکتور» را روشن کنید.'
        )
      if (printingRef.current) return
      printingRef.current = true
      setPrinting(true)
      try {
        /**
         * فاز ۳ — از مسیر مشترک `printWith` (انصراف = لغو قطعی و بی‌صدا).
         */
        const res = await printWith('INVOICE', (deviceName, opts) =>
          call(CH.printInvoice, { invoiceId, deviceName, silent: opts?.silent })
        )
        if (res === 'CANCELLED') return
        setLast((p) => (p && p.id === invoiceId ? { ...p, printed: true } : p))
        notify('رسید فاکتور چاپ شد')
      } catch (e: any) {
        const unknown = isUnknownPrintMessage(e)
        if (unknown) setLast((p) => (p && p.id === invoiceId ? { ...p, printed: 'UNKNOWN' } : p))
        setErr(
          unknown
            ? `معلوم نیست رسید چاپ شده باشد: ${e.message} قبل از چاپ دوباره خروجی چاپگر را ببینید.`
            : `چاپ انجام نشد: ${e.message}`
        )
      } finally {
        printingRef.current = false
        setPrinting(false)
      }
    },
    [printEnabled]
  )

  /**
   * پنجره را باز می‌کند و منتظر جواب می‌ماند: برنامه + رمز، یا `null` یعنی «لغو»
   * ⇒ هیچ فیشی ثبت نمی‌شود. خودِ زنجیره‌ی سؤال‌ها در `StockSourceModal` و با همان
   * `resolveLine` مشترک جلو می‌رود؛ اینجا فقط انتظار است (هیچ منطقی پیاده نشده).
   */
  /** نام کالا از سبد (برای خلاصه‌ی «مبدأ کسر») — سبد بعد از ثبت خالی می‌شود، پس
   *  خلاصه همان‌جا و قبل از خالی شدن ساخته می‌شود. */
  const nameOfVariant = useCallback(
    (variantId: number) => lines.find((l) => l.variantId === variantId)?.name ?? `کالای ${faDigits(variantId)}`,
    [lines]
  )

  const askStockChain = useCallback(
    (preview: StockSourcePreview) =>
      new Promise<{ plan: StockAllocationPlan | null; password: string | null }>((resolve) => {
        setStockChain({
          preview,
          decide: (plan, password) => {
            setStockChain(null)
            resolve({ plan, password })
          }
        })
      }),
    []
  )

  /**
   * -------------------------------------------------------------------------
   * «برنامه‌ی کسر» این فیش — یا `undefined` یعنی «برنامه‌ای لازم نیست، مثل قبل برو».
   *
   * سه خروجی ممکن، و هر سه عمدی‌اند:
   *   • `undefined` ⇒ مسیر مو‌به‌موی قبل: قفل بسته، یا تیک روشن (برداشت خودکار از
   *     انبار مرکزی پیش‌فرض)، یا موجودی انبار فروشگاه برای همه‌ی اقلام **کافی**
   *     است. در این حالت هیچ `stockPlan` ای فرستاده نمی‌شود، هیچ دفتر مبدأیی
   *     ساخته نمی‌شود و سرعت صندوق دست نمی‌خورد.
   *   • `{ plan, password }` ⇒ کمبود بود، قفل باز بود، کاربر جواب داد.
   *   • `null` ⇒ کاربر «لغو کل فیش» را زد.
   *
   * ⚠️ `stock:sourcePreview` **هیچ چیزی نمی‌نویسد** (فقط خواندن موجودی‌ها)، پس
   * لغو در هر مرحله هیچ اثری روی انبار ندارد.
   * ⚠️ چرا با موجودیِ کافی هم برنامه نمی‌فرستیم: قاعده‌ی مالک می‌گوید فروشنده در
   * حالت عادی نباید چیزی ببیند و سرعت صندوق مهم است. فرستادن برنامه‌ی «همه از
   * فروشگاه» رفتار را عوض نمی‌کرد ولی یک رفت‌وبرگشت و یک دفتر مبدأ اضافه می‌ساخت.
   * -------------------------------------------------------------------------
   */
  const resolveStockPlan = useCallback(async (): Promise<
    { plan: StockAllocationPlan; password: string | null } | null | undefined
  > => {
    /** همان تابع خالص جلسه ۵۱ — تصمیم «برنامه یا مسیر خودکار قبلی». */
    const path = stockPathFor({
      deductInventory: true,
      storePicked: true,
      autoCentral,
      editing: false,
      hasLedger: false
    })
    // تیک روشن ⇒ فقط انبار مرکزی پیش‌فرض، بی هیچ سؤالی (قاعده‌ی نهایی مالک)
    if (!path.planPath) return undefined
    // قفل بسته ⇒ فروشنده هیچ سؤالی نمی‌بیند و رفتار امروز دست‌نخورده می‌ماند
    if (!stockPickUnlocked) return undefined

    const want = lines
      .map((l) => ({ variantId: l.variantId, qty: Math.round(l.qty), name: l.name }))
      .filter((l) => l.qty > 0)
    if (!want.length) return undefined

    const preview = await call<StockSourcePreview>(CH.stockSourcePreview, {
      lines: want.map((l) => ({ variantId: l.variantId, qty: l.qty }))
    })
    /** کاوش با مبدأ «انبار فروشگاه»: کافی بود ⇒ هیچ پنجره‌ای باز نمی‌شود. */
    const probe = buildSingleSourcePlan(preview.lines, STORE_PICK_KEY)
    if (probe.errors.length) throw new Error(probe.errors.join('\n'))
    if (!probe.shortages.length) return undefined

    const answer = await askStockChain(preview)
    if (!answer.plan) return null
    // همان اعتبارسنجی شکلی‌ای که سرور هم *قبل از* هر نوشتنی انجام می‌دهد
    const shape = planShapeErrors(answer.plan, want)
    if (shape.length) throw new Error('برنامه‌ی کسر موجودی کامل نشد:\n' + shape.map((e) => `• ${e}`).join('\n'))
    return { plan: answer.plan, password: answer.password }
  }, [lines, autoCentral, stockPickUnlocked, askStockChain])

  /**
   * رویداد «mahak:shift-changed» از چیپ نشست — اگر بنر SESSION_REQUIRED باز
   * بود جمع می‌شود و پیام «دوباره ثبت کنید» می‌آید؛ هیچ retry خودکاری نیست.
   */
  useEffect(() => {
    const onChanged = () => {
      if (!sessionBlockedRef.current) return
      sessionBlockedRef.current = false
      setSessionBlock(null)
      setSessionReady(true)
    }
    window.addEventListener('mahak:shift-changed', onChanged)
    return () => window.removeEventListener('mahak:shift-changed', onChanged)
  }, [])

  const settle = useCallback(
    async (methodKey: string) => {
      if (busy) return
      if (!lines.length) return setErr('فاکتور خالی است')
      const isSplit = methodKey === '__SPLIT__'
      const method = isSplit ? null : methods.find((m) => m.key === methodKey)
      const cashMethod = directPaymentMethods.find((m) => m.kind === 'CASH')
      const cardMethod = directPaymentMethods.find((m) => m.id === splitCardMethodId) ?? directPaymentMethods.find((m) => m.kind === 'CARD')
      if (!isSplit && !method) return setErr('روش پرداخت پیدا نشد')
      if (isSplit && (!cashMethod || !cardMethod)) return setErr('برای پرداخت ترکیبی باید یک روش نقدی و یک روش کارتی فعال باشد.')
      if (isSplit && creditMode) return setErr('پرداخت ترکیبی نقد + کارت با نسیه/پرداخت جزئی هم‌زمان نیست؛ ابتدا مبلغ کامل را تسویه کنید.')
      if (custodyGoverned && saleOperatorMode === 'OPERATOR_PIN' && (!saleOperatorUserId || !saleOperatorPassword.trim()))
        return setErr('برای ثبت فروش توسط اپراتور دیگر، نام اپراتور و رمز شخصی حضانت او را وارد کنید.')
      if (custodyGoverned && saleOperatorMode === 'MANAGER_SESSION' && !isManager)
        return setErr('برای ثبت فروش با نشست مدیر، ابتدا با رمز مدیر وارد شوید؛ رمز مشترک هرگز به نام یک مدیر مشخص ثبت نمی‌شود.')
      /**
       * بخش ۶ — اگر کد اعتباری تایپ شده ولی هنوز «بررسی» نشده است، *قبل از* ثبت
       * فاکتور بررسی می‌شود. دلیلش مهم است: مبلغ اعتبار باید از نقدِ دریافتی کم
       * شود و این کار بدون دانستن مبلغ اعتبار ممکن نیست. اگر کد نامعتبر بود،
       * همین‌جا با پیام فارسی متوقف می‌شویم و هیچ فاکتوری ثبت نمی‌شود.
       */
      if (creditCode.trim() && !creditInfo) {
        await lookupCredit(creditCode)
        return setErr(
          'بارکد اعتبار بررسی شد؛ نتیجه‌اش را بالای صفحه ببینید و اگر معتبر بود دوباره «ثبت» را بزنید ' +
            '(مبلغ اعتبار باید پیش از ثبت از مبلغ دریافتی کم شود).'
        )
      }
      setBusy(true)
      setErr(null)
      setSessionBlock(null)
      setSessionReady(false)
      sessionBlockedRef.current = false
      try {
        /**
         * بخش ۷ — مبلغی که *همین حالا* دریافت می‌شود:
         *   • حالت عادی: کل «قابل پرداخت» (مو‌به‌مو مثل قبل).
         *   • حالت نسیه: عددی که فروشنده نوشته (بین صفر و قابل پرداخت). صفر ⇒
         *     هیچ ردیف پرداختی ساخته نمی‌شود و کل فاکتور بدهی می‌ماند.
         */
        if (isSplit && (splitCashAmount == null || splitCardAmount == null || splitTotal == null))
          return setErr('مبلغ نقد یا کارت معتبر نیست؛ فقط عدد صحیحِ غیرمنفی (بدون اعشار، منفی یا حرف) وارد کنید.')
        if (isSplit && (splitCashAmount <= 0 || splitCardAmount <= 0))
          return setErr('پرداخت ترکیبی باید یک سهم نقدیِ مثبت و یک سهم کارتیِ مثبت داشته باشد.')
        const paidNow = isSplit ? splitTotal! : creditMode ? Math.min(Math.max(0, Math.round(creditPaid || 0)), cashDue) : cashDue
        if (isSplit && splitTotal !== cashDue)
          return setErr(`جمع نقد و کارت باید دقیقاً ${money(cashDue)} ریال باشد؛ اکنون ${money(splitTotal!)} ریال است.`)
        /**
         * ---- کار الف: مقصد فقط وقتی فرستاده می‌شود که واقعاً انتخاب شده باشد ----
         * و اگر انتخابش با روش پرداختی که همین حالا زده شد سازگار نباشد (مثلاً
         * «کارتخوان» با دکمه‌ی «نقدی»)، همین‌جا با پیام فارسی می‌ایستیم و به سرور
         * نمی‌رویم — همان سیاست پروژه. فهرست مجاز از همان `allowedDestinationsFor`
         * است که سرور هم با آن اعتبارسنجی می‌کند، پس دو قاعده نمی‌شوند.
         */
        const destination = !isSplit && creditMode && paidNow > 0 ? creditDestination : null
        if (destination && !allowedDestinationsFor(method!.kind).includes(destination as any)) {
          setBusy(false)
          return setErr(
            `مقصد «${paymentDestinationLabel(destination)}» با روش پرداخت «${method!.label}» سازگار نیست. ` +
              `برای این روش فقط ${allowedDestinationsFor(method!.kind)
                .map((d) => `«${paymentDestinationLabel(d)}»`)
                .join(' یا ')} ممکن است — یا مقصد را عوض کنید، یا روش پرداخت دیگری بزنید.`
          )
        }
        /**
         * بند ۲ — عوارض *همیشه* روی ردیف ثبت می‌شود و `invoiceTax` سند صفر است،
         * پس جمع مالیات هیچ‌وقت دوبار حساب نمی‌شود.
         * بند ۳ — تخفیف ردیف هم همان عددی است که روی صفحه دیده شد (با ضریب سقف
         * سیاست)، نه عددی که فروشنده تایپ کرده بود.
         */
        const payloadLines = lines.map((l, i) => ({
          ...l,
          discount: lineDiscountOf(l),
          tax: totals.taxPerLine[i] ?? 0
        }))
        const basePayload = {
          lines: payloadLines,
          ...(custodyGoverned
            ? {
                saleOperatorMode,
                saleOperatorUserId: saleOperatorMode === 'OPERATOR_PIN' ? saleOperatorUserId : null,
                saleOperatorPassword: saleOperatorMode === 'OPERATOR_PIN' ? saleOperatorPassword : null
              }
            : {}),
          invoiceDiscount: totals.invoiceDisc,
          serviceCharge: totals.service,
          // بند ۲: مالیات سطح فاکتور همیشه صفر است (روی ردیف‌ها نشسته است)
          invoiceTax: 0,
          tableNo: tableNo.trim() || null,
          // مورد ۶ و ۷: مشتری (اختیاری) و مهلت برگشت مشتری راه دور
          customerPhone: customerPhone.trim() || null,
          customerName: customerName.trim() || null,
          remoteCustomer,
          // مورد ۳: برداشت خودکار کمبود از انبار مرکزی (فقط وقتی تیک روشن باشد)
          autoCentralWithdraw: autoCentral,
          // بخش ۶: بارکد اعتبار خرید بعدی (اعتبارسنجی و مصرفش سمت main است)
          storeCreditCode: creditCode.trim() || null,
          storeCreditAmount: creditCode.trim() ? (effectiveCreditRequested == null ? null : creditApplied) : null,
          storeCreditIdempotencyKey: creditCode.trim() ? newIdempotencyKey('pos-credit') : null,
          // بخش ۷: پرداختی جزئی یا هیچ پرداختی (نسیه‌ی کامل)
          splitPayment: isSplit || undefined,
          payments: isSplit
            ? [
                { methodId: cashMethod!.id, amount: splitCashAmount!, destination: 'CASH' },
                { methodId: cardMethod!.id, amount: splitCardAmount!, destination: 'CARD' }
              ].filter((payment) => payment.amount > 0)
            : paidNow > 0
              ? [{ methodId: method!.id, amount: paidNow, destination: destination ?? undefined }]
              : []
        }

        /**
         * -------------------------------------------------------------------
         * جلسه ۵۲ · مرحله ۳ — ثبت، با «مبدأ کسر» فقط وقتی لازم و مجاز باشد.
         *
         * ترتیب عمدی: اول `preview` و (اگر کمبود بود و قفل باز بود) جواب کاربر —
         * هیچ نوشتنی — و بعد ثبت. اگر سرور `STOCK_PLAN_STALE` بدهد یعنی موجودی
         * بین پنجره و ثبت عوض شده و **هیچ چیزی ثبت نشده**؛ پس همان‌جا `preview`
         * با موجودی تازه دوباره اجرا می‌شود و سؤال دوباره پرسیده می‌شود. سقف
         * تلاش دارد تا حلقه‌ی بی‌پایان نشود. عیناً همان الگوی فاکتور عمده.
         *
         * ⚠️ در حالت پیش‌فرض (قفل بسته، یا موجودی کافی، یا تیک روشن) هیچ
         * درخواستِ اضافه‌ای نمی‌رود: `resolveStockPlan` بی هیچ تماسی `undefined`
         * می‌دهد و همین حلقه در همان تلاش اول با `basePayload` تمام می‌شود.
         * -------------------------------------------------------------------
         */
        const MAX_STALE_RETRY = 2
        let inv: any = null
        let planNote: string | null = null
        for (let attempt = 0; ; attempt++) {
          const picked = await resolveStockPlan()
          if (picked === null)
            // کاربر «لغو» را زد ⇒ هیچ فیشی ثبت نمی‌شود و هیچ انباری عوض نمی‌شود
            return setErr(STOCK_PICK_TEXT.cancelled)
          /**
           * ⚠️ سرور `stockPlan` + `autoCentralWithdraw: true` را با هم رد می‌کند
           * (دو مسیر پوشش کمبود هیچ‌وقت با هم اجرا نمی‌شوند). پنجره فقط با تیک
           * خاموش باز می‌شود، ولی برای اینکه این وابستگی *در کد* هم صریح باشد،
           * همراه برنامه صریحاً `false` فرستاده می‌شود. خودِ تنظیمِ تیک
           * دست‌نخورده می‌ماند.
           */
          const payload = picked
            ? {
                ...basePayload,
                autoCentralWithdraw: false,
                stockPlan: picked.plan,
                // قفل سمت سرور: `assertPanelPassword(posCentralWithdrawToggle, …)`
                panelPassword: picked.password
              }
            : basePayload
          try {
            inv = await call<any>(CH.saleCreate, payload)
            planNote = picked ? planShortLine(picked.plan, (id) => nameOfVariant(id), faDigits) : null
            break
          } catch (e: any) {
            if (picked && isStalePlanMessage(e) && attempt < MAX_STALE_RETRY) {
              setErr(e.message)
              continue
            }
            throw e
          }
        }
        setStockPlanNote(planNote)

        /**
         * کمبود موجودی دیگر مانع نیست (مورد ۳): فاکتور ثبت و چاپ شده و موجودی
         * کالا منفی رفته است؛ فقط همان هشدار زرد را نشان می‌دهیم.
         */
        setWarn(inv.stockWarnings?.length ? inv.stockWarnings.join('\n') : null)

        /**
         * چاپ خودکار (اگر در تنظیمات روشن باشد). نشدن چاپ، فاکتور را خراب
         * نمی‌کند. مورد ۳: چک‌باکس «چاپ فاکتور» کلید اصلی است — خاموش که باشد،
         * نه چاپ خودکار انجام می‌شود و نه چاپ دستی، ولی فاکتور کاملاً عادی ثبت
         * می‌شود و در گزارشات فروش می‌آید.
         */
        let printNote = ''
        let printed: LastInvoice['printed'] = false
        if (!printEnabled) printNote = ' (چاپ فاکتور خاموش است؛ فاکتور ثبت شد و در گزارشات فروش هست)'
        else if (settings.receipt.autoPrint) {
          printingRef.current = true
          setPrinting(true)
          try {
            /**
             * فاز ۳ — چاپ خودکار هم از `printWith` می‌گذرد: اگر «هر بار بپرس»
             * روشن باشد پنجره‌ی انتخاب چاپگر می‌آید (خواست مالک) و انصراف یعنی
             * هیچ چاپی انجام نمی‌شود — بدون خطا و بدون خراب‌کردن فاکتور.
             */
            const res = await printWith('INVOICE', (deviceName, opts) =>
              call(CH.printInvoice, { invoiceId: inv.id, deviceName, silent: opts?.silent })
            )
            if (res === 'DONE') printed = true
            else printNote = ' (چاپ انجام نشد؛ فاکتور ثبت شد و در گزارشات فروش هست)'
          } catch (e: any) {
            const raw = String(e?.message ?? e)
            const unknown = isUnknownPrintMessage(e)
            if (unknown) printed = 'UNKNOWN'
            printNote = unknown
              ? ' (معلوم نیست فاکتور چاپ شده باشد؛ قبل از چاپ دوباره خروجی چاپگر را نگاه کنید)'
              : ` (چاپ خودکار انجام نشد: ${raw})`
          } finally {
            printingRef.current = false
            setPrinting(false)
          }
        }

        setLast({
          id: inv.id,
          receiptNo: inv.receiptNo,
          returnCode: inv.returnCode ?? null,
          grandTotal: inv.grandTotal ?? totals.payable,
          // در پرداخت ترکیبی `method` عمداً null است؛ برچسب ثابت مانع خطای
          // پس از ثبت موفق فاکتور می‌شود (قبلاً UI خطا می‌داد، با اینکه سند ثبت شده بود).
          methodLabel: isSplit ? 'نقد + کارت' : method!.label,
          printed,
          returnCodeDays: inv.returnCodeDays,
          storeCredit: inv.storeCredit ?? null,
          storeCreditApplied: Math.max(0, Math.round(inv.storeCreditApplied ?? 0)),
          storeCreditRemainder: inv.storeCreditRemainder ?? null,
          // بخش ۷: باقی‌ماندهٔ بدهی همان عددی است که سرویس حساب کرده است
          remaining: Math.max(0, Math.round(inv.remaining ?? 0)),
          settled: inv.settled !== false
        })
        setLines([])
        setInvoiceDiscount(0)
        setDiscountPercent(0)
        setFixedDiscountOn(false)
        setTableNo('')
        setCustomerPhone('')
        setCustomerName('')
        setCustomerHint(null)
        setRemoteCustomer(false)
        setCreditCode('')
        setCreditInfo(null)
        setCreditErr(null)
        setCreditMode(false)
        setCreditPaid(0)
        // PIN is one-sale proof, never a reusable renderer session credential.
        setSaleOperatorPassword('')
        setCreditDestination(null)
        // مبلغ‌های فاکتور قبلی نباید روی فاکتور بعدی بمانند یا با قابل‌پرداخت جدید مقایسه شوند.
        setSplitPayment(false)
        setSplitCash('')
        setSplitCard('')
        setSplitCardMethodId(null)
        notify(
          `فیش شماره ${faDigits(inv.receiptNo)} ثبت شد · ${money(inv.grandTotal ?? totals.payable)} ریال · ${isSplit ? 'نقد + کارت' : method!.label}` +
            (inv.returnCode ? ` · کد فاکتور: ${inv.returnCode}` : '') +
            // بخش ۷: فروش نسیه ⇒ باقی‌ماندهٔ بدهی و راه ثبت پرداختی بعدی
            (inv.remaining > 0
              ? ` · نسیه: ${money(paidNow)} ریال دریافت شد` +
                (destination === PaymentDestination.MANAGER
                  ? ' (به حساب مدیر — در کشو و کارتخوان فروشگاه نیست)'
                  : '') +
                ` و ${money(inv.remaining)} ریال بدهی ماند (پرداختی بعدی را از «گزارشات فروش → نسیه» ثبت کنید)`
              : '') +
            (inv.storeCreditApplied > 0 ? ` · اعتبار مصرف‌شده: ${money(inv.storeCreditApplied)} ریال` : '') +
            (inv.storeCreditRemainder
              ? ` · باقی‌مانده‌ی ${inv.storeCreditRemainder.publicReference} (${money(
                  inv.storeCreditRemainder.amount
                )} ریال) صادر و برای مشتری چاپ شد`
              : '') +
            printNote
        )
        searchRef.current?.clear()
        searchRef.current?.focus()
        call<ShiftInfo | null>(CH.shiftCurrent, {})
          .then(setShift)
          .catch(() => {})
      } catch (e: any) {
        /**
         * SESSION_REQUIRED: عمداً setErr نشه — بنر جداگانه‌ی قابل‌اقدام + سبد
         * دست‌نخورده می‌ماند (setLines([]) فقط بعد از موفقیت) تا کاربر همان
         * فاکتور را بعد از ریکاوری نشست دوباره ثبت کند.
         */
        if (e?.code === 'SESSION_REQUIRED') {
          sessionBlockedRef.current = true
          setSessionBlock(e.message)
        } else {
          // پیام‌ها از main فارسی می‌آیند (مثلاً «موجودی کافی نیست…»)
          setErr(e.message)
        }
      } finally {
        setBusy(false)
      }
    },
    [
      busy,
      lines,
      methods,
      directPaymentMethods,
      splitCashAmount,
      splitCardAmount,
      splitTotal,
      splitCardMethodId,
      invoiceDiscount,
      totals,
      lineDiscountOf,
      tableNo,
      customerPhone,
      customerName,
      remoteCustomer,
      autoCentral,
      printEnabled,
      creditCode,
      creditInfo,
      lookupCredit,
      // جلسه ۵۲ · مرحله ۳
      resolveStockPlan,
      nameOfVariant,
      cashDue,
      creditMode,
      creditPaid,
      creditDestination,
      settings.receipt.autoPrint
    ]
  )

  const clearCart = useCallback(() => {
    setLines([])
    setInvoiceDiscount(0)
    setDiscountPercent(0)
    setFixedDiscountOn(false)
    setTableNo('')
    setErr(null)
    searchRef.current?.clear()
    searchRef.current?.focus()
  }, [])

  useHotkeys(
    useMemo(
      () => ({
        F3: () => void settle('CASH'),
        F6: () => (last ? void printInvoice(last.id) : undefined),
        F7: clearCart,
        F8: () => void settle('CASH')
      }),
      [settle, clearCart, printInvoice, last]
    ),
    // جلسه ۵۲: تا پنجره‌ی «از کدام انبار کسر شود؟» باز است، F3/F8 دوباره ثبت نزنند
    !modalOpen && stockChain == null && !printing
  )

  /**
   * =========================================================================
   * مورد ۱ (بخش دوم) — نمایش «تخفیف گروهیِ در جریان» روی هر ردیف سبد.
   *
   * مسئله: «تغییر قیمت گروهی» مستقیم روی `ProductVariant.salePrice` می‌نویسد،
   * پس قیمتِ پایین‌آمده از همان لحظه در پنل فروش هست — ولی فروشنده و مشتری
   * هیچ‌جا نمی‌دیدند که این قیمت *نتیجه‌ی یک تخفیف* است. حالا زیر ستون «قیمت»
   * قیمت قبل (خط‌خورده) و درصد/مبلغ تخفیف و — اگر زمان‌بندی پایان دارد — تا چه
   * تاریخی معتبر است نشان داده می‌شود.
   *
   * سه نکته‌ی عمدی:
   *   • هیچ عددی از این بخش در فاکتور نمی‌نشیند؛ کاملاً نمایشی است. مبلغ ردیف
   *     همان `unitPrice` واقعی است و با تخفیف دستی فروشنده هم جمع می‌شود
   *     (دو لایه‌ی مستقل، مثل قبل).
   *   • فقط برای کالاهای *داخل سبد* پرسیده می‌شود، نه کل انبار.
   *   • اگر این کانال خطا بدهد، سبد بی‌صدا بدون برچسب نمایش داده می‌شود؛ فروش
   *     هیچ‌وقت به‌خاطر یک برچسب تبلیغاتی نمی‌خوابد.
   * =========================================================================
   */
  const [promos, setPromos] = useState<Record<number, ActiveDiscountInfo>>({})
  /** امضای پایدار از شناسه‌ی کالاهای سبد (تا تغییر «تعداد» درخواست تازه نسازد) */
  const promoKey = useMemo(
    () =>
      lines
        .map((l) => l.variantId)
        .sort((a, b) => a - b)
        .join(','),
    [lines]
  )

  useEffect(() => {
    const ids = promoKey ? promoKey.split(',').map(Number) : []
    if (!ids.length) {
      setPromos({})
      return
    }
    let alive = true
    void (async () => {
      try {
        const rows = await call<ActiveDiscountInfo[]>(CH.priceAdjustActiveDiscounts, { variantIds: ids })
        if (!alive) return
        const map: Record<number, ActiveDiscountInfo> = {}
        for (const r of rows ?? []) map[r.variantId] = r
        setPromos(map)
      } catch {
        if (alive) setPromos({})
      }
    })()
    return () => {
      alive = false
    }
  }, [promoKey])

  /**
   * تخفیف ردیف = مبلغ ریالی نهایی، حتی وقتی کاربر «درصد» انتخاب کرده باشد.
   * پس تعداد که عوض شود، تخفیف درصدی خودکار دوباره حساب می‌شود و از مبلغ ردیف
   * هم بیشتر نمی‌شود (تا «مبلغ کل» ردیف منفی نشود).
   */
  const withLineDiscount = (l: CartLine): CartLine => {
    const gross = Math.max(0, Math.round(l.unitPrice * l.qty))
    const value = Math.max(0, Math.round(l.discountValue ?? l.discount ?? 0))
    const amount =
      l.discountMode === 'PERCENT' ? Math.round((gross * Math.min(100, value)) / 100) : Math.min(value, gross)
    return { ...l, discountValue: value, discount: Math.min(amount, gross) }
  }

  const patchLine = (id: number, patch: Partial<CartLine>) =>
    setLines((p) => p.map((l) => (l.variantId === id ? withLineDiscount({ ...l, ...patch }) : l)))

  const setQty = (id: number, qty: number) => patchLine(id, { qty: Math.max(1, Math.round(qty || 1)) })
  /** عددی که در فیلد تخفیف ردیف تایپ می‌شود (ریال یا درصد، طبق کشویی کنارش) */
  const setDiscountValue = (id: number, v: number) => patchLine(id, { discountValue: Math.max(0, +v || 0) })
  const setLineDiscountMode = (id: number, mode: 'AMOUNT' | 'PERCENT') => patchLine(id, { discountMode: mode })

  /**
   * مورد ۳ — چیدمان عرض ستون‌های جدول اقلام (ستون آخر، ستون دکمه‌ی «حذف»، عنوان
   * ندارد، پس با `extraColumns` شمرده می‌شود و دستگیره‌ی خودش را دارد).
   */
  const itemCols = useResizableColumns('pos-items', POS_ITEM_HEADERS.length + 1)

  return (
    <div className="grid grid-cols-12 gap-3 h-full">
      <section className="col-span-9 flex flex-col gap-2">
        <div className="bg-white rounded shadow p-2 flex gap-2 items-center flex-wrap">
          <span className="font-bold">پنل فروش</span>
          {shift && (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${shift.closed ? 'bg-slate-200' : 'bg-emerald-100'}`}>
              {shift.name} · {faDigits(shift.dayJalali)} · {faDigits(shift.invoiceCount)} فاکتور
            </span>
          )}
          {/* مورد ۳ — فقط وقتی کاربر عرض ستونی را دستی عوض کرده باشد دیده می‌شود */}
          {itemCols.customized && (
            <button
              className="btn py-0.5"
              onClick={itemCols.reset}
              title="بازگشت عرض ستون‌های جدول اقلام به حالت خودکار"
            >
              بازنشانی عرض ستون‌ها
            </button>
          )}
          <div className="ms-auto flex gap-1">
            <button className="btn" onClick={() => nav('/sales-return')}>
              برگشت از فروش
            </button>
            <button className="btn" onClick={() => nav('/sales-reports')}>
              گزارشات فروش <span className="keycap">F9</span>
            </button>
            <button className="btn" onClick={() => nav('/settings')}>
              تنظیمات
            </button>
          </div>
        </div>

        <div className="flex gap-2 items-center bg-white p-2 rounded shadow">
          <VariantSearchBox
            ref={searchRef}
            onPick={addVariant}
            autoFocus
            placeholder="بارکد را اسکن کنید یا نام / کد کالا را بنویسید"
            onAllOpenChange={setModalOpen}
            allTitle="انتخاب کالا از فهرست انبار"
          />
          <label className="flex items-center gap-1 whitespace-nowrap">
            <span className="kbd">میز / سفارش</span>
            <input className="inp w-24 py-1" value={tableNo} onChange={(e) => setTableNo(e.target.value)} />
          </label>
        </div>

        {/* ---------- مشتری (اختیاری) + مشتری راه دور ---------- */}
        <div className="flex gap-2 items-center bg-white p-2 rounded shadow flex-wrap">
          <label className="flex items-center gap-1 whitespace-nowrap">
            <span className="kbd">شماره تلفن مشتری (اختیاری)</span>
            <input
              className="inp w-40 py-1 text-center"
              dir="ltr"
              value={customerPhone}
              placeholder="09xxxxxxxxx"
              onChange={(e) => {
                setCustomerPhone(e.target.value)
                setCustomerId(null)
              }}
              onBlur={(e) => void lookupCustomer(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 whitespace-nowrap">
            <span className="kbd">نام مشتری</span>
            <input className="inp w-40 py-1" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label
            className={`flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded border-2 cursor-pointer ${
              remoteCustomer ? 'bg-emerald-50 border-emerald-400 font-bold' : 'border-slate-300'
            }`}
            title={`مهلت برگشت این فاکتور از تنظیم «مشتری راه دور» حساب می‌شود (${faDigits(
              settings.sale.returnCodeDaysRemote
            )} روز) نه مهلت عادی (${faDigits(settings.sale.returnCodeDays)} روز)`}
          >
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={remoteCustomer}
              onChange={(e) => setRemoteCustomer(e.target.checked)}
            />
            مشتری راه دور
            <span className="kbd">
              مهلت برگشت {faDigits(remoteCustomer ? settings.sale.returnCodeDaysRemote : settings.sale.returnCodeDays)} روز
            </span>
          </label>
          {/* ---------- بخش ۶: اسکن «بارکد اعتبار خرید بعدی» ---------- */}
          <label className="flex items-center gap-1 whitespace-nowrap">
            <span className="kbd">بارکد اعتبار</span>
            <input
              className="inp w-40 py-1 text-center tracking-widest"
              dir="ltr"
              value={creditCode}
              placeholder="مثلاً E7M4QP"
              onFocus={() => setCreditFocus(true)}
              onBlur={(e) => {
                setCreditFocus(false)
                void lookupCredit(e.target.value)
              }}
              onChange={(e) => {
                setCreditCode(e.target.value.toUpperCase())
                setCreditInfo(null)
                setCreditErr(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookupCredit(creditCode)
                }
              }}
              title="کد روی «سند تعویض» مشتری. اسکن یا تایپ کنید؛ مبلغش از قابل پرداخت کم می‌شود ولی در «خالص واقعی دریافتی» گزارش شمرده نمی‌شود."
            />
            <button className="btn py-1" onClick={() => void lookupCredit(creditCode)} disabled={creditBusy || !creditCode.trim()}>
              {creditBusy ? '…' : 'بررسی'}
            </button>
          </label>
          {creditInfo && (
            <span className="kbd text-emerald-800 font-bold">
              اعتبار معتبر: {money(creditInfo.amount)} ریال
              {creditInfo.expiresAtJalali ? ` · تا ${faDigits(creditInfo.expiresAtJalali)}` : ''}
              {creditInfo.customerName ? ` · ${creditInfo.customerName}` : ''} · با ثبت فاکتور مصرف می‌شود
            </span>
          )}
          {creditInfo && splitStoreCreditPayment && (
            <label className="flex items-center gap-1">
              <span className="kbd">مبلغ مصرف اعتبار (خالی = حداکثر ممکن)</span>
              <input className="inp w-36 py-1" type="number" min={0} value={creditRequested ?? ''} onChange={e => setCreditRequested(e.target.value === '' ? null : Math.max(0, +e.target.value || 0))} />
            </label>
          )}
          {creditInfo && !splitStoreCreditPayment && (
            <span className="kbd text-slate-700">پرداخت ترکیبی اعتبار در تنظیمات فروش خاموش است؛ اعتبار تا سقف مجاز کامل مصرف می‌شود.</span>
          )}
          {creditErr && <span className="kbd text-amber-800 font-bold whitespace-pre-line">{creditErr}</span>}
          {/* §۱۸ — تقسیم سبد به «پوشش‌دار / خارج از دامنه» و پیام‌های خودِ پیش‌نمایش */}
          {creditCoverage.message && (
            <span className="kbd text-amber-900 font-bold whitespace-pre-line basis-full">{creditCoverage.message}</span>
          )}
          {creditPlan.notes.map((t) => (
            <span className="kbd text-slate-700 whitespace-pre-line basis-full" key={t}>
              • {t}
            </span>
          ))}
          {customerHint && <span className="kbd">{customerHint}</span>}
          <span className="kbd ms-auto">خالی بگذارید = فاکتور برای «مشتری عمومی» ثبت می‌شود</span>
        </div>

        {/*
          بخش ۴ — رفع تنگی UI: همان الگوی SalesInvoice.tsx. جدول اقلام یک کف
          ارتفاع دارد (min-h) و از نیمی از ارتفاع پنجره بلندتر نمی‌شود (max-h)،
          پس با باز شدن کادرهای زیرش آب نمی‌رود و سرستون‌ها هم با اسکرول سر جای
          خودشان می‌مانند.
        */}
        <div className="bg-white rounded shadow overflow-auto flex-1 min-h-[240px] max-h-[46vh]">
          <table className={itemCols.tableClass} ref={itemCols.tableRef}>
            <ColGroup widths={itemCols.widths} />
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                {/* مورد ۳ — سرستون‌های قابل‌کشیدن (مثل اکسل) */}
                <ResizableHeaderCells headers={POS_ITEM_HEADERS} cols={itemCols} extraColumns={1} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                // بند ۲: عوارض ردیف همیشه از تنظیمات دسته‌بندی می‌آید
                const lineTax = totals.taxPerLine[i] ?? 0
                // بند ۳: تخفیف ردیف بعد از اعمال سقف سیاست
                const lineDisc = lineDiscountOf(l)
                const rule = charges.explain(l.categoryId ?? null)
                // مورد ۱ — تخفیف گروهیِ در جریان روی همین کالا (فقط نمایشی)
                const promo = promos[l.variantId] ?? null
                /* §۱۸ — این قلم خارج از دامنه‌ی مجاز اعتبارِ اسکن‌شده است؟ */
                const outOfCredit = creditCoverage.restricted && isLineExcluded(l.variantId, creditCoverage.excludedIds)
                return (
                <tr key={l.variantId} className={outOfCredit ? 'bg-amber-50' : ''}>
                  <td>{faDigits(l.code)}</td>
                  <td>{faDigits(l.barcode)}</td>
                  <td>
                    {l.name}
                    {outOfCredit && (
                      <span
                        className="kbd bg-amber-200 border border-amber-400 rounded px-1 mx-1"
                        title="اعتبار خریدِ اسکن‌شده روی این قلم قابل استفاده نیست؛ مبلغ این ردیف باید نقد/کارتی پرداخت شود."
                      >
                        خارج از دامنه‌ی اعتبار
                      </span>
                    )}
                  </td>
                  <td className="w-24">
                    <input
                      type="number"
                      min={1}
                      className="inp py-0.5"
                      value={l.qty}
                      onChange={(e) => setQty(l.variantId, +e.target.value)}
                    />
                  </td>
                  <td
                    title={
                      promo
                        ? `قیمت پایه ${money(promo.basePrice)} ریال · ${promo.label}` +
                          (promo.batchTitles.length ? `\n${promo.batchTitles.join(' · ')}` : '') +
                          (promo.endsLabel ? `\n${promo.endsLabel}` : '')
                        : undefined
                    }
                  >
                    <div className={promo ? 'font-bold text-rose-700' : ''}>{money(l.unitPrice)}</div>
                    {promo && (
                      <div className="leading-5">
                        <span className="kbd line-through text-slate-400">{money(promo.basePrice)}</span>{' '}
                        <span className="kbd text-rose-700 font-bold">
                          {faDigits(String(promo.discountPercent).replace(/\.0$/, ''))}٪ · {money(promo.discountAmount)}{' '}
                          ریال تخفیف
                        </span>
                        {promo.endsLabel && <div className="kbd text-rose-700">{promo.endsLabel}</div>}
                      </div>
                    )}
                  </td>
                  {/**
                    * تخفیف همین ردیف: عدد + کشویی «درصد / مبلغ (ریال)».
                    * بند ۳ — تا قفل «تخفیف پنل فروش» باز نشود و سیاست هم FREE با
                    * اجازه‌ی «تخفیف روی کالا» نباشد، این دو کنترل غیرفعال‌اند و
                    * دلیلش زیر همان خانه نوشته می‌شود (قفل، نه پنهان‌کاری).
                    */}
                  <td className="w-56">
                    <div className="flex gap-1 items-center">
                      <input
                        type="number"
                        min={0}
                        max={l.discountMode === 'PERCENT' ? 100 : undefined}
                        className={`inp py-0.5 w-20 ${lineDiscountAllowed ? '' : 'bg-slate-100'}`}
                        value={l.discountValue ?? 0}
                        disabled={!lineDiscountAllowed}
                        onChange={(e) => setDiscountValue(l.variantId, +e.target.value)}
                        title={
                          lineDiscountAllowed
                            ? 'تخفیف فقط روی همین کالا؛ با تخفیف کل فاکتور جمع می‌شود'
                            : lineDiscountReason
                        }
                      />
                      <select
                        className={`inp py-0.5 w-28 ${lineDiscountAllowed ? '' : 'bg-slate-100'}`}
                        value={l.discountMode ?? 'AMOUNT'}
                        disabled={!lineDiscountAllowed}
                        onChange={(e) =>
                          setLineDiscountMode(l.variantId, e.target.value === 'PERCENT' ? 'PERCENT' : 'AMOUNT')
                        }
                      >
                        <option value="PERCENT">درصد</option>
                        <option value="AMOUNT">مبلغ (ریال)</option>
                      </select>
                    </div>
                    {lineDiscountAllowed ? (
                      lineDisc > 0 && <div className="kbd">{money(lineDisc)} ریال</div>
                    ) : (
                      <div className="kbd text-amber-800">🔒 {lineDiscountReason}</div>
                    )}
                    {/* مورد ۱ — این تخفیف *گروهی* است و از قیمت خودِ کالا آمده،
                        پس با تخفیف دستی بالا جمع نمی‌شود و قابل تغییر هم نیست. */}
                    {promo && (
                      <div className="kbd text-rose-700">
                        + تخفیف گروهی روی قیمت کالا: {money(promo.discountAmount * l.qty)} ریال
                      </div>
                    )}
                  </td>
                  <td
                    title={`عوارض این دسته: ${describeChargeRule(rule.tax)} · حق سرویس: ${describeChargeRule(
                      rule.service
                    )} — این عدد فقط از تنظیمات دسته‌بندی می‌آید و دستی قابل تغییر نیست (بند ۲).`}
                  >
                    {money(lineTax)}
                  </td>
                  <td>{money(l.unitPrice * l.qty - lineDisc + lineTax)}</td>
                  <td>
                    <button
                      className="text-red-500"
                      onClick={() => setLines((p) => p.filter((x) => x.variantId !== l.variantId))}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
                )
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    بارکد کالا را اسکن کنید، نام کالا را جستجو کنید، یا از دکمه‌ی «همه کالاها» انتخاب کنید
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---------- فاکتور ثبت‌شده: کد فاکتور + چاپ ---------- */}
        {last && (
          <div className="bg-sky-50 border-2 border-sky-400 rounded p-2 flex flex-wrap items-center gap-3">
            <b>فیش شماره {faDigits(last.receiptNo)} ثبت شد</b>
            <span>{money(last.grandTotal)} ریال</span>
            <span className="kbd">{last.methodLabel}</span>
            {last.returnCode && (
              <span className="px-2 py-1 rounded bg-white border font-bold" dir="ltr" title="کد برگشت از فروش">
                {last.returnCode}
              </span>
            )}
            {!!last.storeCreditApplied && (
              <span className="px-2 py-1 rounded bg-white border font-bold" title="مبلغ اعتبار مصرف‌شده روی این فاکتور">
                اعتبار مصرف‌شده {money(last.storeCreditApplied)} ریال
                {last.storeCredit ? ` · ${last.storeCredit.publicReference}` : ''}
              </span>
            )}
            {last.storeCreditRemainder && (
              <span
                className="px-2 py-1 rounded bg-amber-50 border-2 border-amber-400 font-bold"
                title="باقی‌ماندهٔ اعتبار سوخت نشد و برای مشتری چاپ شد"
              >
                {last.storeCreditRemainder.publicReference} · {money(last.storeCreditRemainder.amount)}
              </span>
            )}
            {/* بخش ۷: فاکتور نسیه ⇒ باقی‌ماندهٔ بدهی، واضح و جدا */}
            {!!last.remaining && (
              <span
                className="px-2 py-1 rounded bg-amber-50 border-2 border-amber-400 font-bold"
                title="این فاکتور نسیه ثبت شد؛ پرداختی‌های بعدی را از تب «نسیه»ی گزارشات فروش ثبت کنید"
              >
                نسیه · باقی‌ماندهٔ بدهی {money(last.remaining)} ریال
              </span>
            )}
            {printEnabled ? (
              <button className="btn btn-primary" onClick={() => void printInvoice(last.id)} disabled={printing}>
                {printing ? 'در حال چاپ…' : 'چاپ فاکتور'} <span className="keycap">F6</span>
              </button>
            ) : (
              <span className="kbd">چاپ فاکتور خاموش است</span>
            )}
            <button className="btn" onClick={() => nav('/sales-return')}>
              برگشت از فروش با همین کد
            </button>
            <span className="kbd">
              {!printEnabled
                ? 'چاپ خاموش'
                : last.printed === 'UNKNOWN'
                  ? 'معلوم نیست رسید چاپ شده؛ اول خروجی چاپگر را ببینید'
                  : last.printed
                    ? 'رسید چاپ شد'
                    : 'رسید هنوز چاپ نشده است'}{' '}
              · مهلت برگشت این فاکتور{' '}
              {faDigits(last.returnCodeDays ?? settings.sale.returnCodeDays)} روز است
            </span>
            <button className="btn ms-auto" onClick={() => setLast(null)}>
              بستن
            </button>
          </div>
        )}

        {/* هشدار زودهنگام: هنوز فاکتور ثبت نشده، فقط کمبود موجودی سبد را می‌گوید */}
        {shortageNotice && (
          <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">
            {shortageNotice}
          </div>
        )}

        {/* هشدار کمبود موجودی: فاکتور ثبت و چاپ شده، موجودی منفی رفته است (مورد ۳) */}
        {warn && (
          <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">
            {warn}
            <button className="btn ms-2 py-0.5" onClick={() => setWarn(null)}>
              متوجه شدم
            </button>
          </div>
        )}

        {/**
          * جلسه ۵۲ · مرحله ۳ — «مبدأ کسر این فیش»، فقط وقتی برنامه‌ای فرستاده شده
          * باشد (یعنی کمبود بود و مدیر قفل را باز کرده بود). در حالت پیش‌فرض این
          * کادر هیچ‌وقت ساخته نمی‌شود، پس صفحه‌ی فروشنده مو‌به‌مو مثل قبل است.
          */}
        {stockPlanNote && (
          <div className="rounded px-3 py-2 border bg-sky-50 border-sky-300 whitespace-pre-line">
            <b>{STOCK_PICK_TEXT.summaryTitle}: </b>
            {stockPlanNote}
            <button className="btn ms-2 py-0.5" onClick={() => setStockPlanNote(null)}>
              متوجه شدم
            </button>
          </div>
        )}

        {sessionBlock && (
          <div className="rounded px-3 py-2 border-2 border-red-500 bg-red-50 text-red-900 flex items-center gap-2 justify-between whitespace-pre-line">
            <span>{sessionBlock}</span>
            <button
              className="btn shrink-0 border-2 border-red-700 font-bold"
              onClick={() => window.dispatchEvent(new Event('mahak:open-shift-modal'))}
            >
              حل مسئله‌ی نشست — باز کردن نشست
            </button>
          </div>
        )}
        {sessionReady && (
          <div className="rounded px-3 py-2 border bg-emerald-50 border-emerald-400 text-emerald-800 flex items-center gap-2 justify-between">
            <span>نشست آماده است؛ همان فاکتور را دوباره ثبت کنید.</span>
            <button className="btn" onClick={() => setSessionReady(false)} title="بستن">
              ✕
            </button>
          </div>
        )}
        {(msg || err) && (
          <div
            className={`rounded px-3 py-2 border whitespace-pre-line ${
              err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
            }`}
          >
            {err ?? msg}
          </div>
        )}
      </section>

      <aside className="col-span-3 flex flex-col gap-2">
        <div className="order-1 bg-white rounded shadow p-3 space-y-2">
          <div className="flex justify-between">
            <span>جمع کل</span>
            <b>{money(totals.goods)}</b>
          </div>
          {/**
            * ================= بند ۳ — کادر تخفیف فاکتور =================
            * دو لایه‌ی مستقل، و هر دو لازم:
            *
            *   ۱) **قفل رمز دوم** (`PANEL_KEYS.posDiscount`): کل کادر داخل یک
            *      `<ManagerGate … inline>` است، پس تا رمز وارد نشود هیچ عددی
            *      قابل تایپ نیست. (حالت inline یک کادر جمع‌وجور در همین ستون
            *      کنار نشان می‌دهد، نه یک صفحه‌ی کامل.)
            *   ۲) **سیاست تخفیف** مدیر: سقف اختیار را تعیین می‌کند. اگر سیاست
            *      `OFF` باشد کادر **اصلاً ساخته نمی‌شود** (نه این‌که غیرفعال
            *      باشد)، و اگر `FIXED` باشد عدد قابل تایپ نیست و فروشنده فقط
            *      همان تخفیف ثابتِ مدیر را روشن/خاموش می‌کند.
            *
            * چرا هر دو؟ چون قفل می‌گوید «چه کسی»، و سیاست می‌گوید «چقدر».
            */}
          {!discountBoxVisible ? (
            <div className="rounded border-2 border-slate-300 bg-slate-50 px-2 py-1.5 space-y-0.5">
              <div className="flex justify-between font-bold">
                <span className="whitespace-nowrap">تخفیف فاکتور</span>
                <span className="kbd">🔒 بسته</span>
              </div>
              <div className="kbd leading-6">{describeDiscountPolicy(policy)}</div>
              <div className="kbd leading-6">
                تغییر این سیاست از «تنظیمات → تخفیف» انجام می‌شود و فقط دست مدیر است.
              </div>
            </div>
          ) : (
            <ManagerGate
              panel={PANEL_KEYS.posDiscount}
              title="تخفیف پنل فروش"
              reason="ثبت تخفیف (روی کالا و روی کل فاکتور) با رمز باز می‌شود؛ بقیه‌ی پنل فروش باز است و فروش عادی انجام می‌شود. مقدار مجاز تخفیف را مدیر در «تنظیمات → تخفیف» تعیین می‌کند."
              inline
            >
              <div className="space-y-1">
                {policy.mode === 'FIXED' ? (
                  /* ---------- FIXED: فقط سوییچ روشن/خاموش، بدون عدد ---------- */
                  <>
                    <label
                      className={`flex items-center gap-2 font-bold cursor-pointer rounded border-2 px-2 py-1.5 ${
                        fixedDiscountOn ? 'bg-emerald-50 border-emerald-400' : 'border-slate-300'
                      }`}
                      title="در این حالت عدد تخفیف قابل تایپ نیست؛ فقط همان تخفیف ثابتی که مدیر تعیین کرده اعمال یا لغو می‌شود."
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={fixedDiscountOn}
                        onChange={(e) => setFixedDiscountOn(e.target.checked)}
                      />
                      تخفیف ثابت مدیر
                      <span className="kbd ms-auto">
                        {policy.fixedMode === 'PERCENT'
                          ? `${faDigits(policy.fixedValue)}٪`
                          : `${money(policy.fixedValue)} ریال`}
                      </span>
                    </label>
                    <div className="flex justify-between kbd">
                      <span>مبلغ تخفیف این فاکتور</span>
                      <b>{money(totals.invoiceDisc)}</b>
                    </div>
                  </>
                ) : (
                  /* ---------- FREE: مبلغ ریالی یا درصدی، تا سقف سیاست ---------- */
                  <>
                    <div className="flex justify-between items-center gap-1">
                      <span className="whitespace-nowrap">تخفیف فاکتور</span>
                      <select
                        className="inp w-24 py-1"
                        value={discountMode}
                        onChange={(e) => setDiscountMode(e.target.value === 'PERCENT' ? 'PERCENT' : 'AMOUNT')}
                        title="تخفیف را به مبلغ ریالی یا به درصد وارد کنید"
                      >
                        <option value="AMOUNT">مبلغ</option>
                        <option value="PERCENT">درصد</option>
                      </select>
                      {discountMode === 'PERCENT' ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="inp w-20 py-1"
                          value={discountPercent}
                          onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, +e.target.value || 0)))}
                        />
                      ) : (
                        <input
                          type="number"
                          min={0}
                          className="inp w-28 py-1"
                          value={invoiceDiscount}
                          onChange={(e) => setInvoiceDiscount(Math.max(0, +e.target.value || 0))}
                        />
                      )}
                    </div>
                    <div className="flex justify-between kbd">
                      <span>
                        {discountMode === 'PERCENT'
                          ? `${faDigits(discountPercent)}٪ از جمع کل فاکتور`
                          : 'مبلغ تخفیف به ریال'}
                      </span>
                      <b>{money(totals.invoiceDisc)}</b>
                    </div>
                    <div className="kbd">
                      {policy.allowLine
                        ? 'تخفیف ردیف‌های جدول با این تخفیف جمع می‌شود، جای هم را نمی‌گیرد.'
                        : 'تخفیف روی خودِ کالا بسته است؛ فقط همین تخفیف کل فاکتور اعمال می‌شود.'}
                    </div>
                  </>
                )}

                {/* سقف سیاست: عدد دقیق، همیشه دیده می‌شود */}
                <div className="flex justify-between kbd">
                  <span>سقف مجاز تخفیف این فاکتور</span>
                  <b>{money(totals.ceiling)}</b>
                </div>
                {/**
                  * اگر خواسته‌ی فروشنده از سقف بیشتر بود، *صریح* گفته می‌شود چقدر
                  * کوتاه شد. کوتاه‌کردن بی‌صدا همان باگی است که فاکتور چاپی و
                  * گزارش فروش را با هم واگرا می‌کند.
                  */}
                {totals.clipped > 0 && (
                  <div className="rounded px-2 py-1 border-2 bg-amber-50 border-amber-400 kbd leading-6">
                    <b>{money(totals.clipped)} ریال از تخفیف اعمال نشد</b> — سقف سیاست تخفیف اجازه نمی‌دهد. تخفیف
                    اعمال‌شده: ردیف‌ها {money(totals.lineDisc)} + فاکتور {money(totals.invoiceDisc)} ریال.
                  </div>
                )}
                <div className="kbd leading-6">{describeDiscountPolicy(policy)}</div>
              </div>
            </ManagerGate>
          )}

        </div>

        {/**
         * جزئیات کمکی فروش (انبار، عوارض و سهم اعتبار) بعد از انتخاب روش پرداخت
         * می‌آیند. این جابه‌جایی فقط order بصری است؛ هیچ state یا محاسبه‌ای را
         * تغییر نمی‌دهد.
         */}
        <div className="order-4 bg-white rounded shadow p-3 space-y-2">
          {custodyGoverned && (
            <div className="rounded border-2 border-indigo-200 bg-indigo-50 p-2 space-y-2">
              <div>
                <b className="text-indigo-950">ثبت‌کنندهٔ POS</b>
                <div className="kbd leading-5 text-indigo-900">
                  مسئولیت مالی این فروش همچنان برای کشوی «{custodyPos?.custodian?.name ?? 'مسئول فعال'}» می‌ماند. این انتخاب فقط شاهدِ مستقلِ اپراتور است.
                </div>
              </div>
              <select
                className="inp bg-white"
                value={saleOperatorMode}
                disabled={busy}
                onChange={(event) => {
                  const mode = event.target.value as 'CUSTODIAN' | 'OPERATOR_PIN' | 'MANAGER_SESSION'
                  setSaleOperatorMode(mode)
                  setSaleOperatorPassword('')
                }}
              >
                <option value="CUSTODIAN">خود مسئول فعلی کشو</option>
                <option value="OPERATOR_PIN">اپراتور دیگر با رمز شخصی حضانت</option>
                {isManager && <option value="MANAGER_SESSION">نشست فعال مدیر (بدون انتساب به نام مدیر)</option>}
              </select>
              {saleOperatorMode === 'OPERATOR_PIN' && (
                <div className="grid grid-cols-1 gap-1">
                  <select
                    className="inp bg-white"
                    value={saleOperatorUserId}
                    disabled={busy}
                    onChange={(event) => setSaleOperatorUserId(event.target.value ? Number(event.target.value) : '')}
                  >
                    <option value="">اپراتور PINدار را انتخاب کنید…</option>
                    {operatorStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name} ({staff.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}
                  </select>
                  <PasswordField
                    value={saleOperatorPassword}
                    placeholder="رمز شخصی حضانت اپراتور — فقط برای همین فروش"
                    onChange={(event) => setSaleOperatorPassword(event.target.value)}
                  />
                  <div className="kbd text-indigo-900">رمز پس از ثبت موفق پاک می‌شود و هر فروش دوباره PIN مستقل می‌خواهد.</div>
                </div>
              )}
              {saleOperatorMode === 'MANAGER_SESSION' && (
                <div className="kbd text-indigo-900">نشست مدیر معتبر است؛ سند فقط با برچسب MANAGER_SESSION ثبت می‌شود و نام یک مدیر فرضی نمی‌گیرد.</div>
              )}
            </div>
          )}
          {/**
           * ---------- برداشت خودکار از انبار مرکزی ----------
           * مورد ۴ (نشست نهم): این چک‌باکس هم — دقیقاً مثل «چاپ فاکتور» و «تخفیف» —
           * کلید قفل مستقل خودش را دارد (`PANEL_KEYS.posCentralWithdrawToggle`)، پس
           * مدیر می‌تواند برایش رمز دوم اختصاصی بگذارد و آن را بدون افشای رمز
           * مدیریتی به سرشیفت بدهد. قفل *فقط* همین یک تیک را می‌پوشاند، نه پنل فروش.
           */}
          <ManagerGate
            panel={PANEL_KEYS.posCentralWithdrawToggle}
            title={CENTRAL_WITHDRAW_GATE.title}
            reason={CENTRAL_WITHDRAW_GATE.reason}
            inline
          >
          <label
            className={`flex items-start gap-2 rounded border-2 px-2 py-1.5 ${
              autoCentralBox.locked ? 'cursor-not-allowed opacity-95' : 'cursor-pointer'
            } ${autoCentral ? 'bg-amber-50 border-amber-400' : 'border-slate-300'}`}
            title={
              autoCentralBox.locked
                ? 'قفل مدیر: کارمند نمی‌تواند این گزینه را تغییر دهد'
                : 'اگر موجودی انبار فروشگاه کم باشد، کمبود در لحظه‌ی ثبت فاکتور از انبار مرکزی کسر می‌شود'
            }
          >
            <input
              type="checkbox"
              className="w-4 h-4 mt-0.5"
              checked={autoCentral}
              disabled={autoCentralBox.locked}
              onChange={(e) => void autoCentralBox.toggle(e.target.checked)}
            />
            <span>
              <b>برداشت خودکار از انبار مرکزی</b>
              {autoCentralBox.locked && <span className="kbd"> 🔒 فقط مدیر</span>}
              <span className="block kbd leading-5">
                {autoCentral
                  ? 'روشن: کمبود موجودی هر کالا هنگام فروش از «انبار مرکزی» کسر و به انبار فروشگاه منتقل می‌شود (با هشدار زرد).'
                  : 'خاموش (پیش‌فرض): کمبود موجودی مثل قبل منفی ثبت می‌شود و انبار مرکزی لمس نمی‌شود.'}
              </span>
              <span className="block kbd leading-5">
                {autoCentralBox.locked
                  ? 'این تیک قفل است؛ تغییرش فقط با نشست مدیر ممکن است. همین گزینه در «فاکتور فروش عمده» و «تنظیمات انبار مرکزی» هم هست و هر سه یکی هستند.'
                  : 'همین تیک در «فاکتور فروش عمده» و «تنظیمات انبار مرکزی» هم مشترک است (یک تنظیم، سه پنل).'}
              </span>
            </span>
          </label>
          <AutoCentralPasswordBox box={autoCentralBox} />
          </ManagerGate>
          {/**
            * ============ بند ۲ — حق سرویس و عوارض: فقط‌خواندنی ============
            * دکمه‌ی «دستی» و مسیر override **حذف شد**. هر دو عدد تنها از تنظیمات
            * دسته‌بندی کالا می‌آیند (پنل‌های «حق سرویس · پنل فروش» و «عوارض و
            * مالیات · پنل فروش» که خودشان قفل رمز دارند). دکمه‌ی «تنظیمات» کنار
            * هر ردیف، مسیر *درست* تغییر مقدار است: یک بار برای همیشه و برای
            * همه‌ی فاکتورها، نه سلیقه‌ای برای همین یک فاکتور.
            */}
          <ChargeRow
            label="حق سرویس"
            value={totals.service}
            onOpenSettings={() => nav('/charges/service/pos')}
          />
          <ChargeRow label="عوارض و مالیات" value={totals.tax} onOpenSettings={() => nav('/charges/tax/pos')} />
          <div className="flex justify-between text-lg border-t pt-2">
            <span>قابل پرداخت</span>
            <b>{money(totals.payable)}</b>
          </div>
          {/**
           * ---------- بخش ۶: سهم «بارکد اعتبار» از همین فاکتور ----------
           * فقط وقتی یک اعتبار *معتبر* بررسی شده باشد دیده می‌شود. «نقد قابل
           * دریافت» همان عددی است که فروشنده باید از مشتری بگیرد و همان چیزی است
           * که به‌عنوان پرداختی ثبت می‌گردد.
           */}
          {creditApplied > 0 && (
            <>
              <div className="flex justify-between text-emerald-800">
                <span>بارکد اعتبار خرید بعدی</span>
                <b>− {money(creditApplied)}</b>
              </div>
              <div className="flex justify-between text-lg border-t pt-1 text-emerald-900">
                <span>نقد قابل دریافت</span>
                <b>{money(cashDue)}</b>
              </div>
              {creditInfo && creditInfo.amount > creditApplied && (
                <div className="kbd leading-6 text-emerald-800">
                  اعتبار از مبلغ فاکتور بیشتر است؛ {money(creditInfo.amount - creditApplied)} ریال باقی‌مانده به‌صورت یک
                  بارکد اعتبار جدید چاپ و به مشتری داده می‌شود (سوخت نمی‌شود).
                </div>
              )}
              {/* §۱۸ — چرا سقف اعتبار از جمع فاکتور کمتر شد: سهم اقلام خارج از دامنه */}
              {creditCoverage.restricted && (
                <div className="kbd leading-6 text-amber-900">
                  اقلام در دامنه‌ی این اعتبار: {money(creditCoverage.coveredTotal)} ریال · خارج از دامنه:{' '}
                  {money(creditCoverage.excludedTotal)} ریال ({faDigits(creditCoverage.excludedIds.length)} قلم، در جدول
                  علامت خورده‌اند).
                </div>
              )}
            </>
          )}
        </div>

          {/**
           * ---------- چاپ فاکتور روشن/خاموش (مورد ۳ · قفل بخش ۱) ----------
           * ⚠️ قفل `posPrintToggle` فقط و فقط همین چک‌باکس را می‌پوشاند، نه کل پنل
           * فروش: کارمند می‌تواند بفروشد ولی نمی‌تواند چاپ فاکتور را خاموش کند.
           * حالت inline یک کادر جمع‌وجور در همان ستون کنار نشان می‌دهد.
           */}
          <div className="order-5">
          <ManagerGate
            panel={PANEL_KEYS.posPrintToggle}
            title="چک‌باکس «چاپ فاکتور»"
            reason="روشن/خاموش کردن چاپ فاکتور با رمز باز می‌شود؛ بقیه‌ی پنل فروش باز است و فروش عادی انجام می‌شود."
            inline
          >
          <label
            className={`flex items-start gap-2 rounded border-2 px-2 py-1.5 cursor-pointer ${
              printEnabled ? 'bg-emerald-50 border-emerald-400' : 'bg-slate-100 border-slate-400'
            }`}
            title="خاموش = هیچ فاکتوری چاپ نمی‌شود (نه خودکار و نه دستی)، ولی ثبت فاکتور در گزارشات فروش عادی انجام می‌شود"
          >
            <input
              type="checkbox"
              className="w-4 h-4 mt-0.5"
              checked={printEnabled}
              onChange={(e) => void togglePrintEnabled(e.target.checked)}
            />
            <span>
              <b>چاپ فاکتور</b>
              <span className="block kbd leading-5">
                {printEnabled
                  ? settings.receipt.autoPrint
                    ? 'روشن: هر فاکتور بعد از ثبت خودکار چاپ می‌شود (طبق تنظیمات چاپ).'
                    : 'روشن: چاپ خودکار در تنظیمات خاموش است، پس فقط با دکمه‌ی «چاپ فاکتور» چاپ می‌شود.'
                  : 'خاموش: هیچ فاکتوری چاپ نمی‌شود — نه خودکار و نه دستی.'}
              </span>
              <span className="block kbd leading-5">
                ثبت فاکتور و آمدنش در گزارشات فروش در هر دو حالت کاملاً عادی است؛ این تیک فقط روی چاپ اثر دارد.
              </span>
            </span>
          </label>
          {printNeedPw && (
            <div className="mt-1 max-w-xs" title="رمز مدیر یا رمز دوم همین گزینه؛ بعد از هر تلاش پاک می‌شود">
              <PasswordField
                value={printPw}
                placeholder="رمز تغییر چاپ فاکتور"
                onChange={(e) => setPrintPw(e.target.value)}
              />
            </div>
          )}
          </ManagerGate>
          </div>

        {/* ---------- بخش ۷: فروش نسیه و پرداخت جزئی ---------- */}
        <div
          className={`order-2 rounded p-2 border-2 space-y-1 ${
            creditMode ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-300'
          }`}
        >
          <label className="flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={creditMode}
              onChange={(e) => {
                setCreditMode(e.target.checked)
                if (!e.target.checked) setCreditPaid(0)
              }}
            />
            فروش نسیه / پرداخت جزئی
          </label>
          {creditMode ? (
            <>
              <label className="block">
                <div className="kbd">مبلغ پرداختی (همین حالا)</div>
                <input
                  type="number"
                  min={0}
                  className="inp bg-white"
                  value={creditPaid}
                  onChange={(e) => setCreditPaid(Math.max(0, Math.round(+e.target.value || 0)))}
                />
              </label>
              <div className="flex gap-1 flex-wrap kbd">
                <button className="text-brand font-bold" onClick={() => setCreditPaid(0)}>
                  نسیه‌ی کامل (صفر)
                </button>
                <span className="opacity-40">|</span>
                <button className="text-brand font-bold" onClick={() => setCreditPaid(cashDue)}>
                  کل مبلغ
                </button>
                <span className="opacity-40">|</span>
                <button className="text-brand font-bold" onClick={() => setCreditPaid(Math.round(cashDue / 2))}>
                  نصف
                </button>
              </div>
              <div className="flex justify-between font-bold text-amber-900 border-t pt-1">
                <span>بدهی باقی‌مانده</span>
                <b>{money(creditRemaining)} ریال</b>
              </div>
              {/*
                ================= کار الف — مقصد پولِ پرداخت جزئی =================
                فقط وقتی مبلغی *همین حالا* دریافت می‌شود دیده می‌شود (نسیه‌ی کامل
                پولی ندارد که مقصد داشته باشد). عمداً «اجباری» نیست: روش پرداخت
                در همین صفحه با دکمه انتخاب می‌شود، پس سرور مقصد نقدی/کارتی را
                خودش مشتق می‌کند. کادر برای همان حالتی است که مشتق کردن غلط است:
                پولی که به حساب مدیر رفته.
                ================================================================
              */}
              {creditPaid > 0 ? (
                <div className="space-y-1">
                  <PaymentDestinationBox
                    value={creditDestination}
                    onChange={(d) => setCreditDestination((c) => (c === d ? null : d))}
                    context="PAYMENT"
                    title="این مبلغ کجا نشست؟ (اختیاری)"
                  />
                  <div className="kbd leading-6">
                    {creditDestination
                      ? `انتخاب شما: «${paymentDestinationLabel(creditDestination)}» — برای برداشتن انتخاب، دوباره روی همان گزینه بزنید.`
                      : 'انتخاب نشده: مقصد از روش پرداختی که پایین می‌زنید مشتق می‌شود (نقدی ⇒ کشوی صندوق، کارت ⇒ کارتخوان فروشگاه). فقط اگر پول به حساب مدیر رفته، گزینه‌اش را همین‌جا بزنید.'}
                  </div>
                </div>
              ) : null}
              <div className="kbd leading-6">
                {creditRemaining > 0
                  ? 'فاکتور «تسویه‌نشده» ثبت می‌شود و در تب «نسیه»ی گزارشات فروش با همین باقی‌مانده دیده می‌شود؛ پرداختی‌های بعدی را از همان تب ثبت کنید. روش پرداختی که می‌زنید، روشِ همین مبلغ دریافتی است.'
                  : 'مبلغ پرداختی = کل فاکتور، پس فاکتور کاملاً تسویه‌شده ثبت می‌شود (همان رفتار عادی).'}
              </div>
            </>
          ) : (
            <div className="kbd leading-6">
              خاموش (پیش‌فرض): کل «قابل پرداخت» همین لحظه دریافت می‌شود و فاکتور تسویه‌شده ثبت می‌گردد. برای نسیه یا
              دریافت بخشی از مبلغ، این تیک را بزنید.
            </div>
          )}
        </div>

        <div className="order-3 space-y-2">
          <label className="flex items-center gap-2 font-bold cursor-pointer rounded border px-2 py-1.5">
            <input type="checkbox" className="w-4 h-4" checked={splitPayment} onChange={(e) => setSplitPayment(e.target.checked)} disabled={creditMode} />
            پرداخت ترکیبی نقد + کارت
          </label>
          {splitPayment && (
            <div className="rounded border-2 border-sky-300 bg-sky-50 p-2 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label>
                  <span className="kbd">نقد (ریال)</span>
                  <input
                    className="inp"
                    dir="ltr"
                    inputMode="numeric"
                    value={groupThousands(splitCash)}
                    placeholder="۰"
                    title="فقط عدد صحیح ریالی؛ جداکنندهٔ هزارگان و ارقام فارسی پذیرفته می‌شود."
                    onChange={(e) => {
                      // متن نامعتبر را هرگز با حذف کاراکترها به مبلغ دیگری تبدیل نکن.
                      if (parseGroupedInteger(e.target.value) != null) setSplitCash(digitsOnly(e.target.value))
                    }}
                  />
                </label>
                <label>
                  <span className="kbd">کارت (ریال)</span>
                  <input
                    className="inp"
                    dir="ltr"
                    inputMode="numeric"
                    value={groupThousands(splitCard)}
                    placeholder="۰"
                    title="فقط عدد صحیح ریالی؛ جداکنندهٔ هزارگان و ارقام فارسی پذیرفته می‌شود."
                    onChange={(e) => {
                      // ۱.۲ نباید بی‌صدا به ۱۲ تبدیل شود؛ ورودی نامعتبر پذیرفته نمی‌شود.
                      if (parseGroupedInteger(e.target.value) != null) setSplitCard(digitsOnly(e.target.value))
                    }}
                  />
                </label>
                <label>
                  <span className="kbd">روش کارت</span>
                  <select className="inp" value={splitCardMethodId ?? ''} onChange={(e) => setSplitCardMethodId(e.target.value ? Number(e.target.value) : null)}>
                    {directPaymentMethods.filter((m) => m.kind === 'CARD').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="kbd">جمع: {money(splitTotal ?? 0)} ریال · قابل پرداخت: {money(cashDue)} ریال</div>
              <div className="flex gap-2">
                <button className="btn" onClick={() => setSplitCard(String(Math.max(0, cashDue - (splitCashAmount ?? 0))))}>باقی را کارت کن</button>
                <button
                  className="btn btn-primary"
                  disabled={busy || splitTotal == null || splitTotal !== cashDue || (splitCashAmount ?? 0) <= 0 || (splitCardAmount ?? 0) <= 0}
                  onClick={() => void settle('__SPLIT__')}
                >
                  ثبت نقد + کارت
                </button>
              </div>
            </div>
          )}
          {!splitPayment && <div className="grid grid-cols-2 gap-2">
          {directPaymentMethods.map((m) => (
            <button key={m.id} className="btn btn-primary" disabled={busy} onClick={() => void settle(m.key)}>
              {m.label}
              {creditMode && <span className="block kbd">{creditPaid > 0 ? 'دریافت جزئی' : 'ثبت نسیه'}</span>}
            </button>
          ))}
          </div>}
        </div>

        {last && printEnabled && (
          <button className="order-6 btn" onClick={() => void printInvoice(last.id)} disabled={printing}>
            {printing ? 'در حال چاپ…' : 'چاپ فاکتور آخر'} <span className="keycap">F6</span>
          </button>
        )}

        <button className="order-7 btn btn-danger mt-auto" onClick={clearCart}>
          حذف سفارش <span className="keycap">F7</span>
        </button>
      </aside>

      {/**
       * ---------- جلسه ۵۲ · مرحله ۳ — پنجره‌ی «از کدام انبار کسر شود؟» ----------
       * در حالت پیش‌فرض (قفل بسته) **هیچ‌وقت باز نمی‌شود**: فروشنده سؤالی نمی‌بیند.
       * فقط وقتی مدیر قفل `posCentralWithdrawToggle` را باز کرده باشد (یا رمز دوم
       * اختصاصی برای فروشنده گذاشته باشد) و موجودی انبار فروشگاه برای قلمی کم
       * بیاید و تیک «برداشت خودکار» خاموش باشد. «لغو» در هر مرحله ⇒ هیچ فیشی
       * ثبت نمی‌شود (`preview` هیچ‌وقت نمی‌نویسد).
       *
       * `passwordRequired` = قفلِ ماژول روشن است؟ چون سرور همین را با
       * `assertPanelPassword` می‌سنجد و بی رمز معتبر رد می‌کند. قفل خاموش ⇒ سرور
       * بی رمز `OPEN` می‌دهد ⇒ کادر رمز هم ساخته نمی‌شود.
       */}
      <StockSourceModal
        open={stockChain != null}
        preview={stockChain?.preview ?? null}
        primaryKey={STORE_PICK_KEY}
        /**
         * ⚠️ `busy` مودال عمداً با `stockChain` وام‌دار شده است: `settle` *قبل* از
         * باز شدن این پنجره `setBusy(true)` می‌کند تا دکمه‌ی ثبتِ دوباره قفل شود و
         * تا جواب کاربر در انتظار می‌ماند — پس در کل بازه‌ی باز بودن پنجره
         * `busy=true` است. اگر همین مقدار خام به مودال داده شود، دکمه‌های «تأیید»
         * و «لغو» خودِ پنجره هم غیرفعال می‌شوند و کاربر حبس می‌شود. برای قفلِ
         * تکثیرِ کاربر روی تأیید، خودِ `decide` کافی است (پس از یک کلیک پنجره
         * بسته می‌شود و وعده فقط یک‌بار تحویل می‌شود).
         */
        busy={busy && stockChain == null}
        confirmLabel="تأیید و ثبت فیش"
        passwordRequired={stockPickLockOn}
        passwordHint={
          'کسر از انباری غیر از «انبار فروشگاه» در پنل فروش تکی تأیید مدیر لازم دارد؛ سرور هم همین را می‌سنجد. ' +
          'رمز مدیر یا «رمز دوم اختصاصیِ گزینه‌ی برداشت خودکار از انبار مرکزی» (تنظیمات → رمز دوم اختصاصی پنل‌ها). ' +
          'این رمز ذخیره نمی‌شود و فقط همین یک فیش را تأیید می‌کند.'
        }
        onCancel={() => stockChain?.decide(null, null)}
        onConfirm={(plan, password) => stockChain?.decide(plan, password)}
      />
    </div>
  )
}

/**
 * ===================== یک ردیف جمع (حق سرویس / عوارض) =====================
 * بند ۲ — این کامپوننت دیگر **هیچ راه ویرایشی ندارد**. مقدارش همان چیزی است که
 * از تنظیمات دسته‌بندی کالا (`useCharges`) حساب شده و تنها راه عوض کردنش، رفتن
 * به همان پنل تنظیمات است (دکمه‌ی «تنظیمات»).
 *
 * چرا حذف شد و «فقط غیرفعال» نشد؟ چون یک دکمه‌ی غیرفعال، یک وعده‌ی باقی‌مانده
 * است: کسی روزی تصمیم می‌گیرد «فقط برای مدیر بازش کنیم» و همان لحظه دو منبع
 * حقیقت برای مالیات پیدا می‌شود — دقیقاً چیزی که این بند برای بستنش نوشته شد.
 * =========================================================================
 */
function ChargeRow({
  label,
  value,
  onOpenSettings
}: {
  label: string
  value: number
  onOpenSettings?: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center gap-1">
        <span className="whitespace-nowrap">{label}</span>
        {/* فقط عدد — بدون input و بدون دکمه‌ی «دستی» (بند ۲) */}
        <b>{money(value)}</b>
      </div>
      <div className="flex justify-between kbd">
        <span title="این مبلغ فقط از تنظیمات دسته‌بندی کالا می‌آید و در پنل فروش قابل تغییر نیست">
          خودکار از تنظیمات دسته‌بندی
        </span>
        {onOpenSettings ? (
          <button
            className="text-brand"
            onClick={onOpenSettings}
            title="تنظیم مقدار بر اساس دسته‌بندی کالا (پنل قفل‌دار)"
          >
            تنظیمات
          </button>
        ) : null}
      </div>
    </div>
  )
}
