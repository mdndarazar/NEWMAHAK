/**
 * ===========================================================================
 * پنل پیامکی — سرویسِ رو به بیرون.
 *
 * این فایل تنها دری است که بقیه‌ی برنامه از آن با ماژول پیامک حرف می‌زند.
 * هیچ سرویس دیگری (فروش، اعتبار، گزارش) مستقیماً به جدول‌های پیام دست
 * نمی‌زند و برعکس: این ماژول هم هیچ محاسبه‌ی مالی‌ای انجام نمی‌دهد.
 *
 * ⚠️ همه‌ی کانال‌های نوشتنیِ این سرویس در لایه‌ی IPC پشت قفل پنل‌اند
 * (`PANEL_KEYS.smsPanel` و برای کارهای حساس `assertManagerPassword`).
 * ===========================================================================
 */
import { prisma } from '../../db/client'
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'
import { AuditAction } from '@shared/enums'
import { toJalaliDate, toClock, jalaliToday, jalaliToDateTime, jalaliEndOfDay, faDigits } from '@shared/jalali'
import {
  SmsOutboxStatus,
  SMS_STATUS_LABELS,
  SMS_LIVE_STATUSES,
  smsEventLabel,
  smsCostEstimate,
  smsSegments,
  normalizeSmsPhone,
  renderSmsTemplate,
  smsDedupeKey,
  SMS_SETTING_KEYS,
  DEFAULT_SMS_AUTO,
  DEFAULT_SMS_OPT_OUT_NOTE,
  parseSmsAuto,
  isSmsAutoDue,
  SMS_DUPLICATE_GUARD_STATUSES,
  smsWithOptOutNote,
  smsAutoDayKey,
  pickSmsLine,
  parseSmsSwitch,
  DEFAULT_SMS_THANK_YOU,
  smsNeedsOptOutNote,
  validateSmsBody,
  isSmsCancelable,
  isSmsRequeueable,
  SMS_MANUAL_DEDUPE_WINDOW_MS,
  smsReminderManualResendBlocked,
  SMS_CAMPAIGN_PRIORITY,
  type SmsAutoSettings
} from '@shared/sms'
import { enqueueSms, smsQueueService, startSmsQueue, recoverStale, runSmsQueueOnce } from './SmsQueue'
import { notifySaleCreated, thankYouEnabled } from './SmsSaleNotify'
import { smsTemplateService, DEFAULT_SMS_TEMPLATES } from './SmsTemplates'
import { smsCredentialService, activeLines } from './SmsCredentials'

const db = prisma as any

// ---------------------------------------------------------------------------
// تنظیمات (روی جدول `Setting` — بدون migration)
// ---------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return row?.value ?? null
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export interface SmsSettings {
  auto: SmsAutoSettings
  /** کلید سراسری «تشکر از خرید» (یک کلید برای تکی و عمده) */
  thankYou: boolean
  pricePerSegment: number
  optOutNote: string
  storeName: string
  storePhone: string
}

