import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLatestGate } from '@shared/latestRequest'
import { call, CH } from '../lib/api'
import { jalaliToday, money, parseGroupedInteger, toLatinDigits } from '@shared/jalali'
import { monthStart, addJalaliDays } from '@shared/jalaliBuckets'
import { PANEL_KEYS } from '@shared/panels'
import ManagerGate from '../components/ManagerGate'
import ConfirmDialog from '../components/ConfirmDialog'
import JalaliDateInput from '../components/JalaliDateInput'
import { exportTable } from '../lib/exportCsv'
import {
  BarLineChart,
  DonutChart,
  EmptyChart,
  HBarChart,
  Heatmap,
  StackedBarChart
} from '../components/management/MgmtCharts'

type Tab =
  | 'trend'
  | 'mix'
  | 'compare'
  | 'staff'
  | 'category'
  | 'stock'
  | 'abc'
  | 'size'
  | 'heat'
  | 'buy'
  | 'profit'

const TAB_GROUPS: { title: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    title: 'فروش',
    tabs: [
      { id: 'trend', label: 'روند فروش' },
      { id: 'mix', label: 'نقد / کارت / نسیه' },
      { id: 'compare', label: 'مقایسهٔ بازه' },
      { id: 'staff', label: 'فروشنده' },
      { id: 'category', label: 'دسته' },
      { id: 'heat', label: 'ساعت شلوغ' }
    ]
  },
  {
    title: 'کالا',
    tabs: [
      { id: 'stock', label: 'مانده و کم‌فروش' },
      { id: 'abc', label: 'ABC کالا' },
      { id: 'size', label: 'منحنی سایز' },
      { id: 'buy', label: 'خرید و فروش' }
    ]
  },
  {
    title: 'سود',
    tabs: [{ id: 'profit', label: 'سود و تورم' }]
  }
]

/**
 * تب‌هایی که `categoryId` را در سرویسشان **نمی‌خوانند** (بازبینی یازدهم — B11).
 *
 * «سایز» در این فهرست **بود**، و همان گذاشتنِ آن اشتباهِ من (نشست ۲۲۰) بود: `sizeCurve` خودِ `stock(filter)` را صدا
 * می‌زند و `stock()` دسته را اعمال می‌کند ⇒ `in` کردنش یعنی انتخابِ کاربر بی‌صدا دور ریخته شود و
 * لیبل «(در این تب بی‌اثر)» دروغ بگوید، درحالی‌که راهنمای پایینِ همین صفحه («فیلتر دسته روی …
 * سایز … اثر دارد») راست می‌گفت. فهرست باید از بدنهٔ تابع‌ها نه، از **کلِ زنجیرهٔ صدا زدن**
 * گرفته شود — یک تستِ رفتاری (دو دسته، عددِ متفاوت) این را قفل می‌کند.
 */
const CAT_INERT_TABS = ['trend', 'mix', 'compare', 'staff', 'heat', 'buy']

const MIX_SERIES = [
  { key: 'cashReceived', label: 'نقد', color: '#0f9b9b' },
  { key: 'cardReceived', label: 'کارت', color: '#d97706' },
  { key: 'creditRemaining', label: 'نسیهٔ مانده', color: '#6366f1' },
  { key: 'managerAccountReceived', label: 'حساب مدیر', color: '#e11d48' },
  { key: 'destinationUnknownReceived', label: 'نامشخص', color: '#64748b' }
]

