/**
 * ===========================================================================
 * بازبینی چهارم — دو باگ «سهمیه‌ی یادآوری» (تست نگهبان؛ بخشی از محصول نیست)
 *
 *     node --import ./test/harness/register.mjs claude-review/review4-proof.mjs
 *
 * ریشه‌ی هر دو باگ یکی است: سهمیه آزاد می‌شود ولی پیام بعداً **واقعاً می‌رود**
 * و سهمیه برنمی‌گردد ⇒ فردا همان یادآوری دوباره فرستاده می‌شود.
 *   • R4-1: «برگرداندن به صف»/«تلاش مجدد» روی یادآوریِ لغو‌شده.
 *   • R4-2: «لغو گروهی» روی ردیف‌هایی که از قبل لغو بودند هم CANCELED می‌فرستد
 *           ⇒ سهمیه‌ی یادآوریِ **تحویل‌شده** آزاد می‌شود.
 *
 * این فایل رفتار درست را می‌سنجد، پس قبل از رفع «×» و بعد از رفع «✓» می‌دهد.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-review4-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { runSmsQueueOnce, smsQueueService, setSmsOutcomeHook, enqueueSms } = await import(
  '../src/main/services/sms/SmsQueue.ts'
)
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const { smsNotificationSender } = await import('../src/main/services/sms/SmsNotificationSender.ts')
const notify = await import('../src/main/services/NotificationSender.ts')
const { storeCreditService, issueStoreCredit } = await import('../src/main/services/StoreCreditService.ts')
const { smsReminderManualResendBlocked } = await import('@shared/sms')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('بازبینی ۴')
const DAY = 86_400_000

let ok = 0
let bad = 0
const show = (label, cond, extra = '') => {
  if (cond) ok++
  else bad++
  console.log(`  ${cond ? '✓ رفتار درست' : '× باگ'} · ${label}${extra ? ' · ' + extra : ''}`)
}

const drain = async () => {
  for (let i = 0; i < 60; i++) if (!(await runSmsQueueOnce()).picked) break
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sent = (p) =>
  sql.prepare(`SELECT COUNT(*) n FROM "SmsOutbox" WHERE phoneSnapshot = ? AND status = 'SENT'`).get(p).n
const cr = (id) => sql.prepare('SELECT reminderCount, lastReminderAt FROM "StoreCredit" WHERE id = ?').get(id)
const lastLog = (id) =>
  sql.prepare('SELECT status FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC LIMIT 1').get(id)

notify.setNotificationSender(smsNotificationSender)
// همان دوختِ بوت
setSmsOutcomeHook((e) => {
  if (String(e?.eventType ?? '') !== 'CREDIT_REMINDER') return
  if (e.outcome !== 'FAILED_FINAL' && e.outcome !== 'CANCELED') return
  void storeCreditService.onReminderUndelivered({
    creditId: e.relatedEntityId,
    phone: e.phone,
    outboxId: e.outboxId,
    outcome: e.outcome,
    detail: e.detail
  })
})
await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط', purpose: 'BOTH', isActive: true, userId })

async function eligible(phone) {
  const c = await issueStoreCredit(db, { amount: 4_000_000, holderPhone: phone, source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, c.id)
  return c
}

const RealDate = Date
function shiftDays(n) {
  const off = n * DAY
  globalThis.Date = class extends RealDate {
    constructor(...a) {
      if (a.length) super(...a)
      else super(RealDate.now() + off)
    }
    static now() {
      return RealDate.now() + off
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\nکنترل: یادآوری عادی ⇒ فردا ضداسپم جلوی دومی را می‌گیرد')
{
  const A = await eligible('09124440001')
  await storeCreditService.queueReminder({ id: A.id, userId })
  await drain()
  await sleep(30)
  const day1 = sent('09124440001')
  shiftDays(1)
  await storeCreditService.queueReminder({ id: A.id, userId }).catch(() => null)
  await drain()
  globalThis.Date = RealDate
  show('کنترل: فقط یک پیام در دو روز', sent('09124440001') === 1, `SENT=${sent('09124440001')} (روز۱=${day1})`)
}

// ---------------------------------------------------------------------------
console.log('\nR4-1) لغو ⇒ «برگرداندن به صف» ⇒ فردا یادآوری دوم؟')
{
  const B = await eligible('09124440002')
  await storeCreditService.queueReminder({ id: B.id, userId })
  const row = sql.prepare(`SELECT id, status FROM "SmsOutbox" WHERE phoneSnapshot = '09124440002' ORDER BY id DESC`).get()
  await smsQueueService.cancel(row.id, { reason: 'اشتباهی', userId })
  await sleep(50)

  /**
   * «برگرداندن به صف» از پنل پیامک. بعد از رفع، این کار برای یادآوریِ
   * لغو‌شده **ممنوع** است (چون سهمیه آزاد شده و پیام بدون بازمصرف می‌رفت) و
   * کاربر به دکمه‌ی یادآوری در پنل اعتبار هدایت می‌شود.
   */
  let blockedFromSmsPanel = false
  try {
    await smsQueueService.requeue(row.id, { userId })
  } catch {
    blockedFromSmsPanel = true
  }
  if (!blockedFromSmsPanel) await drain()
  await sleep(50)

  /**
   * مسیر درست: همان دکمه‌ی «یادآوری» پنل اعتبار — **بدون `force`**.
   * (بازبینی پنجم: `force` از رندرر پذیرفته نمی‌شود؛ پس تست هم نباید آن را
   * «مسیر درست» جا بزند. لغو، سهمیه را آزاد کرده و فاصله هم پاک شده، پس
   * تصمیم‌گیر خودش «بله» می‌گوید.)
   */
  const manualAgain = await storeCreditService.queueReminder({ id: B.id, userId }).catch(() => null)
  const afterManual = manualAgain == null ? 0 : sent('09124440002')
  show(
    'دکمه‌ی یادآوری پنل اعتبار بدون force هم پیام را می‌فرستد',
    String(manualAgain?.status ?? '') === 'LOGGED' || afterManual >= 1,
    `status=${String(manualAgain?.status)} · SENT=${afterManual}`
  )
  await drain()
  await sleep(50)
  const afterResend = sent('09124440002')

  shiftDays(1)
  await storeCreditService.queueReminder({ id: B.id, userId }).catch(() => null)
  await drain()
  globalThis.Date = RealDate
  await sleep(50)
  const total = sent('09124440002')

  show('برگرداندن مستقیم از پنل پیامک مسدود است', blockedFromSmsPanel)
  show('مسیر پنل اعتبار پیام را می‌فرستد', afterResend >= 1, `SENT=${afterResend}`)
  show('و فردا یادآوری دوباره نمی‌رود', total === afterResend, `SENT نهایی=${total}`)
  show(
    'و سهمیه/لاگ با واقعیت هم‌خوان است',
    String(lastLog(B.id)?.status) !== 'UNDELIVERED' || afterResend === 0,
    `log=${String(lastLog(B.id)?.status)} · count=${cr(B.id).reminderCount}`
  )
}

