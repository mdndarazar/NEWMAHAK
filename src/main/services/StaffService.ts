import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { auditOrThrow } from './AuditService'
import { assertManagerSession } from './panelSession'
import { SETTING_KEYS } from '@shared/receipt'
import { STAFF_ROLES, STAFF_ROLE_LABELS, normalizeStaffRole } from '@shared/enums'
import { faDigits, toJalaliDate } from '@shared/jalali'
import { PANEL_KEYS } from '@shared/panels'
import { custodyService } from './CustodyService'
import {
  assertPanelPassword,
  createManagerCorrectionApprovalSecret,
  hasManagerCorrectionApprovalSecret
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

const PERSONNEL_STATUSES = ['ACTIVE', 'LEAVE', 'SUSPENDED', 'TERMINATED'] as const
type PersonnelStatus = (typeof PERSONNEL_STATUSES)[number]

/** Keep sensitive values out of all generic shaping, audit and export paths.
 * This normalizes only the format persisted in the manager-only profile. */
function latinDigits(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
}

function textOrNull(value: unknown, label: string, max: number): string | null {
  const text = String(value ?? '').trim()
  if (text.length > max) throw new BusinessError(`${label} نمی‌تواند بیشتر از ${max} نویسه باشد.`)
  return text || null
}

function jalaliOrNull(value: unknown, label: string): string | null {
  const text = latinDigits(value).trim().replace(/-/g, '/')
  if (!text) return null
  if (!/^(?:13|14)\d{2}\/(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])$/.test(text))
    throw new BusinessError(`${label} را به‌شکل ۱۴۰۳/۰۱/۳۱ وارد کنید.`)
  return text
}

function nationalIdOrNull(value: unknown): string | null {
  const digits = latinDigits(value).replace(/\D/g, '')
  if (!digits) return null
  if (!/^\d{10}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) throw new BusinessError('کد ملی باید ۱۰ رقم معتبر باشد.')
  const weighted = digits
    .slice(0, 9)
    .split('')
    .reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0)
  const remainder = weighted % 11
  const expected = remainder < 2 ? remainder : 11 - remainder
  if (Number(digits[9]) !== expected) throw new BusinessError('کد ملی معتبر نیست.')
  return digits
}

function accountNoOrNull(value: unknown): string | null {
  const digits = latinDigits(value).replace(/[\s-]/g, '')
  if (!digits) return null
  if (!/^\d{4,34}$/.test(digits)) throw new BusinessError('شماره حساب باید بین ۴ تا ۳۴ رقم باشد.')
  return digits
}

function ibanOrNull(value: unknown): string | null {
  const iban = latinDigits(value).replace(/[\s-]/g, '').toUpperCase()
  if (!iban) return null
  if (!/^IR\d{24}$/.test(iban)) throw new BusinessError('شماره شبا باید با IR و ۲۴ رقم وارد شود.')
  const rearranged = `${iban.slice(4)}1827${iban.slice(2, 4)}`
  let remainder = 0
  for (const char of rearranged) remainder = (remainder * 10 + Number(char)) % 97
  if (remainder !== 1) throw new BusinessError('شماره شبا معتبر نیست.')
  return iban
}

function personnelStatus(value: unknown): PersonnelStatus {
  const status = String(value ?? 'ACTIVE').trim().toUpperCase()
  if (!(PERSONNEL_STATUSES as readonly string[]).includes(status)) throw new BusinessError('وضعیت استخدام معتبر نیست.')
  return status as PersonnelStatus
}

/** Fields that make the optional personnel record visibly complete. Values are
 * never exposed through this summary; it contains only safe completion state. */
const PERSONNEL_COMPLETION_FIELDS = [
  'jobTitle',
  'phone',
  'nationalId',
  'employmentStartJalali',
  'bankName',
  'bankAccountNo',
  'bankIban',
  'bankAccountHolder'
] as const

function personnelCompletion(row: any) {
  const completedFields = PERSONNEL_COMPLETION_FIELDS.filter((key) => String(row?.[key] ?? '').trim().length > 0).length
  return {
    isComplete: completedFields === PERSONNEL_COMPLETION_FIELDS.length,
    completedFields,
    totalFields: PERSONNEL_COMPLETION_FIELDS.length
  }
}

