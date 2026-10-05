/**
 * ===========================================================================
 * فاز ۴ — پیامک انبوه تبلیغاتی روی دیتابیس واقعی.
 *
 * آنچه این سوییت تضمین می‌کند:
 *   • «لغو ۱۱» یک **قفل مقرراتی** است، نه تزئین UI: حتی اگر کسی مستقیم
 *     `enqueueSms` صدا بزند، شماره‌ی لغوکرده پیام تبلیغاتی نمی‌گیرد و متن
 *     بدون جمله‌ی لغو هم نمی‌رود.
 *   • جمله‌ی لغو **تنظیم‌شدنی** است: با عوض‌کردن تنظیم، پیام‌های بعدی جمله‌ی
 *     تازه می‌گیرند و کد دست‌نخورده می‌ماند.
 *   • کمپین فقط صف می‌کند؛ «لغو گروهی» فقط ارسال‌نشده‌ها را لغو می‌کند.
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-campaign.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-campaign-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { smsCampaignService, smsOptOutService } = await import('../../src/main/services/sms/SmsCampaignService.ts')
const { enqueueSms } = await import('../../src/main/services/sms/SmsQueue.ts')
const { smsService } = await import('../../src/main/services/sms/SmsService.ts')
const { SmsOutboxStatus, DEFAULT_SMS_OPT_OUT_NOTE, parseSmsPhoneList, smsWithOptOutNote } = await import('@shared/sms')
const { AuditAction } = await import('@shared/enums')

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
const throws = async (label, fn) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · خطا نداد`)
  } catch {
    ok++
    console.log(`  ✓ ${label}`)
  }
}
const audits = (action) => sql.prepare('SELECT COUNT(*) c FROM "AuditLog" WHERE action = ?').get(action).c
const outbox = (id) => sql.prepare('SELECT * FROM "SmsOutbox" WHERE id = ?').get(id)
const campaignRows = (id) => sql.prepare('SELECT * FROM "SmsOutbox" WHERE campaignId = ?').all(id)
const userId = seed.user().id

// ---------------------------------------------------------------------------
console.log('\n۱) پارس فهرست چسبانده‌شده')
{
  const p = parseSmsPhoneList('۰۹۱۲۱۲۳۴۵۶۷\n09121234567، 0912-123-4568  02122334455')
  eq('فارسی و لاتین یکی می‌شوند', p.valid, ['09121234567', '09121234568'])
  eq('شماره‌ی ثابت نامعتبر می‌ماند', p.invalid, ['02122334455'])
  eq('تکراری شمرده شد', p.duplicates, 1)
  eq('متن خالی ⇒ چیزی نیست', parseSmsPhoneList('   ').valid, [])
  eq('جمله‌ی لغو دو بار نمی‌چسبد', smsWithOptOutNote('سلام\nلغو ۱۱', 'لغو ۱۱'), 'سلام\nلغو ۱۱')
}

// ---------------------------------------------------------------------------
console.log('\n۲) دفترچه‌ی شماره‌های برنامه')
{
  seed.customer('آقای الف', '09120000001')
  seed.customer('خانم ب', '0912 000 0002') // با فاصله ذخیره شده
  seed.customer('آقای ج', '09120000003')
  seed.customer('بی‌شماره', '')

  const before = await smsCampaignService.bank()
  eq('سه شماره‌ی معتبر', before.total, 3)
  eq('همه در دسترس', before.available, 3)

  const add = await smsOptOutService.add({ phone: '09120000003', reason: 'خودش گفت', userId })
  eq('انصراف ثبت شد', add.already, false)
  const again = await smsOptOutService.add({ phone: '09120000003', userId })
  eq('ثبت دوباره خطا نیست', again.already, true)

  const after = await smsCampaignService.bank()
  eq('شماره‌ی لغوکرده از دسترس بیرون رفت', after.available, 2)
  eq('و شمرده می‌شود', after.optOut, 1)
  eq('در AuditLog نشست', audits(AuditAction.SMS_OPT_OUT_ADD) >= 1, true)
}

// ---------------------------------------------------------------------------
console.log('\n۳) پیش‌نمایش — قبل از خرج‌کردن پول')
{
  const pv = await smsCampaignService.preview({
    body: 'جشنواره‌ی پاییزه‌ی ارکاجین',
    phones: '09120000004, 09120000005',
    includeBank: true
  })
  // «مخاطب» = هر شماره‌ی معتبری که پیدا شد (۳ دفترچه + ۲ فهرست)…
  eq('مخاطبِ پیدا‌شده = ۵ شماره', pv.audienceCount, 5)
  // …و «قابل ارسال» = همان‌ها منهای کسی که «لغو ۱۱» کرده.
  eq('قابل ارسال = ۴ شماره', pv.sendable, 4)
  eq('منبع ترکیبی', pv.source, 'MIXED')
  eq('جمله‌ی لغو پیش‌فرض', pv.optOutNote, DEFAULT_SMS_OPT_OUT_NOTE)
  truthy('متن نهایی جمله‌ی لغو را دارد', pv.finalBody.endsWith(DEFAULT_SMS_OPT_OUT_NOTE), pv.finalBody)
  truthy('هزینه فقط برآورد است (قیمت پیش‌فرض صفر)', pv.costEstimate >= 0)

  const dup = await smsCampaignService.preview({
    body: 'تست',
    phones: '09120000004, 09120000001',
    includeBank: true
  })
  eq('شماره‌ی تکراری با دفترچه شمرده شد', dup.duplicateCount, 1)
  eq('ولی دو بار فرستاده نمی‌شود', dup.sendable, 3)

  const bad = await smsCampaignService.preview({ body: 'تست', phones: '12345', includeBank: false })
  eq('شماره‌ی نامعتبر', bad.invalidCount, 1)
  eq('و چیزی برای ارسال نمی‌ماند', bad.sendable, 0)
  await throws('متن با متغیر ناشناخته رد می‌شود', () =>
    smsCampaignService.preview({ body: 'سلام {چیز_ناشناس}', phones: '09120000004' })
  )
}

// ---------------------------------------------------------------------------
console.log('\n۴) ثبت کمپین — فقط صف، نه ارسال فوری')
{
  const res = await smsCampaignService.create({
    name: 'جشنواره پاییزه',
    body: 'جشنواره‌ی پاییزه‌ی ارکاجین',
    phones: '09120000004',
    includeBank: true,
    userId
  })
  const c = res.campaign
  eq('سه شماره در صف نشست', res.queued, 3)
  eq('شناسه‌ی کمپین ثبت شد', typeof c.id, 'number')
  eq('شمارنده‌ی مخاطب', c.audienceCount, 3)
  eq('یک شماره به‌خاطر لغو کنار گذاشته شد', c.optOutSkipped, 1)
  eq('وضعیت', c.status, 'QUEUED')

  const rows = campaignRows(c.id)
  eq('سه ردیف صف', rows.length, 3)
  eq('همه از نوع کمپین', [...new Set(rows.map((r) => r.eventType))], ['CAMPAIGN'])
  eq('اولویت کمپین = ۷ (پشت تراکنشی‌ها)', [...new Set(rows.map((r) => r.priority))], [7])
  eq('همه در وضعیت انتظار', [...new Set(rows.map((r) => r.status))], [SmsOutboxStatus.PENDING])
  truthy(
    'جمله‌ی لغو در متن همه هست',
    rows.every((r) => String(r.bodySnapshot).includes(DEFAULT_SMS_OPT_OUT_NOTE))
  )
  truthy('شماره‌ی لغوکرده در صف نیست', !rows.some((r) => r.phoneSnapshot === '09120000003'))
  eq('در AuditLog نشست', audits(AuditAction.SMS_CAMPAIGN_CREATE), 1)

  const listed = await smsCampaignService.list()
  eq('در فهرست کمپین‌ها دیده می‌شود', listed.rows[0].id, c.id)
  eq('شمارنده‌ی زنده‌ی صف', listed.rows[0].pendingCount, 3)
}

// ---------------------------------------------------------------------------
console.log('\n۵) قفل مقرراتی: «لغو ۱۱» حتی از مسیر مستقیم')
{
  const optOut = sql.prepare('SELECT phone FROM "SmsOptOut" LIMIT 1').get().phone
  const blocked = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: optOut,
    body: 'تبلیغ',
    dedupeKey: `campaign-block-${optOut}`
  })
  eq('برای شماره‌ی لغوکرده صف نمی‌شود', blocked.ok, false)
  eq('و دلیلش گفته می‌شود', blocked.skipped, true)
  truthy('دلیل به «لغو» اشاره دارد', blocked.detail.includes('لغو'), blocked.detail)

  const forced = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09120000009',
    body: 'تبلیغ بدون جمله',
    dedupeKey: 'campaign-forced-note'
  })
  eq('پیام تبلیغاتی مستقیم ثبت شد', forced.ok, true)
  const row = outbox(forced.id)
  truthy('ولی جمله‌ی لغو به آن چسبید', String(row.bodySnapshot).includes(DEFAULT_SMS_OPT_OUT_NOTE), row.bodySnapshot)

  // پیام غیرتبلیغاتی نباید جمله‌ی لغو بگیرد
  const thanks = await enqueueSms({
    eventType: 'MANUAL',
    phone: '09120000009',
    body: 'ممنون از خرید شما',
    dedupeKey: 'campaign-not-ad'
  })
  truthy(
    'پیام غیرتبلیغاتی جمله‌ی لغو نمی‌گیرد',
    !String(outbox(thanks.id).bodySnapshot).includes(DEFAULT_SMS_OPT_OUT_NOTE)
  )
}

// ---------------------------------------------------------------------------
console.log('\n۶) جمله‌ی لغو تنظیم‌شدنی است (اگر مقررات عوض شد)')
{
  await smsService.saveSettings({ optOutNote: 'لغو ۲۲' }, userId)
  const pv = await smsCampaignService.preview({ body: 'تست', phones: '09120000004', includeBank: false })
  eq('پیش‌نمایش جمله‌ی تازه را نشان می‌دهد', pv.optOutNote, 'لغو ۲۲')
  truthy('متن نهایی با جمله‌ی تازه بسته می‌شود', pv.finalBody.endsWith('لغو ۲۲'), pv.finalBody)

  const r2 = await enqueueSms({
    eventType: 'CAMPAIGN',
    phone: '09120000010',
    body: 'تبلیغ تازه',
    dedupeKey: 'campaign-note-changed'
  })
  truthy('پیام تازه جمله‌ی تازه می‌گیرد', String(outbox(r2.id).bodySnapshot).includes('لغو ۲۲'))

  const c2 = await smsCampaignService.create({
    name: 'کمپین با جمله‌ی تازه',
    body: 'دومین تبلیغ',
    phones: '09120000011',
    includeBank: false,
    userId
  })
  eq('کمپین، جمله‌ی همان لحظه را snapshot می‌کند', c2.campaign.optOutNote, 'لغو ۲۲')
  truthy(
    'و همه‌ی ردیف‌هایش همان را دارند',
    campaignRows(c2.campaign.id).every((r) => String(r.bodySnapshot).includes('لغو ۲۲'))
  )

  await smsService.saveSettings({ optOutNote: DEFAULT_SMS_OPT_OUT_NOTE }, userId)
  const back = await smsCampaignService.preview({ body: 'تست', phones: '09120000004', includeBank: false })
  eq('برگشت به پیش‌فرض هم کار می‌کند', back.optOutNote, DEFAULT_SMS_OPT_OUT_NOTE)
}

// ---------------------------------------------------------------------------
console.log('\n۷) لغو گروهی — فقط ارسال‌نشده‌ها')
{
  const one = sql.prepare('SELECT id FROM "SmsCampaign" ORDER BY id ASC LIMIT 1').get().id
  const rows = campaignRows(one)
  eq('سه ردیف دارد', rows.length, 3)

  // یکی را «ارسال‌شده» می‌کنیم تا ببینیم لغو گروهی به آن دست نمی‌زند.
  sql.prepare('UPDATE "SmsOutbox" SET status = ? WHERE id = ?').run('SENT', rows[0].id)

  const res = await smsCampaignService.cancel(one, { reason: 'تغییر برنامه', userId })
  eq('دو پیام ارسال‌نشده لغو شد', res.canceled, 2)
  eq('ارسال‌شده دست‌نخورده ماند', outbox(rows[0].id).status, 'SENT')
  eq('بقیه لغو شدند', outbox(rows[1].id).status, 'CANCELED')
  eq('دلیل لغو ثبت شد', outbox(rows[1].id).cancelReason, 'تغییر برنامه')
  eq('کمپین هم لغو شد', sql.prepare('SELECT status FROM "SmsCampaign" WHERE id = ?').get(one).status, 'CANCELED')
  eq('در AuditLog نشست', audits(AuditAction.SMS_OUTBOX_CANCEL_BULK) >= 1, true)
  await throws('لغو دوباره خطا می‌دهد', () => smsCampaignService.cancel(one, { userId }))

  const other = sql.prepare('SELECT id FROM "SmsCampaign" WHERE id <> ? ORDER BY id ASC LIMIT 1').get(one).id
  eq(
    'کمپین دیگر دست‌نخورده ماند',
    campaignRows(other).every((r) => r.status === SmsOutboxStatus.PENDING),
    true
  )
}

// ---------------------------------------------------------------------------
console.log('\n۸) جداسازی: هیچ جدول مالی‌ای نوشته نمی‌شود')
{
  const invoiceBefore = sql.prepare('SELECT COUNT(*) c FROM "SaleInvoice"').get().c
  const creditBefore = sql.prepare('SELECT COUNT(*) c FROM "StoreCredit"').get().c
  await smsCampaignService.create({ name: 'کمپین آخر', body: 'آخرین تبلیغ', phones: '09120000012', includeBank: true, userId })
  await smsOptOutService.add({ phone: '09120000013', userId })
  eq('فاکتور فروش دست‌نخورده', sql.prepare('SELECT COUNT(*) c FROM "SaleInvoice"').get().c, invoiceBefore)
  eq('اعتبار دست‌نخورده', sql.prepare('SELECT COUNT(*) c FROM "StoreCredit"').get().c, creditBefore)
  eq('لغو ۱۱ پاک نمی‌شود (سابقه)', sql.prepare('SELECT COUNT(*) c FROM "SmsOptOut"').get().c >= 2, true)
}

// ---------------------------------------------------------------------------
console.log('\n۹) کمپین «همه یا هیچ» است (SMS-CRIT-4)')
{
  const campaignsBefore = sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign"').get().c

  /**
   * شکست وسط حلقه را شبیه‌سازی می‌کنیم: تریگری روی SmsOutbox که برای متن خاصی
   * خطا می‌دهد. قبلاً کمپین ساخته می‌شد و بخشی از پیام‌ها بی‌سابقه گم می‌شدند
   * (کمپین «موفق» با پیام‌های نرفته)؛ حالا باید همه‌چیز برگردد.
   */
  sql.exec(`CREATE TRIGGER sms_crit4_boom BEFORE INSERT ON "SmsOutbox"
            WHEN NEW."bodySnapshot" LIKE '%انفجار%'
            BEGIN SELECT RAISE(ABORT, 'boom'); END;`)

  await throws('ثبت کمپین با خطای وسط راه، خطا می‌دهد', () =>
    smsCampaignService.create({
      name: 'کمپین خراب',
      body: 'پیام انفجاری',
      phones: '09127770001, 09127770002, 09127770003',
      userId
    })
  )

  sql.exec('DROP TRIGGER sms_crit4_boom')

  eq('هیچ کمپین نیمه‌کاره‌ای ساخته نشد', sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign"').get().c, campaignsBefore)
  eq(
    'و هیچ پیام نیمه‌صفی باقی نماند',
    sql.prepare('SELECT COUNT(*) c FROM "SmsOutbox" WHERE phoneSnapshot LIKE \'0912777%\'').get().c,
    0
  )
  eq(
    'ردیف کمپین خراب در دیتابیس نیست',
    sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign" WHERE name = \'کمپین خراب\'').get().c,
    0
  )

  // و مسیر سالم بعد از این خطا هنوز کار می‌کند
  const good = await smsCampaignService.create({
    name: 'کمپین سالم بعد از خطا',
    body: 'تبلیغ سالم',
    phones: '09127770011, 09127770012',
    userId
  })
  eq('کمپین سالم ثبت شد', good.queued, 2)
  eq('و هر دو پیامش در صف‌اند', campaignRows(good.campaign.id).length, 2)
}

