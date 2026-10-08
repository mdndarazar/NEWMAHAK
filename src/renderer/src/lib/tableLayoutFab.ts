/**
 * ===========================================================================
 * دکمه‌ی شناور «↺ برگشت به پیش‌فرض» برای جدول‌های با چیدمان دستی (ستون/ردیف)
 * ---------------------------------------------------------------------------
 * قرارداد مالک: هر جدولی که کاربر بتواند ستون یا ردیفش را مثل اکسل جابه‌جا
 * کند، یک دکمه هم داشته باشد که با یک کلیک *همه‌ی* تغییرهای دستیِ همان جدول
 * (عرض ستون‌ها + ارتفاع ردیف‌ها) به حالت پیش‌فرضِ خودکار برگردد.
 *
 * چرا این فایل جداست و چرا دکمه در `document.body` ساخته می‌شود؟ دقیقاً به
 * همان دلیلی که colResize دست به هیچ JSX نمی‌زند: حدود ۴۰ جدول داریم و React
 * مدیریتِ داخله‌ی جدول‌ها را دارد؛ تزریق عنصر *داخل* جدول‌ها خطر برخورد با
 * رندر React را دارد. پس دکمه‌ها به‌صورت شناور (position: fixed) روی گوشه‌ی
 * بالای چپِ جدول نشانده می‌شوند و هیچ عنصری داخل DOMِ React ساخته نمی‌شود.
 *
 * رفتار دکمه: کلیک ⇒ `resetTableCols` (پاک‌کردن عرض‌های ذخیره‌شده و حذف قفل
 * عرض جدول) + `resetTableRows` (پاک‌کردن ارتفاع دستی همه‌ی ردیف‌ها). بعد از
 * ریست، اگر چیزی برای ریست کردن نمانده باشد دکمه هم محو می‌شود.
 *
 * ⚠️ دکمه فقط وقتی دیده می‌شود که برای همان جدول واقعاً چیزی برای برگرداندن
 * وجود داشته باشد (چیدمان دستی فعال). جدول‌هایی که هوک React خودشان
 * مدیریتشان می‌کند (گزارشات فروش، جدول اقلام پنل فروش) نادیده گرفته می‌شوند —
 * همان قاعده‌ی colResize (دو منطق روی یک جدول نمی‌نشینند).
 * ⚠️ پوشانده‌شدن با مودال: اگر روی جدول یک overlay تمام‌صفحه (مودال z-50)
 * باز باشد، elementFromPoint آن را تشخیص می‌دهد و دکمه مخفی می‌ماند؛ دکمه‌ی
 * جدولی که خودش داخل همان مودال است دیده می‌شود و با z-index بالاتر از مودال
 * روی آن می‌نشیند.
 * ===========================================================================
 */

import { isHookManagedTable, resetTableCols, tableColsCustomized } from './colResize'
import { resetTableRows, tableRowsCustomized } from './rowResize'

const BTN_TEXT = '↺'
const BTN_TITLE = 'برگشت اندازه‌ی ستون‌ها و ارتفاع ردیف‌های این جدول به حالت پیش‌فرض'
/** بالاتر از بک‌دراپ مودال‌ها (z-50) تا دکمه‌ی جدولِ داخل مودال هم دیده شود */
const Z = '60'

const fabs = new Map<HTMLTableElement, HTMLButtonElement>()
let syncing = false
let queued = false

/** چیدمان دستی فعال دارد؟ (ستون یا ردیف — هرکدام کافی است) */
const customized = (t: HTMLTableElement): boolean => tableColsCustomized(t) || tableRowsCustomized(t)

function makeFab(table: HTMLTableElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'tbl-fab'
  btn.textContent = BTN_TEXT
  btn.title = BTN_TITLE
  btn.setAttribute('aria-label', BTN_TITLE)
  btn.tabIndex = -1
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    resetTableCols(table)
    resetTableRows(table)
    sync()
  })
  document.body.appendChild(btn)
  return btn
}

function dropFab(table: HTMLTableElement): void {
  const btn = fabs.get(table)
  if (btn) {
    btn.remove()
    fabs.delete(table)
  }
}

function sync(): void {
  queued = false
  syncing = true
  try {
    // جدولِ حذف‌شده یا ریست‌شده ⇒ دکمه‌اش هم برود
    for (const [t] of fabs) {
      if (!document.contains(t) || isHookManagedTable(t) || !customized(t)) dropFab(t)
    }
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table.tbl'))
    for (const t of tables) {
      if (isHookManagedTable(t) || !customized(t)) continue
      const r = t.getBoundingClientRect()
      // جدول کوچک/پنهان یا بیرون از دید ⇒ دکمه‌ای نما
      if (
        r.width < 60 ||
        r.height < 40 ||
        r.bottom < 0 ||
        r.right < 0 ||
        r.top > window.innerHeight ||
        r.left > window.innerWidth
      ) {
        dropFab(t)
        continue
      }
      const existing = fabs.get(t)
      // دکمه‌ی خودِ ما نباید در elementFromPoint خودش را بپوشاند
      if (existing) existing.style.visibility = 'hidden'
      const topEl = document.elementFromPoint(Math.max(2, r.left) + 10, Math.max(2, r.top) + 10)
      const occluded =
        !!topEl && topEl !== existing && !t.contains(topEl) && topEl.closest('table.tbl') !== t
      if (occluded) {
        dropFab(t)
        continue
      }
      const btn = existing ?? makeFab(t)
      fabs.set(t, btn)
      btn.style.visibility = ''
      btn.style.zIndex = Z
      btn.style.top = `${Math.max(2, r.top + 3)}px`
      btn.style.left = `${Math.max(2, r.left + 3)}px`
    }
  } finally {
    syncing = false
  }
}

function queueSync(): void {
  if (queued || syncing) return
  queued = true
  window.requestAnimationFrame(sync)
}

/** یک بار در main.tsx، بعد از enableColResize/enableRowResize صدا زده می‌شود. */
export function enableTableLayoutFab(): void {
  if ((window as any).__tableLayoutFabReady) return
  ;(window as any).__tableLayoutFabReady = true

  const observer = new MutationObserver(() => queueSync())
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true })
    queueSync()
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })

  // جدول داخل کانتینر اسکرول‌دار است؛ مختصات دکمه باید همراه اسکرول به‌روز شود
  document.addEventListener('scroll', queueSync, true)
  window.addEventListener('resize', queueSync)
  window.addEventListener('hashchange', queueSync)
}
