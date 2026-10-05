/**
 * سوییت منطق خالص جلسه ۳۴ — بخش ۹.۳ و ۹.۴ `src/shared/credit.ts` و بخش ۱۴
 * `src/shared/creditUi.ts`.
 *
 * چه چیزی این نشست از سرویس و از JSX بیرون آمد:
 *   • **بخش ۹.۳ — «یک کاغذ بیرون آمد» چه چیزی می‌نویسد:** پیش‌فرضِ روشنِ
 *     شمارنده، شکلِ ردیف AuditLog (روی خودِ اعتبار و روی دسته)، PDFِ بدون
 *     شمارش، لغوِ پنجره‌ی ذخیره، نقشه‌ی رندر، و شکل خروجیِ چاپ گروهی. تا دیروز
 *     همه‌ی این‌ها داخل `PrintService`/`StoreCreditService` بودند و هارنس ۲۵
 *     مجبور بود بندهای ۷ تا ۱۴ و ۱۷ را با regex روی *متن* سرویس بسنجد.
 *   • **بخش ۹.۴ — نام‌هایی که به Prisma می‌رود:** `orderBy`، `select` و کلیدهای
 *     `data` در `create`/`update`. ادامه‌ی مستقیم بندهای ۲۵ تا ۳۱ نشست ۳۳ که
 *     همین کار را برای `where` کرد. یک `orderBy` روی ستونی که وجود ندارد، خطای
 *     *زمان اجرا*ی Prisma است — و در این محیط هیچ‌وقت اجرا نمی‌شود.
 *   • **بخش ۱۴ — آخرین تصمیم‌های JSX:** چاپِ سلول (دو کپیِ جدا داشت)، انتخاب
 *     ردیف‌ها و فهرست فیلترهایی که انتخاب را پاک می‌کنند، بار داده‌ی چاپ/PDF، و
 *     متنِ نتیجه.
 *
 * الگوی نشست‌های ۳۰ تا ۳۳ عیناً ادامه یافته: هر تصمیم **اجرا** می‌شود، نام‌ها با
 * `prisma/schema.prisma` *واقعی* تطبیق می‌شوند، و بخش آخر *مصرف* واقعی‌اش را در
 * سرویس و JSX می‌سنجد.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-s34-'))
fs.copyFileSync('src/shared/credit.ts', path.join(tmp, 'credit.ts'))
const creditUiSrc = fs.readFileSync('src/shared/creditUi.ts', 'utf8')
fs.writeFileSync(path.join(tmp, 'creditUi.ts'), creditUiSrc.replace(/from '\.\/credit'/g, "from './credit.ts'"))
const ui: any = await import(pathToFileURL(path.join(tmp, 'creditUi.ts')).href)
const rules: any = await import(pathToFileURL(path.join(tmp, 'credit.ts')).href)

const page = fs.readFileSync('src/renderer/src/pages/CreditManagement.tsx', 'utf8')
const detailView = fs.readFileSync('src/renderer/src/components/CreditDetailView.tsx', 'utf8')
const forms = fs.readFileSync('src/renderer/src/components/CreditForms.tsx', 'utf8')
const pickers = fs.readFileSync('src/renderer/src/components/CreditPickers.tsx', 'utf8')
const reports = fs.readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const jsx = [page, detailView, forms, pickers, reports].join('\n')
const svc = fs.readFileSync('src/main/services/StoreCreditService.ts', 'utf8')
const printSvc = fs.readFileSync('src/main/services/PrintService.ts', 'utf8')
const ipcShared = fs.readFileSync('src/shared/ipc.ts', 'utf8')
const ipcMain = fs.readFileSync('src/main/ipc/index.ts', 'utf8')
const enums = fs.readFileSync('src/shared/enums.ts', 'utf8')
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')

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

const fa = (v: string | number): string => `[${v}]`

/** نام ستون‌های یک مدل Prisma (بدون attribute های بلوکی). */
function modelFields(model: string): string[] {
  const at = schema.indexOf(`model ${model} {`)
  if (at < 0) throw new Error('مدل پیدا نشد: ' + model)
  const body = schema.slice(at, schema.indexOf('\n}', at))
  return [...body.matchAll(/^\s{2}(\w+)\s+\S/gm)].map((m) => m[1])
}
const FIELDS: Record<string, string[]> = {}
const fieldsOf = (model: string): string[] => (FIELDS[model] ??= modelFields(model))

/** بلوکِ `data: { … }`ِ بعد از یک نقطه‌ی مصرفِ مشخص در سورس سرویس. */
function dataBlock(src: string, anchor: string): string {
  const at = src.indexOf(anchor)
  if (at < 0) throw new Error('نقطه‌ی مصرف پیدا نشد: ' + anchor)
  const start = src.indexOf('data: {', at)
  if (start < 0) throw new Error('بلوک data پیدا نشد: ' + anchor)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('بلوک data بسته نشد: ' + anchor)
}

