/**
 * نشست ۱۳۲ · خوشه J — پسوند خروجی باید با قالب انتخاب‌شده یکی باشد.
 *
 * شکاف: اگر Save dialog مسیر «گزارش» را بدون پسوند برگرداند و کاربر CSV را
 * انتخاب کرده باشد، ExportService نسخه‌ی قبلی به «گزارش.xlsx» پسوند می‌زد
 * ولی داده‌ی CSV می‌نوشت. این تست از همان ماک Save dialog نشست ۱۲۹ استفاده
 * می‌کند و جای Save dialog واقعی ویندوز را نمی‌گیرد.
 */
import { register } from 'node:module'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register('./support/s129-hooks.mjs', import.meta.url)

const mock = await import('./support/s129-electron-mock.mjs')
const { exportTableFile } = await import(new URL('../../src/main/services/ExportService.ts', import.meta.url).href)

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual === true) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 's132-export-extension-'))

mock.reset()
mock.state.dialogResult = { canceled: false, filePath: join(dir, 'گزارش-فروش') }
const csv = await exportTableFile({
  fileName: 'گزارش-فروش',
  format: 'csv',
  headers: ['عنوان', 'مبلغ'],
  rows: [['فروش', 125000]],
  reveal: false
})

check('قالب CSV بدون پسوند، پسوند csv می‌گیرد', csv.path.endsWith('.csv') && !csv.path.endsWith('.xlsx'))
check('محتوای فایل CSV بدون پسوند، CSV واقعی است', existsSync(csv.path) && readFileSync(csv.path, 'utf8').includes('عنوان,مبلغ'))
check('قالب گزارش و پسوند خروجی با هم سازگارند', csv.format === 'csv')

mock.reset()
mock.state.dialogResult = { canceled: false, filePath: join(dir, 'گزارش-فروش-اکسل') }
const xlsx = await exportTableFile({
  fileName: 'گزارش-فروش-اکسل',
  format: 'xlsx',
  headers: ['عنوان', 'مبلغ'],
  rows: [['فروش', 125000]],
  reveal: false
})
check('قالب XLSX بدون پسوند، پسوند xlsx می‌گیرد', xlsx.path.endsWith('.xlsx') && xlsx.format === 'xlsx')
check('فایل XLSX بدون پسوند با امضای ZIP ذخیره می‌شود', readFileSync(xlsx.path).subarray(0, 2).toString() === 'PK')

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
