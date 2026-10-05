/**
 * ===========================================================================
 * فاز ۴ — پیامک انبوه تبلیغاتی (کمپین) + دفتر «لغو ۱۱».
 *
 * قاعده‌های این فایل:
 *   • این ماژول **هیچ جدول فروش/اعتبار را نمی‌نویسد** — فقط `SmsCampaign`،
 *     `SmsOutbox` و `SmsOptOut`. (نگهبان جداسازی، همین را می‌سنجد.)
 *   • مخاطب فقط از دو جا می‌آید: دفترچه‌ی شماره‌های خود برنامه، یا فهرستی که
 *     کاربر می‌چسباند. هیچ منبع پنهانی وجود ندارد.
 *   • «لغو ۱۱» تنظیم‌شدنی است: مقدارش از `Setting[sms.optOutNote]` می‌آید و
 *     در خودِ صف هم دوباره تضمین می‌شود (`enqueueSms`).
 *   • کمپین فقط **صف** می‌کند؛ ارسال واقعی کارِ کارگر است. پس «لغو» همیشه
 *     ممکن است و «گم‌شدن» معنا ندارد.
 * ===========================================================================
 */
import { prisma } from '../../db/client'
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'
import { AuditAction } from '@shared/enums'
import {
  DEFAULT_SMS_OPT_OUT_NOTE,
  SMS_AUDIENCE_SOURCES,
  SMS_CAMPAIGN_PRIORITY,
  SMS_CANCELABLE_STATUSES,
  SMS_SETTING_KEYS,
  normalizeSmsPhone,
  parseSmsPhoneList,
  smsCostEstimate,
  smsDedupeKey,
  smsSegments,
  smsWithOptOutNote,
  validateSmsBody,
  SMS_MANUAL_DEDUPE_WINDOW_MS,
  type SmsEventType
} from '@shared/sms'
import { createHash } from 'node:crypto'
import { enqueueSms } from './SmsQueue'

const MAX_AUDIENCE = 5000
const MAX_PASTED_CHARS = 200_000

/**
 * ===========================================================================
 * گارد «ثبت دوباره‌ی همان کمپین» — باگ اول بازبینی سوم.
 *
 * مسئله: `dedupeKey` هر پیام کمپین به **شناسه‌ی خود کمپین** گره خورده است، پس
 * دو کمپین یکسان هیچ‌وقت جلوی هم را نمی‌گیرند. با دو بار Enter در دیالوگ تأیید
 * (که تا پایان ساخت باز می‌ماند و Enter را بدون توجه به `busy` می‌فرستد) دو
 * کمپین ساخته می‌شد و هر مشتری **دو تبلیغ** می‌گرفت — با ۱۰۰۰ شماره یعنی ۱۰۰۰
 * پیامک اضافه و همان چیزی که کاربر گفته هرگز نباید بشود.
 *
 * راه‌حل دو لایه است:
 *   • قفل درون‌فرایندی: تا وقتی یک `create` تمام نشده، درخواست دوم رد می‌شود.
 *   • اثرانگشت محتوا: متنِ نهایی + فهرست شماره‌ها + زمان ارسال. اگر همین
 *     ترکیب ظرف `SMS_MANUAL_DEDUPE_WINDOW_MS` دوباره بیاید، رد می‌شود.
 *
 * ⚠️ عمداً در حافظه است، نه ستون دیتابیس: پنجره‌اش ۹۰ ثانیه است و برنامه یک
 * پروسه است؛ با مهاجرت جدید و ستون تازه هیچ چیزی به دست نمی‌آمد. پیام خطا هم
 * صریح است (پنهان‌کاری نداریم): کاربر می‌فهمد چرا رد شد و چطور دوباره بفرستد.
 */
let createInFlight = false
const recentFingerprints = new Map<string, number>()

function campaignFingerprint(finalBody: string, phones: readonly string[], scheduledAt: Date | null): string {
  const list = [...phones].map((p) => normalizeSmsPhone(p) ?? String(p)).sort()
  return createHash('sha1')
    .update(`${finalBody}\u0000${list.join(',')}\u0000${scheduledAt ? scheduledAt.toISOString() : ''}`)
    .digest('hex')
}

