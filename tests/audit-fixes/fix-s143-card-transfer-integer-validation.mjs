/**
 * ===========================================================================
 * نشست ۱۴۳ · خوشه E · بند ۴-۲۸(د) — validation عددی کارت‌به‌کارت
 *
 * قبل از رفع (CardTransferService):
 *   ۱) createCardTransferRequest مبلغ را Math.round می‌کرد (۵۰۰٫۶ ⇒ ۵۰۱)؛
 *   ۲) pay: paidAmount اعشاری بی‌صدا گرد می‌شد و «پرداخت شد» + آزادسازی کالا ثبت می‌شد؛
 *   ۳) adjust: مبلغ اصلاحی اعشاری/1e20 گرد یا پذیرفته می‌شد و ردیف PAID می‌ساخت؛
 *   ۴) شناسه‌ی اعشاری در pay/adjust به «پیدا نشد» یا رفتار مبهم می‌رسید.
 * انتظار: رد با پیام فارسی (با واحد ریال)، بدون ساخت/تغییر هیچ ردیف.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s143-card-transfer-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s143c-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const ct = await import('../../src/main/services/CardTransferService.ts')
const { cardTransferService, createCardTransferRequest } = ct
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — ورودی نامعتبر پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 90)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}
const rows = () => seed.count('CardTransferRequest', '1 = 1')

const userId = seed.user('مدیر تست نشست ۱۴۳')
const inv = seed.invoice({ grandTotal: 1000000 })
const invId = typeof inv === 'object' ? inv.id : inv
const retId = seed.insert('SaleReturn', { invoiceId: invId, total: 500000, returnedAt: Date.now(), returnedAtJalali: toJalaliDate(new Date()), kind: 'RETURN' })

console.log('\n۱) createCardTransferRequest: مبلغ اعشاری/متنی ⇒ رد')
await rejects('مبلغ ۵۰۰۰۰۰٫۶', () => createCardTransferRequest(db, { returnId: retId, amount: 500000.6, userId }), 'ریال')
await rejects('مبلغ متنی', () => createCardTransferRequest(db, { returnId: retId, amount: '500000', userId }), 'ریال')
eq('درخواست ساخته‌شده پس از ورودی نامعتبر', rows(), 0)
const req = await safe('درخواست معتبر ۵۰۰٬۰۰۰', () => createCardTransferRequest(db, { returnId: retId, amount: 500000, userId }))
eq('مبلغ درخواست', Number(req?.amount), 500000)

console.log('\n۲) pay: paidAmount/شناسه‌ی نامعتبر ⇒ رد و وضعیت PENDING می‌ماند')
await rejects('paidAmount اعشاری', () => cardTransferService.pay({ id: req.id, paidAmount: 400000.5, userId, managerPassword: PW }), 'ریال')
await rejects('paidAmount 1e20', () => cardTransferService.pay({ id: req.id, paidAmount: 1e20, userId, managerPassword: PW }), 'ریال')
await rejects('شناسه‌ی اعشاری', () => cardTransferService.pay({ id: req.id + 0.5, userId, managerPassword: PW }), 'عدد صحیح')
eq('وضعیت درخواست', seed.one('SELECT status FROM "CardTransferRequest" WHERE id = ?', req.id)?.status, 'PENDING')

console.log('\n۳) adjust: مبلغ اصلاحی نامعتبر ⇒ رد و صفر ردیف اصلاحی')
await rejects('مبلغ اصلاحی اعشاری', () => cardTransferService.adjust({ id: req.id, amount: 1000.4, reason: 'تست', userId }), 'ریال')
await rejects('مبلغ اصلاحی 1e20', () => cardTransferService.adjust({ id: req.id, amount: -1e20, reason: 'تست', userId }), 'ریال')
await rejects('مبلغ اصلاحی متنی', () => cardTransferService.adjust({ id: req.id, amount: '1000', reason: 'تست', userId }), 'ریال')
eq('ردیف اصلاحی', seed.count('CardTransferRequest', `kind = 'ADJUSTMENT'`), 0)

console.log('\n۴) مسیر معتبر حفظ می‌شود')
// نشست ۱۴۴ — adjust حالا گیت سمت سرور دارد (بند ۴-۳۹)؛ مسیر معتبر با رمز مدیر.
// ممیزی A115-01 (AUDIT-D47) — adjust فقط روی درخواست پرداخت‌شده؛ پس اول یک pay معتبر با رمز.
await safe('pay معتبر پیش از adjust', () => cardTransferService.pay({ id: req.id, userId, managerPassword: PW }))
await safe('adjust معتبر ‎-۱۰۰۰', () => cardTransferService.adjust({ id: req.id, amount: -1000, reason: 'اصلاح تست', userId, managerPassword: PW }))
eq('ردیف اصلاحی معتبر', seed.count('CardTransferRequest', `kind = 'ADJUSTMENT'`), 1)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
