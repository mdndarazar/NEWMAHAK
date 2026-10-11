import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { audit } from './AuditService'
import { assertManagerPassword } from './AuthService'
import { settingsService } from './SettingsService'
import { BusinessError } from '../errors'
import { AuditAction } from '@shared/enums'
import { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay, isValidJalaliDate, faDigits, money } from '@shared/jalali'
import type { PeriodLockStatus } from '@shared/types'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * ===========================================================================
 * جلسه ۱۵ · بند ۱۷ سند مرجع — «قفل دوره‌ی بسته‌شده».
 *
 * ================== چرا این ماژول وجود دارد؟ ==================
 * تا این نسخه، همه‌ی محاسبات بالا (صورت تعهدی، وجه واقعی، پل تطبیق، کسری صندوق)
 * یک **راه فرار** داشتند: بعد از «بستن صندوق» یا «تجمیع و انتقال» یک روز، هر
 * کسی می‌توانست یک فاکتور یا برگشتِ با تاریخ گذشته ثبت/ویرایش/حذف کند و همه‌ی
 * آن اعداد را دور بزند — بی هیچ گیت و بی هیچ ردی که *بگوید* این سند بعد از
 * بسته‌شدن دوره دست‌خورده است.
 *
 * ================== قاعده ==================
 * یک تاریخ «بسته» است اگر:
 *   • صندوقی بسته شده باشد که آن لحظه داخل بازه‌اش است (`CashSession.closedAt`)
 *     — یا —
 *   • آن روز تجمیع و انتقالِ نهایی شده باشد (`Consolidation.finalizedAt`).
 *
 * در دوره‌ی بسته، ثبت/ویرایش/حذف **ممنوع نیست، ولی آزاد هم نیست**: رمز مدیر +
 * «دلیل» اجباری + یک `AuditLog` کامل (قبل/بعد) لازم دارد. مسدود کردن کامل، کار
 * فروشگاه را می‌خواباند (اصلاح اشتباهِ واقعی هم لازم است)؛ آزاد گذاشتنش گزارش
 * را بی‌اعتبار می‌کند. این وسط، تنها جواب درست «گیت + رد پا» است.
 *
 * خاموش‌کردنی است: `AccountingPolicy.lockClosedPeriods` (پیش‌فرض روشن). خاموش
 * بودنش رفتار را مو‌به‌مو به قبل برمی‌گرداند.
 * ===========================================================================
 */
/** پیام واحد «دوره‌ی بسته» (هم در preverify و هم در assertOpen). */
function lockedMessage(what: string, state: PeriodLockStatus): string {
  return (
    `${what} در تاریخ ${faDigits(state.dayJalali)} ممکن نیست، چون این دوره بسته شده است:\n` +
    state.reasons.map((r) => `• ${r}`).join('\n') +
    '\nبرای ثبت اصلاحی در یک دوره‌ی بسته، «رمز مدیر» و «دلیل» اجباری است و هر دو با جزئیات کامل ' +
    'در سابقه‌ی تغییرات (AuditLog) ثبت می‌شوند.\n' +
    'اگر نمی‌خواهید اعداد دوره‌ی بسته دست بخورند، این سند را با تاریخ امروز ثبت کنید.'
  )
}

