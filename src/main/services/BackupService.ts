import { app, dialog, BrowserWindow } from 'electron'
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve as resolvePath, sep } from 'node:path'
import { prisma, databaseFile } from '../db/client'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import { mergeBackup, summarizeBackup } from './MergeService'
import { AuditAction } from '@shared/enums'
import { SETTING_KEYS, parseBackupConfig, type BackupConfig } from '@shared/receipt'
import { toJalaliDate, toClock } from '@shared/jalali'
import type { BackupEntry, MergeReport } from '@shared/types'
import { assertPanelPasswordStrict } from './AuthService'
import { PANEL_KEYS } from '@shared/panels'

/**
 * ===========================================================================
 * بکاپ و بازگردانی.
 *
 *   • بکاپ خودکار روزانه (`scheduleBackup`) — مثل قبل، در userData/backups.
 *   • «تهیه بکاپ» دستی: پنجره‌ی ذخیره‌ی ویندوز باز می‌شود و فایل دیتابیس همان‌جا
 *     کپی می‌گردد (Cancel = هیچ فایلی ساخته نمی‌شود).
 *   • «بازگردانی از بکاپ»: فایل با پنجره‌ی باز کردن ویندوز انتخاب و در پوشه‌ی
 *     backups/imported نگه داشته می‌شود (فایل اصلی شما دست‌نخورده می‌ماند)، بعد
 *     با یکی از دو حالت اعمال می‌شود:
 *       جایگزینی کامل → داده‌ی فعلی کنار گذاشته می‌شود و همین بکاپ می‌نشیند.
 *                        (قبلش یک بکاپ ایمنی از وضعیت فعلی گرفته می‌شود.)
 *       ادغام          → داده‌ی بکاپ به داده‌ی فعلی *اضافه* می‌شود، بدون پاک
 *                        کردن چیزی؛ گزارش‌ها هر دو را با هم نشان می‌دهند.
 *                        (منطق ادغام و شماره‌گذاری دوباره: MergeService.ts)
 *
 * فهرست بکاپ‌ها (`list`) هم فایل‌های خودکار را نشان می‌دهد و هم آنچه خودتان
 * وارد کرده‌اید؛ تاریخ شمسی، حجم فایل و این‌که قبلاً اعمال شده یا نه.
 * ===========================================================================
 */

const KEEP_DAYS = 30
/** هر ۶ ساعت یک بار *بررسی* می‌شود؛ خودِ بکاپ طبق بازه‌ی تنظیمات گرفته می‌شود. */
const CHECK_MS = 6 * 60 * 60 * 1000

const backupsDir = () => join(app.getPath('userData'), 'backups')
const importedDir = () => join(backupsDir(), 'imported')

function stamp(d = new Date()): string {
  return `${toJalaliDate(d).replace(/\//g, '-')}_${toClock(d).replace(/:/g, '-')}`
}

// ---------------------------------------------------------------------------
// تنظیمات بکاپ خودکار (مورد ۶): مسیر ذخیره‌سازی + بازه‌ی زمانی + تعداد نسخه
// ---------------------------------------------------------------------------

/** خواندن تنظیمات بکاپ خودکار (خرابی یا نبودن مقدار = پیش‌فرض روزانه). */
export async function readBackupConfig(): Promise<BackupConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.backupConfig } })
    return parseBackupConfig(row?.value)
  } catch {
    return parseBackupConfig(null)
  }
}

async function writeBackupConfig(config: BackupConfig): Promise<BackupConfig> {
  const clean = parseBackupConfig(config)
  const value = JSON.stringify(clean)
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.backupConfig },
    update: { value },
    create: { key: SETTING_KEYS.backupConfig, value }
  })
  return clean
}