function redactedPersonnelSummary(row: any) {
  return {
    hasNationalId: !!row?.nationalId,
    hasBankName: !!row?.bankName,
    hasBankAccountNo: !!row?.bankAccountNo,
    hasBankIban: !!row?.bankIban,
    hasBankAccountHolder: !!row?.bankAccountHolder,
    employmentStatus: row?.employmentStatus ?? 'ACTIVE',
    completion: personnelCompletion(row)
  }
}

type PersonnelInput = {
  jobTitle?: unknown
  phone?: unknown
  nationalId?: unknown
  employmentStartJalali?: unknown
  employmentEndJalali?: unknown
  employmentStatus?: unknown
  bankName?: unknown
  bankAccountNo?: unknown
  bankIban?: unknown
  bankAccountHolder?: unknown
}

const PERSONNEL_INPUT_KEYS = [
  'jobTitle',
  'phone',
  'nationalId',
  'employmentStartJalali',
  'employmentEndJalali',
  'employmentStatus',
  'bankName',
  'bankAccountNo',
  'bankIban',
  'bankAccountHolder'
] as const

/**
 * A basic edit must not erase a profile merely because the caller did not send
 * sensitive fields. Empty string/null are deliberate clears; an omitted (or
 * `undefined`) property inherits the saved value.
 */
function mergePersonnelInput(previous: any | null | undefined, input: PersonnelInput): PersonnelInput {
  const merged: PersonnelInput = {}
  for (const key of PERSONNEL_INPUT_KEYS) {
    const supplied = Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined
    ;(merged as any)[key] = supplied ? input[key] : previous?.[key]
  }
  return merged
}

/** Validate and normalize once, then reuse the exact same policy from both
 * standalone profile edits and atomic staff registration. */
function preparePersonnel(input: PersonnelInput) {
  const phone = textOrNull(input.phone, 'شماره تماس', 32)
  if (phone && !/^[0-9۰-۹٠-٩+()\- ]{7,32}$/u.test(phone)) throw new BusinessError('شماره تماس معتبر نیست.')
  const employmentStartJalali = jalaliOrNull(input.employmentStartJalali, 'تاریخ شروع همکاری')
  const employmentEndJalali = jalaliOrNull(input.employmentEndJalali, 'تاریخ پایان همکاری')
  if (employmentStartJalali && employmentEndJalali && employmentEndJalali < employmentStartJalali)
    throw new BusinessError('تاریخ پایان همکاری نمی‌تواند پیش از تاریخ شروع باشد.')
  const data = {
    jobTitle: textOrNull(input.jobTitle, 'عنوان شغلی', 120),
    phone,
    nationalId: nationalIdOrNull(input.nationalId),
    employmentStartJalali,
    employmentEndJalali,
    employmentStatus: personnelStatus(input.employmentStatus),
    bankName: textOrNull(input.bankName, 'نام بانک', 100),
    bankAccountNo: accountNoOrNull(input.bankAccountNo),
    bankIban: ibanOrNull(input.bankIban),
    bankAccountHolder: textOrNull(input.bankAccountHolder, 'نام صاحب حساب', 120)
  }
  /**
   * پروندهٔ پرسنلی تدریجی است: نام و نقش برای ساخت کارمند کافی‌اند و داده‌های
   * هویتی/بانکی در زمان تکمیل‌شدن جداگانه اعتبارسنجی می‌شوند. این باعث نمی‌شود
   * مقدار ناقص/خراب پذیرفته شود؛ فقط «نداشتنِ» آن، ویرایش پایه را قفل نمی‌کند.
   */
  if (data.employmentStatus === 'TERMINATED' && !data.employmentEndJalali)
    throw new BusinessError('برای وضعیت «پایان همکاری»، تاریخ پایان همکاری لازم است.')
  return data
}

async function assertNationalIdAvailable(nationalId: string | null, selfUserId: number | null) {
  if (!nationalId) return
  const current = await prisma.staffProfile.findUnique({ where: { nationalId } })
  if (current && current.userId !== selfUserId)
    throw new BusinessError('این کد ملی پیش‌تر برای کارمند دیگری ثبت شده است.', 'STAFF_NATIONAL_ID_EXISTS')
}

/** A terminated/disabled person cannot be removed from the operational roster
 * while they own the drawer or are the independently authenticated recipient
 * of a pending handover. The manager must first close/cancel/complete that
 * custody action; otherwise an audit trail would have a live person disappear. */
