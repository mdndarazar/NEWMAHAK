/**
 * نشست ۳۱۷ · طرح کلاد (برنده)، فاز ۶ — کارت «چاپ سند اعتبار» در تب «تنظیمات
 * تکمیلی» مدیریت اعتبار (شبیه PrinterSettingsCard فاکتور و LabelPrintSettingsCard).
 *
 * فقط سه چیز: فونت، حاشیه (افقی/عمودی)، پیش‌نمایش + چاپ آزمایشی. کاغذ/ابعاد
 * سفارشی و متن قوانین همان‌جا در بخش «بارکد و سند چاپی» می‌مانند، و این کارت
 * چکیده‌ی آن‌ها را نشان می‌دهد تا کاربر بدون حدس ببیند خروجی چیست.
 *
 * قرارداد سخت (گارد ایستا در سوت s317):
 *   • هیچ DB-write / markPrinted / شمارنده‌ی چاپ این‌جا انجام نمی‌شود.
 *   • «پیش‌نمایش» پیش‌نویس فرم را می‌فرستد (چون هدفش تستِ قبل از ذخیره است)؛
 *     «چاپ آزمایشی» فقط تنظیمات ذخیره‌شده را می‌خواند (مثل testPage فاکتور).
 */
import { useMemo, useState } from 'react'
import { CreditPaper, creditPaperSize, type CreditSettings } from '../../../shared/credit'
import { CREDIT_FONT_SIZE_OPTIONS, creditPrintSummaryLabel, creditPrintWarnings } from '../../../shared/creditUi'
import { CH, call } from '../lib/api'

