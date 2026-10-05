/**
 * ===========================================================================
 * تنظیمات و رازهای سرویس‌دهنده‌ی پیامک.
 *
 * 🔐 قاعده‌ی سخت: کلید API **هرگز** در دیتابیس خام نمی‌نشیند و **هرگز** از IPC
 * برنمی‌گردد. ذخیره با همان گاوصندوق پنل‌ها (`PanelVault` → AES-256-GCM، با
 * کلیدِ بیرون از فایل دیتابیس) انجام می‌شود؛ ساختن یک Secret Store موازی
 * دقیقاً همان اشتباهی است که طرح مرجع هم از آن پرهیز داده بود.
 *
 * پیامد عملی (که در UI هم گفته می‌شود): اگر این دیتابیس روی دستگاه دیگری
 * بازگردانی شود، فایل کلید گاوصندوق آنجا نیست ⇒ «نمایش رمز» کار نمی‌کند و
 * سرویس‌دهنده باید یک بار دوباره تنظیم شود. هش(PanelVault) عوض نمی‌شود.
 * ===========================================================================
 */
import { prisma } from '../../db/client'
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'
import { AuditAction } from '@shared/enums'
import { toJalaliDate } from '@shared/jalali'
import { sealSecret, openSecret, vaultReady } from '../PanelVault'
import { assertManagerPassword } from '../AuthService'
import {
  normalizeSmsProviderKey,
  smsProviderNeedsCredentials,
  SMS_PROVIDER_LABELS,
  type SmsProviderKey
} from '@shared/sms'
import { getSmsProvider, listSmsProviders, type SmsProviderSettings } from './providers'
import {
  SMS_LINE_PURPOSE_LABELS,
  SMS_LINE_PURPOSES,
  normalizeSmsLinePurpose,
  pickSmsLine,
  smsLineMatchesPurpose
} from '@shared/sms'

export interface SmsProviderRow {
  id: number
  name: string
  providerKey: SmsProviderKey
  providerLabel: string
  isActive: boolean
  baseUrl: string | null
  senderNumber: string | null
  patternId: string | null
  /** پیام خدماتی با الگو برود؟ (تصمیم صریح صاحب فروشگاه) */
  patternForService: boolean
  purpose: string
  purposeLabel: string
  matches: { SERVICE: boolean; ADS: boolean }
  /** فقط «هست/نیست» — خودِ کلید هیچ‌وقت برنمی‌گردد */
  hasCredentials: boolean
  credentialsVersion: number
  lastHealthCheckAtJalali: string | null
  lastHealthStatus: string | null
  lastHealthNote: string | null
  /** پیش‌نیازهای جاافتاده (پرچم «تنظیم نشده» در UI) */
  missing: string[]
  live: boolean
}

/** فهرست کوتاه قالب‌های راز که ممکن است ذخیره شوند (whitelist). */
const SECRET_KEYS = ['apiKey', 'username', 'password'] as const

function shape(row: any): SmsProviderRow {
  const providerKey = normalizeSmsProviderKey(row.providerKey)
  const provider = getSmsProvider(providerKey)
  const cfg: SmsProviderSettings = {
    baseUrl: row.baseUrl ?? null,
    senderNumber: row.senderNumber ?? null,
    patternId: row.patternId ?? null,
    // مقدار راز فقط برای سنجش «هست/نیست» باز می‌شود، نه برای برگرداندن به UI
    secrets: row.credentialsEncrypted ? (openSecret(row.credentialsEncrypted) ? parseSecret(row.credentialsEncrypted) : null) : null
  }
  return {
    id: row.id,
    name: String(row.name ?? ''),
    providerKey,
    providerLabel: SMS_PROVIDER_LABELS[providerKey] ?? providerKey,
    isActive: row.isActive === true,
    baseUrl: row.baseUrl ?? null,
    senderNumber: row.senderNumber ?? null,
    patternId: row.patternId ?? null,
    patternForService: row.patternForService !== false,
    purpose: normalizeSmsLinePurpose(row.purpose),
    purposeLabel: SMS_LINE_PURPOSE_LABELS[normalizeSmsLinePurpose(row.purpose)] ?? 'هر دو کاره (یک خط)',
    /** آیا این خط اجازه‌ی این نوع پیام را دارد؟ مرجعِ تصمیم، خودِ صف است. */
    matches: {
      SERVICE: smsLineMatchesPurpose(row.purpose, 'SERVICE'),
      ADS: smsLineMatchesPurpose(row.purpose, 'ADS')
    },
    hasCredentials: Boolean(row.credentialsEncrypted) && Boolean(openSecret(row.credentialsEncrypted)),
    credentialsVersion: Math.round(Number(row.credentialsVersion ?? 1)) || 1,
    lastHealthCheckAtJalali: row.lastHealthCheckAt ? jDate(row.lastHealthCheckAt) : null,
    lastHealthStatus: row.lastHealthStatus ?? null,
    lastHealthNote: row.lastHealthNote ?? null,
    missing: provider.missingRequirements(cfg),
    live: provider.live
  }
}

