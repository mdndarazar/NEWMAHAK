import { prisma } from '../db/client'
import { SETTING_KEYS, parseStocktakeSchedule, type StocktakeSchedule } from '@shared/receipt'
import { jalaliToday, jalaliToDateTime, faDigits } from '@shared/jalali'
import { AuditAction } from '@shared/enums'
import { PANEL_KEYS } from '@shared/panels'
import { assertPanelPassword } from './AuthService'

/**
 * ===========================================================================
 * جلسه ۱۷ · بند ۵ — «یادآوری انبارگردانی فیزیکی».
 *
 * تنظیماتش روی جدول `Setting` می‌نشیند (کلید `stocktake.schedule`)، پس هیچ
 * migration ای لازم ندارد. یادآوری **مزاحم نیست و چیزی را قفل نمی‌کند**: فقط
 * یک نشان برجسته است که مستقیم به فرم شمارش فیزیکی لینک می‌شود.
 * ===========================================================================
 */

const dayNumber = (jalali: string): number => {
  try {
    return Math.floor(jalaliToDateTime(jalali).getTime() / 86_400_000)
  } catch {
    return NaN
  }
}

async function readSchedule(): Promise<StocktakeSchedule> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.stocktakeSchedule } })
  return parseStocktakeSchedule(row?.value ?? null)
}

async function writeSchedule(next: StocktakeSchedule): Promise<StocktakeSchedule> {
  const clean = parseStocktakeSchedule(next)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.stocktakeSchedule },
    create: { key: SETTING_KEYS.stocktakeSchedule, value: JSON.stringify(clean) },
    update: { value: JSON.stringify(clean) }
  })
  return clean
}

