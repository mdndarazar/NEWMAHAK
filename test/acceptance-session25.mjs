// Session 25 acceptance harness — «مدیریت اعتبار خرید»: قرارداد UI↔بک‌اند + اصلاحات چاپ/PDF.
//
// چرا این فایل؟ چون جلسه ۲۴ چاپ/PDF و تب گزارشات را وصل کرد ولی **هیچ‌وقت روی
// برنامه‌ی اجراشده اجرا نشد** (نه npm، نه Electron، نه دیتابیس). این هارنس همان
// کلاس باگی را می‌گیرد که کد «هرگز اجرانشده» دارد: کانالی که وجود ندارد، فیلدی
// که بک‌اند نمی‌خواند، گیتی که ثبت نشده، ستونی که با سرستون جابه‌جا شده.
//   • REAL       = همین‌جا واقعاً اجرا می‌شود
//   • STRUCTURAL = گزاره روی سورس واقعی (اجرای کاملش دیتابیس/Electron می‌خواهد)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const read = (f) => fs.readFileSync(f, 'utf8')
let pass = 0, fail = 0
const results = []
function check(id, title, mode, fn) {
  let ok = false, err = ''
  try { ok = fn() === true } catch (e) { ok = false; err = String((e && e.message) || e) }
  if (ok) pass++; else fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${id}. ${title}${err ? ' -> ' + err : ''}`)
}

const svc = read('src/main/services/StoreCreditService.ts')
const printSvc = read('src/main/services/PrintService.ts')
const auditSvc = read('src/main/services/AuditService.ts')
const ipcShared = read('src/shared/ipc.ts')
const ipcMain = read('src/main/ipc/index.ts')
const panels = read('src/shared/panels.ts')
const creditPrint = read('src/shared/creditPrint.ts')
const creditUi = read('src/shared/creditUi.ts')
/**
 * جلسه ۲۸ — UI این ماژول از یک فایل به چهار فایل رفت (صفحه + CreditForms +
 * CreditPickers + CreditDetailView). این سوییت «ساختارِ UI» را می‌سنجد، نه
 * محل فایل را، پس هر چهار را با هم می‌خواند. فاصله‌ها هم یکدست می‌شوند چون JSX
 * تازه چندخطی و قابل‌بازبینی است (دقیقاً همان چیزی که هندآف ۲۷ خواسته بود).
 */
const page = [
  'src/renderer/src/pages/CreditManagement.tsx',
  'src/renderer/src/components/CreditForms.tsx',
  'src/renderer/src/components/CreditPickers.tsx',
  'src/renderer/src/components/CreditDetailView.tsx'
].map(read).join('\n').replace(/\s+/g, ' ')
const reports = read('src/renderer/src/pages/SalesReports.tsx')
const shell = read('src/renderer/src/components/Shell.tsx')
const routes = read('src/renderer/src/main.tsx')
const useSettings = read('src/renderer/src/hooks/useSettings.ts')

/**
 * جلسه ۳۲ — بندهای ۲۷ و ۲۸ از «گزاره روی متن» به «اجرای واقعیِ لایه‌ی مشترک»
 * رفتند، پس همان ترفند سوییت‌های ۳۰/۳۱ لازم شد: سورس واقعی `creditUi.ts` با
 * یک specifier قابل‌اجرا برای ESM خالص در پوشه‌ی موقت کپی و import می‌شود
 * (هیچ تغییر منطقی؛ فقط `./credit` ⇒ `./credit.ts`).
 */
const uiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-s25-ui-'))
fs.copyFileSync('src/shared/credit.ts', path.join(uiTmp, 'credit.ts'))
fs.writeFileSync(
  path.join(uiTmp, 'creditUi.ts'),
  creditUi.replace(/from '\.\/credit'/g, "from './credit.ts'")
)
const ui = await import(pathToFileURL(path.join(uiTmp, 'creditUi.ts')).href)
/**
 * جلسه ۳۳ — بندهای ۱۰/۱۵/۱۶/۲۵/۲۸ از STRUCTURAL به REAL رفتند، پس دو ماژول
 * قاعده هم واقعاً import می‌شوند: `credit.ts` (همان کپیِ بالا) و
 * `creditPrint.ts` که هیچ import نسبی‌ای ندارد و مستقیم خوانده می‌شود.
 */
const rules = await import(pathToFileURL(path.join(uiTmp, 'credit.ts')).href)
const printRules = await import(pathToFileURL(path.resolve('src/shared/creditPrint.ts')).href)
const enums = read('src/shared/enums.ts')
/**
 * جلسه ۳۴ — بندهای ۷ تا ۱۴ و ۱۷ هم REAL شدند و تصمیم‌هایشان نام ستون به Prisma
 * می‌دهند، پس خودِ schema هم خوانده می‌شود (همان ترفند سوییت جلسه ۳۳).
 */
const schema = read('prisma/schema.prisma')
function modelFields(model) {
  const at = schema.indexOf(`model ${model} {`)
  if (at < 0) throw new Error('مدل پیدا نشد: ' + model)
  const body = schema.slice(at, schema.indexOf('\n}', at))
  return [...body.matchAll(/^\s{2}(\w+)\s+\S/gm)].map((m) => m[1])
}
const CREDIT_COLUMNS = modelFields('StoreCredit')

/**
 * کانال‌هایی که UI واقعاً صدا می‌زند = آن‌چه در متن دو فایل است **به‌علاوه‌ی**
 * جدول‌های لایه‌ی مشترک. از جلسه ۳۲ (خروجی‌های `lazy`) و جلسه ۳۳ (نماهای صفحه)
 * دیگر همه‌ی کانال‌ها در JSX تایپ نمی‌شوند: JSX `CH[req.channel]` می‌زند، پس
 * هارنس متنی تنها نصفِ قرارداد را می‌دید.
 */
const sharedChannels = [
  ...Object.values(ui.CREDIT_VIEW_CHANNELS ?? {}),
  ...Object.values(ui.CREDIT_RANGE_EXPORT_CHANNELS ?? {}),
  ...Object.values(ui.CREDIT_OP_CHANNEL ?? {}),
  // جلسه ۳۴ — چاپ/PDF هم از جدول مشترک صدا زده می‌شوند (`CH[req.channel]`)
  ...Object.values(ui.CREDIT_PRINT_OP_CHANNELS ?? {})
]

/* ===========================================================================
 * الف) قرارداد renderer ↔ main — دقیقاً همان چیزی که «اجرا نشدن» پنهانش می‌کند
 * ========================================================================= */
const ipcKeys = [...ipcShared.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'/gm)].map((m) => m[1])
const usedChannels = (src) => [...new Set([...src.matchAll(/CH\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))]

check(1, 'هر کانالی که صفحه‌ی مدیریت اعتبار صدا می‌زند در shared/ipc.ts وجود دارد', 'REAL', () => {
  const used = [...new Set([...usedChannels(page), ...sharedChannels])]
  const missing = used.filter((c) => !ipcKeys.includes(c))
  if (missing.length) throw new Error('کانال ناموجود: ' + missing.join(', '))
  return used.length >= 12
})
check(2, 'هر کانالی که تب تازه‌ی گزارشات صدا می‌زند هم وجود دارد', 'REAL', () => {
  const missing = usedChannels(reports).filter((c) => !ipcKeys.includes(c))
  if (missing.length) throw new Error('کانال ناموجود: ' + missing.join(', '))
  return true
})
check(3, 'هر کانال اعتبار که UI مصرف می‌کند در main یک handler دارد', 'REAL', () => {
  const used = [...new Set([...usedChannels(page), ...usedChannels(reports), ...sharedChannels])]
    .filter((c) => /^(credit|printCredit|storeCredit)/.test(c))
  const missing = used.filter((c) => !ipcMain.includes(`IPC.${c},`))
  if (missing.length) throw new Error('بدون handler: ' + missing.join(', '))
  return used.length >= 15
})
/**
 * جلسه ۳۴ — سه کانال از این چهار کانال دیگر در JSX تایپ نمی‌شوند: بار داده‌شان
 * تصمیمِ `creditPrintOpRequest` (بخش ۱۴) است و صفحه `CH[req.channel]` می‌زند.
 * پس همان‌جا سنجیده می‌شوند، نه با جست‌وجوی متن.
 */
check(4, 'هر چهار کانال چاپ/PDF جلسه ۲۱ واقعاً از UI مصرف می‌شوند (نه روی کاغذ)', 'REAL', () => {
  const opChannels = Object.values(ui.CREDIT_PRINT_OP_CHANNELS ?? {})
  for (const c of ['printCredit', 'printCreditBatch', 'creditPdf'])
    if (!opChannels.includes(c)) throw new Error('کانال چاپ در جدول لایه‌ی مشترک نیست: ' + c)
  // پیش‌نمایش تنها کانالی است که هیچ تصمیمی ندارد (یک `id` می‌گیرد)، پس در JSX می‌ماند
  if (!page.includes('CH.creditPreviewHtml')) throw new Error('کانال پیش‌نمایش مصرف نمی‌شود')
  return /creditPrintOpRequest\(/.test(page)
})
check(5, 'هر کلید پنلی که UI اعتبار با ManagerGate قفل می‌کند در panels.ts و LOCKED_PANELS ثبت شده', 'REAL', () => {
  const keys = [...new Set([...page.matchAll(/PANEL_KEYS\.(\w+)/g), ...reports.matchAll(/PANEL_KEYS\.(\w+)/g)].map((m) => m[1]))]
    .filter((k) => k.startsWith('credit'))
  const missing = keys.filter((k) => !new RegExp(`^\\s{2}${k}:\\s*'`, 'm').test(panels) || !panels.includes(`PANEL_KEYS.${k},`))
  if (missing.length) throw new Error('کلید ثبت‌نشده: ' + missing.join(', '))
  return keys.length >= 2
})
check(6, 'صفحه‌ی مدیریت اعتبار هم route دارد هم آیتم ناوبری', 'STRUCTURAL', () =>
  /path: 'credit-management'/.test(routes) && /<CreditManagement \/>/.test(routes) && /to: '\/credit-management'/.test(shell))

