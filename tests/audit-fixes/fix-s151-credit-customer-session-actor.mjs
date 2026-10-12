// نشست ۱۵۲: تست قبل/بعد S151-a. قبل (src zip ۱۵۱) ⇒ TESTLOG-s152a-before.txt؛ بعد ⇒ TESTLOG-s152a-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۲ · خوشه E/K · S151-a · بند ۴-۳۰ («هر actor و هر گیتِ بازشده در Audit»)
 * و بند ۵ («audit شامل actor واقعی»، «هر گیت در main»)
 *
 * قبل از رفع:
 *   ۱) همه‌ی IPCهای نوشتنی اعتبار خرید (void/suspend/reactivate/expiry/amount/uses/
 *      holder/restriction/delete، markPrinted، reminderQueue، lookup/preview، چاپ و PDF)
 *      با withUser پیچیده بودند ⇒ userId فرستاده‌شده از رندرر دست‌نخورده در AuditLog می‌نشست
 *      (جعل actor).
 *   ۲) customerCreate/Update/Delete payload خام می‌گرفتند؛ createCustomer در هیچ‌کدام از
 *      دو Audit خود userId نداشت.
 * انتظار بعد از رفع (S151-D2): actor همیشه از نشست باز main؛ بدون نشست باز ⇒ null، نه جعلی.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s151-credit-customer-session-actor.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s151a-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// مسیر IPC فقط درخواستِ پنجرهٔ زنده را می‌پذیرد. sender معتبرِ ساختگی اجازه
// می‌دهد آزمون جعل actor، رفتار مالکیت نشست را بسنجد نه مرز Electron را.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15101, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 160)}`) }
  return r?.data
}
const ipcAny = async (ch, payload) => ipc(ch, payload)

const lastAudit = (action, entity) =>
  entity
    ? seed.one('SELECT id, userId FROM "AuditLog" WHERE action = ? AND entity = ? ORDER BY id DESC LIMIT 1', action, entity)
    : seed.one('SELECT id, userId FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', action)
const uid = (row) => (row == null ? 'بدون ردیف' : row.userId == null ? null : Number(row.userId))

const actor = seed.user('صندوق‌دار نشست باز ۱۵۲')
const forged = seed.user('کارمند جعلی ۱۵۲')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor })
const today = jalaliToday()
const mk = (code, extra = {}) =>
  seed.insert('StoreCredit', { code, amount: 1_000_000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now(), issuedAtJalali: today, ...extra })
const idA = mk('S152A0001')
const idB = mk('S152B0002')
const idC = mk('S152C0003')
const idD = mk('S152D0004', { usedAmount: 200_000, usedCount: 1, status: 'PARTIALLY_USED' })
const idE = mk('S152E0005')
const M = { managerPassword: PW, userId: forged }
// کانال یادآوری و چاپ اعتبار اکنون در main به نشست همان پنجره متکی‌اند؛ ورود
// مدیرِ واقعی، بدون اجازه‌دادن به userId جعلی، زمینه‌ی آزمون actor را فراهم می‌کند.
const verified = await ipc(IPC.managerVerify, { password: PW })
eq('نشست مدیر برای پنجرهٔ آزمون باز شد', verified?.ok, true)

