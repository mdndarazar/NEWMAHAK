import { useCallback, useEffect, useMemo, useState } from 'react'
import { call, CH } from '../lib/api'
import { money, faDigits, toJalaliDateTime } from '@shared/jalali'
import { useHotkeys } from '../hooks/useHotkeys'
import Modal from '../components/Modal'
import ProductFormModal, { emptyProduct, type ProductDraft, type VariantDraft } from '../components/ProductFormModal'
import MovementsModal from '../components/MovementsModal'
import CategoryModal from '../components/CategoryModal'
import StockAdjustModal from '../components/StockAdjustModal'
import LabelPrintModal from '../components/LabelPrintModal'
import PasswordField from '../components/PasswordField'
import { usePanelLock } from '../hooks/usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import type { VariantPurgePreview } from '@shared/types'
/**
 * جلسه ۴۳ · کار ب (فقط خواندنی) — «کالای برگشتیِ در انتظار تأیید مدیر».
 * ستون و نشانش از همان منبع مشترک می‌آید و این صفحه **هیچ دکمه‌ی تأیید یا
 * بازگشت به انبار نمی‌سازد**: آزادسازی فقط در پنل قفل‌دار «پرداخت‌های مدیر».
 */
import { PendingStockBadge } from '../components/CardTransferPanel'
import { usePendingRestock, pendingToneBox } from '../hooks/usePendingRestock'
import {
  PENDING_RESTOCK_COLUMN,
  PENDING_RESTOCK_EXPLAINER,
  expectedPhysicalQty
} from '@shared/pendingRestock'

type Sheet = 'none' | 'form' | 'movements' | 'category' | 'stock' | 'labels' | 'confirmDelete' | 'confirmPurge'
/** «کالاها» یا «سطل آشغال» (کالاهای حذف‌شده‌ی قابل بازگردانی) */
type View = 'active' | 'trash'

/**
 * صفحه‌ی «کالاها» (F8).
 * جدول = واریانت‌ها (چیزی که واقعاً شمرده و فروخته می‌شود)، فرم = محصول پایه + واریانت‌ها.
 * میان‌برها: F4 جدید · F5 ویرایش · F6 بازبینی (گردش انبار) · F7 حذف موارد انتخابی
 * نکته: F2/F3/F8..F11 در Shell به ناوبری گره خورده‌اند، پس در این صفحه دوباره
 * bind نمی‌شوند (دکمه‌ی «نمایش گردش کالا» بدون میان‌بر است).
 *
 * سطل آشغال (تب دوم):
 *   حذف کالا از اول «حذف نرم» بود (isActive = false و رکورد سر جایش می‌ماند)،
 *   ولی راه برگشتی در UI نداشت. حالا تب «سطل آشغال» همان واریانت‌های حذف‌شده را
 *   با نام کالا، سایز/رنگ، بارکد و تاریخ حذف نشان می‌دهد و با یک دکمه برمی‌گرداند
 *   (بازگردانی در AuditLog با کاربر و زمان ثبت می‌شود). چون داده هیچ‌وقت واقعاً
 *   پاک نشده، موجودی و همه‌ی حرکات انبار همان لحظه سالم برمی‌گردند.
 */
