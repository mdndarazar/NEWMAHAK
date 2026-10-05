/**
 * ===========================================================================
 * جلسه ۴۷ — سوییت پذیرش «از کدام انبار کسر شود؟» (فقط فاکتور فروش عمده).
 * روی هارنس واقعی جلسه ۳۵: SQLite داخل Node، جدول‌ها از migration های واقعی،
 * سرویس‌های واقعی. هیچ چیزی mock نشده.
 * هر سناریو کالای خودش و انبارهای خودش را دارد (مرز عددهای انباری).
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-session47-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { salesService } = await import('../src/main/services/SalesService.ts')
const { stockAllocationService } = await import('../src/main/services/StockAllocationService.ts')
const { StockSourceKind, STOCK_PLAN_STALE_CODE, optionKey, resolveLine, storeLinesOf } = await import('@shared/stockSource')
const { OrderType, RefundMethod, SecondaryStockAction, AuditAction } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
const throwsWith = async (n, fn, needle) => {
  try { await fn(); return ok(n, false, 'هیچ خطایی پرتاب نشد') }
  catch (e) { const m = String(e?.message ?? e); if (m.startsWith('HARNESS:')) return ok(n, false, m); return ok(n, needle ? m.includes(needle) : true, `پیام: ${m.split('\n')[0]}`) }
}

// --------------------------------------------------------------- داده‌ی پایه
const UNIT = 1_000_000
const userId = seed.user('مدیر تست جلسه ۴۷')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار مردانه', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
let seq = 0
const shiftId = seed.insert('Shift', { name: 'شیفت تست ۴۷', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 3600000, userId })

const makeVariant = (stock, label) => {
  const id = seed.variant(product, label ?? `م${++seq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(stock, UNIT, id)
  return id
}
const codeOf = (variantId) => sql.prepare('SELECT code FROM "ProductVariant" WHERE id = ?').get(variantId).code
const stockOf = (v) => Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(v).stock)
const rowQty = (id) => Number(sql.prepare('SELECT qty FROM "SecondaryStockItem" WHERE id = ?').get(id).qty)
const warehouse = (name, isActive = 1) => seed.insert('SecondaryWarehouse', { name, isActive, sortOrder: ++seq })
/** ردیف انبار مرکزی که با «کد کالا» به همین واریانت تطبیق می‌خورد (رتبه ۱) */
const stockRow = (variantId, qty, warehouseId = null, name = 'ردیف انبار') =>
  seed.insert('SecondaryStockItem', { name, code: codeOf(variantId), qty, warehouseId })
const allocs = (invoiceId) => seed.rows('SELECT * FROM "SaleItemStockAllocation" WHERE invoiceId = ? ORDER BY id', invoiceId)
const logs = (action) => seed.rows('SELECT * FROM "SecondaryStockLog" WHERE action = ? ORDER BY id', action)
const itemsOf = (id) => seed.rows('SELECT id, variantId, qty FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id)

const sell = (lines, extra = {}) =>
  salesService.create({
    userId, shiftId, orderType: OrderType.WHOLESALE,
    lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: UNIT, discount: 0, tax: 0 })),
    payments: [{ methodId: cash, amount: UNIT * lines.reduce((s, l) => s + l.qty, 0) }],
    ...extra
  })

/** برنامه‌ی کسر را با همان توابع خالصی می‌سازد که پنجره استفاده می‌کند. */
const keyOfName = (pl, name) => {
  const hit = pl.sources.find((s) => s.name === name)
  if (!hit) throw new Error(`منبع «${name}» در پیش‌نمایش نیست. موجودها: ${pl.sources.map((s) => `${s.name}=${optionKey(s)}`).join(' , ')}`)
  return optionKey(hit)
}
const planFrom = async (lines, picks) => {
  const preview = await stockAllocationService.preview({ lines })
  const out = { lines: [] }
  for (const l of lines) {
    const pl = preview.lines.find((x) => x.variantId === l.variantId)
    if (!pl) throw new Error(`قلم ${l.variantId} در پیش‌نمایش نیست`)
    const p = picks[l.variantId]
    const primary = p.primaryName ? keyOfName(pl, p.primaryName) : p.primary
    const decisions = (p.decisions ?? []).map((d) => (d.pickName ? { type: 'PICK', key: keyOfName(pl, d.pickName) } : d))
    const r = resolveLine(pl, primary, decisions)
    if (r.error) throw new Error(`برنامه ساخته نشد: ${r.error} · کلیدها: ${pl.sources.map((s) => `${s.name}=${optionKey(s)}`).join(' , ')}`)
    if (!r.complete) throw new Error(`برنامه نصفه ماند (سؤال باز، باقی‌مانده ${r.pending?.shortfall})`)
    out.lines.push({ variantId: l.variantId, entries: r.entries })
  }
  return { plan: out, preview }
}

