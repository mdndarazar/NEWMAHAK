/**
 * acceptance-src-session46.mjs — «نگهبان ساختاری» جلسه ۴۶.
 *
 * چرا این سوییت وجود دارد: کار الف (جلسه ۳۶/۴۱) و کار ب (جلسه ۴۰/۴۵) هر دو
 * سوییت دیتابیسیِ واقعی دارند (`acceptance-db-session36.mjs` و
 * `acceptance-db-session40.mjs`) و آن‌ها *رفتار* را تست می‌کنند. ولی چند قاعده‌ی
 * پرامپت اصلاً رفتار اجرایی نیست، «شکلِ درخت» است و بی `tsc`/بی رندر هیچ‌کس
 * نگهبانش نبود:
 *   • یک منبع حقیقت برای `refundMode` (سه‌جا یکی باشند)
 *   • «هیچ دکمه‌ی آزادسازی بیرون از پنل قفل‌دار» (قاعده‌ی فقط‌خواندنیِ کار ب)
 *   • «سایر دیگر بی‌صدا در کارت جمع نشود» (قاعده‌ی کار الف)
 *   • داده‌ی قدیمی: هیچ backfill/UPDATE حدسی در migration، و برابری migration با
 *     نسخه‌ی prisma/manual
 *   • سلامت نحویِ ۱۲ فایلی که هیچ‌وقت typecheck نشده‌اند
 * این سوییت جای `tsc` را **نمی‌گیرد**؛ فقط این قاعده‌ها را قفل می‌کند تا نشستِ
 * بعدی به‌صورت تصادفی نشکندشان.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const read = (f) => fs.readFileSync(f, 'utf8')
/** حذف کامنت‌ها — قاعده‌ها باید روی *کد* سنجیده شوند، نه روی توضیحات. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const quoted = (s) => (s.match(/'[A-Z_]+'/g) ?? []).map((x) => x.slice(1, -1)).sort()
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

let pass = 0, fail = 0
const results = []
function check(id, title, mode, fn) {
  let ok = false, err = ''
  try { ok = fn() === true } catch (e) { ok = false; err = String((e && e.message) || e) }
  if (ok) pass++; else fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${id}. ${title}${err ? ' -> ' + err : ''}`)
}

const types = read('src/shared/types.ts')
const sales = read('src/main/services/SalesService.ts')
const salesReturn = read('src/renderer/src/pages/SalesReturn.tsx')
const panels = read('src/shared/panels.ts')
const cardSvc = read('src/main/services/CardTransferService.ts')
const ipcMain = read('src/main/ipc/index.ts')
const mainTsx = read('src/renderer/src/main.tsx')
const hook = read('src/renderer/src/hooks/usePendingRestock.ts')
const shift = read('src/main/services/ShiftService.ts')
const cashbox = read('src/main/services/CashboxService.ts')
const enums = read('src/shared/enums.ts')
const migA = read('prisma/migrations/20270923100000_payment_destination/migration.sql')
const manA = read('prisma/manual/20270923_payment_destination.sql')
const migB = read('prisma/migrations/20270924100000_pending_restock_manager_payment/migration.sql')
const manB = read('prisma/manual/20270924_pending_restock_manager_payment.sql')

const DISPLAY_PAGES = {
  'src/renderer/src/pages/Products.tsx': 'products',
  'src/renderer/src/pages/SalesReports.tsx': 'salesReports',
  'src/renderer/src/pages/Stocktake.tsx': 'stocktake',
  'src/renderer/src/pages/CashClose.tsx': 'cashClose'
}

// ---------------------------------------------------------------------------
console.log('\n— بند ۱ · `refundMode` یک منبع حقیقت (بدهیِ تایپ جلسه ۴۵)')
// ---------------------------------------------------------------------------
const unionLine = (types.match(/refundMode\?:[^\n]*\n/) ?? [''])[0]
const unionVals = quoted(unionLine)

check(1, 'یونیون `ExchangeSaleInput.refundMode` هر چهار مقدار را دارد و nullable است', 'STRUCTURAL', () =>
  sameSet(unionVals, ['CARD', 'CARD_TO_CARD', 'CASH', 'STORE_CREDIT']) && /\|\s*null/.test(unionLine))

check(2, 'فهرست معتبرهای `SalesService.createExchange` **عیناً** همان یونیون است', 'STRUCTURAL', () => {
  const m = code(sales).match(/if \(refundMode && !\[[^\]]+\]\.includes\(refundMode\)\)/)
  return !!m && sameSet(quoted(m[0]), unionVals)
})

check(3, 'state تعویض در `SalesReturn.tsx` هم همان چهار مقدار را دارد (UI و تایپ یکی)', 'STRUCTURAL', () => {
  const m = code(salesReturn).match(/useState<[^>]*>\(null\)[^\n]*/g) ?? []
  const hit = m.find((x) => /CARD_TO_CARD/.test(x))
  return !!hit && sameSet(quoted(hit), unionVals)
})

