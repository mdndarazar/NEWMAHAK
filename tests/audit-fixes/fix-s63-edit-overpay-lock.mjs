/**
 * ===========================================================================
 * نشست ۶۳ (نشست ۸ زنجیره‌ی رفع) — خوشه C (بند ۴-۳۵) + ریسک بن‌بست رمز مدیر
 *
 *   بخش ۱ — sale:update: ویرایشی که «مبلغ اضافه‌ی دریافتی» فاکتور را زیاد
 *           می‌کند (پرداخت صریح بیشتر از جمع، یا کم کردن اقلام زیر پرداختی
 *           با keepPayments) قبلاً بی‌هیچ هشداری ثبت می‌شد. حالا همان فلوی
 *           چهارمرحله‌ای (هشدار «بله ثبت کن» ⇒ ثبت / کد اعتبار).
 *   بخش ۲ — رمز مدیر وسط تراکنش باز: periodLockService.assertOpen (همه‌ی
 *           مسیرهای فروش/ویرایش/برگشت/تعویض در دوره‌ی بسته) و سقف اعتبار
 *           تعویض، assertManagerPassword را داخل $transaction صدا می‌زدند ⇒
 *           نوشتن AuthLockout با کلاینت سراسری وسط تراکنش (روی Prisma واقعی =
 *           قفل SQLite؛ روی هر دو: شمارنده‌ی رمز اشتباه با rollback پاک می‌شد =
 *           دور زدن قفل brute-force).
 *   بخش ۳ — سیم‌کشی فلو در صفحه‌ی فاکتور عمده (SalesInvoice.tsx)، بررسی ساختاری.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s63-edit-overpay-lock.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s63-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { setManagerCorrectionApprovalPassword } = await import('../../src/main/services/AuthService.ts')
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

/**
 * پروب بن‌بست: هر دسترسی به AuthLockout (جدول قفل رمز) با عمق تراکنش همان لحظه
 * ثبت می‌شود. روی Prisma واقعی، این دسترسی با کلاینت سراسری است نه tx؛ پس هر
 * دسترسی در عمق > ۰ یعنی «اتصال دوم وسط تراکنش باز» = قفل SQLite.
 */
const lockProbe = []
for (const op of ['findUnique', 'upsert', 'update', 'create', 'updateMany', 'deleteMany']) {
  const orig = db.authLockout?.[op]
  if (typeof orig !== 'function') continue
  db.authLockout[op] = (...args) => { lockProbe.push({ op, depth: db.$harness.depth }); return orig.apply(db.authLockout, args) }
}
const probe = async (label, fn) => {
  lockProbe.length = 0
  let res = null, err = null
  try { res = await fn() } catch (e) { err = e }
  const inTx = lockProbe.filter((p) => p.depth > 0).length
  eq(`${label}: دسترسی به جدول قفل رمز وسط تراکنش باز`, inTx, 0)
  truthy(`${label}: رمز واقعاً سنجیده شد (دسترسی بیرون از تراکنش)`, lockProbe.some((p) => p.depth === 0), JSON.stringify(lockProbe))
  return { res, err }
}

