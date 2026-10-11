// @ts-check
/**
 * S344 — زنجیرهٔ فقط‌خواندنیِ تسویه با اعتبار از گزارش فروش.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s344-credit-settlement-lineage.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-s344-lineage-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر تست زنجیرهٔ تسویه')
const categoryId = seed.category('دسته زنجیره')
const productId = seed.product('کالای زنجیره', categoryId)
const variantId = seed.variant(productId, 'تک')
sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(10, 1_000, variantId)
const shiftId = seed.insert('Shift', { name: 'شیفت زنجیره', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now(), userId })

console.log('--- ۱. اعتبار واقعی روی فاکتور مصرف و از دفتر redemption خوانده می‌شود ---')
const issued = await storeCreditService.issueManual({ amount: 1_000, userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
const raw = seed.one('SELECT code FROM "StoreCredit" WHERE id = ?', issued.id)
const code = String(raw?.code ?? '')
assert.ok(code, 'فقط fixture داخلی کد واقعی را می‌خواند')
// PII فرضی روی رکورد DB می‌ماند؛ DTO گزارش اجازهٔ حمل آن را ندارد.
sql.prepare('UPDATE "StoreCredit" SET holderPhone = ?, holderAddress = ?, holderNationalId = ?, holderNote = ? WHERE id = ?')
  .run('09120000000', 'نشانی خصوصی', '0012345678', `یادداشت خصوصی ${code}`, issued.id)
const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }],
  payments: [],
  storeCreditCode: code,
  storeCreditIdempotencyKey: 's344-real-redemption'
})
const before = seed.one('SELECT usedAmount, usedCount FROM "StoreCredit" WHERE id = ?', issued.id)
const view = await salesService.creditSettlementLineage({ invoiceId: sale.id })
const after = seed.one('SELECT usedAmount, usedCount FROM "StoreCredit" WHERE id = ?', issued.id)

assert.equal(view.invoiceId, sale.id)
assert.equal(view.receiptNo, sale.receiptNo)
assert.equal(view.totalAmount, 1_000)
assert.equal(view.rows.length, 1)
const row = view.rows[0]
assert.equal(row.amount, 1_000)
assert.equal(row.credit.publicReference, `اعتبار #${issued.id}`)
assert.equal(row.credit.sourceLabel, 'صدور مدیریتی')
assert.equal(row.credit.remaining, 0)
assert.ok(row.redemptionId && row.paymentId, 'ردیف به هر دو رخداد redemption و Payment وصل است')
assert.deepEqual(after, before, 'خواندن زنجیره هیچ وضعیت یا مبلغی را تغییر نمی‌دهد')
console.log('  ✓ مسیر صدور → مصرف → فیش با DTO فقط‌خواندنی و امن برمی‌گردد')

console.log('--- ۲. کد و PII دارنده از DTO، متن و انتخاب‌های سرویس حذف‌اند ---')
const text = JSON.stringify(view)
for (const secret of [code, '09120000000', 'نشانی خصوصی', '0012345678', `یادداشت خصوصی ${code}`, 'legacyCode', 'holderPhone', 'holderAddress', 'holderNationalId', 'holderNote'])
  assert.equal(text.includes(secret), false, `نباید «${secret}» در پاسخ زنجیره باشد`)
assert.deepEqual(Object.keys(row.credit).sort(), ['expiresAtJalali', 'id', 'issuedAtJalali', 'publicReference', 'remaining', 'sourceLabel', 'status', 'statusLabel'].sort())
console.log('  ✓ فقط مرجع امن/منشأ/تاریخ/وضعیت/ماندهٔ مالی وجود دارد؛ credential و PII نیست')

console.log('--- ۳. کانال IPC با gate گزارش فروش محافظت می‌شود ---')
const ipc = readFileSync('src/main/ipc/index.ts', 'utf8')
assert.match(ipc, /handle\(IPC\.saleCreditSettlementLineage,[\s\S]{0,300}?assertPanelUnlocked\(PANEL_KEYS\.salesReports/)
assert.match(readFileSync('src/shared/ipc.ts', 'utf8'), /saleCreditSettlementLineage: 'sale:credit:settlement:lineage'/)
console.log('  ✓ invoke مستقیم بدون باز بودن پنل گزارش فروش اجازهٔ خواندن ندارد')

console.log('\n✓ زنجیرهٔ امن تسویه با اعتبار پاس شد.')
