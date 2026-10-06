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
const ipcMain = read('src/main/ipc/index.ts')
const svc = read('src/main/services/WooSyncService.ts')
const inv = read('src/main/services/InventoryService.ts')
const profit = read('src/main/services/management/ProfitService.ts')
const cost = read('src/main/services/management/CostEngine.ts')
const page = read('src/renderer/src/pages/WooSync.tsx')
const movements = read('src/renderer/src/components/MovementsModal.tsx')
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
check('IPC کانال‌های Woo دارد و عملیات حساس رمز مدیر جدا می‌خواهد', [
  /wooStatus: 'woo:status'/.test(ipc), /wooSyncNow: 'woo:sync:now'/.test(ipc), /wooParkedRetry: 'woo:parked:retry'/.test(ipc), /woo:links:resumeApply/.test(ipc), /wooSync: 'woo-sync'/.test(read('src/shared/panels.ts')), /assertManagerPassword\(\(p \?\? \{\}\)\.managerPassword/.test(ipcMain)
], [true, true, true, true, true, true])

console.log('\n— Main sync behavior')
check('InventoryService بعد از هر حرکت داخلی outbox می‌سازد و WOO_SYNC_* loop نمی‌شود', [
  /enqueueWooForMovement/.test(inv), /String\(input\.reason\)\.startsWith\('WOO_SYNC_'\)/.test(svc), /OUTBOX_ENQUEUE_FAILED/.test(inv)
], [true, true, true])
check('Woo service به سایت فقط stock/apply می‌زند و allowlist قیمت/مشتری ندارد', [
  /\/stock\/apply/.test(svc), !/_price|regular_price|sale_price|customer|billing|shipping/i.test(svc), /X-Mahak-Token/.test(svc)
], [true, true, true])
check('Pull ژورنال سایت فقط StockMovement با WOO_SYNC_* می‌سازد، نه SaleInvoice', [
  /WooInboundEvent/.test(svc), /applyWooDelta/.test(svc), /reason: input\.reason \?\? wooStockReason/.test(svc), !/saleInvoice\.create|customer\.create|payment\.create/i.test(svc)
], [true, true, true, true])
check('Push کهنه rebase می‌شود، موجودی منفی روی سایت صفر می‌شود و outbox بن‌بست ندارد', [
  /REBASING_AFTER_INBOUND/.test(svc), /STOCK_PUSH_REBASED/.test(svc), /function publishedQty/.test(svc), /STALE_IN_FLIGHT_RESET/.test(svc), /MAX_OUTBOX_ATTEMPTS/.test(svc)
], [true, true, true, true, true])

check('Pause/unlink ردیف IN_FLIGHT را supersede نمی‌کند و worker بعد از HTTP لینک تازه می‌خواند', [
  /return \[WooOutboxStatus\.PENDING, WooOutboxStatus\.FAILED, WooOutboxStatus\.CONFLICT, WooOutboxStatus\.DEAD\]/.test(svc), /where: \{ id: row\.id, status: WooOutboxStatus\.IN_FLIGHT \}/.test(svc), /freshLink = await .*wooProductLink\.findUnique/.test(svc), /freshLink\.status === link\.status/.test(svc)
], [true, true, true, true])
check('ارسال در حال پرواز اگر حین HTTP دستی pause شود، با updatedAt قدیمی دوباره ACTIVE نمی‌شود', [
  /function sameDbTime/.test(svc), /freshLink\.status === link\.status && sameDbTime\(freshLink\.updatedAt, link\.updatedAt\)/.test(svc), /preservedFloor/.test(svc)
], [true, true, true])
check('PARKED گم نمی‌شود: شمارنده/UI/IPC و retry دارد و cursor اگر PARK ثبت نشود جلو نمی‌رود', [
  /parkedEvents/.test(svc) && /parkedEvents/.test(read('src/shared/wooSync.ts')), /wooParkedRetry/.test(ipc) && /wooParkedRetry/.test(ipcMain), /async retryParked/.test(svc), /wooInboundEvent\.upsert\(\{\s*where: \{ eventUuid: baseEvent\.eventUuid \}/s.test(svc), /پردازش پارک‌شده‌ها/.test(page)
], [true, true, true, true, true])

check('PARKED در scheduler/syncNow خودکار اعمال نمی‌شود و پردازش دستی رمز مدیر می‌خواهد', [
  !/AUTO_PARKED_RETRY/.test(svc), !/const parked = await this\.retryParked/.test(svc), /wooParkedRetry[\s\S]*assertManagerPassword/.test(ipcMain), /managerPassword/.test(page) && /پارک‌شده/.test(page), /row\.relinkId/.test(svc) && /remainingRestoreAllowance/.test(svc)
], [true, true, true, true, true])
check('Reconcile دوره‌ای اختلاف لینک‌های ACTIVE را کشف و صف امن می‌سازد', [
  /async reconcileActiveLinks/.test(svc), /RECONCILE_DIFF/.test(svc), /expectedWooQty: wooSafeInt\(r\.stockQuantity\)/.test(svc), /AUTO_RECONCILE_FAILED/.test(svc), /OUTBOX_ENQUEUE_FAILED/.test(inv)
], [true, true, true, true, true])
check('Reconcile قبل از drain شدن ژورنال سایت push نمی‌کند و بیش از ۵۰ اتصال را چرخشی پوشش می‌دهد', [
  /async pullJournalDrain/.test(svc), /Number\(r\.lastSeq\) > cursor/.test(svc), /RECONCILE_WAIT_JOURNAL/.test(svc), /WOO_RECONCILE_LAST_ID_KEY/.test(svc), /id: \{ gt: lastId \}/.test(svc) && /id: \{ lte: lastId \}/.test(svc)
], [true, true, true, true, true])
check('VERIFY_ONLY/NOOP بدون برابری عدد و بدون رویداد زمان قطع پذیرفته نمی‌شود', [
  /pendingPaused > 0/.test(svc), /publishedQty\(txStock\) !== publishedQty\(preview\.wooQty\)/.test(svc), /برای «فقط بررسی»، موجودی MAHAK و سایت باید برابر باشد/.test(svc), /resumePreview\.pausedEvents\.length > 0/.test(page)
], [true, true, true, true])
check('Backorder منفی سایت به lastWooQty واقعی می‌رود، اما target ارسالی published/non-negative می‌ماند', [
  /const newQty = wooSafeInt\(raw\.new_qty/.test(svc), /const expected = wooSafeInt\(row\.expectedWooQty/.test(svc), /target = publishedQty/.test(svc), /lastWooQty: appliedWooQty/.test(svc)
], [true, true, true, true])
check('Retry بعد timeout/idempotent از new_qty سایت استفاده می‌کند و در mismatch outbox تازه می‌سازد', [
  /appliedWooQty = res\?\.new_qty == null \? target : wooSafeInt\(res\.new_qty\)/.test(svc), /res\?\.idempotent === true && appliedWooQty !== target/.test(svc), /STOCK_PUSH_RETRY_AFTER_IDEMPOTENT/.test(svc)
], [true, true, true])
check('خطای HTTP ساختاری است و فقط کدهای افزونه لینک را BROKEN_REMOTE می‌کنند', [
  /class WooHttpError/.test(svc), /throw new WooHttpError\(res\.status, code/.test(svc), /\['mahak_not_found', 'mahak_manage_stock_off', 'mahak_manage_stock_parent'\]\.includes\(errCode\)/.test(svc), !/remoteBroken = \/manage_stock\|not found\|404/i.test(svc)
], [true, true, true, true])
check('وصل دوباره/حل اختلاف کورکورانه نیست و relinkSeqFloor جلوی دوباره‌شماری را می‌گیرد', [
  /remoteLastSeq/.test(svc) && /this\.pullJournal\(200\)/.test(svc), /seq <= relinkFloor/.test(svc), /expectedPausedEventCount/.test(svc), /pendingReconcilePush/.test(svc), /حل اختلاف/.test(page)
], [true, true, true, true, true])
check('گزارش سود/زیان سایت را فروش یا کسری حساب نمی‌کند؛ CostEngine kind جدا و restore دقیق دارد', [
  /WOO_SYNC_OUT', 'WOO_SYNC_IN', 'WOO_SYNC_ADJUST/.test(profit), /kind: 'EXTERNAL_SYNC'/.test(cost), /restoreExternalSync/.test(cost), /همگام‌سازی سایت: خروج موجودی/.test(movements)
], [true, true, true, true])

console.log('\n— UI و Plugin')
check('صفحه UI صریحاً می‌گوید فقط موجودی sync می‌شود و پیش‌نمایش امضا می‌فرستد', [/فقط موجودی/.test(page), /قیمت، سفارش، مشتری/.test(page), /expectedMahakStock/.test(page), /رمز مدیر/.test(page)], [true, true, true, true])
check('Plugin تحویل شده و endpointها فقط موجودی/catalog/journal هستند', [
  existsSync(resolve(root, pluginPath)), /Plugin Name: MAHAK Stock Sync/.test(plugin), /mahak-stock\/v1/.test(plugin), /stock\/apply/.test(plugin), /catalog/.test(plugin), /journal/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin idempotent است، meta قدیمی را بعد از apply به‌روز می‌کند و token خام در URL نمی‌گذارد', [
  /previous_record_for_request/.test(plugin), /remember_qty\(\$product, \$target\)/.test(plugin), /mahak_token_notice/.test(plugin), !/mahak_new_token/.test(plugin)
], [true, true, true, true])

check('Plugin apply موجودی/status را با Woo save می‌کند، target/expected اجباری و قفل DB دارد', [
  /wc_update_product_stock\(\$product, \$target, 'set'\)/.test(plugin), !/wc_update_product_stock\(\$product, \$target, 'set', true\)/.test(plugin), /expected and target integer fields are required/.test(plugin), /GET_LOCK/.test(plugin) && /RELEASE_LOCK/.test(plugin), /FOR UPDATE/.test(plugin) && /START TRANSACTION/.test(plugin)
], [true, true, true, true, true])
check('Variation با manage_stock والد قابل اتصال/نوشتن نیست و catalog صفحه‌بندی دارد', [
  /manage_stock_mode/.test(plugin), /mahak_manage_stock_parent/.test(plugin), /get_meta\('_manage_stock'/.test(plugin), /has_more/.test(plugin) && /page/.test(plugin), /manageStockMode/.test(svc), /موجودی مشترک والد/.test(page)
], [true, true, true, true, true, true])
check('Refund/order item context بعد از hookهای item stock روی آخرین journal row patch می‌شود و به تغییر قدیمی/نامرتبط نمی‌چسبد', [
  /woocommerce_reduce_order_item_stock/.test(plugin), /woocommerce_restore_order_item_stock/.test(plugin), /order_item_id/.test(plugin), /order_item_qty/.test(plugin), /refund_restock/.test(plugin), /created_at >= \(UTC_TIMESTAMP\(\) - INTERVAL 10 MINUTE\)/.test(plugin), /allowed_sources/.test(plugin)
], [true, true, true, true, true, true, true])
check('Plugin قیمت/مشتری را در خروجی نمی‌دهد و فقط stock_quantity را expose می‌کند', [
  /stock_quantity/.test(plugin), !/_price|regular_price|sale_price|billing|shipping|customer_email/i.test(plugin), /old.*new/.test(plugin) && /return;/.test(plugin)
], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
