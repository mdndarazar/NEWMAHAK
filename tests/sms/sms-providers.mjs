/**
 * ===========================================================================
 * آداپتورهای سرویس‌دهنده — با «fetch جعلی»، بدون هیچ تماس واقعی.
 *
 * چرا fetch را خودمان جعل می‌کنیم: هارنس هیچ لایه‌ی شبکه‌ای ندارد و نباید هم
 * داشته باشد. این‌جا دقیقاً همان چیزی سنجیده می‌شود که به سرویس‌دهنده می‌رود
 * (آدرس، متد، هدر، بدنه) و آنچه از پاسخش برمی‌گردد (پذیرش/تلاش مجدد/نامعلوم).
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-providers.mjs
 * ===========================================================================
 */
const calls = []
let nextResponse = null
let nextError = null

/** جعل `fetch` — هر فراخوانی ثبت می‌شود تا بتوان ادعای دقیق کرد. */
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init })
  if (nextError) {
    const e = nextError
    nextError = null
    throw e
  }
  const r = typeof nextResponse === 'function' ? nextResponse(String(url), init) : (nextResponse ?? {})
  return {
    ok: r.ok !== false,
    status: r.status ?? 200,
    text: async () => (r.raw != null ? String(r.raw) : JSON.stringify(r.body ?? {}))
  }
}

const { smsIrProvider, kavenegarProvider, logOnlyProvider, getSmsProvider, listSmsProviders } = await import(
  '../../src/main/services/sms/providers.ts'
)

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
const lastCall = () => calls[calls.length - 1]

const irCfg = { secrets: { apiKey: 'IR-KEY-1' }, senderNumber: '30005006007000', patternId: null }
const kavCfg = { secrets: { apiKey: 'KAV-KEY-1' }, senderNumber: '10004346', patternId: null }

// ---------------------------------------------------------------------------
console.log('\n۱) sms.ir — ارسال متن کامل')
{
  calls.length = 0
  nextResponse = { ok: true, status: 200, body: { status: 1, message: 'موفق', data: { batchId: 991 } } }
  const res = await smsIrProvider.send(irCfg, { phone: '09121234567', text: 'سلام از فروشگاه' })

  const c = lastCall()
  eq('آدرس درست است', c.url, 'https://api.sms.ir/v1/send/bulk')
  eq('متد POST است', c.init.method, 'POST')
  eq('کلید در هدر x-api-key می‌رود', c.init.headers['x-api-key'], 'IR-KEY-1')
  const body = JSON.parse(String(c.init.body))
  eq('شماره‌ی خط عددی فرستاده می‌شود', body.lineNumber, 30005006007000)
  eq('متن پیام می‌رود', body.messageText, 'سلام از فروشگاه')
  eq('موبایل در آرایه است', body.mobiles, ['09121234567'])
  eq('زمان‌بندی پیش‌فرض null است', body.sendDateTime, null)
  eq('پذیرفته شد', res.accepted, true)
  eq('شناسه‌ی سرویس‌دهنده ثبت شد', res.providerMessageId, '991')
  eq('تلاش مجدد لازم نیست', res.retryable, false)
  eq('یک تماس، نه بیشتر', calls.length, 1)
}

// ---------------------------------------------------------------------------
console.log('\n۲) sms.ir — ارسال الگویی (وقتی «شناسه پترن» و متغیرها هست)')
{
  calls.length = 0
  nextResponse = { ok: true, status: 200, body: { status: 1, message: 'موفق', data: { packetId: 77 } } }
  const res = await smsIrProvider.send(
    { ...irCfg, patternId: '123456' },
    {
      phone: '09121234567',
      text: 'متن کامل که نباید برود',
      patternId: '123456',
      variables: { 'نام مشتری': 'آقای محمدی', مبلغ: '۵۰۰۰۰۰' }
    }
  )

  const c = lastCall()
  eq('آدرس الگو', c.url, 'https://api.sms.ir/v1/send/verify')
  const body = JSON.parse(String(c.init.body))
  eq('موبایل', body.mobile, '09121234567')
  eq('شناسه‌ی پترن عددی می‌شود', body.templateId, 123456)
  eq('پارامترها هم‌نام قالب می‌روند', body.parameters, [
    { name: 'نام مشتری', value: 'آقای محمدی' },
    { name: 'مبلغ', value: '۵۰۰۰۰۰' }
  ])
  truthy('متن کامل جای پارامتر نمی‌رود', !JSON.stringify(body).includes('نباید برود'))
  eq('شناسه از packetId خوانده شد', res.providerMessageId, '77')
  truthy('توضیح «الگویی» است', res.detail.includes('الگویی'), res.detail)
}

