import { useCallback, useEffect, useState } from 'react'
import { call, CH } from '../lib/api'
import { useManagerSession } from './useManagerSession'
import { allLockedConfig, isPanelLockEnabled, parsePanelLocks, type PanelKey, type PanelLockConfig } from '@shared/panels'
import type { PanelLockState } from '@shared/types'

/**
 * ===========================================================================
 * بند ۱ — سمت renderer برای «مدیریت قفل رمز دوم به‌صورت ماژولار».
 *
 * سیاست قفل در دیتابیس است و *هر گیت* در لحظه‌ی رندر لازمش دارد. اگر هر
 * `ManagerGate` خودش جدا می‌خواند، باز کردن یک صفحه‌ی شامل چند گیت چند
 * درخواست همزمان می‌فرستاد و — بدتر — هر گیت می‌توانست لحظه‌ای وضعیت متفاوت
 * ببیند. پس یک کَش سطح-ماژول داریم: اولین مصرف‌کننده می‌خواند، بقیه از همان
 * استفاده می‌کنند، و هر تغییری (ذخیره در پنل تنظیمات) با یک رویداد به همه
 * اطلاع داده می‌شود.
 *
 * ⚠️ قاعده‌ی «fail-closed» بدون استثنا:
 *   • تا وقتی سیاست خوانده نشده (`loaded === false`)، فرض می‌شود **همه‌چیز
 *     قفل است**. پس یک خطای شبکه/دیتابیس یا یک لحظه‌ی کوتاهِ بارگذاری
 *     هیچ‌وقت پنلی را باز نمی‌کند.
 *   • خطای خواندن هم «قفل» تفسیر می‌شود، نه «باز».
 *   • خودِ تفسیر مقدارها با `isPanelLockEnabled` انجام می‌شود (همان تابع
 *     shared که سمت main هم استفاده می‌شود)، پس هیچ منطق دومی وجود ندارد که
 *     با منطق سرور واگرا شود.
 * ===========================================================================
 */

/** رویداد «سیاست قفل ماژول‌ها عوض شد» — بعد از هر ذخیره در پنل تنظیمات. */
export const PANEL_LOCKS_CHANGED_EVENT = 'mahak:panel-locks-changed'

let cache: PanelLockConfig | null = null
let inflight: Promise<PanelLockConfig> | null = null

/** خواندن سیاست قفل (با کَش). خطا ⇒ «همه قفل». */
async function fetchLocks(force = false): Promise<PanelLockConfig> {
  if (!force && cache) return cache
  if (!force && inflight) return inflight
  const p = (async () => {
    try {
      const state = await call<PanelLockState>(CH.managerPanelLocks)
      cache = parsePanelLocks(state?.locks)
    } catch {
      // fail-closed: نشدنِ خواندن هرگز به معنی «قفل باز» نیست
      cache = allLockedConfig()
    }
    inflight = null
    return cache
  })()
  inflight = p
  return p
}

/** به همه‌ی گیت‌های باز بگو سیاست قفل عوض شده است. */
export function broadcastPanelLocksChanged(): void {
  cache = null
  inflight = null
  try {
    window.dispatchEvent(new Event(PANEL_LOCKS_CHANGED_EVENT))
  } catch {
    /* رویداد یک «سهولت» است؛ هر گیت با رندر بعدی خودش تازه می‌شود */
  }
}

export interface PanelLocksHook {
  locks: PanelLockConfig
  /** سیاست از دیتابیس خوانده شده است؟ (false ⇒ همه‌چیز قفل فرض می‌شود) */
  loaded: boolean
  reload: () => Promise<void>
}

/** کل سیاست قفل ماژول‌ها (برای پنل تنظیمات و نوار وضعیت). */
export function usePanelLocks(): PanelLocksHook {
  const [locks, setLocks] = useState<PanelLockConfig>(() => cache ?? allLockedConfig())
  const [loaded, setLoaded] = useState(!!cache)

  const reload = useCallback(async () => {
    const next = await fetchLocks(true)
    setLocks({ ...next })
    setLoaded(true)
  }, [])

  useEffect(() => {
    let alive = true
    void fetchLocks().then((next) => {
      if (!alive) return
      setLocks({ ...next })
      setLoaded(true)
    })
    const onChanged = () => {
      void fetchLocks(true).then((next) => {
        if (!alive) return
        setLocks({ ...next })
        setLoaded(true)
      })
    }
    window.addEventListener(PANEL_LOCKS_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.removeEventListener(PANEL_LOCKS_CHANGED_EVENT, onChanged)
    }
  }, [])

  return { locks, loaded, reload }
}

/** قفل همین یک ماژول روشن است؟ (تا خوانده نشده: بله، روشن). */
export function usePanelLock(panel: string): { lockEnabled: boolean; loaded: boolean } {
  const { locks, loaded } = usePanelLocks()
  return { lockEnabled: isPanelLockEnabled(locks, panel), loaded }
}

/**
 * این ماژول همین حالا «باز» است؟ دو مسیر، و هر دو کافی‌اند:
 *   ۱) نشست مدیر یا رمز دومِ همان پنل وارد شده است (`canOpen`)، یا
 *   ۲) مدیر آگاهانه قفل همین ماژول را خاموش کرده است (بند ۱).
 *
 * همان تصمیمی که `ManagerGate` می‌گیرد، ولی به‌صورت یک بولین — برای قفل‌های
 * «ریز» که صفحه‌ی رمز کامل نمی‌خواهند و فقط باید یک دکمه/ستون را غیرفعال کنند.
 */
export function usePanelOpen(panel: PanelKey): boolean {
  const { canOpen } = useManagerSession()
  const { lockEnabled, loaded } = usePanelLock(panel)
  return canOpen(panel) || (loaded && !lockEnabled)
}
