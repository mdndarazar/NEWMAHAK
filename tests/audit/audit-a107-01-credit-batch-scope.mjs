/**
 * ممیزی نشست ۱۰۷ — PrintService.creditBatchIds (تعداد واقعی دسته از page.totalCount، سقف رندر ۲٬۰۰۰).
 * ادعای S107 رفتاری سنجیده می‌شود: دسته‌ی دیروز بدون تاریخ خوانده می‌شود (batchId پیش‌فرض «امروز» را
 *   خاموش می‌کند — دسته سند است نه گزارش)، ۲٬۰۰۲ اعتبار ⇒ requested=۲٬۰۰۲، ۲٬۰۰۰ شناسه، capped.
 * A107-01 (P3، گیت main): بدون ids و بدون batchId معتبر، list({batchId:null}) به پیش‌فرض «امروز» می‌افتاد ⇒
 *   فراخوان مستقیم print:credit:batch با payload خالی/batchId نامعتبر همه‌ی اعتبارهای امروز (هر منبع) را چاپ
 *   و «چاپ‌شده» علامت می‌زد. UI (creditPrintOpRequest) جلوی payload خالی را می‌گیرد ولی گیت باید در main باشد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const errOf = async (fn) => { try { const r = await fn(); return { ok: r } } catch (e) { return { err: String(e?.message ?? e) } } }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10701-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { printService } = await import('../../src/main/services/PrintService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const A = seed.user('مدیر')
const now = Date.now()
const yday = now - 86400_000
const B1 = seed.insert('StoreCreditBatch', { title: 'دسته‌ی دیروز', source: 'MANUAL' })
const B2 = seed.insert('StoreCreditBatch', { title: 'دسته‌ی بزرگ', source: 'MANUAL' })
const B3 = seed.insert('StoreCreditBatch', { title: 'دقیقاً سقف', source: 'MANUAL' })
const ins = sql.prepare('INSERT INTO "StoreCredit" (code, amount, usedAmount, status, source, userId, issuedAt, createdAt, issuedAtJalali, batchId) VALUES (?,?,?,?,?,?,?,?,?,?)')
sql.exec('BEGIN')
for (let i = 0; i < 3; i++) ins.run(`Y${i}`, 100000, 0, 'ACTIVE', 'MANUAL', A, yday, yday, toJalaliDate(new Date(yday)), B1)
for (let i = 0; i < 2002; i++) ins.run(`L${i}`, 100000, 0, 'ACTIVE', 'MANUAL', A, now, now, toJalaliDate(new Date(now)), B2)
for (let i = 0; i < 2000; i++) ins.run(`E${i}`, 100000, 0, 'ACTIVE', 'MANUAL', A, now, now, toJalaliDate(new Date(now)), B3)
// اعتبار امروزِ بی‌دسته (اضافه‌دریافت) — نباید در هیچ چاپ دسته‌ای بیاید
ins.run('OVR1', 50000, 0, 'ACTIVE', 'OVERPAY', A, now, now, toJalaliDate(new Date(now)), null)
sql.exec('COMMIT')

console.log('— ادعای S107')
const y = await printService.creditBatchIds({ batchId: B1 })
eq('دسته‌ی دیروز بدون تاریخ: ۳ شناسه، requested=۳', [y.ids.length, y.requested, y.capped], [3, 3, false])
const big = await printService.creditBatchIds({ batchId: B2 })
eq('۲٬۰۰۲ اعتبار: requested واقعی ۲٬۰۰۲، ۲٬۰۰۰ شناسه، capped', [big.requested, big.ids.length, big.capped], [2002, 2000, true])
const edge = await printService.creditBatchIds({ batchId: B3 })
eq('دقیقاً ۲٬۰۰۰: capped=false', [edge.requested, edge.ids.length, edge.capped], [2000, 2000, false])

console.log('— A107-01: بدون ids/batchId معتبر ⇒ خطای فارسی، نه «همه‌ی اعتبارهای امروز»')
for (const [label, input] of [['payload خالی', {}], ['batchId=null', { batchId: null }], ['batchId=«abc»', { batchId: 'abc' }], ['batchId=۰', { batchId: 0 }]]) {
  const r = await errOf(() => printService.creditBatchIds(input))
  eq(`${label}: رد با خطای فارسی (نه ${r.ok ? r.ok.ids.length + ' اعتبار امروز' : 'چاپ'})`, !!r.err && /[\u0600-\u06FF]/.test(r.err), true)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
