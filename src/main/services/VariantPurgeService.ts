import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { audit } from './AuditService'
import { assertPanelPassword } from './AuthService'
import { productApprovalNote, variantIdChunksOf } from './ProductService'
import { BusinessError } from '../errors'
import { faDigits, toJalaliDate } from '@shared/jalali'
import { PANEL_KEYS } from '@shared/panels'
import type { VariantPurgePreview, VariantPurgeResult } from '@shared/types'

/**
 * ===========================================================================
 * «حذف همیشگی» کالا از سطل آشغال (مورد ۸)
 *
 * تا امروز حذف کالا فقط نرم بود (`isActive = false`) و راهی برای پاک کردن
 * واقعی وجود نداشت. این سرویس رکورد `ProductVariant` را *واقعاً* از دیتابیس
 * پاک می‌کند، ولی سابقه‌ی مالی را دست نمی‌زند.
 *
 * ---------------------------------------------------------------------------
 * مشکل کلید خارجی و راه‌حلی که انتخاب شد
 * ---------------------------------------------------------------------------
 * سه جدول به `ProductVariant` کلید خارجی دارند و رکوردهایشان باید بمانند:
 *   SaleInvoiceItem · PurchaseInvoiceItem · SaleReturnItem
 * (جدول چهارم، StockMovement، «دفتر گردش خودِ همان کالا» است و با کالا پاک
 *  می‌شود — همان چیزی که در متن هشدار به کاربر گفته می‌شود.)
 *
 * سه راه داشتیم:
 *   ۱) nullable کردن `variantId` در آن سه جدول → تغییر تایپ در چند ده نقطه‌ی
 *      کد و ریسک زیاد.
 *   ۲) پاک کردن ردیف‌های سابقه → جمع فاکتورهای گذشته خراب می‌شد. ❌
 *   ۳) برداشتن *فقط همان کلید خارجی* در سطح دیتابیس و نگه‌داشتن نام و کد کالا
 *      داخل خود ردیف فاکتور (ستون‌های `variantName` / `variantCode`). ✅
 *
 * راه سوم انتخاب شد چون کد برنامه از قبل هم برای «کالای حذف‌شده از سیستم»
 * fallback داشت (گزارش‌ها موجودی و نام را جدا و با vmap می‌خوانند، نه با join
 * اجباری)، پس با یک ردیفِ بی‌کالا زمین نمی‌خورد — و حالا نام و کد را هم از
 * snapshot همان ردیف نشان می‌دهد.
 *
 * برداشتن کلید خارجی در SQLite یعنی بازسازی جدول. ترتیب زیر عمداً طوری چیده
 * شده که *حتی با فعال بودن* `PRAGMA foreign_keys` هم هیچ‌وقت نقض کلید خارجی
 * رخ ندهد (پس به خاموش کردن pragma — که داخل تراکنش بی‌اثر است — نیازی نیست):
 *   ۱. جدول جدید SaleInvoiceItem ساخته و پر می‌شود (بدون FK کالا).
 *   ۲. جدول جدید SaleReturnItem ساخته و پر می‌شود؛ FK کالایش برداشته می‌شود
 *      ولی FK اش به «جدول جدید SaleInvoiceItem» وصل است (پس یکپارچگی
 *      saleItemId حفظ می‌شود).
 *   ۳. جدول قدیمی SaleReturnItem حذف می‌شود (هیچ جدولی به آن اشاره ندارد).
 *   ۴. جدول قدیمی SaleInvoiceItem حذف می‌شود (فرزندش در قدم ۳ رفته است).
 *   ۵. نام جدول‌های جدید به نام اصلی برمی‌گردد؛ SQLite خودش ارجاع FK جدول
 *      برگشت را هم به نام جدید اصلاح می‌کند.
 *   ۶. ایندکس‌ها بازسازی و در پایان `PRAGMA foreign_key_check` گرفته می‌شود.
 * همه‌ی این‌ها داخل *یک تراکنش* اجرا می‌شود: یا کامل انجام می‌شود یا هیچ.
 *
 * این بازسازی فقط *یک بار* (اولین حذف همیشگی) لازم است و بعد از آن هیچ کاری
 * نمی‌کند. اگر ترجیح می‌دهید دستی و از قبل انجامش دهید، همان SQL در
 * prisma/manual/2026_variant_purge_drop_variant_fk.sql هست.
 *
 * ⚠️ نکته‌ی نگهداری: از این به بعد schema.prisma (که رابطه را اعلام می‌کند) با
 * دیتابیس (که کلید خارجی‌اش را ندارد) در همین یک مورد اختلاف دارد. برای Prisma
 * Client هیچ اثری ندارد (روی SQLite رابطه‌ها با کوئری جدا خوانده می‌شوند، نه
 * JOIN اجباری)، فقط اگر روزی `prisma migrate dev` بزنید، Prisma می‌خواهد این
 * کلیدها را برگرداند؛ در آن حالت همان migration را نگه ندارید.
 * ===========================================================================
 */

