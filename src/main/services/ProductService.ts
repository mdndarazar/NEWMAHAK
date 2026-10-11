import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { inventoryService, assertStockInteger } from './InventoryService'
import { audit } from './AuditService'
import { assertPanelPassword } from './AuthService'
import { TX_OPTIONS } from '../db/tx'
import { BusinessError } from '../errors'
import { AuditAction } from '@shared/enums'
import { faDigits } from '@shared/jalali'
import { PANEL_KEYS } from '@shared/panels'
import type { PagedRows } from '@shared/types'
import { toRial } from '@shared/money'
import { custodyService } from './CustodyService'

export interface VariantInput {
  id?: number
  code?: string
  barcode?: string
  size?: string | null
  color?: string | null
  salePrice: number
  purchasePrice: number
  /**
   * موجودی مستقیم از فرم کالا.
   * - واریانت جدید: موجودی اولیه (حرکت انبار INITIAL ثبت می‌شود)
   * - واریانت موجود: موجودی هدف (اختلافش به‌عنوان ADJUSTMENT ثبت می‌شود)
   * undefined = دست نزن.
   */
  stock?: number
  ledgerAccountCode?: string | null
}

export interface ProductInput {
  id?: number
  name: string
  categoryId?: number | null
  unit?: string
  note?: string | null
  /**
   * بند ۴-۳۴ — تیک «در گزارش آخرین نام را نشان بده». undefined در ویرایش =
   * همان مقدار قبلی (فرم‌های قدیمی/مسیرهای دیگر تیک را بی‌صدا خاموش نکنند).
   */
  reportLiveName?: boolean
  userId?: number | null
  /**
   * نشست ۱۴۶ · بند ۴-۳۹ — رمز مدیر یا رمز دوم پنل کالاها؛ فقط وقتی لازم است که
   * قیمت فروش/خرید یا موجودی یک واریانت *موجود* عوض شود.
   */
  managerPassword?: string | null
  variants: VariantInput[]
}

/** نشست ۱۴۶ · بند ۴-۳۹/۴-۳۰ — ورودی اصلاح دستی موجودی (IPC.stockAdjust). */
export interface StockAdjustInput {
  variantId: number
  newQty: number
  note?: string | null
  /** actor؛ در IPC همیشه از نشست باز main بازنویسی می‌شود، نه از renderer. */
  userId?: number | null
  managerPassword?: string | null
  /** Server-injected only when opt-in custody is active. */
  custodyFence?: any
}

/**
 * نشست ۱۴۶ · بند ۴-۳۰ — برچسب «با کدام تأیید» برای یادداشت AuditLog عملیات پنل
 * کالاها. PANEL هم رمز دوم پنل را می‌پوشاند و هم رمز سوم همان شیفت (verifyPanel
 * هر دو را PANEL برمی‌گرداند).
 */
export function productApprovalNote(scope: 'MANAGER' | 'PANEL' | 'OPEN'): string {
  if (scope === 'MANAGER') return 'تأیید: رمز مدیر'
  if (scope === 'PANEL') return 'تأیید: رمز دوم/سوم پنل کالاها'
  return 'تأیید: قفل پنل کالاها خاموش (سیاست مدیر)'
}

/**
 * ⚠️ نشست ۱۸۱ — قیمت‌ها از دیتابیس `bigint`اند ولی از فرم `number` می‌آیند.
 * پس هر دو شکل پذیرفته می‌شود و مقایسه از راه `toRial` انجام می‌گیرد.
 */
type VariantSnapshot = { salePrice: number | bigint; purchasePrice: number | bigint; stock: number }

/**
 * تغییر «حساس» یک واریانت موجود: قیمت فروش، قیمت خرید، یا موجودی (فقط وقتی stock فرستاده شده).
 *
 * 🔴 نشست ۱۸۱ — اینجا یک باگ واقعی کمین کرده بود: بعد از مهاجرت به BigInt،
 * `before.salePrice` از نوع `bigint` است و `v.salePrice` از نوع `number`. در
 * جاوااسکریپت `1000n !== 1000` **همیشه true** است، پس این تابع برای *هر* ذخیره
 * «تغییر حساس» گزارش می‌کرد — یعنی گیت رمز بی‌دلیل بالا می‌آمد و سابقه‌ی ممیزی
 * پر از ردیف «تغییر قیمت» می‌شد بدون آنکه قیمتی عوض شده باشد.
 * `toRial` هر دو طرف را به یک نمایش می‌آورد تا مقایسه دوباره معنا پیدا کند.
 */
function isSensitiveEdit(before: VariantSnapshot, v: VariantInput): boolean {
  return (
    toRial(before.salePrice) !== toRial(v.salePrice) ||
    toRial(before.purchasePrice) !== toRial(v.purchasePrice) ||
    (v.stock != null && v.stock !== before.stock)
  )
}

/**
 * نشست ۱۷۷ · S176-D3 — دسته‌های ۵۰۰تایی شناسه‌ی یکتا و صعودی (قاعده‌ی سقف IN ۵۰۰، S99-2).
 * صعودی تا ترتیب خروجی findMany های پشت‌سرهم همان ترتیب کلید اصلی یک کوئری واحد بماند.
 */
