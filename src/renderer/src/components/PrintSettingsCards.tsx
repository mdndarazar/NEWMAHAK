import { useEffect, useRef, useState } from 'react'
import type { LabelTemplate, ReceiptTemplate } from '@shared/receipt'
import { faDigits } from '@shared/jalali'
import {
  guessPrinterKind,
  labelRowDims,
  presetToSpec,
  printerKindSuggestion,
  receiptPageSpec,
  type PrinterKindGuess,
  type ReceiptPaperPreset
} from '@shared/printSpec'
import Modal from './Modal'
import { call, CH } from '../lib/api'

/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۳ طرح چاپ — کارت‌های «چاپگر» و بخش «پیشرفته» تب چاپ.
 *
 * چرا جدا از `Settings.tsx`؟ چون تب چاپ همین حالا هم شلوغ است و «حالت ساده»
 * (سه کارت چهارموردی) باید مستقل از «حالت پیشرفته» بماند تا مدیر فروشگاه فقط
 * همان چهار مورد را ببیند و تکنسین بتواند به بقیه دست بزند (بخش ۷.۱ طرح).
 *
 * ⚠️ قراردادها:
 *   • «بدون پرسش» فقط فیلد `askEachTime` را عوض می‌کند و **با `autoPrint` قاطی
 *     نمی‌شود** (آن یکی در رسید یعنی «چاپ خودکار بعد از فروش»).
 *   • تغییر چاپگر پیش‌فرض رمز نمی‌خواهد (تصمیم مالک برای فاز ۳) و فقط از کانال
 *     `printSetDefault` رد می‌شود؛ نام چاپگر فقط در main اعتبارسنجی می‌شود.
 * ===========================================================================
 */

export interface PrinterLiteView {
  name: string
  displayName: string
  isDefault: boolean
  kindGuess?: 'RECEIPT' | 'LABEL' | 'PAGE' | 'UNKNOWN'
}

const kindText = (k?: string): string =>
  k === 'RECEIPT' ? 'رسید' : k === 'LABEL' ? 'لیبل' : k === 'PAGE' ? 'A4' : 'نامعلوم'

/** فهرست چاپگرها برای `select` — با برچسب «پیش‌فرض ویندوز» و نوع حدسی (فاز ۴ پرش می‌کند). */
function PrinterSelect({
  value,
  onChange,
  printers
}: {
  value: string
  onChange: (name: string) => void
  printers: PrinterLiteView[]
}) {
  return (
    <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(چاپگر پیش‌فرض ویندوز)</option>
      {printers.map((p) => (
        <option key={p.name} value={p.name}>
          {p.displayName || p.name}
          {p.isDefault ? ' — پیش‌فرض ویندوز' : ''}
          {p.kindGuess ? ` — ${kindText(p.kindGuess)}` : ''}
        </option>
      ))}
    </select>
  )
}

