/**
 * نشست ۹۸ · خوشه G (سقف بی‌صدا + سقف پارامتر SQLite) روی فیلتر اعتبار نشست ۹۷
 *
 * باگ: helper فیلتر اعتبار (نشست ۹۷) فاکتورهای منطبق را با `take: 50000`
 * می‌خواند و همان آرایه را دو بار در یک `IN` می‌گذاشت. نتیجه روی داده‌ی حجیم:
 *   • بالای ۵۰٬۰۰۰ فاکتور منطبق ⇒ اعتبار فاکتورهای بعدی بی‌صدا حذف می‌شد؛
 *   • بیش از ۳۲٬۷۶۶ پارامتر در یک کوئری ⇒ crash تب اعتبار (too many SQL variables).
 * تست رفتاری است و روی SQLite هارنس اجرا می‌شود (نه Prisma تولیدی).
 * اجرای «قبل»: MAHAK_ROOT=<کپی قبل از رفع> node --import ./test/harness/register.mjs <این فایل>
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s98-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)
const { harnessClient } = await imp('test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await imp('test/harness/seed.mjs')
const { storeCreditService } = await imp('src/main/services/StoreCreditService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const check = (label, cond, info = '') => (cond ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label} ${info}`)))

const userId = seed.user('مدیر تست حجم اعتبار')
// ممیزی A97-01 — نشست‌ها پشت‌سرهم (بند ۳)؛ مالک اعتبار بی‌سند برگشت = نشست باز لحظه‌ی ثبت
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3 * 3_600_000, closedAt: Date.now() - 3_600_000, userId })
const s2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: Date.now() - 3_600_000 + 1000, userId })
const inS1 = Date.now() - 2 * 3_600_000
const inS2 = Date.now() - 1_800_000

// ۵۰٬۰۱۰ فاکتور در شیفت ۱ با یک INSERT…SELECT (بدون حلقه‌ی JS)
const N = 50_010
const tplId = seed.insert('SaleInvoice', { receiptNo: 1, shiftId: s1, userId, status: 'SETTLED', issuedAtJalali: today })
const cols = [...db.$harness.tables.get('SaleInvoice').columns.keys()].filter((c) => c !== 'id')
const sel = cols.map((c) => (c === 'receiptNo' ? '(t."receiptNo" + n.i)' : `t."${c}"`)).join(', ')
sql.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${N - 1})
  INSERT INTO "SaleInvoice" (${cols.map((c) => `"${c}"`).join(', ')}) SELECT ${sel} FROM n, "SaleInvoice" t WHERE t.id = ${tplId}`)
const maxInv = sql.prepare('SELECT MAX(id) AS m FROM "SaleInvoice"').get().m
const otherInv = seed.insert('SaleInvoice', { receiptNo: 9_000_000, shiftId: s2, userId, status: 'SETTLED', issuedAtJalali: today })
const retInv = maxInv - 3
const retId = seed.insert('SaleReturn', { invoiceId: retInv, userId, shiftId: s1 })

const credit = (code, extra) =>
  seed.insert('StoreCredit', { code, amount: 1000, status: 'ACTIVE', issuedAt: Date.now(), createdAt: inS1, issuedAtJalali: today, ...extra })
const cEarly = credit('S98EARLY', { sourceInvoiceId: tplId + 5 })
const cLate = credit('S98LATE', { sourceInvoiceId: maxInv })
const cExch = credit('S98EXCH', { exchangeInvoiceId: maxInv - 1 })
const cRet = credit('S98RET', { returnId: retId })
const cOther = credit('S98OTHER', { sourceInvoiceId: otherInv, createdAt: inS2 })
const cManual = credit('S98MANUAL', { source: 'MANUAL' })

// ابزار سنجش: بیشترین تعداد پارامتر در یک statement
let maxParams = 0
const origPrepare = sql.prepare.bind(sql)
sql.prepare = (text) => {
  const n = (String(text).match(/\?/g) ?? []).length
  if (n > maxParams) maxParams = n
  return origPrepare(text)
}

let rows = null
let err = null
try {
  rows = await storeCreditService.list({ shiftId: s1, fromJalali: today, toJalali: today })
} catch (e) {
  err = e
}
check('فیلتر شیفت روی ۵۰٬۰۱۰ فاکتور بدون crash اجرا می‌شود', !err, err ? `· خطا: ${String(err?.message ?? err).slice(0, 120)}` : '')
const ids = new Set((rows ?? []).map((r) => r.id))
check('اعتبار فاکتور اولیه دیده می‌شود', ids.has(cEarly))
check('اعتبار فاکتور ۵۰٬۰۱۰ام (بعد از سقف قدیمی ۵۰٬۰۰۰) بی‌صدا حذف نمی‌شود', ids.has(cLate))
check('اعتبار صادرشده روی سند تعویض همان شیفت دیده می‌شود', ids.has(cExch))
check('اعتبار صادرشده از برگشتِ فاکتور همان شیفت دیده می‌شود', ids.has(cRet))
check('اعتبار فاکتور شیفت دیگر وارد نمی‌شود', !ids.has(cOther))
// ممیزی A97-01 (AUDIT-D27) — اعتبار دستی با فیلتر *مالک* (شیفت) از نشست باز لحظه‌ی ثبت می‌آید؛ با فیلتر *هویتی* فاکتور نمی‌آید
check('اعتبار دستی ثبت‌شده در نشست ۱ با فیلتر شیفت ۱ دیده می‌شود (مالک رویداد)', ids.has(cManual))
const byReceipt = new Set((await storeCreditService.list({ receiptNo: 1, fromJalali: today, toJalali: today })).map((r) => r.id))
check('اعتبار دستی بدون فاکتور با فیلتر هویتی فاکتور وارد نمی‌شود', !byReceipt.has(cManual))
check('هیچ کوئری بیش از ۳۲٬۷۶۶ پارامتر (سقف SQLite) نمی‌سازد', maxParams <= 32766, `· بیشینه ${maxParams}`)
check('lookupها در دسته‌های امن (≤ ۱٬۰۰۰ پارامتر) اجرا می‌شوند', maxParams <= 1000, `· بیشینه ${maxParams}`)

// بدون فیلتر فاکتوری رفتار قبلی حفظ می‌شود (همه‌ی اعتبارهای امروز)
const all = new Set((await storeCreditService.list({ fromJalali: today, toJalali: today })).map((r) => r.id))
check('بدون فیلتر فاکتوری همه‌ی اعتبارها (از جمله دستی) برمی‌گردند', [cEarly, cLate, cExch, cRet, cOther, cManual].every((id) => all.has(id)))

// برگشت باطل‌شده دیگر اعتبارش را به فاکتور وصل نمی‌کند (همان قرارداد نشست ۹۷)
sql.prepare('UPDATE "SaleReturn" SET voidedAt = ? WHERE id = ?').run(Date.now(), retId)
let afterVoid = new Set()
try {
  afterVoid = new Set((await storeCreditService.list({ shiftId: s1, fromJalali: today, toJalali: today })).map((r) => r.id))
} catch (e) {
  console.log(`  (خطای اجرای دوم: ${String(e?.message ?? e).slice(0, 80)})`)
}
check('برگشت باطل‌شده اعتبارش را از طریق فاکتور منطبق نمی‌کند', !afterVoid.has(cRet) && afterVoid.has(cLate))

// بیش از ظرفیت یک IN نهایی ⇒ خطای فارسی صریح، نه برش بی‌صدا و نه crash خام
const scCols = [...db.$harness.tables.get('StoreCredit').columns.keys()].filter((c) => c !== 'id')
const scSel = scCols
  .map((c) => (c === 'code' ? `('S98B' || n.i)` : c === 'sourceInvoiceId' ? `(${tplId} + (n.i % 40000))` : `t."${c}"`))
  .join(', ')
sql.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30001)
  INSERT INTO "StoreCredit" (${scCols.map((c) => `"${c}"`).join(', ')}) SELECT ${scSel} FROM n, "StoreCredit" t WHERE t.id = ${cEarly}`)
let bigErr = null
try {
  await storeCreditService.list({ shiftId: s1, fromJalali: today, toJalali: today })
} catch (e) {
  bigErr = e
}
const bigMsg = String(bigErr?.message ?? '')
check('بیش از ظرفیت ⇒ خطای فارسی با تعداد و راهنما (نه crash خام SQLite)', bigErr?.name === 'BusinessError' && bigMsg.includes('بیش از ظرفیت') && bigMsg.includes('محدودتر'), `· ${bigMsg.slice(0, 90)}`)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