export const PRODUCT_IN_CHUNK = 500
export function variantIdChunksOf(ids: readonly number[], size = PRODUCT_IN_CHUNK): number[][] {
  const uniq = [...new Set(ids)].sort((a, b) => a - b)
  const out: number[][] = []
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size))
  return out
}

/** شناسه‌ی واریانت‌های موجودی که payload قیمت/موجودی‌شان را عوض می‌کند (خواندن بیرون از تراکنش). */
async function sensitiveVariantEdits(variants: VariantInput[]): Promise<number[]> {
  const ids = [...new Set(variants.map((v) => Number(v?.id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return []
  const byId = new Map<number, VariantSnapshot>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await prisma.productVariant.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: { id: true, salePrice: true, purchasePrice: true, stock: true }
    })
    for (const r of rows) byId.set(r.id, r)
  }
  return variants
    .filter((v) => {
      const before = byId.get(Number(v?.id))
      return !!before && isSensitiveEdit(before, v)
    })
    .map((v) => Number(v.id))
}

/**
 * تولید کد یکتا وقتی کاربر خودش وارد نکرده.
 * اصلاح باگ: نسخه‌ی قبلی از prisma سراسری و «آخرین id» استفاده می‌کرد، پس وقتی
 * چند واریانت در یک تراکنش ساخته می‌شد همه یک کد می‌گرفتند و به خطای
 * unique constraint روی code می‌خورد. الان کلاینت تراکنش پاس داده می‌شود
 * (نوشته‌های همان تراکنش دیده می‌شوند) و بیشترین کد عددی مبنا قرار می‌گیرد.
 */
export async function nextCode(client: Prisma.TransactionClient): Promise<string> {
  const rows = await client.productVariant.findMany({ select: { code: true } })
  const max = rows.reduce((m, r) => {
    const n = Number(r.code)
    return Number.isFinite(n) && n > m ? n : m
  }, 700)
  return String(max + 1)
}

function genBarcode(): string {
  return String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 900 + 100))
}

/** بارکد Code128 یکتا؛ در همان تراکنش هم بررسی می‌شود تا تکراری ساخته نشود. */
export async function nextBarcode(client: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const candidate = genBarcode()
    const hit = await client.productVariant.findFirst({ where: { barcode: candidate }, select: { id: true } })
    if (!hit) return candidate
  }
  throw new Error('تولید بارکد یکتا ناموفق بود؛ بارکد را دستی وارد کنید')
}

/**
 * ===========================================================================
 * جلسه ۵۴ — ساخت یک کالا/واریانت تازه **با کلاینت تراکنشِ صدازننده**.
 *
 * چرا اینجا و نه در `SecondaryStockService`: قواعد کد و بارکد (یکتایی، مبنای
 * ۷۰۰، ۲۵ بار تلاش برای بارکد) دارایی همین فایل است و کپی‌شدنش یعنی دو منطق
 * واگرا. چرا `upsert` را صدا نمی‌زنیم: `upsert` خودش `prisma.$transaction` باز
 * می‌کند و تراکنش تودرتو روی SQLite تک‌نویسنده همان بن‌بست همیشگی است — پس
 * انتقال «ساخت کالا + جابه‌جایی موجودی» دیگر اتمیک نمی‌شد. این تابع هیچ
 * تراکنشی باز نمی‌کند و `upsert` هم یک خط عوض نشده است.
 *
 * موجودی همیشه **صفر** ساخته می‌شود؛ پر کردنش کار صدازننده است و باید از
 * `InventoryService` رد شود تا `StockMovement` راستگو بماند (قاعده‌ی پروژه).
 * ===========================================================================
 */
export interface NewVariantInTxInput {
  /** پر ⇒ فقط یک واریانت تازه به همین کالای موجود اضافه می‌شود */
  productId?: number | null
  /** کالای جدید ⇒ اجباری */
  name?: string | null
  categoryId?: number | null
  unit?: string | null
  size?: string | null
  color?: string | null
  /** اجباری و بزرگ‌تر از صفر */
  salePrice: number
  purchasePrice?: number | null
  code?: string | null
  note?: string | null
}

export interface NewVariantInTxResult {
  productId: number
  variantId: number
  productName: string
  fullName: string
  code: string
  codeReplaced: boolean
  requestedCode: string | null
  barcode: string
  salePrice: number
  purchasePrice: number
  unit: string
  createdProduct: boolean
}

const trimmed = (v: unknown): string => String(v ?? '').trim()

/**
 * نشست ۱۴۴ · بند ۴-۲۸(د) — قیمت کالا (ریال) عدد صحیح امن است؛ اعشار/متن/خارج از
 * سقف با پیام فارسی رد می‌شود، نه گرد بی‌صدا.
 */
export function assertPriceInteger(value: unknown, label: string, opts: { positive?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (opts.positive && value <= 0))
    throw new BusinessError(
      `${label} باید عدد صحیح ${opts.positive ? 'بزرگ‌تر از صفر' : 'صفر یا بیشتر'} به ریال باشد؛ مقدار «${String(value)}» پذیرفته نیست ` +
        `(اعشار، متن یا عدد بیش از ${faDigits(Number.MAX_SAFE_INTEGER)} ریال گرد یا ذخیره نمی‌شود).`
    )
  return value
}

