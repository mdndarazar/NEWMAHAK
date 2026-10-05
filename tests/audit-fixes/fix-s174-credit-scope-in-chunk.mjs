/**
 * ===========================================================================
 * نشست ۱۷۴ · خوشه D · S173-D3 — storeCreditScopes با فیلتر فاکتوری و سقف IN ۵۰۰
 *
 * storeCreditScopes با هر فیلتر فاکتوری (کارمند/شیفت/مشتری/کانال/…) تا ۲۰٬۰۰۰ شناسه‌ی فاکتور را
 * مستقیم در OR سه‌تایی `in` (sourceInvoiceId/exchangeInvoiceId/usedInvoiceId) و در
 * redemptionWhere (`invoiceId in`) می‌گذاشت، و issuedScoped هم تا ۲۰٬۰۰۰ `id in` داشت. قاعده‌ی
 * پروژه برای گزارش‌ها سقف IN ۵۰۰ (REPORT_IN_CHUNK) است. با ۵۰۱+ فاکتورِ یک کارمند در بازه، ردیف
 * «مصرف اعتبار»/«تعهد اعتبار» پل، drill مصرف اعتبار و بخش مصرف اعتبار دفتر رویداد از سقف رد
 * می‌شدند (پل: کل گزارش با خطا؛ drill: هشدار خواندن‌نشد؛ دفتر: خطا).
 * انتظار: هیچ IN بالای ۵۰۰ روی StoreCredit/StoreCreditRedemption؛ اعداد با فیلتر درست
 * (فقط فاکتورهای کارمند الف، نه ب)؛ drill صفحه‌بندی کامل/یکتا/نزولی؛ جمع drill = ردیف پل؛
 * دفتر رویداد همان تعداد را نشان دهد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s174-credit-scope-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s174-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
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
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
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

const userA = seed.user('فروشنده الف ۱۷۴')
const userB = seed.user('فروشنده ب ۱۷۴')
const product = seed.product('کاپشن ۱۷۴', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: userA })
const variant = seed.variant(product, 'XL')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000 WHERE id = ?').run(variant)

const invA = await salesService.create({ userId: userA, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const invB = await salesService.create({ userId: userB, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })

// ۵۲۰ کپی از فاکتور الف (همان کارمند/روز/وضعیت) ⇒ ۵۲۱ فاکتور کارمند الف امروز
const baseInv = seed.rows('SELECT * FROM "SaleInvoice" WHERE id = ?', invA.id)[0]
const invCols = Object.keys(baseInv).filter((c) => c !== 'id' && c !== 'receiptNo')
const insInv = sql.prepare(`INSERT INTO "SaleInvoice" (receiptNo, ${invCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${invCols.map((c) => `"${c}"`).join(',')} FROM "SaleInvoice" WHERE id = ?`)
const maxReceipt = Number(seed.rows('SELECT MAX(receiptNo) AS m FROM "SaleInvoice"')[0].m)
const aInvoices = [invA.id]
for (let i = 0; i < 520; i++) aInvoices.push(Number(insInv.run(maxReceipt + 1 + i, invA.id).lastInsertRowid))
const NA = aInvoices.length

// برای هر فاکتور الف: یک اعتبار ۱٬۰۰۰ (منبع = همان فاکتور، ۱۰۰ مصرف‌شده) و یک مصرف ۱۰۰ روی همان فاکتور
const now = Date.now()
const insCredit = sql.prepare('INSERT INTO "StoreCredit" (code, amount, usedAmount, usedCount, status, source, sourceInvoiceId, userId, issuedAt, issuedAtJalali, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
const insRed = sql.prepare('INSERT INTO "StoreCreditRedemption" (creditId, code, amount, remainderAfter, seq, invoiceId, receiptNo, at, atJalali, atTime, userId, shiftId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
const cols = new Set(seed.rows('PRAGMA table_info("StoreCredit")').map((r) => r.name))
if (!cols.has('createdAt') || !cols.has('updatedAt')) throw new Error('schema changed')
const mk = (invoiceId, code, userId) => {
  const cid = Number(insCredit.run(code, 1000, 100, 1, 'PARTIALLY_USED', 'MANUAL', invoiceId, userId, now - 60_000, today, now - 60_000, now).lastInsertRowid)
  insRed.run(cid, code, 100, 900, 1, invoiceId, null, now - 30_000, today, '10:00', userId, shiftId)
}
aInvoices.forEach((id, i) => mk(id, `S174A${i}`, userA))
mk(invB.id, 'S174B0', userB)

const period = { fromJalali: today, toJalali: today, source: 'explicit' }
const report = async (filter, opts = {}) => {
  try {
    const { statements } = await buildStatements({
      where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today), period, filter
    }, opts)
    return statements
  } catch (e) { return { error: String(e?.message ?? e) } }
}
const fA = { fromJalali: today, toJalali: today, userId: userA }
const fB = { fromJalali: today, toJalali: today, userId: userB }
const fAll = { fromJalali: today, toJalali: today }

console.log('\n۱) پل با فیلتر کارمند الف (۵۲۱ فاکتور)')
maxIn = 0
const sA = await report(fA)
eq('گزارش بی‌خطا ساخته شد', sA?.error ?? null, null)
eq('مصرف اعتبار = ۵۲۱ × ۱۰۰', sA?.storeCredits?.used ?? null, NA * 100)
eq('تعداد مصرف = ۵۲۱', sA?.storeCredits?.usageCount ?? null, NA)
eq('تعهد اعتبار زنده = ۵۲۱ × ۹۰۰', sA?.storeCredits?.active ?? null, NA * 900)
eq('اعتبار صادرشده‌ی بازه = ۵۲۱ × ۱٬۰۰۰', sA?.storeCredits?.issued ?? null, NA * 1000)
eq('تعداد صادرشده = ۵۲۱', sA?.storeCredits?.issuedCount ?? null, NA)
eq('سهم بی‌سند (دستی) = ۵۲۱ × ۱٬۰۰۰', sA?.storeCredits?.issuedUnbacked ?? null, NA * 1000)
eq('هیچ IN بالای ۵۰۰ نبود', maxIn <= 500, true)

console.log('\n۲) کنترل: کارمند ب و بدون فیلتر')
const sB = await report(fB)
eq('ب: مصرف = ۱۰۰', sB?.storeCredits?.used ?? null, 100)
eq('ب: تعهد = ۹۰۰', sB?.storeCredits?.active ?? null, 900)
const s0 = await report(fAll)
eq('کل: مصرف = ۵۲۲ × ۱۰۰', s0?.storeCredits?.used ?? null, (NA + 1) * 100)
eq('کل: تعهد = ۵۲۲ × ۹۰۰', s0?.storeCredits?.active ?? null, (NA + 1) * 900)

const sNone = await report({ fromJalali: today, toJalali: today, customerId: 999999 })
eq('فیلتر بی‌فاکتور: بی‌خطا', sNone?.error ?? null, null)
eq('فیلتر بی‌فاکتور: مصرف = ۰', sNone?.storeCredits?.used ?? null, 0)
eq('فیلتر بی‌فاکتور: تعهد = ۰', sNone?.storeCredits?.active ?? null, 0)

console.log('\n۳) drill ردیف «مصرف اعتبار» با فیلتر الف')
const drill = async (skip, take) => {
  const s = await report(fA, { withDrillDown: true, bridgeSourceKey: 'storeCreditUsed', bridgeSourceSkip: skip, bridgeSourceTake: take })
  return { s, r: (s?.bridge?.rows ?? []).find((x) => x.key === 'storeCreditUsed') }
}
maxIn = 0
const d1 = await drill(0, 2000)
eq('drill بی‌خطا', d1.s?.error ?? null, null)
eq('ردیف پل = ۵۲٬۱۰۰', d1.r?.amount ?? null, NA * 100)
eq('totalCount = ۵۲۱', d1.r?.sourcesPage?.totalCount ?? null, NA)
eq('همه در یک صفحه', (d1.r?.sources ?? []).length, NA)
eq('جمع drill = ردیف', (d1.r?.sources ?? []).reduce((a, x) => a + Number(x.amount), 0), d1.r?.amount ?? -1)
eq('بدون هشدار خواندن‌نشد', String(d1.r?.sourcesWarning ?? '').includes('خوانده نشد'), false)
eq('هیچ فاکتور ب در drill نیست', (d1.r?.sources ?? []).some((x) => x.invoiceId === invB.id), false)
const seen = []
for (let skip = 0; skip < NA; skip += 200) {
  const { r } = await drill(skip, 200)
  eq(`اندازه‌ی صفحه‌ی skip=${skip}`, (r?.sources ?? []).length, Math.min(200, NA - skip))
  eq(`totalCount skip=${skip}`, r?.sourcesPage?.totalCount ?? null, NA)
  seen.push(...(r?.sources ?? []).map((x) => x.id))
}
eq('صفحه‌ها یکتا و کامل', [new Set(seen).size, seen.length], [NA, NA])
eq('ترتیب id نزولی در کل صفحه‌ها', seen.every((id, i) => i === 0 || seen[i - 1] > id), true)
eq('هیچ IN بالای ۵۰۰ نبود (drill)', maxIn <= 500, true)

console.log('\n۴) دفتر رویداد با فیلتر الف')
maxIn = 0
let led
try { led = await salesLedger.ledger({ fromJalali: today, toJalali: today, userId: userA }) } catch (e) { led = { error: String(e?.message ?? e) } }
eq('دفتر بی‌خطا', led?.error ?? null, null)
eq('تعداد مصرف اعتبار دفتر = ۵۲۱', led?.sections?.storeCreditsUsed?.totalCount ?? null, NA)
const usedRows = (led?.rows ?? []).filter((r) => r.eventType === 'STORE_CREDIT_USED')
eq('ردیف‌های مصرف اعتبار دفتر = ۵۲۱', usedRows.length, NA)
eq('جمع مبلغ مصرف دفتر = پل', usedRows.reduce((a, r) => a + r.amount, 0), NA * 100)
eq('cashEffect مصرف اعتبار همه صفر', usedRows.every((r) => r.cashEffect === 0), true)
eq('هیچ IN بالای ۵۰۰ نبود (دفتر)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
