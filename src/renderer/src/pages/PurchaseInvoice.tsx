import PasswordField from '../components/PasswordField'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
import { useHotkeys } from '../hooks/useHotkeys'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import PartyPicker, { type Party } from '../components/PartyPicker'
import JalaliDateInput from '../components/JalaliDateInput'
import VariantSearchBox, { type VariantSearchBoxHandle } from '../components/VariantSearchBox'
import { SHORTCUTS } from '../lib/shortcuts'
import { faDigits, money, jalaliToday, isValidJalaliDate, jalaliStartOfDay, jalaliEndOfDay } from '@shared/jalali'
import { purchasePageRequest, purchaseRangeDirty } from '@shared/purchaseListPaging'
import { SETTLEMENT_LABELS, SettlementType } from '@shared/enums'

/**
 * ===================== فاکتور خرید (F3) =====================
 * ورود کالا به انبار با ثبت تامین‌کننده. کل عملیات در main اتمیک است:
 * PurchaseService.create → یک $transaction شامل فاکتور + اقلام + افزایش
 * موجودی از طریق InventoryService (تنها لایه‌ی مجاز نوشتن موجودی) + AuditLog.
 *
 * ویرایش فاکتور ثبت‌شده (جدید):
 *   در تب «فاکتورهای ثبت‌شده» هر ردیف دکمه‌ی «ویرایش» دارد. فرم با اطلاعات همان
 *   فاکتور پر می‌شود و ذخیره، به‌جای create، کانال purchase:update را صدا می‌زند.
 *   شماره فاکتور عوض نمی‌شود و موجودی با delta اصلاح می‌شود: اگر ۱۰ عدد اضافه
 *   ثبت شده بود و آن ۱۰ عدد را بردارید، همان ۱۰ عدد از موجودی کم می‌شود و
 *   حرکات انبار قبلی هم پاک نمی‌شوند.
 *
 * میان‌برها (lib/shortcuts.ts): Ctrl+S ذخیره · F4 فاکتور جدید · F7 حذف فاکتور جاری.
 * F2/F3/F8..F11 در Shell به ناوبری گره خورده‌اند و اینجا bind نمی‌شوند.
 * ============================================================
 */

interface PLine {
  key: string
  variantId: number
  code: string
  barcode: string
  name: string
  unit: string
  stock: number
  qty: number
  unitPrice: number
}

type Tab = 'form' | 'list'
type DiscountMode = 'AMOUNT' | 'PERCENT'

const monthStart = () => `${jalaliToday().slice(0, 8)}01`

