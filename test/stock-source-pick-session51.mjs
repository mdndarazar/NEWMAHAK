/**
 * ===========================================================================
 * جلسه ۵۱ · مرحله ۲-الف — سوییت منطق خالصِ «انتخاب انبار مبدأ کسر در فاکتور
 * فروش عمده» + ممیزی ایستای اتصال صفحه.
 * بی دیتابیس، بی node_modules: `node --import ./test/harness/register.mjs ...`
 * ===========================================================================
 */
import { readFileSync } from 'node:fs'

const S = await import('@shared/stockSource')
const {
  StockSourceKind, STORE_SOURCE_LABEL, DEFAULT_CENTRAL_WAREHOUSE_LABEL, STOCK_PLAN_STALE_CODE,
  STOCK_PICK_TEXT, STORE_PICK_KEY, sourceKey, optionKey,
  stockPickOptions, buildSingleSourcePlan, planShapeErrors,
  shortageHeadline, shortageTextLines,
  isStalePlanMessage, planShortLine, stockPathFor, summarizePlan,
  resolveChain, pendingQuestionText
} = S
const { faDigits } = await import('@shared/jalali')

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)

const W = StockSourceKind.WAREHOUSE
const ST = StockSourceKind.STORE
/** یک گزینه‌ی منبع، عیناً شکل `StockSourceOption` خروجی `preview` */
const src = (kind, warehouseId, name, available, matched = true) => ({
  kind, warehouseId, name, location: null,
  isDefaultWarehouse: kind === W && warehouseId == null,
  available, rows: [], matched
})
/** یک قلم پیش‌نمایش، عیناً شکل `StockSourceLine` */
const line = (variantId, name, requested, sources) => ({
  variantId, name, code: `c${variantId}`, barcode: null, unit: 'عدد', requested, sources
})
/** سه منبعِ همیشگی: فروشگاه ۵ · انبار مرکزی ۳ · انبار شعبه(۴) ۱۰ */
const trio = (store = 5, central = 3, branch = 10) => [
  src(ST, null, STORE_SOURCE_LABEL, store),
  src(W, null, DEFAULT_CENTRAL_WAREHOUSE_LABEL, central),
  src(W, 4, 'انبار شعبه', branch)
]
const KEY_STORE = STORE_PICK_KEY
const KEY_CENTRAL = sourceKey(W, null)
const KEY_BRANCH = sourceKey(W, 4)

section('بند ۱ · منوی «کسر از انبار» از همان `warehouseList`')
eq('کلید فروشگاه همان قرارداد است', KEY_STORE, 'STORE')
eq('فهرست خالی ⇒ فروشگاه + انبار مرکزی پیش‌فرض',
  stockPickOptions([]).map((o) => [o.key, o.name]),
  [['STORE', STORE_SOURCE_LABEL], ['WH:null', DEFAULT_CENTRAL_WAREHOUSE_LABEL]])
eq('null هم بی‌صدا همان دو گزینه', stockPickOptions(null).map((o) => o.key), ['STORE', 'WH:null'])
{
  const rows = [
    { id: 0, name: 'انبار مرکزی', isDefault: true, isActive: true, location: null },
    { id: 4, name: 'انبار شعبه', isDefault: false, isActive: true, location: 'بازار' },
    { id: 5, name: 'انبار بسته', isDefault: false, isActive: false, location: null }
  ]
  const o = stockPickOptions(rows)
  eq('انبار غیرفعال گزینه نمی‌شود', o.map((x) => x.key), ['STORE', 'WH:null', 'WH:4'])
  eq('نام و محل انبار X', [o[2].name, o[2].location], ['انبار شعبه', 'بازار'])
  ok('فقط انبار پیش‌فرض علامت پیش‌فرض دارد', o.filter((x) => x.isDefaultWarehouse).length === 1)
}
{
  // ⚠️ قرارداد بخش ۵: انبار پیش‌فرض همیشه `WH:null` است، حتی با ردیف واقعی
  const o = stockPickOptions([
    { id: 1, name: 'انبار اصلی', isDefault: true, isActive: true },
    { id: 2, name: 'انبار دو', isDefault: false, isActive: true }
  ])
  eq('ردیف واقعیِ پیش‌فرض هم کلیدش WH:null است', o.map((x) => x.key), ['STORE', 'WH:null', 'WH:2'])
  eq('ولی نامش از همان ردیف خوانده می‌شود', o[1].name, 'انبار اصلی')
}
ok('هر کلید منو در `sources` همان قلم پیدا می‌شود',
  stockPickOptions([{ id: 0, isDefault: true, isActive: true, name: DEFAULT_CENTRAL_WAREHOUSE_LABEL }, { id: 4, name: 'انبار شعبه', isActive: true }])
    .every((o) => trio().some((s) => optionKey(s) === o.key)))

