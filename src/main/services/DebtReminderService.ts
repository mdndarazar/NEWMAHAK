/**
 * یادآوری نسیه و چک سررسیدشده — فقط هشدار، قفل و پول جابه‌جا نمی‌کند.
 *
 *   • نسیه: فاکتور روزهای قبل که هنوز مانده دارد (سند تعویض نیست).
 *   • چک: PENDING با سررسید امروز یا قبل.
 *   • بستن = همین نشست/شیفت دیگر نشان داده نشود.
 *   • سه شیفت اول: همان لحظهٔ باز بودن شیفت.
 *   • بعد: هر هفته یک‌بار در هر شماره شیفت، حوالی وسط بازهٔ شیفت.
 */
import { prisma } from '../db/client'
import { SETTING_KEYS, parseShiftConfig, minutesOfTime, type ShiftTemplate } from '@shared/receipt'
import { jalaliToday, jalaliEndOfDay, faDigits } from '@shared/jalali'
import { toNumberRial } from '@shared/money'
import { remainingOf } from '@shared/settlement'
import { debtAdjustmentsByInvoice, adjustmentsOrEmpty } from './invoiceDebt'
import { shiftService } from './ShiftService'
import { ChequeStatus, PaymentEntryKind, OrderType, SaleStatus } from '@shared/enums'

export interface DebtReminderDismiss {
  shiftId: number
  shiftNumber: number
  dayJalali: string
  at: number
}

export interface DebtReminderDue {
  show: boolean
  dismissed: boolean
  phase: 'first' | 'weekly' | 'hidden'
  nasiyehCount: number
  chequeCount: number
  nasiyehRemaining: number
  chequeAmount: number
  message: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const FIRST_SHIFTS = 3
const LOG_CAP = 90

const isReceived = (p: { kind?: string | null; chequeStatus?: string | null }) =>
  (p.kind ?? PaymentEntryKind.CASH) !== PaymentEntryKind.CHEQUE || p.chequeStatus === ChequeStatus.CLEARED

function parseLog(raw: unknown): DebtReminderDismiss[] {
  let obj: any = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return [] }
  }
  const rows = Array.isArray(obj) ? obj : Array.isArray(obj?.dismisses) ? obj.dismisses : []
  const out: DebtReminderDismiss[] = []
  for (const r of rows) {
    const shiftId = Math.round(Number(r?.shiftId ?? 0))
    const shiftNumber = Math.round(Number(r?.shiftNumber ?? 0))
    const dayJalali = String(r?.dayJalali ?? '')
    const at = Math.round(Number(r?.at ?? 0))
    if (!Number.isFinite(at) || at <= 0) continue
    out.push({ shiftId, shiftNumber, dayJalali, at })
  }
  return out.slice(-LOG_CAP)
}

/** وسط بازهٔ شیفت به دقیقه از نیمه‌شب. شیفت شبانه (پایان ≤ شروع) از نیمه‌شب رد می‌شود. */
export function midShiftMinutes(startTime: string, endTime: string): number {
  const a = minutesOfTime(startTime)
  let b = minutesOfTime(endTime)
  if (b <= a) b += 24 * 60
  return Math.floor((a + b) / 2) % (24 * 60)
}

export function minutesOfDate(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

export function templateForShift(
  templates: ShiftTemplate[],
  shift: { name?: string | null; number?: number | null; slotNumber?: number | null }
): ShiftTemplate | null {
  if (!templates.length) return null
  const slot = shift.slotNumber != null ? Number(shift.slotNumber) : Number(shift.number ?? 0)
  if (slot >= 1 && slot <= templates.length) return templates[slot - 1] ?? null
  const name = String(shift.name ?? '').trim()
  if (name) {
    const hit = templates.find((t) => t.name === name)
    if (hit) return hit
  }
  return templates[0] ?? null
}

/**
 * آیا هشدار الان نشان داده شود؟
 *   dismissed همین شیفت → نه
 *   کمتر از ۳ بار بسته شده → بله (فاز اول، همان لحظه)
 *   فاز هفتگی: از آخرین بستنِ همین شماره شیفت ۷ روز گذشته و ساعت از وسط شیفت رد شده
 */
export function decideDebtReminderShow(input: {
  overdueCount: number
  shiftId: number
  shiftNumber: number
  now: Date
  midMinutes: number | null
  dismisses: DebtReminderDismiss[]
}): { show: boolean; dismissed: boolean; phase: DebtReminderDue['phase'] } {
  if (input.overdueCount <= 0) return { show: false, dismissed: false, phase: 'hidden' }
  if (input.dismisses.some((d) => d.shiftId === input.shiftId && input.shiftId !== 0))
    return { show: false, dismissed: true, phase: 'hidden' }
  if (input.shiftId === 0 && input.dismisses.some((d) => d.shiftId === 0 && d.dayJalali === jalaliToday()))
    return { show: false, dismissed: true, phase: 'hidden' }

  if (input.dismisses.length < FIRST_SHIFTS)
    return { show: true, dismissed: false, phase: 'first' }

  const lastSame = input.dismisses.filter((d) => d.shiftNumber === input.shiftNumber).sort((a, b) => b.at - a.at)[0]
  if (lastSame && input.now.getTime() - lastSame.at < WEEK_MS)
    return { show: false, dismissed: false, phase: 'weekly' }

  if (input.midMinutes != null) {
    const nowMin = minutesOfDate(input.now)
    if (nowMin < input.midMinutes)
      return { show: false, dismissed: false, phase: 'weekly' }
  }
  return { show: true, dismissed: false, phase: 'weekly' }
}

async function readLog(): Promise<DebtReminderDismiss[]> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.debtReminderLog } })
  return parseLog(row?.value ?? null)
}