// ---------------------------------------------------------------------------
console.log('\n۳) sms.ir — بدون متغیر، حتی با پترن، متن کامل می‌رود (نه الگوی ناقص)')
{
  calls.length = 0
  nextResponse = { ok: true, status: 200, body: { status: 1, data: {} } }
  await smsIrProvider.send({ ...irCfg, patternId: '999' }, { phone: '09120000000', text: 'متن', patternId: '999', variables: null })
  eq('آدرس متن‌کامل', lastCall().url, 'https://api.sms.ir/v1/send/bulk')
}

// ---------------------------------------------------------------------------
console.log('\n۴) sms.ir — طبقه‌بندی خطاها')
{
  calls.length = 0
  nextResponse = { ok: false, status: 401, body: { status: 0, message: 'unauthorized' } }
  let res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('کلید غلط ⇒ قطعی', res.retryable, false)
  eq('کد خطای روشن', res.errorCode, 'PROVIDER_AUTH')
  truthy('راهنمای رفع دارد', res.detail.includes('کلید API'), res.detail)

  /**
   * 🔴 بازبینی ششم (SMS-R6-02): ۵۰۰/۵۰۲/۵۰۴ «نامعلوم»اند، نه «تلاش مجدد».
   *
   * این کدها یعنی درخواست به سرورِ میانی/سرویس‌دهنده رسیده و ممکن است پذیرفته
   * شده باشد؛ تلاش خودکار برای همان ردیف = پیام دوم به همان مشتری. پس صف باید
   * `UNKNOWN` بزند (بدون ارسال دوباره). فقط ۵۰۳ و ۴۲۹ موقتی می‌مانند.
   */
  for (const code of [500, 502, 504]) {
    nextResponse = { ok: false, status: code, body: null, raw: '<html>gateway</html>' }
    res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
    eq(`HTTP ${code} ⇒ نامعلوم (نه ارسال دوباره)`, res.unknown, true)
    eq(`HTTP ${code} ⇒ تلاش خودکار ندارد`, res.retryable, false)
    eq(`HTTP ${code}: متن غیر-JSON هم صف را نمی‌شکند`, res.errorCode, 'PROVIDER_HTTP')
    truthy(`HTTP ${code}: به کاربر توضیح داده می‌شود`, res.detail.includes('نامعلوم'), res.detail)
  }

  nextResponse = { ok: false, status: 503, body: null, raw: 'maintenance' }
  res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('۵۰۳ (سرویس در دسترس نیست) ⇒ تلاش مجدد', res.retryable, true)
  truthy('۵۰۳ نامعلوم نیست', !res.unknown)

  nextResponse = { ok: false, status: 429, body: null, raw: 'slow down' }
  res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('۴۲۹ ⇒ تلاش مجدد', res.retryable, true)

  /**
   * 🔴 طبق جدول رسمی `sms.ir/rest-api`، کد «اعتبار کافی نمیباشد» **۱۰۲** است.
   * اگر قطعی حساب شود، بعد از شارژ هم پیام خودکار نمی‌رود (بازبینی پنجم).
   */
  nextResponse = { ok: true, status: 200, body: { status: 102, message: 'اعتبار کافی نمیباشد' } }
  res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('کمبود اعتبار (۱۰۲) ⇒ تلاش مجدد (بعد از شارژ ادامه می‌دهد)', res.retryable, true)
  eq('کد وضعیت سرویس‌دهنده', res.errorCode, 'SMS_IR_102')
  truthy('به کاربر گفته می‌شود چرا', res.detail.includes('شارژ'), res.detail)

  nextResponse = { ok: true, status: 200, body: { status: 12, message: 'داده نامعتبر' } }
  res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('رد منطقی دیگر ⇒ قطعی (تکرار بی‌فایده)', res.retryable, false)
  eq('کد وضعیت سرویس‌دهنده', res.errorCode, 'SMS_IR_12')
  truthy('پیام خودِ سرویس‌دهنده به کاربر می‌رسد', res.detail.includes('داده نامعتبر'), res.detail)

  nextResponse = { ok: false, status: 402, body: null, raw: 'payment required' }
  res = await smsIrProvider.send(irCfg, { phone: '09120000001', text: 'x' })
  eq('HTTP 402 ⇒ تلاش مجدد (شارژ کن و دوباره بفرست)', res.retryable, true)
}

