/**
 * بند ۴-۳۴ — تیک «در گزارش آخرین نام کالا را نشان بده».
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s195-report-live-name.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s195-live-name-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { productService } = await import('../../src/main/services/ProductService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => { if (v) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) } }
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست ۱۹۵ نام')
const cat = seed.category('پوشاک ۱۹۵')
const productId = seed.product('کت قدیم', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variantId = seed.variant(productId, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 100000 WHERE id = ?').run(variantId)
const SNAP = 'کت قدیم سایز M'
const LIVE = 'کت جدید سایز M'

const variantPayload = () => ({ id: variantId, salePrice: 100_000, purchasePrice: 0, size: 'M' })

console.log('\n۱) پیش‌فرض تیک خاموش است')
{
  const row = seed.one('SELECT reportLiveName FROM "Product" WHERE id = ?', productId)
  eq('reportLiveName پیش‌فرض', Number(row?.reportLiveName ?? row?.reportLiveName === true), 0)
}

console.log('\n۲) فروش با snapshot، بعد تغییر نام بدون تیک → گزارش همان اسم فیش')
{
  const inv = await safe('فروش', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 100_000, discount: 0, tax: 0, name: SNAP, code: 'V195' }],
    payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
  }))
  await safe('تغییر نام بدون تیک', () => productService.upsert({
    id: productId, name: 'کت جدید', userId, variants: [variantPayload()]
  }))
  const page = inv ? await salesService.reportItems({ fromJalali: today, toJalali: today }) : { rows: [] }
  const row = (page.rows ?? page).find((r) => r.invoiceId === inv?.id)
  eq('گزارش بدون تیک = snapshot', row?.name, SNAP)
}

console.log('\n۳) روشن کردن تیک → گزارش نام زنده؛ فیش همچنان snapshot')
{
  await safe('روشن کردن تیک', () => productService.upsert({
    id: productId, name: 'کت جدید', reportLiveName: true, userId, variants: [variantPayload()]
  }))
  const page = await salesService.reportItems({ fromJalali: today, toJalali: today })
  const row = (page.rows ?? page).find((r) => r.name === LIVE || r.name === SNAP)
  eq('گزارش با تیک = نام زنده', row?.name, LIVE)

  const flag = seed.one('SELECT reportLiveName FROM "Product" WHERE id = ?', productId)
  truthy('ستون تیک روشن', flag?.reportLiveName === 1 || flag?.reportLiveName === true)
}

console.log('\n۴) جستجو هم نام فیش هم نام زنده را پیدا می‌کند')
{
  const oldHits = await salesService.reportItems({ fromJalali: today, toJalali: today, productSearch: 'کت قدیم' })
  const newHits = await salesService.reportItems({ fromJalali: today, toJalali: today, productSearch: 'کت جدید' })
  truthy('جستجوی نام فیش', (oldHits.rows ?? oldHits).length > 0)
  truthy('جستجوی نام زنده', (newHits.rows ?? newHits).length > 0)
}

console.log('\n۵) خاموش کردن تیک در Audit ثبت می‌شود')
{
  await safe('خاموش کردن تیک', () => productService.upsert({
    id: productId, name: 'کت جدید', reportLiveName: false, userId, variants: [variantPayload()]
  }))
  const audits = seed.rows(
    `SELECT before, after, note FROM "AuditLog" WHERE action = 'PRODUCT_UPDATE' AND entityId = ? ORDER BY id`,
    productId
  )
  truthy('Audit تغییر نام', audits.some((a) => a.note === 'تغییر نام کالا' && a.before === 'کت قدیم' && a.after === 'کت جدید'))
  truthy(
    'Audit روشن شدن تیک',
    audits.some((a) => String(a.note).includes('تیک نمایش آخرین نام') && a.after === 'روشن')
  )
  truthy(
    'Audit خاموش شدن تیک',
    audits.some((a) => String(a.note).includes('تیک نمایش آخرین نام') && a.after === 'خاموش')
  )
  const page = await salesService.reportItems({ fromJalali: today, toJalali: today })
  const row = (page.rows ?? page)[0]
  eq('بعد از خاموش شدن دوباره snapshot', row?.name, SNAP)
}

console.log('\n۶) فیش و فرم کالا تیک را رعایت می‌کنند')
{
  const printSrc = readFileSync(new URL('../../src/main/services/PrintService.ts', import.meta.url), 'utf8')
  truthy('چاپ از saleLineTitle بدون preferLive', /name: saleLineTitle\((it|i), v\)/.test(printSrc))
  truthy('چاپ reportLineTitle ندارد', !printSrc.includes('reportLineTitle'))
  const form = readFileSync(new URL('../../src/renderer/src/components/ProductFormModal.tsx', import.meta.url), 'utf8')
  truthy('تیک روی فرم کالا', form.includes('در گزارش فروش آخرین نام کالا را نشان بده'))
  truthy('سؤال هنگام عوض شدن نام', form.includes('در گزارش‌های فروش هم اسم جدید نشان داده شود'))
  const salesSrc = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
  truthy('تب اقلام reportLineTitle', /name: reportLineTitle\(it, v\)/.test(salesSrc))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