export default function CreditPrintCard({
  settings,
  set
}: {
  settings: CreditSettings
  set: (patch: Partial<CreditSettings>) => void
}) {
  const [previewHtml, setPreviewHtml] = useState('')
  const [busy, setBusy] = useState<'none' | 'preview' | 'print'>('none')
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const printWarnings = useMemo(() => creditPrintWarnings(settings), [settings])
  const printSummary = useMemo(() => creditPrintSummaryLabel(settings), [settings])
  const paperSpec = useMemo(
    () => creditPaperSize(settings.paper, settings.customWidthMm, settings.customHeightMm),
    [settings.paper, settings.customWidthMm, settings.customHeightMm]
  )
  const isCustom = settings.paper === CreditPaper.CUSTOM
  /** عرض واقعی کاغذ برای چسباندن `<iframe sandbox>` به همان ابعاد @page. */
  const previewWidthCss = `${Math.max(48, paperSpec.widthMm)}mm`

  async function onPreview() {
    setBusy('preview')
    setStatus(null)
    try {
      // پیش‌نمایش با پیش‌نویس فرم: کاربر سریع بفهمد تغییرش چه اثری دارد.
      const html = await call<string>(CH.creditSampleHtml, {
        draft: {
          paper: settings.paper,
          customWidthMm: settings.customWidthMm,
          customHeightMm: settings.customHeightMm,
          printFontPx: settings.printFontPx,
          printMarginXMm: settings.printMarginXMm,
          printMarginYMm: settings.printMarginYMm
        }
      })
      setPreviewHtml(String(html ?? ''))
    } catch (e: any) {
      setStatus({ kind: 'err', msg: String(e?.message ?? 'پیش‌نمایش ساخته نشد.') })
    } finally {
      setBusy('none')
    }
  }

  async function onTestPrint() {
    setBusy('print')
    setStatus(null)
    try {
      // چاپ آزمایشی با تنظیمات ذخیره‌شده (نه پیش‌نویس) — قابل پیش‌بینی چون مثل فاکتور رفتار می‌کند.
      const res = await call<{ ok: boolean; msg: string }>(CH.creditSamplePrint, {})
      setStatus(res?.ok ? { kind: 'ok', msg: res.msg } : { kind: 'err', msg: res?.msg ?? 'چاپ آزمایشی انجام نشد.' })
    } catch (e: any) {
      setStatus({ kind: 'err', msg: String(e?.message ?? 'چاپ آزمایشی انجام نشد.') })
    } finally {
      setBusy('none')
    }
  }

  return (
    <section className="s317-credit-print rounded border border-teal-200 bg-teal-50 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">چاپ سند اعتبار (کاغذ، فونت، حاشیه، پیش‌نمایش)</strong>
        <span className="kbd">{printSummary}</span>
      </div>
      <p className="text-xs text-slate-600 leading-5">
        کاغذ و متن قوانین را بالا در «بارکد و سند چاپی» تنظیم کنید؛ این کارت فقط ظاهر چاپ را حسّاب می‌کند.
        چاپ آزمایشی یک سند «نمونه» روی چاپگر پیش‌فرض می‌زند و هیچ اثری روی شمارنده یا اعتبار واقعی ندارد.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <label className="block text-xs">
          <span className="block mb-1">فونت چاپ (تک‌گانه: ۶ تا ۲۲)</span>
          <select
            className="inp"
            value={String(settings.printFontPx)}
            disabled={busy !== 'none'}
            onChange={(e) => set({ printFontPx: Number(e.target.value) || 11 })}
          >
            {CREDIT_FONT_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="block mb-1">حاشیه افقی (۰ تا ۲۰ میلی‌متر)</span>
          <input
            className="inp"
            type="number"
            min={0}
            max={20}
            value={settings.printMarginXMm}
            disabled={busy !== 'none'}
            onChange={(e) => set({ printMarginXMm: Number(e.target.value) })}
          />
        </label>
        <label className="block text-xs">
          <span className="block mb-1">حاشیه عمودی (۰ تا ۲۰ میلی‌متر)</span>
          <input
            className="inp"
            type="number"
            min={0}
            max={20}
            value={settings.printMarginYMm}
            disabled={busy !== 'none'}
            onChange={(e) => set({ printMarginYMm: Number(e.target.value) })}
          />
        </label>
      </div>

      {/* هشدارهای نمایشی کارت (غیر-مسدودکننده؛ clamp نهایی همیشه در main است) */}
      {printWarnings.length > 0 && (
        <ul className="list-disc pr-5 text-xs text-amber-800">
          {printWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}


      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className="btn" onClick={onPreview} disabled={busy !== 'none'}>
          {busy === 'preview' ? '…' : 'پیش‌نمایش'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onTestPrint} disabled={busy !== 'none'}>
          {busy === 'print' ? '…' : 'چاپ آزمایشی (چاپگر پیش‌فرض)'}
        </button>
        {status && (
          <span role="status" className={status.kind === 'ok' ? 'text-green-700 text-xs' : 'text-red-700 text-xs'}>
            {status.msg}
          </span>
        )}
        <span className="text-xs text-slate-500 mr-auto">{isCustom ? `ابعاد: ${settings.customWidthMm}×${settings.customHeightMm}mm` : `ابعاد: ${paperSpec.widthMm}×${paperSpec.heightMm ?? '∞'}mm`}</span>
      </div>

      {/* پیش‌نمایش واقعی تو در توی iframe (لاگ حذف آن از tests آمده: یکی از گارد ایستا). */}
      {previewHtml && (
        <div className="rounded bg-white border p-2 overflow-auto">
          <div className="text-xs text-slate-500 mb-1">پیش‌نمایش سند نمونه با همان کاغذ/فونت/حاشیه — سند واقعی نیست و هیچ ارزش خریدی ندارد:</div>
          <iframe
            title="credit-sample-preview"
            sandbox=""
            className="block mx-auto border rounded bg-white"
            style={{ width: previewWidthCss, minHeight: '70mm', maxWidth: '100%' }}
            srcDoc={previewHtml}
          />
          <button type="button" className="btn mt-2" onClick={() => setPreviewHtml('')} disabled={busy !== 'none'}>
            بستن پیش‌نمایش
          </button>
        </div>
      )}
    </section>
  )
}
