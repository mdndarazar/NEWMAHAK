import { useState, type ReactNode } from 'react'
import Modal from './Modal'
import { faDigits, money } from '@shared/jalali'
import { bridgeDrillPager } from '@shared/reportExtraOutput'
import {
  defaultSalesAccountingBlocksOpen,
  readSalesAccountingBlocksOpen,
  writeSalesAccountingBlocksOpen,
  type SalesAccountingBlockKey
} from '../lib/uiPrefs'
import type { SaleAccountingStatements, SaleBridgeRow, SaleBridgeSource } from '@shared/types'

/**
 * ===========================================================================
 * جلسه ۱۵ · بخش ۵ سند مرجع — «هفت بلوک» تب سرجمع فروش.
 *
 * ================== سه قاعده‌ی این کامپوننت ==================
 *   ۱) **هیچ محاسبه‌ای اینجا انجام نمی‌شود.** همه‌ی اعداد از
 *      `SaleAccountingStatements` می‌آیند که سمت main با `accounting.ts` ساخته
 *      شده. اگر یک جمعِ ساده هم اینجا نوشته می‌شد، همان می‌شد «فرمول دومِ
 *      renderer» که سند مرجع صریح ممنوع کرده است.
 *   ۲) **ردیف صفر هم نمایش داده می‌شود.** «نبودن ردیف» و «صفر بودن ردیف» دو
 *      معنی کاملاً متفاوت دارند: عوارضِ صفر یعنی در این بازه عوارض نگرفته‌ایم،
 *      نه این‌که نمی‌دانیم.
 *   ۳) **هر عدد قابل کلیک است** و به فهرست اسناد سازنده‌اش می‌رود: ردیف‌های پل
 *      تطبیق، اسنادشان را همان‌جا در یک پنجره باز می‌کنند (drill-down واقعی، از
 *      `bridge.rows[].sources`) و بقیه‌ی بلوک‌ها به تبِ همان اسناد می‌پرند.
 * ===========================================================================
 */

export type DrillTarget =
  | 'summary'
  | 'items'
  | 'ledger'
  | 'returns'
  | 'exchanges'
  | 'credit'
  | 'cheques'
  | 'storeCredits'

interface Props {
  statements: SaleAccountingStatements | null
  warnings?: string[]
  /** «از ۱۴۰۵/۰۶/۰۱ تا ۱۴۰۵/۰۶/۳۱» */
  range: string
  /** برچسب فیلتر تکی/عمده، تا یک بلوکِ فیلترشده با یک بلوک کامل اشتباه نشود */
  channelsText: string
  onDrill?: (target: DrillTarget) => void
  onOpenInvoice?: (invoiceId: number) => void
  /** بارگذاری صفحه‌ی بعدی اسناد سازنده از همان فیلتر گزارش */
  onBridgePage?: (key: string, skip: number) => void
}

