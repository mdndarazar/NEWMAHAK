// @ts-check
/**
 * فاز ۳ — کد قابل‌مصرف اعتبار نباید در AuditLogهای تازه ذخیره شود.
 *
 * این آزمون قرارداد مسیرهای تولیدکننده‌ی لاگ را نگه می‌دارد و صدور/تلاش
 * ناموفق را روی harness واقعاً بررسی می‌کند. نمایش تاریخچه‌ی قدیمی همچنان با
 * redaction زمان خواندن سازگار می‌ماند و افشای مدیر تنها از مسیر اختصاصی
 * revealManagerCode انجام می‌شود.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s344-credit-audit-redaction.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s344-credit-audit-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const source = readFileSync('src/main/services/StoreCreditService.ts', 'utf8')

// صدور، مصرف، تلاش ناموفق و تولید گروهی به شناسه/طول کد متکی‌اند، نه credential.
assert.match(source, /creditId: created\.id,\n\s+publicReference: `اعتبار #\$\{created\.id\}`/)
assert.doesNotMatch(source, /after:\s*JSON\.stringify\(\{\s*code:\s*created\.code/)
assert.match(source, /credentialRedacted: true/)
assert.doesNotMatch(source, /after:\s*JSON\.stringify\(\{ code: normalizeCreditCode\(rawCode\)/)
assert.match(source, /creditId: credit\.id,\n\s+status: credit\.status,\n\s+usedAmount: usedAmountBefore/)
assert.match(source, /remainderCreditId: remainder\?\.id \?\? null/)
assert.match(source, /after: JSON\.stringify\(\{ creditId: r\.id, codeLength: r\.code\.length, amount: amountEach/)

// عملیات lifecycle، حذف، چاپ و یادآوری نیز قبل از persistence پاک‌سازی می‌شوند.
assert.match(source, /before: redactCreditAuditPayload\(JSON\.stringify\(built\.before\), row\.code\)/)
assert.match(source, /note: redactCreditCodeText\(`\$\{built\.note\} · دلیل: \$\{reason\}`, row\.code\)/)
assert.match(source, /before: redactCreditAuditPayload\(log\.before, row\.code\)/)
assert.match(source, /before: redactCreditAuditPayload\(log\.before, r\.code\)/)
assert.match(source, /before: JSON\.stringify\(\{ creditId: row\.id, status: row\.status, usedAmount: row\.usedAmount, redemptions \}\)/)
assert.match(source, /ثبت یادآوری اعتبار #\$\{row\.id\}/)
assert.match(source, /یادآوری اعتبار #\$\{creditId\} پذیرفته شد/)

// لایه‌ی نمایش برای historical rows باقی می‌ماند و مسیر reveal همچنان server-authorized است.
assert.match(source, /before: redactCreditAuditPayload\(l\.before, row\.code\)/)
assert.match(source, /note: redactCreditCodeText\(l\.note, row\.code\) \|\| null/)
assert.match(source, /async revealManagerCode/)
assert.match(source, /assertManagerSession\('نمایش کد اعتبار خرید'\)/)

// دو مسیر واقعی نماینده: صدور و تلاش ناموفق. هیچ payload/note پایدار نباید credential را داشته باشد.
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { issueStoreCredit, guardCreditCode } = await import('../../src/main/services/StoreCreditService.ts')
const db = harnessClient()
const issuedSecret = 'S344-ISSUE-REDEEMABLE-SECRET'
const attemptedSecret = 'S344-FAILED-REDEEMABLE-SECRET'
await issueStoreCredit(db, { amount: 250_000, source: 'MANUAL', code: issuedSecret })
await assert.rejects(() => guardCreditCode(attemptedSecret), /اعتبار|کد/)

const freshAudits = await db.auditLog.findMany({ orderBy: { id: 'asc' } })
assert.ok(freshAudits.length >= 2, 'صدور و تلاش ناموفق هر دو باید Audit داشته باشند')
for (const row of freshAudits) {
  const persisted = [row.before, row.after, row.note].filter(Boolean).join('\n')
  assert.ok(!persisted.includes(issuedSecret), 'کد صدور نباید در AuditLog تازه باشد')
  assert.ok(!persisted.includes(attemptedSecret), 'کد تلاش ناموفق نباید در AuditLog تازه باشد')
}

console.log('✓ AuditLogهای تازهٔ اعتبار، credential قابل‌مصرف ذخیره نمی‌کنند؛ تاریخچه و reveal مدیر محفوظ‌اند.')
