/**
 * ===========================================================================
 * نشست ۱۷۳ · مشاهده‌ی باز ۱۰۶/۱۰۷ (AUDIT-PROGRESS) — «وصول نسیه‌ی بازه‌های قبل» در دفتر رویداد
 *
 * where بخش ۴ دفتر (priorPaymentWhere) پرداخت‌های روش «اعتبار خرید/اعتبار تعویض» را هم می‌گرفت؛
 * findMany با take سقف بخش (۴٬۰۰۰) و count هر دو آن‌ها را می‌شمردند و فقط بعداً در JS کنار
 * گذاشته می‌شدند. اثر: (۱) شمارش و متن هشدار «X وصول نسیه… فقط ۴٬۰۰۰ ردیف اول» دروغ بود؛
 * (۲) بدتر: وقتی مصرف‌های اعتبار زودتر (paidAt کوچک‌تر) بودند، جای ردیف‌های take را پر می‌کردند و
 * وصول نقدی واقعی دوره‌ی قبل از دفتر غیب می‌شد، با اینکه تعداد وصول واقعی زیر سقف بود.
 * انتظار: شمارش = فقط وصول واقعی؛ همه‌ی وصول‌های واقعی دیده شوند؛ هشدار کاذب نباشد؛
 * وقتی وصول واقعی واقعاً از سقف بگذرد، هشدار با عدد درست بیاید.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s173-ledger-prior-credit-count.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s173b-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)
const sql = prisma.$harness.db
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}

const prev = '1405/03/11'
const day = '1405/03/12'
const at = (d, hour) => new Date(jalaliStartOfDay(d).getTime() + hour * 3_600_000)
const userId = seed.user('صندوقدار ۱۷۳')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: day, userId })
const inv = seed.invoice({ grandTotal: 50_000_000 })
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, userId = ?, shiftId = ? WHERE id = ?')
  .run(at(prev, 10).getTime(), prev, userId, shiftId, inv.id)

const cashM = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const creditM = seed.insert('PaymentMethod', { key: 'STORE_CREDIT', label: 'اعتبار خرید', kind: 'STORE_CREDIT', isActive: 1, sortOrder: 2 })
const exchM = seed.insert('PaymentMethod', { key: 'EXCHANGE_CREDIT', label: 'اعتبار تعویض', kind: 'EXCHANGE_CREDIT', isActive: 1, sortOrder: 3 })
const pay = (methodId, amount, hour, destination) => seed.insert('Payment', {
  invoiceId: inv.id, methodId, amount, kind: 'CASH', destination,
  paidAt: at(day, hour), paidAtJalali: day, createdByUserId: userId, createdShiftId: shiftId
})

// ۴٬۰۰۰ مصرف اعتبار (۲٬۰۰۰ خرید + ۲٬۰۰۰ تعویض) صبح زود، سه وصول نقدی واقعی بعدازظهر
const baseCredit = pay(creditM, 1_000, 8, null)
const baseExch = pay(exchM, 1_000, 8, null)
const cols = seed.rows('SELECT * FROM "Payment" WHERE id = ?', baseCredit).map((r) => Object.keys(r))[0].filter((c) => c !== 'id')
const clone = sql.prepare(`INSERT INTO "Payment" (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM "Payment" WHERE id = ?`)
for (let i = 0; i < 1999; i++) { clone.run(baseCredit); clone.run(baseExch) }
const real = [pay(cashM, 100_000, 15, 'CASH'), pay(cashM, 200_000, 16, 'CASH'), pay(cashM, 300_000, 17, 'CASH')]
eq('داده: ۴٬۰۰۳ پرداخت روی فاکتور دوره‌ی قبل', seed.rows('SELECT COUNT(*) c FROM "Payment"')[0].c, 4003)

console.log('\n۱) وصول واقعی زیر سقف، مصرف اعتبار بالای سقف')
const r1 = await salesLedger.ledger({ fromJalali: day, toJalali: day })
const prior1 = r1.rows.filter((r) => r.eventType === 'CREDIT_SETTLEMENT')
eq('هر سه وصول نقدی واقعی دیده می‌شوند', prior1.map((r) => r.sourceId).sort((a, b) => a - b), real)
eq('جمع وصول = ۶۰۰٬۰۰۰', prior1.reduce((a, r) => a + r.amount, 0), 600_000)
eq('اثر نقدی کشو = ۶۰۰٬۰۰۰', prior1.reduce((a, r) => a + r.cashEffect, 0), 600_000)
eq('هیچ مصرف اعتباری ردیف وصول نشد', prior1.some((r) => r.note.includes('اعتبار')), false)
eq('totalCount صفحه‌ی وصول = ۳', r1.sections?.priorSettlements?.totalCount ?? null, 3)
eq('truncated = false', r1.sections?.priorSettlements?.truncated ?? null, false)
eq('هشدار کاذب «وصول نسیه… فقط ۴٬۰۰۰» نیست', (r1.warnings ?? []).some((w) => w.includes('وصول نسیه‌ی بازه‌های قبل پیدا شد')), false)

console.log('\n۲) وصول واقعی واقعاً بالای سقف ⇒ هشدار با عدد درست')
const cashCols = seed.rows('SELECT * FROM "Payment" WHERE id = ?', real[0]).map((r) => Object.keys(r))[0].filter((c) => c !== 'id')
const cloneCash = sql.prepare(`INSERT INTO "Payment" (${cashCols.map((c) => `"${c}"`).join(',')}) SELECT ${cashCols.map((c) => `"${c}"`).join(',')} FROM "Payment" WHERE id = ?`)
for (let i = 0; i < 3998; i++) cloneCash.run(real[0])
const r2 = await salesLedger.ledger({ fromJalali: day, toJalali: day })
const prior2 = r2.rows.filter((r) => r.eventType === 'CREDIT_SETTLEMENT')
eq('totalCount = ۴٬۰۰۱ (فقط وصول واقعی)', r2.sections?.priorSettlements?.totalCount ?? null, 4001)
eq('ردیف‌های نمایش‌داده = ۴٬۰۰۰ (سقف بخش، همه واقعی)', prior2.length, 4000)
eq('truncated = true', r2.sections?.priorSettlements?.truncated ?? null, true)
eq('هشدار با عدد درست ۴٬۰۰۱', (r2.warnings ?? []).some((w) => w.includes('۴۰۰۱ وصول نسیه‌ی بازه‌های قبل') || w.includes('۴٬۰۰۱ وصول نسیه‌ی بازه‌های قبل')), true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