/** نشست ۱۴۴ · بند ۳ و ۴-۴۲ — موجودی فرم کالا عدد صحیح است (منفی مجاز، مثل مسیر اصلاح دستی). */
function assertFormStock(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new BusinessError(
      `${label} باید عدد صحیح (عدد) باشد؛ مقدار «${String(value)}» پذیرفته نیست (اعشار یا متن گرد نمی‌شود). هیچ تغییری ذخیره نشد.`
    )
  return value
}

export async function createVariantInTx(
  tx: Prisma.TransactionClient,
  input: NewVariantInTxInput
): Promise<NewVariantInTxResult> {
  // ---------- اعتبارسنجی سمت سرور (رندرر هم جدا بررسی می‌کند، ولی تکیه‌گاه اینجاست) ----------
  // نشست ۱۴۴ — بدون Math.round: پیام قدیمی برای خالی/صفر/منفی حفظ شد، اعشار/متن/سقف رد می‌شود.
  if (input.salePrice == null || Number(input.salePrice) <= 0)
    throw new BusinessError('قیمت فروش کالای جدید اجباری است و باید عددی بزرگ‌تر از صفر باشد.')
  const salePrice = assertPriceInteger(input.salePrice, 'قیمت فروش کالای جدید', { positive: true })
  if (Number(input.purchasePrice ?? 0) < 0) throw new BusinessError('قیمت خرید نمی‌تواند منفی باشد.')
  const purchasePrice = assertPriceInteger(input.purchasePrice ?? 0, 'قیمت خرید کالای جدید')

  const size = trimmed(input.size) || null
  const color = trimmed(input.color) || null
  const existingProductId = Number(input.productId ?? 0)

  let productId: number
  let productName: string
  let createdProduct = false
  /** واحد: کالای جدید ⇒ پیش‌فرض «عدد» · کالای موجود ⇒ همان واحد خودش (دست نمی‌خورد) */
  let unit = trimmed(input.unit) || 'عدد'

  if (existingProductId > 0) {
    // ---------- حالت «واریانت تازه برای کالای موجود» ----------
    const product = await tx.product.findUnique({
      where: { id: existingProductId },
      select: { id: true, name: true, isActive: true, unit: true }
    })
    if (!product) throw new BusinessError('کالای انتخاب‌شده برای افزودن واریانت پیدا نشد.')
    if (product.isActive === false)
      throw new BusinessError('کالای انتخاب‌شده حذف شده است؛ ابتدا از سطل آشغال پنل کالاها برگردانید.')
    /**
     * یک واریانت با همین سایز و رنگ از قبل هست ⇒ ساختن دومی یعنی موجودی یک
     * کالا در دو ردیف پخش می‌شود. پس رد می‌شود و کاربر به همان ردیف موجود
     * راهنمایی می‌گردد (مسیر «انتقال به کالای موجود»).
     */
    const twin = await tx.productVariant.findFirst({
      where: { productId: product.id, size, color, isActive: true },
      select: { id: true, code: true }
    })
    if (twin)
      throw new BusinessError(
        `برای «${product.name}» واریانت با همین سایز و رنگ از قبل وجود دارد (کد ${twin.code}). ` +
          'برای همان، از حالت «انتقال به کالای موجود» استفاده کنید تا موجودی یک کالا در دو ردیف پخش نشود.'
      )
    productId = product.id
    productName = product.name
    unit = product.unit || unit
  } else {
    // ---------- حالت «کالای کاملاً جدید» ----------
    const name = trimmed(input.name)
    if (!name) throw new BusinessError('نام کالای جدید را وارد کنید.')
    const categoryId = Number(input.categoryId ?? 0) > 0 ? Number(input.categoryId) : null
    if (categoryId != null) {
      const cat = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } })
      if (!cat) throw new BusinessError('دسته‌ی انتخاب‌شده پیدا نشد؛ یک دسته‌ی موجود را انتخاب کنید.')
    }
    const product = await tx.product.create({
      data: { name, categoryId, unit, note: trimmed(input.note) || null }
    })
    productId = product.id
    productName = product.name
    createdProduct = true
  }

  // ---------- کد: تکراری ⇒ خودکار جا می‌افتد و کاربر می‌بیند ----------
  const requestedCode = trimmed(input.code) || null
  let code = requestedCode ?? ''
  let codeReplaced = false
  if (code) {
    const clash = await tx.productVariant.findFirst({ where: { code }, select: { id: true } })
    if (clash) {
      code = await nextCode(tx)
      codeReplaced = true
    }
  } else {
    code = await nextCode(tx)
  }
  const barcode = await nextBarcode(tx)

  const variant = await tx.productVariant.create({
    data: { productId, code, barcode, size, color, salePrice, purchasePrice, stock: 0 }
  })

  const fullName = [productName, size ?? '', color ?? ''].filter((p) => trimmed(p).length > 0).join(' - ')
  return {
    productId,
    variantId: variant.id,
    productName,
    fullName: fullName || code,
    code,
    codeReplaced,
    requestedCode,
    barcode,
    salePrice,
    purchasePrice,
    unit,
    createdProduct
  }
}

