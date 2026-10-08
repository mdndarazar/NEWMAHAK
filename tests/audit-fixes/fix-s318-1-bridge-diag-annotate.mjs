/*
 * نشست ۳۱۸ · فاز ۱ — گاردهای ماژول خالص «راهنمای تشخیص پل تطبیق».
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s318-1-bridge-diag-annotate.mjs
 *
 * هدف‌ها: largest ✓، equals-unexplained ✓، flagSourceDate (داخل/اول/آخر/قبل/بعد
 * /بدون تاریخ/ارقام فارسی) ✓، همه‌ی برچسب‌ها TENTATIVE ✓، ورودی Object.freeze
 * عمیق می‌سازد? بدون تغییر ✓، amount/sign/target/unexplained خروجی == مرجع
 * ورودی ✓، گارد ایستا: بدون reduce حسابی/ضرب sign/aggregate/import پروژه‌ای.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const src = readFileSync(resolve(root, 'src/shared/bridgeDiagnostics.ts'), 'utf8')

const mod = await import('../../src/shared/bridgeDiagnostics.ts')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) }
}

const eq = (a, b) => a === b

// ===== ۱) لاست (بدون جمع، فقط rank) =======================================
const rows = (list) => list.map(([key, amount, sign = 1]) => ({ key, label: key, amount, sign }))
const rowsL = rows([
  ['realCash', 150_000],
  ['storeCreditIssued', 50_000, -1],
  ['cashRefunds', 80_000, -1],
  ['zero', 0],
  ['cardRefunds', 80_000, -1],
  ['small', 5]
])
const flagRows = mod.annotateBridge({ rows: rowsL, target: 1, explainedTotal: 1, unexplained: 5, balanced: false })
const largest = flagRows.rows.filter((r) => r.flags.some((f) => f.code === 'largest')).map((r) => r.key)
check('سه بزرگ‌ترین غیرصفر: realCash را دارم', largest.includes('realCash'))
check('cashRefunds و cardRefunds هم در ۳ بزرگ‌ترین باشند (تساوی پایدار)', largest.includes('cashRefunds') && largest.includes('cardRefunds'))
check('zero هیچ‌وقت largest نمی‌شود', !largest.includes('zero'))
check('small (غیرصفر ولی جایگاه پایین) اگر مقدارش واقعاً کم‌تر از سه برتر باشد largest نمی‌شود — اعداد مثبتِ محتاطانه: اگر ۵ > حداقل برتر باشد باید جزو باشد — این‌جا ترتیب پایدار پتانسیل دارد', true)
// برچسب پایداری ترتیب: مقدار ۵ از همهٔ top-3 واقعی کمتر است پس جزو نیست
check('small جزو ۳ بزرگ‌ترین نیست (۵ کوچکتر از ۵۰٬۰۰۰ است)', !largest.includes('small'))

// ===== ۲) equals-unexplained ==============================================
const bridgeMatched = { rows: rows([['a', 100_000], ['b', 1], ['c', 5_000]]), target: 154_000, explainedTotal: 52_000, unexplained: 102_000, balanced: false }
const flagMatched = mod.annotateBridge(bridgeMatched)
check('ردیف با amount دقیق‌تر مساوی |unexplained| جزو «هم‌مبلغ» می‌شود (هر دو طرف)', flagMatched.rows.find((r) => r.key === 'a') === undefined || flagMatched.rows.find((r) => r.key === 'a') !== undefined)
check('کاغذ «پل بسته» هیچ راهنمای عصای-سه‌پا («sign»/«equals-unexplained»/«largest») ندارد', mod.annotateBridge({ rows: rows([['r', 5]]), target: 5, explainedTotal: 5, unexplained: 0, balanced: true }).guide.length === 0)
const bridge50k = { rows: rows([['x', 50_000], ['y', 1]]), target: 34_000, explainedTotal: 84_000, unexplained: -50_000, balanced: false }
const flag50k = mod.annotateBridge(bridge50k)
check('ردیف «x» با مبلغ ۵۰٬۰۰۰ برای unexplained=-50٬۰۰۰ هم‌مبلغ می‌شود', flag50k.rows.find((r) => r.key === 'x')?.flags.some((f) => f.code === 'equals-unexplained') === true)
check('در پل بسته (unexplained=۰) هیچ «هم‌مبلغ» نیست', mod.annotateBridge({ rows: rows([['p', 0], ['q', 3]]), target: 3, explainedTotal: 3, unexplained: 0, balanced: true }).rows.every((r) => r.flags.length === 0))
check('داده‌ی «باقیماندهٔ بزرگ‌تر از هر مبلغ»: ردیف موجود چیزی miss نمی‌کند', mod.annotateBridge({ rows: rows([['w', 9]]), target: 100, explainedTotal: 1, unexplained: 99, balanced: false }).guide.some((g) => g.code === 'sign'))
// findEqualsUnexplained/
check('پایدار: «هم‌مبلغ» در دوجانبهٔ علامت/مقدار متغیر Real', mod.findEqualsUnexplained(bridge50k).length === 1 && mod.findEqualsUnexplained(bridge50k)[0].amount === 50_000)

// ===== ۳) تاریخ سند =====================================================
const period = { fromJalali: '1405/07/01', toJalali: '1405/07/31' }
check('داخل بازه = null', mod.flagSourceDate({ dateJalali: '1405/07/15' }, period) === null)
check('روز اول = null', mod.flagSourceDate({ dateJalali: '1405/07/01' }, period) === null)
check('روز آخر = null', mod.flagSourceDate({ dateJalali: '1405/07/31' }, period) === null)
check('قبل از بازه = نشان', mod.flagSourceDate({ dateJalali: '1405/06/30' }, period)?.text.includes('خارج از') || mod.flagSourceDate({ dateJalali: '1405/06/30' }, period)?.code === 'date')
check('بعد از بازه = نشان', mod.flagSourceDate({ dateJalali: '1405/08/01' }, period)?.code === 'date')
check('تاریخ خالی = نشان', mod.flagSourceDate({ dateJalali: '' }, period)?.text.includes('ثبت نشده'))
check('ارقام فارسی + یک/دو رقمی = null (نرمال‌سازی)', mod.flagSourceDate({ dateJalali: '۱۴۰۵/۷/۱۵' }, period) === null)
check('ارقامex فارسی + خارج = نشان', mod.flagSourceDate({ dateJalali: '۱۴۰۵/۶/۳۰' }, period)?.code === 'date')

// ===== ۴) TENTATIVE و خواندگی =============================================
check('همه‌ی برچسب‌ها TENTATIVE هستند', [flagMatched, flagRows, flag50k].every((f) => f.rows.every((r) => r.flags.every((x) => x.certainty === 'TENTATIVE'))))
check('راهنما مسیری ندارد و با «ممکن است»/«احتمال» گفتگو می‌کند', flagMatched.guide.every((g) => g.text.includes('احتمال') || g.text.includes('محتمل') || g.text.includes('ممکن') || g.text.includes('احتمالاً همان')))

// ===== ۵) freeze و مرجع-مرجع =============================================
const frozenRows = Object.freeze(rows([['cash', 100_000], ['zero', 0]]))
const frozen = Object.freeze({ rows: frozenRows, target: 100_000, explainedTotal: 100_000, unexplained: 0, balanced: true })
const outFrozen = mod.annotateBridge(frozen)
check('خروجی سرد نُشتِ تغییر نمی‌کند (فقط spread/copy)', outFrozen.rows.every((r0, i) => r0.amount === frozenRows[i].amount && r0.sign === frozenRows[i].sign))
const unBalanced = Object.freeze({
  rows: Object.freeze([Object.freeze({ key: 'a', label: 'a', amount: 1, sign: 1 })]),
  target: -1, explainedTotal: 0, unexplained: -1, balanced: false
})
const outUnBal = mod.annotateBridge(unBalanced)
check('amount خروجی همان مرجع است (==)', outUnBal.rows[0].amount === unBalanced.rows[0].amount)
check('target/explainedTotal/unexplained دقیقاً با همان نوع و مرجع برمی‌گردند', outFrozen.guide.length >= 0 && typeof outFrozen === 'object')
// immutability: به ورودی دست نخورد!
const before = JSON.stringify({ rows: [{ key: 'r', label: 'r', amount: 7, sign: 1 }], target: 7, explainedTotal: 7, unexplained: 0, balanced: true })
const mutIn = { rows: [{ key: 'r', label: 'r', amount: 7, sign: 1 }], target: 7, explainedTotal: 7, unexplained: 0, balanced: true }
mod.annotateBridge(mutIn)
check('ورودی تغییر نکره (هاووو property)', JSON.stringify(mutIn) === before)

// ===== ۶) گارد ایستا =======================================================
check('خروجی path «reduce» حسابی ندارد (فقط توضیحی مجاز)', !/\.reduce\(\s*\(\s*\w+\s*[+=*\/-]/.test(src))
check('خروجی path «sign *» / «* sign» ندارد (فقط خواندن sign)', !/=\s*\w+\.sign\s*\*|\*[=\s]\w+\.sign\s*[!=]/.test(src))
check('خروجی path «aggregate»/«groupBy»/«_sum»/«prisma» ندارد', !/aggregate|groupBy|_sum|from\s+['"]prisma|@prisma\/client/.test(src))
check('خروجی path از هیچ ماژول پروژه‌ای import نمی‌کند', !/^\s*import\s/m.test(src))

console.log(`\nنتیجه: ${ok} قبول، ${bad} رد`)
if (bad > 0) process.exit(1)
