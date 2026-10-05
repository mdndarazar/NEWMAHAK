/**
 * نشست ۱۷۸ (S178-D1) — مشاهده‌ی P3 ردیف ۱۲۷ AUDIT-PROGRESS: «آرشیو و پاک‌سازی» تجمیع قدیمی را DELETE می‌کرد در حالی که
 * StockMovement.consolidationId با کلید خارجی ON DELETE SET NULL به آن اشاره دارد. Prisma روی SQLite کلید خارجی را روشن
 * (PRAGMA foreign_keys = ON) اجرا می‌کند ⇒ حذف تجمیع، ستون consolidationId ردیف‌های دفتر گردش انبار را NULL می‌کرد، یعنی
 * همان دفتری که قاعده‌ی بند ۳ و متن خود MaintenanceService می‌گوید «نه حذف می‌شود و نه update».
 * رفع: تجمیعی که هنوز حرکت انباری به آن وصل است حفظ می‌شود (پیش‌نمایش = عملیات؛ شیفت همان تجمیع هم حفظ و در پیش‌نمایش
 * شمرده نمی‌شود)، تعداد حفظ‌شده در پیش‌نمایش/نتیجه و هشدار فارسی می‌آید.
 * این تست کلید خارجی هارنس را روشن می‌کند تا رفتار Prisma واقعی را بازسازی کند.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s178-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { maintenanceService } = await import(join(root, 'src/main/services/MaintenanceService.ts'))
const { toJalaliDate, jalaliToday, jalaliAddDays } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }
const DAY = 86400000
const today = jalaliToday()
const minCut = jalaliAddDays(today, -730)
const userId = seed.user('مدیر ۱۷۸')
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
// دو شیفت قدیمی: A مالک تجمیعِ دارای حرکت انبار، B مالک تجمیعِ بی‌حرکت
const shiftA = seed.insert('Shift', { name: 'شب', number: 1, dayJalali: oldJ, openedAt: oldT - 3600_000, userId })
const shiftB = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: oldJ, openedAt: oldT - 7200_000, userId })
const consA = seed.insert('Consolidation', { dayJalali: oldJ, fromDate: oldT - DAY, toDate: oldT, shiftId: shiftA })
const consB = seed.insert('Consolidation', { dayJalali: oldJ, fromDate: oldT - DAY, toDate: oldT - 1000, shiftId: shiftB })
// حرکت فاکتور قدیمی که با تجمیع A قطعی شده (همان کاری که finalizePendingForInvoices می‌کند)
sql.prepare(`UPDATE "StockMovement" SET consolidationId = ?, state = 'FINAL' WHERE refType = 'SaleInvoice' AND refId = ?`).run(consA, oldInv.id)
const linkedIds = sql.prepare('SELECT id FROM "StockMovement" WHERE consolidationId = ? ORDER BY id').all(consA).map((r) => Number(r.id))
eq('پیش‌شرط: حرکت انبار به تجمیع A وصل است', linkedIds.length >= 1, true)
const movesBefore = seed.count('StockMovement')
const auditBefore = seed.count('AuditLog')

// رفتار Prisma واقعی روی SQLite: کلید خارجی روشن
sql.exec('PRAGMA foreign_keys = ON')
eq('پیش‌شرط: کلید خارجی هارنس روشن شد', Number(Object.values(sql.prepare('PRAGMA foreign_keys').get())[0]), 1)

console.log('\n— ۱) پیش‌نمایش = عملیات')
const pv = await safe(() => maintenanceService.preview({ beforeJalali: minCut }))
eq('پیش‌نمایش بدون خطا', pv?.__error ?? null, null)
eq('پیش‌نمایش فقط تجمیع بی‌حرکت (B) را «حذف‌شونده» می‌شمارد', pv?.consolidations, 1)
eq('پیش‌نمایش تجمیع دارای حرکت انبار (A) را «حفظ‌شونده» می‌شمارد', pv?.consolidationsRetained, 1)
eq('پیش‌نمایش شیفت مالک تجمیع حفظ‌شده (A) را حذف‌شونده نمی‌شمارد (فقط B)', pv?.shifts, 1)

console.log('\n— ۲) پاک‌سازی واقعی')
const res = await safe(() => maintenanceService.archivePurge({ beforeJalali: minCut, backup: false, vacuum: false, purgeAudit: false, managerPassword: PW }))
eq('archivePurge بدون خطا', res?.__error ?? null, null)
eq('فاکتور قدیمی حذف، فاکتور امروز باقی', [seed.count('SaleInvoice', 'id = ?', oldInv.id), seed.count('SaleInvoice', 'id = ?', newInv.id)], [0, 1])
eq('تعداد کل StockMovement دست‌نخورده', seed.count('StockMovement'), movesBefore)
eq('consolidationId حرکت‌های دفتر انبار دست‌نخورده (NULL نشد)',
  sql.prepare('SELECT id FROM "StockMovement" WHERE consolidationId = ? ORDER BY id').all(consA).map((r) => Number(r.id)), linkedIds)
eq('تجمیع A (دارای حرکت) حفظ شد، تجمیع B حذف شد', [seed.count('Consolidation', 'id = ?', consA), seed.count('Consolidation', 'id = ?', consB)], [1, 0])
eq('شیفت A (مالک تجمیع حفظ‌شده) باقی، شیفت B حذف', [seed.count('Shift', 'id = ?', shiftA), seed.count('Shift', 'id = ?', shiftB)], [1, 0])
eq('عدد نتیجه = حذف واقعی (۱ تجمیع، ۱ شیفت) و حفظ‌شده ۱', [res?.consolidations, res?.shifts, res?.consolidationsRetained], [1, 1, 1])
eq('هشدار فارسی تجمیع حفظ‌شده در نتیجه', (res?.warnings ?? []).some((w) => /۱ تجمیع.*حفظ شد/.test(w)), true)
eq('هیچ کلید خارجی معلقی نماند (foreign_key_check خالی)', sql.prepare('PRAGMA foreign_key_check').all().length, 0)
const auditRow = sql.prepare(`SELECT note FROM "AuditLog" WHERE action = 'DATA_ARCHIVE_PURGE' ORDER BY id DESC LIMIT 1`).get()
eq('Audit پاک‌سازی ثبت شد و تجمیع حفظ‌شده را می‌گوید', [seed.count('AuditLog') > auditBefore, /۱ تجمیع/.test(auditRow?.note ?? '')], [true, true])

console.log('\n— ۳) اجرای دوباره: تجمیع حفظ‌شده «داده برای پاک‌سازی» حساب نمی‌شود')
const pv2 = await safe(() => maintenanceService.preview({ beforeJalali: minCut }))
eq('پیش‌نمایش دوم: ۰ تجمیع حذف‌شونده، ۱ حفظ‌شونده، ۰ شیفت', [pv2?.consolidations, pv2?.consolidationsRetained, pv2?.shifts], [0, 1, 0])
const res2 = await safe(() => maintenanceService.archivePurge({ beforeJalali: minCut, backup: false, vacuum: false, purgeAudit: false, managerPassword: PW }))
eq('اجرای دوم با پیام «داده‌ای برای پاک‌سازی وجود ندارد» رد', /داده‌ای برای پاک‌سازی وجود ندارد/.test(res2?.__error ?? ''), true)
eq('بعد از اجرای دوم: تجمیع A و پیوند دفتر همچنان باقی', [seed.count('Consolidation', 'id = ?', consA), seed.count('StockMovement', 'consolidationId = ?', consA)], [1, linkedIds.length])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
