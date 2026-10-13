import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { custodyService } from './CustodyService'
import { assertManagerSession } from './panelSession'

function whole(value: unknown, label: string, min: number, max: number) {
  const n = Math.round(Number(value))
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new BusinessError(`${label} نامعتبر است.`)
  return n
}

export const custodyPlanService = {
  async list() {
    const [plans, rows] = await Promise.all([
      prisma.shiftPlan.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.shiftPlanStaff.findMany()
    ])
    const staff = new Map<number, number[]>()
    for (const row of rows) staff.set(row.planId, [...(staff.get(row.planId) ?? []), row.userId])
    return plans.map((plan: any) => ({ ...plan, staffIds: staff.get(plan.id) ?? [] }))
  },

  /**
   * Phase-zero transition inventory. Legacy ShiftPlan records are intentionally
   * neither converted nor deleted here: a manager must review them against the
   * new template identities before the canonical scheduler is allowed to take
   * responsibility for them.
   */
  async reviewLegacy() {
    assertManagerSession('بازبینی برنامه‌های قدیمی شیفت/حضانت')
    const plans = await this.list()
    return {
      state: plans.length ? 'REVIEW_REQUIRED' as const : 'EMPTY' as const,
      total: plans.length,
      plans: plans.map((plan: any) => ({
        ...plan,
        migrationState: 'REVIEW_REQUIRED' as const,
        migrationNote: 'این برنامه هنوز به قالب جدید تبدیل نشده و بدون تصمیم صریح مدیر دست‌نخورده می‌ماند.'
      }))
    }
  },

  async save(input: { id?: unknown; title?: unknown; startMinute?: unknown; durationMinutes?: unknown; daysMask?: unknown; isActive?: unknown; sortOrder?: unknown; reminderRepeatMin?: unknown; staffIds?: unknown; managerUserId?: unknown; managerPassword?: unknown; managerSession?: boolean }) {
    if (input.managerSession === true) assertManagerSession('ثبت یا ویرایش برنامه کاری حضانت')
    else await custodyService.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const id = input.id == null ? null : whole(input.id, 'شناسه برنامه', 1, Number.MAX_SAFE_INTEGER)
    const title = String(input.title ?? '').trim()
    if (!title || title.length > 120) throw new BusinessError('عنوان برنامه را به‌درستی وارد کنید.')
    const startMinute = whole(input.startMinute, 'ساعت شروع', 0, 1439)
    const durationMinutes = whole(input.durationMinutes, 'مدت برنامه', 1, 1440)
    const daysMask = whole(input.daysMask, 'روزهای برنامه', 0, 127)
    if (!daysMask) throw new BusinessError('حداقل یک روز برنامه را انتخاب کنید.')
    const reminderRepeatMin = whole(input.reminderRepeatMin ?? 15, 'فاصله یادآوری', 5, 60)
    const sortOrder = whole(input.sortOrder ?? 0, 'ترتیب برنامه', 0, 100000)
    const staffIds = [...new Set(Array.isArray(input.staffIds) ? input.staffIds.map((x) => whole(x, 'شناسه کارمند', 1, Number.MAX_SAFE_INTEGER)) : [])]
    /** Historical plan assignments remain read-only evidence. A new/save action
     * must never reintroduce an archived worker into an operational schedule. */
    if (staffIds.length) {
      const active = await prisma.user.findMany({ where: { id: { in: staffIds }, isActive: true }, select: { id: true } })
      if (active.length !== staffIds.length)
        throw new BusinessError('کارمند آرشیوشده یا غیرفعال نمی‌تواند در برنامهٔ عملیاتی شیفت ثبت شود.', 'INACTIVE_SCHEDULE_STAFF')
    }
    return prisma.$transaction(async (tx: any) => {
      const data = { title, startMinute, durationMinutes, crossesMidnight: startMinute + durationMinutes > 1440, daysMask, isActive: input.isActive !== false, sortOrder, reminderRepeatMin }
      const plan = id
        ? await tx.shiftPlan.update({ where: { id }, data: { ...data, version: { increment: 1 } } })
        : await tx.shiftPlan.create({ data })
      await tx.shiftPlanStaff.deleteMany({ where: { planId: plan.id } })
      if (staffIds.length) await tx.shiftPlanStaff.createMany({ data: staffIds.map((userId) => ({ planId: plan.id, userId })) })
      return { ...plan, staffIds }
    })
  },

  async remove(input: { id?: unknown; managerUserId?: unknown; managerPassword?: unknown; managerSession?: boolean }) {
    if (input.managerSession === true) assertManagerSession('حذف برنامه کاری حضانت')
    else await custodyService.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const id = whole(input.id, 'شناسه برنامه', 1, Number.MAX_SAFE_INTEGER)
    await prisma.$transaction(async (tx: any) => {
      await tx.shiftPlanStaff.deleteMany({ where: { planId: id } })
      await tx.shiftPlan.delete({ where: { id } })
    })
    return { id }
  }
}
