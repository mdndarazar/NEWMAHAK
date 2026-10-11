// @ts-check
/**
 * فاز ۳: تب legacy «اعتبار خرید» در گزارش فروش، مسیر عمومی است.
 * کد قابل‌مصرف نباید در DTO، جست‌وجو، جدول، چاپ یا Excel آن باقی بماند.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s328-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const day = '1405/07/19'
const secret = 'REPORT-328-NOT-FOR-STAFF'
const at = jalaliStartOfDay(day)
const creditId = seed.insert('StoreCredit', {
  code: secret,
  amount: 840_000,
  usedAmount: 120_000,
  usedCount: 1,
  status: 'PARTIALLY_USED',
  source: 'MANUAL',
  issuedAt: at,
  issuedAtJalali: day,
  issuedAtTime: '09:00:00',
  createdAt: at,
  updatedAt: at
})

console.log('--- ۱. DTO گزارش کد ندارد و مبلغ/وضعیت دست‌نخورده‌اند ---')
const rows = await storeCreditService.reportList({ fromJalali: day, toJalali: day })
const row = rows.find((item) => item.id === creditId)
assert.ok(row, 'اعتبار در همان بازهٔ گزارش پیدا می‌شود')
assert.equal(Object.hasOwn(row, 'code'), false, 'DTO عمومی نباید property code داشته باشد')
assert.equal(row.publicReference, `اعتبار #${creditId}`, 'ردیابی گزارش با شناسهٔ غیرقابل‌مصرف انجام می‌شود')
assert.equal(row.amount, 840_000, 'مبلغ اولیه نباید با redaction تغییر کند')
assert.equal(row.usedAmount, 120_000, 'مبلغ مصرف‌شده نباید تغییر کند')
assert.equal(row.remaining, 720_000, 'ماندهٔ گزارش باید همان منطق قبلی باشد')
assert.equal(row.status, 'PARTIALLY_USED', 'طبقه‌بندی وضعیت نباید تغییر کند')
assert.doesNotMatch(JSON.stringify(rows), new RegExp(secret), 'کد در سریال‌سازی payload گزارش نباید باشد')
console.log('  ✓ گزارش فقط شناسهٔ امن می‌گیرد؛ اعداد و وضعیت ثابت‌اند')

console.log('--- ۲. گزارش از کد به‌عنوان oracle جست‌وجو استفاده نمی‌کند ---')
const probed = await storeCreditService.reportList({ fromJalali: day, toJalali: day, search: secret })
assert.equal(probed.length, rows.length, 'search کد نباید نتیجهٔ گزارش را محدود یا وجود آن را افشا کند')
assert.doesNotMatch(JSON.stringify(probed), new RegExp(secret))
console.log('  ✓ فیلتر گزارش، جست‌وجوی کد را حذف می‌کند')

console.log('--- ۳. UI/چاپ/Excel نیز فقط شناسهٔ امن را مصرف می‌کنند ---')
const reports = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
assert.match(reports, /شناسهٔ امن اعتبار/)
assert.match(reports, /r\.publicReference \?\? `اعتبار #\$\{r\.id \?\? '—'\}`/)
assert.match(reports, /r\.publicReference \?\? `اعتبار #\$\{r\.id \?\? ''\}`/)
assert.doesNotMatch(reports, /STORE_CREDIT_OUTPUT_HEADERS[\s\S]{0,220}کد اعتبار/)
assert.doesNotMatch(reports, /storeCreditRows\.map\([\s\S]{0,300}r\.code/)
console.log('  ✓ عنوان و خروجی‌های گزارش به code رجوع نمی‌کنند')
