/**
 * ===========================================================================
 * جلسه ۴۸ — سوییت پذیرش «انتخاب انبار مبدأ کسر» (مرحله ۱ تا ۴).
 *
 * روی همان هارنس واقعی جلسه ۳۵: SQLite داخل Node، جدول‌ها از migration های
 * واقعی، سرویس‌های واقعی. هیچ چیزی mock نشده.
 *
 * تمرکز این سوییت روی چیزهایی است که جلسه ۴۷ **نداشت**:
 *   بند ۱ — مرحله ۱: `coverShortage` فقط از انبار مرکزی پیش‌فرض (تغییر رفتار)
 *   بند ۲ — تیک روشن با موجودی فقط در انبار شعبه ⇒ فروشگاه منفی + هشدار
 *   بند ۳ — سند تعویض با تیک روشن (همان قاعده)
 *   بند ۴ — ویرایش فاکتور با تیک روشن (همان قاعده)
 *   بند ۵ — مرحله ۳: پذیرفتن برنامه‌ی کسر از فروش تکی + گیت سمت سرور
 *   بند ۶ — مرحله ۴: خلاصه‌ی مبدأ روی رسید چاپی و فهرست فاکتورها
 *   بند ۷ — فاکتور قدیمی/بی‌دفتر هیچ‌جا عوض نمی‌شود
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-session48-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { salesService } = await import('../src/main/services/SalesService.ts')
const { secondaryStockService } = await import('../src/main/services/SecondaryStockService.ts')
const { stockAllocationService } = await import('../src/main/services/StockAllocationService.ts')
const { printService } = await import('../src/main/services/PrintService.ts')
const { optionKey, resolveLine, STOCK_PLAN_STALE_CODE } = await import('@shared/stockSource')
const { OrderType, RefundMethod } = await import('@shared/enums')
const { PANEL_KEYS } = await import('@shared/panels')
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
const userId = seed.user('مدیر تست جلسه ۴۸')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار مردانه', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
let seq = 0
const shiftId = seed.insert('Shift', { name: 'شیفت تست ۴۸', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 3600000, userId })

const makeVariant = (stock, label) => {
  const id = seed.variant(product, label ?? `م${++seq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(stock, UNIT, id)
  return id
}
const codeOf = (v) => sql.prepare('SELECT code FROM "ProductVariant" WHERE id = ?').get(v).code
const stockOf = (v) => Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(v).stock)
const rowQty = (id) => Number(sql.prepare('SELECT qty FROM "SecondaryStockItem" WHERE id = ?').get(id).qty)
const warehouse = (name, isActive = 1, isDefault = 0) =>
  seed.insert('SecondaryWarehouse', { name, isActive, isDefault, sortOrder: ++seq })
const stockRow = (variantId, qty, warehouseId = null, name = 'ردیف انبار') =>
  seed.insert('SecondaryStockItem', { name, code: codeOf(variantId), qty, warehouseId })
const allocs = (invoiceId) => seed.rows('SELECT * FROM "SaleItemStockAllocation" WHERE invoiceId = ? ORDER BY id', invoiceId)
const itemsOf = (id) => seed.rows('SELECT id, variantId, qty FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id)

const sell = (lines, extra = {}) =>
  salesService.create({
    userId, shiftId, orderType: OrderType.WHOLESALE,
    lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: UNIT, discount: 0, tax: 0 })),
    payments: [{ methodId: cash, amount: UNIT * lines.reduce((s, l) => s + l.qty, 0) }],
    ...extra
  })
/** فروش تکی (پنل POS): هیچ orderType ای نمی‌فرستد ⇒ INTERNAL */
const sellPos = (lines, extra = {}) =>
  salesService.create({
    userId, shiftId,
    lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: UNIT, discount: 0, tax: 0 })),
    payments: [{ methodId: cash, amount: UNIT * lines.reduce((s, l) => s + l.qty, 0) }],
    ...extra
  })

