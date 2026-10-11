// نشست ۳۰۸: تست قبل/بعد بایگانی مرحله‌ی ۱ «ریکوری نشست + پیام‌های وضعیت‌محور».
/**
 * ===========================================================================
 * نشست ۳۰۸ · مسیر ریکوری نشست · بند ۱ و ۶ (بنر قابل‌اقدام در هر دو صفحه‌ی فروش)
 *
 * قبل از رفع: خطای «نشست لازم است» در POS و فاکتور عمده مثل بقیه‌ی خطاها
 * فقط متنِ زرد بود؛ کاربر باید خودش می‌فهمید به چیپ سر بزند. در صفحاتِ
 * بالبداخلینو ux بزرگ‌تر: ثبت دوباره‌ی اقلام از دست می‌رفت و کاربر دنبال
 * «کجا نشست را باز کنم» کل برنامه را وارسی می‌کرد.
 *
 * انتظار بعد از رفع (ساختاری — رفتار runtime در s307/s309/هارنس ضامن):
 *   ۱) هر دو صفحه code === 'SESSION_REQUIRED' را از message جدا می‌کنند.
 *   ۲) بنر هر دو صفحه رویداد سراسری 'mahak:open-shift-modal' را dispatch می‌کند
 *      (چیپ نشست همان‌جا مودال را باز می‌کند — بدون تغییر مسیر/router).
 *   ۳) هر دو صفحه رویداد 'mahak:shift-changed' را می‌شنوند تا بنر جمع و
 *      پیام «دوباره ثبت کنید» بیاید — هیچ retry خودکاری نباید وجود داشته باشد.
 *   ۴) پاک شدن سبد فقط در مسیر موفقیت ثبت است (بنر SESSION_REQUIRED سبد را نمی‌شوید).
 *   ۵) بنر هیچ nav( را فراخوان نمی‌کند (کاربر در همان صفحه می‌ماند).
 *
 *     node tests/audit-fixes/fix-s308-pos-recover-inline.mjs
 * ===========================================================================
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pos = readFileSync(resolve('src/renderer/src/pages/Pos.tsx'), 'utf8')
const wsi = readFileSync(resolve('src/renderer/src/pages/SalesInvoice.tsx'), 'utf8')

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))

truthy("POS: کد SESSION_REQUIRED جدا از message خوانده می‌شود", /e\?\.code === 'SESSION_REQUIRED'/.test(pos))
truthy("فاکتور عمده: کد SESSION_REQUIRED جدا از message خوانده می‌شود", /e\?\.code === 'SESSION_REQUIRED'/.test(wsi))
truthy('POS: بنر رویداد بازکردن مودال نشست را dispatch می‌کند', /new Event\('mahak:open-shift-modal'\)/.test(pos))
truthy('فاکتور عمده: بنر رویداد بازکردن مودال نشست را dispatch می‌کند', /new Event\('mahak:open-shift-modal'\)/.test(wsi))
truthy("POS: به رویداد mahak:shift-changed گوش می‌دهد", /addEventListener\('mahak:shift-changed'/.test(pos))
truthy("فاکتور عمده: به رویداد mahak:shift-changed گوش می‌دهد", /addEventListener\('mahak:shift-changed'/.test(wsi))

// قفل ۴ — پاک شدن سبد فقط پس از موفقیت (بعد از setLast) باقی می‌ماند
truthy('POS: سبد فقط پس از ثبت موفق پاک می‌شود', /setLast\(\{[\s\S]{0,2000}setLines\(\[\]\)/.test(pos))

// قفل ۵ — بنر nav( را صدا نمی‌زند (کاربر در همان صفحه می‌ماند)
const noNavNear = (src, name) => {
  let idx = 0
  while ((idx = src.indexOf("mahak:open-shift-modal", idx)) !== -1) {
    const around = src.slice(Math.max(0, idx - 200), idx + 200)
    if (/\bnav\(/.test(around)) return false
    idx += 20
  }
  return true
}
truthy('POS: مسیر ریکاوری dispatch-only است (بدون nav)', noNavNear(pos))
truthy('فاکتور عمده: مسیر ریکاوری dispatch-only است (بدون nav)', noNavNear(wsi))

// قفل ۶ — هیچ retry خودکار پس از shift-changed (نباید دوباره saleCreate صدا شود)
const noRetry = (src) => {
  const l = src.indexOf("addEventListener('mahak:shift-changed'")
  if (l === -1) return false
  const block = src.slice(l, l + 600)
  return !/saleCreate|settle\(/.test(block)
}
truthy('POS: بعد از تغییر نشست retry خودکار ندارد', noRetry(pos))
truthy('فاکتور عمده: بعد از تغییر نشست retry خودکار ندارد', noRetry(wsi))

// قفل ۷ — رجیستر renderer: فیلد code روی خطا (بستر نگاه‌داری s307؛ قفل دوطرفه)
const api = readFileSync(resolve('src/renderer/src/lib/api.ts'), 'utf8')
truthy('رجیستری: رندرر code را روی خطا می‌گذارد (قرارداد با main)', /err\.code/.test(api))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
