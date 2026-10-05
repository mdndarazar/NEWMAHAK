/**
 * ===========================================================================
 * جلسه ۴۱ — سوییت پذیرش «کار الف: مقصد پولِ چک پاس‌شده و پرداختی نسیه»
 * (فایل با همان نامی ساخته شد که پنج جلسه در HANDOFF وعده داده بود:
 *  `test/acceptance-db-session36.mjs`.)
 * ---------------------------------------------------------------------------
 * روی همان هارنس واقعی جلسه ۳۵ اجرا می‌شود: SQLite داخل خودِ Node، جدول‌ها از
 * **فایل‌های migration واقعی پروژه**، و سرویس‌های واقعی (`SalesService.ts`،
 * `CashboxService.ts`، `accountingReport.ts`). هیچ چیزی mock نشده؛ هر عددی که
 * این فایل می‌سنجد، همان عددی است که پنل می‌بیند.
 *
 * چیزی که می‌سنجد (فهرست تست پرامپت کار الف، بند به بند):
 *   ۱ مشتق شدن مقصد از روش پرداخت در لحظه‌ی فروش (نقدی/کارت/CUSTOM/صریحِ مدیر)
 *   ۲ چک ۱۰٫۰۰۰٫۰۰۰ ریالی پاس‌شده به **کارت**
 *   ۳ همان چک به **نقد**
 *   ۴ همان چک به **حساب مدیر**
 *   ۵ پرداختی نسیه با هر سه مقصد
 *   ۶ اعتبارسنجی: «پاس شد» بدون مقصد · مقصد ناسازگار با روش پرداخت
 *   ۷ برگشت از «پاس شد» ⇒ مقصد پاک شود
 *   ۸ حذف پرداختی (مقصد در AuditLog)
 *   ۹ داده‌ی قدیمیِ بی‌مقصد ⇒ برچسب «نامشخص»، بدون حدس، بدون تغییر جمع‌ها
 *  ۱۰ بعد از هر سناریو: `expectedCash` · «انتظار کارتخوان» · ردیف «حساب مدیر»
 *     · بسته بودن پل تطبیق · تفکیک چهارگانه‌ی پرداختی‌های شیفت
 *
 * هر سناریو **شیفت خودش** را دارد، پس سناریوها عدد هم را آلوده نمی‌کنند و
 * `cashboxService.expected({ shiftId })` دقیقاً همان چیزی را می‌دهد که پنل
 * بستن صندوق برای آن شیفت نشان می‌دهد.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-session36-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { salesService } = await import('../src/main/services/SalesService.ts')
const { cashboxService } = await import('../src/main/services/CashboxService.ts')
const { shiftService } = await import('../src/main/services/ShiftService.ts')
const {
  PaymentDestination,
  PAYMENT_DESTINATION_LABELS,
  PAYMENT_DESTINATION_UNKNOWN_LABEL,
  MANAGER_ACCOUNT_ROW_LABEL,
  ChequeStatus,
  AuditAction,
  paymentDestinationLabel,
  destinationReachedStore,
  allowedDestinationsFor
} = await import('@shared/enums')
const { receiptBucketOf, calculateReconciliationBridge } = await import('@shared/accounting')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

// ------------------------------------------------------------------ گزارش‌گر
let pass = 0
const failures = []
const section = (title) => console.log(`\n— ${title}`)
const ok = (name, cond, detail) => {
  if (cond) {
    pass++
    return true
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  return false
}
const eq = (name, got, want) =>
  ok(name, got === want, `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
const throwsWith = async (name, fn, needle) => {
  try {
    await fn()
    return ok(name, false, 'هیچ خطایی پرتاب نشد')
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (msg.startsWith('HARNESS:')) return ok(name, false, msg)
    return ok(name, needle ? msg.includes(needle) : true, `پیام: ${msg.split('\n')[0]}`)
  }
}

// ------------------------------------------------------------- داده‌ی پایه
const userId = seed.user('مدیر تست')
const cat = seed.category('پوشاک')
const variant = seed.variant(seed.product('شلوار مردانه', cat), 'شلوار مشکی')
sql.prepare('UPDATE "ProductVariant" SET stock = 10000 WHERE id = ?').run(variant)

/** روش‌های پرداخت واقعی پروژه — `kind` همان چیزی است که اعتبارسنجی می‌سنجد. */
const METHOD = {
  cash: seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 }),
  card: seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 }),
  bank: seed.insert('PaymentMethod', { key: 'SEPAH', label: 'بانک سپه', kind: 'CUSTOM', isActive: 1, sortOrder: 3 }),
  cheque: seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 9 })
}

const CHEQUE_AMOUNT = 10_000_000
const INVOICE_TOTAL = 20_000_000
const HOUR = 3_600_000

let shiftSeq = 0
/** یک شیفتِ بازِ مستقل برای هر سناریو (مرز عددها) */
const makeShift = (name) => {
  const openedAt = Date.now() - HOUR
  return seed.insert('Shift', {
    name,
    number: ++shiftSeq,
    dayJalali: toJalaliDate(new Date()),
    openedAt,
    userId
  })
}

