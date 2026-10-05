import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { call, CH } from '../lib/api'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { useSettings } from '../hooks/useSettings'
import { faDigits, money } from '@shared/jalali'
import { labelPresetOf, resolveLabelBrand } from '@shared/receipt'
// نشست ۲۲۲ · فاز ۲ — چیدمان ردیفی لیبل روی رول (همان تابع خالصِ main)
import { labelRows } from '@shared/printSpec'
import type { LabelMode, PrintLabel } from '@shared/types'

/**
 * ================= پیش‌نمایش و چاپ لیبل / بارکد =================
 * قبلاً printLabels در Products.tsx برای هر ردیف انتخاب‌شده یک لیبل می‌ساخت و
 * بلافاصله print می‌زد: نه پیش‌نمایشی بود، نه تعداد نسخه‌ای، نه انتخاب متن.
 *
 * الان این مودال:
 *   ۱) برای هر کالای انتخاب‌شده یک فیلد «تعداد لیبل» می‌دهد (پیش‌فرض ۱).
 *   ۲) خودِ لیبل‌ها را همان‌طور که چاپ می‌شوند نشان می‌دهد.
 *   ۳) دو حالت متن دارد (مورد ۷):
 *        • «فقط اسم»    → فقط نام کالا. مثال: «شلوار نیم‌بگ»   ← پیش‌فرض
 *        • «اسم و رنگ» → نام + سایز + رنگ. مثال: «شلوار نیم‌بگ سایز ۳۶ - ذغالی»
 *   ۴) چاپ واقعی فقط بعد از تایید کاربر انجام می‌شود، از طریق main
 *      (کانال print:labels) و نه window.open — آن مسیر با setWindowOpenHandler
 *      برنامه بلاک می‌شد و لیبل هیچ‌وقت چاپ نمی‌شد.
 * ==============================================================
 */

const MAX_COPIES = 200
const PREVIEW_LIMIT = 60

/** متن روی لیبل بر اساس حالت انتخابی. */
export function labelTitle(v: any, mode: LabelMode): string {
  const name = v?.product?.name ?? ''
  // مورد ۵: لیبل بدون اسم (فقط قیمت و بارکد)
  if (mode === 'NONE') return ''
  if (mode === 'NAME') return name
  const size = v?.size ? ` سایز ${v.size}` : ''
  const color = v?.color ? ` - ${v.color}` : ''
  return `${name}${size}${color}`
}

