// @ts-check
/**
 * فاز ۸ — preference نمایشی آکاردئون صورت‌های حسابداری.
 * باید در نصب تازه بسته باشد، انتخاب تک‌بلوک‌ها پس از remount بماند، و هیچ
 * IPC/محاسبه/خروجی مالی نسازد.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/AccountingBlocks.tsx', 'utf8')
const prefs = readFileSync('src/renderer/src/lib/uiPrefs.ts', 'utf8')
const { defaultSalesAccountingBlocksOpen, parseSalesAccountingBlocksOpen } = await import('../../src/renderer/src/lib/uiPrefs.ts')

console.log('--- ۱. نصب تازه و دادهٔ خراب همهٔ بلوک‌ها را بسته نگه می‌دارند ---')
const keys = ['invoice', 'credit', 'returns', 'cheques', 'storeCredits', 'cash', 'bridge']
assert.deepEqual(defaultSalesAccountingBlocksOpen(), Object.fromEntries(keys.map((key) => [key, false])))
assert.deepEqual(parseSalesAccountingBlocksOpen(null), defaultSalesAccountingBlocksOpen())
assert.deepEqual(parseSalesAccountingBlocksOpen('{خراب'), defaultSalesAccountingBlocksOpen())
assert.deepEqual(parseSalesAccountingBlocksOpen({ version: 99, open: { invoice: true } }), defaultSalesAccountingBlocksOpen())
console.log('  ✓ نبود/خرابی/نسخهٔ ناآشنا = همه بسته')

console.log('--- ۲. preference نسخه‌دار فقط وضعیت بولی هر بلوک را حفظ می‌کند ---')
const oneOpen = parseSalesAccountingBlocksOpen({ version: 1, open: { returns: true, cash: false, unknown: true } })
assert.equal(oneOpen.returns, true)
assert.equal(oneOpen.cash, false)
for (const key of keys.filter((key) => key !== 'returns')) assert.equal(oneOpen[key], false)
assert.match(prefs, /mahak:ui:sales-accounting-blocks:v1/)
assert.match(prefs, /localStorage\.setItem/)
assert.match(prefs, /try \{[\s\S]*catch/, 'storage باید best-effort باشد')
console.log('  ✓ فقط کلیدهای شناخته‌شده و true صریح ذخیره می‌شوند')

console.log('--- ۳. AccountingBlocks فقط نمایش را تغییر می‌دهد ---')
assert.match(source, /useState\(readSalesAccountingBlocksOpen\)/)
assert.doesNotMatch(source, /useState\(true\)/, 'پیش‌فرض باز محلی نباید باقی بماند')
for (const key of keys.filter((key) => key !== 'bridge'))
  assert.match(source, new RegExp(`blockKey="${key}"`), `بلوک ${key} باید state مستقل داشته باشد`)
assert.match(source, /aria-expanded=\{open\}/, 'عنوان بلوک باید state را اعلام کند')
assert.match(source, /aria-expanded=\{blocksOpen\.bridge\}/, 'پل باید state مستقل را اعلام کند')
assert.match(source, /toggleBlock\('bridge'\)/, 'پل باید state مستقل bridge را تغییر دهد')
assert.match(source, /بستن همهٔ بخش‌ها/)
assert.match(source, /\{open && <table className="tbl"><tbody>\{children\}<\/tbody><\/table>\}/,
  'باز و بسته شدن فقط نمایش جدول را کنترل می‌کند')
assert.doesNotMatch(source, /window\.print|exportCsv|call\(CH\./,
  'کامپوننت آکاردئون نباید چاپ، خروجی یا درخواست حسابداری تازه بسازد')
console.log('  ✓ هیچ مسیر مالی تازه‌ای اضافه نشده است')

console.log('\nنتیجه: بلوک‌ها پیش‌فرض بسته، مستقل، پایدار و صرفاً نمایشی هستند.')
