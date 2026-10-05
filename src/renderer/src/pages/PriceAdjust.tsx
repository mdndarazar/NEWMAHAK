import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { faDigits, isValidJalaliDate, money, toLatinDigits } from '@shared/jalali'
import ManagerGate from '../components/ManagerGate'
import AllProductsModal from '../components/AllProductsModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import JalaliDateInput from '../components/JalaliDateInput'
import PasswordField from '../components/PasswordField'
import { usePanelLock } from '../hooks/usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import {
  PRICE_ADJUST_MODE_LABELS,
  PRICE_ADJUST_STATE_LABELS,
  PRICE_ROUND_LABELS,
  PRICE_ROUND_STEPS,
  normalizeAdjustState,
  type PriceAdjustKind,
  type PriceAdjustMode,
  type PriceAdjustScope,
  type PriceAdjustState,
  type PriceAdjustTarget
} from '@shared/priceAdjust'
import type {
  PriceAdjustBatchRow,
  PriceAdjustDeleteResult,
  PriceAdjustEditResult,
  PriceAdjustInput,
  PriceAdjustLine,
  PriceAdjustPreview,
  PriceAdjustResult,
  PriceAdjustRevertResult
} from '@shared/types'

/**
 * ============ «تغییر قیمت گروهی» — تخفیف / افزایش / کاهش قیمت ============
 *
 * این صفحه با «تخفیف پنل فروش» فرق دارد و این تفاوت مهم است:
 *
 *   • تخفیفِ پنل فروش  → روی یک فاکتور اثر می‌گذارد، قیمت کالا دست‌نخورده می‌ماند.
 *   • این صفحه         → قیمتِ *خودِ کالا* را در انبار عوض می‌کند و از این پس
 *                        روی همه‌ی فاکتورهای بعدی اثر دارد.
 *
 * چون تغییرِ قیمتِ انبوه یک کار برگشت‌ناپذیرِ ظاهری است، سه قاعده رعایت شده:
 *
 *   ۱. هیچ تغییری بدون «پیش‌نمایش» اعمال نمی‌شود. اول دقیقاً می‌بینید چه کالایی
 *      از چه قیمتی به چه قیمتی می‌رود و چند درصد تغییر می‌کند.
 *   ۲. هر اعمال، یک «دسته» (batch) در سابقه ثبت می‌کند که قیمت قبلیِ تک‌تکِ
 *      کالاها را نگه می‌دارد؛ پس دکمه‌ی «بازگردانی» واقعاً همه‌چیز را برمی‌گرداند.
 *   ۳. کل صفحه داخل <ManagerGate> است؛ اگر قفلِ این ماژول روشن باشد، بدون رمز
 *      مدیر حتی پیش‌نمایش هم دیده نمی‌شود.
 *
 * «رند کردن» برای قیمت‌های زشتِ بعد از درصد است: ۴۸۷٬۳۵۰ ریال با گام ۱٬۰۰۰ به
 * ۴۸۷٬۰۰۰ می‌رود. «کمترین قیمت مجاز» هم جلوی صفر یا منفی شدنِ قیمت را می‌گیرد
 * (مثلاً تخفیف ۹۰٪ روی کالای ارزان).
 *
 * ---------------------------------------------------------------------------
 * نشست یازدهم — سه قابلیت تازه‌ی همین صفحه:
 *
 * مورد ۱ «زمان‌بندی خودکار»: دو کادر تاریخ/ساعت (شروع و پایان) پایین فرم. خالی
 *        بمانند = رفتار مو‌به‌موی قبل (دائمی، تا بازگردانی دستی). پر شوند =
 *        زمان‌بندِ برنامه سر همان لحظه اعمال و سر لحظه‌ی پایان بازگردانی می‌کند،
 *        بدون دست زدن شما. ستون «وضعیت» سابقه می‌گوید هر دسته کجای این چرخه است.
 *
 * مورد ۲ «ویرایش دامنه»: روی هر ردیف سابقه دکمه‌ی «ویرایش دامنه» هست. فقط
 *        *دامنه* عوض می‌شود، نه فرمول: کالاهای بیرون‌رفته به قیمت قبل از همان
 *        دسته برمی‌گردند، کالاهای تازه‌وارد با همان قاعده قیمت می‌گیرند و بقیه
 *        دست‌نخورده می‌مانند.
 *
 * مورد ۲ «حذف سابقه»: تیک ردیف‌ها + دکمه‌ی «حذف انتخاب‌شده‌ها». قبل از حذف
 *        صریحاً پرسیده می‌شود: «قیمت‌ها هم به حالت قبل برگردند یا فقط ردیف
 *        سابقه پاک شود؟» — و طبق همان انتخاب عمل می‌شود.
 * ---------------------------------------------------------------------------
 *
 * IPC: priceAdjust:preview · priceAdjust:apply · priceAdjust:batches ·
 *      priceAdjust:batch:lines · priceAdjust:revert · priceAdjust:batch:edit ·
 *      priceAdjust:batches:delete · priceAdjust:schedule:run · category:tree
 * ==================================================================
 */

interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  depth: number
}

const KIND_LABELS: Record<PriceAdjustKind, string> = {
  DISCOUNT: 'تخفیف (کم کردن از قیمت)',
  INCREASE: 'افزایش قیمت',
  DECREASE: 'کاهش قیمت'
}

const SCOPE_LABELS: Record<PriceAdjustScope, string> = {
  ALL: 'همه‌ی کالاها',
  CATEGORY: 'یک دسته‌بندی (و زیردسته‌هایش)',
  VARIANTS: 'فقط کالاهای انتخابی'
}

const TARGET_LABELS: Record<PriceAdjustTarget, string> = {
  SALE: 'قیمت فروش',
  PURCHASE: 'قیمت خرید'
}

/**
 * رنگ ستون «وضعیت» سابقه. عمداً چهار رنگ متفاوت، چون تنها چیزی که مدیر با یک
 * نگاه لازم دارد بداند این است: «این تخفیف *همین حالا* روی قیمت‌ها هست یا نه».
 */
const STATE_CLASS: Record<PriceAdjustState, string> = {
  SCHEDULED: 'bg-sky-100 text-sky-800 border-sky-300',
  APPLIED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  ENDED: 'bg-slate-100 text-slate-600 border-slate-300',
  REVERTED: 'bg-slate-100 text-slate-500 border-slate-300'
}

