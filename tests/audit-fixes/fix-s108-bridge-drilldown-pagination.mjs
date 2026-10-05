/**
 * نشست ۱۰۸ · خوشه G
 *
 * باگ: اسناد سازنده‌ی هر ردیف پل تطبیق با take:200 بریده می‌شد و هیچ count یا
 * صفحه‌ی بعدی نداشت. این تست قرارداد backend، metadata مشترک و اتصال UI را
 * بررسی می‌کند؛ اجرای Prisma/Electron واقعی همچنان جداگانه لازم است.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/accountingReport.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')
const sales = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const ui = readFileSync(resolve(root, 'src/renderer/src/components/AccountingBlocks.tsx'), 'utf8')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

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

check('پل metadata صفحه‌ی اسناد سازنده را قرارداد می‌دهد', /sourcesPage\?: SaleReportPage/.test(types))
check('فیلتر صفحه‌ی drill-down کلید و skip/take دارد', /bridgeSourceKey\?: string[\s\S]*bridgeSourceSkip\?: number[\s\S]*bridgeSourceTake\?: number/.test(types))
// ممیزی A108-01: شاخه‌های پرداخت count را روی مجموعه‌ی منطبق نهایی (paymentDrill) می‌گیرند، نه where خام
// نشست ۱۷۲ (S172-D5): drill اعتبار حالا شمارش واقعی را از طول کامل backedIds می‌گیرد (نه طول صفحه)؛ اثبات رفتاری در fix-s172-bridge-drill-in-chunk.
check('سرویس پل count واقعی می‌گیرد', (/prisma\.storeCredit\.count\(\{ where \}\)/.test(service) || /const totalCount = backedIds\.length\n\s*const pageIds = backedIds\.slice\(skip, skip \+ take\)/.test(service)) && (/prisma\.payment\.count\(\{ where \}\)/.test(service) || /const paymentDrill = async[\s\S]*makePage\(matching\.length\)/.test(service)))
check('سرویس پل skip و take واقعی مصرف می‌کند', /orderBy: \{ id: 'desc' \}, skip, take/.test(service))
check('برگشت‌ها metadata را از کل matching می‌سازند', /matching\.slice\(skip, skip \+ take\)[\s\S]*makePage\(matching\.length\)/.test(service))
check('فاکتورهای نسیه‌ی باقی‌مانده بی‌صدا روی ۲۰۰ بریده نمی‌شوند', /key === 'uncollectedCredit'[\s\S]*orderBy: \{ id: 'desc' \}[\s\S]*take: 200/.test(service) === false)
check('SalesService پارامترهای صفحه را به buildStatements می‌دهد', /bridgeSourceKey:[\s\S]*bridgeSourceSkip:[\s\S]*bridgeSourceTake:/.test(sales))
check('UI صفحه‌ی بعد و قبل را دارد', /onBridgePage\?:[\s\S]*صفحه قبل[\s\S]*صفحه بعد/.test(ui))
check('UI صفحه را با کلید همان ردیف درخواست می‌کند', (/onBridgePage\(drill\.key, drill\.sourcesPage/.test(ui) || /onBridgePage\(drill\.key, pager\.(prev|next)Skip\)/.test(ui)) /* ممیزی A108-03 */)
check('صفحه‌ی گزارش callback drill-down را به سرویس وصل می‌کند', /onBridgePage=\{\(key, skip\) =>[\s\S]*bridgeSourceKey: key[\s\S]*bridgeSourceSkip: skip/.test(page))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
