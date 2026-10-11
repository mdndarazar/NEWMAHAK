import { stat } from 'node:fs/promises'
import { prisma, databaseFile } from '../db/client'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import { runBackup } from './BackupService'
import { AuditAction } from '@shared/enums'
import {
  isValidJalaliDate,
  toLatinDigits,
  jalaliStartOfDay,
  jalaliAddDays,
  jalaliToday,
  faDigits
} from '@shared/jalali'
import type { DbStats, MaintenancePreview, MaintenanceResult } from '@shared/types'
/**
 * بند ۸ · §۱۰ (جلسه ۳۱) — «سابقه‌ی محافظت‌شده».
 *
 * تعریفش یک جا است (`@shared/credit`) و دو نسخه دارد که از یک ثابت ساخته
 * می‌شوند: JS (`isProtectedAuditRow`) و SQL (همین دو تابع). این فایل فقط نسخه‌ی
 * SQL را مصرف می‌کند، پس هیچ‌وقت شرطِ «چه چیزی پاک نشود» دستی اینجا نوشته
 * نمی‌شود و عددِ پیش‌نمایش با واقعیتِ DELETE یکی می‌ماند.
 */
import { auditProtectedSql, auditPurgeableSql } from '@shared/credit'
import { assertManagerPassword } from './AuthService'

/**
 * ===========================================================================
 * «سبک‌سازی» — همیشه سریع بمان، حتی با میلیون‌ها فاکتور.
 *
 * سه لایه دارد و این فایل لایه‌ی سوم است:
 *
 *   لایه ۱ (ساختاری، در migration): ایندکس روی جدول‌های پرترافیک
 *     SaleInvoice(issuedAt) · SaleInvoice(issuedAtJalali, orderType) ·
 *     SaleInvoiceItem(variantId) · StockMovement(createdAt) ·
 *     AuditLog(entity, entityId) · Payment(methodId) · ...
 *     پس گزارش‌گیری بازه‌ای و پاک‌سازی، جدول را کامل اسکن نمی‌کند.
 *
 *   لایه ۲ (خواندن): همه‌ی کوئری‌های فهرست از قبل `take` دارند (سقف تعداد
 *     ردیف)، پس هیچ صفحه‌ای کل جدول را داخل حافظه نمی‌ریزد.
 *
 *   لایه ۳ (این فایل): «آرشیو و پاک‌سازی» — با یک حرکت، اول بکاپ گرفته می‌شود و
 *     بعد داده‌ی قدیمی‌تر از یک تاریخ مشخص از جدول‌های اصلی پاک می‌گردد و در
 *     پایان `VACUUM` اجرا می‌شود تا فضای دیسک *واقعاً* آزاد شود (SQLite بعد از
 *     DELETE فایل را کوچک نمی‌کند و صفحه‌های خالی را نگه می‌دارد).
 *
 * ⚠️ دفتر گردش انبار عمداً دست نمی‌خورد: StockMovement یک ledger append-only
 * و مدرک انبارگردانی است و در این مسیر نه حذف می‌شود و نه update. سبک‌سازی فقط
 * اسناد قدیمیِ خارج از مهلت نگهداری را هدف می‌گیرد.
 * ===========================================================================
 */

/** استثنای حذف فیزیکی فقط بعد از مهلت طولانیِ نگهداری مجاز است. */
export const MAINTENANCE_RETENTION_DAYS = 730

/** جدول‌هایی که وزن دیتابیس عملاً از آن‌ها می‌آید. */
const WEIGHT_TABLES = [
  'SaleInvoice',
  'SaleInvoiceItem',
  'Payment',
  'SaleReturn',
  'SaleReturnItem',
  'StockMovement',
  'AuditLog',
  'PurchaseInvoice',
  'PurchaseInvoiceItem',
  'CashSession',
  'Consolidation',
  'Shift',
  'Product',
  'ProductVariant',
  'Customer'
]

