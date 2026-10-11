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
  /model WooProductLink/.test(schema), /model WooSyncOutbox/.test(schema), /model WooInboundEvent/.test(schema), /model WooSyncLog/.test(schema), /model WooApproval/.test(schema),
  /CREATE TABLE IF NOT EXISTS "WooProductLink"/.test(migration), /StockMovement_wooInboundEvent_unique/.test(migration), /CREATE TABLE IF NOT EXISTS "WooApproval"/.test(read('prisma/migrations/20271016110000_woo_approval/migration.sql'))
], [true, true, true, true, true, true, true, true])
check('reasonهای سایت فقط موجودی‌اند و AuditAction جدا دارند', [
  /WOO_SYNC_OUT/.test(enums), /WOO_SYNC_IN/.test(enums), /WOO_SYNC_ADJUST/.test(enums), /WOO_LINK_PAUSE/.test(enums), /WOO_SYNC_RUN/.test(enums)
], [true, true, true, true, true])
check('IPC کانال‌های Woo دارد و عملیات حساس رمز مدیر جدا می‌خواهد', [
  /wooStatus: 'woo:status'/.test(ipc), /wooSyncNow: 'woo:sync:now'/.test(ipc), /wooParkedRetry: 'woo:parked:retry'/.test(ipc), /wooApprovals: 'woo:approvals'/.test(ipc), /wooApprovalResolve: 'woo:approvals:resolve'/.test(ipc), /woo:links:resumeApply/.test(ipc), /wooSync: 'woo-sync'/.test(read('src/shared/panels.ts')), /assertManagerPassword\(\(p \?\? \{\}\)\.managerPassword/.test(ipcMain)
], [true, true, true, true, true, true, true, true])

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
check('WooApproval/HOLD/FROZEN برای event مبهم، اختلاف دوره‌ای و loop fuse فعال است', [
  /async approvals/.test(svc), /async resolveApproval/.test(svc), /WooApprovalAction\.APPLY_INBOUND/.test(svc), /WooApprovalAction\.RECONCILE_DISCREPANCY/.test(svc), /WooApprovalAction\.LOOP_FUSE/.test(svc), /WooLinkStatus\.FROZEN/.test(svc), /صف تأیید مدیر/.test(page)
], [true, true, true, true, true, true, true])
check('Reconcile دوره‌ای اختلاف لینک‌های ACTIVE را کشف و صف امن می‌سازد', [
  /async reconcileActiveLinks/.test(svc), /RECONCILE_DIFF/.test(svc), /WooApprovalAction\.RECONCILE_DISCREPANCY/.test(svc), /AUTO_RECONCILE_FAILED/.test(svc), /OUTBOX_ENQUEUE_FAILED/.test(inv)
], [true, true, true, true, true])
check('Reconcile قبل از drain شدن ژورنال سایت push نمی‌کند و بیش از ۵۰ اتصال را چرخشی پوشش می‌دهد', [
  /async pullJournalDrain/.test(svc), /Number\(r\.lastSeq\) > cursor/.test(svc), /RECONCILE_WAIT_JOURNAL/.test(svc), /WOO_RECONCILE_LAST_ID_KEY/.test(svc), /id: \{ gt: lastId \}/.test(svc) && /id: \{ lte: lastId \}/.test(svc)
], [true, true, true, true, true])
check('VERIFY_ONLY/NOOP بدون برابری عدد و بدون رویداد زمان قطع پذیرفته نمی‌شود', [
  /heldEvents\.length > 0/.test(svc), /publishedQty\(txStock\) !== publishedQty\(preview\.wooQty\)/.test(svc), /برای «فقط بررسی»، موجودی MAHAK و سایت باید برابر باشد/.test(svc), /resumePreview\.pausedEvents\.length > 0/.test(page)
], [true, true, true, true])
check('Backorder منفی سایت به lastWooQty واقعی می‌رود، اما target ارسالی published/non-negative می‌ماند', [
  /const newQty = wooSafeInt\(raw\.new_qty/.test(svc), /const expected = wooSafeInt\(row\.expectedWooQty/.test(svc), /target = publishedQty/.test(svc), /lastWooQty: appliedWooQty/.test(svc)
], [true, true, true, true])
check('Remote stock نامعتبر یا اعشاری به صفر تبدیل و WOO_WINS نمی‌شود', [
  /function wooNullableInt/.test(svc), /Number\.isSafeInteger\(raw\)/.test(svc) && /\/\^-\?\\d\+\$\//.test(svc) && !/function wooNullableInt[\s\S]{0,180}wooSafeInt\(raw\)/.test(svc), /stockQuantity: wooNullableInt/.test(svc), /!remoteStockUsable\(r\)/.test(svc) && /BROKEN_REMOTE/.test(svc), /!remoteStockUsable\(remote\)/.test(svc) && /resumePreview/.test(svc), /freshRemoteForDecision/.test(svc) && /سایت.*مرجع/.test(svc), /stockQuantity: number \| null/.test(read('src/shared/wooSync.ts')), /stockQuantity == null/.test(page)
], [true, true, true, true, true, true, true, true])
check('حل اختلاف و اتصال اولیه دوباره‌شماری ژورنال سایت نمی‌سازد', [
  /initialSeqFloor/.test(svc) && /relinkSeqFloor: initialSeqFloor/.test(svc), /pullJournalDrain\(5, 200\)/.test(svc), /SUPERSEDED_BY_/.test(svc) && /WooApprovalAction\.APPLY_INBOUND/.test(svc), /remoteLastSeq/.test(svc) && /relinkSeqFloor: relinkFloor/.test(svc), /afterSeq = Math.max\(0, cursor - 50\)/.test(svc), /ژورنال سایت هنوز کامل نشده/.test(svc)
], [true, true, true, true, true, true])
check('Retry بعد timeout/idempotent از new_qty سایت استفاده می‌کند و در mismatch outbox تازه می‌سازد', [
  /const appliedWooQty = wooStrictIntField\(res\?\.new_qty\)/.test(svc) && /if \(appliedWooQty == null\) throw new BusinessError\('عدد موجودی جدید در پاسخ سایت معتبر نیست/.test(svc), /res\?\.idempotent === true && appliedWooQty !== target/.test(svc), /STOCK_PUSH_RETRY_AFTER_IDEMPOTENT/.test(svc)
], [true, true, true])
check('خطای HTTP ساختاری است و فقط کدهای افزونه لینک را BROKEN_REMOTE می‌کنند', [
  /class WooHttpError/.test(svc), /throw new WooHttpError\(res\.status, code/.test(svc), /mahak_fractional_stock/.test(svc) && /mahak_manage_stock_parent/.test(svc), /transientRemote/.test(svc) && /mahak_stock_lock_timeout/.test(svc), !/remoteBroken = \/manage_stock\|not found\|404/i.test(svc)
], [true, true, true, true, true])
check('وصل دوباره/حل اختلاف کورکورانه نیست و relinkSeqFloor جلوی دوباره‌شماری را می‌گیرد', [
  /remoteLastSeq/.test(svc) && /this\.pullJournal\(200\)/.test(svc), /seq <= relinkFloor/.test(svc), /expectedPausedEventCount/.test(svc), /pendingReconcilePush/.test(svc), /حل اختلاف/.test(page)
], [true, true, true, true, true])
check('Approval قدیمی/خطرناک رویداد سفارش سایت را silent supersede نمی‌کند', [
  /orderPausedEvents/.test(svc) && /MAHAK \+ سفارش‌های سایت/.test(svc), /STALE_ACTIVE_LINK/.test(svc), /SUPERSEDED_BY_RESUME/.test(svc), /SUPERSEDED_BY_RELINK_FLOOR/.test(svc), /APPROVAL_RECONCILED/.test(svc)
], [true, true, true, true, true])
check('Loop fuse فقط reconcile/manual بدون movementId را می‌شمارد و تراکنش‌های Woo timeout مشترک دارند', [
  /createdAt: \{ gte: since \}, movementId: null/.test(svc), /import \{ TX_OPTIONS \} from '\.\.\/db\/tx'/.test(svc), /prisma\.\$transaction\(run, TX_OPTIONS\)/.test(svc), /}, TX_OPTIONS\)/.test(svc)
], [true, true, true, true])
check('Echo و retry/apply inbound به لینک و relink floor محدود شده‌اند', [
  /isMahakApplyEcho && link\?\.id \? await db\(\)\.wooSyncOutbox\.findFirst\(\{ where: \{ idempotencyKey: requestId, linkId: link\.id \}/.test(svc), /async retryParked/.test(svc) && /row\.seq[\s\S]*relinkFloor/.test(svc), /canSupersedeByRelinkFloor\(link, baseEvent\)/.test(svc), /existing && existing\.status !== WooInboundStatus\.PARKED/.test(svc)
], [true, true, true, true])
check('PARKED سفارش‌ها در guardهای resume/resolve دیده می‌شوند و floor آن‌ها را حذف کور نمی‌کند', [
  /function heldInboundWhere/.test(svc) && /WooInboundStatus\.PARKED/.test(svc), /heldInboundWhere\(fresh, null\)/.test(svc) && /hasHeldAfter\(heldEvents, preview\.lastSeq\)/.test(svc), /heldInboundWhere\(freshLink, null\)/.test(svc) && /hasHeldAfter\(heldEvents, remoteLastSeq\)/.test(svc), /canSupersedeByRelinkFloor/.test(svc) && /WooResumeDecision\.WOO_WINS/.test(svc), /sameRelinkParked/.test(svc)
], [true, true, true, true, true])
check('APPLY_INBOUNDهای stale و baseline رویداد قدیمی پاک/اصلاح می‌شوند', [
  /expireApplyInboundApprovals/.test(svc), /EVENT_ALREADY_HANDLED/.test(svc), /wooBaseAfterInboundEvent/.test(svc), /lastWooQty: wooBase/.test(svc), /GROUP_RESUME_SKIPPED_/.test(svc) && /skippedLinks/.test(svc)
], [true, true, true, true, true])
check('Patch ششم late held، echo نامعتبر، گروه امن و unlink مدیریتی را پوشش می‌دهد', [
  /heldEventHash/.test(svc) && /expectedPausedEventHash/.test(page), /MAHAK_ECHO_WITHOUT_OUTBOX/.test(svc), /INBOUND_LOCK_TIMEOUT/.test(svc) && /INBOUND_STOCK_GAP/.test(svc), /canActivateAfterOutbox/.test(svc) && /heldInboundWhere\(freshLink, null\)/.test(svc), /wooLinksUnlink[\s\S]*assertManagerPassword/.test(ipcMain), /d === 'WOO_WINS' \|\| d === 'MAHAK_WINS'/.test(ipcMain)
], [true, true, true, true, true, true])
check('ارسال IN_FLIGHT تازه هنگام تصمیم مدیر block و echo تایم‌اوت lastWooQty را به‌روز می‌کند', [
  /function assertNoFreshInFlight/.test(svc), /STALE_IN_FLIGHT_SUPERSEDED_BY_DECISION/.test(svc), /برای این کالا هنوز ارسال موجودی به سایت در حال انجام است/.test(svc), /status: WooOutboxStatus\.SENT[\s\S]*targetQty: newQty/.test(svc), /lastWooQty: newQty/.test(svc)
], [true, true, true, true, true])
check('Patch بازبینی: DELETE_ZERO، resume hash/count، holder duplicate و claim اتمیک تأیید پوشش داده شده‌اند', [
  /k === 'DELETE_ZERO'[\s\S]*WooLinkStatus\.BROKEN_LOCAL/.test(svc), /heldEvents\.length !== Number\(preview\.pausedEvents\.length\)/.test(svc) && /inboundEventSignature\(heldEvents\) !== String\(preview\.heldEventHash \|\| ''\)/.test(svc), /holderExists = await[\s\S]*holderKey[\s\S]*status: \{ not: WooLinkStatus\.UNLINKED \}/.test(svc), /wooApproval\.updateMany\(\{ where: \{ id, status: WooApprovalStatus\.PENDING \}/.test(svc), /status: \{ in: \[WooInboundStatus\.APPLIED, WooInboundStatus\.APPLIED_ON_RELINK, WooInboundStatus\.SKIPPED_ECHO\] \}/.test(svc)
], [true, true, true, true, true])
check('Patch بازبینی: pull/push/group/settings raceهای کم‌ریسک guard شده‌اند', [
  /INBOUND_LINK_CHANGED_DURING_PULL/.test(svc) && /sameDbTime\(freshLink\.updatedAt, link\.updatedAt\)/.test(svc), /function claimOutboxForSend/.test(svc) && /UPDATE "WooSyncOutbox"/.test(svc) && /NOT EXISTS/.test(svc), /!cfg\.enabled \|\| !cfg\.siteUrl \|\| !cfg\.hasSecret/.test(svc), /برای فعال‌سازی همگام‌سازی، ابتدا کلید اتصال افزونه را ذخیره کنید/.test(svc), /const remote = \(await this\.remoteStock\(\[link\]\)\.catch\(\(\) => \[\]\)\)\[0\]/.test(svc)
], [true, true, true, true, true])
check('Patch بازبینی جدید: reject event، enqueue اتمیک، syncNow مرحله‌ای و catalog کامل‌تر شده‌اند', [
  /decision === 'REJECT'[\s\S]*WooInboundStatus\.SUPERSEDED/.test(svc), /OUTBOX_ENQUEUE_FAILED[\s\S]*throw e/.test(inv), /SYNC_PULL_FAILED/.test(svc) && /SYNC_RECONCILE_FAILED/.test(svc) && /SYNC_PUSH_FAILED/.test(svc), /has_more/.test(svc) && /capped/.test(svc) && /WooCatalogResult/.test(svc) && /catalogNotice/.test(page), /type="password"/.test(page) && /autoComplete="new-password"/.test(page), /INSERT INTO "WooApproval"/.test(svc) && /WHERE NOT EXISTS \(SELECT 1 FROM "WooApproval"/.test(svc)
], [true, true, true, true, true, true])
check('Patch بازبینی دهم: finalize محافظه‌کار، cursor monotonic، WOO_WINS تازه و payload allowlist شده است', [
  /if \(!statusUnchanged\) return/.test(svc) && /retryKind = nextStatus === WooLinkStatus\.ACTIVE \? 'STOCK_PUSH_RETRY_AFTER_IDEMPOTENT' : 'RECONCILE_PUSH'/.test(svc), /ON CONFLICT\("key"\) DO UPDATE SET "value" = CAST\(MAX/.test(svc), /let localStock = await productStock\(variantId, tx as any\)/.test(svc), /PARKED_RETRY_ECHO_SKIPPED/.test(svc), /sanitizeWooInboundRaw/.test(svc) && /payloadJson: json\(sanitizeWooInboundRaw\(raw, payload\)\)/.test(svc), /hasSecret: !!\(await readSecret\(client\)\)/.test(svc), (() => { const i = svc.indexOf('async links()'); const j = svc.indexOf('async linkCreate', i); return i >= 0 && j > i && !svc.slice(i, j).includes('LIMIT 1000') })()
], [true, true, true, true, true, true, true])
check('Patch بازبینی یازدهم: guard اسنپ‌شات reconcile/preview، cursorهای monotonic، saveSettings تراکنشی و HTTPS اجباری', [
  /updateLinkIfSnapshotUnchanged\(link, \{ status: WooLinkStatus\.BROKEN_REMOTE \}\)/.test(svc) && /function updateLinkIfSnapshotUnchanged/.test(svc), /setSettingMonotonic\(WOO_RECONCILE_LAST_ID_KEY/.test(svc) && /async function setSettingMonotonic/.test(svc), /const prevRaw = await rawConfig\(tx\)/.test(svc) && /input\.enabled === undefined/.test(svc), /wooUrlRequiresTls/.test(svc) && /export function wooUrlRequiresTls/.test(read('src/shared/wooSync.ts')), /pauseSeqFloor: link\.pauseSeqFloor \?\? BigInt\(await lastCursor\(client\)\)/.test(svc)
], [true, true, true, true, true])
check('Patch بازبینی چهاردهم: مُهر موفقیت echo، لینکِ منتظرِ همان ارسال را هم فعال می‌کند', [
  /const sentNow = await \(tx as any\)\.wooSyncOutbox\.updateMany/.test(svc), /if \(sentNow\.count > 0 && freshLink && canActivateAfterOutbox\(echo\.kind, freshLink\)\)/.test(svc) && /linkUpdate\.status = WooLinkStatus\.ACTIVE/.test(svc), /ECHO_ACTIVATE_LINK/.test(svc)
], [true, true, true])
check('Patch بازبینی سیزدهم: گپ لحظه‌ی وصل بازیابی می‌شود و resume/resolve گارد اسنپ‌شات دارند', [
  (() => { const i = svc.indexOf('async linkCreate'); const j = i >= 0 ? svc.indexOf('const freshRemote', i) : -1; return i >= 0 && j > i && svc.slice(i, j).includes('pullJournalDrain(5, 200)') })(),
  /INBOUND_DURING_LINK_CREATE/.test(svc) && /status: WooInboundStatus\.SKIPPED_UNMAPPED, seq: \{ gt: initialSeqFloor \}/.test(svc) && /LINK_CREATE_GAP_EVENTS_HELD/.test(svc),
  /if \(!sameDbTime\(fresh\.updatedAt, link\.updatedAt\)\) throw new BusinessError\('این اتصال بعد از پذیرش این درخواست دوباره تغییر وضعیت داده است/.test(svc),
  (() => { const i = svc.indexOf('async resumeProductGroup'); const seg = i >= 0 ? svc.slice(i, i + 12000) : ''; return seg.includes('if (!sameDbTime(fresh.updatedAt, link.updatedAt)) return') })(),
  (() => svc.split('وضعیت اتصال هم‌زمان تغییر کرده است').length - 1)() >= 2
], [true, true, true, true, true])
check('Patch بازبینی دوازدهم (نهایی): اعمال تأیید APPLY_INBOUND فقط روی اسنپ‌شات ثابت لینک انجام می‌شود', [
  /if \(!freshLink \|\| freshLink\.status !== link\.status \|\| !sameDbTime\(freshLink\.updatedAt, link\.updatedAt\)\) throw new BusinessError\('وضعیت اتصال هم‌زمان تغییر کرده است/.test(svc), /if \(freshLink\.status === WooLinkStatus\.ACTIVE\) \{\s*\n\s*await \(tx as any\)\.wooSyncOutbox\.updateMany\(\{ where: \{ linkId: link\.id, status: \{ in: openOutboxStatuses\(\) \} \}, data: \{ status: WooOutboxStatus\.SUPERSEDED, lastError: 'REBASING_AFTER_APPROVED_INBOUND'/.test(svc), /const wooBase = await wooBaseAfterInboundEvent\(tx as any, freshLink, event\)/.test(svc), /APPROVAL_APPLY_INBOUND/.test(svc)
], [true, true, true, true])
check('Patch بازبینی یازدهم: قرارداد پاسخ strict، approval اتمیک، actor و شمارنده‌های صادق', [
  /function requireWooOk/.test(svc) && /requireWooOk\(res, 'journal'\)/.test(svc) && /requireWooOk\(r, 'stock'\)/.test(svc), /res\?\.ok !== true/.test(svc) && /wooStrictIntField\(res\?\.new_qty\)/.test(svc) && /res\.holder_key\) !== String\(link\.holderKey\)/.test(svc), /SUPERSEDED_BY_GROUP_MAHAK_WINS/.test(svc), /async retryParked\(limit = 50, userId: number \| null = null\)/.test(svc) && /resolvedBy: userId \?\? null, resolution: 'BULK_RETRY_APPLIED'/.test(svc) && /retryParked\(100, actor\?\.userId \?\? null\)/.test(ipcMain), /total: Number\(finalStatus\.counts\?\.parkedEvents \|\| 0\)/.test(svc), /r\?\.busy === true/.test(page) && /refreshPanel/.test(page) && /ارسال‌هایی که قبل از قطع در حال اجرا بودند/.test(page) && /setIntervalSeconds\(s\.config\.intervalSeconds\)/.test(page), /client: tx as any, action: WooApprovalAction\.APPLY_INBOUND/.test(svc) && /INBOUND_DURING_HOLD/.test(svc)
], [true, true, true, true, true, true, true])
check('گزارش سود/زیان سایت را فروش یا کسری حساب نمی‌کند؛ CostEngine kind جدا و restore دقیق دارد', [
  /WOO_SYNC_OUT', 'WOO_SYNC_IN', 'WOO_SYNC_ADJUST/.test(profit), /kind: 'EXTERNAL_SYNC'/.test(cost), /restoreExternalSync/.test(cost), /همگام‌سازی سایت: خروج موجودی/.test(movements)
], [true, true, true, true])

console.log('\n— UI و Plugin')
check('صفحه UI صریحاً می‌گوید فقط موجودی sync می‌شود و پیش‌نمایش امضا می‌فرستد', [/فقط موجودی/.test(page), /قیمت، سفارش، مشتری/.test(page), /expectedMahakStock/.test(page), /رمز مدیر/.test(page)], [true, true, true, true])
check('قطع/وصل گروهی رنگ‌ها و سایزهای یک محصول در UI و IPC وجود دارد', [/wooLinksPauseProduct/.test(ipc), /wooLinksResumeProductMahak/.test(ipc), /pauseProductGroup/.test(page), /resumeProductGroupMahak/.test(page)], [true, true, true, true])
check('Plugin تحویل شده و endpointها فقط موجودی/catalog/journal هستند', [
  existsSync(resolve(root, pluginPath)), /Plugin Name: MAHAK Stock Sync/.test(plugin), /mahak-stock\/v1/.test(plugin), /stock\/apply/.test(plugin), /catalog/.test(plugin), /journal/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin idempotent است، meta قدیمی را بعد از apply به‌روز می‌کند و token خام در URL نمی‌گذارد', [
  /previous_record_for_request/.test(plugin), /remember_qty\(\$product, \$target\)/.test(plugin), /mahak_token_notice/.test(plugin), !/mahak_new_token/.test(plugin)
], [true, true, true, true])
check('Plugin read endpointها baseline را mutate نمی‌کنند و خطای apply را sanitize می‌کنند', [
  !/function item\([\s\S]{0,600}remember_qty/.test(plugin), /apply failed request_id=/.test(plugin) && /MAHAK stock apply failed\. Check the WordPress error log/.test(plugin), /Version: 1\.1\.0/.test(plugin), /const VERSION = '1\.1\.0'/.test(plugin)
], [true, true, true, true])
check('Plugin journal failure-safe و idempotency داخل lock دارد', [
  /UNIQUE KEY request_holder/.test(plugin), /OPTION_DB_VERSION/.test(plugin) && /maybe_upgrade/.test(plugin), /previous = self::previous_record_for_request\(\$request_id, \$key, \$expected, \$target\);[\s\S]{0,120}if \(\$previous\) return \$previous;[\s\S]{0,160}\$wpdb->query\('START TRANSACTION'\)/.test(plugin), /strict = false/.test(plugin), /throw new RuntimeException\('MAHAK journal insert failed/.test(plugin), /self::record\([\s\S]*true\);[\s\S]{0,500}wc_update_product_stock/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin upgrade schema را با lock/backoff و تأیید unique index انجام می‌دهد', [
  /_upgrade/.test(plugin) && /GET_LOCK/.test(plugin), /UPDATE \{\$qt\} SET request_id = NULL WHERE request_id = ''/.test(plugin), /request_holder_unique_exists/.test(plugin), /DROP INDEX request_holder/.test(plugin), /UNIQUE KEY request_holder \(request_id\(96\), holder_key\(40\)\)/.test(plugin), /update_option\(self::OPTION_DB_VERSION, self::DB_VERSION, true\)/.test(plugin), /strcasecmp\(\$found, \$table\) === 0/.test(plugin) && /esc_like\(\$table\)/.test(plugin), /mahak_stock_sync_upgrade_backoff/.test(plugin) && /catch \(Throwable \$e\)/.test(plugin), /\$lock_name = 'mahak_' \. substr\(md5\(DB_NAME \. ':' \. \$wpdb->prefix\), 0, 12\) \. '_upgrade'/.test(plugin)
], [true, true, true, true, true, true, true, true, true])

check('Plugin apply موجودی/status را با Woo save می‌کند، target/expected اجباری و قفل DB/CAS خام دارد', [
  /wc_update_product_stock\(\$product, \$target, 'set'\)/.test(plugin), !/wc_update_product_stock\(\$product, \$target, 'set', true\)/.test(plugin), /expected and target integer fields are required/.test(plugin), /GET_LOCK/.test(plugin) && /RELEASE_LOCK/.test(plugin), /FOR UPDATE/.test(plugin) && /START TRANSACTION/.test(plugin), /\$expected_raw = \$stock_row \? \(string\)\$stock_row\['meta_value'\]/.test(plugin), /WHERE meta_id = %d AND meta_value = %s LIMIT 1/.test(plugin) && /MAHAK CAS update failed/.test(plugin), /mahak_stock_lock_timeout[\s\S]{0,120}status' => 503/.test(plugin), /\$commit_ok === false/.test(plugin) && /MAHAK stock apply verification failed/.test(plugin), /CONNECTION_ID/.test(plugin) && /MAHAK journal row missing before commit/.test(plugin)
], [true, true, true, true, true, true, true, true, true, true])
check('Variation با manage_stock والد قابل اتصال/نوشتن نیست و catalog صفحه‌بندی holder-level دارد', [
  /manage_stock_mode/.test(plugin), /mahak_manage_stock_parent/.test(plugin), /get_stock_managed_by_id/.test(plugin), /holder_offset/.test(plugin) && /product_items/.test(plugin), /manageStockMode/.test(svc), /موجودی مشترک والد/.test(page)
], [true, true, true, true, true, true])
check('Refund/order item context و delta اتمیک Woo روی آخرین journal row patch می‌شود', [
  /woocommerce_reduce_order_item_stock/.test(plugin), /woocommerce_restore_order_item_stock/.test(plugin), /stock_change_from_args/.test(plugin), /order_item_id/.test(plugin), /order_item_qty/.test(plugin), /refund_restock/.test(plugin), /created_at >= %s/.test(plugin) && /\$since = gmdate\('Y-m-d H:i:s', time\(\) - 10 \* MINUTE_IN_SECONDS\)/.test(plugin), /allowed_sources/.test(plugin), /'delta_qty'/.test(plugin), /rest_other/.test(plugin), /isset\(\$args\[1\], \$args\[2\]\)/.test(plugin) && /order_restore/.test(plugin), /mahak_settled/.test(plugin)
], [true, true, true, true, true, true, true, true, true, true, true, true])
check('Plugin hookهای stock را با همان lock افزونه سریال می‌کند و context سفارش در shutdown پاک می‌شود', [
  /private static \$hook_locks = array\(\)/.test(plugin), /function stock_lock_name/.test(plugin), /acquire_hook_lock/.test(plugin) && /before_stock[\s\S]*acquire_hook_lock/.test(plugin), /finally \{\s*self::release_hook_lock\(\$id\);\s*\}/.test(plugin), /shutdown_cleanup/.test(plugin) && /clear_order_context/.test(plugin), /\$lock_name = self::stock_lock_name\(\$product->get_id\(\)\)/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin در timeout lock ژورنال را حذف نمی‌کند و flag را به برنامه می‌دهد', [
  /private static \$lock_missed = array\(\)/.test(plugin), /self::\$lock_missed\[\$id\] = true/.test(plugin), !/skip_after/.test(plugin), /'lock_timeout' => true/.test(plugin), /'payload' => \$r\['payload_json'\]/.test(plugin), /'journal_seq' => \$journal_seq/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin patch بازبینی: baseline فقط بعد از record موفق جلو می‌رود و meta hook lock مشترک دارد', [
  /before_post_update[\s\S]*posted_stock_value_for_product\(\$id\)[\s\S]*acquire_hook_lock\(\$id\)[\s\S]*\$posted === null[\s\S]*release_hook_lock\(\$id\)/.test(plugin), /after_stock_meta[\s\S]*acquire_hook_lock\(\$id\)[\s\S]*finally \{\s*self::release_hook_lock\(\$id\);\s*\}/.test(plugin), (() => { const i = plugin.indexOf('$recorded_seq = self::record($pid, $vid, $old, $new, $source, self::$order_id, null, null, $payload)'); const j = plugin.indexOf("update_post_meta($id, '_mahak_stock_last_qty', $new);", i); return i >= 0 && j > i })(), /\$payload = array\('meta_hook' => true\)/.test(plugin) && /\$payload\['lock_timeout'\] = true/.test(plugin), /unset\(self::\$before\[\$id\], self::\$lock_missed\[\$id\]\)/.test(plugin)
], [true, true, true, true, true])
check('Plugin مسیرهای metadata مستقیم، dedupe و suppress محدود به holder را پوشش می‌دهد', [
  /updated_post_meta/.test(plugin) && /added_post_meta/.test(plugin), /after_stock_meta/.test(plugin), /meta_recorded/.test(plugin) && /same_meta_event/.test(plugin), /delete_post_meta\(\$id, '_mahak_stock_last_qty'\)/.test(plugin) && /after_stock_meta[\s\S]*delete_post_meta\(\$id, '_mahak_stock_last_qty'\)/.test(plugin), /suppress_ids/.test(plugin) && /is_suppressed/.test(plugin), /stock_holder_parts/.test(plugin), /mahak_fractional_stock/.test(plugin), /clean_product_caches/.test(plugin)
], [true, true, true, true, true, true, true, true])
check('Plugin parent-managed/قبل‌از‌meta/request_id leak را guard می‌کند', [
  /before_stock[\s\S]*manage_stock_mode\(\$product\) !== 'yes'/.test(plugin), /after_stock[\s\S]*manage_stock_mode\(\$product\) !== 'yes'/.test(plugin), /after_stock_meta[\s\S]*array_key_exists\(\$id, self::\$before\)/.test(plugin), /self::record\(\$pid, \$vid, \$old, \$new, \$source, self::\$order_id, null, null, \$payload\)/.test(plugin), /\$payload = array\('meta_hook' => true\)/.test(plugin) && /if \(isset\(self::\$lock_missed\[\$id\]\)\) \$payload\['lock_timeout'\] = true/.test(plugin), /substr\(\$s, 0, 63\) \. '-' \. md5\(\$s\)/.test(plugin), /settle_cutoff = gmdate\('Y-m-d H:i:s', time\(\) - 2\)/.test(plugin)
], [true, true, true, true, true, true, true])
check('Plugin patch یازدهم: receipt تغییر-صفر واقعی، tagging دقیق سفارش، رنج int و guardهای endpoint', [
  /Version: 1\.1\.0/.test(plugin) && /const VERSION = '1\.1\.0';/.test(plugin), /if \(\$new === null \|\| \(!\$strict && \$old !== null && \$old === \$new\)\) return true;/.test(plugin) && /\$seq = \(int\)\$wpdb->insert_id;/.test(plugin), /\$last_event_seq/.test(plugin) && /WHERE seq = %d AND order_item_id IS NULL LIMIT 1/.test(plugin), /mahak_stock_query_failed/.test(plugin) && /Too many holders/.test(plugin) && /self::manage_stock_mode\(\$product\) === 'parent'\) continue;/.test(plugin), /after_seq must be a non-negative integer/.test(plugin) && /catalog page is outside the supported range/.test(plugin), /1000000000/.test(plugin) && /A JSON object body is required/.test(plugin) && /request_id must be a string identifier/.test(plugin) && /!is_int\(\$holder\[\$f\]\)/.test(plugin)
], [true, true, true, true, true, true])
check('Plugin patch دهم: holder mismatch، idempotency payload، noop receipt و journal error guard شده‌اند', [
  /if \(\$input_product_id && \$input_product_id !== absint\(\$product_id\)\) return null;/.test(plugin) && /if \(\$input_key !== '' && \$input_key !== \$canonical\) return null;/.test(plugin), /mahak_idempotency_payload_mismatch/.test(plugin) && /previous_record_for_request\(\$request_id, \$holder_key, \$expected = null, \$target = null\)/.test(plugin), /self::record\(\$pid, \$vid, \$current, \$target, 'mahak_apply'[\s\S]*array\('expected' => \$expected, 'target' => \$target\)[\s\S]*true\);[\s\S]*return array\('ok' => true[\s\S]*'noop' => true\)/.test(plugin), /mahak_journal_query_failed/.test(plugin) && /\$rows === null && !empty\(\$wpdb->last_error\)/.test(plugin), /self::manage_stock_mode\(\$v\) !== 'parent'/.test(plugin)
], [true, true, true, true, true])
check('Plugin قیمت/مشتری را در خروجی نمی‌دهد و فقط stock_quantity را expose می‌کند', [
  /stock_quantity/.test(plugin), !/_price|regular_price|sale_price|billing|shipping|customer_email/i.test(plugin), /old.*new/.test(plugin) && /return;/.test(plugin)
], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
