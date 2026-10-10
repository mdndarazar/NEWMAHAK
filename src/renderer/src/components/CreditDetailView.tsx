import { faDigits, money } from '@shared/jalali'
import {
  CREDIT_OP_TITLES,
  CREDIT_REDEMPTION_HEADERS,
  CREDIT_REMINDER_LOG_HEADERS,
  CREDIT_TIMELINE_HEADERS,
  CreditOp,
  TONE_CLASS,
  creditDetailPrintBadges,
  detailFactBlocks,
  redemptionRow,
  reminderLogRow,
  statusTone,
  timelineRow,
  type CreditExportKind
} from '@shared/creditUi'
import type { CreditDetail, SaleReportPage } from '@shared/types'

/**
 * ===========================================================================
 * صفحه‌ی جزئیات یک اعتبار (§۱۶ · §۱۲ · §۱۸ · §۱۹ · پرسش Q1 ممیزی جلسه ۲۷).
 *
 * تا جلسه ۲۷ این صفحه ۸ فیلد + Timeline بود، در حالی که سرویس **از جلسه ۲۱**
 * این‌ها را هم برمی‌گرداند و دور ریخته می‌شد: گیرنده، محدودیت‌ها، صادرکننده،
 * فاکتور اصلی/سند تعویض/برگشتی/فاکتور مصرف، اعتبار باقی‌مانده، دسته‌ی گروهی،
 * دلیل استثنا، **دفتر مصرف** (`detail.redemptions`) و **لاگ یادآوری**
 * (`detail.reminders`).
 *
 * تصمیم «چه چیزی در کدام بلوک» در `detailFactBlocks` نشسته است (تست‌شده)، و
 * ردیف هر جدول همان ردیف‌سازِ خروجی اکسل است — پس جدول روی صفحه و فایل اکسل
 * هیچ‌وقت از هم جدا نمی‌شوند.
 * ===========================================================================
 */

