/**
 * Q3 — دفتر هزینه فقط با درخواست گزارش افزایشی اجرا شود؛ نه از POS/timer.
 * ABC سود و خرید-در‌برابر-فروش با قفل سود بسته، دفتر را اجرا نمی‌کنند.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-cost-report-trigger-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
const { toJalaliDate } = await import('@shared/jalali')

makeSeeder(harnessClient())
const today = toJalaliDate(new Date())
const originalRun = costEngine.run
let runCount = 0
let busy = false
costEngine.run = async () => {
  runCount += 1
  return { busy }
}

try {
  const abcHidden = await stockInsightService.abc({ toJalali: today }, { withCost: false })
  assert.equal(runCount, 0, 'ABC پشت قفل سود نباید دفتر را اجرا کند')
  assert.equal(abcHidden.profitRows, undefined)

  const abcOpen = await stockInsightService.abc({ toJalali: today }, { withCost: true })
  assert.equal(runCount, 1, 'ABC سود باید پیش از خواندن FIFO اجرای افزایشی بخواهد')
  assert.ok(Array.isArray(abcOpen.profitRows))
  assert.equal(abcOpen.profitBusy, undefined)

  busy = true
  const abcBusy = await stockInsightService.abc({ toJalali: today }, { withCost: true })
  assert.equal(runCount, 2)
  assert.equal(abcBusy.profitBusy, true)
  assert.equal(abcBusy.profitRows, undefined, 'در حالت busy سود کهنه نباید نمایش داده شود')
  assert.match(abcBusy.note, /مشغول است/)

  const buyHidden = await stockInsightService.purchaseVsSale({ fromJalali: today, toJalali: today }, { withCost: false })
  assert.equal(runCount, 2, 'تب خرید/فروش بدون مجوز فی نباید دفتر را اجرا کند')
  assert.equal(buyHidden.fifoSoldCost, undefined)

  busy = false
  const buyOpen = await stockInsightService.purchaseVsSale({ fromJalali: today, toJalali: today }, { withCost: true })
  assert.equal(runCount, 3, 'تب خرید/فروشِ دارای FIFO باید اجرای افزایشی بخواهد')
  assert.equal(buyOpen.warnings.some((w) => /مشغول/.test(w)), false)

  busy = true
  const buyBusy = await stockInsightService.purchaseVsSale({ fromJalali: today, toJalali: today }, { withCost: true })
  assert.equal(runCount, 4)
  assert.equal(buyBusy.fifoSoldCost, undefined, 'هزینهٔ FIFO کهنه هنگام busy برنگردد')
  assert.equal(buyBusy.accumulation, undefined)
  assert.match(buyBusy.label, /قدیمی نمایش داده نمی‌شود/)
  assert.ok(buyBusy.warnings.some((w) => /مشغول/.test(w)))

  const root = new URL('../..', import.meta.url)
  const salesSource = readFileSync(new URL('src/main/services/SalesService.ts', root), 'utf8')
  assert.doesNotMatch(salesSource, /costEngine\.run\(|CostEngine/)
  const engineSource = readFileSync(new URL('src/main/services/management/CostEngine.ts', root), 'utf8')
  assert.doesNotMatch(engineSource, /set(?:Interval|Timeout)\s*\(/, 'هزینه نباید timer/اجرای زمان‌بندی‌شده داشته باشد')
  const ipcSource = readFileSync(new URL('src/main/ipc/index.ts', root), 'utf8')
  assert.match(ipcSource, /handle\(IPC\.mgmtCostEngineRebuild,[\s\S]{0,240}assertManagerPassword/)
  console.log('✓ management cost report triggers: gated, incremental, no stale-on-busy, no POS hook · 0 failures')
} finally {
  costEngine.run = originalRun
}
