/**
 * ===========================================================================
 * جلسه ۴۷ — سوییت منطق خالصِ «از کدام انبار کسر شود؟» (`@shared/stockSource`).
 * بی دیتابیس، بی node_modules: `node --import ./test/harness/register.mjs ...`
 * ===========================================================================
 */
const S = await import('@shared/stockSource')
const {
  StockSourceKind, STORE_SOURCE_LABEL, DEFAULT_CENTRAL_WAREHOUSE_LABEL, STOCK_PLAN_STALE_CODE,
  sourceKey, optionKey, normalizeWarehouseId, sourceLabel, resolveLine, lineIsCovered,
  normalizePlan, planShapeErrors, summarizePlan, summaryTextLines, summaryShortLine,
  planHasNegative, storeLinesOf, warehouseEntriesOf
} = S

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)

const opt = (kind, warehouseId, name, available, matched = true, rows = []) => ({
  kind, warehouseId, name, location: null, isDefaultWarehouse: warehouseId == null && kind === StockSourceKind.WAREHOUSE,
  available, rows, matched
})
const STORE = (n) => opt(StockSourceKind.STORE, null, STORE_SOURCE_LABEL, n)
const CENTRAL = (n, matched = true) => opt(StockSourceKind.WAREHOUSE, null, DEFAULT_CENTRAL_WAREHOUSE_LABEL, n, matched)
const WH = (id, name, n, matched = true) => opt(StockSourceKind.WAREHOUSE, id, name, n, matched)
const line = (requested, sources) => ({ variantId: 7, name: 'شلوار مردانه سایز ۴۰', code: 'P40', barcode: 'B40', unit: 'عدد', requested, sources })

// ===========================================================================
section('بند ۰ · کلید و برچسب منبع')
// ===========================================================================
eq('کلید فروشگاه', sourceKey(StockSourceKind.STORE, 5), 'STORE')
eq('کلید انبار پیش‌فرض (صفر ⇒ null)', sourceKey(StockSourceKind.WAREHOUSE, 0), 'WH:null')
eq('کلید انبار X', sourceKey(StockSourceKind.WAREHOUSE, 3), 'WH:3')
eq('صفر/منفی/خالی ⇒ انبار پیش‌فرض', [normalizeWarehouseId(0), normalizeWarehouseId(-2), normalizeWarehouseId(null)], [null, null, null])
eq('برچسب فروشگاه ثابت است', sourceLabel(StockSourceKind.STORE, 'هرچه'), STORE_SOURCE_LABEL)
eq('نام خالیِ انبار ⇒ انبار مرکزی', sourceLabel(StockSourceKind.WAREHOUSE, '  '), DEFAULT_CENTRAL_WAREHOUSE_LABEL)

// ===========================================================================
section('بند ۱ · موجودی کافی ⇒ هیچ سؤالی پرسیده نمی‌شود')
// ===========================================================================
{
  const l = line(3, [STORE(10), CENTRAL(5), WH(2, 'انبار شعبه', 4)])
  const r = resolveLine(l, 'STORE', [])
  ok('تمام شد', r.complete && !r.pending && !r.error)
  eq('یک ردیف کسر از فروشگاه', r.entries, [{ kind: 'STORE', warehouseId: null, warehouseName: STORE_SOURCE_LABEL, qty: 3, balanceAfter: 7, wentNegative: false }])
  ok('lineIsCovered هم همین را می‌گوید', lineIsCovered(l, 'STORE'))
  const c = resolveLine(l, 'WH:null', [])
  eq('انبار مرکزی هم بی‌سؤال تمام می‌شود', c.entries[0].warehouseName, DEFAULT_CENTRAL_WAREHOUSE_LABEL)
  const x = resolveLine(l, 'WH:2', [])
  eq('انبار X هم', [x.complete, x.entries[0].warehouseId, x.entries[0].qty], [true, 2, 3])
}