/**
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` این تابع **بی‌اثر** بود (هر دو طرف ternary
 * همان `Number(v)`). همین الگو در `MergeService` هم بود و آن‌جا هم رفع شد.
 *
 * چرا این‌جا مهم‌تر است: تنها مصرف‌کننده‌اش یک **`SUM("grandTotal")` روی کل
 * فاکتورهای قدیمی** است (پیش‌نمایش «آرشیو و پاک‌سازی»). بعد از مهاجرت بند
 * ۴-۲۸ الف این جمع `bigint` است و دقیقاً همان عددی است که واقعاً می‌تواند از
 * `Number.MAX_SAFE_INTEGER` رد شود.
 *
 * یعنی مدیر قبل از پاک کردن همیشگیِ داده، ممکن بود مبلغِ **غلط** ببیند و بر
 * اساس آن تصمیم بگیرد. حالا به‌جای عدد غلط، خطا می‌گیرد.
 */
const n = (v: unknown): number => {
  if (typeof v === 'bigint') {
    if (v > 9007199254740991n || v < -9007199254740991n)
      throw new BusinessError(
        `جمع مبالغ این بازه (${v.toString()} ریال) از محدوده‌ی امن نمایش بیرون است؛ ` +
          'بازه را کوچک‌تر کنید تا عددِ درست نشان داده شود.'
      )
    return Number(v)
  }
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

async function countRaw(sql: string, ...params: unknown[]): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(sql, ...params)
    return n(rows?.[0]?.c)
  } catch {
    return 0
  }
}

function normalizeCutoff(raw: unknown): string {
  const cutoff = toLatinDigits(String(raw ?? '')).trim()
  if (!isValidJalaliDate(cutoff))
    throw new BusinessError('تاریخ مرز پاک‌سازی معتبر نیست (قالب صحیح: ۱۴۰۵/۰۱/۰۱).')
  return cutoff
}

/** آخرین تاریخی که می‌تواند مرز حذف فیزیکی باشد. */
export function minimumMaintenanceCutoff(today = jalaliToday()): string {
  return jalaliAddDays(today, -MAINTENANCE_RETENTION_DAYS)
}

/**
 * گیت مستقل main برای حذف فیزیکی. UI و preview قابل دورزدن‌اند، پس archivePurge
 * هم باید همین شرط را دوباره اجرا کند.
 */
export function enforceMaintenanceCutoff(raw: unknown): string {
  const cutoff = normalizeCutoff(raw)
  const minimum = minimumMaintenanceCutoff()
  if (cutoff > minimum)
    throw new BusinessError(
      `حذف فیزیکی فقط برای داده‌های حداقل ${faDigits(MAINTENANCE_RETENTION_DAYS)} روز قدیمی مجاز است. ` +
        `تاریخ مرز باید ${faDigits(minimum)} یا قدیمی‌تر باشد؛ تاریخ واردشده ${faDigits(cutoff)} است.`
    )
  return cutoff
}

/**
 * ممیزی AUDIT-S135-01 (AUDIT-D64) — جدول‌هایی که archivePurge هرگز پاک نمی‌کند ولی به شیفت اشاره دارند.
 * شیفتی که مالک یکی از این سندهاست حذف نمی‌شود، وگرنه مالک رویداد مالی (برداشت صندوق، کارت‌به‌کارتِ در
 * انتظار، مصرف اعتبار، پاس چک) یتیم می‌شود و فیلتر شیفت آن را گم می‌کند.
 */
const SHIFT_RETAINED_REFS_SQL = [
  `id NOT IN (SELECT "shiftId" FROM "CashMovement" WHERE "shiftId" IS NOT NULL)`,
  `id NOT IN (SELECT "createdShiftId" FROM "Payment" WHERE "createdShiftId" IS NOT NULL)`,
  `id NOT IN (SELECT "clearedShiftId" FROM "Payment" WHERE "clearedShiftId" IS NOT NULL)`,
  `id NOT IN (SELECT h."clearedShiftId" FROM "PaymentChequeStatusHistory" h JOIN "Payment" p ON p.id = h."paymentId" WHERE h."clearedShiftId" IS NOT NULL)`,
  `id NOT IN (SELECT "shiftId" FROM "StoreCreditRedemption" WHERE "shiftId" IS NOT NULL)`,
  `id NOT IN (SELECT "shiftId" FROM "CardTransferRequest" WHERE "shiftId" IS NOT NULL)`,
  `id NOT IN (SELECT "paidShiftId" FROM "CardTransferRequest" WHERE "paidShiftId" IS NOT NULL)`
].join('\n             AND ')

