/**
 * ===========================================================================
 * سهمیه‌ی یادآوری اعتبار — «تأخیر مجاز، گم‌شدن هرگز».
 *
 * باگ واقعی که این تست قفل می‌کند: شمارنده‌ی یادآوری در لحظه‌ی **صف‌شدن** مصرف
 * می‌شد، نه در لحظه‌ی **تحویل**. با سقف ۳ یادآوری، سه شکستِ بی‌تقصیر (قطعی
 * اینترنت، سرویس‌دهنده‌ی خوابیده) سهمیه را تمام می‌کرد و پنجره‌ی ۷ روزه هم از
 * نو شروع می‌شد؛ یعنی مشتری هیچ‌وقت پیام نمی‌گرفت و هیچ‌کس هم نمی‌فهمید.
 *
 * اینجا با یک فرستنده‌ی **شکست‌خورده‌ی تزریقی** سنجیده می‌شود (همان راه
 * رسمی `setNotificationSender`)، پس واقعاً «ارسال ناموفق» اتفاق می‌افتد.
 *
 *     node --import ./test/harness/register.mjs tests/sms/credit-reminder-quota.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-quota-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const svc = await import('../../src/main/services/StoreCreditService.ts')
const notify = await import('../../src/main/services/NotificationSender.ts')
const { CreditReminderStatus } = await import('@shared/credit')

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

const userId = seed.user('مدیر یادآوری')
const creditRow = (id) => seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', id)
const lastLog = (id) => seed.one('SELECT * FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC', id)
const logCount = (id) => seed.count('CreditReminderLog', 'creditId = ?', id)

/** اعتبار مصرف‌نشده‌ی واجد شرایط: ۴۰ روز از صدورش گذشته، بدون انقضا. */
async function issueEligible(phone = '09129998877') {
  const c = await svc.issueStoreCredit(db, { amount: 4_000_000, holderPhone: phone, source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, c.id)
  return creditRow(c.id)
}

/** فرستنده‌ی شکست‌خورده — مثل سرویس‌دهنده‌ی خوابیده یا اینترنت قطع. */
let failMode = false
notify.setNotificationSender({
  name: 'فرستنده‌ی آزمایشی این تست',
  live: true,
  async send(phone, text) {
    if (failMode) return { ok: false, externalId: null, detail: 'سرویس‌دهنده پاسخ نداد (تست).' }
    return { ok: true, externalId: 'test-1', detail: 'پذیرفته شد (تست).' }
  }
})

console.log('\n۱) ارسال ناموفق، سهمیه را نمی‌سوزاند')
{
  failMode = true
  const credit = await issueEligible()
  const before = Math.round(Number(credit.reminderCount))
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })

  const after = creditRow(credit.id)
  eq('شمارنده تکان نخورد', Math.round(Number(after.reminderCount)), before)
  eq('تاریخ آخرین یادآوری ثبت نشد (پس ضداسپم جلوی تلاش بعدی را نمی‌گیرد)', after.lastReminderAt, null)

  const log = lastLog(credit.id)
  eq('درخواست همچنان ثبت شد (تلاش پنهان نمی‌ماند)', log != null, true)
  eq('وضعیت «ثبت‌شده» است', String(log.status), CreditReminderStatus.LOGGED)
  eq('زمان ارسال خالی ماند', log.sentAt, null)
  truthy('دلیل شکست در سابقه ثبت شد', String(log.reason).includes('سرویس‌دهنده پاسخ نداد'), String(log.reason))

  // و مهم‌ترین بخش: یادآوری «گم» نشده — تلاش دوباره باید ممکن باشد
  failMode = false
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const retryLog = lastLog(credit.id)
  eq('تلاش دوم رد نشد', String(retryLog.status), CreditReminderStatus.LOGGED)
  eq('حالا زمان ارسال ثبت شد', retryLog.sentAt != null, true)
  const final = creditRow(credit.id)
  eq('و فقط همین یک تحویل، سهمیه را یک واحد جلو برد', Math.round(Number(final.reminderCount)), before + 1)
  truthy('تاریخ آخرین یادآوری ثبت شد', final.lastReminderAt != null)
  eq('هر دو تلاش در سابقه ماندند', logCount(credit.id) >= 2, true)
}

