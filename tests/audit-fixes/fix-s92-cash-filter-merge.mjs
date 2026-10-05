/**
 * نشست ۹۲ · خوشه F
 *
 * باگ: وقتی مدیر گزارش را روی یک شیفت قفل می‌کرد، گردش نقدی فقط shiftId را
 * اعمال می‌کرد و بازه‌ی تاریخ را دور می‌زد. در نتیجه واریز/برداشت‌های خارج از
 * بازه وارد عدد صندوق می‌شدند. فهرست جزئیات همین مشکل را داشت و userId را هم
 * اصلاً پشتیبانی نمی‌کرد.
 *
 * تست ساختاری است؛ Prisma Client تولیدی و Electron واقعی در این محیط حاضر
 * نیستند. قراردادِ query باید قبل از اجرای groupBy/findMany هر سه قید مستقل
 * را هم‌زمان بسازد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const accounting = read('src/main/services/accountingReport.ts')
const sales = read('src/main/services/SalesService.ts')
const movements = read('src/main/services/CashMovementService.ts')

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

const totalsBody = accounting.slice(
  accounting.indexOf('export async function cashMovementTotals'),
  accounting.indexOf('export async function cashMovementTotals') + 1600
)
const listBody = movements.slice(
  movements.indexOf('async list('),
  movements.indexOf('shape(r:')
)

check('قبل: شیفت نباید تاریخ را با شاخه‌ی انحصاری حذف کند', /input\.shiftId\s*!= null\s*\?\s*\{\s*shiftId: input\.shiftId\s*\}\s*:\s*\{\s*occurredAt/.test(totalsBody), false)
check('بعد: جمع گردش نقدی userId را می‌پذیرد', /userId\?: number \| null/.test(totalsBody))
check('بعد: جمع گردش نقدی shiftId و userId را مستقل اعمال می‌کند', /\.\.\.\(input\.shiftId != null \? \{ shiftId: input\.shiftId \} : \{\}\),[\s\S]{0,220}\.\.\.\(input\.userId != null \? \{ userId: input\.userId \} : \{\}\)/.test(totalsBody))
check('بعد: جمع گردش نقدی بازه را مستقل از شیفت اعمال می‌کند', /\.\.\.\(input\.from != null \|\| input\.to != null \? \{ occurredAt: dateRange/.test(totalsBody))
check('بعد: گزارش فروش userId را به جمع گردش نقدی می‌دهد', /cashMovementTotals\(\s*\{[\s\S]{0,180}userId: filter\.userId/.test(sales))

check('قبل: فهرست جزئیات نباید فقط یکی از شیفت یا تاریخ را انتخاب کند', /const where\s*=\s*filter\.shiftId\s*!= null\s*\?\s*\{\s*shiftId: filter\.shiftId\s*\}\s*:\s*\{[\s\S]{0,180}occurredAt/.test(listBody), false)
check('بعد: فهرست جزئیات userId را می‌پذیرد', /userId\?: number \| null/.test(listBody))
check('بعد: فهرست جزئیات shiftId و userId را مستقل اعمال می‌کند', /\.\.\.\(filter\.shiftId != null \? \{ shiftId: filter\.shiftId \} : \{\}\),[\s\S]{0,220}\.\.\.\(filter\.userId != null \? \{ userId: filter\.userId \} : \{\}\)/.test(listBody))
check('بعد: فهرست جزئیات تاریخ را با پیش‌فرض امروز نگه می‌دارد', /const fromJalali = filter\.fromJalali \?\? filter\.toJalali \?\? jalaliToday\(\)[\s\S]{0,1400}occurredAt:/.test(listBody))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
