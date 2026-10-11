import { prisma } from '../db/client'
import { SETTING_KEYS } from '@shared/receipt'
import { STAFF_ROLES, STAFF_ROLE_LABELS, normalizeStaffRole } from '@shared/enums'
import { faDigits } from '@shared/jalali'
import { PANEL_KEYS } from '@shared/panels'
import {
  assertPanelPassword,
  hasManagerCorrectionApprovalSecret,
  setManagerCorrectionApprovalPassword
} from './AuthService'

/**
 * ===========================================================================
 * جلسه ۱۷ · بند ۲ (زیرساخت لازم) — «کارمندان فروشگاه و کارمند فعال».
 *
 * چرا این فایل لازم شد؟
 * سند جلسه ۱۷ خواسته بود تب «عملکرد کارمندان» بر پایه‌ی `userId` متصل به
 * فاکتور/برگشت/تعویض ساخته شود. مدل `User` (با `role: MANAGER/CASHIER/STOCKKEEPER`)
 * از اول در schema بود و همه‌ی سرویس‌ها هم `userId` را می‌پذیرفتند، ولی **هیچ
 * جای برنامه این عدد را پر نمی‌کرد**: نه کاربری ساخته می‌شد و نه renderer چیزی
 * می‌فرستاد. نتیجه این بود که گزارش عملکرد کارمندان — با این‌که فرمولش درست بود —
 * همیشه فقط یک ردیف «نامشخص» نشان می‌داد. پس این سرویس همان حلقه‌ی گمشده است:
 *
 *   ۱) ثبت و ویرایش کارمندان (نام، نقش، فعال/غیرفعال).
 *   ۲) تعیین «کارمند فعالِ پشت سیستم» و نگه‌داشتنش در جدول `Setting`
 *      (کلید `staff.active`) ⇒ هیچ migration ای لازم نیست.
 *
 * ⚠️ سه قاعده‌ی عمدی:
 *   • این یک سیستم ورود/احراز هویت **نیست** و هیچ قفل تازه‌ای نمی‌سازد. قفل‌های
 *     برنامه همان `ManagerGate` و رمز دوم پنل‌ها هستند و دست‌نخورده‌اند.
 *   • خالی بودن «کارمند فعال» ⇒ رفتار مو‌به‌مو مثل قبل (`userId = null`).
 *   • کارمند هیچ‌وقت *حذف* نمی‌شود، فقط «غیرفعال» می‌شود؛ وگرنه سابقه‌ی فروش
 *     و برگشتِ گذشته‌اش بی‌صاحب می‌شد.
 * ===========================================================================
 */

const shape = (u: {
  id: number
  username: string
  displayName: string
  role: string
  isActive: boolean
  passwordHash?: string
}) => ({
  id: u.id,
  username: u.username,
  name: u.displayName || u.username,
  role: u.role,
  roleLabel: STAFF_ROLE_LABELS[u.role] ?? u.role,
  isActive: u.isActive,
  /** فقط وضعیت؛ هش یا رمز شخصی هرگز از IPC بیرون نمی‌رود. */
  hasCorrectionApprovalPassword: u.role === 'MANAGER' && hasManagerCorrectionApprovalSecret(u.passwordHash)
})

const SELECT = { id: true, username: true, displayName: true, role: true, isActive: true, passwordHash: true } as const

/** نام ⇒ یک `username` یکتا و بی‌فاصله (فقط یک شناسه‌ی داخلی است). */
async function uniqueUsername(name: string): Promise<string> {
  const base =
    name
      .trim()
      .replace(/\s+/g, '.')
      .replace(/[^\p{L}\p{N}._-]/gu, '') || 'staff'
  let candidate = base
  for (let i = 2; i < 500; i++) {
    const clash = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })
    if (!clash) return candidate
    candidate = `${base}${i}`
  }
  return `${base}.${Date.now()}`
}

async function readActiveId(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.activeStaff } })
  const id = Math.round(Number(row?.value))
  if (!Number.isFinite(id) || id <= 0) return null
  // کارمندی که غیرفعال یا حذف شده باشد، «فعال» شمرده نمی‌شود
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, isActive: true } })
  return user?.isActive ? user.id : null
}

