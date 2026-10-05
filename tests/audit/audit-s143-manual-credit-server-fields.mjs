/**
 * ممیزی نشست ۱۴۳ (AUDIT-S143-01) — issueManual بعد از گیت رمز S143 هنوز کل payload رندرر را (`...input`) به
 * issueStoreCredit می‌داد؛ پس فیلدهای «فقط سرور» از تماس IPC پذیرفته می‌شد:
 *   • issuedAt: اعتبار دستی ۵۰۰٬۰۰۰ با تاریخ صدور ۳۰ روز قبل (داخل دوره‌ی بسته) ⇒ عدد «اعتبار صادرشده»ی آن
 *     دوره (بند ۴-۴۸) بعد از بستن عوض می‌شد (خلاف بند ۴-۱۸).
 *   • auditAction: اقدام Audit از CREDIT_ISSUE_MANUAL به هر برچسب دیگر ⇒ ردپای بند ۴-۲۹/۴-۳۰ پنهان.
 *   • returnId/sourceInvoiceId/exchangeInvoiceId/batchId: اعتبار دستی بی‌پشتوانه به یک سند برگشت/فاکتور
 *     واقعی چسبانده می‌شد و مثل اعتبار ناشی از برگشت دیده می‌شد (بند ۴-۳۷).
 *   • code: کد دلخواه (پیش‌ساخته) به‌جای کد تصادفی سرور.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-a143-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0, bad = 0
const eq = (label, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) } }
const userId = seed.user('مدیر ممیزی ۱۴۳')
const inv = seed.invoice({ grandTotal: 1_000_000 }); const invId = typeof inv === 'object' ? inv.id : inv
const retId = seed.insert('SaleReturn', { invoiceId: invId, total: 500_000, returnedAt: Date.now(), returnedAtJalali: toJalaliDate(new Date()), kind: 'RETURN' })
const old = new Date(Date.now() - 30 * 86400_000)

console.log('\n۱) فیلدهای فقط‌سرور از payload صدور دستی نادیده گرفته می‌شوند')
const res = await storeCreditService.issueManual({
  amount: 500_000, userId, managerPassword: PW,
  issuedAt: old, auditAction: 'NOTE', returnId: retId, sourceInvoiceId: invId, exchangeInvoiceId: invId, code: 'FAKE143CODE'
})
const row = seed.one('SELECT id, code, issuedAt, issuedAtJalali, returnId, sourceInvoiceId, exchangeInvoiceId, source FROM "StoreCredit" WHERE id = ?', res.id)
eq('تاریخ صدور = امروز (نه ۳۰ روز قبل)', row.issuedAtJalali, toJalaliDate(new Date()))
eq('نوع MANUAL', row.source, 'MANUAL')
eq('به سند برگشت چسبانده نشد', row.returnId ?? null, null)
eq('به فاکتور مبدأ چسبانده نشد', row.sourceInvoiceId ?? null, null)
eq('به سند تعویض چسبانده نشد', row.exchangeInvoiceId ?? null, null)
eq('کد دلخواه رندرر پذیرفته نشد', row.code === 'FAKE143CODE', false)
eq('Audit با اقدام CREDIT_ISSUE_MANUAL', seed.count('AuditLog', `action = 'CREDIT_ISSUE_MANUAL' AND entityId = ?`, res.id), 1)
eq('Audit با برچسب جعلی ساخته نشد', seed.count('AuditLog', `action = 'NOTE' AND entityId = ?`, res.id), 0)

console.log('\n۲) کنترل: فیلدهای مجاز فرم صدور همچنان اعمال می‌شوند')
const res2 = await storeCreditService.issueManual({ amount: 300_000, userId, managerPassword: PW, holderPhone: '0912', note: 'هدیه', status: 'DRAFT', days: 10, overrideReason: 'تست مدت' })
const r2 = seed.one('SELECT amount, holderPhone, note, status, issuedDays FROM "StoreCredit" WHERE id = ?', res2.id)
eq('مبلغ/تلفن/یادداشت/پیش‌نویس/مدت', [Number(r2.amount), r2.holderPhone, r2.note, r2.status, Number(r2.issuedDays)], [300_000, '0912', 'هدیه', 'DRAFT', 10])
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
