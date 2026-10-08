/**
 * ===========================================================================
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۲ — سرویس «نمای تشخیص پل تطبیق».
 *
 * ── قوانین سخت (همه از طرح + رکان فاز ۰ آمده‌اند) ──────────────────────────
 *   R3  نما هیچ محاسبه‌ی جدید ندارد: ردیف‌ها/جمع/هدف/باقیمانده دقیقاً همان
 *       متادیتای «خالصمحاسبه‌شده»‌ی reportRows است؛ این سرویس فقط *نشان* می‌دوزد.
 *   R2  هر فراخوانی، reportRows را با `withDrillDown: true` دوباره می‌خواند —
 *       هیچ کش/بافری در این سرویس نیست (بنر staleness با computedAtIso است).
 *   R10 open *همیشه* رمز تازه می‌خواهد (`assertPanelUnlockedStrict`) حتی اگر
 *       قفل پنل خاموش باشد؛ منابع/یادداشت‌ها فقط نشست باز می‌خواهند.
 *   R18 یادداشت‌ها متن خالص‌اند (بدون HTML) و در AuditLog با
 *       `auditOrThrow` (fail-closed) می‌نشینند؛ حذف/ویرایش ندارند.
 *   R8  ردیف‌های `prior*` عمداً «قبل از بازه»‌اند ⇒ هرگز نشان تاریخ نمی‌خورند.
 *   R9  منابع فقط در خودِ این نما (withDrillDown/bridgeSourceKey) خوانده
 *       می‌شوند؛ هیچ رفتار جدیدی به کانال‌های گزارش فعلی اضافه نمی‌شود.
 * ===========================================================================
 */
import { BusinessError } from '../errors'
import { prisma } from '../db/client'
import type { SaleReportFilter } from '@shared/types'
import {
  annotateBridge,
  flagSourceDate,
  type BridgeDiagFlag,
  type BridgeDiagRow as AnnotatedBridgeRow
} from '@shared/bridgeDiagnostics'
import type {
  BridgeDiagOpenResponse,
  BridgeDiagView,
  BridgeDiagNote,
  BridgeDiagRow,
  BridgeDiagRowSources,
  BridgeDiagSourcesResponse,
  BridgeDiagNotesResponse,
  BridgeDiagNoteAddResponse
} from '@shared/types'
import { PANEL_KEYS } from '@shared/panels'
import {
  assertPanelUnlocked,
  assertPanelUnlockedStrict,
  panelSessionTtlMs
} from './panelSession'
import { auditOrThrow } from './AuditService'
import { salesService } from './SalesService'
import { shiftService } from './ShiftService'

const PANEL = PANEL_KEYS.bridgeDiagnostics

/** حداکثر طول یک یادداشت مدیر (طرح فاز ۴ — «مالی نامقصرترین محتوا»). */
const NOTE_MAX = 300

const NOTE_ENTITY = 'BridgeDiagNote'
const NOTE_ACTION = 'BRIDGE_DIAG_NOTE_ADD'

