import { prisma } from '../db/client'
import type { Prisma } from '@prisma/client'
import { audit } from './AuditService'
/**
 * نشست ۱۵۴ (S151-b) — گیت‌های رمز سمت سرور. AuthService خودش SettingsService را
 * import نمی‌کند (فقط db/client، AuditService، errors، PanelVault و shared)، پس چرخه‌ای ساخته نمی‌شود.
 */
import { assertManagerPassword, assertPanelPassword, assertPanelPasswordStrict } from './AuthService'
import { BusinessError } from '../errors'
// نشست ۲۲۲ · فاز ۵ — دروازه‌ی روشن‌کردن مسیر RAW (بخش ۷.۱ طرح)
import { assertRawMethodAllowed } from '../print/raw/gate'
import { applyPanelSessionTtlMinutes } from './panelSession'
import { TX_OPTIONS } from '../db/tx'
import { PANEL_KEYS } from '@shared/panels'
import { AuditAction } from '@shared/enums'
import { toClock, toJalaliDate } from '@shared/jalali'
import {
  SETTING_KEYS,
  parseLabelTemplate,
  parseReceiptTemplate,
  parseSaleDefaults,
  parseSecurityConfig,
  parseShiftConfig,
  parseCustodyConfig,
  parseOfficialTimeConfig,
  applyOfficialOffset,
  parseAccountingPolicy,
  DEFAULT_ACCOUNTING_POLICY,
  type AccountingPolicy,
  type LabelTemplate,
  type ReceiptTemplate,
  type SaleDefaults,
  type SecurityConfig,
  type ShiftConfig,
  type CustodyConfig,
  type OfficialTimeConfig
} from '@shared/receipt'
import {
  DEFAULT_CREDIT_SETTINGS,
  describeCreditSettings,
  parseCreditSettings,
  type CreditSettings
} from '@shared/credit'
// بند ۷ (جلسه ۳۱) — تصمیم *نمایشی* ارث‌بری لوگو (بخش ۱۰)، نه قاعده‌ی مالی
import { receiptLogoForSave, receiptLogoInherit } from '@shared/creditUi'
import {
  DEFAULT_DISCOUNT_POLICY,
  describeDiscountPolicy,
  parseDiscountPolicy,
  type DiscountPolicy
} from '@shared/priceAdjust'
import {
  CHARGE_KINDS,
  CHARGE_SCOPES,
  chargeSettingKey,
  chargeTitle,
  LEGACY_CHARGE_KEYS,
  parseCategoryCharge,
  type CategoryChargeConfig,
  type ChargeKind,
  type ChargeScope
} from '@shared/charges'

/**
 * ---------------------------------------------------------------------------
 * پنل تنظیمات: قالب فاکتور چاپی، پیش‌فرض‌های فروش، شیفت‌ها، و عوارض/حق سرویس.
 *
 * ذخیره‌سازی روی همان جدول ساده‌ی `Setting` (کلید → مقدار JSON) انجام می‌شود،
 * پس افزودن یک گزینه‌ی تنظیمات جدید هیچ migration ای لازم ندارد. خواندن همیشه
 * از `parse*` رد می‌شود تا مقدار خراب یا ناقص، برنامه را زمین نزند و به
 * پیش‌فرض‌ها برگردد.
 *
 * عوارض و مالیات / حق سرویس (بازنویسی‌شده):
 *   چهار کلید مستقل داریم — دو پنل × دو اسکوپ:
 *     charges.tax.pos · charges.service.pos · charges.tax.wholesale · charges.service.wholesale
 *   پس تنظیمات «پنل فروش خرد» و «فاکتور فروش عمده» هیچ اثری روی هم ندارند.
 *
 * مهاجرت یک‌باره (`migrateChargeKey`): اگر کلید اسکوپ‌دار هنوز وجود نداشته باشد،
 * مقدارش از داده‌ی قدیمی ساخته می‌شود:
 *   ۱) کلید قدیمی و بی‌اسکوپ `charges.tax` / `charges.service` (قواعد دسته‌بندی
 *      که کاربر قبلاً در پنل وارد کرده بود) — عیناً برای هر دو اسکوپ کپی می‌شود.
 *   ۲) و اگر آن هم نبود، درصد سراسری منسوخِ `sale.defaults.taxPercent` /
 *      `serviceChargePercent` به‌عنوان «مقدار پیش‌فرض همه‌ی کالاها» (fallback)
 *      منتقل می‌شود — فقط برای اسکوپ pos، چون آن تنظیم هم فقط در پنل فروش
 *      واقعاً کار می‌کرد و در فاکتور عمده مالیات هاردکد صفر بود.
 * بعد از مهاجرت، هیچ‌جای برنامه دیگر آن دو درصد سراسری را نمی‌خواند.
 * ---------------------------------------------------------------------------
 */
export interface ScopedCharges {
  tax: CategoryChargeConfig
  service: CategoryChargeConfig
}

export interface ChargesBundle {
  pos: ScopedCharges
  wholesale: ScopedCharges
}

export interface SettingsBundle {
  receipt: ReceiptTemplate
  sale: SaleDefaults
  shift: ShiftConfig
  /**
   * تنظیمات چاپ لیبل (مورد ۵ و ۸) — کاملاً مستقل از `receipt`:
   * چاپگر لیبل‌زن، ابعاد لیبل و اجزای روی لیبل.
   */
  label: LabelTemplate
  /** عوارض و مالیات / حق سرویس، تفکیک‌شده برای هر پنل */
  charges: ChargesBundle
  /**
   * تنظیمات امنیتی «قفل موقت بعد از رمز اشتباه» (بخش ۲).
   * خواندنش از همان کلید `security.config` است که `AuthService` هم می‌خواند،
   * پس فرم تنظیمات و منطق قفل هیچ‌وقت دو مقدار متفاوت نمی‌بینند.
   */
  security: SecurityConfig
  /**
   * بند ۳ — سیاست تخفیف پنل فروش (آزاد / فقط تخفیف ثابت / غیرفعال).
   * داخل همین bundle است تا پنل فروش با همان یک رفت‌و‌برگشتِ همیشگی‌اش آن را
   * هم بگیرد و لازم نباشد یک درخواست اضافه در مسیر حساسِ «باز شدن پنل فروش»
   * بنشیند.
   */
  discount: DiscountPolicy
  credit: CreditSettings
  /**
   * جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی» (افست دستی ساعت کشور).
   * صفر = رفتار مو‌به‌موی قبل؛ فقط برای انعطاف در برابر تغییرات آینده است.
   */
  time: OfficialTimeConfig
}

