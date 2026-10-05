/**
 * نشست ۱۸۱ (S181-D1) — سریال‌سازی امن BigInt. هر فایلی که `audit()` را صدا
 * می‌زند این ماژول را import می‌کند، پس نصب پچ برای کل ۱۵۶ نقطه تضمین می‌شود
 * حتی اگر مسیر دیگری `db/client` را بار نکرده باشد.
 */
import '@shared/bigintJson'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { BusinessError } from '../errors'

/**
 * کلاینتی که لاگ با آن نوشته می‌شود: یا کلاینت تراکنش جاری (`tx`) یا کلاینت
 * سراسری (وقتی هیچ تراکنشی باز نیست).
 */
export type AuditClient = Prisma.TransactionClient | typeof prisma

export interface AuditInput {
  action: string
  entity: string
  entityId?: number | null
  userId?: number | null
  before?: string | null
  after?: string | null
  note?: string | null
}

/**
 * لاگ همه‌ی عملیات مالی مهم؛ هیچ‌وقت throw نمی‌کند تا جریان فروش قطع نشود.
 *
 * ⚠️ رفع باگ «Transaction API error: Transaction already closed»:
 * نسخه‌ی قبلی همیشه از کلاینت سراسری `prisma` استفاده می‌کرد. اگر این تابع از
 * داخل یک `prisma.$transaction(async (tx) => …)`ِ باز صدا زده می‌شد، لاگ روی یک
 * اتصال جداگانه نوشته می‌شد. چون SQLite در هر لحظه فقط یک نویسنده را می‌پذیرد،
 * آن نوشتن منتظر آزاد شدن قفلِ تراکنشِ باز می‌ماند و تراکنشِ باز هم منتظر تمام
 * شدن همین `await audit(...)` بود ⇒ بن‌بست با خودش. Prisma بعد از timeout
 * پیش‌فرض (۵۰۰۰ms) تراکنش را می‌بست و خطای «Transaction already closed» می‌داد.
 *
 * قاعده‌ی جدید (بدون استثنا): کلاینت باید آرگومان اول باشد.
 *   - داخل تراکنش:  audit(tx, { … })
 *   - بیرون تراکنش: audit(prisma, { … })
 */
/**
 * جلسه ۲۵ — نسخه‌ی دسته‌ای همان تابع بالا.
 *
 * چرا لازم شد؟ چاپ دسته‌ای اعتبار (§۵) می‌تواند تا ۲۰۰۰ سند باشد و §۱۰ می‌گوید
 * هر رویداد مهم باید **روی خودِ همان اعتبار** ثبت شود، وگرنه Timeline صفحه‌ی
 * جزئیات (که با `entity='StoreCredit' AND entityId=id` خوانده می‌شود) چاپ‌های
 * دسته‌ای را نشان نمی‌دهد. حلقه‌ی ۲۰۰۰ تایی `create` روی SQLite کند است، پس
 * `createMany` تکه‌تکه (۵۰۰ تایی) نوشته می‌شود.
 *
 * مثل `audit`، هیچ‌وقت throw نمی‌کند: لاگ نباید جریان کاری را بشکند.
 */
export async function auditMany(client: AuditClient, rows: AuditInput[]): Promise<void> {
  const list = (rows ?? []).filter(Boolean)
  if (!list.length) return
  const CHUNK = 500
  try {
    for (let i = 0; i < list.length; i += CHUNK) {
      await client.auditLog.createMany({
        data: list.slice(i, i + CHUNK).map((input) => ({
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          userId: input.userId ?? null,
          before: input.before ?? null,
          after: input.after ?? null,
          note: input.note ?? null
        }))
      })
    }
  } catch (e) {
    console.error('[auditMany] failed', e)
  }
}

export async function audit(client: AuditClient, input: AuditInput): Promise<void> {
  try {
    await writeAudit(client, input)
  } catch (e) {
    console.error('[audit] failed', e)
  }
}

async function writeAudit(client: AuditClient, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      userId: input.userId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      note: input.note ?? null
    }
  })
}

/**
 * ===========================================================================
 * جلسه ۲۹ · §۱۰ — نسخه‌ی **fail-closed** همان `audit`.
 *
 * `audit` عمداً fail-open است و باید بماند: اگر لاگ یک چاپ رسید یا یک تغییر
 * تنظیمات ننشیند، بستن جریان فروش بدتر از گم شدن آن لاگ است.
 *
 * ولی ممیزی جلسه ۲۷ (§۱۰) یک مورد را جدا کرد: **تغییرهای مالی اعتبار خرید**.
 * آن‌جا «عملیات انجام شد ولی سابقه‌اش ننشست» یعنی پولی جابه‌جا شده که هیچ سندی
 * ندارد — و چون Timeline صفحه‌ی جزئیات تنها سند این ماژول است، عملاً یعنی
 * نامرئی. پس مسیر اعتبار با همین تابع لاگ می‌نویسد: اگر نوشتن لاگ شکست بخورد،
 * خطا پرت می‌شود و چون همه‌ی این مسیرها داخل `$transaction` هستند، *خودِ تغییر
 * هم rollback می‌شود*. یعنی «یا هم تغییر و هم سابقه، یا هیچ‌کدام».
 *
 * ⚠️ قاعده‌ی همراهش: هر جا این تابع صدا زده می‌شود باید همان کلاینت تراکنشی
 * (`tx`) باشد که خودِ تغییر را نوشته است، وگرنه fail-closed معنا ندارد.
 * ===========================================================================
 */
export async function auditOrThrow(client: AuditClient, input: AuditInput): Promise<void> {
  try {
    await writeAudit(client, input)
  } catch (e) {
    console.error('[auditOrThrow] failed', e)
    throw new BusinessError(
      'ثبت «سابقه‌ی عملیات» برای این تغییر ممکن نشد، پس خودِ تغییر هم انجام نشد.\n' +
        'این عمدی است: تغییر مالی اعتبار خرید بدون سابقه ثبت نمی‌شود. یک بار دیگر تلاش کنید و اگر تکرار شد، ' +
        'از «تنظیمات › سبک‌سازی و نگهداری» وضعیت دیتابیس را بررسی کنید.\n' +
        `جزئیات فنی: ${String((e as any)?.message ?? e).split('\n')[0]}`
    )
  }
}
