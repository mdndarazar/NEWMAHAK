import { useEffect, useState, type ReactNode } from 'react'
import JalaliDateInput from './JalaliDateInput'
import { call, CH } from '../lib/api'
import { faDigits, jalaliToday, jalaliMonthStart } from '@shared/jalali'
import { ORDER_TYPE_LABELS, SALE_CHANNEL_LABELS, SALE_STATUS_LABELS, SaleChannel } from '@shared/enums'
import type { ShiftInfo } from '@shared/types'

/**
 * ===================== نوار فیلتر گزارش‌ها =====================
 * همان چیدمان آشنای بالای پنل‌های «گزارش فروش»، «بستن صندوق» و «تجمیع و
 * انتقال»: از تاریخ / تا تاریخ / کاربر / شماره فیش / سفارشات / وضعیت / شیفت /
 * مشتری / جستجوی کالا + دکمه‌ی «تهیه گزارش».
 *
 * یک کامپوننت مشترک است تا سه پنل دقیقاً یک فیلتر و یک رفتار داشته باشند
 * (وگرنه عددهای گزارش فروش و بستن صندوق با هم فرق می‌کنند).
 * ==============================================================
 */
export interface ReportFilters {
  fromJalali: string
  toJalali: string
  shiftId: number | ''
  orderType: string
  status: string
  receiptNo: string
  customerSearch: string
  productSearch: string
  /** فروشنده / کارمند ثبت‌کننده (خالی = همه) */
  userId?: number | ''
  /**
   * بند ۶ — کانال فروش: `['RETAIL','WHOLESALE']` (پیش‌فرض = همه).
   * آرایه‌ی *خالی* یعنی «هیچ‌کدام» و عمداً گزارش خالی می‌دهد، نه «همه»؛ همان
   * قاعده‌ای که `orderTypesForChannels` سمت shared و main رعایت می‌کند.
   */
  channels: SaleChannel[]
}

/** هر دو کانال = رفتار مو‌به‌موی نسخه‌های قبل (هیچ فیلتری اعمال نمی‌شود). */
export const ALL_CHANNELS: SaleChannel[] = [SaleChannel.RETAIL, SaleChannel.WHOLESALE]

/**
 * 🔴 نشست ۱۸۴ · بند ۴-۲۳ — پیش‌فرض «امروز» است، نه «از اول ماه».
 *
 * مدیر گزارش را باز می‌کند و انتظار دارد عددهای *امروز* را ببیند. با پیش‌فرض
 * «از اول ماه»، عددِ روی صفحه جمعِ ماه بود و به‌راحتی به‌جای فروش امروز خوانده
 * می‌شد. سمت سرور هم از همین نشست، نبودِ تاریخ را «امروز» می‌فهمد؛ این دو
 * حالا یک چیز می‌گویند.
 *
 * `jalaliMonthStart` همچنان در دسترس است: هر صفحه‌ای که واقعاً بازه‌ی ماه
 * می‌خواهد، صریح `makeFilters(jalaliMonthStart(), jalaliToday())` صدا می‌زند.
 */
export const makeFilters = (from = jalaliToday(), to = jalaliToday()): ReportFilters => ({
  fromJalali: from,
  toJalali: to,
  shiftId: '',
  orderType: '',
  status: '',
  receiptNo: '',
  customerSearch: '',
  productSearch: '',
  userId: '',
  channels: [...ALL_CHANNELS]
})

export const todayFilters = (): ReportFilters => makeFilters(jalaliToday(), jalaliToday())

/** تبدیل فیلتر UI به ورودی سرویس‌های main. */
export function toServiceFilter(f: ReportFilters) {
  const receiptNo = f.receiptNo.trim() ? Number(f.receiptNo.trim()) : null
  return {
    fromJalali: f.fromJalali,
    toJalali: f.toJalali,
    shiftId: f.shiftId === '' ? null : Number(f.shiftId),
    orderType: f.orderType || null,
    status: f.status || null,
    receiptNo: receiptNo && Number.isFinite(receiptNo) ? receiptNo : null,
    customerSearch: f.customerSearch.trim() || null,
    productSearch: f.productSearch.trim() || null,
    userId: f.userId === '' || f.userId == null ? null : Number(f.userId),
    /**
     * بند ۶ — آرایه عیناً فرستاده می‌شود و تفسیرش *فقط* در
     * `orderTypesForChannels` (shared) انجام می‌گیرد: هر دو ⇒ بدون فیلتر،
     * خالی ⇒ گزارش خالی. پس هیچ منطق دومی اینجا نیست که با سرور واگرا شود.
     */
    channels: f.channels ?? [...ALL_CHANNELS]
  }
}

