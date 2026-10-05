/**
 * ممیزی نشست ۱۲۴ (S124-1..3) — تأیید رفتاری اثر مالی chunk (fix-s124 فقط «crash نکرد/هشدار ماند» را می‌سنجید):
 *   • linesForInvoice: قلمِ chunk دوم دسته و نیاکان درست می‌گیرد (enforce محدودیت دسته‌ی اعتبار دور زده نمی‌شود).
 *   • coverShortage: کالای chunk دوم واقعاً از انبار مرکزی برداشت می‌شود (موجودی ردیف ۵ ⇒ ۴) و بقیه‌ی کالاها دست‌نخورده.
 *   • checkAvailability: کمبود واقعی قلم ۵۰۱ (نه هشدار عمومی) با موجودی کافی بقیه.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 200)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s124-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { inventoryService } = await import(join(root, 'src/main/services/InventoryService.ts'))
const { linesForInvoice } = await import(join(root, 'src/main/services/StoreCreditService.ts'))
const { secondaryStockService } = await import(join(root, 'src/main/services/SecondaryStockService.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
let maxIn = 0
const orig = db.productVariant.findMany.bind(db.productVariant)
db.productVariant.findMany = async (args = {}) => {
  const ids = args?.where?.id?.in
  if (Array.isArray(ids)) { maxIn = Math.max(maxIn, ids.length); if (ids.length > 500) throw new Error('HARNESS: IN > 500') }
  return orig(args)
}
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 200) } } }
const parent = seed.category('پوشاک')
const child = seed.insert('Category', { name: 'جین مردانه', parentId: parent })
const other = seed.category('اکسسوری')
const pMain = seed.product('تی‌شرت', other)
const pLast = seed.product('جین خاص', child)
const vids = []
sql.exec('BEGIN')
for (let i = 0; i < 500; i++) vids.push(seed.variant(pMain, `T${i + 1}`))
vids.push(seed.variant(pLast, 'L501'))
sql.exec('COMMIT')
const last = vids[500]
sql.prepare('UPDATE "ProductVariant" SET stock = 10').run()
sql.prepare('UPDATE "ProductVariant" SET stock = 0, code = ? WHERE id = ?').run('JX-501', last)
const sec = seed.insert('SecondaryStockItem', { name: 'جین خاص L501', code: 'JX-501', qty: 5 })

const avail = await safe(() => inventoryService.checkAvailability(vids.map((variantId) => ({ variantId, qty: 1 }))))
eq('گیت موجودی: فقط یک کمبود واقعی (قلم ۵۰۱؛ بقیه موجودی ۱۰ دارند)', Array.isArray(avail) ? avail.filter((t) => /کافی نیست/.test(t)).length : avail, 1)
eq('گیت موجودی: کمبود مربوط به «جین خاص»', Array.isArray(avail) && /جین خاص/.test(avail[0] ?? ''), true)

const inv = seed.invoice({ grandTotal: 501 })
sql.exec('BEGIN'); for (const v of vids) seed.invoiceItem(inv.id, { variantId: v, qty: 1, lineTotal: 1 }); sql.exec('COMMIT')
const lines = await safe(() => linesForInvoice(db, inv.id))
const L = Array.isArray(lines) ? lines.find((l) => l.variantId === last) : null
eq('linesForInvoice: قلم chunk دوم دسته‌ی خودش را دارد', L?.categoryId, child)
eq('linesForInvoice: مسیر نیاکان [جین مردانه، پوشاک]', L?.categoryPath, [child, parent])
eq('linesForInvoice: قلم chunk اول هم دسته‌ی درست', Array.isArray(lines) ? lines.find((l) => l.variantId === vids[0])?.categoryId : null, other)

const cov = await safe(() => db.$transaction((tx) => secondaryStockService.coverShortage(tx, vids.map((variantId) => ({ variantId, qty: 1 })))))
eq('coverShortage: بدون خطا', cov?.__error ?? null, null)
eq('coverShortage: فقط کالای ۵۰۱ برداشت شد (۱ عدد)', cov?.totalTaken, 1)
eq('coverShortage: ردیف انبار مرکزی ۵ ⇒ ۴', seed.one('SELECT qty FROM "SecondaryStockItem" WHERE id = ?', sec).qty, 4)
eq('هیچ IN بیش از ۵۰۰', maxIn <= 500, true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
