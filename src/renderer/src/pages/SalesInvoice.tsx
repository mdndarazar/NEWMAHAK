import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { useHotkeys } from '../hooks/useHotkeys'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { useCharges } from '../hooks/useCharges'
import { useSettings } from '../hooks/useSettings'
import { useAutoCentralWithdraw } from '../hooks/useAutoCentralWithdraw'
import AutoCentralPasswordBox from '../components/AutoCentralPasswordBox'
// جلسه ۵۳ · مرحله ۴ — ستون «مبدأ کسر» فهرست فاکتورها (فقط خواندنی)
import { useSaleStockSources } from '../hooks/useSaleStockSources'
import Modal from '../components/Modal'
import ManagerGate from '../components/ManagerGate'
import PasswordField from '../components/PasswordField'
import InvoicePaymentsModal from '../components/InvoicePaymentsModal'
// نشست ۶۳ · بند ۴-۳۵ — همان فلوی چهارمرحله‌ای اضافه‌دریافت پنجره‌ی پرداخت‌ها (جزء مشترک)
import OverpayFlowDialogs, { printOverpayCredit, type OverpayCreditPrintProblem } from '../components/OverpayFlowDialogs'
import {
  isOverpayWarning,
  needsManagerPassword,
  overpayFlowStart,
  overpayFlowAskPassword,
  overpayCreditFlash,
  type OverpayFlowState,
  type OverpayRequest,
  type OverpayCreditLike
} from '@shared/overpayFlow'
import StockSourceModal from '../components/StockSourceModal'
import { usePanelOpen } from '../hooks/usePanelLocks'
import { CENTRAL_WITHDRAW_GATE, PANEL_KEYS } from '@shared/panels'
import PartyPicker, { type Party } from '../components/PartyPicker'
import JalaliDateInput from '../components/JalaliDateInput'
import VariantSearchBox, { type VariantSearchBoxHandle } from '../components/VariantSearchBox'
import { SHORTCUTS } from '../lib/shortcuts'
import { faDigits, money, jalaliToday, isValidJalaliDate, jalaliStartOfDay, jalaliEndOfDay } from '@shared/jalali'
import { describeChargeRule } from '@shared/charges'
import { OrderType } from '@shared/enums'
import { purchasePageRequest, purchaseRangeDirty } from '@shared/purchaseListPaging'
import type { SecondaryWarehouseRow, StoreCreditSafeRow } from '@shared/types'
import {
  STOCK_PICK_TEXT,
  STORE_PICK_KEY,
  buildSingleSourcePlan,
  isStalePlanMessage,
  planShapeErrors,
  stockPathFor,
  stockPickOptions,
  summaryShortLine,
  summaryTextLines,
  type StockAllocationPlan,
  type StockSourcePreview
} from '@shared/stockSource'

/**
 * ================== فاکتور فروش عمده (Wholesale) ==================
 * تفاوت با «پنل فروش» (Pos.tsx): آن صفحه برای فروش خرده و تسویه‌ی سریع مشتری
 * حضوری است و دست‌نخورده می‌ماند. این صفحه برای فروش تعداد بالا به یک خریدار
 * عمده است: تخفیف درصدی سراسری، خریدار ثبت‌شده، تاریخ دلخواه، و مهم‌تر از همه
 * سوییچ «کسر از موجودی انبار».
 *
 * سوییچ کسر موجودی (در سطح هر فاکتور، نه تنظیم سراسری):
 *   روشن (پیش‌فرض) → با ذخیره، موجودی از طریق InventoryService کم می‌شود
 *                    (اتمیک، با حرکت انبار SALE و state=PENDING مثل POS).
 *   خاموش          → اقلام و مبالغ عادی ثبت می‌شوند ولی هیچ حرکت انباری ساخته
 *                    نمی‌شود و موجودی فروشگاه دست‌نخورده می‌ماند.
 * مقدارش روی فیلد SaleInvoice.deductInventory ذخیره و در AuditLog ثبت می‌شود.
 *
 * قیمت‌گذاری: unitPrice هر قلم = salePrice واریانت × (۱ − درصد تخفیف ÷ ۱۰۰) و
 * روی هر ردیف قابل override دستی است (بدون به‌هم‌ریختن درصد سراسری).
 *
 * تخفیف فاکتور (یک باکس، نه دو تا):
 *   یک select («درصدی» / «مبلغ ثابت (ریال)») و یک عدد. با «درصدی»، همان درصد
 *   عمده روی همه‌ی ردیف‌ها اعمال می‌شود (مثل قبل) و با «مبلغ ثابت»، همان مبلغ از
 *   جمع کل فاکتور کم می‌شود (مثل قبل). منطق محاسبه‌ی پشت‌صحنه دقیقاً همان است؛
 *   فقط ورودی یکی شد تا یک ستون کامل از عرض صفحه آزاد شود و جدول اقلام جا بگیرد.
 *
 * عوارض و مالیات / حق سرویس:
 *   دیگر `tax: 0` هاردکد نیست. مقدارها از پنل «عوارض و مالیات · فاکتور فروش
 *   عمده» و «حق سرویس · فاکتور فروش عمده» و بر اساس دسته‌بندی هر کالا (با
 *   ارث‌بری) خودکار حساب می‌شوند — همان `chargeForLine` مشترک، با اسکوپ
 *   `wholesale` که کاملاً از تنظیمات پنل فروش خرد مستقل است. هر دو عدد با دکمه‌ی
 *   «دستی» برای همین فاکتور قابل override اند.
 *
 * ویرایش فاکتور ثبت‌شده (جدید):
 *   در تب «فاکتورهای عمده» هر ردیف یک دکمه‌ی «ویرایش» دارد. فرم با اطلاعات همان
 *   فاکتور پر می‌شود و ذخیره، به‌جای create، کانال sale:update را صدا می‌زند.
 *   شماره فیش عوض نمی‌شود و موجودی با delta اصلاح می‌گردد (سمت main).
 *
 * چاپ فاکتور (با مبلغ پرداختی و مانده‌حساب):
 *   دکمه‌ی «چاپ فاکتور» رسیدِ همان فاکتور *ثبت‌شده* را چاپ می‌کند (داده از
 *   دیتابیس، قالب از تنظیمات) و «مبلغ دریافتی» واردشده در همین صفحه را به‌عنوان
 *   مبلغ پرداختی می‌فرستد؛ مانده‌حساب = جمع کل منهای همان مبلغ، سمت main حساب و
 *   روی رسید چاپ می‌شود. چون چاپ از روی سند ثبت‌شده انجام می‌شود، رسید چاپی و
 *   فاکتور ثبت‌شده هیچ‌وقت با هم اختلاف پیدا نمی‌کنند.
 *
 * هشدارهای موجودی (مورد ۷ — همانِ پنل فروش تکی، مو‌به‌مو):
 *   • هشدار زرد «کمبود موجودی» *قبل* از ذخیره (کدام قلم، چقدر کم است).
 *   • چک‌باکس «برداشت خودکار از انبار مرکزی» با همان رفتار و همان تنظیم
 *     ذخیره‌شده‌ی پنل فروش تکی. ⚠️ فقط مدیر می‌تواند عوضش کند (قفل کارمند) و
 *     همین یک تنظیم در «تنظیمات انبار مرکزی» هم دیده می‌شود؛ هر سه محل همیشه
 *     یک وضعیت واحد نشان می‌دهند.
 *   • دکمه‌ی «فهمیدم» روی هشدار زرد کمبود موجودی، تا پیام از روی صفحه برداشته
 *     شود (اگر اقلام یا کمبود عوض شود، هشدار دوباره می‌آید).
 *   • هشدار زردِ برگشتی از main بعد از ثبت (چه چیزی از انبار مرکزی کسر شد و
 *     موجودی چه کالایی منفی ماند).
 *   کمبود موجودی هیچ‌وقت جلوی ثبت فاکتور را نمی‌گیرد.
 *
 * میان‌برها: Ctrl+S ذخیره · F4 فاکتور جدید · F7 حذف فاکتور جاری.
 * ==================================================================
 */

interface WLine {
  key: string
  variantId: number
  code: string
  barcode: string
  name: string
  unit: string
  stock: number
  qty: number
  /** قیمت فروش ثبت‌شده‌ی واریانت در سیستم (مبنای محاسبه‌ی تخفیف) */
  listPrice: number
  /** قیمت دستی این ردیف؛ null یعنی از درصد سراسری محاسبه شود */
  manualPrice: number | null
  /** دسته‌بندی کالا — مبنای محاسبه‌ی عوارض و حق سرویس همین ردیف */
  categoryId: number | null
}

interface Method {
  id: number
  key: string
  label: string
  kind: string
}

type Tab = 'form' | 'list'

const monthStart = () => `${jalaliToday().slice(0, 8)}01`
const effPrice = (l: WLine, percent: number) =>
  l.manualPrice != null ? Math.round(l.manualPrice) : Math.round(l.listPrice * (1 - (percent || 0) / 100))

