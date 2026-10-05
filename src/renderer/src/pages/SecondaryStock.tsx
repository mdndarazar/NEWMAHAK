import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import AllProductsModal from '../components/AllProductsModal'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import NewStoreProductModal, { type NewStoreProductSeed } from '../components/NewStoreProductModal'
import { exportTable } from '../lib/exportCsv'
import { useSettings } from '../hooks/useSettings'
import { useAutoCentralWithdraw } from '../hooks/useAutoCentralWithdraw'
import AutoCentralPasswordBox from '../components/AutoCentralPasswordBox'
import ManagerGate from '../components/ManagerGate'
import PasswordField from '../components/PasswordField'
import { usePanelLock, usePanelOpen } from '../hooks/usePanelLocks'
import { CENTRAL_WITHDRAW_GATE, PANEL_KEYS } from '@shared/panels'
import { faDigits } from '@shared/jalali'
import { creditEffectiveSkip, type CreditSkipState } from '@shared/creditUi'
import { secondaryHistorySignature } from '@shared/secondaryHistoryUi'
import type {
  SecondaryStockLogRow,
  PagedSecondaryStockLogs,
  SecondaryStockRow,
  SecondaryStockTransferResult,
  SecondaryToStoreResult,
  SecondaryToStoreNewVariantInput,
  SecondaryToStoreNewVariantResult,
  SecondaryWarehouseDeleteResult,
  SecondaryWarehouseRow,
  StoreMatchCandidate
} from '@shared/types'

/**
 * ===================== انبار مرکزی (انبار ذخیره) =====================
 * یک فهرست مستقل: نام، کد دلخواه، تعداد، توضیح. (نام قبلی این پنل «انبار
 * جانبی» بود؛ فقط نام عوض شده و رفتارش همان است.)
 *
 * رابطه‌اش با موجودی فروشگاه:
 *   • فاکتور خرید، برگشت از فروش، تجمیع و انتقال و گزارش‌ها هیچ‌وقت به این
 *     فهرست دست نمی‌زنند.
 *   • تنها استثنا، و فقط با تیک صریح خودتان: چک‌باکس «برداشت خودکار از انبار
 *     مرکزی هنگام کمبود موجودی» در پنل فروش تکی و فاکتور فروش عمده. تا وقتی آن
 *     تیک خاموش است، این فهرست کاملاً مستقل می‌ماند و کمبود موجودی فروشگاه مثل
 *     قبل منفی ثبت می‌شود.
 *
 * دکمه‌ی «نمایش کالاهای انبار فروشگاه»: فهرست کالاهای *انبار فروشگاه* را باز
 * می‌کند تا بشود ردیف انبار مرکزی را از همان‌جا انتخاب کرد؛ نام و کد کالا
 * خودکار در فرم می‌نشیند (همین نام/کد است که در «برداشت خودکار» تطبیق داده
 * می‌شود، پس انتخاب از این فهرست مطمئن‌ترین راه است).
 * ====================================================================
 */
type Draft = {
  id?: number | null
  name: string
  code: string
  qty: number
  note: string
  /** بخش ۵: انبار این ردیف (۰ = انبار پیش‌فرض) */
  warehouseId: number
  /** حد هشدار موجودی (۰ = بدون هشدار) */
  minQty: number
}
const EMPTY: Draft = { id: null, name: '', code: '', qty: 0, note: '', warehouseId: 0, minQty: 0 }

/** سه نمای این پنل (بخش ۵). */
type View = 'items' | 'warehouses' | 'history'

type HouseDraft = { id: number | null; name: string; location: string; note: string }
const EMPTY_HOUSE: HouseDraft = { id: null, name: '', location: '', note: '' }

/**
 * ---------------------------------------------------------------------------
 * بند ۸ — مقصد انتقال دو حالت دارد و تفاوتشان بنیادی است:
 *
 *   • `house` — انبار دیگری از *همین* ماژول. فقط عددهای این ماژول جابه‌جا
 *     می‌شوند و موجودی انبار فروشگاه مطلقاً دست نمی‌خورد (رفتار قبلی).
 *   • `store` — **انبار فروشگاه**: همان `ProductVariant.stock` که ماژول کالا و
 *     پنل فروش می‌بینند. پس کالای مقصد باید *صریح* انتخاب شود، نه حدسی؛ تطبیق
 *     نام/کد فقط پیشنهاد می‌دهد. این مسیر قفل رمز دوم مستقل خودش را دارد
 *     (`PANEL_KEYS.secondaryToStore`).
 * ---------------------------------------------------------------------------
 */
type TransferMode = 'house' | 'store'

/**
 * ---------------------------------------------------------------------------
 * جلسه ۵۴ — مقدار ویژه‌ی «هیچ‌کدام از پیشنهادها؛ کالای جدید بساز».
 *
 * چرا یک عدد منفی و نه یک بولین جدا: `variantId` از قبل تنها چیزی است که
 * «مقصد انتخاب شده است؟» را می‌گوید (۰ = هنوز هیچ). یک مقدار سوم روی همان فیلد،
 * هم منطق دکمه‌ی تأیید یک‌جا می‌ماند و هم امکان ندارد حالتی بسازد که کاربر هم
 * کالای موجود انتخاب کرده باشد و هم «کالای جدید». سرور هیچ‌وقت این عدد را
 * نمی‌بیند: مسیر کالای جدید کانال خودش را دارد.
 * ---------------------------------------------------------------------------
 */
const NEW_PRODUCT_CHOICE = -1
type TransferDraft = {
  itemId: number
  name: string
  code: string
  fromName: string
  available: number
  toWarehouseId: number
  qty: number
  note: string
  mode: TransferMode
  /** بند ۸: کالای مقصد در انبار فروشگاه (۰ = هنوز انتخاب نشده) */
  variantId: number
}

