/**
 * ===========================================================================
 * قالب‌های متن پیام.
 *
 *   • قالب‌های سیستمی (`isSystem`) حذف نمی‌شوند؛ فقط متنشان عوض می‌شود.
 *   • هر تغییرِ متن `version` را بالا می‌برد. متن نهایی **در لحظه‌ی صف‌شدن
 *     snapshot** می‌شود، پس عوض کردن قالبِ فردا، پیام دیروز را تغییر نمی‌دهد.
 *   • دو قالب جدا برای اعتبار تاریخ‌دار و بی‌تاریخ: کد بدون انقضا نباید پیامی
 *     بگیرد که می‌گوید «تا {تاریخ} معتبر است».
 * ===========================================================================
 */
import { prisma } from '../../db/client'
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'
import { AuditAction } from '@shared/enums'
import { validateSmsBody, smsPlaceholdersOf, DEFAULT_SMS_OPT_OUT_NOTE } from '@shared/sms'
import { toJalaliDate } from '@shared/jalali'

export interface SmsTemplateRow {
  id: number
  code: string
  title: string
  category: string
  body: string
  isActive: boolean
  isSystem: boolean
  version: number
  placeholders: string[]
  updatedAtJalali: string | null
}

/**
 * قالب‌های پیش‌فرض.
 *
 * `SALE_THANK_YOU_WHOLESALE` جدا از خرده است چون لحن و اطلاعاتش فرق دارد
 * (مبلغ کل و مانده برای مشتری عمده مهم است).
 */
export const DEFAULT_SMS_TEMPLATES: ReadonlyArray<{
  code: string
  title: string
  category: string
  body: string
}> = [
  {
    code: 'SALE_THANK_YOU',
    title: 'تشکر از خرید (پنل فروش)',
    category: 'SALE',
    body: '{customer_name} عزیز، از خرید شما در {store_name} سپاسگزاریم. مبلغ فاکتور: {invoice_total} ریال'
  },
  {
    code: 'SALE_THANK_YOU_WHOLESALE',
    title: 'تشکر از خرید (فاکتور عمده)',
    category: 'SALE',
    body:
      '{customer_name} عزیز، فاکتور عمده‌ی شما در {store_name} ثبت شد. مبلغ کل: {invoice_total} ریال · مانده: {remaining_amount} ریال'
  },
  {
    code: 'CREDIT_REMINDER',
    title: 'یادآوری اعتبار خرید (تاریخ‌دار)',
    category: 'CREDIT',
    body:
      '{customer_name} عزیز، اعتبار خرید شما با کد {credit_code} تا {credit_expiry} معتبر است. ' +
      'باقی‌مانده: {credit_remaining} ریال · {store_name}'
  },
  {
    code: 'CREDIT_REMINDER_NO_EXPIRY',
    title: 'یادآوری اعتبار خرید (بدون تاریخ)',
    category: 'CREDIT',
    body:
      '{customer_name} عزیز، شما یک کد اعتباری از {store_name} دارید؛ یادت نرفته؟ ' +
      'کد: {credit_code} · باقی‌مانده: {credit_remaining} ریال'
  },
  {
    code: 'CAMPAIGN',
    title: 'پیامک تبلیغاتی (انبوه)',
    category: 'CAMPAIGN',
    /**
     * ⚠️ `{opt_out_note}` عمداً بخشی از متن پیش‌فرض است و حذف‌شدنی نیست
     * (قاعده‌اش در `save` اعمال می‌شود): طبق مقررات پیامک تبلیغاتی، پیام
     * اطلاع‌رسانی/تبلیغاتی باید راه لغو داشته باشد. اگر کاربر آن را از قالب
     * بردارد، ذخیره رد می‌شود تا مشتری‌ها بی‌راه‌فرار پیام تبلیغاتی نگیرند.
     */
    body: '{customer_name} عزیز، {campaign_text} — {store_name} · {opt_out_note}'
  },
  {
    code: 'TEST',
    title: 'پیام آزمایشی اتصال',
    category: 'SYSTEM',
    body: 'این یک پیام آزمایشی از {store_name} است. اگر آن را دیدید، اتصال سرویس پیامک درست کار می‌کند.'
  }
]

const TEMPLATE_CODES = new Set(DEFAULT_SMS_TEMPLATES.map((t) => t.code))

function shape(row: any): SmsTemplateRow {
  return {
    id: row.id,
    code: String(row.code),
    title: String(row.title),
    category: String(row.category ?? 'SYSTEM'),
    body: String(row.body ?? ''),
    isActive: row.isActive !== false,
    isSystem: row.isSystem === true,
    version: Math.round(Number(row.version ?? 1)) || 1,
    placeholders: smsPlaceholdersOf(String(row.body ?? '')),
    updatedAtJalali: row.updatedAt ? toJalaliDate(new Date(row.updatedAt)) : null
  }
}

