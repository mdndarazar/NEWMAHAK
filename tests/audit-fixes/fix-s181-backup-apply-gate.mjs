// نشست ۱۸۱: تست قبل/بعد — گیت رمز مدیر روی BackupService.apply (بند ۴-۳۰ و بند ۵).
/**
 * ===========================================================================
 * نشست ۱۸۱ · کار باز «Backup-gate»
 *
 * قبل از رفع: `backupService.apply` هیچ گیتی نداشت و IPC مستقیم صدایش می‌زد.
 * این مخرب‌ترین عملیات کل برنامه است:
 *
 *   • `mode: 'replace'` کل دیتابیس زنده را با یک فایل دلخواه جایگزین می‌کند —
 *     هر فاکتور، پرداخت و **هر ردیف AuditLog** یک‌جا ناپدید می‌شود.
 *   • `mode: 'merge'` داده‌ی دلخواه را به دفاتر مالی تزریق می‌کند.
 *
 * یعنی کوتاه‌ترین مسیر برای پاک کردن ردّ دزدی این بود: یک بکاپ *قبل از*
 * عملیات را «جایگزینی کامل» کن. بکاپ ایمنیِ خودکار هم مانع نبود، چون همان
 * کاربر می‌توانست پاکش کند. کل هدف بند ۴-۳۰ («هر actor در Audit») با یک
 * کلیک بی‌رمز دور می‌خورد.
 *
 * انتظار بعد: تأیید مدیر **قبل از هر عمل جانبی** گرفته شود (نه بکاپ ایمنی، نه
 * بستن اتصال، نه ردیف Audit)، و سطح تأییدکننده در سابقه ثبت شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s181-backup-apply-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s181-backup-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${g} · انتظار ${w}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)

const SRC = readFileSync('src/main/services/BackupService.ts', 'utf-8')
const UI = readFileSync('src/renderer/src/pages/Settings.tsx', 'utf-8')

// ---------------------------------------------------------------------------
/**
 * به‌روزرسانی نشست ۱۸۴ — گیت به نسخه‌ی «همیشه رمز» ارتقا یافت
 * (`assertPanelPasswordStrict`): قفلِ خاموشِ ماژول دیگر دورش نمی‌زند.
 * رفتار سنجیده‌شده همان است، فقط سخت‌گیرتر.
 */