/** درصد تغییر با علامت، برای ستون آخرِ جدول پیش‌نمایش. */
const pct = (n: number) => `${n > 0 ? '+' : ''}${faDigits(n.toFixed(1))}٪`

/** 'HH:mm' — ارقام فارسی هم پذیرفته می‌شود؛ خالی مجاز است (پیش‌فرض سرور). */
const cleanClock = (v: string) => toLatinDigits(v).trim()
const clockOk = (v: string) => !v || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v)
/** نشست ۱۵۰ — سقف ستون قیمت (همان PRICE_ADJUST_MAX سرور؛ سرور تکیه‌گاه نهایی است). */
const PRICE_INPUT_MAX = 2_147_483_647

function PriceAdjustInner() {
  const nav = useNavigate()

  // ---------- فرم ----------
  const [kind, setKind] = useState<PriceAdjustKind>('DISCOUNT')
  const [mode, setMode] = useState<PriceAdjustMode>('PERCENT')
  const [value, setValue] = useState(0)
  const [scope, setScope] = useState<PriceAdjustScope>('ALL')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [picked, setPicked] = useState<{ id: number; name: string }[]>([])
  const [target, setTarget] = useState<PriceAdjustTarget>('SALE')
  const [round, setRound] = useState<number>(1)
  const [minPrice, setMinPrice] = useState(0)
  const [note, setNote] = useState('')
  // ---------- مورد ۱: زمان‌بندی خودکار (هر چهار فیلد اختیاری) ----------
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')

  // ---------- داده ----------
  const [cats, setCats] = useState<CategoryNode[]>([])
  const [preview, setPreview] = useState<PriceAdjustPreview | null>(null)
  const [batches, setBatches] = useState<PriceAdjustBatchRow[]>([])
  const [openBatch, setOpenBatch] = useState<number | null>(null)
  const [batchLines, setBatchLines] = useState<PriceAdjustLine[]>([])

  // ---------- وضعیت ----------
  const [busy, setBusy] = useState(false)
  /**
   * نشست ۱۵۰ · بند ۴-۳۹ — گیت main تغییر گروهی قیمت: رمز هر عملیات (اعمال، ویرایش
   * دامنه، بازگردانی، حذف سابقه) همراه همان درخواست فرستاده می‌شود و سرور می‌سنجد.
   * تا وضعیت قفل خوانده نشده، رمز لازم فرض می‌شود (fail-closed).
   */
  const { lockEnabled: adjustLock, loaded: adjustLockLoaded } = usePanelLock(PANEL_KEYS.priceAdjust)
  const needAdjustPw = !adjustLockLoaded || adjustLock
  const [adjustPw, setAdjustPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  /** مودال انتخاب کالا برای فرم اصلی یا برای فرم ویرایش دامنه */
  const [pickFor, setPickFor] = useState<'form' | 'edit' | null>(null)
  const [applyAsk, setApplyAsk] = useState(false)
  const [revertAsk, setRevertAsk] = useState<PriceAdjustBatchRow | null>(null)

  // ---------- مورد ۲: ویرایش دامنه ----------
  const [editRow, setEditRow] = useState<PriceAdjustBatchRow | null>(null)
  const [editScope, setEditScope] = useState<PriceAdjustScope>('ALL')
  const [editCategoryId, setEditCategoryId] = useState<number | null>(null)
  const [editPicked, setEditPicked] = useState<{ id: number; name: string }[]>([])

  // ---------- مورد ۲: حذف گروهی ردیف‌های سابقه ----------
  const [selected, setSelected] = useState<number[]>([])
  const [deleteAsk, setDeleteAsk] = useState(false)
  /** پرسش صریح کاربر: «قیمت‌ها هم برگردند یا فقط ردیف پاک شود؟» */
  const [deleteRestore, setDeleteRestore] = useState(true)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 10000)
  }

  /**
   * خواندن سابقه. *قبل از* خواندن، زمان‌بندهای رسیده یک بار اجرا می‌شوند
   * (`schedule:run`) تا جدول هیچ‌وقت عقب‌تر از واقعیت نباشد: اگر برنامه چند روز
   * بسته بوده و تخفیفی باید دیروز تمام می‌شد، همان لحظه‌ی باز کردن این صفحه
   * تسویه شده و با برچسب «پایان خودکار طبق زمان‌بندی» دیده می‌شود.
   */
  const loadBatches = useCallback(async () => {
    try {
      await call(CH.priceAdjustRunSchedule).catch(() => undefined)
      const rows = await call<PriceAdjustBatchRow[]>(CH.priceAdjustBatches, { take: 50 })
      setBatches(rows ?? [])
      // ردیف‌هایی که دیگر وجود ندارند، از انتخاب خارج می‌شوند
      const ids = new Set((rows ?? []).map((r) => r.id))
      setSelected((cur) => cur.filter((id) => ids.has(id)))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const tree = await call<CategoryNode[]>(CH.categoryTree)
        setCats(tree ?? [])
      } catch (e: any) {
        setErr(e.message)
      }
    })()
    void loadBatches()
  }, [loadBatches])

  /**
   * زمان‌بندی روی *سرور* اجرا می‌شود، ولی جدول سابقه در همین صفحه باز است. یک
   * تازه‌سازی سبک هر دقیقه باعث می‌شود «زمان‌بندی‌شده» بدون رفرش دستی به
   * «اعمال‌شده» عوض شود. هیچ نوشتنی در کار نیست، فقط خواندن.
   */
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!busy) void loadBatches()
    }, 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadBatches, busy])

  /**
   * ورودیِ سرور. هر بار که فرم عوض شود، پیش‌نمایشِ قبلی باطل می‌شود؛ وگرنه ممکن
   * بود کاربر مقدار را عوض کند و «اعمال» عددِ جدول قدیمی را اجرا کند.
   */
  const input = useMemo<PriceAdjustInput>(
    () => ({
      kind,
      mode,
      value,
      scope,
      categoryId: scope === 'CATEGORY' ? categoryId ?? undefined : undefined,
      variantIds: scope === 'VARIANTS' ? picked.map((p) => p.id) : undefined,
      target,
      round,
      minPrice: minPrice > 0 ? minPrice : undefined,
      note: note.trim() || undefined,
      // مورد ۱ — خالی = بدون زمان‌بندی (رفتار همیشگی)
      startDate: startDate.trim() || undefined,
      startTime: cleanClock(startTime) || undefined,
      endDate: endDate.trim() || undefined,
      endTime: cleanClock(endTime) || undefined
    }),
    [kind, mode, value, scope, categoryId, picked, target, round, minPrice, note, startDate, startTime, endDate, endTime]
  )

  useEffect(() => {
    setPreview(null)
  }, [kind, mode, value, scope, categoryId, picked, target, round, minPrice, startDate, startTime, endDate, endTime])

  /** چرا فعلاً نمی‌توان پیش‌نمایش گرفت (متن دقیقِ فارسی، نه فقط disable شدنِ دکمه). */
  const blocker = useMemo(() => {
    if (!(value > 0)) return 'مقدار تغییر را وارد کنید؛ صفر معنایی ندارد.'
    // نشست ۱۵۰ — عدد اعشاری دیگر بی‌صدا گرد نمی‌شود (سرور هم رد می‌کند)
    if (!Number.isInteger(value))
      return mode === 'PERCENT'
        ? 'درصد تغییر باید عدد صحیح باشد (مثلاً ۱۰، نه ۱۰٫۶).'
        : 'مبلغ تغییر باید عدد صحیح باشد (به ریال، بدون اعشار).'
    if (mode === 'PERCENT' && value > 100) return 'درصد نمی‌تواند بیشتر از ۱۰۰ باشد.'
    if (value > PRICE_INPUT_MAX) return `مبلغ تغییر از سقف مجاز ${money(PRICE_INPUT_MAX)} ریال بیشتر است.`
    if (!Number.isInteger(minPrice) || minPrice < 0)
      return 'کف قیمت باید عدد صحیح صفر یا بیشتر باشد (به ریال، بدون اعشار).'
    if (minPrice > PRICE_INPUT_MAX) return `کف قیمت از سقف مجاز ${money(PRICE_INPUT_MAX)} ریال بیشتر است.`
    if (scope === 'CATEGORY' && !categoryId) return 'دسته‌بندی را انتخاب کنید.'
    if (scope === 'VARIANTS' && !picked.length) return 'هیچ کالایی انتخاب نشده است.'
    if (startDate.trim() && !isValidJalaliDate(startDate.trim()))
      return 'تاریخ شروع زمان‌بندی معتبر نیست (قالب درست: ۱۴۰۵/۰۶/۲۸) — یا خالی بگذارید.'
    if (endDate.trim() && !isValidJalaliDate(endDate.trim()))
      return 'تاریخ پایان زمان‌بندی معتبر نیست (قالب درست: ۱۴۰۵/۰۶/۲۸) — یا خالی بگذارید.'
    if (!clockOk(cleanClock(startTime))) return 'ساعت شروع را به شکل ۰۸:۰۰ وارد کنید (یا خالی بگذارید).'
    if (!clockOk(cleanClock(endTime))) return 'ساعت پایان را به شکل ۲۳:۵۹ وارد کنید (یا خالی بگذارید).'
    if (!startDate.trim() && cleanClock(startTime)) return 'ساعت شروع بدون تاریخ شروع معنا ندارد؛ تاریخ را هم وارد کنید.'
    if (!endDate.trim() && cleanClock(endTime)) return 'ساعت پایان بدون تاریخ پایان معنا ندارد؛ تاریخ را هم وارد کنید.'
    return null
  }, [value, mode, minPrice, scope, categoryId, picked, startDate, startTime, endDate, endTime])

  /** آیا این ثبت، یک «قرار برای آینده» است یا اعمال فوری؟ (فقط برای متن دکمه/تایید) */
  const scheduledNow = !!startDate.trim()
  const scheduleHint = useMemo(() => {
    const from = startDate.trim()
      ? `از ${faDigits(startDate.trim())} ساعت ${faDigits(cleanClock(startTime) || '00:00')}`
      : 'از همین حالا'
    const to = endDate.trim()
      ? `تا ${faDigits(endDate.trim())} ساعت ${faDigits(cleanClock(endTime) || '23:59')}`
      : 'بی‌پایان (تا بازگردانی دستی)'
    return `${from} · ${to}`
  }, [startDate, startTime, endDate, endTime])

  const doPreview = async () => {
    if (blocker) return
    setBusy(true)
    try {
      const p = await call<PriceAdjustPreview>(CH.priceAdjustPreview, input)
      setPreview(p)
      setErr(null)
      if (!p?.changedCount) flash('پیش‌نمایش گرفته شد، اما هیچ کالایی تغییر نمی‌کند. شرح دلیل در ستون آخر جدول است.')
    } catch (e: any) {
      setErr(e.message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const doApply = async () => {
    setApplyAsk(false)
    setBusy(true)
    try {
      const r = await call<PriceAdjustResult>(CH.priceAdjustApply, {
        ...input,
        password: adjustPw.trim() || null // نشست ۱۵۰ — گیت سمت سرور
      })
      flash(r?.message ?? `اعمال شد: ${faDigits(r?.changedCount ?? 0)} کالا.`)
      setPreview(null)
      setValue(0)
      await loadBatches()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
      setAdjustPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  const doRevert = async () => {
    const b = revertAsk
    setRevertAsk(null)
    if (!b) return
    setBusy(true)
    try {
      const r = await call<PriceAdjustRevertResult>(CH.priceAdjustRevert, {
        batchId: b.id,
        password: adjustPw.trim() || null
      })
      flash(r?.message ?? `قیمت ${faDigits(r?.restoredCount ?? 0)} کالا به حالت قبل برگشت.`)
      setOpenBatch(null)
      await loadBatches()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
      setAdjustPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  const toggleBatch = async (b: PriceAdjustBatchRow) => {
    if (openBatch === b.id) {
      setOpenBatch(null)
      return
    }
    setOpenBatch(b.id)
    setBatchLines([])
    try {
      const lines = await call<PriceAdjustLine[]>(CH.priceAdjustBatchLines, { batchId: b.id })
      setBatchLines(lines ?? [])
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const pickVariant = (v: any) => {
    const id = Number(v?.id)
    if (!id) return
    const name = [v?.product?.name, v?.size, v?.color].filter(Boolean).join(' · ') || v?.code || `#${id}`
    const add = (p: { id: number; name: string }[]) => (p.some((x) => x.id === id) ? p : [...p, { id, name }])
    if (pickFor === 'edit') setEditPicked(add)
    else setPicked(add)
  }

  // -------------------------------------------------------------------------
  // مورد ۲ — ویرایش دامنه‌ی یک دسته‌ی ثبت‌شده
  // -------------------------------------------------------------------------

  /**
   * باز کردن فرم ویرایش با *دامنه‌ی فعلی همان دسته* از قبل پر‌شده، تا کاربر فقط
   * همان چیزی را که می‌خواهد کم/زیاد کند و از صفر نچیند.
   */
  const openEdit = async (b: PriceAdjustBatchRow) => {
    setEditRow(b)
    const sc = (b.scope === 'CATEGORY' || b.scope === 'VARIANTS' ? b.scope : 'ALL') as PriceAdjustScope
    setEditScope(sc)
    setEditCategoryId(null)
    setEditPicked([])
    setErr(null)

    // نام کالاهای دامنه‌ی فعلی از اقلام همان دسته خوانده می‌شود (دسته‌ی
    // زمان‌بندی‌شده هنوز اقلامی ندارد، پس آنجا از فهرست شناسه‌های ثبت‌شده‌ی
    // خودش استفاده می‌شود).
    try {
      const lines = sc === 'VARIANTS' ? await call<PriceAdjustLine[]>(CH.priceAdjustBatchLines, { batchId: b.id }) : []
      const nameOf = new Map((lines ?? []).map((l) => [l.variantId, l.name]))
      const ids = (b.variantIds ?? []).length ? (b.variantIds as number[]) : (lines ?? []).map((l) => l.variantId)
      setEditPicked(
        [...new Set(ids)].map((id) => ({ id, name: nameOf.get(id) ?? `کالای #${faDigits(id)}` }))
      )
    } catch {
      setEditPicked([...new Set(b.variantIds ?? [])].map((id) => ({ id, name: `کالای #${faDigits(id)}` })))
    }
  }

  const editBlocker = useMemo(() => {
    if (!editRow) return null
    if (editScope === 'CATEGORY' && !editCategoryId) return 'دسته‌بندی جدید را انتخاب کنید.'
    if (editScope === 'VARIANTS' && !editPicked.length) return 'حداقل یک کالا انتخاب کنید.'
    return null
  }, [editRow, editScope, editCategoryId, editPicked])

  const doEdit = async () => {
    const b = editRow
    if (!b || editBlocker) return
    setBusy(true)
    try {
      const r = await call<PriceAdjustEditResult>(CH.priceAdjustBatchEdit, {
        batchId: b.id,
        scope: editScope,
        categoryId: editScope === 'CATEGORY' ? editCategoryId ?? undefined : undefined,
        variantIds: editScope === 'VARIANTS' ? editPicked.map((p) => p.id) : undefined,
        password: adjustPw.trim() || null
      })
      setEditRow(null)
      setOpenBatch(null)
      flash(
        r?.message ??
          `دامنه ویرایش شد: ${faDigits(r?.addedCount ?? 0)} کالای تازه، ${faDigits(
            r?.removedCount ?? 0
          )} کالا به قیمت قبل برگشت.`
      )
      await loadBatches()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
      setAdjustPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  // -------------------------------------------------------------------------
  // مورد ۲ — حذف یک یا چند ردیف سابقه
  // -------------------------------------------------------------------------

  const toggleSelect = (id: number) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const allSelected = batches.length > 0 && selected.length === batches.length
  const toggleAll = () => setSelected(allSelected ? [] : batches.map((b) => b.id))

  const selectedRows = useMemo(() => batches.filter((b) => selected.includes(b.id)), [batches, selected])
  /** فقط دسته‌هایی که واقعاً روی قیمت نشسته‌اند، با حذف قابل بازگردانی‌اند. */
  const restorableCount = useMemo(
    () => selectedRows.filter((b) => normalizeAdjustState(b.state) === 'APPLIED').length,
    [selectedRows]
  )

  const doDelete = async () => {
    setDeleteAsk(false)
    if (!selected.length) return
    setBusy(true)
    try {
      const r = await call<PriceAdjustDeleteResult>(CH.priceAdjustBatchesDelete, {
        batchIds: selected,
        restorePrices: deleteRestore,
        password: adjustPw.trim() || null
      })
      flash(
        r?.message ??
          `${faDigits(r?.deletedCount ?? 0)} ردیف سابقه حذف شد` +
            (r?.restoredCount ? ` و قیمت ${faDigits(r.restoredCount)} کالا به حالت قبل برگشت.` : '.')
      )
      setSelected([])
      setOpenBatch(null)
      await loadBatches()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
      setAdjustPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  /** نشست ۱۵۰ — کادر رمز مشترک گیت main (در تأیید اعمال/بازگردانی/حذف و فرم ویرایش). */
  const pwField = needAdjustPw ? (
    <label className="flex flex-col gap-1 mt-2">
      <span className="kbd">رمز مدیر یا رمز دوم «تغییر قیمت گروهی» (سمت سرور هم بررسی می‌شود)</span>
      <PasswordField value={adjustPw} onChange={(e) => setAdjustPw(e.target.value)} />
    </label>
  ) : null

  /** کشویی دسته‌بندی — در فرم اصلی و در فرم ویرایش، یکسان. */
  const categorySelect = (val: number | null, onPick: (id: number | null) => void) => (
    <select className="inp w-72 py-1" value={val ?? ''} onChange={(e) => onPick(e.target.value ? +e.target.value : null)}>
      <option value="">— دسته‌بندی را انتخاب کنید —</option>
      {cats.map((c) => (
        <option key={c.id} value={c.id}>
          {'\u00A0'.repeat(c.depth * 3)}
          {c.depth ? '↳ ' : ''}
          {c.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="page">
      {/* ---------- سربرگ ---------- */}
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">تغییر قیمت گروهی کالاها</h1>
        <span className="kbd">
          این صفحه قیمتِ خودِ کالا را عوض می‌کند، نه تخفیفِ یک فاکتور. هر اعمال قابل بازگردانی است.
        </span>
        <div className="ms-auto flex gap-1 flex-wrap">
          <button className="btn" onClick={() => nav('/products')}>
            کالاها
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>
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

      {/* ---------- ۱) بخش تنظیم تغییر ---------- */}
      <div className="bg-white rounded shadow p-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="kbd">نوع تغییر</span>
            <select
              className="inp w-56 py-1"
              value={kind}
              onChange={(e) => setKind(e.target.value as PriceAdjustKind)}
            >
              {(Object.keys(KIND_LABELS) as PriceAdjustKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="kbd">مقدار</span>
            <input
              type="number"
              min={0}
              max={mode === 'PERCENT' ? 100 : undefined}
              className="inp w-36 py-1"
              value={value}
              onChange={(e) => {
                // نشست ۱۵۰ — مقدار خام؛ اعشار/بیش از ۱۰۰٪ با پیام blocker نشان داده می‌شود، نه گرد بی‌صدا
                setValue(e.target.value === '' ? 0 : Number(e.target.value))
              }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="kbd">واحد مقدار</span>
            <select
              className="inp w-44 py-1"
              value={mode}
              onChange={(e) => {
                const m = e.target.value as PriceAdjustMode
                setMode(m)
              }}
            >
              {(Object.keys(PRICE_ADJUST_MODE_LABELS) as PriceAdjustMode[]).map((m) => (
                <option key={m} value={m}>
                  {PRICE_ADJUST_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="kbd">روی کدام قیمت</span>
            <select
              className="inp w-40 py-1"
              value={target}
              onChange={(e) => setTarget(e.target.value as PriceAdjustTarget)}
            >
              {(Object.keys(TARGET_LABELS) as PriceAdjustTarget[]).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="kbd">رند کردن قیمت نهایی</span>
            <select className="inp w-44 py-1" value={round} onChange={(e) => setRound(+e.target.value || 1)}>
              {PRICE_ROUND_STEPS.map((s) => (
                <option key={s} value={s}>
                  {PRICE_ROUND_LABELS[s] ?? faDigits(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="kbd">کمترین قیمت مجاز (۰ = بی‌اثر)</span>
            <input
              type="number"
              min={0}
              className="inp w-40 py-1"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value === '' ? 0 : Number(e.target.value))}
            />
          </label>
        </div>

        {/* ---------- دامنه‌ی اعمال ---------- */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-2">
          <span className="font-bold whitespace-nowrap">روی چه کالاهایی؟</span>
          {(Object.keys(SCOPE_LABELS) as PriceAdjustScope[]).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" className="w-4 h-4" checked={scope === s} onChange={() => setScope(s)} />
              {SCOPE_LABELS[s]}
            </label>
          ))}

          {scope === 'CATEGORY' && categorySelect(categoryId, setCategoryId)}

          {scope === 'VARIANTS' && (
            <>
              <button className="btn" onClick={() => setPickFor('form')}>
                افزودن کالا…
              </button>
              <span className="kbd">{faDigits(picked.length)} کالا انتخاب شده</span>
              {picked.length > 0 && (
                <button className="text-red-500" onClick={() => setPicked([])}>
                  پاک کردن انتخاب‌ها
                </button>
              )}
            </>
          )}
        </div>

        {scope === 'VARIANTS' && picked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picked.map((p) => (
              <span key={p.id} className="kbd flex items-center gap-1">
                {p.name}
                <button className="text-red-500" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* ================= مورد ۱ — زمان‌بندی خودکار (اختیاری) ================= */}
        <div className="border-t pt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <span className="font-bold whitespace-nowrap">زمان‌بندی خودکار (اختیاری)</span>
            <label className="flex flex-col gap-1">
              <span className="kbd">تاریخ شروع</span>
              <JalaliDateInput
                value={startDate}
                onChange={setStartDate}
                className="inp w-36 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="kbd">ساعت شروع (خالی = ۰۰:۰۰)</span>
              <input
                dir="ltr"
                placeholder="08:00"
                className={`inp w-28 py-1 text-center ${clockOk(cleanClock(startTime)) ? '' : 'border-red-400 bg-red-50'}`}
                value={startTime}
                onChange={(e) => setStartTime(toLatinDigits(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="kbd">تاریخ پایان</span>
              <JalaliDateInput value={endDate} onChange={setEndDate} className="inp w-36 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="kbd">ساعت پایان (خالی = ۲۳:۵۹)</span>
              <input
                dir="ltr"
                placeholder="23:59"
                className={`inp w-28 py-1 text-center ${clockOk(cleanClock(endTime)) ? '' : 'border-red-400 bg-red-50'}`}
                value={endTime}
                onChange={(e) => setEndTime(toLatinDigits(e.target.value))}
              />
            </label>
            {(startDate || startTime || endDate || endTime) && (
              <button
                className="btn py-1"
                onClick={() => {
                  setStartDate('')
                  setStartTime('')
                  setEndDate('')
                  setEndTime('')
                }}
                title="بازگشت به رفتار همیشگی: اعمال فوری و دائمی"
              >
                پاک کردن زمان‌بندی
              </button>
            )}
          </div>
          <div
            className={`rounded px-3 py-2 border leading-6 ${
              startDate || endDate ? 'bg-sky-50 border-sky-300' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <b>{scheduleHint}</b>
            <div className="kbd leading-6">
              هر دو کادر را خالی بگذارید = رفتار همیشگی برنامه: قیمت‌ها همین حالا عوض می‌شوند و تا وقتی خودتان
              «بازگردانی» نزنید می‌مانند.
              <br />
              <b>تاریخ شروعِ آینده</b> = هیچ قیمتی همین حالا عوض نمی‌شود؛ فقط یک «قرار» ثبت می‌گردد و برنامه دقیقاً سر
              همان لحظه خودش اعمالش می‌کند (اگر آن موقع برنامه بسته باشد، اولین بار که باز شود جبران می‌شود).
              <br />
              <b>تاریخ پایان</b> = سر همان لحظه، خودکار به قیمت قبلی برمی‌گردد؛ لازم نیست یادتان بماند. هر دو رویداد با
              برچسب روشن در جدول سابقه‌ی پایین ثبت می‌شوند.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <label className="flex flex-col gap-1 flex-1 min-w-[240px]">
            <span className="kbd">یادداشت (در سابقه ذخیره می‌شود؛ مثلاً «حراج پایان فصل»)</span>
            <input className="inp py-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={() => void doPreview()} disabled={busy || !!blocker}>
            {busy ? 'در حال محاسبه…' : 'پیش‌نمایش'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => setApplyAsk(true)}
            disabled={busy || !preview || !preview.changedCount}
            title={!preview ? 'اول پیش‌نمایش بگیرید' : scheduledNow ? 'قرارِ زمان‌بندی‌شده ثبت شود' : 'قیمت‌ها را واقعاً تغییر بده'}
          >
            {scheduledNow ? 'ثبت زمان‌بندی' : 'اعمال روی انبار'}
          </button>
          {blocker && <span className="kbd text-amber-700 font-bold">{blocker}</span>}
          {!blocker && !preview && <span className="kbd">بدون پیش‌نمایش، دکمه‌ی اعمال فعال نمی‌شود.</span>}
        </div>
      </div>

      {/* ---------- ۲) بخش صورت (پیش‌نمایش) ---------- */}
      <div className="bg-white rounded shadow flex flex-col">
        <div className="p-2 flex flex-wrap items-center gap-3 border-b">
          <span className="font-bold">پیش‌نمایش تغییر قیمت</span>
          {preview ? (
            <>
              <span className="kbd">{preview.title}</span>
              <span className="kbd">
                {preview.scopeLabel} · {preview.targetLabel}
              </span>
              <span className="kbd">
                {faDigits(preview.changedCount)} از {faDigits(preview.count)} کالا تغییر می‌کند
              </span>
              <span className="ms-auto font-bold">
                جمع قبل: {money(preview.oldTotal)} → جمع بعد: {money(preview.newTotal)} (
                {preview.deltaTotal >= 0 ? '+' : '−'}
                {money(Math.abs(preview.deltaTotal))})
              </span>
            </>
          ) : (
            <span className="kbd">هنوز پیش‌نمایشی گرفته نشده است.</span>
          )}
        </div>

        {!!preview?.warnings?.length && (
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 whitespace-pre-line">
            {preview.warnings.join('\n')}
          </div>
        )}

        <div className="w-max min-w-full">
          <table className="tbl">
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                <th>کالا</th>
                <th className="w-28">کد</th>
                <th className="w-40">دسته‌بندی</th>
                <th className="w-32">قیمت قبل</th>
                <th className="w-32">قیمت جدید</th>
                <th className="w-28">تغییر</th>
                <th className="w-24">درصد</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.lines ?? []).map((l) => (
                <tr key={l.variantId} className={l.unchanged ? 'text-slate-400' : ''}>
                  <td>{l.name}</td>
                  <td>{faDigits(l.code ?? '')}</td>
                  <td>{l.categoryName ?? '—'}</td>
                  <td>{money(l.oldPrice)}</td>
                  <td className={l.unchanged ? '' : 'font-bold'}>{money(l.newPrice)}</td>
                  <td className={l.delta > 0 ? 'text-emerald-700' : l.delta < 0 ? 'text-red-600' : ''}>
                    {l.delta === 0 ? '۰' : `${l.delta > 0 ? '+' : '−'}${money(Math.abs(l.delta))}`}
                  </td>
                  <td>{l.delta === 0 ? '—' : pct(l.percent)}</td>
                  <td className="kbd">{l.unchanged ? l.skipReason ?? 'بدون تغییر' : 'تغییر می‌کند'}</td>
                </tr>
              ))}
              {!preview?.lines?.length && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    مقدار و دامنه را تعیین کنید و «پیش‌نمایش» را بزنید؛ تا آن موقع هیچ چیزی در انبار عوض نمی‌شود.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- ۳) بخش سابقه ---------- */}
      <div className="bg-white rounded shadow flex flex-col">
        <div className="p-2 flex items-center gap-2 border-b flex-wrap">
          <span className="font-bold">سابقه‌ی تغییرهای قیمت</span>
          <span className="kbd">
            هر ردیف یک اعمال یا یک قرارِ زمان‌بندی‌شده است. «بازگردانی» قیمت قبلیِ همان کالاها را برمی‌گرداند، حتی اگر
            بعدش دستی عوض شده باشند.
          </span>
          {selected.length > 0 && (
            <>
              <span className="kbd font-bold">{faDigits(selected.length)} ردیف انتخاب شده</span>
              <button
                className="btn btn-danger py-0.5"
                disabled={busy}
                onClick={() => {
                  setDeleteRestore(restorableCount > 0)
                  setDeleteAsk(true)
                }}
              >
                حذف انتخاب‌شده‌ها
              </button>
              <button className="btn py-0.5" onClick={() => setSelected([])}>
                لغو انتخاب
              </button>
            </>
          )}
          <button className="btn ms-auto" onClick={() => void loadBatches()} disabled={busy}>
            بازخوانی
          </button>
        </div>
        <div className="w-max min-w-full">
          <table className="tbl">
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={allSelected}
                    disabled={!batches.length}
                    onChange={toggleAll}
                    title="انتخاب همه‌ی ردیف‌های این جدول"
                  />
                </th>
                <th className="w-28">تاریخ</th>
                <th className="w-20">ساعت</th>
                <th>شرح</th>
                <th className="w-40">دامنه</th>
                <th className="w-24">تعداد</th>
                <th className="w-36">اثر مالی</th>
                <th className="w-56">وضعیت</th>
                <th className="w-44">زمان‌بندی</th>
                <th className="w-64"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const state = normalizeAdjustState(b.state, b.reverted ? 'x' : null)
                const dim = state === 'REVERTED' || state === 'ENDED'
                return (
                  <tr key={b.id} className={`${dim ? 'text-slate-400' : ''} ${selected.includes(b.id) ? 'sel' : ''}`}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={selected.includes(b.id)}
                        onChange={() => toggleSelect(b.id)}
                      />
                    </td>
                    <td>{faDigits(b.dateJalali)}</td>
                    <td>{faDigits(b.time)}</td>
                    <td>
                      {b.title}
                      {b.note && <div className="kbd">{b.note}</div>}
                      {b.editCount > 0 && (
                        <div className="kbd">
                          {faDigits(b.editCount)} بار ویرایش دامنه
                          {b.editedAtJalali ? ` — آخرین بار ${faDigits(b.editedAtJalali)}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      {b.scopeLabel}
                      {b.categoryName && <div className="kbd">{b.categoryName}</div>}
                    </td>
                    <td>{faDigits(b.itemCount)}</td>
                    <td className={b.deltaTotal > 0 ? 'text-emerald-700' : b.deltaTotal < 0 ? 'text-red-600' : ''}>
                      {b.deltaTotal === 0 ? '۰' : `${b.deltaTotal > 0 ? '+' : '−'}${money(Math.abs(b.deltaTotal))}`}
                    </td>
                    {/* ---- مورد ۱: ستون وضعیت (زمان‌بندی‌شده / اعمال‌شده / پایان خودکار / بازگردانی) ---- */}
                    <td className="whitespace-normal">
                      <span className={`inline-block rounded border px-2 py-0.5 font-bold ${STATE_CLASS[state]}`}>
                        {b.stateLabel || PRICE_ADJUST_STATE_LABELS[state]}
                      </span>
                      {b.autoStarted && <div className="kbd">شروع خودکار طبق زمان‌بندی</div>}
                      {b.autoEnded && <div className="kbd">پایان خودکار طبق زمان‌بندی</div>}
                      {b.reverted && b.revertedAtJalali && (
                        <div className="kbd">بازگردانی دستی — {faDigits(b.revertedAtJalali)}</div>
                      )}
                      {!b.reverted && b.revertWarning && <div className="kbd text-amber-700">{b.revertWarning}</div>}
                    </td>
                    <td className="whitespace-normal kbd">{b.scheduleLabel ?? 'بدون زمان‌بندی'}</td>
                    <td>
                      <div className="flex gap-1 justify-end flex-wrap">
                        <button className="btn py-0.5" onClick={() => void toggleBatch(b)}>
                          {openBatch === b.id ? 'بستن اقلام' : 'اقلام'}
                        </button>
                        <button
                          className="btn py-0.5"
                          disabled={busy || !b.canEdit}
                          title={
                            b.canEdit
                              ? 'دامنه‌ی همین دسته را کم/زیاد کنید؛ فرمول و مقدار دست‌نخورده می‌ماند'
                              : 'دامنه‌ی دسته‌ای که بازگردانی یا پایان یافته قابل ویرایش نیست'
                          }
                          onClick={() => void openEdit(b)}
                        >
                          ویرایش دامنه
                        </button>
                        <button
                          className="btn btn-danger py-0.5"
                          disabled={busy || !b.canRevert}
                          title={b.canRevert ? 'قیمت‌ها به حالت قبل برگردند' : 'این دسته قابل بازگردانی نیست'}
                          onClick={() => setRevertAsk(b)}
                        >
                          بازگردانی
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!batches.length && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400">
                    هنوز هیچ تغییر قیمت گروهی ثبت نشده است.
                  </td>
                </tr>
              )}
              {openBatch !== null && (
                <tr>
                  <td colSpan={10} className="bg-slate-50">
                    {!batchLines.length ? (
                      <div className="kbd py-2">
                        اقلامی برای این دسته ثبت نشده است (دسته‌ی زمان‌بندی‌شده تا لحظه‌ی شروع هیچ قیمتی را عوض نکرده،
                        پس اقلامی هم ندارد).
                      </div>
                    ) : (
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>کالا</th>
                            <th className="w-32">قیمت قبل</th>
                            <th className="w-32">قیمت بعد</th>
                            <th className="w-28">تغییر</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchLines.map((l) => (
                            <tr key={l.variantId}>
                              <td>{l.name}</td>
                              <td>{money(l.oldPrice)}</td>
                              <td>{money(l.newPrice)}</td>
                              <td>{l.delta === 0 ? '۰' : `${l.delta > 0 ? '+' : '−'}${money(Math.abs(l.delta))}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AllProductsModal
        open={pickFor !== null}
        title={pickFor === 'edit' ? 'افزودن کالا به دامنه‌ی این دسته' : 'انتخاب کالا برای تغییر قیمت'}
        onClose={() => setPickFor(null)}
        onPick={(v: any) => pickVariant(v)}
      />

      {/* ================= مورد ۲ — فرم ویرایش دامنه‌ی یک دسته ================= */}
      <Modal
        open={!!editRow}
        title={`ویرایش دامنه‌ی «${editRow?.title ?? ''}»`}
        onClose={() => setEditRow(null)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn" onClick={() => setEditRow(null)} disabled={busy}>
              انصراف
            </button>
            <button className="btn btn-primary" onClick={() => void doEdit()} disabled={busy || !!editBlocker}>
              {busy ? 'در حال اعمال…' : 'ذخیره‌ی دامنه‌ی جدید'}
            </button>
          </>
        }
      >
        {editRow && (
          <>
            <div className="rounded px-3 py-2 border bg-slate-50 leading-7">
              <b>{editRow.title}</b> · {editRow.targetLabel} · دامنه‌ی فعلی: {editRow.scopeLabel}
              {editRow.categoryName ? ` (${editRow.categoryName})` : ''} · {faDigits(editRow.itemCount)} کالا
              <div className="kbd leading-6">
                فقط <b>دامنه</b> عوض می‌شود، نه فرمول: مقدار و درصد و رند کردن همان چیزی می‌ماند که این دسته با آن ثبت
                شد.
                <br />
                کالاهایی که از دامنه <b>بیرون می‌افتند</b>، قیمتشان به مقدار «قبل از همین دسته» برمی‌گردد. کالاهایی که{' '}
                <b>تازه وارد</b> می‌شوند، با همان قاعده قیمت می‌گیرند. کالاهایی که در دامنه <b>می‌مانند</b> دست‌نخورده
                می‌مانند (دوباره تخفیف نمی‌خورند).
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold whitespace-nowrap">دامنه‌ی جدید:</span>
              {(Object.keys(SCOPE_LABELS) as PriceAdjustScope[]).map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="radio" className="w-4 h-4" checked={editScope === s} onChange={() => setEditScope(s)} />
                  {SCOPE_LABELS[s]}
                </label>
              ))}
            </div>

            {editScope === 'CATEGORY' && <div>{categorySelect(editCategoryId, setEditCategoryId)}</div>}

            {editScope === 'VARIANTS' && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn" onClick={() => setPickFor('edit')}>
                    افزودن کالا…
                  </button>
                  <span className="kbd">{faDigits(editPicked.length)} کالا در دامنه‌ی جدید</span>
                  {editPicked.length > 0 && (
                    <button className="text-red-500" onClick={() => setEditPicked([])}>
                      پاک کردن همه
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {editPicked.map((p) => (
                    <span key={p.id} className="kbd flex items-center gap-1">
                      {p.name}
                      <button className="text-red-500" onClick={() => setEditPicked((x) => x.filter((y) => y.id !== p.id))}>
                        ✕
                      </button>
                    </span>
                  ))}
                  {!editPicked.length && (
                    <span className="kbd text-amber-700">
                      دامنه‌ی خالی معنا ندارد؛ حداقل یک کالا انتخاب کنید (یا «همه‌ی کالاها» را بزنید).
                    </span>
                  )}
                </div>
              </div>
            )}

            {editBlocker && <div className="kbd text-amber-700 font-bold">{editBlocker}</div>}
            {pwField}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={applyAsk}
        title={scheduledNow ? 'ثبت زمان‌بندی تغییر قیمت' : 'اعمال تغییر قیمت'}
        message={
          preview ? (
            <div>
            <div className="whitespace-pre-line">
              {scheduledNow
                ? `این تغییر همین حالا روی هیچ قیمتی نمی‌نشیند؛ یک قرار ثبت می‌شود و برنامه سر همان لحظه خودش اعمالش می‌کند.\n${scheduleHint}\n\nطبق پیش‌نمایش امروز، ${faDigits(
                    preview.changedCount
                  )} کالا در دامنه است (تعداد نهایی سر لحظه‌ی شروع دوباره حساب می‌شود).`
                : `قیمت ${faDigits(preview.changedCount)} کالا تغییر می‌کند و جمع قیمت‌ها ${
                    preview.deltaTotal >= 0 ? 'افزایش' : 'کاهش'
                  } ${money(Math.abs(preview.deltaTotal))} ریالی پیدا می‌کند.` +
                  (endDate.trim() ? `\nپایان خودکار: ${faDigits(endDate.trim())} ساعت ${faDigits(cleanClock(endTime) || '23:59')}` : '') +
                  '\nاین تغییر روی فاکتورهای ثبت‌شده اثری ندارد و از سابقه‌ی همین صفحه قابل بازگردانی است.'}
            </div>
            {pwField}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={scheduledNow ? 'زمان‌بندی را ثبت کن' : 'اعمال کن'}
        cancelLabel="انصراف"
        busy={busy}
        onConfirm={() => void doApply()}
        onCancel={() => setApplyAsk(false)}
      />

      <ConfirmDialog
        open={!!revertAsk}
        title="بازگردانی قیمت‌ها"
        message={
          revertAsk ? (
            <div>
              <div className="whitespace-pre-line">
                {`قیمت ${faDigits(revertAsk.itemCount)} کالای این دسته به مقدار قبل از «${revertAsk.title}» برمی‌گردد.${
                  revertAsk.revertWarning ? `\n${revertAsk.revertWarning}` : ''
                }`}
              </div>
              {pwField}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel="برگردان"
        cancelLabel="انصراف"
        busy={busy}
        onConfirm={() => void doRevert()}
        onCancel={() => setRevertAsk(null)}
      />

      {/* ============ مورد ۲ — حذف ردیف‌های سابقه، با پرسش صریح ============ */}
      <ConfirmDialog
        open={deleteAsk}
        title="حذف ردیف‌های سابقه‌ی تغییر قیمت"
        message={
          <div className="space-y-2">
            <div>
              <b>{faDigits(selected.length)} ردیف</b> از سابقه حذف می‌شود.
              {restorableCount > 0 ? (
                <>
                  {' '}
                  از این میان <b>{faDigits(restorableCount)} ردیف</b> همین حالا روی قیمت کالاها نشسته‌اند.
                </>
              ) : (
                ' هیچ‌کدام از این ردیف‌ها همین حالا روی قیمت کالاها اثر ندارند (بازگردانی‌شده، پایان‌یافته یا فقط زمان‌بندی‌شده‌اند).'
              )}
            </div>
            <div className="rounded border bg-slate-50 p-2 space-y-1">
              <div className="font-bold">حذف سابقه، قیمت کالاها را هم به حالت قبل برگرداند؟</div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="w-4 h-4 mt-1"
                  checked={deleteRestore}
                  onChange={() => setDeleteRestore(true)}
                />
                <span>
                  <b>بله — اول قیمت‌ها برگردند، بعد ردیف پاک شود.</b>
                  <div className="kbd">
                    مثل «بازگردانی» عمل می‌کند و بعدش ردیف سابقه را هم پاک می‌کند. اگر این تخفیف را اشتباهی زده‌اید،
                    همین گزینه درست است.
                  </div>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="w-4 h-4 mt-1"
                  checked={!deleteRestore}
                  onChange={() => setDeleteRestore(false)}
                />
                <span>
                  <b>نه — فقط خودِ ردیف سابقه پاک شود.</b>
                  <div className="kbd">
                    قیمت فعلی کالاها دست‌نخورده می‌ماند و همان می‌ماند که هست؛ فقط دیگر رکوردی برای بازگردانی‌اش
                    نمی‌مانَد. برای مرتب کردن سابقه‌ی شلوغِ قدیمی همین گزینه درست است.
                  </div>
                </span>
              </label>
            </div>
            <div className="kbd text-amber-800">
              حذف ردیف سابقه برگشت‌ناپذیر است: قیمت‌های «قبل»ِ ثبت‌شده در آن ردیف هم با آن پاک می‌شوند.
            </div>
            {pwField}
          </div>
        }
        confirmLabel={deleteRestore ? 'قیمت‌ها را برگردان و حذف کن' : 'فقط ردیف‌ها را حذف کن'}
        cancelLabel="انصراف"
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteAsk(false)}
      />
    </div>
  )
}

/**
 * قفلِ ماژول دور کل صفحه است، نه دور دکمه‌ی اعمال: دیدنِ قیمت خرید و قیمت فروش
 * همه‌ی کالاها در یک جدول، خودش یک اطلاعِ حساس است.
 */
export default function PriceAdjust() {
  return (
    <ManagerGate
      panel={PANEL_KEYS.priceAdjust}
      title="تغییر قیمت گروهی کالاها"
      reason="این صفحه قیمت فروش یا خرید کالاها را به‌صورت گروهی تغییر می‌دهد؛ برای ورود، رمز مدیر لازم است."
    >
      <PriceAdjustInner />
    </ManagerGate>
  )
}
