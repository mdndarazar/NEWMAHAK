/**
 * سوییت منطق خالص جلسه ۳۰ — بخش ۹.۱ `src/shared/credit.ts` و بخش ۱۰ `creditUi.ts`.
 *
 * جلسه ۲۹ تصمیم‌ها را نوشت؛ این نشست آن‌ها را در مسیر واقعی مصرف کرد و برای همان
 * مصرف چند تصمیم تازه لازم شد (پیش‌سنجش کد در صدور تکی، نشستن شرط در AND،
 * جست‌وجوی دومرحله‌ای، snapshot کامل گیرنده، نسخه‌ی SQLِ «سابقه‌ی محافظت‌شده»،
 * لوگوی سند، ردیف جمع خروجی). هر کدام اینجا **واقعاً اجرا** می‌شود؛ بخش آخر هم
 * می‌سنجد که سرویس واقعاً همین‌ها را صدا می‌زند (کد «هرگز اجرانشده» کلاس باگ
 * همین پروژه بوده است).
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  AUDIT_PROTECTED_ENTITIES,
  AUDIT_PROTECTED_ACTION_PREFIXES,
  CREDIT_SEARCH_INVOICE_COLUMNS,
  CreditStatus,
  HOLDER_AUDIT_FIELDS,
  HOLDER_FIELD_LABELS,
  auditProtectedSql,
  auditPurgeableSql,
  codeGrowthOf,
  creditSearchPlan,
  creditSearchWhere,
  creditStatusWhere,
  holderSnapshot,
  isProtectedAuditRow,
  needsCodeSpaceCheck,
  withAndClause
} from '../src/shared/credit.ts'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * ⚠️ `creditUi.ts` مثل بقیه‌ی فایل‌های `src` با specifier بدون پسوند
 * (`from './credit'`) نوشته شده است — همان چیزی که Vite/بسته‌بند می‌فهمد ولی
 * ESM خالصِ Node نه. پس *همان سورس واقعی* (بدون هیچ تغییر منطقی، فقط یک
 * specifier) در پوشه‌ی موقت کپی و اجرا می‌شود: تست روی کد واقعی است، نه روی
 * یک کپیِ دست‌نویس.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-s30-'))
fs.copyFileSync('src/shared/credit.ts', path.join(tmp, 'credit.ts'))
fs.writeFileSync(
  path.join(tmp, 'creditUi.ts'),
  fs.readFileSync('src/shared/creditUi.ts', 'utf8').replace(/from '\.\/credit'/g, "from './credit.ts'")
)
const ui: any = await import(pathToFileURL(path.join(tmp, 'creditUi.ts')).href)
const CREDIT_LIST_HEADERS: string[] = ui.CREDIT_LIST_HEADERS
const CREDIT_LIST_TOTAL_COLUMNS: readonly number[] = ui.CREDIT_LIST_TOTAL_COLUMNS
const CREDIT_RANGE_EXPORT_KINDS: readonly string[] = ui.CREDIT_RANGE_EXPORT_KINDS
const CREDIT_DETAIL_EXPORT_KINDS: readonly string[] = ui.CREDIT_DETAIL_EXPORT_KINDS
const creditDocLogo = ui.creditDocLogo
const creditExport = ui.creditExport
const creditListTotals = ui.creditListTotals

let pass = 0
let fail = 0
const out: string[] = []
function check(title: string, fn: () => boolean): void {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e: any) {
    err = String(e?.message ?? e)
  }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err ? ' -> ' + err : ''}`)
}

const NOW = new Date('2027-10-01T00:00:00Z')

/* ---------------- بند ۳ · §۶ — پیش‌سنجش فضای کد در صدور تکی ---------------- */
check('۱. کد آماده (مسیر گروهی) پیش‌سنجش دوباره نمی‌گیرد', () =>
  needsCodeSpaceCheck('CR7H2K') === false && needsCodeSpaceCheck('   ') === true && needsCodeSpaceCheck(undefined) === true)