/** هر دو کانال انتخاب شده‌اند؟ (چک‌باکس «همه») */
export const isAllChannels = (channels: readonly string[] | null | undefined): boolean =>
  !!channels && channels.includes(SaleChannel.RETAIL) && channels.includes(SaleChannel.WHOLESALE)

/** برچسب خوانا از وضعیت چک‌باکس‌ها، برای سرصفحه‌ی چاپ و نام فایل اکسل. */
export function channelsLabel(channels: readonly string[] | null | undefined): string {
  if (isAllChannels(channels)) return 'همه (تکی + عمده)'
  if (!channels?.length) return 'هیچ‌کدام (گزارش خالی)'
  return channels.map((c) => SALE_CHANNEL_LABELS[c as SaleChannel] ?? c).join(' + ')
}

/**
 * ---------------------------------------------------------------------------
 * بند ۶ — سه چک‌باکس «همه / فروش داخلی-تکی / فروش عمده».
 *
 * قاعده‌ها:
 *   • «همه» یک چک‌باکس *مشتق* است: تیک‌دار است اگر و فقط اگر هر دو کانال
 *     انتخاب شده باشند. زدنش هر دو را روشن می‌کند و برداشتنش هر دو را خاموش.
 *   • دو تای دیگر مستقل‌اند، پس «جدا یا ترکیبی» هر دو ممکن است.
 *   • هیچ تیکی = گزارش عمداً خالی، با یک هشدار کهربایی کنار چک‌باکس‌ها (نه یک
 *     گزارش کاملِ گمراه‌کننده).
 *   • تغییر هر تیک، گزارش را *همان لحظه* دوباره می‌گیرد (بند ۷: «فیلتر پویا»)؛
 *     مسئولیتش دست صفحه‌ی مصرف‌کننده است که `onChange` را به `load` وصل کند.
 * ---------------------------------------------------------------------------
 */
export function ChannelChecks({
  value,
  onChange,
  label = 'نوع فروش'
}: {
  value: SaleChannel[]
  onChange: (next: SaleChannel[]) => void
  label?: string
}) {
  const has = (c: SaleChannel) => value.includes(c)
  const toggle = (c: SaleChannel) => onChange(has(c) ? value.filter((v) => v !== c) : [...value, c])
  const all = isAllChannels(value)
  return (
    <div className="flex flex-col gap-1">
      <div className="kbd">{label}</div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 font-bold" title="هم فروش تکی و هم فروش عمده">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={all}
            onChange={() => onChange(all ? [] : [...ALL_CHANNELS])}
          />
          همه
        </label>
        <label className="flex items-center gap-1" title="فروش حضوری پنل فروش، بیرون‌بر/پیک، تلفنی و سند تعویض کالا">
          <input type="checkbox" className="w-4 h-4" checked={has(SaleChannel.RETAIL)} onChange={() => toggle(SaleChannel.RETAIL)} />
          {SALE_CHANNEL_LABELS[SaleChannel.RETAIL]}
        </label>
        <label className="flex items-center gap-1" title="فاکتورهای صادرشده از پنل «فاکتور فروش عمده»">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={has(SaleChannel.WHOLESALE)}
            onChange={() => toggle(SaleChannel.WHOLESALE)}
          />
          {SALE_CHANNEL_LABELS[SaleChannel.WHOLESALE]}
        </label>
        {!value.length && (
          <span className="text-amber-800 font-bold bg-amber-100 border border-amber-300 rounded px-2 py-px">
            هیچ نوع فروشی انتخاب نشده — گزارش خالی است
          </span>
        )}
      </div>
    </div>
  )
}

