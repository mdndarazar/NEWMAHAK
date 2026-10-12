import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
// نشست ۳۱۶ — جداکننده‌ی هزارگانِ زنده در ورودی «مبلغ بازپرداخت» (state همچنان رقمِ خام)
import { digitsOnly, groupThousands } from '../lib/moneyInput'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { isUnknownPrintMessage } from '../lib/printErrors'
import { useBarcodeScanner, useFieldScanDetector } from '../hooks/useBarcodeScanner'
import ConfirmDialog from '../components/ConfirmDialog'
import PasswordField from '../components/PasswordField'
import OverpayFlowDialogs, { printOverpayCredit, type OverpayCreditPrintProblem } from '../components/OverpayFlowDialogs'
import {
  isOverpayWarning,
  needsManagerPassword,
  overpayFlowStart,
  overpayFlowAskPassword,
  overpayCreditFlash,
  type OverpayFlowState,
  type OverpayRequest
} from '@shared/overpayFlow'
import ReturnEditModal from '../components/ReturnEditModal'
import JalaliDateInput from '../components/JalaliDateInput'
import VariantSearchBox, { type VariantSearchBoxHandle } from '../components/VariantSearchBox'
import { useCharges } from '../hooks/useCharges'
import { faDigits, money, jalaliToday, isValidJalaliDate, parseGroupedInteger } from '@shared/jalali'
import { returnValueOf, isReturnableStatus } from '@shared/returnValue'
import type { ExchangeSaleResult, ReturnLookup, ReturnLookupItem, CardPosOverrideInput } from '@shared/types'
import InvoiceFinanceBadge from '../components/returns/InvoiceFinanceBadge'
import SmartSettlementPanel from '../components/returns/SmartSettlementPanel'
import CardPosOverrideDialog from '../components/returns/CardPosOverrideDialog'
import { useReturnGuidance } from '../hooks/useReturnGuidance'
import { usePanelLock, usePanelOpen } from '../hooks/usePanelLocks'
import { useManagerSession } from '../hooks/useManagerSession'
import { PANEL_KEYS } from '@shared/panels'

/**
 * ===================== برگشت از فروش و تعویض کالا =====================
 * جریان کار (همان چیزی که در فروشگاه اتفاق می‌افتد):
 *
 *   ۱) مشتری رسید را می‌آورد. کاربر «کد فاکتور» را وارد می‌کند — یا بارکد
 *      روی رسید را با بارکدخوان اسکن می‌کند (بدون تایپ).
 *   ۲) سیستم فاکتور فروش تکی متناظر را — در بازه‌ی اعتبار یک‌هفته‌ای کد — پیدا
 *      می‌کند و اقلامش را نشان می‌دهد.
 *   ۳) کاربر تعداد برگشتی هر قلم را می‌گذارد (کامل یا جزئی) و ثبت می‌کند؛
 *      همان تعداد به موجودی انبار برمی‌گردد (حرکت انبار SALE_RETURN، قطعی).
 *
 * ---------------------------- تعویض کالا (بخش ۶) ----------------------------
 * با روشن کردن چک‌باکس «تعویض کالا»، زیر جدول اقلام یک بخش «کالای جایگزین» باز
 * می‌شود که *همان سه روش پنل فروش* را دارد: اسکن بارکد (بارکدخوان در همین صفحه
 * فعال است)، جست‌وجوی نام، و تایپ کد کالا — به‌علاوه‌ی دکمه‌ی «همه کالاها».
 * کنار هر قلم برگشتی هم دکمه‌ی «+ جایگزین» هست که همان کادر را فوکوس می‌کند و
 * می‌گوید جایگزین کدام قلم در حال انتخاب است.
 *
 * «مابه‌التفاوت» زنده و همان لحظه حساب می‌شود (جمع کالای جایگزین − جمع کالای
 * برگشتی) و روی صفحه سه حالتش روشن نوشته می‌شود:
 *   • مثبت ⇒ مشتری می‌پردازد (روش پرداختش را همان‌جا انتخاب می‌کنید).
 *   • منفی ⇒ ما بدهکاریم و «بارکد اعتبار خرید بعدی» صادر می‌شود.
 *   • صفر  ⇒ تسویه‌ای لازم نیست.
 * دکمه‌ی «ثبت تعویض کالا» کانال IPC `sale:exchange:create` را صدا می‌زند و کل
 * کار (برگشت + سند تعویض + تسویه + صدور بارکد) در یک تراکنش سمت main انجام
 * می‌شود؛ این صفحه هیچ محاسبه‌ی مالی‌ای را «تصمیم» نمی‌گیرد، فقط نمایش می‌دهد.
 * بعد از ثبت، دکمه‌ی «چاپ سند تعویض» (کانال `print:exchange`) همان‌جا می‌آید.
 *
 * کالای حذف‌شده از انبار:
 *   اگر کالای یک قلم از فهرست کالاهای انبار حذف شده باشد، پیام روشن
 *   «این کالا از موجودی انبار حذف شده است» نمایش داده می‌شود و آن قلم به‌طور
 *   خودکار برگشت نمی‌خورد. فقط با تیک زدن «رسیدگی دستی» (تایید آگاهانه‌ی
 *   کاربر) برگشتش ثبت می‌شود. کالایی که رکوردش کلاً از سیستم رفته باشد، در هیچ
 *   حالتی برگشت خودکار نمی‌خورد (فقط هشدار).
 *
 * ویرایش و حذف یک برگشت ثبت‌شده:
 *   هر ردیف فهرست برگشت‌ها دو دکمه دارد. «ویرایش» فرم اصلاح تعداد/اقلام همان
 *   برگشت را باز می‌کند و «حذف» بعد از یک تاییدیه، آن برگشت را باطل می‌کند و
 *   اثرش روی موجودی انبار کامل برگردانده می‌شود. هر دو، همان سرویس‌های آماده‌ی
 *   فروش را صدا می‌زنند (منطق موجودی سمت main است، نه اینجا).
 *
 * IPC: sale:byReturnCode · sale:return · sale:return:list · sale:return:get ·
 *      sale:return:update · sale:return:delete · print:invoice ·
 *      sale:exchange:create · print:exchange · payment:methods
 * =========================================================
 */

interface QtyMap {
  [saleItemId: number]: number
}

/** عملیاتی که فقط پس از بازشدن قفل مستقل اصلاح/ابطال اجرا می‌شود. */
type ReturnCorrectionAction = 'EDIT' | 'VOID' | 'RECONCILE'
type PendingReturnCorrectionAction = { action: ReturnCorrectionAction; row: any }

interface Method {
  id: number
  key: string
  label: string
  kind: string
}

/** یک قلم «جایگزین» در فرم تعویض کالا (همان شکل ردیف سبد پنل فروش). */
interface RepLine {
  variantId: number
  code: string
  barcode: string
  name: string
  qty: number
  unitPrice: number
  /**
   * ---------------------- بند ۱۸ سند مرجع (جلسه ۱۶) ----------------------
   * قیمت *واقعیِ* ثبت‌شده‌ی کالا (`variant.salePrice`) در لحظه‌ی انتخاب.
   *
   * چرا نگه داشته می‌شود؟ چون قیمت کالای جایگزین همیشه از همین عدد شروع می‌کند و
   * تغییر دستی‌اش فقط با رمز مدیر ممکن است. فروشنده‌ای که کالای برگشتیِ ۳
   * میلیونی را با کالایی که قیمت واقعی‌اش ۱ میلیون است ولی روی صفر گذاشته
   * تعویض کند، ۳ میلیون اعتبار خرید می‌گیرد و در گزارش هیچ چیز غیرعادی دیده
   * نمی‌شود. با داشتن «قیمت واقعی» کنار «قیمت واردشده»، هم صفحه اختلاف را
   * فریاد می‌زند و هم `AuditLog` سمت main هر دو عدد را ثبت می‌کند.
   */
  realPrice: number
  discount: number
  /** موجودی لحظه‌ی انتخاب — فقط برای هشدار زودهنگام کمبود موجودی */
  stock: number
  /** نشست ۱۵۸ (Y16) — دسته‌ی کالا برای عوارض/حق سرویس (سرور از دیتابیس دوباره می‌سنجد) */
  categoryId: number | null
}

/** بند ۱۱ — چهار روش بازپرداخت برگشت ساده. هیچ‌کدام پیش‌فرض نیست. */
type RefundMethodValue = 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | 'NONE'

const REFUND_CHOICES: { value: RefundMethodValue; title: string; hint: string }[] = [
  {
    value: 'CASH',
    title: 'بازپرداخت نقدی',
    hint: 'پول از کشوی صندوق بیرون می‌رود و در «بستن صندوق» از موجودی انتظاری کم می‌شود.'
  },
  {
    value: 'CARD',
    title: 'بازپرداخت کارتی',
    hint: 'به کارت مشتری برگشت؛ روی کارت‌خوان اثر دارد، ولی از کشوی صندوق پولی بیرون نمی‌رود.'
  },
  {
    value: 'STORE_CREDIT',
    title: 'بارکد اعتبار خرید بعدی',
    hint: 'هیچ نقدی جابه‌جا نمی‌شود؛ یک بدهی ما به مشتری ثبت و بارکد یک‌بارمصرف صادر می‌شود.'
  },
  /**
   * ---------------------- جلسه ۱۷ · بند ۱ ----------------------
   * یک مسیر **کاملاً جدا** از گزینه‌ی «بازپرداخت کارتی» بالا.
   *   • «کارتی» = تسویه‌ی *فوری* با دستگاه کارت‌خوان خودِ فروشگاه (دست‌نخورده).
   *   • «کارت‌به‌کارت توسط مدیر» = هیچ پرداختی همین حالا انجام نمی‌شود؛ فقط یک
   *     «درخواست پرداخت» با وضعیت «در انتظار پرداخت» ساخته می‌شود و مدیر بعداً
   *     از تب «درخواست‌های کارت‌به‌کارت» گزارشات فروش آن را تأیید می‌کند.
   * این مبلغ نه از کشوی صندوق خارج می‌شود و نه در سرجمع فروش می‌آید.
   */
  {
    value: 'CARD_TO_CARD',
    title: 'کارت‌به‌کارت توسط مدیر (در انتظار پرداخت)',
    hint: 'پرداخت فوری انجام نمی‌شود: یک درخواست پرداخت به فاکتور، برگشت، شیفت و کارمند ثبت‌کننده وصل می‌شود و مدیر آن را از گزارشات فروش تأیید می‌کند. کارت‌خوان فروشگاه و کشوی صندوق هیچ اثری نمی‌گیرند.'
  },
  {
    value: 'NONE',
    title: 'بدون بازپرداخت (فقط بدهی مشتری کم شود)',
    hint: 'برای فاکتور نسیه‌ی پرداخت‌نشده: طلب ما کم می‌شود و هیچ پولی جابه‌جا نمی‌گردد.'
  }
]

/** بند ۱۲ — سه گزینه‌ی *متقابلاً انحصاری* تسویه‌ی مابه‌التفاوت منفی تعویض. */
const EXCHANGE_REFUND_CHOICES: { value: 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD'; title: string; hint: string }[] = [
  { value: 'CASH', title: 'بازپرداخت نقدی', hint: 'پول از کشوی صندوق بیرون می‌رود (یک بازپرداخت واقعی ثبت می‌شود).' },
  { value: 'CARD', title: 'بازپرداخت کارتی', hint: 'به کارت مشتری برگشت؛ از کشو پولی بیرون نمی‌رود.' },
  { value: 'STORE_CREDIT', title: 'صدور اعتبار خرید', hint: 'بارکد یک‌بارمصرف صادر می‌شود؛ اثر نقدی صفر.' },
  { value: 'CARD_TO_CARD', title: 'کارت‌به‌کارت توسط مدیر', hint: 'پرداخت فوری انجام نمی‌شود؛ درخواست پرداخت برای تایید مدیر ثبت می‌شود.' }
]

/** نشست ۲ · C1 — ارزش برگشت هر قلم، دقیقاً همان فرمول main (سهم واقعی پرداختی مشتری) */
const returnValueFor = (i: ReturnLookupItem, q: number) => returnValueOf(i.netLineValue ?? 0, i.qty, i.returnedQty, q)

const canReturn = (i: ReturnLookupItem) => i.stockState !== 'MISSING' && i.remainingQty > 0