// ===========================================================================
section('بند ۱ · پیش‌نمایش: هر سه نوع انبار دیده می‌شود و هیچ چیزی نوشته نمی‌شود')
// ===========================================================================
{
  const v = makeVariant(6, 'پیش‌نمایش')
  const whX = warehouse('انبار شعبه یک')
  const r1 = stockRow(v, 4)            // انبار پیش‌فرض
  const r2 = stockRow(v, 5, whX)       // انبار X
  const before = {
    rows: seed.count('SecondaryStockItem'), logs: seed.count('SecondaryStockLog'),
    moves: seed.count('StockMovement'), stock: stockOf(v)
  }
  const p = await stockAllocationService.preview({ lines: [{ variantId: v, qty: 3 }] })
  const l = p.lines[0]
  eq('سه منبع برگشت', l.sources.map((s) => s.name), ['انبار فروشگاه', 'انبار مرکزی', 'انبار شعبه یک'])
  eq('موجودی هر منبع', l.sources.map((s) => s.available), [6, 4, 5])
  eq('نام و کد ردیف تطبیق‌خورده دیده می‌شود', [l.sources[1].rows[0].id, l.sources[1].rows[0].code], [r1, codeOf(v)])
  ok('دلیل تطبیق گفته می‌شود', l.sources[1].rows[0].matchReason.includes('کد'), l.sources[1].rows[0].matchReason)
  ok('انبار X هم ردیف خودش را دارد', l.sources[2].rows.length === 1 && l.sources[2].rows[0].id === r2)
  eq('پیش‌نمایش هیچ چیزی نمی‌نویسد', [seed.count('SecondaryStockItem'), seed.count('SecondaryStockLog'), seed.count('StockMovement'), stockOf(v)],
     [before.rows, before.logs, before.moves, before.stock])
  eq('فهرست گزینه‌های سؤال اول، بی پیش‌فرض و کامل', p.options.map((o) => o.name), ['انبار فروشگاه', 'انبار مرکزی', 'انبار شعبه یک'])
  const off = warehouse('انبار غیرفعال', 0)
  stockRow(v, 99, off)
  const p2 = await stockAllocationService.preview({ lines: [{ variantId: v, qty: 1 }] })
  ok('انبار غیرفعال گزینه نمی‌شود', !p2.options.some((o) => o.name === 'انبار غیرفعال'))
}

// ===========================================================================
section('بند ۲ · موجودی کافی — هر سه نوع انبار')
// ===========================================================================
{
  // الف) انبار فروشگاه
  const a = makeVariant(10, 'فروشگاه')
  const pa = await planFrom([{ variantId: a, qty: 3 }], { [a]: { primary: 'STORE' } })
  const ia = await sell([{ variantId: a, qty: 3 }], { stockPlan: pa.plan })
  eq('فروشگاه ۳ عدد کم شد', stockOf(a), 7)
  eq('یک ردیف دفتر مبدأ با منبع فروشگاه', allocs(ia.id).map((r) => [r.sourceKind, r.qty, r.warehouseId]), [['STORE', 3, null]])
  ok('خلاصه‌ی کسری‌ها در نتیجه‌ی فاکتور هست و «بعد از کسر» را می‌گوید',
     /^انبار فروشگاه: .*۳ \(بعد از کسر ۷\)$/.test(ia.stockSources?.lines?.[0] ?? ''), JSON.stringify(ia.stockSources?.lines))

  // ب) انبار مرکزی (پیش‌فرض)
  const b = makeVariant(10, 'مرکزی')
  const rb = stockRow(b, 8)
  const pb = await planFrom([{ variantId: b, qty: 3 }], { [b]: { primaryName: 'انبار مرکزی' } })
  const ib = await sell([{ variantId: b, qty: 3 }], { stockPlan: pb.plan })
  eq('انبار مرکزی ۳ عدد کم شد', rowQty(rb), 5)
  eq('⚠️ موجودی فروشگاه مطلقاً دست نخورد', stockOf(b), 10)
  eq('دفتر مبدأ = انبار پیش‌فرض', allocs(ib.id).map((r) => [r.sourceKind, r.qty, r.warehouseId, r.warehouseName]), [['WAREHOUSE', 3, null, 'انبار مرکزی']])
  ok('سابقه با اکشن تازه و شماره فاکتور ثبت شد',
     logs(SecondaryStockAction.SALE_WHOLESALE).some((x) => x.itemId === rb && String(x.note).includes(String(ib.receiptNo).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]))),
     JSON.stringify(logs(SecondaryStockAction.SALE_WHOLESALE).map((x) => x.note)))
  ok('هیچ حرکت انبارِ فروشگاهی برای این فاکتور ساخته نشد',
     seed.count('StockMovement', 'refType = ? AND refId = ?', 'SaleInvoice', ib.id) === 0)

  // ج) انبار X
  const c = makeVariant(10, 'شعبه')
  const whX = warehouse('انبار شعبه دو')
  const rc = stockRow(c, 6, whX)
  const pc = await planFrom([{ variantId: c, qty: 4 }], { [c]: { primary: optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: whX }) } })
  const ic = await sell([{ variantId: c, qty: 4 }], { stockPlan: pc.plan })
  eq('انبار X کم شد', rowQty(rc), 2)
  eq('فروشگاه دست‌نخورده', stockOf(c), 10)
  eq('نام انبار snapshot شد', allocs(ic.id)[0].warehouseName, 'انبار شعبه دو')
}