check(4, '`CARD_TO_CARD` در تعویض به `deferRestock` وصل است (کار ب فقط برای همین حالت)', 'STRUCTURAL', () =>
  /deferRestock:\s*refundMode === 'CARD_TO_CARD'/.test(code(sales)))

// ---------------------------------------------------------------------------
console.log('\n— بند ۲ · قاعده‌ی «فقط‌خواندنی»: هیچ آزادسازی بیرون از پنل قفل‌دار')
// ---------------------------------------------------------------------------
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}
const rendererFiles = walk('src/renderer')
const WRITE_RX = /cardTransferPay|cardTransferCancel|cardTransferAdjust|releaseReturnStock|releaseStock/

check(5, 'در کل رندرر فقط `CardTransferPanel.tsx` کانال‌های نویسنده‌ی کارت‌به‌کارت را می‌شناسد', 'STRUCTURAL', () => {
  const hits = rendererFiles.filter((f) => WRITE_RX.test(code(read(f)))).map((f) => f.replace(/\\/g, '/'))
  return sameSet(hits.sort(), ['src/renderer/src/components/CardTransferPanel.tsx'])
})

check(6, 'هوک مشترک فقط `pendingRestockSummary` را صدا می‌زند (هیچ کانال نویسنده‌ای)', 'STRUCTURAL', () => {
  const ch = (code(hook).match(/CH\.[A-Za-z]+/g) ?? [])
  return ch.length > 0 && ch.every((c) => c === 'CH.pendingRestockSummary') && !WRITE_RX.test(code(hook))
})

check(7, 'هر چهار صفحه‌ی نمایشی از همان هوک مشترک می‌خوانند (چهار جمع موازی ساخته نشده)', 'STRUCTURAL', () =>
  Object.keys(DISPLAY_PAGES).every((f) => /import \{[^}]*usePendingRestock/.test(read(f)) && /usePendingRestock\(/.test(code(read(f)))))

check(8, 'هیچ صفحه‌ی نمایشی خودش `qty − restockedQty` را حساب نمی‌کند (تعریفِ معلق یک‌جاست)', 'STRUCTURAL', () =>
  // نمایش *ستون* `restockedQty` (گزارش برگشت‌ها، از قبل) اشکالی ندارد؛ چیزی که
  // ممنوع است، بازسازیِ خودِ **تعریفِ معلق** در رندرر است.
  Object.keys(DISPLAY_PAGES).every((f) => !/qty\s*[-\u2212]\s*[A-Za-z.]*restockedQty|restockedQty\s*[-\u2212]\s*[A-Za-z.]*qty/.test(code(read(f)))))

check(9, 'تعریف «معلق» فقط در `@shared/pendingRestock` و سرویس main زندگی می‌کند', 'STRUCTURAL', () => {
  const owners = ['src/shared/pendingRestock.ts', 'src/main/services/PendingRestockService.ts']
  return owners.every((f) => /qty[\s\S]{0,40}restockedQty/.test(read(f)))
})

// ---------------------------------------------------------------------------
console.log('\n— بند ۳ · قفل: همان مکانیزم موجود، سمت سرور هم')
// ---------------------------------------------------------------------------
check(10, 'ردیف `LOCKED_PANELS` برای `cardTransfers` هست و صریح می‌گوید آزادسازی انبار هم با همین قفل است', 'STRUCTURAL', () => {
  const row = panels.match(/key:\s*PANEL_KEYS\.cardTransfers[\s\S]{0,900}?\}/)
  return !!row && /موجودی|انبار/.test(row[0]) && /پرداخت شد/.test(row[0])
})

