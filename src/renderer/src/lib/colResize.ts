/**
 * ===========================================================================
 * مورد ۳ — «تغییر عرض ستون‌ها مثل اکسل» در **صد‌درصد** جدول‌های برنامه.
 *
 * ── چرا این فایل، و چرا به هر جدول دست نزدیم؟ ──────────────────────────────
 * الگوی قبلی (`components/ResizableColumns.tsx`) یک هوک React است و برای هر
 * جدول باید سه چیز دستی اضافه شود: `useResizableColumns(...)`، `<ColGroup/>` و
 * `<ResizableHeaderCells/>`. در برنامه حدود ۴۰ جدول دیگر مانده بود (تنظیمات،
 * برگشت از فروش، انبار مرکزی، تجمیع، بستن صندوق، فاکتور خرید، مودال‌ها و …).
 * دست‌کاری تک‌تکِ آن‌ها یعنی ۴۰ نقطه‌ی جدید برای اشتباه (شماره‌ی ستون‌های شرطی،
 * `colSpan`ها، سرستون‌های دوردیفه) و باز هم هیچ تضمینی برای «جدول بعدی» که فردا
 * اضافه می‌شود وجود نداشت.
 *
 * پس دقیقاً همان کاری را کردیم که خودِ این برنامه قبلاً برای *ارتفاع ردیف‌ها*
 * کرده بود (`lib/rowResize.ts`): یک بار در `main.tsx` فعال می‌شود و از آن لحظه
 * روی **هر `<table class="tbl">`** برنامه کار می‌کند — بدون تغییر حتی یک خط در
 * صفحه‌ها. ظاهر، کلاس‌ها (`tbl-fixed`)، کف عرض، مخزن ذخیره‌سازی و رفتار
 * دوبار‌کلیک، همه عیناً همان الگوی موجود است؛ فقط جای وصل‌شدنش از React به DOM
 * عوض شده.
 *
 * ⚠️ جدول‌هایی که *از قبل* هوک React را دارند (گزارشات فروش، جدول اقلام پنل
 * فروش) به‌طور خودکار نادیده گرفته می‌شوند: آن‌ها دستگیره‌ی خودشان
 * (`span.col-grip`) را دارند و نباید دو منطق روی یک جدول بنشیند.
 *
 * ── طرز استفاده برای کاربر ─────────────────────────────────────────────────
 *   • نشانگر را روی مرز دو سرستون بگذارید (به ↔ عوض می‌شود) و بکشید.
 *   • دوبار کلیک روی همان مرز = همان ستون به عرض خودکار برمی‌گردد.
 *   • Shift + دوبار کلیک = کل جدول به چیدمان اولِ خودکار برمی‌گردد.
 *   • عرض‌ها در همان مخزن همیشگی ذخیره می‌شوند، پس بعد از بستن و باز کردن
 *     برنامه سر جایشان هستند.
 * ===========================================================================
 */

/** فاصله‌ی حساسیت از مرز ستون (پیکسل) */
const GRIP = 6
/** کف عرض یک ستون — همان عددی که هوک React استفاده می‌کند */
const MIN_W = 28
const PREFIX = 'tblcols:auto:'

let drag: { table: HTMLTableElement; key: string; index: number; startX: number; base: number[] } | null = null
/** جلوگیری از حلقه‌ی بی‌پایان: تغییرهای خودِ ما نباید دوباره اسکن راه بیندازند */
let applying = false

// ---------------------------------------------------------------------------
// کلید ذخیره‌سازی هر جدول
// ---------------------------------------------------------------------------

/** سرستون‌های ردیف اول یک جدول (مبنای شناسایی و مبنای اندازه‌گیری). */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const row = table.querySelector<HTMLTableRowElement>('thead tr')
  if (!row) return []
  return Array.from(row.children).filter(
    (c) => c.tagName === 'TH' || c.tagName === 'TD'
  ) as HTMLTableCellElement[]
}