// ===========================================================================
section('بند ۳ · کسری با «بله» ⇒ انتخاب انبار دیگر · و سؤال دوباره')
// ===========================================================================
let multi = null
{
  const v = makeVariant(2, 'زنجیره')
  const w1 = warehouse('انبار زنجیره یک')
  const w2 = warehouse('انبار زنجیره دو')
  const rc = stockRow(v, 1, w1)
  const rd = stockRow(v, 9, w2)
  const key1 = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w1 })
  const key2 = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w2 })

  const preview = await stockAllocationService.preview({ lines: [{ variantId: v, qty: 5 }] })
  const step1 = resolveLine(preview.lines[0], 'STORE', [])
  eq('سؤال اول: فروشگاه ۲ داشت و ۳ کم است', [step1.pending.taken, step1.pending.shortfall], [2, 3])
  eq('فقط انبارهای دارای کالا پیشنهاد شدند', step1.pending.candidates.map((x) => x.name), ['انبار زنجیره یک', 'انبار زنجیره دو'])
  const step2 = resolveLine(preview.lines[0], 'STORE', [{ type: 'PICK', key: key1 }])
  eq('انبار اول هم کافی نبود ⇒ سؤال دوباره، بین باقی‌مانده‌ها', step2.pending.candidates.map((x) => x.name), ['انبار زنجیره دو'])

  const { plan } = await planFrom([{ variantId: v, qty: 5 }], { [v]: { primary: 'STORE', decisions: [{ type: 'PICK', key: key1 }, { type: 'PICK', key: key2 }] } })
  const inv = await sell([{ variantId: v, qty: 5 }], { stockPlan: plan })
  multi = { invoiceId: inv.id, variantId: v, rc, rd, w1, w2 }
  eq('فروشگاه صفر شد (نه منفی)', stockOf(v), 0)
  eq('انبار اول خالی شد', rowQty(rc), 0)
  eq('انبار دوم ۲ عدد داد', rowQty(rd), 7)
  eq('سه ردیف دفتر مبدأ برای یک قلم', allocs(inv.id).map((r) => [r.sourceKind, r.warehouseId, r.qty]), [['STORE', null, 2], ['WAREHOUSE', w1, 1], ['WAREHOUSE', w2, 2]])
  ok('هیچ‌کدام منفی نشد', allocs(inv.id).every((r) => !r.wentNegative))
  eq('خلاصه، سه انبار را به تفکیک می‌گوید', inv.stockSources.groups.map((g) => [g.warehouseName, g.totalQty]), [['انبار فروشگاه', 2], ['انبار زنجیره یک', 1], ['انبار زنجیره دو', 2]])
}

