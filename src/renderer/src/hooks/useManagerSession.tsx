import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { call, CH } from '../lib/api'
import type { PanelUnlockResult } from '@shared/types'
import { SETTINGS_CHANGED_EVENT } from './useSettings'
import { DEFAULT_SECURITY_CONFIG } from '@shared/receipt'

/**
 * ===================== «نشست مدیر» و «دسترسی پنلی» =====================
 * دو سطح دسترسی داریم:
 *
 *   ۱) نشست مدیر (`isManager`) — با «رمز مدیر» شروع می‌شود و *همه‌ی* پنل‌های
 *      قفل‌دار را تا زدن «خروج مدیر» باز می‌کند. مو‌به‌مو همان رفتار قبلی.
 *
 *   ۲) دسترسی پنلی (`panels`) — با «رمز دوم اختصاصی» یک پنل شروع می‌شود و
 *      *فقط همان یک پنل* را باز می‌کند. مثلاً رمزی که به حسابدار داده می‌شود تا
 *      فقط «فاکتورهای فروش عمده» را ببیند، بدون دانستن رمز مدیر.
 *
 * پیش‌فرض هر بار باز شدن برنامه = «کارمند پشت سیستم است»: همه‌ی پنل‌های قفل‌دار
 * قفل‌اند. نشست عمداً *فقط در حافظه* است و هیچ‌جا ذخیره نمی‌شود؛ بستن برنامه =
 * قفل شدن همه‌چیز.
 *
 * بند ۴-۴۰ — بعد از بی‌کاری (پیش‌فرض ۵ دقیقه، قابل تنظیم در «رمز و امنیت»)
 * نشست مدیر و دسترسی پنلی خودبه‌خود بسته می‌شوند و سرور هم مطلع می‌شود.
 * ======================================================
 */
export interface ManagerSession {
  /** مدیر پشت سیستم است؟ (رمز مدیر وارد شده) */
  isManager: boolean
  /** لحظه‌ی شروع نشست (برای نمایش در نوار بالا) */
  since: Date | null
  /** پنل‌هایی که با «رمز دوم» خودشان باز شده‌اند (بدون نشست مدیر) */
  panels: string[]
  /** این پنل همین حالا باز است؟ (مدیر، یا رمز دوم همان پنل) */
  canOpen: (panel: string) => boolean
  /** رمز مدیر ⇒ شروع نشست کامل. رمز غلط ⇒ خطای فارسی. */
  login: (password: string) => Promise<void>
  /**
   * باز کردن یک پنل قفل‌دار با رمز مدیر *یا* رمز دوم همان پنل.
   * خروجی می‌گوید با کدام رمز باز شد ('MANAGER' یا 'PANEL').
   */
  unlockPanel: (panel: string, password: string) => Promise<'MANAGER' | 'PANEL'>
  /** خروج: هم نشست مدیر و هم همه‌ی دسترسی‌های پنلی پاک می‌شوند */
  logout: () => void
}

const FALLBACK: ManagerSession = {
  isManager: false,
  since: null,
  panels: [],
  canOpen: () => false,
  login: async () => {
    throw new Error('وضعیت مدیر در دسترس نیست؛ برنامه را یک بار ببندید و باز کنید.')
  },
  unlockPanel: async () => {
    throw new Error('وضعیت مدیر در دسترس نیست؛ برنامه را یک بار ببندید و باز کنید.')
  },
  logout: () => undefined
}

const ManagerContext = createContext<ManagerSession>(FALLBACK)

function idleMsOf(minutes: unknown): number {
  const n = Math.round(Number(minutes))
  const m = Number.isFinite(n) ? Math.min(1440, Math.max(1, n)) : DEFAULT_SECURITY_CONFIG.idleLockMinutes
  return m * 60 * 1000
}

export function ManagerSessionProvider({ children }: { children: ReactNode }) {
  const [isManager, setIsManager] = useState(false)
  const [since, setSince] = useState<Date | null>(null)
  const [panels, setPanels] = useState<string[]>([])
  const [idleMs, setIdleMs] = useState(idleMsOf(DEFAULT_SECURITY_CONFIG.idleLockMinutes))
  const lastActivity = useRef(Date.now())

  const login = useCallback(async (password: string) => {
    await call(CH.managerVerify, { password })
    setIsManager(true)
    setSince(new Date())
    lastActivity.current = Date.now()
  }, [])

  const unlockPanel = useCallback(async (panel: string, password: string) => {
    const res = await call<PanelUnlockResult>(CH.managerPanelVerify, { panel, password })
    lastActivity.current = Date.now()
    if (res?.scope === 'MANAGER') {
      setIsManager(true)
      setSince(new Date())
      return 'MANAGER' as const
    }
    setPanels((p) => (p.includes(panel) ? p : [...p, panel]))
    return 'PANEL' as const
  }, [])

  const logout = useCallback(() => {
    setIsManager(false)
    setSince(null)
    setPanels([])
    void call(CH.managerLogout).catch(() => undefined)
  }, [])

  useEffect(() => {
    const load = () => {
      if (!CH?.settingsBundle) return
      void call<{ security?: { idleLockMinutes?: number } }>(CH.settingsBundle)
        .then((b) => {
          const next = idleMsOf(b?.security?.idleLockMinutes)
          setIdleMs(next)
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener(SETTINGS_CHANGED_EVENT, load)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, load)
  }, [])

  const sessionOpen = isManager || panels.length > 0
  useEffect(() => {
    if (!sessionOpen) return
    lastActivity.current = Date.now()
    const bump = () => {
      lastActivity.current = Date.now()
    }
    const evts: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'click', 'touchstart']
    for (const e of evts) window.addEventListener(e, bump, { passive: true })
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= idleMs) logout()
    }, 1000)
    return () => {
      for (const e of evts) window.removeEventListener(e, bump)
      window.clearInterval(id)
    }
  }, [sessionOpen, idleMs, logout])

  const canOpen = useCallback((panel: string) => isManager || panels.includes(panel), [isManager, panels])

  const value = useMemo<ManagerSession>(
    () => ({ isManager, since, panels, canOpen, login, unlockPanel, logout }),
    [isManager, since, panels, canOpen, login, unlockPanel, logout]
  )

  return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>
}

export function useManagerSession(): ManagerSession {
  return useContext(ManagerContext)
}
