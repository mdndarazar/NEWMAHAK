// @ts-check
/**
 * S371 — دکمه‌های ابطال/اصلاح تعویض در گزارشات فروش باید *قبل* از باز کردن
 * فرم، قفل مستقل salesReturnCorrection را اعمال کنند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s371-sales-reports-exchange-correction-lock.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const panels = await import('../../src/shared/panels.ts')
let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}
const match = (label, re) => yes(label, re.test(page))

console.log('--- ۱. سیاست مستقل اصلاح/ابطال در گزارش نیز fail-closed است ---')
yes('نصب تازه قفل اصلاح/ابطال را روشن دارد', panels.allLockedConfig()[panels.PANEL_KEYS.salesReturnCorrection] === true)
match('صفحه policy و نشست همین قفل را می‌خواند', /const correctionOpen = usePanelOpen\(PANEL_KEYS\.salesReturnCorrection\)[\s\S]{0,180}usePanelLock\(PANEL_KEYS\.salesReturnCorrection\)/)
match('تا پایان بارگذاری قفل، popup باز نمی‌شود', /if \(!correctionLockLoaded\)[\s\S]{0,330}هیچ فرم اصلاح یا ابطال باز نمی‌شود/)

console.log('--- ۲. هر دو کلیک از gate عبور می‌کنند، نه از setTarget مستقیم ---')
match('دکمه ابطال callback گیت دارد', /onVoid=\{\(r\) => requestExchangeCorrectionAction\('VOID', r\)\}/)
match('دکمه اصلاح callback گیت دارد', /onCorrection=\{\(r\) => requestExchangeCorrectionAction\('RECONCILE', r\)\}/)
const handlers = page.slice(page.indexOf('onVoid={(r)'), page.indexOf('pending={pending}', page.indexOf('onVoid={(r)')))
yes('callbackهای JSX دیگر target مودال را مستقیم تنظیم نمی‌کنند', !handlers.includes('setExVoidTarget(') && !handlers.includes('setExCorrectionTarget('))
match('قفل باز فقط action pending را به launcher می‌سپارد', /if \(correctionOpen\) \{\s*launchExchangeCorrectionAction\(request\)\s*return\s*\}[\s\S]*setExCorrectionUnlockRequest\(request\)/)

console.log('--- ۳. پیام و احراز هویت پیش از فرم تغییر روشن است ---')
match('هشدار فارسی صریحِ قفل نمایش داده می‌شود', /این صفحه\/عملیات قفل است؛ شما نمی‌توانید فرم ابطال یا اصلاح جبرانی تعویض را باز کنید/)
match('پیام همه credentialهای مجاز را توضیح می‌دهد', /رمز مدیر، رمز دوم اختصاصی «اصلاح و ابطال برگشت \/ تعویض»، یا رمز سومِ تعریف‌شده برای شیفت جاری/)
match('باز کردن با API استاندارد و کلید صحیح پنل انجام می‌شود', /await unlockPanel\(PANEL_KEYS\.salesReturnCorrection, password\)/)
match('احراز موفق فقط فرم action انتخاب‌شده را باز می‌کند', /launchExchangeCorrectionAction\(request\)/)
match('دیالوگ قفل جدا از دو دیالوگ mutation است', /open=\{!!exCorrectionUnlockRequest\}[\s\S]{0,160}title="قفل عملیات اصلاح و ابطال"/)

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
