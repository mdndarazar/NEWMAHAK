/**
 * ===========================================================================
 * نشست ۱۷۵ · خوشه D · S174-D5 — notIn بی‌سقف «اعتبارهای برگشت باطل‌شده» در storeCreditScopes
 *
 * storeCreditScopes فهرست همه‌ی اعتبارهای برگشت‌های باطل‌شده‌ی بازه (creditIdsOfVoidedReturns) را
 * بی‌سقف در `id notIn` می‌گذاشت و همان را در issuedWhere / issuedOverpay / baseWhere تابع
 * creditIdsForReportScope می‌نشاند. قاعده‌ی پروژه برای گزارش‌ها سقف IN ۵۰۰ است. با ۵۰۱+ اعتبار
 * باطل‌شده در یک بازه، پل (با فیلتر و بی‌فیلتر) و drill «اعتبار صادرشده» از سقف رد می‌شدند.
 * انتظار: هیچ in/notIn بالای ۵۰۰ روی StoreCredit؛ اعداد صادرشده/سند‌دار/بی‌سند/اضافه‌دریافت
 * دقیقاً همان قبلی (اعتبار باطل هرگز شمرده نشود)؛ drill صادرشده = ردیف پل.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s175-voided-credit-notin.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s175-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}

let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500 && !process.env.S175_NO_CAP) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['storeCredit', 'storeCreditRedemption']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy']) {
    if (typeof prisma[model][m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const userA = seed.user('فروشنده الف ۱۷۵')
const userB = seed.user('فروشنده ب ۱۷۵')
const product = seed.product('شلوار ۱۷۵', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: userA })
const variant = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000 WHERE id = ?').run(variant)

const invA = await salesService.create({ userId: userA, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const invB = await salesService.create({ userId: userB, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })

const now = Date.now()
const insRet = sql.prepare('INSERT INTO "SaleReturn" (invoiceId, total, returnedAt, returnedAtJalali, userId, shiftId, voidedAt, voidReason) VALUES (?,?,?,?,?,?,?,?)')
const insCredit = sql.prepare('INSERT INTO "StoreCredit" (code, amount, usedAmount, usedCount, status, source, sourceInvoiceId, returnId, userId, issuedAt, issuedAtJalali, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')

// ۵۲۰ برگشت باطل‌شده، هر کدام با یک اعتبار ۱٬۰۰۰ باطل (CANCELED) ⇒ ۵۲۰ شناسه‌ی «باطل» در بازه
const NV = 520
for (let i = 0; i < NV; i++) {
  const rid = Number(insRet.run(invA.id, 1000, now - 50_000, today, userA, shiftId, now - 40_000, 'آزمون ابطال').lastInsertRowid)
  insCredit.run(`S175V${i}`, 1000, 0, 0, 'CANCELED', 'RETURN', invA.id, rid, userA, now - 50_000, today, now - 50_000, now)
}
// اعتبارهای معتبر: ۳ سند‌دار (برگشت زنده) الف ۵۰۰ · دستی الف ۷۰۰ · اضافه‌دریافت الف ۳۰۰ · دستی ب ۹۰۰
const liveRet = Number(insRet.run(invA.id, 1500, now - 20_000, today, userA, shiftId, null, null).lastInsertRowid)
for (let i = 0; i < 3; i++) insCredit.run(`S175L${i}`, 500, 0, 0, 'ACTIVE', 'RETURN', invA.id, liveRet, userA, now - 20_000, today, now - 20_000, now)
insCredit.run('S175M', 700, 0, 0, 'ACTIVE', 'MANUAL', null, null, userA, now - 20_000, today, now - 20_000, now)
insCredit.run('S175O', 300, 0, 0, 'ACTIVE', 'OVERPAY', invA.id, null, userA, now - 20_000, today, now - 20_000, now)
insCredit.run('S175MB', 900, 0, 0, 'ACTIVE', 'MANUAL', null, null, userB, now - 20_000, today, now - 20_000, now)

const period = { fromJalali: today, toJalali: today, source: 'explicit' }
const report = async (filter, opts = {}) => {
  try {
    const { statements } = await buildStatements({
      where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today), period, filter
    }, opts)
    return statements
  } catch (e) { return { error: String(e?.message ?? e) } }
}
const fAll = { fromJalali: today, toJalali: today }
const fA = { fromJalali: today, toJalali: today, userId: userA }
const fB = { fromJalali: today, toJalali: today, userId: userB }

const check = (tag, s, want) => {
  eq(`${tag}: گزارش بی‌خطا`, s?.error ?? null, null)
  const c = s?.storeCredits ?? {}
  eq(`${tag}: صادرشده`, c.issued ?? null, want.issued)
  eq(`${tag}: تعداد صادرشده`, c.issuedCount ?? null, want.count)
  eq(`${tag}: سند‌دار`, c.issuedBacked ?? null, want.backed)
  eq(`${tag}: بی‌سند`, c.issuedUnbacked ?? null, want.unbacked)
  eq(`${tag}: از اضافه‌دریافت`, c.issuedFromOverpay ?? null, want.overpay)
}

console.log('\n۱) پل بدون فیلتر (۵۲۰ اعتبار باطل در بازه)')
maxIn = 0
const s0 = await report(fAll)
check('کل', s0, { issued: 1500 + 700 + 300 + 900, count: 6, backed: 1500, unbacked: 1600, overpay: 300 })
eq('کل: وضعیت باطل (ستون جدا) = ۵۲۰ × ۱٬۰۰۰', s0?.storeCredits?.canceled ?? null, NV * 1000)
eq('هیچ in/notIn بالای ۵۰۰ نبود (کل)', maxIn <= 500, true)

console.log('\n۲) پل با فیلتر کارمند الف و ب')
maxIn = 0
check('الف', await report(fA), { issued: 2500, count: 5, backed: 1500, unbacked: 700, overpay: 300 })
check('ب', await report(fB), { issued: 900, count: 1, backed: 0, unbacked: 900, overpay: 0 })
eq('هیچ in/notIn بالای ۵۰۰ نبود (فیلتر)', maxIn <= 500, true)

console.log('\n۳) drill ردیف «اعتبار صادرشده» (فقط سند‌دار)')
maxIn = 0
for (const [tag, f, want] of [['کل', fAll, 3], ['الف', fA, 3], ['ب', fB, 0]]) {
  const s = await report(f, { withDrillDown: true, bridgeSourceKey: 'storeCreditIssued', bridgeSourceSkip: 0, bridgeSourceTake: 2000 })
  const r = (s?.bridge?.rows ?? []).find((x) => x.key === 'storeCreditIssued')
  eq(`${tag}: drill بی‌خطا`, s?.error ?? null, null)
  eq(`${tag}: totalCount`, r?.sourcesPage?.totalCount ?? null, want)
  eq(`${tag}: بدون هشدار خواندن‌نشد`, String(r?.sourcesWarning ?? '').includes('خوانده نشد'), false)
  eq(`${tag}: هیچ اعتبار باطل در drill نیست`, (r?.sources ?? []).some((x) => String(x.label).includes('S175V')), false)
  eq(`${tag}: جمع drill = ${want * 500}`, (r?.sources ?? []).reduce((a, x) => a + Number(x.amount), 0), want * 500)
}
eq('هیچ in/notIn بالای ۵۰۰ نبود (drill)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
