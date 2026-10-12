import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { prisma } from '../db/client'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import {
  SETTING_KEYS,
  DEFAULT_MANAGER_PASSWORD,
  LEGACY_DEFAULT_MANAGER_PASSWORDS,
  parseSecurityConfig,
  parseShiftConfig,
  findShiftSlot,
  shiftWindowLabel,
  type SecurityConfig,
  type ShiftConfig
} from '@shared/receipt'
import { openSecret, sealSecret, vaultReady } from './PanelVault'
import { toLatinDigits, faDigits, toJalaliDate, toClock } from '@shared/jalali'
import {
  ALWAYS_LOCKED_PANELS,
  LOCKED_PANELS,
  MANAGER_GATE,
  CREDIT_CODE_GATE,
  gateIdOf,
  gateTitle,
  isAlwaysLocked,
  isPanelLockEnabled,
  normalizePanelKey,
  openPanelCount,
  panelTitle,
  isManagerOnlyPanel,
  parsePanelLocks,
  type PanelLockConfig
} from '@shared/panels'
import { AuditAction } from '@shared/enums'
import type {
  PanelAuthState,
  PanelLockState,
  PanelUnlockResult,
  PanelGateStatus,
  PanelShiftAuthState,
  PanelPasswordReveal
} from '@shared/types'

/**
 * ---------------------------------------------------------------------------
 * رمز مدیریتی و «نشست مدیر».
 *
 * کاری که این سرویس می‌کند فقط *بررسی رمز* است. خودِ «نشست مدیر» (این‌که مدیر
 * پشت سیستم است یا کارمند) در renderer و در حافظه نگه داشته می‌شود، پس با هر
 * بار باز شدن برنامه پیش‌فرض «کارمند» است و همه‌ی پنل‌های ورود/تغییر موجودی
 * قفل‌اند — همان چیزی که در فروشگاه لازم است.
 *
 * رمز هرگز خام ذخیره نمی‌شود: scrypt با salt تصادفی روی جدول `Setting`
 * (کلید manager.auth) ذخیره می‌گردد. رمز اولیه ۱۱۱۱ است و بار اول که
 * استفاده شود همان‌جا هش و ذخیره می‌شود. تغییر رمز از داخل پنل تنظیمات انجام
 * می‌شود و در AuditLog هم ثبت می‌گردد (بدون ذخیره‌ی خود رمز).
 *
 * ⚠️ باگ رفع‌شده — «رمز پیش‌فرض عوض نشد»:
 *   عوض کردن `DEFAULT_MANAGER_PASSWORD` در کد، روی سیستمی که از قبل رمز
 *   پیش‌فرضِ *قدیمی* را در دیتابیس هش کرده بود هیچ اثری نداشت: تابع `matches`
 *   وقتی رکورد وجود داشت فقط با همان هش مقایسه می‌کرد، پس رمز قدیمی همچنان
 *   کار می‌کرد و رمز جدید رد می‌شد.
 *   الان `rotateDefault()` این حالت را می‌بیند و اصلاح می‌کند: *فقط* اگر رکورد
 *   ذخیره‌شده پرچم `isDefault: true` داشته باشد (یعنی کاربر هیچ‌وقت خودش رمز
 *   نگذاشته) و هشش با یکی از رمزهای پیش‌فرض قدیمی بخواند، همان لحظه به رمز
 *   پیش‌فرض جدید چرخانده می‌شود. رمزی که خود کاربر گذاشته باشد
 *   (`isDefault: false`) هیچ‌وقت لمس نمی‌شود و ریست نمی‌گردد.
 *
 * ارقام فارسی هم پذیرفته می‌شوند (۱۱۱۱ = 1111)، چون کاربر با
 * صفحه‌کلید فارسی تایپ می‌کند.
 * ---------------------------------------------------------------------------
 */
interface StoredAuth {
  salt: string
  hash: string
  /** رمز از حالت پیش‌فرض عوض شده است؟ (فقط برای نمایش راهنما در UI) */
  isDefault: boolean
  changedAt?: string
}

/** رمز ورودی کاربر → شکل استاندارد (ارقام لاتین، بدون فاصله‌ی اضافه). */
function normalize(raw: unknown): string {
  return toLatinDigits(String(raw ?? '')).trim()
}

function derive(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function build(password: string, isDefault: boolean): StoredAuth {
  const salt = randomBytes(16).toString('hex')
  return { salt, hash: derive(password, salt), isDefault, changedAt: new Date().toISOString() }
}

function parse(raw: string | null): StoredAuth | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj.salt === 'string' && typeof obj.hash === 'string')
      return { salt: obj.salt, hash: obj.hash, isDefault: !!obj.isDefault, changedAt: obj.changedAt }
  } catch {
    /* مقدار خراب = مثل نبودن رمز رفتار می‌کنیم تا کاربر با رمز پیش‌فرض قفل نشود */
  }
  return null
}

async function read(): Promise<StoredAuth | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.managerAuth } })
  return parse(row?.value ?? null)
}

async function save(record: StoredAuth): Promise<void> {
  const value = JSON.stringify(record)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.managerAuth },
    update: { value },
    create: { key: SETTING_KEYS.managerAuth, value }
  })
}

function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length || !bufA.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** آیا هشِ ذخیره‌شده با این رمز خام می‌خواند؟ */
function isPassword(stored: StoredAuth, password: string): boolean {
  return sameHash(stored.hash, derive(password, stored.salt))
}

/**
 * چرخاندن رکوردِ «هنوز پیش‌فرض» از رمز پیش‌فرض قدیمی به رمز پیش‌فرض جدید.
 *
 * شرط‌ها عمداً سخت‌گیرند تا هیچ رمزی که کاربر خودش گذاشته ریست نشود:
 *   ۱) رکورد باید `isDefault: true` باشد (یعنی هرگز از پنل تنظیمات عوض نشده)،
 *   ۲) و هشش باید *دقیقاً* با یکی از رمزهای پیش‌فرض قدیمی بخواند.
 * در غیر این صورت رکورد دست‌نخورده برمی‌گردد.
 */
async function rotateDefault(stored: StoredAuth): Promise<StoredAuth> {
  if (!stored.isDefault) return stored
  if (isPassword(stored, DEFAULT_MANAGER_PASSWORD)) return stored
  const legacy = LEGACY_DEFAULT_MANAGER_PASSWORDS.find((pw) => isPassword(stored, pw))
  if (!legacy) return stored

  const next = build(DEFAULT_MANAGER_PASSWORD, true)
  await save(next)
  try {
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      note: 'رمز پیش‌فرض مدیریتی به مقدار پیش‌فرض جدید به‌روز شد (رمز دست‌ساز کاربر لمس نمی‌شود)'
    })
  } catch (e) {
    // لاگ نشدن، نباید ورود مدیر را زمین بزند
    console.error('[auth] default password rotation audit failed', e)
  }
  return next
}

async function matches(password: string): Promise<boolean> {
  const first = await read()
  if (!first) {
    // اولین استفاده: رمز پیش‌فرض معتبر است و همان‌جا هش و ذخیره می‌شود
    if (password !== DEFAULT_MANAGER_PASSWORD) return false
    await save(build(DEFAULT_MANAGER_PASSWORD, true))
    return true
  }
  // مهاجرت رمز پیش‌فرض قدیمی → جدید (فقط اگر کاربر خودش رمز نگذاشته باشد)
  const stored = await rotateDefault(first)
  return isPassword(stored, password)
}

/**
 * ===========================================================================
 * «رمز دوم اختصاصی» هر پنل قفل‌دار.
 *
 * چرا لازم شد؟ فروشگاه یک حسابدار دارد که باید *فقط* «فاکتورهای فروش عمده» را
 * ببیند (پرداختی‌ها، اقساط، چک‌ها) و نباید رمز مدیر را بداند. همین منطق برای
 * بقیه‌ی پنل‌های قفل‌دار هم مفید است: انباردار فقط پنل کالاها، و ...
 *
 * قواعد ثابت:
 *   • رمز مدیر (اصلی) *همیشه و بی‌استثنا* همه‌ی قفل‌ها را باز می‌کند.
 *   • تا وقتی برای یک پنل رمز دوم تعریف/فعال نشده باشد، رفتار همان قبل است:
 *     فقط رمز مدیر بازش می‌کند.
 *   • ورود با رمز دوم «نشست مدیر» نمی‌سازد؛ فقط همان یک پنل باز می‌شود.
 *
 * ذخیره‌سازی: یک JSON روی کلید `panel.auth` جدول Setting، به شکل
 *   { "<کلید پنل>": { salt, hash, enabled, changedAt } }
 * رمزها مثل رمز مدیر با scrypt و salt تصادفی هش می‌شوند و هرگز خام ذخیره
 * نمی‌گردند.
 * ===========================================================================
 */