/**
 * پوشه‌ی بکاپ خودکار: مسیر انتخابی مدیر، وگرنه پوشه‌ی داخلی برنامه.
 * اگر مسیر انتخابی قابل ساخت/نوشتن نباشد، بی‌صدا به پوشه‌ی داخلی برمی‌گردیم تا
 * «بکاپ خودکار» به‌خاطر یک فلش جدا‌شده هیچ‌وقت متوقف نشود.
 */
async function resolveAutoDir(config: BackupConfig): Promise<{ dir: string; fallback: boolean }> {
  const wanted = String(config.autoDir ?? '').trim()
  if (wanted) {
    try {
      await mkdir(wanted, { recursive: true })
      return { dir: wanted, fallback: false }
    } catch (e) {
      console.error('[backup] custom dir not usable, falling back', wanted, e)
    }
  }
  const dir = backupsDir()
  await mkdir(dir, { recursive: true })
  return { dir, fallback: !!wanted }
}

/**
 * پشتیبان‌گیری خودکار از فایل SQLite.
 *
 * `scheduled: true` (زمان‌بند برنامه) ⇒ بازه‌ی تنظیمات رعایت می‌شود: اگر از
 * آخرین بکاپ خودکار کمتر از `everyDays` روز گذشته باشد، هیچ فایلی ساخته
 * نمی‌شود (و `everyDays = 0` یعنی بکاپ خودکار خاموش است).
 * بدون این پرچم (بکاپ دستی / قبل از پاک‌سازی) همیشه بکاپ گرفته می‌شود.
 */
export async function runBackup(opts: { scheduled?: boolean } = {}): Promise<string | null> {
  const config = await readBackupConfig()
  if (opts.scheduled) {
    if (config.everyDays <= 0) return null
    const last = config.lastAutoAt ? new Date(config.lastAutoAt).getTime() : 0
    if (last && Date.now() - last < config.everyDays * 24 * 60 * 60 * 1000) return null
  }

  const { dir } = await resolveAutoDir(config)
  const target = join(dir, `shop-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`)
  // WAL را داخل فایل اصلی بنویس تا کپی، یک دیتابیس کامل باشد
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => null)
  await copyFile(databaseFile(), target)

  // نگه‌داشتن فقط n نسخه‌ی آخر (در همان پوشه‌ای که بکاپ آنجا ساخته شد)
  const keep = Math.max(1, config.keep || KEEP_DAYS)
  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter((f) => f.endsWith('.db') && f.startsWith('shop-'))
    .sort()
  while (files.length > keep) {
    const old = files.shift()
    if (old) await unlink(join(dir, old)).catch(() => {})
  }

  if (opts.scheduled) await writeBackupConfig({ ...config, lastAutoAt: new Date().toISOString() }).catch(() => config)
  return target
}

/** بررسی هر ۶ ساعت + یک بار در استارت برنامه (بازه‌ی واقعی از تنظیمات است). */
export function scheduleBackup(): void {
  const tick = () =>
    runBackup({ scheduled: true })
      .then((p) => (p ? console.log('[backup] auto backup:', p) : undefined))
      .catch((e) => console.error('[backup] failed', e))
  tick()
  setInterval(tick, CHECK_MS)
}

// ---------------------------------------------------------------------------
// فهرست بکاپ‌های واردشده (روی جدول Setting، بدون migration)
// ---------------------------------------------------------------------------
interface LedgerRow {
  id: string
  fileName: string
  size: number
  at: string
  appliedAt?: string | null
  appliedMode?: 'replace' | 'merge' | null
}

async function readLedger(): Promise<LedgerRow[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.backupImports } })
    const parsed = row?.value ? JSON.parse(row.value) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeLedger(rows: LedgerRow[]): Promise<void> {
  const value = JSON.stringify(rows.slice(-200))
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.backupImports },
    update: { value },
    create: { key: SETTING_KEYS.backupImports, value }
  })
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

const DB_FILTER = { name: 'فایل بکاپ دیتابیس', extensions: ['db', 'sqlite', 'sqlite3', 'bak'] }