check('۲. رشد طول کد تشخیص داده می‌شود (۸ ⇒ ۱۰)', () => {
  const g = codeGrowthOf(8, 10)
  return g.grown === true && g.from === 8 && g.to === 10
})
check('۳. بدون رشد، هیچ متنی به لاگ اضافه نمی‌شود', () => codeGrowthOf(8, 8).grown === false)
check('۴. ورودی خراب رشد جعلی نمی‌سازد', () =>
  codeGrowthOf(null, 10).grown === false && codeGrowthOf(8, 0).grown === false && codeGrowthOf('x', 'y').grown === false)

/* ---------------- بند ۴ · §۲/§۱۵ — شرط در AND می‌نشیند، نه روی OR ---------------- */
check('۵. شرط وضعیت مؤثر در AND می‌رود و OR جست‌وجو دست‌نخورده می‌ماند', () => {
  const base: any = { deletedAt: null, OR: [{ code: { contains: 'AB' } }] }
  const w: any = withAndClause(base, creditStatusWhere(CreditStatus.ACTIVE, NOW))
  return Array.isArray(w.AND) && w.AND.length === 1 && w.AND[0].status === CreditStatus.ACTIVE && w.OR.length === 1
})
check('۶. شرط خالی هیچ AND اضافه نمی‌کند (یعنی «همه»)', () => {
  const base: any = { deletedAt: null }
  return withAndClause(base, creditStatusWhere('', NOW)) === base && withAndClause(base, {}) === base
})
check('۷. AND قبلی حفظ می‌شود (شرط دوم جای اولی را نمی‌گیرد)', () => {
  const w: any = withAndClause(withAndClause({ a: 1 }, { x: 1 }), { y: 2 })
  return w.AND.length === 2 && w.AND[0].x === 1 && w.AND[1].y === 2 && w.a === 1
})
check('۸. ورودی اصلی جهش نمی‌کند (تابع خالص است)', () => {
  const base: any = { deletedAt: null }
  withAndClause(base, { x: 1 })
  return base.AND === undefined
})

/* ---------------- بند ۶ · §۱۶ — جست‌وجوی دومرحله‌ای ---------------- */
check('۹. عبارت عددی: شناسه، مشتری و شماره فیشِ مصرف مستقیم روی خود اعتبار', () => {
  const or = creditSearchWhere(creditSearchPlan('1024'))
  const keys = or.map((o) => Object.keys(o)[0])
  return keys.includes('id') && keys.includes('customerId') && keys.includes('usedReceiptNo')
})
check('۱۰. idهای مرحله‌ی دوم به هر سه ستون فاکتوری می‌خورند', () => {
  const or = creditSearchWhere(creditSearchPlan('1024'), { invoiceIds: [5, 7] })
  return CREDIT_SEARCH_INVOICE_COLUMNS.every((c) =>
    or.some((o: any) => o[c] && Array.isArray(o[c].in) && o[c].in.join() === '5,7')
  )
})
check('۱۱. creditIdهای دفتر مصرف به id اعتبار می‌خورند (relation پریزمایی وجود ندارد)', () => {
  const or: any[] = creditSearchWhere(creditSearchPlan('9'), { creditIds: [3, 3, 11, -1] })
  const hit = or.find((o) => o.id && o.id.in)
  return !!hit && hit.id.in.join() === '3,11'
})
check('۱۲. عبارت حرفی هیچ کوئری عددی لازم ندارد ولی کد و متن آزاد را می‌گیرد', () => {
  const or = creditSearchWhere(creditSearchPlan('AB12CD'))
  const keys = or.map((o) => Object.keys(o)[0])
  return keys.includes('code') && keys.includes('legacyCode') && keys.includes('customerName') && !keys.includes('id')
})
check('۱۳. عبارت خالی هیچ شرطی نمی‌سازد (فیلتر بی‌دلیل روی فهرست نمی‌افتد)', () =>
  creditSearchWhere(creditSearchPlan('   ')).length === 0)

