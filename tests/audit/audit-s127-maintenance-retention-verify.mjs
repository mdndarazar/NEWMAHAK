/**
 * ممیزی نشست ۱۲۷ (S127-1) — تأیید رفتاری «آرشیو و پاک‌سازی» (fix-s127 فقط regex بود):
 *   • مرز پاک‌سازی تازه‌تر از ۷۳۰ روز در preview و archivePurge (با رمز درست) رد و بی‌اثر؛ مرز دقیق ۷۳۰ روز پذیرفته
 *   • تاریخ خالی/نامعتبر رد با پیام هدف
 *   • بعد از پاک‌سازی: فاکتور قدیمی واقعی (با پرداخت/اقلام) حذف، فاکتور امروز و همه‌ی ردیف‌های StockMovement
 *     (حتی حرکت فاکتور حذف‌شده و حرکت متصل به تجمیع حذف‌شده) باقی؛ ریز حرکات کالا بعد از پاک‌سازی crash نمی‌کند
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s127-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { maintenanceService } = await import(join(root, 'src/main/services/MaintenanceService.ts'))
const { productService } = await import(join(root, 'src/main/services/ProductService.ts'))
const { toJalaliDate, jalaliToday, jalaliAddDays } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }
const DAY = 86400000
const today = jalaliToday()
const minCut = jalaliAddDays(today, -730)
const userId = seed.user('مدیر ۱۲۷')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const p = seed.product('جین', seed.category('پوشاک'))
const v = seed.variant(p, '۳۲'); sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 500000 WHERE id = ?').run(v)
const sale = async () => salesService.create({ userId, shiftId, lines: [{ variantId: v, qty: 1, unitPrice: 500000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 500000, destination: 'CASH' }] })
const oldInv = await sale()
const newInv = await sale()
const oldT = Date.now() - 1100 * DAY; const oldJ = toJalaliDate(new Date(oldT))
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(oldT, oldJ, oldInv.id)
sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ? WHERE invoiceId = ?').run(oldT, oldJ, oldInv.id)
sql.prepare(`UPDATE "StockMovement" SET createdAt = ? WHERE refType = 'SaleInvoice' AND refId = ?`).run(oldT, oldInv.id)
const cons = seed.insert('Consolidation', { dayJalali: oldJ, fromDate: oldT - DAY, toDate: oldT })
const consMove = seed.insert('StockMovement', { variantId: v, delta: 0, reason: 'ADJUSTMENT', createdAt: oldT, consolidationId: cons })
const movesBefore = seed.count('StockMovement')
const oldMoves = seed.count('StockMovement', `refType = 'SaleInvoice' AND refId = ?`, oldInv.id)
eq('پیش‌شرط: حرکت انبار فاکتور قدیمی وجود دارد', oldMoves >= 1, true)

console.log('\n— ۱) گیت مهلت ۷۳۰ روز')
const p1 = await safe(() => maintenanceService.preview({ beforeJalali: today }))
eq('preview با مرز امروز رد با پیام مهلت', /حداقل ۷۳۰ روز قدیمی/.test(p1?.__error ?? ''), true)
const p2 = await safe(() => maintenanceService.preview({ beforeJalali: jalaliAddDays(minCut, 1) }))
eq('preview با مرز یک روز تازه‌تر از حد رد', /حداقل ۷۳۰ روز قدیمی/.test(p2?.__error ?? ''), true)
const p3 = await safe(() => maintenanceService.preview({ beforeJalali: minCut }))
eq('preview با مرز دقیق ۷۳۰ روز پذیرفته و فاکتور قدیمی را می‌شمارد', p3?.saleInvoices, 1)
eq('preview حرکت انبار قدیمی را «حفظ‌شونده» می‌شمارد (≥ ۲)', (p3?.stockMovements ?? 0) >= 2, true)
eq('preview حداقل مرز را برمی‌گرداند', [p3?.retentionDays, p3?.minimumCutoffJalali], [730, minCut])
for (const [lbl, raw] of [['خالی', ''], ['نامعتبر ۱۴۰۵/۱۳/۰۱', '1405/13/01']]) {
  const r = await safe(() => maintenanceService.preview({ beforeJalali: raw }))
  eq(`preview تاریخ ${lbl} رد با پیام قالب`, /تاریخ مرز پاک‌سازی معتبر نیست/.test(r?.__error ?? ''), true)
}
const a1 = await safe(() => maintenanceService.archivePurge({ beforeJalali: today, backup: false, vacuum: false, purgeAudit: false, managerPassword: PW }))
eq('archivePurge مرز امروز با رمز درست رد', /حداقل ۷۳۰ روز قدیمی/.test(a1?.__error ?? ''), true)
eq('بعد از رد: هر دو فاکتور باقی', seed.count('SaleInvoice'), 2)

console.log('\n— ۲) پاک‌سازی واقعی با مرز ۷۳۰ روز')
const a2 = await safe(() => maintenanceService.archivePurge({ beforeJalali: minCut, backup: false, vacuum: false, purgeAudit: false, managerPassword: PW }))
eq('archivePurge بدون خطا', a2?.__error ?? null, null)
eq('فاکتور قدیمی حذف، فاکتور امروز باقی', [seed.count('SaleInvoice', 'id = ?', oldInv.id), seed.count('SaleInvoice', 'id = ?', newInv.id)], [0, 1])
eq('پرداخت فاکتور قدیمی حذف، پرداخت امروز باقی', [seed.count('Payment', 'invoiceId = ?', oldInv.id), seed.count('Payment', 'invoiceId = ?', newInv.id)], [0, 1])
eq('تعداد کل StockMovement دست‌نخورده', seed.count('StockMovement'), movesBefore)
eq('حرکت انبار فاکتور حذف‌شده باقی', seed.count('StockMovement', `refType = 'SaleInvoice' AND refId = ?`, oldInv.id), oldMoves)
// نشست ۱۷۸ (S178-D1/D2) — تجمیعِ وصل به دفتر گردش انبار دیگر حذف نمی‌شود (وگرنه ON DELETE SET NULL ستون consolidationId دفتر را NULL می‌کرد)
eq('تجمیع قدیمیِ وصل به دفتر انبار حفظ شد (S178-D1)', seed.count('Consolidation', 'id = ?', cons), 1)
eq('حرکت متصل به تجمیع باقی و پیوندش دست‌نخورده', seed.count('StockMovement', 'id = ? AND consolidationId = ?', consMove, cons), 1)
eq('هشدار append-only در نتیجه', (a2?.warnings ?? []).some((w) => /append-only/.test(w)), true)
const mv = await safe(() => productService.movements({ variantId: v }))
eq('ریز حرکات کالا بعد از پاک‌سازی crash نمی‌کند', mv?.__error ?? null, null)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
