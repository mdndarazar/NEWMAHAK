/**
 * نشست ۱۲۸ · خوشه H

 * باگ: archivePurge فقط پاک‌سازی AuditLog را با رمز مدیر محدود می‌کرد؛ حذف
 * فیزیکی اسناد قدیمی فروش/خرید با مسیر main بدون رمز مدیر ممکن بود. همچنین
 * actor از userId ارسالی renderer می‌آمد.

 * قرارداد بعد از رفع:
 *   • کل archivePurge همیشه رمز مدیر می‌خواهد؛ حتی وقتی purgeAudit خاموش است؛
 *   • actor از نشست باز main می‌آید؛
 *   • UI رمز را برای کل آرشیو می‌فرستد و نبودنش را «فقط رد شدن لاگ» معرفی نمی‌کند.

 * این تست ساختاری است و جای اجرای IPC/Electron و Prisma تولیدی را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/MaintenanceService.ts'), 'utf8')
const ipc = readFileSync(resolve(root, 'src/main/ipc/index.ts'), 'utf8')
const ui = readFileSync(resolve(root, 'src/renderer/src/pages/Settings.tsx'), 'utf8')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const archiveBody = service.slice(service.indexOf('async archivePurge('))
const archiveHandler = ipc.slice(ipc.indexOf('handle(IPC.maintenanceArchivePurge'))
const authIndex = archiveBody.indexOf('await assertManagerPassword(input?.managerPassword')
const backupIndex = archiveBody.indexOf('runInternalBackup()')

check('archivePurge خودش گیت رمز مدیر دارد', /async archivePurge\([\s\S]{0,1800}await assertManagerPassword\(input\?\.managerPassword/.test(service))
check('گیت archive قبل از بکاپ/تراکنش است', authIndex >= 0 && backupIndex > authIndex)
check('IPC actor را از نشست باز می‌گیرد', /handle\(IPC\.maintenanceArchivePurge[\s\S]{0,220}withSessionActor/.test(ipc))
check('مسیر archive دیگر نبود رمز را فقط به حذف لاگ محدود نمی‌کند', !/شکستش \*\*فقط\*\* همین یک مرحله را رد می‌کند/.test(archiveBody))
check('UI رمز را برای کل archive می‌فرستد', /managerPassword:\s*slimManagerPw/.test(ui))
check('UI الزام رمز کل archive را واضح می‌گوید', /برای آرشیو و پاک‌سازی اجباری|برای کل آرشیو اجباری/.test(ui))
check('UI پیام گمراه‌کننده‌ی «بقیه انجام می‌شود» ندارد', !/فقط<\/b> همین یک مرحله انجام نمی‌شود و بقیه‌ی پاک‌سازی/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
