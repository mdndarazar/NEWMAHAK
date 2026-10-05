/**
 * نشست ۷۶ · خوشه A · مرز روز کارت‌به‌کارت
 *
 * فیلتر گزارش درخواست‌های کارت‌به‌کارت باید کل روز شمسی را پوشش دهد،
 * نه ظهر روز انتخابی تا ظهر روز بعد.
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s76-card-transfer-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const source = readFileSync(resolve('src/main/services/CardTransferService.ts'), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq('سرویس کارت‌به‌کارت از helper شروع روز استفاده می‌کند', source.includes('jalaliStartOfDay'), true)
eq('سرویس کارت‌به‌کارت از helper پایان روز استفاده می‌کند', source.includes('jalaliEndOfDay'), true)
eq('helper قدیمیِ ساعت‌دار دیگر منبع بازه نیست', source.includes('jalaliToDateTime'), false)

const { jalaliRange } = await import('../../src/main/services/CardTransferService.ts')
const range = jalaliRange('1405/03/01', '1405/03/01')
eq('شروع بازه ساعت صفر است', range.gte.getHours(), 0)
eq('پایان بازه ۲۳:۵۹:۵۹.۹۹۹ است', range.lte.getHours(), 23)
eq('پایان بازه میلی‌ثانیه ۹۹۹ دارد', range.lte.getMilliseconds(), 999)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
