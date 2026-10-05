/**
 * ===========================================================================
 * پنل پیامکی — منطق خالص (بدون دیتابیس، بدون شبکه).
 *
 * این سوییت همان چیزهایی را می‌سنجد که اگر غلط باشند، **پیام واقعی** به مشتری
 * می‌رود یا نرود: اعتبار شماره، جای‌گذاری متغیرها، شمردن بخش‌ها، فاصله‌ی تلاش
 * مجدد، و کلید جلوگیری از تکرار.
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-logic.mjs
 * ===========================================================================
 */
import {
  normalizeSmsPhone,
  isValidSmsPhone,
  smsSegments,
  smsEncoding,
  renderSmsTemplate,
  smsPlaceholdersOf,
  validateSmsBody,
  smsDedupeKey,
  smsPeriodKey,
  smsBackoffMs,
  SMS_RETRY_BACKOFF_MS,
  smsCostEstimate,
  parseSmsAuto,
  DEFAULT_SMS_AUTO,
  isSmsAutoDue,
  smsNeedsOptOutNote,
  isSmsCancelable,
  isSmsRequeueable,
  SmsOutboxStatus,
  normalizeSmsProviderKey,
  smsProviderNeedsCredentials
} from '@shared/sms'

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

console.log('\n۱) یکسان‌سازی شماره')
{
  eq('شماره‌ی ساده', normalizeSmsPhone('09121234567'), '09121234567')
  eq('با صفر فارسی', normalizeSmsPhone('۰۹۱۲۱۲۳۴۵۶۷'), '09121234567')
  eq('با +۹۸', normalizeSmsPhone('+989121234567'), '09121234567')
  eq('با ۰۰۹۸', normalizeSmsPhone('00989121234567'), '09121234567')
  eq('با ۹۸ بدون صفر', normalizeSmsPhone('989121234567'), '09121234567')
  eq('با فاصله و خط تیره', normalizeSmsPhone('0912-123 4567'), '09121234567')
  eq('تلفن ثابت رد می‌شود', normalizeSmsPhone('02112345678'), '')
  eq('شماره‌ی ناقص رد می‌شود', normalizeSmsPhone('0912123456'), '')
  eq('خالی', normalizeSmsPhone(''), '')
  eq('null', normalizeSmsPhone(null), '')
  eq('حروف', normalizeSmsPhone('سلام'), '')
  eq('اعتبار', isValidSmsPhone('09121234567'), true)
  eq('عدم اعتبار', isValidSmsPhone('123'), false)
}

console.log('\n۲) بخش‌های پیام (هزینه)')
{
  eq('انگلیسی کوتاه = GSM7', smsEncoding('Hello'), 'GSM7')
  eq('فارسی = UCS2', smsEncoding('سلام'), 'UCS2')
  eq('انگلیسی ۱۶۰ نویسه = یک بخش', smsSegments('a'.repeat(160)), 1)
  eq('انگلیسی ۱۶۱ نویسه = دو بخش', smsSegments('a'.repeat(161)), 2)
  eq('فارسی ۷۰ نویسه = یک بخش', smsSegments('س'.repeat(70)), 1)
  eq('فارسی ۷۱ نویسه = دو بخش', smsSegments('س'.repeat(71)), 2)
  eq('فارسی ۱۳۴ نویسه = دو بخش', smsSegments('س'.repeat(134)), 2)
  eq('فارسی ۱۳۵ نویسه = سه بخش', smsSegments('س'.repeat(135)), 3)
  eq('خالی = صفر بخش', smsSegments(''), 0)
  eq('برآورد هزینه', smsCostEstimate(2, 100, 1500), { messages: 200, toman: 300000 })
  eq('برآورد با قیمت صفر (تعیین‌نشده)', smsCostEstimate(1, 50, 0), { messages: 50, toman: 0 })
}