export const periodLockService = {
  /** وضعیت یک تاریخ: بسته است یا باز؟ فقط می‌خواند. */
  async status(input: { at?: Date | string | number | null; atJalali?: string | null } = {}): Promise<PeriodLockStatus> {
    const at =
      input.at != null
        ? new Date(input.at as any)
        : input.atJalali && isValidJalaliDate(input.atJalali)
          ? jalaliStartOfDay(input.atJalali)
          : new Date()
    const dayJalali = toJalaliDate(at)
    const policy = await settingsService.accountingPolicy()
    const reasons: string[] = []
    /** تاریخِ گذشته = روزی پیش از امروز. */
    const backdated = dayJalali < toJalaliDate(new Date())

    /**
     * نشست ۱۳۶ (DECISIONS S136-1) — سند با تاریخ دستیِ گذشته روی ساعت ۱۲:۰۰ آن
     * روز می‌نشیند (`jalaliToDateTime`). سنجش فقط با پنجره‌ی ساعتی نشست باعث
     * می‌شد روزی که صندوقش مثلاً ۱۴:۰۰ تا ۲۲:۰۰ بسته شده «باز» دیده شود و سند
     * گذشته‌نگر اعداد روز بسته را بی‌رمز عوض کند. برای روزهای گذشته، هر صندوق
     * بسته‌ای که با آن روز شمسی هم‌پوشانی دارد روز را بسته می‌کند. برای امروز،
     * همان سنجش لحظه‌ای می‌ماند تا بسته‌شدن شیفت صبح، شیفت بعدی همان روز را قفل نکند.
     */
    /**
     * ممیزی AUDIT-S136-01 (AUDIT-D65) — لحظه‌ی واقعیِ داخل نشستی که هنوز باز است
     * (شیفت شب ۲۰:۰۰ دیروز تا الان) در هیچ صندوق بسته‌ای شمرده نشده است. قاعده‌ی
     * روز شمسی برای آن فقط صندوق‌های بسته‌ای را می‌شمارد که تا بعد از همان لحظه
     * ادامه داشته‌اند؛ صندوق‌های بسته‌ی پیش از باز شدن این نشست (صبح/عصر) قفلش
     * نمی‌کنند. تاریخ دستی (۱۲:۰۰) پیش از باز شدن نشست، همان قاعده‌ی کامل روز را می‌گیرد.
     */
    const insideOpenShift = backdated
      ? (await prisma.shift.findFirst({
          where: { closedAt: null, openedAt: { lte: at } },
          select: { id: true }
        })) != null
      : false
    const sessionWhere = backdated
      ? {
          closedAt: { not: null },
          fromDate: { lte: jalaliEndOfDay(dayJalali) },
          toDate: { gte: insideOpenShift && at > jalaliStartOfDay(dayJalali) ? at : jalaliStartOfDay(dayJalali) }
        }
      : { closedAt: { not: null }, fromDate: { lte: at }, toDate: { gte: at } }

    const session = await prisma.cashSession.findFirst({
      where: sessionWhere,
      include: { shift: { select: { name: true } } },
      orderBy: { id: 'desc' }
    })
    if (session)
      reasons.push(
        `صندوق این بازه بسته شده است (${session.shift?.name ?? 'بستن صندوق بازه‌ای'} · ` +
          `${faDigits(session.dayJalali || toJalaliDate(session.closedAt ?? session.createdAt))}` +
          (session.countedTotal != null ? ` · شمارش ${money(session.countedTotal)} ریال` : '') +
          ').'
      )

    const consolidation = await prisma.consolidation.findFirst({
      where: {
        finalizedAt: { not: null },
        OR: [{ dayJalali }, { fromDate: { lte: at }, toDate: { gte: at } }]
      },
      orderBy: { id: 'desc' }
    })
    if (consolidation)
      reasons.push(`این روز «تجمیع و انتقال» شده است (سند تجمیع ${faDigits(consolidation.id)}).`)

    // تاریخِ گذشته خودش قفل نیست، ولی در هشدار می‌آید (`backdated` بالا).

    return {
      dayJalali,
      locked: reasons.length > 0,
      enforced: policy.lockClosedPeriods && reasons.length > 0,
      policyOn: policy.lockClosedPeriods,
      backdated,
      reasons,
      cashSessionId: session?.id ?? null,
      consolidationId: consolidation?.id ?? null
    }
  },

  /**
   * ===========================================================================
   * نشست ۶۳ (DECISIONS S63-2) — سنجش رمز مدیرِ «دوره‌ی بسته» **قبل از** تراکنش.
   *
   * باگ: `assertOpen` داخل `$transaction` صدا زده می‌شد و خودش
   * `assertManagerPassword` را صدا می‌زد ⇒ خواندن/نوشتن `AuthLockout` با کلاینت
   * سراسری وسط تراکنش باز. روی Prisma واقعی/SQLite تک‌نویسنده = انتظار روی قفل
   * و timeout؛ و در هر حالت، رمز اشتباه `failCount` را داخل همان تراکنش می‌نوشت
   * که بلافاصله rollback می‌شد ⇒ شمارنده‌ی رمز اشتباه هرگز بالا نمی‌رفت = دور
   * زدن قفل brute-force روی همین مسیر (تست نشست ۶۳ بخش ۲-الف).
   *
   * حالا: صدازننده قبل از تراکنش `preverify` را صدا می‌زند؛ اگر تاریخ قفل نباشد
   * هیچ رمزی سنجیده نمی‌شود (رفتار قبلی)؛ اگر قفل باشد، نبود رمز/دلیل همان پیام
   * قبلی را می‌دهد و رمز همین‌جا (بیرون از تراکنش) سنجیده می‌شود. نتیجه
   * (`true`) به `assertOpen(tx, { managerVerified })` داده می‌شود که فقط Audit
   * می‌نویسد.
   * ===========================================================================
   */
  async preverify(input: {
    at: Date
    what: string
    managerPassword?: string | null
    overrideReason?: string | null
    /** رمز همین درخواست پیش‌تر (باز هم بیرون از تراکنش) سنجیده شده است */
    alreadyVerified?: boolean
  }): Promise<boolean> {
    const state = await this.status({ at: input.at })
    if (!state.enforced) return false
    const reason = String(input.overrideReason ?? '').trim()
    if ((!input.managerPassword && input.alreadyVerified !== true) || reason.length < 3)
      throw new BusinessError(lockedMessage(input.what, state))
    if (input.alreadyVerified === true) return true
    await assertManagerPassword(input.managerPassword, `${input.what} در دوره‌ی بسته‌شده`)
    return true
  },

  /**
   * دروازه‌ی واقعی. اگر تاریخ در دوره‌ی بسته باشد و سیاست روشن باشد:
   * رمز مدیر + دلیل اجباری، و در هر حالت یک `AuditLog` با قبل/بعد.
   *
   * ⚠️ همیشه **قبل از شروع تراکنش** یا در ابتدای آن صدا زده می‌شود تا یک
   * تراکنش نیمه‌کاره‌ی رول‌بک‌شده جا نماند.
   */
  async assertOpen(
    client: Client,
    input: {
      at: Date
      what: string
      entity: string
      entityId?: number | null
      managerPassword?: string | null
      overrideReason?: string | null
      userId?: number | null
      before?: unknown
      after?: unknown
      /**
       * نشست ۶۳ (S63-2) — نتیجه‌ی `preverify` که **قبل از** تراکنش گرفته شد.
       * این تابع دیگر هیچ‌وقت خودش رمز را نمی‌سنجد (نوشتن AuthLockout وسط تراکنش).
       */
      managerVerified?: boolean
      /** مدیر شخصی که عبور از دوره‌ی بسته را تأیید کرده است (در صورت وجود). */
      approvedByUserId?: number | null
      approvedByLabel?: string | null
    }
  ): Promise<PeriodLockStatus> {
    const state = await this.status({ at: input.at })
    if (!state.enforced) return state

    const reason = String(input.overrideReason ?? '').trim()
    if ((!input.managerPassword && input.managerVerified !== true) || reason.length < 3)
      throw new BusinessError(lockedMessage(input.what, state))
    if (input.managerVerified !== true)
      // دوره بین سنجش قبل از تراکنش و خود تراکنش بسته شد (یا صدازننده preverify نکرد):
      // امن‌ترین کار رد کامل است، نه سنجش رمز وسط تراکنش.
      throw new BusinessError(
        `${input.what} انجام نشد: وضعیت دوره‌ی ${faDigits(state.dayJalali)} همین حالا عوض شد (بسته شد) ` +
          'و رمز مدیر برای آن هنوز تایید نشده بود. یک بار دیگر همان کار را با رمز مدیر و دلیل تکرار کنید.'
      )

    await audit(client, {
      action: AuditAction.CLOSED_PERIOD_OVERRIDE,
      entity: input.entity,
      entityId: input.entityId ?? 0,
      userId: input.userId ?? null,
      before: input.before == null ? undefined : JSON.stringify(input.before),
      after: JSON.stringify({
        what: input.what,
        dayJalali: state.dayJalali,
        reasons: state.reasons,
        cashSessionId: state.cashSessionId,
        consolidationId: state.consolidationId,
        overrideReason: reason,
        ...(input.approvedByUserId != null
          ? { approvedByUserId: input.approvedByUserId, approvedByLabel: input.approvedByLabel ?? null }
          : {}),
        ...(input.after == null ? {} : { payload: input.after })
      }),
      note:
        `${input.what} در دوره‌ی بسته‌ی ${faDigits(state.dayJalali)} با تایید مدیر` +
        (input.approvedByLabel ? ` «${input.approvedByLabel}»` : '') +
        ` · دلیل: ${reason}`
    })
    return state
  },

  /** بازه‌ی یک روز شمسی (برای گزارش «اسناد دست‌خورده‌ی دوره‌ی بسته»). */
  dayRange(dayJalali: string): { from: Date; to: Date } {
    return { from: jalaliStartOfDay(dayJalali), to: jalaliEndOfDay(dayJalali) }
  }
}
