import { prisma } from '../db/client'
import { audit, auditOrThrow } from './AuditService'
import { assertPanelPassword } from './AuthService'
import { PANEL_KEYS } from '@shared/panels'
import { BusinessError } from '../errors'
import { toJalaliDate, toLatinDigits, faDigits, money } from '@shared/jalali'
import type {
  PagedRows,
  CustomerDeleteResult,
  CustomerDirectoryFilter,
  CustomerDirectoryRow,
  CustomerKind,
  CustomerSaveInput
} from '@shared/types'
import type { Prisma } from '@prisma/client'
import { toNumberRial } from '@shared/money'

/**
 * نشست ۱۵۰ · بند ۴-۲۸(د) — «مجموع مبلغ خرید دستی» (Customer.manualPurchaseTotal، Prisma Int).
 * خالی (undefined/null) ⇒ ۰؛ متن/NaN/اعشار/منفی/بیش از سقف ⇒ رد فارسی، نه گرد/صفرکردن بی‌صدا.
 */
const MANUAL_PURCHASE_MAX = 2_147_483_647
function assertManualPurchaseTotal(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)
    throw new BusinessError(
      `مجموع مبلغ خرید دستی باید عدد صحیح صفر یا بیشتر به ریال باشد؛ مقدار «${typeof raw === 'number' ? faDigits(String(raw)) : String(raw)}» ` +
        'پذیرفته نیست (اعشار، منفی یا متن گرد/صفر نمی‌شود). هیچ تغییری ذخیره نشد.'
    )
  if (raw > MANUAL_PURCHASE_MAX)
    throw new BusinessError(
      `مجموع مبلغ خرید دستی (${money(raw)} ریال) از سقف مجاز ${money(MANUAL_PURCHASE_MAX)} ریال بیشتر است. هیچ تغییری ذخیره نشد.`
    )
  return raw
}

type Client = Prisma.TransactionClient | typeof prisma

/** شماره تلفن یکدست: ارقام فارسی → لاتین، حذف فاصله و خط تیره. */
export function normalizePhone(raw: unknown): string {
  return toLatinDigits(String(raw ?? '')).replace(/[^0-9+]/g, '').trim()
}

/**
 * ---------------------------------------------------------------------------
 * «دنباله‌ی معنادار» یک شماره تلفن — کلید واقعی تشخیص مشتری تکراری (مورد ۳).
 *
 * یک مشتری ممکن است امروز «۰۹۱۹۹۵۰۴۸۲۱» بزند و ۱۲ ماه بعد همان شماره را
 * «+۹۸۹۱۹۹۵۰۴۸۲۱» یا «۹۱۹۹۵۰۴۸۲۱» وارد کند. مقایسه‌ی رشته‌ای خام، این‌ها را
 * سه مشتری *مختلف* می‌دید و بانک شماره‌ها را با رکورد تکراری خراب می‌کرد.
 * پس پیش‌شماره‌ی کشور و صفر ابتدایی برداشته می‌شود و مقایسه روی همان دنباله
 * انجام می‌گردد (۱۰ رقم آخر برای موبایل ایران).
 * ---------------------------------------------------------------------------
 */
export function phoneTail(raw: unknown): string {
  let p = normalizePhone(raw).replace(/^\+/, '')
  if (p.startsWith('0098')) p = p.slice(4)
  else if (p.startsWith('98') && p.length > 10) p = p.slice(2)
  p = p.replace(/^0+/, '')
  return p
}

/**
 * پیدا کردن مشتری با شماره تلفن، با تحمل تفاوت قالب (۰۹۱۲…، ۹۸۹۱۲…، ۹۱۲…).
 * اول تطبیق دقیق امتحان می‌شود (سریع‌ترین و مطمئن‌ترین)، بعد تطبیق دنباله.
 * همیشه با همان `client` جاری کار می‌کند تا داخل تراکنش ثبت فاکتور بن‌بست نسازد.
 */
export async function findCustomerByPhone(client: Client, raw: unknown) {
  const exact = normalizePhone(raw)
  if (exact.length < 4) return null
  const direct = await client.customer.findFirst({ where: { phone: exact }, orderBy: { id: 'asc' } })
  if (direct) return direct
  const tail = phoneTail(raw)
  if (tail.length < 7) return null
  return client.customer.findFirst({ where: { phone: { endsWith: tail } }, orderBy: { id: 'asc' } })
}

