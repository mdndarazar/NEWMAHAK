/**
 * یادآوری نسیه/چک سررسیدشده: هشدار، بستن برای همین شیفت، سه شیفت اول فوری، بعد هفتگی وسط شیفت.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s198-debt-cheque-reminder.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s198-debt-rem-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { debtReminderService, decideDebtReminderShow, midShiftMinutes } = await import('../../src/main/services/DebtReminderService.ts')
const { toJalaliDate, jalaliAddDays } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const yesterday = jalaliAddDays(today, -1)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}

const userId = seed.user('کارمند یادآوری')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 90 })
const shiftId = seed.insert('Shift', { name: 'شیفت اول', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variantId = seed.variant(product, 'سایز ۱')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = ? WHERE id = ?').run(1_000_000, variantId)

console.log('\n۰) قاعده نمایش')
{
  eq('وسط شیفت ۸–۱۴ = ۱۱:۰۰ به دقیقه', midShiftMinutes('08:00', '14:00'), 11 * 60)
  // زمان‌ها باید نسبت به «اکنون» باشند؛ تاریخ ثابت با عبور تقویم، آزمایشی را
  // نادرستاً به پیش از آخرین بستن می‌بُرد.
  const afterMid = new Date()
  afterMid.setHours(12, 0, 0, 0)
  const beforeMid = new Date(afterMid)
  beforeMid.setHours(8, 0, 0, 0)
  const base = {
    overdueCount: 1,
    shiftId: 10,
    shiftNumber: 1,
    now: beforeMid,
    midMinutes: 11 * 60,
    dismisses: []
  }
  eq('فاز اول بدون بستن → نشان بده', decideDebtReminderShow(base).show, true)
  eq('همین شیفت بسته شده → پنهان', decideDebtReminderShow({ ...base, dismisses: [{ shiftId: 10, shiftNumber: 1, dayJalali: today, at: Date.now() }] }).show, false)
  const three = [1, 2, 3].map((n) => ({ shiftId: n, shiftNumber: n, dayJalali: today, at: Date.now() - 1000 }))
  eq('بعد از ۳ بستن، قبل از وسط شیفت → پنهان', decideDebtReminderShow({ ...base, shiftId: 20, dismisses: three }).show, false)
  eq('بعد از ۳ بستن + وسط شیفت + ۷ روز نگذشته → پنهان', decideDebtReminderShow({ ...base, shiftId: 20, now: afterMid, dismisses: three }).show, false)
  const old = three.map((d) => ({ ...d, at: afterMid.getTime() - 8 * 24 * 3600_000 }))
  eq('بعد از ۳ بستن + وسط شیفت + ۸ روز → نشان بده', decideDebtReminderShow({ ...base, shiftId: 20, now: afterMid, dismisses: old }).show, true)
}

console.log('\n۱) نسیهٔ دیروز پرداخت‌نشده → هشدار')
{
  const sale = await salesService.create({
    userId, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: []
  })
  sql.prepare('UPDATE "SaleInvoice" SET issuedAtJalali = ?, issuedAt = ? WHERE id = ?').run(yesterday, Date.now() - 86400_000, sale.id)
  const due = await debtReminderService.due()
  eq('نسیه شمرده شد', due.nasiyehCount >= 1, true)
  eq('هشدار نشان داده می‌شود', due.show, true)
  const after = await debtReminderService.dismiss()
  eq('بعد از بستن در همین شیفت پنهان است', after.show, false)
  eq('dismissed', after.dismissed, true)
}

console.log('\n۲) چک سررسید گذشته')
{
  sql.prepare('DELETE FROM "Setting" WHERE key = ?').run('debtReminder.log')
  const sale = await salesService.create({
    userId, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: []
  })
  await salesService.addPayment({
    invoiceId: sale.id, amount: 1_000_000, kind: 'CHEQUE', dueDateJalali: yesterday, userId
  })
  const due = await debtReminderService.due()
  eq('چک سررسیدشده شمرده شد', due.chequeCount >= 1, true)
  eq('هشدار برای چک هم می‌آید', due.show, true)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
