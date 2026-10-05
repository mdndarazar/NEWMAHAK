import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import ManagerGate from './ManagerGate'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
import { usePanelLock, usePanelOpen } from '../hooks/usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, parseGroupedInteger } from '@shared/jalali'
import type { SecondaryToStoreNewVariantInput } from '@shared/types'

/** همان شکل خروجی `category:tree` (در `PriceAdjust.tsx` هم محلی تعریف شده است). */
interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  /** ۰ = ریشه، ۱ = زیردسته، … (برای پیشوند «— » در select) */
  depth: number
}

/**
 * ===========================================================================
 * جلسه ۵۴ — فرم «ثبت کالای جدید در انبار فروشگاه، هنگام انتقال از انبار مرکزی».
 *
 * چرا یک کامپوننت جدا: پنجره‌ی انتقال (`SecondaryStock.tsx`) از قبل شلوغ است و
 * این فرم منطق خودش را دارد (دسته‌ها، جست‌وجوی کالای موجود، اعتبارسنجی قیمت،
 * دو رمز). پنجره‌ی انتقال فقط همین را باز می‌کند و مسیر «انتقال به کالای موجود»
 * یک خط هم عوض نشده است.
 *
 * دو حالت:
 *   • «کالای کاملاً جدید» — نام و کد از ردیف انبار مرکزی از قبل پر می‌شوند.
 *   • «واریانت تازه برای یک کالای موجود» — مثلاً همان شلوار، سایز دیگر. پس
 *     کالای تکراری ساخته نمی‌شود. (خواسته‌ی ۲)
 *
 * قفل: این فرم **هم** قفل «انتقال به انبار فروشگاه» را لازم دارد (پنجره‌ی
 * میزبان از قبل پشت همان `ManagerGate` است) **و هم** قفل «ساخت کالای جدید هنگام
 * انتقال از انبار مرکزی»، چون یک کالای تازه می‌سازد.
 *
 * ⚠️ جلسه ۵۵ · کار ۱ — کلید دوم عوض شد. تا جلسه ۵۴ این فرم پشت
 * `PANEL_KEYS.products` بود، پس انباردار برای ساخت کالای تازه باید رمز پنل
 * کالاها را می‌گرفت و در عمل حذف کالا/تغییر قیمت/ورود موجودی هم برایش باز
 * می‌شد. حالا کلید مستقل `PANEL_KEYS.secondaryToStoreNewProduct` **جای** آن را
 * گرفته و پنل کالاها دست‌نخورده و بسته می‌ماند.
 *
 * رمزها: سرور همان دو کلید را با `assertPanelPassword` می‌سنجد، پس رمز باید
 * *همراه همان درخواست* برود (الگوی جلسه ۵۲ · `StockSourceModal`). هر فیلد رمز
 * فقط وقتی نشان داده می‌شود که قفل همان کلید **روشن** باشد؛ و چون رمز مدیر هر
 * پنلی را باز می‌کند، فیلد دوم فقط برای «رمز دوم اختصاصی همین قفل» لازم است.
 * رمزها هیچ‌وقت ذخیره نمی‌شوند و با بسته شدن پنجره پاک می‌گردند.
 * ===========================================================================
 */

/** حداقل چیزی که فرم از ردیف انبار مرکزی لازم دارد. */
export interface NewStoreProductSeed {
  itemId: number
  /** نام ردیف انبار مرکزی — پیش‌فرض نام کالا */
  name: string
  /** کد ردیف انبار مرکزی — پیش‌فرض کد کالا (تکراری ⇒ سرور خودکار عوض می‌کند) */
  code: string
  qty: number
  note: string
  fromName: string
  available: number
}

type Mode = 'new' | 'variant'

/** یک کالای موجود برای حالت «افزودن واریانت». */
type ExistingProduct = { productId: number; name: string; sample: string }

const money = (n: number): string => faDigits(new Intl.NumberFormat('en-US').format(Math.round(n || 0)))

