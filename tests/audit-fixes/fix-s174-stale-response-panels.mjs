/**
 * ===========================================================================
 * نشست ۱۷۴ · مشاهده‌ی P3 ممیزی ۸۸ و ۱۱۶ — «پاسخ کهنه» در OutOfShiftPanel، CardTransferPanel،
 * OverrideSessionsPanel و MovementsModal (همان الگوی A88-01 در StaffPerformancePanel).
 *
 * باگ: هر تغییر بازه/فیلتر/کالا/صفحه یک درخواست تازه می‌فرستاد و پاسخ *هر* درخواست روی state
 * می‌نشست؛ درخواست قبلیِ کندتر (بازه‌ی بزرگ‌تر) دیرتر برمی‌گشت و ردیف‌ها/جمع‌های بازه یا کالای
 * قبلی زیر عنوان فعلی می‌ماند؛ Excel هم با نام بازه‌ی فعلی همان ردیف‌های کهنه را می‌نوشت.
 *
 * بخش ۱ (رفتاری): گیت مشترک @shared/latestRequest با دو درخواست هم‌پوشان که قدیمی دیرتر
 * برمی‌گردد — state نهایی باید مال درخواست آخر باشد؛ خطا/busy درخواست کهنه هم اعمال نشود.
 * بخش ۲ (متن کد، چون رندر واقعی React/Electron در این محیط اجرا نمی‌شود): هر چهار مؤلفه از گیت
 * استفاده می‌کنند، پیش از setData/setRows پاسخ کهنه را کنار می‌گذارند، busy/loading/خطا فقط برای
 * آخرین درخواست، و خروجی Excel حین بارگذاری بسته است.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s174-stale-response-panels.mjs
 * ===========================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}

console.log('\n۱) گیت «فقط آخرین درخواست» — رفتاری')
let createLatestGate = null
try { ({ createLatestGate } = await import('@shared/latestRequest')) } catch { createLatestGate = null }
eq('ماژول مشترک @shared/latestRequest وجود دارد', typeof createLatestGate, 'function')

/** شبیه‌سازی دقیق load پنل: همان ترتیب setBusy/setData/setErr مؤلفه‌ها */
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b }); return { p, res, rej } }
const panel = (gate) => {
  const state = { data: null, err: null, busy: false }
  const load = async (key, pending) => {
    const seq = gate ? gate.next() : 0
    const latest = () => (gate ? gate.isLatest(seq) : true)
    state.busy = true; state.err = null
    try { const r = await pending; if (!latest()) return; state.data = { key, r } }
    catch (e) { if (latest()) state.err = String(e.message) }
    finally { if (latest()) state.busy = false }
  }
  return { state, load }
}
if (createLatestGate) {
  // الف) بازه‌ی قدیمی (کند) دیرتر از بازه‌ی جدید برمی‌گردد
  const a = panel(createLatestGate())
  const d1 = deferred(), d2 = deferred()
  const l1 = a.load('۱۴۰۵/۰۱/۰۱..۱۴۰۵/۰۶/۳۱', d1.p)
  const l2 = a.load('۱۴۰۵/۰۷/۰۵..۱۴۰۵/۰۷/۰۵', d2.p)
  d2.res(['امروز']); await l2
  eq('بعد از پاسخ جدید: داده‌ی بازه‌ی جدید', a.state.data?.key, '۱۴۰۵/۰۷/۰۵..۱۴۰۵/۰۷/۰۵')
  d1.res(['شش ماه']); await l1
  eq('پاسخ کهنه‌ی دیررس روی state ننشست', a.state.data?.key, '۱۴۰۵/۰۷/۰۵..۱۴۰۵/۰۷/۰۵')
  eq('busy بعد از پاسخ آخر خاموش', a.state.busy, false)
  // ب) خطای درخواست کهنه روی صفحه نمی‌نشیند، busy درخواست جاری را خاموش نمی‌کند
  const b = panel(createLatestGate())
  const e1 = deferred(), e2 = deferred()
  const m1 = b.load('قبلی', e1.p)
  const m2 = b.load('فعلی', e2.p)
  e1.rej(new Error('خطای درخواست قبلی')); await m1
  eq('خطای کهنه نمایش داده نشد', b.state.err, null)
  eq('busy درخواست جاری هنوز روشن', b.state.busy, true)
  e2.res(['ok']); await m2
  eq('پاسخ جاری نشست', b.state.data?.key, 'فعلی')
  // ج) invalidate (بستن مودال) ⇒ پاسخ در جریان کهنه
  const g = createLatestGate()
  const s = g.next(); g.invalidate()
  eq('invalidate درخواست در جریان را کهنه می‌کند', g.isLatest(s), false)
  eq('درخواست بعدی دوباره آخرین است', g.isLatest(g.next()), true)
}
// کنترل: بدون گیت (رفتار قبلی) همان سناریو پاسخ کهنه را می‌نشاند — اثبات اینکه سناریو واقعاً مسابقه است
{
  const c = panel(null)
  const d1 = deferred(), d2 = deferred()
  const l1 = c.load('قدیم', d1.p), l2 = c.load('جدید', d2.p)
  d2.res(1); await l2; d1.res(2); await l1
  eq('کنترل بدون گیت: پاسخ کهنه برنده می‌شد (سناریو معتبر است)', c.state.data?.key, 'قدیم')
}

