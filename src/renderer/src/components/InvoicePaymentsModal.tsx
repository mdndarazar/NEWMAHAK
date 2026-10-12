import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import JalaliDateInput from './JalaliDateInput'
import PaymentDestinationBox from './PaymentDestinationBox'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { isPrintCancelledError, isUnknownPrintMessage, printErrorMessage } from '../lib/printErrors'
import { faDigits, money, jalaliToday, toClock } from '@shared/jalali'
import { paymentMomentFields } from '@shared/paymentDateUi'
import {
  PaymentDestination,
  PAYMENT_DESTINATION_LABELS,
  MANAGER_ACCOUNT_ROW_NOTE
} from '@shared/enums'
import type { InvoicePaymentsView } from '@shared/types'
import OverpayFlowDialogs, { printOverpayCredit, type OverpayCreditPrintProblem } from './OverpayFlowDialogs'
import {
  isOverpayWarning,
  needsManagerPassword,
  overpayFlowStart,
  overpayFlowAskPassword,
  overpayCreditFlash,
  overpayCreditButton,
  type OverpayFlowState,
  type OverpayRequest,
  type OverpayCreditLike
} from '@shared/overpayFlow'

/**
 * ============== پرداختی‌ها / اقساط یک فاکتور (فروش نسیه) ==============
 * همه‌ی کاری که فروش نسیه لازم دارد، در یک پنجره:
 *
 *   • تاریخچه‌ی کامل پرداختی‌ها: پرداختی اول، دوم، سوم … هر کدام با تاریخ،
 *     ساعت، مبلغ و نوع پرداخت.
 *   • «باقی‌مانده» همیشه بالای پنجره، و علامت «تسویه‌شده» به‌محض صفر شدنش.
 *   • ثبت پرداختی جدید (مثلاً یک ماه بعد که مشتری قسط دوم را می‌آورد): مبلغ +
 *     روش پرداخت ⇒ یک رکورد جدید با تاریخ و ساعت همان لحظه.
 *   • ثبت چک: مبلغ چک، سررسید (موعد)، شماره چک و بانک. چک تا وقتی «پاس» نشده
 *     باشد باقی‌مانده را کم نمی‌کند؛ با زدن «پاس شد» مبلغش مثل پرداخت نقدی به
 *     جمع پرداختی‌ها اضافه می‌شود و اگر باقی‌مانده صفر شود فاکتور خودکار
 *     «تسویه‌شده» علامت می‌خورد.
 *   • هر پرداختی/چک اشتباه، قابل حذف است و همه‌ی جمع‌ها بازمحاسبه می‌شوند.
 *
 * هیچ‌کدام از این کارها به اقلام فاکتور و موجودی انبار دست نمی‌زند.
 * ====================================================================
 */
interface Method {
  id: number
  label: string
  /**
   * کار الف — `kind` روش پرداخت (CASH | CARD | CREDIT | CUSTOM …). کادر «مقصد
   * پول» گزینه‌هایش را از همین می‌گیرد، پس هیچ‌وقت گزینه‌ای نشان داده نمی‌شود که
   * سرور ردش کند. اگر صفحه‌ی میزبان آن را پاس نکند، هر سه گزینه باز است و
   * اعتبارسنجی نهایی سمت سرور انجام می‌شود.
   */
  kind?: string | null
}

/** روش CREDIT نسیه است و STORE/EXCHANGE_CREDIT تنها از ledger اختصاصی ساخته می‌شوند. */
function isDirectPaymentMethod(method: Method): boolean {
  return !['CREDIT', 'STORE_CREDIT', 'EXCHANGE_CREDIT'].includes(method.kind ?? '')
}

