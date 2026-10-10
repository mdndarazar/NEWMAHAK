// @ts-check
/**
 * نشست ۳۲۲ · قرارداد منابع ریزبین مالی.
 *
 * - منابع از همان row پل ساخته می‌شوند، نه SQL/فرمول دوم.
 * - search/sort/page در main اتفاق می‌افتد.
 * - قفل salesReports در server رعایت می‌شود و خاموش کردن عمدی قفل واقعاً
 *   endpoint خواندنی را آزاد می‌کند.
 * - سرویس read-only است.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s322-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { financialInspectorService: svc } = await import('../../src/main/services/financialInspectorService.ts')
const { clearPanelSessions } = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { SETTING_KEYS } = await import('../../src/shared/receipt.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const sql = db.$harness.db
const seed = makeSeeder(db)
const day = '1405/06/11'
const at = (hours) => new Date(jalaliStartOfDay(day).getTime() + hours * 3_600_000)
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}

const userId = seed.user('مدیر ریزبین مالی')
const categoryId = seed.category('تست ریزبین')
const productId = seed.product('پیراهن منبع مالی', categoryId)
const variantId = seed.variant(productId, 'آبی')
sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(10, 125_000, variantId)
const cashMethod = seed.insert('PaymentMethod', { key: 'FI-CASH', label: 'نقدی تست', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cardMethod = seed.insert('PaymentMethod', { key: 'FI-CARD', label: 'کارتی تست', kind: 'CARD', isActive: 1, sortOrder: 2 })
await shiftService.openSession({ staffId: userId, name: 'شیفت ریزبین' })

const invCash = await salesService.create({
  userId,
  lines: [{ variantId, qty: 1, unitPrice: 125_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cashMethod, amount: 125_000, destination: 'CASH' }]
})
const invCard = await salesService.create({
  userId,
  lines: [{ variantId, qty: 1, unitPrice: 225_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cardMethod, amount: 225_000, destination: 'CARD' }]
})
for (const [invoiceId, hour] of [[invCash.id, 9], [invCard.id, 10]]) {
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(at(hour).getTime(), day, invoiceId)
  sql.prepare('UPDATE "Payment" SET paidAt = ?, createdAt = ?, paidAtJalali = ?, paidAtTime = ? WHERE invoiceId = ?')
    .run(at(hour).getTime(), at(hour).getTime(), day, `${String(hour).padStart(2, '0')}:00:00`, invoiceId)
}

const scope = { fromJalali: day, toJalali: day }
const tableCounts = () => ({
  invoices: Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleInvoice"').get().n),
  payments: Number(sql.prepare('SELECT COUNT(*) AS n FROM "Payment"').get().n),
  returns: Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleReturn"').get().n),
  credits: Number(sql.prepare('SELECT COUNT(*) AS n FROM "StoreCredit"').get().n),
  audit: Number(sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog"').get().n)
})

console.log('--- ۱. authorization سمت سرور ---')
clearPanelSessions()
seed.setting(SETTING_KEYS.panelLocks, {})
assert.match(await errorOf(() => svc.sources({ scope, key: 'realCash' })) ?? '', /قفل|رمز|نشست/, 'قفل روشن باید endpoint را در main رد کند')
console.log('  ✓ قفل فعال: endpoint خواندنی بدون نشست رد شد')

seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReports]: false })
const before = tableCounts()
const first = await svc.sources({ scope, key: 'realCash', take: 1, sort: 'AMOUNT_DESC' })
const after = tableCounts()
assert.equal(first.ok, true)
assert.equal(first.result?.totalAmount, 350_000, 'مبلغ رسمی realCash همان عدد پل است')
assert.equal(first.result?.sourceAmount, 350_000, 'جمع کامل منابع با عدد رسمی هم‌خوان است')
assert.equal(first.result?.reconciles, true)
assert.equal(first.result?.totalCount, 2)
assert.equal(first.result?.filteredCount, 2)
assert.equal(first.result?.sources.length, 1)
assert.equal(first.result?.sources[0]?.amount, 225_000, 'sort مبلغ در main انجام شده است')
assert.deepEqual(after, before, 'endpoint ریزبین هیچ رکورد مالی یا audit نمی‌نویسد')
const doc = await svc.document({ scope, key: 'realCash', ref: first.result?.sources[0]?.ref })
assert.equal(doc.ok, true, 'شناسنامهٔ سند عضو منبع بدون session تشخیص پل باز می‌شود')
assert.equal(doc.detail?.sourceAmount, 225_000, 'سهم سند در عدد مالی حفظ شده است')
assert.equal(doc.detail?.documentAmount, 225_000, 'مبلغ خود سند پرداخت درست است')
assert.equal(doc.detail?.invoice?.id, invCard.id, 'سند پرداخت به فاکتور درست متصل است')
assert.deepEqual(tableCounts(), before, 'خواندن شناسنامه هم فقط‌خواندنی است')

/**
 * کلیدهای جزء نباید از realCash (که نقد/کارت/سایر را مخلوط می‌کند) تغذیه شوند.
 * این دو assertion دقیقاً قرارداد کاشی کشو و پوز را قفل می‌کنند.
 */