/* ---------------- بند ۸ نیمه‌ی دوم · §۱۲ — snapshot کامل گیرنده ---------------- */
check('۱۴. snapshot گیرنده هر ۱۰ فیلد را دارد (قبلاً ۵ فیلد بود)', () => {
  const snap = holderSnapshot({ customerName: 'رضا', holderNationalId: '123', customerLocked: true })
  return (
    HOLDER_AUDIT_FIELDS.every((f) => f in snap) &&
    snap.holderNationalId === '123' &&
    snap.customerLocked === true &&
    snap.holderAddress === null
  )
})
check('۱۵. فیلدهای بولی هیچ‌وقت undefined نمی‌مانند (مقایسه‌ی before/after قابل اتکا باشد)', () => {
  const snap = holderSnapshot({})
  return snap.customerLocked === false && snap.reminderOptOut === false
})
check('۱۶. هر فیلد snapshot یک برچسب فارسی برای note دارد', () =>
  HOLDER_AUDIT_FIELDS.every((f) => typeof HOLDER_FIELD_LABELS[f] === 'string' && HOLDER_FIELD_LABELS[f].length > 1))
check('۱۷. تشخیص «چه چیزی عوض شد» با همین snapshot کار می‌کند', () => {
  const row = { customerName: 'رضا', holderPhone: '0912' }
  const before = holderSnapshot(row)
  const after = holderSnapshot({ ...row, holderAddress: 'تهران' })
  return HOLDER_AUDIT_FIELDS.filter((f) => before[f] !== after[f]).join() === 'holderAddress'
})

/* ---------------- بند ۸ نیمه‌ی دوم · §۱۰ — نسخه‌ی SQLِ «سابقه‌ی محافظت‌شده» ---------------- */
check('۱۸. قطعه‌ی SQL همه‌ی موجودیت‌ها و پیشوندهای محافظت‌شده را پارامتری می‌برد', () => {
  const p = auditProtectedSql()
  return (
    AUDIT_PROTECTED_ENTITIES.every((e) => p.params.includes(e)) &&
    AUDIT_PROTECTED_ACTION_PREFIXES.every((x) => p.params.includes(x)) &&
    !/LIKE/i.test(p.sql) &&
    p.sql.startsWith('(')
  )
})
check('۱۹. نسخه‌ی «قابل پاک‌سازی» دقیقاً نقیض همان است (پیش‌نمایش و DELETE یکی می‌مانند)', () => {
  const a = auditProtectedSql()
  const b = auditPurgeableSql()
  return b.sql === `NOT ${a.sql}` && b.params.join() === a.params.join()
})
check('۲۰. روی SQLite واقعی: همان ردیف‌هایی محافظت می‌شوند که تابع JS می‌گوید', () => {
  const rows: [string, string][] = [
    ['StoreCredit', 'CREDIT_VOID'],
    ['StoreCreditBatch', 'CREDIT_BULK_GENERATE'],
    ['StoreCreditRedemption', 'STORE_CREDIT_REDEEM'],
    ['SaleReturn', 'STORE_CREDIT_ISSUE'],
    ['SaleInvoice', 'credit_print'],
    ['SaleInvoice', 'DELETE'],
    ['Database', 'DATA_ARCHIVE_PURGE'],
    ['Product', 'CREDITX_FAKE'],
    [' StoreCredit ', 'PRICE_EDIT']
  ]
  const p = auditProtectedSql()
  const script = `
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE AuditLog (id INTEGER PRIMARY KEY, entity TEXT, action TEXT)')
    const ins = db.prepare('INSERT INTO AuditLog (id, entity, action) VALUES (?, ?, ?)')
    const rows = JSON.parse(process.env.ROWS)
    rows.forEach((r, i) => ins.run(i + 1, r[0], r[1]))
    const kept = db.prepare('SELECT id FROM AuditLog WHERE ' + process.env.SQL).all(...JSON.parse(process.env.PARAMS))
    console.log(JSON.stringify(kept.map((r) => r.id)))
  `
  const stdout = execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ROWS: JSON.stringify(rows), SQL: p.sql, PARAMS: JSON.stringify(p.params) }
  })
  const fromSql: number[] = JSON.parse(String(stdout).trim())
  const fromJs = rows.map((r, i) => (isProtectedAuditRow(r[0], r[1]) ? i + 1 : 0)).filter((n) => n > 0)
  if (fromSql.join() !== fromJs.join()) throw new Error(`SQL=${fromSql.join()} · JS=${fromJs.join()}`)
  // و واقعاً هم چیزی محافظت شود و هم چیزی پاک‌شدنی بماند (وگرنه تست بی‌معنا است)
  return fromJs.length > 0 && fromJs.length < rows.length
})