// ---------------------------------------------------------------------------
console.log('\nR4-2) «لغو گروهی» روی ردیفِ از قبل لغوشده ⇒ سهمیه‌ی یادآوریِ تحویل‌شده آزاد می‌شود؟')
{
  const C = await eligible('09124440003')
  await storeCreditService.queueReminder({ id: C.id, userId })
  const r1 = sql.prepare(`SELECT id FROM "SmsOutbox" WHERE phoneSnapshot = '09124440003' ORDER BY id DESC`).get().id
  await smsQueueService.cancel(r1, { reason: 'روز اول لغو شد', userId })
  await sleep(50)

  shiftDays(1)
  await storeCreditService.queueReminder({ id: C.id, userId })
  await drain()
  await sleep(50)
  const day2Sent = sent('09124440003')
  const countAfterDay2 = cr(C.id).reminderCount

  // UI همه‌ی ids فهرست را می‌فرستد؛ یک پیام زنده هم لازم است تا count>0 شود.
  const x = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09124449999',
    body: 'x',
    dedupeKey: 'r4-x',
    scheduledAt: new Date(Date.now() + 3600e3)
  })
  await smsQueueService.cancelBulk([r1, x.id], { reason: 'لغو گروهی', userId })
  await sleep(80)
  const countAfterBulk = cr(C.id).reminderCount
  const logAfterBulk = String(lastLog(C.id)?.status)

  globalThis.Date = RealDate
  shiftDays(2)
  await storeCreditService.queueReminder({ id: C.id, userId }).catch(() => null)
  await drain()
  globalThis.Date = RealDate

  show('روز ۲ یادآوریِ تحویل‌شده سهمیه‌اش را نگه می‌دارد', countAfterBulk === countAfterDay2, `قبل=${countAfterDay2} بعد=${countAfterBulk}`)
  show('و لاگِ یادآوریِ تحویل‌شده «ناموفق» علامت نمی‌خورد', logAfterBulk === 'LOGGED', `log=${logAfterBulk}`)
  show('و روز ۳ یادآوری سوم نمی‌رود', sent('09124440003') === day2Sent, `SENT=${sent('09124440003')} (روز۲=${day2Sent})`)
}

// ---------------------------------------------------------------------------
console.log('\nR4-گارد خالص: چه وضعیت‌هایی باید مسدود شوند؟')
{
  show(
    'یادآوری لغو‌شده ⇒ مسدود',
    smsReminderManualResendBlocked('CREDIT_REMINDER', 'CANCELED') === true
  )
  show(
    'یادآوریِ ناموفقِ قطعی (سهمیه آزاد شده) ⇒ مسدود',
    smsReminderManualResendBlocked('CREDIT_REMINDER', 'FAILED_FINAL') === true
  )
  show(
    'یادآوریِ «نتیجه نامعلوم» ⇒ آزاد (سهمیه آزاد نشده و تصمیم با آدم است)',
    smsReminderManualResendBlocked('CREDIT_REMINDER', 'UNKNOWN') === false
  )
  show('پیام خدماتی/تبلیغاتی ⇒ آزاد', smsReminderManualResendBlocked('MANUAL', 'CANCELED') === false)
}

console.log(`\nخلاصه: ${ok} رفتار درست · ${bad} باگ اثبات‌شده`)
process.exit(bad === 0 ? 0 : 1)