const drawerCash = await svc.sources({ scope, key: 'drawerCashReceived' })
assert.equal(drawerCash.result?.totalAmount, 125_000, 'کشو فقط مبلغ رسمی دریافت نقدی را دارد')
assert.equal(drawerCash.result?.sourceAmount, 125_000)
assert.equal(drawerCash.result?.sources.length, 1, 'تاریخچهٔ کشو فقط یک پرداخت نقدی دارد')
assert.equal(drawerCash.result?.sources[0]?.amount, 125_000)
assert.equal(drawerCash.result?.basis, 'RANGE')
assert.equal(drawerCash.result?.pageCoversRange, true)

const posCard = await svc.sources({ scope, key: 'posCardReceived' })
assert.equal(posCard.result?.totalAmount, 225_000, 'پوز فقط مبلغ رسمی دریافت کارت را دارد')
assert.equal(posCard.result?.sourceAmount, 225_000)
assert.equal(posCard.result?.sources.length, 1, 'تاریخچهٔ پوز پرداخت نقدی را قاطی نمی‌کند')
assert.equal(posCard.result?.sources[0]?.amount, 225_000)
assert.equal((await svc.document({ scope, key: 'drawerCashReceived', ref: drawerCash.result?.sources[0]?.ref })).detail?.invoice?.id, invCash.id,
  'ضد-IDOR برای کلید جزء هم فقط سند عضو همان بخش را باز می‌کند')
assert.match(
  await errorOf(() => svc.document({ scope, key: 'drawerCashReceived', ref: posCard.result?.sources[0]?.ref })) ?? '',
  /عضو عدد مالی/,
  'پرداخت کارت نمی‌تواند با کلید کشو شناسنامه بگیرد'
)
assert.deepEqual(tableCounts(), before, 'کلیدهای جزء نیز فقط‌خواندنی هستند')
console.log('  ✓ قفل عمداً خاموش: endpoint بدون رمز کار کرد و read-only ماند')

console.log('--- ۲. صفحه‌بندی، جست‌وجو و allowlist ---')
const second = await svc.sources({ scope, key: 'realCash', skip: 1, take: 1, sort: 'AMOUNT_DESC' })
assert.equal(second.result?.sources[0]?.amount, 125_000, 'صفحهٔ دوم فقط سند دوم sort‌شده را برگرداند')
assert.equal(second.result?.page.totalCount, 2)

const searched = await svc.sources({ scope, key: 'realCash', search: String(invCard.receiptNo), sort: 'DATE_DESC' })
assert.equal(searched.result?.filteredCount, 1, 'جست‌وجو روی label/receipt در server اعمال شد')
assert.equal(searched.result?.sourceAmount, 225_000, 'جمع search جای مبلغ رسمی را نگرفت')
assert.equal(searched.result?.totalAmount, 350_000)
assert.equal(searched.result?.reconciles, false, 'نتیجهٔ فیلترشده هرگز هم‌خوانی کامل ادعا نمی‌کند')
assert.equal(searched.result?.difference, 125_000)

assert.match(
  await errorOf(() => svc.document({ scope, key: 'realCash', ref: { kind: 'INVOICE', id: invCard.id } })) ?? '',
  /عضو عدد مالی|نامعتبر/,
  'ref دلخواه که عضو source نیست سمت server رد شد'
)
assert.match(await errorOf(() => svc.sources({ scope, key: 'not-a-key' })) ?? '', /نامعتبر/, 'key خارج از allowlist رد شد')
assert.match(await errorOf(() => svc.sources({ scope, key: 'realCash', sort: 'DROP_TABLE' })) ?? '', /نامعتبر/, 'sort خارج از allowlist رد شد')
assert.match(await errorOf(() => svc.sources({ scope, key: 'realCash', take: 'bad' })) ?? '', /نامعتبر/, 'page size خراب رد شد')
assert.match(await errorOf(() => svc.sources({ scope: { ...scope, fromJalali: 'تاریخ خراب' }, key: 'realCash' })) ?? '', /تاریخ.*نامعتبر/, 'تاریخ خراب پیش از query رد شد')
const persianDateScope = { fromJalali: day.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]), toJalali: day.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) }
assert.equal((await svc.sources({ scope: persianDateScope, key: 'realCash' })).result?.totalAmount, 350_000, 'ارقام فارسی همان بازهٔ گزارش را باز می‌کنند')
console.log('  ✓ pagination/search/sort سمت main و ورودی‌های غیرمجاز رد شدند')

console.log('\nنتیجه: منابع ریزبین مالی امن، فقط‌خواندنی و قابل ردیابی هستند.')