export const smsService = {
  /**
   * راه‌اندازی ماژول هنگام بالا آمدن برنامه.
   *   • قالب‌های سیستمی جاافتاده ساخته می‌شوند (بدون بازنویسی متن کاربر)،
   *   • قفل‌های یتیم آزاد می‌شوند،
   *   • کارگر دوره‌ای روشن می‌شود.
   * هیچ‌کدام از این‌ها به فروش یا اعتبار کاری ندارد.
   */
  async start(): Promise<{ templatesCreated: number; recovered: number }> {
    let templatesCreated = 0
    let recovered = 0
    try {
      templatesCreated = await smsTemplateService.ensureDefaults()
    } catch (e) {
      console.error('[sms:seed] failed', e)
    }
    try {
      recovered = await recoverStale()
    } catch (e) {
      console.error('[sms:recover] failed', e)
    }
    startSmsQueue()
    // زمان‌بند یادآوری: بدون منبع تزریقی، فقط بی‌کار می‌ماند (و هیچ خطایی نمی‌دهد).
    startSmsAuto()
    return { templatesCreated, recovered }
  },

  async settings(): Promise<SmsSettings> {
    const [autoRaw, priceRaw, noteRaw, thankRaw] = await Promise.all([
      readSetting(SMS_SETTING_KEYS.auto),
      readSetting(SMS_SETTING_KEYS.pricePerSegment),
      readSetting(SMS_SETTING_KEYS.optOutNote),
      readSetting(SMS_SETTING_KEYS.thankYou)
    ])
    const storeName = (await readSetting('receipt.storeName')) ?? ''
    const storePhone = (await readSetting('receipt.storePhone')) ?? ''
    const price = Math.round(Number(priceRaw ?? 0))
    return {
      auto: parseSmsAuto(autoRaw),
      thankYou: parseSmsSwitch(thankRaw, DEFAULT_SMS_THANK_YOU),
      pricePerSegment: Number.isFinite(price) && price > 0 ? price : 0,
      optOutNote: noteRaw != null && String(noteRaw).trim() !== '' ? String(noteRaw) : DEFAULT_SMS_OPT_OUT_NOTE,
      storeName: String(storeName ?? ''),
      storePhone: String(storePhone ?? '')
    }
  },

  async saveSettings(
    input: { auto?: unknown; thankYou?: unknown; pricePerSegment?: unknown; optOutNote?: unknown },
    userId?: number | null
  ): Promise<SmsSettings> {
    const before = await smsService.settings()

    if (input?.auto !== undefined) {
      const auto = parseSmsAuto(typeof input.auto === 'string' ? input.auto : JSON.stringify(input.auto))
      await writeSetting(SMS_SETTING_KEYS.auto, JSON.stringify(auto))
    }
    if (input?.pricePerSegment !== undefined) {
      const n = Math.round(Number(input.pricePerSegment))
      await writeSetting(SMS_SETTING_KEYS.pricePerSegment, String(Number.isFinite(n) && n > 0 ? n : 0))
    }
    if (input?.thankYou !== undefined) {
      await writeSetting(SMS_SETTING_KEYS.thankYou, String(parseSmsSwitch(input.thankYou, DEFAULT_SMS_THANK_YOU)))
    }
    if (input?.optOutNote !== undefined) {
      const v = String(input.optOutNote ?? '').trim() || DEFAULT_SMS_OPT_OUT_NOTE
      await writeSetting(SMS_SETTING_KEYS.optOutNote, v)
    }

    const after = await smsService.settings()
    await audit(prisma, {
      action: AuditAction.SMS_SETTINGS_UPDATE,
      entity: 'Setting',
      entityId: null,
      userId: userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      note:
        `ویرایش تنظیمات پنل پیامکی · یادآوری خودکار: ${after.auto.enabled ? 'روشن' : 'خاموش'}` +
        ` · تشکر از خرید: ${after.thankYou ? 'روشن' : 'خاموش'}` +
        (after.auto.enabled ? ` ساعت ${String(after.auto.hour).padStart(2, '0')}:${String(after.auto.minute).padStart(2, '0')}` : '')
    })
    return after
  },

  // -------------------------------------------------------------------------
  // داشبورد و فهرست‌ها
  // -------------------------------------------------------------------------

  async dashboard(): Promise<any> {
    const today = jalaliToday()
    const dayStart = jalaliToDateTime(`${today} 00:00:00`)
    const dayEnd = jalaliEndOfDay(today)

    const counts = await db.smsOutbox.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => [])
    const byStatus: Record<string, number> = {}
    for (const row of counts ?? []) byStatus[String(row.status)] = Math.round(Number(row._count?._all ?? 0))

    const todaySent = await db.smsOutbox
      .count({ where: { status: SmsOutboxStatus.SENT, sentAt: { gte: dayStart, lte: dayEnd } } })
      .catch(() => 0)

    const scheduled = await db.smsOutbox
      .count({
        where: { status: SmsOutboxStatus.PENDING, scheduledAt: { not: null, gt: new Date() } }
      })
      .catch(() => 0)

    const active = await smsCredentialService.active()
    /** خط خدماتی و خط تبلیغاتی جدا گزارش می‌شوند تا پنل بتواند دقیق هشدار بدهد. */
    const lines = await activeLines()
    const lineService = pickSmsLine(lines, 'SERVICE')
    const lineAds = pickSmsLine(lines, 'ADS')
    const settings = await smsService.settings()

    const lastSent = await db.smsOutbox
      .findFirst({ where: { status: SmsOutboxStatus.SENT }, orderBy: { sentAt: 'desc' } })
      .catch(() => null)

    return {
      byStatus,
      /**
       * کلید «تشکر از خرید» در خودِ داشبورد هم می‌آید تا پنل برای نشان‌دادن
       * نوار «روشنش کن» مجبور نباشد یک کانال دیگر بزند (و در تب داشبورد که
       * تنظیمات بارگذاری نمی‌شود، وضعیت درست دیده شود).
       */
      thankYou: settings.thankYou,
      pending: SMS_LIVE_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      todaySent: Math.round(Number(todaySent) || 0),
      scheduled: Math.round(Number(scheduled) || 0),
      failedFinal: byStatus[SmsOutboxStatus.FAILED_FINAL] ?? 0,
      unknown: byStatus[SmsOutboxStatus.UNKNOWN] ?? 0,
      sent: byStatus[SmsOutboxStatus.SENT] ?? 0,
      canceled: byStatus[SmsOutboxStatus.CANCELED] ?? 0,
      provider: active,
      providerService: lineService,
      providerAds: lineAds,
      auto: settings.auto,
      lastSentAtJalali: lastSent?.sentAt ? toJalaliDate(new Date(lastSent.sentAt)) : null,
      lastSentAtTime: lastSent?.sentAt ? toClock(new Date(lastSent.sentAt)) : null
    }
  },

  /** فهرست پیام‌ها با فیلترهای سبک (همه در main اعمال می‌شوند). */
  async list(
    filter: {
      status?: string | null
      eventType?: string | null
      fromJalali?: string | null
      toJalali?: string | null
      search?: string | null
      take?: number
      skip?: number
      onlyScheduled?: boolean
    } = {}
  ): Promise<{ rows: any[]; total: number; take: number; skip: number }> {
    const take = Math.min(500, Math.max(1, Math.round(Number(filter?.take ?? 100)) || 100))
    const skip = Math.max(0, Math.round(Number(filter?.skip ?? 0)) || 0)

    const where: any = {}
    if (filter?.status) where.status = String(filter.status)
    if (filter?.eventType) where.eventType = String(filter.eventType)
    if (filter?.onlyScheduled) {
      where.status = SmsOutboxStatus.PENDING
      where.scheduledAt = { not: null, gt: new Date() }
    }
    if (filter?.fromJalali || filter?.toJalali) {
      const range: any = {}
      const from = String(filter.fromJalali ?? '').trim()
      const to = String(filter.toJalali ?? '').trim()
      if (from) {
        try {
          range.gte = jalaliToDateTime(`${from} 00:00:00`)
        } catch {
          /* تاریخ نامعتبر ⇒ این سر بازه اعمال نمی‌شود */
        }
      }
      if (to) {
        try {
          range.lte = jalaliEndOfDay(to)
        } catch {
          /* همان */
        }
      }
      if (Object.keys(range).length) where.createdAt = range
    }
    const search = String(filter?.search ?? '').trim()
    if (search) where.phoneSnapshot = { contains: normalizeSmsPhone(search) || search }

    const [rows, total] = await Promise.all([
      db.smsOutbox.findMany({ where, orderBy: { id: 'desc' }, take, skip }),
      db.smsOutbox.count({ where })
    ])

    return { rows: (rows ?? []).map(shapeOutbox), total: Math.round(Number(total) || 0), take, skip }
  },

  /** جزئیات یک پیام + سابقه‌ی تلاش‌ها. */
  async detail(idInput: number): Promise<any> {
    const id = Math.round(Number(idInput))
    const row = await db.smsOutbox.findUnique({ where: { id } })
    if (!row) throw new BusinessError('این پیام پیدا نشد.')
    /** یادآوریِ سهمیه‌آزادشده: فقط از پنل اعتبار قابل ارسال است (نه از اینجا). */
    const reminderBlocked = smsReminderManualResendBlocked(row.eventType, row.status)
    const attempts = await db.smsAttempt.findMany({ where: { outboxId: id }, orderBy: { attemptNo: 'asc' } })
    return {
      message: shapeOutbox(row),
      attempts: (attempts ?? []).map((a: any) => ({
        id: a.id,
        attemptNo: Math.round(Number(a.attemptNo) || 0),
        startedAtJalali: a.startedAt ? toJalaliDate(new Date(a.startedAt)) : null,
        startedAtTime: a.startedAt ? toClock(new Date(a.startedAt)) : null,
        result: String(a.result ?? ''),
        httpStatus: a.httpStatus == null ? null : Math.round(Number(a.httpStatus)),
        providerMessageId: a.providerMessageId ?? null,
        errorCode: a.errorCode ?? null,
        errorMessage: a.errorMessage ?? null
      })),
      canCancel: isSmsCancelable(row.status),
      canRequeue: isSmsRequeueable(row.status) && !reminderBlocked,
      canRetry: row.status !== SmsOutboxStatus.SENT && row.status !== SmsOutboxStatus.PROCESSING && !reminderBlocked,
      reminderNeedsCreditPanel: reminderBlocked
    }
  },

  // -------------------------------------------------------------------------
  // ارسال دستی
  // -------------------------------------------------------------------------

  /**
   * برآورد هزینه و تعداد بخش‌ها — **قبل از** تأیید کاربر.
   * هیچ‌وقت تخمینِ خودکار از تعرفه نمی‌زنیم؛ قیمت را کاربر داده است.
   */
  async estimate(input: { body?: string; recipients?: unknown; pricePerSegment?: unknown }): Promise<any> {
    const settings = await smsService.settings()
    const body = String(input?.body ?? '')
    const segments = smsSegments(body)
    const count = Array.isArray(input?.recipients)
      ? input.recipients.length
      : Math.max(0, Math.round(Number(input?.recipients) || 0))
    const price =
      input?.pricePerSegment != null
        ? Math.max(0, Math.round(Number(input.pricePerSegment) || 0))
        : settings.pricePerSegment
    const est = smsCostEstimate(segments, count, price)
    return {
      segments,
      recipients: count,
      messages: est.messages,
      toman: est.toman,
      pricePerSegment: price,
      filled: price > 0
    }
  },

  /**
   * ارسال دستی یک پیام به یک شماره.
   * `scheduledAt` خالی ⇒ در اولین فرصت.
   */
  async sendManual(input: {
    phone?: unknown
    body?: string
    templateCode?: string | null
    customerId?: number | null
    customerName?: string | null
    scheduledAt?: string | Date | null
    /** پیام تبلیغاتی است؟ (خط تبلیغاتی + «لغو ۱۱» + احترام به لغوکرده‌ها) */
    advertising?: boolean
    userId?: number | null
  }): Promise<any> {
    const phone = normalizeSmsPhone(input?.phone)
    if (!phone) throw new BusinessError('شماره‌ی موبایل معتبر نیست.')

    const body = String(input?.body ?? '').trim()
    if (!body) throw new BusinessError('متن پیام خالی است.')
    const check = validateSmsBody(body)
    if (!check.ok) throw new BusinessError(check.reason)

    let scheduledAt: Date | null = null
    if (input?.scheduledAt) {
      scheduledAt = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt)
      if (Number.isNaN(scheduledAt.getTime())) throw new BusinessError('زمان ارسال نامعتبر است.')
    }

    /**
     * ⏱ «دو بار کلیک ⇒ یک پیام» — همین‌جا، نه فقط در UI.
     *
     * کلید یکتا با `Date.now()` و `Math.random()` ساخته می‌شد؛ یعنی هر کلیک
     * (یا هر بار فراخوانی IPC) یک ردیف تازه می‌ساخت و همان متن دو بار می‌رفت.
     * حالا اگر همین متن برای همین شماره چند لحظه پیش ثبت شده باشد، همان پیام
     * برگردانده می‌شود.
     */
    const wantsAds = input?.advertising === true
    const eventType = wantsAds ? 'CAMPAIGN' : 'MANUAL'
    /**
     * 🔴 دو باگ بازبینی سوم، همین‌جا رفع شده‌اند:
     *
     * ۱) **متنِ مقایسه اشتباه بود.** برای پیام تبلیغاتی، `enqueueSms` جمله‌ی
     *    «لغو ۱۱» را به متن می‌چسباند و *آن* را در `bodySnapshot` می‌نویسد.
     *    مقایسه با متن خام هیچ‌وقت جواب نمی‌داد ⇒ تبلیغ دستیِ دوبار کلیک‌شده
     *    دو بار می‌رفت. حالا همان متنی مقایسه می‌شود که واقعاً ذخیره می‌شود.
     * ۲) **فیلتر وضعیت نبود.** ردیف `CANCELED`/`FAILED_FINAL` هم «تکراری»
     *    شمرده می‌شد و با `ok:true` برگردانده می‌شد ⇒ کاربر پیام «ثبت شد»
     *    می‌دید ولی هیچ پیامی هرگز نمی‌رفت. فقط وضعیت‌هایی که پیام در آن‌ها
     *    واقعاً زنده یا رفته است، «تکراری» حساب می‌شوند.
     */
    const twinBody = smsNeedsOptOutNote(eventType)
      ? smsWithOptOutNote(body, (await smsService.settings()).optOutNote)
      : body
    const twin = await db.smsOutbox
      .findFirst({
        where: {
          eventType,
          phoneSnapshot: phone,
          bodySnapshot: twinBody,
          status: { in: [...SMS_DUPLICATE_GUARD_STATUSES] },
          createdAt: { gte: new Date(Date.now() - SMS_MANUAL_DEDUPE_WINDOW_MS) }
        },
        orderBy: { id: 'desc' }
      })
      .catch(() => null)
    if (twin) {
      return {
        ok: true,
        id: twin.id,
        duplicate: true,
        skipped: false,
        detail: 'همین پیام چند لحظه پیش ثبت شده بود؛ دوباره ساخته نشد.',
        scheduledAtJalali: twin.scheduledAt ? toJalaliDate(new Date(twin.scheduledAt)) : null,
        scheduledAtTime: twin.scheduledAt ? toClock(new Date(twin.scheduledAt)) : null
      }
    }

    const res = await enqueueSms({
      eventType,
      phone,
      body,
      templateCode: input?.templateCode ?? null,
      customerId: input?.customerId ?? null,
      customerName: input?.customerName ?? null,
      dedupeKey: smsDedupeKey({
        eventType,
        entityType: 'Manual',
        entityId: `${phone}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        templateCode: input?.templateCode ?? 'MANUAL',
        phone
      }),
      /**
       * تبلیغ دستی هم مثل کمپین ته صف می‌ایستد: پیام خدماتی مشتری (تشکر/یادآوری)
       * نباید پشت تبلیغ بماند. خطش هم خودکار «تبلیغاتی» انتخاب می‌شود.
       */
      priority: wantsAds ? SMS_CAMPAIGN_PRIORITY : 3,
      scheduledAt,
      createdByUserId: input?.userId ?? null
    })

    if (res.skipped) throw new BusinessError(res.detail)

    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_ENQUEUE,
      entity: 'SmsOutbox',
      entityId: res.id,
      userId: input?.userId ?? null,
      after: JSON.stringify({ phone, scheduledAt, templateCode: input?.templateCode ?? null }),
      note:
        `ثبت پیام ${wantsAds ? 'تبلیغاتیِ دستی' : 'دستی'} برای شماره ***${phone.slice(-4)}` +
        (scheduledAt ? ` · زمان‌بندی: ${toJalaliDate(scheduledAt)} ${toClock(scheduledAt)}` : ' · ارسال در اولین فرصت')
    })

    return {
      ...res,
      scheduledAtJalali: scheduledAt ? toJalaliDate(scheduledAt) : null,
      scheduledAtTime: scheduledAt ? toClock(scheduledAt) : null
    }
  },

  // -------------------------------------------------------------------------
  // اجرای دستی صف
  // -------------------------------------------------------------------------

  /** یک دور زمان‌بند خودکار (برای تست و برای «همین حالا»ی مدیر). */
  runAutoOnce(now?: Date, userId?: number | null) {
    return runSmsAutoOnce(now ?? new Date(), userId ?? null)
  },

  /** «الان بفرست» — یک دور کامل صف را همین حالا اجرا می‌کند. */
  async runNow(userId?: number | null): Promise<any> {
    const out = await runSmsQueueOnce()
    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_ENQUEUE,
      entity: 'SmsOutbox',
      entityId: null,
      userId: userId ?? null,
      after: JSON.stringify(out),
      note: `اجرای دستی صف پیامک · ارسال‌شده: ${out.sent} · ناموفق: ${out.failed}`
    })
    return out
  },

  /**
   * قلاب «تشکر از خرید».
   *
   * ⚠️ از لایه‌ی IPC و **بعد از** برگشتن فاکتور صدا زده می‌شود (fire-and-forget).
   * این تابع خودش هم هرگز throw نمی‌کند، پس دو لایه محافظت وجود دارد.
   */
  notifySaleCreated,
  thankYouEnabled,

  queue: smsQueueService,
  templates: smsTemplateService,
  providers: smsCredentialService,
  defaultTemplates: DEFAULT_SMS_TEMPLATES,
  /** برای تست: ساخت پیامِ «تشکر از خرید» با همه‌ی جای‌گذاری‌ها. */
  _render: renderSmsTemplate,
  _smsNeedsOptOutNote: smsNeedsOptOutNote
}

// ---------------------------------------------------------------------------
// زمان‌بند «یادآوری خودکار اعتبار»
// ---------------------------------------------------------------------------

/**
 * منبعی که زمان‌بند از آن کاندید می‌گیرد و ثبت می‌کند.
 *
 * ⚠️ چرا **تزریقی** و نه import مستقیم: تصمیم «چه کسی باید یادآوری بگیرد»
 * مالِ ماژول اعتبار خرید است (سهمیه، فاصله‌ی مجاز، انصراف، پنجره‌ی انقضا).
 * ماژول پیامک نباید آن منطق را دوباره بنویسد و نباید به آن سرویس وابسته شود.
 * پس بوت برنامه، دو تابع از ماژول اعتبار را همین‌جا تزریق می‌کند.
 */
export interface SmsReminderSource {
  readonly name: string
  /** کاندیدهای واجد شرایطِ همین لحظه (فقط تصمیم‌گرفته‌شده‌ها) */
  candidates(input: { limit?: number }): Promise<Array<{ id: number }>>
  /** ثبت یادآوری برای یک کاندید — کوچ اعتبار و سهمیه سمت اعتبار می‌ماند */
  queue(input: { id: number; userId?: number | null }): Promise<unknown>
}

let reminderSource: SmsReminderSource | null = null
let autoTimer: NodeJS.Timeout | null = null
let autoRunning = false

export function setSmsReminderSource(src: SmsReminderSource | null): void {
  reminderSource = src ?? null
}

/** برای تست/UI: آیا منبع یادآوری وصل شده است؟ */
export function smsReminderSourceName(): string | null {
  return reminderSource?.name ?? null
}

/**
 * یک دور زمان‌بند. **قابل تست** (زمان تزریقی) و **بی‌خطر**:
 *
 *   • خاموش بودن کلید ⇒ هیچ کاری نمی‌کند (دستی همیشه کار می‌کند).
 *   • «هر روز یک بار» با کلید `sms.auto.lastRun` تضمین می‌شود؛ روز **قبل**
 *     از پردازش نشان‌گذاری می‌شود تا خطای میان‌راه، حلقه‌ی روزانه نسازد.
 *   • ⚠️ ولی اگر همان دور **هیچ‌کدام** از یادآوری‌ها را ثبت نکرد (خطای خواندن
 *     کاندیدها یا شکست همه‌ی کاندیدها)، نشانه پاک می‌شود تا نوبت بعدی دوباره
 *     تلاش کند — «تأخیر مجاز، گم‌شدن هرگز». پاک‌کردن بی‌خطر است چون کلید
 *     یکتای هر یادآوری به «روز» گره خورده و اجرای دوباره پیام تکراری نمی‌سازد.
 *   • خطای یک کاندید، بقیه را متوقف نمی‌کند.
 */
export async function runSmsAutoOnce(
  now: Date = new Date(),
  userId?: number | null
): Promise<{ ran: boolean; queued: number; detail: string }> {
  const auto: SmsAutoSettings = parseSmsAuto(await readSetting(SMS_SETTING_KEYS.auto))
  if (!auto.enabled) return { ran: false, queued: 0, detail: 'ارسال خودکار یادآوری خاموش است.' }
  if (!isSmsAutoDue(auto, now))
    return { ran: false, queued: 0, detail: 'هنوز وقت اجرای زمان‌بند نشده است.' }
  if (!reminderSource) return { ran: false, queued: 0, detail: 'منبع یادآوری اعتبار وصل نشده است.' }

  const day = smsAutoDayKey(now)
  const last = String((await readSetting(SMS_SETTING_KEYS.autoLastRun)) ?? '').trim()
  if (last === day) return { ran: false, queued: 0, detail: 'امروز یک بار اجرا شده است.' }

  // «امروز یک بار» گاردِ هم‌زمانی است: جلوِ دو اجرای موازی را می‌گیرد.
  /**
   * پاک‌کردن نشانه‌ی «امروز اجرا شد».
   *
   * فقط وقتی صدا زده می‌شود که دور جاری **هیچ** یادآوری‌ای را در صف نگذاشته
   * باشد؛ آن‌وقت نگه‌داشتن نشانه یعنی «امروز دیگر تلاش نکن» و یادآوری‌ها بی‌صدا
   * یک روز عقب می‌افتند. اجرای دوباره امن است: کلید یکتای هر یادآوری شامل روز
   * است، پس همان‌ها دوباره ساخته نمی‌شوند (`res.duplicate`).
   */
  const clearDayMarker = () => writeSetting(SMS_SETTING_KEYS.autoLastRun, '')

  await writeSetting(SMS_SETTING_KEYS.autoLastRun, day)

  let queued = 0
  let failed = 0
  let candidates: Array<{ id: number }> = []
  try {
    candidates = await reminderSource.candidates({ limit: 200 })
  } catch (e: any) {
    await audit(prisma, {
      action: AuditAction.SMS_AUTO_RUN,
      entity: 'SmsAuto',
      entityId: null,
      userId: userId ?? null,
      note: `زمان‌بند خودکار یادآوری اعتبار: خواندن فهرست کاندیدها ناموفق بود · ${String(e?.message ?? e).slice(0, 120)}`
    })
    await clearDayMarker()
    return {
      ran: false,
      queued: 0,
      detail: 'خواندن فهرست یادآوری‌ها ناموفق بود؛ چند دقیقه دیگر دوباره تلاش می‌شود.'
    }
  }

  for (const c of candidates) {
    try {
      await reminderSource.queue({ id: c.id, userId: userId ?? null })
      queued++
    } catch {
      failed++
    }
  }

  /**
   * اگر همه‌ی کاندیدها شکست خوردند (هیچ‌کدام در صف ننشست)، نشانه پاک می‌شود تا
   * دور بعدی دوباره تلاش کند. اگر حتی یکی ثبت شده باشد، نشانه می‌ماند؛ بقیه هم
   * در اجرای روز بعد دوباره بررسی می‌شوند.
   */
  const nothingQueued = queued === 0 && failed > 0
  if (nothingQueued) await clearDayMarker()

  await audit(prisma, {
    action: AuditAction.SMS_AUTO_RUN,
    entity: 'SmsAuto',
    entityId: null,
    userId: userId ?? null,
    after: JSON.stringify({ day, queued, failed, retryScheduled: nothingQueued }),
    note:
      `اجرای خودکار یادآوری اعتبار (${day}) · ثبت‌شده: ${queued}` +
      (failed ? ` · ناموفق: ${failed}` : '') +
      (nothingQueued ? ' · هیچ‌کدام ثبت نشد؛ دور بعدی دوباره تلاش می‌کند' : '')
  })

  if (nothingQueued)
    return { ran: false, queued: 0, detail: 'هیچ‌کدام از یادآوری‌ها ثبت نشد؛ چند دقیقه دیگر دوباره تلاش می‌شود.' }

  return { ran: true, queued, detail: `${queued} یادآوری در صف پیامک ثبت شد.` }
}

/** روشن‌کردن تیک زمان‌بند — هر ۵ دقیقه یک نگاه (پنجره‌ی مجاز هم ۵ دقیقه است). */
export function startSmsAuto(intervalMs = 5 * 60_000): void {
  stopSmsAuto()
  const tick = async () => {
    if (autoRunning) return
    autoRunning = true
    try {
      await runSmsAutoOnce(new Date(), null)
    } catch (e) {
      console.error('[sms:auto] failed', e)
    } finally {
      autoRunning = false
    }
  }
  autoTimer = setInterval(() => void tick(), Math.max(30_000, intervalMs))
  if (typeof autoTimer.unref === 'function') autoTimer.unref()
}

export function stopSmsAuto(): void {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
}

function shapeOutbox(row: any): any {
  const created = row.createdAt ? new Date(row.createdAt) : null
  const scheduled = row.scheduledAt ? new Date(row.scheduledAt) : null
  const status = String(row.status ?? SmsOutboxStatus.PENDING)
  /**
   * یادآوریِ اعتباری که سهمیه‌اش آزاد شده (لغو/ناموفقِ قطعی) فقط از پنل اعتبار
   * قابل ارسال است: آن مسیر سهمیه را مصرف می‌کند.
   */
  const blockedManualResend = smsReminderManualResendBlocked(row.eventType, status)
  return {
    id: row.id,
    status,
    statusLabel: SMS_STATUS_LABELS[status] ?? status,
    eventType: String(row.eventType ?? ''),
    eventLabel: smsEventLabel(row.eventType),
    phone: String(row.phoneSnapshot ?? ''),
    phoneTail: String(row.phoneSnapshot ?? '').slice(-4),
    customerName: row.customerNameSnapshot ?? null,
    customerId: row.customerId ?? null,
    body: String(row.bodySnapshot ?? ''),
    segments: Math.round(Number(row.segments ?? 1)) || 1,
    attemptCount: Math.round(Number(row.attemptCount ?? 0)) || 0,
    maxAttempts: Math.round(Number(row.maxAttempts ?? 0)) || 0,
    relatedEntity: row.relatedEntity ?? null,
    relatedEntityId: row.relatedEntityId ?? null,
    providerMessageId: row.providerMessageId ?? null,
    providerStatus: row.providerStatus ?? null,
    lastErrorCode: row.lastErrorCode ?? null,
    lastErrorMessage: row.lastErrorMessage ?? null,
    cancelReason: row.cancelReason ?? null,
    createdAtJalali: created ? toJalaliDate(created) : null,
    createdAtTime: created ? toClock(created) : null,
    scheduledAtJalali: scheduled ? toJalaliDate(scheduled) : null,
    scheduledAtTime: scheduled ? toClock(scheduled) : null,
    sentAtJalali: row.sentAt ? toJalaliDate(new Date(row.sentAt)) : null,
    sentAtTime: row.sentAt ? toClock(new Date(row.sentAt)) : null,
    lastAttemptAtJalali: row.lastAttemptAt ? toJalaliDate(new Date(row.lastAttemptAt)) : null,
    nextAttemptAtJalali: row.nextAttemptAt ? toJalaliDate(new Date(row.nextAttemptAt)) : null,
    nextAttemptAtTime: row.nextAttemptAt ? toClock(new Date(row.nextAttemptAt)) : null,
    canCancel: isSmsCancelable(status),
    canRequeue: isSmsRequeueable(status) && !blockedManualResend,
    canRetry: status !== SmsOutboxStatus.SENT && status !== SmsOutboxStatus.PROCESSING && !blockedManualResend,
    /** پرچم UI: به‌جای دکمه، راهنمای «از پنل اعتبار بفرستید» نشان بده */
    reminderNeedsCreditPanel: blockedManualResend
  }
}

/** خروجی کمکی برای UI: فهرست وضعیت‌ها با برچسب فارسی. */
export const SMS_STATUS_OPTIONS = Object.entries(SMS_STATUS_LABELS).map(([value, label]) => ({ value, label }))
export const SMS_EVENT_OPTIONS = [
  'SALE_THANK_YOU',
  'SALE_THANK_YOU_WHOLESALE',
  'CREDIT_REMINDER',
  'CREDIT_REMINDER_NO_EXPIRY',
  'CAMPAIGN',
  'MANUAL',
  'TEST'
].map((value) => ({ value, label: smsEventLabel(value) }))
export const SMS_DEFAULT_AUTO = DEFAULT_SMS_AUTO
export const faNum = faDigits
