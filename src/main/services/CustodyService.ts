import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { auditOrThrow } from './AuditService'
import { AuditAction } from '@shared/enums'
import { DEFAULT_CUSTODY_CONFIG, parseCustodyConfig, SETTING_KEYS, type CustodyConfig } from '@shared/receipt'
import { toJalaliDate } from '@shared/jalali'
import { shiftService } from './ShiftService'
import { recordCashMovement } from './CashMovementService'
import { cashboxService } from './CashboxService'
import { CashMovementType } from '@shared/enums'
import { assertManagerSession } from './panelSession'

/**
 * Custody v2 deliberately lives beside, rather than inside, the legacy shift
 * model.  The feature flag is false by default: callers must opt in before a
 * single legacy sale/shift path changes.
 */
const MAIN = 'MAIN'
const PURPOSE = 'CUSTODY_PIN'
const PIN_ATTEMPTS = 5
const PIN_LOCK_MS = 15 * 60 * 1000

type Client = any
export type CustodyFence = {
  epoch: number
  expectedShiftId: number
  expectedActorUserId: number
}

function asSafeId(value: unknown, label = 'شناسه'): number {
  const n = Math.round(Number(value))
  if (!Number.isSafeInteger(n) || n <= 0) throw new BusinessError(`${label} نامعتبر است.`)
  return n
}

function asCash(value: unknown, label = 'مبلغ'): number {
  /** `Number('')` and `Number(null)` are zero, but an omitted count must never
   * silently become a cash count. Zero is accepted only when it was explicit. */
  if (value == null || (typeof value === 'string' && !value.trim()) || (typeof value !== 'number' && typeof value !== 'string'))
    throw new BusinessError(`${label} را صریحاً به‌صورت یک عدد صحیحِ صفر یا مثبت وارد کنید.`)
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isSafeInteger(n) || n < 0) throw new BusinessError(`${label} باید یک عدد صحیحِ صفر یا مثبت باشد.`)
  return n
}

/** Persian/Arabic digits and the two common Arabic letter variants must not
 * create visually-identical but different credentials.  All other letters and
 * symbols remain exact; whitespace is banned to prevent invisible passwords. */
export function normalizeCustodyPassword(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
}

function assertPasswordPolicy(raw: unknown, phone?: string | null) {
  const password = normalizeCustodyPassword(raw)
  if (password.length < 6 || password.length > 128 || /\s/u.test(password))
    throw new BusinessError('رمز شخصی باید بین ۶ تا ۱۲۸ کاراکتر باشد و فاصله نداشته باشد.')
  if (!/^[\p{L}\p{N}\p{P}\p{S}]+$/u.test(password))
    throw new BusinessError('رمز شخصی فقط می‌تواند شامل حروف، اعداد و نمادهای معمول باشد.')
  const plain = password.toLocaleLowerCase('fa-IR')
  if (/^(.)\1+$/u.test(plain) || ['123456', '654321', 'abcdef', 'fedcba', 'qwerty'].includes(plain))
    throw new BusinessError('این رمز بسیار ساده است؛ یک رمز شخصی متفاوت انتخاب کنید.')
  const digits = normalizeCustodyPassword(phone ?? '').replace(/\D/g, '')
  if (digits.length >= 6 && plain === digits.slice(-6))
    throw new BusinessError('رمز شخصی نباید شش رقم آخر شماره تلفن خودتان باشد.')
  return password
}

function derive(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function rolloverAt(now: Date, config: CustodyConfig): Date {
  const out = new Date(now)
  out.setHours(0, config.dayCutoverMinute, 0, 0)
  if (out <= now) out.setDate(out.getDate() + 1)
  return out
}

async function configOf(client: Client = prisma): Promise<CustodyConfig> {
  const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.custodyConfig } })
  return parseCustodyConfig(row?.value ?? DEFAULT_CUSTODY_CONFIG)
}

/** A plan describes expected staffing only. Missing, late, or absent scheduled
 * staff never blocks sales; it merely produces a reminder tied to the actual
 * authenticated custody session. */
async function planForOpen(client: Client, userId: number, now = new Date()) {
  const [plans, assignments] = await Promise.all([
    client.shiftPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    client.shiftPlanStaff.findMany({ where: { userId } })
  ])
  const assigned = new Set(assignments.map((row: any) => row.planId))
  const candidates: Array<{ plan: any; start: Date; end: Date }> = []
  for (const plan of plans) {
    if (!assigned.has(plan.id)) continue
    for (const dayOffset of [0, -1]) {
      const start = new Date(now)
      start.setDate(start.getDate() + dayOffset)
      start.setHours(0, Number(plan.startMinute), 0, 0)
      const weekdayMask = 1 << start.getDay()
      if ((Number(plan.daysMask) & weekdayMask) === 0) continue
      const end = new Date(start.getTime() + Number(plan.durationMinutes) * 60_000)
      if (now >= start && now < end) candidates.push({ plan, start, end })
    }
  }
  candidates.sort((a, b) => b.start.getTime() - a.start.getTime() || a.plan.id - b.plan.id)
  const match = candidates[0] ?? null
  return match ? { id: match.plan.id, title: match.plan.title, scheduledEndAt: match.end, reminderRepeatMin: Number(match.plan.reminderRepeatMin) } : null
}

async function writeEvent(client: Client, input: {
  type: string
  shiftId?: number | null
  handoverId?: number | null
  actorUserId?: number | null
  actorKind: string
  authMethod?: string | null
  epochBefore?: number | null
  epochAfter?: number | null
  payload?: unknown
}) {
  await client.custodyEvent.create({
    data: {
      type: input.type,
      shiftId: input.shiftId ?? null,
      handoverId: input.handoverId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind,
      authMethod: input.authMethod ?? null,
      epochBefore: input.epochBefore ?? null,
      epochAfter: input.epochAfter ?? null,
      payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
      operationalDay: toJalaliDate(new Date())
    }
  })
}

async function credentialOf(client: Client, userId: number) {
  return client.custodyCredential.findFirst({ where: { userId, purpose: PURPOSE } })
}

async function ensureState(client: Client) {
  await client.custodyState.upsert({
    where: { key: MAIN },
    update: {},
    create: { key: MAIN, state: 'NO_SESSION', epoch: 0 }
  })
  const state = await client.custodyState.findUnique({ where: { key: MAIN } })
  if (!state) throw new BusinessError('وضعیت صندوق قابل تعیین نیست. از مدیر بخواهید وضعیت را بررسی کند.', 'CUSTODY_NOT_INITIALIZED')
  return state
}

async function pinGateOpen(userId: number) {
  const gate = `custody-pin:${userId}`
  const row = await prisma.authLockout.findUnique({ where: { gate } })
  if (row?.lockedUntil && new Date(row.lockedUntil) > new Date())
    throw new BusinessError('رمز شخصی به‌دلیل تلاش‌های ناموفق موقتاً قفل شده است. چند دقیقه دیگر دوباره تلاش کنید.', 'PIN_LOCKED')
}