/** فقط فیلدهایی که واقعاً saleWhere/orderTypeWhere می‌خوانند — زیرمجموعه‌ی SaleReportFilter. */
export function cleanScope(raw: Record<string, unknown> | null | undefined): SaleReportFilter {
  const p: any = raw ?? {}
  const out: any = {}
  const KEYS = [
    'fromJalali', 'toJalali', 'from', 'to', 'fullRange',
    'shiftId', 'status', 'userId', 'customerId', 'customerSearch',
    'invoiceIds', 'onlyNotConsolidated', 'productSearch', 'receiptNo', 'returnCode',
    'channels', 'orderType'
  ] as const
  for (const k of KEYS) {
    const v = p[k]
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out as SaleReportFilter
}

type LoadedBridge = {
  rows: BridgeDiagRow[]
  bridge: { target: number; explainedTotal: number; unexplained: number; balanced: boolean }
  guide: BridgeDiagFlag[]
  period: { fromJalali: string | null; toJalali: string | null; source?: string } | null
  warnings: string[]
}

/** از reportRows می‌خواند + نشان‌ها را به ردیف‌ها می‌دوزد (فاز ۱-module خالص). */
async function loadBridge(scope: SaleReportFilter): Promise<LoadedBridge> {
  const res: any = await salesService.reportRows({ ...(scope as any), withDrillDown: true })
  const acc = res?.accounting
  const bridge = acc?.bridge
  if (!bridge?.rows?.length) throw new BusinessError('پل تطبیق برای این بازه در دسترس نیست. لطفاً گزارش را باز کنید.')
  const period = acc?.period ?? null
  const guide = annotateBridge({
    rows: bridge.rows,
    target: bridge.target,
    explainedTotal: bridge.explainedTotal,
    unexplained: bridge.unexplained,
    balanced: bridge.balanced
  })
  const rows: BridgeDiagRow[] = guide.rows.map((r: AnnotatedBridgeRow): BridgeDiagRow => {
    const row: BridgeDiagRow = { ...(r as BridgeDiagRow) }
    if (!row.key.startsWith('prior') && period?.fromJalali) {
      const flagged: string[] = []
      for (const s of row.sources ?? []) {
        const f = flagSourceDate(s as any, { fromJalali: period.fromJalali, toJalali: period.toJalali ?? '?' })
        if (f) flagged.push(f.text)
      }
      if (flagged.length)
        row.flags = [
          ...row.flags,
          {
            code: 'date',
            text: flagged.length > 1 ? `${flagged[0]} (و ${flagged.length - 1} سند دیگر)` : flagged[0],
            certainty: 'TENTATIVE' as const
          } satisfies BridgeDiagFlag
        ]
    }
    return row
  })
  return {
    rows,
    bridge: {
      target: bridge.target,
      explainedTotal: bridge.explainedTotal,
      unexplained: bridge.unexplained,
      balanced: bridge.balanced
    },
    guide: guide.guide,
    period,
    warnings: Array.isArray(res?.warnings) ? res.warnings : []
  }
}

/** کلید ثابت دوره از روی متادیتای گزارش (برای TEU یادداشت‌ها). */
function periodKey(period: { fromJalali: string | null; toJalali: string | null } | null | undefined): string {
  return `${period?.fromJalali ?? '?'}/${period?.toJalali ?? '?'}`
}

/** یادداشت‌های همین دوره را از AuditLog می‌خواند (خواندن-فقط، بدون باگ-supportی تاریخ). */
async function loadNotes(pkey: string): Promise<BridgeDiagNote[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: NOTE_ENTITY, action: NOTE_ACTION },
    orderBy: { id: 'asc' },
    take: 200
  })
  const actorIds = Array.from(new Set(rows.map((r) => r.userId).filter((x): x is number => typeof x === 'number')))
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
    : []
  const nameOf = new Map<number, string>(actors.map((a) => [a.id, a.displayName]))
  const out: BridgeDiagNote[] = []
  for (const r of rows) {
    let periodOf = ''
    let text = ''
    try {
      const after = r.after ? (JSON.parse(String(r.after)) as { periodKey?: string; text?: string }) : {}
      periodOf = String(after.periodKey ?? '')
      text = String(after.text ?? '')
    } catch {
      continue
    }
    if (periodOf !== pkey) continue
    if (!text) continue
    out.push({
      id: r.id,
      createdAtIso: r.at ? r.at.toISOString() : new Date(0).toISOString(),
      actorLabel:
        (typeof r.userId === 'number' && nameOf.get(r.userId)) || (typeof r.userId === 'number' ? `کاربر #${r.userId}` : 'نامشخص'),
      text
    })
  }
  return out
}

