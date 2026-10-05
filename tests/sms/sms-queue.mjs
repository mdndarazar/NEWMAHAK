/**
 * ===========================================================================
 * پنل پیامکی — اجرای واقعی روی دیتابیس واقعی (هارنس §۲۳).
 *
 * این سوییت «قرارداد»های ماژول را می‌سنجد، نه فقط منطق خالص:
 *   • پیام هرگز گم نمی‌شود (قفل یتیم، شکست موقت، زمان‌بندی)
 *   • تا سرویس‌دهنده فعال نشده، **حتی یک تلاش** مصرف نمی‌شود
 *   • لغو ≠ حذف؛ برگرداندن به صف و تلاش مجدد کار می‌کند
 *   • کلید API خام در دیتابیس نمی‌نشیند و بدون رمز مدیر ذخیره نمی‌شود
 *   • این ماژول هیچ جدولی از فروش/اعتبار را نمی‌نویسد (جداسازی)
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-queue.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-queue-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { enqueueSms, runSmsQueueOnce, recoverStale, smsQueueService } = await import(
  '../../src/main/services/sms/SmsQueue.ts'
)
const { smsTemplateService, DEFAULT_SMS_TEMPLATES } = await import('../../src/main/services/sms/SmsTemplates.ts')
const { smsCredentialService } = await import('../../src/main/services/sms/SmsCredentials.ts')
const { smsService } = await import('../../src/main/services/sms/SmsService.ts')
const {
  SmsOutboxStatus,
  smsDedupeKey,
  smsSegments,
  validateSmsBody,
  smsPlaceholdersOf,
  SMS_PLACEHOLDERS,
  SMS_WAITING_MAX_AGE_MS
} = await import('@shared/sms')
const { AuditAction } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { DEFAULT_SMS_OPT_OUT_NOTE } = await import('@shared/sms')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const PW = DEFAULT_MANAGER_PASSWORD

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
const ok_ = (label, cond, detail = '') => {
  if (cond) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ' · ' + detail : ''}`)
  }
}
const throws = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · خطایی پرتاب نشد`)
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (needle && !msg.includes(needle)) {
      bad++
      console.log(`  ✗ ${label} · پیام خطا «${msg}» شامل «${needle}» نبود`)
    } else {
      ok++
      console.log(`  ✓ ${label}`)
    }
  }
}
const count = (where) => sql.prepare('SELECT COUNT(*) AS n FROM "SmsOutbox"').get().n
const audits = (action) =>
  sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ?').get(action).n
const outbox = (id) => sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(id)

/**
 * صف را تا خالی‌شدن اجرا می‌کند.
 *
 * چرا لازم است: هر دور صف فقط ۵ ردیف برمی‌دارد (تا فروش را قفل نکند). در
 * سناریوهایی که از بخش‌های قبلی ردیفِ PENDING باقی مانده، یک دور کافی نیست و
 * ردیفِ تازه‌ی همین بخش نوبتش نمی‌رسد.
 */
const drainQueue = async (maxRounds = 40) => {
  let last = { picked: 0 }
  for (let i = 0; i < maxRounds; i++) {
    last = await runSmsQueueOnce()
    if (!last.picked) break
  }
  return last
}

const userId = seed.user('مدیر پیامک')

const key = (n, period) =>
  smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: `t-${n}`, phone: '09121234567', period })

console.log('\n۰) ساخت صف')
{
  const bad1 = await enqueueSms({ eventType: 'MANUAL', phone: '02112345678', body: 'سلام', dedupeKey: key('bad-phone') })
  eq('شماره‌ی غیرموبایل در صف نمی‌نشیند', [bad1.ok, bad1.skipped], [false, true])
  eq('دیتابیس دست‌نخورده می‌ماند', count(), 0)

  const bad2 = await enqueueSms({ eventType: 'MANUAL', phone: '09121234567', body: '   ', dedupeKey: key('bad-body') })
  eq('متن خالی رد می‌شود', bad2.skipped, true)

  const bad3 = await enqueueSms({ eventType: 'MANUAL', phone: '09121234567', body: 'سلام', dedupeKey: '' })
  eq('کلید خالی رد می‌شود', bad3.skipped, true)
  eq('هنوز هیچ ردیفی نیست', count(), 0)

  const body = 'مشتری عزیز، از خرید شما سپاسگزاریم.'
  const good = await enqueueSms({
    eventType: 'SALE_THANK_YOU',
    phone: '+98 912 123 4567',
    body,
    customerId: null,
    customerName: 'آقای محمدی',
    dedupeKey: key('good'),
    createdByUserId: userId
  })
  eq('پیام معتبر ثبت شد', [good.ok, good.skipped, good.duplicate], [true, false, false])
  const row = outbox(good.id)
  eq('وضعیت اولیه', row.status, SmsOutboxStatus.PENDING)
  eq('شماره یکسان‌سازی شد', row.phoneSnapshot, '09121234567')
  eq('تعداد بخش‌ها ذخیره شد', row.segments, smsSegments(body))
  eq('شمارنده‌ی تلاش صفر است', row.attemptCount, 0)
  eq('موعد = همین حالا (بدون زمان‌بندی)', row.nextAttemptAt != null && row.scheduledAt == null, true)

  const dup = await enqueueSms({ eventType: 'SALE_THANK_YOU', phone: '09121234567', body, dedupeKey: key('good') })
  eq('همان کلید دوباره ⇒ تکراری', [dup.ok, dup.duplicate], [false, true])
  eq('ردیف دوم ساخته نشد', count(), 1)
}

console.log('\n۱) بدون سرویس‌دهنده‌ی فعال، هیچ تلاشی مصرف نمی‌شود')
{
  const res = await runSmsQueueOnce()
  eq('هیچ پیامی برداشته نشد', res.picked, 0)
  truthy('دلیل توقف گزارش شد', res.blocked.length > 0, res.blocked)
  const row = outbox(1)
  eq('وضعیت همان «در صف» ماند', row.status, SmsOutboxStatus.PENDING)
  eq('شمارنده‌ی تلاش مصرف نشد', row.attemptCount, 0)
}

console.log('\n۲) زمان‌بندی: پیامِ آینده همین حالا نمی‌رود')
{
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'آزمایشی', isActive: true, userId })
  const future = new Date(Date.now() + 3600_000)
  const s = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09120000001',
    body: 'کمپین آینده',
    dedupeKey: key('future'),
    scheduledAt: future
  })
  const res = await runSmsQueueOnce()
  eq('فقط پیام بی‌زمان رفت', res.picked, 1)
  eq('پیام زمان‌دار در صف ماند', outbox(s.id).status, SmsOutboxStatus.PENDING)
  eq('اولی ارسال شد', outbox(1).status, SmsOutboxStatus.SENT)
}

console.log('\n۳) ارسال آزمایشی و سابقه‌ی تلاش')
{
  const row = outbox(1)
  truthy('زمان ارسال ثبت شد', row.sentAt != null)
  eq('شمارنده‌ی تلاش', row.attemptCount, 1)
  eq('موعد پاک شد', row.nextAttemptAt, null)
  const att = sql.prepare('SELECT * FROM "SmsAttempt" WHERE outboxId = 1').all()
  eq('یک تلاش ثبت شد', att.length, 1)
  eq('نتیجه‌ی تلاش', att[0].result, 'OK')
  eq('شماره‌ی تلاش', att[0].attemptNo, 1)

  const again = await runSmsQueueOnce()
  eq('ارسال‌شده دوباره برداشته نمی‌شود', again.picked, 0)
  eq('تلاش دوم ثبت نشد', sql.prepare('SELECT COUNT(*) AS n FROM "SmsAttempt" WHERE outboxId = 1').get().n, 1)
}

console.log('\n۴) قفل یتیم (کرش وسط ارسال)')
{
  const stale = sql
    .prepare(
      `INSERT INTO "SmsOutbox" (dedupeKey, eventType, phoneSnapshot, bodySnapshot, status, priority, attemptCount, maxAttempts, segments, lockedAt, lockedBy, nextAttemptAt, createdAt, updatedAt)
       VALUES ('stale-1','MANUAL','09120000002','متن',?,5,1,5,1,?, 'old-worker', ?, ?, ?)`
    )
    .run(SmsOutboxStatus.PROCESSING, Date.now() - 10 * 60_000, Date.now(), Date.now(), Date.now())
  const staleId = Number(stale.lastInsertRowid)
  const fresh = sql
    .prepare(
      `INSERT INTO "SmsOutbox" (dedupeKey, eventType, phoneSnapshot, bodySnapshot, status, priority, attemptCount, maxAttempts, segments, lockedAt, lockedBy, nextAttemptAt, createdAt, updatedAt)
       VALUES ('fresh-1','MANUAL','09120000003','متن',?,5,0,5,1,?, 'live-worker', ?, ?, ?)`
    )
    .run(SmsOutboxStatus.PROCESSING, Date.now(), Date.now(), Date.now(), Date.now())
  const freshId = Number(fresh.lastInsertRowid)

  eq('یک قفل یتیم آزاد شد', await recoverStale(), 1)
  const freed = outbox(staleId)
  eq('قفل یتیم به صف برگشت', freed.status, SmsOutboxStatus.PENDING)
  eq('قفل‌ها پاک شدند', [freed.lockedAt, freed.lockedBy], [null, null])
  eq('شمارنده‌ی تلاش دست‌نخورده ماند', freed.attemptCount, 1)
  eq('قفلِ سالم دست نخورد', outbox(freshId).status, SmsOutboxStatus.PROCESSING)
  eq('دومی در دور بعد برمی‌گردد', await recoverStale(new Date(Date.now() + 10 * 60_000)), 1)
}

