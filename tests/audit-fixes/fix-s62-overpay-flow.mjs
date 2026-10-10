/**
 * ===========================================================================
 * نشست ۷ زنجیره رفع (نشست ۶۲) — خوشه C: فلوی اضافه‌دریافت، بخش باقی‌مانده
 *
 *   ۴-۳۵ — «چه در فروش معمولی، چه بعد از برگشت جزئی» فلوی یکسان چهارمرحله‌ای؛
 *          اضافه‌دریافت بی‌صدا کاملاً ممنوع. نشست ۶۱ فقط addPayment را بست؛
 *          sale:create (فاکتور عمده با «مبلغ دریافتی» بیشتر از جمع) هنوز بی‌صدا
 *          ۱٬۳۰۰ روی فاکتور ۱٬۰۰۰ ثبت می‌کرد با overpayAmount = ۰ (پل باز).
 *   ۴-۳۲ — «غیرقابل نقد شدن» روی رسید اعتبار (سند چاپی) همیشه.
 *   UI    — دیالوگ دوم «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟»، چاپ کد،
 *          دکمه‌ی «صدور اعتبار از اضافه‌دریافت»؛ تصمیم‌ها در لایه‌ی مشترک
 *          (@shared/overpayFlow)، نه در JSX.
 *   ریسک  — رمز مدیر (سقف اعتبار) داخل تراکنش باز روی AuthLockout می‌نوشت
 *          (بن‌بست شناخته‌شده‌ی SQLite)؛ حالا قبل از تراکنش سنجیده می‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s62-overpay-flow.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s62-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const ROOT = new URL('../../', import.meta.url).pathname
const src = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const truthy = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} ${extra}`) }
}
const throwsWith = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

const PW = DEFAULT_MANAGER_PASSWORD
const userId = seed.user('مدیر تست نشست ۶۲')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار جین', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const invoiceCount = () => Number(seed.one('SELECT COUNT(*) AS c FROM "SaleInvoice"').c)
const paymentCount = () => Number(seed.one('SELECT COUNT(*) AS c FROM "Payment"').c)
const creditCount = () => Number(seed.one('SELECT COUNT(*) AS c FROM "StoreCredit"').c)
const payRows = (invoiceId) => seed.rows('SELECT id, amount, overpayAmount FROM "Payment" WHERE invoiceId = ? ORDER BY seq, id', invoiceId)
const overpaySum = (invoiceId) => payRows(invoiceId).reduce((s, p) => s + Number(p.overpayAmount ?? 0), 0)
const creditsOf = (invoiceId) => seed.rows('SELECT * FROM "StoreCredit" WHERE sourceInvoiceId = ? ORDER BY id', invoiceId)
/** فاکتور یک‌قلمی ۱٬۰۰۰ با «مبلغ دریافتی» دلخواه (مسیر sale:create) */
const sale = (paid, extra = {}, methodId = cash) => {
  const v = variant(1000)
  return salesService.create({
    userId, shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
    payments: paid > 0 ? [{ methodId, amount: paid }] : [],
    ...extra
  })
}
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  }, { withDrillDown: true })
  return statements
}
const rowsOf = (s) => Object.fromEntries(s.bridge.rows.map((r) => [r.key, r.sign * r.amount]))
const closed = (s, label = 'پل تطبیق بسته است (مانده‌ی بی‌توضیح)') => eq(label, s?.bridge?.unexplained, 0)

// ---------------------------------------------------------------------------
console.log('\n۱) sale:create — «مبلغ دریافتی» ۱٬۳۰۰ روی فاکتور ۱٬۰۰۰ بدون تأیید (مرحله ۱: هشدار، نه ثبت بی‌صدا)')
const inv0 = invoiceCount(), pay0 = paymentCount()
await throwsWith('ثبت بدون confirmOverpay رد می‌شود با همان هشدار قابل‌تأیید', () => sale(1300), 'بله ثبت کن')
eq('هیچ فاکتوری ثبت نشد', invoiceCount(), inv0)
eq('هیچ پرداختی ثبت نشد', paymentCount(), pay0)
await throwsWith('هشدار عدد دقیق اضافه (۳۰۰) را می‌گوید', () => sale(1300), '۳۰۰')