type Tx = Prisma.TransactionClient

/** حذف فیزیکی فقط برای سبک‌سازی پس از دو سال مجاز است، نه برای پاک‌کردن مدرک. */
export const VARIANT_PURGE_RETENTION_DAYS = 730
const VARIANT_PURGE_RETENTION_MS = VARIANT_PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000

/** جدول‌هایی که کلید خارجی‌شان به ProductVariant باید برداشته شود. */
const SALE_ITEM = 'SaleInvoiceItem'
const RETURN_ITEM = 'SaleReturnItem'
const PURCHASE_ITEM = 'PurchaseInvoiceItem'

async function tableSql(tx: Tx, name: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ sql: string | null }[]>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`
  )
  const sql = rows?.[0]?.sql
  if (!sql) throw new BusinessError(`ساختار جدول «${name}» خوانده نشد؛ حذف همیشگی انجام نشد.`)
  return sql
}

async function indexDdl(tx: Tx, name: string): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ sql: string | null }[]>(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${name}' AND sql IS NOT NULL`
  )
  return (rows ?? []).map((r) => String(r.sql)).filter(Boolean)
}

async function columnList(tx: Tx, name: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${name}")`)
  const cols = (rows ?? []).map((r) => `"${r.name}"`)
  if (!cols.length) throw new BusinessError(`ستون‌های جدول «${name}» خوانده نشد؛ حذف همیشگی انجام نشد.`)
  return cols.join(', ')
}

/**
 * حذف بند کلید خارجیِ مربوط به ProductVariant از متن DDL یک جدول.
 * فقط همان یک بند برداشته می‌شود؛ بقیه‌ی کلیدها (فاکتور، برگشت، انبار) و همه‌ی
 * ستون‌ها عیناً سر جای خودشان می‌مانند.
 */
const VARIANT_FK_RE =
  /,\s*CONSTRAINT\s+"[^"]*"\s+FOREIGN\s+KEY\s*\([^)]*\)\s+REFERENCES\s+"ProductVariant"\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT))*/gi

function stripVariantConstraint(sql: string): string {
  return sql.replace(VARIANT_FK_RE, '')
}

/** تغییر نام جدول در متن DDL (برای ساختن نسخه‌ی موقت). */
function renameInDdl(sql: string, from: string, to: string): string {
  return sql.replace(new RegExp(`CREATE TABLE\\s+"${from}"`, 'i'), `CREATE TABLE "${to}"`)
}

const stillHasVariantFk = (sql: string): boolean => /REFERENCES\s+"ProductVariant"/i.test(sql)

/**
 * برداشتن کلید خارجی ProductVariant از جدول‌های سابقه (یک بار برای همیشه).
 * خروجی: آیا ساختار دیتابیس عوض شد یا از قبل آماده بود.
 */
