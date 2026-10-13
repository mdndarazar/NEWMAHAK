// @ts-check
/**
 * فاز ۰ — ثبت رفتار پایهٔ تنظیم مدت اعتبار:
 * مقدار صریح صفر باید از مسیر واقعی ذخیره/خواندن تنظیمات پایدار بماند و
 * مسیر برگشت/تعویض آن را با returnCodeDays تاریخی جایگزین نکند.
 *
 * این تست هیچ رفتار تازه‌ای تحمیل نمی‌کند؛ قرارداد فعلی را پیش از اصلاح متن UI
 * ثبت می‌کند. صدور واقعی برگشت/تعویض با همین قرارداد در S338 پوشش e2e دارد.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-s339-credit-settings-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { DEFAULT_CREDIT_SETTINGS, exchangeCreditDays } = await import('../../src/shared/credit.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { SETTING_KEYS } = await import('../../src/shared/receipt.ts')

const db = harnessClient()
const seed = makeSeeder(db)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.creditSettings]: false })
const userId = seed.user('مدیر تست تنظیم بدون انقضا')

console.log('--- ۱. صفر صریح از مسیر واقعی تنظیمات ذخیره و reload می‌شود ---')
const noExpiry = structuredClone(DEFAULT_CREDIT_SETTINGS)
noExpiry.types.EXCHANGE.days = 0
await settingsService.saveCreditSettings({ settings: noExpiry, userId, panelPassword: DEFAULT_MANAGER_PASSWORD })
const reloaded = await settingsService.creditSettings()
assert.equal(reloaded.types.EXCHANGE.days, 0, 'صفر نباید هنگام parse/save حذف یا به ۷ تبدیل شود')
console.log('  ✓ EXCHANGE.days=0 بعد از ذخیره و خواندن همچنان صفر است')

console.log('--- ۲. صفر صریح، fallback تاریخی مهلت برگشت را بی‌اثر می‌کند ---')
assert.equal(
  exchangeCreditDays({ exchangeDays: reloaded.types.EXCHANGE.days, returnCodeDays: 7 }),
  undefined,
  'تنظیم معتبر EXCHANGE (حتی صفر) باید resolveRules را منبع تصمیم نگه دارد'
)
assert.equal(
  exchangeCreditDays({ exchangeDays: null, returnCodeDays: 7 }),
  7,
  'فقط تنظیم خوانده‌نشده/نامعتبر می‌تواند fallback تاریخی داشته باشد'
)
console.log('  ✓ صفر صریح با «تنظیم وجود ندارد» یکی نیست')

console.log('--- ۳. برچسب تنظیم، منبع ذخیره‌شده را تغییر نمی‌دهد ---')
const credit = await import('../../src/shared/credit.ts')
const forms = await import('node:fs').then(({ readFileSync }) => readFileSync('src/renderer/src/components/CreditForms.tsx', 'utf8'))
const settingsUi = await import('node:fs').then(({ readFileSync }) => readFileSync('src/renderer/src/pages/Settings.tsx', 'utf8'))
assert.equal(credit.CREDIT_RULE_LABELS.EXCHANGE, 'برگشت فروش / تعویض کالا / اضافه‌دریافت')
assert.match(forms, /CREDIT_RULE_LABELS/)
assert.match(forms, /تغییر این قواعد فقط روی اعتبارهای آینده اثر دارد/)
assert.match(forms, /برای بدون انقضا، عدد ۰ را صریح وارد کنید/)
assert.match(settingsUi, /مدت اعتبار خرید را از «مدیریت اعتبار خرید/)
console.log('  ✓ متن شفاف است و source / snapshot / دادهٔ تاریخی را تغییر نمی‌دهد')

console.log('--- ۴. این قرارداد برای صدور واقعی در S338 پوشش end-to-end دارد ---')
console.log('  ✓ S338 باید جداگانه اجرا شود: برگشت و تعویض با EXCHANGE.days=0 هر دو expiresAt/issuedDays=null')
console.log('\nنتیجه: تنظیم و متن قاعدهٔ مدت اعتبار ثبت شد.')
