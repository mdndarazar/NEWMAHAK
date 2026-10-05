import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import PasswordField from '../components/PasswordField'
import { faDigits, money } from '@shared/jalali'
import {
  CHARGE_KINDS,
  CHARGE_SCOPES,
  CHARGE_KIND_LABELS,
  CHARGE_SCOPE_LABELS,
  chargeTitle,
  describeChargeRule,
  parseCategoryCharge,
  resolveChargeRule,
  type CategoryChargeConfig,
  type CategoryChargeRule,
  type ChargeFallback,
  type ChargeKind,
  type ChargeMode,
  type ChargeScope
} from '@shared/charges'

/**
 * ============== «عوارض و مالیات» و «حق سرویس» — چهار زیرپنل ==============
 * یک صفحه، چهار کاربرد (prop های `kind` و `scope`):
 *
 *   عوارض و مالیات · پنل فروش      → charges.tax.pos
 *   حق سرویس · پنل فروش            → charges.service.pos
 *   عوارض و مالیات · فاکتور عمده   → charges.tax.wholesale
 *   حق سرویس · فاکتور عمده         → charges.service.wholesale
 *
 * چهار مقدار کاملاً مستقل‌اند: تغییر در تنظیمات پنل فروش، هیچ اثری روی فاکتور
 * فروش عمده ندارد و برعکس. با تب‌های بالای صفحه بین این چهار جابه‌جا می‌شوید.
 *
 * برای هر دسته یا زیردسته‌ی کالا می‌توانید یک مقدار تعیین کنید:
 *   • مبلغ ثابت (ریال) برای هر عدد کالا — مثلاً ۵۰٬۰۰۰ ریال روی هر شلوار.
 *   • یا درصد از قیمت کالا — مثلاً ۹٪.
 *
 * ارث‌بری: مقداری که روی «مردانه» بگذارید، خودکار روی زیردسته‌هایش (مثل «شلوار
 * نیم‌بگ مردانه») هم اعمال می‌شود؛ مگر این‌که برای خود آن زیردسته مقدار جدا
 * تعیین کنید که در آن صورت مقدار خودش برنده است.
 *
 * «مقدار پیش‌فرض همه‌ی کالاها» (بالای جدول): برای کالایی که نه خودش و نه هیچ
 * دسته‌ی بالاسرش مقدار ندارد — مثلاً یک مالیات ۹٪ روی همه‌چیز، بدون این‌که
 * دسته‌به‌دسته وارد کنید. همین‌جا هم بود که تنظیم قدیمیِ «درصد سراسری» به آن
 * مهاجرت داده شد.
 *
 * نشست ۱۵۶ (S151-c2، بند ۴-۴۵): «۰» دقیقاً صفر است و از دسته‌ی بالاتر ارث نمی‌برد.
 * «تنظیم‌نشده» (ردیف بدون مقدار، دکمه‌ی «حذف مقدار») ⇒ ارث از والد/پیش‌فرض؛
 * «عمداً صفر» (دکمه‌ی «عمداً صفر» یا تایپ ۰) ⇒ همین دسته مبلغ صفر. تغییر فقط روی فاکتورهای *بعدی* اثر
 * دارد و فاکتورهای ثبت‌شده دست‌نخورده می‌مانند.
 *
 * IPC: category:tree · charges:get · charges:save
 * ==================================================================
 */

interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  depth: number
}

type Draft = Record<number, { mode: ChargeMode; value: number }>

const toDraft = (cfg: CategoryChargeConfig): Draft => {
  const draft: Draft = {}
  for (const r of cfg.rules) draft[r.categoryId] = { mode: r.mode, value: r.value }
  return draft
}

const toConfig = (draft: Draft, enabled: boolean, fallback: ChargeFallback | null): CategoryChargeConfig => ({
  enabled,
  fallback: fallback && fallback.value > 0 ? fallback : null,
  rules: Object.entries(draft)
    // نشست ۱۵۶ (بند ۴-۴۵): ردیف با مقدار ۰ = «عمداً صفر» و حذف نمی‌شود؛ «تنظیم‌نشده» = نبودِ ردیف
    .map(([id, v]) => ({ categoryId: Number(id), mode: v.mode, value: v.value }) as CategoryChargeRule)
})

