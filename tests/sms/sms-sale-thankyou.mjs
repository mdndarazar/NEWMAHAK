/**
 * ===========================================================================
 * «تشکر از خرید» — قلابِ بعد از فاکتور، بیرون از تراکنش فروش.
 *
 * سنجیده می‌شود:
 *   • خاموش‌بودن کلید سراسری ⇒ هیچ پیامی ساخته نمی‌شود (و پیام‌ها در صف نمی‌مانند)
 *   • تکی و عمده هر کدام قالب خودشان را می‌گیرند (خواسته‌ی صریح کاربر)
 *   • بدون شماره تلفن ⇒ هیچ پیامی
 *   • سند تعویض ⇒ هیچ پیامی (خرید نیست)
 *   • دو بار صدا زدن روی یک فاکتور ⇒ **یک** پیام (کلید یکتا)
 *   • ورودی خراب ⇒ نه throw، نه ردیف ناقص
 *   • و مهم‌تر از همه: هیچ نوشتنی در جدول‌های فروش انجام نمی‌شود
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-sale-thankyou.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sms-thanks-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { notifySaleCreated, thankYouEnabled } = await import('../../src/main/services/sms/SmsSaleNotify.ts')
const { smsService } = await import('../../src/main/services/sms/SmsService.ts')
const { smsTemplateService } = await import('../../src/main/services/sms/SmsTemplates.ts')
const { OrderType } = await import('@shared/enums')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('فروشنده تست')

/** همان کاری که `smsService.start()` در بوت برنامه می‌کند. */
await smsTemplateService.ensureDefaults()

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

const outbox = () => sql.prepare('SELECT * FROM "SmsOutbox" ORDER BY id').all()
const invoiceCount = () => sql.prepare('SELECT COUNT(*) AS n FROM "SaleInvoice"').get().n

/** یک فاکتور با مشتریِ دارای شماره. */
function makeInvoice({ orderType = OrderType.INTERNAL, phone = '09123456789', name = 'آقای رضایی', total = 5_000_000, paid = 5_000_000 } = {}) {
  const customerId = phone ? seed.customer(name, phone) : null
  const inv = seed.invoice({ grandTotal: total, customerId })
  sql
    .prepare('UPDATE "SaleInvoice" SET orderType = ?, paidTotal = ?, issuedAtJalali = ? WHERE id = ?')
    .run(orderType, paid, '1405/07/11', inv.id)
  return seed.one('SELECT * FROM "SaleInvoice" WHERE id = ?', inv.id)
}

console.log('\n۱) پیش‌فرض: خاموش')
{
  const inv = makeInvoice()
  eq('کلید سراسری پیش‌فرض خاموش است', await thankYouEnabled(), false)
  const res = await notifySaleCreated({ invoiceId: inv.id, orderType: inv.orderType, userId })
  eq('هیچ پیامی ساخته نشد', res.queued, false)
  truthy('دلیل فارسی گفته شد', res.detail.includes('خاموش'), res.detail)
  eq('صف خالی ماند', outbox().length, 0)
}

console.log('\n۲) روشن: فروش تکی')
{
  await smsService.saveSettings({ thankYou: true }, userId)
  eq('کلید روشن شد', await thankYouEnabled(), true)

  const inv = makeInvoice({ total: 5_000_000, paid: 5_000_000, name: 'آقای رضایی' })
  const res = await notifySaleCreated({ invoiceId: inv.id, orderType: inv.orderType, userId })
  truthy('پیام در صف نشست', res.queued, res.detail)

  const row = outbox().at(-1)
  eq('نوع رویداد', row.eventType, 'SALE_THANK_YOU')
  eq('شماره‌ی مقصد', row.phoneSnapshot, '09123456789')
  eq('وضعیت اولیه', row.status, 'PENDING')
  eq('به فاکتور گره خورد', [row.relatedEntity, row.relatedEntityId], ['SaleInvoice', inv.id])
  truthy('نام مشتری در متن نشست', row.bodySnapshot.includes('آقای رضایی'), row.bodySnapshot)
  truthy('مبلغ فاکتور در متن نشست', row.bodySnapshot.includes('۵٬۰۰۰٬۰۰۰'), row.bodySnapshot)
  truthy('آکولادی در متن نمانده', !/[{}]/.test(row.bodySnapshot), row.bodySnapshot)

  const again = await notifySaleCreated({ invoiceId: inv.id, orderType: inv.orderType, userId })
  eq('بار دوم پیام دوم ساخته نمی‌شود', again.queued, false)
  truthy('و دلیلش «تکراری» است', again.detail.includes('قبلاً'), again.detail)
  eq('صف همچنان یک پیام دارد', outbox().length, 1)
}