// ===========================================================================
section('بند ۴ · «نه» ⇒ باقی‌مانده از همان آخرین انبار، منفی می‌رود')
// ===========================================================================
{
  const v = makeVariant(1, 'منفی')
  const w = warehouse('انبار منفی')
  const r = stockRow(v, 2, w)
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w })
  const { plan } = await planFrom([{ variantId: v, qty: 5 }], { [v]: { primary: 'STORE', decisions: [{ type: 'PICK', key }, { type: 'NEGATIVE' }] } })
  const inv = await sell([{ variantId: v, qty: 5 }], { stockPlan: plan })
  eq('فروشگاه سهم خودش را داد و صفر شد', stockOf(v), 0)
  eq('آخرین انبار منفی رفت', rowQty(r), -2)
  const a = allocs(inv.id)
  eq('دفتر مبدأ منفی شدن را ثبت کرد', a.map((x) => [x.warehouseId, x.qty, !!x.wentNegative, x.balanceAfter]), [[null, 1, false, 0], [w, 4, true, -2]])
  ok('هشدار منفی شدن انبار در نتیجه‌ی فاکتور آمد', (inv.stockWarnings ?? []).some((x) => x.includes('منفی رفت')), JSON.stringify(inv.stockWarnings))
  ok('خلاصه، منفی را علامت زد', inv.stockSources.groups[1].negativeCount === 1)
}

// ===========================================================================
section('بند ۵ · کالایی که هیچ انبار دیگری ندارد ⇒ فقط تأیید منفی')
// ===========================================================================
{
  const v = makeVariant(1, 'بی‌انبار')
  const w = warehouse('انبار بی‌ردیف')
  const preview = await stockAllocationService.preview({ lines: [{ variantId: v, qty: 3 }] })
  const step = resolveLine(preview.lines[0], 'STORE', [])
  eq('هیچ گزینه‌ای برای پیشنهاد نیست', step.pending.candidates, [])
  const { plan } = await planFrom([{ variantId: v, qty: 3 }], { [v]: { primary: 'STORE', decisions: [{ type: 'NEGATIVE' }] } })
  const inv = await sell([{ variantId: v, qty: 3 }], { stockPlan: plan })
  eq('موجودی فروشگاه منفی شد (رفتار همیشگی)', stockOf(v), -2)
  eq('یک ردیف دفتر، با پرچم منفی', allocs(inv.id).map((x) => [x.sourceKind, x.qty, !!x.wentNegative]), [['STORE', 3, true]])

  // همان حالت، ولی روی یک انبار بی‌ردیف ⇒ ردیف تازه با موجودی منفی ساخته می‌شود
  const v2 = makeVariant(0, 'ردیف‌ساز')
  stockRow(v2, 5, w) // یک ردیف در انبار w هست تا w گزینه بشود
  const v3 = makeVariant(0, 'ردیف‌ساز دو')
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w })
  const p3 = { lines: [{ variantId: v3, entries: [{ kind: 'WAREHOUSE', warehouseId: w, warehouseName: 'انبار بی‌ردیف', qty: 2, balanceAfter: -2, wentNegative: true }] }] }
  const rowsBefore = seed.count('SecondaryStockItem')
  const inv3 = await sell([{ variantId: v3, qty: 2 }], { stockPlan: p3 })
  eq('انباری که ردیف نداشت، ردیف تازه‌ی منفی گرفت (بدهی گم نمی‌شود)', seed.count('SecondaryStockItem'), rowsBefore + 1)
  const made = seed.one('SELECT * FROM "SecondaryStockItem" WHERE warehouseId = ? ORDER BY id DESC LIMIT 1', w)
  eq('موجودی ردیف تازه منفی است', made.qty, -2)
  eq('فروشگاه دست‌نخورده ماند', stockOf(v3), 0)
}

// ===========================================================================
section('بند ۶ · چند قلم با منبع‌های متفاوت در یک فاکتور')
// ===========================================================================
let mixed = null
{
  const a = makeVariant(10, 'مخلوط الف')
  const b = makeVariant(0, 'مخلوط ب')
  const w = warehouse('انبار مخلوط')
  const rb = stockRow(b, 7, w)
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w })
  const { plan } = await planFrom([{ variantId: a, qty: 2 }, { variantId: b, qty: 3 }], {
    [a]: { primary: 'STORE' },
    [b]: { primary: key }
  })
  const inv = await sell([{ variantId: a, qty: 2 }, { variantId: b, qty: 3 }], { stockPlan: plan })
  mixed = { invoiceId: inv.id, a, b, rb, w }
  eq('قلم اول از فروشگاه', stockOf(a), 8)
  eq('قلم دوم از انبار', rowQty(rb), 4)
  eq('فروشگاهِ قلم دوم دست‌نخورده', stockOf(b), 0)
  eq('دفتر مبدأ هر قلم جدا', allocs(inv.id).map((x) => [x.variantId, x.sourceKind, x.qty]), [[a, 'STORE', 2], [b, 'WAREHOUSE', 3]])
  eq('خلاصه دو انبار را می‌گوید', inv.stockSources.groups.map((g) => g.warehouseName), ['انبار فروشگاه', 'انبار مخلوط'])
}