export const stocktakeReminderService = {
  get: readSchedule,

  async set(payload: { schedule?: StocktakeSchedule; userId?: number | null; panelPassword?: string | null }) {
    const before = await readSchedule()
    /**
     * نشست ۱۵۷ (Y13، بند ۴-۲۹ و ۴-۳۹، S157-D2) — کلید stocktakeSchedule در settings:set خام
     * رمز مدیر می‌خواهد ولی این کانال بی‌گیت بود؛ فروشنده می‌توانست یادآوری انبارگردانی ماهانه
     * (کنترل ضدسرقت بند ۳) را خاموش کند. حالا تغییر واقعی برنامه (بدون dismissedJalali که
     * کانال جدای «بستن یادآوری امروز» است) ⇒ رمز پنل انبارگردانی، پیش از هر نوشتن.
     */
    const { dismissedJalali: _bd, ...beforeCore } = before as any
    const { dismissedJalali: _nd, ...nextCore } = parseStocktakeSchedule((payload?.schedule ?? {}) as any) as any
    if (JSON.stringify(beforeCore) !== JSON.stringify(nextCore))
      await assertPanelPassword(PANEL_KEYS.stocktake, payload?.panelPassword ?? null, 'تغییر برنامه‌ی یادآوری انبارگردانی')
    /**
     * نشست ۱۶۶ (S166-D2) — dismissedJalali فقط از کانال مستقل dismiss (با گیت و Audit) نوشته می‌شود.
     * قبلاً همین کانال با برنامه‌ی بی‌تغییر + dismissedJalali=امروز، بی‌رمز یادآوری را می‌خواباند.
     * پس مقدار فعلی ذخیره‌شده عیناً حفظ می‌شود و مقدار ارسالی رندرر نادیده گرفته می‌شود.
     */
    const clean = await writeSchedule({
      ...((payload?.schedule ?? {}) as StocktakeSchedule),
      dismissedJalali: before.dismissedJalali
    })
    await prisma.auditLog.create({
      data: {
        action: AuditAction.STOCKTAKE_SCHEDULE_UPDATE,
        entity: 'Setting',
        entityId: 0,
        userId: payload?.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify(clean),
        note:
          `تنظیمات یادآوری انبارگردانی ذخیره شد · ` +
          (clean.enabled
            ? `${faDigits(clean.dates.length)} تاریخ مشخص` +
              (clean.everyDays ? ` · تکرار هر ${faDigits(clean.everyDays)} روز` : '')
            : 'خاموش')
      }
    })
    return clean
  },

  /**
   * امروز موعد انبارگردانی است؟
   *
   * دو سازوکار مستقل، و «یا» بین آن‌ها:
   *   • تاریخ‌های مشخص: هر تاریخی که *رسیده یا گذشته* باشد و بعدش شمارشی ثبت
   *     نشده باشد، همان لحظه یادآوری می‌دهد (پس یک روز مرخصی، یادآوری را
   *     بی‌صدا رد نمی‌کند).
   *   • بازه‌ی تکرارشونده: از تاریخ مبنا (یا آخرین شمارش ثبت‌شده) هر N روز.
   */
  async due() {
    const schedule = await readSchedule()
    const today = jalaliToday()
    const last = await prisma.stockCountSession.findFirst({
      orderBy: [{ countedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, countedAtJalali: true }
    })
    const base = {
      enabled: schedule.enabled,
      today,
      schedule,
      lastCountJalali: last?.countedAtJalali ?? null,
      lastCountId: last?.id ?? null
    }
    if (!schedule.enabled) return { ...base, due: false, reasons: [] as string[], dismissed: false }

    const todayNo = dayNumber(today)
    const lastNo = last?.countedAtJalali ? dayNumber(last.countedAtJalali) : NaN
    const reasons: string[] = []

    for (const d of schedule.dates) {
      const dn = dayNumber(d)
      if (!Number.isFinite(dn) || dn > todayNo) continue
      // بعد از آن تاریخ شمارشی ثبت شده؟ پس تکلیفش انجام شده است.
      if (Number.isFinite(lastNo) && lastNo >= dn) continue
      reasons.push(
        dn === todayNo
          ? `امروز (${d}) تاریخ تعیین‌شده‌ی انبارگردانی فیزیکی است.`
          : `تاریخ تعیین‌شده‌ی انبارگردانی (${d}) گذشته و هنوز شمارشی ثبت نشده است.`
      )
    }

    if (schedule.everyDays > 0) {
      const startNo = schedule.startJalali ? dayNumber(schedule.startJalali) : lastNo
      const from = Number.isFinite(startNo) ? startNo : todayNo
      const elapsed = todayNo - from
      if (elapsed >= schedule.everyDays)
        reasons.push(
          `از آخرین مبنای انبارگردانی ${faDigits(elapsed)} روز گذشته است و بازه‌ی تکرار ` +
            `${faDigits(schedule.everyDays)} روز تنظیم شده.`
        )
    }

    const dismissed = !!schedule.dismissedJalali && schedule.dismissedJalali === today
    return { ...base, due: reasons.length > 0, reasons, dismissed }
  },

  /**
   * «امروز دیدم» — فقط یادآوری امروز را می‌خواباند، تنظیمات را عوض نمی‌کند.
   *
   * نشست ۱۶۶ (S166-D1، بند ۳ انبارگردانی ماهانه + بند ۵ «هر گیت در main» + بند ۴-۳۰ Audit) —
   * قبلاً بی‌رمز و بی‌رد بود ⇒ فروشنده می‌توانست نشان «وقت انبارگردانی» را پیش از دیدن مدیر پنهان
   * کند. حالا رمز پنل انبارگردانی (رمز مدیر یا رمز دوم همین پنل؛ قفل خاموش ⇒ آزاد، بند ۴-۳۹) پیش از
   * هر نوشتن، و هر خواباندن با actor نشست در Audit می‌نشیند.
   */
  async dismiss(payload?: { userId?: number | null; panelPassword?: string | null }) {
    const scope = await assertPanelPassword(
      PANEL_KEYS.stocktake,
      payload?.panelPassword ?? null,
      'خواباندن یادآوری انبارگردانی امروز'
    )
    const before = await readSchedule()
    const today = jalaliToday()
    const clean = await writeSchedule({ ...before, dismissedJalali: today })
    await prisma.auditLog.create({
      data: {
        action: AuditAction.STOCKTAKE_SCHEDULE_UPDATE,
        entity: 'Setting',
        entityId: 0,
        userId: payload?.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify(clean),
        note:
          `یادآوری انبارگردانی امروز (${today}) خوابانده شد («امروز دیدم») · ` +
          (scope === 'MANAGER' ? 'با رمز مدیر' : scope === 'PANEL' ? 'با رمز پنل انبارگردانی' : 'قفل پنل انبارگردانی خاموش')
      }
    })
    return clean
  }
}