/** فاکتور واقعی از مسیر واقعی `salesService.create` (نه INSERT دستی). */
const sale = (over = {}) =>
  salesService.create({
    userId,
    lines: [{ variantId: variant, qty: 1, unitPrice: INVOICE_TOTAL, discount: 0, tax: 0 }],
    payments: [],
    ...over
  })

const paymentsOf = (invoiceId) =>
  seed.rows('SELECT * FROM "Payment" WHERE invoiceId = ? ORDER BY seq', invoiceId)
const auditRows = (action, entityId) =>
  seed.rows('SELECT * FROM "AuditLog" WHERE action = ? AND entityId = ? ORDER BY id', action, entityId)

/** ثبت چک روی فاکتور (در جریان) — از مسیر واقعی. */
const addCheque = (invoiceId, amount = CHEQUE_AMOUNT) =>
  salesService.addPayment({
    invoiceId,
    kind: 'CHEQUE',
    amount,
    chequeNo: `C${invoiceId}`,
    bankName: 'ملی',
    dueDateJalali: toJalaliDate(new Date()),
    userId
  })

/**
 * همه‌ی عددهایی که یک سناریو باید با آن‌ها سنجیده شود، از **همان** مسیرهای
 * واقعیِ پنل: گزارش فروش، پیش‌نمایش بستن صندوق، و پرداختی‌های شیفت.
 */
const viewOf = async (shiftId) => {
  const report = await salesService.reportRows({ shiftId })
  const expected = await cashboxService.expected({ shiftId })
  return { report, expected, acc: report.accounting, c: expected.components }
}

// ===========================================================================
section('بند ۱ · مقصد پرداختیِ لحظه‌ی فروش از روش پرداخت مشتق می‌شود')
// ===========================================================================
{
  const shiftId = makeShift('نشست مشتق‌سازی')

  const cashSale = await sale({ shiftId, payments: [{ methodId: METHOD.cash, amount: 4_000_000 }] })
  eq('روش نقدی ⇒ مقصد CASH', paymentsOf(cashSale.id)[0].destination, PaymentDestination.CASH)

  const cardSale = await sale({ shiftId, payments: [{ methodId: METHOD.card, amount: 3_000_000 }] })
  eq('روش کارت ⇒ مقصد CARD', paymentsOf(cardSale.id)[0].destination, PaymentDestination.CARD)

  const customSale = await sale({ shiftId, payments: [{ methodId: METHOD.bank, amount: 2_000_000 }] })
  eq('روش CUSTOM ⇒ هیچ حدسی زده نمی‌شود (null)', paymentsOf(customSale.id)[0].destination, null)

  const mgrSale = await sale({
    shiftId,
    payments: [{ methodId: METHOD.bank, amount: 1_000_000, destination: PaymentDestination.MANAGER }]
  })
  eq('مقصد صریحِ «حساب مدیر» پذیرفته شد', paymentsOf(mgrSale.id)[0].destination, PaymentDestination.MANAGER)

  await throwsWith(
    'مقصد ناسازگار در لحظه‌ی فروش رد می‌شود (روش نقدی + مقصد کارت)',
    () => sale({ shiftId, payments: [{ methodId: METHOD.cash, amount: 1, destination: PaymentDestination.CARD }] }),
    'سازگار نیست'
  )

  const v = await viewOf(shiftId)
  eq('دریافتی نقد شیفت فقط سهم نقدی است', v.acc.cash.cashReceived, 4_000_000)
  eq('دریافتی کارت شیفت فقط سهم کارتی است', v.acc.cash.cardReceived, 3_000_000)
  // قاعده‌ی جلسه ۳۶: پرداختیِ *غیرچکیِ* بی‌مقصد مو‌به‌مو همان سبد قبلیِ روشش را نگه می‌دارد
  eq('پرداختیِ CUSTOM بی‌مقصد در سبد «سایر» ماند (بدون حدس)', v.acc.cash.otherReceived, 2_000_000)
  eq('و در انتظار نقد/کارت نریخت', v.expected.expectedCash + v.c.cardExpected, 4_000_000 + 3_000_000)
  eq('پرداختیِ مقصد‌مدیر در سبد خودش نشست', v.acc.cash.managerAccountReceived, 1_000_000)
  eq('«نامشخص» بی‌صدا در کارت جمع نشد', v.report.totals.cardTotal, 3_000_000)
  eq('ردیفِ «حساب مدیر» در جمع کارت نیامد', v.report.totals.managerAccountTotal, 1_000_000)
  eq('«سایر» ردیف جدای خودش را دارد', v.report.totals.otherTotal, 2_000_000)
  eq(
    'دریافتیِ فروشگاه، پولِ حساب مدیر را نمی‌شمارد',
    v.report.totals.receivedTotal,
    4_000_000 + 3_000_000 + 2_000_000
  )
  eq('نقد مورد انتظار = فقط نقد فیزیکی', v.expected.expectedCash, 4_000_000)
  eq('انتظار کارتخوان = فقط کارت', v.c.cardExpected, 3_000_000)
  eq('ردیف «حساب مدیر» در بستن صندوق دیده می‌شود', v.expected.managerAccountReceived, 1_000_000)
  eq('پولِ حساب مدیر در کسری/اضافی صندوق اثر ندارد', v.expected.cashDifference, -4_000_000)
}