/** همان کلید تا پاسخ قطعی نگه داشته می‌شود؛ fallback فقط برای runtime قدیمی است. */
function newPaymentRequestKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid
    ? `payment-add-${uuid}`
    : `payment-add-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

export default function InvoicePaymentsModal({
  open,
  invoiceId,
  methods,
  onClose,
  onChanged,
  debtReceiptPrint = false
}: {
  open: boolean
  invoiceId: number | null
  methods: Method[]
  onClose: () => void
  /** بعد از هر تغییر صدا زده می‌شود تا فهرست فاکتورها تازه شود */
  onChanged?: (msg: string) => void
  /** تیک تنظیمات مدیر: بعد از ثبت موفق، فیش وصول چاپ شود. پیش‌فرض خاموش. */
  debtReceiptPrint?: boolean
}) {
  const directPaymentMethods = useMemo(() => methods.filter(isDirectPaymentMethod), [methods])
  const [view, setView] = useState<InvoicePaymentsView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<
    | null
    | { paymentId: number; state: 'printing' }
    | { paymentId: number; state: 'done' }
    | { paymentId: number; state: 'unknown'; msg: string }
    | { paymentId: number; state: 'failed'; msg: string }
  >(null)
  const receiptPrintingRef = useRef(false)
  /** retry همان کلیک/timeout باید همان ردیف Payment را بخواند، نه ردیف دوم بسازد. */
  const addPaymentRequestKey = useRef<string | null>(null)

  // ---- فرم پرداختی جدید ----
  const [kind, setKind] = useState<'CASH' | 'CHEQUE'>('CASH')
  const [amount, setAmount] = useState(0)
  const [methodId, setMethodId] = useState<number | null>(null)
  const [paidAtJalali, setPaidAtJalali] = useState(jalaliToday())
  /**
   * بخش ۷ — «ساعت پرداختی». پیش‌فرض همین لحظه و قابل تغییر دستی (پولی که دیروز
   * ساعت ۱۹ گرفته شده و امروز ثبت می‌شود). ورودی بی‌معنا سمت main بی‌صدا نادیده
   * گرفته می‌شود و همان ساعت خودکار می‌نشیند، پس هیچ‌وقت مانع ثبت پرداختی نیست.
   */
  const [paidAtTime, setPaidAtTime] = useState(() => toClock(new Date(), false))
  /** AUDIT-S136-03 — فقط تاریخ/ساعتی که کاربر آگاهانه عوض کرده فرستاده می‌شود */
  const [dateTouched, setDateTouched] = useState(false)
  const [timeTouched, setTimeTouched] = useState(false)
  const [note, setNote] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [bankName, setBankName] = useState('')
  const [dueDateJalali, setDueDateJalali] = useState(jalaliToday())
  /** پرداختی/چکی که کاربر دکمه‌ی حذفش را زده (تایید دو مرحله‌ای) */
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  /**
   * ------------------ بخش ۸ — «مبلغ بیشتر از باقی‌مانده» ------------------
   * سرور (`addPayment`) وقتی مبلغ واردشده از باقی‌ماندهٔ بدهی بیشتر باشد و تایید
   * آگاهانه نیامده باشد، یک *هشدار فارسی با اعداد دقیق* برمی‌گرداند — نه یک
   * دیوار. همان متن را در یک دیالوگ دو دکمه‌ای نشان می‌دهیم و با «بله، ثبت کن»
   * همان درخواست را با `confirmOverpay: true` دوباره می‌فرستیم؛ آن وقت *کل*
   * مبلغ واردشده ثبت و مقدار اضافه روی همان رکورد ذخیره می‌شود.
   */
  /**
   * نشست ۶۲ · بند ۴-۳۵/۴-۵۵ — فلوی چهارمرحله‌ای (هشدار ⇒ «کد اعتبار صادر
   * بشود؟» ⇒ چاپ کد / ردیف دریافت پول اضافه). همه‌ی تصمیم‌ها در
   * `@shared/overpayFlow` است؛ اینجا فقط نمایش و ارسال.
   */
  const [flow, setFlow] = useState<OverpayFlowState | null>(null)
  /** رمز برای کدام مسیر خواسته شده: ثبت پرداخت، یا دکمه‌ی صدور از اضافه‌دریافت موجود */
  const [pwTarget, setPwTarget] = useState<'payment' | 'issue'>('payment')
  /** آخرین کد اعتبار صادرشده از مبلغ اضافه (برای نمایش و چاپ دوباره) */
  const [issuedCredit, setIssuedCredit] = useState<(OverpayCreditLike & { id?: number }) | null>(null)
  const issuedCreditOpenRef = useRef(false)
  const [creditPrinting, setCreditPrinting] = useState(false)
  const [creditPrintProblem, setCreditPrintProblem] = useState<OverpayCreditPrintProblem>(null)
  /**
   * ---------------- کار الف — «مقصد پول» (بدون پیش‌فرض) ----------------
   * دو حالت جدا دارد و عمداً دو state جدا:
   *   • `destination`  ⇒ فرم «ثبت پرداختی جدید» (پرداختی نسیه).
   *   • `clearing`/`clearDest` ⇒ پنجره‌ی «پاس شد» یک چک مشخص.
   * هیچ‌کدام مقدار اولیه ندارند و بعد از هر ثبت موفق پاک می‌شوند، تا مقصدِ
   * پرداختیِ قبلی بی‌صدا روی پرداختی بعدی ننشیند.
   */
  const [destination, setDestination] = useState<PaymentDestination | null>(null)
  const [destWarn, setDestWarn] = useState<string | null>(null)
  const [clearing, setClearing] = useState<{ id: number; amount: number; methodKind?: string | null } | null>(null)
  const [clearDest, setClearDest] = useState<PaymentDestination | null>(null)
  const [clearWarn, setClearWarn] = useState<string | null>(null)
  /**
   * نشست ۱۳۶ (S136-2) — دوره‌ی بسته برای پرداخت/ابطال/وضعیت چک. مثل صفحه‌ی
   * برگشت، دو فیلد «رمز مدیر» و «دلیل» فقط *بعد از* پیام سرور ظاهر می‌شوند.
   */
  const [lockNeeded, setLockNeeded] = useState(false)
  const [lockPw, setLockPw] = useState('')
  const [lockReason, setLockReason] = useState('')
  /** نشست ۲۰۰ — پاس/برگشت/در جریان چک در دوره‌ی باز هم رمز می‌خواهد. */
  const [chequePw, setChequePw] = useState('')
  const [chequeGate, setChequeGate] = useState(false)
  const lockFields = () =>
    lockNeeded && lockPw ? { managerPassword: lockPw, overrideReason: lockReason.trim() || null } : {}
  const noteLock = (message: string) => {
    if (message.includes('دوره بسته شده است') || message.includes('دوره‌ی بسته')) setLockNeeded(true)
  }
  const clearLock = () => {
    setLockNeeded(false)
    setLockPw('')
    setLockReason('')
  }

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    try {
      const v = await call<InvoicePaymentsView>(CH.salePayments, { invoiceId })
      setView(v)
      setErr(null)
      // پیش‌فرض مبلغ = همان باقی‌مانده (کار روزانه: مشتری کل مانده را می‌آورد)
      setAmount(v?.remaining ?? 0)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    if (!open) {
      issuedCreditOpenRef.current = false
      addPaymentRequestKey.current = null
      return
    }
    setKind('CASH')
    setNote('')
    setChequeNo('')
    setBankName('')
    setPaidAtJalali(jalaliToday())
    setPaidAtTime(toClock(new Date(), false))
    setDateTouched(false)
    setTimeTouched(false)
    setDueDateJalali(jalaliToday())
    setMsg(null)
    setErr(null)
    setReceipt(null)
    setConfirmDelete(null)
    setDestination(null)
    setDestWarn(null)
    setClearing(null)
    setClearDest(null)
    setClearWarn(null)
    setFlow(null)
    issuedCreditOpenRef.current = false
    setIssuedCredit(null)
    setCreditPrinting(false)
    setCreditPrintProblem(null)
    setMethodId((cur) =>
      cur != null && directPaymentMethods.some((method) => method.id === cur) ? cur : directPaymentMethods[0]?.id ?? null
    )
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId])

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    onChanged?.(m)
  }

  const printDebtReceipt = async (paymentId: number, reprint = false) => {
    if (!debtReceiptPrint || !paymentId || receiptPrintingRef.current) return
    receiptPrintingRef.current = true
    setReceipt({ paymentId, state: 'printing' })
    try {
      /**
       * فاز ۳ — فیش پرداختی هم از مسیر مشترک چاپ می‌گذرد. انصراف از پنجره‌ی
       * انتخاب چاپگر یعنی هیچ چاپی انجام نشد؛ پیام خطا هم نمی‌آید (لغو قطعی).
       */
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printDebtPayment, { paymentId, reprint, deviceName, silent: opts?.silent })
      )
      setReceipt(res === 'CANCELLED' ? null : { paymentId, state: 'done' })
    } catch (e: any) {
      if (isPrintCancelledError(e)) {
        setReceipt(null)
        return
      }
      const raw = printErrorMessage(e)
      const unknown = isUnknownPrintMessage(e)
      setReceipt({
        paymentId,
        state: unknown ? 'unknown' : 'failed',
        msg: unknown
          ? 'پرداخت ثبت شده است. معلوم نیست فیش چاپ شده باشد؛ قبل از تلاش دوباره کاغذ و صف چاپگر را نگاه کنید.'
          : `پرداخت ثبت شده است؛ فیش چاپ نشد: ${raw}`
      })
    } finally {
      receiptPrintingRef.current = false
    }
  }

  /** روش پرداختِ انتخاب‌شده‌ی فرم (برای فیلتر کردن گزینه‌های کادر مقصد). */
  const selectedMethod = useMemo(() => methods.find((m) => m.id === methodId) ?? null, [methods, methodId])

  /** چاپ کد اعتبار از همان کانال چاپ اسناد اعتبار (بدون ساخت مسیر چاپ جدید) */
  const printIssuedCredit = async (credit: { id?: number } | null, opts?: { reprintPassword?: string }) => {
    if (creditPrinting) return
    setCreditPrinting(true)
    setCreditPrintProblem(null)
    try {
      // نشست ۳۱۶ — چاپِ اولِ صدور بدون رمز؛ چاپ دوباره ⇒ reprint:true + رمز (سرور strict می‌سنجد)
      const problem = await printOverpayCredit(
        credit,
        opts?.reprintPassword ? { reprint: true, password: opts.reprintPassword } : undefined
      )
      if (problem) {
        if (issuedCreditOpenRef.current) setCreditPrintProblem(problem)
        else {
          setErr(problem.msg)
          onChanged?.(problem.msg)
        }
      }
    } finally {
      setCreditPrinting(false)
    }
  }

  const onCreditIssued = async (credit: (OverpayCreditLike & { id?: number }) | null | undefined) => {
    if (!credit?.id) return
    issuedCreditOpenRef.current = true
    setIssuedCredit(credit)
    // مرحله ۳ بند ۴-۳۵: «اگر بله، کد اعتباری چاپ شود»
    await printIssuedCredit(credit)
  }

  /**
   * بند ۴-۵۵ — «صدور اعتبار از اضافه‌دریافت» برای اضافه‌دریافتِ *موجود* (مثلاً
   * بعد از برگشت جزئی یا پاس شدن چک). مبلغ خالی = کل مبلغ آزاد (سقف را سرور تعیین می‌کند).
   */
  const issueFromOverpay = async (managerPassword?: string) => {
    if (busy || !invoiceId) return
    setBusy(true)
    try {
      const res = await call<any>(CH.saleOverpayCredit, { invoiceId, managerPassword: managerPassword || undefined })
      setFlow(null)
        await load()
      flash(overpayCreditFlash(res, money, faDigits))
      await onCreditIssued(res)
    } catch (e: any) {
      const message = String(e.message ?? '')
      if (needsManagerPassword(message)) {
        setPwTarget('issue')
        setFlow(overpayFlowAskPassword(null, message))
      } else setErr(message)
    } finally {
      setBusy(false)
    }
  }

  const addPayment = async (req: OverpayRequest = {}) => {
    if (busy) return
    const value = Math.round(amount || 0)
    if (value <= 0) return setErr('مبلغ پرداختی باید بزرگ‌تر از صفر باشد.')
    /**
     * کار الف — مقصد پول برای پرداختیِ *دریافت‌شده* اجباری است. ثبت خودِ چک
     * مقصد نمی‌خواهد (چکِ در جریان هنوز پولی نیست و مقصدش لحظه‌ی «پاس شد»
     * پرسیده می‌شود).
     */
    if (kind === 'CASH' && !destination) {
      setDestWarn('اول مقصد پول را انتخاب کنید: این پول به کارتخوان فروشگاه آمده، نقد در صندوق، یا به حساب مدیر؟')
      return
    }
    setBusy(true)
    setDestWarn(null)
    const idempotencyKey = addPaymentRequestKey.current ?? (addPaymentRequestKey.current = newPaymentRequestKey())
    let printedPaymentId: number | null = null
    try {
      const res = await call<any>(CH.salePaymentAdd, {
        invoiceId,
        idempotencyKey,
        kind,
        amount: value,
        // نشست ۶۲ — confirmOverpay / overpayAsCredit / managerPassword فقط از ماشین حالت فلو
        ...req,
        methodId: kind === 'CASH' ? methodId : null,
        // کار الف: مقصد پول فقط برای پرداختیِ دریافت‌شده معنا دارد
        destination: kind === 'CASH' ? destination : null,
        note: note.trim() || null,
        ...paymentMomentFields({ paidAtJalali, paidAtTime, dateTouched, timeTouched }),
        chequeNo: kind === 'CHEQUE' ? chequeNo.trim() || null : null,
        bankName: kind === 'CHEQUE' ? bankName.trim() || null : null,
        dueDateJalali: kind === 'CHEQUE' ? dueDateJalali : null,
        ...lockFields()
      })
      // پاسخ commit شد؛ اقدام بعدی باید کلید تازه داشته باشد. اگر call خطا بدهد
      // این خط اجرا نمی‌شود و همان کلید برای retry امن حفظ می‌ماند.
      addPaymentRequestKey.current = null
      clearLock()
      setNote('')
      setChequeNo('')
      setBankName('')
      // مقصد هم پاک می‌شود تا برای پرداختی بعدی دوباره و آگاهانه انتخاب شود
      setDestination(null)
      setFlow(null)
        await load()
      flash(
        (kind === 'CHEQUE'
          ? `چک ${money(value)} ریال با سررسید ${faDigits(dueDateJalali)} ثبت شد (تا پاس شدن، باقی‌مانده کم نمی‌شود)`
          : `پرداختی ${faDigits(res?.payment?.seq ?? 0)} به مبلغ ${money(value)} ریال ثبت شد` +
            ` · مقصد پول: ${PAYMENT_DESTINATION_LABELS[destination ?? ''] ?? '—'}` +
            (destination === PaymentDestination.MANAGER ? ` (${MANAGER_ACCOUNT_ROW_NOTE})` : '')) +
          ` · باقی‌مانده ${money(res?.remaining ?? 0)} ریال` +
          (res?.settled ? ' · فاکتور تسویه شد ✔' : '') +
          (res?.overpayCredit?.id
            ? ` · ${overpayCreditFlash(res.overpayCredit, money, faDigits)}`
            : res?.overpayAmount > 0
              ? ` · مبلغ اضافه‌ی دریافتی: ${money(res.overpayAmount)} ریال (ردیف «دریافت پول اضافه» در گزارش فاکتور و گزارشات فروش)`
              : res?.overpaid
                ? ' · توجه: جمع پرداختی‌ها از مبلغ فاکتور بیشتر شد'
                : '')
      )
      if (res?.overpayCredit?.id) await onCreditIssued(res.overpayCredit)
      printedPaymentId = Number(res?.payment?.id ?? 0) || null
    } catch (e: any) {
      const message = String(e.message ?? '')
      // بند ۴-۳۵ مرحله ۱: همان هشدار قابل‌تایید سرور ⇒ شروع فلو
      if (isOverpayWarning(message))
        setFlow(overpayFlowStart(message, { entryKind: kind, methodKind: kind === 'CASH' ? selectedMethod?.kind ?? null : null }))
      // سقف اعتبار: همان درخواست مرحله ۳ با رمز مدیر تکرار می‌شود
      else if (needsManagerPassword(message) && req.overpayAsCredit) {
        setPwTarget('payment')
        setFlow(overpayFlowAskPassword({ step: 'submit', message: null, eligible: true, request: req }, message))
      } else {
        noteLock(message)
        setErr(message)
      }
    } finally {
      setBusy(false)
    }
    if (debtReceiptPrint && printedPaymentId) void printDebtReceipt(printedPaymentId)
  }

  const setStatus = async (
    id: number,
    status: 'PENDING' | 'CLEARED' | 'BOUNCED',
    chequeDestination: PaymentDestination | null = null
  ) => {
    if (busy) return
    const pw = (chequePw || lockPw).trim()
    if (!pw) {
      setChequeGate(true)
      const message = 'برای پاس / برگشت / در جریان کردن چک، رمز مدیر یا رمز دوم/سوم نسیه لازم است.'
      if (status === 'CLEARED') setClearWarn(message)
      else setErr(message)
      return
    }
    setBusy(true)
    try {
      const res = await call<any>(CH.saleChequeStatus, { id, status, destination: chequeDestination, managerPassword: pw, ...lockFields() })
      clearLock()
      setChequePw('')
      setChequeGate(false)
      setClearing(null)
      setClearDest(null)
      setClearWarn(null)
      await load()
      flash(
        (status === 'CLEARED'
          ? 'چک «پاس شد» علامت خورد و مبلغش به پرداختی‌های فاکتور اضافه شد' +
            ` · مقصد پول: ${PAYMENT_DESTINATION_LABELS[chequeDestination ?? ''] ?? '—'}` +
            (chequeDestination === PaymentDestination.MANAGER ? ` (${MANAGER_ACCOUNT_ROW_NOTE})` : '')
          : status === 'BOUNCED'
            ? 'چک «برگشت خورد» علامت خورد (مبلغش از پرداختی‌ها کنار گذاشته شد)'
            : 'چک به وضعیت «در جریان» برگشت (مقصد پولِ ثبت‌شده پاک شد)') +
          ` · باقی‌مانده ${money(res?.remaining ?? 0)} ریال`
      )
    } catch (e: any) {
      const message = String(e.message ?? '')
      noteLock(message)
      if (message.includes('رمز')) setChequeGate(true)
      if (status === 'CLEARED') setClearWarn(message)
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const removePayment = async (id: number) => {
    if (busy) return
    const row = (view?.payments ?? []).find((r) => r.id === id)
    const isClearedCheque = row?.kind === 'CHEQUE' && row?.chequeStatus === 'CLEARED'
    const isNonCheque = row?.kind !== 'CHEQUE'
    const pw = (chequePw || lockPw).trim()
    const why = lockReason.trim()
    if ((isClearedCheque || isNonCheque) && !pw) {
      setChequeGate(true)
      setErr(
        isClearedCheque
          ? 'برای ابطال چکِ پاس‌شده، رمز مدیر یا رمز دوم/سوم نسیه لازم است.'
          : 'برای ابطال پرداخت نقدی/کارت، رمز مدیر یا رمز دوم/سوم نسیه و دلیل لازم است.'
      )
      return
    }
    if (isNonCheque && why.length < 3) {
      setChequeGate(true)
      setErr('برای ابطال پرداخت نقدی/کارت، دلیل (حداقل ۳ نویسه) اجباری است.')
      return
    }
    setBusy(true)
    try {
      const res = await call<any>(CH.salePaymentDelete, {
        id,
        managerPassword: isClearedCheque ? pw : isNonCheque ? pw : undefined,
        overrideReason: isNonCheque ? why : undefined,
        reason: isNonCheque ? why : undefined,
        ...lockFields()
      })
      clearLock()
      setChequePw('')
      setChequeGate(false)
      setConfirmDelete(null)
      await load()
      flash(`پرداختی حذف شد · باقی‌مانده ${money(res?.remaining ?? 0)} ریال`)
    } catch (e: any) {
      const message = String(e.message ?? '')
      noteLock(message)
      if (message.includes('رمز')) setChequeGate(true)
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const rows = view?.payments ?? []
  const cheques = useMemo(() => rows.filter((r) => r.kind === 'CHEQUE'), [rows])

  return (
    <Modal
      open={open}
      title={`پرداختی‌ها / اقساط فاکتور${view ? ' شماره ' + faDigits(view.receiptNo) : ''}`}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <div className="me-auto kbd">
            {view
              ? `جمع کل ${money(view.grandTotal)} · پرداختی ${money(view.paidTotal)} · باقی‌مانده ${money(view.remaining)} ریال`
              : ''}
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>
            بستن <span className="keycap">Esc</span>
          </button>
        </>
      }
    >
      {loading && !view ? (
        <div className="kbd py-6 text-center">در حال دریافت…</div>
      ) : (
        <>
          {/* ---------- خلاصه‌ی وضعیت ---------- */}
          {view && (
            <div
              className={`rounded p-2 border-2 grid grid-cols-2 md:grid-cols-5 gap-2 ${
                view.settled ? 'bg-emerald-50 border-emerald-400' : 'bg-amber-50 border-amber-400'
              }`}
            >
              <div>
                <div className="kbd">خریدار</div>
                <div className="font-bold">{view.customerName}</div>
              </div>
              <div>
                <div className="kbd">تاریخ فاکتور</div>
                <div className="font-bold">
                  {faDigits(view.dateJalali)} <span className="kbd">{faDigits(view.time)}</span>
                </div>
              </div>
              <div>
                <div className="kbd">جمع کل فاکتور</div>
                <div className="font-bold">{money(view.grandTotal)}</div>
              </div>
              <div>
                <div className="kbd">جمع پرداختی‌ها (دریافت‌شده)</div>
                <div className="font-bold">{money(view.paidTotal)}</div>
              </div>
              {view.overpayTotal > 0 && (
                <div>
                  <div className="kbd">مبلغ اضافه‌ی دریافتی (بخش ۸)</div>
                  <div className="font-bold text-amber-800">{money(view.overpayTotal)}</div>
                  {(view.overpayCreditIssued ?? 0) > 0 && (
                    <div className="kbd">اعتبار صادرشده از آن: {money(view.overpayCreditIssued)}</div>
                  )}
                  {overpayCreditButton(view, money).show && (
                    <button className="btn mt-1" disabled={busy} onClick={() => void issueFromOverpay()}>
                      {overpayCreditButton(view, money).label}
                    </button>
                  )}
                </div>
              )}
              {view.storeCreditTotal > 0 && (
                <div>
                  <div className="kbd">اعتبار مصرف‌شده (پول نقد نیست)</div>
                  <div className="font-bold">{money(view.storeCreditTotal)}</div>
                </div>
              )}
              <div>
                <div className="kbd">باقی‌مانده</div>
                <div className={`font-bold text-base ${view.settled ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {view.settled ? 'تسویه‌شده ✔' : money(view.remaining)}
                </div>
              </div>
              <div className="col-span-2 md:col-span-5 kbd leading-6">
                وضعیت: <b>{view.settlementLabel}</b>
                {view.settledAtJalali ? ` · تاریخ تسویه: ${faDigits(view.settledAtJalali)}` : ''}
                {view.pendingChequeTotal > 0
                  ? ` · ${money(view.pendingChequeTotal)} ریال چک در جریان (پاس نشده) — با پاس شدن، باقی‌مانده ${money(
                      Math.max(0, view.remaining - view.pendingChequeTotal)
                    )} ریال می‌شود.`
                  : ''}
                {view.consolidated
                  ? ' · این فاکتور در «تجمیع و انتقال» قطعی شده است؛ ثبت پرداختی جدید همچنان ممکن است (تجمیع فقط کسر انبار را قطعی می‌کند).'
                  : ''}
              </div>
            </div>
          )}

          {/* ---------- تاریخچه‌ی پرداختی‌ها ---------- */}
          <div>
            <div className="font-bold mb-1">تاریخچه‌ی پرداختی‌ها</div>
            <div className="overflow-auto max-h-[34vh] border border-slate-200 rounded">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>نوع</th>
                    <th>مبلغ</th>
                    <th>تاریخ ثبت</th>
                    <th>ساعت</th>
                    <th>نحوه پرداخت</th>
                    <th title="کار الف — پول این ردیف کجا نشسته است؟">مقصد پول</th>
                    <th>مشخصات چک</th>
                    <th>وضعیت</th>
                    <th>اضافه دریافتی</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.isStoreCredit ? 'bg-violet-50' : r.kind === 'CHEQUE' && !r.counted ? 'bg-amber-50' : ''}>
                      <td>{faDigits(r.seq)}</td>
                      <td className="font-bold">{r.isStoreCredit ? 'اعتبار خرید' : r.kind === 'CHEQUE' ? 'چک' : 'پرداخت نقدی/کارتی'}</td>
                      <td className="font-bold">{money(r.amount)}</td>
                      <td>{faDigits(r.dateJalali)}</td>
                      <td>{faDigits(r.time)}</td>
                      {/**
                        * تسویهٔ اعتبار با صراحت دیده می‌شود، اما DTO استاندارد
                        * فقط برچسب امن سرور را دارد؛ کد قابل‌مصرف اینجا نیست.
                        */}
                      <td className={r.isStoreCredit ? 'font-bold text-violet-900' : ''}>
                        {r.isStoreCredit ? 'تسویه با اعتبار خرید' : r.methodLabel}
                      </td>
                      {/* کار الف — مقصد پول همین ردیف؛ «نامشخص» = داده‌ی قدیمی، بدون هیچ حدس */}
                      <td
                        className={
                          r.destination === PaymentDestination.MANAGER
                            ? 'text-amber-800 font-bold whitespace-normal'
                            : r.destination
                              ? 'whitespace-normal'
                              : 'text-slate-500 whitespace-normal'
                        }
                        title={r.destination === PaymentDestination.MANAGER ? MANAGER_ACCOUNT_ROW_NOTE : ''}
                      >
                        {r.kind === 'CHEQUE' && r.chequeStatus !== 'CLEARED' ? '—' : r.destinationLabel}
                      </td>
                      <td className="kbd">
                        {r.kind === 'CHEQUE'
                          ? [
                              r.dueDateJalali ? `سررسید ${faDigits(r.dueDateJalali)}` : '',
                              r.chequeNo ? `شماره ${faDigits(r.chequeNo)}` : '',
                              r.bankName || '',
                              r.dueInDays != null && r.chequeStatus === 'PENDING'
                                ? r.dueInDays >= 0
                                  ? `${faDigits(r.dueInDays)} روز تا موعد`
                                  : `${faDigits(Math.abs(r.dueInDays))} روز از موعد گذشته`
                                : ''
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : r.note || '—'}
                      </td>
                      <td className={r.counted ? 'text-emerald-700' : 'text-amber-700 font-bold'}>
                        {r.kind === 'CHEQUE' ? r.chequeStatusLabel : 'دریافت شد'}
                        {r.clearedAtJalali ? <span className="kbd"> ({faDigits(r.clearedAtJalali)})</span> : null}
                        {/* نشست ۱۶۴ · Y22 · بند ۴-۵۲ — هشدار کهربایی (نارنجی فقط برای ردیف ارجاعی است) */}
                        {r.chequeNeedsReview ? (
                          <div className="mt-1 rounded bg-amber-100 px-1 text-amber-900 font-bold whitespace-normal" title={r.chequeReviewNote ?? ''}>
                            ⚠️ نیاز به بازبینی
                            {r.chequeReviewNote ? <div className="kbd font-normal leading-5">{r.chequeReviewNote}</div> : null}
                          </div>
                        ) : null}
                      </td>
                      {/* بخش ۸: مبلغ اضافه‌ی همین پرداختی، واضح و جدا */}
                      <td className={r.overpayAmount > 0 ? 'text-amber-700 font-bold' : ''}>
                        {r.overpayAmount > 0 ? money(r.overpayAmount) : '—'}
                      </td>
                      <td className="whitespace-nowrap">
                        {r.kind === 'CHEQUE' && r.chequeStatus !== 'CLEARED' && (
                          <button
                            className="text-emerald-700 font-bold"
                            onClick={() => {
                              // کار الف: «پاس شد» بی‌واسطه ثبت نمی‌شود؛ اول مقصد پول پرسیده می‌شود
                              setClearDest(null)
                              setClearWarn(null)
                              setClearing({ id: r.id, amount: r.amount, methodKind: null })
                            }}
                            disabled={busy}
                            title="چک به بانک رفت و پاس شد؛ مبلغش به پرداختی‌های فاکتور اضافه می‌شود (اول مقصد پول پرسیده می‌شود)"
                          >
                            پاس شد
                          </button>
                        )}
                        {r.kind === 'CHEQUE' && r.chequeStatus === 'CLEARED' && (
                          <button
                            className="text-brand"
                            onClick={() => void setStatus(r.id, 'PENDING')}
                            disabled={busy}
                            title="اشتباه علامت خورده بود؛ چک به وضعیت «در جریان» برمی‌گردد"
                          >
                            برگشت به «در جریان»
                          </button>
                        )}
                        {r.kind === 'CHEQUE' && r.chequeStatus === 'PENDING' && (
                          <>
                            <span className="opacity-40 px-1">|</span>
                            <button className="text-amber-700" onClick={() => void setStatus(r.id, 'BOUNCED')} disabled={busy}>
                              برگشت خورد
                            </button>
                          </>
                        )}
                        {debtReceiptPrint && (
                          <>
                            <span className="opacity-40 px-1">|</span>
                            <button
                              className="text-brand"
                              onClick={() => void printDebtReceipt(r.id, true)}
                              disabled={receipt?.state === 'printing'}
                            >
                              چاپ فیش
                            </button>
                          </>
                        )}
                        <span className="opacity-40 px-1">|</span>
                        {confirmDelete === r.id ? (
                          <button className="text-red-600 font-bold" onClick={() => void removePayment(r.id)} disabled={busy}>
                            مطمئنم، حذف کن
                          </button>
                        ) : (
                          <button className="text-red-500" onClick={() => setConfirmDelete(r.id)} disabled={busy}>
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={11} className="text-center py-8 text-slate-400">
                        هنوز هیچ پرداختی برای این فاکتور ثبت نشده است
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!!cheques.length && (
              <div className="kbd mt-1">
                {faDigits(cheques.length)} چک روی این فاکتور ثبت شده است؛ وضعیت هر چک جداگانه کنترل می‌شود و فقط چک
                «پاس‌شده» در جمع پرداختی‌ها و در دریافتی‌های گزارش فروش شمرده می‌گردد. لحظه‌ی «پاس شد» هم پرسیده
                می‌شود پولش کجا نشسته (کارتخوان فروشگاه / نقد صندوق / حساب مدیر) و اگر چک از «پاس شد» برگردد، همان
                مقصد پاک می‌شود تا بار بعد دوباره پرسیده شود.
              </div>
            )}
          </div>

          {/* ---------- ثبت پرداختی جدید ---------- */}
          <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-2">
            <div className="font-bold">ثبت پرداختی جدید</div>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ['CASH', 'پرداخت نقدی / کارتی'],
                  ['CHEQUE', 'چک']
                ] as ['CASH' | 'CHEQUE', string][]
              ).map(([k, text]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer font-bold">
                  <input type="checkbox" className="w-4 h-4" checked={kind === k} onChange={() => setKind(k)} />
                  {text}
                </label>
              ))}
              <span className="kbd">
                {kind === 'CASH'
                  ? 'مبلغ همان لحظه به جمع پرداختی‌ها اضافه و باقی‌مانده کم می‌شود.'
                  : 'چک تا وقتی «پاس شد» علامت نخورده باشد، باقی‌مانده‌ی فاکتور را کم نمی‌کند.'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-start">
              <label>
                <div className="mb-1">مبلغ (ریال)</div>
                <input
                  type="number"
                  min={0}
                  className="inp"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Math.round(+e.target.value || 0)))}
                />
                {!!view && (
                  <div className="kbd">
                    باقی‌مانده {money(view.remaining)} ریال
                    {view.remaining > 0 && (
                      <button className="text-brand ms-2" onClick={() => setAmount(view.remaining)}>
                        کل مانده
                      </button>
                    )}
                  </div>
                )}
              </label>
              {kind === 'CASH' ? (
                <label>
                  <div className="mb-1">نحوه پرداخت</div>
                  <select
                    className="inp"
                    value={methodId ?? ''}
                    onChange={(e) => setMethodId(e.target.value ? Number(e.target.value) : null)}
                  >
                    {directPaymentMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div>
                  <div className="mb-1">سررسید (موعد) چک</div>
                  <JalaliDateInput value={dueDateJalali} onChange={setDueDateJalali} className="inp" />
                </div>
              )}
              <div>
                <div className="mb-1">تاریخ ثبت پرداختی</div>
                <JalaliDateInput
                  value={paidAtJalali}
                  onChange={(v) => {
                    setPaidAtJalali(v)
                    setDateTouched(true)
                  }}
                  className="inp"
                />
                <div className="kbd">پیش‌فرض: همین امروز</div>
              </div>
              <label>
                <div className="mb-1">ساعت دریافت پول</div>
                <input
                  className="inp text-center"
                  dir="ltr"
                  placeholder="HH:MM"
                  value={paidAtTime}
                  onChange={(e) => {
                    setPaidAtTime(e.target.value)
                    setTimeTouched(true)
                  }}
                />
                <div className="kbd">
                  پیش‌فرض: همین لحظه ·{' '}
                  <button
                    className="text-brand"
                    onClick={() => {
                      setPaidAtTime(toClock(new Date(), false))
                      setTimeTouched(false)
                    }}
                  >
                    الآن
                  </button>
                </div>
              </label>
              {kind === 'CHEQUE' ? (
                <label>
                  <div className="mb-1">شماره چک</div>
                  <input className="inp" dir="ltr" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                </label>
              ) : (
                <label>
                  <div className="mb-1">توضیح (اختیاری)</div>
                  <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
              {kind === 'CHEQUE' && (
                <label>
                  <div className="mb-1">بانک</div>
                  <input className="inp" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </label>
              )}
            </div>
            {/* ---------- کار الف: کادر اجباری «مقصد پول» ---------- */}
            {kind === 'CASH' ? (
              <PaymentDestinationBox
                value={destination}
                onChange={(d) => {
                  setDestination(d)
                  setDestWarn(null)
                }}
                methodKind={selectedMethod?.kind ?? null}
                context="PAYMENT"
                disabled={busy}
                warning={destWarn}
              />
            ) : (
              <div className="kbd rounded border border-slate-300 bg-white px-2 py-1 leading-6">
                برای ثبت خودِ چک، مقصد پول پرسیده نمی‌شود: چکِ در جریان هنوز پولی نیست. همان لحظه که «پاس شد» را
                بزنید، کادر مقصد پول باز می‌شود.
              </div>
            )}
            <button className="btn btn-primary" onClick={() => void addPayment({})} disabled={busy || !invoiceId}>
              {busy ? 'در حال ثبت…' : kind === 'CHEQUE' ? 'ثبت چک' : 'ثبت پرداختی'}
            </button>
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
          {debtReceiptPrint && receipt && (
            <div
              className={`rounded px-3 py-2 border whitespace-pre-line ${
                receipt.state === 'failed' || receipt.state === 'unknown'
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-emerald-50 border-emerald-300'
              }`}
            >
              {receipt.state === 'printing' && 'در حال چاپ فیش پرداخت…'}
              {receipt.state === 'done' && 'پرداخت ثبت شد · فیش چاپ شد'}
              {(receipt.state === 'failed' || receipt.state === 'unknown') && receipt.msg}
              <div className="mt-1 flex gap-2">
                {receipt.state === 'failed' && (
                  <button className="btn" onClick={() => void printDebtReceipt(receipt.paymentId, true)} disabled={receiptPrintingRef.current}>
                    تلاش دوباره
                  </button>
                )}
                <button className="btn" onClick={() => setReceipt(null)}>
                  بستن
                </button>
              </div>
            </div>
          )}

          {/* ---------- نشست ۱۳۶: دوره‌ی بسته — رمز مدیر و دلیل اجباری ---------- */}
          {chequeGate && !lockNeeded && (
            <div className="bg-amber-50 border-2 border-amber-400 rounded p-3 space-y-2">
              <b className="text-amber-900">تغییر پرداخت / چک رمز می‌خواهد</b>
              <div className="kbd leading-6">
                پاس شدن، برگشت خوردن یا برگشت به «در جریان» بدهی مشتری را عوض می‌کند؛ ابطال یا ویرایش مالی پرداخت نقدی/کارت
                هم همین‌طور. حتی در دوره‌ی باز رمز مدیر یا رمز دوم/سوم نسیه لازم است. رمز را بزنید و همان دکمه را دوباره
                فشار دهید.
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <PasswordField
                  className="inp w-40"
                  placeholder="رمز"
                  value={chequePw}
                  onChange={(e) => setChequePw(e.target.value)}
                  autoComplete="off"
                />
                <label className="flex-1 min-w-[240px]">
                  <div className="kbd">دلیل (برای ابطال پرداخت نقدی/کارت اجباری)</div>
                  <input className="inp" value={lockReason} onChange={(e) => setLockReason(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {lockNeeded && (
            <div className="bg-rose-50 border-2 border-rose-400 rounded p-3 space-y-2">
              <b className="text-rose-800">این پرداخت/چک به یک «دوره‌ی بسته» تعلق دارد</b>
              <div className="kbd leading-6">
                صندوق آن روز بسته شده یا روز «تجمیع و انتقال» شده است. ثبت، ویرایش مالی، ابطال پرداخت یا تغییر وضعیت چک در
                آن روز فقط با رمز مدیر و دلیل ممکن است و هر دو در سابقه‌ی تغییرات ثبت می‌شوند. بعد از پر کردن، همان دکمه را
                دوباره بزنید.
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <label>
                  <div className="kbd">رمز مدیر</div>
                  <input type="password" className="inp w-40" dir="ltr" value={lockPw} onChange={(e) => setLockPw(e.target.value)} />
                </label>
                <label className="flex-1 min-w-[240px]">
                  <div className="kbd">دلیل اصلاح در دوره‌ی بسته (اجباری)</div>
                  <input className="inp" value={lockReason} onChange={(e) => setLockReason(e.target.value)} />
                </label>
                <button className="btn" onClick={clearLock} disabled={busy}>
                  انصراف
                </button>
              </div>
            </div>
          )}

          {/* ---------- کار الف: «پاس شد» ⇒ مقصد پول (اجباری، بدون پیش‌فرض) ---------- */}
          <Modal
            open={!!clearing}
            title={`پاس شدن چک ${clearing ? money(clearing.amount) + ' ریال' : ''} — مقصد پول`}
            onClose={() => setClearing(null)}
            width="max-w-2xl"
            footer={
              <>
                <button className="btn" onClick={() => setClearing(null)} disabled={busy}>
                  انصراف <span className="keycap">Esc</span>
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    if (!clearDest) {
                      setClearWarn(
                        'مقصد پول انتخاب نشده است. این کادر عمداً پیش‌فرض ندارد: اگر اشتباه ثبت شود، هنگام بستن صندوق ' +
                          'کسری یا اضافه‌ی بی‌دلیل ساخته می‌شود.'
                      )
                      return
                    }
                    if (clearing) void setStatus(clearing.id, 'CLEARED', clearDest)
                  }}
                >
                  {busy ? 'در حال ثبت…' : 'ثبت «پاس شد»'}
                </button>
              </>
            }
          >
            <div className="leading-7">
              پول این چک کجا نشسته است؟ همین انتخاب تعیین می‌کند مبلغ چک در بستن صندوق به «نقد مورد انتظار» برود، به
              «انتظار کارتخوان»، یا به هیچ‌کدام (حساب مدیر).
            </div>
            <label className="block mt-3">
              <div className="kbd">رمز مدیر / دوم / سوم نسیه</div>
              <PasswordField
                className="inp w-full text-center"
                placeholder="رمز"
                value={chequePw}
                onChange={(e) => setChequePw(e.target.value)}
                autoComplete="off"
              />
            </label>
            <PaymentDestinationBox
              value={clearDest}
              onChange={(d) => {
                setClearDest(d)
                setClearWarn(null)
              }}
              methodKind={clearing?.methodKind ?? null}
              context="CHEQUE_CLEAR"
              disabled={busy}
              warning={clearWarn}
            />
          </Modal>

          {/* ---------- نشست ۶۲ · بند ۴-۳۵: فلوی چهارمرحله‌ای اضافه‌دریافت (جزء مشترک) ---------- */}
          <OverpayFlowDialogs
            flow={flow}
            busy={busy}
            onFlow={setFlow}
            onSubmit={(req) => void addPayment(req)}
            onPassword={pwTarget === 'issue' ? (p) => void issueFromOverpay(p) : undefined}
            issuedCredit={issuedCredit}
            onCloseIssued={() => {
              issuedCreditOpenRef.current = false
              setIssuedCredit(null)
              setCreditPrintProblem(null)
            }}
            onReprint={(pw) => void printIssuedCredit(issuedCredit, { reprintPassword: pw })}
            creditPrinting={creditPrinting}
            creditPrintProblem={creditPrintProblem}
          />
        </>
      )}
    </Modal>
  )
}
