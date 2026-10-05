/**
 * ممیزی نشست ۱۲۳ (S123-1/S123-2) — تأیید رفتاری chunk در مسیرهایی که تست fix-s123 فقط ساختاری/ناقص می‌سنجید:
 *   • summaryForInvoices با ۵۰۱ فاکتور *دارای* تخصیص (fix-s123 فقط فاکتورهای بی‌تخصیص را می‌سنجید).
 *   • dropAllocations با ۵۰۱ فاکتور (deleteMany chunk‌شده؛ شمار دقیق و هیچ ردیف جامانده).
 *   • receiptDataFor (رسید فروش) و returnDataFor (رسید برگشت) با ۵۰۱ قلم زیر سقف IN ۵۰۰ هارنس: همه‌ی نام‌ها.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s123-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { stockAllocationService } = await import(join(root, 'src/main/services/StockAllocationService.ts'))
const { printService } = await import(join(root, 'src/main/services/PrintService.ts'))
const { jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
let maxIn = 0
const capIn = (model, op, key) => {
  const orig = db[model][op].bind(db[model])
  db[model][op] = async (args = {}) => {
    const ids = args?.where?.[key]?.in
    if (Array.isArray(ids)) { maxIn = Math.max(maxIn, ids.length); if (ids.length > 500) throw new Error(`HARNESS: IN ${model}.${op} > 500`) }
    return orig(args)
  }
}
capIn('productVariant', 'findMany', 'id'); capIn('saleItemStockAllocation', 'findMany', 'invoiceId'); capIn('saleItemStockAllocation', 'deleteMany', 'invoiceId')
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 200) } } }
const today = jalaliToday()
const p = seed.product('شلوار جین', seed.category('پوشاک'))
const vids = []
sql.exec('BEGIN')
for (let i = 0; i < 501; i++) vids.push(seed.variant(p, `S${i + 1}`))
// ۵۰۱ فاکتور، هر کدام یک تخصیص
const invIds = []
for (let i = 0; i < 501; i++) {
  const inv = seed.invoice({ receiptNo: 50_000 + i, grandTotal: 1000 })
  const it = seed.invoiceItem(inv.id, { variantId: vids[i], qty: 1, lineTotal: 1000 })
  seed.insert('SaleItemStockAllocation', { invoiceId: inv.id, saleItemId: it, variantId: vids[i], sourceKind: 'STORE', qty: 1, balanceAfter: 0 })
  invIds.push(inv.id)
}
// یک فاکتور ۵۰۱قلمی برای رسید فروش و برگشت
const big = seed.invoice({ receiptNo: 77_777, grandTotal: 501_000 })
sql.prepare('UPDATE "SaleInvoice" SET issuedAtJalali = ?, paidTotal = 501000 WHERE id = ?').run(today, big.id)
const itemIds = vids.map((v) => seed.invoiceItem(big.id, { variantId: v, qty: 1, lineTotal: 1000 }))
const ret = seed.insert('SaleReturn', { invoiceId: big.id, kind: 'RETURN', total: 501_000, returnedAt: Date.now(), returnedAtJalali: today })
for (let i = 0; i < 501; i++) seed.insert('SaleReturnItem', { returnId: ret, saleItemId: itemIds[i], variantId: vids[i], qty: 1, unitPrice: 1000, lineTotal: 1000 })
sql.exec('COMMIT')

const sum = await safe(() => stockAllocationService.summaryForInvoices(invIds))
eq('خلاصه‌ی export ۵۰۱ فاکتور دارای تخصیص: بدون خطا', sum?.__error ?? null, null)
eq('خلاصه‌ی export: هر ۵۰۱ فاکتور کلید دارد (فاکتور آخرِ chunk دوم هم)', Object.keys(sum ?? {}).length, 501)
eq('خلاصه‌ی export: فاکتور آخر خط خلاصه دارد', (sum?.[invIds[500]]?.lines?.length ?? 0) > 0, true)

const rc = await safe(() => printService.receiptDataFor(big.id))
eq('رسید فروش ۵۰۱قلمی: بدون خطا', rc?.__error ?? null, null)
const rItems = rc?.items ?? rc?.lines ?? []
eq('رسید فروش: ۵۰۱ قلم', rItems.length, 501)
eq('رسید فروش: قلم آخر نام کالا دارد (از chunk دوم)', JSON.stringify(rItems[500] ?? {}).includes('شلوار جین'), true)

const rr = await safe(() => printService.returnDataFor(ret, {}))
eq('رسید برگشت ۵۰۱قلمی: بدون خطا', rr?.__error ?? null, null)
const bItems = rr?.items ?? rr?.lines ?? []
eq('رسید برگشت: ۵۰۱ قلم', bItems.length, 501)
eq('رسید برگشت: قلم آخر نام کالا دارد', JSON.stringify(bItems[500] ?? {}).includes('شلوار جین'), true)

const dropped = await safe(() => db.$transaction((tx) => stockAllocationService.dropAllocations(tx, invIds)))
eq('dropAllocations ۵۰۱ فاکتور: شمار حذف ۵۰۱', dropped, 501)
eq('dropAllocations: هیچ تخصیصی از آن ۵۰۱ فاکتور نماند', seed.count('SaleItemStockAllocation', `invoiceId IN (${invIds.join(',')})`), 0)
eq('dropAllocations: تخصیص فاکتورهای دیگر دست‌نخورده (۰ چون فاکتور بزرگ تخصیص نداشت)', seed.count('SaleItemStockAllocation', 'invoiceId = ?', big.id), 0)
eq('هیچ IN بیش از ۵۰۰', maxIn <= 500, true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
