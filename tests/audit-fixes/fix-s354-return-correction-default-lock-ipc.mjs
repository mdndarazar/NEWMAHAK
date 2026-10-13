/**
 * S354 — نصب تازه نباید اصلاح، ابطال یا اصلاح جبرانی برگشت/تعویض را باز بگذارد.
 *
 * این تست مرز واقعی UI-payload → IPC Main → actor نشست → SalesService → DB را
 * می‌سنجد. نبود Setting.panelLocks همان دیتابیس تازه است: سه mutation حساس
 * باید بی‌رمز رد شوند و فقط credential مجاز بتواند داده را عوض کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s354-return-correction-default-lock-ipc.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s354-return-lock-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 35401, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD, SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS, allLockedConfig } = await import('@shared/panels')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const ROOT = new URL('../../', import.meta.url).pathname
const source = (path) => readFileSync(resolve(ROOT, path), 'utf8')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const truthy = (label, value) => eq(label, !!value, true)

const userId = seed.user('کارمند نشست ۳۵۴')
const categoryId = seed.category('کالای تست')
const productId = seed.product('کالای برگشت تست', categoryId)
const v1 = seed.variant(productId, 'اول')
const v2 = seed.variant(productId, 'دوم')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 600 WHERE id = ?').run(v1)
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 400 WHERE id = ?').run(v2)
const shiftId = seed.insert('Shift', {
  name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 60_000, userId
})

/** عمداً Setting.panelLocks ساخته نمی‌شود: این حالت واقعی نصب تازه است. */
eq('نصب تازه Setting قفل ندارد', seed.one('SELECT key FROM "Setting" WHERE key = ?', SETTING_KEYS.panelLocks) == null, true)
eq('پیش‌فرض shared برای اصلاح/ابطال روشن است', allLockedConfig()[PANEL_KEYS.salesReturnCorrection], true)
registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)
const itemRows = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const returnItemCount = (returnId) => Number(seed.one('SELECT COUNT(*) AS c FROM "SaleReturnItem" WHERE returnId = ?', returnId)?.c ?? -1)

const invoice = await salesService.create({
  userId,
  shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 600, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 400, discount: 0, tax: 0 }
  ],
  payments: []
})
const items = itemRows(invoice.id)
const ret = await salesService.createReturn({
  invoiceId: invoice.id,
  full: false,
  lines: [{ saleItemId: items[0].id, qty: 1 }],
  refundMethod: RefundMethod.NONE,
  userId
})
const returnId = ret.id ?? ret.returnId
const updatePayload = {
  id: returnId,
  /** renderer cannot choose the Audit actor; IPC resolves the actual open-shift user. */
  userId: 999_999,
  lines: [{ saleItemId: items[0].id, qty: 1 }],
  overrideReason: 'تست قفل پیش‌فرض'
}

console.log('\n۱) سه mutation حساس از IPC بی‌رمز رد می‌شوند')
const updateLocked = await invoke(IPC.saleReturnUpdate, updatePayload)
eq('ویرایش مستقیم بی‌رمز رد می‌شود', updateLocked?.ok, false)
truthy('پیام ویرایش به مجوز اصلاح اشاره دارد', String(updateLocked?.error ?? '').includes('تأیید مدیر'))
eq('رد ویرایش، اقلام را تغییر نمی‌دهد', returnItemCount(returnId), 1)

const correctionLocked = await invoke(IPC.saleReturnCorrection, {
  id: returnId,
  userId: 999_999,
  reason: 'تست قفل اصلاح جبرانی',
  cashRecovered: 0,
  cardRecovered: 0,
  creditOutcome: 'NONE'
})
eq('اصلاح جبرانی مستقیم بی‌رمز رد می‌شود', correctionLocked?.ok, false)
truthy('رد اصلاح جبرانی، دفتر مستقل نمی‌سازد', seed.one('SELECT id FROM "ReturnCorrection" WHERE returnId = ?', returnId) == null)

const deleteLocked = await invoke(IPC.saleReturnDelete, {
  id: returnId,
  userId: 999_999,
  reason: 'تست قفل ابطال'
})
eq('ابطال مستقیم بی‌رمز رد می‌شود', deleteLocked?.ok, false)
eq('رد ابطال، سند را فعال نگه می‌دارد', seed.one('SELECT voidedAt FROM "SaleReturn" WHERE id = ?', returnId)?.voidedAt == null, true)

console.log('\n۲) credential مجاز از همان IPC عبور می‌کند و actor از نشست Main می‌آید')
const updateAllowed = await invoke(IPC.saleReturnUpdate, {
  ...updatePayload,
  panelPassword: DEFAULT_MANAGER_PASSWORD,
  managerPassword: DEFAULT_MANAGER_PASSWORD
})
eq('ویرایش با رمز مدیر موفق است', updateAllowed?.ok, true)
const updateAudit = seed.one(
  'SELECT userId, after FROM "AuditLog" WHERE entity = ? AND entityId = ? AND action = ? ORDER BY id DESC LIMIT 1',
  'SaleReturn', returnId, 'SALE_RETURN'
)
eq('actor Audit از نشست است، نه userId جعلی renderer', Number(updateAudit?.userId), userId)
truthy('Audit ویرایش scope مدیرِ قفل اصلاح را نگه می‌دارد', String(updateAudit?.after ?? '').includes('"correctionAuthScope":"MANAGER"'))

const deleteAllowed = await invoke(IPC.saleReturnDelete, {
  id: returnId,
  reason: 'ابطال مجاز تستی',
  panelPassword: DEFAULT_MANAGER_PASSWORD
})
eq('ابطال با رمز مدیر موفق است', deleteAllowed?.ok, true)
eq('سند پس از IPC مجاز باطل شده است', seed.one('SELECT voidedAt FROM "SaleReturn" WHERE id = ?', returnId)?.voidedAt != null, true)

console.log('\n۳) UI رمز را به قرارداد IPC صحیح می‌فرستد')
const editModal = source('src/renderer/src/components/ReturnEditModal.tsx')
const returnPage = source('src/renderer/src/pages/SalesReturn.tsx')
const reportsPage = source('src/renderer/src/pages/SalesReports.tsx')
truthy('مودال ویرایش panelPassword می‌فرستد', /panelPassword:\s*editPw\.trim\(\)\s*\|\|\s*undefined/.test(editModal))
truthy('UI ابطال برگشت رمز پیش‌فرض را شفاف نشان می‌دهد', /رمز تأیید ابطال \(در نصب تازه اجباری\)/.test(returnPage))
truthy('UI اصلاح جبرانی برگشت رمز پیش‌فرض را شفاف نشان می‌دهد', /رمز اصلاح جبرانی \(در نصب تازه اجباری\)/.test(returnPage))
truthy('UI ابطال تعویض رمز پیش‌فرض را شفاف نشان می‌دهد', /رمز تأیید ابطال \(اجباری مگر مدیر قفل را خاموش کرده باشد\)/.test(reportsPage))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
