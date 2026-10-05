import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * ---------------------------------------------------------------------------
 * مورد ۴ (نشست دهم) — «گاوصندوق» رمزهای دوم/سوم پنل‌ها.
 *
 * مسئله: رمزهای پنل با scrypt هش می‌شدند (یک‌طرفه)، پس بعداً هیچ راهی برای
 * «دیدن رمزی که چند هفته پیش گذاشته‌ام» نبود.
 *
 * تصمیم (تعادل بین راحتی و حداقل امنیت):
 *   • هش scrypt *سر جای خودش می‌ماند* و تایید رمز همیشه با همان انجام می‌شود
 *     (پس منطق ورود هیچ تغییری نمی‌کند و به این فایل وابسته نیست).
 *   • *علاوه بر آن* یک نسخه‌ی رمزنگاری‌شده‌ی بازگشت‌پذیر با AES-256-GCM ذخیره
 *     می‌شود تا در تنظیمات قابل نمایش باشد. هیچ‌وقت متن خام روی دیسک نمی‌رود.
 *   • کلید رمزنگاری از یک «بذر» ۳۲ بایتی تصادفی مشتق می‌شود که در فایل
 *     `panel-vault.key` داخل پوشه‌ی userData است — یعنی **بیرون از فایل
 *     دیتابیس**. نتیجه‌ی عملی: اگر کسی فقط `shop.db` (یا یک بکاپ) را بردارد،
 *     رمزها برایش قابل خواندن نیست؛ ولی روی همین دستگاه، تنظیمات می‌تواند
 *     رمز را به خودت نشان دهد. رمز اصلی مدیر عمداً وارد این مسیر نمی‌شود و
 *     فقط هش می‌ماند.
 *   • اگر دیتابیس روی دستگاه دیگری بازگردانی شود، کلید نیست ⇒ ورود با رمزها
 *     مثل همیشه کار می‌کند ولی «نمایش رمز» با پیام روشن می‌گوید که باید یک بار
 *     دوباره ثبت شود.
 * ---------------------------------------------------------------------------
 */
const MAGIC = 'v1'
let cached: Buffer | null = null

function keyFile(): string {
  const dir = app.getPath('userData')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* پوشه از قبل هست */
  }
  return join(dir, 'panel-vault.key')
}

/** بذر کلید را می‌خواند و اگر نبود می‌سازد. خطا ⇒ null (گاوصندوق خاموش). */
function vaultKey(): Buffer | null {
  if (cached) return cached
  try {
    const file = keyFile()
    let seed: string
    if (existsSync(file)) {
      seed = readFileSync(file, 'utf8').trim()
      if (!/^[0-9a-f]{64}$/i.test(seed)) seed = ''
    } else seed = ''
    if (!seed) {
      seed = randomBytes(32).toString('hex')
      writeFileSync(file, seed, { encoding: 'utf8', mode: 0o600 })
    }
    cached = scryptSync(Buffer.from(seed, 'hex'), 'mahak-panel-vault', 32)
    return cached
  } catch (e) {
    console.error('[vault] key unavailable', e)
    return null
  }
}

/** گاوصندوق در این نصب کار می‌کند؟ (برای پیام‌های UI) */
export function vaultReady(): boolean {
  return !!vaultKey()
}

/** رمز خام → بلوب رمزنگاری‌شده. خطا ⇒ undefined (رمز فقط هش می‌شود). */
export function sealSecret(plain: string): string | undefined {
  const key = vaultKey()
  if (!key || !plain) return undefined
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return [MAGIC, iv.toString('hex'), cipher.getAuthTag().toString('hex'), body.toString('hex')].join(':')
  } catch (e) {
    console.error('[vault] seal failed', e)
    return undefined
  }
}

/** بلوب رمزنگاری‌شده → رمز خام. هر خرابی/کلید اشتباه ⇒ null. */
export function openSecret(blob: unknown): string | null {
  const key = vaultKey()
  if (!key || typeof blob !== 'string') return null
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== MAGIC) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'))
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