async function readKey(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function writeKey(
  key: string,
  value: unknown,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const json = JSON.stringify(value)
  await client.setting.upsert({ where: { key }, update: { value: json }, create: { key, value: json } })
}

const normalizeKind = (k: unknown): ChargeKind => (k === 'service' ? 'service' : 'tax')
const normalizeScope = (s: unknown): ChargeScope => (s === 'wholesale' ? 'wholesale' : 'pos')

/**
 * نشست ۱۵۵ (S151-c1، یافته‌ی Y10، بند ۴-۳۹) — کلید قفل پنلِ هر ترکیب نوع/اسکوپ عوارض.
 * همان کلیدهایی که صفحه‌ی CategoryCharges با `ManagerGate` می‌پوشاند؛ حالا سرور هم.
 */
function chargePanelKey(kind: ChargeKind, scope: ChargeScope): string {
  if (scope === 'wholesale') return kind === 'service' ? PANEL_KEYS.chargesServiceWholesale : PANEL_KEYS.chargesTaxWholesale
  return kind === 'service' ? PANEL_KEYS.chargesServicePos : PANEL_KEYS.chargesTaxPos
}

/** مقایسه‌ی «تغییر» بر پایه‌ی مقدار نرمال‌شده (نه متن خام) تا ارسال همان مقدار قبلی رمز نخواهد. */
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Server-side integrity for canonical Shift Settings. Renderer hints are for
 * usability only; direct IPC calls cannot create overlapping schedules or
 * assign inactive/non-operational staff. */
async function assertCanonicalShiftSchedule(config: ShiftConfig): Promise<void> {
  const active = config.templates.filter((template) => template.isActive)
  if (active.some((template) => template.daysMask <= 0))
    throw new BusinessError('برای هر شیفت فعال دست‌کم یک روز برنامه را انتخاب کنید.')
  const names = active.map((template) => template.name.trim())
  if (new Set(names).size !== names.length)
    throw new BusinessError('نام شیفت‌های فعال باید یکتا باشد تا سابقه و گزارش شیفت مبهم نشود.')
  if (config.custodyModeConfigured && config.custodyMode === 'MULTI_SHIFT' && !active.some((template) => template.staffIds.length > 0))
    throw new BusinessError('برای حالت چندشیفت، دست‌کم یک شیفت فعال با کارمند برنامه‌ریزی‌شده لازم است.')
  if (config.custodyModeConfigured && config.custodyMode === 'SINGLE_SHIFT' && !config.singleShiftCustodianUserId)
    throw new BusinessError('برای تک‌شیفت، مسئول اصلی روزانه را از کارکنان فعال انتخاب کنید.')

  const requestedStaffIds = [
    ...new Set([
      ...active.flatMap((template) => template.staffIds),
      ...(config.singleShiftCustodianUserId ? [config.singleShiftCustodianUserId] : [])
    ])
  ]
  if (requestedStaffIds.length) {
    const users = await prisma.user.findMany({ where: { id: { in: requestedStaffIds } }, select: { id: true, isActive: true, role: true } })
    if (users.length !== requestedStaffIds.length || users.some((user) => !user.isActive || (user.role !== 'MANAGER' && user.role !== 'CASHIER')))
      throw new BusinessError('کارمند برنامه‌ریزی‌شده باید مدیر یا صندوقدارِ فعال باشد.')
  }

  const toMinute = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return hour * 60 + minute
  }
  const intervalsOf = (template: ShiftConfig['templates'][number]) => {
    const startMinute = toMinute(template.startTime)
    const endMinute = toMinute(template.endTime)
    const duration = ((endMinute - startMinute + 1440) % 1440) || 1440
    const out: Array<{ from: number; to: number }> = []
    // one preceding and one following week expose every overnight boundary.
    for (let day = -7; day < 14; day++) {
      const weekday = ((day % 7) + 7) % 7
      if ((template.daysMask & (1 << weekday)) !== 0) out.push({ from: day * 1440 + startMinute, to: day * 1440 + startMinute + duration })
    }
    return out
  }
  for (let left = 0; left < active.length; left++) {
    const a = intervalsOf(active[left])
    for (let right = left + 1; right < active.length; right++) {
      const b = intervalsOf(active[right])
      if (a.some((one) => b.some((two) => one.from < two.to && two.from < one.to)))
        throw new BusinessError(`بازهٔ شیفت‌های «${active[left].name}» و «${active[right].name}» هم‌پوشانی دارد.`)
    }
  }
}

/**
 * نشست ۱۵۶ (S151-c2، بند ۴-۴۵) — قانون value=0 ذخیره می‌ماند: یعنی «عمداً صفر» و از
 * والد ارث نمی‌برد. «تنظیم‌نشده» = نبودِ قانون. (قبلاً صفرها حذف می‌شدند ⇒ ارث بی‌صدا از والد.)
 * مقدار پیش‌فرض صفر همان «بدون پیش‌فرض» است (هر دو مبلغ صفر می‌دهند).
 */
/** These three values decide who may begin a custody segment.  They never go
 * through the broad settings bundle: changing them has a dedicated atomic
 * workflow that also reconciles the old custody.config mode. */
function sameCustodySchedulingPolicy(a: ShiftConfig, b: ShiftConfig): boolean {
  return (
    a.custodyMode === b.custodyMode &&
    a.custodyModeConfigured === b.custodyModeConfigured &&
    a.singleShiftCustodianUserId === b.singleShiftCustodianUserId
  )
}

function cleanCharge(config: unknown): CategoryChargeConfig {
  const clean = parseCategoryCharge(config)
  if (clean.fallback && clean.fallback.value <= 0) clean.fallback = null
  return clean
}

