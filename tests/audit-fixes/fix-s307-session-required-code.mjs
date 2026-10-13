// نشست ۳۰۷: تست قبل/بعد بایگانی مرحله‌ی ۱ «ریکوری نشست + پیام‌های وضعیت‌محور».
/**
 * ===========================================================================
 * نشست ۳۰۷ · مسیر ریکوری نشست · بند ۲ (خطای وضعیت‌محور با کد SESSION_REQUIRED)
 *
 * قبل از رفع: وقتی نشست بازِ کارمند وجود نداشت، withSessionActor فقط
 * «برای ثبت فاکتور فروش، ابتدا یک نشست بازِ کارمند لازم است» می‌داد — بدون
 * این‌که بگوید *چرا* دروازه بسته است:
 *   الف) اصلاً نشستی نداریم، ب) نشست داریم ولی کارمندش نامعلوم است،
 *   ج) نشست جامانده‌ی روز قبل است که پولش شمرده نشده و ردّ آن خطرناک است.
 * پیامِ یکسان برای هر سه حالت، کاربر را در حالت «ج» به بن‌بست می‌برد.
 *
 * انتظار بعد از رفع:
 *   ۱) خطا BusinessError با code = 'SESSION_REQUIRED' است و handle آن را
 *      عبور می‌دهد (رندرر دیگر به regex پیام فارسی وابسته نیست).
 *   ۲) پیام برای هر سه حالت متفاوت است و مسیر ریکاوری را می‌گوید.
 *   ۳) شکل یک‌خطی IPCهای mutation دست‌نخورده (قفل‌های s140/s151c).
 *   ۴) با نشست بازِ معتبر، دروازه عبور می‌کند و خطا دیگر SESSION_REQUIRED نیست.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s307-session-required-code.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s307-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

// IPC handlers are sender-bound. The harness provides the minimal Electron
// shell, so this test supplies one stable, live window sender explicitly.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const IPC_EVENT = { sender: { id: 307, isDestroyed: () => false, once: () => {} } }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { jalaliToday, jalaliAddDays, faDigits } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(IPC_EVENT, payload)

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const eq = (label, got, want) => (got === want ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`)))

/* ------------------------------ قفل ساختاری ------------------------------ */
{
  const src = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
  truthy(
    'قفل: handler saleCreate فقط از actor/fence و evidence امن Main می‌گذرد',
    /handle\(IPC\.saleCreate, async \(p\) => afterSaleThankYou\(salesService\.create\(await withVerifiedSaleOperator\(p \?\? \{\}\)\)\)\)/.test(src) &&
      /const financial = await withSessionActor\(raw, 'ثبت فاکتور فروش'\)/.test(src)
  )
  truthy(
    'قفل: withSessionActor خطای وضعیت‌محور با کد SESSION_REQUIRED می‌دهد',
    /throw new BusinessError\(message, 'SESSION_REQUIRED'\)/.test(src)
  )
  truthy(
    'قفل: handle کد BusinessError را به رندرر پاس می‌دهد',
    /err\?\.isBusinessError === true && typeof err\?\.code === 'string'/.test(src)
  )
  const errSrc = readFileSync(resolve('src/main/errors.ts'), 'utf8')
  truthy('قفل: BusinessError فیلد اختیاری code دارد', /readonly code\?: string/.test(errSrc))
}

/* ------------------------------ الف) نشست نداریم -------------------------- */
{
  const r = await ipc(IPC.saleCreate, {})
  eq('الف) saleCreate بدون نشست رد می‌شود', r.ok, false)
  eq("الف) code دقیقاً 'SESSION_REQUIRED' است", r.code, 'SESSION_REQUIRED')
  truthy('الف) پیام راهنمای بازکردن نشست دارد', /نشست بازِ کارمند لازم است/.test(String(r.error)))
  truthy('الف) پیام حاوی ادعای نشست جامانده نیست', !/هنوز باز/.test(String(r.error)))
}

/* ------------------------------ ب) نشست بدون کارمند ---------------------- */
const today = jalaliToday()
const yesterday = jalaliAddDays(today, -1)
let pendingShiftId = null
{
  pendingShiftId = seed.insert('Shift', { name: 'صبح', sessionSeq: 1, dayJalali: today, userId: null, closedAt: null })
  const r = await ipc(IPC.saleCreate, {})
  eq('ب) نشست بدون کارمند رد می‌شود', r.ok, false)
  eq("ب) code دقیقاً 'SESSION_REQUIRED' است", r.code, 'SESSION_REQUIRED')
  truthy('ب) پیام «کارمند نامعلوم» متفاوت است', /معلوم نیست پشت صندوق کیست/.test(String(r.error)))
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), pendingShiftId)
}

/* ------------------------------ ج) نشست جامانده -------------------------- */
const staleUser = seed.user('کارمند دیروز')
let staleShiftId = null
{
  staleShiftId = seed.insert('Shift', { name: 'عصر', sessionSeq: 2, dayJalali: yesterday, userId: staleUser, closedAt: null })
  const r = await ipc(IPC.saleCreate, {})
  eq('ج) نشست جامانده رد می‌شود', r.ok, false)
  eq("ج) code دقیقاً 'SESSION_REQUIRED' است", r.code, 'SESSION_REQUIRED')
  truthy('ج) دلیل «هنوز باز و شمرده‌نشده» در پیام است', /هنوز باز و پولش شمرده نشده/.test(String(r.error)))
  truthy('ج) تاریخ روز قبل در پیام است', String(r.error).includes(faDigits(yesterday)))
  truthy('ج) نام کارمند نشست جامانده در پیام است', String(r.error).includes('کارمند دیروز'))
  truthy('ج) پیام قدیمیِ ژنریک نیست (s188 متفاوت می‌ماند)', !/ثبت یا تغییر پرداخت، ابتدا/.test(String(r.error)))
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), staleShiftId)
}

/* ------------------------------ د) کنترل: نشست معتبر --------------------- */
{
  const staff = seed.user('کارمند امروز')
  seed.insert('Shift', { name: 'صبح', sessionSeq: 1, dayJalali: today, userId: staff, closedAt: null })
  const r = await ipc(IPC.saleCreate, {})
  eq('د) دروازه عبور می‌کند (خطا به خود سرویس می‌رسد نه SESSION_REQUIRED)', r.code, undefined)
  truthy('د) خطای SESSION_REQUIRED نیست', !/نشست بازِ کارمند لازم است/.test(String(r.error)))
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