/**
 * یک نام یکتا و *پایدار* برای هر جدول: مسیر صفحه + متن سرستون‌ها + تعدادشان.
 *
 * چرا متن سرستون‌ها و نه شماره‌ی جدول در صفحه؟ چون بخش‌های صفحه شرطی‌اند
 * (تب‌ها، آکاردئون‌ها) و شماره‌ی جدول با باز و بسته شدن آن‌ها جابه‌جا می‌شود؛
 * متن سرستون‌ها جابه‌جا نمی‌شود. اگر ستونی به جدولی اضافه شود، کلید عوض
 * می‌شود و جدول با چیدمان خودکار شروع می‌کند — همان رفتار محافظه‌کارانه‌ی هوک
 * React (چیدمان با تعداد ستون ناهمخوان، معتبر نیست).
 */
function keyOf(table: HTMLTableElement): string | null {
  const cells = headerCells(table)
  if (cells.length < 2) return null
  const route = (window.location.hash || '#/').split('?')[0]
  const titles = cells.map((c) => (c.textContent ?? '').trim().slice(0, 24)).join('~')
  return `${route}|${titles}|${cells.length}`
}

/** جدولی که هوک React خودش مدیریتش می‌کند (دستگیره‌ی مخصوص دارد). */
const isHookManaged = (table: HTMLTableElement): boolean => !!table.querySelector('thead .col-grip')

// ---------------------------------------------------------------------------
// API برای دکمه‌ی «↺ برگشت به پیش‌فرض» (tableLayoutFab.ts)
// ---------------------------------------------------------------------------

/** خروجی عمومیِ همان تشخیص داخلی — برای اینکه منطق فاب دوباره‌نویسی نشود. */
export const isHookManagedTable = isHookManaged

/**
 * آیا برای این جدول چیدمان ستونیِ دستی فعال است؟ — یا ذخیره‌شده (ماندگار بعد
 * از راه‌اندازی دوباره) یا همین حالا روی صفحه نشسته است (`data-colw`).
 */
export function tableColsCustomized(table: HTMLTableElement): boolean {
  if (table.hasAttribute('data-colw')) return true
  const key = keyOf(table)
  return !!key && loadWidths(key, headerCells(table).length) != null
}

/** حذف کامل چیدمان ستونی این جدول — از مخزن و از روی صفحه (برگشت به خودکار). */
export function resetTableCols(table: HTMLTableElement): void {
  const key = keyOf(table)
  if (key) saveWidths(key, null)
  applyWidths(table, null)
}

// ---------------------------------------------------------------------------
// خواندن و نوشتن چیدمان
// ---------------------------------------------------------------------------

function loadWidths(key: string, count: number): number[] | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== count) return null
    const widths = parsed.map((w: unknown) => Math.max(MIN_W, Math.round(Number(w) || MIN_W)))
    return widths.every((w) => Number.isFinite(w)) ? widths : null
  } catch {
    return null
  }
}

function saveWidths(key: string, widths: number[] | null): void {
  try {
    if (!widths) window.localStorage.removeItem(PREFIX + key)
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(widths))
  } catch {
    /* ذخیره نشد ⇒ فقط یادش نمی‌ماند؛ کشیدن ستون همین حالا کار می‌کند */
  }
}

/** عرض واقعی سرستون‌ها در همین لحظه (مبنای شروع کشیدن). */
function measure(table: HTMLTableElement): number[] {
  return headerCells(table).map((c) => Math.max(MIN_W, Math.round(c.getBoundingClientRect().width)))
}

/**
 * اعمال عرض‌ها روی جدول.
 *
 * عرض روی *خودِ سرستون* به‌صورت inline نوشته می‌شود (نه با ساختن `<colgroup>`)
 * تا هیچ عنصر بیگانه‌ای داخل جدولی که React مدیریتش می‌کند تزریق نشود؛
 * `table-layout: fixed` (کلاس موجود `tbl-fixed`) باعث می‌شود بدنه‌ی جدول از
 * همان عرض‌ها تبعیت کند.
 */
