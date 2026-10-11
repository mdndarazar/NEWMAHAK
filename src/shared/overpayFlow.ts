/**
 * ===========================================================================
 * نشست ۶۲ (نشست ۷ زنجیره‌ی رفع) · بند ۴-۳۵ و ۴-۵۵ — فلوی چهارمرحله‌ای
 * «اضافه‌دریافت» سمت صفحه، به‌صورت منطق خالص.
 *
 *   (۱) هشدار «این مبلغ بیشتر از بدهی است، ادامه بدم؟» (متن از خود سرور)
 *   (۲) اگر بله: «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟»
 *   (۳) اگر بله: همان درخواست با overpayAsCredit ⇒ کد اعتبار چاپ می‌شود
 *   (۴) اگر نه: فقط confirmOverpay ⇒ ردیف «دریافت پول اضافه» در گزارش
 *
 * چرا اینجا و نه در JSX: قاعده‌ی پروژه (سوییت‌های credit-ui-logic جلسه ۳۱ تا
 * ۳۴) «تصمیم‌ها در لایه‌ی مشترک، نه در JSX». دو صفحه (پنجره‌ی پرداخت‌ها و
 * فاکتور عمده) دقیقاً همین ماشین حالت را صدا می‌زنند تا دو فلو نشوند.
 *
 * ⚠️ این فایل عمداً هیچ import ندارد (مثل src/shared/accounting.ts) تا با Node
 * خام و بدون loader هم قابل اجرا و تست باشد. پول و تاریخ با تابع تزریقی
 * (money / faDigits) قالب می‌خورند.
 *
 * سرور مرجع نهایی است: هر مرحله دوباره سمت main سنجیده می‌شود (چک و مصرف
 * اعتبار صریح رد می‌شوند، سقف اعتبار رمز مدیر می‌خواهد، مبلغ اضافه‌ی آزاد
 * سقف دارد). این ماژول فقط تعیین می‌کند چه سؤالی و به چه ترتیب پرسیده شود.
 * ===========================================================================
 */

/** نشانه‌ی هشدار قابل‌تأیید سرور (addPayment و sale:create هر دو همین را می‌نویسند). */
export const OVERPAY_CONFIRM_MARKER = 'بله ثبت کن'

/** عبارت ثابت بند ۴-۳۲ روی هر نتیجه/رسید اعتبار. */
export const OVERPAY_NOT_CASHABLE = 'غیرقابل نقد شدن'

/** روش‌هایی که پول واقعی نیستند (همان NON_CASH_PAYMENT_KINDS در enums؛ اینجا بی‌import). */
const NON_REAL_MONEY_KINDS: readonly string[] = ['EXCHANGE_CREDIT', 'STORE_CREDIT']

export type OverpayStep = 'idle' | 'confirm' | 'askCredit' | 'password' | 'submit'
export type OverpayAnswer = 'yes' | 'no' | 'cancel'

/** بار اضافه‌ای که روی همان درخواست ثبت (addPayment یا sale:create) پخش می‌شود. */
export interface OverpayRequest {
  confirmOverpay?: true
  overpayAsCredit?: true
  managerPassword?: string
}

export interface OverpayContext {
  /** CASH (پرداخت دریافت‌شده) یا CHEQUE */
  entryKind?: string | null
  /** kind روش پرداخت (CASH | CARD | CREDIT | CUSTOM | EXCHANGE_CREDIT | STORE_CREDIT) */
  methodKind?: string | null
}

export interface OverpayFlowState {
  step: OverpayStep
  /** متن هشدار سرور (مرحله ۱) یا پیام رمز مدیر */
  message: string | null
  /** سؤال مرحله ۲ اصلاً معنا دارد؟ (پول واقعی) */
  eligible: boolean
  /** درخواستی که در مرحله‌ی submit باید فرستاده شود */
  request: OverpayRequest | null
}

const IDLE: OverpayFlowState = { step: 'idle', message: null, eligible: false, request: null }

/** خطای سرور همان هشدار قابل‌تأیید «مبلغ بیشتر از بدهی» است؟ */
export function isOverpayWarning(message: unknown): boolean {
  return String(message ?? '').includes(OVERPAY_CONFIRM_MARKER)
}

/** خطای سرور رمز مدیر می‌خواهد (سقف اعتبار) یا رمز واردشده غلط بود؟ */
export function needsManagerPassword(message: unknown): boolean {
  const m = String(message ?? '')
  return m.includes('رمز مدیر را وارد کنید') || m.includes('رمز مدیر درست نیست')
}