// ===========================================================================
section('بند ۷ · برنامه‌ای که بین پنجره و ثبت نامعتبر شده')
// ===========================================================================
{
  const v = makeVariant(0, 'کهنه')
  const w = warehouse('انبار کهنه')
  const r = stockRow(v, 5, w)
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w })
  const { plan } = await planFrom([{ variantId: v, qty: 4 }], { [v]: { primary: key } })
  // شبیه‌سازی دقیقِ «کسی بین پنجره و ثبت، انبار را خالی کرد»
  sql.prepare('UPDATE "SecondaryStockItem" SET qty = 1 WHERE id = ?').run(r)
  const invoicesBefore = seed.count('SaleInvoice')
  await throwsWith('برنامه‌ی کهنه با کد مشخص رد می‌شود', () => sell([{ variantId: v, qty: 4 }], { stockPlan: plan }), STOCK_PLAN_STALE_CODE)
  eq('هیچ فاکتوری ثبت نشد (تراکنش کامل برگشت)', seed.count('SaleInvoice'), invoicesBefore)
  eq('موجودی انبار یک عدد هم عوض نشد', rowQty(r), 1)
  eq('هیچ ردیف دفتری نماند', seed.count('SaleItemStockAllocation', 'variantId = ?', v), 0)
  // با موجودی تازه، همان قلم ثبت می‌شود
  const again = await planFrom([{ variantId: v, qty: 4 }], { [v]: { primary: key, decisions: [{ type: 'NEGATIVE' }] } })
  const inv = await sell([{ variantId: v, qty: 4 }], { stockPlan: again.plan })
  eq('اجرای دوباره‌ی پنجره کار می‌کند', rowQty(r), -3)
  ok('و این‌بار منفی‌شدن تأییدشده است', allocs(inv.id)[0].wentNegative === 1 || allocs(inv.id)[0].wentNegative === true)
}

// ===========================================================================
section('بند ۸ · قلمی که تطبیق متنی نمی‌خورد')
// ===========================================================================
{
  const v = makeVariant(4, 'بی‌تطبیق')
  const w = warehouse('انبار نامرتبط')
  seed.insert('SecondaryStockItem', { name: 'یک چیز دیگر', code: 'NOPE-۱', qty: 50, warehouseId: w })
  const p = await stockAllocationService.preview({ lines: [{ variantId: v, qty: 2 }] })
  const src = p.lines[0].sources.find((s) => s.name === 'انبار نامرتبط')
  eq('انبار نامرتبط، موجودی صفر و matched=false', [src.available, src.matched, src.rows.length], [0, false, 0])
  const bad = { lines: [{ variantId: v, entries: [{ kind: 'WAREHOUSE', warehouseId: w, warehouseName: 'انبار نامرتبط', qty: 2, balanceAfter: 0, wentNegative: false }] }] }
  await throwsWith('انتخاب انباری که کالا را ندارد، بی تأیید منفی رد می‌شود', () => sell([{ variantId: v, qty: 2 }], { stockPlan: bad }), STOCK_PLAN_STALE_CODE)
  const half = { lines: [{ variantId: v, entries: [{ kind: 'STORE', warehouseId: null, warehouseName: 'انبار فروشگاه', qty: 1, balanceAfter: 3, wentNegative: false }] }] }
  await throwsWith('برنامه‌ی نصفه (جمع ≠ تعداد فروش) رد می‌شود', () => sell([{ variantId: v, qty: 2 }], { stockPlan: half }), 'کامل نیست')
}

