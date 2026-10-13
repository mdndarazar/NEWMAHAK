/**
 * نشست ۲۱۰ · بند ۴-۳۴ — نام/کد قلم فاکتور از دیتابیس است، نه از payload رندرر.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s210-invoice-item-name-from-db.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s210-item-name-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}

const src = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const fnStart = src.indexOf('async function saleItemRows')
const fnEnd = src.indexOf('\nfunction ', fnStart + 1)
const fnBody = fnStart >= 0 ? src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1800) : ''

console.log('\\nمنبع')
truthy('saleItemRows از دیتابیس واریانت می‌خواند', /loadProductVariantsByIds/.test(fnBody))
truthy('نام رندرر در snapshot نیست', !/\bl\.name\b/.test(fnBody))
truthy('کد رندرر در snapshot نیست', !/\bl\.code\b/.test(fnBody))

const userId = seed.user('مدیر نام فاکتور ۲۱۰')
const productId = seed.product('شلوار آبی', seed.category('پوشاک ۲۱۰'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variantId = seed.variant(productId, '۴۲')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 100000, code = ? WHERE id = ?').run('REAL-210', variantId)

console.log('\\nثبت با نام جعلی در payload')
const inv = await salesService.create({
  userId,
  shiftId,
  lines: [{
    variantId,
    qty: 1,
    unitPrice: 100_000,
    discount: 0,
    tax: 0,
    name: 'کالای جعلی',
    code: 'FAKE-CODE'
  }],
  payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
})
const item = sql.prepare('SELECT variantName, variantCode FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(inv.id)
eq('variantName از کالا است', item?.variantName, 'شلوار آبی سایز ۴۲')
eq('variantCode از واریانت است', item?.variantCode, 'REAL-210')

console.log('\\nگزارش و جستجو')
const page = await salesService.reportItems({ fromJalali: today, toJalali: today })
const row = (page.rows ?? page).find((r) => r.invoiceId === inv.id)
eq('گزارش نام واقعی است', row?.name, 'شلوار آبی سایز ۴۲')
const fakeHits = await salesService.reportItems({ fromJalali: today, toJalali: today, productSearch: 'کالای جعلی' })
const realHits = await salesService.reportItems({ fromJalali: today, toJalali: today, productSearch: 'شلوار آبی' })
truthy('جستجوی نام جعلی چیزی پیدا نمی‌کند', (fakeHits.rows ?? fakeHits).length === 0)
truthy('جستجوی نام واقعی پیدا می‌کند', (realHits.rows ?? realHits).some((r) => r.invoiceId === inv.id))

console.log('\\nویرایش فاکتور هم payload را نادیده می‌گیرد')
await salesService.update({
  id: inv.id,
  userId,
  shiftId,
  lines: [{
    variantId,
    qty: 1,
    unitPrice: 100_000,
    discount: 0,
    tax: 0,
    name: 'بازم جعلی',
    code: 'FAKE-2'
  }],
  // پرداخت زنده فقط از پنجرهٔ پرداختی‌ها تغییر می‌کند؛ ویرایش قلم باید صریحاً
  // همان ردیف مالی را نگه دارد تا گیت ضدسرقت payment bypass نشود.
  keepPayments: true
})
const after = sql.prepare('SELECT variantName, variantCode FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(inv.id)
eq('بعد از ویرایش هم نام واقعی است', after?.variantName, 'شلوار آبی سایز ۴۲')
eq('بعد از ویرایش هم کد واقعی است', after?.variantCode, 'REAL-210')

console.log(`\\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
