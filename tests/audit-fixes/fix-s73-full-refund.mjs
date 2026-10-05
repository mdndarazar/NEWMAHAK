/**
 * نشست ۷۳ — خوشه C / بند ۴-۱۱:
 * برگشت با مبلغ کاملِ بدون کسر تخفیف فقط با رمز و دلیل مدیر.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s73-full-refund.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s73-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const throwsWith = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const msg = String(e?.message ?? e)
    if (!msg.startsWith('HARNESS:') && msg.includes(needle)) {
      ok++; console.log(`  ✓ ${label} (رد شد: ${msg.split('\n')[0]})`)
    } else {
      bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${msg.split('\n')[0]}`)
    }
  }
}

const userId = seed.user('مدیر تست بازپرداخت کامل')
const cat = seed.category('پوشاک')
const product = seed.product('کالای تست بازپرداخت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 3_600_000, userId })
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
// نشست ۱۵۶ (S151-c2، S156-D6) — فقط setup: سرور عوارض ردیف را از تنظیمات بازمحاسبه می‌کند؛ عوارض ۵۰ ریالی
// همین تست با تنظیم «۵۰ ریال ثابت برای هر عدد» در پنل خرده ساخته می‌شود (قصد تست، بازپرداخت کامل، عوض نشده).
seed.setting('charges.tax.pos', { enabled: true, rules: [], fallback: { mode: 'FIXED', value: 50 } })

const createInvoice = () => salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 100, tax: 50 }],
  payments: [{ methodId: cash, amount: 950 }]
})
const itemOf = (invoiceId) => Number(seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', invoiceId).id)

const invoice = await createInvoice()
const itemId = itemOf(invoice.id)
await throwsWith(
  'override بدون رمز و دلیل رد می‌شود',
  () => salesService.createReturn({
    invoiceId: invoice.id, full: false, lines: [{ saleItemId: itemId, qty: 1 }],
    refundMethod: RefundMethod.CASH, managerFullRefund: true, userId
  }),
  'دلیل مدیر'
)
await throwsWith(
  'override با رمز غلط رد می‌شود',
  () => salesService.createReturn({
    invoiceId: invoice.id, full: false, lines: [{ saleItemId: itemId, qty: 1 }],
    refundMethod: RefundMethod.CASH, managerFullRefund: true,
    managerPassword: 'رمز-غلط', overrideReason: 'اصلاح تست', userId
  }),
  /**
   * به‌روزرسانی نشست ۱۸۳ — مقصود همان است: «رمز غلط باید رد شود».
   *
   * این گیت حالا علاوه بر رمز مدیر، رمز دوم و رمز سومِ پنل «برگشت از فروش» را
   * هم می‌پذیرد (خواسته‌ی مالک: دسترسی فرد مورد اعتماد در نبود مدیر). متن
   * خطا هم طبیعتاً از «رمز مدیر درست نیست» به پیام عمومی‌ترِ مسیر پنل عوض
   * شده، چون دیگر فقط یک رمز در کار نیست.
   *
   * چیزی که سنجیده می‌شود — رد شدنِ رمز غلط — یک ذره هم عوض نشده.
   */
  'رمز درست نیست'
)

const normalInvoice = await createInvoice()
const normal = await salesService.createReturn({
  invoiceId: normalInvoice.id, full: false, lines: [{ saleItemId: itemOf(normalInvoice.id), qty: 1 }],
  refundMethod: RefundMethod.CASH, userId
})
eq('برگشت عادی تخفیف را کسر می‌کند', Number(normal.refundAmount), 950)

// ممیزی A73-01 (AUDIT-D3): override فقط کسر تخفیف را برمی‌دارد، نه سقف پول دریافتی (۹۵۰).
const overrideInvoice = await createInvoice()
await throwsWith(
  'override بیش از پول دریافتی (۱۰۵۰ > ۹۵۰) رد می‌شود',
  () => salesService.createReturn({
    invoiceId: overrideInvoice.id, full: false, lines: [{ saleItemId: itemOf(overrideInvoice.id), qty: 1 }],
    refundMethod: RefundMethod.CASH, managerFullRefund: true,
    managerPassword: DEFAULT_MANAGER_PASSWORD, overrideReason: 'اصلاح مبلغ طبق تایید مدیر', userId
  }),
  'کسر تخفیف'
)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