section('بند ۲ · موجودی کافی — هیچ سؤالی پرسیده نمی‌شود')
{
  const d = buildSingleSourcePlan([line(1, 'شلوار', 4, trio())], KEY_STORE)
  ok('فروشگاه کافی ⇒ برنامه آماده', d.complete && d.plan != null && !d.shortages.length)
  eq('یک ردیف از انبار فروشگاه', d.plan.lines, [{ variantId: 1, entries: [{ kind: ST, warehouseId: null, warehouseName: STORE_SOURCE_LABEL, qty: 4, balanceAfter: 1, wentNegative: false }] }])
  eq('شکل برنامه بی‌خطاست', planShapeErrors(d.plan, [{ variantId: 1, qty: 4, name: 'شلوار' }]), [])
}
{
  const d = buildSingleSourcePlan([line(1, 'شلوار', 4, trio())], KEY_BRANCH)
  ok('انبار X کافی ⇒ برنامه آماده', d.complete && !d.shortages.length)
  eq('کسر از همان انبار X', d.plan.lines[0].entries, [{ kind: W, warehouseId: 4, warehouseName: 'انبار شعبه', qty: 4, balanceAfter: 6, wentNegative: false }])
}
eq('انبار مرکزی پیش‌فرض ⇒ warehouseId = null',
  buildSingleSourcePlan([line(1, 'شلوار', 3, trio())], KEY_CENTRAL).plan.lines[0].entries[0].warehouseId, null)
{
  const d = buildSingleSourcePlan([line(1, 'الف', 2, trio()), line(2, 'ب', 3, trio())], KEY_BRANCH)
  eq('چند قلم، همه از یک انبار', d.plan.lines.map((l) => [l.variantId, l.entries[0].qty]), [[1, 2], [2, 3]])
}
eq('قلم با تعداد صفر نادیده گرفته می‌شود',
  buildSingleSourcePlan([line(1, 'الف', 0, trio())], KEY_STORE).plan, null)
eq('کلید ناشناس ⇒ خطای روشن، بی برنامه',
  buildSingleSourcePlan([line(1, 'الف', 1, trio())], 'WH:99').errors.length, 1)

