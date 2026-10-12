/**
 * ممیزی نشست ۱۴۴ (AUDIT-S144-01) — رویداد اصلاحی کارت‌به‌کارت بعد از گیت رمز S144 هنوز کران مالی نداشت.
 *   (الف) اصلاح منفی بیش از خالص پرداخت‌شده: پرداخت ۵۰۰٬۰۰۰ و اصلاح −۶۰۰٬۰۰۰ ⇒ خالص −۱۰۰٬۰۰۰ (یعنی مشتری بیش از
 *         بازپرداختش به ما پس داده) پذیرفته می‌شد؛ خلاف قاعده‌ی کلی بند ۵ (هرگز منفی/بیش از مانده).
 *   (ب) اصلاح مثبت (پرداخت بیشتر) روی سند برگشتِ باطل‌شده پذیرفته می‌شد، در حالی که pay همان‌جا رد می‌کند
 *       (نشست ۶۴ · بند ۴-۲۲: به سند باطل‌شده بازپرداختی تعلق ندارد). اصلاح منفی (پس‌گرفتن پول) مجاز می‌ماند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-a144-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cardTransferService, createCardTransferRequest } = await import('../../src/main/services/CardTransferService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0, bad = 0
const eq = (label, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) } }
const attempt = async (fn) => { try { return { ok: true, v: await fn() } } catch (e) { return { ok: false, m: String(e?.message ?? e) } } }
const userId = seed.user('مدیر ممیزی ۱۴۴')
const mkReq = async (amount, paidAmount = amount) => {
  const inv = seed.invoice({ grandTotal: 1_000_000 }); const invId = typeof inv === 'object' ? inv.id : inv
  const retId = seed.insert('SaleReturn', { invoiceId: invId, total: amount, returnedAt: Date.now(), returnedAtJalali: toJalaliDate(new Date()), kind: 'RETURN' })
  const req = await createCardTransferRequest(db, { returnId: retId, amount, userId })
  await cardTransferService.pay({ id: req.id, userId, paidAmount, managerPassword: PW })
  return { req, retId }
}
const adjCount = (id) => seed.count('CardTransferRequest', `kind = 'ADJUSTMENT' AND adjustsRequestId = ?`, id)

console.log('\n۱) اصلاح منفی بیش از خالص پرداخت‌شده')
{
  const { req } = await mkReq(500_000)
  const r = await attempt(() => cardTransferService.adjust({ id: req.id, amount: -600_000, reason: 'تست', userId, managerPassword: PW }))
  eq('−۶۰۰٬۰۰۰ روی پرداخت ۵۰۰٬۰۰۰ رد شد', r.ok, false)
  eq('پیام فارسی با خالص پرداخت‌شده', /خالص پرداخت‌شده[^]*۵۰۰[٬,]?۰۰۰/.test(r.m ?? ''), true)
  eq('هیچ ردیف اصلاحی ساخته نشد', adjCount(req.id), 0)
  eq('وضعیت مرجع PAID ماند', seed.one('SELECT status FROM "CardTransferRequest" WHERE id = ?', req.id)?.status, 'PAID')
  const r2 = await attempt(() => cardTransferService.adjust({ id: req.id, amount: -200_000, reason: 'پس‌گرفتن بخشی', userId, managerPassword: PW }))
  eq('کنترل: −۲۰۰٬۰۰۰ پذیرفته (خالص ۳۰۰٬۰۰۰)', r2.ok, true)
  const r3 = await attempt(() => cardTransferService.adjust({ id: req.id, amount: -300_001, reason: 'تست', userId, managerPassword: PW }))
  eq('−۳۰۰٬۰۰۱ بعد از اصلاح قبلی رد (اصلاح‌های قبلی هم شمرده می‌شوند)', r3.ok, false)
  const r4 = await attempt(() => cardTransferService.adjust({ id: req.id, amount: -300_000, reason: 'پس‌گرفتن کامل', userId, managerPassword: PW }))
  eq('مرز: −۳۰۰٬۰۰۰ ⇒ خالص دقیقاً ۰ پذیرفته', r4.ok, true)
  eq('دو ردیف اصلاحی', adjCount(req.id), 2)
}

console.log('\n۲) اصلاح مثبت روی سند برگشت باطل‌شده')
{
  // پرداخت اولیه کمتر از سقف درخواست است؛ بنابراین +۱۰۰٬۰۰۰ از کران مبلغ
  // عبور نمی‌کند و واقعاً به گیت «سند باطل» می‌رسد.
  const { req, retId } = await mkReq(400_000, 300_000)
  db.$harness.db.prepare('UPDATE "SaleReturn" SET voidedAt = ? WHERE id = ?').run(Date.now(), retId)
  const r = await attempt(() => cardTransferService.adjust({ id: req.id, amount: 100_000, reason: 'پرداخت بیشتر', userId, managerPassword: PW }))
  eq('+۱۰۰٬۰۰۰ روی برگشت باطل‌شده رد شد', r.ok, false)
  eq('پیام فارسی «باطل شده»', /باطل شده/.test(r.m ?? ''), true)
  eq('هیچ ردیف اصلاحی', adjCount(req.id), 0)
  const r2 = await attempt(() => cardTransferService.adjust({ id: req.id, amount: -300_000, reason: 'مشتری پول را پس داد', userId, managerPassword: PW }))
  eq('کنترل: پس‌گرفتن پرداخت واقعی −۳۰۰٬۰۰۰ روی سند باطل مجاز', r2.ok, true)
}

console.log('\n۳) کنترل: اصلاح مثبت روی سند سالم')
{
  // اصلاح مثبت تا سقف مبلغ درخواست مجاز است؛ پس پرداخت ناقص ۲۵۰٬۰۰۰ با
  // +۵۰٬۰۰۰ دقیقاً در مرز ۳۰۰٬۰۰۰ می‌نشیند.
  const { req } = await mkReq(300_000, 250_000)
  const r = await attempt(() => cardTransferService.adjust({ id: req.id, amount: 50_000, reason: 'تکمیل پرداخت', userId, managerPassword: PW }))
  eq('+۵۰٬۰۰۰ تا سقف درخواست پذیرفته', r.ok, true)
}
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
