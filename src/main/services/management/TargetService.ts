/**
 * هدف فروش ماهانه — مبلغ هدف همیشه فروش خالص تعهدی است.
 * پیشرفت از reportRows خوانده می‌شود؛ فرمول موازی نیست.
 * فیلتر فروشنده/دسته روی این نوار اثر ندارد (هدف کل مغازه).
 */
import { prisma } from '../../db/client'
import { salesService } from '../SalesService'
import { toNumberRial, toRial } from '@shared/money'
import { jalaliToday, isValidJalaliDate, parseGroupedInteger } from '@shared/jalali'
import { monthStart, monthEnd, normalizeJalaliYmd, addJalaliDays } from '@shared/jalaliBuckets'

function daysInclusive(a: string, b: string): number {
  if (!a || !b || a > b) return 1
  let n = 1
  let cur = a
  while (cur < b) {
    cur = addJalaliDays(cur, 1)
    n++
    if (n > 400) break
  }
  return n
}
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'

const db = prisma as any

function n(v: unknown): number {
  return toNumberRial((v as any) ?? 0)
}

function monthKey(s: string): string {
  return String(s || '').slice(0, 7)
}

function assertMonth(raw: unknown): string {
  const m = monthKey(String(raw || ''))
  if (!/^\d{4}\/\d{2}$/.test(m) || !isValidJalaliDate(`${m}/01`))
    throw new BusinessError('ماه هدف نامعتبر است.')
  return m
}

export const targetService = {
  async get(filter: { toJalali?: string; fromJalali?: string } = {}) {
    const today = jalaliToday()
    const anchor = normalizeJalaliYmd(filter.toJalali) || normalizeJalaliYmd(filter.fromJalali) || today
    const monthJalali = monthKey(anchor)
    const from = monthStart(`${monthJalali}/01`)
    const end = monthEnd(`${monthJalali}/01`)
    const to = today < end ? (today < from ? from : today) : end
    const report = await salesService.reportRows({
      fromJalali: from,
      toJalali: to,
      take: 1,
      withDrillDown: false
    })
    const netAccrualSales = n(report.accounting?.invoice?.netAccrualSales)
    const row = await db.mgmtTarget.findFirst({ where: { monthJalali, userId: 0 } })
    const target = row ? n(row.amount) : 0
    const pct = target > 0 ? netAccrualSales / target : null
    return {
      monthJalali,
      fromJalali: from,
      toJalali: to,
      monthEnd: end,
      monthComplete: to >= end,
      target,
      netAccrualSales,
      remaining: target > 0 ? Math.max(0, target - netAccrualSales) : 0,
      /**
       * B11 (بازبینی هشتم) — برای ماهِ تمام‌شده `daysInclusive(to, end)` یک برمی‌گرداند،
       * یعنی «یک روز مانده» روی ماهی که دیگر تمام شده. صفر می‌شود تا «در روز لازم است»
       * هم صفر شود؛ `monthComplete` همان‌جا هست و UI توضیح را می‌نویسد.
       */
      remainingDays: to >= end ? 0 : daysInclusive(to, end),
      dailyNeeded:
        target > 0 && to < end ? Math.round(Math.max(0, target - netAccrualSales) / daysInclusive(to, end)) : 0,
      pct,
      invoiceCount: Number(report.accounting?.invoice?.invoiceCount ?? 0),
      warnings: report.warnings ?? [],
      note:
        'هدف روی فروش خالص تعهدی همان ماه است (منبع: گزارشات فروش). سود هدف نیست. فیلتر فروشنده روی این نوار اثر ندارد.'
    }
  },

  async set(input: { monthJalali?: string; amount?: unknown; actorUserId?: number | null } = {}) {
    const monthJalali = assertMonth(input.monthJalali || jalaliToday())
    const parsed = typeof input.amount === 'number' ? input.amount : parseGroupedInteger(input.amount)
    if (parsed == null || !Number.isSafeInteger(parsed) || parsed < 0)
      throw new BusinessError('مبلغ هدف باید عدد صحیح ریال باشد (رقم فارسی و جداکنندهٔ هزارگان مجاز است). مبلغ قبلی پاک نشد.')
    const amount = parsed
    const existing = await db.mgmtTarget.findFirst({ where: { monthJalali, userId: 0 } })
    const row = existing
      ? await db.mgmtTarget.update({ where: { id: existing.id }, data: { amount: toRial(amount) } })
      : await db.mgmtTarget.create({ data: { monthJalali, userId: 0, amount: toRial(amount) } })
    await audit(prisma, {
      action: 'MGMT_TARGET_SET',
      entity: 'MgmtTarget',
      entityId: row.id,
      // B11 — «چه کسی هدف را عوض کرد». شناسهٔ اجرا فقط از main می‌آید ( نشست ۱۷۹ S179-D2:
      // actorId ارسالی رندرر هرگز پذیرفته نمی‌شود) و از نشست کارمندِ باز خوانده می‌شود؛
      // اگر نشست باز نباشد مثل قبل `null` می‌ماند — ثبتِ بی‌نام بهتر از ساختن کاربر قرضی است.
      userId: input.actorUserId ?? null,
      before: existing ? JSON.stringify({ amount: n(existing.amount) }) : null,
      after: JSON.stringify({ monthJalali, amount }),
      note: `ثبت هدف فروش ماه ${monthJalali}`
    })
    return { monthJalali, target: n(row.amount) }
  }
}