/**
 * کلیدهای سطح اولِ همان بلوک — هم `key: value` و هم shorthand (`status,`)، چون
 * سرویس هر دو شکل را می‌نویسد و یک استخراج‌کننده‌ی نصفه، خودش یک باگِ خاموش است.
 */
function topKeys(block: string): string[] {
  const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'))
  const keys: string[] = []
  let depth = 0
  let i = 0
  let expect = true
  while (i < body.length) {
    const ch = body[i]
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++
      expect = false
      i++
      continue
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--
      i++
      continue
    }
    if (ch === ',' && depth === 0) {
      expect = true
      i++
      continue
    }
    if (ch === '`' || ch === "'" || ch === '"') {
      const q = ch
      i++
      while (i < body.length && body[i] !== q) {
        if (body[i] === '\\') i++
        i++
      }
      i++
      expect = false
      continue
    }
    if (expect && depth === 0 && /[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < body.length && /[\w$]/.test(body[j])) j++
      let k = j
      while (k < body.length && /\s/.test(body[k])) k++
      if (body[k] === ':' || body[k] === ',' || k >= body.length) keys.push(body.slice(i, j))
      expect = false
      i = j
      continue
    }
    if (!/\s/.test(ch)) expect = false
    i++
  }
  return keys
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

// ---------------------------------------------------------------------------
// ۱) بخش ۹.۳ — تصمیم‌هایی که تا دیروز داخل دو سرویس بودند
// ---------------------------------------------------------------------------

check('۱. شمارنده‌ی چاپ پیش‌فرض روشن است و فقط `false`ِ صریح خاموشش می‌کند (§۲۴)', () => {
  for (const v of [undefined, null, true, 0, '', 'false', 1])
    if (rules.creditShouldMarkPrinted(v) !== true) throw new Error('پیش‌فرض خاموش شد: ' + String(v))
  return rules.creditShouldMarkPrinted(false) === false
})

check('۲. خروجیِ «شمارش نشد» یک شیء مشترک است و مصرف‌کننده می‌تواند کپی‌اش کند', () => {
  const none = { ...rules.CREDIT_MARK_PRINTED_NONE }
  none.marked = 7
  return rules.CREDIT_MARK_PRINTED_NONE.marked === 0 && rules.CREDIT_MARK_PRINTED_NONE.reprints === 0
})

check('۳. کانال چاپ نرمال می‌شود و کانال ناشناس «کاغذ» است، نه فایل', () => {
  if (rules.creditPrintChannel('pdf') !== 'PDF' || rules.creditPrintChannel('  PDF ') !== 'PDF') throw new Error('PDF شناخته نشد')
  for (const v of [undefined, null, '', 'PRINT', 'چاپ', 'XLS'])
    if (rules.creditPrintChannel(v) !== 'PRINT') throw new Error('کانال ناشناس فایل شمرده شد: ' + String(v))
  return rules.CREDIT_PRINT_CHANNELS.length === 2
})

check('۴. هر دو کانال، هم عنوان بلند دارند هم کوتاه، و با هم فرق دارند', () =>
  rules.CREDIT_PRINT_CHANNELS.every((c: string) => !!rules.CREDIT_PRINT_CHANNEL_TITLES[c] && !!rules.CREDIT_PRINT_CHANNEL_LABELS[c]) &&
  rules.CREDIT_PRINT_CHANNEL_TITLES.PRINT !== rules.CREDIT_PRINT_CHANNEL_TITLES.PDF)

check('۵. ردیف AuditLog چاپ تکی: روی خودِ اعتبار، با before/after و بدون کلید دسته', () => {
  const log = rules.creditPrintAudit({ entityId: 12, code: 'A1', prev: 0, channel: 'PRINT' }, fa)
  if (log.entity !== 'StoreCredit' || log.entityId !== 12) throw new Error('موجودیت/شناسه اشتباه است')
  if (JSON.parse(log.before).printCount !== 0) throw new Error('`before` شمارنده‌ی قبلی را نمی‌گوید')
  const after = JSON.parse(log.after)
  if (after.printCount !== 1 || after.channel !== 'PRINT') throw new Error('`after` درست نیست')
  if ('batchId' in after) throw new Error('چاپ تکی کلید دسته نمی‌سازد')
  return log.action === 'CREDIT_PRINT'
})

check('۶. ردیف AuditLog چاپ گروهی: همان ردیف + کلید دسته + متنِ «گروهی»', () => {
  const log = rules.creditPrintAudit({ entityId: 7, code: 'B2', prev: 3, channel: 'PDF', group: true, batchId: 9 }, fa)
  const after = JSON.parse(log.after)
  if (after.batchId !== 9 || after.printCount !== 4) throw new Error('بار داده‌ی گروهی ناقص است')
  if (log.action !== 'CREDIT_REPRINT') throw new Error('نسخه‌ی چهارم باید «مجدد» باشد')
  return /گروهی/.test(log.note) && log.note.includes('[9]') && /نسخه‌ی مجدد/.test(log.note)
})

