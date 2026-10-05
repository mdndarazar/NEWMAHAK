/**
 * ===========================================================================
 * بازبینی ششم — اثبات رفتاری (fetch جعلی، دیتابیس هارنس).
 *
 *     node --import ./test/harness/register.mjs claude-review/review6-proof.mjs
 *
 * دو باگ گزارش‌شده:
 *   SMS-R6-01 — کاوه‌نگار وقتی «همان کد» را در HTTP هم برمی‌گرداند (۴۱۸/۴۰۹)،
 *               پاسخ به `httpFailure` می‌رفت و آنجا قطعی حساب می‌شد ⇒ پیام بعد
 *               از شارژ حساب هم خودکار نمی‌رفت.
 *   SMS-R6-02 — HTTP ۵۰۰/۵۰۲/۵۰۴ «قابل تلاش مجدد» بود ⇒ صف خودکار دوباره
 *               می‌فرستاد؛ در حالی که این پاسخ‌ها یعنی «نمی‌دانیم رفت یا نه».
 *
 * این فایل رفتارِ *واقعی* صف را روی دیتابیس هارنس می‌سنجد؛ نه شکل کد.
 * قبل از رفع: ۰ رفتار درست · ۵ باگ — بعد از رفع: باید برعکس شود.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-r6-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { enqueueSms, runSmsQueueOnce } = await import('../src/main/services/sms/SmsQueue.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const { smsDedupeKey } = await import('@shared/sms')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر بازبینی ۶')
const outbox = (id) => sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(id)

let bugs = 0
let good = 0
const check = (label, isBug, detail) => {
  if (isBug) {
    bugs++
    console.log(`  × باگ · ${label} · ${detail}`)
  } else {
    good++
    console.log(`  ✓ رفتار درست · ${label} · ${detail}`)
  }
}
const key = (n) => smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: `r6-${n}`, phone: '09121112233' })
const realFetch = globalThis.fetch

async function onlyLine(providerKey) {
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  return smsCredentialService.save({
    providerKey,
    name: providerKey,
    senderNumber: '10004346',
    purpose: 'BOTH',
    secrets: { apiKey: 'KEY-R6' },
    managerPassword: PW,
    isActive: true,
    userId
  })
}

// ---------------------------------------------------------------------------
console.log('\n۱) کاوه‌نگار: «اعتبار کافی نیست» وقتی با HTTP 418 (هم‌کد return.status) برمی‌گردد')
for (const code of [418, 409]) {
  await onlyLine('KAVENEGAR')
  globalThis.fetch = async () => ({
    ok: false,
    status: code,
    text: async () => JSON.stringify({ return: { status: code, message: 'x' }, entries: null })
  })
  const r = await enqueueSms({ eventType: 'MANUAL', phone: '09121112233', body: `تست ${code}`, dedupeKey: key(`kav-${code}`) })
  await runSmsQueueOnce()
  globalThis.fetch = realFetch
  const row = outbox(r.id)
  check(
    `HTTP ${code} ⇒ در صف می‌ماند، «ناموفق قطعی» نمی‌شود`,
    row.status !== 'FAILED_RETRYABLE',
    `status=${row.status} · code=${row.lastErrorCode}`
  )
}

// ---------------------------------------------------------------------------
console.log('\n۲) پاسخ ۵۰۰/۵۰۲/۵۰۴ بعد از رسیدن درخواست ⇒ تلاش خودکار ممنوع (پیام دوم نمی‌رود)')
for (const code of [504, 502, 500]) {
  await onlyLine('SMS_IR')
  let posts = 0
  globalThis.fetch = async () => {
    posts++
    return posts === 1
      ? { ok: false, status: code, text: async () => '<html>gateway</html>' }
      : { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: { packId: 'p' } }) }
  }
  const r = await enqueueSms({ eventType: 'MANUAL', phone: '09121112233', body: `تست ${code}`, dedupeKey: key(`ir-${code}`) })
  await runSmsQueueOnce()
  const mid = outbox(r.id).status
  // اگر صف «قابل تلاش مجدد» گذاشته باشد، این تاریخ گذشته او را دوباره می‌فرستد.
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, r.id)
  await runSmsQueueOnce()
  globalThis.fetch = realFetch
  const final = outbox(r.id).status
  check(
    `HTTP ${code} ⇒ فقط یک POST برای همان ردیف`,
    posts !== 1,
    `بعد از دور اول=${mid} · تعداد POST به سرویس‌دهنده برای همان ردیف=${posts} · نهایی=${final}`
  )
}

// ---------------------------------------------------------------------------
console.log('\n۳) ضدکنترل: ۵۰۳ و ۴۲۹ همچنان «موقتی»‌اند (تأخیر مجاز، گم‌شدن هرگز)')
{
  await onlyLine('SMS_IR')
  let posts = 0
  globalThis.fetch = async () => {
    posts++
    return posts === 1
      ? { ok: false, status: 503, text: async () => 'maintenance' }
      : { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: { packId: 'p' } }) }
  }
  const r = await enqueueSms({ eventType: 'MANUAL', phone: '09121112233', body: 'تست 503', dedupeKey: key('ir-503') })
  await runSmsQueueOnce()
  const mid = outbox(r.id).status
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, r.id)
  await runSmsQueueOnce()
  globalThis.fetch = realFetch
  const final = outbox(r.id).status
  check(
    'HTTP 503 ⇒ دوباره تلاش می‌شود و بالاخره می‌رود',
    !(posts >= 2 && final === 'SENT'),
    `بعد از دور اول=${mid} · posts=${posts} · نهایی=${final}`
  )
}

console.log(`\nخلاصه: ${good} رفتار درست · ${bugs} باگ اثبات‌شده`)
process.exit(bugs === 0 ? 0 : 1)