/** یک کارت ساده: چاپگر + «بدون پرسش» + ذخیره‌ی فوری پیش‌فرض. */
function PrinterCard({
  title,
  hint,
  profile,
  value,
  printers,
  askEachTime,
  onPick,
  onAskChange,
  onSave,
  busy,
  savedMsg,
  onTest,
  onPreview,
  testBusy,
  testMsg,
  suggestion,
  savedMethod,
  testMethod,
  onTestMethodChange,
  onSample,
  sampleLabel,
  extra
}: {
  title: string
  hint: string
  profile: 'INVOICE' | 'WHOLESALE' | 'LABEL'
  value: string
  printers: PrinterLiteView[]
  askEachTime: boolean
  onPick: (name: string) => void
  onAskChange: (ask: boolean) => void
  onSave: (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', name: string) => void
  busy?: boolean
  savedMsg?: string | null
  /** فاز ۴ — چاپ آزمایشی همین پروفایل. */
  onTest: (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', name: string, method?: 'CHROMIUM' | 'RAW') => void
  /** فاز ۴ — پیش‌نمایش نسبی همین پروفایل. */
  onPreview: (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL') => void
  testBusy?: boolean
  testMsg?: { text: string; ok: boolean } | null
  /** نوار پیشنهاد بر اساس نوع حدسی چاپگر (فقط پیشنهاد، بخش ۷.۱/۷.۳ طرح). */
  suggestion?: { text: string; apply?: () => void } | null
  /** فاز ۵ — روش چاپ ذخیره‌شده‌ی همین پروفایل و روشی که «چاپ آزمایشی» با آن انجام شود. */
  savedMethod?: 'CHROMIUM' | 'RAW'
  testMethod?: 'CHROMIUM' | 'RAW'
  onTestMethodChange?: (m: 'CHROMIUM' | 'RAW') => void
  /**
   * فقط کارت‌های تکی/عمده: «چاپ فاکتور نمونه» (فاکتور واقعی با داده‌ی نمونه).
   * وقتی هست، دکمه‌ی `onTest` همان برگه‌ی کالیبراسیون است با نام «فنی»؛ کارت
   * لیبل این را نمی‌گیرد و دقیقاً مثل قبل می‌ماند.
   */
  onSample?: (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', name: string) => void
  sampleLabel?: string
  extra?: React.ReactNode
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-2 space-y-2">
      <div className="font-bold">{title}</div>
      <div className="kbd leading-6">{hint}</div>
      <PrinterSelect value={value} onChange={onPick} printers={printers} />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={!askEachTime}
          onChange={(e) => onAskChange(!e.target.checked)}
        />
        همیشه روی همین چاپگر چاپ کن (بدون پرسش)
      </label>
      <div className="kbd">
        با تیک‌نداشتن، هر چاپ (حتی چاپ خودکار بعد از فروش) پنجره‌ی «با کدام چاپگر؟» را نشان می‌دهد.
      </div>
      <div className="flex items-center gap-2">
        <button className="btn" disabled={busy || !value || !printers.length} onClick={() => onSave(profile, value)}>
          ذخیره‌ی همین چاپگر به‌عنوان پیش‌فرض
        </button>
        <span className="kbd">
          {printers.length ? `${faDigits(printers.length)} چاپگر نصب است` : 'چاپگری نصب نیست'}
        </span>
      </div>
      {suggestion && (
        <div className="bg-amber-100 border border-amber-300 rounded px-2 py-1 flex items-center gap-2">
          <span className="kbd leading-6">{suggestion.text}</span>
          {suggestion.apply && (
            <button className="btn" disabled={busy} onClick={suggestion.apply}>
              اعمال
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {onSample && (
          <button className="btn btn-primary" disabled={busy || testBusy} onClick={() => onSample(profile, value)}>
            {sampleLabel ?? 'چاپ فاکتور نمونه'}
          </button>
        )}
        {onSample && (
          <button className="btn" disabled={busy || testBusy} onClick={() => onPreview(profile)}>
            پیش‌نمایش
          </button>
        )}
        <select
          className="inp"
          style={{ width: '11rem' }}
          value={testMethod ?? savedMethod ?? 'CHROMIUM'}
          onChange={(e) => onTestMethodChange?.(e.target.value === 'RAW' ? 'RAW' : 'CHROMIUM')}
        >
          <option value="CHROMIUM">آزمایش با Chromium</option>
          <option value="RAW">آزمایش با «دقیق (RAW)»</option>
        </select>
        <button
          className={onSample ? 'btn' : 'btn btn-primary'}
          disabled={busy || testBusy}
          onClick={() => onTest(profile, value, testMethod ?? savedMethod ?? 'CHROMIUM')}
        >
          {onSample ? 'برگه‌ی کالیبراسیون (فنی)' : 'چاپ آزمایشی'}
        </button>
        {!onSample && (
          <button className="btn" disabled={busy || testBusy} onClick={() => onPreview(profile)}>
            پیش‌نمایش
          </button>
        )}
        <span className="kbd leading-6">
          برگه‌ی آزمایشی با تنظیمات <b>ذخیره‌شده</b> چاپ می‌شود؛ اگر تغییری داده‌اید اول «ذخیره» را بزنید.
        </span>
        {onSample && (
          <span className="kbd leading-6">
            «{sampleLabel ?? 'چاپ فاکتور نمونه'}» همان فاکتور واقعی را با داده‌ی نمونه و روش ذخیره‌شده (
            {savedMethod === 'RAW' ? 'دقیق (RAW)' : 'Chromium'}) چاپ می‌کند؛ انتخابگر روش کنار «برگه‌ی کالیبراسیون
            (فنی)» فقط روی همان برگه‌ی اندازه‌گیری اثر دارد.
          </span>
        )}
        {testMethod === 'RAW' && (
          <span className="kbd leading-6">
            آزمایش «دقیق (RAW)» با همان اندازه و همان دستور دستگاه انجام می‌شود؛ اگر برگه درست آمد،
            روش RAW برای همین اجرا باز می‌شود و می‌توانید ذخیره کنید.
          </span>
        )}
      </div>
      {testMsg && (
        <div className={testMsg.ok ? 'text-emerald-700 text-xs leading-6' : 'text-rose-700 text-xs leading-6'}>
          {testMsg.text}
        </div>
      )}
      {savedMsg && <div className="text-emerald-700 text-xs">{savedMsg}</div>}
      {extra}
    </div>
  )
}

export function PrinterCards({
  receipt,
  label,
  setR,
  setL,
  printers,
  onRefresh,
  onSavePrinter,
  busy,
  savedMsg
}: {
  receipt: ReceiptTemplate
  label: LabelTemplate
  setR: (patch: Partial<ReceiptTemplate>) => void
  setL: (patch: Partial<LabelTemplate>) => void
  printers: PrinterLiteView[]
  onRefresh: () => void
  onSavePrinter: (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', name: string) => void
  busy?: boolean
  savedMsg?: string | null
}) {
  /** فاز ۴: کدام پروفایل مشغول چاپ آزمایشی است، پیام هر کارت، و پیش‌نمایش باز. */
  const [testBusy, setTestBusy] = useState<string | null>(null)
  const [testMsgs, setTestMsgs] = useState<Record<string, { text: string; ok: boolean } | undefined>>({})
  /**
   * فاز ۵ — روش هر «چاپ آزمایشی». پیش‌فرض: روش ذخیره‌شده‌ی همان پروفایل؛ ولی
   * کاربر می‌تواند آزمایش RAW بگیرد **پیش از** ذخیره‌کردن، چون دروازه‌ی روشن‌کردن
   * RAW به یک آزمایش موفق نیاز دارد (بخش ۷.۱ طرح).
   */
  const [testMethods, setTestMethods] = useState<Record<string, 'CHROMIUM' | 'RAW' | undefined>>({})
  const [preview, setPreview] = useState<
    { title: string; html: string; widthMm: number; heightMm: number | 'AUTO' } | null
  >(null)

  const runTest = async (
    profile: 'INVOICE' | 'WHOLESALE' | 'LABEL',
    name: string,
    method?: 'CHROMIUM' | 'RAW'
  ) => {
    setTestBusy(profile)
    setTestMsgs((m) => ({ ...m, [profile]: undefined }))
    try {
      const r = await call<{ deviceName: string; pageSizeLabel: string; rawTrialOpened?: boolean }>(
        CH.printTestPage,
        {
          profile,
          // نام انتخاب‌شده‌ی همین لحظه‌ی فرم؛ main آن را با فهرست زنده اعتبارسنجی می‌کند.
          // خالی یعنی «همان چاپگر ذخیره‌شده/پیش‌فرض» و هیچ fallback خودکاری نیست.
          deviceName: name || undefined,
          method
        }
      )
      setTestMsgs((m) => ({
        ...m,
        [profile]: {
          ok: true,
          text:
            `برگه‌ی آزمایشی روی «${r.deviceName}» با اندازه‌ی ${r.pageSizeLabel} چاپ شد. ` +
            'مستطیل مرجع را با خط‌کش اندازه بگیرید (خطای مجاز ۱ میلی‌متر) و کامل‌بودن کادر لبه را ببینید.' +
            (r.rawTrialOpened
              ? ' روش «دقیق (RAW)» برای همین اجرای برنامه فعال شد؛ حالا می‌توانید آن را ذخیره کنید.'
              : '')
        }
      }))
    } catch (e: any) {
      setTestMsgs((m) => ({ ...m, [profile]: { ok: false, text: e?.message ?? 'چاپ آزمایشی انجام نشد.' } }))
    } finally {
      setTestBusy(null)
    }
  }

  /**
   * «چاپ فاکتور نمونه» (فقط تکی/عمده): فاکتور واقعی با داده‌ی نمونه‌ی همان
   * پیش‌نمایش، از کانال جدا — نه `printTestPage` (برگه‌ی کالیبراسیون).
   */
  const runSample = async (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL', name: string) => {
    if (profile === 'LABEL') return
    setTestBusy(profile)
    setTestMsgs((m) => ({ ...m, [profile]: undefined }))
    try {
      const r = await call<{ deviceName: string; pageSizeLabel: string; engine: 'CHROMIUM' | 'RAW' }>(
        CH.printSampleInvoice,
        { profile, deviceName: name || undefined }
      )
      setTestMsgs((m) => ({
        ...m,
        [profile]: {
          ok: true,
          text:
            `فاکتور ${profile === 'WHOLESALE' ? 'عمده‌ی' : 'تکیِ'} نمونه روی «${r.deviceName}» با اندازه‌ی ${r.pageSizeLabel} ` +
            `و روش ${r.engine === 'RAW' ? 'دقیق (RAW)' : 'Chromium'} چاپ شد (همان مسیر فاکتور واقعی).`
        }
      }))
    } catch (e: any) {
      setTestMsgs((m) => ({ ...m, [profile]: { ok: false, text: e?.message ?? 'چاپ فاکتور نمونه انجام نشد.' } }))
    } finally {
      setTestBusy(null)
    }
  }

  const openPreview = async (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL') => {
    try {
      if (profile === 'LABEL') {
        const html = await call<string>(CH.printLabelPreviewHtml, { template: label })
        const d = labelRowDims(label)
        setPreview({ title: 'پیش‌نمایش لیبل (نسبی)', html, widthMm: d.rowWidthMm, heightMm: d.rowHeightMm })
        return
      }
      const wholesale = profile === 'WHOLESALE'
      const html = await call<string>(
        CH.printPreviewHtml,
        wholesale ? { template: receipt, profile: 'WHOLESALE' } : { template: receipt }
      )
      const sp = receiptPageSpec(receipt, wholesale ? 'WHOLESALE' : 'RETAIL')
      setPreview({
        title: wholesale ? 'پیش‌نمایش فاکتور عمده (نسبی)' : 'پیش‌نمایش فاکتور (نسبی)',
        html,
        widthMm: sp.widthMm,
        heightMm: sp.heightMm
      })
    } catch (e: any) {
      setTestMsgs((m) => ({ ...m, [profile]: { ok: false, text: e?.message ?? 'ساخت پیش‌نمایش انجام نشد.' } }))
    }
  }

  /** «اعمال» پیشنهاد کاغذ: خود preset و ابعادش با هم ست می‌شوند (مثل presetToSpec). */
  const applyReceiptPreset = (key: ReceiptPaperPreset) => {
    const sp = presetToSpec(key)
    if (!sp) {
      setR({ paperPreset: key })
      return
    }
    setR({
      paperPreset: key,
      sheetWidthMm: sp.sheetWidthMm,
      sheetHeightMm: sp.sheetHeightMm,
      paperWidthMm: sp.paperWidthMm
    })
  }

  /** روش چاپ ذخیره‌شده‌ی هر پروفایل (فقط برای پیش‌فرضِ انتخابگر آزمایش). */
  const savedMethodOf = (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL'): 'CHROMIUM' | 'RAW' =>
    profile === 'LABEL' ? label.printMethod : receipt.printMethod

  const kindOf = (name: string): PrinterKindGuess | undefined => {
    const hit = printers.find((p) => p.name === name)
    return hit ? (hit.kindGuess ?? guessPrinterKind(hit.displayName || hit.name)) : undefined
  }

  /**
   * نوار پیشنهاد هر کارت. اگر نام چاپگر خالی باشد (پیش‌فرض ویندوز) هیچ پیشنهادی
   * نمی‌دهیم؛ چون «پیش‌فرض ویندوز» می‌تواند هر چیزی باشد.
   */
  const suggestionFor = (profile: 'INVOICE' | 'WHOLESALE' | 'LABEL') => {
    if (profile === 'LABEL') {
      const kind = kindOf(label.printerName)
      const s = printerKindSuggestion(kind)
      if (!s) return null
      if (kind === 'RECEIPT')
        return {
          text: 'این چاپگر به‌نظر رسید حرارتی است و برای لیبل مناسب نیست؛ چاپگر لیبل را انتخاب کنید.'
        }
      return { text: s.text }
    }
    const name = profile === 'WHOLESALE' ? receipt.wholesalePrinterName : receipt.printerName
    const kind = kindOf(name)
    const s = printerKindSuggestion(kind)
    if (!s) return null
    if (kind === 'RECEIPT' && receipt.paperPreset !== 'THERMAL_80')
      return { text: s.text, apply: () => applyReceiptPreset('THERMAL_80') }
    return { text: s.text }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="font-bold">چاپگرها</div>
        <button className="btn" onClick={onRefresh}>
          به‌روزرسانی فهرست
        </button>
        <span className="kbd">
          نام چاپگر فقط در سمت main با فهرست زنده اعتبارسنجی می‌شود؛ اگر چاپگر ذخیره‌شده پیدا نشود، هیچ برگه‌ای
          چاپ نمی‌شود (هیچ fallback خودکاری وجود ندارد).
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <PrinterCard
          title="فاکتور فروش تکی"
          hint="رسید فروش روزمره روی چاپگر حرارتی ۸۰ میلی‌متری."
          profile="INVOICE"
          value={receipt.printerName}
          printers={printers}
          askEachTime={receipt.askEachTime !== false}
          onPick={(name) => setR({ printerName: name })}
          onAskChange={(ask) => setR({ askEachTime: ask })}
          onSave={onSavePrinter}
          busy={busy}
          savedMsg={savedMsg}
          onTest={runTest}
          onPreview={openPreview}
          testBusy={testBusy === 'INVOICE'}
          testMsg={testMsgs.INVOICE ?? null}
          suggestion={suggestionFor('INVOICE')}
          savedMethod={savedMethodOf('INVOICE')}
          testMethod={testMethods.INVOICE ?? savedMethodOf('INVOICE')}
          onTestMethodChange={(m) => setTestMethods((x) => ({ ...x, INVOICE: m }))}
          onSample={runSample}
          sampleLabel="چاپ فاکتور نمونه"
        />
        <PrinterCard
          title="فاکتور عمده"
          hint="اگر «کاغذ جدا برای عمده» روشن باشد، این چاپگر و این کاغذ به کار می‌رود؛ وگرنه مثل فاکتور فروش."
          profile="WHOLESALE"
          value={receipt.wholesalePrinterName}
          printers={printers}
          askEachTime={receipt.askEachTime !== false}
          onPick={(name) => setR({ wholesalePrinterName: name })}
          onAskChange={(ask) => setR({ askEachTime: ask })}
          onSave={onSavePrinter}
          busy={busy}
          savedMsg={savedMsg}
          onTest={runTest}
          onPreview={openPreview}
          testBusy={testBusy === 'WHOLESALE'}
          testMsg={testMsgs.WHOLESALE ?? null}
          suggestion={suggestionFor('WHOLESALE')}
          savedMethod={savedMethodOf('WHOLESALE')}
          testMethod={testMethods.WHOLESALE ?? savedMethodOf('WHOLESALE')}
          onTestMethodChange={(m) => setTestMethods((x) => ({ ...x, WHOLESALE: m }))}
          onSample={runSample}
          sampleLabel="چاپ فاکتور عمده‌ی نمونه"
        />
        <PrinterCard
          title="لیبل (برچسب کالا)"
          hint="لیبل‌زن جداست؛ ابعاد و ستون‌های رول در بخش «پیشرفته» پایین تنظیم می‌شود."
          profile="LABEL"
          value={label.printerName}
          printers={printers}
          askEachTime={label.askEachTime !== false}
          onPick={(name) => setL({ printerName: name })}
          onAskChange={(ask) => setL({ askEachTime: ask, autoPrint: !ask })}
          onSave={onSavePrinter}
          busy={busy}
          savedMsg={savedMsg}
          onTest={runTest}
          onPreview={openPreview}
          testBusy={testBusy === 'LABEL'}
          testMsg={testMsgs.LABEL ?? null}
          suggestion={suggestionFor('LABEL')}
          savedMethod={savedMethodOf('LABEL')}
          testMethod={testMethods.LABEL ?? savedMethodOf('LABEL')}
          onTestMethodChange={(m) => setTestMethods((x) => ({ ...x, LABEL: m }))}
        />
      </div>
      <PrintPreviewModal
        open={preview !== null}
        title={preview?.title ?? ''}
        html={preview?.html ?? ''}
        widthMm={preview?.widthMm ?? 80}
        heightMm={preview?.heightMm ?? 'AUTO'}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}

/* ===========================================================================
 * فاز ۴ — پیش‌نمایش نسبی با خط‌کش داخلی (بخش ۷.۴ طرح).
 *
 * ⚠️ چرا «نسبی»؟ چون DPI مانیتور معلوم نیست؛ پس پیش‌نمایش هرگز نمی‌تواند
 * اندازه‌ی فیزیکی را تضمین کند. کاری که می‌کند این است: همان HTML چاپی را با
 * مقیاسِ معلوم (pxPerMm = 96/25.4 و سپس fit به عرض کادر) نشان می‌دهد و خط‌کش
 * مرتبط با همان مقیاس را می‌کشد، تا نسبت‌ها دیده شود. تأیید اندازه‌ی واقعی
 * فقط با «چاپ آزمایشی» ممکن است و همین جمله زیر پیش‌نمایش نوشته می‌شود.
 * ======================================================================== */

/** px هر میلی‌متر در CSS (قرارداد ۹۶dpi) — همان عددی که مرورگر برای mm حساب می‌کند. */
const PX_PER_MM = 96 / 25.4

const mmTicks = (lenMm: number, step = 10): number[] => {
  const out: number[] = []
  for (let mm = 0; mm <= lenMm + 0.001; mm += step) out.push(Math.min(mm, lenMm))
  return out
}

export function PrintPreviewModal({
  open,
  title,
  html,
  widthMm,
  heightMm,
  onClose
}: {
  open: boolean
  title: string
  html: string
  widthMm: number
  heightMm: number | 'AUTO'
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(0)

  useEffect(() => {
    if (!open) return
    const measure = () => setBoxW(boxRef.current?.clientWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, html])

  /** ارتفاع ارتفاع‌خودکار در پیش‌نمایش: یک قاب اسمی ۱۴۰mm (خودِ چاپ اندازه‌گیری می‌شود). */
  const frameH = heightMm === 'AUTO' ? 140 : heightMm
  const naturalW = widthMm * PX_PER_MM
  const scale = boxW > 0 ? Math.min(1, boxW / naturalW) : 1
  const scaledW = naturalW * scale
  const scaledH = frameH * PX_PER_MM * scale

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <div className="me-auto kbd">
            مقیاس نمایش: {faDigits(Math.round(scale * 100))}٪ · عرض کاغذ: {faDigits(Math.round(widthMm))} میلی‌متر
          </div>
          <button className="btn" onClick={onClose}>
            بستن
          </button>
        </>
      }
    >
      <div ref={boxRef} className="bg-slate-50 rounded p-2 overflow-auto max-h-[70vh]">
        {html ? (
          <div className="inline-block" style={{ direction: 'ltr' }} data-preview-sheet="1">
            {/* خط‌کش افقی — شماره‌ی هر ۵۰ میلی‌متر نوشته می‌شود */}
            <div className="relative bg-white border-b border-slate-300" style={{ width: scaledW, height: 14 }}>
              {mmTicks(widthMm).map((mm) => (
                <i
                  key={`h${mm}`}
                  className="absolute top-0 border-l border-slate-400 not-italic text-[9px] leading-none text-slate-500"
                  style={{ left: mm * PX_PER_MM * scale, height: mm % 50 === 0 ? 10 : 6, paddingLeft: 2 }}
                >
                  {mm % 50 === 0 ? faDigits(mm) : ''}
                </i>
              ))}
            </div>
            <div className="flex items-start">
              <div className="relative bg-white overflow-hidden" style={{ width: scaledW, height: scaledH }}>
                <iframe
                  title="print-preview"
                  srcDoc={html}
                  style={{
                    width: `${widthMm}mm`,
                    height: `${frameH}mm`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    border: 0
                  }}
                />
              </div>
              {/* خط‌کش عمودی */}
              <div className="relative bg-white border-l border-slate-300" style={{ width: 26, height: scaledH }}>
                {mmTicks(frameH).map((mm) => (
                  <i
                    key={`v${mm}`}
                    className="absolute left-0 border-t border-slate-400 not-italic text-[9px] leading-none text-slate-500"
                    style={{ top: mm * PX_PER_MM * scale, width: mm % 50 === 0 ? 12 : 6, paddingLeft: 2 }}
                  >
                    {mm % 50 === 0 ? faDigits(mm) : ''}
                  </i>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-slate-400 text-center py-10">در حال ساخت پیش‌نمایش…</div>
        )}
      </div>
      <div className="kbd mt-2 leading-6">
        این نمایش <b>نسبی</b> است و اندازه‌ی فیزیکی را تضمین نمی‌کند (DPI مانیتور معلوم نیست)؛ تأیید اندازه فقط با
        دکمه‌ی «چاپ آزمایشی» و خط‌کش روی برگه‌ی چاپ‌شده است.
      </div>
    </Modal>
  )
}

/** بخش پیشرفته — پیش‌فرض بسته (بخش ۷.۱ طرح). */
export function PrintAdvanced({
  receipt,
  label,
  setR,
  setL
}: {
  receipt: ReceiptTemplate
  label: LabelTemplate
  setR: (patch: Partial<ReceiptTemplate>) => void
  setL: (patch: Partial<LabelTemplate>) => void
}) {
  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return (
    <details className="bg-slate-50 border border-slate-200 rounded p-2">
      <summary className="font-bold cursor-pointer">
        پیشرفته — اندازه‌ی کاغذ، حاشیه‌ها، فونت، رول لیبل و مسیر چاپ
      </summary>
      <div className="space-y-3 pt-2">
        <div className="font-bold">فاکتور فروش</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="block">
            <div className="mb-1">نوع کاغذ</div>
            <select
              className="inp"
              value={receipt.paperPreset}
              onChange={(e) => setR({ paperPreset: e.target.value as ReceiptTemplate['paperPreset'] })}
            >
              <option value="THERMAL_80">حرارتی ۸۰ میلی‌متر (پیش‌فرض)</option>
              <option value="THERMAL_58">حرارتی ۵۸ میلی‌متر</option>
              <option value="FIXED_80x140">۸۰×۱۴۰ (کاغذ بریده)</option>
              <option value="A5">A5</option>
              <option value="A4">A4</option>
              <option value="CUSTOM">دلخواه</option>
            </select>
          </label>
          <label className="block">
            <div className="mb-1">عرض کاغذ (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.sheetWidthMm}
              onChange={(e) => setR({ sheetWidthMm: num(e.target.value, receipt.sheetWidthMm) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">ارتفاع کاغذ (mm) — ۰ = خودکار</div>
            <input
              type="number"
              className="inp"
              value={receipt.sheetHeightMm}
              onChange={(e) => setR({ sheetHeightMm: Math.max(0, num(e.target.value, receipt.sheetHeightMm)) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">عرض قابل‌چاپ (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.paperWidthMm}
              onChange={(e) => setR({ paperWidthMm: num(e.target.value, receipt.paperWidthMm) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">حاشیه‌ی افقی (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.marginXMm}
              onChange={(e) => setR({ marginXMm: num(e.target.value, receipt.marginXMm) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">حاشیه‌ی عمودی (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.marginYMm}
              onChange={(e) => setR({ marginYMm: num(e.target.value, receipt.marginYMm) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">حاشیه‌ی ایمنی کاتر (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.heightSafetyMm}
              onChange={(e) => setR({ heightSafetyMm: num(e.target.value, receipt.heightSafetyMm) })}
            />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={receipt.autoFont}
              onChange={(e) => setR({ autoFont: e.target.checked })}
            />
            فونت خودکار متناسب با عرض
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={receipt.useSystemDialog}
              onChange={(e) => setR({ useSystemDialog: e.target.checked })}
            />
            از دیالوگ چاپ ویندوز استفاده کن
          </label>
          <label className="block">
            <div className="mb-1">روش چاپ فاکتور</div>
            <select
              className="inp"
              value={receipt.printMethod}
              onChange={(e) => setR({ printMethod: e.target.value as ReceiptTemplate['printMethod'] })}
            >
              <option value="CHROMIUM">Chromium (پیش‌فرض)</option>
              <option value="RAW">دقیق (RAW)</option>
            </select>
            <div className="kbd leading-6">
              «دقیق (RAW)» تصویر برگه را با دستور مستقیم چاپگر می‌فرستد و مستقل از درایور است؛ برای
              ذخیره‌کردنش اول یک «چاپ آزمایشی» با همین روش بگیرید تا روی این دستگاه تأیید شود.
            </div>
          </label>
          <label className="block">
            <div className="mb-1">دقت فاکتور RAW (dpi)</div>
            <select className="inp" value={receipt.rawDpi} onChange={(e) => setR({ rawDpi: Number(e.target.value) as 203 | 300 })}>
              <option value={203}>۲۰۳</option>
              <option value={300}>۳۰۰</option>
            </select>
          </label>
          <label className="block">
            <div className="mb-1">برش فاکتور RAW</div>
            <select
              className="inp"
              value={receipt.cutMode}
              onChange={(e) => setR({ cutMode: e.target.value as ReceiptTemplate['cutMode'] })}
            >
              <option value="FULL">کامل</option>
              <option value="PARTIAL">نیم‌برش</option>
              <option value="NONE">بدون برش</option>
            </select>
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={receipt.rawInvert}
              onChange={(e) => setR({ rawInvert: e.target.checked })}
            />
            معکوس‌کردن سفید/مشکی در RAW
          </label>
        </div>
        <div className="font-bold pt-2 border-t">فاکتور عمده</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={receipt.wholesaleSeparate}
              onChange={(e) => setR({ wholesaleSeparate: e.target.checked })}
            />
            کاغذ/چاپگر جدا برای عمده
          </label>
          <label className="block">
            <div className="mb-1">عرض کاغذ عمده (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.wholesaleSheetWidthMm}
              onChange={(e) => setR({ wholesaleSheetWidthMm: num(e.target.value, receipt.wholesaleSheetWidthMm) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">ارتفاع کاغذ عمده (mm) — ۰ = خودکار</div>
            <input
              type="number"
              className="inp"
              value={receipt.wholesaleSheetHeightMm}
              onChange={(e) => setR({ wholesaleSheetHeightMm: Math.max(0, num(e.target.value, receipt.wholesaleSheetHeightMm)) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">عرض قابل‌چاپ عمده (mm)</div>
            <input
              type="number"
              className="inp"
              value={receipt.wholesalePaperWidthMm}
              onChange={(e) => setR({ wholesalePaperWidthMm: num(e.target.value, receipt.wholesalePaperWidthMm) })}
            />
          </label>
        </div>
        <div className="font-bold pt-2 border-t">رول لیبل (فاز ۲)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="block">
            <div className="mb-1">تعداد ستون (۱ تا ۳)</div>
            <input
              type="number"
              min={1}
              max={3}
              className="inp"
              value={label.columns}
              onChange={(e) => setL({ columns: Math.min(3, Math.max(1, Math.round(num(e.target.value, label.columns)))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">فاصله‌ی افقی ستون‌ها (mm)</div>
            <input
              type="number"
              className="inp"
              value={label.gapXMm}
              onChange={(e) => setL({ gapXMm: Math.min(20, Math.max(0, num(e.target.value, label.gapXMm))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">فاصله‌ی عمودی ردیف‌ها (mm)</div>
            <input
              type="number"
              className="inp"
              value={label.gapYMm}
              onChange={(e) => setL({ gapYMm: Math.min(20, Math.max(0, num(e.target.value, label.gapYMm))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">جابه‌جایی افقی (mm)</div>
            <input
              type="number"
              className="inp"
              value={label.offsetXMm}
              onChange={(e) => setL({ offsetXMm: Math.min(10, Math.max(-10, num(e.target.value, label.offsetXMm))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">جابه‌جایی عمودی (mm)</div>
            <input
              type="number"
              className="inp"
              value={label.offsetYMm}
              onChange={(e) => setL({ offsetYMm: Math.min(10, Math.max(-10, num(e.target.value, label.offsetYMm))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">سنسور رول</div>
            <select
              className="inp"
              value={label.sensorType}
              onChange={(e) => setL({ sensorType: e.target.value as LabelTemplate['sensorType'] })}
            >
              <option value="GAP">فاصله‌ای (GAP)</option>
              <option value="BLACKMARK">نشانه‌ی سیاه (BLACKMARK)</option>
              <option value="CONTINUOUS">پیوسته (CONTINUOUS)</option>
            </select>
          </label>
          <label className="block">
            <div className="mb-1">روش چاپ</div>
            <select
              className="inp"
              value={label.printMethod}
              onChange={(e) => setL({ printMethod: e.target.value as LabelTemplate['printMethod'] })}
            >
              <option value="CHROMIUM">Chromium (پیش‌فرض)</option>
              <option value="RAW">دقیق (RAW)</option>
            </select>
            <div className="kbd leading-6">
              «دقیق (RAW)» روی لیبل‌زن با دستور TSPL چاپ می‌شود و مستقل از درایور است؛ برای
              ذخیره‌کردنش اول یک «چاپ آزمایشی» با همین روش بگیرید.
            </div>
          </label>
          <label className="block">
            <div className="mb-1">دقت چاپگر (dpi)</div>
            <select className="inp" value={label.rawDpi} onChange={(e) => setL({ rawDpi: Number(e.target.value) as 203 | 300 })}>
              <option value={203}>۲۰۳</option>
              <option value={300}>۳۰۰</option>
            </select>
          </label>
          <label className="block">
            <div className="mb-1">چگالی (RAW)</div>
            <input
              type="number"
              className="inp"
              value={label.density}
              onChange={(e) => setL({ density: Math.min(15, Math.max(0, Math.round(num(e.target.value, label.density)))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">سرعت (RAW)</div>
            <input
              type="number"
              className="inp"
              value={label.speed}
              onChange={(e) => setL({ speed: Math.min(6, Math.max(1, Math.round(num(e.target.value, label.speed)))) })}
            />
          </label>
          <label className="block">
            <div className="mb-1">جهت چاپ (RAW)</div>
            <select className="inp" value={label.direction} onChange={(e) => setL({ direction: Number(e.target.value) === 1 ? 1 : 0 })}>
              <option value={0}>۰</option>
              <option value={1}>۱</option>
            </select>
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={label.rawInvert}
              onChange={(e) => setL({ rawInvert: e.target.checked })}
            />
            معکوس‌کردن سفید/مشکی در RAW
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={label.useSystemDialog}
              onChange={(e) => setL({ useSystemDialog: e.target.checked })}
            />
            از دیالوگ چاپ ویندوز استفاده کن
          </label>
        </div>
        <div className="kbd">
          روش RAW فقط بعد از چاپ آزمایشی موفق در همین اجرای برنامه قابل ذخیره است. مقادیر سنسور، چگالی، سرعت، جهت،
          offset مثبت (TSPL REFERENCE) و معکوس‌کردن سفید/مشکی فقط در همان مسیر RAW استفاده می‌شوند.
        </div>
      </div>
    </details>
  )
}
