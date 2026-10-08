/**
 * ===========================================================================
 * نشست ۱۸۲ · بند ۴-۲۱ و ۴-۴۰ — نشستِ بازِ پنل، در سمت *سرور*
 * ---------------------------------------------------------------------------
 * تا امروز «کدام پنل باز است» فقط در renderer نگهداری می‌شد
 * (`useManagerSession.tsx`، یک آرایه در state). main هیچ خبری نداشت.
 *
 * پیامدش برای کانال‌های *خواندنی* حساس این بود: `creditList`،
 * `creditDashboard` و `creditDetail` بدون هیچ گیتی صدا زده می‌شدند. هر کسی که
 * به IPC دسترسی داشته باشد — بدون باز کردن قفل در UI — کل فهرست اعتبارها،
 * مبالغ، دارنده‌ها و سابقه‌شان را می‌گرفت. قفل UI فقط یک پرده بود.
 *
 * این ماژول همان تصمیمِ باز کردن قفل را که کاربر در UI می‌گیرد، در main هم
 * ثبت می‌کند تا کانال‌ها بتوانند مستقل بسنجند. عمداً ساده و در حافظه است:
 *   • با بسته شدن برنامه پاک می‌شود (که درست است — نشست باید موقت باشد).
 *   • با گذشت زمانِ بی‌کاری خودش منقضی می‌شود (بند ۴-۴۰).
 *
 * ⚠️ این جایگزین `assertPanelPassword` **نیست**. آن برای عملیات *نوشتنی* است
 * و هر بار رمز می‌خواهد. این برای کانال‌های *خواندنی* پرتکرار است که نمی‌شود
 * در هر بار فراخوانی از کاربر رمز خواست.
 * ===========================================================================
 */
import { BusinessError } from '../errors'
import { isPanelLockEnabled, normalizePanelKey, PANEL_KEYS } from '@shared/panels'
import { readPanelLocks } from './AuthService'

/**
 * بند ۴-۴۰ — پیش‌فرض ۵ دقیقه بی‌کاری.
 * مقدار زنده‌اش از تنظیمات امنیتی (`idleLockMinutes`) با `applyPanelSessionTtlMinutes`
 * می‌آید تا renderer و main یک عدد داشته باشند.
 */
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

type Entry = { expiresAt: number; scope: 'MANAGER' | 'PANEL' }

const sessions = new Map<string, Entry>()

/** نشست مدیر، همه‌ی پنل‌ها را پوشش می‌دهد (همان معنای `scope: 'MANAGER'`). */
const MANAGER_KEY = '__manager__'

/**
 * بعد از یک `verifyPanel` موفق صدا زده می‌شود.
 * `scope: 'OPEN'` یعنی قفل این پنل اصلاً خاموش است ⇒ چیزی ثبت نمی‌شود.
 */
export function notePanelUnlocked(panel: string, scope: 'MANAGER' | 'PANEL' | 'OPEN'): void {
  if (scope === 'OPEN') return
  const key = scope === 'MANAGER' ? MANAGER_KEY : (normalizePanelKey(panel) ?? panel)
  sessions.set(key, { expiresAt: Date.now() + ttlMs, scope })
}

/** خروج کاربر یا قفل دستی: همه‌چیز پاک می‌شود. */
export function clearPanelSessions(): void {
  sessions.clear()
}

function alive(key: string): Entry | null {
  const e = sessions.get(key)
  if (!e) return null
  if (e.expiresAt <= Date.now()) {
    sessions.delete(key)
    return null
  }
  // هر استفاده، مهلت را تازه می‌کند (بی‌کاری است که قفل می‌آورد، نه گذر زمان)
  e.expiresAt = Date.now() + ttlMs
  return e
}

/** آیا این پنل همین حالا در سمت سرور باز است؟ */
export function isPanelUnlocked(panel: string): boolean {
  return !!alive(MANAGER_KEY) || !!alive(normalizePanelKey(panel) ?? panel)
}

/**
 * گیت کانال‌های خواندنیِ حساس.
 *
 * اگر قفل این پنل در تنظیمات خاموش باشد، مثل بقیه‌ی جاهای پروژه آزاد است
 * (`isPanelLockEnabled`) — تا رفتار با سیاست قفل ماژول‌ها یکی بماند.
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
 * ===========================================================================
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۲ — نمای تشخیص پل تطبیق.
 *
 * unlike `assertPanelUnlocked` که «با خاموش بودن قفل» هم رد می‌شود، این نسخه
 * *همیشه* رمز تازه می‌خواهد (همان `assertPanelPasswordStrict`) و بعد نشست را
 * ثبت می‌کند، تا کانال‌های بعدیِ همان نما (`sources` / `notes`) بدون رمز
 * کار کنند. منظور از «انحصاری» این است: باز کردن نما هر بار رمز می‌خواهد،
 * حتی اگر قفل پنل خاموش باشد (بخش خواندنیِ حساس).
 *
 * ⚠️ به هیچ تابع موجود دست نخورده؛ TTL همان ttl این ماژول است (قابل‌کم‌شونده
 *    در تست با `applyPanelSessionTtlMs`).
 * ===========================================================================
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
