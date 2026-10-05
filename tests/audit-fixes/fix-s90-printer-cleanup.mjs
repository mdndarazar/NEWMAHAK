/**
 * نشست ۹۰ · خوشه J · پاک‌سازی پنجره‌های مخفی چاپ.
 *
 * تست ساختاری است: Electron در این محیط در دسترس نیست. روی snapshot نشست ۸۹
 * قبل از رفع اجرا می‌شود و باید شکست بخورد، سپس بعد از رفع سبز می‌شود.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync(new URL('../../src/main/print/printer.ts', import.meta.url), 'utf8')
const printBody = source.slice(source.indexOf('export async function printHtml'), source.indexOf('export async function listPrinters'))
const listBody = source.slice(source.indexOf('export async function listPrinters'), source.indexOf('export async function pdfFromHtml'))

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  try {
    assert.equal(actual, expected)
    ok++
    console.log(`✓ ${label}`)
  } catch {
    bad++
    console.log(`✗ ${label}`)
  }
}

check('printHtml بدنه را داخل try محافظت می‌کند', /const win = new BrowserWindow[\s\S]*?try \{/.test(printBody))
check('printHtml در finally پنجره را می‌بندد', /finally \{\s*if \(!win\.isDestroyed\(\)\) win\.destroy\(\)/.test(printBody))
check('callback چاپ دیگر cleanup مستقل و دوگانه ندارد', !/success \? \(win\.destroy\(\), resolve\(\)\)/.test(printBody))
check('listPrinters بدنه را داخل try محافظت می‌کند', /const win = new BrowserWindow[\s\S]*?try \{/.test(listBody))
check('listPrinters در finally پنجره را می‌بندد', /finally \{\s*if \(!win\.isDestroyed\(\)\) win\.destroy\(\)/.test(listBody))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