export default function PurchaseInvoice() {
  const [tab, setTab] = useState<Tab>('form')

  // ---------------- فرم فاکتور ----------------
  /** null = ثبت فاکتور جدید · عدد = در حال ویرایش همان فاکتور */
  const [editId, setEditId] = useState<number | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [invoiceNo, setInvoiceNo] = useState<number | null>(null)
  const [dateJalali, setDateJalali] = useState(jalaliToday())
  const [supplier, setSupplier] = useState<Party | null>(null)
  const [supplierTyped, setSupplierTyped] = useState('')
  const [supplierDir, setSupplierDir] = useState<Party[]>([])
  const [supplierDirOpen, setSupplierDirOpen] = useState(false)
  const [newSup, setNewSup] = useState({ name: '', code: '' })
  const [lines, setLines] = useState<PLine[]>([])
  const [discountMode, setDiscountMode] = useState<DiscountMode>('AMOUNT')
  const [discountValue, setDiscountValue] = useState(0)
  const [settlementType, setSettlementType] = useState<SettlementType>('CASH')
  const [paidTotal, setPaidTotal] = useState(0)
  const [paidTouched, setPaidTouched] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /** هشدار قابل‌تایید (نه مانع) قبل از ذخیره؛ با تایید، ثبت با force انجام می‌شود. */
  const [confirmForce, setConfirmForce] = useState<string | null>(null)
  /** مودال «نمایش همه کالاها» باز است؟ (تا میان‌برها و بارکدخوان تداخل نکنند) */
  const [allProductsOpen, setAllProductsOpen] = useState(false)
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const searchRef = useRef<VariantSearchBoxHandle>(null)

  // ---------------- تب فاکتورهای قبلی ----------------
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(jalaliToday())
  const [rows, setRows] = useState<any[]>([])
  /** نشست ۱۱۵ · بند ۴-۴۶ — metadata صفحه، هشدار برش و جمع کل بازه از main */
  const [listMeta, setListMeta] = useState<{
    page?: { skip: number; take: number; totalCount: number; truncated: boolean }
    warnings: string[]
    totals?: { count: number; goodsTotal: number; discountTotal: number; grandTotal: number }
    /** ممیزی A115-02 — بازه‌ای که این ردیف‌ها/page از آن آمده‌اند؛ صفحه‌ی قبل/بعد فقط روی همین حرکت می‌کند */
    range?: { from: string; to: string }
  }>({ warnings: [] })
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [loadingList, setLoadingList] = useState(false)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 8000)
  }

  const loadNextNo = useCallback(() => {
    call<number>(CH.purchaseNextNo)
      .then(setInvoiceNo)
      .catch((e: any) => setErr(e.message))
  }, [])

  useEffect(() => {
    // در حالت ویرایش، شماره‌ی همان فاکتور نمایش داده می‌شود، نه شماره‌ی بعدی
    if (!editId) loadNextNo()
  }, [loadNextNo, editId])

  // ---------------- افزودن قلم ----------------
  const addVariant = useCallback((v: any) => {
    if (!v) return
    setErr(null)
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === v.id)
      if (i >= 0) {
        const copy = [...prev]
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 }
        return copy
      }
      return [
        ...prev,
        {
          key: `v${v.id}`,
          variantId: v.id,
          code: v.code,
          barcode: v.barcode,
          name: `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`,
          unit: v.product?.unit ?? 'عدد',
          stock: v.stock ?? 0,
          qty: 1,
          unitPrice: v.purchasePrice ?? 0 // پیش‌فرض از قیمت خرید کالا، قابل ویرایش
        }
      ]
    })
  }, [])

  const addByBarcode = useCallback(
    async (barcode: string) => {
      const now = performance.now()
      // محافظت از ثبت دوباره وقتی هم بارکدخوان و هم Enter فیلد جستجو شلیک می‌کنند
      if (lastScan.current.code === barcode && now - lastScan.current.at < 350) return
      lastScan.current = { code: barcode, at: now }
      try {
        const v = await call<any>(CH.variantByBarcode, { barcode })
        searchRef.current?.clear()
        if (!v) return setErr(`کالایی با بارکد ${faDigits(barcode)} پیدا نشد`)
        addVariant(v)
      } catch (e: any) {
        setErr(e.message)
      }
    },
    [addVariant]
  )

  const modalOpen = confirmClear || !!confirmForce || allProductsOpen
  useBarcodeScanner(addByBarcode, { enabled: tab === 'form' && !modalOpen })

  const loadSupplierDir = useCallback(() => {
    call<Party[]>(CH.supplierList, { take: 200 })
      .then((r) => setSupplierDir(Array.isArray(r) ? r : []))
      .catch(() => setSupplierDir([]))
  }, [])
  useEffect(() => {
    loadSupplierDir()
  }, [loadSupplierDir])

  // ---------------- جمع‌ها ----------------
  const totals = useMemo(() => {
    const goods = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
    const discount = Math.min(
      discountMode === 'PERCENT' ? Math.round((goods * (discountValue || 0)) / 100) : Math.round(discountValue || 0),
      goods
    )
    return { goods, discount, payable: goods - discount, count: lines.length, qty: lines.reduce((s, l) => s + l.qty, 0) }
  }, [lines, discountMode, discountValue])

  // مبلغ پرداختی تا وقتی کاربر دستی تغییرش نداده، برابر قابل پرداخت می‌ماند
  useEffect(() => {
    if (!paidTouched) setPaidTotal(totals.payable)
  }, [totals.payable, paidTouched])

  const setLine = (key: string, patch: Partial<PLine>) =>
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => setLines((p) => p.filter((l) => l.key !== key))

  // ---------------- عملیات ----------------
  const resetForm = useCallback(
    (keepDate = true) => {
      setLines([])
      setSupplier(null)
      setSupplierTyped('')
      setDiscountValue(0)
      setDiscountMode('AMOUNT')
      setSettlementType('CASH')
      setNote('')
      setPaidTouched(false)
      setPaidTotal(0)
      setErr(null)
      setEditId(null)
      searchRef.current?.clear()
      if (!keepDate) setDateJalali(jalaliToday())
      loadNextNo()
    },
    [loadNextNo]
  )

  /** نشست ۱۵۵ (S151-c1) — رمز مدیر یا رمز دوم پنل خرید؛ بعد از ثبت موفق پاک می‌شود */
  const [purchasePw, setPurchasePw] = useState('')
  const doSave = useCallback(
    async (force: boolean) => {
      if (busy) return
      setConfirmForce(null)
      setBusy(true)
      try {
        const typedName = supplierTyped.trim()
        const payload = {
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.id ? undefined : typedName || undefined,
          settlementType,
          discountTotal: totals.discount,
          paidTotal: Math.max(0, Math.round(paidTotal || 0)),
          note: note.trim() || undefined,
          issuedAtJalali: dateJalali,
          // تایید آگاهانه‌ی کاربر: قواعد نرم سمت main رد می‌شوند
          force: force || undefined,
          lines: lines.map((l) => ({ variantId: l.variantId, qty: Math.round(l.qty), unitPrice: Math.round(l.unitPrice) })),
          // نشست ۱۵۵ (S151-c1): سرور رمز پنل خرید را می‌سنجد (قفل خاموش ⇒ بی‌رمز)
          panelPassword: purchasePw || undefined
        }
        const editing = editId
        const inv = editing
          ? await call<any>(CH.purchaseUpdate, { ...payload, id: editing })
          : await call<any>(CH.purchaseCreate, payload)
        const usedName = supplier?.name || typedName
        flash(
          editing
            ? `فاکتور خرید شماره ${faDigits(inv.invoiceNo)} ویرایش شد و اختلاف موجودی روی انبار اعمال گردید`
            : `فاکتور خرید شماره ${faDigits(inv.invoiceNo)} ثبت شد و موجودی ${faDigits(totals.qty)} قلم افزایش یافت` +
                (usedName ? ` (تامین‌کننده: ${usedName})` : '')
        )
        resetForm()
        setPurchasePw('')
        loadSupplierDir()
        if (editing) void loadList()
      } catch (e: any) {
        setErr(e.message)
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, lines, dateJalali, supplier, settlementType, totals, paidTotal, note, resetForm, editId, purchasePw]
  )

  /**
   * ذخیره. قواعد «نرم» (مثل قیمت منفی) جلوی کار را نمی‌گیرند: هشدار فارسی با
   * دکمه‌ی تایید نشان داده می‌شود و با تایید، عملیات بی‌قید‌و‌شرط انجام می‌شود.
   */
  const save = useCallback(() => {
    if (busy) return
    if (!lines.length) return setErr('فاکتور خرید خالی است؛ حداقل یک قلم اضافه کنید')
    if (lines.some((l) => l.qty <= 0)) return setErr('تعداد هر قلم باید بزرگ‌تر از صفر باشد')
    if (!isValidJalaliDate(dateJalali)) return setErr('تاریخ فاکتور معتبر نیست')
    setErr(null)
    const neg = lines.filter((l) => l.unitPrice < 0).length
    if (neg) {
      setConfirmForce(
        `قیمت واحد در ${faDigits(neg)} ردیف منفی است. این حالت معمولاً اشتباه تایپی است و جمع فاکتور و گزارش‌های خرید را وارونه می‌کند.`
      )
      return
    }
    void doSave(false)
  }, [busy, lines, dateJalali, doSave])

  useHotkeys(
    useMemo(
      () => ({
        'Ctrl+s': () => void save(),
        'Ctrl+S': () => void save(),
        F4: () => resetForm(false),
        F7: () => (lines.length ? setConfirmClear(true) : undefined)
      }),
      [save, resetForm, lines.length]
    ),
    tab === 'form' && !modalOpen
  )

  const loadList = useCallback(async (skip = 0, range?: { from: string; to: string }) => {
    // ممیزی A115-02 — «نمایش» بازه‌ی فعلی state را اعمال می‌کند؛ صفحه‌ی قبل/بعد بازه‌ی اعمال‌شده را پاس می‌دهد.
    const rf = range?.from ?? from
    const rt = range?.to ?? to
    if (!isValidJalaliDate(rf) || !isValidJalaliDate(rt)) return setErr('بازه‌ی تاریخ معتبر نیست')
    setLoadingList(true)
    try {
      const r = await call<any[] & { page?: any; warnings?: string[]; totals?: any }>(CH.purchaseList, {
        from: jalaliStartOfDay(rf).toISOString(),
        to: jalaliEndOfDay(rt).toISOString(),
        skip
      })
      setRows(r)
      setListMeta({ page: r.page, warnings: r.warnings ?? [], totals: r.totals, range: { from: rf, to: rt } })
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [from, to])

  useEffect(() => {
    if (tab === 'list') void loadList()
    // فقط با ورود به تب بار اول؛ بعد از آن با دکمه‌ی «نمایش»
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  /** پر کردن فرم با اطلاعات یک فاکتور خرید ثبت‌شده (تازه از دیتابیس). */
  const startEdit = useCallback(
    async (row: any) => {
      setLoadingEdit(true)
      setErr(null)
      try {
        const inv = (await call<any>(CH.purchaseGet, { id: row.id })) ?? row
        setEditId(inv.id)
        setInvoiceNo(inv.invoiceNo)
        setDateJalali(inv.issuedAtJalali)
        setSupplier(inv.supplier ?? null)
        setDiscountMode('AMOUNT')
        setDiscountValue(inv.discountTotal ?? 0)
        setSettlementType((inv.settlementType ?? 'CASH') as SettlementType)
        setNote(inv.note ?? '')
        setLines(
          (inv.items ?? []).map((it: any) => ({
            key: `i${it.id}`,
            variantId: it.variantId,
            code: it.variant?.code ?? '',
            barcode: it.variant?.barcode ?? '',
            name: `${it.variant?.product?.name ?? ''}${it.variant?.size ? ' سایز ' + it.variant.size : ''}${
              it.variant?.color ? ' - ' + it.variant.color : ''
            }`,
            unit: it.variant?.product?.unit ?? 'عدد',
            stock: it.variant?.stock ?? 0,
            qty: it.qty,
            unitPrice: it.unitPrice
          })) as PLine[]
        )
        setPaidTouched(true)
        setPaidTotal(inv.paidTotal ?? 0)
        setTab('form')
      } catch (e: any) {
        setErr(e.message)
      } finally {
        setLoadingEdit(false)
      }
    },
    []
  )

  const cancelEdit = useCallback(() => {
    resetForm(false)
    flash('ویرایش لغو شد؛ فاکتور ثبت‌شده بدون تغییر ماند')
  }, [resetForm])

  /**
   * نشست ۱۱۵ · بند ۴-۴۶ — جمع پایین جدول از `totals` کل بازه (main) می‌آید، نه از
   * ردیف‌های همین صفحه؛ جمع محلی فقط fallback پاسخ قدیمی است.
   */
  const listTotals = useMemo(
    () =>
      listMeta.totals
        ? {
            count: listMeta.totals.count,
            grand: listMeta.totals.grandTotal,
            goods: listMeta.totals.goodsTotal,
            discount: listMeta.totals.discountTotal
          }
        : {
            count: rows.length,
            grand: rows.reduce((s, r) => s + r.grandTotal, 0),
            goods: rows.reduce((s, r) => s + r.goodsTotal, 0),
            discount: rows.reduce((s, r) => s + r.discountTotal, 0)
          },
    [rows, listMeta]
  )

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2">
        <h1 className="text-lg font-bold">فاکتور خرید</h1>
        <span className="kbd">
          {SHORTCUTS.save} ذخیره · {SHORTCUTS.newItem} جدید · {SHORTCUTS.deleteSelected} حذف
        </span>
        <div className="ms-auto flex gap-1">
          <div className="w-44" title="رمز مدیر یا رمز دوم پنل خرید (قفل خاموش ⇒ لازم نیست)">
            <PasswordField value={purchasePw} placeholder="رمز ثبت خرید" onChange={(e) => setPurchasePw(e.target.value)} />
          </div>
          <button className={`btn ${tab === 'form' ? 'btn-primary' : ''}`} onClick={() => setTab('form')}>
            ثبت فاکتور
          </button>
          <button className={`btn ${tab === 'list' ? 'btn-primary' : ''}`} onClick={() => setTab('list')}>
            فاکتورهای ثبت‌شده
          </button>
        </div>
      </div>

      {tab === 'form' ? (
        <>
          {editId && (
            <div className="rounded shadow p-2 border-2 bg-sky-50 border-sky-400 flex flex-wrap items-center gap-3">
              <b>در حال ویرایش فاکتور خرید شماره {faDigits(invoiceNo ?? 0)}</b>
              <span className="kbd">
                با ذخیره، همین فاکتور به‌روز می‌شود (شماره‌اش عوض نمی‌شود) و فقط *اختلاف* تعداد اقلام روی موجودی انبار
                اعمال می‌گردد.
              </span>
              <button className="btn ms-auto" onClick={cancelEdit} disabled={busy}>
                انصراف از ویرایش
              </button>
            </div>
          )}
          {editId ? (
            <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-5">
              اگر قیمت یا تخفیف این فاکتور را عوض کنید، سود فروش‌هایی که از همین خرید آمده‌اند <b>خودکار</b> درست
              می‌شود. این یادآوری است تا موقع اصلاح حواستان باشد عدد سود گذشته هم عوض می‌شود.
            </div>
          ) : null}

          <div className="bg-white rounded shadow p-2 grid grid-cols-12 gap-2 items-start">
            <label className="col-span-2">
              <div className="mb-1">شماره فاکتور</div>
              <div className="inp bg-slate-50 font-bold">{invoiceNo ? faDigits(invoiceNo) : '…'}</div>
            </label>
            <div className="col-span-2">
              <div className="mb-1">تاریخ</div>
              <JalaliDateInput value={dateJalali} onChange={setDateJalali} className="inp" />
            </div>
            <div className="col-span-4">
              <PartyPicker
                kind="supplier"
                value={supplier}
                onChange={(p) => {
                  setSupplier(p)
                  setSupplierTyped(p?.name ?? '')
                  loadSupplierDir()
                }}
                onDraftChange={setSupplierTyped}
              />
              {!supplier ? (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 leading-5">
                  اگر نام تامین‌کننده را ننویسید، فاکتور ثبت می‌شود ولی در گزارش سود نمی‌توانید بفهمید این جنس از کدام
                  فروشنده آمده. آن ردیف‌ها «فاقد نام تامین‌کننده» می‌شوند. اجباری نیست.
                </div>
              ) : null}
            </div>
            <label className="col-span-2">
              <div className="mb-1">نوع تسویه</div>
              <select
                className="inp"
                value={settlementType}
                onChange={(e) => setSettlementType(e.target.value as SettlementType)}
              >
                {Object.entries(SETTLEMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2">
              <div className="mb-1">تعداد اقلام</div>
              <div className="inp bg-slate-50">
                {faDigits(totals.count)} ردیف · {faDigits(totals.qty)} عدد
              </div>
            </label>
          </div>

          <div className="bg-white rounded shadow p-2 text-xs">
            <button type="button" className="btn" onClick={() => setSupplierDirOpen((o) => !o)}>
              {supplierDirOpen ? 'بستن فهرست تامین‌کننده‌ها' : 'تامین‌کننده‌ها (کد میان‌بر)'}
            </button>
            {supplierDirOpen ? (
              <div className="mt-2 space-y-2">
                <p className="text-slate-600 leading-5">
                  دو راه: همین‌جا ثبت کنید، یا نام را مستقیم روی فاکتور بنویسید — هر نام تازه خودش ردیف فهرست می‌شود.
                  کد عددی میان‌بر است (۱ = همان تامین‌کننده).
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <label>
                    نام
                    <input
                      className="inp mr-1"
                      value={newSup.name}
                      onChange={(e) => setNewSup((s) => ({ ...s, name: e.target.value }))}
                    />
                  </label>
                  <label>
                    کد میان‌بر (خالی = بعدی)
                    <input
                      className="inp mr-1 w-24"
                      value={newSup.code}
                      onChange={(e) => setNewSup((s) => ({ ...s, code: e.target.value }))}
                      placeholder="۱"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (!newSup.name.trim()) return setErr('نام تامین‌کننده را بنویسید')
                      call<Party>(CH.supplierCreate, {
                        name: newSup.name.trim(),
                        code: newSup.code.trim() || undefined
                      })
                        .then((s) => {
                          setNewSup({ name: '', code: '' })
                          loadSupplierDir()
                          setSupplier(s)
                        })
                        .catch((e: any) => setErr(e.message))
                    }}
                  >
                    ثبت تامین‌کننده
                  </button>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>کد</th>
                      <th>نام</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierDir.map((s) => (
                      <tr key={s.id}>
                        <td className="tabular-nums">{faDigits(s.code)}</td>
                        <td>{s.name}</td>
                        <td>
                          <button type="button" className="btn px-2" onClick={() => setSupplier(s)}>
                            انتخاب
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="bg-white rounded shadow p-2 flex gap-2 items-center">
            <VariantSearchBox
              ref={searchRef}
              onPick={addVariant}
              autoFocus
              placeholder="کد یا بارکد کالا را وارد کنید یا نام را جستجو کنید"
              onAllOpenChange={setAllProductsOpen}
              allTitle="انتخاب کالا از فهرست انبار (فاکتور خرید)"
            />
            <span className="kbd whitespace-nowrap">
              اسکن بارکد = افزودن مستقیم · تایپ نام = جستجو · دکمه‌ی «همه کالاها» = انتخاب دستی از فهرست
            </span>
          </div>

          <div className="tbl-card">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>کد</th>
                  <th>بارکد</th>
                  <th>نام کالا</th>
                  <th>موجودی فعلی</th>
                  <th>مقدار</th>
                  <th>قیمت واحد (ریال)</th>
                  <th>جمع ردیف</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>{faDigits(i + 1)}</td>
                    <td>{faDigits(l.code)}</td>
                    <td>{faDigits(l.barcode)}</td>
                    <td>{l.name}</td>
                    <td className="text-center">
                      {faDigits(l.stock)} {l.unit}
                    </td>
                    <td className="w-24">
                      <input
                        type="number"
                        min={1}
                        className="inp py-0.5"
                        value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: Math.max(1, Math.round(+e.target.value || 0)) })}
                      />
                    </td>
                    <td className="w-36">
                      <input
                        type="number"
                        min={0}
                        className="inp py-0.5"
                        value={l.unitPrice}
                        onChange={(e) => setLine(l.key, { unitPrice: Math.max(0, +e.target.value || 0) })}
                      />
                      <div className="kbd">{money(l.unitPrice)}</div>
                    </td>
                    <td className="font-bold">{money(l.qty * l.unitPrice)}</td>
                    <td>
                      <button className="text-red-500" onClick={() => removeLine(l.key)}>
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
                {!lines.length && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-slate-400">
                      کالایی اضافه نشده است؛ بارکد را اسکن کنید یا از فیلد بالا جستجو کنید
                    </td>
                  </tr>
                )}
              </tbody>
              {!!lines.length && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={5}>جمع</td>
                    <td className="text-center">{faDigits(totals.qty)}</td>
                    <td></td>
                    <td>{money(totals.goods)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {(msg || err) && (
            <div
              className={`rounded px-3 py-2 border whitespace-pre-line ${
                err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
              }`}
            >
              {err ?? msg}
            </div>
          )}

          <div className="bg-white rounded shadow p-2 grid grid-cols-12 gap-2 items-end">
            <label className="col-span-2">
              <div className="mb-1">مبلغ کل</div>
              <div className="inp bg-slate-50 font-bold">{money(totals.goods)}</div>
            </label>
            <label className="col-span-1">
              <div className="mb-1">نوع تخفیف</div>
              <select className="inp" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}>
                <option value="AMOUNT">مبلغی</option>
                <option value="PERCENT">درصدی</option>
              </select>
            </label>
            <label className="col-span-2">
              <div className="mb-1">{discountMode === 'PERCENT' ? 'درصد تخفیف (٪)' : 'مبلغ تخفیف (ریال)'}</div>
              <input
                type="number"
                min={0}
                max={discountMode === 'PERCENT' ? 100 : undefined}
                className="inp"
                value={discountValue}
                onChange={(e) => setDiscountValue(Math.max(0, +e.target.value || 0))}
              />
              <div className="kbd">تخفیف اعمال‌شده: {money(totals.discount)}</div>
            </label>
            <label className="col-span-2">
              <div className="mb-1">جمع قابل پرداخت</div>
              <div className="inp bg-emerald-50 border-emerald-300 font-bold text-emerald-800">{money(totals.payable)}</div>
            </label>
            <label className="col-span-2">
              <div className="mb-1">مبلغ پرداختی</div>
              <input
                type="number"
                min={0}
                className="inp"
                value={paidTotal}
                onChange={(e) => {
                  setPaidTouched(true)
                  setPaidTotal(Math.max(0, +e.target.value || 0))
                }}
              />
              <div className="kbd">
                {paidTotal >= totals.payable ? 'تسویه کامل' : `مانده: ${money(totals.payable - paidTotal)}`}
              </div>
            </label>
            <label className="col-span-3">
              <div className="mb-1">یادداشت</div>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'در حال ذخیره…' : editId ? 'ذخیره‌ی ویرایش' : 'ذخیره'} <span className="kbd">{SHORTCUTS.save}</span>
            </button>
            <button className="btn" onClick={() => resetForm(false)} disabled={busy}>
              جدید <span className="kbd">{SHORTCUTS.newItem}</span>
            </button>
            <button className="btn btn-danger" onClick={() => setConfirmClear(true)} disabled={busy || !lines.length}>
              حذف فاکتور <span className="kbd">{SHORTCUTS.deleteSelected}</span>
            </button>
            <div className="kbd ms-auto self-center">
              با ذخیره، موجودی کالاها به‌صورت اتمیک از طریق InventoryService افزایش می‌یابد و یک حرکت انبار PURCHASE ثبت می‌شود.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="bg-white rounded shadow p-2 flex flex-wrap gap-3 items-end">
            <div>
              <div className="mb-1">از تاریخ</div>
              <JalaliDateInput value={from} onChange={setFrom} />
            </div>
            <div>
              <div className="mb-1">تا تاریخ</div>
              <JalaliDateInput value={to} onChange={setTo} />
            </div>
            <button className="btn btn-primary" onClick={() => void loadList()} disabled={loadingList}>
              {loadingList ? 'در حال دریافت…' : 'نمایش'}
            </button>
            <div className="kbd">
              {faDigits(listTotals.count)} فاکتور · جمع خرید {money(listTotals.grand)} ریال
            </div>
          </div>

          {/* نشست ۱۱۵ · بند ۴-۴۶ — هشدار برش صریح + صفحه‌ی قبل/بعد (نه سقف بی‌صدا) */}
          {listMeta.warnings.length > 0 && (
            <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
              <span>{listMeta.warnings.join(' ')}</span>
              {purchaseRangeDirty(listMeta.range, from, to) && (
                <span className="font-bold">
                  (این صفحه‌ها مربوط به بازه‌ی {listMeta.range!.from} تا {listMeta.range!.to} است؛ برای بازه‌ی تازه «نمایش» را بزنید)
                </span>
              )}
              {listMeta.page && (
                <>
                  <button
                    className="btn"
                    disabled={loadingList || !purchasePageRequest(listMeta.range, listMeta.page, rows.length, 'prev')}
                    onClick={() => {
                      const q = purchasePageRequest(listMeta.range, listMeta.page, rows.length, 'prev')
                      if (q) void loadList(q.skip, q)
                    }}
                  >
                    صفحه‌ی قبل
                  </button>
                  <button
                    className="btn"
                    disabled={loadingList || !purchasePageRequest(listMeta.range, listMeta.page, rows.length, 'next')}
                    onClick={() => {
                      const q = purchasePageRequest(listMeta.range, listMeta.page, rows.length, 'next')
                      if (q) void loadList(q.skip, q)
                    }}
                  >
                    صفحه‌ی بعد
                  </button>
                </>
              )}
            </div>
          )}

          <div className="tbl-card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>شماره</th>
                  <th>تاریخ</th>
                  <th>تامین‌کننده</th>
                  <th>اقلام</th>
                  <th>مبلغ کل</th>
                  <th>تخفیف</th>
                  <th>قابل پرداخت</th>
                  <th>پرداختی</th>
                  <th>تسویه</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={openRow === r.id ? 'sel' : ''}>
                      <td className="font-bold">{faDigits(r.invoiceNo)}</td>
                      <td>{faDigits(r.issuedAtJalali)}</td>
                      <td>{r.supplier?.name ?? '—'}</td>
                      <td className="text-center">{faDigits(r.items.length)}</td>
                      <td>{money(r.goodsTotal)}</td>
                      <td>{money(r.discountTotal)}</td>
                      <td className="font-bold">{money(r.grandTotal)}</td>
                      <td>{money(r.paidTotal)}</td>
                      <td>{SETTLEMENT_LABELS[r.settlementType as SettlementType] ?? r.settlementType}</td>
                      <td className="whitespace-nowrap">
                        <button className="text-brand" onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                          {openRow === r.id ? 'بستن' : 'جزئیات'}
                        </button>
                        <button className="text-brand ms-2" onClick={() => void startEdit(r)} disabled={loadingEdit}>
                          {loadingEdit ? '…' : 'ویرایش'}
                        </button>
                      </td>
                    </tr>
                    {openRow === r.id && (
                      <tr>
                        <td colSpan={10} className="bg-slate-50">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>کد</th>
                                <th>کالا</th>
                                <th>مقدار</th>
                                <th>قیمت واحد</th>
                                <th>جمع ردیف</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.items.map((it: any) => (
                                <tr key={it.id}>
                                  <td>{faDigits(it.variant.code)}</td>
                                  <td>
                                    {it.variant.product.name}
                                    {it.variant.size ? ` سایز ${faDigits(it.variant.size)}` : ''}
                                    {it.variant.color ? ` - ${it.variant.color}` : ''}
                                  </td>
                                  <td className="text-center">{faDigits(it.qty)}</td>
                                  <td>{money(it.unitPrice)}</td>
                                  <td>{money(it.lineTotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {r.note && <div className="p-2 kbd">یادداشت: {r.note}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10} className="text-center py-10 text-slate-400">
                      در این بازه فاکتور خریدی ثبت نشده است
                    </td>
                  </tr>
                )}
              </tbody>
              {!!rows.length && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={4}>جمع {faDigits(listTotals.count)} فاکتور</td>
                    <td>{money(listTotals.goods)}</td>
                    <td>{money(listTotals.discount)}</td>
                    <td>{money(listTotals.grand)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
          <div className="kbd">
            «ویرایش» فرم را با اطلاعات همان فاکتور پر می‌کند؛ با ذخیره، شماره فاکتور حفظ می‌شود و فقط اختلاف تعداد اقلام
            روی موجودی انبار اعمال می‌گردد (حرکات انبار قبلی پاک نمی‌شوند). فیلتر تامین‌کننده و چاپ A4 در مرحله‌ی بعد.
          </div>
        </>
      )}

      <Modal
        open={confirmClear}
        title="حذف فاکتور جاری"
        onClose={() => setConfirmClear(false)}
        width="max-w-md"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmClear(false)}>
              انصراف
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false)
                resetForm(false)
                flash('فاکتور جاری پاک شد')
              }}
            >
              حذف
            </button>
          </>
        }
      >
        <p>
          {faDigits(totals.count)} ردیف کالا از فاکتور ثبت‌نشده‌ی جاری پاک می‌شود. این فاکتور هنوز ذخیره نشده، پس هیچ
          تغییری در موجودی انبار رخ نداده است.
        </p>
      </Modal>

      <ConfirmDialog
        open={!!confirmForce}
        title="ثبت فاکتور با مقدار غیرمعمول"
        message={
          <>
            <div>{confirmForce}</div>
            <div className="font-bold">آیا مطمئن هستید که می‌خواهید همین حالا ثبت شود؟</div>
          </>
        }
        busy={busy}
        onConfirm={() => void doSave(true)}
        onCancel={() => setConfirmForce(null)}
      />
    </div>
  )
}
