/**
 * تنظیمات یکسان همه‌ی تراکنش‌های interactive.
 *
 * لایه‌ی ایمنی (defense-in-depth) برای باگ «Transaction already closed»:
 * timeout پیش‌فرض Prisma برای تراکنش‌های interactive پنج ثانیه است و روی
 * SQLite (تک‌نویسنده) یک فاکتور بزرگ یا یک دیسک کند راحت از آن رد می‌شود.
 * راه‌حل اصلی، پاس دادن `tx` به همه‌ی نوشتن‌های داخل تراکنش است (AuditService)؛
 * این عدد فقط حاشیه‌ی امن اضافه می‌کند.
 */
export const TX_OPTIONS = { timeout: 15000, maxWait: 5000 } as const