async function assertOperationalDeactivationAllowed(client: any, userId: number, opts: { allowActiveCustodian?: boolean } = {}): Promise<boolean> {
  const state = await client.custodyState.findUnique({ where: { key: 'MAIN' } })
  if (!state) return false
  if (state.state === 'HANDOVER_PENDING' && state.pendingHandoverId) {
    const handover = await client.custodyHandover.findUnique({ where: { id: state.pendingHandoverId } })
    if (handover?.selectedRecipientUserId === userId)
      throw new BusinessError('این کارمند تحویل‌گیرندهٔ یک تحویل در انتظار است. ابتدا تحویل را لغو یا تعیین تکلیف کنید.', 'PENDING_HANDOVER_RECIPIENT')
  }
  if (state.activeShiftId) {
    const meta = await client.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
    if (meta?.custodianUserId === userId) {
      if (opts.allowActiveCustodian) return true
      throw new BusinessError('تا وقتی این کارمند مسئول فعال صندوق است، غیرفعال‌سازی یا پایان همکاری فقط از مسیر بازیابی امن حضانت ممکن است.', 'ACTIVE_CUSTODIAN')
    }
  }
  return false
}

/** Archiving invalidates the old secret without deleting its hash/history. A
 * reactivated worker therefore cannot silently resume using an old PIN: the
 * manager must issue a new temporary one through the existing custody flow. */
async function disableCustodyCredentialInTx(tx: any, userId: number, setKind: string) {
  return tx.custodyCredential.updateMany({
    where: { userId, purpose: 'CUSTODY_PIN' },
    data: { status: 'DISABLED', mustChange: true, setKind, version: { increment: 1 } }
  })
}