check('۷. عملِ ردیف لاگ فقط از آستانه‌ی بخش ۹.۲ می‌آید و هر دو کلید در `enums.ts` واقعی هست', () => {
  const first = rules.creditPrintAudit({ entityId: 1, prev: 0 }, fa)
  const second = rules.creditPrintAudit({ entityId: 1, prev: 1 }, fa)
  if (first.action !== rules.creditPrintAction(0) || second.action !== rules.creditPrintAction(1))
    throw new Error('عملِ لاگ با آستانه جور نیست')
  for (const k of [first.action, second.action]) if (!new RegExp(`\\b${k}\\s*[:=]`).test(enums)) throw new Error('کلید ناموجود: ' + k)
  return first.action !== second.action
})

check('۸. متنِ ردیف: کاغذ اول بی‌برچسب، کاغذ دوم به بعد «نسخه‌ی مجدد»، و مسیر فایل چسبیده', () => {
  const one = rules.creditPrintNote({ code: 'A1', prev: 0, channel: 'PRINT' }, fa)
  const two = rules.creditPrintNote({ code: 'A1', prev: 1, channel: 'PRINT' }, fa)
  if (/نسخه‌ی مجدد/.test(one)) throw new Error('کاغذ اول برچسب گرفت')
  if (!/نسخه‌ی مجدد/.test(two) || !two.includes('[2]')) throw new Error('کاغذ دوم برچسب/شماره ندارد')
  const withFile = rules.creditPrintNote({ code: 'A1', prev: 0, channel: 'PDF', file: '/x.pdf' }, fa)
  return withFile.endsWith('/x.pdf') && withFile.includes(rules.CREDIT_PRINT_CHANNEL_TITLES.PDF)
})

check('۹. ردیف خلاصه‌ی دسته: روی `StoreCreditBatch`، عملش همیشه چاپ، و شمارشِ مجدد فقط وقتی هست', () => {
  const withReprints = rules.creditBatchPrintAudit({ batchId: 9, count: 3, reprints: 2, channel: 'PRINT' }, fa)
  if (withReprints.entity !== 'StoreCreditBatch' || withReprints.action !== 'CREDIT_PRINT') throw new Error('موجودیت/عمل اشتباه')
  if (!/نسخه‌ی مجدد/.test(withReprints.note)) throw new Error('تعداد نسخه‌ی مجدد در متن نیست')
  const clean = rules.creditBatchPrintAudit({ batchId: 9, count: 3, reprints: 0, channel: 'PRINT' }, fa)
  if (/نسخه‌ی مجدد/.test(clean.note)) throw new Error('بدون نسخه‌ی مجدد نباید چیزی بگوید')
  return JSON.parse(clean.after).count === 3
})

check('۱۰. PDFِ بدون شمارش: موجودیتش با تکی/دسته‌ای عوض می‌شود و `after` می‌گوید شمارنده دست نخورد', () => {
  const one = rules.creditPdfAuditOnly({ single: true, id: 4, count: 1, file: '/a.pdf' }, fa)
  const many = rules.creditPdfAuditOnly({ single: false, batchId: 9, count: 5, file: '/a.pdf' }, fa)
  if (one.entity !== 'StoreCredit' || many.entity !== 'StoreCreditBatch') throw new Error('موجودیت جابه‌جا شده')
  if (one.entityId !== 4 || many.entityId !== 9) throw new Error('شناسه اشتباه است')
  if (JSON.parse(many.after).markPrinted !== false) throw new Error('`after` نمی‌گوید شمارنده دست نخورد')
  return one.action === 'CREDIT_PRINT' && /بدون شمارش نسخه/.test(one.note)
})

check('۱۱. لغو پنجره‌ی ذخیره ⇒ هیچ فایلی؛ مسیر خالی هم لغو است؛ `ask: false` پیش‌فرض را می‌نویسد', () => {
  if (rules.creditPdfSaveOutcome({ canceled: true, filePath: '/x.pdf' }, '/d/f.pdf').file !== null) throw new Error('لغو فایل داد')
  if (rules.creditPdfSaveOutcome({ canceled: false, filePath: '  ' }, '/d/f.pdf').saved !== false) throw new Error('مسیر خالی ذخیره شمرده شد')
  if (rules.creditPdfSaveOutcome({ canceled: false, filePath: '/p.pdf' }, '/d/f.pdf').file !== '/p.pdf') throw new Error('مسیر کاربر نادیده رفت')
  const noAsk = rules.creditPdfSaveOutcome(null, '/d/f.pdf')
  return noAsk.saved === true && noAsk.file === '/d/f.pdf'
})