console.log('\n۱) کانال‌های مدیریتی اعتبار با userId جعلی ⇒ actor نشست در Audit')
const cases = [
  ['creditSuspend', IPC.creditSuspend, { id: idA, reason: 'تست تعلیق ۱۵۲' }, 'CREDIT_SUSPEND'],
  ['creditReactivate', IPC.creditReactivate, { id: idA, reason: 'تست فعال‌سازی ۱۵۲' }, 'CREDIT_REACTIVATE'],
  ['creditExpiryChange', IPC.creditExpiryChange, { id: idA, expiresAtJalali: '', reason: 'تست انقضا ۱۵۲' }, 'CREDIT_EXPIRY_CHANGE'],
  ['creditAmountChange', IPC.creditAmountChange, { id: idA, amount: 900_000, reason: 'تست مبلغ ۱۵۲' }, 'CREDIT_AMOUNT_CHANGE'],
  ['creditUsesChange', IPC.creditUsesChange, { id: idA, maxUses: 3, multiUse: true, reason: 'تست دفعات ۱۵۲' }, 'CREDIT_USES_CHANGE'],
  ['creditHolderChange', IPC.creditHolderChange, { id: idA, customerName: 'دارنده ۱۵۲', reason: 'تست دارنده ۱۵۲' }, 'CREDIT_HOLDER_CHANGE'],
  ['creditRestrictionChange', IPC.creditRestrictionChange, { id: idA, restrictScope: 'ALL', minPurchase: 100_000, reason: 'تست محدودیت ۱۵۲' }, 'CREDIT_RESTRICTION_CHANGE'],
  ['creditVoid', IPC.creditVoid, { id: idB, reason: 'تست ابطال ۱۵۲' }, 'CREDIT_VOID'],
  ['creditDelete (بی‌مصرف)', IPC.creditDelete, { id: idC, reason: 'تست حذف ۱۵۲' }, 'CREDIT_DELETE'],
  ['creditDelete (مصرف‌شده ⇒ آرشیو)', IPC.creditDelete, { id: idD, reason: 'تست آرشیو ۱۵۲' }, 'CREDIT_ARCHIVE']
]
for (const [label, ch, payload, action] of cases) {
  await ipcOk(`IPC.${label} با userId جعلی`, ch, { ...payload, ...M })
  eq(`actor در Audit ${action}`, uid(lastAudit(action)), actor)
}

console.log('\n۲) چاپ، یادآوری و بررسی کد با userId جعلی')
await ipcOk('IPC.creditMarkPrinted با userId جعلی', IPC.creditMarkPrinted, { id: idE, userId: forged })
eq('actor در Audit CREDIT_PRINT', uid(lastAudit('CREDIT_PRINT')), actor)
await ipcOk('IPC.creditReminderQueue با userId جعلی', IPC.creditReminderQueue, { id: idE, userId: forged, force: true })
eq('actor در Audit CREDIT_REMINDER_QUEUE', uid(lastAudit('CREDIT_REMINDER_QUEUE')), actor)
await ipcAny(IPC.storeCreditLookup, { code: 'S152-WRONG-01', userId: forged })
eq('actor در Audit CREDIT_REDEEM_BLOCKED (lookup کد غلط)', uid(lastAudit('CREDIT_REDEEM_BLOCKED')), actor)
const beforePreview = lastAudit('CREDIT_REDEEM_BLOCKED')?.id
await ipcAny(IPC.creditPreview, { code: 'S152-WRONG-02', userId: forged })
const pv = lastAudit('CREDIT_REDEEM_BLOCKED')
truthy('creditPreview کد غلط ردیف CREDIT_REDEEM_BLOCKED تازه نوشت', pv && pv.id !== beforePreview)
eq('actor در Audit CREDIT_REDEEM_BLOCKED (preview کد غلط)', uid(pv), actor)
const printBefore = lastAudit('CREDIT_REPRINT')?.id ?? lastAudit('CREDIT_PRINT')?.id
const pr = await ipcAny(IPC.printCredit, { id: idE, userId: forged, silent: true })
if (pr?.ok) {
  const row = seed.one('SELECT id, userId FROM "AuditLog" WHERE action IN (\'CREDIT_PRINT\',\'CREDIT_REPRINT\') ORDER BY id DESC LIMIT 1')
  truthy('printCredit ردیف چاپ تازه نوشت', row && row.id !== printBefore)
  eq('actor در Audit چاپ printCredit', uid(row), actor)
} else console.log(`  · printCredit در هارنس اجرا نشد (${String(pr?.error).slice(0, 80)}) ⇒ فقط چک ساختاری پایین`)

console.log('\n۳) مشتری: ثبت تازه، ارتقای هم‌شماره، ویرایش، حذف با userId جعلی')
const c1 = await ipcOk('IPC.customerCreate (ثبت تازه) با userId جعلی', IPC.customerCreate, { name: 'مشتری تازه ۱۵۲', phone: '09120001521', userId: forged })
eq('actor در Audit CUSTOMER_CREATE (ثبت تازه)', uid(lastAudit('CUSTOMER_CREATE')), actor)
const cntCreate = seed.count('AuditLog', 'action = ?', 'CUSTOMER_CREATE')
await ipcOk('IPC.customerCreate (ارتقای هم‌شماره به عمده) با userId جعلی', IPC.customerCreate, { name: 'مشتری تازه ۱۵۲', phone: '09120001521', isWholesale: true, userId: forged })
eq('Audit ارتقا ثبت شد', seed.count('AuditLog', 'action = ?', 'CUSTOMER_CREATE'), cntCreate + 1)
eq('actor در Audit CUSTOMER_CREATE (ارتقای هم‌شماره)', uid(lastAudit('CUSTOMER_CREATE')), actor)
await ipcOk('IPC.customerUpdate با userId جعلی', IPC.customerUpdate, { id: Number(c1?.id), name: 'مشتری ویرایش‌شده ۱۵۲', userId: forged })
eq('actor در Audit SETTINGS_UPDATE (Customer)', uid(lastAudit('SETTINGS_UPDATE', 'Customer')), actor)
await ipcOk('IPC.customerDelete با userId جعلی', IPC.customerDelete, { id: Number(c1?.id), userId: forged })
eq('actor در Audit DELETE (Customer)', uid(lastAudit('DELETE', 'Customer')), actor)

