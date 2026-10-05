/**
 * نشست ۱۳۴ · خوشه J/F/G · قرارداد خروجی کامل گزارش
 *
 * باگ S121: چاپ A4 و Excel فقط ردیف‌های صفحه‌ی جاری را می‌بردند و هشدارِ
 * ناقص‌بودن، مشکل مالی را حل نمی‌کرد. قرارداد S133 این است:
 *   - پیش‌فرض خروجی = کل فیلتر اجراشده؛
 *   - «فقط صفحه‌ی جاری» تنها با تیک صریح فعال می‌شود؛
 *   - همه‌ی endpointهای صفحه‌بندی‌شده با readAllReportPages خوانده می‌شوند؛
 *   - دفتر رویداد و منابع ضدتقلب، سقف خروجی کامل خودشان را صریحاً می‌گیرند؛
 *   - A4، Excel و Excel تسویه‌های دوره‌های قبل از یک snapshot مشترک می‌خوانند.
 *
 * این تست ساختار قرارداد را کنترل می‌کند و helper واقعی reportOutput.ts را با
 * Node اجرا می‌کند. Electron/Prisma/Excel دسکتاپ را ادعا نمی‌کند.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const pagePath = resolve(root, 'src/renderer/src/pages/SalesReports.tsx')
const helperPath = resolve(root, 'src/renderer/src/lib/reportOutput.ts')
const salesServicePath = resolve(root, 'src/main/services/SalesService.ts')
const ledgerPath = resolve(root, 'src/main/services/SalesLedger.ts')
const fraudPath = resolve(root, 'src/main/services/FraudService.ts')

const page = readFileSync(pagePath, 'utf8')
const helper = readFileSync(helperPath, 'utf8')
const salesService = readFileSync(salesServicePath, 'utf8')
const ledger = readFileSync(ledgerPath, 'utf8')
const fraud = readFileSync(fraudPath, 'utf8')

let ok = 0
let bad = 0
const check = (label, actual, expected = true) => {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const blockFrom = (startMarker, ...endMarkers) => {
  const start = page.indexOf(startMarker)
  if (start < 0) return ''
  const ends = endMarkers.map((marker) => page.indexOf(marker, start + startMarker.length)).filter((i) => i >= 0)
  const end = ends.length ? Math.min(...ends) : page.length
  return page.slice(start, end)
}

const printBlock = blockFrom('  const printA4 = async () => {', '  const printThermal = async () => {')
const excelBlock = blockFrom('  const exportCsvNow = async () => {', '  /** خروجی اکسل جدول دوم تب نسیه')
const settlementBlock = blockFrom('  const exportSettlements = async () => {', '  /**\n   * نشست ۶۵')

check('پیش‌فرض خروجی کل فیلترشده است', /useState<OutputScope>\('all'\)/.test(page))
check('تیک صفحه‌ی جاری تنها راه خروجی محدود است', /فقط صفحه‌ی جاری را چاپ\/خروجی بگیر/.test(page) && /outputScope === 'page'/.test(page))
check('snapshot مشترکِ خروجی تعریف شده است', /const prepareOutputSnapshot = async \(\): Promise<ReportOutputSnapshot>/.test(page))
check('مسیر صفحه‌ی جاری عمداً همان snapshot صفحه را برمی‌گرداند', /if \(outputScope === 'page'\) return pageSnapshot/.test(page))
check('مسیر کل فیلترشده metadata مستقل از صفحه می‌سازد', /meta: outputMetaFor\('all', rowCount, warnings\)/.test(page))
check('چاپ A4 از snapshot کامل یا صفحه‌ی صریح استفاده می‌کند', /const output = await prepareOutputSnapshot\(\)/.test(printBlock) && /meta: output\.meta/.test(printBlock))
check('Excel اصلی از snapshot کامل یا صفحه‌ی صریح استفاده می‌کند', /const output = await prepareOutputSnapshot\(\)/.test(excelBlock) && /title: `[^`]*\$\{meta\}/.test(excelBlock))
check('Excel تسویه‌های دوره‌های قبل از همان snapshot می‌خواند', /const output = await prepareOutputSnapshot\(\)/.test(settlementBlock) && /output\.priorSettlements/.test(settlementBlock))
check('تمام سه مسیر خروجی snapshot را صدا می‌زنند', (page.match(/const output = await prepareOutputSnapshot\(\)/g) ?? []).length === 3)

check('سرجمع فروش با helper همه‌ی صفحه‌ها را می‌خواند', /CH\.saleReportRows[\s\S]*readAllReportPages/.test(page))
check('جزئیات فروش با helper همه‌ی صفحه‌ها را می‌خواند', /CH\.saleReportItems[\s\S]*readAllReportPages/.test(page))
check('برگشت و تعویض با helper همه‌ی صفحه‌ها را می‌خوانند', /CH\.saleReturnList[\s\S]*readAllReportPages/.test(page) && /CH\.saleExchangeList[\s\S]*readAllReportPages/.test(page))
check('چک و اعتبار خرید با helper همه‌ی صفحه‌ها را می‌خوانند', /CH\.saleChequeList[\s\S]*readAllReportPages/.test(page) && /CH\.storeCreditList[\s\S]*readAllReportPages/.test(page))
check('وصول نسیه‌ی دوره‌های قبل صفحه‌بندی مستقل دارد', /priorSkip: skip/.test(page) && /priorTake: take/.test(page) && /pageOfOutput\(response, 'priorPage'\)/.test(page))
check('دفتر رویداد در خروجی کامل سقف بزرگ را صریح می‌گیرد', /CH\.saleReportLedger, \{ \.\.\.serviceFilter, fullRange: true \}/.test(page) && /fullRange === true/.test(ledger))
check('منابع ضدتقلب در خروجی کامل سقف بزرگ را صریح می‌گیرند', /CH\.saleFraudReview, \{ \.\.\.serviceFilter, allSources: true \}/.test(page) && /input\.allSources === true/.test(fraud))
check('سرویس نسیه پارامترهای priorSkip/priorTake را می‌پذیرد', /priorSkip\?: number/.test(salesService) && /priorTake\?: number/.test(salesService))
check('helper تا totalCount می‌خواند، نه فقط پرچم truncated', /page\.totalCount <= nextSkip/.test(helper) && /page\.truncated/.test(helper))
check('helper سقف ایمن و خطای فارسی برای حلقه‌ی بی‌نهایت دارد', /guard < 10000/.test(helper) && /خروجی کامل نشد/.test(helper))

const probe = `
  import { readAllReportPages, pageOfOutput } from ${JSON.stringify(pathToFileURL(helperPath).href)}

  const calls = []
  const rowsBySkip = { 0: ['a', 'b'], 2: ['c', 'd'], 4: ['e'] }
  const result = await readAllReportPages(
    async (skip, take) => {
      calls.push([skip, take])
      return {
        rows: rowsBySkip[skip] ?? [],
        page: { skip, take: 2, totalCount: 5, truncated: true },
        warnings: ['هشدار عمومی', 'نمایش ۲ از ۵ ردیف']
      }
    },
    (response) => response.rows,
    (response) => pageOfOutput(response),
    2
  )
  if (JSON.stringify(result.rows) !== JSON.stringify(['a', 'b', 'c', 'd', 'e']))
    throw new Error('صفحه‌های helper کامل یا به‌ترتیب خوانده نشدند')
  if (JSON.stringify(calls) !== JSON.stringify([[0, 2], [2, 2], [4, 2]]))
    throw new Error('offsetهای helper تکراری یا ناقص‌اند')
  if (JSON.stringify(result.warnings) !== JSON.stringify(['هشدار عمومی']))
    throw new Error('هشدار صفحه‌بندی از هشدار واقعی جدا نشده است')

  let stalled = false
  try {
    await readAllReportPages(
      async () => ({ rows: ['x', 'y'], page: { skip: 0, take: 2, totalCount: 5 } }),
      (response) => response.rows,
      undefined,
      2
    )
  } catch (error) {
    stalled = String(error?.message ?? '').includes('پیشرفت نکرد')
  }
  if (!stalled) throw new Error('گارد عدم پیشرفت helper عمل نکرد')
  console.log(JSON.stringify({ rows: result.rows.length, calls, warnings: result.warnings, stalled }))
`
const probeRun = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe], {
  encoding: 'utf8'
})
check('اجرای helper واقعی: همه‌ی صفحه‌ها، هشدارها و گارد عدم پیشرفت', probeRun.status === 0 && /"stalled":true/.test(probeRun.stdout))
if (probeRun.status !== 0 || !/"stalled":true/.test(probeRun.stdout)) {
  if (probeRun.stdout) console.log(probeRun.stdout.trim())
  if (probeRun.stderr) console.log(probeRun.stderr.trim())
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
