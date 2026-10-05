import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'

/**
 * ===================== «نمایش همه کالاها» =====================
 * انتخاب دستی کالا از فهرست کامل انبار، برای وقتی کاربر نه بارکد دارد و نه
 * نام دقیق کالا را می‌داند. از دکمه‌ی انتهای کادر جستجوی کالا (در فاکتور خرید
 * و فاکتور فروش عمده و پنل فروش) باز می‌شود.
 *
 * ویژگی‌ها:
 *   • فهرست کامل با اسکرول (تا ۱۰۰۰ ردیف) و جستجوی سریع *داخل* همان فهرست
 *     (نام، کد، بارکد) — بدون بستن مودال.
 *   • فیلتر گروه کالا و «فقط کالاهای دارای موجودی».
 *   • انتخاب چندتایی: چند کالا را تیک بزنید و یک‌جا به فاکتور اضافه کنید؛ یا
 *     دابل‌کلیک/دکمه‌ی «افزودن» برای افزودن سریع یک کالا.
 *
 * IPC: product:list · category:tree
 * ==============================================================
 */
export default function AllProductsModal({
  open,
  onClose,
  onPick,
  title = 'همه‌ی کالاهای انبار'
}: {
  open: boolean
  onClose: () => void
  /** با هر بار انتخاب صدا زده می‌شود (همان شکل واریانتی که VariantSearchBox می‌دهد) */
  onPick: (variant: any) => void
  title?: string
}) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPicked(new Set())
    setFlash(null)
    call<any[]>(CH.categoryTree)
      .then(setCats)
      .catch(() => {})
    window.setTimeout(() => searchRef.current?.focus(), 60)
  }, [open])

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await call<any[]>(CH.productList, {
        search: q.trim() || undefined,
        categoryId: categoryId === '' ? undefined : Number(categoryId),
        take: 1000
      })
      setRows(r)
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [q, categoryId])

  // جستجوی زنده با debounce (همان الگوی VariantSearchBox)
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(t)
  }, [open, load])

  const visible = useMemo(() => (onlyInStock ? rows.filter((r) => (r.stock ?? 0) > 0) : rows), [rows, onlyInStock])

  const nameOf = (v: any) =>
    `${v.product?.name ?? ''}${v.size ? ' سایز ' + faDigits(v.size) : ''}${v.color ? ' - ' + v.color : ''}`

  const addOne = (v: any) => {
    onPick(v)
    setFlash(`«${nameOf(v)}» به فاکتور اضافه شد`)
    window.setTimeout(() => setFlash((c) => (c && c.includes(nameOf(v)) ? null : c)), 2500)
  }

  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const addPicked = () => {
    const list = visible.filter((r) => picked.has(r.id))
    for (const v of list) onPick(v)
    setPicked(new Set())
    setFlash(`${faDigits(list.length)} کالا به فاکتور اضافه شد`)
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <div className="me-auto kbd">
            {faDigits(visible.length)} کالا نمایش داده شده
            {picked.size ? ` · ${faDigits(picked.size)} کالا انتخاب شده` : ''}
          </div>
          <button className="btn" onClick={onClose}>
            بستن <span className="keycap">Esc</span>
          </button>
          <button className="btn btn-primary" onClick={addPicked} disabled={!picked.size}>
            افزودن {picked.size ? faDigits(picked.size) : ''} کالای انتخاب‌شده
          </button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <div className="mb-1">جستجوی سریع در فهرست</div>
          <input
            ref={searchRef}
            className="inp"
            placeholder="نام کالا، کد یا بارکد"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label>
          <div className="mb-1">گروه کالا</div>
          <select
            className="inp min-w-[160px]"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">همه‌ی گروه‌ها</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {'— '.repeat(c.depth ?? 0)}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" className="w-4 h-4" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
          فقط کالاهای دارای موجودی
        </label>
        <button className="btn" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال دریافت…' : 'تازه‌سازی'}
        </button>
      </div>

      {flash && <div className="bg-emerald-50 border border-emerald-300 rounded px-3 py-1.5">{flash}</div>}
      {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-1.5">{err}</div>}

      <div className="border rounded max-h-[55vh] overflow-auto">
        <table className="tbl">
          <thead className="sticky top-0">
            <tr>
              <th className="w-8"></th>
              <th>کد</th>
              <th>بارکد</th>
              <th>نام کالا</th>
              <th>گروه</th>
              <th>موجودی</th>
              <th>قیمت فروش</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className={picked.has(r.id) ? 'sel' : ''}
                onDoubleClick={() => addOne(r)}
                title="دابل‌کلیک = افزودن به فاکتور"
              >
                <td className="text-center">
                  <input type="checkbox" className="w-4 h-4" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td>{faDigits(r.code)}</td>
                <td>{faDigits(r.barcode)}</td>
                <td>{nameOf(r)}</td>
                <td>{r.product?.category?.name ?? '—'}</td>
                <td className={`text-center ${(r.stock ?? 0) <= 0 ? 'text-red-600 font-bold' : ''}`}>
                  {faDigits(r.stock ?? 0)} {r.product?.unit ?? 'عدد'}
                </td>
                <td>{money(r.salePrice ?? 0)}</td>
                <td>
                  <button className="text-brand font-bold" onClick={() => addOne(r)}>
                    افزودن
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-slate-400">
                  {busy ? 'در حال دریافت فهرست کالاها…' : 'کالایی با این فیلترها پیدا نشد'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="kbd">
        دابل‌کلیک روی هر ردیف یا دکمه‌ی «افزودن» کالا را فوراً به فاکتور اضافه می‌کند و مودال باز می‌ماند تا کالای بعدی
        را هم انتخاب کنید. برای افزودن گروهی، چند ردیف را تیک بزنید و «افزودن کالاهای انتخاب‌شده» را بزنید.
      </div>
    </Modal>
  )
}
