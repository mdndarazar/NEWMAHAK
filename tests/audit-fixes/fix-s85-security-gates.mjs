/**
 * نشست ۸۵ · خوشه H · گیت مسیرهای حساس تنظیمات و purge.
 *
 * این تست ایستا است؛ محیط فعلی Electron/npm/Prisma تولیدی ندارد. برای ثبت
 * رفتار قبل/بعد، همین تست روی zip خام نشست ۸۴ و سپس روی سورس اصلاح‌شده اجرا
 * می‌شود.
 *
 *   node --import ./test/harness/register.mjs tests/audit-fixes/fix-s85-security-gates.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const ipc = read('src/main/ipc/index.ts')
const sales = read('src/main/services/SalesService.ts')
const settings = read('src/renderer/src/pages/Settings.tsx')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

const purgeBody = sales.match(/async purge\(input:[\s\S]*?\n  \}\n\}/)?.[0] ?? ''

eq('settings:set کلیدهای ناشناس را fail-closed رد می‌کند', /RAW_SETTING_SAFE_KEYS\.has\(key\)[\s\S]*?RAW_SETTING_MANAGER_KEYS\.has\(key\)[\s\S]*?مجاز نیست/.test(ipc), true)
eq('settings:set برای کلیدهای حساس رمز مدیر می‌خواهد', /RAW_SETTING_MANAGER_KEYS\.has\(key\)[\s\S]*?assertManagerPassword\(input\?\.managerPassword/.test(ipc), true)
eq('settings:set actor را از نشست می‌گیرد، نه payload', /const actorId = await shiftService\.currentStaffId\(\)/.test(ipc), true)
eq('settings:set تغییر را Audit می‌کند', /action: AuditAction\.SETTINGS_UPDATE[\s\S]*?entity: 'Setting'/.test(ipc), true)
eq('purge actor را از نشست باز می‌گیرد', /handle\(IPC\.salePurge,[\s\S]*?withSessionActor/.test(ipc), true)
eq('purge همیشه گیت رمز مدیر دارد', /handle\(IPC\.salePurge,[\s\S]*?assertManagerPassword\(payload\.managerPassword/.test(ipc), true)
eq('purge قفل دوره را قبل از تراکنش پیش‌سنجی می‌کند', /const periodApproved = await periodLockService\.preverify/.test(purgeBody), true)
eq('purge قفل دوره را داخل تراکنش دوباره assert می‌کند', /await periodLockService\.assertOpen\(tx/.test(purgeBody), true)
eq('purge سند فاکتور را void می‌کند', /saleInvoice\.updateMany[\s\S]*?voidedAt[\s\S]*?SaleStatus\.CANCELED/.test(purgeBody), true)
eq('purge پرداخت و برگشت را فیزیکی حذف نمی‌کند', /\.deleteMany\(|\.delete\(/.test(purgeBody), false)
eq('purge برای Audit از VOID استفاده می‌کند', /action: AuditAction\.VOID/.test(purgeBody), true)
eq('UI رمز مدیر purge را به main می‌فرستد', /managerPassword: toLatinDigits\(panelManagerPw\)\.trim\(\)/.test(settings), true)
eq('UI دلیل purge را به main می‌فرستد', /overrideReason: purgeReason\.trim\(\)/.test(settings), true)

console.log('  ⓘ تست ایستا است؛ اجرای Electron و Prisma Client تولیدی: اجرا نشد، دلیل: npm/Electron در محیط نیست.')
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