/* ---------------- بند ۷ · §۱۳ — لوگوی سند اعتبار ---------------- */
check('۲۱. لوگوی خالی رسید از لوگوی لیبل پر می‌شود (کاربر دو بار آپلود نکند)', () => {
  const l = creditDocLogo({ showLogo: true, logoDataUrl: '', fallbackDataUrl: 'data:image/png;base64,AAA', logoHeightMm: 12 })
  return l.show === true && l.src === 'data:image/png;base64,AAA' && l.heightMm === 12
})
check('۲۲. تیک خاموش = هیچ لوگویی، حتی وقتی تصویر هست', () =>
  creditDocLogo({ showLogo: false, logoDataUrl: 'data:image/png;base64,AAA' }).show === false)
check('۲۳. dataURL ناقص رد می‌شود (آیکن شکسته روی کاغذ نمی‌آید)', () => {
  const l = creditDocLogo({ showLogo: true, logoDataUrl: 'C:\\logo.png' })
  return l.show === false && l.src === ''
})
check('۲۴. ارتفاع لوگو کلمپ می‌شود (۰ و ۹۹۹ کاغذ را خراب نکنند)', () =>
  creditDocLogo({ showLogo: true, logoDataUrl: 'data:x', logoHeightMm: 0 }).heightMm === 10 &&
  creditDocLogo({ showLogo: true, logoDataUrl: 'data:x', logoHeightMm: 999 }).heightMm === 40)

/* ---------------- گام ۳ · §۱۵ — ردیف جمع و فهرست گزارش‌های بازه‌ای ---------------- */
check('۲۵. ردیف جمع هم‌طول سرستون‌هاست و جمع‌ها زیر ستون درست می‌نشینند', () => {
  const rows = [
    ['C1', 'مدیریتی', 'فعال', 1000, 200, 800],
    ['C2', 'تعویض', 'فعال', 500, 0, 500]
  ] as (string | number | null)[][]
  const t = creditListTotals(rows)
  return (
    t.length === CREDIT_LIST_HEADERS.length &&
    t[0] === 'جمع' &&
    t[3] === 1500 &&
    t[4] === 200 &&
    t[5] === 1300 &&
    CREDIT_LIST_TOTAL_COLUMNS.every((c) => CREDIT_LIST_HEADERS[c] !== undefined)
  )
})
check('۲۶. ستون‌های جمع‌دار همان «مبلغ/مصرف‌شده/باقی‌مانده» هستند', () =>
  CREDIT_LIST_TOTAL_COLUMNS.map((c) => CREDIT_LIST_HEADERS[c]).join('|') === 'مبلغ|مصرف‌شده|باقی‌مانده')
