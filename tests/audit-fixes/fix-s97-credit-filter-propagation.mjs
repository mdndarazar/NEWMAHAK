/**
 * نشست ۹۷ · خوشه F
 *
 * باگ: نوار فیلتر گزارش به تب legacy اعتبار فرستاده می‌شد، اما
 * StoreCreditService.list فقط فیلترهای اختصاصی اعتبار را می‌خواند؛ بنابراین
 * فیلتر کانال، نوع سفارش، شماره فیش، مشتری، کالا، کارمند و شیفت در این تب
 * بی‌صدا نادیده گرفته می‌شد.
 *
 * تست ساختاری است؛ Prisma Client تولیدی و Electron واقعی در این محیط حاضر
 * نیستند. تست می‌کند که قرارداد ورودی، lookup فاکتور مادر و اتصال scalarهای
 * اعتبار به where اصلی واقعاً وجود داشته باشد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const source = readFileSync(resolve(root, 'src/main/services/StoreCreditService.ts'), 'utf8')
const listStart = source.indexOf('interface ListFilter')
const listEnd = source.indexOf('}\n\n/**', listStart) + 1
const filterBlock = source.slice(listStart, listEnd)
// نشست ۹۸ · خوشه G: سازنده‌ی where فاکتور به reportInvoiceWhereFromFilter و اتصال اعتبار به creditIdsFromReportFilter منتقل شد
// ممیزی A97-01: منطق به src/main/services/creditReportScope.ts (مشترک با پل تطبیق) منتقل شد؛ رفتارش در tests/audit/audit-a97-01 اثبات می‌شود
const helper = readFileSync(resolve(root, 'src/main/services/creditReportScope.ts'), 'utf8')
const whereStart = source.indexOf('async function whereFromFilter')
const whereEnd = source.indexOf('/** جمع «تعهد فروشگاه»', whereStart)
const where = source.slice(whereStart, whereEnd)

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

check('بعد: قرارداد اعتبار کانال و نوع سفارش را می‌پذیرد', /orderType\?: string \| null[\s\S]{0,120}channels\?: readonly string\[\] \| null/.test(filterBlock))
check('بعد: قرارداد اعتبار شماره فیش، مشتری و کالا را می‌پذیرد', /receiptNo\?: number \| null[\s\S]{0,180}customerSearch\?: string \| null[\s\S]{0,120}productSearch\?: string \| null/.test(filterBlock))
check('بعد: قرارداد اعتبار کارمند و شیفت را می‌پذیرد', /userId\?: number \| null[\s\S]{0,80}shiftId\?: number \| null/.test(filterBlock))
check('بعد: کانال با helper مشترک نوع‌های سفارش را می‌سازد', /orderTypesForChannels\(f\.channels \?\? null\)/.test(helper))
check('بعد: فیلتر کالا روی snapshot و رابطه‌ی واریانت اعمال می‌شود', /variantName: \{ contains: productSearch \}[\s\S]{0,120}variantCode: \{ contains: productSearch \}/.test(helper))
check('بعد: فیلتر فاکتور با شماره فیش/مشتری/شیفت ساخته می‌شود', /receiptNo = intOrNull\(f\.receiptNo\)/.test(helper) && /customer: \{ name: \{ contains: customerSearch \} \}/.test(helper) && /shiftId = intOrNull\(f\.shiftId\)/.test(helper))
// رفتار این اتصال روی ۵۰٬۰۱۰ فاکتور در fix-s98-credit-filter-scale.mjs اثبات می‌شود
check('بعد: اعتبارهای متصل به فاکتور یا برگشت منطبق محدود می‌شوند', /c\.sourceInvoiceId != null\) out\.push/.test(helper) && /c\.exchangeInvoiceId != null\) out\.push/.test(helper) && /links\.some\(\(id\) => passing\.has\(id\)\)/.test(helper))
check('بعد: فیلتر اعتبار در whereFromFilter پیش از query نهایی اعمال می‌شود', /const reportCreditIds = await creditIdsForReportScope\([\s\S]{0,600}withAndClause\(where, \{ id: \{ in: reportCreditIds \} \}\)/.test(where))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