/**
 * نشست ۱۷۸ (S178-D1، مشاهده‌ی P3 ردیف ۱۲۷ AUDIT-PROGRESS) — StockMovement.consolidationId با کلید خارجی
 * ON DELETE SET NULL به Consolidation وصل است و Prisma روی SQLite کلید خارجی را روشن اجرا می‌کند؛ پس DELETE
 * تجمیعی که حرکت انبار به آن وصل است، ستون ردیف‌های دفتر append-only را بی‌صدا NULL می‌کرد (یعنی update دفتر).
 * چنین تجمیعی حذف نمی‌شود (ردیف کوچک است؛ مدرک قطعی‌شدن حرکت انبار مهم‌تر از چند بایت است). همین شرط در
 * پیش‌نمایش، DELETE، unlink فاکتور و شرط شیفت به کار می‌رود تا پیش‌نمایش = عملیات بماند (D53/D59).
 */
const CONSOLIDATION_LEDGER_LINKED_SQL = `id IN (SELECT "consolidationId" FROM "StockMovement" WHERE "consolidationId" IS NOT NULL)`
const CONSOLIDATION_PURGEABLE_SQL = `"toDate" < ? AND NOT (${CONSOLIDATION_LEDGER_LINKED_SQL})`

/**
 * پیش‌نمایش پیش از حذف اجرا می‌شود، پس «سند باقی‌مانده» را صریح می‌گوید (همان مجموعه‌ای که DELETE
 * بعد از حذف فاکتور/صندوق/تجمیع قدیمی می‌بیند). پرداخت/برگشتِ فاکتور قدیمی با خود فاکتور پاک می‌شود.
 */
function purgeableShiftRefsSql(): string {
  const oldInv = `SELECT id FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`
  return `id NOT IN (SELECT "shiftId" FROM "SaleInvoice" WHERE "shiftId" IS NOT NULL AND "issuedAtJalali" >= ?)
             AND id NOT IN (SELECT "shiftId" FROM "CashSession" WHERE "shiftId" IS NOT NULL AND "toDate" >= ?)
             AND id NOT IN (SELECT "shiftId" FROM "SaleReturn" WHERE "shiftId" IS NOT NULL AND "invoiceId" NOT IN (${oldInv}))
             AND id NOT IN (SELECT "shiftId" FROM "Consolidation" WHERE "shiftId" IS NOT NULL AND ("toDate" >= ? OR ${CONSOLIDATION_LEDGER_LINKED_SQL}))
             AND id NOT IN (SELECT "createdShiftId" FROM "Payment" WHERE "createdShiftId" IS NOT NULL AND "invoiceId" NOT IN (${oldInv}))
             AND id NOT IN (SELECT "clearedShiftId" FROM "Payment" WHERE "clearedShiftId" IS NOT NULL AND "invoiceId" NOT IN (${oldInv}))
             AND id NOT IN (SELECT h."clearedShiftId" FROM "PaymentChequeStatusHistory" h JOIN "Payment" p ON p.id = h."paymentId" WHERE h."clearedShiftId" IS NOT NULL AND p."invoiceId" NOT IN (${oldInv}))
             AND id NOT IN (SELECT "shiftId" FROM "CashMovement" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "shiftId" FROM "StoreCreditRedemption" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "shiftId" FROM "CardTransferRequest" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "paidShiftId" FROM "CardTransferRequest" WHERE "paidShiftId" IS NOT NULL)`
}
function purgeableShiftRefParams(beforeJalali: string, cutoffDate: Date): unknown[] {
  return [beforeJalali, cutoffDate, beforeJalali, cutoffDate, beforeJalali, beforeJalali, beforeJalali]
}

