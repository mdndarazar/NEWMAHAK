/**
 * Structural audit for MAHAK ↔ WooCommerce stock-only sync.
 * اجرا: node tests/audit-fixes/fix-s300-woo-stock-sync.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')
let ok = 0, bad = 0
function check(label, actual, expected = true) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`) }
}

const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20271016100000_woo_stock_sync/migration.sql')
const enums = read('src/shared/enums.ts')
const ipc = read('src/shared/ipc.ts')
const svc = read('src/main/services/WooSyncService.ts')
const inv = read('src/main/services/InventoryService.ts')
const profit = read('src/main/services/management/ProfitService.ts')
const cost = read('src/main/services/management/CostEngine.ts')
const page = read('src/renderer/src/pages/WooSync.tsx')
const pluginPath = 'resources/woocommerce/mahak-stock-sync.php'
const plugin = read(pluginPath)

console.log('\n— DB و قرارداد فقط موجودی')
check('مدل‌ها و migration افزایشی Woo ساخته شده‌اند', [
  /model WooProductLink/.test(schema), /model WooSyncOutbox/.test(schema), /model WooInboundEvent/.test(schema), /model WooSyncLog/.test(schema),
  /CREATE TABLE IF NOT EXISTS "WooProductLink"/.test(migration), /StockMovement_wooInboundEvent_unique/.test(migration)
], [true, true, true, true, true, true])
check('reasonهای سایت فقط موجودی‌اند و AuditAction جدا دارند', [
  /WOO_SYNC_OUT/.test(enums), /WOO_SYNC_IN/.test(enums), /WOO_SYNC_ADJUST/.test(enums), /WOO_LINK_PAUSE/.test(enums), /WOO_SYNC_RUN/.test(enums)
], [true, true, true, true, true])
check('IPC کانال‌های Woo دارد و صفحه پشت قفل مستقل است', [
  /wooStatus: 'woo:status'/.test(ipc), /wooSyncNow: 'woo:sync:now'/.test(ipc), /woo:links:resumeApply/.test(ipc), /wooSync: 'woo-sync'/.test(read('src/shared/panels.ts')), /path: 'woo-sync'/.test(read('src/renderer/src/main.tsx'))
], [true, true, true, true, true])

console.log('\n— Main sync behavior')
check('InventoryService بعد از هر حرکت داخلی outbox می‌سازد و WOO_SYNC_* loop نمی‌شود', [
  /enqueueWooForMovement/.test(inv), /String\(input\.reason\)\.startsWith\('WOO_SYNC_'\)/.test(svc), /status: WooLinkStatus\.ACTIVE/.test(svc)
], [true, true, true])
check('Woo service به سایت فقط stock/apply می‌زند و allowlist قیمت/مشتری ندارد', [
  /\/stock\/apply/.test(svc), !/_price|regular_price|sale_price|customer|billing|shipping/i.test(svc), /X-Mahak-Token/.test(svc)
], [true, true, true])
check('Pull ژورنال سایت فقط StockMovement با WOO_SYNC_* می‌سازد، نه SaleInvoice', [
  /WooInboundEvent/.test(svc), /applyWooDelta/.test(svc), /reason: input\.reason \?\? wooStockReason/.test(svc), !/saleInvoice\.create|customer\.create|payment\.create/i.test(svc)
], [true, true, true, true])
check('گزارش سود/زیان سایت را فروش یا کسری حساب نمی‌کند؛ CostEngine kind جدا دارد', [
  /WOO_SYNC_OUT', 'WOO_SYNC_IN', 'WOO_SYNC_ADJUST/.test(profit), /kind: 'EXTERNAL_SYNC'/.test(cost), /WOO_SYNC_OUT/.test(cost)
], [true, true, true])
check('وصل دوباره/حل اختلاف کورکورانه نیست؛ فقط سفارش‌های source=order اعمال و admin editها PARK می‌شوند', [
  /isWooOrderPausedEvent/.test(svc), /source.*order/.test(svc), /status: WooInboundStatus\.PARKED/.test(svc), /LINK_RESUME_PREVIEW_ONLY/.test(svc), /row\.expectedWooQty \?\? link\.lastWooQty/.test(svc), /حل اختلاف/.test(page)
], [true, true, true, true, true, true])

console.log('\n— UI و Plugin')
check('صفحه UI صریحاً می‌گوید فقط موجودی sync می‌شود', [/فقط موجودی/.test(page), /قیمت، سفارش، مشتری/.test(page), /wooLinkCreate/.test(page)], [true, true, true])
check('Plugin تحویل شده و endpointها فقط موجودی/catalog/journal هستند', [
  existsSync(resolve(root, pluginPath)), /Plugin Name: MAHAK Stock Sync/.test(plugin), /mahak-stock\/v1/.test(plugin), /stock\/apply/.test(plugin), /catalog/.test(plugin), /journal/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin قیمت/مشتری را در خروجی نمی‌دهد و فقط stock_quantity را expose می‌کند', [
  /stock_quantity/.test(plugin), !/_price|regular_price|sale_price|billing|shipping|customer_email/i.test(plugin), /old.*new/.test(plugin) && /return;/.test(plugin)
], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
