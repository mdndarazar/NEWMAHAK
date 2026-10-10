/**
 * MAHAK ↔ WooCommerce Stock Sync
 *
 * مرز قطعی: فقط عدد موجودی (`stock_quantity`) sync می‌شود. هیچ قیمت، مبلغ سفارش،
 * مشتری، آدرس، مالیات یا گزارش فروش سایت وارد برنامه نمی‌شود و هیچ فیلدی جز
 * موجودی روی سایت نوشته نمی‌شود.
 */
import type { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '../db/client'
import { TX_OPTIONS } from '../db/tx'
import { BusinessError } from '../errors'
import { audit } from './AuditService'
import { openSecret, sealSecret } from './PanelVault'
import { AuditAction, StockReason, StockState } from '@shared/enums'
import {
  WOO_SYNC_CURSOR_KEY,
  WOO_SYNC_SECRET_KEY,
  WOO_SYNC_SETTING_KEY,
  WooApprovalAction,
  WooApprovalStatus,
  WooInboundStatus,
  WooLinkStatus,
  WooOutboxStatus,
  WooResumeDecision,
  normalizeWooBaseUrl,
  wooHolderKey,
  wooSafeInt,
  wooStockReason,
  wooUrlRequiresTls,
  type WooApprovalRow,
  type WooCatalogResult,
  type WooLinkRow,
  type WooResumePreviewEvent,
  type WooStatusView,
  type WooSyncSafeConfig
} from '@shared/wooSync'

const db = () => prisma as any
const REQUEST_TIMEOUT_MS = 20_000
const IN_FLIGHT_STALE_MS = 5 * 60_000
const MAX_OUTBOX_ATTEMPTS = 8
const WOO_RECONCILE_LAST_ID_KEY = 'wooSync.reconcileLastLinkId'
const LOOP_FUSE_WINDOW_MS = 15 * 60_000
const LOOP_FUSE_MAX_OUTBOX = 6

function publishedQty(raw: unknown): number {
  // WooCommerce نباید عدد منفی بگیرد؛ موجودی داخلی MAHAK می‌تواند منفی باشد، اما عدد منتشرشده روی سایت حداقل صفر است.
  return Math.max(0, wooSafeInt(raw))
}

function wooNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'boolean') return null
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : null
  const s = String(raw).trim()
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

function remoteStockUsable(r: any): boolean {
  return !!r && r.manageStock === true && r.stockQuantity !== null && r.stockQuantity !== undefined
}

function isReconcileOutboxKind(kind: unknown): boolean {
  return ['RECONCILE_PUSH', 'STOCK_PUSH_REBASED', 'STOCK_PUSH_RETRY_AFTER_IDEMPOTENT', 'DELETE_ZERO'].includes(String(kind || ''))
}

function canSendOutboxForLink(kind: unknown, link: any): boolean {
  if (!link) return false
  const k = String(kind || '')
  if (link.status === WooLinkStatus.ACTIVE) return true
  if (k === 'DELETE_ZERO') return link.status === WooLinkStatus.BROKEN_LOCAL
  return k === 'RECONCILE_PUSH' && [WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT, WooLinkStatus.BROKEN_LOCAL].includes(String(link.status) as any)
}

function canActivateAfterOutbox(kind: unknown, link: any): boolean {
  return String(kind || '') === 'RECONCILE_PUSH' &&
    link?.status === WooLinkStatus.PAUSED &&
    ['APPROVED_RECONCILE_PUSH', 'GROUP_MAHAK_WINS'].includes(String(link?.pauseReason ?? ''))
}

function openOutboxStatuses(): string[] {
  // عملیات مدیریتی نباید ردیف در حال ارسال را زیر پای worker عوض کند؛ نتیجه‌ی همان ارسال ثبت می‌شود و وضعیت لینک دوباره از DB خوانده می‌شود.
  return [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT, WooOutboxStatus.DEAD]
}

class WooHttpError extends BusinessError {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'WooHttpError'
    this.status = status
    this.code = code
  }
}

interface StoredConfig {
  enabled?: boolean
  siteUrl?: string
  autoSync?: boolean
  intervalSeconds?: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson(raw: unknown): any {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return JSON.stringify(String(value))
  }
}

function parseJsonValue(raw: unknown): any {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function sanitizeWooPluginPayload(payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const out: any = {}
  for (const k of ['lock_timeout', 'meta_hook', 'order_item_qty']) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k]
  }
  return Object.keys(out).length ? out : null
}

function sanitizeWooInboundRaw(raw: any, payload: any): any {
  return {
    seq: raw?.seq ?? null,
    event_uuid: raw?.event_uuid ?? raw?.uuid ?? null,
    holder_key: raw?.holder_key ?? raw?.holderKey ?? null,
    product_id: raw?.product_id ?? raw?.productId ?? null,
    variation_id: raw?.variation_id ?? raw?.variationId ?? null,
    old_qty: raw?.old_qty ?? null,
    new_qty: raw?.new_qty ?? raw?.stock_quantity ?? null,
    delta: raw?.delta ?? null,
    source: raw?.source ?? null,
    order_id: raw?.order_id ?? null,
    order_item_id: raw?.order_item_id ?? null,
    request_id: raw?.request_id ?? null,
    created_at: raw?.created_at ?? raw?.createdAt ?? null,
    payload: sanitizeWooPluginPayload(payload)
  }
}

function int(raw: unknown, label: string, opts: { positive?: boolean; allowZero?: boolean } = {}): number {
  let n: number | null = null
  if (typeof raw === 'number') n = Number.isSafeInteger(raw) ? raw : null
  else {
    const s = String(raw ?? '').trim()
    if (/^-?\d+$/.test(s)) {
      const parsed = Number(s)
      n = Number.isSafeInteger(parsed) ? parsed : null
    }
  }
  const ok = n !== null && (opts.positive ? n > 0 : opts.allowZero ? n >= 0 : true)
  if (!ok) throw new BusinessError(`${label} نامعتبر است؛ عدد صحیح لازم است.`)
  return n
}

function asDateString(d: unknown): string | null {
  if (!d) return null
  try {
    return new Date(d as any).toISOString()
  } catch {
    return null
  }
}

function sameDbTime(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  const at = new Date(a as any).getTime()
  const bt = new Date(b as any).getTime()
  return Number.isFinite(at) && Number.isFinite(bt) && at === bt
}

function isWooOrderPausedEvent(e: { source?: unknown; orderId?: unknown }): boolean {
  // در زمان وصل دوباره، فقط اثر واقعی سفارش سایت دوباره اعمال می‌شود.
  // ویرایش دستی/ادمین سایت حتی اگر در ژورنال مانده باشد خودکار اعمال نمی‌شود تا overwrite کورکورانه رخ ندهد.
  return /^(order|order_reduce|order_restore|refund_restock)$/.test(String(e.source ?? '').toLowerCase()) && String(e.orderId ?? '').trim() !== ''
}

function isWooRestoreSource(source: unknown): boolean {
  return /^(order_restore|refund_restock)$/.test(String(source ?? '').toLowerCase())
}

function heldInboundWhere(link: any, maxSeq?: number | null): any {
  const where: any = { linkId: link.id, status: { in: [WooInboundStatus.SKIPPED_PAUSED, WooInboundStatus.PARKED] } }
  if (maxSeq != null) where.seq = { lte: BigInt(maxSeq) }
  return where
}

function inboundEventSignature(events: Array<{ id?: unknown; seq?: unknown; status?: unknown; relinkId?: unknown }>): string {
  const body = events
    .map((e) => `${Number(e.id || 0)}:${e.seq == null ? '' : String(e.seq)}:${String(e.status ?? '')}:${String(e.relinkId ?? '')}`)
    .sort()
    .join('|')
  return createHash('sha256').update(body).digest('hex')
}

function hasHeldAfter(events: Array<{ seq?: unknown }>, maxSeq?: number | null): boolean {
  if (maxSeq == null) return false
  return events.some((e) => e.seq != null && Number(e.seq) > Number(maxSeq))
}

function canSupersedeByRelinkFloor(link: any, event: { source?: unknown; orderId?: unknown; delta?: unknown }): boolean {
  if (link?.resumeDecision === WooResumeDecision.WOO_WINS) return true
  return !isWooOrderPausedEvent(event) || Number(event.delta || 0) === 0
}

async function expireApplyInboundApprovals(input: { client: any; linkId: number; eventIds: number[]; userId?: number | null; resolution: string; note: string }) {
  const eventIds = Array.from(new Set(input.eventIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))))
  if (!eventIds.length) return
  await input.client.wooApproval.updateMany({
    where: { linkId: input.linkId, action: WooApprovalAction.APPLY_INBOUND, status: WooApprovalStatus.PENDING, sourceType: 'WooInboundEvent', sourceId: { in: eventIds } },
    data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: input.resolution, resolutionNote: input.note }
  })
}

async function supersedeStaleInFlight(client: any, linkId: number, lastError: string): Promise<void> {
  const staleBefore = new Date(Date.now() - IN_FLIGHT_STALE_MS)
  await client.wooSyncOutbox.updateMany({
    where: { linkId, status: WooOutboxStatus.IN_FLIGHT, updatedAt: { lt: staleBefore } },
    data: { status: WooOutboxStatus.SUPERSEDED, lastError, updatedAt: new Date() }
  }).catch(() => null)
}

async function assertNoFreshInFlight(client: any, linkId: number): Promise<void> {
  const staleBefore = new Date(Date.now() - IN_FLIGHT_STALE_MS)
  await client.wooSyncOutbox.updateMany({
    where: { linkId, status: WooOutboxStatus.IN_FLIGHT, updatedAt: { lt: staleBefore } },
    data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'STALE_IN_FLIGHT_SUPERSEDED_BY_DECISION', updatedAt: new Date() }
  })
  const fresh = await client.wooSyncOutbox.count({ where: { linkId, status: WooOutboxStatus.IN_FLIGHT, updatedAt: { gte: staleBefore } } })
  if (fresh > 0) throw new BusinessError('برای این کالا هنوز ارسال موجودی به سایت در حال انجام است؛ چند ثانیه بعد دوباره تصمیم مدیر را اعمال کنید.')
}

async function claimOutboxForSend(row: any): Promise<boolean> {
  // این claim باید تک‌عبارتی باشد: check جداگانه‌ی IN_FLIGHT و سپس update زیر اجرای هم‌زمان
  // دو worker می‌تواند دو ارسال موازی برای یک link بسازد. SQLite هر UPDATE را اتمیک و writer-serialized اجرا می‌کند.
  const changed = await (prisma as any).$executeRawUnsafe(
    `UPDATE "WooSyncOutbox"
       SET "status" = ?, "attemptCount" = "attemptCount" + 1, "updatedAt" = ?
     WHERE "id" = ?
       AND "linkId" = ?
       AND "status" IN (?, ?)
       AND "attemptCount" < ?
       AND NOT EXISTS (
         SELECT 1 FROM "WooSyncOutbox" AS inflight
          WHERE inflight."linkId" = ?
            AND inflight."status" = ?
            AND inflight."id" <> ?
       )`,
    WooOutboxStatus.IN_FLIGHT,
    new Date(),
    Number(row.id),
    Number(row.linkId),
    WooOutboxStatus.PENDING,
    WooOutboxStatus.FAILED,
    MAX_OUTBOX_ATTEMPTS,
    Number(row.linkId),
    WooOutboxStatus.IN_FLIGHT,
    Number(row.id)
  )
  return Number(changed || 0) > 0
}

async function wooBaseAfterInboundEvent(client: any, link: any, event: any): Promise<number> {
  const freshLink = await client.wooProductLink.findUnique({ where: { id: link.id } }).catch(() => null)
  const currentBase = wooSafeInt(freshLink?.lastWooQty ?? link.lastWooQty ?? event.newQty)
  if (event?.seq == null) return currentBase
  const latest = await client.wooInboundEvent.findFirst({
    where: {
      holderKey: link.holderKey,
      seq: { gt: BigInt(event.seq) },
      status: { in: [WooInboundStatus.APPLIED, WooInboundStatus.APPLIED_ON_RELINK, WooInboundStatus.SKIPPED_ECHO] }
    },
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    select: { seq: true, newQty: true }
  }).catch(() => null)
  return latest?.seq != null ? wooSafeInt(latest.newQty) : wooSafeInt(event.newQty)
}

async function remainingRestoreAllowance(input: { client: any; variantId: number; orderId: unknown }): Promise<number> {
  const orderId = String(input.orderId ?? '').trim()
  if (!orderId) return 0
  const rows = await input.client.wooInboundEvent.findMany({
    where: {
      variantId: input.variantId,
      orderId,
      status: { in: [WooInboundStatus.APPLIED, WooInboundStatus.APPLIED_ON_RELINK] }
    },
    select: { delta: true, source: true }
  })
  const sold = rows.filter((r: any) => Number(r.delta || 0) < 0).reduce((sum: number, r: any) => sum + Math.abs(Number(r.delta || 0)), 0)
  const restored = rows.filter((r: any) => Number(r.delta || 0) > 0 && isWooRestoreSource(r.source)).reduce((sum: number, r: any) => sum + Number(r.delta || 0), 0)
  return Math.max(0, sold - restored)
}

