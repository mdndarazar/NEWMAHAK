import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { StockReason, StockState } from '@shared/enums'
import { audit } from './AuditService'
import { faDigits } from '@shared/jalali'
import { TX_OPTIONS } from '../db/tx'

/**
 * نشست ۱۴۴ · بند ۳ و ۴-۴۲ — کمیت انبار همیشه عدد صحیح است. دفتر انبار
 * append-only است، پس مقدار اعشاری/NaN/خارج از سقف اگر یک بار بنشیند دیگر پاک
 * نمی‌شود؛ به‌جای گرد بی‌صدا (Math.round) کل عملیات با پیام فارسی رد می‌شود.
 */
export function assertStockInteger(value: unknown, label: string, opts: { allowNegative?: boolean; positive?: boolean } = {}): number {
  const ok =
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (opts.allowNegative || value >= 0) &&
    (!opts.positive || value > 0)
  if (!ok)
    throw new Error(
      `${label} باید عدد صحیح ${opts.positive ? 'بزرگ‌تر از صفر' : opts.allowNegative ? '(مثبت، صفر یا منفی)' : 'صفر یا بیشتر'} (عدد) باشد؛ ` +
        `مقدار «${String(value)}» پذیرفته نیست (اعشار، متن یا عدد خیلی بزرگ به عدد دیگری تبدیل نمی‌شود). موجودی تغییر نکرد.`
    )
  return value as number
}

/**
 * ممیزی AUDIT-S144-02 (AUDIT-D77) — increase/decrease قبلاً پیش از هر سنجشی Math.abs می‌زدند؛
 * پس "3" ⇒ ۳، null/"" ⇒ ۰ (بی‌صدا و بی‌حرکت)، true ⇒ ۱ و تعداد منفی در increase علامتش برمی‌گشت.
 * StockChange.qty طبق قرارداد همیشه صفر یا مثبت است و جهت را متد تعیین می‌کند؛ مقدار *خام* همین‌جا
 * و پیش از اولین نوشتن سنجیده می‌شود (کل دسته، نه ردیف‌به‌ردیف).
 */
function assertDirectedQty(changes: StockChange[]): StockChange[] {
  for (const c of changes ?? []) {
    assertStockInteger(c?.variantId, 'شناسه‌ی کالا', { positive: true })
    assertStockInteger(c?.qty, `تعداد حرکت انبار کالای ${faDigits(String(c?.variantId))}`)
  }
  return changes ?? []
}

/** lookupهای گروهی در SQLite/Prisma از سقف امن پارامترها عبور نکنند. */
const VARIANT_IN_CHUNK = 500