console.log('\n۲) سه شکست پشت‌سرهم، سهمیه را تمام نمی‌کند (همان باگی که بود)')
{
  failMode = true
  const credit = await issueEligible('09121110000')
  for (let i = 0; i < 4; i++) await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const afterFails = creditRow(credit.id)
  eq('بعد از چهار شکست، سهمیه دست‌نخورده است', Math.round(Number(afterFails.reminderCount)), 0)

  failMode = false
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  eq('و پیام پنجم می‌رود', Math.round(Number(creditRow(credit.id).reminderCount)), 1)

  // ۳ تحویل = پر شدن سقف پیش‌فرض؛ چهارمی باید ضداسپم بخورد
  for (let i = 0; i < 2; i++) {
    sql.prepare('UPDATE "StoreCredit" SET lastReminderAt = ? WHERE id = ?').run(Date.now() - 8 * DAY, credit.id)
    await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  }
  eq('سقف ۳ تحویل پر شد', Math.round(Number(creditRow(credit.id).reminderCount)), 3)
  sql.prepare('UPDATE "StoreCredit" SET lastReminderAt = ? WHERE id = ?').run(Date.now() - 8 * DAY, credit.id)
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  eq('تحویل چهارم رد شد', String(lastLog(credit.id).status), CreditReminderStatus.SKIPPED)
  eq('و شمارنده از سقف رد نشد', Math.round(Number(creditRow(credit.id).reminderCount)), 3)
}

console.log('\n۳) ضداسپم واقعی سر جایش است (شکست با رد عادی قاطی نشود)')
{
  const credit = await issueEligible('09122220000')
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const n = Math.round(Number(creditRow(credit.id).reminderCount))
  eq('اولی تحویل شد', n, 1)
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  eq('دومی در فاصله‌ی مجاز رد شد', String(lastLog(credit.id).status), CreditReminderStatus.SKIPPED)
  eq('شمارنده با ردِ ضداسپم بالا نرفت', Math.round(Number(creditRow(credit.id).reminderCount)), 1)
}

console.log('\n۴) ادعای دروغ در سابقه نمی‌ماند')
{
  failMode = true
  const credit = await issueEligible('09123330000')
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const note = seed.one('SELECT note FROM "AuditLog" WHERE action = ? ORDER BY id DESC', 'CREDIT_REMINDER_QUEUE')?.note ?? ''
  eq('وقتی چیزی تحویل نشده، سابقه هم ادعای ارسال نمی‌کند', note.includes('هیچ پیامکی ارسال نشد'), true)

  failMode = false
  await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const okNote = seed.one('SELECT note FROM "AuditLog" WHERE action = ? ORDER BY id DESC', 'CREDIT_REMINDER_QUEUE')?.note ?? ''
  truthy('و در تحویل موفق، نام فرستنده ثبت می‌شود', okNote.includes('فرستنده‌ی آزمایشی این تست'), okNote)
}

console.log('\n۵) تزریق فرستنده‌ی واقعی: یادآوری می‌رسد به «صف پیامک»')
{
  /**
   * همان یک خطی که بوت برنامه انجام می‌دهد. هیچ خطی از منطق اعتبار عوض
   * نمی‌شود؛ فقط پیاده‌سازی فرستنده عوض می‌شود.
   */
  const { smsNotificationSender } = await import('../../src/main/services/sms/SmsNotificationSender.ts')
  notify.setNotificationSender(smsNotificationSender)

  const credit = await issueEligible('09127770001')
  const outboxCount = () => sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox"').get().c

  const before = outboxCount()
  const res = await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  eq('صف پیامک پیام را پذیرفت', String(lastLog(credit.id).status), CreditReminderStatus.LOGGED)
  truthy('زمان تحویل ثبت شد', lastLog(credit.id).sentAt != null)
  eq('یک ردیف در صف نشست', outboxCount(), before + 1)
  truthy('کد اعتبار در متن پیام است', String(res.text).includes(String(credit.code)), String(res.text).slice(0, 60))

  const row = sql.prepare('SELECT * FROM "SmsOutbox" ORDER BY id DESC LIMIT 1').get()
  eq('نوع رویداد', row.eventType, 'CREDIT_REMINDER')
  eq('اولویت تراکنشی (۳) — از جلوی کمپین می‌پرد', row.priority, 3)
  eq('شماره‌ی مقصد', row.phoneSnapshot, '09127770001')
  eq('وضعیت اولیه', row.status, 'PENDING')
  eq('شمارنده‌ی سهمیه یک بار مصرف شد', Math.round(Number(creditRow(credit.id).reminderCount)), 1)

  // دو بار کلیک در یک روز ⇒ یک پیام (کلید یکتا)
  const again = await svc.storeCreditService.queueReminder({ id: credit.id, userId, force: true })
  eq('کلیک دوم پیام تکراری نمی‌سازد', outboxCount(), before + 1)
  truthy('و همان را گزارش می‌کند', String(again.status) !== '', true)
}

