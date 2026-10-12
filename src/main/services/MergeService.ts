import { PrismaClient } from '@prisma/client'
import { app } from 'electron'
import { copyFile, mkdir, unlink, open } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../db/client'
import { applyMigrations } from '../db/migrator'
import { audit } from './AuditService'
import { bumpReceiptSeq } from './receiptNo'
import { BusinessError } from '../errors'
import { AuditAction } from '@shared/enums'
import { toJalaliDate } from '@shared/jalali'
import type { BackupSummary, MergeReport } from '@shared/types'

/**
 * ===========================================================================
 * ادغام یک فایل بکاپ (SQLite کامل و مستقل) با داده‌ی فعلی — «سناریوی ۱۰ سال».
 *
 * چرا ادغام سخت است؟ هر بکاپ یک دیتابیس کامل با id های auto-increment خودش
 * است. هر دو فایل ممکن است `Product` با id=5 داشته باشند که کاملاً دو کالای
 * متفاوت‌اند. پس نمی‌توان رکوردها را همان‌طور کپی کرد.
 *
 * الگوریتم (سه فاز):
 *
 *   فاز ۰ — آماده‌سازی بی‌خطر:
 *     فایل بکاپ *کپی* می‌شود به یک فایل موقت و همه‌ی کار روی کپی انجام می‌گیرد،
 *     پس آرشیو اصلی هیچ‌وقت لمس نمی‌شود. اگر بکاپ ساختار قدیمی‌تری داشته باشد،
 *     migration های پروژه روی همان کپی اجرا می‌شوند تا خواندنش مطمئن باشد.
 *
 *   فاز ۱ — «جدول‌های هویتی» (dimension) با تطبیق هوشمند:
 *     دسته‌بندی، انبار، روش پرداخت، کاربر، مشتری، تامین‌کننده، محصول و واریانت.
 *     برای این‌ها اول دنبال «همان رکورد» در داده‌ی فعلی می‌گردیم و اگر پیدا شد
 *     رکورد تکراری ساخته نمی‌شود (فقط id مبدأ → id موجود نگاشت می‌شود):
 *       • Category  → بر اساس «مسیر کامل نام» (مثلاً «مردانه/شلوار») بدون
 *         حساسیت به فاصله‌ی اضافه. پس «مردانه» که در هر دو فایل جدا تعریف شده،
 *         یکی در نظر گرفته می‌شود و درخت دسته‌ها تکراری نمی‌شود.
 *       • Warehouse / PaymentMethod / User → name / key / username (یکتاهای طبیعی)
 *       • Customer / Supplier → کد، و اگر کد نبود نام + تلفن
 *       • Product   → نام + دسته‌ی نگاشت‌شده
 *       • Variant   → *بارکد* (هویت فیزیکی کالا)، و اگر نبود کد کالا
 *
 *   فاز ۲ — «جدول‌های رویدادی» (fact) با شماره‌گذاری تازه:
 *     فاکتور فروش و اقلامش، دریافتی‌ها، برگشت‌ها، فاکتور خرید، حرکات انبار،
 *     شیفت، صندوق، تجمیع و AuditLog. این‌ها همیشه *افزوده* می‌شوند (هیچ‌وقت
 *     تطبیق نمی‌خورند) با id تازه، و همه‌ی کلیدهای خارجی‌شان با نگاشت فاز ۱ و
 *     ۲ اصلاح می‌گردد. «شماره فیش» و «شماره فاکتور خرید» چون unique اند و قطعاً
 *     برخورد دارند، از max فعلی + ۱ دوباره شماره‌گذاری می‌شوند و شماره‌ی اصلیِ
 *     بکاپ در یادداشت همان سند نگه داشته می‌شود تا ردپا گم نشود.
 *
 * ⚠️ موجودی انبار عمداً دست‌نخورده می‌ماند:
 * حرکات انبارِ بکاپ به‌عنوان *سند تاریخی* وارد می‌شوند ولی فیلد `stock` هیچ
 * واریانتی تغییر نمی‌کند. چون بکاپ سالِ گذشته است، «موجودی امروز» فروشگاه شما
 * حقیقتِ فعلی است و نباید با کسر و اضافه‌ی سال قبل به‌هم بریزد.
 *
 * محدودیت‌های شناخته‌شده (صادقانه):
 *   • دو کالا با «بارکد یکسان ولی نام متفاوت» در دو فایل: یکی در نظر گرفته
 *     می‌شوند (بارکد برنده است) و نام بکاپ نادیده می‌ماند؛ همین مورد در
 *     هشدارهای گزارش پایانی صریح لیست می‌شود.
 *   • دو کالای متفاوت با «کد یکسان ولی بارکد متفاوت»: چون کد unique است، کالای
 *     بکاپ با کد جدیدِ «کد-b2» ساخته می‌شود (داده گم نمی‌شود، فقط کدش عوض).
 *   • دو دسته‌ی هم‌نام در دو *مسیر* متفاوت («مردانه/شلوار» و «زنانه/شلوار»)
 *     دو دسته‌ی جدا می‌مانند — که درست است.
 *   • تنظیمات (جدول Setting) هرگز از بکاپ وارد نمی‌شود؛ تنظیمات فعلی شما
 *     (قالب چاپ، عوارض، رمز مدیر) دست‌نخورده می‌ماند.
 * ===========================================================================
 */

type Row = Record<string, any>

const CHUNK = 500

/**
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` این تابع **بی‌اثر** بود:
 *
 *     const n = typeof v === 'bigint' ? Number(v) : Number(v)   // هر دو طرف یکی!
 *
 * کسی ternary را نوشته بود تا bigint را جدا مدیریت کند، ولی هر دو شاخه همان
 * `Number(v)` بودند. بعد از مهاجرت بند ۴-۲۸ الف، `$queryRawUnsafe` روی ستون
 * `BIGINT` مقدار `bigint` می‌دهد و این تابع هر مبلغ بالای
 * `Number.MAX_SAFE_INTEGER` را **بی‌صدا** گرد می‌کرد — دقیقاً وسط عملیاتی که
 * دفاتر مالی را به‌صورت انبوه می‌نویسد.
 *
 * حالا بیرون از محدوده‌ی امن خطا می‌دهد. ادغام روی یک تراکنش است، پس خطا یعنی
 * «هیچ‌چیز اضافه نشد و داده‌ی فعلی دست‌نخورده ماند» — که بی‌نهایت بهتر از
 * اضافه شدنِ فاکتوری با مبلغ غلط است.
 *
 * ⚠️ این تابع برای *مبلغ* نیست؛ برای شناسه/تعداد/شمارنده است. مبالغ باید از
 * `rial()` پایین عبور کنند تا اصلاً از bigint خارج نشوند.
 */
