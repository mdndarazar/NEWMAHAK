/**
 * بازبینی دهم · B4 (متوسط) — دو رکوردِ `Supplier` که نامشان فقط با «ي» عربی/فارسی و
 * نیم‌فاصله فرق دارد، در تب سودِ واقعی **دو ردیف** می‌شد و `partyCount` همیشه ۱ (کلید
 * ردیف `code` بود و کد همیشه پر است). حالا ردیف‌ها با نامِ نرمال‌شده یکی می‌شوند —
 * فقط برای نمایش؛ در دیتابیس ادغام نمی‌شوند — و جمعِ ردیف‌ها باید همچنان با سرجمع بخواند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-supplier-yeh-merge.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-yeh-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
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

const userId = seed.user('فی')
seed.category('شومیز')
const p = seed.product('شومیز')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 4000000, purchasePrice = 1000000 WHERE id = ?').run(v)

// دو spellingِ نامِ یکی + یک نامِ دیگر + یک خریدِ بی‌نام.
const s1 = seed.insert('Supplier', { code: 'S1', name: 'علي رضايي' })
const s2 = seed.insert('Supplier', { code: 'S2', name: 'علی رضایی' })
const s3 = seed.insert('Supplier', { code: 'S3', name: 'محمد حسنی' })
const mkBuy = (supplierId, qty, unit, daysAgo) => {
  const at = Date.now() - daysAgo * DAY
  const inv = seed.insert('PurchaseInvoice', {
    invoiceNo: 1400 + daysAgo,
    issuedAtJalali: toJalaliDate(new Date(at)),
    issuedAt: at,
    supplierId,
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: inv, variantId: v, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId: v,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: at
  })
}
mkBuy(s1, 2, 1_000_000, 30)
mkBuy(s2, 2, 1_000_000, 20)
mkBuy(s3, 2, 2_000_000, 10)
mkBuy(null, 2, 1_000_000, 5)
await costEngine.run()

/** هشت عدد فروخته می‌شود: هر چهار لات کامل می‌رود (هزینه ۱۰م، درآمد ۳۲م). */
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 8, unitPrice: 4_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 32_000_000, destination: 'CASH' }]
})
await costEngine.run()

const prof = await profitService.profit({ fromJalali: today, toJalali: today })
eq('سرجمع: ۳۲ میلیون درآمد، ۲۲ میلیون سود', [prof.revenue, prof.realProfit], [32_000_000, 22_000_000])
const rows = prof.bySupplier ?? []
console.log('  ردیف‌ها:', JSON.stringify(rows, null, 1))
eq('باگ B4: چهار ردیف می‌شد؛ حالا سه ردیف (دوملکیِ نام یکی شده)', rows.length, 3)
const reza = rows.find((s) => /رض/.test(String(s.name)))
// نکته برای خواننده: سهمِ هزینهٔ ردیف‌های تامین‌کننده بر پایهٔ *سهمِ تعداد* خط است
// (۴ از ۸ عدد ⇒ نصف FIFO)، نه قیمتِ هر لات؛ به همین دلیلِ سرجمع را دقیق نگه می‌دارد.
eq('نامِ ي عربی و ي فارسی یک ردیف شد (درآمد ۱۶م، سود ۱۱م، دو رکورد)', [reza?.revenue, reza?.realProfit, reza?.partyCount], [16_000_000, 11_000_000, 2])
eq('کدِ هر دو رکورد در همان ردیف فهرست می‌شود', (reza?.codes ?? []).slice().sort(), ['S1', 'S2'])
const other = rows.find((s) => /حسنی/.test(String(s.name)))
eq('نامِ دیگر ادغام نشد (ادغامِ اجباری نداریم)', [other?.revenue, other?.realProfit, other?.partyCount], [8_000_000, 5_500_000, 1])
const none = rows.find((s) => /بی|فاقد/.test(String(s.name)))
eq('ردیف «فاقد نام» هم سرِ جایش است (نامِ خالی با نام ادغام نمی‌شود)', [none?.revenue, none?.realProfit, none?.partyCount], [8_000_000, 5_500_000, 0])
eq('جمع ردیف‌ها = سرجمع (نه کم، نه زیاد)', rows.reduce((a, s) => a + s.realProfit, 0), prof.realProfit)
eq('جمع درآمد ردیف‌ها = سرجمع', rows.reduce((a, s) => a + s.revenue, 0), prof.revenue)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
