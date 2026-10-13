import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
/**
 * جلسه ۲۹ · §۱۰ — کل این سرویس با نسخه‌ی **fail-closed** لاگ می‌نویسد.
 * `auditOrThrow` با نام آشنای `audit` وارد می‌شود تا هر ۲۰+ نقطه‌ی لاگِ این فایل
 * یکجا و بدون استثنا fail-closed شود: اگر سابقه ننشیند، خودِ تغییر هم (چون داخل
 * همان تراکنش است) rollback می‌شود. توضیح کامل بالای `auditOrThrow`.
 */
import { auditOrThrow as audit, auditMany } from './AuditService'
import { BusinessError } from '../errors'
import { reportDayInput } from './reportDate'
import { TX_OPTIONS } from '../db/tx'
import { normalizeReturnCode, DAY_MS } from './ReturnCodeService'
import {
  assertManagerPassword,
  assertPanelPasswordStrict,
  withCreditCodeGateAttempt,
  assertCreditCodeGateOpen,
  noteCreditCodeFailure,
  noteCreditCodeSuccess
} from './AuthService'
import {
  AuditAction,
  PaymentKind,
  PaymentEntryKind,
  SaleStatus,
  StoreCreditStatus,
  STORE_CREDIT_STATUS_LABELS,
  EXCHANGE_CREDIT_METHOD_KEY,
  STORE_CREDIT_METHOD_KEY,
  orderTypesForChannels
} from '@shared/enums'
import { SETTING_KEYS } from '@shared/receipt'
import { cleanCreditIds } from '@shared/creditPrint'
import { creditIdsForReportScope, CREDIT_SCOPE_MAX_IDS } from './creditReportScope'
import { PANEL_KEYS } from '@shared/panels'
import { assertManagerSession } from './panelSession'
import {
  CREDIT_SCOPE_LABELS,
  CREDIT_SOURCE_LABELS,
  CREDIT_STATUS_LABELS,
  EXPIRABLE_STATUSES,
  CreditRestrictScope,
  CreditReminderKind,
  CreditReminderStatus,
  CreditSource,
  MAX_CREDIT_CODE_LENGTH,
  MIN_CREDIT_CODE_LENGTH,
  REDEEMABLE_STATUSES,
  assessCodeSpace,
  canCreditTransition,
  codeGrowthOf,
  creditAlphabet,
  creditBatchPrintAudit,
  creditIdsWhere,
  creditPrintAction,
  creditPrintAudit,
  creditPrintIncrementData,
  creditPrintSetData,
  creditReprintCount,
  CREDIT_MARK_PRINTED_NONE,
  CREDIT_ORDER_BY,
  CREDIT_PRINT_SELECT,
  creditSearchPlan,
  creditSearchWhere,
  creditStatusWhere,
  decideRedeem,
  effectiveStatus,
  evaluateEligibility,
  fillPlaceholders,
  HOLDER_AUDIT_FIELDS,
  HOLDER_FIELD_LABELS,
  holderSnapshot,
  isCreditReprint,
  isExpiredAt,
  needsCodeSpaceCheck,
  normalizeCreditCode,
  normalizeCreditPrefix,
  normalizeCreditSource,
  normalizeRestrictScope,
  parseCreditSettings,
  parseIdList,
  planRedemptionReversal,
  remainingOf,
  reminderDecision,
  isReminderForceable,
  rollExpiredBuckets,
  rulesForSource,
  sourceChangeError,
  statusAfterRedeem,
  transitionError,
  usesLeftOf,
  withAndClause,
  type CreditCartLine,
  type CreditReminderSettings,
  type CreditSearchMatches,
  type CreditSearchPlan,
  type CreditSettings,
  type CreditStatusBucket
} from '@shared/credit'
import { toJalaliDate, toClock, faDigits, money, jalaliStartOfDay, jalaliEndOfDay, jalaliToday } from '@shared/jalali'
import { notificationSender } from './NotificationSender'
import type {
  CreditBatchRow,
  CreditBulkResult,
  CreditDashboard,
  CreditDetail,
  CreditRedemptionRow,
  CreditReminderCandidateRow,
  CreditReminderLogRow,
  CreditTimelineEvent,
  ManagerStoreCreditCodeReveal,
  StoreCreditRow,
  StoreCreditSafeRow,
  StoreCreditReportRow,
  PagedRows,
  SaleReportPage
} from '@shared/types'
import { toNumberRial } from '@shared/money'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * ===========================================================================
 * «مدیریت اعتبار خرید» — سرویس main (تنها نقطه‌ی *اعمال* قواعد).
 *
 * تاریخچه: این فایل از «بارکد اعتبار خرید بعدی» بخش ۶ شروع شد (اعتباری که
 * هنگام تعویض کالا صادر می‌شد، یک‌بارمصرف، بدون هیچ محدودیت). جلسه ۲۰ مدل داده
 * و موتور قواعد (`src/shared/credit.ts`) را ساخت و جلسه ۲۱ همین سرویس را
 * **گسترش** داد — نه بازنویسی از صفر و نه یک سرویس موازی:
 *
 *   • همه‌ی امضاهای قبلی (`issueStoreCredit`، `redeemStoreCredit`،
 *     `findRedeemable`، `nonCashMethodId`، `shapeStoreCredit`،
 *     `generateStoreCreditCode`) سر جای خودشان و با همان رفتار پیش‌فرض‌اند، پس
 *     `SalesService` بدون یک خط تغییر کار می‌کند.
 *   • هر قابلیت تازه (نوع MANUAL، مصرف چندباره، محدودیت کالا/دسته، تولید گروهی،
 *     ابطال/تعلیق، یادآوری) روی همان رکورد `StoreCredit` سوار شده است.
 *
 * چهار قاعده‌ی سختِ این فایل:
 *
 *   ۱) **قواعد از `@shared/credit` می‌آیند، تصمیم از اینجا اعمال می‌شود.**
 *      هیچ شرط مصرفی اینجا دوباره نوشته نمی‌شود؛ `decideRedeem` همه‌ی شرط‌ها را
 *      *با هم* چک می‌کند و ما فقط همان `applied` را کم می‌کنیم (§۲۱).
 *
 *   ۲) **به ورودی UI هیچ‌وقت اعتماد نمی‌شود.** اقلام سبد برای محدودیت
 *      کالا/دسته از *دیتابیس* خوانده می‌شوند (`linesForInvoice`)، نه از
 *      Request. پس تغییر Request در DevTools محدودیت را دور نمی‌زند.
 *
 *   ۳) **یکتایی کد از UNIQUE INDEX دیتابیس است**، نه از `findFirst`. تصادم =
 *      خطای P2002 که همین‌جا با یک کد تازه retry می‌شود (§۶).
 *
 *   ۴) **قفل کد اعتبار هرگز داخل تراکنش باز صدا زده نمی‌شود** (بن‌بست
 *      تک‌نویسنده‌ی SQLite — توضیحش در AuthService). نقطه‌ی اعمالش
 *      `guardCreditCode` است که *قبل از* باز کردن تراکنش اجرا می‌شود.
 * ===========================================================================
 */

const MIN_CODE = MIN_CREDIT_CODE_LENGTH
const MAX_CODE = MAX_CREDIT_CODE_LENGTH

/**
 * «چندباره تا سقف مبلغ» (§۴) یعنی تعداد دفعات مهم نیست و فقط مبلغ سقف است.
 * ستون `maxUses` عدد می‌خواهد، پس برای این حالت همین عدد ذخیره می‌شود و در UI
 * به‌صورت «تا پایان مبلغ» نمایش داده می‌شود. عدد بزرگ ولی نه بی‌نهایت، تا
 * گزارش «دفعات باقی‌مانده» بی‌معنا نشود.
 */
const MULTI_USE_UNLIMITED = 1000

const CHUNK = 200

const clampInt = (v: unknown, min: number, max: number, fallback = 0): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function creditPage(rawTake: unknown, rawSkip: unknown, totalCount: number): SaleReportPage {
  const parsedTake = Math.round(Number(rawTake ?? 1000))
  const parsedSkip = Math.round(Number(rawSkip ?? 0))
  const take = Math.min(Math.max(Number.isFinite(parsedTake) ? parsedTake : 1000, 1), 5000)
  const skip = Math.max(Number.isFinite(parsedSkip) ? parsedSkip : 0, 0)
  return { skip, take, totalCount, truncated: false }
}

function attachPagedRows<T>(rows: T[], page: SaleReportPage, noun = 'ردیف'): PagedRows<T> {
  page.truncated = page.totalCount > page.skip + rows.length
  const warnings = page.truncated
    ? [
        `نمایش ${faDigits(rows.length)} از ${faDigits(page.totalCount)} ${noun}؛ برای دیدن همه‌ی ${noun} صفحه‌ی بعد را بگیرید.`
      ]
    : []
  return Object.assign(rows, { page, warnings }) as PagedRows<T>
}

function attachCreditPage<T>(rows: T[], page: SaleReportPage): PagedRows<T> {
  return attachPagedRows(rows, page)
}

const asNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

const isP2002 = (e: unknown): boolean =>
  (e as any)?.code === 'P2002' || /unique constraint/i.test(String((e as any)?.message ?? ''))

// ---------------------------------------------------------------------------
// ۰) تنظیمات مرکزی اعتبار (§۲۲)
// ---------------------------------------------------------------------------

/**
 * تنظیمات اعتبار خرید از همان جدول `Setting` (کلید `credit.settings`).
 * نبودن رکورد یا JSON خراب ⇒ `DEFAULT_CREDIT_SETTINGS` (همان الگوی
 * `parseAccountingPolicy`). هیچ‌وقت throw نمی‌کند.
 */
export async function readCreditSettings(client: Client = prisma): Promise<CreditSettings> {
  try {
    const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.creditSettings } })
    return parseCreditSettings(row?.value ?? null)
  } catch (e) {
    console.error('[credit] settings read failed', e)
    return parseCreditSettings(null)
  }
}

// ---------------------------------------------------------------------------
// ۱) تولید کد: الفبا/طول/پیشوند از تنظیمات، یکتایی از دیتابیس (§۶)
// ---------------------------------------------------------------------------

/** یک رشته‌ی تصادفی امن از الفبای داده‌شده (crypto، نه Math.random). */
function randomFrom(alphabet: string, length: number): string {
  const size = alphabet.length
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[randomInt(0, size)]
  return out
}

/** پیشوند پیش‌فرض هر نوع: تعویض = همان `E` تاریخی، مدیریتی = `CR`. */
function prefixFor(settings: CreditSettings, source: string, explicit?: string | null): string {
  if (explicit != null) return normalizeCreditPrefix(explicit, '')
  return source === CreditSource.MANUAL
    ? normalizeCreditPrefix(settings.prefixManual, 'CR')
    : normalizeCreditPrefix(settings.prefixExchange, 'E')
}

/**
 * چند کد با همین طول از قبل در دیتابیس هست (مبنای محاسبه‌ی «فضای آزاد» §۶).
 * با `COUNT(*)` و ایندکس یکتای `code` انجام می‌شود، پس روی هزاران ردیف هم ارزان است.
 */
async function codesWithLength(client: Client, length: number): Promise<number> {
  try {
    const rows = await client.$queryRawUnsafe<{ n: number | bigint | null }[]>(
      'SELECT COUNT(*) AS n FROM "StoreCredit" WHERE LENGTH("code") = ?',
      Math.round(length)
    )
    return Math.max(0, Number(rows?.[0]?.n ?? 0))
  } catch (e) {
    console.error('[credit] code count failed', e)
    return 0
  }
}

/**
 * ظرفیت کد را *قبل از* شروع عملیات می‌سنجد و اگر کافی نبود، عملیات را با پیام
 * فارسی متوقف می‌کند (§۶ — نه silently fail و نه overwrite).
 * خروجی، طولی است که واقعاً باید استفاده شود (ممکن است با «افزایش خودکار طول»
 * بزرگ‌تر از درخواست باشد؛ همین رشد هم در خروجی و در AuditLog دیده می‌شود).
 */
export async function assertCodeSpace(
  client: Client,
  input: { count: number; settings: CreditSettings; prefix: string; length?: number; userId?: number | null }
): Promise<{ length: number; grown: boolean; message: string | null; capacity: number; free: number }> {
  const settings = input.settings
  const requested = clampInt(input.length ?? settings.codeLength, MIN_CODE, MAX_CODE, settings.codeLength)
  const alphabet = creditAlphabet(settings.codeAlphabet, settings.excludeSimilar)
  const existing = await codesWithLength(client, requested)
  const assessment = assessCodeSpace({
    count: input.count,
    length: requested,
    prefixLength: input.prefix.length,
    alphabetSize: alphabet.length,
    existing,
    ratio: settings.bulkCapacityRatio,
    autoGrow: settings.autoGrowLength,
    maxLength: MAX_CODE
  })
  if (!assessment.ok) {
    await audit(client, {
      action: AuditAction.CREDIT_CODE_SPACE_BLOCKED,
      entity: 'StoreCredit',
      userId: input.userId ?? null,
      after: JSON.stringify({
        requestedCount: input.count,
        length: assessment.length,
        capacity: assessment.capacity,
        free: assessment.free,
        existing
      }),
      note: `عملیات اعتبار به‌دلیل کمبود فضای کد انجام نشد · درخواست ${input.count} کد با طول ${assessment.length}`
    })
    throw new BusinessError(assessment.message ?? 'فضای کدهای ممکن برای این عملیات کافی نیست.')
  }
  return {
    length: assessment.length,
    grown: assessment.grown,
    message: assessment.message,
    capacity: assessment.capacity,
    free: assessment.free
  }
}

/**
 * یک کد اعتبار **یکتا در سطح دیتابیس**.
 *
 * تفاوت با نسخه‌ی قبلی (و دلیل وجود این جلسه): قبلاً یکتایی با
 * `findFirst({ code, status: ACTIVE })` چک می‌شد — یعنی دو کاربر هم‌زمان
 * می‌توانستند یک کد بگیرند و کدِ یک اعتبارِ مصرف‌شده هم قابل تولید دوباره بود.
 * حالا ستون `code` در دیتابیس `@unique` است، پس:
 *   • این تابع فقط یک *کاندید* می‌سازد (با یک پیش‌بررسی ارزان برای کم کردن
 *     خطای P2002)،
 *   • و تضمین نهایی همان UNIQUE INDEX است که `issueStoreCredit` روی خطای
 *     P2002 با کد تازه retry می‌کند.
 *
 * امضای قبلی (`{ length, days, issuedAt }`) دست‌نخورده است تا مسیر تعویض کالا
 * عیناً کار کند؛ `source/prefix/settings` اختیاری‌اند.
 */
export async function generateStoreCreditCode(
  client: Client,
  opts: {
    length?: number
    days?: number | null
    issuedAt?: Date
    source?: string
    prefix?: string | null
    settings?: CreditSettings
  } = {}
): Promise<{ code: string; expiresAt: Date | null }> {
  const issuedAt = opts.issuedAt ?? new Date()
  const days = opts.days == null ? null : clampInt(opts.days, 0, 3650, 0)
  const expiresAt = days && days > 0 ? new Date(issuedAt.getTime() + days * DAY_MS) : null

  const settings = opts.settings ?? (await readCreditSettings(client))
  const source = normalizeCreditSource(opts.source)
  const prefix = prefixFor(settings, source, opts.prefix)
  const alphabet = creditAlphabet(settings.codeAlphabet, settings.excludeSimilar)
  let length = clampInt(opts.length ?? settings.codeLength, MIN_CODE, MAX_CODE, settings.codeLength)

  for (let attempt = 0; attempt < 40; attempt++) {
    if (attempt > 0 && attempt % 12 === 0 && length < MAX_CODE) length++
    const body = randomFrom(alphabet, Math.max(1, length - prefix.length))
    const code = (prefix + body).slice(0, MAX_CODE)
    const clash = await client.storeCredit.findUnique({ where: { code }, select: { id: true } })
    if (!clash) return { code, expiresAt }
  }

  // آخرین راه (به‌فرض محال): زمان + تصادف. یکتایی همچنان با UNIQUE INDEX تضمین است.
  return {
    code: (prefix + randomFrom(alphabet, 4) + Date.now().toString(36).toUpperCase()).slice(0, MAX_CODE),
    expiresAt
  }
}

/**
 * روش پرداختِ *غیرنقدی* (اعتبار تعویض / بارکد اعتبار).
 *
 * `isActive: false` عمدی است — مثل روش پرداخت «چک»: این دو روش از مسیر خودشان
 * ثبت می‌شوند و نباید به‌عنوان دکمه در پنل فروش یا فاکتور عمده ظاهر شوند.
 */
export async function nonCashMethodId(client: Client, key: string): Promise<number> {
  const isExchange = key === EXCHANGE_CREDIT_METHOD_KEY
  const kind = isExchange ? PaymentKind.EXCHANGE_CREDIT : PaymentKind.STORE_CREDIT
  const label = isExchange ? 'ارزش کالای برگشتی (تعویض)' : 'بارکد اعتبار خرید بعدی'
  const existing = await client.paymentMethod.findUnique({ where: { key } })
  if (existing) {
    if (existing.kind !== kind)
      await client.paymentMethod.update({ where: { id: existing.id }, data: { kind, isActive: false } })
    return existing.id
  }
  const created = await client.paymentMethod.create({
    data: { key, label, kind, isActive: false, sortOrder: isExchange ? 91 : 92 }
  })
  return created.id
}

// ---------------------------------------------------------------------------
// ۲) شکل‌دهی رکورد برای نمایش/چاپ (سازگار با نسخه‌ی قبل)
// ---------------------------------------------------------------------------

/**
 * یک رکورد `StoreCredit` → ردیف آماده‌ی نمایش/چاپ.
 *
 * ⚠️ همه‌ی فیلدهای نسخه‌ی قبل با همان نام و همان معنا برمی‌گردند (پنل فروش و
 * فاکتور عمده روی همین‌ها بسته شده‌اند)؛ فیلدهای تازه فقط *اضافه* شده‌اند.
 * `status` همان «وضعیت مؤثر» است: اگر تاریخ گذشته باشد «منقضی» می‌شود حتی اگر
 * ستون وضعیت عقب مانده باشد — همان رفتار قبلی، ولی این بار با آگاهی از
 * مصرف بخشی (`effectiveStatus` موتور قواعد).
 */
export function shapeStoreCredit(row: any, receiptNos?: Map<number, number>): StoreCreditRow {
  const issuedAt = row.issuedAt instanceof Date ? row.issuedAt : new Date(row.issuedAt)
  const expiresAt = row.expiresAt ? (row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt)) : null
  const expired = !!expiresAt && expiresAt.getTime() <= Date.now()
  const core = {
    amount: asNum(row.amount),
    usedAmount: asNum(row.usedAmount),
    usedCount: asNum(row.usedCount),
    maxUses: row.maxUses == null ? 1 : asNum(row.maxUses),
    multiUse: row.multiUse === true,
    status: String(row.status ?? StoreCreditStatus.ACTIVE),
    expiresAt
  }
  const status = effectiveStatus(core)
  const source = normalizeCreditSource(row.source)
  const scope = normalizeRestrictScope(row.restrictScope)
  const exchangeInvoiceId = row.exchangeInvoiceId ?? null
  const sourceInvoiceId = row.sourceInvoiceId ?? null
  const lastPrintedAt = row.lastPrintedAt ? new Date(row.lastPrintedAt) : null
  const lastReminderAt = row.lastReminderAt ? new Date(row.lastReminderAt) : null
  const voidedAt = row.voidedAt ? new Date(row.voidedAt) : null
  const suspendedAt = row.suspendedAt ? new Date(row.suspendedAt) : null
  const deletedAt = row.deletedAt ? new Date(row.deletedAt) : null

  return {
    id: row.id,
    code: row.code,
    amount: Math.round(core.amount),
    status,
    statusLabel: CREDIT_STATUS_LABELS[status] ?? STORE_CREDIT_STATUS_LABELS[status] ?? status,
    issuedAtJalali: row.issuedAtJalali || toJalaliDate(issuedAt),
    issuedAtTime: row.issuedAtTime || toClock(issuedAt),
    expiresAtJalali: row.expiresAtJalali ?? (expiresAt ? toJalaliDate(expiresAt) : null),
    expired,
    daysLeft: expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS)) : null,
    customerName: row.customerName ?? null,
    returnId: row.returnId ?? null,
    exchangeInvoiceId,
    exchangeReceiptNo: exchangeInvoiceId != null ? (receiptNos?.get(exchangeInvoiceId) ?? null) : null,
    sourceInvoiceId,
    sourceReceiptNo: sourceInvoiceId != null ? (receiptNos?.get(sourceInvoiceId) ?? null) : null,
    usedAtJalali: row.usedAtJalali ?? null,
    usedAtTime: row.usedAtTime ?? null,
    usedInvoiceId: row.usedInvoiceId ?? null,
    usedReceiptNo: row.usedReceiptNo ?? null,
    note: row.note ?? null,

    // ---------------- جلسه ۲۱ (همه‌ی این‌ها *افزودنی* هستند) ----------------
    source,
    sourceLabel: CREDIT_SOURCE_LABELS[source] ?? source,
    usedAmount: Math.round(core.usedAmount),
    remaining: remainingOf(core),
    usedCount: Math.round(core.usedCount),
    maxUses: Math.round(core.maxUses),
    usesLeft: usesLeftOf(core),
    multiUse: core.multiUse,
    usesLabel: core.multiUse
      ? core.maxUses >= MULTI_USE_UNLIMITED
        ? 'چندباره تا پایان مبلغ'
        : `چندباره (تا ${faDigits(core.maxUses)} بار)`
      : 'یک‌بارمصرف',
    customerId: row.customerId ?? null,
    customerLocked: row.customerLocked === true,
    restrictScope: scope,
    restrictScopeLabel: CREDIT_SCOPE_LABELS[scope] ?? scope,
    restrictCategoryIds: parseIdList(row.restrictCategoryIdsJson),
    restrictVariantIds: parseIdList(row.restrictVariantIdsJson),
    minPurchase: Math.max(0, asNum(row.minPurchase)),
    maxPerTransaction: Math.max(0, asNum(row.maxPerTransaction)),
    settingsOverride: row.settingsOverride === true,
    overrideReason: row.overrideReason ?? null,
    issuedDays: row.issuedDays ?? null,
    holderCompany: row.holderCompany ?? null,
    holderNationalId: row.holderNationalId ?? null,
    holderPhone: row.holderPhone ?? null,
    holderAddress: row.holderAddress ?? null,
    holderAgent: row.holderAgent ?? null,
    holderNote: row.holderNote ?? null,
    batchId: row.batchId ?? null,
    prefix: row.prefix ?? null,
    printCount: Math.max(0, asNum(row.printCount)),
    lastPrintedAtJalali: lastPrintedAt ? toJalaliDate(lastPrintedAt) : null,
    reminderOptOut: row.reminderOptOut === true,
    reminderCount: Math.max(0, asNum(row.reminderCount)),
    lastReminderAtJalali: lastReminderAt ? toJalaliDate(lastReminderAt) : null,
    lastReminderKind: row.lastReminderKind ?? null,
    voidedAtJalali: voidedAt ? toJalaliDate(voidedAt) : null,
    voidedReason: row.voidedReason ?? null,
    suspendedAtJalali: suspendedAt ? toJalaliDate(suspendedAt) : null,
    archived: !!deletedAt,
    archivedAtJalali: deletedAt ? toJalaliDate(deletedAt) : null,
    legacyCode: row.legacyCode ?? null,
    remainderCreditId: row.remainderCreditId ?? null,
    userId: row.userId ?? null
  }
}

/**
 * شکلِ عمومیِ گزارش، فهرست و جزئیات اعتبار. credential و legacyCode پیش از
 * عبور از IPC حذف می‌شوند؛ شناسه فقط برای ردیابی امن و غیرقابل‌مصرف است.
 */
