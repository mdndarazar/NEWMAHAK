/**
 * ===========================================================================
 * نشست ۱۶۰ · خوشه E/K · Y7 · حذف اعتبار خرید = void/آرشیو، هرگز حذف فیزیکی (بند ۴-۲۲)
 *
 * قبل از رفع: StoreCreditService.deleteCredit اعتبارِ بی‌مصرف را با tx.storeCredit.delete
 * واقعاً از دیتابیس پاک می‌کرد (کد و مبلغ و منبع صدور فقط در متن Audit می‌ماند)؛ و شناسه‌ی
 * نامعتبر (مثلاً ۱٫۵ یا رشته) بعد از رمز مدیر سنجیده می‌شد.
 * بعد از رفع: هر دو حالت soft-delete (deletedAt + voidedReason)؛ رکورد، کد و مبلغ به‌عنوان
 * مدرک می‌مانند؛ اعتبار دیگر قابل مصرف/تغییر نیست؛ Audit همان CREDIT_DELETE (بی‌مصرف) و
 * CREDIT_ARCHIVE (مصرف‌شده) با actor؛ شناسه پیش از رمز مدیر سنجیده می‌شود؛ حذف دوباره رد می‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y7-credit-delete-void.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y7-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const svc = await import('../../src/main/services/StoreCreditService.ts')
const { storeCreditService } = svc
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => (cond ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle, notNeedle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون رد پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle)) && (!notNeedle || !m.includes(notNeedle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 160)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 200)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}
const row = (id) => seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', id)
const audits = (action, id) => seed.one(`SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ? AND entity = 'StoreCredit' AND entityId = ?`, action, id).n

const userId = seed.user('مدیر تست Y7')
const PW = DEFAULT_MANAGER_PASSWORD

const unused = await safe('صدور اعتبار بی‌مصرف', () => storeCreditService.issueManual({ amount: 700_000, userId, managerPassword: PW }))
const unusedId = unused?.id ?? seed.one('SELECT id FROM "StoreCredit" ORDER BY id DESC LIMIT 1').id
const before = row(unusedId)

console.log('\n۱) شناسه‌ی نامعتبر پیش از رمز مدیر رد می‌شود')
await rejects('شناسه‌ی ۱٫۵ بدون رمز ⇒ پیام شناسه (نه رمز)', () => svc.deleteCredit({ id: 1.5, reason: 'x', userId }), 'شناسه', 'رمز مدیر')
await rejects('شناسه‌ی رشته‌ای بدون رمز ⇒ پیام شناسه', () => svc.deleteCredit({ id: '1', reason: 'x', userId }), 'شناسه', 'رمز مدیر')
await rejects('شناسه‌ی درست بدون رمز ⇒ رمز مدیر', () => svc.deleteCredit({ id: unusedId, reason: 'x', userId }), 'رمز')
truthy('پس از تلاش‌های ناموفق اعتبار دست‌نخورده است', row(unusedId) && row(unusedId).deletedAt == null)

console.log('\n۲) اعتبار بی‌مصرف ⇒ void/آرشیو، نه حذف فیزیکی')
const del = await safe('حذف اعتبار بی‌مصرف با رمز و دلیل', () => svc.deleteCredit({ id: unusedId, reason: 'اشتباه صادر شد', managerPassword: PW, userId }))
eq('mode پاسخ (سازگار با قبل)', del?.mode, 'DELETED')
const after = row(unusedId)
truthy('رکورد در دیتابیس ماند (مدرک)', after != null)
truthy('deletedAt مهر خورد', after?.deletedAt != null)
eq('دلیل روی رکورد ماند', after?.voidedReason, 'اشتباه صادر شد')
eq('کد تغییر نکرد', after?.code, before?.code)
eq('مبلغ تغییر نکرد', Number(after?.amount), Number(before?.amount))
eq('Audit CREDIT_DELETE یک‌بار', audits('CREDIT_DELETE', unusedId), 1)
const aud = seed.one(`SELECT userId, note FROM "AuditLog" WHERE action = 'CREDIT_DELETE' AND entityId = ? ORDER BY id DESC LIMIT 1`, unusedId)
eq('actor Audit', aud?.userId, userId)
truthy('متن Audit دیگر «حذف واقعی» نمی‌گوید', aud && !String(aud.note).includes('حذف واقعی'))

console.log('\n۳) اعتبارِ حذف‌شده قابل مصرف/تغییر/حذف دوباره نیست')
await rejects('مصرف با کدِ اعتبار حذف‌شده ⇒ رد (پیدا نشد)', () => svc.findRedeemable(db, before.code), 'پیدا نشد')
const list = await storeCreditService.list({})
const items = list?.rows ?? list?.items ?? list ?? []
truthy('در فهرست پیش‌فرض دیده نمی‌شود', Array.isArray(items) && !items.some((r) => r.id === unusedId))
await rejects('حذف دوباره ⇒ رد', () => svc.deleteCredit({ id: unusedId, reason: 'دوباره', managerPassword: PW, userId }), 'آرشیو')
await rejects('ابطال روی اعتبار حذف‌شده ⇒ رد', () => storeCreditService.void({ id: unusedId, reason: 'تلاش', managerPassword: PW, userId }), 'آرشیو')
eq('Audit CREDIT_DELETE همچنان یک‌بار', audits('CREDIT_DELETE', unusedId), 1)

console.log('\n۴) ساختار کد: هیچ storeCredit.delete در deleteCredit نمانده')
const src = readFileSync(resolve('src/main/services/StoreCreditService.ts'), 'utf8')
const body = src.slice(src.indexOf('export async function deleteCredit'), src.indexOf('// ۷) تولید گروهی'))
truthy('tx.storeCredit.delete حذف شد', !/storeCredit\.delete\s*\(/.test(body))
// به‌روزرسانی نشست ۱۸۳ — این گیت‌ها حالا علاوه بر رمز مدیر، رمز دوم و رمز سومِ
// همان پنل را هم می‌پذیرند (خواسته‌ی مالک: دسترسی فرد مورد اعتماد در نبود مدیر).
// نامِ تابع از `assertManagerPassword` به `assertPanelPassword` عوض شد؛ *ترتیب* و
// *رفتار* دقیقاً همان است، پس فقط قرارداد متنی به‌روز می‌شود.
truthy(
  'assertCreditId پیش از گیت رمز',
  body.indexOf('assertCreditId') > -1 && body.indexOf('assertCreditId') < body.indexOf('assertPanelPassword')
)
truthy('و گیت رمز، رمز دوم/سوم پنل ابطال را می‌پذیرد', /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid/.test(body))
const ui = readFileSync(resolve('src/shared/creditUi.ts'), 'utf8')
truthy('راهنمای UI دیگر وعده‌ی «واقعاً حذف» نمی‌دهد', !ui.includes('واقعاً حذف'))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
