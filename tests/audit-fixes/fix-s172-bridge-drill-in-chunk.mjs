/**
 * ===========================================================================
 * نشست ۱۷۲ · خوشه D · ریسک باقی‌مانده‌ی S170 — drill-down ردیف «اعتبار صادرشده»ی پل
 *
 * نشست ۱۷۰ drill ردیف storeCreditIssued را با where { id: { in: backedIds } } ساخت؛ backedIds
 * همه‌ی اعتبارهای سند‌دار بازه است و هیچ سقفی ندارد. قاعده‌ی پروژه برای گزارش‌ها سقف IN ۵۰۰
 * (REPORT_IN_CHUNK، S99/S120/S123/S124/S125) است؛ SQLite/Prisma واقعی هم سقف متغیر دارند و
 * بازه‌ی بزرگ (مثلاً یک سال با ۵۰۱+ برگشت با اعتبار) drill را با خطا یا کندی می‌کشت.
 * انتظار: شمارش صفحه = تعداد واقعی؛ هیچ IN بالای ۵۰۰؛ صفحه‌ها بی‌هم‌پوشانی و مرتب (id نزولی)؛
 * جمع همه‌ی صفحه‌ها = مبلغ ردیف پل؛ پیام خطای انگلیسی/HARNESS هرگز به کاربر نرسد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s172-bridge-drill-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s172-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}

// سقف IN ۵۰۰ روی StoreCredit (همان الگوی fix-s120/s124)
let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if (k === 'in' && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const m of ['findMany', 'count', 'aggregate']) {
  const orig = prisma.storeCredit[m].bind(prisma.storeCredit)
  prisma.storeCredit[m] = (args) => { walk(args?.where); return orig(args) }
}

const userId = seed.user('مدیر تست ۱۷۲')
const product = seed.product('شلوار ۱۷۲', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variant = seed.variant(product, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000 WHERE id = ?').run(variant)

const inv = await salesService.create({ userId, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const item = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', inv.id)[0].id
await salesService.createReturn({ invoiceId: inv.id, full: false, lines: [{ saleItemId: item, qty: 1 }], refundMethod: RefundMethod.STORE_CREDIT, refundAmount: 1000, userId, shiftId })
const base = seed.rows('SELECT * FROM "StoreCredit" WHERE returnId IS NOT NULL')[0]
eq('اعتبار سند‌دار پایه ساخته شد', Number(base?.amount ?? 0), 1000)
// ۵۲۰ کپی سند‌دار از همان سطر (همان returnId/هویت/روز صدور) ⇒ جمعاً ۵۲۱ اعتبار سند‌دار امروز
const cols = Object.keys(base).filter((c) => c !== 'id' && c !== 'code')
const ins = sql.prepare(`INSERT INTO "StoreCredit" (code, ${cols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${cols.map((c) => `"${c}"`).join(',')} FROM "StoreCredit" WHERE id = ?`)
for (let i = 0; i < 520; i++) ins.run(`S172X${i}`, base.id)
const N = 521

const report = async (skip, take) => {
  const filter = { fromJalali: today, toJalali: today }
  try {
    const { statements } = await buildStatements({
      where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
      period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
    }, { withDrillDown: true, bridgeSourceKey: 'storeCreditIssued', bridgeSourceSkip: skip, bridgeSourceTake: take })
    return statements
  } catch (e) { return { error: String(e?.message ?? e) } }
}
const row = (s) => (s?.bridge?.rows ?? []).find((r) => r.key === 'storeCreditIssued')

console.log('\n۱) صفحه‌ی بزرگ (take ۲۰۰۰) با ۵۲۱ اعتبار سند‌دار')
maxIn = 0
const s1 = await report(0, 2000)
eq('گزارش بی‌خطا ساخته شد', s1?.error ?? null, null)
const r1 = row(s1)
eq('ردیف پل = −۵۲۱٬۰۰۰', (r1?.sign ?? 0) * (r1?.amount ?? 0), -N * 1000)
eq('totalCount صفحه = ۵۲۱', r1?.sourcesPage?.totalCount ?? null, N)
eq('همه‌ی ۵۲۱ سند در یک صفحه', (r1?.sources ?? []).length, N)
eq('جمع drill = مبلغ ردیف', (r1?.sources ?? []).reduce((a, x) => a + Number(x.amount), 0), r1?.amount ?? -1)
eq('truncated = false', r1?.sourcesPage?.truncated ?? null, false)
eq('هیچ IN بالای ۵۰۰ نبود', maxIn <= 500, true)

console.log('\n۲) صفحه‌بندی ۲۰۰تایی: بی‌هم‌پوشانی، مرتب id نزولی، کامل')
const seen = []
for (let skip = 0; skip < N; skip += 200) {
  const s = await report(skip, 200)
  eq(`صفحه‌ی skip=${skip} بی‌خطا`, s?.error ?? null, null)
  const r = row(s)
  eq(`totalCount صفحه‌ی skip=${skip}`, r?.sourcesPage?.totalCount ?? null, N)
  eq(`اندازه‌ی صفحه‌ی skip=${skip}`, (r?.sources ?? []).length, Math.min(200, N - skip))
  eq(`truncated صفحه‌ی skip=${skip}`, r?.sourcesPage?.truncated ?? null, skip + 200 < N)
  seen.push(...(r?.sources ?? []).map((x) => x.id))
}
eq('همه‌ی شناسه‌ها یکتا', new Set(seen).size, seen.length)
eq('مجموعه‌ی صفحه‌ها = همه‌ی ۵۲۱', seen.length, N)
eq('ترتیب id نزولی در کل صفحه‌ها', seen.every((id, i) => i === 0 || seen[i - 1] > id), true)
eq('هیچ IN بالای ۵۰۰ نبود (کل صفحه‌ها)', maxIn <= 500, true)

console.log('\n۳) صفحه‌ی بیرون از بازه (skip ۱۰۰۰)')
const s3 = await report(1000, 200)
eq('بی‌خطا', s3?.error ?? null, null)
eq('صفحه‌ی خالی با totalCount درست', [(row(s3)?.sources ?? []).length, row(s3)?.sourcesPage?.totalCount ?? null], [0, N])

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