// ===========================================================================
section('بند ۲ · کسری ⇒ سؤال با فهرست انبارهای دارای همین کالا')
// ===========================================================================
let short = null
{
  const l = line(5, [STORE(2), CENTRAL(4), WH(2, 'انبار شعبه', 1), WH(3, 'انبار خالی', 0), WH(4, 'انبار بی‌ربط', 9, false)])
  short = l
  const r = resolveLine(l, 'STORE', [])
  ok('زنجیره متوقف شد و سؤال باز است', !r.complete && !!r.pending)
  eq('انباری که کسری آورد', r.pending.source.name, STORE_SOURCE_LABEL)
  eq('چه مقدار برداشته شد', r.pending.taken, 2)
  eq('چه مقدار مانده', r.pending.shortfall, 3)
  eq('فقط انبارهایی که کالا را دارند و موجودی‌شان > صفر', r.pending.candidates.map((c) => c.name), ['انبار مرکزی', 'انبار شعبه'])
  ok('انبار با موجودی صفر پیشنهاد نمی‌شود', !r.pending.candidates.some((c) => c.name === 'انبار خالی'))
  ok('انباری که تطبیق نخورده پیشنهاد نمی‌شود', !r.pending.candidates.some((c) => c.name === 'انبار بی‌ربط'))
  eq('تا اینجا فقط ردیف فروشگاه ثبت شده', r.entries.length, 1)
}

// ===========================================================================
section('بند ۳ · «بله» ⇒ انتخاب انبار دیگر و برداشت باقی‌مانده')
// ===========================================================================
{
  const r = resolveLine(short, 'STORE', [{ type: 'PICK', key: 'WH:null' }])
  ok('این‌بار تمام شد', r.complete && !r.pending)
  eq('دو منبع، به ترتیب', r.entries.map((e) => [e.warehouseName, e.qty, e.wentNegative]), [[STORE_SOURCE_LABEL, 2, false], [DEFAULT_CENTRAL_WAREHOUSE_LABEL, 3, false]])
  eq('جمع کسر = تعداد فروش', r.entries.reduce((s, e) => s + e.qty, 0), 5)
  eq('مانده‌ی انبار مرکزی بعد از کسر', r.entries[1].balanceAfter, 1)
}

// ===========================================================================
section('بند ۴ · کسری در انبار دوم ⇒ همان سؤال، این‌بار بین انبارهای باقی‌مانده')
// ===========================================================================
{
  const r1 = resolveLine(short, 'STORE', [{ type: 'PICK', key: 'WH:2' }])
  ok('انبار شعبه هم کافی نبود ⇒ سؤال دوم', !r1.complete && !!r1.pending)
  eq('سؤال دوم روی انبار شعبه است', r1.pending.source.name, 'انبار شعبه')
  eq('باقی‌مانده بعد از دو انبار', r1.pending.shortfall, 2)
  eq('انبارهای مصرف‌شده دوباره پیشنهاد نمی‌شوند', r1.pending.candidates.map((c) => c.name), ['انبار مرکزی'])
  const r2 = resolveLine(short, 'STORE', [{ type: 'PICK', key: 'WH:2' }, { type: 'PICK', key: 'WH:null' }])
  ok('با انتخاب سوم تمام شد', r2.complete)
  eq('سه منبع برای یک قلم', r2.entries.map((e) => [e.warehouseName, e.qty]), [[STORE_SOURCE_LABEL, 2], ['انبار شعبه', 1], [DEFAULT_CENTRAL_WAREHOUSE_LABEL, 2]])
  ok('هیچ‌کدام منفی نشد', !r2.entries.some((e) => e.wentNegative))
}

