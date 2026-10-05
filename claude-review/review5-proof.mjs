/**
 * ===========================================================================
 * بازبینی پنجم — گارد کانال `credit:reminder:queue` (تست نگهبان؛ بخشی از محصول نیست)
 *
 *     node --import ./test/harness/register.mjs claude-review/review5-proof.mjs
 *
 * باگ گزارش‌شده: این کانال هیچ قفل پنلی نداشت و `force` را از payload رندرر
 * می‌پذیرفت ⇒ با یک `invoke` می‌شد بدون باز کردن قفل پنل اعتبار، برای هر کدی
 * پیامک ساخت و همه‌ی قواعد ضداسپم را دور زد.
 *
 * این فایل «رفتار درست» را می‌سنجد، پس قبل از رفع «×» و بعد از رفع «✓» می‌دهد.
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-review5-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const ROOT = new URL('..', import.meta.url).pathname
const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { storeCreditService, issueStoreCredit } = await import('../src/main/services/StoreCreditService.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const { isReminderForceable, reminderDecision, DEFAULT_CREDIT_REMINDER } = await import('@shared/credit')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('بازبینی ۵')
const DAY = 86_400_000

let ok = 0
let bad = 0
const show = (label, cond, extra = '') => {
  if (cond) ok++
  else bad++
  console.log(`  ${cond ? '✓ رفتار درست' : '× باگ'} · ${label}${extra ? ' · ' + extra : ''}`)
}

await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط', purpose: 'SERVICE', isActive: true, userId })
// همان یک خطِ بوت: فرستنده‌ی واقعی، تا «یادآوری» در صف پیامک بنشیند (نه فقط لاگ)
const { smsNotificationSender } = await import('../src/main/services/sms/SmsNotificationSender.ts')
const notify = await import('../src/main/services/NotificationSender.ts')
notify.setNotificationSender(smsNotificationSender)

const outboxFor = (phone) =>
  sql.prepare('SELECT COUNT(*) n FROM "SmsOutbox" WHERE phoneSnapshot = ?').get(phone).n
const logFor = (creditId) =>
  sql.prepare('SELECT status, reason FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC LIMIT 1').get(creditId)

// ---------------------------------------------------------------------------
console.log('\n۱) کانال IPC: قفل پنل + نپذیرفتن `force` از رندرر')
{
  const ipc = readFileSync(join(ROOT, 'src/main/ipc/index.ts'), 'utf-8')
  const handler = ipc.slice(
    ipc.indexOf('handle(IPC.creditReminderQueue'),
    ipc.indexOf('handle(IPC.creditReminderLogs') > 0
      ? ipc.indexOf('handle(IPC.creditReminderLogs')
      : ipc.indexOf('handle(IPC.creditReminderQueue') + 900
  )
  show('هندلر یادآوری، قفل پنل اعتبار را چک می‌کند', /assertCreditPanel\(|assertCreditRead\(/.test(handler), handler.slice(0, 60))
  show(
    'و `force` از payload رندرر عبور نمی‌کند (فقط id می‌رود)',
    /withOptionalSessionActor\(\{ id:/.test(handler) && !/withOptionalSessionActor\(p \?\? \{\}\)/.test(handler)
  )
  show('و کانال‌های همسایه هم همچنان گیت دارند', /creditReminderLogs[^]*?assertCreditRead/.test(ipc))
}

// ---------------------------------------------------------------------------
console.log('\n۲) سرویس: `force` فقط دلیل‌های زمان‌بندی/سهمیه را رد می‌کند')
{
  show('کد قابل‌رد: سقف تعداد', isReminderForceable('MAX_COUNT') === true)
  show('کد قابل‌رد: فاصله‌ی روزها', isReminderForceable('GAP') === true)
  show('کد غیرقابل‌رد: کد باطل/مصرف‌شده', isReminderForceable('STATUS') === false)
  show('کد غیرقابل‌رد: مشتری پیام نمی‌خواهد (Opt-out)', isReminderForceable('OPTOUT') === false)
  show('کد غیرقابل‌رد: بدون شماره', isReminderForceable('NO_PHONE') === false)

  const base = {
    id: 1,
    code: 'C1',
    status: 'ACTIVE',
    amount: 1_000_000,
    usedAmount: 0,
    usedCount: 0,
    maxUses: 1,
    multiUse: false,
    expiresAt: null,
    issuedAt: new Date(Date.now() - 40 * DAY),
    lastReminderAt: null,
    reminderCount: 99, // سقف پر
    reminderOptOut: false,
    phone: '09120000000'
  }
  const d1 = reminderDecision(base, DEFAULT_CREDIT_REMINDER)
  show('سقف پر ⇒ کد MAX_COUNT می‌دهد (قابل‌رد برای دکمه‌ی دستی)', d1.code === 'MAX_COUNT', String(d1.code))

  const d2 = reminderDecision({ ...base, reminderOptOut: true }, DEFAULT_CREDIT_REMINDER)
  show('Opt-out ⇒ کد OPTOUT (هیچ نیرویی نباید ردش کند)', d2.code === 'OPTOUT', String(d2.code))

  const d3 = reminderDecision({ ...base, status: 'CANCELED' }, DEFAULT_CREDIT_REMINDER)
  show('کد باطل ⇒ کد STATUS (هیچ نیرویی نباید ردش کند)', d3.code === 'STATUS', String(d3.code))
}

// ---------------------------------------------------------------------------
console.log('\n۳) رفتار واقعی سرویس: force روی کد باطل/مصرف‌شده پیام نمی‌سازد')
{
  const voided = await issueStoreCredit(db, {
    amount: 3_000_000,
    holderPhone: '09125550001',
    source: 'MANUAL',
    userId
  })
  // ابطال واقعی رمز مدیر می‌خواهد؛ اینجا فقط *وضعیت* را باطل می‌کنیم (همان داده‌ای
  // که تصمیم‌گیر می‌بیند) — خودِ ابطال موضوع این تست نیست.
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ?, status = ? WHERE id = ?').run(
    Date.now() - 40 * DAY,
    'CANCELED',
    voided.id
  )

  const res = await storeCreditService.queueReminder({ id: voided.id, userId, force: true })
  show('کد باطل + force=true ⇒ هیچ پیامکی در صف نمی‌نشیند', outboxFor('09125550001') === 0)
  show('و لاگ با وضعیت «ثبت نشد» می‌ماند', String(res?.status) === 'SKIPPED' || String(logFor(voided.id)?.status) === 'SKIPPED', String(logFor(voided.id)?.status))

  const optedOut = await issueStoreCredit(db, {
    amount: 3_000_000,
    holderPhone: '09125550002',
    source: 'MANUAL',
    userId
  })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ?, reminderOptOut = 1 WHERE id = ?').run(
    Date.now() - 40 * DAY,
    optedOut.id
  )
  const res2 = await storeCreditService.queueReminder({ id: optedOut.id, userId, force: true })
  show('Opt-out + force=true ⇒ هیچ پیامکی نمی‌رود', outboxFor('09125550002') === 0)
  show('و وضعیت «انصراف» ثبت می‌شود', String(res2?.status) === 'OPTED_OUT', String(res2?.status ?? logFor(optedOut.id)?.status))
}

// ---------------------------------------------------------------------------
console.log('\n۴) ضدکنترل: دکمه‌ی دستی برای کد سالم هنوز کار می‌کند')
{
  const good = await issueStoreCredit(db, {
    amount: 3_000_000,
    holderPhone: '09125550003',
    source: 'MANUAL',
    userId
  })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, good.id)
  await storeCreditService.queueReminder({ id: good.id, userId })
  show('یادآوری معمولی (بدون force) در صف می‌نشیند', outboxFor('09125550003') === 1)

  // سقف پر: بدون force رد می‌شود، با force (فقط در مسیر داخلی) می‌گذرد
  sql.prepare('UPDATE "StoreCredit" SET reminderCount = ?, lastReminderAt = NULL WHERE id = ?').run(99, good.id)
  const blocked = await storeCreditService.queueReminder({ id: good.id, userId })
  show('سقف پر ⇒ بدون force پیام تازه‌ای ساخته نمی‌شود', outboxFor('09125550003') === 1 && String(blocked?.status) === 'SKIPPED', String(blocked?.status))
  const forced = await storeCreditService.queueReminder({ id: good.id, userId, force: true })
  show('و با force (مسیر داخلی) سهمیه رد می‌شود ولی پیام می‌رود', String(forced?.status) === 'LOGGED', String(forced?.status))
}

// ---------------------------------------------------------------------------
console.log('\n۵) انتها-به-انتها: خودِ کانال IPC (بازتولید دقیق گزارش بازبینی پنجم)')
{
  /**
   * گزارش بازبینی دقیقاً همین را می‌گفت: `invoke('credit:reminder:queue',
   * { id, force: true })` **بدون باز کردن قفل پنل اعتبار** هم قفل را دور می‌زد و
   * هم همه‌ی قاعده‌های ضداسپم را. تا اینجا کد خوانده شد؛ اینجا به‌جای خواندن کد،
   * همان کانالِ ثبت‌شده صدا زده می‌شود (همان کاری که رندررِ مهاجم می‌کند).
   */
  const electron = await import('electron')
  const handlers = new Map()
  electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
  const { registerIpcHandlers } = await import('../src/main/ipc/index.ts')
  const { IPC } = await import('@shared/ipc')
  const panelSession = await import('../src/main/services/panelSession.ts')
  registerIpcHandlers()
  const call = (ch, payload) => handlers.get(ch)(null, payload)

  // ── ۱) قفل پنل اعتبار بسته است (پیش‌فرضِ نصب تازه: همه‌ی پنل‌ها قفل) ──
  const lockedCr = await issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09125550010', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, lockedCr.id)
  const r1 = await call(IPC.creditReminderQueue, { id: lockedCr.id, force: true })
  show(
    'با قفل بسته، حتی با force:true هم پیامکی ساخته نمی‌شود',
    r1?.ok === false && outboxFor('09125550010') === 0,
    String(r1?.error ?? '').slice(0, 46)
  )
  show('و خطا کاربر را به «باز کردن قفل همان بخش» هدایت می‌کند', /قفل/.test(String(r1?.error ?? '')))

  // ── ۲) پنل را باز می‌کنیم؛ حالا فقط باید خودِ `force`ِ payload بی‌اثر باشد ──
  panelSession.notePanelUnlocked(panelSession.CREDIT_READ_PANEL, 'PANEL')

  const voidedCr = await issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09125550011', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ?, status = ? WHERE id = ?').run(Date.now() - 40 * DAY, 'CANCELED', voidedCr.id)
  const r2 = await call(IPC.creditReminderQueue, { id: voidedCr.id, force: true })
  show('پنل باز + کد باطل + force:true ⇒ همچنان هیچ پیامکی نمی‌رود', outboxFor('09125550011') === 0, `status=${String(r2?.data?.status)}`)

  const cappedCr = await issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09125550012', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ?, reminderCount = 99, lastReminderAt = NULL WHERE id = ?').run(Date.now() - 40 * DAY, cappedCr.id)
  const r3 = await call(IPC.creditReminderQueue, { id: cappedCr.id, force: true })
  show('و `force`ِ payload حتی سقف سهمیه را هم رد نمی‌کند (فقط مسیر داخلی می‌تواند)', outboxFor('09125550012') === 0, `status=${String(r3?.data?.status)}`)

  const dueCr = await issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09125550013', source: 'MANUAL', userId })
  sql.prepare('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?').run(Date.now() - 40 * DAY, dueCr.id)
  const r4 = await call(IPC.creditReminderQueue, { id: dueCr.id })
  show('ضدکنترل: همان کانال، برای کدِ واجد شرایط با پنل باز پیام می‌فرستد', r4?.ok === true && outboxFor('09125550013') === 1, `status=${String(r4?.data?.status)}`)
}

console.log(`\nخلاصه: ${ok} رفتار درست · ${bad} باگ اثبات‌شده`)
process.exit(bad === 0 ? 0 : 1)