console.log('\n۳) موتور متن و متغیرها')
{
  const r = renderSmsTemplate('{customer_name} عزیز، کد {credit_code}', {
    customer_name: 'آقای محمدی',
    credit_code: 'AR7K'
  })
  eq('جای‌گذاری درست', r.text, 'آقای محمدی عزیز، کد AR7K')
  eq('بدون متغیر جاافتاده', r.missing, [])
  eq('بدون متغیر ناشناس', r.unknown, [])

  const miss = renderSmsTemplate('{customer_name} · {credit_code}', { customer_name: 'علی' })
  eq('متغیر بی‌مقدار گزارش می‌شود', miss.missing, ['credit_code'])
  eq('متغیر بی‌مقدار خالی می‌شود', miss.text, 'علی ·')

  const unk = renderSmsTemplate('{foo} {customer_name}', { customer_name: 'علی' })
  eq('متغیر ناشناخته دست‌نخورده می‌ماند', unk.text, '{foo} علی')
  eq('متغیر ناشناخته گزارش می‌شود', unk.unknown, ['foo'])

  eq('فهرست متغیرهای یک متن', smsPlaceholdersOf('{a} {b} {a}'), ['a', 'b'])
  // کاربر فارسی‌زبان به‌راحتی `{نام_مشتری}` می‌نویسد؛ این باید *ناشناخته*
  // شمرده شود تا ذخیره رد شود، نه این‌که عیناً با آکولاد برای مشتری برود.
  eq('متغیر با حروف فارسی هم شناسایی می‌شود', smsPlaceholdersOf('سلام {نام_مشتری}'), ['نام_مشتری'])
  eq('قالب با متغیر فارسی معتبر نیست', validateSmsBody('سلام {نام_مشتری}').ok, false)
  eq('رندر، متغیر فارسی را دست‌نخورده و ناشناخته گزارش می‌کند', renderSmsTemplate('سلام {نام_مشتری}', {}).text, 'سلام {نام_مشتری}')
  // متن عادی داخل آکولاد (با فاصله) متغیر نیست و نباید رد شود
  eq('آکولاد با فاصله متغیر نیست', smsPlaceholdersOf('کد {تخفیف ویژه} فعال است'), [])
  eq('آکولاد با فاصله معتبر است', validateSmsBody('کد {تخفیف ویژه} فعال است').ok, true)
  eq('آکولاد خالی متغیر نیست', smsPlaceholdersOf('{}'), [])
  eq('اعتبارسنجی قالب درست', validateSmsBody('سلام {customer_name}').ok, true)
  eq('اعتبارسنجی قالب ناشناس', validateSmsBody('سلام {nope}').ok, false)
  eq('اعتبارسنجی متن خالی', validateSmsBody('   ').ok, false)
}

console.log('\n۴) کلید جلوگیری از تکرار')
{
  const k1 = smsDedupeKey({
    eventType: 'SALE_THANK_YOU',
    entityType: 'SaleInvoice',
    entityId: 12,
    templateCode: 'SALE_THANK_YOU',
    phone: '09121234567'
  })
  eq('کلید شامل همه‌ی قطعه‌ها', k1, 'SALE_THANK_YOU:SaleInvoice:12:SALE_THANK_YOU:09121234567')

  const k2 = smsDedupeKey({
    eventType: 'CREDIT_REMINDER',
    entityType: 'StoreCredit',
    entityId: 5,
    templateCode: 'UNUSED',
    phone: '09121234567',
    period: smsPeriodKey('1405/07/15')
  })
  eq('دوره‌ی شمسی در کلید', k2, 'CREDIT_REMINDER:StoreCredit:5:UNUSED:09121234567:1405-07')

  eq('دوره از تاریخ شمسی', smsPeriodKey('1405/07/15'), '1405-07')
  eq('دوره با رقم فارسی', smsPeriodKey('۱۴۰۵/۰۷/۱۵'), '1405-07')
  eq('دوره‌ی نامعتبر', smsPeriodKey(''), '')

  const a = smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: 'x-1', phone: '0912' })
  const b = smsDedupeKey({ eventType: 'MANUAL', entityType: 'Manual', entityId: 'x-2', phone: '0912' })
  eq('کلید دستی همیشه غیرخالی است', a.length > 0 && b.length > 0, true)
  eq('دو ارسال دستی جدا، دو کلید جدا', a === b, false)
  eq('جداکننده در قطعه‌ها پاک می‌شود', smsDedupeKey({ eventType: 'A:B', entityId: 1 }), 'A-B:-:1:-:-')
}

console.log('\n۵) سیاست تلاش مجدد')
{
  eq('اولین تلاش فوری', smsBackoffMs(0), 0)
  eq('دوم: ۱ دقیقه', smsBackoffMs(1), 60_000)
  eq('سوم: ۵ دقیقه', smsBackoffMs(2), 5 * 60_000)
  eq('چهارم: ۱۵ دقیقه', smsBackoffMs(3), 15 * 60_000)
  eq('پنجم: ۱ ساعت', smsBackoffMs(4), 60 * 60_000)
  eq('بیشتر از سقف: همان ۱ ساعت', smsBackoffMs(99), SMS_RETRY_BACKOFF_MS[4])
  eq('ورودی خراب: فوری', smsBackoffMs(-3), 0)
}