// ===========================================================================
section('بند ۹ · تیک «برداشت خودکار» روشن/خاموش')
// ===========================================================================
{
  // روشن: مثل قبل، کمبود از انبار مرکزی به انبار فروشگاه منتقل می‌شود
  const v = makeVariant(1, 'تیک روشن')
  const r = stockRow(v, 10)
  const inv = await sell([{ variantId: v, qty: 4 }], { autoCentralWithdraw: true })
  eq('رفتار فعلی تیک دست‌نخورده: انبار مرکزی کمبود را داد', rowQty(r), 7)
  eq('و کالا به انبار فروشگاه منتقل و فروخته شد', stockOf(v), 0)
  eq('تیک روشن هیچ دفتر مبدأیی نمی‌سازد (مسیر تاریخی)', allocs(inv.id).length, 0)
  ok('گزارش برداشت خودکار مثل قبل برمی‌گردد', inv.centralWithdrawnQty === 3, String(inv.centralWithdrawnQty))
  eq('خلاصه‌ی کسری‌ها در این مسیر null است', inv.stockSources, null)

  // خاموش و بی برنامه: مو‌به‌مو رفتار قبل (منفی + هشدار زرد)
  const v2 = makeVariant(1, 'تیک خاموش')
  stockRow(v2, 10)
  const inv2 = await sell([{ variantId: v2, qty: 3 }])
  eq('بی برنامه و بی تیک: فروشگاه منفی می‌رود و انبار مرکزی لمس نمی‌شود', stockOf(v2), -2)
  ok('و همان هشدار زرد همیشگی می‌آید', (inv2.stockWarnings ?? []).some((x) => x.includes('موجودی کافی نیست')))

  // تیک روشن + برنامه = تناقض، صریحاً رد می‌شود
  const v3 = makeVariant(5, 'تناقض')
  const p3 = await planFrom([{ variantId: v3, qty: 2 }], { [v3]: { primary: 'STORE' } })
  await throwsWith('تیک روشن + انتخاب انبار با هم رد می‌شود', () => sell([{ variantId: v3, qty: 2 }], { stockPlan: p3.plan, autoCentralWithdraw: true }), 'معنا ندارد')

  /**
   * اصلاح جلسه ۵۵ · کار ۴ — انتظار این بند به‌روز شد.
   *
   * تا جلسه ۵۱، فرستادن `stockPlan` از فروش تکی (`INTERNAL`) بی‌قید رد می‌شد با
   * پیام «انتخاب انبار مبدأ فقط برای «فاکتور فروش عمده» است». جلسه ۵۲ این را
   * عوض کرد: فروش تکی *می‌تواند* مبدأ بفرستد، ولی پشت قفل
   * `posCentralWithdrawToggle` سمت سرور. پس بی رمز، پیام تازه «… تأیید مدیر لازم
   * دارد» است. این تست فقط با همان رفتار جلسه ۵۲ هماهنگ شد؛ هیچ کدی عوض نشده.
   */
  const v4 = makeVariant(5, 'تکی')
  const p4 = await planFrom([{ variantId: v4, qty: 1 }], { [v4]: { primary: 'STORE' } })
  await throwsWith('پنل فروش تکی بی تأیید مدیر برنامه نمی‌پذیرد (پیام جلسه ۵۲)', () => salesService.create({
    userId, shiftId, orderType: OrderType.INTERNAL,
    lines: [{ variantId: v4, qty: 1, unitPrice: UNIT, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: UNIT }], stockPlan: p4.plan
  }), 'تأیید مدیر لازم دارد')
}

// ===========================================================================
section('بند ۱۰ · برگشت از فروش با منبع‌های چندگانه ⇒ کالا به همان انبارها')
// ===========================================================================
{
  const items = itemsOf(multi.invoiceId)
  const before = { store: stockOf(multi.variantId), r1: rowQty(multi.rc), r2: rowQty(multi.rd) }
  const ret = await salesService.createReturn({
    invoiceId: multi.invoiceId, full: false, lines: [{ saleItemId: items[0].id, qty: 3 }],
    refundMethod: RefundMethod.CASH, refundAmount: UNIT * 3, userId
  })
  eq('LIFO: اول آخرین انبار پر شد', rowQty(multi.rd), before.r2 + 2)
  eq('بعد انبار قبلی', rowQty(multi.rc), before.r1 + 1)
  eq('انبار فروشگاه در این برگشت دست‌نخورد', stockOf(multi.variantId), before.store)
  eq('تعداد برگشتی به انبارها گزارش شد', ret.restoredToWarehouses, 3)
  eq('دفتر مبدأ، برگشت را ثبت کرد', allocs(multi.invoiceId).map((x) => [x.qty, x.restoredQty]), [[2, 0], [1, 1], [2, 2]])
  ok('سابقه‌ی برگشت با اکشن تازه نوشته شد', logs(SecondaryStockAction.SALE_WHOLESALE_RESTORE).length >= 2)

  const ret2 = await salesService.createReturn({
    invoiceId: multi.invoiceId, full: false, lines: [{ saleItemId: items[0].id, qty: 2 }],
    refundMethod: RefundMethod.CASH, refundAmount: UNIT * 2, userId
  })
  eq('برگشت دوم، سهم فروشگاه را برگرداند', stockOf(multi.variantId), before.store + 2)
  eq('و بیشتر از سهم هر انبار برنگشت', [rowQty(multi.rc), rowQty(multi.rd)], [before.r1 + 1, before.r2 + 2])
  eq('دفتر کامل تسویه شد', allocs(multi.invoiceId).map((x) => x.qty - x.restoredQty), [0, 0, 0])
}