console.log('\n— ۱) گیت وجود دارد و روی پنلِ همیشه‌قفل است —')
ok('BackupService تابع گیت را import می‌کند', /import\s*\{\s*assertPanelPasswordStrict\s*\}/.test(SRC))
ok('apply رمز مدیر را در ورودی می‌پذیرد', /managerPassword\?: string \| null/.test(SRC))
ok('گیت صدا زده می‌شود', SRC.includes('await assertPanelPasswordStrict('))
ok('روی کلید پنل تنظیمات است', /assertPanelPasswordStrict\(\s*PANEL_KEYS\.settings/.test(SRC))

{
  /**
   * چرا `settings` مهم است: این کلید در `ALWAYS_LOCKED_PANELS` است، یعنی حتی
   * اگر مدیر قفل ماژول‌ها را خاموش کند، این عملیات همچنان رمز می‌خواهد.
   * اگر روزی از این فهرست بیرون بیاید، گیت بی‌صدا بی‌اثر می‌شود.
   */
  const panels = await import('../../src/shared/panels.ts')
  ok('پنل تنظیمات در ALWAYS_LOCKED_PANELS است (گیت با خاموش کردن قفل دور نمی‌خورد)',
    panels.ALWAYS_LOCKED_PANELS.includes(panels.PANEL_KEYS.settings))
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) تأیید *قبل از* هر عمل جانبی گرفته می‌شود —')
/**
 * ترتیب حیاتی است. اگر گیت بعد از `copyFile(databaseFile(), safety)` یا بعد از
 * `prisma.$disconnect()` بنشیند، یک تلاش ناموفق هم اثر جانبی جا می‌گذارد.
 */
{
  const body = SRC.slice(SRC.indexOf('async apply(input: {'))
  const iGate = body.indexOf('assertPanelPasswordStrict(')
  const marks = {
    'resolve فایل': body.indexOf('await this.resolve('),
    'گرفتن بکاپ ایمنی': body.indexOf('await copyFile(databaseFile()'),
    'قطع اتصال دیتابیس': body.indexOf('await prisma.$disconnect()'),
    'نوشتن ردیف Audit': body.indexOf('action: AuditAction.BACKUP_RESTORE'),
    'اجرای ادغام': body.indexOf('await mergeBackup(')
  }
  ok('گیت اصلاً در بدنه‌ی apply هست', iGate > 0)
  for (const [label, idx] of Object.entries(marks))
    ok(`گیت قبل از «${label}» است`, idx > iGate)
}

// ---------------------------------------------------------------------------
console.log('\n— ۳) رفتار واقعی: بدون رمز رد می‌شود —')
{
  const electron = await import('electron')
  electron.ipcMain.handle = () => {}
  const { backupService } = await import('../../src/main/services/BackupService.ts')

  /**
   * شناسه‌ی بکاپ عمداً وجود ندارد. نکته همین است: اگر گیت **اول** اجرا شود،
   * خطای دریافتی «تأیید مدیر لازم است» می‌شود، نه «فایل پیدا نشد» — یعنی
   * ثابت می‌کند حتی به مرحله‌ی باز کردن فایل هم نرسیده‌ایم.
   */
  const callApply = async (input) => {
    try {
      await backupService.apply(input)
      return 'NO_ERROR'
    } catch (e) {
      return String(e?.message ?? e)
    }
  }

  const noPass = await callApply({ id: 'ناموجود.db', mode: 'replace' })
  ok(`بدون رمز، «جایگزینی کامل» رد می‌شود (${noPass})`, /همیشه رمز می‌خواهد/.test(noPass))
  ok('و پیام درباره‌ی همان عملیات است، نه چیز دیگر', /جایگزینی کامل/.test(noPass))

  const noPassMerge = await callApply({ id: 'ناموجود.db', mode: 'merge' })
  ok(`بدون رمز، «ادغام» هم رد می‌شود (${noPassMerge})`, /همیشه رمز می‌خواهد/.test(noPassMerge))
  ok('پیام ادغام مخصوص خودش است', /ادغام/.test(noPassMerge))

  const wrongPass = await callApply({ id: 'ناموجود.db', mode: 'replace', managerPassword: 'غلط' })
  ok(`رمز غلط هم رد می‌شود (${wrongPass.slice(0, 60)})`, wrongPass !== 'NO_ERROR' && !/پیدا نشد/.test(wrongPass))
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) سابقه‌ی ممیزی: چه کسی تأیید کرد —')
ok('سطح تأییدکننده در ردیف Audit جایگزینی می‌نشیند', /approvedBy: scope/.test(SRC))
ok('ادغام هم ردیف Audit مستقل دارد (قبلاً نداشت)',
  SRC.includes("mode: 'merge', approvedBy: scope"))
{
  const count = (SRC.match(/action: AuditAction\.BACKUP_RESTORE/g) || []).length
  eq('هر دو حالت (جایگزینی و ادغام) ردیف Audit دارند', count, 2)
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) رابط کاربری رمز را می‌گیرد و می‌فرستد —')
/**
 * گیتی که رابط کاربری از آن خبر ندارد، قابلیت را از کار می‌اندازد. این بخش
 * مطمئن می‌شود کاربر واقعاً راهی برای وارد کردن رمز دارد.
 */
ok('فیلد رمز در دیالوگ بازگردانی هست', UI.includes('value={applyPassword}'))
ok('رمز همراه درخواست IPC فرستاده می‌شود', /managerPassword: managerPassword \|\| undefined/.test(UI))
ok('رمز بعد از انصراف پاک می‌شود (در حافظه نمی‌ماند)', UI.includes("setApplyPassword('')"))

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