async function writeLog(dismisses: DebtReminderDismiss[]): Promise<void> {
  const keep = dismisses.slice(-LOG_CAP)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.debtReminderLog },
    create: { key: SETTING_KEYS.debtReminderLog, value: JSON.stringify({ dismisses: keep }) },
    update: { value: JSON.stringify({ dismisses: keep }) }
  })
}

async function overdueNasiyeh(today: string): Promise<{ count: number; remaining: number }> {
  const invoices = await prisma.saleInvoice.findMany({
    where: {
      voidedAt: null,
      status: { notIn: [SaleStatus.DRAFT, SaleStatus.CANCELED] },
      orderType: { not: OrderType.EXCHANGE },
      issuedAtJalali: { lt: today }
    },
    select: { id: true, grandTotal: true, paidTotal: true },
    take: 2000,
    orderBy: { id: 'asc' }
  })
  const candidates = invoices.filter((inv) => toNumberRial(inv.paidTotal) < toNumberRial(inv.grandTotal) || toNumberRial(inv.paidTotal) === 0)
  if (!candidates.length) return { count: 0, remaining: 0 }
  const ids = candidates.map((i) => i.id)
  const adjs = await debtAdjustmentsByInvoice(prisma, ids)
  const pays = await prisma.payment.findMany({
    where: { invoiceId: { in: ids }, voidedAt: null },
    select: { invoiceId: true, amount: true, kind: true, chequeStatus: true }
  })
  const receivedBy = new Map<number, number>()
  for (const p of pays) {
    const add = isReceived(p) ? Math.max(0, toNumberRial(p.amount)) : 0
    receivedBy.set(p.invoiceId, (receivedBy.get(p.invoiceId) ?? 0) + add)
  }
  let count = 0
  let remaining = 0
  for (const inv of candidates) {
    const adj = adjustmentsOrEmpty(adjs, inv.id)
    const d = remainingOf({
      grandTotal: toNumberRial(inv.grandTotal),
      received: receivedBy.get(inv.id) ?? 0,
      returnedValue: adj.returnedValue,
      refundFromReceived: adj.refundFromReceived
    })
    if (d.remaining > 0) {
      count++
      remaining += d.remaining
    }
  }
  return { count, remaining }
}

async function overdueCheques(today: string): Promise<{ count: number; amount: number }> {
  const end = jalaliEndOfDay(today)
  const rows = await prisma.payment.findMany({
    where: {
      voidedAt: null,
      kind: PaymentEntryKind.CHEQUE,
      chequeStatus: ChequeStatus.PENDING,
      OR: [
        { dueDate: { lte: end } },
        { AND: [{ dueDate: null }, { dueDateJalali: { lte: today } }] }
      ]
    },
    select: { amount: true },
    take: 2000
  })
  return {
    count: rows.length,
    amount: rows.reduce((s, r) => s + Math.max(0, toNumberRial(r.amount)), 0)
  }
}

function buildMessage(nCount: number, cCount: number, nRem: number, cAmt: number): string {
  const bits: string[] = []
  if (nCount) bits.push(`${faDigits(nCount)} فاکتور نسیه (مانده ${faDigits(nRem)} ریال)`)
  if (cCount) bits.push(`${faDigits(cCount)} چک سررسیدشده (جمع ${faDigits(cAmt)} ریال)`)
  if (!bits.length) return ''
  return 'موعد پرداخت گذشته و هنوز تسویه نشده: ' + bits.join(' · ') + '. این فقط یادآوری است.'
}

export const debtReminderService = {
  async due(now = new Date()): Promise<DebtReminderDue> {
    const today = jalaliToday()
    const [nasiyeh, cheques, dismisses, open, shiftRow] = await Promise.all([
      overdueNasiyeh(today),
      overdueCheques(today),
      readLog(),
      shiftService.anyOpenShift(prisma),
      prisma.setting.findUnique({ where: { key: SETTING_KEYS.shiftConfig } })
    ])
    const overdueCount = nasiyeh.count + cheques.count
    const hidden: DebtReminderDue = {
      show: false,
      dismissed: false,
      phase: 'hidden',
      nasiyehCount: nasiyeh.count,
      chequeCount: cheques.count,
      nasiyehRemaining: nasiyeh.remaining,
      chequeAmount: cheques.amount,
      message: buildMessage(nasiyeh.count, cheques.count, nasiyeh.remaining, cheques.amount)
    }
    if (overdueCount <= 0) return hidden

    const shiftId = open?.id ?? 0
    const shiftNumber = open?.number ?? 0
    const cfg = parseShiftConfig(shiftRow?.value ?? null)
    const tpl = open ? templateForShift(cfg.templates, open) : null
    const mid = tpl ? midShiftMinutes(tpl.startTime, tpl.endTime) : null
    const gate = decideDebtReminderShow({
      overdueCount,
      shiftId,
      shiftNumber,
      now,
      midMinutes: mid,
      dismisses
    })
    return {
      ...hidden,
      show: gate.show,
      dismissed: gate.dismissed,
      phase: gate.phase,
      message: gate.show ? hidden.message : hidden.message
    }
  },

  async dismiss(input: { userId?: number | null } = {}): Promise<DebtReminderDue> {
    const open = await shiftService.anyOpenShift(prisma)
    const today = jalaliToday()
    const log = await readLog()
    const shiftId = open?.id ?? 0
    if (shiftId !== 0 && log.some((d) => d.shiftId === shiftId)) return this.due()
    if (shiftId === 0 && log.some((d) => d.shiftId === 0 && d.dayJalali === today)) return this.due()
    log.push({
      shiftId,
      shiftNumber: open?.number ?? 0,
      dayJalali: today,
      at: Date.now()
    })
    await writeLog(log)
    void input
    return this.due()
  }
}
