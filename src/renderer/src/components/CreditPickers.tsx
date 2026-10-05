import { useCallback, useEffect, useMemo, useState } from 'react'
import { call, CH } from '../lib/api'
import AllProductsModal from './AllProductsModal'
import VariantSearchBox from './VariantSearchBox'
import PartyPicker, { type Party } from './PartyPicker'
import { faDigits } from '@shared/jalali'
import { CREDIT_SCOPE_OPTIONS, cleanIds, describeRestrictions } from '@shared/creditUi'
import { CreditRestrictScope } from '@shared/credit'

/**
 * ===========================================================================
 * انتخابگرهای ماژول «مدیریت اعتبار خرید» (جلسه ۲۸).
 *
 * چرا این فایل ساخته شد: تا جلسه ۲۷ کل صفحه‌ی `CreditManagement.tsx` در ۲۲۵ خطِ
 * JSXِ یک‌خطیِ فشرده بود و همین باعث شده بود سه جلسه پشت هم فیلدهای §۱۲/§۱۸/§۲۲
 * «اضافه نشوند» — نه چون سخت بودند، بلکه چون جا نبود و هیچ خطی قابل بازبینی
 * نبود. پس فرم‌ها به دو فایل تازه آمدند (توصیه‌ی معماری هندآف جلسه ۲۷).
 *
 * ⚠️ اینجا هیچ «تصمیمی» نیست: هر تصمیمی که شکل Payload یا قاعده‌ی نمایش را
 * عوض کند در `@shared/creditUi.ts` نشسته است و در
 * `test/credit-ui-logic-session28.ts` واقعاً اجرا و تست می‌شود. این فایل فقط
 * همان تصمیم‌ها را *نشان* می‌دهد و ورودی کاربر را به آن‌ها می‌دهد.
 *
 * دو انتخابگر اصلی، هر دو با همان اجزای موجود پروژه (چیز تازه‌ای ساخته نشد):
 *   • دسته‌بندی  ⇒ `category:tree` (همان الگوی PriceAdjust.tsx)
 *   • کالا       ⇒ `VariantSearchBox` + `AllProductsModal` (همان الگوی POS)
 * ===========================================================================
 */

interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  depth: number
}

/* ---------------------------------------------------------------------------
 * فیلدهای کوچک و تکرارشونده — تا JSX فرم‌ها خوانا بماند
 * ------------------------------------------------------------------------ */

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  ltr = false
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  ltr?: boolean
}) {
  return (
    <label className="block">
      <span>{label}</span>
      <input
        className="inp"
        dir={ltr ? 'ltr' : undefined}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="kbd">{hint}</span>}
    </label>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  hint,
  disabled = false
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span>{label}</span>
      <input
        className={`inp ${disabled ? 'bg-slate-100' : ''}`}
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        // نشست ۱۵۰ — مقدار خام؛ اعشار دیگر بی‌صدا گرد نمی‌شود و سرور با پیام فارسی رد می‌کند
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      {hint && <span className="kbd">{hint}</span>}
    </label>
  )
}

export function CheckField({
  label,
  checked,
  onChange,
  hint
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer py-1">
      <input type="checkbox" className="w-4 h-4 mt-1" checked={checked === true} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="kbd block">{hint}</span>}
      </span>
    </label>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  hint?: string
}) {
  return (
    <label className="block">
      <span>{label}</span>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="kbd">{hint}</span>}
    </label>
  )
}

/* ---------------------------------------------------------------------------
 * چندانتخابی دسته‌بندی (§۱۸)
 * ------------------------------------------------------------------------ */

