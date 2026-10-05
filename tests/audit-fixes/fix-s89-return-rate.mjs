/**
 * نشست ۸۹ · خوشه I
 *
 * نرخ برگشت نباید با میانگین خامِ مبلغ برگشت سنجیده شود؛ با یک فروشنده
 * همیشه خودش میانگین می‌شود و هیچ‌وقت هشدار نمی‌دهد. این تست قرارداد
 * helper مقاوم در برابر نمونه‌های کم را تثبیت می‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s89-return-rate.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s89-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}

const { detectReturnRateOutliers } = await import('../../src/main/services/FraudService.ts')

const peers = detectReturnRateOutliers([
  { userId: 1, returnTotal: 400, returnCount: 2, salesTotal: 1000 },
  { userId: 2, returnTotal: 100, returnCount: 2, salesTotal: 1000 }
])
eq('در دو فروشنده، نرخ ۴۰٪ نسبت به همتای ۱۰٪ هشدار می‌دهد', peers.map((x) => x.userId).join(','), '1')

const one = detectReturnRateOutliers([
  { userId: 7, returnTotal: 300, returnCount: 2, salesTotal: 1000 }
])
eq('در یک فروشنده، نرخ مطلق ۳۰٪ با حداقل دو برگشت هشدار می‌دهد', one.map((x) => x.userId).join(','), '7')

const oneSmall = detectReturnRateOutliers([
  { userId: 8, returnTotal: 300, returnCount: 1, salesTotal: 1000 }
])
eq('یک برگشت تنها هشدار نرخ نمی‌سازد', oneSmall.length, 0)

const noSales = detectReturnRateOutliers([
  { userId: 9, returnTotal: 500, returnCount: 2, salesTotal: 0 }
])
eq('چند برگشت بدون فروشِ هم‌بازه پنهان نمی‌ماند', noSales.map((x) => x.userId).join(','), '9')

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