async function pinFailure(userId: number): Promise<never> {
  const gate = `custody-pin:${userId}`
  const previous = await prisma.authLockout.findUnique({ where: { gate } })
  const failures = Number(previous?.failCount ?? 0) + 1
  const locked = failures >= PIN_ATTEMPTS
  await prisma.authLockout.upsert({
    where: { gate },
    update: {
      failCount: locked ? 0 : failures,
      lastFailAt: new Date(),
      lockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MS) : null,
      lockCount: locked ? Number(previous?.lockCount ?? 0) + 1 : Number(previous?.lockCount ?? 0)
    },
    create: {
      gate,
      failCount: locked ? 0 : failures,
      lastFailAt: new Date(),
      lockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MS) : null,
      lockCount: locked ? 1 : 0
    }
  })
  throw new BusinessError(locked ? 'رمز شخصی چند بار اشتباه وارد شد و ۱۵ دقیقه قفل شد.' : 'رمز شخصی درست نیست.', locked ? 'PIN_LOCKED' : 'PIN_WRONG')
}

async function pinSuccess(userId: number) {
  const gate = `custody-pin:${userId}`
  await prisma.authLockout.updateMany({ where: { gate }, data: { failCount: 0, lockedUntil: null } })
}

export const custodyService = {
  async config() {
    return configOf(prisma)
  },

  async enabled() {
    return (await configOf(prisma)).enabled
  },

  async guardLegacyPath() {
    if (await this.enabled()) throw new BusinessError('در حالت حضانت صندوق، از مسیر رسمی حضانت استفاده کنید.', 'CUSTODY_LEGACY_PATH')
  },

  async status() {
    const cfg = await configOf(prisma)
    if (cfg.enabled) await this.ensureRolledOver()
    const state = await ensureState(prisma)
    const shift = state.activeShiftId ? await prisma.shift.findUnique({ where: { id: state.activeShiftId }, include: { user: true } }) : null
    const meta = state.activeShiftId ? await prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } }) : null
    const unresolved = await prisma.custodyResolution.findMany({ where: { status: 'OPEN' }, orderBy: { openedAt: 'asc' } })
    const scheduledPlan = meta?.planId ? await prisma.shiftPlan.findUnique({ where: { id: meta.planId }, select: { reminderRepeatMin: true } }) : null
    const scheduledEndAt = meta?.scheduledEndAt ? new Date(meta.scheduledEndAt) : null
    const reminderStart = scheduledEndAt ? new Date(scheduledEndAt.getTime() + cfg.overrunGraceMinutes * 60_000) : null
    const repeatMinutes = Math.max(5, Number(scheduledPlan?.reminderRepeatMin ?? 15))
    const now = Date.now()
    const reminderDue = !!(cfg.mode === 'MULTI_SHIFT' && cfg.reminderEnabled && reminderStart && now >= reminderStart.getTime())
    const reminderBucket = reminderDue ? Math.floor((now - reminderStart!.getTime()) / (repeatMinutes * 60_000)) : null
    return {
      enabled: cfg.enabled,
      config: cfg,
      state: state.state,
      epoch: state.epoch,
      activeShiftId: state.activeShiftId,
      custodian: shift?.userId ? { id: shift.userId, name: shift.user?.displayName ?? null, openAuth: meta?.openAuth ?? null } : null,
      shift: shift ? { id: shift.id, openedAt: shift.openedAt, closedAt: shift.closedAt, name: shift.name } : null,
      schedule: meta?.planId ? { planId: meta.planId, title: meta.planTitle, scheduledEndAt: meta.scheduledEndAt } : null,
      reminder: { due: reminderDue, bucket: reminderBucket, repeatMinutes, scheduledEndAt: scheduledEndAt?.toISOString() ?? null },
      pendingHandover: state.pendingHandoverId
        ? await prisma.custodyHandover.findUnique({ where: { id: state.pendingHandoverId }, select: { id: true, fromUserId: true, selectedRecipientUserId: true, startedAt: true } })
        : null,
      unresolved: unresolved.map((row: any) => ({ id: row.id, shiftId: row.shiftId, openedAt: row.openedAt, nightExpectedCash: row.nightExpectedCash })),
      unresolvedCount: unresolved.length
    }
  },

  /** Credential verification is deliberately outside a financial transaction:
   * it writes its own lockout row, exactly like the existing auth preverify pattern. */
  async verifyPin(userIdInput: unknown, rawPassword: unknown, opts: { allowTemporary?: boolean; requireManager?: boolean } = {}) {
    const userId = asSafeId(userIdInput, 'شناسه کارمند')
    await pinGateOpen(userId)
    const [user, credential] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      credentialOf(prisma, userId)
    ])
    if (!user || !user.isActive) throw new BusinessError('کارمند انتخاب‌شده فعال نیست.', 'INACTIVE')
    if (opts.requireManager && user.role !== 'MANAGER') throw new BusinessError('این عملیات فقط با رمز شخصی مدیر فعال مجاز است.', 'NO_PERMISSION')
    if (!credential || credential.status !== 'ACTIVE') throw new BusinessError('برای این کارمند هنوز رمز شخصی حضانت تعریف نشده است.', 'PIN_NOT_SET')
    const password = normalizeCustodyPassword(rawPassword)
    if (!password || !sameHash(credential.hash, derive(password, credential.salt))) return pinFailure(userId)
    await pinSuccess(userId)
    if (credential.mustChange && !opts.allowTemporary)
      throw new BusinessError('این رمز موقت است؛ ابتدا رمز شخصی خودتان را تغییر دهید.', 'PIN_MUST_CHANGE')
    return { userId: user.id, displayName: user.displayName, role: user.role, mustChange: credential.mustChange }
  },

  async setPin(input: { userId: unknown; newPassword: unknown; currentPassword?: unknown; managerUserId?: unknown; managerPassword?: unknown; reason?: unknown; managerSession?: boolean }) {
    const userId = asSafeId(input.userId, 'شناسه کارمند')
    const target = await prisma.user.findUnique({ where: { id: userId } })
    if (!target) throw new BusinessError('کارمند پیدا نشد.')
    const managerId = input.managerUserId == null ? null : asSafeId(input.managerUserId, 'شناسه مدیر')
    const sessionManager = input.managerSession === true
    if (sessionManager) assertManagerSession('صدور یا بازنشانی رمز حضانت کارمند')
    const isSelf = !sessionManager && (managerId == null || managerId === userId)
    let actorId: number | null = isSelf ? userId : null
    let setKind = isSelf ? 'SELF' : 'MANAGER_TEMP'
    if (isSelf) {
      const prior = await credentialOf(prisma, userId)
      if (prior) await this.verifyPin(userId, input.currentPassword, { allowTemporary: true })
      else if (target.role !== 'MANAGER') throw new BusinessError('تعریف اولین رمز این کارمند باید توسط مدیر انجام شود.')
      else {
        /** Bootstrap has no custody PIN to verify yet; use the established
         * server-side manager secret once, then all subsequent actions use the
         * named manager's personal credential. Dynamic import avoids a module
         * initialization cycle with ShiftService. */
        const { assertManagerPassword } = await import('./AuthService')
        await assertManagerPassword(String(input.currentPassword ?? ''), 'تعریف رمز اولیه حضانت مدیر')
      }
    } else {
      const reason = String(input.reason ?? '').trim()
      if (reason.length < 3) throw new BusinessError('مدیر برای تغییر رمز کارمند باید دلیل کوتاهی ثبت کند.')
      if (!sessionManager) {
        const manager = await this.verifyPin(managerId, input.managerPassword, { requireManager: true })
        actorId = manager.userId
      }
    }
    const profile = await prisma.staffProfile.findUnique({ where: { userId } })
    const password = assertPasswordPolicy(input.newPassword, profile?.phone ?? null)
    const salt = randomBytes(16).toString('hex')
    await prisma.$transaction(async (tx: Client) => {
      const prior = await credentialOf(tx, userId)
      const data = { algo: 'scrypt-v1', salt, hash: derive(password, salt), mustChange: !isSelf, status: 'ACTIVE', setAt: new Date(), setByUserId: actorId, setKind }
      if (prior) await tx.custodyCredential.updateMany({ where: { userId, purpose: PURPOSE }, data: { ...data, version: { increment: 1 } } })
      else await tx.custodyCredential.create({ data: { userId, purpose: PURPOSE, ...data } })
      await writeEvent(tx, { type: isSelf ? 'PIN_SET' : 'PIN_RESET_TEMP', actorUserId: actorId, actorKind: isSelf ? 'CUSTODIAN' : sessionManager ? 'GLOBAL_MANAGER' : 'MANAGER', authMethod: isSelf ? 'CUSTODY_PIN' : sessionManager ? 'MANAGER_SESSION' : 'MANAGER_CUSTODY_PIN', payload: { targetUserId: userId, setKind } })
      await auditOrThrow(tx, { action: AuditAction.SETTINGS_UPDATE, entity: 'CustodyCredential', entityId: userId, userId: actorId, after: JSON.stringify({ targetUserId: userId, purpose: PURPOSE, setKind, mustChange: !isSelf, authMethod: sessionManager ? 'MANAGER_SESSION' : undefined }), note: isSelf ? 'رمز شخصی حضانت کارمند تغییر کرد.' : `مدیر رمز موقت حضانت کارمند «${target.displayName}» را تعیین کرد.` })
    })
    await pinSuccess(userId)
    return { userId, hasPin: true, mustChange: !isSelf }
  },


  /**
   * This list also feeds the daily top-bar workflow, so it must not become a
   * back door to employment/contact data. Identity, role and credential state
   * are all that opening/handing-over a drawer needs; the manager-only Staff
   * profile remains the sole source for phone/job/banking/identity data.
   */
  async staffList() {
    const [users, credentials] = await Promise.all([
      prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { id: 'asc' }] }),
      prisma.custodyCredential.findMany({ where: { purpose: PURPOSE }, select: { userId: true, mustChange: true, status: true } })
    ])
    const c = new Map(credentials.map((r: any) => [r.userId, r]))
    return users.map((user: any) => {
      const credential = c.get(user.id)
      return { id: user.id, name: user.displayName, role: user.role, isActive: user.isActive, hasCustodyPin: !!credential && credential.status === 'ACTIVE', mustChangePin: !!credential?.mustChange }
    })
  },

  /** Manager-only operational report. It deliberately exposes identities and
   * reconciliation evidence but never a credential hash, PIN, or raw credit
   * code. Every row comes from append-only custody/cash records. */
  async report(input: { managerUserId?: unknown; managerPassword?: unknown; from?: unknown; take?: unknown; managerSession?: boolean } = {} as any) {
    if (input.managerSession === true) assertManagerSession('دیدن گزارش کنترل حضانت')
    else await this.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const parsedFrom = input.from == null ? new Date(Date.now() - 90 * 24 * 60 * 60_000) : new Date(String(input.from))
    const from = Number.isFinite(parsedFrom.getTime()) ? parsedFrom : new Date(Date.now() - 90 * 24 * 60 * 60_000)
    const take = Math.min(500, Math.max(1, Math.round(Number(input.take ?? 150)) || 150))
    const [events, counts, handovers, resolutions, dispositions] = await Promise.all([
      prisma.custodyEvent.findMany({ where: { at: { gte: from } }, orderBy: { at: 'desc' }, take }),
      prisma.custodyCount.findMany({ where: { at: { gte: from } }, orderBy: { at: 'desc' }, take }),
      prisma.custodyHandover.findMany({ where: { startedAt: { gte: from } }, orderBy: { startedAt: 'desc' }, take }),
      prisma.custodyResolution.findMany({ where: { openedAt: { gte: from } }, orderBy: { openedAt: 'desc' }, take }),
      prisma.custodyDisposition.findMany({ where: { at: { gte: from } }, orderBy: { at: 'desc' }, take })
    ])
    const ids = new Set<number>()
    for (const e of events) if (e.actorUserId) ids.add(e.actorUserId)
    for (const c of counts) ids.add(c.countedByUserId)
    for (const h of handovers) { ids.add(h.fromUserId); ids.add(h.selectedRecipientUserId); if (h.finalCustodianUserId) ids.add(h.finalCustodianUserId) }
    for (const r of resolutions) { if (r.decisionByUserId) ids.add(r.decisionByUserId); if (r.attributedToUserId) ids.add(r.attributedToUserId) }
    for (const d of dispositions) { if (d.recipientUserId) ids.add(d.recipientUserId); if (d.confirmedByUserId) ids.add(d.confirmedByUserId) }
    const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, displayName: true } }) : []
    const userName = new Map(users.map((row: any) => [row.id, row.displayName]))
    return {
      from: from.toISOString(),
      summary: {
        handovers: handovers.length,
        unresolvedOpen: resolutions.filter((row: any) => row.status === 'OPEN').length,
        dispositionPending: dispositions.filter((row: any) => row.confirmStatus !== 'CONFIRMED' && row.confirmStatus !== 'REVERSED').length,
        totalCountDifference: counts.reduce((sum: bigint, row: any) => sum + BigInt(row.differenceCash ?? 0), BigInt(0))
      },
      events: events.map((row: any) => ({ id: row.id, type: row.type, at: row.at, shiftId: row.shiftId, handoverId: row.handoverId, resolutionId: row.resolutionId, actorUserId: row.actorUserId, actorName: row.actorUserId ? userName.get(row.actorUserId) ?? null : null, actorKind: row.actorKind, payload: row.payloadJson ? JSON.parse(row.payloadJson) : null })),
      counts: counts.map((row: any) => ({ id: row.id, at: row.at, shiftId: row.shiftId, kind: row.kind, countedCash: row.countedCash, expectedCash: row.expectedCash, differenceCash: row.differenceCash, countedByUserId: row.countedByUserId, countedByName: userName.get(row.countedByUserId) ?? null, operationalDay: row.operationalDay })),
      handovers: handovers.map((row: any) => ({ id: row.id, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, fromShiftId: row.fromShiftId, toShiftId: row.toShiftId, fromUser: userName.get(row.fromUserId) ?? null, selectedRecipient: userName.get(row.selectedRecipientUserId) ?? null, finalCustodian: row.finalCustodianUserId ? userName.get(row.finalCustodianUserId) ?? null : null, expectedAtStart: row.expectedAtStart, countedAtStart: row.countedAtStart, differenceCash: row.differenceCash, resolutionKind: row.resolutionKind })),
      resolutions: resolutions.map((row: any) => ({ id: row.id, shiftId: row.shiftId, status: row.status, openedAt: row.openedAt, resolvedAt: row.resolvedAt, nightExpectedCash: row.nightExpectedCash, provisionalDifference: row.provisionalDifference, differenceAttribution: row.differenceAttribution, decisionByName: row.decisionByUserId ? userName.get(row.decisionByUserId) ?? null : null, decisionReason: row.decisionReason })),
      dispositions: dispositions.map((row: any) => ({ id: row.id, at: row.at, shiftId: row.shiftId, cashSessionId: row.cashSessionId, kind: row.kind, amount: row.amount, confirmStatus: row.confirmStatus, recipientName: row.recipientUserId ? userName.get(row.recipientUserId) ?? null : null, confirmedByName: row.confirmedByUserId ? userName.get(row.confirmedByUserId) ?? null : null, trackingNo: row.trackingNo, destinationLabel: row.destinationLabel }))
    }
  },

  async setConfig(input: { config: unknown; managerUserId?: unknown; managerPassword?: unknown; managerSession?: boolean }) {
    const current = await configOf(prisma)
    if (input.managerSession === true) {
      assertManagerSession('تغییر تنظیمات ساختاری حضانت صندوق')
    } else {
      const [credentials, managers] = await Promise.all([
        prisma.custodyCredential.findMany({ where: { purpose: PURPOSE, status: 'ACTIVE' } }),
        prisma.user.findMany({ where: { role: 'MANAGER', isActive: true }, select: { id: true } })
      ])
      const managerIds = new Set(managers.map((row: any) => row.id))
      const existingManagerCredential = credentials.find((row: any) => managerIds.has(row.userId))
      if (!existingManagerCredential)
        throw new BusinessError('ابتدا مدیر باید با رمز فعلی مدیر، رمز شخصی حضانت خودش را راه‌اندازی کند.', 'CUSTODY_MANAGER_PIN_REQUIRED')
      await this.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    }
    const next = parseCustodyConfig(input.config)
    /** A fresh install is deliberately SINGLE_SHIFT. MULTI_SHIFT is an explicit
     * staffing policy, not a visual toggle: at least one active named plan must
     * already have a scheduled person before it can govern operations. */
    if (next.enabled && next.mode === 'MULTI_SHIFT') {
      const [plans, assignments] = await Promise.all([
        prisma.shiftPlan.findMany({ where: { isActive: true }, select: { id: true } }),
        prisma.shiftPlanStaff.findMany({ select: { planId: true, userId: true } })
      ])
      const activeIds = new Set(plans.map((row: any) => row.id))
      if (!assignments.some((row: any) => activeIds.has(row.planId)))
        throw new BusinessError('برای فعال‌سازی چندشیفت، ابتدا حداقل یک برنامهٔ فعال با کارمند مشخص ثبت کنید.', 'CUSTODY_MULTI_SHIFT_NEEDS_PLAN')
    }
    const state = await ensureState(prisma)
    if (current.enabled !== next.enabled && state.state !== 'NO_SESSION') throw new BusinessError('تا وقتی صندوق باز یا در حال تحویل است، روشن/خاموش‌کردن حضانت مجاز نیست.')
    await prisma.setting.upsert({ where: { key: SETTING_KEYS.custodyConfig }, update: { value: JSON.stringify(next) }, create: { key: SETTING_KEYS.custodyConfig, value: JSON.stringify(next) } })
    return next
  },

  async open(input: { userId: unknown; password: unknown; countedCash?: unknown; note?: unknown }) {
    const actor = await this.verifyPin(input.userId, input.password)
    if (actor.role !== 'MANAGER' && actor.role !== 'CASHIER') throw new BusinessError('این نقش مجاز به تحویل‌گیری صندوق نیست.', 'NO_PERMISSION')
    const countedCash = input.countedCash == null ? null : asCash(input.countedCash, 'شمارش نقدی')
    return prisma.$transaction(async (tx: Client) => {
      const cfg = await configOf(tx)
      if (!cfg.enabled) throw new BusinessError('ماژول حضانت صندوق هنوز فعال نشده است.')
      const plan = cfg.mode === 'MULTI_SHIFT' ? await planForOpen(tx, actor.userId) : null
      const state = await ensureState(tx)
      if (state.state !== 'NO_SESSION') throw new BusinessError('صندوق هم‌اکنون یک مسئول فعال دارد.', 'SESSION_ALREADY_OPEN')
      if (await shiftService.anyOpenShift(tx)) throw new BusinessError('یک نشست بازِ قدیمی وجود دارد؛ ابتدا وضعیت حضانت را بررسی کنید.', 'CUSTODY_INVARIANT_BROKEN')
      const beforeEpoch = Number(state.epoch)
      const shift = await shiftService.createSession(tx, { staffId: actor.userId, staffConfirmed: true, actorId: actor.userId, mode: 'MANUAL', note: String(input.note ?? '').trim() || null })
      const nextEpoch = beforeEpoch + 1
      let count: any = null
      if (countedCash != null) {
        count = await tx.custodyCount.create({ data: { shiftId: shift.id, kind: 'OPENING', countedCash: BigInt(countedCash), countedByUserId: actor.userId, authMethod: 'CUSTODY_PIN', epochAtCount: nextEpoch, idempotencyKey: `open:${shift.id}`, operationalDay: toJalaliDate(new Date()) } })
        if (countedCash > 0) await recordCashMovement(tx, { amount: countedCash, type: CashMovementType.OPENING_FLOAT, shiftId: shift.id, userId: actor.userId, refType: 'CustodyOpen', refId: count.id, description: 'موجودی اول صندوق حضانت' })
      }
      await tx.custodyShiftMeta.create({ data: { shiftId: shift.id, custodianUserId: actor.userId, openAuth: 'CUSTODY_PIN', openCountId: count?.id ?? null, planId: plan?.id ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, rolloverAt: rolloverAt(new Date(), cfg), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: countedCash == null ? 'COUNT_PENDING' : 'COUNTED', openEpoch: nextEpoch } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'NO_SESSION', epoch: beforeEpoch }, data: { state: 'ACTIVE', activeShiftId: shift.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'OPEN', shiftId: shift.id, actorUserId: actor.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: beforeEpoch, epochAfter: nextEpoch, payload: { counted: countedCash != null } })
      return { shiftId: shift.id, epoch: nextEpoch, countStatus: countedCash == null ? 'COUNT_PENDING' : 'COUNTED' }
    })
  },

  /** Lazy rollover is invoked by custody status/financial entry, never by a
   * timer that could silently move money. It closes only the operational Shift,
   * not the financial period; final reconciliation remains manager-only. */
  async ensureRolledOver(now = new Date()) {
    const state = await ensureState(prisma)
    if ((state.state !== 'ACTIVE' && state.state !== 'HANDOVER_PENDING') || !state.activeShiftId) return null
    const meta = await prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
    if (!meta || new Date(meta.rolloverAt) > now) return null
    const result = await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      const liveMeta = live.activeShiftId ? await tx.custodyShiftMeta.findUnique({ where: { shiftId: live.activeShiftId } }) : null
      if (!liveMeta || (live.state !== 'ACTIVE' && live.state !== 'HANDOVER_PENDING') || live.activeShiftId !== state.activeShiftId || live.epoch !== state.epoch || new Date(liveMeta.rolloverAt) > now) return null
      const shift = await tx.shift.findUnique({ where: { id: live.activeShiftId } })
      if (!shift || shift.closedAt) return null
      const nextEpoch = Number(live.epoch) + 1
      let handoverId: number | null = null
      if (live.state === 'HANDOVER_PENDING' && live.pendingHandoverId) {
        handoverId = live.pendingHandoverId
        await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'EXPIRED_UNRESOLVED', resolutionKind: 'EXPIRED_AT_ROLLOVER', finalCustodianUserId: null, finishedAt: now, version: { increment: 1 } } })
      }
      const closed = await shiftService.closeInTx(tx, { shiftId: shift.id, userId: shift.userId ?? null, note: 'پایان روز عملیاتی؛ نیازمند تعیین تکلیف مدیر' })
      await tx.custodyShiftMeta.update({ where: { shiftId: shift.id }, data: { endKind: handoverId ? 'EXPIRED_UNRESOLVED' : 'UNRESOLVED', endedAt: closed.closedAt } })
      const resolution = await tx.custodyResolution.create({ data: { shiftId: shift.id, status: 'OPEN', evidence: 'NONE', differenceAttribution: 'PENDING_DECISION' } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: live.state, activeShiftId: shift.id, epoch: live.epoch }, data: { state: 'NO_SESSION', activeShiftId: null, pendingHandoverId: null, epoch: nextEpoch, updatedAt: now } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ rollover ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'ROLLOVER_UNRESOLVED', shiftId: shift.id, handoverId, actorKind: 'SYSTEM', epochBefore: live.epoch, epochAfter: nextEpoch, payload: { resolutionId: resolution.id } })
      return { resolutionId: resolution.id, shiftId: shift.id }
    })
    if (result) {
      /** The shift is closed, so this read cannot affect morning attribution.
       * Snapshot completion is retriable; it never changes any money formula. */
      try {
        const expected = await cashboxService.expected({ shiftId: result.shiftId })
        await prisma.custodyResolution.updateMany({ where: { id: result.resolutionId, status: 'OPEN' }, data: { nightExpectedCash: BigInt(Number(expected.expectedCash)) } })
      } catch {
        // Manager resolution still has the canonical Cashbox calculation; do not
        // turn a reporting read failure into a new sales block.
      }
    }
    return result
  },

  async resolveUnresolved(input: { resolutionId: unknown; managerUserId: unknown; managerPassword: unknown; countedCash?: unknown; reason: unknown; attribution?: unknown; attributedToUserId?: unknown }) {
    const resolutionId = asSafeId(input.resolutionId, 'شناسه پرونده شب')
    const manager = await this.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 10) throw new BusinessError('برای تعیین تکلیف شبِ بی‌پاسخ، دلیل روشن و کامل بنویسید.')
    const resolution = await prisma.custodyResolution.findUnique({ where: { id: resolutionId } })
    if (!resolution || resolution.status !== 'OPEN') throw new BusinessError('این پرونده قبلاً تعیین تکلیف شده یا پیدا نشد.')
    const shift = await prisma.shift.findUnique({ where: { id: resolution.shiftId } })
    if (!shift?.closedAt) throw new BusinessError('نشست شب برای تعیین تکلیف آماده نیست.', 'CUSTODY_INVARIANT_BROKEN')
    const countedCash = input.countedCash == null ? null : asCash(input.countedCash, 'شمارش نقدی')
    const attribution = ['UNASSIGNED', 'CUSTODIAN_ACK', 'MANAGER_DECISION', 'DIFFERENCE_UNKNOWN'].includes(String(input.attribution)) ? String(input.attribution) : 'UNASSIGNED'
    const attributedToUserId = input.attributedToUserId == null ? null : asSafeId(input.attributedToUserId, 'شناسه شخص مسئول')
    return cashboxService.close({
      shiftId: shift.id,
      explicitShift: true,
      closeShift: false,
      countedCash,
      note: reason,
      userId: manager.userId,
      custodyEffectiveTo: new Date(shift.closedAt),
      afterCloseInTx: async (tx: Client, session: any) => {
        const changed = await tx.custodyResolution.updateMany({ where: { id: resolutionId, status: 'OPEN', shiftId: shift.id }, data: { status: 'RESOLVED', cashSessionId: session.id, decisionByUserId: manager.userId, decisionReason: reason, differenceAttribution: attribution, attributedToUserId, resolvedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('پرونده شب هم‌زمان تغییر کرد؛ عملیات ثبت نشد.', 'CUSTODY_STALE')
        await tx.custodyShiftMeta.updateMany({ where: { shiftId: shift.id, endKind: { in: ['UNRESOLVED', 'EXPIRED_UNRESOLVED'] } }, data: { endKind: 'FINAL_CLOSE', cashSessionId: session.id } })
        await writeEvent(tx, { type: 'UNRESOLVED_RESOLVED', shiftId: shift.id, resolutionId, actorUserId: manager.userId, actorKind: 'MANAGER', authMethod: 'MANAGER_CUSTODY_PIN', payload: { cashSessionId: session.id, attribution } })
      }
    } as any)
  },

  /** First-run fallback only. Once any active personal custody credential exists,
   * a cashier may not evade attribution by selecting an owner fallback. */
  async openDefaultOwnerSession(): Promise<CustodyFence> {
    return prisma.$transaction(async (tx: Client) => {
      const cfg = await configOf(tx)
      if (!cfg.enabled) throw new BusinessError('ماژول حضانت صندوق فعال نیست.')
      const state = await ensureState(tx)
      if (state.state !== 'NO_SESSION') throw new BusinessError('صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      const credentials = await tx.custodyCredential.findMany({ where: { purpose: PURPOSE, status: 'ACTIVE' } })
      if (credentials.length) throw new BusinessError('برای فروش باید کارمند پشت صندوق با رمز شخصی خودش مشخص شود.', 'CUSTODY_AUTH_REQUIRED')
      if (await shiftService.anyOpenShift(tx)) throw new BusinessError('یک نشست بازِ قدیمی وجود دارد؛ ابتدا وضعیت حضانت را بررسی کنید.', 'CUSTODY_INVARIANT_BROKEN')
      let profile = await tx.staffProfile.findFirst({ where: { kind: 'BOOTSTRAP_OWNER' } })
      let owner: any
      if (profile) {
        owner = await tx.user.findUnique({ where: { id: profile.userId } })
      }
      if (!owner) {
        let username = 'bootstrap-owner'
        for (let i = 2; ; i++) {
          const prior = await tx.user.findUnique({ where: { username } })
          if (!prior) break
          username = `bootstrap-owner-${i}`
        }
        owner = await tx.user.create({ data: { username, passwordHash: '', displayName: 'مالک فروشگاه (راه‌اندازی)', role: 'CASHIER', isActive: true } })
        try {
          profile = await tx.staffProfile.create({ data: { userId: owner.id, kind: 'BOOTSTRAP_OWNER' } })
        } catch (error: any) {
          if (String(error?.code ?? '') !== 'P2002') throw error
          profile = await tx.staffProfile.findFirst({ where: { kind: 'BOOTSTRAP_OWNER' } })
          owner = profile ? await tx.user.findUnique({ where: { id: profile.userId } }) : null
        }
      }
      if (!owner || !profile) throw new BusinessError('هویت مالک راه‌اندازی قابل ساخت نیست؛ عملیات ثبت نشد.', 'CUSTODY_INVARIANT_BROKEN')
      const beforeEpoch = Number(state.epoch)
      const nextEpoch = beforeEpoch + 1
      const shift = await shiftService.createSession(tx, { staffId: owner.id, staffConfirmed: true, actorId: owner.id, mode: 'MANUAL', note: 'نشست راه‌اندازی بدون رمز شخصی' })
      await tx.custodyShiftMeta.create({ data: { shiftId: shift.id, custodianUserId: owner.id, openAuth: 'DEFAULT_OWNER', rolloverAt: rolloverAt(new Date(), cfg), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: 'COUNT_PENDING', openEpoch: nextEpoch } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'NO_SESSION', epoch: beforeEpoch }, data: { state: 'ACTIVE', activeShiftId: shift.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'OPEN_DEFAULT_OWNER', shiftId: shift.id, actorUserId: owner.id, actorKind: 'BOOTSTRAP_OWNER', epochBefore: beforeEpoch, epochAfter: nextEpoch, payload: { countStatus: 'COUNT_PENDING' } })
      return { epoch: nextEpoch, expectedShiftId: shift.id, expectedActorUserId: owner.id }
    })
  },

  async finalClose(input: { password: unknown; countedCash: unknown; note?: unknown; dispositions?: unknown }) {
    const state = await ensureState(prisma)
    if (state.state !== 'ACTIVE' || !state.activeShiftId) throw new BusinessError('نشست فعالی برای بستن نهایی وجود ندارد.', 'NO_OPEN_SESSION')
    const meta = await prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
    if (!meta) throw new BusinessError('اطلاعات حضانت نشست فعلی ناقص است.', 'CUSTODY_INVARIANT_BROKEN')
    const actor = await this.verifyPin(meta.custodianUserId, input.password)
    const countedCash = asCash(input.countedCash, 'شمارش نهایی نقدی')
    const rawDispositions = Array.isArray(input.dispositions) ? input.dispositions : [{ kind: 'KEEP_IN_DRAWER', amount: countedCash }]
    const dispositions = rawDispositions.map((row: any, index: number) => {
      const kind = String(row?.kind ?? '')
      if (!['KEEP_IN_DRAWER', 'TO_MANAGER', 'BANK_OR_SAFE'].includes(kind)) throw new BusinessError('نوع تعیین تکلیف پول نامعتبر است.')
      const amount = asCash(row?.amount, 'مبلغ تعیین تکلیف پول')
      const recipientUserId = row?.recipientUserId == null ? null : asSafeId(row.recipientUserId, 'شناسه گیرنده')
      if (kind === 'TO_MANAGER' && !recipientUserId) throw new BusinessError('برای تحویل پول به مدیر، گیرنده را مشخص کنید.')
      return { kind, amount, recipientUserId, destinationLabel: String(row?.destinationLabel ?? '').trim().slice(0, 160) || null, trackingNo: String(row?.trackingNo ?? '').trim().slice(0, 160) || null, allocationKey: `final:${index}:${kind}` }
    })
    const managerRecipientIds = [...new Set(dispositions.filter((row: any) => row.kind === 'TO_MANAGER').map((row: any) => row.recipientUserId))]
    if (managerRecipientIds.length) {
      const recipients = await prisma.user.findMany({ where: { id: { in: managerRecipientIds as number[] }, role: 'MANAGER', isActive: true }, select: { id: true } })
      if (recipients.length !== managerRecipientIds.length) throw new BusinessError('پول فقط می‌تواند به مدیر فعالِ مشخص تحویل شود.')
    }
    if (dispositions.reduce((sum: number, row: any) => sum + row.amount, 0) !== countedCash)
      throw new BusinessError('جمع تعیین تکلیف پول باید دقیقاً با مبلغ شمرده‌شده صندوق برابر باشد.')
    const fence: CustodyFence = { epoch: Number(state.epoch), expectedShiftId: state.activeShiftId, expectedActorUserId: actor.userId }
    return cashboxService.close({
      shiftId: state.activeShiftId,
      explicitShift: true,
      countedCash,
      note: String(input.note ?? '').trim() || undefined,
      userId: actor.userId,
      afterCloseInTx: async (tx: Client, session: any) => {
        await this.assertFenceInTx(tx, fence, { allowClosedShift: true })
        const live = await ensureState(tx)
        const nextEpoch = Number(live.epoch) + 1
        const count = await tx.custodyCount.create({ data: { shiftId: state.activeShiftId, kind: 'CLOSING', countedCash: BigInt(countedCash), expectedCash: session.expectedCash, differenceCash: session.cashDifference, countedByUserId: actor.userId, authMethod: 'CUSTODY_PIN', epochAtCount: nextEpoch, idempotencyKey: `close:${session.id}`, operationalDay: toJalaliDate(new Date()), note: String(input.note ?? '').trim() || null } })
        await tx.custodyShiftMeta.update({ where: { shiftId: state.activeShiftId }, data: { endKind: 'FINAL_CLOSE', endedAt: new Date(), cashSessionId: session.id, countStatus: 'COUNTED' } })
        await tx.custodyDisposition.createMany({ data: dispositions.map((row: any) => ({ cashSessionId: session.id, shiftId: state.activeShiftId, kind: row.kind, amount: BigInt(row.amount), recipientUserId: row.recipientUserId, destinationLabel: row.destinationLabel, trackingNo: row.trackingNo, confirmStatus: row.kind === 'KEEP_IN_DRAWER' ? 'CONFIRMED' : row.kind === 'TO_MANAGER' ? 'CLAIMED' : 'PENDING', claimedByUserId: actor.userId, confirmedByUserId: row.kind === 'KEEP_IN_DRAWER' ? actor.userId : null, confirmedAt: row.kind === 'KEEP_IN_DRAWER' ? new Date() : null, allocationKey: row.allocationKey, countBeforeWithdrawal: 'COUNT_BEFORE' })) })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'ACTIVE', activeShiftId: state.activeShiftId, epoch: live.epoch }, data: { state: 'NO_SESSION', activeShiftId: null, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ بستن نهایی ثبت نشد.', 'CUSTODY_STALE')
        await writeEvent(tx, { type: 'FINAL_CLOSE', shiftId: state.activeShiftId, actorUserId: actor.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: live.epoch, epochAfter: nextEpoch, payload: { cashSessionId: session.id, countId: count.id } })
      }
    } as any)
  },

  /** A disposition is a declaration, not an untracked cash movement.  Its
   * lifecycle is therefore confirmed/reversed through immutable custody events
   * instead of being deleted or silently overwritten. */
  async confirmDisposition(input: { dispositionId: unknown; userId: unknown; password: unknown }) {
    const dispositionId = asSafeId(input.dispositionId, 'شناسه تعیین تکلیف')
    const row = await prisma.custodyDisposition.findUnique({ where: { id: dispositionId } })
    if (!row || ['CONFIRMED', 'REVERSED'].includes(row.confirmStatus)) throw new BusinessError('این تعیین تکلیف قابل تأیید نیست.')
    const actor = await this.verifyPin(input.userId, input.password)
    if (row.kind === 'TO_MANAGER') {
      if (row.recipientUserId !== actor.userId || actor.role !== 'MANAGER')
        throw new BusinessError('تحویل به مدیر فقط با رمز شخصی همان مدیر انتخاب‌شده تأیید می‌شود.', 'NO_PERMISSION')
    } else if (actor.role !== 'MANAGER') {
      throw new BusinessError('تأیید این تعیین تکلیف فقط با رمز شخصی مدیر مجاز است.', 'NO_PERMISSION')
    }
    return prisma.$transaction(async (tx: Client) => {
      const changed = await tx.custodyDisposition.updateMany({ where: { id: dispositionId, confirmStatus: { in: ['PENDING', 'CLAIMED'] } }, data: { confirmStatus: 'CONFIRMED', confirmedByUserId: actor.userId, confirmedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('تعیین تکلیف هم‌زمان تغییر کرد؛ دوباره وضعیت را بگیرید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'DISPOSITION_CONFIRMED', shiftId: row.shiftId, actorUserId: actor.userId, actorKind: 'MANAGER', authMethod: 'CUSTODY_PIN', payload: { dispositionId, cashSessionId: row.cashSessionId, kind: row.kind, amount: String(row.amount) } })
      return { id: dispositionId, confirmStatus: 'CONFIRMED' }
    })
  },

  async reverseDisposition(input: { dispositionId: unknown; managerUserId: unknown; managerPassword: unknown; reason: unknown }) {
    const dispositionId = asSafeId(input.dispositionId, 'شناسه تعیین تکلیف')
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 10) throw new BusinessError('برای برگشت تعیین تکلیف، دلیل روشن و کامل بنویسید.')
    const manager = await this.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const row = await prisma.custodyDisposition.findUnique({ where: { id: dispositionId } })
    if (!row || row.confirmStatus === 'REVERSED') throw new BusinessError('این تعیین تکلیف قابل برگشت نیست.')
    return prisma.$transaction(async (tx: Client) => {
      const changed = await tx.custodyDisposition.updateMany({ where: { id: dispositionId, confirmStatus: row.confirmStatus }, data: { confirmStatus: 'REVERSED', confirmedByUserId: manager.userId, confirmedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('تعیین تکلیف هم‌زمان تغییر کرد؛ دوباره وضعیت را بگیرید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'DISPOSITION_REVERSED', shiftId: row.shiftId, actorUserId: manager.userId, actorKind: 'MANAGER', authMethod: 'MANAGER_CUSTODY_PIN', payload: { dispositionId, cashSessionId: row.cashSessionId, kind: row.kind, amount: String(row.amount), reason } })
      await auditOrThrow(tx, { action: AuditAction.SETTINGS_UPDATE, entity: 'CustodyDisposition', entityId: dispositionId, userId: manager.userId, after: JSON.stringify({ confirmStatus: 'REVERSED', reason }), note: 'برگشتِ ثبت‌شده‌ی تعیین تکلیف پول صندوق' })
      return { id: dispositionId, confirmStatus: 'REVERSED' }
    })
  },

  async handoverStart(input: { password: unknown; countedCash: unknown; toUserId: unknown; idempotencyKey?: unknown; note?: unknown }) {
    const state = await ensureState(prisma)
    if (state.state !== 'ACTIVE' || !state.activeShiftId) throw new BusinessError('نشست فعالی برای تحویل وجود ندارد.', 'NO_OPEN_SESSION')
    const fromMeta = await prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
    if (!fromMeta) throw new BusinessError('اطلاعات حضانت نشست فعلی ناقص است.', 'CUSTODY_INVARIANT_BROKEN')
    const giver = await this.verifyPin(fromMeta.custodianUserId, input.password)
    const toUserId = asSafeId(input.toUserId, 'شناسه تحویل‌گیرنده')
    if (toUserId === giver.userId) throw new BusinessError('تحویل‌گیرنده باید شخص دیگری باشد.', 'RECEIVER_SAME')
    const [receiver, credential] = await Promise.all([
      prisma.user.findUnique({ where: { id: toUserId } }),
      credentialOf(prisma, toUserId)
    ])
    if (!receiver?.isActive || !credential || credential.status !== 'ACTIVE' || credential.mustChange)
      throw new BusinessError('تحویل‌گیرنده باید کارمند فعال با رمز شخصیِ غیرموقت باشد.', 'RECEIVER_NO_PIN')
    if (receiver.role !== 'MANAGER' && receiver.role !== 'CASHIER') throw new BusinessError('این نقش مجاز به تحویل‌گیری صندوق نیست.', 'NO_PERMISSION')
    const countedCash = asCash(input.countedCash, 'شمارش تحویل صندوق')
    const idempotencyKey = String(input.idempotencyKey ?? '').trim() || randomBytes(16).toString('hex')
    const started = await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      if (live.state !== 'ACTIVE' || live.activeShiftId !== state.activeShiftId || live.epoch !== state.epoch)
        throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      const nextEpoch = Number(live.epoch) + 1
      const count = await tx.custodyCount.create({ data: { shiftId: state.activeShiftId, kind: 'HANDOVER_OUT', countedCash: BigInt(countedCash), countedByUserId: giver.userId, authMethod: 'CUSTODY_PIN', epochAtCount: nextEpoch, idempotencyKey: idempotencyKey, operationalDay: toJalaliDate(new Date()), note: String(input.note ?? '').trim() || null } })
      const handover = await tx.custodyHandover.create({ data: { fromShiftId: state.activeShiftId, fromUserId: giver.userId, selectedRecipientUserId: toUserId, status: 'PENDING', outCountId: count.id, expectedAtStart: BigInt(0), countedAtStart: BigInt(countedCash), differenceCash: BigInt(0), ledgerWatermark: JSON.stringify({ ready: false }), fenceEpochAtStart: nextEpoch, idempotencyKey, stateKey: MAIN, operationalDay: toJalaliDate(new Date()) } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'ACTIVE', activeShiftId: state.activeShiftId, epoch: state.epoch }, data: { state: 'HANDOVER_PENDING', pendingHandoverId: handover.id, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'HANDOVER_START', shiftId: state.activeShiftId, handoverId: handover.id, actorUserId: giver.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { selectedRecipientUserId: toUserId } })
      return { handover, epoch: nextEpoch, count }
    })
    /** After PENDING commits no fenced sale can enter the drawer.  The existing
     * calculation is read-only and supplies a stable expected snapshot; accept
     * refuses a handover if this completing step did not finish. */
    const expected = await cashboxService.expected({ shiftId: state.activeShiftId, countedCash })
    const expectedCash = Number(expected.expectedCash)
    await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      if (live.state !== 'HANDOVER_PENDING' || live.pendingHandoverId !== started.handover.id || live.epoch !== started.epoch)
        throw new BusinessError('تحویل دیگر در وضعیت قابل تکمیل نیست.', 'HANDOVER_NOT_PENDING')
      await tx.custodyCount.update({ where: { id: started.count.id }, data: { expectedCash: BigInt(expectedCash), differenceCash: BigInt(countedCash - expectedCash) } })
      await tx.custodyHandover.update({ where: { id: started.handover.id }, data: { expectedAtStart: BigInt(expectedCash), differenceCash: BigInt(countedCash - expectedCash), ledgerWatermark: JSON.stringify({ ready: true, expectedCash, countedCash, at: new Date().toISOString() }) } })
    })
    return { id: started.handover.id, state: 'HANDOVER_PENDING', expectedCash, countedCash, differenceCash: countedCash - expectedCash }
  },

  async handoverAccept(input: { handoverId: unknown; password: unknown }) {
    const handoverId = asSafeId(input.handoverId, 'شناسه تحویل')
    const pending = await prisma.custodyHandover.findUnique({ where: { id: handoverId } })
    if (!pending || pending.status !== 'PENDING') throw new BusinessError('این تحویل دیگر در انتظار پذیرش نیست.', 'HANDOVER_NOT_PENDING')
    const ready = JSON.parse(String(pending.ledgerWatermark || '{}'))
    if (!ready.ready) throw new BusinessError('شمارش تحویل هنوز کامل نشده است؛ ابتدا تحویل‌دهنده آن را لغو یا کامل کند.', 'RECOUNT_REQUIRED')
    const receiver = await this.verifyPin(pending.selectedRecipientUserId, input.password)
    return prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      if (state.state !== 'HANDOVER_PENDING' || state.pendingHandoverId !== handoverId)
        throw new BusinessError('این تحویل دیگر در انتظار پذیرش نیست.', 'HANDOVER_NOT_PENDING')
      const live = await tx.custodyHandover.findUnique({ where: { id: handoverId } })
      if (!live || live.status !== 'PENDING' || live.fromShiftId !== state.activeShiftId) throw new BusinessError('اطلاعات تحویل ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
      const closed = await shiftService.closeInTx(tx, { shiftId: live.fromShiftId, userId: live.fromUserId, note: 'تحویل احرازشده صندوق' })
      const nextEpoch = Number(state.epoch) + 1
      const cfg = await configOf(tx)
      const plan = cfg.mode === 'MULTI_SHIFT' ? await planForOpen(tx, receiver.userId) : null
      const next = await shiftService.createSession(tx, { staffId: receiver.userId, staffConfirmed: true, actorId: receiver.userId, mode: 'HANDOVER', openIdempotencyKey: live.idempotencyKey, openIdempotencyFingerprint: `custody-handover:${handoverId}`, note: 'تحویل احرازشده صندوق' })
      if (Number(live.countedAtStart) > 0) await recordCashMovement(tx, { amount: Number(live.countedAtStart), type: CashMovementType.OPENING_FLOAT, shiftId: next.id, userId: receiver.userId, refType: 'CustodyHandover', refId: handoverId, description: 'موجودی اول ناشی از تحویل صندوق' })
      await tx.custodyShiftMeta.update({ where: { shiftId: live.fromShiftId }, data: { endKind: 'HANDED_OVER', endedAt: closed.closedAt } })
      await tx.custodyShiftMeta.create({ data: { shiftId: next.id, custodianUserId: receiver.userId, openAuth: 'HANDOVER_RECEIVER_PIN', planId: plan?.id ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, rolloverAt: rolloverAt(new Date(), cfg), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: 'COUNTED', openEpoch: nextEpoch } })
      await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'COMPLETED', finalCustodianUserId: receiver.userId, acceptedByUserId: receiver.userId, resolutionKind: 'RECEIVER_ACCEPTED', toShiftId: next.id, finishedAt: new Date(), version: { increment: 1 } } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_PENDING', pendingHandoverId: handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: next.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ تحویل ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'HANDOVER_ACCEPT', shiftId: next.id, handoverId, actorUserId: receiver.userId, actorKind: 'RECEIVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { fromShiftId: live.fromShiftId, toShiftId: next.id } })
      return { handoverId, shiftId: next.id, epoch: nextEpoch }
    })
  },

  async handoverCancel(input: { handoverId: unknown; password: unknown }) {
    const handoverId = asSafeId(input.handoverId, 'شناسه تحویل')
    const pending = await prisma.custodyHandover.findUnique({ where: { id: handoverId } })
    if (!pending || pending.status !== 'PENDING') throw new BusinessError('این تحویل دیگر در انتظار لغو نیست.', 'HANDOVER_NOT_PENDING')
    const giver = await this.verifyPin(pending.fromUserId, input.password)
    return prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      if (state.state !== 'HANDOVER_PENDING' || state.pendingHandoverId !== handoverId) throw new BusinessError('این تحویل دیگر در انتظار لغو نیست.', 'HANDOVER_NOT_PENDING')
      const nextEpoch = Number(state.epoch) + 1
      await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'CANCELED', resolutionKind: 'CANCELED_BY_GIVER', finishedAt: new Date(), version: { increment: 1 } } })
      await tx.custodyCount.create({ data: { shiftId: pending.fromShiftId, kind: 'HANDOVER_CANCELED', countedCash: pending.countedAtStart, countedByUserId: giver.userId, authMethod: 'CUSTODY_PIN', handoverId, epochAtCount: nextEpoch, idempotencyKey: `cancel:${handoverId}`, operationalDay: toJalaliDate(new Date()) } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_PENDING', pendingHandoverId: handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: pending.fromShiftId, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ لغو ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'HANDOVER_CANCEL', shiftId: pending.fromShiftId, handoverId, actorUserId: giver.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: {} })
      return { handoverId, state: 'ACTIVE', epoch: nextEpoch }
    })
  },

  async actorForFinancialOperation(): Promise<CustodyFence | null> {
    const cfg = await configOf(prisma)
    if (!cfg.enabled) return null
    await this.ensureRolledOver()
    const state = await ensureState(prisma)
    if (state.state === 'NO_SESSION') return this.openDefaultOwnerSession()
    if (state.state === 'HANDOVER_PENDING') throw new BusinessError('صندوق در حال تحویل است؛ فروش تا پایان تحویل موقتاً متوقف است.', 'HANDOVER_PENDING')
    if (state.state !== 'ACTIVE' || !state.activeShiftId) throw new BusinessError('برای ادامهٔ فروش، ابتدا مسئول صندوق را مشخص کنید.', 'CUSTODY_AUTH_REQUIRED')
    const [shift, meta] = await Promise.all([prisma.shift.findUnique({ where: { id: state.activeShiftId } }), prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })])
    if (!shift || shift.closedAt || !shift.userId || !meta || meta.custodianUserId !== shift.userId)
      throw new BusinessError('وضعیت حضانت صندوق ناسازگار است؛ مدیر باید آن را بررسی کند.', 'CUSTODY_INVARIANT_BROKEN')
    return { epoch: Number(state.epoch), expectedShiftId: shift.id, expectedActorUserId: shift.userId }
  },

  /** First statement of every fenced financial transaction.  It intentionally
   * performs a conditional write, rather than a read, to serialize SQLite
   * writers and reject stale requests after handover/close/rollover. */
  async assertFenceInTx(tx: Client, fence: CustodyFence, opts: { allowClosedShift?: boolean } = {}) {
    const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'ACTIVE', activeShiftId: fence.expectedShiftId, epoch: fence.epoch }, data: { updatedAt: new Date() } })
    if (changed.count !== 1) throw new BusinessError('صندوق همین حالا تحویل یا بسته شد؛ صفحه را تازه کنید و دوباره تلاش کنید.', 'CUSTODY_STALE')
    const [shift, meta] = await Promise.all([tx.shift.findUnique({ where: { id: fence.expectedShiftId } }), tx.custodyShiftMeta.findUnique({ where: { shiftId: fence.expectedShiftId } })])
    if (!shift || (!opts.allowClosedShift && !!shift.closedAt) || shift.userId !== fence.expectedActorUserId || !meta || meta.custodianUserId !== fence.expectedActorUserId)
      throw new BusinessError('وضعیت مسئول صندوق هم‌زمان تغییر کرد؛ درخواست ثبت نشد.', 'CUSTODY_STALE')
    return shift
  }
}