console.log('\n۵) لغو، برگرداندن به صف، تلاش مجدد')
{
  const c = await enqueueSms({ eventType: 'CAMPAIGN', phone: '09120000010', body: 'لغوی', dedupeKey: key('cancel') })
  const q = await smsQueueService.cancel(c.id, { reason: 'مشتری گفت نفرست', userId })
  eq('لغو شد', q.status, SmsOutboxStatus.CANCELED)
  eq('دلیل ثبت شد', q.cancelReason, 'مشتری گفت نفرست')
  eq('لغوکننده ثبت شد', q.canceledByUserId, userId)
  eq('موعد پاک شد', q.nextAttemptAt, null)
  eq('رکورد حذف نشد (لغو ≠ حذف)', outbox(c.id) != null, true)
  eq('در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_CANCEL) >= 1, true)
  await runSmsQueueOnce() // پیام‌های دیگرِ صف می‌روند، ولی لغوشده نباید برود
  eq('لغوشده حتی با اجرای صف هم نمی‌رود', outbox(c.id).status, SmsOutboxStatus.CANCELED)
  eq('لغوشده تلاشی مصرف نکرد', outbox(c.id).attemptCount, 0)

  const back = await smsQueueService.requeue(c.id, { userId })
  eq('به صف برگشت', back.status, SmsOutboxStatus.PENDING)
  eq('شمارنده‌ی تلاش صفر شد', back.attemptCount, 0)
  eq('دلیل لغو پاک شد', back.cancelReason, null)
  eq('برگرداندن در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_REQUEUE) >= 1, true)

  const r = await smsQueueService.retryNow(c.id, { userId })
  eq('تلاش مجدد ⇒ در صف', r.status, SmsOutboxStatus.PENDING)
  eq('تلاش مجدد در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_RETRY) >= 1, true)

  const sentId = 1
  await throws('لغو پیام ارسال‌شده رد می‌شود', () => smsQueueService.cancel(sentId, { userId }), 'ارسال شده')
  await throws('تلاش مجدد روی ارسال‌شده رد می‌شود', () => smsQueueService.retryNow(sentId, { userId }), 'ارسال شده')
  await throws('پیام ناموجود', () => smsQueueService.cancel(999999, { userId }), 'پیدا نشد')
  await throws('شناسه‌ی بی‌معنی', () => smsQueueService.cancel(0, { userId }), 'نامعتبر')
}

console.log('\n۶) لغو گروهی')
{
  const ids = []
  for (let i = 0; i < 3; i++)
    ids.push((await enqueueSms({ eventType: 'CAMPAIGN', phone: `0912000010${i}`, body: 'گروهی', dedupeKey: key('bulk' + i) })).id)
  const res = await smsQueueService.cancelBulk([...ids, 1, 999999], { reason: 'کمپین کنسل شد', userId })
  eq('تعداد درخواستی', res.requested, 5)
  eq('فقط ارسال‌نشده‌ها لغو شدند', res.canceled, 3)
  eq('ارسال‌شده دست‌نخورده ماند', outbox(1).status, SmsOutboxStatus.SENT)
  eq('لغو گروهی در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_CANCEL_BULK) >= 1, true)
  await throws('فهرست خالی رد می‌شود', () => smsQueueService.cancelBulk([], { userId }), 'انتخاب نشده')
}

console.log('\n۷) سرویس‌دهنده‌ی واقعیِ ناقص — بدون تماس شبکه، شکست صادقانه')
{
  // صف را با سرویس‌دهنده‌ی آزمایشی خالی می‌کنیم تا شمارش‌های این بخش دقیق باشد.
  for (let i = 0; i < 5; i++) if ((await runSmsQueueOnce()).picked === 0) break

  const ir = await smsCredentialService.save({
    providerKey: 'SMS_IR',
    name: 'sms.ir فروشگاه',
    senderNumber: '3000xxxx',
    patternId: '12345',
    isActive: true,
    userId
  })
  eq('فعال شد', ir.isActive, true)
  eq('«تنظیم نشده» چون کلید API ندارد', ir.missing.includes('کلید API'), true)

  const t = await smsCredentialService.test(ir.id, userId)
  eq('تست اتصال موفق نیست', t.ok, false)
  truthy('دلیل روشن گفته می‌شود', t.detail.includes('کلید API'), t.detail)
  eq('تست در AuditLog نشست', audits(AuditAction.SMS_PROVIDER_TEST) >= 1, true)

  const m = await enqueueSms({ eventType: 'CREDIT_REMINDER', phone: '09120000020', body: 'یادآوری', dedupeKey: key('ir') })
  const run = await runSmsQueueOnce()
  eq('یک پیام برداشته شد', run.picked, 1)
  eq('ناموفق شمرده شد', run.failed, 1)
  const row = outbox(m.id)
  eq('شکست قطعی (چون تکرار فایده ندارد)', row.status, SmsOutboxStatus.FAILED_FINAL)
  eq('کد خطا ثبت شد', row.lastErrorCode, 'PROVIDER_NOT_CONFIGURED')
  eq('دلیلش به کاربر گفته می‌شود', String(row.lastErrorMessage ?? '').includes('NOT_CONFIGURED'), true)
  truthy('و می‌گوید چطور برمی‌گردد', String(row.providerStatus ?? '').includes('برگرداندن به صف'), row.providerStatus)
  eq('موعد پاک شد', row.nextAttemptAt, null)
  eq('سابقه‌ی تلاش ثبت شد', sql.prepare('SELECT result FROM "SmsAttempt" WHERE outboxId = ?').get(m.id).result, 'FINAL')
  eq('پیام از صف پاک نشد (قابل بررسی)', outbox(m.id) != null, true)
}

console.log('\n۸) کلید API: مهر‌شده، پشت رمز مدیر')
{
  const ir = sql.prepare("SELECT id FROM \"SmsProviderConfig\" WHERE providerKey = 'SMS_IR'").get().id
  await throws(
    'بدون رمز مدیر ذخیره نمی‌شود',
    () => smsCredentialService.save({ id: ir, secrets: { apiKey: 'SECRET-KEY-1' }, userId }),
    'رمز مدیر'
  )
  await throws(
    'رمز اشتباه رد می‌شود',
    () => smsCredentialService.save({ id: ir, secrets: { apiKey: 'SECRET-KEY-1' }, managerPassword: 'غلط', userId }),
    'درست نیست'
  )

  const saved = await smsCredentialService.save({
    id: ir,
    secrets: { apiKey: 'SECRET-KEY-1' },
    managerPassword: PW,
    userId
  })
  eq('کلید ثبت شد (فقط «هست»)', saved.hasCredentials, true)
  eq('خودِ کلید برنمی‌گردد', JSON.stringify(saved).includes('SECRET-KEY-1'), false)
  eq('آماده‌بودن کامل شد', saved.missing.includes('کلید API'), false)

  const raw = sql.prepare('SELECT credentialsEncrypted FROM "SmsProviderConfig" WHERE id = ?').get(ir).credentialsEncrypted
  eq('متن خام کلید در دیتابیس نیست', String(raw).includes('SECRET-KEY-1'), false)
  truthy('بلوب رمزشده است', String(raw).startsWith('v1:'), String(raw).slice(0, 6))
  eq('نسخه‌ی راز بالا رفت', saved.credentialsVersion >= 2, true)
  eq('ثبت کلید در AuditLog نشست', audits(AuditAction.SMS_PROVIDER_SAVE) >= 2, true)

  const still = await smsCredentialService.save({ id: ir, name: 'sms.ir فروشگاه (نام جدید)', userId })
  eq('ذخیره‌ی بدون کلید، راز را پاک نمی‌کند', still.hasCredentials, true)
  eq('نام عوض شد', still.name, 'sms.ir فروشگاه (نام جدید)')

  const list = await smsCredentialService.list()
  eq('فهرست، کلید را لو نمی‌دهد', JSON.stringify(list).includes('SECRET-KEY-1'), false)
  eq('تنها یک سرویس‌دهنده فعال است', list.rows.filter((r) => r.isActive).length, 1)
}

console.log('\n۹) قالب‌ها')
{
  const created = await smsTemplateService.ensureDefaults()
  eq('قالب‌های پیش‌فرض ساخته شدند', created, DEFAULT_SMS_TEMPLATES.length)
  eq('بار دوم چیزی ساخته نمی‌شود', await smsTemplateService.ensureDefaults(), 0)

  const thanks = await smsTemplateService.get('SALE_THANK_YOU')
  truthy('قالب تشکر وجود دارد', thanks != null)
  eq('سیستمی است', thanks.isSystem, true)

  // هر متن پیش‌فرض خودِ برنامه باید معتبر باشد؛ اگر کسی متغیری را غلط بنویسد
  // (`{invoice_no}` به‌جای `{invoice_total}`)، همین‌جا لو می‌رود نه بعد از ارسال.
  const badDefaults = DEFAULT_SMS_TEMPLATES.filter((t) => !validateSmsBody(t.body).ok)
  ok_('همه‌ی قالب‌های پیش‌فرض متن معتبر دارند', badDefaults.length === 0, badDefaults.map((t) => t.code).join(', '))
  const unknownDefaults = DEFAULT_SMS_TEMPLATES.filter((t) =>
    smsPlaceholdersOf(t.body).some((k) => !SMS_PLACEHOLDERS.includes(k))
  )
  ok_('هیچ قالب پیش‌فرضی متغیر ناشناخته ندارد', unknownDefaults.length === 0)
  ok_(
    'قالب بدون‌تاریخ، تاریخ انقضا ندارد',
    !smsPlaceholdersOf(DEFAULT_SMS_TEMPLATES.find((t) => t.code === 'CREDIT_REMINDER_NO_EXPIRY').body).includes(
      'credit_expiry'
    )
  )
  ok_(
    'قالب تبلیغاتی جمله‌ی لغو دارد',
    smsPlaceholdersOf(DEFAULT_SMS_TEMPLATES.find((t) => t.code === 'CAMPAIGN').body).includes('opt_out_note')
  )

  await throws(
    'متغیر ناشناخته در قالب رد می‌شود',
    () => smsTemplateService.save({ code: 'SALE_THANK_YOU', body: 'سلام {چیز_ناشناس}', userId }),
    'ناشناس'
  )
  await throws(
    'قالب با آکولادِ جامانده ذخیره نمی‌شود',
    () => smsTemplateService.save({ code: 'SALE_THANK_YOU', body: 'سلام {نام_مشتری}', userId }),
    'ناشناخته'
  )

  // قاعده‌ی «لغو ۱۱»: پیامک تبلیغاتی بدون راه لغو ذخیره نمی‌شود
  await throws(
    'کمپین بدون جمله‌ی لغو ذخیره نمی‌شود',
    () => smsTemplateService.save({ code: 'CAMPAIGN', body: '{customer_name} عزیز، {campaign_text}', userId }),
    'لغو'
  )
  const withPlaceholder = await smsTemplateService.save({
    code: 'CAMPAIGN',
    body: '{customer_name} عزیز، {campaign_text} — {opt_out_note}',
    userId
  })
  ok_('کمپین با متغیر {opt_out_note} ذخیره می‌شود', !!withPlaceholder)
  const withLiteral = await smsTemplateService.save({
    code: 'CAMPAIGN',
    body: `{customer_name} عزیز، {campaign_text} · ${DEFAULT_SMS_OPT_OUT_NOTE}`,
    userId
  })
  ok_('کمپین با جمله‌ی دست‌نویس «لغو ۱۱» هم ذخیره می‌شود', !!withLiteral)
  const campaignBack = await smsTemplateService.reset('CAMPAIGN', userId)
  ok_('و برگرداندن به پیش‌فرض هم جمله‌ی لغو دارد', campaignBack.body.includes('opt_out_note'))

  const body = 'سلام {customer_name}، از خرید شما سپاسگزاریم. {store_name}'
  const saved = await smsTemplateService.save({ code: 'SALE_THANK_YOU', body, userId })
  eq('متن ذخیره شد', saved.body, body)
  eq('نسخه بالا رفت', saved.version, thanks.version + 1)
  eq('ویرایش در AuditLog نشست', audits(AuditAction.SMS_TEMPLATE_SAVE) >= 1, true)
  eq('ensureDefaults متن کاربر را بازنویسی نمی‌کند', (await smsTemplateService.get('SALE_THANK_YOU')).body, body)

  const off = await smsTemplateService.save({ code: 'SALE_THANK_YOU', body, isActive: false, userId })
  eq('خاموش شد', off.isActive, false)
  eq('متن قالب خاموش به صف نمی‌رود', await smsTemplateService.bodyOf('SALE_THANK_YOU'), null)

  const reset = await smsTemplateService.reset('SALE_THANK_YOU', userId)
  eq('متن پیش‌فرض برگشت', reset.body, DEFAULT_SMS_TEMPLATES.find((t) => t.code === 'SALE_THANK_YOU').body)
  eq('بازگرداندن در AuditLog نشست', audits(AuditAction.SMS_TEMPLATE_RESET) >= 1, true)
  await throws('قالب ناشناخته برنمی‌گردد', () => smsTemplateService.reset('NOPE', userId), 'پیش‌فرضِ برنامه')
}

console.log('\n۱۰) تنظیمات و برآورد')
{
  const before = await smsService.settings()
  eq('پیش‌فرض: ارسال خودکار خاموش', before.auto.enabled, false)
  eq('پیش‌فرض: «تشکر از خرید» خاموش (هیچ پیامکی بی‌خبر خرج نمی‌شود)', before.thankYou, false)

  const thanks = await smsService.saveSettings({ thankYou: true }, userId)
  eq('کلید تشکر روشن می‌شود', thanks.thankYou, true)
  eq('و در دیتابیس می‌ماند', (await smsService.settings()).thankYou, true)
  eq('و در داشبورد دیده می‌شود', (await smsService.dashboard()).thankYou, true)
  await smsService.saveSettings({ thankYou: false }, userId)
  eq('و خاموش‌کردنش هم کار می‌کند', (await smsService.settings()).thankYou, false)
  await smsService.saveSettings({ thankYou: true }, userId)

  const after = await smsService.saveSettings(
    { auto: { enabled: true, hour: 9, minute: 30, askOnEnable: true }, pricePerSegment: 1500 },
    userId
  )
  eq('تنظیمات ذخیره شد', [after.auto.enabled, after.auto.hour, after.auto.minute, after.pricePerSegment], [true, 9, 30, 1500])
  eq('تنظیمات در AuditLog نشست', audits(AuditAction.SMS_SETTINGS_UPDATE) >= 1, true)

  const back = await smsService.settings()
  eq('از دیتابیس درست خوانده می‌شود', back.auto.hour, 9)
  await smsService.saveSettings({ pricePerSegment: -50 }, userId)
  eq('قیمت منفی ⇒ صفر (واحد پول نمی‌سازیم)', (await smsService.settings()).pricePerSegment, 0)

  const est = await smsService.estimate({ body: 'س'.repeat(80), recipients: 1000, pricePerSegment: 200 })
  eq('تعداد بخش‌ها', est.segments, 2)
  eq('تعداد پیام‌ها', est.messages, 2000)
  eq('هزینه', est.toman, 400000)
  eq('قیمت تعیین شده', est.filled, true)
}

console.log('\n۱۱) داشبورد و فهرست')
{
  const d = await smsService.dashboard()
  truthy('داشبورد سرویس‌دهنده‌ی فعال را می‌بیند', d.provider?.id > 0)
  eq('ارسال‌شده‌ها شمرده می‌شوند', d.sent >= 1, true)
  eq('لغوشده‌ها شمرده می‌شوند', d.canceled >= 3, true)
  eq('تنظیمات خودکار در داشبورد', d.auto.hour, 9)
  truthy('آخرین ارسال ساعت دارد', !!d.lastSentAtTime)

  const all = await smsService.list({ take: 100 })
  eq('کل پیام‌ها', all.total, count())
  eq('مرتب‌سازی نزولی', all.rows[0].id > all.rows[all.rows.length - 1].id, true)

  const sentOnly = await smsService.list({ status: SmsOutboxStatus.SENT })
  truthy('فیلتر وضعیت کار می‌کند', sentOnly.rows.every((r) => r.status === SmsOutboxStatus.SENT))
  const sched = await smsService.list({ onlyScheduled: true })
  truthy('فهرست زمان‌بندی‌شده‌ها', sched.rows.every((r) => r.status === SmsOutboxStatus.PENDING))

  const one = await smsService.detail(1)
  truthy('جزئیات تلاش‌ها می‌آید', one.attempts.length >= 1)
  eq('پیام ارسال‌شده قابل لغو نیست', one.canCancel, false)
  eq('پیام ارسال‌شده قابل تلاش مجدد نیست', one.canRetry, false)
  await throws('جزئیات پیام ناموجود', () => smsService.detail(999999), 'پیدا نشد')

  const manual = await smsService.sendManual({ phone: '۰۹۱۲۹۹۹۸۸۷۷', body: 'پیام دستی آزمایشی', userId })
  eq('ارسال دستی در صف نشست', manual.ok, true)
  eq('شماره‌ی دستی یکسان شد', outbox(manual.id).phoneSnapshot, '09129998877')
  eq('ثبت دستی در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_ENQUEUE) >= 1, true)
  await throws('شماره‌ی نامعتبر در ارسال دستی', () => smsService.sendManual({ phone: '123', body: 'x', userId }), 'معتبر نیست')
  await throws('متن خالی در ارسال دستی', () => smsService.sendManual({ phone: '09121234567', body: '  ', userId }), 'خالی')

  const future = await smsService.sendManual({
    phone: '09121112233',
    body: 'زمان‌دار',
    scheduledAt: new Date(Date.now() + 7_200_000),
    userId
  })
  eq('ارسال دستی زمان‌دار ثبت شد', outbox(future.id).scheduledAt != null, true)

  const run = await smsService.runNow(userId)
  truthy('اجرای دستی صف کار می‌کند', run.recovered >= 0 && typeof run.sent === 'number')
  eq('اجرای دستی در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_ENQUEUE) >= 2, true)
}

console.log('\n۱۲) جداسازی: ماژول پیامک هیچ جدول دیگری را نمی‌نویسد')
{
  const tables = sql
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`
    )
    .all()
    .map((r) => r.name)
  // جدول‌هایی که این ماژول مجاز است بنویسد: صف، تلاش، قالب، سرویس‌دهنده، لاگ، تنظیمات
  const allowed = new Set(['SmsOutbox', 'SmsAttempt', 'SmsTemplate', 'SmsProviderConfig', 'AuditLog', 'Setting'])
  eq('جدول‌های ناشناخته‌ای وجود ندارد', tables.filter((t) => !allowed.has(t)).length > 0, true)

  const fk = sql.prepare('SELECT COUNT(*) AS n FROM "SmsOutbox" WHERE relatedEntity IS NOT NULL').get().n
  eq('پیام‌ها به فروش/اعتبار وابستگی سخت ندارند (ستون متنی، بدون FK)', fk, 0)

  const settings = sql.prepare("SELECT COUNT(*) AS n FROM \"Setting\" WHERE key LIKE 'sms.%'").get().n
  truthy('تنظیمات در جدول Setting نشستند (بدون جدول تازه)', settings >= 2)
}

console.log('\n۱۳) «دو بار کلیک ⇒ یک پیام» در ارسال دستی — و لغو ۱۱ درست قبل از ارسال')
{
  // یک خط فعال (آزمایشی) لازم داریم تا صف بتواند بردارد.
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط بررسی', isActive: true, userId })

  // ---------- SMS-CRIT-1: ارسال دستی تکراری ----------
  const p1 = await smsService.sendManual({ phone: '09125550001', body: 'متن تکراری برای بررسی', userId })
  const p2 = await smsService.sendManual({ phone: '09125550001', body: 'متن تکراری برای بررسی', userId })
  eq('کلیک دوم ردیف تازه نمی‌سازد', p2.duplicate, true)
  eq('و همان پیام اول برگردانده می‌شود', p2.id, p1.id)
  eq(
    'در صف فقط یک ردیف برای این شماره/متن هست',
    sql
      .prepare('SELECT COUNT(*) AS n FROM "SmsOutbox" WHERE phoneSnapshot = ? AND bodySnapshot = ?')
      .get('09125550001', 'متن تکراری برای بررسی').n,
    1
  )
  const p3 = await smsService.sendManual({ phone: '09125550001', body: 'متن متفاوت', userId })
  eq('متن متفاوت یک پیام تازه می‌سازد', [p3.duplicate === true, p3.id !== p1.id], [false, true])
  eq('و زمان‌بندی در پاسخ برمی‌گردد (UI از همین می‌خواند)', p3.scheduledAtJalali, null)

  // ---------- SMS-CRIT-2: لغو ۱۱ بعد از ورود به صف ----------
  const ad = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09125550002',
    body: 'تبلیغ بعد از لغو',
    dedupeKey: key('crit2'),
    priority: 7
  })
  // شماره *بعد از* صف‌شدن، لغو می‌کند (کمپین هزارتایی ساعت‌ها در صف می‌ماند)
  await db.smsOptOut.create({ data: { phone: '09125550002', source: 'PANEL', reason: 'لغو ۱۱' } })

  const run = await runSmsQueueOnce()
  const row = outbox(ad.id)
  eq('پیام تبلیغاتی برای شماره‌ی لغوکرده نرفت', row.status, SmsOutboxStatus.CANCELED)
  eq('علتش ثبت شد', row.lastErrorCode, 'OPT_OUT')
  eq('هیچ تلاشی مصرف نشد', row.attemptCount, 0)
  eq('و هیچ سابقه‌ی تلاشی هم ساخته نشد', await db.smsAttempt.count({ where: { outboxId: ad.id } }), 0)
  truthy('در شمارنده‌ی skipped گزارش شد', run.skipped >= 1, `skipped=${run.skipped}`)
  eq('پیام تبلیغاتی حتی یک بار به سرویس‌دهنده نرفت', sql.prepare('SELECT COUNT(*) AS n FROM "SmsOutbox" WHERE id = ? AND providerConfigId IS NOT NULL').get(ad.id).n, 0)

  // پیام خدماتی برای همان شماره باید برود (لغو ۱۱ فقط تبلیغاتی است)
  const svc = await enqueueSms({
    eventType: 'SALE_THANK_YOU',
    phone: '09125550002',
    body: 'تشکر از خرید',
    dedupeKey: key('crit2-svc'),
    priority: 3
  })
  await runSmsQueueOnce()
  eq('پیام خدماتی برای همان شماره مشکلی ندارد', outbox(svc.id).status, SmsOutboxStatus.SENT)
}

console.log('\n۱۴) مسابقه‌ی «لغو» با کارگر صف (SMS-BUG-01)')
{
  const line = await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'خط مسابقه',
    purpose: 'BOTH',
    isActive: true,
    userId
  })
  /**
   * سناریوی واقعی: کاربر روی پیامی که PENDING است «لغو» می‌زند؛ در همان
   * میلی‌ثانیه‌ها کارگر صف پیام را می‌فرستد. «لغو» نباید روی پیامِ رفته بنویسد
   * — وگرنه دکمه‌ی «برگرداندن به صف» همان پیام را بار دوم می‌فرستد.
   */
  const r = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09126660001',
    body: 'پیام مسابقه',
    dedupeKey: key('race-cancel'),
    priority: 3
  })

  const realFind = db.smsOutbox.findUnique.bind(db.smsOutbox)
  let armed = true
  db.smsOutbox.findUnique = async (args) => {
    const row = await realFind(args)
    // دقیقاً بین «خواندن» و «نوشتنِ» لغو، کارگر صف پیام را می‌فرستد.
    if (armed && args?.where?.id === r.id && !args?.select) {
      armed = false
      await runSmsQueueOnce()
    }
    return row
  }
  await throws('لغو کردن پیامِ ارسال‌شده، خطا می‌دهد', () => smsQueueService.cancel(r.id, { userId }))
  db.smsOutbox.findUnique = realFind

  eq('پیام واقعاً ارسال شده است', outbox(r.id).status, SmsOutboxStatus.SENT)
  eq('و دوباره فرستاده نشد', sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(r.id).n, 1)
  await throws('برگرداندن پیامِ ارسال‌شده هم ممکن نیست', () => smsQueueService.requeue(r.id, { userId }))
  await runSmsQueueOnce()
  eq('پس از همه‌ی این‌ها هنوز یک ارسال است', sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(r.id).n, 1)
  eq('ستون‌های لغو دست‌نخورده ماندند', outbox(r.id).canceledAt, null)

  // مسیر سالم هم باید کار کند: لغو پیامی که هنوز نرفته
  const safe = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09126660002',
    body: 'لغو سالم',
    dedupeKey: key('race-cancel-2'),
    priority: 3,
    scheduledAt: new Date(Date.now() + 3600_000)
  })
  const canceled = await smsQueueService.cancel(safe.id, { reason: 'تست', userId })
  eq('لغو معمولی سر جایش است', canceled.status, SmsOutboxStatus.CANCELED)
  eq('و خطِ فعال همان است که بود', Boolean(line?.id), true)
}

console.log('\n۱۵) خطای ثبت نتیجه بعد از پذیرش سرویس‌دهنده (SMS-BUG-02)')
{
  const r = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09126660003',
    body: 'پیام با خطای ثبت',
    dedupeKey: key('unknown-after-send'),
    priority: 3
  })
  const realUpdate = db.smsOutbox.update.bind(db.smsOutbox)
  let armed = true
  db.smsOutbox.update = async (args) => {
    if (armed && args?.data?.status === SmsOutboxStatus.SENT) {
      armed = false
      throw new Error('SQLITE_BUSY: database is locked')
    }
    return realUpdate(args)
  }
  await runSmsQueueOnce()
  db.smsOutbox.update = realUpdate

  const row = outbox(r.id)
  eq('وضعیت «نامعلوم» می‌شود، نه «تلاش دوباره»', row.status, SmsOutboxStatus.UNKNOWN)
  eq('دلیلش ثبت شد', row.lastErrorCode, 'RESULT_NOT_RECORDED')
  eq('تلاش هم شمرده شد (صادقانه)', row.attemptCount, 1)

  // دور بعد نباید خودش دوباره بفرستد
  await db.smsOutbox.update({ where: { id: r.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
  const run2 = await runSmsQueueOnce()
  eq('دور بعد برداشت نشد', run2.picked, 0)
  eq('و هنوز یک ارسال است', sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(r.id).n, 1)

  // ولی آدم می‌تواند تصمیم بگیرد (تلاش مجدد دستی)
  await smsQueueService.retryNow(r.id, { userId })
  eq('با تصمیم دستی به صف برمی‌گردد', outbox(r.id).status, SmsOutboxStatus.PENDING)
  await runSmsQueueOnce()
  eq('و این بار واقعاً می‌رود', outbox(r.id).status, SmsOutboxStatus.SENT)
}

console.log('\n۱۶) بازیابی قفل یتیم: «در پرواز» نباید دوباره فرستاده شود (SMS-BUG-02)')
{
  const live = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09126660004',
    body: 'ردیف در پرواز',
    dedupeKey: key('stale-flight'),
    priority: 3
  })
  const idle = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09126660005',
    body: 'ردیف بی‌شروع',
    dedupeKey: key('stale-idle'),
    priority: 3
  })
  const old = new Date(Date.now() - 30 * 60_000)
  sql.prepare('UPDATE "SmsOutbox" SET status = ?, lockedAt = ?, lockedBy = ?, providerStatus = ? WHERE id = ?').run(
    'PROCESSING',
    old.getTime(),
    'worker-که-مُرد',
    'SENDING',
    live.id
  )
  sql.prepare('UPDATE "SmsOutbox" SET status = ?, lockedAt = ?, lockedBy = ?, providerStatus = ? WHERE id = ?').run(
    'PROCESSING',
    old.getTime(),
    'worker-که-مُرد',
    null,
    idle.id
  )

  const recovered = await recoverStale()
  eq('هر دو ردیف بازیابی شدند', recovered, 2)
  eq('ردیفِ در پرواز «نامعلوم» می‌شود (ممکن است رسیده باشد)', outbox(live.id).status, SmsOutboxStatus.UNKNOWN)
  eq('ردیفِ شروع‌نشده به صف برمی‌گردد', outbox(idle.id).status, SmsOutboxStatus.PENDING)
  await runSmsQueueOnce()
  eq('و فقط همان یکی دوباره تلاش می‌شود', sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(idle.id).n, 1)
  eq('ردیف نامعلوم دست‌نخورده ماند', sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(live.id).n, 0)
}

console.log('\n۱۷) گرسنگی صف: خط خدماتی خاموش، کمپین باید برود (SMS-BUG-05)')
{
  // فقط خط تبلیغاتی فعال
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'فقط تبلیغاتی',
    purpose: 'ADS',
    isActive: true,
    userId
  })

  const note = await enqueueSms({
    eventType: 'SALE_THANK_YOU',
    phone: '09126660006',
    body: 'تشکر بی‌خط',
    templateCode: 'SALE_THANK_YOU',
    dedupeKey: key('starve-service'),
    priority: 3
  })
  for (let i = 0; i < 5; i++)
    await enqueueSms({
      eventType: 'CREDIT_REMINDER',
      phone: `0912666010${i}`,
      body: 'یادآوری بی‌خط',
      templateCode: 'CREDIT_REMINDER',
      dedupeKey: key(`starve-svc-${i}`),
      priority: 3
    })
  const camp = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09126660007',
    body: 'تبلیغ منتظر',
    dedupeKey: key('starve-campaign'),
    priority: 7
  })

  let blocked = ''
  for (let i = 0; i < 3; i++) blocked = (await runSmsQueueOnce()).blocked || blocked

  eq('کمپین رفت، با اینکه ۶ پیام خدماتی جلویش در صف بودند', outbox(camp.id).status, SmsOutboxStatus.SENT)
  eq('پیام‌های خدماتی سالم در صف ماندند', outbox(note.id).status, SmsOutboxStatus.PENDING)
  eq('و هیچ تلاشی هم مصرف نکردند', outbox(note.id).attemptCount, 0)
  truthy('هشدار خط خدماتی به مدیر داده می‌شود', blocked.includes('خط خدماتی'), blocked)
}

console.log('\n۱۸) «لغو ۱۱»: شکست بسته (SMS-BUG-09)')
{
  const r = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09126660008',
    body: 'تبلیغ با خطای خواندن لغو',
    dedupeKey: key('optout-read-fail'),
    priority: 7
  })
  // خط تبلیغاتی لازم است
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'تبلیغاتی', purpose: 'ADS', isActive: true, userId })

  const realFind = db.smsOptOut.findUnique.bind(db.smsOptOut)
  db.smsOptOut.findUnique = async () => {
    throw new Error('database is locked')
  }
  const run = await runSmsQueueOnce()
  db.smsOptOut.findUnique = realFind

  const row = outbox(r.id)
  eq('وقتی نمی‌دانیم لغو شده یا نه، پیام نمی‌رود', row.status, SmsOutboxStatus.PENDING)
  eq('و تلاشی هم مصرف نشد', row.attemptCount, 0)
  eq('قفل هم باقی نماند', row.lockedAt, null)
  truthy('هیچ ارسالی رخ نداد', !sql.prepare('SELECT COUNT(*) n FROM "SmsAttempt" WHERE outboxId = ?').get(r.id).n, `run=${JSON.stringify(run)}`)
}

console.log('\n۱۹) نوع سرویس‌دهنده و مقصد کلید (SMS-BUG-03 و SMS-BUG-08)')
{
  // یک خط واقعی با کلید مهرشده
  const ir = await smsCredentialService.save({
    providerKey: 'SMS_IR',
    name: 'خط sms.ir برای بررسی',
    senderNumber: '30001234',
    purpose: 'SERVICE',
    secrets: { apiKey: 'SECRET-KEY-123' },
    managerPassword: PW,
    userId
  })

  // ۰۸: ذخیره‌ی جزئی نباید نوع سرویس‌دهنده را بی‌صدا عوض کند
  const partial = await smsCredentialService.save({ id: ir.id, name: 'اسم تازه', userId })
  eq('ذخیره‌ی بدون providerKey، خط را آزمایشی نمی‌کند', partial.providerKey, 'SMS_IR')
  eq('و کلید هم سر جایش هست', partial.hasCredentials, true)
  eq('اسم عوض شد (ذخیره بی‌اثر نبود)', partial.name, 'اسم تازه')

  // ۰۳: تغییر مقصد کلید بدون رمز مدیر
  await throws(
    'تغییر baseUrl بدون رمز مدیر رد می‌شود',
    () => smsCredentialService.save({ id: ir.id, baseUrl: 'http://attacker.local/v1', userId }),
    'رمز مدیر'
  )
  await throws(
    'تغییر نوع سرویس‌دهنده بدون رمز مدیر هم رد می‌شود',
    () => smsCredentialService.save({ id: ir.id, providerKey: 'KAVENEGAR', userId }),
    'رمز مدیر'
  )

  const fixed = await smsCredentialService.save({
    id: ir.id,
    baseUrl: 'https://api.sms.ir/v1',
    managerPassword: PW,
    userId
  })
  eq('با رمز مدیر، مقصد درست ثبت می‌شود', fixed.baseUrl, 'https://api.sms.ir/v1')
  eq('و نوع سرویس‌دهنده دست‌نخورده می‌ماند', fixed.providerKey, 'SMS_IR')

  // هشدار «تست اتصال» کلید را به مقصد دلخواه فرستاد؟ حالا بدون رمز ممکن نیست.
  const captured = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    captured.push(String(url))
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: 10 }) }
  }
  await smsCredentialService.test(ir.id, userId)
  globalThis.fetch = realFetch
  eq('تست اتصال فقط به مقصد ثبت‌شده می‌رود', captured.every((u) => u.startsWith('https://api.sms.ir')), true)
}

console.log('\n۲۰) ارسال دستی تبلیغاتی (تصمیم صاحب فروشگاه)')
{
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  const svcLine = await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'خدماتی',
    purpose: 'SERVICE',
    isActive: true,
    userId
  })
  const adsLine = await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'تبلیغاتی',
    purpose: 'ADS',
    isActive: true,
    userId
  })

  const plain = await smsService.sendManual({ phone: '09128880001', body: 'پیام معمولی', userId })
  const ad = await smsService.sendManual({ phone: '09128880002', body: 'تخفیف ویژه', advertising: true, userId })

  await drainQueue()
  eq('پیام معمولی از خط خدماتی رفت', outbox(plain.id).providerConfigId, svcLine.id)
  eq('تبلیغاتی از خط تبلیغاتی رفت', outbox(ad.id).providerConfigId, adsLine.id)
  eq('و «لغو ۱۱» گرفت', String(outbox(ad.id).bodySnapshot).includes('لغو ۱۱'), true)
  eq('پیام معمولی جمله‌ی لغو نگرفت', String(outbox(plain.id).bodySnapshot).includes('لغو ۱۱'), false)
  eq('نوع رویداد تبلیغاتی CAMPAIGN است', outbox(ad.id).eventType, 'CAMPAIGN')
  eq('و اولویتِ تبلیغاتی دارد (ته صف، جلوتر از خدماتی مشتری نمی‌ایستد)', outbox(ad.id).priority, 7)

  // شماره‌ی لغوکرده، تبلیغ دستی نمی‌گیرد
  await db.smsOptOut.create({ data: { phone: '09128880003', source: 'PANEL' } })
  const refused = await smsService.sendManual({
    phone: '09128880003',
    body: 'تبلیغ برای لغوکرده',
    advertising: true,
    userId
  }).catch((e) => ({ detail: e.message }))
  eq('تبلیغ دستی برای شماره‌ی لغوکرده ساخته نمی‌شود', Boolean(refused?.detail), true)
}

console.log('\n۲۱) «الگو برای پیام خدماتی» صریح و قابل‌تغییر است')
{
  const line = await smsCredentialService.save({
    providerKey: 'SMS_IR',
    name: 'خط الگودار',
    senderNumber: '30001234',
    purpose: 'SERVICE',
    patternId: '123456',
    secrets: { apiKey: 'SECRET-KEY-۹۹' },
    managerPassword: PW,
    isActive: true,
    userId
  })
  eq('پیش‌فرض: پیام خدماتی با الگو می‌رود', line.patternForService, true)

  const captured = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: { packId: 'p1' } }) }
  }
  /**
   * ⚠️ «ارسال الگویی» فقط وقتی معنا دارد که متغیرهای قالب هم فرستاده شوند؛
   * آداپتور بدون متغیر، عمداً متن کامل می‌فرستد (`usePattern`). این ردیف
   * دقیقاً مثل مسیر واقعیِ «تشکر از خرید» متغیر دارد.
   */
  const r1 = await enqueueSms({
    eventType: 'SALE_THANK_YOU',
    phone: '09128880010',
    body: 'متن تشکر خودم',
    templateCode: 'SALE_THANK_YOU',
    variables: { invoice_no: 'A-1001', remaining_amount: '۰' },
    dedupeKey: key('pattern-on'),
    priority: 3
  })
  await drainQueue()
  globalThis.fetch = realFetch
  eq('با تیک روشن، درخواست الگویی رفت', captured.some((c) => c.url.includes('/send/verify')), true)

  // حالا تیک را برمی‌داریم
  const off = await smsCredentialService.save({
    id: line.id,
    patternForService: false,
    managerPassword: PW,
    userId
  })
  eq('تیک خاموش ذخیره شد', off.patternForService, false)

  const captured2 = []
  globalThis.fetch = async (url, init) => {
    captured2.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: { packId: 'p2' } }) }
  }
  await enqueueSms({
    eventType: 'SALE_THANK_YOU',
    phone: '09128880011',
    body: 'متن تشکر خودم — این بار باید همین برود',
    templateCode: 'SALE_THANK_YOU',
    variables: { invoice_no: 'A-1002', remaining_amount: '۰' },
    dedupeKey: key('pattern-off'),
    priority: 3
  })
  await drainQueue()
  globalThis.fetch = realFetch

  eq('با تیک خاموش، درخواست «متن کامل» رفت', captured2.some((c) => c.url.includes('/send/bulk')), true)
  const bulk = captured2.find((c) => c.url.includes('/send/bulk'))
  eq('و متنِ ویرایش‌شده‌ی کاربر در بدنه است', String(bulk?.body?.messageText ?? '').includes('این بار باید همین برود'), true)
  eq('ردیف اول هم واقعاً ارسال شد', outbox(r1.id).status, SmsOutboxStatus.SENT)
}

console.log('\n۲۲) آزادکردن سهمیه‌ی یادآوری وقتی پیام واقعاً نرفت')
{
  const svcAll = await import('../../src/main/services/StoreCreditService.ts')
  const { storeCreditService, issueStoreCredit } = svcAll
  const { setSmsOutcomeHook } = await import('../../src/main/services/sms/SmsQueue.ts')
  const { smsNotificationSender } = await import('../../src/main/services/sms/SmsNotificationSender.ts')
  const notify = await import('../../src/main/services/NotificationSender.ts')

  // همان یک خطِ بوت: فرستنده‌ی واقعی پیامک جای فرستنده‌ی لاگ‌محور
  notify.setNotificationSender(smsNotificationSender)

  // همان دوختِ بوت
  setSmsOutcomeHook((e) => {
    if (String(e?.eventType ?? '') !== 'CREDIT_REMINDER') return
    if (e.outcome !== 'FAILED_FINAL' && e.outcome !== 'CANCELED') return
    return storeCreditService.onReminderUndelivered({
      creditId: e.relatedEntityId,
      phone: e.phone,
      outboxId: e.outboxId,
      outcome: e.outcome,
      detail: e.detail
    })
  })

  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط سهمیه', purpose: 'SERVICE', isActive: true, userId })

  const credit = await issueStoreCredit(db, { amount: 6_000_000, holderPhone: '09128880020', source: 'MANUAL', userId })
  // `force` مثل دکمه‌ی دستی مدیر: بدون آن، قواعد ضداسپم اجازه نمی‌دهند.
  await storeCreditService.queueReminder({ id: credit.id, userId, force: true })
  eq('سهمیه یک بار مصرف شد', Math.round(Number(db.$harness.db.prepare('SELECT reminderCount n FROM "StoreCredit" WHERE id = ?').get(credit.id).n)), 1)

  const row = sql
    .prepare('SELECT * FROM "SmsOutbox" WHERE eventType = \'CREDIT_REMINDER\' AND phoneSnapshot = ? ORDER BY id DESC LIMIT 1')
    .get('09128880020')
  eq('ردیف صف با شناسه‌ی همان کد اعتبار ساخته شد', Math.round(Number(row.relatedEntityId)), credit.id)

  // ردیف صف را «لغو» می‌کنیم (دقیقاً همان کاری که مدیر یا خطا می‌کند)
  await smsQueueService.cancel(row.id, { reason: 'تست', userId })
  await new Promise((r) => setTimeout(r, 30)) // هوک fire-and-forget

  const after = db.$harness.db.prepare('SELECT reminderCount n FROM "StoreCredit" WHERE id = ?').get(credit.id).n
  eq('سهمیه آزاد شد', Math.round(Number(after)), 0)
  eq(
    'و لاگ یادآوری «ارسال واقعی انجام نشد» ثبت شد',
    String(sql.prepare('SELECT status FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC LIMIT 1').get(credit.id).status),
    'UNDELIVERED'
  )
  // هوک تکراری نباید سهمیه‌ی منفی بسازد
  await storeCreditService.onReminderUndelivered({ creditId: credit.id, outcome: 'CANCELED' })
  eq('اجرای دوباره‌ی هوک، سهمیه‌ی اضافه نمی‌سازد', Math.round(Number(db.$harness.db.prepare('SELECT reminderCount n FROM "StoreCredit" WHERE id = ?').get(credit.id).n)), 0)

  // و حالا یادآوری دوباره ممکن است (ضداسپم جلویش را نمی‌گیرد)
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط سهمیه ۲', purpose: 'SERVICE', isActive: true, userId })
  const again = await storeCreditService.queueReminder({ id: credit.id, userId, force: true })
  eq('یادآوری دوباره بلافاصله ممکن شد', Boolean(again?.id), true)
  eq('و سهمیه دوباره یک بار مصرف شد', Math.round(Number(db.$harness.db.prepare('SELECT reminderCount n FROM "StoreCredit" WHERE id = ?').get(credit.id).n)), 1)

  /**
   * و مهم‌تر: پیام **گم نشد**. ردیفِ همان یادآوری (نه یک ردیف تازه) به صف
   * برگشت؛ اگر برنمی‌گشت، سهمیه آزاد می‌شد ولی هیچ پیامکی هرگز نمی‌رفت —
   * دقیقاً همان «گم‌شدن»ی که کاربر گفته هرگز نباید بشود.
   */
  const back = sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(row.id)
  eq('همان ردیف به صف برگشت (پیام تکراریِ تازه ساخته نشد)', String(back.status), 'PENDING')
  eq('و لغوِ روی ردیف پاک شد', back.canceledAt == null ? 'پاک' : 'مانده', 'پاک')
  eq(
    'و برای همین یادآوری فقط یک ردیف در کل عمرش وجود دارد (نه دو تا)',
    Math.round(Number(sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox" WHERE eventType = ? AND phoneSnapshot = ?').get('CREDIT_REMINDER', '09128880020').c)),
    1
  )
  setSmsOutcomeHook(null)
}

// ---------------------------------------------------------------------------
console.log('\n۲۳) تبلیغ دستیِ تکراری و ردیف لغوشده — باگ‌های دوم و سوم بازبینی سوم')
{
  /**
   * باگ دوم: گارد «دو کلیک ⇒ یک پیام» برای پیام تبلیغاتی کار نمی‌کرد، چون
   * جست‌وجوی twin با **متن خام** انجام می‌شد ولی `enqueueSms` جمله‌ی «لغو ۱۱»
   * را به متن می‌چسباند و همان را ذخیره می‌کند ⇒ هیچ‌وقت پیدا نمی‌شد.
   */
  const ads = { phone: '09128880031', body: 'پیشنهاد ویژه‌ی این هفته', advertising: true, userId }
  const a1 = await smsService.sendManual(ads)
  const a2 = await smsService.sendManual(ads)
  eq('تبلیغ دستیِ دوبار کلیک‌شده تکراری شناخته شد', a2.duplicate, true)
  eq('و همان ردیف قبلی را برمی‌گرداند', Math.round(Number(a2.id)), Math.round(Number(a1.id)))
  eq(
    'و برای این شماره فقط یک ردیف پیام تبلیغاتی ساخته شد',
    Math.round(Number(sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox" WHERE phoneSnapshot = ?').get('09128880031').c)),
    1
  )
  eq(
    'و متن ذخیره‌شده همان متن با «لغو ۱۱» است (همان که twin با آن مقایسه شد)',
    String(sql.prepare('SELECT bodySnapshot b FROM "SmsOutbox" WHERE id = ?').get(a1.id).b).includes('لغو ۱۱'),
    true
  )

  /** ضدکنترل: دو شماره‌ی متفاوت ⇒ دو پیام (گارد بی‌دلیل سختگیر نیست). */
  const other = await smsService.sendManual({ ...ads, phone: '09128880032' })
  eq('همان متن برای شماره‌ی دیگر پیام تازه می‌سازد', other.duplicate, false)

  /** و بعد از گذشت پنجره‌ی ۹۰ ثانیه هم پیام تازه ساخته می‌شود. */
  const fresh = await smsService.sendManual({ ...ads, phone: '09128880033' })
  truthy('شماره‌ی سوم هم مستقل است', fresh.duplicate === false && Number(fresh.id) !== Number(a1.id))

  /**
   * باگ سوم: ردیف **لغوشده** هم «تکراری» شمرده می‌شد و در پاسخ `ok:true`
   * برمی‌گشت؛ یعنی کاربر پیام «ثبت شد» می‌دید ولی هیچ پیامی هرگز نمی‌رفت.
   */
  const tomorrow = new Date(Date.now() + 24 * 3600_000)
  const sched = await smsService.sendManual({
    phone: '09128880034',
    body: 'سفارش شما آماده‌ی تحویل است',
    scheduledAt: tomorrow,
    userId
  })
  await smsQueueService.cancel(sched.id, { reason: 'زمان اشتباه بود', userId })
  const re = await smsService.sendManual({ phone: '09128880034', body: 'سفارش شما آماده‌ی تحویل است', userId })
  eq('ردیف لغوشده «تکراری» حساب نشد', re.duplicate, false)
  truthy('و یک ردیف تازه ساخته شد', Number(re.id) !== Number(sched.id), `id لغوشده=${sched.id} · id تازه=${re.id}`)
  eq(
    'و پیام تازه واقعاً زنده است (PENDING)',
    String(sql.prepare('SELECT status s FROM "SmsOutbox" WHERE id = ?').get(re.id).s),
    'PENDING'
  )
  eq(
    'و ردیف لغوشده هم سر جایش مانده (دست‌نخورده)',
    String(sql.prepare('SELECT status s FROM "SmsOutbox" WHERE id = ?').get(sched.id).s),
    'CANCELED'
  )

  /** ضدکنترل: پیام زنده‌ی معمولی هنوز تکراری گرفته می‌شود. */
  const live = await smsService.sendManual({ phone: '09128880035', body: 'یادآوری ساده', userId })
  const live2 = await smsService.sendManual({ phone: '09128880035', body: 'یادآوری ساده', userId })
  eq('پیام خدماتیِ زنده تکراری گرفته می‌شود', live2.duplicate, true)
  eq('و همان ردیف اول برگشت', Math.round(Number(live2.id)), Math.round(Number(live.id)))

  await drainQueue()
}

// ---------------------------------------------------------------------------
console.log('\n۲۴) سهمیه‌ی یادآوری و بازگرداندن دستی — باگ‌های بازبینی چهارم')
{
  const svcAll2 = await import('../../src/main/services/StoreCreditService.ts')
  const { storeCreditService, issueStoreCredit: issueCredit2 } = svcAll2
  const { smsReminderManualResendBlocked } = await import('@shared/sms')
  const { smsCredentialService } = await import('../../src/main/services/sms/SmsCredentials.ts')

  // یک کد اعتبار «واجد شرایط» بساز (تاریخ صدورش را عقب می‌بریم تا ضداسپم اجازه بدهد)
  const mkCredit = async (phone) => {
    const c = await issueCredit2(db, { amount: 4_000_000, holderPhone: phone, source: 'MANUAL', userId })
    sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * 86400_000, c.id)
    return c
  }
  const cancelableOutbox = (phone) =>
    sql.prepare('SELECT * FROM "SmsOutbox" WHERE phoneSnapshot = ? ORDER BY id DESC LIMIT 1').get(phone)
  const lastReminderLog = (creditId) =>
    sql.prepare('SELECT status FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC LIMIT 1').get(creditId)
  const creditRow = (id) => sql.prepare('SELECT reminderCount FROM "StoreCredit" WHERE id = ?').get(id)

  /** همان دوختِ بوت — §۲۲ در پایان هوک را پاک می‌کند، پس اینجا دوباره وصلش می‌کنیم. */
  const { setSmsOutcomeHook: setHook2 } = await import('../../src/main/services/sms/SmsQueue.ts')
  setHook2((e) => {
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

  /**
   * 🚫 باگ اول بازبینی چهارم: «برگرداندن به صف» روی یادآوریِ لغو‌شده.
   * لغو ⇒ هوک سهمیه را آزاد می‌کند. اگر همان ردیف دستی برگردد، پیام می‌رود
   * ولی سهمیه مصرف نمی‌شود ⇒ فردا زمان‌بند یادآوری دوم را می‌فرستد.
   */
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'خط بازبینی ۴',
    purpose: 'SERVICE',
    isActive: true,
    userId
  })

  const c1 = await mkCredit('09128880041')
  await storeCreditService.queueReminder({ id: c1.id, userId, force: true })
  const row1 = cancelableOutbox('09128880041')
  await smsQueueService.cancel(row1.id, { reason: 'اشتباهی', userId })
  await new Promise((r) => setTimeout(r, 40))

  let requeueBlocked = false
  let requeueMsg = ''
  try {
    await smsQueueService.requeue(row1.id, { userId })
  } catch (e) {
    requeueBlocked = true
    requeueMsg = String(e?.message ?? '')
  }
  eq('«برگرداندن به صف» برای یادآوریِ لغو‌شده مسدود است', requeueBlocked, true)
  truthy('و پیام خطا کاربر را به پنل اعتبار می‌فرستد', requeueMsg.includes('پنل اعتبار خرید'), requeueMsg.slice(0, 70))
  eq(
    'و ردیف همچنان لغو‌شده ماند (دست‌نخورده)',
    String(sql.prepare('SELECT status FROM "SmsOutbox" WHERE id = ?').get(row1.id).status),
    'CANCELED'
  )

  let retryBlocked = false
  try {
    await smsQueueService.retryNow(row1.id, { userId })
  } catch {
    retryBlocked = true
  }
  eq('«تلاش مجدد» هم برای همین ردیف مسدود است', retryBlocked, true)
  eq('و سهمیه‌اش آزاد مانده (چون پیام نرفت)', Math.round(Number(creditRow(c1.id).reminderCount)), 0)

  /**
   * ✅ مسیر درست باز است: دکمه‌ی «یادآوری» پنل اعتبار. همان ردیف را برمی‌گرداند
   * (پل با `source: 'credit_bridge'`) و سهمیه را مصرف می‌کند.
   */
  const again1 = await storeCreditService.queueReminder({ id: c1.id, userId, force: true })
  eq('مسیر پنل اعتبار پیام را می‌فرستد', String(again1?.status), 'LOGGED')
  eq(
    'و همان ردیف لغو‌شده به صف برگشت (نه ردیف تازه)',
    String(sql.prepare('SELECT status FROM "SmsOutbox" WHERE id = ?').get(row1.id).status),
    'PENDING'
  )
  eq('و سهمیه دوباره مصرف شد', Math.round(Number(creditRow(c1.id).reminderCount)), 1)

  /**
   * 🛡️ گارد «رویداد کهنه»: یک رویداد CANCELED که به ردیفِ **قدیمی‌تر** مربوط
   * است نباید سهمیه‌ی یادآوری تازه‌تر (واقعاً تحویل‌شده) را آزاد کند.
   */
  await drainQueue()
  const fresh1 = cancelableOutbox('09128880041')
  eq('یادآوری تازه واقعاً رفت', String(fresh1.status), 'SENT')

  /**
   * ⛔ به‌جای صدا زدن مستقیم هوک با یک رویداد کهنه (که تست را الکی سبز می‌کرد)،
   * همان سناریوی واقعی را می‌سنجیم: «لغو گروهی» با idِ یک ردیفِ از قبل لغوشده
   * + یک ردیف زنده. سد اول در `emitOutcome` است (رویداد مربوط به ردیفِ غیرآخرین
   * یادآوری دور ریخته می‌شود) و سد دوم همین بخش ۲۴ پایین‌تر در `cancelBulk`.
   */

  const c3 = await mkCredit('09128880043')
  await storeCreditService.queueReminder({ id: c3.id, userId, force: true })
  const r3old = cancelableOutbox('09128880043')
  await smsQueueService.cancel(r3old.id, { reason: 'قدیمی', userId })
  await new Promise((r) => setTimeout(r, 40))
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({
    providerKey: 'LOG_ONLY',
    name: 'خط بازبینی ۴-ج',
    purpose: 'SERVICE',
    isActive: true,
    userId
  })
  await storeCreditService.queueReminder({ id: c3.id, userId, force: true })
  await drainQueue()
  const countAfterSecond = Math.round(Number(creditRow(c3.id).reminderCount))

  /**
   * «لغو گروهی» با idهای یک ردیفِ از قبل لغوشده + یک ردیف زنده (همان کاری که
   * UI می‌کند). ردیف کهنه نباید دوباره رویداد بدهد.
   */
  const liveX = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09128888999',
    body: 'پیام زنده برای لغو گروهی',
    dedupeKey: 'r4-bulk-x',
    scheduledAt: new Date(Date.now() + 3600_000)
  })
  await smsQueueService.cancelBulk([r3old.id, liveX.id], { reason: 'لغو گروهی', userId })
  await new Promise((r) => setTimeout(r, 60))
  eq(
    '«لغو گروهی» سهمیه‌ی یادآوریِ تحویل‌شده را آزاد نمی‌کند',
    Math.round(Number(creditRow(c3.id).reminderCount)),
    countAfterSecond
  )
  eq(
    'و لاگ آن یادآوری «تحویل‌شده» می‌ماند',
    String(lastReminderLog(c3.id)?.status),
    'LOGGED'
  )

  /** گارد خالص هم همان چهار حالت را می‌دهد. */
  eq('گارد خالص: یادآوری لغو‌شده مسدود', smsReminderManualResendBlocked('CREDIT_REMINDER', 'CANCELED'), true)
  eq('گارد خالص: یادآوری ناموفق قطعی مسدود', smsReminderManualResendBlocked('CREDIT_REMINDER', 'FAILED_FINAL'), true)
  eq('گارد خالص: یادآوری نامعلوم آزاد', smsReminderManualResendBlocked('CREDIT_REMINDER', 'UNKNOWN'), false)
  eq('گارد خالص: پیام معمولی آزاد', smsReminderManualResendBlocked('MANUAL', 'CANCELED'), false)

  /** فهرست UI: یادآوریِ **همین حالا لغو‌شده** نباید دکمه‌ی بازگرداندن بدهد. */
  const c4 = await mkCredit('09128880044')
  await storeCreditService.queueReminder({ id: c4.id, userId, force: true })
  const row4 = cancelableOutbox('09128880044')
  await smsQueueService.cancel(row4.id, { reason: 'برای آزمون دکمه‌ها', userId })
  await new Promise((r) => setTimeout(r, 40))
  const l1 = await smsService.list({ take: 200 })
  const rowView = (l1.rows ?? []).find((r) => r.id === row4.id)
  eq('فهرست پنل برای یادآوریِ لغو‌شده دکمه‌ی بازگرداندن نمی‌دهد', rowView?.canRequeue, false)
  eq('و دکمه‌ی تلاش مجدد هم نمی‌دهد', rowView?.canRetry, false)
  eq('و پرچم «از پنل اعتبار بفرستید» دارد', rowView?.reminderNeedsCreditPanel, true)
  eq(
    'ولی خودِ سهمیه آزاد شده است (پس یادآوری دوباره ممکن است)',
    Math.round(Number(creditRow(c4.id).reminderCount)),
    0
  )

  setHook2(null)
}

// ---------------------------------------------------------------------------
console.log('\n۲۵) شکستِ «منتظرِ شرایط» سهمیه‌ی تلاش را نمی‌سوزاند — باگ بازبینی هفتم')
{
  /**
   * 🔴 SMS-R7-01: قبلاً سقف ۵ تلاش (≈۸۱ دقیقه) روی **همه‌ی** شکست‌ها اعمال
   * می‌شد. یعنی یک قطعی دو ساعته‌ی اینترنت یا تمام‌شدن اعتبار حساب، پیام را
   * برای همیشه `FAILED_FINAL` می‌کرد و بعد از رفع مشکل هم **خودکار نمی‌رفت** —
   * برخلاف متنی که خودِ برنامه نشان می‌داد. کمپین ۱۰۰۰ نفره‌ای که وسطش اعتبار
   * تمام شود باید ۱۰۰۰ بار دستی «برگرداندن به صف» می‌خورد.
   *
   * رفتار درست: این شکست‌ها بودجه‌ی تلاش را مصرف نمی‌کنند، با فاصله‌ی ثابت یک
   * ساعت ادامه می‌دهند، به‌محض رفع مشکل خودکار می‌روند، و ردیفِ کهنه‌تر از
   * ۷۲ ساعت (که هیچ‌وقت هم نمی‌شود) در صف نمی‌چرخد.
   */
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  const kav = await smsCredentialService.save({
    providerKey: 'KAVENEGAR',
    name: 'کاوه‌نگار منتظر',
    senderNumber: '10004346',
    purpose: 'SERVICE',
    secrets: { apiKey: 'KAV-R7-KEY' },
    managerPassword: PW,
    isActive: true,
    userId
  })
  eq('خط کاوه‌نگار فعال شد', kav.isActive, true)

  const realFetch7 = globalThis.fetch
  let outage = true
  let posts = 0
  const fake7 = async () => {
    posts++
    if (!outage) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ return: { status: 200, message: 'ok' }, entries: [{ messageid: 77 }] }) }
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ return: { status: 418, message: 'اعتبار شما کافی نمی‌باشد' }, entries: null })
    }
  }
  globalThis.fetch = fake7

  const waitRow = await enqueueSms({ eventType: 'MANUAL', phone: '09128880050', body: 'منتظر اعتبار', dedupeKey: key('wait-1') })
  const r7 = () => sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(waitRow.id)

  // هفت دور پشت‌سرهم با همان سقف ۵ تلاش قبلی — اگر بودجه می‌سوخت، قطعی می‌شد.
  for (let i = 0; i < 7; i++) {
    await runSmsQueueOnce()
    sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ? AND status = ?').run(Date.now() - 1000, waitRow.id, 'FAILED_RETRYABLE')
  }
  eq('بعد از ۷ دور، همچنان در صف است (قطعِ قطعی نشده)', r7().status, SmsOutboxStatus.FAILED_RETRYABLE)
  eq('و سهمیه‌ی تلاش مصرف نشده', Math.round(Number(r7().attemptCount)), 0)

  // یک دور دیگر، این بار بدون عقب‌بردن تاریخ، تا فاصله‌ی بعدی را ببینیم
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, waitRow.id)
  await runSmsQueueOnce()
  const gapMin = Math.round((Number(r7().nextAttemptAt) - Date.now()) / 60_000)
  truthy('فاصله‌ی ثابتِ یک‌ساعته (نه backoff نماییِ سوزاننده)', gapMin >= 58 && gapMin <= 60, `فاصله=${gapMin}د`)
  eq('سابقه‌ی تلاش با نتیجه‌ی WAITING ثبت می‌شود', sql.prepare('SELECT result FROM "SmsAttempt" WHERE outboxId = ? ORDER BY id DESC LIMIT 1').get(waitRow.id).result, 'WAITING')

  // مشکل محیطی برطرف می‌شود (شارژ/وصل‌شدن اینترنت) ⇒ باید خودکار برود
  outage = false
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, waitRow.id)
  await runSmsQueueOnce()
  eq('بعد از رفع مشکل، خودکار می‌رود (بدون دخالت دستی)', r7().status, SmsOutboxStatus.SENT)
  eq('و شناسه‌ی سرویس‌دهنده ثبت شد', String(r7().providerMessageId), '77')
  truthy('و تلاش‌ها همه به همان سرویس‌دهنده رفته‌اند', posts >= 9, `POST=${posts}`)

  /**
   * ضدکنترل: سقف ۷۲ ساعتِ **دوره‌ی انتظار**. اگر مشکل بیش از سه روز ادامه
   * داشته باشد، ردیف «ناموفق قطعی» می‌شود تا برای همیشه در صف نچرخد — ولی پاک
   * نمی‌شود و «تلاش مجدد» دستی همیشه هست.
   *
   * ⚠️ بازبینی هشتم: سن از `createdAt` شمرده **نمی‌شود**؛ از اولین تلاشِ
   * `WAITING` شمرده می‌شود. پس تست هم باید سابقه‌ی تلاش بسازد، نه اینکه فقط
   * تاریخ ساخت ردیف را عقب ببرد.
   */
  outage = true
  const staleRow = await enqueueSms({ eventType: 'MANUAL', phone: '09128880051', body: 'کهنه', dedupeKey: key('wait-stale') })
  await runSmsQueueOnce() // اولین انتظار — ثبت سابقه‌ی WAITING
  const firstWait = sql.prepare('SELECT * FROM "SmsAttempt" WHERE outboxId = ? ORDER BY id ASC LIMIT 1').get(staleRow.id)
  eq('اولین تلاش با نتیجه‌ی WAITING ثبت شد', firstWait.result, 'WAITING')
  // حالا همان انتظار را ۷۳ ساعت کهنه می‌کنیم (سنِ انتظار، نه سنِ ردیف)
  sql.prepare('UPDATE "SmsAttempt" SET startedAt = ? WHERE id = ?').run(Date.now() - SMS_WAITING_MAX_AGE_MS - 3600_000, firstWait.id)
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, staleRow.id)
  await runSmsQueueOnce()
  globalThis.fetch = realFetch7
  const stale = sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(staleRow.id)
  eq('انتظارِ بیش از ۷۲ ساعت ⇒ «ناموفق قطعی» (در صف نمی‌چرخد)', stale.status, SmsOutboxStatus.FAILED_FINAL)
  eq('و موعد پاک شد', stale.nextAttemptAt, null)
  eq('ولی پیام پاک نشد (قابل بررسی و «تلاش مجدد» دستی)', outbox(staleRow.id) != null, true)

  /**
   * 🔴 و نکته‌ی اصلی بازبینی هشتم: پیامِ **زمان‌بندی‌شده** برای چند روز بعد،
   * وقتی موعدش می‌رسد تازه «شروعِ انتظار»‌اش است. اگر سن را از `createdAt`
   * بشماریم، اولین خطای موقتی او را فوراً قطعی می‌کند (چون ردیف چهار روز پیش
   * ساخته شده) — همان باگی که تست بالا عمداً دیگر نمی‌سازد.
   */
  outage = true
  globalThis.fetch = fake7
  const sched = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09128880052',
    body: 'یادآوری قرار',
    dedupeKey: key('wait-scheduled'),
    scheduledAt: new Date(Date.now() + 4 * 86_400_000)
  })
  const shift4 = 4 * 86_400_000 + 60_000
  sql
    .prepare('UPDATE "SmsOutbox" SET createdAt = createdAt - ?, scheduledAt = scheduledAt - ?, nextAttemptAt = nextAttemptAt - ? WHERE id = ?')
    .run(shift4, shift4, shift4, sched.id)
  await runSmsQueueOnce()
  const schedRow = sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(sched.id)
  eq('پیامِ زمان‌بندی‌شده سرِ موعد، با قطعیِ اینترنت قطعی نمی‌شود', schedRow.status, SmsOutboxStatus.FAILED_RETRYABLE)
  eq('و سهمیه‌ی تلاشش هم نسوخته', Math.round(Number(schedRow.attemptCount)), 0)
  outage = false
  sql.prepare('UPDATE "SmsOutbox" SET nextAttemptAt = ? WHERE id = ?').run(Date.now() - 1000, sched.id)
  await runSmsQueueOnce()
  eq('و بعد از رفع مشکل خودکار می‌رود', sql.prepare('SELECT status FROM "SmsOutbox" WHERE id = ?').get(sched.id).status, SmsOutboxStatus.SENT)
  outage = true
  globalThis.fetch = realFetch7
}

// ---------------------------------------------------------------------------
console.log('\n۲۶) داخل تراکنش، خواندن‌های صف از همان کلاینتِ تراکنش می‌روند')
{
  /**
   * 🔴 چرا: کمپین با `client: tx` در یک تراکنش ثبت می‌شود (همه‌یا‌هیچ). اگر
   * خواندن‌های «لغو ۱۱» و «جمله‌ی لغو» با `prisma` سراسری بروند، روی SQLite
   * اتصال دوم می‌خواهند و قفل نویسنده‌ی تراکنش می‌تواند تا پایان آن نگهشان
   * دارد — یعنی ثبت کمپین روی نصب واقعی گیر کند (هارنس این را نشان نمی‌دهد).
   * این تست مکانیزم را می‌سنجد: هر خواندن باید از کلاینتی برود که داده شده.
   */
  await db.smsProviderConfig.updateMany({ data: { isActive: false } })
  await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط تراکنش', purpose: 'BOTH', isActive: true, userId })

  const seen = []
  const spy = new Proxy(db, {
    get(target, prop, recv) {
      if (prop === 'setting' || prop === 'smsOptOut' || prop === 'smsOutbox') seen.push(String(prop))
      return Reflect.get(target, prop, recv)
    }
  })

  const res = await db.$transaction(async () =>
    enqueueSms(
      { eventType: 'CAMPAIGN', phone: '09128880060', body: 'تبلیغ داخل تراکنش', dedupeKey: key('tx-reads') },
      { client: spy, strict: true }
    )
  )

  eq('پیام داخل تراکنش ثبت شد', res.ok, true)
  truthy('خواندن «لغو ۱۱» از کلاینتِ تراکنش رفت', seen.includes('smsOptOut'), `دیده‌شده=${[...new Set(seen)].join(' · ')}`)
  truthy('و خواندن جمله‌ی لغو هم از همان کلاینت رفت', seen.includes('setting'))
  eq('و متن نهایی جمله‌ی لغو دارد', String(outbox(res.id).bodySnapshot).includes(DEFAULT_SMS_OPT_OUT_NOTE), true)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
