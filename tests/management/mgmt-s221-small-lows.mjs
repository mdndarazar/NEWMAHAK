/**
 * بازبینی دوازدهم · چهار موردِ «کم‌خطا» که رفعشان بی‌خطر بود:
 * B10 — هشدار «فروش زیرِ فیِ جایگزینی» روی ردیفِ ناخالص شمرده می‌شد (قلمِ کاملاً برگشتی هم).
 * B7  — تب ABC برگشتِ بی‌اعتبارشده و فاکتورِ لغو/پیش‌نویس را از درآمد کم می‌کرد (تب سود گارد داشت).
 * B6  — کارتِ کسری/ضایعات هم سقفِ ۵۰۰۰ حرکت را بی‌صدا می‌خورد و هم «کل مغازه بودنش» را نمی‌گفت.
 * B9  — «از ابتدای تاریخ» با رشتهٔ `1300-01-01` نوشته شده بود که فقط تصادفی کار می‌کرد.
 * B11 — `mgmt:target:set` عمداً با همان `assertMgmt` می‌ماند؛ تستِ بستنِ این تصمیم.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s221-small-lows.mjs
 */
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-small-221-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const DAY = 86400_000

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('کم‌خطا')
const cat = seed.category('برقی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})

/** کالای ۱: دو عدد فروش ۱م، فیِ جایگزینی ۲م ⇒ «زیرِ فی» است، بعد کلش برمی‌گردد. */
const p1 = seed.product('پنکه', cat)
const v1 = seed.variant(p1, 'e1')
sql.prepare('UPDATE "ProductVariant" SET stock = 4, salePrice = 1000000, purchasePrice = 2000000 WHERE id = ?').run(v1)
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1971,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
  goodsTotal: 8_000_000,
  discountTotal: 0,
  grandTotal: 8_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v1, qty: 4, unitPrice: 2_000_000, lineTotal: 8_000_000 })
seed.insert('StockMovement', {
  variantId: v1,
  delta: 4,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now() - 10 * DAY
})
await costEngine.run()

const inv = seed.insert('SaleInvoice', {
  receiptNo: 971,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 4_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 4_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
// دو قلم: ۲ عددِ ارزان (زیر فی) + ۱ قلمِ گرانِ سربه‌سر، تا شمارشِ ردیف‌ها معنا داشته باشد.
const lineA = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v1,
  qty: 2,
  unitPrice: 1_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 2_000_000
})
const lineB = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v1,
  qty: 1,
  unitPrice: 2_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 2_000_000
})
for (const [it, q] of [[lineA, 2], [lineB, 1]]) {
  seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: it, variantId: v1, sourceKind: 'STORE', qty: q })
  seed.insert('StockMovement', {
    variantId: v1,
    delta: -q,
    reason: 'SALE',
    refType: 'SaleInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: Date.now()
  })
}
sql.prepare('UPDATE "ProductVariant" SET stock = 1 WHERE id = ?').run(v1)
await costEngine.run()

const before = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از برگشت: یک ردیف «زیرِ فیِ جایگزینی» (۲م درآمد در برابر ۴م فی)', before.belowReplacement, 1)
eq('و همان یکی در لیستِ ردیف‌هاست', (before.belowLines ?? []).length, 1)

