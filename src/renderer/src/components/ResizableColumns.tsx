import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

/**
 * ===================== تغییر اندازه‌ی ستون‌ها با ماوس =====================
 * همان کاری که در اکسل انجام می‌دهید: نشانگر را روی مرز دو سرستون بگذارید و
 * بکشید تا ستون بزرگ یا کوچک شود. مثلاً ستون «عوارض و مالیات» که مقدارش صفر
 * است را می‌توانید تا حد یک نوار باریک کوچک کنید تا جدول جمع‌و‌جور شود.
 *
 * چطور کار می‌کند (و چرا این‌طور):
 *   • تا وقتی کاربر هیچ ستونی را نکشیده، جدول *دقیقاً* مثل قبل و با چیدمان
 *     خودکار مرورگر نمایش داده می‌شود (هیچ چیزی از ظاهر فعلی خراب نمی‌شود).
 *   • با اولین کشیدن، عرض واقعی همان لحظه‌ی همه‌ی ستون‌ها اندازه‌گیری و ثابت
 *     می‌شود و از آن به بعد فقط ستون‌هایی که خودتان می‌کشید عوض می‌شوند.
 *   • عرض‌ها با کلید جدول در همان سیستم ذخیره می‌شود، پس بعد از بستن و باز
 *     کردن برنامه هم همان چیدمانی که چیده‌اید سر جایش است.
 *   • دوبار کلیک روی مرز = بازگشت همان ستون به عرض خودکار · دکمه‌ی «بازنشانی
 *     عرض ستون‌ها» = بازگشت کل جدول به حالت اول.
 * ========================================================================
 */

const MIN_WIDTH = 28
const STORAGE_PREFIX = 'tblcols:'

function loadWidths(key: string, count: number): number[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== count) return null
    const widths = parsed.map((w: unknown) => Math.max(MIN_WIDTH, Math.round(Number(w) || MIN_WIDTH)))
    return widths.every((w) => Number.isFinite(w)) ? widths : null
  } catch {
    return null
  }
}

function saveWidths(key: string, widths: number[] | null): void {
  try {
    if (!widths) window.localStorage.removeItem(STORAGE_PREFIX + key)
    else window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(widths))
  } catch {
    /* اگر ذخیره نشد، فقط چیدمان یادش نمی‌ماند؛ کار جدول ادامه دارد */
  }
}

/**
 * ثبت جدول‌های زنده‌ی این هوک به‌ازای کلیدشان — برای اینکه دکمه‌ی سراسریِ
 * «برگشت به پیش‌فرض» (lib/tableLayoutFab.ts) بتواند بدون دست‌زدن به صفحه‌ها
 * جدول‌های هوک‌محور (گزارشات فروش، اقلام پنل فروش) را هم ریست کند.
 */
const liveHookCols = new Map<string, { reset: () => void; customized: () => boolean }>()
export const getHookColsByKey = (key: string | null | undefined) =>
  (key ? liveHookCols.get(key) : undefined) ?? undefined

export interface ResizableColumns {
  /** به عنصر <table> وصل می‌شود تا عرض واقعی ستون‌ها قابل اندازه‌گیری باشد */
  tableRef: (node: HTMLTableElement | null) => void
  /** کلاس جدول: با عرض ثابت (بعد از اولین کشیدن) یا خودکار */
  tableClass: string
  /** آرایه‌ی عرض‌ها؛ null = هنوز چیدمان خودکار است */
  widths: number[] | null
  /** روی مرز سرستون گذاشته می‌شود */
  onGripDown: (index: number) => (e: ReactMouseEvent) => void
  /** دوبار کلیک روی مرز: همان ستون آزاد شود */
  onGripDoubleClick: (index: number) => void
  /** بازگشت کل جدول به عرض‌های خودکار */
  reset: () => void
  /** آیا کاربر عرض ستونی را تغییر داده است (برای نمایش دکمه‌ی بازنشانی) */
  customized: boolean
}

/**
 * @param key   کلید ذخیره‌سازی چیدمان (یک نام یکتا برای هر جدول)
 * @param count تعداد ستون‌های جدول (شامل ستون‌های خالی انتهایی)
 */
