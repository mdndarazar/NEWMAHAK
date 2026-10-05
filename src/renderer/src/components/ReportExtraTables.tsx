import { faDigits, money } from '@shared/jalali'
import { creditOutstandingOf, outstandingCreditRows, ledgerCashTitle } from '@shared/reportExtraOutput'

/**
 * ===========================================================================
 * جلسه ۱۵ — بدنه‌ی چهار تب تازه‌ی «گزارشات فروش»:
 *   • چک‌ها (بند ۱۴ و ۳-ه)      • اعتبار خرید (بند ۱۴ و ۳-و)
 *   • دفتر رویداد (بخش ۵)        • بازبینی ضدتقلب (بخش ۶)
 *
 * قاعده‌ها: هیچ محاسبه‌ای اینجا انجام نمی‌شود (همه‌ی اعداد از سرور و در نهایت از
 * `src/shared/accounting.ts` می‌آیند)، و هر بخش جمعِ خودش را حتی وقتی صفر است
 * نشان می‌دهد — چون «نبودن ردیف» با «صفر بودن ردیف» یکی نیست.
 * ===========================================================================
 */

const LABELS: Record<string, string> = {
  id: 'شناسه',
  invoiceId: 'فاکتور',
  receiptNo: 'شماره سند',
  dateJalali: 'تاریخ',
  time: 'ساعت',
  customerName: 'مشتری',
  userName: 'کاربر',
  shiftName: 'شیفت',
  amount: 'مبلغ',
  total: 'مبلغ',
  chequeNo: 'شماره چک',
  dueDate: 'سررسید',
  dueDateJalali: 'سررسید',
  chequeStatus: 'وضعیت چک',
  clearedAtJalali: 'تاریخ پاس‌شدن',
  status: 'وضعیت',
  code: 'کد',
  issuedAtJalali: 'تاریخ صدور',
  usedAtJalali: 'تاریخ مصرف',
  usedReceiptNo: 'فاکتور مصرف',
  exchangeReceiptNo: 'سند تعویض مبدأ',
  remainingAmount: 'مانده',
  eventType: 'نوع رویداد',
  eventLabel: 'رویداد',
  cashEffect: 'اثر نقدی',
  cashNote: 'توضیح اثر نقدی',
  stockEffect: 'اثر انبار',
  sourceKind: 'نوع سند',
  sourceId: 'سند',
  label: 'شرح',
  note: 'توضیح',
  channel: 'کانال',
  refundMethod: 'روش بازپرداخت',
  daysLate: 'روز تأخیر',
  daysLeft: 'روز مانده'
  ,
  chequeHistoryText: 'تاریخچه وضعیت چک',
  /** نشست ۱۶۴ · Y22 · بند ۴-۵۲ */
  chequeNeedsReview: 'نیاز به بازبینی',
  chequeReviewNote: 'هشدار بازبینی چک'
}

const MONEY_KEYS = /amount|total|price|refund|diff|balance|credit|cash|card|value/i

function label(k: string): string {
  return LABELS[k] ?? k
}

function cell(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return MONEY_KEYS.test(k) ? money(v) : faDigits(String(v))
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر'
  return faDigits(String(v))
}