function shapeStoreCreditSafe(row: StoreCreditRow): StoreCreditReportRow {
  const { code: _redeemableCode, legacyCode: _legacyCode, ...safe } = row
  return { ...safe, publicReference: `اعتبار #${safe.id}` }
}

/** شماره فیش فاکتورهای مرجع چند اعتبار، با یک رفت‌و‌برگشت. */
async function receiptNoMap(client: Client, rows: any[]): Promise<Map<number, number>> {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.exchangeInvoiceId, r.sourceInvoiceId, r.usedInvoiceId])
        .filter((n): n is number => Number.isInteger(n) && n > 0)
    )
  ]
  if (!ids.length) return new Map()
  /**
   * نشست ۱۷۵ · S175-D4 — صفحه‌ی تب اعتبار تا ۵٬۰۰۰ ردیف (تا ۳ فاکتور مرجع برای هر ردیف) ⇒ `id in`
   * یکجا از سقف IN ۵۰۰ (S99-2) رد می‌شد. حالا دسته‌های ۵۰۰تایی؛ نقشه جمع‌پذیر است.
   */
  const out = new Map<number, number>()
  for (const part of chunkIds(ids)) {
    const invoices = await client.saleInvoice.findMany({
      where: { id: { in: part } },
      select: { id: true, receiptNo: true }
    })
    for (const i of invoices) out.set(i.id, i.receiptNo)
  }
  return out
}

/**
 * اقلام یک فاکتور، از دید قواعد اعتبار — **از دیتابیس، نه از ورودی UI** (§۲۱).
 *
 * چرا؟ چون محدودیت «کالا/دسته» (§۱۸) اگر روی اقلامِ ارسالیِ Request اعمال شود،
 * با یک تغییر ساده در DevTools دور زده می‌شود. مسیر درست همین است: شناسه‌ی
 * فاکتور را می‌گیریم و خودمان اقلام و دسته‌ی هر کالا (با همه‌ی نیاکانش) را
 * می‌خوانیم.
 */
export async function linesForInvoice(client: Client, invoiceId: number): Promise<CreditCartLine[]> {
  const items = await client.saleInvoiceItem.findMany({
    where: { invoiceId },
    select: { variantId: true, variantName: true, qty: true, lineTotal: true }
  })
  if (!items.length) return []

  /** نشست ۱۸۰ (S180-D7) — همان ایراد InventoryService: تایپ باید شکل `select` باشد، نه مدل کامل. */
  const variants: Array<{ id: number; product: { categoryId: number | null } | null }> = []
  for (const ids of chunkIds(items.map((i) => i.variantId))) {
    variants.push(
      ...(await client.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true, product: { select: { categoryId: true } } }
      }))
    )
  }
  const catOf = new Map<number, number | null>(variants.map((v) => [v.id, v.product?.categoryId ?? null]))

  // نیاکان دسته‌ها: محدودیت روی یک دسته‌ی والد باید همه‌ی زیرشاخه‌هایش را بپوشاند
  const categories = await client.category.findMany({ select: { id: true, parentId: true } })
  const parentOf = new Map<number, number | null>(categories.map((c) => [c.id, c.parentId ?? null]))
  const pathOf = (id: number | null): number[] => {
    const out: number[] = []
    let cur = id
    let guard = 0
    while (cur != null && guard++ < 20) {
      out.push(cur)
      cur = parentOf.get(cur) ?? null
    }
    return out
  }

  return items.map((i) => {
    const categoryId = catOf.get(i.variantId) ?? null
    return {
      variantId: i.variantId,
      categoryId,
      categoryPath: pathOf(categoryId),
      name: i.variantName ?? undefined,
      qty: i.qty,
      // نشست ۱۸۱: `Math.round` روی BigInt استثنا می‌دهد ⇒ تبدیل صریح در مرز.
      lineTotal: Math.max(0, toNumberRial(i.lineTotal))
    }
  })
}

// ---------------------------------------------------------------------------
// ۳) صدور اعتبار (§۲، §۳، §۱۲، §۱۸)
// ---------------------------------------------------------------------------

export interface IssueCreditInput {
  amount: number
  /**
   * 🔴 نشست ۱۸۲ · بند ۴-۷ — لحظه‌ی انقضای *دقیق*، وقتی باید عیناً از یک اعتبار
   * دیگر به ارث برسد (بارکد «باقی‌مانده»).
   *
   * مسیر معمول `days` است و انقضا را `issuedAt + days` حساب می‌کند. ولی برای
   * باقی‌مانده، تبدیل زمانِ باقی به «تعداد روز» مهلت را تمدید می‌کرد؛ جزئیاتش
   * در محل استفاده توضیح داده شده. اگر این مقدار داده شود، `days` نادیده
   * گرفته می‌شود.
   */
  expiresAtExact?: Date | null
  /** EXCHANGE (پیش‌فرض — مسیر تاریخی) | MANUAL */
  source?: string | null
  returnId?: number | null
  exchangeInvoiceId?: number | null
  sourceInvoiceId?: number | null
  customerId?: number | null
  customerName?: string | null
  /** مدت اعتبار به روز (null = بدون انقضا · undefined = پیش‌فرض همان نوع) */
  days?: number | null
  length?: number
  note?: string | null
  userId?: number | null
  issuedAt?: Date
  // ---- جلسه ۲۱ ----
  maxUses?: number | null
  multiUse?: boolean | null
  /**
   * نشست ۱۸۳ — تکلیف باقی‌مانده‌ی اعتبار یک‌بارمصرف.
   * `undefined` ⇒ از تنظیمات همان نوع خوانده می‌شود.
   */
  carryRemainder?: boolean | null
  restrictScope?: string | null
  restrictCategoryIds?: number[] | null
  restrictVariantIds?: number[] | null
  minPurchase?: number | null
  maxPerTransaction?: number | null
  customerLocked?: boolean | null
  holderCompany?: string | null
  holderNationalId?: string | null
  holderPhone?: string | null
  holderAddress?: string | null
  holderAgent?: string | null
  holderNote?: string | null
  overrideReason?: string | null
  batchId?: number | null
  prefix?: string | null
  /** DRAFT برای اعتبار ساخته‌شده‌ی صادرنشده (§۱۱) — پیش‌فرض ACTIVE */
  status?: string
  reminderOptOut?: boolean | null
  /** تنظیمات از قبل خوانده‌شده (برای تولید گروهی: یک بار بخوان، هزار بار استفاده کن) */
  settings?: CreditSettings
  /** نشست ۱۴۳ · بند ۴-۲۹ — رمز مدیر برای صدور دستی (فقط مسیر issueManual آن را می‌سنجد). */
  managerPassword?: string | null
  /** کد آماده (فقط تولید گروهی که کدها را یک‌جا ساخته است) */
  code?: string
  /** action دلخواه AuditLog (پیش‌فرض بر اساس نوع) */
  auditAction?: string
}

/**
 * قواعد نهاییِ یک اعتبار = پیش‌فرض نوعش (§۳) + Override هایی که *صریح* آمده‌اند.
 *
 * ⚠️ اعمال در Backend است نه UI (§۱۹): یک کاربر نمی‌تواند با تغییر `source` در
 * Request، قواعد نوع دیگری را بگیرد — چون همین تابع بر اساس `source` نهایی،
 * قواعد را از تنظیمات می‌خواند.
 */
/**
 * نشست ۱۴۳ · بند ۴-۲۸(د) و قاعده‌ی کلی بند ۵ — ورودی عددی صدور اعتبار نباید
 * بی‌صدا گرد/clamp شود. قبلاً مبلغ ۱۰۰٬۰۰۰٫۶ به ۱۰۰٬۰۰۱ و days منفی به «بدون
 * انقضا» تبدیل می‌شد؛ یعنی سندی صادر می‌شد که با درخواست کاربر نمی‌خواند.
 * `null/undefined` همان معنای قبلی («پیش‌فرض/ندارد») را نگه می‌دارد.
 */
function assertCreditInteger(value: unknown, label: string, unit: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  /**
   * نشست ۱۸۱ — `bigint` هم پذیرفته می‌شود، و این قاعده‌ی بالا را **ضعیف نمی‌کند**.
   *
   * هدف این نگهبان جلوگیری از «گرد شدن بی‌صدای ورودی کاربر» است (اعشار، منفی،
   * متن). بعد از مهاجرت بند ۴-۲۸ الف، بعضی صدازننده‌های داخلی مقدار را مستقیم
   * از دیتابیس می‌خوانند و آن مقدار `bigint` است — یعنی *ذاتاً* عدد صحیح، بدون
   * هیچ احتمال اعشار. رد کردنش فقط یک خطای دروغین می‌ساخت.
   *
   * محدوده همچنان سخت‌گیرانه چک می‌شود: `bigint` خارج از بازه هم رد می‌شود.
   */
  if (typeof value === 'bigint') {
    if (value < BigInt(min) || value > BigInt(max))
      throw new BusinessError(`${label} خارج از بازه‌ی مجاز است (${unit}).`)
    return Number(value)
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    const range =
      max === Number.MAX_SAFE_INTEGER
        ? `عدد صحیح ${min === 1 ? 'بزرگ‌تر از صفر' : min > 0 ? `حداقل ${faDigits(min)}` : 'غیرمنفی'} (${unit})`
        : `عدد صحیح بین ${faDigits(min)} تا ${faDigits(max)} ${unit}`
    throw new BusinessError(
      `${label} باید ${range} باشد؛ مقدار «${String(value)}» پذیرفته نیست ` +
        '(اعشار، منفی، متن، NaN یا عدد خارج از سقف امن گرد یا اصلاح نمی‌شود) و هیچ اعتباری صادر نشد.'
    )
  }
  return value
}

function validateIssueNumbers(input: IssueCreditInput): void {
  assertCreditInteger(input.amount, 'مبلغ اعتبار خرید', 'ریال', 1)
  if (input.days != null) assertCreditInteger(input.days, 'مدت اعتبار', 'روز', 0, 3650)
  if (input.maxUses != null) assertCreditInteger(input.maxUses, 'تعداد دفعات مصرف', 'بار', 1, MULTI_USE_UNLIMITED)
  if (input.minPurchase != null) assertCreditInteger(input.minPurchase, 'حداقل خرید', 'ریال', 0)
  if (input.maxPerTransaction != null) assertCreditInteger(input.maxPerTransaction, 'سقف مصرف در هر خرید', 'ریال', 0)
}

function resolveRules(
  settings: CreditSettings,
  source: string,
  input: IssueCreditInput
): { days: number | null; maxUses: number; multiUse: boolean; override: boolean; carryRemainder: boolean } {
  const rules = rulesForSource(settings, source)
  const days =
    input.days === undefined ? (rules.days > 0 ? rules.days : null) : input.days == null ? null : clampInt(input.days, 0, 3650, 0) || null
  const multiUse = input.multiUse == null ? rules.multiUse : input.multiUse === true
  let maxUses = input.maxUses == null ? rules.maxUses : clampInt(input.maxUses, 1, MULTI_USE_UNLIMITED, rules.maxUses)
  // «چندباره تا سقف مبلغ»: تعداد دفعات معنا ندارد، سقف واقعی مبلغ است
  if (multiUse && maxUses < 2) maxUses = MULTI_USE_UNLIMITED

  const restricted = normalizeRestrictScope(input.restrictScope) !== CreditRestrictScope.ALL
  const override =
    !!trimOrNull(input.overrideReason) ||
    maxUses !== rules.maxUses ||
    multiUse !== rules.multiUse ||
    restricted ||
    clampInt(input.minPurchase, 0, Number.MAX_SAFE_INTEGER, 0) > 0 ||
    clampInt(input.maxPerTransaction, 0, Number.MAX_SAFE_INTEGER, 0) > 0 ||
    input.customerLocked === true ||
    // مدت اعتبار فقط در صدور مدیریتی «استثنا» شمرده می‌شود؛ مسیر تعویض کالا
    // تاریخاً مدتش را از `saleDefaults.returnCodeDays` می‌گیرد، نه از این تنظیمات.
    (source === CreditSource.MANUAL && input.days !== undefined && (days ?? 0) !== rules.days)

  /**
   * نشست ۱۸۳ — قاعده‌ی باقی‌مانده از تنظیماتِ همان نوع می‌آید و مثل بقیه‌ی
   * قواعد، صدازننده می‌تواند صریح بازنویسی‌اش کند. وقتی `multiUse` روشن است
   * اصلاً معنا ندارد (باقی‌مانده روی همان رکورد می‌ماند)، پس `true` گذاشته
   * می‌شود تا داده‌ی گمراه‌کننده در رکورد ننشیند.
   */
  const carryRemainder = multiUse
    ? true
    : input.carryRemainder == null
      ? rules.carryRemainder
      : input.carryRemainder === true

  return { days, maxUses, multiUse, override, carryRemainder }
}

/**
 * صدور یک اعتبار جدید.
 *
 * پیش‌فرض‌ها عمداً «رفتار مو‌به‌موی قبل» است: `source = EXCHANGE`، یک‌بارمصرف،
 * بدون محدودیت. پس هر دو صدازننده‌ی تاریخی در `SalesService` (بازپرداخت برگشت و
 * مابه‌التفاوت تعویض) بدون تغییر همان اعتبار قبلی را می‌سازند.
 *
 * یکتایی کد: تصادم UNIQUE INDEX ⇒ کد تازه و retry (§۶). هیچ‌وقت «اعتبار بدون
 * کد» یا «کد بدون اعتبار» باقی نمی‌ماند، چون ساخت رکورد و کد یک دستور است (§۲۴).
 */
export async function issueStoreCredit(client: Client, input: IssueCreditInput): Promise<any> {
  // نشست ۱۴۳ — بدون گرد/clamp بی‌صدا؛ ورودی نامعتبر پیش از هر نوشتن رد می‌شود.
  validateIssueNumbers(input)
  const amount = input.amount

  const settings = input.settings ?? (await readCreditSettings(client))
  const source = normalizeCreditSource(input.source)
  const issuedAt = input.issuedAt ?? new Date()
  const rules = resolveRules(settings, source, input)
  const prefix = prefixFor(settings, source, input.prefix)
  const status = String(input.status ?? StoreCreditStatus.ACTIVE)
  if (status !== StoreCreditStatus.ACTIVE && status !== StoreCreditStatus.DRAFT)
    throw new BusinessError('اعتبار جدید فقط می‌تواند «فعال» یا «پیش‌نویس» ساخته شود.')

  const scope = normalizeRestrictScope(input.restrictScope)
  const categoryIds = scope === CreditRestrictScope.CATEGORY ? parseIdList(input.restrictCategoryIds) : []
  const variantIds = scope === CreditRestrictScope.VARIANTS ? parseIdList(input.restrictVariantIds) : []
  if (scope === CreditRestrictScope.CATEGORY && !categoryIds.length)
    throw new BusinessError('برای محدود کردن اعتبار به دسته‌بندی، حداقل یک دسته‌بندی انتخاب کنید.')
  if (scope === CreditRestrictScope.VARIANTS && !variantIds.length)
    throw new BusinessError('برای محدود کردن اعتبار به کالا، حداقل یک کالا انتخاب کنید.')

  const data = {
    amount,
    source,
    issuedAt,
    issuedAtJalali: toJalaliDate(issuedAt),
    issuedAtTime: toClock(issuedAt),
    status,
    maxUses: rules.maxUses,
    multiUse: rules.multiUse,
    // نشست ۱۸۳ — قاعده‌ی باقی‌مانده در لحظه‌ی صدور قفل می‌شود (نه لحظه‌ی مصرف)
    carryRemainder: rules.carryRemainder,
    usedAmount: 0,
    usedCount: 0,
    settingsOverride: rules.override,
    overrideReason: trimOrNull(input.overrideReason),
    issuedDays: rules.days ?? null,
    restrictScope: scope,
    restrictCategoryIdsJson: categoryIds.length ? JSON.stringify(categoryIds) : null,
    restrictVariantIdsJson: variantIds.length ? JSON.stringify(variantIds) : null,
    minPurchase: clampInt(input.minPurchase, 0, Number.MAX_SAFE_INTEGER, 0),
    maxPerTransaction: clampInt(input.maxPerTransaction, 0, Number.MAX_SAFE_INTEGER, 0),
    customerLocked: input.customerLocked === true,
    holderCompany: trimOrNull(input.holderCompany),
    holderNationalId: trimOrNull(input.holderNationalId),
    holderPhone: trimOrNull(input.holderPhone),
    holderAddress: trimOrNull(input.holderAddress),
    holderAgent: trimOrNull(input.holderAgent),
    holderNote: trimOrNull(input.holderNote),
    batchId: input.batchId ?? null,
    prefix: prefix || null,
    reminderOptOut: input.reminderOptOut === true,
    returnId: input.returnId ?? null,
    exchangeInvoiceId: input.exchangeInvoiceId ?? null,
    sourceInvoiceId: input.sourceInvoiceId ?? null,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    note: input.note ?? null,
    userId: input.userId ?? null
  }

  /**
   * -------------------------------------------------------------------------
   * بند ۳ (جلسه ۳۰) · §۶ — پیش‌سنجش فضای کد در مسیر **تکی** هم اجرا می‌شود.
   *
   * تا جلسه ۲۹ فقط retry loop پایین وجود داشت: یعنی وقتی فضای کدهای ممکن پر
   * می‌شد، کاربر ۸ بار تصادم می‌خورد و بعد یک خطای عمومی می‌دید، در حالی که
   * مسیر گروهی (`bulkIssueCredits`) از قبل با `assertCodeSpace` *قبل از شروع*
   * پیام دقیق و پیشنهاد طول می‌داد. حالا هر دو مسیر یک رفتار دارند و «افزایش
   * خودکار طول» در صدور تکی هم اعمال و در note همان AuditLog صدور دیده می‌شود.
   *
   * ⚠️ `input.code` که از پیش آمده باشد (مسیر گروهی، کدها یک‌جا ساخته شده‌اند)
   * پیش‌سنجش را *دوباره* اجرا نمی‌کند — `needsCodeSpaceCheck` همین تصمیم است.
   * -------------------------------------------------------------------------
   */
  const requestedLength = clampInt(input.length ?? settings.codeLength, MIN_CODE, MAX_CODE, settings.codeLength)
  let codeLength = input.length
  let growth = codeGrowthOf(requestedLength, requestedLength)
  if (needsCodeSpaceCheck(input.code)) {
    const space = await assertCodeSpace(client, {
      count: 1,
      settings,
      prefix,
      length: requestedLength,
      userId: input.userId ?? null
    })
    codeLength = space.length
    growth = codeGrowthOf(requestedLength, space.length)
  }

  let created: any = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 8 && !created; attempt++) {
    const generated =
      input.code && attempt === 0
        ? { code: normalizeCreditCode(input.code), expiresAt: rules.days ? new Date(issuedAt.getTime() + rules.days * DAY_MS) : null }
        : await generateStoreCreditCode(client, {
            length: codeLength,
            days: rules.days,
            issuedAt,
            source,
            prefix,
            settings
          })
    const code = generated.code
    // نشست ۱۸۲: انقضای دقیقِ به‌ارث‌رسیده بر محاسبه‌ی روزشمار اولویت دارد
    const expiresAt = input.expiresAtExact !== undefined ? input.expiresAtExact : generated.expiresAt
    try {
      created = await client.storeCredit.create({
        data: { ...data, code, expiresAt, expiresAtJalali: expiresAt ? toJalaliDate(expiresAt) : null }
      })
    } catch (e) {
      lastError = e
      if (!isP2002(e)) throw e
      // کد در همان میلی‌ثانیه توسط کاربر دیگری گرفته شد ⇒ کد تازه (§۶)
    }
  }
  if (!created) {
    console.error('[credit] unique code retries exhausted', lastError)
    throw new BusinessError(
      'تولید کد یکتا برای این اعتبار ممکن نشد، پس هیچ اعتباری ثبت نشد.\n' +
        'در «تنظیمات اعتبار خرید» طول کد را بیشتر کنید و دوباره تلاش کنید.'
    )
  }

  await audit(client, {
    action: input.auditAction ?? (source === CreditSource.MANUAL ? AuditAction.CREDIT_ISSUE_MANUAL : AuditAction.STORE_CREDIT_ISSUE),
    entity: 'StoreCredit',
    entityId: created.id,
    userId: input.userId ?? null,
    after: JSON.stringify({
      creditId: created.id,
      publicReference: `اعتبار #${created.id}`,
      codeLength: created.code.length,
      amount,
      source,
      status,
      maxUses: rules.maxUses,
      multiUse: rules.multiUse,
      restrictScope: scope,
      expiresAtJalali: created.expiresAtJalali,
      batchId: input.batchId ?? null,
      returnId: input.returnId ?? null,
      exchangeInvoiceId: input.exchangeInvoiceId ?? null,
      lengthGrown: growth.grown
    }),
    note:
      `صدور اعتبار #${created.id} (${CREDIT_SOURCE_LABELS[source] ?? source}) به مبلغ ${money(amount)} ریال` +
      // §۶ — رشد خودکار طول کد باید در همان سند صدور دیده شود (مسیر گروهی هم همین را می‌نویسد)
      (growth.grown ? ` · طول کد خودکار از ${faDigits(growth.from)} به ${faDigits(growth.to)} افزایش یافت` : '') +
      (created.expiresAtJalali ? ` · اعتبار تا ${faDigits(created.expiresAtJalali)}` : ' · بدون انقضا') +
      (rules.multiUse ? ` · چندباره (تا ${faDigits(rules.maxUses)} بار)` : ' · یک‌بارمصرف') +
      (scope !== CreditRestrictScope.ALL ? ` · ${CREDIT_SCOPE_LABELS[scope]}` : '') +
      (rules.override ? ` · با استثنا${trimOrNull(input.overrideReason) ? `: ${input.overrideReason}` : ''}` : '')
  })

  return created
}

// ---------------------------------------------------------------------------
// ۴) پیدا کردن اعتبار و قفل موقت کد (§۸)
// ---------------------------------------------------------------------------

