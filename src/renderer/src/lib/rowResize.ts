/**
 * ===========================================================================
 * تغییر اندازه‌ی «ارتفاع ردیف‌ها» با ماوس — شبیه اکسل (مورد ۲)
 *
 * قابلیت عرض ستون‌ها از قبل بود (components/ResizableColumns.tsx). این ماژول
 * همان کار را برای *ارتفاع ردیف* انجام می‌دهد و — برخلاف آن — نیازی به تغییر
 * صفحه‌ها ندارد: یک بار در main.tsx فعال می‌شود و از آن لحظه روی *همه‌ی
 * جدول‌های برنامه* (هر <table class="tbl">) کار می‌کند: پنل کالاها، گزارشات
 * فروش، فاکتور خرید/فروش، بستن صندوق، تجمیع و انتقال، سطل آشغال، انبار مرکزی…
 *
 * طرز استفاده برای کاربر:
 *   • نشانگر را روی مرز *پایین* هر ردیف بگذارید (نشانگر به ↕ عوض می‌شود) و
 *     بکشید: همان ردیف کوتاه یا بلند می‌شود.
 *   • با نگه‌داشتن Shift هنگام کشیدن، همان ارتفاع روی *همه‌ی ردیف‌های آن جدول*
 *     اعمال می‌شود (برای جا شدن ردیف‌های بیشتر در مانیتور کوچک).
 *   • دوبار کلیک روی همان مرز = بازگشت آن ردیف (یا با Shift، کل جدول) به
 *     ارتفاع خودکار.
 *
 * ذخیره‌سازی: ارتفاع‌ها تا وقتی برنامه باز است و همان جدول روی صفحه است باقی
 * می‌مانند (مثل عرض ستون‌ها فقط یک تنظیم نمایشی‌اند و در دیتابیس نوشته
 * نمی‌شوند). چون استایل مستقیم روی خود عنصر ردیف ست می‌شود و React ردیف‌ها را
 * با key بازاستفاده می‌کند، رندر دوباره‌ی صفحه ارتفاع‌ها را پاک نمی‌کند.
 * ===========================================================================
 */

/** فاصله‌ی حساسیت از مرز پایین ردیف (پیکسل) */
const GRIP = 5
const MIN_H = 12
const MAX_H = 600

let drag: { row: HTMLTableRowElement; all: boolean; startY: number; base: number } | null = null

const isTblRow = (el: Element | null): HTMLTableRowElement | null => {
  const tr = el?.closest?.('tr') as HTMLTableRowElement | null
  if (!tr) return null
  return tr.closest('table.tbl') ? tr : null
}

/** آیا نشانگر روی مرز پایین همین ردیف است؟ */
function onBottomEdge(tr: HTMLTableRowElement, clientY: number): boolean {
  const r = tr.getBoundingClientRect()
  return clientY >= r.bottom - GRIP && clientY <= r.bottom + 1
}

function applyHeight(tr: HTMLTableRowElement, h: number | null): void {
  const cells = Array.from(tr.children) as HTMLElement[]
  if (h == null) {
    tr.style.removeProperty('height')
    tr.removeAttribute('data-row-h')
    for (const c of cells) {
      c.style.removeProperty('height')
      c.style.removeProperty('max-height')
      c.style.removeProperty('overflow')
      c.style.removeProperty('padding-top')
      c.style.removeProperty('padding-bottom')
      c.style.removeProperty('line-height')
    }
    return
  }
  const px = Math.min(MAX_H, Math.max(MIN_H, Math.round(h)))
  tr.style.height = `${px}px`
  tr.setAttribute('data-row-h', String(px))
  for (const c of cells) {
    c.style.height = `${px}px`
    c.style.maxHeight = `${px}px`
    c.style.overflow = 'hidden'
    // برای کوچک‌تر شدن از ارتفاع طبیعی، فاصله‌ی داخلی و ارتفاع خط هم جمع می‌شود
    if (px < 26) {
      c.style.paddingTop = '0px'
      c.style.paddingBottom = '0px'
      c.style.lineHeight = `${Math.max(10, px - 2)}px`
    } else {
      c.style.removeProperty('padding-top')
      c.style.removeProperty('padding-bottom')
      c.style.lineHeight = `${px - 8}px`
    }
  }
}

const rowsOf = (tr: HTMLTableRowElement): HTMLTableRowElement[] => {
  const table = tr.closest('table.tbl')
  return table ? (Array.from(table.querySelectorAll('tbody > tr')) as HTMLTableRowElement[]) : [tr]
}

// ---------------------------------------------------------------------------
// API برای دکمه‌ی «↺ برگشت به پیش‌فرض» (tableLayoutFab.ts)
// ---------------------------------------------------------------------------

/** آیا حداقل یک ردیف این جدول ارتفاع دستی گرفته است؟ */
export function tableRowsCustomized(table: HTMLTableElement): boolean {
  return !!table.querySelector('tr[data-row-h]')
}

/** پاک‌کردن ارتفاع دستیِ همه‌ی ردیف‌های این جدول (برگشت به خودکار). */
export function resetTableRows(table: HTMLTableElement): void {
  table.querySelectorAll<HTMLTableRowElement>('tr[data-row-h]').forEach((tr) => applyHeight(tr, null))
}

/** یک بار در main.tsx صدا زده می‌شود. */
export function enableRowResize(): void {
  if ((window as any).__rowResizeReady) return
  ;(window as any).__rowResizeReady = true

  document.addEventListener(
    'mousemove',
    (e) => {
      if (drag) {
        const delta = e.clientY - drag.startY
        const next = drag.base + delta
        if (drag.all) for (const r of rowsOf(drag.row)) applyHeight(r, next)
        else applyHeight(drag.row, next)
        e.preventDefault()
        return
      }
      const tr = isTblRow(e.target as Element)
      const hot = !!tr && onBottomEdge(tr, e.clientY)
      document.body.classList.toggle('row-resizing-hot', hot)
    },
    true
  )

  document.addEventListener(
    'mousedown',
    (e) => {
      if ((e as MouseEvent).button !== 0) return
      const tr = isTblRow(e.target as Element)
      if (!tr || !onBottomEdge(tr, e.clientY)) return
      drag = {
        row: tr,
        all: e.shiftKey,
        startY: e.clientY,
        base: tr.getBoundingClientRect().height
      }
      document.body.classList.add('row-resizing')
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )

  document.addEventListener('mouseup', () => {
    if (!drag) return
    drag = null
    document.body.classList.remove('row-resizing')
  })

  // دوبار کلیک روی مرز = ارتفاع خودکار
  document.addEventListener(
    'dblclick',
    (e) => {
      const tr = isTblRow(e.target as Element)
      if (!tr || !onBottomEdge(tr, e.clientY)) return
      if (e.shiftKey) for (const r of rowsOf(tr)) applyHeight(r, null)
      else applyHeight(tr, null)
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )
}
