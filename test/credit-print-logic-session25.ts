/**
 * سوییت منطق خالصِ «چاپ/PDF سند اعتبار» (جلسه ۲۵) — بدون node_modules، بدون
 * Electron، بدون دیتابیس.
 *
 * چرا وجود دارد؟ چاپ تکی/گروهی/دسته‌ای و PDF از جلسه ۲۱ تا ۲۴ ساخته شد ولی
 * **هرگز اجرا نشد**. خودِ `PrintService` قابل import نیست (electron + prisma)،
 * پس تصمیم‌هایش در `src/shared/creditPrint.ts` نشست و اینجا واقعاً اجرا می‌شود:
 * تکی یا دسته‌ای؟ کدام idها؟ سقف؟ چند سند در هر صفحه؟ نام فایل؟
 *
 * اجرا: node --experimental-strip-types test/credit-print-logic-session25.ts
 */
import path from 'node:path'

const mod: any = await import(path.resolve('src/shared/creditPrint.ts'))
const {
  CREDIT_PRINT_MAX_DOCS, CREDIT_PER_PAGE_MAX,
  applyCreditPrintCap, cleanCreditIds, creditBatchPerPage, creditPdfFileName, creditPrintPlan
} = mod

const A4 = { widthMm: 210, heightMm: 297 }
const A5 = { widthMm: 148, heightMm: 210 }
const A6 = { widthMm: 105, heightMm: 148 }
const T80 = { widthMm: 80, heightMm: null }

