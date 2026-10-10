/**
 * ===========================================================================
 * نشست ۱۴۳ · خوشه D · بند ۴-۲۹ — گیت main برای صدور دستی/گروهی اعتبار خرید
 *
 * «صدور دستی اعتبار خرید بدون فاکتور واقعی» یکی از چهار عملیاتی است که همیشه
 * رمز مدیر می‌خواهد. تا نشست ۱۴۲ تنها سد، Gate رندرر بود:
 *   ۱) storeCreditService.issueManual و bulkIssue هیچ assertManagerPassword نداشتند؛
 *   ۲) IPC.creditIssue / IPC.creditBulkIssue با withUser صدا زده می‌شدند، یعنی
 *      userId ارسالی renderer (actor قابل‌جعل) در Audit می‌نشست؛
 *   ۳) CreditManagement.tsx رمز مدیر را در payload نمی‌فرستاد.
 * انتظار: بدون رمز/رمز غلط ⇒ رد با پیام فارسی و صفر StoreCredit/Batch؛ با رمز
 * درست ⇒ صدور + Audit با actor.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s143-manual-credit-manager-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s143-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => (cond ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون رمز معتبر پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}
const credits = () => seed.count('StoreCredit', '1 = 1')
const batches = () => seed.count('StoreCreditBatch', '1 = 1')

const userId = seed.user('مدیر تست نشست ۱۴۳')
const PW = DEFAULT_MANAGER_PASSWORD

console.log('\n۱) صدور تکی دستی بدون رمز/رمز غلط ⇒ رد و صفر StoreCredit')
await rejects('issueManual بدون رمز', () => storeCreditService.issueManual({ amount: 500000, userId }), 'رمز مدیر')
await rejects('issueManual با رمز غلط', () => storeCreditService.issueManual({ amount: 500000, userId, managerPassword: 'غلط-۱۴۳' }), 'رمز')
eq('StoreCredit پس از دو تلاش ناموفق', credits(), 0)

console.log('\n۲) صدور گروهی بدون رمز/رمز غلط ⇒ رد و صفر Batch/StoreCredit')
await rejects('bulkIssue بدون رمز', () => storeCreditService.bulkIssue({ count: 3, amountEach: 100000, userId }), 'رمز مدیر')
await rejects('bulkIssue با رمز غلط', () => storeCreditService.bulkIssue({ count: 3, amountEach: 100000, userId, managerPassword: 'x' }), 'رمز')
eq('StoreCredit پس از تلاش گروهی ناموفق', credits(), 0)
eq('StoreCreditBatch پس از تلاش گروهی ناموفق', batches(), 0)

console.log('\n۳) با رمز درست ⇒ صدور + Audit با actor')
const one = await safe('issueManual با رمز مدیر', () => storeCreditService.issueManual({ amount: 500000, userId, managerPassword: PW }))
truthy('صدور تکی شناسهٔ امن دارد و کد را برنمی‌گرداند', /^اعتبار #\d+$/.test(String(one?.publicReference ?? '')) && !Object.hasOwn(one ?? {}, 'code'))
eq('StoreCredit پس از صدور تکی', credits(), 1)
const aud = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'StoreCredit' ORDER BY id DESC LIMIT 1`)
eq('actor Audit صدور تکی', aud?.userId, userId)
const bulk = await safe('bulkIssue با رمز مدیر', () => storeCreditService.bulkIssue({ count: 3, amountEach: 100000, userId, managerPassword: PW }))
eq('تعداد ساخته‌شده‌ی گروهی', bulk?.created, 3)
eq('StoreCredit پس از صدور گروهی', credits(), 4)

console.log('\n۴) سیم‌کشی IPC و رندرر')
const ipc = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
truthy('creditIssue با actor نشست (withSessionActor)', /handle\(IPC\.creditIssue, async \(p\) => storeCreditService\.issueManual\(await withSessionActor\(/.test(ipc))
truthy('creditBulkIssue با actor نشست (withSessionActor)', /handle\(IPC\.creditBulkIssue, async \(p\) => storeCreditService\.bulkIssue\(await withSessionActor\(/.test(ipc))
truthy('هیچ‌کدام دیگر withUser نیستند', !/handle\(IPC\.credit(?:Bulk)?Issue, async \(p\) => storeCreditService\.\w+\(await withUser\(/.test(ipc))
const ui = readFileSync(resolve('src/renderer/src/pages/CreditManagement.tsx'), 'utf8')
truthy('CreditManagement رمز مدیر را در payload صدور می‌فرستد', /managerPassword:\s*toLatinDigits\(issueManagerPw\)\.trim\(\)/.test(ui) && /type="password"/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