// ===========================================================================
section('بند ۵ · «نه» ⇒ باقی‌مانده از همان آخرین انبار، با موجودی منفی')
// ===========================================================================
{
  const r = resolveLine(short, 'STORE', [{ type: 'NEGATIVE' }])
  ok('تمام شد', r.complete)
  eq('یک ردیف، روی همان فروشگاه، با کل تعداد', r.entries, [{ kind: 'STORE', warehouseId: null, warehouseName: STORE_SOURCE_LABEL, qty: 5, balanceAfter: -3, wentNegative: true }])
  const r2 = resolveLine(short, 'STORE', [{ type: 'PICK', key: 'WH:2' }, { type: 'NEGATIVE' }])
  eq('«نه» روی انبار دوم ⇒ همان انبار منفی می‌رود', r2.entries.map((e) => [e.warehouseName, e.qty, e.balanceAfter, e.wentNegative]), [[STORE_SOURCE_LABEL, 2, 0, false], ['انبار شعبه', 3, -2, true]])
}

// ===========================================================================
section('بند ۶ · کالایی که هیچ انبار دیگری ندارد ⇒ سؤال «از دیگری؟» پرسیده نمی‌شود')
// ===========================================================================
{
  const l = line(4, [STORE(1), CENTRAL(0, false), WH(2, 'انبار شعبه', 7, false)])
  const r = resolveLine(l, 'STORE', [])
  ok('سؤال باز است', !!r.pending)
  eq('هیچ گزینه‌ای برای پیشنهاد نیست ⇒ فقط تأیید منفی', r.pending.candidates, [])
  const n = resolveLine(l, 'STORE', [{ type: 'NEGATIVE' }])
  eq('با تأیید صریح، منفی ثبت می‌شود', [n.complete, n.entries[0].qty, n.entries[0].balanceAfter, n.entries[0].wentNegative], [true, 4, -3, true])
}

// ===========================================================================
section('بند ۷ · خطاهای شکلی — هیچ‌وقت بی‌صدا')
// ===========================================================================
{
  ok('کلید ناشناس ⇒ خطا', !!resolveLine(short, 'WH:99', []).error)
  ok('انتخاب انباری که کالا را ندارد ⇒ خطا', !!resolveLine(short, 'STORE', [{ type: 'PICK', key: 'WH:4' }]).error)
  ok('بی انتخاب اول، هیچ چیزی ساخته نمی‌شود', resolveLine(short, null, []).entries.length === 0)
  eq('کد خطای کهنگی ثابت است', STOCK_PLAN_STALE_CODE, 'STOCK_PLAN_STALE')
}

// ===========================================================================
section('بند ۸ · نرمال‌سازی و اعتبارسنجی شکلیِ برنامه')
// ===========================================================================
{
  const raw = { lines: [{ variantId: 7, entries: [{ kind: 'WAREHOUSE', warehouseId: 0, qty: 2 }, { kind: 'STORE', warehouseId: 9, qty: 1 }, { kind: 'STORE', qty: 0 }] }, { variantId: 0, entries: [] }] }
  const p = normalizePlan(raw)
  eq('ردیف بی‌تعداد و کالای بی‌شناسه حذف می‌شوند', p.lines.length, 1)
  eq('warehouseId صفر ⇒ انبار پیش‌فرض', p.lines[0].entries[0].warehouseId, null)
  eq('منبع فروشگاه هیچ‌وقت warehouseId ندارد', p.lines[0].entries[1].warehouseId, null)
  eq('برنامه‌ی خالی ⇒ null', normalizePlan({ lines: [] }), null)
  eq('برنامه‌ی درست ⇒ بی خطا', planShapeErrors(p, [{ variantId: 7, qty: 3, name: 'شلوار' }]), [])
  ok('جمع کمتر از تعداد فروش ⇒ خطا', planShapeErrors(p, [{ variantId: 7, qty: 5, name: 'شلوار' }]).some((e) => e.includes('کامل نیست')))
  ok('کالایی که برنامه ندارد ⇒ خطا', planShapeErrors(p, [{ variantId: 7, qty: 3 }, { variantId: 8, qty: 1, name: 'پیراهن' }]).some((e) => e.includes('هیچ انباری انتخاب نشده')))
  ok('کالایی که در فاکتور نیست ⇒ خطا', planShapeErrors(p, [{ variantId: 9, qty: 3 }]).some((e) => e.includes('در فاکتور نیست')))
  ok('منبع تکراری در یک قلم ⇒ خطا', planShapeErrors({ lines: [{ variantId: 7, entries: [{ kind: 'STORE', warehouseId: null, warehouseName: 'ف', qty: 1, balanceAfter: 0, wentNegative: false }, { kind: 'STORE', warehouseId: null, warehouseName: 'ف', qty: 1, balanceAfter: 0, wentNegative: false }] }] }, [{ variantId: 7, qty: 2 }]).some((e) => e.includes('دو بار')))
  eq('برنامه‌ی خالی هم پیام روشن دارد', planShapeErrors(null, []).length, 1)
}