/**
 * شناسه‌ی backup فقط نام فایلی است که خودمان در فهرست ساخته‌ایم، نه مسیر.
 * هرچند IPC با preload عرضه می‌شود، renderer را نباید مرز امنیتی دانست: `../`
 * در شناسه‌ی مستقیم قبلاً می‌توانست resolve/forget را از backups بیرون ببرد.
 */
function safeBackupId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim())
    throw new BusinessError('شناسه‌ی فایل بکاپ نامعتبر است.')
  if (!/^[A-Za-z0-9._-]{1,240}$/.test(value) || value.includes('..') || basename(value) !== value)
    throw new BusinessError('شناسه‌ی فایل بکاپ نامعتبر است.')
  return value
}

/** یک نام فایلی را با کنترل canonical path زیر یک پوشه قرار می‌دهد. */
function backupChild(dir: string, id: string): string {
  const root = resolvePath(dir)
  const child = resolvePath(root, id)
  if (!child.startsWith(`${root}${sep}`)) throw new BusinessError('شناسه‌ی فایل بکاپ نامعتبر است.')
  return child
}

function isAutoBackupId(id: string): boolean {
  // تنها فایل‌هایی که خود زمان‌بند با این نام ساخته است می‌توانند بدون ledger
  // وارد restore/forget شوند. importedها برای restore حتماً ledger row می‌خواهند.
  return /^shop-[A-Za-z0-9._-]+\.db$/i.test(id)
}

function isImportedBackupId(id: string): boolean {
  // forget باید بتواند یک فایل imported باقی‌مانده از ledger قدیمی/خراب را هم
  // پاک کند، اما فقط زیر پوشه‌ی خصوصی imported و هرگز با یک path دلخواه.
  return /^imported-[A-Za-z0-9._-]+$/i.test(id)
}

async function autoBackupDirs(): Promise<string[]> {
  const dirs = [backupsDir()]
  const custom = String((await readBackupConfig()).autoDir ?? '').trim()
  if (custom && resolvePath(custom) !== resolvePath(backupsDir())) dirs.push(custom)
  return dirs
}

async function resolveListedBackup(idInput: unknown): Promise<string> {
  const id = safeBackupId(idInput)
  const ledger = await readLedger()

  // imported files never accept a renderer-controlled path: the ID must match
  // exactly a row written after importPick copied it into our private folder.
  if (ledger.some((row) => row.id === id)) {
    const imported = backupChild(importedDir(), id)
    if (existsSync(imported)) return imported
    throw new BusinessError('این فایل بکاپ روی دیسک پیدا نشد؛ ممکن است پاک یا جابه‌جا شده باشد.')
  }

  if (!isAutoBackupId(id))
    throw new BusinessError('این شناسه در فهرست بکاپ‌های قابل‌اعتماد وجود ندارد.')

  for (const dir of await autoBackupDirs()) {
    const candidate = backupChild(dir, id)
    if (existsSync(candidate)) return candidate
  }
  throw new BusinessError('این فایل بکاپ روی دیسک پیدا نشد؛ ممکن است پاک یا جابه‌جا شده باشد.')
}

function toEntry(row: LedgerRow, path: string, source: 'auto' | 'imported'): BackupEntry {
  const at = new Date(row.at)
  return {
    id: row.id,
    fileName: row.fileName,
    path,
    size: row.size,
    at: row.at,
    atJalali: `${toJalaliDate(isNaN(at.getTime()) ? new Date() : at)} ${toClock(
      isNaN(at.getTime()) ? new Date() : at,
      false
    )}`,
    source,
    appliedAt: row.appliedAt ?? null,
    appliedMode: row.appliedMode ?? null,
    missing: !existsSync(path)
  }
}

