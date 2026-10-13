import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { call, CH } from '../lib/api'
import type { PanelUnlockResult } from '@shared/types'
import { SETTINGS_CHANGED_EVENT } from './useSettings'
import { DEFAULT_SECURITY_CONFIG } from '@shared/receipt'

/**
 * نشست مدیر و scopeهای محدود فقط تصویر renderer نیستند. Main منبع حقیقت است و
 * این provider هنگام startup/status-sync فقط همان حقیقت را نمایش می‌دهد.
 * credential حضانت عمداً جزو این context نیست.
 */
export interface ManagerSession {
  isManager: boolean
  since: Date | null
  panels: string[]
  /** تا اولین status-sync، UI نباید دسترسی قبلی را فرض کند. */
  ready: boolean
  /** در خطای ارتباط با Main، گیت UI fail-closed می‌ماند. */
  securityError: string | null
  isLoggingOut: boolean
  canOpen: (panel: string) => boolean
  login: (password: string) => Promise<void>
  unlockPanel: (panel: string, password: string) => Promise<'MANAGER' | 'PANEL'>
  /** Main-first: پس از revoke موفق Main، UI پاک می‌شود. */
  logout: () => Promise<void>
}

type MainSessionStatus = {
  manager?: boolean
  sinceIso?: string | null
  panels?: string[]
}

const FALLBACK: ManagerSession = {
  isManager: false,
  since: null,
  panels: [],
  ready: false,
  securityError: 'وضعیت دسترسی هنوز آماده نیست.',
  isLoggingOut: false,
  canOpen: () => false,
  login: async () => {
    throw new Error('وضعیت مدیر در دسترس نیست؛ برنامه را یک بار ببندید و باز کنید.')
  },
  unlockPanel: async () => {
    throw new Error('وضعیت مدیر در دسترس نیست؛ برنامه را یک بار ببندید و باز کنید.')
  },
  logout: async () => {
    throw new Error('وضعیت مدیر در دسترس نیست؛ برنامه را یک بار ببندید و باز کنید.')
  }
}

const ManagerContext = createContext<ManagerSession>(FALLBACK)

function idleMsOf(minutes: unknown): number {
  const n = Math.round(Number(minutes))
  const m = Number.isFinite(n) ? Math.min(1440, Math.max(1, n)) : DEFAULT_SECURITY_CONFIG.idleLockMinutes
  return m * 60 * 1000
}

