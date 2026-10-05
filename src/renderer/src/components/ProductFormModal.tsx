import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
import { usePanelLock } from '../hooks/usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, money } from '@shared/jalali'

/** یک ردیف واریانت در فرم. رشته‌های خالی = «خودکار» و به main فرستاده نمی‌شوند. */
export interface VariantDraft {
  id?: number
  code: string
  barcode: string
  size: string
  color: string
  salePrice: number
  purchasePrice: number
  ledgerAccountCode: string
  /**
   * موجودی؛ در هر دو حالت «جدید» و «ویرایش» قابل ورود و ویرایش است.
   * - واریانت جدید: موجودی اولیه (در main حرکت انبار INITIAL ثبت می‌شود)
   * - واریانت موجود: موجودی هدف (اختلافش به‌عنوان ADJUSTMENT ثبت می‌شود)
   */
  stock?: number
}

export interface ProductDraft {
  /** id محصول پایه (Product.id) نه واریانت */
  id?: number
  name: string
  categoryId: number | null
  unit: string
  note: string
  /** بند ۴-۳۴ — در گزارش فروش نام زنده نشان داده شود (فیش همیشه snapshot است). */
  reportLiveName: boolean
  variants: VariantDraft[]
}

const UNITS = ['عدد', 'جفت', 'متر', 'بسته', 'کیلوگرم', 'ست']

export function emptyVariant(): VariantDraft {
  return { code: '', barcode: '', size: '', color: '', salePrice: 0, purchasePrice: 0, ledgerAccountCode: '', stock: 0 }
}

export function emptyProduct(categoryId: number | null): ProductDraft {
  return { name: '', categoryId, unit: 'عدد', note: '', reportLiveName: false, variants: [emptyVariant()] }
}

/**
 * فرم «جدید» (F4) و «ویرایش» (F5) کالا.
 * - یک محصول پایه + n واریانت (سایز/رنگ) دقیقاً مطابق مدل Prisma.
 * - کد و بارکد: خالی بگذارید تا main خودکار بسازد، یا دستی وارد کنید.
 * - موجودی: مستقیماً همین‌جا وارد یا ویرایش می‌شود (هم در «کالای جدید» و هم در
 *   «ویرایش کالا»). لازم نیست از «فاکتور خرید» یا مودال «اصلاح موجودی» رد شوید.
 *   ردپا حفظ می‌شود: main هر تغییر را از InventoryService رد می‌کند تا یک
 *   StockMovement (INITIAL برای واریانت جدید، ADJUSTMENT برای اصلاح) ثبت شود.
 *   هیچ تاییدیه‌ی مسدودکننده‌ای هم در مسیر نیست؛ فقط اگر موجودی منفی شود یک
 *   هشدار قابل تایید نشان داده می‌شود.
 * - IPC: product:upsert  (ProductService.upsert)
 * - نشست ۱۴۶ · بند ۴-۳۹/۴-۴۰: تغییر قیمت فروش/خرید یا موجودی یک واریانت *موجود*
 *   فقط‌مدیر است و main رمز پنل کالاها را می‌سنجد؛ فیلد رمز فقط وقتی نشان داده
 *   می‌شود که چنین تغییری نسبت به لحظه‌ی باز شدن فرم وجود دارد (و قفل روشن است
 *   یا سیاست هنوز خوانده نشده). موجودی دست‌نخورده‌ی واریانت موجود اصلاً فرستاده
 *   نمی‌شود تا ذخیره‌ی فرم (مثلاً فقط تغییر نام) بعد از یک فروش هم‌زمان، موجودی
 *   را به عدد لحظه‌ی باز شدن فرم برنگرداند (اصلاح کاذب / کسری کاذب انبارگردانی).
 */