export default function NewStoreProductModal({
  seed,
  busy = false,
  onCancel,
  onConfirm
}: {
  /** null = بسته */
  seed: NewStoreProductSeed | null
  busy?: boolean
  onCancel: () => void
  onConfirm: (payload: SecondaryToStoreNewVariantInput) => void
}) {
  const open = !!seed
  /** جلسه ۵۵ — قفل مستقل «ساخت کالای جدید هنگام انتقال» (جای قفل پنل کالاها). */
  const newProductOpen = usePanelOpen(PANEL_KEYS.secondaryToStoreNewProduct)
  /** قفل روشن است؟ ⇒ سرور رمز می‌خواهد، پس فیلدش نشان داده می‌شود. */
  const { lockEnabled: toStoreLock, loaded: toStoreLoaded } = usePanelLock(PANEL_KEYS.secondaryToStore)
  const { lockEnabled: newProductLock, loaded: newProductLoaded } = usePanelLock(
    PANEL_KEYS.secondaryToStoreNewProduct
  )
  // fail-closed: تا سیاست قفل خوانده نشده، رمز *لازم* فرض می‌شود
  const needToStorePw = !toStoreLoaded || toStoreLock
  const needNewProductPw = !newProductLoaded || newProductLock

  const [mode, setMode] = useState<Mode>('new')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [categoryId, setCategoryId] = useState(0)
  const [salePrice, setSalePrice] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [cats, setCats] = useState<CategoryNode[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [prods, setProds] = useState<ExistingProduct[]>([])
  const [productId, setProductId] = useState(0)
  const [toStorePw, setToStorePw] = useState('')
  const [newProductPw, setNewProductPw] = useState('')

  /** باز شدن ⇒ نام و کد ردیف انبار مرکزی از قبل پر (خواسته‌ی ۲). */
  useEffect(() => {
    if (!seed) return
    setMode('new')
    setName(seed.name ?? '')
    setCode(seed.code ?? '')
    setColor('')
    setSize('')
    setCategoryId(0)
    setSalePrice('')
    setPurchasePrice('')
    setProductId(0)
    setProdSearch(seed.name ?? '')
  }, [seed?.itemId, seed?.name, seed?.code])

  /** بسته شدن ⇒ رمزها از حافظه پاک شوند (هیچ‌جا ذخیره نمی‌شوند). */
  useEffect(() => {
    if (!open) {
      setToStorePw('')
      setNewProductPw('')
    }
  }, [open])

  /** دسته‌های موجود (فقط انتخاب از موجودها — ساخت دسته کار پنل کالاهاست). */
  useEffect(() => {
    if (!open || !newProductOpen) return
    let alive = true
    call<CategoryNode[]>(CH.categoryTree)
      .then((list) => alive && setCats(list ?? []))
      .catch(() => alive && setCats([]))
    return () => {
      alive = false
    }
  }, [open, newProductOpen])

  /** کالاهای موجود برای حالت «واریانت تازه» (از همان `product:list`). */
  useEffect(() => {
    if (!open || mode !== 'variant' || !newProductOpen) return
    let alive = true
    call<any[]>(CH.productList, { search: prodSearch.trim() || undefined, take: 200 })
      .then((rows) => {
        if (!alive) return
        const byId = new Map<number, ExistingProduct>()
        for (const v of rows ?? []) {
          const pid = Number(v?.product?.id ?? v?.productId ?? 0)
          if (!pid || byId.has(pid)) continue
          const sample = [v?.size ?? '', v?.color ?? ''].filter((x: string) => String(x).trim()).join(' / ')
          byId.set(pid, { productId: pid, name: String(v?.product?.name ?? '—'), sample })
        }
        setProds([...byId.values()])
      })
      .catch(() => alive && setProds([]))
    return () => {
      alive = false
    }
  }, [open, mode, prodSearch, newProductOpen])

  /**
   * نشست ۱۴۹ · S147-a · S148-D3 — ارقام فارسی و جداکننده‌ی هزارگان پذیرفته می‌شوند؛ اعشار/منفی/حرف ⇒ null
   * و problem فارسی (قبلاً همه‌ی غیررقم‌ها حذف می‌شد و «1200000.5» ده‌برابر می‌شد، ارقام فارسی ⇒ ۰).
   */
  const sale = parseGroupedInteger(salePrice)
  const purchase = parseGroupedInteger(purchasePrice)
  const chosenProduct = useMemo(() => prods.find((p) => p.productId === productId) ?? null, [prods, productId])

  /**
   * جلسه ۵۵ · کار ۲ — «تعداد انتقال بیشتر از موجودی ردیف انبار مرکزی».
   *
   * قبلاً فرم این را نمی‌دید و درخواست می‌رفت سمت سرور؛ سرور هم `force` می‌خواست
   * و خطای «تیک تأیید…» را برمی‌گرداند — خطایی که در *این* فرم هیچ تیکی برای
   * پاسخ‌دادن نداشت، پس کاربر به بن‌بست می‌خورد. ساده‌ترین و صریح‌ترین کار
   * (همان چیزی که مالک خواست): همین‌جا جلویش گرفته شود با پیام روشن. `force`
   * از این فرم عمداً فرستاده نمی‌شود؛ تعداد باید در پنجره‌ی انتقال اصلاح شود.
   */
  const transferQty = Number(seed?.qty ?? 0) // S147-a — بدون گرد کردن
  const rowAvailable = Math.round(seed?.available ?? 0)
  const overAvailable = !!seed && transferQty > rowAvailable

  /** «قیمت فروش صفر یا خالی ⇒ فرم تأیید نشود» (نکته‌ی مالک). */
  const problems: string[] = []
  if (mode === 'new' && !name.trim()) problems.push('نام کالا را وارد کنید.')
  if (mode === 'variant' && !productId) problems.push('کالای موجود را انتخاب کنید.')
  if (sale === null) problems.push('قیمت فروش باید عدد صحیح به ریال باشد (اعشار، علامت منفی یا حرف پذیرفته نیست).')
  else if (sale <= 0) problems.push('قیمت فروش اجباری است و باید بزرگ‌تر از صفر باشد.')
  if (purchase === null) problems.push('قیمت خرید باید عدد صحیح به ریال باشد (اعشار، علامت منفی یا حرف پذیرفته نیست).')
  if (!!seed && (!Number.isSafeInteger(transferQty) || transferQty <= 0))
    problems.push(
      `تعداد انتقال (${faDigits(String(seed?.qty ?? ''))}) باید عدد صحیح بزرگ‌تر از صفر باشد؛ ` +
        'پنجره را ببندید و تعداد را در فرم انتقال اصلاح کنید.'
    )
  if (overAvailable)
    problems.push(
      `تعداد انتقال (${faDigits(transferQty)}) از موجودی همین ردیف انبار مرکزی (${faDigits(rowAvailable)}) ` +
        'بیشتر است. پنجره را ببندید، تعداد را در فرم انتقال کم کنید و دوباره «کالای جدید» را بزنید.'
    )
  if (needToStorePw && !toStorePw.trim()) problems.push('رمز قفل «انتقال به انبار فروشگاه» را وارد کنید.')
  const ready = newProductOpen && problems.length === 0 && !busy

  const submit = (): void => {
    if (!seed || !ready) return
    // تکیه‌گاه دوم کار ۲ — حتی اگر روزی دکمه از راه دیگری فعال شود، ثبت نمی‌رود
    if (overAvailable) return
    onConfirm({
      itemId: seed.itemId,
      qty: seed.qty, // S147-a — خام؛ سرور هم جدا می‌سنجد
      note: seed.note.trim() || null,
      productId: mode === 'variant' ? productId : null,
      name: mode === 'new' ? name.trim() : null,
      categoryId: mode === 'new' && categoryId > 0 ? categoryId : null,
      unit: 'عدد',
      size: size.trim() || null,
      color: color.trim() || null,
      salePrice: sale ?? 0,
      purchasePrice: purchase ?? 0,
      code: code.trim() || null,
      toStorePassword: toStorePw.trim() || null,
      newProductPassword: newProductPw.trim() || null
    })
  }

  return (
    <Modal
      open={open}
      title="ثبت کالای جدید در انبار فروشگاه (هنگام انتقال از انبار مرکزی)"
      onClose={onCancel}
      width="max-w-2xl"
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={!ready}
            title={problems[0] ?? undefined}
            onClick={submit}
          >
            {busy ? 'در حال ثبت…' : 'ثبت کالا و انتقال موجودی'}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy}>
            انصراف
          </button>
        </>
      }
    >
      {seed && (
        <ManagerGate
          panel={PANEL_KEYS.secondaryToStoreNewProduct}
          title="ساخت کالای جدید هنگام انتقال از انبار مرکزی"
          reason="این کار یک کالای تازه (با قیمت فروش) می‌سازد، پس علاوه بر قفل «انتقال به انبار فروشگاه»، قفل مستقل «ساخت کالای جدید هنگام انتقال» را هم لازم دارد. این رمز پنل «کالاها» را باز نمی‌کند."
          inline
        >
          <div className="space-y-2">
            <div className="rounded p-2 border-2 bg-sky-50 border-sky-300 leading-7">
              ردیف انبار مرکزی: <b>{seed.name}</b>
              {seed.code ? (
                <>
                  {' '}
                  · کد <b>{faDigits(seed.code)}</b>
                </>
              ) : null}{' '}
              · از <b>{seed.fromName}</b> · انتقال <b>{faDigits(transferQty)}</b> عدد · موجودی همین ردیف{' '}
              <b className={overAvailable ? 'text-red-700' : undefined}>{faDigits(rowAvailable)}</b>
              <div className="kbd">
                کالا با موجودی صفر ساخته می‌شود و بعد همین {faDigits(transferQty)} عدد به آن منتقل
                می‌گردد — هر دو در یک تراکنش. اگر هر خطایی پیش بیاید، هیچ کالایی ساخته نمی‌شود و هیچ موجودی‌ای
                جابه‌جا نمی‌شود.
              </div>
            </div>

            <label className="block">
              <div className="kbd">چه چیزی ساخته شود؟</div>
              <select className="inp" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="new">یک کالای کاملاً جدید</option>
                <option value="variant">واریانت تازه (سایز/رنگ دیگر) برای یک کالای موجود</option>
              </select>
              <div className="kbd leading-6">
                اگر همین کالا در فروشگاه هست و فقط سایز یا رنگش تازه است، حالت دوم را انتخاب کنید تا کالای تکراری
                ساخته نشود.
              </div>
            </label>

            {mode === 'new' ? (
              <>
                <label className="block">
                  <div className="kbd">نام کالا (اجباری)</div>
                  <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block">
                  <div className="kbd">دسته (از دسته‌های موجود)</div>
                  <select className="inp" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value) || 0)}>
                    <option value={0}>— بدون دسته —</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {'— '.repeat(c.depth)}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <div className="kbd">جست‌وجوی کالای موجود (نام، کد یا بارکد)</div>
                  <input className="inp" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} />
                </label>
                <label className="block">
                  <div className="kbd">کالای موجود (واریانت تازه به همین اضافه می‌شود)</div>
                  <select className="inp" value={productId} onChange={(e) => setProductId(Number(e.target.value) || 0)}>
                    <option value={0}>— انتخاب کنید —</option>
                    {prods.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.name}
                        {p.sample ? ` (نمونه: ${p.sample})` : ''}
                      </option>
                    ))}
                  </select>
                  {chosenProduct && (
                    <div className="kbd">
                      واحد و دسته‌ی «{chosenProduct.name}» دست نمی‌خورد؛ فقط یک واریانت با سایز/رنگ زیر اضافه
                      می‌شود.
                    </div>
                  )}
                </label>
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="kbd">رنگ (اختیاری)</div>
                <input className="inp" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="block">
                <div className="kbd">سایز (اختیاری)</div>
                <input className="inp" value={size} onChange={(e) => setSize(e.target.value)} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="kbd text-red-700">قیمت فروش (اجباری، بزرگ‌تر از صفر)</div>
                <input
                  className={`inp ${sale === null || sale <= 0 ? 'border-red-400' : ''}`}
                  inputMode="numeric"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                />
                <div className="kbd">{sale === null ? 'قیمت فروش باید عدد صحیح به ریال باشد.' : sale > 0 ? `${money(sale)} ریال` : 'بدون قیمت فروش، فرم ثبت نمی‌شود.'}</div>
              </label>
              <label className="block">
                <div className="kbd">قیمت خرید (اختیاری)</div>
                <input
                  className="inp"
                  inputMode="numeric"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
                <div className="kbd">{purchase === null ? 'قیمت خرید باید عدد صحیح به ریال باشد.' : purchase > 0 ? `${money(purchase)} ریال` : '—'}</div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="kbd">کد کالا</div>
                <input className="inp" value={code} onChange={(e) => setCode(e.target.value)} />
                <div className="kbd leading-6">
                  اگر این کد از قبل برای کالای دیگری ثبت شده باشد، خودکار یک کد آزاد جایش می‌نشیند و در پیام
                  موفقیت صریح گفته می‌شود چه کدی ثبت شد.
                </div>
              </label>
              <label className="block">
                <div className="kbd">واحد</div>
                <input className="inp bg-slate-100" value="عدد" disabled />
                <div className="kbd">بارکد خودکار و یکتا ساخته می‌شود (Code128).</div>
              </label>
            </div>

            {/* ------- دو قفل: انتقال به فروشگاه + ساخت کالای جدید هنگام انتقال ------- */}
            {(needToStorePw || needNewProductPw) && (
              <div className="rounded p-2 border-2 bg-amber-50 border-amber-300 space-y-2">
                <div className="kbd leading-6">
                  این کار دو قفل دارد: «انتقال به انبار فروشگاه» و «ساخت کالای جدید هنگام انتقال». سرور خودش هر دو
                  را می‌سنجد، پس رمز باید همراه همین ثبت برود. <b>رمز مدیر هر دو را باز می‌کند</b>؛ فیلد دوم را فقط
                  وقتی پر کنید که برای قفل «ساخت کالای جدید هنگام انتقال» <b>رمز دوم اختصاصی</b> تعریف کرده‌اید.
                  هیچ‌کدام از این دو رمز، پنل «کالاها» را باز نمی‌کند.
                </div>
                {needToStorePw && (
                  <label className="block">
                    <div className="kbd">رمز مدیر (یا رمز دوم پنل «انتقال به انبار فروشگاه»)</div>
                    <PasswordField value={toStorePw} onChange={(e) => setToStorePw(e.target.value)} />
                  </label>
                )}
                {needNewProductPw && (
                  <label className="block">
                    <div className="kbd">
                      رمز دوم قفل «ساخت کالای جدید هنگام انتقال» — فقط اگر اختصاصی دارد (وگرنه خالی بگذارید)
                    </div>
                    <PasswordField value={newProductPw} onChange={(e) => setNewProductPw(e.target.value)} />
                  </label>
                )}
              </div>
            )}

            {problems.length > 0 && (
              <div className="rounded p-2 border-2 bg-red-50 border-red-300 leading-7 text-red-800">
                {problems[0]}
              </div>
            )}
          </div>
        </ManagerGate>
      )}
    </Modal>
  )
}
