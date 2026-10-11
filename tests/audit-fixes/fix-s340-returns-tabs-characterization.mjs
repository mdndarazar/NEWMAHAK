// @ts-check
/**
 * فاز ۴ — قرارداد گزارش برگشت/تعویض:
 * برگشت ساده و تعویض داده‌های جدا هستند؛ تیک فقط تعویض را به جدول برگشت اضافه
 * می‌کند. تب تعویض نیز دریافت نقدی و کارتی را از destinationهای واقعی Payment
 * جدا نشان می‌دهد، بدون تغییر accounting اصلی.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sales = readFileSync('src/main/services/SalesService.ts', 'utf8')
const reports = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const types = readFileSync('src/shared/types.ts', 'utf8')

console.log('--- ۱. تب برگشت به‌طور پیش‌فرض فقط برگشت ساده را می‌خواهد ---')
assert.match(reports, /const \[includeExchanges, setIncludeExchanges\] = useState\(false\)/)
assert.match(
  sales,
  /filter\.includeExchanges === true\s*\?\s*\{\}[\s\S]{0,1200}?:\s*\{\s*kind:\s*ReturnKind\.RETURN\s*\}/,
  'خاموش بودن تیک باید فقط RETURN را بگیرد؛ SaleReturn.kind در schema nullable نیست'
)
assert.doesNotMatch(sales, /kind:\s*null\s+as\s+any/, 'نباید null نامعتبر به Prisma واقعی فرستاده شود')
assert.match(
  reports,
  /\[tab, creditOpen, includeSettled, includeExchanges, channelsKey, chequeDateMode\]/,
  'تغییر تیک باید گزارش را دوباره دریافت کند'
)
assert.match(reports, /'نوع سند',\s*'کامل\/جزئی'/)
assert.match(reports, /r\.isExchange \? 'تعویض کالا' : 'برگشت ساده'/)
assert.match(reports, /در این بازه برگشت ساده‌ای ثبت نشده است[\s\S]{0,160}تعویض‌ها را هم نشان بده/)
console.log('  ✓ خاموش: فقط RETURN؛ روشن: افزودن تعویض‌ها، reload خودکار و برچسب‌های مستقل سند/کامل-جزئی')

console.log('--- ۲. تب اختصاصی تعویض فقط EXCHANGE را می‌خواند ---')
const exchangeStart = sales.indexOf('async exchangeList(')
assert.ok(exchangeStart >= 0, 'exchangeList باید وجود داشته باشد')
const exchangeBody = sales.slice(exchangeStart, exchangeStart + 10_000)
assert.match(exchangeBody, /kind: ReturnKind\.EXCHANGE/, 'تب تعویض نباید برگشت ساده را وارد کند')
console.log('  ✓ تب تعویض مسیر service جدا و فیلتر EXCHANGE دارد')

console.log('--- ۳. دریافت نقدی و کارتی در DTO/جدول/خروجی جدا هستند ---')
assert.match(exchangeBody, /if \(p\.destination === PaymentDestination\.CARD\) sum\.card \+= amount/)
assert.match(exchangeBody, /cashReceived: received\.cash/)
assert.match(exchangeBody, /cardReceived: received\.card/)
assert.match(exchangeBody, /cardReceivedTotal: rows\.reduce/)
assert.match(types, /cardReceived: number/)
assert.match(types, /cardReceivedTotal: number/)
assert.match(reports, /'دریافت نقدی',\s*'دریافت کارتی'/)
assert.match(reports, /r\.cashReceived,\s*r\.cardReceived/)
assert.match(reports, /money\(t\.cashReceivedTotal\)[\s\S]{0,100}money\(t\.cardReceivedTotal\)/)
console.log('  ✓ کارت دیگر زیر ستون نقدی یا جمع نقدی ثبت/چاپ/export نمی‌شود')

console.log('\nنتیجه: منطق kind و accounting اصلی دست‌نخورده است؛ فقط UX و DTO گزارش تعویض دقیق شدند.')
