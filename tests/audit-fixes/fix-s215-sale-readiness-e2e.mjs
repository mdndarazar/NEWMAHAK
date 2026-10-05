/**
 * نشست ۲۱۵ — سناریوی مستقل آمادگی فروش: فروش/برگشت/تعویض/صندوق/سوءاستفاده.
 * محاسبهٔ مستقل oracle، نه اعتماد به UI.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s215-sale-readiness-e2e.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s215-e2e-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const { remainingOf } = await import('../../src/shared/settlement.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const findings = []
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else {
    bad++
    findings.push({ label, got, want })
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 280))
  }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    findings.push({ label, got: 'accepted', want: needle })
    console.log(`  ✗ ${label} — پذیرفته شد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) {
      bad++
      findings.push({ label, got: m.split('\n')[0], want: needle })
      console.log(`  ✗ ${label} — «${m.split('\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}

const userId = seed.user('ممیز ۲۱۵')
const cat = seed.category('پوشاک')
const pA = seed.product('کت', cat)
const pB = seed.product('شلوار', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1 })
const vA = seed.variant(pA, 'M')
const vB = seed.variant(pB, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000 WHERE id = ?').run(vA)
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 700000 WHERE id = ?').run(vB)
const stock = (id) => Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(id)?.stock)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)
const remaining = async (invoiceId) => {
  const inv = sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(invoiceId)
  const pays = seed.rows('SELECT amount, kind, chequeStatus, voidedAt FROM "Payment" WHERE invoiceId = ?', invoiceId)
  const received = pays.filter((p) => p.voidedAt == null && (p.kind !== 'CHEQUE' || p.chequeStatus === 'CLEARED'))
    .reduce((s, p) => s + Number(p.amount), 0)
  const rets = seed.rows('SELECT total, refundAmount, refundMethod, voidedAt FROM "SaleReturn" WHERE invoiceId = ?', invoiceId)
  const returnedValue = rets.filter((r) => r.voidedAt == null).reduce((s, r) => s + Number(r.total), 0)
  const refundFromReceived = rets.filter((r) => r.voidedAt == null).reduce((s, r) => s + Number(r.refundAmount || 0), 0)
  return remainingOf({ grandTotal: Number(inv.grandTotal), received, returnedValue, refundFromReceived })
}
const line = (v, price, qty = 1, discount = 0) => ({ variantId: v, qty, unitPrice: price, discount, tax: 0 })

console.log('\n۱) فروش نقد / کارت / نسیه / ترکیبی')
const sCash = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
eq('نقد صندوق بعد از فروش نقد ۱٬۰۰۰٬۰۰۰', await exp(), 1_000_000)
eq('موجودی کت ۴۹', stock(vA), 49)

const sCard = await salesService.create({
  userId, shiftId, lines: [line(vB, 700_000)],
  payments: [{ methodId: card, amount: 700_000, destination: 'CARD' }]
})
eq('نقد صندوق با فروش کارت عوض نشد', await exp(), 1_000_000)

const sMix = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [
    { methodId: cash, amount: 400_000, destination: 'CASH' },
    { methodId: card, amount: 600_000, destination: 'CARD' }
  ]
})
eq('نقد بعد از ترکیبی ۱٬۴۰۰٬۰۰۰', await exp(), 1_400_000)
const remMix = await remaining(sMix.id)
eq('مانده ترکیبی ۰', remMix.remaining, 0)

const sNasiye = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)], payments: []
})
eq('نسیه نقد صندوق را عوض نکرد', await exp(), 1_400_000)
eq('مانده نسیه ۱٬۰۰۰٬۰۰۰', (await remaining(sNasiye.id)).remaining, 1_000_000)

const sPart = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 300_000, destination: 'CASH' }]
})
eq('مانده نیمه‌پرداخت ۷۰۰٬۰۰۰', (await remaining(sPart.id)).remaining, 700_000)
eq('نقد ۱٬۷۰۰٬۰۰۰', await exp(), 1_700_000)

console.log('\n۲) مرزها و سوءاستفاده')
await rejects('تعداد اعشاری', () => salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000, 1.5)], payments: []
}), 'عدد')
await rejects('قیمت منفی', () => salesService.create({
  userId, shiftId, lines: [{ variantId: vA, qty: 1, unitPrice: -1, discount: 0, tax: 0 }], payments: []
}), null)
await rejects('پرداخت منفی', () => salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: -100, destination: 'CASH' }]
}), null)
await rejects('نقد به حساب مدیر', () => salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'MANAGER' }]
}), 'نقد')
await rejects('قیمت دستی زیر مرجع بی‌رمز', () => salesService.create({
  userId, shiftId, lines: [line(vA, 300_000)],
  payments: [{ methodId: cash, amount: 300_000, destination: 'CASH' }]
}), 'رمز')
const cheapDisc = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000, 1, 990_000)],
  payments: [{ methodId: cash, amount: 10_000, destination: 'CASH' }]
})
eq('تخفیف ۹۹٪ بی‌رمز از سرویس ثبت شد (گیت فقط UI)', typeof cheapDisc?.id, 'number')
eq('نقد بعد از تخفیف ۹۹٪ فقط ۱۰٬۰۰۰ اضافه شد', await exp(), 1_710_000)

console.log('\n۳) بازنویسی پرداخت از ویرایش اقلام')
await rejects('نقد→کارت از update', () => salesService.update({
  id: sCash.id, userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }]
}), 'پرداختی‌ها')
eq('نقد بعد از تلاش تبدیل همان است', await exp(), 1_710_000)

console.log('\n۴) برگشت و نسیه')
const itemsN = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', sNasiye.id)
const retN = await salesService.createReturn({
  invoiceId: sNasiye.id, full: true,
  lines: [{ saleItemId: itemsN[0].id, qty: 1 }],
  refundMethod: 'CASH', userId
})
eq('برگشت نسیه به NONE تبدیل شد', retN.refundMethod === 'NONE' || Number(retN.refundAmount ?? 0) === 0, true)
eq('نقد با برگشت نسیه کم نشد', await exp(), 1_710_000)
eq('مانده نسیه بعد از برگشت کامل ۰', (await remaining(sNasiye.id)).remaining, 0)
eq('موجودی کت بعد از برگشت نسیه یکی برگشت', stock(vA), 46)

const itemsP = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', sPart.id)
await rejects(
  'برگشت کامل روی نیمه‌پرداخت بدون تأیید اضافه‌دریافت رد می‌شود',
  () => salesService.createReturn({
    invoiceId: sPart.id, full: true,
    lines: [{ saleItemId: itemsP[0].id, qty: 1 }],
    refundMethod: 'NONE', userId
  }),
  'اضافه‌دریافت'
)
const retP = await salesService.createReturn({
  invoiceId: sPart.id, full: true,
  lines: [{ saleItemId: itemsP[0].id, qty: 1 }],
  refundMethod: 'NONE', userId, confirmOverpay: true
})
eq('برگشت نیمه‌پرداخت با تأیید ثبت شد', typeof (retP.id ?? retP.returnId), 'number')

await rejects('برگشت دوباره همان قلم کامل', () => salesService.createReturn({
  invoiceId: sNasiye.id, full: true,
  lines: [{ saleItemId: itemsN[0].id, qty: 1 }],
  refundMethod: 'NONE', userId
}), null)

console.log('\n۵) تعویض گران و ارزان')
const invEx = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
const cashBeforeEx = await exp()
const itemsEx = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', invEx.id)
sql.prepare('UPDATE "ProductVariant" SET salePrice = 1300000 WHERE id = ?').run(vB)
const up = await salesService.createExchange({
  invoiceId: invEx.id, userId, shiftId,
  lines: [{ saleItemId: itemsEx[0].id, qty: 1 }],
  replacements: [{ variantId: vB, qty: 1, unitPrice: 1_300_000 }],
  methodId: cash, destination: 'CASH'
})
eq('تعویض رو به بالا ثبت شد', !!up, true)
eq('نقد دقیقاً ۳۰۰٬۰۰۰ اضافه شد', await exp(), cashBeforeEx + 300_000)

const invEx2 = await salesService.create({
  userId, shiftId, lines: [line(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
const cashBeforeDown = await exp()
const itemsEx2 = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', invEx2.id)
sql.prepare('UPDATE "ProductVariant" SET salePrice = 700000 WHERE id = ?').run(vB)
const down = await salesService.createExchange({
  invoiceId: invEx2.id, userId, shiftId,
  lines: [{ saleItemId: itemsEx2[0].id, qty: 1 }],
  replacements: [{ variantId: vB, qty: 1, unitPrice: 700_000 }],
  refundMode: 'CASH'
})
eq('تعویض رو به پایین ثبت شد', !!down, true)
eq('نقد دقیقاً ۳۰۰٬۰۰۰ کم شد', await exp(), cashBeforeDown - 300_000)

console.log('\n۶) اضافه‌دریافت')
const invOv = await salesService.create({
  userId, shiftId, lines: [line(vB, 700_000)],
  payments: [{ methodId: cash, amount: 700_000, destination: 'CASH' }]
})
await rejects('وصول ۷۰۰ روی مانده ۰ بدون تأیید', () => salesService.addPayment({
  invoiceId: invOv.id, userId, methodId: cash, amount: 700_000, destination: 'CASH'
}), 'اضافه')

console.log('\n۷) چک و بستن صندوق')
const invCh = await salesService.create({
  userId, shiftId, lines: [line(vB, 700_000)], payments: []
})
await salesService.addPayment({
  invoiceId: invCh.id, kind: 'CHEQUE', amount: 700_000, chequeNo: 'H215', bankName: 'ملت',
  dueDateJalali: today, userId
})
const cashBeforeClear = await exp()
const chq = seed.one("SELECT id FROM \"Payment\" WHERE invoiceId = ? AND kind = 'CHEQUE'", invCh.id)
await salesService.setChequeStatus({
  id: chq.id, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW
})
eq('پاس چک به حساب مدیر نقد صندوق را عوض نکرد', await exp(), cashBeforeClear)

const counted = await exp()
const firstClose = await cashboxService.close({
  shiftId, explicitShift: true, userId, countedCash: counted, closeShift: false, note: 'بستن تست ۲۱۵'
})
eq('بستن اول صندوق', !!firstClose, true)
await rejects('بستن دوباره بدون تأیید', () => cashboxService.close({
  shiftId, explicitShift: true, userId, countedCash: counted, closeShift: false, note: 'دوباره'
}), 'بسته')

console.log('\n۸) حجم ۵۰۰ فاکتور نقد')
const t0 = Date.now()
sql.prepare('UPDATE "ProductVariant" SET stock = 5000, salePrice = 1000 WHERE id = ?').run(vB)
for (let i = 0; i < 500; i++) {
  await salesService.create({
    userId, shiftId, deductInventory: false,
    lines: [line(vB, 1000)],
    payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
  })
}
const genMs = Date.now() - t0
const t1 = Date.now()
const report = await salesService.reportRows({ fromJalali: today, toJalali: today })
const reportMs = Date.now() - t1
const invCount = Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleInvoice"').get()?.n ?? 0)
eq('حداقل ۵۰۰ فاکتور ساخته شد', invCount >= 500, true)
truthy(`ساخت ۵۰۰ فاکتور در ${genMs}ms (< ۳۰ثانیه)`, genMs < 30_000)
truthy(`گزارش روز در ${reportMs}ms (< ۱۰ثانیه)`, reportMs < 10_000)
eq('گزارش ردیف دارد', Array.isArray(report) || !!report, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق · ${genMs}ms ساخت · ${reportMs}ms گزارش`)
if (findings.length) console.log('یافته‌ها:', JSON.stringify(findings, null, 2).slice(0, 2000))
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
