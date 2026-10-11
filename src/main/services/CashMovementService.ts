import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { audit } from './AuditService'
import { shiftService } from './ShiftService'
import { BusinessError } from '../errors'
import { AuditAction, CashMovementType } from '@shared/enums'
import { toJalaliDate, toClock, jalaliStartOfDay, jalaliEndOfDay, jalaliToday, money, faDigits } from '@shared/jalali'
import { reportDayInput } from './reportDate'
import { toNumberRial } from '@shared/money'

type Client = Prisma.TransactionClient | typeof prisma

function assertPositiveSafeInteger(value: unknown, label = 'مبلغ گردش نقدی'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new BusinessError(
      `${label} باید عدد صحیح بزرگ‌تر از صفر باشد؛ اعشار، منفی، NaN، بی‌نهایت یا عدد خارج از سقف امن پذیرفته نیست.`
    )
  return value
}

/**
 * ===========================================================================
 * «گردش نقدی صندوق» — بند ۱۶ سند مرجع (مهم‌ترین حفره‌ی ساختاری کل کار).
 *
 * ================== چرا این مدل لازم است؟ ==================
 * بدون «موجودی اول شیفت» و بدون ثبت «برداشت/واریز وسط شیفت»، تشخیص کسری واقعی
 * از نظر حسابداری **ممکن نیست**: نمی‌دانی صندوق با چند شروع شده و در طول روز
 * غیر از فروش چه پولی وارد/خارج شده. هر عددی که بدون این دو محاسبه شود، یک
 * حدس است، نه یک صورت مالی.
 *
 * ================== قاعده‌ی علامت ==================
 * `amount` همیشه **مثبت** ذخیره می‌شود؛ جهتِ اثر از `type` می‌آید. اگر علامت را
 * در مبلغ می‌گذاشتیم، اولین `SUM(amount)` جایی در کد، دو نوع مخالف را با هم
 * خنثی می‌کرد و کسری نامرئی می‌شد.
 *
 *   ورودی به کشو : CASH_IN · DEPOSIT · OPENING_FLOAT
 *   خروج از کشو  : CASH_OUT · WITHDRAWAL · RETURN_REFUND · EXCHANGE_REFUND
 *
 * ⚠️ `OPENING_FLOAT` در `expectedCash` به‌عنوان *پایه* می‌نشیند، نه به‌عنوان
 * «واریز». پس در `cashMovementTotals` جدا برگردانده می‌شود و در `deposits`
 * شمرده نمی‌شود — وگرنه موجودی اول دوبار حساب می‌شد.
 * ===========================================================================
 */

/** انواعی که پول را از کشو *بیرون* می‌برند. */
export const CASH_OUT_TYPES: readonly string[] = [
  CashMovementType.CASH_OUT,
  CashMovementType.WITHDRAWAL,
  CashMovementType.RETURN_REFUND,
  CashMovementType.EXCHANGE_REFUND
]

const LABELS: Record<string, string> = {
  CASH_IN: 'واریز به صندوق',
  CASH_OUT: 'برداشت از صندوق',
  RETURN_REFUND: 'بازپرداخت نقدی برگشت از فروش',
  EXCHANGE_REFUND: 'بازپرداخت نقدی مابه‌التفاوت تعویض',
  OPENING_FLOAT: 'موجودی اول صندوق',
  DEPOSIT: 'واریز وسط شیفت',
  WITHDRAWAL: 'برداشت وسط شیفت'
}

export function cashMovementLabel(type: string): string {
  return LABELS[type] ?? type
}

/**
 * ثبت یک گردش نقدی. **همیشه داخل همان تراکنشی صدا زده می‌شود که رویدادِ مالی
 * را ساخته** (برگشت، تعویض، بستن صندوق) تا هیچ‌وقت یک بازپرداخت ثبت شود ولی
 * رد نقدی‌اش نه.
 */
export async function recordCashMovement(
  client: Client,
  input: {
    amount: number
    type: string
    shiftId?: number | null
    userId?: number | null
    description?: string | null
    refType?: string | null
    refId?: number | null
    occurredAt?: Date
  }
): Promise<any> {
  const amount = assertPositiveSafeInteger(input.amount)
  if (!Object.values(CashMovementType).includes(input.type as any))
    throw new BusinessError('نوع گردش نقدی نامعتبر است.')
  const at = input.occurredAt ?? new Date()

  const row = await client.cashMovement.create({
    data: {
      amount,
      type: input.type,
      occurredAt: at,
      occurredAtJalali: toJalaliDate(at),
      occurredAtTime: toClock(at),
      shiftId: input.shiftId ?? null,
      userId: input.userId ?? null,
      description: input.description ?? cashMovementLabel(input.type),
      refType: input.refType ?? null,
      refId: input.refId ?? null
    }
  })

  await audit(client, {
    action: AuditAction.CASH_MOVEMENT,
    entity: 'CashMovement',
    entityId: row.id,
    userId: input.userId ?? null,
    after: JSON.stringify({
      amount,
      type: input.type,
      shiftId: input.shiftId ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      direction: CASH_OUT_TYPES.includes(input.type) ? 'OUT' : 'IN'
    }),
    note:
      `${cashMovementLabel(input.type)} به مبلغ ${money(amount)} ریال` +
      (input.description ? ` · ${input.description}` : '')
  })

  return row
}

