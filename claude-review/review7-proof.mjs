/**
 * ===========================================================================
 * بازبینی هفتم — اثبات رفتاری (fetch جعلی، دیتابیس هارنس).
 *
 *     node --import ./test/harness/register.mjs claude-review/review7-proof.mjs
 *
 * SMS-R7-01 — سقف ۵ تلاش (≈۸۱ دقیقه) روی شکست‌های «منتظرِ شرایط» (قطعی
 *             اینترنت، کمبود اعتبار، ۴۰۹/۴۲۹/۵۰۳) اعمال می‌شد ⇒ پیام
 *             `FAILED_FINAL` می‌شد و بعد از رفع مشکل (شارژ/وصل‌شدن اینترنت)
 *             خودکار نمی‌رفت. کمپین ۱۰۰۰ نفره‌ای که وسطش اعتبار تمام شود باید
 *             ۱۰۰۰ بار دستی «برگرداندن به صف» می‌خورد.
 *
 * رفتار درست: این شکست‌ها سهمیه‌ی تلاش را نمی‌سوزانند، با فاصله‌ی ثابت یک ساعت
 * تا سقف ۷۲ ساعت ادامه می‌دهند، و به‌محض رفع مشکل خودکار می‌روند.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-r7-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { enqueueSms, runSmsQueueOnce } = await import('../src/main/services/sms/SmsQueue.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const smsShared = await import('@shared/sms')
const { smsDedupeKey } = smsShared
/**
 * مقادیر موردانتظار — اگر ثابت‌های محصول نبودند، همان عددهای طراحی می‌مانند تا
 * این فایل **قبل از رفع** هم قابل اجرا باشد و باگ را نشان دهد (نه اینکه بترکد).
 */
const WAIT_BACKOFF_MS = smsShared.SMS_WAITING_BACKOFF_MS ?? 60 * 60 * 1000
const WAIT_MAX_AGE_MS = smsShared.SMS_WAITING_MAX_AGE_MS ?? 72 * 60 * 60 * 1000
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const sql = db.$harness.db
const userId = makeSeeder(db).user('مدیر بازبینی ۷')
const realFetch = globalThis.fetch
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
  secrets: { apiKey: 'KEY-R7' },
  managerPassword: PW,
  isActive: true,
  userId
})

const scenarios = [
  [
    'کمبود اعتبار (کاوه‌نگار ۴۱۸)',
    () => ({ ok: true, status: 200, text: async () => JSON.stringify({ return: { status: 418, message: 'x' }, entries: null }) })
  ],
  [
    'قطعی اینترنت (ENOTFOUND)',
    () => {
      const e = new TypeError('fetch failed')
      e.cause = { code: 'ENOTFOUND' }
      throw e
    }
  ]
]
const OK = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ return: { status: 200, message: 'ok' }, entries: [{ messageid: 1 }] })
})

let n = 0
for (const [label, failing] of scenarios) {
  n++
  const first = n === 1
  let outage = true
  let posts = 0
  globalThis.fetch = async () => {
    posts++
    return outage ? failing() : OK()
  }
  const r = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09121112233',
    body: `تست ${n}`,
    dedupeKey: smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: `r7-${n}`, phone: '09121112233' })
  })
  const row = () => sql.prepare('SELECT status, attemptCount, nextAttemptAt, createdAt FROM "SmsOutbox" WHERE id = ?').get(r.id)

  // ۵ دور با همان فاصله‌های backoff (۱+۵+۱۵+۶۰ دقیقه ≈ ۸۱ دقیقه) — تاریخ را عقب می‌بریم.
  for (let i = 0; i < 6; i++) {
    await runSmsQueueOnce()
    sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ? AND status = ?').run(Date.now() - 1000, r.id, 'FAILED_RETRYABLE')
  }
  // یک دور دیگر بدون عقب‌بردن تاریخ، تا خودِ فاصله‌ی بعدی را اندازه بگیریم
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, r.id)
  await runSmsQueueOnce()
  const mid = row()
  check(
    `${label}: بعد از ۶ دور، پیام همچنان در صف است (سهمیه نسوخته)`,
    mid.status !== 'FAILED_RETRYABLE',
    `وضعیت=${mid.status} · تلاش‌ها=${mid.attemptCount}`
  )
  check(
    `${label}: فاصله‌ی تلاش بعدی = یک ساعت ثابت`,
    Math.abs(Number(mid.nextAttemptAt) - Date.now() - WAIT_BACKOFF_MS) > 60_000,
    `nextAttemptAt≈+${Math.round((Number(mid.nextAttemptAt) - Date.now()) / 60000)}د`
  )

  outage = false // مشکل رفع شد (شارژ/وصل‌شدن اینترنت)
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, r.id)
  await runSmsQueueOnce()
  const end = row()
  check(
    `${label}: بعد از رفع مشکل، پیام خودکار می‌رود`,
    end.status !== 'SENT',
    `وضعیت نهایی=${end.status} · تلاش‌ها=${end.attemptCount} · POST=${posts}`
  )

  if (!first) continue

  // ── و ضدکنترل: سقف سنی ۷۲ ساعت (ردیفِ کهنه نباید تا ابد در صف بچرخد)
  n++
  outage = true
  posts = 0
  const old = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09121112233',
    body: `تست کهنه ${n}`,
    dedupeKey: smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: `r7-old-${n}`, phone: '09121112233' })
  })
  /**
   * ⚠️ بازبینی هشتم نشان داد سنِ انتظار از `createdAt` شمرده نمی‌شود؛ پس این
   * ضدکنترل هم با **سابقه‌ی تلاش** ساخته می‌شود: یک انتظار واقعی ثبت می‌کنیم و
   * همان را ۷۳ ساعت کهنه می‌کنیم.
   */
  await runSmsQueueOnce()
  const firstWait7 = sql.prepare('SELECT id FROM "SmsAttempt" WHERE outboxId = ? ORDER BY id ASC LIMIT 1').get(old.id)
  sql.prepare('UPDATE "SmsAttempt" SET startedAt = ? WHERE id = ?').run(Date.now() - WAIT_MAX_AGE_MS - 3600_000, firstWait7.id)
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, old.id)
  await runSmsQueueOnce()
  globalThis.fetch = realFetch
  const stale = sql.prepare('SELECT status, attemptCount FROM "SmsOutbox" WHERE id = ?').get(old.id)
  check(
    'ردیفِ کهنه‌تر از ۷۲ ساعت ⇒ «ناموفق قطعی» می‌شود (در صف نمی‌چرخد)',
    stale.status !== 'FAILED_FINAL',
    `وضعیت=${stale.status} · تلاش‌ها=${stale.attemptCount}`
  )
}

globalThis.fetch = realFetch
console.log(`\nخلاصه: ${good} رفتار درست · ${bugs} باگ اثبات‌شده`)
process.exit(bugs === 0 ? 0 : 1)
