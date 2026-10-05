import { useEffect, useMemo, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
import { faDigits, toLatinDigits } from '@shared/jalali'

export interface Party {
  id: number
  code: string
  name: string
  phone?: string | null
  address?: string | null
  isDefault?: boolean
}

/**
 * انتخاب «تامین‌کننده» (فاکتور خرید) یا «مشتری/خریدار» (فاکتور فروش عمده)
 * با جستجوی زنده + ثبت سریع شخص جدید در همان فرم.
 * IPC: customer:list / customer:create / supplier:list / supplier:create
 */
/**
 * `scope` (مورد ۶) — فقط برای kind = 'customer' معنا دارد:
 *   'wholesale' = فهرست و ثبت سریع، *فقط مشتریان عمده* (به‌علاوه‌ی «مشتری
 *                 عمومی»). مشتری‌های تکیِ پنل فروش این‌جا دیده نمی‌شوند و هر
 *                 مشتری‌ای که از همین‌جا ثبت شود با برچسب «عمده» ذخیره می‌گردد.
 *   'all'       = رفتار قبلی و پیش‌فرض (همه‌ی مشتریان).
 */
export default function PartyPicker({
  kind,
  value,
  onChange,
  label,
  scope = 'all',
  onDraftChange
}: {
  kind: 'customer' | 'supplier'
  value: Party | null
  onChange: (p: Party | null) => void
  label?: string
  scope?: 'all' | 'wholesale' | 'retail'
  /** نام تایپ‌شده روی فاکتور خرید، حتی قبل از Enter — تا ذخیره خودش ردیف فهرست بسازد */
  onDraftChange?: (name: string) => void
}) {
  const channels = useMemo(
    () =>
      kind === 'supplier'
        ? { list: CH.supplierList, create: CH.supplierCreate }
        : { list: CH.customerList, create: CH.customerCreate },
    [kind]
  )
  const title = label ?? (kind === 'supplier' ? 'تامین‌کننده' : 'خریدار')

  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Party[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newParty, setNewParty] = useState({ name: '', phone: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const t = window.setTimeout(() => {
      call<Party[]>(channels.list, kind === 'customer' && scope !== 'all' ? { search: q, kind: scope } : { search: q })
        .then((r) => alive && setRows(r))
        .catch((e: any) => alive && setErr(e.message))
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q, open, channels.list, kind, scope])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (p: Party | null) => {
    onChange(p)
    onDraftChange?.('')
    setQ('')
    setOpen(false)
    setErr(null)
  }

  const commitTyped = async () => {
    const typed = q.trim()
    if (!typed) {
      pick(null)
      return
    }
    const key = toLatinDigits(typed)
    const hit = rows.find((r) => String(r.code) === key) || rows.find((r) => r.name === typed)
    if (hit) {
      pick(hit)
      return
    }
    if (kind !== 'supplier') return
    setBusy(true)
    try {
      const created = await call<Party>(CH.supplierEnsure, { name: typed })
      pick(created)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const quickCreate = async () => {
    if (!newParty.name.trim()) return setErr('نام الزامی است')
    try {
      const created = await call<Party>(channels.create, {
        name: newParty.name.trim(),
        phone: newParty.phone.trim() || null,
        // مشتری ثبت‌شده از پنل عمده، «مشتری عمده» علامت می‌خورد (مورد ۶)
        ...(kind === 'customer' && scope === 'wholesale' ? { isWholesale: true } : {})
      })
      setErr(null)
      setAdding(false)
      setNewParty({ name: '', phone: '' })
      pick(created)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="relative" ref={box}>
      <div className="mb-1">{title}</div>
      <div className="flex gap-1">
        {kind === 'supplier' ? (
          <input
            className="inp text-right"
            value={value && !open ? `${faDigits(value.code)} — ${value.name}` : q}
            placeholder="نام را بنویسید یا شماره میان‌بر (۱)"
            onFocus={() => {
              setOpen(true)
              if (value) setQ('')
            }}
            onChange={(e) => {
              if (value) onChange(null)
              setQ(e.target.value)
              onDraftChange?.(e.target.value)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              void commitTyped()
            }}
          />
        ) : (
          <button type="button" className="inp text-right truncate" onClick={() => setOpen((o) => !o)}>
            {value ? `${faDigits(value.code)} — ${value.name}` : <span className="text-slate-400">انتخاب {title}…</span>}
          </button>
        )}
        {value && (
          <button type="button" className="btn px-2" title="حذف انتخاب" onClick={() => pick(null)}>
            ✕
          </button>
        )}
      </div>
      {kind === 'supplier' ? (
        <div className="kbd leading-5 mt-1">
          نام را همین‌جا بنویسید؛ اگر تازه باشد با Enter یا ذخیرهٔ فاکتور خودش به فهرست اضافه می‌شود. عدد = میان‌بر.
        </div>
      ) : null}

      {open && (
        <div className="absolute z-30 mt-1 w-80 bg-white border border-slate-300 rounded shadow-lg p-2 space-y-2">
          {kind !== 'supplier' ? (
            <input
              className="inp"
              autoFocus
              placeholder="جستجو بر اساس نام، کد یا تلفن"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
          <div className="max-h-48 overflow-auto border rounded">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full text-right px-2 py-1 hover:bg-brand/10"
                onClick={() => pick(r)}
              >
                {faDigits(r.code)} — {r.name}
                {r.phone ? <span className="kbd"> · {faDigits(r.phone)}</span> : null}
              </button>
            ))}
            {!rows.length && (
              <div className="text-center text-slate-400 py-3">
                {kind === 'supplier' && q.trim()
                  ? busy
                    ? 'در حال ثبت…'
                    : 'در فهرست نیست — Enter یعنی ردیف تازه'
                  : 'موردی پیدا نشد'}
              </div>
            )}
          </div>

          {kind === 'supplier' ? null : adding ? (
            <div className="space-y-2 border-t pt-2">
              <input
                className="inp"
                placeholder={`نام ${title} جدید`}
                value={newParty.name}
                onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                className="inp"
                placeholder="تلفن (اختیاری)"
                value={newParty.phone}
                onChange={(e) => setNewParty((p) => ({ ...p, phone: e.target.value }))}
              />
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={quickCreate}>
                  ثبت
                </button>
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  انصراف
                </button>
              </div>
              <div className="kbd">کد به‌صورت خودکار ساخته می‌شود</div>
            </div>
          ) : (
            <div className="space-y-1">
              <button type="button" className="btn w-full" onClick={() => setAdding(true)}>
                + ثبت سریع {title} جدید
              </button>
              {kind === 'customer' && scope === 'wholesale' && (
                <div className="kbd leading-5">
                  این فهرست فقط «مشتریان عمده» را نشان می‌دهد؛ مشتری‌های پنل فروش تکی این‌جا نمی‌آیند. مشتری‌ای که
                  از همین‌جا ثبت شود، در پنل مشتریانِ تنظیمات با برچسب «عمده» جدا دیده می‌شود.
                </div>
              )}
            </div>
          )}

          {err && <div className="bg-amber-100 border border-amber-300 rounded px-2 py-1">{err}</div>}
        </div>
      )}
    </div>
  )
}