export default function SalesInvoice() {
  const [tab, setTab] = useState<Tab>('form')
  // عوارض/حق سرویس بر اساس دسته‌بندی کالا — اسکوپ «فاکتور فروش عمده»
  const charges = useCharges('wholesale')
  const { settings, setSettings } = useSettings()
  /**
   * قفل رمزی تب «فاکتورهای عمده» (مخصوص حسابداری).
   * ثبت فاکتور مثل قبل آزاد است؛ فقط *فهرست* فاکتورها — که پرداختی‌ها، اقساط و
   * چک‌ها را نشان می‌دهد — با رمز مدیر یا «رمز دوم اختصاصی» همین پنل باز می‌شود.
   */
  /** قفل خاموش همان‌قدر که گیت را باز می‌کند، باید بارگذاری فهرست را هم آزاد کند. */
  const listUnlocked = usePanelOpen(PANEL_KEYS.wholesaleInvoices)
  /** فاکتوری که پنجره‌ی «پرداختی‌ها / اقساط» برایش باز است */
  const [paymentsFor, setPaymentsFor] = useState<number | null>(null)

  /** null = ثبت فاکتور جدید · عدد = در حال ویرایش همان فاکتور */
  const [editId, setEditId] = useState<number | null>(null)
  const [editNo, setEditNo] = useState<number | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)

  const [dateJalali, setDateJalali] = useState(jalaliToday())
  const [customer, setCustomer] = useState<Party | null>(null)
  const [lines, setLines] = useState<WLine[]>([])
  const [percent, setPercent] = useState(0)
  /** تخفیف مبلغی (ریالی) روی کل فاکتور، جدا از تخفیف درصدی ردیف‌ها */
  const [extraDiscount, setExtraDiscount] = useState(0)
  /** یک باکس، دو معنا: تخفیف درصدی یا مبلغ ثابت ریالی */
  const [discountMode, setDiscountMode] = useState<'PERCENT' | 'AMOUNT'>('PERCENT')
  /** override دستی عوارض/حق سرویس برای همین فاکتور (null = خودکار از تنظیمات) */
  const [taxOverride, setTaxOverride] = useState<number | null>(null)
  const [serviceOverride, setServiceOverride] = useState<number | null>(null)
  /**
   * نشست ۱۵۶ (S151-c2، Y8) — سرور عوارض/حق سرویس را از تنظیمات بازمحاسبه می‌کند؛ مبلغ دستیِ
   * کمتر از خودکار فقط با رمز مدیر پذیرفته می‌شود (Audit SALE_CHARGE_OVERRIDE). بعد از هر تلاش پاک می‌شود.
   */
  const [chargePw, setChargePw] = useState('')
  /**
   * نشست ۱۶۷ · S153-D5 / هم‌رده‌ی S165-D2 (S167-D3) — سرور برای «قیمت کمتر از قیمت مرجع» (مثلاً کالا بعد از
   * بارگذاری فاکتور گران شده یا تعداد با قیمت قدیم بیشتر شده) رمز مدیر خواست ⇒ همان کادر رمز (chargePw ⇒
   * managerPassword) نمایش داده می‌شود تا فروشنده رمزی را که تلفنی از مدیر گرفته وارد کند (بند ۴-۳۰).
   * متن = پیام فارسی سرور (کدام کالا، مبلغ واردشده/مرجع). سرور دست نخورد.
   */
  const [priceNeedPw, setPriceNeedPw] = useState<string | null>(null)
  const [deductInventory, setDeductInventory] = useState(true)
  /**
   * «مشتری راه دور» (مورد ۷) — همان چک‌باکس پنل فروش تکی، برای فاکتور عمده.
   * مهلت برگشت این فاکتور از تنظیم مستقل «مهلت برگشت عمده — مشتری راه دور»
   * حساب می‌شود، نه از مهلت عادی.
   */
  const [remoteCustomer, setRemoteCustomer] = useState(false)
  /**
   * ---------------- بخش ۶: «بارکد اعتبار خرید بعدی» ----------------
   * عیناً همان قابلیت پنل فروش تکی، اینجا «برای یکدستی» هم هست: مشتری عمده‌ای که
   * قبلاً کالا تعویض کرده و ما به او بدهکار شده‌ایم، همان بارکد را می‌آورد و
   * مبلغش از فاکتور جدید کم می‌شود. اعتبارسنجی (مصرف‌نشده، منقضی‌نشده) و
   * علامت‌زدن یک‌بارمصرف کاملاً سمت main و *داخل همان تراکنش فاکتور* انجام
   * می‌گیرد؛ این‌جا فقط کد و مبلغش را نشان می‌دهیم.
   */
  const [creditCode, setCreditCode] = useState('')
  const [creditInfo, setCreditInfo] = useState<StoreCreditSafeRow | null>(null)
  const [creditErr, setCreditErr] = useState<string | null>(null)
  const [creditBusy, setCreditBusy] = useState(false)
  /** فوکوس داخل فیلد بارکد اعتبار ⇒ بارکدخوان سراسری خاموش (وگرنه دنبال کالا می‌گشت) */
  const [creditFocus, setCreditFocus] = useState(false)
  const [methods, setMethods] = useState<Method[]>([])
  const [methodId, setMethodId] = useState<number | null>(null)
  const [paid, setPaid] = useState(0)
  const [paidTouched, setPaidTouched] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /**
   * بنر SESSION_REQUIRED — مثل POS: برخلاف خطاهای عادی فرم/اقلام دست‌نخورده
   * می‌مانند تا بعد از ریکاوری نشست همان فاکتور دوباره ثبت شود (بدون retry خودکار).
   */
  const [sessionBlock, setSessionBlock] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const sessionBlockedRef = useRef(false)
  /** هشدار زرد موجودی برگشتی از main بعد از ثبت/ویرایش فاکتور (مورد ۳ و ۷) */
  const [warn, setWarn] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /**
   * نشست ۶۳ · بند ۴-۳۵ (DECISIONS S63-1/S63-4) — «مبلغ دریافتی» بیشتر از جمع
   * فاکتور (یا ویرایشی که اقلام را زیر پرداختی ثبت‌شده می‌برد): سرور هشدار
   * قابل‌تأیید «بله ثبت کن» می‌دهد و هیچ چیز ثبت نمی‌کند. این state ماشین حالت
   * `@shared/overpayFlow` است؛ تصمیم سؤال‌ها آنجاست، نه در JSX.
   */
  const [overpayFlow, setOverpayFlow] = useState<OverpayFlowState | null>(null)
  const [issuedCredit, setIssuedCredit] = useState<(OverpayCreditLike & { id?: number }) | null>(null)
  const issuedCreditOpenRef = useRef(false)
  const [overpayCreditPrinting, setOverpayCreditPrinting] = useState(false)
  const [overpayCreditPrintProblem, setOverpayCreditPrintProblem] = useState<OverpayCreditPrintProblem>(null)
  /**
   * برنامه‌ی «مبدأ کسر» که کاربر همین الان تأیید کرده بود: ارسال دوباره‌ی همان
   * فاکتور بعد از «بله ثبت کن» نباید پنجره‌ی مبدأ کسر را دوباره بپرسد. اگر
   * موجودی بین دو ارسال عوض شده باشد، سرور STOCK_PLAN_STALE می‌دهد و حلقه‌ی
   * معمول `preview` دوباره اجرا می‌شود.
   */
  const overpayPlanRef = useRef<StockAllocationPlan | null>(null)

  /** رویداد mahak:shift-changed — بنر SESSION_REQUIRED جمع می‌شود + راهنمای ثبت دوباره */
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
  /** آخرین فاکتوری که در همین نشست ثبت/ویرایش شد (برای دکمه‌ی «چاپ فاکتور») */
  const [lastSaved, setLastSaved] = useState<{ id: number; receiptNo: number; paid: number } | null>(null)
  const [printing, setPrinting] = useState(false)
  /** مودال «نمایش همه کالاها» باز است؟ (تا میان‌برها و بارکدخوان تداخل نکنند) */
  const [allProductsOpen, setAllProductsOpen] = useState(false)
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const searchRef = useRef<VariantSearchBoxHandle>(null)

  // تب فاکتورهای عمده‌ی ثبت‌شده
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(jalaliToday())
  const [rows, setRows] = useState<any[]>([])
  /** نشست ۱۱۷ (S117-4) — جمع/صفحه‌ی واقعی فهرست فاکتورهای عمده */
  const [listTotals, setListTotals] = useState<{ count: number; grandTotal: number }>({ count: 0, grandTotal: 0 })
  const [listPage, setListPage] = useState<{ skip: number; take: number; totalCount: number; truncated: boolean } | null>(null)
  const [listWarnings, setListWarnings] = useState<string[]>([])
  /** ممیزی A117-03 (AUDIT-D51) — بازه‌ای که ردیف‌ها/page فعلی از آن آمده‌اند؛ صفحه‌ی قبل/بعد فقط روی همین حرکت می‌کند */
  const [listMeta, setListMeta] = useState<{ range?: { from: string; to: string } }>({})
  const [loadingList, setLoadingList] = useState(false)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 8000)
  }

  const printIssuedOverpayCredit = async (credit: (OverpayCreditLike & { id?: number }) | null, opts?: { reprintPassword?: string }) => {
    if (overpayCreditPrinting) return
    setOverpayCreditPrinting(true)
    setOverpayCreditPrintProblem(null)
    try {
      // نشست ۳۱۶ — چاپِ اولِ صدور بدون رمز؛ چاپ دوباره ⇒ reprint:true + رمز (سرور strict می‌سنجد)
      const problem = await printOverpayCredit(
        credit,
        opts?.reprintPassword ? { reprint: true, password: opts.reprintPassword } : undefined
      )
      if (problem) {
        if (issuedCreditOpenRef.current) setOverpayCreditPrintProblem(problem)
        else setErr(problem.msg)
      }
    } finally {
      setOverpayCreditPrinting(false)
    }
  }

  useEffect(() => {
    call<Method[]>(CH.paymentMethods)
      .then((m) => {
        /** CREDIT = نسیه، نه روش وصول اولیه؛ روش‌های اعتبار سیستمی هم direct نیستند. */
        const direct = m.filter((method) => !['CREDIT', 'STORE_CREDIT', 'EXCHANGE_CREDIT'].includes(method.kind))
        setMethods(direct)
        setMethodId((cur) => (cur != null && direct.some((method) => method.id === cur) ? cur : direct[0]?.id ?? null))
      })
      .catch(() => {})
    // خریدار پیش‌فرض («مشتری عمومی») تا فاکتور بدون انتخاب هم قابل ثبت باشد
    // فقط مشتریان عمده (+ «مشتری عمومی») — مورد ۶
    call<Party[]>(CH.customerList, { kind: 'wholesale' })
      .then((cs) => setCustomer((cur) => cur ?? cs.find((c) => c.isDefault) ?? null))
      .catch(() => {})
  }, [])

  /**
   * چک‌باکس «برداشت خودکار از انبار مرکزی» — یک تنظیم مشترک بین این پنل، پنل
   * فروش تکی و پنل تنظیمات انبار مرکزی؛ قابل تغییر فقط با نشست مدیر (مورد ۱).
   */
  const autoCentralBox = useAutoCentralWithdraw(settings.sale, setSettings)
  const autoCentral = autoCentralBox.value

  useEffect(() => {
    if (autoCentralBox.error) setErr(autoCentralBox.error)
  }, [autoCentralBox.error])

  /**
   * ---------------- جلسه ۵۱ · مرحله ۲-الف — «کسر از انبار» ----------------
   * یک انتخاب در سطح همین فاکتور: «انبار فروشگاه» (پیش‌فرض، رفتار قبلی) یا
   * «انبار مرکزی» (انبار پیش‌فرض ماژول) یا هر انبار فعال دیگر.
   *
   * فهرست از همان `warehouseList` موجود می‌آید (هیچ کانال تازه‌ای ساخته نشد) و
   * کلیدها را `stockPickOptions` می‌سازد — مو‌به‌مو همان کلیدهای
   * `StockAllocationService.preview`، پس کلید انتخابی همیشه در `line.sources`
   * پیدا می‌شود.
   *
   * قاعده‌ی مالک که اینجا پیاده شده است:
   *   • فروشگاه + تیک روشن ⇒ **هیچ برنامه‌ای فرستاده نمی‌شود**؛ مو‌به‌مو همان
   *     رفتار خودکار قبلی (کمبود از انبار مرکزی پیش‌فرض، بی سؤال).
   *   • بقیه‌ی حالت‌ها ⇒ قبل از ثبت `preview` (بی نوشتن) گرفته و «برنامه‌ی کسر»
   *     ساخته می‌شود. کسری ⇒ یک تأیید صریحِ «با منفی ادامه بدهم؟».
   *   • سرور `stockPlan` + `autoCentralWithdraw: true` را با هم رد می‌کند، پس با
   *     فرستادن برنامه، تیک `false` می‌رود (تیک خودش دست‌نخورده می‌ماند).
   */
  const [warehouseList, setWarehouseList] = useState<SecondaryWarehouseRow[]>([])
  const [stockSourceKey, setStockSourceKey] = useState<string>(STORE_PICK_KEY)
  /**
   * فاکتورِ در حال ویرایش «دفتر مبدأ» دارد؟
   * ⚠️ مهم: اگر فاکتور قدیمی (بی دفتر) با برنامه ویرایش شود، سمت سرور کسرِ قبلی
   * برنمی‌گردد (مسیر `allocationPath` فقط وقتی برگشت می‌زند که دفتر داشته باشد)
   * ⇒ کسر دوباره. پس برای فاکتور قدیمی عمداً برنامه نمی‌فرستیم و مسیر قبلی
   * (delta) می‌ماند. شرحش در CHANGELOG جلسه ۵۱.
   */
  const [hasLedger, setHasLedger] = useState(false)
  /** خلاصه‌ی مبدأ کسرِ آخرین فاکتور ثبت/ویرایش‌شده (خروجی `summarizePlan` سرور). */
  const [planSummary, setPlanSummary] = useState<string[] | null>(null)
  /**
   * پنجره‌ی زنجیره‌ای «از کدام انبار کسر شود؟» (مرحله ۲-ب) — با یک promise به
   * `save()` وصل است: تا کاربر تأیید یا لغو نکند، فاکتور ثبت نمی‌شود.
   */
  const [stockChain, setStockChain] = useState<{
    preview: StockSourcePreview
    primaryKey: string
    decide: (plan: StockAllocationPlan | null) => void
  } | null>(null)

  useEffect(() => {
    call<SecondaryWarehouseRow[]>(CH.secondaryWarehouseList, {})
      .then(setWarehouseList)
      .catch(() => {})
  }, [])

  /** گزینه‌های منو: فروشگاه · انبار مرکزی پیش‌فرض · انبارهای فعال. */
  const pickOptions = useMemo(() => stockPickOptions(warehouseList), [warehouseList])
  const pickedOption = useMemo(
    () => pickOptions.find((o) => o.key === stockSourceKey) ?? pickOptions[0] ?? null,
    [pickOptions, stockSourceKey]
  )
  const storePicked = stockSourceKey === STORE_PICK_KEY
  /**
   * کل تصمیم «با برنامه برویم یا مسیر خودکار قبلی» یک تابع خالص در
   * `@shared/stockSource` است (`stockPathFor`) تا بی رندرر تست شود:
   *   • `legacyEdit`  ویرایش فاکتور بی‌دفتر ⇒ انتخاب انبار بی‌اثر و منو قفل.
   *   • `autoAllowed` تیک خودکار فقط برای «انبار فروشگاه» (قفل خودِ تیک و
   *     `ManagerGate` دست‌نخورده‌اند؛ فقط یک شرط `disabled` اضافه شد).
   *   • `autoPath`    فروشگاه + تیک روشن ⇒ مو‌به‌مو رفتار قبلی، بی هیچ سؤالی.
   *   • `planPath`    بقیه‌ی حالت‌ها ⇒ `preview` و برنامه‌ی کسر.
   */
  const {
    legacyEdit,
    autoAllowed,
    planPath: planPathActive
  } = useMemo(
    () =>
      stockPathFor({
        deductInventory,
        storePicked,
        autoCentral,
        editing: editId != null,
        hasLedger
      }),
    [deductInventory, storePicked, autoCentral, editId, hasLedger]
  )

  // ---------------- افزودن قلم ----------------
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
          key: `v${v.id}`,
          variantId: v.id,
          code: v.code,
          barcode: v.barcode,
          name: `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`,
          unit: v.product?.unit ?? 'عدد',
          stock: v.stock ?? 0,
          qty: 1,
          listPrice: v.salePrice ?? 0,
          manualPrice: null,
          categoryId: v.product?.categoryId ?? null
        }
      ]
    })
  }, [])

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

  const modalOpen = confirmClear || allProductsOpen || stockChain != null
  useBarcodeScanner(addByBarcode, { enabled: tab === 'form' && !modalOpen && !creditFocus })

  /**
   * بررسی بارکد اعتبار *بدون* مصرف کردنش. با هر تغییرِ کد (یا اسکن) خودکار صدا
   * زده می‌شود، چون مبلغ اعتبار باید *قبل از ثبت* از «مبلغ دریافتی» کم شود.
   */
  const lookupCredit = useCallback(async (raw: string) => {
    const code = raw.trim()
    setCreditInfo(null)
    setCreditErr(null)
    if (!code) return
    setCreditBusy(true)
    try {
      setCreditInfo(await call<StoreCreditSafeRow>(CH.storeCreditLookup, { code }))
    } catch (e: any) {
      // پیام‌های تفکیک‌شده‌ی فارسی از main («قبلاً مصرف شده» / «منقضی» / …)
      setCreditErr(e.message)
    } finally {
      setCreditBusy(false)
    }
  }, [])

  /**
   * بررسی خودکار با کمی تاخیر: فروشنده‌ی عمده معمولاً بارکد را اسکن می‌کند و
   * نباید مجبور باشد دکمه‌ی «بررسی» را هم بزند.
   */
  useEffect(() => {
    const code = creditCode.trim()
    if (!code) {
      setCreditInfo(null)
      setCreditErr(null)
      return
    }
    const id = setTimeout(() => void lookupCredit(code), 400)
    return () => clearTimeout(id)
  }, [creditCode, lookupCredit])

  // ---------------- جمع‌ها ----------------
  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => s + l.listPrice * l.qty, 0)
    const net = lines.reduce((s, l) => s + effPrice(l, percent) * l.qty, 0)
    // تخفیف ریالی روی کل فاکتور (برای وقتی تخفیف درصدی نمی‌خواهیم). هیچ‌وقت از
    // مبلغ فاکتور بیشتر نمی‌شود تا «قابل پرداخت» منفی نشود.
    const extra = Math.min(Math.max(0, Math.round(extraDiscount || 0)), net)

    // عوارض/حق سرویس روی «مبلغ خالص هر ردیف» (بعد از تخفیف درصدی و سهم تخفیف
    // مبلغی همان ردیف) تا درصدها روی مبلغی که مشتری واقعاً می‌پردازد حساب شود.
    const share = net > 0 ? Math.min(1, extra / net) : 0
    const breakdown = charges.compute(
      lines.map((l) => ({
        categoryId: l.categoryId ?? null,
        lineNet: Math.max(0, Math.round(effPrice(l, percent) * l.qty * (1 - share))),
        qty: l.qty
      }))
    )
    const autoTax = breakdown.taxTotal
    const autoService = breakdown.serviceTotal
    const tax = taxOverride != null ? Math.max(0, Math.round(taxOverride)) : autoTax
    const service = serviceOverride != null ? Math.max(0, Math.round(serviceOverride)) : autoService

    return {
      gross,
      percentDiscount: gross - net,
      extraDiscount: extra,
      discount: gross - net + extra,
      autoTax,
      autoService,
      tax,
      service,
      /** قابل پرداخت = خالص − تخفیف مبلغی + حق سرویس + عوارض */
      payable: Math.max(0, net - extra) + service + tax,
      count: lines.length,
      qty: lines.reduce((s, l) => s + l.qty, 0)
    }
  }, [lines, percent, extraDiscount, taxOverride, serviceOverride, charges.compute])

  /**
   * ---------- بخش ۶: سهم «بارکد اعتبار» از همین فاکتور ----------
   * تا سقف «قابل پرداخت». اگر اعتبار بیشتر بود، مابقی سمت main به شکل یک بارکد
   * اعتبار *جدید* به مشتری برمی‌گردد و سوخت نمی‌شود.
   */
  const creditApplied = useMemo(
    () => (creditInfo && !editId ? Math.min(Math.max(0, Math.round(creditInfo.amount || 0)), totals.payable) : 0),
    [creditInfo, editId, totals.payable]
  )
  /** مبلغی که *واقعاً* باید از خریدار عمده گرفته شود: قابل پرداخت منهای اعتبار. */
  const cashDue = useMemo(() => Math.max(0, totals.payable - creditApplied), [totals.payable, creditApplied])

  useEffect(() => {
    if (!paidTouched) setPaid(cashDue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashDue, paidTouched])

  const setLine = (key: string, patch: Partial<WLine>) =>
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => setLines((p) => p.filter((l) => l.key !== key))

  /**
   * ردیف‌هایی که تعدادشان از موجودی بیشتر است — هشدار زودهنگام در UI (مورد ۷).
   * ⚠️ کمبود موجودی *مانع ثبت نیست* (مورد ۳): فاکتور ثبت می‌شود و بسته به تیک
   * «برداشت خودکار از انبار مرکزی» یا کمبود از انبار مرکزی برداشته می‌شود، یا
   * موجودی همان کالا منفی ثبت می‌گردد. در حالت ویرایش این هشدار خاموش است، چون
   * موجودیِ نشان‌داده‌شده از قبل کسر همین فاکتور را دارد و آنجا فقط *اختلاف*
   * اهمیت دارد.
   */
  const shortStock = useMemo(
    () => (deductInventory && !editId ? lines.filter((l) => l.qty > l.stock) : []),
    [lines, deductInventory, editId]
  )

  /**
   * مورد ۵ — دکمه‌ی «فهمیدم» روی هشدار زرد کمبود موجودی.
   *
   * قبلاً این پیام بدون هیچ دکمه‌ای روی صفحه می‌ماند و جای جدول را می‌گرفت. حالا
   * با «فهمیدم» بسته می‌شود؛ ولی اگر *وضعیت کمبود عوض شود* (قلم جدید، تعداد
   * جدید، یا موجودی جدید) دوباره نشان داده می‌شود — پس هیچ‌وقت هشداری بی‌صدا
   * پنهان نمی‌ماند.
   */
  const shortSignature = useMemo(
    () => shortStock.map((l) => `${l.variantId}:${l.qty}:${l.stock}`).join('|'),
    [shortStock]
  )
  const [shortAck, setShortAck] = useState('')
  /**
   * جلسه ۵۱ — این هشدار زودهنگام موجودی *انبار فروشگاه* را می‌گوید، پس فقط وقتی
   * معنا دارد که مبدأ کسر همان فروشگاه باشد. برای «انبار مرکزی/X» موجودی واقعی
   * از `preview` (قبل از ثبت) خوانده می‌شود، نه از `stock` کالا.
   */
  const showShortage = !!shortStock.length && shortAck !== shortSignature && storePicked

  // ---------------- عملیات ----------------
  const resetForm = useCallback((keepSettings = true) => {
    setLines([])
    setExtraDiscount(0)
    setTaxOverride(null)
    setServiceOverride(null)
    setNote('')
    setPaidTouched(false)
    setPaid(0)
    // بخش ۶: کد اعتبار یک‌بارمصرف است و نباید روی فاکتور بعدی باقی بماند
    setCreditCode('')
    setCreditInfo(null)
    setCreditErr(null)
    setErr(null)
    // نشست ۱۶۷ (S167-D3) — کادر رمز قیمت مرجع خصوصیت همان فاکتور است
    setPriceNeedPw(null)
    setEditId(null)
    setEditNo(null)
    // جلسه ۵۱ — «دفتر مبدأ داشتن» خصوصیتِ همان فاکتورِ در حال ویرایش است
    setHasLedger(false)
    searchRef.current?.clear()
    if (!keepSettings) {
      setLastSaved(null)
      setPercent(0)
      setDiscountMode('PERCENT')
      setDeductInventory(true)
      setDateJalali(jalaliToday())
      // منوی «کسر از انبار» هم مثل «کسر از موجودی انبار» به پیش‌فرض برمی‌گردد
      setStockSourceKey(STORE_PICK_KEY)
      setPlanSummary(null)
    }
  }, [])

  /**
   * پنجره‌ی زنجیره‌ای را باز می‌کند و منتظر جواب می‌ماند:
   *   • برنامه‌ی کسر (تأیید نهایی کاربر) یا
   *   • `null` یعنی «لغو کل فاکتور» ⇒ هیچ چیزی ثبت نمی‌شود.
   * خودِ زنجیره (سؤال‌ها، انتخاب انبار دیگر، منفی شدن) در `StockSourceModal` و با
   * همان `resolveLine` مشترک جلو می‌رود؛ اینجا فقط انتظار است.
   */
  const askChain = useCallback(
    (preview: StockSourcePreview, primaryKey: string) =>
      new Promise<StockAllocationPlan | null>((resolve) => {
        setStockChain({
          preview,
          primaryKey,
          decide: (plan) => {
            setStockChain(null)
            resolve(plan)
          }
        })
      }),
    []
  )

  /**
   * «برنامه‌ی کسر» همین فاکتور را از `preview` می‌سازد — `preview` **هیچ چیزی
   * نمی‌نویسد**. خروجی:
   *   • یک `StockAllocationPlan` آماده‌ی ارسال، یا
   *   • `null` یعنی کاربر «لغو» را زد (فاکتور نباید ثبت شود).
   * خطای شکلی/ناشناس ⇒ throw، تا `save()` همان را نشان دهد و چیزی ثبت نشود.
   */
  const resolveStockPlan = useCallback(async (): Promise<StockAllocationPlan | null> => {
    const want = lines
      .map((l) => ({ variantId: l.variantId, qty: Math.round(l.qty), name: l.name }))
      .filter((l) => l.qty > 0)
    const preview = await call<StockSourcePreview>(CH.stockSourcePreview, {
      lines: want.map((l) => ({ variantId: l.variantId, qty: l.qty }))
    })
    /**
     * کاوش: اگر موجودی انبارِ انتخاب‌شده برای همه‌ی اقلام کافی بود، **هیچ پنجره‌ای
     * باز نمی‌شود** و همان برنامه فرستاده می‌شود. وگرنه زنجیره‌ی سؤال‌ها باز می‌شود.
     */
    const probe = buildSingleSourcePlan(preview.lines, stockSourceKey)
    if (probe.errors.length) throw new Error(probe.errors.join('\n'))
    let plan = probe.plan
    if (probe.shortages.length) {
      plan = await askChain(preview, stockSourceKey)
      if (!plan) return null
    }
    // همان اعتبارسنجی‌ای که سرور هم *قبل از* هر نوشتنی انجام می‌دهد
    const shape = planShapeErrors(plan, want)
    if (shape.length) throw new Error('برنامه‌ی کسر موجودی کامل نشد:\n' + shape.map((e) => `• ${e}`).join('\n'))
    return plan
  }, [lines, stockSourceKey, askChain])

  const save = useCallback(async (overpayReq: OverpayRequest = {}) => {
    if (busy) return
    if (!lines.length) return setErr('فاکتور خالی است؛ حداقل یک قلم اضافه کنید')
    if (!isValidJalaliDate(dateJalali)) return setErr('تاریخ فاکتور معتبر نیست')
    setBusy(true)
    setOverpayFlow(null)
    setSessionBlock(null)
    setSessionReady(false)
    sessionBlockedRef.current = false
    try {
      /** پایه‌ی payload — `autoCentralWithdraw` و `stockPlan` در هر تلاش تعیین می‌شوند. */
      const base = {
        customerId: customer?.id ?? null,
        orderType: OrderType.WHOLESALE,
        issuedAtJalali: dateJalali,
        deductInventory,
        wholesaleDiscountPercent: percent || null,
        // تخفیف ریالی در سطح فاکتور ثبت می‌شود (جمع تخفیف فاکتور شامل آن است)
        invoiceDiscount: totals.extraDiscount,
        // عوارض و حق سرویس در سطح فاکتور ثبت می‌شوند (دیگر tax: 0 هاردکد نیست)
        invoiceTax: totals.tax,
        serviceCharge: totals.service,
        note: note.trim() || undefined,
        // قیمت لیست به‌عنوان unitPrice و تخفیف ردیف = تفاوت با قیمت عمده،
        // تا هم گزارش «جمع تخفیف» درست بماند و هم قیمت مصوب کالا در سند بماند.
        lines: lines.map((l) => {
          const eff = effPrice(l, percent)
          const gross = l.listPrice * l.qty
          const netLine = eff * l.qty
          const useList = eff <= l.listPrice
          return {
            variantId: l.variantId,
            code: l.code,
            barcode: l.barcode,
            name: l.name,
            qty: Math.round(l.qty),
            unitPrice: useList ? l.listPrice : eff,
            discount: useList ? gross - netLine : 0,
            tax: 0
          }
        }),
        // مورد ۷: مهلت برگشت این فاکتور از تنظیم «مشتری راه دور» عمده حساب شود
        remoteCustomer,
        // مورد ۳ و ۷: برداشت خودکار کمبود از انبار مرکزی (فقط وقتی تیک روشن باشد)
        autoCentralWithdraw: autoCentral,
        /**
         * بخش ۶: بارکد اعتبار خرید بعدی. فقط روی *ثبت فاکتور جدید* می‌رود، نه
         * ویرایش: در ویرایش `keepPayments: true` است و پرداختی‌ها (از جمله ردیف
         * اعتبار مصرف‌شده) دست‌نخورده می‌مانند، وگرنه یک اعتبار دو بار خرج می‌شد.
         */
        storeCreditCode: editId ? null : creditCode.trim() || null,
        payments: methodId && paid > 0 ? [{ methodId, amount: Math.round(paid) }] : []
      }
      /**
       * ---------------------------------------------------------------------
       * ثبت/ویرایش — با «مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف)
       *
       * ترتیب عمدی: اول `preview` و تأیید کاربر (هیچ نوشتنی)، بعد ثبت. اگر سرور
       * `STOCK_PLAN_STALE` بدهد یعنی موجودی بین پنجره و ثبت عوض شده و **هیچ
       * چیزی ثبت نشده**؛ پس همان‌جا `preview` دوباره اجرا می‌شود (با موجودی
       * تازه) و سؤال دوباره پرسیده می‌شود.
       * ---------------------------------------------------------------------
       */
      const MAX_STALE_RETRY = 2
      for (let attempt = 0; ; attempt++) {
        const reusePlan = attempt === 0 && overpayReq.confirmOverpay === true && overpayPlanRef.current
        const stockPlan = planPathActive ? (reusePlan ? overpayPlanRef.current : await resolveStockPlan()) : null
        if (planPathActive && !stockPlan) {
          // کاربر «لغو» را زد ⇒ فاکتور ثبت نمی‌شود و هیچ انباری عوض نمی‌شود
          flash(STOCK_PICK_TEXT.cancelled)
          return
        }
        /**
         * ⚠️ سرور `stockPlan` + `autoCentralWithdraw: true` را با هم رد می‌کند
         * (دو مسیر پوشش کمبود هیچ‌وقت با هم اجرا نمی‌شوند). پس با فرستادن برنامه،
         * تیک `false` فرستاده می‌شود — خودِ تنظیمِ تیک دست‌نخورده می‌ماند.
         */
        const payload = {
          ...base,
          autoCentralWithdraw: stockPlan ? false : autoCentral,
          ...(stockPlan ? { stockPlan } : {}),
          // نشست ۶۳ — confirmOverpay / overpayAsCredit / managerPassword فقط از ماشین حالت فلو
          ...overpayReq,
          // نشست ۱۵۶ — رمز عوارض دستی کمتر از خودکار (رمز مدیرِ فلو اضافه‌دریافت اولویت دارد)
          managerPassword: overpayReq.managerPassword ?? (chargePw.trim() || undefined)
        }
        try {
          /**
           * ⚠️ در حالت ویرایش `keepPayments: true` می‌رود و `payments` فرستاده نمی‌شود:
           * تاریخچه‌ی پرداختی‌ها (پرداختی اول، دوم، … و چک‌ها با تاریخ و ساعت خودشان)
           * نباید با ویرایش اقلام پاک شود.
           */
          const inv = editId
            ? await call<any>(CH.saleUpdate, { ...payload, payments: undefined, keepPayments: true, id: editId })
            : await call<any>(CH.saleCreate, payload)
          overpayPlanRef.current = null
          setLastSaved({ id: inv.id, receiptNo: inv.receiptNo, paid: Math.max(0, Math.round(paid)) })
          // نشست ۱۵۶ — رمز عوارض دستی بعد از ثبت موفق پاک می‌شود (در فلو اضافه‌دریافت برای تلاش دوم می‌ماند)
          setChargePw('')
          setPriceNeedPw(null)
          // همان کادر زرد پنل فروش تکی، عیناً روی همین پنل (مورد ۷)
          setWarn(inv.stockWarnings?.length ? inv.stockWarnings.join('\n') : null)
          /** خلاصه‌ی مبدأ کسر (`summarizePlan` سمت سرور) — `null` = مثل قبل، همه از انبار فروشگاه. */
          const sources = inv.stockSources ?? null
          setPlanSummary(
            sources
              ? sources.lines?.length
                ? sources.lines
                : summaryTextLines(sources.groups ?? [], faDigits)
              : null
          )
          flash(
            `فاکتور فروش عمده شماره ${faDigits(inv.receiptNo)} ${editId ? 'ویرایش شد' : 'ثبت شد'} · ` +
              `${faDigits(totals.qty)} عدد · ${money(totals.payable)} ریال · ` +
              `${deductInventory ? 'موجودی انبار به‌روز شد' : 'بدون کسر از موجودی انبار'}` +
              // جلسه ۵۱: مبدأ کسر همین فاکتور، در همان پیام نتیجه
              (sources ? ` · مبدأ کسر: ${summaryShortLine(sources.groups ?? [], faDigits)}` : '') +
              // فروش نسیه: اگر پرداختی از مبلغ فاکتور کمتر بود، باقی‌مانده را همان‌جا بگو
              (inv.remaining > 0
                ? ` · نسیه: باقی‌مانده ${money(inv.remaining)} ریال (پرداختی بعدی را از «فاکتورهای عمده» → «پرداختی‌ها / اقساط» ثبت کنید)`
                : ' · تسویه کامل') +
              // بخش ۶: اعتبار مصرف‌شده روی همین فاکتور (پول نقد نیست)
              (inv.storeCreditApplied > 0
                ? ` · بارکد اعتبار ${money(inv.storeCreditApplied)} ریال مصرف شد` +
                  (inv.storeCreditRemainder
                    ? ` · ${inv.storeCreditRemainder.publicReference} (${money(
                        inv.storeCreditRemainder.amount
                      )} ریال) برای مشتری صادر و چاپ شد`
                    : '')
                : '') +
              // مورد ۷: کد برگشت همین فاکتور عمده (روی رسید چاپی هم می‌آید)
              (inv.returnCode
                ? ` · کد فاکتور برای برگشت از فروش: ${inv.returnCode} · مهلت ${faDigits(
                    remoteCustomer
                      ? settings.sale.wholesaleReturnCodeDaysRemote
                      : settings.sale.wholesaleReturnCodeDays
                  )} روز`
                : '') +
              // نشست ۶۳ · بند ۴-۳۵ — مبلغ اضافه هرگز بی‌صدا نیست: کد اعتبار یا ردیف «دریافت پول اضافه»
              (inv.overpayCredit?.id
                ? ` · ${overpayCreditFlash(inv.overpayCredit, money, faDigits)}`
                : inv.overpayAmount > 0
                  ? ` · مبلغ اضافه‌ی دریافتی: ${money(inv.overpayAmount)} ریال (ردیف «دریافت پول اضافه» در گزارش فاکتور و گزارشات فروش)`
                  : '')
          )
          resetForm()
          if (editId) void reloadList()
          if (inv.overpayCredit?.id) {
            // مرحله ۳ بند ۴-۳۵: اعتبار صادرشده بی‌درنگ چاپ می‌شود (چاپ دوباره از همان پنجره)
            issuedCreditOpenRef.current = true
            setIssuedCredit(inv.overpayCredit)
            await printIssuedOverpayCredit(inv.overpayCredit)
          }
          return
        } catch (e: any) {
          /**
           * «برنامه دیگر معتبر نیست» ⇒ هیچ چیزی ثبت نشده. پیام روشن + اجرای
           * دوباره‌ی `preview`. تکرارِ بی‌پایان هم نمی‌شود (سقف تلاش).
           */
          if (stockPlan && isStalePlanMessage(e) && attempt < MAX_STALE_RETRY) {
            setErr(e.message)
            continue
          }
          // هشدار اضافه‌دریافت / رمز سقف اعتبار ⇒ هیچ چیز ثبت نشده؛ همان برنامه برای ارسال دوباره نگه داشته می‌شود
          overpayPlanRef.current =
            isOverpayWarning(e?.message) || needsManagerPassword(e?.message) ? stockPlan ?? null : null
          throw e
        }
      }
    } catch (e: any) {
      const message = String(e?.message ?? '')
      /**
       * SESSION_REQUIRED: بنر جداگانه‌ی قابل‌اقدام؛ فرم/اقلام دست‌نخورده می‌ماند
       * تا بعد از ریکاوری نشست (رویداد mahak:open-shift-modal) همان فاکتور دوباره
       * ثبت شود. این حالت قبل از پارس هشدار اضافه‌دریافت می‌آید چون withSessionActor
       * بیرون‌ترین دروازه‌ی ثبت است.
       */
      if (e?.code === 'SESSION_REQUIRED') {
        overpayPlanRef.current = null
        sessionBlockedRef.current = true
        setSessionBlock(message)
      } else if (isOverpayWarning(message))
        setOverpayFlow(
          overpayFlowStart(message, {
            entryKind: 'CASH',
            methodKind: editId ? null : methods.find((m) => m.id === methodId)?.kind ?? null
          })
        )
      // سقف اعتبار: همان درخواست مرحله ۳ با رمز مدیر تکرار می‌شود
      else if (needsManagerPassword(message) && overpayReq.overpayAsCredit)
        setOverpayFlow(
          overpayFlowAskPassword({ step: 'submit', message: null, eligible: true, request: overpayReq }, message)
        )
      else {
        overpayPlanRef.current = null
        // نشست ۱۶۷ (S167-D3) — رمز مدیرِ قیمت دستی/قیمت مرجع ⇒ کادر رمز کنار «مبلغ قابل پرداخت»
        if (needsManagerPassword(message)) setPriceNeedPw(message)
        setErr(message)
      }
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    busy,
    methods,
    lines,
    dateJalali,
    customer,
    deductInventory,
    percent,
    note,
    methodId,
    paid,
    creditCode,
    totals,
    resetForm,
    editId,
    autoCentral,
    remoteCustomer,
    chargePw,
    // جلسه ۵۱ — مبدأ کسر
    planPathActive,
    resolveStockPlan,
    settings.sale.wholesaleReturnCodeDays,
    settings.sale.wholesaleReturnCodeDaysRemote
  ])

  /**
   * چاپ رسید یک فاکتور ثبت‌شده با مبلغ پرداختی دلخواه.
   * مانده‌حساب سمت main از (جمع کل − پرداختی) حساب می‌شود، پس هیچ محاسبه‌ای
   * اینجا تکرار نمی‌شود.
   */
  const printInvoiceId = useCallback(async (invoiceId: number, paidTotal: number, receiptNo?: number) => {
    setPrinting(true)
    try {
      /**
       * نشست ۲۲۲ · فاز ۱ طرح چاپ — این صفحه «فاکتور عمده» است، پس پروفایل چاپ را
       * صریح می‌فرستد تا اگر مدیر کاغذ/چاپگر جدا برای عمده روشن کرده باشد، همان
       * اعمال شود (پیش‌فرض `wholesaleSeparate` خاموش ⇒ دقیقاً مثل تکی).
       */
      /** فاز ۳ — صفحه‌ی عمده هم از مسیر مشترک چاپ می‌گذرد (پروفایل WHOLESALE). */
      const res = await printWith('WHOLESALE', (deviceName, opts) =>
        call(CH.printInvoice, {
          invoiceId,
          paidTotal: Math.max(0, Math.round(paidTotal)),
          profile: 'WHOLESALE',
          deviceName,
          silent: opts?.silent
        })
      )
      if (res === 'CANCELLED') return
      flash(
        `فاکتور${receiptNo ? ' شماره ' + faDigits(receiptNo) : ''} برای چاپ فرستاده شد · ` +
          `مبلغ پرداختی ${money(Math.max(0, Math.round(paidTotal)))} ریال`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPrinting(false)
    }
  }, [])

  /** دکمه‌ی «چاپ فاکتور» فرم: فاکتور در حال ویرایش، یا آخرین فاکتور ثبت‌شده. */
  const printCurrent = useCallback(() => {
    if (editId) return void printInvoiceId(editId, paid, editNo ?? undefined)
    if (lastSaved) return void printInvoiceId(lastSaved.id, lastSaved.paid, lastSaved.receiptNo)
    setErr(
      'برای چاپ فاکتور، اول آن را ذخیره کنید. چاپ از روی فاکتور ثبت‌شده انجام می‌شود تا مبالغ روی رسید مو‌به‌مو با سند ثبت‌شده یکی باشد.'
    )
  }, [editId, editNo, paid, lastSaved, printInvoiceId])

  useHotkeys(
    useMemo(
      () => ({
        'Ctrl+s': () => void save(),
        'Ctrl+S': () => void save(),
        F4: () => resetForm(false),
        F7: () => (lines.length ? setConfirmClear(true) : undefined)
      }),
      [save, resetForm, lines.length]
    ),
    tab === 'form' && !modalOpen
  )

  /**
   * جلسه ۵۳ · مرحله ۴ — «مبدأ کسر» فاکتورهای *همین فهرست*. فقط خواندنی و فقط
   * وقتی تب فهرست باز است. فاکتور بی‌دفتر (قبل از جلسه ۴۷) خانه‌ی خالی می‌گیرد
   * و مو‌به‌مو مثل قبل نمایش داده می‌شود.
   */
  const stockSources = useSaleStockSources(
    rows.map((r) => r.id),
    tab === 'list'
  )

  const loadList = useCallback(async (skip = 0, range?: { from: string; to: string }) => {
    // ممیزی A117-03 (AUDIT-D51، الگوی D48) — «نمایش» بازه‌ی فعلی state را اعمال می‌کند (skip=۰)؛
    // صفحه‌ی قبل/بعد و بارگذاری دوباره بازه‌ی اعمال‌شده را پاس می‌دهند، نه from/to فعلی state.
    const rf = range?.from ?? from
    const rt = range?.to ?? to
    if (!isValidJalaliDate(rf) || !isValidJalaliDate(rt)) return setErr('بازه‌ی تاریخ معتبر نیست')
    setLoadingList(true)
    try {
      const r = await call<any[] & { page?: any; warnings?: string[]; totals?: { count: number; grandTotal: number } }>(
        CH.saleList,
        {
          from: jalaliStartOfDay(rf).toISOString(),
          to: jalaliEndOfDay(rt).toISOString(),
          orderType: OrderType.WHOLESALE,
          skip
        }
      )
      setRows(r)
      // نشست ۱۱۷ (S117-4) — جمع و تعداد از کل بازه، نه از ردیف‌های همین صفحه
      setListTotals(r.totals ?? { count: r.length, grandTotal: r.reduce((s, x) => s + (x.grandTotal ?? 0), 0) })
      setListPage(r.page ?? null)
      setListWarnings(r.warnings ?? [])
      setListMeta({ range: { from: rf, to: rt } })
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [from, to])

  /** ممیزی A117-03 — بعد از ویرایش/پرداخت: همان بازه و همان صفحه‌ای که روی صفحه است (نه state تازه‌ی تاریخ) */
  const reloadList = () => (listMeta.range ? loadList(listPage?.skip ?? 0, listMeta.range) : loadList())

  useEffect(() => {
    if (tab === 'list') void loadList()
    // فقط با ورود به تب؛ بعد از آن با «نمایش» یا صفحه‌ی قبل/بعد (روی بازه‌ی اعمال‌شده)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  /**
   * پر کردن فرم با اطلاعات یک فاکتور ثبت‌شده.
   * ذخیره‌ی فاکتور، قیمت مصوب را در unitPrice و تخفیف عمده را در discount هر
   * ردیف نگه می‌دارد؛ اینجا همان محاسبه برعکس می‌شود تا «قیمت مصوب» و «قیمت
   * پس از تخفیف» دقیقاً مثل لحظه‌ی ثبت دیده شوند. اگر قیمت یک ردیف با درصد
   * سراسری نمی‌خواند، به‌عنوان «قیمت دستی» علامت می‌خورد.
   */
  const startEdit = useCallback(async (row: any) => {
    setLoadingEdit(true)
    setErr(null)
    try {
      const inv = await call<any>(CH.saleGet, { id: row.id })
      if (!inv) throw new Error('این فاکتور پیدا نشد؛ لیست را تازه کنید')
      const pct = inv.wholesaleDiscountPercent ?? 0
      setEditId(inv.id)
      setEditNo(inv.receiptNo)
      setDateJalali(inv.issuedAtJalali)
      setCustomer(inv.customer ?? null)
      setPercent(pct)
      setDeductInventory(!!inv.deductInventory)
      setNote(inv.note ?? '')
      // تخفیف ریالی فاکتور = جمع تخفیف فاکتور منهای تخفیف‌های ردیفی (درصدی)
      const lineDiscountSum = (inv.items ?? []).reduce((s: number, it: any) => s + (it.discount ?? 0), 0)
      const extra = Math.max(0, Math.round((inv.discountTotal ?? 0) - lineDiscountSum))
      setExtraDiscount(extra)
      // باکس واحد تخفیف: هر کدام مقدار دارد همان حالت انتخاب می‌شود
      setDiscountMode(pct > 0 || extra === 0 ? 'PERCENT' : 'AMOUNT')
      // مبالغ عوارض/حق سرویس همان فاکتور به‌عنوان مقدار دستی بار می‌شوند تا
      // ویرایش، سند ثبت‌شده را بی‌اجازه با تنظیمات جدید بازنویسی نکند.
      setTaxOverride(Math.max(0, Math.round(inv.taxTotal ?? 0)))
      setServiceOverride(Math.max(0, Math.round(inv.serviceCharge ?? 0)))
      setLines(
        (inv.items ?? []).map((it: any) => {
          const qty = it.qty || 1
          const listPrice = it.unitPrice ?? 0
          const eff = Math.round((listPrice * qty - (it.discount ?? 0)) / qty)
          const fromPercent = Math.round(listPrice * (1 - pct / 100))
          return {
            key: `i${it.id}`,
            variantId: it.variantId,
            code: it.variant?.code ?? '',
            barcode: it.variant?.barcode ?? '',
            name: `${it.variant?.product?.name ?? ''}${it.variant?.size ? ' سایز ' + it.variant.size : ''}${
              it.variant?.color ? ' - ' + it.variant.color : ''
            }`,
            unit: it.variant?.product?.unit ?? 'عدد',
            stock: it.variant?.stock ?? 0,
            qty,
            listPrice,
            manualPrice: eff === fromPercent ? null : eff,
            categoryId: it.variant?.product?.categoryId ?? null
          } as WLine
        })
      )
      const firstPayment = (inv.payments ?? [])[0]
      if (firstPayment?.methodId) setMethodId(firstPayment.methodId)
      setPaidTouched(true)
      setPaid(inv.paidTotal ?? 0)
      setTab('form')
      /**
       * جلسه ۵۱ — این فاکتور «دفتر مبدأ» دارد؟
       *   • دارد ⇒ ویرایشش **باید** با برنامه‌ی کسر برود (سرور بی برنامه ردش
       *     می‌کند) و منوی انبار روی همان مبدأ قبلی تنظیم می‌شود.
       *   • ندارد (فاکتور قبل از جلسه ۴۷) ⇒ عمداً برنامه نمی‌فرستیم و مسیر قدیمی
       *     (delta) می‌ماند؛ منو قفل و پیامش نمایش داده می‌شود.
       * کانال `saleStockSources` فقط خواندنی است و چیزی نمی‌نویسد.
       */
      try {
        const sum = await call<any>(CH.saleStockSources, { invoiceId: inv.id })
        const groups: any[] = sum?.groups ?? []
        setHasLedger(groups.length > 0)
        setPlanSummary(
          groups.length ? (sum?.lines?.length ? sum.lines : summaryTextLines(groups as any, faDigits)) : null
        )
        setStockSourceKey(groups.length === 1 ? String(groups[0].sourceKey) : STORE_PICK_KEY)
      } catch {
        setHasLedger(false)
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoadingEdit(false)
    }
  }, [])

  const cancelEdit = useCallback(() => {
    resetForm(false)
    flash('ویرایش لغو شد؛ فاکتور ثبت‌شده بدون تغییر ماند')
  }, [resetForm])

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">فاکتور فروش (عمده)</h1>
        <span className="kbd">
          {SHORTCUTS.save} ذخیره · {SHORTCUTS.newItem} جدید · {SHORTCUTS.deleteSelected} حذف · فروش خرده در پنل فروش (
          {SHORTCUTS.pos})
        </span>
        <div className="ms-auto flex gap-1">
          <button className={`btn ${tab === 'form' ? 'btn-primary' : ''}`} onClick={() => setTab('form')}>
            ثبت فاکتور
          </button>
          <button className={`btn ${tab === 'list' ? 'btn-primary' : ''}`} onClick={() => setTab('list')}>
            فاکتورهای عمده
          </button>
        </div>
      </div>

      {tab === 'form' ? (
        <>
          {editId && (
            <div className="rounded shadow p-2 border-2 bg-sky-50 border-sky-400 flex flex-wrap items-center gap-3">
              <b>در حال ویرایش فاکتور شماره {faDigits(editNo ?? 0)}</b>
              <span className="kbd">
                با ذخیره، همین فاکتور به‌روز می‌شود (شماره فیش عوض نمی‌شود) و فقط *اختلاف* اقلام روی موجودی انبار اعمال
                می‌گردد.
              </span>
              <button className="btn ms-auto" onClick={cancelEdit} disabled={busy}>
                انصراف از ویرایش
              </button>
            </div>
          )}

          {/* ----------- سوییچ کلیدی: کسر از موجودی انبار (در سطح همین فاکتور) ----------- */}
          <div
            className={`rounded shadow p-2 border-2 flex flex-wrap items-center gap-3 ${
              deductInventory ? 'bg-emerald-50 border-emerald-400' : 'bg-amber-50 border-amber-400'
            }`}
          >
            {/* ---------- مورد ۷: مشتری راه دور (مهلت برگشت بلندتر) ---------- */}
            <label
              className={`flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded border-2 cursor-pointer ${
                remoteCustomer ? 'bg-emerald-50 border-emerald-400 font-bold' : 'border-slate-300'
              }`}
              title={`مهلت برگشت این فاکتور عمده از تنظیم «مشتری راه دور» حساب می‌شود (${faDigits(
                settings.sale.wholesaleReturnCodeDaysRemote
              )} روز) نه مهلت عادی (${faDigits(settings.sale.wholesaleReturnCodeDays)} روز)`}
            >
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={remoteCustomer}
                onChange={(e) => setRemoteCustomer(e.target.checked)}
              />
              مشتری راه دور
              <span className="kbd">
                مهلت برگشت{' '}
                {faDigits(
                  remoteCustomer
                    ? settings.sale.wholesaleReturnCodeDaysRemote
                    : settings.sale.wholesaleReturnCodeDays
                )}{' '}
                روز
              </span>
            </label>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={deductInventory}
                onChange={(e) => setDeductInventory(e.target.checked)}
              />
              {deductInventory ? 'کسر از موجودی انبار (فعال)' : 'بدون کسر از موجودی انبار'}
            </label>
            <span className="kbd">
              {deductInventory
                ? 'با ذخیره‌ی فاکتور، موجودی همین کالاها از انبار فروشگاه کم می‌شود (مثل فروش معمولی، اتمیک).'
                : 'اقلام و مبالغ ثبت می‌شوند ولی هیچ تغییری در موجودی انبار فروشگاه اعمال نمی‌شود (کالا از انبار دیگر یا فاکتور فقط جنبه‌ی مدارک دارد).'}
            </span>
            <span className="kbd ms-auto">این انتخاب روی همین فاکتور ذخیره می‌شود، نه به‌عنوان تنظیم سراسری.</span>
          </div>

          {/**
           * ---------- جلسه ۵۱ · مرحله ۲-الف — «کسر از انبار» ----------
           * یک انتخاب در سطح همین فاکتور (مثل «کسر از موجودی انبار»، نه تنظیم
           * سراسری). پیش‌فرض «انبار فروشگاه» ⇒ رفتار مو‌به‌مو همان قبل.
           * صفحه از قبل با `PANEL_KEYS.wholesaleInvoiceModule` قفل است، پس قفل
           * تازه‌ای لازم نیست.
           */}
          <div
            className={`rounded p-2 border-2 flex flex-wrap items-center gap-2 ${
              storePicked ? 'bg-slate-50 border-slate-300' : 'bg-sky-50 border-sky-400'
            }`}
          >
            <label className="flex items-center gap-2 font-bold whitespace-nowrap">
              {STOCK_PICK_TEXT.label}
              <select
                className="inp w-60"
                value={stockSourceKey}
                onChange={(e) => setStockSourceKey(e.target.value)}
                disabled={!deductInventory || legacyEdit}
                title={
                  legacyEdit
                    ? STOCK_PICK_TEXT.legacyEdit
                    : 'همه‌ی اقلام این فاکتور از همین انبار کم می‌شوند (قبل از ثبت بررسی می‌شود).'
                }
              >
                {pickOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                    {o.location ? ` — ${o.location}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <span className="kbd">
              {!deductInventory
                ? 'چون «کسر از موجودی انبار» خاموش است، این انتخاب بی‌اثر است (فاکتور اصلاً به هیچ انباری دست نمی‌زند).'
                : legacyEdit
                  ? STOCK_PICK_TEXT.legacyEdit
                  : storePicked
                    ? STOCK_PICK_TEXT.hintStore
                    : STOCK_PICK_TEXT.hintWarehouse}
            </span>
            <span className="kbd ms-auto">
              {planPathActive
                ? 'قبل از ثبت، موجودی همین انبار بی هیچ نوشتنی بررسی می‌شود؛ اگر کم بیاید پرسیده می‌شود.'
                : 'این انتخاب روی همین فاکتور ذخیره می‌شود، نه به‌عنوان تنظیم سراسری.'}
            </span>
          </div>

          {/**
           * ---------- برداشت خودکار از انبار مرکزی (مورد ۳ و ۷) ----------
           * مورد ۴ (نشست نهم): همان قفل ریز مستقل پنل فروش، با همان کلید — یک
           * تنظیم واحد، پس یک قفل واحد در هر سه محل.
           */}
          <ManagerGate
            panel={PANEL_KEYS.posCentralWithdrawToggle}
            title={CENTRAL_WITHDRAW_GATE.title}
            reason={CENTRAL_WITHDRAW_GATE.reason}
            inline
          >
          <div
            className={`rounded p-2 border-2 flex flex-wrap items-center gap-2 ${
              autoCentral ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-slate-300'
            }`}
          >
            <label
              className={`flex items-center gap-2 font-bold whitespace-nowrap ${
                autoCentralBox.locked ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
              title={
                autoCentralBox.locked
                  ? 'قفل مدیر: کارمند نمی‌تواند این گزینه را تغییر دهد'
                  : 'کمبود موجودی هر قلم در لحظه‌ی ثبت از انبار مرکزی برداشته می‌شود'
              }
            >
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={autoCentral}
                onChange={(e) => void autoCentralBox.toggle(e.target.checked)}
                /** جلسه ۵۱ — فقط برای «انبار فروشگاه» معنا دارد (قفل تیک دست‌نخورده است). */
                disabled={!deductInventory || autoCentralBox.locked || !autoAllowed}
              />
              برداشت خودکار از انبار مرکزی هنگام کمبود موجودی
              {autoCentralBox.locked && <span className="kbd">🔒 فقط مدیر</span>}
            </label>
            <span className="kbd">
              {!deductInventory
                ? 'چون «کسر از موجودی انبار» خاموش است، این گزینه بی‌اثر می‌ماند (فاکتور اصلاً به انبار دست نمی‌زند).'
                : !autoAllowed
                  ? `${STOCK_PICK_TEXT.autoOnlyStore} چون مبدأ کسر «${pickedOption?.name ?? ''}» است، کمبود همان انبار پرسیده می‌شود.`
                  : autoCentral
                  ? 'روشن: کمبود موجودی هر قلم در لحظه‌ی ثبت از «انبار مرکزی» کسر و به انبار فروشگاه منتقل می‌شود و هشدار زرد جزئیاتش را می‌گوید.'
                  : 'خاموش (پیش‌فرض): کمبود موجودی مثل قبل منفی ثبت می‌شود و انبار مرکزی لمس نمی‌شود.'}
            </span>
            <span className="kbd ms-auto">
              {autoCentralBox.locked
                ? 'این تیک قفل است و فقط مدیر عوضش می‌کند · مشترک با «پنل فروش تکی» و «تنظیمات انبار مرکزی» (یک تنظیم، سه پنل).'
                : 'همین تیک در «پنل فروش تکی» و «تنظیمات انبار مرکزی» هم مشترک است (یک تنظیم، سه پنل).'}
            </span>
          </div>
          <AutoCentralPasswordBox box={autoCentralBox} />
          </ManagerGate>

          <div className="bg-white rounded shadow p-2 grid grid-cols-12 gap-2 items-start">
            <div className="col-span-2">
              <div className="mb-1">تاریخ</div>
              <JalaliDateInput value={dateJalali} onChange={setDateJalali} className="inp" />
            </div>
            <div className="col-span-3">
              <PartyPicker
                kind="customer"
                scope="wholesale"
                value={customer}
                onChange={setCustomer}
                label="خریدار (عمده)"
              />
            </div>
            {/* ------- یک باکس واحد برای تخفیف: نوع + مقدار (جای دو باکس قبلی) ------- */}
            <div className="col-span-3">
              <div className="mb-1">تخفیف فاکتور</div>
              <div className="flex items-center gap-1">
                <select
                  className="inp w-32"
                  value={discountMode}
                  onChange={(e) => {
                    const mode = e.target.value === 'AMOUNT' ? 'AMOUNT' : 'PERCENT'
                    setDiscountMode(mode)
                    // فقط همان یکی معنا دارد، پس آن یکی صفر می‌شود (بدون محاسبه‌ی دوباره)
                    if (mode === 'AMOUNT') setPercent(0)
                    else setExtraDiscount(0)
                  }}
                  title="تخفیف را درصدی یا به مبلغ ثابت ریالی وارد کنید"
                >
                  <option value="PERCENT">درصدی</option>
                  <option value="AMOUNT">مبلغ ثابت (ریال)</option>
                </select>
                {discountMode === 'PERCENT' ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="inp"
                      value={percent}
                      onChange={(e) => setPercent(Math.min(100, Math.max(0, Math.round(+e.target.value || 0))))}
                    />
                    <span className="font-bold">٪</span>
                  </>
                ) : (
                  <input
                    type="number"
                    min={0}
                    className="inp"
                    value={extraDiscount}
                    onChange={(e) => setExtraDiscount(Math.max(0, Math.round(+e.target.value || 0)))}
                  />
                )}
              </div>
              <div className="kbd">
                {discountMode === 'PERCENT'
                  ? 'روی همه‌ی ردیف‌ها اعمال می‌شود (مگر ردیفی که قیمتش دستی شده)'
                  : `از جمع کل فاکتور کم می‌شود${
                      totals.extraDiscount > 0 ? ` · ${money(totals.extraDiscount)} ریال` : ''
                    }`}
              </div>
            </div>
            <label className="col-span-2">
              <div className="mb-1">وضعیت تسویه</div>
              <select
                className="inp"
                value={methodId ?? ''}
                onChange={(e) => setMethodId(e.target.value ? Number(e.target.value) : null)}
              >
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2">
              <div className="mb-1">تعداد اقلام</div>
              <div className="inp bg-slate-50">
                {faDigits(totals.count)} ردیف · {faDigits(totals.qty)} عدد
              </div>
            </label>
          </div>

          <div className="bg-white rounded shadow p-2 flex gap-2 items-center">
            <VariantSearchBox
              ref={searchRef}
              onPick={addVariant}
              autoFocus
              placeholder="کد یا بارکد کالا را وارد کنید یا نام را جستجو کنید"
              onAllOpenChange={setAllProductsOpen}
              allTitle="انتخاب کالا از فهرست انبار (فاکتور فروش عمده)"
            />
            <span className="kbd whitespace-nowrap">
              اسکن بارکد = افزودن مستقیم · تایپ نام = جستجو · «همه کالاها» = انتخاب دستی · تعداد را در جدول ویرایش کنید
            </span>
          </div>

          {/**
           * مورد ۷ — جدول اقلام فاکتور عمده.
           * قبلاً فقط `flex-1` بود و چون کادرهای بالا و پایین صفحه جا می‌گرفتند،
           * ارتفاعش (خصوصاً در حالت ویرایش فاکتور) تا یک ردیف آب می‌رفت. حالا یک
           * ارتفاع کمینه‌ی مطمئن دارد، خودش اسکرول می‌شود و سرستون‌هایش هنگام
           * اسکرول ثابت می‌مانند — در هر دو حالت «ثبت فاکتور جدید» و «ویرایش».
           */}
          <div className="bg-white rounded shadow flex-1 overflow-auto min-h-[300px] max-h-[52vh]">
            <table className="tbl">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">#</th>
                  <th>کد</th>
                  <th>بارکد</th>
                  <th>نام کالا</th>
                  <th>موجودی</th>
                  <th>تعداد</th>
                  <th>قیمت مصوب</th>
                  <th>قیمت واحد (پس از تخفیف)</th>
                  <th>عوارض / حق سرویس</th>
                  <th>جمع</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const eff = effPrice(l, percent)
                  const short = deductInventory && l.qty > l.stock
                  return (
                    <tr key={l.key} className={short ? 'bg-red-50' : ''}>
                      <td>{faDigits(i + 1)}</td>
                      <td>{faDigits(l.code)}</td>
                      <td>{faDigits(l.barcode)}</td>
                      <td>{l.name}</td>
                      <td className={`text-center ${short ? 'text-red-600 font-bold' : ''}`}>
                        {faDigits(l.stock)} {l.unit}
                      </td>
                      <td className="w-24">
                        <input
                          type="number"
                          min={1}
                          className="inp py-0.5"
                          value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: Math.max(1, Math.round(+e.target.value || 0)) })}
                        />
                      </td>
                      <td>{money(l.listPrice)}</td>
                      <td className="w-40">
                        <input
                          type="number"
                          min={0}
                          className={`inp py-0.5 ${l.manualPrice != null ? 'bg-amber-50 border-amber-400' : ''}`}
                          value={eff}
                          onChange={(e) => setLine(l.key, { manualPrice: Math.max(0, +e.target.value || 0) })}
                        />
                        <div className="kbd">
                          {l.manualPrice != null ? (
                            <button className="text-brand" onClick={() => setLine(l.key, { manualPrice: null })}>
                              بازگشت به درصد سراسری
                            </button>
                          ) : percent > 0 ? (
                            `${faDigits(percent)}٪ تخفیف`
                          ) : (
                            'قیمت مصوب'
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {(() => {
                          const rule = charges.explain(l.categoryId ?? null)
                          return (
                            <span className="kbd" title="از دسته‌بندی همین کالا (قابل تغییر در تنظیمات عوارض عمده)">
                              {faDigits(describeChargeRule(rule.tax))} / {faDigits(describeChargeRule(rule.service))}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="font-bold">{money(eff * l.qty)}</td>
                      <td>
                        <button className="text-red-500" onClick={() => removeLine(l.key)}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {!lines.length && (
                  <tr>
                    <td colSpan={11} className="text-center py-10 text-slate-400">
                      کالایی اضافه نشده است؛ بارکد را اسکن کنید یا کد/نام کالا را جستجو کنید
                    </td>
                  </tr>
                )}
              </tbody>
              {!!lines.length && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={5}>جمع</td>
                    <td className="text-center">{faDigits(totals.qty)}</td>
                    <td>{money(totals.gross)}</td>
                    <td>تخفیف {money(totals.discount)}</td>
                    <td className="kbd">
                      {money(totals.tax)} / {money(totals.service)}
                    </td>
                    <td>{money(totals.payable)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* هشدار زودهنگام کمبود موجودی — با دکمه‌ی «فهمیدم» (مورد ۵) */}
          {showShortage && (
            <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 whitespace-pre-line leading-6">
              موجودی انبار فروشگاه برای {faDigits(shortStock.length)} قلم کافی نیست:{' '}
              {shortStock
                .map(
                  (l) =>
                    `«${l.name}» (موجودی ${faDigits(l.stock)} ${l.unit} · درخواست ${faDigits(l.qty)} ⇒ کمبود ${faDigits(
                      l.qty - l.stock
                    )})`
                )
                .join(' · ')}
              {'\n'}
              {autoCentral
                ? 'با ذخیره‌ی فاکتور، این کمبود به‌صورت خودکار از «انبار مرکزی» کسر و به انبار فروشگاه منتقل می‌شود.'
                : 'ثبت فاکتور انجام می‌شود ولی موجودی این کالاها منفی خواهد شد. برای برداشت از انبار مرکزی، مدیر باید چک‌باکس «برداشت خودکار از انبار مرکزی» را روشن کند؛ و اگر کالا از انبار دیگری تامین می‌شود می‌توانید سوییچ «کسر از موجودی انبار» را خاموش کنید.'}
              <div className="mt-1">
                <button
                  className="btn py-0.5"
                  onClick={() => setShortAck(shortSignature)}
                  title="پیام بسته می‌شود؛ اگر اقلام یا کمبود عوض شود دوباره نشان داده می‌شود"
                >
                  فهمیدم
                </button>
              </div>
            </div>
          )}

          {/**
           * جلسه ۵۱ — خلاصه‌ی «مبدأ کسر» فاکتورِ ثبت/ویرایش‌شده (خروجی
           * `summarizePlan` سمت سرور، پس با دفتر مبدأ مو‌به‌مو یکی است). در حالت
           * ویرایش، مبدأ کسرِ *قبلیِ* همان فاکتور را هم نشان می‌دهد.
           */}
          {!!planSummary?.length && (
            <div className="rounded px-3 py-2 border bg-sky-50 border-sky-300 whitespace-pre-line leading-6">
              <span className="font-bold">{STOCK_PICK_TEXT.summaryTitle}: </span>
              {planSummary.join('\n')}
              <button className="btn ms-2 py-0.5" onClick={() => setPlanSummary(null)}>
                بستن
              </button>
            </div>
          )}

          {/* هشدار زرد برگشتی از main بعد از ثبت/ویرایش (کسر از انبار مرکزی / موجودی منفی) */}
          {warn && (
            <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line leading-6">
              {warn}
              <button className="btn ms-2 py-0.5" onClick={() => setWarn(null)}>
                متوجه شدم
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

          <div className="bg-white rounded shadow p-2 grid grid-cols-12 gap-2 items-start">
            <label className="col-span-2">
              <div className="mb-1">جمع کل</div>
              <div className="inp bg-slate-50 font-bold">{money(totals.gross)}</div>
            </label>
            <label className="col-span-2">
              <div className="mb-1">جمع تخفیف</div>
              <div className="inp bg-slate-50">{money(totals.discount)}</div>
              {totals.extraDiscount > 0 && (
                <div className="kbd">شامل {money(totals.extraDiscount)} ریال تخفیف مبلغی</div>
              )}
            </label>
            {/* حق سرویس و عوارض: خودکار از تنظیمات دسته‌بندی (اسکوپ عمده)، با override دستی */}
            <ChargeField
              label="حق سرویس"
              auto={totals.autoService}
              value={totals.service}
              override={serviceOverride}
              onOverride={setServiceOverride}
            />
            <ChargeField
              label="عوارض و مالیات"
              auto={totals.autoTax}
              value={totals.tax}
              override={taxOverride}
              onOverride={setTaxOverride}
            />
            {(priceNeedPw ||
              (taxOverride != null && taxOverride < totals.autoTax) ||
              (serviceOverride != null && serviceOverride < totals.autoService)) && (
              <label className="col-span-2" title="عوارض/حق سرویس دستیِ کمتر از مبلغ خودکار، یا قیمت کمتر از قیمت مرجع، فقط با رمز مدیر ثبت می‌شود">
                <div className="mb-1">
                  {priceNeedPw ? 'رمز مدیر (قیمت کمتر از قیمت مرجع)' : 'رمز مدیر (عوارض/حق سرویس کمتر از خودکار)'}
                </div>
                <PasswordField value={chargePw} placeholder="رمز مدیر" onChange={(e) => setChargePw(e.target.value)} />
                {priceNeedPw && <div className="kbd mt-1 text-amber-700 whitespace-normal">{priceNeedPw}</div>}
              </label>
            )}
            <label className="col-span-2">
              <div className="mb-1">مبلغ قابل پرداخت</div>
              <div className="inp bg-emerald-50 border-emerald-300 font-bold text-emerald-800 text-base">
                {money(totals.payable)}
              </div>
            </label>
            {/**
             * ---------------- بخش ۶: بارکد اعتبار خرید بعدی ----------------
             * همان قابلیت پنل فروش تکی، برای یکدستی روی فاکتور عمده هم هست.
             * مبلغ اعتبار *قبل از ثبت* از «مبلغ دریافتی» کم می‌شود، چون سقف جذب
             * اعتبار سمت main «باقی‌ماندهٔ فاکتور» است.
             */}
            <label className="col-span-2">
              <div className="mb-1">بارکد اعتبار خرید بعدی</div>
              <div className="flex gap-1">
                <input
                  className="inp text-center tracking-widest"
                  dir="ltr"
                  value={creditCode}
                  placeholder="مثلاً E7M4QP"
                  disabled={!!editId}
                  onFocus={() => setCreditFocus(true)}
                  onBlur={() => setCreditFocus(false)}
                  onChange={(e) => setCreditCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void lookupCredit(creditCode)
                    }
                  }}
                  title="کد روی «سند تعویض» مشتری. اسکن یا تایپ کنید؛ مبلغش از فاکتور کم می‌شود ولی در «خالص واقعی دریافتی» گزارش شمرده نمی‌شود."
                />
                <button
                  className="btn"
                  onClick={() => void lookupCredit(creditCode)}
                  disabled={creditBusy || !creditCode.trim() || !!editId}
                >
                  {creditBusy ? '…' : 'بررسی'}
                </button>
              </div>
              <div className="kbd leading-6">
                {editId ? (
                  'در حالت ویرایش، اعتبار دوباره مصرف نمی‌شود (پرداختی‌های ثبت‌شده دست‌نخورده می‌مانند).'
                ) : creditErr ? (
                  <span className="text-amber-800 font-bold whitespace-pre-line">{creditErr}</span>
                ) : creditApplied > 0 ? (
                  <span className="text-emerald-800 font-bold">
                    اعتبار معتبر: {money(creditApplied)} ریال از این فاکتور کم شد
                    {creditInfo?.expiresAtJalali ? ` · تا ${faDigits(creditInfo.expiresAtJalali)}` : ''}
                    {creditInfo && creditInfo.amount > creditApplied
                      ? ` · ${money(creditInfo.amount - creditApplied)} ریال باقی‌مانده به‌صورت بارکد اعتبار جدید برمی‌گردد`
                      : ''}
                  </span>
                ) : (
                  'خالی بگذارید = بدون اعتبار. بارکد سند تعویض را اسکن کنید تا مبلغش از این فاکتور کم شود.'
                )}
              </div>
            </label>
            <label className="col-span-2">
              <div className="mb-1">مبلغ دریافتی</div>
              <input
                type="number"
                min={0}
                className="inp"
                value={paid}
                disabled={!!editId}
                onChange={(e) => {
                  setPaidTouched(true)
                  setPaid(Math.max(0, +e.target.value || 0))
                }}
              />
              <div className="kbd">
                {editId ? (
                    <>
                      تاریخچه‌ی پرداختی‌ها با ویرایش عوض نمی‌شود ·{' '}
                      <button className="text-brand font-bold" onClick={() => setPaymentsFor(editId)}>
                        پرداختی‌ها / اقساط
                      </button>
                    </>
                  ) : paid >= cashDue ? (
                    creditApplied > 0
                      ? `تسویه کامل (${money(creditApplied)} ریال با بارکد اعتبار + ${money(paid)} ریال دریافتی)`
                      : 'تسویه کامل'
                  ) : (
                    `نسیه · باقی‌مانده: ${money(cashDue - paid)} ریال (پرداختی‌های بعدی را بعداً ثبت کنید)` +
                    (creditApplied > 0 ? ` · ${money(creditApplied)} ریال آن با بارکد اعتبار تسویه شد` : '')
                  )}
              </div>
            </label>
            <label className="col-span-12">
              <div className="mb-1">یادداشت</div>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="kbd">
                «مبلغ دریافتی» روی فاکتور چاپی به‌عنوان مبلغ پرداختی و مانده‌حساب چاپ می‌شود · عوارض و حق سرویس از
                تنظیمات «فاکتور فروش عمده» می‌آید و مستقل از پنل فروش خرد است.
              </div>
            </label>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'در حال ذخیره…' : editId ? 'ذخیره‌ی ویرایش' : 'ذخیره'} <span className="kbd">{SHORTCUTS.save}</span>
            </button>
            <button className="btn" onClick={() => resetForm(false)} disabled={busy}>
              جدید <span className="kbd">{SHORTCUTS.newItem}</span>
            </button>
            <button
              className="btn"
              onClick={printCurrent}
              disabled={busy || printing}
              title="چاپ رسید همین فاکتور با مبلغ پرداختی و مانده‌حساب"
            >
              {printing ? 'در حال چاپ…' : 'چاپ فاکتور'}
              {editId ? (
                <span className="kbd"> شماره {faDigits(editNo ?? 0)}</span>
              ) : lastSaved ? (
                <span className="kbd"> شماره {faDigits(lastSaved.receiptNo)}</span>
              ) : null}
            </button>
            <button className="btn btn-danger" onClick={() => setConfirmClear(true)} disabled={busy || !lines.length}>
              حذف فاکتور <span className="kbd">{SHORTCUTS.deleteSelected}</span>
            </button>
            <div className="kbd self-center">
              ثبت اتمیک است: فاکتور، اقلام، دریافتی و {deductInventory ? 'کسر موجودی' : 'صرف‌نظر از کسر موجودی'} در یک
              تراکنش انجام می‌شود و در AuditLog با همین حالت ثبت می‌گردد.
            </div>
          </div>
        </>
      ) : !listUnlocked ? (
        /* ---------- قفل رمزی پنل «فاکتورهای فروش عمده» (مخصوص حسابداری) ---------- */
        <ManagerGate
          panel={PANEL_KEYS.wholesaleInvoices}
          title="فاکتورهای فروش عمده"
          reason="این فهرست، فاکتورهای عمده و پرداختی‌ها/اقساط و چک‌های هر فاکتور را نشان می‌دهد، پس با رمز باز می‌شود. مدیر می‌تواند برای همین پنل یک «رمز دوم اختصاصی» تعریف کند و آن را به حسابدار بدهد، بدون این‌که رمز اصلی خودش را لو بدهد."
          inline
        >
          <div />
        </ManagerGate>
      ) : (
        <>
          <div className="bg-white rounded shadow p-2 flex flex-wrap gap-3 items-end">
            <div>
              <div className="mb-1">از تاریخ</div>
              <JalaliDateInput value={from} onChange={setFrom} />
            </div>
            <div>
              <div className="mb-1">تا تاریخ</div>
              <JalaliDateInput value={to} onChange={setTo} />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void loadList()}
              disabled={loadingList}
            >
              {loadingList ? 'در حال دریافت…' : 'نمایش'}
            </button>
            <div className="kbd">
              {faDigits(listTotals.count)} فاکتور عمده · جمع {money(listTotals.grandTotal)} ریال
            </div>
          </div>
          {!!listWarnings.length && listPage && (
            <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 flex flex-wrap items-center gap-2">
              {listWarnings.map((w) => (
                <div key={w} className="w-full">{w}</div>
              ))}
              {purchaseRangeDirty(listMeta.range, from, to) && (
                <div className="w-full font-bold">
                  (این صفحه‌ها مربوط به بازه‌ی {faDigits(listMeta.range!.from)} تا {faDigits(listMeta.range!.to)} است؛ برای بازه‌ی تازه «نمایش» را بزنید)
                </div>
              )}
              <button
                className="btn"
                disabled={loadingList || !purchasePageRequest(listMeta.range, listPage, rows.length, 'prev')}
                onClick={() => {
                  const q = purchasePageRequest(listMeta.range, listPage, rows.length, 'prev')
                  if (q) void loadList(q.skip, q)
                }}
              >
                صفحه‌ی قبل
              </button>
              <button
                className="btn"
                disabled={loadingList || !purchasePageRequest(listMeta.range, listPage, rows.length, 'next')}
                onClick={() => {
                  const q = purchasePageRequest(listMeta.range, listPage, rows.length, 'next')
                  if (q) void loadList(q.skip, q)
                }}
              >
                صفحه‌ی بعد
              </button>
            </div>
          )}

          <div className="tbl-card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>شماره</th>
                  <th>تاریخ</th>
                  <th>خریدار</th>
                  <th>جمع کل</th>
                  <th>تخفیف</th>
                  <th>قابل پرداخت</th>
                  <th>دریافتی</th>
                    <th>باقی‌مانده</th>
                    <th>وضعیت تسویه</th>
                  <th>درصد عمده</th>
                  <th>کسر موجودی</th>
                  {/* جلسه ۵۳ · مرحله ۴ — ستون کوچک «مبدأ کسر» (خواندنی) */}
                  <th title={STOCK_PICK_TEXT.columnExplainer}>{STOCK_PICK_TEXT.columnTitle}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="font-bold">{faDigits(r.receiptNo)}</td>
                      <td>{faDigits(r.issuedAtJalali)}</td>
                      <td>{r.customer?.name ?? '—'}</td>
                      <td>{money(r.goodsTotal)}</td>
                      <td>{money(r.discountTotal)}</td>
                      <td className="font-bold">{money(r.grandTotal)}</td>
                      <td>{money(r.paidTotal)}</td>
                      <td className={r.grandTotal - r.paidTotal > 0 ? 'text-amber-700 font-bold' : ''}>
                        {money(Math.max(0, r.grandTotal - r.paidTotal))}
                      </td>
                      <td
                        className={r.paidTotal >= r.grandTotal ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}
                        title={
                          r.settledAtJalali
                            ? `تاریخ تسویه: ${faDigits(r.settledAtJalali)}`
                            : 'این فاکتور باقی‌مانده دارد (فروش نسیه)'
                        }
                      >
                        {r.paidTotal >= r.grandTotal ? 'تسویه‌شده ✔' : 'تسویه‌نشده'}
                        {(r.payments ?? []).some((pm: any) => pm.kind === 'CHEQUE' && pm.chequeStatus === 'PENDING') ? (
                          <span className="kbd">
                            {' '}
                            · {faDigits((r.payments ?? []).filter((pm: any) => pm.kind === 'CHEQUE' && pm.chequeStatus === 'PENDING').length)} چک در جریان
                          </span>
                        ) : null}
                      </td>
                      <td className="text-center">
                        {r.wholesaleDiscountPercent != null ? `${faDigits(r.wholesaleDiscountPercent)}٪` : '—'}
                      </td>
                      <td className={r.deductInventory ? 'text-emerald-700' : 'text-amber-700 font-bold'}>
                        {r.deductInventory ? 'کسر شد' : 'بدون کسر'}
                      </td>
                      {/**
                        * جلسه ۵۳ · مرحله ۴ — «مبدأ کسر» همین فاکتور، از دفتر
                        * `SaleItemStockAllocation` (خروجی `summarizePlan` سرور).
                        * خالی ⇒ «—»، یعنی فاکتور دفتر ندارد و مثل قبل کاملاً از
                        * انبار فروشگاه کم شده است.
                        */}
                      <td
                        className="whitespace-nowrap"
                        title={
                          stockSources.shortOf(r.id)
                            ? stockSources.linesOf(r.id).join('\n') || STOCK_PICK_TEXT.columnExplainer
                            : STOCK_PICK_TEXT.columnExplainer
                        }
                      >
                        {stockSources.shortOf(r.id) ? (
                          <span className="font-bold text-sky-800">{stockSources.shortOf(r.id)}</span>
                        ) : (
                          <span className="kbd">{STOCK_PICK_TEXT.emptyCell}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <button className="text-brand" onClick={() => void startEdit(r)} disabled={loadingEdit}>
                          {loadingEdit ? '…' : 'ویرایش'}
                        </button>
                        <span className="opacity-40 px-1">|</span>
                        <button
                          className="text-brand"
                          onClick={() => void printInvoiceId(r.id, r.paidTotal ?? 0, r.receiptNo)}
                          disabled={printing}
                          title="چاپ فاکتور با مبلغ پرداختی و مانده‌حساب همین فاکتور"
                        >
                          چاپ فاکتور
                        </button>
                        <span className="opacity-40 px-1">|</span>
                        <button
                          className="text-brand font-bold"
                          onClick={() => setPaymentsFor(r.id)}
                          title="ثبت پرداختی دوم/سوم (نسیه)، ثبت و کنترل چک، و دیدن تاریخچه‌ی پرداختی‌ها"
                        >
                          پرداختی‌ها / اقساط
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={13} className="text-center py-10 text-slate-400">
                      در این بازه فاکتور فروش عمده‌ای ثبت نشده است
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {sessionBlock && (
            <div className="border-2 border-red-500 bg-red-50 text-red-900 rounded px-3 py-2 flex items-center gap-2 justify-between whitespace-pre-line">
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
            <div className="bg-emerald-50 border border-emerald-400 text-emerald-800 rounded px-3 py-2 flex items-center gap-2 justify-between">
              <span>نشست آماده است؛ همان فاکتور را دوباره ثبت کنید.</span>
              <button className="btn" onClick={() => setSessionReady(false)} title="بستن">
                ✕
              </button>
            </div>
          )}
          {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
          <div className="kbd">
            «ویرایش» فرم را با اطلاعات همان فاکتور پر می‌کند؛ با ذخیره، شماره فیش حفظ می‌شود و فقط اختلاف اقلام روی
            موجودی انبار اعمال می‌گردد. فاکتوری که برگشت از فروش دارد یا در «تجمیع و انتقال» قطعی شده، قابل ویرایش نیست.
          </div>
        </>
      )}

      {/* ---------- پرداختی‌ها / اقساط یک فاکتور (فروش نسیه + چک) ---------- */}
      <InvoicePaymentsModal
        open={paymentsFor != null}
        invoiceId={paymentsFor}
        methods={methods}
        debtReceiptPrint={settings.sale.debtPaymentReceiptPrint === true}
        onClose={() => setPaymentsFor(null)}
        onChanged={() => {
          if (tab === 'list') void reloadList()
        }}
      />

      {/**
       * ---------- جلسه ۵۱ · مرحله ۲-ب — پنجره‌ی «از کدام انبار کسر شود؟» ----------
       * فقط وقتی باز می‌شود که موجودی انبارِ انتخاب‌شده برای قلمی کم بیاید و مسیر
       * برنامه فعال باشد (تیک خاموش، یا مبدأ غیر از انبار فروشگاه). «لغو کل
       * فاکتور» در هر مرحله ممکن است و هیچ چیزی ثبت نشده است.
       */}
      {/* ---------- نشست ۶۳ · بند ۴-۳۵: فلوی چهارمرحله‌ای اضافه‌دریافت (همان جزء پنجره‌ی پرداخت‌ها) ---------- */}
      <OverpayFlowDialogs
        flow={overpayFlow}
        busy={busy}
        onFlow={setOverpayFlow}
        onSubmit={(req) => void save(req)}
        issuedCredit={issuedCredit}
        onCloseIssued={() => {
          issuedCreditOpenRef.current = false
          setIssuedCredit(null)
          setOverpayCreditPrintProblem(null)
        }}
        onReprint={(pw) => void printIssuedOverpayCredit(issuedCredit, { reprintPassword: pw })}
        creditPrinting={overpayCreditPrinting}
        creditPrintProblem={overpayCreditPrintProblem}
      />

      <StockSourceModal
        open={stockChain != null}
        preview={stockChain?.preview ?? null}
        primaryKey={stockChain?.primaryKey ?? STORE_PICK_KEY}
        onCancel={() => stockChain?.decide(null)}
        onConfirm={(plan) => stockChain?.decide(plan)}
      />

      <Modal
        open={confirmClear}
        title="حذف فاکتور جاری"
        onClose={() => setConfirmClear(false)}
        width="max-w-md"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmClear(false)}>
              انصراف
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false)
                resetForm(false)
                flash('فاکتور جاری پاک شد')
              }}
            >
              حذف
            </button>
          </>
        }
      >
        <p>
          {faDigits(totals.count)} ردیف از فاکتور ثبت‌نشده‌ی جاری پاک می‌شود. چون این فاکتور ذخیره نشده، هیچ تغییری در
          موجودی انبار رخ نداده است.
        </p>
      </Modal>
    </div>
  )
}

/**
 * یک خانه‌ی «حق سرویس» یا «عوارض و مالیات» در جمع‌های فاکتور عمده.
 * پیش‌فرض: مقدار خودکار از تنظیمات دسته‌بندی کالا (اسکوپ عمده).
 * «دستی»: همان مقدار قابل ویرایش می‌شود و فقط روی همین فاکتور اثر دارد.
 */
function ChargeField({
  label,
  auto,
  value,
  override,
  onOverride
}: {
  label: string
  auto: number
  value: number
  override: number | null
  onOverride: (v: number | null) => void
}) {
  const manual = override != null
  return (
    <label className="col-span-2">
      <div className="mb-1">{label}</div>
      {manual ? (
        <input
          type="number"
          min={0}
          className="inp bg-amber-50 border-amber-400"
          value={override ?? 0}
          onChange={(e) => onOverride(Math.max(0, Math.round(+e.target.value || 0)))}
        />
      ) : (
        <div className="inp bg-slate-50">{money(value)}</div>
      )}
      <div className="kbd flex gap-2">
        <button className="text-brand" onClick={() => onOverride(manual ? null : auto)}>
          {manual ? 'بازگشت به خودکار' : 'دستی'}
        </button>
        {manual && <span>خودکار: {money(auto)}</span>}
      </div>
    </label>
  )
}