export const maintenanceService = {
  /** وزن فعلی دیتابیس: حجم فایل، فضای قابل آزادسازی و تعداد ردیف هر جدول. */
  async stats(): Promise<DbStats> {
    const file = databaseFile()
    const size = await stat(file)
      .then((s) => s.size)
      .catch(() => 0)

    let freeBytes = 0
    try {
      const page = await prisma.$queryRawUnsafe<{ page_size: number }[]>('PRAGMA page_size')
      const free = await prisma.$queryRawUnsafe<{ freelist_count: number }[]>('PRAGMA freelist_count')
      freeBytes = n(page?.[0]?.page_size) * n(free?.[0]?.freelist_count)
    } catch {
      freeBytes = 0
    }

    const tables: { name: string; rows: number }[] = []
    for (const t of WEIGHT_TABLES)
      tables.push({ name: t, rows: await countRaw(`SELECT COUNT(*) AS c FROM "${t}"`) })

    return { file, size, freeBytes, tables }
  },

  /** دقیقاً چه چیزی با این تاریخ مرز پاک می‌شود (بدون هیچ تغییری در داده). */
  async preview(input: { beforeJalali?: string } = {}): Promise<MaintenancePreview> {
    const beforeJalali = enforceMaintenanceCutoff(input?.beforeJalali)
    const cutoffDate = jalaliStartOfDay(beforeJalali)
    const invFilter = `SELECT id FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`
    const purFilter = `SELECT id FROM "PurchaseInvoice" WHERE "issuedAtJalali" < ?`
    /**
     * بند ۸ · §۱۰ (جلسه ۳۱) — لاگ دو عدد دارد، نه یکی: «پاک می‌شود» و
     * «محافظت‌شده». همان شرطی که در `archivePurge` به DELETE می‌رود اینجا هم
     * شمرده می‌شود، وگرنه کاربر عددی می‌بیند که هیچ‌وقت محقق نمی‌شود.
     */
    const purgeable = auditPurgeableSql()
    const protectedRows = auditProtectedSql()

    const [
      saleInvoices,
      saleItems,
      saleReturns,
      purchaseInvoices,
      stockMovements,
      auditLogs,
      auditLogsProtected,
      cashSessions,
      consolidations,
      consolidationsRetained,
      shifts,
      totals
    ] = await Promise.all([
      countRaw(`SELECT COUNT(*) AS c FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`, beforeJalali),
      countRaw(`SELECT COUNT(*) AS c FROM "SaleInvoiceItem" WHERE "invoiceId" IN (${invFilter})`, beforeJalali),
      countRaw(`SELECT COUNT(*) AS c FROM "SaleReturn" WHERE "invoiceId" IN (${invFilter})`, beforeJalali),
      countRaw(`SELECT COUNT(*) AS c FROM "PurchaseInvoice" WHERE "issuedAtJalali" < ?`, beforeJalali),
      countRaw(`SELECT COUNT(*) AS c FROM "StockMovement" WHERE "createdAt" < ?`, cutoffDate),
      // فقط ردیف‌هایی که *واقعاً* پاک می‌شوند
      countRaw(`SELECT COUNT(*) AS c FROM "AuditLog" WHERE "at" < ? AND ${purgeable.sql}`, cutoffDate, ...purgeable.params),
      // و ردیف‌هایی که به‌خاطر §۱۰ می‌مانند (کاربر بداند سابقه‌ی اعتبار دست‌نخورده ماند)
      countRaw(`SELECT COUNT(*) AS c FROM "AuditLog" WHERE "at" < ? AND ${protectedRows.sql}`, cutoffDate, ...protectedRows.params),
      countRaw(`SELECT COUNT(*) AS c FROM "CashSession" WHERE "toDate" < ?`, cutoffDate),
      // S178-D1 — فقط تجمیعی که واقعاً حذف می‌شود؛ تجمیع وصل به دفتر گردش انبار جدا شمرده و حفظ می‌شود
      countRaw(`SELECT COUNT(*) AS c FROM "Consolidation" WHERE ${CONSOLIDATION_PURGEABLE_SQL}`, cutoffDate),
      countRaw(`SELECT COUNT(*) AS c FROM "Consolidation" WHERE "toDate" < ? AND ${CONSOLIDATION_LEDGER_LINKED_SQL}`, cutoffDate),
      countRaw(`SELECT COUNT(*) AS c FROM "Shift" WHERE "dayJalali" <> '' AND "dayJalali" < ? AND ${purgeableShiftRefsSql()}`, beforeJalali, ...purgeableShiftRefParams(beforeJalali, cutoffDate)),
      prisma.$queryRawUnsafe<{ g: number | null }[]>(
        `SELECT SUM("grandTotal") AS g FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`,
        beforeJalali
      ).catch(() => [{ g: 0 }])
    ])

    return {
      beforeJalali,
      retentionDays: MAINTENANCE_RETENTION_DAYS,
      minimumCutoffJalali: minimumMaintenanceCutoff(),
      saleInvoices,
      saleItems,
      saleReturns,
      purchaseInvoices,
      stockMovements,
      auditLogs,
      auditLogsProtected,
      cashSessions,
      consolidations,
      consolidationsRetained,
      shifts,
      grandTotal: n(totals?.[0]?.g)
    }
  },

  /**
   * «آرشیو و پاک‌سازی»: بکاپ + حذف داده‌ی خارج از مهلت نگهداری + VACUUM.
   *
   * ترتیب حذف از برگ به ریشه است تا هیچ کلید خارجی معلق نماند، و همه‌ی حذف‌ها در
   * یک تراکنش انجام می‌شود (نصفه‌کاره نمی‌ماند). VACUUM بعد از تراکنش اجرا
   * می‌گردد، چون SQLite اجازه‌ی VACUUM داخل تراکنش را نمی‌دهد. دفتر
   * `StockMovement` در تمام حالت‌ها append-only باقی می‌ماند.
   */
  async archivePurge(input: {
    beforeJalali?: string
    /** قبل از حذف، بکاپ گرفته شود؟ (پیش‌فرض: بله) */
    backup?: boolean
    /**
     * ورودی legacy برای سازگاری IPC؛ عمداً نادیده گرفته می‌شود چون دفتر انبار
     * append-only است و هیچ StockMovementی در این مسیر حذف نمی‌شود.
     */
    purgeMovements?: boolean
    /** لاگ عملیات قدیمی هم پاک شود؟ (پیش‌فرض: بله) */
    purgeAudit?: boolean
    /** آرشیو فیزیکی اسناد مالی همیشه به تایید مدیر نیاز دارد. */
    managerPassword?: string | null
    /** فشرده‌سازی فایل بعد از حذف (پیش‌فرض: بله) */
    vacuum?: boolean
    userId?: number | null
  }): Promise<MaintenanceResult> {
    const beforeJalali = enforceMaintenanceCutoff(input?.beforeJalali)
    await assertManagerPassword(input?.managerPassword, 'آرشیو و پاک‌سازی داده‌های قدیمی')
    const before = await this.preview({ beforeJalali })
    const file = databaseFile()
    const sizeBefore = await stat(file)
      .then((s) => s.size)
      .catch(() => 0)

    if (
      !before.saleInvoices &&
      !before.purchaseInvoices &&
      !before.auditLogs &&
      !before.cashSessions &&
      !before.consolidations &&
      !before.shifts
    )
      throw new BusinessError(
        `قبل از ${faDigits(beforeJalali)} داده‌ای برای پاک‌سازی وجود ندارد؛ چیزی حذف نشد.`
      )

    /**
     * حذف لاگ اختیاری است، اما تایید مدیر برای کل عملیات قبلاً گرفته شده است.
     * اگر purgeAudit خاموش باشد، هیچ AuditLog قدیمی حذف نمی‌شود.
     */
    const auditPurged = input?.purgeAudit !== false
    const warnings: string[] = []
    if (before.stockMovements > 0)
      warnings.push(
        `دفتر گردش انبار شامل ${faDigits(before.stockMovements)} ردیف قدیمی است؛ این دفتر append-only است و هیچ ردیفی حذف نمی‌شود.`
      )
    if (before.consolidationsRetained > 0)
      warnings.push(
        `${faDigits(before.consolidationsRetained)} تجمیع قدیمی حفظ شد چون حرکت‌های دفتر گردش انبار به آن وصل است (دفتر انبار append-only است و پیوندش پاک نمی‌شود).`
      )
    // ۱) بکاپ (پیش‌فرض روشن) — آرشیو قبل از پاک‌سازی
    let backupPath: string | null = null
    if (input?.backup !== false) {
      backupPath = await runInternalBackup()
    }

    const cutoffDate = jalaliStartOfDay(beforeJalali)
    const invFilter = `SELECT id FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`
    const purFilter = `SELECT id FROM "PurchaseInvoice" WHERE "issuedAtJalali" < ?`

    // ۲) حذف، از برگ به ریشه، در یک تراکنش
    await prisma.$transaction(
      async (tx) => {
        const run = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params)

        // برگشت‌های فروشِ فاکتورهای قدیمی
        await run(
          `DELETE FROM "SaleReturnItem" WHERE "returnId" IN (SELECT id FROM "SaleReturn" WHERE "invoiceId" IN (${invFilter}))`,
          beforeJalali
        )
        await run(`DELETE FROM "SaleReturn" WHERE "invoiceId" IN (${invFilter})`, beforeJalali)
        await run(`DELETE FROM "Payment" WHERE "invoiceId" IN (${invFilter})`, beforeJalali)
        await run(`DELETE FROM "SaleInvoiceItem" WHERE "invoiceId" IN (${invFilter})`, beforeJalali)
        await run(`DELETE FROM "SaleInvoice" WHERE "issuedAtJalali" < ?`, beforeJalali)

        // فاکتورهای خرید قدیمی
        await run(`DELETE FROM "PurchaseInvoiceItem" WHERE "invoiceId" IN (${purFilter})`, beforeJalali)
        await run(`DELETE FROM "PurchaseInvoice" WHERE "issuedAtJalali" < ?`, beforeJalali)

        // صندوق و تجمیع قدیمی
        await run(`DELETE FROM "CashSession" WHERE "toDate" < ?`, cutoffDate)
        // S178-D1 — تجمیعِ وصل به دفتر گردش انبار حذف نمی‌شود (وگرنه ON DELETE SET NULL ستون consolidationId دفتر را NULL می‌کند)
        await run(
          `UPDATE "SaleInvoice" SET "consolidationId" = NULL WHERE "consolidationId" IN (SELECT id FROM "Consolidation" WHERE ${CONSOLIDATION_PURGEABLE_SQL})`,
          cutoffDate
        )
        await run(`DELETE FROM "Consolidation" WHERE ${CONSOLIDATION_PURGEABLE_SQL}`, cutoffDate)

        // شیفت‌های قدیمی که دیگر هیچ سندی به آن‌ها وصل نیست
        // ممیزی AUDIT-S135-01 — همان شرط پیش‌نمایش (purgeableShiftSql)؛ شیفتی که هنوز مالک سند
        // باقی‌مانده است (پرداخت، گردش صندوق، کارت‌به‌کارت، مصرف اعتبار، …) حذف نمی‌شود.
        await run(
          `DELETE FROM "Shift" WHERE "dayJalali" <> '' AND "dayJalali" < ?
             AND id NOT IN (SELECT "shiftId" FROM "SaleInvoice" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "shiftId" FROM "CashSession" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "shiftId" FROM "SaleReturn" WHERE "shiftId" IS NOT NULL)
             AND id NOT IN (SELECT "shiftId" FROM "Consolidation" WHERE "shiftId" IS NOT NULL)
             AND ${SHIFT_RETAINED_REFS_SQL}`,
          beforeJalali
        )

        /**
         * لاگ عملیات قدیمی (اختیاری + رمز مدیر + §۱۰).
         *
         * ⚠️ این خط تا جلسه ۳۰ خام بود (`DELETE FROM "AuditLog" WHERE "at" < ?`)
         * و می‌توانست کل تاریخ «مدیریت اعتبار خرید» را بی‌صدا پاک کند — یعنی
         * Timeline صفحه‌ی جزئیات، که تنها سند مالی آن ماژول است، خالی می‌شد.
         * حالا شرط «حق پاک‌شدن» از `auditPurgeableSql` می‌آید (همان تعریفی که
         * پیش‌نمایش شمرده است).
         */
        if (auditPurged) {
          const p = auditPurgeableSql()
          await run(`DELETE FROM "AuditLog" WHERE "at" < ? AND ${p.sql}`, cutoffDate, ...p.params)
        }
      },
      { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 }
    )

    // ۳) آزادسازی واقعی فضای دیسک
    let vacuumed = false
    if (input?.vacuum !== false) {
      try {
        await prisma.$executeRawUnsafe('VACUUM')
        vacuumed = true
      } catch (e) {
        console.error('[maintenance] vacuum failed', e)
      }
    }

    const sizeAfter = await stat(file)
      .then((s) => s.size)
      .catch(() => sizeBefore)

    const result: MaintenanceResult = {
      ...before,
      // اگر گیت رمز رد شد، هیچ ردیف لاگی پاک نشده است — عدد خروجی هم باید همان را بگوید
      auditLogs: auditPurged ? before.auditLogs : 0,
      backupPath,
      sizeBefore,
      sizeAfter,
      vacuumed,
      auditPurged,
      warnings
    }
    await audit(prisma, {
      action: AuditAction.DATA_ARCHIVE_PURGE,
      entity: 'Database',
      userId: input?.userId ?? null,
      after: JSON.stringify(result),
      note:
        `آرشیو و پاک‌سازی داده‌ی قدیمی‌تر از ${beforeJalali}` +
        ` · مهلت نگهداری ${faDigits(MAINTENANCE_RETENTION_DAYS)} روز` +
        ` · دفتر گردش انبار append-only و دست‌نخورده ماند` +
        (before.consolidationsRetained
          ? ` · ${faDigits(before.consolidationsRetained)} تجمیع وصل به دفتر انبار حفظ شد`
          : '') +
        (before.auditLogsProtected
          ? ` · ${faDigits(before.auditLogsProtected)} ردیف سابقه‌ی محافظت‌شده (اعتبار خرید) پاک نشد`
          : '') +
        (auditPurged ? '' : ' · پاک‌سازی لاگ عملیات بدون تایید مدیر رد شد')
    })
    return result
  },

  /** فشرده‌سازی فایل دیتابیس بدون حذف هیچ داده‌ای. */
  async vacuum() {
    const file = databaseFile()
    const sizeBefore = await stat(file)
      .then((s) => s.size)
      .catch(() => 0)
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => null)
    await prisma.$executeRawUnsafe('VACUUM')
    const sizeAfter = await stat(file)
      .then((s) => s.size)
      .catch(() => sizeBefore)
    return { sizeBefore, sizeAfter }
  }
}

/** بکاپ داخلی قبل از پاک‌سازی (همان پوشه‌ی بکاپ‌های خودکار). */
async function runInternalBackup(): Promise<string | null> {
  try {
    return await runBackup()
  } catch (e) {
    console.error('[maintenance] pre-purge backup failed', e)
    throw new BusinessError(
      'تهیه‌ی بکاپ قبل از پاک‌سازی ناموفق بود، پس برای امنیت داده هیچ چیزی پاک نشد. ' +
        'فضای دیسک را بررسی کنید یا از تیک «قبل از پاک‌سازی بکاپ بگیر» صرف‌نظر کنید.'
    )
  }
}