export default function SalesReturn() {
  const nav = useNavigate()
  /**
   * اصلاح/ابطال یک قفل عملیاتی مستقل دارد: باز بودن خودِ صفحه‌ی برگشت مجوز
   * تغییر سند قبلی نیست. تا بارگیری سیاست هم fail-closed می‌مانیم.
   */
  const correctionOpen = usePanelOpen(PANEL_KEYS.salesReturnCorrection)
  const { loaded: correctionLockLoaded } = usePanelLock(PANEL_KEYS.salesReturnCorrection)
  const { unlockPanel } = useManagerSession()
  const [correctionUnlockRequest, setCorrectionUnlockRequest] = useState<PendingReturnCorrectionAction | null>(null)
  const [correctionUnlockPassword, setCorrectionUnlockPassword] = useState('')
  const [correctionUnlockBusy, setCorrectionUnlockBusy] = useState(false)
  const [correctionUnlockError, setCorrectionUnlockError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [lookup, setLookup] = useState<ReturnLookup | null>(null)
  const [qty, setQty] = useState<QtyMap>({})
  const [allowRemoved, setAllowRemoved] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmForce, setConfirmForce] = useState<string | null>(null)
  const [history, setHistory] = useState<any[]>([])
  /**
   * ==================== بند ۱۱ — روش بازپرداخت (اجباری) ====================
   * `null` یعنی «کاربر هنوز انتخاب نکرده»، و همین حالت، دکمه‌ی ثبت را می‌بندد.
   * عمداً هیچ مقدار پیش‌فرضی ندارد: پیش‌فرض داشتن، همان فرض ضمنی‌ای است که
   * تفکیک «کسری واقعی» از «کسری کاذب» را از بین می‌برد.
   */
  const [refundMethod, setRefundMethod] = useState<RefundMethodValue | null>(null)
  /** خالی = کل مبلغ برگشت (همان پیش‌فرض سمت سرور) */
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReference, setRefundReference] = useState('')
  const [refundNote, setRefundNote] = useState('')
  const [managerFullRefund, setManagerFullRefund] = useState(false)
  const [fullRefundPw, setFullRefundPw] = useState('')
  const [fullRefundReason, setFullRefundReason] = useState('')
  /** نتیجه‌ی برگشت ساده‌ی تازه ثبت‌شده — برای دکمه‌ی «چاپ رسید برگشت» (بند ۱۳) */
  const [retResult, setRetResult] = useState<any | null>(null)
  /** نشست ۱۸۹ · بند ۴-۳۵ — فلو چهارمرحله‌ای اضافه‌دریافت ساخته‌شده با برگشت */
  const [overpayFlow, setOverpayFlow] = useState<OverpayFlowState | null>(null)
  const [overpayReq, setOverpayReq] = useState<OverpayRequest>({})
  const [issuedOverpayCredit, setIssuedOverpayCredit] = useState<any | null>(null)
  const issuedOverpayCreditOpenRef = useRef(false)
  const [overpayCreditPrinting, setOverpayCreditPrinting] = useState(false)
  const [overpayCreditPrintProblem, setOverpayCreditPrintProblem] = useState<OverpayCreditPrintProblem>(null)
  /**
   * بند ۱۲ — تسویه‌ی مابه‌التفاوت *منفی* تعویض؛ بدون پیش‌فرض ضمنی.
   * جلسه ۱۷ · بند ۱ — گزینه‌ی چهارم «کارت‌به‌کارت توسط مدیر» هم اضافه شد و
   * عمداً یک مقدار *جدا* است، نه حالتی از `CARD`.
   */
  const [exRefundMode, setExRefundMode] = useState<'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | null>(null)
  /**
   * بند ۱۸ — قفل قیمت دستیِ کالای جایگزین. تا این قفل با رمز مدیر باز نشود،
   * کادرهای قیمت غیرفعال‌اند و همیشه همان `variant.salePrice` را نشان می‌دهند.
   */
  const [priceOverrideOn, setPriceOverrideOn] = useState(false)
  const [managerPw, setManagerPw] = useState('')
  /**
   * بند ۱۷ — قفل دوره‌ی بسته‌شده. سرور با یک پیام روشن رد می‌کند؛ این دو فیلد
   * *فقط بعد از همان پیام* روی صفحه می‌آیند تا کاربر عادی حتی نبیندشان.
   */
  const [lockNeeded, setLockNeeded] = useState(false)
  const [lockPw, setLockPw] = useState('')
  const [lockReason, setLockReason] = useState('')
  /** نشست ۳۱۹ — تأیید مدیر برای بازپرداخت کارتی (کارت‌خوان) */
  const [cardPosDialog, setCardPosDialog] = useState(false)
  const [cardPosOverride, setCardPosOverride] = useState<CardPosOverrideInput | null>(null)
  const guidance = useReturnGuidance(lookup, qty)
  // ---- بخش ۶: تعویض کالا ----
  /** حالت تعویض روشن است؟ (خاموش = همان برگشت ساده‌ی همیشگی، دست‌نخورده) */
  const [exchangeMode, setExchangeMode] = useState(false)
  const [reps, setReps] = useState<RepLine[]>([])
  const [methods, setMethods] = useState<Method[]>([])
  const [methodId, setMethodId] = useState<number | null>(null)
  /** پرداخت مثبت تعویض با دو ردیف واقعی نقد و کارت، نه یک پرداخت مصنوعی. */
  const [exSplitPayment, setExSplitPayment] = useState(false)
  const [exSplitCash, setExSplitCash] = useState('')
  const [exSplitCard, setExSplitCard] = useState('')
  const [exSplitCashMethodId, setExSplitCashMethodId] = useState<number | null>(null)
  const [exSplitCardMethodId, setExSplitCardMethodId] = useState<number | null>(null)
  /** کمبود موجودی کالای جایگزین از انبار مرکزی برداشته شود؟ */
  const [repAutoCentral, setRepAutoCentral] = useState(false)
  /** جایگزینِ کدام قلم برگشتی در حال انتخاب است (فقط یک راهنمای روی صفحه) */
  const [repFor, setRepFor] = useState<string | null>(null)
  /** نتیجه‌ی تعویضِ تازه ثبت‌شده (کد بارکد اعتبار + دکمه‌ی چاپ سند) */
  const [exResult, setExResult] = useState<
    | (ExchangeSaleResult & {
        cashReceived?: number
        exchangeCreditApplied?: number
        /** جلسه ۱۷ · بند ۱ — درخواست کارت‌به‌کارتی که همین تعویض ساخته است */
        cardTransfer?: { id: number; amount: number; status: string } | null
      })
    | null
  >(null)
  const [confirmExchange, setConfirmExchange] = useState<string | null>(null)
  const [repModalOpen, setRepModalOpen] = useState(false)
  // ---- فهرست برگشت‌ها: بازه‌ی تاریخ + ویرایش/حذف هر ردیف ----
  const [histFrom, setHistFrom] = useState(jalaliToday())
  const [histTo, setHistTo] = useState(jalaliToday())
  const [editId, setEditId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  /** نشست ۶۴ · بند ۴-۲۲ — «حذف» = ابطال با دلیل اجباری (سند می‌ماند) */
  const [voidReason, setVoidReason] = useState('')
  /**
   * قفل پیش‌فرضِ اصلاح/ابطال. در روز/دوره‌ی بسته همین فیلد باید رمز مدیر
   * باشد؛ در روز جاری رمز مدیر یا رمز دوم اختصاصی این عمل کافی است.
   */
  const [voidAuthPassword, setVoidAuthPassword] = useState('')
  /** برای روزهای بعد/دوره‌بسته: مدیر مشخص + رمز شخصی همان مدیر (نه رمز سراسری). */
  const [voidApproverUserId, setVoidApproverUserId] = useState<number | null>(null)
  const [voidApproverPassword, setVoidApproverPassword] = useState('')
  const [voidManagers, setVoidManagers] = useState<{ id: number; name: string; role: string; isActive: boolean; hasCorrectionApprovalPassword?: boolean }[]>([])
  const [voidReasonErr, setVoidReasonErr] = useState<string | null>(null)
  /** دفتر جبرانیِ مستقل برای برگشتی که پول/اعتبارش واقعاً تعیین‌تکلیف شده است. */
  const [correctionTarget, setCorrectionTarget] = useState<any | null>(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionAuthPassword, setCorrectionAuthPassword] = useState('')
  const [correctionApproverUserId, setCorrectionApproverUserId] = useState<number | null>(null)
  const [correctionApproverPassword, setCorrectionApproverPassword] = useState('')
  const [correctionCash, setCorrectionCash] = useState('')
  const [correctionCard, setCorrectionCard] = useState('')
  const [correctionCardReference, setCorrectionCardReference] = useState('')
  const [correctionCreditOutcome, setCorrectionCreditOutcome] = useState('NONE')
  const [correctionNote, setCorrectionNote] = useState('')
  const [correctionErr, setCorrectionErr] = useState<string | null>(null)
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const repSearchRef = useRef<VariantSearchBoxHandle>(null)
  const scan = useFieldScanDetector()

  useEffect(() => {
    inputRef.current?.focus()
    call<Method[]>(CH.paymentMethods)
      .then((list) => {
        setMethods(list ?? [])
        setMethodId((cur) => cur ?? list?.[0]?.id ?? null)
        setExSplitCashMethodId((cur) => cur ?? list?.find((method) => method.kind === 'CASH')?.id ?? null)
        setExSplitCardMethodId((cur) => cur ?? list?.find((method) => method.kind === 'CARD')?.id ?? null)
      })
      .catch(() => setMethods([]))
  }, [])

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 10000)
  }

  /** مدیرهای فعال فقط برای مسیرهای دیرهنگام/دوره‌بسته خوانده می‌شوند. */
  const loadCorrectionManagers = () => {
    void call<{
      rows?: { id: number; name: string; role: string; isActive: boolean; hasCorrectionApprovalPassword?: boolean }[]
    }>(CH.staffDirectory, { includeInactive: false })
      .then((res) => setVoidManagers((res?.rows ?? []).filter((u) => u.role === 'MANAGER' && u.isActive)))
      .catch(() => setVoidManagers([]))
  }

  /** فقط پس از گیت، مودال/دیالوگِ تغییر واقعی باز می‌شود. */
  const launchReturnCorrectionAction = (request: PendingReturnCorrectionAction) => {
    const { action, row } = request
    if (action === 'EDIT') {
      setEditId(row.id)
      return
    }
    if (action === 'VOID') {
      setVoidReason('')
      setVoidAuthPassword('')
      setVoidApproverUserId(null)
      setVoidApproverPassword('')
      setVoidReasonErr(null)
      setDeleteTarget(row)
      loadCorrectionManagers()
      return
    }
    setCorrectionReason('')
    setCorrectionAuthPassword('')
    setCorrectionApproverUserId(null)
    setCorrectionApproverPassword('')
    setCorrectionCash('')
    setCorrectionCard('')
    setCorrectionCardReference('')
    setCorrectionCreditOutcome(row.storeCreditReference ? 'REMAINS_ACTIVE' : 'NONE')
    setCorrectionNote('')
    setCorrectionErr(null)
    setCorrectionTarget(row)
    loadCorrectionManagers()
  }

  /**
   * 🔒 درخواست کاربر: با قفل روشن، فرم تغییر هرگز زودتر از احراز هویت باز
   * نمی‌شود. پیام، مسیر درست را نشان می‌دهد؛ «فرم بسته بود ولی بعداً در سرور
   * رد شد» برای عملیات مالی تجربه‌ی امن یا قابل‌فهمی نیست.
   */
  const requestReturnCorrectionAction = (action: ReturnCorrectionAction, row: any) => {
    if (!correctionLockLoaded) {
      setMsg(null)
      setErr('وضعیت قفل اصلاح و ابطال هنوز در حال بررسی است. چند لحظه صبر کنید و دوباره تلاش کنید؛ تا آن زمان هیچ فرم تغییری باز نمی‌شود.')
      return
    }
    const request = { action, row }
    if (correctionOpen) {
      launchReturnCorrectionAction(request)
      return
    }
    setCorrectionUnlockError(null)
    setCorrectionUnlockPassword('')
    setCorrectionUnlockRequest(request)
  }

  /** همان گیت استاندارد برنامه: رمز مدیر، رمز دوم، یا رمز سومِ شیفت جاری. */
  const unlockReturnCorrectionAction = async () => {
    const request = correctionUnlockRequest
    const password = correctionUnlockPassword.trim()
    if (!request) return
    if (!password) {
      setCorrectionUnlockError('برای باز کردن قفل این عملیات، رمز مدیر یا رمز دوم/سوم همین بخش را وارد کنید.')
      return
    }
    setCorrectionUnlockBusy(true)
    setCorrectionUnlockError(null)
    try {
      await unlockPanel(PANEL_KEYS.salesReturnCorrection, password)
      setCorrectionUnlockRequest(null)
      setCorrectionUnlockPassword('')
      launchReturnCorrectionAction(request)
    } catch (e: any) {
      setCorrectionUnlockError(String(e?.message ?? 'رمز پذیرفته نشد.'))
      setCorrectionUnlockPassword('')
    } finally {
      setCorrectionUnlockBusy(false)
    }
  }

  const printIssuedOverpayCredit = async (credit: any | null, opts?: { reprintPassword?: string }) => {
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
        if (issuedOverpayCreditOpenRef.current) setOverpayCreditPrintProblem(problem)
        else setErr(problem.msg)
      }
    } finally {
      setOverpayCreditPrinting(false)
    }
  }

  /** پیدا کردن فاکتور با کد (تایپ‌شده یا اسکن‌شده). */
  const lookupCode = useCallback(async (raw: string) => {
    const value = raw.trim()
    if (!value) return
    setBusy(true)
    setErr(null)
    try {
      const res = await call<ReturnLookup>(CH.saleByReturnCode, { code: value })
      setLookup(res)
      // پیش‌فرض: هیچ قلمی تیک‌خورده نیست تا کاربر آگاهانه تعداد بگذارد
      setQty({})
      setAllowRemoved(false)
      setNote('')
      setCode(res.returnCode)
      scan.reset()
      if (res.warnings.length) setErr(res.warnings.join('\n'))
    } catch (e: any) {
      setLookup(null)
      setErr(e.message)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** افزودن یک کالای جایگزین (اگر بود، فقط تعدادش زیاد می‌شود). */
  const addRep = useCallback((v: any) => {
    if (!v) return
    setErr(null)
    setReps((prev) => {
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
          code: v.code ?? '',
          barcode: v.barcode ?? '',
          name: `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`,
          qty: 1,
          // بند ۱۸ — قیمت همیشه از خودِ کالا می‌آید، نه از ورودی دستی
          unitPrice: Math.max(0, Math.round(v.salePrice ?? 0)),
          realPrice: Math.max(0, Math.round(v.salePrice ?? 0)),
          discount: 0,
          stock: v.stock ?? 0,
          categoryId: v.product?.categoryId ?? null
        }
      ]
    })
    setRepFor(null)
  }, [])

  /** مسیر بارکدخوان فیزیکی برای کالای جایگزین: تطبیق کامل بارکد. */
  const addRepByBarcode = useCallback(
    async (barcode: string) => {
      try {
        const v = await call<any>(CH.variantByBarcode, { barcode })
        repSearchRef.current?.clear()
        if (!v) return setErr(`کالایی با بارکد ${faDigits(barcode)} پیدا نشد`)
        addRep(v)
      } catch (e: any) {
        setErr(e.message)
      }
    },
    [addRep]
  )

  /**
   * بارکدخوان سراسری این صفحه، *دو کاره* است:
   *   • در حالت عادی: اسکن بارکد رسید ⇒ پیدا کردن فاکتور.
   *   • در حالت تعویض و وقتی فاکتور پیدا شده: اسکن ⇒ افزودن کالای جایگزین.
   * پس فروشنده در همان جریان کار، بدون هیچ کلیکی، کالای جایگزین را اسکن می‌کند.
   */
  useBarcodeScanner(
    useCallback(
      (scanned: string) => {
        if (exchangeMode && lookup) return void addRepByBarcode(scanned)
        setCode(scanned)
        void lookupCode(scanned)
      },
      [exchangeMode, lookup, addRepByBarcode, lookupCode]
    ),
    { enabled: !confirmForce && !confirmExchange && editId == null && !deleteTarget && !repModalOpen }
  )

  const loadHistory = useCallback(async () => {
    if (!isValidJalaliDate(histFrom) || !isValidJalaliDate(histTo)) return
    try {
      setHistory(await call<any[]>(CH.saleReturnList, { fromJalali: histFrom, toJalali: histTo }))
    } catch {
      setHistory([])
    }
  }, [histFrom, histTo])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const items = lookup?.items ?? []
  /** نشست ۲ · C7 (بند ۴-۲۰) — فاکتور لغوشده/پیش‌نویس: دکمه‌های برگشت و تعویض قفل */
  const lookupLocked = !!lookup && !isReturnableStatus(lookup.status)
  const selected = useMemo(
    () => items.filter((i) => (qty[i.saleItemId] ?? 0) > 0),
    [items, qty]
  )
  const totals = useMemo(() => {
    const count = selected.length
    const q = selected.reduce((s, i) => s + (qty[i.saleItemId] ?? 0), 0)
    const amount = selected.reduce((s, i) => s + returnValueFor(i, qty[i.saleItemId] ?? 0), 0)
    return { count, qty: q, amount }
  }, [selected, qty])

  /**
   * مابه‌التفاوت زنده‌ی تعویض. عیناً همان فرمول سمت main
   * (`saleTotals` + `createExchange`): جمع اقلام جایگزین منهای تخفیف ردیف‌ها،
   * منهای ارزش کالای برگشتی. هیچ عدد جداگانه‌ای اینجا ساخته نمی‌شود.
   */
  /**
   * نشست ۱۵۸ (Y16) — عوارض/حق سرویس کالای جایگزین با همان تابع مشترک computeCharges و
   * تنظیمات کانال فاکتور اصلی (lookup.chargeScope)؛ سرور همین عدد را دوباره می‌سنجد و
   * اختلاف را رد می‌کند. خرده ⇒ عوارض روی ردیف؛ عمده ⇒ عوارض سطح فاکتور.
   */
  const posCharges = useCharges('pos')
  const wholesaleCharges = useCharges('wholesale')
  const exScope: 'pos' | 'wholesale' = lookup?.chargeScope === 'wholesale' ? 'wholesale' : 'pos'
  const exChargeHook = exScope === 'wholesale' ? wholesaleCharges : posCharges
  const exCharges = useMemo(
    () =>
      exChargeHook.compute(
        reps.map((l) => ({
          categoryId: l.categoryId ?? null,
          lineNet: Math.max(0, l.unitPrice * l.qty - Math.min(l.discount, l.unitPrice * l.qty)),
          qty: l.qty
        }))
      ),
    [exChargeHook, reps]
  )
  const exTotals = useMemo(() => {
    const goods = reps.reduce((s, l) => s + l.unitPrice * l.qty, 0)
    const discount = reps.reduce((s, l) => s + Math.min(l.discount, l.unitPrice * l.qty), 0)
    const tax = exCharges.taxTotal
    const service = exCharges.serviceTotal
    const exchangeTotal = Math.max(0, goods - discount + tax + service)
    return { goods, discount, tax, service, exchangeTotal, diff: exchangeTotal - totals.amount, qty: reps.reduce((s, l) => s + l.qty, 0) }
  }, [reps, totals.amount, exCharges])

  const repShort = useMemo(() => reps.filter((l) => l.qty > l.stock), [reps])
  const cashMethods = useMemo(() => methods.filter((method) => method.kind === 'CASH'), [methods])
  const cardMethods = useMemo(() => methods.filter((method) => method.kind === 'CARD'), [methods])
  /** مثل POS: اعشار/منفی/حرف هرگز با حذف‌شدن کاراکترها به مبلغ دیگری تبدیل نمی‌شوند. */
  const exSplitCashAmount = useMemo(() => parseGroupedInteger(exSplitCash), [exSplitCash])
  const exSplitCardAmount = useMemo(() => parseGroupedInteger(exSplitCard), [exSplitCard])
  const exSplitTotal = useMemo(() => {
    if (exSplitCashAmount == null || exSplitCardAmount == null) return null
    const total = exSplitCashAmount + exSplitCardAmount
    return Number.isSafeInteger(total) ? total : null
  }, [exSplitCashAmount, exSplitCardAmount])
  /** بند ۱۸ — قلم‌هایی که قیمتشان دستی از قیمت واقعی کالا جدا شده است. */
  const priceChanged = useMemo(() => reps.filter((l) => l.unitPrice !== l.realPrice), [reps])

  const removedSelected = selected.filter((i) => i.stockState === 'REMOVED')
  const isFull = useMemo(
    () => !!items.length && items.every((i) => (qty[i.saleItemId] ?? 0) >= i.remainingQty && i.remainingQty > 0),
    [items, qty]
  )

  const setQtyFor = (i: ReturnLookupItem, v: number) =>
    setQty((p) => ({ ...p, [i.saleItemId]: Math.max(0, Math.min(Math.round(v || 0), i.remainingQty)) }))

  const selectAll = () => {
    const next: QtyMap = {}
    for (const i of items) if (canReturn(i)) next[i.saleItemId] = i.remainingQty
    setQty(next)
  }
  const clearAll = () => setQty({})

  const patchRep = (variantId: number, patch: Partial<RepLine>) =>
    setReps((p) => p.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)))
  const removeRep = (variantId: number) => setReps((p) => p.filter((l) => l.variantId !== variantId))

  /** فوکوس روی کادر انتخاب کالای جایگزین (دکمه‌ی «+ جایگزین» هر قلم برگشتی). */
  const focusRep = (forName?: string | null) => {
    if (!exchangeMode) setExchangeMode(true)
    setRepFor(forName ?? null)
    window.setTimeout(() => repSearchRef.current?.focus(), 0)
  }

  const doSubmit = useCallback(
    async (force: boolean, req: OverpayRequest = {}) => {
      if (!lookup) return
      setConfirmForce(null)
      setOverpayReq(req)
      if (!selected.length) return setErr('تعداد برگشتی حداقل یک قلم را بزرگ‌تر از صفر بگذارید.')
      /**
       * بند ۱۱ — بدون انتخاب صریح روش بازپرداخت، ثبت انجام نمی‌شود. سمت سرور هم
       * همین قاعده هست؛ این بررسی فقط برای این است که کاربر پیام را *قبل* از
       * رفت‌وبرگشت ببیند، نه این‌که تصمیم جای دیگری گرفته شود.
       */
      if (!refundMethod)
        return setErr(
          'روش بازپرداخت این برگشت را انتخاب کنید:\n' +
            REFUND_CHOICES.map((c) => `• ${c.title} — ${c.hint}`).join('\n') +
            '\nبدون این انتخاب، سیستم نمی‌داند چقدر از صندوق خارج شده و کسری واقعی از کسری کاذب قابل تفکیک نیست.'
        )
      if (managerFullRefund && !fullRefundPw.trim())
        return setErr('برای بازپرداخت مبلغ کاملِ بدون کسر تخفیف، رمز مدیر را وارد کنید.')
      if (managerFullRefund && fullRefundReason.trim().length < 3)
        return setErr('برای بازپرداخت مبلغ کاملِ بدون کسر تخفیف، دلیل مدیر حداقل ۳ نویسه باشد.')
      if (removedSelected.length && !allowRemoved)
        return setErr(
          'این کالا از موجودی انبار حذف شده است:\n' +
            removedSelected.map((i) => `• ${i.name}`).join('\n') +
            '\nبرگشت خودکار انجام نمی‌شود. برای ثبت برگشت این قلم(ها)، گزینه‌ی «رسیدگی دستی» را تیک بزنید.'
        )
      setBusy(true)
      try {
        const res = await call<any>(CH.saleReturn, {
          invoiceId: lookup.invoiceId,
          full: isFull,
          lines: selected.map((i) => ({ saleItemId: i.saleItemId, qty: qty[i.saleItemId] ?? 0 })),
          note: note.trim() || undefined,
          allowRemoved: allowRemoved || undefined,
          force: force || undefined,
          // ---- بند ۱۱: روش و مبلغ بازپرداخت روی خودِ سند برگشت می‌نشیند ----
          refundMethod,
          refundAmount: refundAmount.trim() === '' ? undefined : Math.max(0, Math.round(Number(refundAmount.replace(/[^0-9]/g, '')) || 0)),
          managerFullRefund: managerFullRefund || undefined,
          refundReference: refundReference.trim() || undefined,
          refundNote: refundNote.trim() || undefined,
          cardPosOverride: refundMethod === 'CARD' ? cardPosOverride : undefined,
          // ---- بند ۱۷: فقط وقتی دوره بسته است و کاربر رمز/دلیل داده ----
          ...req,
          managerPassword: req.managerPassword || (managerFullRefund ? fullRefundPw : lockPw).trim() || undefined,
          overrideReason: (managerFullRefund ? fullRefundReason : lockReason).trim() || undefined
        })
        setOverpayFlow(null)
        setOverpayReq({})
        setRetResult(res)
        setLockNeeded(false)
        setLockPw('')
        setLockReason('')
        flash(
          `برگشت از فروش فاکتور شماره ${faDigits(res.receiptNo)} ثبت شد · ` +
            `${faDigits(totals.qty)} عدد · ${money(res.total)} ریال · ` +
            (res.restocked
              ? `${faDigits(res.restockedQty)} عدد به موجودی انبار برگشت`
              : 'این فاکتور بدون کسر از موجودی بود، پس موجودی تغییر نکرد') +
            (res.fullyReturned ? ' · وضعیت فاکتور: برگشت کامل' : ' · وضعیت فاکتور: برگشت جزئی') +
            (res.refundNote ? `\n${res.refundNote}` : '') +
            (res.storeCreditReference ? ` · ${res.storeCreditReference} صادر شد` : '') +
            (res.overpayCredit?.id
              ? ` · ${overpayCreditFlash(res.overpayCredit, money, faDigits)}`
              : res.overpayAmount > 0
                ? ` · مبلغ اضافه‌ی دریافتی: ${money(res.overpayAmount)} ریال (ردیف «دریافت پول اضافه»)`
                : '')
        )
        if (res.overpayCredit?.id) {
          issuedOverpayCreditOpenRef.current = true
          setIssuedOverpayCredit(res.overpayCredit)
          await printIssuedOverpayCredit(res.overpayCredit)
        }
        await lookupCode(lookup.returnCode)
        await loadHistory()
      } catch (e: any) {
        const message = String(e.message ?? '')
        // پیام «بیشتر از تعداد قابل برگشت» یک هشدار قابل‌تایید است، نه دیوار
        if (message.includes('تایید کنید تا انجام شود')) setConfirmForce(message)
        else if (isOverpayWarning(message))
          setOverpayFlow(overpayFlowStart(message, { entryKind: 'CASH', methodKind: 'CASH' }))
        else if (needsManagerPassword(message) && req.overpayAsCredit)
          setOverpayFlow(
            overpayFlowAskPassword({ step: 'submit', message: null, eligible: true, request: req }, message)
          )
        else {
          // بند ۱۷ — دوره بسته است: دو فیلد «رمز مدیر» و «دلیل» روی صفحه می‌آیند
          if (message.includes('دوره بسته شده است') || message.includes('دوره‌ی بسته')) setLockNeeded(true)
          setErr(message)
        }
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lookup, selected, qty, note, allowRemoved, isFull, totals.qty, removedSelected.length,
      refundMethod, refundAmount, refundReference, refundNote, managerFullRefund, fullRefundPw, fullRefundReason,
      lockPw, lockReason, loadHistory, lookupCode
    ]
  )

  /**
   * ------------------------- ثبت تعویض کالا (بخش ۶) -------------------------
   * یک فراخوانی، یک تراکنش سمت main: برگشت اقلام + سند تعویض + تسویه‌ی
   * مابه‌التفاوت + صدور بارکد اعتبار (اگر ما بدهکار شده باشیم).
   */
  const doExchange = useCallback(
    async (force: boolean) => {
      if (!lookup) return
      setConfirmExchange(null)
      if (!selected.length) return setErr('برای تعویض، تعداد حداقل یک «کالای برگشتی» را بزرگ‌تر از صفر بگذارید.')
      if (!reps.length) return setErr('برای تعویض، حداقل یک «کالای جایگزین» انتخاب کنید (اسکن بارکد، جست‌وجوی نام یا کد).')
      /**
       * بند ۱۲ — وقتی ما بدهکاریم، «نقد/کارت» یا «اعتبار خرید» یک انتخاب
       * *انحصاری و اجباری* است. صدور خودکار اعتبار — رفتار قبلی — دیگر پیش‌فرض
       * ضمنی نیست، چون مشتری‌ای که پول نقدش را می‌خواست، بی‌خبر یک بارکد
       * می‌گرفت و از نظر حسابداری یک بدهی تازه برای فروشگاه ساخته می‌شد.
       */
      if (exTotals.diff < 0 && !exRefundMode)
        return setErr(
          `مابه‌التفاوت این تعویض منفی است (ما ${money(-exTotals.diff)} ریال بدهکاریم).\n` +
            'یکی از این چهار مورد را صریح انتخاب کنید:\n' +
            EXCHANGE_REFUND_CHOICES.map((c) => `• ${c.title} — ${c.hint}`).join('\n')
        )
      if (exTotals.diff > 0 && exSplitPayment) {
        if (!exSplitCashMethodId || !exSplitCardMethodId)
          return setErr('برای پرداخت ترکیبی، یک روش فعال نقدی و یک روش فعال کارتی انتخاب کنید.')
        if (exSplitCashAmount == null || exSplitCardAmount == null || exSplitTotal == null)
          return setErr('مبلغ نقد یا کارت معتبر نیست؛ فقط عدد صحیح ریالیِ بدون اعشار، منفی یا حرف وارد کنید.')
        if (exSplitCashAmount <= 0 || exSplitCardAmount <= 0 || exSplitTotal !== exTotals.diff)
          return setErr(`جمع سهم نقد و کارت باید دقیقاً ${money(exTotals.diff)} ریال باشد و هر دو سهم مثبت باشند.`)
      }
      if (priceOverrideOn && !managerPw.trim())
        return setErr(
          'قیمت دستیِ کالای جایگزین باز است و رمز مدیر وارد نشده.\n' +
            'یا رمز مدیر را بنویسید، یا قفل قیمت دستی را ببندید تا قیمت‌ها به قیمت واقعی کالا برگردند.'
        )
      if (removedSelected.length && !allowRemoved)
        return setErr(
          'این کالا از موجودی انبار حذف شده است:\n' +
            removedSelected.map((i) => `• ${i.name}`).join('\n') +
            '\nبرای ثبت تعویض این قلم(ها)، گزینه‌ی «رسیدگی دستی» را تیک بزنید.'
        )
      setBusy(true)
      try {
        const res = await call<
          ExchangeSaleResult & {
            cashReceived?: number
            exchangeCreditApplied?: number
            cardTransfer?: { id: number; amount: number; status: string } | null
          }
        >(
          CH.saleExchangeCreate,
          {
            invoiceId: lookup.invoiceId,
            lines: selected.map((i) => ({ saleItemId: i.saleItemId, qty: qty[i.saleItemId] ?? 0 })),
            replacements: reps.map((l, i) => ({
              variantId: l.variantId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              discount: Math.max(0, Math.round(l.discount)),
              // نشست ۱۵۸ (Y16) — خرده: عوارض روی ردیف؛ عمده: ردیف صفر
              tax: exCharges.taxPerLine[i] != null && exScope === 'pos' ? exCharges.taxPerLine[i] : 0
            })),
            invoiceTax: exScope === 'wholesale' ? exCharges.taxTotal : 0,
            serviceCharge: exCharges.serviceTotal,
            note: note.trim() || undefined,
            allowRemoved: allowRemoved || undefined,
            force: force || undefined,
            // پرداخت تک‌روشِ قبلی دقیقاً همان payload قبلی است؛ split فقط مسیر افزوده است.
            methodId: exTotals.diff > 0 && !exSplitPayment ? methodId : null,
            splitPayment: exTotals.diff > 0 && exSplitPayment ? true : undefined,
            payments:
              exTotals.diff > 0 && exSplitPayment
                ? [
                    { methodId: exSplitCashMethodId!, amount: exSplitCashAmount!, destination: 'CASH' },
                    { methodId: exSplitCardMethodId!, amount: exSplitCardAmount!, destination: 'CARD' }
                  ]
                : undefined,
            autoCentralWithdraw: repAutoCentral || undefined,
            // ---- بند ۱۲: تسویه‌ی مابه‌التفاوت منفی (انتخاب انحصاری کاربر) ----
            refundMode: exTotals.diff < 0 ? exRefundMode : undefined,
            cardPosOverride: exRefundMode === 'CARD' ? cardPosOverride : undefined,
            // ---- بند ۱۸: رمز مدیر، فقط وقتی قیمت دستی باز شده باشد ----
            managerPassword: (priceOverrideOn ? managerPw.trim() : lockPw.trim()) || undefined,
            overrideReason: lockReason.trim() || undefined
          }
        )
        setExResult(res)
        setReps([])
        setQty({})
        setRepFor(null)
        setExRefundMode(null)
        setExSplitPayment(false)
        setExSplitCash('')
        setExSplitCard('')
        setPriceOverrideOn(false)
        setManagerPw('')
        setLockNeeded(false)
        setLockPw('')
        setLockReason('')
        flash(
          `تعویض کالا ثبت شد · سند تعویض شماره ${faDigits(res.exchangeReceiptNo)} · ` +
            `کالای برگشتی ${money(res.returnTotal)} ریال · کالای جایگزین ${money(res.exchangeTotal)} ریال · ` +
            (res.diff > 0
              ? `${money(res.diff)} ریال از مشتری دریافت شد`
              : res.diff < 0
                ? `${money(-res.diff)} ریال ${res.storeCredit?.publicReference ?? 'اعتبار خرید'} صادر شد و برای مشتری چاپ شد`
                : 'مابه‌التفاوت صفر بود') +
            /**
             * جلسه ۵۰ · مرحله ۱-ب — «کالای جایگزین از کدام انبار آمد».
             * متن را سرور می‌سازد (همان جمله‌ای که در سابقه‌ی سند و ستون گزارش
             * هم نشسته)، پس پنل عددی حساب نمی‌کند و سه جا یک جمله می‌گویند.
             * خالی بودنش = کاملاً از انبار فروشگاه کم شد (مثل قبل).
             */
            (res.centralWithdrawText ? '\n' + res.centralWithdrawText : '') +
            (res.stockWarnings?.length ? '\n' + res.stockWarnings.join('\n') : '')
        )
        await lookupCode(lookup.returnCode)
        await loadHistory()
      } catch (e: any) {
        const message = String(e.message ?? '')
        if (message.includes('تایید کنید تا انجام شود')) setConfirmExchange(message)
        else {
          if (message.includes('دوره بسته شده است') || message.includes('دوره‌ی بسته')) setLockNeeded(true)
          setErr(message)
        }
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lookup, selected, qty, reps, note, allowRemoved, exTotals.diff, methodId, exSplitPayment, exSplitCashAmount,
      exSplitCardAmount, exSplitTotal, exSplitCashMethodId, exSplitCardMethodId, repAutoCentral, exCharges, exScope,
      removedSelected.length, exRefundMode, priceOverrideOn, managerPw, lockPw, lockReason, loadHistory, lookupCode
    ]
  )

  /**
   * ---------------------- بند ۱۳ — رسید چاپیِ «برگشت از فروش» ----------------------
   * خواهرِ `print:exchange`. محتوایش سمت main در `returnReceiptHtml` ساخته می‌شود
   * (شماره‌ی سند، فاکتور اصلی، تاریخ/ساعت دقیق، مشتری، اقلام، مبلغ، **روش
   * بازپرداخت**، وضعیت موجودی و کد/بارکد اعتبار اگر صادر شده باشد) و از همان
   * قالب تنظیمات رسید تبعیت می‌کند.
   */
  const printReturn = useCallback(async (returnId: number) => {
    if (printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    try {
      /** فاز ۳ — مسیر مشترک چاپ؛ انصراف = لغو قطعی و بی‌صدا. */
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printReturn, { returnId, deviceName, silent: opts?.silent })
      )
      if (res === 'CANCELLED') return
      flash('رسید برگشت از فروش برای چاپ فرستاده شد')
    } catch (e: any) {
      setErr(
        isUnknownPrintMessage(e)
          ? `معلوم نیست رسید برگشت چاپ شده باشد: ${e.message} قبل از چاپ دوباره خروجی چاپگر را ببینید.`
          : `چاپ رسید برگشت انجام نشد: ${e.message}`
      )
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** چاپ «سند تعویض» (قالب exchangeReceiptHtml سمت main). */
  const printExchange = useCallback(async (returnId: number) => {
    if (printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    try {
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printExchange, { returnId, deviceName, silent: opts?.silent })
      )
      if (res === 'CANCELLED') return
      flash('سند تعویض برای چاپ فرستاده شد')
    } catch (e: any) {
      setErr(
        isUnknownPrintMessage(e)
          ? `معلوم نیست سند تعویض چاپ شده باشد: ${e.message} قبل از چاپ دوباره خروجی چاپگر را ببینید.`
          : `چاپ سند تعویض انجام نشد: ${e.message}`
      )
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const printSourceInvoice = useCallback(async (invoiceId: number) => {
    if (printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    try {
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printInvoice, { invoiceId, deviceName, silent: opts?.silent })
      )
      if (res !== 'CANCELLED') flash('رسید فاکتور برای چاپ فرستاده شد')
    } catch (e: any) {
      setErr(
        isUnknownPrintMessage(e)
          ? `معلوم نیست رسید فاکتور چاپ شده باشد: ${e.message} قبل از چاپ دوباره خروجی چاپگر را ببینید.`
          : e.message
      )
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * نشست ۶۴ · بند ۴-۲۲ — ابطال یک برگشت ثبت‌شده (نه حذف فیزیکی). سند با مهر
   * «باطل» و دلیل می‌ماند؛ اثر انبار/اعتبار/کارت‌به‌کارتِ در انتظار سمت main در
   * یک تراکنش برمی‌گردد. اگر پول واقعاً رفته یا اعتبار خرج شده باشد، main رد
   * می‌کند و برای مدیر «رسیدگی» ثبت می‌شود.
   */
  const doDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    const reason = voidReason.trim()
    if (reason.length < 3) {
      setVoidReasonErr('دلیل ابطال را بنویسید (حداقل ۳ حرف)؛ بدون دلیل، سند باطل نمی‌شود.')
      return
    }
    setRowBusy(true)
    try {
      const res = await call<any>(CH.saleReturnDelete, {
        id: target.id,
        reason,
        panelPassword: voidAuthPassword || undefined,
        /** دوره‌ی بسته فقط همین رمز را به‌عنوان رمز مدیر می‌پذیرد؛ رمز دوم کافی نیست. */
        managerPassword: voidAuthPassword || undefined,
        overrideReason: reason,
        approverUserId: voidApproverUserId ?? undefined,
        approverPassword: voidApproverPassword || undefined
      })
      setDeleteTarget(null)
      setVoidReason('')
      setVoidAuthPassword('')
      setVoidApproverUserId(null)
      setVoidApproverPassword('')
      setVoidReasonErr(null)
      flash(
        `برگشت از فروش فاکتور شماره ${faDigits(res.receiptNo ?? target.receiptNo ?? 0)} باطل شد · ` +
          `${money(res.total ?? target.total ?? 0)} ریال · ` +
          (res.reversedQty
            ? `${faDigits(res.reversedQty)} عدد از موجودی انبار برگشت خورد (موجودی به حالت قبل از این برگشت رسید)`
            : 'این برگشت موجودی انبار را تغییر نداده بود، پس انبار دست‌نخورده ماند') +
          (res.canceledCreditRefs?.length ? ` · ${res.canceledCreditRefs.join('، ')} هم باطل شد` : '')
      )
      await loadHistory()
      if (lookup) await lookupCode(lookup.returnCode)
    } catch (e: any) {
      /** هدف باز می‌ماند تا فروشنده بتواند، مثلاً، رمز لازم را وارد و دوباره ثبت کند. */
      setVoidReasonErr(String(e?.message ?? 'ابطال انجام نشد.'))
    } finally {
      setRowBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deleteTarget,
    voidReason,
    voidAuthPassword,
    voidApproverUserId,
    voidApproverPassword,
    loadHistory,
    lookup,
    lookupCode
  ])

  const doCorrection = useCallback(async () => {
    const target = correctionTarget
    if (!target) return
    const reason = correctionReason.trim()
    if (reason.length < 3) {
      setCorrectionErr('دلیل اصلاح جبرانی را بنویسید (حداقل ۳ حرف).')
      return
    }
    const cashRecovered = Number(digitsOnly(correctionCash) || '0')
    const cardRecovered = Number(digitsOnly(correctionCard) || '0')
    if (!Number.isSafeInteger(cashRecovered) || !Number.isSafeInteger(cardRecovered)) {
      setCorrectionErr('مبلغ بازیافتی معتبر نیست.')
      return
    }
    setCorrectionBusy(true)
    try {
      const res = await call<any>(CH.saleReturnCorrection, {
        id: target.id,
        reason,
        panelPassword: correctionAuthPassword || undefined,
        approverUserId: correctionApproverUserId ?? undefined,
        approverPassword: correctionApproverPassword || undefined,
        cashRecovered,
        cardRecovered,
        cardReference: correctionCardReference.trim() || undefined,
        creditOutcome: correctionCreditOutcome,
        note: correctionNote.trim() || undefined
      })
      setCorrectionTarget(null)
      setCorrectionErr(null)
      flash(
        `اصلاح جبرانی شماره ${faDigits(res.id)} ثبت شد` +
          (res.cashRecovered ? ` · نقدِ بازیافتی: ${money(res.cashRecovered)} ریال` : '') +
          (res.cardRecovered ? ` · کارت/بانکِ بازیافتی: ${money(res.cardRecovered)} ریال` : '') +
          (res.unrecoveredAmount ? ` · مغایرت بازیافت‌نشده: ${money(res.unrecoveredAmount)} ریال` : '')
      )
      await loadHistory()
      if (lookup) await lookupCode(lookup.returnCode)
    } catch (e: any) {
      setCorrectionErr(String(e?.message ?? 'اصلاح جبرانی انجام نشد.'))
    } finally {
      setCorrectionBusy(false)
    }
  }, [
    correctionTarget,
    correctionReason,
    correctionCash,
    correctionCard,
    correctionAuthPassword,
    correctionApproverUserId,
    correctionApproverPassword,
    correctionCardReference,
    correctionCreditOutcome,
    correctionNote,
    loadHistory,
    lookup,
    lookupCode
  ])

  const reset = () => {
    setLookup(null)
    setQty({})
    setCode('')
    setErr(null)
    setNote('')
    setAllowRemoved(false)
    setReps([])
    setRepFor(null)
    setExResult(null)
    setRetResult(null)
    setRefundMethod(null)
    setRefundAmount('')
    setRefundReference('')
    setRefundNote('')
    setExRefundMode(null)
    setPriceOverrideOn(false)
    setManagerPw('')
    setLockNeeded(false)
    setLockPw('')
    setLockReason('')
    scan.reset()
    inputRef.current?.focus()
  }

  const diffLabel =
    exTotals.diff > 0
      ? `مشتری باید ${money(exTotals.diff)} ریال بپردازد`
      : exTotals.diff < 0
        ? `ما ${money(-exTotals.diff)} ریال بدهکاریم ⇒ ${
            exRefundMode === 'CASH'
              ? 'بازپرداخت نقدی (پول از کشو بیرون می‌رود)'
              : exRefundMode === 'CARD'
                ? 'بازپرداخت کارتی'
                : exRefundMode === 'STORE_CREDIT'
                  ? '«بارکد اعتبار خرید بعدی» صادر می‌شود'
                  : 'روش تسویه را انتخاب کنید (نقدی / کارتی / اعتبار خرید)'
          }`
        : 'مابه‌التفاوت صفر است؛ تسویه‌ای لازم نیست'

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">برگشت از فروش و تعویض کالا</h1>
        <span className="kbd">
          کد فاکتور را تایپ کنید یا بارکد روی رسید را اسکن کنید · اعتبار هر کد یک هفته از تاریخ صدور است
        </span>
        <div className="ms-auto flex gap-1">
          <button className="btn" onClick={() => nav('/sales-reports')}>
            گزارشات فروش <span className="keycap">F9</span>
          </button>
          <button className="btn" onClick={() => nav('/pos')}>
            پنل فروش <span className="keycap">F2</span>
          </button>
        </div>
      </div>

      {/* ---------------- ورود کد فاکتور ---------------- */}
      <div className="bg-white rounded shadow p-3 flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[260px]">
          <div className="mb-1 font-bold">کد فاکتور (روی رسید، هم متن و هم بارکد)</div>
          <input
            ref={inputRef}
            dir="ltr"
            className="inp text-center text-lg tracking-widest"
            placeholder="مثلاً K7M4QP"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              scan.onKeyDown(e)
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookupCode(code)
              }
            }}
          />
        </label>
        <button className="btn btn-primary" onClick={() => void lookupCode(code)} disabled={busy || !code.trim()}>
          {busy ? 'در حال جستجو…' : 'پیدا کردن فاکتور'}
        </button>
        <button className="btn" onClick={reset} disabled={busy}>
          پاک کردن
        </button>
        <div className="kbd">
          بارکدخوان فعال است؛ لازم نیست فیلد را انتخاب کنید — کافی است بارکد رسید را اسکن کنید. شماره فیش هم پذیرفته
          می‌شود.
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

      {/* ---------------- بند ۱۷: دوره‌ی بسته‌شده — رمز مدیر و دلیل اجباری ---------------- */}
      {lockNeeded && (
        <div className="bg-rose-50 border-2 border-rose-400 rounded p-3 space-y-2">
          <b className="text-rose-800">این تاریخ در یک «دوره‌ی بسته» است</b>
          <div className="kbd leading-6">
            صندوق این روز بسته شده یا روز «تجمیع و انتقال» شده است. ثبت اصلاحی ممنوع نیست، ولی آزاد هم نیست: رمز مدیر و
            دلیل اجباری است و هر دو با جزئیات کامل در سابقه‌ی تغییرات ثبت می‌شوند. اگر نمی‌خواهید اعداد آن دوره دست
            بخورند، سند را با تاریخ امروز ثبت کنید.
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <label>
              <div className="kbd">رمز مدیر</div>
              <input type="password" className="inp w-40" dir="ltr" value={lockPw} onChange={(e) => setLockPw(e.target.value)} />
            </label>
            <label className="flex-1 min-w-[240px]">
              <div className="kbd">دلیل ثبت در دوره‌ی بسته (اجباری)</div>
              <input className="inp" value={lockReason} onChange={(e) => setLockReason(e.target.value)} />
            </label>
            <button className="btn" onClick={() => setLockNeeded(false)}>
              انصراف
            </button>
          </div>
        </div>
      )}

      {/* ---------------- بند ۱۳: برگشت تازه ثبت‌شده + رسید چاپی ---------------- */}
      {retResult && (
        <div className="bg-emerald-50 border-2 border-emerald-400 rounded p-2 flex flex-wrap items-center gap-3">
          <b>برگشت از فروش فاکتور {faDigits(retResult.receiptNo)} ثبت شد</b>
          <span className="kbd">مبلغ برگشت {money(retResult.total)} ریال</span>
          <span className="px-2 py-1 rounded bg-white border font-bold">
            {REFUND_CHOICES.find((c) => c.value === retResult.refundMethod)?.title ?? 'بدون بازپرداخت'}
            {retResult.refundAmount ? ` · ${money(retResult.refundAmount)} ریال` : ' · بدون خروج پول'}
          </span>
          <span className="kbd">
            {retResult.restocked
              ? `${faDigits(retResult.restockedQty)} عدد به موجودی انبار برگشت`
              : 'این فاکتور بدون کسر از موجودی بود، پس موجودی تغییر نکرد'}
          </span>
          {retResult.storeCredit && (
            <span className="px-2 py-1 rounded bg-white border font-bold" title="مرجع امن اعتبار خرید صادرشده">
              {retResult.storeCredit.publicReference}
            </span>
          )}
          {/* جلسه ۱۷ · بند ۱ — هیچ پولی جابه‌جا نشده؛ فقط یک درخواست ساخته شده است */}
          {retResult.cardTransfer && (
            <span className="px-2 py-1 rounded bg-amber-100 border-2 border-amber-400 font-bold">
              درخواست کارت‌به‌کارت شماره {faDigits(retResult.cardTransfer.id)} ثبت شد ·{' '}
              {money(retResult.cardTransfer.amount)} ریال · در انتظار پرداخت مدیر
            </span>
          )}
          <button className="btn btn-primary" onClick={() => void printReturn(retResult.id)} disabled={printing}>
            {printing ? 'در حال چاپ…' : 'چاپ رسید برگشت'}
          </button>
          <button className="btn ms-auto" onClick={() => setRetResult(null)}>
            بستن
          </button>
        </div>
      )}

      {/* ---------------- سند تعویض تازه ثبت‌شده ---------------- */}
      {exResult && (
        <div className="bg-sky-50 border-2 border-sky-400 rounded p-2 flex flex-wrap items-center gap-3">
          <b>سند تعویض شماره {faDigits(exResult.exchangeReceiptNo)} ثبت شد</b>
          <span className="kbd">کالای برگشتی {money(exResult.returnTotal)} ریال</span>
          <span className="kbd">کالای جایگزین {money(exResult.exchangeTotal)} ریال</span>
          <span className="font-bold">
            {exResult.diff > 0
              ? `دریافتی از مشتری ${money(exResult.diff)} ریال`
              : exResult.diff < 0
                ? `بدهی ما ${money(-exResult.diff)} ریال`
                : 'مابه‌التفاوت صفر'}
          </span>
          <span className="kbd">{exResult.settlementLabel}</span>
          {/**
           * جلسه ۵۰ · مرحله ۱-ب — «کالای جایگزین از کدام انبار برداشته شد».
           * فقط وقتی دیده می‌شود که واقعاً برداشتی از انبار مرکزی انجام شده
           * باشد؛ نبودنش = کاملاً از انبار فروشگاه (رفتار همیشگی). همین جمله
           * در سابقه‌ی سند و ستون «مبدأ برداشت» گزارش تعویض هم نشسته است، پس
           * اگر بعداً مغایرتی دیده شد از هر سه جا قابل ردیابی است.
           */}
          {!!exResult.centralWithdrawSources?.length && (
            <span
              className="px-2 py-1 rounded bg-white border-2 border-sky-400 font-bold"
              title="کمبود موجودی کالای جایگزین از این انبار(ها) برداشته و به انبار فروشگاه منتقل شد · در سابقه‌ی سند و گزارش تعویض هم ثبت شد"
            >
              برداشت از انبار:{' '}
              {exResult.centralWithdrawSources.map((w) => `${w.name} ${faDigits(w.qty)}`).join(' · ')}
            </span>
          )}
          {/* جلسه ۱۷ · بند ۱ */}
          {exResult.cardTransfer && (
            <span className="px-2 py-1 rounded bg-amber-100 border-2 border-amber-400 font-bold">
              درخواست کارت‌به‌کارت شماره {faDigits(exResult.cardTransfer.id)} ثبت شد ·{' '}
              {money(exResult.cardTransfer.amount)} ریال · در انتظار پرداخت مدیر
            </span>
          )}
          {exResult.storeCredit && (
            <span className="px-2 py-1 rounded bg-white border font-bold" title="مرجع امن اعتبار خرید صادرشده">
              {exResult.storeCredit.publicReference}
            </span>
          )}
          {exResult.storeCredit && (
            <span className="kbd">
              {money(exResult.storeCredit.amount)} ریال
              {exResult.storeCredit.expiresAtJalali
                ? ` · اعتبار تا ${faDigits(exResult.storeCredit.expiresAtJalali)}`
                : ''}
            </span>
          )}
          <button className="btn btn-primary" onClick={() => void printExchange(exResult.returnId)} disabled={printing}>
            {printing ? 'در حال چاپ…' : 'چاپ سند تعویض'}
          </button>
          <button className="btn ms-auto" onClick={() => setExResult(null)}>
            بستن
          </button>
        </div>
      )}

      {lookup && (
        <>
          {/* ---------------- اطلاعات فاکتور ---------------- */}
          <div className="bg-white rounded shadow p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b">
              <span className="font-bold text-sm">مشخصات فاکتور #{faDigits(lookup.receiptNo)}</span>
              <InvoiceFinanceBadge profile={lookup.settlementProfile} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
              <Info label="شماره فیش" value={faDigits(lookup.receiptNo)} strong />
              <Info label="کد فاکتور" value={lookup.returnCode} ltr strong />
              <Info label="تاریخ / ساعت" value={`${faDigits(lookup.issuedAtJalali)} · ${faDigits(lookup.issuedTime)}`} />
              <Info label="خریدار" value={lookup.customerName} />
              <Info label="شیفت" value={lookup.shiftName ?? '—'} />
              <Info label="وضعیت" value={lookup.statusLabel} />
              <Info
                label="اعتبار کد"
                value={
                  lookup.expired
                    ? 'منقضی شده'
                    : `${faDigits(lookup.daysLeft)} روز مانده (تا ${faDigits(lookup.expiresAtJalali)})`
                }
              />
              <Info label="جمع مبلغ کالا" value={money(lookup.goodsTotal)} />
              <Info label="تخفیف" value={money(lookup.discountTotal)} />
              <Info label="حق سرویس" value={money(lookup.serviceCharge)} />
              <Info label="عوارض و مالیات" value={money(lookup.taxTotal)} />
              <Info label="جمع کل" value={money(lookup.grandTotal)} strong />
              <Info label="نحوه پرداخت" value={lookup.paymentLabels || '—'} />
              <Info
                label="برگشت‌های قبلی"
                value={lookup.returnedTotal ? money(lookup.returnedTotal) + ' ریال' : 'ندارد'}
              />
            </div>
          </div>

          {!lookup.deductInventory && (
            <div className="bg-amber-50 border-2 border-amber-400 rounded px-3 py-2">
              این فاکتور «بدون کسر از موجودی انبار» ثبت شده بود، پس برگشتش هم موجودی انبار را زیاد نمی‌کند (فقط سند
              مالی برگشت ثبت می‌شود). این تقارن عمدی است تا انبار الکی پر نشود. سند تعویض همین فاکتور هم — به همان
              تقارن — موجودی را کم نمی‌کند.
            </div>
          )}

          {/* ---------------- سوییچ حالت: برگشت ساده / تعویض کالا ---------------- */}
          <div className="bg-white rounded shadow p-2 flex flex-wrap items-center gap-3">
            <label
              className={`flex items-center gap-2 px-2 py-1 rounded border-2 cursor-pointer font-bold ${
                exchangeMode ? 'bg-emerald-50 border-emerald-400' : 'border-slate-300'
              }`}
              title="با روشن کردن این گزینه، جای «پس دادن پول»، کالای جایگزین انتخاب می‌شود و مابه‌التفاوت حساب می‌گردد"
            >
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={exchangeMode}
                onChange={(e) => {
                  setExchangeMode(e.target.checked)
                  if (!e.target.checked) {
                    setReps([])
                    setRepFor(null)
                  }
                }}
              />
              تعویض کالا (جای برگشت ساده)
            </label>
            <span className="kbd leading-6">
              {exchangeMode
                ? 'تعداد برگشتی هر قلم را بگذارید، بعد کالای جایگزین را اسکن/جست‌وجو کنید. مابه‌التفاوت زنده پایین صفحه دیده می‌شود و با «ثبت تعویض کالا» همه‌چیز در یک تراکنش ثبت می‌گردد.'
                : 'خاموش = همان برگشت از فروش همیشگی (کالا برمی‌گردد، سند برگشت ثبت می‌شود).'}
            </span>
          </div>

          {/* ---------------- اقلام ---------------- */}
          <div className="bg-white rounded shadow flex-1 overflow-auto min-h-[240px] max-h-[46vh]">
            <table className="tbl">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>#</th>
                  <th>کد</th>
                  <th>بارکد</th>
                  <th>نام کالا</th>
                  <th>تعداد فروش</th>
                  <th>برگشت‌خورده</th>
                  <th>قابل برگشت</th>
                  <th>قیمت واحد</th>
                  <th>تعداد برگشتی</th>
                  <th>مبلغ برگشت</th>
                  <th>وضعیت کالا در انبار</th>
                  {exchangeMode && <th>کالای جایگزین</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => {
                  const q = qty[i.saleItemId] ?? 0
                  const blocked = i.stockState === 'MISSING'
                  const removed = i.stockState === 'REMOVED'
                  return (
                    <tr key={i.saleItemId} className={blocked ? 'bg-rose-50' : removed ? 'bg-amber-50' : ''}>
                      <td>{faDigits(idx + 1)}</td>
                      <td>{faDigits(i.code)}</td>
                      <td>{faDigits(i.barcode)}</td>
                      <td>{i.name}</td>
                      <td className="text-center">
                        {faDigits(i.qty)} {i.unit}
                      </td>
                      <td className="text-center">{faDigits(i.returnedQty)}</td>
                      <td className="text-center font-bold">{faDigits(i.remainingQty)}</td>
                      <td>{money(i.unitPrice)}</td>
                      <td className="w-28">
                        <input
                          type="number"
                          min={0}
                          max={i.remainingQty}
                          className="inp py-0.5"
                          disabled={blocked || i.remainingQty <= 0}
                          value={q}
                          onChange={(e) => setQtyFor(i, +e.target.value)}
                        />
                      </td>
                      <td className="font-bold">{money(returnValueFor(i, q))}</td>
                      <td className={blocked ? 'text-rose-700 font-bold' : removed ? 'text-amber-700 font-bold' : ''}>
                        {blocked || removed ? (
                          <>
                            این کالا از موجودی انبار حذف شده است
                            <div className="kbd">
                              {blocked
                                ? 'رکوردی از این کالا در سیستم نمانده؛ برگشت خودکارش ممکن نیست و باید دستی رسیدگی شود.'
                                : 'برای برگشت این قلم، تیک «رسیدگی دستی» را بزنید.'}
                            </div>
                          </>
                        ) : (
                          <>
                            موجود · {faDigits(i.stock)} {i.unit}
                          </>
                        )}
                      </td>
                      {exchangeMode && (
                        <td className="whitespace-nowrap">
                          <button
                            className="text-brand font-bold"
                            onClick={() => focusRep(i.name)}
                            title="کادر انتخاب کالای جایگزین (پایین جدول) فوکوس می‌شود: بارکد را اسکن کنید، نام یا کد کالا را بنویسید، یا از «همه کالاها» انتخاب کنید"
                          >
                            + جایگزین
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={8}>جمع انتخاب‌شده برای برگشت</td>
                  <td className="text-center">{faDigits(totals.qty)}</td>
                  <td>{money(totals.amount)}</td>
                  <td colSpan={exchangeMode ? 2 : 1}>
                    {isFull ? 'برگشت کامل فاکتور' : totals.count ? 'برگشت جزئی' : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ---------------- کالای جایگزین (بخش ۶) ---------------- */}
          {exchangeMode && (
            <div className="bg-white rounded shadow p-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">کالای جایگزین</span>
                <div className="flex-1 min-w-[280px] flex items-center gap-2">
                  <VariantSearchBox
                    ref={repSearchRef}
                    onPick={addRep}
                    placeholder="بارکد کالای جایگزین را اسکن کنید یا نام / کد کالا را بنویسید"
                    onAllOpenChange={setRepModalOpen}
                    allTitle="انتخاب کالای جایگزین از فهرست انبار"
                  />
                </div>
                {repFor && <span className="kbd">جایگزین «{repFor}» در حال انتخاب است</span>}
                <span className="kbd">
                  همان سه روش پنل فروش: اسکن بارکد · جست‌وجوی نام · تایپ کد — به‌علاوه‌ی دکمه‌ی «همه کالاها»
                </span>
              </div>

              {/*
                ---------------------- بند ۱۸: قیمت دستی، فقط با گیت مدیر ----------------------
                قیمت کالای جایگزین همیشه از `variant.salePrice` می‌آید. راه سوءاستفاده‌ای که
                بسته می‌شود: کالای برگشتیِ ۳ میلیونی با کالایی که قیمت واقعی‌اش ۱ میلیون است
                ولی روی صفر گذاشته شده تعویض شود و ۳ میلیون اعتبار خرید صادر گردد. سمت main
                هم همین قاعده هست و `AuditLog` قیمت واقعی، قیمت واردشده و کاربر را ثبت می‌کند.
              */}
              <div
                className={`rounded p-2 border-2 flex flex-wrap items-end gap-2 ${
                  priceOverrideOn ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-slate-300'
                }`}
              >
                <label className="flex items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={priceOverrideOn}
                    onChange={(e) => {
                      const on = e.target.checked
                      setPriceOverrideOn(on)
                      if (!on) {
                        setManagerPw('')
                        // قفل که بسته شد، قیمت‌ها بی‌چون‌وچرا به قیمت واقعی کالا برمی‌گردند
                        setReps((prev) => prev.map((l) => ({ ...l, unitPrice: l.realPrice })))
                      }
                    }}
                  />
                  تغییر دستی قیمت کالای جایگزین (رمز مدیر لازم است)
                </label>
                {priceOverrideOn ? (
                  <>
                    <label>
                      <div className="kbd">رمز مدیر</div>
                      <input
                        type="password"
                        className="inp w-40"
                        dir="ltr"
                        value={managerPw}
                        onChange={(e) => setManagerPw(e.target.value)}
                      />
                    </label>
                    <span className="kbd text-amber-800 leading-6">
                      قیمت واقعی و قیمت واردشده‌ی هر قلم، همراه نام کاربر، در سابقه‌ی تغییرات ثبت می‌شود.
                      {!!priceChanged.length && (
                        <b className="block">
                          {faDigits(priceChanged.length)} قلم با قیمت دستی:{' '}
                          {priceChanged
                            .map((l) => `«${l.name}» واقعی ${money(l.realPrice)} ← واردشده ${money(l.unitPrice)}`)
                            .join(' · ')}
                        </b>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="kbd leading-6">
                    قیمت هر کالای جایگزین همان قیمت فروش ثبت‌شده‌ی خودش است و قابل تایپ نیست. این قفل، ساختنِ «اعتبار خرید
                    بزرگ‌تر از واقعیت» با قیمت صفر را غیرممکن می‌کند.
                  </span>
                )}
              </div>

              <div className="overflow-auto max-h-[28vh] border border-slate-200 rounded">
                <table className="tbl">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>کد</th>
                      <th>بارکد</th>
                      <th>نام کالا</th>
                      <th className="w-24">تعداد</th>
                      <th className="w-32">قیمت واحد</th>
                      <th className="w-28">تخفیف ردیف</th>
                      <th>جمع</th>
                      <th>موجودی</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reps.map((l) => (
                      <tr key={l.variantId} className={l.qty > l.stock ? 'bg-amber-50' : ''}>
                        <td>{faDigits(l.code)}</td>
                        <td>{faDigits(l.barcode)}</td>
                        <td>{l.name}</td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            className="inp py-0.5"
                            value={l.qty}
                            onChange={(e) => patchRep(l.variantId, { qty: Math.max(1, Math.round(+e.target.value || 1)) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="inp py-0.5"
                            value={l.unitPrice}
                            disabled={!priceOverrideOn}
                            onChange={(e) =>
                              patchRep(l.variantId, { unitPrice: Math.max(0, Math.round(+e.target.value || 0)) })
                            }
                            title={
                              priceOverrideOn
                                ? `قیمت واقعی این کالا ${money(l.realPrice)} ریال است؛ تغییرش با رمز مدیر ثبت و در سابقه ضبط می‌شود`
                                : 'قیمت از خودِ کالا خوانده می‌شود (بند ۱۸). برای تغییر دستی، قفل بالای همین بخش را با رمز مدیر باز کنید.'
                            }
                          />
                          {l.unitPrice !== l.realPrice && (
                            <div className="kbd text-amber-800 font-bold">قیمت واقعی {money(l.realPrice)}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="inp py-0.5"
                            value={l.discount}
                            onChange={(e) =>
                              patchRep(l.variantId, { discount: Math.max(0, Math.round(+e.target.value || 0)) })
                            }
                          />
                        </td>
                        <td className="font-bold">{money(Math.max(0, l.unitPrice * l.qty - l.discount))}</td>
                        <td className={l.qty > l.stock ? 'text-amber-700 font-bold' : ''}>{faDigits(l.stock)}</td>
                        <td>
                          <button className="text-red-500" onClick={() => removeRep(l.variantId)}>
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!reps.length && (
                      <tr>
                        <td colSpan={9} className="text-center py-6 text-slate-400">
                          هنوز کالای جایگزینی انتخاب نشده است — بارکدش را اسکن کنید یا نام/کدش را بنویسید
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {!!reps.length && (
                    <tfoot>
                      <tr className="bg-slate-100 font-bold">
                        <td colSpan={3}>جمع کالای جایگزین</td>
                        <td className="text-center">{faDigits(exTotals.qty)}</td>
                        <td>{money(exTotals.goods)}</td>
                        <td>{money(exTotals.discount)}</td>
                        <td>{money(exTotals.goods - exTotals.discount)}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* نشست ۱۵۸ (Y16) — عوارض/حق سرویس کالای جایگزین از تنظیمات کانال فاکتور اصلی */}
                      {(exTotals.tax > 0 || exTotals.service > 0) && (
                        <tr className="bg-slate-50">
                          <td colSpan={6}>
                            عوارض و مالیات {money(exTotals.tax)} ریال · حق سرویس {money(exTotals.service)} ریال
                            {exScope === 'wholesale' ? ' (تنظیمات فروش عمده)' : ' (تنظیمات پنل فروش)'}
                          </td>
                          <td>{money(exTotals.tax + exTotals.service)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      )}
                      <tr className="bg-slate-100 font-bold">
                        <td colSpan={6}>جمع سند تعویض</td>
                        <td>{money(exTotals.exchangeTotal)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* ---------- مابه‌التفاوت زنده ---------- */}
              <div
                className={`rounded p-2 border-2 grid grid-cols-2 md:grid-cols-4 gap-2 ${
                  exTotals.diff > 0
                    ? 'bg-emerald-50 border-emerald-400'
                    : exTotals.diff < 0
                      ? 'bg-amber-50 border-amber-400'
                      : 'bg-slate-50 border-slate-300'
                }`}
              >
                <div>
                  <div className="kbd">ارزش کالای برگشتی</div>
                  <div className="font-bold">{money(totals.amount)}</div>
                </div>
                <div>
                  <div className="kbd">جمع کالای جایگزین</div>
                  <div className="font-bold">{money(exTotals.exchangeTotal)}</div>
                </div>
                <div>
                  <div className="kbd">مابه‌التفاوت</div>
                  <div className="font-bold text-base">{money(Math.abs(exTotals.diff))}</div>
                </div>
                <div>
                  <div className="kbd">نحوه‌ی تسویه</div>
                  <div className="font-bold">{diffLabel}</div>
                </div>
                {/*
                  ---------------------- بند ۱۲: انتخاب انحصاری و اجباری ----------------------
                  دو چک‌باکس مستقل نیست، یک انتخاب است: یا پول برمی‌گردد یا اعتبار صادر می‌شود،
                  هرگز هر دو. رفتار قبلی (صدور خودکار اعتبار) دیگر پیش‌فرض ضمنی نیست.
                */}
                {exTotals.diff < 0 && (
                  <div
                    className={`col-span-2 md:col-span-4 rounded p-2 border-2 ${
                      exRefundMode ? 'bg-white border-emerald-400' : 'bg-rose-50 border-rose-400'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <b>تسویه‌ی مابه‌التفاوت منفی — {money(-exTotals.diff)} ریال</b>
                      {!exRefundMode && <span className="text-rose-800 font-bold">انتخاب اجباری است</span>}
                    </div>
                    {/* جلسه ۱۷ · بند ۱ — چهار ستون، چون گزینه‌ی «کارت‌به‌کارت توسط مدیر» اضافه شد */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                      {EXCHANGE_REFUND_CHOICES.map((c) => (
                        <label
                          key={c.value}
                          className={`flex items-start gap-2 p-2 rounded border-2 cursor-pointer ${
                            exRefundMode === c.value ? 'bg-emerald-50 border-emerald-500' : 'border-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            className="w-4 h-4 mt-1"
                            name="exchangeRefundMode"
                            checked={exRefundMode === c.value}
                            onChange={() => setExRefundMode(c.value)}
                          />
                          <span>
                            <b>{c.title}</b>
                            <div className="kbd leading-5">{c.hint}</div>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {exTotals.diff > 0 && (
                  <div className="col-span-2 md:col-span-4 rounded border border-emerald-300 bg-white p-2">
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={exSplitPayment}
                        onChange={(e) => setExSplitPayment(e.target.checked)}
                      />
                      <span className="font-bold">دریافت ترکیبی نقد + کارت</span>
                    </label>
                    <div className="kbd mt-1">در حالت ترکیبی، دو رسید واقعی با جمع دقیق مابه‌التفاوت ثبت می‌شود.</div>
                    {!exSplitPayment ? (
                      <label className="block mt-2 max-w-sm">
                        <div className="kbd">روش دریافت مابه‌التفاوت</div>
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
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                          <label>
                            <div className="kbd">سهم نقدی</div>
                            <input
                              className="inp"
                              dir="ltr"
                              inputMode="numeric"
                              value={groupThousands(exSplitCash)}
                              onChange={(e) => {
                                if (parseGroupedInteger(e.target.value) != null) setExSplitCash(digitsOnly(e.target.value))
                              }}
                              placeholder="مبلغ نقد"
                              title="فقط عدد صحیح ریالی؛ جداکنندهٔ هزارگان و ارقام فارسی پذیرفته می‌شود."
                            />
                            <select
                              className="inp mt-1"
                              value={exSplitCashMethodId ?? ''}
                              onChange={(e) => setExSplitCashMethodId(e.target.value ? Number(e.target.value) : null)}
                            >
                              <option value="">روش نقدی را انتخاب کنید</option>
                              {cashMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          </label>
                          <label>
                            <div className="kbd">سهم کارتی</div>
                            <input
                              className="inp"
                              dir="ltr"
                              inputMode="numeric"
                              value={groupThousands(exSplitCard)}
                              onChange={(e) => {
                                if (parseGroupedInteger(e.target.value) != null) setExSplitCard(digitsOnly(e.target.value))
                              }}
                              placeholder="مبلغ کارت"
                              title="فقط عدد صحیح ریالی؛ جداکنندهٔ هزارگان و ارقام فارسی پذیرفته می‌شود."
                            />
                            <select
                              className="inp mt-1"
                              value={exSplitCardMethodId ?? ''}
                              onChange={(e) => setExSplitCardMethodId(e.target.value ? Number(e.target.value) : null)}
                            >
                              <option value="">روش کارتی را انتخاب کنید</option>
                              {cardMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className={`kbd mt-2 font-bold ${exSplitTotal === exTotals.diff && (exSplitCashAmount ?? 0) > 0 && (exSplitCardAmount ?? 0) > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          جمع نقد و کارت: {money(exSplitTotal ?? 0)} ریال · مبلغ لازم: {money(exTotals.diff)} ریال
                        </div>
                      </>
                    )}
                  </div>
                )}
                <label className="col-span-2 md:col-span-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4 mt-1"
                    checked={repAutoCentral}
                    onChange={(e) => setRepAutoCentral(e.target.checked)}
                  />
                  <span className="kbd leading-6">
                    کمبود موجودی کالای جایگزین از «انبار مرکزی» برداشته شود (همان رفتار پنل فروش).
                    {!!repShort.length && (
                      <b className="block text-amber-800">
                        موجودی فروشگاه برای {faDigits(repShort.length)} قلم جایگزین کافی نیست:{' '}
                        {repShort.map((l) => `«${l.name}» (موجودی ${faDigits(l.stock)} · درخواست ${faDigits(l.qty)})`).join(' · ')}
                      </b>
                    )}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* ---------------- بند ۱۱: روش بازپرداخت (اجباری، بدون پیش‌فرض) ---------------- */}
          {!exchangeMode && (
            <div
              className={`rounded shadow p-3 space-y-2 border-2 ${
                refundMethod ? 'bg-white border-emerald-400' : 'bg-amber-50 border-amber-400'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <b>روش بازپرداخت این برگشت</b>
                {!refundMethod && <span className="text-amber-800 font-bold">انتخاب اجباری است — تا انتخاب نکنید ثبت انجام نمی‌شود</span>}
                <span className="kbd ms-auto">
                  مشتری تا الان {money(lookup.paidTotal)} ریال بابت این فاکتور پرداخت کرده است؛ بازپرداخت نقدی/کارتی از این
                  مبلغ بیشتر نمی‌شود.
                </span>
              </div>
              <SmartSettlementPanel
                guidance={guidance}
                selectedMethod={refundMethod}
                onSelectMethod={(m) => {
                  setRefundMethod(m)
                  if (m !== 'CARD') setCardPosOverride(null)
                }}
                onCardPosLocked={() => setCardPosDialog(true)}
              />
              {refundMethod && refundMethod !== 'NONE' && (
                <div className="flex flex-wrap gap-2 items-end">
                  <label>
                    <div className="kbd">مبلغ بازپرداخت (خالی = کل {money(totals.amount)} ریال)</div>
                    <input
                      className="inp w-44"
                      dir="ltr"
                      /**
                       * نشست ۳۱۶ — نمایش سه‌رقم‌سه‌رقم هنگام تایپ؛ state خامِ
                       * رقمی می‌ماند تا Number(...) سمت ارسال (:۵۰۶) نیاز به
                       * تغییر نداشته باشد.
                       */
                      value={groupThousands(refundAmount)}
                      onChange={(e) => setRefundAmount(digitsOnly(e.target.value))}
                      placeholder={groupThousands(String(totals.amount))}
                      inputMode="numeric"
                    />
                  </label>
                  {refundMethod === 'CARD' && (
                    <label>
                      <div className="kbd">شماره پیگیری / مرجع بازپرداخت</div>
                      <input className="inp w-48" dir="ltr" value={refundReference} onChange={(e) => setRefundReference(e.target.value)} />
                    </label>
                  )}
                  <label className="flex-1 min-w-[200px]">
                    <div className="kbd">توضیح بازپرداخت (روی رسید برگشت چاپ می‌شود)</div>
                    <input className="inp" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} />
                  </label>
                </div>
              )}
              <label className="flex items-start gap-2 mt-2 rounded border border-rose-300 bg-rose-50 p-2">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-1"
                  checked={managerFullRefund}
                  onChange={(e) => setManagerFullRefund(e.target.checked)}
                />
                <span className="flex-1">
                  <b className="text-rose-800">بازپرداخت مبلغ کامل، بدون کسر تخفیف، با تایید مدیر</b>
                  <span className="kbd block">فقط مدیر با رمز و دلیل می‌تواند تخفیف را نادیده بگیرد؛ این رویداد در Audit ثبت می‌شود.</span>
                  {managerFullRefund && (
                    <span className="flex flex-wrap gap-2 mt-2">
                      <input
                        type="password"
                        className="inp w-40"
                        dir="ltr"
                        placeholder="رمز مدیر"
                        value={fullRefundPw}
                        onChange={(e) => setFullRefundPw(e.target.value)}
                      />
                      <input
                        className="inp flex-1 min-w-[220px]"
                        placeholder="دلیل اجباری مدیر"
                        value={fullRefundReason}
                        onChange={(e) => setFullRefundReason(e.target.value)}
                      />
                    </span>
                  )}
                </span>
              </label>
            </div>
          )}

          {/* ---------------- عملیات ---------------- */}
          <div className="bg-white rounded shadow p-3 flex flex-wrap gap-3 items-end">
            <button className="btn" onClick={selectAll} disabled={busy}>
              برگشت کامل (همه‌ی اقلام)
            </button>
            <button className="btn" onClick={clearAll} disabled={busy}>
              پاک کردن انتخاب‌ها
            </button>
            <label className="flex-1 min-w-[200px]">
              <div className="mb-1">یادداشت {exchangeMode ? 'تعویض' : 'برگشت'} (اختیاری)</div>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {!!removedSelected.length && (
              <label className="flex items-center gap-2 pb-2 text-amber-800 font-bold">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={allowRemoved}
                  onChange={(e) => setAllowRemoved(e.target.checked)}
                />
                رسیدگی دستی: کالای حذف‌شده از انبار هم برگشت بخورد
              </label>
            )}
            {lookupLocked && (
              <div className="text-rose-700 font-bold">
                این فاکتور {lookup?.status === 'CANCELED' ? 'لغو شده' : 'پیش‌نویس'} است؛ برگشت و تعویض روی آن ممکن نیست.
              </div>
            )}
            {exchangeMode ? (
              <button
                className="btn btn-primary"
                onClick={() => void doExchange(false)}
                disabled={busy || lookupLocked || !totals.count || !reps.length || (exTotals.diff < 0 && !exRefundMode)}
                title="برگشت اقلام + سند تعویض + تسویه‌ی مابه‌التفاوت، همه در یک تراکنش"
              >
                {busy ? 'در حال ثبت…' : 'ثبت تعویض کالا'}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void doSubmit(false)}
                disabled={busy || lookupLocked || !totals.count || !refundMethod}
                title={refundMethod ? undefined : 'اول «روش بازپرداخت» را انتخاب کنید (بند ۱۱)'}
              >
                {busy ? 'در حال ثبت…' : 'ثبت برگشت از فروش'}
              </button>
            )}
            <button
              className="btn"
              onClick={() => void printSourceInvoice(lookup.invoiceId)}
              disabled={busy || printing}
            >
              {printing ? 'در حال چاپ…' : 'چاپ رسید فاکتور'}
            </button>
            <div className="kbd">
              {exchangeMode
                ? 'تعویض = یک «سند تعویض» جدید با اقلام جایگزین + برگشت اقلام قدیمی. ارزش کالای برگشتی به‌صورت یک پرداختی غیرنقدی روی سند می‌نشیند، پس در «خالص واقعی دریافتی» گزارش شمرده نمی‌شود.'
                : 'برگشت، موجودی را فوراً و به‌صورت قطعی به انبار برمی‌گرداند (حرکت انبار با دلیل SALE_RETURN ثبت می‌شود) و وضعیت فاکتور به «برگشت جزئی/کامل» تغییر می‌کند.'}
            </div>
          </div>
        </>
      )}

      {/* ---------------- آخرین برگشت‌ها ---------------- */}
      {!lookup && (
        <div className="tbl-card">
          <div className="p-2 border-b flex flex-wrap gap-3 items-end">
            <div className="font-bold self-center">برگشت‌های ثبت‌شده</div>
            <div>
              <div className="mb-1">از تاریخ</div>
              <JalaliDateInput value={histFrom} onChange={setHistFrom} />
            </div>
            <div>
              <div className="mb-1">تا تاریخ</div>
              <JalaliDateInput value={histTo} onChange={setHistTo} />
            </div>
            <button className="btn btn-primary" onClick={() => void loadHistory()} disabled={rowBusy}>
              نمایش
            </button>
            <button
              className="btn"
              onClick={() => {
                setHistFrom(jalaliToday())
                setHistTo(jalaliToday())
              }}
              disabled={rowBusy}
            >
              امروز
            </button>
            <div className="kbd self-center leading-6">
              {faDigits(history.length)} برگشت · جمع {money(history.reduce((s, r) => s + (r.total ?? 0), 0))} ریال · از این
              مبلغ {money(history.reduce((s, r) => s + (r.cashRefundAmount ?? 0), 0))} ریال نقد از کشوی صندوق خارج شده است ·
              هر ردیف قابل ویرایش و حذف است (موجودی انبار خودکار اصلاح می‌شود)
              <div>
                این فهرست فقط «برگشت ساده» را نشان می‌دهد؛ تعویض‌ها در تب «تعویض کالا»ی گزارشات فروش دیده می‌شوند (بند ۱۰).
              </div>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>شماره فیش</th>
                <th>کد فاکتور</th>
                <th>تاریخ برگشت</th>
                <th>ساعت</th>
                <th>مشتری</th>
                <th>نوع</th>
                <th>تعداد</th>
                <th>مبلغ</th>
                {/* ---- بند ۱۱: دو ستونی که تفکیک «کسری واقعی» از «کسری کاذب» را ممکن می‌کنند ---- */}
                <th>نحوه‌ی تسویه</th>
                <th>نقد خارج‌شده از صندوق</th>
                <th>برگشت به انبار</th>
                <th>اقلام</th>
                <th>رسید</th>
                <th>ویرایش</th>
                <th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="font-bold">{faDigits(r.receiptNo ?? '—')}</td>
                  <td dir="ltr">
                    {r.returnCode ? (
                      <button className="text-brand" onClick={() => void lookupCode(r.returnCode)}>
                        {r.returnCode}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{faDigits(r.returnedAtJalali)}</td>
                  <td>{faDigits(r.time)}</td>
                  <td>{r.customerName}</td>
                  <td>{r.isFull ? 'کامل' : 'جزئی'}</td>
                  <td className="text-center">{faDigits(r.qty)}</td>
                  <td>{money(r.total)}</td>
                  <td className="whitespace-normal">
                    {r.refundMethodLabel ?? '—'}
                    {r.legacyAssumed && (
                      <div className="kbd text-amber-800 font-bold">فرض‌شده از داده‌ی قدیمی</div>
                    )}
                    {r.refundReference && <div className="kbd" dir="ltr">{r.refundReference}</div>}
                  </td>
                  <td className={r.cashRefundAmount ? 'text-rose-700 font-bold' : ''}>
                    {money(r.cashRefundAmount ?? 0)}
                  </td>
                  <td className="text-center">{faDigits(r.restockedQty ?? 0)}</td>
                  <td className="whitespace-normal">
                    {r.items.map((i: any) => `${i.name} (${faDigits(i.qty)})`).join(' · ')}
                    {r.hasRemovedItems && <div className="text-amber-700 font-bold">شامل کالای حذف‌شده از انبار</div>}
                  </td>
                  <td>
                    <button
                      className="text-brand"
                      onClick={() => void printReturn(r.id)}
                      disabled={rowBusy || printing}
                      title="چاپ رسید مستقل همین برگشت (بند ۱۳)"
                    >
                      چاپ
                    </button>
                  </td>
                  <td>
                    <button
                      className="text-brand"
                      onClick={() => requestReturnCorrectionAction('EDIT', r)}
                      disabled={rowBusy}
                      title="اصلاح تعداد یا اقلام این برگشت (اختلاف روی موجودی انبار اعمال می‌شود)"
                    >
                      ویرایش
                    </button>
                  </td>
                  <td>
                    <button
                      className="text-red-600"
                      onClick={() => requestReturnCorrectionAction('VOID', r)}
                      disabled={rowBusy}
                      title="ابطال این برگشت (سند با مهر «باطل» و دلیل می‌ماند) و بازگرداندن اثرش روی موجودی انبار"
                    >
                      ابطال
                    </button>
                    <button
                      className="text-amber-700 mr-2"
                      onClick={() => requestReturnCorrectionAction('RECONCILE', r)}
                      disabled={rowBusy}
                      title="ثبت اثر جبرانی جدید برای پول، کارت، اعتبار و موجودی؛ سند برگشت اصلی دست‌نخورده می‌ماند"
                    >
                      اصلاح جبرانی
                    </button>
                  </td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td colSpan={14} className="text-center py-10 text-slate-400">
                    در این بازه برگشت از فروشی ثبت نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <OverpayFlowDialogs
        flow={overpayFlow}
        busy={busy}
        onFlow={setOverpayFlow}
        onSubmit={(req) => void doSubmit(false, req)}
        issuedCredit={issuedOverpayCredit}
        onCloseIssued={() => {
          issuedOverpayCreditOpenRef.current = false
          setIssuedOverpayCredit(null)
          setOverpayCreditPrintProblem(null)
        }}
        onReprint={(pw) => void printIssuedOverpayCredit(issuedOverpayCredit, { reprintPassword: pw })}
        creditPrinting={overpayCreditPrinting}
        creditPrintProblem={overpayCreditPrintProblem}
      />

      {/*
       * قفل عملیاتیِ ویرایش/ابطال: این گیت عمداً قبل از خودِ فرم‌های تغییر
       * قرار دارد. پس با قفل روشن، کارمند نه اقلام ویرایش را می‌بیند و نه
       * دیالوگ ابطال/اصلاح جبرانی را؛ اول باید همین اختیار محدود را باز کند.
       */}
      <ConfirmDialog
        open={!!correctionUnlockRequest}
        title="قفل عملیات اصلاح و ابطال"
        confirmLabel="تأیید و باز کردن قفل"
        busy={correctionUnlockBusy}
        message={
          <div className="space-y-3">
            <p className="font-bold text-amber-900">
              این صفحه قفل است؛ شما نمی‌توانید ویرایش، اصلاح جبرانی یا ابطال برگشت/تعویض انجام دهید.
            </p>
            <p className="kbd leading-6">
              برای ادامه، رمز مدیر، رمز دوم اختصاصی «اصلاح و ابطال برگشت / تعویض»، یا رمز سومِ تعریف‌شده برای شیفت جاری را وارد کنید.
              این رمز فقط همین اختیار را باز می‌کند و نشست مدیر ایجاد نمی‌کند مگر رمز مدیر وارد شود.
            </p>
            <label className="block">
              <span className="font-bold">رمز مجوز عملیات</span>
              <PasswordField
                className="inp w-full mt-1"
                value={correctionUnlockPassword}
                onChange={(e) => {
                  setCorrectionUnlockPassword(e.target.value)
                  setCorrectionUnlockError(null)
                }}
                autoComplete="off"
                autoFocus
                placeholder="رمز مدیر یا رمز دوم/سوم این عملیات"
              />
            </label>
            {correctionUnlockError && <p className="text-red-600 whitespace-pre-line">{correctionUnlockError}</p>}
            <p className="kbd leading-6">
              پس از باز شدن قفل، فقط فرمِ عملیات انتخاب‌شده باز می‌شود. هنگام ثبت نهایی نیز کنترل‌های مالی و ثبت سابقهٔ سمت سرور برقرار می‌مانند.
            </p>
          </div>
        }
        onConfirm={() => void unlockReturnCorrectionAction()}
        onCancel={() => {
          if (correctionUnlockBusy) return
          setCorrectionUnlockRequest(null)
          setCorrectionUnlockPassword('')
          setCorrectionUnlockError(null)
        }}
      />

      {/* ---------------- ویرایش یک برگشت ثبت‌شده ---------------- */}
      <ReturnEditModal
        returnId={editId}
        onClose={() => setEditId(null)}
        onSaved={(m) => {
          flash(m)
          void loadHistory()
          if (lookup) void lookupCode(lookup.returnCode)
        }}
      />

      {/* ---------------- دفتر جبرانی برای اثرهای واقعاً تسویه‌شده ---------------- */}
      <ConfirmDialog
        open={!!correctionTarget}
        title="اصلاح جبرانی برگشت از فروش"
        busy={correctionBusy}
        confirmLabel="ثبت اثرهای جبرانی"
        message={
          <div className="space-y-2">
            <p className="text-amber-800">
              این مسیر سند برگشت اصلی را پاک یا باطل نمی‌کند. خروج موجودی، نقد بازیافتی و ثبت کارت/اعتبار با زمان، کاربر و شیفت <b>فعلی</b> در دفتر جبرانی ثبت می‌شوند تا گزارش شیفت مبدأ دست‌نخورده بماند.
            </p>
            <p>
              برگشت فاکتور <b>{faDigits(correctionTarget?.receiptNo ?? '—')}</b> به تاریخ <b>{faDigits(correctionTarget?.returnedAtJalali ?? '—')}</b> · مبلغ <b>{money(correctionTarget?.total ?? 0)}</b> ریال
            </p>
            <label className="block">
              <span className="font-bold">دلیل اصلاح جبرانی (اجباری)</span>
              <input className="inp w-full" autoFocus value={correctionReason} onChange={(e) => { setCorrectionReason(e.target.value); setCorrectionErr(null) }} />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label>
                <span>نقدی که واقعاً به کشوی فعلی برگشت</span>
                <input dir="ltr" className="inp w-full" inputMode="numeric" value={groupThousands(correctionCash)} onChange={(e) => { setCorrectionCash(digitsOnly(e.target.value)); setCorrectionErr(null) }} placeholder="۰" />
              </label>
              <label>
                <span>کارت/بانکی که واقعاً برگشت</span>
                <input dir="ltr" className="inp w-full" inputMode="numeric" value={groupThousands(correctionCard)} onChange={(e) => { setCorrectionCard(digitsOnly(e.target.value)); setCorrectionErr(null) }} placeholder="۰" />
              </label>
            </div>
            <label className="block">
              <span>شماره پیگیری/توضیح بازیافت کارت (اگر مبلغ کارت وارد شده)</span>
              <input className="inp w-full" value={correctionCardReference} onChange={(e) => { setCorrectionCardReference(e.target.value); setCorrectionErr(null) }} />
            </label>
            <label className="block">
              <span className="font-bold">وضعیت اعتبار صادرشده از همین برگشت</span>
              <select className="inp w-full" value={correctionCreditOutcome} onChange={(e) => { setCorrectionCreditOutcome(e.target.value); setCorrectionErr(null) }}>
                <option value="NONE">این برگشت اعتبار صادر نکرده است</option>
                <option value="CANCELED_UNUSED">اعتبار مصرف‌نشده لغو شد</option>
                <option value="REMAINS_ACTIVE">اعتبار هنوز باقی و قابل مصرف است</option>
                <option value="CONSUMED">اعتبار کامل مصرف شده است</option>
              </select>
            </label>
            <label className="block">
              <span>یادداشت تسویه/کسری (اختیاری، ولی برای مغایرت توصیه می‌شود)</span>
              <input className="inp w-full" value={correctionNote} onChange={(e) => setCorrectionNote(e.target.value)} />
            </label>
            <label className="block">
              <span>رمز اصلاح جبرانی (در نصب تازه اجباری)</span>
              <input type="password" dir="ltr" className="inp w-full" value={correctionAuthPassword} onChange={(e) => { setCorrectionAuthPassword(e.target.value); setCorrectionErr(null) }} placeholder="رمز مدیر یا رمز اختصاصی اصلاح/ابطال" />
            </label>
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
              <p className="font-bold">تأیید شخصی مدیر — فقط روز بعد یا دوره‌ی بسته</p>
              <select className="inp w-full" value={correctionApproverUserId ?? ''} onChange={(e) => { setCorrectionApproverUserId(e.target.value ? Number(e.target.value) : null); setCorrectionErr(null) }}>
                <option value="">انتخاب مدیر تأییدکننده…</option>
                {voidManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.hasCorrectionApprovalPassword ? '' : ' — رمز شخصی تعریف نشده'}</option>)}
              </select>
              <input type="password" dir="ltr" className="inp w-full" value={correctionApproverPassword} onChange={(e) => { setCorrectionApproverPassword(e.target.value); setCorrectionErr(null) }} placeholder="رمز شخصی مدیر انتخاب‌شده" />
            </div>
            {correctionErr && <p className="text-red-600 whitespace-pre-line">{correctionErr}</p>}
            <p className="kbd">اگر همه‌ی پولِ بازپرداخت‌شده برنگشته باشد، سیستم همان کسری را به‌عنوان «مغایرت بازیافت‌نشده» ثبت می‌کند؛ آن را صفر یا پنهان نمی‌کند.</p>
          </div>
        }
        onConfirm={() => void doCorrection()}
        onCancel={() => { setCorrectionTarget(null); setCorrectionErr(null) }}
      />

      {/* ---------------- تاییدیه‌ی حذف یک برگشت ثبت‌شده ---------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="ابطال برگشت از فروش"
        message={
          <div className="space-y-2">
            <p>
              برگشت فاکتور شماره <b>{faDigits(deleteTarget?.receiptNo ?? '—')}</b> به تاریخ{' '}
              <b>{faDigits(deleteTarget?.returnedAtJalali ?? '—')}</b> با مبلغ{' '}
              <b>{money(deleteTarget?.total ?? 0)}</b> ریال باطل می‌شود. سند پاک نمی‌شود؛ با مهر «باطل»، نام شما،
              زمان و دلیل برای همیشه در سابقه می‌ماند و از همه‌ی گزارش‌ها و محاسبه‌ها بیرون می‌رود.
            </p>
            <label className="block">
              <span className="font-bold">دلیل ابطال (اجباری)</span>
              <input
                className="inp w-full"
                value={voidReason}
                autoFocus
                onChange={(e) => {
                  setVoidReason(e.target.value)
                  setVoidReasonErr(null)
                }}
              />
            </label>
            <label className="block">
              <span className="font-bold">رمز تأیید ابطال (در نصب تازه اجباری)</span>
              <input
                type="password"
                dir="ltr"
                className="inp w-full"
                value={voidAuthPassword}
                onChange={(e) => {
                  setVoidAuthPassword(e.target.value)
                  setVoidReasonErr(null)
                }}
                placeholder="رمز مدیر یا رمز اختصاصی اصلاح/ابطال را وارد کنید"
              />
              <span className="kbd block mt-1">
                در روز جاری این فیلد فقط وقتی لازم است که مدیر قفل عملیات ابطال را روشن کرده باشد. رمز شخصیِ مدیرِ مشخص برای روزهای بعد یا دوره‌ی بسته در فیلدهای پایین وارد می‌شود.
              </span>
            </label>
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
              <p className="text-sm font-bold text-amber-900">تأیید شخصی مدیر — فقط اصلاح دیرهنگام یا دوره‌ی بسته</p>
              <label className="block">
                <span>مدیر تأییدکننده</span>
                <select
                  className="inp w-full"
                  value={voidApproverUserId ?? ''}
                  onChange={(e) => {
                    setVoidApproverUserId(e.target.value ? Number(e.target.value) : null)
                    setVoidReasonErr(null)
                  }}
                >
                  <option value="">انتخاب کنید…</option>
                  {voidManagers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name}{manager.hasCorrectionApprovalPassword ? '' : ' — رمز شخصی تعریف نشده'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span>رمز شخصی مدیر انتخاب‌شده</span>
                <input
                  type="password"
                  dir="ltr"
                  className="inp w-full"
                  value={voidApproverPassword}
                  onChange={(e) => {
                    setVoidApproverPassword(e.target.value)
                    setVoidReasonErr(null)
                  }}
                  placeholder="برای روزهای بعد یا دوره‌ی بسته اجباری است"
                />
              </label>
              <p className="kbd">
                مدیر و رمز او در سابقه‌ی غیرقابل‌تغییر ثبت می‌شود؛ رمز سراسری یا رمز پنل جای این هویت شخصی را نمی‌گیرد.
              </p>
            </div>
            {voidReasonErr && <p className="text-red-600 whitespace-pre-line">{voidReasonErr}</p>}
            <p className="text-amber-700">
              اگر بازپرداخت نقد/کارت‌خوان/کارت‌به‌کارتِ پرداخت‌شده انجام شده یا اعتبار خرید این برگشت خرج شده باشد،
              ابطال انجام نمی‌شود (پول واقعاً رفته است) و موضوع برای رسیدگی مدیر ثبت می‌شود.
            </p>
            <p>
              {deleteTarget?.restockedQty
                ? `اثر این برگشت روی انبار برگردانده می‌شود: ${faDigits(
                    deleteTarget.restockedQty
                  )} عدد که با این برگشت به انبار آمده بود، از موجودی خارج می‌شود و موجودی به حالت قبل از این برگشت برمی‌گردد.`
                : 'این برگشت موجودی انبار را تغییر نداده بود، پس با حذفش هم موجودی دست‌نخورده می‌ماند.'}
            </p>
            <p className="kbd">
              وضعیت فاکتور بر اساس برگشت‌های باقی‌مانده بازمحاسبه می‌شود و سابقه‌ی حرکات انبار پاک نمی‌شود (حرکت
              معکوس ثبت می‌گردد).
            </p>
          </div>
        }
        confirmLabel="بله، باطل کن"
        busy={rowBusy}
        onConfirm={() => void doDelete()}
        onCancel={() => {
          setDeleteTarget(null)
          setVoidAuthPassword('')
          setVoidApproverUserId(null)
          setVoidApproverPassword('')
          setVoidReasonErr(null)
        }}
      />

      <ConfirmDialog
        open={!!confirmForce}
        title="تعداد برگشتی بیشتر از فروش است"
        message={<div className="whitespace-pre-line">{confirmForce}</div>}
        confirmLabel="بله، همین را ثبت کن"
        busy={busy}
        onConfirm={() => void doSubmit(true)}
        onCancel={() => setConfirmForce(null)}
      />

      {/* تعویض: همان هشدار «بیشتر از تعداد قابل برگشت»، ولی برای مسیر تعویض */}
      <ConfirmDialog
        open={!!confirmExchange}
        title="تعداد برگشتی تعویض بیشتر از فروش است"
        message={<div className="whitespace-pre-line">{confirmExchange}</div>}
        confirmLabel="بله، تعویض را ثبت کن"
        busy={busy}
        onConfirm={() => void doExchange(true)}
        onCancel={() => setConfirmExchange(null)}
      />

      {/* نشست ۳۱۹ — تأیید مدیر برای بازپرداخت کارتی (کارت‌خوان) */}
      <CardPosOverrideDialog
        open={cardPosDialog}
        onClose={() => setCardPosDialog(false)}
        onConfirm={(override) => {
          setCardPosOverride(override)
          setRefundMethod('CARD')
          setCardPosDialog(false)
        }}
      />
    </div>
  )
}

function Info({
  label,
  value,
  strong,
  ltr
}: {
  label: string
  value: string
  strong?: boolean
  ltr?: boolean
}) {
  return (
    <div>
      <div className="kbd">{label}</div>
      <div dir={ltr ? 'ltr' : undefined} className={`inp bg-slate-50 truncate ${strong ? 'font-bold' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}