const PW = DEFAULT_MANAGER_PASSWORD
/** ابطال دیرهنگام باید به مدیرِ مشخص و credential شخصی او وصل باشد، نه رمز سراسری. */
const CORRECTION_PW = 'تصحیح-۶۳'
const userId = seed.user('مدیر تست نشست ۶۳')
await setManagerCorrectionApprovalPassword({ userId, password: CORRECTION_PW, actorUserId: userId })
const cat = seed.category('پوشاک')
const product = seed.product('پیراهن', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const yMs = Date.now() - 86400000
const yesterday = toJalaliDate(new Date(yMs))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
/**
 * ⚠️ به‌روزرسانی نشست ۱۸۲ — شرط `voidedAt IS NULL` اضافه شد.
 *
 * تا نشست ۱۸۱، ویرایشِ فاکتور با `payments` (بدون `keepPayments`) پرداخت‌های
 * قبلی را **فیزیکی حذف** می‌کرد، پس این کوئری فقط ردیف تازه را می‌دید.
 * از نشست ۱۸۲ آن ردیف‌ها طبق بند ۴-۲۲ **باطل** می‌شوند نه حذف، تا مبلغ، روش
 * و کارمندِ هر پرداخت در سابقه بماند.
 *
 * پس این helper هم باید همان کاری را بکند که کل برنامه می‌کند: ردیف باطل‌شده
 * را در محاسبه نیاورد. رفتار سنجیده‌شده‌ی تست یک ذره هم عوض نشده.
 */
const payRows = (invoiceId) =>
  seed.rows(
    'SELECT id, amount, overpayAmount FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL ORDER BY seq, id',
    invoiceId
  )
const overpaySum = (invoiceId) => payRows(invoiceId).reduce((s, p) => s + Number(p.overpayAmount ?? 0), 0)
const creditsOf = (invoiceId) => seed.rows('SELECT * FROM "StoreCredit" WHERE sourceInvoiceId = ? ORDER BY id', invoiceId)
const grandOf = (id) => Number(seed.one('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?', id)?.grandTotal ?? -1)
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  })
  return statements
}
const closed = (s, label = 'پل تطبیق بسته است (مانده‌ی بی‌توضیح)') => eq(label, s?.bridge?.unexplained, 0)
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const mk = async (price, paid, extra = {}) => {
  const v = variant(price)
  const inv = await salesService.create({ userId, shiftId, lines: [line(v, price)], payments: paid > 0 ? [{ methodId: cash, amount: paid }] : [], ...extra })
  return { inv, v }
}

// ===========================================================================
console.log('\n۱-الف) ویرایش با پرداخت صریح ۱٬۳۰۰ روی فاکتور ۱٬۰۰۰ (payments، نه keepPayments)')
const a = await safe('فاکتور ۱٬۰۰۰ با پرداخت ۱٬۰۰۰', () => mk(1000, 1000))
await throwsWith('بازنویسی پرداخت از ویرایش اقلام رد می‌شود',
  () => salesService.update({ id: a.inv.id, userId, shiftId, lines: [line(a.v, 1000)], payments: [{ methodId: cash, amount: 1300 }] }), 'پرداختی‌ها')
eq('هیچ تغییری نماند: پرداخت همان ۱٬۰۰۰', Number(payRows(a.inv.id)[0]?.amount ?? 0), 1000)
eq('هیچ اضافه‌دریافتی بی‌صدا نوشته نشد', overpaySum(a.inv.id), 0)
await throwsWith('حتی با confirmOverpay بازنویسی پرداخت زنده رد است',
  () => salesService.update({ id: a.inv.id, userId, shiftId, lines: [line(a.v, 1000)], payments: [{ methodId: cash, amount: 1300 }], confirmOverpay: true }), 'پرداختی‌ها')
eq('پرداخت همان ۱٬۰۰۰ ماند', Number(payRows(a.inv.id)[0]?.amount ?? 0), 1000)
eq('اضافه‌دریافت صفر ماند', overpaySum(a.inv.id), 0)
closed(await report())

console.log('\n۱-ب) ویرایش keepPayments: کم کردن اقلام از ۱٬۰۰۰ به ۷۰۰ روی پرداختی ۱٬۰۰۰')
const b = await safe('فاکتور ۱٬۰۰۰ با پرداخت ۱٬۰۰۰', () => mk(1000, 1000))
const vb = variant(700)
await throwsWith('بدون confirmOverpay ⇒ هشدار با عدد ۳۰۰',
  () => salesService.update({ id: b.inv.id, userId, shiftId, lines: [line(vb, 700)], keepPayments: true }), '۳۰۰')
