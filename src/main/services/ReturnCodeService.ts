import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'

/**
 * ---------------------------------------------------------------------------
 * «کد فاکتور» فروش تکی — کد کوتاه رندوم برای برگشت از فروش.
 *
 * قواعد خواسته‌شده:
 *   • کوتاه و ترکیبی از حرف و عدد (پیش‌فرض ۶ کاراکتر، در تنظیمات قابل تغییر).
 *   • روی رسید هم به‌صورت متن و هم بارکد Code128 چاپ می‌شود تا با بارکدخوان
 *     خوانده شود (بدون تایپ دستی).
 *   • اعتبار = یک هفته از تاریخ صدور فاکتور (قابل تنظیم). بعد از انقضا همان کد
 *     می‌تواند دوباره برای فاکتور جدیدی تولید شود، چون دیگر به فاکتور قبلی
 *     اشاره نمی‌کند.
 *
 * پس یکتایی «مطلق» لازم نیست و ستون هم UNIQUE نیست؛ یکتایی فقط بین کدهای
 * *معتبر* (منقضی‌نشده) تضمین می‌شود. تولید با crypto.randomInt انجام می‌شود
 * (نه Math.random) و کاندید تا وقتی با یک کد معتبر تصادم دارد دور ریخته
 * می‌شود؛ بررسی داخل همان تراکنشِ ثبت فاکتور است، پس دو فاکتور هم‌زمان هم کد
 * تکراری نمی‌گیرند.
 *
 * الفبا عمداً بدون حروف/ارقام گمراه‌کننده (I, O, 0, 1) است تا خواندن دستی کد
 * از روی رسید هم خطا نداشته باشد.
 * ---------------------------------------------------------------------------
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MIN_LENGTH = 4
const MAX_LENGTH = 12
const MAX_TRIES = 40

export const DAY_MS = 24 * 60 * 60 * 1000

/** یک کد رندوم با طول دلخواه (فقط حروف بزرگ و ارقام غیرمشابه). */
export function randomReturnCode(length = 6): string {
  const len = Math.min(Math.max(Math.round(length) || 6, MIN_LENGTH), MAX_LENGTH)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, ALPHABET.length)]
  return out
}

/** نرمال‌سازی ورودی کاربر: حروف کوچک، فاصله و کاراکتر اضافه‌ی اسکنر پاک می‌شود. */
export function normalizeReturnCode(input: string): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** پایان اعتبار کد بر اساس تاریخ صدور و تعداد روز تنظیم‌شده. */
export function returnCodeExpiry(issuedAt: Date, days: number): Date {
  const d = Math.min(Math.max(Math.round(days) || 7, 1), 365)
  return new Date(issuedAt.getTime() + d * DAY_MS)
}

/**
 * یک کد یکتا در بازه‌ی اعتبار تولید می‌کند.
 * اگر (به‌فرض محال) بعد از MAX_TRIES تلاش هم تصادم داشت، طول کد یک واحد زیاد
 * می‌شود تا فضای حالت بزرگ‌تر شود — نه این‌که عملیات ثبت فاکتور شکست بخورد.
 */
export async function generateReturnCode(
  client: Prisma.TransactionClient | typeof prisma,
  opts: { length?: number; days?: number; issuedAt?: Date } = {}
): Promise<{ code: string; expiresAt: Date }> {
  const issuedAt = opts.issuedAt ?? new Date()
  const expiresAt = returnCodeExpiry(issuedAt, opts.days ?? 7)
  let length = opts.length ?? 6

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (attempt > 0 && attempt % 10 === 0 && length < MAX_LENGTH) length++
    const code = randomReturnCode(length)
    const clash = await client.saleInvoice.findFirst({
      where: { returnCode: code, returnCodeExpiresAt: { gt: issuedAt } },
      select: { id: true }
    })
    if (!clash) return { code, expiresAt }
  }

  // آخرین راه: کد بلندتر و قطعاً بی‌تصادم (زمان + رندوم)
  return { code: (randomReturnCode(4) + Date.now().toString(36).toUpperCase()).slice(0, MAX_LENGTH), expiresAt }
}
