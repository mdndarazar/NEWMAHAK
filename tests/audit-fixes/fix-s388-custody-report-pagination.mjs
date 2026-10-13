/**
 * Phase 7 — custody report pages are bounded, server-ordered and read-only.
 * A page uses a fixed audit interval; each collection declares whether an
 * older page exists instead of pretending there is one merged global cursor.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s388-custody-report-pagination.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-report-pagination-s388-'))
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

const manager = seed.user('مدیر صفحه‌بندی S388')
await custodyService.setPin({ userId: manager, newPassword: 'Manager388!', currentPassword: '1111' })
const now = Date.now()
for (const [index, minutesAgo] of [3, 2, 1].entries()) {
  seed.insert('CustodyCount', {
    shiftId: 388,
    kind: 'CLOSING',
    countedCash: 2000 + index,
    expectedCash: 2000,
    differenceCash: index,
    countedByUserId: manager,
    authMethod: 'CUSTODY_PIN',
    epochAtCount: index + 1,
    idempotencyKey: `s388-count-${index}`,
    at: new Date(now - minutesAgo * 60_000),
    operationalDay: '1405/01/02'
  })
}
const bounds = { from: new Date(now - 10 * 60_000).toISOString(), to: new Date(now + 10 * 60_000).toISOString(), take: 1 }
const beforeRead = seed.count('CustodyCount')
const newest = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager388!', ...bounds, skip: 0 })
const middle = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager388!', ...bounds, skip: 1 })
const oldest = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager388!', ...bounds, skip: 2 })
const afterRead = seed.count('CustodyCount')

eq('خواندن صفحه‌ها هیچ count تازه‌ای نمی‌سازد', afterRead, beforeRead)
eq('صفحهٔ نخست از offset صفر شروع می‌شود', newest.coverage.skip, 0)
eq('صفحهٔ نخست تازه‌ترین count را دارد', Number(newest.counts[0]?.countedCash), 2002)
eq('صفحهٔ نخست برای count، صفحهٔ قدیمی‌تر را اعلام می‌کند', newest.coverage.hasMore.counts, true)
eq('صفحهٔ نخست hasMoreAny دارد', newest.coverage.hasMoreAny, true)
eq('صفحهٔ میانی offset قطعی خودش را برمی‌گرداند', middle.coverage.skip, 1)
eq('صفحهٔ میانی، evidence میانی را بدون duplicate می‌خواند', Number(middle.counts[0]?.countedCash), 2001)
eq('صفحهٔ میانی هنوز count قدیمی‌تر دارد', middle.coverage.hasMore.counts, true)
eq('صفحهٔ آخر offset قطعی خودش را برمی‌گرداند', oldest.coverage.skip, 2)
eq('صفحهٔ آخر قدیمی‌ترین evidence را دارد', Number(oldest.counts[0]?.countedCash), 2000)
eq('صفحهٔ آخر دیگر count قدیمی‌تر اعلام نمی‌کند', oldest.coverage.hasMore.counts, false)
eq('صفحهٔ آخر hasMoreAny ندارد', oldest.coverage.hasMoreAny, false)
eq('همهٔ صفحه‌ها همان from anchor را نگه می‌دارند', middle.from, newest.from)
eq('همهٔ صفحه‌ها همان to anchor را نگه می‌دارند', oldest.to, newest.to)
const normalized = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager388!', ...bounds, skip: -50 })
eq('offset منفی به صفر clamp می‌شود', normalized.coverage.skip, 0)

const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
eq('Main همان offset bounded را به همهٔ streams می‌دهد', service.includes('const skip = Math.min(50_000') && service.includes('skip, take: queryTake'), true)
eq('Main hasMore هر stream را جدا برمی‌گرداند', service.includes('hasMore: { ...truncated }') && service.includes('hasMoreAny: Object.values(truncated).some(Boolean)'), true)
eq('UI بازه را در ref anchor می‌کند و صفحهٔ قدیمی‌تر دارد', ui.includes('custodyReportRangeRef') && ui.includes('قدیمی‌تر') && ui.includes('refreshRange'), true)
eq('پاسخ دیررس صفحهٔ قدیمی نمی‌تواند گزارش تازه‌تر را بازنویسی کند', ui.includes('custodyReportRequestRef') && ui.includes('requestId !== custodyReportRequestRef.current'), true)
eq('UI شکست گزارش را fail-closed پاک می‌کند', ui.includes('setCustodyTimeline(null)') && ui.includes('setCustodyReportSkip(0)'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