export function useResizableColumns(key: string, count: number): ResizableColumns {
  const [widths, setWidths] = useState<number[] | null>(() => loadWidths(key, count))
  const tableEl = useRef<HTMLTableElement | null>(null)
  const drag = useRef<{ index: number; startX: number; base: number[] } | null>(null)
  /** آینه‌ی همگامِ state برای خواندنِ بیرون‌از-React (رجیستری فاب) */
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  // اگر تعداد ستون‌ها عوض شد (تب دیگر، ستون جدید)، چیدمان قدیمی معتبر نیست
  useEffect(() => {
    setWidths((cur) => (cur && cur.length !== count ? loadWidths(key, count) : cur))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, count])

  const tableRef = useCallback(
    (node: HTMLTableElement | null) => {
      // کلید جدول روی عنصر می‌نشیند تا tableLayoutFab بتواند جدول ← هوک را نگاشت کند
      if (tableEl.current && tableEl.current !== node) tableEl.current.removeAttribute('data-rzkey')
      tableEl.current = node
      if (node) {
        node.setAttribute('data-rzkey', key)
        // اگر React عنصر جدول را بازسازی کرد، قفل عرض دستیِ قبلی هم بازنشانی شود
        const cur = widthsRef.current
        if (cur && cur.length) {
          const sum = cur.reduce((a, w) => a + Math.max(MIN_WIDTH, Math.round(w)), 0)
          node.style.width = `${sum}px`
        }
      }
    },
    [key]
  )

  /** عرض واقعی سرستون‌ها در همین لحظه (مبنای شروع کشیدن). */
  const measure = useCallback((): number[] => {
    const table = tableEl.current
    const cells = table?.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th, thead tr:first-child > td')
    const out: number[] = []
    cells?.forEach((cell) => out.push(Math.max(MIN_WIDTH, Math.round(cell.getBoundingClientRect().width))))
    while (out.length < count) out.push(90)
    return out.slice(0, count)
  }, [count])

  const onGripDown = useCallback(
    (index: number) => (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const base = widths && widths.length === count ? [...widths] : measure()
      drag.current = { index, startX: e.clientX, base }
      setWidths(base)
      document.body.classList.add('col-resizing')
    },
    [widths, count, measure]
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      // جدول راست‌به‌چپ است: دستگیره روی لبه‌ی چپ ستون است، پس کشیدن به سمت
      // چپ ستون را بزرگ‌تر می‌کند.
      const delta = d.startX - e.clientX
      const next = [...d.base]
      next[d.index] = Math.max(MIN_WIDTH, Math.round(d.base[d.index] + delta))
      setWidths(next)
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.classList.remove('col-resizing')
      setWidths((cur) => {
        saveWidths(key, cur)
        return cur
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [key])

  const onGripDoubleClick = useCallback(
    (index: number) => {
      setWidths((cur) => {
        if (!cur) return cur
        const auto = measure()
        const next = [...cur]
        next[index] = auto[index] ?? next[index]
        saveWidths(key, next)
        return next
      })
    },
    [key, measure]
  )

  const reset = useCallback(() => {
    setWidths(null)
    saveWidths(key, null)
  }, [key])

  /**
   * رجیستری زنده‌ی جدول‌های هوک‌محور — دکمه‌ی سراسری «↺ برگشت به پیش‌فرض»
   * (tableLayoutFab) از این مسیر همین جدول را ریست می‌کند؛ هوک و صفحه‌ها
   * هیچ تغییری نمی‌خواهند.
   */
  useEffect(() => {
    liveHookCols.set(key, { reset, customized: () => widthsRef.current != null })
    return () => {
      liveHookCols.delete(key)
    }
  }, [key, reset])

  /**
   * ⚠️ قفل عرض کل جدول کنار چیدمان دستی (همان ریشه‌ی جهش‌های colResize):
   * جدول `w-full` است و با `table-layout: fixed`، مرورگر برای پرکردن ۱۰۰٪
   * همه‌ی ستون‌ها را بازتوزیع می‌کرد و کشیدنِ یک ستون بقیه را می‌جابه‌جا
   * کرد. با عرض پیکسلیِ جدول، هر ستون دقیقاً همان چیزی می‌شود که کشیده شده
   * (بزرگ‌تر از صفحه ⇒ اسکرول افقی wrapper، مثل اکسل). با ریست، قفل پاک و
   * چیدمان خودکارِ w-full برمی‌گردد.
   */
  useEffect(() => {
    const t = tableEl.current
    if (!t) return
    if (widths && widths.length) {
      const sum = widths.reduce((a, w) => a + Math.max(MIN_WIDTH, Math.round(w)), 0)
      t.style.width = `${sum}px`
    } else {
      t.style.removeProperty('width')
    }
  }, [widths])

  return {
    tableRef,
    tableClass: widths ? 'tbl tbl-fixed' : 'tbl',
    widths,
    onGripDown,
    onGripDoubleClick,
    reset,
    customized: !!widths
  }
}

/** <colgroup> جدول؛ وقتی چیدمان خودکار است چیزی رندر نمی‌شود. */
export function ColGroup({ widths }: { widths: number[] | null }) {
  if (!widths) return null
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: `${w}px` }} />
      ))}
    </colgroup>
  )
}

/**
 * دستگیره‌ی تغییر عرض، داخل سرستون.
 * روی لبه‌ی چپ سرستون می‌نشیند (در جدول راست‌به‌چپ = مرز با ستون بعدی).
 */
export function ColumnGrip({
  index,
  cols
}: {
  index: number
  cols: ResizableColumns
}) {
  return (
    <span
      className="col-grip"
      title="برای تغییر عرض ستون بکشید · دوبار کلیک = عرض خودکار"
      onMouseDown={cols.onGripDown(index)}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        cols.onGripDoubleClick(index)
      }}
    />
  )
}

/** سرستون‌های آماده‌ی یک جدول با قابلیت تغییر عرض. */
export function ResizableHeaderCells({
  headers,
  cols,
  extraColumns = 0
}: {
  headers: string[]
  cols: ResizableColumns
  /** ستون‌های بدون عنوان انتهای جدول (مثلاً ستون دکمه‌ی «چاپ فیش») */
  extraColumns?: number
}) {
  return (
    <>
      {headers.map((h, i) => (
        <th key={`${h}-${i}`} className="th-resizable" title={h}>
          <span className="th-text">{h}</span>
          <ColumnGrip index={i} cols={cols} />
        </th>
      ))}
      {Array.from({ length: extraColumns }).map((_, i) => (
        <th key={`extra-${i}`} className="th-resizable">
          <ColumnGrip index={headers.length + i} cols={cols} />
        </th>
      ))}
    </>
  )
}