console.log('\n۶) وضعیت‌ها')
{
  eq('در صف قابل لغو است', isSmsCancelable(SmsOutboxStatus.PENDING), true)
  eq('ناموفق‌موقت قابل لغو است', isSmsCancelable(SmsOutboxStatus.FAILED_RETRYABLE), true)
  eq('ارسال‌شده قابل لغو نیست', isSmsCancelable(SmsOutboxStatus.SENT), false)
  eq('در حال ارسال قابل لغو نیست', isSmsCancelable(SmsOutboxStatus.PROCESSING), false)
  eq('لغوشده به صف برمی‌گردد', isSmsRequeueable(SmsOutboxStatus.CANCELED), true)
  eq('ناموفق‌قطعی به صف برمی‌گردد', isSmsRequeueable(SmsOutboxStatus.FAILED_FINAL), true)
  eq('ارسال‌شده برنمی‌گردد', isSmsRequeueable(SmsOutboxStatus.SENT), false)
  eq('نتیجه‌ی نامعلوم خودکار تکرار نمی‌شود', isSmsCancelable(SmsOutboxStatus.UNKNOWN), false)
}

console.log('\n۷) سرویس‌دهنده')
{
  eq('کلید نامعتبر ⇒ آزمایشی', normalizeSmsProviderKey('چیزی'), 'LOG_ONLY')
  eq('کلید معتبر', normalizeSmsProviderKey('kavenegar'), 'KAVENEGAR')
  eq('آزمایشی کلید نمی‌خواهد', smsProviderNeedsCredentials('LOG_ONLY'), false)
  eq('sms.ir کلید می‌خواهد', smsProviderNeedsCredentials('SMS_IR'), true)
}

console.log('\n۸) تنظیمات خودکار')
{
  eq('پیش‌فرض خاموش است', parseSmsAuto(null).enabled, false)
  eq('پیش‌فرض ساعت', parseSmsAuto(null).hour, DEFAULT_SMS_AUTO.hour)
  eq('رشته‌ی خراب ⇒ پیش‌فرض', parseSmsAuto('{{{').hour, DEFAULT_SMS_AUTO.hour)
  eq('پارس رشته‌ی درست', parseSmsAuto('{"enabled":true,"hour":14,"minute":30}').hour, 14)
  eq('ساعت بیرون بازه اصلاح می‌شود', parseSmsAuto({ hour: 99 }).hour, 23)
  eq('دقیقه بیرون بازه اصلاح می‌شود', parseSmsAuto({ minute: -5 }).minute, 0)

  const at = new Date()
  at.setHours(10, 2, 0, 0)
  eq('در پنجره‌ی ساعت اجرا می‌شود', isSmsAutoDue({ enabled: true, hour: 10, minute: 0, askOnEnable: true }, at), true)
  /**
   * ⏱ جبران عقب‌افتادگی: ۱۱:۳۰ همان روز **هنوز** داخل بازه‌ی مجاز است.
   *
   * چرا عوض شد: با پنجره‌ی ۵ دقیقه‌ای، اگر برنامه سر ساعت باز نبود (یا یک دور
   * با خطای دیتابیس رد می‌شد) کل آن روز یادآوری‌ها گم می‌شدند — در حالی که
   * پیام «چند دقیقه دیگر دوباره تلاش می‌شود» به کاربر نشان داده می‌شد.
   * «یک بار در روز» را کلید `sms.auto.lastRun` تضمین می‌کند، پس این بازه
   * پیام تکراری نمی‌سازد.
   */
  at.setHours(11, 30, 0, 0)
  eq('۹۰ دقیقه بعد هم اجرا می‌شود (جبران)', isSmsAutoDue({ enabled: true, hour: 10, minute: 0, askOnEnable: true }, at), true)
  at.setHours(11, 30, 0, 0)
  eq('ولی سقف دارد: چهار ساعت بعد نه', isSmsAutoDue({ enabled: true, hour: 10, minute: 0, askOnEnable: true }, new Date(at.getTime() + 150 * 60_000)), false)
  at.setHours(9, 55, 0, 0)
  eq('و پیش از ساعت مقرر اجرا نمی‌شود', isSmsAutoDue({ enabled: true, hour: 10, minute: 0, askOnEnable: true }, at), false)
  at.setHours(10, 2, 0, 0)
  eq('خاموش ⇒ هرگز', isSmsAutoDue({ enabled: false, hour: 10, minute: 0, askOnEnable: true }, at), false)
}

console.log('\n۹) جمله‌ی لغو تبلیغات')
{
  eq('کمپین جمله‌ی لغو می‌گیرد', smsNeedsOptOutNote('CAMPAIGN'), true)
  eq('یادآوری اعتبار نمی‌گیرد', smsNeedsOptOutNote('CREDIT_REMINDER'), false)
  eq('تشکر از خرید نمی‌گیرد', smsNeedsOptOutNote('SALE_THANK_YOU'), false)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