async function dropVariantForeignKeys(tx: Tx): Promise<boolean> {
  const [saleSql, returnSql, purchaseSql] = await Promise.all([
    tableSql(tx, SALE_ITEM),
    tableSql(tx, RETURN_ITEM),
    tableSql(tx, PURCHASE_ITEM)
  ])
  const needSale = stillHasVariantFk(saleSql)
  const needReturn = stillHasVariantFk(returnSql)
  const needPurchase = stillHasVariantFk(purchaseSql)
  if (!needSale && !needReturn && !needPurchase) return false

  // ---- جدول فاکتور خرید: مستقل است، پس بازسازی ساده ----
  if (needPurchase) {
    const cols = await columnList(tx, PURCHASE_ITEM)
    const idx = await indexDdl(tx, PURCHASE_ITEM)
    const tmp = `${PURCHASE_ITEM}__new`
    await tx.$executeRawUnsafe(renameInDdl(stripVariantConstraint(purchaseSql), PURCHASE_ITEM, tmp))
    await tx.$executeRawUnsafe(`INSERT INTO "${tmp}" (${cols}) SELECT ${cols} FROM "${PURCHASE_ITEM}"`)
    await tx.$executeRawUnsafe(`DROP TABLE "${PURCHASE_ITEM}"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "${tmp}" RENAME TO "${PURCHASE_ITEM}"`)
    for (const ddl of idx) await tx.$executeRawUnsafe(ddl)
  }

  // ---- جدول ردیف فروش و ردیف برگشت: زوجی و با ترتیب امن ----
  if (needSale || needReturn) {
    const saleCols = await columnList(tx, SALE_ITEM)
    const returnCols = await columnList(tx, RETURN_ITEM)
    const saleIdx = await indexDdl(tx, SALE_ITEM)
    const returnIdx = await indexDdl(tx, RETURN_ITEM)
    const saleTmp = `${SALE_ITEM}__new`
    const returnTmp = `${RETURN_ITEM}__new`

    await tx.$executeRawUnsafe(renameInDdl(stripVariantConstraint(saleSql), SALE_ITEM, saleTmp))
    await tx.$executeRawUnsafe(`INSERT INTO "${saleTmp}" (${saleCols}) SELECT ${saleCols} FROM "${SALE_ITEM}"`)

    // FK ردیف برگشت موقتاً به جدول موقت فروش وصل می‌شود تا با تغییر نام،
    // خود SQLite ارجاع را به نام نهایی اصلاح کند.
    const returnDdl = renameInDdl(stripVariantConstraint(returnSql), RETURN_ITEM, returnTmp).replace(
      new RegExp(`REFERENCES\\s+"${SALE_ITEM}"`, 'gi'),
      `REFERENCES "${saleTmp}"`
    )
    await tx.$executeRawUnsafe(returnDdl)
    await tx.$executeRawUnsafe(`INSERT INTO "${returnTmp}" (${returnCols}) SELECT ${returnCols} FROM "${RETURN_ITEM}"`)

    await tx.$executeRawUnsafe(`DROP TABLE "${RETURN_ITEM}"`)
    await tx.$executeRawUnsafe(`DROP TABLE "${SALE_ITEM}"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "${saleTmp}" RENAME TO "${SALE_ITEM}"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "${returnTmp}" RENAME TO "${RETURN_ITEM}"`)
    for (const ddl of [...saleIdx, ...returnIdx]) await tx.$executeRawUnsafe(ddl)
  }

  // ---- کنترل نهایی: هیچ ارجاع شکسته‌ای نمانده باشد ----
  const broken = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check')
  if (Array.isArray(broken) && broken.length)
    throw new BusinessError(
      'بازسازی ساختار جدول‌های سابقه نیمه‌کاره ماند و لغو شد (هیچ تغییری ذخیره نشد). ' +
        'یک بکاپ بگیرید و دوباره تلاش کنید.'
    )
  return true
}

/** نام نمایشی یک واریانت. */
const titleOf = (v: { size?: string | null; color?: string | null; product?: { name?: string } | null }): string =>
  `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`