/**
 * ---------------------------------------------------------------------------
 * فیلتر «نوع مشتری». «مشتری عمومی» عمداً در هر دو فهرست دیده می‌شود.
 *
 * ⚠️ رفع باگ «با کلیک روی تکی/عمده، کل لیست خالی می‌شد» (مورد ۲):
 * فیلتر سطح دیتابیس روی ستون `isWholesale` انجام می‌شد. روی دیتابیسی که این
 * ستون بعداً اضافه شده (یا از یک بکاپ قدیمی ادغام شده) مقدار بعضی ردیف‌ها
 * می‌تواند NULL باشد؛ در SQL نه با `= 0` می‌خورد و نه با `= 1`، پس هر دو فیلتر
 * «تکی» و «عمده» فهرست را خالی نشان می‌دادند (هیچ داده‌ای پاک نمی‌شد — فقط
 * نمایش خالی بود). حالا:
 *   • این تابع فقط برای فهرست‌های ساده‌ی جستجوی خریدار استفاده می‌شود.
 *   • «پنل مشتریان» تنظیمات فیلتر را در حافظه اعمال می‌کند (`matchesKind`)، پس
 *     هیچ حالتی از داده نمی‌تواند فهرست را ناپدید کند.
 * ---------------------------------------------------------------------------
 */
function kindWhere(kind?: CustomerKind): Prisma.CustomerWhereInput {
  if (kind === 'wholesale') return { OR: [{ isWholesale: true }, { isDefault: true }] }
  if (kind === 'retail') return { OR: [{ isWholesale: false }, { isDefault: true }] }
  return {}
}

/** همان قاعده‌ی بالا، ولی روی یک ردیفِ خوانده‌شده (فیلتر نمایشی، بدون کوئری). */
function matchesKind(row: { isWholesale?: boolean | null; isDefault?: boolean | null }, kind?: CustomerKind): boolean {
  if (kind !== 'wholesale' && kind !== 'retail') return true
  if (row.isDefault === true) return true
  const wholesale = row.isWholesale === true
  return kind === 'wholesale' ? wholesale : !wholesale
}

/**
 * اشخاص: مشتری (خریدار) و تامین‌کننده (فروشنده).
 * فاکتور خرید به Supplier و فاکتور فروش عمده به Customer نیاز دارد؛ تا این
 * مرحله هیچ کانالی برای این دو مدل وجود نداشت و فقط «مشتری عمومی» از seed
 * ساخته می‌شد. اینجا حداقلِ لازم اضافه شده است: جستجو + ثبت سریع.
 *
 * کد شخص: اگر کاربر وارد نکند، «بزرگ‌ترین کد عددی موجود + ۱» ساخته می‌شود
 * (مشتری از ۱۰۰۰ و تامین‌کننده از ۲۰۰۰ شروع می‌شود، مطابق seed).
 */

/** کوچک‌ترین عدد آزاد برای میان‌بر فاکتور خرید (۱، ۲، ۳…). کدهای قدیمی مثل ۲۰۰۰ دست نمی‌خورند. */
async function nextShortSupplierCode(): Promise<string> {
  const rows = await prisma.supplier.findMany({ select: { code: true } })
  const used = new Set(rows.map((r) => String(r.code)))
  let n = 1
  while (used.has(String(n))) n += 1
  return String(n)
}

async function nextCode(table: 'customer' | 'supplier', base: number): Promise<string> {
  const rows =
    table === 'customer'
      ? await prisma.customer.findMany({ select: { code: true } })
      : await prisma.supplier.findMany({ select: { code: true } })
  const max = rows.reduce((m, r) => {
    const n = Number(r.code)
    return Number.isFinite(n) && n > m ? n : m
  }, base)
  return String(max + 1)
}

const where = (search?: string) =>
  search?.trim()
    ? {
        OR: [
          { name: { contains: search.trim() } },
          { code: { contains: search.trim() } },
          { phone: { contains: search.trim() } }
        ]
      }
    : {}

export interface PartyInput {
  name: string
  code?: string
  phone?: string | null
  address?: string | null
}