// ---------------------------------------------------------------------------
console.log('\n۷) فرستنده‌ی **واقعی** پیامک (نه تزریقی) — SMS-BUG-10')
{
  /**
   * شکافی که این بخش می‌بندد: بقیه‌ی این سوییت با فرستنده‌ی تزریقی کار می‌کند،
   * پس هیچ‌کس `queueReminder` را با `smsNotificationSender` واقعی نسنجیده بود —
   * و برای همین باگ «تکراری = ok:true ⇒ سهمیه دو بار مصرف» سبز مانده بود.
   */
  const { smsNotificationSender } = await import('../../src/main/services/sms/SmsNotificationSender.ts')
  notify.setNotificationSender(smsNotificationSender)

  const credit = await issueEligible('09127770002')
  await svc.storeCreditService.queueReminder({ id: credit.id, userId, force: true })
  truthy('یادآوری واقعی در صف نشست', lastLog(credit.id).sentAt != null)
  eq('سهمیه یک بار مصرف شد', Math.round(Number(creditRow(credit.id).reminderCount)), 1)

  const beforeOutbox = sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox"').get().c
  await svc.storeCreditService.queueReminder({ id: credit.id, userId, force: true })
  eq('کلیک دوم پیام تازه نمی‌سازد', sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox"').get().c, beforeOutbox)
  eq('و سهمیه را دوباره مصرف نمی‌کند', Math.round(Number(creditRow(credit.id).reminderCount)), 1)
  /**
   * ⚠️ نکته‌ی ظریف: کلیک دوم «موفق» گزارش نمی‌شود، چونจริงاً پیام تازه‌ای
   * ساخته نشده؛ گزارش «موفق» همان چیزی بود که سهمیه را دوبار می‌خورد.
   */
  eq('و این بار «تحویل» ثبت نمی‌شود (پیام تازه‌ای ساخته نشد)', lastLog(credit.id).sentAt, null)

  // و پیام واقعی از همان مسیر در صف ایستاده است
  const row = sql.prepare('SELECT * FROM "SmsOutbox" ORDER BY id DESC LIMIT 1').get()
  eq('ردیف صف از نوع یادآوری اعتبار است', row.eventType, 'CREDIT_REMINDER')
  eq('و هنوز ارسال نشده (کارِ صف است)', row.status, 'PENDING')
}

// ---------------------------------------------------------------------------
console.log('\n۸) `force` فقط سهمیه/زمان‌بندی را رد می‌کند — باگ بازبینی پنجم')
{
  /**
   * 🔴 چرا: این پرچم در `queueReminder` دروازه‌ی تصمیم را باز می‌کند. اگر
   * بی‌قید باشد (یا از IPC بیاید)، می‌شود برای کد **باطل/مصرف‌شده/Opt-out**
   * هم پیامک ساخت — یعنی مشتری پیام اضافه می‌گیرد و داده با واقعیت نمی‌خواند.
   */
  const { isReminderForceable } = await import('@shared/credit')
  truthy('کد باطل/مصرف‌شده قابل‌رد نیست', isReminderForceable('STATUS') === false)
  truthy('Opt-out قابل‌رد نیست', isReminderForceable('OPTOUT') === false)
  truthy('بدون شماره قابل‌رد نیست', isReminderForceable('NO_PHONE') === false)
  truthy('سقف تعداد قابل‌رد است (دکمه‌ی دستی مدیر)', isReminderForceable('MAX_COUNT') === true)
  truthy('فاصله‌ی روزها قابل‌رد است', isReminderForceable('GAP') === true)

  // کد باطل: حتی با force هم پیام ساخته نمی‌شود
  const canceled = await issueEligible('09125558801')
  sql.prepare('UPDATE "StoreCredit" SET status = ? WHERE id = ?').run('CANCELED', canceled.id)
  const res = await svc.storeCreditService.queueReminder({ id: canceled.id, userId, force: true })
  eq('کد باطل با force هم «ثبت نشد» می‌دهد', String(res?.status), 'SKIPPED')
  eq('و هیچ پیامکی برایش در صف نیست', sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox" WHERE phoneSnapshot = ?').get('09125558801').c, 0)

  // Opt-out: همان
  const optedOut = await issueEligible('09125558802')
  sql.prepare('UPDATE "StoreCredit" SET reminderOptOut = 1 WHERE id = ?').run(optedOut.id)
  const res2 = await svc.storeCreditService.queueReminder({ id: optedOut.id, userId, force: true })
  eq('Opt-out با force هم پیام نمی‌فرستد', String(res2?.status), 'OPTED_OUT')
  eq('و صف دست‌نخورده می‌ماند', sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox" WHERE phoneSnapshot = ?').get('09125558802').c, 0)

  // سقف پر: با force می‌گذرد (همان «دکمه‌ی دستی» که طراحی شده بود)
  const full = await issueEligible('09125558803')
  sql.prepare('UPDATE "StoreCredit" SET reminderCount = 99, lastReminderAt = NULL WHERE id = ?').run(full.id)
  const blocked = await svc.storeCreditService.queueReminder({ id: full.id, userId })
  eq('سقف پر بدون force ⇒ ثبت نمی‌شود', String(blocked?.status), 'SKIPPED')
  const forced = await svc.storeCreditService.queueReminder({ id: full.id, userId, force: true })
  eq('و با force (مسیر داخلی) ثبت می‌شود', String(forced?.status), 'LOGGED')
}

// ---------------------------------------------------------------------------
console.log('\n۹) پنجره‌ی کاندیدها «گرسنه» نمی‌شود — باگ بازبینی نهم')
{
  /**
   * 🔴 SMS-R9-01: `reminderCandidates` فیلترِ «سررسید» را **بعد از** `take`
   * اعمال می‌کرد و ترتیب پرس‌وجو `issuedAt: asc` بود. پس در فروشگاهی که چند صد
   * اعتبار قدیمیِ سقف‌پر دارد، پنجره‌ی ۲۰۰تاییِ زمان‌بند خودکار تماماً از
   * همان‌های بی‌فایده پر می‌شد و اعتبارِ واجد شرایطِ تازه **هیچ‌وقت دیده
   * نمی‌شد** ⇒ یادآوری خودکار بی‌صدا هرگز نمی‌رفت.
   *
   * رفع: قواعد «اصلاً واجد شرایط نیست» به SQL منتقل شد + پویش صفحه‌به‌صفحه تا
   * جمع شدن `take` ردیفِ واقعاً واجد شرایط.
   */
  // ۳۰۰ اعتبار قدیمی که سقف یادآوری‌شان پر است (سررسید نیستند)
  for (let i = 0; i < 300; i++) {
    const c = await issueEligible(`0912777${String(1000 + i)}`)
    sql.prepare('UPDATE "StoreCredit" SET reminderCount = 99, lastReminderAt = ? WHERE id = ?').run(Date.now() - 60 * DAY, c.id)
  }
  const fresh = await issueEligible('09127778888')
  const cut = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 200 })
  truthy('پنجره‌ی ۲۰۰تایی، اعتبارِ واجد شرایط را می‌بیند', cut.rows.some((r) => r.credit.id === fresh.id), `تعداد=${cut.rows.length}`)
  eq('و هیچ ردیفِ سقف‌پری در فهرست نیست', cut.rows.filter((r) => Number(r.credit.reminderCount) >= 99).length, 0)

  /**
   * و پویش صفحه‌به‌صفحه: ۶۰۰ ردیفِ «بی‌شماره» که پیش‌فیلتر SQL نمی‌تواند ردشان
   * کند (تصمیم `NO_PHONE` می‌دهد) نباید جلوی دیدنِ اعتبارِ ته جدول را بگیرند.
   */
  for (let i = 0; i < 600; i++) {
    const c = await svc.issueStoreCredit(db, { amount: 500_000, source: 'MANUAL', userId })
    sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - (500 - i * 0.01) * DAY, c.id)
  }
  const buried = await issueEligible('09127779999')
  const scan = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 5 })
  truthy('اعتبارِ ته جدول (پشتِ ردیف‌های بی‌شماره) هم پیدا می‌شود', scan.rows.some((r) => r.credit.id === buried.id), `تعداد=${scan.rows.length}`)
  eq('و ردیفِ بی‌شماره در فهرست نمی‌آید', scan.rows.filter((r) => !r.phone).length, 0)
}

