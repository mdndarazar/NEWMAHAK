/**
 * Phase 4 — manager-only reporting exposes the immutable POS operator proof
 * without changing invoice financial attribution or inventing an identity for
 * a shared manager session.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s385-custody-sale-operator-report.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-sale-report-s385-'))
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

const manager = seed.user('مدیر گزارش S385')
const custodian = seed.user('مسئول کشو S385')
const operator = seed.user('اپراتور POS S385')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', custodian, operator)
await custodyService.setPin({ userId: manager, newPassword: 'Manager385!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager385!' })
for (const [id, temporary, permanent] of [[custodian, 'CustodyTemp385!', 'CustodyFinal385!'], [operator, 'OperatorTemp385!', 'OperatorFinal385!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager385!', reason: 'راه‌اندازی آزمون گزارش اپراتور فروش' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: custodian, password: 'CustodyFinal385!', countedCash: 0 })
const fence = await custodyService.actorForFinancialOperation()
const category = seed.category('دسته S385')
const product = seed.product('کالای S385', category)
const variant = seed.variant(product, 'M')
db.$harness.db.prepare('UPDATE "ProductVariant" SET salePrice=?, stock=? WHERE id=?').run(1000, 50, variant)
const cash = seed.insert('PaymentMethod', { key: 'S385-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const base = () => ({
  userId: fence.expectedActorUserId,
  shiftId: fence.expectedShiftId,
  custodyFence: fence,
  deductInventory: false,
  lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})

const pinSale = await salesService.create(attachVerifiedCustodySaleOperator(base(), {
  custodyShiftId: opened.shiftId,
  custodianUserId: custodian,
  operatorKind: 'OPERATOR_PIN',
  operatorUserId: operator,
  authMethod: 'CUSTODY_PIN'
}))
const managerSale = await salesService.create(attachVerifiedCustodySaleOperator(base(), {
  custodyShiftId: opened.shiftId,
  custodianUserId: custodian,
  operatorKind: 'MANAGER_SESSION',
  operatorUserId: null,
  authMethod: 'MANAGER_SESSION'
}))

/** Defense in depth for historic/manual corruption: report must preserve the
 * shared-session anonymity even when a malformed old row contains a user id. */
db.$harness.db.prepare('UPDATE "CustodySaleEvidence" SET operatorUserId=? WHERE invoiceId=?').run(manager, managerSale.id)
const report = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager385!', take: 20 })
const reportedPin = report.saleOperators.find((row) => row.invoiceId === pinSale.id)
const reportedManager = report.saleOperators.find((row) => row.invoiceId === managerSale.id)

eq('گزارش manager evidence هر دو فروش را برمی‌گرداند', report.saleOperators.length, 2)
eq('گزارش فروش PINدار به همان segment حضانت وصل است', reportedPin?.custodyShiftId, opened.shiftId)
eq('گزارش نام مسئول مالی کشو را جدا نشان می‌دهد', reportedPin?.custodianName, 'مسئول کشو S385')
eq('گزارش هویت اپراتور PINدار را از evidence می‌خواند', reportedPin?.operatorName, 'اپراتور POS S385')
eq('گزارش شماره فیش immutable فاکتور را برمی‌گرداند', reportedPin?.receiptNo, seed.one('SELECT receiptNo FROM "SaleInvoice" WHERE id=?', pinSale.id)?.receiptNo)
eq('گزارش روش PINدار را صریح نگه می‌دارد', reportedPin?.authMethod, 'CUSTODY_PIN')
eq('خلاصه، فروش‌های اپراتوری را می‌شمارد', report.summary.operatorSales, 2)
eq('خلاصه، فروش‌های PINدار را جدا می‌شمارد', report.summary.operatorPinSales, 1)
eq('خلاصه، فروش‌های نشست مدیر را جدا می‌شمارد', report.summary.managerSessionSales, 1)
eq('نشست مدیر در گزارش هم فرد واقعی جعل نمی‌کند', reportedManager?.operatorUserId, null)
eq('نشست مدیر در گزارش هم نام فردی را پنهان می‌کند', reportedManager?.operatorName, null)
eq('نوع نشست مدیر برای audit صریح باقی می‌ماند', reportedManager?.operatorKind, 'MANAGER_SESSION')
eq('گزارش attribution مالی Invoice را بازنویسی نمی‌کند', seed.one('SELECT userId, shiftId FROM "SaleInvoice" WHERE id=?', pinSale.id)?.userId, custodian)
eq('گزارش attribution شیفت Invoice را بازنویسی نمی‌کند', seed.one('SELECT userId, shiftId FROM "SaleInvoice" WHERE id=?', pinSale.id)?.shiftId, opened.shiftId)

const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
eq('خروجی گزارش فقط با مسیر evidence مستقل ساخته می‌شود', service.includes('prisma.custodySaleEvidence.findMany') && service.includes('saleOperators: saleOperators.map'), true)
eq('حریم نشست مدیر در خود گزارش fail-closed است', service.includes("row.operatorKind === 'MANAGER_SESSION'") && service.includes('const operatorUserId = anonymousManagerSession ? null'), true)
eq('UI گزارش، مسئولیت POS و کشو را صریحاً جدا می‌گوید', ui.includes('عملیات POS همان مسئولیت کشو نیست') && ui.includes('بدون انتساب شخصی'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