export default function SecondaryStock() {
  const nav = useNavigate()
  /**
   * تنظیمات انبار مرکزی (مورد ۱): همان چک‌باکس «برداشت خودکار از انبار مرکزی»
   * پنل فروش تکی و فاکتور فروش عمده — یک مقدار واحد روی جدول Setting، پس هر سه
   * محل همیشه یک وضعیت نشان می‌دهند. تغییرش فقط با نشست مدیر ممکن است.
   */
  const { settings, setSettings } = useSettings()
  const autoCentralBox = useAutoCentralWithdraw(settings.sale, setSettings)
  const [rows, setRows] = useState<SecondaryStockRow[]>([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [sel, setSel] = useState<number[]>([])
  // ---------------- بخش ۵: انبارها، انتقال و تاریخچه ----------------
  const [view, setView] = useState<View>('items')
  const [houses, setHouses] = useState<SecondaryWarehouseRow[]>([])
  const [history, setHistory] = useState<SecondaryStockLogRow[]>([])
  const [historyPage, setHistoryPage] = useState<PagedSecondaryStockLogs['page'] | null>(null)
  const [historyWarnings, setHistoryWarnings] = useState<string[]>([])
  const [onlyTransfers, setOnlyTransfers] = useState(true)
  /**
   * ممیزی ۱۱۸ · A118-02 (AUDIT-D54) — skip همراه امضای فیلتر؛ با تغییر فیلتر skip مؤثر در همان رندر صفر است
   * (نه با effect جدا که یک درخواست اضافه با skip کهنه می‌فرستاد). historyReq پاسخ کهنه را دور می‌ریزد.
   */
  const historySignature = secondaryHistorySignature({ onlyTransfers })
  const [historySkipState, setHistorySkipState] = useState<CreditSkipState>({ skip: 0, signature: historySignature })
  const historySkip = creditEffectiveSkip(historySkipState, historySignature)
  const historyReq = useRef(0)
  /** فیلتر «فقط این انبار» روی جدول موجودی (−۱ = همه) */
  const [houseFilter, setHouseFilter] = useState(-1)
  const [houseDraft, setHouseDraft] = useState<HouseDraft | null>(null)
  const [delHouse, setDelHouse] = useState<SecondaryWarehouseRow | null>(null)
  const [transfer, setTransfer] = useState<TransferDraft | null>(null)
  /** بند ۸ — کالاهای پیشنهادیِ انبار فروشگاه برای ردیف انتخاب‌شده */
  const [cands, setCands] = useState<StoreMatchCandidate[]>([])
  const [candSearch, setCandSearch] = useState('')
  /** قفل مستقل «انتقال به انبار فروشگاه» (fail-closed: تا باز نشود، بسته است) */
  const toStoreOpen = usePanelOpen(PANEL_KEYS.secondaryToStore)
  /**
   * نشست ۱۴۹ · S147-b — سرور خودش قفل «انتقال به انبار فروشگاه» را می‌سنجد، پس رمز باید همراه
   * همین درخواست برود (باز بودن ManagerGate در رندرر برای main کافی نیست). fail-closed: تا سیاست
   * قفل خوانده نشده، رمز لازم فرض می‌شود.
   */
  const { lockEnabled: toStoreLock, loaded: toStoreLockLoaded } = usePanelLock(PANEL_KEYS.secondaryToStore)
  const needToStorePw = !toStoreLockLoaded || toStoreLock
  const [toStorePw, setToStorePw] = useState('')
  useEffect(() => {
    if (!transfer) setToStorePw('')
  }, [transfer])
  /** پیام هشدار قابل‌تایید انتقال بیشتر از موجودی (اصل «هشدار، نه دیوار») */
  const [forceAsk, setForceAsk] = useState<string | null>(null)
  /**
   * جلسه ۵۴ — فرم «کالای جدید». null = بسته. وقتی پر است، فرم روی همان پنجره‌ی
   * انتقال باز می‌شود و نام/کد ردیف انبار مرکزی از قبل در آن نشسته است.
   */
  const [newProd, setNewProd] = useState<NewStoreProductSeed | null>(null)
  /** کاربر به سؤال «کالای جدید ثبت شود؟» جواب «خیر» داد ⇒ دیگر نپرس. */
  const [newProdDeclined, setNewProdDeclined] = useState(false)
  /** مودال «نمایش کالاهای انبار فروشگاه» باز است؟ */
  const [shopOpen, setShopOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await call<SecondaryStockRow[]>(CH.secondaryStockList, { search }))
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    }
  }, [search])

  /** فهرست انبارها (ردیف اول همیشه «انبار پیش‌فرض» است). */
  const loadHouses = useCallback(async () => {
    try {
      setHouses(await call<SecondaryWarehouseRow[]>(CH.secondaryWarehouseList, { includeInactive: true }))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    const seq = ++historyReq.current
    try {
      const res = await call<PagedSecondaryStockLogs>(CH.secondaryStockHistory, {
        onlyTransfers,
        take: 5000,
        skip: historySkip
      })
      if (seq !== historyReq.current) return
      setHistory(res)
      setHistoryPage(res.page ?? null)
      setHistoryWarnings(res.warnings ?? [])
    } catch (e: any) {
      if (seq !== historyReq.current) return
      setErr(e.message)
    }
  }, [historySkip, onlyTransfers])

  /** صفحه‌ی قبل/بعد تاریخچه: skip همراه امضای فیلتر فعلی (A118-02) */
  const goHistoryPage = (skip: number) =>
    setHistorySkipState({ skip: Math.max(0, skip), signature: historySignature })

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadHouses()
  }, [loadHouses])

  useEffect(() => {
    if (view === 'history') void loadHistory()
  }, [view, loadHistory])

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 5000)
  }

  /**
   * انتخاب کالا از فهرست انبار فروشگاه: نام کامل (با سایز/رنگ) و کد کالا در
   * فرم می‌نشیند و تعداد را خودتان می‌زنید. هیچ چیزی از انبار فروشگاه کم یا
   * زیاد نمی‌شود — این فقط پر کردن فرم است.
   */
  const pickFromShop = (v: any) => {
    if (!v) return
    const name = `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`.trim()
    setDraft((d) => ({ ...d, id: null, name: name || d.name, code: v.code ?? d.code }))
    setShopOpen(false)
    flash(`«${name}» از انبار فروشگاه انتخاب شد · تعداد را بنویسید و «افزودن» را بزنید (موجودی فروشگاه ${faDigits(v.stock ?? 0)})`)
  }

  const save = async () => {
    if (!draft.name.trim()) return setErr('نام کالا را وارد کنید.')
    setBusy(true)
    try {
      await call(CH.secondaryStockUpsert, {
        id: draft.id ?? null,
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        // نشست ۱۴۹ · S147-a — مقدار خام فرستاده می‌شود؛ اعشار/منفیِ حد هشدار را سرور با پیام فارسی رد می‌کند (نه گرد/صفر بی‌صدا)
        qty: draft.qty || 0,
        note: draft.note.trim() || null,
        // بخش ۵: انبار و حد هشدار هم ذخیره می‌شوند
        warehouseId: draft.warehouseId || null,
        minQty: draft.minQty || 0
      })
      setDraft(EMPTY)
      await load()
      await loadHouses()
      flash('ردیف انبار مرکزی ذخیره شد (بدون هیچ اثری روی موجودی فروشگاه)')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ids: number[]) => {
    if (!ids.length) return setErr('برای حذف، حداقل یک ردیف را انتخاب کنید.')
    setBusy(true)
    try {
      const n = await call<number>(CH.secondaryStockDelete, { ids })
      setSel([])
      await load()
      await loadHouses()
      flash(`${faDigits(n)} ردیف حذف شد`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  /** نام انبار یک شناسه (۰/خالی = انبار پیش‌فرض). */
  const houseName = (id?: number | null) =>
    houses.find((h) => h.id === (id ?? 0))?.name ?? (id ? `انبار ${faDigits(id)}` : 'انبار مرکزی')

  /** جدول موجودی، با فیلتر اختیاری «فقط این انبار» (بخش ۵). */
  const shownRows = houseFilter < 0 ? rows : rows.filter((r) => (r.warehouseId ?? 0) === houseFilter)
  const total = shownRows.reduce((s, r) => s + r.qty, 0)

  /** ثبت/ویرایش یک انبار. */
  const saveHouse = async () => {
    if (!houseDraft) return
    if (!houseDraft.name.trim()) return setErr('نام انبار را وارد کنید.')
    setBusy(true)
    try {
      await call(CH.secondaryWarehouseUpsert, {
        id: houseDraft.id,
        name: houseDraft.name.trim(),
        location: houseDraft.location.trim() || null,
        note: houseDraft.note.trim() || null
      })
      setHouseDraft(null)
      await loadHouses()
      flash(houseDraft.id ? 'انبار ویرایش شد' : 'انبار جدید ساخته شد')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  /** حذف یک انبار: ردیف‌هایش پاک نمی‌شوند، به انبار پیش‌فرض منتقل می‌گردند. */
  const removeHouse = async (h: SecondaryWarehouseRow) => {
    setBusy(true)
    try {
      const res = await call<SecondaryWarehouseDeleteResult>(CH.secondaryWarehouseDelete, { id: h.id })
      setDelHouse(null)
      await loadHouses()
      await load()
      flash(
        `انبار «${res.name}» حذف شد · ${faDigits(res.movedItems)} ردیف به «${res.targetWarehouseName}» منتقل شد (هیچ موجودی‌ای پاک نشد)`
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * بند ۸ — پیشنهاد کالای فروشگاه برای ردیف مبدأ (فقط پیشنهاد؛ هیچ تغییری
   * نمی‌دهد). تا وقتی قفل «انتقال به انبار فروشگاه» باز نشده، حتی درخواست هم
   * فرستاده نمی‌شود.
   */
  useEffect(() => {
    if (!transfer || transfer.mode !== 'store' || !toStoreOpen) return setCands([])
    let alive = true
    call<StoreMatchCandidate[]>(CH.secondaryStoreCandidates, {
      itemId: transfer.itemId,
      search: candSearch.trim() || undefined,
      take: 50
    })
      .then((list) => alive && setCands(list ?? []))
      .catch(() => alive && setCands([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.itemId, transfer?.mode, toStoreOpen, candSearch])

  /** ردیف یا جست‌وجو که عوض شد، سؤال «کالای جدید ثبت شود؟» از نو پرسیده می‌شود. */
  useEffect(() => {
    setNewProdDeclined(false)
  }, [transfer?.itemId, candSearch])

  /**
   * بند ۸ — انتقال به انبار فروشگاه.
   *
   * موجودی منفی درست لحاظ می‌شود چون افزایش، *جبری* است: ۳− به‌اضافه‌ی ۱۰ عدد
   * می‌شود ۷ (سه عدد صرف جبران کسری قبلی می‌شود). همین عدد را سرویس در
   * `shortageCovered` برمی‌گرداند و در پیام موفقیت صریح گفته می‌شود.
   */
  const doToStore = async (force: boolean) => {
    if (!transfer) return
    if (!transfer.variantId) return setErr('کالای مقصد در انبار فروشگاه را انتخاب کنید.')
    /**
     * جلسه ۵۴ — تکیه‌گاه دوم: «کالای جدید» هیچ‌وقت نباید به کانال «کالای موجود»
     * برود (آن کانال `variantId` واقعی می‌خواهد). دکمه‌ی تأیید هم همین را رعایت
     * می‌کند؛ این خط فقط جلوی یک مسیر فراموش‌شده را می‌گیرد.
     */
    if (transfer.variantId === NEW_PRODUCT_CHOICE) return askNewProduct()
    setForceAsk(null)
    setBusy(true)
    try {
      const res = await call<SecondaryToStoreResult>(CH.secondaryStockToStore, {
        itemId: transfer.itemId,
        variantId: transfer.variantId,
        qty: transfer.qty || 0, // S147-a — خام؛ سرور اعشار را رد می‌کند
        note: transfer.note.trim() || null,
        force: force || undefined,
        toStorePassword: toStorePw.trim() || null // S147-b — گیت سمت سرور
      })
      setTransfer(null)
      await load()
      await loadHouses()
      if (view === 'history') await loadHistory()
      flash(
        `${faDigits(res.qty)} عدد «${res.name}» از «${res.fromWarehouseName}» به انبار فروشگاه منتقل شد ` +
          `(کالا: ${res.variantName}) · موجودی فروشگاه از ${faDigits(res.storeBefore)} به ${faDigits(res.storeAfter)} رسید` +
          (res.shortageCovered > 0
            ? ` · ${faDigits(res.shortageCovered)} عدد از همین انتقال صرف جبران کسری قبلی (موجودی منفی) شد`
            : '') +
          ` · باقی‌ماندهٔ انبار مرکزی ${faDigits(res.fromRemaining)}`
      )
    } catch (e: any) {
      const message = String(e.message ?? '')
      if (message.includes('تیک تأیید') || message.includes('تایید کنید تا انجام شود')) setForceAsk(message)
      else setErr(message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * جلسه ۵۴ — «ساخت کالای جدید + انتقال» با یک درخواست و یک تراکنش.
   *
   * چرا یک تماس و نه دو تا (اول ساخت کالا، بعد انتقال): دو تماس یعنی اگر انتقال
   * شکست بخورد، یک کالای بی‌موجودی و بی‌صاحب در فروشگاه جا می‌ماند. سرور هر دو
   * را در یک تراکنش انجام می‌دهد، پس خطا ⇒ هیچ‌چیز.
   * ---------------------------------------------------------------------------
   */
  const doToStoreNew = async (payload: SecondaryToStoreNewVariantInput) => {
    /**
     * جلسه ۵۵ · کار ۲ — تعداد انتقال بیشتر از موجودی ردیف مبدأ.
     *
     * مسیر «کالای موجود» برای این حالت تیک تأیید آگاهانه دارد (`forceAsk`)، ولی
     * فرم «کالای جدید» چنین تیکی ندارد؛ پس خطای `force` سرور در آن فرم بی‌راه‌حل
     * بود. جلوگیری اصلی داخل خود فرم است (`NewStoreProductModal`) و این خط
     * تکیه‌گاه دوم است: هیچ‌وقت درخواستی که قطعاً رد می‌شود به سرور نمی‌رود.
     */
    const seedRow = newProd
    if (seedRow && Number(payload.qty) > Math.round(seedRow.available ?? 0)) {
      setErr(
        `تعداد انتقال (${faDigits(String(payload.qty))}) از موجودی همین ردیف انبار مرکزی ` +
          `(${faDigits(Math.round(seedRow.available ?? 0))}) بیشتر است. تعداد را در فرم انتقال کم کنید.`
      )
      return
    }
    setBusy(true)
    try {
      const res = await call<SecondaryToStoreNewVariantResult>(CH.secondaryStockToStoreNew, payload)
      setNewProd(null)
      setTransfer(null)
      setNewProdDeclined(false)
      await load()
      await loadHouses()
      if (view === 'history') await loadHistory()
      flash(
        `${res.created.createdProduct ? 'کالای جدید' : 'واریانت جدید'} «${res.created.fullName}» با کد ` +
          `${faDigits(res.created.code)} و بارکد ${faDigits(res.created.barcode)} در انبار فروشگاه ثبت شد` +
          (res.created.codeReplaced
            ? ` (کد درخواستی ${faDigits(res.created.requestedCode ?? '')} تکراری بود، پس ${faDigits(res.created.code)} ثبت شد)`
            : '') +
          ` · ${faDigits(res.qty)} عدد از «${res.fromWarehouseName}» به آن منتقل شد · موجودی فروشگاه ` +
          `${faDigits(res.storeAfter)} · باقی‌ماندهٔ انبار مرکزی ${faDigits(res.fromRemaining)}`
      )
    } catch (e: any) {
      // هیچ کالایی ساخته نشده و هیچ موجودی‌ای جابه‌جا نشده (تراکنش برگشته است)
      setErr(String(e.message ?? ''))
    } finally {
      setBusy(false)
    }
  }

  /** پنجره‌ی «کالای جدید» را با نام و کد همین ردیف انبار مرکزی باز می‌کند. */
  const askNewProduct = () => {
    if (!transfer) return
    setErr(null)
    setNewProd({
      itemId: transfer.itemId,
      name: transfer.name,
      code: transfer.code,
      qty: transfer.qty || 0,
      note: transfer.note,
      fromName: transfer.fromName,
      available: transfer.available
    })
  }

  /** انتقال موجودی بین دو انبار (با تایید آگاهانه برای بیشتر از موجودی). */
  const doTransfer = async (force: boolean) => {
    if (!transfer) return
    if (transfer.mode === 'store') return doToStore(force)
    setForceAsk(null)
    setBusy(true)
    try {
      const res = await call<SecondaryStockTransferResult>(CH.secondaryStockTransfer, {
        itemId: transfer.itemId,
        toWarehouseId: transfer.toWarehouseId || null,
        qty: transfer.qty || 0, // S147-a — خام؛ سرور اعشار را رد می‌کند
        note: transfer.note.trim() || null,
        force: force || undefined
      })
      setTransfer(null)
      await load()
      await loadHouses()
      if (view === 'history') await loadHistory()
      flash(
        `${faDigits(res.qty)} عدد «${res.name}» از «${res.fromWarehouseName}» به «${res.toWarehouseName}» منتقل شد · ` +
          `مبدأ ${faDigits(res.fromRemaining)} · مقصد ${faDigits(res.toQty)}`
      )
    } catch (e: any) {
      const message = String(e.message ?? '')
      if (message.includes('تایید کنید تا انجام شود')) setForceAsk(message)
      else setErr(message)
    } finally {
      setBusy(false)
    }
  }

  /** خروجی اکسل: کل موجودی × انبار، یا تاریخچه‌ی انتقالات. */
  const exportNow = async () => {
    try {
      const res =
        view === 'history'
          ? await exportTable({
              fileName: 'انبار-مرکزی-تاریخچه-انتقالات',
              sheetName: 'تاریخچه',
              title: 'تاریخچه‌ی تغییرات و انتقالات انبار مرکزی',
              headers: ['تاریخ', 'ساعت', 'انبار', 'نوع', 'نام کالا', 'کد', 'قبل', 'بعد', 'تغییر', 'توضیح'],
              rows: history.map((h) => [
                h.dateJalali,
                h.time,
                h.warehouseName,
                h.actionLabel,
                h.name,
                h.code ?? '',
                h.qtyBefore,
                h.qtyAfter,
                h.delta,
                h.note ?? ''
              ])
            })
          : view === 'warehouses'
            ? await exportTable({
                fileName: 'انبارها',
                sheetName: 'انبارها',
                title: 'انبارهای ماژول انبار مرکزی',
                headers: ['نام انبار', 'پیش‌فرض', 'محل / شهر', 'تعداد ردیف', 'جمع موجودی', 'زیر حد هشدار', 'وضعیت', 'توضیح'],
                rows: houses.map((h) => [
                  h.name,
                  h.isDefault ? 'بله' : '',
                  h.location ?? '',
                  h.itemCount,
                  h.totalQty,
                  h.lowCount,
                  h.isActive ? 'فعال' : 'غیرفعال',
                  h.note ?? ''
                ]),
                totals: [
                  'جمع',
                  '',
                  '',
                  houses.reduce((s, h) => s + h.itemCount, 0),
                  houses.reduce((s, h) => s + h.totalQty, 0),
                  houses.reduce((s, h) => s + h.lowCount, 0),
                  '',
                  ''
                ]
              })
            : await exportTable({
                fileName: 'انبار-مرکزی-موجودی',
                sheetName: 'موجودی انبارها',
                title: 'موجودی انبار مرکزی (به تفکیک انبار)',
                headers: ['انبار', 'کد', 'نام کالا', 'تعداد', 'حد هشدار', 'زیر حد هشدار', 'توضیح'],
                rows: shownRows.map((r) => [
                  r.warehouseName,
                  r.code ?? '',
                  r.name,
                  r.qty,
                  r.minQty,
                  r.low ? 'بله' : '',
                  r.note ?? ''
                ]),
                totals: ['جمع', '', `${shownRows.length} ردیف`, total, '', '', '']
              })
      flash(res.canceled ? 'ساخت فایل خروجی لغو شد.' : `فایل اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">انبار مرکزی</h1>
        <input
          className="inp max-w-xs"
          placeholder="جستجو در نام / کد / توضیح"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="kbd">
          {faDigits(shownRows.length)} ردیف · جمع تعداد {faDigits(total)} · {faDigits(houses.length)} انبار
        </span>
        {/* ---------- بخش ۵: سه نمای این پنل ---------- */}
        <div className="flex gap-1 flex-wrap">
          <button className={`btn ${view === 'items' ? 'btn-primary' : ''}`} onClick={() => setView('items')}>
            موجودی
          </button>
          <button className={`btn ${view === 'warehouses' ? 'btn-primary' : ''}`} onClick={() => setView('warehouses')}>
            انبارها
          </button>
          <button className={`btn ${view === 'history' ? 'btn-primary' : ''}`} onClick={() => setView('history')}>
            تاریخچه انتقالات
          </button>
        </div>
        <div className="ms-auto flex gap-1">
          <button className="btn" onClick={() => nav('/products')}>
            کالاها (انبار فروشگاه)
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-300 rounded px-3 py-2 kbd leading-6">
        این فهرست مستقل است: فاکتور خرید، برگشت از فروش، تجمیع و انتقال و گزارش‌ها هیچ‌وقت به آن دست نمی‌زنند و در
        محاسبه‌ی موجودی فروشگاه شمرده نمی‌شود. <b>تنها استثنا</b>: اگر در «پنل فروش تکی» یا «فاکتور فروش عمده»
        چک‌باکس «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی» را روشن کنید، کمبود همان کالا در لحظه‌ی ثبت فاکتور
        از این فهرست کسر و به انبار فروشگاه منتقل می‌شود (با یک هشدار زرد). تیک که خاموش باشد، رفتار قبلی
        (نمایش موجودی منفی) دست‌نخورده است. تطبیق کالا بر اساس <b>کد</b>، بارکد یا <b>نام</b> انجام می‌شود، پس
        بهتر است ردیف‌ها را با دکمه‌ی «نمایش کالاهای انبار فروشگاه» بسازید.
      </div>

      {/**
       * ---------- تنظیمات انبار مرکزی (مورد ۱) ----------
       * مورد ۴ (نشست نهم): این چک‌باکس هم با کلید مستقل خودش قفل است
       * (`PANEL_KEYS.posCentralWithdrawToggle`) — همان قفلی که در پنل فروش و
       * فاکتور عمده روی همین تیک است. جدا و مستقل از قفل خودِ ماژول انبار مرکزی.
       */}
      <ManagerGate
        panel={PANEL_KEYS.posCentralWithdrawToggle}
        title={CENTRAL_WITHDRAW_GATE.title}
        reason={CENTRAL_WITHDRAW_GATE.reason}
        inline
      >
      <div
        className={`rounded shadow p-2 border-2 space-y-1 ${
          autoCentralBox.value ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-300'
        }`}
      >
        <div className="font-bold border-b pb-1">تنظیمات انبار مرکزی</div>
        <label
          className={`flex items-center gap-2 font-bold ${
            autoCentralBox.locked ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
          title={
            autoCentralBox.locked
              ? 'قفل مدیر: کارمند نمی‌تواند این گزینه را تغییر دهد'
              : 'با روشن بودن این گزینه، کمبود موجودی فروشگاه در لحظه‌ی ثبت فاکتور از همین انبار برداشته می‌شود'
          }
        >
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={autoCentralBox.value}
            disabled={autoCentralBox.locked}
            onChange={(e) => void autoCentralBox.toggle(e.target.checked)}
          />
          برداشت خودکار از انبار مرکزی هنگام کمبود موجودی
          {autoCentralBox.locked && <span className="kbd">🔒 فقط مدیر</span>}
        </label>
        <AutoCentralPasswordBox box={autoCentralBox} />
        <div className="kbd leading-6">
          این گزینه با چک‌باکس «برداشت خودکار از انبار مرکزی» در <b>پنل فروش تکی</b> و <b>پنل فاکتور فروش عمده</b> یک
          تنظیم واحد است: از هر کدام روشن/خاموش شود، در آن دو محل دیگر هم همان لحظه همان وضعیت نشان داده می‌شود.
          {autoCentralBox.locked
            ? ' تغییرش فقط با نشست مدیر ممکن است؛ کارمند فقط وضعیت را می‌بیند.'
            : ' فقط مدیر می‌تواند عوضش کند، پس کارمند نمی‌تواند از پنل فروش آن را روشن یا خاموش کند.'}
        </div>
        {autoCentralBox.error && (
          <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300">{autoCentralBox.error}</div>
        )}
      </div>
      </ManagerGate>

      {/* ---------- فرم ثبت / ویرایش ---------- */}
      <div className="bg-white rounded shadow p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <label className="md:col-span-4">
          <div className="kbd">نام کالا</div>
          <input className="inp" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <label className="md:col-span-2">
          <div className="kbd">کد دلخواه (اختیاری)</div>
          <input className="inp" value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
        </label>
        <label className="md:col-span-2">
          <div className="kbd">تعداد</div>
          <input
            type="number"
            className="inp"
            value={draft.qty}
            onChange={(e) => setDraft((d) => ({ ...d, qty: +e.target.value || 0 }))}
          />
        </label>
        {/* بخش ۵: انبار این ردیف (۰ = انبار پیش‌فرض) و حد هشدار موجودی */}
        <label className="md:col-span-2">
          <div className="kbd">انبار</div>
          <select
            className="inp"
            value={draft.warehouseId}
            onChange={(e) => setDraft((d) => ({ ...d, warehouseId: Number(e.target.value) || 0 }))}
          >
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.isDefault ? ' (پیش‌فرض)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-1">
          <div className="kbd">حد هشدار</div>
          <input
            type="number"
            min={0}
            className="inp"
            value={draft.minQty}
            onChange={(e) => setDraft((d) => ({ ...d, minQty: +e.target.value || 0 }))}
          />
        </label>
        <label className="md:col-span-2">
          <div className="kbd">توضیح</div>
          <input className="inp" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        </label>
        <div className="md:col-span-1 flex gap-1">
          <button className="btn btn-primary w-full" onClick={() => void save()} disabled={busy}>
            {draft.id ? 'ویرایش' : 'افزودن'}
          </button>
          {draft.id ? (
            <button className="btn" onClick={() => setDraft(EMPTY)}>
              نو
            </button>
          ) : null}
        </div>
        {/* ---------- انتخاب کالا از فهرست انبار فروشگاه ---------- */}
        <div className="md:col-span-12 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => setShopOpen(true)}>
            ☰ نمایش کالاهای انبار فروشگاه
          </button>
          <span className="kbd">
            فهرست کالاهای <b>انبار فروشگاه</b> (نه انبار مرکزی) باز می‌شود؛ با انتخاب هر کالا، نام و کد همان کالا در
            فرم بالا می‌نشیند و فقط تعداد را می‌نویسید. موجودی انبار فروشگاه با این کار تغییر نمی‌کند.
          </span>
        </div>
      </div>

      <AllProductsModal
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        onPick={pickFromShop}
        title="کالاهای انبار فروشگاه — انتخاب برای ردیف انبار مرکزی"
      />

      {(msg || err) && (
        <div
          className={`rounded px-3 py-2 border whitespace-pre-line ${
            err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          {err ?? msg}
        </div>
      )}

      {/* ---------- نمای «موجودی» ---------- */}
      {view === 'items' && (
      <div className="tbl-card">
        <div className="p-2 border-b flex items-center gap-2 flex-wrap sticky top-0 bg-white z-20">
          <b>موجودی انبارها</b>
          <label className="flex items-center gap-1">
            <span className="kbd">فقط انبار</span>
            <select className="inp py-1 w-44" value={houseFilter} onChange={(e) => setHouseFilter(Number(e.target.value))}>
              <option value={-1}>همه‌ی انبارها</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <table className="tbl">
          <thead className="sticky top-14 bg-white z-10">
            <tr>
              <th className="w-8"></th>
              <th>انبار</th>
              <th>کد</th>
              <th>نام کالا</th>
              <th>تعداد</th>
              <th>حد هشدار</th>
              <th>توضیح</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr
                key={r.id}
                className={sel.includes(r.id) ? 'sel' : ''}
                onDoubleClick={() =>
                  setDraft({
                    id: r.id,
                    name: r.name,
                    code: r.code ?? '',
                    qty: r.qty,
                    note: r.note ?? '',
                    warehouseId: r.warehouseId ?? 0,
                    minQty: r.minQty ?? 0
                  })
                }
              >
                <td>
                  <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="font-bold">{r.warehouseName}</td>
                <td>{r.code ? faDigits(r.code) : '—'}</td>
                <td>{r.name}</td>
                <td className={r.qty < 0 ? 'text-red-500 font-bold' : r.low ? 'text-amber-700 font-bold' : ''}>
                  {faDigits(r.qty)}
                  {r.low && <span className="kbd"> زیر حد هشدار</span>}
                </td>
                <td className="text-center">{r.minQty ? faDigits(r.minQty) : '—'}</td>
                <td>{r.note ?? '—'}</td>
                <td className="whitespace-nowrap">
                  <button
                    className="text-brand font-bold"
                    onClick={() =>
                      setTransfer({
                        itemId: r.id,
                        name: r.name,
                        code: r.code ?? '',
                        fromName: r.warehouseName,
                        available: r.qty,
                        toWarehouseId: houses.find((h) => h.id !== (r.warehouseId ?? 0))?.id ?? 0,
                        qty: Math.max(0, r.qty),
                        note: '',
                        mode: 'house',
                        variantId: 0
                      })
                    }
                    title="انتقال موجودی این ردیف به یک انبار دیگر، یا به انبار فروشگاه (بند ۸)"
                  >
                    انتقال
                  </button>
                  <span className="opacity-40 px-1">|</span>
                  <button
                    className="text-brand"
                    onClick={() => setDraft({
                    id: r.id,
                    name: r.name,
                    code: r.code ?? '',
                    qty: r.qty,
                    note: r.note ?? '',
                    warehouseId: r.warehouseId ?? 0,
                    minQty: r.minQty ?? 0
                  })}
                  >
                    ویرایش
                  </button>
                  <span className="opacity-40 px-1">|</span>
                  <button className="text-red-500" onClick={() => void remove([r.id])} disabled={busy}>
                    حذف
                  </button>
                </td>
              </tr>
            ))}
            {!shownRows.length && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-slate-400">
                  فهرست خالی است؛ با فرم بالا کالا و تعدادش را اضافه کنید.
                </td>
              </tr>
            )}
          </tbody>
          {!!shownRows.length && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-100 font-bold">
                <td colSpan={4}>جمع {faDigits(shownRows.length)} ردیف</td>
                <td>{faDigits(total)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      {/* ---------- نمای «انبارها» (بخش ۵) ---------- */}
      {view === 'warehouses' && (
        <div className="tbl-card">
          <div className="p-2 border-b flex items-center gap-2 flex-wrap sticky top-0 bg-white z-20">
            <b>انبارها / شعبه‌ها</b>
            <button className="btn btn-primary" onClick={() => setHouseDraft(EMPTY_HOUSE)}>
              + افزودن انبار جدید
            </button>
            <span className="kbd">
              «انبار مرکزی» انبار پیش‌فرض است و قابل حذف نیست؛ هر ردیفی که انبار مشخصی نداشته باشد در همان شمرده می‌شود.
              حذف یک انبار، موجودی‌اش را <b>پاک نمی‌کند</b>: ردیف‌هایش به انبار پیش‌فرض منتقل می‌شوند.
            </span>
          </div>
          <table className="tbl">
            <thead className="sticky top-14 bg-white z-10">
              <tr>
                <th>نام انبار</th>
                <th>محل / شهر</th>
                <th>تعداد ردیف</th>
                <th>جمع موجودی</th>
                <th>زیر حد هشدار</th>
                <th>وضعیت</th>
                <th>توضیح</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {houses.map((h) => (
                <tr key={h.id} className={h.isDefault ? 'bg-sky-50' : h.lowCount ? 'bg-amber-50' : ''}>
                  <td className="font-bold">
                    {h.name}
                    {h.isDefault && <span className="kbd"> پیش‌فرض</span>}
                  </td>
                  <td>{h.location ?? '—'}</td>
                  <td className="text-center">{faDigits(h.itemCount)}</td>
                  <td className="font-bold">{faDigits(h.totalQty)}</td>
                  <td className={`text-center ${h.lowCount ? 'text-amber-700 font-bold' : ''}`}>
                    {h.lowCount ? faDigits(h.lowCount) : '—'}
                  </td>
                  <td className={h.isActive ? '' : 'text-slate-400'}>{h.isActive ? 'فعال' : 'غیرفعال'}</td>
                  <td className="whitespace-normal">{h.note ?? '—'}</td>
                  <td className="whitespace-nowrap">
                    {h.isDefault ? (
                      <span className="kbd">قابل حذف نیست</span>
                    ) : (
                      <>
                        <button
                          className="text-brand"
                          onClick={() =>
                            setHouseDraft({ id: h.id, name: h.name, location: h.location ?? '', note: h.note ?? '' })
                          }
                        >
                          ویرایش
                        </button>
                        <span className="opacity-40 px-1">|</span>
                        <button className="text-red-500" onClick={() => setDelHouse(h)} disabled={busy}>
                          حذف
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={2}>جمع {faDigits(houses.length)} انبار</td>
                <td className="text-center">{faDigits(houses.reduce((a, h) => a + h.itemCount, 0))}</td>
                <td>{faDigits(houses.reduce((a, h) => a + h.totalQty, 0))}</td>
                <td className="text-center">{faDigits(houses.reduce((a, h) => a + h.lowCount, 0))}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ---------- نمای «تاریخچه انتقالات» (بخش ۵) ---------- */}
      {view === 'history' && (
        <div className="tbl-card">
          <div className="p-2 border-b flex items-center gap-2 flex-wrap sticky top-0 bg-white z-20">
            <b>تاریخچه‌ی تغییرات و انتقالات</b>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={onlyTransfers}
                onChange={(e) => setOnlyTransfers(e.target.checked)}
              />
              فقط انتقال بین انبارها
            </label>
            <span className="kbd">
              سابقه هیچ‌وقت حذف نمی‌شود؛ حتی با حذف یک ردیف یا یک انبار، سطرهای همان لحظه سر جایشان می‌مانند.
            </span>
          </div>
          {historyWarnings.map((w) => (
            <div key={w} className="mx-2 mt-2 rounded bg-amber-50 px-3 py-2 text-amber-800">
              {w}
            </div>
          ))}
          {historyPage && (
            <div className="flex items-center gap-2 px-2 py-2">
              <button className="btn" disabled={historyPage.skip <= 0} onClick={() => goHistoryPage(historyPage.skip - historyPage.take)}>
                صفحه‌ی قبل
              </button>
              <span className="text-sm text-slate-600">
                نمایش {faDigits(historyPage.skip + 1)} تا {faDigits(historyPage.skip + history.length)} از {faDigits(historyPage.totalCount)}
              </span>
              <button className="btn" disabled={!historyPage.truncated} onClick={() => goHistoryPage(historyPage.skip + historyPage.take)}>
                صفحه‌ی بعد
              </button>
            </div>
          )}
          <table className="tbl">
            <thead className="sticky top-14 bg-white z-10">
              <tr>
                <th>تاریخ</th>
                <th>ساعت</th>
                <th>انبار</th>
                <th>نوع</th>
                <th>نام کالا</th>
                <th>کد</th>
                <th>قبل</th>
                <th>بعد</th>
                <th>تغییر</th>
                <th>توضیح</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className={h.delta < 0 ? 'bg-rose-50' : h.delta > 0 ? 'bg-emerald-50' : ''}>
                  <td>{faDigits(h.dateJalali)}</td>
                  <td>{faDigits(h.time)}</td>
                  <td className="font-bold">{h.warehouseName}</td>
                  <td>{h.actionLabel}</td>
                  <td>{h.name}</td>
                  <td>{h.code ? faDigits(h.code) : '—'}</td>
                  <td className="text-center">{faDigits(h.qtyBefore)}</td>
                  <td className="text-center">{faDigits(h.qtyAfter)}</td>
                  <td className={`text-center font-bold ${h.delta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {h.delta > 0 ? '+' : ''}
                    {faDigits(h.delta)}
                  </td>
                  <td className="whitespace-normal">{h.note ?? '—'}</td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-slate-400">
                    هنوز سابقه‌ای ثبت نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- مودال ثبت / ویرایش انبار ---------- */}
      <Modal
        open={!!houseDraft}
        title={houseDraft?.id ? 'ویرایش انبار' : 'افزودن انبار جدید'}
        onClose={() => setHouseDraft(null)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn btn-primary" onClick={() => void saveHouse()} disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
            <button className="btn" onClick={() => setHouseDraft(null)} disabled={busy}>
              انصراف
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="block">
            <div className="kbd">نام انبار (یکتا)</div>
            <input
              className="inp"
              autoFocus
              value={houseDraft?.name ?? ''}
              onChange={(e) => setHouseDraft((d) => (d ? { ...d, name: e.target.value } : d))}
            />
          </label>
          <label className="block">
            <div className="kbd">شهر / آدرس (اختیاری)</div>
            <input
              className="inp"
              value={houseDraft?.location ?? ''}
              onChange={(e) => setHouseDraft((d) => (d ? { ...d, location: e.target.value } : d))}
            />
          </label>
          <label className="block">
            <div className="kbd">توضیح (اختیاری)</div>
            <input
              className="inp"
              value={houseDraft?.note ?? ''}
              onChange={(e) => setHouseDraft((d) => (d ? { ...d, note: e.target.value } : d))}
            />
          </label>
          <div className="kbd leading-6">
            انبار جدید کاملاً مستقل از انبار فروشگاه است؛ ساختنش هیچ اثری روی موجودی کالاهای فروشگاه ندارد.
          </div>
        </div>
      </Modal>

      {/* ---------- مودال انتقال موجودی بین انبارها ---------- */}
      <Modal
        open={!!transfer}
        title={transfer?.mode === 'store' ? 'انتقال به انبار فروشگاه' : 'انتقال موجودی بین انبارها'}
        onClose={() => setTransfer(null)}
        width="max-w-lg"
        footer={
          <>
            {/**
             * جلسه ۵۴ — «کالای جدید» انتخاب شده باشد، همین دکمه فرمِ کالا را باز
             * می‌کند (و ثبت نهایی از خود فرم می‌رود). مسیر «کالای موجود» عیناً همان
             * `doTransfer` قبلی است و یک خط هم عوض نشده.
             */}
            <button
              className="btn btn-primary"
              onClick={() =>
                transfer?.mode === 'store' && transfer.variantId === NEW_PRODUCT_CHOICE
                  ? askNewProduct()
                  : void doTransfer(false)
              }
              disabled={
                busy ||
                (transfer?.mode === 'store' &&
                  (!toStoreOpen ||
                    !transfer.variantId ||
                    // فرم «کالای جدید» فیلد رمز خودش را دارد
                    (needToStorePw && !toStorePw.trim() && transfer.variantId !== NEW_PRODUCT_CHOICE)))
              }
              title={
                transfer?.mode === 'store' && !toStoreOpen
                  ? 'تا قفل «انتقال به انبار فروشگاه» باز نشود، این انتقال ممکن نیست'
                  : undefined
              }
            >
              {busy
                ? 'در حال انتقال…'
                : transfer?.mode === 'store'
                  ? transfer.variantId === NEW_PRODUCT_CHOICE
                    ? 'ادامه: فرم کالای جدید'
                    : 'انتقال به انبار فروشگاه'
                  : 'ثبت انتقال'}
            </button>
            <button className="btn" onClick={() => setTransfer(null)} disabled={busy}>
              انصراف
            </button>
          </>
        }
      >
        {transfer && (
          <div className="space-y-2">
            <div className="rounded p-2 border-2 bg-sky-50 border-sky-300 leading-7">
              کالا: <b>{transfer.name}</b> · از انبار <b>{transfer.fromName}</b> · موجودی همین ردیف{' '}
              <b>{faDigits(transfer.available)}</b>
            </div>
            {/* ---------- بند ۸: مقصد انتقال ---------- */}
            <label className="block">
              <div className="kbd">مقصد انتقال</div>
              <select
                className="inp"
                value={transfer.mode}
                onChange={(e) => setTransfer((d) => (d ? { ...d, mode: e.target.value as TransferMode } : d))}
              >
                <option value="house">یک انبار دیگر (انبار ۱، ۲، … همین ماژول)</option>
                <option value="store">انبار فروشگاه (همان موجودی ماژول کالا) 🔒</option>
              </select>
            </label>

            {transfer.mode === 'house' ? (
              <label className="block">
                <div className="kbd">به انبار</div>
                <select
                  className="inp"
                  value={transfer.toWarehouseId}
                  onChange={(e) => setTransfer((d) => (d ? { ...d, toWarehouseId: Number(e.target.value) || 0 } : d))}
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                      {h.isDefault ? ' (پیش‌فرض)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              /**
               * قفل مستقل بند ۸: تنها مسیری است که انبار مرکزی موجودی *واقعی*
               * کالاهای فروشگاه را زیاد می‌کند، پس رمز جدا دارد و تا باز نشود
               * حتی فهرست کالاهای پیشنهادی هم خوانده نمی‌شود.
               */
              <ManagerGate
                panel={PANEL_KEYS.secondaryToStore}
                title="انتقال از انبار مرکزی به انبار فروشگاه"
                reason="این انتقال موجودی واقعی کالاهای فروشگاه را زیاد می‌کند (همان عددی که پنل فروش می‌بیند)، پس قفل جدا از خود ماژول انبار مرکزی دارد."
                inline
              >
                <div className="space-y-2">
                  <label className="block">
                    <div className="kbd">جستجوی کالای فروشگاه (نام، کد یا بارکد)</div>
                    <input
                      className="inp"
                      placeholder={transfer.code ? `پیش‌فرض: تطبیق با کد ${transfer.code}` : 'تطبیق با نام همین ردیف'}
                      value={candSearch}
                      onChange={(e) => setCandSearch(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <div className="kbd">کالای مقصد در انبار فروشگاه</div>
                    <select
                      className="inp"
                      value={transfer.variantId}
                      onChange={(e) => setTransfer((d) => (d ? { ...d, variantId: Number(e.target.value) || 0 } : d))}
                    >
                      <option value={0}>— انتخاب کنید —</option>
                      {cands.map((c) => (
                        <option key={c.variantId} value={c.variantId}>
                          {c.name} · کد {c.code} · موجودی {c.stock} ({c.reason})
                        </option>
                      ))}
                      {/* جلسه ۵۴ — گزینه‌ی «هیچ‌کدام» کنار پیشنهادها (خواسته‌ی ۱) */}
                      {cands.length > 0 && (
                        <option value={NEW_PRODUCT_CHOICE}>هیچ‌کدام — کالای جدید بساز</option>
                      )}
                    </select>
                  </label>
                  {/**
                   * جلسه ۵۴ — «هیچ کالایی پیدا نشد» دیگر یک تذکر خنثی نیست: یک سؤال
                   * روشن با «بله/خیر» است. تا وقتی کاربر خودش «بله» نزند، هیچ کالایی
                   * ساخته نمی‌شود (ساخت بی‌صدا و خودکار ممنوع).
                   */}
                  {!cands.length && (
                    <div className="rounded p-2 border-2 bg-amber-50 border-amber-300 leading-7 space-y-2">
                      <div>
                        چنین کالایی در انبار فروشگاه پیدا نشد. می‌خواهید به‌عنوان <b>کالای جدید</b> ثبت شود؟
                      </div>
                      {newProdDeclined ? (
                        <div className="kbd">
                          باشد. با کادر جست‌وجوی بالا نام یا کد کالای فروشگاه را بنویسید، یا دوباره «بله» را بزنید.
                          انتخاب کالا عمداً دستی است: یک انتقال به کالای اشتباه، موجودی دو کالا را با هم غلط
                          می‌کند.
                        </div>
                      ) : null}
                      <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={askNewProduct} disabled={busy}>
                          بله، کالای جدید ثبت کن
                        </button>
                        <button className="btn" onClick={() => setNewProdDeclined(true)} disabled={busy}>
                          خیر
                        </button>
                      </div>
                    </div>
                  )}
                  {/* «هیچ‌کدام» از فهرست پیشنهادها انتخاب شده ⇒ همین‌جا هم راه ساخت باز باشد */}
                  {cands.length > 0 && transfer.variantId === NEW_PRODUCT_CHOICE && (
                    <div className="rounded p-2 border-2 bg-amber-50 border-amber-300 leading-7 space-y-2">
                      <div>
                        هیچ‌یک از پیشنهادها همان کالا نیست ⇒ به‌عنوان <b>کالای جدید</b> (یا واریانت تازه‌ی یک کالای
                        موجود) ثبت می‌شود.
                      </div>
                      <button className="btn btn-primary" onClick={askNewProduct} disabled={busy}>
                        فرم کالای جدید را باز کن
                      </button>
                    </div>
                  )}
                  {(() => {
                    const c = cands.find((x) => x.variantId === transfer.variantId)
                    if (!c) return null
                    const after = c.stock + Math.round(transfer.qty || 0)
                    const covered = c.stock < 0 ? Math.min(Math.round(transfer.qty || 0), -c.stock) : 0
                    return (
                      <div className="rounded p-2 border-2 bg-emerald-50 border-emerald-300 leading-7">
                        موجودی فعلی «{c.name}» در انبار فروشگاه:{' '}
                        <b className={c.stock < 0 ? 'text-red-600' : ''}>{faDigits(c.stock)}</b> ⇒ پس از انتقال:{' '}
                        <b>{faDigits(after)}</b>
                        {covered > 0 && (
                          <div className="text-amber-800 font-bold">
                            {faDigits(covered)} عدد از این {faDigits(Math.round(transfer.qty || 0))} عدد صرف جبران
                            کسری قبلی (موجودی منفی) می‌شود، پس موجودی نهایی {faDigits(after)} خواهد بود.
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </ManagerGate>
            )}
            {transfer.mode === 'store' && needToStorePw && transfer.variantId !== NEW_PRODUCT_CHOICE && (
              <label className="block">
                <div className="kbd">
                  رمز مدیر (یا رمز دوم پنل «انتقال به انبار فروشگاه») — سرور خودش همین رمز را هنگام ثبت انتقال می‌سنجد
                </div>
                <PasswordField value={toStorePw} onChange={(e) => setToStorePw(e.target.value)} />
              </label>
            )}
            <label className="block">
              <div className="kbd">تعداد</div>
              <input
                type="number"
                min={1}
                className="inp"
                value={transfer.qty}
                onChange={(e) => setTransfer((d) => (d ? { ...d, qty: Math.max(0, +e.target.value || 0) } : d))}
              />
            </label>
            <label className="block">
              <div className="kbd">توضیح (اختیاری)</div>
              <input
                className="inp"
                value={transfer.note}
                onChange={(e) => setTransfer((d) => (d ? { ...d, note: e.target.value } : d))}
              />
            </label>
            <div className="kbd leading-6">
              {transfer.mode === 'house'
                ? 'در انبار مقصد، ردیف همنام و همکد پیدا و تعدادش زیاد می‌شود؛ اگر نبود یک ردیف تازه ساخته می‌شود. انتقال بیشتر از موجودی ردیف فقط با تایید آگاهانه انجام می‌گیرد. موجودی انبار فروشگاه در این مسیر مطلقاً تغییر نمی‌کند.'
                : 'موجودی از ردیف انبار مرکزی کم و به موجودی واقعی کالای فروشگاه اضافه می‌شود. موجودی منفی فروشگاه درست لحاظ می‌گردد: اگر کالایی ۳− باشد و ۱۰ عدد منتقل شود، موجودی نهایی ۷ می‌شود. انتقال بیشتر از موجودی ردیف مبدأ فقط با تایید آگاهانه انجام می‌گیرد.'}
            </div>
          </div>
        )}
      </Modal>

      {/* جلسه ۵۴ — فرم «کالای جدید» (ساخت + انتقال، اتمیک در یک تراکنش) */}
      <NewStoreProductModal
        seed={newProd}
        busy={busy}
        onCancel={() => setNewProd(null)}
        onConfirm={(payload) => void doToStoreNew(payload)}
      />

      <ConfirmDialog
        open={!!forceAsk}
        title="تعداد انتقال بیشتر از موجودی ردیف است"
        message={<div className="whitespace-pre-line">{forceAsk}</div>}
        confirmLabel="بله، انتقال بده"
        cancelLabel="انصراف"
        busy={busy}
        onConfirm={() => void doTransfer(true)}
        onCancel={() => setForceAsk(null)}
      />

      <ConfirmDialog
        open={!!delHouse}
        title="حذف انبار"
        message={
          <div className="space-y-2">
            <p>
              انبار <b>{delHouse?.name}</b> حذف می‌شود و <b>{faDigits(delHouse?.itemCount ?? 0)}</b> ردیف کالایش (جمع{' '}
              {faDigits(delHouse?.totalQty ?? 0)} عدد) به <b>انبار مرکزی (پیش‌فرض)</b> منتقل می‌گردد.
            </p>
            <p className="kbd">هیچ موجودی‌ای پاک نمی‌شود و سابقه‌ی انتقالات هم سر جایش می‌ماند.</p>
          </div>
        }
        confirmLabel="بله، حذف کن"
        busy={busy}
        onConfirm={() => delHouse && void removeHouse(delHouse)}
        onCancel={() => setDelHouse(null)}
      />

      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn btn-danger" onClick={() => void remove(sel)} disabled={busy || !sel.length || view !== 'items'}>
          حذف موارد انتخابی
        </button>
        <button className="btn" onClick={() => void exportNow()}>
          خروجی اکسل
        </button>
        <span className="kbd">
          دوبار کلیک روی هر ردیف = ویرایش · ارتفاع ردیف‌ها را هم می‌توانید با کشیدن مرز پایینشان عوض کنید.
        </span>
      </div>
    </div>
  )
}
