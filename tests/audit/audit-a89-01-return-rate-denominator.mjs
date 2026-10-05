/**
 * ممیزی A89-01 — مخرج نرخ برگشت در FraudService.review با صورتش هم‌دامنه نبود:
 * برگشت‌ها با shiftId فیلتر می‌شدند ولی فروش‌ها نه، و فاکتور لغوشده/پیش‌نویس (CANCELED/DRAFT)
 * در مخرج می‌آمد ⇒ نرخ رقیق و هشدار ضدتقلب پنهان. (تست fix-s89 فقط helper خالص را می‌سنجید.)
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a8901-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date()); const now = Date.now()
const A = seed.user('فروشنده الف')
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 7200_000, userId: A })
const s2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 3600_000, userId: A })
let rno = 1
const inv = (shiftId, total, status = 'FINAL') => seed.insert('SaleInvoice', { receiptNo: rno++, userId: A, shiftId, status, grandTotal: total, paidTotal: total, issuedAt: now - 60_000, issuedAtJalali: today })
const ret = (invoiceId, shiftId, total) => seed.insert('SaleReturn', { invoiceId, userId: A, shiftId, total, returnedAt: now - 30_000, returnedAtJalali: today, kind: 'RETURN' })
inv(s1, 9_000_000)                        // فروش شیفت صبح
const i2 = inv(s2, 1_000_000)             // فروش شیفت شب
ret(i2, s2, 300_000); ret(i2, s2, 300_000) // دو برگشت در شیفت شب: ۶۰٪ فروش همان شیفت
const flag = (r) => r.flags.find((f) => f.key === 'returnRateByUser')
const byShift = await fraudService.review({ fromJalali: today, toJalali: today, shiftId: s2 })
eq('فیلتر شیفت شب: برگشت ۶۰۰٬۰۰۰ روی فروش ۱٬۰۰۰٬۰۰۰ همان شیفت (۶۰٪) هشدار می‌دهد', flag(byShift)?.count ?? 0, 1)
eq('برچسب نسبت ۶۰٪ است (نه ۶٪ رقیق‌شده با فروش شیفت دیگر)', /۶۰٪/.test(flag(byShift)?.sources?.[0]?.label ?? ''), true)
// فاکتور لغوشده/پیش‌نویسِ بزرگ نباید مخرج را رقیق کند
sql.prepare('DELETE FROM "SaleReturn"').run(); sql.prepare('DELETE FROM "SaleInvoice"').run()
const i3 = inv(s1, 1_000_000)
inv(s1, 20_000_000, 'CANCELED'); inv(s1, 20_000_000, 'DRAFT')
ret(i3, s1, 200_000); ret(i3, s1, 200_000)
const day = await fraudService.review({ fromJalali: today, toJalali: today })
eq('فاکتور لغوشده/پیش‌نویس ۴۰٬۰۰۰٬۰۰۰ در مخرج نمی‌آید ⇒ ۴۰۰٬۰۰۰/۱٬۰۰۰٬۰۰۰ = ۴۰٪ هشدار', flag(day)?.count ?? 0, 1)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