// ---------------------------------------------------------------------------
console.log('\n۱۰) پیش‌فیلتر کاندیدها با «حداقل روز از صدور = ۰» — باگ بازبینی دهم')
{
  /**
   * 🔴 SMS-R10-01: پیش‌فیلترِ SQL (رفع بازبینی نهم) شرط مثبت را طوری می‌ساخت که
   * با `minDaysSinceIssue = 0` فقط پنجره‌ی «نزدیک انقضا» می‌ماند — ولی تصمیم‌گیر
   * `parseCreditSettings` صفر را مجاز می‌داند و برای هر اعتبارِ سالمی
   * `should=true` می‌دهد. نتیجه: اعتبارِ بدون‌انقضا از فهرست می‌افتاد و
   * زمان‌بند خودکار بی‌صدا `queued=0` می‌داد.
   *
   * تست هم مرز را می‌سنجد (۰ مجاز است ⇒ باید کار کند) و هم اینکه پیش‌فیلتر
   * نباید *تنگ‌تر* از تصمیم نهایی شود.
   */
  const base = (await import('@shared/credit')).parseCreditSettings(null)
  const KEY = 'credit.settings'
  const setReminder = (patch) =>
    sql
      .prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)')
      .run(KEY, JSON.stringify({ ...base, reminder: { ...base.reminder, ...patch } }))
  const clearQueue = () => sql.prepare('DELETE FROM "SmsOutbox"').run()

  // اعتبارِ تازه و بدون انقضا — با «۰ روز از صدور» واجد شرایط است
  const young = await svc.issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09126660001', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET expiresAt = NULL, issuedAt = ? WHERE id = ?').run(Date.now() - 2 * DAY, young.id)

  setReminder({ minDaysSinceIssue: 0, beforeExpiryDays: 3 })
  const d0 = (await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 200 })).rows
  truthy('با minDays=۰ اعتبارِ بدون‌انقضا هم کاندید می‌شود (قبلاً از فهرست می‌افتاد)', d0.some((r) => r.credit.id === young.id), `تعداد=${d0.length}`)


  // ضدکنترل: با حداقل ۱ روز، همان اعتبار هم واجد شرایط است (۲ روز از صدور گذشته)
  setReminder({ minDaysSinceIssue: 1, beforeExpiryDays: 3 })
  const d1 = (await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 200 })).rows
  truthy('با minDays=۱ هم همان اعتبار دیده می‌شود (فیلتر تنگ نشده)', d1.some((r) => r.credit.id === young.id))

  // و «۰ روز قبل از انقضا» هم نباید شرط مثبت را حذف کند
  setReminder({ minDaysSinceIssue: 0, beforeExpiryDays: 0 })
  const d2 = (await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 200 })).rows
  truthy('با beforeExpiry=۰ هم دیده می‌شود', d2.some((r) => r.credit.id === young.id))

  // پیش‌فیلترِ محافظه‌کار باید «فراگیرتر» از تصمیم نهایی بماند، نه تنگ‌تر
  setReminder({ minDaysSinceIssue: 0, beforeExpiryDays: 3 })
  const all = (await svc.storeCreditService.reminderCandidates({ onlyDue: false, take: 5000 })).rows
  const due = (await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: 5000 })).rows
  eq(
    'هر ردیفِ سررسید در فهرست کامل هم هست (پیش‌فیلتر چیزی را قیچی نمی‌کند)',
    due.every((r) => all.some((a) => a.credit.id === r.credit.id)),
    true,
    `سررسید=${due.length} · کامل=${all.length}`
  )

  /**
   * و انتها-به-انتها: زمان‌بند خودکار واقعی، با پل واقعی بوت. این همان جایی
   * است که باگ خودش را نشان می‌داد: `ran: true` ولی `queued: 0`.
   */
  const { smsService, setSmsReminderSource } = await import('../../src/main/services/sms/SmsService.ts')
  const { smsCredentialService } = await import('../../src/main/services/sms/SmsCredentials.ts')
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط بازبینی ۱۰', purpose: 'SERVICE', isActive: true, userId })
  setSmsReminderSource({
    name: 'یادآوری اعتبار خرید',
    candidates: async ({ limit }) => {
      const r = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: limit ?? 200 })
      return (r?.rows ?? []).map((x) => ({ id: x?.credit?.id ?? x?.id })).filter((x) => Number.isFinite(x.id))
    },
    queue: async ({ id, userId: u }) => svc.storeCreditService.queueReminder({ id, userId: u ?? null })
  })

  sql.prepare('DELETE FROM "Setting" WHERE key = ?').run('sms.auto.lastRun')
  sql.prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)').run('sms.auto', JSON.stringify({ enabled: true, hour: 10, minute: 0, askOnEnable: false }))
  const run0 = await smsService.runAutoOnce(new Date(2026, 9, 20, 10, 5), userId)
  truthy('زمان‌بند خودکار حداقل یک یادآوری ثبت می‌کند (قبلاً بی‌صدا صفر بود)', run0.queued >= 1, `queued=${run0.queued}`)
  eq(
    'و دقیقاً برای همان اعتبارِ بدون‌انقضا ردیف صف ساخته شد',
    sql.prepare(`SELECT COUNT(*) c FROM "SmsOutbox" WHERE eventType='CREDIT_REMINDER' AND phoneSnapshot = ?`).get('09126660001').c,
    1
  )
  setSmsReminderSource(null)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
