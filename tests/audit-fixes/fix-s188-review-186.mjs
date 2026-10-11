/**
 * ===========================================================================
 * نشست ۱۸۸ — بازبینی مستقل نشست ۱۸۶ (موارد تأییدشده)
 *
 *   ۱  تعویض، اعتبار خرید را نقد نمی‌کند (۴-۳۲ / ۴-۳۷ / S59-5)
 *   ۳  overpayCreditBacking روی usedAmountِ BigInt کرش نمی‌کند
 *   ۲  ادغام بکاپ فیلدهای مالی را می‌نویسد و بکاپِ اعتبار را رد می‌کند
 *   ۶  کارت‌به‌کارت لغوشده از بلوک برگشت کم می‌شود
 *   ۵  نشست فقط‌وصول جمع صفر ندارد
 *  ۱۲  ensureCurrent با نشست جامانده AUTO تازه نمی‌سازد
 *
 * مورد ۴ (رمز دوم صدور اعتبار) و ۱۳ (بند ۴-۲۴) طبق دستور مالک دست نخورده‌اند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s188-review-186.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s188-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { cardTransferService } = await import('../../src/main/services/CardTransferService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliAddDays, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const { saleWhere } = await import('../../src/main/services/SalesService.ts')

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

const userId = seed.user('مدیر تست نشست ۱۸۸')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
/** کد قابل‌مصرف فقط برای آماده‌سازی سناریوی تست از دیتابیس harness خوانده می‌شود؛ DTO امن آن را پس نمی‌دهد. */
const fixtureCreditCode = (id) => seed.one('SELECT code FROM "StoreCredit" WHERE id = ?', id)?.code ?? null

console.log('\n۰) قرارداد: مورد ۴ و ۱۳ دست نخورده‌اند')
const CREDIT = read('src/main/services/StoreCreditService.ts')
const ACC = read('src/shared/accounting.ts')
truthy('صدور دستی هنوز assertPanelPasswordStrict است (دستور مالک)', /assertPanelPasswordStrict\(PANEL_KEYS\.creditManagement/.test(CREDIT))
truthy('بند ۴-۲۴: unknownLikelyCash هنوز داخل expectedCash است', /unknownLikelyCashInExpected/.test(ACC) && /expectedCash =/.test(ACC))

console.log('\n۱) تعویض اعتبار را نقد نمی‌کند')
{
  const issuedA = await safe('صدور اعتبار ۱M (الف)', () => storeCreditService.issueManual({ amount: 1_000_000, userId, managerPassword: PW }))
  const issuedB = await safe('صدور اعتبار ۱M (ب)', () => storeCreditService.issueManual({ amount: 1_000_000, userId, managerPassword: PW }))
  const saleOf = (code) => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(1_000_000), qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: [],
    storeCreditCode: code
  })
  const saleA = issuedA ? await safe('فروش الف فقط با بارکد', () => saleOf(fixtureCreditCode(issuedA.id))) : null
  const saleB = issuedB ? await safe('فروش ب فقط با بارکد', () => saleOf(fixtureCreditCode(issuedB.id))) : null
  if (saleA) {
    eq('فاکتور الف باقی‌مانده ندارد (اعتبار مصرف شد)', Number(saleA.remaining ?? 0), 0)
    await throwsWith(
      'تعویض با بازپرداخت نقدی روی فاکتورِ اعتباری رد می‌شود',
      () => salesService.createExchange({
        invoiceId: saleA.id,
        lines: [{ saleItemId: itemsOf(saleA.id)[0].id, qty: 1 }],
        replacements: [{ variantId: variant(600_000), qty: 1 }],
        refundMode: 'CASH',
        userId, shiftId
      }),
      'نقد نیستند'
    )
  }
  if (saleB) {
    const okEx = await safe('تعویض فاکتور ب با بارکد اعتبار مجاز است', () => salesService.createExchange({
      invoiceId: saleB.id,
      lines: [{ saleItemId: itemsOf(saleB.id)[0].id, qty: 1 }],
      replacements: [{ variantId: variant(600_000), qty: 1 }],
      refundMode: 'STORE_CREDIT',
      userId, shiftId
    }))
    truthy('تعویض با اعتبار ثبت شد', !!okEx)
  }
}

console.log('\n۳) usedAmountِ BigInt در overpayCreditBacking کرش نمی‌کند')
{
  const sale = await safe('فروش نقد برای extras', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(100_000), qty: 1, unitPrice: 100_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
  }))
  if (sale) {
    sql.prepare(
      `INSERT INTO "StoreCredit" (code, amount, "usedAmount", source, status, "sourceInvoiceId", "issuedAt", "issuedAtJalali", "voidedAt")
       VALUES ('ZZDEAD01', 50000, 12000, 'OVERPAY', 'CANCELED', ?, ?, ?, ?)`
    ).run(sale.id, Date.now(), today, Date.now())
    const view = await safe('payments با اعتبار OVERPAY باطل‌شده', () => salesService.payments({ invoiceId: sale.id }))
    truthy('payments کرش نکرد', !!view)
  }
}