/**
 * سؤال مرحله ۲ فقط برای پول واقعیِ همین لحظه: چکِ پاس‌نشده پول نیست و مصرف
 * اعتبار هم پول نیست (بند ۴-۳۷)؛ برای این‌ها سرور صریح رد می‌کند، پس اصلاً
 * پرسیده نمی‌شود و «بله، ثبت کن» مستقیم مرحله ۴ است.
 */
export function overpayCreditEligible(ctx: OverpayContext): boolean {
  if (String(ctx?.entryKind ?? 'CASH').toUpperCase() === 'CHEQUE') return false
  const mk = String(ctx?.methodKind ?? '').toUpperCase()
  return !NON_REAL_MONEY_KINDS.includes(mk)
}

/** سرور هشدار اضافه‌دریافت داد ⇒ مرحله ۱. */
export function overpayFlowStart(message: string, ctx: OverpayContext): OverpayFlowState {
  return { step: 'confirm', message: String(message ?? ''), eligible: overpayCreditEligible(ctx), request: null }
}

/**
 * جواب کاربر به مرحله‌ی فعلی. `cancel` (بستن پنجره/Esc) همیشه یعنی «هیچ چیز
 * ثبت نشود» — حتی در مرحله ۲؛ «نه» در مرحله ۲ یعنی مرحله ۴ (ثبت بدون کد).
 */
export function overpayFlowNext(state: OverpayFlowState, answer: OverpayAnswer): OverpayFlowState {
  if (!state || answer === 'cancel') return { ...IDLE }
  switch (state.step) {
    case 'confirm':
      if (answer !== 'yes') return { ...IDLE }
      if (state.eligible) return { ...state, step: 'askCredit', request: null }
      return { ...state, step: 'submit', request: { confirmOverpay: true } }
    case 'askCredit':
      return {
        ...state,
        step: 'submit',
        request: answer === 'yes' ? { confirmOverpay: true, overpayAsCredit: true } : { confirmOverpay: true }
      }
    case 'password':
      return answer === 'no' ? { ...IDLE } : state
    default:
      return state
  }
}

/** سرور برای سقف اعتبار رمز مدیر خواست ⇒ همان درخواست نگه داشته و رمز پرسیده می‌شود. */
export function overpayFlowAskPassword(state: OverpayFlowState | null, message: string): OverpayFlowState {
  const request: OverpayRequest = { ...(state?.request ?? { confirmOverpay: true, overpayAsCredit: true }) }
  delete request.managerPassword
  return { step: 'password', message: String(message ?? ''), eligible: state?.eligible ?? true, request }
}

/** رمز واردشده ⇒ تکرار همان درخواست مرحله ۳ به‌علاوه‌ی managerPassword. */
export function overpayFlowPassword(state: OverpayFlowState, password: string): OverpayFlowState {
  const pass = String(password ?? '')
  const request: OverpayRequest = { ...(state?.request ?? {}) }
  if (pass) request.managerPassword = pass
  else delete request.managerPassword
  return { ...state, step: 'submit', request }
}

export interface OverpayCreditLike {
  /** فقط پاسخ‌های legacy ممکن است داشته باشند؛ UI هرگز آن را نمایش نمی‌دهد. */
  code?: string
  id?: number
  publicReference?: string
  amount: number
  expiresAtJalali?: string | null
  notice?: string | null
}

/** متن نتیجهٔ صدور بدون credential؛ خودِ برگهٔ چاپ‌شده حامل کد است. */
export function overpayCreditFlash(
  credit: OverpayCreditLike,
  money: (n: number) => string,
  faDigits: (s: string) => string
): string {
  const expiry = credit?.expiresAtJalali ? ` · مهلت تا ${faDigits(String(credit.expiresAtJalali))}` : ' · بدون انقضا'
  const reference = credit?.publicReference ?? (credit?.id ? `اعتبار #${credit.id}` : 'اعتبار خرید')
  return `${reference} به مبلغ ${money(Math.round(Number(credit?.amount) || 0))} ریال از مبلغ اضافه‌ی دریافتی صادر شد${expiry} · ${OVERPAY_NOT_CASHABLE}`
}

/** دکمه‌ی «صدور اعتبار از اضافه‌دریافت» کنار «مبلغ اضافه‌ی دریافتی» (بند ۴-۵۵). */
export function overpayCreditButton(
  view: { overpayCreditAvailable?: number | null } | null | undefined,
  money: (n: number) => string
): { show: boolean; available: number; label: string } {
  const available = Math.max(0, Math.round(Number(view?.overpayCreditAvailable) || 0))
  return {
    show: available > 0,
    available,
    label: available > 0 ? `صدور اعتبار از اضافه‌دریافت (${money(available)} ریال)` : ''
  }
}
