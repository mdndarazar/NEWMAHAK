/**
 * ممیزی نشست ۱۱۱ — سقف ۲۰۰ منبع ضدتقلب با sourcesTotal/sourcesTruncated و allSources (خروجی کامل).
 * ادعای S111 فقط با regex سنجیده شده بود؛ این تست رفتار واقعی سرویس و helper خروجی را می‌سنجد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s111-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { fraudOutputRows } = await import('../../src/shared/reportExtraOutput.ts')
const { jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const A = seed.user('الف')
const N = 201
for (let i = 0; i < N; i++) {
  const inv = seed.insert('SaleInvoice', { receiptNo: 1000 + i, userId: A, status: 'SETTLED', grandTotal: 1_000_000, paidTotal: 1_000_000, issuedAt: T0 + 10 * 3600_000, issuedAtJalali: today, customerId: null })
  seed.insert('SaleReturn', { invoiceId: inv, userId: A, total: 10_000, returnedAt: T0 + 9 * 3600_000, returnedAtJalali: today, kind: 'RETURN' })
}
const f = (r) => r.flags.find((x) => x.key === 'backdatedReturn')
const pageR = await fraudService.review({ fromJalali: today, toJalali: today })
eq('صفحه: ۲۰۰ منبع از ۲۰۱، truncated', [f(pageR).sources.length, f(pageR).sourcesTotal, f(pageR).sourcesTruncated], [200, N, true])
eq('صفحه: count و مبلغ هشدار بر اساس کل (۲۰۱ × ۱۰٬۰۰۰)', [f(pageR).count, f(pageR).amount], [N, N * 10_000])
const fullR = await fraudService.review({ fromJalali: today, toJalali: today, allSources: true })
eq('allSources: ۲۰۱ منبع، truncated=false', [f(fullR).sources.length, f(fullR).sourcesTotal, f(fullR).sourcesTruncated], [N, N, false])
const rows = fraudOutputRows(fullR.flags, (g) => g.key).filter((x) => x.group === 'backdatedReturn')
eq('خروجی کامل: ۲۰۱ ردیف با جمع = مبلغ هشدار', [rows.length, rows.reduce((a, r) => a + r.amount, 0)], [N, f(fullR).amount])
eq('ترتیب منابع قطعی (id نزولی) ⇒ اولین منبع صفحه = اولین منبع کامل', f(pageR).sources[0].id, f(fullR).sources[0].id)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