export default function ManagementReports() {
  const today = jalaliToday()
  const [fromJalali, setFrom] = useState(() => monthStart(today))
  const [toJalali, setTo] = useState(today)
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day')
  const [userId, setUserId] = useState<number | 0>(0)
  const [categoryId, setCategoryId] = useState<number | 0>(0)
  const [retail, setRetail] = useState(true)
  const [wholesale, setWholesale] = useState(true)
  const [tab, setTab] = useState<Tab>('trend')
  const [mixOn, setMixOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MIX_SERIES.map((s) => [s.key, true]))
  )
  const [staffList, setStaffList] = useState<{ id: number; name: string }[]>([])
  const [cats, setCats] = useState<{ id: number; name: string; depth?: number }[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [compareMode, setCompareMode] = useState<'previous' | 'lastYear'>('previous')
  const [minStock, setMinStock] = useState(0)
  const [idleSince, setIdleSince] = useState('')
  const [snap, setSnap] = useState<any>(null)
  const [engine, setEngine] = useState<any>(null)
  const [eduOpen, setEduOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [todaySnap, setTodaySnap] = useState<any>(null)
  const [ydaySnap, setYdaySnap] = useState<any>(null)

  const channels = useMemo(() => {
    const c: string[] = []
    if (retail) c.push('RETAIL')
    if (wholesale) c.push('WHOLESALE')
    return c
  }, [retail, wholesale])

  const filter = useMemo(
    () => ({
      fromJalali,
      toJalali,
      grain,
      userId: userId || null,
      categoryId: categoryId || null,
      channels
    }),
    [fromJalali, toJalali, grain, userId, categoryId, channels]
  )

  const [applied, setApplied] = useState(filter)
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(filter), 400)
    return () => window.clearTimeout(t)
  }, [filter])

  const tabFilter = useMemo(() => {
    if (['stock', 'abc', 'size', 'buy', 'heat'].includes(tab)) {
      return { ...applied, userId: null, channels: undefined }
    }
    if (tab === 'staff') return { ...applied, channels: undefined }
    return applied
  }, [applied, tab])

  useEffect(() => {
    call<any>(CH.mgmtStaffOptions)
      .then((rows) => setStaffList(Array.isArray(rows) ? rows : []))
      .catch(() => setStaffList([]))
    call<any[]>(CH.categoryTree)
      .then((rows) => setCats(Array.isArray(rows) ? rows : []))
      .catch(() => setCats([]))
  }, [])

  const loadEngine = useCallback(() => {
    call<any>(CH.mgmtCostEngineStatus)
      .then(setEngine)
      .catch(() => setEngine(null))
  }, [])

  useEffect(() => {
    loadEngine()
  }, [loadEngine, tab])

  useEffect(() => {
    let live = true
    /**
     * B9 (بازبینی نهم) — کارت‌های بالا با `applied` خوانده می‌شدند، یعنی فیلتر
     * فروشندهٔ تبِ قبلی روی آن‌ها می‌ماند؛ در تب‌هایی که خودِ تب فیلتر فروشنده را برمی‌دارد
     * (مانده/ABC/سایز/خرید/هیت‌مپ) فهرست فروشنده خاکستری بود ولی کارت هنوز فروش «علی»
     * را نشان می‌داد. حالا کارت‌ها دقیقاً همان فیلترِ همان تب را دارند (`tabFilter`)،
     * پس «عددِ یک نفر» هیچ‌وقت جای «عددِ کل مغازه» را نمی‌گیرد.
     */
    call<any>(CH.mgmtSnapshot, tabFilter)
      .then((d) => live && setSnap(d))
      .catch(() => live && setSnap(null))
    const t = jalaliToday()
    const y = addJalaliDays(t, -1)
    const ch = tabFilter.channels
    const uid = tabFilter.userId
    Promise.all([
      call<any>(CH.mgmtSnapshot, { fromJalali: t, toJalali: t, userId: uid, channels: ch }),
      call<any>(CH.mgmtSnapshot, { fromJalali: y, toJalali: y, userId: uid, channels: ch })
    ])
      .then(([a, b]) => {
        if (!live) return
        setTodaySnap(a)
        setYdaySnap(b)
      })
      .catch(() => {
        if (!live) return
        setTodaySnap(null)
        setYdaySnap(null)
      })
    return () => {
      live = false
    }
    // `tabFilter` نه `applied`: با عوض‌شدن تب هم کارت‌ها باید به فیلترِ همان تب برگردند.
  }, [tabFilter])

  /**
   * B7 (بازبینی دهم) — با عوض‌شدن تب، `data`ِ تبِ قبل تا رسیدن جوابِ تازه زیرِ عنوانِ تبِ
   * تازه می‌ماند (یک لحظه جدولِ اشتباه، مثلاً ماندهٔ کالاها زیرِ سربرگ ABC). پس همان
   * لحظه پاک می‌شود تا «در حال بارگذاری» بیاید؛ هیچ عددی حذف یا پنهان نمی‌شود — فقط
   * دادهٔ ناکامِ تبِ قبلی جای تبِ جدید را نمی‌گیرد.
   */
  useEffect(() => {
    setData(null)
  }, [tab])

  const loadGate = useRef(createLatestGate())
  const load = useCallback(async () => {
    if (tab === 'profit') return
    const seq = loadGate.current.next()
    setErr('')
    setLoading(true)
    try {
      let next: any = null
      if (tab === 'trend' || tab === 'mix') next = await call(CH.mgmtTrend, tabFilter)
      else if (tab === 'compare') next = await call(CH.mgmtCompare, { ...tabFilter, mode: compareMode })
      else if (tab === 'staff') next = await call(CH.mgmtStaff, tabFilter)
      else if (tab === 'category') next = await call(CH.mgmtCategory, tabFilter)
      else if (tab === 'heat') next = await call(CH.mgmtHeatmap, tabFilter)
      else if (tab === 'stock')
        next = await call(CH.mgmtStock, { ...tabFilter, minStock, idleSinceJalali: idleSince || null })
      else if (tab === 'abc') next = await call(CH.mgmtAbc, tabFilter)
      else if (tab === 'size') next = await call(CH.mgmtSizeCurve, tabFilter)
      else if (tab === 'buy') next = await call(CH.mgmtPurchaseVsSale, tabFilter)
      if (!loadGate.current.isLatest(seq)) return
      setData(next)
    } catch (e: any) {
      if (!loadGate.current.isLatest(seq)) return
      setData(null)
      setErr(String(e?.message ?? e))
    } finally {
      if (loadGate.current.isLatest(seq)) setLoading(false)
    }
  }, [tab, tabFilter, compareMode, minStock, idleSince])

  useEffect(() => {
    void load()
  }, [load])

  const whole = data?.whole?.accounting || data?.a?.accounting || snap?.accounting
  const emptyTrend = data?.empty === true
  const healthBad =
    engine &&
    (engine.healthOk === false || engine.behind > 0 || engine.failCount > 0 || engine.reconcileError)

  const exportNow = async () => {
    if (loading) return
    setExporting(true)
    setErr('')
    try {
      const meta = `${applied.fromJalali} تا ${applied.toJalali}`
      const rangeMeta = data?.fromJalali && data?.toJalali ? `${data.fromJalali} تا ${data.toJalali}` : meta
      if (tab === 'trend') {
        await exportTable({
          fileName: 'گزارش-مدیریت-روند',
          sheetName: 'روند فروش',
          title: `روند فروش — ${meta}`,
          headers: ['بازه', 'فروش خالص', 'تعداد', 'نقد', 'کارت'],
          rows: (data?.points ?? []).map((p: any) => [
            p.label,
            p.netAccrualSales,
            p.invoiceCount,
            p.cashReceived,
            p.cardReceived
          ])
        })
      } else if (tab === 'staff') {
        await exportTable({
          fileName: 'گزارش-مدیریت-فروشنده',
          sheetName: 'فروشنده',
          title: `فروشنده — ${meta}`,
          headers: ['فروشنده', 'فروش فاکتور', 'تعداد', 'تخفیف', 'برگشت', 'تعویض', 'اعتبار'],
          rows: (data?.rows ?? []).map((r: any) => [
            r.userName,
            r.salesTotal,
            r.invoiceCount,
            r.discountTotal,
            r.returnTotal,
            r.exchangeTotal,
            r.storeCreditTotal
          ])
        })
      } else if (tab === 'category') {
        await exportTable({
          fileName: 'گزارش-مدیریت-دسته',
          sheetName: 'دسته',
          title: `دسته — ${meta}`,
          headers: ['دسته', 'ارزش اقلام بعد از برگشت', 'تعداد'],
          rows: (data?.rows ?? []).map((r: any) => [r.name, r.amount, r.qty])
        })
      } else if (tab === 'mix') {
        await exportTable({
          fileName: 'گزارش-مدیریت-ترکیب-پول',
          sheetName: 'نقد کارت نسیه',
          title: `ترکیب پول — ${meta}`,
          headers: ['بازه', 'نقد', 'کارت', 'نسیه مانده', 'حساب مدیر', 'نامشخص'],
          rows: (data?.points ?? []).map((p: any) => [
            p.label,
            p.cashReceived,
            p.cardReceived,
            p.creditRemaining,
            p.managerAccountReceived,
            p.destinationUnknownReceived
          ])
        })
      } else if (tab === 'compare') {
        await exportTable({
          fileName: 'گزارش-مدیریت-مقایسه',
          sheetName: 'مقایسه',
          title: `مقایسه — ${meta}`,
          headers: ['بازه', 'فروش خالص', 'تعداد'],
          rows: [
            [data?.a?.label, data?.a?.accounting?.invoice?.netAccrualSales, data?.a?.accounting?.invoice?.invoiceCount],
            [data?.b?.label, data?.b?.accounting?.invoice?.netAccrualSales, data?.b?.accounting?.invoice?.invoiceCount]
          ]
        })
      } else if (tab === 'stock') {
        await exportTable({
          fileName: 'گزارش-مدیریت-مانده',
          sheetName: 'مانده',
          title: `مانده — ${rangeMeta}`,
          headers:
            data?.totalReplacement != null
              ? ['کالا', 'سایز', 'رنگ', 'مانده', 'فروش ۳۰روز', 'فروش ۹۰روز', 'خواب', 'پوشش روز', 'نرخ فروش ۹۰روز٪', 'ارزش جایگزینی']
              : ['کالا', 'سایز', 'رنگ', 'مانده', 'فروش ۳۰روز', 'فروش ۹۰روز', 'خواب', 'پوشش روز', 'نرخ فروش ۹۰روز٪'],
          rows: (data?.rows ?? []).map((r: any) => {
            const base = [
              r.productName,
              r.size,
              r.color,
              r.stock,
              r.netSold30,
              r.netSold90,
              r.sleepDays ?? '',
              r.coverDays ?? '',
              r.sellThrough ?? ''
            ]
            return data?.totalReplacement != null ? [...base, r.replacementValue] : base
          })
        })
      } else if (tab === 'abc') {
        // نشست ۲۱۶ (سؤال ۳): یک برگه، دو نگاه. `exportTable` تک‌برگه‌ای است و لایه‌ی
        // xlsx (که خروجی گزارشات فروش هم از آن می‌خواند) عمداً دست نمی‌خورد؛ پس
        // ABC فروش و ABC سود به‌ازای هر کالا در یک صفحه joined می‌شوند.
        const hasProfit = Array.isArray(data?.profitRows) && data.profitRows.length > 0
        const byProduct = new Map<number, any>((data?.profitRows ?? []).map((r: any) => [r.productId, r]))
        const rows: (string | number | null)[][] = (data?.rows ?? []).map((r: any) => {
          const pr = hasProfit ? byProduct.get(r.productId) : undefined
          if (pr) byProduct.delete(r.productId)
          if (!hasProfit) return [r.cls, r.name, r.amount, r.share]
          const flag = String(r.cls) === 'A' && String(pr?.cls ?? '') === 'C' ? 'A فروش / C سود' : ''
          return [r.cls, r.name, r.amount, r.share, pr?.cls ?? '', pr?.realProfit ?? '', pr?.share ?? '', flag]
        })
        if (hasProfit) for (const pr of byProduct.values()) rows.push(['', pr.name, '', '', pr.cls, pr.realProfit, pr.share, ''])
        await exportTable({
          fileName: 'گزارش-مدیریت-abc',
          sheetName: 'ABC',
          title: `ABC فروش و سود — ${rangeMeta}`,
          headers: hasProfit
            ? ['کلاس فروش', 'کالا', 'ارزش ۹۰روز', 'سهم فروش', 'کلاس سود', 'سود واقعی', 'سهم سود', 'هشدار']
            : ['کلاس', 'کالا', 'ارزش ۹۰روز', 'سهم'],
          rows
        })
      } else if (tab === 'heat') {
        await exportTable({
          fileName: 'گزارش-مدیریت-ساعت',
          sheetName: 'ساعت شلوغ',
          title: `ساعت شلوغ — ${meta}`,
          headers: ['روز هفته', 'ساعت', 'تعداد فاکتور'],
          rows: (data?.cells ?? []).map((c: any) => [
            (data?.weekdays ?? [])[c.dow] ?? c.dow,
            c.hour,
            c.count
          ])
        })
      } else if (tab === 'size') {
        await exportTable({
          fileName: 'گزارش-مدیریت-سایز',
          sheetName: 'سایز',
          title: `منحنی سایز — ${rangeMeta}`,
          headers: ['کالا', 'سایز', 'مانده', 'فروش ۹۰روز'],
          rows: (data?.products ?? []).flatMap((p: any) =>
            Object.entries(p.sizes || {}).map(([sz, s]: any) => [p.name, sz, s.stock, s.sold90])
          )
        })
      } else if (tab === 'buy') {
        await exportTable({
          fileName: 'گزارش-مدیریت-خرید-فروش',
          sheetName: 'خرید و فروش',
          title: `خرید و فروش — ${meta}`,
          headers: ['شاخص', 'مبلغ'],
          rows: [
            ['خرید تأییدشده', data?.purchaseTotal ?? 0],
            ...(data?.fifoSoldCost != null
              ? [
                  ['بهای تمام‌شده FIFO فروخته‌شده', data.fifoSoldCost],
                  ['انباشت در کالا', data?.accumulation ?? 0]
                ]
              : []),
            ['فروش خالص تعهدی', data?.netAccrualSales ?? 0]
          ]
        })
      } else {
        setErr('برای این تب خروجی جدولی نیست؛ تب روند، ترکیب پول، مقایسه، فروشنده، دسته، مانده، ABC، سایز، ساعت یا خرید را باز کنید.')
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">گزارش مدیریت</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            این صفحه جدا از «گزارشات فروش» است. هر عدد فروش از همان موتور سرجمع می‌آید؛ اینجا چیزی دوباره حساب
            نمی‌شود. سود قفل جدا دارد و گزارشات فروش را عوض نمی‌کند.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="border rounded px-3 py-1 text-xs" onClick={() => setEduOpen((v) => !v)}>
            {eduOpen ? 'بستن آموزش' : 'آموزش این صفحه'}
          </button>
          <button className="border rounded px-3 py-1 text-xs" onClick={() => void exportNow()} disabled={exporting || loading || tab === 'profit'}>
            {exporting ? 'در حال ساخت…' : 'خروجی اکسل'}
          </button>
        </div>
      </div>

      {eduOpen ? (
        <div className="bg-slate-50 border rounded p-3 text-xs leading-6 space-y-1">
          <p>
            <b>ورود جنس فقط از فاکتور خرید است.</b> موجودی و فی کارت را از پنل کالا دستکاری نکنید؛ فاکتور خرید هر دو را
            به‌روز می‌کند.
          </p>
          <p>
            عدد فروش همین صفحه از «گزارشات فروش» خوانده می‌شود. اگر با سرجمع آنجا یکی نبود، این صفحه را باور نکنید.
          </p>
          <p>
            <b>سود دو نگاه دارد:</b> سود واقعی = پولی که از جیب رفته (لات FIFO). سود جایگزینی = همان فروش با فی آخرین
            فاکتور خریدِ <b>لحظه‌ای که قلم قفل شده</b> (نه فی همین لحظهٔ باز کردن صفحه، و نه قیمتی که روی کارت کالا
            می‌نویسی). ارزش ماندهٔ انبار است که «امروز» حساب می‌شود.
          </p>
          <p>تب سود رمز جدا دارد تا حسابدار روند را ببیند و حاشیه را نبیند.</p>
        </div>
      ) : null}

      {healthBad ? (
        <div className="bg-amber-50/80 border border-amber-200 text-amber-900 text-xs rounded p-2 leading-6">
          چراغ دفتر هزینه زرد است — عددها پنهان نمی‌شوند.
          {engine.behind > 0 ? ` ${engine.behind} حرکت انبار هنوز پردازش نشده.` : ''}
          {engine.healthOk === false
            ? ` ماندهٔ لات با موجودی ${engine.mismatchCount ?? 0} کالا یکی نیست.`
            : ''}
          {engine.failCount > 0
            ? ` ${engine.failCount} حرکت انبار خطا دارد و دفتر از همان‌جا ایستاده — تا این حرکت درست نشود هیچ فروش تازه‌ای فی قفل نمی‌گیرد.`
            : ''}
          {engine.reconcileError ? ` ویرایش فاکتور با دفتر هم‌خوان نشد: ${engine.reconcileError}` : ''}
          {(engine.failures ?? []).length ? (
            <div className="mt-1 bg-rose-50 border border-rose-200 rounded p-1.5 text-rose-900">
              {(engine.failures as any[]).map((f) => (
                <div key={f.movementId}>
                  حرکت #{f.movementId} {f.at ? `(${f.at})` : ''} · {f.reason} ·{' '}
                  {f.productName || 'کالا'} {f.size || ''} ({Number(f.delta).toLocaleString('fa-IR')}) — {f.message}
                </div>
              ))}
              <div className="mt-1">
                راه خروجی: همان حرکت را در صفحهٔ انبار/فروش درست کنید و «اجرای دفتر هزینه» را بزنید (دفتر از همان‌جا
                ادامه می‌دهد و همین خطا خودش پاک می‌شود). «بازسازی دفتر هزینه» با رمز مدیر هم هست، ولی تا وقتی این
                خطاها پابرجایند <b>انجام نمی‌شود</b>: بازسازی اول کل دفتر را پاک می‌کند و بعد روی همان حرکت می‌ایستد،
                یعنی همه‌چیز بی‌فی می‌ماند — بدتر از همین وضعیتِ چراغ‌قرمز.
              </div>
            </div>
          ) : null}
          {(engine.mismatches ?? []).length ? (
            <div className="mt-1">
              {(engine.mismatches as any[]).slice(0, 8).map((m) => (
                <div key={m.variantId}>
                  {m.productName || m.code}: موجودی {m.stock} · لات {m.lots}
                </div>
              ))}
            </div>
          ) : null}
          <button
            className="mr-2 underline"
            onClick={() =>
              call(CH.mgmtCostEngineRun)
                .then(() => loadEngine())
                .catch((e: any) => setErr(String(e?.message ?? e)))
            }
          >
            الان پردازش کن
          </button>
        </div>
      ) : engine ? (
        <div className="text-[11px] text-slate-500">
          دفتر هزینه هم‌گام است. ماندهٔ لات با موجودی کالا یکی است.
          {engine.reconcile?.maxId
            ? ` جاروی ویرایشِ فاکتورها: قلم ${Number(engine.reconcile.cur).toLocaleString('fa-IR')} از ${Number(
                engine.reconcile.maxId
              ).toLocaleString('fa-IR')}${
                engine.reconcile.budget ? ' — این دور کامل نشد؛ ادامه در اجرای بعدی' : ''
              }.`
            : ''}
        </div>
      ) : null}

      <MonthTarget toJalali={toJalali} />

      {todaySnap?.accounting ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button className="text-right" onClick={() => setTab('trend')}>
            <Stat
              title="فروش خالص امروز"
              value={money(todaySnap.accounting.invoice?.netAccrualSales)}
            />
            <div className="text-[11px] text-slate-500 mt-1 px-1">
              دیروز {money(ydaySnap?.accounting?.invoice?.netAccrualSales ?? 0)}
            </div>
          </button>
          <Stat title="فروش خالص تعهدی این بازه" value={money(whole?.invoice?.netAccrualSales)} />
          <Stat title="نقد دریافت‌شده" value={money(whole?.cash?.cashReceived)} />
          <Stat title="کارت / تعداد فاکتور" value={`${money(whole?.cash?.cardReceived)} · ${whole?.invoice?.invoiceCount ?? 0}`} />
        </div>
      ) : whole ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat title="فروش خالص تعهدی این بازه" value={money(whole.invoice?.netAccrualSales)} />
          <Stat title="نقد دریافت‌شده" value={money(whole.cash?.cashReceived)} />
          <Stat title="کارت" value={money(whole.cash?.cardReceived)} />
          <Stat title="تعداد فاکتور" value={String(whole.invoice?.invoiceCount ?? 0)} />
        </div>
      ) : null}

      {applied.userId ? (
        <div className="text-[11px] text-slate-500">
          {tabFilter.userId
            ? `کارت‌های بالا هم فقط برای فروشندهٔ انتخابی‌اند (${
                (staffList as any[]).find((s: any) => Number(s.id) === Number(tabFilter.userId))?.name ??
                'فروشنده'
              }).`
            : `فیلتر فروشندهٔ «${
                (staffList as any[]).find((s: any) => Number(s.id) === Number(applied.userId))?.name ?? '—'
              }» روی این تب اعمال نمی‌شود؛ کارت‌ها هم مثل جدولِ همین تب «کل مغازه» است.`}
        </div>
      ) : null}
      {engine && (Number(engine.behind) > 0 || Number(engine.failCount) > 0) ? (
        <div className="text-[11px] text-amber-800">
          {Number(engine.behind) > 0
            ? `${engine.behind} حرکت انبار پردازش‌نشده مانده`
            : 'دفتر هزینه روی یک حرکت خراب ایستاده'}{' '}
          — پس فیِ قلم‌ها (و سودِ پشت قفل) هنوز تقریبی است؛ عدد فروشِ کارت‌ها از همان موتور گزارش فروش است و دست‌نخورده.
        </div>
      ) : null}

      <div className="bg-white border rounded p-3 flex flex-wrap gap-3 items-end text-xs">
        <label>
          از
          <JalaliDateInput className="border rounded px-2 py-1 mr-1 w-36" value={fromJalali} onChange={setFrom} />
        </label>
        <label>
          تا
          <JalaliDateInput className="border rounded px-2 py-1 mr-1 w-36" value={toJalali} onChange={setTo} />
        </label>
        <label>
          دانه
          <select className="border rounded px-2 py-1 mr-1" value={grain} onChange={(e) => setGrain(e.target.value as any)}>
            <option value="day">روز</option>
            <option value="week">هفته</option>
            <option value="month">ماه</option>
          </select>
        </label>
        <label>
          فروشنده
          <select
            className="border rounded px-2 py-1 mr-1 min-w-[8rem]"
            value={userId}
            onChange={(e) => setUserId(Number(e.target.value))}
            disabled={['stock', 'abc', 'size', 'buy', 'heat'].includes(tab)}
          >
            <option value={0}>همه</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {/*
          B11 (بازبینی یازدهم) — فهرستِ «بی‌اثرها» باید با سرویس‌ها بخواند: `trend/mix/
          compare/staff/heat/buy` دسته را نمی‌خوانند و `sizeCurve` هم نمی‌خواند (قبلاً
          این یکی از فهرست جا افتاده بود و منوی فعال، فیلتری را وعده می‌داد که هیچ‌وقت
          اعمال نمی‌شد). وقتی فیلتر بی‌اثر است، جعبه باید «همه» را نشان دهد نه
          دستهٔ انتخابیِ تبِ قبل: کاربر از رنگِ هایلایت فهمیده بود عددِ این تب فیلتر شده.
          انتخابِ واقعیِ کاربر پاک نمی‌شود — با برگشتن به تبِ دسته‌بندی/سود سرِ جایش است.
        */}
        <label title={CAT_INERT_TABS.includes(tab) ? 'این تب فیلترِ دسته را نمی‌خواند؛ عددش برای همهٔ دسته‌هاست' : undefined}>
          دسته{CAT_INERT_TABS.includes(tab) ? ' (در این تب بی‌اثر)' : ''}
          <select
            className="border rounded px-2 py-1 mr-1 min-w-[8rem]"
            value={CAT_INERT_TABS.includes(tab) ? 0 : categoryId}
            onChange={(e) => setCategoryId(Number(e.target.value))}
            disabled={CAT_INERT_TABS.includes(tab)}
          >
            <option value={0}>همه</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {'—'.repeat(c.depth || 0)} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={retail}
            onChange={(e) => setRetail(e.target.checked)}
            disabled={['stock', 'abc', 'size', 'buy', 'heat', 'staff'].includes(tab)}
          />{' '}
          خرد
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={wholesale}
            onChange={(e) => setWholesale(e.target.checked)}
            disabled={['stock', 'abc', 'size', 'buy', 'heat', 'staff'].includes(tab)}
          />{' '}
          عمده
        </label>
        <button className="bg-brand text-white rounded px-3 py-1" onClick={() => void load()} disabled={loading || tab === 'profit'}>
          {loading ? 'در حال خواندن…' : 'اعمال فیلتر'}
        </button>
        {['stock', 'abc', 'size', 'buy', 'heat'].includes(tab) ? (
          <span className="text-[11px] text-slate-500">
            این تب فروشنده و خرد/عمده را اعمال نمی‌کند — عدد کل مغازه است.
          </span>
        ) : tab === 'staff' ? (
          <span className="text-[11px] text-slate-500">
            تب فروشنده خرد/عمده را اعمال نمی‌کند (همان تب کارمند گزارش فروش). فیلتر دسته روی پرداخت وصل نیست.
          </span>
        ) : ['trend', 'mix', 'compare', 'heat', 'buy'].includes(tab) ? (
          <span className="text-[11px] text-slate-500">
            فیلتر دسته روی روند و ترکیب پول کار نمی‌کند؛ پرداخت به قلم وصل نیست.
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">
            فیلتر دسته روی مانده، ABC، سایز، دسته و درآمد تب سود اثر دارد. ماندهٔ انبار و ثروت کاغذی همیشه کل مغازه‌اند.
          </span>
        )}
      </div>

      <div className="space-y-2">
        {TAB_GROUPS.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-slate-500 w-10">{g.title}</span>
            {g.tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded text-xs ${tab === t.id ? 'bg-brand text-white' : 'bg-white border'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {err ? <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded p-2">{err}</div> : null}

      <div className="bg-white border rounded p-3 tbl-card">
        {tab === 'trend' && (
          <>
            {emptyTrend ? (
              <EmptyChart />
            ) : (
              <BarLineChart
                points={(data?.points ?? []).map((p: any) => ({
                  label: p.label,
                  sales: p.netAccrualSales,
                  count: p.invoiceCount,
                  lastYear: p.lastYearNetAccrualSales
                }))}
              />
            )}
            <Warn notes={data?.warnings} extra={data?.points?.flatMap((p: any) => p.notes || [])} />
            <NumTable
              rows={data?.points ?? []}
              cols={[
                ['label', 'بازه'],
                ['netAccrualSales', 'فروش خالص', true],
                ['invoiceCount', 'تعداد'],
                ['cashReceived', 'نقد', true],
                ['cardReceived', 'کارت', true]
              ]}
            />
          </>
        )}

        {tab === 'mix' && (
          <>
            <div className="flex flex-wrap gap-3 text-xs mb-2">
              {MIX_SERIES.map((s) => (
                <label key={s.key} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={mixOn[s.key] !== false}
                    onChange={(e) => setMixOn((m) => ({ ...m, [s.key]: e.target.checked }))}
                  />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              سبدها همان گزارش فروش‌اند. حساب مدیر و نامشخص داخل نقد ادغام نمی‌شوند. تیک فقط سری نمودار را کم می‌کند،
              فاکتور را فیلتر نمی‌کند.
            </p>
            <StackedBarChart
              points={data?.points ?? []}
              series={MIX_SERIES.map((s) => ({ ...s, on: mixOn[s.key] !== false }))}
            />
            <Warn notes={data?.warnings} />
          </>
        )}

        {tab === 'compare' && (
          <>
            <div className="flex gap-2 text-xs mb-3">
              <button
                className={`px-2 py-1 rounded ${compareMode === 'previous' ? 'bg-brand text-white' : 'border'}`}
                onClick={() => setCompareMode('previous')}
              >
                در مقابل بازهٔ هم‌طول قبلی
              </button>
              <button
                className={`px-2 py-1 rounded ${compareMode === 'lastYear' ? 'bg-brand text-white' : 'border'}`}
                onClick={() => setCompareMode('lastYear')}
                title="اگر بازه یک ماه باشد: همان ماهِ سال پیش؛ اگر بلندتر باشد: همان بازه، یک سال عقب‌تر"
              >
                {String(applied.fromJalali || '').slice(0, 7) === String(applied.toJalali || '').slice(0, 7)
                  ? 'در مقابل همین ماه پارسال'
                  : 'در مقابل همین بازه در سال پیش'}
              </button>
            </div>
            {data?.a && data?.b ? <CompareCards a={data.a} b={data.b} /> : <EmptyChart />}
          </>
        )}

        {tab === 'staff' && (
          /**
           * B8 (بازبینی دهم) — `mgmtStaff` در main قفل `staffPerformance` را می‌خواهد، ولی
           * همین‌جا دروازه‌ای نبود: کاربر به‌جای درخواستِ رمز، متنِ خطای خام می‌دید. قفل دور
           * زده نمی‌شد (همان‌جا رد می‌شد)، فقط راهِ درستِ بازکردن نبود. پس همان دروازهٔ
           * استفاده‌شده در تب سود، با همان رمزِ نشست.
           */
          <ManagerGate
            panel={PANEL_KEYS.staffPerformance}
            title="عملکرد فروشنده"
            reason="جمع فروش و تخفیف هر فروشنده را نشان می‌دهد؛ همان قفلِ تب «عملکرد کارمند» در گزارش فروش، نه رمزِ تازه."
            inline
          >
          <>
            <p className="text-[11px] text-slate-600 mb-2">{data?.note}</p>
            <HBarChart rows={(data?.rows ?? []).map((r: any) => ({ label: r.userName, value: r.salesTotal }))} />
            <table className="tbl mt-3 text-xs">
              <thead>
                <tr>
                  <th>فروشنده</th>
                  <th>جمع فاکتور (نه فروش خالص)</th>
                  <th>تعداد</th>
                  <th>تخفیف</th>
                  <th>٪ تخفیف</th>
                  <th>برگشت ثبت‌شده</th>
                  <th>تعویض</th>
                  <th>اعتبار صادر</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r: any) => (
                  <tr key={String(r.userId)}>
                    <td>{r.userName}</td>
                    <td className="tabular-nums">{money(r.salesTotal)}</td>
                    <td>{r.invoiceCount}</td>
                    <td className="tabular-nums">{money(r.discountTotal)}</td>
                    <td>{Number(r.discountPercent || 0).toFixed(1)}</td>
                    <td className="tabular-nums">{money(r.returnTotal)}</td>
                    <td className="tabular-nums">{money(r.exchangeTotal)}</td>
                    <td className="tabular-nums">{money(r.storeCreditTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
          </ManagerGate>
        )}

        {tab === 'category' && (
          <>
            {data?.reconcilable === false ? (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded p-2 mb-2">
                ناهمخوان با تخصیص اقلام — نمودار قفل است.
              </div>
            ) : (
              <DonutChart rows={data?.rows ?? []} />
            )}
            <p className="text-[11px] text-slate-600 mt-2">{data?.note}</p>
            <p className="text-xs mt-1">
              جمع همین جدول (پس از برگشت{data?.categoryFiltered ? ' و فیلتر دسته' : ''}):{' '}
              <b>{money(data?.shownSum)}</b> · جمع ارزش اقلام فاکتورها (پیش از برگشت و بدون فیلتر دسته،
              همان چیزی که با پرداختِ فاکتور باید بخواند): <b>{money(data?.lineSum)}</b> · فروش خالص تعهدی
              گزارش فروش: <b>{money(data?.netAccrualSales)}</b>
            </p>
            <table className="tbl mt-2 text-xs">
              <thead>
                <tr>
                  <th>دسته</th>
                  <th>ارزش اقلام بعد از برگشت</th>
                  <th>تعداد</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r: any) => (
                  <tr key={r.categoryId != null ? `id:${r.categoryId}` : `name:${r.name}`}>
                    <td>{r.name}</td>
                    <td className="tabular-nums">{money(r.amount)}</td>
                    <td>{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === 'stock' && (
          <>
            <div className="flex gap-3 text-xs mb-2">
              <label>
                حداقل مانده
                <input
                  type="number"
                  className="border rounded px-2 py-1 mr-1 w-20"
                  value={minStock}
                  onChange={(e) => setMinStock(Number(e.target.value) || 0)}
                />
              </label>
              <span className="text-[11px] text-slate-500 self-center">
                موجودی منفی همیشه نمایش داده می‌شود (بیش‌فروختگی پنهان نماند).
              </span>
              <label>
                بدون فروش از تاریخ
                <input
                  className="border rounded px-2 py-1 mr-1"
                  value={idleSince}
                  onChange={(e) => setIdleSince(toLatinDigits(e.target.value))}
                  placeholder="1405/01/01"
                  dir="ltr"
                />
              </label>
            </div>
            <p className="text-[11px] text-slate-600 mb-2">
              {data?.note} {data?.valueLabel}
            </p>
            {data?.asOfPast ? (
              <p className="text-[11px] text-slate-500 mb-2">
                بازه تا {data?.asOfDate} بسته شده: «خواب» و «نرخ فروش» نسبت به همان تاریخ‌اند، ولی ستون{' '}
                <b>مانده</b> همان عددِ همین‌لحظهٔ انبار است (موجودیِ تاریخ‌مقابل نداریم).
              </p>
            ) : null}
            {data?.clearanceLabel ? <p className="text-[11px] text-amber-800 mb-2">{data.clearanceLabel}</p> : null}
            <p className="text-xs mb-2">
              مانده تعداد: <b>{data?.totalQty ?? 0}</b>
              {data?.totalReplacement != null ? (
                <>
                  {' '}
                  · ارزش جایگزینی امروز: <b>{money(data.totalReplacement)}</b>
                </>
              ) : null}
              {data?.idleCapital > 0 ? (
                <>
                  {' '}
                  · سرمایهٔ خوابیدهٔ ۹۰روز: <b>{money(data.idleCapital)}</b> ({data.idleCount} کالا)
                </>
              ) : null}
            </p>
            {(data?.reorder ?? []).length > 0 && (
              <p className="text-[11px] text-amber-800 mb-2">
                پیشنهاد سفارش (پوشش ≤ ۱۰ روز یا تمام‌شده — «۰روز» یعنی مانده تمام شده؛ فاکتور خودکار ساخته نمی‌شود):{' '}
                {data.reorder
                  .slice(0, 8)
                  .map((r: any, i: number) => (
                    <span key={r.variantId} className={Number(r.stock) < 0 ? 'text-rose-700 font-bold' : ''}>
                      {i ? '، ' : ''}
                      {r.productName} {r.size} (مانده {r.stock} · {r.coverDays}روز)
                    </span>
                  ))}
                {(data.reorder ?? []).some((r: any) => Number(r.stock) < 0)
                  ? ' · عدد منفی = بیش‌فروختگی یا دادهٔ خراب انبار'
                  : ''}
              </p>
            )}
            <div className="overflow-auto">
              <table className="tbl text-xs">
                <thead>
                  <tr>
                    <th>کالا</th>
                    <th>سایز</th>
                    <th>رنگ</th>
                    <th>مانده</th>
                    <th>فروش ۳۰روز</th>
                    <th>فروش ۹۰روز</th>
                    <th>خواب (روز)</th>
                    <th>پوشش روز</th>
                    <th title="از آنچه در ۹۰ روز در دسترس بوده (رفته + مانده) چند درصد رفته">نرخ فروش</th>
                    {data?.rows?.[0]?.replacementValue != null || data?.totalReplacement != null ? (
                      <th>ارزش جایگزینی</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((r: any) => (
                    <tr key={r.variantId} className={r.belowMin ? 'bg-amber-50' : ''}>
                      <td>
                        {r.productName}
                        {r.approx ? <span className="mr-1 text-[10px] text-amber-800">تقریبی</span> : null}
                      </td>
                      <td>{r.size}</td>
                      <td>{r.color}</td>
                      <td className={r.stockNegative || r.stock < 0 ? 'text-rose-700' : ''}>{r.stock}</td>
                      <td>{r.netSold30}</td>
                      <td>{r.netSold90}</td>
                      <td>{r.neverSold ? `${r.sleepDays ?? '—'} (هرگز فروش)` : r.sleepDays ?? '—'}</td>
                      <td>{r.coverDays ?? '—'}</td>
                      <td className={Number(r.sellThrough ?? 0) < 25 && Number(r.stock) > 0 ? 'text-amber-800' : ''}>
                        {r.sellThrough == null ? '—' : `${r.sellThrough}٪`}
                        {r.clearance ? (
                          <span className="mr-1 text-[10px] text-amber-800" title={r.clearance}>
                            حراج
                          </span>
                        ) : null}
                      </td>
                      {r.replacementValue != null ? (
                        <td className="tabular-nums">{money(r.replacementValue)}</td>
                      ) : data?.totalReplacement != null ? (
                        <td>—</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'abc' && (
          <>
            <p className="text-[11px] text-slate-600 mb-2">{data?.note}</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-bold text-sm mb-1">ABC فروش</h3>
                <table className="tbl text-xs">
                  <thead>
                    <tr>
                      <th>کلاس</th>
                      <th>کالا</th>
                      <th>ارزش ۹۰روز</th>
                      <th>سهم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).map((r: any) => (
                      <tr key={r.productId}>
                        <td>{r.cls}</td>
                        <td>{r.name}</td>
                        <td className="tabular-nums">{money(r.amount)}</td>
                        <td>{Math.round((r.share || 0) * 1000) / 10}٪</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data?.profitRows ? (
                <div>
                  <h3 className="font-bold text-sm mb-1">ABC سود واقعی</h3>
                  <ManagerGate
                    panel={PANEL_KEYS.managementProfit}
                    title="سود ABC"
                    reason="سود واقعی حاشیه را نشان می‌دهد؛ قفل جدا از گزارش مدیریت است."
                    inline
                  >
                    <table className="tbl text-xs">
                      <thead>
                        <tr>
                          <th>کلاس</th>
                          <th>کالا</th>
                          <th>سود واقعی</th>
                          <th>سهم</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.profitRows.map((r: any) => {
                          const saleCls = (data.rows ?? []).find((x: any) => x.productId === r.productId)?.cls
                          return (
                            <tr key={`p${r.productId}`} className={saleCls === 'A' && r.cls === 'C' ? 'bg-amber-50' : ''}>
                              <td>{r.cls}</td>
                              <td>
                                {r.name}
                                {saleCls === 'A' && r.cls === 'C' ? (
                                  <span className="mr-1 text-[10px] text-amber-800">A فروش / C سود</span>
                                ) : null}
                              </td>
                              <td className="tabular-nums">{money(r.realProfit)}</td>
                              <td>{Math.round((r.share || 0) * 1000) / 10}٪</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </ManagerGate>
                </div>
              ) : data?.profitBusy ? null : (
                <p className="text-[11px] text-slate-500">جدول سود واقعی پشت قفل سود است؛ ABC فروش بدون فی خرید دیده می‌شود.</p>
              )}
            </div>
          </>
        )}

        {tab === 'size' && (
          <>
            <p className="text-[11px] text-slate-600 mb-2">{data?.note}</p>
            {(data?.products ?? []).map((p: any) => (
              <div key={p.productId} className="mb-4">
                <h3 className="font-bold text-sm mb-1">{p.name}</h3>
                <table className="tbl text-xs">
                  <thead>
                    <tr>
                      <th>سایز</th>
                      <th>مانده</th>
                      <th>فروش ۹۰روز</th>
                      <th>سهم فروش</th>
                      <th>سهم مانده</th>
                      <th>برای سفارش بعدی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(p.sizes || {}).map(([sz, v]: any) => (
                      <tr key={sz} className={v.advice === 'بیشتر بخر' ? 'bg-amber-50' : v.advice === 'کمتر بخر' ? 'bg-slate-50' : ''}>
                        <td>{sz}</td>
                        <td className={Number(v.stock) < 0 ? 'text-rose-700 font-bold' : ''}>{v.stock}</td>
                        <td>{v.sold90}</td>
                        <td className="tabular-nums">{v.soldShare ?? 0}٪</td>
                        <td className="tabular-nums">{v.stockShare ?? 0}٪</td>
                        <td>{v.advice || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}

        {tab === 'heat' && <Heatmap cells={data?.cells ?? []} weekdays={data?.weekdays ?? []} />}

        {tab === 'buy' && data && (
          <div className="space-y-2 text-sm">
            <p>{data.label}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat title="خرید تأییدشده" value={money(data.purchaseTotal)} />
              {data.fifoSoldCost != null ? (
                <Stat title="بهای تمام‌شده FIFO فروخته‌شده" value={money(data.fifoSoldCost)} />
              ) : null}
              {data.accumulation != null ? (
                <Stat title="انباشت در کالا" value={money(data.accumulation)} warn={data.accumulation > 0} />
              ) : null}
              <Stat title="فروش خالص تعهدی (گزارش فروش)" value={money(data.netAccrualSales)} />
            </div>
            <Warn notes={data.warnings} />
          </div>
        )}

        {tab === 'profit' && (
          <ManagerGate
            panel={PANEL_KEYS.managementProfit}
            title="سود و تورم"
            reason="سود واقعی و سود جایگزینی حاشیه و فی خرید را نشان می‌دهد؛ قفل جدا از خودِ گزارش مدیریت است تا رمزش را فقط به صاحب مغازه بدهید."
            inline
          >
            <ProfitPane filter={applied} />
          </ManagerGate>
        )}
      </div>
    </div>
  )
}

function ProfitPane({ filter }: { filter: any }) {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [mgrPass, setMgrPass] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildNote, setRebuildNote] = useState('')
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  const profitGate = useRef(createLatestGate())
  const reload = useCallback(() => {
    const seq = profitGate.current.next()
    setLoading(true)
    setErr('')
    return call(CH.mgmtProfit, filter)
      .then((d) => {
        if (!profitGate.current.isLatest(seq)) return
        setData(d)
      })
      .catch((e: any) => {
        if (!profitGate.current.isLatest(seq)) return
        setErr(String(e?.message ?? e))
      })
      .finally(() => {
        if (profitGate.current.isLatest(seq)) setLoading(false)
      })
  }, [filter])

  useEffect(() => {
    void reload()
  }, [reload])

  if (loading && !data) return <p className="text-xs text-slate-500">در حال خواندن سود…</p>
  if (err && !data) return <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded p-2">{err}</div>
  if (!data) return <EmptyChart />
  if (data.busy) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-950 text-sm rounded p-3 leading-6">
        دفتر هزینه مشغول است. عدد سود نشان داده نشد تا با دفتر خالی قاطی نشود. چند ثانیه بعد دوباره باز کنید.
      </div>
    )
  }

  const faint = data.health?.ok === false || (data.exactPct != null && data.exactPct < 1)

  const exportProfit = async () => {
    setExporting(true)
    try {
      await exportTable({
        fileName: 'گزارش-مدیریت-سود',
        sheetName: 'سود',
        title: `سود و تورم — ${data.fromJalali} تا ${data.toJalali}`,
        // نشست ۲۱۶ (سؤال ۳): تا اینجا فقط جدول ماه‌ها خارج می‌شد و «سود دسته» و
        // «سود تامین‌کننده» — که همان چیزی است که حسابدار/شریک می‌خواهد — در فایل
        // نمی‌آمد. یک برگه با ستون «بخش»؛ بدون دست‌زدن به لایه‌ی xlsx.
        headers: ['بخش', 'ردیف', 'درآمد', 'هزینه FIFO', 'سود واقعی', 'هزینه جایگزینی', 'سود جایگزینی', 'تورم (جایگزینی − FIFO)'],
        rows: [
          ...(data.months ?? []).map((m: any) => [
            'ماه', m.month, m.revenue, m.fifoCost, m.realProfit, m.replacementCost, m.replacementProfit, m.inflationOnSold
          ]),
          ...(data.byCategory ?? []).map((c: any) => [
            'دسته', c.name, c.revenue, c.fifoCost, c.realProfit, c.replacementCost, c.replacementProfit,
            Number(c.replacementCost || 0) - Number(c.fifoCost || 0)
          ]),
          ...(data.bySupplier ?? []).map((sp: any) => [
            'تامین‌کننده', sp.name, sp.revenue, sp.fifoCost, sp.realProfit, sp.replacementCost, sp.replacementProfit,
            Number(sp.replacementCost || 0) - Number(sp.fifoCost || 0)
          ])
        ]
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`space-y-3 text-sm ${faint ? 'bg-amber-50/40 -m-3 p-3 rounded' : ''}`}>
      {err ? <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded p-2">{err}</div> : null}
      <div className="flex flex-wrap justify-end gap-2 items-center">
        <input
          type="password"
          className="border rounded px-2 py-1 text-xs"
          placeholder="رمز مدیر برای بازسازی"
          value={mgrPass}
          onChange={(e) => setMgrPass(e.target.value)}
        />
        <button
          className="border rounded px-3 py-1 text-xs"
          disabled={rebuilding || !mgrPass}
          onClick={() => setConfirmRebuild(true)}
        >
          {rebuilding ? 'در حال بازسازی…' : 'بازسازی دفتر هزینه'}
        </button>
        <button className="border rounded px-3 py-1 text-xs" onClick={() => void exportProfit()} disabled={exporting}>
          {exporting ? 'در حال ساخت…' : 'اکسل سود (ماه + دسته + تامین‌کننده)'}
        </button>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs leading-6">
        <p>جنس را با فاکتور خرید وارد کنید. دستکاری موجودی پنل کالا سود را تقریبی می‌کند.</p>
        <p>نام تامین‌کننده روی فاکتور خرید اجباری نیست؛ بدون نام، سود آن سطر «فاقد نام تامین‌کننده» می‌شود.</p>
        <p>
          <b>تورم ایران روی سود.</b> سود واقعی از فی همان خرید است. سود جایگزینی همان فروش را با فی آخرین فاکتور خریدِ
          لحظهٔ قفل شدن می‌سنجد (فی «امروز» نیست؛ ارزش ماندهٔ انبار است که امروز حساب می‌شود). عوض کردن فی کارت، سود
          قفل‌شده را عوض نمی‌کند مگر «بازسازی دفتر» بزنید. اصلاح فی روی فاکتور خرید، فروش‌های قفل‌شده‌ی همان فاکتور را
          خودش هم در FIFO و هم در جایگزینی درست می‌کند.
        </p>
      </div>
      <ConfirmDialog
        open={confirmRebuild}
        title="بازسازی دفتر هزینه"
        message={
          (Number(data?.missingPurchaseRows?.length ?? 0) > 0
            ? `${Number(data?.missingPurchaseRows?.length ?? 0).toLocaleString('fa-IR')} کالای «فی از کارت» داری که فیِ قفل‌شده‌شان با بازسازی به فیِ امروزِ کارت بازنویسی می‌شود. `
            : '') +
          'سود ماه‌های قبل ممکن است عوض شود، مخصوصاً اگر کالایی فاکتور خرید نداشته و فی کارتش عوض شده. ادامه می‌دهید؟'
        }
        confirmLabel="بله، بازسازی کن"
        busy={rebuilding}
        onCancel={() => setConfirmRebuild(false)}
        onConfirm={() => {
          setRebuilding(true)
          call(CH.mgmtCostEngineRebuild, { managerPassword: mgrPass })
            .then((r: any) => {
              if (r?.busy) {
                setErr('دفتر هزینه مشغول است. بازسازی انجام نشد؛ کمی بعد دوباره بزنید.')
                return
              }
              /**
               * B4 (بازبینی نهم) — بازسازی «اول پاک می‌کند، بعد می‌سازد» است؛ اگر حرکتی
               * خراب باشد روی همان حرکت می‌ایستد و همه‌چیز بی‌فی می‌ماند. پس دفتر با
               * خطایِ باز، پاک نمی‌کند و همین پیام را می‌دهد (خطاهای یتیم قبلش پاک می‌شوند
               * تا بازسازی برای همیشه قفل نشود).
               */
              if (r?.refused) {
                setRebuildNote(String(r.refuseReason ?? 'بازسازی انجام نشد.'))
                setMgrPass('')
                setConfirmRebuild(false)
                return
              }
              setRebuildNote('')
              setMgrPass('')
              setConfirmRebuild(false)
              reload()
            })
            .catch((e: any) => setErr(String(e?.message ?? e)))
            .finally(() => setRebuilding(false))
        }}
      />
      {rebuildNote ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded p-2 leading-6">
          {rebuildNote}
          <button className="mr-2 underline" onClick={() => setRebuildNote('')}>
            بستن
          </button>
        </div>
      ) : null}
      {data.health?.ok === false ? (
        <div className="bg-amber-50/80 border border-amber-200 text-amber-900 text-xs rounded p-2">
          ماندهٔ لات با موجودی {data.health.mismatchCount ?? 0} کالا یکی نیست. عددها پنهان نمی‌شوند.
          {(data.health.mismatches ?? []).slice(0, 8).map((m: any) => (
            <div key={m.variantId}>
              {m.productName || m.code}: موجودی {m.stock} · لات {m.lots}
            </div>
          ))}
        </div>
      ) : null}
      {data.exactPct != null && data.exactPct < 1 ? (
        <div className="bg-amber-100 border border-amber-300 text-amber-950 text-sm rounded p-3 leading-6">
          فقط {Math.round((data.exactPct || 0) * 1000) / 10}٪ اقلام فی دقیق از فاکتور خرید دارند
          {data.exactPctRial != null
            ? ` — به ریالِ درآمد هم ${Math.round((data.exactPctRial || 0) * 1000) / 10}٪ دقیق است`
            : ''}
          . بقیه تقریبی‌اند — سود قطعی صندوق نیست. ورود جنس از فاکتور خرید باشد، نه دستکاری
          موجودی پنل کالا.
          {/* B2/#2 (بازبینی یازدهم) — درصدِ «تعدادِ قلم» با درصدِ «پول» فرق دارد: یک قلمِ
              بی‌فیِ گران می‌تواند شمارش را دست‌نخورده بگذارد ولی نصفِ سود را نامطمئن کند. */}
        </div>
      ) : null}
      <div className="text-xs text-slate-600">
        دفتر هزینه تا حرکت {data.engine?.lastMovementId ?? 0} از {data.engine?.headMovementId ?? 0} پردازش شده
        {data.engine?.behind > 0 ? ` (${data.engine.behind} حرکت عقب — سود قلم‌های تازه هنوز تقریبی است)` : ' · به‌روز'}
        {data.engine?.reconcileError ? ` · خطای ویرایش فاکتور: ${data.engine.reconcileError}` : ''}
        {data.engine?.reconcile?.maxId
          ? ` · جاروی ویرایش‌ها تا قلم ${data.engine.reconcile.cur.toLocaleString('fa-IR')} از ${data.engine.reconcile.maxId.toLocaleString('fa-IR')} (هر اجرا یک پنجره، تا دیتابیسِ چندساله ثبت فروش صندوق را معطل نکند)`
          : ''}
      </div>
      {data.engine?.cursorRef ? (
        <div className="text-[11px] text-slate-500">
          آخرین حرکتِ پردازش‌شده: {data.engine.cursorRef.refType === 'SaleInvoice'
            ? `فیش فروش شماره ${Number(data.engine.cursorRef.refId ?? 0).toLocaleString('fa-IR')}`
            : data.engine.cursorRef.refType === 'PurchaseInvoice'
              ? `فاکتور خرید شماره ${Number(data.engine.cursorRef.refId ?? 0).toLocaleString('fa-IR')}`
              : data.engine.cursorRef.refType === 'SaleReturn'
                ? `برگشت از فروش شماره ${Number(data.engine.cursorRef.refId ?? 0).toLocaleString('fa-IR')}`
                : `حرکت ${data.engine.cursorRef.reason}`}{' '}
          {data.engine.cursorRef.at ? `(${data.engine.cursorRef.at}) ` : ''}· شمارهٔ حرکت {Number(data.engine.cursorRef.movementId).toLocaleString('fa-IR')}
        </div>
      ) : null}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat title="سود واقعی خرید" value={money(data.realProfit)} />
        <Stat title="سود جایگزینی" value={money(data.replacementProfit)} />
        <Stat title="سود تورمی کالای ارزان‌خریده" value={money(data.inflationOnSold)} warn={data.inflationOnSold > 0} />
        <Stat title="فروش زیر فی جایگزینی لحظهٔ قفل" value={String(data.belowReplacement ?? 0)} warn={data.belowReplacement > 0} />
      </div>
      <p className="text-[11px] text-slate-600">
        دقت فی خرید {Math.round((data.exactPct || 0) * 1000) / 10}٪ از قلم‌های دارای فی
        {data.exactPctRial != null
          ? ` · ${Math.round((data.exactPctRial || 0) * 1000) / 10}٪ از درآمد (به ریال)`
          : ''}
        {data.excludedFromPct > 0 ? ` (${data.excludedFromPct} قلم بدون فی/بیرون فروشگاه در مخرج نیست)` : ''}
        {data.unnamedSupplierShare > 0
          ? ` · ${Math.round(data.unnamedSupplierShare * 1000) / 10}٪ درآمد از فاکتور بدون نام تامین‌کننده`
          : ''}
        {/* B1 (بازبینی یازدهم) — قراردادِ فی جایگزینی روی صفحه نوشته می‌شود تا «کِی تب را
            باز کردی» هیچ‌وقت معنای عدد را عوض نکند. */}
        · فی جایگزینیِ هر قلم = آخرین فاکتور خرید «تا تاریخ همان فروش» (قفل می‌شود و با
        «بازسازی دفتر» عوض نمی‌شود)؛ ارزشِ ماندهٔ قفسه با فیِ امروز.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat title="درآمد اقلام" value={money(data.revenue)} />
        <Stat title="هزینه واقعی (FIFO)" value={money(data.fifoCost)} />
        <Stat title="هزینه جایگزینی" value={money(data.replacementCost)} />
        <Stat title="فروش خالص گزارش فروش" value={money(data.netAccrualSales)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Stat title="مانده به فی تمام‌شده" value={money(data.stock?.fifoValue)} />
        <Stat title="مانده به فی جایگزینی (آخرین فاکتور خرید)" value={money(data.stock?.replacementValue)} />
        <Stat title="ثروت کاغذی تورمی انبار" value={money(data.stock?.paperWealth)} warn={data.stock?.paperWealth > 0} />
      </div>
      <p className="text-[11px] text-slate-600">
        حاشیه واقعی {Math.round((data.realMargin || 0) * 1000) / 10}٪ · حاشیه جایگزینی{' '}
        {Math.round((data.replacementMargin || 0) * 1000) / 10}٪
      </p>
      <Warn notes={data.notes} extra={data.warnings} />
      {(data.months ?? []).length > 0 && (
        <p className="text-[11px] text-slate-600">
          برگشتِ کالا در ماهِ «خودِ برگشت» از درآمد و هزینه کم می‌شود، نه ماهِ فروشش؛ پس
          «تورم فروش» یک ماه می‌تواند کوچک‌تر یا منفی به نظر برسد.
        </p>
      )}
      {(data.months ?? []).length > 0 && (
        <table className="tbl text-xs">
          <thead>
            <tr>
              <th>ماه</th>
              <th>درآمد</th>
              <th>سود واقعی</th>
              <th>سود جایگزینی</th>
              <th>تورم فروش</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m: any) => (
              <tr key={m.month}>
                <td>{m.month}</td>
                <td className="tabular-nums">{money(m.revenue)}</td>
                <td className="tabular-nums">{money(m.realProfit)}</td>
                <td className="tabular-nums">{money(m.replacementProfit)}</td>
                <td className="tabular-nums">{money(m.inflationOnSold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(data.belowLines ?? []).length > 0 && (
        <>
          <p className="text-xs font-bold mt-2">فروش زیر فی جایگزینی لحظهٔ قفل (نه فی همین لحظهٔ صفحه)</p>
          <table className="tbl text-xs">
            <thead>
              <tr>
                <th>فاکتور</th>
                <th>کالا</th>
                <th>سایز</th>
                <th>درآمد</th>
                <th>جایگزینی</th>
                <th>اختلاف</th>
              </tr>
            </thead>
            <tbody>
              {data.belowLines.map((l: any) => (
                <tr key={l.saleItemId} className="bg-amber-50/70">
                  <td>{l.receiptNo ?? l.invoiceId}</td>
                  <td>{l.productName}</td>
                  <td>{l.size}</td>
                  <td className="tabular-nums">{money(l.revenue)}</td>
                  <td className="tabular-nums">{money(l.replacementCost)}</td>
                  <td className="tabular-nums text-rose-700">
                    {money((l.replacementCost ?? 0) - (l.revenue ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.losses && Number(data.losses.moves) > 0 ? (
        <>
          <p className="text-xs font-bold mt-2">کسری، ضایعات و خروج‌های بدون فروش این بازه</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat title="تعداد حرکت کسری/ضایعات" value={String(data.losses.moves ?? 0)} warn={(data.losses.moves ?? 0) > 0} />
            <Stat title="تعداد کسرشده" value={String(data.losses.qty ?? 0)} />
            <Stat title="بهای تمام‌شدهٔ آن (از لات FIFO)" value={money(data.losses.cost ?? 0)} warn={(data.losses.cost ?? 0) > 0} />
            <Stat
              title="خالص پس از اصلاح مثبتِ همین بازه"
              value={String(data.losses.netQty ?? data.losses.qty ?? 0)}
              warn={Number(data.losses.gainQty ?? 0) > 0}
            />
          </div>
          {Number(data.losses.gainQty ?? 0) > 0 ? (
            <p className="text-[11px] text-slate-600 mt-1">
              در همین بازه {Number(data.losses.gainMoves ?? 0).toLocaleString('fa-IR')} حرکتِ اصلاحِ مثبت هم داشته‌ایم
              ({Number(data.losses.gainQty ?? 0).toLocaleString('fa-IR')} عدد ورود) — مثلاً تایپ اشتباه که بعد
              درست شده. برای همان ورودی‌ها بهایِ ساختگی نمی‌گذاریم (ورود که مصرفِ لات ندارد)، پس فقط تعداد
              خالص کم می‌شود و «بهای تمام‌شدهٔ کسری» دست‌نخورده می‌ماند.
            </p>
          ) : null}
          {/* B6 (بازبینی دوازدهم) — این کارت دو چیز را نمی‌گفت: برای **کل مغازه** است (فیلترِ دسته/
              فروشندهٔ صفحه روی حرکت‌های انبار اعمال نمی‌شود) و بازه اگر بیشتر از ۵۰۰۰ حرکت داشت،
              سرجمع از ۵۰۰۰ تای اول ساخته شده. حالا هر دو نوشته می‌شود — عدد عوض نمی‌شود. */}
          {data.losses.truncated || Number(filter?.categoryId ?? 0) > 0 || Number(filter?.userId ?? 0) > 0 ? (
            <p className="text-[11px] text-amber-700 mt-1">
              {data.losses.truncated
                ? 'این بازه بیش از ۵۰۰۰ حرکت داشت؛ سرجمع‌های بالا از ۵۰۰۰ حرکتِ اول ساخته شده و کمتر از واقع است. '
                : ''}
              حرکت‌های انبار فیلترِ دسته و فروشنده را نمی‌خوانند — این عدد برای کل مغازه است، نه همان انتخابِ صفحه.
            </p>
          ) : null}
          {(data.losses.rows ?? []).length > 0 ? (
            <ul className="text-[11px] text-slate-600 mt-1">
              {(data.losses.rows as any[]).map((r) => (
                <li key={r.reason}>
                  {r.label}: {Number(r.qty).toLocaleString('fa-IR')} عدد · {money(r.cost)} ·{' '}
                  {Number(r.moves).toLocaleString('fa-IR')} حرکت
                  {Number(r.gain ?? 0) > 0
                    ? ` · اصلاح مثبت ${Number(r.gain).toLocaleString('fa-IR')} ⇒ خالص ${Number(r.net).toLocaleString('fa-IR')}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] text-slate-500 mt-1">{data.losses.note}</p>
        </>
      ) : null}
      {(data.bySupplier ?? []).length > 0 && (
        <>
          <p className="text-xs font-bold mt-2">سود به تفکیک تامین‌کننده (از فاکتور خرید، نه فروشندهٔ مغازه)</p>
          <table className="tbl text-xs">
            <thead>
              <tr>
                <th>تامین‌کننده</th>
                <th>کد</th>
                <th>درآمد</th>
                <th>سود واقعی</th>
                <th>سود جایگزینی</th>
              </tr>
            </thead>
            <tbody>
              {data.bySupplier.map((s: any) => (
                <tr key={s.name}>
                  <td>
                    {s.name}
                    {Number(s.partyCount) > 1 ? (
                      <span className="text-amber-700" title={`نام یکی است ولی ${s.partyCount} رکورد جدا در فهرست تامین‌کننده‌ها هست — برای ادغام، از خودِ فهرست تامین‌کننده‌ها اقدام کنید.`}>
                        {' '}
                        ({Number(s.partyCount)} رکورد)
                      </span>
                    ) : null}
                  </td>
                  <td title={s.codes?.length > 1 ? `چند کد زیر یک نام: ${s.codes.join('، ')}` : undefined}>
                    {s.codes?.length > 1 ? `${s.codes.slice(0, 2).join(' و ')}…` : (s.code ?? '—')}
                  </td>
                  <td className="tabular-nums">{money(s.revenue)}</td>
                  <td className="tabular-nums">{money(s.realProfit)}</td>
                  <td className="tabular-nums">{money(s.replacementProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {(data.byCategory ?? []).length > 0 && (
        <>
          <p className="text-xs font-bold mt-2">سود به تفکیک دسته</p>
          <table className="tbl text-xs">
            <thead>
              <tr>
                <th>دسته</th>
                <th>درآمد</th>
                <th>سود واقعی</th>
                <th>سود جایگزینی</th>
              </tr>
            </thead>
            <tbody>
              {data.byCategory.map((c: any) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="tabular-nums">{money(c.revenue)}</td>
                  <td className="tabular-nums">{money(c.realProfit)}</td>
                  <td className="tabular-nums">{money(c.replacementProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {(data.missingPurchaseRows ?? []).length > 0 && (
        <>
          <p className="text-xs font-bold mt-2">
            کالاهایی که فاکتور خرید ندارند — فی تقریبی است. ورود جنس از فاکتور خرید.
          </p>
          {/* B4 (بازبینی دوازدهم) — «فیِ قفل‌شده با بازسازی عوض نمی‌شود» برای این کالاها وعده‌ای نیست که
              بتوانیم بدهیم: فیِ کارتیِ بدون‌فاکتور در لحظهٔ خواندن از روی کارت ساخته می‌شود، پس «بازسازی
              دفتر» فیِ قفل‌شدهٔ فروش‌هایشان را به فیِ **امروزِ کارت** می‌برد (تاریخِ فروش، تاریخِ فی نیست).
              عمداً «فریز» نکرده‌ایم: فریزکردنِ گزینشی یعنی بازسازی دیگر replay بی‌ضرر نیست و کلاسِ تازه‌ای
              از باگ می‌سازد. به‌جایش همان‌جا که تصمیم می‌گیرید عدد را می‌بینید. */}
          <p className="text-[11px] text-slate-600">
            {Number(data.missingPurchaseRows.length).toLocaleString('fa-IR')} لاتِ «فی از کارت کالا» در دفتر هست.
            فیِ این کالاها از فاکتور خرید خوانده نمی‌شود، پس با «بازسازی دفتر» به فیِ امروزِ کارت بازنویسی
            می‌شود — اگر فی کارت را عوض کرده‌اید، سودِ ماه‌های قبلِ این کالاها هم عوض می‌شود.
          </p>
          <ul className="text-xs text-amber-900 list-disc pr-4">
            {data.missingPurchaseRows.slice(0, 30).map((r: any) => (
              <li key={r.variantId}>
                {r.productName} {r.size} {r.code ? `(${r.code})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Stat({ title, value, warn }: { title: string; value: string; warn?: boolean }) {
  return (
    <div className={`border rounded p-3 ${warn ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className="text-[11px] text-slate-500">{title}</div>
      <div className="font-bold tabular-nums mt-1">{value}</div>
    </div>
  )
}

function Warn({ notes, extra }: { notes?: string[]; extra?: string[] }) {
  const all = [...new Set([...(notes || []), ...(extra || [])].filter(Boolean))]
  if (!all.length) return null
  return (
    <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2 space-y-0.5">
      {all.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  )
}

function NumTable({ rows, cols }: { rows: any[]; cols: [string, string, boolean?][] }) {
  if (!rows?.length) return null
  return (
    <table className="tbl mt-3 text-xs">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c[0]}>{c[1]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c[0]} className={c[2] ? 'tabular-nums' : ''}>
                {c[2] ? money(r[c[0]]) : r[c[0]]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CompareCards({ a, b }: { a: any; b: any }) {
  const av = a.accounting?.invoice?.netAccrualSales ?? 0
  const bv = b.accounting?.invoice?.netAccrualSales ?? 0
  const d = av - bv
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="border rounded p-3">
        <div className="text-xs text-slate-500">بازهٔ جاری · {a.label}</div>
        <div className="text-lg font-bold tabular-nums">{money(av)}</div>
        <div className="text-xs">فاکتور: {a.accounting?.invoice?.invoiceCount ?? 0}</div>
      </div>
      <div className="border rounded p-3">
        <div className="text-xs text-slate-500">بازهٔ مقایسه · {b.label}</div>
        <div className="text-lg font-bold tabular-nums">{money(bv)}</div>
        <div className="text-xs">فاکتور: {b.accounting?.invoice?.invoiceCount ?? 0}</div>
      </div>
      <div className="md:col-span-2 text-sm">
        اختلاف فروش خالص:{' '}
        <b className={d >= 0 ? 'text-teal-700' : 'text-rose-700'}>
          {d >= 0 ? '+' : ''}
          {money(d)}
        </b>
      </div>
    </div>
  )
}

function MonthTarget({ toJalali }: { toJalali: string }) {
  const [row, setRow] = useState<any>(null)
  const [draft, setDraft] = useState('')
  const [showProfit, setShowProfit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setErr('')
    call<any>(CH.mgmtTargetGet, { toJalali })
      .then((d) => {
        setErr('')
        setRow(d)
        setDraft(d?.target ? String(d.target) : '')
      })
      .catch((e: any) => setErr(String(e?.message ?? e)))
  }, [toJalali])

  useEffect(() => {
    load()
  }, [load])

  if (!row && !err) return null
  const pct = row?.target > 0 ? Math.round((row.pct || 0) * 1000) / 10 : 0

  return (
    <div className="bg-white border rounded p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-bold text-sm">هدف فروش ماه {row?.monthJalali}</div>
          <p className="text-[11px] text-slate-500">{row?.note}</p>
        </div>
        <div className="flex gap-2 items-center text-xs">
          <input
            className="border rounded px-2 py-1 w-36 tabular-nums"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              // جداکنندهٔ هزارگان فقط موقع نمایش اضافه می‌شود؛ ذخیره همان parseGroupedInteger است.
              const a = parseGroupedInteger(draft)
              if (a != null && a > 0 && String(a) !== draft) setDraft(money(a))
            }}
            placeholder="مبلغ هدف ریال"
          />
          <button
            className="bg-brand text-white rounded px-3 py-1"
            disabled={saving}
            onClick={() => {
              const amount = parseGroupedInteger(draft)
              if (amount == null) {
                setErr('مبلغ هدف باید عدد صحیح ریال باشد (رقم فارسی و جداکننده مجاز است).')
                return
              }
              setSaving(true)
              setErr('')
              call(CH.mgmtTargetSet, { monthJalali: row.monthJalali, amount })
                .then(() => load())
                .catch((e: any) => setErr(String(e?.message ?? e)))
                .finally(() => setSaving(false))
            }}
          >
            {saving ? '…' : 'ثبت هدف'}
          </button>
        </div>
      </div>
      {err ? <div className="text-xs text-rose-700">{err}</div> : null}
      {row?.target > 0 ? (
        <>
          <div className="h-2 bg-slate-100 rounded overflow-hidden">
            <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="text-xs flex flex-wrap gap-3">
            <span>
              فروش خالص این ماه: <b className="tabular-nums">{money(row.netAccrualSales)}</b>
            </span>
            <span>
              هدف: <b className="tabular-nums">{money(row.target)}</b>
            </span>
            <span>{pct}٪</span>
            {row.remaining > 0 && !row.monthComplete ? (
              <span className="text-slate-600">
                مانده {money(row.remaining)} · روز باقی {row.remainingDays ?? '—'} · روزی{' '}
                <b className="tabular-nums">{money(row.dailyNeeded ?? 0)}</b>
              </span>
            ) : null}
            {!row.monthComplete ? <span className="text-slate-500">ماه هنوز تمام نشده — درصد تا امروز است.</span> : null}
            {row.monthComplete && row.target > 0 ? (
              <span className="text-slate-500">
                ماه تمام شده{row.remaining > 0 ? ` · ${money(row.remaining)} از هدف کمتر مانده` : ' · هدف محقق شده'} — «روزی لازم» برای ماهِ بسته معنی ندارد.
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">هدف این ماه ثبت نشده. مبلغ فروش خالص تعهدی را بنویسید، نه سود.</p>
      )}
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={showProfit} onChange={(e) => setShowProfit(e.target.checked)} />
        سود واقعی همین ماه را هم نشان بده (هدف عوض نمی‌شود)
      </label>
      {showProfit ? (
        <ManagerGate
          panel={PANEL_KEYS.managementProfit}
          title="سود این ماه"
          reason="سود حاشیه را نشان می‌دهد؛ قفل جدا از هدف فروش است."
          inline
        >
          <MonthProfitPeek fromJalali={row?.fromJalali} toJalali={row?.toJalali} />
        </ManagerGate>
      ) : null}
    </div>
  )
}

function MonthProfitPeek({ fromJalali, toJalali }: { fromJalali?: string; toJalali?: string }) {
  const [p, setP] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    call(CH.mgmtProfit, { fromJalali, toJalali })
      .then((d) => live && setP(d))
      .catch((e: any) => live && setErr(String(e?.message ?? e)))
    return () => {
      live = false
    }
  }, [fromJalali, toJalali])
  if (err) return <div className="text-xs text-rose-700">{err}</div>
  if (!p) return <p className="text-xs text-slate-500">در حال خواندن سود…</p>
  if (p.busy) {
    return (
      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
        دفتر هزینه مشغول است. سود این ماه نشان داده نشد تا با صفر قاطی نشود.
      </div>
    )
  }
  return (
    <div className="text-xs bg-slate-50 border rounded p-2">
      سود واقعی این ماه: <b className="tabular-nums">{money(p.realProfit)}</b>
      {' · '}
      سود جایگزینی: <b className="tabular-nums">{money(p.replacementProfit)}</b>
      <div className="text-slate-500 mt-1">این عدد هدف نیست. هدف همان فروش خالص بالاست.</div>
    </div>
  )
}
