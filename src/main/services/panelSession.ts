/**
 * ===========================================================================
 * نشستِ بازِ پنل، در سمت Main
 * ---------------------------------------------------------------------------
 * Renderer فقط نمایش می‌دهد؛ مجوز واقعی این‌جا نگهداری می‌شود. نشست‌ها عمداً
 * موقت هستند، اما دیگر بین پنجره‌ها مشترک نیستند: هر `webContents.id` مجموعه
 * جداگانه‌ای از نشست مدیر و scopeهای محدود خودش دارد.
 * ===========================================================================
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { BusinessError } from '../errors'
import { isPanelLockEnabled, normalizePanelKey, PANEL_KEYS } from '@shared/panels'
import { readPanelLocks } from './AuthService'

/** پیش‌فرض پنج دقیقه بی‌کاری؛ با تنظیمات امنیتی به‌روز می‌شود. */
export const PANEL_SESSION_TTL_MS = 5 * 60 * 1000

let ttlMs = PANEL_SESSION_TTL_MS

export function applyPanelSessionTtlMinutes(minutes: number): void {
  const n = Math.round(Number(minutes))
  if (!Number.isFinite(n)) return
  ttlMs = Math.min(1440, Math.max(1, n)) * 60 * 1000
}

/** فقط برای تست؛ تنظیمات محصول از دقیقه می‌آید. */
export function applyPanelSessionTtlMs(ms: number): void {
  const n = Math.round(Number(ms))
  if (!Number.isFinite(n) || n < 1) return
  ttlMs = n
}

export function panelSessionTtlMs(): number {
  return ttlMs
}

type Scope = 'MANAGER' | 'PANEL'
type Entry = { expiresAt: number; scope: Scope; openedAt: number; generation: number }

/**
 * کلید صفر فقط برای تست‌های مستقیم و callerهای قدیمیِ بیرون از IPC است. در
 * فراخوانی واقعی، `runWithPanelSessionOwner(event.sender.id, …)` همیشه owner را
 * از Electron می‌گیرد؛ renderer هرگز اجازه انتخاب آن را ندارد.
 */
const LEGACY_OWNER = 0
const MANAGER_KEY = '__manager__'
const ownerContext = new AsyncLocalStorage<number>()
const sessionsByOwner = new Map<number, Map<string, Entry>>()
const generationsByOwner = new Map<number, number>()

function ownerOf(explicit?: number): number {
  if (Number.isSafeInteger(explicit) && Number(explicit) >= 0) return Number(explicit)
  return ownerContext.getStore() ?? LEGACY_OWNER
}

function bucket(owner: number, create = false): Map<string, Entry> | undefined {
  let found = sessionsByOwner.get(owner)
  if (!found && create) {
    found = new Map<string, Entry>()
    sessionsByOwner.set(owner, found)
  }
  return found
}

function generationOf(owner: number): number {
  return generationsByOwner.get(owner) ?? 0
}

function bumpGeneration(owner: number): number {
  const next = generationOf(owner) + 1
  generationsByOwner.set(owner, next)
  return next
}

/**
 * IPC wrapper this function around every request runs. It lets existing service
 * gates (`assertPanelUnlocked` / `assertManagerSession`) safely resolve the
 * calling window without accepting a window/session id from renderer payload.
 */
export function runWithPanelSessionOwner<T>(owner: number, fn: () => T): T {
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new BusinessError('پنجرهٔ درخواست معتبر نیست؛ عملیات امنیتی انجام نشد.')
  return ownerContext.run(owner, fn)
}

/** فقط برای diagnostics/status؛ session status خودش timer بی‌کاری را تازه نمی‌کند. */
function alive(key: string, owner: number, touch: boolean): Entry | null {
  const entries = bucket(owner)
  const entry = entries?.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    entries?.delete(key)
    if (entries?.size === 0) sessionsByOwner.delete(owner)
    return null
  }
  if (touch) entry.expiresAt = Date.now() + ttlMs
  return entry
}

/**
 * بعد از verify موفق صدا زده می‌شود. `OPEN` یعنی قفل این پنل خاموش است و نشست
 * امنیتی نمی‌سازد. Scope مدیر همه پنل‌ها را برای همان پنجره پوشش می‌دهد.
 */
export function notePanelUnlocked(panel: string, scope: Scope | 'OPEN', explicitOwner?: number): void {
  if (scope === 'OPEN') return
  const owner = ownerOf(explicitOwner)
  const key = scope === 'MANAGER' ? MANAGER_KEY : (normalizePanelKey(panel) ?? panel)
  const now = Date.now()
  bucket(owner, true)?.set(key, {
    expiresAt: now + ttlMs,
    scope,
    openedAt: now,
    generation: generationOf(owner)
  })
}

/**
 * خروج سراسری همان پنجره: مدیر و تمام پنل‌های محدودش با هم پاک می‌شوند. اگر
 * بیرون از context و بدون owner فراخوانی شود، رفتار سازگار قدیمی یعنی پاک‌کردن
 * همه نشست‌ها را حفظ می‌کند (فقط برای shutdown/test).
 */