/** برگشتِ کاملِ همان ۲ عدد (به قفسه هم برگشته) ⇒ دیگر «فروشِ زیرِ فی» نیست. */
const mkRet = (itemId, qty, restock, no, extra) => {
  const ret = seed.insert('SaleReturn', {
    invoiceId: inv,
    total: qty * 1_000_000,
    refundMethod: 'CASH',
    refundAmount: qty * 1_000_000,
    returnedAtJalali: today,
    returnedAtTime: '12:00:00',
    userId,
    shiftId,
    kind: 'RETURN',
    restockPending: 0,
    ...(extra || {})
  })
  seed.insert('SaleReturnItem', {
    returnId: ret,
    saleItemId: itemId,
    variantId: v1,
    qty,
    unitPrice: 1_000_000,
    lineTotal: qty * 1_000_000,
    restockedQty: restock
  })
  if (restock > 0) {
    seed.insert('StockMovement', {
      variantId: v1,
      delta: restock,
      reason: 'SALE_RETURN',
      refType: 'SaleReturn',
      refId: ret,
      state: 'FINAL',
      createdAt: Date.now() + no
    })
  }
  return ret
}
mkRet(lineA, 2, 2, 1)
await costEngine.run()

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('B10 — ردیفی که کلش برگشته دیگر «زیرِ فی» شمرده نمی‌شود (باگ: ۱ و لیستِ پر)', [after.belowReplacement, (after.belowLines ?? []).length], [0, 0])
eq('درآمدِ پس از برگشت: ۴م − ۲م (فقط ردیفِ سالم می‌ماند)', after.revenue, 2_000_000)
eq('فی هم به همان نسبت کم می‌شود: ۶م − ۴م = ۲م ⇒ سودِ صفر (ردیفِ سالم سربه‌سر است)', [after.fifoCost, after.realProfit], [2_000_000, 0])

/** B7 — برگشتِ بی‌اعتبار نباید از ABC کم شود. */
mkRet(lineB, 1, 1, 2, { voidedAt: new Date() })
await costEngine.run()
const abc = await stockInsightService.abc({}, { withCost: true })
const profNow = await profitService.profit({ fromJalali: today, toJalali: today })
const abcRow = (abc.profitRows ?? []).find((r) => r.productId === p1)
eq('B7 — سودِ ABCِ همان کالا با تب سود می‌خواند (باگ: برگشتِ بی‌اعتبار یک بار دیگر کم می‌شد)', abcRow?.realProfit, profNow.realProfit)
eq('و درآمدِ خالصِ تب سود همان ۲م می‌ماند (باگِ ABC: ۱م — برگشتِ بی‌اعتبار دوباره کم می‌شد)', profNow.revenue, 2_000_000)

/** B6 — پرچمِ بریدگی + متنِ «کل مغازه» در UI */
eq('B6 — کارتِ ضرر پرچمِ truncated دارد (بازهٔ کوچک: false)', after.losses?.truncated ?? null, false)
const profSrc = readFileSync(new URL('../../src/main/services/management/ProfitService.ts', import.meta.url), 'utf-8')
const uiSrc = readFileSync(new URL('../../src/renderer/src/pages/ManagementReports.tsx', import.meta.url), 'utf-8')
eq('B6 — کوئریِ حرکت‌ها یک تا بیشتر می‌خواند تا بریدگی دیده شود', profSrc.includes('take: 5001'), true)
eq('B6 — UI برچسبِ «کل مغازه / بریده‌شده» را نشان می‌دهد', uiSrc.includes('data.losses.truncated'), true)

/** B9 — قیدِ تاریخِ صریح، نه رشتهٔ جلالیِ قلم‌گیری‌شده */
const stockSrc = readFileSync(new URL('../../src/main/services/management/StockInsightService.ts', import.meta.url), 'utf-8')
eq("B9 — دیگر `fromJalali: '1300-01-01'` در سرویس نمانده", stockSrc.includes("'1300-01-01'"), false)
eq('B9 — قیدِ «از ابتدای تاریخ» صریح است', stockSrc.includes('from: new Date(0)'), true)

/** B11 — هدف ماهانه عمداً پشتِ همان قفلِ مدیر می‌ماند (تصمیمِ مالک: رمزِ جدا نه) */
const ipcSrc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf-8')
const tgt = ipcSrc.slice(ipcSrc.indexOf('handle(IPC.mgmtTargetSet'), ipcSrc.indexOf('handle(IPC.mgmtTargetSet') + 420)
eq('B11 — `mgmt:target:set` هنوز assertMgmt دارد (و در فایل CHANGELOGِ نشست نوشته شد که چرا عوض نشد)', tgt.includes('assertMgmt'), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
