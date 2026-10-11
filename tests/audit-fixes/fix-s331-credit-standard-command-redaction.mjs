// @ts-check
/**
 * ===========================================================================
 * نشست ۳۳۱ — پاسخ‌ IPCهای عادی اعتبار credential نیست
 *
 * lookup/preview و پاسخ عملیات صدور/تغییر/چاپ باید فقط DTO امن بدهند. کدی که
 * کاربر برای مصرف وارد می‌کند server-side اعتبارسنجی می‌شود اما دوباره به پاسخ
 * برنمی‌گردد؛ مشاهدهٔ کد فقط از credit:manager:code:reveal است.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s331-credit-standard-command-redaction.mjs
 * ===========================================================================
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s331-command-redaction-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const secret = 'CRS331NOSTANDARDRESPONSE'
const today = toJalaliDate(new Date())
const creditId = seed.insert('StoreCredit', {
  code: secret,
  amount: 500_000,
  status: 'ACTIVE',
  source: 'MANUAL',
  issuedAt: Date.now(),
  issuedAtJalali: today
})

const assertSafe = (label, value) => {
  assert.equal(Object.hasOwn(value ?? {}, 'code'), false, `${label}: فیلد code نباید باشد`)
  assert.equal(Object.hasOwn(value ?? {}, 'legacyCode'), false, `${label}: فیلد legacyCode نباید باشد`)
  assert.equal(JSON.stringify(value).includes(secret), false, `${label}: کد در هیچ مقدار پاسخ نباید باشد`)
  assert.match(String(value?.publicReference ?? ''), /^اعتبار #\d+$/, `${label}: شناسهٔ امن لازم است`)
  console.log(`  ✓ ${label}`)
}

console.log('--- ۱. lookup/preview کد را فقط ورودی می‌گیرند، نه خروجی ---')
const lookup = await storeCreditService.lookup({ code: secret })
assertSafe('lookup امن است', lookup)
const preview = await storeCreditService.preview({ code: secret, applicable: 500_000, invoiceTotal: 500_000, lines: [] })
assertSafe('preview.credit امن است', preview.credit)

console.log('--- ۲. پاسخ عملیات مدیریتی و چاپ، credential ندارد ---')
const suspended = await storeCreditService.suspend({ id: creditId, reason: 'آزمون redaction', managerPassword: DEFAULT_MANAGER_PASSWORD })
assertSafe('suspend امن است', suspended)
const reactivated = await storeCreditService.reactivate({ id: creditId, reason: 'بازگشت آزمون', managerPassword: DEFAULT_MANAGER_PASSWORD })
assertSafe('reactivate امن است', reactivated)
const printed = await storeCreditService.markPrinted({ id: creditId })
assertSafe('markPrinted امن است', printed)

console.log('--- ۳. صدور تکی و گروهی نیز فقط مرجع امن می‌دهند ---')
const issued = await storeCreditService.issueManual({ amount: 100_000, managerPassword: DEFAULT_MANAGER_PASSWORD })
assertSafe('issueManual امن است', issued)
const bulk = await storeCreditService.bulkIssue({ count: 2, amountEach: 75_000, managerPassword: DEFAULT_MANAGER_PASSWORD })
assert.equal(bulk.credits.length, 2)
for (const credit of bulk.credits) assertSafe('bulkIssue.credit امن است', credit)

console.log('--- ۴. قرارداد/UI مسیر امن را نگه می‌دارند ---')
const service = readFileSync('src/main/services/StoreCreditService.ts', 'utf8')
const invoice = readFileSync('src/renderer/src/pages/SalesInvoice.tsx', 'utf8')
const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
assert.match(service, /async lookup[\s\S]{0,420}shapeStoreCreditSafe/)
assert.match(service, /async preview[\s\S]{0,1000}credit: shapeStoreCreditSafe/)
assert.match(invoice, /call<StoreCreditSafeRow>\(CH\.storeCreditLookup/)
assert.match(pos, /call<StoreCreditSafeRow>\(CH\.storeCreditLookup/)
console.log('  ✓ سرویس و UI روی DTO امن‌اند')