export default function ProductFormModal({
  open,
  initial,
  cats,
  onClose,
  onSaved
}: {
  open: boolean
  initial: ProductDraft | null
  cats: any[]
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct(null))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** موجودی ذخیره‌شده‌ی هر واریانت در لحظه‌ی باز شدن فرم، برای نمایش اختلاف. */
  const [baseStock, setBaseStock] = useState<Record<number, number>>({})
  /** نشست ۱۴۶ — قیمت‌های ذخیره‌شده‌ی هر واریانت موجود در لحظه‌ی باز شدن فرم. */
  const [basePrice, setBasePrice] = useState<Record<number, { sale: number; purchase: number }>>({})
  const [password, setPassword] = useState('')
  /** سرور تأیید خواست ولی فرم تغییری تشخیص نداده بود (مثلاً قیمت در این فاصله جای دیگری عوض شده). */
  const [serverAskedPw, setServerAskedPw] = useState(false)
  const { lockEnabled, loaded } = usePanelLock(PANEL_KEYS.products)
  const [warn, setWarn] = useState<string | null>(null)
  /** سؤال بند ۴-۳۴ وقتی نام عوض شده و تیک گزارش هنوز خاموش است. */
  const [askLiveName, setAskLiveName] = useState(false)
  const [openedName, setOpenedName] = useState('')
  // ابزار تولید ترکیبی سایز × رنگ (کاربردی برای پوشاک)
  const [sizesRaw, setSizesRaw] = useState('')
  const [colorsRaw, setColorsRaw] = useState('')

  useEffect(() => {
    if (!open) return
    const src = initial ?? emptyProduct(null)
    setDraft({ ...src, reportLiveName: !!src.reportLiveName })
    setOpenedName(src.name ?? '')
    setAskLiveName(false)
    setBaseStock(
      Object.fromEntries(src.variants.filter((v) => v.id).map((v) => [v.id as number, v.stock ?? 0]))
    )
    setBasePrice(
      Object.fromEntries(
        src.variants
          .filter((v) => v.id)
          .map((v) => [v.id as number, { sale: Number(v.salePrice || 0), purchase: Number(v.purchasePrice || 0) }])
      )
    )
    setPassword('')
    setServerAskedPw(false)
    setErr(null)
    setWarn(null)
    setBusy(false)
    setSizesRaw('')
    setColorsRaw('')
  }, [open, initial])

  const isEdit = !!draft.id
  const setV = (i: number, patch: Partial<VariantDraft>) =>
    setDraft((d) => ({ ...d, variants: d.variants.map((v, x) => (x === i ? { ...v, ...patch } : v)) }))

  const addRow = () => setDraft((d) => ({ ...d, variants: [...d.variants, emptyVariant()] }))
  const removeRow = (i: number) =>
    setDraft((d) => ({ ...d, variants: d.variants.filter((_, x) => x !== i) }))

  const duplicateRow = (i: number) =>
    setDraft((d) => {
      const src = d.variants[i]
      const copy: VariantDraft = { ...src, id: undefined, code: '', barcode: '', stock: 0 }
      const next = [...d.variants]
      next.splice(i + 1, 0, copy)
      return { ...d, variants: next }
    })

  /** سایز×رنگ → ردیف‌های جدید با قیمت ردیف اول. کد/بارکد خودکار (خالی). */
  const buildMatrix = () => {
    const sizes = sizesRaw.split(/[,،\s]+/).map((s) => s.trim()).filter(Boolean)
    const colors = colorsRaw.split(/[,،]+/).map((s) => s.trim()).filter(Boolean)
    if (!sizes.length && !colors.length) return setErr('برای تولید ترکیبی، حداقل سایزها یا رنگ‌ها را وارد کنید')
    const base = draft.variants[0] ?? emptyVariant()
    const rows: VariantDraft[] = []
    const sList = sizes.length ? sizes : ['']
    const cList = colors.length ? colors : ['']
    for (const s of sList)
      for (const c of cList)
        rows.push({
          ...emptyVariant(),
          size: s,
          color: c,
          salePrice: base.salePrice,
          purchasePrice: base.purchasePrice,
          ledgerAccountCode: base.ledgerAccountCode
        })
    // ردیف‌های موجود (ذخیره‌شده) حفظ می‌شوند، ردیف‌های خالی جدید جایگزین
    setDraft((d) => ({ ...d, variants: [...d.variants.filter((v) => v.id), ...rows] }))
    setErr(null)
    setSizesRaw('')
    setColorsRaw('')
  }

  const totals = useMemo(() => {
    const n = draft.variants.length
    const stock = draft.variants.reduce((s, v) => s + Math.round(v.stock ?? 0), 0)
    const changed = draft.variants.filter(
      (v) => !v.id || Math.round(v.stock ?? 0) !== (baseStock[v.id] ?? 0)
    ).length
    return { n, stock, changed }
  }, [draft.variants, baseStock])

  /** تعداد واریانت‌های موجودی که قیمت فروش/خرید یا موجودی‌شان نسبت به لحظه‌ی باز شدن فرم عوض شده. */
  const sensitiveRows = useMemo(
    () =>
      draft.variants.filter((v) => {
        if (!v.id) return false
        const base = basePrice[v.id]
        return (
          (!!base && (Number(v.salePrice || 0) !== base.sale || Number(v.purchasePrice || 0) !== base.purchase)) ||
          Number(v.stock ?? 0) !== (baseStock[v.id] ?? 0)
        )
      }).length,
    [draft.variants, basePrice, baseStock]
  )
  // fail-closed: تا سیاست قفل خوانده نشده، رمز *لازم* فرض می‌شود
  const needPassword = (sensitiveRows > 0 || serverAskedPw) && (!loaded || lockEnabled)

  const validate = (): string | null => {
    if (!draft.name.trim()) return 'نام کالا الزامی است'
    if (!draft.variants.length) return 'حداقل یک واریانت لازم است'
    for (const [i, v] of draft.variants.entries()) {
      const label = `ردیف ${faDigits(i + 1)}`
      if (v.salePrice < 0 || v.purchasePrice < 0) return `${label}: قیمت نمی‌تواند منفی باشد`
      if (v.code && !/^[0-9A-Za-z\-]+$/.test(v.code)) return `${label}: کد فقط حرف/عدد لاتین و «-»`
      if (v.barcode && !/^[0-9A-Za-z\-]+$/.test(v.barcode)) return `${label}: بارکد فقط حرف/عدد لاتین (Code128)`
      if (!Number.isFinite(Number(v.stock ?? 0))) return `${label}: موجودی باید عدد باشد`
    }
    const codes = draft.variants.map((v) => v.code.trim()).filter(Boolean)
    if (new Set(codes).size !== codes.length) return 'کد کالا در ردیف‌ها تکراری است'
    const bcs = draft.variants.map((v) => v.barcode.trim()).filter(Boolean)
    if (new Set(bcs).size !== bcs.length) return 'بارکد در ردیف‌ها تکراری است'
    const combos = draft.variants.map((v) => `${v.size.trim()}|${v.color.trim()}`)
    if (new Set(combos).size !== combos.length) return 'ترکیب سایز/رنگ تکراری است'
    return null
  }

  const doSave = async (patch?: { reportLiveName?: boolean }) => {
    setWarn(null)
    setAskLiveName(false)
    setBusy(true)
    const reportLiveName = patch?.reportLiveName ?? draft.reportLiveName
    if (patch?.reportLiveName != null) setDraft((d) => ({ ...d, reportLiveName: patch.reportLiveName! }))
    try {
      await call(CH.productUpsert, {
        id: draft.id,
        // نشست ۱۴۶ — main فقط برای تغییر قیمت/موجودی واریانت موجود رمز می‌خواهد
        managerPassword: password.trim() || null,
        name: draft.name.trim(),
        categoryId: draft.categoryId,
        unit: draft.unit || 'عدد',
        note: draft.note.trim() || null,
        reportLiveName: reportLiveName === true,
        variants: draft.variants.map((v) => ({
          id: v.id,
          code: v.code.trim() || undefined,
          barcode: v.barcode.trim() || undefined,
          size: v.size.trim() || null,
          color: v.color.trim() || null,
          salePrice: Number(v.salePrice || 0),
          purchasePrice: Number(v.purchasePrice || 0),
          // واریانت جدید: موجودی اولیه (INITIAL). واریانت موجود: فقط اگر کاربر
          // واقعاً عوضش کرده (ADJUSTMENT)؛ دست‌نخورده ⇒ undefined = «دست نزن» (نشست ۱۴۶).
          // نشست ۱۴۴ — بدون گرد بی‌صدا؛ main اعشار/متن را با پیام فارسی رد می‌کند.
          stock: v.id && Number(v.stock ?? 0) === (baseStock[v.id] ?? 0) ? undefined : Number(v.stock ?? 0),
          ledgerAccountCode: v.ledgerAccountCode.trim() || null
        }))
      })
      setPassword('')
      onSaved(isEdit ? `کالای «${draft.name}» ویرایش شد` : `کالای «${draft.name}» با ${faDigits(draft.variants.length)} واریانت ثبت شد`)
    } catch (e: any) {
      if (String(e?.message ?? '').includes('تأیید مدیر')) setServerAskedPw(true)
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * ذخیره بدون هیچ مانع اضافه. تنها حالتی که هشدار می‌گیرد، موجودی منفی است؛
   * آن هم فقط «آگاه‌سازی» است: با تایید، ذخیره انجام می‌شود.
   */
  const save = () => {
    const bad = validate()
    if (bad) return setErr(bad)
    if (needPassword && !password.trim())
      return setErr(
        'تغییر قیمت یا موجودی کالای ثبت‌شده تأیید مدیر لازم دارد؛ رمز مدیر (یا رمز دوم پنل کالاها) را پایین فرم وارد کنید.'
      )
    setErr(null)
    const neg = draft.variants.filter((v) => Math.round(v.stock ?? 0) < 0)
    if (neg.length) {
      setWarn(
        `موجودی ${faDigits(neg.length)} ردیف منفی است. موجودی منفی معمولاً نشانه‌ی جا افتادن یک فاکتور خرید است و ممکن است گزارش‌های انبار را گمراه‌کننده کند. سابقه‌ی این تغییر در گردش انبار ثبت می‌شود.`
      )
      return
    }
    const nameChanged = isEdit && draft.name.trim() !== openedName.trim()
    if (nameChanged && !draft.reportLiveName) {
      setAskLiveName(true)
      return
    }
    void doSave()
  }

  /** Esc: اگر هشدار باز است فقط هشدار بسته شود، نه کل فرم (داده از دست نرود). */
  const closeGuarded = () => {
    if (warn) return setWarn(null)
    if (askLiveName) return setAskLiveName(false)
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title={isEdit ? 'ویرایش کالا' : 'کالای جدید'}
        onClose={closeGuarded}
        width="max-w-6xl"
        footer={
          <>
            <button className="btn" onClick={closeGuarded} disabled={busy}>
              انصراف <span className="keycap">Esc</span>
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-5">
            <div className="mb-1">نام کالا</div>
            <input
              className="inp"
              autoFocus
              value={draft.name}
              placeholder="مثلاً شلوار نیم‌بگ کتان"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <label className="col-span-3">
            <div className="mb-1">گروه کالا</div>
            <select
              className="inp"
              value={draft.categoryId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">بدون گروه</option>
              {/* ترتیب و عمق از category:tree می‌آید که حالا واقعاً درختی مرتب
                  است: هر ریشه و بلافاصله بعدش زیردسته‌های خودش. قبلاً کل لیست
                  فقط الفبایی مرتب می‌شد و یک زیردسته زیر والد اشتباه دیده می‌شد. */}
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(Math.max(0, c.depth ?? (c.parentId ? 1 : 0)))}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            <div className="mb-1">واحد</div>
            <select className="inp" value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            <div className="mb-1">تعداد واریانت</div>
            <div className="inp bg-slate-50">{faDigits(totals.n)}</div>
          </label>
          <label className="col-span-12 flex items-start gap-2 mt-1 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!draft.reportLiveName}
              onChange={(e) => setDraft((d) => ({ ...d, reportLiveName: e.target.checked }))}
            />
            <span>
              <div>در گزارش فروش آخرین نام کالا را نشان بده</div>
              <div className="kbd leading-6">
                پیش‌فرض خاموش است: گزارش همان نام روز فروش را نگه می‌دارد. فیش چاپی همیشه نام روز فروش
                است، حتی اگر این تیک روشن باشد.
              </div>
            </span>
          </label>
          <label className="col-span-10">
            <div className="mb-1">توضیح</div>
            <input className="inp" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
          </label>
          {/* جمع زنده‌ی ستون موجودی (فقط نمایشی؛ ورودی در جدول است) */}
          <label className="col-span-2" title="جمع موجودی همه‌ی واریانت‌های این کالا (فقط نمایشی)">
            <div className="mb-1">مجموع موجودی</div>
            <div className="inp bg-emerald-50 border-emerald-300 font-bold text-emerald-800">
              {faDigits(totals.stock)}
            </div>
          </label>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded p-2 flex flex-wrap items-end gap-2">
          <div className="font-bold">تولید ترکیبی:</div>
          <label>
            <div className="mb-1 kbd">سایزها (با کاما)</div>
            <input className="inp w-56" placeholder="38, 40, 42" value={sizesRaw} onChange={(e) => setSizesRaw(e.target.value)} />
          </label>
          <label>
            <div className="mb-1 kbd">رنگ‌ها (با کاما)</div>
            <input className="inp w-56" placeholder="مشکی، سرمه‌ای" value={colorsRaw} onChange={(e) => setColorsRaw(e.target.value)} />
          </label>
          <button className="btn" onClick={buildMatrix} type="button">
            ساخت ردیف‌ها
          </button>
          <div className="kbd">قیمت‌ها از ردیف اول کپی می‌شود · کد و بارکد خودکار ساخته می‌شوند</div>
        </div>

        <div className="overflow-auto max-h-[45vh] border border-slate-200 rounded">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>کد کالا</th>
                <th>بارکد</th>
                <th>سایز</th>
                <th>رنگ</th>
                <th>فروش نقدی (ریال)</th>
                <th>خرید نقدی (ریال)</th>
                <th>کد حساب تفصیلی</th>
                <th>موجودی</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.variants.map((v, i) => {
                const base = v.id ? baseStock[v.id] ?? 0 : 0
                const delta = Math.round(v.stock ?? 0) - base
                return (
                  <tr key={v.id ?? `new-${i}`}>
                    <td>{faDigits(i + 1)}</td>
                    <td className="w-28">
                      <input className="inp py-0.5" placeholder="خودکار" value={v.code} onChange={(e) => setV(i, { code: e.target.value })} />
                    </td>
                    <td className="w-40">
                      <input className="inp py-0.5" placeholder="خودکار" value={v.barcode} onChange={(e) => setV(i, { barcode: e.target.value })} />
                    </td>
                    <td className="w-24">
                      <input className="inp py-0.5" value={v.size} onChange={(e) => setV(i, { size: e.target.value })} />
                    </td>
                    <td className="w-28">
                      <input className="inp py-0.5" value={v.color} onChange={(e) => setV(i, { color: e.target.value })} />
                    </td>
                    <td className="w-32">
                      <input
                        type="number"
                        className="inp py-0.5"
                        value={v.salePrice}
                        onChange={(e) => setV(i, { salePrice: +e.target.value })}
                      />
                      <div className="kbd">{money(v.salePrice)}</div>
                    </td>
                    <td className="w-32">
                      <input
                        type="number"
                        className="inp py-0.5"
                        value={v.purchasePrice}
                        onChange={(e) => setV(i, { purchasePrice: +e.target.value })}
                      />
                    </td>
                    <td className="w-28">
                      <input className="inp py-0.5" value={v.ledgerAccountCode} onChange={(e) => setV(i, { ledgerAccountCode: e.target.value })} />
                    </td>
                    {/* موجودی: در هر دو حالت جدید و ویرایش، مستقیماً قابل تایپ */}
                    <td className="w-24">
                      <input
                        type="number"
                        className="inp py-0.5 text-center"
                        value={v.stock ?? 0}
                        onChange={(e) => setV(i, { stock: +e.target.value })}
                        title={v.id ? 'اختلاف با موجودی فعلی به‌عنوان حرکت اصلاح ثبت می‌شود' : 'موجودی اولیه‌ی این واریانت'}
                      />
                      {v.id ? (
                        delta !== 0 ? (
                          <div className={`kbd ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            فعلی {faDigits(base)} · {delta > 0 ? '+' : '−'}
                            {faDigits(Math.abs(delta))}
                          </div>
                        ) : (
                          <div className="kbd">فعلی {faDigits(base)}</div>
                        )
                      ) : (
                        <div className="kbd">موجودی اولیه</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <button className="text-brand" type="button" onClick={() => duplicateRow(i)} title="تکثیر ردیف">
                        تکثیر
                      </button>
                      {!v.id && (
                        <button className="text-red-500 ms-2" type="button" onClick={() => removeRow(i)}>
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={8}>مجموع موجودی</td>
                <td className="text-center">{faDigits(totals.stock)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn" type="button" onClick={addRow}>
            افزودن ردیف
          </button>
          <div className="kbd">
            موجودی را همین‌جا وارد یا ویرایش کنید؛ با ذخیره، برای هر تغییر یک حرکت انبار ثبت می‌شود
            (واریانت جدید: «موجودی اولیه» · واریانت موجود: «اصلاح از فرم کالا»). فاکتور خرید و
            انبارگردانی همچنان سر جای خودشان هستند، ولی اجباری نیستند.
            {totals.changed > 0 && isEdit ? ` — ${faDigits(totals.changed)} ردیف تغییر موجودی دارد.` : ''}
          </div>
        </div>

        {needPassword && (
          <div className="rounded p-2 border-2 bg-amber-50 border-amber-300 flex flex-wrap items-end gap-3">
            <label className="block w-72">
              <div className="mb-1">رمز مدیر (یا رمز دوم پنل کالاها)</div>
              <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className="kbd leading-6 flex-1">
              {sensitiveRows > 0
                ? `قیمت یا موجودی ${faDigits(sensitiveRows)} واریانت ثبت‌شده عوض شده است. `
                : 'سرور برای این ذخیره تأیید خواست (قیمت یا موجودی در این فاصله جای دیگری عوض شده است). '}
              تغییر قیمت و اصلاح موجودی کار «فقط مدیر» است؛ سرور رمز را خودش می‌سنجد و نوع تأیید همراه نام کارمند نشست
              در سابقه ثبت می‌شود. ثبت کالای تازه یا ویرایش نام/مشخصات رمز نمی‌خواهد.
            </div>
          </div>
        )}
        {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
      </Modal>

      <ConfirmDialog
        open={!!warn}
        title="موجودی منفی می‌شود"
        message={
          <>
            <div>{warn}</div>
            <div className="font-bold">آیا مطمئن هستید که می‌خواهید همین حالا ذخیره شود؟</div>
          </>
        }
        busy={busy}
        onConfirm={() => {
          setWarn(null)
          const nameChanged = isEdit && draft.name.trim() !== openedName.trim()
          if (nameChanged && !draft.reportLiveName) {
            setAskLiveName(true)
            return
          }
          void doSave()
        }}
        onCancel={() => setWarn(null)}
      />
      <ConfirmDialog
        open={askLiveName}
        title="تغییر نام کالا"
        message={
          <>
            <div>
              نام کالا عوض شد. در گزارش‌های فروش هم اسم جدید نشان داده شود؟ فیش‌های چاپ‌شده همان نام روز
              فروش را نگه می‌دارند.
            </div>
            <div className="kbd">اگر بعداً پشیمان شدید، تیک را از فرم کالا خاموش کنید.</div>
          </>
        }
        confirmLabel="بله، در گزارش هم اسم جدید"
        cancelLabel="نه، گزارش همان اسم فیش"
        busy={busy}
        onConfirm={() => void doSave({ reportLiveName: true })}
        onCancel={() => void doSave({ reportLiveName: false })}
      />
    </>
  )
}