async function readSetting(key: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string | null> {
  const row = await (client as any).setting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function writeSetting(key: string, value: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  await client.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

async function rawConfig(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<StoredConfig> {
  return safeJson(await readSetting(WOO_SYNC_SETTING_KEY, client)) ?? {}
}

async function readSecret(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string | null> {
  const blob = await readSetting(WOO_SYNC_SECRET_KEY, client)
  return openSecret(blob)
}

async function lastCursor(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  return Math.max(0, Math.round(Number((await readSetting(WOO_SYNC_CURSOR_KEY, client)) ?? 0) || 0))
}

// cursorهای پیشرفت (ژورنال سایت و چرخه‌ی reconcile) در اجرای هم‌زمان هرگز به عقب برنمی‌گردند.
async function setSettingMonotonic(key: string, seq: number): Promise<void> {
  const next = String(Math.max(0, Math.round(Number(seq) || 0)))
  await (prisma as any).$executeRawUnsafe(
    `INSERT INTO "Setting" ("key", "value") VALUES (?, ?)
     ON CONFLICT("key") DO UPDATE SET "value" = CAST(MAX(CAST("value" AS INTEGER), CAST(excluded."value" AS INTEGER)) AS TEXT)`,
    key,
    next
  )
}

async function setCursor(seq: number): Promise<void> {
  await setSettingMonotonic(WOO_SYNC_CURSOR_KEY, seq)
}

async function safeConfig(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<WooSyncSafeConfig> {
  const c = await rawConfig(client)
  return {
    enabled: c.enabled === true,
    siteUrl: normalizeWooBaseUrl(c.siteUrl),
    autoSync: c.autoSync !== false,
    intervalSeconds: Math.min(3600, Math.max(30, Math.round(Number(c.intervalSeconds) || 120))),
    hasSecret: !!(await readSecret(client)),
    lastCursor: await lastCursor(client)
  }
}

async function fullConfig(): Promise<WooSyncSafeConfig & { secret: string }> {
  const c = await safeConfig()
  const secret = await readSecret()
  if (!c.siteUrl) throw new BusinessError('آدرس سایت WooCommerce تنظیم نشده است.')
  // کلید اتصال روی HTTP خام قابل شنود است؛ حتی اگر تنظیم قدیمی http باشد، هیچ درخواستی با کلید ارسال نمی‌شود.
  if (wooUrlRequiresTls(c.siteUrl)) throw new BusinessError('آدرس سایت باید با https:// امن باشد؛ ارسال کلید اتصال روی HTTP ممنوع است. فقط برای تست روی همین کامپیوتر (127.0.0.1/localhost) می‌توان از http استفاده کرد.')
  if (!secret) throw new BusinessError('کلید اتصال افزونه تنظیم نشده یا روی این دستگاه قابل خواندن نیست.')
  return { ...c, secret }
}

function endpoint(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/wp-json/mahak-stock/v1${path.startsWith('/') ? path : '/' + path}`
}

async function wooRequest<T>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const cfg = await fullConfig()
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint(cfg.siteUrl, path), {
      method: opts.method ?? (opts.body == null ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        'X-Mahak-Token': cfg.secret
      },
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: ac.signal
    } as any)
    const text = await res.text()
    const data = safeJson(text) ?? { raw: text }
    if (!res.ok) {
      const msg = String(data?.message ?? data?.error ?? text ?? '').trim()
      const code = data?.code == null ? null : String(data.code)
      throw new WooHttpError(res.status, code, `پاسخ سایت ناموفق بود (${res.status}${code ? `/${code}` : ''}): ${msg || 'خطای نامشخص'}`)
    }
    return data as T
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new BusinessError('ارتباط با سایت در مهلت مقرر پاسخ نداد؛ نتیجه‌ی نوشتن موجودی نامعلوم است و سیستم با کلید idempotency دوباره امن تلاش می‌کند.')
    throw e
  } finally {
    clearTimeout(t)
  }
}

// پاسخ 2xxِ ناقص (صفحه‌ی HTML پروکسی، {} یا JSON نیمه) نباید به‌عنوان موفقیت قرارداد مصرف شود.
function requireWooOk(r: any, endpointName: string): void {
  if (!r || typeof r !== 'object' || r.ok !== true) throw new BusinessError(`پاسخ ${endpointName} سایت ناقص یا نامعتبر است؛ برای جلوگیری از تصمیم اشتباه، دوباره امن تلاش می‌شود.`)
}

function wooStrictIntField(x: unknown): number | null {
  if (typeof x === 'number') return Number.isSafeInteger(x) ? x : null
  if (typeof x !== 'string') return null
  const s = x.trim()
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

// mutationهای بعد از خوان شبکه (reconcile/preview) فقط وقتی مجازند لینک را تغییر دهند که لینک
// از snapshot خوانده‌شده عوض نشده باشد؛ وگرنه unlink/pause هم‌زمان با اسنپ‌شات کهنه overwrite می‌شود.
async function updateLinkIfSnapshotUnchanged(link: any, data: any, extra?: (tx: any) => Promise<void>): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
    if (!fresh || fresh.status !== link.status || !sameDbTime(fresh.updatedAt, link.updatedAt)) return false
    await (tx as any).wooProductLink.update({ where: { id: link.id }, data })
    if (extra) await extra(tx)
    return true
  }, TX_OPTIONS).catch(() => false)
}

async function log(action: string, message: string, input: { level?: 'INFO' | 'WARN' | 'ERROR'; linkId?: number | null; variantId?: number | null; payload?: unknown } = {}) {
  try {
    await db().wooSyncLog.create({
      data: {
        action,
        level: input.level ?? 'INFO',
        linkId: input.linkId ?? null,
        variantId: input.variantId ?? null,
        message,
        payloadJson: input.payload == null ? null : json(input.payload)
      }
    })
  } catch (e) {
    console.error('[wooSync] log failed', e)
  }
}

async function ensureApproval(input: {
  client?: any
  action: string
  linkId?: number | null
  variantId?: number | null
  holderKey?: string | null
  sourceType?: string | null
  sourceId?: number | null
  reason: string
  title: string
  message: string
  payload?: unknown
}): Promise<any | null> {
  const client = input.client ?? db()
  const where: any = { status: WooApprovalStatus.PENDING, action: input.action, reason: input.reason }
  const whereSql = ['"status" = ?', '"action" = ?', '"reason" = ?']
  const whereParams: unknown[] = [WooApprovalStatus.PENDING, input.action, input.reason]
  if (input.linkId != null) {
    where.linkId = input.linkId
    whereSql.push('"linkId" = ?')
    whereParams.push(Number(input.linkId))
  }
  if (input.sourceType && input.sourceId != null) {
    where.sourceType = input.sourceType
    where.sourceId = input.sourceId
    whereSql.push('"sourceType" = ?', '"sourceId" = ?')
    whereParams.push(input.sourceType, Number(input.sourceId))
  }
  const payloadJson = input.payload == null ? null : json(input.payload)
  if (typeof client.$executeRawUnsafe === 'function') {
    await client.$executeRawUnsafe(
      `INSERT INTO "WooApproval" ("action", "status", "linkId", "variantId", "holderKey", "sourceType", "sourceId", "reason", "title", "message", "payloadJson")
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM "WooApproval" WHERE ${whereSql.join(' AND ')})`,
      input.action,
      WooApprovalStatus.PENDING,
      input.linkId ?? null,
      input.variantId ?? null,
      input.holderKey ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.reason,
      input.title,
      input.message,
      payloadJson,
      ...whereParams
    )
    return client.wooApproval.findFirst({ where, orderBy: { id: 'desc' } }).catch(() => null)
  }
  const existing = await client.wooApproval.findFirst({ where }).catch(() => null)
  if (existing) return existing
  return client.wooApproval.create({
    data: {
      action: input.action,
      status: WooApprovalStatus.PENDING,
      linkId: input.linkId ?? null,
      variantId: input.variantId ?? null,
      holderKey: input.holderKey ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      reason: input.reason,
      title: input.title,
      message: input.message,
      payloadJson
    }
  })
}

async function freezeLinkForApproval(client: any, link: any, reason: string, title: string, message: string, payload?: unknown): Promise<void> {
  await client.wooProductLink.update({
    where: { id: link.id },
    // cursor باید از همان snapshot تراکنش خوانده شود، نه client عمومی بیرون تراکنش.
    data: { status: WooLinkStatus.FROZEN, pauseReason: reason, pausedAt: new Date(), pauseSeqFloor: link.pauseSeqFloor ?? BigInt(await lastCursor(client)) }
  })
  await ensureApproval({ client, action: WooApprovalAction.LOOP_FUSE, linkId: link.id, variantId: link.variantId, holderKey: link.holderKey, reason, title, message, payload })
}

async function loopFuseTripped(client: any, link: any): Promise<boolean> {
  const since = new Date(Date.now() - LOOP_FUSE_WINDOW_MS)
  const count = await client.wooSyncOutbox.count({ where: { linkId: link.id, createdAt: { gte: since }, movementId: null } }).catch(() => 0)
  if (count < LOOP_FUSE_MAX_OUTBOX) return false
  await freezeLinkForApproval(
    client,
    link,
    'LOOP_FUSE',
    'توقف خودکار حلقه همگام‌سازی',
    'در مدت کوتاه چندین ارسال برای همین کالا ساخته شد. برای جلوگیری از رفت‌وبرگشت بی‌پایان موجودی، لینک متوقف شد و تصمیم مدیر لازم است.',
    { recentOutboxCount: count, windowMinutes: LOOP_FUSE_WINDOW_MS / 60_000 }
  )
  return true
}

async function activeLinkForVariant(client: any, variantId: number): Promise<any | null> {
  return client.wooProductLink.findFirst({ where: { variantId, status: { not: WooLinkStatus.UNLINKED } } })
}

async function linkById(id: number): Promise<any> {
  const row = await db().wooProductLink.findUnique({ where: { id } })
  if (!row || row.status === WooLinkStatus.UNLINKED) throw new BusinessError('اتصال سایت برای این کالا پیدا نشد.')
  return row
}

async function productStock(variantId: number, client: any = prisma): Promise<number> {
  const v = await client.productVariant.findUnique({ where: { id: variantId }, select: { stock: true } })
  if (!v) throw new BusinessError('کالای متناظر در فروشگاه پیدا نشد.')
  return Number(v.stock ?? 0)
}

async function createOutbox(input: {
  client?: any
  link: any
  variantId: number
  movementId?: number | null
  kind?: string
  targetQty: number
  expectedWooQty?: number | null
  skipLoopFuse?: boolean
}) {
  const client = input.client ?? db()
  await supersedeStaleInFlight(client, input.link.id, 'STALE_IN_FLIGHT_SUPERSEDED_BY_NEW_TARGET')
  if (!input.skipLoopFuse && input.kind !== 'DELETE_ZERO' && await loopFuseTripped(client, input.link)) return null
  await client.wooSyncOutbox.updateMany({
    where: { linkId: input.link.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT] } },
    data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'NEWER_STOCK_TARGET' }
  })
  return client.wooSyncOutbox.create({
    data: {
      linkId: input.link.id,
      variantId: input.variantId,
      movementId: input.movementId ?? null,
      kind: input.kind ?? 'STOCK_PUSH',
      expectedWooQty: input.expectedWooQty == null ? (input.link.lastWooQty == null ? null : wooSafeInt(input.link.lastWooQty)) : wooSafeInt(input.expectedWooQty),
      targetQty: publishedQty(input.targetQty),
      status: WooOutboxStatus.PENDING,
      idempotencyKey: `mahak:${input.link.id}:${input.movementId ?? 'manual'}:${randomUUID()}`
    }
  })
}

/** صدا زده‌شده از InventoryService در همان تراکنش: فقط برای reasonهای داخلی فروشگاه outbox می‌سازد. */
export async function enqueueWooForMovement(
  input: { movementId: number; variantId: number; reason: string; targetQty: number },
  tx: Prisma.TransactionClient
): Promise<void> {
  if (String(input.reason).startsWith('WOO_SYNC_')) return
  const client = tx as any
  const cfg = await safeConfig(client)
  if (!cfg.enabled || !cfg.siteUrl || !cfg.hasSecret) return
  const links = await client.wooProductLink.findMany({
    where: { variantId: input.variantId, status: WooLinkStatus.ACTIVE }
  })
  for (const link of links) {
    await createOutbox({ client, link, variantId: input.variantId, movementId: input.movementId, targetQty: publishedQty(input.targetQty) })
  }
}

/** حذف نرم کالا: سایت باید برای لینک فعال عدد ۰ بگیرد، اما لینک دیگر عادی sync نشود. */
export async function markWooLinksBrokenLocal(variantIds: number[], tx: Prisma.TransactionClient): Promise<void> {
  const ids = (variantIds ?? []).map((x) => Math.round(Number(x))).filter((x) => Number.isSafeInteger(x) && x > 0)
  if (!ids.length) return
  const client = tx as any
  const links = await client.wooProductLink.findMany({ where: { variantId: { in: ids }, status: { not: WooLinkStatus.UNLINKED } } })
  for (const link of links) {
    if (link.status === WooLinkStatus.ACTIVE) {
      await createOutbox({ client, link, variantId: link.variantId, kind: 'DELETE_ZERO', targetQty: 0, expectedWooQty: link.lastWooQty })
    }
    await client.wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.BROKEN_LOCAL, pauseReason: 'LOCAL_VARIANT_DELETED', pausedAt: new Date() } })
  }
}


async function applyWooDelta(input: {
  eventId?: number | null
  variantId: number
  delta: number
  reason?: 'WOO_SYNC_OUT' | 'WOO_SYNC_IN' | 'WOO_SYNC_ADJUST'
  note?: string
  state?: string
  tx?: Prisma.TransactionClient
}): Promise<{ movementId: number | null; stock: number }> {
  const run = async (client: any) => {
    const before = await productStock(input.variantId, client)
    const delta = Math.round(Number(input.delta) || 0)
    if (!delta) return { movementId: null, stock: before }
    const movement = await client.stockMovement.create({
      data: {
        variantId: input.variantId,
        delta,
        reason: input.reason ?? wooStockReason(delta),
        state: input.state ?? StockState.FINAL,
        refType: input.eventId ? 'WooInboundEvent' : 'WooSync',
        refId: input.eventId ?? null,
        note: input.note ?? 'همگام‌سازی موجودی سایت'
      }
    })
    await client.productVariant.update({ where: { id: input.variantId }, data: { stock: { increment: delta } } })
    return { movementId: Number(movement.id), stock: before + delta }
  }
  if (input.tx) return run(input.tx as any)
  return prisma.$transaction(run, TX_OPTIONS)
}

export const wooSyncService = {
  async status(): Promise<WooStatusView> {
    const config = await safeConfig()
    const [activeLinks, pausedLinks, conflictLinks, pendingOutbox, failedOutbox, pausedEvents, parkedEvents, pendingApprovals, lastLogs] = await Promise.all([
      db().wooProductLink.count({ where: { status: WooLinkStatus.ACTIVE } }).catch(() => 0),
      db().wooProductLink.count({ where: { status: WooLinkStatus.PAUSED } }).catch(() => 0),
      db().wooProductLink.count({ where: { status: { in: [WooLinkStatus.CONFLICT, WooLinkStatus.FROZEN] } } }).catch(() => 0),
      db().wooSyncOutbox.count({ where: { status: WooOutboxStatus.PENDING } }).catch(() => 0),
      db().wooSyncOutbox.count({ where: { status: { in: [WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT, WooOutboxStatus.DEAD] } } }).catch(() => 0),
      db().wooInboundEvent.count({ where: { status: WooInboundStatus.SKIPPED_PAUSED } }).catch(() => 0),
      db().wooInboundEvent.count({ where: { status: WooInboundStatus.PARKED } }).catch(() => 0),
      db().wooApproval.count({ where: { status: WooApprovalStatus.PENDING } }).catch(() => 0),
      db().wooSyncLog.findMany({ orderBy: { id: 'desc' }, take: 10 }).catch(() => [])
    ])
    return {
      config,
      counts: { activeLinks, pausedLinks, conflictLinks, pendingOutbox, failedOutbox, pausedEvents, parkedEvents, pendingApprovals },
      lastLogs: (lastLogs ?? []).map((l: any) => ({ id: l.id, at: asDateString(l.at) ?? '', level: l.level, action: l.action, message: l.message }))
    }
  },

  async saveSettings(input: { siteUrl?: string; token?: string; enabled?: boolean; autoSync?: boolean; intervalSeconds?: number; userId?: number | null }) {
    const incomingToken = String(input.token ?? '').trim()
    let saved: { next: StoredConfig; prev: WooSyncSafeConfig } | null = null
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // read/merge/write داخل همان تراکنش انجام می‌شود تا فراخوانی هم‌زمان دو نسخه، تغییر همدیگر را بازنویسی نکند.
      const prevRaw = await rawConfig(tx)
      const prevHasSecret = !!(await readSetting(WOO_SYNC_SECRET_KEY, tx))
      const siteUrl = normalizeWooBaseUrl(input.siteUrl === undefined ? prevRaw.siteUrl : input.siteUrl)
      // فیلد حذف‌شده (undefined) با مقدار صریح false فرق دارد؛ حذف یعنی «دست‌نخورده بماند».
      const enabled = input.enabled === undefined ? prevRaw.enabled === true : input.enabled === true
      const autoSync = input.autoSync === undefined ? prevRaw.autoSync !== false : input.autoSync !== false
      const intervalSeconds = Math.min(3600, Math.max(30, Math.round(Number(input.intervalSeconds === undefined ? prevRaw.intervalSeconds : input.intervalSeconds) || 120)))
      if (enabled === true && !siteUrl) throw new BusinessError('برای فعال‌سازی همگام‌سازی، آدرس سایت لازم است.')
      if (siteUrl && wooUrlRequiresTls(siteUrl)) throw new BusinessError('آدرس سایت باید با https:// امن باشد؛ ارسال کلید اتصال روی HTTP ممنوع است. فقط برای تست روی همین کامپیوتر (127.0.0.1/localhost) می‌توان از http استفاده کرد.')
      if (enabled === true && !incomingToken && !prevHasSecret) throw new BusinessError('برای فعال‌سازی همگام‌سازی، ابتدا کلید اتصال افزونه را ذخیره کنید.')
      const next: StoredConfig = { siteUrl, enabled, autoSync, intervalSeconds }
      await writeSetting(WOO_SYNC_SETTING_KEY, json(next), tx)
      if (incomingToken) {
        const sealed = sealSecret(incomingToken)
        if (!sealed) throw new BusinessError('ذخیره‌ی امن کلید اتصال ممکن نشد؛ تنظیمات ذخیره نشد.')
        await writeSetting(WOO_SYNC_SECRET_KEY, sealed, tx)
      }
      await audit(tx, {
        action: AuditAction.WOO_SYNC_SETTINGS,
        entity: 'WooSync',
        entityId: 0,
        userId: input.userId ?? null,
        before: json({ ...prevRaw, hasSecret: prevHasSecret }),
        after: json({ ...next, hasSecret: incomingToken ? true : prevHasSecret }),
        note: 'تغییر تنظیمات همگام‌سازی موجودی سایت (فقط موجودی)'
      })
      saved = { next, prev: { enabled: prevRaw.enabled === true, siteUrl: normalizeWooBaseUrl(prevRaw.siteUrl), autoSync: prevRaw.autoSync !== false, intervalSeconds: Math.min(3600, Math.max(30, Math.round(Number(prevRaw.intervalSeconds) || 120))), hasSecret: prevHasSecret, lastCursor: await lastCursor(tx) } }
    }, TX_OPTIONS)
    const out = saved!
    await log('SETTINGS', 'تنظیمات اتصال سایت ذخیره شد', { payload: { siteUrl: out.next.siteUrl, enabled: out.next.enabled } })
    return this.status()
  },

  async testConnection() {
    const r = await wooRequest<any>('/ping')
    requireWooOk(r, 'ping')
    return { ok: true, site: r?.site ?? null, plugin: r?.plugin ?? null, time: r?.time ?? null }
  },

  async catalog(params: { search?: string; limit?: number; page?: number; offset?: number } = {}): Promise<WooCatalogResult> {
    const limit = Math.min(200, Math.max(1, Math.round(Number(params.limit) || 100)))
    const requestedPage = params.page != null
      ? Math.max(1, Math.round(Number(params.page) || 1))
      : params.offset != null
        ? Math.max(1, Math.floor(Number(params.offset || 0) / limit) + 1)
        : null
    const mapRows = (rows: any[]) => rows.map((x: any) => ({
      holderKey: String(x.holder_key ?? x.holderKey ?? wooHolderKey(x.product_id ?? x.productId, x.variation_id ?? x.variationId)),
      productId: wooSafeInt(x.product_id ?? x.productId),
      variationId: x.variation_id == null ? null : wooSafeInt(x.variation_id ?? x.variationId),
      sku: x.sku == null ? null : String(x.sku),
      name: String(x.name ?? ''),
      type: String(x.type ?? ''),
      manageStock: x.manage_stock === true || x.manageStock === true,
      manageStockMode: x.manage_stock_mode == null ? null : String(x.manage_stock_mode),
      stockQuantity: wooNullableInt(x.stock_quantity ?? x.stockQuantity),
      stockStatus: String(x.stock_status ?? x.stockStatus ?? ''),
      backorders: x.backorders == null ? null : String(x.backorders),
      status: x.status == null ? null : String(x.status)
    }))
    const fetchPage = async (page: number) => {
      const q = new URLSearchParams()
      if (params.search) q.set('search', String(params.search))
      q.set('limit', String(limit))
      q.set('page', String(page))
      const r = await wooRequest<any>(`/catalog?${q.toString()}`)
      requireWooOk(r, 'catalog')
      return r
    }
    if (requestedPage != null) {
      const r = await fetchPage(requestedPage)
      const rows = Array.isArray(r?.items) ? r.items : []
      const more = r?.has_more === true || r?.hasMore === true
      return { items: mapRows(rows), fetched: rows.length, hasMore: more, capped: false, nextPage: more ? requestedPage + 1 : null, message: more ? 'کاتالوگ سایت صفحه‌های بیشتری دارد؛ برای دیدن همه موارد جست‌وجو را دقیق‌تر کنید یا صفحه بعد را بخوانید.' : null }
    }
    const all: any[] = []
    let page = 1
    let hasMore = false
    let capped = false
    do {
      const r = await fetchPage(page)
      const rows = Array.isArray(r?.items) ? r.items : []
      all.push(...rows)
      hasMore = r?.has_more === true || r?.hasMore === true
      page++
      capped = hasMore && (all.length >= 1000 || page > 20)
    } while (hasMore && !capped)
    const items = mapRows(all.slice(0, 1000))
    return { items, fetched: items.length, hasMore, capped, nextPage: hasMore ? page : null, message: capped ? 'کاتالوگ سایت بیش از سقف امن نمایش است و فهرست کامل نیست؛ برای اتصال، جست‌وجو را دقیق‌تر کنید.' : null }
  },

  async links(): Promise<WooLinkRow[]> {
    const rows = await (prisma as any).$queryRawUnsafe(`
      SELECT l.*, v.code, v.barcode, v.stock AS mahakStock, v.size, v.color, v.productId AS localProductId, p.name AS productName,
        (SELECT COUNT(*) FROM WooSyncOutbox o WHERE o.linkId = l.id AND o.status = 'PENDING') AS pendingOutbox,
        (SELECT COUNT(*) FROM WooSyncOutbox o WHERE o.linkId = l.id AND o.status IN ('FAILED','CONFLICT','DEAD')) AS failedOutbox,
        (SELECT COUNT(*) FROM WooInboundEvent e WHERE e.linkId = l.id AND e.status IN ('SKIPPED_PAUSED','PARKED')) AS pausedEvents
      FROM WooProductLink l
      JOIN ProductVariant v ON v.id = l.variantId
      JOIN Product p ON p.id = v.productId
      WHERE l.status <> 'UNLINKED'
      ORDER BY l.updatedAt DESC, l.id DESC
    `)
    return rows.map((r: any) => ({
      id: Number(r.id),
      variantId: Number(r.variantId),
      productId: Number(r.localProductId ?? 0),
      productName: String(r.productName ?? ''),
      code: String(r.code ?? ''),
      barcode: String(r.barcode ?? ''),
      color: r.color ?? null,
      size: r.size ?? null,
      mahakStock: Number(r.mahakStock ?? 0),
      wooProductId: Number(r.wooProductId ?? 0),
      wooVariationId: r.wooVariationId == null ? null : Number(r.wooVariationId),
      holderKey: String(r.holderKey ?? ''),
      sku: r.sku ?? null,
      remoteName: r.remoteName ?? null,
      status: String(r.status ?? ''),
      lastWooQty: Number(r.lastWooQty ?? 0),
      lastMahakQty: Number(r.lastMahakQty ?? 0),
      pausedAt: asDateString(r.pausedAt),
      pauseNote: r.pauseNote ?? null,
      pendingOutbox: Number(r.pendingOutbox ?? 0),
      failedOutbox: Number(r.failedOutbox ?? 0),
      pausedEvents: Number(r.pausedEvents ?? 0)
    }))
  },

  async linkCreate(input: {
    variantId?: number
    productId?: number
    variationId?: number | null
    holderKey?: string
    sku?: string | null
    remoteName?: string | null
    manageStock?: boolean
    wooQty?: number | null
    decision?: string
    userId?: number | null
  }) {
    const variantId = int(input.variantId, 'شناسه کالای فروشگاه', { positive: true })
    const productId = int(input.productId, 'شناسه محصول سایت', { positive: true })
    const variationId = input.variationId == null ? null : int(input.variationId, 'شناسه Variation سایت', { positive: true })
    const holderKey = wooHolderKey(productId, variationId)
    if (input.manageStock !== true) throw new BusinessError('این محصول در سایت manage_stock ندارد؛ تا وقتی موجودی سایت مستقل نباشد، اتصال امن نیست.')
    if (input.wooQty === null || input.wooQty === undefined) throw new BusinessError('موجودی سایت برای این holder عدد مستقل ندارد؛ اتصال امن نیست.')
    const catalogWooQty = wooSafeInt(input.wooQty)
    // ژورنال سایت را تا حد ممکن خالی می‌کنیم تا snapshot بعدی (stockQuantity + lastSeq که با هم خوانده می‌شوند)
    // تازه‌ترین نقطه‌ی ژورنال را پوشش دهد؛ آنچه قبل از snapshot ثبت شده در خط مبنا (floor) قرار می‌گیرد،
    // و آنچه بعد از آن برسد یا هم‌اکنون قابل خواندن است یا در گپ گم‌شده بازیابی می‌شود (پایین‌تر).
    await this.pullJournalDrain(5, 200)
    const freshRemote = (await this.remoteStock([{ holderKey, wooProductId: productId, wooVariationId: variationId }]))[0]
    if (!remoteStockUsable(freshRemote)) throw new BusinessError('این محصول/Variation در سایت موجودی مستقل عددی ندارد (manage_stock والد/خاموش/اعشاری است)؛ اتصال امن نیست.')
    const wooQty = wooSafeInt(freshRemote.stockQuantity ?? catalogWooQty)
    const initialSeqFloor = freshRemote.lastSeq == null ? null : BigInt(freshRemote.lastSeq)
    const decision = String(input.decision || WooResumeDecision.MAHAK_WINS)
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, code: true } })
    if (!variant) throw new BusinessError('کالای فروشگاه پیدا نشد.')
    let gapHeldCount = 0
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const exists = await activeLinkForVariant(tx as any, variantId)
      if (exists) throw new BusinessError('این واریانت فروشگاه از قبل به سایت وصل است؛ اول همان اتصال را قطع کنید.')
      const holderExists = await (tx as any).wooProductLink.findFirst({ where: { holderKey, status: { not: WooLinkStatus.UNLINKED } }, select: { id: true, variantId: true } })
      if (holderExists) throw new BusinessError('این محصول/Variation سایت از قبل به یک کالای فروشگاه وصل است؛ اول همان اتصال را قطع کنید.')
      let localStock = await productStock(variantId, tx as any)
      const link = await (tx as any).wooProductLink.create({
        data: {
          variantId,
          wooProductId: productId,
          wooVariationId: variationId,
          holderKey,
          sku: input.sku ?? null,
          remoteName: input.remoteName ?? null,
          manageStock: true,
          status: WooLinkStatus.ACTIVE,
          lastWooQty: wooQty,
          lastMahakQty: localStock,
          relinkSeqFloor: initialSeqFloor
        }
      })
      if (decision === WooResumeDecision.WOO_WINS && localStock !== wooQty) {
        const r = await applyWooDelta({
          variantId,
          delta: wooQty - localStock,
          reason: StockReason.WOO_SYNC_ADJUST,
          note: 'اتصال اولیه سایت: سایت مرجع موجودی شد',
          tx
        })
        localStock = r.stock
      } else if (decision === WooResumeDecision.MAHAK_WINS && publishedQty(localStock) !== publishedQty(wooQty)) {
        await createOutbox({ client: tx as any, link, variantId, kind: 'RECONCILE_PUSH', targetQty: localStock, expectedWooQty: wooQty })
      } else if ((decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP) && publishedQty(localStock) !== publishedQty(wooQty)) {
        throw new BusinessError('برای «فقط بررسی»، موجودی MAHAK و سایت باید برابر باشد؛ یکی از گزینه‌های مرجع را انتخاب کنید.')
      } else if (decision !== WooResumeDecision.MAHAK_WINS && decision !== WooResumeDecision.WOO_WINS && decision !== WooResumeDecision.VERIFY_ONLY && decision !== WooResumeDecision.NOOP) {
        throw new BusinessError('روش اتصال اولیه نامعتبر است.')
      }
      await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastMahakQty: localStock } })
      await audit(tx, {
        action: AuditAction.WOO_LINK_CREATE,
        entity: 'WooProductLink',
        entityId: link.id,
        userId: input.userId ?? null,
        after: json({ variantId, holderKey, decision, wooQty, mahakQty: localStock, relinkSeqFloor: freshRemote.lastSeq ?? null }),
        note: 'اتصال موجودی کالا به WooCommerce (فقط موجودی)'
      })
      // گپ لحظه‌ی وصل: رویدادی که بعد از snapshot (seq > floor) رخ داده ولی scheduler قبل از ساخت لینک آن را
      // به‌عنوان SKIPPED_UNMAPPED کنار گذاشته، نباید گم شود؛ به رویدادِ نگهداشته‌شده‌ی نیازمند تأیید مدیر تبدیل می‌شود.
      if (initialSeqFloor != null) {
        const gapEvents = await (tx as any).wooInboundEvent.findMany({
          where: { holderKey, status: WooInboundStatus.SKIPPED_UNMAPPED, seq: { gt: initialSeqFloor } },
          orderBy: [{ seq: 'asc' }, { id: 'asc' }],
          take: 50
        })
        for (const ev of gapEvents) {
          await (tx as any).wooInboundEvent.update({ where: { id: ev.id }, data: { status: WooInboundStatus.SKIPPED_PAUSED, linkId: link.id, variantId, processedAt: new Date() } })
          await ensureApproval({
            client: tx as any,
            action: WooApprovalAction.APPLY_INBOUND,
            linkId: link.id,
            variantId,
            holderKey,
            sourceType: 'WooInboundEvent',
            sourceId: ev.id,
            reason: 'INBOUND_DURING_LINK_CREATE',
            title: 'رویداد سایت دقیقاً هنگام وصل اولیه',
            message: 'در همان لحظه‌ی ساخت اتصال، روی سایت تغییر موجودی رخ داده بود و چون لینک هنوز ساخته نشده بود، خواننده آن را کنار گذاشته بود؛ برای جلوگیری از اختلاف پنهان، اعمال آن نیازمند تأیید مدیر است.',
            payload: { seq: ev.seq == null ? null : Number(ev.seq), delta: ev.delta == null ? null : Number(ev.delta), newQty: ev.newQty == null ? null : Number(ev.newQty), source: ev.source ?? null, orderId: ev.orderId ?? null }
          })
        }
        gapHeldCount = gapEvents.length
      }
      return { id: link.id }
    }, TX_OPTIONS)
    if (gapHeldCount > 0) await log('LINK_CREATE_GAP_EVENTS_HELD', 'رویدادهای سایتِ لحظه‌ی وصل اولیه برای تصمیم مدیر نگه داشته شدند', { level: 'WARN', variantId, payload: { count: gapHeldCount } })
    return created
  },

  async pause(input: { linkIds?: number[]; note?: string | null; userId?: number | null }) {
    const ids = Array.isArray(input.linkIds) ? input.linkIds.map((x) => int(x, 'شناسه اتصال', { positive: true })) : []
    if (!ids.length) throw new BusinessError('هیچ اتصالی برای قطع انتخاب نشده است.')
    const cursor = await lastCursor()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const id of ids) {
        const link = await (tx as any).wooProductLink.findUnique({ where: { id } })
        if (!link || link.status === WooLinkStatus.UNLINKED) continue
        await (tx as any).wooSyncOutbox.updateMany({
          where: { linkId: id, status: { in: openOutboxStatuses() } },
          data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_PAUSED' }
        })
        await (tx as any).wooProductLink.update({
          where: { id },
          data: {
            status: WooLinkStatus.PAUSED,
            pauseReason: 'MANUAL',
            pausedAt: new Date(),
            pausedBy: input.userId ?? null,
            pauseNote: input.note ?? null,
            pauseSeqFloor: link.pauseSeqFloor == null ? BigInt(cursor) : BigInt(link.pauseSeqFloor)
          }
        })
        await audit(tx, {
          action: AuditAction.WOO_LINK_PAUSE,
          entity: 'WooProductLink',
          entityId: id,
          userId: input.userId ?? null,
          before: json({ status: link.status }),
          after: json({ status: WooLinkStatus.PAUSED, cursor }),
          note: input.note || 'قطع موقت همگام‌سازی موجودی سایت'
        })
      }
    }, TX_OPTIONS)
    await log('LINK_PAUSE', `${ids.length} اتصال قطع موقت شد`, { payload: { ids, cursor } })
    return this.links()
  },

  async resumePreview(input: { linkId?: number }) {
    const link = await linkById(int(input.linkId, 'شناسه اتصال', { positive: true }))
    const stockRes = await this.remoteStock([link])
    const remote = stockRes[0]
    if (!remoteStockUsable(remote)) {
      // ممکن است بین خوان و پاسخ شبکه، مدیر لینک را unlink/resume کرده باشد؛ فقط در صورت ثابت‌ماندن snapshot علامت BROKEN می‌زنیم.
      await updateLinkIfSnapshotUnchanged(link, { status: WooLinkStatus.BROKEN_REMOTE })
      throw new BusinessError('این اتصال در سایت دیگر موجودی مستقل عددی ندارد (manage_stock خاموش/والد/اعشاری است). ابتدا تنظیم موجودی WooCommerce را اصلاح کنید.')
    }
    const remoteLastSeq = remote?.lastSeq == null ? null : Number(remote.lastSeq)
    // پیش از Reconcile، ژورنال سایت را تا آخرین seq همین holder می‌خوانیم تا سفارش‌های Pull‌نشده
    // بعداً دوباره روی MAHAK ننشینند یا گم نشوند.
    if (remoteLastSeq != null) {
      let cursor = await lastCursor()
      for (let guard = 0; cursor < remoteLastSeq && guard < 30; guard++) {
        await this.pullJournal(200)
        const next = await lastCursor()
        if (next <= cursor) break
        cursor = next
      }
      if ((await lastCursor()) < remoteLastSeq) throw new BusinessError('ژورنال سایت هنوز کامل نشده است؛ چند ثانیه بعد دوباره پیش‌نمایش بگیرید.')
    }
    const mahakStock = await productStock(link.variantId)
    const paused = await db().wooInboundEvent.findMany({
      where: heldInboundWhere(link, remoteLastSeq),
      orderBy: [{ seq: 'asc' }, { id: 'asc' }]
    })
    const pausedEvents: WooResumePreviewEvent[] = paused.map((e: any) => ({
      id: e.id,
      seq: e.seq == null ? null : Number(e.seq),
      status: e.status ?? null,
      delta: Number(e.delta || 0),
      source: e.source,
      orderId: e.orderId
    }))
    const orderEvents = pausedEvents.filter(isWooOrderPausedEvent)
    const nonOrderEvents = pausedEvents.filter((e) => !isWooOrderPausedEvent(e))
    return {
      linkId: link.id,
      holderKey: link.holderKey,
      mahakStock,
      wooQty: remote?.stockQuantity ?? link.lastWooQty,
      lastSeq: remoteLastSeq,
      pausedEvents,
      heldEventHash: inboundEventSignature(paused),
      orderEvents: orderEvents.length,
      orderDelta: orderEvents.reduce((sum, e) => sum + Number(e.delta || 0), 0),
      nonOrderEvents: nonOrderEvents.length,
      nonOrderDelta: nonOrderEvents.reduce((sum, e) => sum + Number(e.delta || 0), 0)
    }
  },

  async resumeApply(input: {
    linkId?: number
    decision?: string
    userId?: number | null
    expectedMahakStock?: number
    expectedWooQty?: number
    expectedLastSeq?: number | null
    expectedPausedEventCount?: number
    expectedPausedEventHash?: string | null
  }) {
    const link = await linkById(int(input.linkId, 'شناسه اتصال', { positive: true }))
    const decision = String(input.decision || WooResumeDecision.VERIFY_ONLY)
    const preview = await this.resumePreview({ linkId: link.id })
    if (
      input.expectedMahakStock == null ||
      input.expectedWooQty == null ||
      input.expectedLastSeq === undefined ||
      input.expectedPausedEventCount == null ||
      input.expectedPausedEventHash == null
    ) {
      throw new BusinessError('برای وصل دوباره/حل اختلاف، اول باید پیش‌نمایش تازه بگیرید؛ درخواست بدون امضای پیش‌نمایش اعمال نشد.')
    }
    const previewChanged =
      Number(input.expectedMahakStock) !== Number(preview.mahakStock) ||
      Number(input.expectedWooQty) !== Number(preview.wooQty) ||
      (input.expectedLastSeq == null ? null : Number(input.expectedLastSeq)) !== (preview.lastSeq == null ? null : Number(preview.lastSeq)) ||
      Number(input.expectedPausedEventCount) !== Number(preview.pausedEvents.length) ||
      String(input.expectedPausedEventHash || '') !== String(preview.heldEventHash || '')
    if (previewChanged) throw new BusinessError('از زمان پیش‌نمایش، موجودی یا رویدادهای سایت تغییر کرده است؛ دوباره پیش‌نمایش بگیرید و بعد اعمال کنید.')
    if (decision === WooResumeDecision.MAHAK_WINS && preview.pausedEvents.some((e) => isWooOrderPausedEvent(e) && Number(e.delta || 0) !== 0)) {
      throw new BusinessError('در زمان توقف، سفارش/Refund واقعی سایت ثبت شده است؛ برای جلوگیری از حذف فروش واقعی، گزینه «MAHAK + سفارش‌های سایت» را انتخاب کنید یا همان رویداد ورودی را از صف تأیید اعمال کنید.')
    }

    let finalStock = Number(preview.mahakStock)
    let supersededPausedEvents = 0
    let appliedPausedOrderEvents = 0
    let parkedRestoreReview = 0
    let pendingReconcilePush = false
    const relinkId = randomUUID()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
      if (!fresh || ![WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT, WooLinkStatus.BROKEN_REMOTE, WooLinkStatus.FROZEN].includes(fresh.status)) throw new BusinessError('این اتصال دیگر در وضعیت قطع موقت/اختلاف/توقف/خرابی سایت نیست؛ فهرست را تازه کنید.')
      // فقط بودن در یکی از وضعیت‌های قطع کافی نیست؛ اگر بعد از خواندن این درخواست اتصال دوباره تغییر کرده باشد
      // (مثلاً مدیر همان لینک را دوباره قطع کرده)، اجرای تصمیم این پنجره‌ی کهنه تصمیم تازه‌ی مدیر را باطل می‌کند.
      if (!sameDbTime(fresh.updatedAt, link.updatedAt)) throw new BusinessError('این اتصال بعد از پذیرش این درخواست دوباره تغییر وضعیت داده است؛ فهرست را تازه کنید و دوباره تصمیم بگیرید.')
      await assertNoFreshInFlight(tx as any, link.id)
      const txStock = await productStock(link.variantId, tx as any)
      if (txStock !== Number(preview.mahakStock)) throw new BusinessError('موجودی MAHAK بعد از پیش‌نمایش تغییر کرده است؛ دوباره پیش‌نمایش بگیرید.')
      const heldEvents = await (tx as any).wooInboundEvent.findMany({ where: heldInboundWhere(fresh, null), orderBy: [{ seq: 'asc' }, { id: 'asc' }] })
      if (
        heldEvents.length !== Number(preview.pausedEvents.length) ||
        inboundEventSignature(heldEvents) !== String(preview.heldEventHash || '') ||
        hasHeldAfter(heldEvents, preview.lastSeq)
      ) throw new BusinessError('از زمان پیش‌نمایش، رویداد تازه‌ای از سایت رسیده است؛ دوباره پیش‌نمایش بگیرید.')
      const heldOrderEvents = heldEvents.filter((e: any) => isWooOrderPausedEvent(e) && Number(e.delta || 0) !== 0)
      if (decision === WooResumeDecision.MAHAK_WINS && heldOrderEvents.length) {
        throw new BusinessError('در زمان توقف/پارک، سفارش یا Refund واقعی سایت ثبت شده است؛ برای جلوگیری از حذف فروش واقعی، گزینه «MAHAK + سفارش‌های سایت» را انتخاب کنید یا همان رویداد ورودی را از صف تأیید اعمال کنید.')
      }
      await (tx as any).wooSyncOutbox.updateMany({
        where: { linkId: link.id, status: { in: openOutboxStatuses() } },
        data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_RECONCILED', updatedAt: new Date() }
      })
      const heldIds = heldEvents.map((e: any) => Number(e.id)).filter((x: number) => Number.isFinite(x))

      if (decision === WooResumeDecision.WOO_WINS) {
        const delta = Number(preview.wooQty) - txStock
        const r = await applyWooDelta({ variantId: link.variantId, delta, reason: StockReason.WOO_SYNC_ADJUST, note: 'وصل دوباره سایت: سایت مرجع موجودی شد', tx })
        finalStock = r.stock
        if (heldIds.length) {
          const upd = await (tx as any).wooInboundEvent.updateMany({ where: { id: { in: heldIds } }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
          supersededPausedEvents += Number(upd.count || 0)
        }
      } else if (decision === WooResumeDecision.MAHAK_PLUS_ORDERS) {
        for (const e of heldEvents) {
          const delta = Number(e.delta || 0)
          if (!isWooOrderPausedEvent(e)) {
            // ویرایش دستی/ادمین سایت در زمان قطع خودکار اعمال نمی‌شود و در همین Reconcile تعیین تکلیف می‌شود.
            await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
            supersededPausedEvents++
            continue
          }
          if (!delta) {
            await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
            supersededPausedEvents++
            continue
          }
          if (delta > 0 && isWooRestoreSource(e.source)) {
            const allowed = await remainingRestoreAllowance({ client: tx as any, variantId: link.variantId, orderId: e.orderId })
            if (delta > allowed) {
              await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.PARKED, relinkId, processedAt: new Date() } })
              parkedRestoreReview++
              continue
            }
          }
          const existingMove = await (tx as any).stockMovement.findFirst({ where: { refType: 'WooInboundEvent', refId: e.id }, select: { id: true } })
          if (existingMove?.id != null) {
            finalStock = await productStock(link.variantId, tx as any)
            await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.APPLIED_ON_RELINK, movementId: Number(existingMove.id), relinkId, processedAt: new Date() } })
            appliedPausedOrderEvents++
            continue
          }
          const r = await applyWooDelta({ eventId: e.id, variantId: link.variantId, delta, note: `اعمال سفارش سایت هنگام وصل دوباره (${e.orderId ?? 'بدون سفارش'})`, tx })
          finalStock = r.stock
          appliedPausedOrderEvents++
          await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.APPLIED_ON_RELINK, movementId: r.movementId, relinkId, processedAt: new Date() } })
        }
      } else if (decision === WooResumeDecision.MAHAK_WINS) {
        if (heldIds.length) {
          const upd = await (tx as any).wooInboundEvent.updateMany({ where: { id: { in: heldIds } }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
          supersededPausedEvents += Number(upd.count || 0)
        }
      } else if (decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP) {
        if (heldEvents.length > 0 || publishedQty(txStock) !== publishedQty(preview.wooQty)) throw new BusinessError('«فقط بررسی» فقط وقتی مجاز است که موجودی منتشرشده دو طرف برابر باشد و رویداد زمان قطع/پارک باقی نمانده باشد.')
      } else {
        throw new BusinessError('روش وصل دوباره نامعتبر است.')
      }

      const targetForSite = publishedQty(finalStock)
      pendingReconcilePush = (decision === WooResumeDecision.MAHAK_WINS || decision === WooResumeDecision.MAHAK_PLUS_ORDERS) && targetForSite !== publishedQty(preview.wooQty)
      await (tx as any).wooProductLink.update({
        where: { id: link.id },
        data: {
          status: pendingReconcilePush ? WooLinkStatus.PAUSED : WooLinkStatus.ACTIVE,
          pauseReason: pendingReconcilePush ? 'APPROVED_RECONCILE_PUSH' : fresh.pauseReason,
          resumedAt: new Date(),
          resumedBy: input.userId ?? null,
          resumeDecision: decision,
          relinkSeqFloor: preview.lastSeq == null ? null : BigInt(preview.lastSeq),
          lastRelinkId: relinkId,
          lastMahakQty: finalStock,
          lastWooQty: wooSafeInt(preview.wooQty)
        }
      })
      if (pendingReconcilePush) {
        await createOutbox({ client: tx as any, link: { ...link, lastWooQty: wooSafeInt(preview.wooQty) }, variantId: link.variantId, kind: 'RECONCILE_PUSH', targetQty: targetForSite, expectedWooQty: wooSafeInt(preview.wooQty), skipLoopFuse: true })
      }
      if (heldIds.length) {
        const handledEvents = await (tx as any).wooInboundEvent.findMany({ where: { id: { in: heldIds }, status: { not: WooInboundStatus.PARKED } }, select: { id: true } })
        await expireApplyInboundApprovals({ client: tx as any, linkId: link.id, eventIds: handledEvents.map((e: any) => e.id), userId: input.userId ?? null, resolution: 'SUPERSEDED_BY_RESUME', note: 'این رویداد با وصل/حل اختلاف جدید تعیین تکلیف شد.' })
      }
      await audit(tx, {
        action: AuditAction.WOO_LINK_RESUME,
        entity: 'WooProductLink',
        entityId: link.id,
        userId: input.userId ?? null,
        after: json({ decision, relinkId, wooQty: preview.wooQty, mahakQty: finalStock, appliedPausedOrderEvents, supersededPausedEvents, parkedRestoreReview, pendingReconcilePush }),
        note: 'وصل دوباره/حل اختلاف همگام‌سازی موجودی سایت'
      })
      await (tx as any).wooApproval.updateMany({
        where: { linkId: link.id, status: WooApprovalStatus.PENDING, action: { in: [WooApprovalAction.RECONCILE_DISCREPANCY, WooApprovalAction.CONFLICT_RESOLUTION, WooApprovalAction.LOOP_FUSE, WooApprovalAction.UNFREEZE_LINK] } },
        data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'SUPERSEDED_BY_RESUME', resolutionNote: 'این درخواست با وصل/حل اختلاف جدید تعیین تکلیف شد.' }
      })
    }, TX_OPTIONS)
    if (parkedRestoreReview > 0) await log('RELINK_RESTORE_PARKED', 'برخی رویدادهای برگشت/Refund سایت از سقف فروش ثبت‌شده بیشتر بودند و برای بررسی دستی پارک ماندند', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { relinkId, parkedRestoreReview } })
    await log('LINK_RESUME', pendingReconcilePush ? 'تصمیم وصل ثبت شد و تا ارسال موفق سایت، لینک موقتاً قطع می‌ماند' : 'اتصال موجودی سایت دوباره فعال شد', { linkId: link.id, variantId: link.variantId, payload: { decision, relinkId, appliedPausedOrderEvents, supersededPausedEvents, parkedRestoreReview, pendingReconcilePush } })
    return this.links()
  },

  async unlink(input: { linkId?: number; userId?: number | null }) {
    const id = int(input.linkId, 'شناسه اتصال', { positive: true })
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const link = await (tx as any).wooProductLink.findUnique({ where: { id } })
      if (!link) return
      await assertNoFreshInFlight(tx as any, id)
      const held = await (tx as any).wooInboundEvent.count({ where: heldInboundWhere(link, null) })
      if (held > 0) throw new BusinessError('برای این اتصال هنوز رویداد حل‌نشده سایت وجود دارد؛ قبل از قطع دائم، صف تأیید/رویدادهای پارک‌شده را تعیین تکلیف کنید.')
      await (tx as any).wooSyncOutbox.updateMany({ where: { linkId: id, status: { in: openOutboxStatuses() } }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_UNLINKED' } })
      await (tx as any).wooApproval.updateMany({ where: { linkId: id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'LINK_UNLINKED', resolutionNote: 'لینک موجودی سایت قطع دائم شد.' } })
      await (tx as any).wooProductLink.update({ where: { id }, data: { status: WooLinkStatus.UNLINKED } })
      await audit(tx, { action: AuditAction.WOO_LINK_UNLINK, entity: 'WooProductLink', entityId: id, userId: input.userId ?? null, before: json(link), note: 'قطع دائم اتصال موجودی سایت' })
    }, TX_OPTIONS)
    return this.links()
  },

  async remoteStock(links: any[]) {
    if (!links.length) return []
    const holders = links.map((l) => ({ holder_key: l.holderKey, product_id: l.wooProductId, variation_id: l.wooVariationId ?? null }))
    const r = await wooRequest<any>('/stock', { method: 'POST', body: { holders } })
    requireWooOk(r, 'stock')
    const items = Array.isArray(r?.items) ? r.items : []
    return items.map((x: any) => ({
      holderKey: String(x.holder_key ?? x.holderKey ?? ''),
      stockQuantity: wooNullableInt(x.stock_quantity ?? x.stockQuantity),
      manageStock: x.manage_stock === true || x.manageStock === true,
      manageStockMode: x.manage_stock_mode ?? x.manageStockMode ?? x.manage_stock ?? x.manageStock ?? null,
      lastSeq: x.last_seq == null ? null : wooSafeInt(x.last_seq)
    }))
  },

  async processOutbox(limit = 50) {
    const cfg = await safeConfig()
    if (!cfg.enabled || !cfg.siteUrl || !cfg.hasSecret) return { sent: 0, failed: 0, skipped: 0 }
    const staleBefore = new Date(Date.now() - IN_FLIGHT_STALE_MS)
    await db().wooSyncOutbox.updateMany({
      where: { status: WooOutboxStatus.IN_FLIGHT, updatedAt: { lt: staleBefore } },
      data: { status: WooOutboxStatus.FAILED, lastError: 'STALE_IN_FLIGHT_RESET', updatedAt: new Date() }
    }).catch(() => null)
    await db().wooSyncOutbox.updateMany({
      where: { status: WooOutboxStatus.FAILED, attemptCount: { gte: MAX_OUTBOX_ATTEMPTS } },
      data: { status: WooOutboxStatus.DEAD, lastError: 'MAX_ATTEMPTS_REACHED', updatedAt: new Date() }
    }).catch(() => null)
    const rows = await db().wooSyncOutbox.findMany({
      where: { status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED] }, attemptCount: { lt: MAX_OUTBOX_ATTEMPTS } },
      orderBy: { id: 'asc' },
      take: Math.min(100, Math.max(1, Math.round(Number(limit) || 50)))
    })
    let sent = 0
    let failed = 0
    let skipped = 0
    for (const row of rows) {
      const locked = await claimOutboxForSend(row).catch(() => false)
      if (!locked) {
        skipped++
        continue
      }
      const link = await db().wooProductLink.findUnique({ where: { id: row.linkId } })
      const reconcileKind = isReconcileOutboxKind(row.kind)
      if (!canSendOutboxForLink(row.kind, link)) {
        await db().wooSyncOutbox.update({ where: { id: row.id }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_NOT_SENDABLE', updatedAt: new Date() } })
        skipped++
        continue
      }
      try {
        const expected = wooSafeInt(row.expectedWooQty ?? link.lastWooQty ?? 0)
        let localStock = Number(row.targetQty)
        if (String(row.kind) !== 'DELETE_ZERO') localStock = await productStock(row.variantId)
        const target = String(row.kind) === 'DELETE_ZERO' ? 0 : publishedQty(localStock)
        const res = await wooRequest<any>('/stock/apply', {
          method: 'POST',
          body: {
            request_id: row.idempotencyKey,
            holder_key: link.holderKey,
            product_id: link.wooProductId,
            variation_id: link.wooVariationId ?? null,
            expected,
            target
          }
        })
        if (res?.ok === false || res?.conflict === true) throw new BusinessError(String(res?.message ?? 'اختلاف موجودی سایت'))
        // پاسخ 2xx بدون قرارداد معتبر افزونه (صفحه‌ی پروکسی/JSON ناقص) نباید outbox را SENT کند.
        if (res?.ok !== true) throw new BusinessError('پاسخ نوشتن موجودی سایت ناقص یا نامعتبر است؛ نتیجه‌ی نوشتن نامعلوم ماند و دوباره امن تلاش می‌شود.')
        if (res?.holder_key != null && String(res.holder_key) !== String(link.holderKey)) throw new BusinessError('پاسخ نوشتن موجودی سایت برای holder دیگری برگشته است؛ outbox ارسال‌شده محسوب نمی‌شود.')
        const appliedWooQty = wooStrictIntField(res?.new_qty)
        if (appliedWooQty == null) throw new BusinessError('عدد موجودی جدید در پاسخ سایت معتبر نیست؛ نتیجه‌ی نوشتن نامعلوم ماند و دوباره امن تلاش می‌شود.')
        let needsFreshOutbox = false
        let finalized = false
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const sentUpdate = await (tx as any).wooSyncOutbox.updateMany({
            where: { id: row.id, status: WooOutboxStatus.IN_FLIGHT },
            data: { status: WooOutboxStatus.SENT, sentAt: new Date(), updatedAt: new Date(), lastError: null, targetQty: target }
          })
          if (!sentUpdate.count) return
          finalized = true
          const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
          if (freshLink) {
            const statusUnchanged = freshLink.status === link.status && sameDbTime(freshLink.updatedAt, link.updatedAt)
            if (!statusUnchanged) return
            let nextStatus = freshLink.status
            if (canActivateAfterOutbox(row.kind, freshLink)) {
              const held = await (tx as any).wooInboundEvent.count({ where: heldInboundWhere(freshLink, null) })
              nextStatus = held > 0 ? freshLink.status : WooLinkStatus.ACTIVE
            }
            await (tx as any).wooProductLink.update({
              where: { id: link.id },
              data: {
                status: nextStatus,
                lastWooQty: appliedWooQty,
                lastMahakQty: localStock,
                lastPushedMovementId: row.movementId ?? freshLink.lastPushedMovementId
              }
            })
            const canQueueAfterIdempotent = nextStatus === WooLinkStatus.ACTIVE || nextStatus === WooLinkStatus.CONFLICT || (nextStatus === WooLinkStatus.PAUSED && reconcileKind)
            needsFreshOutbox = res?.idempotent === true && appliedWooQty !== target && canQueueAfterIdempotent
            if (needsFreshOutbox) {
              const retryKind = nextStatus === WooLinkStatus.ACTIVE ? 'STOCK_PUSH_RETRY_AFTER_IDEMPOTENT' : 'RECONCILE_PUSH'
              await createOutbox({ client: tx as any, link: { ...freshLink, lastWooQty: appliedWooQty }, variantId: row.variantId, kind: retryKind, targetQty: localStock, expectedWooQty: appliedWooQty, skipLoopFuse: retryKind === 'RECONCILE_PUSH' })
            }
          }
        }, TX_OPTIONS)
        if (!finalized) {
          skipped++
          continue
        }
        if (needsFreshOutbox) await log('OUTBOX_IDEMPOTENT_RETRY', 'پاسخ idempotent سایت با هدف فعلی متفاوت بود؛ یک ارسال تازه ساخته شد', { level: 'WARN', linkId: link.id, variantId: row.variantId, payload: { outboxId: row.id, appliedWooQty, target } })
        sent++
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        const attempt = Number(row.attemptCount || 0) + 1
        const errStatus = Number((e as any)?.status || 0)
        const errCode = String((e as any)?.code || '')
        const remoteBroken = ['mahak_not_found', 'mahak_manage_stock_off', 'mahak_manage_stock_parent', 'mahak_fractional_stock'].includes(errCode)
        const transientRemote = ['mahak_stock_lock_timeout'].includes(errCode)
        const conflict = !remoteBroken && !transientRemote && (errCode === 'mahak_stock_conflict' || /اختلاف|conflict/i.test(msg) || errStatus === 409)
        const status = attempt >= MAX_OUTBOX_ATTEMPTS ? WooOutboxStatus.DEAD : conflict ? WooOutboxStatus.CONFLICT : WooOutboxStatus.FAILED
        const conflictCursor = status === WooOutboxStatus.CONFLICT ? await lastCursor() : null
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await (tx as any).wooSyncOutbox.updateMany({ where: { id: row.id, status: WooOutboxStatus.IN_FLIGHT }, data: { status, lastError: msg, updatedAt: new Date() } })
          const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
          if (freshLink && freshLink.status === link.status && sameDbTime(freshLink.updatedAt, link.updatedAt)) {
            if (remoteBroken) await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.BROKEN_REMOTE } })
            else if (status === WooOutboxStatus.CONFLICT) {
              const preservedFloor = freshLink.pauseSeqFloor != null ? BigInt(freshLink.pauseSeqFloor) : BigInt(conflictCursor ?? 0)
              await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.CONFLICT, pauseReason: 'CONFLICT', pausedAt: new Date(), pauseSeqFloor: preservedFloor } })
              await ensureApproval({ client: tx as any, action: WooApprovalAction.CONFLICT_RESOLUTION, linkId: link.id, variantId: row.variantId, holderKey: link.holderKey, sourceType: 'WooSyncOutbox', sourceId: row.id, reason: 'OUTBOX_CONFLICT', title: 'اختلاف هنگام نوشتن موجودی سایت', message: 'موجودی Woo قبل از نوشتن MAHAK تغییر کرده است. مدیر باید مرجع موجودی را انتخاب کند.', payload: { outboxId: row.id, expected: row.expectedWooQty, target: row.targetQty, error: msg } })
            }
          }
        }, TX_OPTIONS)
        await log('OUTBOX_FAILED', msg, { level: status === WooOutboxStatus.CONFLICT ? 'WARN' : 'ERROR', linkId: link?.id, variantId: row.variantId, payload: { outboxId: row.id, attempt, status } })
        failed++
      }
    }
    return { sent, failed, skipped }
  },

  async pullJournal(limit = 100) {
    const cfg = await safeConfig()
    if (!cfg.enabled || !cfg.siteUrl || !cfg.hasSecret) return { received: 0, applied: 0, skipped: 0 }
    const cursor = await lastCursor()
    const afterSeq = Math.max(0, cursor - 50)
    const q = new URLSearchParams({ after_seq: String(afterSeq), limit: String(Math.min(200, Math.max(1, Math.round(Number(limit) || 100)))) })
    const res = await wooRequest<any>(`/journal?${q.toString()}`)
    requireWooOk(res, 'journal')
    const events = Array.isArray(res?.events) ? res.events : []
    let received = 0
    let applied = 0
    let skipped = 0
    let maxSeq = cursor
    for (const raw of events) {
      const seq = wooSafeInt(raw.seq)
      if (seq > maxSeq) maxSeq = seq
      const eventUuid = String(raw.event_uuid ?? raw.uuid ?? `${seq}:${raw.holder_key ?? ''}`)
      const holderKey = String(raw.holder_key ?? raw.holderKey ?? wooHolderKey(raw.product_id, raw.variation_id))
      const oldQty = raw.old_qty == null ? null : wooSafeInt(raw.old_qty)
      const newQty = wooSafeInt(raw.new_qty ?? raw.stock_quantity)
      const delta = raw.delta == null ? (oldQty == null ? 0 : newQty - oldQty) : wooSafeInt(raw.delta)
      const requestId = raw.request_id ? String(raw.request_id).replace(/#dup-\d+$/, '') : null
      const source = String(raw.source ?? '')
      const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : parseJsonValue(raw.payload_json ?? raw.payloadJson)
      const baseEvent = {
        eventUuid,
        seq: BigInt(seq),
        holderKey,
        orderId: raw.order_id == null ? null : String(raw.order_id),
        orderItemId: raw.order_item_id == null ? null : String(raw.order_item_id),
        oldQty,
        newQty,
        delta,
        source,
        requestId,
        payloadJson: json(sanitizeWooInboundRaw(raw, payload))
      }
      try {
        const done = await db().wooInboundEvent.findUnique({ where: { eventUuid } })
        if (done) {
          skipped++
          continue
        }
        const link = await db().wooProductLink.findFirst({ where: { holderKey, status: { not: WooLinkStatus.UNLINKED } } })
        const isMahakApplyEcho = !!requestId && source === 'mahak_apply'
        const echo = isMahakApplyEcho && link?.id ? await db().wooSyncOutbox.findFirst({ where: { idempotencyKey: requestId, linkId: link.id } }) : null
        if (echo) {
          let echoActivated = false
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await (tx as any).wooInboundEvent.create({
              data: { ...baseEvent, linkId: link?.id ?? null, variantId: link?.variantId ?? null, status: WooInboundStatus.SKIPPED_ECHO, processedAt: new Date() }
            })
            if (link?.id) {
              const sentNow = await (tx as any).wooSyncOutbox.updateMany({ where: { id: echo.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.IN_FLIGHT] } }, data: { status: WooOutboxStatus.SENT, sentAt: new Date(), updatedAt: new Date(), lastError: null, targetQty: newQty } })
              const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
              const linkUpdate: any = { lastWooQty: newQty }
              // echo ژورنال یعنی apply روی سایت موفق بوده (حتی اگر پاسخ HTTP گم شده باشد). اگر لینک در انتظار
              // نتیجه‌ی همین ارسال است (وصل با مرجع MAHAK تکی/گروهی)، مثل finalize در processOutbox فعالش می‌کنیم؛
              // وگرنه لینک بی‌صدا برای همیشه PAUSED می‌ماند و reconcile (فقط ACTIVE) هم به آن سر نمی‌زند.
              if (sentNow.count > 0 && freshLink && canActivateAfterOutbox(echo.kind, freshLink)) {
                const held = await (tx as any).wooInboundEvent.count({ where: heldInboundWhere(freshLink, null) })
                if (held === 0) linkUpdate.status = WooLinkStatus.ACTIVE
              }
              await (tx as any).wooProductLink.update({ where: { id: link.id }, data: linkUpdate })
              echoActivated = linkUpdate.status === WooLinkStatus.ACTIVE
            }
          }, TX_OPTIONS)
          if (echoActivated && link?.id) await log('ECHO_ACTIVATE_LINK', 'نتیجه‌ی گم‌شده‌ی ارسال با ژورنال سایت تأیید شد و اتصال فعال شد', { linkId: link.id, variantId: link.variantId, payload: { outboxId: echo.id, requestId } })
          skipped++
          continue
        }
        if (isMahakApplyEcho) {
          // ساخت رویداد پارک‌شده و تأیید مدیر باید اتمیک باشد؛ وگرنه رویداد بدون مسیر تصمیم مدیر می‌ماند.
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const parked = await (tx as any).wooInboundEvent.create({ data: { ...baseEvent, linkId: link?.id ?? null, variantId: link?.variantId ?? null, status: WooInboundStatus.PARKED, processedAt: new Date() } })
            await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link?.id ?? null, variantId: link?.variantId ?? null, holderKey, sourceType: 'WooInboundEvent', sourceId: parked.id, reason: 'MAHAK_ECHO_WITHOUT_OUTBOX', title: 'echo نامعتبر اعمال موجودی سایت', message: 'سایت رویداد mahak_apply برگرداند اما outbox متناظر پیدا نشد؛ برای جلوگیری از اعمال delta تکراری، رویداد پارک شد.', payload: { seq, delta, newQty, requestId } })
          }, TX_OPTIONS)
          skipped++
          continue
        }
        if (!link) {
          await db().wooInboundEvent.create({ data: { ...baseEvent, status: WooInboundStatus.SKIPPED_UNMAPPED, processedAt: new Date() } })
          skipped++
          continue
        }
        const relinkFloor = link.relinkSeqFloor == null ? null : Number(link.relinkSeqFloor)
        if (link.status === WooLinkStatus.ACTIVE && relinkFloor != null && seq <= relinkFloor) {
          if (canSupersedeByRelinkFloor(link, baseEvent)) {
            await db().wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.SUPERSEDED, relinkId: link.lastRelinkId ?? null, processedAt: new Date() } })
          } else {
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
              const parked = await (tx as any).wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.PARKED, processedAt: new Date() } })
              await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link.id, variantId: link.variantId, holderKey, sourceType: 'WooInboundEvent', sourceId: parked.id, reason: 'INBOUND_BEFORE_RELINK_FLOOR', title: 'رویداد سفارش سایت نزدیک به وصل دوباره', message: 'این رویداد سفارش/Refund قبل از floor قبلی دیده شد اما بدون تصمیم صریح مدیر حذف نشد.', payload: { seq, delta, newQty, source, orderId: baseEvent.orderId } })
            }, TX_OPTIONS)
          }
          skipped++
          continue
        }
        const untrustedJournal = payload?.lock_timeout === true || (oldQty !== null && oldQty !== wooSafeInt(link.lastWooQty))
        if (link.status === WooLinkStatus.ACTIVE && untrustedJournal) {
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const parked = await (tx as any).wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.PARKED, processedAt: new Date() } })
            await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link.id, variantId: link.variantId, holderKey, sourceType: 'WooInboundEvent', sourceId: parked.id, reason: payload?.lock_timeout === true ? 'INBOUND_LOCK_TIMEOUT' : 'INBOUND_STOCK_GAP', title: 'رویداد سایت با زنجیره موجودی نامطمئن', message: 'ژورنال سایت با lock timeout یا old_qty ناپیوسته رسید؛ برای جلوگیری از تغییر کور موجودی، اعمال آن نیازمند تأیید مدیر است.', payload: { seq, oldQty, lastWooQty: link.lastWooQty, newQty, delta, source, lockTimeout: payload?.lock_timeout === true } })
          }, TX_OPTIONS)
          skipped++
          continue
        }
        if (link.status !== WooLinkStatus.ACTIVE) {
          // ساخت SKIPPED_PAUSED و تأیید مدیر اتمیک است؛ یک رویداد نباید بدون approval باقی بماند.
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const event = await (tx as any).wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.SKIPPED_PAUSED } })
            await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link.id, variantId: link.variantId, holderKey, sourceType: 'WooInboundEvent', sourceId: event.id, reason: 'INBOUND_DURING_HOLD', title: 'رویداد سایت هنگام قطع/توقف', message: 'در زمان قطع/توقف لینک، سایت موجودی را تغییر داده است. اعمال روی MAHAK فقط با تأیید مدیر انجام می‌شود.', payload: { seq, delta, newQty, source: baseEvent.source, orderId: baseEvent.orderId } })
          }, TX_OPTIONS)
          skipped++
          continue
        }
        let appliedEvent = false
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
          if (!freshLink || freshLink.status !== WooLinkStatus.ACTIVE || !sameDbTime(freshLink.updatedAt, link.updatedAt)) {
            const event = await (tx as any).wooInboundEvent.create({
              data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.SKIPPED_PAUSED }
            })
            await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link.id, variantId: link.variantId, holderKey, sourceType: 'WooInboundEvent', sourceId: event.id, reason: 'INBOUND_LINK_CHANGED_DURING_PULL', title: 'رویداد سایت هم‌زمان با تغییر وضعیت لینک', message: 'هنگام خواندن ژورنال، وضعیت لینک تغییر کرد؛ برای جلوگیری از اعمال خودکار بعد از توقف/حل اختلاف، اعمال این رویداد نیازمند تأیید مدیر است.', payload: { seq, delta, newQty, source: baseEvent.source, orderId: baseEvent.orderId } })
            return
          }
          const event = await (tx as any).wooInboundEvent.create({
            data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.PENDING }
          })
          const r = await applyWooDelta({ eventId: event.id, variantId: link.variantId, delta, note: `همگام‌سازی موجودی سایت${raw.order_id ? ` · سفارش ${raw.order_id}` : ''}`, tx })
          await (tx as any).wooInboundEvent.update({ where: { id: event.id }, data: { status: WooInboundStatus.APPLIED, movementId: r.movementId, processedAt: new Date() } })
          await (tx as any).wooSyncOutbox.updateMany({
            where: { linkId: link.id, status: { in: openOutboxStatuses() } },
            data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'REBASING_AFTER_INBOUND', updatedAt: new Date() }
          })
          const targetAfterInbound = publishedQty(r.stock)
          if (targetAfterInbound !== newQty) {
            await createOutbox({ client: tx as any, link: { ...freshLink, lastWooQty: newQty }, variantId: link.variantId, kind: 'STOCK_PUSH_REBASED', targetQty: targetAfterInbound, expectedWooQty: newQty, skipLoopFuse: isWooOrderPausedEvent(baseEvent) })
          }
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: newQty, lastMahakQty: r.stock } })
          appliedEvent = true
        }, TX_OPTIONS)
        if (appliedEvent) applied++
        else skipped++
      } catch (e) {
        const existing = await db().wooInboundEvent.findUnique({ where: { eventUuid: baseEvent.eventUuid } }).catch(() => null)
        if (existing && existing.status !== WooInboundStatus.PARKED) {
          skipped++
          continue
        }
        const message = String((e as any)?.message ?? e)
        await log('INBOUND_FAILED', message, { level: 'ERROR', payload: sanitizeWooInboundRaw(raw, payload) })
        const link = await db().wooProductLink.findFirst({ where: { holderKey, status: { not: WooLinkStatus.UNLINKED } } })
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const parked = await (tx as any).wooInboundEvent.upsert({
            where: { eventUuid: baseEvent.eventUuid },
            update: {},
            create: { ...baseEvent, linkId: link?.id ?? null, variantId: link?.variantId ?? null, status: WooInboundStatus.PARKED, processedAt: new Date() }
          })
          await ensureApproval({ client: tx as any, action: WooApprovalAction.APPLY_INBOUND, linkId: link?.id ?? null, variantId: link?.variantId ?? null, holderKey, sourceType: 'WooInboundEvent', sourceId: parked.id, reason: 'INBOUND_PARKED', title: 'رویداد سایت پارک‌شده', message: 'پردازش رویداد سایت خطا داد و برای جلوگیری از تغییر کور موجودی، در انتظار تأیید مدیر ماند.', payload: { seq, delta, newQty, source: baseEvent.source, orderId: baseEvent.orderId, error: message } })
        }, TX_OPTIONS)
        skipped++
      } finally {
        received++
      }
    }
    if (maxSeq > cursor) await setCursor(maxSeq)
    return { received, applied, skipped }
  },

  async pullJournalDrain(maxBatches = 20, limit = 200) {
    const safeLimit = Math.min(200, Math.max(1, Math.round(Number(limit) || 200)))
    const safeBatches = Math.min(50, Math.max(1, Math.round(Number(maxBatches) || 20)))
    let total = { received: 0, applied: 0, skipped: 0 }
    let cursor = await lastCursor()
    for (let i = 0; i < safeBatches; i++) {
      const r = await this.pullJournal(safeLimit)
      total.received += Number(r.received || 0)
      total.applied += Number(r.applied || 0)
      total.skipped += Number(r.skipped || 0)
      const next = await lastCursor()
      if (Number(r.received || 0) < safeLimit || next <= cursor) break
      cursor = next
    }
    return total
  },

  async reconcileActiveLinks(limit = 50) {
    const cfg = await safeConfig()
    if (!cfg.enabled) return { checked: 0, queued: 0, skipped: 0 }
    const take = Math.min(100, Math.max(1, Math.round(Number(limit) || 50)))
    const lastId = Math.max(0, Math.round(Number((await readSetting(WOO_RECONCILE_LAST_ID_KEY)) ?? 0) || 0))
    const firstBatch = await db().wooProductLink.findMany({
      where: { status: WooLinkStatus.ACTIVE, id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take
    })
    const links = firstBatch.length >= take ? firstBatch : firstBatch.concat(await db().wooProductLink.findMany({
      where: { status: WooLinkStatus.ACTIVE, id: { lte: lastId } },
      orderBy: { id: 'asc' },
      take: take - firstBatch.length
    }))
    if (!links.length) return { checked: 0, queued: 0, skipped: 0 }
    await setSettingMonotonic(WOO_RECONCILE_LAST_ID_KEY, Number(links[links.length - 1].id || 0)).catch(() => undefined)
    const cursor = await lastCursor()
    const remote = await this.remoteStock(links)
    const byKey = new Map(remote.map((r: any) => [String(r.holderKey), r]))
    let checked = 0
    let queued = 0
    let skipped = 0
    for (const link of links) {
      const r = byKey.get(String(link.holderKey)) as any
      if (!r) {
        // لینک ممکن است حین درخواست شبکه unlink شده باشد؛ فقط snapshot ثابت mutation می‌گیرد.
        await updateLinkIfSnapshotUnchanged(link, { status: WooLinkStatus.BROKEN_REMOTE })
        skipped++
        continue
      }
      if (!remoteStockUsable(r)) {
        const changed = await updateLinkIfSnapshotUnchanged(link, { status: WooLinkStatus.BROKEN_REMOTE })
        if (changed) await log('RECONCILE_BROKEN_REMOTE', 'بررسی دوره‌ای متوقف شد چون holder سایت موجودی مستقل عددی ندارد', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { manageStock: r.manageStock, manageStockMode: r.manageStockMode, stockQuantity: r.stockQuantity } })
        skipped++
        continue
      }
      checked++
      if (r.lastSeq != null && Number(r.lastSeq) > cursor) {
        skipped++
        await log('RECONCILE_WAIT_JOURNAL', 'بررسی دوره‌ای تا خواندن کامل ژورنال سایت عقب افتاد', { level: 'INFO', linkId: link.id, variantId: link.variantId, payload: { siteLastSeq: r.lastSeq, cursor } })
        continue
      }
      const localStock = await productStock(link.variantId).catch(() => null)
      if (localStock == null) {
        await updateLinkIfSnapshotUnchanged(link, { status: WooLinkStatus.BROKEN_LOCAL })
        skipped++
        continue
      }
      const target = publishedQty(localStock)
      const remotePublished = publishedQty(r.stockQuantity)
      if (target === remotePublished) {
        if (Number(link.lastWooQty) !== Number(r.stockQuantity) || Number(link.lastMahakQty) !== Number(localStock))
          await updateLinkIfSnapshotUnchanged(link, { lastWooQty: wooSafeInt(r.stockQuantity), lastMahakQty: Number(localStock) })
        continue
      }
      const changed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
        if (!fresh || fresh.status !== link.status || !sameDbTime(fresh.updatedAt, link.updatedAt)) return false
        const open = await (tx as any).wooSyncOutbox.count({ where: { linkId: link.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT, WooOutboxStatus.IN_FLIGHT] } } })
        if (open) return false
        await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.CONFLICT, pauseReason: 'RECONCILE_DISCREPANCY', pausedAt: new Date(), pauseSeqFloor: fresh.pauseSeqFloor == null ? BigInt(cursor) : BigInt(fresh.pauseSeqFloor) } })
        await ensureApproval({ client: tx as any, action: WooApprovalAction.RECONCILE_DISCREPANCY, linkId: link.id, variantId: link.variantId, holderKey: link.holderKey, reason: 'RECONCILE_DISCREPANCY', title: 'اختلاف دوره‌ای موجودی سایت و فروشگاه', message: 'پس از خواندن ژورنال سایت، موجودی MAHAK و Woo هنوز متفاوت است. برای جلوگیری از overwrite کور، تصمیم مدیر لازم است.', payload: { mahakStock: localStock, wooQty: r.stockQuantity, target, cursor } })
        return true
      }, TX_OPTIONS).catch(() => false)
      if (changed) {
        await log('RECONCILE_DIFF', 'اختلاف دوره‌ای موجودی سایت پیدا شد و برای تأیید مدیر نگه داشته شد', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { mahakStock: localStock, wooQty: r.stockQuantity, target } })
        queued++
      } else {
        skipped++
      }
    }
    return { checked, queued, skipped }
  },

  async retryParked(limit = 50, userId: number | null = null) {
    const rows = await db().wooInboundEvent.findMany({
      where: { status: WooInboundStatus.PARKED },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      take: Math.min(100, Math.max(1, Math.round(Number(limit) || 50)))
    })
    let applied = 0
    let skipped = 0
    let failed = 0
    for (const row of rows) {
      try {
        const link = row.linkId
          ? await db().wooProductLink.findUnique({ where: { id: row.linkId } })
          : await db().wooProductLink.findFirst({ where: { holderKey: row.holderKey, status: { not: WooLinkStatus.UNLINKED } } })
        if (!link || link.status !== WooLinkStatus.ACTIVE || row.relinkId) {
          skipped++
          continue
        }
        if (String(row.source ?? '') === 'mahak_apply') {
          await log('PARKED_RETRY_ECHO_SKIPPED', 'رویداد echo اعمال MAHAK بدون outbox متناظر از پردازش گروهی پارک‌شده‌ها کنار گذاشته شد', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { inboundEventId: row.id, requestId: row.requestId } })
          skipped++
          continue
        }
        const relinkFloor = link.relinkSeqFloor == null ? null : Number(link.relinkSeqFloor)
        if (relinkFloor != null && row.seq != null && Number(row.seq) <= relinkFloor) {
          if (canSupersedeByRelinkFloor(link, row)) {
            await db().wooInboundEvent.update({ where: { id: row.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId: link.lastRelinkId ?? null, processedAt: new Date() } }).catch(() => null)
            await db().wooApproval.updateMany({ where: { sourceType: 'WooInboundEvent', sourceId: row.id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolution: 'SUPERSEDED_BY_RELINK_FLOOR', resolutionNote: 'این رویداد در snapshot وصل/حل اختلاف قبلی پوشش داده شده بود.' } }).catch(() => null)
          } else {
            await log('PARKED_HELD_BY_RELINK_FLOOR', 'رویداد سفارش/Refund پارک‌شده قبل از floor قبلی بود و بدون تصمیم صریح مدیر حذف نشد', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { inboundEventId: row.id, seq: row.seq == null ? null : Number(row.seq), resumeDecision: link.resumeDecision } })
          }
          skipped++
          continue
        }
        let didApply = false
        let overAllowance = false
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
          if (!freshLink || freshLink.status !== WooLinkStatus.ACTIVE || row.relinkId) return
          const fresh = await (tx as any).wooInboundEvent.findUnique({ where: { id: row.id } })
          if (!fresh || fresh.status !== WooInboundStatus.PARKED) return
          const freshRelinkFloor = freshLink.relinkSeqFloor == null ? null : Number(freshLink.relinkSeqFloor)
          if (freshRelinkFloor != null && fresh.seq != null && Number(fresh.seq) <= freshRelinkFloor) {
            if (canSupersedeByRelinkFloor(freshLink, fresh)) {
              await (tx as any).wooInboundEvent.update({ where: { id: fresh.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId: freshLink.lastRelinkId ?? null, processedAt: new Date() } })
              await (tx as any).wooApproval.updateMany({ where: { sourceType: 'WooInboundEvent', sourceId: fresh.id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolution: 'SUPERSEDED_BY_RELINK_FLOOR', resolutionNote: 'این رویداد در snapshot وصل/حل اختلاف قبلی پوشش داده شده بود.' } })
            }
            return
          }
          await assertNoFreshInFlight(tx as any, link.id)
          const existingMove = await (tx as any).stockMovement.findFirst({ where: { refType: 'WooInboundEvent', refId: row.id }, select: { id: true } })
          let movementId = existingMove?.id == null ? null : Number(existingMove.id)
          let stock = await productStock(link.variantId, tx as any)
          if (!movementId) {
            const delta = Number(fresh.delta || 0)
            if (delta > 0 && isWooRestoreSource(fresh.source)) {
              const allowed = await remainingRestoreAllowance({ client: tx as any, variantId: link.variantId, orderId: fresh.orderId })
              if (delta > allowed) {
                overAllowance = true
                return
              }
            }
            const r = await applyWooDelta({ eventId: row.id, variantId: link.variantId, delta, note: `پردازش دوباره رویداد سایت${fresh.orderId ? ` · سفارش ${fresh.orderId}` : ''}`, tx })
            movementId = r.movementId
            stock = r.stock
          }
          await (tx as any).wooInboundEvent.update({ where: { id: row.id }, data: { status: WooInboundStatus.APPLIED, linkId: link.id, variantId: link.variantId, movementId, processedAt: new Date() } })
          await (tx as any).wooApproval.updateMany({ where: { sourceType: 'WooInboundEvent', sourceId: row.id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.APPROVED, resolvedAt: new Date(), resolvedBy: userId ?? null, resolution: 'BULK_RETRY_APPLIED', resolutionNote: 'پردازش دستی پارک‌شده‌ها' } })
          await (tx as any).wooSyncOutbox.updateMany({
            where: { linkId: link.id, status: { in: openOutboxStatuses() } },
            data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'REBASING_AFTER_PARKED_RETRY', updatedAt: new Date() }
          })
          const wooBase = await wooBaseAfterInboundEvent(tx as any, link, row)
          const targetAfterInbound = publishedQty(stock)
          if (targetAfterInbound !== publishedQty(wooBase)) {
            await createOutbox({ client: tx as any, link: { ...link, lastWooQty: wooBase }, variantId: link.variantId, kind: 'STOCK_PUSH_REBASED', targetQty: targetAfterInbound, expectedWooQty: wooBase, skipLoopFuse: isWooOrderPausedEvent(row) })
          }
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: wooBase, lastMahakQty: stock } })
          didApply = true
        }, TX_OPTIONS)
        if (didApply) applied++
        else {
          if (overAllowance) await log('PARKED_RETRY_OVER_ALLOWANCE', 'رویداد Refund/برگشت سایت از سقف فروش ثبت‌شده بیشتر بود و پارک ماند', { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { inboundEventId: row.id, orderId: row.orderId, delta: row.delta } })
          skipped++
        }
      } catch (e) {
        failed++
        await log('PARKED_RETRY_FAILED', String((e as any)?.message ?? e), { level: 'ERROR', payload: { inboundEventId: row.id } })
      }
    }
    return { applied, skipped, failed, total: rows.length }
  },

  async approvals(params: { take?: number } = {}): Promise<WooApprovalRow[]> {
    const take = Math.min(200, Math.max(20, Math.round(Number(params.take) || 50)))
    const rows = await db().wooApproval.findMany({ where: { status: WooApprovalStatus.PENDING }, orderBy: { createdAt: 'asc' }, take })
    return rows.map((r: any) => ({
      id: Number(r.id),
      action: String(r.action ?? ''),
      status: String(r.status ?? ''),
      linkId: r.linkId == null ? null : Number(r.linkId),
      variantId: r.variantId == null ? null : Number(r.variantId),
      holderKey: r.holderKey ?? null,
      reason: String(r.reason ?? ''),
      title: String(r.title ?? ''),
      message: String(r.message ?? ''),
      payload: parseJsonValue(r.payloadJson),
      createdAt: asDateString(r.createdAt) ?? ''
    }))
  },

  async resolveApproval(input: { approvalId?: number; decision?: string; note?: string | null; userId?: number | null }) {
    const id = int(input.approvalId, 'شناسه تأیید', { positive: true })
    const decision = String(input.decision || WooResumeDecision.MAHAK_WINS)
    const approval = await db().wooApproval.findUnique({ where: { id } })
    if (!approval || approval.status !== WooApprovalStatus.PENDING) throw new BusinessError('درخواست تأیید پیدا نشد یا قبلاً تعیین تکلیف شده است.')
    if (decision === 'REJECT') {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const freshApproval = await (tx as any).wooApproval.findUnique({ where: { id } })
        if (!freshApproval || freshApproval.status !== WooApprovalStatus.PENDING) throw new BusinessError('درخواست تأیید قبلاً تعیین تکلیف شده است؛ فهرست را تازه کنید.')
        const rejected = await (tx as any).wooApproval.updateMany({ where: { id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.REJECTED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: decision, resolutionNote: input.note ?? null } })
        if (!rejected.count) throw new BusinessError('درخواست تأیید قبلاً تعیین تکلیف شده است؛ فهرست را تازه کنید.')
        if (freshApproval.action === WooApprovalAction.APPLY_INBOUND && freshApproval.sourceType === 'WooInboundEvent' && freshApproval.sourceId != null) {
          await (tx as any).wooInboundEvent.updateMany({
            where: { id: Number(freshApproval.sourceId), status: { in: [WooInboundStatus.PARKED, WooInboundStatus.SKIPPED_PAUSED] } },
            data: { status: WooInboundStatus.SUPERSEDED, processedAt: new Date() }
          })
          await (tx as any).wooApproval.updateMany({
            where: { id: { not: id }, action: WooApprovalAction.APPLY_INBOUND, status: WooApprovalStatus.PENDING, sourceType: 'WooInboundEvent', sourceId: Number(freshApproval.sourceId) },
            data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'EVENT_REJECTED', resolutionNote: 'این رویداد ورودی با تصمیم مدیر رد شد.' }
          })
        }
      }, TX_OPTIONS)
      await log('APPROVAL_REJECTED', 'درخواست تأیید Woo رد شد', { level: 'WARN', linkId: approval.linkId, variantId: approval.variantId, payload: { approvalId: id, reason: approval.reason } })
      return { approvals: await this.approvals(), links: await this.links(), status: await this.status() }
    }

    if (approval.action === WooApprovalAction.APPLY_INBOUND) {
      const event = approval.sourceId == null ? null : await db().wooInboundEvent.findUnique({ where: { id: Number(approval.sourceId) } })
      if (!event || ![WooInboundStatus.PARKED, WooInboundStatus.SKIPPED_PAUSED].includes(String(event.status) as any)) {
        await db().wooApproval.update({ where: { id }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'EVENT_ALREADY_HANDLED', resolutionNote: 'رویداد ورودی دیگر قابل اعمال نیست یا قبلاً تعیین تکلیف شده است.' } }).catch(() => null)
        throw new BusinessError('رویداد ورودی قابل اعمال نیست یا قبلاً پردازش شده است.')
      }
      const link = event.linkId
        ? await db().wooProductLink.findUnique({ where: { id: event.linkId } })
        : await db().wooProductLink.findFirst({ where: { holderKey: event.holderKey, status: { not: WooLinkStatus.UNLINKED } } })
      if (!link || link.status === WooLinkStatus.UNLINKED) {
        await db().wooApproval.update({ where: { id }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'LINK_MISSING', resolutionNote: 'لینک این رویداد دیگر وجود ندارد.' } }).catch(() => null)
        throw new BusinessError('لینک این رویداد دیگر وجود ندارد.')
      }
      const relinkFloor = link.relinkSeqFloor == null ? null : Number(link.relinkSeqFloor)
      const sameRelinkParked = event.status === WooInboundStatus.PARKED && event.relinkId && event.relinkId === link.lastRelinkId
      if (relinkFloor != null && event.seq != null && Number(event.seq) <= relinkFloor && !sameRelinkParked && canSupersedeByRelinkFloor(link, event)) {
        await db().wooInboundEvent.update({ where: { id: event.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId: link.lastRelinkId ?? null, processedAt: new Date() } }).catch(() => null)
        await db().wooApproval.update({ where: { id }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'SUPERSEDED_BY_RELINK_FLOOR', resolutionNote: 'این رویداد در snapshot وصل/حل اختلاف قبلی پوشش داده شده بود.' } }).catch(() => null)
        throw new BusinessError('این رویداد قبل از آخرین وصل/حل اختلاف سایت ثبت شده و قبلاً در snapshot آن تصمیم پوشش داده شده است.')
      }
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const fresh = await (tx as any).wooInboundEvent.findUnique({ where: { id: event.id } })
        if (!fresh || ![WooInboundStatus.PARKED, WooInboundStatus.SKIPPED_PAUSED].includes(String(fresh.status) as any)) throw new BusinessError('رویداد ورودی قابل اعمال نیست یا قبلاً پردازش شده است.')
        // مثل retryParked و مسیر تصمیم مرجع موجودی: لینک را داخل همان تراکنش با اسنپ‌شات مقایسه می‌کنیم.
        // اگر هم‌زمان (مثلاً پاسخ 409 یک ارسال IN_FLIGHT یا یک اقدام IPC دیگر) وضعیت لینک را عوض کرده باشد،
        // اعمال روی اسنپ‌شات کهنه abort می‌شود؛ چون claim تأیید داخل همین تراکنش است، پس از rollback تأیید
        // همچنان PENDING می‌ماند و مدیر با وضعیت تازه‌ی صف دوباره تصمیم می‌گیرد.
        const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
        if (!freshLink || freshLink.status !== link.status || !sameDbTime(freshLink.updatedAt, link.updatedAt)) throw new BusinessError('وضعیت اتصال هم‌زمان تغییر کرده است؛ این تأیید روی اسنپ‌شات قدیمی اعمال نشد. فهرست را تازه کنید و دوباره تصمیم بگیرید.')
        await assertNoFreshInFlight(tx as any, link.id)
        const claimed = await (tx as any).wooApproval.updateMany({ where: { id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.APPROVED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: decision, resolutionNote: input.note ?? null } })
        if (!claimed.count) throw new BusinessError('درخواست تأیید قبلاً تعیین تکلیف شده است؛ فهرست را تازه کنید.')
        const manualRelinkReview = fresh.status === WooInboundStatus.PARKED && fresh.relinkId && fresh.relinkId === link.lastRelinkId
        const existingMove = await (tx as any).stockMovement.findFirst({ where: { refType: 'WooInboundEvent', refId: event.id }, select: { id: true } })
        let movementId = existingMove?.id == null ? null : Number(existingMove.id)
        let stock = await productStock(link.variantId, tx as any)
        const delta = Number(event.delta || 0)
        if (!movementId) {
          if (delta > 0 && isWooRestoreSource(event.source) && !manualRelinkReview) {
            const allowed = await remainingRestoreAllowance({ client: tx as any, variantId: link.variantId, orderId: event.orderId })
            if (delta > allowed) throw new BusinessError('مقدار برگشت/Refund از فروش ثبت‌شده بیشتر است؛ بدون بررسی دستی دقیق‌تر اعمال نشد.')
          }
          const r = await applyWooDelta({ eventId: event.id, variantId: link.variantId, delta, note: `تأیید مدیر برای رویداد سایت${event.orderId ? ` · سفارش ${event.orderId}` : ''}`, tx })
          movementId = r.movementId
          stock = r.stock
        }
        await (tx as any).wooInboundEvent.update({ where: { id: event.id }, data: { status: WooInboundStatus.APPLIED, movementId, processedAt: new Date() } })
        const wooBase = await wooBaseAfterInboundEvent(tx as any, freshLink, event)
        if (freshLink.status === WooLinkStatus.ACTIVE) {
          await (tx as any).wooSyncOutbox.updateMany({ where: { linkId: link.id, status: { in: openOutboxStatuses() } }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'REBASING_AFTER_APPROVED_INBOUND', updatedAt: new Date() } })
          const targetAfterInbound = publishedQty(stock)
          if (targetAfterInbound !== publishedQty(wooBase)) await createOutbox({ client: tx as any, link: { ...freshLink, lastWooQty: wooBase }, variantId: link.variantId, kind: 'STOCK_PUSH_REBASED', targetQty: targetAfterInbound, expectedWooQty: wooBase, skipLoopFuse: true })
        }
        await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: wooBase, lastMahakQty: stock } })
      }, TX_OPTIONS)
      await log('APPROVAL_APPLY_INBOUND', 'رویداد سایت با تأیید مدیر روی موجودی MAHAK اعمال شد', { linkId: link.id, variantId: link.variantId, payload: { approvalId: id, eventId: event.id, decision } })
      return { approvals: await this.approvals(), links: await this.links(), status: await this.status() }
    }

    if ([WooApprovalAction.RECONCILE_DISCREPANCY, WooApprovalAction.CONFLICT_RESOLUTION, WooApprovalAction.LOOP_FUSE, WooApprovalAction.UNFREEZE_LINK].includes(String(approval.action) as any)) {
      const link = approval.linkId == null ? null : await db().wooProductLink.findUnique({ where: { id: Number(approval.linkId) } })
      if (!link || link.status === WooLinkStatus.UNLINKED) throw new BusinessError('لینک تأیید دیگر فعال نیست.')
      if (![WooResumeDecision.MAHAK_WINS, WooResumeDecision.WOO_WINS, WooResumeDecision.VERIFY_ONLY, WooResumeDecision.NOOP, 'UNFREEZE'].includes(decision as any)) throw new BusinessError('تصمیم انتخاب‌شده برای این نوع تأیید معتبر نیست.')
      if (link.status === WooLinkStatus.ACTIVE) {
        await db().wooApproval.update({ where: { id }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'STALE_ACTIVE_LINK', resolutionNote: 'لینک هنگام تعیین تکلیف این درخواست سالم و فعال بود؛ درخواست قدیمی منقضی شد.' } }).catch(() => null)
        throw new BusinessError('این درخواست تأیید قدیمی است و لینک اکنون فعال و سالم است؛ فهرست را تازه کنید.')
      }

      // قبل از snapshot تصمیم مدیر، ژورنال سایت را تا حد ممکن خالی می‌کنیم تا رویدادهای زمان قطع دوباره‌شماری نشوند.
      await this.pullJournalDrain(5, 200)
      const freshRemoteForDecision = (await this.remoteStock([link]))[0]
      if (!remoteStockUsable(freshRemoteForDecision)) {
        // بین خوان لینک و پاسخ شبکه ممکن است unlink/pause رخ داده باشد؛ فقط snapshot ثابت به BROKEN_REMOTE می‌رود.
        await updateLinkIfSnapshotUnchanged(link, { status: WooLinkStatus.BROKEN_REMOTE })
        throw new BusinessError('سایت برای این اتصال موجودی مستقل عددی ندارد؛ انتخاب مرجع یا فعال‌سازی بدون تغییر مجاز نیست.')
      }
      const remoteLastSeq = freshRemoteForDecision.lastSeq == null ? null : Number(freshRemoteForDecision.lastSeq)
      if (remoteLastSeq != null) {
        let cursor = await lastCursor()
        for (let guard = 0; cursor < remoteLastSeq && guard < 30; guard++) {
          await this.pullJournal(200)
          const next = await lastCursor()
          if (next <= cursor) break
          cursor = next
        }
        if ((await lastCursor()) < remoteLastSeq) throw new BusinessError('ژورنال سایت هنوز کامل نشده است؛ چند ثانیه بعد دوباره تصمیم تأیید را اعمال کنید.')
      }

      const relinkId = randomUUID()
      let supersededPausedEvents = 0
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const freshLink = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
        if (!freshLink || freshLink.status === WooLinkStatus.UNLINKED) throw new BusinessError('لینک تأیید دیگر فعال نیست.')
        if (freshLink.status === WooLinkStatus.ACTIVE) {
          await (tx as any).wooApproval.update({ where: { id }, data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'STALE_ACTIVE_LINK', resolutionNote: 'لینک هنگام تعیین تکلیف این درخواست سالم و فعال بود؛ درخواست قدیمی منقضی شد.' } })
          throw new BusinessError('این درخواست تأیید قدیمی است و لینک اکنون فعال و سالم است؛ فهرست را تازه کنید.')
        }
        // بین خوان لینک و شروع این تراکنش چند درخواست شبکه (drain/snapshot) انجام می‌شود؛ اگر مدیر در همین فاصله
        // اتصال را قطع/تغییر داده باشد، اعمال تصمیم روی اسنپ‌شات کهنه ممنوع است. چون claim داخل همین تراکنش است،
        // rollback باعث می‌شود تأیید PENDING بماند و مدیر با وضعیت تازه دوباره تصمیم بگیرد.
        if (freshLink.status !== link.status || !sameDbTime(freshLink.updatedAt, link.updatedAt)) throw new BusinessError('وضعیت اتصال هم‌زمان تغییر کرده است؛ این تأیید روی اسنپ‌شات قدیمی اعمال نشد. فهرست را تازه کنید و دوباره تصمیم بگیرید.')
        const claimed = await (tx as any).wooApproval.updateMany({ where: { id, status: WooApprovalStatus.PENDING }, data: { status: WooApprovalStatus.APPROVED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: decision, resolutionNote: input.note ?? null } })
        if (!claimed.count) throw new BusinessError('درخواست تأیید قبلاً تعیین تکلیف شده است؛ فهرست را تازه کنید.')
        await assertNoFreshInFlight(tx as any, link.id)
        const localStock = await productStock(link.variantId, tx as any)
        const wooQty = wooSafeInt(freshRemoteForDecision.stockQuantity)
        const heldEvents = await (tx as any).wooInboundEvent.findMany({ where: heldInboundWhere(freshLink, null), select: { id: true, source: true, orderId: true, delta: true, seq: true, status: true } })
        if (hasHeldAfter(heldEvents, remoteLastSeq)) throw new BusinessError('از زمان گرفتن snapshot سایت، رویداد تازه‌ای رسیده است؛ دوباره تصمیم تأیید را اعمال کنید.')
        const orderPausedEvents = heldEvents.filter((e: any) => isWooOrderPausedEvent(e) && Number(e.delta || 0) !== 0)
        if (orderPausedEvents.length && decision !== WooResumeDecision.WOO_WINS) {
          throw new BusinessError('این لینک رویداد سفارش/Refund سایت در زمان توقف/پارک دارد. برای جلوگیری از حذف فروش واقعی، ابتدا از پیش‌نمایش وصل دوباره با گزینه «MAHAK + سفارش‌های سایت» استفاده کنید یا خود همان رویداد ورودی را تأیید کنید.')
        }
        if (heldEvents.length && (decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP || decision === 'UNFREEZE')) {
          throw new BusinessError('فعال‌سازی بدون تغییر فقط وقتی مجاز است که رویداد زمان قطع/پارک باقی نمانده باشد.')
        }
        await (tx as any).wooSyncOutbox.updateMany({
          where: { linkId: link.id, status: { in: openOutboxStatuses() } },
          data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'APPROVAL_RECONCILED', updatedAt: new Date() }
        })
        const heldIds = heldEvents.map((e: any) => Number(e.id)).filter((x: number) => Number.isFinite(x))
        if (heldIds.length) {
          const upd = await (tx as any).wooInboundEvent.updateMany({ where: { id: { in: heldIds } }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
          supersededPausedEvents += Number(upd.count || 0)
          await expireApplyInboundApprovals({ client: tx as any, linkId: link.id, eventIds: heldIds, userId: input.userId ?? null, resolution: 'SUPERSEDED_BY_' + decision, note: 'رویداد زمان قطع/پارک با تصمیم مرجع موجودی تعیین تکلیف شد.' })
        }
        const relinkFloor = remoteLastSeq == null ? freshLink.relinkSeqFloor : BigInt(remoteLastSeq)
        const commonLinkData = { relinkSeqFloor: relinkFloor, lastRelinkId: relinkId, resumedAt: new Date(), resumedBy: input.userId ?? null, resumeDecision: decision }
        if (decision === WooResumeDecision.WOO_WINS) {
          const r = await applyWooDelta({ variantId: link.variantId, delta: wooQty - localStock, reason: StockReason.WOO_SYNC_ADJUST, note: 'تأیید مدیر Woo: سایت مرجع موجودی شد', tx })
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { ...commonLinkData, status: WooLinkStatus.ACTIVE, lastWooQty: wooQty, lastMahakQty: r.stock } })
        } else if (decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP || decision === 'UNFREEZE') {
          if (publishedQty(localStock) !== publishedQty(wooQty)) throw new BusinessError('فعال‌سازی بدون تغییر فقط وقتی مجاز است که موجودی منتشرشده دو طرف برابر باشد.')
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { ...commonLinkData, status: WooLinkStatus.ACTIVE, lastWooQty: wooQty, lastMahakQty: localStock } })
        } else if (decision === WooResumeDecision.MAHAK_WINS) {
          await createOutbox({ client: tx as any, link: { ...freshLink, lastWooQty: wooQty }, variantId: link.variantId, kind: 'RECONCILE_PUSH', targetQty: localStock, expectedWooQty: wooQty, skipLoopFuse: true })
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { ...commonLinkData, status: WooLinkStatus.PAUSED, pauseReason: 'APPROVED_RECONCILE_PUSH', pausedAt: new Date(), lastWooQty: wooQty, lastMahakQty: localStock } })
        }
        await (tx as any).wooApproval.updateMany({
          where: { id: { not: id }, linkId: link.id, status: WooApprovalStatus.PENDING, action: { in: [WooApprovalAction.RECONCILE_DISCREPANCY, WooApprovalAction.CONFLICT_RESOLUTION, WooApprovalAction.LOOP_FUSE, WooApprovalAction.UNFREEZE_LINK] } },
          data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'SUPERSEDED_BY_' + decision, resolutionNote: 'این درخواست با تصمیم جدید مدیر تعیین تکلیف شد.' }
        })
      }, TX_OPTIONS)
      await log('APPROVAL_RESOLVED', 'درخواست تأیید Woo با تصمیم مدیر تعیین تکلیف شد', { linkId: link.id, variantId: link.variantId, payload: { approvalId: id, decision, action: approval.action, remoteLastSeq, supersededPausedEvents } })
      return { approvals: await this.approvals(), links: await this.links(), status: await this.status() }
    }

    throw new BusinessError('نوع درخواست تأیید برای این نسخه پشتیبانی نمی‌شود.')
  },

  async pauseProductGroup(input: { linkId?: number; note?: string | null; userId?: number | null }) {
    const id = int(input.linkId, 'شناسه اتصال', { positive: true })
    const row = await db().wooProductLink.findUnique({ where: { id }, include: { variant: true } }).catch(() => null)
    const productId = row?.variant?.productId
    if (!productId) throw new BusinessError('گروه محصول این اتصال پیدا نشد.')
    const links = await db().wooProductLink.findMany({ where: { status: WooLinkStatus.ACTIVE, variant: { productId } }, select: { id: true } })
    if (!links.length) throw new BusinessError('هیچ اتصال فعالی در گروه این محصول پیدا نشد.')
    return this.pause({ linkIds: links.map((x: any) => Number(x.id)), note: input.note ?? 'قطع گروهی رنگ/سایزهای محصول', userId: input.userId ?? null })
  },

  async resumeProductGroupMahak(input: { linkId?: number; managerPassword?: string; userId?: number | null }) {
    const id = int(input.linkId, 'شناسه اتصال', { positive: true })
    const row = await db().wooProductLink.findUnique({ where: { id }, include: { variant: true } }).catch(() => null)
    const productId = row?.variant?.productId
    if (!productId) throw new BusinessError('گروه محصول این اتصال پیدا نشد.')
    await this.pullJournalDrain(10, 200)
    const rows = await db().wooProductLink.findMany({ where: { status: { in: [WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT] }, variant: { productId } }, orderBy: { id: 'asc' } })
    let queued = 0
    let skipped = 0
    const skippedLinks: Array<{ linkId: number; reason: string }> = []
    const skipLink = async (link: any, reason: string, message: string) => {
      skipped++
      skippedLinks.push({ linkId: Number(link.id), reason })
      await log('GROUP_RESUME_SKIPPED_' + reason, message, { level: 'WARN', linkId: link.id, variantId: link.variantId, payload: { productId } })
    }
    for (const link of rows) {
      const remote = (await this.remoteStock([link]).catch(() => []))[0]
      if (!remoteStockUsable(remote)) {
        await skipLink(link, 'REMOTE_UNUSABLE', 'وصل گروهی با MAHAK برای یک لینک رد شد چون موجودی سایت مستقل/عددی نیست')
        continue
      }
      const remoteLastSeq = remote.lastSeq == null ? null : Number(remote.lastSeq)
      if (remoteLastSeq != null && (await lastCursor()) < remoteLastSeq) {
        await skipLink(link, 'JOURNAL_NOT_DRAINED', 'وصل گروهی با MAHAK برای یک لینک رد شد چون ژورنال سایت هنوز کامل خوانده نشده است')
        continue
      }
      let didQueue = false
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
          if (!fresh || ![WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT].includes(String(fresh.status) as any)) return
          // اگر بعد از خواندن فهرست، مدیر این لینک را دوباره تغییر داده باشد، وصل گروهی با اسنپ‌شات کهنه اجرا نمی‌شود.
          if (!sameDbTime(fresh.updatedAt, link.updatedAt)) return
          await assertNoFreshInFlight(tx as any, link.id)
          const held = await (tx as any).wooInboundEvent.findMany({ where: heldInboundWhere(fresh, null), select: { id: true, seq: true, source: true, orderId: true, delta: true, status: true } })
          if (held.length > 0) return
          const stock = await productStock(link.variantId, tx as any)
          const relinkId = randomUUID()
          await createOutbox({ client: tx as any, link: { ...fresh, lastWooQty: wooSafeInt(remote.stockQuantity) }, variantId: link.variantId, kind: 'RECONCILE_PUSH', targetQty: stock, expectedWooQty: wooSafeInt(remote.stockQuantity), skipLoopFuse: true })
          await (tx as any).wooProductLink.update({
            where: { id: link.id },
            data: {
              status: WooLinkStatus.PAUSED,
              pauseReason: 'GROUP_MAHAK_WINS',
              pausedAt: new Date(),
              resumedBy: input.userId ?? null,
              resumeDecision: WooResumeDecision.MAHAK_WINS,
              relinkSeqFloor: remoteLastSeq == null ? fresh.relinkSeqFloor : BigInt(remoteLastSeq),
              lastRelinkId: relinkId,
              lastWooQty: wooSafeInt(remote.stockQuantity),
              lastMahakQty: stock
            }
          })
          // مثل وصل تک‌لینک، تأییدهای قدیمی reconcile/conflict/loop-fuse باید با همین تصمیم منقضی شوند تا صف تأیید stale نماند.
          await (tx as any).wooApproval.updateMany({
            where: { linkId: link.id, status: WooApprovalStatus.PENDING, action: { in: [WooApprovalAction.RECONCILE_DISCREPANCY, WooApprovalAction.CONFLICT_RESOLUTION, WooApprovalAction.LOOP_FUSE, WooApprovalAction.UNFREEZE_LINK] } },
            data: { status: WooApprovalStatus.EXPIRED, resolvedAt: new Date(), resolvedBy: input.userId ?? null, resolution: 'SUPERSEDED_BY_GROUP_MAHAK_WINS', resolutionNote: 'این درخواست با وصل گروهی مرجع MAHAK تعیین تکلیف شد.' }
          })
          didQueue = true
        }, TX_OPTIONS)
      } catch (e) {
        await skipLink(link, 'IN_FLIGHT_OR_ERROR', String((e as any)?.message ?? e))
        continue
      }
      if (didQueue) queued++
      else await skipLink(link, 'HELD_OR_STALE', 'وصل گروهی با MAHAK برای یک لینک رد شد چون رویداد حل‌نشده، ارسال درحال‌انجام یا وضعیت کهنه دارد')
    }
    await log('GROUP_RESUME_MAHAK', 'وصل گروهی رنگ/سایز با مرجع MAHAK ثبت شد', { payload: { productId, queued, skipped, skippedLinks } })
    return { queued, skipped, skippedLinks, links: await this.links(), status: await this.status() }
  },

  async syncNow() {
    if (busy) {
      const status = await this.status()
      return { pulled: { received: 0, applied: 0, skipped: 1 }, pushed: { sent: 0, failed: 0, skipped: 1 }, busy: true, status }
    }
    busy = true
    try {
      const errors: Array<{ phase: string; message: string }> = []
      let pulled: any = { received: 0, applied: 0, skipped: 0, lastSeq: await lastCursor() }
      let reconciled: any = { checked: 0, queued: 0, skipped: 0 }
      let pushed: any = { sent: 0, failed: 0, skipped: 0 }
      try {
        pulled = await this.pullJournalDrain(20, 200)
      } catch (e: any) {
        const message = String(e?.message ?? e)
        errors.push({ phase: 'pull', message })
        await log('SYNC_PULL_FAILED', message, { level: 'ERROR' })
      }
      try {
        reconciled = await this.reconcileActiveLinks(50)
      } catch (e: any) {
        const message = String(e?.message ?? e)
        errors.push({ phase: 'reconcile', message })
        await log('SYNC_RECONCILE_FAILED', message, { level: 'ERROR' })
      }
      try {
        pushed = await this.processOutbox(100)
      } catch (e: any) {
        const message = String(e?.message ?? e)
        errors.push({ phase: 'push', message })
        await log('SYNC_PUSH_FAILED', message, { level: 'ERROR' })
      }
      await log('SYNC_NOW', 'همگام‌سازی دستی انجام شد', { payload: { pulled, reconciled, pushed, errors } })
      const finalStatus = await this.status()
      // فیلد legacy باید مقدار واقعی نشان دهد، نه صفر همیشگی.
      return { parked: { applied: 0, skipped: 0, failed: 0, total: Number(finalStatus.counts?.parkedEvents || 0) }, pulled, reconciled, pushed, errors, status: finalStatus }
    } finally {
      busy = false
    }
  },

  async logs(params: { take?: number } = {}) {
    const take = Math.min(200, Math.max(20, Math.round(Number(params.take) || 80)))
    return db().wooSyncLog.findMany({ orderBy: { id: 'desc' }, take })
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let busy = false

export function startWooSyncScheduler(): void {
  if (timer) clearTimeout(timer)
  const schedule = (seconds: number) => {
    timer = setTimeout(() => void tick(), Math.min(3600, Math.max(30, Math.round(Number(seconds) || 120))) * 1000)
  }
  const tick = async () => {
    let nextSeconds = 120
    if (busy) {
      schedule(nextSeconds)
      return
    }
    busy = true
    try {
      const cfg = await safeConfig()
      nextSeconds = cfg.intervalSeconds
      if (cfg.enabled && cfg.autoSync) {
        await wooSyncService.pullJournalDrain(20, 200).catch((e) => log('AUTO_PULL_FAILED', String(e?.message ?? e), { level: 'ERROR' }))
        await wooSyncService.reconcileActiveLinks(50).catch((e) => log('AUTO_RECONCILE_FAILED', String(e?.message ?? e), { level: 'ERROR' }))
        await wooSyncService.processOutbox(100).catch((e) => log('AUTO_PUSH_FAILED', String(e?.message ?? e), { level: 'ERROR' }))
      }
    } finally {
      busy = false
      schedule(nextSeconds)
    }
  }
  void tick()
}