interface PanelAuthRecord {
  salt: string
  hash: string
  enabled: boolean
  changedAt?: string
  /**
   * مورد ۴ — نسخه‌ی رمزنگاری‌شده‌ی بازگشت‌پذیر (AES-256-GCM، کلید بیرون از
   * دیتابیس). فقط برای «نمایش دوباره‌ی رمز» در تنظیمات؛ تاییدِ ورود همیشه با
   * `hash` انجام می‌شود. رکوردهای قدیمی این فیلد را ندارند.
   */
  enc?: string
  /**
   * مورد ۷ — «رمز سوم» به تفکیک شیفت، کلید = شماره‌ی شیفت (۱-based، همان
   * ترتیب فهرست تنظیمات شیفت). نبودِ کلید = «تعریف‌نشده» (پیش‌فرض).
   */
  shifts?: Record<string, PanelShiftAuthRecord>
}

/** مورد ۷ — رمز سوم یک ترکیب «پنل × شیفت». ساختارش عیناً مثل رمز دوم است. */
interface PanelShiftAuthRecord {
  salt: string
  hash: string
  enabled: boolean
  changedAt?: string
  enc?: string
}

type PanelAuthMap = Record<string, PanelAuthRecord>

/**
 * مورد ۷ — چرا همان کلید `panel.auth`؟
 * چون هر «رمز سوم» عملاً یک زیرشاخه‌ی همان پنل است و با نگه‌داشتنش داخل همان
 * رکورد، حذف رمز دوم/پنل هیچ‌وقت داده‌ی سرگردان جا نمی‌گذارد و یک بار خواندن
 * Setting برای هر تصمیم کافی است. شکل نهایی:
 *   { "<کلید پنل>": { salt, hash, enc, enabled, changedAt,
 *                     shifts: { "1": { salt, hash, enc, enabled, changedAt } } } }
 * رکوردهای نسخه‌های قبل (بدون `shifts` و `enc`) بی‌هیچ مهاجرتی خوانده می‌شوند.
 */
function parseShiftRecords(raw: unknown): Record<string, PanelShiftAuthRecord> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, PanelShiftAuthRecord> = {}
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const num = Number(toLatinDigits(String(key)))
    if (!Number.isInteger(num) || num < 1) continue
    if (!value || typeof value.salt !== 'string' || typeof value.hash !== 'string') continue
    out[String(num)] = {
      salt: value.salt,
      hash: value.hash,
      enabled: value.enabled !== false,
      changedAt: typeof value.changedAt === 'string' ? value.changedAt : undefined,
      enc: typeof value.enc === 'string' ? value.enc : undefined
    }
  }
  return Object.keys(out).length ? out : undefined
}

function parsePanelMap(raw: string | null): PanelAuthMap {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}
    const out: PanelAuthMap = {}
    for (const [key, value] of Object.entries(obj as Record<string, any>)) {
      const panel = normalizePanelKey(key)
      if (!panel) continue
      if (value && typeof value.salt === 'string' && typeof value.hash === 'string') {
        out[panel] = {
          salt: value.salt,
          hash: value.hash,
          enabled: value.enabled !== false,
          changedAt: typeof value.changedAt === 'string' ? value.changedAt : undefined,
          enc: typeof value.enc === 'string' ? value.enc : undefined,
          shifts: parseShiftRecords(value.shifts)
        }
      }
    }
    return out
  } catch {
    /* مقدار خراب = مثل «هیچ رمز دومی تعریف نشده» رفتار می‌کنیم تا مدیر قفل نشود */
    return {}
  }
}

async function readPanels(): Promise<PanelAuthMap> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.panelAuth } })
  return parsePanelMap(row?.value ?? null)
}

async function savePanels(map: PanelAuthMap): Promise<void> {
  const value = JSON.stringify(map)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.panelAuth },
    update: { value },
    create: { key: SETTING_KEYS.panelAuth, value }
  })
}

/** آیا رمز دومِ فعالِ این پنل با رمز واردشده می‌خواند؟ */
function panelMatches(record: PanelAuthRecord | undefined, password: string): boolean {
  if (!record || record.enabled === false) return false
  return sameHash(record.hash, derive(password, record.salt))
}


/**
 * ===========================================================================
 * مورد ۷ — «شیفت جاری» از نگاه رمز سوم.
 *
 * ترتیب تشخیص عمدی است:
 *   ۱) اگر همین حالا یک شیفتِ *باز* در دیتابیس هست، شماره‌ی همان ملاک است
 *      (چون فروشنده واقعاً داخل همان شیفت کار می‌کند، حتی اگر ساعتش کشیده باشد).
 *   ۲) وگرنه شیفتی که ساعت جاری داخل بازه‌اش می‌افتد (`findShiftSlot`).
 *   ۳) وگرنه هیچ ⇒ هیچ رمز سومی کار نمی‌کند و رفتار همان قبل است (فقط رمز
 *      مدیر / رمز دوم). این جهتِ خطا عمدی است: نبودِ شیفت نباید قفل را باز کند.
 * ===========================================================================
 */
async function readShiftConfig(): Promise<ShiftConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.shiftConfig } })
    return parseShiftConfig(row?.value ?? null)
  } catch {
    return parseShiftConfig(null)
  }
}

async function currentShiftNumber(cfg: ShiftConfig): Promise<number | null> {
  try {
    const open = await prisma.shift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } })
    if (open?.number && open.number >= 1) return open.number
  } catch (e) {
    console.error('[auth] open shift lookup failed', e)
  }
  const slot = findShiftSlot(cfg, new Date())
  return slot?.number ?? null
}

/**
 * ===========================================================================
 * بند ۱ — «قفل ماژول‌ها» (مدیریت ماژولارِ قفل رمز دوم)
 *
 * تا این نسخه، هر پنلی که در `LOCKED_PANELS` بود همیشه قفل بود. حالا مدیر
 * می‌تواند برای هر ماژول جداگانه قفل را بردارد. قواعد کامل بالای
 * `src/shared/panels.ts` است؛ چیزی که *اینجا* تضمین می‌شود:
 *
 *   • خواندن (`panelLocks`) هیچ رمزی نمی‌خواهد، چون هر `ManagerGate` در لحظه‌ی
 *     رندر لازمش دارد و اگر رمز می‌خواست، مرغ و تخم‌مرغ می‌شد.
 *   • نوشتن (`setPanelLocks`) **رمز مدیر** می‌خواهد — نه رمز دوم پنل تنظیمات.
 *     وگرنه کارمندی که رمز دوم «تنظیمات» را دارد می‌توانست قفل همه‌ی پنل‌ها را
 *     بردارد و عملاً رمز مدیر را دور بزند.
 *   • هر خطای خواندن یا مقدار خراب ⇒ «همه‌چیز قفل». جهت خطا عمدی است: نبود
 *     تنظیمات هیچ‌وقت نباید به «قفل باز» ترجمه شود.
 *   • `ALWAYS_LOCKED_PANELS` (فعلاً فقط خودِ «تنظیمات») حتی با درخواست صریح هم
 *     باز نمی‌شود؛ `parsePanelLocks` آن را نادیده می‌گیرد و اینجا هم دوباره
 *     بررسی می‌شود (دو لایه، عمداً).
 * ===========================================================================
 */
export async function readPanelLocks(): Promise<PanelLockConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.panelLocks } })
    return parsePanelLocks(row?.value ?? null)
  } catch (e) {
    // نبودن/خرابیِ تنظیمات = «همه‌چیز قفل» (جهت ایمن)
    console.error('[auth] panel locks read failed', e)
    return parsePanelLocks(null)
  }
}

async function savePanelLocks(map: PanelLockConfig): Promise<void> {
  const value = JSON.stringify(map)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.panelLocks },
    update: { value },
    create: { key: SETTING_KEYS.panelLocks, value }
  })
}

