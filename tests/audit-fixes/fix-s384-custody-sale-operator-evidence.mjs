/**
 * Phase 3b — POS operation identity is explicit but never rewrites physical
 * drawer custody. Operator PIN and shared manager session are separate,
 * append-only evidence; invoice userId/shiftId stay with the custodian.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s384-custody-sale-operator-evidence.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-sale-operator-s384-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { attachVerifiedCustodySaleOperator, salesService } = await import('../../src/main/services/SalesService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, code, work) => {
  try { await work(); eq(label, true, false) }
  catch (error) { eq(label, error?.code, code) }
}

const manager = seed.user('مدیر S384')
const custodian = seed.user('مسئول کشو S384')
const operator = seed.user('اپراتور POS S384')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', custodian, operator)
await custodyService.setPin({ userId: manager, newPassword: 'Manager384!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager384!' })
for (const [id, temporary, permanent] of [[custodian, 'CustodyTemp384!', 'CustodyFinal384!'], [operator, 'OperatorTemp384!', 'OperatorFinal384!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager384!', reason: 'راه‌اندازی آزمون اپراتور فروش' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: custodian, password: 'CustodyFinal384!', countedCash: 0 })
const fence = await custodyService.actorForFinancialOperation()
const category = seed.category('دسته S384')
const product = seed.product('کالای S384', category)
const variant = seed.variant(product, 'M')
db.$harness.db.prepare('UPDATE "ProductVariant" SET salePrice=?, stock=? WHERE id=?').run(1000, 50, variant)
const cash = seed.insert('PaymentMethod', { key: 'S384-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const base = () => ({
  userId: fence.expectedActorUserId,
  shiftId: fence.expectedShiftId,
  custodyFence: fence,
  deductInventory: false,
  lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})

await rejects('فروش custody مستقیم بدون evidence اپراتور fail-closed است', 'CUSTODY_OPERATOR_EVIDENCE_REQUIRED', () => salesService.create(base()))
const unfenced = base()
delete unfenced.custodyFence
await rejects('فراخوانی Main-side بدون fence نیز راه فرار از custody/evidence نیست', 'CUSTODY_OPERATOR_EVIDENCE_REQUIRED', () => salesService.create(unfenced))
await rejects('رمز اشتباه اپراتور، هویت عملیاتی تولید نمی‌کند', 'PIN_WRONG', () => custodyService.verifySaleOperator(operator, 'wrong-operator-password'))
const verifiedOperator = await custodyService.verifySaleOperator(operator, 'OperatorFinal384!')
eq('اپراتور با PIN خودش احراز می‌شود', verifiedOperator.userId, operator)

const operatorSale = await salesService.create(attachVerifiedCustodySaleOperator(base(), {
  custodyShiftId: fence.expectedShiftId,
  custodianUserId: custodian,
  operatorKind: 'OPERATOR_PIN',
  operatorUserId: verifiedOperator.userId,
  authMethod: 'CUSTODY_PIN'
}))
const operatorEvidence = seed.one('SELECT invoiceId, custodyShiftId, custodianUserId, operatorKind, operatorUserId, authMethod FROM "CustodySaleEvidence" WHERE invoiceId=?', operatorSale.id)
eq('evidence اپراتور به همان فاکتور وصل است', operatorEvidence?.invoiceId, operatorSale.id)
eq('evidence اپراتور شیفت حضانت واقعی را نگه می‌دارد', operatorEvidence?.custodyShiftId, opened.shiftId)
eq('evidence اپراتور مسئول مالی کشو را جدا نگه می‌دارد', operatorEvidence?.custodianUserId, custodian)
eq('نوع evidence اپراتور PINدار است', operatorEvidence?.operatorKind, 'OPERATOR_PIN')
eq('هویت اپراتور از PIN خودش می‌آید', operatorEvidence?.operatorUserId, operator)
eq('روش احراز evidence، PIN شخصی است', operatorEvidence?.authMethod, 'CUSTODY_PIN')
const operatorInvoice = seed.one('SELECT userId, shiftId FROM "SaleInvoice" WHERE id=?', operatorSale.id)
eq('اپراتور، userId مالی فاکتور را بازنویسی نمی‌کند', operatorInvoice?.userId, custodian)
eq('اپراتور، shiftId مالی فاکتور را بازنویسی نمی‌کند', operatorInvoice?.shiftId, opened.shiftId)
eq('پاسخ POS نیز هویت عملیاتی را جدا برمی‌گرداند', operatorSale.custodyOperator?.kind, 'OPERATOR_PIN')

const managerSale = await salesService.create(attachVerifiedCustodySaleOperator(base(), {
  custodyShiftId: fence.expectedShiftId,
  custodianUserId: custodian,
  operatorKind: 'MANAGER_SESSION',
  operatorUserId: null,
  authMethod: 'MANAGER_SESSION'
}))
const managerEvidence = seed.one('SELECT custodianUserId, operatorKind, operatorUserId, authMethod FROM "CustodySaleEvidence" WHERE invoiceId=?', managerSale.id)
eq('نشست مدیر، نوع evidence صریح خودش را دارد', managerEvidence?.operatorKind, 'MANAGER_SESSION')
eq('نشست مدیر به مدیر فرضی با User.id جعلی نسبت داده نمی‌شود', managerEvidence?.operatorUserId, null)
eq('نشست مدیر، مسئولیت مالی custodian را نگه می‌دارد', managerEvidence?.custodianUserId, custodian)
eq('روش احراز نشست مدیر در evidence ثبت می‌شود', managerEvidence?.authMethod, 'MANAGER_SESSION')
eq('فاکتور نشست مدیر هم به custodian مالی وصل می‌ماند', seed.one('SELECT userId, shiftId FROM "SaleInvoice" WHERE id=?', managerSale.id)?.userId, custodian)

// Exercise the actual IPC boundary: renderer-supplied user/shift/fence fields
// are discarded, then Main derives both financial custody and operator proof.
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 384, isDestroyed: () => false, once: () => {} }
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)
const ipcOperatorSale = await invoke(IPC.saleCreate, {
  ...base(), userId: manager, shiftId: 999999, custodyFence: { epoch: 0 },
  saleOperatorMode: 'OPERATOR_PIN', saleOperatorUserId: operator, saleOperatorPassword: 'OperatorFinal384!'
})
eq('IPC فروش اپراتور PINدار را ثبت می‌کند', ipcOperatorSale?.ok, true)
const ipcInvoice = seed.one('SELECT userId, shiftId FROM "SaleInvoice" WHERE id=?', ipcOperatorSale?.data?.id)
eq('IPC userId جعلی renderer را با custodian جایگزین می‌کند', ipcInvoice?.userId, custodian)
eq('IPC shiftId جعلی renderer را با shift حضانت جایگزین می‌کند', ipcInvoice?.shiftId, opened.shiftId)
eq('IPC evidence اپراتور PINدار ثبت می‌کند', seed.one('SELECT operatorUserId, operatorKind FROM "CustodySaleEvidence" WHERE invoiceId=?', ipcOperatorSale?.data?.id)?.operatorUserId, operator)

const managerLogin = await invoke(IPC.managerVerify, { password: '1111' })
eq('نشست مدیر فقط با verify رسمی Main باز می‌شود', managerLogin?.ok, true)
const ipcManagerSale = await invoke(IPC.saleCreate, { ...base(), saleOperatorMode: 'MANAGER_SESSION' })
eq('IPC فروش با نشست مدیر معتبر را ثبت می‌کند', ipcManagerSale?.ok, true)
const ipcManagerEvidence = seed.one('SELECT operatorKind, operatorUserId, custodianUserId FROM "CustodySaleEvidence" WHERE invoiceId=?', ipcManagerSale?.data?.id)
eq('IPC نشست مدیر نیز User.id جعلی تولید نمی‌کند', ipcManagerEvidence?.operatorUserId, null)
eq('IPC نشست مدیر مسئول مالی custodian را نگه می‌دارد', ipcManagerEvidence?.custodianUserId, custodian)

const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const sales = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const pos = readFileSync(new URL('../../src/renderer/src/pages/Pos.tsx', import.meta.url), 'utf8')
eq('IPC فیلدهای جعل‌پذیر اپراتور را پاک می‌کند', ipc.includes('delete raw.saleOperatorUserId') && ipc.includes('delete raw.saleOperatorPassword'), true)
eq('IPC اپراتور را با PIN سرویس حضانت احراز می‌کند', ipc.includes('custodyService.verifySaleOperator(requestedUserId, requestedPassword)'), true)
eq('IPC نشست مدیر را server-side می‌سنجد', ipc.includes("assertManagerSession('ثبت فروش با نشست مدیر')"), true)
eq('سرویس token غیرقابل‌جعل و evidence جدا دارد', sales.includes('VERIFIED_CUSTODY_SALE_OPERATOR') && sales.includes('custodySaleEvidence.create'), true)
eq('POS انتخاب اپراتور و PIN تک‌فروش را آشکار می‌کند', pos.includes('saleOperatorMode') && pos.includes('رمز شخصی حضانت اپراتور') && pos.includes('setSaleOperatorPassword(\'\')'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