/** پیام فارسیِ «چرا این اعتبار قابل استفاده نیست» بر اساس وضعیت مؤثرش. */
function notRedeemableMessage(row: any): string {
  const status = effectiveStatus({
    amount: asNum(row.amount),
    usedAmount: asNum(row.usedAmount),
    usedCount: asNum(row.usedCount),
    maxUses: asNum(row.maxUses),
    multiUse: row.multiUse === true,
    status: String(row.status),
    expiresAt: row.expiresAt ?? null
  })
  const code = row.code
  /**
   * جلسه ۳۵ — یافته‌ی هارنس واقعی: اعتبارِ «چندباره» وقتی *دفعاتش* تمام می‌شود
   * ولی هنوز مبلغ دارد، وضعیتش USED می‌شود (درست است — `statusAfterRedeem`) و
   * صندوق‌دار پیام «کامل مصرف شده است» می‌گرفت، در حالی که چند میلیون ریال روی
   * همان اعتبار مانده بود. پیام غلط نبود، ولی *دلیل واقعی* را پنهان می‌کرد و
   * صندوق‌دار را می‌فرستاد سراغ توضیح اشتباه به مشتری. حالا همین حالت پیام خودش
   * را دارد، با عدد دفعات و مبلغ باقی‌مانده.
   */
  const remainingNow = remainingOf({
    amount: asNum(row.amount),
    usedAmount: asNum(row.usedAmount),
    status: String(row.status)
  })
  if (
    status === StoreCreditStatus.USED &&
    row.multiUse === true &&
    remainingNow > 0 &&
    usesLeftOf({ amount: asNum(row.amount), maxUses: asNum(row.maxUses), usedCount: asNum(row.usedCount), status: String(row.status) }) <= 0
  )
    return (
      `دفعات مجاز استفاده از این اعتبار (${code}) تمام شده است — ${faDigits(Math.round(asNum(row.maxUses)))} بار مصرف شده.\n` +
      `مبلغ باقی‌مانده‌اش ${money(remainingNow)} ریال است ولی با این قواعد قابل استفاده نیست؛ ` +
      'برای افزایش سقف دفعات یا صدور اعتبار تازه با مدیر هماهنگ کنید.'
    )
  if (status === StoreCreditStatus.USED)
    return (
      `این اعتبار (${code}) کامل مصرف شده است` +
      (row.usedReceiptNo ? ` — آخرین مصرف روی فاکتور شماره ${faDigits(row.usedReceiptNo)}` : '') +
      (row.usedAtJalali ? ` در تاریخ ${faDigits(row.usedAtJalali)}` : '') +
      '.'
    )
  if (status === StoreCreditStatus.CANCELED)
    return `این اعتبار (${code}) باطل شده است و قابل استفاده نیست.` + (row.voidedReason ? `\nدلیل ابطال: ${row.voidedReason}` : '')
  if (status === StoreCreditStatus.SUSPENDED)
    return `این اعتبار (${code}) «معلق» است و تا فعال‌سازی دوباره توسط مدیر قابل استفاده نیست.`
  if (status === StoreCreditStatus.DRAFT) return `این اعتبار (${code}) هنوز پیش‌نویس است و صادر نشده.`
  return (
    `اعتبار این کد (${code}) تمام شده است` +
    (row.expiresAtJalali ? ` — مهلتش ${faDigits(row.expiresAtJalali)} به پایان رسیده بود` : '') +
    `.\nمبلغ باقی‌مانده‌ی این اعتبار ${money(remainingOf({ amount: asNum(row.amount), usedAmount: asNum(row.usedAmount), status: String(row.status) }))} ریال بود؛ برای تصمیم‌گیری با مدیر هماهنگ کنید.`
  )
}

/**
 * پیدا کردن یک اعتبارِ *قابل‌مصرف* با کد.
 *
 * `code` حالا در دیتابیس یکتاست، پس جست‌وجو قطعی است. اگر کدِ اسکن‌شده پیدا
 * نشد، `legacyCode` هم چک می‌شود: در migration جلسه ۲۰ کدهای تکراریِ تاریخی
 * بی‌تصادم شدند و کد اصلی‌شان در `legacyCode` نگه داشته شد، پس کاغذی که دست
 * مشتری است هنوز کار می‌کند.
 *
 * اعتبارهای آرشیو‌شده (`deletedAt`) هیچ‌وقت مصرف نمی‌شوند.
 */
export async function findRedeemable(client: Client, rawCode: string): Promise<any> {
  const code = normalizeCreditCode(rawCode) || normalizeReturnCode(rawCode)
  if (!code) throw new BusinessError('بارکد اعتبار را اسکن کنید یا کدش را وارد کنید.')

  let rows = await client.storeCredit.findMany({ where: { code, deletedAt: null }, orderBy: CREDIT_ORDER_BY.codeLookup })
  if (!rows.length)
    rows = await client.storeCredit.findMany({ where: { legacyCode: code, deletedAt: null }, orderBy: CREDIT_ORDER_BY.codeLookup })
  if (!rows.length)
    throw new BusinessError(
      `اعتباری با کد «${code}» پیدا نشد. کد را دوباره وارد کنید یا بارکد روی سند اعتبار را اسکن کنید.`
    )

  const now = Date.now()
  const usable = rows.find((r) => {
    const status = effectiveStatus(
      {
        amount: asNum(r.amount),
        usedAmount: asNum(r.usedAmount),
        usedCount: asNum(r.usedCount),
        maxUses: asNum(r.maxUses),
        multiUse: r.multiUse === true,
        status: String(r.status),
        expiresAt: r.expiresAt ?? null
      },
      now
    )
    return REDEEMABLE_STATUSES.includes(status) && remainingOf({ amount: asNum(r.amount), usedAmount: asNum(r.usedAmount), status: String(r.status) }) > 0
  })
  if (usable) return usable
  throw new BusinessError(notRedeemableMessage(rows[0]))
}

/**
 * ⚠️ نقطه‌ی اعمال «Rate Limit + قفل موقت» ورود کد اعتبار (§۸).
 *
 * **همیشه بیرون از تراکنش** صدا زده می‌شود (قاعده‌ی ثبت‌شده‌ی جلسه ۲۰: نوشتن با
 * کلاینت سراسری وسط تراکنشِ باز = بن‌بست SQLite). کارش:
 *   ۱) اگر گیت قفل است، همان‌جا با پیام فارسی و زمان باقی‌مانده متوقف می‌کند.
 *   ۲) کد را *فقط جست‌وجو* می‌کند (هیچ چیزی مصرف نمی‌شود).
 *   ۳) کد اشتباه/غیرقابل‌استفاده ⇒ یک تلاش ناموفق ثبت می‌شود (و بعد از N بار،
 *      قفل موقت روی همان `AuthLockout`). کد درست ⇒ شمارنده صفر می‌شود.
 *
 * پس حدس‌زدن کد (brute-force) دقیقاً مثل حدس‌زدن رمز دوم پنل‌ها قفل می‌خورد،
 * بدون این‌که سیستم Rate Limit دومی ساخته شود.
 */
export async function guardCreditCode(rawCode: string, userId?: number | null): Promise<any> {
  // RE-AUDIT-HIGH-01: check، lookup و افزایش شمارنده باید یک تلاش سری باشند؛
  // جدا بودن این سه await به درخواست‌های هم‌زمان اجازه می‌داد failCount را گم کنند.
  return withCreditCodeGateAttempt(async () => {
    await assertCreditCodeGateOpen()
    try {
      const row = await findRedeemable(prisma, rawCode)
      await noteCreditCodeSuccess()
      return row
    } catch (e) {
      const base = e instanceof BusinessError ? e.message : 'کد اعتبار پیدا نشد.'
      const message = await noteCreditCodeFailure(base)
      await audit(prisma, {
        action: AuditAction.CREDIT_REDEEM_BLOCKED,
        entity: 'StoreCredit',
        userId: userId ?? null,
        after: JSON.stringify({ codeLength: normalizeCreditCode(rawCode).length, credentialRedacted: true }),
        note: `تلاش ناموفق برای استفاده از کد اعتبار · ${base.split('\n')[0]}`
      })
      throw new BusinessError(message)
    }
  })
}

// ---------------------------------------------------------------------------
// ۵) مصرف اعتبار — اتمیک، ضد‌همزمانی، Idempotent (§۴، §۹، §۲۱)
// ---------------------------------------------------------------------------

export interface RedeemCreditInput {
  code: string
  invoiceId: number
  receiptNo: number
  /** سقف مبلغ قابل‌جذب این فاکتور (خالی = کل باقی‌مانده‌ی اعتبار) */
  applicable?: number | null
  /** جمع کل فاکتور — مبنای «حداقل مبلغ خرید» (§۱۸) */
  invoiceTotal?: number | null
  /** مبلغ درخواستی کاربر در پرداخت ترکیبی (خالی = حداکثر ممکن) */
  requested?: number | null
  customerId?: number | null
  customerName?: string | null
  userId?: number | null
  usedAt?: Date
  seq?: number
  shiftId?: number | null
  /** کلید Idempotency همان درخواست (§۲۱) — تکرارش دوباره کم نمی‌کند */
  idempotencyKey?: string | null
  /**
   * اقلام سبد. عمداً اختیاری است و **پیش‌فرض نادیده گرفته می‌شود**: اقلام واقعی
   * از دیتابیس خوانده می‌شوند (`linesForInvoice`). فقط برای پیش‌نمایشِ قبل از
   * ثبت فاکتور (که هنوز ردیفی در دیتابیس ندارد) استفاده می‌شود.
   */
  lines?: readonly CreditCartLine[]
  note?: string | null
}

export interface RedeemCreditResult {
  credit: any
  payment: any
  applied: number
  remainder: any | null
  redemption: any | null
  /** این نتیجه از روی کلید Idempotency برگردانده شد (هیچ کسری دوباره‌ای نشد) */
  replayed: boolean
  notes: string[]
}

/**
 * -------------------------------------------------------------------------
 * مصرف یک اعتبار روی یک فاکتور (داخل تراکنش ثبت فاکتور).
 *
 * سه لایه‌ی محافظت، هر سه لازم:
 *
 *   ۱) **Idempotency** (§۲۱): اگر همان درخواست با همان `idempotencyKey` دوباره
 *      برسد (دوبار کلیک، Timeout، Replay)، ردیف قبلی برگردانده می‌شود و هیچ
 *      مبلغی دوباره کم نمی‌شود. تضمینش UNIQUE بودن `idempotencyKey` در دیتابیس
 *      است، نه یک چک اپلیکیشنی.
 *
 *   ۲) **تصمیم واحد** (§۴): `decideRedeem` همه‌ی شرط‌ها را با هم می‌سنجد
 *      (وضعیت، انقضا، باقی‌مانده، دفعات، قفل مشتری، حداقل خرید، محدودیت
 *      کالا/دسته، سقف هر تراکنش) و عددِ `applied` را می‌دهد. ما هیچ عددی از UI
 *      نمی‌پذیریم.
 *
 *   ۳) **شرط خوش‌بینانه روی همان UPDATE** (§۹): `updateMany` با شرط
 *      `{ status ∈ قابل‌مصرف, usedAmount: قبلی, usedCount: قبلی }`. اگر
 *      `count !== 1` باشد یعنی یک صندوق دیگر در همان لحظه همین اعتبار را خرج
 *      کرده ⇒ همین‌جا متوقف می‌شویم. پس موجودی هیچ‌وقت منفی و دفعات هیچ‌وقت
 *      بیشتر از سقف نمی‌شود، حتی با دو درخواست تقریباً هم‌زمان.
 * -------------------------------------------------------------------------
 */
export async function redeemStoreCredit(client: Client, input: RedeemCreditInput): Promise<RedeemCreditResult> {
  const usedAt = input.usedAt ?? new Date()
  const key = trimOrNull(input.idempotencyKey)

  // ---- لایه ۱: همین درخواست قبلاً انجام شده است؟ ----
  if (key) {
    const prior = await client.storeCreditRedemption.findUnique({ where: { idempotencyKey: key } })
    if (prior) {
      /**
       * نشست ۲۱۲ — replay فقط برای *همان فاکتور* امن است. کلید تکراری روی
       * فاکتور دیگر پرداخت نمی‌سازد ولی UI را SETTLED نشان می‌دهد و اعتبار
       * کم نمی‌شود.
       */
      if (Number(prior.invoiceId) !== Number(input.invoiceId))
        throw new BusinessError(
          'این کلید تکرار درخواست قبلاً برای فاکتور دیگری استفاده شده است؛ اعتبار خرج نشد. صفحه را تازه کنید و دوباره ثبت کنید.'
        )
      const credit = await client.storeCredit.findUnique({ where: { id: prior.creditId } })
      const payment = prior.paymentId
        ? await client.payment.findUnique({ where: { id: prior.paymentId }, include: { method: true } })
        : null
      return {
        credit,
        payment,
        applied: toNumberRial(prior.amount),
        remainder: null,
        redemption: prior,
        replayed: true,
        notes: ['این درخواست قبلاً ثبت شده بود، پس دوباره از اعتبار کم نشد.']
      }
    }
  }

  const credit = await findRedeemable(client, input.code)

  // ---- فاکتور مرجع باید معتبر باشد (§۸: اعتبار روی فاکتور باطل خرج نمی‌شود) ----
  const invoice = await client.saleInvoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, status: true, grandTotal: true, receiptNo: true, customerId: true }
  })
  if (!invoice)
    throw new BusinessError('فاکتور مرجع این مصرف پیدا نشد، پس اعتبار خرج نشد. صفحه را تازه کنید و دوباره تلاش کنید.')
  if (invoice.status === SaleStatus.CANCELED)
    throw new BusinessError(
      `فاکتور شماره ${faDigits(invoice.receiptNo)} باطل شده است، پس اعتبار «${credit.code}» روی آن قابل استفاده نیست.`
    )

  // ---- لایه ۲: تصمیم واحد، با اقلام واقعیِ دیتابیس (نه ورودی UI) ----
  const dbLines = await linesForInvoice(client, input.invoiceId)
  const lines = dbLines.length ? dbLines : (input.lines ?? [])
  const decision = decideRedeem(credit, {
    now: usedAt,
    applicable: input.applicable == null ? remainingOf(credit) : Math.max(0, Math.round(Number(input.applicable) || 0)),
    invoiceTotal:
      input.invoiceTotal == null ? toNumberRial(invoice.grandTotal) : Math.round(Number(input.invoiceTotal) || 0),
    lines,
    customerId: input.customerId ?? invoice.customerId ?? null,
    requested: input.requested ?? null
  })
  if (!decision.ok) {
    await audit(client, {
      action: AuditAction.CREDIT_REDEEM_BLOCKED,
      entity: 'StoreCredit',
      entityId: credit.id,
      userId: input.userId ?? null,
      before: JSON.stringify({
        creditId: credit.id,
        status: credit.status,
        remaining: decision.remainingBefore,
        usesLeft: decision.usesLeft
      }),
      after: JSON.stringify({ invoiceId: input.invoiceId, receiptNo: input.receiptNo, requested: input.requested ?? null }),
      note: `مصرف اعتبار #${credit.id} رد شد · ${String(decision.error ?? '').split('\n')[0]}`
    })
    throw new BusinessError(decision.error ?? 'این اعتبار روی این فاکتور قابل استفاده نیست.')
  }

  const applied = decision.applied
  const usedAmountBefore = Math.max(0, Math.round(asNum(credit.usedAmount)))
  const usedCountBefore = Math.max(0, Math.round(asNum(credit.usedCount)))
  const nextStatus = statusAfterRedeem(credit, applied)
  if (!canCreditTransition(String(credit.status), nextStatus))
    throw new BusinessError(transitionError(String(credit.status), nextStatus))

  // ---- لایه ۳: کسر اتمیک با شرط خوش‌بینانه ----
  const marked = await client.storeCredit.updateMany({
    where: {
      id: credit.id,
      status: { in: [...REDEEMABLE_STATUSES] },
      usedAmount: usedAmountBefore,
      usedCount: usedCountBefore,
      deletedAt: null
    },
    data: {
      status: nextStatus,
      usedAmount: usedAmountBefore + applied,
      usedCount: usedCountBefore + 1,
      usedAt,
      usedAtJalali: toJalaliDate(usedAt),
      usedAtTime: toClock(usedAt),
      usedInvoiceId: input.invoiceId,
      usedReceiptNo: input.receiptNo
    }
  })
  if (marked.count !== 1)
    throw new BusinessError(
      `اعتبار «${credit.code}» همین لحظه روی فاکتور دیگری مصرف شد، پس روی این فاکتور ثبت نمی‌شود.\n` +
        'فهرست اعتبارها را تازه کنید و باقی‌مانده‌ی واقعی را ببینید.'
    )

  const methodId = await nonCashMethodId(client, STORE_CREDIT_METHOD_KEY)
  const createdAt = new Date()
  const payment = await client.payment.create({
    data: {
      invoiceId: input.invoiceId,
      methodId,
      amount: applied,
      kind: PaymentEntryKind.CASH,
      seq: input.seq ?? 1,
      paidAt: usedAt,
      createdAt,
      createdByUserId: input.userId ?? null,
      createdShiftId: input.shiftId ?? null,
      paidAtJalali: toJalaliDate(usedAt),
      paidAtTime: toClock(usedAt),
      reference: credit.code,
      storeCreditId: credit.id,
      note: input.note ?? `مصرف اعتبار خرید «${credit.code}»`
    },
    include: { method: true }
  })

  const remainderAfter = Math.max(0, Math.round(asNum(credit.amount)) - (usedAmountBefore + applied))

  /**
   * دفتر مصرف (§۴): «چندباره» یعنی یک اعتبار N مصرف دارد و هر مصرف مبلغ،
   * فاکتور، پرداختی و کاربر خودش را می‌خواهد. ستون‌های `used*` روی خود
   * StoreCredit دست‌نخورده ماندند و «آخرین مصرف» را نشان می‌دهند، تا هیچ گزارش
   * قدیمی نشکند.
   */
  let redemption: any = null
  try {
    redemption = await client.storeCreditRedemption.create({
      data: {
        creditId: credit.id,
        code: credit.code,
        amount: applied,
        remainderAfter,
        seq: usedCountBefore + 1,
        invoiceId: input.invoiceId,
        receiptNo: input.receiptNo,
        paymentId: payment.id,
        at: usedAt,
        atJalali: toJalaliDate(usedAt),
        atTime: toClock(usedAt),
        userId: input.userId ?? null,
        shiftId: input.shiftId ?? null,
        idempotencyKey: key,
        note: input.note ?? null
      }
    })
  } catch (e) {
    if (isP2002(e))
      throw new BusinessError(
        'همین درخواست مصرف اعتبار در همان لحظه ثبت شده بود، پس دوباره ثبت نشد و هیچ مبلغی دوباره کم نشد.'
      )
    throw e
  }

  await client.storeCredit.update({ where: { id: credit.id }, data: { usedPaymentId: payment.id } })

  /**
   * باقی‌مانده:
   *   • یک‌بارمصرف ⇒ مثل تمام نسخه‌های قبل، باقی‌مانده به شکل یک اعتبار *جدید*
   *     به مشتری برمی‌گردد (سوخت نمی‌شود) و با `remainderCreditId` گره می‌خورد.
   *   • چندباره ⇒ باقی‌مانده روی همان رکورد می‌ماند؛ ساختن اعتبار جدید اینجا
   *     یعنی شکستن مفهوم «چندباره تا سقف مبلغ».
   */
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۶ — دیگر **هیچ بارکد جانشینی** ساخته نمی‌شود.
   *
   * تا نشست ۱۸۳ اگر اعتبار یک‌بارمصرف بود و مشتری کمتر خرج می‌کرد، باقی‌مانده
   * به شکل یک اعتبار *جدید* صادر می‌شد. پول نمی‌سوخت (خواسته‌ی مالک) ولی یک
   * رکورد جانشین ساخته می‌شد که پرامپت صریحاً منعش کرده: «بدون ساخت رکورد
   * باقی‌مانده‌ی جدا؛ مصرف و مانده در ledger enforce شود».
   *
   * هر دو خواسته با هم جمع شدند: باقی‌مانده روی **همان** بارکد می‌ماند و
   * وضعیتش `PARTIALLY_USED` می‌شود (`statusAfterRedeem`). مانده همیشه
   * `amount − usedAmount` است و `StoreCreditRedemption` دفترِ مصرف را نگه
   * می‌دارد — یعنی همان ledger.
   *
   * مزیت جانبی: مشتری دیگر لازم نیست بارکد تازه بگیرد و بارکد قدیمی‌اش را
   * دور بیندازد؛ همان کاغذ تا ته پول کار می‌کند.
   *
   * ⚠️ رکوردهای `remainderCreditId` که *در گذشته* ساخته شده‌اند دست‌نخورده
   * می‌مانند و معتبرند. تصمیم عمدی: مهاجرت داده انجام نمی‌شود، چون آن بارکدها
   * ممکن است همین حالا دست مشتری باشند و باطل کردنشان یعنی سوزاندن پولی که
   * قبلاً به او وعده داده‌ایم.
   */
  const leftover = Math.max(0, Math.round(asNum(credit.amount)) - usedAmountBefore - applied)
  const remainder: any = null

  await audit(client, {
    action: AuditAction.STORE_CREDIT_REDEEM,
    entity: 'StoreCredit',
    entityId: credit.id,
    userId: input.userId ?? null,
    before: JSON.stringify({
      creditId: credit.id,
      status: credit.status,
      usedAmount: usedAmountBefore,
      usedCount: usedCountBefore,
      remaining: decision.remainingBefore
    }),
    after: JSON.stringify({
      applied,
      status: nextStatus,
      usedAmount: usedAmountBefore + applied,
      usedCount: usedCountBefore + 1,
      remainderAfter,
      invoiceId: input.invoiceId,
      receiptNo: input.receiptNo,
      paymentId: payment.id,
      idempotencyKey: key,
      remainderCreditId: remainder?.id ?? null
    }),
    note:
      `مصرف اعتبار #${credit.id} به مبلغ ${money(applied)} ریال روی فاکتور ${faDigits(input.receiptNo)}` +
      ` · باقی‌مانده ${money(remainderAfter)} ریال · دفعه‌ی ${faDigits(usedCountBefore + 1)}` +
      (remainder ? ` · ${money(leftover)} ریال باقی‌مانده به مشتری داده شد` : '') +
      ' · این مبلغ پول نقد نیست و در «خالص واقعی دریافتی» شمرده نمی‌شود'
  })

  return {
    credit: {
      ...credit,
      status: nextStatus,
      usedAmount: usedAmountBefore + applied,
      usedCount: usedCountBefore + 1,
      usedAt,
      usedAtJalali: toJalaliDate(usedAt),
      usedAtTime: toClock(usedAt),
      usedInvoiceId: input.invoiceId,
      usedReceiptNo: input.receiptNo,
      usedPaymentId: payment.id
    },
    payment,
    applied,
    remainder,
    redemption,
    replayed: false,
    notes: decision.notes
  }
}

/**
 * برگشت مصرف‌های یک فاکتور، وقتی خود فاکتور Refund/Reverse/باطل می‌شود (§۸).
 *
 * منطقش عمداً «برگرداندن مبلغ روی همان اعتبار» است، نه ساختن اعتبار جدید: کاری
 * که انجام نشده نباید سابقه‌ی جدید بسازد. ردیف دفتر مصرف حذف نمی‌شود، فقط
 * `reversedAt` می‌خورد تا سابقه‌ی حسابداری کامل بماند.
 *
 * مصرف‌کننده‌های واقعی (سند به‌روز است — جلسه ۲۸):
 *   • `SalesService.createReturn` برای **برگشت کامل** فاکتور (از جلسه ۲۱).
 *   • `SalesService.purge` قبل از **حذف گزارشات فروش** (از جلسه ۲۸ — §۸).
 * هر دو مسیر این تابع را داخل تراکنش خودشان صدا می‌زنند، پس برگشت اعتبار و
 * تغییر/حذف فاکتور اتمیک‌اند. برگشت جزئی عمداً دفتر مصرف را دست نمی‌زند.
 */