// ===========================================================================
section('بند ۲ · چک ۱۰٫۰۰۰٫۰۰۰ ریالی پاس‌شده به «کارت» ⇒ رد (نشست ۱۵۹، S159-D2، بند ۴-۱۲)')
// ===========================================================================
/**
 * نشست ۱۵۹ (S159-D2): جلسه‌ی ۳۶ «پاس به کارت» را مجاز می‌دانست؛ بند ۴-۱۲ مالک (و رفع نشست ۱۱۳)
 * مقصد چک را فقط «حساب مدیر/بانک» می‌داند. این بخش حالا رد و دست‌نخوردن همه‌ی عددها را می‌سنجد.
 */
{
  const shiftId = makeShift('نشست چک به کارت')
  const inv = await sale({ shiftId })
  const cheque = await addCheque(inv.id)
  eq('چکِ تازه مقصد ندارد (هنوز پولی نیست)', paymentsOf(inv.id)[0].destination, null)

  const before = await viewOf(shiftId)
  eq('چکِ در جریان در دریافتی‌ها شمرده نمی‌شود', before.acc.cash.cashReceived, 0)
  eq('چکِ در جریان در انتظار کارتخوان هم نیست', before.c.cardExpected, 0)

  await throwsWith(
    'پاس‌کردن چک با مقصد «کارت» رد شد (بند ۴-۱۲)',
    () => salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.CLEARED, destination: PaymentDestination.CARD, userId }),
    PAYMENT_DESTINATION_LABELS.MANAGER
  )
  const row = paymentsOf(inv.id)[0]
  eq('چک همچنان «در جریان» ماند', row.chequeStatus, ChequeStatus.PENDING)
  eq('مقصدی روی رکورد ننشست', row.destination, null)
  const v = await viewOf(shiftId)
  eq('انتظار کارتخوان دست‌نخورده', v.c.cardExpected, 0)
  eq('نقد مورد انتظار دست‌نخورده', v.expected.expectedCash, 0)
  eq('کل چکِ پاس‌شده‌ی بازه صفر', v.acc.cheques.cleared, 0)
}

// ===========================================================================
section('بند ۳ · همان چک پاس‌شده به «نقد» ⇒ رد (نشست ۱۵۹، S159-D2، بند ۴-۱۲)')
// ===========================================================================
{
  const shiftId = makeShift('نشست چک به نقد')
  const inv = await sale({ shiftId })
  const cheque = await addCheque(inv.id)
  await throwsWith(
    'پاس‌کردن چک با مقصد «نقد» رد شد (بند ۴-۱۲)',
    () => salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.CLEARED, destination: PaymentDestination.CASH, userId }),
    PAYMENT_DESTINATION_LABELS.MANAGER
  )
  const v = await viewOf(shiftId)
  eq('در سبد چکِ نقدی چیزی ننشست', v.acc.cheques.clearedToCash, 0)
  eq('نقد مورد انتظار دست‌نخورده', v.expected.expectedCash, 0)
  eq('کسری صندوق ساخته نشد', v.expected.cashDifference, 0)
  eq('چک همچنان «در جریان»', paymentsOf(inv.id)[0].chequeStatus, ChequeStatus.PENDING)
}