// ---------------------------------------------------------------------------
console.log('\n۵) تنظیم ناقص ⇒ هیچ تماس شبکه‌ای')
{
  calls.length = 0
  const res = await smsIrProvider.send({}, { phone: '09120000002', text: 'x' })
  eq('هیچ درخواستی نرفت', calls.length, 0)
  eq('قطعیت (نه تلاش مجدد)', res.retryable, false)
  eq('کد', res.errorCode, 'PROVIDER_NOT_CONFIGURED')
  truthy('نام چیزهای ناقص', res.detail.includes('کلید API') && res.detail.includes('سرشماره'), res.detail)
  truthy('راه بازگشت به صف گفته می‌شود', res.detail.includes('برگرداندن به صف'), res.detail)

  eq('پیش‌نیازهای sms.ir', smsIrProvider.missingRequirements({}), ['کلید API', 'سرشماره (lineNumber)'])
  eq('پیش‌نیازهای کاوه‌نگار', kavenegarProvider.missingRequirements({ secrets: { apiKey: 'k' } }), [
    'سرشماره (sender)'
  ])
}

// ---------------------------------------------------------------------------
console.log('\n۶) کاوه‌نگار — ارسال متن کامل')
{
  calls.length = 0
  nextResponse = {
    ok: true,
    status: 200,
    body: {
      return: { status: 200, message: 'تایید شد' },
      entries: [{ messageid: 8792343, status: 1, statustext: 'در صف ارسال', sender: '10004346', receptor: '09121234567' }]
    }
  }
  const res = await kavenegarProvider.send(kavCfg, { phone: '09121234567', text: 'پیام تست' })

  const c = lastCall()
  const u = new URL(c.url)
  eq('مسیر با کلید API', u.pathname, '/v1/KAV-KEY-1/sms/send.json')
  eq('گیرنده', u.searchParams.get('receptor'), '09121234567')
  eq('متن', u.searchParams.get('message'), 'پیام تست')
  eq('سرشماره', u.searchParams.get('sender'), '10004346')
  eq('پذیرفته شد', res.accepted, true)
  eq('شناسه‌ی پیام', res.providerMessageId, '8792343')
  eq('تلاش مجدد لازم نیست', res.retryable, false)
}

// ---------------------------------------------------------------------------
console.log('\n۷) کاوه‌نگار — ارسال الگویی (token/token2/token3)')
{
  calls.length = 0
  nextResponse = {
    ok: true,
    status: 200,
    body: { return: { status: 200, message: 'تایید شد' }, entries: { messageid: 5 } }
  }
  const res = await kavenegarProvider.send(kavCfg, {
    phone: '09361234567',
    text: 'متن کامل',
    patternId: 'credit-reminder',
    variables: { code: '852596', store: 'ارکاجین' }
  })

  const u = new URL(lastCall().url)
  eq('مسیر الگو', u.pathname, '/v1/KAV-KEY-1/verify/lookup.json')
  eq('نام الگو', u.searchParams.get('template'), 'credit-reminder')
  eq('پارامتر اول ⇒ token', u.searchParams.get('token'), '852596')
  eq('پارامتر دوم ⇒ token2', u.searchParams.get('token2'), 'ارکاجین')
  eq('پارامتر سوم خالی نمی‌رود', u.searchParams.get('token3'), null)
  eq('پذیرفته شد', res.accepted, true)
  eq('شناسه از entries تکی خوانده شد', res.providerMessageId, '5')
}

