import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { audit, auditOrThrow } from './AuditService'
import { AuditAction } from '@shared/enums'
import { DEFAULT_CUSTODY_CONFIG, parseCustodyConfig, parseShiftConfig, SETTING_KEYS, type CustodyConfig, type ShiftConfig, type ShiftTemplate } from '@shared/receipt'
import { toJalaliDate } from '@shared/jalali'
import { shiftService } from './ShiftService'
import { recordCashMovement } from './CashMovementService'
import { cashboxService } from './CashboxService'
import { CashMovementType } from '@shared/enums'
import { assertManagerSession } from './panelSession'
import { assertManagerPassword } from './AuthService'

/**
 * Custody v2 deliberately lives beside, rather than inside, the legacy shift
 * model.  The feature flag is false by default: callers must opt in before a
 * single legacy sale/shift path changes.
 */
const MAIN = 'MAIN'
const PURPOSE = 'CUSTODY_PIN'
const PIN_ATTEMPTS = 5
const PIN_LOCK_MS = 15 * 60 * 1000
/** The final fifteen minutes belong to the planned shift-change flow; before
 * this boundary a replacement is a true mid-day handover and needs its own
 * template permission. */
const MIDDAY_HANDOVER_CUTOFF_MS = 15 * 60 * 1000

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

/** Fallback only for unscheduled/legacy sessions. Scheduled canonical work
 * must expire from its own scheduled end, never from a day cutover that can
 * prematurely terminate an overnight allowance. */
function cutoverRolloverAt(now: Date, config: CustodyConfig): Date {
  const out = new Date(now)
  out.setHours(0, config.dayCutoverMinute, 0, 0)
  if (out <= now) out.setDate(out.getDate() + 1)
  return out
}

type CustodyPlanSnapshot = {
  legacyPlanId: number | null
  templateId: string | null
  title: string | null
  scheduledEndAt: Date | null
  reminderRepeatMin: number
  allowMidDayHandover: boolean
}

/** Schedule configuration is mutable policy for future work. Every newly
 * opened responsibility segment stores this compact immutable snapshot so a
 * later mode/template edit cannot rewrite its expiry, handover permission,
 * reminder rhythm, or scheduled-recipient rule. */
type CustodySegmentScheduleSnapshot = {
  templateId: string | null
  planId: number | null
  title: string | null
  scheduledEndAt: string | null
  reminderRepeatMin: number
  allowMidDayHandover: boolean
  staffIds: number[]
  overrunGraceMinutes: number
  overtimeMaxMinutes: number
  reminderEnabled: boolean
  mode: 'SINGLE_SHIFT' | 'MULTI_SHIFT'
}

function scheduleSnapshotJson(plan: CustodyPlanSnapshot | null, scheduling?: ShiftConfig | null, custody?: CustodyConfig | null): string | null {
  if (!plan) return null
  const template = plan.templateId && scheduling ? scheduling.templates.find((row) => row.id === plan.templateId) ?? null : null
  return JSON.stringify({
    templateId: plan.templateId ?? null,
    planId: plan.legacyPlanId ?? null,
    title: plan.title ?? null,
    scheduledEndAt: plan.scheduledEndAt ? new Date(plan.scheduledEndAt).toISOString() : null,
    reminderRepeatMin: Math.max(5, Math.min(60, Number(plan.reminderRepeatMin) || 15)),
    allowMidDayHandover: plan.allowMidDayHandover === true,
    staffIds: template ? [...template.staffIds] : [],
    overrunGraceMinutes: Math.max(0, Math.min(1440, Math.round(Number(scheduling?.overrunGraceMinutes)) || 0)),
    overtimeMaxMinutes: Math.max(0, Math.min(240, Math.round(Number(scheduling?.overtimeMaxMinutes)) || 0)),
    reminderEnabled: scheduling?.reminderEnabled !== false,
    mode: scheduling && custody ? effectiveCustodyMode(custody, scheduling) : 'MULTI_SHIFT'
  } satisfies CustodySegmentScheduleSnapshot)
}

function scheduleSnapshotOf(meta: { scheduleSnapshotJson?: string | null } | null | undefined): CustodySegmentScheduleSnapshot | null {
  if (!meta?.scheduleSnapshotJson) return null
  try {
    const raw = JSON.parse(String(meta.scheduleSnapshotJson))
    if (!raw || typeof raw !== 'object') return null
    const templateId = raw.templateId == null ? null : String(raw.templateId)
    const planId = raw.planId == null ? null : Math.round(Number(raw.planId))
    const scheduledEndAt = raw.scheduledEndAt == null ? null : String(raw.scheduledEndAt)
    if (scheduledEndAt && !Number.isFinite(new Date(scheduledEndAt).getTime())) return null
    const rawStaffIds: unknown[] = Array.isArray(raw.staffIds) ? raw.staffIds : []
    const staffIds = [...new Set<number>(rawStaffIds
      .map((id): number => Math.round(Number(id)))
      .filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
    return {
      templateId,
      planId: Number.isSafeInteger(planId) && planId! > 0 ? planId : null,
      title: raw.title == null ? null : String(raw.title),
      scheduledEndAt,
      reminderRepeatMin: Math.max(5, Math.min(60, Math.round(Number(raw.reminderRepeatMin)) || 15)),
      allowMidDayHandover: raw.allowMidDayHandover === true,
      staffIds,
      overrunGraceMinutes: Math.max(0, Math.min(1440, Math.round(Number(raw.overrunGraceMinutes)) || 0)),
      overtimeMaxMinutes: Math.max(0, Math.min(240, Math.round(Number(raw.overtimeMaxMinutes)) || 0)),
      // v1 snapshots did not record these fields; they were emitted only for
      // canonical multi-shift segments, so preserve that conservative meaning.
      reminderEnabled: raw.reminderEnabled !== false,
      mode: raw.mode === 'SINGLE_SHIFT' ? 'SINGLE_SHIFT' : 'MULTI_SHIFT'
    }
  } catch {
    return null
  }
}

function planFromSegmentSnapshot(meta: { templateId?: string | null; planId?: number | null; planTitle?: string | null; scheduledEndAt?: Date | null; scheduleSnapshotJson?: string | null }, fallback?: { reminderRepeatMin?: number; allowMidDayHandover?: boolean } | null): CustodyPlanSnapshot | null {
  const snap = scheduleSnapshotOf(meta)
  const templateId = snap?.templateId ?? meta.templateId ?? null
  const legacyPlanId = snap?.planId ?? meta.planId ?? null
  const title = snap?.title ?? meta.planTitle ?? null
  const scheduledEndAt = snap?.scheduledEndAt ? new Date(snap.scheduledEndAt) : meta.scheduledEndAt ? new Date(meta.scheduledEndAt) : null
  if (!templateId && !legacyPlanId && !title && !scheduledEndAt) return null
  return {
    legacyPlanId,
    templateId,
    title,
    scheduledEndAt,
    reminderRepeatMin: snap?.reminderRepeatMin ?? fallback?.reminderRepeatMin ?? 15,
    allowMidDayHandover: snap?.allowMidDayHandover ?? fallback?.allowMidDayHandover ?? false
  }
}

/** `overtimeMaxMinutes` is the configured scheduled overtime allowance. It is
 * deliberately distinct from `overrunGraceMinutes`, which merely controls a
 * reminder. Only canonical scheduled sessions get this expiry; legacy plans
 * and unscheduled sessions retain their cutover fallback. */
function rolloverAt(now: Date, config: CustodyConfig, scheduling: ShiftConfig, plan: CustodyPlanSnapshot | null): Date {
  const scheduledEnd = plan?.templateId && plan.scheduledEndAt ? new Date(plan.scheduledEndAt) : null
  if (scheduledEnd && Number.isFinite(scheduledEnd.getTime()))
    return new Date(scheduledEnd.getTime() + Math.max(0, Number(scheduling.overtimeMaxMinutes) || 0) * 60_000)
  return cutoverRolloverAt(now, config)
}

/** Reused/continued segments inherit the source snapshot's overtime, rather
 * than letting an edit made after their original opening move their expiry. */
function rolloverAtForSnapshot(now: Date, config: CustodyConfig, scheduling: ShiftConfig, plan: CustodyPlanSnapshot | null, snapshotJson?: string | null): Date {
  const snapshot = scheduleSnapshotOf(snapshotJson == null ? null : { scheduleSnapshotJson: snapshotJson })
  const scheduledEnd = snapshot?.templateId && snapshot.scheduledEndAt ? new Date(snapshot.scheduledEndAt) : null
  if (snapshot && scheduledEnd && Number.isFinite(scheduledEnd.getTime()))
    return new Date(scheduledEnd.getTime() + snapshot.overtimeMaxMinutes * 60_000)
  return rolloverAt(now, config, scheduling, plan)
}

/** Existing open canonical segments did not snapshot their scheduled expiry in
 * earlier versions. Read their durable scheduled-end metadata instead of
 * imposing the legacy cutover; newly opened segments persist the same result
 * in `rolloverAt`. */
function expiryAt(meta: { rolloverAt: Date }, _scheduling?: ShiftConfig): Date {
  // `rolloverAt` was calculated and persisted at segment creation. Reading the
  // current Settings here would silently change a live segment after a manager
  // edits overtime or mode, which is precisely what the custody boundary forbids.
  return new Date(meta.rolloverAt)
}

async function configOf(client: Client = prisma): Promise<CustodyConfig> {
  const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.custodyConfig } })
  return parseCustodyConfig(row?.value ?? DEFAULT_CUSTODY_CONFIG)
}

/** Canonical schedule lives in shift.config. The legacy custody config remains
 * only as an execution/feature flag during transition; legacy ShiftPlan rows
 * are never silently copied into this model. */
async function shiftSchedulingOf(client: Client = prisma): Promise<ShiftConfig> {
  const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.shiftConfig } })
  return parseShiftConfig(row?.value ?? null)
}

/** There were historically two persisted mode fields.  An old installation is
 * deliberately left on its custody.config decision until the manager completes
 * the explicit workflow, which writes both fields atomically.  From that point
 * onward shift.config is the sole operational scheduling authority. */
function effectiveCustodyMode(custody: CustodyConfig, scheduling: ShiftConfig): 'SINGLE_SHIFT' | 'MULTI_SHIFT' {
  if (scheduling.custodyModeConfigured) return scheduling.custodyMode
  // Pre-workflow canonical multi-shift templates were already an explicit,
  // persisted scheduling choice.  Keep them governing rather than letting the
  // newly added marker downgrade an existing installation to custody.config.
  if (scheduling.custodyMode === 'MULTI_SHIFT' && hasCanonicalAssignments(scheduling)) return 'MULTI_SHIFT'
  return custody.mode
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
  return match ? { legacyPlanId: match.plan.id, templateId: null, title: match.plan.title, scheduledEndAt: match.end, reminderRepeatMin: Number(match.plan.reminderRepeatMin), allowMidDayHandover: false } : null
}

/** New schedules are read exclusively from Shift Settings. This code never
 * writes/changes ShiftPlan; the legacy fallback remains only for already
 * enabled legacy installations until their manager reviews the inventory. */
/** A schedule becomes operational once Settings contains an active named shift
 * with a selected person. Until then the deliberately simple fresh-install
 * single-shift path remains unscheduled and backwards compatible. */
function hasCanonicalAssignments(cfg: ShiftConfig): boolean {
  return cfg.templates.some((template) => template.isActive && template.staffIds.length > 0)
}

function canonicalPlanForOpen(cfg: ShiftConfig, userId: number, now = new Date()) {
  const candidates: Array<{ template: ShiftTemplate; start: Date; end: Date }> = []
  const minutesOf = (value: string) => {
    const [hour, minute] = String(value ?? '00:00').split(':').map(Number)
    return (Number(hour) || 0) * 60 + (Number(minute) || 0)
  }
  for (const template of cfg.templates) {
    if (!template.isActive || !template.staffIds.includes(userId)) continue
    const startMinute = minutesOf(template.startTime)
    const endMinute = minutesOf(template.endTime)
    const durationMinutes = ((endMinute - startMinute + 1440) % 1440) || 1440
    for (const dayOffset of [0, -1]) {
      const start = new Date(now)
      start.setDate(start.getDate() + dayOffset)
      start.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0)
      if ((template.daysMask & (1 << start.getDay())) === 0) continue
      const end = new Date(start.getTime() + durationMinutes * 60_000)
      if (now >= start && now < end) candidates.push({ template, start, end })
    }
  }
  candidates.sort((a, b) => b.start.getTime() - a.start.getTime() || a.template.id.localeCompare(b.template.id))
  const match = candidates[0] ?? null
  return match
    ? {
        legacyPlanId: null,
        templateId: match.template.id,
        title: match.template.name,
        scheduledEndAt: match.end,
        reminderRepeatMin: match.template.reminderRepeatMin,
        allowMidDayHandover: match.template.allowMidDayHandover
      }
    : null
}

