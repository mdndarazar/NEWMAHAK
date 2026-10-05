/**
 * نشست ۸۴ · خوشه J
 *
 * xmlEscape در xlsx.ts کلاس کاراکتری داشت که با «-» شروع می‌شد (بازه‌ی NUL حذف
 * شده بود) و هر خط‌تیره‌ی متنی را به فاصله تبدیل می‌کرد: شماره فیش، کد رهگیری،
 * کد رنگ، تاریخ «۱۴۰۵-۰۶-۳۱» در Excel خراب می‌شد. این تست فایل xlsx واقعی
 * می‌سازد، sheet1.xml را از zip باز می‌کند و متن را بررسی می‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-xlsx-dash.mjs
 */
import { inflateRawSync } from 'node:zlib'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}

const { buildXlsx } = await import('../../src/main/services/xlsx.ts')

/** خواندن ساده‌ی ورودی‌های zip از روی local header ها */
function unzip(buf) {
  const out = new Map()
  let p = 0
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8)
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extraLen = buf.readUInt16LE(p + 28)
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8')
    const start = p + 30 + nameLen + extraLen
    const data = buf.slice(start, start + size)
    out.set(name, method === 8 ? inflateRawSync(data).toString('utf8') : data.toString('utf8'))
    p = start + size
  }
  return out
}

const ctrl = String.fromCharCode(1) + String.fromCharCode(0) + String.fromCharCode(31)
const buf = buildXlsx({
  name: 'برگشت',
  title: 'گزارش برگشت — آزمایش',
  headers: ['شماره فیش', 'کد رهگیری', 'رنگ', 'متن کنترلی'],
  rows: [['INV-1405-0012', 'TRK-77-ABC', 'A-12-B', `x${ctrl}y`]],
  totals: ['جمع', '-', '', '']
})
const files = unzip(buf)
const sheetName = [...files.keys()].find((k) => /xl\/worksheets\/sheet\d*\.xml$/.test(k))
const shared = files.get('xl/sharedStrings.xml') ?? ''
const xml = (files.get(sheetName) ?? '') + shared
eq('برگه‌ی xlsx پیدا شد', !!sheetName, true)
eq('شماره فیش با خط‌تیره سالم می‌ماند', xml.includes('INV-1405-0012'), true)
eq('کد رهگیری با خط‌تیره سالم می‌ماند', xml.includes('TRK-77-ABC'), true)
eq('کد رنگ با خط‌تیره سالم می‌ماند', xml.includes('A-12-B'), true)
eq('کاراکترهای کنترلی واقعی هنوز حذف می‌شوند', /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(xml), false)
eq('متن کنترلی به فاصله تبدیل شد', xml.includes('x   y'), true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
