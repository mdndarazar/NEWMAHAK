// @ts-check
/**
 * نشست ۳۲۱ · گارد regressions در کنترل صندوق/کارت‌خوان.
 * این آزمون نه فرمول مالی، بلکه قرارداد UI را نگه می‌دارد: یک جمع، کنترل‌های
 * keyboard-operable، و تفکیک تفاوت ترکیبی از پلِ واقعاً نامتوازن.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file) => readFileSync(resolve(file), 'utf8')
const drawer = read('src/renderer/src/components/cash/DrawerVsPosSplit.tsx')
const explainer = read('src/renderer/src/components/cash/NetToDrawerCard.tsx')

const exactCount = (source, text) => source.split(text).length - 1

console.log('--- ۱. جلوگیری از رندر تکراری و عنوان مالی گمراه‌کننده ---')
assert.equal(
  exactCount(drawer, 'عدد مرجع فعلی گزارش برای کنترل صندوق و کارت‌خوان:'),
  1,
  'عدد مرجع کنترل فقط یک بار باید رندر شود'
)
assert.equal(
  exactCount(drawer, 'مغایرت محاسباتی در تفکیک اجزا'),
  0,
  'متن قدیمی که هر اختلاف را مغایرت حسابداری می‌نامید نباید باقی بماند'
)
assert.match(drawer, /کنترل گزارش، نه شمارش فیزیکی کشو/, 'کنترل گزارش نباید به‌اشتباه شمارش فیزیکی نامیده شود')
console.log('  ✓ جمع تکراری حذف شد و عنوان با دامنهٔ واقعی عدد سازگار است')

console.log('--- ۲. دسترس‌پذیری کنترل‌ها و مودال کاشی‌ها ---')
for (const detail of ['drawer', 'pos', 'other', 'manager']) {
  assert.match(
    drawer,
    new RegExp(`openDetail\\('${detail}', event\\.currentTarget\\)`),
    `کاشی ${detail} باید button و قابل استفاده با کیبورد باشد`
  )
}
assert.match(drawer, /aria-haspopup="dialog"/, 'کاشی‌ها باید نوع مقصد تعاملی را اعلام کنند')
assert.match(drawer, /role="dialog"/, 'ریز کاشی باید dialog واقعی باشد')
assert.match(drawer, /aria-modal="true"/, 'ریز کاشی باید modal باشد')
assert.match(drawer, /event\.key !== 'Tab'/, 'ریز کاشی باید focus trap با Tab داشته باشد')
assert.match(drawer, /openerRef\.current\?\.focus\(\)/, 'پس از بستن، focus باید به کاشی بازگردد')
assert.doesNotMatch(drawer, /className=[^\n]*\bbtn\b/, 'کنترل‌های مالی نباید به `.btn` سراسری وابسته باشند')
console.log('  ✓ کاشی‌ها و مودال محلی keyboard-operable و focus-safe هستند')

console.log('--- ۳. تفکیک صریح دو نوع هشدار ---')
assert.match(explainer, /const bridgeIsUnbalanced = alarm === 'BRIDGE_UNBALANCED'/)
assert.match(explainer, /const compositionDrift = alarm === 'COMPOSITION_DRIFT'/)
assert.match(explainer, /پل حسابداری تراز است؛ این پیام به‌تنهایی دلیلِ مغایرت حسابداری/, 'ترکیب نمایشی نباید پل باز نامیده شود')
assert.match(explainer, /این هشدار دربارهٔ خودِ پل حسابداری است/, 'هشدار پل باید دقیق نام‌گذاری شود')
console.log('  ✓ پل نامتوازن و اختلاف صرفاً ترکیبی با پیام متفاوت نمایش می‌گیرند')

console.log('\nنتیجه: گاردهای UI/دسترس‌پذیری کنترل صندوق با موفقیت برقرارند.')
