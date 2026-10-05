/**
 * نشست ۱۰۳ · خوشه G
 *
 * ریزتراکنش‌های کارمند چهار آرایه‌ی قدیمی را حفظ می‌کند، اما دیگر هرکدام
 * بی‌صدا روی ۲۰۰۰ ردیف بریده نمی‌شوند. این تست قرارداد page/count/warning
 * سرویس و اتصال صفحه‌ی بعد در UI را کنترل می‌کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/StaffReportService.ts'), 'utf8')
const helper = (() => { try { return readFileSync(resolve(root, 'src/shared/staffTransactionsPaging.ts'), 'utf8') } catch { return '' } })()
const ui = readFileSync(resolve(root, 'src/renderer/src/components/StaffPerformancePanel.tsx'), 'utf8')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const bodyOf = (name, next) => {
  const start = service.indexOf(name)
  const end = service.indexOf(next, start)
  return service.slice(start, end < 0 ? service.length : end)
}

const transactions = bodyOf('async transactions(', '  /**\n   * بند ۳')

check('درخواست ریزتراکنش skip و take دارد', /skip\?: number[\s\S]*take\?: number/.test(transactions))
check('count واقعی برای هر چهار آرایه گرفته می‌شود', /invoiceCount[\s\S]*returnCount[\s\S]*cardTransferCount[\s\S]*creditRedemptionCount/.test(transactions))
check('چهار صفحه metadata مستقل دارند', /pages: StaffTransactionsPages/.test(transactions) && /invoices: staffTransactionsPage[\s\S]*returns: staffTransactionsPage[\s\S]*cardTransfers: staffTransactionsPage[\s\S]*creditRedemptions: staffTransactionsPage/.test(transactions))
check('هر چهار query همان skip و take را مصرف می‌کنند', (transactions.match(/skip,\s*take/g) ?? []).length >= 4)
check('هشدار فارسی برای برش صفحه وجود دارد', /صفحه‌ی بعد را باز کنید تا گزارش ناقص نماند/.test(service + helper)) // ممیزی A103-01: متن به helper خالص رفت
check('سقف قدیمی take: 2000 حذف شده است', !/take:\s*2000/.test(transactions))
check('UI metadata صفحات را می‌خواند', /drill\.data\.pages/.test(ui))
check('UI صفحه‌ی قبل را به skip قبلی وصل می‌کند', /drillSkip - 500/.test(ui))
check('UI صفحه‌ی بعد را فقط با truncated فعال می‌کند', /some\(\(page\) => page\?\.truncated\)/.test(ui))
check('UI صفحه‌ی بعد را با skip جدید می‌خواند', /openDrill\(drill\.row, drillSkip \+ 500\)/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