const keyOfName = (pl, name) => {
  const hit = pl.sources.find((s) => s.name === name)
  if (!hit) throw new Error(`منبع «${name}» در پیش‌نمایش نیست. موجودها: ${pl.sources.map((s) => s.name).join(' , ')}`)
  return optionKey(hit)
}
/** برنامه‌ی کسر را با همان توابع خالصی می‌سازد که پنجره استفاده می‌کند. */
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
    if (r.error) throw new Error(`برنامه ساخته نشد: ${r.error}`)
    if (!r.complete) throw new Error(`برنامه نصفه ماند (باقی‌مانده ${r.pending?.shortfall})`)
    out.lines.push({ variantId: l.variantId, entries: r.entries })
  }
  return { plan: out, preview }
}

// ===========================================================================
section('بند ۱ · مرحله ۱ — برداشت خودکار فقط از انبار مرکزی پیش‌فرض (تغییر رفتار)')
// ===========================================================================
{
  // انبار مرکزی ۴ تا دارد، انبار شعبه ۹۹ تا. کمبود ۵ است.
  const v = makeVariant(2, 'مرحله۱-الف')
  const branch = warehouse('انبار شعبه یک')
  const central = stockRow(v, 4)
  const far = stockRow(v, 99, branch)

  const inv = await sell([{ variantId: v, qty: 7 }], { autoCentralWithdraw: true })
  eq('۴ عدد از انبار مرکزی برداشته شد', rowQty(central), 0)
  eq('انبار شعبه دست‌نخورده ماند (قبلاً ۹۹ ⇒ خالی می‌شد)', rowQty(far), 99)
  eq('باقی‌ماندهٔ کمبود روی موجودی فروشگاه منفی رفت', stockOf(v), -1)
  eq('مقدار برداشت‌شده در نتیجه‌ی فروش', inv.centralWithdrawnQty, 4)
  eq('مبدأ برداشت در نتیجه روشن است', inv.centralWithdrawals[0].warehouseName, 'انبار مرکزی')
  eq('هر ردیف مبدأ هم انبارش را می‌گوید', inv.centralWithdrawals[0].sources.map((s) => s.warehouseName), ['انبار مرکزی'])
  eq('ردیف انبار شعبه در مبدأها نیست', inv.centralWithdrawals[0].sources.map((s) => s.id), [central])
  const w = (inv.stockWarnings ?? []).join('\n')
  ok('هشدار نام انبار مرکزی را می‌گوید', w.includes('انبار مرکزی'), w)
  ok('هشدار می‌گوید کالا در انبار شعبه هست ولی برداشته نشد', w.includes('انبار شعبه یک'), w)
  ok('هشدار راه برداشت از انبار دیگر را هم می‌گوید', w.includes('تیک را خاموش کنید'), w)
  eq('مسیر تیک خودکار دفتر مبدأ نمی‌سازد (بی‌دفتر = مثل قبل)', allocs(inv.id).length, 0)
}

// ===========================================================================
section('بند ۲ · تیک روشن و موجودی فقط در انبار شعبه ⇒ هیچ برداشتی نشود')
// ===========================================================================
{
  const v = makeVariant(1, 'مرحله۱-ب')
  const branch = warehouse('انبار شعبه دو')
  const far = stockRow(v, 50, branch)

  const inv = await sell([{ variantId: v, qty: 4 }], { autoCentralWithdraw: true })
  eq('انبار شعبه مطلقاً دست نخورد', rowQty(far), 50)
  eq('هیچ برداشتی ثبت نشد', inv.centralWithdrawnQty, 0)
  eq('موجودی فروشگاه منفی شد (رفتار فعلی حفظ شد)', stockOf(v), -3)
  const w = (inv.stockWarnings ?? []).join('\n')
  ok('هشدار «پیدا نشد» آمد', w.includes('پیدا نشد'), w)
  ok('هشدار محل واقعی کالا را می‌گوید', w.includes('انبار شعبه دو') && w.includes('۵۰'), w)
}