console.log('\n۳) فروش عمده: قالب جداگانه')
{
  const inv = makeInvoice({ orderType: OrderType.WHOLESALE, total: 20_000_000, paid: 12_000_000, name: 'شرکت پارس' })
  const res = await notifySaleCreated({ invoiceId: inv.id, orderType: inv.orderType, userId })
  eq('پیام عمده در صف نشست', res.queued, true)
  const row = outbox().at(-1)
  eq('نوع رویداد عمده', row.eventType, 'SALE_THANK_YOU_WHOLESALE')
  truthy('نام شرکت در متن نشست', row.bodySnapshot.includes('شرکت پارس'), row.bodySnapshot)
  truthy('مانده‌ی نسیه در متن نشست (۸٬۰۰۰٬۰۰۰)', row.bodySnapshot.includes('۸٬۰۰۰٬۰۰۰'), row.bodySnapshot)
  const retail = outbox().filter((r) => r.eventType === 'SALE_THANK_YOU').length
  eq('قالب تکی و عمده قاطی نشدند', [retail, outbox().length], [1, 2])
}

console.log('\n۴) مواردی که نباید پیام بگیرند')
{
  const n0 = outbox().length
  const noPhone = makeInvoice({ phone: null })
  const r1 = await notifySaleCreated({ invoiceId: noPhone.id, userId })
  truthy('بدون شماره ⇒ پیام نمی‌سازد', !r1.queued && r1.detail.includes('شماره'), r1.detail)

  const exchange = makeInvoice({ orderType: OrderType.EXCHANGE })
  const r2 = await notifySaleCreated({ invoiceId: exchange.id, userId })
  truthy('سند تعویض ⇒ پیام نمی‌سازد', !r2.queued && r2.detail.includes('تعویض'), r2.detail)

  const missing = await notifySaleCreated({ invoiceId: 999999, userId })
  truthy('فاکتور ناموجود ⇒ پیام نمی‌سازد', !missing.queued, missing.detail)

  // قالب خاموش ⇒ هیچ پیامی (کاربر می‌تواند فقط «عمده» را خاموش کند)
  await smsTemplateService.save({ code: 'SALE_THANK_YOU', body: 'سپاس از خرید شما', isActive: false, userId })
  const tOff = makeInvoice({ phone: '09120000099' })
  const r3 = await notifySaleCreated({ invoiceId: tOff.id, userId })
  truthy('قالب خاموش ⇒ پیام نمی‌سازد', !r3.queued && r3.detail.includes('خاموش'), r3.detail)
  await smsTemplateService.save({ code: 'SALE_THANK_YOU', body: '{customer_name} عزیز، از خرید شما در {store_name} سپاسگزاریم.', isActive: true, userId })

  const okOne = makeInvoice({ phone: '09120000098' })
  const r4 = await notifySaleCreated({ invoiceId: okOne.id, userId })
  eq('با برگشت قالب، دوباره کار می‌کند', r4.queued, true)

  eq('هیچ‌کدام از این‌ها پیام اضافه نساختند', outbox().length, n0 + 1)
}

console.log('\n۵) ورودی خراب هرگز throw نمی‌کند')
{
  const attempts = [
    undefined,
    {},
    { invoiceId: 'سلام' },
    { invoiceId: -5 },
    { invoiceId: null },
    { invoiceId: 1.7 },
    { invoiceId: {} }
  ]
  let threw = ''
  let queued = 0
  for (const a of attempts) {
    try {
      const res = await notifySaleCreated(a)
      if (res.queued) queued++
    } catch (e) {
      threw = String(e?.message ?? e)
    }
  }
  eq('هیچ ورودی‌ای خطا پرتاب نکرد', threw, '')
  eq('و هیچ پیامی هم ساخته نشد', queued, 0)
}

console.log('\n۶) جداسازی: دست به جدول‌های فروش نمی‌زند')
{
  const inv = makeInvoice()
  const before = invoiceCount()
  await notifySaleCreated({ invoiceId: inv.id, userId })
  eq('تعداد فاکتورها عوض نشد (خودِ قلاب هیچ رکوردی در فروش نمی‌سازد)', invoiceCount(), before)
  const fkCols = sql.prepare('PRAGMA foreign_key_list("SmsOutbox")').all()
  eq('هیچ کلید خارجی‌ای به جدول فروش وصل نیست (وابستگی نرم)', fkCols.filter((f) => /Sale/i.test(f.table)).length, 0)

  // و ماژول پیامک هیچ‌جای سرویس فروش را import نمی‌کند (قاعده‌ی یک‌طرفه)
  const sale = await import('node:fs').then((fs) => fs.readFileSync('src/main/services/SalesService.ts', 'utf-8'))
  eq('SalesService حتی یک ارجاع به پیامک ندارد', /sms/i.test(sale), false)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