// ---------------------------------------------------------------------------
console.log('\n۲) sale:create با «بله، ثبت کن» و «نه، کد اعتبار نمی‌خواهم» (مرحله ۴: ردیف دریافت پول اضافه)')
const base2 = await report()
const cr2 = creditCount()
const r2 = await safe('ثبت با confirmOverpay', () => sale(1300, { confirmOverpay: true }))
eq('کل مبلغ دریافتی ثبت شد', Number(payRows(r2?.id ?? -1)[0]?.amount ?? 0), 1300)
eq('اضافه‌دریافت روی ردیف پرداخت ذخیره شد (نه بی‌صدا)', overpaySum(r2?.id ?? -1), 300)
eq('فاکتور تسویه‌شده، بدهی صفر', r2?.remaining, 0)
eq('نتیجه‌ی ثبت مبلغ اضافه را برمی‌گرداند', r2?.overpayAmount, 300)
eq('هیچ اعتباری صادر نشد', creditCount(), cr2)
eq('نتیجه overpayCredit = null', r2?.overpayCredit ?? null, null)
const s2 = await report()
const d2 = rowsOf(s2), b2 = rowsOf(base2)
eq('وجه واقعی +۱٬۳۰۰', (d2.realCash ?? 0) - (b2.realCash ?? 0), 1300)
eq('ردیف «دریافت پول اضافه» −۳۰۰ در پل', (d2.overpayReceived ?? 0) - (b2.overpayReceived ?? 0), -300)
closed(s2)
const aud2 = seed.rows(`SELECT note FROM "AuditLog" WHERE entity = 'SaleInvoice' AND entityId = ?`, r2?.id ?? -1)
truthy('Audit ثبت فاکتور به مبلغ اضافه اشاره می‌کند', aud2.some((a) => String(a.note).includes('اضافه')))

// ---------------------------------------------------------------------------
console.log('\n۳) sale:create با «بله» + «کد اعتبار صادر شود» (مراحل ۲ و ۳)')
const base3 = await report()
const r3 = await safe('ثبت با confirmOverpay + overpayAsCredit', () => sale(1300, { confirmOverpay: true, overpayAsCredit: true }))
const c3 = creditsOf(r3?.id ?? -1)
eq('دقیقاً یک اعتبار صادر شد', c3.length, 1)
eq('مبلغ اعتبار = فقط مبلغ اضافه', Number(c3[0]?.amount ?? 0), 300)
eq('منبع اعتبار = OVERPAY', c3[0]?.source, 'OVERPAY')
truthy('نتیجه کد اعتبار را برنمی‌گرداند', !Object.hasOwn(r3?.overpayCredit ?? {}, 'code') && r3?.overpayCredit?.publicReference === `اعتبار #${c3[0]?.id}`)
truthy('نتیجه شناسه‌ی اعتبار را برای چاپ برمی‌گرداند', c3[0]?.id != null && r3?.overpayCredit?.id === c3[0]?.id)
truthy('نتیجه «غیرقابل نقد شدن» دارد', String(r3?.overpayCredit?.notice ?? '').includes('غیرقابل نقد شدن'))
const s3 = await report()
const d3 = rowsOf(s3), b3 = rowsOf(base3)
eq('اضافه‌دریافت فقط یک بار از پل کم شد',
  ((d3.overpayReceived ?? 0) - (b3.overpayReceived ?? 0)) + ((d3.storeCreditIssued ?? 0) - (b3.storeCreditIssued ?? 0)), -300)
closed(s3)