/**
 * تاریخِ شمسی برای نمایش در UI.
 *
 * ⚠️ اینجا قبلاً مستقیماً `toISOString()` برگردانده می‌شد که تاریخ **میلادی**
 * است، در حالی که کل برنامه (و نامِ همین فیلد) شمسی است — یعنی «۱۴۰۵/۰۷/۱۱»
 * به‌جای «2026-10-03» باید دیده شود. تاریخ نامعتبر ⇒ رشته‌ی خالی (نه throw)،
 * چون این فیلد تزئینی است و نباید فهرست سرویس‌دهنده‌ها را بیندازد.
 */
function jDate(d: Date): string {
  try {
    const t = new Date(d)
    if (Number.isNaN(t.getTime())) return ''
    return toJalaliDate(t)
  } catch {
    return ''
  }
}

/** رازِ ذخیره‌شده (JSON) ⇒ شیء کلیدها. ورودی خراب ⇒ null. */
function parseSecret(blob: unknown): SmsProviderSettings['secrets'] {
  const plain = openSecret(blob)
  if (!plain) return null
  try {
    const obj = JSON.parse(plain)
    if (!obj || typeof obj !== 'object') return null
    return obj
  } catch {
    return null
  }
}

/**
 * رازِ *بازشده*ی یک سرویس‌دهنده — **فقط** برای مصرف داخلی صف.
 * این تابع هیچ‌وقت از IPC صدا زده نمی‌شود.
 */
export async function secretsOf(providerConfigId: number | null | undefined): Promise<SmsProviderSettings> {
  if (!providerConfigId) return {}
  const row = await (prisma as any).smsProviderConfig.findUnique({ where: { id: providerConfigId } }).catch(() => null)
  if (!row) return {}
  return {
    baseUrl: row.baseUrl ?? null,
    senderNumber: row.senderNumber ?? null,
    patternId: row.patternId ?? null,
    patternForService: row.patternForService !== false,
    secrets: row.credentialsEncrypted ? parseSecret(row.credentialsEncrypted) : null
  }
}

export function filterSecretKeys(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const src = (input ?? {}) as Record<string, unknown>
  for (const k of SECRET_KEYS) {
    const v = src[k]
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim()
  }
  return out
}

