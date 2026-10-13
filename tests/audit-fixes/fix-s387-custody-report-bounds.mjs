/**
 * Phase 6 — a manager custody report exposes its finite coverage. Each
 * collection reads one extra row solely to declare truncation; reports are
 * bounded reads and never silently claim to be complete history.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s387-custody-report-bounds.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-report-bounds-s387-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')

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

const manager = seed.user('مدیر محدوده گزارش S387')
await custodyService.setPin({ userId: manager, newPassword: 'Manager387!', currentPassword: '1111' })
const now = Date.now()
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000)
const invoiceA = seed.invoice({ receiptNo: 38701 })
const invoiceB = seed.invoice({ receiptNo: 38702 })
for (const [index, minute] of [2, 1].entries()) {
  seed.insert('CustodyEvent', { type: 'REPORT_BOUND_TEST', actorUserId: manager, actorKind: 'MANAGER', at: at(minute), operationalDay: '1405/01/01' })
  seed.insert('CustodyCount', { shiftId: 387, kind: 'CLOSING', countedCash: 1000 + index, expectedCash: 1000, differenceCash: index, countedByUserId: manager, authMethod: 'CUSTODY_PIN', epochAtCount: index + 1, idempotencyKey: `s387-count-${index}`, at: at(minute), operationalDay: '1405/01/01' })
}
seed.insert('CustodySaleEvidence', { invoiceId: invoiceA.id, custodyShiftId: 387, custodianUserId: manager, operatorKind: 'CUSTODIAN_SESSION', operatorUserId: manager, authMethod: 'CUSTODY_SESSION', at: at(2) })
seed.insert('CustodySaleEvidence', { invoiceId: invoiceB.id, custodyShiftId: 387, custodianUserId: manager, operatorKind: 'CUSTODIAN_SESSION', operatorUserId: manager, authMethod: 'CUSTODY_SESSION', at: at(1) })

const beforeRead = { events: seed.count('CustodyEvent'), counts: seed.count('CustodyCount'), operators: seed.count('CustodySaleEvidence') }
const report = await custodyService.report({
  managerUserId: manager,
  managerPassword: 'Manager387!',
  from: new Date(now - 10 * 60_000).toISOString(),
  to: new Date(now + 10 * 60_000).toISOString(),
  take: 1
})
const afterRead = { events: seed.count('CustodyEvent'), counts: seed.count('CustodyCount'), operators: seed.count('CustodySaleEvidence') }

eq('گزارش bounded هیچ evidence تازه‌ای نمی‌نویسد', JSON.stringify(afterRead), JSON.stringify(beforeRead))
eq('گزارش فقط به اندازهٔ take ردیف event برمی‌گرداند', report.events.length, 1)
eq('گزارش فقط به اندازهٔ take ردیف count برمی‌گرداند', report.counts.length, 1)
eq('گزارش فقط به اندازهٔ take ردیف operator برمی‌گرداند', report.saleOperators.length, 1)
eq('coverage سقف مؤثر را صریح می‌گوید', report.coverage.take, 1)
eq('coverage برش event را پنهان نمی‌کند', report.coverage.truncated.events, true)
eq('coverage برش count را پنهان نمی‌کند', report.coverage.truncated.counts, true)
eq('coverage برش evidence اپراتور را پنهان نمی‌کند', report.coverage.truncated.saleOperators, true)
eq('coverage هر برش را به هشدار کلی تبدیل می‌کند', report.coverage.truncatedAny, true)
eq('مرتب‌سازی newest-first با ردیف اضافه تغییر نمی‌کند', report.counts[0]?.id > 0 && Number(report.counts[0]?.countedCash), 1001)
eq('ابتدای بازه در پاسخ قابل audit است', report.from, new Date(now - 10 * 60_000).toISOString())
eq('انتهای بازه در پاسخ قابل audit است', report.to, new Date(now + 10 * 60_000).toISOString())

const empty = await custodyService.report({
  managerUserId: manager,
  managerPassword: 'Manager387!',
  from: new Date(now + 60 * 60_000).toISOString(),
  to: new Date(now + 2 * 60 * 60_000).toISOString(),
  take: 10
})
eq('رکورد خارج از بازه به گزارش نشت نمی‌کند', empty.counts.length + empty.events.length + empty.saleOperators.length, 0)
eq('بازهٔ بدون رکورد truncated نیست', empty.coverage.truncatedAny, false)
await rejects('بازهٔ معکوس fail-closed رد می‌شود', 'CUSTODY_REPORT_RANGE_INVALID', () => custodyService.report({ managerUserId: manager, managerPassword: 'Manager387!', from: new Date(now).toISOString(), to: new Date(now - 1).toISOString() }))
await rejects('مرز آغاز نامعتبر به بازهٔ پیش‌فرضِ گمراه‌کننده تبدیل نمی‌شود', 'CUSTODY_REPORT_RANGE_INVALID', () => custodyService.report({ managerUserId: manager, managerPassword: 'Manager387!', from: 'not-a-date' }))
await rejects('مرز پایان نامعتبر به «اکنون» جایگزین نمی‌شود', 'CUSTODY_REPORT_RANGE_INVALID', () => custodyService.report({ managerUserId: manager, managerPassword: 'Manager387!', to: 'not-a-date' }))

const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
eq('سرویس فقط یک ردیف اضافی برای کشف برش می‌خواند', service.includes('const queryTake = take + 1') && service.includes('const events = eventRows.slice(0, take)'), true)
eq('سرویس metadata پوشش را بازمی‌گرداند', service.includes('coverage: {') && service.includes('truncatedAny: Object.values(truncated).some(Boolean)'), true)
eq('UI بازهٔ bounded و هشدار برش را آشکار می‌کند', ui.includes('بازهٔ گزارش') && ui.includes('hasMoreAny') && ui.includes('این صفحه به‌تنهایی تاریخچهٔ کامل نیست'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