// ---------------------------------------------------------------------------
console.log('\n۸) «ثبت دوباره‌ی همان کمپین» — باگ اول بازبینی سوم')
{
  /**
   * چرا بحرانی است: `dedupeKey` هر پیام کمپین به شناسه‌ی خود کمپین گره خورده،
   * پس دو کمپین کاملاً یکسان هیچ‌وقت جلوی هم را نمی‌گیرند. با دو بار Enter روی
   * دیالوگ تأیید، هر مشتری **دو تبلیغ** می‌گرفت.
   */
  const before = sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign"').get().c
  const same = {
    name: 'حراج تکراری',
    body: 'حراج پایان فصل',
    phones: '09128880001, 09128880002',
    userId
  }

  await smsCampaignService.create(same)
  eq('بار اول ساخته شد', sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign"').get().c, before + 1)

  await throws('همان کمپین ظرف چند لحظه دوباره ساخته نمی‌شود', () => smsCampaignService.create(same))
  eq(
    'و کمپین دوم ساخته نشد',
    sql.prepare('SELECT COUNT(*) c FROM "SmsCampaign"').get().c,
    before + 1
  )
  eq(
    'و برای آن شماره‌ها پیام تکراری در صف نیست',
    sql.prepare("SELECT COUNT(*) c FROM \"SmsOutbox\" WHERE phoneSnapshot LIKE '091288800%'").get().c,
    2
  )

  /**
   * ضدکنترل مهم: گارد نباید بی‌دلیل سختگیر باشد.
   *   • همان متن، یک شماره‌ی متفاوت ⇒ کمپین دیگری است (مثلاً نیمه‌ی دوم فهرست).
   *   • همان فهرست، متن متفاوت ⇒ پیام دیگری است.
   *   • همان فهرست، زمان‌بندی متفاوت (فردا) ⇒ کمپین دیگری است.
   */
  const halfTwo = await smsCampaignService.create({ ...same, phones: '09128880001, 09128880003' })
  eq('نیمه‌ی دوم فهرست رد نمی‌شود (شماره‌ها فرق دارند)', halfTwo.queued, 2)

  const otherText = await smsCampaignService.create({ ...same, body: 'حراج پایان فصل — فقط امروز' })
  eq('متن متفاوت رد نمی‌شود', otherText.queued, 2)

  /**
   * زمان‌بندی هم بخشی از «همان کمپین» است: اگر کاربر دو بار با **همان زمان**
   * فرم را بفرستد، دومی تکراری است و رد می‌شود. (ولی «الان» و «فردا» دو کار
   * متفاوت‌اند و هر دو آزادند.)
   */
  const tomorrow = new Date(Date.now() + 24 * 3600_000)
  const sched = await smsCampaignService.create({ ...same, scheduledAt: tomorrow })
  truthy('کمپین زمان‌بندی‌شده برای فردا ساخته شد', sched.queued >= 1)
  await throws('و همان کمپین با همان زمان دوباره ساخته نمی‌شود', () =>
    smsCampaignService.create({ ...same, scheduledAt: tomorrow })
  )

  /**
   * لایه‌ی دوم گارد: دو فراخوانی **هم‌زمان** (همان لحظه، پیش از آنکه اولی در
   * نقشه‌ی اثرانگشت ثبت شود). یکی باید رد شود.
   */
  const race = await Promise.allSettled([
    smsCampaignService.create({ ...same, phones: '09128880009', body: 'کمپین هم‌زمان' }),
    smsCampaignService.create({ ...same, phones: '09128880009', body: 'کمپین هم‌زمان' })
  ])
  const fulfilled = race.filter((r) => r.status === 'fulfilled').length
  const rejected = race.filter((r) => r.status === 'rejected').length
  eq('از دو درخواست هم‌زمان فقط یکی ساخته می‌شود', { fulfilled, rejected }, { fulfilled: 1, rejected: 1 })
  eq(
    'و فقط یک کمپین هم‌زمان در دیتابیس است',
    sql.prepare("SELECT COUNT(*) c FROM \"SmsCampaign\" WHERE body LIKE '%کمپین هم‌زمان%'").get().c,
    1
  )

  /** پیام رد شدن باید راه ادامه را بگوید — «پنهان‌کاری» نداریم. */
  let why = ''
  try {
    await smsCampaignService.create({ ...same, name: 'حراج تکراری سوم' })
  } catch (e) {
    why = String(e?.message ?? '')
  }
  truthy('پیام خطا می‌گوید چه شد و چطور دوباره تلاش کند', why.includes('چند لحظه'), why)
}

// ---------------------------------------------------------------------------
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