section('بند ۳ · کمبود در انبار انتخاب‌شده (کاوش، بی هیچ نوشتنی)')
{
  const probe = buildSingleSourcePlan([line(1, 'شلوار', 8, trio())], KEY_STORE)
  ok('برنامه نیمه‌کاره فرستاده نمی‌شود', probe.plan === null && !probe.complete)
  eq('یک قلم کسری‌دار', probe.shortages.length, 1)
  const s0 = probe.shortages[0]
  eq('عددهای کسری', [s0.requested, s0.available, s0.taken, s0.shortfall], [8, 5, 5, 3])
  eq('انبار کسری‌دار همان انتخاب کاربر است', [s0.sourceKey, s0.sourceName], [KEY_STORE, STORE_SOURCE_LABEL])
  eq('انبارهای دارای همین کالا برای *نمایش*', s0.candidates.map((c) => c.key), [KEY_CENTRAL, KEY_BRANCH])
  ok('خط توضیح نام کالا و انبار را می‌گوید',
    shortageTextLines(probe.shortages, faDigits)[0].includes('شلوار') && shortageTextLines(probe.shortages, faDigits)[0].includes(STORE_SOURCE_LABEL))
  ok('انبارهای دارای کالا در همان خط دیده می‌شوند', shortageTextLines(probe.shortages, faDigits)[0].includes('انبار شعبه'))
  ok('سرجمله‌ی یک‌قلمی', shortageHeadline(probe.shortages).includes('«شلوار»'))
  ok('عددها فارسی‌اند', shortageTextLines(probe.shortages, faDigits)[0].includes('۸'))
}
eq('بی کسری ⇒ هیچ متنی ساخته نمی‌شود', [shortageHeadline([]), shortageTextLines([])], ['', []])
ok('سرجمله‌ی چندقلمی تعداد قلم را می‌گوید',
  shortageHeadline(buildSingleSourcePlan([line(1, 'الف', 9, trio()), line(2, 'ب', 9, trio())], KEY_CENTRAL).shortages, faDigits).includes('۲ قلم'))

section('بند ۴ · «ادامه با منفی» — باقی‌مانده روی همان انبار انتخاب‌شده')
{
  const d = buildSingleSourcePlan([line(1, 'شلوار', 8, trio())], KEY_STORE, { allowNegative: true })
  ok('برنامه کامل می‌شود', d.complete && !d.shortages.length)
  eq('همان انبار منفی می‌شود، نه انبار دیگری', d.plan.lines[0].entries,
    [{ kind: ST, warehouseId: null, warehouseName: STORE_SOURCE_LABEL, qty: 8, balanceAfter: -3, wentNegative: true }])
  eq('شکل برنامه بی‌خطاست', planShapeErrors(d.plan, [{ variantId: 1, qty: 8, name: 'شلوار' }]), [])
}
{
  const d = buildSingleSourcePlan([line(1, 'شلوار', 12, trio())], KEY_BRANCH, { allowNegative: true })
  eq('انبار X هم همین‌طور منفی می‌شود', [d.plan.lines[0].entries[0].warehouseId, d.plan.lines[0].entries[0].qty, d.plan.lines[0].entries[0].balanceAfter, d.plan.lines[0].entries[0].wentNegative], [4, 12, -2, true])
  ok('هیچ انبار دومی به برنامه اضافه نشده', d.plan.lines[0].entries.length === 1)
}
{
  // انباری که این کالا را اصلاً ندارد (تطبیق متنی صفر) — سرور ردیف تازه‌ی منفی می‌سازد
  const none = [src(ST, null, STORE_SOURCE_LABEL, 0), src(W, 7, 'انبار خالی', 0, false)]
  const probe = buildSingleSourcePlan([line(1, 'کالا', 2, none)], sourceKey(W, 7))
  eq('کالای ناموجود در آن انبار ⇒ کسری کامل و بی کاندید', [probe.shortages[0].shortfall, probe.shortages[0].candidates.length], [2, 0])
  const d = buildSingleSourcePlan([line(1, 'کالا', 2, none)], sourceKey(W, 7), { allowNegative: true })
  eq('با تأیید، همان انبار منفی می‌شود', [d.plan.lines[0].entries[0].warehouseId, d.plan.lines[0].entries[0].qty, d.plan.lines[0].entries[0].wentNegative], [7, 2, true])
}
{
  const d = buildSingleSourcePlan([line(1, 'الف', 9, trio()), line(2, 'ب', 2, trio())], KEY_STORE, { allowNegative: true })
  eq('قلم کافی و قلم کسری در یک برنامه', d.plan.lines.map((l) => [l.variantId, l.entries[0].qty, l.entries[0].wentNegative]), [[1, 9, true], [2, 2, false]])
  eq('شکل برنامه بی‌خطاست', planShapeErrors(d.plan, [{ variantId: 1, qty: 9 }, { variantId: 2, qty: 2 }]), [])
  ok('ناسازگاری تعداد گرفته می‌شود', planShapeErrors(d.plan, [{ variantId: 1, qty: 8 }, { variantId: 2, qty: 2 }]).length === 1)
}

