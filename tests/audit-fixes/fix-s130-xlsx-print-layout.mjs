/**
 * نشست ۱۳۰ · خوشه J · چاپ Excel
 *
 * fitToWidth بدون fitToPage بی‌اثر بود و Excel عنوان/سرستون را در صفحات بعد
 * تکرار نمی‌کرد. این تست XML واقعی داخل xlsx تولیدشده را بررسی می‌کند.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const { buildXlsx } = await import(new URL('../../src/main/services/xlsx.ts', import.meta.url).href)

let ok = 0
let bad = 0
const check = (label, actual, expected = true) => {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mahak-s130-'))
const file = join(dir, 'report.xlsx')
try {
  writeFileSync(
    file,
    buildXlsx({
      name: 'گزارش/تعویض',
      title: 'گزارش تعویض کالا',
      headers: ['شماره فیش', 'جمع برگشتی', 'جمع جایگزین'],
      rows: [['JN-100-RED', 1000, 1300]],
      totals: ['جمع', 1000, 1300]
    })
  )
  const workbook = execFileSync('unzip', ['-p', file, 'xl/workbook.xml'], { encoding: 'utf8' })
  const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
  check('اکسل عنوان چاپ را برای سه ردیف اول ثبت می‌کند', workbook.includes("_xlnm.Print_Titles") && workbook.includes('$1:$3'))
  check('صفحه‌بندی عرض با fitToPage فعال است', sheet.includes('<pageSetUpPr fitToPage="1"/>') && sheet.includes('fitToWidth="1"'))
  check('ارتفاع چاپ نامحدود است تا همه‌ی ردیف‌ها منتقل شوند', sheet.includes('fitToHeight="0"'))
  check('نام فیش خط‌تیره‌دار دست‌نخورده باقی می‌ماند', sheet.includes('JN-100-RED'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
