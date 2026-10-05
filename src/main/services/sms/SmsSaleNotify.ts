/**
 * ===========================================================================
 * «تشکر از خرید» — قلابِ بعد از فاکتور.
 *
 * سه قاعده‌ی سختی که این فایل باید رعایت کند:
 *
 *   ۱) **هیچ‌وقت داخل تراکنش فروش اجرا نمی‌شود.** صدا‌زننده (لایه‌ی IPC) آن را
 *      *بعد از* برگشتن فاکتور و به‌صورت fire-and-forget صدا می‌زند؛ پس کندی یا
 *      خرابی پیامک، ثبت فاکتور و چاپ رسید را حتی یک میلی‌ثانیه عقب نمی‌اندازد.
 *   ۲) **هیچ‌وقت throw نمی‌کند.** هر خطایی به یک نتیجه‌ی فارسی تبدیل می‌شود.
 *   ۳) **فقط می‌خواند و در صف می‌نویسد.** به جدول‌های فروش دست نمی‌زند، پس اگر
 *      کل این ماژول پاک شود، فروش هیچ تغییری نمی‌بیند.
 *
 * چرا مستقیم از `prisma` می‌خواند و `SalesService` را import نمی‌کند: وابستگی
 * یک‌طرفه باید حفظ شود (فروش نباید به پیامک وصل شود و پیامک هم نباید سرویس
 * فروش را بکشد). فقط یک خواندنِ ساده‌ی «همین یک فاکتور» است.
 * ===========================================================================
 */
import { prisma } from '../../db/client'
import { audit } from '../AuditService'
import { AuditAction, OrderType } from '@shared/enums'
import { money, toJalaliDate } from '@shared/jalali'
import {
  SMS_SETTING_KEYS,
  DEFAULT_SMS_THANK_YOU,
  parseSmsSwitch,
  renderSmsTemplate,
  smsDedupeKey
} from '@shared/sms'
import { enqueueSms } from './SmsQueue'
import { smsTemplateService } from './SmsTemplates'

/** کد قالب هر نوع فروش. */
export const THANK_YOU_TEMPLATES: Record<string, string> = {
  [OrderType.WHOLESALE]: 'SALE_THANK_YOU_WHOLESALE',
  [OrderType.INTERNAL]: 'SALE_THANK_YOU',
  [OrderType.DELIVERY]: 'SALE_THANK_YOU',
  [OrderType.PHONE]: 'SALE_THANK_YOU'
}

/**
 * انواعی که **نباید** پیام تشکر بگیرند.
 * تنها مورد، «سند تعویض کالا» است: یک SaleInvoice واقعی است ولی خرید نیست —
 * مشتری کالا را عوض کرده، نه این‌که چیزی خریده باشد. پیام «از خرید شما
 * سپاسگزاریم» بعد از تعویض، هم بی‌ربط است هم پول اضافه.
 */
const SKIP_ORDER_TYPES = new Set<string>([OrderType.EXCHANGE])

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return row?.value ?? null
}

/** «تشکر از خرید» روشن است؟ (پیش‌فرض: خاموش) */
export async function thankYouEnabled(): Promise<boolean> {
  try {
    return parseSmsSwitch(await readSetting(SMS_SETTING_KEYS.thankYou), DEFAULT_SMS_THANK_YOU)
  } catch {
    return DEFAULT_SMS_THANK_YOU
  }
}

export interface SaleNotifyResult {
  /** پیام در صف نشست؟ */
  queued: boolean
  /** توضیح فارسی — برای لاگ و تست؛ هرگز به کاربرِ پنل فروش نشان داده نمی‌شود */
  detail: string
  /** شناسه‌ی ردیف صف (اگر ساخته شد) */
  outboxId?: number | null
}

/**
 * ثبت «پیام تشکر» برای یک فاکتور فروش.
 *
 * ⚠️ از IPC و **بعد از** موفقیت `salesService.create` صدا زده می‌شود.
 * هرگز نباید awaitش کرد داخل مسیر فروش از دید کاربر؛ صف خودش می‌فرستد.
 */