export async function reverseInvoiceRedemptions(
  client: Client,
  input: { invoiceId: number; reason?: string | null; userId?: number | null; redemptionIds?: number[] }
): Promise<number> {
  /**
   * ممیزی A88-02 — `redemptionIds` برگشت را به همان ردیف(های) دفتر مصرفِ یک پرداخت
   * محدود می‌کند (ابطال تک‌پرداختِ اعتباری)، بدون دست زدن به مصرف‌های دیگر همان فاکتور.
   */
  const rows = await client.storeCreditRedemption.findMany({
    where: {
      invoiceId: input.invoiceId,
      reversedAt: null,
      ...(input.redemptionIds ? { id: { in: input.redemptionIds } } : {})
    }
  })
  if (!rows.length) return 0
  const now = new Date()
  let reversed = 0

  for (const r of rows) {
    const credit = await client.storeCredit.findUnique({ where: { id: r.creditId } })
    if (!credit) continue
    /**
     * جلسه ۲۹ · §۱۱ — وضعیت دیگر «مستقیم» نوشته نمی‌شود.
     *
     * نسخه‌ی قبلی خودش وضعیت بعدی را حساب می‌کرد و بی‌هیچ اعتبارسنجی
     * می‌نوشت (تنها محافظش یک `if` دستی برای CANCELED بود). حالا تصمیم از
     * `planRedemptionReversal` می‌آید که Transition را با جدول *مخصوص برگشت*
     * (`CREDIT_REVERSAL_TRANSITIONS`) می‌سنجد: `USED ⇒ ACTIVE` فقط از همین
     * مسیر مجاز است، `CANCELED` پایانی می‌ماند و `SUSPENDED` هم با برگشت
     * فاکتور از تعلیق در نمی‌آید. اگر Transition مجاز نبود، مبلغ و دفعات
     * برمی‌گردند ولی وضعیت دست‌نخورده می‌ماند و *دلیلش* در AuditLog می‌نشیند
     * (قبلاً بی‌صدا رد می‌شد).
     */
    const plan = planRedemptionReversal(
      {
        amount: asNum(credit.amount),
        usedAmount: asNum(credit.usedAmount),
        usedCount: asNum(credit.usedCount),
        status: String(credit.status),
        expiresAt: credit.expiresAt
      },
      asNum(r.amount),
      now
    )
    await client.storeCredit.update({
      where: { id: credit.id },
      data: { usedAmount: plan.usedAmount, usedCount: plan.usedCount, status: plan.status }
    })
    await client.storeCreditRedemption.update({
      where: { id: r.id },
      data: { reversedAt: now, reversedReason: input.reason ?? 'برگشت/ابطال فاکتور مرجع' }
    })
    await audit(client, {
      action: AuditAction.CREDIT_REACTIVATE,
      entity: 'StoreCredit',
      entityId: credit.id,
      userId: input.userId ?? null,
      before: JSON.stringify({ usedAmount: credit.usedAmount, usedCount: credit.usedCount, status: credit.status }),
      after: JSON.stringify({
        usedAmount: plan.usedAmount,
        usedCount: plan.usedCount,
        status: plan.status,
        proposedStatus: plan.proposed,
        transitionBlocked: plan.blocked
      }),
      note:
        `برگشت مصرف اعتبار #${credit.id} به مبلغ ${money(asNum(r.amount))} ریال، چون فاکتور مرجع برگشت/باطل شد` +
        (input.reason ? ` · دلیل: ${input.reason}` : '') +
        (plan.blocked ? ` · ${plan.blocked}` : '')
    })
    reversed++
  }
  return reversed
}

// ---------------------------------------------------------------------------
// ۶) عملیات مدیریتی (§۸، §۱۰، §۱۱) — همه با رمز مدیر و Audit مقدار قبل/بعد
// ---------------------------------------------------------------------------

/**
 * نشست ۱۵۰ · بند ۴-۲۸(د) — عددهای عملیات مدیریتی اعتبار (ستون‌های Prisma Int).
 * هیچ گرد/clamp بی‌صدایی نیست: خارج از بازه ⇒ رد فارسی با مقدار و بازه‌ی مجاز.
 * همیشه *پیش از* رمز مدیر صدا زده می‌شود (مثل S147-a) تا پیام درست دیده شود.
 */
const CREDIT_INT_MAX = 2_147_483_647
function assertCreditInt(raw: unknown, label: string, min: number, max: number = CREDIT_INT_MAX, unit = ''): number {
  const shown = typeof raw === 'number' ? faDigits(String(raw)) : String(raw)
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min)
    throw new BusinessError(
      `${label} باید عدد صحیح ${min <= 0 ? 'صفر یا بیشتر' : `${money(min)} یا بیشتر`}${max < CREDIT_INT_MAX ? ` و حداکثر ${money(max)}` : ''}${unit} باشد؛ ` +
        `مقدار «${shown}» پذیرفته نیست (اعشار، منفی یا متن گرد/محدود نمی‌شود). هیچ تغییری ذخیره نشد.`
    )
  if (raw > max)
    throw new BusinessError(
      max < CREDIT_INT_MAX
        ? `${label} باید عدد صحیح حداکثر ${money(max)}${unit} باشد؛ «${shown}» پذیرفته نیست (بی‌صدا به ${money(max)} محدود نمی‌شود). هیچ تغییری ذخیره نشد.`
        : `${label} (${money(raw)}${unit}) از سقف مجاز ${money(CREDIT_INT_MAX)} ریال بیشتر است. هیچ تغییری ذخیره نشد.`
    )
  return raw
}

/** نشست ۱۵۰ — شناسه‌ی اعتبار: فقط عدد صحیح مثبت؛ ۱٫۵ دیگر به اعتبار #۲ گرد نمی‌شود. */
function assertCreditId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    throw new BusinessError(
      `شناسه‌ی اعتبار نامعتبر است («${String(id)}»)؛ اعتبار دیگری به‌جای آن بارگذاری یا تغییر داده نمی‌شود. فهرست را تازه کنید.`
    )
  return id
}

async function loadCredit(client: Client, id: number): Promise<any> {
  const row = await client.storeCredit.findUnique({ where: { id: assertCreditId(id) } })
  if (!row) throw new BusinessError('این اعتبار پیدا نشد؛ ممکن است حذف شده باشد. فهرست را تازه کنید.')
  return row
}

/** دلیل تغییر، در عملیات مدیریتی **اجباری** است (§۱۰: «دلیل» ستون Audit است). */
function requireReason(reason: unknown, action: string): string {
  const clean = String(reason ?? '').trim()
  if (clean.length < 3) throw new BusinessError(`برای «${action}» نوشتن دلیل اجباری است (حداقل ۳ کاراکتر).`)
  return clean
}

/**
 * قالب مشترک همه‌ی تغییرهای مدیریتی:
 *   رمز مدیر (بیرون تراکنش) → خواندن رکورد → اعتبارسنجی → UPDATE → Audit با
 *   مقدار قبل/بعد/دلیل. هیچ مسیری وضعیت را مستقیم و بی‌اعتبارسنجی عوض نمی‌کند
 *   (§۱۱): تغییر وضعیت فقط از دل همین عملیات‌ها می‌آید و با
 *   `canCreditTransition` سنجیده می‌شود.
 */
async function managerChange(
  input: {
    id: number
    managerPassword?: string | null
    reason?: string | null
    userId?: number | null
    actionTitle: string
    auditAction: string
    /** وضعیت مقصد، اگر این عملیات وضعیت را عوض می‌کند */
    toStatus?: string
    build: (row: any, reason: string) => { data: Record<string, unknown>; before: Record<string, unknown>; after: Record<string, unknown>; note: string }
  }
): Promise<StoreCreditSafeRow> {
  assertCreditId(input.id) // نشست ۱۵۰ — پیش از رمز
  /**
   * 🔴 نشست ۱۸۳ — از «فقط رمز مدیر» به «رمز مدیر یا رمز دوم/سوم همین پنل».
   *
   * خواسته‌ی مالک: وقتی مدیر در فروشگاه نیست، باید بتواند برای هر بخش حساس یک
   * رمز دوم (یا رمز سومِ مخصوص همان شیفت) تعریف کند و به فرد مورد اعتماد بدهد
   * — بدون اینکه رمز مدیر لو برود.
   *
   * `assertManagerPassword` فقط رمز مدیر را می‌پذیرفت، پس این کار عملاً ممکن
   * نبود: یا مدیر رمز اصلی‌اش را می‌داد، یا کار زمین می‌ماند.
   * `assertPanelPassword` هر سه را می‌پذیرد و اولویتشان را خودِ AuthService
   * نگه می‌دارد: رمز مدیر > رمز دوم پنل > رمز سوم پنل×شیفتِ جاری.
   *
   * کلیدها دقیقاً همان‌هایی‌اند که کامنت `src/shared/panels.ts` از جلسه ۲۰
   * توصیه کرده بود (ابطال ⇒ creditVoid، تولید گروهی ⇒ creditBulkIssue،
   * صدور تکی ⇒ creditManagement) — قرارداد از قبل نوشته شده بود، فقط کد
   * دنبالش نرفته بود.
   *
   * نشست ۱۸۷: پنل «تنظیمات» هم دیگر از این قاعده مستثنا نیست و رمز دوم/سوم
   * می‌پذیرد. تعریف خودِ رمزها و تغییر قفل ماژول‌ها همچنان رمز مدیر می‌خواهد.
   */
  // نشست ۱۸۴ — پاک کردن بدهی فروشگاه؛ خاموش بودن قفل ماژول نباید دورش بزند.
  await assertPanelPasswordStrict(PANEL_KEYS.creditVoid, input.managerPassword, input.actionTitle)
  const reason = requireReason(input.reason, input.actionTitle)

  return prisma.$transaction(async (tx) => {
    const row = await loadCredit(tx, input.id)
    if (row.deletedAt) throw new BusinessError('این اعتبار آرشیو شده است و قابل تغییر نیست.')
    if (input.toStatus && !canCreditTransition(String(row.status), input.toStatus))
      throw new BusinessError(transitionError(String(row.status), input.toStatus))

    const built = input.build(row, reason)
    /**
     * بند ۹ (جلسه ۳۰) · §۱۹ — `source` بعد از صدور **تغییرناپذیر** است.
     *
     * ریسکی که ممیزی جلسه ۲۷ پیدا کرد: قواعد (مدت/دفعات) در لحظه‌ی صدور از نوع
     * اعتبار خوانده و *روی رکورد* ذخیره می‌شوند. پس اگر یک رکورد MANUAL بعداً
     * EXCHANGE شود، با قواعد سخاوتمندانه‌ی MANUAL باقی می‌ماند ولی خودش را
     * «تعویض کالا» جا می‌زند — دور زدن §۳ بدون هیچ ردی. گارد عمداً اینجا (قالب
     * مشترک همه‌ی عملیات مدیریتی) است و نه در یک عملیات خاص، تا هر عملیات
     * *آینده* هم از همین در رد شود.
     */
    const sourceError = sourceChangeError(row.source, (built.data as Record<string, unknown>).source)
    if (sourceError) throw new BusinessError(sourceError)
    const updated = await tx.storeCredit.update({ where: { id: row.id }, data: built.data })
    await audit(tx, {
      action: input.auditAction,
      entity: 'StoreCredit',
      entityId: row.id,
      userId: input.userId ?? null,
      before: redactCreditAuditPayload(JSON.stringify(built.before), row.code),
      after: redactCreditAuditPayload(JSON.stringify({ ...built.after, reason }), row.code),
      note: redactCreditCodeText(`${built.note} · دلیل: ${reason}`, row.code)
    })
    return shapeStoreCreditSafe(shapeStoreCredit(updated))
  }, TX_OPTIONS)
}

