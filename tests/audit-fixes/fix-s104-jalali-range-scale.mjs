import { jalaliAddDays, jalaliDaysBetween } from '@shared/jalali'

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

const from = '1402/01/01'
const to = jalaliAddDays(from, 730)
const days = jalaliDaysBetween(from, to)
eq('بازه‌ی ۷۳۱روزه کامل برمی‌گردد', days.length, 731)
eq('ابتدای بازه حفظ می‌شود', days[0], from)
eq('انتهای بازه حفظ می‌شود', days.at(-1), to)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