section('بند ۵ · خلاصه‌ی مبدأ کسر (همان `summarizePlan`)')
{
  const d = buildSingleSourcePlan([line(1, 'شلوار', 8, trio()), line(2, 'پیراهن', 2, trio())], KEY_BRANCH, { allowNegative: true })
  const nameOf = (id) => (id === 1 ? 'شلوار' : 'پیراهن')
  eq('یک گروه، چون همه از یک انبار', summarizePlan(d.plan, nameOf).length, 1)
  eq('خط کوتاه خلاصه', planShortLine(d.plan, nameOf, faDigits), 'انبار شعبه ۱۰')
  const neg = buildSingleSourcePlan([line(1, 'شلوار', 12, trio())], KEY_BRANCH, { allowNegative: true })
  ok('منفی با ⚠ علامت می‌خورد', planShortLine(neg.plan, nameOf, faDigits).includes('⚠'))
}
eq('برنامه‌ی خالی ⇒ خط خالی (فاکتور قدیمی بی دفتر)', planShortLine(null, () => '', faDigits), '')
eq('گروه‌بندی برنامه‌ی خالی', summarizePlan(null, () => ''), [])

section('بند ۶ · `STOCK_PLAN_STALE` — پنجره دوباره اجرا شود')
ok('پیام سرور شناخته می‌شود', isStalePlanMessage(`${STOCK_PLAN_STALE_CODE}: موجودی عوض شده است.`))
ok('شیء Error هم شناخته می‌شود', isStalePlanMessage(new Error(`${STOCK_PLAN_STALE_CODE}: …`)))
ok('خطای بی‌ربط تشخیص داده نمی‌شود', !isStalePlanMessage('برنامه‌ی کسر موجودی خالی است.'))
ok('null/undefined بی‌صدا false', !isStalePlanMessage(null) && !isStalePlanMessage(undefined))

section('بند ۷ · مسیر ثبت — قاعده‌ی نهایی مالک')
const path = (o) => stockPathFor({ deductInventory: true, storePicked: true, autoCentral: false, editing: false, hasLedger: false, ...o })
{
  const p = path({ autoCentral: true })
  ok('تیک روشن + انبار فروشگاه ⇒ رفتار خودکار قبلی، بی هیچ سؤالی', p.autoPath && !p.planPath)
}
ok('تیک خاموش + فروشگاه ⇒ زنجیره‌ی کسری (برنامه)', path({}).planPath && !path({}).autoPath)
{
  const p = path({ storePicked: false, autoCentral: true })
  ok('انبار مرکزی/X ⇒ تیک بی‌اثر و برنامه فرستاده می‌شود', !p.autoAllowed && !p.autoPath && p.planPath)
}
ok('تیک فقط برای انبار فروشگاه فعال است', path({}).autoAllowed && !path({ storePicked: false }).autoAllowed)
ok('«کسر از موجودی انبار» خاموش ⇒ هیچ برنامه‌ای', !path({ deductInventory: false, storePicked: false }).planPath)
{
  const p = path({ editing: true, hasLedger: true, autoCentral: true })
  ok('ویرایش فاکتور دفتردار همیشه با برنامه می‌رود', p.planPath && !p.autoPath && !p.legacyEdit)
}
{
  const p = path({ editing: true, hasLedger: false })
  ok('فاکتور قدیمی بی‌دفتر ⇒ مسیر قدیمی، بی برنامه (وگرنه کسر دوباره)', p.legacyEdit && !p.planPath)
}