/** یک جدول عمومی: ستون‌ها از کلیدهای خودِ ردیف‌ها ساخته می‌شوند. */
function Table({
  title,
  rows,
  sum,
  emptyText,
  tone,
  onOpenInvoice
}: {
  title: string
  rows: any[]
  sum?: number
  emptyText?: string
  tone?: 'bad' | 'warn' | 'good'
  onOpenInvoice?: (id: number) => void
}) {
  const list = Array.isArray(rows) ? rows : []
  const keys = list.length ? Object.keys(list[0]).filter((k) => !/Json$|^raw/.test(k)).slice(0, 12) : []
  const border = tone === 'bad' ? 'border-red-400' : tone === 'warn' ? 'border-amber-400' : 'border-slate-200'
  return (
    <div className={`mt-3 rounded border ${border} bg-white`}>
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-bold">
        <span>{title}</span>
        <span className="tabular-nums">
          {faDigits(list.length)} ردیف
          {sum !== undefined ? ` · جمع: ${money(sum)}` : ''}
        </span>
      </div>
      {!list.length ? (
        <div className="px-3 py-3 text-xs text-slate-500">{emptyText ?? 'در این بازه ردیفی نیست (صفر).'}</div>
      ) : (
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {keys.map((k) => (
                  <th key={k} className="border-b px-2 py-1 text-right font-medium">
                    {label(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr
                  key={i}
                  className={`hover:bg-slate-50 ${r.invoiceId && onOpenInvoice ? 'cursor-pointer' : ''}`}
                  onClick={() => r.invoiceId && onOpenInvoice?.(Number(r.invoiceId))}
                >
                  {keys.map((k) => (
                    <td key={k} className="border-b px-2 py-1 tabular-nums">
                      {cell(k, r[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Notes({ items, tone }: { items?: string[]; tone?: 'bad' }) {
  if (!items || !items.length) return null
  return (
    <div
      className={`mt-2 rounded border p-2 text-xs leading-6 ${
        tone === 'bad' ? 'border-red-400 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-800'
      }`}
    >
      {items.map((t, i) => (
        <div key={i}>• {t}</div>
      ))}
    </div>
  )
}

const pick = (src: any, ...keys: string[]): any[] => {
  if (Array.isArray(src)) return src
  for (const k of keys) if (Array.isArray(src?.[k])) return src[k]
  return []
}

export default function ReportExtraTables({
  tab,
  cheques,
  chequeDateMode,
  onChequeDateMode,
  storeCredits,
  ledger,
  fraud,
  onOpenInvoice
}: {
  tab: 'cheques' | 'storeCredits' | 'ledger' | 'fraud'
  cheques: any
  chequeDateMode: 'due' | 'paid' | 'cleared'
  onChequeDateMode: (m: 'due' | 'paid' | 'cleared') => void
  storeCredits: any
  ledger: any
  fraud: any
  onOpenInvoice?: (id: number) => void
}) {
  // ---------------------------- تب چک‌ها ----------------------------
  if (tab === 'cheques') {
    const rows: any[] = pick(cheques, 'rows', 'items') || []
    const st = (r: any) => String(r.chequeStatus ?? r.status ?? '').toUpperCase()
    const registered = rows
    const cleared = rows.filter((r) => st(r) === 'CLEARED')
    const bounced = rows.filter((r) => st(r) === 'BOUNCED')
    const pending = rows.filter((r) => st(r) === 'PENDING' || st(r) === '')
    const late = pending.filter((r) => Number(r.daysLate ?? 0) > 0)
    const future = pending.filter((r) => !(Number(r.daysLate ?? 0) > 0))
    const sum = (l: any[]) => l.reduce((a, r) => a + Number(r.amount ?? r.total ?? 0), 0)
    return (
      <div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-slate-500">مبنای تاریخ:</span>
          {(['due', 'paid', 'cleared'] as const).map((m) => (
            <button
              key={m}
              className={`btn btn-xs ${chequeDateMode === m ? 'btn-primary' : ''}`}
              onClick={() => onChequeDateMode(m)}
            >
              {m === 'due' ? 'سررسید' : m === 'paid' ? 'تاریخ ثبت' : 'تاریخ پاس‌شدن'}
            </button>
          ))}
          <span className="text-slate-400">
            (چک در جریان زیرمجموعه‌ی «نسیه‌ی باقی‌مانده» است و در پل تطبیق فقط یک‌بار شمرده می‌شود.)
          </span>
        </div>
        <Table title="چک‌های ثبت‌شده در بازه — اثر نقدی صفر" rows={registered} sum={sum(registered)} onOpenInvoice={onOpenInvoice} />
        <Table title="چک پاس‌شده در بازه — اثر نقدی مثبت (بر اساس تاریخ پاس‌شدن)" rows={cleared} sum={sum(cleared)} tone="good" onOpenInvoice={onOpenInvoice} />
        <Table title="چک در جریان — سررسید گذشته ⚠" rows={late} sum={sum(late)} tone="bad" onOpenInvoice={onOpenInvoice} />
        <Table title="چک در جریان — سررسید نرسیده" rows={future} sum={sum(future)} tone="warn" onOpenInvoice={onOpenInvoice} />
        <Table title="چک برگشت‌خورده ⚠ — اثر نقدی صفر" rows={bounced} sum={sum(bounced)} tone="bad" onOpenInvoice={onOpenInvoice} />
        <Notes items={cheques?.notes ?? cheques?.warnings} />
      </div>
    )
  }

  // ------------------------ تب اعتبار خرید ------------------------
  if (tab === 'storeCredits') {
    const rows: any[] = pick(storeCredits, 'rows', 'items')
    const issued = rows
    const used = rows.filter((r) => String(r.status ?? '').toUpperCase() === 'USED' || r.usedAtJalali)
    // ممیزی A94-01 — «مانده‌ی بدهی ما» = فعال + مصرف بخشی، با جمع مانده (نه مبلغ اولیه)
    const active = outstandingCreditRows(rows)
    const expired = rows.filter((r) => String(r.status ?? '').toUpperCase() === 'EXPIRED')
    const canceled = rows.filter((r) => String(r.status ?? '').toUpperCase() === 'CANCELED')
    const sum = (l: any[]) => l.reduce((a, r) => a + Number(r.amount ?? r.total ?? 0), 0)
    return (
      <div>
        {storeCredits?.page?.truncated && (
          <div className="mt-3 rounded border-2 border-red-500 bg-red-50 p-2 text-xs leading-6 text-red-700">
            ⚠ {storeCredits.warnings?.join(' ') ?? `نمایش ${faDigits(rows.length)} از ${faDigits(storeCredits.page.totalCount)} ردیف؛ صفحه‌ی بعد را بگیرید.`}
          </div>
        )}
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-6 text-slate-600">
          اعتبار صادرشده در لحظه‌ی صدور <b>بدهی فروشگاه</b> است، نه فروش و نه وجه نقد (اثر نقدی صفر). در لحظه‌ی مصرف هم
          کالا از انبار خارج می‌شود ولی <b>وجه نقدی دریافت نمی‌شود</b> — فقط یک فروش تعهدی بدون دریافت نقد، بابت اعتباری که
          پیش‌تر از سند تعویض/برگشت مبدأ صادر شده بود.
        </div>
        <Table title="اعتبار صادرشده (با ارجاع به سند تعویض/برگشت مبدأ)" rows={issued} sum={sum(issued)} onOpenInvoice={onOpenInvoice} />
        <Table title="اعتبار مصرف‌شده — کالا خارج شد، وجه نقد دریافت نشد" rows={used} sum={sum(used)} onOpenInvoice={onOpenInvoice} />
        <Table title="اعتبار فعال در پایان بازه (مانده‌ی بدهی ما)" rows={active} sum={active.reduce((a, r) => a + creditOutstandingOf(r), 0)} tone="warn" onOpenInvoice={onOpenInvoice} />
        <Table title="اعتبار منقضی‌شده" rows={expired} sum={sum(expired)} />
        <Table title="اعتبار لغوشده" rows={canceled} sum={sum(canceled)} />
        <Notes items={storeCredits?.notes ?? storeCredits?.warnings} />
      </div>
    )
  }

  // ------------------------- دفتر رویداد -------------------------
  if (tab === 'ledger') {
    const rows: any[] = pick(ledger, 'rows')
    return (
      <div>
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-6 text-slate-600">
          هر ردیف یک <b>رویداد مالی</b> است که با <b>تاریخ خودش</b> ثبت شده (فروش با تاریخ صدور، برگشت با تاریخ برگشت،
          پرداخت نسیه با تاریخ پرداخت، پاس‌شدن چک با تاریخ پاس‌شدن، مصرف اعتبار با تاریخ مصرف) — نه با تاریخ فاکتور مادر.
          ستون «اثر نقدی» می‌گوید این رویداد پول واقعی جابه‌جا کرده یا نه، و ستون کنارش می‌گوید چرا.
        </div>
        {/* ممیزی A106-02 — با برش، عنوان صریحاً «جمع ردیف‌های نمایش‌داده‌شده» است نه جمع کل بازه */}
        <Table title={ledgerCashTitle(ledger)} rows={rows} onOpenInvoice={onOpenInvoice} />
        <Notes items={ledger?.notes} />
        <Notes items={ledger?.warnings} tone="bad" />
      </div>
    )
  }

  // ---------------------- بازبینی ضدتقلب ----------------------
  const groups: any[] = pick(fraud, 'flags', 'groups', 'sections', 'rows')
  return (
    <div>
      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-6 text-slate-600">
        این تب «متهم‌کردن» نیست؛ فهرست چیزهایی است که <b>ارزش پرسیدن</b> دارند. هر گروه با همان فیلترهای بالای صفحه
        محاسبه شده و ردیف‌هایش قابل کلیک‌اند.
      </div>
      {!groups.length ? (
        <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700">
          هیچ موردِ قابل بازبینی در این بازه پیدا نشد (صفر).
        </div>
      ) : (
        groups.map((g, i) => (
          <Table
            key={i}
            title={`${g.title ?? g.label ?? g.key ?? 'گروه'}${(g.hint ?? g.detail) ? ` — ${g.hint ?? g.detail}` : ''}${
              g.sourcesTruncated
                ? ` · نمایش ${faDigits(g.sources?.length ?? 0)} از ${faDigits(g.sourcesTotal ?? 0)} سند`
                : ''
            }`}
            rows={Array.isArray(g.rows) ? g.rows : Array.isArray(g.items) ? g.items : Array.isArray(g.sources) ? g.sources : []}
            sum={typeof g.total === 'number' ? g.total : typeof g.amount === 'number' ? g.amount : undefined}
            tone={g.severity === 'HIGH' ? 'bad' : 'warn'}
            onOpenInvoice={onOpenInvoice}
          />
        ))
      )}
      <Notes items={fraud?.notes} />
    </div>
  )
}
