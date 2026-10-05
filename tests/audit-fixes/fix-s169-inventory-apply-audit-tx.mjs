/**
 * ===========================================================================
 * نشست ۱۶۹ · S169-D3 — InventoryService.apply بدون tx: Audit بیرون از تراکنش حرکت انبار نوشته می‌شد
 * (مشاهده‌ی باز AUDIT-PROGRESS ۱۴۵، P3؛ هم‌راستا با S146-D5؛ بند ۳ «ledger append-only» و بند ۵ «mutation مالی
 * همیشه یک تراکنش اتمیک» و «هر audit شامل actor»).
 *
 * باگ: وقتی setStock/increase/decrease بدون tx صدا زده می‌شد (مسیر پیش‌فرض رابط IInventoryService)، حرکت انبار و
 * تغییر موجودی در یک $transaction commit می‌شد و *بعد* STOCK_ADJUST/STOCK_INITIAL با کلاینت سراسری نوشته می‌شد ⇒
 * قطع برق/خطا بین این دو = اصلاح موجودی بدون هیچ ردی از actor. (همه‌ی مسیرهای فعلی src با tx صدا می‌زنند، پس این
 * مسیر نهفته است؛ ولی رابط عمومی آن را مجاز می‌داند.)
 * رفع: Audit داخل همان run(client) نوشته می‌شود ⇒ با tx صدازننده یا با تراکنش خودِ apply، هم‌زمان commit می‌شود.
 * رفتار audit (non-throwing، S146-D5) عمداً عوض نشد.
 * روش تست: $transaction سراسری پیچیده می‌شود تا هر auditLog.create روی کلاینت تراکنش شمرده شود؛ نوشتن روی
 * کلاینت سراسری جدا شمرده می‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s169-inventory-apply-audit-tx.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s169-inv-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { prisma } = await import('../../src/main/db/client.ts')
const { inventoryService } = await import('../../src/main/services/InventoryService.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}

// شمارنده‌ها: نوشتن Audit داخل تراکنش در برابر نوشتن با کلاینت سراسری
let inTx = 0
let outside = 0
let viaTx = false // کلاینت تراکنش هارنس ممکن است delegate سراسری را زیرین صدا بزند؛ آن را «بیرون» نشمار
const origTx = prisma.$transaction.bind(prisma)
const origAuditCreate = prisma.auditLog.create.bind(prisma.auditLog)
prisma.auditLog.create = (args) => { if (!viaTx) outside++; return origAuditCreate(args) }
prisma.$transaction = (fn, opts) =>
  typeof fn !== 'function'
    ? origTx(fn, opts)
    : origTx((tx) => {
        const wrapped = new Proxy(tx, {
          get(t, k) {
            if (k === 'auditLog') {
              const al = t.auditLog
              return new Proxy(al, { get: (a, kk) => (kk === 'create' ? async (args) => { inTx++; viaTx = true; try { return await a.create.call(a, args) } finally { viaTx = false } } : a[kk]) })
            }
            const val = t[k]
            return typeof val === 'function' ? val.bind(t) : val
          }
        })
        return fn(wrapped)
      }, opts)
const reset = () => { inTx = 0; outside = 0 }

const actor = seed.user('انباردار ۱۶۹')
const pid = seed.product('پیراهن ۱۶۹', seed.category('پوشاک ۱۶۹ب'))
const v = seed.insert('ProductVariant', { productId: pid, code: 'I169', barcode: 'BI169', salePrice: 1_000_000, purchasePrice: 500_000, stock: 5 })
const stock = () => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', v)?.stock)
const audits = (action) => seed.count('AuditLog', 'action = ? AND entity = ?', action, 'ProductVariant')

console.log('\n۱) setStock بدون tx (ADJUSTMENT) ⇒ حرکت + موجودی + Audit همه داخل یک تراکنش')
reset()
await inventoryService.setStock(v, 3, { reason: 'ADJUSTMENT', refType: 'Manual', userId: actor, note: 'اصلاح ۱۶۹' })
eq('موجودی = ۳', stock(), 3)
eq('یک STOCK_ADJUST ثبت شد', audits('STOCK_ADJUST'), 1)
eq('Audit داخل تراکنش نوشته شد', inTx, 1)
eq('هیچ Audit بیرون از تراکنش', outside, 0)
const row = seed.one('SELECT userId, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC', 'STOCK_ADJUST')
eq('actor در Audit', Number(row?.userId), actor)

console.log('\n۲) increase بدون tx با reason INITIAL ⇒ STOCK_INITIAL داخل تراکنش')
reset()
await inventoryService.increase([{ variantId: v, qty: 2 }], { reason: 'INITIAL', refType: 'Manual', userId: actor, note: 'اولیه ۱۶۹' })
eq('موجودی = ۵', stock(), 5)
eq('یک STOCK_INITIAL', audits('STOCK_INITIAL'), 1)
eq('Audit داخل تراکنش', inTx, 1)
eq('هیچ Audit بیرون', outside, 0)

console.log('\n۳) رفتار قبلی حفظ: با tx صدازننده ⇒ Audit با همان tx (یک تراکنش بیرونی، بدون تراکنش تو در تو)')
reset()
await prisma.$transaction((tx) => inventoryService.setStock(v, 4, { reason: 'ADJUSTMENT', refType: 'Manual', userId: actor, note: 'با tx' }, tx))
eq('موجودی = ۴', stock(), 4)
eq('Audit داخل تراکنش صدازننده', inTx, 1)
eq('هیچ Audit بیرون', outside, 0)

console.log('\n۴) حرکت فروش (SALE) Audit نمی‌سازد، مثل قبل')
reset()
const before = seed.count('AuditLog')
await inventoryService.decrease([{ variantId: v, qty: 1 }], { reason: 'SALE', refType: 'SaleInvoice', refId: 1 })
eq('موجودی = ۳', stock(), 3)
eq('Audit تازه‌ای نیست', seed.count('AuditLog'), before)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
