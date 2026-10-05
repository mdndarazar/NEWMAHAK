import { app } from 'electron'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { prisma, databaseFile } from './client'

/**
 * ---------------------------------------------------------------------------
 * اجراکننده‌ی migration های Prisma، داخل خود برنامه.
 *
 * چرا اینجا و نه `prisma migrate deploy`؟
 * نسخه‌ی قبلی فقط وقتی `app.isPackaged` بود migration اجرا می‌کرد، یعنی در حالت
 * توسعه (dev) دیتابیس واقعی shop.db همیشه از schema.prisma عقب می‌ماند. نتیجه
 * همان کلاس باگی بود که خطای «The column main.SaleInvoice.deductInventory does
 * not exist» را می‌ساخت. حالا:
 *
 *   • در هر دو حالت dev و packaged، قبل از اولین کوئری Prisma اجرا می‌شود.
 *   • به CLI و subprocess نیازی ندارد (فقط SQL خام)، پس در dev هم قابل اتکاست.
 *   • جدول `_prisma_migrations` را عیناً با ساختار خود Prisma می‌سازد و پر
 *     می‌کند (id/checksum/finished_at/...)، پس `prisma migrate` واقعی هم بعداً
 *     با همین تاریخ سازگار است و migration ها را دوباره اجرا نمی‌کند.
 *
 * baselining دیتابیس‌های موجود:
 * دیتابیس فعلی شما از قبل داده دارد ولی جدول `_prisma_migrations` ندارد. اگر
 * migration پایه (`0_init`) روی آن اجرا می‌شد، به خطای «table already exists»
 * می‌خورد. پس اگر جداول اصلی از قبل وجود داشته باشند و هیچ migration ای ثبت
 * نشده باشد، `0_init` فقط «اعمال‌شده» علامت می‌خورد و اجرا نمی‌شود — دقیقاً
 * کاری که `prisma migrate resolve --applied 0_init` می‌کند. هیچ داده‌ای لمس
 * نمی‌شود و migration های بعدی عادی اجرا می‌شوند.
 * ---------------------------------------------------------------------------
 */

/** نام migration پایه؛ فقط این یکی قابل baseline شدن است. */
const BASELINE = '0_init'

/** جدولی که وجودش نشانه‌ی «دیتابیس از قبل ساخته شده است» است. */
const SENTINEL_TABLES = ['SaleInvoice', 'ProductVariant', 'Product']

/** baselining فقط با حضور *همه‌ی* جدول‌های نشانه — وگرنه `0_init` باید اجرا شود. */
export function shouldBaseline(tables: Set<string>): boolean {
  return SENTINEL_TABLES.every((t) => tables.has(t))
}

export interface MigrationReport {
  /** migration هایی که همین حالا روی دیتابیس اجرا شدند */
  applied: string[]
  /** migration هایی که «قبلاً اعمال‌شده» علامت خوردند (دیتابیس موجود) */
  baselined: string[]
  /** جمله‌هایی که چون از قبل اعمال شده بودند رد شدند (مثلاً ستون تکراری) */
  skipped: string[]
  databaseFile: string
  migrationsDir: string | null
}

/** DDL دقیق جدول تاریخ migration ها در Prisma (نسخه‌ی SQLite). */
const PRISMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`

/**
 * پیدا کردن پوشه‌ی migrations در هر دو حالت.
 * dev: ریشه‌ی پروژه · packaged: resources (طبق extraResources در package.json)
 */
export function findMigrationsDir(): string | null {
  const roots = [
    process.resourcesPath ? join(process.resourcesPath, 'prisma', 'migrations') : null,
    join(app.getAppPath(), 'prisma', 'migrations'),
    join(app.getAppPath(), '..', 'prisma', 'migrations'),
    join(process.cwd(), 'prisma', 'migrations')
  ].filter(Boolean) as string[]
  for (const dir of roots) {
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir
    } catch {
      /* مسیر بعدی */
    }
  }
  return null
}

/** پوشه‌های migration به ترتیب نام (همان ترتیبی که Prisma اعمال می‌کند). */
function listMigrations(dir: string): { name: string; sql: string; checksum: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(dir, name, 'migration.sql')))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => {
      const raw = readFileSync(join(dir, name, 'migration.sql'))
      return {
        name,
        sql: raw.toString('utf8'),
        // همان الگوریتم Prisma: sha256 محتوای فایل، hex
        checksum: createHash('sha256').update(raw).digest('hex')
      }
    })
}

/**
 * تقسیم فایل migration به جمله‌های SQL.
 * کامنت‌های `--` و `/* *\/` و رشته‌های داخل کوتیشن در نظر گرفته می‌شوند تا یک
 * سمی‌کالن داخل متن فارسی یا داخل کامنت، جمله را نصف نکند.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    // کامنت خطی
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    // کامنت بلوکی
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    // رشته یا شناسه‌ی کوتیشن‌دار: بی‌کم‌و‌کاست کپی می‌شود
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      cur += c
      i++
      while (i < n) {
        cur += sql[i]
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            cur += sql[i + 1]
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * خطاهایی که یعنی «این تغییر از قبل روی دیتابیس هست».
 * مثلاً اگر کاربر قبلاً فایل fallback دستی prisma/manual را اجرا کرده باشد.
 * این‌ها نباید برنامه را زمین بزنند.
 */