check('۲۷. خروجی فهرست از `creditExport` حالا ردیف جمع دارد (هر دو صفحه یکی)', () => {
  const sheet = creditExport('list', [{ code: 'C1', amount: 1000, usedAmount: 200, remaining: 800 }])
  return !!sheet && Array.isArray(sheet.totals) && sheet.totals![0] === 'جمع' && sheet.totals!.length === CREDIT_LIST_HEADERS.length
})
check('۲۸. گزارش‌های تک‌اعتباری در فهرست بازه‌ای نیستند و برعکس', () =>
  CREDIT_DETAIL_EXPORT_KINDS.every((k) => !CREDIT_RANGE_EXPORT_KINDS.includes(k)) &&
  CREDIT_RANGE_EXPORT_KINDS.length === 7 &&
  CREDIT_RANGE_EXPORT_KINDS.includes('list') &&
  CREDIT_RANGE_EXPORT_KINDS.includes('dashboard'))

/* ---------------- مصرفِ واقعی در سرویس (کد «هرگز اجرانشده» نماند) ---------------- */
const svc = fs.readFileSync('src/main/services/StoreCreditService.ts', 'utf8')
const sales = fs.readFileSync('src/main/services/SalesService.ts', 'utf8')
check('۲۹. بند ۳: صدور تکی واقعاً `assertCodeSpace` با `count: 1` و گاردِ کد آماده را صدا می‌زند', () =>
  /needsCodeSpaceCheck\(input\.code\)/.test(svc) && /assertCodeSpace\(client, \{[\s\S]{0,40}count: 1,/.test(svc) &&
  /length: codeLength,/.test(svc))
check('۳۰. بند ۴: داشبورد `groupBy` دوم را می‌گیرد و از `rollExpiredBuckets` رد می‌کند', () =>
  /expiresAt: \{ lte: now \}/.test(svc) && /rollExpiredBuckets\(groups\.map\(bucketOf\), expiring\.map\(bucketOf\)\)/.test(svc))
check('۳۱. بند ۴: فیلتر وضعیت از `creditStatusWhere` و داخل `withAndClause` می‌آید (نه ستون خام)', () => {
  // فقط بدنه‌ی `whereFromFilter` سنجیده می‌شود: فهرست *دسته‌ها* ستون وضعیت خودش را دارد و به اعتبار ربطی ندارد
  const body = svc.slice(svc.indexOf('async function whereFromFilter'))
  const scoped = body.slice(0, body.indexOf('\n}\n'))
  return (
    scoped.includes('withAndClause(where, creditStatusWhere(filter.status, now))') &&
    !/if \(filter\.status\) where\.status/.test(scoped)
  )
})
check('۳۲. بند ۶: جست‌وجو دومرحله‌ای است و `whereFromFilter` هر دو صدازننده await می‌شوند', () =>
  /async function whereFromFilter/.test(svc) && /creditSearchWhere\(plan, await creditSearchMatches\(plan\)\)/.test(svc) &&
  (svc.match(/await whereFromFilter\(/g) ?? []).length === 2)
check('۳۳. بند ۸: `before`/`after` تغییر گیرنده از `holderSnapshot` می‌آیند', () =>
  /const before = holderSnapshot\(row\)/.test(svc) && /const after = holderSnapshot\(\{ \.\.\.row, \.\.\.data \}\)/.test(svc))
check('۳۴. بند ۹: گارد §۱۹ در قالب مشترک عملیات مدیریتی است (نه یک عملیات خاص)', () =>
  /sourceChangeError\(row\.source, \(built\.data as Record<string, unknown>\)\.source\)/.test(svc))
// نشست ۶۱ (DECISIONS S61-6): صدازننده‌ی سوم = اعتبار اضافه‌دریافت (issueOverpayCreditTx)؛ همان قاعده، همان تابع.
check('۳۵. بند ۹: هر سه صدازننده‌ی SalesService (برگشت، تعویض، اضافه‌دریافت) از `exchangeCreditDays` رد می‌شوند', () =>
  (sales.match(/exchangeCreditDays\(\{/g) ?? []).length === 3 &&
  !/days: input\.creditDays \?\? defaults\.returnCodeDays/.test(sales) &&
  /exchangeDays: \(await readCreditSettings\(tx\)\)\.types\.EXCHANGE\.days/.test(sales))

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 30): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