// ---------------------------------------------------------------------------
console.log('\n۸) کاوه‌نگار — خطاها با HTTP 200 می‌آیند؛ مرجع return.status است')
{
  nextResponse = {
    ok: true,
    status: 200,
    body: { return: { status: 424, message: 'الگوی مورد نظر پیدا نشد یا هنوز تائید نشده' }, entries: null }
  }
  let res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x', patternId: 'p', variables: { a: '1' } })
  eq('الگوی تأییدنشده ⇒ قطعی', res.retryable, false)
  eq('کد خطا', res.errorCode, 'SMS_PROVIDER_REJECTED')
  truthy('پیام خودِ سرویس‌دهنده', res.detail.includes('الگوی مورد نظر'), res.detail)

  /**
   * 🔴 کد «اعتبار کافی نیست» طبق مستندات رسمی کاوه‌نگار **۴۱۸** است، نه ۴۰۲.
   * اگر ۴۱۸ قطعی حساب شود، پیام‌ها بعد از شارژ حساب هم خودکار نمی‌روند
   * (بازبینی پنجم + `kavenegar.com/rest.html`).
   */
  nextResponse = { ok: true, status: 200, body: { return: { status: 418, message: 'اعتبار شما کافی نمی‌باشد' }, entries: null } }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x' })
  eq('کمبود اعتبار (۴۱۸) ⇒ تلاش مجدد (بعد از شارژ ادامه می‌دهد)', res.retryable, true)
  truthy('به کاربر گفته می‌شود چرا', res.detail.includes('شارژ'), res.detail)
  eq('و به‌عنوان خطای موقت علامت می‌خورد', res.errorCode, 'SMS_PROVIDER_TEMP')

  // ۴۰۹ = «سرور قادر به پاسخگوئی نیست، بعداً تلاش کنید» ⇒ موقتی
  nextResponse = { ok: true, status: 200, body: { return: { status: 409, message: 'سرور قادر به پاسخگوئی نیست' }, entries: null } }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x' })
  eq('۴۰۹ ⇒ موقتی', res.retryable, true)

  // ۴۰۲ معنای مستندش «عملیات ناموفق بود» است؛ محتاطانه موقتی می‌ماند (تأخیر، نه گم‌شدن)
  nextResponse = { ok: true, status: 200, body: { return: { status: 402, message: 'عملیات ناموفق بود' }, entries: null } }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x' })
  eq('۴۰۲ ⇒ موقتی (تأخیر مجاز، گم‌شدن هرگز)', res.retryable, true)

  nextResponse = { ok: true, status: 200, body: { return: { status: 401, message: 'کلید اشتباه' }, entries: null } }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x' })
  eq('کلید غلط ⇒ قطعی', res.retryable, false)
  eq('کد', res.errorCode, 'SMS_PROVIDER_AUTH')

  nextResponse = { ok: true, status: 200, body: { return: { status: 411, message: 'شماره گیرنده اشتباه است' }, entries: null } }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000003', text: 'x' })
  eq('شماره‌ی نامعتبر ⇒ قطعی', res.retryable, false)
  truthy('دلیل نمایش داده می‌شود', res.detail.includes('شماره گیرنده'), res.detail)
}

// ---------------------------------------------------------------------------
console.log('\n۸-۲) کاوه‌نگار — وقتی همان کد در HTTP هم برمی‌گردد (بازبینی ششم)')
{
  /**
   * 🔴 SMS-R6-01: کاوه‌نگار برای خطای منطقی، بدنه‌ی JSON با `return.status` را
   * *همراه* کد HTTP هم‌ارز می‌فرستد. اگر مسیر فقط به کد HTTP نگاه کند، ۴۱۸/۴۰۹
   * «قطعی» می‌شوند و پیام بعد از شارژ حساب هم خودکار نمی‌رود.
   */
  for (const code of [418, 409, 402]) {
    nextResponse = {
      ok: false,
      status: code,
      body: { return: { status: code, message: 'x' }, entries: null }
    }
    const res = await kavenegarProvider.send(kavCfg, { phone: '09120000005', text: 'x' })
    eq(`HTTP ${code} + بدنه‌ی return.status ⇒ موقتی`, res.retryable, true)
    eq(`HTTP ${code}: از مرجع بدنه طبقه‌بندی می‌شود`, res.errorCode, 'SMS_PROVIDER_TEMP')
    truthy(`HTTP ${code}: نامعلوم نیست (پاسخ روشن سرویس‌دهنده)`, !res.unknown)
  }

  nextResponse = { ok: false, status: 401, body: { return: { status: 401, message: 'کلید اشتباه' }, entries: null } }
  let res = await kavenegarProvider.send(kavCfg, { phone: '09120000005', text: 'x' })
  eq('HTTP ۴۰۱ + بدنه ⇒ قطعی (کلید)', res.retryable, false)
  eq('و کد خطای احراز هویت', res.errorCode, 'SMS_PROVIDER_AUTH')

  nextResponse = { ok: false, status: 502, body: null, raw: '<html>bad gateway</html>' }
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000005', text: 'x' })
  eq('بدنه‌ی ناخوانا + ۵۰۲ ⇒ نامعلوم (پروکسی خراب است، نمی‌دانیم رفت یا نه)', res.unknown, true)
  eq('و تلاش خودکار ندارد', res.retryable, false)
  eq('کد خطا', res.errorCode, 'PROVIDER_HTTP')
}