section('بند ۸ · زنجیره‌ی سؤال‌ها (مرحله ۲-ب) — همه‌ی اقلام در یک پنجره')
{
  const previewLines = [line(1, 'شلوار', 8, trio()), line(2, 'پیراهن', 2, trio())]
  const none = resolveChain(previewLines, KEY_STORE)
  eq('فقط قلمِ کسری‌دار سؤال باز دارد', none.open.map((r) => r.variantId), [1])
  ok('تا جواب نگیرد برنامه نمی‌دهد', none.plan === null && !none.complete)
  ok('قلم کافی همان‌جا «تمام» است', none.lines.find((r) => r.variantId === 2).complete)
  ok('متن سؤال کسری و برداشت را می‌گوید',
    pendingQuestionText(none.open[0], faDigits).includes('کسری ۳') && pendingQuestionText(none.open[0], faDigits).includes(STORE_SOURCE_LABEL))
  eq('کاندیدهای پنجره = انبارهای دارای همین کالا', none.open[0].pending.candidates.map((c) => optionKey(c)), [KEY_CENTRAL, KEY_BRANCH])

  // ← «انتخاب یکی از انبارها»: کسری ۳ از انبار مرکزی (موجودی ۳) ⇒ همین‌جا تمام می‌شود
  const picked = resolveChain(previewLines, KEY_STORE, (id) => (id === 1 ? [{ type: 'PICK', key: KEY_CENTRAL }] : []))
  ok('انتخاب انبار دیگر ⇒ زنجیره تمام و برنامه آماده', picked.complete && picked.plan != null && !picked.open.length)
  eq('برنامه دو مبدأ برای همان قلم دارد', picked.plan.lines.find((l) => l.variantId === 1).entries.map((e) => [e.warehouseName, e.qty, e.wentNegative]),
    [[STORE_SOURCE_LABEL, 5, false], [DEFAULT_CENTRAL_WAREHOUSE_LABEL, 3, false]])
  eq('خلاصه به تفکیک انبار (قبل از تأیید نهایی)', summarizePlan(picked.plan, (id) => (id === 1 ? 'شلوار' : 'پیراهن')).map((g) => [g.warehouseName, g.totalQty]),
    [[STORE_SOURCE_LABEL, 7], [DEFAULT_CENTRAL_WAREHOUSE_LABEL, 3]])
  eq('شکل برنامه بی‌خطاست', planShapeErrors(picked.plan, [{ variantId: 1, qty: 8 }, { variantId: 2, qty: 2 }]), [])

  // ← «اگر آن هم تمام شد، دوباره همین سؤال»
  const big = [line(1, 'شلوار', 20, trio()), line(2, 'پیراهن', 2, trio())]
  const step1 = resolveChain(big, KEY_STORE, () => [{ type: 'PICK', key: KEY_CENTRAL }])
  eq('انبار دوم هم کم آورد ⇒ سؤال دوباره', step1.open.map((r) => [r.variantId, r.pending.shortfall]), [[1, 12]])
  eq('سؤال دوم از همان انبار دوم پرسیده می‌شود', step1.open[0].pending.source.name, DEFAULT_CENTRAL_WAREHOUSE_LABEL)
  eq('انبار مصرف‌شده دوباره کاندید نمی‌شود', step1.open[0].pending.candidates.map((c) => optionKey(c)), [KEY_BRANCH])
  // ۵ + ۳ + ۱۰ = ۱۸ ⇒ زنجیره‌ی سه‌مرحله‌ای دقیقاً تمام می‌شود
  const exact = [line(1, 'شلوار', 18, trio()), line(2, 'پیراهن', 2, trio())]
  const step2 = resolveChain(exact, KEY_STORE, (id) => (id === 1 ? [{ type: 'PICK', key: KEY_CENTRAL }, { type: 'PICK', key: KEY_BRANCH }] : []))
  ok('سه انبار پشت سر هم ⇒ زنجیره تمام', step2.complete && step2.plan != null)
  eq('سهم هر انبار به ترتیب انتخاب', step2.plan.lines.find((l) => l.variantId === 1).entries.map((e) => e.qty), [5, 3, 10])
  ok('هیچ‌کدام منفی نشد', step2.plan.lines.every((l) => l.entries.every((e) => !e.wentNegative)))

  // ← «ادامه با منفی شدن همان انبار» در هر مرحله
  const neg = resolveChain(big, KEY_STORE, (id) => (id === 1 ? [{ type: 'PICK', key: KEY_CENTRAL }, { type: 'NEGATIVE' }] : []))
  eq('منفی روی همان انبارِ آخرِ زنجیره می‌نشیند', neg.plan.lines.find((l) => l.variantId === 1).entries.map((e) => [e.warehouseName, e.qty, e.wentNegative]),
    [[STORE_SOURCE_LABEL, 5, false], [DEFAULT_CENTRAL_WAREHOUSE_LABEL, 15, true]])
  ok('«یک قدم به عقب» شمرده می‌شود', neg.lines.find((l) => l.variantId === 1).steps === 2)

  // ← دو قلم کسری‌دار، هر دو در همان یک پنجره
  const two = [line(1, 'شلوار', 9, trio()), line(2, 'پیراهن', 9, trio())]
  eq('دو سؤال باز با هم', resolveChain(two, KEY_STORE).open.map((r) => r.variantId), [1, 2])
  const half = resolveChain(two, KEY_STORE, (id) => (id === 1 ? [{ type: 'NEGATIVE' }] : []))
  ok('جواب یک قلم، قلم دیگر را تمام نمی‌کند', half.open.map((r) => r.variantId).join() === '2' && !half.complete && half.plan === null)
  const both = resolveChain(two, KEY_STORE, () => [{ type: 'NEGATIVE' }])
  ok('هر دو جواب گرفتند ⇒ برنامه آماده', both.complete && both.plan.lines.length === 2)
  ok('⚠ منفی در خلاصه دیده می‌شود', planShortLine(both.plan, (id) => String(id), faDigits).includes('⚠'))
}
{
  // انبار انتخابی که کالا را ندارد ⇒ بی کاندید، فقط «ادامه با منفی»
  const none = [src(ST, null, STORE_SOURCE_LABEL, 0), src(W, 7, 'انبار خالی', 0, false)]
  const c = resolveChain([line(1, 'کالا', 2, none)], sourceKey(W, 7))
  eq('هیچ کاندیدی نیست', c.open[0].pending.candidates.length, 0)
  eq('نام مبدأ روی همان قلم', c.open[0].primaryName, 'انبار خالی')
}
eq('قلم صفر در زنجیره نمی‌آید', resolveChain([line(1, 'الف', 0, trio())], KEY_STORE).lines.length, 0)
eq('کلید ناشناس ⇒ خطای زنجیره', resolveChain([line(1, 'الف', 1, trio())], 'WH:99').errors.length, 1)
eq('بی قلم ⇒ برنامه‌ای هم نیست', [resolveChain([], KEY_STORE).plan, resolveChain(null, KEY_STORE).complete], [null, true])
eq('سؤال بسته متن ندارد', pendingQuestionText({ pending: null, itemName: 'x', unit: 'عدد', requested: 1, entries: [], complete: true, error: null, steps: 0, variantId: 1, primaryName: '' }), '')