export const smsCredentialService = {
  /** فهرست سرویس‌دهنده‌های تعریف‌شده + سرویس‌دهنده‌های قابل‌انتخاب. */
  async list(): Promise<{ rows: SmsProviderRow[]; options: { key: string; label: string }[]; vaultReady: boolean }> {
    const rows = await (prisma as any).smsProviderConfig.findMany({ orderBy: [{ isActive: 'desc' }, { id: 'asc' }] })
    return {
      rows: (rows ?? []).map(shape),
      options: listSmsProviders().map((p) => ({ key: p.key, label: p.title })),
      vaultReady: vaultReady()
    }
  },

  /** سرویس‌دهنده‌ی فعال (تنها یکی می‌تواند فعال باشد). */
  async active(): Promise<SmsProviderRow | null> {
    const row = await (prisma as any).smsProviderConfig.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' }
    })
    return row ? shape(row) : null
  },

  /**
   * ثبت یا ویرایش یک سرویس‌دهنده.
   *
   * `apiKey` فقط در همین لحظه در حافظه است: مهر می‌شود و می‌رود. اگر خالی
   * فرستاده شود، رازِ قبلی **دست‌نخورده** می‌ماند (تا ذخیره‌ی تنظیمات دیگر
   * کلید را پاک نکند).
   */
  async save(input: {
    id?: number | null
    name?: string
    providerKey?: string
    baseUrl?: string | null
    senderNumber?: string | null
    patternId?: string | null
    patternForService?: boolean
    purpose?: string | null
    secrets?: unknown
    isActive?: boolean
    managerPassword?: string | null
    userId?: number | null
  }): Promise<SmsProviderRow> {
    const id = input?.id ? Math.round(Number(input.id)) : null
    const existing = id
      ? await (prisma as any).smsProviderConfig.findUnique({ where: { id } }).catch(() => null)
      : null
    /**
     * ⚠️ `providerKey` فقط وقتی نوشته می‌شود که **واقعاً فرستاده شده باشد**.
     *
     * قبلاً نبودنش یعنی «LOG_ONLY»: هر ذخیره‌ی جزئی (اسکریپت، IPC، فرم آینده)
     * می‌توانست خط sms.ir را بی‌صدا به حالت آزمایشی برگرداند — و چون حالت
     * آزمایشی همیشه «پذیرفته» می‌دهد، پیام‌ها «ارسال‌شده» ثبت می‌شدند بدون
     * اینکه به کسی برسند. حالا نبودِ مقدار = دست‌نزدن به مقدار قبلی.
     */
    const providerKey =
      input?.providerKey != null
        ? normalizeSmsProviderKey(input.providerKey)
        : normalizeSmsProviderKey(existing?.providerKey)

    // تغییر کلید API ⇒ تأیید صریح رمز مدیر (همان الگوی «بازسازی دفتر هزینه»)
    const secretPatch = filterSecretKeys(input?.secrets)
    const hasSecretPatch = Object.keys(secretPatch).length > 0
    if (hasSecretPatch) await assertManagerPassword(input?.managerPassword, 'ثبت کلید API سرویس‌دهنده پیامک')

    /**
     * 🔐 تغییر **مقصد** کلید هم رمز مدیر می‌خواهد.
     *
     * `baseUrl` جایی است که کلید به آن فرستاده می‌شود؛ کسی که فقط قفل
     * «سرویس‌دهنده» را دارد می‌توانست آدرس را عوض کند و «تست اتصال» (یا اولین
     * ارسال) کلید را به سرور خودش بفرستد. این دقیقاً همان چیزی است که قفلِ
     * رمزِ مدیر برایش گذاشته شده بود.
     */
    const nextBaseUrl = input?.baseUrl != null ? String(input.baseUrl).trim() || null : undefined
    const routeChanged =
      Boolean(existing?.credentialsEncrypted) &&
      ((nextBaseUrl !== undefined && String(nextBaseUrl ?? '') !== String(existing.baseUrl ?? '').trim()) ||
        normalizeSmsProviderKey(existing.providerKey) !== providerKey)
    if (routeChanged && !hasSecretPatch)
      await assertManagerPassword(input?.managerPassword, 'تغییر مقصد/نوع اتصال کلید API پیامک')

    if (smsProviderNeedsCredentials(providerKey) && !vaultReady() && hasSecretPatch) {
      throw new BusinessError(
        'گاوصندوق رمزهای این دستگاه آماده نیست، پس کلید API قابل ذخیره‌سازی امن نیست.'
      )
    }

    let encrypted: string | undefined
    if (hasSecretPatch) {
      const sealed = sealSecret(JSON.stringify(secretPatch))
      if (!sealed)
        throw new BusinessError('مهر کردن کلید API ناموفق بود؛ کلید ذخیره نشد.')
      encrypted = sealed
    }

    const name = String(input?.name ?? '').trim() || SMS_PROVIDER_LABELS[providerKey] || 'سرویس‌دهنده پیامک'
    const data: Record<string, unknown> = {
      name,
      ...(input?.providerKey != null || !existing ? { providerKey } : {}),
      baseUrl: nextBaseUrl,
      senderNumber: input?.senderNumber != null ? String(input.senderNumber).trim() || null : undefined,
      patternId: input?.patternId != null ? String(input.patternId).trim() || null : undefined,
      patternForService: typeof input?.patternForService === 'boolean' ? input.patternForService : undefined,
      purpose: input?.purpose != null ? normalizeSmsLinePurpose(input.purpose) : undefined
    }
    if (encrypted) {
      data.credentialsEncrypted = encrypted
      data.credentialsVersion = (id ? Math.round(Number((await currentVersion(id)) ?? 1)) : 1) + (id ? 1 : 0)
      data.lastHealthStatus = null
      data.lastHealthNote = null
    }
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]

    const row = id
      ? await (prisma as any).smsProviderConfig.update({ where: { id }, data })
      : await (prisma as any).smsProviderConfig.create({ data: { ...data, isActive: false } })

    if (input?.isActive === true) {
      const activated = await activateInternal(row.id)
      /**
       * ⚠️ چرا نتیجه‌ی فعال‌سازی برگردانده می‌شود و نه `row`:
       * `create` همیشه با `isActive: false` ساخته می‌شود و فعال‌سازی در گام
       * بعد رخ می‌دهد. اگر همان شیء قدیمی را برمی‌گرداندیم، UI بعد از ذخیره
       * «ذخیره شد ولی خاموش» می‌دید در حالی که سرویس‌دهنده واقعاً فعال شده بود.
       * در سمت مقابل، `update` می‌تواند ردیفِ *خاموش‌شده‌ی قبلی* را برگرداند
       * (چون `activateInternal` بقیه را خاموش می‌کند) — پس هر دو مسیر به
       * بازخوانی صریح نیاز دارند.
       */
      Object.assign(row, activated)
    }

    await audit(prisma, {
      action: AuditAction.SMS_PROVIDER_SAVE,
      entity: 'SmsProviderConfig',
      entityId: row.id,
      userId: input?.userId ?? null,
      after: JSON.stringify({
        name,
        providerKey,
        senderNumber: data.senderNumber ?? null,
        patternId: data.patternId ?? null,
        secretChanged: hasSecretPatch
      }),
      note:
        `ذخیره‌ی سرویس‌دهنده پیامک «${name}» (${providerKey})` +
        (hasSecretPatch ? ' · کلید API تغییر کرد (مقدار در لاگ ثبت نمی‌شود)' : '')
    })

    return shape(row)
  },

  async activate(idInput: number, userId?: number | null): Promise<SmsProviderRow> {
    const id = Math.round(Number(idInput))
    const row = await activateInternal(id)
    await audit(prisma, {
      action: AuditAction.SMS_PROVIDER_ACTIVATE,
      entity: 'SmsProviderConfig',
      entityId: id,
      userId: userId ?? null,
      note: `فعال‌کردن سرویس‌دهنده‌ی پیامک «${row.name}»`
    })
    return shape(row)
  },

  /**
   * «تست اتصال» — بدون افشای کلید.
   *
   * تا وقتی آداپتور واقعی وصل نشده، پاسخ صادقانه است: «انتخاب شد، ولی ارسال
   * واقعی فعال نیست». هیچ پیامی ادعای موفقیت نمی‌کند.
   */
  async test(idInput: number, userId?: number | null): Promise<{ ok: boolean; detail: string; missing: string[] }> {
    const id = Math.round(Number(idInput))
    const row = await (prisma as any).smsProviderConfig.findUnique({ where: { id } })
    if (!row) throw new BusinessError('سرویس‌دهنده پیدا نشد.')

    const provider = getSmsProvider(row.providerKey)
    const cfg = await secretsOf(id)
    const missing = provider.missingRequirements(cfg)
    let ok = missing.length === 0 && provider.live
    let detail = ok
      ? 'اتصال به سرویس‌دهنده برقرار است.'
      : missing.length
        ? `این موارد تنظیم نشده‌اند: ${missing.join(' · ')}`
        : 'تنظیمات کامل است، ولی ارسال واقعی این سرویس‌دهنده هنوز در برنامه فعال نشده است.'

    /**
     * «تست» یعنی تست واقعی: اگر آداپتور کاوشگر دارد، همین حالا با کلیدِ ذخیره‌شده
     * به سرویس‌دهنده وصل می‌شویم (sms.ir: اعتبار حساب، کاوه‌نگار: اطلاعات حساب).
     * بدون این، «تنظیمات کامل است» می‌توانست با یک کلید غلط هم سبز شود.
     */
    if (ok && typeof provider.probe === 'function') {
      try {
        const probed = await provider.probe(cfg)
        ok = probed.ok
        detail = probed.detail
      } catch (e: any) {
        ok = false
        detail = `تست اتصال انجام نشد: ${String(e?.message ?? e).slice(0, 120)}`
      }
    }

    await (prisma as any).smsProviderConfig.update({
      where: { id },
      data: { lastHealthCheckAt: new Date(), lastHealthStatus: ok ? 'OK' : 'FAILED', lastHealthNote: detail }
    })

    await audit(prisma, {
      action: AuditAction.SMS_PROVIDER_TEST,
      entity: 'SmsProviderConfig',
      entityId: id,
      userId: userId ?? null,
      note: `تست اتصال سرویس‌دهنده پیامک «${row.name}» — نتیجه: ${ok ? 'موفق' : 'ناموفق'} · ${detail}`
    })

    return { ok, detail, missing }
  }
}