/** مسیر هر زیرپنل در روتر (main.tsx) */
export const chargeRoute = (kind: ChargeKind, scope: ChargeScope) => `/charges/${kind}/${scope}`

export default function CategoryCharges({ kind, scope }: { kind: ChargeKind; scope: ChargeScope }) {
  const nav = useNavigate()
  const label = chargeTitle(kind, scope)
  const [cats, setCats] = useState<CategoryNode[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [enabled, setEnabled] = useState(true)
  const [fallback, setFallback] = useState<ChargeFallback | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [sample, setSample] = useState(1000000)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 8000)
  }

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const [tree, charges] = await Promise.all([call<CategoryNode[]>(CH.categoryTree), call<any>(CH.chargesGet)])
      const cfg = parseCategoryCharge(charges?.[scope]?.[kind])
      setCats(tree ?? [])
      setDraft(toDraft(cfg))
      setEnabled(cfg.enabled)
      setFallback(cfg.fallback)
      setDirty(false)
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [kind, scope])

  useEffect(() => {
    void load()
  }, [load])

  const config = useMemo(() => toConfig(draft, enabled, fallback), [draft, enabled, fallback])

  const setRow = (categoryId: number, patch: Partial<{ mode: ChargeMode; value: number }>) => {
    setDraft((p) => {
      const cur = p[categoryId] ?? { mode: 'FIXED' as ChargeMode, value: 0 }
      const next = { ...cur, ...patch }
      next.value = Math.max(0, next.mode === 'PERCENT' ? Math.min(100, next.value) : Math.round(next.value))
      return { ...p, [categoryId]: next }
    })
    setDirty(true)
  }

  const clearRow = (categoryId: number) => {
    setDraft((p) => {
      const next = { ...p }
      delete next[categoryId]
      return next
    })
    setDirty(true)
  }

  const clearAll = () => {
    setDraft({})
    setFallback(null)
    setDirty(true)
    flash(`همه‌ی مقدارهای «${label}» پاک شد (هیچ دسته‌ای مقدار ندارد)؛ برای اعمال، «ذخیره» را بزنید.`)
  }

  /** نشست ۱۵۵ (S151-c1) — سرور رمز پنل همین نوع/اسکوپ را می‌سنجد (قفل خاموش ⇒ بی‌رمز)؛ بعد از هر تلاش پاک می‌شود */
  const [chargePw, setChargePw] = useState('')
  const save = async () => {
    setBusy(true)
    try {
      const saved = await call<CategoryChargeConfig>(CH.chargesSave, { kind, scope, config, panelPassword: chargePw || undefined })
      const clean = parseCategoryCharge(saved)
      setDraft(toDraft(clean))
      setEnabled(clean.enabled)
      setFallback(clean.fallback)
      setDirty(false)
      flash(`«${label}» ذخیره شد و از همین حالا روی فاکتورهای جدید همین پنل اعمال می‌شود.`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setChargePw('')
      setBusy(false)
    }
  }

  /** مقدار مؤثر یک دسته (خودش، ارث‌برده از والد، یا مقدار پیش‌فرض) + مبلغ نمونه. */
  const effectiveOf = (categoryId: number) => {
    const rule = resolveChargeRule(config, categoryId, cats)
    const amount = !rule ? 0 : rule.mode === 'FIXED' ? rule.value : Math.round((sample * rule.value) / 100)
    // نشست ۱۵۶: ردیف صفر هم «مقدار خودِ دسته» است (عمداً صفر)
    const own = !!draft[categoryId]
    const inherited = !!rule && !own && rule.categoryId !== 0
    const fromFallback = !!rule && rule.categoryId === 0
    return { rule, amount, own, inherited, fromFallback }
  }

  const activeCount = config.rules.length

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">{label}</h1>
        {dirty && <span className="kbd text-amber-700 font-bold">تغییرات ذخیره نشده</span>}
        <div className="ms-auto flex gap-1 flex-wrap">
          <button className="btn" onClick={() => void load()} disabled={busy}>
            بازگردانی از دیتابیس
          </button>
          <button className="btn" onClick={clearAll} disabled={busy || (!activeCount && !fallback)}>
            صفر کردن همه
          </button>
          <div className="w-44" title="رمز مدیر یا رمز دوم همین پنل">
            <PasswordField value={chargePw} placeholder="رمز ذخیره" onChange={(e) => setChargePw(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>
      </div>

      {/* ---------- چهار زیرپنل مستقل ---------- */}
      <div className="bg-white rounded shadow p-2 flex flex-wrap gap-1 items-center">
        {CHARGE_SCOPES.map((sc) =>
          CHARGE_KINDS.map((kd) => {
            const active = kd === kind && sc === scope
            return (
              <button
                key={`${kd}-${sc}`}
                className={`btn ${active ? 'btn-primary' : ''}`}
                onClick={() => (active ? undefined : nav(chargeRoute(kd, sc)))}
                title={`${CHARGE_KIND_LABELS[kd]} برای ${CHARGE_SCOPE_LABELS[sc]}`}
              >
                {CHARGE_KIND_LABELS[kd]} · {CHARGE_SCOPE_LABELS[sc]}
              </button>
            )
          })
        )}
        <span className="kbd ms-auto">
          تنظیمات این چهار پنل کاملاً مستقل است؛ تغییر یکی روی آن یکی هیچ اثری ندارد.
        </span>
      </div>

      <div className="bg-white rounded shadow p-2 flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 font-bold">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
              setDirty(true)
            }}
          />
          {enabled ? `${label} فعال است` : `${label} کاملاً خاموش است`}
        </label>
        <span className="kbd">
          خاموش کردن این کلید، مقدارها را پاک نمی‌کند؛ فقط تا روشن شدن دوباره، روی هیچ فاکتوری اعمال نمی‌شود.
        </span>
        <label className="flex items-center gap-2 ms-auto">
          <span className="kbd whitespace-nowrap">قیمت نمونه برای محاسبه‌ی ستون آخر</span>
          <input
            type="number"
            min={0}
            className="inp w-36 py-1"
            value={sample}
            onChange={(e) => setSample(Math.max(0, +e.target.value || 0))}
          />
        </label>
        <span className="kbd">{faDigits(activeCount)} دسته مقدار دارد</span>
      </div>

      {/* ---------- مقدار پیش‌فرض همه‌ی کالاها ---------- */}
      <div className="bg-white rounded shadow p-2 flex flex-wrap gap-3 items-center">
        <span className="font-bold whitespace-nowrap">مقدار پیش‌فرض همه‌ی کالاها</span>
        <select
          className="inp w-48 py-1"
          value={fallback?.mode ?? 'PERCENT'}
          onChange={(e) => {
            const mode: ChargeMode = e.target.value === 'FIXED' ? 'FIXED' : 'PERCENT'
            setFallback((f) => ({ mode, value: f?.value ?? 0 }))
            setDirty(true)
          }}
        >
          <option value="PERCENT">درصد از قیمت کالا</option>
          <option value="FIXED">مبلغ ثابت (ریال) هر عدد</option>
        </select>
        <input
          type="number"
          min={0}
          max={fallback?.mode === 'FIXED' ? undefined : 100}
          className="inp w-32 py-1"
          value={fallback?.value ?? 0}
          onChange={(e) => {
            const raw = Math.max(0, +e.target.value || 0)
            const mode: ChargeMode = fallback?.mode ?? 'PERCENT'
            const value = mode === 'PERCENT' ? Math.min(100, raw) : Math.round(raw)
            setFallback(value > 0 ? { mode, value } : null)
            setDirty(true)
          }}
        />
        <span className="font-bold">{fallback?.mode === 'FIXED' ? 'ریال' : '٪'}</span>
        <span className="kbd">
          برای کالایی که نه خودش و نه هیچ دسته‌ی بالاسرش مقدار ندارد (یا اصلاً دسته‌بندی ندارد). صفر = خاموش.
        </span>
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

      <div className="tbl-card">
        <table className="tbl">
          <thead className="sticky top-0">
            <tr>
              <th>دسته‌بندی کالا</th>
              <th className="w-48">حالت</th>
              <th className="w-40">مقدار</th>
              <th className="w-28"></th>
              <th>مقدار مؤثر این دسته</th>
              <th>مبلغ روی قیمت نمونه</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => {
              const row = draft[c.id]
              const eff = effectiveOf(c.id)
              return (
                <tr key={c.id} className={eff.own ? 'bg-emerald-50/60' : ''}>
                  <td>
                    <span
                      style={{ paddingInlineStart: c.depth * 18 }}
                      className={c.depth ? 'text-slate-600' : 'font-bold'}
                    >
                      {c.depth ? '↳ ' : ''}
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <select
                      className="inp py-0.5"
                      value={row?.mode ?? 'FIXED'}
                      onChange={(e) => setRow(c.id, { mode: e.target.value === 'PERCENT' ? 'PERCENT' : 'FIXED' })}
                    >
                      <option value="FIXED">مبلغ ثابت (ریال)</option>
                      <option value="PERCENT">درصد از قیمت کالا</option>
                    </select>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={row?.mode === 'PERCENT' ? 100 : undefined}
                        className="inp py-0.5"
                        value={row ? row.value : ''}
                        placeholder="ارث"
                        onChange={(e) => setRow(c.id, { value: +e.target.value || 0 })}
                      />
                      <span className="font-bold whitespace-nowrap">{row?.mode === 'PERCENT' ? '٪' : 'ریال'}</span>
                    </div>
                  </td>
                  <td>
                    {row ? (
                      <button className="text-red-500" onClick={() => clearRow(c.id)} title="این دسته دوباره از دسته‌ی بالاتر یا مقدار پیش‌فرض ارث می‌برد">
                        حذف مقدار (ارث)
                      </button>
                    ) : (
                      <button className="text-slate-600" onClick={() => setRow(c.id, { value: 0 })} title="این دسته دقیقاً صفر می‌شود و از دسته‌ی بالاتر ارث نمی‌برد">
                        عمداً صفر
                      </button>
                    )}
                  </td>
                  <td
                    className={
                      eff.rule ? (eff.own ? 'font-bold text-emerald-800' : 'text-slate-600') : 'text-slate-400'
                    }
                  >
                    {eff.rule ? faDigits(describeChargeRule(eff.rule)) : 'بدون مقدار'}
                    {eff.inherited && <div className="kbd">ارث‌برده از دسته‌ی بالاتر</div>}
                    {eff.fromFallback && <div className="kbd">از مقدار پیش‌فرض همه‌ی کالاها</div>}
                  </td>
                  <td className={eff.amount ? '' : 'text-slate-400'}>{eff.amount ? money(eff.amount) : '۰'}</td>
                </tr>
              )
            })}
            {!cats.length && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-400">
                  هنوز دسته‌بندی کالایی تعریف نشده است؛ از پنل کالاها ← «دسته‌بندی» دسته بسازید.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="kbd leading-6 bg-white rounded shadow p-2">
        وقتی فاکتور {CHARGE_SCOPE_LABELS[scope]} برای کالایی از این دسته‌ها صادر شود، همین مقدار خودکار محاسبه و روی
        فاکتور اعمال می‌شود: حالت «مبلغ ثابت» برای هر عدد کالا و حالت «درصد» از مبلغ خالص همان ردیف (بعد از تخفیف).
        مقدار خودکار قفل نیست: در خودِ فاکتور می‌توانید با دکمه‌ی «دستی» مبلغ را برای همان یک فاکتور عوض کنید. رسید و
        فاکتور چاپی هم از همین مبلغ نهایی استفاده می‌کنند، پس عدد روی کاغذ و عدد در گزارش‌ها هیچ‌وقت اختلاف پیدا
        نمی‌کند.
      </div>
    </div>
  )
}