// ---------------------------------------------------------------------------
console.log('\n۹) مهلت و شبکه — «تأخیر مجاز، گم‌شدن هرگز»')
{
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  nextError = abort
  let res = await smsIrProvider.send(irCfg, { phone: '09120000004', text: 'x' })
  eq('مهلت ⇒ نامعلوم (نه شکست قطعی)', res.unknown, true)
  eq('تلاش خودکار متوقف می‌شود که پیام دوم نرود', res.retryable, false)
  eq('کد', res.errorCode, 'PROVIDER_TIMEOUT')
  truthy('راهنمای تصمیم‌گیری دارد', res.detail.includes('نامعلوم'), res.detail)

  const dns = new TypeError('fetch failed')
  dns.cause = { code: 'ENOTFOUND' }
  nextError = dns
  res = await kavenegarProvider.send(kavCfg, { phone: '09120000004', text: 'x' })
  eq('DNS/اتصال نیامد ⇒ تلاش مجدد', res.retryable, true)
  truthy('نامعلوم نیست (چیزی نرفته)', !res.unknown)
  eq('کد', res.errorCode, 'PROVIDER_UNREACHABLE')

  const reset = new TypeError('fetch failed')
  reset.cause = { code: 'ECONNRESET' }
  nextError = reset
  res = await smsIrProvider.send(irCfg, { phone: '09120000004', text: 'x' })
  eq('قطع وسط راه ⇒ نامعلوم (ممکن است رسیده باشد)', res.unknown, true)
  eq('کد', res.errorCode, 'PROVIDER_NETWORK')
}

// ---------------------------------------------------------------------------
console.log('\n۱۰) تست واقعی اتصال (probe)')
{
  calls.length = 0
  nextResponse = { ok: true, status: 200, body: { status: 1, message: 'موفق', data: 250000 } }
  let p = await smsIrProvider.probe(irCfg)
  eq('sms.ir: مسیر اعتبار', lastCall().url, 'https://api.sms.ir/v1/credit')
  eq('sms.ir: موفق', p.ok, true)
  truthy('اعتبار گزارش می‌شود', p.detail.includes('250000'), p.detail)

  nextResponse = { ok: false, status: 401, body: null }
  p = await smsIrProvider.probe(irCfg)
  eq('sms.ir: کلید غلط', p.ok, false)
  truthy('دلیل', p.detail.includes('کلید API'), p.detail)

  calls.length = 0
  nextResponse = { ok: true, status: 200, body: { return: { status: 200, message: 'تایید شد' }, entries: { remaincredit: 12345 } } }
  p = await kavenegarProvider.probe(kavCfg)
  eq('کاوه‌نگار: مسیر اطلاعات حساب', new URL(lastCall().url).pathname, '/v1/KAV-KEY-1/account/info.json')
  eq('کاوه‌نگار: موفق', p.ok, true)
  truthy('اعتبار باقی‌مانده گزارش می‌شود', p.detail.includes('12345'), p.detail)

  p = await smsIrProvider.probe({})
  eq('بدون کلید، حتی سؤال هم پرسیده نمی‌شود', p.ok, false)
  truthy('و دلیلش گفته می‌شود', p.detail.includes('کلید API'), p.detail)

  nextError = new TypeError('fetch failed')
  nextError.cause = { code: 'ECONNREFUSED' }
  p = await kavenegarProvider.probe(kavCfg)
  eq('خطای شبکه probe را نمی‌شکند', p.ok, false)
  truthy('دلیل فارسی', p.detail.includes('ارتباط'), p.detail)
}