eq('فاکتور دست‌نخورده ماند (جمع ۱٬۰۰۰)', grandOf(b.inv.id), 1000)
eq('اضافه‌دریافت همچنان صفر', overpaySum(b.inv.id), 0)
await safe('با confirmOverpay', () => salesService.update({ id: b.inv.id, userId, shiftId, lines: [line(vb, 700)], keepPayments: true, confirmOverpay: true }))
eq('جمع تازه ۷۰۰', grandOf(b.inv.id), 700)
eq('اضافه‌دریافت ۳۰۰ ثبت شد (ردیف دریافت پول اضافه)', overpaySum(b.inv.id), 300)
closed(await report())

console.log('\n۱-ج) ویرایش با «بله» + «کد اعتبار صادر شود»')
const c = await safe('فاکتور ۱٬۰۰۰ با پرداخت ۱٬۰۰۰', () => mk(1000, 1000))
const vc = variant(600)
const c2 = await safe('ویرایش به ۶۰۰ با overpayAsCredit', () =>
  salesService.update({ id: c.inv.id, userId, shiftId, lines: [line(vc, 600)], keepPayments: true, confirmOverpay: true, overpayAsCredit: true }))
const cc = creditsOf(c.inv.id)
eq('یک اعتبار OVERPAY صادر شد', cc.length, 1)
eq('مبلغ اعتبار = فقط افزایش اضافه‌دریافت (۴۰۰)', Number(cc[0]?.amount ?? 0), 400)
eq('منبع اعتبار', cc[0]?.source, 'OVERPAY')
truthy('نتیجه مرجع امن و «غیرقابل نقد شدن» را برمی‌گرداند',
  c2?.overpayCredit?.publicReference === `اعتبار #${cc[0]?.id}` && !Object.hasOwn(c2?.overpayCredit ?? {}, 'code') && String(c2?.overpayCredit?.notice ?? '').includes('غیرقابل نقد شدن'))
closed(await report())
await throwsWith('overpayAsCredit بدون افزایش اضافه‌دریافت رد می‌شود',
  () => salesService.update({ id: c.inv.id, userId, shiftId, lines: [line(vc, 600)], keepPayments: true, confirmOverpay: true, overpayAsCredit: true }), 'اضافه')
eq('اعتبار دوم صادر نشد', creditsOf(c.inv.id).length, 1)

console.log('\n۱-د) رگرسیون: ویرایش‌هایی که اضافه‌دریافت را زیاد نمی‌کنند هشدار نمی‌دهند')
const d = await safe('نسیه‌ی ۱٬۰۰۰ با پرداخت ۵۰۰', () => mk(1000, 500))
const vd = variant(800)
const d2 = await safe('ویرایش به ۸۰۰ (باز هم بدهکار)', () => salesService.update({ id: d.inv.id, userId, shiftId, lines: [line(vd, 800)], keepPayments: true }))
eq('باقی‌مانده ۳۰۰', d2?.remaining, 300)
const e2 = await safe('ویرایش دوباره‌ی فاکتور ۱-ب (اضافه‌دریافت ۳۰۰ قبلی، بدون افزایش)', () =>
  salesService.update({ id: b.inv.id, userId, shiftId, lines: [line(vb, 700)], keepPayments: true, note: 'فقط توضیح' }))
truthy('ویرایش بدون تغییر اضافه‌دریافت رد نشد', !!e2)
eq('اضافه‌دریافت همان ۳۰۰', overpaySum(b.inv.id), 300)

// ===========================================================================
console.log('\n۲-الف) قفل دوره‌ی بسته: رمز مدیر قبل از تراکنش (ثبت فاکتور با تاریخ دیروز)')
// یک فاکتور دیروز برای ویرایش، قبل از بستن دوره
const oldV = variant(1000)
const oldInv = await safe('فاکتور دیروز', () => salesService.create({ userId, shiftId, issuedAtJalali: yesterday, lines: [line(oldV, 1000)], payments: [{ methodId: cash, amount: 1000 }] }))
seed.insert('CashSession', {
  fromDate: jalaliStartOfDay(yesterday).getTime(), toDate: jalaliEndOfDay(yesterday).getTime(),
  dayJalali: yesterday, closedAt: Date.now() - 1000, createdAt: Date.now() - 1000
})
await throwsWith('بدون رمز ⇒ همان پیام دوره‌ی بسته',
  () => salesService.create({ userId, shiftId, issuedAtJalali: yesterday, lines: [line(variant(500), 500)], payments: [] }), 'دوره')
