/**
 * Phase 10 — actual IPC export route: a renderer cannot export a manager audit
 * page without Main's session, and spoofed renderer rows never reach the Main
 * report/export service. Harness Save dialog cancels, so this test writes no
 * user file while exercising the real authorization/data path.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s391-custody-main-audit-export-ipc.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-main-export-s391-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

const manager = seed.user('مدیر export Main S391')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
electron.BrowserWindow.getFocusedWindow = () => null
electron.BrowserWindow.getAllWindows = () => []
const sender = { id: 391, isDestroyed: () => false, once: () => {} }
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)

const untrusted = await invoke(IPC.custodyReportExport, { from: new Date(Date.now() - 1_000).toISOString(), to: new Date().toISOString(), rows: [['جعلی']], headers: ['جعلی'], title: 'جعلی' })
eq('بدون manager-session، export گزارش حضانت رد می‌شود', untrusted?.ok, false)

const login = await invoke(IPC.managerVerify, { password: '1111' })
eq('نشست رسمی مدیر برای export باز می‌شود', login?.ok, true)
const before = seed.count('CustodyEvent')
const beforeAudit = seed.count('AuditLog')
const exported = await invoke(IPC.custodyReportExport, {
  from: new Date(Date.now() - 60_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
  skip: 0,
  take: 1,
  managerUserId: manager,
  managerPassword: 'spoofed',
  managerSession: false,
  rows: [['evidence جعلی renderer']],
  headers: ['ستون جعلی'],
  title: 'عنوان جعلی renderer'
})
eq('export Main با session رسمی نتیجهٔ کنترل‌شده می‌دهد', exported?.ok, true)
eq('Save dialog لغوشده به‌عنوان خطا گزارش نمی‌شود', exported?.data?.canceled, true)
eq('export هیچ CustodyEvent عملیاتی تازه‌ای نمی‌سازد', seed.count('CustodyEvent'), before)
eq('نتیجهٔ export در AuditLog append-only ثبت می‌شود', seed.count('AuditLog'), beforeAudit + 1)
const auditRow = seed.one('SELECT action, userId, after, note FROM "AuditLog" ORDER BY id DESC LIMIT 1')
const auditAfter = JSON.parse(auditRow?.after ?? '{}')
eq('audit action مخصوص خروجی حضانت است', auditRow?.action, 'CUSTODY_REPORT_EXPORT')
eq('نشست مشترک مدیر هویت فردی جعلی نمی‌سازد', auditRow?.userId, null)
eq('لغو Save dialog نیز outcome صریح خودش را دارد', auditAfter?.outcome, 'CANCELED')
eq('audit خروجی مسیر فایل یا evidence کامل را ذخیره نمی‌کند', Object.hasOwn(auditAfter, 'path') || Object.hasOwn(auditAfter, 'rowsData'), false)
eq('note audit روش MANAGER_SESSION بی‌هویت را روشن می‌گوید', String(auditRow?.note).includes('نشست مشترک مدیر'), true)

const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const custody = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
eq('handler دادهٔ جعلی renderer را پیش از سرویس حذف می‌کند', ipc.includes('rows: _rows') && ipc.includes('headers: _headers') && ipc.includes('title: _title'), true)
eq('Main export را از report خودش می‌سازد', custody.includes('const report = await this.report({ ...input, managerSession: true })') && custody.includes('custodyAuditExportRows(report)'), true)
eq('Main title از گزارش خودش می‌آید، نه عنوان renderer', custody.includes('گزارش ممیزی حضانت') && !custody.includes('عنوان جعلی renderer'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