const num = (v: unknown, d = 0): number => {
  if (typeof v === 'bigint') {
    if (v > 9007199254740991n || v < -9007199254740991n)
      throw new Error(
        `مقدار ${v.toString()} از محدوده‌ی امن عدد جاوااسکریپت بیرون است؛ ادغام انجام نشد تا عددی غلط ثبت نشود.`
      )
    return Number(v)
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

/**
 * مبلغ ریالی برای نوشتن در ستون‌های `BigInt` (بند ۴-۲۸ الف).
 *
 * برخلاف `num()`، این تابع هیچ‌وقت از `bigint` خارج نمی‌شود: مقدار خوانده‌شده
 * از فایل بکاپ مستقیم به همان شکل در دیتابیس مقصد می‌نشیند. یعنی ادغامِ یک
 * بکاپِ حاویِ گردش بزرگ، حتی یک ریال هم جابه‌جا نمی‌شود.
 */
const rial = (v: unknown): bigint => {
  if (v === null || v === undefined || v === '') return 0n
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0n
    return BigInt(Math.round(v))
  }
  const t = String(v).trim()
  if (!/^[+-]?\d+$/.test(t)) {
    const n = Number(t)
    return Number.isFinite(n) ? BigInt(Math.round(n)) : 0n
  }
  return BigInt(t)
}
const rialOrNull = (v: unknown): bigint | null => (v === null || v === undefined || v === '' ? null : rial(v))
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = num(v, NaN)
  return Number.isFinite(n) ? Math.round(n) : null
}
const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const bool = (v: unknown, d = false): boolean => (v === null || v === undefined ? d : Boolean(num(v, d ? 1 : 0)) || v === true)
const date = (v: unknown, d: Date = new Date()): Date => {
  if (v instanceof Date && !isNaN(v.getTime())) return v
  if (typeof v === 'number') return new Date(v)
  if (typeof v === 'string') {
    const parsed = new Date(v)
    if (!isNaN(parsed.getTime())) return parsed
  }
  return d
}
const dateOrNull = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null
  const parsed = date(v, new Date(NaN))
  return isNaN(parsed.getTime()) ? null : parsed
}
/** نام برای تطبیق: فاصله‌های اضافه و بزرگی/کوچکی حروف بی‌اثر می‌شود. */
const norm = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim().toLowerCase()

/** ساخت کلاینت موقت روی یک فایل SQLite دلخواه. */
function clientFor(file: string): PrismaClient {
  // connection_limit=1: اجراکننده‌ی migration با BEGIN/COMMIT خام کار می‌کند و همه‌ی
  // جمله‌ها باید روی یک اتصال فیزیکی باشند (همان باگ startup قفل SQLite روی فایل بکاپ).
  return new PrismaClient({ datasources: { db: { url: `file:${file}?connection_limit=1` } }, log: ['error'] })
}

async function tableExists(client: PrismaClient, table: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    table
  )
  return num(rows?.[0]?.n) > 0
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'ascii')
/** این‌ها از migration پایه‌اند و حداقل هویت یک بکاپ کامل MAHAK را می‌سازند. */
const REQUIRED_BACKUP_TABLES = [
  'Setting',
  'User',
  'Product',
  'ProductVariant',
  'PaymentMethod',
  'SaleInvoice',
  'SaleInvoiceItem',
  'Payment'
]

const invalidBackup = () => new BusinessError('این فایل یک بکاپ SQLite معتبر از همین برنامه نیست.')

/**
 * پیش از هر preview/restore/merge فایل را به‌عنوان SQLite سالم و schema خودمان
 * تأیید می‌کنیم. summarizeBackup سابقاً خطای هر query را صفر می‌کرد؛ بنابراین
 * یک PDF/متن یا SQLite نامرتبط با «خلاصه‌ی صفر» وارد فهرست و حتی restore می‌شد.
 */
async function assertSqliteHeader(file: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(file, 'r')
    const header = Buffer.alloc(SQLITE_HEADER.length)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) throw invalidBackup()
  } catch (error) {
    if (error instanceof BusinessError) throw error
    throw invalidBackup()
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function assertValidBackupFile(client: PrismaClient, file: string): Promise<void> {
  await assertSqliteHeader(file)
  try {
    const check = await client.$queryRawUnsafe<Record<string, unknown>[]>('PRAGMA quick_check(1)')
    const integrity = check?.[0] ? Object.values(check[0]).some((value) => String(value).toLowerCase() === 'ok') : false
    if (!integrity) throw invalidBackup()

    const missing: string[] = []
    for (const table of REQUIRED_BACKUP_TABLES) if (!(await tableExists(client, table))) missing.push(table)
    if (missing.length) throw invalidBackup()
  } catch (error) {
    if (error instanceof BusinessError) throw error
    throw invalidBackup()
  }
}

/** خواندن کل یک جدول (جدول نبود = فهرست خالی، نه خطا). */
async function readAll(client: PrismaClient, table: string): Promise<Row[]> {
  if (!(await tableExists(client, table))) return []
  try {
    return (await client.$queryRawUnsafe<Row[]>(`SELECT * FROM "${table}"`)) ?? []
  } catch (error) {
    // جدولِ واقعاً غایب برای backup خیلی قدیمی بالا [] برمی‌گردد؛ اما خطای
    // خواندن جدولِ موجود (خرابی/قفل/schema ناسازگار) نباید به «این بخش خالی
    // بود» تبدیل شود، چون merge مالیِ نصفه می‌سازد.
    console.error('[merge] read failed', table, error)
    throw new BusinessError(`خواندن جدول «${table}» از بکاپ ناموفق بود؛ ادغام انجام نشد تا داده‌ی ناقص وارد نشود.`)
  }
}

/** خواندن جدول‌های بزرگ به‌صورت تکه‌تکه (حافظه بی‌نهایت نمی‌خواهد). */
async function eachChunk(
  client: PrismaClient,
  table: string,
  fn: (rows: Row[]) => Promise<void>
): Promise<void> {
  if (!(await tableExists(client, table))) return
  let lastId = 0
  for (;;) {
    const rows =
      (await client.$queryRawUnsafe<Row[]>(
        `SELECT * FROM "${table}" WHERE "id" > ? ORDER BY "id" ASC LIMIT ${CHUNK}`,
        lastId
      )) ?? []
    if (!rows.length) return
    await fn(rows)
    lastId = num(rows[rows.length - 1].id)
  }
}

async function maxId(client: PrismaClient, table: string, column = 'id'): Promise<number> {
  try {
    const rows = await client.$queryRawUnsafe<{ m: number | null }[]>(
      `SELECT MAX("${column}") AS m FROM "${table}"`
    )
    return num(rows?.[0]?.m, 0)
  } catch {
    return 0
  }
}

/**
 * درج گروهی. اول createMany امتحان می‌شود (سریع) و اگر پشتیبانی نشد یا خطا داد،
 * ردیف‌به‌ردیف درج می‌شود تا ادغام به‌خاطر یک تفاوت نسخه نصفه نماند.
 */
async function insertRows(tx: any, model: string, rows: any[], stats: Record<string, number>): Promise<void> {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    try {
      await tx[model].createMany({ data: slice })
    } catch {
      for (const r of slice) {
        try {
          await tx[model].create({ data: r })
        } catch (e) {
          console.error('[merge] insert failed', model, e)
          throw new BusinessError(
            `درج داده‌ی بکاپ در جدول «${model}» ناموفق بود، پس ادغام انجام نشد و داده‌ی فعلی شما دست‌نخورده ماند.`
          )
        }
      }
    }
    stats[model] = (stats[model] ?? 0) + slice.length
  }
}