/**
 * ===========================================================================
 * «قفل موقت بعد از ورود رمز اشتباه» (بخش ۲)
 *
 * قبل از این نسخه، هیچ شمارش تلاش ناموفق یا قفل موقتی در این سرویس نبود: رمز
 * اشتباه فقط یک پیام خطا می‌گرفت و کاربر می‌توانست بی‌نهایت بار تلاش کند.
 *
 * رفتار جدید:
 *   • هر «نقطه‌ی ورود رمز» یک گیت مستقل است: `__manager__` برای صفحه‌ی رمز مدیر
 *     و کلید هر پنل قفل‌دار برای خودش. رمز اشتباه روی پنل کالاها، بستن صندوق را
 *     قفل نمی‌کند.
 *   • `maxAttempts` رمز اشتباهِ *پشت‌سرهم* (پیش‌فرض ۳) ⇒ همان گیت `lockMinutes`
 *     دقیقه (پیش‌فرض ۱۰) قفل می‌شود و تا پایان آن مدت **حتی رمز درست هم پذیرفته
 *     نمی‌شود**، با یک پیام فارسی روشن.
 *   • شمارنده و لحظه‌ی پایان قفل روی جدول `AuthLockout` دیتابیس ذخیره می‌شوند،
 *     نه در حافظه‌ی برنامه؛ پس بستن و باز کردن برنامه قفل را دور نمی‌زند.
 *   • اولین ورود *موفق* شمارنده را صفر می‌کند.
 *   • مدت قفل و تعداد تلاش از «تنظیمات → رمز و امنیت» قابل تغییرند (کلید
 *     `security.config`) و آن پنل خودش با رمز مدیر قفل است.
 *   • `lockoutEnabled: false` در تنظیمات = رفتار مو‌به‌موی نسخه‌های قبل.
 *
 * ⚠️ این قفل فقط روی «باز کردن» گیت‌ها است، نه روی تغییر رمز از داخل پنل
 * تنظیمات (`changePassword` / `setPanelPassword`): آن دو وقتی صدا زده می‌شوند
 * که کاربر از قبل پشت یک گیتِ بازِ مدیر است و هیچ دسترسی جدیدی باز نمی‌کنند.
 * ===========================================================================
 */

async function securityConfig(): Promise<SecurityConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.securityConfig } })
    return parseSecurityConfig(row?.value ?? null)
  } catch {
    // نبودن/خرابیِ تنظیمات نباید ورود را زمین بزند
    return parseSecurityConfig(null)
  }
}

interface LockoutState {
  failCount: number
  lockedUntil: Date | null
  remainingMs: number
}

const EMPTY_LOCK: LockoutState = { failCount: 0, lockedUntil: null, remainingMs: 0 }

/**
 * همه‌ی درخواست‌های احراز هویت Electron در همین main process اجرا می‌شوند. صف
 * کوتاهِ هر گیت، کل توالی «دیدن قفل → سنجش رمز/کد → ثبت موفق یا شکست» را
 * سری می‌کند؛ بنابراین ۴۰ IPC هم‌زمان نمی‌توانند همگی failCount=0 را بخوانند
 * و یکدیگر را overwrite کنند. Map فقط promiseهای درحال اجرا را نگه می‌دارد.
 */
const gateAttemptQueues = new Map<string, Promise<void>>()
async function withGateAttempt<T>(gate: string, task: () => Promise<T>): Promise<T> {
  const previous = gateAttemptQueues.get(gate) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  gateAttemptQueues.set(gate, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (gateAttemptQueues.get(gate) === queued) gateAttemptQueues.delete(gate)
  }
}

/** وضعیت خام یک گیت. هر خطای دیتابیسی = «قفل نیست» تا کاربر بیرون نماند. */
async function readLock(gate: string): Promise<LockoutState> {
  try {
    const row = await prisma.authLockout.findUnique({ where: { gate } })
    if (!row) return { ...EMPTY_LOCK }
    const until = row.lockedUntil ? new Date(row.lockedUntil) : null
    const remaining = until ? until.getTime() - Date.now() : 0
    return { failCount: row.failCount ?? 0, lockedUntil: until, remainingMs: Math.max(0, remaining) }
  } catch (e) {
    console.error('[auth] lockout read failed', e)
    return { ...EMPTY_LOCK }
  }
}

async function writeLock(
  gate: string,
  data: { failCount: number; lastFailAt?: Date | null; lockedUntil?: Date | null; bumpLockCount?: boolean }
): Promise<void> {
  try {
    await prisma.authLockout.upsert({
      where: { gate },
      update: {
        failCount: data.failCount,
        lastFailAt: data.lastFailAt ?? null,
        lockedUntil: data.lockedUntil ?? null,
        ...(data.bumpLockCount ? { lockCount: { increment: 1 } } : {})
      },
      create: {
        gate,
        failCount: data.failCount,
        lastFailAt: data.lastFailAt ?? null,
        lockedUntil: data.lockedUntil ?? null,
        lockCount: data.bumpLockCount ? 1 : 0
      }
    })
  } catch (e) {
    console.error('[auth] lockout write failed', e)
  }
}

/** «۱۰ دقیقه» / «۴۵ ثانیه» — متن فارسی مدت باقی‌مانده. */
function describeRemaining(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 60) return `${faDigits(seconds)} ثانیه`
  const minutes = Math.ceil(seconds / 60)
  return `${faDigits(minutes)} دقیقه`
}

/** پیام فارسی «این گیت قفل است». */
function lockedMessage(gate: string, remainingMs: number, lockedUntil: Date | null): string {
  const where =
    gate === MANAGER_GATE
      ? 'ورود رمز مدیر'
      : gate === CREDIT_CODE_GATE
        ? 'ورود کد اعتبار خرید'
        : `پنل «${panelTitle(gate)}»`
  return (
    `به‌دلیل ورود رمز اشتباه، تا ${describeRemaining(remainingMs)} دیگر امکان ورود رمز وجود ندارد.\n` +
    `این قفل مخصوص ${where} است و حتی رمز درست هم تا پایان این مدت پذیرفته نمی‌شود.` +
    (lockedUntil
      ? `\nپایان قفل: ${faDigits(toJalaliDate(lockedUntil))} ساعت ${faDigits(toClock(lockedUntil))}`
      : '')
  )
}

/**
 * اگر گیت قفل است، همین‌جا با پیام فارسی متوقف می‌شود.
 * قفلِ *منقضی‌شده* همین‌جا پاک می‌گردد (شمارنده هم صفر می‌شود تا کاربر دوباره از
 * صفر فرصت داشته باشد).
 */
async function assertGateOpen(gate: string): Promise<void> {
  const cfg = await securityConfig()
  if (!cfg.lockoutEnabled) return
  const state = await readLock(gate)
  if (!state.lockedUntil) return
  if (state.remainingMs > 0) throw new BusinessError(lockedMessage(gate, state.remainingMs, state.lockedUntil))
  await writeLock(gate, { failCount: 0, lastFailAt: null, lockedUntil: null })
}

/**
 * ثبت یک رمز اشتباه روی یک گیت.
 * خروجی، *پیام نهاییِ* خطاست: یا «چند تلاش دیگر مانده»، یا «قفل شد».
 */
async function noteFailure(gate: string, fallbackMessage: string): Promise<string> {
  const cfg = await securityConfig()
  if (!cfg.lockoutEnabled) return fallbackMessage

  const state = await readLock(gate)
  // دفاع دوم: حتی اگر یک caller قدیمی خارج از صف به این تابع برسد، یک قفل
  // فعال نباید با failCount=0 دوباره به «تلاش اول» تبدیل و باز شود.
  if (state.lockedUntil && state.remainingMs > 0) return lockedMessage(gate, state.remainingMs, state.lockedUntil)
  const failCount = (state.failCount ?? 0) + 1
  const now = new Date()

  if (failCount >= cfg.maxAttempts) {
    const lockedUntil = new Date(now.getTime() + cfg.lockMinutes * 60_000)
    // شمارنده صفر می‌شود چون «دوره» تمام شد؛ از این به بعد خودِ قفل جلوی ورود را می‌گیرد
    await writeLock(gate, { failCount: 0, lastFailAt: now, lockedUntil, bumpLockCount: true })
    await audit(prisma, {
      action: AuditAction.AUTH_LOCKOUT,
      entity: 'AuthLockout',
      note:
        `${gateTitle(gate)}: ${faDigits(cfg.maxAttempts)} رمز اشتباه پشت‌سرهم ⇒ ورود رمز تا ` +
        `${faDigits(toClock(lockedUntil))} (${faDigits(cfg.lockMinutes)} دقیقه) قفل شد`
    }).catch(() => undefined)
    return (
      `رمز اشتباه بود و ${faDigits(cfg.maxAttempts)} بار پشت‌سرهم اشتباه وارد شده است.\n` +
      lockedMessage(gate, cfg.lockMinutes * 60_000, lockedUntil)
    )
  }

  await writeLock(gate, { failCount, lastFailAt: now, lockedUntil: null })
  const left = cfg.maxAttempts - failCount
  return (
    `${fallbackMessage}\n` +
    `${faDigits(left)} تلاش دیگر باقی مانده است؛ بعد از آن ورود رمز برای ` +
    `${faDigits(cfg.lockMinutes)} دقیقه قفل می‌شود.`
  )
}

/** ورود موفق ⇒ شمارنده و قفل همان گیت پاک می‌شود. */
async function noteSuccess(gate: string): Promise<void> {
  const state = await readLock(gate)
  if (!state.failCount && !state.lockedUntil) return
  await writeLock(gate, { failCount: 0, lastFailAt: null, lockedUntil: null })
}