// ===========================================================================
section('بند ۴ · همان چک پاس‌شده به «حساب مدیر»')
// ===========================================================================
{
  const shiftId = makeShift('نشست چک به حساب مدیر')
  const inv = await sale({ shiftId })
  const cheque = await addCheque(inv.id)
  const res = await salesService.setChequeStatus({
    id: cheque.payment.id,
    status: ChequeStatus.CLEARED,
    destination: PaymentDestination.MANAGER,
    userId
  })

  eq('بدهی مشتری کم شد (مشتری واقعاً پرداخته)', res.paidTotal, CHEQUE_AMOUNT)
  const v = await viewOf(shiftId)
  eq('چک در سبد حساب مدیر نشست', v.acc.cheques.clearedToManager, CHEQUE_AMOUNT)
  eq('نقد مورد انتظار دست‌نخورده', v.expected.expectedCash, 0)
  eq('انتظار کارتخوان دست‌نخورده', v.c.cardExpected, 0)
  eq('ردیف جدای «حساب مدیر» مبلغ را نشان می‌دهد', v.expected.managerAccountReceived, CHEQUE_AMOUNT)
  eq('چکِ حساب مدیر ردیف توضیح‌دار خودش را دارد', v.c.clearedManagerCheques, CHEQUE_AMOUNT)
  eq('در کسری/اضافی صندوق اثر ندارد', v.expected.cashDifference, 0)
  eq('در «دریافتی فروشگاه» نیامد', v.report.totals.receivedTotal, 0)
  eq('ردیف «دریافتی به حساب مدیر» گزارش فروش پر شد', v.report.totals.managerAccountTotal, CHEQUE_AMOUNT)
  ok('برچسب ردیف همان متن توضیحی مالک است', MANAGER_ACCOUNT_ROW_LABEL.includes('حساب مدیر'), MANAGER_ACCOUNT_ROW_LABEL)

  // پل تطبیق باید *با* این ردیف بسته بماند (وگرنه گزارش «بی‌توضیح» هشدار می‌دهد)
  const bridge = v.acc.bridge
  ok('پل تطبیق ردیف «دریافتی به حساب مدیر» را دارد', bridge.rows.some((r) => r.key === 'managerAccountReceived'))
  eq(
    'مبلغ ردیف پل تطبیق = همان چکِ حساب مدیر',
    bridge.rows.find((r) => r.key === 'managerAccountReceived')?.amount,
    CHEQUE_AMOUNT
  )
  eq('پل تطبیق بسته است (هیچ مبلغ بی‌توضیحی نماند)', bridge.unexplained, 0)
  ok('پل تطبیق balanced', bridge.balanced === true, JSON.stringify({ target: bridge.target, explained: bridge.explainedTotal }))
}

// ===========================================================================
section('بند ۵ · پرداختی نسیه با هر سه مقصد')
// ===========================================================================
{
  const shiftId = makeShift('نشست پرداختی نسیه')
  const inv = await sale({ shiftId })

  const p1 = await salesService.addPayment({
    invoiceId: inv.id,
    methodId: METHOD.card,
    amount: 5_000_000,
    destination: PaymentDestination.CARD,
    userId
  })
  const p2 = await salesService.addPayment({
    invoiceId: inv.id,
    methodId: METHOD.cash,
    amount: 4_000_000,
    destination: PaymentDestination.CASH,
    userId
  })
  const p3 = await salesService.addPayment({
    invoiceId: inv.id,
    methodId: METHOD.bank,
    amount: 3_000_000,
    destination: PaymentDestination.MANAGER,
    userId
  })

  const rows = paymentsOf(inv.id)
  eq('پرداختی کارتی مقصدش ثبت شد', rows[0].destination, PaymentDestination.CARD)
  eq('پرداختی نقدی مقصدش ثبت شد', rows[1].destination, PaymentDestination.CASH)
  eq('پرداختی حساب مدیر مقصدش ثبت شد', rows[2].destination, PaymentDestination.MANAGER)
  eq('هر سه پرداختی بدهی را کم کردند', p3.paidTotal, 12_000_000)
  eq('باقی‌ماندهٔ بدهی درست است', p3.remaining, INVOICE_TOTAL - 12_000_000)

  const v = await viewOf(shiftId)
  eq('دریافتی نقد = فقط مقصد نقد', v.acc.cash.cashReceived, 4_000_000)
  eq('دریافتی کارت = فقط مقصد کارت', v.acc.cash.cardReceived, 5_000_000)
  eq('دریافتی حساب مدیر جدا شمرده شد', v.acc.cash.managerAccountReceived, 3_000_000)
  eq('نقد مورد انتظار', v.expected.expectedCash, 4_000_000)
  eq('انتظار کارتخوان', v.c.cardExpected, 5_000_000)
  eq('ردیف حساب مدیر در بستن صندوق', v.expected.managerAccountReceived, 3_000_000)
  eq('پل تطبیق بسته ماند', v.acc.bridge.unexplained, 0)

  // ردیف نمایشی پنجره‌ی اقساط: برچسب و «به فروشگاه رسید؟»
  const view = await salesService.payments({ invoiceId: inv.id })
  const viewRows = view.rows ?? view.payments ?? []
  const byId = new Map(viewRows.map((r) => [r.id, r]))
  eq('برچسب فارسی مقصد کارت', byId.get(p1.payment.id).destinationLabel, PAYMENT_DESTINATION_LABELS.CARD)
  eq('پرداختی کارتی به فروشگاه رسیده', byId.get(p1.payment.id).reachedStore, true)
  eq('پرداختی حساب مدیر به فروشگاه نرسیده', byId.get(p3.payment.id).reachedStore, false)
  eq('برچسب فارسی حساب مدیر', byId.get(p3.payment.id).destinationLabel, PAYMENT_DESTINATION_LABELS.MANAGER)
  const log = auditRows(AuditAction.SALE_PAYMENT_ADD, p3.payment.id)
  ok('مقصد پرداختی در AuditLog ثبت شد', /حساب مدیر/.test(log.at(-1)?.note ?? ''), log.at(-1)?.note)
}