function fingerprintSeenRecently(fp: string, now: number): boolean {
  for (const [key, at] of recentFingerprints) {
    if (now - at > SMS_MANUAL_DEDUPE_WINDOW_MS) recentFingerprints.delete(key)
  }
  const at = recentFingerprints.get(fp)
  return at != null && now - at <= SMS_MANUAL_DEDUPE_WINDOW_MS
}

// ---------------------------------------------------------------------------
// خواندن تنظیمات (بدون وابستگی به SmsService — جلوگیری از حلقه‌ی import)
// ---------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key } })
    return row?.value == null ? null : String(row.value)
  } catch {
    return null
  }
}

/** جمله‌ی لغوِ همین لحظه — پیش‌فرض «لغو ۱۱» است ولی همیشه از تنظیمات می‌آید. */
export async function currentOptOutNote(): Promise<string> {
  const raw = String((await readSetting(SMS_SETTING_KEYS.optOutNote)) ?? '').trim()
  return raw || DEFAULT_SMS_OPT_OUT_NOTE
}

// ---------------------------------------------------------------------------
// مخاطبان
// ---------------------------------------------------------------------------

interface Audience {
  phones: string[]
  sources: { bank: number; pasted: number }
  invalid: string[]
  duplicates: number
  optOutSkipped: number
}

/**
 * شماره‌های دفترچه‌ی برنامه: مشتریانِ دارای شماره‌ی موبایل معتبر.
 *
 * ⚠️ خواندن بدون فیلترِ SQL و نرمال‌سازی در JS عمدی است: شماره‌های ذخیره‌شده
 * ممکن است فارسی یا با فاصله باشند و فیلترِ متنیِ SQL یا آن‌ها را دور می‌ریزد
 * یا نیم‌بند رد می‌کند.
 */
async function bankPhones(): Promise<string[]> {
  const rows = await (prisma as any).customer.findMany({ select: { phone: true } })
  const seen = new Set<string>()
  for (const r of rows ?? []) {
    const p = normalizeSmsPhone(r?.phone)
    if (p) seen.add(p)
  }
  return [...seen]
}

/** شماره‌هایی که «لغو ۱۱» کرده‌اند — همیشه قبل از ساخت پیام حذف می‌شوند. */
export async function optedOutPhones(): Promise<Set<string>> {
  const rows = await (prisma as any).smsOptOut.findMany({ select: { phone: true } }).catch(() => [])
  const set = new Set<string>()
  for (const r of rows ?? []) {
    const p = normalizeSmsPhone(r?.phone)
    if (p) set.add(p)
  }
  return set
}

async function buildAudience(input: { phones?: unknown; includeBank?: unknown }): Promise<Audience> {
  const raw = String(input?.phones ?? '')
  if (raw.length > MAX_PASTED_CHARS) throw new BusinessError('فهرست شماره‌ها بیش از حد بزرگ است.')

  const pasted = parseSmsPhoneList(raw)
  const bank = input?.includeBank ? await bankPhones() : []

  const merged: string[] = []
  const seen = new Set<string>()
  let duplicates = pasted.duplicates

  for (const p of bank) {
    if (seen.has(p)) {
      duplicates++
      continue
    }
    seen.add(p)
    merged.push(p)
  }
  for (const p of pasted.valid) {
    if (seen.has(p)) {
      duplicates++
      continue
    }
    seen.add(p)
    merged.push(p)
  }

  const optOuts = await optedOutPhones()
  const phones: string[] = []
  let optOutSkipped = 0
  for (const p of merged) {
    if (optOuts.has(p)) {
      optOutSkipped++
      continue
    }
    phones.push(p)
  }

  if (phones.length > MAX_AUDIENCE)
    throw new BusinessError(`تعداد مخاطبان (${phones.length}) از سقف ${MAX_AUDIENCE} شماره بیشتر است.`)

  return {
    phones,
    sources: { bank: bank.length, pasted: pasted.valid.length },
    invalid: pasted.invalid,
    duplicates,
    optOutSkipped
  }
}

function sourceOf(a: Audience, includeBank: boolean, hasPaste: boolean): string {
  if (includeBank && hasPaste) return SMS_AUDIENCE_SOURCES.MIXED
  if (includeBank) return SMS_AUDIENCE_SOURCES.BANK
  return SMS_AUDIENCE_SOURCES.PASTE
}