export const bridgeDiagnosticsService = {
  /**
   * کانال باز: همیشه رمز تازه می‌خواهد (strict). بدون رمز ⇒ BusinessError
   * با پیام واضح؛ بعد از باز شدن، نشست با TTL ماژول panelSession نگه می‌دارد.
   */
  async open(rawScope: Record<string, unknown> | null | undefined, password: string | null | undefined): Promise<BridgeDiagOpenResponse> {
    const scope = cleanScope(rawScope)
    await assertPanelUnlockedStrict(PANEL, password, 'باز کردن نمای تشخیص پل تطبیق')
    const { rows, bridge, guide, period } = await loadBridge(scope)
    const pkey = periodKey(period)
    const notes = await loadNotes(pkey)
    const view: BridgeDiagView = {
      period: {
        fromJalali: period?.fromJalali ?? null,
        toJalali: period?.toJalali ?? null,
        source: (period as any)?.source ?? 'none'
      } as any,
      computedAtIso: new Date().toISOString(),
      bridge,
      guide,
      rows,
      notes
    }
    return { ok: true, view }
  },

  /** منابع یک ردیف؛ فقط با نشست باز. نمای prior هیچ‌وقت نشان تاریخ نمی‌گیرد. */
  async sources(
    rawScope: Record<string, unknown> | null | undefined,
    rowKey: string,
    skip: number = 0,
    take: number = 200
  ): Promise<BridgeDiagSourcesResponse> {
    const scope = cleanScope(rawScope)
    await assertPanelUnlocked(PANEL, 'دیدن منابع ردیف‌های نمای تشخیص پل')
    const key = String(rowKey ?? '')
    if (!key) throw new BusinessError('ردیفی انتخاب نشده است.')
    const res: any = await salesService.reportRows({
      ...(scope as any),
      withDrillDown: true,
      bridgeSourceKey: key,
      bridgeSourceSkip: Math.max(0, Math.round(Number(skip) || 0)),
      bridgeSourceTake: Math.max(1, Math.min(200, Math.round(Number(take) || 200)))
    })
    const acc = res?.accounting
    const bridge = acc?.bridge
    if (!bridge?.rows?.length) throw new BusinessError('پل تطبیق برای این بازه در دسترس نیست.')
    const row = (bridge.rows as any[]).find((r) => r?.key === key)
    if (!row) throw new BusinessError(`ردیف «${key}» در پل این بازه نیست.`)
    const period = acc?.period ?? null
    const sources = (row.sources ?? []).map((s: any) => {
      const flags: BridgeDiagFlag[] = []
      if (!key.startsWith('prior') && period?.fromJalali) {
        const f = flagSourceDate(s, { fromJalali: period.fromJalali, toJalali: period.toJalali ?? '?' })
        if (f) flags.push(f)
      }
      return { ...s, flags }
    })
    const result: BridgeDiagRowSources = {
      rowKey: key,
      rowLabel: row.label ?? key,
      sources,
      totalCount: typeof row.sourcesPage?.totalCount === 'number' ? row.sourcesPage.totalCount : null
    }
    return { ok: true, result }
  },

  /** لیست یادداشت‌های همین دوره (با نشست باز، بدون رمز دوم). */
  async notes(rawScope: Record<string, unknown> | null | undefined): Promise<BridgeDiagNotesResponse> {
    const scope = cleanScope(rawScope)
    await assertPanelUnlocked(PANEL, 'دیدن یادداشت‌های نمای تشخیص پل')
    // periodKey باید دقیقاً همان دوره‌ی open باشد — لذا period را از همان متادیتا می‌گیریم.
    const res: any = await salesService.reportRows({ ...(scope as any), withDrillDown: false })
    const period = res?.accounting?.period ?? null
    const notes = await loadNotes(periodKey(period))
    return { ok: true, notes }
  },

  /**
   * فاز ۴ — یادداشت مدیر. متن خالص، حداکثر ۳۰۰ کاراکتر، fail-closed.
   * actor از نشست باز می‌آید (همان currentStaffId جلسه‌ی رسمی — هر دو طرح).
   */
  async noteAdd(
    rawScope: Record<string, unknown> | null | undefined,
    text: string | null | undefined
  ): Promise<BridgeDiagNoteAddResponse> {
    const scope = cleanScope(rawScope)
    await assertPanelUnlocked(PANEL, 'ثبت یادداشت در نمای تشخیص پل')
    const raw = String(text ?? '').trim()
    if (!raw) throw new BusinessError('متن یادداشت خالی است.')
    if (raw.length > NOTE_MAX) throw new BusinessError(`یادداشت نمی‌تواند بیش از ${NOTE_MAX} کاراکتر باشد (الان ${raw.length} است).`)
    const res: any = await salesService.reportRows({ ...(scope as any), withDrillDown: false })
    const period = res?.accounting?.period ?? null
    const pkey = periodKey(period)
    const actorId = await shiftService.currentStaffId()
    await auditOrThrow(prisma, {
      action: NOTE_ACTION,
      entity: NOTE_ENTITY,
      userId: actorId ?? null,
      after: JSON.stringify({ periodKey: pkey, text: raw })
    })
    return {
      ok: true,
      note: {
        id: -1 /* سطر نوشته‌شده id واقعی ندارد روی IPC؛ کلاینت با notes() تازه می‌خواند */,
        createdAtIso: new Date().toISOString(),
        actorLabel: actorId == null ? 'نامشخص' : (await prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } }))?.displayName ?? `کاربر #${actorId}`,
        text: raw
      }
    }
  },

  /** کمک‌رسان تست: TTL فعلی نشست — برای چک «منقضی شد» در تست. */
  sessionTtlMs(): number {
    return panelSessionTtlMs()
  }
}