const fails0 = Number(seed.one(`SELECT failCount FROM "AuthLockout" WHERE gate LIKE '%manager%'`)?.failCount ?? 0)
const w = await probe('رمز غلط', () => salesService.create({ userId, shiftId, issuedAtJalali: yesterday, lines: [line(variant(500), 500)], payments: [], managerPassword: 'غلط-غلط', overrideReason: 'اصلاح تست' }))
truthy('رمز غلط رد شد', !!w.err && String(w.err.message).includes('رمز'), String(w.err?.message))
const fails1 = Number(seed.one(`SELECT failCount FROM "AuthLockout" WHERE gate LIKE '%manager%'`)?.failCount ?? 0)
eq('شمارنده‌ی رمز اشتباه با rollback پاک نشد (ضد brute-force)', fails1, fails0 + 1)
const g = await probe('ثبت فاکتور در دوره‌ی بسته با رمز درست', () =>
  salesService.create({ userId, shiftId, issuedAtJalali: yesterday, lines: [line(variant(500), 500)], payments: [], managerPassword: PW, overrideReason: 'اصلاح تست' }))
truthy('ثبت شد', !!g.res?.id, String(g.err?.message))
eq('Audit عبور از دوره‌ی بسته ثبت شد', seed.rows(`SELECT id FROM "AuditLog" WHERE action = 'CLOSED_PERIOD_OVERRIDE' AND entity = 'SaleInvoice'`).length >= 1, true)
const u = await probe('ویرایش فاکتور دوره‌ی بسته با رمز درست', () =>
  salesService.update({ id: oldInv.id, userId, shiftId, lines: [line(oldV, 1000)], keepPayments: true, note: 'اصلاح', managerPassword: PW, overrideReason: 'اصلاح تست' }))
truthy('ویرایش شد', !!u.res?.id, String(u.err?.message))

console.log('\n۲-ب) ویرایش/حذف سند برگشتِ دوره‌ی بسته')
const rInv = await safe('فاکتور دو قلمی امروز', async () => {
  const v1 = variant(300), v2 = variant(300)
  return salesService.create({ userId, shiftId, lines: [line(v1, 300), line(v2, 300)], payments: [{ methodId: cash, amount: 600 }] })
})
const items = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', rInv.id)
const r1 = await safe('برگشت قلم اول', () => salesService.createReturn({ invoiceId: rInv.id, full: false, lines: [{ saleItemId: items[0].id, qty: 1 }], refundMethod: 'NONE', confirmOverpay: true, userId }))
const retId = r1?.id ?? r1?.returnId
sql.prepare('UPDATE "SaleReturn" SET returnedAt = ?, returnedAtJalali = ? WHERE id = ?').run(yMs, yesterday, retId)
const ru = await probe('ویرایش برگشت دوره‌ی بسته', () =>
  salesService.returnUpdate({ id: retId, lines: [{ saleItemId: items[0].id, qty: 1 }], note: 'اصلاح', userId, managerPassword: PW, overrideReason: 'اصلاح تست' }))
truthy('ویرایش برگشت انجام شد', !ru.err, String(ru.err?.message))
const rd = await probe('حذف برگشت دوره‌ی بسته', () => salesService.returnDelete({
  id: retId,
  userId,
  reason: 'ابطال تست دوره‌ی بسته',
  managerPassword: PW,
  overrideReason: 'اصلاح تست',
  approverUserId: userId,
  approverPassword: CORRECTION_PW
}))
truthy('حذف/ابطال برگشت انجام شد', !rd.err, String(rd.err?.message))