async function writeEvent(client: Client, input: {
  type: string
  shiftId?: number | null
  handoverId?: number | null
  resolutionId?: number | null
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
      resolutionId: input.resolutionId ?? null,
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

type CustodyAuditExportCell = string | number | null

/** Report values can contain bigint. Export them as decimal text, not Number,
 * so a custody audit file cannot silently lose rial precision. */
function custodyAuditExportAmount(value: number | bigint | null | undefined): string | null {
  return value == null ? null : typeof value === 'bigint' ? value.toString() : String(value)
}

function custodyAuditExportTime(value: unknown): string | null {
  if (value == null || value === '') return null
  const date = new Date(value as any)
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value)
}

function custodyAuditExportRows(report: any): CustodyAuditExportCell[][] {
  const rows: CustodyAuditExportCell[][] = []
  for (const row of report.segments ?? []) rows.push([
    'بخش حضانت', custodyAuditExportTime(row.startedAt), `نشست ${row.shiftId}`, row.custodianName ?? '—', null, null, null,
    row.endKind ?? 'باز', `برنامهٔ snapshot: ${row.scheduleTitleSnapshot ?? 'بدون برنامه'}${row.endedAt ? ` · پایان: ${custodyAuditExportTime(row.endedAt)}` : ''}`
  ])
  for (const row of report.handovers ?? []) rows.push([
    'تحویل', custodyAuditExportTime(row.startedAt), `نشست ${row.fromShiftId}${row.toShiftId ? ` → ${row.toShiftId}` : ''}`,
    `${row.fromUser ?? '—'} → ${row.finalCustodian ?? row.selectedRecipient ?? '—'}`, custodyAuditExportAmount(row.countedAtStart), custodyAuditExportAmount(row.expectedAtStart), custodyAuditExportAmount(row.differenceCash),
    row.status ?? null, row.resolutionKind ?? null
  ])
  for (const row of report.saleOperators ?? []) rows.push([
    'عملیات POS', custodyAuditExportTime(row.at), `نشست ${row.custodyShiftId}`, `${row.operatorName ?? (row.operatorKind === 'MANAGER_SESSION' ? 'نشست مدیر، بدون انتساب شخصی' : '—')} · مسئول کشو: ${row.custodianName ?? '—'}`, null, null, null,
    row.operatorKind ?? null, `${row.receiptNo == null ? `فاکتور ${row.invoiceId}` : `فیش ${row.receiptNo}`} · ${row.authMethod ?? 'روش ثبت‌شده'}`
  ])
  for (const row of report.counts ?? []) rows.push([
    row.kind ?? 'شمارش', custodyAuditExportTime(row.at), `نشست ${row.shiftId}`, row.countedByName ?? '—', custodyAuditExportAmount(row.countedCash), custodyAuditExportAmount(row.expectedCash), custodyAuditExportAmount(row.differenceCash),
    row.authMethod ?? null, row.note ?? null
  ])
  for (const row of report.resolutions ?? []) rows.push([
    row.evidence ?? 'پروندهٔ بازیابی', custodyAuditExportTime(row.openedAt), `نشست ${row.shiftId}`, row.decisionByName ?? row.attributedToName ?? '—', null, custodyAuditExportAmount(row.nightExpectedCash), custodyAuditExportAmount(row.provisionalDifference),
    row.status ?? null, `انتساب: ${row.differenceAttribution ?? '—'}${row.decisionReason ? ` · دلیل: ${row.decisionReason}` : ''}`
  ])
  for (const row of report.dispositions ?? []) rows.push([
    'تعیین‌تکلیف وجه', custodyAuditExportTime(row.at), `نشست ${row.shiftId}`, row.confirmedByName ?? row.recipientName ?? '—', custodyAuditExportAmount(row.amount), null, null,
    row.confirmStatus ?? null, `${row.kind ?? '—'}${row.destinationLabel ? ` · مقصد: ${row.destinationLabel}` : ''}${row.trackingNo ? ` · پیگیری: ${row.trackingNo}` : ''}`
  ])
  return rows
}

const CUSTODY_AUDIT_EXPORT_HEADERS = ['نوع سند', 'زمان ثبت', 'segment / شیفت', 'عامل / مسئول', 'مبلغ / فیزیکی', 'مورد انتظار', 'اختلاف', 'وضعیت / احراز', 'جزئیات / مرجع']

export const custodyService = {
  async config() {
    return configOf(prisma)
  },

  async enabled() {
    return (await configOf(prisma)).enabled
  },

  /**
   * One fail-closed answer for every legacy ShiftSession surface.  Looking only
   * at the feature flag was unsafe: an interrupted/older custody segment could
   * still be live while a stale settings row said "disabled", and the old
   * name-only session form then became a second way to assign drawer custody.
   *
   * `CustodyState` and open resolutions are durable evidence, not a renderer
   * preference.  This helper intentionally does not create state rows, so a
   * plain legacy installation remains legacy until custody is really enabled.
   */
  async isGoverned(): Promise<boolean> {
    const cfg = await configOf(prisma)
    if (cfg.enabled) return true
    const [state, unresolved] = await Promise.all([
      prisma.custodyState.findUnique({ where: { key: MAIN } }),
      prisma.custodyResolution.findFirst({ where: { status: 'OPEN' }, select: { id: true } })
    ])
    return state?.state !== 'NO_SESSION' || !!unresolved
  },

  async guardLegacyPath() {
    if (await this.isGoverned())
      throw new BusinessError('در حالت حضانت صندوق، ثبت یا تعویض نشست قدیمی مجاز نیست؛ فقط از مسیر رسمی حضانت با رمز شخصی استفاده کنید.', 'CUSTODY_LEGACY_PATH')
  },

  async status() {
    const cfg = await configOf(prisma)
    if (cfg.enabled) await this.ensureRolledOver()
    const state = await ensureState(prisma)
    const shift = state.activeShiftId ? await prisma.shift.findUnique({ where: { id: state.activeShiftId }, include: { user: true } }) : null
    const meta = state.activeShiftId ? await prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } }) : null
    const [unresolved, scheduling] = await Promise.all([
      prisma.custodyResolution.findMany({ where: { status: 'OPEN' }, orderBy: { openedAt: 'asc' } }),
      shiftSchedulingOf(prisma)
    ])
    const scheduledPlan = meta?.planId ? await prisma.shiftPlan.findUnique({ where: { id: meta.planId }, select: { reminderRepeatMin: true } }) : null
    const storedSchedule = scheduleSnapshotOf(meta)
    // Legacy rows without the additive snapshot retain their historic fallback.
    const template = !storedSchedule && meta?.templateId ? scheduling.templates.find((row: ShiftTemplate) => row.id === meta.templateId) ?? null : null
    const scheduledEndAt = storedSchedule?.scheduledEndAt ? new Date(storedSchedule.scheduledEndAt) : meta?.scheduledEndAt ? new Date(meta.scheduledEndAt) : null
    const overrunGraceMinutes = storedSchedule?.overrunGraceMinutes ?? (template ? scheduling.overrunGraceMinutes : cfg.overrunGraceMinutes)
    const reminderStart = scheduledEndAt ? new Date(scheduledEndAt.getTime() + overrunGraceMinutes * 60_000) : null
    const repeatMinutes = Math.max(5, Number(storedSchedule?.reminderRepeatMin ?? template?.reminderRepeatMin ?? scheduledPlan?.reminderRepeatMin ?? 15))
    const scheduleMode = effectiveCustodyMode(cfg, scheduling)
    const remindersEnabled = storedSchedule?.reminderEnabled ?? (template ? scheduling.reminderEnabled : cfg.reminderEnabled)
    const snapshotIsMultiShift = storedSchedule?.mode === 'MULTI_SHIFT'
    const now = Date.now()
    const reminderDue = !!((storedSchedule ? snapshotIsMultiShift : scheduleMode === 'MULTI_SHIFT') && remindersEnabled && reminderStart && now >= reminderStart.getTime())
    const reminderBucket = reminderDue ? Math.floor((now - reminderStart!.getTime()) / (repeatMinutes * 60_000)) : null
    const pendingRow = state.pendingHandoverId
      ? await prisma.custodyHandover.findUnique({ where: { id: state.pendingHandoverId }, select: { id: true, fromUserId: true, selectedRecipientUserId: true, startedAt: true, status: true, resolutionKind: true, countedAtStart: true, resolutionReason: true, ledgerWatermark: true } })
      : null
    let blindCountedCash: number | null = null
    if (pendingRow?.ledgerWatermark) {
      try {
        const watermark = JSON.parse(String(pendingRow.ledgerWatermark || '{}'))
        const value = Number(watermark?.differencePending?.countedCash)
        if (Number.isSafeInteger(value) && value >= 0) blindCountedCash = value
      } catch {
        // A malformed legacy watermark must not expose an amount or break the
        // fail-closed custody status surface.
      }
    }
    return {
      enabled: cfg.enabled,
      /** Consumers that decide whether to show an old name-only ShiftSession
       * must use this durable, fail-closed value—not just the feature flag. */
      governed: cfg.enabled || state.state !== 'NO_SESSION' || unresolved.length > 0,
      config: cfg,
      /** UI hint only; Main still verifies the selected personal PIN and this
       * policy again in open().  It prevents a single-shift dialog from
       * presenting unrelated staff as selectable daily custodians. */
      schedulingPolicy: {
        mode: scheduleMode,
        configured: scheduling.custodyModeConfigured,
        singleShiftCustodianUserId: scheduling.custodyModeConfigured && scheduleMode === 'SINGLE_SHIFT'
          ? scheduling.singleShiftCustodianUserId
          : null
      },
      state: state.state,
      epoch: state.epoch,
      activeShiftId: state.activeShiftId,
      custodian: shift?.userId ? { id: shift.userId, name: shift.user?.displayName ?? null, openAuth: meta?.openAuth ?? null } : null,
      shift: shift ? { id: shift.id, openedAt: shift.openedAt, closedAt: shift.closedAt, name: shift.name } : null,
      schedule: meta?.planId || meta?.templateId ? { planId: storedSchedule?.planId ?? meta?.planId ?? null, templateId: storedSchedule?.templateId ?? meta?.templateId ?? null, title: storedSchedule?.title ?? meta?.planTitle, scheduledEndAt: scheduledEndAt, allowMidDayHandover: storedSchedule?.allowMidDayHandover ?? template?.allowMidDayHandover ?? false } : null,
      reminder: { due: reminderDue, bucket: reminderBucket, repeatMinutes, scheduledEndAt: scheduledEndAt?.toISOString() ?? null },
      pendingHandover: pendingRow
        ? { id: pendingRow.id, fromUserId: pendingRow.fromUserId, selectedRecipientUserId: pendingRow.selectedRecipientUserId, startedAt: pendingRow.startedAt, status: pendingRow.status, resolutionKind: pendingRow.resolutionKind, countedAtStart: pendingRow.countedAtStart, resolutionReason: pendingRow.resolutionReason, blindCountedCash }
        : null,
      unresolved: unresolved.map((row: any) => ({ id: row.id, shiftId: row.shiftId, openedAt: row.openedAt, nightExpectedCash: row.nightExpectedCash, evidence: row.evidence })),
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
      /** This is an operational authentication roster, never a personnel
       * directory: archived people remain in history/Staff Settings but must
       * not leak back into an opening, handover, recovery or PIN workflow. */
      prisma.user.findMany({ where: { isActive: true }, orderBy: [{ id: 'asc' }] }),
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
  async report(input: { managerUserId?: unknown; managerPassword?: unknown; from?: unknown; to?: unknown; take?: unknown; skip?: unknown; managerSession?: boolean } = {} as any) {
    if (input.managerSession === true) assertManagerSession('دیدن گزارش کنترل حضانت')
    else await this.verifyPin(input.managerUserId, input.managerPassword, { requireManager: true })
    const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60_000)
    const parsedFrom = input.from == null ? defaultFrom : new Date(String(input.from))
    const parsedTo = input.to == null ? new Date() : new Date(String(input.to))
    /** A manager audit view must not silently substitute a different period for
     * an invalid requested boundary. Missing bounds intentionally use defaults;
     * malformed supplied bounds fail closed. */
    if (!Number.isFinite(parsedFrom.getTime()) || !Number.isFinite(parsedTo.getTime()))
      throw new BusinessError('بازهٔ گزارش حضانت معتبر نیست.', 'CUSTODY_REPORT_RANGE_INVALID')
    const from = parsedFrom
    const to = parsedTo
    if (to.getTime() < from.getTime()) throw new BusinessError('پایان بازهٔ گزارش حضانت نمی‌تواند پیش از آغاز آن باشد.', 'CUSTODY_REPORT_RANGE_INVALID')
    const take = Math.min(500, Math.max(1, Math.round(Number(input.take ?? 150)) || 150))
    /** Pagination stays bounded even for a manager-only report. The same offset
     * is deliberately applied to each independently ordered evidence stream;
     * `hasMore` remains per-stream, so UI never claims a unified cursor. */
    const skip = Math.min(50_000, Math.max(0, Math.trunc(Number(input.skip ?? 0)) || 0))
    /** Read one extra immutable row per collection so report consumers never
     * mistake a bounded window for a complete history. The extra row is not
     * returned, does not affect summary totals, and causes no write. */
    const queryTake = take + 1
    const [eventRows, countRows, handoverRows, resolutionRows, dispositionRows, shiftRows, operatorRows] = await Promise.all([
      prisma.custodyEvent.findMany({ where: { at: { gte: from, lte: to } }, orderBy: { at: 'desc' }, skip, take: queryTake }),
      prisma.custodyCount.findMany({ where: { at: { gte: from, lte: to } }, orderBy: { at: 'desc' }, skip, take: queryTake }),
      prisma.custodyHandover.findMany({ where: { startedAt: { gte: from, lte: to } }, orderBy: { startedAt: 'desc' }, skip, take: queryTake }),
      prisma.custodyResolution.findMany({ where: { openedAt: { gte: from, lte: to } }, orderBy: { openedAt: 'desc' }, skip, take: queryTake }),
      prisma.custodyDisposition.findMany({ where: { at: { gte: from, lte: to } }, orderBy: { at: 'desc' }, skip, take: queryTake }),
      // CustodyShiftMeta is append-only evidence.  Join it manually rather than
      // adding a Prisma relation so the schema stays additive for old databases.
      prisma.shift.findMany({ where: { openedAt: { gte: from, lte: to } }, orderBy: { openedAt: 'desc' }, skip, take: queryTake }),
      /** POS evidence is separately append-only. It is intentionally queried
       * from its own timestamp rather than inferred from mutable invoice/user
       * fields, which remain financial drawer attribution. */
      prisma.custodySaleEvidence.findMany({ where: { at: { gte: from, lte: to } }, orderBy: { at: 'desc' }, skip, take: queryTake })
    ])
    const truncated = {
      events: eventRows.length > take,
      counts: countRows.length > take,
      handovers: handoverRows.length > take,
      resolutions: resolutionRows.length > take,
      dispositions: dispositionRows.length > take,
      segments: shiftRows.length > take,
      saleOperators: operatorRows.length > take
    }
    const events = eventRows.slice(0, take)
    const counts = countRows.slice(0, take)
    const handovers = handoverRows.slice(0, take)
    const resolutions = resolutionRows.slice(0, take)
    const dispositions = dispositionRows.slice(0, take)
    const shifts = shiftRows.slice(0, take)
    const saleOperators = operatorRows.slice(0, take)
    const evidenceInvoiceIds = saleOperators.map((row: any) => row.invoiceId)
    const evidenceInvoices = evidenceInvoiceIds.length
      ? await prisma.saleInvoice.findMany({ where: { id: { in: evidenceInvoiceIds } }, select: { id: true, receiptNo: true, issuedAt: true } })
      : []
    const invoiceById = new Map(evidenceInvoices.map((row: any) => [row.id, row]))
    const shiftIds = shifts.map((row: any) => row.id)
    const metas = shiftIds.length ? await prisma.custodyShiftMeta.findMany({ where: { shiftId: { in: shiftIds } } }) : []
    const metaByShift = new Map(metas.map((row: any) => [row.shiftId, row]))
    const ids = new Set<number>()
    for (const e of events) if (e.actorUserId) ids.add(e.actorUserId)
    for (const c of counts) ids.add(c.countedByUserId)
    for (const h of handovers) { ids.add(h.fromUserId); ids.add(h.selectedRecipientUserId); if (h.finalCustodianUserId) ids.add(h.finalCustodianUserId) }
    for (const r of resolutions) { if (r.decisionByUserId) ids.add(r.decisionByUserId); if (r.attributedToUserId) ids.add(r.attributedToUserId) }
    for (const d of dispositions) { if (d.recipientUserId) ids.add(d.recipientUserId); if (d.confirmedByUserId) ids.add(d.confirmedByUserId) }
    for (const meta of metas) ids.add(meta.custodianUserId)
    for (const row of saleOperators) {
      ids.add(row.custodianUserId)
      /** A shared manager session is deliberately anonymous: even if malformed
       * legacy data carried an id, do not use it to reconstruct an individual. */
      if (row.operatorKind !== 'MANAGER_SESSION' && row.operatorUserId) ids.add(row.operatorUserId)
    }
    const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, displayName: true } }) : []
    const userName = new Map(users.map((row: any) => [row.id, row.displayName]))
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      coverage: {
        skip,
        take,
        /** `truncated` is retained for callers from Phase 6; `hasMore` makes
         * the paging meaning explicit without pretending all streams share an
         * atomic combined cursor. */
        truncated,
        truncatedAny: Object.values(truncated).some(Boolean),
        hasMore: { ...truncated },
        hasMoreAny: Object.values(truncated).some(Boolean)
      },
      summary: {
        handovers: handovers.length,
        unresolvedOpen: resolutions.filter((row: any) => row.status === 'OPEN').length,
        dispositionPending: dispositions.filter((row: any) => row.confirmStatus !== 'CONFIRMED' && row.confirmStatus !== 'REVERSED').length,
        totalCountDifference: counts.reduce((sum: bigint, row: any) => sum + BigInt(row.differenceCash ?? 0), BigInt(0)),
        operatorSales: saleOperators.length,
        operatorPinSales: saleOperators.filter((row: any) => row.operatorKind === 'OPERATOR_PIN').length,
        managerSessionSales: saleOperators.filter((row: any) => row.operatorKind === 'MANAGER_SESSION').length
      },
      events: events.map((row: any) => ({ id: row.id, type: row.type, at: row.at, shiftId: row.shiftId, handoverId: row.handoverId, resolutionId: row.resolutionId, actorUserId: row.actorUserId, actorName: row.actorUserId ? userName.get(row.actorUserId) ?? null : null, actorKind: row.actorKind, payload: row.payloadJson ? JSON.parse(row.payloadJson) : null })),
      /** A segment retains the schedule title/identity captured when its drawer
       * opened. Never look up the current template title here: a later rename,
       * deactivation or deletion must not rewrite cash-close history. */
      segments: shifts
        .map((shift: any) => {
          const meta = metaByShift.get(shift.id)
          if (!meta) return null
          return {
            shiftId: shift.id,
            startedAt: shift.openedAt,
            endedAt: meta.endedAt ?? shift.closedAt ?? null,
            custodianUserId: meta.custodianUserId,
            custodianName: userName.get(meta.custodianUserId) ?? null,
            templateId: meta.templateId ?? null,
            scheduleTitleSnapshot: meta.planTitle ?? null,
            scheduledEndAt: meta.scheduledEndAt ?? null,
            scheduleKind: meta.templateId ? 'CANONICAL' : meta.planId ? 'LEGACY' : 'UNSCHEDULED',
            endKind: meta.endKind ?? null,
            countStatus: meta.countStatus,
            operationalDay: meta.operationalDay
          }
        })
        .filter(Boolean),
      /** Explicit POS operation proof. `operatorUserId` is withheld for the
       * shared manager-session mode, by policy—not merely because today's row
       * happens to be null. Financial invoice ownership remains separate. */
      saleOperators: saleOperators.map((row: any) => {
        const invoice = invoiceById.get(row.invoiceId)
        const anonymousManagerSession = row.operatorKind === 'MANAGER_SESSION'
        const operatorUserId = anonymousManagerSession ? null : row.operatorUserId ?? null
        return {
          id: row.id,
          at: row.at,
          invoiceId: row.invoiceId,
          receiptNo: invoice?.receiptNo ?? null,
          saleIssuedAt: invoice?.issuedAt ?? null,
          custodyShiftId: row.custodyShiftId,
          custodianUserId: row.custodianUserId,
          custodianName: userName.get(row.custodianUserId) ?? null,
          operatorKind: row.operatorKind,
          operatorUserId,
          operatorName: operatorUserId ? userName.get(operatorUserId) ?? null : null,
          authMethod: row.authMethod
        }
      }),
      /** Count rows are immutable physical/ledger evidence. Expose their
       * method and free-text note only to the existing manager-only report;
       * neither can contain or reconstruct a credential. */
      counts: counts.map((row: any) => ({ id: row.id, at: row.at, shiftId: row.shiftId, kind: row.kind, countedCash: row.countedCash, expectedCash: row.expectedCash, differenceCash: row.differenceCash, countedByUserId: row.countedByUserId, countedByName: userName.get(row.countedByUserId) ?? null, authMethod: row.authMethod, note: row.note ?? null, operationalDay: row.operationalDay })),
      handovers: handovers.map((row: any) => ({ id: row.id, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, fromShiftId: row.fromShiftId, toShiftId: row.toShiftId, fromUser: userName.get(row.fromUserId) ?? null, selectedRecipient: userName.get(row.selectedRecipientUserId) ?? null, finalCustodian: row.finalCustodianUserId ? userName.get(row.finalCustodianUserId) ?? null : null, expectedAtStart: row.expectedAtStart, countedAtStart: row.countedAtStart, differenceCash: row.differenceCash, resolutionKind: row.resolutionKind })),
      resolutions: resolutions.map((row: any) => ({ id: row.id, shiftId: row.shiftId, status: row.status, evidence: row.evidence, openedAt: row.openedAt, resolvedAt: row.resolvedAt, nightExpectedCash: row.nightExpectedCash, provisionalDifference: row.provisionalDifference, differenceAttribution: row.differenceAttribution, attributedToName: row.attributedToUserId ? userName.get(row.attributedToUserId) ?? null : null, decisionByName: row.decisionByUserId ? userName.get(row.decisionByUserId) ?? null : null, decisionReason: row.decisionReason })),
      dispositions: dispositions.map((row: any) => ({ id: row.id, at: row.at, shiftId: row.shiftId, cashSessionId: row.cashSessionId, kind: row.kind, amount: row.amount, confirmStatus: row.confirmStatus, recipientName: row.recipientUserId ? userName.get(row.recipientUserId) ?? null : null, confirmedByName: row.confirmedByUserId ? userName.get(row.confirmedByUserId) ?? null : null, trackingNo: row.trackingNo, destinationLabel: row.destinationLabel }))
    }
  },

  /**
   * An audit export is generated in Main from a freshly authorized report
   * query. Renderer selects only its bounded scope; it never supplies evidence
   * rows, amounts, names, notes or a title that could misrepresent the audit.
   */
  async exportReport(input: { from?: unknown; to?: unknown; take?: unknown; skip?: unknown; managerSession?: boolean }) {
    const report = await this.report({ ...input, managerSession: true })
    const { exportTableFile } = await import('./ExportService')
    const coverage = (report as any).coverage
    const title = [
      `گزارش ممیزی حضانت · از ${(report as any).from} تا ${(report as any).to}`,
      `offset ${coverage?.skip ?? 0} · حداکثر ${coverage?.take ?? 0} ردیف در هر stream`,
      coverage?.hasMoreAny ? 'هشدار: evidence قدیمی‌تر در همین بازه وجود دارد؛ این خروجی فقط صفحهٔ فعلی است.' : 'این خروجی صفحهٔ کاملِ بازهٔ فعلی است.'
    ].join(' · ')
    const result = await exportTableFile({
      fileName: 'گزارش-ممیزی-حضانت',
      sheetName: 'ممیزی حضانت',
      title,
      headers: CUSTODY_AUDIT_EXPORT_HEADERS,
      rows: custodyAuditExportRows(report)
    })
    /** The shared manager session intentionally has no individual User.id. An
     * export action is nevertheless security-relevant, so append an outcome
     * record without path, evidence contents, credentials or invented actor. */
    await audit(prisma, {
      action: 'CUSTODY_REPORT_EXPORT',
      entity: 'CustodyAuditReport',
      userId: null,
      after: JSON.stringify({
        outcome: result.canceled ? 'CANCELED' : 'SAVED',
        format: result.format,
        rows: result.rows,
        from: (report as any).from,
        to: (report as any).to,
        skip: coverage?.skip ?? 0,
        take: coverage?.take ?? 0,
        hasMoreAny: coverage?.hasMoreAny === true
      }),
      note: 'خروجی گزارش حضانت با نشست مشترک مدیر؛ بدون انتساب هویت فردی مدیر'
    })
    return result
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
    // Once the manager-review workflow has reconciled the two mode records,
    // mode is no longer a general custody toggle.  Pre-workflow installations
    // retain their legacy route so an update never silently changes their
    // active scheduling model before review.
    const scheduling = await shiftSchedulingOf(prisma)
    if (scheduling.custodyModeConfigured && current.mode !== next.mode)
      throw new BusinessError('تغییر تک‌شیفت/چندشیفت فقط از گردش‌کار برنامه‌ریزی حضانت در تنظیمات مجاز است.', 'CUSTODY_MODE_WORKFLOW_REQUIRED')
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
    // A no-session state can still carry an unresolved previous drawer. Turning
    // the feature off here would hide its only PIN/count recovery path while
    // `isGoverned()` correctly blocks the old name-only path.
    if (current.enabled && !next.enabled) {
      const unresolved = await prisma.custodyResolution.findFirst({ where: { status: 'OPEN' }, select: { id: true } })
      if (unresolved) throw new BusinessError('تا وقتی پروندهٔ بازیابی صندوق قبلی باز است، خاموش‌کردن حضانت مجاز نیست.', 'CUSTODY_RECOVERY_OPEN')
    }
    await prisma.setting.upsert({ where: { key: SETTING_KEYS.custodyConfig }, update: { value: JSON.stringify(next) }, create: { key: SETTING_KEYS.custodyConfig, value: JSON.stringify(next) } })
    return next
  },

  async open(input: { userId: unknown; password: unknown; countedCash?: unknown; note?: unknown }) {
    const actor = await this.verifyPin(input.userId, input.password)
    if (actor.role !== 'MANAGER' && actor.role !== 'CASHIER') throw new BusinessError('این نقش مجاز به تحویل‌گیری صندوق نیست.', 'NO_PERMISSION')
    const countedCash = input.countedCash == null ? null : asCash(input.countedCash, 'شمارش نقدی')
    return prisma.$transaction(async (tx: Client) => {
      const [cfg, scheduling] = await Promise.all([configOf(tx), shiftSchedulingOf(tx)])
      if (!cfg.enabled) throw new BusinessError('ماژول حضانت صندوق هنوز فعال نشده است.')
      /** Once the explicit workflow is complete, a single daily custodian and
       * independent multi-shift assignments are two distinct rules—not a
       * cosmetic checkbox over the same template list.  Before that review,
       * preserve an old installation's custody.config mode and its legacy plan
       * fallback without silently converting records. */
      const custodyMode = effectiveCustodyMode(cfg, scheduling)
      // Canonical template assignments already saved by pre-Phase-7 versions
      // remain operational exactly as recorded.  Only a manager-reviewed
      // workflow switches single shift to its distinct daily-custodian rule.
      const canonicalConfigured = scheduling.custodyModeConfigured
        ? custodyMode === 'MULTI_SHIFT'
        : hasCanonicalAssignments(scheduling)
      if (scheduling.custodyModeConfigured && custodyMode === 'SINGLE_SHIFT' && scheduling.singleShiftCustodianUserId !== actor.userId)
        throw new BusinessError('در حالت تک‌شیفت فقط مسئول اصلی روزانهٔ ثبت‌شده می‌تواند با رمز شخصی صندوق را تحویل بگیرد.', 'NOT_DAILY_CUSTODIAN')
      const plan = canonicalConfigured
        ? canonicalPlanForOpen(scheduling, actor.userId)
        : custodyMode === 'MULTI_SHIFT'
          ? await planForOpen(tx, actor.userId)
          : null
      if (canonicalConfigured && !plan)
        throw new BusinessError('برای باز کردن صندوق، کارمند باید در شیفت فعالِ همین زمان در تنظیمات شیفت ثبت شده باشد.', 'NO_SCHEDULED_SHIFT')
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
      await tx.custodyShiftMeta.create({ data: { shiftId: shift.id, custodianUserId: actor.userId, openAuth: 'CUSTODY_PIN', openCountId: count?.id ?? null, templateId: plan?.templateId ?? null, planId: plan?.legacyPlanId ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, scheduleSnapshotJson: scheduleSnapshotJson(plan, scheduling, cfg), rolloverAt: rolloverAt(new Date(), cfg, scheduling, plan), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: countedCash == null ? 'COUNT_PENDING' : 'COUNTED', openEpoch: nextEpoch } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'NO_SESSION', epoch: beforeEpoch }, data: { state: 'ACTIVE', activeShiftId: shift.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'OPEN', shiftId: shift.id, actorUserId: actor.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: beforeEpoch, epochAfter: nextEpoch, payload: { counted: countedCash != null } })
      return { shiftId: shift.id, epoch: nextEpoch, countStatus: countedCash == null ? 'COUNT_PENDING' : 'COUNTED' }
    })
  },

  /** Lazy rollover is invoked by custody status/financial entry, never by a
   * timer that could silently move money. It closes only the operational Shift;
   * a separate PIN-authenticated morning witness or manager later records the
   * physical count and financial snapshot. */
  async ensureRolledOver(now = new Date()) {
    const state = await ensureState(prisma)
    if ((state.state !== 'ACTIVE' && state.state !== 'HANDOVER_PENDING') || !state.activeShiftId) return null
    const [meta, scheduling] = await Promise.all([
      prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } }),
      shiftSchedulingOf(prisma)
    ])
    if (!meta || expiryAt(meta, scheduling) > now) return null
    const result = await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      const [liveMeta, liveScheduling] = await Promise.all([
        live.activeShiftId ? tx.custodyShiftMeta.findUnique({ where: { shiftId: live.activeShiftId } }) : null,
        shiftSchedulingOf(tx)
      ])
      if (!liveMeta || (live.state !== 'ACTIVE' && live.state !== 'HANDOVER_PENDING') || live.activeShiftId !== state.activeShiftId || live.epoch !== state.epoch || expiryAt(liveMeta, liveScheduling) > now) return null
      const shift = await tx.shift.findUnique({ where: { id: live.activeShiftId } })
      if (!shift || shift.closedAt) return null
      // The lazy detector may run the following morning. Financial attribution
      // must still stop at the planned scheduled end + configured overtime (or
      // the persisted legacy cutover fallback), rather than at detection time.
      const effectiveEndAt = expiryAt(liveMeta, liveScheduling)
      const nextEpoch = Number(live.epoch) + 1
      let handoverId: number | null = null
      if (live.state === 'HANDOVER_PENDING' && live.pendingHandoverId) {
        handoverId = live.pendingHandoverId
        await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'EXPIRED_UNRESOLVED', resolutionKind: 'EXPIRED_AT_ROLLOVER', finalCustodianUserId: null, finishedAt: now, version: { increment: 1 } } })
      }
      await shiftService.closeInTx(tx, { shiftId: shift.id, userId: shift.userId ?? null, note: 'پایان برنامه/روز عملیاتی؛ نیازمند شمارش شاهد صبح' })
      await tx.shift.update({ where: { id: shift.id }, data: { closedAt: effectiveEndAt } })
      await tx.custodyShiftMeta.update({ where: { shiftId: shift.id }, data: { endKind: handoverId ? 'EXPIRED_UNRESOLVED' : 'UNRESOLVED', endedAt: effectiveEndAt } })
      const resolution = await tx.custodyResolution.create({ data: { shiftId: shift.id, status: 'OPEN', evidence: 'NONE', differenceAttribution: 'PENDING_DECISION' } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: live.state, activeShiftId: shift.id, epoch: live.epoch }, data: { state: 'NO_SESSION', activeShiftId: null, pendingHandoverId: null, epoch: nextEpoch, updatedAt: now } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ rollover ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'ROLLOVER_UNRESOLVED', shiftId: shift.id, handoverId, resolutionId: resolution.id, actorKind: 'SYSTEM', epochBefore: live.epoch, epochAfter: nextEpoch, payload: { resolutionId: resolution.id, effectiveAt: effectiveEndAt.toISOString(), expiryKind: liveMeta.templateId ? 'SCHEDULED_END_PLUS_OVERTIME' : 'CUTOVER_FALLBACK' } })
      return { resolutionId: resolution.id, shiftId: shift.id }
    })
    if (result) {
      /** The shift is closed, so this read cannot affect morning attribution.
       * Snapshot completion is retriable; it never changes any money formula. */
      try {
        const expected = await cashboxService.expected({ shiftId: result.shiftId })
        await prisma.custodyResolution.updateMany({ where: { id: result.resolutionId, status: 'OPEN' }, data: { nightExpectedCash: BigInt(Number(expected.expectedCash)) } })
      } catch {
        // Morning-witness/manager recovery still has the canonical Cashbox
        // calculation; do not turn a reporting read failure into a new sales block.
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
      // `shift` is already closed by rollover and belongs to an absent prior
      // custodian. This is server-only; IPC cannot supply this bypass marker.
      internalCustodyRecovery: true,
      afterCloseInTx: async (tx: Client, session: any) => {
        const changed = await tx.custodyResolution.updateMany({ where: { id: resolutionId, status: 'OPEN', shiftId: shift.id }, data: { status: 'RESOLVED', cashSessionId: session.id, decisionByUserId: manager.userId, decisionReason: reason, differenceAttribution: attribution, attributedToUserId, resolvedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('پرونده شب هم‌زمان تغییر کرد؛ عملیات ثبت نشد.', 'CUSTODY_STALE')
        await tx.custodyShiftMeta.updateMany({ where: { shiftId: shift.id, endKind: { in: ['UNRESOLVED', 'EXPIRED_UNRESOLVED', 'CUSTODIAN_ARCHIVED_UNRESOLVED'] } }, data: { endKind: 'FINAL_CLOSE', cashSessionId: session.id } })
        await writeEvent(tx, { type: 'UNRESOLVED_RESOLVED', shiftId: shift.id, resolutionId, actorUserId: manager.userId, actorKind: 'MANAGER', authMethod: 'MANAGER_CUSTODY_PIN', payload: { cashSessionId: session.id, attribution } })
      }
    } as any)
  },

  /**
   * Archive/deactivate is not allowed to strand an active drawer behind an
   * inactive person's PIN. The manager-session Staff service supplies the
   * in-transaction archive callback; this service owns the financial freeze,
   * expected-ledger snapshot and unresolved physical-count recovery record.
   *
   * No client-provided actor establishes custody here: the outgoing custodian
   * is read from `CustodyShiftMeta`, while the archive actor is deliberately
   * recorded only as the already-authorized global manager session.
   */
  async archiveActiveCustodian<T>(input: { userId: unknown; reason: unknown; archiveInTx: (tx: Client) => Promise<T> }) {
    const userId = asSafeId(input.userId, 'شناسه کارمند')
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 10)
      throw new BusinessError('برای آرشیو مسئول فعال صندوق، دلیل روشنِ حداقل ۱۰ حرف وارد کنید.', 'CUSTODIAN_ARCHIVE_REASON_REQUIRED')

    const frozen = await prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      if (!state.activeShiftId) throw new BusinessError('این کارمند مسئول فعال صندوق نیست.', 'ACTIVE_CUSTODIAN_REQUIRED')
      const [shift, meta] = await Promise.all([
        tx.shift.findUnique({ where: { id: state.activeShiftId } }),
        tx.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
      ])
      if (!shift || shift.closedAt || !shift.userId || !meta || meta.custodianUserId !== userId || shift.userId !== userId)
        throw new BusinessError('این کارمند مسئول فعال صندوق نیست.', 'ACTIVE_CUSTODIAN_REQUIRED')
      const existing = await tx.custodyResolution.findUnique({ where: { shiftId: shift.id } })
      if (state.state === 'CUSTODIAN_ARCHIVE_FREEZE') {
        if (!existing || existing.status !== 'ARCHIVE_FREEZE' || existing.evidence !== 'CUSTODIAN_ARCHIVED' || String(existing.decisionReason ?? '') !== reason)
          throw new BusinessError('آرشیو حضانت در حال ثبت است؛ فقط با همان دلیل ثبت‌شده قابل ادامه است.', 'CUSTODIAN_ARCHIVE_IN_PROGRESS')
        return { shiftId: shift.id, epoch: Number(state.epoch), resolutionId: existing.id, resumed: true }
      }
      if (state.state !== 'ACTIVE')
        throw new BusinessError('برای آرشیو این کارمند، ابتدا تحویل یا عملیات در حال انجام صندوق را تعیین تکلیف کنید.', 'CUSTODIAN_ARCHIVE_BLOCKED')
      if (existing && !['ARCHIVE_ABORTED'].includes(existing.status))
        throw new BusinessError('برای این بخش صندوق از قبل پروندهٔ بازیابی وجود دارد.', 'CUSTODY_INVARIANT_BROKEN')
      if (existing && String(existing.decisionReason ?? '') !== reason)
        throw new BusinessError('تلاش آرشیو پیشین با دلیل دیگری ثبت شده است؛ برای حفظ تاریخچه همان دلیل را دوباره وارد کنید.', 'CUSTODIAN_ARCHIVE_RETRY_MISMATCH')
      const freezeEpoch = Number(state.epoch) + 1
      const resolution = existing
        ? await tx.custodyResolution.update({ where: { id: existing.id }, data: { status: 'ARCHIVE_FREEZE', evidence: 'CUSTODIAN_ARCHIVED', differenceAttribution: 'PENDING_DECISION', decisionReason: reason, resolvedAt: null } })
        : await tx.custodyResolution.create({ data: { shiftId: shift.id, status: 'ARCHIVE_FREEZE', evidence: 'CUSTODIAN_ARCHIVED', differenceAttribution: 'PENDING_DECISION', decisionReason: reason } })
      const changed = await tx.custodyState.updateMany({
        where: { key: MAIN, state: 'ACTIVE', activeShiftId: shift.id, epoch: state.epoch },
        data: { state: 'CUSTODIAN_ARCHIVE_FREEZE', epoch: freezeEpoch, updatedAt: new Date() }
      })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ آرشیو مسئول ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'CUSTODIAN_ARCHIVE_FREEZE', shiftId: shift.id, resolutionId: resolution.id, actorKind: 'GLOBAL_MANAGER', authMethod: 'MANAGER_SESSION', epochBefore: state.epoch, epochAfter: freezeEpoch, payload: { targetUserId: userId, reason } })
      return { shiftId: shift.id, epoch: freezeEpoch, resolutionId: resolution.id, resumed: false }
    })

    const abort = async (failure: string) => {
      await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'CUSTODIAN_ARCHIVE_FREEZE' || state.activeShiftId !== frozen.shiftId || state.epoch !== frozen.epoch) return
        const resolution = await tx.custodyResolution.findUnique({ where: { id: frozen.resolutionId } })
        if (!resolution || resolution.status !== 'ARCHIVE_FREEZE') return
        const nextEpoch = Number(state.epoch) + 1
        await tx.custodyResolution.update({ where: { id: resolution.id }, data: { status: 'ARCHIVE_ABORTED' } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'CUSTODIAN_ARCHIVE_FREEZE', activeShiftId: frozen.shiftId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: frozen.shiftId, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count === 1)
          await writeEvent(tx, { type: 'CUSTODIAN_ARCHIVE_ABORTED', shiftId: frozen.shiftId, resolutionId: resolution.id, actorKind: 'GLOBAL_MANAGER', authMethod: 'MANAGER_SESSION', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { targetUserId: userId, failure } })
      })
    }

    let expectedCash: number
    try {
      expectedCash = Number((await cashboxService.expected({ shiftId: frozen.shiftId })).expectedCash)
    } catch (error) {
      await abort('EXPECTED_CALCULATION_FAILED')
      throw error
    }

    try {
      return await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'CUSTODIAN_ARCHIVE_FREEZE' || state.activeShiftId !== frozen.shiftId || state.epoch !== frozen.epoch)
          throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ آرشیو مسئول ثبت نشد.', 'CUSTODY_STALE')
        const [shift, meta, resolution] = await Promise.all([
          tx.shift.findUnique({ where: { id: frozen.shiftId } }),
          tx.custodyShiftMeta.findUnique({ where: { shiftId: frozen.shiftId } }),
          tx.custodyResolution.findUnique({ where: { id: frozen.resolutionId } })
        ])
        if (!shift || shift.closedAt || shift.userId !== userId || !meta || meta.custodianUserId !== userId || !resolution || resolution.status !== 'ARCHIVE_FREEZE')
          throw new BusinessError('اطلاعات آرشیو مسئول صندوق ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
        const nextEpoch = Number(state.epoch) + 1
        const closed = await shiftService.closeInTx(tx, { shiftId: shift.id, userId, note: `آرشیو مسئول فعال صندوق؛ نیازمند شمارش بازیابی: ${reason}` })
        await tx.custodyShiftMeta.update({ where: { shiftId: shift.id }, data: { endKind: 'CUSTODIAN_ARCHIVED_UNRESOLVED', endedAt: closed.closedAt, countStatus: 'COUNT_PENDING' } })
        await tx.custodyResolution.update({ where: { id: resolution.id }, data: { status: 'OPEN', nightExpectedCash: BigInt(expectedCash), evidence: 'CUSTODIAN_ARCHIVED', differenceAttribution: 'PENDING_DECISION' } })
        const archived = await input.archiveInTx(tx)
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'CUSTODIAN_ARCHIVE_FREEZE', activeShiftId: shift.id, epoch: state.epoch }, data: { state: 'NO_SESSION', activeShiftId: null, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ آرشیو مسئول ثبت نشد.', 'CUSTODY_STALE')
        await writeEvent(tx, { type: 'CUSTODIAN_ARCHIVED_UNRESOLVED', shiftId: shift.id, resolutionId: resolution.id, actorKind: 'GLOBAL_MANAGER', authMethod: 'MANAGER_SESSION', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { targetUserId: userId, reason, expectedCash } })
        return { archived, resolutionId: resolution.id, shiftId: shift.id, expectedCash, resumed: frozen.resumed }
      })
    } catch (error) {
      try { await abort('COMPLETION_FAILED') } catch { /* retain the original completion failure */ }
      throw error
    }
  },

  /**
   * Morning recovery for an unattended/expired custody segment. The prior
   * custodian is deliberately not asked to authenticate, and neither is a
   * manager: an active cashier or manager proves their own identity with their
   * PIN and witnesses the physical count. This closes only the old financial
   * segment; opening a new drawer remains a separate PIN/count operation.
   */
  async recoverUnattended(input: { resolutionId: unknown; userId: unknown; password: unknown; countedCash: unknown; note?: unknown }) {
    const resolutionId = asSafeId(input.resolutionId, 'شناسه پرونده شب')
    const witness = await this.verifyPin(input.userId, input.password)
    if (witness.role !== 'MANAGER' && witness.role !== 'CASHIER')
      throw new BusinessError('این نقش مجاز به ثبت شمارش شاهد صبح نیست.', 'NO_PERMISSION')
    const countedCash = asCash(input.countedCash, 'شمارش شاهد صبح')
    const note = String(input.note ?? '').trim() || undefined
    const resolution = await prisma.custodyResolution.findUnique({ where: { id: resolutionId } })
    if (!resolution || resolution.status !== 'OPEN') throw new BusinessError('این پرونده شب قبلاً تعیین تکلیف شده یا پیدا نشد.', 'RECOVERY_NOT_OPEN')
    const shift = await prisma.shift.findUnique({ where: { id: resolution.shiftId } })
    if (!shift?.closedAt) throw new BusinessError('پرونده فقط پس از بسته‌شدن نشست منقضی قابل بازیابی است.', 'CUSTODY_INVARIANT_BROKEN')
    const archivedCustodian = resolution.evidence === 'CUSTODIAN_ARCHIVED'

    return cashboxService.close({
      shiftId: shift.id,
      explicitShift: true,
      closeShift: false,
      countedCash,
      note,
      userId: witness.userId,
      custodyEffectiveTo: new Date(shift.closedAt),
      // The old segment is already closed by rollover and its owner may be
      // absent. This marker is stripped from every IPC payload.
      internalCustodyRecovery: true,
      afterCloseInTx: async (tx: Client, session: any) => {
        const live = await tx.custodyResolution.findUnique({ where: { id: resolutionId } })
        if (!live || live.status !== 'OPEN' || live.shiftId !== shift.id)
          throw new BusinessError('پرونده شب هم‌زمان تغییر کرد؛ شمارش شاهد ثبت نشد.', 'CUSTODY_STALE')
        const count = await tx.custodyCount.create({
          data: {
            shiftId: shift.id,
            kind: archivedCustodian ? 'ARCHIVED_CUSTODIAN_WITNESS' : 'MORNING_WITNESS',
            countedCash: BigInt(countedCash),
            expectedCash: session.expectedCash,
            differenceCash: session.cashDifference,
            countedByUserId: witness.userId,
            authMethod: 'CUSTODY_PIN',
            note: note ?? null,
            epochAtCount: Number((await ensureState(tx)).epoch),
            idempotencyKey: `morning-witness:${resolutionId}:${session.id}`,
            operationalDay: toJalaliDate(new Date())
          }
        })
        const changed = await tx.custodyResolution.updateMany({
          where: { id: resolutionId, status: 'OPEN', shiftId: shift.id },
          data: {
            status: 'RESOLVED',
            nightExpectedCash: live.nightExpectedCash ?? session.expectedCash,
            morningWitnessCountId: count.id,
            provisionalDifference: session.cashDifference,
            evidence: archivedCustodian ? 'CUSTODIAN_ARCHIVED_RECOVERED' : 'MORNING_WITNESS',
            differenceAttribution: 'UNASSIGNED',
            cashSessionId: session.id,
            resolvedAt: new Date()
          }
        })
        if (changed.count !== 1) throw new BusinessError('پرونده شب هم‌زمان تغییر کرد؛ شمارش شاهد ثبت نشد.', 'CUSTODY_STALE')
        await tx.custodyShiftMeta.updateMany({ where: { shiftId: shift.id, endKind: { in: ['UNRESOLVED', 'EXPIRED_UNRESOLVED', 'CUSTODIAN_ARCHIVED_UNRESOLVED'] } }, data: { endKind: archivedCustodian ? 'CUSTODIAN_ARCHIVED_RECOVERED' : 'RECOVERED_MORNING_WITNESS', cashSessionId: session.id } })
        await writeEvent(tx, {
          type: archivedCustodian ? 'CUSTODIAN_ARCHIVE_RECOVERED' : 'UNATTENDED_RECOVERED',
          shiftId: shift.id,
          resolutionId,
          actorUserId: witness.userId,
          actorKind: archivedCustodian ? 'ARCHIVE_RECOVERY_WITNESS' : 'MORNING_WITNESS',
          authMethod: 'CUSTODY_PIN',
          payload: { cashSessionId: session.id, countId: count.id, expectedCash: session.expectedCash, countedCash, differenceCash: session.cashDifference, archivedCustodian }
        })
      }
    } as any)
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
    const [cfg, scheduling] = fromMeta.templateId
      ? await Promise.all([configOf(prisma), shiftSchedulingOf(prisma)])
      : [null, null]
    const storedSchedule = scheduleSnapshotOf(fromMeta)
    /** Current settings decide *future* recipient planning, but the live
     * segment's own permission, roster and boundary come from its snapshot. */
    const currentTemplate = fromMeta.templateId
      ? scheduling?.templates.find((row) => row.id === fromMeta.templateId) ?? null
      : null
    const canonicalTemplate = storedSchedule
      ? { allowMidDayHandover: storedSchedule.allowMidDayHandover, staffIds: storedSchedule.staffIds }
      : currentTemplate
    const scheduledEnd = storedSchedule?.scheduledEndAt
      ? new Date(storedSchedule.scheduledEndAt)
      : fromMeta.scheduledEndAt ? new Date(fromMeta.scheduledEndAt) : null
    const handoverKind = canonicalTemplate && scheduledEnd && Number.isFinite(scheduledEnd.getTime()) && Date.now() >= scheduledEnd.getTime() - MIDDAY_HANDOVER_CUTOFF_MS
      ? 'SHIFT_CHANGE'
      : 'MIDDAY'
    if (fromMeta.templateId && handoverKind === 'MIDDAY' && !canonicalTemplate?.allowMidDayHandover)
      throw new BusinessError('مدیر برای این شیفت اجازهٔ تحویل میان‌روز را فعال نکرده است.', 'MIDDAY_HANDOVER_DISABLED')
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
    const canonicalMultiShift = storedSchedule
      ? storedSchedule.mode === 'MULTI_SHIFT'
      : !!(cfg && scheduling && effectiveCustodyMode(cfg, scheduling) === 'MULTI_SHIFT')
    const nextShiftPlan = fromMeta.templateId && canonicalMultiShift && handoverKind === 'SHIFT_CHANGE' && scheduledEnd && scheduling
      // End is exclusive; +1 ms selects the incoming template at the planned boundary.
      ? canonicalPlanForOpen(scheduling, toUserId, new Date(scheduledEnd.getTime() + 1))
      : null
    /** In multi-shift mode a recipient must be assigned to the same (mid-day)
     * or next (boundary) template. In single-shift mode the manager has picked
     * the primary planned worker already; any other active, PIN-authenticated
     * registered cashier/manager is an eligible deliberate replacement. */
    if (fromMeta.templateId && canonicalMultiShift && handoverKind === 'MIDDAY' && (!canonicalTemplate || !canonicalTemplate.staffIds.includes(toUserId)))
      throw new BusinessError('تحویل‌گیرنده باید برای همین شیفت در تنظیمات شیفت ثبت شده باشد.', 'RECEIVER_NOT_SCHEDULED')
    if (fromMeta.templateId && canonicalMultiShift && handoverKind === 'SHIFT_CHANGE' && !nextShiftPlan)
      throw new BusinessError('در ۱۵ دقیقهٔ پایانی، تحویل‌گیرنده باید در شیفت بعدیِ زمان‌بندی‌شده ثبت شده باشد.', 'RECEIVER_NOT_SCHEDULED')
    const countedCash = asCash(input.countedCash, 'شمارش تحویل صندوق')
    const idempotencyKey = String(input.idempotencyKey ?? '').trim() || randomBytes(16).toString('hex')
    const started = await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      if (live.state !== 'ACTIVE' || live.activeShiftId !== state.activeShiftId || live.epoch !== state.epoch)
        throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      const nextEpoch = Number(live.epoch) + 1
      const count = await tx.custodyCount.create({ data: { shiftId: state.activeShiftId, kind: 'HANDOVER_OUT', countedCash: BigInt(countedCash), countedByUserId: giver.userId, authMethod: 'CUSTODY_PIN', epochAtCount: nextEpoch, idempotencyKey: idempotencyKey, operationalDay: toJalaliDate(new Date()), note: String(input.note ?? '').trim() || null } })
      const handover = await tx.custodyHandover.create({ data: { fromShiftId: state.activeShiftId, fromUserId: giver.userId, selectedRecipientUserId: toUserId, status: 'PENDING', outCountId: count.id, expectedAtStart: BigInt(0), countedAtStart: BigInt(countedCash), differenceCash: BigInt(0), ledgerWatermark: JSON.stringify({ ready: false, handoverKind, incomingSchedule: nextShiftPlan ? { templateId: nextShiftPlan.templateId, title: nextShiftPlan.title, scheduledEndAt: nextShiftPlan.scheduledEndAt?.toISOString() ?? null, reminderRepeatMin: nextShiftPlan.reminderRepeatMin, allowMidDayHandover: nextShiftPlan.allowMidDayHandover, scheduleSnapshotJson: scheduleSnapshotJson(nextShiftPlan, scheduling, cfg) } : null }), fenceEpochAtStart: nextEpoch, idempotencyKey, stateKey: MAIN, operationalDay: toJalaliDate(new Date()) } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'ACTIVE', activeShiftId: state.activeShiftId, epoch: state.epoch }, data: { state: 'HANDOVER_PENDING', pendingHandoverId: handover.id, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'HANDOVER_START', shiftId: state.activeShiftId, handoverId: handover.id, actorUserId: giver.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { selectedRecipientUserId: toUserId, handoverKind, incomingTemplateId: nextShiftPlan?.templateId ?? null } })
      return { handover, epoch: nextEpoch, count }
    })
    /** The initial watermark is read-only evidence. Pending sales remain valid
     * and attributed to the outgoing custodian; acceptance takes a separate,
     * short freeze and recount before it can transfer responsibility. */
    const expected = await cashboxService.expected({ shiftId: state.activeShiftId, countedCash })
    const expectedCash = Number(expected.expectedCash)
    await prisma.$transaction(async (tx: Client) => {
      const live = await ensureState(tx)
      if (live.state !== 'HANDOVER_PENDING' || live.pendingHandoverId !== started.handover.id || live.epoch !== started.epoch)
        throw new BusinessError('تحویل دیگر در وضعیت قابل تکمیل نیست.', 'HANDOVER_NOT_PENDING')
      await tx.custodyCount.update({ where: { id: started.count.id }, data: { expectedCash: BigInt(expectedCash), differenceCash: BigInt(countedCash - expectedCash) } })
      const startWatermark = JSON.parse(String(started.handover.ledgerWatermark || '{}'))
      await tx.custodyHandover.update({ where: { id: started.handover.id }, data: { expectedAtStart: BigInt(expectedCash), differenceCash: BigInt(countedCash - expectedCash), ledgerWatermark: JSON.stringify({ ...startWatermark, ready: true, expectedCash, countedCash, at: new Date().toISOString() }) } })
    })
    return { id: started.handover.id, state: 'HANDOVER_PENDING', expectedCash, countedCash, differenceCash: countedCash - expectedCash }
  },

  /**
   * A pending handover deliberately keeps the outgoing drawer session alive:
   * sales continue under that person while the receiver is away. Acceptance
   * briefly fences writers and takes a fresh receiver count. A non-zero
   * difference is permitted only with a durable reason: it remains attached
   * to the outgoing Shift while the receiver starts the next segment at their
   * actual physical count. This is the opt-in custody feature
   * (custody.config.enabled); legacy installs never enter this state machine.
   */
  /**
   * The receiver's blind count, the ledger expected amount, and any difference
   * must share one immutable financial boundary. Once we freeze the drawer for
   * that count, sales never resume merely because the receiver has not yet
   * typed a difference reason. The only exits are: (a) the same receiver
   * supplies the required reason and completes transfer, or (b) the original
   * custodian explicitly cancels it. This prevents a later expected amount
   * being compared with an earlier physical count.
   */
  async handoverAccept(input: { handoverId: unknown; password: unknown; countedCash: unknown; differenceReason?: unknown }) {
    const handoverId = asSafeId(input.handoverId, 'شناسه تحویل')
    const pending = await prisma.custodyHandover.findUnique({ where: { id: handoverId } })
    if (!pending || pending.status !== 'PENDING') throw new BusinessError('این تحویل دیگر در انتظار پذیرش نیست.', 'HANDOVER_NOT_PENDING')
    const ready = JSON.parse(String(pending.ledgerWatermark || '{}'))
    if (!ready.ready) throw new BusinessError('شمارش تحویل هنوز کامل نشده است؛ ابتدا تحویل‌دهنده آن را لغو یا کامل کند.', 'RECOUNT_REQUIRED')
    const receiver = await this.verifyPin(pending.selectedRecipientUserId, input.password)
    const submittedCash = asCash(input.countedCash, 'شمارش مستقل تحویل‌گیرنده')
    const differenceReason = String(input.differenceReason ?? '').trim()

    type FrozenRecount = {
      fromShiftId: number
      epoch: number
      countedCash: number
      expectedCash?: number
      differenceCash?: number
      pendingCountId?: number
      resumedDifference: boolean
    }

    /** First call moves PENDING → HANDOVER_RECOUNT. A retry after an omitted
     * difference reason resumes the exact frozen snapshot; it cannot recount or
     * recalculate expected after any financial writer has had a chance to run. */
    const frozen: FrozenRecount = await prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      const live = await tx.custodyHandover.findUnique({ where: { id: handoverId } })
      if (!live || live.status !== 'PENDING' || !state.activeShiftId || live.fromShiftId !== state.activeShiftId)
        throw new BusinessError('اطلاعات تحویل ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
      const watermark = JSON.parse(String(live.ledgerWatermark || '{}'))

      if (state.state === 'HANDOVER_RECOUNT') {
        const snapshot = watermark.differencePending
        if (!snapshot || typeof snapshot !== 'object')
          throw new BusinessError('شمارش نهایی دیگری در جریان است؛ وضعیت صندوق را تازه کنید.', 'CUSTODY_FROZEN')
        const countedCash = asCash((snapshot as any).countedCash, 'شمارش فریز‌شده')
        const expectedCash = Number((snapshot as any).expectedCash)
        const differenceCash = Number((snapshot as any).differenceCash)
        const pendingCountId = asSafeId((snapshot as any).countId, 'شناسه شمارش فریز‌شده')
        if (!Number.isSafeInteger(expectedCash) || expectedCash < 0 || !Number.isSafeInteger(differenceCash) || submittedCash !== countedCash)
          throw new BusinessError('شمارش فریز‌شده قابل تغییر نیست؛ همان مبلغ را با دلیل مغایرت ثبت کنید یا تحویل‌دهنده آن را لغو کند.', 'HANDOVER_RECOUNT_RETRY_MISMATCH')
        return { fromShiftId: live.fromShiftId, epoch: Number(state.epoch), countedCash, expectedCash, differenceCash, pendingCountId, resumedDifference: true }
      }

      if (state.state !== 'HANDOVER_PENDING' || state.pendingHandoverId !== handoverId)
        throw new BusinessError('این تحویل دیگر در انتظار پذیرش نیست.', 'HANDOVER_NOT_PENDING')
      const nextEpoch = Number(state.epoch) + 1
      const changed = await tx.custodyState.updateMany({
        where: { key: MAIN, state: 'HANDOVER_PENDING', activeShiftId: live.fromShiftId, pendingHandoverId: handoverId, epoch: state.epoch },
        data: { state: 'HANDOVER_RECOUNT', epoch: nextEpoch, updatedAt: new Date() }
      })
      if (changed.count !== 1) throw new BusinessError('فروش یا وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره شمارش کنید.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'HANDOVER_RECOUNT_FREEZE', shiftId: live.fromShiftId, handoverId, actorUserId: receiver.userId, actorKind: 'RECEIVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { countedCash: submittedCash } })
      return { fromShiftId: live.fromShiftId, epoch: nextEpoch, countedCash: submittedCash, resumedDifference: false }
    })

    /** A fresh freeze may be released only when no blind count snapshot was
     * recorded. If expected calculation itself fails, responsibility remains
     * with the outgoing custodian exactly as before the attempted acceptance. */
    const abortFreshFreeze = async (reason: string) => {
      if (frozen.resumedDifference) return
      await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== handoverId || state.epoch !== frozen.epoch) return
        const nextEpoch = Number(state.epoch) + 1
        const changed = await tx.custodyState.updateMany({
          where: { key: MAIN, state: 'HANDOVER_RECOUNT', pendingHandoverId: handoverId, epoch: state.epoch },
          data: { state: 'HANDOVER_PENDING', epoch: nextEpoch, updatedAt: new Date() }
        })
        if (changed.count === 1)
          await writeEvent(tx, { type: 'HANDOVER_RECOUNT_ABORTED', shiftId: frozen.fromShiftId, handoverId, actorUserId: receiver.userId, actorKind: 'RECEIVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { reason } })
      })
    }

    let expectedCash = frozen.expectedCash
    let differenceCash = frozen.differenceCash
    if (!frozen.resumedDifference) {
      try {
        const expected = await cashboxService.expected({ shiftId: frozen.fromShiftId, countedCash: frozen.countedCash })
        expectedCash = Number(expected.expectedCash)
        differenceCash = frozen.countedCash - expectedCash
      } catch (error) {
        await abortFreshFreeze('EXPECTED_CALCULATION_FAILED')
        throw error
      }
    }
    if (!Number.isSafeInteger(expectedCash) || expectedCash! < 0 || !Number.isSafeInteger(differenceCash))
      throw new BusinessError('مبلغ انتظاری تحویل قابل محاسبه نیست.', 'CUSTODY_INVARIANT_BROKEN')

    if (differenceCash !== 0 && differenceReason.length < 10) {
      if (!frozen.resumedDifference) {
        await prisma.$transaction(async (tx: Client) => {
          const state = await ensureState(tx)
          if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== handoverId || state.epoch !== frozen.epoch)
            throw new BusinessError('وضعیت تحویل هم‌زمان تغییر کرد؛ دوباره وضعیت صندوق را بگیرید.', 'CUSTODY_STALE')
          const count = await tx.custodyCount.create({
            data: {
              shiftId: frozen.fromShiftId,
              kind: 'HANDOVER_RECOUNT_DIFFERENCE_PENDING',
              countedCash: BigInt(frozen.countedCash),
              expectedCash: BigInt(expectedCash),
              differenceCash: BigInt(differenceCash),
              countedByUserId: receiver.userId,
              authMethod: 'CUSTODY_PIN',
              handoverId,
              epochAtCount: frozen.epoch,
              idempotencyKey: `recount-difference-pending:${handoverId}:${frozen.epoch}`,
              operationalDay: toJalaliDate(new Date())
            }
          })
          const live = await tx.custodyHandover.findUnique({ where: { id: handoverId } })
          const watermark = JSON.parse(String(live?.ledgerWatermark || '{}'))
          await tx.custodyHandover.update({
            where: { id: handoverId },
            data: {
              ledgerWatermark: JSON.stringify({
                ...watermark,
                ready: true,
                accepted: false,
                differencePending: { countId: count.id, countedCash: frozen.countedCash, expectedCash, differenceCash, frozenEpoch: frozen.epoch, at: new Date().toISOString() },
                at: new Date().toISOString()
              }),
              version: { increment: 1 }
            }
          })
          await writeEvent(tx, { type: 'HANDOVER_DIFFERENCE_PENDING', shiftId: frozen.fromShiftId, handoverId, actorUserId: receiver.userId, actorKind: 'RECEIVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: state.epoch, payload: { countId: count.id, countedCash: frozen.countedCash, expectedCash, differenceCash } })
        })
      }
      throw new BusinessError('شمارش مستقل با نقد انتظاری اختلاف دارد. صندوق تا ثبت دلیل روشنِ حداقل ۱۰ حرف یا لغو احرازشدهٔ تحویل‌دهنده freeze می‌ماند؛ همان شمارش فریز‌شده را تغییر ندهید.', 'HANDOVER_DIFFERENCE_REASON_REQUIRED')
    }

    try {
      return await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== handoverId || state.epoch !== frozen.epoch || !state.activeShiftId)
          throw new BusinessError('فروش یا وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره شمارش کنید.', 'CUSTODY_STALE')
        const live = await tx.custodyHandover.findUnique({ where: { id: handoverId } })
        if (!live || live.status !== 'PENDING' || live.fromShiftId !== state.activeShiftId)
          throw new BusinessError('اطلاعات تحویل ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
        const liveWatermark = JSON.parse(String(live.ledgerWatermark || '{}'))
        const nextEpoch = Number(state.epoch) + 1
        /** The blind snapshot row is immutable evidence. A reason is attached
         * to the final handover/event rather than rewriting that physical count. */
        let recount: any
        if (frozen.resumedDifference) {
          recount = await tx.custodyCount.findUnique({ where: { id: frozen.pendingCountId } })
          if (!recount || recount.shiftId !== live.fromShiftId || recount.handoverId !== handoverId || recount.kind !== 'HANDOVER_RECOUNT_DIFFERENCE_PENDING')
            throw new BusinessError('شاهد شمارش فریز‌شده پیدا نشد؛ تحویل قابل تکمیل نیست.', 'CUSTODY_INVARIANT_BROKEN')
        } else {
          recount = await tx.custodyCount.create({
            data: {
              shiftId: live.fromShiftId,
              kind: differenceCash === 0 ? 'HANDOVER_RECOUNT' : 'HANDOVER_RECOUNT_DIFFERENCE',
              countedCash: BigInt(frozen.countedCash),
              expectedCash: BigInt(expectedCash),
              differenceCash: BigInt(differenceCash),
              countedByUserId: receiver.userId,
              authMethod: 'CUSTODY_PIN',
              note: differenceCash === 0 ? null : differenceReason,
              handoverId,
              epochAtCount: nextEpoch,
              idempotencyKey: `recount:${handoverId}:${frozen.epoch}`,
              operationalDay: toJalaliDate(new Date())
            }
          })
        }
        const closed = await shiftService.closeInTx(tx, { shiftId: live.fromShiftId, userId: live.fromUserId, note: differenceCash === 0 ? 'تحویل احرازشده صندوق' : 'تحویل احرازشده صندوق با مغایرت شمارش' })
        const [cfg, scheduling, sourceMeta] = await Promise.all([
          configOf(tx),
          shiftSchedulingOf(tx),
          tx.custodyShiftMeta.findUnique({ where: { shiftId: live.fromShiftId } })
        ])
        /** A mid-day replacement retains the immutable source snapshot; a
         * boundary transfer uses the incoming schedule snapshot captured when
         * the handover began, not Settings as they happen to look now. */
        const sourceTemplate = sourceMeta?.templateId ? scheduling.templates.find((row) => row.id === sourceMeta.templateId) ?? null : null
        const sourcePlan = sourceMeta ? planFromSegmentSnapshot(sourceMeta, sourceTemplate) : null
        const incomingSnapshot = liveWatermark.handoverKind === 'SHIFT_CHANGE' && liveWatermark.incomingSchedule && typeof liveWatermark.incomingSchedule === 'object'
          ? liveWatermark.incomingSchedule
          : null
        const plan = incomingSnapshot
          ? { legacyPlanId: null, templateId: String(incomingSnapshot.templateId), title: String(incomingSnapshot.title ?? 'شیفت بعدی برنامه‌ریزی‌شده'), scheduledEndAt: incomingSnapshot.scheduledEndAt ? new Date(String(incomingSnapshot.scheduledEndAt)) : null, reminderRepeatMin: Number(incomingSnapshot.reminderRepeatMin) || 15, allowMidDayHandover: incomingSnapshot.allowMidDayHandover === true }
          : sourcePlan
            ?? (scheduling.custodyModeConfigured && effectiveCustodyMode(cfg, scheduling) === 'MULTI_SHIFT'
              ? canonicalPlanForOpen(scheduling, receiver.userId)
              : effectiveCustodyMode(cfg, scheduling) === 'MULTI_SHIFT'
                ? await planForOpen(tx, receiver.userId)
                : null)
        const immutableScheduleSnapshot = typeof incomingSnapshot?.scheduleSnapshotJson === 'string'
          ? incomingSnapshot.scheduleSnapshotJson
          : sourceMeta?.scheduleSnapshotJson ?? scheduleSnapshotJson(plan, scheduling, cfg)
        const next = await shiftService.createSession(tx, { staffId: receiver.userId, staffConfirmed: true, actorId: receiver.userId, mode: 'HANDOVER', openIdempotencyKey: live.idempotencyKey, openIdempotencyFingerprint: `custody-handover:${handoverId}`, note: 'تحویل احرازشده صندوق' })
        if (frozen.countedCash > 0) await recordCashMovement(tx, { amount: frozen.countedCash, type: CashMovementType.OPENING_FLOAT, shiftId: next.id, userId: receiver.userId, refType: 'CustodyHandover', refId: handoverId, description: 'موجودی اول ناشی از تحویل صندوقِ شمارش‌شده' })
        await tx.custodyShiftMeta.update({ where: { shiftId: live.fromShiftId }, data: { endKind: differenceCash === 0 ? 'HANDED_OVER' : 'HANDED_OVER_WITH_DIFFERENCE', endedAt: closed.closedAt } })
        await tx.custodyShiftMeta.create({ data: { shiftId: next.id, custodianUserId: receiver.userId, openAuth: 'HANDOVER_RECEIVER_PIN', templateId: plan?.templateId ?? null, planId: plan?.legacyPlanId ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, scheduleSnapshotJson: immutableScheduleSnapshot, rolloverAt: rolloverAtForSnapshot(new Date(), cfg, scheduling, plan, immutableScheduleSnapshot), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: 'COUNTED', openEpoch: nextEpoch } })
        await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'COMPLETED', finalCustodianUserId: receiver.userId, acceptedByUserId: receiver.userId, resolutionKind: differenceCash === 0 ? 'RECEIVER_ACCEPTED' : 'RECEIVER_ACCEPTED_WITH_DIFFERENCE', resolutionReason: differenceCash === 0 ? null : differenceReason, expectedAtStart: BigInt(expectedCash), differenceCash: BigInt(differenceCash), ledgerWatermark: JSON.stringify({ ...liveWatermark, ready: true, accepted: true, differencePending: null, expectedCash, countedCash: frozen.countedCash, differenceCash, differenceReason: differenceCash === 0 ? null : differenceReason, differenceAttributedToUserId: differenceCash === 0 ? null : live.fromUserId, recountCountId: recount.id, at: new Date().toISOString() }), toShiftId: next.id, finishedAt: new Date(), version: { increment: 1 } } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_RECOUNT', pendingHandoverId: handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: next.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ تحویل ثبت نشد.', 'CUSTODY_STALE')
        await writeEvent(tx, { type: differenceCash === 0 ? 'HANDOVER_ACCEPT' : 'HANDOVER_ACCEPT_WITH_DIFFERENCE', shiftId: differenceCash === 0 ? next.id : live.fromShiftId, handoverId, actorUserId: receiver.userId, actorKind: 'RECEIVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { fromShiftId: live.fromShiftId, toShiftId: next.id, recountCountId: recount.id, expectedCash, countedCash: frozen.countedCash, differenceCash, differenceReason: differenceCash === 0 ? null : differenceReason, differenceAttributedToUserId: differenceCash === 0 ? null : live.fromUserId, frozenBlindCount: frozen.resumedDifference } })
        return { handoverId, shiftId: next.id, epoch: nextEpoch, expectedCash, countedCash: frozen.countedCash, differenceCash }
      })
    } catch (error) {
      /** A final transaction failure before a durable difference snapshot may
       * safely return to PENDING. Once a blind difference is durable, it stays
       * frozen for an authenticated retry/cancel and never reopens sales. */
      await abortFreshFreeze('ACCEPT_TRANSACTION_FAILED')
      throw error
    }
  },

  /** The original custodian may cancel a normal pending handover or a frozen
   * difference-pending handover. Cancelling never deletes the receiver's blind
   * count; it only returns operational responsibility to the outgoing segment. */
  async handoverCancel(input: { handoverId: unknown; password: unknown }) {
    const handoverId = asSafeId(input.handoverId, 'شناسه تحویل')
    const pending = await prisma.custodyHandover.findUnique({ where: { id: handoverId } })
    if (!pending || pending.status !== 'PENDING') throw new BusinessError('این تحویل دیگر در انتظار لغو نیست.', 'HANDOVER_NOT_PENDING')
    const giver = await this.verifyPin(pending.fromUserId, input.password)
    return prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      const watermark = JSON.parse(String(pending.ledgerWatermark || '{}'))
      const frozenDifference = state.state === 'HANDOVER_RECOUNT' && !!watermark.differencePending
      if ((state.state !== 'HANDOVER_PENDING' && !frozenDifference) || state.pendingHandoverId !== handoverId || state.activeShiftId !== pending.fromShiftId)
        throw new BusinessError('این تحویل دیگر در انتظار لغو نیست.', 'HANDOVER_NOT_PENDING')
      const nextEpoch = Number(state.epoch) + 1
      const canceledKind = frozenDifference ? 'CANCELED_BY_GIVER_AFTER_DIFFERENCE_FREEZE' : 'CANCELED_BY_GIVER'
      await tx.custodyHandover.update({ where: { id: handoverId }, data: { status: 'CANCELED', resolutionKind: canceledKind, finishedAt: new Date(), version: { increment: 1 } } })
      await tx.custodyCount.create({ data: { shiftId: pending.fromShiftId, kind: 'HANDOVER_CANCELED', countedCash: pending.countedAtStart, countedByUserId: giver.userId, authMethod: 'CUSTODY_PIN', handoverId, epochAtCount: nextEpoch, idempotencyKey: `cancel:${handoverId}`, operationalDay: toJalaliDate(new Date()) } })
      const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: frozenDifference ? 'HANDOVER_RECOUNT' : 'HANDOVER_PENDING', activeShiftId: pending.fromShiftId, pendingHandoverId: handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: pending.fromShiftId, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ لغو ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: frozenDifference ? 'HANDOVER_DIFFERENCE_FROZEN_CANCELED' : 'HANDOVER_CANCEL', shiftId: pending.fromShiftId, handoverId, actorUserId: giver.userId, actorKind: 'CUSTODIAN', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { preservedDifferenceCountId: frozenDifference ? watermark.differencePending?.countId ?? null : null } })
      return { handoverId, state: 'ACTIVE', epoch: nextEpoch }
    })
  },

  /**
   * Emergency cover transfers the physical drawer to a present, PIN-authenticated
   * worker when the prior custodian cannot complete a normal handover. It is a
   * separate auditable path: a mandatory reason and physical count are attached
   * to the prior segment, while the cover worker owns the newly created one.
   */
  async emergencyCover(input: { userId: unknown; password: unknown; countedCash: unknown; reason: unknown }) {
    const cover = await this.verifyPin(input.userId, input.password)
    if (cover.role !== 'MANAGER' && cover.role !== 'CASHIER')
      throw new BusinessError('این نقش مجاز به پوشش اضطراری صندوق نیست.', 'NO_PERMISSION')
    const countedCash = asCash(input.countedCash, 'شمارش فیزیکی پوشش اضطراری')
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 10)
      throw new BusinessError('برای پوشش اضطراری صندوق، دلیل روشنِ حداقل ۱۰ حرف وارد کنید.', 'EMERGENCY_REASON_REQUIRED')

    const emergency = await prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      if (state.state === 'HANDOVER_RECOUNT' && state.pendingHandoverId) {
        const pending = await tx.custodyHandover.findUnique({ where: { id: state.pendingHandoverId } })
        if (!pending || pending.status !== 'EMERGENCY_RECOUNT' || pending.resolutionKind !== 'EMERGENCY_COVER')
          throw new BusinessError('یک شمارش نهایی دیگر در جریان است؛ چند لحظه بعد دوباره تلاش کنید.', 'CUSTODY_FROZEN')
        if (pending.selectedRecipientUserId !== cover.userId)
          throw new BusinessError('پوشش اضطراری در حال ثبت فقط با PIN همان کارمند انتخاب‌شده قابل ادامه است.', 'EMERGENCY_COVER_IN_PROGRESS')
        if (Number(pending.countedAtStart) !== countedCash || String(pending.resolutionReason ?? '') !== reason)
          throw new BusinessError('پوشش اضطراریِ ناتمام با شمارش یا دلیل دیگری قابل ادامه نیست؛ همان مبلغ و دلیلِ ثبت‌شده را وارد کنید.', 'EMERGENCY_RETRY_MISMATCH')
        return { handoverId: pending.id, fromShiftId: pending.fromShiftId, epoch: Number(state.epoch), outCountId: pending.outCountId, resumed: true }
      }
      if (state.state !== 'ACTIVE' || !state.activeShiftId)
        throw new BusinessError('پوشش اضطراری فقط وقتی ممکن است که صندوق مسئول فعال داشته باشد.', 'NO_ACTIVE_CUSTODY')
      const [fromShift, fromMeta] = await Promise.all([
        tx.shift.findUnique({ where: { id: state.activeShiftId } }),
        tx.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
      ])
      if (!fromShift || fromShift.closedAt || !fromShift.userId || !fromMeta || fromMeta.custodianUserId !== fromShift.userId)
        throw new BusinessError('وضعیت مسئول فعلی صندوق ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
      if (fromShift.userId === cover.userId)
        throw new BusinessError('پوشش اضطراری باید به کارمند فعالِ دیگری سپرده شود؛ مسئول فعلی خودش باید مسیر عادی صندوق را تکمیل کند.', 'EMERGENCY_SAME_CUSTODIAN')
      const freezeEpoch = Number(state.epoch) + 1
      const declared = await tx.custodyCount.create({
        data: {
          shiftId: fromShift.id,
          kind: 'EMERGENCY_COVER_COUNT',
          countedCash: BigInt(countedCash),
          countedByUserId: cover.userId,
          authMethod: 'CUSTODY_PIN',
          note: reason,
          epochAtCount: freezeEpoch,
          idempotencyKey: `emergency:${fromShift.id}:${state.epoch}:${cover.userId}`,
          operationalDay: toJalaliDate(new Date())
        }
      })
      const handover = await tx.custodyHandover.create({
        data: {
          fromShiftId: fromShift.id,
          fromUserId: fromShift.userId,
          selectedRecipientUserId: cover.userId,
          status: 'EMERGENCY_RECOUNT',
          outCountId: declared.id,
          expectedAtStart: BigInt(0),
          countedAtStart: BigInt(countedCash),
          differenceCash: BigInt(0),
          ledgerWatermark: JSON.stringify({ ready: false, emergency: true, countedCash, reason, at: new Date().toISOString() }),
          fenceEpochAtStart: freezeEpoch,
          idempotencyKey: `emergency:${fromShift.id}:${state.epoch}:${cover.userId}`,
          stateKey: MAIN,
          operationalDay: toJalaliDate(new Date()),
          resolutionKind: 'EMERGENCY_COVER',
          resolutionReason: reason
        }
      })
      const changed = await tx.custodyState.updateMany({
        where: { key: MAIN, state: 'ACTIVE', activeShiftId: fromShift.id, epoch: state.epoch },
        data: { state: 'HANDOVER_RECOUNT', activeShiftId: fromShift.id, pendingHandoverId: handover.id, epoch: freezeEpoch, updatedAt: new Date() }
      })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ پوشش اضطراری ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'EMERGENCY_COVER_FREEZE', shiftId: fromShift.id, handoverId: handover.id, actorUserId: cover.userId, actorKind: 'EMERGENCY_COVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: freezeEpoch, payload: { countedCash, reason, priorCustodianUserId: fromShift.userId } })
      return { handoverId: handover.id, fromShiftId: fromShift.id, epoch: freezeEpoch, outCountId: declared.id, resumed: false }
    })

    const restoreAfterFailure = async (failure: string) => {
      await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== emergency.handoverId || state.epoch !== emergency.epoch) return
        const pending = await tx.custodyHandover.findUnique({ where: { id: emergency.handoverId } })
        if (!pending || pending.status !== 'EMERGENCY_RECOUNT') return
        const nextEpoch = Number(state.epoch) + 1
        await tx.custodyHandover.update({ where: { id: emergency.handoverId }, data: { status: 'EMERGENCY_ABORTED', resolutionKind: 'EMERGENCY_COVER_ABORTED', finishedAt: new Date(), version: { increment: 1 } } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_RECOUNT', pendingHandoverId: emergency.handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: emergency.fromShiftId, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count === 1) await writeEvent(tx, { type: 'EMERGENCY_COVER_ABORTED', shiftId: emergency.fromShiftId, handoverId: emergency.handoverId, actorUserId: cover.userId, actorKind: 'EMERGENCY_COVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { failure } })
      })
    }

    let expectedCash: number
    try {
      expectedCash = Number((await cashboxService.expected({ shiftId: emergency.fromShiftId, countedCash })).expectedCash)
    } catch (error) {
      await restoreAfterFailure('EXPECTED_CALCULATION_FAILED')
      throw error
    }
    const differenceCash = countedCash - expectedCash

    try {
      return await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== emergency.handoverId || state.epoch !== emergency.epoch || state.activeShiftId !== emergency.fromShiftId)
          throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ پوشش اضطراری ثبت نشد.', 'CUSTODY_STALE')
        const [live, fromMeta, cfg, scheduling] = await Promise.all([
          tx.custodyHandover.findUnique({ where: { id: emergency.handoverId } }),
          tx.custodyShiftMeta.findUnique({ where: { shiftId: emergency.fromShiftId } }),
          configOf(tx),
          shiftSchedulingOf(tx)
        ])
        if (!live || live.status !== 'EMERGENCY_RECOUNT' || live.selectedRecipientUserId !== cover.userId || live.fromShiftId !== emergency.fromShiftId || !fromMeta)
          throw new BusinessError('اطلاعات پوشش اضطراری ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
        const nextEpoch = Number(state.epoch) + 1
        await tx.custodyCount.update({ where: { id: emergency.outCountId }, data: { expectedCash: BigInt(expectedCash), differenceCash: BigInt(differenceCash) } })
        const closed = await shiftService.closeInTx(tx, { shiftId: emergency.fromShiftId, userId: live.fromUserId, note: `پوشش اضطراری صندوق: ${reason}` })
        const sourceTemplate = fromMeta.templateId ? scheduling.templates.find((row) => row.id === fromMeta.templateId) ?? null : null
        const plan = planFromSegmentSnapshot(fromMeta, sourceTemplate)
        const immutableScheduleSnapshot = fromMeta.scheduleSnapshotJson ?? scheduleSnapshotJson(plan, scheduling, cfg)
        const next = await shiftService.createSession(tx, { staffId: cover.userId, staffConfirmed: true, actorId: cover.userId, mode: 'EMERGENCY_COVER', openIdempotencyKey: `emergency-cover:${emergency.handoverId}`, openIdempotencyFingerprint: `custody-emergency:${emergency.handoverId}`, note: `پوشش اضطراری صندوق: ${reason}` })
        if (countedCash > 0) await recordCashMovement(tx, { amount: countedCash, type: CashMovementType.OPENING_FLOAT, shiftId: next.id, userId: cover.userId, refType: 'CustodyEmergencyCover', refId: emergency.handoverId, description: 'موجودی اول ناشی از پوشش اضطراری صندوق' })
        await tx.custodyShiftMeta.update({ where: { shiftId: emergency.fromShiftId }, data: { endKind: 'EMERGENCY_COVERED', endedAt: closed.closedAt } })
        await tx.custodyShiftMeta.create({ data: { shiftId: next.id, custodianUserId: cover.userId, openAuth: 'EMERGENCY_COVER_PIN', templateId: plan?.templateId ?? null, planId: plan?.legacyPlanId ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, scheduleSnapshotJson: immutableScheduleSnapshot, rolloverAt: rolloverAtForSnapshot(new Date(), cfg, scheduling, plan, immutableScheduleSnapshot), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: 'COUNTED', openEpoch: nextEpoch } })
        await tx.custodyHandover.update({ where: { id: emergency.handoverId }, data: { status: 'COMPLETED', finalCustodianUserId: cover.userId, acceptedByUserId: cover.userId, resolutionKind: 'EMERGENCY_COVER_COMPLETED', resolutionReason: reason, expectedAtStart: BigInt(expectedCash), differenceCash: BigInt(differenceCash), ledgerWatermark: JSON.stringify({ emergency: true, ready: true, accepted: true, expectedCash, countedCash, differenceCash, reason, differenceAttributedToUserId: live.fromUserId, countId: emergency.outCountId, at: new Date().toISOString() }), toShiftId: next.id, finishedAt: new Date(), version: { increment: 1 } } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_RECOUNT', activeShiftId: emergency.fromShiftId, pendingHandoverId: emergency.handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: next.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ پوشش اضطراری ثبت نشد.', 'CUSTODY_STALE')
        await writeEvent(tx, { type: 'EMERGENCY_COVER_COMPLETED', shiftId: emergency.fromShiftId, handoverId: emergency.handoverId, actorUserId: cover.userId, actorKind: 'EMERGENCY_COVER', authMethod: 'CUSTODY_PIN', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { fromShiftId: emergency.fromShiftId, toShiftId: next.id, priorCustodianUserId: live.fromUserId, expectedCash, countedCash, differenceCash, reason, countId: emergency.outCountId } })
        return { handoverId: emergency.handoverId, shiftId: next.id, expectedCash, countedCash, differenceCash, resumed: emergency.resumed }
      })
    } catch (error) {
      try { await restoreAfterFailure('COMPLETION_FAILED') } catch { /* preserve the original failure */ }
      throw error
    }
  },

  /**
   * Master Override is deliberately not an alias for emergency cover. The
   * selected, active manager is recorded as the new custodian, while the
   * established shared manager-password gate authorizes this exceptional
   * operation. A usable personal custody PIN is required as an eligibility
   * safeguard for the manager's later normal handover/close, but it is never
   * supplied as the override authorization itself.
   */
  async masterOverride(input: { managerUserId: unknown; managerPassword: unknown; countedCash: unknown; reason: unknown }) {
    const managerUserId = asSafeId(input.managerUserId, 'شناسه مدیر')
    const [manager, credential] = await Promise.all([
      prisma.user.findUnique({ where: { id: managerUserId } }),
      credentialOf(prisma, managerUserId)
    ])
    if (!manager || !manager.isActive || manager.role !== 'MANAGER')
      throw new BusinessError('مدیر انتخاب‌شده فعال نیست یا دسترسی مدیر ندارد.', 'MASTER_OVERRIDE_MANAGER_INVALID')
    if (!credential || credential.status !== 'ACTIVE' || credential.mustChange)
      throw new BusinessError('مدیر انتخاب‌شده باید پیش از Master Override یک PIN شخصی فعال و غیرموقتِ حضانت داشته باشد.', 'MASTER_OVERRIDE_MANAGER_PIN_REQUIRED')
    /** This is intentionally the shared manager-password primitive, with its
     * existing lockout behavior—not a personal correction-PIN approval. */
    await assertManagerPassword(String(input.managerPassword ?? ''), 'Master Override صندوق')

    const countedCash = asCash(input.countedCash, 'شمارش فیزیکی Master Override')
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 10)
      throw new BusinessError('برای Master Override صندوق، دلیل روشنِ حداقل ۱۰ حرف وارد کنید.', 'MASTER_OVERRIDE_REASON_REQUIRED')

    const override = await prisma.$transaction(async (tx: Client) => {
      const state = await ensureState(tx)
      if (state.state === 'HANDOVER_RECOUNT' && state.pendingHandoverId) {
        const pending = await tx.custodyHandover.findUnique({ where: { id: state.pendingHandoverId } })
        if (!pending || pending.status !== 'MASTER_OVERRIDE_RECOUNT' || pending.resolutionKind !== 'MASTER_OVERRIDE')
          throw new BusinessError('یک شمارش نهایی دیگر در جریان است؛ چند لحظه بعد دوباره تلاش کنید.', 'CUSTODY_FROZEN')
        if (pending.selectedRecipientUserId !== manager.id)
          throw new BusinessError('Master Override ناتمام فقط با همان مدیر انتخاب‌شده قابل ادامه است.', 'MASTER_OVERRIDE_IN_PROGRESS')
        if (Number(pending.countedAtStart) !== countedCash || String(pending.resolutionReason ?? '') !== reason)
          throw new BusinessError('Master Override ناتمام با شمارش یا دلیل دیگری قابل ادامه نیست؛ همان مبلغ و دلیل ثبت‌شده را وارد کنید.', 'MASTER_OVERRIDE_RETRY_MISMATCH')
        return { handoverId: pending.id, fromShiftId: pending.fromShiftId, epoch: Number(state.epoch), outCountId: pending.outCountId, resumed: true }
      }
      if (state.state !== 'ACTIVE' || !state.activeShiftId)
        throw new BusinessError('Master Override فقط وقتی ممکن است که صندوق مسئول فعال داشته باشد.', 'NO_ACTIVE_CUSTODY')
      const [fromShift, fromMeta] = await Promise.all([
        tx.shift.findUnique({ where: { id: state.activeShiftId } }),
        tx.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })
      ])
      if (!fromShift || fromShift.closedAt || !fromShift.userId || !fromMeta || fromMeta.custodianUserId !== fromShift.userId)
        throw new BusinessError('وضعیت مسئول فعلی صندوق ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
      if (fromShift.userId === manager.id)
        throw new BusinessError('مدیر انتخاب‌شده همین حالا مسئول صندوق است؛ از مسیر عادی صندوق استفاده کنید.', 'MASTER_OVERRIDE_SAME_CUSTODIAN')
      const freezeEpoch = Number(state.epoch) + 1
      const declared = await tx.custodyCount.create({
        data: {
          shiftId: fromShift.id,
          kind: 'MASTER_OVERRIDE_COUNT',
          countedCash: BigInt(countedCash),
          countedByUserId: manager.id,
          authMethod: 'MANAGER_SHARED_PASSWORD',
          note: reason,
          epochAtCount: freezeEpoch,
          idempotencyKey: `master-override:${fromShift.id}:${state.epoch}:${manager.id}`,
          operationalDay: toJalaliDate(new Date())
        }
      })
      const handover = await tx.custodyHandover.create({
        data: {
          fromShiftId: fromShift.id,
          fromUserId: fromShift.userId,
          selectedRecipientUserId: manager.id,
          /** Same selected manager both approves the exceptional path and owns
           * the incoming responsibility; retain that identity on the durable
           * handover record as well as the append-only event. */
          managerApproverUserId: manager.id,
          status: 'MASTER_OVERRIDE_RECOUNT',
          outCountId: declared.id,
          expectedAtStart: BigInt(0),
          countedAtStart: BigInt(countedCash),
          differenceCash: BigInt(0),
          ledgerWatermark: JSON.stringify({ ready: false, masterOverride: true, countedCash, reason, at: new Date().toISOString() }),
          fenceEpochAtStart: freezeEpoch,
          idempotencyKey: `master-override:${fromShift.id}:${state.epoch}:${manager.id}`,
          stateKey: MAIN,
          operationalDay: toJalaliDate(new Date()),
          resolutionKind: 'MASTER_OVERRIDE',
          resolutionReason: reason
        }
      })
      const changed = await tx.custodyState.updateMany({
        where: { key: MAIN, state: 'ACTIVE', activeShiftId: fromShift.id, epoch: state.epoch },
        data: { state: 'HANDOVER_RECOUNT', activeShiftId: fromShift.id, pendingHandoverId: handover.id, epoch: freezeEpoch, updatedAt: new Date() }
      })
      if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ Master Override ثبت نشد.', 'CUSTODY_STALE')
      await writeEvent(tx, { type: 'MASTER_OVERRIDE_FREEZE', shiftId: fromShift.id, handoverId: handover.id, actorUserId: manager.id, actorKind: 'MASTER_OVERRIDE_MANAGER', authMethod: 'MANAGER_SHARED_PASSWORD', epochBefore: state.epoch, epochAfter: freezeEpoch, payload: { countedCash, reason, priorCustodianUserId: fromShift.userId } })
      return { handoverId: handover.id, fromShiftId: fromShift.id, epoch: freezeEpoch, outCountId: declared.id, resumed: false }
    })

    const restoreAfterFailure = async (failure: string) => {
      await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== override.handoverId || state.epoch !== override.epoch) return
        const pending = await tx.custodyHandover.findUnique({ where: { id: override.handoverId } })
        if (!pending || pending.status !== 'MASTER_OVERRIDE_RECOUNT') return
        const nextEpoch = Number(state.epoch) + 1
        await tx.custodyHandover.update({ where: { id: override.handoverId }, data: { status: 'MASTER_OVERRIDE_ABORTED', resolutionKind: 'MASTER_OVERRIDE_ABORTED', finishedAt: new Date(), version: { increment: 1 } } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_RECOUNT', pendingHandoverId: override.handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: override.fromShiftId, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count === 1) await writeEvent(tx, { type: 'MASTER_OVERRIDE_ABORTED', shiftId: override.fromShiftId, handoverId: override.handoverId, actorUserId: manager.id, actorKind: 'MASTER_OVERRIDE_MANAGER', authMethod: 'MANAGER_SHARED_PASSWORD', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { failure } })
      })
    }

    let expectedCash: number
    try {
      expectedCash = Number((await cashboxService.expected({ shiftId: override.fromShiftId, countedCash })).expectedCash)
    } catch (error) {
      await restoreAfterFailure('EXPECTED_CALCULATION_FAILED')
      throw error
    }
    const differenceCash = countedCash - expectedCash

    try {
      return await prisma.$transaction(async (tx: Client) => {
        const state = await ensureState(tx)
        if (state.state !== 'HANDOVER_RECOUNT' || state.pendingHandoverId !== override.handoverId || state.epoch !== override.epoch || state.activeShiftId !== override.fromShiftId)
          throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ Master Override ثبت نشد.', 'CUSTODY_STALE')
        const [live, fromMeta, cfg, scheduling] = await Promise.all([
          tx.custodyHandover.findUnique({ where: { id: override.handoverId } }),
          tx.custodyShiftMeta.findUnique({ where: { shiftId: override.fromShiftId } }),
          configOf(tx),
          shiftSchedulingOf(tx)
        ])
        if (!live || live.status !== 'MASTER_OVERRIDE_RECOUNT' || live.selectedRecipientUserId !== manager.id || live.fromShiftId !== override.fromShiftId || !fromMeta)
          throw new BusinessError('اطلاعات Master Override ناسازگار است.', 'CUSTODY_INVARIANT_BROKEN')
        const nextEpoch = Number(state.epoch) + 1
        await tx.custodyCount.update({ where: { id: override.outCountId }, data: { expectedCash: BigInt(expectedCash), differenceCash: BigInt(differenceCash) } })
        const closed = await shiftService.closeInTx(tx, { shiftId: override.fromShiftId, userId: live.fromUserId, note: `Master Override صندوق: ${reason}` })
        const sourceTemplate = fromMeta.templateId ? scheduling.templates.find((row) => row.id === fromMeta.templateId) ?? null : null
        const plan = planFromSegmentSnapshot(fromMeta, sourceTemplate)
        const immutableScheduleSnapshot = fromMeta.scheduleSnapshotJson ?? scheduleSnapshotJson(plan, scheduling, cfg)
        const next = await shiftService.createSession(tx, { staffId: manager.id, staffConfirmed: true, actorId: manager.id, mode: 'MASTER_OVERRIDE', openIdempotencyKey: `master-override:${override.handoverId}`, openIdempotencyFingerprint: `custody-master-override:${override.handoverId}`, note: `Master Override صندوق: ${reason}` })
        if (countedCash > 0) await recordCashMovement(tx, { amount: countedCash, type: CashMovementType.OPENING_FLOAT, shiftId: next.id, userId: manager.id, refType: 'CustodyMasterOverride', refId: override.handoverId, description: 'موجودی اول ناشی از Master Override صندوق' })
        await tx.custodyShiftMeta.update({ where: { shiftId: override.fromShiftId }, data: { endKind: 'MASTER_OVERRIDDEN', endedAt: closed.closedAt } })
        await tx.custodyShiftMeta.create({ data: { shiftId: next.id, custodianUserId: manager.id, openAuth: 'MASTER_OVERRIDE_MANAGER_PASSWORD', templateId: plan?.templateId ?? null, planId: plan?.legacyPlanId ?? null, planTitle: plan?.title ?? null, scheduledEndAt: plan?.scheduledEndAt ?? null, scheduleSnapshotJson: immutableScheduleSnapshot, rolloverAt: rolloverAtForSnapshot(new Date(), cfg, scheduling, plan, immutableScheduleSnapshot), dayCutoverSnapshot: cfg.dayCutoverMinute, operationalDay: toJalaliDate(new Date()), countStatus: 'COUNTED', openEpoch: nextEpoch } })
        await tx.custodyHandover.update({ where: { id: override.handoverId }, data: { status: 'COMPLETED', finalCustodianUserId: manager.id, acceptedByUserId: manager.id, resolutionKind: 'MASTER_OVERRIDE_COMPLETED', resolutionReason: reason, expectedAtStart: BigInt(expectedCash), differenceCash: BigInt(differenceCash), ledgerWatermark: JSON.stringify({ masterOverride: true, ready: true, accepted: true, expectedCash, countedCash, differenceCash, reason, differenceAttributedToUserId: live.fromUserId, countId: override.outCountId, at: new Date().toISOString() }), toShiftId: next.id, finishedAt: new Date(), version: { increment: 1 } } })
        const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: 'HANDOVER_RECOUNT', activeShiftId: override.fromShiftId, pendingHandoverId: override.handoverId, epoch: state.epoch }, data: { state: 'ACTIVE', activeShiftId: next.id, pendingHandoverId: null, epoch: nextEpoch, updatedAt: new Date() } })
        if (changed.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ Master Override ثبت نشد.', 'CUSTODY_STALE')
        await writeEvent(tx, { type: 'MASTER_OVERRIDE_COMPLETED', shiftId: override.fromShiftId, handoverId: override.handoverId, actorUserId: manager.id, actorKind: 'MASTER_OVERRIDE_MANAGER', authMethod: 'MANAGER_SHARED_PASSWORD', epochBefore: state.epoch, epochAfter: nextEpoch, payload: { fromShiftId: override.fromShiftId, toShiftId: next.id, priorCustodianUserId: live.fromUserId, expectedCash, countedCash, differenceCash, reason, countId: override.outCountId } })
        return { handoverId: override.handoverId, shiftId: next.id, expectedCash, countedCash, differenceCash, resumed: override.resumed }
      })
    } catch (error) {
      try { await restoreAfterFailure('COMPLETION_FAILED') } catch { /* preserve original failure */ }
      throw error
    }
  },

  /**
   * `expectedCash` is sensitive ledger information: it may only be exposed for
   * the drawer that is actively under custody. In particular, it is not a
   * historical/reporting shortcut and it must not become an oracle while the
   * receiver is performing a blind handover count. Manager reports use their
   * own explicitly authenticated, read-only routes instead.
   *
   * The public IPC boundary calls this before CashboxService. Internal custody
   * reconciliation deliberately calls CashboxService directly inside its
   * controlled state machine, so recovery can snapshot a closed segment without
   * reopening it or leaking that number through the renderer.
   */
  async assertExpectedCashRead(input: { shiftId?: unknown } = {}) {
    const cfg = await configOf(prisma)
    if (!cfg.enabled) return null
    await this.ensureRolledOver()
    const state = await ensureState(prisma)
    if (state.state === 'HANDOVER_PENDING' || state.state === 'HANDOVER_RECOUNT')
      throw new BusinessError('در زمان تحویل صندوق، مبلغ انتظاری نمایش داده نمی‌شود تا شمارش تحویل‌گیرنده مستقل بماند.', 'CUSTODY_EXPECTED_HIDDEN_DURING_HANDOVER')
    if (state.state !== 'ACTIVE' || !state.activeShiftId)
      throw new BusinessError('برای دیدن مبلغ انتظاری، ابتدا یک مسئول فعال صندوق باید با رمز شخصی و شمارش فیزیکی ثبت شود.', 'CUSTODY_EXPECTED_AUTH_REQUIRED')
    if (input.shiftId != null) {
      const requestedShiftId = asSafeId(input.shiftId, 'شناسه نشست صندوق')
      if (requestedShiftId !== state.activeShiftId)
        throw new BusinessError('مبلغ انتظاری فقط برای مسئولیت فعال فعلی صندوق قابل مشاهده است.', 'CUSTODY_EXPECTED_SCOPE')
    }
    return { shiftId: state.activeShiftId, epoch: Number(state.epoch) }
  },

  /** A POS operator who is not the physical drawer custodian must prove their
   * own active custody PIN. This authenticates operation only; it deliberately
   * does not open, transfer, or otherwise change drawer responsibility. */
  async verifySaleOperator(userId: unknown, password: unknown) {
    const operator = await this.verifyPin(userId, password)
    if (operator.role !== 'MANAGER' && operator.role !== 'CASHIER')
      throw new BusinessError('این نقش مجاز به ثبت فروش در صندوق نیست.', 'NO_PERMISSION')
    return { userId: operator.userId, name: operator.displayName, role: operator.role }
  },

  async actorForFinancialOperation(): Promise<CustodyFence | null> {
    const cfg = await configOf(prisma)
    if (!cfg.enabled) return null
    await this.ensureRolledOver()
    const state = await ensureState(prisma)
    /** A custody-enabled sale must never manufacture a fictional owner or a
     * drawer segment. The worker who accepts the physical drawer is the only
     * person who may create an ACTIVE custody segment through open(), an
     * authenticated handover, emergency cover, or the explicit shared-password
     * Master Override workflow. */
    if (state.state === 'NO_SESSION')
      throw new BusinessError('برای ثبت فروش، ابتدا مسئول حاضر صندوق باید با رمز شخصی و شمارش فیزیکی صندوق را تحویل بگیرد.', 'CUSTODY_AUTH_REQUIRED')
    /** Pending is not a lock: all monetary writers keep the outgoing fence and
     * therefore remain attributed to the current custodian. Acceptance moves
     * through the short-lived HANDOVER_RECOUNT state to establish a watermark. */
    if (state.state !== 'ACTIVE' && state.state !== 'HANDOVER_PENDING') {
      if (state.state === 'HANDOVER_RECOUNT') throw new BusinessError('تحویل‌گیرنده در حال شمارش نهایی است؛ چند لحظه بعد فروش را دوباره ثبت کنید.', 'HANDOVER_RECOUNT')
      if (state.state === 'CUSTODIAN_ARCHIVE_FREEZE') throw new BusinessError('آرشیو مسئول فعال صندوق در حال ثبت است؛ تا ایجاد پروندهٔ بازیابی هیچ عملیات مالی انجام ندهید.', 'CUSTODIAN_ARCHIVE_FREEZE')
      throw new BusinessError('برای ادامهٔ فروش، ابتدا مسئول صندوق را مشخص کنید.', 'CUSTODY_AUTH_REQUIRED')
    }
    if (!state.activeShiftId) throw new BusinessError('برای ادامهٔ فروش، ابتدا مسئول صندوق را مشخص کنید.', 'CUSTODY_AUTH_REQUIRED')
    const [shift, meta] = await Promise.all([prisma.shift.findUnique({ where: { id: state.activeShiftId } }), prisma.custodyShiftMeta.findUnique({ where: { shiftId: state.activeShiftId } })])
    if (!shift || shift.closedAt || !shift.userId || !meta || meta.custodianUserId !== shift.userId)
      throw new BusinessError('وضعیت حضانت صندوق ناسازگار است؛ مدیر باید آن را بررسی کند.', 'CUSTODY_INVARIANT_BROKEN')
    return { epoch: Number(state.epoch), expectedShiftId: shift.id, expectedActorUserId: shift.userId }
  },

  /** First statement of every fenced financial transaction.  It intentionally
   * performs a conditional write, rather than a read, to serialize SQLite
   * writers and reject stale requests after handover/close/rollover. */
  async assertFenceInTx(tx: Client, fence: CustodyFence, opts: { allowClosedShift?: boolean } = {}) {
    const changed = await tx.custodyState.updateMany({ where: { key: MAIN, state: { in: ['ACTIVE', 'HANDOVER_PENDING'] }, activeShiftId: fence.expectedShiftId, epoch: fence.epoch }, data: { updatedAt: new Date() } })
    if (changed.count !== 1) throw new BusinessError('صندوق همین حالا تحویل یا بسته شد؛ صفحه را تازه کنید و دوباره تلاش کنید.', 'CUSTODY_STALE')
    const [shift, meta] = await Promise.all([tx.shift.findUnique({ where: { id: fence.expectedShiftId } }), tx.custodyShiftMeta.findUnique({ where: { shiftId: fence.expectedShiftId } })])
    if (!shift || (!opts.allowClosedShift && !!shift.closedAt) || shift.userId !== fence.expectedActorUserId || !meta || meta.custodianUserId !== fence.expectedActorUserId)
      throw new BusinessError('وضعیت مسئول صندوق هم‌زمان تغییر کرد؛ درخواست ثبت نشد.', 'CUSTODY_STALE')
    return shift
  }
}