section('بند ۹ · ممیزی ایستای اتصال صفحه و پنجره')
const page = readFileSync(new URL('../src/renderer/src/pages/SalesInvoice.tsx', import.meta.url), 'utf8')
const has = (n, needle) => ok(n, page.includes(needle), `«${needle}» در SalesInvoice.tsx نیست`)
has('منوی انتخاب انبار وصل است', 'setStockSourceKey(e.target.value)')
has('گزینه‌ها از `stockPickOptions` می‌آیند', 'stockPickOptions(warehouseList)')
has('فهرست انبارها از همان `warehouseList` موجود', 'CH.secondaryWarehouseList')
has('پیش‌نمایش قبل از ثبت صدا زده می‌شود', 'CH.stockSourcePreview')
has('برنامه با تیک خاموش فرستاده می‌شود', 'autoCentralWithdraw: stockPlan ? false : autoCentral')
has('برنامه در payload می‌نشیند', '...(stockPlan ? { stockPlan } : {})')
has('لغو ⇒ هیچ ثبتی', 'flash(STOCK_PICK_TEXT.cancelled)')
has('خطای کهنگی ⇒ اجرای دوباره', 'isStalePlanMessage(e)')
has('تیک خودکار برای انبار مرکزی/X غیرفعال', '|| !autoAllowed')
has('`ManagerGate` تیک دست‌نخورده است', 'panel={PANEL_KEYS.posCentralWithdrawToggle}')
has('میان‌برها و بارکدخوان با پنجره خاموش می‌شوند', 'stockChain != null')
has('پنجره‌ی زنجیره‌ای به صفحه وصل است', '<StockSourceModal')
has('لغو پنجره ⇒ ثبت نشدن', 'stockChain?.decide(null)')
has('دفتر مبدأ فاکتورِ در حال ویرایش خوانده می‌شود', 'CH.saleStockSources')
has('خلاصه‌ی کسر بعد از ثبت نشان داده می‌شود', 'STOCK_PICK_TEXT.summaryTitle')
{
  const modal = readFileSync(new URL('../src/renderer/src/components/StockSourceModal.tsx', import.meta.url), 'utf8')
  const hasM = (n, needle) => ok(n, modal.includes(needle), `«${needle}» در StockSourceModal.tsx نیست`)
  hasM('زنجیره با تابع مشترک جلو می‌رود (نه منطق تازه)', 'resolveChain(')
  hasM('انتخاب انبار دیگر ⇒ تصمیم PICK', "type: 'PICK', key: optionKey(c)")
  hasM('ادامه با منفی ⇒ تصمیم NEGATIVE', "type: 'NEGATIVE'")
  hasM('خلاصه‌ی کسری‌ها قبل از تأیید نهایی', 'summaryTextLines(summarizePlan(')
  hasM('لغو کل فاکتور در هر مرحله', 'STOCK_SOURCE_TEXT.cancelAll')
  hasM('تأیید تا تمام‌شدن زنجیره غیرفعال است', '!chain.complete || !chain.plan')
  hasM('`preview` تازه ⇒ زنجیره از صفر (اجرای دوباره پس از کهنگی)', 'setDecisions({})')
  ok('پنجره هیچ‌وقت خودش نمی‌نویسد', !modal.includes('CH.') && !modal.includes('call('))
}
const service = readFileSync(new URL('../src/main/services/SalesService.ts', import.meta.url), 'utf8')
ok('گیت سرور دست‌نخورده است (برنامه + تیک روشن با هم رد می‌شوند)',
  service.includes('if (stockPlan && input.autoCentralWithdraw === true)'))
ok('`coverShortage` مسیر خودکار سر جای خودش است', service.includes('secondaryStockService.coverShortage'))
// نشست ۱۵۹ (S159-D4): این بند در جلسه‌ی ۵۱ «هنوز شروع نشده» را می‌سنجید؛ جلسه‌ی ۵۳ مرحله ۴ را انجام داد
// (ستون «مبدأ کسر» ⇒ ۱۳ ستون، تست stock-source-display-session53). حالا انجام‌شدنش سنجیده می‌شود.
ok('مرحله ۴ (ستون «مبدأ کسر» فهرست) در جلسه‌ی ۵۳ انجام شد', page.includes('colSpan={13}') && !page.includes('colSpan={12}'))

console.log(`\n${failures.length ? '✗' : '✔'} منطق خالص «انتخاب انبار مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف + ۲-ب): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1 }