console.log('\n۴) بدون نشست باز ⇒ userId = null، نه جعلی')
seed.rows('UPDATE "Shift" SET closedAt = ? WHERE id = ? RETURNING id', Date.now(), shiftId)
await ipcOk('IPC.creditSuspend بدون نشست با userId جعلی', IPC.creditSuspend, { id: idE, reason: 'تست بی‌نشست ۱۵۲', ...M })
eq('userId در Audit CREDIT_SUSPEND بدون نشست', uid(lastAudit('CREDIT_SUSPEND')), null)
await ipcOk('IPC.creditMarkPrinted بدون نشست با userId جعلی', IPC.creditMarkPrinted, { id: idE, userId: forged })
eq('userId در Audit چاپ بدون نشست', uid(seed.one('SELECT userId FROM "AuditLog" WHERE action IN (\'CREDIT_PRINT\',\'CREDIT_REPRINT\') ORDER BY id DESC LIMIT 1')), null)
const c2 = await ipcOk('IPC.customerCreate بدون نشست با userId جعلی', IPC.customerCreate, { name: 'مشتری بی‌نشست ۱۵۲', userId: forged })
eq('userId در Audit CUSTOMER_CREATE بدون نشست', uid(lastAudit('CUSTOMER_CREATE')), null)
await ipcOk('IPC.customerUpdate بدون نشست با userId جعلی', IPC.customerUpdate, { id: Number(c2?.id), name: 'بی‌نشست ۲', userId: forged })
eq('userId در Audit SETTINGS_UPDATE (Customer) بدون نشست', uid(lastAudit('SETTINGS_UPDATE', 'Customer')), null)

console.log('\n۵) ساختاری: هیچ کانال این دسته دیگر withUser(p) یا payload خام ندارد')
const src = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
const names = ['storeCreditLookup', 'creditPreview', 'creditVoid', 'creditSuspend', 'creditReactivate', 'creditExpiryChange',
  'creditAmountChange', 'creditUsesChange', 'creditHolderChange', 'creditRestrictionChange', 'creditDelete',
  'customerCreate', 'customerUpdate', 'customerDelete']
for (const n of names) {
  const line = src.split('\n').find((l) => l.includes(`handle(IPC.${n},`)) ?? ''
  truthy(`IPC.${n} ⇒ withOptionalSessionActor`, /withOptionalSessionActor\(p \?\? \{/.test(line) && !/withUser\(/.test(line))
}
// این چهار handler چندخطی و عمداً سخت‌گیرترند: یادآوری قفل اعتبار و چاپ/PDF
// نشست اصلی مدیر می‌خواهند. با این وجود actor عملیات از payload نمی‌آید.
truthy('IPC.creditReminderQueue ⇒ قفل اعتبار + actor امن + force حذف‌شده',
  /handle\(IPC\.creditReminderQueue, async \(p\) => \{[\s\S]{0,600}?assertCreditPanel\([\s\S]{0,600}?withOptionalSessionActor\(\{ id: \(p as any\)\?\.id \}\)/.test(src) &&
  !/queueReminder\([^\n]*force/.test(src)
)
for (const n of ['creditMarkPrinted', 'printCredit', 'printCreditBatch', 'creditPdf']) {
  const pattern = new RegExp(`handle\\(IPC\\.${n}, async \\(p\\) => \\{[\\s\\S]{0,500}?assertManagerSession\\([\\s\\S]{0,500}?withOptionalSessionActor\\(p \\?\\? \\{\\}`)
  truthy(`IPC.${n} ⇒ نشست مدیر + withOptionalSessionActor`, pattern.test(src))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