async function pricePerSegment(): Promise<number> {
  const n = Number((await readSetting(SMS_SETTING_KEYS.pricePerSegment)) ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

// ---------------------------------------------------------------------------
// سرویس کمپین
// ---------------------------------------------------------------------------

export const smsCampaignService = {
  /** دفترچه‌ی شماره‌های برنامه — برای نشان‌دادن «چند نفر در دسترس است». */
  async bank(): Promise<{ total: number; available: number; optOut: number; sample: string[] }> {
    const bank = await bankPhones()
    const optOuts = await optedOutPhones()
    const available = bank.filter((p) => !optOuts.has(p))
    return {
      total: bank.length,
      available: available.length,
      optOut: bank.length - available.length,
      sample: available.slice(0, 5)
    }
  },

  /** پیش‌نمایش: چند پیام، چند بخش، چند تومان — قبل از ثبت. */
  async preview(input: { body?: unknown; phones?: unknown; includeBank?: unknown }): Promise<any> {
    const bodyRaw = String(input?.body ?? '').trim()
    const check = validateSmsBody(bodyRaw)
    if (!check.ok) throw new BusinessError(check.reason)

    const audience = await buildAudience(input)
    const note = await currentOptOutNote()
    const finalBody = smsWithOptOutNote(bodyRaw, note)
    const segments = smsSegments(finalBody)
    const price = await pricePerSegment()
    const cost = smsCostEstimate(segments, audience.phones.length, price)

    return {
      audienceCount: audience.sources.bank + audience.sources.pasted,
      sendable: audience.phones.length,
      invalidCount: audience.invalid.length,
      invalidSample: audience.invalid.slice(0, 5),
      duplicateCount: audience.duplicates,
      optOutSkipped: audience.optOutSkipped,
      source: sourceOf(audience, Boolean(input?.includeBank), String(input?.phones ?? '').trim().length > 0),
      optOutNote: note,
      finalBody,
      segments,
      pricePerSegment: price,
      costEstimate: cost.toman,
      messages: cost.messages
    }
  },

  /**
   * ثبت کمپین = ساخت سرگروه + صف‌کردن پیام‌ها.
   *
   * هیچ پیامی «همین‌جا» فرستاده نمی‌شود؛ پس ثبت کمپین حتی با اینترنت قطع هم
   * موفق است و پیام‌ها سر جایشان می‌مانند.
   */
  async create(input: {
    name?: unknown
    body?: unknown
    phones?: unknown
    includeBank?: unknown
    scheduledAt?: unknown
    userId?: number | null
  }): Promise<any> {
    /**
     * 🔒 لایه‌ی اول: قفل ورود دوباره.
     *
     * فراخوانی هم‌زمان (دو Enter پشت‌سرهم روی دیالوگ تأیید) تا وقتی ساخت
     * کمپین اول تمام نشده، رد می‌شود. بدون این، هر دو درخواست از گارد
     * «اثرانگشت» هم رد می‌شدند، چون هیچ‌کدام هنوز در نقشه ثبت نشده بود.
     */
    if (createInFlight)
      throw new BusinessError('یک کمپین دیگر همین حالا در حال ساخت است؛ چند لحظه صبر کنید و دوباره بزنید.')
    createInFlight = true
    try {
      return await smsCampaignService._createInternal(input)
    } finally {
      createInFlight = false
    }
  },

  /**
   * ⚠️ مستقیم صدا نزنید: گارد «ثبت دوباره» در `create` است. این متد فقط بدنه‌ی
   * کار است تا `finally` بتواند قفل را آزاد کند.
   */
  async _createInternal(input: {
    name?: unknown
    body?: unknown
    phones?: unknown
    includeBank?: unknown
    scheduledAt?: unknown
    userId?: number | null
  }): Promise<any> {
    const bodyRaw = String(input?.body ?? '').trim()
    const check = validateSmsBody(bodyRaw)
    if (!check.ok) throw new BusinessError(check.reason)

    const audience = await buildAudience(input)
    if (!audience.phones.length)
      throw new BusinessError('هیچ شماره‌ی قابل ارسالی پیدا نشد (نامعتبر، تکراری یا لغوکرده).')

    let scheduledAt: Date | null = null
    if (input?.scheduledAt) {
      scheduledAt = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(String(input.scheduledAt))
      if (Number.isNaN(scheduledAt.getTime())) throw new BusinessError('زمان ارسال نامعتبر است.')
    }

    const note = await currentOptOutNote()
    const finalBody = smsWithOptOutNote(bodyRaw, note)
    const segments = smsSegments(finalBody)
    const price = await pricePerSegment()
    const sendable = audience.phones.length
    const cost = smsCostEstimate(segments, sendable, price)
    const name = String(input?.name ?? '').trim() || `کمپین ${new Date().toISOString().slice(0, 10)}`

    /**
     * 🔒 لایه‌ی دوم: همان کمپین، چند لحظه پیش.
     *
     * اگر Enter دوباره چند ثانیه بعد برسد (دیالوگ تأیید یا دکمه‌ی UI)، این گارد
     * جلویش را می‌گیرد. مقایسه روی **متن نهایی + فهرست واقعی شماره‌ها + زمان
     * ارسال** است؛ پس دو نیمه‌ی یک فهرست (که شماره‌هایشان فرق دارد) یا کمپین
     * فردا (که زمانش فرق دارد) اشتباهاً رد نمی‌شوند.
     */
    const fingerprint = campaignFingerprint(finalBody, audience.phones, scheduledAt)
    const nowMs = Date.now()
    if (fingerprintSeenRecently(fingerprint, nowMs))
      throw new BusinessError(
        'همین کمپین چند لحظه پیش ساخته شد (همان متن و همان شماره‌ها). برای فرستادن دوباره چند لحظه صبر کنید تا از ارسال تکراری به همه‌ی مشتریان جلوگیری شود.'
      )

    /**
     * 🔒 «همه یا هیچ» — کمپین نیمه‌کاره ممنوع.
     *
     * قبلاً اول کمپین ساخته می‌شد، بعد در یک حلقه پیام‌ها در صف می‌نشستند و
     * خطای وسط راه فقط داخل شمارنده‌ها می‌افتاد. اگر همان لحظه برنامه می‌مُرد یا
     * یکی از درج‌ها شکست می‌خورد، کمپینی با وضعیت «در صف» می‌ماند که بخشی از
     * شماره‌هایش هیچ ردیفی در صف نداشتند — یعنی پیام‌های گم‌شده و بی‌سابقه.
     *
     * حالا ساخت کمپین، صف‌کردن همه‌ی پیام‌ها و نوشتن شمارنده‌ها در **یک تراکنش**
     * انجام می‌شود: هر خطایی همه‌چیز را برمی‌گرداند و به کاربر گفته می‌شود دوباره
     * تلاش کند. (`enqueueSms` با strict صدا زده می‌شود تا خطا را بی‌صدا قورت ندهد.)
     */
    let campaign: any = null
    let updated: any = null
    let queued = 0
    let failed = 0
    try {
      const txOut = await (prisma as any).$transaction(
        async (tx: any) => {
          const created = await tx.smsCampaign.create({
            data: {
              name,
              body: finalBody,
              audienceSource: sourceOf(audience, Boolean(input?.includeBank), String(input?.phones ?? '').trim().length > 0),
              optOutNote: note,
              audienceCount: sendable,
              segments,
              costEstimate: cost.toman,
              status: 'QUEUED',
              scheduledAt,
              createdByUserId: input?.userId ?? null
            }
          })

          let q = 0
          let f = 0
          for (const phone of audience.phones) {
            const res = await enqueueSms(
              {
                eventType: 'CAMPAIGN',
                phone,
                body: finalBody,
                campaignId: created.id,
                relatedEntity: 'SmsCampaign',
                relatedEntityId: created.id,
                priority: SMS_CAMPAIGN_PRIORITY,
                scheduledAt,
                dedupeKey: smsDedupeKey({
                  eventType: 'CAMPAIGN',
                  entityType: 'SmsCampaign',
                  entityId: created.id,
                  templateCode: 'CAMPAIGN',
                  phone
                }),
                createdByUserId: input?.userId ?? null
              },
              { client: tx, strict: true }
            )
            if (res.ok) q++
            else f++
          }

          const upd = await tx.smsCampaign.update({
            where: { id: created.id },
            data: {
              queuedCount: q,
              skippedCount: f,
              optOutSkipped: audience.optOutSkipped,
              invalidCount: audience.invalid.length,
              duplicateCount: audience.duplicates
            }
          })
          return { created, upd, q, f }
        },
        // ثبت هزار شماره در یک تراکنش چند ثانیه طول می‌کشد؛ مهلت پیش‌فرض
        // پنج‌ثانیه‌ای پریزما کم است و کمپین بزرگ را بی‌دلیل رد می‌کرد.
        { timeout: 120_000, maxWait: 15_000 }
      )
      campaign = txOut.created
      updated = txOut.upd
      queued = txOut.q
      failed = txOut.f
    } catch (e: any) {
      await audit(prisma, {
        action: AuditAction.SMS_CAMPAIGN_CREATE,
        entity: 'SmsCampaign',
        entityId: null,
        userId: input?.userId ?? null,
        note: `ثبت کمپین «${name}» ناموفق بود و هیچ پیامی در صف نماند · ${String(e?.message ?? e).slice(0, 120)}`
      })
      throw new BusinessError('ثبت کمپین کامل نشد و هیچ پیامی در صف نماند؛ لطفاً دوباره تلاش کنید.')
    }

    await audit(prisma, {
      action: AuditAction.SMS_CAMPAIGN_CREATE,
      entity: 'SmsCampaign',
      entityId: campaign.id,
      userId: input?.userId ?? null,
      after: JSON.stringify({
        name,
        sendable,
        queued,
        failed,
        costEstimate: cost.toman,
        scheduledAt
      }),
      note:
        `ثبت کمپین «${name}» برای ${sendable} شماره · ${queued} پیام در صف` +
        (audience.optOutSkipped ? ` · ${audience.optOutSkipped} شماره به‌خاطر «لغو ۱۱» کنار گذاشته شد` : '') +
        (scheduledAt ? ' · زمان‌بندی‌شده' : '')
    })

    // کمپین واقعاً ثبت شد ⇒ اثرانگشتش را نگه می‌داریم تا دوباره ثبت نشود.
    recentFingerprints.set(fingerprint, nowMs)

    return { campaign: updated, queued, failed }
  },

  /** فهرست کمپین‌ها با شمارنده‌ی زنده‌ی وضعیت صف. */
  async list(input: { take?: unknown; skip?: unknown } = {}): Promise<any> {
    const take = Math.min(200, Math.max(1, Math.round(Number(input?.take ?? 50)) || 50))
    const skip = Math.max(0, Math.round(Number(input?.skip ?? 0)) || 0)
    const rows = await (prisma as any).smsCampaign.findMany({
      orderBy: { id: 'desc' },
      take,
      skip
    })
    const total = await (prisma as any).smsCampaign.count()

    const out: any[] = []
    for (const c of rows ?? []) {
      const all = await (prisma as any).smsOutbox.findMany({
        where: { campaignId: c.id },
        select: { status: true }
      })
      const by: Record<string, number> = {}
      for (const r of all ?? []) by[r.status] = (by[r.status] ?? 0) + 1
      out.push({
        ...c,
        statusCounts: by,
        sentCount: by['SENT'] ?? 0,
        pendingCount: (by['PENDING'] ?? 0) + (by['PROCESSING'] ?? 0),
        failedCount: (by['FAILED_FINAL'] ?? 0) + (by['FAILED_RETRYABLE'] ?? 0) + (by['UNKNOWN'] ?? 0),
        canceledCount: by['CANCELED'] ?? 0
      })
    }
    return { rows: out, total }
  },

  async detail(idInput: number): Promise<any> {
    const id = Math.round(Number(idInput))
    if (!Number.isFinite(id) || id <= 0) throw new BusinessError('شناسه‌ی کمپین نامعتبر است.')
    const campaign = await (prisma as any).smsCampaign.findUnique({ where: { id } })
    if (!campaign) throw new BusinessError('کمپین پیدا نشد.')
    const rows = await (prisma as any).smsOutbox.findMany({
      where: { campaignId: id },
      orderBy: { id: 'asc' },
      take: 500
    })
    return { campaign, rows }
  },

  /**
   * «لغو گروهی» — فقط پیام‌های **ارسال‌نشده**‌ی همین کمپین لغو می‌شوند.
   *
   * چرا عمداً «فقط ارسال‌نشده»: پیامی که رفته، رفت؛ لغو کردنش فقط سابقه را
   * دروغ می‌کند. این همان قاعده‌ی `isSmsCancelable` است که در صف هم هست.
   */
  async cancel(
    idInput: number,
    input: { reason?: unknown; userId?: number | null } = {}
  ): Promise<{ canceled: number }> {
    const id = Math.round(Number(idInput))
    if (!Number.isFinite(id) || id <= 0) throw new BusinessError('شناسه‌ی کمپین نامعتبر است.')
    const campaign = await (prisma as any).smsCampaign.findUnique({ where: { id } })
    if (!campaign) throw new BusinessError('کمپین پیدا نشد.')
    if (String(campaign.status) === 'CANCELED') throw new BusinessError('این کمپین قبلاً لغو شده است.')

    const now = new Date()
    const reason = String(input?.reason ?? '').trim() || null
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { campaignId: id, status: { in: [...SMS_CANCELABLE_STATUSES] } },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        canceledByUserId: input?.userId ?? null,
        cancelReason: reason,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null
      }
    })
    const canceled = Number(res?.count ?? 0)

    await (prisma as any).smsCampaign.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: now, canceledByUserId: input?.userId ?? null, cancelReason: reason }
    })

    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_CANCEL_BULK,
      entity: 'SmsCampaign',
      entityId: id,
      userId: input?.userId ?? null,
      after: JSON.stringify({ canceled }),
      note: `لغو گروهی کمپین «${campaign.name}» · ${canceled} پیام ارسال‌نشده لغو شد` + (reason ? ` · دلیل: ${reason}` : '')
    })

    return { canceled }
  }
}