console.log('\n۲) ادغام بکاپ')
{
  const MERGE = read('src/main/services/MergeService.ts')
  truthy('ادغام بکاپِ اعتبار را رد می‌کند', /assertMergeCreditSafe/.test(MERGE) && /جدول اعتبار در ادغام منتقل نمی‌شود/.test(MERGE))
  truthy('Payment.kind در ادغام کپی می‌شود', /kind: str\(p\.kind, 'CASH'\)/.test(MERGE))
  truthy('Payment.destination در ادغام کپی می‌شود', /destination: strOrNull\(p\.destination\)/.test(MERGE))
  truthy('Payment.voidedAt در ادغام کپی می‌شود', /voidedAt: dateOrNull\(p\.voidedAt\)/.test(MERGE))
  truthy('SaleInvoice.voidedAt در ادغام کپی می‌شود', /voidedAt: dateOrNull\(inv\.voidedAt\)/.test(MERGE))
  truthy('SaleReturn.kind و refundMethod کپی می‌شوند', /kind: str\(r\.kind, 'RETURN'\)/.test(MERGE) && /refundMethod: strOrNull\(r\.refundMethod\)/.test(MERGE))
}

console.log('\n۶) کارت‌به‌کارت لغوشده در بلوک برگشت نیست')
{
  const sale = await safe('فروش نقد ۱M برای C2C', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(1_000_000), qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
  }))
  if (sale) {
    const ret = await safe('برگشت C2C', () => salesService.createReturn({
      invoiceId: sale.id, full: false,
      lines: [{ saleItemId: itemsOf(sale.id)[0].id, qty: 1 }],
      refundMethod: RefundMethod.CARD_TO_CARD, refundAmount: 1_000_000, userId, shiftId
    }))
    const req = seed.one('SELECT id FROM "CardTransferRequest" WHERE "returnId" = ?', ret?.id ?? -1)
    if (req) {
      await safe('لغو درخواست C2C', () => cardTransferService.cancel({
        id: req.id, reason: 'تست نشست ۱۸۸', managerPassword: PW, userId
      }))
    }
    truthy('برگشت C2C ثبت شد', !!ret)
    const { statements } = await buildStatements({
      where: saleWhere({ fromJalali: today, toJalali: today }),
      from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
      period: { fromJalali: today, toJalali: today, source: 'explicit' },
      filter: { fromJalali: today, toJalali: today }
    })
    const c2c = (statements?.bridge?.rows ?? []).find((r) => r.key === 'cardToCardRefunds')
    eq('ردیف پل کارت‌به‌کارت بعد از لغو صفر است', Number(c2c?.amount ?? 0), 0)
  }
}

console.log('\n۵) نشست فقط‌وصول جمع صفر ندارد')
{
  const yday = jalaliAddDays(today, -1)
  const shiftY = seed.insert('Shift', { name: 'دیروز', number: 1, dayJalali: yday, openedAt: Date.now() - 86400_000, closedAt: Date.now() - 80000_000, userId })
  const oldSale = await safe('نسیه ۷۰۰k (بعد به دیروز منتقل می‌شود)', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: variant(700_000), qty: 1, unitPrice: 700_000, discount: 0, tax: 0 }],
    payments: []
  }))
  if (oldSale) {
    sql.prepare('UPDATE "SaleInvoice" SET "issuedAtJalali" = ?, "shiftId" = ? WHERE id = ?').run(yday, shiftY, oldSale.id)
    await safe('وصول امروز در نشست صبح', () => salesService.addPayment({
      invoiceId: oldSale.id,
      methodId: cash,
      amount: 700_000,
      destination: 'CASH',
      userId
    }))
    const report = await safe('گزارش امروز', () => salesService.reportRows({ fromJalali: today, toJalali: today }))
    const sess = (report?.groups ?? []).flatMap((g) => g.sessions ?? [])
    const thisShift = sess.find((s) => s.shiftId === shiftId)
    const cashOf = thisShift?.totals?.cashTotal ?? 0
    truthy('نشست امروز وصول ۷۰۰k را در جمع دارد', cashOf >= 700_000)
  }
}

console.log('\n۱۲) نشست جامانده AUTO تازه نمی‌سازد')
{
  const yday = jalaliAddDays(today, -1)
  seed.insert('Shift', {
    name: 'شب جامانده', number: 9, dayJalali: yday,
    openedAt: Date.now() - 20 * 3600_000, userId, closedAt: null
  })
  await throwsWith(
    'ensureCurrent با نشست دیشب باز، AUTO نمی‌سازد',
    () => shiftService.ensureCurrent(db, { userId }),
    'هنوز باز است'
  )
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
