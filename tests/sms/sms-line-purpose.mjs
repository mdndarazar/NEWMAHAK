/**
 * ===========================================================================
 * دو خط پیامک: «خدماتی» جدا از «تبلیغاتی» — روی دیتابیس واقعی.
 *
 * چرا این سوییت وجود دارد: تا قبل از این، صف همیشه **اولین** سرویس‌دهنده‌ی
 * فعال را برمی‌داشت. یعنی یک فروشگاه می‌توانست فقط یک خط فعال کند و همان یک خط
 * هم پیام تبلیغاتی می‌فرستاد و هم تشکر خرید — دقیقاً همان چیزی که مقررات
 * اجازه نمی‌دهد (خط خدماتی/تراکنشی نباید تبلیغ بفرستد).
 *
 * آنچه این‌جا تضمین می‌شود:
 *   • خط خدماتی و خط تبلیغاتی می‌توانند **هم‌زمان** فعال باشند،
 *   • هر پیام از خط خودش می‌رود (کمپین از تبلیغاتی، تشکر/یادآوری از خدماتی)،
 *   • اگر خط مناسب فعال نباشد، پیام **در صف می‌ماند** و هیچ تلاشی مصرف نمی‌شود
 *     (ارسال از خط اشتباه بدتر از «در صف ماندن» است)،
 *   • فروشگاهِ تک‌خطی (حالت پیش‌فرض «هر دو کاره») هیچ رفتاری عوض نمی‌کند.
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-line-purpose.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-line-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { smsCredentialService, activeLines, lineForEvent } = await import(
  '../../src/main/services/sms/SmsCredentials.ts'
)
const { enqueueSms, runSmsQueueOnce } = await import('../../src/main/services/sms/SmsQueue.ts')
const { smsService } = await import('../../src/main/services/sms/SmsService.ts')
const {
  SMS_LINE_PURPOSES,
  SMS_LINE_PURPOSE_LABELS,
  SMS_PROVIDER_LABELS,
  normalizeSmsLinePurpose,
  pickSmsLine,
  smsLineMatchesPurpose,
  smsLinePurposeForEvent,
  SmsOutboxStatus,
  SmsEventType
} = await import('@shared/sms')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

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
const truthy = (label, cond, detail = '') => {
  if (cond) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ' · ' + detail : ''}`)
  }
}

const outbox = (id) => db.smsOutbox.findUnique({ where: { id } })
const purposeOf = async (id) => {
  const row = await db.smsProviderConfig.findUnique({ where: { id } })
  return normalizeSmsLinePurpose(row?.purpose)
}

// ---------------------------------------------------------------------------
console.log('\n۱) توابع مشترک — بدون دیتابیس')
{
  eq('پیش‌فرض ناشناخته ⇒ هر دو کاره', normalizeSmsLinePurpose(undefined), 'BOTH')
  eq('رشته‌ی خالی ⇒ هر دو کاره', normalizeSmsLinePurpose(''), 'BOTH')
  eq('انگلیسی کوچک', normalizeSmsLinePurpose('service'), 'SERVICE')
  eq('فارسی «خدماتی»', normalizeSmsLinePurpose('خدماتی'), 'SERVICE')
  eq('هم‌معنی TRANSACTIONAL', normalizeSmsLinePurpose('TRANSACTIONAL'), 'SERVICE')
  eq('فارسی «تبلیغاتی»', normalizeSmsLinePurpose('تبلیغاتی'), 'ADS')
  eq('هم‌معنی ADVERTISING', normalizeSmsLinePurpose('ADVERTISING'), 'ADS')
  eq('سه برچسب نمایش وجود دارد', Object.keys(SMS_LINE_PURPOSE_LABELS).length, 3)

  eq('کمپین ⇒ تبلیغاتی', smsLinePurposeForEvent(SmsEventType.CAMPAIGN), 'ADS')
  eq('تشکر خرید ⇒ خدماتی', smsLinePurposeForEvent(SmsEventType.SALE_THANK_YOU), 'SERVICE')
  eq('یادآوری اعتبار ⇒ خدماتی', smsLinePurposeForEvent(SmsEventType.CREDIT_REMINDER), 'SERVICE')
  eq('ارسال دستی ⇒ خدماتی', smsLinePurposeForEvent(SmsEventType.MANUAL), 'SERVICE')
  eq('نوع ناشناخته ⇒ خدماتی (محافظه‌کارانه)', smsLinePurposeForEvent('چیز-عجیب'), 'SERVICE')

  eq('خط خدماتی، پیام تبلیغاتی را نمی‌فرستد', smsLineMatchesPurpose('SERVICE', 'ADS'), false)
  eq('خط تبلیغاتی، پیام خدماتی را نمی‌فرستد', smsLineMatchesPurpose('ADS', 'SERVICE'), false)
  eq('خط خدماتی، خدماتی را می‌فرستد', smsLineMatchesPurpose('SERVICE', 'SERVICE'), true)
  eq('خط هر دو کاره، هر دو را می‌فرستد', [
    smsLineMatchesPurpose('BOTH', 'SERVICE'),
    smsLineMatchesPurpose('BOTH', 'ADS')
  ], [true, true])

  eq('تک‌خطیِ هر دو کاره جواب می‌دهد', pickSmsLine([{ id: 7, purpose: 'BOTH' }], 'ADS')?.id, 7)
  eq('تطابق دقیق بر «هر دو کاره» مقدم است', pickSmsLine([{ id: 1, purpose: 'BOTH' }, { id: 2, purpose: 'ADS' }], 'ADS')?.id, 2)
  eq('خط نامرتبط ⇒ هیچ', pickSmsLine([{ id: 1, purpose: 'SERVICE' }], 'ADS'), null)
  eq('فهرست خالی ⇒ هیچ', pickSmsLine([], 'SERVICE'), null)
  eq('فهرست خراب ⇒ هیچ (نه throw)', pickSmsLine(null, 'SERVICE'), null)
}

// ---------------------------------------------------------------------------
console.log('\n۲) دو خط هم‌زمان فعال می‌شوند')
const userId = seed.user('مدیر-خطوط')
let serviceLine = null
let adsLine = null
{
  serviceLine = await smsCredentialService.save({
    name: 'خط خدماتی فروشگاه',
    providerKey: 'LOG_ONLY',
    senderNumber: '10008566',
    purpose: 'SERVICE',
    isActive: true,
    userId
  })
  eq('خط خدماتی فعال شد', serviceLine.isActive, true)
  eq('کاربردش خدماتی است', serviceLine.purpose, SMS_LINE_PURPOSES.SERVICE)
  eq('برچسبش درست است', serviceLine.purposeLabel, SMS_LINE_PURPOSE_LABELS.SERVICE)
  eq('پرچم تطابق: تبلیغاتی نه', serviceLine.matches.ADS, false)

  adsLine = await smsCredentialService.save({
    name: 'خط تبلیغاتی فروشگاه',
    providerKey: 'LOG_ONLY',
    senderNumber: '30008566',
    purpose: 'ADS',
    isActive: true,
    userId
  })

  const lines = await activeLines()
  eq('هر دو خط فعال ماندند (نه یکی)', lines.length, 2)
  eq('هر خط کاربرد خودش را دارد', lines.map((l) => l.purpose).sort(), ['ADS', 'SERVICE'])

  const dash = await smsService.dashboard()
  truthy('داشبورد خط خدماتی را نشان می‌دهد', dash.providerService?.id === serviceLine.id)
  truthy('داشبورد خط تبلیغاتی را نشان می‌دهد', dash.providerAds?.id === adsLine.id)
  eq('هر پیام به خط خودش وصل می‌شود', [
    (await lineForEvent(SmsEventType.CAMPAIGN))?.id,
    (await lineForEvent(SmsEventType.SALE_THANK_YOU))?.id
  ], [adsLine.id, serviceLine.id])
}

// ---------------------------------------------------------------------------
console.log('\n۳) تبلیغاتی فعال، خدماتی خاموش ⇒ تشکر در صف می‌ماند')
let thankYouRow = null
let campaignRow = null
{
  await db.smsProviderConfig.update({ where: { id: serviceLine.id }, data: { isActive: false } })
  eq('فقط خط تبلیغاتی فعال است', (await activeLines()).length, 1)

  const ty = await enqueueSms({
    eventType: SmsEventType.SALE_THANK_YOU,
    phone: '09121110001',
    body: 'از خرید شما سپاسگزاریم',
    templateCode: 'SALE_THANK_YOU',
    dedupeKey: 'line-ty-1',
    priority: 3,
    userId
  })
  const cp = await enqueueSms({
    eventType: SmsEventType.CAMPAIGN,
    phone: '09121110002',
    body: 'جشنواره فروش',
    dedupeKey: 'line-cp-1',
    priority: 7,
    userId
  })
  eq('هر دو پیام در صف نشستند', [ty.ok, cp.ok], [true, true])
  thankYouRow = ty.id
  campaignRow = cp.id

  const res = await runSmsQueueOnce()
  eq('کمپین رفت', (await outbox(campaignRow)).status, SmsOutboxStatus.SENT)
  eq('کمپین از خط تبلیغاتی رفت', (await outbox(campaignRow)).providerConfigId, adsLine.id)
  eq('متن تبلیغاتی جمله‌ی لغو دارد', (await outbox(campaignRow)).bodySnapshot.includes('لغو ۱۱'), true)

  const tyAfter = await outbox(thankYouRow)
  eq('تشکر همچنان در صف است', tyAfter.status, SmsOutboxStatus.PENDING)
  eq('هیچ تلاشی برایش مصرف نشد', tyAfter.attemptCount, 0)
  eq('قفلی هم باقی نمانده', [tyAfter.lockedAt, tyAfter.lockedBy], [null, null])
  truthy('هشدار صف درباره‌ی خط خدماتی است', res.blocked.includes('خط خدماتی'), res.blocked)
  eq('هیچ پیام خدماتی‌ای از خط تبلیغاتی نرفت', await db.smsAttempt.count({ where: { outboxId: thankYouRow } }), 0)
}

// ---------------------------------------------------------------------------
console.log('\n۴) خدماتی فعال، تبلیغاتی خاموش ⇒ کمپین در صف می‌ماند')
let blockedCampaign = null
{
  await smsCredentialService.activate(serviceLine.id, userId)
  await db.smsProviderConfig.update({ where: { id: adsLine.id }, data: { isActive: false } })

  const run = await runSmsQueueOnce()
  eq('تشکرِ معطل‌مانده حالا رفت', (await outbox(thankYouRow)).status, SmsOutboxStatus.SENT)
  eq('تشکر از خط خدماتی رفت', (await outbox(thankYouRow)).providerConfigId, serviceLine.id)
  eq('متن خدماتی جمله‌ی لغو نگرفت', (await outbox(thankYouRow)).bodySnapshot.includes('لغو ۱۱'), false)

  const cp = await enqueueSms({
    eventType: SmsEventType.CAMPAIGN,
    phone: '09121110003',
    body: 'تبلیغ دوم',
    dedupeKey: 'line-cp-2',
    priority: 7,
    userId
  })
  blockedCampaign = cp.id
  const res2 = await runSmsQueueOnce()
  eq('کمپین در صف ماند', (await outbox(blockedCampaign)).status, SmsOutboxStatus.PENDING)
  eq('تلاشی مصرف نشد', (await outbox(blockedCampaign)).attemptCount, 0)
  truthy('هشدار صف درباره‌ی خط تبلیغاتی است', res2.blocked.includes('خط تبلیغاتی'), res2.blocked)

  // حالا هر دو خط فعال ⇒ همان کمپین معطل‌مانده باید برود
  await smsCredentialService.activate(adsLine.id, userId)
  eq('هر دو خط با هم فعال‌اند', (await activeLines()).length, 2)
  await runSmsQueueOnce()
  eq('کمپین معطل‌مانده بعد از فعال‌شدن خط تبلیغاتی رفت', (await outbox(blockedCampaign)).status, SmsOutboxStatus.SENT)
  eq('و از خط تبلیغاتی رفت', (await outbox(blockedCampaign)).providerConfigId, adsLine.id)
}

// ---------------------------------------------------------------------------
console.log('\n۵) خط «هر دو کاره» تنها خط فعال می‌ماند (فروشگاه تک‌خطی)')
{
  const both = await smsCredentialService.save({
    name: 'خط قدیمی هر دو کاره',
    providerKey: 'LOG_ONLY',
    senderNumber: '10009999',
    purpose: 'BOTH',
    isActive: true,
    userId
  })
  const lines = await activeLines()
  eq('فقط یک خط فعال ماند', lines.length, 1)
  eq('و آن خط، همان هر دو کاره است', lines[0].id, both.id)
  eq('خط خدماتی خاموش شد', (await db.smsProviderConfig.findUnique({ where: { id: serviceLine.id } })).isActive, false)
  eq('خط تبلیغاتی خاموش شد', (await db.smsProviderConfig.findUnique({ where: { id: adsLine.id } })).isActive, false)

  const ty = await enqueueSms({
    eventType: SmsEventType.SALE_THANK_YOU,
    phone: '09121110004',
    body: 'تشکر تک‌خطی',
    dedupeKey: 'line-ty-2',
    priority: 3,
    userId
  })
  const cp = await enqueueSms({
    eventType: SmsEventType.CAMPAIGN,
    phone: '09121110005',
    body: 'تبلیغ تک‌خطی',
    dedupeKey: 'line-cp-3',
    priority: 7,
    userId
  })
  await runSmsQueueOnce()
  eq('پیام خدماتی رفت', (await outbox(ty.id)).status, SmsOutboxStatus.SENT)
  eq('پیام تبلیغاتی هم رفت', (await outbox(cp.id)).status, SmsOutboxStatus.SENT)
  eq('هر دو از همان خط رفتند', [
    (await outbox(ty.id)).providerConfigId,
    (await outbox(cp.id)).providerConfigId
  ], [both.id, both.id])

  // برگشت به خط خدماتی: «هر دو کاره» باید خاموش شود
  await smsCredentialService.activate(serviceLine.id, userId)
  eq('با فعال‌کردن خط خدماتی، خط هر دو کاره خاموش شد', await purposeOf(both.id) === 'BOTH' && (await db.smsProviderConfig.findUnique({ where: { id: both.id } })).isActive, false)
  eq('و فقط خط خدماتی فعال است', (await activeLines()).map((l) => l.id), [serviceLine.id])
}

// ---------------------------------------------------------------------------
console.log('\n۶) سازگاری با ردیف‌های قدیمی (بدون ستون کاربرد)')
{
  const legacy = await db.smsProviderConfig.create({
    data: { name: 'ردیف قدیمی', providerKey: 'LOG_ONLY', senderNumber: '10001010', isActive: false }
  })
  eq('ردیف قدیمی خودکار «هر دو کاره» می‌شود', await purposeOf(legacy.id), 'BOTH')
  await smsCredentialService.activate(legacy.id, userId)
  eq('و می‌تواند همه‌ی پیام‌ها را بفرستد', (await activeLines())[0].purpose, 'BOTH')
  eq('برچسب سرویس‌دهنده‌ها هم سالم است', typeof SMS_PROVIDER_LABELS.LOG_ONLY, 'string')
}

// ---------------------------------------------------------------------------
console.log('\n۷) جداسازی: هیچ جدول مالی‌ای دست نمی‌خورد')
{
  const invoiceBefore = sql.prepare('SELECT COUNT(*) c FROM "SaleInvoice"').get().c
  const creditBefore = sql.prepare('SELECT COUNT(*) c FROM "StoreCredit"').get().c
  await runSmsQueueOnce()
  await smsService.dashboard()
  eq('فاکتور فروش دست‌نخورده', sql.prepare('SELECT COUNT(*) c FROM "SaleInvoice"').get().c, invoiceBefore)
  eq('اعتبار دست‌نخورده', sql.prepare('SELECT COUNT(*) c FROM "StoreCredit"').get().c, creditBefore)
}

// ---------------------------------------------------------------------------
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