export default function ReportFilterBar({
  value,
  onChange,
  onSubmit,
  busy,
  submitLabel = 'تهیه گزارش',
  children,
  showShift = true,
  showProduct = true,
  showChannels = false,
  showSeller = true,
  channelsLabelText
}: {
  value: ReportFilters
  onChange: (f: ReportFilters) => void
  onSubmit: () => void
  busy?: boolean
  submitLabel?: string
  children?: ReactNode
  showShift?: boolean
  showProduct?: boolean
  /** بند ۶ — سه چک‌باکس «همه / تکی / عمده» (فقط پنل گزارشات فروش) */
  showChannels?: boolean
  /** فیلتر فروشنده؛ سرور از قبل `userId` را می‌فهمید ولی نوار آن را نمی‌فرستاد. */
  showSeller?: boolean
  channelsLabelText?: string
}) {
  const [shifts, setShifts] = useState<ShiftInfo[]>([])
  const [staff, setStaff] = useState<{ id: number; name: string; isActive?: boolean }[]>([])

  useEffect(() => {
    if (!showShift) return
    call<ShiftInfo[]>(CH.shiftList, { fromJalali: value.fromJalali, toJalali: value.toJalali })
      .then(setShifts)
      .catch(() => setShifts([]))
  }, [showShift, value.fromJalali, value.toJalali])

  useEffect(() => {
    if (!showSeller) return
    call<{ id: number; name: string; isActive?: boolean }[]>(CH.staffList)
      .then((list) => setStaff(Array.isArray(list) ? list : []))
      .catch(() => setStaff([]))
  }, [showSeller])

  const set = (patch: Partial<ReportFilters>) => onChange({ ...value, ...patch })

  return (
    <div className="bg-white rounded shadow p-2 flex flex-wrap gap-2 items-end">
      <div>
        <div className="mb-1">از تاریخ</div>
        <JalaliDateInput value={value.fromJalali} onChange={(v) => set({ fromJalali: v })} />
      </div>
      <div>
        <div className="mb-1">تا تاریخ</div>
        <JalaliDateInput value={value.toJalali} onChange={(v) => set({ toJalali: v })} />
      </div>

      {showShift && (
        <label>
          <div className="mb-1">شیفت</div>
          <select
            className="inp min-w-[150px]"
            value={value.shiftId}
            onChange={(e) => set({ shiftId: e.target.value === '' ? '' : Number(e.target.value) })}
          >
            <option value="">همه شیفت‌ها</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {faDigits(s.dayJalali)} · {s.name}
                {s.closed ? ' (بسته)' : ' (باز)'}
              </option>
            ))}
          </select>
        </label>
      )}

      {showSeller && (
        <label>
          <div className="mb-1">فروشنده</div>
          <select
            className="inp min-w-[150px]"
            value={value.userId ?? ''}
            onChange={(e) => set({ userId: e.target.value === '' ? '' : Number(e.target.value) })}
          >
            <option value="">همه فروشنده‌ها</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.isActive === false ? ' (غیرفعال)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <div className="mb-1">نوع سفارش</div>
        <select className="inp min-w-[130px]" value={value.orderType} onChange={(e) => set({ orderType: e.target.value })}>
          <option value="">همه سفارشات</option>
          {Object.entries(ORDER_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label>
        <div className="mb-1">وضعیت</div>
        <select className="inp min-w-[130px]" value={value.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(SALE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label>
        <div className="mb-1">شماره فیش</div>
        <input
          className="inp w-28"
          dir="ltr"
          placeholder="همه"
          value={value.receiptNo}
          onChange={(e) => set({ receiptNo: e.target.value.replace(/[^0-9]/g, '') })}
        />
      </label>

      <label>
        <div className="mb-1">مشتری</div>
        <input
          className="inp w-40"
          placeholder="مشتری را جستجو کنید"
          value={value.customerSearch}
          onChange={(e) => set({ customerSearch: e.target.value })}
        />
      </label>

      {showProduct && (
        <label>
          <div className="mb-1">کالا</div>
          <input
            className="inp w-44"
            placeholder="کالا را جستجو کنید"
            value={value.productSearch}
            onChange={(e) => set({ productSearch: e.target.value })}
          />
        </label>
      )}

      {/* بند ۶ — فیلتر تکی/عمده؛ تغییرش گزارش را در لحظه تازه می‌کند */}
      {showChannels && (
        <div className="pb-1">
          <ChannelChecks
            value={value.channels ?? [...ALL_CHANNELS]}
            onChange={(channels) => set({ channels })}
            label={channelsLabelText ?? 'نوع فروش'}
          />
        </div>
      )}

      <button className="btn btn-primary" onClick={onSubmit} disabled={busy}>
        {busy ? 'در حال تهیه…' : submitLabel}
      </button>

      {children}
    </div>
  )
}