check('۱۲. نقشه‌ی شمارش و نقشه‌ی رندرِ PDF', () => {
  if (rules.creditPdfMarkPlan({ single: true }).kind !== 'single') throw new Error('مسیر تکی')
  if (rules.creditPdfMarkPlan({ single: false }).kind !== 'many') throw new Error('مسیر گروهی')
  if (rules.creditPdfMarkPlan({ single: false, markPrinted: false }).kind !== 'auditOnly') throw new Error('مسیر بدون شمارش')
  if (rules.creditPdfMarkPlan({ single: false }).channel !== 'PDF') throw new Error('کانال PDF نیست')
  if (rules.creditPdfRenderPlan(true).batchRenders !== 0) throw new Error('سند تکی نباید دسته را رندر کند')
  return rules.creditPdfRenderPlan(false).batchRenders === 1
})

check('۱۳. خروجی چاپ گروهی: شش کلید، اعداد پاک‌شده، و `capped` فقط با `true`', () => {
  const res = rules.creditPrintBatchResult({ ids: [1, 2], total: 9, capped: true, marked: { marked: 2, reprints: 1 } })
  if (same(Object.keys(res), ['ok', 'count', 'total', 'capped', 'marked', 'reprints']) !== true) throw new Error('کلیدها عوض شده‌اند')
  if (res.count !== 2 || res.total !== 9 || res.marked !== 2 || res.reprints !== 1) throw new Error('اعداد درست نیستند')
  const none = rules.creditPrintBatchResult({ ids: [1], total: 0, capped: 'yes', marked: null })
  return none.capped === false && none.total === 1 && none.marked === 0 && none.reprints === 0
})

// ---------------------------------------------------------------------------
// ۲) بخش ۹.۴ — هر نامی که به Prisma می‌رود، با `schema.prisma` واقعی سنجیده می‌شود
// ---------------------------------------------------------------------------

check('۱۴. ستون‌های نوشتنِ مسیر چاپ و کلیدهای `select` در مدل `StoreCredit` هستند', () => {
  const cols = fieldsOf('StoreCredit')
  for (const f of [...rules.CREDIT_PRINT_WRITE_FIELDS, ...Object.keys(rules.CREDIT_PRINT_SELECT)])
    if (!cols.includes(f)) throw new Error('ستون ناموجود: ' + f)
  return rules.CREDIT_PRINT_WRITE_FIELDS.length === 2
})

check('۱۵. شکلِ `data`ِ هر دو مسیر شمارش، فقط همان ستون‌ها را می‌نویسد', () => {
  const now = new Date(0)
  const inc = rules.creditPrintIncrementData(now)
  const set = rules.creditPrintSetData('4', now)
  for (const shape of [inc, set])
    for (const k of Object.keys(shape)) if (!rules.CREDIT_PRINT_WRITE_FIELDS.includes(k)) throw new Error('کلید اضافه: ' + k)
  if (inc.printCount.increment !== 1) throw new Error('افزایش اتمی نیست')
  if (set.printCount !== 4) throw new Error('مقدار صریح پاک نشد')
  return inc.lastPrintedAt === now && set.lastPrintedAt === now
})

check('۱۶. هر `orderBy`ِ این ماژول یک ستونِ واقعی روی مدل خودش است، با جهت معتبر', () => {
  const keys = Object.keys(rules.CREDIT_ORDER_BY)
  if (!keys.length) throw new Error('جدول مرتب‌سازی خالی است')
  for (const k of keys) {
    const model = rules.CREDIT_ORDER_BY_MODELS[k]
    if (!model) throw new Error('مدلِ این مرتب‌سازی نوشته نشده: ' + k)
    const entries = Object.entries(rules.CREDIT_ORDER_BY[k] as Record<string, string>)
    if (entries.length !== 1) throw new Error('مرتب‌سازی باید یک ستون باشد: ' + k)
    const [col, dir] = entries[0]
    if (!fieldsOf(model).includes(col)) throw new Error(`ستون ${col} در مدل ${model} نیست (${k})`)
    if (dir !== 'asc' && dir !== 'desc') throw new Error('جهت نامعتبر: ' + k)
  }
  return keys.length >= 8
})

