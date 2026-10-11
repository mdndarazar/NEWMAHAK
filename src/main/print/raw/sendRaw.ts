/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «ارسال بایت خام به چاپگر در ویندوز» (بخش ۸.۳).
 *
 * چرا PowerShell و `winspool.drv`؟ چون ارسال RAW بدون ماژول native (koffi/…)
 * ممکن نیست و پروژه قرار نیست وابستگی بومی بگیرد. مسیر:
 *   فایل موقت (۰۶۰۰) → `powershell.exe -File raw-print.ps1 -Printer <نام> -File <مسیر>`
 *   → اسکریپت با `Add-Type` توابع `winspool.drv` را صدا می‌زند و RAW می‌فرستد.
 *
 * قراردادهای دست‌نخورده:
 *   • نام چاپگر هرگز به رشته‌ی دستور چسبانده نمی‌شود؛ فقط در آرایه‌ی آرگومان‌ها
 *     (`spawn` بدون `shell`) می‌رود. پس نام با فاصله/گیومه هم امن است.
 *   • فایل موقت در `finally` پاک می‌شود (موفق یا ناموفق).
 *   • موفقیت در نوشتن روی spooler **تأیید چاپ کاغذ نیست**؛ اگر مهلت تمام شود
 *     نتیجه «نامعلوم» است (`PrintOutcomeUnknownError`) و هیچ retry خودکاری نیست.
 * ===========================================================================
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BusinessError } from '../../errors'
import { PrintOutcomeUnknownError } from '../printer'

/** مهلت ارسال خام؛ بیشتر از این ⇒ نتیجه‌ی نامعلوم (نه «ناموفق قطعی»). */
export const RAW_SEND_TIMEOUT_MS = 20_000

export interface RawEnv {
  isPackaged: boolean
  /** در dev: ریشه‌ی پروژه (`app.getAppPath`). */
  appPath: string
  /** در نسخه‌ی نصبی: `process.resourcesPath`. */
  resourcesPath: string
}

/**
 * مسیر اسکریپت چاپ خام.
 * در dev کنار سورس است و در نسخه‌ی نصبی از `extraResources` زیر
 * `process.resourcesPath/print` می‌آید (PowerShell نمی‌تواند داخل asar بخواند).
 */
export function rawScriptPathFor(env: RawEnv): string {
  return env.isPackaged
    ? join(env.resourcesPath, 'print', 'raw-print.ps1')
    : join(env.appPath, 'resources', 'print', 'raw-print.ps1')
}

/** آرگومان‌های PowerShell — آرایه‌ی خالص تا مستقیم تست شود (بدون shell). */
export function powershellArgs(scriptPath: string, printerName: string, filePath: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Printer',
    printerName,
    '-File',
    filePath
  ]
}

/**
 * ترجمه‌ی کد خروج اسکریپت به پیام فارسی.
 * کدهای اسکریپت: ۲ = چاپگر پیدا نشد · ۳ = خطای ویندوز/spooler · ۴ = فایل خوانده نشد
 * · ۵ = مسدودشدن اجرای اسکریپت (سیاست سازمانی).
 */
export function rawExitMessage(exitCode: number, stderrText?: string): string {
  const tail = String(stderrText ?? '').trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? ''
  if (exitCode === 2)
    return 'چاپگر انتخاب‌شده در ویندوز پیدا نشد و هیچ برگه‌ای فرستاده نشد؛ چاپگر را روشن/وصل کنید یا چاپگر دیگری انتخاب کنید.'
  if (exitCode === 3)
    return `ارسال خام به چاپگر توسط ویندوز رد شد${tail ? ` (پاسخ سیستم: «${tail}»)` : ''}؛ اتصال و روشن‌بودن چاپگر را بررسی کنید.`
  if (exitCode === 4) return 'فایل کار چاپ خام ساخته/خوانده نشد؛ دوباره تلاش کنید.'
  if (exitCode === 5)
    return 'اجرای اسکریپت چاپ توسط سیستم مسدود شد (سیاست اجرای PowerShell)؛ با مدیر سیستم هماهنگ کنید یا روش «دقیق (RAW)» را خاموش کنید.'
  return `ارسال خام به چاپگر انجام نشد${tail ? ` (پاسخ سیستم: «${tail}»)` : ''}؛ اتصال و روشن‌بودن چاپگر را بررسی کنید.`
}

