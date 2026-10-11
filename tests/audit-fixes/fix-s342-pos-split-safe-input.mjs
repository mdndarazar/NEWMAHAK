// @ts-check
/**
 * S342 — قرارداد UI پرداخت ترکیبی POS.
 *
 * ریشهٔ خطای «جمع نقد و کارت» در renderer بود: callback ثبت، سهم‌های split را
 * از closure قدیمی می‌خواند (اغلب صفر) و بعد از ثبت موفق هم `method.label` را
 * روی `null` می‌خواند. این تست هم parser عدد ریالی را واقعاً اجرا می‌کند و هم
 * قراردادهای حساس صفحه را قفل می‌کند؛ backend جداگانه در S341 اجرا می‌شود.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseGroupedInteger } from '../../src/shared/jalali.ts'

const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')

console.log('--- ۱. پارس مبلغ ریالی سخت‌گیر است ---')
assert.equal(parseGroupedInteger('۱٬۲۳۴٬۵۶۷'), 1_234_567)
assert.equal(parseGroupedInteger('1,234,567'), 1_234_567)
assert.equal(parseGroupedInteger(''), 0)
assert.equal(parseGroupedInteger('1.2'), null, 'اعشار نباید با حذف نقطه به ۱۲ تبدیل شود')
assert.equal(parseGroupedInteger('-12'), null, 'منفی نباید به ۱۲ تبدیل شود')
assert.equal(parseGroupedInteger('12abc'), null, 'حروف نباید بی‌صدا حذف شوند')
assert.equal(parseGroupedInteger('9007199254740992'), null, 'عدد خارج از محدودهٔ امن رد می‌شود')
console.log('  ✓ جداکننده/رقم فارسی پذیرفته و اعشار، منفی، متن و عدد ناامن رد می‌شوند')

console.log('--- ۲. POS مقدار نمایشی را امن و زنده می‌خواند ---')
assert.match(pos, /const \[splitCash, setSplitCash\] = useState\(''\)/)
assert.match(pos, /const \[splitCard, setSplitCard\] = useState\(''\)/)
assert.match(pos, /const splitCashAmount = useMemo\(\(\) => parseGroupedInteger\(splitCash\)/)
assert.match(pos, /const splitCardAmount = useMemo\(\(\) => parseGroupedInteger\(splitCard\)/)
assert.match(pos, /value=\{groupThousands\(splitCash\)\}/)
assert.match(pos, /value=\{groupThousands\(splitCard\)\}/)
assert.match(pos, /if \(parseGroupedInteger\(e\.target\.value\) != null\) setSplitCash\(digitsOnly\(e\.target\.value\)\)/)
assert.match(pos, /if \(parseGroupedInteger\(e\.target\.value\) != null\) setSplitCard\(digitsOnly\(e\.target\.value\)\)/)
assert.match(pos, /splitCashAmount,[\s\S]{0,100}splitCardAmount,[\s\S]{0,100}splitTotal,[\s\S]{0,100}splitCardMethodId,/, 'callback باید سهم‌های فعلی را ببیند')
console.log('  ✓ ورودی گروه‌بندی می‌شود، مقدار نامعتبر تبدیل نمی‌شود و closure سهم‌های کهنه ندارد')

console.log('--- ۳. ثبت موفق split به null method دسترسی نمی‌زند ---')
assert.match(pos, /methodLabel: isSplit \? 'نقد \+ کارت' : method!\.label/)
assert.match(pos, /isSplit \? 'نقد \+ کارت' : method!\.label/)
assert.match(pos, /setSplitPayment\(false\)[\s\S]{0,160}setSplitCardMethodId\(null\)/)
console.log('  ✓ برچسب «نقد + کارت» ثبت می‌شود و draft فاکتور قبلی پاک می‌شود')

console.log('\n✓ قرارداد UI پرداخت ترکیبی و ورودی مبلغ امن است.')