export function CategoryMultiPicker({
  value,
  onChange
}: {
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [cats, setCats] = useState<CategoryNode[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const picked = useMemo(() => cleanIds(value), [value])

  useEffect(() => {
    void (async () => {
      try {
        setCats((await call<CategoryNode[]>(CH.categoryTree)) ?? [])
      } catch (e: any) {
        setErr(e.message)
      }
    })()
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim()
    if (!needle) return cats
    return cats.filter((c) => c.name.includes(needle))
  }, [cats, q])

  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const nameOf = (id: number) => cats.find((c) => c.id === id)?.name ?? `#${id}`

  return (
    <div className="border rounded p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <b>دسته‌بندی‌های مجاز</b>
        <input className="inp w-48 py-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی دسته" />
        <span className="kbd">
          {faDigits(picked.length)} دسته انتخاب شده · زیردسته‌ها هم خودکار مجاز می‌شوند (سنجش اجدادِ دسته در Backend)
        </span>
        {!!picked.length && (
          <button className="btn py-1" onClick={() => onChange([])}>
            پاک‌کردن انتخاب
          </button>
        )}
      </div>
      {err && <div className="bg-rose-50 border border-rose-300 rounded p-2">{err}</div>}
      {!!picked.length && (
        <div className="flex gap-1 flex-wrap">
          {picked.map((id) => (
            <button key={id} className="btn py-0.5 text-xs" onClick={() => toggle(id)} title="حذف از فهرست">
              {nameOf(id)} ✕
            </button>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-auto border rounded">
        {shown.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>
              {'\u00A0'.repeat(c.depth * 3)}
              {c.depth ? '↳ ' : ''}
              {c.name}
            </span>
          </label>
        ))}
        {!shown.length && <div className="kbd p-2">دسته‌بندی‌ای پیدا نشد.</div>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * چندانتخابی کالا (§۱۸)
 *
 * ⚠️ نام فیلد در Draft عمداً `restrictVariantIds` است (واریانت، نه محصول):
 * اعتبار روی همان ردیف انباری‌ای قابل مصرف است که فروخته می‌شود.
 * ------------------------------------------------------------------------ */

export function VariantMultiPicker({
  value,
  onChange
}: {
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [names, setNames] = useState<Record<number, string>>({})
  const [allOpen, setAllOpen] = useState(false)
  const picked = useMemo(() => cleanIds(value), [value])

  const add = useCallback(
    (v: any) => {
      if (!v?.id) return
      const id = Math.round(Number(v.id))
      const label = `${v.product?.name ?? v.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`.trim()
      setNames((n) => ({ ...n, [id]: label || `#${id}` }))
      onChange(picked.includes(id) ? picked : [...picked, id])
    },
    [onChange, picked]
  )

  const remove = (id: number) => onChange(picked.filter((x) => x !== id))

  return (
    <div className="border rounded p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <b>کالاهای مجاز</b>
        <span className="kbd">{faDigits(picked.length)} کالا انتخاب شده</span>
        <button className="btn py-1" onClick={() => setAllOpen(true)}>
          انتخاب از فهرست همه کالاها
        </button>
        {!!picked.length && (
          <button className="btn py-1" onClick={() => onChange([])}>
            پاک‌کردن انتخاب
          </button>
        )}
      </div>
      <VariantSearchBox onPick={add} placeholder="کد، بارکد یا نام کالا را برای افزودن به دامنه‌ی اعتبار وارد کنید" showAllButton={false} />
      {!!picked.length && (
        <div className="flex gap-1 flex-wrap">
          {picked.map((id) => (
            <button key={id} className="btn py-0.5 text-xs" onClick={() => remove(id)} title="حذف از فهرست">
              {names[id] ?? `#${faDigits(id)}`} ✕
            </button>
          ))}
        </div>
      )}
      <AllProductsModal open={allOpen} onClose={() => setAllOpen(false)} onPick={add} title="انتخاب کالاهای مجاز این اعتبار" />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * دامنه‌ی مصرف: همه / دسته‌بندی / کالا (§۱۸)
 * ------------------------------------------------------------------------ */

export function ScopePicker({
  scope,
  categoryIds,
  variantIds,
  onChange,
  minPurchase,
  maxPerTransaction
}: {
  scope: string
  categoryIds: number[]
  variantIds: number[]
  onChange: (patch: Record<string, unknown>) => void
  minPurchase: number
  maxPerTransaction: number
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <SelectField
          label="دامنه‌ی مصرف اعتبار"
          value={scope}
          onChange={(v) => onChange({ restrictScope: v })}
          options={CREDIT_SCOPE_OPTIONS}
          hint="محدودیت در Backend اعمال می‌شود، نه فقط در UI."
        />
        <NumberField
          label="حداقل مبلغ خرید (ریال)"
          value={minPurchase}
          onChange={(v) => onChange({ minPurchase: v })}
          hint="۰ = بدون حداقل"
        />
        <NumberField
          label="سقف مصرف در هر تراکنش (ریال)"
          value={maxPerTransaction}
          onChange={(v) => onChange({ maxPerTransaction: v })}
          hint="۰ = بدون سقف"
        />
      </div>
      {scope === CreditRestrictScope.CATEGORY && (
        <CategoryMultiPicker value={categoryIds} onChange={(ids) => onChange({ restrictCategoryIds: ids })} />
      )}
      {scope === CreditRestrictScope.VARIANTS && (
        <VariantMultiPicker value={variantIds} onChange={(ids) => onChange({ restrictVariantIds: ids })} />
      )}
      <div className="kbd bg-slate-50 border rounded p-2">
        خلاصه‌ی این محدودیت: {describeRestrictions({ restrictScope: scope, restrictCategoryIds: categoryIds, restrictVariantIds: variantIds, minPurchase, maxPerTransaction })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * بلوک گیرنده (§۱۲) — هیچ فیلدی اجباری نیست
 * ------------------------------------------------------------------------ */

export function HolderFields({
  value,
  onChange,
  party,
  setParty,
  showOptOut = true
}: {
  value: any
  onChange: (patch: Record<string, unknown>) => void
  party: Party | null
  setParty: (p: Party | null) => void
  showOptOut?: boolean
}) {
  return (
    <div className="border rounded p-2 space-y-2">
      <b>گیرنده‌ی اعتبار (شخص / شرکت / سازمان)</b>
      <PartyPicker
        kind="customer"
        value={party}
        onChange={(p) => {
          setParty(p)
          onChange({
            customerId: p?.id ?? null,
            customerName: p?.name ?? '',
            holderPhone: p?.phone ?? value?.holderPhone ?? ''
          })
        }}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <TextField label="نام دارنده" value={value?.customerName ?? ''} onChange={(v) => onChange({ customerName: v })} />
        <TextField label="شرکت / سازمان" value={value?.holderCompany ?? ''} onChange={(v) => onChange({ holderCompany: v })} />
        <TextField label="شناسه ملی / کد ملی" value={value?.holderNationalId ?? ''} onChange={(v) => onChange({ holderNationalId: v })} ltr />
        <TextField label="تلفن" value={value?.holderPhone ?? ''} onChange={(v) => onChange({ holderPhone: v })} ltr hint="تلفن مبنای یادآوری است؛ بدون آن یادآوری ممکن نیست." />
        <TextField label="نماینده / تحویل‌گیرنده" value={value?.holderAgent ?? ''} onChange={(v) => onChange({ holderAgent: v })} />
        <TextField label="آدرس" value={value?.holderAddress ?? ''} onChange={(v) => onChange({ holderAddress: v })} />
      </div>
      <TextField label="توضیح دارنده" value={value?.holderNote ?? ''} onChange={(v) => onChange({ holderNote: v })} />
      <CheckField
        label="فقط برای همین مشتری قابل مصرف باشد"
        checked={value?.customerLocked === true}
        onChange={(v) => onChange({ customerLocked: v })}
        hint="بدون انتخاب مشتری، این قفل عملاً بی‌اثر است."
      />
      {showOptOut && (
        <CheckField
          label="این مشتری پیام یادآوری نمی‌خواهد (Opt-out)"
          checked={value?.reminderOptOut === true}
          onChange={(v) => onChange({ reminderOptOut: v })}
        />
      )}
    </div>
  )
}