/** یک ردیف دفتری: برچسب، علامت، عدد — و در صورت وجود، مقصد کلیک. */
function Row({
  label,
  value,
  sign,
  hint,
  tone,
  bold,
  onClick,
  goto
}: {
  label: string
  value: number
  sign?: 1 | -1 | 0
  hint?: string
  tone?: 'good' | 'warn' | 'bad' | 'muted'
  bold?: boolean
  onClick?: () => void
  goto?: string
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'bad'
          ? 'text-rose-700'
          : tone === 'muted'
            ? 'text-slate-500'
            : ''
  return (
    <tr className={bold ? 'bg-slate-100 font-bold' : ''}>
      <td className="whitespace-normal">
        {label}
        {hint && <div className="kbd font-normal leading-5">{hint}</div>}
      </td>
      <td className="text-center w-8">{sign === -1 ? '−' : sign === 1 ? '+' : ''}</td>
      <td className={`text-left tabular-nums ${toneClass} ${bold ? 'font-bold' : ''}`} dir="ltr">
        {onClick ? (
          <button className="text-brand underline decoration-dotted" onClick={onClick} title={goto ?? 'اسناد سازنده‌ی این عدد'}>
            {money(value)}
          </button>
        ) : (
          money(value)
        )}
      </td>
    </tr>
  )
}

/**
 * آکاردئون نمایشیِ بلوک‌های صورت حساب: باز/بسته شدن هیچ query، مبلغ، چاپ یا
 * خروجی را تغییر نمی‌دهد. preference نسخه‌دار localStorage است؛ نصب تازه بسته
 * شروع می‌شود و انتخاب کاربر بعد از جابه‌جایی صفحه باقی می‌ماند.
 */
function Block({
  blockKey,
  open,
  onToggle,
  title,
  subtitle,
  children
}: {
  blockKey: SalesAccountingBlockKey
  open: boolean
  onToggle: (key: SalesAccountingBlockKey) => void
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="bg-white rounded shadow">
      <button
        type="button"
        className="w-full px-3 py-2 border-b font-bold text-right flex items-center gap-2 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
        onClick={() => onToggle(blockKey)}
        aria-expanded={open}
      >
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-sm" aria-hidden="true">{open ? '−' : '+'}</span>
        <span>{title}</span>
        {subtitle && <span className="kbd font-normal ms-2">{subtitle}</span>}
        <span className="sr-only">{open ? 'بستن بخش' : 'باز کردن بخش'}</span>
      </button>
      {open && <table className="tbl"><tbody>{children}</tbody></table>}
    </section>
  )
}

export default function AccountingBlocks({
  statements,
  warnings = [],
  range,
  channelsText,
  onDrill,
  onOpenInvoice,
  onBridgePage
}: Props) {
  const [drillKey, setDrillKey] = useState<string | null>(null)
  const [blocksOpen, setBlocksOpen] = useState(readSalesAccountingBlocksOpen)
  const toggleBlock = (key: SalesAccountingBlockKey) => {
    setBlocksOpen((current) => {
      const next = { ...current, [key]: !current[key] }
      writeSalesAccountingBlocksOpen(next)
      return next
    })
  }
  const closeAllBlocks = () => {
    const next = defaultSalesAccountingBlocksOpen()
    writeSalesAccountingBlocksOpen(next)
    setBlocksOpen(next)
  }

  if (!statements)
    return (
      <div className="bg-amber-50 border border-amber-300 rounded p-3 whitespace-pre-line">
        صورت‌های حسابداری برای این بازه ساخته نشدند. «تهیه گزارش» را بزنید؛ اگر بازه بزرگ است کوچک‌ترش کنید.
      </div>
    )

  const s = statements
  const drill = drillKey ? s.bridge.rows.find((row) => row.key === drillKey) ?? null : null
  const pager = bridgeDrillPager(drill?.sourcesPage, drill?.sources.length ?? 0)
  const jump = (t: DrillTarget) => (onDrill ? () => onDrill(t) : undefined)
  const openBridge = (row: SaleBridgeRow) => {
    setDrillKey(row.key)
    if (!row.sourcesPage && onBridgePage) onBridgePage(row.key, 0)
  }

  return (
    <div className="space-y-2">
      <div className="bg-white rounded shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <b>صورت‌های حسابداری بازه</b>
        <span className="kbd">{range}</span>
        <span className="kbd">نوع فروش: {channelsText}</span>
        <span className="kbd">
          بازه‌ی مؤثر:{' '}
          {s.period.fromJalali ? `${faDigits(s.period.fromJalali)} تا ${faDigits(s.period.toJalali ?? '—')}` : 'بدون بازه'}
          {' · '}
          {s.period.source === 'explicit'
            ? 'بازه‌ی انتخابی شما'
            : s.period.source === 'shift'
              ? 'از شیفت انتخابی'
              : s.period.source === 'rows'
                ? 'از تاریخ خودِ ردیف‌ها'
                : 'خالی'}
        </span>
        <span className="kbd">
          ردیف‌های صفر هم عمداً نمایش داده می‌شوند؛ «نبودن ردیف» با «صفر بودن» یکی نیست
        </span>
        <button type="button" className="btn py-1" onClick={closeAllBlocks}>
          بستن همهٔ بخش‌ها
        </button>
      </div>

      {!!warnings.length && (
        <div className="bg-rose-50 border-2 border-rose-400 rounded p-3 space-y-1">
          <b className="text-rose-800">هشدارهای گزارش (نباید نادیده گرفته شوند)</b>
          {warnings.map((w, i) => (
            <div key={i} className="whitespace-pre-line">
              • {w}
            </div>
          ))}
        </div>
      )}

      {!!s.notes.length && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 space-y-1">
          <b>یادداشت تفکیک‌پذیری فیلترها</b>
          {s.notes.map((w, i) => (
            <div key={i} className="whitespace-pre-line">
              • {w}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {/* ------------------------- بلوک ۱: فاکتور ------------------------- */}
        <Block blockKey="invoice" open={blocksOpen.invoice} onToggle={toggleBlock} title="۱) فاکتور — صورت تعهدی (بر مبنای تاریخ صدور فاکتور)" subtitle={`${faDigits(s.invoice.invoiceCount)} فاکتور`}>
          <Row label="فروش ناخالص (مبلغ کالا، پیش از تخفیف)" value={s.invoice.grossSales} sign={1} onClick={jump('summary')} />
          <Row label="تخفیف" value={s.invoice.discounts} sign={-1} onClick={jump('items')} />
          <Row label="عوارض و مالیات" value={s.invoice.taxes} sign={1} />
          <Row label="حق سرویس" value={s.invoice.serviceCharges} sign={1} />
          <Row label="هزینه پیک" value={s.invoice.deliveryFees} sign={1} />
          <Row
            label="برگشت ساده (فقط kind=RETURN)"
            value={s.invoice.simpleReturns}
            sign={-1}
            hint="ارزش کالای برگشتیِ داخل تعویض در این عدد نیست و هیچ‌وقت دوبار کم نمی‌شود."
            onClick={jump('returns')}
          />
          <Row
            label="ارزش کالای برگشتی داخل تعویض (جدا، از فروش کم نمی‌شود)"
            value={s.invoice.exchangeReturned}
            sign={0}
            tone="muted"
            onClick={jump('exchanges')}
          />
          <Row label="خالص فروش تعهدی" value={s.invoice.netAccrualSales} bold />
        </Block>

        {/* -------------------------- بلوک ۲: نسیه -------------------------- */}
        <Block blockKey="credit" open={blocksOpen.credit} onToggle={toggleBlock} title="۲) نسیه" subtitle="هر عدد با تاریخ خودش، نه تاریخ فاکتور مادر">
          <Row label="نسیه‌ی ایجادشده توسط فاکتورهای همین بازه" value={s.credit.created} sign={0} onClick={jump('credit')} />
          <Row label="وصول نسیه‌ی همین بازه، در همین بازه" value={s.credit.settledCurrent} sign={0} onClick={jump('credit')} />
          <Row
            label="وصول نسیه‌ی بازه‌های قبل، در این بازه (بر اساس تاریخ پرداخت)"
            value={s.credit.settledPrior}
            sign={0}
            hint="پول واقعیِ این بازه است، ولی فروشِ این بازه نیست."
            onClick={jump('credit')}
          />
          <Row
            label="باقی‌ماندهٔ بدهی همین فاکتورها"
            value={s.credit.remaining}
            sign={0}
            hint="فرمول درست‌شده: جمع کل − پرداختی − برگشت ساده (هر فاکتور جدا، هیچ‌وقت منفی)."
            tone="warn"
            bold
            onClick={jump('credit')}
          />
          <Row
            label="از این بدهی، چک در جریان (زیرمجموعه‌ی همین بدهی است، جمع دوباره نمی‌شود)"
            value={s.credit.pendingCheques}
            sign={0}
            tone="muted"
            onClick={jump('cheques')}
          />
          <Row label="چک برگشتی" value={s.credit.bouncedCheques} sign={0} tone="bad" onClick={jump('cheques')} />
        </Block>

        {/* --------------------- بلوک ۳: برگشت و تعویض --------------------- */}
        <Block blockKey="returns" open={blocksOpen.returns} onToggle={toggleBlock} title="۳) برگشت و تعویض" subtitle={`${faDigits(s.returns.returnCount)} برگشت · ${faDigits(s.returns.exchangeCount)} تعویض`}>
          <Row label="برگشت ساده" value={s.returns.simpleReturns} sign={0} onClick={jump('returns')} />
          <Row label="بازپرداخت نقدی برگشت (از کشو بیرون رفت)" value={s.returns.cashRefunds} sign={-1} tone="bad" onClick={jump('returns')} />
          <Row label="بازپرداخت کارتی برگشت" value={s.returns.cardRefunds} sign={-1} onClick={jump('returns')} />
          <Row label="اعتبار خرید صادرشده بابت برگشت" value={s.returns.storeCreditRefunds} sign={0} onClick={jump('storeCredits')} />
          <Row
            label="برگشتی که فقط بدهی مشتری را کم کرد (هیچ نقدی جابه‌جا نشد)"
            value={s.returns.debtOnlyReturns}
            sign={0}
            tone="muted"
            onClick={jump('returns')}
          />
          <Row label="ارزش کالای برگشتی داخل تعویض" value={s.returns.exchangeReturned} sign={0} onClick={jump('exchanges')} />
          <Row label="ارزش کالای جایگزین تعویض" value={s.returns.exchangeReplacement} sign={0} onClick={jump('exchanges')} />
          <Row label="مابه‌التفاوت دریافتی از مشتری" value={s.returns.exchangeDiffReceived} sign={1} tone="good" onClick={jump('exchanges')} />
          <Row label="مابه‌التفاوت بازپرداخت‌شده‌ی نقدی (تعویض)" value={s.returns.exchangeCashRefunds} sign={-1} tone="bad" onClick={jump('exchanges')} />
          <Row label="مابه‌التفاوت بازپرداخت‌شده‌ی کارتی (تعویض)" value={s.returns.exchangeCardRefunds} sign={-1} onClick={jump('exchanges')} />
          <Row
            label="اعتبار خرید صادرشده بابت مابه‌التفاوت تعویض"
            value={s.returns.exchangeStoreCreditIssued}
            sign={0}
            hint="بدهی ما به مشتری؛ نه فروش است و نه وجه نقد."
            onClick={jump('storeCredits')}
          />
          {s.returns.legacyAssumedCount > 0 && (
            <tr className="bg-amber-50">
              <td colSpan={3} className="whitespace-normal text-amber-800 font-bold">
                {faDigits(s.returns.legacyAssumedCount)} برگشت قدیمی روش بازپرداخت ثبت‌شده ندارد و با فرض «فقط بدهی مشتری
                کم شد» خوانده شده است (برچسب: فرض‌شده از داده‌ی قدیمی).
              </td>
            </tr>
          )}
        </Block>

        {/* ---------------------------- بلوک ۴: چک ---------------------------- */}
        <Block blockKey="cheques" open={blocksOpen.cheques} onToggle={toggleBlock} title="۴) چک — همیشه، حتی صفر" subtitle="چک پاس‌نشده هیچ‌وقت پول نیست">
          <Row label="چک ثبت‌شده در این بازه (اثر نقدی صفر)" value={s.cheques.registered} sign={0} onClick={jump('cheques')} />
          <Row
            label="چک پاس‌شده در این بازه (بر اساس تاریخ پاس‌شدن)"
            value={s.cheques.cleared}
            sign={1}
            tone="good"
            onClick={jump('cheques')}
          />
          <Row
            label={`چک در جریان، سررسید نرسیده (${faDigits(s.cheques.futureCount)} فقره)`}
            value={s.cheques.pendingFuture}
            sign={0}
            onClick={jump('cheques')}
          />
          <Row
            label={`چک در جریان، سررسید گذشته (${faDigits(s.cheques.pastDueCount)} فقره)`}
            value={s.cheques.pendingPastDue}
            sign={0}
            tone="bad"
            bold={s.cheques.pendingPastDue > 0}
            onClick={jump('cheques')}
          />
          <Row label="چک برگشت‌خورده (اثر نقدی صفر)" value={s.cheques.bounced} sign={0} tone="bad" onClick={jump('cheques')} />
          <Row
            label="از چک‌های پاس‌شده، مربوط به فاکتورهای بازه‌های قبل"
            value={s.cheques.priorCleared}
            sign={0}
            tone="muted"
            onClick={jump('cheques')}
          />
          {s.cheques.warnings.map((w, i) => (
            <tr key={i} className="bg-rose-50">
              <td colSpan={3} className="text-rose-800 font-bold whitespace-normal">
                {w}
              </td>
            </tr>
          ))}
        </Block>

        {/* ----------------------- بلوک ۵: اعتبار خرید ----------------------- */}
        <Block blockKey="storeCredits" open={blocksOpen.storeCredits} onToggle={toggleBlock} title="۵) اعتبار خرید — همیشه، حتی صفر" subtitle={`${faDigits(s.storeCredits.issuedCount)} صدور · ${faDigits(s.storeCredits.usageCount)} مصرف`}>
          <Row
            label="اعتبار صادرشده در این بازه (بدهی ما، اثر نقدی صفر)"
            value={s.storeCredits.issued}
            sign={0}
            hint="لحظه‌ی صدور، درآمد نیست؛ اگر به فروش اضافه می‌شد، با تعویضِ صوری می‌شد فروشِ کاغذی ساخت."
            onClick={jump('storeCredits')}
          />
          <Row
            label="اعتبار مصرف‌شده در این بازه (کالا رفت، وجه جدید نیامد)"
            value={s.storeCredits.used}
            sign={0}
            onClick={jump('storeCredits')}
          />
          <Row label="اعتبار فعال در پایان بازه (مانده‌ی بدهی ما)" value={s.storeCredits.active} sign={0} tone="warn" bold onClick={jump('storeCredits')} />
          <Row label="ماندهٔ منقضی‌شده در بازهٔ انتخابی" value={s.storeCredits.expiredInRange ?? s.storeCredits.expired} sign={0} tone="muted" onClick={jump('storeCredits')} />
          <Row label="ماندهٔ منقضی تا پایان بازه (snapshot وضعیت)" value={s.storeCredits.expired} sign={0} tone="muted" onClick={jump('storeCredits')} />
          <Row label="اعتبار لغوشده" value={s.storeCredits.canceled} sign={0} tone="muted" onClick={jump('storeCredits')} />
        </Block>

        {/* ------------------------ بلوک ۶: وجه واقعی ------------------------ */}
        <Block blockKey="cash" open={blocksOpen.cash} onToggle={toggleBlock} title="۶) وجه واقعی (بر مبنای تاریخ دریافت واقعی)" subtitle="چک پاس‌نشده و اعتبار خرید هرگز اینجا نیستند">
          <Row label="نقد دریافتی" value={s.cash.cashReceived} sign={1} onClick={jump('ledger')} />
          <Row label="کارت دریافتی" value={s.cash.cardReceived} sign={1} onClick={jump('ledger')} />
          <Row label="سایر روش‌های دریافتی" value={s.cash.otherReceived} sign={1} onClick={jump('ledger')} />
          <Row label="چک پاس‌شده (تاریخ پاس‌شدن)" value={s.cash.clearedChequeReceived} sign={1} onClick={jump('cheques')} />
          {/* نشست ۱۶۴ · Y21 (بند ۴-۵۳) — داخل ردیف‌های نقد/کارت/چک بالاست؛ فقط نمایشی، در خالص دوباره جمع نمی‌شود */}
          <Row label="از دریافتی‌های بالا: وصول نسیه‌ی دوره‌ی قبل (تاریخ پرداخت)" value={s.cash.priorCreditSettlements} sign={0} onClick={jump('credit')} />
          {/* نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی، داخل ردیف بالا؛ در خالص جمع نمی‌شود */}
          {(s.credit.settledPriorOverpay ?? 0) > 0 && <Row label="از وصول بالا: اضافه‌دریافت روی فاکتورهای دوره‌ی قبل (بیش از بدهی — فروش نیست)" value={s.credit.settledPriorOverpay ?? 0} sign={0} tone="warn" onClick={jump('credit')} />}
          <Row label="بازپرداخت نقدی برگشت" value={s.cash.cashRefundsForReturns} sign={-1} onClick={jump('returns')} />
          <Row label="بازپرداخت کارتی برگشت" value={s.cash.cardRefundsForReturns} sign={-1} onClick={jump('returns')} />
          <Row label="بازپرداخت نقدی تعویض" value={s.cash.cashRefundsForExchanges} sign={-1} onClick={jump('exchanges')} />
          <Row label="بازپرداخت کارتی تعویض" value={s.cash.cardRefundsForExchanges} sign={-1} onClick={jump('exchanges')} />
          <Row label="برداشت از صندوق" value={s.cash.cashWithdrawals} sign={-1} tone="warn" />
          <Row label="واریز به صندوق" value={s.cash.cashDeposits} sign={1} />
          <Row label="خالص وجه واقعی" value={s.cash.netCashMovement} bold />
        </Block>
      </div>

      {/* -------------------------- بلوک ۷: پل تطبیق -------------------------- */}
      <section className={`bg-white rounded shadow border-2 ${s.bridge.balanced ? 'border-emerald-500' : 'border-rose-500'}`}>
        <button
          type="button"
          className="w-full px-3 py-2 border-b font-bold text-right flex flex-wrap items-center gap-2 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
          onClick={() => toggleBlock('bridge')}
          aria-expanded={blocksOpen.bridge}
        >
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-sm" aria-hidden="true">{blocksOpen.bridge ? '−' : '+'}</span>
          <span>۷) پل تطبیق — «وجه واقعی» تا «خالص فروش تعهدی»، ریال‌به‌ریال</span>
          <span className={`px-2 py-0.5 rounded font-bold ${s.bridge.balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
            {s.bridge.balanced ? 'پل کامل بسته شد' : `${money(Math.abs(s.bridge.unexplained))} ریال بدون توضیح`}
          </span>
          <span className="kbd font-normal">روی هر عدد کلیک کنید تا اسناد سازنده‌اش باز شود</span>
          <span className="sr-only">{blocksOpen.bridge ? 'بستن بخش' : 'باز کردن بخش'}</span>
        </button>
        {blocksOpen.bridge && <table className="tbl">
          <thead>
            <tr>
              <th>ردیف</th>
              <th className="w-8">علامت</th>
              <th className="text-left">مبلغ</th>
              <th>اسناد</th>
            </tr>
          </thead>
          <tbody>
            {s.bridge.rows.map((r) => (
              <tr key={r.key}>
                <td className="whitespace-normal">
                  {r.label}
                  {r.hint && <div className="kbd font-normal leading-5">{r.hint}</div>}
                </td>
                <td className="text-center">{r.sign === -1 ? '−' : '+'}</td>
                <td className="text-left tabular-nums" dir="ltr">
                  <button className="text-brand underline decoration-dotted" onClick={() => openBridge(r)}>
                    {money(r.amount)}
                  </button>
                </td>
                <td>
                    <button className="btn py-0.5" onClick={() => openBridge(r)}>
                    {r.sources.length ? `${faDigits(r.sources.length)} سند` : 'نمایش'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td>جمع توضیح‌داده‌شده</td>
              <td></td>
              <td className="text-left tabular-nums" dir="ltr">
                {money(s.bridge.explainedTotal)}
              </td>
              <td></td>
            </tr>
            <tr className="bg-slate-100 font-bold">
              <td>خالص فروش تعهدی همین بازه (هدف پل)</td>
              <td></td>
              <td className="text-left tabular-nums" dir="ltr">
                {money(s.bridge.target)}
              </td>
              <td></td>
            </tr>
            <tr className={s.bridge.balanced ? 'bg-emerald-50 font-bold' : 'bg-rose-50 font-bold'}>
              <td>باقی‌ماندهٔ توضیح‌نداده</td>
              <td></td>
              <td className="text-left tabular-nums" dir="ltr">
                {money(s.bridge.unexplained)}
              </td>
              <td className="whitespace-normal">
                {s.bridge.balanced
                  ? 'همه‌ی شکاف بین کارت‌خوان/صندوق و فروش خالص توضیح داده شد.'
                  : 'این مبلغ توضیح ندارد؛ ردیف‌ها را باز کنید و اسناد را بررسی کنید.'}
              </td>
            </tr>
          </tfoot>
        </table>}
      </section>

      {/* ---------------------- drill-down اسناد یک ردیف ---------------------- */}
      <Modal
        open={!!drill}
        title={drill ? `اسناد سازنده‌ی «${drill.label}» — ${money(drill.amount)} ریال` : ''}
        onClose={() => setDrillKey(null)}
        width="max-w-5xl"
      >
        {drill && (
          <>
            {drill.hint && <div className="kbd whitespace-pre-line">{drill.hint}</div>}
            {drill.sourcesWarning && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-2 text-amber-900">
                ⚠ {drill.sourcesWarning}
              </div>
            )}
            {!drill.sources.length ? (
              <div className="bg-amber-50 border border-amber-300 rounded p-3 whitespace-pre-line">
                برای این ردیف سندی برگردانده نشده است. اگر عدد ردیف صفر نیست، تیک «اسناد سازنده‌ی پل تطبیق» را در نوار
                پایین صفحه روشن کنید و گزارش را دوباره بگیرید (این کار گزارش را سنگین‌تر می‌کند، پس پیش‌فرض خاموش است).
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>نوع سند</th>
                    <th>شرح</th>
                    <th>تاریخ</th>
                    <th className="text-left">مبلغ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {drill.sources.map((src: SaleBridgeSource) => (
                    <tr key={`${src.kind}-${src.id}`}>
                      <td>{KIND_LABELS[src.kind] ?? src.kind}</td>
                      <td className="whitespace-normal">{src.label}</td>
                      <td>{faDigits(src.dateJalali ?? '—')}</td>
                      <td className="text-left tabular-nums font-bold" dir="ltr">
                        {money(src.amount)}
                      </td>
                      <td>
                        {src.invoiceId && onOpenInvoice && (
                          <button className="btn py-0.5" onClick={() => onOpenInvoice(src.invoiceId as number)}>
                            پرداختی‌های فاکتور
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={3}>جمع {faDigits(drill.sources.length)} سند نمایش‌داده‌شده</td>
                    <td className="text-left tabular-nums" dir="ltr">
                      {money(drill.sources.reduce((sum, x) => sum + x.amount, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
            {/* ممیزی A108-03 — نوار صفحه در صفحه‌ی آخر هم (bridgeDrillPager) */}
            {pager.show && onBridgePage && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-2">
                <span className="text-xs">
                  صفحه {faDigits(pager.pageNo)} از {faDigits(pager.pageCount)}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn py-0.5"
                    disabled={!pager.canPrev}
                    onClick={() => onBridgePage(drill.key, pager.prevSkip)}
                  >
                    صفحه قبل
                  </button>
                  <button
                    className="btn py-0.5"
                    disabled={!pager.canNext}
                    onClick={() => onBridgePage(drill.key, pager.nextSkip)}
                  >
                    صفحه بعد
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

const KIND_LABELS: Record<string, string> = {
  INVOICE: 'فاکتور فروش',
  RETURN: 'سند برگشت',
  PAYMENT: 'پرداختی',
  STORE_CREDIT: 'اعتبار خرید',
  CASH_MOVEMENT: 'گردش نقدی صندوق'
}