/**
 * یک دسته + همه‌ی زیردسته‌هایش (در هر عمقی).
 *
 * ⚠️ رفع باگ: فیلتر قبلی `product: { categoryId }` بود، یعنی کلیک روی یک دسته‌ی
 * والد (مثلاً «مردانه») فقط محصولاتی را می‌آورد که categoryId شان *دقیقاً* برابر
 * «مردانه» بود. محصولاتی که زیر زیردسته‌ها ثبت شده‌اند (مثل «شلوار نیم‌بگ» با
 * parentId = مردانه) categoryId شان id زیردسته است، پس دیده نمی‌شدند و کاربر
 * مجبور بود تک‌تک روی زیردسته‌ها کلیک کند.
 *
 * حالا مجموعه‌ی [خود دسته + تمام فرزندانش] برگردانده می‌شود. کلیک روی یک
 * زیردسته‌ی برگ هم مثل قبل فقط محصولات خودش را نشان می‌دهد (چون فرزندی ندارد).
 * حلقه‌ی احتمالی در parentId هم با seen بی‌اثر می‌شود.
 */
async function categoryWithDescendants(
  rootId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number[]> {
  const all = await client.category.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<number, number[]>()
  for (const c of all) {
    if (c.parentId == null) continue
    const list = childrenOf.get(c.parentId) ?? []
    list.push(c.id)
    childrenOf.set(c.parentId, list)
  }
  const out: number[] = []
  const seen = new Set<number>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as number
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return out
}

/** یک دسته در فهرست تخت ولی «مرتب‌شده به‌صورت درختی». */
export interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  /** ۰ = ریشه، ۱ = زیردسته، ... (برای پیشوند «— » در select و سایدبار) */
  depth: number
}