export function clearPanelSessions(explicitOwner?: number): void {
  if (Number.isSafeInteger(explicitOwner) && Number(explicitOwner) >= 0) {
    const owner = Number(explicitOwner)
    sessionsByOwner.delete(owner)
    bumpGeneration(owner)
    return
  }
  const contextualOwner = ownerContext.getStore()
  if (contextualOwner != null) {
    sessionsByOwner.delete(contextualOwner)
    bumpGeneration(contextualOwner)
    return
  }
  sessionsByOwner.clear()
  for (const owner of generationsByOwner.keys()) bumpGeneration(owner)
}

/** lifecycle پنجره: با destroy شدن webContents فقط نشست همان پنجره پاک می‌شود. */
export function clearPanelSessionsForOwner(owner: number): void {
  clearPanelSessions(owner)
}

/** خروج محدود یک پنل؛ نشست مدیر و حضانت را دست نمی‌زند. */
export function clearPanelScope(panel: string, explicitOwner?: number): void {
  const owner = ownerOf(explicitOwner)
  const key = normalizePanelKey(panel) ?? panel
  const entries = bucket(owner)
  if (!entries) return
  entries.delete(key)
  if (entries.size === 0) sessionsByOwner.delete(owner)
}

/** آیا همین پنل برای sender فعلی باز است؟ */
export function isPanelUnlocked(panel: string, explicitOwner?: number): boolean {
  const owner = ownerOf(explicitOwner)
  return !!alive(MANAGER_KEY, owner, true) || !!alive(normalizePanelKey(panel) ?? panel, owner, true)
}

/** آیا فقط نشست اصلی مدیر برای sender فعلی معتبر است؟ */
export function isManagerSessionUnlocked(explicitOwner?: number): boolean {
  return !!alive(MANAGER_KEY, ownerOf(explicitOwner), true)
}

/**
 * Keep-alive محدودِ نشست سراسری مدیر. این تابع فقط ورودی موجودِ همین
 * webContents را تازه می‌کند: نه از payload هویت/owner می‌گیرد، نه scope پنل را
 * به مدیر ارتقا می‌دهد و نه نشست منقضی/غایب را دوباره می‌سازد.
 *
 * Renderer می‌تواند تنها پس از فعالیت واقعی کاربر آن را صدا بزند؛ تصمیمِ نهایی
 * دربارهٔ وجود و تمدید نشست همچنان منحصراً در Main است.
 */
export function touchManagerSession(explicitOwner?: number): PanelSessionStatus {
  const owner = ownerOf(explicitOwner)
  alive(MANAGER_KEY, owner, true)
  return panelSessionStatus(owner)
}

export type PanelSessionStatus = {
  manager: boolean
  sinceIso: string | null
  panels: string[]
  generation: number
}

/** نمای وضعیت برای renderer؛ این خواندن TTL را تمدید نمی‌کند. */
export function panelSessionStatus(explicitOwner?: number): PanelSessionStatus {
  const owner = ownerOf(explicitOwner)
  const manager = alive(MANAGER_KEY, owner, false)
  const entries = bucket(owner)
  const panels: string[] = []
  for (const [key] of entries ?? []) {
    if (key === MANAGER_KEY) continue
    if (alive(key, owner, false)) panels.push(key)
  }
  panels.sort()
  return {
    manager: !!manager,
    sinceIso: manager ? new Date(manager.openedAt).toISOString() : null,
    panels,
    generation: generationOf(owner)
  }
}

/** گیت مخصوص داده‌هایی که فقط مدیر اصلی حق دیدنشان را دارد. */
export function assertManagerSession(action: string): void {
  if (isManagerSessionUnlocked()) return
  throw new BusinessError(
    `برای ${action} فقط نشست فعال مدیر معتبر است. با رمز مدیر وارد شوید؛ رمز دوم پنل یا باز بودن قفل کافی نیست.`
  )
}

/**
 * گیت کانال‌های خواندنی حساس. اگر قفل پنل در تنظیمات خاموش باشد، رفتار legacy
 * حفظ می‌شود؛ در غیر این صورت هم مدیر همان پنجره و هم scope محدود همان پنجره
 * پذیرفته می‌شوند.
 */
export async function assertPanelUnlocked(panel: string, action: string): Promise<void> {
  const key = normalizePanelKey(panel) ?? panel
  if (!isPanelLockEnabled(await readPanelLocks(), key)) return
  if (isPanelUnlocked(key)) return
  throw new BusinessError(
    `برای ${action} باید اول قفل همین بخش را باز کنید (رمز مدیر یا رمز دوم همان پنل). ` +
      'اگر قفل را باز کرده‌اید و این پیام را می‌بینید، مدتی بی‌کار بوده‌اید و نشست بسته شده؛ دوباره باز کنید.'
  )
}

/** کلید پنلی که کانال‌های اعتبار خرید زیر آن قفل می‌شوند. */
export const CREDIT_READ_PANEL = PANEL_KEYS.creditManagement

/**
 * نمای انحصاری پل تطبیق هنوز هر بار رمز تازه می‌خواهد، اما بعد از تأیید همان
 * پنجره را برای readهای بعدی باز می‌گذارد.
 */
export async function assertPanelUnlockedStrict(
  panel: string,
  password: string | null | undefined,
  action: string
): Promise<'MANAGER' | 'PANEL'> {
  const { assertPanelPasswordStrict } = await import('./AuthService')
  const scope = await assertPanelPasswordStrict(panel, password, action)
  notePanelUnlocked(panel, scope)
  return scope
}