function applyWidths(table: HTMLTableElement, widths: number[] | null): void {
  applying = true
  try {
    const cells = headerCells(table)
    if (!widths) {
      table.classList.remove('tbl-fixed')
      table.removeAttribute('data-colw')
      table.style.removeProperty('width')
      for (const c of cells) c.style.removeProperty('width')
      return
    }
    table.classList.add('tbl-fixed')
    table.setAttribute('data-colw', '1')
    /**
     * ⚠️ ریشه‌ی باگ «یهو بزرگ/کوچک می‌شود و از کنترل خارج می‌شود»: کلاس `tbl`
     * جدول را `w-full` (عرض ۱۰۰٪) نگه می‌دارد. با `table-layout: fixed`، وقتی
     * جمع عرض ستون‌ها با عرض جدول برابر نباشد مرورگر **همه‌ی ستون‌ها را به‌نسبت
     * بازتوزیع می‌کند** تا جدول ۱۰۰٪ پر شود — یعنی ستونی که می‌کشیدی آن عدد
     * پیکسلی را نمی‌گرفت و بقیه‌ی ستون‌ها همزمان جابه‌جا می‌شدند. قفل کردن عرض
     * کل جدول روی جمع پیکسلیِ ستون‌ها باعث می‌شود هر ستون دقیقاً همان عددی شود
     * که کاربر کشیده و کشیدن ۱:۱ با ماوس بماند (اگر جمع از صفحه بزرگ‌تر شود،
     * همین جدول با اسکرول افقی داخل wrapper خودش دیده می‌شود — رفتار اکسل).
     */
    let sum = 0
    cells.forEach((c, i) => {
      const w = widths[i]
      if (w != null) {
        const px = Math.max(MIN_W, Math.round(w))
        c.style.width = `${px}px`
        sum += px
      }
    })
    if (sum > 0) table.style.width = `${sum}px`
  } finally {
    applying = false
  }
}

// ---------------------------------------------------------------------------
// تشخیص «نشانگر روی مرز ستون است»
// ---------------------------------------------------------------------------

/**
 * جدول و شماره‌ی ستونی که مرزش زیر نشانگر است (یا null).
 *
 * جدول راست‌به‌چپ است و — دقیقاً مثل الگوی موجود — دستگیره روی **لبه‌ی چپ** هر
 * سرستون می‌نشیند؛ پس کشیدن به سمت چپ، همان ستون را بزرگ‌تر می‌کند. لبه‌ی چپِ
 * آخرین ستون (چپ‌ترین ستون جدول) هم پذیرفته می‌شود.
 */
function edgeAt(target: Element | null, clientX: number, clientY: number):
  | { table: HTMLTableElement; index: number }
  | null {
  const cell = target?.closest?.('th, td') as HTMLTableCellElement | null
  if (!cell) return null
  const table = cell.closest('table.tbl') as HTMLTableElement | null
  if (!table || isHookManaged(table)) return null
  // فقط از روی سرستون‌ها: کشیدن از داخل بدنه، انتخاب متن و کلیک ردیف را خراب می‌کند
  if (!cell.closest('thead')) return null

  const cells = headerCells(table)
  if (cells.length < 2) return null
  for (let i = 0; i < cells.length; i++) {
    const r = cells[i].getBoundingClientRect()
    if (clientY < r.top || clientY > r.bottom) continue
    if (Math.abs(clientX - r.left) <= GRIP) return { table, index: i }
  }
  return null
}

// ---------------------------------------------------------------------------
// بازگرداندن چیدمان ذخیره‌شده هنگام رندر صفحه‌ها
// ---------------------------------------------------------------------------

let scanQueued = false

/**
 * هر جدولی که روی صفحه هست و چیدمان ذخیره‌شده دارد، چیدمانش برگردانده می‌شود.
 * با هر رندر React (تغییر تب، باز شدن مودال، آمدن داده) یک بار اجرا می‌شود.
 */