async function currentVersion(id: number): Promise<number> {
  const row = await (prisma as any).smsProviderConfig
    .findUnique({ where: { id }, select: { credentialsVersion: true } })
    .catch(() => null)
  return Math.round(Number(row?.credentialsVersion ?? 1)) || 1
}

/** فقط یک سرویس‌دهنده می‌تواند فعال باشد (بقیه خاموش می‌شوند). */
async function activateInternal(idInput: number): Promise<any> {
  const id = Math.round(Number(idInput))
  const row = await (prisma as any).smsProviderConfig.findUnique({ where: { id } })
  if (!row) throw new BusinessError('سرویس‌دهنده پیدا نشد.')

  /**
   * کدام ردیف‌ها باید خاموش شوند؟
   *
   *   • خط «تبلیغاتی» با خط «تبلیغاتی» رقابت می‌کند (فقط یکی فعال می‌ماند)،
   *   • خط «خدماتی» با «خدماتی»،
   *   • خط «هر دو کاره» با **همه** — چون خودش می‌خواهد هر دو کار را بکند.
   *
   * نتیجه: یک خط خدماتی + یک خط تبلیغاتی هم‌زمان فعال می‌مانند (همان چیزی که
   * مقررات می‌خواهد)، ولی دو خط تبلیغاتی هم‌زمان نه.
   */
  const purpose = normalizeSmsLinePurpose(row.purpose)
  const others = await (prisma as any).smsProviderConfig.findMany({
    where: { isActive: true, id: { not: id } },
    select: { id: true, purpose: true }
  })
  /**
   * مقایسه در **حافظه** انجام می‌شود نه با `where purpose in [...]`: ردیف‌هایی
   * که قبل از این قابلیت ساخته شده‌اند ممکن است هدفشان خام/ناشناخته باشد و
   * `normalizeSmsLinePurpose` آن‌ها را «هر دو کاره» می‌خواند؛ همان‌ها هم باید
   * خاموش شوند وگرنه دو خط هم‌زمان یک نوع پیام را می‌فرستند.
   */
  const conflicts = (others ?? [])
    .filter(
      (r: any) =>
        purpose === SMS_LINE_PURPOSES.BOTH || smsLineMatchesPurpose(r.purpose, purpose as 'SERVICE' | 'ADS')
    )
    .map((r: any) => r.id)
  if (conflicts.length) {
    await (prisma as any).smsProviderConfig.updateMany({
      where: { id: { in: conflicts } },
      data: { isActive: false }
    })
  }
  return (prisma as any).smsProviderConfig.update({ where: { id }, data: { isActive: true } })
}

/** خط‌های فعال همین حالا — انتخاب «کدام پیام از کدام خط» با خودِ صف است. */
export async function activeLines(): Promise<Array<{ id: number; providerKey: string; purpose: string; name: string }>> {
  try {
    const rows = await (prisma as any).smsProviderConfig.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' }
    })
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      providerKey: String(r.providerKey),
      purpose: normalizeSmsLinePurpose(r.purpose),
      name: String(r.name ?? '')
    }))
  } catch {
    return []
  }
}

/** خط مناسب برای یک نوع پیام (خدماتی/تبلیغاتی) یا null اگر خطش فعال نیست. */
export async function lineForEvent(
  eventType: unknown
): Promise<{ id: number; providerKey: string; purpose: string } | null> {
  const wanted = String(eventType ?? '') === 'CAMPAIGN' ? 'ADS' : 'SERVICE'
  const picked = pickSmsLine(await activeLines(), wanted)
  return picked ? { id: picked.id, providerKey: picked.providerKey, purpose: picked.purpose } : null
}
