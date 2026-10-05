/**
 * MAHAK ↔ WooCommerce Stock Sync
 *
 * مرز قطعی: فقط عدد موجودی (`stock_quantity`) sync می‌شود. هیچ قیمت، مبلغ سفارش،
 * مشتری، آدرس، مالیات یا گزارش فروش سایت وارد برنامه نمی‌شود و هیچ فیلدی جز
 * موجودی روی سایت نوشته نمی‌شود.
 */
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { audit } from './AuditService'
import { openSecret, sealSecret } from './PanelVault'
import { AuditAction, StockReason, StockState } from '@shared/enums'
import {
  WOO_SYNC_CURSOR_KEY,
  WOO_SYNC_SECRET_KEY,
  WOO_SYNC_SETTING_KEY,
  WooInboundStatus,
  WooLinkStatus,
  WooOutboxStatus,
  WooResumeDecision,
  normalizeWooBaseUrl,
  wooHolderKey,
  wooSafeInt,
  wooStockReason,
  type WooCatalogItem,
  type WooLinkRow,
  type WooResumePreviewEvent,
  type WooStatusView,
  type WooSyncSafeConfig
} from '@shared/wooSync'

const db = () => prisma as any
const REQUEST_TIMEOUT_MS = 20_000
const IN_FLIGHT_STALE_MS = 5 * 60_000
const MAX_OUTBOX_ATTEMPTS = 8

function publishedQty(raw: unknown): number {
  // WooCommerce نباید عدد منفی بگیرد؛ موجودی داخلی MAHAK می‌تواند منفی باشد، اما عدد منتشرشده روی سایت حداقل صفر است.
  return Math.max(0, wooSafeInt(raw))
}

function isReconcileOutboxKind(kind: unknown): boolean {
  return ['RECONCILE_PUSH', 'STOCK_PUSH_REBASED', 'DELETE_ZERO'].includes(String(kind || ''))
}

function openOutboxStatuses(): string[] {
  return [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT, WooOutboxStatus.DEAD, WooOutboxStatus.IN_FLIGHT]
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

function int(raw: unknown, label: string, opts: { positive?: boolean; allowZero?: boolean } = {}): number {
  const n = Math.round(Number(raw))
  const ok = Number.isSafeInteger(n) && (opts.positive ? n > 0 : opts.allowZero ? n >= 0 : true)
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

function isWooOrderPausedEvent(e: { source?: unknown; orderId?: unknown }): boolean {
  // در زمان وصل دوباره، فقط اثر واقعی سفارش سایت دوباره اعمال می‌شود.
  // ویرایش دستی/ادمین سایت حتی اگر در ژورنال مانده باشد خودکار اعمال نمی‌شود تا overwrite کورکورانه رخ ندهد.
  return /^(order|order_reduce|order_restore|refund_restock)$/.test(String(e.source ?? '').toLowerCase()) && String(e.orderId ?? '').trim() !== ''
}

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return row?.value ?? null
}

async function writeSetting(key: string, value: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  await client.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

async function rawConfig(): Promise<StoredConfig> {
  return safeJson(await readSetting(WOO_SYNC_SETTING_KEY)) ?? {}
}

async function readSecret(): Promise<string | null> {
  const blob = await readSetting(WOO_SYNC_SECRET_KEY)
  return openSecret(blob)
}

async function lastCursor(): Promise<number> {
  return Math.max(0, Math.round(Number((await readSetting(WOO_SYNC_CURSOR_KEY)) ?? 0) || 0))
}

async function setCursor(seq: number): Promise<void> {
  await writeSetting(WOO_SYNC_CURSOR_KEY, String(Math.max(0, Math.round(Number(seq) || 0))))
}

async function safeConfig(): Promise<WooSyncSafeConfig> {
  const c = await rawConfig()
  return {
    enabled: c.enabled === true,
    siteUrl: normalizeWooBaseUrl(c.siteUrl),
    autoSync: c.autoSync !== false,
    intervalSeconds: Math.min(3600, Math.max(30, Math.round(Number(c.intervalSeconds) || 120))),
    hasSecret: !!(await readSetting(WOO_SYNC_SECRET_KEY)),
    lastCursor: await lastCursor()
  }
}

async function fullConfig(): Promise<WooSyncSafeConfig & { secret: string }> {
  const c = await safeConfig()
  const secret = await readSecret()
  if (!c.siteUrl) throw new BusinessError('آدرس سایت WooCommerce تنظیم نشده است.')
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
      throw new BusinessError(`پاسخ سایت ناموفق بود (${res.status}): ${msg || 'خطای نامشخص'}`)
    }
    return data as T
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new BusinessError('ارتباط با سایت در مهلت مقرر پاسخ نداد؛ نتیجه همگام‌سازی نامعلوم نیست چون هیچ عملیات مالی انجام نشد، فقط دوباره تلاش کنید.')
    throw e
  } finally {
    clearTimeout(t)
  }
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
}) {
  const client = input.client ?? db()
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
      expectedWooQty: input.expectedWooQty == null ? (input.link.lastWooQty == null ? null : publishedQty(input.link.lastWooQty)) : publishedQty(input.expectedWooQty),
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
  const cfg = await safeConfig().catch(() => null)
  if (!cfg?.enabled) return
  const client = tx as any
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
  return prisma.$transaction(run)
}

