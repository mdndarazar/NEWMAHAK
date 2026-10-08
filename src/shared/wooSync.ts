/**
 * قرارداد مشترک «همگام‌سازی موجودی سایت».
 * قفل معماری: این ماژول فقط stock_quantity را جابه‌جا می‌کند؛ قیمت، سفارش، مشتری،
 * تخفیف، مالیات و گزارش فروش سایت نه خوانده می‌شود و نه در MAHAK ساخته می‌شود.
 */
export const WOO_SYNC_SETTING_KEY = 'woo.sync.config.v1'
export const WOO_SYNC_SECRET_KEY = 'woo.sync.secret.v1'
export const WOO_SYNC_CURSOR_KEY = 'woo.sync.cursor.v1'

export const WooLinkStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  CONFLICT: 'CONFLICT',
  BROKEN_REMOTE: 'BROKEN_REMOTE',
  BROKEN_LOCAL: 'BROKEN_LOCAL',
  FROZEN: 'FROZEN',
  UNLINKED: 'UNLINKED'
} as const
export type WooLinkStatus = (typeof WooLinkStatus)[keyof typeof WooLinkStatus]

export const WooResumeDecision = {
  MAHAK_WINS: 'MAHAK_WINS',
  WOO_WINS: 'WOO_WINS',
  MAHAK_PLUS_ORDERS: 'MAHAK_PLUS_ORDERS',
  VERIFY_ONLY: 'VERIFY_ONLY',
  NOOP: 'NOOP'
} as const
export type WooResumeDecision = (typeof WooResumeDecision)[keyof typeof WooResumeDecision]

export const WooOutboxStatus = {
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED',
  DEAD: 'DEAD',
  CONFLICT: 'CONFLICT'
} as const

export const WooInboundStatus = {
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  APPLIED_ON_RELINK: 'APPLIED_ON_RELINK',
  SKIPPED_ECHO: 'SKIPPED_ECHO',
  SKIPPED_PAUSED: 'SKIPPED_PAUSED',
  SKIPPED_UNMAPPED: 'SKIPPED_UNMAPPED',
  SUPERSEDED: 'SUPERSEDED',
  PARKED: 'PARKED'
} as const

export const WooApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
} as const
export type WooApprovalStatus = (typeof WooApprovalStatus)[keyof typeof WooApprovalStatus]

export const WooApprovalAction = {
  APPLY_INBOUND: 'APPLY_INBOUND',
  RECONCILE_DISCREPANCY: 'RECONCILE_DISCREPANCY',
  LOOP_FUSE: 'LOOP_FUSE',
  CONFLICT_RESOLUTION: 'CONFLICT_RESOLUTION',
  UNFREEZE_LINK: 'UNFREEZE_LINK'
} as const
export type WooApprovalAction = (typeof WooApprovalAction)[keyof typeof WooApprovalAction]

export interface WooSyncSafeConfig {
  enabled: boolean
  siteUrl: string
  autoSync: boolean
  intervalSeconds: number
  hasSecret: boolean
  lastCursor: number
}

export interface WooCatalogItem {
  holderKey: string
  productId: number
  variationId: number | null
  sku: string | null
  name: string
  type: string
  manageStock: boolean
  manageStockMode?: string | null
  stockQuantity: number | null
  stockStatus: string
  backorders?: string | null
  status?: string | null
}

export interface WooCatalogResult {
  items: WooCatalogItem[]
  fetched: number
  hasMore: boolean
  capped: boolean
  nextPage?: number | null
  message?: string | null
}

export interface WooLinkRow {
  id: number
  variantId: number
  productId?: number
  productName: string
  code: string
  barcode: string
  color?: string | null
  size?: string | null
  mahakStock: number
  wooProductId: number
  wooVariationId?: number | null
  holderKey: string
  sku?: string | null
  remoteName?: string | null
  status: WooLinkStatus | string
  lastWooQty: number
  lastMahakQty: number
  pausedAt?: string | null
  pauseNote?: string | null
  pendingOutbox: number
  failedOutbox: number
  pausedEvents: number
}


export interface WooResumePreviewEvent {
  id: number
  seq: number | null
  status?: string | null
  delta: number
  source?: string | null
  orderId?: string | null
}

export interface WooResumePreview {
  linkId: number
  holderKey: string
  mahakStock: number
  wooQty: number
  lastSeq: number | null
  pausedEvents: WooResumePreviewEvent[]
  heldEventHash?: string
  orderEvents: number
  orderDelta: number
  nonOrderEvents: number
  nonOrderDelta: number
}

export interface WooApprovalRow {
  id: number
  action: string
  status: string
  linkId?: number | null
  variantId?: number | null
  holderKey?: string | null
  reason: string
  title: string
  message: string
  payload?: any
  createdAt: string
}

export interface WooStatusView {
  config: WooSyncSafeConfig
  counts: {
    activeLinks: number
    pausedLinks: number
    conflictLinks: number
    pendingOutbox: number
    failedOutbox: number
    pausedEvents: number
    parkedEvents: number
    pendingApprovals: number
  }
  lastLogs: Array<{ id: number; at: string; level: string; action: string; message: string }>
}

export function normalizeWooBaseUrl(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!s) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return s
  }
}

// کلید اتصال افزونه فقط روی TLS امن ارسال می‌شود؛ فقط loopback (تست محلی) از https مستثنا است.
export function wooUrlRequiresTls(raw: unknown): boolean {
  const s = String(raw ?? '').trim()
  if (!s) return false
  try {
    const u = new URL(s)
    if (u.protocol === 'https:') return false
    const host = u.hostname.toLowerCase()
    const loopback = host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]' || host === '::1'
    return !loopback
  } catch {
    return false
  }
}

export function wooHolderKey(productId: unknown, variationId?: unknown): string {
  const p = Math.max(0, Math.round(Number(productId) || 0))
  const v = Math.max(0, Math.round(Number(variationId) || 0))
  return v > 0 ? `v:${v}` : `p:${p}`
}

export function wooSafeInt(raw: unknown, fallback = 0): number {
  const n = Math.round(Number(raw))
  return Number.isSafeInteger(n) ? n : fallback
}

export function wooStockReason(delta: number): 'WOO_SYNC_OUT' | 'WOO_SYNC_IN' | 'WOO_SYNC_ADJUST' {
  if (delta < 0) return 'WOO_SYNC_OUT'
  if (delta > 0) return 'WOO_SYNC_IN'
  return 'WOO_SYNC_ADJUST'
}

export function wooStatusLabel(status: string): string {
  switch (status) {
    case WooLinkStatus.ACTIVE:
      return 'متصل'
    case WooLinkStatus.PAUSED:
      return 'قطع موقت'
    case WooLinkStatus.CONFLICT:
      return 'اختلاف نیازمند بررسی'
    case WooLinkStatus.BROKEN_REMOTE:
      return 'حذف/خرابی در سایت'
    case WooLinkStatus.BROKEN_LOCAL:
      return 'حذف/خرابی در فروشگاه'
    case WooLinkStatus.FROZEN:
      return 'متوقف‌شده برای تأیید مدیر'
    case WooLinkStatus.UNLINKED:
      return 'قطع دائم'
    default:
      return status || 'نامشخص'
  }
}