/* ===========================================================================
 * ب) باگ جلسه ۲۴ که جلسه ۲۵ رفع کرد: چاپ گروهی شمارنده‌ی چاپ را نمی‌زد (§۱۳/§۱۰)
 * ========================================================================= */
/**
 * جلسه ۳۴ — REAL شد. «پیش‌فرض روشن» سه بار دستی نوشته شده بود
 * (`markPrinted !== false` در دو مسیر، `=== false` در یکی) و هارنس فقط متنش را
 * می‌دید؛ حالا یک قاعده است و همین‌جا اجرا می‌شود. اهمیتش §۲۴ است: اگر خاموش
 * بماند، از یک اعتبار بی‌نهایت «اصل» بیرون می‌آید بی‌هیچ ردی در AuditLog.
 */
check(7, 'چاپ دسته‌ای/گروهی شمارنده‌ی چاپ را بالا می‌برد (پیش‌فرض روشن، با امکان خاموش‌کردن)', 'REAL', () => {
  for (const v of [undefined, null, true, 0, '', 'false'])
    if (rules.creditShouldMarkPrinted(v) !== true) throw new Error('پیش‌فرض باید روشن بماند: ' + String(v))
  if (rules.creditShouldMarkPrinted(false) !== false) throw new Error('`false`ِ صریح باید خاموشش کند')
  if (rules.CREDIT_MARK_PRINTED_NONE.marked !== 0 || rules.CREDIT_MARK_PRINTED_NONE.reprints !== 0)
    throw new Error('خروجیِ «شمارش نشد» صفر نیست')
  const consumed =
    /creditShouldMarkPrinted\(input\.markPrinted\)/.test(printSvc) && /storeCreditService\.markPrintedMany\(\{/.test(printSvc)
  if (!consumed) throw new Error('سرویس چاپ تصمیم مشترک را مصرف نمی‌کند')
  return !/markPrinted !== false/.test(printSvc) && !/markPrinted === false/.test(printSvc)
})
/**
 * جلسه ۳۴ — REAL شد و یک قرارداد تازه هم می‌گیرد: **نام هر ستونی که این مسیر به
 * Prisma می‌دهد در `schema.prisma` واقعی هست** (ادامه‌ی بندهای ۲۵–۳۱ سوییت ۳۳).
 * `increment` هم فقط «کارایی» نیست: خواندن-و-نوشتن نیست، پس دو صندوقِ همزمان روی
 * یک دسته هیچ نسخه‌ای را گم نمی‌کنند.
 */
check(8, 'markPrintedMany با یک updateMany و increment کار می‌کند، نه N رفت‌وبرگشت (§۵)', 'REAL', () => {
  const now = new Date(0)
  const inc = rules.creditPrintIncrementData(now)
  if (inc.printCount?.increment !== 1) throw new Error('افزایش باید یک واحدِ اتمی باشد')
  if (inc.lastPrintedAt !== now) throw new Error('لحظه‌ی چاپ ثبت نمی‌شود')
  const set = rules.creditPrintSetData('3', now)
  if (set.printCount !== 3 || set.lastPrintedAt !== now) throw new Error('مقدار صریحِ مسیر تکی درست نیست')
  for (const f of [...rules.CREDIT_PRINT_WRITE_FIELDS, ...Object.keys(rules.CREDIT_PRINT_SELECT)])
    if (!CREDIT_COLUMNS.includes(f)) throw new Error('ستون ناموجود در schema: ' + f)
  if (JSON.stringify(rules.creditIdsWhere([2, 1])) !== '{"id":{"in":[2,1]}}') throw new Error('`where`ِ فهرست شناسه‌ها عوض شده')
  const consumed =
    /async markPrintedMany\(/.test(svc) &&
    /data: creditPrintIncrementData\(now\)/.test(svc) &&
    /select: CREDIT_PRINT_SELECT/.test(svc) &&
    /data: creditPrintSetData\(next, now\)/.test(svc)
  if (!consumed) throw new Error('سرویس شکل‌های مشترک را مصرف نمی‌کند')
  return !/for \([^)]*\)\s*await prisma\.storeCredit\.update\(/.test(svc)
})
/**
 * جلسه ۳۴ — REAL شد: خودِ *شکلِ* ردیف لاگ (موجودیت، شناسه، before/after و متن)
 * حالا از `creditPrintAudit`/`creditBatchPrintAudit` می‌آید و همین‌جا اجرا
 * می‌شود. تا دیروز `after` مسیر تکی و مسیر گروهی دو کلید متفاوت داشتند و هیچ
 * گزاره‌ای نمی‌توانست بگوید کدام درست است.
 */
check(9, 'چاپ گروهی روی *خودِ هر اعتبار* لاگ می‌زند، پس Timeline جزئیات آن را می‌بیند (§۱۰)', 'REAL', () => {
  const log = rules.creditPrintAudit({ entityId: 7, code: 'A1', prev: 1, channel: 'PRINT', group: true, batchId: 9 })
  if (log.entity !== 'StoreCredit') throw new Error('ردیف روی خودِ اعتبار نمی‌نشیند: ' + log.entity)
  if (log.entityId !== 7) throw new Error('شناسه‌ی ردیف اشتباه است')
  if (log.action !== 'CREDIT_REPRINT') throw new Error('عملِ نسخه‌ی مجدد با آستانه جور نیست')
  const after = JSON.parse(log.after)
  if (after.printCount !== 2 || after.batchId !== 9) throw new Error('بار دادهٔ after ناقص است: ' + log.after)
  if (!/گروهی/.test(log.note) || !/نسخه‌ی مجدد/.test(log.note)) throw new Error('متن ردیف گروهی درست نیست: ' + log.note)
  const summary = rules.creditBatchPrintAudit({ batchId: 9, count: 3, reprints: 2, channel: 'PDF' })
  if (summary.entity !== 'StoreCreditBatch' || summary.entityId !== 9) throw new Error('ردیف خلاصه روی دسته نمی‌نشیند')
  if (summary.action !== 'CREDIT_PRINT') throw new Error('عملِ ردیف خلاصه باید چاپ باشد')
  for (const m of Object.values(rules.CREDIT_PRINT_ENTITIES))
    if (!new RegExp(`model ${m} \\{`).test(schema)) throw new Error('موجودیت لاگ یک مدل واقعی Prisma نیست: ' + m)
  const consumed = /auditMany\(\s*prisma,/.test(svc) && /creditPrintAudit\(/.test(svc) && /creditBatchPrintAudit\(/.test(svc)
  if (!consumed) throw new Error('سرویس شکل مشترک ردیف لاگ را مصرف نمی‌کند')
  return /export async function auditMany/.test(auditSvc) && /createMany/.test(auditSvc)
})
/**
 * جلسه ۳۳ — این بند REAL شد. آستانه‌ی «نسخه‌ی مجدد» در پنج نقطه دستی نوشته شده
 * بود (`>= 1` در سه جا، `>= 2` در یک جا، و `prev + i >= 1` در `creditCopyPlan`)
 * و هیچ تستی اجرایش نمی‌کرد؛ حالا یک تصمیمِ مشترک است و همین‌جا **اجرا** می‌شود.
 */
check(10, 'تصمیم نسخه‌ی مجدد از printCount قبلی هر ردیف می‌آید (نه یک برچسب سراسری)', 'REAL', () => {
  if (rules.isCreditReprint(0) !== false) throw new Error('نسخه‌ی اول نباید «مجدد» باشد')
  if (rules.isCreditReprint(1) !== true || rules.isCreditReprint(7) !== true) throw new Error('نسخه‌ی دوم به بعد باید «مجدد» باشد')
  if (rules.creditPrintAction(0) !== 'CREDIT_PRINT' || rules.creditPrintAction(1) !== 'CREDIT_REPRINT')
    throw new Error('عملِ AuditLog با آستانه جور نیست')
  // هر دو کلید باید در `AuditAction` واقعی وجود داشته باشند (سرویس `AuditAction[key]` می‌زند)
  for (const k of ['CREDIT_PRINT', 'CREDIT_REPRINT'])
    if (!new RegExp(`\\b${k}\\s*[:=]`).test(enums)) throw new Error('کلید ناموجود در enums: ' + k)
  // شمارشِ گروهی و نقشه‌ی نسخه‌ها از همان آستانه می‌آیند
  if (rules.creditReprintCount([0, 0, 1, 5]) !== 2) throw new Error('شمارش نسخه‌های مجدد درست نیست')
  const plan = rules.creditCopyPlan(0, 3)
  if (plan.map((c) => c.reprint).join(',') !== 'false,true,true') throw new Error('کاغذ دوم به بعد باید «مجدد» بخورد')
  // و سرویس همین تصمیم را مصرف می‌کند، نه یک مقایسه‌ی محلی
  // جلسه ۳۴ — مصرف‌کننده عوض شد (نه حذف): عملِ لاگ از `creditPrintAudit` می‌آید
  const consumed = /AuditAction\[log\.action\]/.test(svc) && /creditPrintAudit\(/.test(svc) && /creditReprintCount\(/.test(svc)
  if (!consumed) throw new Error('سرویس تصمیم مشترک را مصرف نمی‌کند')
  return !/>= 1 \? AuditAction|next >= 2 \? AuditAction/.test(svc)
})
/** جلسه ۳۴ — REAL شد: خودِ ردیفِ «PDF بدون شمارش» اجرا و سنجیده می‌شود. */
check(11, 'PDF دسته‌ای دیگر خودش را «تولید گروهی اعتبار» جا نمی‌زند', 'REAL', () => {
  const one = rules.creditPdfAuditOnly({ single: true, id: 4, count: 1, file: '/a.pdf' })
  const many = rules.creditPdfAuditOnly({ single: false, batchId: 9, count: 5, file: '/a.pdf' })
  if (one.action !== 'CREDIT_PRINT' || many.action !== 'CREDIT_PRINT') throw new Error('عمل لاگ باید چاپ باشد')
  if (one.entity !== 'StoreCredit' || many.entity !== 'StoreCreditBatch') throw new Error('موجودیت لاگ جابه‌جا شده')
  if (one.entityId !== 4 || many.entityId !== 9) throw new Error('شناسه‌ی لاگ اشتباه است')
  const after = JSON.parse(many.after)
  if (after.markPrinted !== false || after.pdf !== true) throw new Error('after باید بگوید شمارنده دست نخورد')
  if (!/بدون شمارش نسخه/.test(many.note)) throw new Error('متن لاگ گویا نیست')
  return !/action:[^\n]*CREDIT_BULK_GENERATE/.test(printSvc) && /creditPdfAuditOnly\(/.test(printSvc)
})
/** جلسه ۳۴ — REAL شد: «کدام مسیرِ شمارش، با چه کانالی» یک تصمیم اجراشدنی است. */
check(12, 'PDF هم یک نسخه‌ی واقعی است ⇒ شمارنده را می‌زند (تکی و گروهی)، با کانال PDF در لاگ', 'REAL', () => {
  const single = rules.creditPdfMarkPlan({ single: true })
  const many = rules.creditPdfMarkPlan({ single: false })
  const off = rules.creditPdfMarkPlan({ single: true, markPrinted: false })
  if (single.kind !== 'single' || many.kind !== 'many' || off.kind !== 'auditOnly') throw new Error('مسیر شمارش اشتباه است')
  if (single.channel !== 'PDF' || many.channel !== 'PDF') throw new Error('کانال PDF در لاگ نمی‌نشیند')
  if (!rules.CREDIT_PRINT_CHANNELS.includes('PDF')) throw new Error('کانال PDF در فهرست رسمی نیست')
  const log = rules.creditPrintAudit({ entityId: 3, code: 'A', prev: 0, channel: 'PDF', file: '/x.pdf' })
  if (JSON.parse(log.after).channel !== 'PDF') throw new Error('کانال در after ثبت نمی‌شود')
  if (!/خروجی PDF/.test(log.note)) throw new Error('متن لاگ کانال را نمی‌گوید')
  const consumed = /creditPdfMarkPlan\(/.test(printSvc) && /channel: markPlan\.channel/.test(printSvc)
  if (!consumed) throw new Error('سرویس PDF تصمیم مشترک را مصرف نمی‌کند')
  return /channel\?: 'PRINT' \| 'PDF'/.test(svc)
})
/** جلسه ۳۴ — REAL شد: خودِ تصمیمِ «لغو» اجرا می‌شود، به‌علاوه‌ی *ترتیب* در سرویس. */
check(13, 'لغو پنجره‌ی ذخیره ⇒ هیچ فایلی، هیچ شمارشی، هیچ لاگی', 'REAL', () => {
  const canceled = rules.creditPdfSaveOutcome({ canceled: true, filePath: '/x.pdf' }, '/d/f.pdf')
  if (canceled.saved !== false || canceled.file !== null) throw new Error('لغو باید بدون فایل برگردد')
  if (rules.creditPdfSaveOutcome({ canceled: false, filePath: '   ' }, '/d/f.pdf').saved !== false)
    throw new Error('مسیر خالی هم یعنی لغو')
  if (rules.creditPdfSaveOutcome({ canceled: false, filePath: '/p.pdf' }, '/d/f.pdf').file !== '/p.pdf')
    throw new Error('مسیر انتخابی کاربر محترم نیست')
  const noAsk = rules.creditPdfSaveOutcome(null, '/d/f.pdf')
  if (noAsk.saved !== true || noAsk.file !== '/d/f.pdf') throw new Error('مسیر بی‌پرسش (`ask: false`) باید پیش‌فرض را بنویسد')
  // و در سرویس: بازگشتِ لغو *قبل از* نوشتن فایل و قبل از هر شمارشی است
  const body = printSvc.slice(printSvc.indexOf('async creditPdf('))
  const outcome = body.indexOf('creditPdfSaveOutcome(')
  const ret = body.indexOf('if (!outcome.saved || !outcome.file) return')
  // نشست ۱۲۹: نوشتن PDF «همه یا هیچ» شد (writeFileAtomic)؛ قاعده‌ی ترتیب همان است
  const write = body.search(/await writeFile(?:Atomic)?\(file, pdf\)/)
  const mark = body.indexOf('creditPdfMarkPlan(')
  if (!(outcome > 0 && ret > outcome && write > ret && mark > write)) throw new Error('ترتیب لغو/نوشتن/شمارش در سرویس درست نیست')
  return true
})
/** جلسه ۳۴ — REAL شد: «چند بار رندر» یک عددِ مشترک است، نه یک عادتِ نوشتاری. */
check(14, 'PDF دسته‌ای یک بار رندر می‌شود، نه دو بار (باگ کارایی جلسه ۲۴)', 'REAL', () => {
  const one = rules.creditPdfRenderPlan(true)
  const batch = rules.creditPdfRenderPlan(false)
  if (one.batchRenders !== 0) throw new Error('سند تکی نباید کل دسته را رندر کند')
  if (batch.batchRenders !== 1) throw new Error('دسته باید *یک* بار رندر شود')
  const body = printSvc.slice(printSvc.indexOf('async creditPdf('), printSvc.indexOf('async labelTemplateFor('))
  if (!/creditPdfRenderPlan\(single\)/.test(body)) throw new Error('سرویس نقشه‌ی رندر را مصرف نمی‌کند')
  return (body.match(/creditBatchRender\(/g) || []).length === 1 && !/creditBatchDocs\(/.test(body)
})
/** جلسه ۳۳ — REAL شد: کلمپ واقعاً اجرا می‌شود، نه اینکه رشته‌اش دیده شود. */
check(15, '§۲۱ — perPage از renderer کلمپ می‌شود و مستقیم داخل قالب نمی‌رود', 'REAL', () => {
  const a4 = { widthMm: 210, heightMm: 297 }
  const thermal = { widthMm: 80, heightMm: null }
  const max = printRules.CREDIT_PER_PAGE_MAX
  if (printRules.creditBatchPerPage(a4, 0) !== 4) throw new Error('perPage=0 باید به پیش‌فرض کاغذ برگردد')
  if (printRules.creditBatchPerPage(a4, -3) !== 4) throw new Error('perPage منفی باید بی‌اثر باشد')
  if (printRules.creditBatchPerPage(a4, 1e9) !== max) throw new Error('perPage نجومی باید به سقف برسد')
  if (printRules.creditBatchPerPage(thermal, undefined) !== 1) throw new Error('رسید حرارتی = یک سند در هر صفحه')
  if (printRules.creditBatchPerPage(a4, 3) !== 3) throw new Error('مقدار معتبر باید محترم بماند')
  return /creditBatchPerPage\(paper, input\?\.perPage\)/.test(printSvc)
})
/** جلسه ۳۳ — REAL شد: سقف روی هر دو مسیر واقعاً اجرا و مقایسه می‌شود. */
check(16, 'سقف سند در هر فایل یک قاعده‌ی مشترک است (هم ids دستی، هم کل دسته)', 'REAL', () => {
  const max = printRules.CREDIT_PRINT_MAX_DOCS
  const many = Array.from({ length: max + 1 }, (_, i) => i + 1)
  const capped = printRules.applyCreditPrintCap(many)
  if (capped.ids.length !== max || capped.requested !== max + 1 || capped.capped !== true)
    throw new Error('سقف مسیر دسته اعمال نشد')
  const ok = printRules.applyCreditPrintCap([3, 1, 1, 2])
  if (ok.ids.join(',') !== '1,2,3' || ok.capped !== false) throw new Error('پاک‌سازی id ها درست نیست')
  // همان سقف روی ids دستیِ نقشه‌ی چاپ هم می‌نشیند (یک قاعده، دو مسیر)
  const plan = printRules.creditPrintPlan({ ids: many }, { widthMm: 210, heightMm: 297 })
  if (plan.ids.length !== max || plan.capped !== true) throw new Error('سقف مسیر ids دستی اعمال نشد')
  // نشست ۱۵۹ (S159-D4): از نشست ۱۰۷ مسیر دسته با count واقعی بازنویسی شد (متغیر list دیگر نیست)؛
  // قاعده همان است: هر دو مسیر (ids دستی و کل دسته) از applyCreditPrintCap می‌گذرند.
  return /applyCreditPrintCap\(explicit\)/.test(printSvc) && /applyCreditPrintCap\(listed\.map\(/.test(printSvc)
})
/**
 * جلسه ۳۴ — REAL شد از دو سر: *شکلِ خروجی* سرویس (`creditPrintBatchResult`) و
 * *متنی که کاربر می‌بیند* (`creditPrintFlash`). تا دیروز همین متن سه بار در JSX
 * نوشته شده بود و هارنس فقط وجود رشته‌ی `res.capped` را می‌دید.
 */
check(17, 'کاربر می‌فهمد سقف خورده: count/total/capped تا خودِ UI بالا می‌آید', 'REAL', () => {
  const res = rules.creditPrintBatchResult({ ids: [1, 2], total: 9, capped: true, marked: { marked: 2, reprints: 1 } })
  for (const k of ['ok', 'count', 'total', 'capped', 'marked', 'reprints'])
    if (!(k in res)) throw new Error('کلیدِ خروجی جا مانده: ' + k)
  if (res.count !== 2 || res.total !== 9 || res.capped !== true || res.reprints !== 1) throw new Error('اعداد خروجی درست نیستند')
  const flash = ui.creditPrintFlash('batch', res, (v) => String(v))
  if (!/سقف هر فایل/.test(flash) || !flash.includes('9') || !flash.includes('2'))
    throw new Error('متنِ سقف‌خوردگی عدد واقعی را نمی‌گوید: ' + flash)
  if (!/نسخه‌ی مجدد/.test(flash)) throw new Error('تعداد نسخه‌ی مجدد دیده نمی‌شود')
  const ok = ui.creditPrintFlash('batch', { count: 2, total: 2, capped: false }, (v) => String(v))
  if (/سقف هر فایل/.test(ok)) throw new Error('بدون سقف نباید هشدار بدهد')
  if (!/لغو/.test(ui.creditPrintFlash('pdf', { saved: false }, (v) => String(v)))) throw new Error('لغوِ PDF گفته نمی‌شود')
  const consumed = /creditPrintBatchResult\(/.test(printSvc) && /creditPrintFlash\(/.test(page)
  if (!consumed) throw new Error('شکل خروجی یا متنش از لایه‌ی مشترک نمی‌آید')
  return !/res\?\.capped/.test(page) && !/res\.capped/.test(page)
})

/* ===========================================================================
 * ج) UI جلسه ۲۴ — همان چیزهایی که باید چشمی smoke-test شوند، حداقل ساختاری
 * ========================================================================= */
/**
 * جلسه ۳۴ — REAL شد. «چاپ بعدی نسخه‌ی مجدد است» یک `printed >= 1`ِ دستی در JSX
 * بود، یعنی همان آستانه‌ای که بخش ۹.۲ یکی‌اش کرده بود، در صفحه‌ی جزئیات دوباره
 * دست‌نویس شده بود. حالا از `creditDetailPrintBadges` می‌آید و اجرا می‌شود.
 */
check(18, 'جزئیات: چاپ سند + پیش‌نمایش + PDF + شمارنده‌ی چاپ + هشدار نسخه‌ی مجدد', 'REAL', () => {
  const fa = (v) => String(v)
  const none = ui.creditDetailPrintBadges(0, fa)
  if (none.length !== 1 || !none[0].text.includes('0')) throw new Error('نشانِ شمارنده درست نیست')
  const one = ui.creditDetailPrintBadges(1, fa)
  if (one.length !== 2 || one[1].tone !== 'warn' || !/نسخه‌ی مجدد/.test(one[1].text))
    throw new Error('هشدار نسخه‌ی مجدد با آستانه‌ی `isCreditReprint` جور نیست')
  if (ui.creditDetailPrintBadges(9, fa).length !== 2) throw new Error('شمارنده‌ی بزرگ هم باید هشدار بدهد')
  const consumed = /creditDetailPrintBadges\(/.test(page)
  if (!consumed) throw new Error('صفحه‌ی جزئیات نشان‌ها را از لایه‌ی مشترک نمی‌گیرد')
  if (/printed >= 1/.test(page)) throw new Error('آستانه‌ی دستی در JSX مانده است')
  return /onPrint\(1\)/.test(page) && /onPreview/.test(page) && /onPdf/.test(page)
})
check(19, 'پیش‌نمایش = HTML واقعی بک‌اند داخل iframe srcDoc (الگوی Settings.tsx)', 'STRUCTURAL', () =>
  /srcDoc=\{previewHtml \?\? ''\}/.test(page) && /CH\.creditPreviewHtml/.test(page))
/** جلسه ۳۴ — REAL شد: خودِ منطق انتخاب (تیک ردیف، تیک سرستون) اجرا می‌شود. */
check(20, 'فهرست: چک‌باکس ردیف + انتخاب همه + چاپ گروهی/PDF انتخاب‌شده‌ها', 'REAL', () => {
  const rows = [{ id: 3 }, { id: 1 }]
  if (ui.creditAllSelected([], rows) !== false) throw new Error('بدون انتخاب نباید «همه» باشد')
  if (ui.creditAllSelected([1, 3], rows) !== true) throw new Error('انتخاب کامل تشخیص داده نمی‌شود')
  if (ui.creditAllSelected([1], rows) !== false) throw new Error('انتخاب نصفه «همه» شمرده شد')
  if (ui.creditAllSelected([1, 3], []) !== false) throw new Error('فهرست خالی هرگز «همه» نیست')
  if (ui.creditToggleAll([], rows).join(',') !== '1,3') throw new Error('تیک سرستون همه‌ی ردیف‌ها را نمی‌گیرد')
  if (ui.creditToggleAll([1, 3], rows).length !== 0) throw new Error('تیک دوباره باید همه را پاک کند')
  if (ui.creditToggleRow([1], 3).join(',') !== '1,3') throw new Error('تیک ردیف اضافه نمی‌کند')
  if (ui.creditToggleRow([1, 3], 3).join(',') !== '1') throw new Error('تیک دوباره‌ی ردیف کم نمی‌کند')
  return /creditAllSelected\(selected, rows\)/.test(page) && /creditToggleAll\(selected, rows\)/.test(page) &&
    /checked=\{allSelected\} onChange=\{toggleAll\}/.test(page) && /checked=\{selected\.includes\(r\.id\)\}/.test(page) &&
    /printBatch\(\{ ids: selected \}\)/.test(page) && /savePdf\(\{ ids: selected \}\)/.test(page)
})
/**
 * جلسه ۳۴ — REAL شد و تله‌ی واقعی‌اش هم بسته شد: فهرستِ فیلترهایی که انتخاب را
 * پاک می‌کنند، دیگر یک آرایه‌ی دستی در `useEffect` نیست. گزاره‌ی تازه: **هیچ
 * کلیدِ بار داده‌ی `creditList` از این فهرست جا نمانده باشد** — وگرنه کاربر با
 * فیلترِ عوض‌شده کاغذِ اعتبارهای قبلی را چاپ می‌کند، با شمارنده و لاگ واقعی.
 */
check(21, 'انتخاب با هر تغییر فیلتر پاک می‌شود (چاپ اشتباهِ ردیف‌های قبلی ممکن نیست)', 'REAL', () => {
  const base = { fromJalali: '۱۴۰۴/۰۱/۰۱', toJalali: '۱۴۰۴/۰۱/۳۱', search: 'x', source: 'MANUAL', status: 'ACTIVE' }
  const sig = ui.creditSelectionResetSignature(base)
  for (const k of ['fromJalali', 'toJalali', 'search', 'source', 'status'])
    if (sig === ui.creditSelectionResetSignature({ ...base, [k]: 'دیگر' })) throw new Error('تغییر این فیلتر انتخاب را پاک نمی‌کند: ' + k)
  if (sig !== ui.creditSelectionResetSignature({ ...base, take: 50 })) throw new Error('`take` نباید انتخاب را پاک کند')
  const payload = Object.keys(ui.creditViewRequest('list', { ...base, onlyWithRemaining: true }).payload)
  const missing = payload.filter((k) => k !== 'take' && !ui.CREDIT_SELECTION_RESET_KEYS.includes(k))
  if (missing.length) throw new Error('فیلترِ بی‌اثر روی انتخاب: ' + missing.join(', '))
  return /creditSelectionResetSignature\(/.test(page) && /\}, \[selectionKey\]\)/.test(page)
})
/** جلسه ۳۴ — REAL شد: بار داده‌ی هر عملیات از `creditPrintOpRequest` می‌آید. */
check(22, 'دسته‌ها: «چاپ دسته‌ای» با batchId ⇒ یک Job چندصفحه‌ای', 'REAL', () => {
  const batch = ui.creditPrintOpRequest('batch', { batchId: 9 })
  if (batch.channel !== 'printCreditBatch' || batch.payload.batchId !== 9) throw new Error('کانال یا batchId اشتباه است')
  if ('ids' in batch.payload) throw new Error('مسیر دسته نباید ids بفرستد')
  const pdf = ui.creditPrintOpRequest('pdf', { batchId: 9 })
  if (pdf.channel !== 'creditPdf' || pdf.payload.ask !== true || pdf.payload.reveal !== true)
    throw new Error('PDF باید پنجره‌ی ذخیره را باز کند و فایل را نشان بدهد')
  const ids = ui.creditPrintOpRequest('batch', { ids: [3, 1, 1] })
  if (ids.payload.ids.join(',') !== '1,3') throw new Error('idها یکتا/مرتب نمی‌شوند')
  if (ui.creditPrintOpRequest('batch', {}) !== null) throw new Error('بدون هدف نباید درخواستی ساخته شود')
  return /printBatch\(\{ batchId: b\.id \}\)/.test(page) && /savePdf\(\{ batchId: b\.id \}\)/.test(page) &&
    /creditPrintOpRequest\('batch'/.test(page)
})
/**
 * جلسه ۳۴ — REAL شد. `markPrinted: true` یک *قاعده* است (§۱۳ · §۲۴)، نه یک کلید
 * دستی در JSX: بدون آن از یک اعتبار هر تعداد کاغذِ «اصل» بیرون می‌آید.
 */
check(23, 'چاپ تکی هم مثل قبل markPrinted می‌فرستد و بعدش جزئیات تازه می‌شود', 'REAL', () => {
  const r = ui.creditPrintOpRequest('print', { id: 4, copies: 2 })
  if (r.channel !== 'printCredit') throw new Error('کانال چاپ تکی عوض شده')
  if (r.payload.markPrinted !== true) throw new Error('شمارنده‌ی چاپ باید روشن برود')
  if (r.payload.copies !== 2 || r.payload.silent !== false) throw new Error('تعداد نسخه یا حالت چاپ درست نیست')
  if (ui.creditPrintOpRequest('print', { id: 4, copies: 99 }).payload.copies !== 5) throw new Error('سقف نسخه اعمال نشد')
  if (ui.creditPrintOpRequest('print', { ids: [1] }) !== null) throw new Error('چاپ تکی بدون id نباید درخواست بسازد')
  if (/markPrinted: true/.test(page)) throw new Error('کلید دستی در JSX مانده است')
  return /creditPrintOpRequest\('print'/.test(page) && /await openDetail\(id\)/.test(page)
})

/* ===========================================================================
 * د) تب تازه‌ی گزارشات (جلسه ۲۴) — قفل، بازه‌ی صریح، خروجی اکسل
 * ========================================================================= */
check(24, 'تب تازه پشت ManagerGate است و تا قفل باز نشود هیچ درخواستی نمی‌فرستد', 'STRUCTURAL', () =>
  /panel=\{PANEL_KEYS\.creditManagement\}/.test(reports) && /if \(!open\) \{\s*\n\s*setDashboard\(null\)/.test(reports) &&
  /if \(tab === 'creditManagement'\) return/.test(reports))
/**
 * جلسه ۳۳ — REAL شد و یک تله‌ی تازه هم می‌گیرد: بار داده‌ی این تب از
 * `creditReportRequests` (بخش ۱۳) می‌آید، پس هم بازه واقعاً صریح می‌رود و هم
 * `onlyWithRemaining` — که **فقط `creditList` به آن اثر می‌دهد** — دیگر سهواً
 * برای داشبورد فرستاده نمی‌شود (کاربر تیک می‌زد، جدول کم می‌شد، کارت‌ها نه).
 */
check(25, 'بازه‌ی تاریخ همیشه صریح فرستاده می‌شود (وگرنه creditList پیش‌فرض «امروز» می‌گذارد)', 'REAL', () => {
  const req = ui.creditReportRequests({ fromJalali: '۱۴۰۴/۰۱/۰۱', toJalali: '۱۴۰۴/۰۱/۳۱', onlyWithRemaining: true })
  for (const k of ['fromJalali', 'toJalali'])
    if (!(k in req.dashboard.payload) || !(k in req.list.payload)) throw new Error('بازه به هر دو کانال نمی‌رود: ' + k)
  if (!('onlyWithRemaining' in req.list.payload)) throw new Error('فیلتر باقی‌مانده به فهرست نمی‌رود')
  for (const k of ui.CREDIT_LIST_ONLY_FILTERS)
    if (k in req.dashboard.payload) throw new Error('کلید فهرست‌ویژه به داشبورد رفت: ' + k)
  // بازه‌ی خالی هیچ کلیدی نمی‌سازد، وگرنه پیش‌فرض «امروز»ِ سرویس خراب می‌شود
  const empty = ui.creditReportRequests({ fromJalali: '', toJalali: '  ' })
  if ('fromJalali' in empty.list.payload || 'toJalali' in empty.list.payload) throw new Error('بازه‌ی خالی کلید ساخت')
  return /creditReportRequests\(/.test(reports) && /CH\.creditDashboard, req\.dashboard\.payload/.test(reports)
})
check(26, 'تب legacy storeCredits دست‌نخورده است (کانال قدیمی سر جایش)', 'STRUCTURAL', () =>
  /CH\.storeCreditList/.test(reports) && /tab === 'storeCredits'/.test(reports))
/**
 * جلسه ۳۲ — بندهای ۲۷ و ۲۸ با هم بازنویسی شدند.
 *
 * نسخه‌ی قبلی ۲۷ به *پیاده‌سازیِ دست‌سازِ* تب گزارشات گره خورده بود
 * (`totals.amount` و `Array(CREDIT_LIST_HEADERS.length - 6)`) و ۲۸ فقط وجود نام
 * `creditListRow` را در دو فایل می‌دید — پس وقتی تب گزارشات روی `creditExport`
 * رفت، ۲۷ بی‌معنا و ۲۸ (تنها FAIL پروژه) نادرست شد. حالا هر دو یک چیز را
 * می‌سنجند: **هر دو صفحه از `creditExport` + `creditListTotals` رد می‌شوند.**
 */
check(27, 'ردیف جمع از `creditListTotals` می‌آید و با سرستون هم‌تراز است (هیچ pad دستی در دو صفحه)', 'REAL', () => {
  const body = [
    ui.creditListRow({ code: 'A1', amount: 1000, usedAmount: 400, remaining: 600 }),
    ui.creditListRow({ code: 'A2', amount: 500, usedAmount: 0, remaining: 500 })
  ]
  const t = ui.creditListTotals(body)
  const H = ui.CREDIT_LIST_HEADERS
  const cols = ui.CREDIT_LIST_TOTAL_COLUMNS
  if (cols.map((c) => H[c]).join('|') !== 'مبلغ|مصرف‌شده|باقی‌مانده')
    throw new Error('ستون‌های جمع‌دار با سرستون جابه‌جا شده‌اند: ' + cols.map((c) => H[c]).join('|'))
  if (t.length !== H.length) throw new Error(`طول ردیف جمع (${t.length}) با سرستون (${H.length}) یکی نیست`)
  const summed = t[0] === 'جمع' && t[3] === 1500 && t[4] === 400 && t[5] === 1100
  if (!summed) throw new Error('جمع ستون‌ها درست نیست: ' + JSON.stringify(t.slice(0, 6)))
  // ردیف جمعِ خروجی «فهرست» هم همان تابع است، نه یک کپیِ دیگر:
  const sheet = ui.creditExport('list', [{ code: 'A1', amount: 1000, usedAmount: 400, remaining: 600 }, { code: 'A2', amount: 500, usedAmount: 0, remaining: 500 }])
  if (JSON.stringify(sheet.totals) !== JSON.stringify(t)) throw new Error('ردیف جمع `creditExport` با `creditListTotals` یکی نیست')
  const noManualPad = !/Array\(CREDIT_LIST_HEADERS\.length - 6\)\.fill/.test(reports) && !/totals\.amount,/.test(reports)
  const reportsUsesShared = /creditListScreenTotals\(listRows\)/.test(reports)
  if (!noManualPad) throw new Error('تب گزارشات هنوز ردیف جمع دست‌ساز دارد')
  return reportsUsesShared
})
check(28, 'خروجی اکسل هر دو صفحه از `creditExport` می‌آید (هیچ‌وقت واگرا نمی‌شوند)', 'REAL', () => {
  /**
   * جلسه ۳۳ — این بند حالا *اجرا* هم می‌شود: ردیفِ روی صفحه و ردیفِ فایل یک
   * تابع‌اند (`creditListScreenRow` = برشِ `creditListRow`). تا دیروز هر جدول
   * چهارده `<td>` دست‌نویس داشت، پس اضافه‌شدن یک ستون *وسط* سرستون‌ها بی‌صدا
   * داده را زیر سرستون اشتباه می‌برد و هیچ گزاره‌ای نمی‌فهمید.
   */
  const row = { code: 'A1', sourceLabel: 'دستی', statusLabel: 'فعال', amount: 1000, usedAmount: 400, remaining: 600 }
  const full = ui.creditListRow(row)
  const screen = ui.creditListScreenRow(row)
  if (screen.length !== ui.CREDIT_LIST_SCREEN_COLUMNS) throw new Error('طول ردیف روی صفحه با ستون‌های دیده‌شده یکی نیست')
  if (ui.CREDIT_LIST_SCREEN_HEADERS.length !== screen.length) throw new Error('سرستون و ردیفِ روی صفحه هم‌طول نیستند')
  if (JSON.stringify(screen) !== JSON.stringify(full.slice(0, screen.length)))
    throw new Error('ردیف روی صفحه همان ردیف فایل نیست')
  if (ui.creditListCellFormat(3) !== 'money' || ui.creditListCellFormat(6) !== 'count' || ui.creditListCellFormat(0) !== 'text')
    throw new Error('قالب ستون‌ها جابه‌جا شده است')
  // فقط تبِ اعتبارِ همین فایل سنجیده می‌شود؛ تب‌های دیگر گزارشات به این ماژول ربطی ندارند.
  const creditTab = reports.slice(reports.indexOf('function CreditManagementReport'))
  const handWritten = /<td[^>]*>\{money\(r\.|<td[^>]*>\{faDigits\(r\.|\.slice\(0, 14\)/
  if (handWritten.test(creditTab) || handWritten.test(page)) throw new Error('سلول دست‌نویس یا عددِ ۱۴ در JSX مانده است')
  const pageOk = /creditExport\(kind, data\)/.test(page) && /doExport\('list', rows\)/.test(page)
  const reportsOk = /const sheet = creditExport\(kind, data\)/.test(reports) &&
    /CREDIT_RANGE_EXPORTS\.map\(/.test(reports) &&
    /creditRangeExportOrigin\(/.test(reports) &&
    /creditRangeExportRequest\(/.test(reports) &&
    /creditRangeExportRows\(/.test(reports)
  // هیچ‌کدام دیگر سرستون را دستی با ردیف‌ساز جفت نمی‌کند:
  const noHandPairing = !/headers: CREDIT_LIST_HEADERS/.test(reports) && !/headers: CREDIT_LIST_HEADERS/.test(page)
  if (!reportsOk) throw new Error('تب گزارشات از مسیر مشترک `creditExport` رد نمی‌شود')
  if (!noHandPairing) throw new Error('سرستون هنوز در JSX با ردیف‌ساز جفت می‌شود')
  return pageOk
})

/* ===========================================================================
 * ه) کار باز و بی‌ربط به اعتبار که جلسه ۲۴ فکر می‌کرد باز است
 * ========================================================================= */
check(29, 'useSettings واقعاً credit و time را از bundle می‌خواند (مورد باز جلسه ۲۲ بسته است)', 'REAL', () =>
  /credit: parseCreditSettings\(s\.credit\)/.test(useSettings) && /time: parseOfficialTimeConfig\(s\.time\)/.test(useSettings))

/* ===========================================================================
 * و) اجرای واقعی
 * ========================================================================= */
check(30, 'هر فایل تغییریافته‌ی این نشست parse می‌شود', 'REAL', () => {
  for (const f of ['src/shared/creditPrint.ts', 'src/main/services/AuditService.ts', 'src/main/services/StoreCreditService.ts',
    'src/main/services/PrintService.ts'])
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--check', f], { stdio: 'pipe' })
  return true
})
check(31, 'سوییت منطق خالص چاپ (۲۴ گزاره‌ی واقعی) پاس می‌شود', 'REAL', () => {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/credit-print-logic-session25.ts'], { encoding: 'utf8' })
  return / 0 FAIL/.test(out)
})
check(32, 'سوییت‌های جلسه ۲۱ و ۲۲ بعد از تغییرات این نشست هم پاس‌اند (بدون رگرسیون)', 'REAL', () => {
  const a = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/credit-logic-session21.ts'], { encoding: 'utf8' })
  const b = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/credit-ui-logic-session22.ts'], { encoding: 'utf8' })
  const c = execFileSync(process.execPath, ['test/acceptance-session21.mjs'], { encoding: 'utf8' })
  return / 0 FAIL/.test(a) && / 0 FAIL/.test(b) && /34 PASS · 0 FAIL/.test(c)
})

console.log(results.join('\n'))
console.log(`\nSession 25: ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