function isAlreadyApplied(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('duplicate column name') ||
    m.includes('already exists') ||
    m.includes('already has a column')
  )
}

/**
 * حداقل چیزی که برای اجرای migration لازم است.
 * چرا رابط جدا و نه خودِ PrismaClient؟ چون همین اجراکننده برای *فایل بکاپ* هم
 * استفاده می‌شود (وقتی بکاپ سال‌های قبل ساختار قدیمی‌تری دارد): یک کلاینت موقت
 * روی آن فایل ساخته می‌شود و migration ها روی همان اجرا می‌گردند، بدون این‌که
 * دیتابیس اصلی لمس شود.
 */
export interface RawSqlClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

async function tableNames(client: RawSqlClient): Promise<Set<string>> {
  const rows = await client.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )
  return new Set((rows ?? []).map((r) => String(r.name)))
}

/** فایل خالیِ SQLite یک دیتابیس خالیِ معتبر است؛ پس فقط لمسش می‌کنیم. */
function ensureDatabaseFile(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  if (!existsSync(file)) writeFileSync(file, '')
}

/**
 * اجرای همه‌ی migration های اعمال‌نشده.
 * در صورت شکست، خطایی با پیام فارسی و قابل‌فهم پرتاب می‌کند (نه stack خام Prisma).
 */
export async function runMigrations(): Promise<MigrationReport> {
  return applyMigrations(prisma, databaseFile())
}

/**
 * همان کار، ولی روی هر کلاینت/فایل دلخواه (دیتابیس اصلی یا یک فایل بکاپ).
 * `touchFile: false` وقتی فایل از قبل وجود دارد و نباید ساخته شود.
 */
export async function applyMigrations(
  client: RawSqlClient,
  file: string,
  opts: { touchFile?: boolean } = {}
): Promise<MigrationReport> {
  const dir = findMigrationsDir()
  const report: MigrationReport = {
    applied: [],
    baselined: [],
    skipped: [],
    databaseFile: file,
    migrationsDir: dir
  }

  if (opts.touchFile !== false) ensureDatabaseFile(file)

  if (!dir) {
    throw new Error(
      'پوشه‌ی prisma/migrations پیدا نشد، پس ساختار دیتابیس قابل به‌روزرسانی نیست. ' +
        'اگر برنامه را از سورس اجرا می‌کنید مطمئن شوید پوشه‌ی prisma کنار برنامه وجود دارد.'
    )
  }

  const migrations = listMigrations(dir)
  if (!migrations.length) return report

  await client.$executeRawUnsafe(PRISMA_MIGRATIONS_DDL)

  const doneRows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  )
  const done = new Set((doneRows ?? []).map((r) => String(r.migration_name)))

  // ---- baselining دیتابیس موجود ----
  if (!done.size) {
    const tables = await tableNames(client)
    /**
     * نشست ۱۹۰ — baselining فقط وقتی *همه‌ی* جدول‌های نشانه هستند.
     * وجود تنها یکی (مثلاً Product بدون SaleInvoice) یعنی دیتابیس ناقص است و
     * رد کردن `0_init` ساختار را برای همیشه ناقص می‌گذارد.
     */
    const looksExisting = shouldBaseline(tables)
    if (looksExisting) {
      const base = migrations.find((m) => m.name === BASELINE) ?? migrations[0]
      await markApplied(client, base.name, base.checksum, 0)
      done.add(base.name)
      report.baselined.push(base.name)
    }
  }

  // ---- اجرای migration های باقی‌مانده ----
  for (const m of migrations) {
    if (done.has(m.name)) continue
    const statements = splitStatements(m.sql)
    let ran = 0
    let inTx = false
    try {
      try {
        await client.$executeRawUnsafe('BEGIN IMMEDIATE')
        inTx = true
      } catch {
        inTx = false
      }
      for (const stmt of statements) {
        try {
          await client.$executeRawUnsafe(stmt)
          ran++
        } catch (e: any) {
          const msg = String(e?.message ?? e)
          if (isAlreadyApplied(msg)) {
            report.skipped.push(`${m.name}: ${firstLine(stmt)}`)
            continue
          }
          throw e
        }
      }
      await markApplied(client, m.name, m.checksum, ran)
      if (inTx) {
        await client.$executeRawUnsafe('COMMIT')
        inTx = false
      }
    } catch (e: any) {
      if (inTx) await client.$executeRawUnsafe('ROLLBACK').catch(() => {})
      throw new Error(
        `به‌روزرسانی ساختار دیتابیس در مرحله‌ی «${m.name}» ناموفق بود و ناتمام ماند.\n` +
          `فایل دیتابیس: ${file}\n` +
          `جزئیات فنی: ${String(e?.message ?? e).split('\n')[0]}\n\n` +
          'پیشنهاد: از فایل دیتابیس یک نسخه‌ی پشتیبان بگیرید و دوباره برنامه را باز کنید. ' +
          'اگر مشکل تکرار شد، متن همین پیام را نگه دارید.'
      )
    }
    report.applied.push(m.name)
  }

  return report
}

function firstLine(s: string): string {
  return s.split('\n')[0].slice(0, 120)
}

async function markApplied(client: RawSqlClient, name: string, checksum: string, steps: number): Promise<void> {
  await client.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
     VALUES (?, ?, current_timestamp, ?, NULL, NULL, current_timestamp, ?)`,
    randomUUID(),
    checksum,
    name,
    steps
  )
}