export default function Products() {
  const [view, setView] = useState<View>('active')
  const [rows, setRows] = useState<any[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [catId, setCatId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<number[]>([])
  const [sheet, setSheet] = useState<Sheet>('none')
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [target, setTarget] = useState<any | null>(null)
  const [labelRows, setLabelRows] = useState<any[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** پیش‌نمایش «حذف همیشگی» (مورد ۸): چه سابقه‌ای به این کالاها وصل است */
  const [purge, setPurge] = useState<VariantPurgePreview | null>(null)
  /**
   * نشست ۱۴۶ · بند ۴-۳۹/۴-۴۰ — «حذف دائمی کالا» فقط‌مدیر است و main رمز پنل
   * کالاها را برای *همین عملیات* دوباره می‌سنجد (باز بودن صفحه کافی نیست).
   */
  const [purgePw, setPurgePw] = useState('')
  const { lockEnabled: productsLock, loaded: productsLockLoaded } = usePanelLock(PANEL_KEYS.products)
  const needPurgePw = !productsLockLoaded || productsLock

  const load = useCallback(
    () =>
      (view === 'trash'
        ? call<any[]>(CH.productTrash, { search })
        : call<any[]>(CH.productList, { search, categoryId: catId })
      )
        .then((r) => {
          setRows(r)
          setSel((s) => s.filter((id) => r.some((x) => x.id === id)))
        })
        .catch((e: any) => setErr(e.message)),
    [search, catId, view]
  )

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    call<any[]>(CH.categoryTree).then(setCats).catch(() => {})
  }, [])

  const stockSum = rows.reduce((s, r) => s + r.stock, 0)
  const selectedRows = useMemo(() => rows.filter((r) => sel.includes(r.id)), [rows, sel])

  /**
   * «معلق برگشتی» — فقط در نمای کالاها (سطل آشغال کالای معلق ندارد).
   * عدد `stock` هیچ‌جا دست‌کاری نمی‌شود؛ معلق یک ستون *جدا* است، چون همان قاطی
   * کردن دو عدد بود که این کار برای رفعش نوشته شد.
   */
  const pending = usePendingRestock(view === 'active')
  const pendingVisible = useMemo(
    () => rows.reduce((s, r) => s + pending.qtyOfVariant(r.id), 0),
    [rows, pending]
  )

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleAll = () => setSel((s) => (s.length === rows.length ? [] : rows.map((r) => r.id)))

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 6000)
  }

  const needOne = (): any | null => {
    if (selectedRows.length !== 1) {
      setErr('برای این عملیات دقیقاً یک ردیف را انتخاب کنید')
      return null
    }
    return selectedRows[0]
  }

  // ---------------------- جدید (F4) ----------------------
  const openNew = () => {
    setDraft(emptyProduct(catId))
    setErr(null)
    setSheet('form')
  }

  // ---------------------- ویرایش (F5) ----------------------
  /** همه‌ی واریانت‌های همان محصول را می‌آورد تا ویرایش، ناقص نباشد. */
  const openEdit = async (row?: any) => {
    const r = row ?? needOne()
    if (!r) return
    setBusy(true)
    try {
      const all = await call<any[]>(CH.productList, { search: r.product.name, take: 500 })
      const family = all.filter((x) => x.productId === r.productId)
      const source = family.length ? family : rows.filter((x) => x.productId === r.productId)
      const variants: VariantDraft[] = source
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((v) => ({
          id: v.id,
          code: v.code ?? '',
          barcode: v.barcode ?? '',
          size: v.size ?? '',
          color: v.color ?? '',
          salePrice: v.salePrice,
          purchasePrice: v.purchasePrice,
          ledgerAccountCode: v.ledgerAccountCode ?? '',
          stock: v.stock
        }))
      setDraft({
        id: r.productId,
        name: r.product.name,
        categoryId: r.product.categoryId ?? null,
        unit: r.product.unit ?? 'عدد',
        note: r.product.note ?? '',
        reportLiveName: !!r.product.reportLiveName,
        variants
      })
      setErr(null)
      setSheet('form')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------- بازبینی (F6) ----------------------
  const openMovements = (row?: any) => {
    const r = row ?? needOne()
    if (!r) return
    setTarget(r)
    setErr(null)
    setSheet('movements')
  }

  // ---------------------- حذف موارد انتخابی (F7) ----------------------
  const askDelete = () => {
    if (!selectedRows.length) return setErr('ابتدا ردیف‌های مورد نظر را انتخاب کنید')
    setErr(null)
    setSheet('confirmDelete')
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await call(CH.productDelete, { variantIds: sel })
      const n = sel.length
      setSel([])
      setSheet('none')
      await load()
      flash(
        `${faDigits(n)} کالا به سطل آشغال رفت (سابقه و حرکات انبارشان حفظ شده است و از تب «سطل آشغال» قابل بازگردانی است)`
      )
    } catch (e: any) {
      setErr(e.message)
      setSheet('none')
    } finally {
      setBusy(false)
    }
  }

  // ---------------------- بازگردانی از سطل آشغال ----------------------
  const doRestore = async (ids: number[]) => {
    if (!ids.length) return setErr('برای بازگردانی، حداقل یک ردیف را انتخاب کنید')
    setBusy(true)
    try {
      const count = await call<number>(CH.productRestore, { variantIds: ids })
      setSel([])
      await load()
      flash(`${faDigits(count)} کالا بازگردانی شد و همین حالا در جستجو و پنل فروش دیده می‌شود`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------- حذف همیشگی از سطل آشغال (مورد ۸) ----------------------
  /**
   * اول پیش‌نمایش گرفته می‌شود (چند ردیف فاکتور و چند حرکت انبار درگیرند)، بعد
   * هشدار روشن فارسی نشان داده می‌شود و *فقط با تایید کاربر* حذف واقعی انجام
   * می‌گیرد — طبق اصل «هشدار بده، ولی بعد از تایید بدون قید و شرط انجام بده».
   */
  const askPurge = async (ids: number[]) => {
    if (!ids.length) return setErr('برای حذف همیشگی، حداقل یک ردیف را انتخاب کنید')
    setBusy(true)
    try {
      setPurge(await call<VariantPurgePreview>(CH.productPurgePreview, { variantIds: ids }))
      setErr(null)
      setSheet('confirmPurge')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const doPurge = async () => {
    setBusy(true)
    try {
      const res = await call<{ deleted: number; snapshots: number; movements: number }>(CH.productPurge, {
        variantIds: sel,
        managerPassword: purgePw.trim() || null
      })
      setSel([])
      setSheet('none')
      setPurge(null)
      await load()
      flash(
        `${faDigits(res.deleted)} کالا برای همیشه از دیتابیس پاک شد. ` +
          `نام و کد کالا در ${faDigits(res.snapshots)} ردیف فاکتور گذشته نگه داشته شد (جمع فاکتورها دست‌نخورده است) و ` +
          'دفتر گردش انبار دست‌نخورده ماند.'
      )
    } catch (e: any) {
      setErr(e.message)
      setSheet('none')
    } finally {
      setPurgePw('')
      setBusy(false)
    }
  }

  // ---------------------- چاپ لیبل و بارکد ----------------------
  /**
   * قبلاً همین‌جا لیبل ساخته و بی‌درنگ چاپ می‌شد. حالا فقط مودال پیش‌نمایش باز
   * می‌شود: تعداد نسخه‌ی هر کالا و حالت متن («فقط اسم» / «اسم و رنگ») آنجا
   * انتخاب می‌شود و چاپ واقعی بعد از تایید کاربر انجام می‌گیرد.
   */
  const openLabels = (list: any[]) => {
    if (!list.length) return setErr('برای چاپ لیبل، حداقل یک ردیف را انتخاب کنید')
    setErr(null)
    setLabelRows(list)
    setSheet('labels')
  }

  const modalOpen = sheet !== 'none'
  const hotkeys = useMemo(
    () => ({
      F4: openNew,
      F5: () => void openEdit(),
      F6: () => openMovements(),
      F7: askDelete
    }),
    [selectedRows, rows, catId]
  )
  useHotkeys(hotkeys, !modalOpen && view === 'active')

  return (
    <div className="grid grid-cols-12 gap-3 pb-10">
      <aside className="col-span-2 bg-white rounded shadow p-2 overflow-auto">
        <div className="font-bold mb-2">گروه کالا</div>
        <button
          className={`w-full text-right px-2 py-1 rounded ${catId === null ? 'bg-brand text-white' : 'hover:bg-slate-100'}`}
          onClick={() => setCatId(null)}
        >
          کلیه کالاها
        </button>
        {/* category:tree الان واقعاً درختی مرتب است (هر ریشه و بلافاصله فرزندانش)،
            پس همین فهرست تخت با تورفتگی depth، ساختار درست را نشان می‌دهد.
            کلیک روی یک والد ⇒ محصولات خودش + همه‌ی زیردسته‌هایش. */}
        {cats.map((c) => {
          const depth = c.depth ?? (c.parentId ? 1 : 0)
          return (
            <button
              key={c.id}
              style={{ paddingInlineStart: 8 + depth * 14 }}
              className={`w-full text-right px-2 py-1 rounded ${
                catId === c.id ? 'bg-brand text-white' : depth ? 'text-slate-600 hover:bg-slate-100' : 'hover:bg-slate-100'
              }`}
              onClick={() => setCatId(c.id)}
              title={depth ? 'زیردسته' : 'با انتخاب این گروه، کالاهای زیرگروه‌هایش هم نمایش داده می‌شود'}
            >
              {depth ? '— ' : ''}
              {c.name}
            </button>
          )
        })}
        <button className="btn w-full mt-3" onClick={() => setSheet('category')}>
          دسته‌بندی
        </button>
      </aside>

      <section className="col-span-10 flex flex-col gap-2">
        <div className="bg-white rounded shadow p-2 flex gap-2 items-center flex-wrap">
          <button
            className={`btn ${view === 'active' ? 'btn-primary' : ''}`}
            onClick={() => {
              setView('active')
              setSel([])
            }}
          >
            کالاها
          </button>
          <button
            className={`btn ${view === 'trash' ? 'btn-primary' : ''}`}
            onClick={() => {
              setView('trash')
              setSel([])
            }}
            title="کالاهای حذف‌شده؛ هر کدام را بخواهید برمی‌گردانید"
          >
            سطل آشغال
          </button>
          <input
            className="inp"
            placeholder="جستجو بر اساس نام کامل کالا یا کد یا بارکد"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="kbd whitespace-nowrap">
            {faDigits(rows.length)} ردیف · {faDigits(sel.length)} انتخاب‌شده
          </div>
        </div>

        {/* ---- هشدار خواندنیِ «در انتظار تأیید مدیر» (هیچ دکمه‌ای ندارد) ---- */}
        {view === 'active' && pending.headline && (
          <div className={`rounded border-2 p-3 leading-7 ${pendingToneBox(pending.tone)}`}>
            <b>{pending.headline}</b>
            <div className="kbd leading-6 mt-1">
              ستون «{PENDING_RESTOCK_COLUMN}» همین تعداد را جدا نشان می‌دهد. ستون «موجودی» عیناً موجودی
              قابل‌فروش است و دست نخورده؛ موجودی فیزیکیِ روی قفسه = موجودی + معلق. برگرداندن کالا به موجودی
              قابل‌فروش فقط در پنل قفل‌دار «پرداخت‌های مدیر — کارت‌به‌کارت» (گزارشات فروش) انجام می‌شود.
            </div>
          </div>
        )}

        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" checked={!!rows.length && sel.length === rows.length} onChange={toggleAll} />
                </th>
                <th>کد</th>
                <th>بارکد</th>
                <th>نام کامل کالا</th>
                <th>سایز</th>
                <th>رنگ</th>
                <th>موجودی</th>
                <th title={PENDING_RESTOCK_EXPLAINER}>{PENDING_RESTOCK_COLUMN}</th>
                <th>{view === 'trash' ? 'تاریخ حذف' : 'واحد'}</th>
                <th>فروش نقدی</th>
                <th>خرید نقدی</th>
                <th>{view === 'trash' ? 'دسته‌بندی' : 'کد حساب تفصیلی'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={sel.includes(r.id) ? 'sel' : ''}
                  onDoubleClick={() => {
                    if (view === 'trash') return void doRestore([r.id])
                    setSel([r.id])
                    void openEdit(r)
                  }}
                >
                  <td>
                    <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>{faDigits(r.code)}</td>
                  <td>{faDigits(r.barcode)}</td>
                  <td>{r.product.name}</td>
                  <td>{r.size ? faDigits(r.size) : '—'}</td>
                  <td>{r.color ?? '—'}</td>
                  <td className={r.stock <= 0 ? 'text-red-500 font-bold' : ''}>{faDigits(r.stock)}</td>
                  {/* معلق برگشتی: خواندنی، جدا از موجودی، با توضیح فیزیکی/قابل‌فروش */}
                  <td
                    className="whitespace-nowrap"
                    title={
                      pending.qtyOfVariant(r.id)
                        ? `موجودی فیزیکیِ مورد انتظار روی قفسه: ${faDigits(
                            expectedPhysicalQty(r.stock, pending.qtyOfVariant(r.id))
                          )} · ${PENDING_RESTOCK_EXPLAINER}`
                        : undefined
                    }
                  >
                    {pending.qtyOfVariant(r.id) ? (
                      <PendingStockBadge qty={pending.qtyOfVariant(r.id)} tone={pending.tone} />
                    ) : (
                      <span className="kbd">—</span>
                    )}
                  </td>
                  <td>
                    {view === 'trash'
                      ? r.deletedAt
                        ? faDigits(toJalaliDateTime(new Date(r.deletedAt)))
                        : '—'
                      : r.product.unit}
                  </td>
                  <td>{money(r.salePrice)}</td>
                  <td>{money(r.purchasePrice)}</td>
                  <td>{view === 'trash' ? r.product?.category?.name ?? '—' : r.ledgerAccountCode ?? '-'}</td>
                  <td className="whitespace-nowrap">
                    {view === 'trash' ? (
                      <>
                        <button className="text-emerald-700 font-bold" onClick={() => void doRestore([r.id])} disabled={busy}>
                          بازگردانی
                        </button>
                        <span className="opacity-40 px-1">|</span>
                        <button className="text-brand" onClick={() => openMovements(r)}>
                          گردش
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="text-brand"
                          onClick={() => {
                            setTarget(r)
                            setSheet('stock')
                          }}
                        >
                          موجودی
                        </button>
                        <button className="text-brand ms-2" onClick={() => openMovements(r)}>
                          گردش
                        </button>
                        <button className="text-brand ms-2" onClick={() => openLabels([r])}>
                          لیبل
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={13} className="text-center py-10 text-slate-400">
                    {view === 'trash'
                      ? 'سطل آشغال خالی است؛ هر کالایی که حذف کنید اینجا می‌آید و قابل بازگردانی است.'
                      : 'اطلاعاتی برای نمایش وجود ندارد'}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={6}>جمع</td>
                <td>{faDigits(stockSum)}</td>
                <td className={pendingVisible ? 'text-amber-900' : ''}>
                  {pendingVisible ? faDigits(pendingVisible) : faDigits(0)}
                </td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {(msg || err) && (
          <div
            className={`rounded px-3 py-2 border whitespace-pre-line ${err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}
          >
            {err ?? msg}
          </div>
        )}

        {view === 'trash' ? (
          <div className="flex gap-2 flex-wrap items-center">
            <button className="btn btn-primary" onClick={() => void doRestore(sel)} disabled={busy || !sel.length}>
              بازگردانی موارد انتخابی
            </button>
            <button className="btn btn-danger" onClick={() => void askPurge(sel)} disabled={busy || !sel.length}>
              حذف همیشگی موارد انتخابی
            </button>
            <button className="btn" onClick={() => setView('active')}>
              بازگشت به فهرست کالاها
            </button>
            <span className="kbd">
              «بازگردانی» کالا را همان لحظه با همان موجودی و همان سابقه‌ی حرکات انبار به فهرست برمی‌گرداند. «حذف
              همیشگی» رکورد کالا را واقعاً از دیتابیس پاک می‌کند (غیرقابل بازگشت)، ولی فاکتورهای گذشته و جمع‌هایشان
              دست‌نخورده می‌مانند. هر دو در AuditLog ثبت می‌شوند.
            </span>
          </div>
        ) : (
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={openNew}>
            جدید <span className="keycap">F4</span>
          </button>
          <button className="btn" onClick={() => openEdit()} disabled={busy}>
            ویرایش <span className="keycap">F5</span>
          </button>
          <button className="btn" onClick={() => openMovements()}>
            بازبینی <span className="keycap">F6</span>
          </button>
          <button className="btn btn-danger" onClick={askDelete}>
            حذف موارد انتخابی <span className="keycap">F7</span>
          </button>
          <button className="btn" onClick={() => openMovements()}>
            نمایش گردش کالا
          </button>
          <button className="btn" onClick={() => setSheet('category')}>
            دسته‌بندی
          </button>
          <button className="btn" onClick={() => openLabels(selectedRows)}>
            چاپ لیبل و بارکد
          </button>
        </div>
        )}
      </section>

      <ProductFormModal
        open={sheet === 'form'}
        initial={draft}
        cats={cats}
        onClose={() => setSheet('none')}
        onSaved={(m) => {
          setSheet('none')
          void load()
          flash(m)
        }}
      />

      <MovementsModal open={sheet === 'movements'} variant={target} onClose={() => setSheet('none')} />

      <CategoryModal
        open={sheet === 'category'}
        cats={cats}
        onClose={() => setSheet('none')}
        onChanged={(fresh, m) => {
          setCats(fresh)
          flash(m)
        }}
      />

      <LabelPrintModal
        open={sheet === 'labels'}
        rows={labelRows}
        onClose={() => setSheet('none')}
        onPrinted={(m) => {
          setSheet('none')
          flash(m)
        }}
      />

      <StockAdjustModal
        open={sheet === 'stock'}
        variant={target}
        onClose={() => setSheet('none')}
        onSaved={(m) => {
          setSheet('none')
          void load()
          flash(m)
        }}
      />

      {/* ---------- هشدار حذف همیشگی (مورد ۸) ---------- */}
      <Modal
        open={sheet === 'confirmPurge'}
        title="حذف همیشگی کالا از سطل آشغال"
        onClose={() => {
          setPurgePw('')
          setSheet('none')
        }}
        width="max-w-2xl"
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setPurgePw('')
                setSheet('none')
              }}
              disabled={busy}
            >
              انصراف
            </button>
            <button
              className="btn btn-danger"
              onClick={() => void doPurge()}
              disabled={busy || purge?.canPurge === false || (needPurgePw && !purgePw.trim())}
            >
              {busy ? 'در حال حذف…' : 'بله، برای همیشه پاک کن'}
            </button>
          </>
        }
      >
        <div className="bg-red-50 border-2 border-red-400 rounded px-3 py-2 leading-6">
          این {faDigits(selectedRows.length)} کالا <b>برای همیشه حذف می‌شود و قابل بازگشت نیست</b>. سابقه‌ی
          فروش/خریدهای گذشته‌اش دست‌نخورده می‌ماند (نام و کد کالا داخل همان ردیف‌های فاکتور نگه داشته می‌شود، پس
          فاکتورها و جمع‌هایشان درست و خوانا می‌مانند)، اما اگر بعداً بخواهید موجودی و گردش انبار این کالا را ببینید
          دیگر ممکن نیست.
        </div>
        {/* نشست ۱۷۸ (S178-D4) — مانع‌های واقعی purge پیش از زدن دکمه (پیش‌نمایش = عملیات) */}
        {(purge?.blockers ?? []).length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-400 rounded px-3 py-2 leading-6">
            <b>حذف همیشگی این انتخاب انجام نمی‌شود:</b>
            <ul className="list-disc pr-5">
              {(purge?.blockers ?? []).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {(purge?.notices ?? []).map((n, i) => (
          <div key={i} className="kbd leading-6">
            {n}
          </div>
        ))}
        <ul className="max-h-48 overflow-auto border rounded p-2 space-y-1">
          {(purge?.lines ?? []).map((l) => (
            <li key={l.variantId}>
              {faDigits(l.code)} — {l.name} · موجودی {faDigits(l.stock)} ·{' '}
              <span className="kbd">
                {faDigits(l.saleItems)} ردیف فروش · {faDigits(l.purchaseItems)} ردیف خرید · {faDigits(l.returnItems)} ردیف
                برگشت · {faDigits(l.movements)} حرکت انبار (حذف را مسدود می‌کند)
              </span>
              {l.blockedReason && <div className="text-amber-700">⛔ {l.blockedReason}</div>}
            </li>
          ))}
        </ul>
        <div className="kbd leading-6">
          جمع: نام و کد کالا در {faDigits(purge?.historyRows ?? 0)} ردیف سابقه نگه داشته می‌شود و{' '}
          {faDigits(purge?.movements ?? 0)} حرکت انبار وجود دارد؛ در این حالت حذف همیشگی انجام نمی‌شود چون دفتر گردش پاک‌شدنی نیست.
        </div>
        {needPurgePw && (
          <label className="block">
            <div className="mb-1">رمز مدیر (یا رمز دوم پنل کالاها) برای همین حذف همیشگی</div>
            <PasswordField value={purgePw} onChange={(e) => setPurgePw(e.target.value)} />
            <div className="kbd leading-6">
              «حذف دائمی کالا» کار فقط‌مدیر است؛ سرور رمز را برای همین عملیات دوباره می‌سنجد و نوع تأیید همراه نام کارمند
              نشست در سابقه ثبت می‌شود.
            </div>
          </label>
        )}
      </Modal>

      <Modal
        open={sheet === 'confirmDelete'}
        title="حذف موارد انتخابی"
        onClose={() => setSheet('none')}
        width="max-w-lg"
        footer={
          <>
            <button className="btn" onClick={() => setSheet('none')} disabled={busy}>
              انصراف
            </button>
            <button className="btn btn-danger" onClick={doDelete} disabled={busy}>
              {busy ? 'در حال حذف…' : 'حذف'}
            </button>
          </>
        }
      >
        <p>
          {faDigits(selectedRows.length)} کالا غیرفعال می‌شود و از جستجو و پنل فروش حذف می‌گردد. حرکات انبار و
          فاکتورهای گذشته دست‌نخورده می‌مانند (حذف نرم).
        </p>
        <ul className="max-h-48 overflow-auto border rounded p-2 space-y-1">
          {selectedRows.map((r) => (
            <li key={r.id}>
              {faDigits(r.code)} — {r.product.name}
              {r.size ? ` سایز ${faDigits(r.size)}` : ''} (موجودی {faDigits(r.stock)})
            </li>
          ))}
        </ul>
        {selectedRows.some((r) => r.stock !== 0) && (
          <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">
            بعضی از این کالاها موجودی غیرصفر دارند؛ ابتدا انبارگردانی کنید تا گزارش موجودی درست بماند.
          </div>
        )}
      </Modal>
    </div>
  )
}