// ---------------------------------------------------------------------------
console.log('\n۱۱) رجیستری و وضعیت آداپتورها')
{
  eq('سه سرویس‌دهنده ثبت شده', listSmsProviders().length, 3)
  eq('sms.ir زنده است', smsIrProvider.live, true)
  eq('کاوه‌نگار زنده است', kavenegarProvider.live, true)
  eq('آزمایشی زنده نیست', logOnlyProvider.live, false)
  eq('کلید ناشناس ⇒ پیش‌فرض امن', getSmsProvider('چیز-عجیب').key, 'LOG_ONLY')
  eq('آزمایشی همیشه می‌پذیرد', (await logOnlyProvider.send({}, { phone: '0912', text: 'x' })).accepted, true)
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\n۱۲) پرچم «منتظرِ شرایط» — شکست‌هایی که نباید سهمیه‌ی تلاش را بسوزانند (بازبینی هفتم)')
{
  /**
   * 🔴 SMS-R7-01: صف سقف ۵ تلاش (≈۸۱ دقیقه) را روی همه‌ی شکست‌ها اعمال می‌کرد،
   * پس قطعی دو ساعته‌ی اینترنت یا تمام‌شدن اعتبار حساب، پیام را برای همیشه
   * `FAILED_FINAL` می‌کرد. حالا آداپتور با `waiting` می‌گوید «پیام نرفت، ولی
   * مشکل موقتیِ محیط است» تا صف بودجه را نسوزاند.
   *
   * ⚠️ `waiting` و `unknown` دو چیز جدا هستند: اولی «قطعاً نرفته»، دومی
   * «نمی‌دانیم رفت یا نه».
   */
  const waits = (label, r) => eq(label, r.waiting === true, true)

  // کاوه‌نگار: کدهای موقتیِ بدنه
  for (const [code, name] of [[418, 'کمبود اعتبار'], [409, 'سرور پاسخگو نیست'], [402, 'عملیات ناموفق']]) {
    nextResponse = { ok: true, status: 200, body: { return: { status: code, message: name }, entries: null } }
    waits(`کاوه‌نگار ${code} (${name}) ⇒ منتظرِ شرایط`, await kavenegarProvider.send(kavCfg, { phone: '09120000006', text: 'x' }))
  }
  nextResponse = { ok: true, status: 200, body: { return: { status: 424, message: 'الگو تائید نشده' }, entries: null } }
  let r7 = await kavenegarProvider.send(kavCfg, { phone: '09120000006', text: 'x', patternId: 'p' })
  eq('الگوی تأییدنشده (۴۲۴) ⇒ قطعی، نه منتظر', r7.waiting === true, false)
  eq('و نامعلوم هم نیست', r7.unknown === true, false)

  // کاوه‌نگار: همان کد در HTTP هم (بازبینی ششم + هفتم)
  nextResponse = { ok: false, status: 418, body: { return: { status: 418, message: 'x' }, entries: null } }
  waits('کاوه‌نگار HTTP 418 + بدنه ⇒ منتظرِ شرایط', await kavenegarProvider.send(kavCfg, { phone: '09120000006', text: 'x' }))

  // sms.ir: کد وضعیت ۱۰۲ و کدهای HTTP موقتی
  nextResponse = { ok: true, status: 200, body: { status: 102, message: 'اعتبار کافی نمیباشد' } }
  waits('sms.ir کد ۱۰۲ (کمبود اعتبار) ⇒ منتظرِ شرایط', await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' }))

  for (const code of [402, 408, 429, 503]) {
    nextResponse = { ok: false, status: code, body: null, raw: 'x' }
    waits(`sms.ir HTTP ${code} ⇒ منتظرِ شرایط`, await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' }))
  }

  // ۵xx مبهم: نامعلوم است، پس «منتظر» نیست (تلاش خودکار ممنوع)
  for (const code of [500, 502, 504]) {
    nextResponse = { ok: false, status: code, body: null, raw: '<html>' }
    r7 = await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' })
    eq(`HTTP ${code} ⇒ نامعلوم، نه «منتظر»`, [r7.unknown === true, r7.waiting === true], [true, false])
  }

  // خطای قطعی: نه منتظر، نه نامعلوم
  nextResponse = { ok: true, status: 200, body: { status: 12, message: 'داده نامعتبر' } }
  r7 = await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' })
  eq('خطای قطعیِ بدنه ⇒ نه منتظر، نه نامعلوم', [r7.waiting === true, r7.unknown === true], [false, false])

  // شبکه: قطعی اینترنت «قطعاً نرفته» است ⇒ منتظرِ شرایط
  for (const code of ['ENOTFOUND', 'ECONNREFUSED']) {
    const e = new TypeError('fetch failed')
    e.cause = { code }
    nextError = e
    waits(`شبکه ${code} ⇒ منتظرِ شرایط`, await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' }))
  }

  // مهلت: «نمی‌دانیم» ⇒ منتظر نیست (خطر پیام دوم)
  const abort7 = new Error('aborted')
  abort7.name = 'AbortError'
  nextError = abort7
  r7 = await smsIrProvider.send(irCfg, { phone: '09120000006', text: 'x' })
  eq('مهلت ⇒ نامعلوم است، «منتظر» نیست', [r7.unknown === true, r7.waiting === true], [true, false])
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