// ===========================================================================
section('بند ۶ · اعتبارسنجی: مقصد اجباری و سازگار')
// ===========================================================================
{
  const shiftId = makeShift('نشست اعتبارسنجی')
  const inv = await sale({ shiftId })
  const cheque = await addCheque(inv.id)

  await throwsWith(
    '«پاس شد» بدون مقصد رد می‌شود',
    () => salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.CLEARED, userId }),
    'مقصد پول را انتخاب کنید'
  )
  await throwsWith(
    'مقصد خالی («») هم رد می‌شود (پیش‌فرض ساخته نمی‌شود)',
    () => salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.CLEARED, destination: '', userId }),
    'مقصد پول را انتخاب کنید'
  )
  await throwsWith(
    'مقصد بی‌معنا رد می‌شود',
    () =>
      salesService.setChequeStatus({
        id: cheque.payment.id,
        status: ChequeStatus.CLEARED,
        destination: 'POCKET',
        userId
      }),
    'مقصد پول را انتخاب کنید'
  )
  eq('چک پس از رد شدن، هنوز در جریان است', paymentsOf(inv.id)[0].chequeStatus, ChequeStatus.PENDING)
  eq('و هیچ مقصدی روی آن ننشست', paymentsOf(inv.id)[0].destination, null)

  await throwsWith(
    'پرداختی بدون مقصد رد می‌شود',
    () => salesService.addPayment({ invoiceId: inv.id, methodId: METHOD.cash, amount: 1_000_000, userId }),
    'مقصد پول را انتخاب کنید'
  )
  await throwsWith(
    'روش نقدی با مقصد کارت رد می‌شود',
    () =>
      salesService.addPayment({
        invoiceId: inv.id,
        methodId: METHOD.cash,
        amount: 1_000_000,
        destination: PaymentDestination.CARD,
        userId
      }),
    'سازگار نیست'
  )
  await throwsWith(
    'روش کارت با مقصد نقد رد می‌شود',
    () =>
      salesService.addPayment({
        invoiceId: inv.id,
        methodId: METHOD.card,
        amount: 1_000_000,
        destination: PaymentDestination.CASH,
        userId
      }),
    'سازگار نیست'
  )
  eq('هیچ‌کدام از تلاش‌های ردشده ردیفی نساختند', paymentsOf(inv.id).length, 1)

  // قاعده‌ی «یک منبع حقیقت» در سطح تابع خالص هم سنجیده می‌شود
  // نشست ۱۵۹ (S159-D2): بند ۴-۱۳ ⇒ نقد فقط کشو؛ بند ۴-۱۲ + رفع ۱۱۳ ⇒ چک با مقصد نقد/کارت سبد «نامشخص»
  eq('روش نقدی فقط «نقد در صندوق» را می‌پذیرد (بند ۴-۱۳)', allowedDestinationsFor('CASH').join(','), 'CASH')
  eq('روش کارت فقط کارت یا حساب مدیر را می‌پذیرد', allowedDestinationsFor('CARD').join(','), 'CARD,MANAGER')
  eq('روش CUSTOM (چک) هر سه را می‌پذیرد', allowedDestinationsFor('CUSTOM').length, 3)
  eq('چکِ قدیمی با مقصد نقد ⇒ «نامشخص» (نه نقد کشو)', receiptBucketOf({ isCheque: true, destination: 'CASH', methodKind: 'CUSTOM' }), 'unknown')
  eq('چکِ قدیمی با مقصد کارت ⇒ «نامشخص» (نه کارتخوان)', receiptBucketOf({ isCheque: true, destination: 'CARD', methodKind: 'CUSTOM' }), 'unknown')
  eq(
    'سبدبندی حساب مدیر',
    receiptBucketOf({ isCheque: true, destination: 'MANAGER', methodKind: 'CUSTOM' }),
    'managerAccount'
  )
  ok(
    'چکِ بی‌مقصد دیگر در سبد «کارت» نمی‌افتد',
    receiptBucketOf({ isCheque: true, destination: null, methodKind: 'CUSTOM' }) !== 'card',
    receiptBucketOf({ isCheque: true, destination: null, methodKind: 'CUSTOM' })
  )
}