export const backupService = {
  /** «تهیه بکاپ» با انتخاب مسیر توسط کاربر. */
  async createManual(input: { userId?: number | null; managerPassword?: string | null } = {}) {
    // RE-AUDIT-HIGH-03: این خروجی یک کپی کاملِ قابل‌انتقال از دیتابیس مالی است؛
    // دیالوگ ویندوز گیت امنیتی نیست و IPC مستقیم نباید آن را دور بزند.
    const scope = await assertPanelPasswordStrict(
      PANEL_KEYS.settings,
      input?.managerPassword ?? null,
      'تهیه‌ی فایل بکاپ کامل در مسیر دلخواه'
    )
    const win = focusedWindow()
    const defaultPath = join(app.getPath('documents'), `پشتیبان-فروشگاه-${stamp()}.db`)
    const options = {
      title: 'فایل پشتیبان کجا ذخیره شود؟',
      defaultPath,
      buttonLabel: 'ذخیره‌ی بکاپ',
      filters: [DB_FILTER]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { canceled: true, path: null, size: 0 }

    let target = res.filePath
    if (!/\.(db|sqlite|sqlite3|bak)$/i.test(target)) target = `${target}.db`

    // چک‌پوینت: اگر WAL فعال باشد، هر چیزی که در ژورنال مانده اول داخل فایل اصلی
    // نوشته شود تا کپی، یک دیتابیس *کامل* باشد.
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => null)
    await copyFile(databaseFile(), target)
    const info = await stat(target)

    await audit(prisma, {
      action: AuditAction.BACKUP_CREATE,
      entity: 'Backup',
      userId: input.userId ?? null,
      after: JSON.stringify({ path: target, size: info.size, approvedBy: scope }),
      note: `تهیه‌ی بکاپ دستی با انتخاب مسیر (تأیید: ${scope})`
    })
    return { canceled: false, path: target, size: info.size }
  },

  /**
   * انتخاب یک فایل بکاپ از دیسک.
   * فایل به پوشه‌ی داخلی برنامه کپی می‌شود تا بعداً هم قابل اعمال باشد و فایل
   * اصلی شما (روی فلش یا هر جای دیگر) دست‌نخورده بماند.
   */
  async importPick() {
    const win = focusedWindow()
    const options = {
      title: 'فایل بکاپ را انتخاب کنید',
      buttonLabel: 'افزودن به فهرست',
      properties: ['openFile' as const],
      filters: [DB_FILTER]
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = res.filePaths?.[0]
    if (res.canceled || !picked) return { canceled: true, entry: null }

    const dir = importedDir()
    await mkdir(dir, { recursive: true })
    const id = `imported-${Date.now()}-${basename(picked).replace(/[^\w.\-]+/g, '_')}`
    const target = join(dir, id)
    await copyFile(picked, target)

    const info = await stat(target)
    // اعتبارسنجی سبک: اگر فایل، دیتابیس این برنامه نباشد همین‌جا رد می‌شود
    let summary: BackupEntry['summary'] = null
    try {
      summary = await summarizeBackup(target)
    } catch {
      await unlink(target).catch(() => {})
      throw new BusinessError('این فایل یک بکاپ معتبر از همین برنامه نیست و به فهرست اضافه نشد.')
    }

    const ledger = await readLedger()
    const row: LedgerRow = {
      id,
      fileName: basename(picked),
      size: info.size,
      at: new Date().toISOString(),
      appliedAt: null,
      appliedMode: null
    }
    ledger.push(row)
    await writeLedger(ledger)
    return { canceled: false, entry: { ...toEntry(row, target, 'imported'), summary } }
  },

  /**
   * فهرست بکاپ‌های قابل بازگردانی: واردشده‌ها + بکاپ‌های خودکار.
   * بکاپ‌های خودکار هم از پوشه‌ی داخلی برنامه خوانده می‌شوند و هم از مسیر
   * دلخواهی که مدیر در تنظیمات انتخاب کرده است (مورد ۶).
   */
  async list(): Promise<BackupEntry[]> {
    const out: BackupEntry[] = []

    for (const row of (await readLedger()).slice().reverse())
      out.push(toEntry(row, join(importedDir(), row.id), 'imported'))

    const config = await readBackupConfig()
    const dirs = [backupsDir()]
    const custom = String(config.autoDir ?? '').trim()
    if (custom && custom !== backupsDir()) dirs.push(custom)

    for (const dir of dirs) {
      try {
        const files = (await readdir(dir)).filter((f) => f.endsWith('.db') && f.startsWith('shop-')).sort().reverse()
        for (const f of files) {
          const path = join(dir, f)
          const info = await stat(path).catch(() => null)
          if (!info) continue
          out.push(
            toEntry({ id: f, fileName: f, size: info.size, at: info.mtime.toISOString() }, path, 'auto'),
          )
        }
      } catch {
        /* این پوشه هنوز ساخته نشده یا در دسترس نیست */
      }
    }
    out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    return out
  },

  /** تنظیمات بکاپ خودکار + مسیر واقعیِ در حال استفاده (برای نمایش در پنل). */
  async config(): Promise<BackupConfig & { effectiveDir: string; defaultDir: string; fallback: boolean }> {
    const config = await readBackupConfig()
    const { dir, fallback } = await resolveAutoDir(config).catch(() => ({ dir: backupsDir(), fallback: true }))
    return { ...config, effectiveDir: dir, defaultDir: backupsDir(), fallback }
  },

  /** ذخیره‌ی تنظیمات بکاپ خودکار (مسیر و بازه‌ی زمانی) — مورد ۶. */
  async saveConfig(
    input: Partial<BackupConfig> & { userId?: number | null; managerPassword?: string | null } = {}
  ) {
    /**
     * نشست ۲۰۶ — keep=1 نسخه‌های قدیمی را می‌چرخاند و پاک می‌کند. بدون گیت،
     * فروشنده مدرک قبل از دستکاری را از IPC مستقیم حذف می‌کرد. پنل تنظیمات
     * همیشه قفل است؛ رمز مدیر یا دوم/سوم همین پنل.
     */
    await assertPanelPasswordStrict(
      PANEL_KEYS.settings,
      input?.managerPassword ?? null,
      'تغییر تنظیمات بکاپ خودکار'
    )
    const before = await readBackupConfig()
    const next = parseBackupConfig({
      ...before,
      ...(input.autoDir !== undefined ? { autoDir: input.autoDir } : {}),
      ...(input.everyDays !== undefined ? { everyDays: input.everyDays } : {}),
      ...(input.keep !== undefined ? { keep: input.keep } : {})
    })
    // مسیر تازه باید همین حالا قابل ساخت باشد، وگرنه مدیر باید بداند
    if (next.autoDir) {
      try {
        await mkdir(next.autoDir, { recursive: true })
      } catch {
        throw new BusinessError(
          `پوشه‌ی «${next.autoDir}» ساخته یا باز نشد. مسیر دیگری انتخاب کنید (مثلاً پوشه‌ای روی درایو D یا فلش متصل).`
        )
      }
    }
    const saved = await writeBackupConfig(next)
    await audit(prisma, {
      action: AuditAction.SETTINGS_UPDATE,
      entity: 'Setting',
      userId: input.userId ?? null,
      before: JSON.stringify({ autoDir: before.autoDir, everyDays: before.everyDays, keep: before.keep }),
      after: JSON.stringify({ autoDir: saved.autoDir, everyDays: saved.everyDays, keep: saved.keep }),
      note: 'تنظیمات بکاپ خودکار (مسیر ذخیره‌سازی و بازه‌ی زمانی)'
    })
    return this.config()
  },

  /** انتخاب پوشه‌ی بکاپ خودکار با پنجره‌ی ویندوز (مورد ۶). */
  async pickAutoDir(input: { userId?: number | null; managerPassword?: string | null } = {}) {
    const win = focusedWindow()
    const current = await readBackupConfig()
    const options = {
      title: 'پوشه‌ی ذخیره‌ی بکاپ‌های خودکار را انتخاب کنید',
      buttonLabel: 'همین پوشه',
      defaultPath: current.autoDir || app.getPath('documents'),
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = res.filePaths?.[0]
    if (res.canceled || !picked) return { canceled: true, config: await this.config() }
    const config = await this.saveConfig({
      autoDir: picked,
      userId: input.userId ?? null,
      managerPassword: input.managerPassword ?? null
    })
    return { canceled: false, config }
  },

  /** «بکاپ فوری» در همان مسیر تنظیم‌شده (بدون پنجره‌ی ذخیره). */
  async runNow(input: { userId?: number | null; managerPassword?: string | null } = {}) {
    /**
     * RE-AUDIT-HIGH-03 — runBackup طبق `keep` نسخه‌های قبلی را حذف می‌کند؛ پس
     * این فقط «خواندن/کپی» نیست و بدون رمز می‌توانست مسیر دلخواه + keep=1 را
     * به پاک‌سازی اسناد تبدیل کند. زمان‌بند داخلی همچنان مستقیماً runBackup را
     * صدا می‌زند و نیازی به رمز ندارد؛ این گیت فقط IPC دستی است.
     */
    const scope = await assertPanelPasswordStrict(
      PANEL_KEYS.settings,
      input?.managerPassword ?? null,
      'تهیه‌ی بکاپ فوری و چرخش نسخه‌های قبلی'
    )
    const path = await runBackup()
    const info = path ? await stat(path).catch(() => null) : null
    await audit(prisma, {
      action: AuditAction.BACKUP_CREATE,
      entity: 'Backup',
      userId: input.userId ?? null,
      after: JSON.stringify({ path, size: info?.size ?? 0, approvedBy: scope, automatic: false }),
      note: `تهیه‌ی بکاپ فوری در مسیر تنظیم‌شده (تأیید: ${scope})`
    })
    return { path, size: info?.size ?? 0 }
  },

  /** خلاصه‌ی محتوای یک بکاپ (تعداد فاکتور، بازه‌ی تاریخ، جمع فروش). */
  async summary(input: { id: string }) {
    const path = await this.resolve(input?.id)
    return summarizeBackup(path)
  },

  /** مسیر فایل یک شناسه‌ی بکاپ (واردشده یا خودکار). */
  async resolve(id: string): Promise<string> {
    if (!id) throw new BusinessError('فایل بکاپ انتخاب نشده است.')
    return resolveListedBackup(id)
  },

  async markApplied(id: string, mode: 'replace' | 'merge'): Promise<void> {
    const ledger = await readLedger()
    const row = ledger.find((r) => r.id === id)
    if (!row) return
    row.appliedAt = new Date().toISOString()
    row.appliedMode = mode
    await writeLedger(ledger)
  },

  /** حذف یک بکاپ از فهرست (فایل داخلی هم پاک می‌شود). */
  async forget(input: { id: string; userId?: number | null; managerPassword?: string | null }) {
    const id = safeBackupId(input?.id)
    /**
     * نشست ۲۰۶ — بدون این گیت، فروشنده بکاپ قبل از دستکاری را از IPC پاک
     * می‌کرد و ردّ دزدی از بین می‌رفت. تأیید قبل از unlink.
     */
    await assertPanelPasswordStrict(
      PANEL_KEYS.settings,
      input?.managerPassword ?? null,
      'حذف فایل بکاپ از فهرست'
    )
    const ledger = await readLedger()
    const row = ledger.find((r) => r.id === id)
    const rest = ledger.filter((r) => r.id !== id)

    if (row || isImportedBackupId(id)) {
      // حتی imported باقی‌مانده از ledger قدیمی/خراب فقط از پوشه‌ی خصوصی خودش
      // حذف می‌شود؛ restore برعکس، همچنان وجود ledger را اجباری می‌کند.
      await unlink(backupChild(importedDir(), id)).catch(() => {})
      if (row) await writeLedger(rest)
    } else if (isAutoBackupId(id)) {
      // نام auto معتبر است، اما حتی برای آن هم فقط در پوشه‌های پیکربندی‌شده پاک
      // می‌کنیم؛ هرگز یک path رسیده از renderer را به unlink نمی‌دهیم.
      for (const dir of await autoBackupDirs()) await unlink(backupChild(dir, id)).catch(() => {})
    } else {
      throw new BusinessError('این شناسه در فهرست بکاپ‌های قابل‌اعتماد وجود ندارد.')
    }

    await audit(prisma, {
      action: AuditAction.BACKUP_FORGET,
      entity: 'Backup',
      userId: input.userId ?? null,
      before: JSON.stringify({ id, fileName: row?.fileName ?? id }),
      note: 'حذف فایل بکاپ از فهرست و دیسک'
    })
    return true
  },

  /**
   * اعمال یک بکاپ.
   *
   * mode = 'merge'   → ادغام با داده‌ی فعلی (MergeService)، بدون پاک کردن چیزی.
   * mode = 'replace' → جایگزینی کامل. قبلش یک بکاپ ایمنی از وضعیت فعلی گرفته
   *   می‌شود، بعد اتصال دیتابیس بسته و فایل بکاپ روی فایل اصلی کپی می‌گردد و
   *   برنامه خودش را دوباره باز می‌کند (تنها راه مطمئن برای این‌که هیچ کوئریِ
   *   نیمه‌کاره روی فایل قدیمی نماند).
   */
  async apply(input: {
    id: string
    mode: 'replace' | 'merge'
    userId?: number | null
    managerPassword?: string | null
  }): Promise<{ mode: 'replace' | 'merge'; report?: MergeReport; safetyBackup?: string; willRestart?: boolean }> {
    /**
     * 🔴 نشست ۱۸۱ — گیت رمز مدیر. تا پیش از این، مخرب‌ترین عملیات کل برنامه
     * هیچ گیتی نداشت:
     *   • `replace` کل دیتابیس زنده را با یک فایل دلخواه جایگزین می‌کند —
     *     یعنی هر سابقه‌ی فروش، پرداخت و AuditLog می‌تواند یک‌جا ناپدید شود.
     *   • `merge` داده‌ی دلخواه را به دفاتر مالی تزریق می‌کند.
     *
     * برای کسی که می‌خواهد ردّ دزدی را پاک کند، این کوتاه‌ترین مسیر بود: یک
     * بکاپ قدیمی (قبل از عملیات) را «جایگزینی کامل» کن و همه‌چیز پاک می‌شود.
     * بکاپ ایمنیِ خودکار هم جلویش را نمی‌گرفت، چون همان کاربر می‌توانست پاکش کند.
     *
     * ⚠️ تأیید **قبل از** هر عمل جانبی گرفته می‌شود: اگر رد شود، نه بکاپ ایمنی
     * گرفته می‌شود، نه اتصال دیتابیس بسته می‌شود، نه چیزی در دفتر ثبت می‌گردد.
     *
     * کلید `settings` انتخاب شد چون بکاپ صراحتاً زیرمجموعه‌ی همان پنل است
     * (`src/shared/panels.ts`) و در `ALWAYS_LOCKED_PANELS` است — یعنی برخلاف
     * پنل‌های دیگر، حتی با خاموش بودن قفل ماژول‌ها هم رمز لازم دارد.
     */
    const mode = input?.mode
    if (mode !== 'merge' && mode !== 'replace')
      throw new BusinessError(
        'نوع بازگردانی باید «جایگزینی کامل» یا «ادغام» باشد؛ مقدار نامعتبر پذیرفته نمی‌شود و هیچ فایلی جایگزین نمی‌شود.'
      )
    // نشست ۱۸۴ — مخرب‌ترین عملیات برنامه؛ هیچ مسیری نباید بی‌رمز باشد.
    const scope = await assertPanelPasswordStrict(
      PANEL_KEYS.settings,
      input?.managerPassword ?? null,
      input?.mode === 'merge'
        ? 'ادغام یک فایل بکاپ با داده‌ی فعلی'
        : 'جایگزینی کامل داده‌ی فعلی با یک فایل بکاپ'
    )
    const path = await this.resolve(input?.id)
    // فایل imported قدیمی یا auto روی دیسک ممکن است از نسخه‌ای قبل از gate
    // آمده باشد؛ پیش از safety-backup یا replace، SQLite/schema آن را دوباره
    // می‌سنجیم. summarize در خطا throw می‌کند و هیچ تغییری رخ نمی‌دهد.
    await summarizeBackup(path)
    const fileName = (await readLedger()).find((r) => r.id === input.id)?.fileName ?? basename(path)

    if (input?.mode === 'merge') {
      const report = await mergeBackup({ file: path, fileName, userId: input.userId ?? null })
      await this.markApplied(input.id, 'merge')
      // نشست ۱۸۱: تا امروز ادغام هیچ ردیف Audit مستقلی نداشت و فقط داخل
      // MergeService رد می‌خورد. «چه کسی و با چه سطحی تأیید کرد» باید بماند.
      await audit(prisma, {
        action: AuditAction.BACKUP_RESTORE,
        entity: 'Backup',
        userId: input.userId ?? null,
        after: JSON.stringify({ fileName, mode: 'merge', approvedBy: scope }),
        note: `ادغام فایل بکاپ با داده‌ی فعلی (تأیید: ${scope})`
      })
      return { mode: 'merge', report }
    }

    // ---------- جایگزینی کامل ----------
    const dir = backupsDir()
    await mkdir(dir, { recursive: true })
    const safety = join(dir, `before-restore-${stamp()}.db`)
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => null)
    await copyFile(databaseFile(), safety)

    const db = databaseFile()
    await prisma.$disconnect().catch(() => {})
    // ژورنال‌های SQLite نباید از داده‌ی قبلی باقی بمانند
    await unlink(`${db}-wal`).catch(() => {})
    await unlink(`${db}-shm`).catch(() => {})
    await copyFile(path, db)
    // یک نشانه برای این‌که بعد از ریستارت بدانیم چه اتفاقی افتاده است
    await writeFile(join(dir, 'last-restore.txt'), `${new Date().toISOString()} ← ${fileName}\n`, 'utf8').catch(
      () => {}
    )
    /**
     * نشست ۱۹۰ — سابقه‌ی جایگزینی باید در *دیتابیس جدید* بماند.
     * نوشتن Audit قبل از copyFile با خودِ فایل قدیمی پاک می‌شد.
     */
    try {
      await prisma.$connect()
      // فقط بعد از کپی موفق و اتصال به دیتابیس جایگزین‌شده، applied ثبت می‌شود.
      // پیش از copy این پرچم در صورت خطای I/O یک restore انجام‌نشده را موفق نشان می‌داد.
      await this.markApplied(input.id, 'replace')
      await audit(prisma, {
        action: AuditAction.BACKUP_RESTORE,
        entity: 'Backup',
        userId: input.userId ?? null,
        after: JSON.stringify({ fileName, safety, mode: 'replace', approvedBy: scope }),
        note: `جایگزینی کامل داده با فایل بکاپ (بکاپ ایمنی از وضعیت قبلی گرفته شد · تأیید: ${scope})`
      })
    } catch (e) {
      console.error('[backup] audit after replace failed; last-restore.txt remains', e)
    }

    // فرصت بده پیام به کاربر برسد، بعد برنامه دوباره باز شود
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 1200)

    return { mode: 'replace', safetyBackup: safety, willRestart: true }
  }
}