console.log('\n۲) هر چهار مؤلفه — متن کد')
const src = (f) => {
  const p = resolve('src/renderer/src/components', f)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
const checks = {
  'OutOfShiftPanel.tsx': { set: 'setData(res)', busy: 'setBusy(false)', exportGuard: /disabled=\{busy \|\| !data\?\.rows\.length\}/ },
  'OverrideSessionsPanel.tsx': { set: 'setData(res)', busy: 'setBusy(false)', exportGuard: /disabled=\{busy \|\| !rows\.length\}/ },
  'CardTransferPanel.tsx': { set: 'setRows(list?.rows ?? [])', busy: 'setBusy(false)', exportGuard: /disabled=\{busy \|\| !rows\.length\}/ },
  'MovementsModal.tsx': { set: 'setRows(result)', busy: 'setLoading(false)', exportGuard: null }
}
for (const [f, c] of Object.entries(checks)) {
  const s = src(f)
  eq(`${f}: گیت مشترک import شده`, /from '@shared\/latestRequest'/.test(s), true)
  eq(`${f}: هر درخواست شماره می‌گیرد`, /const seq = gate\.next\(\)/.test(s), true)
  const iSet = s.indexOf(c.set)
  const iGuard = s.lastIndexOf('if (!gate.isLatest(seq)) return', iSet)
  eq(`${f}: پاسخ کهنه پیش از ${c.set} کنار گذاشته می‌شود`, iSet > 0 && iGuard > 0 && iSet - iGuard < 200, true)
  eq(`${f}: خطا فقط برای آخرین درخواست`, /if \(gate\.isLatest\(seq\)\) setErr\(e\.message\)/.test(s), true)
  eq(`${f}: busy/loading فقط برای آخرین درخواست`, s.includes(`if (gate.isLatest(seq)) ${c.busy}`), true)
  if (c.exportGuard) eq(`${f}: Excel حین بارگذاری بسته`, c.exportGuard.test(s), true)
}
const mm = src('MovementsModal.tsx')
eq('MovementsModal: بستن مودال درخواست در جریان را کهنه می‌کند', /gate\.invalidate\(\)/.test(mm), true)
eq('MovementsModal: تعویض کالا ردیف‌های قبلی را پاک می‌کند', /loadedVariant\.current !== variant\.id\) \{\s*setRows\(\[\]\)/.test(mm), true)
for (const f of ['OutOfShiftPanel.tsx', 'OverrideSessionsPanel.tsx'])
  eq(`${f}: تعویض بازه داده‌ی قبلی را پاک می‌کند`, /if \(loadedRange\.current !== rangeKey\) setData\(null\)/.test(src(f)), true)
eq('CardTransferPanel: تعویض بازه/وضعیت ردیف و جمع قبلی را پاک می‌کند', /if \(loadedKey\.current !== key\) \{\s*setRows\(\[\]\)\s*setTotals\(null\)/.test(src('CardTransferPanel.tsx')), true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