// ---------------------------------------------------------------------------
console.log('\n۴) قیدهای صدور اعتبار در sale:create (بند ۴-۳۷)')
const inv4 = invoiceCount()
await throwsWith('overpayAsCredit بدون مبلغ اضافه رد می‌شود', () => sale(1000, { confirmOverpay: true, overpayAsCredit: true }), 'مبلغ اضافه')
await throwsWith('overpayAsCredit بدون مبلغ اضافه (نسیه) رد می‌شود', () => sale(400, { confirmOverpay: true, overpayAsCredit: true }), 'مبلغ اضافه')
eq('هیچ فاکتوری از درخواست‌های ردشده ثبت نشد', invoiceCount(), inv4)
const r4 = await safe('پرداخت دقیق ۱٬۰۰۰ مثل قبل بی‌هشدار ثبت می‌شود', () => sale(1000))
eq('پرداخت دقیق: اضافه‌دریافت صفر', overpaySum(r4?.id ?? -1), 0)
const r4b = await safe('نسیه‌ی جزئی ۴۰۰ مثل قبل ثبت می‌شود', () => sale(400))
eq('نسیه‌ی جزئی: بدهی ۶۰۰', r4b?.remaining, 600)
const r4c = await safe('دو پرداخت نقد+کارت با جمع ۱٬۲۰۰ فقط با تأیید', async () => {
  const v = variant(1000)
  try {
    await salesService.create({ userId, shiftId, lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
      payments: [{ methodId: cash, amount: 700 }, { methodId: card, amount: 500 }] })
    return 'silent'
  } catch (e) { return String(e.message).includes('بله ثبت کن') ? 'warned' : 'other:' + e.message }
})
eq('جمع چند پرداخت هم سنجیده می‌شود', r4c, 'warned')

// ---------------------------------------------------------------------------
console.log('\n۵) سقف اعتبار تنظیمات (storeCreditLimit) و رمز مدیر، قبل از تراکنش')
await settingsService.setAccountingPolicy({ policy: { ...(await settingsService.accountingPolicy()), storeCreditLimit: 100 }, userId, managerPassword: PW }) // نشست ۱۵۴ (S153-D1): گیت رمز سیاست حسابداری در سرویس؛ فقط setup
eq('سقف اعتبار ۱۰۰ تنظیم شد', (await settingsService.accountingPolicy()).storeCreditLimit, 100)
const inv5 = invoiceCount(), cr5 = creditCount()
await throwsWith('بالای سقف بدون رمز ⇒ درخواست رمز مدیر', () => sale(1300, { confirmOverpay: true, overpayAsCredit: true }), 'رمز مدیر')
await throwsWith('بالای سقف با رمز غلط ⇒ رد', () => sale(1300, { confirmOverpay: true, overpayAsCredit: true, managerPassword: 'غلط-غلط' }), 'رمز مدیر')
eq('هیچ فاکتوری از درخواست‌های ردشده ثبت نشد', invoiceCount(), inv5)
eq('هیچ اعتباری از درخواست‌های ردشده صادر نشد', creditCount(), cr5)
const r5 = await safe('بالای سقف با رمز درست ⇒ صدور', () => sale(1300, { confirmOverpay: true, overpayAsCredit: true, managerPassword: PW }))
eq('اعتبار ۳۰۰ با تأیید مدیر صادر شد', Number(creditsOf(r5?.id ?? -1)[0]?.amount ?? 0), 300)
const over5 = seed.rows(`SELECT note FROM "AuditLog" WHERE action = 'STORE_CREDIT_OVER_LIMIT' AND entityId = ?`, r5?.id ?? -1)
eq('Audit «بالاتر از سقف با تأیید مدیر» ثبت شد', over5.length, 1)
// addPayment و overpayCreditIssue هم همان مسیر
const inv5b = await safe('نسیه‌ی ۱٬۰۰۰ برای addPayment', () => sale(0))
await throwsWith('addPayment بالای سقف با رمز غلط ⇒ رد', () =>
  salesService.addPayment({ invoiceId: inv5b.id, amount: 1300, methodId: cash, destination: 'CASH', userId, confirmOverpay: true, overpayAsCredit: true, managerPassword: 'غلط' }), 'رمز مدیر')
eq('addPayment ردشده هیچ پرداختی ننوشت', payRows(inv5b?.id ?? -1).length, 0)
const r5b = await safe('addPayment بالای سقف با رمز درست', () =>
  salesService.addPayment({ invoiceId: inv5b.id, amount: 1300, methodId: cash, destination: 'CASH', userId, confirmOverpay: true, overpayAsCredit: true, managerPassword: PW }))