function scan(): void {
  scanQueued = false
  const tables = document.querySelectorAll<HTMLTableElement>('table.tbl')
  tables.forEach((table) => {
    if (isHookManaged(table)) return
    // جدولی که همین حالا زیر دست کاربر است، نباید با مقدار ذخیره‌شده‌ی قبلی
    // بازنویسی شود (وگرنه ستون هنگام کشیدن می‌پرد)
    if (drag && drag.table === table) return
    const key = keyOf(table)
    if (!key) return
    const widths = loadWidths(key, headerCells(table).length)
    if (!widths) return
    // اگر عرض‌ها از قبل درست نشسته‌اند، به DOM دست نمی‌زنیم
    const cells = headerCells(table)
    const sum = widths.reduce((a, w) => a + Math.max(MIN_W, Math.round(w)), 0)
    const ok =
      table.classList.contains('tbl-fixed') &&
      table.style.width === `${sum}px` &&
      cells.every((c, i) => c.style.width === `${Math.max(MIN_W, Math.round(widths[i]))}px`)
    if (!ok) applyWidths(table, widths)
  })
}

function queueScan(): void {
  if (scanQueued || applying || drag) return
  scanQueued = true
  window.requestAnimationFrame(scan)
}

/** یک بار در main.tsx صدا زده می‌شود (قبل از enableRowResize). */
export function enableColResize(): void {
  if ((window as any).__colResizeReady) return
  ;(window as any).__colResizeReady = true

  // ---------------- کشیدن ----------------
  document.addEventListener(
    'mousemove',
    (e) => {
      if (drag) {
        // کشیدن به چپ = بزرگ‌تر شدن ستون (جدول راست‌به‌چپ)
        const delta = drag.startX - e.clientX
        const next = [...drag.base]
        next[drag.index] = Math.max(MIN_W, Math.round(drag.base[drag.index] + delta))
        applyWidths(drag.table, next)
        e.preventDefault()
        return
      }
      const hot = !!edgeAt(e.target as Element, e.clientX, e.clientY)
      document.body.classList.toggle('col-resizing-hot', hot)
    },
    true
  )

  document.addEventListener(
    'mousedown',
    (e) => {
      if ((e as MouseEvent).button !== 0) return
      const hit = edgeAt(e.target as Element, e.clientX, e.clientY)
      if (!hit) return
      const key = keyOf(hit.table)
      if (!key) return
      const cells = headerCells(hit.table)
      const saved = loadWidths(key, cells.length)
      drag = {
        table: hit.table,
        key,
        index: hit.index,
        startX: e.clientX,
        base: saved ?? measure(hit.table)
      }
      applyWidths(hit.table, drag.base)
      document.body.classList.add('col-resizing')
      e.preventDefault()
      // ردیف‌کش (rowResize) نباید همین کلیک را هم برای ارتفاع بردارد
      e.stopPropagation()
    },
    true
  )

  document.addEventListener('mouseup', () => {
    const d = drag
    if (!d) return
    drag = null
    document.body.classList.remove('col-resizing')
    const cells = headerCells(d.table)
    saveWidths(
      d.key,
      cells.map((c) => Math.max(MIN_W, Math.round(parseFloat(c.style.width) || c.getBoundingClientRect().width)))
    )
  })

  // ---------------- دوبار کلیک روی مرز ----------------
  document.addEventListener(
    'dblclick',
    (e) => {
      const hit = edgeAt(e.target as Element, e.clientX, e.clientY)
      if (!hit) return
      const key = keyOf(hit.table)
      if (!key) return
      e.preventDefault()
      e.stopPropagation()

      // Shift = کل جدول به چیدمان خودکار اول
      if ((e as MouseEvent).shiftKey) {
        applyWidths(hit.table, null)
        saveWidths(key, null)
        return
      }
      // فقط همان ستون: عرض خودکارش دوباره اندازه‌گیری و جای عدد دستی گذاشته می‌شود
      const cells = headerCells(hit.table)
      const current = loadWidths(key, cells.length) ?? measure(hit.table)
      applyWidths(hit.table, null)
      const auto = measure(hit.table)
      const next = [...current]
      next[hit.index] = auto[hit.index] ?? next[hit.index]
      applyWidths(hit.table, next)
      saveWidths(key, next)
    },
    true
  )

  // ---------------- برگرداندن چیدمان بعد از هر رندر ----------------
  const observer = new MutationObserver(() => queueScan())
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true })
    queueScan()
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
  // تغییر صفحه در روتر هش‌محور
  window.addEventListener('hashchange', queueScan)
}
