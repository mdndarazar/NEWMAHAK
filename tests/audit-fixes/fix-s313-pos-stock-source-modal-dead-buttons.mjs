// تست حضور-ساختار پچ «دکمه‌های پنجره‌ی «از کدام انبار کسر شود؟» مرده بودند».
//
// باگ ۱ (ریشه‌ی دکمه‌های مرده در پنل فروش تکی): `settle` در Pos *قبل* از باز شدن
// پنجره `setBusy(true)` می‌کند تا ثبتِ دوباره‌ی فیش قفل شود، و تا جواب کاربر در
// `await askStockChain(preview)` می‌ماند — پس در کل بازه‌ی باز بودن پنجره
// `busy=true` است. مودال همان مقدار خام را می‌گرفت (`busy={busy}`) و هر دو دکمه‌ی
// «تأیید و ثبت فیش» و «لغو کل ثبت فاکتور» را که بر پایه‌ی `busy` غیرفعال
// می‌کند، برای همیشه نابینا/مرده نگه می‌داشت. فیکس: `busy={busy && stockChain == null}`
// — «busyِ مفید برای مودال» فقط یعنی «ثبتی در جریان است و پنجره‌ای منتظر جواب
// نیست». قفلِ تکثیرِ کاربر روی تأیید را خودِ `decide` می‌گیرد (پس از یک کلیک
// پنجره بسته می‌شود و وعده فقط یک‌بار تحویل می‌شود).
//
// باگ ۲ (رمز مدیر اشتباه برای مسیر فروشگاهی): قفل «برداشت از انبار دیگر»
// (`passwordRequired`) سرجام اعمال می‌شد؛ درحالی‌که قرارداد — و راهنمای خودِ
// کادر بنفش — می‌گوید رمز فقط برای مبدأ «غیر از انبار فروشگاه» لازم است (همان
// چیزی که سرور با `assertPanelPassword(PANEL_KEYS.posCentralWithdrawToggle…)`
// می‌سنجد). برای برنامه‌ی «همه از انبار فروشگاه + منفی» هیچ رمزی لازم نبود و
// تأیید عمل نمی‌کرد. فیکس: `hasForeignSource` (حداقل یک entry غیر STORE در
// `chain.plan`) — کادر رمز و گیت تأیید فقط با همین وام‌دار شدند.
//
// (سبک تست‌های audit-fixes؛ منطق زمان‌اجرا را اثبات نمی‌کند.)
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(p, 'utf8')
const pos = read('src/renderer/src/pages/Pos.tsx')
const modal = read('src/renderer/src/components/StockSourceModal.tsx')
const wholesale = read('src/renderer/src/pages/SalesInvoice.tsx')

let passed = 0
let failed = 0
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` · دریافت ${JSON.stringify(actual)}`}`)
}

const blockOf = (src) => {
  const i = src.indexOf('<StockSourceModal')
  return i < 0 ? '' : src.slice(i, src.indexOf('/>', i))
}
const posBlock = blockOf(pos)
const wholeBlock = blockOf(wholesale)

console.log('\n— پنجره‌ی «از کدام انبار کسر شود؟» — دکمه‌های مرده و رمز اشتباه (s313)')

check('Pos: busy مودال با باز بودن پنجره وام‌دار شده (نه busy خام)', [
  /\bbusy=\{busy && stockChain == null\}/.test(posBlock),
  !/\bbusy=\{busy\}/.test(posBlock)
], [true, true])

check('Modal: hasForeignSource از روی kind غیرفروشگاه در chain.plan محاسبه می‌شود', [
  /const hasForeignSource = useMemo\(/.test(modal),
  /e\.kind !== StockSourceKind\.STORE/.test(modal),
  /chain\.plan\?\.lines/.test(modal)
], [true, true, true])

check('Modal: گیت رمز فقط با منبع خارجی (تأیید + ارسال + کادر رمز)', [
  /passwordRequired && hasForeignSource && !password\.trim\(\)/.test(modal),
  /passwordRequired && hasForeignSource \? password\.trim\(\) : null/.test(modal),
  /\{passwordRequired && hasForeignSource && chain\.complete && \(/.test(modal)
], [true, true, true])

check('Modal: قرارداد بی‌تغییرِ لغو و عدم‌بازگشتِ busy خام', [
  /className="btn" onClick=\{onCancel\} disabled=\{busy\}/.test(modal),
  !/disabled=\{busy \|\| !chain\.complete \|\| !chain\.plan \|\| \(passwordRequired && !password\.trim\(\)\)\}/.test(modal)
], [true, true])

check('SalesInvoice: مصرف‌کننده‌ی سالمِ قبلی همان sprint مهارِ busy نداشت (بدون busy و بدون رمز)', [
  !/\bbusy=/.test(wholeBlock),
  !/\bpasswordRequired/.test(wholeBlock)
], [true, true])

console.log(`\nnok:${passed} ok:${passed + failed}`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