let pass = 0
let fail = 0
const out: string[] = []
const t = (title: string, fn: () => boolean) => {
  let ok = false
  let err = ''
  try { ok = fn() === true } catch (e: any) { err = String(e?.message ?? e) }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err ? ' -> ' + err : ''}`)
}

/* ---------------- تکی یا دسته‌ای (قاعده‌ی جلسه ۲۱، بدون تغییر) ---------------- */
t('P1. فقط id ⇒ سند تکی', () => {
  const p = creditPrintPlan({ id: 5 }, A4)
  return p.mode === 'single' && p.id === 5 && p.ids.length === 0 && p.requested === 1 && p.capped === false
})
t('P2. id + batchId ⇒ دسته‌ای (دسته برنده است)', () =>
  creditPrintPlan({ id: 5, batchId: 2 }, A4).mode === 'batch')
t('P3. id + آرایه‌ی خالی ids ⇒ باز هم تکی (آرایه‌ی خالی نباید مسیر را عوض کند)', () =>
  creditPrintPlan({ id: 5, ids: [] }, A4).mode === 'single')
t('P4. id + ids پر ⇒ دسته‌ای', () =>
  creditPrintPlan({ id: 5, ids: [7, 8] }, A4).mode === 'batch')
t('P5. هیچ ورودی ⇒ دسته‌ای با فهرست خالی (بک‌اند باید خطای فارسی بدهد، نه چاپ تکی اشتباه)', () => {
  const p = creditPrintPlan({}, A4)
  return p.mode === 'batch' && p.ids.length === 0 && p.id === null && p.batchId === null
})
t('P6. id غیرعددی/صفر ⇒ تکی نیست', () =>
  creditPrintPlan({ id: 0 }, A4).mode === 'batch' && creditPrintPlan({ id: NaN }, A4).mode === 'batch')

/* ---------------- پاک‌سازی idها (§۲۱ — ورودی renderer قابل‌اعتماد نیست) ---------------- */
t('P7. idها یکتا/مثبت/مرتب می‌شوند و خراب‌ها می‌افتند', () => {
  const ids = cleanCreditIds([3, 3, '2', -1, 0, null, undefined, 'x', 4.4, {}])
  return JSON.stringify(ids) === JSON.stringify([2, 3, 4])
})
t('P8. ids غیرآرایه ⇒ فهرست خالی', () =>
  cleanCreditIds('1,2,3').length === 0 && cleanCreditIds(null).length === 0)
t('P9. سقف سند در هر فایل واقعاً اعمال می‌شود و تعداد درخواستی گم نمی‌شود', () => {
  const big = Array.from({ length: CREDIT_PRINT_MAX_DOCS + 500 }, (_, i) => i + 1)
  const p = creditPrintPlan({ ids: big }, A4)
  return p.ids.length === CREDIT_PRINT_MAX_DOCS && p.requested === big.length && p.capped === true
})
t('P10. همان سقف روی فهرستی که از دیتابیس می‌آید (مسیر batchId)', () => {
  const fromDb = Array.from({ length: CREDIT_PRINT_MAX_DOCS + 1 }, (_, i) => i + 1)
  const r = applyCreditPrintCap(fromDb)
  return r.ids.length === CREDIT_PRINT_MAX_DOCS && r.requested === fromDb.length && r.capped === true
})
t('P11. زیر سقف ⇒ capped=false', () => {
  const r = applyCreditPrintCap([9, 1, 1, 5])
  return r.capped === false && JSON.stringify(r.ids) === JSON.stringify([1, 5, 9]) && r.requested === 3
})

/* ---------------- چند سند در هر صفحه ---------------- */
t('P12. A4 ⇒ ۴ سند، A5 ⇒ ۲، A6 ⇒ ۱', () =>
  creditBatchPerPage(A4) === 4 && creditBatchPerPage(A5) === 2 && creditBatchPerPage(A6) === 1)
t('P13. رسید حرارتی (ارتفاع آزاد) ⇒ هر صفحه یک سند', () =>
  creditBatchPerPage(T80) === 1)
t('P14. مقدار دستی معتبر رعایت می‌شود', () =>
  creditBatchPerPage(A4, 3) === 3 && creditBatchPerPage(T80, '2') === 2 && creditBatchPerPage(A4, 2.4) === 2)
t('P15. §۲۱ — مقدار دستی صفر/منفی/خراب نادیده گرفته می‌شود و پیش‌فرض کاغذ می‌آید', () =>
  creditBatchPerPage(A4, 0) === 4 && creditBatchPerPage(A4, -5) === 4 && creditBatchPerPage(A5, 'x') === 2 &&
  creditBatchPerPage(A6, null) === 1)
t('P16. §۲۱ — مقدار دستی نجومی کلمپ می‌شود (رندر نابود نمی‌شود)', () =>
  creditBatchPerPage(A4, 1e9) === CREDIT_PER_PAGE_MAX && creditBatchPerPage(A4, 999) === CREDIT_PER_PAGE_MAX)
t('P17. perPage داخل نقشه‌ی چاپ هم همان قاعده را دارد', () =>
  creditPrintPlan({ ids: [1, 2], perPage: 0 }, A4).perPage === 4 &&
  creditPrintPlan({ ids: [1, 2], perPage: 5 }, A4).perPage === 5)

/* ---------------- نام فایل PDF ---------------- */
t('P18. نام فایل تکی از id می‌آید', () =>
  creditPrintPlan({ id: 12 }, A4).fileName === 'credit-12.pdf')
t('P19. نام فایل دسته از batchId می‌آید', () =>
  creditPrintPlan({ batchId: 7 }, A4).fileName === 'credit-batch-7.pdf')
t('P20. انتخاب دستی چند ردیف (بدون دسته) ⇒ credit-batch-list.pdf', () =>
  creditPrintPlan({ ids: [4, 9] }, A4).fileName === 'credit-batch-list.pdf')
t('P21. creditPdfFileName مستقیم هم همان را می‌دهد', () =>
  creditPdfFileName({ mode: 'single', id: 3, batchId: null }) === 'credit-3.pdf' &&
  creditPdfFileName({ mode: 'batch', id: null, batchId: null }) === 'credit-batch-list.pdf')

/* ---------------- نامتغیرها ---------------- */
t('P22. در حالت تکی هیچ‌وقت فهرست ids برنمی‌گردد (شمارنده‌ی چاپ دوبار نمی‌خورد)', () =>
  creditPrintPlan({ id: 9 }, A4).ids.length === 0)
t('P23. نقشه هرگز id تکراری تحویل نمی‌دهد (§۱۳ — یک سند، یک شمارش)', () => {
  const ids = creditPrintPlan({ ids: [5, 5, 5, 6] }, A4).ids
  return ids.length === new Set(ids).size && ids.length === 2
})
t('P24. کاغذ سفارشی کوچک ⇒ یک سند در صفحه', () =>
  creditBatchPerPage({ widthMm: 100, heightMm: 150 }) === 1)

console.log(out.join('\n'))
console.log(`\ncredit-print-logic (جلسه ۲۵): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