// ---------------------------------------------------------------------------
// دفتر انصراف («لغو ۱۱»)
// ---------------------------------------------------------------------------

export const smsOptOutService = {
  async list(input: { take?: unknown; skip?: unknown } = {}): Promise<any> {
    const take = Math.min(500, Math.max(1, Math.round(Number(input?.take ?? 100)) || 100))
    const skip = Math.max(0, Math.round(Number(input?.skip ?? 0)) || 0)
    const rows = await (prisma as any).smsOptOut.findMany({ orderBy: { id: 'desc' }, take, skip })
    const total = await (prisma as any).smsOptOut.count()
    return { rows, total }
  },

  /** ثبت انصراف — تکراری هم خطا نیست: «قبلاً ثبت شده» جواب درست است. */
  async add(input: { phone?: unknown; source?: unknown; reason?: unknown; userId?: number | null }): Promise<any> {
    const phone = normalizeSmsPhone(input?.phone)
    if (!phone) throw new BusinessError('شماره‌ی موبایل معتبر نیست.')
    const existing = await (prisma as any).smsOptOut.findUnique({ where: { phone } })
    if (existing) return { ...existing, already: true }

    const row = await (prisma as any).smsOptOut.create({
      data: {
        phone,
        source: String(input?.source ?? 'PANEL'),
        reason: String(input?.reason ?? '').trim() || null,
        createdByUserId: input?.userId ?? null
      }
    })
    await audit(prisma, {
      action: AuditAction.SMS_OPT_OUT_ADD,
      entity: 'SmsOptOut',
      entityId: row.id,
      userId: input?.userId ?? null,
      note: `ثبت انصراف پیامک تبلیغاتی برای شماره ***${phone.slice(-4)}`
    })
    return { ...row, already: false }
  },

  /** حذف انصراف = «اشتباه ثبت شده بود» یا «خودش گفته دوباره بفرست». */
  async remove(idInput: number, input: { userId?: number | null } = {}): Promise<{ removed: boolean }> {
    const id = Math.round(Number(idInput))
    const row = await (prisma as any).smsOptOut.findUnique({ where: { id } })
    if (!row) throw new BusinessError('این شماره در فهرست انصراف نیست.')
    await (prisma as any).smsOptOut.delete({ where: { id } })
    await audit(prisma, {
      action: AuditAction.SMS_OPT_OUT_REMOVE,
      entity: 'SmsOptOut',
      entityId: id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ phone: row.phone }),
      note: `حذف انصراف شماره ***${String(row.phone ?? '').slice(-4)}`
    })
    return { removed: true }
  }
}

/** برای مسیرهای دیگر (ایمپورت/اسکریپت) — یک شماره لغو کرده یا نه. */
export async function isSmsOptedOut(phone: unknown): Promise<boolean> {
  const p = normalizeSmsPhone(phone)
  if (!p) return false
  const row = await (prisma as any).smsOptOut.findUnique({ where: { phone: p } }).catch(() => null)
  return Boolean(row)
}

/** نوع رویداد کمپین — برای جاهایی که رشته‌ی خام لازم است. */
export const CAMPAIGN_EVENT_TYPE: SmsEventType = 'CAMPAIGN'
