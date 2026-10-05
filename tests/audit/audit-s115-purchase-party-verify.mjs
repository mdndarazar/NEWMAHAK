/**
 * ممیزی نشست ۱۱۵ — تأیید رفتاری (بدون ایراد): PurchaseService.list و PartyService.directory.
 *   • فهرست خرید: جمع روی کل بازه، orderBy invoiceNo (unique) ⇒ صفحه‌ها بی‌هم‌پوشانی حتی با issuedAt یکسان، صفحه‌ی آخر هم هشدار،
 *     فاکتور بیرون بازه نه در ردیف نه در جمع.
 *   • دفترچه‌ی مشتری: خالص = فاکتور معتبر منهای برگشت باطل‌نشده؛ برگشت جزئی کم می‌شود؛ برگشتِ فاکتور باطل‌شده دوباره کم نمی‌شود؛
 *     «آخرین خرید» از فاکتور لغوشده/پیش‌نویس نمی‌آید.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s115v-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { purchaseService } = await import('../../src/main/services/PurchaseService.ts')
const { partyService } = await import('../../src/main/services/PartyService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date())

console.log('— فهرست خرید')
const sup = seed.insert('Supplier', { name: 'الف', code: 'S1' })
const sameT = Date.now() - 3600_000
const raw = db.$harness.db
raw.exec('BEGIN')
const ins = raw.prepare('INSERT INTO "PurchaseInvoice" (invoiceNo, supplierId, issuedAt, issuedAtJalali, goodsTotal, discountTotal, grandTotal, paidTotal, settlementType, status) VALUES (?,?,?,?,?,?,?,?,?,?)')
for (let i = 1; i <= 12; i++) ins.run(i, sup, sameT, today, 1000 * i, 0, 1000 * i, 0, 'CASH', 'CONFIRMED')
ins.run(99, sup, sameT - 40 * 86400_000, toJalaliDate(new Date(sameT - 40 * 86400_000)), 7_000_000, 0, 7_000_000, 0, 'CASH', 'CONFIRMED')
raw.exec('COMMIT')
const from = new Date(sameT - 1000).toISOString(); const to = new Date(Date.now() + 1000).toISOString()
const ids = []
let lastWarn = null
for (let skip = 0; skip < 12; skip += 5) {
  const r = await purchaseService.list({ from, to, take: 5, skip })
  ids.push(...r.map((x) => x.invoiceNo))
  eq(`صفحه‌ی skip=${skip}: جمع کل بازه ۷۸٬۰۰۰ (نه جمع صفحه)`, r.totals.grandTotal, 78000)
  lastWarn = r.warnings
}
eq('۱۲ ردیف یکتا، بی‌هم‌پوشانی با issuedAt یکسان', [ids.length, new Set(ids).size], [12, 12])
eq('ترتیب قطعی invoiceNo نزولی', ids, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
eq('صفحه‌ی آخر هم هشدار دارد', (lastWarn ?? []).length > 0, true)
eq('فاکتور بیرون بازه در ردیف‌ها نیست', ids.includes(99), false)

console.log('— دفترچه‌ی مشتری')
let rno = 9000
const inv = (customerId, grandTotal, extra = {}) =>
  seed.insert('SaleInvoice', { customerId, grandTotal, paidTotal: grandTotal, issuedAtJalali: today, receiptNo: ++rno, status: 'SETTLED', ...extra })
const c1 = seed.insert('Customer', { code: 'P1', name: 'جزئی', phone: '09121111111' })
const i1 = inv(c1, 1_800_000)
seed.insert('SaleReturn', { invoiceId: i1, total: 900_000, returnedAtJalali: today })
const c2 = seed.insert('Customer', { code: 'P2', name: 'باطل با برگشت', phone: '09122222222' })
inv(c2, 500_000)
const i2 = inv(c2, 1_000_000, { voidedAt: Date.now(), voidReason: 'تست' })
seed.insert('SaleReturn', { invoiceId: i2, total: 1_000_000, returnedAtJalali: today })
const c3 = seed.insert('Customer', { code: 'P3', name: 'آخرین لغوشده', phone: '09123333333' })
inv(c3, 200_000, { issuedAtJalali: '1404/01/01' })
inv(c3, 900_000, { status: 'CANCELED', issuedAtJalali: '1405/12/29' })
const dir = await partyService.directory({})
const by = (id) => dir.find((r) => r.id === id)
eq('برگشت جزئی: ۱٬۸۰۰٬۰۰۰ − ۹۰۰٬۰۰۰ = ۹۰۰٬۰۰۰', by(c1)?.invoiceTotal, 900000)
eq('برگشتِ فاکتور باطل دوباره کم نمی‌شود: ۵۰۰٬۰۰۰', [by(c2)?.invoiceTotal, by(c2)?.returnedTotal], [500000, 0])
eq('آخرین خرید از فاکتور لغوشده نمی‌آید', by(c3)?.lastBuyJalali, '1404/01/01')
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