// ===========================================================================
section('بند ۷ · برگشت از «پاس شد» مقصد را پاک می‌کند')
// ===========================================================================
// نشست ۱۵۹ (S159-D2): مقصد مجاز چک فقط «حساب مدیر» است؛ همان سناریو با مقصد مدیر.
{
  const shiftId = makeShift('نشست برگشت از پاس شد')
  const inv = await sale({ shiftId })
  const cheque = await addCheque(inv.id)
  await salesService.setChequeStatus({
    id: cheque.payment.id,
    status: ChequeStatus.CLEARED,
    destination: PaymentDestination.MANAGER,
    userId
  })
  eq('اول مقصد حساب مدیر ثبت شد', paymentsOf(inv.id)[0].destination, PaymentDestination.MANAGER)

  const back = await salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.PENDING, userId })
  eq('برگشت به «در جریان» مقصد را پاک کرد', paymentsOf(inv.id)[0].destination, null)
  eq('و تاریخ پاس شدن هم پاک شد', paymentsOf(inv.id)[0].clearedAt, null)
  eq('خروجی سرویس هم مقصد null می‌دهد', back.destination, null)
  const v1 = await viewOf(shiftId)
  eq('ردیف حساب مدیر به صفر برگشت', v1.expected.managerAccountReceived, 0)
  eq('هیچ سبد چکی پر نماند', v1.acc.cheques.clearedToManager + v1.acc.cheques.clearedUnknown, 0)

  await throwsWith(
    'بار بعد که پاس شود، مقصد دوباره پرسیده می‌شود',
    () => salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.CLEARED, userId }),
    'مقصد پول را انتخاب کنید'
  )
  await salesService.setChequeStatus({
    id: cheque.payment.id,
    status: ChequeStatus.CLEARED,
    destination: PaymentDestination.MANAGER,
    userId
  })
  const v2 = await viewOf(shiftId)
  eq('پاس دوباره فقط یک‌بار شمرده شد', v2.expected.managerAccountReceived, CHEQUE_AMOUNT)
  eq('نقد و کارتخوان دست‌نخورده', v2.expected.expectedCash + v2.c.cardExpected, 0)

  // «برگشت خورد» هم مقصد را پاک می‌کند
  await salesService.setChequeStatus({ id: cheque.payment.id, status: ChequeStatus.BOUNCED, userId })
  eq('برگشت‌خوردن چک مقصد را پاک کرد', paymentsOf(inv.id)[0].destination, null)
  const v3 = await viewOf(shiftId)
  eq('چکِ برگشت‌خورده در ردیف حساب مدیر نمی‌ماند', v3.expected.managerAccountReceived, 0)
}

// ===========================================================================
section('بند ۸ · حذف پرداختی')
// ===========================================================================
{
  const shiftId = makeShift('نشست حذف پرداختی')
  const inv = await sale({ shiftId })
  const p = await salesService.addPayment({
    invoiceId: inv.id,
    methodId: METHOD.bank,
    amount: 6_000_000,
    destination: PaymentDestination.MANAGER,
    userId
  })
  const before = await viewOf(shiftId)
  eq('قبل از حذف، ردیف حساب مدیر پر است', before.expected.managerAccountReceived, 6_000_000)

  const del = await salesService.deletePayment({ id: p.payment.id, userId, reason: 'ثبت اشتباه پرداخت' })
  eq('ردیف پرداختی برای حسابرسی ماند و باطل شد', paymentsOf(inv.id).length, 1)
  eq('مهر ابطال روی ردیف ماند', seed.one('SELECT voidedAt FROM "Payment" WHERE id = ?', p.payment.id)?.voidedAt != null, true)
  eq('بدهی مشتری برگشت', del.remaining, INVOICE_TOTAL)
  const after = await viewOf(shiftId)
  eq('ردیف حساب مدیر صفر شد', after.expected.managerAccountReceived, 0)
  eq('نقد مورد انتظار دست‌نخورده ماند', after.expected.expectedCash, 0)
  const log = auditRows(AuditAction.SALE_PAYMENT_DELETE, p.payment.id)
  ok('مقصدِ پاک‌شده در AuditLog ثبت شد', log.length > 0 && /حساب مدیر/.test(log.at(-1)?.note ?? log.at(-1)?.before ?? ''), log.at(-1)?.note)
}