export const smsTemplateService = {
  /**
   * ساخت قالب‌های سیستمیِ جاافتاده. **فقط اضافه می‌کند** و هیچ‌وقت متن موجودی
   * را بازنویسی نمی‌کند — پس متنِ ویرایش‌شده‌ی کاربر با هر بار بالا آمدن
   * برنامه پاک نمی‌شود.
   */
  async ensureDefaults(): Promise<number> {
    let created = 0
    for (const t of DEFAULT_SMS_TEMPLATES) {
      const exists = await prisma.smsTemplate.findUnique({ where: { code: t.code } }).catch(() => null)
      if (exists) continue
      await prisma.smsTemplate.create({
        data: {
          code: t.code,
          title: t.title,
          category: t.category,
          body: t.body,
          isSystem: true,
          isActive: true
        }
      })
      created++
    }
    return created
  },

  async list(): Promise<SmsTemplateRow[]> {
    const rows = await (prisma as any).smsTemplate.findMany({ orderBy: [{ category: 'asc' }, { id: 'asc' }] })
    return (rows ?? []).map(shape)
  },

  async get(code: string): Promise<SmsTemplateRow | null> {
    const row = await (prisma as any).smsTemplate.findUnique({ where: { code: String(code) } })
    return row ? shape(row) : null
  },

  /** متنِ زنده‌ی یک قالب (برای ساخت پیام). قالب خاموش یا ناموجود ⇒ null. */
  async bodyOf(code: string): Promise<string | null> {
    const row = await (prisma as any).smsTemplate.findUnique({ where: { code: String(code) } })
    if (!row || row.isActive === false) return null
    return String(row.body ?? '')
  },

  async save(input: {
    code: string
    title?: string
    body: string
    isActive?: boolean
    managerPassword?: string | null
    userId?: number | null
  }): Promise<SmsTemplateRow> {
    const code = String(input?.code ?? '').trim()
    if (!code) throw new BusinessError('کد قالب مشخص نیست.')
    const body = String(input?.body ?? '')

    const check = validateSmsBody(body)
    if (!check.ok) throw new BusinessError(check.reason)

    const existing = await (prisma as any).smsTemplate.findUnique({ where: { code } })
    if (!existing) throw new BusinessError(`قالب «${code}» وجود ندارد.`)

    /**
     * پیامک تبلیغاتی بدون راه لغو ذخیره نمی‌شود.
     *
     * چرا اینجا و نه فقط سرِ ارسال: اگر فقط هنگام فرستادن چک می‌شد، کاربر متن
     * را ذخیره می‌کرد و بعد می‌فهمید که فرستادنی نیست. اینجا همان لحظه‌ی
     * ویرایش گفته می‌شود. هم متغیر `{opt_out_note}` پذیرفته است، هم نوشتن
     * خودِ جمله («لغو ۱۱») — چون کاربر ممکن است دستی تایپش کند.
     */
    if (String(existing.category ?? '') === 'CAMPAIGN') {
      const hasNote =
        smsPlaceholdersOf(body).includes('opt_out_note') || body.includes(DEFAULT_SMS_OPT_OUT_NOTE)
      if (!hasNote)
        throw new BusinessError(
          `متن پیامک تبلیغاتی باید جمله‌ی لغو داشته باشد (مثلاً «${DEFAULT_SMS_OPT_OUT_NOTE}» یا متغیر {opt_out_note}) — ` +
            'پیام تبلیغاتی بدون راه لغو برای مشتری فرستاده نمی‌شود.'
        )
    }

    const next = await (prisma as any).smsTemplate.update({
      where: { code },
      data: {
        body,
        title: input?.title != null && String(input.title).trim() ? String(input.title).trim() : existing.title,
        isActive: input?.isActive !== false,
        version: (Math.round(Number(existing.version ?? 1)) || 1) + 1,
        updatedByUserId: input?.userId ?? null
      }
    })

    await audit(prisma, {
      action: AuditAction.SMS_TEMPLATE_SAVE,
      entity: 'SmsTemplate',
      entityId: next.id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ body: existing.body }),
      after: JSON.stringify({ body: next.body }),
      note: `ویرایش قالب پیامک «${next.title}» (${code}) — نسخه ${next.version}`
    })

    return shape(next)
  },

  /** بازگرداندن یک قالب سیستمی به متن پیش‌فرض. */
  async reset(codeInput: string, userId?: number | null): Promise<SmsTemplateRow> {
    const code = String(codeInput ?? '').trim()
    const def = DEFAULT_SMS_TEMPLATES.find((t) => t.code === code)
    if (!def) throw new BusinessError('فقط قالب‌های پیش‌فرضِ برنامه قابل بازگرداندن‌اند.')
    const existing = await (prisma as any).smsTemplate.findUnique({ where: { code } })
    if (!existing) throw new BusinessError(`قالب «${code}» وجود ندارد.`)

    const next = await (prisma as any).smsTemplate.update({
      where: { code },
      data: {
        body: def.body,
        version: (Math.round(Number(existing.version ?? 1)) || 1) + 1,
        updatedByUserId: userId ?? null
      }
    })

    await audit(prisma, {
      action: AuditAction.SMS_TEMPLATE_RESET,
      entity: 'SmsTemplate',
      entityId: next.id,
      userId: userId ?? null,
      before: JSON.stringify({ body: existing.body }),
      after: JSON.stringify({ body: next.body }),
      note: `بازگرداندن قالب پیامک «${code}» به متن پیش‌فرض`
    })

    return shape(next)
  },

  /** آیا این کد یک قالب سیستمیِ شناخته‌شده است؟ */
  isKnownCode(code: unknown): boolean {
    return TEMPLATE_CODES.has(String(code ?? ''))
  }
}
