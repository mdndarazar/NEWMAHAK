/**
 * ZIP-AUDIT-HIGH-02
 *
 * `shiftId` is renderer-controlled while the financial actor is derived from
 * the main-process open session. A caller with employee A's current session
 * must not close employee B's Shift or create a CashSession for it merely by
 * supplying B's id. Exercise the real IPC boundary, rather than only calling
 * either service with a friendly payload.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-02-shift-cash-ownership.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-02-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 90202, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userB = seed.user('کارمند B')
const userA = seed.user('کارمند A')
const today = toJalaliDate(new Date())

/** `openShift()` uses the newest open row as the server-side actor session. */
const shiftBForDirectClose = seed.insert('Shift', {
  name: 'نشست B برای بستن مستقیم',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3_000,
  userId: userB,
  staffConfirmed: 1
})
const shiftBForCashClose = seed.insert('Shift', {
  name: 'نشست B برای بستن صندوق',
  number: 2,
  dayJalali: today,
  openedAt: Date.now() - 2_000,
  userId: userB,
  staffConfirmed: 1
})
const currentShiftA = seed.insert('Shift', {
  name: 'نشست جاری A',
  number: 3,
  dayJalali: today,
  openedAt: Date.now() - 1_000,
  userId: userA,
  staffConfirmed: 1
})

registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`)
  }
}
const countCashSessionsFor = (shiftId) => Number(sql.prepare('SELECT COUNT(*) AS n FROM "CashSession" WHERE "shiftId" = ?').get(shiftId).n)
const closedAtOf = (shiftId) => sql.prepare('SELECT "closedAt" FROM "Shift" WHERE id = ?').get(shiftId)?.closedAt ?? null

console.log('۱) کارمند A نمی‌تواند با shiftId جعل‌شده نشست باز کارمند B را ببندد')
const direct = await invoke(IPC.shiftClose, { shiftId: shiftBForDirectClose, note: 'تلاش جعل‌شده' })
eq('بستن مستقیم نشست B از IPC رد می‌شود', direct?.ok, false)
eq('کد مالکیت برای بستن مستقیم برمی‌گردد', direct?.code, 'SHIFT_OWNERSHIP_REQUIRED')
eq('نشست B پس از رد بستن مستقیم هنوز باز است', closedAtOf(shiftBForDirectClose), null)

console.log('۲) همان جعل نمی‌تواند حتی بدون بستن Shift، snapshot صندوق B بسازد')
const cash = await invoke(IPC.cashClose, {
  shiftId: shiftBForCashClose,
  explicitShift: true,
  countedCash: 0,
  closeShift: false,
  note: 'تلاش جعل‌شده برای snapshot'
})
eq('بستن صندوق نشست B از IPC رد می‌شود', cash?.ok, false)
eq('کد مالکیت برای بستن صندوق برمی‌گردد', cash?.code, 'SHIFT_OWNERSHIP_REQUIRED')
eq('برای نشست B هیچ CashSession ساخته نمی‌شود', countCashSessionsFor(shiftBForCashClose), 0)
eq('نشست B پس از رد بستن صندوق هنوز باز است', closedAtOf(shiftBForCashClose), null)

console.log('۳) مسیر مجازِ کارمند جاری A همچنان کار می‌کند')
const own = await invoke(IPC.cashClose, {
  shiftId: currentShiftA,
  explicitShift: true,
  countedCash: 0,
  closeShift: true,
  note: 'بستن قانونی نشست خودم'
})
eq('کارمند A می‌تواند صندوق نشست خودش را ببندد', own?.ok, true)
eq('برای نشست A یک CashSession ثبت می‌شود', countCashSessionsFor(currentShiftA), 1)
eq('نشست A به‌طور اتمیک بسته می‌شود', closedAtOf(currentShiftA) != null, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
