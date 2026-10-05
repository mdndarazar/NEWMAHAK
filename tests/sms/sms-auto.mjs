/**
 * ===========================================================================
 * زمان‌بند «یادآوری خودکار اعتبار».
 *
 * چیزی که اینجا سنجیده می‌شود، سه ادعای کاربر است:
 *   • «خودش هر روز سر ساعت» ⇒ یک بار در روز، و فقط وقتی کلید روشن است.
 *   • «خاموشی کلید فقط ارسال خودکار را می‌خواباند» ⇒ تصمیم‌گیری دستی دست‌نخورده.
 *   • «هیچ‌وقت دو بار برای یک نفر» ⇒ نشان‌گذاری روز، پیش از پردازش انجام می‌شود.
 *
 * و مهم‌تر: ثابت می‌کند زنجیره‌ی کامل کار می‌کند —
 * زمان‌بند پیامک ← تصمیم اعتبار ← پل فرستنده ← صف پیامک.
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-auto.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-auto-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { smsService, setSmsReminderSource, smsReminderSourceName } = await import('../../src/main/services/sms/SmsService.ts')
const { smsNotificationSender } = await import('../../src/main/services/sms/SmsNotificationSender.ts')
const notify = await import('../../src/main/services/NotificationSender.ts')
const svc = await import('../../src/main/services/StoreCreditService.ts')
const { SMS_SETTING_KEYS, smsAutoDayKey } = await import('@shared/sms')
const { AuditAction } = await import('@shared/enums')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const DAY = 86_400_000

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}
const truthy = (label, cond, detail = '') => eq(label + (detail ? ` · ${detail}` : ''), !!cond, true)

const userId = seed.user('مدیر زمان‌بند')
const setting = (key) => seed.one('SELECT value FROM "Setting" WHERE key = ?', key)?.value ?? null
const outboxCount = () => seed.count('SmsOutbox')
const audits = (action) => seed.count('AuditLog', 'action = ?', action)

/** ساعت جاری، اما دقیقه‌ی صفر — تا پنجره‌ی ۵ دقیقه‌ای زمان‌بند قطعاً شامل «الان» باشد. */
const now = new Date()
now.setSeconds(0, 0)
const atNow = { enabled: true, hour: now.getHours(), minute: now.getMinutes() }