check(11, '`pay` و `cancel` هر دو سمت سرور `assertPanelPassword(PANEL_KEYS.cardTransfers, …)` می‌زنند', 'STRUCTURAL', () => {
  const c = code(cardSvc)
  const gates = c.match(/assertPanelPassword\(\s*PANEL_KEYS\.cardTransfers/g) ?? []
  return gates.length >= 2 && /async pay\(/.test(c) && /async cancel\(/.test(c)
})

check(12, 'مکانیزم جدیدی ساخته نشده: گیت از همان `AuthService` می‌آید', 'STRUCTURAL', () =>
  /import \{[^}]*assertPanelPassword[^}]*\} from '\.\/AuthService'/.test(cardSvc))

// نشست ۱۴۴ · بند ۴-۳۰ — قصد این چک (رمز و کاربر به سرویس برسد) حفظ شد؛ فقط actor
// دیگر از payload renderer (withUser) نمی‌آید، از نشست main (cardTransferActor ⇒ withSessionActor).
check(13, 'هندلرهای `pay`/`cancel`/`adjust` با actor نشست main (`cardTransferActor`) رد می‌شوند (رمز و کاربر به سرویس می‌رسد)', 'STRUCTURAL', () =>
  ['cardTransferPay', 'cardTransferCancel', 'cardTransferAdjust'].every((ch) =>
    new RegExp(`IPC\\.${ch},[^\\n]*cardTransferActor\\(p`).test(code(ipcMain))) &&
  /async function cardTransferActor[\s\S]{0,300}await withSessionActor\(/.test(code(ipcMain)))

check(14, 'هر چهار صفحه‌ی نمایشی در قفل خودشان مانده‌اند (کلید مخصوص خودشان)', 'STRUCTURAL', () =>
  Object.values(DISPLAY_PAGES).every((k) => new RegExp(`panel=\\{PANEL_KEYS\\.${k}\\}`).test(code(mainTsx))))

// ---------------------------------------------------------------------------
console.log('\n— بند ۴ · کار الف: «سایر» دیگر بی‌صدا در کارت جمع نمی‌شود')
// ---------------------------------------------------------------------------
check(15, 'هیچ‌جای کد «سایر» را دونفره با «کارت» جمع نمی‌کند (سبد کارت آلوده نمی‌شود)', 'STRUCTURAL', () => {
  /**
   * چیزی که پرامپت ممنوع کرده، جمعِ *دونفره‌ی* `cardTotal + otherTotal` است —
   * همان الگویی که چکِ پاس‌شده را بی‌صدا به «انتظار کارتخوان» می‌برد. جمعِ
   * سرجمعِ همه‌ی سبدها (`receivedTotal` در `CashboxService`: نقد + کارت + سایر +
   * نامشخص + اعتباری، بدون حساب مدیر) عمدی و مستند است و نباید سرخ شود؛ پس
   * طول زنجیره شمرده می‌شود، نه فقط وجود دو اسم کنار هم.
   */
  const all = [...walk('src/main'), ...walk('src/shared'), ...rendererFiles]
  const CHAIN = /(?:[A-Za-z_$][\w$.]*)(?:\s*\+\s*(?:[A-Za-z_$][\w$.]*))+/g
  const leaf = (t) => t.split('.').pop()
  const offenders = []
  for (const f of all) {
    for (const chain of code(read(f)).match(CHAIN) ?? []) {
      const terms = chain.split('+').map((t) => leaf(t.trim()))
      if (terms.length === 2 && terms.includes('cardTotal') && terms.includes('otherTotal'))
        offenders.push(`${f}: ${chain.trim()}`)
    }
  }
  return offenders.length === 0 || (() => { throw new Error(offenders.join(' | ')) })()
})

check(16, 'هر سه مصرف‌کننده‌ی سرور ردیف جدای «حساب مدیر» و «نامشخص» دارند', 'STRUCTURAL', () =>
  [shift, cashbox, sales].every((s) => /managerAccount/i.test(s) && /destinationUnknown/.test(s)))

check(17, 'چکِ پاس‌شده در شیفت با `clearedAt` سنجیده می‌شود، نه فقط `paidAt`', 'STRUCTURAL', () => {
  const src = code(cashbox)
  const i = src.indexOf('async function shiftPaymentsOf')
  const j = src.indexOf('\n}', i)
  if (i < 0 || j < 0) return false
  const fn = src.slice(i, j)
  return /clearedAt/.test(fn) && /paidAt/.test(fn)
})

check(18, 'مقصد از روش پرداخت مشتق می‌شود (یک منبع حقیقت، نه دو عدد متفاوت)', 'STRUCTURAL', () =>
  /export function destinationFromMethodKind/.test(enums) && /export function allowedDestinationsFor/.test(enums))

check(19, 'حساب مدیر جزو دریافتیِ نقد/کارت شمرده نمی‌شود (تابع تفکیک صریح دارد)', 'STRUCTURAL', () =>
  /PaymentDestination\.MANAGER/.test(enums) && /MANAGER_ACCOUNT_ROW_NOTE/.test(enums))

// ---------------------------------------------------------------------------
console.log('\n— بند ۵ · داده‌ی قدیمی و migration: هیچ حدسی، هیچ عدد عوض‌شده‌ای')
// ---------------------------------------------------------------------------
const sqlBody = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

check(20, 'هیچ `UPDATE`/`DROP`/`RENAME` در دو migration نیست (فقط ستون جدید و ایندکس)', 'REAL', () =>
  [migA, migB].every((s) => !/\b(UPDATE|DROP|RENAME|DELETE)\b/i.test(sqlBody(s))))

check(21, 'ستون مقصد nullable است و DEFAULT ندارد ⇒ داده‌ی قدیمی «نامشخص» می‌ماند', 'REAL', () =>
  /ALTER TABLE "Payment" ADD COLUMN "destination" TEXT;/.test(sqlBody(migA)) &&
  !/destination" TEXT[^\n;]*DEFAULT/i.test(sqlBody(migA)))

check(22, 'نسخه‌ی `prisma/manual` هر دو کار با migration مو‌به‌مو یکی است', 'REAL', () => {
  const stmts = (s) => sqlBody(s).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).sort()
  return sameSet(stmts(migA), stmts(manA)) && sameSet(stmts(migB), stmts(manB))
})

check(23, 'پرچم معلق برای ردیف‌های موجود false است ⇒ برگشت‌های قدیمی دوباره اضافه نمی‌شوند', 'REAL', () =>
  /"restockPending" BOOLEAN NOT NULL DEFAULT false/.test(sqlBody(migB)) &&
  /"pendingRestockQty" INTEGER NOT NULL DEFAULT 0/.test(sqlBody(migB)))

check(24, 'دو مفهوم قاطی نشده‌اند: مقصد پول در migration الف، معلق انبار در migration ب', 'REAL', () =>
  !/destination/i.test(sqlBody(migB)) && !/restock/i.test(sqlBody(migA)))

// ---------------------------------------------------------------------------
console.log('\n— بند ۶ · سلامت نحوی ۱۲ فایلی که هیچ‌وقت typecheck نشده‌اند')
// ---------------------------------------------------------------------------
const NEVER_TYPECHECKED = [
  'src/shared/types.ts', 'src/shared/ipc.ts', 'src/shared/panels.ts',
  'src/main/ipc/index.ts', 'src/main/services/StockCountService.ts',
  'src/renderer/src/components/CardTransferPanel.tsx',
  'src/renderer/src/hooks/usePendingRestock.ts',
  'src/renderer/src/pages/Products.tsx', 'src/renderer/src/pages/SalesReports.tsx',
  'src/renderer/src/pages/Stocktake.tsx', 'src/renderer/src/pages/CashClose.tsx',
  'src/renderer/src/pages/SalesReturn.tsx'
]
let parseOut = ''
try {
  parseOut = execFileSync(process.execPath, ['tools/tsx-parse-check.mjs', ...NEVER_TYPECHECKED], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  })
} catch (e) {
  parseOut = String((e.stdout ?? '') + (e.stderr ?? ''))
}
NEVER_TYPECHECKED.forEach((f, i) =>
  check(25 + i, `parse-check سالم: ${f}`, 'REAL', () =>
    new RegExp(`PASS\\s+${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(parseOut)))

// ---------------------------------------------------------------------------
console.log('\n' + results.join('\n'))
console.log(`\nنگهبان ساختاری (جلسه ۴۶): ${pass} PASS · ${fail} FAIL`)
console.log('⚠️ این سوییت جای `tsc` را نمی‌گیرد؛ فقط قاعده‌های شکلی را قفل می‌کند.')
process.exit(fail ? 1 : 0)