function Table({
  title,
  headers,
  rows,
  empty,
  onExport,
  page,
  warnings,
  onPage
}: {
  title: string
  headers: string[]
  rows: (string | number | null)[][]
  empty: string
  onExport?: () => void
  page?: SaleReportPage
  warnings?: string[]
  onPage?: (skip: number) => void
}) {
  return (
    <div className="tbl-card overflow-auto">
      <div className="p-2 flex items-center gap-2 border-b flex-wrap">
        <h3 className="font-bold">{title}</h3>
        <span className="kbd">
          {faDigits(rows.length)} ردیف{page ? ` از ${faDigits(page.totalCount)}` : ''}
        </span>
        {onExport && !!rows.length && (
          <button className="btn py-1 mr-auto" onClick={onExport}>
            خروجی اکسل
          </button>
        )}
      </div>
      {rows.length ? (
        <table className="tbl">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell === '' || cell == null ? '—' : typeof cell === 'number' ? faDigits(cell) : cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="kbd p-3">{empty}</div>
      )}
      {(warnings?.length || page) && (
        <div className="p-2 flex items-center gap-2 flex-wrap border-t">
          {warnings?.map((warning) => (
            <span key={warning} className="kbd bg-amber-100 border border-amber-300">
              {warning}
            </span>
          ))}
          {page && onPage && (
            <div className="flex gap-1 mr-auto">
              <button className="btn py-1" disabled={!page.skip} onClick={() => onPage(Math.max(0, page.skip - page.take))}>
                صفحه‌ی قبل
              </button>
              <button className="btn py-1" disabled={!page.truncated} onClick={() => onPage(page.skip + page.take)}>
                صفحه‌ی بعد
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CreditDetailView({
  detail,
  onOp,
  onBack,
  onPrint,
  printing = false,
  onPreview,
  onPdf,
  onExport,
  onPage,
  canRevealCode = false,
  managerCode = null,
  onRevealCode
}: {
  detail: CreditDetail
  onOp: (op: CreditOp) => void
  onBack: () => void
  onPrint: (copies: number) => void
  printing?: boolean
  onPreview: () => void
  onPdf: () => void
  onExport: (kind: CreditExportKind) => void
  onPage: (kind: 'timeline' | 'reminders', skip: number) => void
  canRevealCode?: boolean
  managerCode?: string | null
  onRevealCode?: () => void
}) {
  const c: any = detail.credit
  const printBadges = creditDetailPrintBadges(c.printCount, faDigits)
  const blocks = detailFactBlocks(detail)

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap items-center">
        <button className="btn" onClick={onBack}>
          ← بازگشت
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onPrint(1)}
          disabled={printing || !canRevealCode}
          title={canRevealCode ? undefined : 'چاپ کد اعتبار فقط با نشست فعال مدیر مجاز است'}
        >
          {printing ? 'در حال چاپ…' : 'چاپ سند'}
        </button>
        <button className="btn" onClick={onPreview} disabled={!canRevealCode} title={canRevealCode ? undefined : 'فقط مدیر'}>
          پیش‌نمایش / چاپ PDF
        </button>
        <button className="btn" onClick={onPdf} disabled={printing || !canRevealCode} title={canRevealCode ? undefined : 'فقط مدیر'}>
          {printing ? 'در حال آماده‌سازی…' : 'ذخیره‌ی PDF'}
        </button>
        {/* جلسه ۳۴ — «چاپ بعدی نسخه‌ی مجدد است» تا دیروز یک مقایسه‌ی دستی با عددِ
            آستانه بود، درست همان چیزی که بخش ۹.۲ یکی‌اش کرده بود. حالا از
            `creditDetailPrintBadges` می‌آید و آستانه‌اش `isCreditReprint` است. */}
        {printBadges.map((b) => (
          <span key={b.key} className={`kbd ${b.tone === 'warn' ? 'bg-amber-100 border border-amber-300' : ''}`}>
            {b.text}
          </span>
        ))}
      </div>

      {/* ---- خلاصه‌ی مالی ---- */}
      <div className={`rounded border p-3 grid grid-cols-2 md:grid-cols-4 gap-2 ${TONE_CLASS[statusTone(c.status)] ?? 'bg-white'}`}>
        <b className="text-lg">{c.publicReference ?? `اعتبار #${faDigits(c.id)}`}</b>
        {canRevealCode && (
          <span className="flex items-center gap-1">
            <button className="btn py-1" onClick={onRevealCode}>
              {managerCode ? 'به‌روزرسانی کد مدیر' : 'نمایش کد (فقط مدیر)'}
            </button>
            {managerCode && <b dir="ltr" className="text-amber-900">{managerCode}</b>}
          </span>
        )}
        <span>وضعیت: {c.statusLabel}</span>
        <span>نوع: {c.sourceLabel}</span>
        <span>انقضا: {c.expiresAtJalali ? faDigits(c.expiresAtJalali) : 'بدون انقضا'}</span>
        <span>مبلغ اولیه: {money(c.amount)}</span>
        <span>مصرف‌شده: {money(c.usedAmount)}</span>
        <span>باقی‌مانده: {money(c.remaining)}</span>
        <span>
          دفعات: {faDigits(c.usedCount)} / {faDigits(c.maxUses)}
          {c.multiUse ? ' (چندباره)' : ''}
        </span>
        <span>صدور: {faDigits(c.issuedAtJalali)} {faDigits(c.issuedAtTime ?? '')}</span>
        {c.daysLeft != null && <span>روز باقی‌مانده: {faDigits(c.daysLeft)}</span>}
        {c.archived && <span className="font-bold">آرشیو‌شده (Soft Delete) — از مسیر مصرف بیرون است</span>}
        {c.note && <span>توضیح: {c.note}</span>}
      </div>

      {/* ---- بلوک‌های گیرنده / محدودیت / پیوندها (§۱۲ · §۱۸ · §۱۹) ---- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {blocks.map((b) => (
          <div key={b.key} className="bg-white rounded shadow p-3 space-y-1">
            <b>{b.title}</b>
            {b.facts.map((f) => (
              <div key={f.key} className="flex gap-2 justify-between border-b border-dashed last:border-0 py-0.5">
                <span className="kbd">{f.label}</span>
                <span className="text-left">{f.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ---- عملیات مدیریتی (§۱۰ · §۱۱ · §۲۰) ---- */}
      <div className="bg-white rounded shadow p-2 space-y-1">
        <b>عملیات مدیریتی</b>
        <div className="kbd">هر عملیات رمز مدیر و دلیل می‌خواهد و در Timeline همین صفحه ثبت می‌شود. «ابطال» و «حذف» گیت رمز جدا دارند.</div>
        <div className="flex gap-1 flex-wrap">
          {(Object.values(CreditOp) as CreditOp[]).map((op) => (
            <button
              key={op}
              className={`btn ${op === CreditOp.VOID || op === CreditOp.DELETE ? 'btn-danger' : ''}`}
              onClick={() => onOp(op)}
            >
              {CREDIT_OP_TITLES[op]}
            </button>
          ))}
        </div>
      </div>

      <Table
        title="دفتر مصرف (§۴ و §۱۶)"
        headers={CREDIT_REDEMPTION_HEADERS}
        rows={detail.redemptions.map(redemptionRow)}
        empty="این اعتبار هنوز هیچ مصرفی نداشته است."
        onExport={() => onExport('redemptions')}
      />
      <Table
        title="Timeline (از همان AuditLog · §۱۰)"
        headers={CREDIT_TIMELINE_HEADERS}
        rows={detail.timeline.map(timelineRow)}
        empty="رویدادی ثبت نشده است."
        onExport={() => onExport('timeline')}
        page={detail.timelinePage}
        warnings={detail.timelineWarnings}
        onPage={(skip) => onPage('timeline', skip)}
      />
      <Table
        title="لاگ یادآوری (§۱۴)"
        headers={CREDIT_REMINDER_LOG_HEADERS}
        rows={detail.reminders.map(reminderLogRow)}
        empty="برای این اعتبار هیچ یادآوری‌ای آماده نشده است."
        onExport={() => onExport('reminderLogs')}
        page={detail.remindersPage}
        warnings={detail.remindersWarnings}
        onPage={(skip) => onPage('reminders', skip)}
      />
    </div>
  )
}