async function issueEligible(phone = '09121230001') {
  const c = await svc.issueStoreCredit(db, { amount: 2_000_000, holderPhone: phone, source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, c.id)
  return c
}

// ---------------------------------------------------------------------------
console.log('\n۱) پیش‌فرض: خاموش است و هیچ کاری نمی‌کند')
{
  const r = await smsService.runAutoOnce(now, userId)
  eq('اجرا نشد', r.ran, false)
  truthy('و دلیلش گفته می‌شود', r.detail.includes('خاموش'), r.detail)
  eq('هیچ چیزی در صف ننشست', outboxCount(), 0)
  eq('منبع یادآوری هنوز وصل نشده', smsReminderSourceName(), null)
}

// ---------------------------------------------------------------------------
console.log('\n۲) روشن، ولی وقتش نرسیده')
{
  await smsService.saveSettings({ auto: { ...atNow, hour: (now.getHours() + 3) % 24 } }, userId)
  const r = await smsService.runAutoOnce(now, userId)
  eq('اجرا نشد', r.ran, false)
  truthy('دلیلش «وقتش نشده» است', r.detail.includes('وقت'), r.detail)
}

// ---------------------------------------------------------------------------
console.log('\n۳) یک بار در روز — نه دو بار')
{
  let calls = 0
  setSmsReminderSource({
    name: 'منبع آزمایشی',
    async candidates() {
      return [{ id: 1 }, { id: 2 }]
    },
    async queue() {
      calls++
    }
  })
  eq('منبع وصل شد', smsReminderSourceName(), 'منبع آزمایشی')

  await smsService.saveSettings({ auto: atNow }, userId)
  const first = await smsService.runAutoOnce(now, userId)
  eq('اجرا شد', first.ran, true)
  eq('هر دو کاندید ثبت شدند', first.queued, 2)
  eq('کوچ دو بار صدا زده شد', calls, 2)
  eq('روز در دیتابیس نشان‌گذاری شد', String(setting(SMS_SETTING_KEYS.autoLastRun)), smsAutoDayKey(now))
  eq('در AuditLog نشست', audits(AuditAction.SMS_AUTO_RUN), 1)

  const second = await smsService.runAutoOnce(now, userId)
  eq('اجرای دوم همان روز انجام نمی‌شود', second.ran, false)
  truthy('و دلیلش «امروز یک بار» است', second.detail.includes('امروز'), second.detail)
  eq('کوچ سوم انجام نشد', calls, 2)
}

// ---------------------------------------------------------------------------
console.log('\n۴) خطای یک کاندید، بقیه را متوقف نمی‌کند')
{
  let seen = 0
  setSmsReminderSource({
    name: 'منبع خراب‌کار',
    async candidates() {
      return [{ id: 1 }, { id: 2 }, { id: 3 }]
    },
    async queue({ id }) {
      seen++
      if (id === 2) throw new Error('این یکی خراب است')
    }
  })
  seed.setting(SMS_SETTING_KEYS.autoLastRun, '') // روز را پاک می‌کنیم تا دوباره اجرا شود
  const r = await smsService.runAutoOnce(now, userId)
  eq('اجرا شد', r.ran, true)
  eq('دو کاندید سالم ثبت شدند', r.queued, 2)
  eq('هر سه کاندید بررسی شدند', seen, 3)
  eq('روز نشان‌گذاری شد (خطا حلقه‌ی روزانه نمی‌سازد)', String(setting(SMS_SETTING_KEYS.autoLastRun)), smsAutoDayKey(now))
}

// ---------------------------------------------------------------------------
console.log('\n۵) خطای خواندن فهرست هم برنامه را نمی‌ترکاند')
{
  setSmsReminderSource({
    name: 'منبع خطادار',
    async candidates() {
      throw new Error('دیتابیس در دسترس نیست')
    },
    async queue() {
      throw new Error('نباید صدا زده شود')
    }
  })
  seed.setting(SMS_SETTING_KEYS.autoLastRun, '')
  const r = await smsService.runAutoOnce(now, userId)
  eq('اجرا ناموفق گزارش می‌شود (نه موفقِ توخالی)', r.ran, false)
  eq('و چیزی صف نشد', r.queued, 0)
  truthy('دلیلش گفته می‌شود', r.detail.includes('ناموفق'), r.detail)
  /**
   * ⚠️ این‌جا قبلاً «روز نشان‌گذاری شد» انتظار می‌رفت؛ ولی نگه‌داشتن نشانه
   * یعنی «امروز دیگر تلاش نکن» و یادآوری‌ها بی‌صدا یک روز عقب می‌افتادند.
   * حالا اگر دوری هیچ‌چیز ثبت نکند، نشانه پاک می‌شود تا نوبت بعدی دوباره
   * تلاش کند (اجرای دوباره بی‌خطر است: کلید یکتای هر یادآوری شامل روز است).
   */
  eq('و نشانه‌ی روز برای تلاش دوباره پاک شد', String(setting(SMS_SETTING_KEYS.autoLastRun) ?? ''), '')
}

// ---------------------------------------------------------------------------
console.log('\n۶) زنجیره‌ی واقعی: زمان‌بند ← اعتبار ← فرستنده ← صف پیامک')
{
  // همان دو خطی که بوت برنامه انجام می‌دهد.
  notify.setNotificationSender(smsNotificationSender)
  setSmsReminderSource({
    name: 'یادآوری اعتبار خرید',
    candidates: async ({ limit }) => {
      const res = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: limit ?? 200 })
      return (res?.rows ?? []).map((r) => ({ id: r?.credit?.id ?? r?.id })).filter((r) => Number.isFinite(r.id))
    },
    queue: async ({ id, userId: uid }) => svc.storeCreditService.queueReminder({ id, userId: uid ?? null })
  })

  const credit = await issueEligible('09121230009')
  seed.setting(SMS_SETTING_KEYS.autoLastRun, '')
  await smsService.saveSettings({ auto: atNow }, userId)

  const before = outboxCount()
  const r = await smsService.runAutoOnce(now, userId)
  eq('اجرا شد', r.ran, true)
  eq('یک یادآوری ثبت شد', r.queued, 1)
  eq('یک پیام در صف نشست', outboxCount(), before + 1)

  const row = sql.prepare('SELECT * FROM "SmsOutbox" ORDER BY id DESC LIMIT 1').get()
  eq('نوع رویداد', row.eventType, 'CREDIT_REMINDER')
  eq('شماره‌ی مشتری', row.phoneSnapshot, '09121230009')
  truthy('کد اعتبار در متن هست', String(row.bodySnapshot).includes(String(credit.code)), String(row.bodySnapshot).slice(0, 50))
  eq('اولویت تراکنشی (۳) — از جلوی کمپین می‌پرد', row.priority, 3)

  const log = seed.one('SELECT * FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC', credit.id)
  truthy('و در سابقه‌ی اعتبار ثبت شد', log != null)
  truthy('وضعیت «ثبت‌شده» است', String(log.status) === 'LOGGED', String(log.status))

  const creditAfter = seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', credit.id)
  eq('سهمیه‌ی یادآوری مصرف شد', Math.round(Number(creditAfter.reminderCount)), 1)

  // و کلید خاموش، همان زنجیره را می‌خواباند
  await smsService.saveSettings({ auto: { ...atNow, enabled: false } }, userId)
  seed.setting(SMS_SETTING_KEYS.autoLastRun, '')
  const off = await smsService.runAutoOnce(now, userId)
  eq('با کلید خاموش هیچ پیامی نمی‌رود', off.ran, false)
  eq('و صف تکان نمی‌خورد', outboxCount(), before + 1)
}

