/**
 * ===========================================================================
 * جلسه ۵۰ · مرحله ۱-ب — سوییت منطق خالصِ «ردیابی برداشت انبار در تعویض».
 * بی دیتابیس، بی node_modules: `node --import ./test/harness/register.mjs ...`
 * ===========================================================================
 */
const S = await import('@shared/stockSource')
const {
  CENTRAL_WITHDRAW_TAG, DEFAULT_CENTRAL_WAREHOUSE_LABEL,
  centralWithdrawGroups, centralWithdrawTotal, centralWithdrawShortLine, centralWithdrawSentence,
  buildCentralWithdrawNote, parseCentralWithdrawNote, stripCentralWithdrawNote
} = S
const { faDigits } = await import('@shared/jalali')

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)

/** شکل واقعیِ `CentralWithdrawLine` (خروجی coverShortage) */
const line = (sources) => ({ variantId: 1, name: 'کالا', unit: 'عدد', shortage: 9, taken: 9, missing: 0, sources, warehouseName: DEFAULT_CENTRAL_WAREHOUSE_LABEL })
const src = (name, taken, warehouseId = null) => ({ id: 1, name: 'ردیف', taken, remaining: 0, warehouseId, warehouseName: name })

section('بند ۱ · جمع برداشت به تفکیک انبار')
eq('هیچ برداشتی ⇒ فهرست خالی', centralWithdrawGroups([]), [])
eq('null هم بی‌صدا خالی است', centralWithdrawGroups(null), [])
eq('برداشت صفر شمرده نمی‌شود', centralWithdrawGroups([line([src('انبار مرکزی', 0)])]), [])
eq('یک انبار', centralWithdrawGroups([line([src('انبار مرکزی', 2)])]), [{ name: 'انبار مرکزی', qty: 2 }])
eq('دو قلم از یک انبار با هم جمع می‌شوند',
  centralWithdrawGroups([line([src('انبار مرکزی', 2)]), line([src('انبار مرکزی', 3)])]),
  [{ name: 'انبار مرکزی', qty: 5 }])
eq('چند انبار، پرمصرف‌تر اول',
  centralWithdrawGroups([line([src('انبار مرکزی', 2), src('انبار شعبه', 5, 3)])]),
  [{ name: 'انبار شعبه', qty: 5 }, { name: 'انبار مرکزی', qty: 2 }])
eq('نام خالی ⇒ انبار پیش‌فرض', centralWithdrawGroups([line([src('  ', 4)])]), [{ name: DEFAULT_CENTRAL_WAREHOUSE_LABEL, qty: 4 }])
eq('جمع کل', centralWithdrawTotal([{ name: 'a', qty: 2 }, { name: 'b', qty: 3 }]), 5)

section('بند ۲ · متن‌های نمایشی (یک جمله در پنل و سابقه و گزارش)')
const g = [{ name: 'انبار مرکزی', qty: 2 }, { name: 'انبار شعبه ۲', qty: 3 }]
eq('خط کوتاه', centralWithdrawShortLine(g, faDigits), 'انبار مرکزی ۲ · انبار شعبه ۲ ۳')
ok('جمله‌ی کامل جمع را می‌گوید', centralWithdrawSentence(g, faDigits).includes('۵ عدد'))
eq('بی برداشت ⇒ جمله خالی', centralWithdrawSentence([], faDigits), '')

section('بند ۳ · ساخت و خواندن `note` (رفت‌وبرگشت)')
eq('بی برداشت ⇒ note دست‌نخورده', buildCentralWithdrawNote('تعویض کالا', [], faDigits), 'تعویض کالا')
eq('بی برداشت و بی متن ⇒ خالی', buildCentralWithdrawNote(null, [], faDigits), '')
const note = buildCentralWithdrawNote('تعویض کالا · یادداشت کاربر', g, faDigits)
ok('تگ ثابت در note هست', note.includes(CENTRAL_WITHDRAW_TAG))
ok('توضیح کاربر حفظ شده', note.startsWith('تعویض کالا · یادداشت کاربر'))
eq('خواندن دوباره عیناً همان داده', parseCentralWithdrawNote(note), { warehouses: g, totalQty: 5 })
eq('note بی تگ ⇒ null (فاکتور قدیمی)', parseCentralWithdrawNote('تعویض کالا'), null)
eq('note خالی/null ⇒ null', [parseCentralWithdrawNote(''), parseCentralWithdrawNote(null), parseCentralWithdrawNote(undefined)], [null, null, null])
eq('تگ بی بدنه ⇒ null', parseCentralWithdrawNote(`تعویض کالا · ${CENTRAL_WITHDRAW_TAG}`), null)
eq('رقم لاتین هم خوانده می‌شود', parseCentralWithdrawNote(`${CENTRAL_WITHDRAW_TAG} انبار مرکزی: 7`), { warehouses: [{ name: 'انبار مرکزی', qty: 7 }], totalQty: 7 })
eq('یک انبار', parseCentralWithdrawNote(buildCentralWithdrawNote('', [{ name: 'انبار مرکزی', qty: 1 }], faDigits)), { warehouses: [{ name: 'انبار مرکزی', qty: 1 }], totalQty: 1 })
{
  const dirty = buildCentralWithdrawNote('تعویض کالا', [{ name: 'انبار: شعبه؛ [یک]', qty: 2 }], faDigits)
  const back = parseCentralWithdrawNote(dirty)
  ok('نام پرخطر هم بی ابهام خوانده می‌شود', back && back.warehouses.length === 1 && back.totalQty === 2, JSON.stringify(back))
}

section('بند ۴ · جدا کردن توضیح کاربر از تگ')
eq('تگ حذف می‌شود', stripCentralWithdrawNote(note), 'تعویض کالا · یادداشت کاربر')
eq('note بی تگ دست‌نخورده', stripCentralWithdrawNote('تعویض کالا'), 'تعویض کالا')
eq('note فقط-تگ ⇒ خالی', stripCentralWithdrawNote(`${CENTRAL_WITHDRAW_TAG} انبار مرکزی: ۲`), '')
eq('null ⇒ خالی', stripCentralWithdrawNote(null), '')

console.log(`\n${failures.length ? '✗' : '✔'} منطق خالص «ردیابی برداشت انبار در تعویض» (جلسه ۵۰): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1 }