console.log('\n۲-ج) تعویض: سقف اعتبار با رمز مدیر، قبل از تراکنش')
await settingsService.setAccountingPolicy({ policy: { ...(await settingsService.accountingPolicy()), storeCreditLimit: 100 }, userId, managerPassword: PW }) // نشست ۱۵۴ (S153-D1): گیت رمز سیاست حسابداری در سرویس؛ فقط setup
const xInv = await safe('فاکتور پرداخت‌شده‌ی ۶۰۰+۴۰۰', async () => {
  const v1 = variant(600), v2 = variant(400)
  return salesService.create({ userId, shiftId, lines: [line(v1, 600), line(v2, 400)], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
})
const xItems = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', xInv.id)
await throwsWith('اعتبار ۴۰۰ بالای سقف ۱۰۰ بدون رمز ⇒ درخواست رمز مدیر', () => salesService.createExchange({
  invoiceId: xInv.id, lines: [{ saleItemId: xItems[0].id, qty: 1 }], replacements: [{ variantId: variant(200), qty: 1 }], refundMode: 'STORE_CREDIT', userId, shiftId }), 'رمز مدیر')
const x = await probe('تعویض با اعتبار بالای سقف و رمز درست', () => salesService.createExchange({
  invoiceId: xInv.id, lines: [{ saleItemId: xItems[0].id, qty: 1 }], replacements: [{ variantId: variant(200), qty: 1 }], refundMode: 'STORE_CREDIT', userId, shiftId, managerPassword: PW }))
truthy('تعویض ثبت شد', !x.err, String(x.err?.message))
truthy('نتیجه تعویض فقط اعتبار امن دارد',
  !Object.hasOwn(x.res?.storeCredit ?? {}, 'code') && x.res?.storeCredit?.publicReference === `اعتبار #${x.res?.storeCredit?.id}`)
eq('Audit «بالاتر از سقف» تعویض', seed.rows(`SELECT id FROM "AuditLog" WHERE action = 'STORE_CREDIT_OVER_LIMIT' AND entity = 'SaleReturn'`).length, 1)
await settingsService.setAccountingPolicy({ policy: { ...(await settingsService.accountingPolicy()), storeCreditLimit: 0 }, userId, managerPassword: PW }) // نشست ۱۵۴ (S153-D1): گیت رمز سیاست حسابداری در سرویس؛ فقط setup

console.log('\n۲-د) ساختاری: هیچ assertManagerPassword داخل بدنه‌ی assertOpen نمانده')
const pl = src('src/main/services/PeriodLockService.ts')
const assertOpenBody = (pl.match(/async assertOpen\([\s\S]*?\n  },\n/) ?? [''])[0]
truthy('assertOpen دیگر خودش رمز نمی‌سنجد', assertOpenBody.length > 0 && !assertOpenBody.includes('assertManagerPassword('))
truthy('تابع preverify بیرون از تراکنش وجود دارد', /async preverify\(/.test(pl))

// ===========================================================================
console.log('\n۳) سیم‌کشی فلو در صفحه‌ی فاکتور عمده (بررسی ساختاری؛ رندر واقعی Electron اجرا نشد)')
const si = src('src/renderer/src/pages/SalesInvoice.tsx')
truthy('از @shared/overpayFlow می‌خواند', si.includes("from '@shared/overpayFlow'"))
truthy('هشدار سرور ⇒ شروع فلو (isOverpayWarning + overpayFlowStart)', si.includes('isOverpayWarning(') && si.includes('overpayFlowStart('))
truthy('جزء مشترک دیالوگ‌ها رندر می‌شود', si.includes('<OverpayFlowDialogs'))
truthy('درخواست فلو روی payload ثبت پخش می‌شود', /\.\.\.overpayReq/.test(si))
truthy('کد اعتبار صادرشده چاپ می‌شود', si.includes('printOverpayCredit('))
truthy('مسیر رمز مدیر سقف اعتبار', si.includes('overpayFlowAskPassword('))
truthy('برنامه‌ی مبدأ کسر در ارسال دوباره‌ی فلو دوباره پرسیده نمی‌شود', si.includes('overpayPlanRef'))
truthy('متن نتیجه با overpayCreditFlash', si.includes('overpayCreditFlash('))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
