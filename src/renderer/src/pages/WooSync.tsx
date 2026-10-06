import { useEffect, useMemo, useState } from 'react'
import { call, CH } from '../lib/api'
import { faDigits } from '@shared/jalali'
import {
  WooResumeDecision,
  wooStatusLabel,
  type WooApprovalRow,
  type WooCatalogItem,
  type WooCatalogResult,
  type WooLinkRow,
  type WooResumePreview,
  type WooStatusView
} from '@shared/wooSync'

type VariantRow = {
  id: number
  code: string
  barcode: string
  stock: number
  size?: string | null
  color?: string | null
  product?: { name?: string | null }
}

const titleOf = (v: VariantRow) =>
  `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' · ' + v.color : ''} · کد ${v.code}`

export default function WooSync() {
  const [status, setStatus] = useState<WooStatusView | null>(null)
  const [links, setLinks] = useState<WooLinkRow[]>([])
  const [approvals, setApprovals] = useState<WooApprovalRow[]>([])
  const [catalog, setCatalog] = useState<WooCatalogItem[]>([])
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null)
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [search, setSearch] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  const [intervalSeconds, setIntervalSeconds] = useState(120)
  const [selectedVariantId, setSelectedVariantId] = useState<number | ''>('')
  const [selectedHolderKey, setSelectedHolderKey] = useState('')
  const [decision, setDecision] = useState<string>(WooResumeDecision.MAHAK_WINS)
  const [resumePreview, setResumePreview] = useState<WooResumePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const selectedCatalog = useMemo(() => catalog.find((x) => x.holderKey === selectedHolderKey) ?? null, [catalog, selectedHolderKey])

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
  }
  const fail = (e: any) => {
    setErr(String(e?.message ?? e))
    setMsg(null)
  }

  const askManagerPassword = (reason: string): string | null => {
    const pass = window.prompt(`${reason}
رمز مدیر را وارد کنید:`)
    if (pass == null) return null
    if (!pass.trim()) {
      setErr('برای این تصمیم، رمز مدیر لازم است.')
      setMsg(null)
      return null
    }
    return pass
  }

  // Mutationهای لینک باید شمارنده‌ها و صف تأیید را هم تازه کنند؛ load() کامل فرم تنظیمات را بازنویسی می‌کند، پس فقط پنل تازه می‌شود.
  const refreshPanel = async (rows?: WooLinkRow[]) => {
    const [s, a] = await Promise.all([call<WooStatusView>(CH.wooStatus), call<WooApprovalRow[]>(CH.wooApprovals)])
    setStatus(s)
    if (rows) setLinks(rows)
    setApprovals(a)
  }

  const load = async () => {
    const [s, l, a] = await Promise.all([call<WooStatusView>(CH.wooStatus), call<WooLinkRow[]>(CH.wooLinks), call<WooApprovalRow[]>(CH.wooApprovals)])
    setStatus(s)
    setLinks(l)
    setApprovals(a)
    setSiteUrl(s.config.siteUrl)
    setEnabled(s.config.enabled)
    setAutoSync(s.config.autoSync)
    setIntervalSeconds(s.config.intervalSeconds)
  }

  useEffect(() => {
    void load().catch(fail)
  }, [])

  const loadCatalog = async () => {
    setBusy(true)
    try {
      const [c, v] = await Promise.all([
        call<WooCatalogResult>(CH.wooCatalog, { search, limit: 100 }),
        call<VariantRow[]>(CH.productList, { search, take: 100 })
      ])
      const legacyArray = Array.isArray(c as any)
      const items = legacyArray ? (c as any as WooCatalogItem[]) : (Array.isArray(c.items) ? c.items : [])
      setCatalog(items)
      setCatalogNotice(legacyArray ? null : (c.message ?? null))
      setVariants(v)
      flash(`کاتالوگ سایت خوانده شد: ${faDigits(items.length)} مورد${!legacyArray && c.capped ? ' (فهرست کامل نیست)' : ''}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async () => {
    setBusy(true)
    try {
      const s = await call<WooStatusView>(CH.wooSettingsSave, { siteUrl, token, enabled, autoSync, intervalSeconds })
      setStatus(s)
      // مقدار clamp/نرمال‌شده‌ی سرور باید در فرم هم دیده شود (مثل interval کمتر از ۳۰ ثانیه یا آدرس نرمال‌شده).
      setSiteUrl(s.config.siteUrl)
      setEnabled(s.config.enabled)
      setAutoSync(s.config.autoSync)
      setIntervalSeconds(s.config.intervalSeconds)
      setToken('')
      flash('تنظیمات ذخیره شد. اگر کلید جدید وارد کرده بودید، به‌صورت امن در همین دستگاه ذخیره شد.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const r = await call<any>(CH.wooTest)
      flash(`اتصال برقرار است. افزونه: ${r.plugin ?? 'نامشخص'}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const createLink = async () => {
    if (!selectedVariantId || !selectedCatalog) return setErr('یک کالای فروشگاه و یک محصول سایت انتخاب کنید.')
    if (selectedCatalog.stockQuantity == null) return setErr('این محصول سایت موجودی مستقل عددی ندارد؛ اتصال امن نیست.')
    const managerPassword = decision === WooResumeDecision.VERIFY_ONLY ? null : askManagerPassword('اتصال اولیه با انتخاب مرجع موجودی')
    if (decision !== WooResumeDecision.VERIFY_ONLY && managerPassword == null) return
    setBusy(true)
    try {
      await call(CH.wooLinkCreate, {
        variantId: selectedVariantId,
        productId: selectedCatalog.productId,
        variationId: selectedCatalog.variationId,
        holderKey: selectedCatalog.holderKey,
        sku: selectedCatalog.sku,
        remoteName: selectedCatalog.name,
        manageStock: selectedCatalog.manageStock,
        wooQty: selectedCatalog.stockQuantity,
        decision,
        managerPassword
      })
      await load()
      flash('اتصال کالا ثبت شد. از این به بعد فقط عدد موجودی بین فروشگاه و سایت همگام می‌شود.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setBusy(true)
    try {
      const r = await call<any>(CH.wooSyncNow)
      if (r?.status) setStatus(r.status)
      await load()
      // پاسخ موفق IPC به معنی موفقیت عملیات نیست: حالت busy و خطاهای مرحله‌ای باید صادقانه نمایش داده شوند.
      if (r?.busy === true) {
        flash('همگام‌سازی دیگری در حال اجراست؛ این درخواست اجرا نشد. چند لحظه بعد دوباره بزنید.')
        return
      }
      const errs = Array.isArray(r?.errors) ? r.errors : []
      if (errs.length) {
        setMsg(null)
        setErr(`بخشی از همگام‌سازی کامل نشد: ${errs.map((x: any) => `${x.phase}: ${x.message}`).join(' | ')}`)
        return
      }
      flash(`همگام‌سازی انجام شد. ورودی: ${faDigits(r.pulled.applied)} اعمال، خروجی: ${faDigits(r.pushed.sent)} ارسال. رویدادهای پارک‌شده فقط با دکمه جداگانه و بررسی مدیر پردازش می‌شوند.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const retryParked = async () => {
    const managerPassword = askManagerPassword('پردازش دستی رویدادهای پارک‌شده سایت')
    if (managerPassword == null) return
    setBusy(true)
    try {
      const r = await call<any>(CH.wooParkedRetry, { managerPassword })
      await load()
      flash(`رویدادهای پارک‌شده بررسی شد: ${faDigits(r.applied ?? 0)} اعمال، ${faDigits(r.skipped ?? 0)} رد/نیازمند بررسی، ${faDigits(r.failed ?? 0)} خطا`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const pause = async (id: number) => {
    setBusy(true)
    try {
      const rows = await call<WooLinkRow[]>(CH.wooLinksPause, { linkIds: [id], note: 'قطع دستی از پنل همگام‌سازی' })
      await refreshPanel(rows)
      flash('اتصال موقتاً قطع شد؛ خود قطع موجودی را تغییر نمی‌دهد، اما ارسال‌هایی که قبل از قطع در حال اجرا بودند ممکن است تکمیل شوند و نتیجه‌شان ثبت می‌شود.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const previewResume = async (id: number) => {
    setBusy(true)
    try {
      const p = await call<WooResumePreview>(CH.wooLinksResumePreview, { linkId: id })
      setResumePreview(p)
      flash('پیش‌نمایش وصل دوباره آماده است؛ قبل از اعمال، اختلاف‌ها را بررسی کنید.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const applyResumeDecision = async (decision: string) => {
    if (!resumePreview) return
    const managerPassword = askManagerPassword('وصل دوباره/حل اختلاف موجودی سایت')
    if (managerPassword == null) return
    setBusy(true)
    try {
      await call(CH.wooLinksResumeApply, {
        linkId: resumePreview.linkId,
        decision,
        managerPassword,
        expectedMahakStock: resumePreview.mahakStock,
        expectedWooQty: resumePreview.wooQty,
        expectedLastSeq: resumePreview.lastSeq,
        expectedPausedEventCount: resumePreview.pausedEvents.length,
        expectedPausedEventHash: resumePreview.heldEventHash
      })
      setResumePreview(null)
      await load()
      flash(decision === WooResumeDecision.VERIFY_ONLY ? 'فقط بررسی تأیید شد؛ لینک با همین مبنا فعال شد و هیچ موجودی جابه‌جا نشد.' : 'اتصال دوباره با تصمیم انتخاب‌شده ثبت شد؛ اگر نیاز به نوشتن سایت باشد، بعد از ارسال موفق فعال می‌شود.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (id: number) => {
    if (!confirm('اتصال این کالا به سایت قطع دائم شود؟ موجودی هیچ طرفی تغییر نمی‌کند.')) return
    const managerPassword = askManagerPassword('قطع دائم اتصال موجودی سایت')
    if (managerPassword == null) return
    setBusy(true)
    try {
      const rows = await call<WooLinkRow[]>(CH.wooLinksUnlink, { linkId: id, managerPassword })
      await refreshPanel(rows)
      flash('اتصال دائم حذف شد؛ سابقه‌ی قبلی در لاگ‌ها باقی می‌ماند.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const resolveApproval = async (approvalId: number, decision: string) => {
    const managerPassword = askManagerPassword('تصمیم صف تأیید موجودی سایت')
    if (managerPassword == null) return
    setBusy(true)
    try {
      const r = await call<any>(CH.wooApprovalResolve, { approvalId, decision, managerPassword })
      if (r?.approvals) setApprovals(r.approvals)
      if (r?.links) setLinks(r.links)
      if (r?.status) setStatus(r.status)
      await load()
      flash('درخواست تأیید تعیین تکلیف شد.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const pauseProductGroup = async (id: number) => {
    if (!confirm('همه رنگ/سایزهای متصل همین محصول موقتاً قطع شوند؟ موجودی هیچ طرفی تغییر نمی‌کند.')) return
    setBusy(true)
    try {
      const rows = await call<WooLinkRow[]>(CH.wooLinksPauseProduct, { linkId: id, note: 'قطع گروهی از پنل Woo' })
      await refreshPanel(rows)
      flash('اتصال‌های گروه محصول موقتاً قطع شدند.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const resumeProductGroupMahak = async (id: number) => {
    const managerPassword = askManagerPassword('وصل گروهی رنگ/سایزهای محصول با مرجع MAHAK')
    if (managerPassword == null) return
    setBusy(true)
    try {
      const res = await call<any>(CH.wooLinksResumeProductMahak, { linkId: id, managerPassword })
      await load()
      const queued = Number(res?.queued ?? 0)
      const skipped = Number(res?.skipped ?? 0)
      const skippedLinks = Array.isArray(res?.skippedLinks) ? res.skippedLinks : []
      const detail = skippedLinks.slice(0, 3).map((x: any) => `#${x.linkId}: ${x.reason}`).join('، ')
      flash(skipped > 0 ? `برای گروه محصول، ${queued} اتصال صف شد و ${skipped} اتصال رد شد${detail ? ` (${detail})` : ''}.` : 'برای گروه محصول، ارسال موجودی MAHAK به سایت صف شد؛ بعد از ارسال موفق لینک‌ها فعال می‌شوند.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">همگام‌سازی موجودی سایت</h1>
            <p className="text-sm text-slate-600 mt-1">
              این ماژول فقط موجودی انبار فروشگاه و stock_quantity ووکامرس را هماهنگ می‌کند؛ قیمت، سفارش، مشتری و گزارش فروش سایت وارد برنامه نمی‌شود.
            </p>
          </div>
          <div className="flex gap-2"><button className="btn" disabled={busy || !(status?.counts.parkedEvents)} onClick={retryParked}>پردازش پارک‌شده‌ها</button><button className="btn btn-primary" disabled={busy} onClick={syncNow}>همگام‌سازی الآن</button></div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm leading-7">
          نسخه فعلی فقط همگام‌سازی عدد موجودی است. رویدادهای خطادار به‌جای گم‌شدن «پارک» می‌شوند؛ این رویدادها دیگر خودکار اعمال نمی‌شوند و پردازش دستی آن‌ها رمز مدیر می‌خواهد. صف تأیید مدیر WooApproval/HOLD/FROZEN فعال است؛ موارد مبهم، حلقه تکراری یا اختلاف دوره‌ای تا تصمیم مدیر موجودی را کورکورانه جابه‌جا نمی‌کنند.
        </div>
        {msg && <div className="rounded border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-2 text-sm">{msg}</div>}
        {err && <div className="rounded border border-rose-300 bg-rose-50 text-rose-800 px-3 py-2 text-sm whitespace-pre-wrap">{err}</div>}
        <div className="grid grid-cols-2 md:grid-cols-8 gap-2 text-sm">
          <div className="kbd">متصل: {faDigits(status?.counts.activeLinks ?? 0)}</div>
          <div className="kbd">قطع موقت: {faDigits(status?.counts.pausedLinks ?? 0)}</div>
          <div className="kbd">اختلاف: {faDigits(status?.counts.conflictLinks ?? 0)}</div>
          <div className="kbd">صف ارسال: {faDigits(status?.counts.pendingOutbox ?? 0)}</div>
          <div className="kbd">خطا: {faDigits(status?.counts.failedOutbox ?? 0)}</div>
          <div className="kbd">پارک‌شده: {faDigits(status?.counts.parkedEvents ?? 0)}</div>
          <div className="kbd">تأیید مدیر: {faDigits(status?.counts.pendingApprovals ?? 0)}</div>
          <div className="kbd">Cursor: {faDigits(status?.config.lastCursor ?? 0)}</div>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-bold">۱) تنظیم اتصال افزونه</h2>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <label className="space-y-1 md:col-span-2"><span className="text-sm">آدرس سایت</span><input className="input" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" /></label>
          <label className="space-y-1"><span className="text-sm">کلید افزونه</span><input className="input" type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status?.config.hasSecret ? 'ذخیره شده؛ برای تغییر وارد کنید' : 'از تنظیمات افزونه'} /></label>
          <label className="space-y-1"><span className="text-sm">فاصله خودکار (ثانیه)</span><input className="input" type="number" value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> اتصال فعال باشد</label>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} /> همگام‌سازی خودکار</label>
          <button className="btn" disabled={busy} onClick={saveSettings}>ذخیره تنظیمات</button>
          <button className="btn" disabled={busy} onClick={test}>تست اتصال</button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-bold">۲) اتصال کالاها/Variationها</h2>
        <div className="flex gap-2 items-end">
          <label className="space-y-1 flex-1"><span className="text-sm">جست‌وجو در سایت و کالاهای فروشگاه</span><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، SKU، کد یا بارکد" /></label>
          <button className="btn" disabled={busy} onClick={loadCatalog}>خواندن کاتالوگ</button>
        </div>
        {catalogNotice && <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">{catalogNotice}</div>}
        <div className="grid md:grid-cols-2 gap-3">
          <label className="space-y-1"><span className="text-sm">کالای فروشگاه</span><select className="input" value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{variants.map((v) => <option key={v.id} value={v.id}>{titleOf(v)} · موجودی {faDigits(v.stock)}</option>)}</select></label>
          <label className="space-y-1"><span className="text-sm">محصول/Variation سایت</span><select className="input" value={selectedHolderKey} onChange={(e) => setSelectedHolderKey(e.target.value)}><option value="">انتخاب کنید…</option>{catalog.map((c) => <option key={c.holderKey} value={c.holderKey}>{c.name} · SKU {c.sku || '—'} · موجودی {c.stockQuantity == null ? '—' : faDigits(c.stockQuantity)} {c.manageStock ? '' : c.manageStockMode === 'parent' ? '· موجودی مشترک والد (قابل اتصال نیست)' : c.manageStockMode === 'fractional_unsupported' ? '· موجودی اعشاری پشتیبانی نمی‌شود' : '· manage_stock خاموش'}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm">مبنای اتصال اولیه:</label>
          <select className="input w-auto" value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value={WooResumeDecision.MAHAK_WINS}>فروشگاه مرجع است؛ سایت به عدد فروشگاه برسد</option>
            <option value={WooResumeDecision.WOO_WINS}>سایت مرجع است؛ موجودی فروشگاه به عدد سایت برسد</option>
            <option value={WooResumeDecision.VERIFY_ONLY}>فقط اتصال اگر عددها را بررسی کرده‌ام</option>
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={createLink}>ثبت اتصال</button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-bold">۳) صف تأیید مدیر موجودی سایت</h2>
        <p className="text-sm text-slate-600">اینجا فقط تصمیم‌های مربوط به عدد موجودی دیده می‌شود؛ هیچ سفارش، مشتری یا مبلغ سایت وارد برنامه نمی‌شود.</p>
        <div className="space-y-2">
          {approvals.map((a) => (
            <div key={a.id} className="rounded border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-bold">{a.title}</div><div className="text-slate-700">{a.message}</div><div className="text-xs text-slate-500">{a.reason} · {a.holderKey || 'بدون کلید'} · {a.createdAt}</div></div>
                <span className="kbd">{a.action}</span>
              </div>
              {a.payload ? <pre className="text-xs bg-white/70 rounded p-2 overflow-auto max-h-24">{JSON.stringify(a.payload, null, 2)}</pre> : null}
              <div className="flex flex-wrap gap-2">
                {a.action === 'APPLY_INBOUND' ? <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => resolveApproval(a.id, 'APPLY_INBOUND')}>اعمال روی MAHAK</button> : null}
                {a.action !== 'APPLY_INBOUND' ? <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => resolveApproval(a.id, WooResumeDecision.MAHAK_WINS)}>MAHAK مرجع؛ ارسال به سایت</button> : null}
                {a.action !== 'APPLY_INBOUND' ? <button className="btn btn-xs" disabled={busy} onClick={() => resolveApproval(a.id, WooResumeDecision.WOO_WINS)}>سایت مرجع؛ اعمال روی MAHAK</button> : null}
                {a.action !== 'APPLY_INBOUND' ? <button className="btn btn-xs" disabled={busy} onClick={() => resolveApproval(a.id, 'UNFREEZE')}>فعال‌سازی اگر برابر است</button> : null}
                <button className="btn btn-xs" disabled={busy} onClick={() => resolveApproval(a.id, 'REJECT')}>رد/نگه‌داشتن بدون تغییر</button>
              </div>
            </div>
          ))}
          {!approvals.length && <div className="text-sm text-slate-500">درخواستی در صف تأیید مدیر نیست.</div>}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-bold">۴) اتصال‌های فعال</h2>
        <div className="overflow-auto">
          <table className="table text-sm min-w-[900px]">
            <thead><tr><th>کالای فروشگاه</th><th>سایت</th><th>وضعیت</th><th>موجودی فروشگاه</th><th>آخرین موجودی سایت</th><th>صف/خطا</th><th>عملیات</th></tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{l.productName}<div className="text-xs text-slate-500">کد {l.code} · بارکد {l.barcode}</div></td>
                  <td>{l.remoteName || l.holderKey}<div className="text-xs text-slate-500">{l.sku || 'SKU ندارد'} · {l.holderKey}</div></td>
                  <td><span className="kbd">{wooStatusLabel(l.status)}</span>{l.pausedEvents ? <div className="text-xs text-amber-700">{faDigits(l.pausedEvents)} رویداد حل‌نشده سایت</div> : null}</td>
                  <td>{faDigits(l.mahakStock)}</td>
                  <td>{faDigits(l.lastWooQty)}</td>
                  <td>{faDigits(l.pendingOutbox)} / {faDigits(l.failedOutbox)}</td>
                  <td className="space-x-1 space-x-reverse whitespace-nowrap">
                    {l.status === 'ACTIVE' ? <button className="btn btn-xs" disabled={busy} onClick={() => pause(l.id)}>قطع موقت</button> : null}
                    {l.status === 'ACTIVE' ? <button className="btn btn-xs" disabled={busy} onClick={() => pauseProductGroup(l.id)}>قطع گروه</button> : null}
                    {l.status === 'PAUSED' ? <button className="btn btn-xs" disabled={busy} onClick={() => previewResume(l.id)}>پیش‌نمایش وصل</button> : null}
                    {l.status === 'CONFLICT' ? <button className="btn btn-xs" disabled={busy} onClick={() => previewResume(l.id)}>حل اختلاف</button> : null}
                    {l.status === 'BROKEN_REMOTE' || l.status === 'FROZEN' ? <button className="btn btn-xs" disabled={busy} onClick={() => previewResume(l.id)}>بررسی سایت</button> : null}
                    {['PAUSED','CONFLICT'].includes(String(l.status)) ? <button className="btn btn-xs" disabled={busy} onClick={() => resumeProductGroupMahak(l.id)}>وصل گروه با MAHAK</button> : null}
                    <button className="btn btn-xs" disabled={busy} onClick={() => unlink(l.id)}>قطع دائم</button>
                  </td>
                </tr>
              ))}
              {!links.length && <tr><td colSpan={7} className="text-center text-slate-500 py-6">هنوز کالایی به سایت وصل نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {resumePreview && (
        <div className="card p-4 space-y-3 border-amber-300 bg-amber-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">پیش‌نمایش وصل دوباره</h2>
              <p className="text-sm text-slate-700 mt-1">لینک {resumePreview.holderKey}: موجودی MAHAK {faDigits(resumePreview.mahakStock)}، موجودی سایت {faDigits(resumePreview.wooQty)}</p>
            </div>
            <button className="btn btn-xs" onClick={() => setResumePreview(null)}>بستن</button>
          </div>
          <div className="grid md:grid-cols-4 gap-2 text-sm">
            <div className="kbd">رویدادهای حل‌نشده سایت: {faDigits(resumePreview.pausedEvents.length)}</div>
            <div className="kbd">سفارش‌های قابل اعمال: {faDigits(resumePreview.orderEvents)} / تغییر {faDigits(resumePreview.orderDelta)}</div>
            <div className="kbd">ویرایش‌های سایت که اعمال نمی‌شوند: {faDigits(resumePreview.nonOrderEvents)} / تغییر {faDigits(resumePreview.nonOrderDelta)}</div>
            <div className="kbd">آخرین seq سایت: {faDigits(resumePreview.lastSeq ?? 0)}</div>
          </div>
          <p className="text-xs text-amber-900">گزینه «فروشگاه + سفارش‌های سایت» فقط رویدادهایی را اعمال می‌کند که افزونه با source=order ثبت کرده باشد؛ ویرایش دستی ادمین سایت در همین Reconcile کنار گذاشته می‌شود و هیچ‌وقت خودکار روی MAHAK نمی‌نشیند.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || resumePreview.orderEvents > 0} onClick={() => applyResumeDecision(WooResumeDecision.MAHAK_WINS)}>فروشگاه مرجع؛ سایت به MAHAK برسد</button>
            <button className="btn" disabled={busy} onClick={() => applyResumeDecision(WooResumeDecision.WOO_WINS)}>سایت مرجع؛ MAHAK به سایت برسد</button>
            <button className="btn" disabled={busy || resumePreview.orderEvents === 0} onClick={() => applyResumeDecision(WooResumeDecision.MAHAK_PLUS_ORDERS)}>MAHAK + سفارش‌های سایت زمان قطع</button>
            <button className="btn" disabled={busy || resumePreview.pausedEvents.length > 0 || Math.max(0, Math.round(Number(resumePreview.mahakStock) || 0)) !== Math.max(0, Math.round(Number(resumePreview.wooQty) || 0))} onClick={() => applyResumeDecision(WooResumeDecision.VERIFY_ONLY)}>فقط بررسی؛ فعال کن بدون تغییر موجودی</button>
          </div>
        </div>
      )}

      <div className="card p-4 space-y-2 text-sm text-slate-700 leading-7">
        <h2 className="font-bold text-slate-900">نصب افزونه وردپرس</h2>
        <p>فایل افزونه تحویلی در پروژه: <code>resources/woocommerce/mahak-stock-sync.php</code>. آن را داخل وردپرس نصب/فعال کنید، از منوی «محک موجودی» یک کلید بسازید، همان کلید را اینجا وارد کنید. افزونه فقط موجودی را می‌خواند/می‌نویسد و هیچ قیمت یا اطلاعات مشتری را به برنامه نمی‌دهد.</p>
      </div>
    </div>
  )
}