check('۱۷. سرویس همه‌ی این مرتب‌سازی‌ها را مصرف می‌کند و هیچ `orderBy` دستی نمانده', () => {
  for (const k of Object.keys(rules.CREDIT_ORDER_BY))
    if (!svc.includes(`CREDIT_ORDER_BY.${k}`)) throw new Error('مصرف نشده: ' + k)
  const inline = svc.match(/orderBy: \{/g) ?? []
  if (inline.length) throw new Error(`${inline.length} مرتب‌سازی دستی در سرویس مانده است`)
  return true
})

check('۱۸. کلیدهای ثبت یک مصرف = همان چیزی که سرویس می‌نویسد، و همه در مدل هستند', () => {
  const keys = topKeys(dataBlock(svc, 'storeCreditRedemption.create({'))
  if (!same(keys, rules.CREDIT_REDEMPTION_CREATE_FIELDS)) throw new Error('واگرایی با سرویس: ' + keys.join(','))
  const cols = fieldsOf('StoreCreditRedemption')
  for (const f of keys) if (!cols.includes(f)) throw new Error('ستون ناموجود در مدل: ' + f)
  return keys.includes('idempotencyKey') && keys.includes('remainderAfter')
})

check('۱۹. ستون‌های برگشت/جست‌وجو/کلیدِ دفتر مصرف در مدل هستند و سرویس همان‌ها را می‌زند', () => {
  const cols = fieldsOf('StoreCreditRedemption')
  for (const f of [
    ...rules.CREDIT_REDEMPTION_REVERSE_FIELDS,
    ...rules.CREDIT_REDEMPTION_SEARCH_COLUMNS,
    ...rules.CREDIT_REDEMPTION_KEY_COLUMNS
  ])
    if (!cols.includes(f)) throw new Error('ستون ناموجود: ' + f)
  const reverse = topKeys(dataBlock(svc, 'storeCreditRedemption.update({'))
  return same(reverse, rules.CREDIT_REDEMPTION_REVERSE_FIELDS)
})

check('۲۰. کلیدهای ساختِ دسته = همان چیزی که سرویس می‌نویسد، و همه در مدل `StoreCreditBatch` هستند', () => {
  const keys = topKeys(dataBlock(svc, 'storeCreditBatch.create({'))
  if (!same(keys, rules.CREDIT_BATCH_CREATE_FIELDS)) throw new Error('واگرایی با سرویس: ' + keys.join(','))
  const cols = fieldsOf('StoreCreditBatch')
  for (const f of [...keys, ...rules.CREDIT_BATCH_TOTAL_FIELDS]) if (!cols.includes(f)) throw new Error('ستون ناموجود: ' + f)
  return same(topKeys(dataBlock(svc, 'storeCreditBatch.update({')), rules.CREDIT_BATCH_TOTAL_FIELDS)
})

check('۲۱. کلیدهای یک ردیف لاگ یادآوری = همان چیزی که سرویس می‌نویسد، و همه در مدل هستند', () => {
  const keys = topKeys(dataBlock(svc, 'creditReminderLog.create({'))
  if (!same(keys, rules.CREDIT_REMINDER_LOG_CREATE_FIELDS)) throw new Error('واگرایی با سرویس: ' + keys.join(','))
  const cols = fieldsOf('CreditReminderLog')
  for (const f of keys) if (!cols.includes(f)) throw new Error('ستون ناموجود در مدل: ' + f)
  return keys.includes('placeholdersJson') && keys.includes('plannedAt')
})

check('۲۲. سه ستونی که بعدِ ثبت یادآوری روی خودِ اعتبار به‌روز می‌شوند، واقعی‌اند', () => {
  const cols = fieldsOf('StoreCredit')
  for (const f of rules.CREDIT_REMINDER_MARK_FIELDS) if (!cols.includes(f)) throw new Error('ستون ناموجود: ' + f)
  const keys = topKeys(dataBlock(svc, 'if (status === CreditReminderStatus.LOGGED) {'))
  return same(keys, rules.CREDIT_REMINDER_MARK_FIELDS)
})

check('۲۳. هر مدلی که این ماژول صدا می‌زند (و هر موجودیتِ لاگ چاپ) در schema هست', () => {
  for (const m of [...rules.CREDIT_PRISMA_MODELS, ...Object.values(rules.CREDIT_PRINT_ENTITIES)])
    if (!new RegExp(`model ${m} \\{`).test(schema)) throw new Error('مدل ناموجود: ' + m)
  for (const m of rules.CREDIT_PRISMA_MODELS.filter((x: string) => x !== 'AuditLog'))
    if (!new RegExp(`(prisma|tx|client)\\.${m[0].toLowerCase()}${m.slice(1)}\\.`).test(svc))
      throw new Error('مدلِ بی‌مصرف در فهرست: ' + m)
  return true
})

// ---------------------------------------------------------------------------
// ۳) بخش ۱۴ — تصمیم‌های *نمایشی* که تا دیروز در JSX بودند
// ---------------------------------------------------------------------------

const FMT = { money: (n: number) => `پول(${n})`, fa }

check('۲۴. چاپِ یک سلول: خالی ⇒ یک علامت واحد، پول ⇒ قالب پول، شمارش/متن ⇒ رقم فارسی', () => {
  if (ui.creditCellText(null, 'money', FMT) !== ui.CREDIT_EMPTY_CELL) throw new Error('خالی علامت واحد ندارد')
  if (ui.creditCellText('', 'text', FMT) !== ui.CREDIT_EMPTY_CELL) throw new Error('رشته‌ی خالی هم خالی است')
  if (ui.creditCellText(0, 'money', FMT) !== 'پول(0)') throw new Error('صفرِ مبلغی نباید خالی شود')
  if (ui.creditCellText('1200', 'money', FMT) !== 'پول(1200)') throw new Error('عددِ رشته‌ای تبدیل نشد')
  return ui.creditCellText(5, 'count', FMT) === '[5]' && ui.creditCellText('A1', 'text', FMT) === '[A1]'
})

check('۲۵. همان تابع، قالب هر ستون را از `creditListCellFormat` می‌گیرد (سلولِ پولی و شمارشی جابه‌جا نمی‌شوند)', () => {
  const row = ui.creditListScreenRow({ code: 'A1', amount: 1000, usedAmount: 400, remaining: 600, maxUses: 2 })
  const texts = row.map((cell: any, i: number) => ui.creditCellText(cell, ui.creditListCellFormat(i), FMT))
  const moneyCols = ui.CREDIT_LIST_MONEY_COLUMNS.filter((i: number) => i < row.length)
  for (const i of moneyCols) if (!texts[i].startsWith('پول(')) throw new Error('ستون مبلغی با قالب پول چاپ نشد: ' + i)
  return texts.length === ui.CREDIT_LIST_SCREEN_COLUMNS
})

check('۲۶. انتخاب ردیف‌ها: تیک سرستون، تیک ردیف، و «فهرست خالی هرگز همه نیست»', () => {
  const rows = [{ id: 3 }, { id: 1 }]
  if (ui.creditAllSelected([1, 3], rows) !== true || ui.creditAllSelected([1], rows) !== false) throw new Error('تشخیص «همه» اشتباه')
  if (ui.creditAllSelected([1, 3], []) !== false) throw new Error('فهرست خالی «همه» شمرده شد')
  if (ui.creditToggleAll([], rows).join(',') !== '1,3') throw new Error('تیک سرستون همه را نگرفت')
  if (ui.creditToggleAll([1, 3], rows).length !== 0) throw new Error('تیک دوباره پاک نکرد')
  if (ui.creditToggleRow([1], 3).join(',') !== '1,3') throw new Error('افزودن ردیف')
  if (ui.creditToggleRow([1, 3], 1).join(',') !== '3') throw new Error('برداشتن ردیف')
  return ui.creditToggleRow([1], 0).join(',') === '1'
})

check('۲۷. هیچ فیلترِ فهرست از فهرستِ «پاک‌کردن انتخاب» جا نمانده (وگرنه کاغذِ ردیف قبلی چاپ می‌شود)', () => {
  const base = { fromJalali: '۱۴۰۴/۰۱/۰۱', toJalali: '۱۴۰۴/۰۱/۳۱', search: 'x', source: 'MANUAL', status: 'ACTIVE', onlyWithRemaining: true }
  const payload = Object.keys(ui.creditViewRequest('list', base).payload)
  const missing = payload.filter((k) => k !== 'take' && !ui.CREDIT_SELECTION_RESET_KEYS.includes(k))
  if (missing.length) throw new Error('فیلترِ بی‌اثر روی انتخاب: ' + missing.join(', '))
  const sig = ui.creditSelectionResetSignature(base)
  for (const k of ['fromJalali', 'toJalali', 'search', 'source', 'status'])
    if (sig === ui.creditSelectionResetSignature({ ...base, [k]: 'دیگر' })) throw new Error('امضا با تغییر این فیلتر عوض نشد: ' + k)
  return sig === ui.creditSelectionResetSignature({ ...base, take: 77 })
})

check('۲۸. بار داده‌ی چاپ تکی: شمارنده روشن، سقف پنج نسخه، و بدون `id` هیچ درخواستی', () => {
  const r = ui.creditPrintOpRequest('print', { id: 4, copies: 2 })
  if (r.channel !== ui.CREDIT_PRINT_OP_CHANNELS.print) throw new Error('کانال اشتباه')
  if (r.payload.markPrinted !== true || r.payload.silent !== false) throw new Error('قاعده‌ی §۲۴ یا حالت چاپ رفته است')
  if (ui.creditPrintOpRequest('print', { id: 4, copies: 99 }).payload.copies !== 5) throw new Error('سقف نسخه اعمال نشد')
  if (ui.creditPrintOpRequest('print', { id: 4, copies: 0 }).payload.copies !== 1) throw new Error('صفر نسخه بی‌معنا است')
  return ui.creditPrintOpRequest('print', { ids: [1] }) === null
})

check('۲۹. بار داده‌ی چاپ گروهی/PDF: ids > batchId > id، بدون کلید اضافه، و PDF با پنجره‌ی ذخیره', () => {
  const batch = ui.creditPrintOpRequest('batch', { batchId: 9 })
  if (batch.payload.batchId !== 9 || 'ids' in batch.payload) throw new Error('مسیر دسته آلوده است')
  const both = ui.creditPrintOpRequest('batch', { ids: [2, 2, 1], batchId: 9, id: 5 })
  if (both.payload.ids.join(',') !== '1,2' || 'batchId' in both.payload) throw new Error('اولویت هدف رعایت نشد')
  const pdf = ui.creditPrintOpRequest('pdf', { id: 4 })
  if (pdf.payload.ask !== true || pdf.payload.reveal !== true || pdf.payload.id !== 4) throw new Error('PDF ناقص است')
  if (ui.creditPrintOpRequest('pdf', {}) !== null) throw new Error('بدون هدف نباید درخواست ساخته شود')
  return ui.creditPrintOpRequest('batch', { ids: [1], perPage: 3 }).payload.perPage === 3
})

check('۳۰. هر سه کانال چاپ در `shared/ipc.ts` هستند و در main یک handler دارند', () => {
  const ipcKeys = [...ipcShared.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'/gm)].map((m) => m[1])
  for (const c of Object.values(ui.CREDIT_PRINT_OP_CHANNELS) as string[]) {
    if (!ipcKeys.includes(c)) throw new Error('کانال ناموجود: ' + c)
    if (!ipcMain.includes(`IPC.${c},`)) throw new Error('بدون handler: ' + c)
  }
  return true
})

check('۳۱. متنِ نتیجه: هشدارِ سقف فقط وقتی سقف خورده، و اعدادِ واقعی داخلش', () => {
  const capped = ui.creditPrintFlash('batch', { count: 2, total: 9, capped: true, reprints: 1 }, fa)
  if (!/سقف هر فایل/.test(capped) || !capped.includes('[9]') || !capped.includes('[2]')) throw new Error('هشدار سقف ناقص است')
  if (!/نسخه‌ی مجدد/.test(capped)) throw new Error('تعداد نسخه‌ی مجدد گفته نمی‌شود')
  const plain = ui.creditPrintFlash('batch', { count: 2, total: 2, capped: false }, fa)
  if (/سقف هر فایل/.test(plain) || /نسخه‌ی مجدد/.test(plain)) throw new Error('بدون سقف/بدون مجدد نباید چیزی بگوید')
  return true
})

check('۳۲. متنِ PDF: لغو ⇒ «هیچ فایلی»، موفق ⇒ مسیر فایل + هشدار نسخه‌ی بعدی', () => {
  const canceled = ui.creditPrintFlash('pdf', { saved: false, count: 3 }, fa)
  if (!/لغو/.test(canceled) || /\/a\.pdf/.test(canceled)) throw new Error('متن لغو درست نیست')
  const saved = ui.creditPrintFlash('pdf', { saved: true, count: 3, total: 3, file: '/a.pdf' }, fa)
  if (!saved.includes('/a.pdf') || !/نسخه‌ی مجدد/.test(saved)) throw new Error('متن موفق ناقص است')
  return /چاپگر/.test(ui.creditPrintFlash('print', { copies: 2 }, fa))
})

check('۳۳. نشان‌های صفحه‌ی جزئیات: آستانه‌شان همان `isCreditReprint` است', () => {
  if (ui.creditDetailPrintBadges(0, fa).length !== 1) throw new Error('چاپ‌نشده نباید هشدار بدهد')
  const one = ui.creditDetailPrintBadges(1, fa)
  if (one.length !== 2 || one[1].tone !== 'warn') throw new Error('هشدار نسخه‌ی مجدد نیامد')
  if (!one[0].text.includes('[1]')) throw new Error('شمارنده با رقم تزریق‌شده چاپ نمی‌شود')
  for (const n of [0, 1, 5, '2', null])
    if ((ui.creditDetailPrintBadges(n, fa).length === 2) !== rules.isCreditReprint(n)) throw new Error('واگرایی با آستانه: ' + String(n))
  return true
})

check('۳۴. دکمه‌ی خروجیِ بازه‌ای: `rows`/`dashboard` با داده‌ی خالی غیرفعال، `fetch` هیچ‌وقت', () => {
  if (ui.creditRangeExportDisabled('list', { rows: [], dashboard: null }) !== true) throw new Error('فهرست خالی باید غیرفعال باشد')
  if (ui.creditRangeExportDisabled('list', { rows: [{ id: 1 }], dashboard: null }) !== false) throw new Error('فهرست پر باید فعال باشد')
  if (ui.creditRangeExportDisabled('dashboard', { rows: [], dashboard: null }) !== true) throw new Error('داشبورد خالی')
  if (ui.creditRangeExportDisabled('dashboard', { rows: [], dashboard: {} }) !== false) throw new Error('داشبورد پر')
  const lazy = ui.CREDIT_RANGE_EXPORTS.filter((e: any) => e.lazy)
  for (const e of lazy)
    if (ui.creditRangeExportDisabled(e.kind, { rows: [], dashboard: null }) !== false)
      throw new Error('خروجی lazy نباید به‌خاطر خالی بودن صفحه غیرفعال شود: ' + e.kind)
  return lazy.length >= 3
})

// ---------------------------------------------------------------------------
// ۴) مصرفِ واقعی — همان چیزی که بدون Electron/Prisma قابل سنجش است
// ---------------------------------------------------------------------------

check('۳۵. `PrintService` هر شش تصمیمِ بخش ۹.۳ را مصرف می‌کند و هیچ `markPrinted`ِ دستی ندارد', () => {
  for (const n of [
    'creditShouldMarkPrinted(',
    'creditPdfRenderPlan(',
    'creditPdfSaveOutcome(',
    'creditPdfMarkPlan(',
    'creditPdfAuditOnly(',
    'creditPrintBatchResult('
  ])
    if (!printSvc.includes(n)) throw new Error('مصرف نشده: ' + n)
  return !/markPrinted !== false/.test(printSvc) && !/markPrinted === false/.test(printSvc) &&
    !/\{ marked: 0, reprints: 0 \}/.test(printSvc)
})

check('۳۶. `StoreCreditService` شکلِ داده و شکلِ لاگ را از لایه‌ی مشترک می‌گیرد', () => {
  for (const n of [
    'creditPrintSetData(next, now)',
    'creditPrintIncrementData(now)',
    'select: CREDIT_PRINT_SELECT',
    'creditIdsWhere(',
    'creditPrintAudit(',
    'creditBatchPrintAudit('
  ])
    if (!svc.includes(n)) throw new Error('مصرف نشده: ' + n)
  return !/\{ marked: 0, reprints: 0 \}/.test(svc) && !/printCount: \{ increment: 1 \}/.test(svc)
})

check('۳۷. لاگِ این ماژول همچنان fail-closed است (هیچ `auditLog.create` خامی)', () =>
  !/auditLog\.create/.test(svc) && !/auditLog\.create/.test(printSvc) &&
  /auditOrThrow as audit/.test(svc) && /creditPrintAudit\(/.test(svc))

check('۳۸. صفحه‌ی مدیریت اعتبار بار داده و متنِ هر سه عملیات را از لایه‌ی مشترک می‌گیرد', () => {
  for (const n of ["creditPrintOpRequest('print'", "creditPrintOpRequest('batch'", "creditPrintOpRequest('pdf'", 'creditPrintFlash('])
    if (!page.includes(n)) throw new Error('مصرف نشده: ' + n)
  if (/markPrinted: true/.test(page)) throw new Error('کلید دستی شمارنده در JSX مانده است')
  return !/CH\.printCredit\b/.test(page) && !/CH\.creditPdf\b/.test(page) && !/ask: true/.test(page)
})

check('۳۹. انتخاب و چاپِ سلول در هیچ‌کدام از پنج فایل UI دوباره تعریف نشده‌اند', () => {
  if (/function cellText|function creditCell\b/.test(jsx)) throw new Error('کپیِ محلیِ چاپ سلول برگشته است')
  if (/const allSelected = rows\.length/.test(jsx)) throw new Error('منطق انتخاب دوباره در JSX است')
  if (/setSelected\(\(s\) => \(s\.includes/.test(jsx)) throw new Error('تیک ردیف دوباره در JSX است')
  return /creditCellText\(/.test(page) && /creditCellText\(/.test(reports) && /creditAllSelected\(/.test(page)
})

check('۴۰. صفحه‌ی جزئیات آستانه‌ی «نسخه‌ی مجدد» را دیگر خودش حساب نمی‌کند', () =>
  /creditDetailPrintBadges\(/.test(detailView) && !/printed >= 1/.test(detailView) && !/printCount \?\? 0/.test(detailView))

check('۴۱. تب گزارشات هم «این دکمه داده دارد؟» را از لایه‌ی مشترک می‌پرسد', () =>
  /creditRangeExportDisabled\(e\.kind, \{ rows, dashboard \}\)/.test(reports) &&
  !/origin === 'rows' && !rows\.length/.test(reports))

check('۴۲. قاعده‌ی محل تصمیم‌ها: هیچ‌کدام از نام‌های تازه در JSX یا در سرویس تعریف نشده‌اند', () => {
  const declared = [
    'CREDIT_SELECTION_RESET_KEYS',
    'CREDIT_PRINT_OP_CHANNELS',
    'CREDIT_ORDER_BY',
    'CREDIT_PRINT_SELECT',
    'CREDIT_MARK_PRINTED_NONE'
  ]
  for (const n of declared) {
    if (new RegExp(`(const|let|function)\\s+${n}\\b`).test(jsx)) throw new Error('در JSX تعریف شده: ' + n)
    if (new RegExp(`(const|let|function)\\s+${n}\\b`).test(svc + printSvc)) throw new Error('در سرویس تعریف شده: ' + n)
  }
  for (const n of ['creditPrintAudit', 'creditPdfSaveOutcome', 'creditCellText', 'creditPrintFlash', 'creditSelectionResetSignature'])
    if (new RegExp(`function\\s+${n}\\b`).test(jsx + svc + printSvc)) throw new Error('تصمیم بیرون از لایه‌ی مشترک: ' + n)
  return true
})

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 34): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