// ===========================================================================
section('بند ۹ · داده‌ی قدیمی بی‌مقصد ⇒ «نامشخص» و بدون هیچ حدس')
// ===========================================================================
{
  const shiftId = makeShift('نشست داده‌ی قدیمی')
  const inv = await sale({ shiftId })
  const now = Date.now()
  /**
   * شبیه‌سازی داده‌ی *قبل از* migration: یک چکِ پاس‌شده و یک پرداختی نقدی که
   * ستون `destination` آن‌ها NULL است (migration هیچ UPDATE ی نداشت، پس این
   * دقیقاً وضعیت رکوردهای واقعیِ قدیمی است).
   */
  const legacyCheque = seed.insert('Payment', {
    invoiceId: inv.id,
    methodId: METHOD.cheque,
    amount: CHEQUE_AMOUNT,
    kind: 'CHEQUE',
    seq: 1,
    chequeStatus: ChequeStatus.CLEARED,
    paidAt: now,
    paidAtJalali: toJalaliDate(new Date(now)),
    clearedAt: now,
    clearedAtJalali: toJalaliDate(new Date(now)),
    destination: null,
    // نشست ۱۵۹ (S159-D2): از نشست ۶۷/۶۸ پرداخت به شیفتِ ثبت نسبت داده می‌شود (بند ۴-۲)؛ داده‌ی قدیمی هم شیفت ثبت دارد
    createdShiftId: shiftId,
    clearedShiftId: shiftId
  })
  const legacyCash = seed.insert('Payment', {
    invoiceId: inv.id,
    methodId: METHOD.cash,
    amount: 2_000_000,
    kind: 'CASH',
    seq: 2,
    paidAt: now,
    paidAtJalali: toJalaliDate(new Date(now)),
    destination: null,
    createdShiftId: shiftId
  })

  eq('هیچ مقصدی برای داده‌ی قدیمی حدس زده نشد', seed.one('SELECT destination FROM "Payment" WHERE id = ?', legacyCheque).destination, null)
  eq('برچسب نمایشی «نامشخص» است', paymentDestinationLabel(null), PAYMENT_DESTINATION_UNKNOWN_LABEL)
  eq('«نامشخص» به‌عنوان «رسیده به فروشگاه» علامت نمی‌خورد', destinationReachedStore(null), false)

  const v = await viewOf(shiftId)
  eq('چکِ پاس‌شده‌ی قدیمی در سبد «نامشخص» نشست', v.acc.cheques.clearedUnknown, CHEQUE_AMOUNT)
  eq('و در سبد کارت نیفتاد (باگ اصلی)', v.acc.cheques.clearedToCard, 0)
  eq('انتظار کارتخوان از داده‌ی قدیمی بالا نرفت', v.c.cardExpected, 0)
  /**
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — قاعده‌ی قدیمی «چکِ نامشخص در انتظار نقد می‌ماند» کنار رفت:
   * سبد «نامشخص» هرگز با نقد جمع زده نمی‌شود؛ فقط نقدِ قدیمی در انتظار نقد است و چکِ نامشخص در
   * سبد جدای unknownDestinationOutside (بیرون از expectedCash) با هشدار صریح.
   */
  eq(
    'بند ۴-۲۴: فقط نقدِ قدیمی در انتظار نقد است؛ چکِ نامشخص نه',
    v.expected.expectedCash,
    2_000_000
  )
  eq('سهم «نامشخص» داخل انتظار نقد همیشه صفر', v.expected.unknownDestinationInExpected, 0)
  /**
   * 🔴 به‌روزرسانی نشست ۱۸۵ · بند ۴-۲۴ (تصمیم مالک) — دو انتظار زیر عوض شدند.
   *
   * تا امروز مقصدِ خالی از روی *روشِ* پرداخت حدس زده می‌شد (روش نقد ⇒ سبد
   * نقد). بند ۴-۲۴ می‌گوید «هرگز حدس زده یا جمع زده نشود»، پس حالا سبد
   * رسمی‌اش «نامشخص» است.
   *
   * ولی صرفِ «نامشخص» کردن، `expectedCash` شیفت‌های قدیمی را پایین می‌آورد و
   * **کسری دروغ** می‌ساخت. راه‌حل مالک هر دو را با هم حل کرد: عدد در سبد
   * نامشخص دیده می‌شود، و یک ستون کمکی «احتمالاً نقد» همان مبلغ را در نقد
   * مورد انتظار نگه می‌دارد. پس:
   *   • `cash.cashReceived` دیگر شامل این مبلغ نیست (صداقت)،
   *   • `expected.expectedCash` همچنان شاملش هست (بدون کسری دروغ).
   */
  eq('پرداختیِ نقدیِ قدیمی دیگر حدسی «نقد» شمرده نمی‌شود', v.acc.cash.cashReceived, 0)
  eq('و به سبد «نامشخص» رفت', v.acc.cash.destinationUnknownReceived, 2_000_000 + CHEQUE_AMOUNT)
  eq('ولی در ستون کمکی «احتمالاً نقد» دیده می‌شود', v.acc.cash.unknownLikelyCash, 2_000_000)
  eq('سهم «نامشخص» جدا و بیرون از انتظار نقد قابل خواندن است', v.expected.unknownDestinationOutside, CHEQUE_AMOUNT)
  ok(
    'ردیف «نامشخص» در اجزای صندوق جداست',
    v.c.clearedUnknownCheques === CHEQUE_AMOUNT && v.c.clearedCashCheques === 0,
    JSON.stringify({ unknown: v.c.clearedUnknownCheques, cash: v.c.clearedCashCheques })
  )
  // «نامشخص» فقط چکِ پاس‌شده‌ی بی‌مقصد است؛ پرداختیِ نقدیِ قدیمی همان سبد نقد را نگه داشت
  // نشست ۱۸۵: حالا هم چکِ بی‌مقصد و هم پرداختِ بی‌مقصد در این سبد می‌نشینند.
  eq('سبد «نامشخص» شامل چک و پرداختِ بی‌مقصد است', v.acc.cash.destinationUnknownReceived, 2_000_000 + CHEQUE_AMOUNT)
  const view = await salesService.payments({ invoiceId: inv.id })
  const viewRows = view.rows ?? view.payments ?? []
  const legacyRow = viewRows.find((r) => r.id === legacyCash)
  eq('ردیف پنجره‌ی اقساط برچسب «نامشخص» می‌گیرد', legacyRow.destinationLabel, PAYMENT_DESTINATION_UNKNOWN_LABEL)
  eq('و مقصدش null می‌ماند', legacyRow.destination, null)
}