// ---------------------------------------------------------------------------
console.log('\n۷) اگر هیچ یادآوری‌ای ثبت نشد، دور بعدی دوباره تلاش می‌کند')
{
  // بخش ۶ کلید خودکار را خاموش کرد؛ برای این سناریو دوباره روشنش می‌کنیم.
  await smsService.saveSettings({ auto: atNow }, userId)
  let failFirst = true
  let attempts = 0
  setSmsReminderSource({
    name: 'منبع ناپایدار',
    async candidates() {
      return [{ id: 1 }]
    },
    async queue() {
      attempts++
      // دور اول: دیتابیس قفل است. دور دوم: درست می‌شود.
      if (failFirst) {
        failFirst = false
        throw new Error('database is locked')
      }
    }
  })
  seed.setting(SMS_SETTING_KEYS.autoLastRun, '')

  const first = await smsService.runAutoOnce(now, userId)
  eq('دور اول: هیچ‌چیز ثبت نشد', [first.ran, first.queued], [false, 0])
  eq('و نشانه پاک شد تا دور بعدی بیاید', String(setting(SMS_SETTING_KEYS.autoLastRun) ?? ''), '')

  /**
   * ⏱ دور دوم **۳۵ دقیقه بعد** صدا زده می‌شود، نه در همان ثانیه: قبلاً پنجره‌ی
   * مجاز فقط ۵ دقیقه بود و همین «چند دقیقه دیگر دوباره تلاش می‌شود» را عملاً
   * به «هرگز» تبدیل می‌کرد.
   */
  const second = await smsService.runAutoOnce(new Date(now.getTime() + 35 * 60_000), userId)
  eq('دور دوم ۳۵ دقیقه بعد هم اجرا شد (جبران عقب‌افتادگی)', second.ran, true)
  eq('و این بار ثبت شد', second.queued, 1)
  eq('در مجموع دو تلاش', attempts, 2)
  eq(
    'و حالا نشانه سر جایش است',
    String(setting(SMS_SETTING_KEYS.autoLastRun)),
    smsAutoDayKey(new Date(now.getTime() + 35 * 60_000))
  )
}

// ---------------------------------------------------------------------------
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
