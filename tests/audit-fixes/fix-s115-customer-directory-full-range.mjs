/**
 * نشست ۱۱۵ · خوشه G · بند ۴-۴۶ (+ قاعده‌ی ۴-۲۲ ابطال و ۴-۲۰ لغو/پیش‌نویس)
 *
 * باگ‌های `partyService.directory` («بانک شماره مشتریان» / فیلتر قرعه‌کشی):
 *  ۱) `take: 2000` ثابت و بی‌صدا؛ مشتری‌های قدیمی‌تر از ۲۰۰۰ دیده نمی‌شدند.
 *  ۲) فیلتر «نوع مشتری»، «فقط با شماره» و «حداقل خرید» *بعد* از برش در حافظه
 *     اعمال می‌شد؛ پس مشتری عمده‌ی قدیمی حتی با فیلتر «عمده» هم پیدا نمی‌شد.
 *  ۳) «جمع خرید» از `grandTotal` همه‌ی فاکتورها بود: فاکتور لغوشده/پیش‌نویس/باطل
 *     هم شمرده می‌شد و برگشت کم نمی‌شد؛ یعنی فروشنده با «خرید + برگشت» یا فاکتور
 *     لغوشده می‌توانست مشتری را به حداقل قرعه‌کشی برساند.
 * بعد از رفع: جمع خالص = فاکتورهای معتبر (نه DRAFT/CANCELED، نه باطل) منهای
 * برگشت‌های باطل‌نشده؛ فیلترها روی کل مجموعه، سپس صفحه‌بندی ۵٬۰۰۰تایی با
 * `page`/`warnings`. این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s115-dir-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { partyService } = await import('../../src/main/services/PartyService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

let rno = 5000
const inv = (customerId, grandTotal, extra = {}) =>
  seed.insert('SaleInvoice', { customerId, grandTotal, paidTotal: grandTotal, issuedAtJalali: today, receiptNo: ++rno, status: 'SETTLED', ...extra })

// قدیمی‌ترین مشتری‌ها (id کوچک) پشت سقف ۲۰۰۰ می‌افتند
const oldWholesale = seed.insert('Customer', { code: 'W1', name: 'عمده قدیمی', phone: '09120000001', isWholesale: true })
const oldBuyer = seed.insert('Customer', { code: 'C1', name: 'خریدار قدیمی', phone: '09120000002' })
const canceledOnly = seed.insert('Customer', { code: 'C2', name: 'فقط لغوشده', phone: '09120000003' })
const buyReturn = seed.insert('Customer', { code: 'C3', name: 'خرید و برگشت', phone: '09120000004' })
inv(oldWholesale, 3_000_000)
inv(oldBuyer, 2_000_000)
const vr = inv(oldBuyer, 400_000)
seed.insert('SaleReturn', { invoiceId: vr, total: 400_000, returnedAtJalali: today, voidedAt: Date.now(), voidReason: 'ابطال تست' })
inv(oldBuyer, 9_000_000, { voidedAt: Date.now(), voidReason: 'ابطال تست' })
inv(canceledOnly, 5_000_000, { status: 'CANCELED' })
inv(canceledOnly, 5_000_000, { status: 'DRAFT' })
const br = inv(buyReturn, 1_000_000, { status: 'RETURNED' })
seed.insert('SaleReturn', { invoiceId: br, total: 1_000_000, returnedAtJalali: today })
for (let k = 0; k < 2100; k++) seed.insert('Customer', { code: `R${k}`, name: `مشتری ${k}`, phone: `0935${String(k).padStart(7, '0')}` })
const N = 2104

const all = await partyService.directory({})
eq('خروجی همچنان آرایه است', Array.isArray(all), true)
eq('همه‌ی ۲۱۰۴ مشتری بدون برش بی‌صدا', all.length, N)
eq('totalCount واقعی', all.page?.totalCount, N)
eq('بدون برش هشداری نیست', (all.warnings ?? ['x']).length, 0)
const by = (id) => all.find((r) => r.id === id)
eq('خریدار قدیمی دیده می‌شود', !!by(oldBuyer), true)
eq('فاکتور باطل و برگشتِ باطل‌شده: جمع = ۲٬۴۰۰٬۰۰۰', by(oldBuyer)?.invoiceTotal, 2_400_000)
eq('فاکتور باطل در تعداد نیست', by(oldBuyer)?.invoiceCount, 2)
eq('فاکتور لغوشده/پیش‌نویس در جمع نیست', by(canceledOnly)?.invoiceTotal, 0)
eq('فاکتور لغوشده/پیش‌نویس در تعداد نیست', by(canceledOnly)?.invoiceCount, 0)
eq('خرید منهای برگشت = ۰', by(buyReturn)?.invoiceTotal, 0)
eq('مبلغ برگشت جدا دیده می‌شود', by(buyReturn)?.returnedTotal, 1_000_000)

const w = await partyService.directory({ kind: 'wholesale' })
eq('فیلتر «عمده» مشتری عمده‌ی قدیمی را پیدا می‌کند', w.some((r) => r.id === oldWholesale), true)

const lot = await partyService.directory({ minTotal: 500_000 })
eq('قرعه‌کشی: لغوشده و «خرید+برگشت» رد می‌شوند', lot.map((r) => r.id).sort((a, b) => a - b).join(','), [oldWholesale, oldBuyer].join(','))

const small = await partyService.directory({ take: 10 })
eq('برش صریح truncated=true', small.page?.truncated, true)
eq('هشدار فارسی «نمایش ۱۰ از ۲٬۱۰۴»', /نمایش ۱۰ از ۲٬?۱۰۴/.test((small.warnings ?? []).join(' ')), true)
const s2 = await partyService.directory({ take: 10, skip: N - 3 })
eq('صفحه‌ی آخر با skip', s2.length, 3)
const cl = structuredClone(small)
eq('page از structured clone (IPC الکترون) عبور می‌کند', cl.page?.totalCount, N)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