/** خلاصه‌ی محتوای یک فایل بکاپ (برای نمایش قبل از اعمال). */
export async function summarizeBackup(file: string): Promise<BackupSummary> {
  // اعتبارسنجی magic باید قبل از ساخت PrismaClient باشد: بعضی driverها اتصال به
  // bytes خراب را همان لحظه throw می‌کنند و نباید آن خطای خام از gate عبور کند.
  await assertSqliteHeader(file)
  const client = clientFor(file)
  try {
    await assertValidBackupFile(client, file)
    const one = async (sql: string): Promise<Row> => {
      try {
        const rows = await client.$queryRawUnsafe<Row[]>(sql)
        return rows?.[0] ?? {}
      } catch {
        return {}
      }
    }
    const inv = await one(
      `SELECT COUNT(*) AS c, MIN("issuedAtJalali") AS f, MAX("issuedAtJalali") AS l, SUM("grandTotal") AS g FROM "SaleInvoice"`
    )
    const items = await one(`SELECT COUNT(*) AS c FROM "SaleInvoiceItem"`)
    const products = await one(`SELECT COUNT(*) AS c FROM "Product"`)
    const variants = await one(`SELECT COUNT(*) AS c FROM "ProductVariant"`)
    const returns = await one(`SELECT COUNT(*) AS c FROM "SaleReturn"`)
    const purchases = await one(`SELECT COUNT(*) AS c FROM "PurchaseInvoice"`)
    const movements = await one(`SELECT COUNT(*) AS c FROM "StockMovement"`)
    return {
      invoiceCount: num(inv.c),
      itemCount: num(items.c),
      productCount: num(products.c),
      variantCount: num(variants.c),
      returnCount: num(returns.c),
      purchaseCount: num(purchases.c),
      movementCount: num(movements.c),
      firstJalali: strOrNull(inv.f),
      lastJalali: strOrNull(inv.l),
      grandTotal: num(inv.g)
    }
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

/**
 * ادغام کامل یک فایل بکاپ با داده‌ی فعلی.
 * همه‌ی نوشتن‌ها در *یک* تراکنش انجام می‌شود: یا کل بکاپ اضافه می‌شود، یا اگر
 * جایی خطا بدهد هیچ‌چیز اضافه نمی‌شود و داده‌ی فعلی دقیقاً مثل قبل می‌ماند.
 */
async function assertMergeCreditSafe(src: PrismaClient): Promise<void> {
  const count = async (sql: string): Promise<number> => {
    try {
      const rows = await src.$queryRawUnsafe<Row[]>(sql)
      return num(rows?.[0]?.c ?? rows?.[0]?.n)
    } catch {
      return 0
    }
  }
  const credits = await count('SELECT COUNT(*) AS c FROM "StoreCredit"')
  const scPays = await count('SELECT COUNT(*) AS c FROM "Payment" WHERE "storeCreditId" IS NOT NULL')
  if (credits <= 0 && scPays <= 0) return
  const bits: string[] = []
  if (credits > 0) bits.push(`${credits} اعتبار خرید (جدول اعتبار در ادغام منتقل نمی‌شود)`)
  if (scPays > 0) bits.push(`${scPays} پرداخت گره خورده به اعتبار`)
  throw new BusinessError(
    'ادغام این بکاپ انجام نشد چون سند اعتبار خرید دارد و ورود ناقص‌شان عدد مالی را خراب می‌کند:\\n' +
      bits.map((b) => `• ${b}`).join('\\n') +
      '\\nتا تکمیل ادغام اعتبار، از «جایگزینی کامل» استفاده کنید. داده‌ی فعلی دست‌نخورده ماند.'
  )
}

export async function mergeBackup(input: {
  file: string
  fileName?: string
  userId?: number | null
}): Promise<MergeReport> {
  const started = Date.now()
  const fileName = input.fileName || input.file.split(/[\\/]/).pop() || 'backup.db'
  // mergeBackup مسیر عمومی هم دارد؛ non-SQLite نباید حتی به driver یا tmp copy برسد.
  await assertSqliteHeader(input.file)
  const tmpDir = join(app.getPath('userData'), 'backups', 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const tmp = join(tmpDir, `merge-${Date.now()}.db`)
  await copyFile(input.file, tmp)

  const src = clientFor(tmp)
  const inserted: Record<string, number> = {}
  const matched: Record<string, number> = {}
  const warnings: string[] = []
  const bump = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n)

  try {
    // merge ممکن است خارج از BackupService هم صدا زده شود؛ همان اعتبارسنجی
    // import/preview را پیش از migration و هر خواندن/نوشتن تکرار می‌کنیم.
    await assertValidBackupFile(src, tmp)

    // ساختار بکاپ قدیمی‌تر؟ روی همان *کپی* به‌روزش می‌کنیم (آرشیو اصلی دست‌نخورده).
    // ادامه‌دادن با schema نامعلوم، خواندن چند جدول و ردکردن بقیه را ممکن می‌کرد.
    try {
      await applyMigrations(src, tmp, { touchFile: false })
    } catch (error) {
      console.error('[merge] migrate temp copy failed', error)
      throw new BusinessError('به‌روزرسانی ساختار بکاپ ناموفق بود؛ ادغام برای جلوگیری از ورود ناقص انجام نشد.')
    }

    if (!(await tableExists(src, 'SaleInvoice')) && !(await tableExists(src, 'ProductVariant')))
      throw new BusinessError('این فایل یک بکاپ معتبر از همین برنامه نیست (جدول‌های اصلی داخلش پیدا نشد).')

    /**
     * نشست ۱۸۸ · بازبینی ۱۸۶ مورد ۲ — اعتبار خرید در ادغام منتقل نمی‌شود.
     * ورود فاکتورِ پرداخت‌شده با اعتبار، بدون ردیف اعتبار/مصرف، paidTotal دروغ
     * می‌سازد. تا آن جدول‌ها هم ادغام شوند، چنین بکاپی رد می‌شود.
     */
    await assertMergeCreditSafe(src)

    // ---------- شناسه‌های بعدی روی دیتابیس فعلی ----------
    const next: Record<string, number> = {}
    const tables = [
      'Category',
      'Warehouse',
      'Product',
      'ProductVariant',
      'Customer',
      'Supplier',
      'User',
      'PaymentMethod',
      'Shift',
      'CashSession',
      'CashMovement',
      'Consolidation',
      'SaleInvoice',
      'SaleInvoiceItem',
      'Payment',
      'PaymentChequeStatusHistory',
      'SaleReturn',
      'SaleReturnItem',
      'CardTransferRequest',
      'PurchaseInvoice',
      'PurchaseInvoiceItem',
      'StockMovement',
      'AuditLog'
    ]
    for (const t of tables) next[t] = (await maxId(prisma as any, t)) + 1
    const takeId = (t: string): number => next[t]++

    const maxReceipt = await maxId(prisma as any, 'SaleInvoice', 'receiptNo')
    const seqRow = await prisma.setting.findUnique({ where: { key: 'sale.receiptSeq' } }).catch(() => null)
    const storedSeq = Math.round(Number((seqRow as any)?.value ?? 0)) || 0
    let receiptNo = Math.max(maxReceipt, storedSeq) + 1
    let purchaseNo = (await maxId(prisma as any, 'PurchaseInvoice', 'invoiceNo')) + 1
    const firstReceiptNo = receiptNo

    // ---------- فاز ۱: جدول‌های هویتی ----------
    const catMap = new Map<number, number>()
    const warehouseMap = new Map<number, number>()
    const productMap = new Map<number, number>()
    const variantMap = new Map<number, number>()
    const customerMap = new Map<number, number>()
    const supplierMap = new Map<number, number>()
    const userMap = new Map<number, number>()
    const methodMap = new Map<number, number>()
    const shiftMap = new Map<number, number>()
    const consolidationMap = new Map<number, number>()
    const invoiceMap = new Map<number, number>()
    const saleItemMap = new Map<number, number>()
    const returnMap = new Map<number, number>()
    const paymentMap = new Map<number, number>()

    /**
     * همه‌ی نوشتن‌ها (هم جدول‌های هویتی و هم رویدادی) در *یک* تراکنش:
     * یا کل بکاپ اضافه می‌شود، یا اگر جایی خطا بدهد هیچ‌چیز اضافه نمی‌شود و
     * داده‌ی فعلی مو‌به‌مو مثل قبل می‌ماند (هیچ حالت نصفه‌ای وجود ندارد).
     */
    await prisma.$transaction(
      async (tx) => {

        // --- دسته‌بندی: تطبیق بر اساس «مسیر کامل نام» ---
        const srcCats = await readAll(src, 'Category')
        const dstCats = await tx.category.findMany({ select: { id: true, name: true, parentId: true } })

        const pathOf = (rows: { id: number; name: string; parentId: number | null }[]) => {
          const byId = new Map(rows.map((c) => [c.id, c]))
          const cache = new Map<number, string>()
          const walk = (id: number, depth = 0): string => {
            if (cache.has(id)) return cache.get(id) as string
            const node = byId.get(id)
            if (!node || depth > 30) return ''
            const parent = node.parentId != null && byId.has(node.parentId) ? walk(node.parentId, depth + 1) : ''
            const full = parent ? `${parent}/${norm(node.name)}` : norm(node.name)
            cache.set(id, full)
            return full
          }
          return { walk, byId }
        }
        const dstPath = pathOf(dstCats as any)
        const dstByPath = new Map<string, number>()
        for (const c of dstCats) dstByPath.set(dstPath.walk(c.id), c.id)

        const srcNormalized = srcCats.map((c) => ({
          id: num(c.id),
          name: str(c.name),
          parentId: intOrNull(c.parentId)
        }))
        const srcPath = pathOf(srcNormalized)
        // به ترتیب عمق، تا والد همیشه قبل از فرزند نگاشت شود
        const depthOf = (id: number): number => {
          let d = 0
          let cur = srcPath.byId.get(id)
          const seen = new Set<number>()
          while (cur?.parentId != null && !seen.has(cur.id)) {
            seen.add(cur.id)
            cur = srcPath.byId.get(cur.parentId)
            d++
          }
          return d
        }
        for (const c of [...srcNormalized].sort((a, b) => depthOf(a.id) - depthOf(b.id))) {
          const path = srcPath.walk(c.id)
          const hit = dstByPath.get(path)
          if (hit != null) {
            catMap.set(c.id, hit)
            bump(matched, 'Category')
            continue
          }
          const id = takeId('Category')
          const parentId = c.parentId != null ? catMap.get(c.parentId) ?? null : null
          await tx.category.create({ data: { id, name: c.name, parentId } })
          catMap.set(c.id, id)
          dstByPath.set(path, id)
          bump(inserted, 'Category')
        }

        // --- انبار (نام یکتا) ---
        const dstWarehouses = await tx.warehouse.findMany({ select: { id: true, name: true } })
        const whByName = new Map(dstWarehouses.map((w) => [norm(w.name), w.id]))
        for (const w of await readAll(src, 'Warehouse')) {
          const key = norm(w.name)
          const hit = whByName.get(key)
          if (hit != null) {
            warehouseMap.set(num(w.id), hit)
            bump(matched, 'Warehouse')
            continue
          }
          const id = takeId('Warehouse')
          await tx.warehouse.create({ data: { id, name: str(w.name, `انبار ${id}`), isMain: false } })
          warehouseMap.set(num(w.id), id)
          whByName.set(key, id)
          bump(inserted, 'Warehouse')
        }

        // --- روش پرداخت (key یکتا) ---
        const dstMethods = await tx.paymentMethod.findMany({ select: { id: true, key: true } })
        const methodByKey = new Map(dstMethods.map((m) => [norm(m.key), m.id]))
        for (const m of await readAll(src, 'PaymentMethod')) {
          const key = norm(m.key)
          const hit = methodByKey.get(key)
          if (hit != null) {
            methodMap.set(num(m.id), hit)
            bump(matched, 'PaymentMethod')
            continue
          }
          const id = takeId('PaymentMethod')
          await tx.paymentMethod.create({
            data: {
              id,
              key: str(m.key, `IMPORTED_${id}`),
              label: str(m.label, 'پرداخت واردشده'),
              kind: str(m.kind, 'CUSTOM'),
              isActive: bool(m.isActive, true),
              sortOrder: num(m.sortOrder, 99)
            }
          })
          methodMap.set(num(m.id), id)
          methodByKey.set(key, id)
          bump(inserted, 'PaymentMethod')
        }

        // --- کاربر (username یکتا) ---
        const dstUsers = await tx.user.findMany({ select: { id: true, username: true } })
        const userByName = new Map(dstUsers.map((u) => [norm(u.username), u.id]))
        for (const u of await readAll(src, 'User')) {
          const key = norm(u.username)
          const hit = userByName.get(key)
          if (hit != null) {
            userMap.set(num(u.id), hit)
            bump(matched, 'User')
            continue
          }
          const id = takeId('User')
          await tx.user.create({
            data: {
              id,
              username: str(u.username, `imported_${id}`),
              passwordHash: str(u.passwordHash, 'imported'),
              displayName: str(u.displayName, str(u.username, 'کاربر واردشده')),
              role: str(u.role, 'CASHIER'),
              isActive: bool(u.isActive, false),
              createdAt: date(u.createdAt)
            }
          })
          userMap.set(num(u.id), id)
          userByName.set(key, id)
          bump(inserted, 'User')
        }

        // --- مشتری و تامین‌کننده (کد یکتا، وگرنه نام+تلفن) ---
        const dstCustomers = await tx.customer.findMany({ select: { id: true, code: true, name: true, phone: true } })
        const custByCode = new Map(dstCustomers.map((c) => [norm(c.code), c.id]))
        const custByName = new Map(dstCustomers.map((c) => [`${norm(c.name)}|${norm(c.phone)}`, c.id]))
        for (const c of await readAll(src, 'Customer')) {
          const byCode = custByCode.get(norm(c.code))
          const byName = custByName.get(`${norm(c.name)}|${norm(c.phone)}`)
          const hit = byCode ?? byName
          if (hit != null) {
            customerMap.set(num(c.id), hit)
            bump(matched, 'Customer')
            continue
          }
          const id = takeId('Customer')
          let code = str(c.code, String(id))
          if (custByCode.has(norm(code))) code = `${code}-b${id}`
          await tx.customer.create({
            data: {
              id,
              code,
              name: str(c.name, 'مشتری واردشده'),
              phone: strOrNull(c.phone),
              address: strOrNull(c.address),
              // «مشتری عمومی» فعلی یکی است و همان می‌ماند
              isDefault: false,
              createdAt: date(c.createdAt)
            }
          })
          customerMap.set(num(c.id), id)
          custByCode.set(norm(code), id)
          bump(inserted, 'Customer')
        }

        const dstSuppliers = await tx.supplier.findMany({ select: { id: true, code: true, name: true, phone: true } })
        const supByCode = new Map(dstSuppliers.map((c) => [norm(c.code), c.id]))
        const supByName = new Map(dstSuppliers.map((c) => [`${norm(c.name)}|${norm(c.phone)}`, c.id]))
        for (const c of await readAll(src, 'Supplier')) {
          const hit = supByCode.get(norm(c.code)) ?? supByName.get(`${norm(c.name)}|${norm(c.phone)}`)
          if (hit != null) {
            supplierMap.set(num(c.id), hit)
            bump(matched, 'Supplier')
            continue
          }
          const id = takeId('Supplier')
          let code = str(c.code, String(id))
          if (supByCode.has(norm(code))) code = `${code}-b${id}`
          await tx.supplier.create({
            data: {
              id,
              code,
              name: str(c.name, 'تامین‌کننده واردشده'),
              phone: strOrNull(c.phone),
              address: strOrNull(c.address),
              createdAt: date(c.createdAt)
            }
          })
          supplierMap.set(num(c.id), id)
          supByCode.set(norm(code), id)
          bump(inserted, 'Supplier')
        }

        // --- محصول (نام + دسته‌ی نگاشت‌شده) ---
        const srcProducts = await readAll(src, 'Product')
        const dstProducts = await tx.product.findMany({ select: { id: true, name: true, categoryId: true } })
        const prodKey = (name: unknown, categoryId: number | null) => `${norm(name)}|${categoryId ?? 0}`
        const prodIndex = new Map(dstProducts.map((p) => [prodKey(p.name, p.categoryId ?? null), p.id]))
        for (const p of srcProducts) {
          const categoryId = p.categoryId != null ? catMap.get(num(p.categoryId)) ?? null : null
          const key = prodKey(p.name, categoryId)
          const hit = prodIndex.get(key)
          if (hit != null) {
            productMap.set(num(p.id), hit)
            bump(matched, 'Product')
            continue
          }
          const id = takeId('Product')
          await tx.product.create({
            data: {
              id,
              name: str(p.name, `کالای واردشده ${id}`),
              categoryId,
              unit: str(p.unit, 'عدد'),
              isActive: bool(p.isActive, true),
              note: strOrNull(p.note),
              createdAt: date(p.createdAt),
              updatedAt: date(p.updatedAt)
            }
          })
          productMap.set(num(p.id), id)
          prodIndex.set(key, id)
          bump(inserted, 'Product')
        }

        // --- واریانت: بارکد هویت است، بعد کد کالا ---
        const srcVariants = await readAll(src, 'ProductVariant')
        const dstVariants = await tx.productVariant.findMany({
          select: { id: true, code: true, barcode: true, product: { select: { name: true } } }
        })
        const varByBarcode = new Map(dstVariants.map((v) => [norm(v.barcode), v]))
        const varByCode = new Map(dstVariants.map((v) => [norm(v.code), v]))
        const srcProductName = new Map(srcProducts.map((p) => [num(p.id), str(p.name)]))
        for (const v of srcVariants) {
          const barcodeHit = varByBarcode.get(norm(v.barcode))
          if (barcodeHit) {
            variantMap.set(num(v.id), barcodeHit.id)
            bump(matched, 'ProductVariant')
            const backupName = srcProductName.get(num(v.productId)) ?? ''
            if (backupName && norm(backupName) !== norm(barcodeHit.product?.name))
              warnings.push(
                `بارکد ${str(v.barcode)} در بکاپ برای «${backupName}» بود ولی در داده‌ی فعلی برای «${str(
                  barcodeHit.product?.name
                )}»؛ همان کالای فعلی در نظر گرفته شد (بارکد برنده است) و اقلام بکاپ به آن وصل شدند.`
              )
            continue
          }
          const codeHit = varByCode.get(norm(v.code))
          const id = takeId('ProductVariant')
          let code = str(v.code, String(id))
          if (codeHit) {
            code = `${code}-b${id}`
            warnings.push(
              `کد کالای ${str(v.code)} در داده‌ی فعلی برای کالای دیگری استفاده شده بود، پس کالای بکاپ با کد «${code}» ساخته شد (بارکدش متفاوت است).`
            )
          }
          let barcode = str(v.barcode, `b${id}${Date.now() % 100000}`)
          if (varByBarcode.has(norm(barcode))) barcode = `${barcode}-b${id}`
          const productId = productMap.get(num(v.productId))
          if (!productId) continue
          const created = await tx.productVariant.create({
            data: {
              id,
              productId,
              code,
              barcode,
              size: strOrNull(v.size),
              color: strOrNull(v.color),
              salePrice: rial(v.salePrice),
              purchasePrice: rial(v.purchasePrice),
              // موجودی از بکاپ *وارد نمی‌شود*: موجودی امروز فروشگاه حقیقت فعلی است
              stock: 0,
              minStock: num(v.minStock),
              ledgerAccountCode: strOrNull(v.ledgerAccountCode),
              isActive: bool(v.isActive, true),
              deletedAt: dateOrNull(v.deletedAt),
              createdAt: date(v.createdAt),
              updatedAt: date(v.updatedAt)
            },
            select: { id: true, code: true, barcode: true, product: { select: { name: true } } }
          })
          variantMap.set(num(v.id), id)
          varByBarcode.set(norm(barcode), created as any)
          varByCode.set(norm(code), created as any)
          bump(inserted, 'ProductVariant')
        }

        // ---------- فاز ۲: جدول‌های رویدادی (همه در یک تراکنش) ----------
        const stamp = toJalaliDate(new Date())
        const tag = `[بکاپ ${fileName}]`

        // --- شیفت: روز + شماره یکی باشد ⇒ همان شیفت (بکاپ سالانه معمولاً روز مشترک ندارد) ---
        const dstShifts = await tx.shift.findMany({ select: { id: true, dayJalali: true, number: true } })
        const shiftIndex = new Map(dstShifts.map((s) => [`${s.dayJalali}#${s.number}`, s.id]))
        for (const s of await readAll(src, 'Shift')) {
          const key = `${str(s.dayJalali)}#${num(s.number, 1)}`
          const hit = shiftIndex.get(key)
          if (hit != null && str(s.dayJalali)) {
            shiftMap.set(num(s.id), hit)
            bump(matched, 'Shift')
            continue
          }
          const id = takeId('Shift')
          await tx.shift.create({
            data: {
              id,
              name: str(s.name, `شیفت ${num(s.number, 1)}`),
              number: num(s.number, 1),
              dayJalali: str(s.dayJalali),
              userId: s.userId != null ? userMap.get(num(s.userId)) ?? null : null,
              openedAt: date(s.openedAt),
              closedAt: dateOrNull(s.closedAt),
              note: strOrNull(s.note)
            }
          })
          shiftMap.set(num(s.id), id)
          if (str(s.dayJalali)) shiftIndex.set(key, id)
          bump(inserted, 'Shift')
        }

        // --- تجمیع و انتقال ---
        for (const c of await readAll(src, 'Consolidation')) {
          const id = takeId('Consolidation')
          await tx.consolidation.create({
            data: {
              id,
              fromDate: date(c.fromDate),
              toDate: date(c.toDate),
              dayJalali: strOrNull(c.dayJalali),
              shiftId: c.shiftId != null ? shiftMap.get(num(c.shiftId)) ?? null : null,
              goodsTotal: rial(c.goodsTotal),
              taxTotal: rial(c.taxTotal),
              serviceTotal: rial(c.serviceTotal),
              discountTotal: rial(c.discountTotal),
              deliveryTotal: rial(c.deliveryTotal),
              grandTotal: rial(c.grandTotal),
              receivedTotal: rial(c.receivedTotal),
              returnedTotal: rial(c.returnedTotal),
              invoiceCount: num(c.invoiceCount),
              movementCount: num(c.movementCount),
              finalizedAt: dateOrNull(c.finalizedAt),
              createdAt: date(c.createdAt)
            }
          })
          consolidationMap.set(num(c.id), id)
          bump(inserted, 'Consolidation')
        }

        // --- بستن صندوق ---
        for (const s of await readAll(src, 'CashSession')) {
          const id = takeId('CashSession')
          await tx.cashSession.create({
            data: {
              id,
              shiftId: s.shiftId != null ? shiftMap.get(num(s.shiftId)) ?? null : null,
              fromDate: date(s.fromDate),
              toDate: date(s.toDate),
              dayJalali: str(s.dayJalali),
              cashTotal: rial(s.cashTotal),
              cardTotal: rial(s.cardTotal),
              creditTotal: rial(s.creditTotal),
              otherTotal: rial(s.otherTotal),
              grandTotal: rial(s.grandTotal),
              invoiceCount: num(s.invoiceCount),
              countedTotal: rialOrNull(s.countedTotal),
              // snapshot بستن صندوق یک سند مالی تاریخی است، نه عدد قابل محاسبه
              // از وضعیت امروز؛ همه‌ی اجزایش باید همراه CashMovement بمانند.
              openingFloat: rial(s.openingFloat),
              cashSales: rial(s.cashSales),
              cardSales: rial(s.cardSales),
              otherSales: rial(s.otherSales),
              clearedChequeSales: rial(s.clearedChequeSales),
              priorCreditSettlements: rial(s.priorCreditSettlements),
              cashReturnRefunds: rial(s.cashReturnRefunds),
              cardReturnRefunds: rial(s.cardReturnRefunds),
              cashExchangeRefunds: rial(s.cashExchangeRefunds),
              storeCreditIssued: rial(s.storeCreditIssued),
              storeCreditUsed: rial(s.storeCreditUsed),
              pendingCheques: rial(s.pendingCheques),
              bouncedCheques: rial(s.bouncedCheques),
              withdrawals: rial(s.withdrawals),
              deposits: rial(s.deposits),
              expectedCash: rial(s.expectedCash),
              cashDifference: rial(s.cashDifference),
              managerAccountReceived: rial(s.managerAccountReceived),
              destinationUnknownReceived: rial(s.destinationUnknownReceived),
              accountingSnapshotJson: strOrNull(s.accountingSnapshotJson),
              reportVersion: strOrNull(s.reportVersion),
              closedAt: dateOrNull(s.closedAt),
              closedBy: s.closedBy != null ? userMap.get(num(s.closedBy)) ?? null : null,
              note: strOrNull(s.note),
              createdAt: date(s.createdAt)
            }
          })
          bump(inserted, 'CashSession')
        }

        // --- فاکتور فروش (شماره فیش دوباره شماره‌گذاری می‌شود) ---
        await eachChunk(src, 'SaleInvoice', async (rows) => {
          const data = rows.map((inv) => {
            const id = takeId('SaleInvoice')
            invoiceMap.set(num(inv.id), id)
            const originalNo = num(inv.receiptNo)
            const note = strOrNull(inv.note)
            return {
              id,
              receiptNo: receiptNo++,
              customerId: inv.customerId != null ? customerMap.get(num(inv.customerId)) ?? null : null,
              userId: inv.userId != null ? userMap.get(num(inv.userId)) ?? null : null,
              shiftId: inv.shiftId != null ? shiftMap.get(num(inv.shiftId)) ?? null : null,
              consolidationId:
                inv.consolidationId != null ? consolidationMap.get(num(inv.consolidationId)) ?? null : null,
              issuedAt: date(inv.issuedAt),
              issuedAtJalali: str(inv.issuedAtJalali, stamp),
              status: str(inv.status, 'SETTLED'),
              orderType: str(inv.orderType, 'INTERNAL'),
              deductInventory: bool(inv.deductInventory, true),
              wholesaleDiscountPercent: intOrNull(inv.wholesaleDiscountPercent),
              // کد برگشت از فروش بکاپ منقضی است و نباید با کد فاکتورهای امروز قاطی شود
              returnCode: null,
              returnCodeExpiresAt: null,
              tableNo: strOrNull(inv.tableNo),
              goodsTotal: rial(inv.goodsTotal),
              taxTotal: rial(inv.taxTotal),
              serviceCharge: rial(inv.serviceCharge),
              discountTotal: rial(inv.discountTotal),
              deliveryFee: rial(inv.deliveryFee),
              grandTotal: rial(inv.grandTotal),
              paidTotal: rial(inv.paidTotal),
              voidedAt: dateOrNull(inv.voidedAt),
              voidedByUserId: inv.voidedByUserId != null ? userMap.get(num(inv.voidedByUserId)) ?? null : null,
              voidReason: strOrNull(inv.voidReason),
              note: `${note ? note + ' · ' : ''}${tag} شماره اصلی ${originalNo}`
            }
          })
          await insertRows(tx, 'saleInvoice', data, inserted)
        })

        // --- اقلام فاکتور فروش ---
        await eachChunk(src, 'SaleInvoiceItem', async (rows) => {
          const data: any[] = []
          for (const it of rows) {
            const invoiceId = invoiceMap.get(num(it.invoiceId))
            const variantId = variantMap.get(num(it.variantId))
            if (!invoiceId || !variantId) continue
            const id = takeId('SaleInvoiceItem')
            saleItemMap.set(num(it.id), id)
            data.push({
              id,
              invoiceId,
              variantId,
              qty: num(it.qty),
              unitPrice: rial(it.unitPrice),
              discount: rial(it.discount),
              tax: rial(it.tax),
              lineTotal: rial(it.lineTotal)
            })
          }
          await insertRows(tx, 'saleInvoiceItem', data, inserted)
        })

        // --- دریافتی‌ها ---
        await eachChunk(src, 'Payment', async (rows) => {
          const data: any[] = []
          for (const p of rows) {
            const invoiceId = invoiceMap.get(num(p.invoiceId))
            const methodId = methodMap.get(num(p.methodId))
            if (!invoiceId || !methodId) continue
            const id = takeId('Payment')
            paymentMap.set(num(p.id), id)
            data.push({
              id,
              invoiceId,
              methodId,
              amount: rial(p.amount),
              reference: strOrNull(p.reference),
              paidAt: date(p.paidAt),
              createdAt: date(p.createdAt, date(p.paidAt)),
              createdByUserId: p.createdByUserId != null ? userMap.get(num(p.createdByUserId)) ?? null : null,
              createdShiftId: p.createdShiftId != null ? shiftMap.get(num(p.createdShiftId)) ?? null : null,
              clearedShiftId: p.clearedShiftId != null ? shiftMap.get(num(p.clearedShiftId)) ?? null : null,
              clearedByUserId: p.clearedByUserId != null ? userMap.get(num(p.clearedByUserId)) ?? null : null,
              kind: str(p.kind, 'CASH'),
              seq: num(p.seq, 1),
              paidAtJalali: strOrNull(p.paidAtJalali),
              paidAtTime: strOrNull(p.paidAtTime),
              note: strOrNull(p.note),
              chequeNo: strOrNull(p.chequeNo),
              bankName: strOrNull(p.bankName),
              dueDate: dateOrNull(p.dueDate),
              dueDateJalali: strOrNull(p.dueDateJalali),
              chequeStatus: strOrNull(p.chequeStatus),
              clearedAt: dateOrNull(p.clearedAt),
              clearedAtJalali: strOrNull(p.clearedAtJalali),
              overpayAmount: rial(p.overpayAmount),
              destination: strOrNull(p.destination),
              voidedAt: dateOrNull(p.voidedAt),
              voidedByUserId: p.voidedByUserId != null ? userMap.get(num(p.voidedByUserId)) ?? null : null,
              voidReason: strOrNull(p.voidReason)
            })
          }
          await insertRows(tx, 'payment', data, inserted)
        })

        // --- دفتر append-only وضعیت چک ---
        await eachChunk(src, 'PaymentChequeStatusHistory', async (rows) => {
          const data: any[] = []
          for (const history of rows) {
            const paymentId = paymentMap.get(num(history.paymentId))
            // سابقه‌ی چک بدون Payment متناظر سند مالی معتبری نیست؛ skip کردن آن
            // چیزی را نصفه وارد می‌کرد، پس کل merge rollback می‌شود.
            if (!paymentId)
              throw new BusinessError('سابقه‌ی وضعیت چک در بکاپ به پرداختی ناموجود وصل است؛ ادغام انجام نشد.')
            data.push({
              id: takeId('PaymentChequeStatusHistory'),
              paymentId,
              status: str(history.status, 'PENDING'),
              destination: strOrNull(history.destination),
              clearedAt: dateOrNull(history.clearedAt),
              clearedAtJalali: strOrNull(history.clearedAtJalali),
              clearedShiftId:
                history.clearedShiftId != null ? shiftMap.get(num(history.clearedShiftId)) ?? null : null,
              userId: history.userId != null ? userMap.get(num(history.userId)) ?? null : null,
              changedAt: date(history.changedAt),
              changedAtJalali: strOrNull(history.changedAtJalali)
            })
          }
          await insertRows(tx, 'paymentChequeStatusHistory', data, inserted)
        })

        // --- برگشت از فروش ---
        await eachChunk(src, 'SaleReturn', async (rows) => {
          const data: any[] = []
          for (const r of rows) {
            const invoiceId = invoiceMap.get(num(r.invoiceId))
            if (!invoiceId) continue
            const id = takeId('SaleReturn')
            returnMap.set(num(r.id), id)
            data.push({
              id,
              invoiceId,
              isFull: bool(r.isFull),
              total: rial(r.total),
              returnedAt: date(r.returnedAt),
              returnedAtJalali: str(r.returnedAtJalali, stamp),
              returnedAtTime: str(r.returnedAtTime, ''),
              kind: str(r.kind, 'RETURN'),
              exchangeInvoiceId: r.exchangeInvoiceId != null ? invoiceMap.get(num(r.exchangeInvoiceId)) ?? null : null,
              exchangeReceiptNo: intOrNull(r.exchangeReceiptNo),
              exchangeTotal: rial(r.exchangeTotal),
              exchangeDiff: rial(r.exchangeDiff),
              exchangeSettlement: strOrNull(r.exchangeSettlement),
              storeCreditCode: strOrNull(r.storeCreditCode),
              userId: r.userId != null ? userMap.get(num(r.userId)) ?? null : null,
              shiftId: r.shiftId != null ? shiftMap.get(num(r.shiftId)) ?? null : null,
              hasRemovedItems: bool(r.hasRemovedItems),
              note: strOrNull(r.note),
              refundMethod: strOrNull(r.refundMethod),
              refundAmount: rial(r.refundAmount),
              debtReduction: rial(r.debtReduction),
              voidedAt: dateOrNull(r.voidedAt),
              voidedByUserId: r.voidedByUserId != null ? userMap.get(num(r.voidedByUserId)) ?? null : null,
              voidReason: strOrNull(r.voidReason)
            })
          }
          await insertRows(tx, 'saleReturn', data, inserted)
        })

        await eachChunk(src, 'SaleReturnItem', async (rows) => {
          const data: any[] = []
          for (const it of rows) {
            const returnId = returnMap.get(num(it.returnId))
            const saleItemId = saleItemMap.get(num(it.saleItemId))
            const variantId = variantMap.get(num(it.variantId))
            if (!returnId || !saleItemId || !variantId) continue
            data.push({
              id: takeId('SaleReturnItem'),
              returnId,
              saleItemId,
              variantId,
              qty: num(it.qty),
              unitPrice: rial(it.unitPrice),
              lineTotal: rial(it.lineTotal),
              removedFromStock: bool(it.removedFromStock),
              restockedQty: num(it.restockedQty)
            })
          }
          await insertRows(tx, 'saleReturnItem', data, inserted)
        })

        /**
         * --- درخواست‌های کارت‌به‌کارت ---
         * این‌ها دفتر مستقل «پول پرداخت‌شده/در انتظار» هستند و هیچ CashMovement
         * ندارند؛ حذفشان در merge، بدهی پرداخت‌نشده یا پرداخت مدیر را ناپدید
         * می‌کرد. ابتدا همه IDها تخصیص می‌گیرند تا adjustment به ردیف اصلیِ
         * بازشماره‌گذاری‌شده وصل شود، حتی اگر ترتیب ردیف‌ها برعکس باشد.
         */
        const cardTransferRows = await readAll(src, 'CardTransferRequest')
        const cardTransferMap = new Map<number, number>()
        for (const row of cardTransferRows) cardTransferMap.set(num(row.id), takeId('CardTransferRequest'))
        for (const row of cardTransferRows) {
          const id = cardTransferMap.get(num(row.id)) as number
          const returnId = returnMap.get(num(row.returnId))
          if (!returnId)
            throw new BusinessError('درخواست کارت‌به‌کارت در بکاپ به سند برگشت ناموجود وصل است؛ ادغام انجام نشد.')
          const adjustsRequestId =
            row.adjustsRequestId != null ? cardTransferMap.get(num(row.adjustsRequestId)) ?? null : null
          if (row.adjustsRequestId != null && !adjustsRequestId)
            throw new BusinessError('اصلاح کارت‌به‌کارت در بکاپ به درخواست اصلی ناموجود وصل است؛ ادغام انجام نشد.')
          await tx.cardTransferRequest.create({
            data: {
              id,
              kind: str(row.kind, 'REQUEST'),
              status: str(row.status, 'PENDING'),
              operationKind: str(row.operationKind, 'RETURN'),
              returnId,
              sourceInvoiceId: row.sourceInvoiceId != null ? invoiceMap.get(num(row.sourceInvoiceId)) ?? null : null,
              sourceReceiptNo: intOrNull(row.sourceReceiptNo),
              exchangeInvoiceId: row.exchangeInvoiceId != null ? invoiceMap.get(num(row.exchangeInvoiceId)) ?? null : null,
              exchangeReceiptNo: intOrNull(row.exchangeReceiptNo),
              invoiceTotal: rial(row.invoiceTotal),
              returnTotal: rial(row.returnTotal),
              amount: rial(row.amount),
              itemsJson: strOrNull(row.itemsJson),
              stockNote: strOrNull(row.stockNote),
              userId: row.userId != null ? userMap.get(num(row.userId)) ?? null : null,
              userName: strOrNull(row.userName),
              shiftId: row.shiftId != null ? shiftMap.get(num(row.shiftId)) ?? null : null,
              shiftName: strOrNull(row.shiftName),
              createdAt: date(row.createdAt),
              createdAtJalali: str(row.createdAtJalali, stamp),
              createdAtTime: str(row.createdAtTime, ''),
              paidAmount: rialOrNull(row.paidAmount),
              paidAt: dateOrNull(row.paidAt),
              paidAtJalali: strOrNull(row.paidAtJalali),
              paidAtTime: strOrNull(row.paidAtTime),
              paidMethod: strOrNull(row.paidMethod),
              trackingNo: strOrNull(row.trackingNo),
              paidByUserId: row.paidByUserId != null ? userMap.get(num(row.paidByUserId)) ?? null : null,
              paidByUserName: strOrNull(row.paidByUserName),
              paidShiftId: row.paidShiftId != null ? shiftMap.get(num(row.paidShiftId)) ?? null : null,
              paidShiftName: strOrNull(row.paidShiftName),
              canceledAt: dateOrNull(row.canceledAt),
              cancelReason: strOrNull(row.cancelReason),
              stockReleasedAt: dateOrNull(row.stockReleasedAt),
              stockReleasedQty: intOrNull(row.stockReleasedQty),
              adjustsRequestId,
              adjustReason: strOrNull(row.adjustReason),
              note: strOrNull(row.note)
            }
          })
          bump(inserted, 'CardTransferRequest')
        }

        // --- فاکتور خرید (شماره فاکتور دوباره شماره‌گذاری می‌شود) ---
        const purchaseMap = new Map<number, number>()
        await eachChunk(src, 'PurchaseInvoice', async (rows) => {
          const data = rows.map((p) => {
            const id = takeId('PurchaseInvoice')
            purchaseMap.set(num(p.id), id)
            const note = strOrNull(p.note)
            return {
              id,
              invoiceNo: purchaseNo++,
              supplierId: p.supplierId != null ? supplierMap.get(num(p.supplierId)) ?? null : null,
              issuedAt: date(p.issuedAt),
              issuedAtJalali: str(p.issuedAtJalali, stamp),
              goodsTotal: rial(p.goodsTotal),
              discountTotal: rial(p.discountTotal),
              grandTotal: rial(p.grandTotal),
              paidTotal: rial(p.paidTotal),
              settlementType: str(p.settlementType, 'CASH'),
              status: str(p.status, 'CONFIRMED'),
              note: `${note ? note + ' · ' : ''}${tag} شماره اصلی ${num(p.invoiceNo)}`
            }
          })
          await insertRows(tx, 'purchaseInvoice', data, inserted)
        })

        await eachChunk(src, 'PurchaseInvoiceItem', async (rows) => {
          const data: any[] = []
          for (const it of rows) {
            const invoiceId = purchaseMap.get(num(it.invoiceId))
            const variantId = variantMap.get(num(it.variantId))
            if (!invoiceId || !variantId) continue
            data.push({
              id: takeId('PurchaseInvoiceItem'),
              invoiceId,
              variantId,
              warehouseId: it.warehouseId != null ? warehouseMap.get(num(it.warehouseId)) ?? null : null,
              qty: num(it.qty),
              unitPrice: rial(it.unitPrice),
              lineTotal: rial(it.lineTotal)
            })
          }
          await insertRows(tx, 'purchaseInvoiceItem', data, inserted)
        })

        // --- حرکات انبار: فقط سند تاریخی؛ فیلد stock هیچ واریانتی عوض نمی‌شود ---
        await eachChunk(src, 'StockMovement', async (rows) => {
          const data: any[] = []
          for (const m of rows) {
            const variantId = variantMap.get(num(m.variantId))
            if (!variantId) continue
            const refType = strOrNull(m.refType)
            const refIdSrc = intOrNull(m.refId)
            let refId: number | null = null
            if (refIdSrc != null) {
              if (refType === 'SaleInvoice') refId = invoiceMap.get(refIdSrc) ?? null
              else if (refType === 'PurchaseInvoice') refId = purchaseMap.get(refIdSrc) ?? null
              else if (refType === 'SaleReturn') refId = returnMap.get(refIdSrc) ?? null
            }
            data.push({
              id: takeId('StockMovement'),
              variantId,
              warehouseId: m.warehouseId != null ? warehouseMap.get(num(m.warehouseId)) ?? null : null,
              delta: num(m.delta),
              reason: str(m.reason, 'ADJUSTMENT'),
              state: str(m.state, 'FINAL'),
              refType,
              refId,
              consolidationId:
                m.consolidationId != null ? consolidationMap.get(num(m.consolidationId)) ?? null : null,
              note: `${strOrNull(m.note) ? m.note + ' · ' : ''}${tag} فقط سند تاریخی (موجودی فعلی تغییر نکرد)`,
              createdAt: date(m.createdAt)
            })
          }
          await insertRows(tx, 'stockMovement', data, inserted)
        })

        /**
         * --- دفتر گردش نقدی ---
         *
         * این جدول صرفاً cache گزارش نیست: موجودی اول، واریز، برداشت و پرداخت
         * نقدیِ برگشت‌ها فقط همین‌جا append-only ثبت می‌شوند و expectedCash از آن
         * ساخته می‌شود. حذف خاموش آن در merge، صورت صندوقِ بایگانی را دروغ می‌کرد.
         *
         * بعضی refها (اصلاح برگشت/حضانتی) هنوز در merge منتقل نمی‌شوند؛ برای آن
         * موارد refId را null می‌کنیم، اما نوع، مبلغ، زمان و توضیح سند مالی را
         * نگه می‌داریم و شناسه‌ی مبدأ را در note می‌نویسیم تا به یک سند مقصدِ
         * اشتباه وصل نشود.
         */
        await eachChunk(src, 'CashMovement', async (rows) => {
          const data: any[] = []
          for (const movement of rows) {
            const refType = strOrNull(movement.refType)
            const sourceRefId = intOrNull(movement.refId)
            let refId: number | null = null
            if (sourceRefId != null) {
              if (refType === 'SaleInvoice') refId = invoiceMap.get(sourceRefId) ?? null
              else if (refType === 'SaleReturn') refId = returnMap.get(sourceRefId) ?? null
              else if (refType === 'Payment') refId = paymentMap.get(sourceRefId) ?? null
              else if (refType === 'PurchaseInvoice') refId = purchaseMap.get(sourceRefId) ?? null
            }
            const refNote = sourceRefId != null && refId == null ? ` · ${tag} مرجع مبدأ ${refType ?? '—'}#${sourceRefId}` : ''
            data.push({
              id: takeId('CashMovement'),
              amount: rial(movement.amount),
              type: str(movement.type, 'CASH_IN'),
              occurredAt: date(movement.occurredAt),
              occurredAtJalali: strOrNull(movement.occurredAtJalali),
              occurredAtTime: strOrNull(movement.occurredAtTime),
              shiftId: movement.shiftId != null ? shiftMap.get(num(movement.shiftId)) ?? null : null,
              userId: movement.userId != null ? userMap.get(num(movement.userId)) ?? null : null,
              description: `${strOrNull(movement.description) ?? ''}${refNote}` || null,
              refType,
              refId,
              // AuditLog در انتهای merge ساخته می‌شود و این scalar FK نیست؛ لینک
              // مبدأ را به ID نامعتبر مقصد تبدیل نمی‌کنیم.
              auditLogId: null,
              createdAt: date(movement.createdAt, date(movement.occurredAt))
            })
          }
          await insertRows(tx, 'cashMovement', data, inserted)
        })

        // --- AuditLog: entityId بکاپ در دیتابیس جدید معنایی ندارد ⇒ null ---
        await eachChunk(src, 'AuditLog', async (rows) => {
          const data = rows.map((a) => ({
            id: takeId('AuditLog'),
            at: date(a.at),
            userId: a.userId != null ? userMap.get(num(a.userId)) ?? null : null,
            action: str(a.action, 'IMPORTED'),
            entity: str(a.entity, 'Unknown'),
            entityId: null,
            before: strOrNull(a.before),
            after: strOrNull(a.after),
            note: `${strOrNull(a.note) ? a.note + ' · ' : ''}${tag} شناسه‌ی اصلی ${intOrNull(a.entityId) ?? '—'}`
          }))
          await insertRows(tx, 'auditLog', data, inserted)
        })
      },
      { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 }
    )

    if (invoiceMap.size) await bumpReceiptSeq(prisma as any, receiptNo - 1)

    const report: MergeReport = {
      fileName,
      inserted,
      matched,
      renumbered: {
        invoices: invoiceMap.size,
        purchases: inserted.purchaseInvoice ?? 0,
        firstReceiptNo: invoiceMap.size ? firstReceiptNo : null,
        lastReceiptNo: invoiceMap.size ? receiptNo - 1 : null
      },
      warnings: [...new Set(warnings)].slice(0, 50),
      ms: Date.now() - started
    }

    await audit(prisma, {
      action: AuditAction.BACKUP_MERGE,
      entity: 'Backup',
      userId: input.userId ?? null,
      after: JSON.stringify(report),
      note: `ادغام بکاپ «${fileName}» با داده‌ی فعلی`
    })
    return report
  } finally {
    await src.$disconnect().catch(() => {})
    await unlink(tmp).catch(() => {})
  }
}