/** نشست ۱۱۵ · بند ۴-۴۶ — سقف و پیش‌فرض هر صفحه‌ی «بانک شماره مشتریان» */
const DIRECTORY_PAGE_MAX = 5000
/** نشست ۱۱۵ (S115-3) — فاکتورهایی که در «جمع خرید» مشتری شمرده نمی‌شوند */
const DIRECTORY_EXCLUDED_STATUSES = ['DRAFT', 'CANCELED']

export const partyService = {
  /**
   * پیدا کردن مشتری با شماره تلفن (فیلد مشتری پنل فروش — مورد ۶).
   * null = چنین شماره‌ای ثبت نشده است (پس با ثبت فاکتور ساخته می‌شود).
   */
  async byPhone(params: { phone?: string } = {}) {
    return findCustomerByPhone(prisma, params?.phone)
  },

  /**
   * «بانک شماره مشتریان» پنل تنظیمات (مورد ۶).
   * همه‌ی مشتری‌های ثبت‌شده — از هر مسیری که ساخته شده باشند (پنل فروش، فاکتور
   * عمده، ثبت دستی) — با تعداد و جمع خریدشان، برای استفاده در پیامک تبلیغاتی.
   * خروجی آماده‌ی نمایش و آماده‌ی «خروجی اکسل» است.
   */
  async directory(params: CustomerDirectoryFilter = {}): Promise<PagedRows<CustomerDirectoryRow>> {
    /**
     * مورد ۲ — فیلتر «نوع مشتری» فقط *نمایش* را محدود می‌کند و هیچ داده‌ای را
     * حذف نمی‌کند. عمداً در حافظه اعمال می‌شود (نه در where کوئری) تا مقدار
     * NULL یا داده‌ی قدیمیِ ستون `isWholesale` نتواند فهرست را خالی کند.
     *
     * نشست ۱۱۵ · خوشه G · بند ۴-۴۶ (S115-2/S115-3):
     *  • دیگر `take: 2000` ثابت بی‌صدا نیست؛ همه‌ی مشتری‌های منطبق خوانده می‌شوند،
     *    فیلترهای نوع/شماره/حداقل خرید روی *کل* مجموعه اعمال می‌شوند و سپس
     *    صفحه‌بندی صریح (پیش‌فرض و سقف ۵٬۰۰۰) با `page` و `warnings` فارسی.
     *  • «جمع خرید» خالص است: فقط فاکتورهای معتبر (نه DRAFT/CANCELED، نه باطل)،
     *    منهای برگشت‌های باطل‌نشده؛ تا «خرید + برگشت» یا فاکتور لغوشده نتواند
     *    مشتری را به حداقل قرعه‌کشی برساند.
     */
    const customers = await prisma.customer.findMany({
      where: {
        AND: [where(params.search), params.onlyWithPhone ? { NOT: { phone: null } } : {}]
      },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }]
    })
    const validInvoice = { customerId: { not: null }, voidedAt: null, status: { notIn: DIRECTORY_EXCLUDED_STATUSES } }
    const sums = await prisma.saleInvoice.groupBy({
      by: ['customerId'],
      where: validInvoice,
      _sum: { grandTotal: true },
      _count: { _all: true },
      _max: { issuedAtJalali: true }
    })
    const returns = await prisma.saleReturn.findMany({
      where: { voidedAt: null, invoice: validInvoice },
      select: { total: true, invoice: { select: { customerId: true } } }
    })
    const bought = new Map<number, { total: number; count: number; last: string | null }>()
    for (const g of sums as any[]) {
      if (g.customerId == null) continue
      bought.set(Number(g.customerId), {
        total: Number(g._sum?.grandTotal ?? 0),
        count: Number(g._count?._all ?? 0),
        last: g._max?.issuedAtJalali || null
      })
    }
    const returned = new Map<number, number>()
    for (const r of returns as any[]) {
      const cid = r.invoice?.customerId
      if (cid == null) continue
      returned.set(Number(cid), (returned.get(Number(cid)) ?? 0) + Number(r.total ?? 0))
    }
    const minTotal = Math.max(0, Math.round(Number(params.minTotal) || 0))
    const filtered = customers
      .filter((c) => matchesKind(c, params.kind))
      .filter((c) => (params.onlyWithPhone ? !!normalizePhone(c.phone) : true))
      .map((c) => {
        const b = bought.get(c.id)
        const ret = returned.get(c.id) ?? 0
        const invoiceTotal = (b?.total ?? 0) - ret
        // نشست ۱۸۱: ستون مالی حالا BigInt است. سطر خروجی به رابط کاربری می‌رود و
        // قرارداد آن `number` است، پس تبدیل صریح — و `toNumberRial` اگر مبلغ از
        // محدوده‌ی امن بیرون بزند throw می‌کند به‌جای اینکه بی‌صدا عدد غلط بدهد.
        const manual = toNumberRial(c.manualPurchaseTotal)
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          phone: c.phone ?? null,
          address: c.address ?? null,
          isDefault: c.isDefault,
          isWholesale: c.isWholesale,
          createdAtJalali: toJalaliDate(c.createdAt),
          invoiceCount: b?.count ?? 0,
          invoiceTotal,
          returnedTotal: ret,
          manualPurchaseTotal: manual,
          totalBought: invoiceTotal + manual,
          lastBuyJalali: b?.last ?? null
        }
      })
      // فیلتر «حداقل مبلغ خرید» (قرعه‌کشی) روی جمع نهایی خالص اعمال می‌شود
      .filter((r) => (minTotal > 0 ? r.totalBought >= minTotal : true))

    const t = Math.round(Number(params.take ?? DIRECTORY_PAGE_MAX))
    const k = Math.round(Number(params.skip ?? 0))
    const take = Math.min(Math.max(Number.isFinite(t) ? t : DIRECTORY_PAGE_MAX, 1), DIRECTORY_PAGE_MAX)
    const skip = Math.max(Number.isFinite(k) ? k : 0, 0)
    const rows = filtered.slice(skip, skip + take)
    const totalCount = filtered.length
    const page = { skip, take, totalCount, truncated: totalCount > skip + rows.length || skip > 0 }
    const sep = (n: number) => faDigits(n.toLocaleString('en-US').replace(/,/g, '٬'))
    const warnings =
      totalCount > rows.length
        ? [
            `نمایش ${sep(rows.length)} از ${sep(totalCount)} مشتری (از ردیف ${sep(skip + 1)})؛ ` +
              '«کپی همه‌ی شماره‌ها» و خروجی فقط همین صفحه را دارند؛ صفحه‌ی بعد را هم ببینید یا فیلتر را دقیق‌تر کنید.'
          ]
        : []
    return Object.assign(rows, { page, warnings }) as PagedRows<CustomerDirectoryRow>
  },

  /**
   * فهرست مشتری برای فیلد جستجوی خریدار.
   * `kind = 'wholesale'` (پنل فاکتور فروش عمده) فقط مشتری‌های عمده و «مشتری
   * عمومی» را می‌دهد، پس مشتری‌های تکیِ پنل فروش آنجا دیده نمی‌شوند (مورد ۶).
   */
  customers(params: { search?: string; take?: number; kind?: CustomerKind } = {}) {
    return prisma.customer.findMany({
      where: { AND: [where(params.search), kindWhere(params.kind)] },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      take: params.take ?? 50
    })
  },

  async createCustomer(input: PartyInput & { isWholesale?: boolean; manualPurchaseTotal?: number; userId?: number | null }) {
    const name = input.name?.trim()
    if (!name) throw new Error('نام مشتری الزامی است')
    // نشست ۱۵۰ — پیش از هر نوشتن (شامل ارتقای مشتری هم‌شماره)
    const manualPurchaseTotal = assertManualPurchaseTotal(input.manualPurchaseTotal)
    const wholesale = input.isWholesale === true
    const phone = normalizePhone(input.phone) || null
    /**
     * شماره تکراری = همان مشتری (مورد ۳). دو رکورد با یک شماره، بانک شماره و
     * «تعداد فاکتور» را خراب می‌کند. تطبیق با تحمل قالب انجام می‌شود، پس
     * ۰۹۱۲…/۹۸۹۱۲…/۹۱۲… همه یک مشتری‌اند.
     */
    if (phone) {
      const same = await findCustomerByPhone(prisma, phone)
      if (same) {
        // مشتری تکیِ موجود که همین حالا به‌عنوان «خریدار عمده» ثبت می‌شود، فقط
        // برچسبش عمده می‌شود (رکورد دوم ساخته نمی‌شود).
        if (wholesale && !same.isWholesale) {
          const promoted = await prisma.customer.update({ where: { id: same.id }, data: { isWholesale: true } })
          await audit(prisma, {
            action: 'CUSTOMER_CREATE',
            entity: 'Customer',
            entityId: promoted.id,
            userId: input.userId ?? null, // نشست ۱۵۲ · S151-a — actor نشست (IPC)
            before: JSON.stringify({ isWholesale: same.isWholesale }),
            after: JSON.stringify({ isWholesale: true }),
            note: 'مشتری موجود با همین شماره تلفن پیدا شد و به «مشتری عمده» تغییر برچسب داد (رکورد تکراری ساخته نشد)'
          })
          return promoted
        }
        return same
      }
    }
    const code = input.code?.trim() || (await nextCode('customer', 1000))
    const dup = await prisma.customer.findUnique({ where: { code } })
    if (dup) throw new Error(`کد مشتری «${code}» تکراری است`)
    const c = await prisma.customer.create({
      data: {
        code,
        name,
        phone,
        address: input.address?.trim() || null,
        isWholesale: wholesale,
        manualPurchaseTotal
      }
    })
    await audit(prisma, {
      action: 'CUSTOMER_CREATE',
      entity: 'Customer',
      entityId: c.id,
      userId: input.userId ?? null, // نشست ۱۵۲ · S151-a — actor نشست (IPC)
      after: JSON.stringify({ code, name, phone, isWholesale: wholesale }),
      note: wholesale ? 'ثبت مشتری عمده' : 'ثبت مشتری تکی'
    })
    return c
  },

  /**
   * ویرایش دستی یک مشتری از پنل مشتریانِ تنظیمات (مورد ۳ و ۶):
   * نام، شماره تلفن، نوع (تکی/عمده) و «مجموع مبلغ خریدِ دستی».
   * فقط فیلدهایی که فرستاده شده‌اند عوض می‌شوند.
   */
  async updateCustomer(input: CustomerSaveInput) {
    const id = Number(input?.id)
    if (!Number.isFinite(id) || id <= 0) throw new BusinessError('مشتری برای ویرایش مشخص نشده است.')
    const before = await prisma.customer.findUnique({ where: { id } })
    if (!before) throw new BusinessError('این مشتری پیدا نشد؛ فهرست را تازه‌سازی کنید.')

    const data: Prisma.CustomerUpdateInput = {}
    // نشست ۱۵۰ — validation عددی پیش از هر فیلد دیگر ⇒ رد کامل، نه ذخیره‌ی نیمه
    const manualPurchaseTotal =
      input.manualPurchaseTotal !== undefined ? assertManualPurchaseTotal(input.manualPurchaseTotal) : undefined
    if (input.name !== undefined) {
      const name = String(input.name ?? '').trim()
      if (!name) throw new BusinessError('نام مشتری نمی‌تواند خالی باشد.')
      data.name = name
    }
    if (input.phone !== undefined) {
      const phone = normalizePhone(input.phone) || null
      if (phone) {
        const same = await findCustomerByPhone(prisma, phone)
        if (same && same.id !== id)
          throw new BusinessError(
            `این شماره تلفن قبلاً برای «${same.name}» (کد ${same.code}) ثبت شده است. ` +
              'دو مشتری با یک شماره ثبت نمی‌شود؛ همان مشتری را ویرایش کنید.'
          )
      }
      data.phone = phone
    }
    if (input.address !== undefined) data.address = String(input.address ?? '').trim() || null
    if (input.isWholesale !== undefined) data.isWholesale = input.isWholesale === true
    if (manualPurchaseTotal !== undefined) data.manualPurchaseTotal = manualPurchaseTotal

    if (!Object.keys(data).length) return before
    const after = await prisma.customer.update({ where: { id }, data })
    await audit(prisma, {
      action: 'SETTINGS_UPDATE',
      entity: 'Customer',
      entityId: id,
      userId: input.userId ?? null,
      before: JSON.stringify({
        name: before.name,
        phone: before.phone,
        isWholesale: before.isWholesale,
        manualPurchaseTotal: before.manualPurchaseTotal
      }),
      after: JSON.stringify({
        name: after.name,
        phone: after.phone,
        isWholesale: after.isWholesale,
        manualPurchaseTotal: after.manualPurchaseTotal
      }),
      note: 'ویرایش دستی مشتری از پنل مشتریان'
    })
    return after
  },

  /**
   * حذف یک مشتری از پنل مشتریانِ تنظیمات (مورد ۳).
   *
   * قاعده‌ی «هشدار، نه دیوار» (قاعده‌ی ۷ README): اگر مشتری فاکتور داشته باشد،
   * بار اول فقط *گزارش* می‌دهد که چند فاکتور به او وصل است و حذف نمی‌کند. با
   * تایید آگاهانه (`force`) آن فاکتورها به «مشتری عمومی» منتقل می‌شوند (سند
   * مالی دست‌نخورده می‌ماند، فقط نام خریدارش عمومی می‌شود) و بعد مشتری حذف
   * می‌گردد. «مشتری عمومی» خودش هیچ‌وقت حذف نمی‌شود، چون فاکتورهای بی‌مشتری
   * به او تعلق می‌گیرند.
   */
  async deleteCustomer(input: {
    id: number
    force?: boolean
    userId?: number | null
    panelPassword?: string | null
  }): Promise<CustomerDeleteResult> {
    const id = Number(input?.id)
    if (!Number.isFinite(id) || id <= 0) throw new BusinessError('مشتری برای حذف مشخص نشده است.')
    const c = await prisma.customer.findUnique({ where: { id } })
    if (!c) throw new BusinessError('این مشتری پیدا نشد؛ فهرست را تازه‌سازی کنید.')
    if (c.isDefault)
      throw new BusinessError('«مشتری عمومی» پیش‌فرض برنامه است و حذف نمی‌شود (فاکتورهای بدون مشتری به او ثبت می‌شوند).')

    const invoiceCount = await prisma.saleInvoice.count({ where: { customerId: id } })
    if (invoiceCount > 0 && !input.force)
      return {
        deleted: false,
        invoiceCount,
        detachedInvoices: 0,
        name: c.name,
        message:
          `«${c.name}» ${invoiceCount} فاکتور ثبت‌شده دارد. با حذف این مشتری، آن فاکتورها پاک نمی‌شوند ولی ` +
          'خریدارشان به «مشتری عمومی» تغییر می‌کند. اگر مطمئنید، حذف را تایید کنید.'
      }

    /**
     * نشست ۱۵۵ (S151-c1، یافته‌ی Y5، بند ۴-۳۹ و ۴-۲۲؛ S155-D4) — قبلاً:
     *   • بی‌رمز: «حذف مشتری دارای فاکتور» از فهرست عملیات فقط‌مدیر است، ولی هر تماس IPC با
     *     force انجامش می‌داد.
     *   • پیوند بدهی گم می‌شد: customerId فاکتورهای نسیه‌ی باز null می‌شد و بدهی بی‌صاحب می‌ماند.
     *   • غیراتمیک: updateMany + delete + audit سه نوشتن جدا بودند.
     * حالا: (۱) مشتری دارای فاکتورِ بدهکار (غیرلغو/غیرپیش‌نویس، باطل‌نشده، تسویه‌نشده، مبلغ
     * بیشتر از صفر) حتی با رمز مدیر حذف نمی‌شود؛ (۲) برای بقیه‌ی فاکتورها رمز پنل تنظیمات (همیشه
     * قفل؛ بخش مشتریان داخل همین پنل است) پیش از تراکنش؛ (۳) جداکردن فاکتورها، حذف و Audit
     * (با شناسه‌ی همه‌ی فاکتورهای جداشده و مشخصات مشتری، تا مدرک قابل بازسازی بماند) در یک
     * $transaction با auditOrThrow.
     */
    if (invoiceCount > 0) {
      const open = await prisma.saleInvoice.findMany({
        where: {
          customerId: id,
          status: { notIn: ['CANCELED', 'DRAFT'] },
          voidedAt: null,
          settledAt: null,
          grandTotal: { gt: 0 }
        },
        select: { receiptNo: true }
      })
      if (open.length)
        throw new BusinessError(
          `«${c.name}» ${faDigits(open.length)} فاکتور با بدهی باز دارد (فیش ${open
            .slice(0, 5)
            .map((o) => faDigits(o.receiptNo ?? 0))
            .join('، ')}${open.length > 5 ? '، …' : ''}). ` +
            'تا بدهی تسویه یا فاکتور باطل نشود، این مشتری حذف نمی‌شود؛ حذف او پیوند بدهی نسیه را از بین می‌برد. ' +
            'این قاعده با رمز مدیر هم باز نمی‌شود.'
        )
      await assertPanelPassword(
        PANEL_KEYS.settings,
        (input as any)?.panelPassword ?? null,
        `حذف مشتری «${c.name}» که ${faDigits(invoiceCount)} فاکتور ثبت‌شده دارد`
      )
    }

    const detached = await prisma.$transaction(async (tx) => {
      const ids = invoiceCount
        ? (await tx.saleInvoice.findMany({ where: { customerId: id }, select: { id: true } })).map((r) => r.id)
        : []
      const count = ids.length
        ? (await tx.saleInvoice.updateMany({ where: { customerId: id }, data: { customerId: null } })).count
        : 0
      await tx.customer.delete({ where: { id } })
      await auditOrThrow(tx, {
        action: 'DELETE',
        entity: 'Customer',
        entityId: id,
        userId: input.userId ?? null,
        before: JSON.stringify({
          code: c.code,
          name: c.name,
          phone: c.phone,
          isWholesale: c.isWholesale,
          detachedInvoiceIds: ids
        }),
        note: count
          ? `حذف مشتری از پنل مشتریان با تایید رمز · ${count} فاکتور (تسویه‌شده/باطل) به «مشتری عمومی» منتقل شد`
          : 'حذف مشتری از پنل مشتریان'
      })
      return count
    })
    return {
      deleted: true,
      invoiceCount,
      detachedInvoices: detached,
      name: c.name,
      message: detached
        ? `«${c.name}» حذف شد · ${detached} فاکتورش به «مشتری عمومی» منتقل شد (هیچ سندی پاک نشد).`
        : `«${c.name}» حذف شد.`
    }
  },

  suppliers(params: { search?: string; take?: number } = {}) {
    return prisma.supplier.findMany({
      where: where(params.search),
      orderBy: { name: 'asc' },
      take: params.take ?? 50
    })
  },

  async createSupplier(input: PartyInput) {
    const name = input.name?.trim()
    if (!name) throw new Error('نام تامین‌کننده الزامی است')
    const code = input.code?.trim() || (await nextShortSupplierCode())
    const dup = await prisma.supplier.findUnique({ where: { code } })
    if (dup) throw new Error(`کد تامین‌کننده «${code}» تکراری است`)
    const s = await prisma.supplier.create({
      data: { code, name, phone: input.phone?.trim() || null, address: input.address?.trim() || null }
    })
    await audit(prisma, { action: 'SUPPLIER_CREATE', entity: 'Supplier', entityId: s.id, after: JSON.stringify({ code, name }) })
    return s
  },

  /**
   * نام یا کد میان‌بر از روی فاکتور خرید: اگر در فهرست بود همان ردیف، وگرنه ردیف تازه
   * با کد بعدی (۱، ۲، ۳…). عدد تنها = میان‌بر؛ تامین‌کنندهٔ جدید از عدد ساخته نمی‌شود.
   */
  async ensureSupplier(input: { name?: string } = {}) {
    const raw = String(input.name ?? '').trim()
    if (!raw) throw new Error('نام تامین‌کننده الزامی است')
    const codeKey = toLatinDigits(raw)
    if (/^\d+$/.test(codeKey)) {
      const byCode = await prisma.supplier.findFirst({ where: { code: codeKey }, orderBy: { id: 'asc' } })
      if (byCode) return byCode
      throw new Error(`تامین‌کننده با کد «${faDigits(codeKey)}» در فهرست نیست`)
    }
    const byName = await prisma.supplier.findFirst({ where: { name: raw }, orderBy: { id: 'asc' } })
    if (byName) return byName
    return this.createSupplier({ name: raw })
  }
}
