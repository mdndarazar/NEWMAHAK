/**
 * نشست ۹۶ · خوشه F
 *
 * باگ: نوار فیلتر گزارش، شماره فیش/مشتری/کالا/نوع سفارش را به تب چک می‌فرستاد،
 * اما chequeList فقط کانال، شیفت و فروشنده را می‌خواند. بنابراین همان فیلتر
 * روی تب‌های دیگر و تب چک نتیجه‌ی یکسانی نداشت.
 *
 * تست ساختاری است؛ Prisma Client تولیدی و Electron واقعی در این محیط حاضر
 * نیستند. قرارداد endpoint باید همه‌ی فیلترهای فاکتور مادر را به helper مشترک
 * بدهد و شرط نوع سفارش را هم با کانال‌ها ترکیب کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const source = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const start = source.indexOf('async chequeList(')
const end = source.indexOf('// =========================================================================\n  // حذف گزارشات فروش', start)
// ممیزی A99-04 — منطق where به helper مشترک chequeReportWhere (جدول + شمارنده‌ی سقف) رفت
const hStart = source.indexOf('export async function chequeReportWhere(')
const helper = hStart >= 0 ? source.slice(hStart, source.indexOf('\n}\n', hStart)) : ''
const body = source.slice(start, end) + '\n' + helper

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

check('بعد: chequeList شماره فیش را به فیلتر فاکتور اضافه می‌کند', /receiptNo\?: number \| null/.test(body))
check('بعد: chequeList جستجوی مشتری را می‌پذیرد', /customerSearch\?: string \| null/.test(body))
check('بعد: chequeList جستجوی کالا را می‌پذیرد', /productSearch\?: string \| null/.test(body))
check('بعد: chequeList نوع سفارش را از قرارداد مشترک می‌گیرد', /orderType\?: string \| null/.test(body))
check('بعد: chequeList helper فیلتر هویتی فاکتور را مصرف می‌کند (ممیزی A96-01: مالک روی Payment)', /reportInvoiceIdentityWhere\(filter\)/.test(body) && /chequeReportWhere\(filter\)/.test(body) && /paymentEventOwnerWhere\(/.test(body))
check('بعد: نوع سفارش با کانال‌ها در helper مشترک ترکیب می‌شود', /const invoiceOrderType = orderTypeWhere\(filter as SaleReportFilter\)/.test(body))
check('بعد: شرط فاکتور فقط وقتی فیلتر فعال است به query اضافه می‌شود', /where\.invoice = \{[\s\S]{0,200}reportEventInvoiceStatusWhere/.test(body))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