// ===========================================================================
section('بند ۹ · خلاصه‌ی کسری‌ها (بند ۳ پرامپت)')
// ===========================================================================
{
  const plan = { lines: [
    { variantId: 7, entries: [
      { kind: 'STORE', warehouseId: null, warehouseName: STORE_SOURCE_LABEL, qty: 2, balanceAfter: 0, wentNegative: false },
      { kind: 'WAREHOUSE', warehouseId: 2, warehouseName: 'انبار X', qty: 3, balanceAfter: -2, wentNegative: true }
    ] },
    { variantId: 8, entries: [{ kind: 'WAREHOUSE', warehouseId: 2, warehouseName: 'انبار X', qty: 1, balanceAfter: 4, wentNegative: false }] }
  ] }
  const nameOf = (id) => (id === 7 ? 'شلوار' : 'پیراهن')
  const g = summarizePlan(plan, nameOf)
  eq('گروه‌بندی به تفکیک انبار، فروشگاه اول', g.map((x) => x.warehouseName), [STORE_SOURCE_LABEL, 'انبار X'])
  eq('جمع هر انبار', g.map((x) => x.totalQty), [2, 4])
  eq('تعداد منفی‌شده‌ها', g.map((x) => x.negativeCount), [0, 1])
  eq('دو کالای یک انبار با هم دیده می‌شوند', g[1].rows.map((r) => r.itemName), ['شلوار', 'پیراهن'])
  const lines = summaryTextLines(g)
  ok('جمله‌ی نمونه‌ی خواسته‌ی مالک ساخته می‌شود («انبار X: … بعد از کسر ۲−»)', lines[1] === 'انبار X: شلوار 3 (بعد از کسر 2−) · پیراهن 1 (بعد از کسر 4)', lines[1])
  ok('خط کوتاه ستون، منفی را با ⚠ علامت می‌زند', summaryShortLine(g).includes('انبار X 4 ⚠'), summaryShortLine(g))
  ok('planHasNegative درست است', planHasNegative(plan) && !planHasNegative({ lines: [{ variantId: 1, entries: [{ kind: 'STORE', warehouseId: null, warehouseName: 'ف', qty: 1, balanceAfter: 1, wentNegative: false }] }] }))
  eq('سهم انبار فروشگاه جدا می‌شود', storeLinesOf(plan), [{ variantId: 7, qty: 2 }])
  eq('سهم انبارها جدا می‌شود', warehouseEntriesOf(plan).map((x) => [x.variantId, x.entry.qty]), [[7, 3], [8, 1]])
  eq('خلاصه‌ی برنامه‌ی خالی، خالی است', summarizePlan(null, nameOf), [])
}

console.log(`\nمنطق خالص «انتخاب انبار مبدأ» (جلسه ۴۷): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { console.log('\nناموفق‌ها:'); for (const f of failures) console.log(`  • ${f}`) }
process.exit(failures.length ? 1 : 0)