export const wooSyncService = {
  async status(): Promise<WooStatusView> {
    const config = await safeConfig()
    const [activeLinks, pausedLinks, conflictLinks, pendingOutbox, failedOutbox, pausedEvents, lastLogs] = await Promise.all([
      db().wooProductLink.count({ where: { status: WooLinkStatus.ACTIVE } }).catch(() => 0),
      db().wooProductLink.count({ where: { status: WooLinkStatus.PAUSED } }).catch(() => 0),
      db().wooProductLink.count({ where: { status: WooLinkStatus.CONFLICT } }).catch(() => 0),
      db().wooSyncOutbox.count({ where: { status: WooOutboxStatus.PENDING } }).catch(() => 0),
      db().wooSyncOutbox.count({ where: { status: { in: [WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT, WooOutboxStatus.DEAD] } } }).catch(() => 0),
      db().wooInboundEvent.count({ where: { status: WooInboundStatus.SKIPPED_PAUSED } }).catch(() => 0),
      db().wooSyncLog.findMany({ orderBy: { id: 'desc' }, take: 10 }).catch(() => [])
    ])
    return {
      config,
      counts: { activeLinks, pausedLinks, conflictLinks, pendingOutbox, failedOutbox, pausedEvents },
      lastLogs: (lastLogs ?? []).map((l: any) => ({ id: l.id, at: asDateString(l.at) ?? '', level: l.level, action: l.action, message: l.message }))
    }
  },

  async saveSettings(input: { siteUrl?: string; token?: string; enabled?: boolean; autoSync?: boolean; intervalSeconds?: number; userId?: number | null }) {
    const prev = await safeConfig()
    const siteUrl = normalizeWooBaseUrl(input.siteUrl ?? prev.siteUrl)
    const intervalSeconds = Math.min(3600, Math.max(30, Math.round(Number(input.intervalSeconds ?? prev.intervalSeconds) || 120)))
    const next: StoredConfig = {
      siteUrl,
      enabled: input.enabled === true,
      autoSync: input.autoSync !== false,
      intervalSeconds
    }
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await writeSetting(WOO_SYNC_SETTING_KEY, json(next), tx)
      if (String(input.token ?? '').trim()) {
        const sealed = sealSecret(String(input.token).trim())
        if (!sealed) throw new BusinessError('ذخیره‌ی امن کلید اتصال ممکن نشد؛ تنظیمات ذخیره نشد.')
        await writeSetting(WOO_SYNC_SECRET_KEY, sealed, tx)
      }
      await audit(tx, {
        action: AuditAction.WOO_SYNC_SETTINGS,
        entity: 'WooSync',
        entityId: 0,
        userId: input.userId ?? null,
        before: json({ ...prev, hasSecret: prev.hasSecret }),
        after: json({ ...next, hasSecret: String(input.token ?? '').trim() ? true : prev.hasSecret }),
        note: 'تغییر تنظیمات همگام‌سازی موجودی سایت (فقط موجودی)'
      })
    })
    await log('SETTINGS', 'تنظیمات اتصال سایت ذخیره شد', { payload: { siteUrl, enabled: next.enabled } })
    return this.status()
  },

  async testConnection() {
    const r = await wooRequest<any>('/ping')
    return { ok: true, site: r?.site ?? null, plugin: r?.plugin ?? null, time: r?.time ?? null }
  },

  async catalog(params: { search?: string; limit?: number } = {}): Promise<WooCatalogItem[]> {
    const q = new URLSearchParams()
    if (params.search) q.set('search', String(params.search))
    q.set('limit', String(Math.min(200, Math.max(1, Math.round(Number(params.limit) || 100)))))
    const r = await wooRequest<any>(`/catalog?${q.toString()}`)
    const rows = Array.isArray(r?.items) ? r.items : []
    return rows.map((x: any) => ({
      holderKey: String(x.holder_key ?? x.holderKey ?? wooHolderKey(x.product_id ?? x.productId, x.variation_id ?? x.variationId)),
      productId: wooSafeInt(x.product_id ?? x.productId),
      variationId: x.variation_id == null ? null : wooSafeInt(x.variation_id ?? x.variationId),
      sku: x.sku == null ? null : String(x.sku),
      name: String(x.name ?? ''),
      type: String(x.type ?? ''),
      manageStock: x.manage_stock === true || x.manageStock === true,
      stockQuantity: wooSafeInt(x.stock_quantity ?? x.stockQuantity),
      stockStatus: String(x.stock_status ?? x.stockStatus ?? ''),
      backorders: x.backorders == null ? null : String(x.backorders),
      status: x.status == null ? null : String(x.status)
    }))
  },

  async links(): Promise<WooLinkRow[]> {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT l.*, v.code, v.barcode, v.stock AS mahakStock, v.size, v.color, p.name AS productName,
        (SELECT COUNT(*) FROM WooSyncOutbox o WHERE o.linkId = l.id AND o.status = 'PENDING') AS pendingOutbox,
        (SELECT COUNT(*) FROM WooSyncOutbox o WHERE o.linkId = l.id AND o.status IN ('FAILED','CONFLICT','DEAD')) AS failedOutbox,
        (SELECT COUNT(*) FROM WooInboundEvent e WHERE e.linkId = l.id AND e.status = 'SKIPPED_PAUSED') AS pausedEvents
      FROM WooProductLink l
      JOIN ProductVariant v ON v.id = l.variantId
      JOIN Product p ON p.id = v.productId
      WHERE l.status <> 'UNLINKED'
      ORDER BY l.updatedAt DESC, l.id DESC
      LIMIT 1000
    `)
    return rows.map((r: any) => ({
      id: Number(r.id),
      variantId: Number(r.variantId),
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
    wooQty?: number
    decision?: string
    userId?: number | null
  }) {
    const variantId = int(input.variantId, 'شناسه کالای فروشگاه', { positive: true })
    const productId = int(input.productId, 'شناسه محصول سایت', { positive: true })
    const variationId = input.variationId == null ? null : int(input.variationId, 'شناسه Variation سایت', { positive: true })
    const holderKey = input.holderKey || wooHolderKey(productId, variationId)
    if (input.manageStock !== true) throw new BusinessError('این محصول در سایت manage_stock ندارد؛ تا وقتی موجودی سایت مستقل نباشد، اتصال امن نیست.')
    const catalogWooQty = int(input.wooQty, 'موجودی سایت', { allowZero: true })
    const freshRemote = (await this.remoteStock([{ holderKey, wooProductId: productId, wooVariationId: variationId }]))[0]
    const wooQty = freshRemote?.stockQuantity == null ? catalogWooQty : publishedQty(freshRemote.stockQuantity)
    const decision = String(input.decision || WooResumeDecision.MAHAK_WINS)
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, stock: true, code: true } })
    if (!variant) throw new BusinessError('کالای فروشگاه پیدا نشد.')
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const exists = await activeLinkForVariant(tx as any, variantId)
      if (exists) throw new BusinessError('این واریانت فروشگاه از قبل به سایت وصل است؛ اول همان اتصال را قطع کنید.')
      let localStock = Number(variant.stock ?? 0)
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
          lastMahakQty: localStock
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
      } else if (decision === WooResumeDecision.MAHAK_WINS && localStock !== wooQty) {
        await createOutbox({ client: tx as any, link, variantId, kind: 'RECONCILE_PUSH', targetQty: localStock, expectedWooQty: wooQty })
      } else if (decision !== WooResumeDecision.MAHAK_WINS && decision !== WooResumeDecision.WOO_WINS && decision !== WooResumeDecision.VERIFY_ONLY && decision !== WooResumeDecision.NOOP) {
        throw new BusinessError('روش اتصال اولیه نامعتبر است.')
      }
      await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastMahakQty: localStock } })
      await audit(tx, {
        action: AuditAction.WOO_LINK_CREATE,
        entity: 'WooProductLink',
        entityId: link.id,
        userId: input.userId ?? null,
        after: json({ variantId, holderKey, decision, wooQty, mahakQty: localStock }),
        note: 'اتصال موجودی کالا به WooCommerce (فقط موجودی)'
      })
      return { id: link.id }
    })
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
            pauseSeqFloor: BigInt(cursor)
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
    })
    await log('LINK_PAUSE', `${ids.length} اتصال قطع موقت شد`, { payload: { ids, cursor } })
    return this.links()
  },

  async resumePreview(input: { linkId?: number }) {
    const link = await linkById(int(input.linkId, 'شناسه اتصال', { positive: true }))
    const stockRes = await this.remoteStock([link])
    const remote = stockRes[0]
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
    }
    const mahakStock = await productStock(link.variantId)
    const paused = await db().wooInboundEvent.findMany({
      where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }]
    })
    const pausedEvents: WooResumePreviewEvent[] = paused.map((e: any) => ({
      id: e.id,
      seq: e.seq == null ? null : Number(e.seq),
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
  }) {
    const link = await linkById(int(input.linkId, 'شناسه اتصال', { positive: true }))
    const decision = String(input.decision || WooResumeDecision.VERIFY_ONLY)
    const preview = await this.resumePreview({ linkId: link.id })
    if (
      input.expectedMahakStock == null ||
      input.expectedWooQty == null ||
      input.expectedLastSeq === undefined ||
      input.expectedPausedEventCount == null
    ) {
      throw new BusinessError('برای وصل دوباره/حل اختلاف، اول باید پیش‌نمایش تازه بگیرید؛ درخواست بدون امضای پیش‌نمایش اعمال نشد.')
    }
    const previewChanged =
      Number(input.expectedMahakStock) !== Number(preview.mahakStock) ||
      Number(input.expectedWooQty) !== Number(preview.wooQty) ||
      (input.expectedLastSeq == null ? null : Number(input.expectedLastSeq)) !== (preview.lastSeq == null ? null : Number(preview.lastSeq)) ||
      Number(input.expectedPausedEventCount) !== Number(preview.pausedEvents.length)
    if (previewChanged) throw new BusinessError('از زمان پیش‌نمایش، موجودی یا رویدادهای سایت تغییر کرده است؛ دوباره پیش‌نمایش بگیرید و بعد اعمال کنید.')

    let finalStock = Number(preview.mahakStock)
    let supersededPausedEvents = 0
    let appliedPausedOrderEvents = 0
    let pendingReconcilePush = false
    const relinkId = randomUUID()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
      if (!fresh || ![WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT].includes(fresh.status)) throw new BusinessError('این اتصال دیگر در وضعیت قطع موقت/اختلاف نیست؛ فهرست را تازه کنید.')
      const txStock = await productStock(link.variantId, tx as any)
      if (txStock !== Number(preview.mahakStock)) throw new BusinessError('موجودی MAHAK بعد از پیش‌نمایش تغییر کرده است؛ دوباره پیش‌نمایش بگیرید.')
      await (tx as any).wooSyncOutbox.updateMany({
        where: { linkId: link.id, status: { in: openOutboxStatuses() } },
        data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_RECONCILED', updatedAt: new Date() }
      })

      if (decision === WooResumeDecision.WOO_WINS) {
        const delta = Number(preview.wooQty) - txStock
        const r = await applyWooDelta({ variantId: link.variantId, delta, reason: StockReason.WOO_SYNC_ADJUST, note: 'وصل دوباره سایت: سایت مرجع موجودی شد', tx })
        finalStock = r.stock
        const upd = await (tx as any).wooInboundEvent.updateMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
        supersededPausedEvents += Number(upd.count || 0)
      } else if (decision === WooResumeDecision.MAHAK_PLUS_ORDERS) {
        const events = await (tx as any).wooInboundEvent.findMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, orderBy: [{ seq: 'asc' }, { id: 'asc' }] })
        for (const e of events) {
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
          const r = await applyWooDelta({ eventId: e.id, variantId: link.variantId, delta, note: `اعمال سفارش سایت هنگام وصل دوباره (${e.orderId ?? 'بدون سفارش'})`, tx })
          finalStock = r.stock
          appliedPausedOrderEvents++
          await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.APPLIED_ON_RELINK, movementId: r.movementId, relinkId, processedAt: new Date() } })
        }
      } else if (decision === WooResumeDecision.MAHAK_WINS) {
        const upd = await (tx as any).wooInboundEvent.updateMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
        supersededPausedEvents += Number(upd.count || 0)
      } else if (decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP) {
        const upd = await (tx as any).wooInboundEvent.updateMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
        supersededPausedEvents += Number(upd.count || 0)
      } else {
        throw new BusinessError('روش وصل دوباره نامعتبر است.')
      }

      const targetForSite = publishedQty(finalStock)
      pendingReconcilePush = (decision === WooResumeDecision.MAHAK_WINS || decision === WooResumeDecision.MAHAK_PLUS_ORDERS) && targetForSite !== publishedQty(preview.wooQty)
      await (tx as any).wooProductLink.update({
        where: { id: link.id },
        data: {
          status: pendingReconcilePush ? WooLinkStatus.PAUSED : WooLinkStatus.ACTIVE,
          resumedAt: new Date(),
          resumedBy: input.userId ?? null,
          resumeDecision: decision,
          relinkSeqFloor: preview.lastSeq == null ? null : BigInt(preview.lastSeq),
          lastRelinkId: relinkId,
          lastMahakQty: finalStock,
          lastWooQty: publishedQty(preview.wooQty)
        }
      })
      if (pendingReconcilePush) {
        await createOutbox({ client: tx as any, link: { ...link, lastWooQty: publishedQty(preview.wooQty) }, variantId: link.variantId, kind: 'RECONCILE_PUSH', targetQty: targetForSite, expectedWooQty: publishedQty(preview.wooQty) })
      }
      await audit(tx, {
        action: AuditAction.WOO_LINK_RESUME,
        entity: 'WooProductLink',
        entityId: link.id,
        userId: input.userId ?? null,
        after: json({ decision, relinkId, wooQty: preview.wooQty, mahakQty: finalStock, appliedPausedOrderEvents, supersededPausedEvents, pendingReconcilePush }),
        note: 'وصل دوباره/حل اختلاف همگام‌سازی موجودی سایت'
      })
    })
    await log('LINK_RESUME', pendingReconcilePush ? 'تصمیم وصل ثبت شد و تا ارسال موفق سایت، لینک موقتاً قطع می‌ماند' : 'اتصال موجودی سایت دوباره فعال شد', { linkId: link.id, variantId: link.variantId, payload: { decision, relinkId, appliedPausedOrderEvents, supersededPausedEvents, pendingReconcilePush } })
    return this.links()
  },

  async unlink(input: { linkId?: number; userId?: number | null }) {
    const id = int(input.linkId, 'شناسه اتصال', { positive: true })
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const link = await (tx as any).wooProductLink.findUnique({ where: { id } })
      if (!link) return
      await (tx as any).wooSyncOutbox.updateMany({ where: { linkId: id, status: { in: openOutboxStatuses() } }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_UNLINKED' } })
      await (tx as any).wooProductLink.update({ where: { id }, data: { status: WooLinkStatus.UNLINKED } })
      await audit(tx, { action: AuditAction.WOO_LINK_UNLINK, entity: 'WooProductLink', entityId: id, userId: input.userId ?? null, before: json(link), note: 'قطع دائم اتصال موجودی سایت' })
    })
    return this.links()
  },

  async remoteStock(links: any[]) {
    if (!links.length) return []
    const holders = links.map((l) => ({ holder_key: l.holderKey, product_id: l.wooProductId, variation_id: l.wooVariationId ?? null }))
    const r = await wooRequest<any>('/stock', { method: 'POST', body: { holders } })
    const items = Array.isArray(r?.items) ? r.items : []
    return items.map((x: any) => ({
      holderKey: String(x.holder_key ?? x.holderKey ?? ''),
      stockQuantity: wooSafeInt(x.stock_quantity ?? x.stockQuantity),
      lastSeq: x.last_seq == null ? null : wooSafeInt(x.last_seq)
    }))
  },

  async processOutbox(limit = 50) {
    const cfg = await safeConfig()
    if (!cfg.enabled) return { sent: 0, failed: 0, skipped: 0 }
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
      const locked = await db().wooSyncOutbox.updateMany({ where: { id: row.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED] } }, data: { status: WooOutboxStatus.IN_FLIGHT, attemptCount: { increment: 1 }, updatedAt: new Date() } })
      if (!locked.count) continue
      const link = await db().wooProductLink.findUnique({ where: { id: row.linkId } })
      const reconcileKind = isReconcileOutboxKind(row.kind)
      const allowedStatus = link?.status === WooLinkStatus.ACTIVE || (reconcileKind && [WooLinkStatus.PAUSED, WooLinkStatus.CONFLICT, WooLinkStatus.BROKEN_LOCAL].includes(String(link?.status) as any))
      if (!link || !allowedStatus) {
        await db().wooSyncOutbox.update({ where: { id: row.id }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_NOT_SENDABLE', updatedAt: new Date() } })
        skipped++
        continue
      }
      try {
        const expected = publishedQty(row.expectedWooQty ?? link.lastWooQty ?? 0)
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
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await (tx as any).wooSyncOutbox.update({ where: { id: row.id }, data: { status: WooOutboxStatus.SENT, sentAt: new Date(), updatedAt: new Date(), lastError: null, targetQty: target } })
          await (tx as any).wooProductLink.update({
            where: { id: link.id },
            data: {
              status: reconcileKind && link.status !== WooLinkStatus.BROKEN_LOCAL ? WooLinkStatus.ACTIVE : link.status,
              lastWooQty: target,
              lastMahakQty: localStock,
              lastPushedMovementId: row.movementId ?? link.lastPushedMovementId
            }
          })
        })
        sent++
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        const attempt = Number(row.attemptCount || 0) + 1
        const remoteBroken = /manage_stock|not found|404/i.test(msg)
        const conflict = !remoteBroken && /اختلاف|conflict|409/i.test(msg)
        const status = attempt >= MAX_OUTBOX_ATTEMPTS ? WooOutboxStatus.DEAD : conflict ? WooOutboxStatus.CONFLICT : WooOutboxStatus.FAILED
        const conflictCursor = status === WooOutboxStatus.CONFLICT ? await lastCursor() : null
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await (tx as any).wooSyncOutbox.update({ where: { id: row.id }, data: { status, lastError: msg, updatedAt: new Date() } })
          if (remoteBroken) await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.BROKEN_REMOTE } })
          else if (status === WooOutboxStatus.CONFLICT) {
            await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.CONFLICT, pauseReason: 'CONFLICT', pausedAt: new Date(), pauseSeqFloor: BigInt(conflictCursor ?? 0) } })
          }
        })
        await log('OUTBOX_FAILED', msg, { level: status === WooOutboxStatus.CONFLICT ? 'WARN' : 'ERROR', linkId: link?.id, variantId: row.variantId, payload: { outboxId: row.id, attempt, status } })
        failed++
      }
    }
    return { sent, failed, skipped }
  },

  async pullJournal(limit = 100) {
    const cfg = await safeConfig()
    if (!cfg.enabled) return { received: 0, applied: 0, skipped: 0 }
    const cursor = await lastCursor()
    const q = new URLSearchParams({ after_seq: String(cursor), limit: String(Math.min(200, Math.max(1, Math.round(Number(limit) || 100)))) })
    const res = await wooRequest<any>(`/journal?${q.toString()}`)
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
      const newQty = publishedQty(raw.new_qty ?? raw.stock_quantity)
      const delta = raw.delta == null ? (oldQty == null ? 0 : newQty - oldQty) : wooSafeInt(raw.delta)
      const baseEvent = {
        eventUuid,
        seq: BigInt(seq),
        holderKey,
        orderId: raw.order_id == null ? null : String(raw.order_id),
        orderItemId: raw.order_item_id == null ? null : String(raw.order_item_id),
        oldQty,
        newQty,
        delta,
        source: String(raw.source ?? ''),
        requestId: raw.request_id ? String(raw.request_id) : null,
        payloadJson: json(raw)
      }
      try {
        const done = await db().wooInboundEvent.findUnique({ where: { eventUuid } })
        if (done) {
          skipped++
          continue
        }
        const link = await db().wooProductLink.findFirst({ where: { holderKey, status: { not: WooLinkStatus.UNLINKED } } })
        const echo = raw.request_id ? await db().wooSyncOutbox.findFirst({ where: { idempotencyKey: String(raw.request_id) } }) : null
        if (echo) {
          await db().wooInboundEvent.create({
            data: { ...baseEvent, linkId: link?.id ?? null, variantId: link?.variantId ?? null, status: WooInboundStatus.SKIPPED_ECHO, processedAt: new Date() }
          })
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
          await db().wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.SUPERSEDED, relinkId: link.lastRelinkId ?? null, processedAt: new Date() } })
          skipped++
          continue
        }
        if (link.status !== WooLinkStatus.ACTIVE) {
          await db().wooInboundEvent.create({ data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.SKIPPED_PAUSED } })
          skipped++
          continue
        }
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const event = await (tx as any).wooInboundEvent.create({
            data: { ...baseEvent, linkId: link.id, variantId: link.variantId, status: WooInboundStatus.PENDING }
          })
          const r = await applyWooDelta({ eventId: event.id, variantId: link.variantId, delta, note: `همگام‌سازی موجودی سایت${raw.order_id ? ` · سفارش ${raw.order_id}` : ''}`, tx })
          await (tx as any).wooInboundEvent.update({ where: { id: event.id }, data: { status: WooInboundStatus.APPLIED, movementId: r.movementId, processedAt: new Date() } })
          await (tx as any).wooSyncOutbox.updateMany({
            where: { linkId: link.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.CONFLICT] } },
            data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'REBASING_AFTER_INBOUND', updatedAt: new Date() }
          })
          const targetAfterInbound = publishedQty(r.stock)
          if (targetAfterInbound !== newQty) {
            await createOutbox({ client: tx as any, link: { ...link, lastWooQty: newQty }, variantId: link.variantId, kind: 'STOCK_PUSH_REBASED', targetQty: targetAfterInbound, expectedWooQty: newQty })
          }
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: newQty, lastMahakQty: r.stock } })
        })
        applied++
      } catch (e) {
        const message = String((e as any)?.message ?? e)
        await log('INBOUND_FAILED', message, { level: 'ERROR', payload: raw })
        try {
          const link = await db().wooProductLink.findFirst({ where: { holderKey, status: { not: WooLinkStatus.UNLINKED } } })
          await db().wooInboundEvent.create({
            data: { ...baseEvent, linkId: link?.id ?? null, variantId: link?.variantId ?? null, status: WooInboundStatus.PARKED, processedAt: new Date() }
          })
        } catch {
          // اگر رویداد قبلاً ثبت شده باشد، cursor را عقب نگه نمی‌داریم؛ idempotency با eventUuid حفظ می‌شود.
        }
        skipped++
      } finally {
        received++
      }
    }
    if (maxSeq > cursor) await setCursor(maxSeq)
    return { received, applied, skipped }
  },

  async syncNow() {
    if (busy) {
      const status = await this.status()
      return { pulled: { received: 0, applied: 0, skipped: 1 }, pushed: { sent: 0, failed: 0, skipped: 1 }, busy: true, status }
    }
    busy = true
    try {
      const pulled = await this.pullJournal(100)
      const pushed = await this.processOutbox(100)
      await log('SYNC_NOW', 'همگام‌سازی دستی انجام شد', { payload: { pulled, pushed } })
      return { pulled, pushed, status: await this.status() }
    } finally {
      busy = false
    }
  },

  async logs(params: { take?: number } = {}) {
    const take = Math.min(200, Math.max(20, Math.round(Number(params.take) || 80)))
    return db().wooSyncLog.findMany({ orderBy: { id: 'desc' }, take })
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let busy = false

export function startWooSyncScheduler(): void {
  if (timer) clearInterval(timer)
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const cfg = await safeConfig()
      if (cfg.enabled && cfg.autoSync) {
        await wooSyncService.pullJournal(100).catch((e) => log('AUTO_PULL_FAILED', String(e?.message ?? e), { level: 'ERROR' }))
        await wooSyncService.processOutbox(100).catch((e) => log('AUTO_PUSH_FAILED', String(e?.message ?? e), { level: 'ERROR' }))
      }
    } finally {
      busy = false
    }
  }
  timer = setInterval(() => void tick(), 60_000)
  void tick()
}
