/**
 * نشست ۱۰۱ · خوشه G
 *
 * فهرست اعتبار در نشست ۱۰۰ metadata برش را نشان می‌داد، اما کاربر هنوز
 * صفحه‌ی بعد واقعی نداشت. این تست قرارداد مشترک درخواست، state صفحه و دو
 * کنترل رفت‌وبرگشت را بررسی می‌کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const ui = readFileSync(resolve(root, 'src/shared/creditUi.ts'), 'utf8')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

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

check('قرارداد درخواست skip دارد', /skip\?: number/.test(ui))
check('skip در درخواست فهرست فرستاده می‌شود', /\.\.\.\(filter\.skip \? \{ skip: Math\.max\(0, Math\.round\(filter\.skip\)\) \} : \{\}\)/.test(ui))
check('صفحه‌ی فعلی در state نگه داشته می‌شود', /useState<SaleReportPage \| null>\(null\)/.test(page))
check('پاسخ paged امن از کانال اعتبار خوانده می‌شود', /call<PagedRows<StoreCreditSafeRow>>\(CH\.creditList/.test(page))
check('دکمه‌ی صفحه‌ی قبل وجود دارد', /صفحه‌ی قبل/.test(page))
check('دکمه‌ی صفحه‌ی بعد با skip صفحه را جلو می‌برد', /setCreditSkip\(pager\.nextSkip \?\? 0\)/.test(page) && /creditListPager\(creditPage, rows\.length/.test(page) /* ممیزی A101-01: منطق به creditListPager رفت */)
check('صفحه‌ی بعد با truncated قفل می‌شود', /disabled=\{busy \|\| pager\.nextSkip == null\}/.test(page) /* ممیزی A101-01 */)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