function variantIdChunks(ids: Iterable<number>): number[][] {
  const unique = [...new Set([...ids].map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  const chunks: number[][] = []
  for (let i = 0; i < unique.length; i += VARIANT_IN_CHUNK) chunks.push(unique.slice(i, i + VARIANT_IN_CHUNK))
  return chunks
}

/**
 * ------------------------------------------------------------------
 * لایه‌ی واحد دسترسی به موجودی انبار.
 *
 * ⚠️ قاعده‌ی به‌روزشده (مورد ۳): این لایه هیچ‌وقت مانع فروش نمی‌شود. کمبود
 * موجودی فقط «هشدار» است (checkAvailability) و موجودی می‌تواند منفی شود.
 * قانون پروژه: هیچ ماژول دیگری (POS، خرید، برگشت، UI) مستقیماً
 * ProductVariant.stock یا StockMovement را نمی‌نویسد. همه از این
 * interface رد می‌شوند.
 *
 * دلیل معماری (فاز دوم): وقتی Sync ووکامرس اضافه شود، یک پیاده‌سازی
 * دیگر از IInventoryService (مثلاً SyncingInventoryService که بعد از
 * commit محلی، صف push به REST API ووکامرس را پر می‌کند) جایگزین/
 * wrap می‌شود، بدون تغییر در هیچ‌جای دیگر کد.
 *
 * ⚠️ قاعده‌ی تراکنش: هر متد یک پارامتر اختیاری `tx` دارد. اگر از داخل یک
 * تراکنش باز صدا زده می‌شود، *باید* همان `tx` پاس داده شود؛ استفاده از
 * کلاینت سراسری داخل تراکنشِ باز روی SQLite بن‌بست می‌سازد.
 * ------------------------------------------------------------------
 */
export interface StockChange {
  variantId: number
  qty: number // همیشه مثبت؛ جهت را reason/متد تعیین می‌کند
}

export interface MovementContext {
  reason: keyof typeof StockReason
  refType?: string
  refId?: number
  warehouseId?: number | null
  userId?: number | null
  note?: string
  /**
   * نشست ۱۴۵ · بند ۴-۳۹/۴-۳۰ — متن اضافه‌ای که *فقط* به یادداشت AuditLog همان
   * حرکت اضافه می‌شود (مثلاً «تأیید: رمز مدیر»)؛ StockMovement.note همان
   * توضیح کاربر می‌ماند تا دفتر گردش انبار شلوغ/گمراه‌کننده نشود.
   */
  auditNote?: string | null
  /** PENDING فقط برای فروش روزانه؛ با «تجمیع و انتقال» FINAL می‌شود. */
  state?: keyof typeof StockState
}

export interface IInventoryService {
  getStock(variantId: number, tx?: Prisma.TransactionClient): Promise<number>
  /**
   * بررسی کفایت موجودی برای یک کسر برنامه‌ریزی‌شده.
   *
   * ⚠️ رفتار به‌روزشده (مورد ۳): این متد هیچ‌وقت عملیات را متوقف نمی‌کند و هیچ
   * خطایی پرتاب نمی‌کند. فقط فهرست «هشدارهای» فارسی را برمی‌گرداند تا UI همان
   * کادر زرد همیشگی را نشان دهد، ولی فاکتور صادر و چاپ شود و موجودی همان کالا
   * در انبار فروشگاه *منفی* ثبت گردد.
   *
   * خروجی خالی = موجودی همه‌ی اقلام کافی است.
   */
  checkAvailability(changes: StockChange[], tx?: Prisma.TransactionClient): Promise<string[]>
  decrease(changes: StockChange[], ctx: MovementContext, tx?: Prisma.TransactionClient): Promise<void>
  increase(changes: StockChange[], ctx: MovementContext, tx?: Prisma.TransactionClient): Promise<void>
  setStock(variantId: number, newQty: number, ctx: MovementContext, tx?: Prisma.TransactionClient): Promise<void>
  finalizePending(
    consolidationId: number,
    from: Date,
    to: Date,
    tx?: Prisma.TransactionClient
  ): Promise<number>
  /**
   * قطعی‌کردن کسر انبارِ *دقیقاً همان فاکتورهایی* که تجمیع می‌شوند.
   * مبنای درست «تجمیع با تأخیر» است: بازه‌ی تاریخ ساخت حرکت (createdAt) وقتی
   * فاکتور با تاریخ دلخواه ثبت شده یا روز عقب‌افتاده تجمیع می‌شود قابل اتکا
   * نیست، ولی رابطه‌ی refType/refId همیشه درست است.
   */
  finalizePendingForInvoices(
    consolidationId: number,
    invoiceIds: number[],
    tx?: Prisma.TransactionClient
  ): Promise<number>
  /** جمع حرکات موقت (PENDING) مربوط به مجموعه‌ای از فاکتورها. */
  pendingSummaryForInvoices(
    invoiceIds: number[],
    tx?: Prisma.TransactionClient
  ): Promise<{ movements: number; qty: number }>
}


/** نشست ۱۷۵ · S175-D3 — شناسه‌های یکتا در دسته‌های ۵۰۰تایی (سقف IN پروژه، S99-2). */
function movementRefChunks(ids: number[]): number[][] {
  const uniq = [...new Set(ids)]
  const out: number[][] = []
  for (let i = 0; i < uniq.length; i += 500) out.push(uniq.slice(i, i + 500))
  return out
}

class LocalInventoryService implements IInventoryService {
  async getStock(variantId: number, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? prisma
    const v = await client.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true }
    })
    return v.stock
  }

  /**
   * «موجودی کافی نیست» — از این به بعد فقط *هشدار*، نه مانع (مورد ۳).
   *
   * تصمیم به‌روزشده‌ی مالک نرم‌افزار: هیچ‌وقت جلوی صدور فاکتور گرفته نشود.
   * پس اگر ۳۵ عدد موجود باشد و ۴۰ عدد فروخته شود، فاکتور ثبت و چاپ می‌شود و
   * موجودی همان کالا ۵- می‌شود؛ فقط همان پیام زرد همیشگی به فروشنده نشان داده
   * می‌شود تا بداند باید با فاکتور خرید یا اصلاح دستی جبرانش کند.
   *
   * چند قلم از یک واریانت اول جمع می‌شوند (وگرنه ۳ ردیف ۵ تایی از یک کالا با
   * موجودی ۱۰ اشتباهاً «کافی» شمرده می‌شد) و پیام، اسم کامل کالا، تعداد واقعاً
   * موجود و مقدار کمبود را می‌گوید.
   */
  async checkAvailability(changes: StockChange[], tx?: Prisma.TransactionClient): Promise<string[]> {
    const client = tx ?? prisma
    const need = new Map<number, number>()
    for (const c of changes) {
      const qty = Math.abs(Math.round(c.qty))
      if (qty > 0) need.set(c.variantId, (need.get(c.variantId) ?? 0) + qty)
    }
    if (!need.size) return []

    /**
     * نشست ۱۸۰ (S180-D7، گام ۰ خوشه M) — `Awaited<ReturnType<typeof
     * findMany>>` بدون آرگومان به تایپ *کاملِ* ProductVariant حل می‌شد، نه شکل
     * `select` زیر؛ در نتیجه `v.product` وجود نداشت (TS2551) و push هم رد
     * می‌شد (TS2345). تایپ صریح دقیقاً همان ستون‌های انتخاب‌شده است. حلقه‌ی
     * ترتیبی و رفتار زمان‌اجرا دست‌نخورده می‌ماند.
     */
    const variants: Array<{
      id: number
      stock: number
      size: string | null
      color: string | null
      product: { name: string; unit: string }
    }> = []
    for (const ids of variantIdChunks(need.keys())) {
      variants.push(
        ...(await client.productVariant.findMany({
          where: { id: { in: ids } },
          select: { id: true, stock: true, size: true, color: true, product: { select: { name: true, unit: true } } }
        }))
      )
    }

    const shortages: string[] = []
    for (const [variantId, qty] of need) {
      const v = variants.find((x) => x.id === variantId)
      if (!v) {
        shortages.push('یکی از کالاهای فاکتور در سیستم پیدا نشد؛ آن ردیف را حذف و دوباره انتخاب کنید')
        continue
      }
      if (v.stock < qty) {
        const title = `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
        const unit = v.product?.unit ?? 'عدد'
        shortages.push(
          `«${title}»: موجودی کافی نیست، فقط ${faDigits(v.stock)} ${unit} موجود است (درخواست شما ${faDigits(qty)} ${unit})؛ ` +
            `فاکتور صادر شد و موجودی این کالا ${faDigits(v.stock - qty)} (منفی) ثبت گردید.`
        )
      }
    }

    if (shortages.length)
      shortages.push(
        'برای جبران، با فاکتور خرید یا «بروزرسانی موجودی» در پنل کالاها موجودی را وارد کنید. ' +
          '(در فاکتور فروش عمده اگر کالا از انبار دیگری تامین می‌شود، می‌توانید «کسر از موجودی انبار» را غیرفعال کنید.)'
      )
    return shortages
  }

  /** کسر موجودی. اتمیک: در یک تراکنش، هم movement ثبت می‌شود هم کش stock. */
  async decrease(changes: StockChange[], ctx: MovementContext, tx?: Prisma.TransactionClient) {
    await this.apply(assertDirectedQty(changes).map((c) => ({ ...c, qty: -c.qty })), ctx, tx)
  }

  /** افزایش موجودی (خرید، برگشت از فروش، اصلاح انبارگردانی). */
  async increase(changes: StockChange[], ctx: MovementContext, tx?: Prisma.TransactionClient) {
    await this.apply(assertDirectedQty(changes), ctx, tx)
  }

  /**
   * «بروزرسانی موجودی» دستی: اختلاف را به‌عنوان یک حرکت ثبت می‌کند.
   * موجودی منفی هم پذیرفته می‌شود (نرم‌افزار شخصی است؛ تصمیم با کاربر است)،
   * فقط سابقه‌اش در StockMovement می‌ماند.
   */
  async setStock(variantId: number, newQty: number, ctx: MovementContext, tx?: Prisma.TransactionClient) {
    assertStockInteger(variantId, 'شناسه‌ی کالا', { positive: true })
    const target = assertStockInteger(newQty, 'موجودی جدید', { allowNegative: true })
    const current = await this.getStock(variantId, tx)
    const delta = target - current
    if (delta === 0) return
    await this.apply([{ variantId, qty: delta }], { ...ctx, reason: ctx.reason ?? 'ADJUSTMENT' }, tx)
  }

  /**
   * «تجمیع و انتقال»: مهر تایید نهایی روی کسر انبار.
   * همه‌ی حرکات PENDING بازه‌ی انتخابی به FINAL تبدیل و به consolidation
   * گره می‌خورند. موجودی عددی از قبل کم شده است؛ این عملیات آن را قطعی
   * و غیرقابل‌بازگشت (به‌جز برگشت از فروش) اعلام می‌کند.
   *
   * ⚠️ این متد از داخل تراکنشِ CashboxService.finalize صدا زده می‌شود، پس
   * حتماً باید با همان `tx` کار کند (قبلاً از prisma سراسری استفاده می‌کرد و
   * همان بن‌بست تراکنش را می‌ساخت).
   */
  async finalizePending(
    consolidationId: number,
    from: Date,
    to: Date,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? prisma
    const res = await client.stockMovement.updateMany({
      where: { state: StockState.PENDING, createdAt: { gte: from, lte: to } },
      data: { state: StockState.FINAL, consolidationId }
    })
    return res.count
  }

  /**
   * «تجمیع و انتقال» برای مجموعه‌ای مشخص از فاکتورها.
   * همه‌ی حرکات PENDING که سندشان یکی از این فاکتورها است، FINAL می‌شوند و به
   * رکورد Consolidation گره می‌خورند. اگر روزی با تأخیر تجمیع شود، همین مسیر
   * دقیقاً همان حرکات را می‌گیرد (مستقل از createdAt).
   */
  async finalizePendingForInvoices(
    consolidationId: number,
    invoiceIds: number[],
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    if (!invoiceIds.length) return 0
    const client = tx ?? prisma
    /** نشست ۱۷۵ · S175-D3 — دسته‌های ۵۰۰تایی (سقف IN، S99-2)؛ شمارش جمع دسته‌هاست. */
    let count = 0
    for (const ids of movementRefChunks(invoiceIds)) {
      const res = await client.stockMovement.updateMany({
        where: { state: StockState.PENDING, refType: 'SaleInvoice', refId: { in: ids } },
        data: { state: StockState.FINAL, consolidationId }
      })
      count += res.count
    }
    return count
  }

  /** پیش‌نمایش: چند حرکت و چه تعدادی با تجمیع این فاکتورها قطعی می‌شود. */
  async pendingSummaryForInvoices(
    invoiceIds: number[],
    tx?: Prisma.TransactionClient
  ): Promise<{ movements: number; qty: number }> {
    if (!invoiceIds.length) return { movements: 0, qty: 0 }
    const client = tx ?? prisma
    /** نشست ۱۷۵ · S175-D3 — همان دسته‌بندی finalizePendingForInvoices تا پیش‌نمایش = اجرای واقعی */
    const rows: Array<{ delta: number }> = []
    for (const ids of movementRefChunks(invoiceIds))
      rows.push(
        ...(await client.stockMovement.findMany({
          where: { state: StockState.PENDING, refType: 'SaleInvoice', refId: { in: ids } },
          select: { delta: true }
        }))
      )
    return { movements: rows.length, qty: rows.reduce((s, r) => s + Math.abs(r.delta), 0) }
  }

  private async apply(
    changes: { variantId: number; qty: number }[],
    ctx: MovementContext,
    tx?: Prisma.TransactionClient
  ) {
    // نشست ۱۴۴ — همه‌ی ردیف‌ها *پیش از* اولین نوشتن سنجیده می‌شوند.
    for (const c of changes) {
      assertStockInteger(c.variantId, 'شناسه‌ی کالا', { positive: true })
      assertStockInteger(c.qty, `تعداد حرکت انبار کالای ${faDigits(String(c.variantId))}`, { allowNegative: true })
    }
    const run = async (client: Prisma.TransactionClient) => {
      for (const c of changes) {
        if (c.qty === 0) continue
        const movement = await client.stockMovement.create({
          data: {
            variantId: c.variantId,
            warehouseId: ctx.warehouseId ?? null,
            delta: c.qty,
            reason: ctx.reason,
            state: ctx.state ?? StockState.FINAL,
            refType: ctx.refType,
            refId: ctx.refId,
            note: ctx.note
          }
        })
        const updated = await client.productVariant.update({
          where: { id: c.variantId },
          data: { stock: { increment: c.qty } },
          select: { stock: true }
        })
        /**
         * همگام‌سازی WooCommerce فقط بعد از ثبت قطعی حرکت در همان تراکنش outbox می‌سازد.
         * reasonهای خودِ سایت (`WOO_SYNC_*`) دوباره به سایت push نمی‌شوند تا loop و دوباره‌شماری نسازد.
         */
        try {
          const { enqueueWooForMovement } = await import('./WooSyncService')
          await enqueueWooForMovement(
            { movementId: movement.id, variantId: c.variantId, reason: ctx.reason, targetQty: updated.stock },
            client
          )
        } catch (e) {
          console.error('[wooSync] enqueue movement failed', e)
          try {
            await (client as any).wooSyncLog.create({
              data: {
                level: 'ERROR',
                action: 'OUTBOX_ENQUEUE_FAILED',
                variantId: c.variantId,
                message: String((e as any)?.message ?? e),
                payloadJson: JSON.stringify({ movementId: movement.id, reason: ctx.reason })
              }
            })
          } catch {}
          throw e
        }
      }
      /**
       * نشست ۱۶۹ (S169-D3، بند ۳ و ۵ «mutation اتمیک» و «هر audit شامل actor») — قبلاً Audit *بعد* از
       * run و بیرون از آن نوشته می‌شد ⇒ در مسیر بدون tx، حرکت انبار commit می‌شد و Audit جدا با کلاینت
       * سراسری می‌آمد (قطع/خطا بین این دو = اصلاح موجودی بی‌رد). حالا با همان client تراکنش نوشته می‌شود.
       * با tx صدازننده دقیقاً مثل قبل است (همان tx)؛ audit همچنان non-throwing است (S146-D5).
       */
      if (ctx.reason === 'ADJUSTMENT' || ctx.reason === 'STOCKTAKE' || ctx.reason === 'INITIAL') {
        await audit(client, {
          action: ctx.reason === 'INITIAL' ? 'STOCK_INITIAL' : 'STOCK_ADJUST',
          entity: 'ProductVariant',
          userId: ctx.userId ?? null,
          after: JSON.stringify(changes),
          note: ctx.auditNote ? [ctx.note, ctx.auditNote].filter((x) => x != null && String(x).trim() !== '').join(' · ') : ctx.note
        })
      }
    }

    if (tx) await run(tx)
    else await prisma.$transaction(run, TX_OPTIONS)
  }
}

/** تنها نقطه‌ی تزریق وابستگی. فاز دوم: اینجا پیاده‌سازی Sync-aware ست می‌شود. */
export const inventoryService: IInventoryService = new LocalInventoryService()
