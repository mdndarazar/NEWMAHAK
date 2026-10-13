/**
 * SET-001 — saveBundle باید پیش از نخستین write همه‌ی گیت‌ها را رد کند و
 * Setting/Audit را در یک تراکنش نگه دارد. این PoC رفتاری، تغییر رسید همراه با
 * RAW-کردنِ تاییدنشده‌ی لیبل را می‌فرستد؛ درخواست باید رد شود و رسید قبلی
 * حتی با وجود قرارگرفتن پیش از لیبل در ترتیب ذخیره، دست‌نخورده بماند.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-set001-settings-bundle-atomic.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-set001-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { resetRawTrial } = await import('../../src/main/print/raw/gate.ts')
const { SETTING_KEYS } = await import('@shared/receipt')
const db = harnessClient()

let ok = 0
let bad = 0
const check = (label, value, detail = '') => {
  if (value) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// وضعیت معلومِ آغاز: RAW خاموش و هیچ آزمون RAW موفقی در این اجرا ثبت نشده است.
const initial = await settingsService.bundle()
await settingsService.saveBundle({ label: { ...initial.label, printMethod: 'CHROMIUM' } })
resetRawTrial()

const before = await settingsService.bundle()
const receiptBefore = await db.setting.findUnique({ where: { key: SETTING_KEYS.receiptTemplate } })
const labelBefore = await db.setting.findUnique({ where: { key: SETTING_KEYS.labelTemplate } })
const auditBefore = await db.auditLog.count()

let error = null
try {
  await settingsService.saveBundle({
    receipt: { ...before.receipt, footerLine1: 'رسید نباید در SET-001 ذخیره شود' },
    label: { ...before.label, printMethod: 'RAW' }
  })
} catch (e) {
  error = e
}

check('تغییر RAW تاییدنشده‌ی لیبل رد شد', /چاپ آزمایشی|RAW/.test(String(error?.message ?? error)))
const receiptAfter = await db.setting.findUnique({ where: { key: SETTING_KEYS.receiptTemplate } })
const labelAfter = await db.setting.findUnique({ where: { key: SETTING_KEYS.labelTemplate } })
const auditAfter = await db.auditLog.count()
check('رسیدِ هم‌درخواست هیچ‌گونه persist نشد', receiptAfter?.value === receiptBefore?.value)
check('تنظیم لیبل هم persist نشد', labelAfter?.value === labelBefore?.value)
check('برای تراکنش ردشده AuditLog ایجاد نشد', auditAfter === auditBefore, `${auditBefore} → ${auditAfter}`)

// مسیر موفق نیز باید هر دو Setting و یک Audit را با همان تراکنش ثبت کند.
const successAuditBefore = await db.auditLog.count()
const saved = await settingsService.saveBundle({
  receipt: { ...before.receipt, footerLine1: 'رسید موفق SET-001' },
  label: { ...before.label, showBarcodeText: !before.label.showBarcodeText }
})
const receiptSuccess = await db.setting.findUnique({ where: { key: SETTING_KEYS.receiptTemplate } })
const labelSuccess = await db.setting.findUnique({ where: { key: SETTING_KEYS.labelTemplate } })
check('مسیر موفق تغییر رسید را ذخیره و پاسخ تازه برمی‌گرداند', receiptSuccess?.value?.includes('رسید موفق SET-001') && saved.receipt.footerLine1 === 'رسید موفق SET-001')
check('مسیر موفق تغییر لیبل را هم ذخیره کرد', labelSuccess?.value?.includes(`\"showBarcodeText\":${!before.label.showBarcodeText}`))
check('مسیر موفق دقیقاً یک AuditLog ثبت کرد', (await db.auditLog.count()) === successAuditBefore + 1)

console.log(`\nنتیجه SET-001: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