// ===========================================================================
section('بند ۱۱ · ویرایش فاکتور با منبع‌های چندگانه')
// ===========================================================================
{
  const before = { store: stockOf(mixed.a), row: rowQty(mixed.rb), bStore: stockOf(mixed.b) }
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: mixed.w })
  const base = {
    id: mixed.invoiceId, userId, orderType: OrderType.WHOLESALE, keepPayments: true,
    lines: [{ variantId: mixed.a, qty: 2, unitPrice: UNIT, discount: 0, tax: 0 }, { variantId: mixed.b, qty: 5, unitPrice: UNIT, discount: 0, tax: 0 }]
  }
  await throwsWith('ویرایشِ بی‌تعیین مبدأ رد می‌شود (هیچ حدسی زده نمی‌شود)', () => salesService.update(base), 'مبدأ کسر')
  eq('و هیچ عددی عوض نشد', [stockOf(mixed.a), rowQty(mixed.rb)], [before.store, before.row])

  const { plan } = await planFrom([{ variantId: mixed.a, qty: 2 }, { variantId: mixed.b, qty: 5 }], {
    [mixed.a]: { primary: 'STORE' }, [mixed.b]: { primary: key, decisions: [{ type: 'NEGATIVE' }] }
  })
  const up = await salesService.update({ ...base, stockPlan: plan })
  eq('سهم فروشگاه دقیقاً همان ماند (۲ برگشت، ۲ کسر)', stockOf(mixed.a), before.store)
  eq('انبار: ۳ برگشت و ۵ کسر ⇒ خالص ۲ کمتر', rowQty(mixed.rb), before.row + 3 - 5)
  eq('فروشگاهِ قلم دوم هنوز دست‌نخورده', stockOf(mixed.b), before.bStore)
  eq('دفتر مبدأ بازنویسی شد', allocs(mixed.invoiceId).map((x) => [x.variantId, x.qty, x.restoredQty]), [[mixed.a, 2, 0], [mixed.b, 5, 0]])
  ok('مبدأهای قبلی گزارش شدند', up.revertedWarehouseQty === 3, String(up.revertedWarehouseQty))
  ok('خلاصه‌ی تازه برگشت', up.stockSources?.groups?.length === 2)
}

