/**
 * شماره‌ی فیش فقط‌افزایشی.
 *
 * `MAX(receiptNo)+1` بعد از پاک‌سازی آخرین فاکتورها همان شماره‌ها را دوباره
 * می‌دهد. این شمارنده در Setting ذخیره می‌شود و هرگز عقب نمی‌رود؛ با خودِ
 * تراکنش ثبت فاکتور بالا می‌رود تا شماره‌ی مصرف‌نشده هم رزرو بماند.
 */
export const RECEIPT_SEQ_KEY = 'sale.receiptSeq'

type ReceiptClient = {
  saleInvoice: {
    findFirst: (args: { orderBy: { receiptNo: 'desc' }; select: { receiptNo: true } }) => Promise<{ receiptNo: number } | null>
    findMany: (args: {
      select: { receiptNo: true; voidedAt: true; status: true }
    }) => Promise<Array<{ receiptNo: number; voidedAt: Date | string | null; status: string }>>
  }
  setting: {
    findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>
    upsert: (args: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => Promise<unknown>
  }
}

function seqOf(raw: string | null | undefined): number {
  const n = Math.round(Number(raw ?? 0))
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

export async function nextReceiptNo(client: ReceiptClient): Promise<number> {
  const last = await client.saleInvoice.findFirst({ orderBy: { receiptNo: 'desc' }, select: { receiptNo: true } })
  const stored = await client.setting.findUnique({ where: { key: RECEIPT_SEQ_KEY } })
  const next = Math.max(last?.receiptNo ?? 0, seqOf(stored?.value)) + 1
  await client.setting.upsert({
    where: { key: RECEIPT_SEQ_KEY },
    update: { value: String(next) },
    create: { key: RECEIPT_SEQ_KEY, value: String(next) }
  })
  return next
}

/** بعد از ادغام/ورود دسته‌ای، شمارنده را تا آخرین شماره‌ی استفاده‌شده جلو می‌برد. */
export async function bumpReceiptSeq(client: ReceiptClient, used: number): Promise<void> {
  if (!Number.isSafeInteger(used) || used <= 0) return
  const stored = await client.setting.findUnique({ where: { key: RECEIPT_SEQ_KEY } })
  if (seqOf(stored?.value) >= used) return
  await client.setting.upsert({
    where: { key: RECEIPT_SEQ_KEY },
    update: { value: String(used) },
    create: { key: RECEIPT_SEQ_KEY, value: String(used) }
  })
}

export type ReceiptGapReason = 'voided' | 'missing'

export interface ReceiptGapRange {
  from: number
  to: number
  count: number
  reason: ReceiptGapReason
  label: string
}

export interface ReceiptGapReport {
  seq: number
  maxReceiptNo: number
  liveCount: number
  voidedCount: number
  missingCount: number
  ranges: ReceiptGapRange[]
}

const VOIDED_LABEL = 'ابطال — شماره رزرو مانده؛ فروش زنده نیست'
const MISSING_LABEL =
  'در جدول فاکتور نیست — معمولاً پاک‌سازی آرشیو (قدیمی‌تر از حدود ۲ سال با رمز مدیر) یا حذف بیرون از برنامه'

function isVoided(row: { voidedAt: Date | string | null; status: string }): boolean {
  if (row.voidedAt != null && String(row.voidedAt) !== '') return true
  const st = String(row.status ?? '')
  return st === 'CANCELED'
}

/**
 * بند ۴-۱۶ — گزارش شماره‌های جاافتاده.
 * شمارنده عقب نمی‌رود؛ این فقط *خواندنی* است و هیچ شماره‌ای نمی‌سازد یا عوض نمی‌کند.
 */
export async function receiptGapReport(client: ReceiptClient): Promise<ReceiptGapReport> {
  const last = await client.saleInvoice.findFirst({ orderBy: { receiptNo: 'desc' }, select: { receiptNo: true } })
  const stored = await client.setting.findUnique({ where: { key: RECEIPT_SEQ_KEY } })
  const maxReceiptNo = last?.receiptNo ?? 0
  const seq = Math.max(maxReceiptNo, seqOf(stored?.value))
  const rows = seq > 0 ? await client.saleInvoice.findMany({ select: { receiptNo: true, voidedAt: true, status: true } }) : []
  const byNo = new Map<number, 'live' | 'voided'>()
  for (const r of rows) {
    const n = Math.round(Number(r.receiptNo))
    if (!Number.isSafeInteger(n) || n <= 0) continue
    const mark = isVoided(r) ? 'voided' : 'live'
    const prev = byNo.get(n)
    if (prev === 'live') continue
    byNo.set(n, mark === 'live' || prev == null ? mark : prev)
  }
  let liveCount = 0
  let voidedCount = 0
  let missingCount = 0
  const marks: Array<'live' | 'voided' | 'missing'> = []
  for (let n = 1; n <= seq; n++) {
    const m = byNo.get(n)
    if (m === 'live') {
      liveCount++
      marks.push('live')
    } else if (m === 'voided') {
      voidedCount++
      marks.push('voided')
    } else {
      missingCount++
      marks.push('missing')
    }
  }
  const ranges: ReceiptGapRange[] = []
  let i = 0
  while (i < marks.length) {
    const reason = marks[i]
    let j = i
    while (j + 1 < marks.length && marks[j + 1] === reason) j++
    if (reason !== 'live') {
      const from = i + 1
      const to = j + 1
      ranges.push({
        from,
        to,
        count: to - from + 1,
        reason,
        label: reason === 'voided' ? VOIDED_LABEL : MISSING_LABEL
      })
    }
    i = j + 1
  }
  return { seq, maxReceiptNo, liveCount, voidedCount, missingCount, ranges }
}