export const cashMovementService = {
  /**
   * ثبت دستیِ برداشت/واریز از پنل بستن صندوق (کانال `cashbox:movement:add`).
   *
   * فقط چهار نوعِ «دستی» پذیرفته می‌شود. بازپرداخت‌ها (`RETURN_REFUND` /
   * `EXCHANGE_REFUND`) عمداً از این مسیر بسته‌اند: آن‌ها باید فقط از دلِ خودِ
   * سند برگشت/تعویض ساخته شوند، وگرنه می‌شد یک خروج نقدی بی‌سند جا زد.
   */
  async add(input: {
    amount?: number
    type?: string
    shiftId?: number | null
    userId?: number | null
    description?: string | null
    /** سرور در حالت حضانت می‌سازد؛ renderer هرگز نباید آن را جعل کند. */
    custodyFence?: any
  } = {}) {
    const allowed: readonly string[] = [
      CashMovementType.OPENING_FLOAT,
      CashMovementType.DEPOSIT,
      CashMovementType.WITHDRAWAL,
      CashMovementType.CASH_IN,
      CashMovementType.CASH_OUT
    ]
    const type = String(input.type ?? '')
    if (!allowed.includes(type))
      throw new BusinessError(
        'از این پنل فقط «موجودی اول صندوق»، «واریز» و «برداشت» ثبت می‌شود.\n' +
          'بازپرداخت برگشت و تعویض خودکار و از دلِ همان سند ثبت می‌شوند و دستی قابل ثبت نیستند.'
      )
    const amount = assertPositiveSafeInteger(input.amount, 'مبلغ گردش نقدی')
    if (type === CashMovementType.WITHDRAWAL || type === CashMovementType.CASH_OUT) {
      const reason = String(input.description ?? '').trim()
      if (reason.length < 3)
        throw new BusinessError(
          'برای برداشت از صندوق باید دلیل بنویسید (حداقل ۳ نویسه) تا در سابقه بماند.'
        )
    }

    return prisma.$transaction(async (tx) => {
      /**
       * ممیزی AUDIT-S139-01 (AUDIT-D68) — گردش دستی فقط روی «نشست باز» همین لحظه می‌نشیند.
       * قبلاً shiftId ارسالی renderer (نشستی که صفحه‌ی بستن صندوق نشان می‌داد، حتی بسته‌ی دیروز)
       * بی‌سنجش پذیرفته می‌شد؛ چون occurredAt همیشه «الان» است، گردش بیرون از پنجره‌ی آن نشست
       * می‌افتاد و از «نقد مورد انتظار» هر دو نشست غایب می‌شد (برداشت ۵۰۰٬۰۰۰ ⇒ کسری کاذب نشست
       * باز؛ واریز ⇒ اضافه‌ی پنهان). بند ۳: بدون نشست باز هیچ حرکت صندوقی مجاز نیست.
       */
      const open = await shiftService.shiftForNow(tx, { custodyFence: (input as any).custodyFence ?? null })
      if (!open)
        throw new BusinessError('برای ثبت گردش نقدی (واریز/برداشت/موجودی اول) ابتدا یک نشست باز لازم است.')
      if (input.shiftId != null && Number(input.shiftId) !== Number(open.id))
        throw new BusinessError(
          'گردش نقدی فقط روی نشست باز همین لحظه ثبت می‌شود؛ نشست انتخاب‌شده در صفحه نشست باز نیست.\n' +
            'برای اصلاح صندوقِ نشستی که بسته شده، گردش را در نشست باز فعلی با توضیح ثبت کنید.'
        )
      const shiftId = Number(open.id)
      /**
       * «موجودی اول صندوق» فقط **یک بار** برای هر شیفت ثبت می‌شود. اگر دوباره
       * ثبت می‌شد، `expectedCash` هر بار بالاتر می‌رفت و کسری واقعی پنهان
       * می‌ماند — یعنی همان چیزی که این ماژول برای کشفش ساخته شده است.
       */
      if (type === CashMovementType.OPENING_FLOAT && shiftId != null) {
        const already = await tx.cashMovement.findFirst({
          where: { shiftId, type: CashMovementType.OPENING_FLOAT },
          select: { id: true, amount: true }
        })
        if (already)
          throw new BusinessError(
            `موجودی اول این شیفت قبلاً ${money(already.amount)} ریال ثبت شده است.\n` +
              'برای اصلاحش یک «واریز» یا «برداشت» با توضیح ثبت کنید تا سابقه دست‌نخورده بماند.'
          )
      }

      const row = await recordCashMovement(tx, {
        amount,
        type,
        shiftId,
        userId: input.userId ?? null,
        description: input.description ?? null
      })
      return this.shape(row)
    })
  },

  /** فهرست گردش‌های نقدی یک شیفت یا بازه (پنل بستن صندوق و گزارش). */
  async list(
    filter: {
      shiftId?: number | null
      userId?: number | null
      fromJalali?: string
      toJalali?: string
      take?: number
      skip?: number
    } = {}
  ) {
    // ممیزی A114-01 — '' ⇒ پیش‌فرض (امروز / کل نشست)، نامعتبر ⇒ خطای فارسی (نه Invalid Date و فهرست خالی بی‌صدا)
    filter = {
      ...filter,
      fromJalali: reportDayInput(filter.fromJalali, 'از تاریخ', 'گردش صندوق'),
      toJalali: reportDayInput(filter.toJalali, 'تا تاریخ', 'گردش صندوق')
    }
    const fromJalali = filter.fromJalali ?? filter.toJalali ?? jalaliToday()
    const toJalali = filter.toJalali ?? filter.fromJalali ?? jalaliToday()
    /**
     * ممیزی A92-01 — نشست بدون تاریخ صریح = کل همان نشست (شیفت شب عبوری از نیمه‌شب، بند ۴-۱۴)؛
     * پیش‌فرض «امروز» (بند ۴-۲۳) فقط وقتی نه نشست داده شده نه تاریخ. نشست + تاریخ صریح = هر دو قید (S92).
     */
    const explicitDates = !!(filter.fromJalali || filter.toJalali)
    const where = {
      ...(filter.shiftId != null ? { shiftId: filter.shiftId } : {}),
      ...(filter.userId != null ? { userId: filter.userId } : {}),
      ...(filter.shiftId != null && !explicitDates
        ? {}
        : {
            occurredAt: {
              gte: jalaliStartOfDay(fromJalali),
              lte: jalaliEndOfDay(toJalali)
            }
          })
    }
    /**
     * نشست ۱۱۴ · بند ۴-۴۶ و ۴-۹ — جمع‌ها قبلاً از همان ردیف‌های بریده‌شده (سقف
     * ۵۰۰) حساب می‌شدند و برداشت/بازپرداختِ بعد از ردیف ۵۰۰ بی‌صدا از جمع حذف
     * می‌شد. حالا جمع‌ها با groupBy روی *کل* بازه حساب می‌شوند و فقط فهرست
     * نمایشی صفحه‌بندی می‌شود، با totalCount و هشدار فارسی صریح.
     */
    const parsedTake = Math.round(Number(filter.take ?? 500))
    const parsedSkip = Math.round(Number(filter.skip ?? 0))
    const take = Math.min(Math.max(Number.isFinite(parsedTake) ? parsedTake : 500, 1), 5000)
    const skip = Math.max(Number.isFinite(parsedSkip) ? parsedSkip : 0, 0)
    const [rows, groups] = await Promise.all([
      prisma.cashMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        skip,
        take
      }),
      prisma.cashMovement.groupBy({ by: ['type'], where, _sum: { amount: true }, _count: { _all: true } })
    ])
    const sumOf = (types: string[]) =>
      (groups as any[])
        .filter((g) => types.includes(g.type))
        .reduce((s, g) => s + Math.round(Number(g._sum?.amount ?? 0)), 0)
    const totalCount = (groups as any[]).reduce((s, g) => s + Number(g._count?._all ?? g._count ?? 0), 0)
    const shaped = rows.map((r) => this.shape(r))
    const page = { skip, take, totalCount, truncated: totalCount > skip + shaped.length }
    const warnings =
      totalCount > shaped.length
        ? [
            `نمایش ${faDigits(shaped.length)} از ${faDigits(totalCount)} گردش صندوق (از ردیف ${faDigits(skip + 1)})؛ ` +
              'جمع موجودی اول، واریز، برداشت و بازپرداخت روی کل بازه حساب شده‌اند، نه فقط این صفحه.'
          ]
        : []
    return {
      rows: shaped,
      page,
      warnings,
      totals: {
        openingFloat: sumOf([CashMovementType.OPENING_FLOAT]),
        deposits: sumOf([CashMovementType.DEPOSIT, CashMovementType.CASH_IN]),
        withdrawals: sumOf([CashMovementType.WITHDRAWAL, CashMovementType.CASH_OUT]),
        refunds: sumOf([CashMovementType.RETURN_REFUND, CashMovementType.EXCHANGE_REFUND])
      }
    }
  },

  shape(r: any) {
    return {
      id: r.id,
      amount: toNumberRial(r.amount ?? 0),
      type: r.type,
      typeLabel: cashMovementLabel(r.type),
      /** OUT = از کشو بیرون رفت · IN = به کشو آمد */
      direction: CASH_OUT_TYPES.includes(r.type) ? ('OUT' as const) : ('IN' as const),
      dateJalali: r.occurredAtJalali || toJalaliDate(r.occurredAt),
      time: r.occurredAtTime || toClock(r.occurredAt),
      shiftId: r.shiftId ?? null,
      userId: r.userId ?? null,
      description: r.description ?? '',
      refType: r.refType ?? null,
      refId: r.refId ?? null,
      amountLabel: `${money(toNumberRial(r.amount ?? 0))} ریال`,
      idLabel: faDigits(r.id)
    }
  }
}