export const variantPurgeService = {
  /**
   * پیش‌نمایش: چه چیزی با حذف همیشگی از بین می‌رود و چه چیزی می‌ماند.
   * هیچ داده‌ای را تغییر نمی‌دهد.
   */
  async preview(input: { variantIds?: number[] } = {}): Promise<VariantPurgePreview> {
    const ids = (input?.variantIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length)
      return {
        lines: [],
        historyRows: 0,
        movements: 0,
        canPurge: false,
        blockers: ['برای حذف همیشگی، حداقل یک کالا را انتخاب کنید.'],
        notices: []
      }
    // نشست ۱۷۷ · S176-D3 — دسته‌های ۵۰۰تایی (سقف IN ۵۰۰)؛ UI سطل آشغال امروز حداکثر ۳۰۰ ردیف دارد.
    const variants: any[] = []
    for (const chunk of variantIdChunksOf(ids))
      variants.push(
        ...(await prisma.productVariant.findMany({
          where: { id: { in: chunk } },
          include: { product: { select: { name: true } } }
        }))
      )
    // جلسه ۴۹: تایپ صریح، تا ردیف‌ها `never` استنتاج نشوند
    const lines: {
      variantId: number
      code: string
      name: string
      stock: number
      saleItems: number
      purchaseItems: number
      returnItems: number
      movements: number
      blockedReason: string | null
    }[] = []
    /**
     * نشست ۱۷۸ (S178-D4، مشاهده‌ی ردیف ۱۲۶) — پیش‌نمایش = عملیات (D53/D59): همان سه شرطی که purge رد می‌کند
     * (کالای فعال، مهلت ۷۳۰ روز سطل آشغال، حرکت انبار) برای هر ردیف با پیام فارسی گفته می‌شود و canPurge
     * فقط وقتی true است که purge واقعاً انجام شدنی باشد (همه یا هیچ).
     */
    const cutoff = Date.now() - VARIANT_PURGE_RETENTION_MS
    let recentCount = 0
    for (const v of variants) {
      const [saleItems, purchaseItems, returnItems, movements] = await Promise.all([
        prisma.saleInvoiceItem.count({ where: { variantId: v.id } }),
        prisma.purchaseInvoiceItem.count({ where: { variantId: v.id } }),
        prisma.saleReturnItem.count({ where: { variantId: v.id } }),
        prisma.stockMovement.count({ where: { variantId: v.id } })
      ])
      const deletedAt = v.deletedAt instanceof Date ? v.deletedAt.getTime() : Number(new Date(v.deletedAt ?? 0))
      const tooRecent = !v.isActive && (!deletedAt || deletedAt > cutoff)
      if (tooRecent) recentCount++
      const blockedReason = v.isActive
        ? 'هنوز در فهرست کالاهای فعال است؛ اول باید حذف (نرم) شود.'
        : tooRecent
          ? deletedAt
            ? `هنوز ${faDigits(VARIANT_PURGE_RETENTION_DAYS)} روز کامل در سطل آشغال نمانده است (از ${faDigits(toJalaliDate(new Date(deletedAt + VARIANT_PURGE_RETENTION_MS)))} قابل حذف همیشگی است).`
            : `تاریخ حذف (نرم) ندارد؛ مهلت ${faDigits(VARIANT_PURGE_RETENTION_DAYS)} روز سطل آشغال از امروز قابل سنجش نیست.`
          : movements > 0
            ? `${faDigits(movements)} حرکت انبار دارد؛ دفتر گردش انبار append-only است و حذف همیشگی انجام نمی‌شود.`
            : null
      lines.push({
        variantId: v.id,
        code: v.code,
        name: titleOf(v),
        stock: v.stock,
        saleItems,
        purchaseItems,
        returnItems,
        movements,
        blockedReason
      })
    }
    const activeCount = variants.filter((v) => v.isActive).length
    const movementCount = lines.filter((l) => l.movements > 0).length
    const blockers: string[] = []
    if (!variants.length) blockers.push('این کالاها پیدا نشدند؛ فهرست سطل آشغال را تازه کنید.')
    if (activeCount) blockers.push(`${faDigits(activeCount)} کالا هنوز در فهرست کالاهای فعال است؛ حذف همیشگی فقط برای کالاهای داخل سطل آشغال انجام می‌شود.`)
    if (recentCount)
      blockers.push(
        `${faDigits(recentCount)} کالا هنوز ${faDigits(VARIANT_PURGE_RETENTION_DAYS)} روز کامل در سطل آشغال نمانده است؛ تا پایان این مهلت سابقه‌ی کالا باید قابل بازگردانی بماند.`
      )
    if (movementCount)
      blockers.push(`${faDigits(movementCount)} کالا حرکت انبار دارد؛ دفتر گردش انبار پاک‌شدنی نیست، پس حذف همیشگی انجام نمی‌شود.`)
    const missing = [...new Set(ids)].length - variants.length
    const notices = missing > 0 ? [`${faDigits(missing)} کالای انتخاب‌شده پیدا نشد (احتمالاً قبلاً پاک شده) و در حذف شرکت نمی‌کند.`] : []
    return {
      lines,
      historyRows: lines.reduce((s, l) => s + l.saleItems + l.purchaseItems + l.returnItems, 0),
      movements: lines.reduce((s, l) => s + l.movements, 0),
      canPurge: blockers.length === 0,
      blockers,
      notices
    }
  },

  /**
   * حذف همیشگی و غیرقابل‌بازگشت.
   * فقط کالای غیرفعالِ قدیمی‌تر از مهلت نگهداری پاک می‌شود؛ دفتر گردش انبار
   * append-only است و وجود حتی یک حرکت، حذف را متوقف می‌کند.
   */
  async purge(
    input: {
      variantIds?: number[]
      /** actor؛ در IPC از نشست باز main بازنویسی می‌شود، نه از renderer (نشست ۱۴۶). */
      userId?: number | null
      /** نشست ۱۴۶ · بند ۴-۳۹ — «حذف دائمی کالا»: رمز مدیر یا رمز دوم پنل کالاها. */
      managerPassword?: string | null
    } = {}
  ): Promise<VariantPurgeResult> {
    const ids = (input?.variantIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) throw new BusinessError('برای حذف همیشگی، حداقل یک کالا را انتخاب کنید.')

    // نشست ۱۷۷ · S176-D3 — دسته‌های ۵۰۰تایی (سقف IN ۵۰۰).
    const variants: any[] = []
    for (const chunk of variantIdChunksOf(ids))
      variants.push(
        ...(await prisma.productVariant.findMany({
          where: { id: { in: chunk } },
          include: { product: { select: { id: true, name: true } } }
        }))
      )
    if (!variants.length) throw new BusinessError('این کالاها پیدا نشدند؛ فهرست سطل آشغال را تازه کنید.')
    const active = variants.filter((v) => v.isActive)
    if (active.length)
      throw new BusinessError(
        `«${titleOf(active[0])}» هنوز در فهرست کالاهای فعال است. حذف همیشگی فقط برای کالاهای داخل سطل آشغال کار می‌کند: ` +
          'اول کالا را حذف (نرم) کنید، بعد از تب سطل آشغال برای همیشه پاکش کنید.'
      )

    const targets = variants.map((v) => v.id)
    const cutoff = Date.now() - VARIANT_PURGE_RETENTION_MS
    const tooRecent = variants.filter((v) => {
      const deletedAt = v.deletedAt instanceof Date ? v.deletedAt.getTime() : Number(new Date(v.deletedAt ?? 0))
      return !deletedAt || deletedAt > cutoff
    })
    if (tooRecent.length)
      throw new BusinessError(
        `حذف همیشگی انجام نشد: ${tooRecent.length} کالا هنوز ${faDigits(VARIANT_PURGE_RETENTION_DAYS)} روز کامل در سطل آشغال نمانده است. ` +
          'تا پایان این مهلت، سابقه‌ی کالا باید قابل بازگردانی بماند.'
      )
    /**
     * نشست ۱۴۶ · بند ۴-۳۹ و ۴-۳۰ — «حذف دائمی کالا» در فهرست «فقط مدیر» است.
     * قبلاً هر تماس IPC بی‌رمز کالای قدیمی را برای همیشه پاک می‌کرد و userId
     * renderer در Audit می‌نشست. گیت *پس از* چک‌های انتخاب/وجود/غیرفعال/مهلت
     * ۷۳۰ روز (پیام دقیق‌تر به کاربر) و *پیش از* تراکنش (readLock/writeLock).
     */
    const approval = productApprovalNote(
      await assertPanelPassword(PANEL_KEYS.products, input?.managerPassword ?? null, 'حذف همیشگی کالا از سطل آشغال')
    )
    const names = variants.map((v) => `${faDigits(v.code)} — ${titleOf(v)}`)

    return prisma.$transaction(
      async (tx) => {
        /**
         * ممیزی AUDIT-S146-01 (AUDIT-D78) — «داخل سطل آشغال» و مهلت نگهداری فقط بیرون از تراکنش سنجیده
         * می‌شد؛ کالایی که بین گیت رمز و اینجا بازگردانی (فعال) شده بود برای همیشه پاک می‌شد. همان دو شرط
         * داخل تراکنش دوباره خوانده می‌شوند؛ هر اختلاف ⇒ کل عملیات rollback با پیام فارسی.
         */
        // نشست ۱۷۷ · S176-D3 — خواندن دوباره، شمارش حرکت و حذف، همه دسته‌های ۵۰۰تایی داخل همین تراکنش.
        const targetChunks = variantIdChunksOf(targets)
        const stillById = new Map<number, { id: number; isActive: boolean; deletedAt: Date | null }>()
        for (const chunk of targetChunks)
          for (const r of await tx.productVariant.findMany({
            where: { id: { in: chunk } },
            select: { id: true, isActive: true, deletedAt: true }
          }))
            stillById.set(r.id, r)
        const changed = targets.filter((id) => {
          const row = stillById.get(id)
          if (!row || row.isActive) return true
          const d = row.deletedAt instanceof Date ? row.deletedAt.getTime() : Number(new Date(row.deletedAt ?? 0))
          return !d || d > cutoff
        })
        if (changed.length)
          throw new BusinessError(
            `حذف همیشگی انجام نشد: ${faDigits(changed.length)} کالا از لحظه‌ی تأیید تا الان از سطل آشغال بازگردانی، ` +
              'دوباره حذف یا پاک شده است. فهرست سطل آشغال را تازه کنید؛ هیچ کالایی حذف نشد.'
          )
        let movementCount = 0
        for (const chunk of targetChunks) movementCount += await tx.stockMovement.count({ where: { variantId: { in: chunk } } })
        if (movementCount > 0)
          throw new BusinessError(
            `حذف همیشگی انجام نشد: ${faDigits(movementCount)} حرکت در دفتر گردش انبار این کالاها وجود دارد. ` +
              'دفتر گردش append-only است و برای پنهان‌نشدن مدرک مالی/انبار پاک نمی‌شود.'
          )

        // ۱) ساختار: برداشتن کلید خارجی کالا از جدول‌های سابقه (یک بار برای همیشه)
        const schemaAdjusted = await dropVariantForeignKeys(tx)

        // ۲) نگه‌داشتن نام و کد کالا داخل خود ردیف‌های سابقه
        let snapshots = 0
        for (const v of variants) {
          const data = { variantName: titleOf(v), variantCode: v.code }
          const [a, b, c] = await Promise.all([
            tx.saleInvoiceItem.updateMany({ where: { variantId: v.id }, data }),
            tx.purchaseInvoiceItem.updateMany({ where: { variantId: v.id }, data }),
            tx.saleReturnItem.updateMany({ where: { variantId: v.id }, data })
          ])
          snapshots += a.count + b.count + c.count
        }

        // ۳) لینک‌های WooCommerce قبل از حذف واقعی جدا می‌شوند تا FK قدیمی جلوی Purge را نگیرد.
        for (const chunk of targetChunks) {
          const wooLinks = await (tx as any).wooProductLink.findMany({ where: { variantId: { in: chunk } }, select: { id: true } }).catch(() => [])
          const wooLinkIds = wooLinks.map((x: any) => Number(x.id)).filter((x: number) => Number.isFinite(x))
          if (wooLinkIds.length) {
            await (tx as any).wooSyncOutbox.deleteMany({ where: { linkId: { in: wooLinkIds } } }).catch(() => null)
            await (tx as any).wooApproval.updateMany({ where: { linkId: { in: wooLinkIds } }, data: { linkId: null, status: 'EXPIRED', resolutionNote: 'LOCAL_VARIANT_PURGED' } }).catch(() => null)
            await (tx as any).wooInboundEvent.updateMany({ where: { linkId: { in: wooLinkIds } }, data: { linkId: null } }).catch(() => null)
            await (tx as any).wooProductLink.deleteMany({ where: { id: { in: wooLinkIds } } }).catch(() => null)
          }
        }

        // ۴) حذف واقعی رکورد کالا؛ دفتر گردش مرحله‌ی قبل عمداً دست‌نخورده ماند
        const deleted = { count: 0 }
        for (const chunk of targetChunks)
          deleted.count += (await tx.productVariant.deleteMany({ where: { id: { in: chunk } } })).count

        // ۴) محصول پایه‌ای که دیگر هیچ واریانتی ندارد هم می‌رود (وگرنه یک
        //    «کالای بی‌سایز و بی‌بارکد» در فهرست دسته‌بندی باقی می‌ماند)
        const productIds = [...new Set(variants.map((v) => v.product?.id).filter(Boolean) as number[])]
        for (const pid of productIds) {
          const left = await tx.productVariant.count({ where: { productId: pid } })
          if (!left) await tx.product.delete({ where: { id: pid } })
        }

        await audit(tx, {
          action: 'PRODUCT_PURGE',
          entity: 'ProductVariant',
          entityId: targets.length === 1 ? targets[0] : null,
          userId: input?.userId ?? null,
          before: JSON.stringify(
            variants.map((v) => ({ id: v.id, code: v.code, name: titleOf(v), stock: v.stock }))
          ),
          after: JSON.stringify({ deleted: deleted.count, snapshots, movements: 0 }),
          note:
            `حذف همیشگی ${deleted.count} کالا از سطل آشغال (غیرقابل بازگشت). ` +
            `نام و کد کالا در ${snapshots} ردیف سابقه‌ی فروش/خرید/برگشت نگه داشته شد و ` +
            'دفتر گردش انبار دست‌نخورده ماند. ' +
            approval
        })

        return { deleted: deleted.count, snapshots, movements: 0, schemaAdjusted, names }
      },
      { timeout: 120000, maxWait: 15000 }
    )
  }
}
