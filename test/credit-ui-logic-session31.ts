/**
 * سوییت منطق خالص جلسه ۳۱ — بند ۷ (§۱۳: `copies>1` و لوگوی سند) و نیمه‌ی §۱۰ از
 * بند ۸ (محافظت AuditLog در سبک‌سازی + رمز مدیر).
 *
 * الگوی نشست ۳۰ عیناً ادامه یافته است: هر تصمیم تازه **واقعاً اجرا** می‌شود،
 * شرط SQL روی یک **SQLite واقعی** با نسخه‌ی JS همان تعریف مقایسه می‌گردد، و
 * بخش آخر می‌سنجد که مسیرهای واقعی (`PrintService`, `SettingsService`,
 * `templates.ts`, `MaintenanceService`, `ipc`, `Settings.tsx`) همین‌ها را
 * *مصرف* می‌کنند — «کد هرگز اجرانشده» کلاس باگ همین پروژه بوده است.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  AUDIT_PROTECTED_ACTION_PREFIXES,
  AUDIT_PROTECTED_ENTITIES,
  auditPurgeableSql,
  creditCopyPlan,
  isProtectedAuditRow
} from '../src/shared/credit.ts'
import { DEFAULT_RECEIPT_TEMPLATE, parseReceiptTemplate } from '../src/shared/receipt.ts'

/** همان ترفند جلسه ۳۰: سورس واقعی، فقط با یک specifier قابل‌اجرا برای ESM خالص. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-s31-'))
fs.copyFileSync('src/shared/credit.ts', path.join(tmp, 'credit.ts'))
fs.writeFileSync(
  path.join(tmp, 'creditUi.ts'),
  fs.readFileSync('src/shared/creditUi.ts', 'utf8').replace(/from '\.\/credit'/g, "from './credit.ts'")
)
const ui: any = await import(pathToFileURL(path.join(tmp, 'creditUi.ts')).href)
const creditDocLogo = ui.creditDocLogo
const receiptLogoInherit = ui.receiptLogoInherit
const receiptLogoForSave = ui.receiptLogoForSave
const usableLogoDataUrl = ui.usableLogoDataUrl

let pass = 0
let fail = 0
const out: string[] = []
function check(title: string, fn: () => boolean): void {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e: any) {
    err = ` (${e?.message ?? e})`
  }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err}`)
}

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANS'
const LABEL_LOGO = 'data:image/png;base64,AAAAlabelAAAA'

// ---------------------------------------------------------------------------
// ۱) بند ۷ — نقشه‌ی نسخه‌ها (`creditCopyPlan`) در مسیر واقعی چاپ
// ---------------------------------------------------------------------------
check('۱. سه نسخه از اعتبار چاپ‌نشده ⇒ شماره‌های ۱،۲،۳ و فقط دومی به بعد «نسخه‌ی مجدد»', () => {
  const plan = creditCopyPlan(0, 3)
  return (
    plan.length === 3 &&
    plan.map((c: any) => c.printCount).join(',') === '1,2,3' &&
    plan.map((c: any) => c.reprint).join(',') === 'false,true,true'
  )
})
check('۲. اعتباری که قبلاً ۲ بار چاپ شده: هر دو کاغذ تازه «نسخه‌ی مجدد» و شماره ۳ و ۴', () => {
  const plan = creditCopyPlan(2, 2)
  return plan.map((c: any) => `${c.printCount}:${c.reprint}`).join(' ') === '3:true 4:true'
})
check('۳. سقف ۵ نسخه همان‌جا اعمال می‌شود (ورودی ۹۹ ⇒ ۵ کاغذ)', () => creditCopyPlan(0, 99).length === 5)
check('۴. ورودی خراب ⇒ یک کاغذِ اصل (هیچ‌وقت صفر کاغذ یا NaN)', () => {
  const plan = creditCopyPlan(null, 'x')
  return plan.length === 1 && plan[0].printCount === 1 && plan[0].reprint === false
})
check('۵. `prev = printCount - 1` همان تبدیلی است که سرویس می‌دهد (سند شماره‌ی چاپ *همین* کاغذ را دارد)', () => {
  // creditDocDataFor: printCount = ذخیره‌شده + ۱ ⇒ پس prev همان ذخیره‌شده است
  const stored = 4
  const dataPrintCount = stored + 1
  const plan = creditCopyPlan(dataPrintCount - 1, 1)
  return plan[0].printCount === stored + 1
})

// ---------------------------------------------------------------------------
// ۲) بند ۷ — لوگوی سند و ارث‌بری زنده‌اش از لوگوی لیبل
// ---------------------------------------------------------------------------
check('۶. تیک روشن + dataURL معتبر ⇒ لوگو چاپ می‌شود', () => {
  const l = creditDocLogo({ showLogo: true, logoDataUrl: LOGO, logoHeightMm: 12 })
  return l.show === true && l.src === LOGO && l.heightMm === 12
})
check('۷. تیک خاموش ⇒ لوگو چاپ نمی‌شود (پیش‌فرض قالب رسید هم خاموش است)', () =>
  creditDocLogo({ showLogo: false, logoDataUrl: LOGO }).show === false &&
  DEFAULT_RECEIPT_TEMPLATE.showLogo === false)
check('۸. dataURL ناقص (آیکن شکسته روی کاغذ) ⇒ رد می‌شود', () =>
  creditDocLogo({ showLogo: true, logoDataUrl: 'C:\\logo.png' }).show === false)
check('۹. لوگوی خالی + لوگوی لیبل ⇒ از لیبل پر می‌شود', () =>
  creditDocLogo({ showLogo: true, logoDataUrl: '', fallbackDataUrl: LABEL_LOGO }).src === LABEL_LOGO)
check('۱۰. ارتفاع بی‌معنا به بازه‌ی ۳..۴۰ میلی‌متر می‌چسبد', () =>
  creditDocLogo({ showLogo: true, logoDataUrl: LOGO, logoHeightMm: 900 }).heightMm === 40 &&
  creditDocLogo({ showLogo: true, logoDataUrl: LOGO, logoHeightMm: 0 }).heightMm === 10 &&
  creditDocLogo({ showLogo: true, logoDataUrl: LOGO, logoHeightMm: 1 }).heightMm === 3)
check('۱۱. `receiptLogoInherit`: خالی ⇒ لوگوی لیبل · مقدار خودش ⇒ دست‌نخورده · آشغال ⇒ خالی', () =>
  receiptLogoInherit('', LABEL_LOGO) === LABEL_LOGO &&
  receiptLogoInherit(LOGO, LABEL_LOGO) === LOGO &&
  receiptLogoInherit('x', 'y') === '')
check('۱۲. `receiptLogoForSave`: مقدارِ ارث‌بری‌شده ذخیره نمی‌شود (ارث‌بری زنده می‌ماند)', () =>
  receiptLogoForSave(LABEL_LOGO, LABEL_LOGO) === '' && receiptLogoForSave('', LABEL_LOGO) === '')
check('۱۳. `receiptLogoForSave`: لوگوی *متفاوتِ* کاربر ذخیره می‌شود', () =>
  receiptLogoForSave(LOGO, LABEL_LOGO) === LOGO)
check('۱۴. چرخه‌ی واقعی خواندن⇄ذخیره: عوض شدن لوگوی لیبل روی سند اثر می‌گذارد', () => {
  // خواندن (SettingsService.receiptTemplate) ⇒ ذخیره (saveBundle) ⇒ خواندن دوباره با لوگوی *جدید* لیبل
  const stored = ''
  const read1 = receiptLogoInherit(stored, LABEL_LOGO)
  const saved = receiptLogoForSave(read1, LABEL_LOGO)
  const NEW_LABEL = 'data:image/png;base64,NEWNEWNEW'
  const read2 = receiptLogoInherit(saved, NEW_LABEL)
  return read1 === LABEL_LOGO && saved === '' && read2 === NEW_LABEL
})
check('۱۵. سه فیلد لوگو واقعاً در قالب رسید هستند و پارسر پیش‌فرض‌شان را می‌دهد', () => {
  const t = parseReceiptTemplate(null)
  return t.showLogo === false && t.logoHeightMm === 10 && t.logoDataUrl === ''
})
check('۱۶. `usableLogoDataUrl` همان معیار یکتای «تصویر قابل چاپ» است', () =>
  usableLogoDataUrl(' ' + LOGO + ' ') === LOGO && usableLogoDataUrl('http://x/y.png') === '')

// ---------------------------------------------------------------------------
// ۳) بند ۸ · §۱۰ — شرط پاک‌سازی لاگ روی یک SQLite واقعی
// ---------------------------------------------------------------------------
check('۱۷. شرط `auditPurgeableSql` نقیض «محافظت‌شده» است و پارامترهایش کامل‌اند', () => {
  const p = auditPurgeableSql()
  return (
    p.sql.startsWith('NOT (') &&
    p.params.length === AUDIT_PROTECTED_ENTITIES.length + AUDIT_PROTECTED_ACTION_PREFIXES.length
  )
})
check('۱۸. [REAL SQLITE] همان DELETE روی دیتابیس واقعی، مو‌به‌مو مثل نسخه‌ی JS رفتار می‌کند', () => {
  const rows = [
    { id: 1, entity: 'SaleInvoice', action: 'SALE_CREATE', at: 10 },
    { id: 2, entity: 'StoreCredit', action: 'CREDIT_ISSUE', at: 10 },
    { id: 3, entity: 'Setting', action: 'CREDIT_SETTINGS_UPDATE', at: 20 },
    { id: 4, entity: 'StoreCreditRedemption', action: 'X', at: 30 },
    { id: 5, entity: ' StoreCredit ', action: 'WHATEVER', at: 40 },
    { id: 6, entity: 'Database', action: 'DATA_ARCHIVE_PURGE', at: 50 },
    { id: 7, entity: 'Setting', action: 'CREDITX_FAKE', at: 60 },
    { id: 8, entity: 'StoreCreditBatch', action: 'CREDIT_BULK', at: 70 },
    { id: 9, entity: 'SaleInvoice', action: 'SALE_UPDATE', at: 999 },
    { id: 10, entity: 'Setting', action: 'store_credit_touch', at: 80 }
  ]
  const script = path.join(tmp, 'sqlite-check.ts')
  fs.writeFileSync(
    script,
    `import { DatabaseSync } from 'node:sqlite'\n` +
      `import { auditPurgeableSql } from './credit.ts'\n` +
      `const rows = ${JSON.stringify(rows)}\n` +
      `const db = new DatabaseSync(':memory:')\n` +
      `db.exec('CREATE TABLE "AuditLog" (id INTEGER PRIMARY KEY, entity TEXT, action TEXT, at INTEGER)')\n` +
      `const ins = db.prepare('INSERT INTO "AuditLog" (id, entity, action, at) VALUES (?, ?, ?, ?)')\n` +
      `for (const r of rows) ins.run(r.id, r.entity, r.action, r.at)\n` +
      `const p = auditPurgeableSql()\n` +
      "db.prepare(`DELETE FROM \"AuditLog\" WHERE \"at\" < ? AND ${p.sql}`).run(100, ...(p.params as any[]))\n" +
      `const left = db.prepare('SELECT id FROM "AuditLog" ORDER BY id').all().map((r: any) => Number(r.id))\n` +
      `console.log(JSON.stringify(left))\n`
  )
  const raw = execFileSync(process.execPath, ['--experimental-sqlite', '--experimental-strip-types', script], {
    cwd: tmp,
    stdio: 'pipe',
    timeout: 60000
  })
  const left: number[] = JSON.parse(String(raw).trim().split('\n').pop() as string)
  // نسخه‌ی JS همان تعریف: ردیف می‌ماند اگر تازه باشد یا محافظت‌شده
  const expect = rows.filter((r) => !(r.at < 100 && !isProtectedAuditRow(r.entity, r.action))).map((r) => r.id)
  return left.join(',') === expect.join(',') && left.includes(2) && left.includes(5) && !left.includes(1)
})

// ---------------------------------------------------------------------------
// ۴) گزاره‌های ساختاری — *مصرف* واقعی هر تصمیم
// ---------------------------------------------------------------------------
const print = fs.readFileSync('src/main/services/PrintService.ts', 'utf8')
const tplSrc = fs.readFileSync('src/main/print/templates.ts', 'utf8')
const settingsSvc = fs.readFileSync('src/main/services/SettingsService.ts', 'utf8')
const maint = fs.readFileSync('src/main/services/MaintenanceService.ts', 'utf8')
const types = fs.readFileSync('src/shared/types.ts', 'utf8')
const ipc = fs.readFileSync('src/main/ipc/index.ts', 'utf8')
const settingsTsx = fs.readFileSync('src/renderer/src/pages/Settings.tsx', 'utf8')
const printCreditBody = print.slice(print.indexOf('async printCredit('), print.indexOf('async creditBatchIds('))

check('۱۹. بند ۷: `printCredit` واقعاً از `creditCopyPlan` رد می‌شود و حلقه‌ی دستی `copies` رفته است', () =>
  printCreditBody.includes('creditCopyPlan(data.printCount - 1, input.copies)') &&
  !printCreditBody.includes('for (let i = 0; i < copies; i++)'))
check('۲۰. بند ۷: هر کاغذ *دوباره* رندر می‌شود (نه یک HTML ثابت N بار)', () =>
  printCreditBody.includes('printCount: copy.printCount, reprint: copy.reprint') &&
  /creditDocHtml\(\{ \.\.\.data,/.test(printCreditBody))
check('۲۱. بند ۷: `markPrinted` داخل حلقه‌ی کاغذها است (پس شمارنده و AuditLog تعداد واقعی را می‌دانند)', () => {
  const loop = printCreditBody.slice(printCreditBody.indexOf('for (const copy of plan)'))
  return loop.includes('markPrinted(') && loop.indexOf('printHtml(') < loop.indexOf('markPrinted(')
})
check('۲۲. بند ۷: تعداد برگشتی همان تعداد کاغذِ *واقعی* است', () => printCreditBody.includes('copies: plan.length'))
check('۲۳. بند ۷: قالب سند واقعاً `creditDocLogo` را مصرف می‌کند و ادعای «این قالب لوگو ندارد» رفته است', () =>
  tplSrc.includes("import { creditDocLogo } from '@shared/creditUi'") &&
  tplSrc.includes('const logo = creditDocLogo(t)') &&
  tplSrc.includes('class="logo"') &&
  !tplSrc.includes('این قالب لوگو ندارد'))
check('۲۴. بند ۷: لوگو *بالای* نام فروشگاه رندر می‌شود', () => {
  // فقط بدنه‌ی `creditDocBody` سنجیده می‌شود: رسیدهای دیگر هم `<h1>` نام فروشگاه دارند
  const body = tplSrc.slice(tplSrc.indexOf('function creditDocBody'), tplSrc.indexOf('export function creditDocHtml'))
  return (
    body.indexOf('const logo = creditDocLogo(t)') > 0 &&
    body.indexOf('const logo = creditDocLogo(t)') < body.indexOf('<h1>${escapeHtml(d.shopName')
  )
})
check('۲۵. بند ۷: `receiptTemplate()` ارث‌بری لوگو را انجام می‌دهد و `saveBundle` قرینه‌اش را', () =>
  settingsSvc.includes('receiptLogoInherit(tpl.logoDataUrl, label.logoDataUrl)') &&
  settingsSvc.includes('receiptLogoForSave(receipt.logoDataUrl, labelLogo)'))
check('۲۶. بند ۷: تیک و ارتفاع لوگو در بلوک قالب رسید تنظیمات هست (وگرنه کاربر راهی برای روشن کردنش ندارد)', () =>
  settingsTsx.includes("['showLogo',") && /logoHeightMm: Math\.min\(40, Math\.max\(3,/.test(settingsTsx))
check('۲۷. بند ۸ §۱۰: DELETE خامِ لاگ رفته و شرط محافظت واقعاً به DELETE بسته شده است', () =>
  !/DELETE FROM "AuditLog" WHERE "at" < \?`, cutoffDate\)/.test(maint) &&
  maint.includes('const p = auditPurgeableSql()') &&
  maint.includes('AND ${p.sql}'))
check('۲۸. بند ۸ §۱۰: پیش‌نمایش با *همان* شرط شمرده می‌شود (عدد پیش‌نمایش = واقعیت)', () =>
  maint.includes('const purgeable = auditPurgeableSql()') &&
  maint.includes('AND ${purgeable.sql}') &&
  maint.includes('AND ${protectedRows.sql}'))
check('۲۹. بند ۸ §۱۰: رمز مدیر لازم است و **قبل از** باز شدن تراکنش سنجیده می‌شود (قاعده‌ی بن‌بست SQLite)', () =>
  maint.includes("assertManagerPassword(input?.managerPassword, 'پاک‌سازی لاگ عملیات در سبک‌سازی')") &&
  maint.indexOf('assertManagerPassword(input?.managerPassword') < maint.indexOf('await prisma.$transaction('))
check('۳۰. بند ۸ §۱۰: نبودن رمز فقط همان یک مرحله را رد می‌کند (نه کل سبک‌سازی) و هشدار می‌دهد', () =>
  /auditPurged = false/.test(maint) && maint.includes('warnings.push(') && maint.includes('if (auditPurged) {'))
check('۳۱. بند ۸ §۱۰: عدد خروجی هم دروغ نمی‌گوید (لاگ پاک‌نشده ⇒ صفر)', () =>
  maint.includes('auditLogs: auditPurged ? before.auditLogs : 0'))
check('۳۲. بند ۸ §۱۰: قرارداد `MaintenancePreview`/`MaintenanceResult` تازه شد', () =>
  types.includes('auditLogsProtected: number') &&
  types.includes('auditPurged: boolean') &&
  types.includes('warnings: string[]'))
check('۳۳. بند ۸ §۱۰: UI رمز را می‌فرستد، هشدار را نشان می‌دهد و عدد محافظت‌شده را می‌گوید', () =>
  settingsTsx.includes('managerPassword: slimAudit ? slimManagerPw : undefined') &&
  settingsTsx.includes('slimResult.warnings') &&
  settingsTsx.includes('slimPreview.auditLogsProtected'))
check('۳۴. بند ۸ §۱۰: IPC هم payload رمز و هم `userId` صاحب عمل را رد می‌کند', () =>
  ipc.includes('maintenanceService.archivePurge(await withUser('))
check('۳۵. قاعده‌ی محل تصمیم‌ها نگه داشته شد: تصمیم نمایشی در `creditUi`، هیچ‌کدام در JSX', () => {
  const uiSrc = fs.readFileSync('src/shared/creditUi.ts', 'utf8')
  return (
    uiSrc.includes('export function receiptLogoInherit') &&
    uiSrc.includes('export function receiptLogoForSave') &&
    !settingsTsx.includes('startsWith(\'data:\')') &&
    !tplSrc.includes("startsWith('data:')")
  )
})

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 31): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