async function recordCustodyStaffEvent(tx: any, input: { type: string; userId: number; payload?: unknown }) {
  await tx.custodyEvent.create({
    data: {
      type: input.type,
      actorKind: 'GLOBAL_MANAGER',
      authMethod: 'MANAGER_SESSION',
      payloadJson: JSON.stringify({ targetUserId: input.userId, ...(input.payload ?? {}) }),
      operationalDay: toJalaliDate(new Date())
    }
  })
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
    /** فقط IPC داخلیِ نشست اصلی مدیر می‌گذارد؛ از payload معمولی مجاز نیست. */
    managerSession?: boolean
    /** فقط برای نقش MANAGER؛ خالی = رمز فعلی دست‌نخورده بماند. */
    correctionApprovalPassword?: string | null
    /** Required when this edit archives the active drawer custodian. */
    custodyArchiveReason?: unknown
  }) {
    const name = String(input?.name ?? '').trim()
    if (!name) throw new Error('نام کارمند را وارد کنید.')
    const role = normalizeStaffRole(input?.role)
    const id = Math.round(Number(input?.id ?? 0))
    const correctionApprovalPassword = String(input?.correctionApprovalPassword ?? '').trim()
    if (correctionApprovalPassword && role !== 'MANAGER')
      throw new Error('رمز شخصی تأیید اصلاح فقط برای کارمند با نقش «مدیر» قابل ثبت است.')
    if (correctionApprovalPassword && input?.isActive === false)
      throw new Error('رمز شخصی تأیید فقط برای مدیر فعال قابل ثبت است.')
    /** هش از پیش و بیرون از تراکنش ساخته می‌شود؛ خودِ نوشتن User و Audit پایین
     * داخل همان transaction است تا شکست یکی راز نیمه‌ثبت‌شده نگذارد. */
    const correctionApprovalSecret = correctionApprovalPassword
      ? createManagerCorrectionApprovalSecret(correctionApprovalPassword)
      : null

    /**
     * نشست ۱۶۵ · S165-D4 (بند ۴-۲۹ مورد ۱، بند ۴-۳۰، بند ۵ «هر گیت در main») — فهرست کارمندان داخل پنل
     * همیشه‌قفل «تنظیمات» است، ولی کانال staff:save هیچ گیتی نداشت ⇒ هر کسی با دور زدن UI می‌توانست نام همکار را
     * عوض کند (نام در همه‌ی گزارش‌های گذشته‌ی او عوض می‌شود)، او را غیرفعال کند یا کارمند ساختگی بسازد.
     * حالا همان رمز پنل «تنظیمات» (مثل حذف مشتری، S155-D5)، بعد از اعتبارسنجی ورودی و پیش از هر نوشتن.
     */
    const before = id > 0 ? await prisma.user.findUnique({ where: { id }, select: SELECT }) : null
    if (id > 0 && !before) throw new Error('این کارمند پیدا نشد.')
    if (input.managerSession === true) {
      // نشست اصلی مدیر، اختیار کامل دارد و نیازی به رمز دوم Settings ندارد.
      assertManagerSession(id > 0 ? 'ویرایش کارمند' : 'ثبت کارمند تازه')
    } else {
      // مسیر legacy فقط برای سازگاری کانال‌های قدیمی/تست نگه داشته شده است؛
      // UI جدید Settings این مسیر را تولید نمی‌کند.
      await assertPanelPassword(
        PANEL_KEYS.settings,
        input?.panelPassword ?? null,
        id > 0
          ? `ویرایش کارمند «${String((before as any)?.displayName || (before as any)?.username || '')}» (نام/نقش/فعال‌بودن)`
          : `ثبت کارمند تازه «${name}»`
      )
    }

    if (id > 0 && before) {
      const deactivating = before.isActive && input?.isActive === false
      const activeCustodian = deactivating
        ? await assertOperationalDeactivationAllowed(prisma, id, { allowActiveCustodian: true })
        : false
      const writeArchived = async (tx: any) => {
        const row = await tx.user.update({
          where: { id },
          data: {
            displayName: name,
            role,
            isActive: false,
            ...(correctionApprovalSecret ? { passwordHash: correctionApprovalSecret } : role === 'MANAGER' ? {} : { passwordHash: '' })
          },
          select: SELECT
        })
        await disableCustodyCredentialInTx(tx, id, 'ARCHIVED')
        await auditOrThrow(tx, {
          action: 'STAFF_UPDATE', entity: 'User', entityId: id, userId: input?.userId ?? null,
          before: JSON.stringify(shape(before)), after: JSON.stringify(shape(row)),
          note: `آرشیو کارمند «${name}» از مسیر بازیابی امن حضانت؛ رمز شخصی قبلی غیرفعال شد.`
        })
        return row
      }
      if (activeCustodian) {
        const archived = await custodyService.archiveActiveCustodian({
          userId: id,
          reason: input.custodyArchiveReason,
          archiveInTx: writeArchived
        })
        if ((await readActiveId()) === id) await this.setActive({ userId: null })
        return shape(archived.archived as any)
      }
      const updated = await prisma.$transaction(async (tx: any) => {
        const row = await tx.user.update({
          where: { id },
          // خروج نقش مدیر ⇒ راز شخصی مربوط به اختیار مدیرانه هم باقی نمی‌ماند.
          data: {
            displayName: name,
            role,
            isActive: input?.isActive !== false,
            ...(correctionApprovalSecret ? { passwordHash: correctionApprovalSecret } : role === 'MANAGER' ? {} : { passwordHash: '' })
          },
          select: SELECT
        })
        if (!row.isActive) await disableCustodyCredentialInTx(tx, id, 'ARCHIVED')
        if (!before.isActive && row.isActive) {
          await tx.staffProfile.updateMany({ where: { userId: id }, data: { employmentStatus: 'ACTIVE', employmentEndJalali: null, version: { increment: 1 } } })
          await disableCustodyCredentialInTx(tx, id, 'REACTIVATION_PIN_REQUIRED')
          await recordCustodyStaffEvent(tx, { type: 'CUSTODIAN_REACTIVATED_PIN_REQUIRED', userId: id })
        }
        await auditOrThrow(tx, {
          action: 'STAFF_UPDATE',
          entity: 'User',
          entityId: id,
          userId: input?.userId ?? null,
          before: JSON.stringify(shape(before)),
          after: JSON.stringify(shape(row)),
          note: `ویرایش کارمند «${name}» · نقش ${STAFF_ROLE_LABELS[role]} · ${row.isActive ? 'فعال' : 'غیرفعال'}`
        })
        if (correctionApprovalSecret)
          await auditOrThrow(tx, {
            action: 'SETTINGS_UPDATE',
            entity: 'User',
            entityId: row.id,
            userId: input?.userId ?? null,
            after: JSON.stringify({ managerCorrectionApprovalConfigured: true }),
            note: `رمز شخصی تأیید اصلاح دیرهنگام برای مدیر «${row.displayName}» تنظیم/تعویض شد (خود رمز ذخیره یا نمایش داده نمی‌شود).`
          })
        return row
      })
      // کارمندی که غیرفعال شد، نباید «کارمند فعال» بماند
      if (!updated.isActive && (await readActiveId()) === id) await this.setActive({ userId: null })
      return shape(updated)
    }

    const username = await uniqueUsername(name)
    const created = await prisma.$transaction(async (tx: any) => {
      const row = await tx.user.create({
        data: {
          username,
          // این کاربر جایی وارد برنامه نمی‌شود (سیستم ورود نداریم)، پس رمز معنی ندارد.
          passwordHash: correctionApprovalSecret ?? '',
          displayName: name,
          role,
          isActive: input?.isActive !== false
        },
        select: SELECT
      })
      await auditOrThrow(tx, {
        action: 'STAFF_CREATE',
        entity: 'User',
        entityId: row.id,
        userId: input?.userId ?? null,
        after: JSON.stringify(shape(row)),
        note: `ثبت کارمند تازه «${name}» · نقش ${STAFF_ROLE_LABELS[role]}`
      })
      if (correctionApprovalSecret)
        await auditOrThrow(tx, {
          action: 'SETTINGS_UPDATE',
          entity: 'User',
          entityId: row.id,
          userId: input?.userId ?? null,
          after: JSON.stringify({ managerCorrectionApprovalConfigured: true }),
          note: `رمز شخصی تأیید اصلاح دیرهنگام برای مدیر «${row.displayName}» تنظیم/تعویض شد (خود رمز ذخیره یا نمایش داده نمی‌شود).`
        })
      return row
    })
    return shape(created)
  },

  /**
   * پروندهٔ کامل پرسنلی فقط برای نشست اصلی مدیر همان window است. این DTO تنها
   * محل خروج دادهٔ خام هویتی/بانکی است؛ هیچ list، report، export یا Audit
   * عمومی نباید آن را reuse کند.
   */
  async personnel(input: { userId?: unknown } = {}) {
    assertManagerSession('دیدن پروندهٔ حساس پرسنلی')
    const userId = Math.round(Number(input.userId ?? 0))
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new BusinessError('کارمند را انتخاب کنید.')
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: SELECT }),
      prisma.staffProfile.findUnique({ where: { userId } })
    ])
    if (!user) throw new BusinessError('این کارمند پیدا نشد.')
    return {
      staff: shape(user),
      profile: {
        jobTitle: profile?.jobTitle ?? null,
        phone: profile?.phone ?? null,
        nationalId: profile?.nationalId ?? null,
        employmentStartJalali: profile?.employmentStartJalali ?? null,
        employmentEndJalali: profile?.employmentEndJalali ?? null,
        employmentStatus: profile?.employmentStatus ?? 'ACTIVE',
        bankName: profile?.bankName ?? null,
        bankAccountNo: profile?.bankAccountNo ?? null,
        bankIban: profile?.bankIban ?? null,
        bankAccountHolder: profile?.bankAccountHolder ?? null,
        version: profile?.version ?? 0,
        updatedAt: profile?.updatedAt ?? null,
        completion: personnelCompletion(profile)
      }
    }
  },

  /**
   * Persist sensitive data transactionally with a redacted audit record. Raw
   * national/bank values never enter `AuditLog.before/after/note`, so normal
   * audit viewers and exports cannot accidentally disclose them.
   */
  async savePersonnel(input: {
    userId?: unknown
    jobTitle?: unknown
    phone?: unknown
    nationalId?: unknown
    employmentStartJalali?: unknown
    employmentEndJalali?: unknown
    employmentStatus?: unknown
    bankName?: unknown
    bankAccountNo?: unknown
    bankIban?: unknown
    bankAccountHolder?: unknown
  } = {}) {
    assertManagerSession('ویرایش پروندهٔ حساس پرسنلی')
    const userId = Math.round(Number(input.userId ?? 0))
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new BusinessError('کارمند را انتخاب کنید.')
    const [user, before] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: SELECT }),
      prisma.staffProfile.findUnique({ where: { userId } })
    ])
    if (!user) throw new BusinessError('این کارمند پیدا نشد.')
    const data = preparePersonnel(mergePersonnelInput(before, input))
    await assertNationalIdAvailable(data.nationalId, userId)
    const changedFields = Object.keys(data).filter((key) => String((before as any)?.[key] ?? '') !== String((data as any)[key] ?? ''))
    const terminateOperationally = data.employmentStatus === 'TERMINATED' && user.isActive
    await prisma.$transaction(async (tx: any) => {
      if (terminateOperationally) await assertOperationalDeactivationAllowed(tx, userId)
      const after = await tx.staffProfile.upsert({
        where: { userId },
        update: { ...data, version: { increment: 1 } },
        create: { userId, kind: 'STAFF', ...data }
      })
      await auditOrThrow(tx, {
        action: 'STAFF_PERSONNEL_SENSITIVE_UPDATE',
        entity: 'StaffProfile',
        entityId: userId,
        userId: null,
        before: JSON.stringify(redactedPersonnelSummary(before)),
        after: JSON.stringify(redactedPersonnelSummary(after)),
        note: `ویرایش پروندهٔ حساس کارمند «${user.displayName || user.username}» با نشست سراسری مدیر · فیلدهای تغییرکرده: ${changedFields.join('، ') || 'بدون تغییر'}`
      })
      if (terminateOperationally) {
        const inactive = await tx.user.update({ where: { id: userId }, data: { isActive: false }, select: SELECT })
        await disableCustodyCredentialInTx(tx, userId, 'ARCHIVED')
        await auditOrThrow(tx, {
          action: 'STAFF_UPDATE', entity: 'User', entityId: userId, userId: null,
          before: JSON.stringify(shape(user)), after: JSON.stringify(shape(inactive)),
          note: `کارمند «${inactive.displayName}» هم‌زمان با ثبت «پایان همکاری» از عملیات صندوق غیرفعال شد.`
        })
      }
    })
    if (terminateOperationally && (await readActiveId()) === userId) await this.setActive({ userId: null })
    return this.personnel({ userId })
  },

  /**
   * مسیر ثبت از Settings: User پایه و StaffProfile حساس در یک transaction
   * نوشته می‌شوند. بنابراین اعتبارسنجی ناموفق، unique conflict یا خطای Audit
   * هیچ «کارمند بدون پرونده» یا «پرونده بدون کارمند» به‌جا نمی‌گذارد.
   */
  async saveComplete(input: {
    id?: number | null
    name?: string
    role?: string
    isActive?: boolean
    correctionApprovalPassword?: string | null
    /** Required only while archiving the current active drawer custodian. */
    custodyArchiveReason?: unknown
  } & PersonnelInput) {
    assertManagerSession('ثبت یا ویرایش کامل کارمند')
    const name = String(input?.name ?? '').trim()
    if (!name) throw new BusinessError('نام کارمند را وارد کنید.')
    const role = normalizeStaffRole(input?.role)
    const id = Math.round(Number(input?.id ?? 0))
    const correctionApprovalPassword = String(input?.correctionApprovalPassword ?? '').trim()
    if (correctionApprovalPassword && role !== 'MANAGER')
      throw new BusinessError('رمز شخصی تأیید اصلاح فقط برای کارمند با نقش «مدیر» قابل ثبت است.')
    if (correctionApprovalPassword && input?.isActive === false)
      throw new BusinessError('رمز شخصی تأیید فقط برای مدیر فعال قابل ثبت است.')
    const correctionApprovalSecret = correctionApprovalPassword
      ? createManagerCorrectionApprovalSecret(correctionApprovalPassword)
      : null
    const [beforeUser, beforeProfileForMerge] = id > 0
      ? await Promise.all([
          prisma.user.findUnique({ where: { id }, select: SELECT }),
          prisma.staffProfile.findUnique({ where: { userId: id } })
        ])
      : [null, null]
    if (id > 0 && !beforeUser) throw new BusinessError('این کارمند پیدا نشد.')
    const reactivating = !!beforeUser && !beforeUser.isActive && input?.isActive !== false
    const mergedPersonnel = mergePersonnelInput(beforeProfileForMerge, input)
    /** Reactivation is deliberately one-way: a terminated marker and its old
     * end date cannot survive while the User becomes operational again. */
    if (reactivating) {
      mergedPersonnel.employmentStatus = 'ACTIVE'
      mergedPersonnel.employmentEndJalali = ''
    }
    const personnel = preparePersonnel(mergedPersonnel)
    await assertNationalIdAvailable(personnel.nationalId, id > 0 ? id : null)
    const username = id > 0 ? null : await uniqueUsername(name)
    /** TERMINATED is never merely a decorative profile label: the same atomic
     * save removes operational eligibility after the custody safety guard. */
    const willBeActive = input?.isActive !== false && personnel.employmentStatus !== 'TERMINATED'
    if (correctionApprovalPassword && !willBeActive)
      throw new BusinessError('رمز شخصی تأیید فقط برای مدیر فعال قابل ثبت است.')

    const deactivating = !!beforeUser && beforeUser.isActive && !willBeActive
    const activeCustodian = deactivating
      ? await assertOperationalDeactivationAllowed(prisma, id, { allowActiveCustodian: true })
      : false
    const writeComplete = async (tx: any) => {
      const beforeProfile = id > 0 ? await tx.staffProfile.findUnique({ where: { userId: id } }) : null
      const user = id > 0
        ? await tx.user.update({
            where: { id },
            data: {
              displayName: name,
              role,
              isActive: willBeActive,
              ...(correctionApprovalSecret ? { passwordHash: correctionApprovalSecret } : role === 'MANAGER' ? {} : { passwordHash: '' })
            },
            select: SELECT
          })
        : await tx.user.create({
            data: {
              username: username!,
              passwordHash: correctionApprovalSecret ?? '',
              displayName: name,
              role,
              isActive: willBeActive
            },
            select: SELECT
          })
      const profile = await tx.staffProfile.upsert({
        where: { userId: user.id },
        update: { ...personnel, version: { increment: 1 } },
        create: { userId: user.id, kind: 'STAFF', ...personnel }
      })
      if (!user.isActive) await disableCustodyCredentialInTx(tx, user.id, 'ARCHIVED')
      if (reactivating && user.isActive) {
        await disableCustodyCredentialInTx(tx, user.id, 'REACTIVATION_PIN_REQUIRED')
        await recordCustodyStaffEvent(tx, { type: 'CUSTODIAN_REACTIVATED_PIN_REQUIRED', userId: user.id })
      }
      const changedFields = Object.keys(personnel).filter((key) => String((beforeProfile as any)?.[key] ?? '') !== String((personnel as any)[key] ?? ''))
      await auditOrThrow(tx, {
        action: id > 0 ? 'STAFF_UPDATE' : 'STAFF_CREATE',
        entity: 'User',
        entityId: user.id,
        userId: null,
        before: id > 0 ? JSON.stringify(shape(beforeUser!)) : null,
        after: JSON.stringify(shape(user)),
        note: activeCustodian
          ? `آرشیو کارمند «${name}» از مسیر بازیابی امن حضانت؛ رمز شخصی قبلی غیرفعال شد.`
          : `${id > 0 ? 'ویرایش' : 'ثبت'} کارمند «${name}» با نشست سراسری مدیر`
      })
      await auditOrThrow(tx, {
        action: 'STAFF_PERSONNEL_SENSITIVE_UPDATE',
        entity: 'StaffProfile',
        entityId: user.id,
        userId: null,
        before: JSON.stringify(redactedPersonnelSummary(beforeProfile)),
        after: JSON.stringify(redactedPersonnelSummary(profile)),
        note: `ثبت اتمی پروندهٔ حساس کارمند «${name}» با نشست سراسری مدیر · فیلدهای تغییرکرده: ${changedFields.join('، ') || 'بدون تغییر'}`
      })
      if (correctionApprovalSecret)
        await auditOrThrow(tx, {
          action: 'SETTINGS_UPDATE',
          entity: 'User',
          entityId: user.id,
          userId: null,
          after: JSON.stringify({ managerCorrectionApprovalConfigured: true }),
          note: `رمز شخصی تأیید اصلاح دیرهنگام برای مدیر «${user.displayName}» تنظیم/تعویض شد (خود رمز ذخیره یا نمایش داده نمی‌شود).`
        })
      return { user, profile }
    }
    const result = activeCustodian
      ? (await custodyService.archiveActiveCustodian({ userId: id, reason: input.custodyArchiveReason, archiveInTx: writeComplete })).archived
      : await prisma.$transaction(writeComplete)
    if (!result.user.isActive && (await readActiveId()) === result.user.id) await this.setActive({ userId: null })
    return { staff: shape(result.user), profile: redactedPersonnelSummary(result.profile), reactivated: reactivating, requiresTemporaryCustodyPin: reactivating }
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