export async function notifySaleCreated(input: {
  invoiceId?: unknown
  orderType?: unknown
  userId?: number | null
}): Promise<SaleNotifyResult> {
  try {
    const invoiceId = Math.round(Number(input?.invoiceId))
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return { queued: false, detail: 'شناسه‌ی فاکتور نامعتبر است.' }

    if (!(await thankYouEnabled()))
      return { queued: false, detail: 'ارسال «تشکر از خرید» خاموش است.' }

    const invoice = await (prisma as any).saleInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        receiptNo: true,
        orderType: true,
        grandTotal: true,
        paidTotal: true,
        issuedAt: true,
        issuedAtJalali: true,
        customerId: true,
        customer: { select: { id: true, name: true, phone: true } }
      }
    })
    if (!invoice) return { queued: false, detail: 'این فاکتور پیدا نشد.' }

    const orderType = String(invoice.orderType ?? OrderType.INTERNAL)
    if (SKIP_ORDER_TYPES.has(orderType))
      return { queued: false, detail: 'این سند، فروش نیست (سند تعویض/خرید) پس پیام تشکر نمی‌گیرد.' }

    const phone = String(invoice.customer?.phone ?? '').trim()
    if (!phone)
      return { queued: false, detail: 'برای این فاکتور شماره‌ی تماسی ثبت نشده است، پس پیامی ساخته نشد.' }

    const templateCode = THANK_YOU_TEMPLATES[orderType] ?? 'SALE_THANK_YOU'
    const body = await smsTemplateService.bodyOf(templateCode)
    if (!body)
      return { queued: false, detail: `قالب «${templateCode}» خاموش یا ناموجود است، پس پیامی ساخته نشد.` }

    const storeName = String((await readSetting('receipt.storeName')) ?? '').trim()
    const storePhone = String((await readSetting('receipt.storePhone')) ?? '').trim()

    const paid = typeof invoice.paidTotal === 'bigint' ? invoice.paidTotal : BigInt(Math.round(Number(invoice.paidTotal ?? 0)))
    const total = typeof invoice.grandTotal === 'bigint' ? invoice.grandTotal : BigInt(Math.round(Number(invoice.grandTotal ?? 0)))
    const remaining = total - paid

    const rendered = renderSmsTemplate(body, {
      customer_name: String(invoice.customer?.name ?? '').trim() || 'مشتری',
      customer_phone: phone,
      store_name: storeName || 'فروشگاه',
      store_phone: storePhone,
      invoice_no: String(invoice.receiptNo ?? invoice.id),
      invoice_date: String(invoice.issuedAtJalali ?? toJalaliDate(new Date(invoice.issuedAt ?? Date.now()))),
      invoice_total: money(total),
      paid_amount: money(paid),
      remaining_amount: money(remaining > 0n ? remaining : 0n)
    })
    if (rendered.unknown.length)
      return { queued: false, detail: `قالب «${templateCode}» متغیر ناشناخته دارد: ${rendered.unknown.join(' ')}` }

    const res = await enqueueSms({
      eventType: orderType === OrderType.WHOLESALE ? 'SALE_THANK_YOU_WHOLESALE' : 'SALE_THANK_YOU',
      phone,
      body: rendered.text,
      templateCode,
      customerId: invoice.customer?.id ?? invoice.customerId ?? null,
      customerName: invoice.customer?.name ?? null,
      variables: {
        invoice_no: String(invoice.receiptNo ?? invoice.id),
        remaining: String(remaining)
      },
      relatedEntity: 'SaleInvoice',
      relatedEntityId: invoice.id,
      /**
       * کلید یکتا روی خودِ فاکتور: اگر همین مسیر دو بار صدا زده شود (retry
       * رابط، دوباره‌فرستادن کاربر، یا شروع دوباره‌ی برنامه) پیام دوم ساخته
       * نمی‌شود. کلیدِ تکراری توسط ایندکس یکتای صف رد می‌شود.
       */
      dedupeKey: smsDedupeKey({
        eventType: 'SALE_THANK_YOU',
        entityType: 'SaleInvoice',
        entityId: invoice.id,
        templateCode,
        phone
      }),
      priority: 4,
      createdByUserId: input?.userId ?? null
    })

    if (res.duplicate)
      return { queued: false, detail: 'برای این فاکتور قبلاً پیام تشکر ساخته شده بود.' }
    if (!res.ok) return { queued: false, detail: res.detail }

    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_ENQUEUE,
      entity: 'SmsOutbox',
      entityId: res.id,
      userId: input?.userId ?? null,
      after: JSON.stringify({ invoiceId: invoice.id, orderType, templateCode }),
      note: `پیام تشکر فاکتور ${String(invoice.receiptNo ?? invoice.id)} در صف پیامک ثبت شد`
    })

    return { queued: true, detail: res.detail, outboxId: res.id }
  } catch (e: any) {
    /**
     * هیچ خطایی از این تابع بیرون نمی‌زند. اگر روزی چیزی اینجا بشکند، مشتری
     * پیام تشکر نمی‌گیرد ولی **فروش و صندوق سالم می‌مانند** — و همین اولویت
     * درست است.
     */
    console.error('[sms:notify-sale] failed', e)
    return { queued: false, detail: 'ثبت پیام تشکر با خطای غیرمنتظره ناموفق بود.' }
  }
}