export const productService = {
  async list(
    params: { search?: string; categoryId?: number | null; take?: number; skip?: number } = {},
    readOptions: { includePurchasePrice?: boolean } = {}
  ) {
    const { search, categoryId, take = 200, skip = 0 } = params
    // کلیک روی دسته‌ی والد ⇒ محصولات خودش + همه‌ی زیردسته‌هایش
    const categoryIds = categoryId != null ? await categoryWithDescendants(categoryId) : null
    const rows = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: categoryIds ? { categoryId: { in: categoryIds } } : undefined,
        OR: search
          ? [
              { barcode: { contains: search } },
              { code: { contains: search } },
              { product: { name: { contains: search } } }
            ]
          : undefined
      },
      include: { product: { include: { category: true } } },
      orderBy: { id: 'desc' },
      take,
      skip
    })
    // مقدار قیمت خرید تنها از مسیر IPCِ مورد اعتماد و پس از گیت سروریِ پنل کالا می‌آید.
    // فلگ ارسالی renderer عمداً اینجا وجود ندارد.
    return readOptions.includePurchasePrice ? rows : rows.map(({ purchasePrice: _hidden, ...row }) => row)
  },

  async byBarcode(barcode: string, readOptions: { includePurchasePrice?: boolean } = {}) {
    const row = await prisma.productVariant.findFirst({
      where: { barcode, isActive: true },
      include: { product: true }
    })
    if (!row || readOptions.includePurchasePrice) return row
    const { purchasePrice: _hidden, ...safe } = row
    return safe
  },

  /**
   * ثبت/ویرایش کالا + واریانت‌ها + موجودی، همه در یک تراکنش اتمیک.
   *
   * موجودی: مستقیماً روی فیلد stock نوشته نمی‌شود؛ از InventoryService رد
   * می‌شود تا هر تغییر یک StockMovement داشته باشد (ردپا حفظ، ولی بدون مانع
   * و بدون تاییدیه‌ی مسدودکننده).
   */
  async upsert(input: ProductInput) {
    /**
     * نشست ۱۴۴ · بند ۳، ۴-۴۲ و ۴-۲۸(د) — همه‌ی واریانت‌ها *پیش از* تراکنش سنجیده
     * می‌شوند: قبلاً قیمت بدون هیچ سنجشی ذخیره و موجودی Math.round می‌شد.
     */
    ;(input?.variants ?? []).forEach((v, i) => {
      const row = (input.variants.length > 1 ? ` (ردیف ${faDigits(i + 1)})` : '')
      assertPriceInteger(v?.salePrice, `قیمت فروش${row}`)
      assertPriceInteger(v?.purchasePrice, `قیمت خرید${row}`)
      if (v?.stock != null) assertFormStock(v.stock, `موجودی${row}`)
    })
    /**
     * نشست ۱۴۶ · بند ۴-۳۹، ۴-۳۰ و ۴-۴۰ — «تغییر قیمت در ویرایش کالا» و اصلاح
     * موجودی از همین فرم در فهرست «فقط مدیر» هستند. قبلاً هر payload بی‌رمز
     * پذیرفته می‌شد (کالای ۱٬۰۰۰٬۰۰۰ ریالی بی‌صدا ارزان یا موجودی‌اش برای پنهان
     * کردن کسری «درست» می‌شد). گیت *پیش از* تراکنش (readLock/writeLock روی
     * کلاینت سراسری)؛ ثبت کالا/واریانت تازه و ویرایش بدون تغییر قیمت/موجودی رمز
     * نمی‌خواهد، ولی اگر همان payload تغییر حساس دارد کل عملیات رد می‌شود.
     */
    const sensitive = await sensitiveVariantEdits(input?.variants ?? [])
    const approval = sensitive.length
      ? productApprovalNote(
          await assertPanelPassword(PANEL_KEYS.products, input?.managerPassword ?? null, 'تغییر قیمت/موجودی در ویرایش کالا')
        )
      : null
    return prisma.$transaction(async (tx) => {
      const prev = input.id
        ? await tx.product.findUnique({
            where: { id: input.id },
            select: { id: true, name: true, reportLiveName: true }
          })
        : null
      if (input.id && !prev) throw new BusinessError('این کالا پیدا نشد؛ فهرست را تازه کنید.')
      const reportLiveName =
        input.reportLiveName === undefined ? Boolean(prev?.reportLiveName) : input.reportLiveName === true
      const product = input.id
        ? await tx.product.update({
            where: { id: input.id },
            data: {
              name: input.name,
              categoryId: input.categoryId ?? null,
              unit: input.unit ?? 'عدد',
              note: input.note,
              reportLiveName
            }
          })
        : await tx.product.create({
            data: {
              name: input.name,
              categoryId: input.categoryId ?? null,
              unit: input.unit ?? 'عدد',
              note: input.note,
              reportLiveName
            }
          })
      if (prev && prev.name !== input.name) {
        await audit(tx, {
          action: AuditAction.PRODUCT_UPDATE,
          entity: 'Product',
          entityId: product.id,
          userId: input.userId ?? null,
          before: prev.name,
          after: input.name,
          note: 'تغییر نام کالا'
        })
      }
      const prevLive = Boolean(prev?.reportLiveName)
      if (prevLive !== reportLiveName) {
        await audit(tx, {
          action: AuditAction.PRODUCT_UPDATE,
          entity: 'Product',
          entityId: product.id,
          userId: input.userId ?? null,
          before: prevLive ? 'روشن' : 'خاموش',
          after: reportLiveName ? 'روشن' : 'خاموش',
          note: 'تیک نمایش آخرین نام در گزارش فروش'
        })
      }

      for (const v of input.variants) {
        /**
         * نشست ۱۶۹ (S169-D2، بند ۴-۳۴ «فیلتر/جستجوی گزارش‌ها همیشه بر اساس کد داخلی ثابت») — قبلاً برای
         * واریانت *موجود* هم کادر خالی کد/بارکد (فرم آن را undefined می‌فرستد) کد/بارکد تازه می‌ساخت ⇒ کد
         * داخلی بی‌صدا و بی‌Audit عوض می‌شد و گزارش/برچسب قدیمی از کار می‌افتاد. حالا برای واریانت موجود
         * خالی = «همان قبلی»؛ تغییر صریح (غیرخالی) مثل قبل مجاز؛ واریانت تازه مثل قبل خودکار.
         */
        const prev = v.id
          ? await tx.productVariant.findUnique({ where: { id: v.id }, select: { code: true, barcode: true } })
          : null
        const data = {
          productId: product.id,
          code: v.code || prev?.code || (await nextCode(tx)),
          barcode: v.barcode || prev?.barcode || (await nextBarcode(tx)),
          size: v.size ?? null,
          color: v.color ?? null,
          salePrice: v.salePrice,
          purchasePrice: v.purchasePrice,
          ledgerAccountCode: v.ledgerAccountCode ?? null
          // external_sku / woocommerceProductId عمداً ست نمی‌شوند (فاز دوم)
        }
        if (v.id) {
          const before = await tx.productVariant.findUnique({ where: { id: v.id } })
          // نشست ۱۴۶ — بستن race: اگر بین سنجش بیرون تراکنش و اینجا (مثلاً با یک
          // فروش) قیمت/موجودی عوض شده و گیتی باز نشده بود، بی‌رمز ذخیره نمی‌شود.
          if (before && !approval && isSensitiveEdit(before, v))
            throw new BusinessError(
              'قیمت یا موجودی این کالا از لحظه‌ی باز شدن فرم تغییر کرده؛ فرم را دوباره باز کنید. هیچ تغییری ذخیره نشد.'
            )
          await tx.productVariant.update({ where: { id: v.id }, data })
          // نشست ۱۸۱: مقایسه‌ی bigint دیتابیس با number فرم باید از toRial بگذرد،
          // وگرنه همیشه نابرابر است و ردیف ممیزی دروغین ثبت می‌شود.
          if (before && toRial(before.salePrice) !== toRial(v.salePrice)) {
            // ⚠️ حتماً tx: صدا زدن audit با کلاینت سراسری داخل این تراکنش،
            // همان بن‌بست «Transaction already closed» را می‌ساخت.
            await audit(tx, {
              action: 'PRICE_EDIT',
              entity: 'ProductVariant',
              entityId: v.id,
              userId: input.userId ?? null,
              before: String(before.salePrice),
              after: String(v.salePrice),
              note: `قیمت فروش · ${approval}`
            })
          }
          // نشست ۱۴۶ — تغییر قیمت خرید (مبنای سود بند ۴-۴۴) قبلاً هیچ ردی نداشت.
          if (before && toRial(before.purchasePrice) !== toRial(v.purchasePrice)) {
            await audit(tx, {
              action: 'PRICE_EDIT',
              entity: 'ProductVariant',
              entityId: v.id,
              userId: input.userId ?? null,
              before: String(before.purchasePrice),
              after: String(v.purchasePrice),
              note: `قیمت خرید · ${approval}`
            })
          }
          // موجودی ویرایش‌شده از همین فرم: اختلاف به‌عنوان ADJUSTMENT ثبت
          // می‌شود (همان مسیر StockAdjustModal)؛ نشست ۱۴۶ — با گیت پنل کالاها
          // و scope تأیید در یادداشت Audit (دفتر گردش همان توضیح قبلی را دارد).
          if (v.stock != null && before && v.stock !== before.stock) {
            await inventoryService.setStock(
              v.id,
              v.stock,
              {
                reason: 'ADJUSTMENT',
                refType: 'Manual',
                userId: input.userId ?? null,
                note: 'اصلاح از فرم کالا',
                auditNote: approval
              },
              tx
            )
          }
        } else {
          // موجودی اولیه هم از طریق InventoryService ثبت می‌شود، نه نوشتن
          // مستقیم فیلد stock؛ پس برای واریانت جدید همیشه از صفر شروع می‌کنیم.
          const created = await tx.productVariant.create({ data: { ...data, stock: 0 } })
          const initial = v.stock ?? 0
          if (initial !== 0) {
            await inventoryService.setStock(
              created.id,
              initial,
              { reason: 'INITIAL', refType: 'Manual', userId: input.userId ?? null, note: 'موجودی اولیه از فرم کالا' },
              tx
            )
          }
        }
      }
      return product.id
    }, TX_OPTIONS)
  },

  /**
   * حذف کالا = «حذف نرم». رکورد و همه‌ی سابقه‌اش (حرکات انبار، فاکتورهای گذشته)
   * سر جایش می‌ماند؛ فقط isActive = false می‌شود و لحظه‌ی حذف در deletedAt ثبت
   * می‌گردد تا در «سطل آشغال» پنل کالاها قابل نمایش، مرتب‌سازی و بازگردانی باشد.
   */
  async remove(variantIds: number[], userId?: number | null) {
    const ids = (variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) return 0
    /**
     * نشست ۱۷۷ · S176-D3 — قبلاً همه‌ی شناسه‌ها بی‌سقف در id in می‌نشستند (قاعده‌ی سقف IN ۵۰۰، S99-2).
     * UI امروز حداکثر ۲۰۰ ردیف می‌فرستد، ولی main نباید به سقف UI تکیه کند. حالا دسته‌های ۵۰۰تایی،
     * داخل یک تراکنش (همه یا هیچ؛ قبلاً هم خواندن و نوشتن جدا بودند). شمارش = جمع دسته‌ها.
     */
    const deletedAt = new Date()
    const { before, count } = await prisma.$transaction(async (tx) => {
      const before: { id: number; code: string; barcode: string | null; isActive: boolean }[] = []
      let count = 0
      for (const chunk of variantIdChunksOf(ids)) {
        before.push(
          ...(await tx.productVariant.findMany({
            where: { id: { in: chunk } },
            select: { id: true, code: true, barcode: true, isActive: true }
          }))
        )
        const r = await tx.productVariant.updateMany({
          where: { id: { in: chunk } },
          data: { isActive: false, deletedAt }
        })
        try {
          const { markWooLinksBrokenLocal } = await import('./WooSyncService')
          await markWooLinksBrokenLocal(chunk, tx as any)
        } catch (e) {
          console.error('[wooSync] mark deleted variants failed', e)
        }
        count += r.count
      }
      return { before, count }
    }, TX_OPTIONS)
    const res = { count }
    // بیرون از هر تراکنش ⇒ کلاینت سراسری، ولی برای یکدستی امضا صریح پاس داده می‌شود.
    await audit(prisma, {
      action: 'DELETE',
      entity: 'ProductVariant',
      userId: userId ?? null,
      before: JSON.stringify(before),
      after: JSON.stringify(ids),
      note: `${ids.length} کالا به سطل آشغال رفت (حذف نرم؛ قابل بازگردانی)`
    })
    return res.count
  },

  /**
   * «سطل آشغال»: کالاهای حذف‌شده (isActive = false).
   * کالاهایی که قبل از افزودن فیلد deletedAt حذف شده‌اند تاریخ حذف ندارند و در
   * انتهای فهرست با «—» نمایش داده می‌شوند (داده‌شان گم نشده، فقط زمان حذفشان
   * ثبت نشده بود).
   */
  async trash(
    params: { search?: string; take?: number; skip?: number } = {},
    readOptions: { includePurchasePrice?: boolean } = {}
  ) {
    const { search, take = 300, skip = 0 } = params
    const rows = await prisma.productVariant.findMany({
      where: {
        isActive: false,
        OR: search
          ? [
              { barcode: { contains: search } },
              { code: { contains: search } },
              { product: { name: { contains: search } } }
            ]
          : undefined
      },
      include: { product: { include: { category: true } } },
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take,
      skip
    })
    return readOptions.includePurchasePrice ? rows : rows.map(({ purchasePrice: _hidden, ...row }) => row)
  },

  /**
   * بازگردانی از سطل آشغال: کالا دوباره فعال می‌شود (deletedAt پاک می‌گردد) و
   * همان لحظه در جستجو، پنل فروش و گزارش‌ها برمی‌گردد. موجودی و حرکات انبارش
   * دست‌نخورده بوده، پس هیچ چیز بازسازی نمی‌شود.
   */
  async restore(variantIds: number[], userId?: number | null) {
    const ids = (variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) throw new BusinessError('برای بازگردانی، حداقل یک کالا را انتخاب کنید.')
    // نشست ۱۷۷ · S176-D3 — مثل remove: دسته‌های ۵۰۰تایی داخل یک تراکنش (سقف IN ۵۰۰).
    const { before, count } = await prisma.$transaction(async (tx) => {
      const before: any[] = []
      for (const chunk of variantIdChunksOf(ids))
        before.push(
          ...(await tx.productVariant.findMany({
            where: { id: { in: chunk } },
            include: { product: { select: { name: true } } }
          }))
        )
      if (!before.length) throw new BusinessError('این کالاها پیدا نشدند؛ فهرست سطل آشغال را تازه کنید.')
      let count = 0
      for (const chunk of variantIdChunksOf(ids)) {
        const r = await tx.productVariant.updateMany({
          where: { id: { in: chunk } },
          data: { isActive: true, deletedAt: null }
        })
        count += r.count
      }
      return { before, count }
    }, TX_OPTIONS)
    const res = { count }
    await audit(prisma, {
      action: AuditAction.PRODUCT_RESTORE,
      entity: 'ProductVariant',
      entityId: ids.length === 1 ? ids[0] : null,
      userId: userId ?? null,
      before: JSON.stringify(
        before.map((v) => ({ id: v.id, code: v.code, name: v.product?.name, deletedAt: v.deletedAt }))
      ),
      after: JSON.stringify(ids),
      note: `${res.count} کالا از سطل آشغال بازگردانی شد`
    })
    return res.count
  },

  /**
   * اصلاح دستی موجودی (IPC.stockAdjust).
   *
   * نشست ۱۴۶ · بند ۴-۳۹ و ۴-۳۰ — «اصلاح موجودی» در فهرست «فقط مدیر» است. قبلاً
   * هیچ رمزی سمت سرور لازم نبود و Audit STOCK_ADJUST با userId = null ثبت می‌شد؛
   * یعنی کسری کالای دزدیده‌شده با یک تماس IPC «درست» می‌شد و ردی از actor نمی‌ماند.
   * ترتیب: validation عددی S144 ⇒ گیت پنل کالاها (بیرون از تراکنش) ⇒ حرکت انبار
   * و Audit در *یک* تراکنش (قبلاً Audit بیرون از تراکنش حرکت نوشته می‌شد).
   */
  async adjustStock(input: StockAdjustInput): Promise<void> {
    const variantId = assertStockInteger(input?.variantId, 'شناسه‌ی کالا', { positive: true })
    const newQty = assertStockInteger(input?.newQty, 'موجودی جدید', { allowNegative: true })
    const scope = await assertPanelPassword(PANEL_KEYS.products, input?.managerPassword ?? null, 'اصلاح دستی موجودی')
    const note = input?.note == null ? undefined : String(input.note)
    await prisma.$transaction(
      async (tx) => {
        if (input.custodyFence) await custodyService.assertFenceInTx(tx, input.custodyFence)
        return inventoryService.setStock(
          variantId,
          newQty,
          {
            reason: 'ADJUSTMENT',
            refType: 'Manual',
            userId: input?.userId ?? null,
            note,
            auditNote: productApprovalNote(scope)
          },
          tx
        )
      },
      TX_OPTIONS
    )
  },

  /**
   * دفتر گردش یک واریانت.
   *
   * ردیف‌های قابل نمایش صفحه‌بندی می‌شوند، اما جمع‌ها و تعداد PENDING همیشه از
   * کل دفتر همان کالا می‌آیند. `newerDeltaSum` برای صفحه‌های بعد لازم است تا
   * موجودیِ «پس از حرکت» از مرز صفحه به بعد هم درست بماند.
   */
  async movements(
    input: number | { variantId: number; take?: number; skip?: number }
  ): Promise<
    PagedRows<any> & {
      totals: { inTotal: number; outTotal: number; net: number; pendingCount: number; count: number }
      newerDeltaSum: number
    }
  > {
    const params = typeof input === 'number' ? { variantId: input } : input ?? ({} as any)
    const variantId = Number(params.variantId)
    if (!Number.isInteger(variantId) || variantId <= 0) throw new BusinessError('شناسه‌ی کالا برای گردش انبار معتبر نیست.')

    const PAGE_MAX = 5000
    const requestedTake = Math.round(Number(params.take ?? PAGE_MAX))
    const requestedSkip = Math.round(Number(params.skip ?? 0))
    const take = Math.min(Math.max(Number.isFinite(requestedTake) ? requestedTake : PAGE_MAX, 1), PAGE_MAX)
    const skip = Math.max(Number.isFinite(requestedSkip) ? requestedSkip : 0, 0)
    const where = { variantId }
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

    const [rows, count, incoming, outgoing, pendingCount, newerRows] = await Promise.all([
      prisma.stockMovement.findMany({ where, orderBy, skip, take }),
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.aggregate({ where: { ...where, delta: { gt: 0 } }, _sum: { delta: true } }),
      prisma.stockMovement.aggregate({ where: { ...where, delta: { lt: 0 } }, _sum: { delta: true } }),
      prisma.stockMovement.count({ where: { ...where, state: 'PENDING' } }),
      skip
        ? prisma.stockMovement.findMany({ where, orderBy, take: skip, select: { delta: true } })
        : Promise.resolve([] as { delta: number }[])
    ])

    const inTotal = Math.round(Number(incoming._sum?.delta ?? 0))
    const outTotal = Math.round(Number(outgoing._sum?.delta ?? 0))
    const newerDeltaSum = newerRows.reduce((sum, row) => sum + Number(row.delta ?? 0), 0)
    const page = {
      skip,
      take,
      totalCount: count,
      truncated: count > skip + rows.length
    }
    const warnings =
      page.truncated || skip > 0
        ? [
            `نمایش ${faDigits(rows.length)} از ${faDigits(count)} حرکت انبار (از ردیف ${faDigits(skip + 1)})؛ ` +
              'جمع ورود، خروج و حرکات موقت روی کل دفتر این کالا حساب شده‌اند، نه فقط این صفحه.'
          ]
        : []

    return Object.assign(rows, {
      page,
      warnings,
      newerDeltaSum,
      totals: {
        inTotal,
        outTotal,
        net: inTotal + outTotal,
        pendingCount,
        count
      }
    }) as PagedRows<any> & {
      totals: { inTotal: number; outTotal: number; net: number; pendingCount: number; count: number }
      newerDeltaSum: number
    }
  },

  /**
   * فهرست دسته‌ها، «مرتب‌شده به‌صورت درختی» و همراه با depth.
   *
   * ⚠️ رفع باگ: قبلاً فقط `orderBy: { name: 'asc' }` بود، یعنی یک مرتب‌سازی تختِ
   * الفبایی بدون توجه به parentId. نتیجه این می‌شد که مثلاً «شلوار نیم‌بگ»
   * (زیردسته‌ی «مردانه») در select «گروه کالا» زیر «زنانه» دیده می‌شد، فقط به
   * خاطر ترتیب حروف — هرچند parentId اش در دیتابیس درست بود.
   *
   * الان ترتیب واقعی است: هر ریشه، و بلافاصله بعدش زیردسته‌های خودش (بازگشتی).
   * دسته‌های یتیم (والدِ حذف‌شده یا حلقه‌ی parentId) هم گم نمی‌شوند و در انتها
   * به‌عنوان ریشه می‌آیند.
   */
  async categoryTree(): Promise<CategoryNode[]> {
    const all = await prisma.category.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' }
    })
    const childrenOf = new Map<number | null, typeof all>()
    for (const c of all) {
      const key = c.parentId ?? null
      const list = childrenOf.get(key) ?? []
      list.push(c)
      childrenOf.set(key, list)
    }
    const known = new Set(all.map((c) => c.id))
    const out: CategoryNode[] = []
    const placed = new Set<number>()

    const walk = (parentId: number | null, depth: number) => {
      for (const c of childrenOf.get(parentId) ?? []) {
        if (placed.has(c.id)) continue // محافظت از حلقه‌ی parentId
        placed.add(c.id)
        out.push({ id: c.id, name: c.name, parentId: c.parentId ?? null, depth })
        walk(c.id, depth + 1)
      }
    }
    walk(null, 0)

    // یتیم‌ها: parentId ای که دیگر وجود ندارد، یا داخل حلقه گیر افتاده
    for (const c of all) {
      if (placed.has(c.id)) continue
      placed.add(c.id)
      out.push({
        id: c.id,
        name: c.name,
        parentId: c.parentId != null && known.has(c.parentId) ? c.parentId : null,
        depth: 0
      })
    }
    return out
  },

  categoryUpsert(input: { id?: number; name: string; parentId?: number | null }) {
    return input.id
      ? prisma.category.update({ where: { id: input.id }, data: { name: input.name, parentId: input.parentId ?? null } })
      : prisma.category.create({ data: { name: input.name, parentId: input.parentId ?? null } })
  }
}
