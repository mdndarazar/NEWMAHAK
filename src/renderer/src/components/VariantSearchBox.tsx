import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
import { useFieldScanDetector } from '../hooks/useBarcodeScanner'
import AllProductsModal from './AllProductsModal'
import { faDigits, money } from '@shared/jalali'

/**
 * ===================== کادر جستجو/اسکن کالا =====================
 * یک فیلد، دو کار — هم‌زمان و بدون تنظیم اضافه:
 *
 *   ۱) تایپ نام / کد / بخشی از بارکد ⇒ جستجوی زنده با لیست پیشنهادی (مثل قبل).
 *   ۲) اسکن با بارکدخوان ⇒ کالا *مستقیم* به فاکتور اضافه می‌شود، بدون این‌که
 *      لازم باشد از لیست انتخاب شود.
 *
 * تشخیص «اسکن» با سرعت تایپ انجام می‌شود (useFieldScanDetector): بارکدخوان HID
 * کاراکترها را با فاصله‌ی چند میلی‌ثانیه می‌فرستد و آخرش Enter می‌زند؛ انگشت
 * انسان هیچ‌وقت به آن سرعت نمی‌رسد. پس:
 *   • Enterِ اسکن ⇒ تطبیق دقیق بارکد/کد و افزودن مستقیم.
 *   • Enterِ تایپ دستی ⇒ همان رفتار قبلی (تطبیق دقیق، وگرنه اولین نتیجه).
 * حتی اگر تشخیص سرعت رد شود، مسیر «تطبیق دقیق بارکد» باز است، پس اسکن در هر
 * حالت کار می‌کند و قابلیت جستجوی متنی هم از بین نمی‌رود.
 *
 * دکمه‌ی انتهای کادر: «نمایش همه کالاها» ⇒ مودال فهرست کامل انبار برای انتخاب
 * دستی (AllProductsModal).
 *
 * IPC: variant:search · variant:byBarcode · product:list
 *
 * ref: صفحه‌ی میزبان می‌تواند بعد از یک اسکن HID فیلد را خالی و فوکوس کند.
 * ================================================================
 */
export interface VariantSearchBoxHandle {
  clear: () => void
  focus: () => void
  /** باز کردن مودال «همه کالاها» از بیرون (مثلاً با یک میان‌بر) */
  openAll: () => void
}

const VariantSearchBox = forwardRef<
  VariantSearchBoxHandle,
  {
    onPick: (variant: any) => void
    placeholder?: string
    autoFocus?: boolean
    /** نمایش دکمه‌ی «نمایش همه کالاها» در انتهای کادر (پیش‌فرض: روشن) */
    showAllButton?: boolean
    /** عنوان مودال فهرست کالاها */
    allTitle?: string
    /** باز/بسته شدن مودال فهرست کالاها (تا صفحه‌ی میزبان میان‌برهایش را خاموش کند) */
    onAllOpenChange?: (open: boolean) => void
  }
>(function VariantSearchBox(
  { onPick, placeholder = 'کد، بارکد یا نام کالا را وارد کنید', autoFocus, showAllButton = true, allTitle, onAllOpenChange },
  ref
) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scan = useFieldScanDetector()

  const openAllModal = (open: boolean) => {
    setAllOpen(open)
    onAllOpenChange?.(open)
  }

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        setQ('')
        setRows([])
        setNotFound(false)
        scan.reset()
      },
      focus: () => inputRef.current?.focus(),
      openAll: () => openAllModal(true)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => {
    const term = q.trim()
    setNotFound(false)
    if (term.length < 2) {
      setRows([])
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      setBusy(true)
      call<any[]>(CH.variantSearch, { search: term })
        .then((r) => {
          if (!alive) return
          setRows(r)
          setNotFound(!r.length)
        })
        .catch(() => alive && setRows([]))
        .finally(() => alive && setBusy(false))
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q])

  const pick = (v: any) => {
    onPick(v)
    setQ('')
    setRows([])
    setNotFound(false)
    scan.reset()
    inputRef.current?.focus()
  }

  /** تطبیق دقیق: اول بارکد، بعد کد کالا. مسیر مشترک اسکن و Enter دستی. */
  const exactMatch = async (term: string) => {
    const byBarcode = await call<any>(CH.variantByBarcode, { barcode: term }).catch(() => null)
    if (byBarcode) return byBarcode
    const inList = rows.find((r) => r.code === term || r.barcode === term)
    if (inList) return inList
    const found = await call<any[]>(CH.variantSearch, { search: term }).catch(() => [])
    return found.find((r) => r.code === term || r.barcode === term) ?? null
  }

  const submit = async () => {
    const term = q.trim()
    if (!term) return
    const scanned = scan.isScan(term)

    const exact = await exactMatch(term)
    if (exact) return pick(exact)

    // اسکن بارکدی که در انبار نیست: پیام روشن، نه انتخاب اشتباهی از لیست
    if (scanned) {
      setNotFound(true)
      return
    }
    if (rows.length) return pick(rows[0])
    // نتیجه‌ای نبود: فقط یک راهنمای آرام، نه خطا
    setNotFound(true)
  }

  const name = (v: any) =>
    `${v.product?.name ?? ''}${v.size ? ' سایز ' + faDigits(v.size) : ''}${v.color ? ' - ' + v.color : ''}`

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        className={`inp ${showAllButton ? 'pe-28' : ''}`}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          scan.onKeyDown(e)
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') {
            setRows([])
            setNotFound(false)
          }
        }}
      />

      {showAllButton && (
        <button
          type="button"
          onClick={() => openAllModal(true)}
          title="نمایش همه کالاها و انتخاب دستی از فهرست انبار (کلیک کنید)"
          className="absolute inset-y-1 end-1 px-2 rounded bg-brand text-white text-xs font-bold hover:bg-brand-dark flex items-center gap-1 whitespace-nowrap"
        >
          <span className="text-base leading-none">☰</span>
          <span>همه کالاها</span>
        </button>
      )}

      {!!rows.length && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded shadow-lg max-h-64 overflow-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-right px-2 py-1 hover:bg-brand/10 flex justify-between gap-2"
              onClick={() => pick(r)}
            >
              <span className="truncate">
                {faDigits(r.code)} · {name(r)}
              </span>
              <span className="kbd whitespace-nowrap">
                موجودی {faDigits(r.stock)} · {money(r.salePrice)}
              </span>
            </button>
          ))}
        </div>
      )}
      {notFound && !busy && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-amber-300 rounded shadow px-2 py-1 kbd">
          کالایی با این نام، کد یا بارکد پیدا نشد — از دکمه‌ی «همه کالاها» فهرست انبار را ببینید
        </div>
      )}
      {busy && <div className="kbd absolute left-2 top-2.5">…</div>}

      <AllProductsModal
        open={allOpen}
        onClose={() => {
          openAllModal(false)
          inputRef.current?.focus()
        }}
        onPick={(v) => onPick(v)}
        title={allTitle ?? 'همه‌ی کالاهای انبار'}
      />
    </div>
  )
})

export default VariantSearchBox