// ===========================================================================
section('بند ۱۰ · بستن صندوقِ واقعی: ستون‌ها و snapshot')
// ===========================================================================
{
  const shiftId = makeShift('نشست بستن صندوق')
  const inv = await sale({ shiftId, payments: [{ methodId: METHOD.cash, amount: 5_000_000 }] })
  const cheque = await addCheque(inv.id)
  await salesService.setChequeStatus({
    id: cheque.payment.id,
    status: ChequeStatus.CLEARED,
    destination: PaymentDestination.MANAGER,
    userId
  })
  await salesService.addPayment({
    invoiceId: inv.id,
    methodId: METHOD.card,
    amount: 2_000_000,
    destination: PaymentDestination.CARD,
    userId
  })

  const preview = await cashboxService.expected({ shiftId, countedCash: 5_000_000 })
  const closed = await cashboxService.close({
    shiftId,
    explicitShift: true,
    countedCash: 5_000_000,
    userId,
    note: 'تست کار الف'
  })

  eq('پیش‌نمایش و ثبت نهایی یک عدد می‌دهند', closed.cashClose.expectedCash, preview.expectedCash)
  eq('انتظار نقد فقط نقد فیزیکی است', closed.cashClose.expectedCash, 5_000_000)
  eq('تطبیق کامل شد (چکِ حساب مدیر کسری نساخت)', closed.cashClose.cashDifference, 0)
  eq('وضعیت صندوق: تطبیق', closed.cashClose.state, 'MATCHED')
  eq('ردیف حساب مدیر در نتیجه‌ی بستن صندوق', closed.cashClose.managerAccountReceived, CHEQUE_AMOUNT)
  eq('انتظار کارتخوان در اجزای ثبت‌شده', closed.cashClose.components.cardExpected, 2_000_000)
  eq('ستون حساب مدیر در رکورد CashSession نوشته شد', closed.session.managerAccountReceived, CHEQUE_AMOUNT)
  eq('ستون «نامشخص» رکورد صفر است (داده‌ی تازه)', closed.session.destinationUnknownReceived, 0)
  eq('ستون کارت رکورد، «سایر» را قاطی نکرد', closed.session.cardTotal, 2_000_000)
  const snap = JSON.parse(closed.session.accountingSnapshotJson)
  eq('snapshot تفکیک مقصد چک را نگه داشت', snap.cheques.clearedToManager, CHEQUE_AMOUNT)
  eq('snapshot دریافتیِ حساب مدیر را نگه داشت', snap.cash.managerAccountReceived, CHEQUE_AMOUNT)

  const info = await shiftService.info(shiftId)
  eq('جزئیات شیفت: کارت بدون «سایر»', info.cardTotal, 2_000_000)
  eq('جزئیات شیفت: ردیف حساب مدیر', info.managerAccountTotal, CHEQUE_AMOUNT)
  eq('جزئیات شیفت: ردیف نامشخص', info.destinationUnknownTotal, 0)

  // پل تطبیق با ردیف حساب مدیر بسته می‌ماند
  const bridge = closed.accounting.bridge
  eq('پل تطبیق بسته است', bridge.unexplained, 0)
  eq(
    'ردیف حساب مدیرِ پل = چکِ مقصد‌مدیر',
    bridge.rows.find((r) => r.key === 'managerAccountReceived')?.amount,
    CHEQUE_AMOUNT
  )
  // و همان فرمول در تابع خالص هم بسته می‌شود (یک منبع حقیقت)
  const pure = calculateReconciliationBridge({
    realCash: bridge.rows.find((r) => r.key === 'realCash')?.amount ?? 0,
    managerAccountReceived: CHEQUE_AMOUNT,
    storeCreditIssued: bridge.rows.find((r) => r.key === 'storeCreditIssued')?.amount ?? 0,
    priorCreditSettlements: bridge.rows.find((r) => r.key === 'priorCreditSettlements')?.amount ?? 0,
    priorClearedCheques: bridge.rows.find((r) => r.key === 'priorClearedCheques')?.amount ?? 0,
    storeCreditUsed: bridge.rows.find((r) => r.key === 'storeCreditUsed')?.amount ?? 0,
    uncollectedCredit: bridge.rows.find((r) => r.key === 'uncollectedCredit')?.amount ?? 0,
    debtOnlyReturns: bridge.rows.find((r) => r.key === 'debtOnlyReturns')?.amount ?? 0,
    netAccrualSales: bridge.target
  })
  eq('تابع خالص پل تطبیق همان عدد را می‌دهد', pure.explainedTotal, bridge.explainedTotal)
}

// --------------------------------------------------------------------- پایان
console.log(`\nسوییت کار الف (مقصد پول · جلسه ۳۶/۴۱): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) {
  console.log('\nناموفق‌ها:')
  for (const f of failures) console.log(`  • ${f}`)
}
console.log(`دیتابیس تست: ${process.env.HARNESS_DB}`)
process.exit(failures.length ? 1 : 0)
