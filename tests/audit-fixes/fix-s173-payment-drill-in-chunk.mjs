/**
 * ===========================================================================
 * نشست ۱۷۳ · خوشه D · ادامه‌ی الگوی S172-D3 — drill-down ردیف‌های پرداختیِ پل تطبیق
 *
 * paymentDrill (ردیف‌های realCash / managerAccountReceived / destinationUnknownReceived /
 * prior* / overpayReceived) کل مجموعه‌ی سبک را درست می‌شمارد، ولی جزئیات صفحه را با
 * where { id: { in: pageRows.map(...) } } می‌خواند. take تا ۲٬۰۰۰ مجاز است، پس صفحه‌ی بزرگ
 * با ۵۰۱+ پرداخت از سقف IN ۵۰۰ گزارش‌ها (REPORT_IN_CHUNK) رد می‌شد؛ خطا در catch بلعیده
 * می‌شد و drill ردیف «وجه واقعی» با totalCount ۰ و «۰ سند» برمی‌گشت ⇒ مدرک پشت عدد پل پنهان.
 *
 * بخش ۲ (S173-D2): هر خطای drill نباید بی‌صدا «۰ سند» شود؛ ردیف باید هشدار فارسی داشته باشد
 * که اسناد خوانده نشد و عدد ردیف از جمع اصلی است (نه از این فهرست)، بدون متن فنی/انگلیسی.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s173-payment-drill-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s173-'))
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

// سقف IN ۵۰۰ روی Payment (همان الگوی fix-s172)
let maxIn = 0
let forceFail = false
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if (k === 'in' && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) throw new Error('HARNESS: IN limit 500 exceeded') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const m of ['findMany', 'count', 'aggregate']) {
  const orig = prisma.payment[m].bind(prisma.payment)
  prisma.payment[m] = (args) => {
    walk(args?.where)
    // فقط واکشیِ جزئیات صفحهٔ drill را خراب کن. گزارش اصلی نیز چند query با
    // include دارد و تزریق خطا در آن‌ها قرارداد S173-D2 را نمی‌سنجد.
    if (forceFail && m === 'findMany' && args?.include && Array.isArray(args?.where?.id?.in))
      throw new Error('SQLITE_BUSY: database is locked')
    return orig(args)
  }
}

const userId = seed.user('مدیر تست ۱۷۳')
const product = seed.product('پیراهن ۱۷۳', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variant = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000 WHERE id = ?').run(variant)

const inv = await salesService.create({ userId, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const basePay = seed.rows('SELECT * FROM "Payment" WHERE invoiceId = ?', inv.id)[0]
eq('پرداخت نقدی پایه ساخته شد', Number(basePay?.amount ?? 0), 1000)
// ۵۹۹ کپی از همان پرداخت (همان فاکتور/روز/مقصد) ⇒ جمعاً ۶۰۰ سند پرداخت نقدی امروز
const cols = Object.keys(basePay).filter((c) => c !== 'id')
const ins = sql.prepare(`INSERT INTO "Payment" (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM "Payment" WHERE id = ?`)
for (let i = 0; i < 599; i++) ins.run(basePay.id)
const N = 600

const report = async (skip, take) => {
  const filter = { fromJalali: today, toJalali: today }
  try {
    const { statements } = await buildStatements({
      where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
      period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
    }, { withDrillDown: true, bridgeSourceKey: 'realCash', bridgeSourceSkip: skip, bridgeSourceTake: take })
    return statements
  } catch (e) { return { error: String(e?.message ?? e) } }
}
const row = (s) => (s?.bridge?.rows ?? []).find((r) => r.key === 'realCash')

console.log('\n۱) صفحه‌ی بزرگ (take ۲۰۰۰) با ۶۰۰ پرداخت نقدی')
maxIn = 0
const s1 = await report(0, 2000)
eq('گزارش بی‌خطا ساخته شد', s1?.error ?? null, null)
const r1 = row(s1)
eq('ردیف وجه واقعی = ۶۰۰٬۰۰۰', r1?.amount ?? null, N * 1000)
eq('totalCount صفحه = ۶۰۰', r1?.sourcesPage?.totalCount ?? null, N)
eq('همه‌ی ۶۰۰ سند در یک صفحه', (r1?.sources ?? []).length, N)
eq('جمع drill = مبلغ ردیف', (r1?.sources ?? []).reduce((a, x) => a + Number(x.amount), 0), r1?.amount ?? -1)
eq('ترتیب id نزولی', (r1?.sources ?? []).every((x, i, a) => i === 0 || a[i - 1].id > x.id), true)
eq('برچسب هر سند شماره‌ی فاکتور دارد', (r1?.sources ?? []).every((x) => String(x.label).includes(String(inv.receiptNo))), true)
eq('بدون هشدار (همه‌ی اسناد در صفحه)', r1?.sourcesWarning ?? null, null)
eq('هیچ IN بالای ۵۰۰ نبود', maxIn <= 500, true)

console.log('\n۲) صفحه‌بندی ۲۵۰تایی (برای مقایسه؛ باید از قبل هم سبز باشد)')
const seen = []
for (let skip = 0; skip < N; skip += 250) {
  const r = row(await report(skip, 250))
  eq(`totalCount صفحه‌ی skip=${skip}`, r?.sourcesPage?.totalCount ?? null, N)
  eq(`اندازه‌ی صفحه‌ی skip=${skip}`, (r?.sources ?? []).length, Math.min(250, N - skip))
  seen.push(...(r?.sources ?? []).map((x) => x.id))
}
eq('مجموعه‌ی صفحه‌ها یکتا و کامل', [new Set(seen).size, seen.length], [N, N])

console.log('\n۳) صفحه‌ی ۶۰۰تایی از skip ۰ (یک صفحه‌ی بالای ۵۰۰)')
maxIn = 0
const r3 = row(await report(0, 600))
eq('اندازه‌ی صفحه = ۶۰۰', (r3?.sources ?? []).length, N)
eq('هیچ IN بالای ۵۰۰ نبود', maxIn <= 500, true)

console.log('\n۴) S173-D2 — خطای خواندن drill بی‌صدا «۰ سند» نشود')
forceFail = true
const s4 = await report(0, 200)
forceFail = false
eq('گزارش خودش از کار نیفتاد', s4?.error ?? null, null)
const r4 = row(s4)
eq('عدد ردیف از جمع اصلی دست‌نخورده', r4?.amount ?? null, N * 1000)
const w4 = String(r4?.sourcesWarning ?? '')
eq('هشدار فارسی روی ردیف هست', w4.includes('اسناد سازنده‌ی این ردیف خوانده نشد'), true)
eq('هشدار می‌گوید عدد ردیف معتبر است', w4.includes('عدد ردیف'), true)
eq('هشدار مبلغ ردیف را با ریال دارد', w4.includes('ریال'), true)
eq('بدون متن فنی/انگلیسی در هشدار', /[A-Za-z]/.test(w4), false)
eq('page.failed = true', r4?.sourcesPage?.failed ?? null, true)

console.log('\n۵) بعد از رفع خطا دوباره عادی')
const r5 = row(await report(0, 200))
eq('بدون هشدار خطا', String(r5?.sourcesWarning ?? '').includes('خوانده نشد'), false)
eq('failed ندارد', r5?.sourcesPage?.failed ?? null, null)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