/**
 * اجراکننده‌ی PowerShell. فقط برای تست‌ها قابل جابه‌جایی است (`setRawSpawnForTest`)
 * تا مسیر کامل «فایل موقت → آرگومان‌ها → پاک‌سازی» بدون اجرای واقعی PowerShell
 * قابل آزمون باشد. در زمان اجرا همیشه همان `spawn` واقعی است.
 */
let spawnImpl: typeof spawn = spawn

/** فقط برای تست‌ها: ماک اجراکننده (یا `null` برای برگشت به `spawn` واقعی). */
export function setRawSpawnForTest(fn: typeof spawn | null): void {
  spawnImpl = fn ?? spawn
}

function tempRoot(): string {
  try {
    return app.getPath('temp')
  } catch {
    return tmpdir()
  }
}

export interface SendRawOptions {
  timeoutMs?: number
  /** برای تست: مسیر اسکریپت و تابع spawn تزریق‌شدنی. */
  scriptPath?: string
  spawnImpl?: typeof spawn
}

/**
 * ارسال یک کار خام به چاپگر.
 * خروجی: تعداد بایت ارسال‌شده (برای پیام/گزارش) — موفقیت در spool.
 */
export async function sendRaw(printerName: string, bytes: Buffer, opts: SendRawOptions = {}): Promise<number> {
  const name = String(printerName ?? '').trim()
  if (!name) throw new BusinessError('نام چاپگر برای چاپ خام خالی است؛ چاپگری انتخاب کنید.')
  if (!bytes?.length) throw new BusinessError('کار چاپ خام خالی است و چیزی فرستاده نشد.')

  const scriptPath =
    opts.scriptPath ??
    rawScriptPathFor({
      isPackaged: app.isPackaged === true,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath ?? ''
    })

  let dir: string
  try {
    dir = await mkdtemp(join(tempRoot(), 'mahak-raw-'))
  } catch (err) {
    throw new BusinessError(
      `پوشه‌ی موقت سیستم قابل نوشتن نبود و کار چاپ خام فرستاده نشد (${(err as Error)?.message ?? err}).`
    )
  }
  const file = join(dir, 'job.bin')
  try {
    try {
      await writeFile(file, bytes, { mode: 0o600 })
    } catch (err) {
      throw new BusinessError('نوشتن کار چاپ خام روی دیسک موقت انجام نشد و چیزی فرستاده نشد.')
    }
    const spawnFn = opts.spawnImpl ?? spawnImpl
    const waitMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : RAW_SEND_TIMEOUT_MS
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      let stderr = ''
      const done = (err?: Error): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (err) rejectPromise(err)
        else resolvePromise()
      }
      const child = spawnFn('powershell.exe', powershellArgs(scriptPath, name, file), {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // اگر پروسه همین لحظه تمام شده باشد، close بعدی توسط `settled` نادیده گرفته می‌شود.
        }
        done(
          new PrintOutcomeUnknownError(
            'چاپگر در مهلت مقرر پاسخی نداد؛ ممکن است برگه چاپ شده باشد. تا وقتی خروجی چاپگر را ندیده‌اید دوباره چاپ نکنید.'
          )
        )
      }, Math.max(1, waitMs))
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (err: Error) =>
        done(new BusinessError(`اجرای اسکریپت چاپ خام ممکن نشد${err?.message ? ` (${err.message})` : ''}.`))
      )
      child.on('close', (code: number | null) => {
        if (code === 0) done()
        else if (code == null)
          done(
            new PrintOutcomeUnknownError(
              'ارسال کار چاپ خام به‌درستی تمام نشد؛ ممکن است برگه چاپ شده باشد. قبل از چاپ دوباره خروجی چاپگر را ببینید.'
            )
          )
        else done(new BusinessError(rawExitMessage(code, stderr)))
      })
    })
    return bytes.length
  } finally {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch (e) {
      console.error('[print] raw temp cleanup failed', e)
    }
  }
}
