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
  // ویرایش دستی/ادمین سایت حتی اگر در ژورنال مانده باشد PARK می‌شود تا overwrite کورکورانه رخ ندهد.
  return String(e.source ?? '').toLowerCase() === 'order' && String(e.orderId ?? '').trim() !== ''
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
    where: { linkId: input.link.id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED] } },
    data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'NEWER_STOCK_TARGET' }
  })
  return client.wooSyncOutbox.create({
    data: {
      linkId: input.link.id,
      variantId: input.variantId,
      movementId: input.movementId ?? null,
      kind: input.kind ?? 'STOCK_PUSH',
      expectedWooQty: input.expectedWooQty ?? input.link.lastWooQty ?? null,
      targetQty: input.targetQty,
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
    await createOutbox({ client, link, variantId: input.variantId, movementId: input.movementId, targetQty: input.targetQty })
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
    const wooQty = int(input.wooQty, 'موجودی سایت', { allowZero: true })
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
          where: { linkId: id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED, WooOutboxStatus.DEAD] } },
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
    const mahakStock = await productStock(link.variantId)
    const paused = await db().wooInboundEvent.findMany({
      where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      take: 500
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
      lastSeq: remote?.lastSeq ?? null,
      pausedEvents,
      orderEvents: orderEvents.length,
      orderDelta: orderEvents.reduce((sum, e) => sum + Number(e.delta || 0), 0),
      nonOrderEvents: nonOrderEvents.length,
      nonOrderDelta: nonOrderEvents.reduce((sum, e) => sum + Number(e.delta || 0), 0)
    }
  },

  async resumeApply(input: { linkId?: number; decision?: string; userId?: number | null }) {
    const link = await linkById(int(input.linkId, 'شناسه اتصال', { positive: true }))
    const decision = String(input.decision || WooResumeDecision.VERIFY_ONLY)
    const preview = await this.resumePreview({ linkId: link.id })
    if (decision === WooResumeDecision.VERIFY_ONLY || decision === WooResumeDecision.NOOP) {
      await log('LINK_RESUME_PREVIEW_ONLY', 'وصل دوباره فقط بررسی شد؛ هیچ موجودی و هیچ وضعیت لینکی تغییر نکرد', {
        linkId: link.id,
        variantId: link.variantId,
        payload: preview
      })
      return this.links()
    }
    let finalStock = Number(preview.mahakStock)
    let parkedPausedEvents = 0
    let appliedPausedOrderEvents = 0
    const relinkId = randomUUID()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fresh = await (tx as any).wooProductLink.findUnique({ where: { id: link.id } })
      if (!fresh || fresh.status !== WooLinkStatus.PAUSED) throw new BusinessError('این اتصال دیگر در وضعیت قطع موقت نیست؛ فهرست را تازه کنید.')
      if (decision === WooResumeDecision.WOO_WINS) {
        const delta = Number(preview.wooQty) - finalStock
        const r = await applyWooDelta({ variantId: link.variantId, delta, reason: StockReason.WOO_SYNC_ADJUST, note: 'وصل دوباره سایت: سایت مرجع موجودی شد', tx })
        finalStock = r.stock
        await (tx as any).wooInboundEvent.updateMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
      } else if (decision === WooResumeDecision.MAHAK_PLUS_ORDERS) {
        const events = await (tx as any).wooInboundEvent.findMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, orderBy: [{ seq: 'asc' }, { id: 'asc' }], take: 500 })
        for (const e of events) {
          const delta = Number(e.delta || 0)
          if (!isWooOrderPausedEvent(e)) {
            // ویرایش‌های دستی/ادمین سایت در زمان قطع نباید به MAHAK اعمال شوند؛ فقط برای بررسی مدیر park می‌شوند.
            await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.PARKED, relinkId, processedAt: new Date() } })
            parkedPausedEvents++
            continue
          }
          if (!delta) {
            await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
            continue
          }
          const r = await applyWooDelta({ eventId: e.id, variantId: link.variantId, delta, note: `اعمال سفارش سایت هنگام وصل دوباره (${e.orderId ?? 'بدون سفارش'})`, tx })
          finalStock = r.stock
          appliedPausedOrderEvents++
          await (tx as any).wooInboundEvent.update({ where: { id: e.id }, data: { status: WooInboundStatus.APPLIED_ON_RELINK, movementId: r.movementId, relinkId, processedAt: new Date() } })
        }
      } else if (decision === WooResumeDecision.MAHAK_WINS) {
        await (tx as any).wooInboundEvent.updateMany({ where: { linkId: link.id, status: WooInboundStatus.SKIPPED_PAUSED }, data: { status: WooInboundStatus.SUPERSEDED, relinkId, processedAt: new Date() } })
      } else {
        throw new BusinessError('روش وصل دوباره نامعتبر است.')
      }
      await (tx as any).wooProductLink.update({
        where: { id: link.id },
        data: {
          status: WooLinkStatus.ACTIVE,
          resumedAt: new Date(),
          resumedBy: input.userId ?? null,
          resumeDecision: decision,
          relinkSeqFloor: preview.lastSeq == null ? null : BigInt(preview.lastSeq),
          lastRelinkId: relinkId,
          lastMahakQty: finalStock,
          lastWooQty: Number(preview.wooQty)
        }
      })
      if ((decision === WooResumeDecision.MAHAK_WINS || decision === WooResumeDecision.MAHAK_PLUS_ORDERS) && finalStock !== Number(preview.wooQty)) {
        await createOutbox({ client: tx as any, link: { ...link, lastWooQty: Number(preview.wooQty) }, variantId: link.variantId, kind: 'RECONCILE_PUSH', targetQty: finalStock, expectedWooQty: Number(preview.wooQty) })
      }
      await audit(tx, {
        action: AuditAction.WOO_LINK_RESUME,
        entity: 'WooProductLink',
        entityId: link.id,
        userId: input.userId ?? null,
        after: json({ decision, relinkId, wooQty: preview.wooQty, mahakQty: finalStock, appliedPausedOrderEvents, parkedPausedEvents }),
        note: 'وصل دوباره همگام‌سازی موجودی سایت'
      })
    })
    await log('LINK_RESUME', 'اتصال موجودی سایت دوباره فعال شد', { linkId: link.id, variantId: link.variantId, payload: { decision, relinkId, appliedPausedOrderEvents, parkedPausedEvents } })
    return this.links()
  },

  async unlink(input: { linkId?: number; userId?: number | null }) {
    const id = int(input.linkId, 'شناسه اتصال', { positive: true })
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const link = await (tx as any).wooProductLink.findUnique({ where: { id } })
      if (!link) return
      await (tx as any).wooSyncOutbox.updateMany({ where: { linkId: id, status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED] } }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_UNLINKED' } })
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
    const rows = await db().wooSyncOutbox.findMany({
      where: { status: { in: [WooOutboxStatus.PENDING, WooOutboxStatus.FAILED] } },
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
      if (!link || link.status !== WooLinkStatus.ACTIVE) {
        await db().wooSyncOutbox.update({ where: { id: row.id }, data: { status: WooOutboxStatus.SUPERSEDED, lastError: 'LINK_NOT_ACTIVE' } })
        skipped++
        continue
      }
      try {
        const expected = Number(link.lastWooQty ?? row.expectedWooQty ?? 0)
        const target = Number(row.targetQty)
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
          await (tx as any).wooSyncOutbox.update({ where: { id: row.id }, data: { status: WooOutboxStatus.SENT, sentAt: new Date(), updatedAt: new Date(), lastError: null } })
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: target, lastMahakQty: target, lastPushedMovementId: row.movementId ?? link.lastPushedMovementId } })
        })
        sent++
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        const status = /اختلاف|conflict|409/i.test(msg) ? WooOutboxStatus.CONFLICT : WooOutboxStatus.FAILED
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await (tx as any).wooSyncOutbox.update({ where: { id: row.id }, data: { status, lastError: msg, updatedAt: new Date() } })
          if (status === WooOutboxStatus.CONFLICT) await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { status: WooLinkStatus.CONFLICT } })
        })
        await log('OUTBOX_FAILED', msg, { level: status === WooOutboxStatus.CONFLICT ? 'WARN' : 'ERROR', linkId: link?.id, variantId: row.variantId, payload: { outboxId: row.id } })
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
      const newQty = wooSafeInt(raw.new_qty ?? raw.stock_quantity)
      const delta = raw.delta == null ? (oldQty == null ? 0 : newQty - oldQty) : wooSafeInt(raw.delta)
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
            data: { eventUuid, seq: BigInt(seq), linkId: link?.id ?? null, variantId: link?.variantId ?? null, holderKey, oldQty, newQty, delta, source: String(raw.source ?? ''), requestId: String(raw.request_id), status: WooInboundStatus.SKIPPED_ECHO, payloadJson: json(raw), processedAt: new Date() }
          })
          skipped++
          continue
        }
        if (!link) {
          await db().wooInboundEvent.create({ data: { eventUuid, seq: BigInt(seq), holderKey, oldQty, newQty, delta, source: String(raw.source ?? ''), requestId: raw.request_id ? String(raw.request_id) : null, status: WooInboundStatus.SKIPPED_UNMAPPED, payloadJson: json(raw), processedAt: new Date() } })
          skipped++
          continue
        }
        if (link.status !== WooLinkStatus.ACTIVE) {
          await db().wooInboundEvent.create({ data: { eventUuid, seq: BigInt(seq), linkId: link.id, variantId: link.variantId, holderKey, orderId: raw.order_id == null ? null : String(raw.order_id), orderItemId: raw.order_item_id == null ? null : String(raw.order_item_id), oldQty, newQty, delta, source: String(raw.source ?? ''), requestId: raw.request_id ? String(raw.request_id) : null, status: WooInboundStatus.SKIPPED_PAUSED, payloadJson: json(raw) } })
          skipped++
          continue
        }
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const event = await (tx as any).wooInboundEvent.create({
            data: { eventUuid, seq: BigInt(seq), linkId: link.id, variantId: link.variantId, holderKey, orderId: raw.order_id == null ? null : String(raw.order_id), orderItemId: raw.order_item_id == null ? null : String(raw.order_item_id), oldQty, newQty, delta, source: String(raw.source ?? ''), requestId: raw.request_id ? String(raw.request_id) : null, status: WooInboundStatus.PENDING, payloadJson: json(raw) }
          })
          const r = await applyWooDelta({ eventId: event.id, variantId: link.variantId, delta, note: `همگام‌سازی موجودی سایت${raw.order_id ? ` · سفارش ${raw.order_id}` : ''}`, tx })
          await (tx as any).wooInboundEvent.update({ where: { id: event.id }, data: { status: WooInboundStatus.APPLIED, movementId: r.movementId, processedAt: new Date() } })
          await (tx as any).wooProductLink.update({ where: { id: link.id }, data: { lastWooQty: newQty, lastMahakQty: r.stock } })
        })
        applied++
      } catch (e) {
        await log('INBOUND_FAILED', String((e as any)?.message ?? e), { level: 'ERROR', payload: raw })
        throw e
      } finally {
        received++
      }
    }
    if (maxSeq > cursor) await setCursor(maxSeq)
    return { received, applied, skipped }
  },

  async syncNow() {
    const pulled = await this.pullJournal(100)
    const pushed = await this.processOutbox(100)
    await log('SYNC_NOW', 'همگام‌سازی دستی انجام شد', { payload: { pulled, pushed } })
    return { pulled, pushed, status: await this.status() }
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
