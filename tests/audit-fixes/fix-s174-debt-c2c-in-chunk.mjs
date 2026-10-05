/**
 * ===========================================================================
 * نشست ۱۷۴ · خوشه D · ادامه‌ی S173 (بند ۳ نقطه‌ی شروع) — debtAdjustmentsByInvoice و سقف IN ۵۰۰
 *
 * فاکتورها دسته‌ی ۵۰۰تایی خوانده می‌شوند، ولی شناسه‌ی برگشت‌های کارت‌به‌کارتِ همان دسته (c2cIds)
 * بی‌سقف در `returnId in` درخواست‌های کارت‌به‌کارت می‌نشست. یک دسته‌ی فاکتور می‌تواند ۵۰۱+ برگشت
 * کارت‌به‌کارت داشته باشد (چند برگشت جزئی روی هر فاکتور) ⇒ عبور از سقف IN گزارش‌ها؛ این تابع
 * «بدهی واحد» همه‌ی مسیرهاست (addPayment، تب نسیه، گزارش فروش، صورت‌های حسابداری).
 * انتظار: هیچ IN بالای ۵۰۰ روی cardTransferRequest؛ بازپرداخت کارت‌به‌کارتِ لغوشده (حتی اگر
 * شناسه‌اش بعد از ۵۰۰ اول باشد) از «پس‌داده از دریافتی» بیرون بماند؛ بدهی فاکتور درست.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s174-debt-c2c-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s174b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { debtAdjustmentsByInvoice, invoiceRemaining } = await import('../../src/main/services/invoiceDebt.ts')
const { prisma } = await import('../../src/main/db/client.ts')

const db = harnessClient()
const seed = makeSeeder(db)

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}

let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['cardTransferRequest', 'saleReturn']) {
  const orig = prisma[model].findMany.bind(prisma[model])
  prisma[model].findMany = (args) => { walk(args?.where); return orig(args) }
}

const userId = seed.user('مدیر ۱۷۴ب')
const invX = seed.insert('SaleInvoice', { receiptNo: 17401, userId, status: 'PARTIALLY_RETURNED', issuedAtJalali: '1405/07/05', grandTotal: 100000, paidTotal: 100000 })
const invY = seed.insert('SaleInvoice', { receiptNo: 17402, userId, status: 'PARTIALLY_RETURNED', issuedAtJalali: '1405/07/05', grandTotal: 5000, paidTotal: 5000 })
const N = 520
const retIds = []
for (let i = 0; i < N; i++)
  retIds.push(seed.insert('SaleReturn', { invoiceId: invX, kind: 'RETURN', total: 100, refundMethod: 'CARD_TO_CARD', refundAmount: 100, returnedAt: Date.now() - 10_000 }))
// ۲۰ برگشت آخر (شناسه‌های بعد از ۵۰۰ اول): درخواست کارت‌به‌کارت لغو شده ⇒ پولی به مشتری نرسید
// + ۳ برگشت اول (دسته‌ی اول ۵۰۰تایی) هم لغوشده، تا هر دو دسته سهم داشته باشند
const canceledIds = [...retIds.slice(0, 3), ...retIds.slice(N - 20)]
const CANCELED = canceledIds.length
for (const rid of canceledIds)
  seed.insert('CardTransferRequest', { returnId: rid, sourceInvoiceId: invX, status: 'CANCELED', amount: 100 })
for (const rid of retIds.slice(5, 10))
  seed.insert('CardTransferRequest', { returnId: rid, sourceInvoiceId: invX, status: 'PAID', amount: 100 })
// فاکتور دوم در همان دسته: یک برگشت نقدی ساده
seed.insert('SaleReturn', { invoiceId: invY, kind: 'RETURN', total: 1000, refundMethod: 'CASH', refundAmount: 1000, returnedAt: Date.now() - 10_000 })

console.log('\n۱) ۵۲۰ برگشت کارت‌به‌کارت روی یک فاکتور، ۳ تای اول و ۲۰ تای آخر لغوشده')
maxIn = 0
let m
try { m = await debtAdjustmentsByInvoice(prisma, [invX, invY]) } catch (e) { m = { error: String(e?.message ?? e) } }
eq('بی‌خطا', m?.error ?? null, null)
const ax = m?.get?.(invX)
eq('ارزش برگشتی فاکتور X = ۵۲٬۰۰۰', ax?.returnedValue ?? null, N * 100)
eq('پس‌داده از دریافتی X = ۴۹۷ × ۱۰۰ (لغوشده‌ها بیرون)', ax?.refundFromReceived ?? null, (N - CANCELED) * 100)
const ay = m?.get?.(invY)
eq('فاکتور Y دست‌نخورده: ارزش ۱٬۰۰۰', ay?.returnedValue ?? null, 1000)
eq('فاکتور Y: پس‌داده ۱٬۰۰۰', ay?.refundFromReceived ?? null, 1000)
eq('هیچ IN بالای ۵۰۰ نبود', maxIn <= 500, true)

console.log('\n۲) بدهی واحد فاکتور X از همان تابع')
let r
try { r = await invoiceRemaining(prisma, invX, 100000, 100000) } catch (e) { r = { error: String(e?.message ?? e) } }
eq('بی‌خطا', r?.error ?? null, null)
// پرداخت ۱۰۰٬۰۰۰، برگشت ۵۲٬۰۰۰، پس‌داده ۴۹٬۷۰۰ ⇒ خالص دریافتی ۵۰٬۳۰۰ برای مانده‌ی ۴۸٬۰۰۰ ⇒ اضافه ۲٬۳۰۰
eq('payable = ۴۸٬۰۰۰', r?.payable ?? null, 100000 - N * 100)
eq('netReceived = ۵۰٬۳۰۰', r?.netReceived ?? null, 100000 - (N - CANCELED) * 100)
eq('اضافه‌دریافت = ۲٬۳۰۰ (سهم لغوشده‌ها)', r?.overpaid ?? null, CANCELED * 100)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
