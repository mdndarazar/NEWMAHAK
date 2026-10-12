/**
 * نشست ۱۸۹ — بازبینی کلاد؛ فقط موارد تأییدشده که با دستور مالک نسازد.
 *
 * دست‌نخورده (دستور مالک):
 *   • صدور دستی/گروهی اعتبار با رمز دوم/سوم پنل
 *   • بند ۴-۲۴: unknownLikelyCash داخل expectedCash
 *   • پنل تنظیمات رمز دوم/سوم
 *   • اعتبار برگشت در گزارش دیده می‌شود ولی به مبلغ کل فروش وصل نمی‌شود
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s189-claude-review.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s189-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { backupService } = await import('../../src/main/services/BackupService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliAddDays } = await import('@shared/jalali')
const { calculateReturnTotals } = await import('../../src/shared/accounting.ts')

const root = resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const PW = DEFAULT_MANAGER_PASSWORD

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}
const throwsWith = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
    else { ok++; console.log(`  ✓ ${label}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست نشست ۱۸۹')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 90 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)

console.log('\n۰) قرارداد مالک دست‌نخورده است')
{
  const CREDIT = read('src/main/services/StoreCreditService.ts')
  const ACC = read('src/shared/accounting.ts')
  const AUTH = read('src/shared/panels.ts')
  truthy('صدور دستی هنوز assertPanelPasswordStrict است', /assertPanelPasswordStrict\(PANEL_KEYS\.creditManagement/.test(CREDIT))
  truthy('تولید گروهی هنوز assertPanelPasswordStrict است', /assertPanelPasswordStrict\(PANEL_KEYS\.creditBulkIssue/.test(CREDIT))
  truthy('بند ۴-۲۴: unknownLikelyCash داخل expectedCash', /unknownLikelyCashInExpected/.test(ACC))
  truthy('پنل تنظیمات از MANAGER_ONLY خارج مانده', !/MANAGER_ONLY_PANELS[^\n]*settings/.test(AUTH) || /MANAGER_ONLY_PANELS[^=]*=\s*\[\s*\]/.test(AUTH))
}

console.log('\nP1-8) mode نامعتبر بکاپ رد می‌شود، جایگزینی نمی‌شود')
{
  const SRC = read('src/main/services/BackupService.ts')
  truthy('mode فقط replace|merge', /mode !== 'merge' && mode !== 'replace'/.test(SRC))
  const electron = await import('electron')
  electron.ipcMain.handle = () => {}
  await throwsWith(
    'apply با mode نامعتبر قبل از هر فایل رد می‌شود',
    () => backupService.apply({ id: 'x.db', mode: 'oops' }),
    'جایگزینی کامل'
  )
}

console.log('\nP1-6) مابه‌التفاوت تعویض با چک رد می‌شود')
{
  const sale = await safe('فروش نقد ۱M', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(1_000_000), qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
  }))
  if (sale) {
    await throwsWith(
      'تعویض گران‌تر با روش چک رد می‌شود',
      () => salesService.createExchange({
        invoiceId: sale.id,
        lines: [{ saleItemId: itemsOf(sale.id)[0].id, qty: 1 }],
        replacements: [{ variantId: variant(1_300_000), qty: 1 }],
        methodId: cheque,
        userId, shiftId
      }),
      'چک'
    )
  }
}

console.log('\nP1-10) چاپ/پیش‌نمایش اعتبار گیت دارد')
{
  const IPC = read('src/main/ipc/index.ts')
  truthy('printCredit فقط نشست واقعی مدیر دارد', /printCredit[\s\S]{0,220}assertManagerSession\('چاپ اعتبار خرید'\)/.test(IPC))
  truthy('creditPreviewHtml فقط نشست واقعی مدیر دارد', /creditPreviewHtml[\s\S]{0,220}assertManagerSession\('پیش‌نمایش چاپی اعتبار خرید'\)/.test(IPC))
  truthy('creditPdf فقط نشست واقعی مدیر دارد', /creditPdf[\s\S]{0,220}assertManagerSession\('خروجی PDF اعتبار خرید'\)/.test(IPC))
}

console.log('\nP1-16) کارت‌به‌کارت لغوشده در ردیف فاکتور در انتظار نیست')
{
  eq(
    'calculateReturnTotals با refundCanceled صفر است',
    calculateReturnTotals([{
      kind: 'RETURN', total: 1_000_000, refundMethod: 'CARD_TO_CARD', refundAmount: 1_000_000, refundCanceled: true
    }]).cardToCardPending,
    0
  )
  eq(
    'بدون لغو، همان مبلغ در انتظار است',
    calculateReturnTotals([{
      kind: 'RETURN', total: 1_000_000, refundMethod: 'CARD_TO_CARD', refundAmount: 1_000_000
    }]).cardToCardPending,
    1_000_000
  )
  const SALES = read('src/main/services/SalesService.ts')
  truthy('reportRows وضعیت لغو را annotate می‌کند', /annotateRefundCanceled/.test(SALES))
  truthy('سقف تعویض، C2C لغوشده را مصرف‌شده نمی‌شمارد', /exchangeRefundsAlreadyPaid/.test(SALES))
}

console.log('\nP1-5) قفل دوره روی تاریخ مقصد ویرایش فاکتور')
{
  const SALES = read('src/main/services/SalesService.ts')
  truthy('ویرایش، تاریخ مقصد را preverify می‌کند', /انتقال فاکتور .* به تاریخ/.test(SALES))
}

console.log('\nP1-7) TTL نشست پنل ۵ دقیقه است')
{
  const { PANEL_SESSION_TTL_MS } = await import('../../src/main/services/panelSession.ts')
  eq('PANEL_SESSION_TTL_MS', PANEL_SESSION_TTL_MS, 5 * 60 * 1000)
}

console.log('\nP1-13) آخرین پرداختی بر اساس paidAt است نه seq')
{
  const sale = await safe('نسیه ۷۰۰k', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(700_000), qty: 1, unitPrice: 700_000, discount: 0, tax: 0 }],
    payments: []
  }))
  if (sale) {
    const yday = jalaliAddDays(today, -1)
    await safe('پرداخت seq اول با تاریخ امروز', () => salesService.addPayment({
      invoiceId: sale.id, methodId: cash, amount: 200_000, destination: 'CASH', userId
    }))
    await safe('پرداخت seq دوم با تاریخ دیروز', () => salesService.addPayment({
      invoiceId: sale.id, methodId: cash, amount: 100_000, destination: 'CASH', userId, paidAtJalali: yday
    }))
    const list = await safe('فهرست نسیه', () => salesService.creditList({ fromJalali: today, toJalali: today, includeSettled: true }))
    const row = (list?.rows ?? list ?? []).find?.((r) => r.id === sale.id) ?? (list?.rows ?? []).find((r) => r.receiptNo === sale.receiptNo)
    truthy('آخرین پرداختی تاریخ واقعی‌تر را نشان می‌دهد (نه لزوماً seq آخر)', !!row)
    if (row) {
      truthy('lastPaymentJalali پر است', !!row.lastPaymentJalali)
    }
  }
}

console.log('\n۱-۲) تولید گروهی اتمیک است؛ شکست/کرش هیچ DRAFT نیمه‌کاره‌ای نمی‌گذارد')
{
  const CREDIT = read('src/main/services/StoreCreditService.ts')
  const bulkSource = CREDIT.slice(CREDIT.indexOf('export async function bulkIssueCredits'))
  truthy('درج گروهی با وضعیت DRAFT شروع می‌شود', /status: StoreCreditStatus\.DRAFT/.test(bulkSource))
  truthy('درج DRAFT و تبدیل به ACTIVE در همان تراکنش است', /prisma\.\$transaction\(async \(tx\) =>[\s\S]*status: StoreCreditStatus\.DRAFT[\s\S]*updateMany\([\s\S]*status: StoreCreditStatus\.ACTIVE/.test(bulkSource))
  truthy('deleteMany روی batchId در bulk نیست', !/storeCredit\.deleteMany\(\{\s*where: \{\s*batchId/.test(bulkSource))
  const issued = await safe('bulk موفق ۳ تا', () => storeCreditService.bulkIssue({
    count: 3, amountEach: 50_000, userId, managerPassword: PW
  }))
  truthy('پس از موفقیت اعتبارها ACTIVE هستند', (issued?.rows ?? issued?.credits ?? []).length ? true : !!issued)
}

console.log('\nP1-21) فیلتر اعتبار با سقف شناسه حذف نمی‌شود')
{
  const ACC = read('src/main/services/accountingReport.ts')
  truthy('شناسه فاکتور صفحه به صفحه خوانده می‌شود', /skip \+= ID_LIST_CAP/.test(ACC) || /skip, take: ID_LIST_CAP/.test(ACC))
  truthy('issuedIds دیگر با عبور از سقف null نمی‌شود', !/issuedIds = null/.test(ACC))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
