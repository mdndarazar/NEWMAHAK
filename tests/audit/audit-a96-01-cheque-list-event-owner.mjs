/**
 * ممیزی A96-01 — نشست ۹۶ فیلترهای نوار گزارش را به تب چک رساند ولی مالک (شیفت/کارمند) را
 * همچنان روی فاکتور مادر گذاشت (reportInvoiceRelationWhere) و shiftNumber را نادیده گرفت.
 * بلوک چک سرجمع (accountingReport) و دفتر رویداد مالک را روی خود Payment می‌گذارند
 * (createdShiftId/createdByUserId برای ثبت، clearedShiftId/clearedByUserId برای پاس).
 * سناریو: فاکتور شیفت صبح (فروشنده الف)، چک ۹۰۰٬۰۰۰ را ب در شیفت شب ثبت کرده و ج در
 * شیفت شب دیگر پاس کرده.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9601-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now()
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده صبح'), B = seed.user('فروشنده شب'), C = seed.user('صندوق‌دار پاس')
const S1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, closedAt: now - 5 * 3600_000, userId: A })
const S2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 5 * 3600_000, closedAt: now - 2 * 3600_000, userId: B })
const S3 = seed.insert('Shift', { name: 'شب', number: 3, dayJalali: today, openedAt: now - 2 * 3600_000, userId: C })
const inv = seed.insert('SaleInvoice', { grandTotal: 900_000, paidTotal: 900_000, status: 'FINAL', receiptNo: 9601, shiftId: S1, userId: A, issuedAt: now - 7 * 3600_000, issuedAtJalali: today })
seed.insert('Payment', {
  invoiceId: inv, amount: 900_000, kind: 'CHEQUE', chequeNo: 'CH-96', chequeStatus: 'CLEARED', destination: 'MANAGER_ACCOUNT',
  paidAt: now - 4 * 3600_000, paidAtJalali: today, dueDate: now - 3 * 3600_000,
  createdByUserId: B, createdShiftId: S2, clearedAt: now - 3600_000, clearedByUserId: C, clearedShiftId: S3
})
const base = { fromJalali: today, toJalali: today }
const n = async (f) => { const r = await salesService.chequeList({ ...base, ...f }); return (Array.isArray(r) ? r : r?.rows ?? []).length }
eq('ثبت: فیلتر شیفت شب (ثبت‌کننده) ⇒ ۱ چک', await n({ shiftId: S2, dateMode: 'paid' }), 1)
eq('ثبت: فیلتر شیفت صبح (فقط فاکتور) ⇒ ۰', await n({ shiftId: S1, dateMode: 'paid' }), 0)
eq('ثبت: فیلتر کارمند ب ⇒ ۱', await n({ userId: B, dateMode: 'paid' }), 1)
eq('ثبت: فیلتر کارمند الف (فروشنده‌ی فاکتور) ⇒ ۰', await n({ userId: A, dateMode: 'paid' }), 0)
eq('ثبت: شماره‌ی نشست ۱ ⇒ ۰ (قبلاً نادیده گرفته می‌شد)', await n({ shiftNumber: 1, dateMode: 'paid' }), 0)
eq('ثبت: شماره‌ی نشست ۲ ⇒ ۱', await n({ shiftNumber: 2, dateMode: 'paid' }), 1)
eq('پاس: فیلتر شیفت پاس (S3) ⇒ ۱', await n({ shiftId: S3, dateMode: 'cleared' }), 1)
eq('پاس: فیلتر شیفت ثبت (S2) ⇒ ۰', await n({ shiftId: S2, dateMode: 'cleared' }), 0)
eq('پاس: فیلتر کارمند ج ⇒ ۱', await n({ userId: C, dateMode: 'cleared' }), 1)
eq('هویت فاکتور هنوز اعمال می‌شود: شماره فیش دیگر ⇒ ۰', await n({ receiptNo: 1, dateMode: 'paid' }), 0)
// هم‌سنجی با بلوک چک سرجمع (همان فیلتر ⇒ همان عدد)
for (const [label, f, key] of [['شیفت شب/ثبت', { shiftId: S2 }, 'registered'], ['شیفت صبح/ثبت', { shiftId: S1 }, 'registered'], ['شیفت پاس/پاس', { shiftId: S3 }, 'cleared']]) {
  let acc = null
  try { const rep = await salesService.reportRows({ ...base, ...f }); acc = rep?.accounting?.cheques?.[key] ?? null } catch (e) { acc = `ERR ${String(e?.message).slice(0, 50)}` }
  const listSum = (await salesService.chequeList({ ...base, ...f, dateMode: key === 'cleared' ? 'cleared' : 'paid' }))
  const sum = (Array.isArray(listSum) ? listSum : listSum.rows).reduce((s, r) => s + Number(r.amount ?? 0), 0)
  if (acc === null) console.log(`  ⚠ بلوک سرجمع در هارنس برنگشت (${label})`)
  else eq(`هم‌سنجی ${label}: جمع تب چک = بلوک چک سرجمع`, sum, acc)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