/** ابطال = تغییر وضعیت، نه حذف فیزیکی (§۱۱). وضعیت پایانی است. */
export async function voidCredit(input: {
  id: number
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  return managerChange({
    ...input,
    actionTitle: 'ابطال اعتبار خرید',
    auditAction: AuditAction.CREDIT_VOID,
    toStatus: StoreCreditStatus.CANCELED,
    build: (row, reason) => ({
      data: { status: StoreCreditStatus.CANCELED, voidedAt: new Date(), voidedReason: reason },
      before: { status: row.status, remaining: remainingOf(row) },
      after: { status: StoreCreditStatus.CANCELED },
      note: `ابطال اعتبار «${row.code}» با باقی‌مانده‌ی ${money(remainingOf(row))} ریال`
    })
  })
}

/** تعلیق موقت: قابل برگشت، برخلاف ابطال. */
export async function suspendCredit(input: {
  id: number
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  return managerChange({
    ...input,
    actionTitle: 'تعلیق موقت اعتبار خرید',
    auditAction: AuditAction.CREDIT_SUSPEND,
    toStatus: StoreCreditStatus.SUSPENDED,
    build: (row, reason) => ({
      data: { status: StoreCreditStatus.SUSPENDED, suspendedAt: new Date(), note: row.note },
      before: { status: row.status },
      after: { status: StoreCreditStatus.SUSPENDED, reason },
      note: `تعلیق اعتبار «${row.code}»`
    })
  })
}

/**
 * فعال‌سازی مجدد (از تعلیق یا انقضا).
 * اگر اعتبار *منقضی* باشد، فعال‌سازی بدون تمدید تاریخ بی‌معناست (یک ثانیه بعد
 * دوباره منقضی است)، پس `extendDays` اجباری می‌شود — همان‌جا و صریح.
 */
export async function reactivateCredit(input: {
  id: number
  extendDays?: number | null
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  // نشست ۱۵۰ — خالی ⇒ ۰؛ اعشار/منفی/متن/بیش از ۳٬۶۵۰ روز ⇒ رد (قبلاً clamp بی‌صدا)
  const extend = input.extendDays == null ? 0 : assertCreditInt(input.extendDays, 'تعداد روز تمدید', 0, 3650, ' روز')
  return managerChange({
    ...input,
    actionTitle: 'فعال‌سازی مجدد اعتبار خرید',
    auditAction: AuditAction.CREDIT_REACTIVATE,
    build: (row, reason) => {
      const expired = isExpiredAt({ amount: asNum(row.amount), status: String(row.status), expiresAt: row.expiresAt })
      if (expired && extend <= 0)
        throw new BusinessError(
          'مهلت این اعتبار تمام شده است، پس فعال‌سازی بدون تمدید تاریخ بی‌اثر است.\n' +
            'تعداد روز تمدید را وارد کنید (مثلاً ۳۰ روز) تا اعتبار واقعاً قابل استفاده شود.'
        )
      const used = Math.round(asNum(row.usedAmount))
      const to = used > 0 ? StoreCreditStatus.PARTIALLY_USED : StoreCreditStatus.ACTIVE
      if (!canCreditTransition(String(row.status), to)) throw new BusinessError(transitionError(String(row.status), to))
      const now = new Date()
      const expiresAt = extend > 0 ? new Date(now.getTime() + extend * DAY_MS) : row.expiresAt
      return {
        data: {
          status: to,
          suspendedAt: null,
          expiresAt,
          expiresAtJalali: expiresAt ? toJalaliDate(new Date(expiresAt)) : null
        },
        before: { status: row.status, expiresAtJalali: row.expiresAtJalali },
        after: { status: to, expiresAtJalali: expiresAt ? toJalaliDate(new Date(expiresAt)) : null, extendDays: extend, reason },
        note:
          `فعال‌سازی مجدد اعتبار «${row.code}»` +
          (extend > 0 ? ` با ${faDigits(extend)} روز تمدید` : '')
      }
    }
  })
}

/** تغییر تاریخ انقضا (§۱۰) — با دلیل اجباری و ثبت مقدار قبل/بعد. */
export async function changeCreditExpiry(input: {
  id: number
  /** تاریخ شمسی جدید (خالی = بدون انقضا) */
  expiresAtJalali?: string | null
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  const target = String(input.expiresAtJalali ?? '').trim()
  return managerChange({
    ...input,
    actionTitle: 'تغییر تاریخ انقضای اعتبار خرید',
    auditAction: AuditAction.CREDIT_EXPIRY_CHANGE,
    build: (row, reason) => {
      const expiresAt = target ? jalaliEndOfDay(target) : null
      return {
        data: { expiresAt, expiresAtJalali: expiresAt ? toJalaliDate(expiresAt) : null },
        before: { expiresAtJalali: row.expiresAtJalali },
        after: { expiresAtJalali: expiresAt ? toJalaliDate(expiresAt) : null, reason },
        note:
          `تغییر تاریخ انقضای اعتبار «${row.code}» از ` +
          `${row.expiresAtJalali ? faDigits(row.expiresAtJalali) : 'بدون انقضا'} به ` +
          `${expiresAt ? faDigits(toJalaliDate(expiresAt)) : 'بدون انقضا'}`
      }
    }
  })
}

/**
 * تغییر مبلغ — خطرناک‌ترین تغییر، پس سخت‌ترین قاعده (§۸):
 *   • روی اعتباری که **هیچ مصرفی نداشته**، مجاز است.
 *   • روی اعتباری که **مصرف شده**، *ممنوع* است (نه «محدود»): مبلغ اولیه مبنای
 *     سند حسابداری و ردیف‌های دفتر مصرف است؛ عوض کردنش یعنی خراب کردن سابقه.
 *     راه درست برای اصلاح، ابطال این اعتبار و صدور یکی جدید است.
 */
export async function changeCreditAmount(input: {
  id: number
  amount: number
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  // نشست ۱۵۰ — پیام قدیمی صفر/منفی حفظ شد؛ اعشار/متن/NaN/سقف ⇒ رد، نه گرد
  if (typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount <= 0)
    throw new BusinessError('مبلغ اعتبار باید بزرگ‌تر از صفر باشد.')
  const amount = assertCreditInt(input.amount, 'مبلغ اعتبار', 1, CREDIT_INT_MAX, ' ریال')
  return managerChange({
    ...input,
    actionTitle: 'تغییر مبلغ اعتبار خرید',
    auditAction: AuditAction.CREDIT_AMOUNT_CHANGE,
    build: (row, reason) => {
      if (Math.round(asNum(row.usedAmount)) > 0 || Math.round(asNum(row.usedCount)) > 0)
        throw new BusinessError(
          `این اعتبار قبلاً مصرف شده است (${money(asNum(row.usedAmount))} ریال در ${faDigits(asNum(row.usedCount))} بار)، ` +
            'پس تغییر مبلغش مجاز نیست — چون سند حسابداری و سابقه‌ی مصرفش را خراب می‌کند.\n' +
            'راه درست: همین اعتبار را باطل کنید و یک اعتبار جدید با مبلغ درست صادر کنید.'
        )
      return {
        data: { amount },
        before: { amount: Math.round(asNum(row.amount)) },
        after: { amount, reason },
        note: `تغییر مبلغ اعتبار «${row.code}» از ${money(asNum(row.amount))} به ${money(amount)} ریال`
      }
    }
  })
}

/** تغییر دفعات مجاز مصرف / حالت چندباره (§۴ و §۱۰). */
export async function changeCreditUses(input: {
  id: number
  maxUses?: number | null
  multiUse?: boolean | null
  maxPerTransaction?: number | null
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  // نشست ۱۵۰ — عددها پیش از رمز و بدون clamp (۵۰۰۰ دیگر بی‌صدا ۱۰۰۰ نمی‌شود)
  const reqMaxUses =
    input.maxUses == null ? null : assertCreditInt(input.maxUses, 'سقف دفعات مصرف', 1, MULTI_USE_UNLIMITED, ' بار')
  const reqMaxPerTx =
    input.maxPerTransaction == null
      ? null
      : assertCreditInt(input.maxPerTransaction, 'سقف هر تراکنش', 0, CREDIT_INT_MAX, ' ریال')
  return managerChange({
    ...input,
    actionTitle: 'تغییر دفعات مصرف اعتبار خرید',
    auditAction: AuditAction.CREDIT_USES_CHANGE,
    build: (row, reason) => {
      const multiUse = input.multiUse == null ? row.multiUse === true : input.multiUse === true
      let maxUses = reqMaxUses == null ? Math.round(asNum(row.maxUses)) : reqMaxUses
      /**
       * جلسه ۳۵ · یافته‌ی هارنس واقعی (§۴ و §۸) — خطرناک‌ترین نوع باگ: *سکوت*.
       *
       * قبلاً اگر مدیر روی یک اعتبارِ «چندباره» سقف دفعات را ۱ می‌گذاشت (بدون
       * این‌که «چندباره» را خاموش کند)، همین خط پایین مقدارش را به
       * `MULTI_USE_UNLIMITED` (۱۰۰۰) تبدیل می‌کرد: یعنی درخواستِ «محدودتر کن»
       * در عمل «تقریباً بی‌نهایت کن» می‌شد و هیچ خطایی هم دیده نمی‌شد. در لحظه‌ی
       * *صدور* این تبدیل معنا دارد (آنجا «چندباره» یعنی «تا پایان مبلغ» و عدد
       * دفعات بی‌معناست)، ولی در *تغییر مدیریتی* یک ورودی صریحِ متناقض است و
       * باید با پیام روشن رد شود — نه این‌که برعکسِ خواسته اجرا شود.
       */
      if (multiUse && reqMaxUses != null && reqMaxUses < 2)
        throw new BusinessError(
          'سقف «یک بار» با حالت «چندباره تا سقف مبلغ» جمع نمی‌شود.\n' +
            'اگر می‌خواهید این اعتبار یک‌بارمصرف شود، همان‌جا «چندباره» را خاموش کنید؛ ' +
            'وگرنه سقف دفعات را ۲ یا بیشتر بگذارید.'
        )
      if (multiUse && maxUses < 2) maxUses = MULTI_USE_UNLIMITED
      const usedCount = Math.round(asNum(row.usedCount))
      if (maxUses < usedCount)
        throw new BusinessError(
          `این اعتبار تا حالا ${faDigits(usedCount)} بار مصرف شده است، پس سقف دفعات نمی‌تواند کمتر از ${faDigits(usedCount)} باشد.`
        )
      const maxPerTransaction =
        reqMaxPerTx == null ? Math.round(asNum(row.maxPerTransaction)) : reqMaxPerTx
      return {
        data: { maxUses, multiUse, maxPerTransaction, settingsOverride: true, overrideReason: reason },
        before: { maxUses: Math.round(asNum(row.maxUses)), multiUse: row.multiUse === true, maxPerTransaction: Math.round(asNum(row.maxPerTransaction)) },
        after: { maxUses, multiUse, maxPerTransaction, reason },
        note:
          `تغییر قواعد مصرف اعتبار «${row.code}»: ` +
          `${multiUse ? `چندباره تا ${faDigits(maxUses)} بار` : 'یک‌بارمصرف'}` +
          (maxPerTransaction > 0 ? ` · سقف هر تراکنش ${money(maxPerTransaction)} ریال` : '')
      }
    }
  })
}

/** تغییر دارنده/اطلاعات گیرنده (§۱۲) — هیچ فیلدی اجباری نیست جز دلیل تغییر. */
export async function changeCreditHolder(input: {
  id: number
  customerId?: number | null
  customerName?: string | null
  customerLocked?: boolean | null
  holderCompany?: string | null
  holderNationalId?: string | null
  holderPhone?: string | null
  holderAddress?: string | null
  holderAgent?: string | null
  holderNote?: string | null
  reminderOptOut?: boolean | null
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  return managerChange({
    ...input,
    actionTitle: 'تغییر دارنده‌ی اعتبار خرید',
    auditAction: AuditAction.CREDIT_HOLDER_CHANGE,
    build: (row, reason) => {
      const pick = <T>(next: T | null | undefined, prev: T): T => (next === undefined ? prev : (next as T))
      const data = {
        customerId: input.customerId === undefined ? row.customerId : input.customerId,
        customerName: pick(input.customerName, row.customerName),
        customerLocked: input.customerLocked == null ? row.customerLocked === true : input.customerLocked === true,
        holderCompany: pick(trimOrNull(input.holderCompany), row.holderCompany),
        holderNationalId: pick(trimOrNull(input.holderNationalId), row.holderNationalId),
        holderPhone: pick(trimOrNull(input.holderPhone), row.holderPhone),
        holderAddress: pick(trimOrNull(input.holderAddress), row.holderAddress),
        holderAgent: pick(trimOrNull(input.holderAgent), row.holderAgent),
        holderNote: pick(trimOrNull(input.holderNote), row.holderNote),
        reminderOptOut: input.reminderOptOut == null ? row.reminderOptOut === true : input.reminderOptOut === true
      }
      /**
       * بند ۸ نیمه‌ی دوم (جلسه ۳۰) · §۱۲ — snapshot کامل، نه ۵ فیلد.
       *
       * تا جلسه ۲۹ فقط شناسه/نام/قفل مشتری و شرکت و تلفن در `before` می‌نشستند،
       * پس عوض شدن شناسه ملی، آدرس، نماینده، توضیح دارنده و «پیام نفرستید»
       * هیچ ردی در Timeline نداشت — یعنی تنها سند مالی این ماژول نمی‌توانست
       * بگوید قبلش چه بود. هر دو سرِ لاگ از `holderSnapshot` می‌آیند تا دوباره
       * از هم واگرا نشوند.
       */
      const before = holderSnapshot(row)
      const after = holderSnapshot({ ...row, ...data })
      return {
        data,
        before,
        after: { ...after, reason },
        note:
          `تغییر اطلاعات دارنده‌ی اعتبار «${row.code}»` +
          (() => {
            const changed = HOLDER_AUDIT_FIELDS.filter((f) => before[f] !== after[f])
            return changed.length ? ` · فیلدهای عوض‌شده: ${changed.map((f) => HOLDER_FIELD_LABELS[f] ?? f).join('، ')}` : ''
          })()
      }
    }
  })
}

/** تغییر محدودیت کالا/دسته/مبلغ (§۱۸) — هم اینجا و هم در مصرف، Backend می‌سنجد. */
export async function changeCreditRestrictions(input: {
  id: number
  restrictScope?: string | null
  restrictCategoryIds?: number[] | null
  restrictVariantIds?: number[] | null
  minPurchase?: number | null
  maxPerTransaction?: number | null
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<StoreCreditSafeRow> {
  // نشست ۱۵۰ — عددها پیش از رمز و بدون clamp
  const reqMinPurchase =
    input.minPurchase == null ? null : assertCreditInt(input.minPurchase, 'حداقل خرید', 0, CREDIT_INT_MAX, ' ریال')
  const reqMaxPerTx =
    input.maxPerTransaction == null
      ? null
      : assertCreditInt(input.maxPerTransaction, 'سقف هر تراکنش', 0, CREDIT_INT_MAX, ' ریال')
  return managerChange({
    ...input,
    actionTitle: 'تغییر محدودیت اعتبار خرید',
    auditAction: AuditAction.CREDIT_RESTRICTION_CHANGE,
    build: (row, reason) => {
      const scope = normalizeRestrictScope(input.restrictScope ?? row.restrictScope)
      const cats = scope === CreditRestrictScope.CATEGORY ? parseIdList(input.restrictCategoryIds ?? row.restrictCategoryIdsJson) : []
      const vars = scope === CreditRestrictScope.VARIANTS ? parseIdList(input.restrictVariantIds ?? row.restrictVariantIdsJson) : []
      if (scope === CreditRestrictScope.CATEGORY && !cats.length)
        throw new BusinessError('برای محدود کردن اعتبار به دسته‌بندی، حداقل یک دسته‌بندی انتخاب کنید.')
      if (scope === CreditRestrictScope.VARIANTS && !vars.length)
        throw new BusinessError('برای محدود کردن اعتبار به کالا، حداقل یک کالا انتخاب کنید.')
      const data = {
        restrictScope: scope,
        restrictCategoryIdsJson: cats.length ? JSON.stringify(cats) : null,
        restrictVariantIdsJson: vars.length ? JSON.stringify(vars) : null,
        minPurchase: reqMinPurchase == null ? Math.round(asNum(row.minPurchase)) : reqMinPurchase,
        maxPerTransaction: reqMaxPerTx == null ? Math.round(asNum(row.maxPerTransaction)) : reqMaxPerTx,
        settingsOverride: true,
        overrideReason: reason
      }
      return {
        data,
        before: {
          restrictScope: row.restrictScope,
          categories: parseIdList(row.restrictCategoryIdsJson),
          variants: parseIdList(row.restrictVariantIdsJson),
          minPurchase: Math.round(asNum(row.minPurchase)),
          maxPerTransaction: Math.round(asNum(row.maxPerTransaction))
        },
        after: { ...data, categories: cats, variants: vars, reason },
        note: `تغییر محدودیت اعتبار «${row.code}» ⇒ ${CREDIT_SCOPE_LABELS[scope] ?? scope}`
      }
    }
  })
}

/**
 * حذف یک اعتبار (§۱۱) — نشست ۱۶۰ · Y7 · بند ۴-۲۲: «حذف» هیچ‌وقت حذف فیزیکی نیست.
 *
 *   • هیچ مصرفی نداشته ⇒ **ابطال/آرشیو** (`deletedAt` + `voidedReason`) با Audit
 *     `CREDIT_DELETE`. رکورد، کد، مبلغ و منبع صدور به‌عنوان مدرک می‌مانند؛ از فهرست‌های
 *     پیش‌فرض و از مسیر مصرف (findRedeemable) بیرون می‌رود. تا نشست ۱۵۹ این شاخه
 *     `tx.storeCredit.delete` بود و مدرک صدور (مثلاً اعتباری که فروشنده برای خودش
 *     برداشته و بعد پاک کرده) فقط در متن Audit می‌ماند.
 *   • مصرف شده ⇒ همان Soft Delete با Audit `CREDIT_ARCHIVE`؛ پرداخت و دفتر مصرفش دست‌نخورده.
 *   • شناسه پیش از رمز مدیر سنجیده می‌شود (هم‌راستا با managerChange، نشست ۱۵۰)؛
 *     اعتبارِ از قبل آرشیوشده دوباره حذف نمی‌شود (Audit تکراری ساخته نمی‌شود).
 *   حذف فیزیکی واقعی فقط در نگه‌داری بلندمدت (بند ۴-۲۲، استثنای حجم دیتابیس) مجاز است، نه اینجا.
 */
export async function deleteCredit(input: {
  id: number
  reason?: string | null
  managerPassword?: string | null
  userId?: number | null
}): Promise<{ mode: 'DELETED' | 'ARCHIVED'; code: string }> {
  assertCreditId(input.id) // نشست ۱۶۰ · Y7 — پیش از رمز
  await assertPanelPasswordStrict(PANEL_KEYS.creditVoid, input.managerPassword, 'حذف اعتبار خرید')
  const reason = requireReason(input.reason, 'حذف اعتبار خرید')

  return prisma.$transaction(async (tx) => {
    const row = await loadCredit(tx, input.id)
    if (row.deletedAt) throw new BusinessError('این اعتبار قبلاً حذف/آرشیو شده است؛ دوباره حذف نمی‌شود. فهرست را تازه کنید.')
    const redemptions = await tx.storeCreditRedemption.count({ where: { creditId: row.id } })
    const payments = await tx.payment.count({ where: { storeCreditId: row.id } })
    const hasUse = redemptions > 0 || payments > 0 || Math.round(asNum(row.usedAmount)) > 0 || Math.round(asNum(row.usedCount)) > 0

    if (hasUse) {
      await tx.storeCredit.update({ where: { id: row.id }, data: { deletedAt: new Date(), voidedReason: reason } })
      await audit(tx, {
        action: AuditAction.CREDIT_ARCHIVE,
        entity: 'StoreCredit',
        entityId: row.id,
        userId: input.userId ?? null,
        before: JSON.stringify({ creditId: row.id, status: row.status, usedAmount: row.usedAmount, redemptions }),
        after: JSON.stringify({ deleted: false, archived: true, reason }),
        note:
          `آرشیو (حذف نرم) اعتبار #${row.id} چون ${faDigits(redemptions || 1)} مصرف ثبت‌شده دارد؛ ` +
          `سابقه‌ی حسابداری دست‌نخورده ماند · دلیل: ${reason}`
      })
      return { mode: 'ARCHIVED' as const, code: row.code }
    }

    await tx.storeCredit.update({ where: { id: row.id }, data: { deletedAt: new Date(), voidedReason: reason } })
    await audit(tx, {
      action: AuditAction.CREDIT_DELETE,
      entity: 'StoreCredit',
      entityId: row.id,
      userId: input.userId ?? null,
      before: JSON.stringify({
        creditId: row.id,
        amount: Math.round(asNum(row.amount)),
        status: row.status,
        source: row.source,
        issuedAtJalali: row.issuedAtJalali
      }),
      after: JSON.stringify({ deleted: false, voided: true, archived: true, reason }),
      note:
        `ابطال و آرشیو اعتبار بی‌مصرف #${row.id} (${money(asNum(row.amount))} ریال)؛ ` +
        `رکورد به‌عنوان مدرک ماند و دیگر قابل مصرف نیست · دلیل: ${reason}`
    })
    return { mode: 'DELETED' as const, code: row.code }
  }, TX_OPTIONS)
}

// ---------------------------------------------------------------------------
// ۷) تولید گروهی (§۵)
// ---------------------------------------------------------------------------

/**
 * درج گروهی اعتبارها. اول `createMany` (یک دستور برای هر بسته)، و اگر نسخه‌ی
 * Prisma/SQLite پشتیبانی نکرد یا یک کد تصادم داشت، همان بسته ردیف‌به‌ردیف با
 * کد تازه درج می‌شود — همان الگوی `insertRows` در `MergeService`.
 */
async function insertCreditRows(
  tx: any,
  rows: any[],
  regenerate: () => string
): Promise<number> {
  if (!rows.length) return 0
  try {
    const res = await tx.storeCredit.createMany({ data: rows })
    return Number(res?.count ?? rows.length)
  } catch {
    let done = 0
    for (const row of rows) {
      let inserted = false
      for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
        try {
          await tx.storeCredit.create({ data: attempt === 0 ? row : { ...row, code: regenerate() } })
          inserted = true
        } catch (e) {
          if (!isP2002(e)) throw e
        }
      }
      if (!inserted)
        throw new BusinessError(
          'تولید کد یکتا برای بخشی از این دسته ممکن نشد، پس همین بسته ثبت نشد.\n' +
            'طول کد را در «تنظیمات اعتبار خرید» بیشتر کنید و دوباره تلاش کنید.'
        )
      done++
    }
    return done
  }
}

export interface BulkIssueInput {
  /** نشست ۱۴۳ · بند ۴-۲۹ — رمز مدیر اجباری برای تولید گروهی. */
  managerPassword?: string | null
  count: number
  amountEach: number
  source?: string | null
  title?: string | null
  days?: number | null
  maxUses?: number | null
  multiUse?: boolean | null
  codeLength?: number | null
  prefix?: string | null
  restrictScope?: string | null
  restrictCategoryIds?: number[] | null
  restrictVariantIds?: number[] | null
  minPurchase?: number | null
  maxPerTransaction?: number | null
  customerId?: number | null
  customerName?: string | null
  customerLocked?: boolean | null
  holderCompany?: string | null
  holderPhone?: string | null
  note?: string | null
  userId?: number | null
}

/**
 * تولید گروهی اعتبار (§۵) — هزاران رکورد *مستقل* (هر کدام کد/وضعیت/سابقه‌ی خودش).
 *
 * سه تصمیم مهندسی این تابع:
 *
 *   ۱) **ظرفیت کد قبل از شروع سنجیده می‌شود** (§۶). اگر فضا کافی نباشد، هیچ
 *      رکوردی ساخته نمی‌شود و پیام فارسی تعداد کدهای ممکن + پیشنهاد طول را
 *      می‌گوید. «افزایش خودکار طول» هم اگر روشن باشد، رشد طول در خروجی و در
 *      `StoreCreditBatch.lengthGrown` و در AuditLog *دیده* می‌شود.
 *
 *   ۲) **درج دسته‌ای و «همه یا هیچ»** (§۵/§۲۴ — جلسه ۲۹). عمداً کل پنج‌هزار
 *      رکورد در *یک* تراکنش interactive نمی‌رود: timeout پانزده‌ثانیه‌ای SQLite
 *      همان بن‌بست آشنا را می‌سازد. پس هر بسته‌ی ۲۰۰تایی تراکنش خودش را دارد،
 *      **ولی** اولین بسته‌ی خطادار کل عملیات را برمی‌گرداند: ردیف‌های ساخته‌شده
 *      و خودِ دسته پاک می‌شوند و خطای فارسی بالا می‌رود. تا جلسه ۲۸ خطای بسته
 *      «بلعیده» می‌شد و دسته‌ی نصفه با `created < requested` تحویل داده می‌شد؛
 *      برای چیزی که هر ردیفش یک تعهد مالی است، نصفه بدترین حالت بود.
 *
 *   ۳) **Audit به‌جای سیل لاگ**: یک ردیف `CREDIT_BULK_GENERATE` برای کل دسته
 *      (با همه‌ی قواعد snapshot‌شده) + ردیف صدور جدا برای هر اعتبار **فقط تا ۵۰
 *      عدد**. برای دسته‌های بزرگ‌تر، خودِ رکورد `StoreCreditBatch` سند رسمی است
 *      (ساختن پنج‌هزار ردیف AuditLog نه خوانا است و نه مفید).
 */
export async function bulkIssueCredits(input: BulkIssueInput): Promise<CreditBulkResult> {
  const settings = await readCreditSettings(prisma)
  // نشست ۱۴۳ — تعداد و مبلغ هر اعتبار بی‌صدا گرد/clamp نمی‌شوند.
  const count = assertCreditInteger(input.count, 'تعداد اعتبار در تولید گروهی', 'عدد', 1)
  const amountEach = assertCreditInteger(input.amountEach, 'مبلغ هر اعتبار', 'ریال', 1)
  if (input.days != null) assertCreditInteger(input.days, 'مدت اعتبار', 'روز', 0, 3650)
  if (input.maxUses != null) assertCreditInteger(input.maxUses, 'تعداد دفعات مصرف', 'بار', 1, MULTI_USE_UNLIMITED)
  if (input.minPurchase != null) assertCreditInteger(input.minPurchase, 'حداقل خرید', 'ریال', 0)
  if (input.maxPerTransaction != null) assertCreditInteger(input.maxPerTransaction, 'سقف مصرف در هر خرید', 'ریال', 0)
  if (count > settings.bulkMaxCount)
    throw new BusinessError(
      `سقف تولید گروهی در تنظیمات ${faDigits(settings.bulkMaxCount)} اعتبار است و درخواست شما بیشتر از آن بود، پس چیزی ساخته نشد.`
    )

  const source = normalizeCreditSource(input.source ?? CreditSource.MANUAL)
  /**
   * نشست ۶۱ (S61-5) — اعتبار «اضافه‌دریافت» فقط از مسیر پرداخت فاکتور و با پشتوانه‌ی
   * پول واقعی صادر می‌شود. صدور گروهی/دستی با این نوع یعنی جا زدن اعتبار بی‌پشتوانه
   * زیر ردیفی که در پل تطبیق جداگانه کم نمی‌شود ⇒ رد کامل.
   */
  if (source === CreditSource.OVERPAY)
    throw new BusinessError(
      'اعتبار «ناشی از اضافه‌دریافت» را نمی‌توان دستی یا گروهی صادر کرد؛ فقط از بخش پرداخت‌های فاکتور، ' +
        'به اندازه‌ی پولی که واقعاً بیشتر از بدهی دریافت شده، صادر می‌شود.'
    )
  /**
   * نشست ۱۴۳ · بند ۴-۲۹ — تولید گروهی = صدور دستی اعتبار بدون فاکتور واقعی ⇒
   * همیشه رمز مدیر، در main و *پیش از* assertCodeSpace (که ممکن است Audit بنویسد)
   * و پیش از ساخت Batch. بیرون از هر تراکنش صدا زده می‌شود (قفل رمز با کلاینت سراسری).
   */
  // نشست ۱۸۴ · بند ۴-۲۹ — تولید گروهی عملاً «پول چاپ کردن» است؛ هیچ‌وقت بی‌رمز نه.
  await assertPanelPasswordStrict(PANEL_KEYS.creditBulkIssue, input.managerPassword, 'تولید گروهی اعتبار خرید')
  const prefix = prefixFor(settings, source, input.prefix)
  const space = await assertCodeSpace(prisma, {
    count,
    settings,
    prefix,
    length: input.codeLength ?? settings.codeLength,
    userId: input.userId ?? null
  })

  const rules = resolveRules(settings, source, {
    amount: amountEach,
    days: input.days === undefined ? undefined : input.days,
    maxUses: input.maxUses ?? null,
    multiUse: input.multiUse ?? null,
    restrictScope: input.restrictScope ?? null,
    minPurchase: input.minPurchase ?? null,
    maxPerTransaction: input.maxPerTransaction ?? null,
    customerLocked: input.customerLocked ?? null
  })

  const scope = normalizeRestrictScope(input.restrictScope)
  const cats = scope === CreditRestrictScope.CATEGORY ? parseIdList(input.restrictCategoryIds) : []
  const vars = scope === CreditRestrictScope.VARIANTS ? parseIdList(input.restrictVariantIds) : []
  if (scope === CreditRestrictScope.CATEGORY && !cats.length)
    throw new BusinessError('برای محدود کردن این دسته به دسته‌بندی، حداقل یک دسته‌بندی انتخاب کنید.')
  if (scope === CreditRestrictScope.VARIANTS && !vars.length)
    throw new BusinessError('برای محدود کردن این دسته به کالا، حداقل یک کالا انتخاب کنید.')

  const now = new Date()
  const expiresAt = rules.days && rules.days > 0 ? new Date(now.getTime() + rules.days * DAY_MS) : null
  const title =
    trimOrNull(input.title) ??
    `${faDigits(count)} اعتبار ${money(amountEach)} ریالی` + (input.holderCompany ? ` · ${input.holderCompany}` : '')

  /**
   * جلسه ۲۹ · §۵/§۲۴ — **تولید کدها قبل از ساختن دسته.**
   *
   * ترتیب قبلی برعکس بود: اول `StoreCreditBatch` ساخته می‌شد و بعد کدها. اگر
   * تولید کد یکتا شکست می‌خورد (یا هر خطای دیگری بین این دو می‌افتاد)، یک
   * دسته‌ی **خالی** در دیتابیس می‌ماند که هیچ اعتباری نداشت و در گزارش دسته‌ها
   * هم دیده می‌شد. حالا هیچ ردیفی ساخته نمی‌شود تا وقتی همه‌ی کدها آماده باشند.
   */
  const alphabet = creditAlphabet(settings.codeAlphabet, settings.excludeSimilar)
  const bodyLength = Math.max(1, space.length - prefix.length)
  const newCode = (): string => (prefix + randomFrom(alphabet, bodyLength)).slice(0, MAX_CODE)

  const codes = new Set<string>()
  let guard = 0
  while (codes.size < count && guard++ < count * 50) codes.add(newCode())
  if (codes.size < count)
    throw new BusinessError(
      'تولید این تعداد کد یکتا با طول فعلی ممکن نشد، پس هیچ اعتباری ساخته نشد.\n' +
        'طول کد را در «تنظیمات اعتبار خرید» بیشتر کنید.'
    )

  const BULK_TX = { timeout: 120_000, maxWait: 20_000 } as const
  let created = 0
  const batch = await prisma.$transaction(async (tx) => {
    const batchRow = await tx.storeCreditBatch.create({
    data: {
      title,
      source,
      count: 0,
      amountEach,
      totalAmount: 0,
      days: rules.days ?? null,
      maxUses: rules.maxUses,
      multiUse: rules.multiUse,
      codeLength: space.length,
      prefix: prefix || null,
      alphabet: settings.codeAlphabet,
      excludeSimilar: settings.excludeSimilar,
      lengthGrown: space.grown,
      restrictScope: scope,
      restrictCategoryIdsJson: cats.length ? JSON.stringify(cats) : null,
      restrictVariantIdsJson: vars.length ? JSON.stringify(vars) : null,
      minPurchase: clampInt(input.minPurchase, 0, Number.MAX_SAFE_INTEGER, 0),
      maxPerTransaction: clampInt(input.maxPerTransaction, 0, Number.MAX_SAFE_INTEGER, 0),
      customerId: input.customerId ?? null,
      customerName: trimOrNull(input.customerName),
      holderCompany: trimOrNull(input.holderCompany),
      userId: input.userId ?? null,
      createdAt: now,
      createdAtJalali: toJalaliDate(now),
      createdAtTime: toClock(now),
      note: trimOrNull(input.note)
    }
  })

  const base = {
    amount: amountEach,
    source,
    issuedAt: now,
    issuedAtJalali: toJalaliDate(now),
    issuedAtTime: toClock(now),
    expiresAt,
    expiresAtJalali: expiresAt ? toJalaliDate(expiresAt) : null,
    status: StoreCreditStatus.DRAFT,
    maxUses: rules.maxUses,
    multiUse: rules.multiUse,
    carryRemainder: rules.carryRemainder,
    settingsOverride: rules.override,
    overrideReason: null,
    issuedDays: rules.days ?? null,
    restrictScope: scope,
    restrictCategoryIdsJson: cats.length ? JSON.stringify(cats) : null,
    restrictVariantIdsJson: vars.length ? JSON.stringify(vars) : null,
    minPurchase: clampInt(input.minPurchase, 0, Number.MAX_SAFE_INTEGER, 0),
    maxPerTransaction: clampInt(input.maxPerTransaction, 0, Number.MAX_SAFE_INTEGER, 0),
    customerLocked: input.customerLocked === true,
    customerId: input.customerId ?? null,
    customerName: trimOrNull(input.customerName),
    holderCompany: trimOrNull(input.holderCompany),
    holderPhone: trimOrNull(input.holderPhone),
    batchId: batchRow.id,
    prefix: prefix || null,
    note: trimOrNull(input.note),
    userId: input.userId ?? null
  }

    const all = [...codes].map((code) => ({ ...base, code }))
    /**
     * نشست ۱۹۰ — همه یا هیچ داخل *یک* تراکنش SQLite.
     * کرش وسط کار، WAL را rollback می‌کند و دسته‌ی نیمه‌کاره/اعتبار DRAFT باقی نمی‌ماند.
     * بسته‌های ۲۰۰تایی فقط سقف متغیر SQL را رعایت می‌کنند، نه مرز اتمی جدا.
     */
    let n = 0
    for (let i = 0; i < all.length; i += CHUNK) {
      n += await insertCreditRows(tx, all.slice(i, i + CHUNK), newCode)
    }
    await tx.storeCredit.updateMany({
      where: { batchId: batchRow.id, status: StoreCreditStatus.DRAFT },
      data: { status: StoreCreditStatus.ACTIVE }
    })
    await tx.storeCreditBatch.update({
      where: { id: batchRow.id },
      data: { count: n, totalAmount: n * amountEach }
    })
    created = n
    /**
     * نشست ۱۹۴ · M-6 — Audit باید داخل همین tx باشد. قبلاً بعد از commit بود:
     * اگر Audit می‌شکست IPC خطا می‌داد در حالی که N اعتبار ACTIVE ساخته شده بود
     * و تلاش دوباره N اعتبار دیگر می‌ساخت.
     */
    if (n > 0 && n <= 50) {
      const issued = await tx.storeCredit.findMany({
        where: { batchId: batchRow.id },
        select: { id: true, code: true }
      })
      for (const r of issued) {
        await audit(tx, {
          action: AuditAction.CREDIT_ISSUE_MANUAL,
          entity: 'StoreCredit',
          entityId: r.id,
          userId: input.userId ?? null,
          after: JSON.stringify({ creditId: r.id, codeLength: r.code.length, amount: amountEach, batchId: batchRow.id, source }),
          note: `صدور اعتبار #${r.id} به مبلغ ${money(amountEach)} ریال در دسته‌ی گروهی ${faDigits(batchRow.id)}`
        })
      }
    }
    await audit(tx, {
      action: AuditAction.CREDIT_BULK_GENERATE,
      entity: 'StoreCreditBatch',
      entityId: batchRow.id,
      userId: input.userId ?? null,
      after: JSON.stringify({
        requested: count,
        created: n,
        amountEach,
        totalAmount: n * amountEach,
        codeLength: space.length,
        lengthGrown: space.grown,
        maxUses: rules.maxUses,
        multiUse: rules.multiUse,
        restrictScope: scope,
        expiresAtJalali: expiresAt ? toJalaliDate(expiresAt) : null
      }),
      note:
        `تولید گروهی ${faDigits(n)} اعتبار ${money(amountEach)} ریالی (جمع ${money(n * amountEach)} ریال)` +
        (space.grown ? ` · طول کد خودکار به ${faDigits(space.length)} افزایش یافت` : '')
    })
    return batchRow
  }, BULK_TX)

  const rows = await prisma.storeCredit.findMany({ where: { batchId: batch.id }, orderBy: CREDIT_ORDER_BY.batchRows, take: 5000 })
  return {
    batchId: batch.id,
    title,
    requested: count,
    created,
    amountEach,
    totalAmount: created * amountEach,
    codeLength: space.length,
    lengthGrown: space.grown,
    lengthMessage: space.message,
    /**
     * جلسه ۲۹ — «هشدار بسته‌ی ثبت‌نشده» حذف شد چون دیگر وجود ندارد: یا هر
     * `count` ردیف ساخته می‌شود، یا کل عملیات با خطا برمی‌گردد و چیزی نمی‌ماند.
     * تنها هشدار باقی‌مانده، رشد خودکار طول کد است (§۶).
     */
    warnings: [
      ...(space.grown && space.message ? [space.message] : []),
      ...(created > rows.length
        ? [
            `پاسخ فقط ${faDigits(rows.length)} کد از ${faDigits(created)} اعتبار ساخته‌شده را دارد؛ فهرست کامل در جزئیات همین دسته است.`
          ]
        : [])
    ],
    credits: rows.map((r) => shapeStoreCreditSafe(shapeStoreCredit(r)))
  }
}

// ---------------------------------------------------------------------------
// ۸) داشبورد و گزارش (§۱۵)
// ---------------------------------------------------------------------------

interface ListFilter {
  fromJalali?: string
  toJalali?: string
  mode?: 'issued' | 'used'
  status?: string
  source?: string
  customerId?: number | null
  batchId?: number | null
  search?: string
  includeArchived?: boolean
  onlyWithRemaining?: boolean
  take?: number
  skip?: number
  /** فیلترهای نوار مشترک گزارش روی فاکتور صادرکننده‌ی اعتبار */
  orderType?: string | null
  channels?: readonly string[] | null
  receiptNo?: number | null
  customerSearch?: string | null
  productSearch?: string | null
  userId?: number | null
  shiftId?: number | null
  /** ممیزی A97-01 — شماره‌ی نشست (مثل بقیه‌ی تب‌ها، اشتراک با shiftId) */
  shiftNumber?: number | string | null
  /** ممیزی A97-01 — وضعیت *فاکتور* صدور (نوار گزارش)؛ `status` وضعیت خود اعتبار است */
  invoiceStatus?: string | null
}

/**
 * ---------------------------------------------------------------------------
 * بند ۶ (جلسه ۳۰) · §۱۶ — مرحله‌ی دومِ جست‌وجو: «شماره فاکتور و فیش».
 *
 * چرا دو مرحله و نه یک `where` تودرتو: بین `StoreCredit` و
 * `StoreCreditRedemption` هیچ relation پریزمایی وجود ندارد (هر دو فقط ستون
 * scalar دارند، عمداً — جلسه ۲۰)، و شماره فیشِ *فاکتور* هم روی جدول
 * `SaleInvoice` است. پس اول idها پیدا می‌شوند و بعد به ستون‌های scalar خورده
 * می‌شوند. تصمیمِ «کدام id به کدام ستون» در `creditSearchWhere` (تست‌شده) است.
 *
 * فقط برای عبارت *عددی* اجرا می‌شود، پس جست‌وجوی نام مشتری هیچ کوئری اضافه‌ای
 * نمی‌سازد. سقف‌ها (`take`) عمدی‌اند: یک شماره فیش در عمل به چند ردیف می‌خورد،
 * نه چند هزار.
 * ---------------------------------------------------------------------------
 */
async function creditSearchMatches(plan: CreditSearchPlan): Promise<CreditSearchMatches> {
  if (plan.numeric == null || plan.numeric <= 0) return {}
  const [invoices, redemptions] = await Promise.all([
    prisma.saleInvoice.findMany({ where: { receiptNo: plan.numeric }, select: { id: true }, take: 50 }).catch(() => []),
    prisma.storeCreditRedemption
      .findMany({
        where: { OR: [{ receiptNo: plan.numeric }, { invoiceId: plan.numeric }] },
        select: { creditId: true },
        take: 500
      })
      .catch(() => [])
  ])
  return {
    invoiceIds: invoices.map((i: { id: number }) => i.id),
    creditIds: redemptions.map((r: { creditId: number }) => r.creditId)
  }
}

/**
 * خوشه F / نشست ۹۸ خوشه G — تب legacy اعتبار فیلترهای نوار گزارش را مصرف می‌کند.
 * ممیزی A97-01: منطق به `creditReportScope.ts` منتقل شد تا پل تطبیق هم همان را
 * بخواند؛ مالک (کارمند/شیفت/شماره‌ی نشست) روی سند رویداد صدور (برگشت/تعویض، یا
 * صادرکننده + نشستِ بازِ لحظه‌ی ثبت)، هویت و دروازه‌ی DRAFT/CANCELED روی فاکتور.
 * سقف شناسه (بدون برش بی‌صدا) و دسته‌بندی ۵۰۰تایی نشست ۹۸ حفظ شده است.
 */
export const CREDIT_FILTER_MAX_IDS = CREDIT_SCOPE_MAX_IDS
const CREDIT_FILTER_IN_CHUNK = 500

/** دسته‌بندی ۵۰۰تایی شناسه‌ها برای `IN` (نشست ۹۸؛ مصرف‌کننده‌ی دیگر: نشست ۱۲۴). */
function chunkIds(ids: Iterable<number>): number[][] {
  const uniq = [...new Set([...ids].filter((x) => Number.isFinite(x) && x > 0))]
  const out: number[][] = []
  for (let i = 0; i < uniq.length; i += CREDIT_FILTER_IN_CHUNK) out.push(uniq.slice(i, i + CREDIT_FILTER_IN_CHUNK))
  return out
}

/**
 * ⚠️ از جلسه ۳۰ **async** است (بند ۶): جست‌وجوی شماره فاکتور/فیش یک کوئری کمکی
 * لازم دارد. دو تغییر دیگر همین نشست:
 *   • بند ۴ · §۲/§۱۱/§۱۵ — فیلتر وضعیت روی **وضعیت مؤثر** است، نه ستون خام
 *     (`creditStatusWhere`)، و داخل `AND` می‌نشیند نه روی خودِ شیء؛ وگرنه
 *     `OR`ِ جست‌وجو رونویسی می‌شد (`withAndClause`).
 *   • بند ۶ · §۱۶ — دامنه‌ی جست‌وجو همان چیزی است که `creditSearchPlan` تعریف
 *     می‌کند و placeholder فیلد جست‌وجو وعده می‌دهد.
 */
async function whereFromFilter(filter: ListFilter, now: Date = new Date()): Promise<any> {
  let where: any = {}
  if (filter.fromJalali || filter.toJalali) {
    const fromJalali = filter.fromJalali ?? filter.toJalali ?? jalaliToday()
    const toJalali = filter.toJalali ?? fromJalali
    const range = { gte: jalaliStartOfDay(fromJalali), lte: jalaliEndOfDay(toJalali) }
    if (filter.mode === 'used') where.usedAt = range
    else where.issuedAt = range
  }
  if (filter.source) where.source = normalizeCreditSource(filter.source)
  if (filter.customerId != null) where.customerId = Math.round(Number(filter.customerId) || 0)
  if (filter.batchId != null) where.batchId = Math.round(Number(filter.batchId) || 0)
  if (!filter.includeArchived) where.deletedAt = null
  where = withAndClause(where, creditStatusWhere(filter.status, now))
  // نشست ۹۸ · خوشه G — فقط شناسه‌ی اعتبارهای منطبق (بدون آرایه‌ی عظیم فاکتور)
  // ممیزی A97-01 — مالک روی سند رویداد صدور، نه فاکتور؛ shiftNumber و دروازه‌ی وضعیت فاکتور
  const reportCreditIds = await creditIdsForReportScope(
    {
      orderType: filter.orderType,
      channels: filter.channels,
      receiptNo: filter.receiptNo,
      customerSearch: filter.customerSearch,
      productSearch: filter.productSearch,
      invoiceStatus: filter.invoiceStatus,
      userId: filter.userId,
      shiftId: filter.shiftId,
      shiftNumber: filter.shiftNumber
    },
    where
  )
  if (reportCreditIds) where = withAndClause(where, { id: { in: reportCreditIds } })
  const plan = creditSearchPlan(filter.search)
  if (plan.raw) {
    const or = creditSearchWhere(plan, await creditSearchMatches(plan))
    if (or.length) where.OR = or
  }
  return where
}

/** ممیزی A97-01 — نگاشت فیلتر نوار گزارش به ListFilter (وضعیت نوار = وضعیت فاکتور). */
export async function reportCreditListFilter(filter: ListFilter): Promise<ListFilter> {
  /**
   * تب گزارش فروش نه کد برمی‌گرداند و نه باید آن را قابل جست‌وجو کند؛ در غیر این
   * صورت تعداد نتایج خودش یک oracle برای حدس‌زدن کد می‌شد. جست‌وجوی کد فقط در
   * جریان اختصاصیِ POS/مدیریت اعتبار می‌ماند.
   */
  const { status, search: _codeSearch, ...rest } = (filter ?? {}) as ListFilter
  return { ...rest, invoiceStatus: status ? String(status) : rest.invoiceStatus ?? null }
}

/** جمع «تعهد فروشگاه» (§۱۵): Σ(amount − usedAmount) روی اعتبارهای *زنده*. */
async function liabilityTotal(where: any): Promise<number> {
  const rows = await prisma.storeCredit.findMany({
    where: { ...where, status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED] } },
    select: { amount: true, usedAmount: true, expiresAt: true }
  })
  const now = Date.now()
  return rows.reduce((sum, r) => {
    if (r.expiresAt && new Date(r.expiresAt).getTime() <= now) return sum
    return sum + Math.max(0, Math.round(asNum(r.amount)) - Math.round(asNum(r.usedAmount)))
  }, 0)
}

/** برچسب فارسی رویدادهای Timeline (§۱۶) — روی همان AuditAction های جلسه ۲۰. */
const CREDIT_AUDIT_LABELS: Record<string, string> = {
  [AuditAction.STORE_CREDIT_ISSUE]: 'صدور اعتبار (تعویض کالا)',
  [AuditAction.CREDIT_ISSUE_MANUAL]: 'صدور اعتبار توسط مدیریت',
  [AuditAction.CREDIT_BULK_GENERATE]: 'تولید گروهی',
  [AuditAction.STORE_CREDIT_REDEEM]: 'مصرف اعتبار',
  [AuditAction.CREDIT_REDEEM_BLOCKED]: 'تلاش ناموفق/مسدودشده',
  [AuditAction.CREDIT_VOID]: 'ابطال',
  [AuditAction.CREDIT_SUSPEND]: 'تعلیق',
  [AuditAction.CREDIT_REACTIVATE]: 'فعال‌سازی مجدد',
  [AuditAction.CREDIT_EXPIRY_CHANGE]: 'تغییر تاریخ انقضا',
  [AuditAction.CREDIT_AMOUNT_CHANGE]: 'تغییر مبلغ',
  [AuditAction.CREDIT_USES_CHANGE]: 'تغییر دفعات مصرف',
  [AuditAction.CREDIT_HOLDER_CHANGE]: 'تغییر دارنده',
  [AuditAction.CREDIT_RESTRICTION_CHANGE]: 'تغییر محدودیت',
  [AuditAction.CREDIT_DELETE]: 'حذف',
  [AuditAction.CREDIT_ARCHIVE]: 'آرشیو (حذف نرم)',
  [AuditAction.CREDIT_PRINT]: 'چاپ سند',
  [AuditAction.CREDIT_REPRINT]: 'چاپ مجدد',
  [AuditAction.CREDIT_REMINDER_QUEUE]: 'ثبت یادآوری',
  [AuditAction.STORE_CREDIT_OVER_LIMIT]: 'صدور بالاتر از سقف (با تایید مدیر)'
}

/** نام کاربران چند رویداد، با یک رفت‌و‌برگشت. */
async function userNameMap(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const clean = [...new Set(ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))]
  if (!clean.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: clean } }, select: { id: true, displayName: true } })
  return new Map(users.map((u) => [u.id, u.displayName]))
}

/** هر متن معمولیِ خروجی را از credential همان اعتبار پاک می‌کند. */
function redactCreditCodeText(value: unknown, code: unknown): string {
  const text = String(value ?? '')
  const credential = String(code ?? '').trim()
  return credential ? text.split(credential).join('[کد اعتبار پنهان است]') : text
}

/** payloadهای AuditLog ممکن است snapshot اعتبار داشته باشند؛ کلیدهای حساس حذف می‌شوند. */
function redactCreditAuditPayload(value: unknown, code: unknown): string | null {
  if (value == null || value === '') return null
  try {
    const redact = (input: any): any => {
      if (Array.isArray(input)) return input.map(redact)
      if (!input || typeof input !== 'object') return input
      return Object.fromEntries(Object.entries(input)
        .filter(([key]) => !['code', 'legacyCode', 'storeCreditCode'].includes(key))
        .map(([key, nested]) => [key, redact(nested)]))
    }
    return redactCreditCodeText(JSON.stringify(redact(JSON.parse(String(value)))), code)
  } catch {
    return '[جزئیات حساس اعتبار پنهان است]'
  }
}

function shapeRedemption(r: any, userNames: Map<number, string>): CreditRedemptionRow {
  return {
    id: r.id,
    creditId: r.creditId,
    publicReference: `اعتبار #${r.creditId}`,
    amount: Math.round(asNum(r.amount)),
    remainderAfter: Math.round(asNum(r.remainderAfter)),
    seq: Math.round(asNum(r.seq)) || 1,
    invoiceId: r.invoiceId ?? null,
    receiptNo: r.receiptNo ?? null,
    paymentId: r.paymentId ?? null,
    atJalali: r.atJalali || (r.at ? toJalaliDate(new Date(r.at)) : ''),
    atTime: r.atTime || (r.at ? toClock(new Date(r.at)) : ''),
    userId: r.userId ?? null,
    userName: r.userId != null ? (userNames.get(r.userId) ?? null) : null,
    idempotencyKey: r.idempotencyKey ?? null,
    reversed: !!r.reversedAt,
    reversedAtJalali: r.reversedAt ? toJalaliDate(new Date(r.reversedAt)) : null,
    reversedReason: redactCreditCodeText(r.reversedReason, r.code) || null,
    note: redactCreditCodeText(r.note, r.code) || null
  }
}

function shapeReminderLog(r: any, userNames: Map<number, string>): CreditReminderLogRow {
  const status = String(r.status ?? CreditReminderStatus.READY)
  const kind = String(r.kind ?? CreditReminderKind.UNUSED)
  return {
    id: r.id,
    creditId: r.creditId,
    publicReference: `اعتبار #${r.creditId}`,
    kind,
    kindLabel: kind === CreditReminderKind.NEAR_EXPIRY ? 'نزدیک به انقضا' : 'اعتبار مصرف‌نشده',
    status,
    statusLabel:
      status === CreditReminderStatus.LOGGED
        ? 'ثبت شد (بدون ارسال واقعی)'
        : status === CreditReminderStatus.SKIPPED
          ? 'رد شد (قواعد ضد‌اسپم)'
          : status === CreditReminderStatus.OPTED_OUT
            ? 'مشتری ارسال پیام را نمی‌خواهد'
            : 'آماده‌ی ارسال',
    phone: r.phone ?? null,
    text: redactCreditCodeText(r.text, r.code),
    reason: redactCreditCodeText(r.reason, r.code) || null,
    atJalali: r.atJalali || (r.plannedAt ? toJalaliDate(new Date(r.plannedAt)) : ''),
    atTime: r.atTime || (r.plannedAt ? toClock(new Date(r.plannedAt)) : ''),
    userId: r.userId ?? null,
    userName: r.userId != null ? (userNames.get(r.userId) ?? null) : null
  }
}

/**
 * ممیزی AUDIT-S129-01 — متن Audit چاپی که نتیجه‌اش نامعلوم بود (پنجره‌ی چاپ بسته شد،
 * از کار افتاد یا چاپگر در مهلت پاسخ نداد). شمارنده احتیاطاً بالا می‌رود تا کاغذ بعدی
 * «اصل» دوم نشود؛ این متن نشان می‌دهد که شاید کاغذی بیرون نیامده باشد.
 */
function creditPrintUncertainNote(note: string | null | undefined, uncertain?: boolean): string | null {
  if (!uncertain) return note ?? null
  const tail = 'نتیجه‌ی چاپ نامعلوم بود (پنجره‌ی چاپ بسته شد یا چاپگر پاسخ نداد)؛ احتیاطاً چاپ‌شده شمرده شد'
  return note ? `${note} · ${tail}` : tail
}

  /**
   * پیش‌فیلترِ SQL برای «اعتبارهای سررسید» — مکملِ `reminderDecision`.
   *
   * ⚠️ محافظه‌کار است: هر شرطی که به‌درستی قابل ترجمه نیست (مثل
   * `usedAmount < amount` یا نبودِ شماره که به جدول مشتری وابسته است) این‌جا
   * نمی‌آید و در فیلتر نهایی می‌ماند — چون اشتباهِ این‌طرف فقط یک ردیفِ
   * اضافه در فهرست است، ولی اشتباهِ آن‌طرف، **گم‌شدن** یادآوری است.
   */
function duePrefilter(base: any, settings: CreditReminderSettings, now: number): any {
    const day = 24 * 60 * 60 * 1000
    const and: any[] = []

    /** Opt-out هرگز پیام نمی‌گیرد (ستون نال‌دار ⇒ صریحاً با نال هم می‌سنجیم). */
    and.push({ OR: [{ reminderOptOut: false }, { reminderOptOut: null }] })

    /** سقف تعداد. */
    if (settings.maxCount > 0) and.push({ reminderCount: { lt: settings.maxCount } })

    /** فاصله‌ی مجاز از آخرین پیام. */
    if (settings.minGapDays > 0) {
      const gapCutoff = new Date(now - settings.minGapDays * day)
      and.push({ OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: gapCutoff } }] })
    }

    /** اعتبارِ منقضی هیچ‌وقت واجد شرایط نیست. */
    and.push({ OR: [{ expiresAt: null }, { expiresAt: { gte: new Date(now) } }] })

    /**
     * شرط مثبت: ردیف فقط وقتی می‌تواند «سررسید» باشد که یا از صدورِ آن
     * `minDaysSinceIssue` روز گذشته باشد، یا در پنجره‌ی «نزدیک انقضا» باشد.
     *
     * 🔴 بازبینی دهم (SMS-R10-01): این شرط فقط وقتی معنا دارد که
     * `minDaysSinceIssue > 0` باشد. اگر ۰ باشد (مقدارِ مجاز — `parseCreditSettings`
     * صفر را می‌پذیرد و فیلد UI هم قبول می‌کند)، `reminderDecision` **هر**
     * اعتبارِ سالمی را واجد شرایط می‌داند؛ ولی پیش‌فیلترِ قبلی فقط پنجره‌ی
     * «نزدیک انقضا» را نگه می‌داشت و اعتبارهای بدون‌انقضا یا دور از انقضا را
     * از فهرست بیرون می‌انداخت ⇒ زمان‌بند خودکار `ran: true` و
     * `queued: 0` می‌داد و یادآوری **بی‌صدا** هرگز نمی‌رفت.
     *
     * پس: وقتی `minDaysSinceIssue <= 0` است، هیچ شرط مثبتی اضافه نمی‌شود
     * (پیش‌فیلتر باید *فراگیرتر* از تصمیم نهایی باشد، نه تنگ‌تر).
     */
    if (settings.minDaysSinceIssue > 0) {
      const positive: any[] = [{ issuedAt: { lte: new Date(now - settings.minDaysSinceIssue * day) } }]
      if (settings.beforeExpiryDays > 0)
        positive.push({ expiresAt: { gte: new Date(now), lte: new Date(now + settings.beforeExpiryDays * day) } })
      and.push({ OR: positive })
    }

    return { AND: [base, ...and] }
  }