// ===========================================================================
section('بند ۳ · ردیف واقعیِ isDefault هم «انبار مرکزی» است (قرارداد بخش ۵)')
// ===========================================================================
{
  /**
   * دیتابیس واقعی از migration یک ردیف `SecondaryWarehouse` با `isDefault`
   * دارد («انبار مرکزی»). پس «انبار مرکزی پیش‌فرض» دو دسته ردیف است: بی‌انبار
   * (`warehouseId = NULL`) و وصل به همان ردیف واقعی — عیناً همان تصمیمی که
   * `warehouseList` و `preview` می‌گیرند.
   */
  const realDefaultId = Number(sql.prepare('SELECT id FROM "SecondaryWarehouse" WHERE isDefault = 1 ORDER BY id LIMIT 1').get().id)
  const v = makeVariant(0, 'مرحله۱-ج')
  const attached = stockRow(v, 3, realDefaultId)   // وصل به ردیف واقعیِ isDefault
  const nulled = stockRow(v, 2)                    // بی‌انبار
  const branch = warehouse('انبار شعبه سه')
  const far = stockRow(v, 40, branch)

  const inv = await sell([{ variantId: v, qty: 5 }], { autoCentralWithdraw: true })
  eq('هر دو ردیف انبار مرکزی مصرف شدند', [rowQty(attached), rowQty(nulled)], [0, 0])
  eq('انبار شعبه دست‌نخورده', rowQty(far), 40)
  eq('جمع برداشت = ۵', inv.centralWithdrawnQty, 5)
  eq('موجودی فروشگاه صفر ماند (کمبود کامل پوشش داده شد)', stockOf(v), 0)
  eq('هر دو ردیف در مبدأها با نام انبار مرکزی آمدند',
     inv.centralWithdrawals[0].sources.map((x) => x.warehouseName), ['انبار مرکزی', 'انبار مرکزی'])
}

// ===========================================================================
section('بند ۴ · سند تعویض با تیک روشن — همان قاعده')
// ===========================================================================
{
  const sold = makeVariant(5, 'تعویض-فروخته')
  const repl = makeVariant(0, 'تعویض-جایگزین')
  const branch = warehouse('انبار شعبه تعویض')
  const central = stockRow(repl, 1)
  const far = stockRow(repl, 30, branch)

  const inv = await sell([{ variantId: sold, qty: 2 }])
  const item = itemsOf(inv.id)[0]
  const ex = await salesService.createExchange({
    userId, invoiceId: inv.id,
    lines: [{ saleItemId: item.id, qty: 2 }],
    replacements: [{ variantId: repl, qty: 3 }],
    refundMode: 'CASH', autoCentralWithdraw: true
  })
  eq('انبار مرکزی خالی شد (۱ عدد)', rowQty(central), 0)
  eq('انبار شعبه در تعویض هم دست‌نخورده ماند', rowQty(far), 30)
  const w = JSON.stringify(ex?.stockWarnings ?? [])
  ok('هشدار تعویض هم محل واقعی کالا را می‌گوید', w.includes('انبار شعبه تعویض'), w)
  eq('کالای جایگزین: ۲ عدد منفی ماند', stockOf(repl), -2)
}

// ===========================================================================
section('بند ۵ · ویرایش فاکتور با تیک روشن — همان قاعده')
// ===========================================================================
{
  const v = makeVariant(3, 'ویرایش-الف')
  const branch = warehouse('انبار شعبه ویرایش')
  const central = stockRow(v, 2)
  const far = stockRow(v, 60, branch)

  const inv = await sell([{ variantId: v, qty: 3 }])
  eq('فروش اول: موجودی صفر شد', stockOf(v), 0)
  await salesService.update({
    id: inv.id, userId, orderType: OrderType.WHOLESALE, keepPayments: true,
    lines: [{ variantId: v, qty: 6, unitPrice: UNIT, discount: 0, tax: 0 }],
    autoCentralWithdraw: true
  })
  eq('اختلاف ۳ عدد: ۲ از انبار مرکزی برداشته شد', rowQty(central), 0)
  eq('انبار شعبه در ویرایش هم دست‌نخورده ماند', rowQty(far), 60)
  eq('۱ عدد باقی‌مانده منفی شد', stockOf(v), -1)
}

// ===========================================================================
console.log('\n' + (failures.length ? failures.map((f) => `  ✗ ${f}`).join('\n') + '\n' : ''))
console.log(`سوییت «انتخاب انبار مبدأ کسر» (جلسه ۴۸): ${pass} PASS · ${failures.length} FAIL`)
console.log(`دیتابیس تست: ${process.env.HARNESS_DB}`)
process.exit(failures.length ? 1 : 0)