export default function LabelPrintModal({
  open,
  rows,
  onClose,
  onPrinted
}: {
  open: boolean
  rows: any[]
  onClose: () => void
  onPrinted: (msg: string) => void
}) {
  const nav = useNavigate()
  /**
   * تنظیمات *مستقل* چاپ لیبل (مورد ۵ و ۸): ابعاد لیبل، اجزای روی لیبل و چاپگر
   * لیبل‌زن. هیچ ربطی به تنظیمات چاپ فاکتور ندارد و در «تنظیمات → چاپ و چاپگر
   * → چاپ لیبل» تعیین می‌شود. پیش‌نمایش همین پایین با همان ابعاد ساخته می‌شود.
   */
  const { settings } = useSettings()
  const label = settings.label
  /** نام برندی که واقعاً روی لیبل چاپ می‌شود (خالی = نام فروشگاه قالب رسید) */
  const brand = resolveLabelBrand(label, settings.receipt.shopName)
  const [mode, setMode] = useState<LabelMode>('NAME') // پیش‌فرض: فقط اسم
  const [copies, setCopies] = useState<Record<number, number>>({})
  /**
   * نشست ۲۲۲ · فاز ۲ — «شروع از ستون» (فقط همین کار چاپ؛ ذخیره نمی‌شود).
   * روی رول نیمه‌مصرف، کاربر می‌گوید چاپ از کدام خانه شروع شود تا لیبل‌ها
   * دقیقاً روی برچسب‌های خالی بعدی بیفتند.
   */
  const [startColumn, setStartColumn] = useState(1)
  const [pngs, setPngs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // با هر بار باز شدن: تعداد نسخه‌ها ۱ و تصاویر بارکد از main گرفته می‌شوند
  useEffect(() => {
    if (!open) return
    // اگر در تنظیمات «چاپ اسم کالا روی لیبل» خاموش باشد، پیش‌فرض = بدون اسم
    setMode(label.showName ? 'NAME' : 'NONE')
    setCopies(Object.fromEntries(rows.map((r) => [r.id, 1])))
    setStartColumn(1)
    setErr(null)
    setBusy(false)
    if (!rows.length) return

    let alive = true
    setLoading(true)
    Promise.all(
      rows.map(async (r) => {
        const dataUrl = await call<string>(CH.barcodePng, {
          text: r.barcode,
          opts: { includetext: label.showBarcodeText }
        })
        return [r.barcode as string, dataUrl] as const
      })
    )
      .then((pairs) => alive && setPngs(Object.fromEntries(pairs)))
      .catch((e: any) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, label.showName, label.showBarcodeText])

  const setCopy = (id: number, n: number) =>
    setCopies((c) => ({ ...c, [id]: Math.min(MAX_COPIES, Math.max(0, Math.round(n || 0))) }))

  /** لیست «باز شده»: هر کالا به تعداد نسخه‌اش تکرار می‌شود — همان چیزی که چاپ می‌شود. */
  const expanded = useMemo<PrintLabel[]>(() => {
    const out: PrintLabel[] = []
    for (const r of rows) {
      const n = copies[r.id] ?? 1
      for (let i = 0; i < n; i++) {
        out.push({
          name: labelTitle(r, mode),
          code: String(r.code ?? ''),
          price: r.salePrice ?? 0,
          barcodeDataUrl: pngs[r.barcode] ?? ''
        })
      }
    }
    return out
  }, [rows, copies, mode, pngs])

  const total = expanded.length
  const ready = !loading && rows.every((r) => pngs[r.barcode])

  const doPrint = async () => {
    if (!total) return setErr('تعداد لیبل همه‌ی ردیف‌ها صفر است؛ حداقل یک نسخه لازم است')
    if (!ready) return setErr('تصویر بارکد هنوز آماده نشده است؛ یک لحظه صبر کنید')
    setBusy(true)
    setErr(null)
    try {
      /**
       * `template` فقط همین یک چاپ را عوض می‌کند: «اسم چاپ شود یا نه» را از
       * انتخاب همین مودال می‌گیریم و بقیه‌ی تنظیمات (ابعاد، چاپگر لیبل) از
       * تنظیمات مستقل چاپ لیبل خوانده می‌شود.
       */
      /**
       * فاز ۳ — چاپ لیبل هم از همان نقطه‌ی مشترک می‌گذرد تا سیاست «هر بار بپرس»
       * و انتخاب چاپگر یک‌جا و یک‌شکل باشد. انصراف ⇒ هیچ پیامی، هیچ چاپی.
       */
      const res = await printWith('LABEL', (deviceName, opts) =>
        call<number>(CH.printLabels, {
          labels: expanded,
          template: { showName: mode !== 'NONE' },
          startColumn,
          deviceName,
          silent: opts?.silent
        })
      )
      if (res === 'CANCELLED') return
      onPrinted(`${faDigits(total)} لیبل به چاپگر فرستاده شد`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="پیش‌نمایش و چاپ لیبل / بارکد"
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <div className="me-auto kbd">
            {faDigits(rows.length)} کالا · {faDigits(total)} لیبل برای چاپ
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>
            انصراف <span className="keycap">Esc</span>
          </button>
          <button className="btn btn-primary" onClick={() => void doPrint()} disabled={busy || !total}>
            {busy ? 'در حال ارسال به چاپگر…' : 'چاپ'}
          </button>
        </>
      }
    >
      {/* ---------- متن روی لیبل (مورد ۷ و مورد ۵) ---------- */}
      <div className="bg-slate-50 border border-slate-200 rounded p-2 flex flex-wrap items-center gap-4">
        <div className="font-bold">متن روی لیبل:</div>
        {(
          [
            ['NAME', 'فقط اسم'],
            ['NAME_COLOR', 'اسم و رنگ'],
            ['NONE', 'بدون اسم (فقط قیمت و بارکد)']
          ] as [LabelMode, string][]
        ).map(([m, text]) => (
          <label key={m} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={mode === m} onChange={() => setMode(m)} />
            {text}
            {m === (label.showName ? 'NAME' : 'NONE') ? <span className="kbd">پیش‌فرض</span> : null}
          </label>
        ))}
        <span className="kbd">
          {mode === 'NAME'
            ? 'فقط نام کالا چاپ می‌شود (مثلاً «شلوار نیم‌بگ»)'
            : mode === 'NAME_COLOR'
              ? 'نام کالا همراه سایز و رنگ چاپ می‌شود (مثلاً «شلوار نیم‌بگ سایز ۳۶ - ذغالی»)'
              : 'لیبل بدون اسم چاپ می‌شود؛ فقط بارکد و قیمت.'}
        </span>
      </div>

      {/* ---------- تنظیمات مستقل چاپ لیبل (مورد ۵ و ۸) ---------- */}
      <div className="bg-white border border-slate-200 rounded p-2 flex flex-wrap items-center gap-3 kbd leading-6">
        <b>لیبل:</b>
        <span>
          طول {faDigits(label.widthMm)} × عرض {faDigits(label.heightMm)} میلی‌متر
        </span>
        <span>چاپگر لیبل: {label.printerName || '(چاپگر پیش‌فرض ویندوز)'}</span>
        <span>{label.showPrice ? 'با قیمت' : 'بدون قیمت'}</span>
        <span>قالب: {labelPresetOf(label.activeTemplate).title}</span>
        {label.showBrand && !!brand && <span>برند: {brand}</span>}
        {label.showLogo && !!label.logoDataUrl && <span>با لوگو</span>}
        <span>{label.autoPrint ? 'چاپ بی‌درنگ' : 'با پنجره‌ی چاپ ویندوز'}</span>
        <span>
          {label.columns > 1 ? `رول ${faDigits(label.columns)} ستونه` : 'رول تک‌ستونه'}
        </span>
        <button className="text-brand font-bold" onClick={() => nav('/settings')}>
          تنظیمات چاپ لیبل
        </button>
      </div>

      {/**
       * نشست ۲۲۲ · فاز ۲ — روی رول چندستونه، چاپ از کدام خانه شروع شود؟
       * (رول نیمه‌مصرف) — این انتخاب فقط برای همین کار چاپ است و ذخیره نمی‌شود.
       */}
      {label.columns > 1 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 flex flex-wrap items-center gap-3">
          <b>شروع از ستون:</b>
          {Array.from({ length: label.columns }, (_v, i) => i + 1).map((c) => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                className="w-4 h-4"
                checked={startColumn === c}
                onChange={() => setStartColumn(c)}
              />
              {faDigits(c)}
              {c === 1 ? <span className="kbd">عادی</span> : <span className="kbd">رول نیمه‌مصرف</span>}
            </label>
          ))}
          <span className="kbd">
            لیبل‌های سمت چپِ ستون شروع خالی می‌مانند و مصرف نمی‌شوند.
          </span>
        </div>
      )}

      {/* ---------- مورد ۶: تعداد لیبل هر کالا ---------- */}
      <div className="overflow-auto max-h-[28vh] border border-slate-200 rounded">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>کد</th>
              <th>بارکد</th>
              <th>متن لیبل</th>
              <th>قیمت فروش</th>
              <th className="w-32">تعداد لیبل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{faDigits(i + 1)}</td>
                <td>{faDigits(r.code)}</td>
                <td>{faDigits(r.barcode)}</td>
                <td>{labelTitle(r, mode)}</td>
                <td>{money(r.salePrice ?? 0)}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={MAX_COPIES}
                    className="inp py-0.5 text-center"
                    value={copies[r.id] ?? 1}
                    onChange={(e) => setCopy(r.id, +e.target.value)}
                  />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-400">
                  کالایی انتخاب نشده است
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- پیش‌نمایش خود لیبل‌ها ---------- */}
      <div>
        <div className="font-bold mb-1">پیش‌نمایش چاپ</div>
        {loading ? (
          <div className="kbd">در حال ساخت تصویر بارکد…</div>
        ) : (
          <div className="border border-slate-200 rounded bg-white p-2 max-h-[32vh] overflow-auto flex flex-wrap gap-2">
            {expanded.slice(0, PREVIEW_LIMIT).map((l, i) => (
              <div
                key={i}
                className="border border-dashed border-slate-300 flex flex-col items-center justify-between p-1 overflow-hidden"
                style={{
                  width: `${label.widthMm}mm`,
                  height: `${label.heightMm}mm`,
                  textAlign: label.align === 'RIGHT' ? 'right' : 'center'
                }}
              >
                {label.showLogo && !!label.logoDataUrl && label.brandPosition !== 'BOTTOM' && (
                  <img src={label.logoDataUrl} alt="" style={{ height: `${label.logoHeightMm}mm`, objectFit: 'contain' }} />
                )}
                {label.showBrand && !!brand && label.brandPosition !== 'BOTTOM' && (
                  <div className="font-bold w-full" style={{ fontSize: `${label.brandFontPx}px` }}>
                    {brand}
                  </div>
                )}
                {mode !== 'NONE' && (
                  <div
                    className="leading-tight text-center overflow-hidden w-full"
                    style={{ fontSize: `${label.nameFontPx}px` }}
                  >
                    {l.name}
                  </div>
                )}
                {label.showCode && <div className="kbd" dir="ltr">{faDigits(l.code)}</div>}
                {l.barcodeDataUrl ? (
                  <img
                    src={l.barcodeDataUrl}
                    alt=""
                    style={{ maxWidth: `${Math.max(10, label.widthMm - 4)}mm`, height: `${label.barcodeHeightMm}mm` }}
                  />
                ) : (
                  <div className="kbd">بارکد آماده نشد</div>
                )}
                {label.showPrice && (
                  <div className="font-bold" style={{ fontSize: `${label.priceFontPx}px` }}>
                    {money(l.price)} ریال
                  </div>
                )}
                {label.showBrand && !!brand && label.brandPosition === 'BOTTOM' && (
                  <div className="font-bold w-full" style={{ fontSize: `${label.brandFontPx}px` }}>
                    {brand}
                  </div>
                )}
              </div>
            ))}
            {!expanded.length && <div className="kbd py-6">تعداد لیبل‌ها صفر است</div>}
          </div>
        )}
        {total > PREVIEW_LIMIT && (
          <div className="kbd mt-1">
            برای سبک ماندن صفحه، فقط {faDigits(PREVIEW_LIMIT)} لیبل اول نمایش داده شده؛ در چاپ، همه‌ی{' '}
            {faDigits(total)} لیبل می‌آید.
          </div>
        )}
        {/**
         * چیدمان واقعی روی رول — از **همان** تابع خالصی که main استفاده می‌کند،
         * پس پیش‌نمایش و چاپ هرگز از هم جدا نمی‌شوند.
         */}
        {total > 0 && (
          <div className="kbd mt-1">
            چیدمان رول: {faDigits(labelRows(expanded, label.columns, startColumn).length)} ردیف
            {label.columns > 1
              ? ` · ${faDigits(label.columns)} لیبل در هر ردیف${
                  startColumn > 1 ? ` · شروع از ستون ${faDigits(startColumn)}` : ''
                }`
              : ''}
          </div>
        )}
      </div>

      {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 whitespace-pre-line">{err}</div>}
    </Modal>
  )
}