export const storeCreditService = {
  /**
   * مسیر محرمانه و تک‌منظورهٔ نمایش کد از روی یک source گزارش.
   *
   * کد فقط پس از کنترلِ نشستِ واقعی مدیر در main خوانده می‌شود؛ رمز دوم پنل،
   * خاموش بودن قفل، state رندرر و payload IPC هیچ‌کدام مجوز افشا نیستند. این
   * متد عمداً تنها یک رکورد برمی‌گرداند و نه list/detail/report، تا کد به
   * مسیرهای معمولِ گزارش، export، چاپ یا index نشت نکند.
   */
  async revealManagerCode(input: {
    sourceId?: unknown
    sourceSubKind?: unknown
  } = {}): Promise<ManagerStoreCreditCodeReveal> {
    assertManagerSession('نمایش کد اعتبار خرید')

    const sourceId = assertCreditId(input.sourceId)
    const sourceSubKind = String(input.sourceSubKind ?? '')
    let creditId: number

    if (sourceSubKind === 'STORE_CREDIT_ISSUANCE' || sourceSubKind === 'STORE_CREDIT') {
      /** `STORE_CREDIT` فقط برای جزئیات امن پنل مدیریت است، نه DTO معمولی. */
      creditId = sourceId
    } else if (sourceSubKind === 'STORE_CREDIT_REDEMPTION') {
      const redemption = await prisma.storeCreditRedemption.findUnique({
        where: { id: sourceId },
        select: { creditId: true }
      })
      if (!redemption) throw new BusinessError('سند مصرف اعتبار پیدا نشد؛ ممکن است حذف یا اصلاح شده باشد.')
      creditId = Number(redemption.creditId)
    } else {
      throw new BusinessError('نوع سند اعتبار برای نمایش کد نامعتبر است.')
    }

    const credit = await prisma.storeCredit.findUnique({
      where: { id: creditId },
      select: { id: true, code: true }
    })
    if (!credit) throw new BusinessError('اعتبار مربوط به این سند پیدا نشد؛ ممکن است حذف شده باشد.')

    return { creditId: Number(credit.id), code: String(credit.code) }
  },

  /**
   * بررسی یک اعتبار *بدون* مصرف کردنش (دکمه‌ی «بررسی» پنل فروش).
   * کد فقط ورودیِ اعتبارسنجی است؛ پاسخِ استاندارد شناسهٔ امن دارد، نه credential.
   *
   * ⚠️ این تابع بیرون از هر تراکنشی اجرا می‌شود، پس همان‌جا **قفل موقت کد**
   * (§۸) اعمال می‌شود: کد اشتباه پشت‌سرهم ⇒ قفل، دقیقاً مثل رمز دوم پنل‌ها.
   */
  async lookup(input: { code?: string; userId?: number | null } = {}): Promise<StoreCreditSafeRow> {
    const row = await guardCreditCode(String(input?.code ?? ''), input?.userId ?? null)
    const map = await receiptNoMap(prisma, [row])
    return shapeStoreCreditSafe(shapeStoreCredit(row, map))
  },

  /**
   * پیش‌نمایش مصرف روی یک سبد *قبل از* ثبت فاکتور (§۱۷ و §۱۸).
   * هیچ چیزی را تغییر نمی‌دهد؛ فقط می‌گوید چقدر قابل جذب است و کدام اقلام سبد
   * با محدودیت این اعتبار می‌خوانند — با **همان** `decideRedeem` که Backend در
   * لحظه‌ی ثبت استفاده می‌کند، پس UI و Backend هیچ‌وقت دو حرف نمی‌زنند.
   */
  async preview(input: {
    code?: string
    applicable?: number
    invoiceTotal?: number
    requested?: number | null
    customerId?: number | null
    lines?: CreditCartLine[]
    userId?: number | null
  }): Promise<{
    credit: StoreCreditSafeRow
    ok: boolean
    applied: number
    error: string | null
    notes: string[]
    eligibleVariantIds: number[]
    excludedVariantIds: number[]
  }> {
    const row = await guardCreditCode(String(input?.code ?? ''), input?.userId ?? null)
    const decision = decideRedeem(row, {
      applicable: Math.max(0, Math.round(Number(input.applicable ?? row.amount) || 0)),
      invoiceTotal: input.invoiceTotal == null ? undefined : Math.max(0, Math.round(Number(input.invoiceTotal) || 0)),
      lines: input.lines ?? [],
      customerId: input.customerId ?? null,
      requested: input.requested ?? null
    })
    const map = await receiptNoMap(prisma, [row])
    return {
      credit: shapeStoreCreditSafe(shapeStoreCredit(row, map)),
      ok: decision.ok,
      applied: decision.applied,
      error: decision.error,
      notes: decision.notes,
      eligibleVariantIds: decision.eligibility?.eligibleVariantIds ?? [],
      excludedVariantIds: decision.eligibility?.excludedVariantIds ?? []
    }
  },

  /**
   * فهرست اعتبارها.
   * `mode`: issued = بر اساس تاریخ *صدور* · used = بر اساس تاریخ *مصرف*.
   * فیلترهای تازه (نوع، مشتری، دسته‌ی گروهی، جست‌وجوی متنی، آرشیو) همه اختیاری‌اند
   * و بدون آن‌ها رفتار عیناً همان نسخه‌ی قبل است.
   */
  /**
   * ممیزی A97-01 — ورودی تب legacy «اعتبار خرید» گزارش فروش (کانال storeCreditList).
   * نوار گزارش `status` را برای *وضعیت فاکتور* می‌فرستد؛ پیش از این همان مقدار به
   * `creditStatusWhere` می‌رسید ⇒ «تسویه شده» تب را بی‌صدا خالی می‌کرد و «لغو شده»
   * اعتبارهای لغوشده را نشان می‌داد. اینجا به `invoiceStatus` نگاشت می‌شود.
   */
  async reportList(filter: ListFilter = {}): Promise<PagedRows<StoreCreditReportRow>> {
    return this.list(await reportCreditListFilter(filter))
  },

  /**
   * فهرست عادی مدیریت نیز credential ندارد. جست‌وجوی کد حذف است تا تعداد ردیف‌ها
   * به oracle حدس‌زدن کد تبدیل نشود؛ POS فقط برای اعتبارسنجیِ کدی که کاربر دارد
   * از lookup اختصاصی استفاده می‌کند.
   */
  async list(filter: ListFilter = {}): Promise<PagedRows<StoreCreditReportRow>> {
    const { search: _credentialSearch, ...safeFilter } = filter ?? {}
    const where = await whereFromFilter({
      ...safeFilter,
      fromJalali: safeFilter.fromJalali ?? (safeFilter.batchId != null ? undefined : jalaliToday()),
      toJalali: safeFilter.toJalali
    })
    const page = creditPage(filter.take, filter.skip, 0)
    let rows: any[]
    if (filter.onlyWithRemaining) {
      /**
       * `amount > usedAmount` را نمی‌شود با یک فیلد Prisma عادی نوشت. این
       * lookup عمداً بدون take انجام می‌شود تا تیک «فقط دارای باقی‌مانده»
       * خودش باعث برش بی‌صدا نشود؛ صفحه‌بندی بعد از همین فیلتر اعمال می‌شود.
       */
      const candidates = await prisma.storeCredit.findMany({
        where,
        orderBy: CREDIT_ORDER_BY.list,
        select: { id: true, amount: true, usedAmount: true }
      })
      const remainingIds = candidates
        .filter((r) => Math.round(asNum(r.amount)) > Math.round(asNum(r.usedAmount)))
        .map((r) => r.id)
      page.totalCount = remainingIds.length
      const ids = remainingIds.slice(page.skip, page.skip + page.take)
      /**
       * نشست ۱۷۵ · S175-D4 — شناسه‌های صفحه (take پیش‌فرض ۱٬۰۰۰، تا ۵٬۰۰۰) یکجا در `id in` از سقف IN
       * ۵۰۰ رد می‌شد. حالا دسته‌های ۵۰۰تایی و بازچینی به ترتیب همان remainingIds (که خودش با
       * CREDIT_ORDER_BY.list خوانده شده) ⇒ ترتیب و محتوای صفحه عیناً همان قبلی.
       */
      const byId = new Map<number, any>()
      for (const part of chunkIds(ids)) {
        const got = await prisma.storeCredit.findMany({
          where: withAndClause(where, { id: { in: part } }),
          orderBy: CREDIT_ORDER_BY.list
        })
        for (const r of got) byId.set(r.id, r)
      }
      rows = ids.map((id) => byId.get(id)).filter((r) => r != null)
    } else {
      page.totalCount = await prisma.storeCredit.count({ where })
      rows = await prisma.storeCredit.findMany({
        where,
        orderBy: CREDIT_ORDER_BY.list,
        take: page.take,
        skip: page.skip
      })
    }
    const map = await receiptNoMap(prisma, rows)
    const shaped = rows.map((r) => shapeStoreCreditSafe(shapeStoreCredit(r, map)))
    return attachCreditPage(shaped, page)
  },

  /**
   * جمع مبلغ اعتبارهای *صادرشده* در یک بازه.
   * گزارش فروش با همین عدد «خالص واقعی دریافتی» را حساب می‌کند: اعتبار صادرشده
   * بدهی ماست، پس از پول واقعی دریافتی کم می‌شود. (امضا و معنایش دست‌نخورده.)
   */
  async issuedTotal(from: Date, to: Date): Promise<number> {
    const res = await prisma.storeCredit.aggregate({
      where: { issuedAt: { gte: from, lte: to }, deletedAt: null },
      _sum: { amount: true }
    })
    /**
     * نشست ۱۸۱ — این یک **جمع تجمیعی** است (`_sum`), پس تنها جایی در این فایل
     * که واقعاً می‌تواند از محدوده‌ی امن عدد جاوااسکریپت رد شود. `toNumberRial`
     * در آن حالت خطا می‌دهد؛ عمداً، چون یک گزارش که می‌ایستد بی‌نهایت بهتر از
     * گزارشی است که با اطمینان عدد غلط نشان می‌دهد.
     */
    return toNumberRial(res._sum.amount ?? 0)
  },

  /**
   * صفحه‌ی جزئیات یک اعتبار (§۱۶): مبلغ اولیه/مصرف‌شده/باقی‌مانده، دفعات
   * مجاز/استفاده‌شده، دفتر مصرف، لاگ یادآوری، و **Timeline کامل** که از همان
   * `AuditLog` (§۱۰) + ردیف‌های مصرف ساخته می‌شود (نه یک جدول لاگ موازی).
   */
  async detail(input: {
    id?: number
    timelineTake?: number
    timelineSkip?: number
    reminderTake?: number
    reminderSkip?: number
  }): Promise<CreditDetail> {
    const id = assertCreditId(input?.id)
    const row = await prisma.storeCredit.findUnique({ where: { id } })
    if (!row) throw new BusinessError('این اعتبار پیدا نشد. فهرست را تازه کنید.')

    const timelinePage = creditPage(input.timelineTake ?? 500, input.timelineSkip, await prisma.auditLog.count({
      where: { entity: 'StoreCredit', entityId: row.id }
    }))
    const remindersPage = creditPage(input.reminderTake ?? 100, input.reminderSkip, await prisma.creditReminderLog.count({
      where: { creditId: row.id }
    }))
    const [redemptions, logs, reminders, batch] = await Promise.all([
      prisma.storeCreditRedemption.findMany({ where: { creditId: row.id }, orderBy: CREDIT_ORDER_BY.redemptions }),
      prisma.auditLog.findMany({
        where: { entity: 'StoreCredit', entityId: row.id },
        orderBy: CREDIT_ORDER_BY.timeline,
        take: timelinePage.take,
        skip: timelinePage.skip
      }),
      prisma.creditReminderLog.findMany({
        where: { creditId: row.id },
        orderBy: CREDIT_ORDER_BY.reminderLogs,
        take: remindersPage.take,
        skip: remindersPage.skip
      }),
      row.batchId ? prisma.storeCreditBatch.findUnique({ where: { id: row.batchId } }) : Promise.resolve(null)
    ])

    const userNames = await userNameMap([
      row.userId,
      ...redemptions.map((r) => r.userId),
      ...logs.map((l) => l.userId),
      ...reminders.map((r) => r.userId)
    ])
    const map = await receiptNoMap(prisma, [row])

    const timeline: CreditTimelineEvent[] = logs.map((l) => {
      const at = l.at instanceof Date ? l.at : new Date(l.at)
      return {
        id: l.id,
        action: l.action,
        actionLabel: CREDIT_AUDIT_LABELS[l.action] ?? l.action,
        atJalali: toJalaliDate(at),
        atTime: toClock(at),
        userId: l.userId ?? null,
        userName: l.userId != null ? (userNames.get(l.userId) ?? null) : null,
        before: redactCreditAuditPayload(l.before, row.code),
        after: redactCreditAuditPayload(l.after, row.code),
        note: redactCreditCodeText(l.note, row.code) || null
      }
    })

    const remainderCredit = row.remainderCreditId
      ? await prisma.storeCredit.findUnique({ where: { id: row.remainderCreditId }, select: { id: true, code: true, amount: true } })
      : null

    const timelineRows = attachPagedRows(timeline, timelinePage, 'رویداد')
    const reminderRows = attachPagedRows(
      reminders.map((r) => shapeReminderLog(r, userNames)),
      remindersPage,
      'یادآوری'
    )

    return {
      credit: shapeStoreCreditSafe(shapeStoreCredit(row, map)),
      redemptions: redemptions.map((r) => shapeRedemption(r, userNames)),
      reminders: reminderRows,
      remindersPage,
      remindersWarnings: reminderRows.warnings,
      timeline: timelineRows,
      timelinePage,
      timelineWarnings: timelineRows.warnings,
      issuedByName: row.userId != null ? (userNames.get(row.userId) ?? null) : null,
      batch: batch
        ? {
            id: batch.id,
            title: batch.title,
            count: batch.count,
            amountEach: toNumberRial(batch.amountEach),
            totalAmount: toNumberRial(batch.totalAmount),
            createdAtJalali: batch.createdAtJalali,
            createdAtTime: batch.createdAtTime,
            lengthGrown: batch.lengthGrown === true,
            source: batch.source,
            note: batch.note ?? null
          }
        : null,
      remainderCredit: remainderCredit
        ? { id: remainderCredit.id, publicReference: `اعتبار #${remainderCredit.id}`, amount: Math.round(asNum(remainderCredit.amount)) }
        : null
    }
  },

  /** فهرست دسته‌های تولید گروهی (مبنای چاپ دسته‌ای PDF — §۵ و §۱۳). */
  async batches(
    filter: { fromJalali?: string; toJalali?: string; take?: number; skip?: number } = {}
  ): Promise<PagedRows<CreditBatchRow>> {
    const where: any = {}
    /**
     * ممیزی A119-01 (AUDIT-D55) — خالی ⇒ بدون قید (فهرست مدیریتی، همان رفتار قبل)؛ نامعتبر ⇒ خطای فارسی (قبلاً «۱۴۰۵/۱۳/۰۱»
     * بی‌صدا سال بعد ⇒ فهرست خالی)؛ بازه‌ی معکوس ⇒ خطای فارسی. «از» خالی با «تا» پر ⇒ همان یک روز (رفتار قبل).
     */
    const scope = 'فهرست دسته‌های اعتبار'
    const fromIn = reportDayInput(filter.fromJalali, 'از تاریخ', scope)
    const toIn = reportDayInput(filter.toJalali, 'تا تاریخ', scope)
    if (fromIn || toIn) {
      const from = fromIn ?? toIn ?? jalaliToday()
      const to = toIn ?? from
      if (from > to) throw new BusinessError(`بازه‌ی ${scope} معکوس است: «از تاریخ» (${from}) بعد از «تا تاریخ» (${to}) است.`)
      where.createdAt = { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) }
    }
    const totalCount = await prisma.storeCreditBatch.count({ where })
    const page = creditPage(filter.take ?? 200, filter.skip, totalCount)
    const rows = await prisma.storeCreditBatch.findMany({
      where,
      orderBy: CREDIT_ORDER_BY.batchList,
      take: page.take,
      skip: page.skip
    })
    const shaped = rows.map((b) => ({
      id: b.id,
      title: b.title,
      count: b.count,
      amountEach: toNumberRial(b.amountEach),
      totalAmount: toNumberRial(b.totalAmount),
      createdAtJalali: b.createdAtJalali,
      createdAtTime: b.createdAtTime,
      lengthGrown: b.lengthGrown === true,
      source: b.source,
      note: b.note ?? null
    }))
    return attachPagedRows(shaped, page, 'دسته')
  },

  /**
   * داشبورد اعتبار (§۱۵).
   *
   * همه‌ی عددها با `groupBy`/`aggregate` روی *کل بازه* حساب می‌شوند، نه روی یک
   * صفحه‌ی صفحه‌بندی‌شده (همان درسی که جلسه ۱۴ در `accountingReport` گرفت).
   * «تعهد فروشگاه» (Liability) هم اگر در تنظیمات روشن باشد برمی‌گردد: اعتبار
   * صادرشده و مصرف‌نشده، بدهی فروشگاه است.
   */
  async dashboard(filter: ListFilter = {}): Promise<CreditDashboard> {
    const settings = await readCreditSettings(prisma)
    const now = new Date()
    const where = await whereFromFilter(filter, now)

    /**
     * بند ۴ (جلسه ۳۰) · §۲/§۱۵ — داشبورد روی **وضعیت مؤثر**.
     *
     * باگ واقعی: یک اعتبار `ACTIVE`ِ تاریخ‌گذشته در کارت «مصرف‌نشده (معتبر)»
     * شمرده می‌شد و در «منقضی» نه، چون ستون `status` عقب مانده بود و
     * `effectiveStatus` فقط در *نمایش ردیف* اعمال می‌شد — یعنی داشبورد و فهرست
     * دو عدد متفاوت می‌دادند و «تعهد فروشگاه» بزرگ‌تر از واقعیت دیده می‌شد.
     * حالا یک `groupBy` دومِ «تاریخ‌گذشته» گرفته می‌شود و `rollExpiredBuckets`
     * سطل‌ها را جابه‌جا می‌کند: جمع کل عوض نمی‌شود، فقط جای درستش را پیدا می‌کند.
     */
    const [groups, expiring, totals, nearExpiry, todayCount, liability] = await Promise.all([
      prisma.storeCredit.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amount: true, usedAmount: true } }),
      prisma.storeCredit.groupBy({
        by: ['status'],
        where: { ...where, status: { in: [...EXPIRABLE_STATUSES] }, expiresAt: { lte: now } },
        _count: { _all: true },
        _sum: { amount: true, usedAmount: true }
      }),
      prisma.storeCredit.aggregate({ where, _count: { _all: true }, _sum: { amount: true, usedAmount: true } }),
      prisma.storeCredit.count({
        where: {
          ...where,
          status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED] },
          expiresAt: {
            gt: now,
            lte: new Date(now.getTime() + Math.max(1, settings.reminder.beforeExpiryDays || 7) * DAY_MS)
          }
        }
      }),
      prisma.storeCredit.count({
        where: { ...where, issuedAt: { gte: jalaliStartOfDay(jalaliToday()), lte: jalaliEndOfDay(jalaliToday()) } }
      }),
      settings.reportLiability ? liabilityTotal(where) : Promise.resolve(0)
    ])

    const bucketOf = (g: any): CreditStatusBucket => ({
      status: String(g.status),
      count: Number(g._count?._all ?? 0),
      amount: Math.round(asNum(g._sum?.amount)),
      usedAmount: Math.round(asNum(g._sum?.usedAmount))
    })
    const byStatus = rollExpiredBuckets(groups.map(bucketOf), expiring.map(bucketOf)).map((b) => ({
      status: b.status,
      statusLabel: CREDIT_STATUS_LABELS[b.status] ?? b.status,
      count: b.count,
      amount: b.amount,
      usedAmount: b.usedAmount
    }))
    const of = (status: string): { count: number; amount: number; usedAmount: number } =>
      byStatus.find((s) => s.status === status) ?? { count: 0, amount: 0, usedAmount: 0 }

    const issuedTotal = Math.round(asNum(totals._sum?.amount))
    const usedTotal = Math.round(asNum(totals._sum?.usedAmount))
    const active = of(StoreCreditStatus.ACTIVE)
    const partial = of(StoreCreditStatus.PARTIALLY_USED)

    return {
      issuedCount: Number(totals._count?._all ?? 0),
      issuedTotal,
      usedTotal,
      remainingTotal: Math.max(0, issuedTotal - usedTotal),
      activeCount: active.count + partial.count,
      activeValue: Math.max(0, active.amount + partial.amount - active.usedAmount - partial.usedAmount),
      unusedCount: active.count,
      fullyUsedCount: of(StoreCreditStatus.USED).count,
      expiredCount: of(StoreCreditStatus.EXPIRED).count,
      canceledCount: of(StoreCreditStatus.CANCELED).count,
      suspendedCount: of(StoreCreditStatus.SUSPENDED).count,
      draftCount: of(StoreCreditStatus.DRAFT).count,
      nearExpiryCount: nearExpiry,
      todayCount,
      liability,
      liabilityReported: settings.reportLiability,
      byStatus,
      bySource: await (async () => {
        const rows = await prisma.storeCredit.groupBy({
          by: ['source'],
          where,
          _count: { _all: true },
          _sum: { amount: true, usedAmount: true }
        })
        return rows.map((r) => ({
          source: String(r.source),
          sourceLabel: CREDIT_SOURCE_LABELS[String(r.source)] ?? String(r.source),
          count: Number(r._count?._all ?? 0),
          amount: Math.round(asNum(r._sum?.amount)),
          usedAmount: Math.round(asNum(r._sum?.usedAmount))
        }))
      })()
    }
  },

  // ---------------- عملیات مدیریتی (همه با رمز مدیر + Audit) ----------------
  void: voidCredit,
  suspend: suspendCredit,
  reactivate: reactivateCredit,
  changeExpiry: changeCreditExpiry,
  changeAmount: changeCreditAmount,
  changeUses: changeCreditUses,
  changeHolder: changeCreditHolder,
  changeRestrictions: changeCreditRestrictions,
  remove: deleteCredit,
  bulkIssue: bulkIssueCredits,

  /** صدور تکیِ «اعتبار مدیریتی» (§۲) — همان `issueStoreCredit` با نوع MANUAL. */
  async issueManual(input: IssueCreditInput): Promise<StoreCreditSafeRow> {
    /**
     * نشست ۱۴۳ · بند ۴-۲۹ — صدور دستی اعتبار بدون فاکتور واقعی همیشه رمز مدیر
     * می‌خواهد؛ Gate رندرر کافی نبود چون هر تماس IPC دورش می‌زد. پیش از تراکنش.
     */
    /**
     * 🔴 نشست ۱۸۴ · بند ۴-۲۹ — نسخه‌ی «همیشه رمز».
     * `assertPanelPassword` اگر قفل ماژول خاموش بود بدون هیچ رمزی رد می‌کرد،
     * یعنی فروشنده می‌توانست برای خودش اعتبار میلیونی صادر کند.
     */
    await assertPanelPasswordStrict(PANEL_KEYS.creditManagement, input.managerPassword, 'صدور دستی اعتبار خرید')
    const settings = await readCreditSettings(prisma)
    /**
     * AUDIT-S143-01 (AUDIT-D76) — فیلدهای «فقط سرور» از payload رندرر حذف می‌شوند: issuedAt (تاریخ صدور گذشته
     * داخل دوره‌ی بسته، بند ۴-۱۸/۴-۴۸)، auditAction (پنهان‌کردن ردپای بند ۴-۲۹)، code، batchId و پیوند به سند
     * واقعی (returnId/sourceInvoiceId/exchangeInvoiceId؛ اعتبار دستی نباید برگشتی جا زده شود، بند ۴-۳۷).
     */
    const {
      issuedAt: _issuedAt, auditAction: _auditAction, code: _code, batchId: _batchId,
      returnId: _returnId, sourceInvoiceId: _sourceInvoiceId, exchangeInvoiceId: _exchangeInvoiceId,
      settings: _settings, ...safeInput
    } = input as IssueCreditInput & Record<string, unknown>
    const created = await prisma.$transaction(
      async (tx) => issueStoreCredit(tx, { ...safeInput, source: CreditSource.MANUAL, settings }),
      TX_OPTIONS
    )
    return shapeStoreCreditSafe(shapeStoreCredit(created))
  },

  /**
   * ثبت چاپ یک سند اعتبار (§۱۳). چاپ مجدد **اعتبار جدید نمی‌سازد**؛ فقط
   * شمارنده‌ی چاپ بالا می‌رود و از نسخه‌ی دوم به بعد برچسب «نسخه‌ی مجدد» روی
   * کاغذ می‌نشیند (قالب چاپ از `printCount` می‌خواند).
   */
  async markPrinted(input: {
    id: number
    userId?: number | null
    /** جلسه ۲۵ — کاغذ واقعی یا فایل PDF؟ فقط برای متن لاگ (§۱۰). */
    channel?: 'PRINT' | 'PDF'
    file?: string | null
    /** ممیزی AUDIT-S129-01 — نتیجه‌ی چاپ نامعلوم بود و احتیاطاً شمرده می‌شود. */
    uncertain?: boolean
  }): Promise<StoreCreditSafeRow> {
    const now = new Date()
    /**
     * جلسه ۲۹ · §۱۰ — به‌روزرسانی شمارنده و لاگش داخل **یک** تراکنش رفتند.
     * دلیلش fail-closed شدن لاگ همین نشست است: اگر ردیف AuditLog ننشیند،
     * `printCount` هم بالا نمی‌رود، وگرنه کاغذ «نسخه‌ی مجدد» می‌شد بدون این‌که
     * هیچ سندی بگوید نسخه‌ی اول کِی و به دست کِی چاپ شد.
     */
    return prisma.$transaction(async (tx) => {
      const row = await loadCredit(tx, input.id)
      const next = Math.max(0, Math.round(asNum(row.printCount))) + 1
      const updated = await tx.storeCredit.update({
        where: { id: row.id },
        data: creditPrintSetData(next, now)
      })
      /**
       * جلسه ۳۴ · بخش ۹.۳ — *شکلِ* همین ردیف لاگ (عمل، موجودیت، before/after و
       * متنش) هم یک تصمیم مشترک شد. تا دیروز `after` اینجا و در `markPrintedMany`
       * دو کلید متفاوت داشت و هیچ گزاره‌ای نمی‌توانست بگوید کدام درست است؛
       * بندهای ۷ تا ۱۴ هارنس ۲۵ فقط *متن* این بلوک را می‌دیدند (STRUCTURAL).
       */
      const prev = Math.max(0, Math.round(asNum(row.printCount)))
      const log = creditPrintAudit(
        { entityId: row.id, code: row.code, prev, channel: input.channel, file: input.file ?? null },
        faDigits
      )
      await audit(tx, {
        action: AuditAction[log.action],
        entity: log.entity,
        entityId: log.entityId,
        userId: input.userId ?? null,
        before: redactCreditAuditPayload(log.before, row.code),
        after: redactCreditAuditPayload(log.after, row.code),
        note: redactCreditCodeText(creditPrintUncertainNote(log.note, input.uncertain), row.code)
      })
      return shapeStoreCreditSafe(shapeStoreCredit(updated))
    }, TX_OPTIONS)
  },

  /**
   * -------------------------------------------------------------------------
   * جلسه ۲۵ · §۱۳ + §۱۰ — شمارنده‌ی چاپ برای مسیرهای **گروهی**.
   *
   * باگی که جلسه ۲۴ باقی گذاشت: `printCredit` (تکی) شمارنده را بالا می‌برد، ولی
   * «چاپ دسته‌ای» و «چاپ گروهی انتخاب‌شده‌ها» و «PDF دسته» هیچ‌وقت `printCount`
   * را دست نمی‌زدند. نتیجه: یک دسته‌ی هزارتایی را می‌شد بی‌نهایت بار چاپ کرد و
   * هر بار هم روی کاغذ «اصل» بنویسد، چون `reprint` از همین `printCount` می‌آید.
   * §۱۳ («چاپ مجدد باید برچسب بخورد») و §۱۰ («هر چاپ باید در لاگ باشد») در آن
   * مسیرها عملاً خاموش بودند. اینجا وصل می‌شوند.
   *
   * کارایی (§۵): یک `updateMany` با `increment` — نه N رفت‌وبرگشت — و لاگ‌ها با
   * `createMany` تکه‌تکه. `increment` یعنی حتی اگر دو کاربر همزمان یک دسته را
   * چاپ کنند، شمارنده هیچ نسخه‌ای را گم نمی‌کند (خواندن-و-نوشتن نیست).
   * -------------------------------------------------------------------------
   */
  async markPrintedMany(input: {
    ids: number[]
    userId?: number | null
    batchId?: number | null
    channel?: 'PRINT' | 'PDF'
    file?: string | null
    /** ممیزی AUDIT-S129-01 — نتیجه‌ی چاپ نامعلوم بود و احتیاطاً شمرده می‌شود. */
    uncertain?: boolean
  }): Promise<{ marked: number; reprints: number }> {
    const ids = cleanCreditIds(input?.ids)
    if (!ids.length) return { ...CREDIT_MARK_PRINTED_NONE }
    const before = await prisma.storeCredit.findMany({
      where: creditIdsWhere(ids),
      select: CREDIT_PRINT_SELECT
    })
    if (!before.length) return { ...CREDIT_MARK_PRINTED_NONE }
    const now = new Date()
    const res = await prisma.storeCredit.updateMany({
      where: creditIdsWhere(before.map((r: { id: number }) => r.id)),
      data: creditPrintIncrementData(now)
    })
    const reprints = creditReprintCount(before.map((r: { printCount: unknown }) => asNum(r.printCount)))
    // §۱۰ — ردیف لاگ روی *خودِ هر اعتبار* تا Timeline جزئیات چاپ دسته‌ای را ببیند
    await auditMany(
      prisma,
      before.map((r: { id: number; code: string; printCount: unknown }) => {
        const log = creditPrintAudit(
          {
            entityId: r.id,
            code: r.code,
            prev: Math.round(asNum(r.printCount)),
            channel: input.channel,
            group: true,
            batchId: input.batchId ?? null,
            file: input.file ?? null
          },
          faDigits
        )
        return {
          action: AuditAction[log.action],
          entity: log.entity,
          entityId: log.entityId,
          userId: input.userId ?? null,
          before: redactCreditAuditPayload(log.before, r.code),
          after: redactCreditAuditPayload(log.after, r.code),
          note: redactCreditCodeText(creditPrintUncertainNote(log.note, input.uncertain), r.code)
        }
      })
    )
    // یک ردیف خلاصه روی خودِ دسته، تا گزارش دسته‌ها هم قابل پیگیری باشد
    if (input.batchId) {
      const summary = creditBatchPrintAudit(
        { batchId: input.batchId, count: res.count, reprints, channel: input.channel, file: input.file ?? null },
        faDigits
      )
      await audit(prisma, {
        action: AuditAction[summary.action],
        entity: summary.entity,
        entityId: summary.entityId,
        userId: input.userId ?? null,
        after: summary.after,
        note: summary.note
      })
    }
    return { marked: res.count, reprints }
  },

  /**
   * فهرست «اعتبارهای واجد شرایط یادآوری» (§۱۴) — یک قابلیت *مستقل و مفید*،
   * حتی با این‌که هیچ پیامکی ارسال نمی‌شود. منطق «باید بفرستد یا نه» کامل از
   * `reminderDecision` می‌آید (Opt-out، فاصله‌ی مجاز، سقف تعداد، نزدیک انقضا،
   * N روز از صدور).
   */
  async reminderCandidates(
    filter: { onlyDue?: boolean; source?: string; take?: number } = {}
  ): Promise<{ enabled: boolean; rows: CreditReminderCandidateRow[] }> {
    const settings = await readCreditSettings(prisma)
    const take = clampInt(filter.take ?? 500, 1, 5000, 500)
    const now = Date.now()
    const baseWhere: any = {
      deletedAt: null,
      status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED] }
    }
    if (filter.source) baseWhere.source = normalizeCreditSource(filter.source)

    /**
     * 🔴 بازبینی نهم (SMS-R9-01) — «گرسنگیِ پنجره».
     *
     * تا امروز فیلترِ «سررسید» **بعد از** `take` اعمال می‌شد و ترتیب پرس‌وجو
     * `issuedAt: asc` است؛ یعنی همیشه قدیمی‌ترین‌ها اول خوانده می‌شدند. در
     * فروشگاهی که چند صد اعتبار قدیمیِ سقف‌پر دارد، پنجره‌ی ۲۰۰تاییِ زمان‌بند
     * خودکار تماماً از همان‌های بی‌فایده پر می‌شد و اعتبارِ واجد شرایطِ تازه
     * هیچ‌وقت دیده نمی‌شد ⇒ یادآوری خودکار **بی‌صدا** هیچ‌وقت نمی‌رفت.
     *
     * دو لایه رفع شد:
     *   ۱) قواعدِ «اصلاً واجد شرایط نیست» به خودِ پرس‌وجو منتقل شدند تا پنجره‌ی
     *      خواندن از اول تمیز باشد (سقف تعداد، فاصله، Opt-out، منقضی، و پنجره‌ی
     *      مثبتِ «N روز از صدور»/«نزدیک انقضا»).
     *   ۲) پویش صفحه‌به‌صفحه: حتی اگر ردیفی از فیلترهای SQL رد شود و بعداً
     *      واجد شرایط نباشد (مثلاً بی‌شماره یا مصرف‌شده)، خواندن ادامه پیدا
     *      می‌کند تا `take` ردیفِ **واقعاً واجد شرایط** جمع شود — نه اینکه به
     *      اندازه‌ی سقف نگاه کنیم و تسلیم شویم.
     *
     * ⚠️ تصمیم نهایی هنوز همان `reminderDecision` است؛ این‌ها فقط *پیش‌فیلتر*
     * و پویش‌اند، پس رفتار برای ردیف‌های مرزی عوض نمی‌شود.
     */
    const where = filter.onlyDue ? duePrefilter(baseWhere, settings.reminder, now) : baseWhere
    const pageSize = filter.onlyDue ? 500 : take
    /** سقف پویش: ۲۰٬۰۰۰ ردیف. بیشتر از این یعنی جدول واقعاً غول است؛ تسلیم می‌شویم. */
    const maxPages = filter.onlyDue ? 40 : 1

    const out: CreditReminderCandidateRow[] = []
    let skip = 0
    for (let page = 0; page < maxPages && out.length < take; page++) {
      const rows: any[] = await prisma.storeCredit.findMany({
        where,
        orderBy: CREDIT_ORDER_BY.reminderCandidates,
        take: pageSize,
        ...(skip > 0 ? { skip } : {})
      })
      if (!rows.length) break

      const customerIds = [
        ...new Set(rows.map((r) => r.customerId).filter((n): n is number => n != null && Number.isInteger(n) && n > 0))
      ]
      /** نشست ۱۷۵ · S175-D4 — شناسه‌ی مشتری‌ها در دسته‌های ۵۰۰تایی (سقف IN، S99-2) */
      const customers: Array<{ id: number; name: string; phone: string | null }> = []
      for (const part of chunkIds(customerIds))
        customers.push(
          ...(await prisma.customer.findMany({ where: { id: { in: part } }, select: { id: true, name: true, phone: true } }))
        )
      const phoneOf = new Map(customers.map((c) => [c.id, c.phone ?? null]))
      const nameOf = new Map(customers.map((c) => [c.id, c.name]))

      for (const r of rows) {
        const phone = r.holderPhone ?? (r.customerId != null ? (phoneOf.get(r.customerId) ?? null) : null)
        const decision = reminderDecision(
          {
            id: r.id,
            code: r.code,
            status: String(r.status),
            amount: Math.round(asNum(r.amount)),
            usedAmount: Math.round(asNum(r.usedAmount)),
            usedCount: Math.round(asNum(r.usedCount)),
            maxUses: Math.round(asNum(r.maxUses)),
            multiUse: r.multiUse === true,
            expiresAt: r.expiresAt ?? null,
            issuedAt: r.issuedAt,
            lastReminderAt: r.lastReminderAt ?? null,
            reminderCount: Math.round(asNum(r.reminderCount)),
            reminderOptOut: r.reminderOptOut === true,
            phone
          },
          settings.reminder,
          new Date(now)
        )
        if (filter.onlyDue && !decision.should) continue
        out.push({
          credit: shapeStoreCreditSafe(shapeStoreCredit(r)),
          holderName: r.customerName ?? (r.customerId != null ? (nameOf.get(r.customerId) ?? null) : null),
          phone,
          should: decision.should,
          kind: decision.kind,
          kindLabel: decision.kind === CreditReminderKind.NEAR_EXPIRY ? 'نزدیک به انقضا' : decision.kind ? 'اعتبار مصرف‌نشده' : null,
          reason: decision.reason,
          daysSinceIssue: decision.daysSinceIssue,
          daysToExpiry: decision.daysToExpiry
        })
        if (out.length >= take) break
      }

      if (rows.length < pageSize) break
      skip += rows.length
    }
    return { enabled: settings.reminder.enabled, rows: out }
  },

  /**
   * ثبت یک یادآوری در صف (§۱۴).
   *
   * ⚠️ هیچ API خارجی‌ای صدا زده نمی‌شود. متن نهایی (با Placeholder های پرشده)
   * ساخته و در `CreditReminderLog` ذخیره می‌شود و `NotificationSender` فعلی فقط
   * لاگش می‌کند. وقتی «پنل پیامک» اضافه شود، *فقط* همان پیاده‌سازی عوض می‌شود و
   * این تابع و ساختار داده دست‌نخورده می‌ماند.
   *
   * قواعد ضد‌اسپم واقعاً کار می‌کنند: اگر `reminderDecision` بگوید «نباید»،
   * ردیف با وضعیت SKIPPED/OPTED_OUT و دلیل فارسی ثبت می‌شود و شمارنده‌ی
   * یادآوری بالا نمی‌رود.
   */
  async queueReminder(input: { id: number; userId?: number | null; force?: boolean }): Promise<CreditReminderLogRow> {
    const settings = await readCreditSettings(prisma)
    const row = await loadCredit(prisma, input.id)
    const customer =
      row.customerId != null
        ? await prisma.customer.findUnique({ where: { id: row.customerId }, select: { name: true, phone: true } })
        : null
    const phone = row.holderPhone ?? customer?.phone ?? null
    const holderName = row.customerName ?? row.holderCompany ?? customer?.name ?? 'مشتری'
    const template = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.receiptTemplate } })
    let storeName = 'فروشگاه'
    try {
      storeName = String(JSON.parse(template?.value ?? '{}')?.storeName ?? storeName) || storeName
    } catch {
      /* پیش‌فرض می‌ماند */
    }

    const decision = reminderDecision(
      {
        id: row.id,
        code: row.code,
        status: String(row.status),
        amount: Math.round(asNum(row.amount)),
        usedAmount: Math.round(asNum(row.usedAmount)),
        usedCount: Math.round(asNum(row.usedCount)),
        maxUses: Math.round(asNum(row.maxUses)),
        multiUse: row.multiUse === true,
        expiresAt: row.expiresAt ?? null,
        issuedAt: row.issuedAt,
        lastReminderAt: row.lastReminderAt ?? null,
        reminderCount: Math.round(asNum(row.reminderCount)),
        reminderOptOut: row.reminderOptOut === true,
        phone
      },
      settings.reminder
    )

    const placeholders = {
      customer_name: holderName,
      credit_amount: money(asNum(row.amount)),
      remaining_amount: money(remainingOf({ amount: asNum(row.amount), usedAmount: asNum(row.usedAmount), status: String(row.status) })),
      expiry_date: row.expiresAtJalali ? faDigits(row.expiresAtJalali) : 'بدون انقضا',
      credit_code: row.code,
      store_name: storeName
    }
    const text = fillPlaceholders(settings.reminder.template, placeholders)
    const now = new Date()

    /**
     * 🔒 `force` فقط دلیل‌های **زمان‌بندی/سهمیه** را رد می‌کند.
     *
     * باگ بحرانی بازبینی پنجم: `input.force === true` بی‌قید همه‌ی دلیل‌ها را
     * دور می‌زد؛ یعنی با یک `invoke` می‌شد برای کد **باطل/مصرف‌شده/معلق/منقضی**
     * هم پیامک ساخت (و سهمیه را مصرف کرد). حالا فقط `MAX_COUNT`/`GAP`/`NOT_DUE`
     * /`DISABLED` قابل‌رد هستند — یعنی «دکمه‌ی دستی مدیر» می‌تواند ضداسپم را
     * رد کند، ولی هرگز «این کد اصلاً نباید پیام بگیرد» را.
     *
     * علاوه بر این، لایه‌ی IPC هم `force` را از رندرر نمی‌پذیرد (فقط `id`).
     */
    const allowed = decision.should || (input.force === true && isReminderForceable(decision.code))
    const status = row.reminderOptOut === true
      ? CreditReminderStatus.OPTED_OUT
      : allowed
        ? CreditReminderStatus.LOGGED
        : CreditReminderStatus.SKIPPED

    /**
     * ============ سهمیه‌ی یادآوری: «مصرف در لحظه‌ی *تحویل*، نه صف‌شدن» ============
     *
     * باگ قبلی: شمارنده (`reminderCount`) و `lastReminderAt` به‌محض «ثبت» بالا
     * می‌رفتند — حتی وقتی فرستنده می‌گفت ارسال انجام نشد. پیامدش دقیقاً همان
     * چیزی بود که کاربر گفته نباید بشود: با سقف ۳ یادآوری، سه شکستِ بی‌تقصیر
     * (قطعی اینترنت/سرویس‌دهنده) سهمیه را تمام می‌کرد و پنجره‌ی ۷ روزه هم از نو
     * شروع می‌شد ⇒ **یادآوری برای همیشه گم می‌شد**.
     *
     * قاعده‌ی جدید: سهمیه فقط وقتی مصرف می‌شود که فرستنده پیام را **پذیرفته**
     * باشد (`res.ok`). شکست، هیچ‌چیز را مصرف نمی‌کند: نه شمارنده، نه
     * `lastReminderAt` — پس همان یادآوری بی‌درنگ قابل تلاش دوباره است و
     * ضداسپم (فاصله‌ی روزها) جلویش را نمی‌گیرد.
     *
     * ⚠️ سقف «تعداد در پنجره» همچنان سقف است: سه پیام *پذیرفته‌شده*، نه سه تلاش.
     */
    let sentAt: Date | null = null
    let sendError = ''
    if (status === CreditReminderStatus.LOGGED && phone) {
      /**
       * اگر فرستنده «شناسه‌ی کد اعتبار» را بپذیرد، همان را می‌فرستیم تا ماژول
       * پیامک بتواند بعداً بگوید «این پیام واقعاً رفت یا نه» و در صورت نرفتن،
       * سهمیه را آزاد کند. فرستنده‌های ساده‌تر همان `send` را دارند.
       */
      const sender = notificationSender()
      const res = sender.sendReminder
        ? await sender.sendReminder({ phone, text, creditId: row.id })
        : await sender.send(phone, text)
      sentAt = res.ok ? now : null
      if (!res.ok) sendError = String(res.detail ?? '').trim() || 'فرستنده پیام را نپذیرفت.'
    }
    /** فقط تحویلِ پذیرفته‌شده سهمیه مصرف می‌کند. */
    const delivered = sentAt != null

    const log = await prisma.creditReminderLog.create({
      data: {
        creditId: row.id,
        code: row.code,
        kind: decision.kind ?? CreditReminderKind.UNUSED,
        status,
        phone,
        text,
        placeholdersJson: JSON.stringify(placeholders),
        reason:
          (input.force === true && !decision.should
            ? `${decision.reason} (با تایید دستی مدیر ثبت شد)`
            : decision.reason) + (sendError ? ` · ارسال انجام نشد: ${sendError}` : ''),
        plannedAt: now,
        sentAt,
        atJalali: toJalaliDate(now),
        atTime: toClock(now),
        userId: input.userId ?? null
      }
    })

    if (status === CreditReminderStatus.LOGGED) {
      /**
       * ⚠️ فاز دوم همان اصلاح سهمیه: فقط «تحویلِ پذیرفته‌شده» این سه ستون را
       * می‌نویسد. اگر فرستنده پیام را نپذیرفته باشد (`delivered === false`)،
       * هیچ‌چیز اینجا نوشته نمی‌شود — نه شمارنده، نه `lastReminderAt` — پس
       * ضداسپم جلوی تلاش دوباره را نمی‌گیرد و یادآوری گم نمی‌شود.
       */
      if (delivered) {
        await prisma.storeCredit.update({
          where: { id: row.id },
          data: {
            reminderCount: Math.max(0, Math.round(asNum(row.reminderCount))) + 1,
            lastReminderAt: now,
            lastReminderKind: decision.kind ?? CreditReminderKind.UNUSED
          }
        })
      }
    }

    await audit(prisma, {
      action: AuditAction.CREDIT_REMINDER_QUEUE,
      entity: 'StoreCredit',
      entityId: row.id,
      userId: input.userId ?? null,
      after: JSON.stringify({ status, kind: decision.kind, phone, reason: decision.reason }),
      note:
        `ثبت یادآوری اعتبار #${row.id} با وضعیت «${status}»` +
        // «هیچ پیامکی ارسال نشد» فقط وقتی راست است که واقعاً چیزی تحویل نشده
        // باشد؛ با فرستنده‌ی زنده این جمله نباید در سابقه بماند.
        (delivered
          ? ` · تحویل به فرستنده: ${notificationSender().name}`
          : phone
            ? ' · هیچ پیامکی ارسال نشد (فرستنده پیام را نپذیرفت)'
            : ' · هیچ پیامکی ارسال نشد (شماره‌ی تماسی ثبت نشده)') +
        ` · ${decision.reason}` +
        (sendError ? ` · ${sendError}` : '')
    })

    const names = await userNameMap([input.userId ?? null])
    return shapeReminderLog(log, names)
  },

  /** لاگ یادآوری‌های ثبت‌شده (§۱۴) — برای تب «یادآوری» و حسابرسی. */
  async reminderLogs(filter: { fromJalali?: string; toJalali?: string; status?: string; take?: number } = {}): Promise<CreditReminderLogRow[]> {
    const where: any = {}
    if (filter.fromJalali || filter.toJalali) {
      const from = filter.fromJalali ?? filter.toJalali ?? jalaliToday()
      const to = filter.toJalali ?? from
      where.plannedAt = { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) }
    }
    if (filter.status) where.status = filter.status
    const rows = await prisma.creditReminderLog.findMany({
      where,
      orderBy: CREDIT_ORDER_BY.reminderLogs,
      take: clampInt(filter.take ?? 500, 1, 5000, 500)
    })
    const names = await userNameMap(rows.map((r) => r.userId))
    return rows.map((r) => shapeReminderLog(r, names))
  },

  /** تنظیمات اعتبار خرید (§۲۲) — خواندنش اینجا هم هست تا UI یک کانال کمتر بزند. */
  async settings(): Promise<CreditSettings> {
    return readCreditSettings(prisma)
  },

  /**
   * ==========================================================================
   * «سهمیه را پس بده» — وقتی پیام در صف هرگز واقعاً نرفت.
   *
   * باگ واقعی که این را لازم کرد: سهمیه در لحظه‌ی *پذیرش* مصرف می‌شد، ولی پیام
   * می‌توانست بعداً (قطعی اینترنت، خطای قطعی، لغو مدیر) هرگز نرود. آن‌وقت
   * شمارنده سوخته بود و پنجره‌ی ضداسپم جلوی یادآوری بعدی را می‌گرفت ⇒ یادآوری
   * برای همیشه گم می‌شد.
   *
   * قواعد:
   *   • فقط ردیفی که «پذیرفته و هنوز پس‌داده‌نشده» است آزاد می‌شود؛ نوشتن
   *     **شرطی** است تا هوک تکراری، سهمیه‌ی اضافه نسازد.
   *   • `lastReminderAt` پاک می‌شود تا فاصله‌ی ضداسپم، یادآوری دوباره را
   *     نگیرد (پیام که نرفته، پس «اخیراً یادآوری شده» هم درست نیست).
   *   • فقط برای `CREDIT_REMINDER` معنا دارد.
   * ==========================================================================
   */
  async onReminderUndelivered(input: {
    creditId?: number | null
    phone?: string | null
    outboxId?: number | null
    outcome?: string
    detail?: string
  }): Promise<{ released: boolean }> {
    const creditId = input?.creditId == null ? null : Math.round(Number(input.creditId))
    if (!creditId || !Number.isFinite(creditId)) return { released: false }
    // «نامعلوم» = ممکن است رسیده باشد ⇒ دست نمی‌زنیم (تصمیم با آدم است).
    if (String(input?.outcome ?? '') === 'UNKNOWN') return { released: false }

    /** جدیدترین یادآوریِ پذیرفته‌شده‌ی این کد — همان که حالا معلوم شد نرفته. */
    const log = await prisma.creditReminderLog
      .findFirst({
        where: { creditId, status: CreditReminderStatus.LOGGED, sentAt: { not: null } },
        orderBy: { id: 'desc' }
      })
      .catch(() => null)
    if (!log) return { released: false }

    const claimed = await prisma.creditReminderLog.updateMany({
      where: { id: log.id, status: CreditReminderStatus.LOGGED },
      data: {
        status: CreditReminderStatus.UNDELIVERED,
        sentAt: null,
        reason:
          `${String(log.reason ?? '')} · ارسال واقعی انجام نشد` +
          (input?.detail ? ` (${String(input.detail).slice(0, 120)})` : '') +
          ' · سهمیه‌ی یادآوری آزاد شد'
      }
    })
    // اگر ردیف از قبل پس داده شده باشد، این عدد صفر است ⇒ سهمیه‌ی اضافه ساخته نمی‌شود.
    if (!claimed?.count) return { released: false }

    const credit = await prisma.storeCredit.findUnique({ where: { id: creditId } }).catch(() => null)
    if (credit) {
      const used = Math.max(0, Math.round(asNum(credit.reminderCount)))
      await prisma.storeCredit.update({
        where: { id: creditId },
        data: { reminderCount: Math.max(0, used - 1), lastReminderAt: null }
      })
    }

    await audit(prisma, {
      action: AuditAction.CREDIT_REMINDER_QUEUE,
      entity: 'StoreCredit',
      entityId: creditId,
      userId: null,
      after: JSON.stringify({ releasedFrom: log.id, outboxId: input?.outboxId ?? null, outcome: input?.outcome ?? null }),
      note:
        `یادآوری اعتبار #${creditId} پذیرفته شد ولی ارسال واقعی انجام نشد` +
        ` (${String(input?.outcome ?? '') || 'ناموفق'}) · سهمیه آزاد شد تا یادآوری دوباره ممکن بماند`
    })

    return { released: true }
  }
}
