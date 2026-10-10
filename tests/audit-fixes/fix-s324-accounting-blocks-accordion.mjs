// @ts-check
/**
 * گارد نمایشی آکاردئون صورت‌های حسابداری: این تغییر باید صرفاً باز/بسته کردن
 * بخش‌ها باشد، نه یک مسیر تازه برای محاسبه یا خروجی مالی.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/AccountingBlocks.tsx', 'utf8')

console.log('--- آکاردئون صورت‌های حسابداری ---')
assert.match(source, /function Block[\s\S]*?const \[open, setOpen\] = useState\(true\)/,
  'هر بلوک باید به‌طور پیش‌فرض باز بماند تا گزارش قبلی پنهان نشود')
assert.match(source, /aria-expanded=\{open\}/, 'دکمهٔ عنوان بلوک باید وضعیت باز/بسته را اعلام کند')
assert.match(source, /\{open \? '−' : '\+'\}/, 'دکمهٔ عنوان باید علامت واضح +/− داشته باشد')
assert.match(source, /const \[bridgeOpen, setBridgeOpen\] = useState\(true\)/,
  'پل تطبیق نیز باید آکاردئون مستقلِ پیش‌فرض‌باز باشد')
assert.match(source, /aria-expanded=\{bridgeOpen\}/)
assert.match(source, /\{bridgeOpen \? '−' : '\+'\}/)
assert.match(source, /\{open && <table className="tbl"><tbody>\{children\}<\/tbody><\/table>\}/,
  'باز و بسته شدن فقط نمایش جدول را کنترل می‌کند')
assert.match(source, /\{bridgeOpen && <table className="tbl">/,
  'باز و بسته شدن پل نیز فقط نمایش جدول را کنترل می‌کند')
assert.doesNotMatch(source, /window\.print|exportCsv|call\(CH\./,
  'کامپوننت آکاردئون نباید چاپ، خروجی یا درخواست حسابداری تازه بسازد')
console.log('  ✓ همهٔ بلوک‌ها با +/− باز و بسته می‌شوند و مسیر مالی جدیدی ندارند')
