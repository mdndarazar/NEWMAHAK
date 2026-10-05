/**
 * ممیزی نشست ۱۲۸ (S128-1) — تأیید رفتاری گیت «آرشیو و پاک‌سازی» از مسیر IPC واقعی main
 * (fix-s128-maintenance-archive-gate فقط regex بود):
 *   • بدون رمز / رمز غلط ⇒ رد کامل، حتی با purgeAudit=false؛ هیچ فاکتور/پرداختی حذف نمی‌شود
 *   • با رمز مدیر و userId جعلی ⇒ اجرا، actor ردیف Audit = کارمند نشست باز (نه payload)
 *   • رد رمز پیش از هر شمارش/بکاپ: فاکتور قدیمی دست‌نخورده
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s128-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const { toJalaliDate, jalaliToday, jalaliAddDays } = await import(join(root, 'src/shared/jalali.ts'))
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)
const DAY = 86400000
const today = jalaliToday()
const minCut = jalaliAddDays(today, -730)
const actor = seed.user('صندوق‌دار نشست باز ۱۲۸')
const forged = seed.user('کارمند جعلی ۱۲۸')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: actor })
const oldT = Date.now() - 1100 * DAY; const oldJ = toJalaliDate(new Date(oldT))
const oldInv = seed.insert('SaleInvoice', { receiptNo: 1, status: 'SETTLED', grandTotal: 1000, paidTotal: 1000, goodsTotal: 1000, issuedAt: oldT, issuedAtJalali: oldJ })
const invCount = () => seed.count('SaleInvoice', 'id = ?', oldInv)
const base = { beforeJalali: minCut, backup: false, vacuum: false, userId: forged }
for (const [lbl, extra] of [['بدون رمز (purgeAudit=false)', { purgeAudit: false }], ['بدون رمز (purgeAudit=true)', { purgeAudit: true }], ['رمز غلط', { purgeAudit: false, managerPassword: 'wrong-0000' }]]) {
  const r = await ipc(IPC.maintenanceArchivePurge, { ...base, ...extra })
  eq(`${lbl}: رد با پیام فارسی`, r?.ok === false && /[\u0600-\u06FF]/.test(String(r?.error)), true)
  eq(`${lbl}: فاکتور قدیمی دست‌نخورده`, invCount(), 1)
}
eq('هیچ ردیف Audit آرشیو پیش از رمز درست', seed.count('AuditLog', `action = 'DATA_ARCHIVE_PURGE'`), 0)
const r = await ipc(IPC.maintenanceArchivePurge, { ...base, purgeAudit: false, managerPassword: PW })
eq('با رمز مدیر: اجرا شد', r?.ok ? true : r?.error, true)
eq('با رمز مدیر: فاکتور قدیمی حذف شد', invCount(), 0)
const a = seed.one(`SELECT userId FROM "AuditLog" WHERE action = 'DATA_ARCHIVE_PURGE' ORDER BY id DESC LIMIT 1`)
eq('actor Audit = کارمند نشست باز، نه userId جعلی', Number(a?.userId), actor)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
