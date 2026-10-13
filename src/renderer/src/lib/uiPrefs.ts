/**
 * preferenceهای صرفاً نمایشی renderer. این فایل عمداً هیچ IPC، Setting یا
 * AuditLog ندارد: باز/بسته بودن یک آکاردئون دادهٔ مالی نیست.
 */
export const SALES_ACCOUNTING_BLOCK_PREF_KEY = 'mahak:ui:sales-accounting-blocks:v1'

export const SALES_ACCOUNTING_BLOCK_KEYS = ['invoice', 'credit', 'returns', 'cheques', 'storeCredits', 'cash', 'bridge'] as const
export type SalesAccountingBlockKey = (typeof SALES_ACCOUNTING_BLOCK_KEYS)[number]
export type SalesAccountingBlocksOpen = Record<SalesAccountingBlockKey, boolean>

type StoredSalesAccountingBlocks = {
  version: 1
  open: Partial<Record<SalesAccountingBlockKey, unknown>>
}

export function defaultSalesAccountingBlocksOpen(): SalesAccountingBlocksOpen {
  return {
    invoice: false,
    credit: false,
    returns: false,
    cheques: false,
    storeCredits: false,
    cash: false,
    bridge: false
  }
}

/** نبود، خرابی یا نسخهٔ ناشناخته همیشه معادل نصب تازه: همه بسته. */
export function parseSalesAccountingBlocksOpen(value: unknown): SalesAccountingBlocksOpen {
  const fallback = defaultSalesAccountingBlocksOpen()
  if (!value || typeof value !== 'object') return fallback
  const row = value as Partial<StoredSalesAccountingBlocks>
  if (row.version !== 1 || !row.open || typeof row.open !== 'object') return fallback
  for (const key of SALES_ACCOUNTING_BLOCK_KEYS) fallback[key] = row.open[key] === true
  return fallback
}

export function readSalesAccountingBlocksOpen(): SalesAccountingBlocksOpen {
  try {
    if (typeof window === 'undefined') return defaultSalesAccountingBlocksOpen()
    return parseSalesAccountingBlocksOpen(window.localStorage.getItem(SALES_ACCOUNTING_BLOCK_PREF_KEY)
      ? JSON.parse(window.localStorage.getItem(SALES_ACCOUNTING_BLOCK_PREF_KEY) ?? '')
      : null)
  } catch {
    return defaultSalesAccountingBlocksOpen()
  }
}

/** ذخیره best-effort است؛ نبود storage هرگز گزارش را خراب نمی‌کند. */
export function writeSalesAccountingBlocksOpen(open: SalesAccountingBlocksOpen): void {
  try {
    if (typeof window === 'undefined') return
    const value: StoredSalesAccountingBlocks = { version: 1, open }
    window.localStorage.setItem(SALES_ACCOUNTING_BLOCK_PREF_KEY, JSON.stringify(value))
  } catch {
    // مرورگر private/فضای پر فقط persistence را از دست می‌دهد، نه UI گزارش را.
  }
}
