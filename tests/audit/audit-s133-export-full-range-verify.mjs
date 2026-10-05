/**
 * ممیزی نشست ۱۳۳/۱۳۴ (S133-1) — تأیید رفتاری خروجی کامل فیلترشده (fix-s133 عمدتاً regex بود):
 *   • readAllReportPages: چند صفحه‌ی واقعی بدون حذف/تکرار، توقف با totalCount حتی با truncated=true قدیمی،
 *     توقف روی صفحه‌ی خالی، و AUDIT-S133-01: اگر مجموعه وسط پیمایش عوض شود (سند تازه در فهرست id نزولی
 *     برگشت/تعویض)، هرگز فایل با ردیف تکراری/جاافتاده نسازد (خطای فارسی).
 *   • AUDIT-S133-02: دفتر رویداد (پیش‌فرض و fullRange) با ۵۰۱ تعویض در ۵۰۱ نشست زیر سقف IN ۵۰۰ کامل
 *     و بی‌خطا، با شماره‌ی سند تعویض و نام شیفت درست.
 *   • سرویس‌ها take بزرگ‌تر از سقف را با page.take واقعی برمی‌گردانند (پیمایش هیچ ردیفی را جا نمی‌اندازد).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s133a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { readAllReportPages, pageOfOutput } = await import(pathToFileURL(join(root, 'src/renderer/src/lib/reportOutput.ts')).href)
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { salesLedger } = await import(join(root, 'src/main/services/SalesLedger.ts'))
const { toJalaliDate } = await import(join(root, 'src/shared/jalali.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
let maxIn = 0
const scan = (o, where) => {
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o)) { for (const x of o) scan(x, where); return }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'in' && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) throw new Error(`HARNESS: IN > 500 در ${where}:${v.length}`) }
    else scan(v, where)
  }
}
for (const model of Object.keys(db)) {
  const m = db[model]; if (!m || typeof m !== 'object' || model.startsWith('$')) continue
  for (const op of ['findMany', 'deleteMany', 'updateMany', 'count', 'aggregate', 'groupBy', 'findFirst']) {
    if (typeof m[op] !== 'function') continue
    const orig = m[op].bind(m); m[op] = async (args = {}) => { scan(args?.where, `${model}.${op}`); return orig(args) }
  }
}
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }

// endpoint جعلی: فهرست id نزولی با سقف take و قرارداد page همان سرویس‌ها
const fakeEndpoint = (store, { maxTake = 5000, legacyTruncated = false } = {}) => async (skip, take) => {
  const t = Math.min(take, maxTake)
  const sorted = [...store].sort((a, b) => b.id - a.id)
  const rows = sorted.slice(skip, skip + t)
  return { rows, page: { skip, take: t, totalCount: sorted.length, truncated: legacyTruncated ? skip > 0 || sorted.length > skip + t : sorted.length > skip + rows.length }, warnings: [] }
}

console.log('\n— ۱) readAllReportPages: پیمایش عادی')
{
  const store = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, amount: 1000 }))
  const r = await readAllReportPages(fakeEndpoint(store), (x) => x.rows, (x) => pageOfOutput(x), 5)
  eq('۱۲ ردیف در ۳ صفحه، همه یکتا', [r.rows.length, new Set(r.rows.map((x) => x.id)).size, r.totalCount], [12, 12, 12])
  const r2 = await readAllReportPages(fakeEndpoint(store, { maxTake: 4 }), (x) => x.rows, (x) => pageOfOutput(x), 5)
  eq('سرویس take را به ۴ محدود کرد ⇒ هیچ ردیفی جا نیفتاد', [r2.rows.length, new Set(r2.rows.map((x) => x.id)).size], [12, 12])
  const r3 = await readAllReportPages(fakeEndpoint(store, { legacyTruncated: true }), (x) => x.rows, (x) => pageOfOutput(x), 6)
  eq('truncated=true قدیمی روی صفحه‌ی آخر ⇒ توقف با totalCount، بدون تکرار', [r3.rows.length, new Set(r3.rows.map((x) => x.id)).size], [12, 12])
  const r4 = await readAllReportPages(async () => ({ rows: [{ id: 1 }], warnings: ['کسری ۵۰۰ ریال', 'نمایش ۱ از ۹ ردیف؛ برای دیدن همه‌ی ردیف صفحه‌ی بعد را بگیرید.'] }), (x) => x.rows)
  eq('بدون page ⇒ یک صفحه، هشدار غیرصفحه‌ای حفظ و هشدار برش حذف', [r4.rows.length, r4.warnings], [1, ['کسری ۵۰۰ ریال']])
}

console.log('\n— ۲) AUDIT-S133-01: تغییر مجموعه وسط پیمایش')
{
  const store = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, amount: 100_000 }))
  const base = fakeEndpoint(store)
  let calls = 0
  const racing = async (skip, take) => { const res = await base(skip, take); if (++calls === 1) store.push({ id: 11, amount: 100_000 }); return res }
  const r = await safe(() => readAllReportPages(racing, (x) => x.rows, (x) => pageOfOutput(x), 5))
  const ids = r?.rows?.map((x) => x.id) ?? []
  eq('برگشت تازه وسط خروجی ⇒ خطای فارسی «حین تهیه‌ی خروجی تغییر کرد» (نه فایل با ردیف تکراری)', /حین تهیه‌ی خروجی تغییر کرد/.test(r?.__error ?? ''), true)
  eq('هیچ فایل با جمع ۱٬۰۰۰٬۰۰۰ برای ۱۰ سند ۱۰۰٬۰۰۰ (تکرار) یا بی‌سند تازه ساخته نشد', ids.length === 0 || new Set(ids).size === ids.length, true)
  const store2 = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, amount: 100_000 }))
  const base2 = fakeEndpoint(store2); let c2 = 0
  const voiding = async (skip, take) => { const res = await base2(skip, take); if (++c2 === 1) store2.splice(store2.findIndex((x) => x.id === 10), 1); return res }
  const v = await safe(() => readAllReportPages(voiding, (x) => x.rows, (x) => pageOfOutput(x), 5))
  eq('ابطال سند وسط خروجی ⇒ خطای فارسی (نه ردیف جاافتاده‌ی بی‌صدا)', /حین تهیه‌ی خروجی تغییر کرد/.test(v?.__error ?? ''), true)
}

console.log('\n— ۳) AUDIT-S133-02: دفتر رویداد با ۵۰۱ تعویض در ۵۰۱ نشست زیر سقف IN ۵۰۰')
{
  const today = toJalaliDate(new Date()); const now = Date.now()
  const u = seed.user ? seed.user('فروشنده الف') : null
  sql.exec('BEGIN')
  const insShift = sql.prepare('INSERT INTO "Shift" (name) VALUES (?)')
  const insInv = sql.prepare('INSERT INTO "SaleInvoice" (receiptNo, status, grandTotal, paidTotal, goodsTotal, issuedAt, issuedAtJalali) VALUES (?, ?, ?, 0, ?, ?, ?)')
  const insRet = sql.prepare('INSERT INTO "SaleReturn" (invoiceId, kind, total, returnedAt, returnedAtJalali, exchangeInvoiceId, exchangeReceiptNo, exchangeTotal, shiftId, userId) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)')
  for (let i = 0; i < 501; i++) {
    const sh = insShift.run(`شیفت-${i}`).lastInsertRowid
    const orig = insInv.run(700000 + i, 'FINAL', 1000, 1000, now, today).lastInsertRowid
    const ex = insInv.run(800000 + i, 'FINAL', 1000, 1000, now, today).lastInsertRowid
    insRet.run(orig, 'EXCHANGE', 1000, now + i, today, ex, 1000, sh, u)
  }
  sql.exec('COMMIT')
  for (const [label, extra] of [['پیش‌فرض', {}], ['fullRange (خروجی کامل S133)', { fullRange: true }]]) {
    maxIn = 0
    const led = await safe(() => salesLedger.ledger({ fromJalali: today, toJalali: today, ...extra }))
    eq(`${label}: بدون خطا`, led?.__error ?? null, null)
    const exr = (led?.rows ?? []).filter((r) => r.eventType === 'EXCHANGE_RETURNED')
    eq(`${label}: ۵۰۱ ردیف کالای برگشتی تعویض`, exr.length, 501)
    const last = exr.find((r) => r.sourceId && /۸۰۰۵۰۰/.test(r.documentLabel ?? ''))
    eq(`${label}: سند ۵۰۱ام شماره‌ی تعویض ۸۰۰۵۰۰ و شیفت «شیفت-۵۰۰» (chunk دوم)`, [!!last, last?.shiftName], [true, 'شیفت-500'])
    eq(`${label}: بیشترین IN ≤ ۵۰۰`, maxIn <= 500, true)
  }
}

console.log('\n— ۴) سرویس‌ها page.take واقعی (سقف) را برمی‌گردانند')
{
  const today = toJalaliDate(new Date())
  const r = await safe(() => salesService.exchangeList({ fromJalali: today, toJalali: today, take: 99_999, skip: 0 }))
  eq('exchangeList take=۹۹٬۹۹۹ ⇒ page.take = سقف ۲۰٬۰۰۰ و ۵۰۱ ردیف', [r?.page?.take, r?.rows?.length], [20000, 501])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