eq('addPayment: اعتبار ۳۰۰', r5b?.overpayCredit?.amount, 300)
await settingsService.setAccountingPolicy({ policy: { ...(await settingsService.accountingPolicy()), storeCreditLimit: 0 }, userId, managerPassword: PW }) // نشست ۱۵۴ (S153-D1): گیت رمز سیاست حسابداری در سرویس؛ فقط setup

const svc = src('src/main/services/SalesService.ts')
const issueFn = (svc.match(/async function issueOverpayCreditTx[\s\S]*?\n}\n/) ?? [''])[0]
truthy('issueOverpayCreditTx (داخل تراکنش) دیگر خودش رمز مدیر را نمی‌سنجد (نوشتن AuthLockout وسط تراکنش)',
  issueFn.length > 0 && !issueFn.includes('assertManagerPassword('))
truthy('سنجش رمز اعتبار اضافه‌دریافت قبل از تراکنش در یک تابع واحد انجام می‌شود',
  /async function preverifyOverpayManager/.test(svc) && (svc.match(/preverifyOverpayManager\(/g) ?? []).length >= 4)

// ---------------------------------------------------------------------------
console.log('\n۶) نمای پرداخت‌ها: مبلغ آزاد برای دکمه‌ی «صدور اعتبار از اضافه‌دریافت»')
const r6 = await safe('فاکتور با اضافه‌دریافت بدون اعتبار', () => sale(1500, { confirmOverpay: true }))
const v6 = await safe('نمای پرداخت‌ها', () => salesService.payments({ invoiceId: r6.id }))
eq('overpayCreditAvailable = ۵۰۰', v6?.overpayCreditAvailable, 500)
eq('overpayCreditIssued = ۰', v6?.overpayCreditIssued, 0)
await safe('صدور ۲۰۰ از اضافه‌دریافت موجود', () => salesService.overpayCreditIssue({ invoiceId: r6.id, amount: 200, userId }))
const v6b = await safe('نمای پرداخت‌ها بعد از صدور', () => salesService.payments({ invoiceId: r6.id }))
eq('overpayCreditAvailable = ۳۰۰', v6b?.overpayCreditAvailable, 300)
eq('overpayCreditIssued = ۲۰۰', v6b?.overpayCreditIssued, 200)
const v6c = await safe('نمای فاکتور بدون اضافه‌دریافت', () => salesService.payments({ invoiceId: r4.id }))
eq('بدون اضافه‌دریافت ⇒ مبلغ آزاد صفر', v6c?.overpayCreditAvailable, 0)
closed(await report(), 'پل بعد از همه‌ی سناریوها بسته است')

// ---------------------------------------------------------------------------
console.log('\n۷) لایه‌ی مشترک تصمیم‌های UI (@shared/overpayFlow)')
let flow = null
try { flow = await import('@shared/overpayFlow') } catch (e) { console.log('   (ماژول پیدا نشد: ' + String(e.message).split('\n')[0] + ')') }
const F = flow ?? {}
eq('هشدار سرور تشخیص داده می‌شود', F.isOverpayWarning?.('... «بله ثبت کن» را بزنید ...'), true)
eq('خطای عادی هشدار اضافه‌دریافت نیست', F.isOverpayWarning?.('مبلغ پرداختی باید بزرگ‌تر از صفر باشد.'), false)
eq('درخواست رمز مدیر تشخیص داده می‌شود', F.needsManagerPassword?.('«صدور اعتبار» تایید مدیر لازم دارد. رمز مدیر را وارد کنید.'), true)
eq('رمز غلط هم دوباره رمز می‌خواهد', F.needsManagerPassword?.('رمز مدیر درست نیست.'), true)
eq('پول نقد واقعی ⇒ سؤال مرحله ۲ پرسیده می‌شود', F.overpayCreditEligible?.({ entryKind: 'CASH', methodKind: 'CASH' }), true)
eq('کارتخوان ⇒ سؤال مرحله ۲ پرسیده می‌شود', F.overpayCreditEligible?.({ entryKind: 'CASH', methodKind: 'CARD' }), true)
eq('چک ⇒ سؤال مرحله ۲ پرسیده نمی‌شود (پول دریافت‌نشده)', F.overpayCreditEligible?.({ entryKind: 'CHEQUE', methodKind: 'CUSTOM' }), false)
eq('مصرف اعتبار ⇒ سؤال مرحله ۲ پرسیده نمی‌شود', F.overpayCreditEligible?.({ entryKind: 'CASH', methodKind: 'STORE_CREDIT' }), false)
eq('مصرف اعتبار تعویض ⇒ سؤال مرحله ۲ پرسیده نمی‌شود', F.overpayCreditEligible?.({ entryKind: 'CASH', methodKind: 'EXCHANGE_CREDIT' }), false)
// ماشین حالت: مرحله ۱ ⇒ ۲ ⇒ درخواست
const st0 = F.overpayFlowStart?.('هشدار', { entryKind: 'CASH', methodKind: 'CASH' })
eq('شروع فلو ⇒ مرحله‌ی هشدار', st0?.step, 'confirm')
const st1 = st0 && F.overpayFlowNext?.(st0, 'yes')
eq('«بله، ثبت کن» روی پول واقعی ⇒ سؤال کد اعتبار', st1?.step, 'askCredit')
const st2 = st1 && F.overpayFlowNext?.(st1, 'yes')
eq('«بله، کد صادر شود» ⇒ ارسال', st2?.step, 'submit')
truthy('درخواست مرحله ۳ = confirmOverpay + overpayAsCredit', st2?.request?.confirmOverpay === true && st2?.request?.overpayAsCredit === true)
const st2n = st1 && F.overpayFlowNext?.(st1, 'no')
truthy('«نه» ⇒ فقط confirmOverpay (مرحله ۴)', st2n?.step === 'submit' && st2n?.request?.confirmOverpay === true && !st2n?.request?.overpayAsCredit)
const stc = F.overpayFlowStart?.('هشدار', { entryKind: 'CHEQUE', methodKind: 'CUSTOM' })
const stc1 = stc && F.overpayFlowNext?.(stc, 'yes')
truthy('چک: «بله، ثبت کن» مستقیم ارسال می‌شود، بی‌سؤال اعتبار', stc1?.step === 'submit' && !stc1?.request?.overpayAsCredit)
const stcc = st1 && F.overpayFlowNext?.(st1, 'cancel')
eq('بستن پنجره در مرحله ۲ ⇒ هیچ ارسالی (نه «ثبت بدون کد»)', stcc?.step, 'idle')
const stx = st0 && F.overpayFlowNext?.(st0, 'no')
eq('«انصراف» در مرحله ۱ ⇒ هیچ ارسالی', stx?.step, 'idle')
const stp = st2 && F.overpayFlowPassword?.(st2, 'رمز')
truthy('رمز مدیر همان درخواست مرحله ۳ را با managerPassword تکرار می‌کند',
  stp?.step === 'submit' && stp?.request?.overpayAsCredit === true && stp?.request?.managerPassword === 'رمز')
const flashText = F.overpayCreditFlash?.({ id: 12, publicReference: 'اعتبار #12', amount: 300, expiresAtJalali: null, notice: 'x' }, (n) => String(n), (s) => s)
truthy('متن نتیجه مرجع امن، مبلغ و «غیرقابل نقد شدن» را دارد',
  typeof flashText === 'string' && flashText.includes('اعتبار #12') && !flashText.includes('AB12') && flashText.includes('300') && flashText.includes('غیرقابل نقد شدن'))
const btn = F.overpayCreditButton?.({ overpayCreditAvailable: 500 }, (n) => String(n))
truthy('دکمه با مبلغ آزاد دیده می‌شود', btn?.show === true && String(btn?.label).includes('500'))
eq('دکمه بدون مبلغ آزاد پنهان است', F.overpayCreditButton?.({ overpayCreditAvailable: 0 }, (n) => String(n))?.show, false)
truthy('لایه‌ی مشترک هیچ import ندارد (قابل اجرا در Node خام، مثل accounting.ts)', src('src/shared/overpayFlow.ts').length > 0 && !/^\s*import\s/m.test(src('src/shared/overpayFlow.ts')))

// ---------------------------------------------------------------------------
console.log('\n۸) سیم‌کشی UI (بررسی ساختاری؛ رندر واقعی Electron اجرا نشد)')
const modal = src('src/renderer/src/components/InvoicePaymentsModal.tsx') + '\n' + (src('src/renderer/src/components/InvoicePaymentsModal.tsx').includes('OverpayFlowDialogs') ? src('src/renderer/src/components/OverpayFlowDialogs.tsx') : '')
truthy('پنجره‌ی پرداخت‌ها از @shared/overpayFlow می‌خواند', modal.includes("@shared/overpayFlow"))
truthy('پنجره‌ی پرداخت‌ها overpayAsCredit می‌فرستد (از درخواست فلو)', modal.includes('overpayFlowNext') && modal.includes('...req,'))
truthy('دیالوگ دوم «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟»', modal.includes('کد اعتبار خرید برای مبلغ اضافه صادر بشود؟'))
truthy('دکمه‌ی «صدور اعتبار از اضافه‌دریافت» کانال saleOverpayCredit را صدا می‌زند', modal.includes('CH.saleOverpayCredit') && modal.includes('overpayCreditButton'))
truthy('کد صادرشده از همان کانال چاپ اعتبار چاپ می‌شود', modal.includes("creditPrintOpRequest('print'"))
truthy('پنجره‌ی پرداخت‌ها رمز مدیر را برای سقف اعتبار می‌پرسد', modal.includes('overpayFlowPassword'))
// ⚠️ ناتمام (نشست ۶۲): سیم‌کشی همین فلو در صفحه‌ی فاکتور عمده (SalesInvoice.tsx) هنوز انجام نشده؛ سرور sale:create کامل است.
const types = src('src/shared/types.ts')
const iface = (name) => (types.match(new RegExp('export interface ' + name + ' \\{[\\s\\S]*?\\n\\}\\n')) ?? [''])[0]
const csi = iface('CreateSaleInput')
truthy('CreateSaleInput پرچم‌های confirmOverpay/overpayAsCredit/managerPassword دارد',
  csi.includes('confirmOverpay?: boolean') && csi.includes('overpayAsCredit?: boolean') && csi.includes('managerPassword?: string | null'))
truthy('InvoicePaymentsView مبلغ آزاد اعتبار اضافه‌دریافت دارد', iface('InvoicePaymentsView').includes('overpayCreditAvailable: number'))

// ---------------------------------------------------------------------------
console.log('\n۹) بند ۴-۳۲: سند چاپی اعتبار همیشه «غیرقابل نقد شدن» دارد')
const tpl = await import('../../src/main/print/templates.ts')
const doc = {
  code: 'ZX9', amount: 300, usedAmount: 0, remaining: 300, sourceLabel: 'اضافه‌دریافت', statusLabel: 'فعال',
  issuedJalali: today, issuedTime: '10:00', expiresJalali: null, usesLabel: 'یک‌بار', maxUses: 1, usedCount: 0,
  restrictLabel: null, minPurchase: 0, maxPerTransaction: 0, holderName: null, holderCompany: null, holderPhone: null,
  holderAgent: null, holderAddress: null, holderNationalId: null, barcodeDataUrl: null, rulesText: '', showRules: false,
  showHolder: false, showRemaining: false, reprint: false, printCount: 1, note: null
}
truthy('سند تکی (بدون توضیح و بدون قوانین) عبارت را دارد', String(tpl.creditDocHtml(doc)).includes('غیرقابل نقد شدن'))
truthy('چاپ دسته‌ای هم عبارت را دارد', String(tpl.creditBatchHtml([doc, { ...doc, code: 'ZX8' }])).split('غیرقابل نقد شدن').length - 1 >= 2)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad === 0 ? 0 : 1