function dateOf(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function ManagerSessionProvider({ children }: { children: ReactNode }) {
  const [isManager, setIsManager] = useState(false)
  const [since, setSince] = useState<Date | null>(null)
  const [panels, setPanels] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [securityError, setSecurityError] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [idleMs, setIdleMs] = useState(idleMsOf(DEFAULT_SECURITY_CONFIG.idleLockMinutes))
  const lastActivity = useRef(Date.now())
  /** جلوگیری از IPC بی‌دلیل برای هر حرکت ماوس؛ TTL واقعی فقط در Main است. */
  const lastManagerTouch = useRef(0)

  const applyMainStatus = useCallback((status: MainSessionStatus | null | undefined) => {
    const manager = status?.manager === true
    setIsManager(manager)
    setSince(manager ? dateOf(status?.sinceIso) ?? new Date() : null)
    setPanels(manager ? [] : Array.isArray(status?.panels) ? status!.panels!.filter((x) => typeof x === 'string') : [])
    setSecurityError(null)
    lastActivity.current = Date.now()
  }, [])

  /** هیچ resetای در startup/remount انجام نمی‌شود؛ فقط حقیقت Main خوانده می‌شود. */
  const syncFromMain = useCallback(async (): Promise<MainSessionStatus> => {
    const status = await call<MainSessionStatus>(CH.managerSessionStatus)
    applyMainStatus(status)
    return status
  }, [applyMainStatus])

  /**
   * تمدید نشست فقط پس از فعالیت واقعی کاربر و فقط برای مدیرِ از پیش واردشده.
   * اگر Main آن را منقضی کرده باشد، پاسخ false است و UI دسترسی را بازسازی
   * نمی‌کند. payload هیچ credential یا شناسهٔ قابل‌اعتمادی ندارد.
   */
  const touchManagerSession = useCallback(() => {
    if (!isManager || securityError) return
    const now = Date.now()
    if (now - lastManagerTouch.current < 15_000) return
    lastManagerTouch.current = now
    void call<MainSessionStatus>(CH.managerSessionTouch)
      .then((status) => applyMainStatus(status))
      .catch(() => {
        // ارتباط با Main قابل‌راستی‌آزمایی نیست: ظاهر UI نیز fail-closed می‌شود.
        setIsManager(false)
        setSince(null)
        setPanels([])
        setSecurityError('وضعیت نشست مدیر قابل بررسی نیست؛ پنل‌های حساس قفل شدند.')
      })
  }, [applyMainStatus, isManager, securityError])

  useEffect(() => {
    let alive = true
    void syncFromMain()
      .catch(() => {
        if (!alive) return
        // اگر Main قابل‌خواندن نیست، UI نباید به جلسه‌ی قبلی خوش‌بین باشد.
        setIsManager(false)
        setSince(null)
        setPanels([])
        setSecurityError('وضعیت امنیتی قابل بررسی نیست؛ پنل‌های حساس تا برقراری ارتباط قفل هستند.')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [syncFromMain])

  const login = useCallback(async (password: string) => {
    await call(CH.managerVerify, { password })
    // پاسخ موفق verify خودش یعنی Main نشست مدیر همین window را ثبت کرده است.
    setIsManager(true)
    setSince(new Date())
    setPanels([])
    setSecurityError(null)
    setReady(true)
    lastActivity.current = Date.now()
  }, [])

  const unlockPanel = useCallback(async (panel: string, password: string) => {
    const res = await call<PanelUnlockResult>(CH.managerPanelVerify, { panel, password })
    lastActivity.current = Date.now()
    setSecurityError(null)
    setReady(true)
    if (res?.scope === 'MANAGER') {
      setIsManager(true)
      setSince(new Date())
      setPanels([])
      return 'MANAGER' as const
    }
    if (res?.scope === 'PANEL') setPanels((p) => (p.includes(panel) ? p : [...p, panel]))
    return 'PANEL' as const
  }, [])

  const logout = useCallback(async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      await call(CH.managerLogout)
      // فقط پس از پاسخ موفق Main، ظاهر UI به کارمند برمی‌گردد.
      setIsManager(false)
      setSince(null)
      setPanels([])
      setSecurityError(null)
      setReady(true)
    } catch (logoutError) {
      /**
       * اگر revoke در Main انجام شده ولی پاسخ گم شده باشد، status حقیقت را
       * مشخص می‌کند. در failure کامل، UI fail-closed می‌شود و موفقیت جعلی نشان
       * داده نمی‌شود.
       */
      try {
        const status = await syncFromMain()
        if (status.manager !== true && !(status.panels?.length)) return
      } catch {
        // پیام fail-closed پایین تنظیم می‌شود.
      }
      setIsManager(false)
      setSince(null)
      setPanels([])
      setSecurityError('خروج مدیر قابل تأیید نیست؛ پنل‌های حساس تا بررسی دوباره قفل شدند.')
      throw logoutError
    } finally {
      setIsLoggingOut(false)
    }
  }, [isLoggingOut, syncFromMain])

  useEffect(() => {
    const load = () => {
      if (!CH?.settingsBundle) return
      void call<{ security?: { idleLockMinutes?: number } }>(CH.settingsBundle)
        .then((b) => setIdleMs(idleMsOf(b?.security?.idleLockMinutes)))
        .catch(() => undefined)
    }
    load()
    window.addEventListener(SETTINGS_CHANGED_EVENT, load)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, load)
  }, [])

  const sessionOpen = !securityError && (isManager || panels.length > 0)
  useEffect(() => {
    if (!sessionOpen) return
    lastActivity.current = Date.now()
    const bump = () => {
      lastActivity.current = Date.now()
      touchManagerSession()
    }
    const evts: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'click', 'touchstart']
    for (const event of evts) window.addEventListener(event, bump, { passive: true })
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= idleMs) void logout().catch(() => undefined)
    }, 1000)
    return () => {
      for (const event of evts) window.removeEventListener(event, bump)
      window.clearInterval(id)
    }
  }, [sessionOpen, idleMs, logout, touchManagerSession])

  const canOpen = useCallback(
    (panel: string) => ready && !securityError && (isManager || panels.includes(panel)),
    [ready, securityError, isManager, panels]
  )

  const value = useMemo<ManagerSession>(
    () => ({ isManager, since, panels, ready, securityError, isLoggingOut, canOpen, login, unlockPanel, logout }),
    [isManager, since, panels, ready, securityError, isLoggingOut, canOpen, login, unlockPanel, logout]
  )

  return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>
}

export function useManagerSession(): ManagerSession {
  return useContext(ManagerContext)
}