// ===========================================================================
section('بند ۱۲ · حذف فاکتور با منبع‌های چندگانه')
// ===========================================================================
{
  const v = makeVariant(5, 'حذف')
  const w = warehouse('انبار حذف')
  const r = stockRow(v, 6, w)
  const key = optionKey({ kind: StockSourceKind.WAREHOUSE, warehouseId: w })
  const { plan } = await planFrom([{ variantId: v, qty: 6 }], { [v]: { primary: 'STORE', decisions: [{ type: 'PICK', key }] } })
  const inv = await sell([{ variantId: v, qty: 6 }], { stockPlan: plan })
  eq('پایه: فروشگاه ۵ و انبار ۱', [stockOf(v), rowQty(r)], [0, 5])
  const res = await salesService.purge({ invoiceIds: [inv.id], restoreStock: true, userId })
  eq('سهم انبار به همان انبار برگشت', rowQty(r), 6)
  eq('سهم فروشگاه به فروشگاه برگشت (نه بیشتر)', stockOf(v), 5)
  eq('تعداد برگشتی به انبارها گزارش شد', res.restoredToWarehouses, 1)
  /**
   * نشست ۱۵۹ (S159-D3): جلسه‌ی ۴۷ انتظار داشت purge دفتر مبدأ را حذف فیزیکی کند. از بند ۴-۲۲ و قاعده‌ی پایه‌ی
   * «اسناد مالی و دفتر انبار حذف فیزیکی ندارند» (رفع نشست‌های ۶۴ و ۱۲۶)، purge فقط void می‌کند و ردیف‌های
   * تخصیص مبدأ برای حسابرسی می‌مانند. پس به‌جای «۰ ردیف»، ماندن ردیف‌ها + برگشت کامل هر سهم سنجیده می‌شود.
   */
  const allocRows = seed.rows('SELECT qty, restoredQty FROM "SaleItemStockAllocation" WHERE invoiceId = ? ORDER BY id', inv.id)
  ok('دفتر مبدأ برای حسابرسی ماند (حذف فیزیکی نشد)', allocRows.length > 0, String(allocRows.length))
  ok('هر سهم دفتر مبدأ کامل برگشت‌خورده علامت خورد (دوباره‌برگشت ممکن نیست)', allocRows.every((x) => Number(x.restoredQty) === Number(x.qty)), JSON.stringify(allocRows))
  ok('خود فاکتور void شد، نه حذف', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', inv.id)?.voidedAt != null)
}

// ===========================================================================
section('بند ۱۳ · فاکتور قدیمی بدون جدول جزئیات ⇒ هیچ عددی عوض نمی‌شود')
// ===========================================================================
{
  const v = makeVariant(10, 'قدیمی')
  stockRow(v, 20)
  const inv = await sell([{ variantId: v, qty: 4 }])  // بی برنامه، بی تیک = مسیر تاریخی
  eq('کسر مثل قبل از انبار فروشگاه', stockOf(v), 6)
  eq('هیچ ردیف دفتری ساخته نشد', allocs(inv.id).length, 0)
  const items = itemsOf(inv.id)
  const ret = await salesService.createReturn({ invoiceId: inv.id, full: true, refundMethod: RefundMethod.CASH, refundAmount: UNIT * 4, userId })
  eq('برگشت مثل قبل به انبار فروشگاه', stockOf(v), 10)
  eq('و هیچ چیزی به انبارها نرفت', ret.restoredToWarehouses, 0)
  eq('انبار مرکزی یک عدد هم عوض نشد', seed.one('SELECT qty FROM "SecondaryStockItem" WHERE code = ? AND warehouseId IS NULL', codeOf(v)).qty, 20)

  // ویرایش فاکتور قدیمی: مسیر delta مو‌به‌مو دست‌نخورده
  const v2 = makeVariant(10, 'قدیمی دو')
  const inv2 = await sell([{ variantId: v2, qty: 3 }])
  eq('پایه', stockOf(v2), 7)
  await salesService.update({
    id: inv2.id, userId, orderType: OrderType.WHOLESALE, keepPayments: true,
    lines: [{ variantId: v2, qty: 5, unitPrice: UNIT, discount: 0, tax: 0 }]
  })
  eq('ویرایش فاکتور بی‌دفتر با همان delta قبل کار می‌کند', stockOf(v2), 5)
}

// ===========================================================================
section('بند ۱۴ · خلاصه‌ی کسری‌ها بعد از ثبت هم خوانده می‌شود (رسید/فهرست/گزارش)')
// ===========================================================================
{
  const s = await stockAllocationService.summaryOf(mixed.invoiceId)
  ok('خلاصه از دیتابیس خوانده می‌شود', s.groups.length === 2, JSON.stringify(s.lines))
  ok('خط کوتاه ستون ساخته می‌شود', s.short.includes('انبار مخلوط'), s.short)
  const many = await stockAllocationService.summaryForInvoices([mixed.invoiceId, multi.invoiceId])
  ok('برای چند فاکتور با هم هم کار می‌کند', !!many[mixed.invoiceId] && !!many[multi.invoiceId])
  const none = await stockAllocationService.summaryOf(999999)
  eq('فاکتور بی‌دفتر ⇒ خلاصه‌ی خالی', [none.groups.length, none.lines.length], [0, 0])
  ok('AuditLog مبدأ کسر را ثبت کرده', seed.count('AuditLog', 'action = ?', AuditAction.SALE_STOCK_SOURCE) > 0)
  ok('AuditLog برگشت مبدأ را هم ثبت کرده', seed.count('AuditLog', 'action = ?', AuditAction.SALE_STOCK_SOURCE_RESTORE) > 0)
}

console.log(`\nسوییت «از کدام انبار کسر شود؟» (جلسه ۴۷): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { console.log('\nناموفق‌ها:'); for (const f of failures) console.log(`  • ${f}`) }
console.log(`دیتابیس تست: ${process.env.HARNESS_DB}`)
process.exit(failures.length ? 1 : 0)