/**
 * ===========================================================================
 * جلسه ۱۴ — «گیت مدیر» در سطحِ **سرویس**، نه UI.
 *
 * چرا اینجا و نه فقط با کامپوننت `ManagerGate`؟ چون آن کامپوننت یک قفل
 * *نمایشی* است: یک صفحه/تب را پشت رمز می‌برد. کارهایی که بند ۱۸ و بند ۱۷ سند
 * مرجع می‌خواهند از جنس دیگری‌اند — «این *عملیات* بدون تایید مدیر انجام نشود».
 * اگر فقط UI را قفل می‌کردیم، هر تماس IPC (حتی از یک پنل باز) می‌توانست دورش
 * بزند. پس تصمیم مدیر باید همان‌جایی بررسی شود که رکورد نوشته می‌شود.
 *
 * ⚠️ `assertGateOpen` / `noteFailure` همان مسیر قفلِ موقتِ بخش ۲ است، پس تلاش
 * پشت‌سرهم روی این گیت هم مثل بقیه‌ی گیت‌ها قفل می‌شود و در AuditLog می‌نشیند.
 * ===========================================================================
 */
export async function assertManagerPassword(password: string | null | undefined, action: string): Promise<void> {
  // RE-AUDIT-HIGH-02: این باید دقیقاً همان گیت authService.verify باشد؛ نام
  // قدیمیِ 'manager' یک شمارنده‌ی جدا می‌ساخت و قفل __manager__ را دور می‌زد.
  const gate = MANAGER_GATE
  return withGateAttempt(gate, async () => {
    await assertGateOpen(gate)
    const pass = normalize(password)
    if (!pass) throw new BusinessError(`«${action}» تایید مدیر لازم دارد. رمز مدیر را وارد کنید.`)
    if (!(await matches(pass))) {
      const message = await noteFailure(gate, 'رمز مدیر درست نیست.')
      throw new BusinessError(message)
    }
    await noteSuccess(gate)
  })
}

/**
 * ---------------------------------------------------------------------------
 * «تأیید شخصی مدیر برای اصلاح دیرهنگام».
 *
 * رمز سراسری مدیر فقط ثابت می‌کند که کسی رمز مجموعه را می‌داند؛ برای ابطال یا
 * اصلاحی که پس از روز عملیاتی ثبت می‌شود کافی نیست، چون بعداً معلوم نمی‌شود
 * کدام مدیر آن را پذیرفته است. مدیرِ ثبت‌شده‌ی فعال یک PIN/رمز شخصی و هش‌شده
 * دارد و شناسه‌ی او همراه اثر جبرانی ذخیره می‌شود.
 *
 * عمداً همان ستون قدیمی `User.passwordHash` استفاده می‌شود: این سامانه login
 * کارکنان ندارد و آن ستون تا امروز برای کارکنان خالی بوده است. envelope با
 * `purpose` صریح جلوی تعبیرکردن داده‌ی قدیمی یا هر هشِ نامرتبط را می‌گیرد.
 * ---------------------------------------------------------------------------
 */
interface ManagerCorrectionApprovalSecret {
  purpose: 'MANAGER_RETURN_CORRECTION'
  salt: string
  hash: string
  changedAt: string
}

function parseManagerCorrectionApprovalSecret(raw: string | null | undefined): ManagerCorrectionApprovalSecret | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    if (
      value?.purpose === 'MANAGER_RETURN_CORRECTION' &&
      typeof value.salt === 'string' &&
      typeof value.hash === 'string' &&
      typeof value.changedAt === 'string'
    )
      return value as ManagerCorrectionApprovalSecret
  } catch {
    // یک مقدار legacy یا خراب هرگز «رمز شخصی معتبر» شمرده نمی‌شود.
  }
  return null
}

export function hasManagerCorrectionApprovalSecret(raw: string | null | undefined): boolean {
  return parseManagerCorrectionApprovalSecret(raw) != null
}

/**
 * رمز خام را فقط به envelope هش‌شده تبدیل می‌کند. اعتبار مدیرِ هدف و نوشتن DB
 * جداست تا یک transaction فراخواننده بتواند تغییر User، راز و Audit را واقعاً
 * all-or-nothing نگه دارد.
 */
export function createManagerCorrectionApprovalSecret(passwordInput: string | null | undefined): string {
  const password = normalize(passwordInput)
  if (password.length < 4)
    throw new BusinessError('رمز شخصی مدیر برای تأیید اصلاح باید دست‌کم ۴ نویسه باشد.')
  const salt = randomBytes(16).toString('hex')
  const secret: ManagerCorrectionApprovalSecret = {
    purpose: 'MANAGER_RETURN_CORRECTION',
    salt,
    hash: derive(password, salt),
    changedAt: new Date().toISOString()
  }
  return JSON.stringify(secret)
}

/** فقط از مسیر محافظت‌شده‌ی تنظیمات کارکنان صدا زده می‌شود؛ رمز خام هرگز Audit نمی‌شود. */
export async function setManagerCorrectionApprovalPassword(input: {
  userId: number
  password: string | null | undefined
  actorUserId?: number | null
}): Promise<void> {
  const userId = Math.round(Number(input.userId))
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new BusinessError('مدیر تأییدکننده نامعتبر است.')
  const secret = createManagerCorrectionApprovalSecret(input.password)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, displayName: true } })
  if (!user || user.role !== 'MANAGER' || !user.isActive)
    throw new BusinessError('رمز شخصی تأیید فقط برای مدیر فعال قابل ثبت است.')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: secret } })
  await audit(prisma, {
    action: AuditAction.SETTINGS_UPDATE,
    entity: 'User',
    entityId: user.id,
    userId: input.actorUserId ?? null,
    after: JSON.stringify({ managerCorrectionApprovalConfigured: true }),
    note: `رمز شخصی تأیید اصلاح دیرهنگام برای مدیر «${user.displayName}» تنظیم/تعویض شد (خود رمز ذخیره یا نمایش داده نمی‌شود).`
  })
}

/**
 * اعتبارسنجی هویت *یک مدیر مشخص*، بیرون از تراکنش. خروجی عمداً فقط شناسه/نام
 * امن است تا در Audit اثر اصلاح به همان شخص وصل شود.
 */
export async function verifyManagerCorrectionApproval(input: {
  managerUserId?: number | null
  password?: string | null
  action: string
}): Promise<{ userId: number; displayName: string }> {
  const userId = Math.round(Number(input.managerUserId ?? 0))
  if (!Number.isSafeInteger(userId) || userId <= 0)
    throw new BusinessError(`«${input.action}» باید با انتخاب مدیر تأییدکننده و رمز شخصی همان مدیر ثبت شود.`)
  const gate = `manager-correction:${userId}`
  return withGateAttempt(gate, async () => {
    await assertGateOpen(gate)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, role: true, isActive: true, passwordHash: true }
    })
    if (!user || user.role !== 'MANAGER' || !user.isActive)
      throw new BusinessError('مدیر تأییدکننده انتخاب‌شده فعال یا مجاز نیست.')
    const secret = parseManagerCorrectionApprovalSecret(user.passwordHash)
    if (!secret)
      throw new BusinessError(
        `برای مدیر «${user.displayName}» هنوز رمز شخصی تأیید اصلاح تعریف نشده است. ` +
          'از تنظیمات ← کارکنان، مدیر را ویرایش و «رمز شخصی تأیید اصلاح دیرهنگام» را ثبت کنید.'
      )
    const password = normalize(input.password)
    if (!password || !sameHash(secret.hash, derive(password, secret.salt))) {
      const message = await noteFailure(gate, 'رمز شخصی مدیر تأییدکننده درست نیست.')
      throw new BusinessError(message)
    }
    await noteSuccess(gate)
    return { userId: user.id, displayName: user.displayName }
  })
}

/**
 * ===========================================================================
 * جلسه ۴۰ · کار ب — «تأیید مدیر برای *عملیاتِ* یک پنل قفل‌دار»، سمت سرور.
 *
 * چرا لازم شد: از این نسخه `cardTransfer:pay` **موجودی انبار را عوض می‌کند**
 * (کالای معلق برگشتی را به موجودی قابل‌فروش برمی‌گرداند). قفلِ رندرر
 * (`<ManagerGate panel={PANEL_KEYS.cardTransfers}>`) برای یک عملیات انباری
 * کافی نیست: هر تماس IPC می‌توانست دورش بزند.
 *
 * چرا مکانیزم جدید ساخته نشد: `verifyPanel` از قبل دقیقاً همان چیزی است که
 * خواسته شده — رمز مدیر، رمز دوم اختصاصی همان پنل، رمز سوم شیفت، قفل موقت پس
 * از رمز اشتباه، و سیاست «قفل ماژول‌ها». پس این تابع فقط همان را با یک پیام
 * فارسیِ روشن‌تر بسته‌بندی می‌کند و خروجی `scope` را برمی‌گرداند تا صدازننده
 * بتواند در AuditLog بنویسد که با کدام رمز تأیید شده است.
 *
 * ⚠️ مثل `assertManagerPassword`، این تابع **هیچ‌وقت داخل `$transaction` باز**
 * صدا زده نمی‌شود: `readLock/writeLock` با کلاینت سراسری می‌نویسند و SQLite
 * تک‌نویسنده است. نقطه‌ی درست، *قبل* از باز کردن تراکنش است.
 *
 * ⚠️ اگر مدیر قفل همین ماژول را در «تنظیمات → قفل ماژول‌ها» خاموش کرده باشد،
 * `verifyPanel` بدون رمز `scope: 'OPEN'` می‌دهد. این عمدی است و همان سیاست
 * موجود پروژه است؛ اینجا سیاست تازه‌ای اختراع نمی‌شود.
 * ===========================================================================
 */
