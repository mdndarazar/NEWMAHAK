// @ts-check
/**
 * S368 — قفل «اصلاح و ابطال برگشت/تعویض» باید قبل از باز شدن فرم اثر کند.
 *
 * S354 ثابت کرده بود که mutation از IPC بدون credential رد می‌شود، اما UI هنوز
 * فرم ویرایش/ابطال را اول باز می‌کرد و تازه در پایان کار خطا می‌داد. این تست
 * قرارداد لایه‌ی renderer را کنار قرارداد واقعی policy/session نگه می‌دارد:
 *   - نصب تازه fail-closed است؛
 *   - کلیک روی سه عمل حساس از گیت واحد می‌گذرد، نه باز کردن مستقیم popup؛
 *   - گیت همان verifyPanel استاندارد را صدا می‌زند، پس رمز مدیر/دوم/سوم را
 *     می‌پذیرد و سپس فقط همان عمل درخواست‌شده را باز می‌کند.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(path, 'utf8')
const page = source('src/renderer/src/pages/SalesReturn.tsx')
const panels = await import('../../src/shared/panels.ts')

let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}
const match = (label, re) => yes(label, re.test(page))
const noMatch = (label, re) => yes(label, !re.test(page))

console.log('--- ۱. سیاست نصب تازه برای همین عمل fail-closed است ---')
const defaults = panels.allLockedConfig()
assert.equal(defaults[panels.PANEL_KEYS.salesReturnCorrection], true)
ok++
console.log('  ✓ نبود تنظیمات، قفل اصلاح/ابطال را روشن نگه می‌دارد')
assert.equal(panels.isPanelLockEnabled(defaults, panels.PANEL_KEYS.salesReturnCorrection), true)
ok++
console.log('  ✓ تفسیر shared نیز آن را قفل‌شده می‌داند')

console.log('--- ۲. هر سه دکمه قبل از popup از گیت واحد می‌گذرند ---')
match('صفحه از usePanelOpen قفل مستقل استفاده می‌کند', /const correctionOpen = usePanelOpen\(PANEL_KEYS\.salesReturnCorrection\)/)
match('تا بارگیری policy هم fail-closed می‌ماند', /const \{ loaded: correctionLockLoaded \} = usePanelLock\(PANEL_KEYS\.salesReturnCorrection\)/)
match('ویرایش مستقیماً مودال را باز نمی‌کند', /onClick=\{\(\) => requestReturnCorrectionAction\('EDIT', r\)\}/)
match('ابطال مستقیماً دیالوگ را باز نمی‌کند', /onClick=\{\(\) => requestReturnCorrectionAction\('VOID', r\)\}/)
match('اصلاح جبرانی مستقیماً دیالوگ را باز نمی‌کند', /onClick=\{\(\) => requestReturnCorrectionAction\('RECONCILE', r\)\}/)
noMatch('الگوی قدیمی باز کردن مستقیم مودال ویرایش حذف شده است', /onClick=\{\(\) => setEditId\(r\.id\)\}/)
noMatch('الگوی قدیمی باز کردن مستقیم ابطال حذف شده است', /onClick=\{\(\) => \{\s*setVoidReason\(''\)/)

console.log('--- ۳. هشدار قابل‌استفاده همان credential استاندارد را می‌پذیرد ---')
match('قفل روشن درخواست را پیش از فرم نگه می‌دارد', /if \(correctionOpen\) \{\s*launchReturnCorrectionAction\(request\)\s*return\s*\}[\s\S]*setCorrectionUnlockRequest\(request\)/)
match('پیام فارسی صریح می‌گوید هیچ ویرایش/اصلاح/ابطالی مجاز نیست', /این صفحه قفل است؛ شما نمی‌توانید ویرایش، اصلاح جبرانی یا ابطال برگشت\/تعویض انجام دهید/)
match('پیام مسیر رمز مدیر، دوم و سوم را توضیح می‌دهد', /رمز مدیر، رمز دوم اختصاصی «اصلاح و ابطال برگشت \/ تعویض»، یا رمز سومِ تعریف‌شده برای شیفت جاری/)
match('باز کردن قفل با API استاندارد پنل انجام می‌شود', /await unlockPanel\(PANEL_KEYS\.salesReturnCorrection, password\)/)
match('پس از احراز موفق فقط عمل pending اجرا می‌شود', /launchReturnCorrectionAction\(request\)/)
match('احراز قفل یک دیالوگ جدا از فرم تغییر دارد', /title="قفل عملیات اصلاح و ابطال"/)

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
