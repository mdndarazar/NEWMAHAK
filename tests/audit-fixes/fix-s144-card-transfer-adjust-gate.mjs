/**
 * ===========================================================================
 * نشست ۱۴۴ · خوشه E/D · بند ۴-۳۹ و ۴-۳۰ — گیت سمت سرور «ثبت رویداد اصلاحی»
 * کارت‌به‌کارت + actor غیرقابل‌جعل در IPCهای کارت‌به‌کارت و شمارش انبار
 *
 * قبل از رفع:
 *   ۱) CardTransferService.adjust هیچ assertPanelPassword نداشت (pay و cancel
 *      داشتند)، در حالی که یک ردیف PAID با مبلغ مثبت/منفی می‌سازد و روی
 *      «جریان‌های مالی خارج از فروش» اثر دارد ⇒ تماس مستقیم IPC بدون رمز،
 *      پول اصلاحی ثبت می‌کرد.
 *   ۲) IPC.cardTransferPay/Cancel/Adjust و IPC.stockCountSubmit با withUser
 *      صدا زده می‌شدند ⇒ userId/userName ارسالی renderer در Audit می‌نشست.
 *   ۳) CardTransferPanel.tsx رمز را در payload adjust نمی‌فرستاد.
 * انتظار: بدون رمز/رمز غلط ⇒ رد فارسی و صفر ردیف ADJUSTMENT و بدون تغییر
 * وضعیت درخواست مرجع؛ با رمز درست ⇒ ثبت + Audit با scope تأیید.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s144-card-transfer-adjust-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s144-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cardTransferService, createCardTransferRequest } = await import('../../src/main/services/CardTransferService.ts')
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
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون تأیید پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 90)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}
const adjRows = () => seed.count('CardTransferRequest', `kind = 'ADJUSTMENT'`)
const adjAudits = () => seed.count('AuditLog', `action = 'CARD_TRANSFER_ADJUST'`)

const userId = seed.user('مدیر تست نشست ۱۴۴')
const inv = seed.invoice({ grandTotal: 1000000 })
const invId = typeof inv === 'object' ? inv.id : inv
const retId = seed.insert('SaleReturn', { invoiceId: invId, total: 500000, returnedAt: Date.now(), returnedAtJalali: toJalaliDate(new Date()), kind: 'RETURN' })
const req = await safe('درخواست معتبر ۵۰۰٬۰۰۰', () => createCardTransferRequest(db, { returnId: retId, amount: 500000, userId }))
// ممیزی A115-01 (AUDIT-D47) — adjust فقط روی درخواست پرداخت‌شده؛ پس fixture پیش از adjust یک pay معتبر با رمز می‌زند.
await safe('pay معتبر پیش از adjust', () => cardTransferService.pay({ id: req.id, userId, managerPassword: PW }))

console.log('\n۱) adjust بدون رمز / با رمز غلط ⇒ رد، صفر ردیف اصلاحی، وضعیت مرجع دست‌نخورده')
await rejects('بدون رمز', () => cardTransferService.adjust({ id: req.id, amount: 200000, reason: 'تست بی‌رمز', userId }), 'تأیید مدیر')
await rejects('رمز خالی', () => cardTransferService.adjust({ id: req.id, amount: -200000, reason: 'تست', userId, managerPassword: '   ' }), 'تأیید مدیر')
await rejects('رمز غلط', () => cardTransferService.adjust({ id: req.id, amount: 200000, reason: 'تست', userId, managerPassword: 'wrong-0000' }))
eq('ردیف ADJUSTMENT پس از تلاش‌های بی‌مجوز', adjRows(), 0)
eq('Audit ADJUST پس از تلاش‌های بی‌مجوز', adjAudits(), 0)
eq('وضعیت درخواست مرجع', seed.one('SELECT status FROM "CardTransferRequest" WHERE id = ?', req.id)?.status, 'PAID')

console.log('\n۲) validation ورودی پیش از رمز هم برقرار می‌ماند (رفتار S143)')
await rejects('مبلغ اعشاری با رمز درست', () => cardTransferService.adjust({ id: req.id, amount: 1000.4, reason: 'تست', userId, managerPassword: PW }), 'ریال')
eq('ردیف ADJUSTMENT', adjRows(), 0)

console.log('\n۳) با رمز مدیر ⇒ ثبت + Audit با actor و scope تأیید')
const created = await safe('adjust معتبر با رمز', () => cardTransferService.adjust({ id: req.id, amount: -1000, reason: 'اصلاح تست', userId, managerPassword: PW }))
eq('ردیف ADJUSTMENT معتبر', adjRows(), 1)
eq('مبلغ ردیف اصلاحی', Number(created?.amount), -1000)
const audit = seed.one(`SELECT userId, after FROM "AuditLog" WHERE action = 'CARD_TRANSFER_ADJUST' ORDER BY id DESC LIMIT 1`)
eq('actor در Audit', Number(audit?.userId), userId)
let after = {}
try { after = JSON.parse(audit?.after ?? '{}') } catch {}
eq('scope تأیید در Audit', after.approvedWith, 'MANAGER')

console.log('\n۴) سیم‌کشی IPC و UI (ساختاری؛ Electron واقعی اجرا نمی‌شود)')
const ipc = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
for (const ch of ['cardTransferPay', 'cardTransferCancel', 'cardTransferAdjust']) {
  truthy(`IPC.${ch} با withSessionActor (actor از نشست main)`, new RegExp(`handle\\(IPC\\.${ch},[^\\n]*(?:withSessionActor|cardTransferActor)\\(`).test(ipc))
  truthy(`IPC.${ch} دیگر withUser نیست`, !new RegExp(`handle\\(IPC\\.${ch},[^\\n]*withUser\\(`).test(ipc))
}
truthy('helper cardTransferActor خودش withSessionActor را صدا می‌زند', /async function cardTransferActor[\s\S]{0,300}await withSessionActor\(/.test(ipc))
truthy('IPC کارت‌به‌کارت برچسب‌های قابل‌جعل (userName/shiftId/shiftName) renderer را خنثی می‌کند', /function cardTransferActor[\s\S]{0,700}userName: null[\s\S]{0,120}shiftId: null[\s\S]{0,120}shiftName: null/.test(ipc))
truthy('IPC.stockCountSubmit با withOptionalSessionActor', /handle\(IPC\.stockCountSubmit,[^\n]*withOptionalSessionActor\(/.test(ipc))
truthy('IPC.stockCountSubmit دیگر withUser نیست', !/handle\(IPC\.stockCountSubmit,[^\n]*withUser\(/.test(ipc))
const svc = readFileSync(resolve('src/main/services/CardTransferService.ts'), 'utf8')
truthy('adjust در سرویس assertPanelPassword(PANEL_KEYS.cardTransfers) دارد', /async adjust\([\s\S]{0,2500}assertPanelPassword\(\s*PANEL_KEYS\.cardTransfers/.test(svc))
const ui = readFileSync(resolve('src/renderer/src/components/CardTransferPanel.tsx'), 'utf8')
truthy('CardTransferPanel رمز adjust را در payload می‌فرستد', /CH\.cardTransferAdjust,[\s\S]{0,400}managerPassword: adjPassword/.test(ui))
truthy('CardTransferPanel ورودی رمز فرم اصلاحی دارد', /value=\{adjPassword\}/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