export async function assertPanelPassword(
  panel: string,
  password: string | null | undefined,
  action: string
): Promise<'MANAGER' | 'PANEL' | 'OPEN'> {
  const pass = normalize(password)
  if (!pass) {
    // قفل خاموش ⇒ همان مسیر `verifyPanel` بدون رمز (سیاست قفل ماژول‌ها)
    if (!isPanelLockEnabled(await readPanelLocks(), normalizePanelKey(panel) ?? panel))
      return 'OPEN'
    throw new BusinessError(
      `«${action}» تأیید مدیر لازم دارد. رمز مدیر (یا رمز دوم همین پنل) را وارد کنید.`
    )
  }
  const res = await authService.verifyPanel({ panel, password: pass })
  return res.scope
}

/**
 * ===========================================================================
 * 🔴 نشست ۱۸۴ · بند ۴-۲۹ — گیتِ «همیشه رمز می‌خواهد»
 * ---------------------------------------------------------------------------
 * `assertPanelPassword` بالا یک در پشتی دارد که عمدی و درست است، ولی برای
 * *همه‌ی* عملیات مناسب نیست: اگر مدیر قفل آن ماژول را در تنظیمات خاموش کرده
 * باشد، **بدون هیچ رمزی** `'OPEN'` برمی‌گرداند.
 *
 * برای باز کردن یک صفحه این منطقی است. برای عملیاتی که **پول می‌سازد یا پول
 * را نابود می‌کند** فاجعه است:
 *
 *   قفل ماژول اعتبار خاموش ⇒ فروشنده بدون هیچ رمزی یک کد اعتبار ۱٬۰۰۰٬۰۰۰
 *   ریالی برای خودش صادر می‌کند. این دقیقاً همان مسیری است که بند ۴-۲۹ برای
 *   بستنش نوشته شده.
 *
 * این تابع همان اولویت آشنا را نگه می‌دارد (رمز مدیر > رمز دوم پنل > رمز سوم
 * پنل×شیفت) ولی مسیر «بدون رمز» را می‌بندد. یعنی خواسته‌ی مالک — که فرد مورد
 * اعتماد بتواند با رمز دوم/سوم کار کند — دست‌نخورده می‌ماند، و در عین حال
 * هیچ‌وقت نمی‌شود با خاموش کردن یک سوییچ، گیت پول را دور زد.
 *
 * ⚠️ قاعده‌ی انتخاب: هر جا خروجی عملیات «پول قابل خرج» یا «حذف بدهی» است،
 * این تابع؛ هر جا فقط «دیدن یک صفحه» است، تابع بالا.
 * ===========================================================================
 */
export async function assertPanelPasswordStrict(
  panel: string,
  password: string | null | undefined,
  action: string
): Promise<'MANAGER' | 'PANEL'> {
  const pass = normalize(password)
  if (!pass)
    throw new BusinessError(
      `«${action}» همیشه رمز می‌خواهد، حتی اگر قفل این ماژول خاموش باشد. ` +
        'رمز مدیر (یا رمز دوم/سوم همین پنل) را وارد کنید.'
    )
  const res = await authService.verifyPanel({ panel, password: pass, force: true })
  if (res.scope === 'OPEN')
    throw new BusinessError(`«${action}» همیشه رمز می‌خواهد. رمز واردشده پذیرفته نشد.`)
  return res.scope
}

/**
 * ===========================================================================
 * جلسه ۲۰ · §۸ — «قفل موقت» برای ورود کد اعتبار خرید.
 *
 * حدس‌زدن کد اعتبار همان حمله‌ی brute-force است، پس سیستم Rate Limit جدیدی
 * ساخته نشد: این سه تابع دقیقاً همان `assertGateOpen` / `noteFailure` /
 * `noteSuccess` بالا را روی گیت مستقل `CREDIT_CODE_GATE` صدا می‌زنند — همان
 * جدول `AuthLockout`، همان `securityConfig` (تعداد تلاش مجاز + دقیقه‌ی قفل) و
 * همان ثبت `AUTH_LOCKOUT` در AuditLog.
 *
 * ⚠️ قاعده‌ی مهم: این توابع **هیچ‌وقت داخل یک `$transaction` باز** صدا زده
 * نمی‌شوند. `readLock/writeLock` با کلاینت سراسری `prisma` می‌نویسند و SQLite
 * تک‌نویسنده است؛ نوشتن روی یک اتصال دیگر وسط تراکنشِ باز همان بن‌بستی است که
 * AuditService بالای فایلش توضیح داده. پس نقطه‌ی اعمال قفل، مسیر *جست‌وجوی* کد
 * است (دکمه‌ی «بررسی» پنل فروش و IPC مصرف، قبل از باز کردن تراکنش) — که همان
 * سطح حمله‌ی واقعی هم هست.
 * ===========================================================================
 */
/** StoreCreditService کل lookup و ثبت نتیجه را در این صف واحد نگه می‌دارد. */
export function withCreditCodeGateAttempt<T>(task: () => Promise<T>): Promise<T> {
  return withGateAttempt(CREDIT_CODE_GATE, task)
}

export async function assertCreditCodeGateOpen(): Promise<void> {
  await assertGateOpen(CREDIT_CODE_GATE)
}

/** یک کد اعتبارِ اشتباه/ناموجود ⇒ پیام نهاییِ فارسی (با شمارش تلاش باقی‌مانده). */
export async function noteCreditCodeFailure(fallbackMessage: string): Promise<string> {
  return noteFailure(CREDIT_CODE_GATE, fallbackMessage)
}

/** کد درست ⇒ شمارنده‌ی همین گیت صفر می‌شود. */
export async function noteCreditCodeSuccess(): Promise<void> {
  await noteSuccess(CREDIT_CODE_GATE)
}

