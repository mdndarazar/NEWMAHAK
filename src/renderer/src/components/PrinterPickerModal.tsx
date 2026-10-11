import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { setPrinterPickerOpener, type PrinterChoice, type PrintFlowKind, type PrinterPickerOpener } from '../lib/printFlow'

/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۳ طرح چاپ — پنجره‌ی «با کدام چاپگر چاپ شود؟» (بخش ۷.۲).
 *
 * چرا پنجره‌ی خودِ برنامه و نه دیالوگ ویندوز؟ چون درایور ویندوز اندازه‌ی کاغذ
 * ما را با پیش‌فرض خودش بازنویسی می‌کند (ریشه‌ی «نوار کوتاه/چاپ روی درز»).
 * پس انتخاب چاپگر داخل برنامه انجام می‌شود و اندازه‌ی دقیق به همان چاپگر
 * اعلام می‌گردد. تکنسین می‌تواند در تنظیمات `useSystemDialog` را روشن کند تا
 * دیالوگ خود ویندوز بیاید.
 *
 * قراردادها:
 *   • انصراف ⇒ `null`، یعنی لغو قطعی و بی‌صدا (هیچ خطا و هیچ شمارنده‌ای).
 *   • چاپگر ذخیره‌شده‌ی همان پروفایل از قبل انتخاب است.
 *   • چاپگرهای مجازی (PDF/XPS/Fax) با برچسب مشخص می‌شوند ولی از فهرست حذف
 *     نمی‌شوند (شاید کسی عمداً PDF بخواهد).
 *   • هیچ fallback خودکاری نیست؛ اگر فهرست خالی باشد پیام روشن می‌آید.
 * ===========================================================================
 */

type PrinterLite = {
  name: string
  displayName: string
  isDefault: boolean
  /** فاز ۴ این را با `guessPrinterKind` پر می‌کند؛ تا آن موقع `UNKNOWN` است. */
  kindGuess?: 'RECEIPT' | 'LABEL' | 'PAGE' | 'UNKNOWN'
}

const VIRTUAL = /pdf|onenote|xps|fax|print to|مایکروسافت/i

const kindLabel = (k?: string): string =>
  k === 'RECEIPT' ? 'رسید' : k === 'LABEL' ? 'لیبل' : k === 'PAGE' ? 'A4' : 'نامعلوم'

export default function PrinterPickerHost() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('با کدام چاپگر چاپ شود؟')
  const [kind, setKind] = useState<PrintFlowKind>('INVOICE')
  const [savedName, setSavedName] = useState('')
  const [printers, setPrinters] = useState<PrinterLite[]>([])
  const [chosen, setChosen] = useState('')
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** resolve پنجره؛ در بسته‌شدن با انصراف `null` می‌شود. */
  const settleRef = useRef<((v: PrinterChoice | null) => void) | null>(null)

  const refresh = async () => {
    const list = await call<PrinterLite[]>(CH.printersDetailed)
    setPrinters(list)
    return list
  }

  useEffect(() => {
    const opener: PrinterPickerOpener = async (input) => {
      /**
       * محافظت در برابر فراخوانی هم‌زمان: تا وقتی پنجره‌ی قبلی جواب نگرفته،
       * درخواست تازه را مثل «انصراف» برمی‌گردانیم تا Promise قبلی هرگز overwrite
       * نشود و جریان چاپ/ثبت معلق نماند.
       */
      if (settleRef.current) return null

      const saved = String(input.savedName ?? '').trim()
      const promise = new Promise<PrinterChoice | null>((resolve) => {
        settleRef.current = resolve
      })

      setTitle(input.title)
      setKind(input.kind)
      setSavedName(saved)
      setChosen(saved)
      setSaveAsDefault(false)
      setErr(null)
      setOpen(true)
      setBusy(true)
      try {
        const list = await refresh()
        const savedHit = saved ? list.find((p) => p.name === saved) : undefined
        if (saved && !savedHit) {
          setChosen('')
          setErr(`چاپگر ذخیره‌شده «${saved}» روی این سیستم پیدا نشد؛ یک چاپگر را از فهرست انتخاب کنید.`)
        } else {
          // فقط وقتی چاپگر ذخیره‌شده نداریم، پیش‌فرض ویندوز را برای راحتی از قبل انتخاب می‌کنیم.
          const pre = savedHit ?? list.find((p) => p.isDefault) ?? undefined
          setChosen(pre?.name ?? '')
        }
      } catch (e: any) {
        setErr(e.message)
      } finally {
        setBusy(false)
      }
      return await promise
    }
    setPrinterPickerOpener(opener)
    return () => {
      const settle = settleRef.current
      settleRef.current = null
      settle?.(null)
      setPrinterPickerOpener(null)
    }
  }, [])

  const close = (value: PrinterChoice | null) => {
    setOpen(false)
    const settle = settleRef.current
    settleRef.current = null
    settle?.(value)
  }

  const modal = (
    <Modal
      open={open}
      title={title}
      /**
       * Esc / کلیک روی پس‌زمینه / ضربدر = همان «انصراف»: لغو قطعی و بی‌صدا.
       * اگر اینجا مقداری غیر از `null` برگردد، `printWith` آن را انتخاب کاربر
       * می‌پندارد و بی‌صدا روی چاپگر ذخیره‌شده چاپ می‌کند.
       */
      onClose={() => close(null)}
      width="max-w-2xl"
      zIndexClass="z-[60]"
      footer={
        <>
          <div className="me-auto kbd">
            {kind === 'LABEL' ? 'چاپگر لیبل' : kind === 'WHOLESALE' ? 'فاکتور عمده' : 'فاکتور فروش'}
            {savedName ? ` · پیش‌فرض فعلی: ${savedName}` : ' · بدون چاپگر ذخیره‌شده'}
          </div>
          <button className="btn" onClick={() => close(null)} disabled={busy}>
            انصراف <span className="keycap">Esc</span>
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !chosen || !printers.length}
            onClick={() => close({ deviceName: chosen, saveAsDefault })}
          >
            چاپ روی همین چاپگر
          </button>
        </>
      }
    >
      {busy ? (
        <div className="kbd">در حال خواندن فهرست چاپگرها…</div>
      ) : (
        <>
          {!printers.length && (
            <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">
              هیچ چاپگری روی این سیستم نصب نیست؛ فاکتور ثبت می‌شود ولی چاپی انجام نمی‌شود.
            </div>
          )}
          <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[45vh] overflow-auto">
            {printers.map((p) => (
              <label key={p.name} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  className="w-4 h-4"
                  name="printer-pick"
                  checked={chosen === p.name}
                  onChange={() => setChosen(p.name)}
                />
                <span className="font-bold">{p.displayName || p.name}</span>
                {p.isDefault && <span className="kbd">پیش‌فرض ویندوز</span>}
                {p.name === savedName && <span className="kbd">ذخیره‌شده‌ی این بخش</span>}
                {VIRTUAL.test(p.name) && <span className="kbd">چاپگر مجازی</span>}
                <span className="kbd me-auto">{kindLabel(p.kindGuess)}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
            />
            این چاپگر به‌عنوان پیش‌فرض همین بخش ذخیره شود
          </label>
          <div className="kbd">
            انصراف یعنی هیچ چاپی انجام نمی‌شود؛ هیچ شمارنده‌ای هم تغییر نمی‌کند.
          </div>
          {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
        </>
      )}
    </Modal>
  )

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