export const staffService = {
  /** فهرست کامل کارمندان (غیرفعال‌ها هم، با برچسب خودشان). */
  async list(params: { includeInactive?: boolean } = {}) {
    const rows = await prisma.user.findMany({
      where: params.includeInactive === false ? { isActive: true } : {},
      select: SELECT,
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }]
    })
    return { rows: rows.map(shape), activeUserId: await readActiveId(), roles: STAFF_ROLES }
  },

  /** ثبت کارمند تازه یا ویرایش نام/نقش/فعال‌بودن یکی از قبلی‌ها. */
  async save(input: {
    id?: number | null
    name?: string
    role?: string
    isActive?: boolean
    userId?: number | null
    panelPassword?: string | null
    /** فقط برای نقش MANAGER؛ خالی = رمز فعلی دست‌نخورده بماند. */
    correctionApprovalPassword?: string | null
  }) {
    const name = String(input?.name ?? '').trim()
    if (!name) throw new Error('نام کارمند را وارد کنید.')
    const role = normalizeStaffRole(input?.role)
    const id = Math.round(Number(input?.id ?? 0))
    const correctionApprovalPassword = String(input?.correctionApprovalPassword ?? '').trim()
    if (correctionApprovalPassword && role !== 'MANAGER')
      throw new Error('رمز شخصی تأیید اصلاح فقط برای کارمند با نقش «مدیر» قابل ثبت است.')

    /**
     * نشست ۱۶۵ · S165-D4 (بند ۴-۲۹ مورد ۱، بند ۴-۳۰، بند ۵ «هر گیت در main») — فهرست کارمندان داخل پنل
     * همیشه‌قفل «تنظیمات» است، ولی کانال staff:save هیچ گیتی نداشت ⇒ هر کسی با دور زدن UI می‌توانست نام همکار را
     * عوض کند (نام در همه‌ی گزارش‌های گذشته‌ی او عوض می‌شود)، او را غیرفعال کند یا کارمند ساختگی بسازد.
     * حالا همان رمز پنل «تنظیمات» (مثل حذف مشتری، S155-D5)، بعد از اعتبارسنجی ورودی و پیش از هر نوشتن.
     */
    const before = id > 0 ? await prisma.user.findUnique({ where: { id }, select: SELECT }) : null
    if (id > 0 && !before) throw new Error('این کارمند پیدا نشد.')
    await assertPanelPassword(
      PANEL_KEYS.settings,
      input?.panelPassword ?? null,
      id > 0
        ? `ویرایش کارمند «${String((before as any)?.displayName || (before as any)?.username || '')}» (نام/نقش/فعال‌بودن)`
        : `ثبت کارمند تازه «${name}»`
    )

    if (id > 0 && before) {
      const updated = await prisma.user.update({
        where: { id },
        // خروج نقش مدیر ⇒ راز شخصی مربوط به اختیار مدیرانه هم باقی نمی‌ماند.
        data: { displayName: name, role, isActive: input?.isActive !== false, ...(role === 'MANAGER' ? {} : { passwordHash: '' }) },
        select: SELECT
      })
      if (correctionApprovalPassword)
        await setManagerCorrectionApprovalPassword({
          userId: updated.id,
          password: correctionApprovalPassword,
          actorUserId: input?.userId ?? null
        })
      const finalUpdated = correctionApprovalPassword
        ? await prisma.user.findUniqueOrThrow({ where: { id: updated.id }, select: SELECT })
        : updated
      await prisma.auditLog.create({
        data: {
          action: 'STAFF_UPDATE',
          entity: 'User',
          entityId: id,
          userId: input?.userId ?? null,
          before: JSON.stringify(shape(before)),
          after: JSON.stringify(shape(finalUpdated)),
          note: `ویرایش کارمند «${name}» · نقش ${STAFF_ROLE_LABELS[role]} · ${finalUpdated.isActive ? 'فعال' : 'غیرفعال'}`
        }
      })
      // کارمندی که غیرفعال شد، نباید «کارمند فعال» بماند
      if (!finalUpdated.isActive && (await readActiveId()) === id) await this.setActive({ userId: null })
      return shape(finalUpdated)
    }

    const created = await prisma.user.create({
      data: {
        username: await uniqueUsername(name),
        // این کاربر جایی وارد برنامه نمی‌شود (سیستم ورود نداریم)، پس رمز معنی ندارد.
        passwordHash: '',
        displayName: name,
        role,
        isActive: input?.isActive !== false
      },
      select: SELECT
    })
    if (correctionApprovalPassword)
      await setManagerCorrectionApprovalPassword({
        userId: created.id,
        password: correctionApprovalPassword,
        actorUserId: input?.userId ?? null
      })
    const finalCreated = correctionApprovalPassword
      ? await prisma.user.findUniqueOrThrow({ where: { id: created.id }, select: SELECT })
      : created
    await prisma.auditLog.create({
      data: {
        action: 'STAFF_CREATE',
        entity: 'User',
        entityId: created.id,
        userId: input?.userId ?? null,
        after: JSON.stringify(shape(finalCreated)),
        note: `ثبت کارمند تازه «${name}» · نقش ${STAFF_ROLE_LABELS[role]}`
      }
    })
    return shape(finalCreated)
  },

  /** «چه کسی همین حالا پشت سیستم است؟» — `null` = مثل قبل، بدون کارمند. */
  async active() {
    const id = await readActiveId()
    if (!id) return { activeUserId: null, staff: null }
    const user = await prisma.user.findUnique({ where: { id }, select: SELECT })
    return { activeUserId: id, staff: user ? shape(user) : null }
  },

  async setActive(payload: { id?: number | null; userId?: number | null } = {}) {
    const raw = Math.round(Number(payload?.id ?? 0))
    let value = ''
    if (Number.isFinite(raw) && raw > 0) {
      const user = await prisma.user.findUnique({ where: { id: raw }, select: SELECT })
      if (!user) throw new Error('این کارمند پیدا نشد.')
      if (!user.isActive) throw new Error('این کارمند غیرفعال است، پس نمی‌تواند کارمند فعالِ پشت سیستم باشد.')
      value = String(raw)
    }
    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.activeStaff },
      create: { key: SETTING_KEYS.activeStaff, value },
      update: { value }
    })
    await prisma.auditLog.create({
      data: {
        action: 'STAFF_ACTIVE_SET',
        entity: 'Setting',
        entityId: 0,
        userId: payload?.userId ?? null,
        after: JSON.stringify({ activeUserId: value ? Number(value) : null }),
        note: value
          ? `کارمند فعالِ پشت سیستم: شماره ${faDigits(value)}`
          : 'کارمند فعال پاک شد (سندهای تازه بدون کارمند ثبت می‌شوند، مثل نسخه‌های قبل)'
      }
    })
    return this.active()
  },

  /**
   * همان `userId`ای که لایه‌ی IPC روی سندهای تازه می‌نشاند.
   * هر خطایی (دیتابیس، رکورد خراب) ⇒ `null`، یعنی همان رفتار قبلی؛ ثبت فروش
   * هیچ‌وقت به‌خاطر این قابلیت *ناکام* نمی‌ماند.
   */
  async currentUserId(): Promise<number | null> {
    try {
      return await readActiveId()
    } catch {
      return null
    }
  }
}