export const authService = {
  /** آیا رمز هنوز همان رمز پیش‌فرض است (برای نمایش راهنما در پنل تنظیمات). */
  async info(): Promise<{ isDefault: boolean; changedAtIso: string | null }> {
    const first = await read()
    if (!first) return { isDefault: true, changedAtIso: null }
    // اگر رکورد، رمز پیش‌فرض قدیمی است همین‌جا هم به‌روز می‌شود تا کاربر برای
    // اصلاح شدنش لازم نباشد اول یک بار رمز اشتباه بزند.
    const stored = await rotateDefault(first)
    return { isDefault: stored.isDefault, changedAtIso: stored.changedAt ?? null }
  },

  /**
   * بررسی رمز مدیریتی. خروجی true = شروع «نشست مدیر».
   * پیام خطا عمداً کوتاه و بدون جزئیات است.
   */
  async verify(input: { password?: string } = {}): Promise<{ ok: true; isDefault: boolean }> {
    // RE-AUDIT-HIGH-01: assert/read/match/note یک تلاش اتمیکِ درون main است.
    return withGateAttempt(MANAGER_GATE, async () => {
      await assertGateOpen(MANAGER_GATE)
      const password = normalize(input.password)
      if (!password) throw new BusinessError('رمز مدیریتی را وارد کنید.')
      if (!(await matches(password)))
        throw new BusinessError(await noteFailure(MANAGER_GATE, 'رمز مدیریتی درست نیست؛ دوباره تلاش کنید.'))
      await noteSuccess(MANAGER_GATE)
      const stored = await read()
      return { ok: true, isDefault: stored?.isDefault ?? true }
    })
  },

  /**
   * -------------------------------------------------------------------------
   * وضعیت «قفل موقت» یک گیت (بخش ۲) — برای نمایش شمارش معکوس در صفحه‌ی ورود رمز.
   * هیچ رمزی نمی‌گیرد و هیچ چیزی را عوض نمی‌کند؛ فقط می‌گوید «قفل است یا نه».
   * -------------------------------------------------------------------------
   */
  async gateStatus(input: { panel?: string | null } = {}): Promise<PanelGateStatus> {
    const gate = gateIdOf(input?.panel)
    const cfg = await securityConfig()
    const state = await readLock(gate)
    const locked = cfg.lockoutEnabled && !!state.lockedUntil && state.remainingMs > 0
    return {
      gate,
      gateTitle: gateTitle(gate),
      locked,
      remainingSeconds: locked ? Math.ceil(state.remainingMs / 1000) : 0,
      lockedUntilIso: locked && state.lockedUntil ? state.lockedUntil.toISOString() : null,
      failCount: state.failCount ?? 0,
      maxAttempts: cfg.maxAttempts,
      lockMinutes: cfg.lockMinutes,
      enabled: cfg.lockoutEnabled
    }
  },

  /**
   * -------------------------------------------------------------------------
   * وضعیت رمز دوم همه‌ی پنل‌های قفل‌دار (برای پنل «تنظیمات رمز»).
   * هیچ اطلاعاتی از خودِ رمزها برنمی‌گرداند؛ فقط «تعریف شده یا نه».
   * -------------------------------------------------------------------------
   */
  async panelInfo(): Promise<PanelAuthState[]> {
    const [map, locks, cfg] = await Promise.all([readPanels(), readPanelLocks(), readShiftConfig()])
    const current = await currentShiftNumber(cfg)
    const templates = cfg.templates ?? []
    return LOCKED_PANELS.map((panel) => {
      const rec = map[panel.key]
      // مورد ۷ — همه‌ی شیفت‌های تعریف‌شده می‌آیند (حتی بدون رمز سوم) تا جدول
      // تنظیمات چیزی جا نیندازد؛ پیش‌فرض هر ترکیب «تعریف‌نشده» است.
      const shifts: PanelShiftAuthState[] = templates.map((t, idx) => {
        const num = idx + 1
        const sh = rec?.shifts?.[String(num)]
        return {
          number: num,
          name: t.name || 'شیفت ' + num,
          windowLabel: shiftWindowLabel(t),
          enabled: !!sh && sh.enabled !== false,
          changedAtIso: sh?.changedAt ?? null,
          recoverable: !!sh?.enc && vaultReady(),
          isCurrent: current === num
        }
      })
      return {
        key: panel.key,
        title: panel.title,
        enabled: !!rec && rec.enabled !== false,
        changedAtIso: rec?.changedAt ?? null,
        // بند ۱: قفل این ماژول روشن است؟ (و آیا اصلاً قابل خاموش کردن است؟)
        lockEnabled: isPanelLockEnabled(locks, panel.key),
        alwaysLocked: isAlwaysLocked(panel.key),
        // مورد ۴: رمزهای ثبت‌شده‌ی قبل از این نسخه فقط هش دارند ⇒ غیرقابل نمایش
        recoverable: !!rec?.enc && vaultReady(),
        shifts
      }
    })
  },

  /**
   * -------------------------------------------------------------------------
   * بند ۱ — خواندن سیاست «قفل ماژول‌ها».
   * بدون رمز، چون هر گیت در لحظه‌ی رندر لازمش دارد. هیچ اطلاعات حساسی هم
   * برنمی‌گرداند: فقط می‌گوید «کدام ماژول قفل دارد».
   * -------------------------------------------------------------------------
   */
  async panelLocks(): Promise<PanelLockState> {
    const locks = await readPanelLocks()
    return {
      locks,
      openCount: openPanelCount(locks),
      alwaysLocked: [...ALWAYS_LOCKED_PANELS]
    }
  },

  /**
   * -------------------------------------------------------------------------
   * بند ۱ — روشن/خاموش کردن قفل یک یا چند ماژول. **رمز مدیر لازم است.**
   *
   * ورودی `locks` یک نقشه‌ی جزئی است (`{ 'sales-reports': false }`)، پس صفحه‌ی
   * تنظیمات می‌تواند فقط همان یک سوییچی که کاربر زد را بفرستد و بقیه دست‌نخورده
   * بمانند. کلید ناشناس نادیده گرفته می‌شود و پنل‌های `ALWAYS_LOCKED` هرگز باز
   * نمی‌شوند (با یک پیام روشن، نه سکوت).
   * -------------------------------------------------------------------------
   */
  async setPanelLocks(input: { managerPassword?: string; locks?: Record<string, unknown>; userId?: number | null } = {}) {
    /**
     * SET-002 — این مسیر قبلاً مستقیم `matches()` را صدا می‌زد؛ بنابراین رمز
     * اشتباه نه در AuthLockout شمرده می‌شد و نه قفل موقتِ مدیر را رعایت می‌کرد.
     * همه‌ی تاییدهای رمز مدیر باید از گیت مشترک عبور کنند.
     */
    await assertManagerPassword(normalize(input.managerPassword), 'تغییر قفل ماژول‌ها')

    const before = await readPanelLocks()
    const next: PanelLockConfig = { ...before }
    const changed: string[] = []
    const refused: string[] = []

    for (const [rawKey, rawValue] of Object.entries(input.locks ?? {})) {
      const panel = normalizePanelKey(rawKey)
      if (!panel) continue
      const wanted = rawValue !== false
      if (!wanted && isAlwaysLocked(panel)) {
        refused.push(panelTitle(panel))
        continue
      }
      if (next[panel] !== wanted) {
        next[panel] = wanted
        changed.push(`${panelTitle(panel)}: ${wanted ? 'قفل روشن' : 'قفل خاموش'}`)
      }
    }

    if (refused.length)
      throw new BusinessError(
        `قفل «${refused.join('» و «')}» قابل برداشتن نیست و تغییری هم ثبت نشد.\n` +
          'داخل پنل تنظیمات، «بازگردانی بکاپ»، «حذف گزارشات فروش» و «سبک‌سازی دیتابیس» هست؛ ' +
          'اگر قفلش برداشته شود هر کسی که پشت سیستم بنشیند می‌تواند داده‌ی فروشگاه را جایگزین یا پاک کند ' +
          'و دیگر جایی برای برگرداندن قفل نمی‌ماند. قفل بقیه‌ی ماژول‌ها آزادانه قابل تغییر است.'
      )

    if (!changed.length) return { ok: true as const, changed: 0, locks: next, openCount: openPanelCount(next) }

    await savePanelLocks(next)
    await audit(prisma, {
      action: AuditAction.PANEL_LOCKS_UPDATE,
      entity: 'Setting',
      userId: input.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(next),
      note: 'قفل ماژول‌ها ⇒ ' + changed.join(' · ')
    }).catch(() => undefined)

    return { ok: true as const, changed: changed.length, locks: next, openCount: openPanelCount(next) }
  },

  /**
   * -------------------------------------------------------------------------
   * باز کردن یک پنل قفل‌دار.
   *
   * ترتیب بررسی عمدی است: *اول* رمز مدیر. پس اگر رمز واردشده رمز مدیر باشد،
   * خروجی `scope: 'MANAGER'` است و صدازننده «نشست مدیر» کامل را شروع می‌کند
   * (همان رفتار همیشگی). اگر رمز مدیر نبود و رمز دومِ فعالِ همین پنل بود،
   * خروجی `scope: 'PANEL'` است و *فقط* همان پنل باز می‌شود.
   * -------------------------------------------------------------------------
   */
  async verifyPanel(input: { panel?: string; password?: string; force?: boolean } = {}): Promise<PanelUnlockResult> {
    const panel = normalizePanelKey(input.panel)
    if (!panel) throw new BusinessError('پنل مشخص نشده است؛ برنامه را یک بار ببندید و باز کنید.')

    /**
     * بند ۱ — اگر مدیر قفل این ماژول را خاموش کرده باشد، بدون هیچ رمزی باز
     * می‌شود. `scope: 'OPEN'` به صدازننده می‌گوید «این باز شدن، نشست مدیر
     * نساخت»، پس بقیه‌ی پنل‌ها همان‌طور قفل می‌مانند. عملاً UI هیچ‌وقت به اینجا
     * نمی‌رسد (گیت وقتی قفل خاموش است رندر نمی‌شود)، ولی این مسیر عمداً هست تا
     * منطق در main هم کامل و مستقل از UI باشد.
     */
    /**
     * نشست ۱۸۴ — `force` یعنی «صدازننده عملیات پول‌ساز است، میان‌بر نزن».
     * بدون آن رفتار مو‌به‌مو همان قبل است.
     */
    if (input.force !== true && !isPanelLockEnabled(await readPanelLocks(), panel))
      return { ok: true, scope: 'OPEN', panel, isDefault: false }

    /**
     * بخش ۲ — قفل موقت این *گیت* (نه کل برنامه).
     * شمارنده به تفکیک پنل است، پس رمز اشتباه روی «کالاها» گیت «بستن صندوق» را
     * قفل نمی‌کند. رمز مدیر هم روی همین گیت شمرده می‌شود: کسی نمی‌تواند با
     * حدس‌زدنِ بی‌نهایتِ رمز مدیر روی یک پنل، قفل را دور بزند.
     */
    return withGateAttempt(panel, async () => {
      await assertGateOpen(panel)

      const password = normalize(input.password)
    if (!password) throw new BusinessError('رمز را وارد کنید.')

    // ۱) رمز مدیر: همیشه و برای همه‌ی پنل‌ها معتبر است
    if (await matches(password)) {
      await noteSuccess(panel)
      const stored = await read()
      return { ok: true, scope: 'MANAGER', panel, isDefault: stored?.isDefault ?? true }
    }

    /**
     * نشست ۱۸۳ این گیت را برای «تنظیمات» گذاشت؛ نشست ۱۸۷ به‌دستور مالک فهرست
     * `MANAGER_ONLY_PANELS` را خالی کرد تا تنظیمات هم رمز دوم/سوم بپذیرد.
     * خودِ چک مانده تا اگر روزی پنلی دوباره فقط-مدیر شد، قبل از سنجش رمز دوم
     * رد شود — امروز هیچ پنلی در آن فهرست نیست و این شاخه اجرا نمی‌شود.
     */
    if (isManagerOnlyPanel(panel)) {
      // شمارنده‌ی قفل موقت مشترک است تا این مسیر راهی برای حدس‌زدن بی‌نهایت نسازد
      const message = await noteFailure(
        panel,
        `پنل «${panelTitle(panel)}» فقط با رمز مدیر باز می‌شود؛ رمز دوم و رمز سوم برایش تعریف نمی‌شود.`
      )
      throw new BusinessError(message)
    }

    // ۲) رمز دوم اختصاصی همین پنل (اگر تعریف و فعال شده باشد)
    const map = await readPanels()
    if (panelMatches(map[panel], password)) {
      await noteSuccess(panel)
      await audit(prisma, {
        action: 'SETTINGS_UPDATE',
        entity: 'Setting',
        note: `ورود به پنل «${panelTitle(panel)}» با رمز دوم اختصاصی (بدون نشست مدیر)`
      }).catch(() => undefined)
      return { ok: true, scope: 'PANEL', panel, isDefault: false }
    }

    /**
     * ۳) مورد ۷ — «رمز سوم» مخصوص همین پنل *و همین شیفت*.
     *
     * اولویت کامل و نهایی، دقیقاً همین ترتیبِ بالا به پایین است:
     *     رمز مدیر (همه‌ی پنل‌ها، همه‌ی شیفت‌ها)
     *   > رمز دوم پنل (همه‌ی شیفت‌ها)
     *   > رمز سوم پنل × شیفتِ جاری (فقط همان شیفت)
     * رمز سومِ یک شیفت دیگر عمداً رد می‌شود — همین چیزی است که «شیفت بعدی این
     * کار را کرد» را غیرقابل ادعا می‌کند. شمارنده‌ی قفل موقت هم مشترک است تا
     * وجود رمز سوم، راهی برای حدس‌زدن بی‌نهایت نسازد.
     */
    const shiftCfg = await readShiftConfig()
    const shiftNo = await currentShiftNumber(shiftCfg)
    /**
     * اصلاح نشست دوازدهم — رمز سوم فقط برای شیفتی معتبر است که *همین حالا* در
     * «تنظیمات → شیفت» تعریف شده باشد. اگر مدیر شیفتی را حذف کرده باشد، رکورد
     * رمز سومِ جامانده‌اش نباید بی‌صدا شیفت دیگری را باز کند (جدول تنظیمات هم
     * همان فهرست تعریف‌شده را نشان می‌دهد، پس آن رمز عملاً نامرئی است).
     */
    const shiftDefined = !!shiftNo && !!(shiftCfg.templates ?? [])[shiftNo - 1]
    const shiftRec = shiftDefined ? map[panel]?.shifts?.[String(shiftNo)] : undefined
    if (shiftRec && shiftRec.enabled !== false && sameHash(shiftRec.hash, derive(password, shiftRec.salt))) {
      await noteSuccess(panel)
      await audit(prisma, {
        action: 'SETTINGS_UPDATE',
        entity: 'Setting',
        note: `ورود به پنل «${panelTitle(panel)}» با رمز سوم شیفت ${faDigits(shiftNo ?? 0)} (بدون نشست مدیر)`
      }).catch(() => undefined)
      return { ok: true, scope: 'PANEL', panel, isDefault: false }
    }

      throw new BusinessError(await noteFailure(panel, 'رمز درست نیست؛ دوباره تلاش کنید.'))
    })
  },

  /**
   * -------------------------------------------------------------------------
   * تعریف / تغییر / حذف «رمز دوم» یک پنل.
   *
   * برای این کار *رمز مدیر* لازم است، حتی اگر پنل تنظیمات با رمز دوم خودش باز
   * شده باشد؛ وگرنه کارمندی که رمز دومِ تنظیمات را دارد می‌توانست برای بقیه‌ی
   * پنل‌ها هم رمز بسازد.
   *
   * `password` خالی = «رمز دوم این پنل حذف شود» ⇒ پنل به رفتار پیش‌فرض
   * برمی‌گردد (فقط رمز مدیر بازش می‌کند).
   * -------------------------------------------------------------------------
   */
  async setPanelPassword(
    input: { panel?: string; managerPassword?: string; password?: string; userId?: number | null } = {}
  ) {
    const panel = normalizePanelKey(input.panel)
    if (!panel) throw new BusinessError('پنل مشخص نشده است.')

    const managerPassword = normalize(input.managerPassword)
    if (!managerPassword) throw new BusinessError('برای تعیین رمز دوم، اول رمز مدیر را وارد کنید.')
    // ZIP-AUDIT-HIGH-01: matches() خام، شمارنده/قفل __manager__ را دور می‌زد.
    await assertManagerPassword(managerPassword, `تعیین یا حذف رمز دوم پنل «${panelTitle(panel)}»`)

    const next = normalize(input.password)
    const map = await readPanels()
    const title = panelTitle(panel)

    if (!next) {
      /**
       * ⚠️ اصلاح نشست دوازدهم — «حذف رمز دوم» نباید رمزهای سوم شیفتی را هم ببرد.
       *
       * قبلاً اینجا کل رکورد پنل با `delete map[panel]` پاک می‌شد؛ چون رمزهای سوم
       * (مورد ۷) زیرشاخه‌ی همین رکورد ذخیره می‌شوند، حذف رمز دوم بی‌صدا همه‌ی
       * رمزهای سومِ همان پنل را هم پاک می‌کرد — در حالی که پیام UI فقط از حذف
       * رمز دوم حرف می‌زد. حالا فقط بخش رمز دوم خالی می‌شود و `shifts` سر جایش
       * می‌ماند (دقیقاً قرینه‌ی شاخه‌ی «ثبت رمز دوم» که رمزهای سوم را نگه می‌دارد).
       */
      const base = map[panel]
      if (!base?.hash) throw new BusinessError(`برای پنل «${title}» رمز دومی تعریف نشده بود.`)
      const keptShifts = base.shifts
      if (keptShifts && Object.keys(keptShifts).length) {
        // رکورد «بدون رمز دوم» می‌ماند تا رمزهای سوم همین پنل زنده بمانند
        map[panel] = { salt: '', hash: '', enabled: false, changedAt: base.changedAt, shifts: keptShifts }
      } else {
        delete map[panel]
      }
      await savePanels(map)
      await audit(prisma, {
        action: 'SETTINGS_UPDATE',
        entity: 'Setting',
        userId: input.userId ?? null,
        note:
          `حذف رمز دوم پنل «${title}» — از این پس فقط با رمز مدیر باز می‌شود` +
          (keptShifts && Object.keys(keptShifts).length
            ? ` (${faDigits(Object.keys(keptShifts).length)} رمز سوم شیفتی این پنل دست‌نخورده ماند)`
            : '')
      })
      return { ok: true as const, panel, enabled: false }
    }

    if (next.length < 4) throw new BusinessError('رمز دوم باید حداقل ۴ رقم/کاراکتر باشد.')
    if (next === managerPassword)
      throw new BusinessError('رمز دوم نباید با رمز مدیر یکی باشد؛ یک رمز جدا برای این پنل بگذارید.')

    const salt = randomBytes(16).toString('hex')
    map[panel] = {
      salt,
      hash: derive(next, salt),
      enabled: true,
      changedAt: new Date().toISOString(),
      // مورد ۴ — نسخه‌ی بازگشت‌پذیر (رمزنگاری‌شده) تا بعداً قابل نمایش باشد
      enc: sealSecret(next),
      // رمزهای سوم همین پنل دست‌نخورده می‌مانند
      shifts: map[panel]?.shifts
    }
    await savePanels(map)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input.userId ?? null,
      note: `تعیین رمز دوم اختصاصی برای پنل «${title}» (خود رمز ذخیره نمی‌شود) — رمز مدیر هم مثل قبل این پنل را باز می‌کند`
    })
    return { ok: true as const, panel, enabled: true }
  },

  /**
   * -------------------------------------------------------------------------
   * مورد ۷ — تعریف / تغییر / حذف «رمز سوم» یک ترکیب «پنل × شیفت».
   * مثل رمز دوم، *رمز مدیر* لازم است. `password` خالی = حذف همان رمز سوم.
   * -------------------------------------------------------------------------
   */
  async setPanelShiftPassword(
    input: { panel?: string; shift?: number | string; managerPassword?: string; password?: string; userId?: number | null } = {}
  ) {
    const panel = normalizePanelKey(input.panel)
    if (!panel) throw new BusinessError('پنل مشخص نشده است.')
    const shiftNo = Number(toLatinDigits(String(input.shift ?? '')))
    if (!Number.isInteger(shiftNo) || shiftNo < 1) throw new BusinessError('شیفت مشخص نشده است.')

    const managerPassword = normalize(input.managerPassword)
    if (!managerPassword) throw new BusinessError('برای تعیین رمز سوم، اول رمز مدیر را وارد کنید.')
    // ZIP-AUDIT-HIGH-01: همان گیت lockout مدیر، پیش از هر تغییر رمز سوم.
    await assertManagerPassword(managerPassword, `تعیین یا حذف رمز سوم پنل «${panelTitle(panel)}»`)

    const cfg = await readShiftConfig()
    const tpl = (cfg.templates ?? [])[shiftNo - 1]
    if (!tpl)
      throw new BusinessError(
        `شیفت شماره ${faDigits(shiftNo)} در «تنظیمات شیفت» تعریف نشده است؛ اول شیفت را بسازید.`
      )
    const shiftName = tpl.name || 'شیفت ' + shiftNo
    const title = panelTitle(panel)
    const map = await readPanels()
    const next = normalize(input.password)
    const base = map[panel]

    if (!next) {
      if (!base?.shifts?.[String(shiftNo)])
        throw new BusinessError(`برای «${title} × ${shiftName}» رمز سومی تعریف نشده بود.`)
      const shifts = { ...base.shifts }
      delete shifts[String(shiftNo)]
      map[panel] = { ...base, shifts: Object.keys(shifts).length ? shifts : undefined }
      // اگر پنل رمز دوم نداشت و رمز سومی هم نماند، رکورد را کامل پاک می‌کنیم
      if (!map[panel].hash) delete map[panel]
      await savePanels(map)
      await audit(prisma, {
        action: AuditAction.PANEL_SHIFT_PASSWORD,
        entity: 'Setting',
        userId: input.userId ?? null,
        note: `حذف رمز سوم «${title} × ${shiftName}»`
      }).catch(() => undefined)
      return { ok: true as const, panel, shift: shiftNo, enabled: false }
    }

    if (next.length < 4) throw new BusinessError('رمز سوم باید حداقل ۴ رقم/کاراکتر باشد.')
    if (next === managerPassword)
      throw new BusinessError('رمز سوم نباید با رمز مدیر یکی باشد؛ یک رمز جدا برای این شیفت بگذارید.')

    const salt = randomBytes(16).toString('hex')
    const record: PanelShiftAuthRecord = {
      salt,
      hash: derive(next, salt),
      enabled: true,
      changedAt: new Date().toISOString(),
      enc: sealSecret(next)
    }
    // اگر پنل هنوز رمز دوم ندارد، یک رکورد «بدون رمز دوم» ساخته می‌شود
    map[panel] = {
      salt: base?.salt ?? '',
      hash: base?.hash ?? '',
      enabled: base ? base.enabled !== false : false,
      changedAt: base?.changedAt,
      enc: base?.enc,
      shifts: { ...(base?.shifts ?? {}), [String(shiftNo)]: record }
    }
    await savePanels(map)
    await audit(prisma, {
      action: AuditAction.PANEL_SHIFT_PASSWORD,
      entity: 'Setting',
      userId: input.userId ?? null,
      note: `تعیین رمز سوم برای «${title} × ${shiftName}» — فقط در همین شیفت کار می‌کند`
    }).catch(() => undefined)
    return { ok: true as const, panel, shift: shiftNo, enabled: true }
  },

  /**
   * -------------------------------------------------------------------------
   * مورد ۴ — نمایش دوباره‌ی رمز دوم/سوم ذخیره‌شده. **رمز مدیر لازم است** و هر
   * بار در AuditLog ثبت می‌شود (خود رمز در لاگ نمی‌رود).
   * -------------------------------------------------------------------------
   */
  async revealPanelPassword(
    input: { panel?: string; shift?: number | string | null; managerPassword?: string; userId?: number | null } = {}
  ): Promise<PanelPasswordReveal> {
    const panel = normalizePanelKey(input.panel)
    if (!panel) throw new BusinessError('پنل مشخص نشده است.')
    const managerPassword = normalize(input.managerPassword)
    if (!managerPassword) throw new BusinessError('برای دیدن رمز ذخیره‌شده، اول رمز مدیر را وارد کنید.')
    // ZIP-AUDIT-HIGH-01: نمایش credential نیز نباید brute-force manager را باز کند.
    await assertManagerPassword(managerPassword, 'نمایش رمز ذخیره‌شده‌ی پنل')

    const rawShift = toLatinDigits(String(input.shift ?? '')).trim()
    const shiftNo = rawShift ? Number(rawShift) : null
    const map = await readPanels()
    const rec = map[panel]
    const title = panelTitle(panel)
    const cfg = await readShiftConfig()
    const shiftName =
      shiftNo && (cfg.templates ?? [])[shiftNo - 1]
        ? (cfg.templates[shiftNo - 1].name || 'شیفت ' + shiftNo)
        : shiftNo
          ? 'شیفت ' + faDigits(shiftNo)
          : null

    const target = shiftNo ? rec?.shifts?.[String(shiftNo)] : rec
    const label = shiftNo ? `رمز سوم «${title} × ${shiftName}»` : `رمز دوم «${title}»`
    if (!target || !target.hash) throw new BusinessError(`${label} تعریف نشده است.`)
    if (!target.enc)
      throw new BusinessError(
        `${label} قبل از این نسخه ثبت شده و فقط به شکل هش‌شده (یک‌طرفه) روی دیتابیس است، ` +
          'پس مقدارش قابل بازیابی نیست. یک بار همان رمز را دوباره ثبت کنید تا از این به بعد قابل نمایش باشد.'
      )
    const plain = openSecret(target.enc)
    if (!plain)
      throw new BusinessError(
        `${label} با کلید رمزنگاری این دستگاه باز نشد (معمولاً وقتی دیتابیس روی دستگاه دیگری بازگردانی شده باشد). ` +
          'ورود با همان رمز مثل قبل کار می‌کند؛ برای قابل‌نمایش شدنش یک بار دوباره ثبتش کنید.'
      )

    await audit(prisma, {
      action: AuditAction.PANEL_PASSWORD_REVEAL,
      entity: 'Setting',
      userId: input.userId ?? null,
      note: `نمایش ${label} در تنظیمات (با تایید رمز مدیر؛ خود رمز در لاگ ثبت نمی‌شود)`
    }).catch(() => undefined)

    return {
      panel,
      panelTitle: title,
      shiftNumber: shiftNo ?? null,
      shiftName: shiftName ?? null,
      password: plain,
      changedAtIso: target.changedAt ?? null
    }
  },

  /** تغییر رمز از داخل پنل تنظیمات (رمز فعلی لازم است). */
  async changePassword(input: { current?: string; next?: string; userId?: number | null } = {}) {
    const current = normalize(input.current)
    const next = normalize(input.next)
    if (!current) throw new BusinessError('برای تغییر رمز، اول رمز فعلی را وارد کنید.')
    // ZIP-AUDIT-HIGH-01: تغییر رمز از IPC نیز یک تلاش مدیر است، نه matches خام.
    await assertManagerPassword(current, 'تغییر رمز مدیر')
    if (next.length < 4) throw new BusinessError('رمز جدید باید حداقل ۴ رقم/کاراکتر باشد.')
    if (next === current) throw new BusinessError('رمز جدید با رمز فعلی یکی است؛ چیزی تغییر نکرد.')
    if (next === DEFAULT_MANAGER_PASSWORD)
      throw new BusinessError('رمز اولیه دیگر قابل استفاده نیست. یک رمز دیگر بگذارید.')

    await save(build(next, false))
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input.userId ?? null,
      note: 'تغییر رمز مدیریتی (خود رمز ذخیره نمی‌شود)'
    })
    return { ok: true as const }
  }
}