export const settingsService = {
  /**
   * بند ۷ (جلسه ۳۱) — §۱۳: قالب رسید حالا سه فیلد لوگو دارد
   * (`showLogo`/`logoHeightMm`/`logoDataUrl`) و سند اعتبار از همین‌ها لوگو
   * می‌گیرد. `logoDataUrl` معمولاً خالی است و از لوگوی *لیبل* — که کاربر یک بار
   * آپلود کرده و مشترک همه‌ی قالب‌هاست — ارث می‌برد (`receiptLogoInherit`).
   * قرینه‌اش در `saveBundle` است: مقدار ارث‌بری‌شده دوباره ذخیره نمی‌شود.
   */
  async receiptTemplate(): Promise<ReceiptTemplate> {
    const tpl = parseReceiptTemplate(await readKey(SETTING_KEYS.receiptTemplate))
    const label = await this.labelTemplate()
    return { ...tpl, logoDataUrl: receiptLogoInherit(tpl.logoDataUrl, label.logoDataUrl) }
  },

  async saleDefaults(): Promise<SaleDefaults> {
    return parseSaleDefaults(await readKey(SETTING_KEYS.saleDefaults))
  },

  async shiftConfig(): Promise<ShiftConfig> {
    return parseShiftConfig(await readKey(SETTING_KEYS.shiftConfig))
  },

  /**
   * The only writer for custody scheduling policy.  The earlier product had
   * two mode fields (`shift.config` and `custody.config`) and a checkbox could
   * update only one of them while a drawer was open.  This deliberately
   * reconciles both fields in one database transaction.  An open responsibility
   * segment is fenced, preserved unchanged, then resumed with a new epoch;
   * financial writers holding the old epoch fail closed instead of slipping
   * across the policy boundary.
   */
  async saveCustodySchedulingWorkflow(input: { shift?: unknown; reason?: unknown; userId?: number | null }): Promise<ShiftConfig> {
    const submitted = parseShiftConfig(input?.shift)
    const next: ShiftConfig = {
      ...submitted,
      custodyModeConfigured: true,
      // A primary daily custodian belongs only to the single-shift workflow.
      singleShiftCustodianUserId: submitted.custodyMode === 'SINGLE_SHIFT' ? submitted.singleShiftCustodianUserId : null
    }
    await assertCanonicalShiftSchedule(next)
    const reason = String(input?.reason ?? '').trim()

    return prisma.$transaction(async (tx) => {
      const [shiftRow, custodyRow, existingState] = await Promise.all([
        tx.setting.findUnique({ where: { key: SETTING_KEYS.shiftConfig } }),
        tx.setting.findUnique({ where: { key: SETTING_KEYS.custodyConfig } }),
        tx.custodyState.findUnique({ where: { key: 'MAIN' } })
      ])
      const beforeShift = parseShiftConfig(shiftRow?.value ?? null)
      const beforeCustody = parseCustodyConfig(custodyRow?.value ?? null)
      // A pre-workflow installation keeps its historic custody-config decision
      // until this explicit manager workflow has recorded the reconciliation.
      const beforeMode = beforeShift.custodyModeConfigured ? beforeShift.custodyMode : beforeCustody.mode
      const policyChanged = !sameCustodySchedulingPolicy(beforeShift, next) || beforeMode !== next.custodyMode
      const state = existingState ?? { state: 'NO_SESSION', activeShiftId: null, pendingHandoverId: null, epoch: 0 }
      const hasOpenResponsibility = state.state !== 'NO_SESSION'

      if (hasOpenResponsibility && state.state !== 'ACTIVE')
        throw new BusinessError('تا پایان تحویل/بازیابی در جریان، تغییر روش تک‌شیفت یا چندشیفت مجاز نیست.', 'CUSTODY_MODE_SWITCH_PENDING')
      if (hasOpenResponsibility && !state.activeShiftId)
        throw new BusinessError('مسئولیت باز صندوق ناقص است؛ ابتدا بازیابی صندوق را انجام دهید.', 'CUSTODY_INVARIANT_BROKEN')
      if (hasOpenResponsibility && policyChanged && reason.length < 10)
        throw new BusinessError('برای تغییر روش حضانت هنگام مسئولیت باز، علت حداقل ۱۰ کاراکتری وارد کنید.', 'CUSTODY_MODE_SWITCH_REASON')

      const nextCustody: CustodyConfig = parseCustodyConfig({ ...beforeCustody, mode: next.custodyMode })
      let frozenEpoch: number | null = null
      if (hasOpenResponsibility && policyChanged) {
        const activeShift = await tx.shift.findUnique({ where: { id: state.activeShiftId! }, select: { id: true, closedAt: true } })
        const meta = activeShift ? await tx.custodyShiftMeta.findUnique({ where: { shiftId: activeShift.id }, select: { shiftId: true, custodianUserId: true } }) : null
        if (!activeShift || activeShift.closedAt || !meta)
          throw new BusinessError('سند مسئولیت باز صندوق کامل نیست؛ ابتدا بازیابی صندوق را انجام دهید.', 'CUSTODY_INVARIANT_BROKEN')
        frozenEpoch = Number(state.epoch) + 1
        const frozen = await tx.custodyState.updateMany({
          where: { key: 'MAIN', state: 'ACTIVE', activeShiftId: state.activeShiftId, epoch: state.epoch },
          data: { state: 'MODE_SWITCH_FREEZE', epoch: frozenEpoch, updatedAt: new Date() }
        })
        if (frozen.count !== 1) throw new BusinessError('وضعیت صندوق هم‌زمان تغییر کرد؛ دوباره تلاش کنید.', 'CUSTODY_STALE')
        await tx.custodyEvent.create({
          data: {
            type: 'CUSTODY_MODE_SWITCH_FREEZE', shiftId: activeShift.id, actorUserId: input?.userId ?? null,
            actorKind: 'MANAGER', authMethod: 'MANAGER_SESSION', epochBefore: state.epoch, epochAfter: frozenEpoch,
            payloadJson: JSON.stringify({ fromMode: beforeMode, toMode: next.custodyMode, reason, preservedCustodianUserId: meta.custodianUserId }),
            operationalDay: toJalaliDate(new Date())
          }
        })
      }

      await writeKey(SETTING_KEYS.shiftConfig, next, tx)
      await writeKey(SETTING_KEYS.custodyConfig, nextCustody, tx)

      if (frozenEpoch != null) {
        const resumedEpoch = frozenEpoch + 1
        const resumed = await tx.custodyState.updateMany({
          where: { key: 'MAIN', state: 'MODE_SWITCH_FREEZE', activeShiftId: state.activeShiftId, epoch: frozenEpoch },
          data: { state: 'ACTIVE', epoch: resumedEpoch, updatedAt: new Date() }
        })
        if (resumed.count !== 1) throw new BusinessError('بازگرداندن مسئولیت صندوق ناموفق بود؛ هیچ تنظیمی ذخیره نشد.', 'CUSTODY_STALE')
        await tx.custodyEvent.create({
          data: {
            type: 'CUSTODY_MODE_SWITCH_COMMITTED', shiftId: state.activeShiftId, actorUserId: input?.userId ?? null,
            actorKind: 'MANAGER', authMethod: 'MANAGER_SESSION', epochBefore: frozenEpoch, epochAfter: resumedEpoch,
            payloadJson: JSON.stringify({ fromMode: beforeMode, toMode: next.custodyMode, reason, responsibilityPreserved: true }),
            operationalDay: toJalaliDate(new Date())
          }
        })
      }
      await tx.auditLog.create({
        data: {
          action: 'SETTINGS_UPDATE', entity: 'CustodySchedulingWorkflow', userId: input?.userId ?? null,
          before: JSON.stringify({ custodyMode: beforeMode, configured: beforeShift.custodyModeConfigured, primaryUserId: beforeShift.singleShiftCustodianUserId }),
          after: JSON.stringify({ custodyMode: next.custodyMode, configured: true, primaryUserId: next.singleShiftCustodianUserId, custodyConfigMode: nextCustody.mode }),
          note: frozenEpoch == null ? 'ثبت روش برنامه‌ریزی حضانت صندوق' : `ثبت روش برنامه‌ریزی حضانت با حفظ مسئولیت باز: ${reason}`
        }
      })
      return next
    }, TX_OPTIONS)
  },

  /**
   * ---------------- جلسه ۱۴ — سیاست حسابداری صندوق و اعتبار ----------------
   * آستانه‌ی مغایرت صندوق (بند ۴)، سقف صدور اعتبار (بند ۱۸)، گیت قیمت دستی و
   * قفل دوره‌ی بسته‌شده (بند ۱۷). نبودن رکورد ⇒ پیش‌فرض‌های سخت‌گیرانه.
   */
  async accountingPolicy(): Promise<AccountingPolicy> {
    return parseAccountingPolicy(await readKey(SETTING_KEYS.accountingPolicy))
  },

  /**
   * نشست ۱۵۴ (S151-b، بند ۴-۲۹، S153-D1) — سقف مجاز مغایرت صندوق، گیت قیمت دستی،
   * قفل دوره‌ی بسته و سقف اعتبار: **همیشه** رمز مدیر، در خود سرویس (نه فقط IPC یا UI).
   */
  async setAccountingPolicy(
    input: { policy?: unknown; userId?: number | null; managerPassword?: string | null } = {}
  ) {
    await assertManagerPassword(
      input?.managerPassword ?? null,
      'تغییر سیاست حسابداری (سقف مجاز مغایرت صندوق، گیت قیمت دستی، قفل دوره‌ی بسته، سقف اعتبار خرید)'
    )
    const before = await this.accountingPolicy()
    const next = parseAccountingPolicy(input.policy)
    await writeKey(SETTING_KEYS.accountingPolicy, next)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      entityId: 0,
      userId: input.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(next),
      note:
        'سیاست حسابداری: آستانه‌ی مغایرت صندوق ' +
        `${next.cashDifferenceThreshold} ریال · سقف اعتبار ${next.storeCreditLimit} ریال · ` +
        `گیت قیمت دستی ${next.requireManagerForPriceOverride ? 'روشن' : 'خاموش'} · ` +
        `قفل دوره‌ی بسته ${next.lockClosedPeriods ? 'روشن' : 'خاموش'}`
    })
    return next
  },

  /**
   * ---------------- جلسه ۲۱ · تنظیمات «اعتبار خرید» (§۲۲) ----------------
   * همان الگوی `accountingPolicy`: یک کلید در جدول `Setting`، یک parser
   * محافظه‌کار در `@shared/credit`، و یک ردیف AuditLog روی هر تغییر — چون این
   * تنظیمات مستقیم روی پول (طول کد، دفعات مصرف، مدت اعتبار) اثر دارند.
   *
   * نشست ۱۵۴ (S151-b) — قفل UI کافی نبود (هر تماس IPC دورش می‌زد). CRED-MED-03:
   * این تنظیمات روی اعتبارِ قابل‌خرج اثر دارد، پس حتی با خاموش‌بودن قفل ظاهریِ
   * پنل نیز همیشه رمز مدیر یا رمز دوم/سوم creditSettings لازم است.
   */
  async creditSettings(): Promise<CreditSettings> {
    return parseCreditSettings(await readKey(SETTING_KEYS.creditSettings))
  },

  async saveCreditSettings(
    input: { settings?: unknown; userId?: number | null; panelPassword?: string | null } = {}
  ): Promise<CreditSettings> {
    await assertPanelPasswordStrict(
      PANEL_KEYS.creditSettings,
      input?.panelPassword ?? null,
      'ذخیره‌ی تنظیمات اعتبار خرید (طول کد، دفعات مصرف، مدت اعتبار)'
    )
    const before = await this.creditSettings()
    const next = parseCreditSettings(input?.settings ?? DEFAULT_CREDIT_SETTINGS)
    await writeKey(SETTING_KEYS.creditSettings, next)
    await audit(prisma, {
      action: AuditAction.CREDIT_SETTINGS_UPDATE,
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(next),
      note: 'تنظیمات اعتبار خرید ⇒ ' + describeCreditSettings(next)
    })
    return next
  },

  /** تنظیمات چاپ لیبل (مستقل از قالب فاکتور — مورد ۵ و ۸). */
  /**
   * تنظیمات امنیتی (قفل موقت). همان کلیدی که `AuthService.securityConfig()`
   * می‌خواند — یک منبع حقیقت، دو مصرف‌کننده.
   */
  async securityConfig(): Promise<SecurityConfig> {
    return parseSecurityConfig(await readKey(SETTING_KEYS.securityConfig))
  },

  async labelTemplate(): Promise<LabelTemplate> {
    return parseLabelTemplate(await readKey(SETTING_KEYS.labelTemplate))
  },

  /**
   * نشست ۲۲۲ · فاز ۳ (بخش ۶.۴ طرح) — ذخیره‌ی «چاپگر پیش‌فرض این بخش».
   *
   * چرا این تابع و نه `saveBundle`؟ چون `saveBundle` کل قالب را از renderer
   * می‌گیرد و همان خطر «ذخیره‌ی کهنه» (S168-D1) را دارد: اگر مدیر فرم تنظیمات را
   * باز گذاشته باشد و در پنجره‌ی انتخاب چاپگر «ذخیره به‌عنوان پیش‌فرض» بزند،
   * نوشتن کل قالب مقدارهای دیگرِ فرم را برمی‌گرداند. اینجا فقط `printerName`
   * (یا `wholesalePrinterName`) روی مقدار **تازه‌ی** دیتابیس نوشته می‌شود.
   *
   * اعتبارسنجی نام چاپگر کار main است و در هندلر IPC انجام می‌شود.
   */
  async setPrinterDefault(input: {
    profile: 'INVOICE' | 'WHOLESALE' | 'LABEL'
    printerName: string
  }): Promise<{ profile: string; printerName: string }> {
    const printerName = String(input?.printerName ?? '').trim()
    if (!printerName) throw new BusinessError('نام چاپگر برای ذخیره خالی است.')
    if (input.profile === 'LABEL') {
      // مقدار خام ⇒ هیچ لوگویی جابه‌جا نمی‌شود؛ فقط نام چاپگر.
      const fresh = parseLabelTemplate(await readKey(SETTING_KEYS.labelTemplate))
      await writeKey(SETTING_KEYS.labelTemplate, { ...fresh, printerName })
    } else {
      const fresh = parseReceiptTemplate(await readKey(SETTING_KEYS.receiptTemplate))
      await writeKey(
        SETTING_KEYS.receiptTemplate,
        input.profile === 'WHOLESALE' ? { ...fresh, wholesalePrinterName: printerName } : { ...fresh, printerName }
      )
    }
    return { profile: input.profile, printerName }
  },

  /**
   * بند ۳ — سیاست تخفیف پنل فروش.
   * پیش‌فرضش عمداً «آزاد» است، یعنی *مو‌به‌مو رفتار نسخه‌های قبل*؛ چیزی که این
   * نسخه اضافه کرده، قفل رمز دوم روی خودِ کادر تخفیف است (نه بستن تخفیف).
   */
  async discountPolicy(): Promise<DiscountPolicy> {
    return parseDiscountPolicy(await readKey(SETTING_KEYS.discountPolicy))
  },

  /**
   * ذخیره‌ی سیاست تخفیف. نشست ۱۵۴ (S151-b، بند ۴-۲۶): قفل UI کافی نبود؛ خودِ
   * سرویس رمز پنل تنظیمات را می‌سنجد (این پنل همیشه قفل است). تغییرش در AuditLog
   * ثبت می‌گردد چون مستقیم روی پول اثر دارد.
   */
  async saveDiscountPolicy(
    input: { policy?: unknown; userId?: number | null; panelPassword?: string | null } = {}
  ): Promise<DiscountPolicy> {
    await assertPanelPassword(
      PANEL_KEYS.settings,
      input?.panelPassword ?? null,
      'تغییر سیاست تخفیف پنل فروش (بازه‌ی مجاز تخفیف)'
    )
    const before = await this.discountPolicy()
    const clean = parseDiscountPolicy(input?.policy ?? DEFAULT_DISCOUNT_POLICY)
    await writeKey(SETTING_KEYS.discountPolicy, clean)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(clean),
      note: 'سیاست تخفیف پنل فروش ⇒ ' + describeDiscountPolicy(clean)
    })
    return clean
  },

  /**
   * ساخت کلید اسکوپ‌دار از داده‌ی قدیمی، فقط یک بار (اگر کلید جدید وجود نداشت).
   * هیچ‌وقت خطا پرتاب نمی‌کند: اگر مهاجرت نشد، مقدار پیش‌فرض برمی‌گردد.
   */
  async migrateChargeKey(kind: ChargeKind, scope: ChargeScope): Promise<CategoryChargeConfig> {
    const key = chargeSettingKey(kind, scope)
    try {
      const legacyByCategory = await readKey(LEGACY_CHARGE_KEYS[kind])
      let migrated = legacyByCategory ? cleanCharge(legacyByCategory) : { enabled: true, rules: [], fallback: null }

      if (!legacyByCategory && scope === 'pos') {
        const sale = await this.saleDefaults()
        const percent = kind === 'tax' ? sale.taxPercent : sale.serviceChargePercent
        if (Number(percent) > 0)
          migrated = { enabled: true, rules: [], fallback: { mode: 'PERCENT', value: Math.min(100, Number(percent)) } }
      }

      await writeKey(key, migrated)
      await audit(prisma, {
        action: 'SETTINGS_UPDATE',
        entity: 'Setting',
        after: JSON.stringify(migrated),
        note: `مهاجرت تنظیمات «${chargeTitle(kind, scope)}» به سیستم واحد دسته‌بندی‌محور`
      })
      return migrated
    } catch (e) {
      console.error('[settings] charge migration failed', key, e)
      return { enabled: true, rules: [], fallback: null }
    }
  },

  /** مقدارهای یک پنل مشخص (عوارض یا حق سرویس) برای یک اسکوپ مشخص. */
  async charge(kind: ChargeKind, scope: ChargeScope): Promise<CategoryChargeConfig> {
    const k = normalizeKind(kind)
    const sc = normalizeScope(scope)
    const raw = await readKey(chargeSettingKey(k, sc))
    if (raw == null) return this.migrateChargeKey(k, sc)
    return parseCategoryCharge(raw)
  },

  /** هر چهار ترکیب با یک رفت‌و‌برگشت (پنل تنظیمات و هر دو پنل فروش لازمشان دارند). */
  async charges(): Promise<ChargesBundle> {
    const out = { pos: {}, wholesale: {} } as ChargesBundle
    for (const scope of CHARGE_SCOPES) {
      for (const kind of CHARGE_KINDS) {
        ;(out[scope] as any)[kind] = await this.charge(kind, scope)
      }
    }
    return out
  },

  /**
   * ذخیره‌ی مقدارهای یک پنل. تغییر در اسکوپ pos هیچ اثری روی wholesale ندارد و
   * برعکس. مقدار صفر یا دسته‌ی بی‌مقدار حذف می‌شود.
   */
  async saveCharge(input: {
    kind: ChargeKind
    scope: ChargeScope
    config: CategoryChargeConfig
    userId?: number | null
    panelPassword?: string | null
  }) {
    const kind = normalizeKind(input?.kind)
    const scope = normalizeScope(input?.scope)
    /**
     * نشست ۱۵۵ (S151-c1، بند ۴-۳۹ «تغییر نرخ عوارض/حق سرویس» و بند ۵ «هر گیت در main») —
     * قفل پنل فقط در UI بود؛ هر تماس IPC نرخ را بی‌رمز عوض می‌کرد. حالا پیش از هر نوشتن،
     * رمز پنل همان نوع/اسکوپ (رمز مدیر همه را باز می‌کند؛ قفل خاموش ⇒ OPEN).
     */
    await assertPanelPassword(
      chargePanelKey(kind, scope),
      input?.panelPassword ?? null,
      `ذخیره‌ی «${chargeTitle(kind, scope)}»`
    )
    const before = await this.charge(kind, scope)
    const clean = cleanCharge(input?.config)
    await writeKey(chargeSettingKey(kind, scope), clean)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(clean),
      note: chargeTitle(kind, scope)
    })
    return clean
  },

  /** همه‌ی تنظیمات با یک رفت‌و‌برگشت (صفحه‌ی تنظیمات و پنل‌های فروش). */
  async bundle(): Promise<SettingsBundle> {
    const [receipt, sale, shift, label, charges, security, discount, time, credit] = await Promise.all([
      this.receiptTemplate(),
      this.saleDefaults(),
      this.shiftConfig(),
      this.labelTemplate(),
      this.charges(),
      this.securityConfig(),
      this.discountPolicy(),
      this.officialTime(),
      this.creditSettings()
    ])
    return { receipt, sale, shift, label, charges, security, discount, time, credit }
  },

  /**
   * -------------------------------------------------------------------------
   * جلسه ۱۹ · بند ۹ — تنظیمات «تاریخ و ساعت رسمی».
   *
   * فقط یک افست دستی (به ساعت) که مدیر خودش تنظیم می‌کند. هدفش این است که اگر
   * روزی قانون ساعت رسمی کشور عوض شد، بدون توسعه‌ی نرم‌افزاری جدید همه‌ی
   * محاسبات ساعتی (تشخیص شیفت و گزارش‌های زمانی) یک ساعت جلو/عقب بروند.
   * پیش‌فرض صفر ⇒ رفتار مو‌به‌موی قبل.
   * -------------------------------------------------------------------------
   */
  async officialTime(): Promise<OfficialTimeConfig> {
    return parseOfficialTimeConfig(await readKey(SETTING_KEYS.officialTime))
  },

  async saveOfficialTime(
    input: { offsetHours?: number; userId?: number | null; managerPassword?: string | null } = {}
  ): Promise<OfficialTimeConfig> {
    const before = await this.officialTime()
    const next = parseOfficialTimeConfig({ offsetHours: input?.offsetHours ?? 0 })
    /**
     * نشست ۱۵۷ (Y13، بند ۴-۲۹، S157-D1) — این کانال همان کلید officialTime را می‌نویسد که
     * settings:set خام و saveBundle فقط با رمز مدیر می‌پذیرند؛ پس «تغییر واقعی» (S155-D1)
     * پیش از هر نوشتن رمز مدیر می‌خواهد. افست روی تشخیص شیفت و گزارش‌های زمانی اثر دارد.
     */
    if (!sameJson(next, before))
      await assertManagerPassword(input?.managerPassword ?? null, 'تغییر افست ساعت رسمی')
    await writeKey(SETTING_KEYS.officialTime, next)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(next),
      note: `افست دستی ساعت رسمی کشور: ${next.offsetHours} ساعت (۰ = ساعت خودِ کامپیوتر، بدون تغییر)`
    })
    return next
  },

  /**
   * دکمه‌ی «بررسی ساعت سیستم» — ساعت و تاریخی که برنامه همین حالا از کامپیوتر
   * می‌خواند، کنار ساعت «رسمی» (با افست). هیچ اینترنتی لازم نیست؛ اگر روزی
   * اتصال اینترنت به پروژه اضافه شد، همین خروجی می‌تواند اختیاری با یک منبع
   * زمان معتبر هم مقایسه شود.
   */
  async timeCheck(): Promise<{
    systemIso: string
    systemJalali: string
    systemClock: string
    officialIso: string
    officialJalali: string
    officialClock: string
    offsetHours: number
    timeZone: string
    note: string
  }> {
    const cfg = await this.officialTime()
    const now = new Date()
    const official = applyOfficialOffset(now, cfg)
    let timeZone = ''
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    } catch {
      timeZone = ''
    }
    return {
      systemIso: now.toISOString(),
      systemJalali: toJalaliDate(now),
      systemClock: toClock(now),
      officialIso: official.toISOString(),
      officialJalali: toJalaliDate(official),
      officialClock: toClock(official),
      offsetHours: cfg.offsetHours,
      timeZone,
      note:
        cfg.offsetHours === 0
          ? 'افست دستی صفر است، پس همه‌ی محاسبات ساعتی دقیقاً با ساعت خودِ کامپیوتر انجام می‌شود.'
          : `افست دستی ${cfg.offsetHours} ساعت روی همه‌ی محاسبات ساعتی (تشخیص شیفت و گزارش‌های زمانی) اعمال می‌شود.`
    }
  },

  /**
   * -------------------------------------------------------------------------
   * ذخیره‌ی *فوری* سوییچ «تعیین شیفت بر اساس ساعت» (مورد ۱).
   *
   * چرا جدا از saveBundle؟ چون تاثیر این سوییچ «رفتاری» است: با خاموش شدنش،
   * هر بار بستن صندوق باید یک شیفت جدید باز کند. اگر کاربر تیک را بردارد و
   * فراموش کند دکمه‌ی «ذخیره‌ی تنظیمات» را بزند، مقدار قدیمی در دیتابیس می‌ماند
   * و برنامه — کاملاً درست، ولی برخلاف انتظار کاربر — به همان زمان‌بندی ساعتی
   * ادامه می‌دهد. پس این یک گزینه است که *لحظه‌ی کلیک* ذخیره می‌شود.
   *
   * فقط همین یک فیلد نوشته می‌شود: نام و ساعت شیفت‌های تعریف‌شده (`templates`)
   * از مقدار فعلی دیتابیس خوانده و دست‌نخورده برگردانده می‌شوند، پس اگر کاربر
   * وسط ویرایش فهرست شیفت‌ها این تیک را بزند، ویرایش‌های ذخیره‌نشده‌اش را
   * پاک نمی‌کند و ذخیره هم نمی‌کند.
   * -------------------------------------------------------------------------
   */
  async setShiftByTime(input: { byTime: boolean; userId?: number | null; managerPassword?: string | null }): Promise<ShiftConfig> {
    const before = await this.shiftConfig()
    const next = parseShiftConfig({ ...before, byTime: Boolean(input?.byTime) })
    /**
     * نشست ۱۵۷ (Y13، بند ۴-۲۹، S157-D1) — byTime بخشی از shiftConfig است (کلید رمز مدیرِ
     * settings:set و saveBundle)؛ این کانال فوری همان گیت را می‌گیرد، فقط وقتی مقدار واقعاً عوض شود.
     */
    if (next.byTime !== before.byTime)
      await assertManagerPassword(input?.managerPassword ?? null, 'تغییر سوییچ «تعیین شیفت بر اساس ساعت»')
    await writeKey(SETTING_KEYS.shiftConfig, next)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify({ byTime: before.byTime }),
      after: JSON.stringify({ byTime: next.byTime }),
      note: next.byTime
        ? 'سوییچ «تعیین شیفت بر اساس ساعت» روشن شد (ذخیره‌ی فوری)'
        : 'سوییچ «تعیین شیفت بر اساس ساعت» خاموش شد — بازگشت به شیفت خودکار با هر بستن صندوق (ذخیره‌ی فوری)'
    })
    return next
  },

  /**
   * نشست ۳۱۰ · فاز ۲ — سقف اضافه‌کاری شیفت شب (۰ = خاموش که پیش‌فرض است؛ حداکثر ۲۴۰).
   * الگوی setShiftByTime: ذخیره‌ی فوری، تغییر فقط با رمز مدیر، ثبت در حسابرسی.
   * نرمال‌سازی نهایی دوباره از parseShiftConfig می‌گذرد تا مسیر دیگر (saveBundle)
   * هم نتواند مقدار نامعتبر ذخیره کند.
   */
  async setShiftOvertimeMax(input: { minutes: number; userId?: number | null; managerPassword?: string | null }): Promise<ShiftConfig> {
    const mins = Math.trunc(Number(input?.minutes))
    if (!Number.isFinite(mins) || mins < 0 || mins > 240)
      throw new BusinessError('سقف اضافه‌کاری باید عددی صحیح بین ۰ تا ۲۴۰ دقیقه باشد (۰ یعنی خاموش).')
    const before = await this.shiftConfig()
    const next = parseShiftConfig({ ...before, overtimeMaxMinutes: mins })
    if (next.overtimeMaxMinutes !== before.overtimeMaxMinutes)
      await assertManagerPassword(input?.managerPassword ?? null, 'تغییر «سقف اضافه‌کاری شیفت»')
    await writeKey(SETTING_KEYS.shiftConfig, next)
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      userId: input?.userId ?? null,
      before: JSON.stringify({ overtimeMaxMinutes: before.overtimeMaxMinutes }),
      after: JSON.stringify({ overtimeMaxMinutes: next.overtimeMaxMinutes }),
      note:
        next.overtimeMaxMinutes > 0
          ? `سقف اضافه‌کاری شیفت روی ${next.overtimeMaxMinutes} دقیقه تنظیم شد (ذخیره‌ی فوری)`
          : 'اضافه‌کاری شیفت خاموش شد — نشست دیروز بیرون از بازه همیشه باید بسته شود (ذخیره‌ی فوری)'
    })
    return next
  },

  /**
   * ذخیره‌ی تنظیمات. هر بخش اختیاری است (فقط همان بخش بازنویسی می‌شود) و
   * مقدارها قبل از ذخیره نرمال‌سازی می‌شوند تا فیلد ناقص یا نوع اشتباه ذخیره
   * نشود. تغییر تنظیمات در AuditLog هم ثبت می‌گردد.
   */
  async saveBundle(
    input: Partial<SettingsBundle> & {
      userId?: number | null
      panelPassword?: string | null
      managerPassword?: string | null
    }
  ): Promise<SettingsBundle> {
    /**
     * نشست ۱۵۵ (S151-c1، یافته‌ی Y10، بند ۴-۲۹) — بقیه‌ی بخش‌های این کانال هم بی‌گیت
     * نوشته می‌شدند و رمز مدیرِ settings:set خام (RAW_SETTING_MANAGER_KEYS) را دور می‌زدند.
     * حالا *پیش از هر نوشتن* (هیچ بخشی نیمه‌کاره ذخیره نمی‌شود) برای هر بخشِ واقعاً تغییرکرده:
     *   • security / shift / time ⇒ رمز مدیر (همان کلیدهای RAW_SETTING_MANAGER_KEYS).
     *   • sale ⇒ مقایسه‌ی فیلدبه‌فیلد (S155-D2): فقط printEnabled ⇒ بی‌رمز (سوییچ رفتاری
     *     پنل فروش، فاکتور همیشه ثبت می‌شود؛ هیچ عددی جابه‌جا نمی‌شود)؛ autoCentralWithdraw
     *     ⇒ رمز پنل posCentralWithdrawToggle (همان قفل UI، رمز مدیر هم بازش می‌کند)؛ هر فیلد
     *     دیگر (عوارض/حق سرویس قدیمی، مهلت و طول کد برگشت، نام صندوق‌دار…) ⇒ رمز مدیر.
     *   • charges ⇒ رمز پنل همان نوع/اسکوپ (مثل chargesSave).
     * «تغییر» با مقدار parse‌شده‌ی همان بخش در برابر مقدار فعلی سنجیده می‌شود، پس Pos.tsx و
     * useAutoCentralWithdraw که کل sale را با یک فیلد عوض‌شده می‌فرستند فقط گیت همان فیلد را می‌خورند.
     * ⚠️ نشست ۱۶۶ (S166-D4): printEnabled دیگر بی‌رمز نیست ⇒ رمز پنل posPrintToggle (پایین‌تر).
     * رمز مدیر هر درخواست حداکثر یک بار سنجیده می‌شود.
     */
    const managerSections: string[] = []
    if (input?.security && !sameJson(parseSecurityConfig(input.security), await this.securityConfig()))
      managerSections.push('تنظیمات امنیتی (قفل موقت)')
    if (input?.shift && !sameJson(parseShiftConfig(input.shift), await this.shiftConfig()))
      managerSections.push('تنظیمات شیفت')
    if (input?.time && !sameJson(parseOfficialTimeConfig(input.time), await this.officialTime()))
      managerSections.push('افست ساعت رسمی')
    let autoCentralChanged = false
    let printChanged: boolean | null = null
    let debtReceiptPrintChanged: boolean | null = null
    if (input?.sale) {
      const curSale = await this.saleDefaults()
      const nextSale = parseSaleDefaults(input.sale)
      const changed = (Object.keys(curSale) as (keyof SaleDefaults)[]).filter((k) => !sameJson(curSale[k], nextSale[k]))
      autoCentralChanged = changed.includes('autoCentralWithdraw')
      // نشست ۱۶۶ (S166-D4) — printEnabled دیگر بی‌رمز نیست؛ مقدار تازه برای گیت و یادداشت Audit
      if (changed.includes('printEnabled')) printChanged = nextSale.printEnabled !== false
      if (changed.includes('debtPaymentReceiptPrint'))
        debtReceiptPrintChanged = nextSale.debtPaymentReceiptPrint === true
      if (changed.some((k) => k !== 'printEnabled' && k !== 'autoCentralWithdraw'))
        managerSections.push('تنظیمات فروش (عوارض/حق سرویس پیش‌فرض، کد برگشت، نام صندوق‌دار)')
    }
    const chargePanels: { panel: string; title: string }[] = []
    if (input?.charges) {
      for (const scope of CHARGE_SCOPES) {
        const bucket = (input.charges as any)[scope]
        if (!bucket) continue
        for (const kind of CHARGE_KINDS) {
          if (!bucket[kind]) continue
          if (!sameJson(cleanCharge(bucket[kind]), cleanCharge(await this.charge(kind, scope))))
            chargePanels.push({ panel: chargePanelKey(kind, scope), title: chargeTitle(kind, scope) })
        }
      }
    }
    if (managerSections.length)
      await assertManagerPassword(input?.managerPassword ?? null, 'تغییر ' + managerSections.join('، '))
    if (autoCentralChanged && !managerSections.length)
      await assertPanelPassword(
        PANEL_KEYS.posCentralWithdrawToggle,
        input?.panelPassword ?? input?.managerPassword ?? null,
        'تغییر گزینه‌ی «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی»'
      )
    /**
     * نشست ۱۶۶ (S166-D4، ریسک باز «posPrintToggle فقط UI»، بازنگری S155-D2) — قفل چک‌باکس «چاپ فاکتور»
     * فقط در UI بود و این کانال printEnabled را بی‌رمز می‌نوشت. بی‌رسید، مشتری مبلغ ثبت‌شده را نمی‌بیند و
     * کم‌ثبتی (مثلاً تخفیف داخل بازه‌ی مجاز روی مبلغی که کامل گرفته شده) پنهان می‌ماند. حالا مثل
     * autoCentralWithdraw: رمز پنل posPrintToggle (رمز مدیر هم بازش می‌کند؛ قفل خاموش ⇒ آزاد، بند ۴-۳۹).
     */
    if (printChanged !== null && !managerSections.length)
      await assertPanelPassword(
        PANEL_KEYS.posPrintToggle,
        input?.panelPassword ?? input?.managerPassword ?? null,
        printChanged ? 'روشن کردن چاپ فاکتور' : 'خاموش کردن چاپ فاکتور'
      )
    for (const c of chargePanels)
      if (!managerSections.length)
        await assertPanelPassword(c.panel, input?.panelPassword ?? input?.managerPassword ?? null, `تغییر «${c.title}»`)

    /**
     * نشست ۱۵۴ (S151-b، یافته‌ی Y10) — این کانال سیاست تخفیف را بی‌گیت می‌نوشت و
     * رمز discountPolicySave را دور می‌زد. حالا *پیش از هر نوشتن*: اگر discount
     * آمده و با سیاست فعلی فرق دارد ⇒ رمز پنل تنظیمات. بقیه‌ی کلیدهای Y10 در S151-c.
     */
    if (input?.discount) {
      const current = await this.discountPolicy()
      if (JSON.stringify(parseDiscountPolicy(input.discount)) !== JSON.stringify(current))
        await assertPanelPassword(
          PANEL_KEYS.settings,
          input.panelPassword ?? null,
          'تغییر سیاست تخفیف پنل فروش از ذخیره‌ی کلی تنظیمات'
        )
    }
    // همه‌ی ورودی‌ها را پیش از نخستین write نرمال‌سازی و اعتبارسنجی می‌کنیم.
    // به‌خصوص گیت RAW باید قبل از هر upsert اجرا شود؛ وگرنه شکست label می‌توانست
    // receipt / sale / shift را نیمه‌کاره روی دیسک بگذارد.
    const normalizedShift = input.shift ? parseShiftConfig(input.shift) : null
    if (normalizedShift) {
      const currentShift = await this.shiftConfig()
      // Older saved schedules did not have an explicit workflow marker.  Keep
      // their legacy save semantics intact; once the manager reviews either
      // workflow, every later policy mutation must take the atomic route.
      if ((currentShift.custodyModeConfigured || normalizedShift.custodyModeConfigured) && !sameCustodySchedulingPolicy(currentShift, normalizedShift))
        throw new BusinessError(
          'تغییر تک‌شیفت/چندشیفت یا مسئول اصلی روزانه فقط از بخش «روش مسئولیت و برنامه‌ریزی حضانت» انجام می‌شود؛ این مسیر مسئولیت باز را اتمی حفظ می‌کند.',
          'CUSTODY_SCHEDULING_WORKFLOW_REQUIRED'
        )
      await assertCanonicalShiftSchedule(normalizedShift)
    }
    const before = await this.bundle()
    // `bundle()` logoی رسید را از لیبل پر می‌کند؛ نسخه‌ی ذخیره‌شده لازم است تا
    // پاسخِ ذخیره‌ی تنها-لیبل هم ارث‌بری تازه را مانند خواندن بعدی نشان دهد.
    const storedReceipt = parseReceiptTemplate(await readKey(SETTING_KEYS.receiptTemplate))
    const nextReceipt = input.receipt ? parseReceiptTemplate(input.receipt) : null
    const nextSale = input.sale ? parseSaleDefaults(input.sale) : null
    const nextTime = input.time ? parseOfficialTimeConfig(input.time) : null
    const nextLabel = input.label ? parseLabelTemplate(input.label) : null
    const nextSecurity = input.security ? parseSecurityConfig(input.security) : null
    const nextDiscount = input.discount ? parseDiscountPolicy(input.discount) : null

    /**
     * بند ۷ (جلسه ۳۱) — قرینه‌ی ارث‌بری لوگو: اگر `logoDataUrl` همان لوگوی
     * لیبل باشد (چون `receiptTemplate()` پرش کرده بود)، خالی ذخیره می‌شود تا
     * ارث‌بری زنده بماند و عوض کردن لوگوی لیبل روی سند اعتبار هم اثر بگذارد.
     */
    if (nextReceipt) {
      assertRawMethodAllowed('INVOICE', nextReceipt.printMethod, before.receipt.printMethod)
      // لوگوی لیبلِ *همین ذخیره* مرجع است (اگر هر دو بخش با هم عوض شده باشند)
      nextReceipt.logoDataUrl = receiptLogoForSave(nextReceipt.logoDataUrl, nextLabel?.logoDataUrl ?? before.label.logoDataUrl)
    }
    // این گیت باید کنار گیت receipt و قبل از transaction باشد: هر دو تغییر RAW
    // در یک درخواست یا هیچ‌کدام ذخیره می‌شوند.
    if (nextLabel) assertRawMethodAllowed('LABEL', nextLabel.printMethod, before.label.printMethod)

    const nextCharges: ChargesBundle = {
      pos: { tax: before.charges.pos.tax, service: before.charges.pos.service },
      wholesale: { tax: before.charges.wholesale.tax, service: before.charges.wholesale.service }
    }
    if (input.charges) {
      for (const scope of CHARGE_SCOPES) {
        const bucket = (input.charges as any)[scope]
        if (!bucket) continue
        for (const kind of CHARGE_KINDS) {
          if (bucket[kind]) nextCharges[scope][kind] = cleanCharge(bucket[kind])
        }
      }
    }
    const receiptForAfter = nextReceipt ?? storedReceipt
    const after: SettingsBundle = {
      receipt: {
        ...receiptForAfter,
        logoDataUrl: receiptLogoInherit(receiptForAfter.logoDataUrl, nextLabel?.logoDataUrl ?? before.label.logoDataUrl)
      },

      sale: nextSale ?? before.sale,
      shift: normalizedShift ?? before.shift,
      label: nextLabel ?? before.label,
      charges: nextCharges,
      security: nextSecurity ?? before.security,
      discount: nextDiscount ?? before.discount,
      credit: before.credit,
      time: nextTime ?? before.time
    }

    /**
     * SET-001 — تمام upsertهای bundle و AuditLog یک واحد شکست‌ناپذیرند. هیچ
     * اعتبارسنجی یا گیتِ ممکن‌الخطایی داخل یا بعد از نخستین write نیست.
     */
    await prisma.$transaction(async (tx) => {
      if (nextReceipt) await writeKey(SETTING_KEYS.receiptTemplate, nextReceipt, tx)
      if (nextSale) await writeKey(SETTING_KEYS.saleDefaults, nextSale, tx)
      if (normalizedShift) await writeKey(SETTING_KEYS.shiftConfig, normalizedShift, tx)
      if (nextTime) await writeKey(SETTING_KEYS.officialTime, nextTime, tx)
      if (nextLabel) await writeKey(SETTING_KEYS.labelTemplate, nextLabel, tx)
      if (nextSecurity) await writeKey(SETTING_KEYS.securityConfig, nextSecurity, tx)
      if (nextDiscount) await writeKey(SETTING_KEYS.discountPolicy, nextDiscount, tx)
      if (input.charges) {
        for (const scope of CHARGE_SCOPES) {
          const bucket = (input.charges as any)[scope]
          if (!bucket) continue
          for (const kind of CHARGE_KINDS) {
            if (bucket[kind]) await writeKey(chargeSettingKey(kind, scope), nextCharges[scope][kind], tx)
          }
        }
      }
      await audit(tx, {
        action: 'SETTINGS_UPDATE',
        entity: 'Setting',
        userId: input.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify(after),
        note:
          'تنظیمات قالب فاکتور / فروش / شیفت / چاپ لیبل / امنیت' +
          (printChanged === null ? '' : printChanged ? ' · چاپ فاکتور روشن شد' : ' · چاپ فاکتور خاموش شد') +
          (debtReceiptPrintChanged === null
            ? ''
            : debtReceiptPrintChanged
              ? ' · فیش وصول نسیه روشن شد'
              : ' · فیش وصول نسیه خاموش شد')
      })
    }, TX_OPTIONS)
    // اثر حافظه‌ای TTL فقط پس از commit موفق مجاز است.
    if (nextSecurity) applyPanelSessionTtlMinutes(nextSecurity.idleLockMinutes)
    return after
  }
}
