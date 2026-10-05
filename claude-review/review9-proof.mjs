/**
 * ===========================================================================
 * بازبینی نهم — اثبات رفتاری (دیتابیس هارنس، پل واقعی بوت).
 *
 *     node --import ./test/harness/register.mjs claude-review/review9-proof.mjs
 *
 * SMS-R9-01 — «گرسنگیِ فهرست کاندیدها»: `reminderCandidates` فیلتر «سررسید»
 *             را **بعد از** `take` اعمال می‌کند و ترتیب پرس‌وجو `issuedAt: asc`
 *             است. پس در فروشگاهی که چند صد اعتبار قدیمیِ سقف‌پر دارد، پنجره‌ی
 *             ۲۰۰تاییِ زمان‌بند خودکار همیشه از همان‌های بی‌فایده پر می‌شود و
 *             اعتبارِ واجد شرایطِ تازه هیچ‌وقت دیده نمی‌شود ⇒ یادآوری خودکار
 *             هرگز نمی‌رود (بی‌صدا).
 *
 * رفتار درست: پنجره‌ی خواندن باید همان چیزی را برگرداند که «سررسید» است —
 * یعنی تعداد ردیف‌های واجد شرایطِ برگشته نباید به سقف بخورد، و اعتبار تازه
 * باید در فهرست باشد.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-r9-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const svc = await import('../src/main/services/StoreCreditService.ts')
const notify = await import('../src/main/services/NotificationSender.ts')
const { runSmsAutoOnce } = await import('../src/main/services/sms/SmsService.ts')
const { smsNotificationSender } = await import('../src/main/services/sms/SmsNotificationSender.ts')
const { setSmsReminderSource } = await import('../src/main/services/sms/SmsService.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر بازبینی ۹')
const DAY = 86_400_000

let bugs = 0
let good = 0
const check = (label, isBug, detail) => {
  if (isBug) bugs++
  else good++
  console.log(`  ${isBug ? '× باگ' : '✓ رفتار درست'} · ${label} · ${detail}`)
}

// پل واقعی بوت (main/index.ts): یادآوری اعتبار ← صف پیامک
notify.setNotificationSender(smsNotificationSender)
setSmsReminderSource({
  name: 'یادآوری اعتبار خرید',
  candidates: async ({ limit }) => {
    const res = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: limit ?? 200 })
    return (res?.rows ?? []).map((r) => ({ id: r?.credit?.id ?? r?.id })).filter((r) => Number.isFinite(r.id))
  },
  queue: async ({ id, userId: u }) => svc.storeCreditService.queueReminder({ id, userId: u ?? null })
})

// برای اینکه «یادآوری» واقعاً در صف بنشیند، یک خط فعال لازم است
await smsCredentialService.save({
  providerKey: 'LOG_ONLY',
  name: 'خط بازبینی ۹',
  purpose: 'SERVICE',
  isActive: true,
  userId
})

// ۲۰۰ اعتبار قدیمی که دیگر «سررسید» نیستند (سقف ۳ یادآوری پر شده — حالت عادی بعد از چند ماه کار)
const oldIds = []
const OLD = Number(process.env.OLD ?? 200)
for (let i = 0; i < OLD; i++) {
  const c = await svc.issueStoreCredit(db, {
    amount: 1_000_000,
    holderPhone: `0912${String(1000000 + i)}`,
    source: 'MANUAL',
    userId
  })
  sql
    .prepare('UPDATE "StoreCredit" SET issuedAt = ?, reminderCount = 3, lastReminderAt = ? WHERE id = ?')
    .run(Date.now() - (400 - i * 0.1) * DAY, Date.now() - 60 * DAY, c.id)
  oldIds.push(c.id)
}
// یک اعتبار تازه‌تر که کاملاً واجد شرایط است: ۴۰ روز پیش صادر شده، هیچ یادآوری نگرفته، شماره‌ی معتبر دارد
const fresh = await svc.issueStoreCredit(db, { amount: 4_000_000, holderPhone: '09129998877', source: 'MANUAL', userId })
sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, fresh.id)

const full = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 5000 })
const cut = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 200 })
console.log('\nA) فهرست کاندیدها')
console.log('   بدون سقف =', full.rows.map((r) => r.credit.id), '· با take=200 (همان مقدار زمان‌بند) =', cut.rows.map((r) => r.credit.id))
console.log('   شناسه‌ی اعتبار تازه =', fresh.id)

check(
  'پنجره‌ی ۲۰۰تاییِ زمان‌بند، اعتبارِ واجد شرایط را می‌بیند',
  !cut.rows.some((r) => r.credit.id === fresh.id),
  `take=200 ⇒ ${cut.rows.length} ردیف · شامل اعتبار تازه؟ ${cut.rows.some((r) => r.credit.id === fresh.id) ? 'بله' : 'نه'}`
)
check(
  'و هیچ ردیفِ «سقف‌پر» در فهرست سررسیدها نیست',
  cut.rows.some((r) => Number(r.credit.reminderCount) >= 3),
  `${cut.rows.filter((r) => Number(r.credit.reminderCount) >= 3).length} ردیفِ سقف‌پر در فهرست`
)

await sql
  .prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)')
  .run('sms.auto', JSON.stringify({ enabled: true, hour: 10, minute: 0, askOnEnable: false }))
const run = await runSmsAutoOnce(new Date(2026, 9, 4, 10, 5), userId)
const queued = sql.prepare(`SELECT COUNT(*) c FROM "SmsOutbox" WHERE eventType='CREDIT_REMINDER'`).get().c
console.log('B) زمان‌بند خودکار:', run)
console.log('   ردیف‌های CREDIT_REMINDER در صف =', queued)

check(
  'زمان‌بند خودکار، یادآوریِ اعتبارِ واجد شرایط را در صف می‌گذارد',
  queued === 0,
  `queued=${run?.queued} · ردیف‌های صف=${queued}`
)
check('و در نتیجه‌اش می‌گوید چند تا ثبت شد', !(run?.queued >= 1), `queued=${run?.queued}`)

// ---------------------------------------------------------------------------
console.log('\nC) پویش صفحه‌به‌صفحه: ردیف‌هایی که پیش‌فیلتر SQL نمی‌گیرد (بی‌شماره)')
{
  /**
   * این ردیف‌ها با هیچ شرطِ SQL‌ای قابل رد نیستند (شماره‌ی دارنده در جدول
   * دیگری است و این‌جا خالی است ⇒ تصمیم `NO_PHONE` می‌دهد). اگر پیاده‌سازی فقط
   * یک صفحه‌ی ۵۰۰تایی بخواند و تسلیم شود، اعتبارِ واجد شرایطِ ته جدول دیده
   * نمی‌شود. رفع باید تا پیدا شدنِ ردیفِ واجد شرایط ادامه دهد.
   */
  for (let i = 0; i < 600; i++) {
    const c = await svc.issueStoreCredit(db, { amount: 500_000, source: 'MANUAL', userId })
    sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - (500 - i * 0.01) * DAY, c.id)
  }
  const buried = await svc.issueStoreCredit(db, { amount: 5_000_000, holderPhone: '09129990001', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 50 * DAY, buried.id)

  const pageScan = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 5 })
  const ids = pageScan.rows.map((r) => r.credit.id)
  check(
    'اعتبارِ واجد شرایطِ ته جدول (پشتِ ۶۰۰ ردیف بی‌شماره) پیدا می‌شود',
    !ids.includes(buried.id),
    `take=5 ⇒ ${ids.length} ردیف · شامل ${buried.id}؟ ${ids.includes(buried.id) ? 'بله' : 'نه'}`
  )
  check(
    'و همه‌ی ردیف‌های برگشته واقعاً واجد شرایط‌اند (بی‌شماره هیچ‌وقت نمی‌آید)',
    pageScan.rows.some((r) => !r.phone || !r.should),
    `${pageScan.rows.filter((r) => !r.phone).length} ردیفِ بی‌شماره در فهرست`
  )
}

console.log(`\n${good} رفتار درست · ${bugs} باگ اثبات‌شده`)
process.exit(bugs === 0 ? 0 : 1)
