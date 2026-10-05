/**
 * ===========================================================================
 * بازبینی هشتم — اثبات رفتاری (fetch جعلی، دیتابیس هارنس).
 *
 *     node --import ./test/harness/register.mjs claude-review/review8-proof.mjs
 *
 * SMS-R8-01 — سقف ۷۲ ساعته‌ی «منتظرِ شرایط» از `createdAt` شمرده می‌شد، نه از
 *             شروعِ انتظار. پیامی که برای ۴ روز بعد **زمان‌بندی** شده (UI و
 *             `sendManual` اجازه می‌دهند) سرِ موعد با اولین خطای موقتی (قطعی
 *             اینترنت / اتمام اعتبار) فوراً `FAILED_FINAL` می‌شد و بعد از رفع
 *             مشکل هم خودکار نمی‌رفت.
 *
 * رفتار درست: سنِ انتظار از لحظه‌ای شمرده می‌شود که انتظار واقعاً شروع شده
 * (اولین تلاشِ `WAITING`)، نه از لحظه‌ی ثبت ردیف.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-r8-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { runSmsQueueOnce } = await import('../src/main/services/sms/SmsQueue.ts')
const { smsService } = await import('../src/main/services/sms/SmsService.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const sql = db.$harness.db
const userId = makeSeeder(db).user('مدیر بازبینی ۸')
let bugs = 0
let good = 0
const check = (label, isBug, detail) => {
  if (isBug) bugs++
  else good++
  console.log(`  ${isBug ? '× باگ' : '✓ رفتار درست'} · ${label} · ${detail}`)
}

await smsCredentialService.save({
  providerKey: 'KAVENEGAR',
  name: 'k',
  senderNumber: '10004346',
  purpose: 'BOTH',
  secrets: { apiKey: 'KEY-R8' },
  managerPassword: PW,
  isActive: true,
  userId
})

let outage = true
let posts = 0
globalThis.fetch = async () => {
  posts++
  if (outage) {
    const e = new TypeError('fetch failed')
    e.cause = { code: 'ENOTFOUND' }
    throw e
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ return: { status: 200, message: 'ok' }, entries: [{ messageid: 7 }] })
  }
}

const DAY = 24 * 3600 * 1000
const row = (id) =>
  sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(id)

// ---------------------------------------------------------------------------
console.log('\nA) پیام دستی زمان‌بندی‌شده برای ۴ روز بعد (مسیر واقعی UI → IPC → sendManual)')
const when = new Date(Date.now() + 4 * DAY)
const r = await smsService.sendManual({ phone: '09121112233', body: 'یادآوری قرار جمعه', scheduledAt: when, userId })
const before = row(r.id)
check(
  'sendManual زمان‌بندیِ ۴ روزه را می‌پذیرد',
  !(Number(before.scheduledAt) - Number(before.createdAt) > 3 * DAY),
  `scheduledAt - createdAt ≈ ${((Number(before.scheduledAt) - Number(before.createdAt)) / DAY).toFixed(2)} روز`
)

// گذشت زمان: ۴ روز و ۱ دقیقه (هر دو زمان را به‌اندازه‌ی یکسان عقب می‌بریم)
const shift = 4 * DAY + 60_000
sql
  .prepare(
    'UPDATE "SmsOutbox" SET createdAt = createdAt - ?, scheduledAt = scheduledAt - ?, nextAttemptAt = nextAttemptAt - ? WHERE id = ?'
  )
  .run(shift, shift, shift, r.id)

posts = 0
await runSmsQueueOnce() // موعد رسیده؛ اولین تلاش با قطعی اینترنت روبه‌رو می‌شود
const after1 = row(r.id)
check(
  'اولین تلاش با قطعی اینترنت: پیام باید منتظر بماند (FAILED_RETRYABLE)',
  after1.status !== 'FAILED_RETRYABLE',
  `وضعیت=${after1.status} · تلاش=${after1.attemptCount} · POST=${posts}`
)

outage = false // اینترنت وصل شد
sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, r.id)
await runSmsQueueOnce()
const after2 = row(r.id)
check('بعد از رفع مشکل، خودکار می‌رود', after2.status !== 'SENT', `وضعیت=${after2.status}`)

// ---------------------------------------------------------------------------
console.log('\nA-2) ضدکنترل: انتظارِ واقعیِ ۷۲ ساعت گذشته ⇒ قطعی می‌شود (در صف نمی‌چرخد)')
{
  outage = true
  const late = await smsService.sendManual({ phone: '09121112255', body: 'زمان‌بندی‌شده کهنه', scheduledAt: when, userId })
  const shift2 = 4 * DAY + 60_000
  sql
    .prepare('UPDATE "SmsOutbox" SET createdAt = createdAt - ?, scheduledAt = scheduledAt - ?, nextAttemptAt = nextAttemptAt - ? WHERE id = ?')
    .run(shift2, shift2, shift2, late.id)
  // یک تلاش واقعی که نتیجه‌اش WAITING ثبت شده و **بیش از ۷۲ ساعت** قبل بوده
  await runSmsQueueOnce()
  const att = sql.prepare('SELECT * FROM "SmsAttempt" WHERE outboxId = ? ORDER BY id ASC LIMIT 1').get(late.id)
  sql
    .prepare('UPDATE "SmsAttempt" SET startedAt = ? WHERE id = ?')
    .run(Date.now() - 73 * 3600 * 1000, att.id)
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, late.id)
  await runSmsQueueOnce()
  const stale = row(late.id)
  check(
    '۷۳ ساعت انتظار ⇒ «ناموفق قطعی» (ولی پاک نمی‌شود)',
    stale.status !== 'FAILED_FINAL',
    `وضعیت=${stale.status} · تلاش=${stale.attemptCount}`
  )
}

// ---------------------------------------------------------------------------
console.log('\nB) ضدکنترل: پیام معمولی با همان قطعی')
outage = true
const ctl = await smsService.sendManual({ phone: '09121112244', body: 'پیام معمولی', userId })
sql.prepare('UPDATE "SmsOutbox" SET createdAt = createdAt - ? WHERE id = ?').run(DAY / 24, ctl.id)
await runSmsQueueOnce()
const c = row(ctl.id)
check('پیام تازه در قطعی منتظر می‌ماند (کنترل)', c.status !== 'FAILED_RETRYABLE', `وضعیت=${c.status}`)

console.log(`\n${good} رفتار درست · ${bugs} باگ`)
process.exit(bugs === 0 ? 0 : 1)
