import { ipcMain } from 'electron'
import { cardTransferService } from '../services/CardTransferService'
import { bridgeDiagnosticsService } from '../services/bridgeDiagnosticsService'
import { financialInspectorService } from '../services/financialInspectorService'
import { pendingRestockService } from '../services/PendingRestockService'
import { stockCountService } from '../services/StockCountService'
import { staffReportService } from '../services/StaffReportService'
import { staffService } from '../services/StaffService'
import { stocktakeReminderService } from '../services/StocktakeReminderService'
import { debtReminderService } from '../services/DebtReminderService'
import { IPC } from '@shared/ipc'
import { prisma } from '../db/client'
import { productService } from '../services/ProductService'
import { wooSyncService } from '../services/WooSyncService'
import { salesService } from '../services/SalesService'
import { salesLedger } from '../services/SalesLedger'
import { reportLimitsService } from '../services/reportLimits'
import { periodLockService } from '../services/PeriodLockService'
import { storeCreditService } from '../services/StoreCreditService'
import { purchaseService } from '../services/PurchaseService'
import { partyService } from '../services/PartyService'
import { secondaryStockService } from '../services/SecondaryStockService'
import { stockAllocationService } from '../services/StockAllocationService'
import { variantPurgeService } from '../services/VariantPurgeService'
import { cashboxService } from '../services/CashboxService'
import { cashMovementService } from '../services/CashMovementService'
import { fraudService } from '../services/FraudService'
import { receiptGapReport } from '../services/receiptNo'
import { shiftService } from '../services/ShiftService'
import { settingsService } from '../services/SettingsService'
import { priceAdjustService } from '../services/PriceAdjustService'
import { printService } from '../services/PrintService'
import { exportTableFile } from '../services/ExportService'
import { authService, assertManagerPassword } from '../services/AuthService'
import { barcodePng } from '../services/BarcodeService'
import { backupService } from '../services/BackupService'
import { maintenanceService } from '../services/MaintenanceService'
import { printHtml } from '../print/printer'
import { runPrintDiagnose } from '../print/diagnose'
// نشست ۲۲۲ · فاز ۵ — دروازه‌ی مسیر RAW (بخش ۷.۱ طرح)
import { assertRawMethodAllowed } from '../print/raw/gate'
import { runPrintTestPage } from '../print/testPage'
import { runPrintSampleInvoice } from '../print/sampleInvoice'
// نشست ۳۱۷ — نمونه‌ی چاپ سند اعتبار (ایمن: بدون DB-write/شمارنده/audit)
import { creditSampleHtml, runCreditSamplePrint } from '../print/sampleCredit'
// نشست ۲۲۲ · فاز ۵ — مسیر خام (RAW): TSPL برای لیبل، ESC/POS برای رسید
import { assertRawNotDialog, isRawMethod, printMaybeRaw } from '../print/raw/route'
import { mmToPrinterDots, printTsplRows } from '../print/raw'
// نشست ۲۲۲ · فاز ۳ — resolver مشترک چاپگر (بخش ۶.۲ طرح)
import { listPrintersDetailed, printerNotFoundMessage, resolvePrintTargetName } from '../print/target'
// نشست ۲۲۲ · فاز ۱ طرح چاپ — اندازه‌ی کاغذ فاکتور (همان منبع حقیقت main/renderer)
// نشست ۲۲۲ · فاز ۲ — ابعاد «ردیف» لیبل روی رول (بخش ۸.۲ طرح)
import { labelRowDims, labelRows, receiptPageSpec } from '@shared/printSpec'
import { receiptHtml, reportHtml, labelHtml, summaryThermalHtml } from '../print/templates'
import { toUserMessage } from '../errors'
import { auditOrThrow } from '../services/AuditService'
import { AuditAction } from '@shared/enums'
import { SETTING_KEYS } from '@shared/receipt'
import { faDigits } from '@shared/jalali'
import { stripBigInts } from '@shared/money'
import {
  assertPanelUnlocked,
  notePanelUnlocked,
  clearPanelSessions,
  applyPanelSessionTtlMinutes,
  CREDIT_READ_PANEL
} from '../services/panelSession'
import { PANEL_KEYS } from '@shared/panels'
import { trendService, stockInsightService, profitService, costEngine, targetService } from '../services/management'
import { smsService, smsCampaignService, smsOptOutService } from '../services/sms'
import { BusinessError } from '../errors'

/**
 * wrapper یکسان همه‌ی کانال‌ها.
 *
 * خروجی همیشه یک پیام فارسیِ قابل‌فهم است: خطاهای منطق کسب‌وکار (که خودمان
 * فارسی نوشته‌ایم) دست‌نخورده رد می‌شوند و هر خطای فنی — پیام خام Prisma،
 * undefined، قفل SQLite و ... — به یک جمله‌ی فارسی ترجمه می‌شود. متن اصلی فقط
 * در کنسول می‌ماند تا کاربر هیچ‌وقت خطای فنی نبیند.
 */
function handle<T>(channel: string, fn: (payload: any) => Promise<T> | T) {
  ipcMain.handle(channel, async (_e: unknown, payload: any) => {
    try {
      /**
       * 🔴 نشست ۱۸۲ — مرز BigInt دقیقاً همین‌جاست.
       *
       * بعد از مهاجرت بند ۴-۲۸ الف، هر سرویسی که ردیف خام Prisma را برگرداند
       * مقدار `bigint` می‌دهد، و structured clone الکترون آن را دست‌نخورده به
       * renderer می‌رساند. کد رابط کاربری با `number` نوشته شده، پس اولین
       * `s + r.grandTotal` یا `Math.round(inv.taxTotal)` کل صفحه را با
       * «Cannot mix BigInt and other types» می‌اندازد — مثلاً ویرایش فاکتور
       * عمده و فهرست فاکتور خرید.
       *
       * رفعِ نقطه‌به‌نقطه در سرویس‌ها هیچ‌وقت کامل نمی‌شود: هر کوئری تازه‌ای
       * دوباره سوراخ می‌کند. پس تبدیل در همین تنها گلوگاه مشترک انجام می‌شود.
       * مقدار خارج از محدوده‌ی امن throw می‌شود (نه گرد) و از راه
       * `toUserMessage` به‌صورت پیام فارسی به کاربر می‌رسد.
       */
      return { ok: true, data: stripBigInts(await fn(payload), channel) }
    } catch (err: any) {
      // کدهای ساختاریافته‌ی کسب‌وکاری (مثل SESSION_REQUIRED) برای رفتار UI به رندرر عبور می‌کنند
      const code =
        err?.printCancelled === true
          ? 'PRINT_CANCELLED'
          : err?.printOutcomeUnknown === true
            ? 'PRINT_OUTCOME_UNKNOWN'
            : err?.isBusinessError === true && typeof err?.code === 'string'
              ? err.code
              : undefined
      if (!code) console.error(`[ipc:${channel}]`, err)
      return { ok: false, error: toUserMessage(err), ...(code ? { code } : {}) }
    }
  })
}

/**
 * ===========================================================================
 * «چه کسی این سند را ثبت کرد؟» — یک حلقه، یک منبع.
 *
 * مدل `User` و ستون `userId` روی فروش/برگشت/شیفت از اول وجود داشتند و همه‌ی
 * سرویس‌ها هم `userId` را می‌پذیرفتند، ولی هیچ‌جای برنامه پرش نمی‌کرد، پس تب
 * «عملکرد کارمندان» همیشه فقط یک ردیف «نامشخص» می‌داد.
 *
 * ⚠️ جلسه ۱۹ — منبع این عدد عوض شد (بند ۳): دیگر از تنظیم سراسری «کارمند فعالِ
 * پشت سیستم» خوانده نمی‌شود (آن بخش حذف شد)، بلکه از **کارمند همان نشستِ باز**
 * می‌آید. فرمول هیچ گزارشی (عملکرد کارمندان، کارت‌به‌کارت مدیر، …) یک خط هم عوض
 * نشد؛ فقط منبعِ پر شدن `userId` جابه‌جا شد.
 *
 * `withUser` عمداً در *همین لایه* نشسته است تا هیچ‌کدام از سرویس‌های سالم
 * (SalesService، CashboxService، ...) یک خط هم عوض نشوند. سه قاعده‌ی سختش:
 *   ۱) اگر renderer خودش `userId` فرستاده باشد، دست نمی‌زنیم (کنترل دست صدازننده).
 *   ۲) اگر نشست باز کارمند نداشته باشد، مقدار `null` می‌ماند ⇒ رفتار مو‌به‌موی
 *      نسخه‌های قبل («نامشخص»).
 *   ۳) هر خطایی بی‌صدا به `null` می‌افتد؛ ثبت فروش هرگز به‌خاطر این برچسب ناکام
 *      نمی‌ماند.
 * ===========================================================================
 */
async function withUser<T extends Record<string, any> | null | undefined>(payload: T): Promise<any> {
  const p: any = payload ?? {}
  if (p.userId != null) return p
  return { ...p, userId: await shiftService.currentStaffId() }
}

/**
 * قیمت خرید برای فهرست عمومی کالا لازم نیست؛ فقط پس از بازشدنِ سروریِ پنل کالا
 * در اختیار فرم همان پنل قرار می‌گیرد. خطای خواندن تنظیم قفل هم fail-closed است.
 */
async function canReadProductPurchasePrice(): Promise<boolean> {
  try {
    await assertPanelUnlocked(PANEL_KEYS.products, 'دیدن فی خرید کالا')
    return true
  } catch {
    return false
  }
}

/**
 * عملیات تغییر‌دهنده‌ی Payment نباید actor را از renderer بپذیرد.
 *
 * `withUser` برای سازگاری با مسیرهای قدیمی عمداً userId ارسالی را نگه می‌دارد،
 * اما این رفتار برای پرداخت، ابطال پرداخت و پاس‌کردن چک یک شکاف امنیتی است:
 * renderer می‌توانست نام کارمند دیگری را داخل Audit بنویسد. این مسیر فقط actor
 * نشست باز را می‌پذیرد و نبود نشست را به خطای قابل‌فهم تبدیل می‌کند — وضعیت‌محور
 * (سه حالت: نشست نداریم / کارمند نامعلوم / نشست جامانده) و با کد
 * SESSION_REQUIRED تا رندرر همان‌جا ریکاوریِ بدون خروج از صفحه را پیشنهاد دهد.
 */
async function withSessionActor<T extends Record<string, any> | null | undefined>(
  payload: T,
  operation = 'ثبت یا تغییر پرداخت'
): Promise<any> {
  const actorId = await shiftService.currentStaffId()
  if (actorId != null) return { ...(payload ?? {}), userId: actorId }
  /**
   * پیام وضعیت‌محور + کد SESSION_REQUIRED (برای بنر قابل‌اقدام در رندرر):
   * سه حالت ممکن هرکدام راهنمای متفاوت می‌خواهند — نشست نداریم، کارمند
   * نامعلوم (staffPending)، یا نشست جامانده‌ی روز دیگر که پولش شمرده نشده.
   */
  const st = await shiftService.status()
  const message =
    st.state === 'STALE' && st.stale
      ? `نشست «${st.stale.sessionLabel}» از روز ${faDigits(st.stale.dayJalali)}` +
        (st.stale.userName ? ` (کارمند: ${st.stale.userName})` : '') +
        ` هنوز باز و پولش شمرده نشده است. ` +
        // نشست ۳۱۰ · فاز ۲ — اگر اضافه‌کاری ممکن است، همان جایگزین اول معرفی می‌شود
        (st.overtimeUntilLabel
          ? `اگر هنوز مشغولید، کارمند همین نشست می‌تواند تا ساعت ${st.overtimeUntilLabel} «اضافه‌کاری» اعلام کند و ${operation} ادامه یابد؛` +
            ' وگرنه برای شروع روز تازه باید نشست جامانده بسته شود.'
          : `برای اینکه پول آن روز با فروش امروز قاطی نشود، باید همان نشست بسته و نشست تازه باز شود؛`) +
        ` روی «نشست صندوق» (یا دکمه‌ی همین پیام) بزنید، سپس ${operation} را دوباره انجام دهید.`
      : st.state === 'STAFF_PENDING'
        ? `نشست باز است ولی هنوز معلوم نیست پشت صندوق کیست؛ چون هر فاکتور باید به یک نفر نسبت داده شود،` +
          ` برای ${operation} اول از روی «نشست صندوق» کارمند را انتخاب و تأیید کنید.`
        : operation === 'ثبت یا تغییر پرداخت'
          ? // عبارت تحت‌اللفظی سازگار با قفل ساختاری s67
            'برای ثبت یا تغییر پرداخت، ابتدا یک نشست بازِ کارمند لازم است؛ روی «نشست صندوق» بزنید و نشست را باز کنید.'
          : `برای ${operation}، ابتدا یک نشست بازِ کارمند لازم است؛ روی «نشست صندوق» بزنید و نشست را باز کنید.`
  throw new BusinessError(message, 'SESSION_REQUIRED')
}

/**
 * نشست ۱۴۴ · بند ۴-۳۰ — IPCهای تغییردهنده‌ی کارت‌به‌کارت (pay/cancel/adjust).
 *
 * actor فقط از نشست باز main خوانده می‌شود (withSessionActor). برچسب‌های
 * متنی/شیفتی که قبلاً از payload renderer مستقیم در ردیف و Audit می‌نشستند
 * (userName/shiftId/shiftName) خنثی می‌شوند: رندرر رسمی هرگز آن‌ها را
 * نمی‌فرستاد و طبق بند ۴-۲ پول «حساب مدیر» به هیچ شیفتی نسبت داده نمی‌شود؛
 * پس تنها کاربردشان جعل نام/شیفت در سابقه بود.
 */
async function cardTransferActor<T extends Record<string, any> | null | undefined>(
  payload: T,
  operation: string
): Promise<any> {
  const p = await withSessionActor(payload ?? {}, operation)
  return {
    ...p,
    userName: null,
    shiftId: null,
    shiftName: null
  }
}

/**
 * بعضی mutationهای چرخه‌ی نشست می‌توانند اولین نشست را بسازند، پس نبودن
 * نشستِ قبلی نباید آن‌ها را متوقف کند. بااین‌حال اگر نشست بازی وجود دارد،
 * actor نباید از payload renderer پذیرفته شود؛ وگرنه caller می‌تواند در
 * Audit خودش را کارمند دیگری جا بزند.
 */
async function withOptionalSessionActor<T extends Record<string, any> | null | undefined>(payload: T): Promise<any> {
  const actorId = await shiftService.currentStaffId()
  return { ...(payload ?? {}), userId: actorId }
}

/**
 * `settings:set` یک مسیر قدیمی و عمومی است؛ نباید بتواند با نوشتن مستقیم روی
 * Setting، گیت‌های تنظیمات حساس را دور بزند. کلید ناشناس fail-closed است و
 * کلیدهای حساس فقط با رمز مدیر و actor واقعی نشست ثبت می‌شوند.
 */
/**
 * نشست ۱۸۰ (S180-D6، گام ۰ خوشه M) — این دو مجموعه بدون تایپ صریح، `Set` از
 * *literal*های کلید می‌شدند، پس `has(key: string)` زیر `strict` خطای TS2345
 * می‌داد و allowlist عملاً typecheck نمی‌شد. `Set<string>` همان مقادیر و همان
 * رفتار زمان‌اجرا را دارد؛ فقط ورودی `has` را درست می‌کند.
 */
const RAW_SETTING_SAFE_KEYS = new Set<string>([
  SETTING_KEYS.receiptTemplate,
  SETTING_KEYS.labelTemplate,
  SETTING_KEYS.backupConfig,
  SETTING_KEYS.backupImports
])

const RAW_SETTING_MANAGER_KEYS = new Set<string>([
  SETTING_KEYS.saleDefaults,
  SETTING_KEYS.shiftConfig,
  SETTING_KEYS.securityConfig,
  SETTING_KEYS.panelLocks,
  SETTING_KEYS.discountPolicy,
  SETTING_KEYS.accountingPolicy,
  SETTING_KEYS.creditSettings,
  SETTING_KEYS.taxCharge,
  SETTING_KEYS.serviceChargeByCategory,
  SETTING_KEYS.officialTime,
  SETTING_KEYS.stocktakeSchedule
])

/**
 * 🔴 نشست ۱۸۴ — کلیدهایی که خواندنِ خامشان از `settings:get` مجاز است.
 *
 * قاعده **fail-closed** است: هر کلیدی که این‌جا نباشد مسدود می‌شود، پس کلید
 * تازه‌ای که فردا اضافه شود هم به‌طور پیش‌فرض بیرون نمی‌رود.
 *
 * ⚠️ `managerAuth` و `panelAuth` عمداً و برای همیشه بیرون‌اند: مقدارشان
 * `salt` و هش scrypt رمزهاست. با رمز پیش‌فرض ۴ رقمی، ده‌هزار حالت را می‌شود
 * آفلاین امتحان کرد. هیچ صفحه‌ای هم به مقدار خامشان نیاز ندارد — وضعیتشان
 * («تعریف شده / پیش‌فرض») از کانال اختصاصی خودش می‌آید.
 *
 * بقیه‌ی کلیدهای این فهرست، همان‌هایی‌اند که صفحه‌ی تنظیمات و قالب چاپ
 * مستقیم می‌خوانند و هیچ راز امنیتی در خود ندارند.
 */
const RAW_SETTING_READABLE_KEYS = new Set<string>([
  ...RAW_SETTING_SAFE_KEYS,
  ...RAW_SETTING_MANAGER_KEYS,
  SETTING_KEYS.activeStaff,
  SETTING_KEYS.officialTime
])

async function setRawSetting(input: any): Promise<{ key: string }> {
  const key = String(input?.key ?? '').trim()
  if (!key) throw new Error('کلید تنظیمات مشخص نشده است.')
  if (!RAW_SETTING_SAFE_KEYS.has(key) && !RAW_SETTING_MANAGER_KEYS.has(key))
    throw new Error(`تغییر مستقیم تنظیم «${key}» از این مسیر مجاز نیست؛ از پنل رسمی همان تنظیم استفاده کنید.`)

  const actorId = await shiftService.currentStaffId()
  if (RAW_SETTING_MANAGER_KEYS.has(key))
    await assertManagerPassword(input?.managerPassword, `تغییر تنظیم حساس «${key}»`)

  const before = (await prisma.setting.findUnique({ where: { key } }))?.value ?? null
  const value = String(input?.value ?? '')
  /**
   * نشست ۲۲۲ · فاز ۳/۵ (بخش ۷.۱ طرح) — این مسیر مستقیم هم مثل پنل تنظیمات باید
   * حرف بزند: تغییر روش چاپ به «دقیق (RAW)» بدون آزمون موفق همان اجرا مجاز نیست.
   * فقط *تغییر* به RAW گیت دارد؛ مقدار قبلی RAW (و هر چیز دیگر) دست‌نخورده می‌ماند.
   */
  if (key === SETTING_KEYS.receiptTemplate || key === SETTING_KEYS.labelTemplate) {
    const parseSafe = (raw: unknown): any => {
      try {
        return typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }
    const beforeParsed = parseSafe(before)
    const nextParsed = parseSafe(value)
    if (key === SETTING_KEYS.receiptTemplate)
      assertRawMethodAllowed('INVOICE', nextParsed?.printMethod, beforeParsed?.printMethod)
    else assertRawMethodAllowed('LABEL', nextParsed?.printMethod, beforeParsed?.printMethod)
  }
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    await auditOrThrow(tx, {
      action: AuditAction.SETTINGS_UPDATE,
      entity: 'Setting',
      entityId: 0,
      userId: actorId,
      before: JSON.stringify({ key, value: before }),
      after: JSON.stringify({ key, value }),
      note:
        RAW_SETTING_MANAGER_KEYS.has(key)
          ? `تغییر تنظیم حساس از مسیر مستقیم با تایید رمز مدیر: ${key}`
          : `تغییر تنظیم از مسیر مستقیم: ${key}`
    })
  })
  return { key }
}

export function registerIpcHandlers(): void {
  void settingsService
    .securityConfig()
    .then((c) => applyPanelSessionTtlMinutes(c.idleLockMinutes))
    .catch((e) => console.error('[panelSession] load idle TTL failed', e))

  // ---- کالا / انبار ----
  // هر فهرست عمومی کالا می‌تواند برای POS/انتخابگرها خوانده شود؛ فی خرید فقط با
  // نشستِ سروریِ پنل کالا برمی‌گردد و فلگِ دلخواه renderer پذیرفته نمی‌شود.
  handle(IPC.productList, async (p) =>
    productService.list(p ?? {}, { includePurchasePrice: await canReadProductPurchasePrice() })
  )
  /**
   * نشست ۱۴۶ · بند ۴-۳۰ و ۴-۳۹ — actor عملیات کالا (ویرایش قیمت/موجودی، حذف نرم،
   * بازگردانی، حذف همیشگی، اصلاح موجودی) فقط از نشست باز main خوانده می‌شود؛
   * userId ارسالی renderer نادیده گرفته می‌شود. نشست اجباری نیست (انباردار
   * بیرون از نشست صندوق کار می‌کند، S145-D2)؛ گیت رمز داخل خود سرویس‌هاست.
   */
  handle(IPC.productUpsert, async (p) => productService.upsert(await withOptionalSessionActor(p ?? {})))
  handle(IPC.productDelete, async (p) => {
    const a = await withOptionalSessionActor(p ?? {})
    return productService.remove(a.variantIds ?? [], a.userId)
  })
  // سطل آشغال: فهرست کالاهای حذف‌شده و بازگردانی‌شان
  handle(IPC.productTrash, async (p) =>
    productService.trash(p ?? {}, { includePurchasePrice: await canReadProductPurchasePrice() })
  )
  handle(IPC.productRestore, async (p) => {
    const a = await withOptionalSessionActor(p ?? {})
    return productService.restore(a.variantIds ?? [], a.userId)
  })
  // حذف همیشگی از سطل آشغال (مورد ۸): اول پیش‌نمایش، بعد از تایید کاربر حذف واقعی
  handle(IPC.productPurgePreview, (p) => variantPurgeService.preview(p ?? {}))
  handle(IPC.productPurge, async (p) => variantPurgeService.purge(await withOptionalSessionActor(p ?? {})))
  handle(IPC.variantByBarcode, (p) => productService.byBarcode(p.barcode))
  handle(IPC.variantSearch, (p) => productService.list({ search: p.search, take: 30 }))
  handle(IPC.categoryTree, () => productService.categoryTree())
  handle(IPC.categoryUpsert, (p) => productService.categoryUpsert(p))
  handle(IPC.stockAdjust, async (p) => productService.adjustStock(await withOptionalSessionActor(p ?? {})))
  handle(IPC.stockMovements, (p) => productService.movements(p))

  // ---- همگام‌سازی موجودی سایت WooCommerce (فقط stock_quantity) ----
  handle(IPC.wooStatus, async () => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'دیدن وضعیت همگام‌سازی موجودی سایت')
    return wooSyncService.status()
  })
  handle(IPC.wooSettingsSave, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'تغییر تنظیمات همگام‌سازی موجودی سایت')
    return wooSyncService.saveSettings(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooTest, async () => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'تست اتصال سایت')
    return wooSyncService.testConnection()
  })
  handle(IPC.wooCatalog, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'خواندن کاتالوگ موجودی سایت')
    return wooSyncService.catalog(p ?? {})
  })
  handle(IPC.wooLinks, async () => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'دیدن اتصال‌های موجودی سایت')
    return wooSyncService.links()
  })
  handle(IPC.wooLinkCreate, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'اتصال کالا به موجودی سایت')
    const d = String((p ?? {}).decision ?? 'MAHAK_WINS')
    if (d === 'WOO_WINS' || d === 'MAHAK_WINS') await assertManagerPassword((p ?? {}).managerPassword ?? null, 'اتصال اولیه با انتخاب مرجع موجودی')
    return wooSyncService.linkCreate(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLinksPause, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'قطع موقت اتصال موجودی سایت')
    return wooSyncService.pause(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLinksResumePreview, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'پیش‌نمایش وصل دوباره موجودی سایت')
    return wooSyncService.resumePreview(p ?? {})
  })
  handle(IPC.wooLinksResumeApply, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'وصل دوباره موجودی سایت')
    await assertManagerPassword((p ?? {}).managerPassword ?? null, 'وصل دوباره/حل اختلاف موجودی سایت')
    return wooSyncService.resumeApply(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLinksUnlink, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'قطع دائم اتصال موجودی سایت')
    await assertManagerPassword((p ?? {}).managerPassword ?? null, 'قطع دائم اتصال موجودی سایت')
    return wooSyncService.unlink(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooSyncNow, async () => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'اجرای همگام‌سازی موجودی سایت')
    return wooSyncService.syncNow()
  })
  handle(IPC.wooParkedRetry, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'پردازش دوباره رویدادهای پارک‌شده سایت')
    await assertManagerPassword((p ?? {}).managerPassword ?? null, 'پردازش دستی رویدادهای پارک‌شده سایت')
    // actor نشست به service می‌رسد تا resolvedBy در approvalهای اعمال‌شده ثبت شود.
    const actor = await withOptionalSessionActor(p ?? {})
    return wooSyncService.retryParked(100, actor?.userId ?? null)
  })
  handle(IPC.wooApprovals, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'دیدن صف تأیید موجودی سایت')
    return wooSyncService.approvals(p ?? {})
  })
  handle(IPC.wooApprovalResolve, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'تأیید/رد تصمیم موجودی سایت')
    await assertManagerPassword((p ?? {}).managerPassword ?? null, 'تأیید/رد تصمیم موجودی سایت')
    return wooSyncService.resolveApproval(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLinksPauseProduct, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'قطع گروهی رنگ/سایزهای محصول')
    return wooSyncService.pauseProductGroup(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLinksResumeProductMahak, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'وصل گروهی رنگ/سایزهای محصول')
    await assertManagerPassword((p ?? {}).managerPassword ?? null, 'وصل گروهی رنگ/سایز با مرجع MAHAK')
    return wooSyncService.resumeProductGroupMahak(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.wooLogs, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.wooSync, 'دیدن لاگ همگام‌سازی موجودی سایت')
    return wooSyncService.logs(p ?? {})
  })

  // ---- فروش ----
  // نشست ۱۵۴ (S151-b) — actor فاکتور و Audit قیمت دستی از نشست باز، نه userId ارسالی رندرر
  /**
   * 🔴 نشست ۱۸۲ · بند ۴-۱ — فروش هم مثل برگشت و تعویض، نشست بازِ کارمند لازم دارد.
   *
   * تا امروز این دو کانال `withOptionalSessionActor` می‌گرفتند، یعنی نبودِ
   * نشست را رد نمی‌کردند و `userId` را `null` می‌گذاشتند. پایین‌تر هم
   * `shiftService.currentId()` → `ensureCurrent()` اگر نشستی نمی‌یافت، خودش
   * یک نشست **AUTO بدون کارمند** می‌ساخت و فروش ثبت می‌شد.
   *
   * نتیجه‌اش دقیقاً همان چیزی بود که بند ۴-۱ می‌خواهد جلویش را بگیرد: فاکتور
   * فروش بدون هیچ کارمند مسئولی. برگشت و تعویض از قبل درست گیت شده بودند؛
   * فقط خودِ فروش — پرتکرارترین عملیات مالی — باز مانده بود.
   */
  /**
   * ================= «تشکر از خرید» — بیرون از تراکنش فروش =================
   *
   * چرا یک هلپرِ کوچک و نه چند خط داخل خودِ هندلر:
   *
   *   ۱) **قرارداد ساختاری نشست ۱۸۲** می‌گوید خط `handle(IPC.saleCreate, …)`
   *      باید همان‌جا `withSessionActor(p ?? {}, 'ثبت فاکتور فروش')` را داشته
   *      باشد (فروش نشست بازِ کارمند لازم دارد). اگر هندلر را چندخطی می‌کردیم،
   *      آن نگهبانِ امنیتی می‌شکست. با این هلپر، هم نشست سر جایش است و هم
   *      خط، شکلِ آزموده‌شده‌ی خودش را نگه می‌دارد.
   *   ۲) «هیچ‌وقت فروش را عقب نینداز»: `notifySaleCreated` صدا زده می‌شود و
   *      `await` **نمی‌شود**؛ پاسخ به پنل فروش بلافاصله برمی‌گردد. صف پیامک
   *      خودش (هر ۲۰ ثانیه) می‌فرستد.
   *   ۳) خطا هم نمی‌تواند این‌جا را بشکند: خودِ تابع هر خطایی را می‌گیرد و
   *      `.catch` دوم فقط بیمه‌ی اضافه است.
   */
  const afterSaleThankYou = async (created: Promise<any>): Promise<any> => {
    const invoice = await created
    void smsService
      .notifySaleCreated({
        invoiceId: (invoice as any)?.id,
        orderType: (invoice as any)?.orderType,
        userId: (invoice as any)?.userId ?? null
      })
      .catch(() => undefined)
    return invoice
  }

  handle(IPC.saleCreate, async (p) => afterSaleThankYou(salesService.create(await withSessionActor(p ?? {}, 'ثبت فاکتور فروش'))))
  handle(IPC.saleUpdate, async (p) => salesService.update(await withSessionActor(p ?? {}, 'ویرایش فاکتور فروش')))
  handle(IPC.saleList, (p) => salesService.list(p ?? {}))
  handle(IPC.saleGet, (p) => salesService.get(p.id))
  // ممیزی S141 (AUDIT-S141-02، AUDIT-D72) — actor برگشت/تعویض/ابطال فقط از نشست باز؛ userId ارسالی renderer
  // نادیده گرفته می‌شود و بی‌نشست باز رد می‌شود (بند ۳ و ۴-۳۰).
  handle(IPC.saleReturn, async (p) => salesService.createReturn(await withSessionActor(p ?? {}, 'ثبت برگشت از فروش')))
  handle(IPC.saleByReturnCode, (p) => salesService.findByReturnCode(p?.code ?? ''))
  handle(IPC.saleReturnList, (p) => salesService.returnList(p ?? {}))
  handle(IPC.saleReturnGet, (p) => salesService.returnGet(p.id))
  handle(IPC.saleReturnUpdate, async (p) => salesService.returnUpdate(await withSessionActor(p ?? {}, 'ویرایش برگشت از فروش')))
  handle(IPC.saleReturnDelete, async (p) => salesService.returnDelete(await withSessionActor(p ?? {}, 'ابطال برگشت یا تعویض')))
  handle(IPC.salePurgePreview, (p) => salesService.purgePreview(p ?? {}))
  handle(IPC.salePurge, async (p) => {
    const payload = await withSessionActor(p ?? {})
    await assertManagerPassword(payload.managerPassword, 'پاک‌سازی گزارشات فروش')
    return salesService.purge(payload)
  })
  // ---- فروش نسیه: پرداختی چندمرحله‌ای و چک ----
  handle(IPC.salePayments, (p) => salesService.payments(p ?? {}))
  // نشست ۶۷ — actor همه‌ی mutationهای Payment فقط از نشست باز می‌آید؛
  // userId ارسالی renderer در این مسیرها عمداً نادیده گرفته می‌شود.
  handle(IPC.salePaymentAdd, async (p) => salesService.addPayment(await withSessionActor(p)))
  handle(IPC.saleOverpayCredit, async (p) => salesService.overpayCreditIssue(await withSessionActor(p)))
  handle(IPC.salePaymentUpdate, async (p) => salesService.updatePayment(await withSessionActor(p)))
  handle(IPC.salePaymentDelete, async (p) => salesService.deletePayment(await withSessionActor(p ?? {})))
  handle(IPC.saleChequeStatus, async (p) => salesService.setChequeStatus(await withSessionActor(p ?? {})))
  handle(IPC.saleChequeList, (p) => salesService.chequeList(p ?? {}))
  // ---- تعویض کالا و بارکد اعتبار خرید بعدی (بخش ۶) ----
  handle(IPC.saleExchangeCreate, async (p) => salesService.createExchange(await withSessionActor(p ?? {}, 'ثبت تعویض کالا')))
  handle(IPC.saleExchangeList, (p) => salesService.exchangeList(p ?? {}))
  handle(IPC.saleExchangeGet, (p) => salesService.exchangeGet(p ?? {}))
  /**
   * چاپ «سند تعویض کالا» (بخش ۶ بند ۲).
   * داده‌اش کامل از `exchangeGet` می‌آید و بارکد اعتبار — اگر صادر شده باشد —
   * با همان روش رسید فروش (`barcodePng`) روی سند چاپ می‌شود.
   */
  handle(IPC.printExchange, (p) => printService.printExchange(p ?? {}))
  // ---- افزوده‌های جلسه ۱۴ ----
  handle(IPC.printReturn, (p) => printService.printReturn(p ?? {}))
  handle(IPC.printDebtPayment, (p) => printService.printDebtPayment(p ?? {}))
  handle(IPC.printDebtPaymentPreviewHtml, (p) =>
    printService.debtPaymentHtml(Number(p?.paymentId ?? 0), { reprint: p?.reprint === true })
  )
  /**
   * 🔴 نشست ۱۸۲ · بند ۴-۴۱ — گردش دستی نقد در سمت *سرور* هم گیت می‌خواهد.
   *
   * تا امروز هیچ رمزی سنجیده نمی‌شد و قفل فقط در UI بود (صفحه‌ی بستن صندوق).
   * یعنی یک فراخوانی مستقیم IPC می‌توانست «برداشت» ثبت کند و پول را از کشو
   * خارج نشان دهد، یا «موجودی اول صندوق» را بالا ببرد و `expectedCash` را
   * متورم کند تا کسری واقعی پنهان شود.
   *
   * بند ۴-۴۱ می‌گوید رمز دوم همان صفحه‌ی بستن صندوق کافی است. چون کاربر برای
   * رسیدن به آن صفحه قفلش را باز کرده، از نشستِ پنلِ سمت سرور استفاده می‌شود
   * — نه درخواست دوباره‌ی رمز.
   *
   * ⚠️ گیت عمداً این‌جاست و نه داخل `CashMovementService`: سرویس صدازننده‌ی
   * داخلی هم دارد و بستنِ خودِ سرویس، مسیرهای برنامه‌ای را بی‌دلیل قفل می‌کرد.
   * مرزِ «درخواست از بیرون» همین لایه است.
   */
  handle(IPC.cashboxMovementAdd, async (p) => {
    /**
     * ⚠️ گیت عمداً فقط روی حرکت‌هایی است که می‌توانند کسری را **پنهان** کنند:
     *
     *   • `WITHDRAWAL` / `CASH_OUT` ⇒ پول از کشو خارج می‌شود.
     *   • `OPENING_FLOAT` ⇒ پایه‌ی `expectedCash` را بالا می‌برد؛ اگر متورم
     *     شود، کسری واقعی دیده نمی‌شود.
     *
     * `DEPOSIT` و `CASH_IN` عمداً آزادند: پول *به* کشو اضافه می‌کنند و
     * `expectedCash` را بالا می‌برند، یعنی در بستن صندوق کسری را **بزرگ‌تر**
     * نشان می‌دهند نه کوچک‌تر. بستنشان فقط مسیر عادی کارمند را قفل می‌کرد
     * بدون آنکه ریسکی را کم کند.
     */
    const t = String(p?.type ?? '')
    /**
     * 🔴 نشست ۱۸۶ · بند ۴-۳۹ — واریز دستی هم گیت گرفت.
     *
     * در نشست ۱۸۲ استدلال کردم که واریز بی‌خطر است چون `expectedCash` را بالا
     * می‌برد و کسری را *بزرگ‌تر* نشان می‌دهد. آن استدلال ناقص بود: واریزِ جعلی
     * می‌تواند **اضافه‌ی** کشو را بپوشاند — یعنی اگر کسی پول اضافه در کشو
     * گذاشته تا بعداً بردارد، یک «واریز» ساختگی آن را موجه جلوه می‌دهد.
     *
     * و مستقل از این، بند ۴-۳۹ هر حرکت دستیِ صندوق را پشت گیت می‌خواهد.
     * همه‌ی انواع یک قاعده دارند؛ استثنا فقط پیچیدگی می‌سازد.
     */
    await assertPanelUnlocked(
      PANEL_KEYS.cashClose,
      t === 'OPENING_FLOAT'
        ? 'ثبت موجودی اول صندوق'
        : t === 'WITHDRAWAL' || t === 'CASH_OUT'
          ? 'ثبت برداشت نقدی از کشو'
          : 'ثبت واریز دستی به صندوق'
    )
    return cashMovementService.add(await withSessionActor(p ?? {}, 'ثبت گردش نقدی'))
  })
  handle(IPC.cashboxMovementList, (p) => cashMovementService.list(p ?? {}))
  handle(IPC.cashboxExpected, (p) => cashboxService.expected(p ?? {}))
  // نشست ۱۷۹ (S179-D2) — مرور خواندنی است و نشست باز نمی‌خواهد؛ ولی actor Audit فقط از نشست باز main
  // (بدون نشست ⇒ null)، و actorId ارسالی رندرر هرگز پذیرفته نمی‌شود. userId payload فیلتر کارمند می‌ماند.
  handle(IPC.saleFraudReview, async (p) => fraudService.review({ ...(p ?? {}), actorId: await shiftService.currentStaffId() }))
  handle(IPC.saleReceiptGaps, () => receiptGapReport(prisma as any))
  handle(IPC.settingsAccountingPolicy, () => settingsService.accountingPolicy())
  // نشست ۱۵۴ (S151-b، S153-D1) — گیت رمز مدیر در خود سرویس؛ actor از نشست
  handle(IPC.settingsAccountingPolicySet, async (p) =>
    settingsService.setAccountingPolicy(await withOptionalSessionActor(p ?? {}))
  )
  handle(IPC.storeCreditLookup, async (p) => storeCreditService.lookup(await withOptionalSessionActor(p ?? {})))
  // ممیزی A97-01 — وضعیت نوار گزارش = وضعیت فاکتور، نه اعتبار
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۲۱ — این کانال هم مثل `credit:list` گیت می‌خواهد.
   * خروجی‌اش شامل **کد** اعتبارهاست؛ بدون گیت، فروشنده می‌توانست فهرست کدها
   * را بردارد و خرجشان کند.
   */
  handle(IPC.storeCreditList, async (p) => {
    await assertPanelUnlocked(CREDIT_READ_PANEL, 'دیدن فهرست اعتبارهای خرید در گزارش')
    return storeCreditService.reportList(p ?? {})
  })

  /**
   * ---------------- جلسه ۲۱ · «مدیریت اعتبار خرید» ----------------
   * `withUser` روی هر کانالی که چیزی *می‌نویسد* گذاشته شده تا ستون «کاربر» در
   * AuditLog و دفتر مصرف هیچ‌وقت خالی نماند (§۱۰). خواندن‌ها بدون آن می‌مانند،
   * دقیقاً مثل بقیه‌ی کانال‌های گزارشی.
   * نشست ۱۵۲ · S151-a (S151-D2) — withUser (که userId رندرر را نگه می‌داشت) با
   * withOptionalSessionActor عوض شد: actor فقط از نشست باز main؛ بدون نشست ⇒ null، نه جعلی.
   */
  handle(IPC.creditPreview, async (p) => storeCreditService.preview(await withOptionalSessionActor(p ?? {})))
  /**
   * 🔴 نشست ۱۸۲ · بند ۴-۲۱ — این سه کانال کل فهرست اعتبارها، مبالغ، دارنده‌ها
   * و سابقه‌شان را برمی‌گردانند و تا امروز **هیچ گیتی** نداشتند؛ قفل فقط در UI
   * بود. حالا سرور خودش می‌سنجد که قفل همان پنل باز شده باشد.
   *
   * چرا `assertPanelUnlocked` و نه `assertPanelPassword`: این‌ها خواندنیِ
   * پرتکرارند (با هر بار تازه‌سازی صفحه صدا زده می‌شوند) و نمی‌شود هر بار از
   * کاربر رمز خواست. نشست پنل بعد از بی‌کاری خودش منقضی می‌شود (بند ۴-۴۰).
   */
  const assertCreditRead = (what: string) => assertPanelUnlocked(CREDIT_READ_PANEL, what)
  /** همان قفل پنل اعتبار، برای کارهای **نوشتنیِ** همین پنل (نه فقط خواندن). */
  const assertCreditPanel = (what: string) => assertPanelUnlocked(CREDIT_READ_PANEL, what)
  handle(IPC.creditDashboard, async (p) => {
    await assertCreditRead('دیدن داشبورد اعتبار خرید')
    return storeCreditService.dashboard(p ?? {})
  })
  handle(IPC.creditList, async (p) => {
    await assertCreditRead('دیدن فهرست اعتبارهای خرید')
    return storeCreditService.list(p ?? {})
  })
  handle(IPC.creditDetail, async (p) => {
    await assertCreditRead('دیدن جزئیات یک اعتبار خرید')
    return storeCreditService.detail(p ?? {})
  })
  // نشست ۱۴۳ · بند ۴-۲۹ — actor صدور دستی/گروهی فقط از نشست باز main خوانده می‌شود، نه payload رندرر.
  handle(IPC.creditIssue, async (p) => storeCreditService.issueManual(await withSessionActor(p ?? {}, 'صدور دستی اعتبار خرید')))
  handle(IPC.creditBulkIssue, async (p) => storeCreditService.bulkIssue(await withSessionActor(p ?? {}, 'تولید گروهی اعتبار خرید')))
  handle(IPC.creditBatchList, async (p) => {
    await assertCreditRead('دیدن فهرست دسته‌های اعتبار')
    return storeCreditService.batches(p ?? {})
  })
  handle(IPC.creditVoid, async (p) => storeCreditService.void(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditSuspend, async (p) => storeCreditService.suspend(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditReactivate, async (p) => storeCreditService.reactivate(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditExpiryChange, async (p) => storeCreditService.changeExpiry(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditAmountChange, async (p) => storeCreditService.changeAmount(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditUsesChange, async (p) => storeCreditService.changeUses(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditHolderChange, async (p) => storeCreditService.changeHolder(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditRestrictionChange, async (p) => storeCreditService.changeRestrictions(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditDelete, async (p) => storeCreditService.remove(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditMarkPrinted, async (p) => storeCreditService.markPrinted(await withOptionalSessionActor(p ?? {})))
  handle(IPC.creditReminderCandidates, async (p) => {
    await assertCreditRead('دیدن فهرست یادآوری اعتبار')
    return storeCreditService.reminderCandidates(p ?? {})
  })
  /**
   * ثبت یادآوری اعتبار (پیامک می‌فرستد و سهمیه مصرف می‌کند).
   *
   * 🔴 دو گارد بحرانی اینجا هستند (بازبینی پنجم):
   *
   * ۱) **قفل پنل.** تا امروز این کانال هیچ گیتی نداشت، در حالی که همسایه‌های
   *    خواندنی‌اش (`creditReminderCandidates` / `creditReminderLogs`) پشت
   *    `assertCreditRead` بودند. یعنی هر رندری که بتواند IPC صدا بزند (تب
   *    دیگر/DevTools) می‌توانست بدون باز کردن قفل پنل اعتبار، برای هر کدی
   *    پیامک بسازد — یک دور زدن کامل قفل.
   *
   * ۲) **`force` از رندرر پذیرفته نمی‌شود.** `queueReminder` یک پرچم داخلی
   *    `force` دارد که دروازه‌ی تصمیم را باز می‌کند؛ اگر از payload می‌آمد،
   *    همه‌ی قواعد ضداسپم (سقف تعداد، فاصله‌ی روزها) و وضعیت کد با یک
   *    `invoke(..., {force:true})` دور زده می‌شد. تنها `id` از اینجا عبور
   *    می‌کند؛ UI هم فقط همان را می‌فرستد.
   */
  handle(IPC.creditReminderQueue, async (p) => {
    await assertCreditPanel('ثبت یادآوری اعتبار خرید')
    return storeCreditService.queueReminder(await withOptionalSessionActor({ id: (p as any)?.id }))
  })
  handle(IPC.creditReminderLogs, async (p) => {
    await assertCreditRead('دیدن سابقه‌ی یادآوری اعتبار')
    return storeCreditService.reminderLogs(p ?? {})
  })
  handle(IPC.creditSettingsGet, () => settingsService.creditSettings())
  handle(IPC.creditSettingsSet, async (p) => settingsService.saveCreditSettings(await withOptionalSessionActor(p ?? {})))
  handle(IPC.printCredit, async (p) => {
    await assertCreditRead('چاپ اعتبار خرید')
    return printService.printCredit(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.printCreditBatch, async (p) => {
    await assertCreditRead('چاپ دسته اعتبار خرید')
    return printService.printCreditBatch(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.creditPdf, async (p) => {
    await assertCreditRead('خروجی PDF اعتبار خرید')
    return printService.creditPdf(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.creditPreviewHtml, async (p) => {
    await assertCreditRead('پیش‌نمایش چاپی اعتبار خرید')
    return printService.creditHtml(Number(p?.id ?? 0))
  })
  // نشست ۳۱۷ — پیش‌نمایش/چاپ آزمایشی سند نمونه (کارت «چاپ سند اعتبار»)
  handle(IPC.creditSampleHtml, async (p) => {
    await assertCreditRead('پیش‌نمایش نمونه‌ی چاپ سند اعتبار خرید')
    return creditSampleHtml(p ?? {})
  })
  handle(IPC.creditSamplePrint, async (p) => {
    await assertCreditRead('چاپ آزمایشی سند اعتبار خرید')
    return runCreditSamplePrint(p ?? {})
  })
  // ---- تب «نسیه» گزارشات فروش (بخش ۷) ----
  handle(IPC.saleCreditList, (p) => salesService.creditList(p ?? {}))
  handle(IPC.saleReportSummary, (p) => salesService.summary(p ?? {}))
  handle(IPC.saleReportRows, (p) => salesService.reportRows(p ?? {}))
  // ریزبین مالی: فقط‌خواندنی و با authorization سمت main، مستقل از gate ظاهری renderer.
  handle(IPC.saleReportFinancialSources, (p) => financialInspectorService.sources(p))
  handle(IPC.saleReportFinancialDocument, (p) => financialInspectorService.document(p))
  // نشست ۳۱۸ — نمای تشخیص پل تطبیق (طرح برنده «کامیلا»، فاز ۲-۴)
  // open همیشه رمز تازه می‌خواهد (strict)؛ بقیه با نشست باز همان پنل. actor از main.
  handle(IPC.saleReportBridgeDiagOpen, (p) => bridgeDiagnosticsService.open((p as any)?.scope ?? {}, (p as any)?.password))
  handle(IPC.saleReportBridgeDiagSources, (p) =>
    bridgeDiagnosticsService.sources((p as any)?.scope ?? {}, (p as any)?.rowKey, (p as any)?.skip, (p as any)?.take))
  handle(IPC.saleReportBridgeDiagNotes, (p) => bridgeDiagnosticsService.notes((p as any)?.scope ?? {}))
  handle(IPC.saleReportBridgeDiagNoteAdd, (p) => bridgeDiagnosticsService.noteAdd((p as any)?.scope ?? {}, (p as any)?.text))
  handle(IPC.saleReportBridgeDiagDoc, (p) =>
    bridgeDiagnosticsService.documentDetail((p as any)?.scope ?? {}, (p as any)?.ref, (p as any)?.rowKey))
  handle(IPC.saleReportByShift, (p) => salesService.reportByShift(p ?? {}))
  handle(IPC.saleReportItems, (p) => salesService.reportItems(p ?? {}))
  // ---- افزوده‌های جلسه ۱۵ ----
  handle(IPC.saleReportLedger, (p) => salesLedger.ledger(p ?? {}))
  /** جلسه ۱۶ · بند ۵ — تعداد کل هر جدول در برابر سقف نمایشش (فقط شمارش) */
  handle(IPC.saleReportLimits, (p) => reportLimitsService.limits(p ?? {}))
  handle(IPC.salePeriodLock, (p) => periodLockService.status(p ?? {}))
  handle(IPC.paymentMethods, () => prisma.paymentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }))

  // ---- خرید ----
  // نشست ۱۵۵ (S151-c1، بند ۴-۳۹ «ثبت خرید»): actor از نشست؛ گیت رمز پنل خرید در خود سرویس
  handle(IPC.purchaseCreate, async (p) => purchaseService.create(await withOptionalSessionActor(p ?? {})))
  handle(IPC.purchaseUpdate, async (p) => purchaseService.update(await withOptionalSessionActor(p ?? {})))
  handle(IPC.purchaseList, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.purchase, 'دیدن فاکتورهای خرید')
    return purchaseService.list(p ?? {})
  })
  handle(IPC.purchaseGet, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.purchase, 'دیدن فاکتور خرید')
    return purchaseService.get(p.id)
  })
  handle(IPC.purchaseNextNo, () => purchaseService.nextNo())

  // ---- اشخاص (مشتری / تامین‌کننده) ----
  handle(IPC.customerList, (p) => partyService.customers(p ?? {}))
  handle(IPC.customerCreate, async (p) => partyService.createCustomer(await withOptionalSessionActor(p ?? {})))
  handle(IPC.customerUpdate, async (p) => partyService.updateCustomer(await withOptionalSessionActor(p ?? {})))
  handle(IPC.customerDelete, async (p) => partyService.deleteCustomer(await withOptionalSessionActor(p ?? { id: 0 })))
  handle(IPC.customerByPhone, (p) => partyService.byPhone(p ?? {}))
  handle(IPC.customerDirectory, (p) => partyService.directory(p ?? {}))
  handle(IPC.supplierList, (p) => partyService.suppliers(p ?? {}))
  handle(IPC.supplierCreate, (p) => partyService.createSupplier(p))
  handle(IPC.supplierEnsure, (p) => partyService.ensureSupplier(p ?? {}))

  // ---- انبار مرکزی (کاملاً مستقل از موجودی فروشگاه) ----
  handle(IPC.secondaryStockList, (p) => secondaryStockService.list(p ?? {}))
  // نشست ۱۴۹ · S147-b — actor همیشه از نشست main (userId رندرر قابل‌جعل بود)؛ نشست باز اجباری نیست (S145-D2)
  /**
   * 🔴 نشست ۱۸۶ · بند ۴-۳۹ — نوشتن روی انبار مرکزی گیت سرور می‌خواهد.
   *
   * تا امروز `upsert` (که مستقیم `qty` را عوض می‌کند)، `remove` و `transfer`
   * هیچ رمزی نمی‌سنجیدند؛ فقط `toStore` گیت داشت. یعنی یک فراخوانی مستقیم
   * IPC موجودی انبار مرکزی را جابه‌جا می‌کرد. Audit ثبت می‌شد ولی *جلوگیری*
   * نمی‌شد — و بند ۴-۳۹ جلوگیری می‌خواهد، نه فقط ردِ بعد از وقوع.
   */
  handle(IPC.secondaryStockUpsert, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.secondaryStock, 'ثبت یا ویرایش ردیف انبار مرکزی')
    return secondaryStockService.upsert(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.secondaryStockDelete, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.secondaryStock, 'حذف ردیف انبار مرکزی')
    return secondaryStockService.remove(await withOptionalSessionActor(p ?? {}))
  })
  /**
   * ---- بخش ۵: چند انبار / چند شعبه ----
   * `warehouseId = null` (یا صفر) = انبار پیش‌فرض. انتقال بین انبارها فقط عددهای
   * همین ماژول را جابه‌جا می‌کند و به موجودی انبار فروشگاه دست نمی‌زند.
   */
  handle(IPC.secondaryWarehouseList, (p) => secondaryStockService.warehouseList(p ?? {}))
  handle(IPC.secondaryWarehouseUpsert, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.secondaryStock, 'ثبت یا ویرایش انبار مرکزی')
    return secondaryStockService.warehouseUpsert(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.secondaryWarehouseDelete, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.secondaryStock, 'حذف انبار مرکزی')
    return secondaryStockService.warehouseRemove(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.secondaryStockTransfer, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.secondaryStock, 'انتقال بین انبارهای مرکزی')
    return secondaryStockService.transfer(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.secondaryStockHistory, (p) => secondaryStockService.history(p ?? {}))
  /**
   * جلسه ۴۷ — پیش‌نمایش انبارهای مبدأ. **هیچ چیزی نمی‌نویسد** (نه ردیف، نه لاگ،
   * نه حرکت انبار)، پس بی‌خطر است که پنجره هر بار که باز می‌شود صدایش بزند.
   */
  handle(IPC.stockSourcePreview, (p) => stockAllocationService.preview((p ?? {}) as any))
  handle(IPC.saleStockSources, (p) => stockAllocationService.summaryOf(Number((p as any)?.invoiceId ?? 0)))
  handle(IPC.saleStockSourcesMany, (p) =>
    stockAllocationService.summaryForInvoices(((p as any)?.invoiceIds ?? []) as number[])
  )

  // ---- شیفت (جلسه ۱۹: هر رکورد = یک «نشست») ----
  handle(IPC.shiftCurrent, (p) => shiftService.current(p?.userId ?? null))
  /** وضعیت نشست برای UI: بدون خطا و بدون ساخت AUTO — مخصوص چیپ/بنر هشدار */
  handle(IPC.shiftStatus, () => shiftService.status())
  /**
   * نشست ۳۱۰ · فاز ۲ — actor حسابرسی داخل سرویس از ردیفِ بازِ سرور (userId همان
   * نشست) خوانده می‌شود؛ payload رندرر هیچ اختیار هویت‌سازی ندارد، پس فقط دلیل پاس می‌شود.
   */
  handle(IPC.shiftOvertimeDeclare, async (p) => shiftService.declareOvertime({ reason: p?.reason ?? null }))
  /**
   * نشست ۱۶۰ · Y9 (S160-D2) — مسیر قدیمی shift:open هم مثل کانال رسمی shiftSessionOpen:
   * actor فقط از نشست باز main؛ بدون نشست ⇒ null و openSession کارمند انتخاب‌شده (staffId) را
   * actor می‌گذارد. userId رندرر دیگر در Audit SHIFT_OPEN نمی‌نشیند (بند ۴-۳۰).
   */
  handle(IPC.shiftOpen, async (p) => shiftService.open(await withOptionalSessionActor(p ?? {})))
  handle(IPC.shiftClose, async (p) => shiftService.close(await withSessionActor(p ?? {}, 'بستن نشست')))
  handle(IPC.shiftList, (p) => shiftService.list(p ?? {}))
  /**
   * ---- مدل «نشست»: فرم باز کردن نشست، تعویض کارمند، و گزارش override ----
   * `shift:session:staff` عمداً `withUser` نمی‌گیرد: `staffId` همان چیزی است که
   * کاربر صریح انتخاب کرده و نباید با هیچ مقدار پیش‌فرضی جابه‌جا شود.
   */
  handle(IPC.shiftSessionForm, () => shiftService.sessionForm())
  handle(IPC.shiftSessionOpen, async (p) => shiftService.openSession(await withOptionalSessionActor(p ?? {})))
  handle(IPC.shiftSessionStaff, async (p) => shiftService.confirmStaff(await withOptionalSessionActor(p ?? {})))
  handle(IPC.shiftOverrides, (p) => shiftService.overrides(p ?? {}))
  // مورد ۵ — جزئیات کامل یک شیفت بسته‌شده (فقط‌خواندنی)
  handle(IPC.shiftDetail, (p) => cashboxService.shiftDetail(p ?? {}))

  // ---- صندوق و تجمیع ----
  handle(IPC.cashSummary, (p) => cashboxService.summary(p ?? {}))
  handle(IPC.cashClose, async (p) => cashboxService.close(await withSessionActor(p ?? {}, 'بستن صندوق')))
  handle(IPC.cashSessions, (p) => cashboxService.sessions(p ?? {}))
  handle(IPC.consolidationPreview, (p) => cashboxService.preview(p ?? {}))
  /**
   * 🔴 نشست ۱۸۴ — تجمیع، کسر انبار را نهایی (FINAL) می‌کند و برگشت‌پذیر نیست.
   * تا امروز نه گیتی داشت و نه actor واقعی (userId از payload رندرر می‌آمد).
   */
  handle(IPC.consolidationFinalize, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.consolidation, 'نهایی کردن تجمیع')
    return cashboxService.finalize(await withSessionActor(p ?? {}, 'نهایی کردن تجمیع'))
  })
  handle(IPC.consolidationDays, (p) => cashboxService.days(p ?? {}))
  handle(IPC.consolidationFinalizeDays, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.consolidation, 'نهایی کردن تجمیع چند روز')
    return cashboxService.finalizeDays(await withSessionActor(p ?? { days: [] }, 'نهایی کردن تجمیع چند روز'))
  })
  handle(IPC.consolidationList, (p) => cashboxService.list(p ?? {}))

  // ---- چاپ و بارکد ----
  handle(IPC.barcodePng, (p) => barcodePng(p.text, p.opts))
  /**
   * چاپ رسید با داده‌ی آماده (مسیر قدیمی، هنوز استفاده می‌شود). قالب از
   * تنظیمات خوانده می‌شود تا همان شکل رسید فروشگاه چاپ شود.
   */
  handle(IPC.printReceipt, async (p) => {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(p.template ?? {}) }
    const data = await printService.withBarcode(p.data, tpl)
    /**
     * نشست ۲۲۲ · فاز ۱ — این مسیر (چاپ آزمایشی تنظیمات) هم اندازه‌ی کاغذ را
     * اعلام می‌کند تا با فاکتور واقعی یک‌شکل چاپ شود.
     */
    const spec = receiptPageSpec(tpl, 'RETAIL')
    /**
     * نشست ۲۲۲ · فاز ۳ (بخش ۶.۲) — نام چاپگر فقط در main و با فهرست زنده
     * اعتبارسنجی می‌شود؛ نام ناموجود ⇒ پیام فارسی و هیچ چاپی (بدون fallback).
     */
    const { deviceName } = await resolvePrintTargetName({
      requestedDeviceName: p.deviceName,
      savedName: tpl.printerName
    })
    /**
     * نشست ۲۲۲ · فاز ۵ (بخش ۸.۳ طرح) — اگر قالب صریحاً روی «دقیق (RAW)» باشد،
     * همان HTML به رستری و بعد ESC/POS می‌رود؛ وگرنه خط `printHtml` زیر مو‌به‌مو
     * همان مسیر امروز است (پیش‌فرض همه‌ی کاربران فعلی = CHROMIUM).
     */
    if (isRawMethod(tpl.printMethod)) {
      await printMaybeRaw({
        method: tpl.printMethod,
        html: receiptHtml(data, tpl),
        deviceName,
        silent: p.silent ?? true,
        pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm },
        rawDpi: tpl.rawDpi,
        rawInvert: tpl.rawInvert,
        cutMode: tpl.cutMode
      })
      return true
    }
    await printHtml(receiptHtml(data, tpl), {
      silent: p.silent ?? true,
      deviceName,
      pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm }
    })
    return true
  })
  handle(IPC.printA4, async (p) => {
    // بند ۷: `p.summary` اختیاری است (بلوک خلاصه‌ی گزارش فروش)
    await printHtml(reportHtml(p.title, p.headers, p.rows, p.totals, p.meta, p.summary), { silent: false })
    return true
  })
  /**
   * چاپ رسید یک فاکتور *ثبت‌شده*: داده از دیتابیس خوانده می‌شود و قالب از
   * تنظیمات، پس رسید چاپی همیشه با فاکتور ثبت‌شده مو‌به‌مو یکی است.
   */
  handle(IPC.printInvoice, (p) => printService.printInvoice(p))
  /** پیش‌نمایش زنده‌ی قالب رسید در پنل تنظیمات (فقط HTML، بدون چاپ) */
  handle(IPC.printPreviewHtml, (p) => printService.previewHtml(p ?? {}))
  /** پیش‌نمایش زنده‌ی لیبل در پنل تنظیمات (فقط HTML، بدون چاپ) */
  handle(IPC.printLabelPreviewHtml, (p) => printService.labelPreviewHtml(p ?? {}))
  /** چاپ حرارتی گزارش/بستن صندوق (جمع‌ها روی کاغذ ۸۰ میلی‌متری) */
  handle(IPC.printThermalSummary, async (p) => {
    /**
     * نشست ۲۲۲ · فاز ۶ (بخش ۱۰) — «خلاصه‌ی حرارتی» (بستن صندوق/سرجمع فروش):
     * همان محتوا و **همان سیاست دیالوگ** (`silent: false`)، فقط دو چیز مثل بقیه‌ی
     * چاپ‌ها: اندازه‌ی کاغذ به چاپگر اعلام می‌شود و نام چاپگر از resolver با فهرست
     * زنده می‌آید (بدون fallback خودکار). هیچ منطق گزارش/صندوق عوض نمی‌شود.
     */
    const tpl = await settingsService.receiptTemplate()
    const spec = receiptPageSpec(tpl, 'RETAIL')
    const widthMm = Number(p?.paperWidthMm) > 0 ? Number(p.paperWidthMm) : spec.widthMm
    const { deviceName } = await resolvePrintTargetName({
      requestedDeviceName: p?.deviceName,
      savedName: tpl.printerName
    })
    await printHtml(summaryThermalHtml(p.title, p.lines ?? [], p.meta, widthMm), {
      silent: false,
      deviceName,
      pageSize: { widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm }
    })
    return true
  })
  /**
   * چاپ لیبل/بارکد. لیبل‌ها از قبل در مودال پیش‌نمایش «باز» شده‌اند (تعداد نسخه‌ی
   * هر کالا تکرار شده)، پس اینجا فقط چاپ می‌شود.
   * چاپ از main انجام می‌شود، نه window.open در renderer — آن مسیر با
   * setWindowOpenHandler برنامه بلاک می‌شد و لیبل هیچ‌وقت چاپ نمی‌شد.
   */
  handle(IPC.printLabels, async (p) => {
    const labels = (p?.labels ?? []) as { name: string; code: string; price: number; barcodeDataUrl: string }[]
    if (!labels.length) throw new Error('لیبلی برای چاپ انتخاب نشده است')
    /**
     * تنظیمات لیبل کاملاً مستقل از تنظیمات فاکتور است (مورد ۵ و ۸): ابعاد،
     * اجزای روی لیبل و *چاپگر لیبل‌زن* از `label.template` می‌آیند، نه از قالب
     * رسید. `p.template` فقط برای تغییرِ همین یک چاپ است (مثلاً «بدون اسم»).
     */
    const tpl = await printService.labelTemplateFor(p?.template ?? {})
    /**
     * ⚠️ نشست ۲۲۲ · فاز ۲ (بخش ۸.۲ طرح) — اندازه‌ی صفحه **ردیف** است، نه یک لیبل:
     * عرض ردیف = columns×w + (columns−1)×gapX و ارتفاع = ارتفاع لیبل. بدون این
     * `pageSize`، درایور لیبل‌زن اندازه‌ی پیش‌فرض خودش (مثلاً A4) را می‌گرفت و
     * کاغذ خالی می‌خورد.
     * `startColumn` فقط خاصیت «همین کار چاپ» است (ذخیره نمی‌شود).
     */
    const { rowWidthMm, rowHeightMm } = labelRowDims(tpl)
    /**
     * فاز ۳ — نام چاپگر لیبل هم از resolver می‌آید: نام درخواستی renderer یا نام
     * ذخیره‌شده‌ی چاپگر لیبل؛ نبودِ هردو ⇒ چاپگر پیش‌فرض ویندوز. هیچ‌وقت بی‌صدا
     * روی چاپگر دیگری نمی‌رود (لیبل روی رسید یا برعکس).
     */
    const { deviceName } = await resolvePrintTargetName({
      requestedDeviceName: p?.deviceName,
      savedName: tpl.printerName
    })
    /**
     * نشست ۲۲۲ · فاز ۵ (بخش ۸.۲/۸.۳ طرح) — لیبل روی «دقیق (RAW)»: برای هر ردیف
     * همان `labelHtml` ردیف‌محور رستر می‌شود، ولی همه‌ی ردیف‌ها در **یک کار RAW**
     * به spooler فرستاده می‌شوند تا هزینه‌ی PowerShell و خطای وسط دسته کمتر شود.
     * `startColumn` همان تهی‌های ابتدای ردیف را بازتولید می‌کند؛ وگرنه مسیر
     * Chromium امروز دست‌نخورده است.
     */
    if (isRawMethod(tpl.printMethod)) {
      assertRawNotDialog(p?.silent)
      const startColumn = Number(p?.startColumn ?? 1)
      const rows = labelRows(labels, tpl.columns, startColumn)
      /**
       * offset در مسیر RAW دو بخش دارد:
       *   • مقدار مثبت با TSPL `REFERENCE` اعمال می‌شود تا تصویر روی رول جابه‌جا شود.
       *   • مقدار منفی را چون `REFERENCE` منفی نمی‌پذیرد، مثل Chromium داخل CSS نگه می‌داریم.
       * این کار جلوی دوبار اعمال‌شدن offset مثبت را می‌گیرد و همچنان امکان اصلاح
       * جزئی به چپ/بالا را حفظ می‌کند.
       */
      const rawTpl = {
        ...tpl,
        offsetXMm: Math.min(0, Number(tpl.offsetXMm) || 0),
        offsetYMm: Math.min(0, Number(tpl.offsetYMm) || 0)
      }
      const htmlRows: string[] = []
      for (const row of rows) {
        const items = row.filter((i): i is (typeof labels)[number] => i !== null)
        if (!items.length) continue
        const firstFilled = row.findIndex((i) => i !== null) + 1
        htmlRows.push(labelHtml(items, rawTpl, { startColumn: firstFilled }))
      }
      await printTsplRows({
        htmlRows,
        printerName: deviceName,
        widthMm: rowWidthMm,
        heightMm: rowHeightMm,
        dpi: tpl.rawDpi,
        gapMm: tpl.gapYMm,
        sensorType: tpl.sensorType,
        direction: tpl.direction,
        density: tpl.density,
        speed: tpl.speed,
        referenceX: mmToPrinterDots(tpl.offsetXMm, tpl.rawDpi),
        referenceY: mmToPrinterDots(tpl.offsetYMm, tpl.rawDpi),
        invertBits: tpl.rawInvert
      })
      return labels.length
    }
    await printHtml(labelHtml(labels, tpl, { startColumn: Number(p?.startColumn ?? 1) }), {
      /**
       * بازبینی چاپ: اگر پنجره‌ی انتخاب چاپگرِ خود برنامه قبلاً انتخاب را گرفته
       * باشد، renderer مقدار `silent` نمی‌فرستد و اینجا باید بی‌صدا چاپ شود؛
       * فقط حالت «دیالوگ ویندوز» صریحاً `silent:false` می‌فرستد.
       */
      silent: p?.silent ?? true,
      deviceName,
      pageSize: { widthMm: rowWidthMm, heightMm: rowHeightMm }
    })
    return labels.length
  })
  /**
   * نشست ۲۲۲ · فاز ۰ طرح چاپ — آزمایش‌گر چاپ (ابزار تشخیصی، تنظیمات ← تب چاپ).
   * فقط وقتی صدا زده می‌شود که کاربر خودش دکمه‌اش را بزند؛ هیچ مسیر چاپ دیگری از
   * این کانال رد نمی‌شود و هیچ تنظیمی را تغییر نمی‌دهد.
   */
  handle(IPC.printDiagnose, (p) => runPrintDiagnose(p ?? {}))

  // ---- بکاپ و بازگردانی ----
  handle(IPC.backupNow, () => backupService.runNow())
  handle(IPC.backupCreate, async (p) => backupService.createManual(await withOptionalSessionActor(p ?? {})))
  handle(IPC.backupList, () => backupService.list())
  handle(IPC.backupImport, () => backupService.importPick())
  // نشست ۱۸۴ — actor ردیف Audit بکاپ باید از نشست main بیاید، نه payload رندرر.
  handle(IPC.backupApply, async (p) => backupService.apply(await withOptionalSessionActor(p ?? {})))
  handle(IPC.backupForget, async (p) => backupService.forget(await withOptionalSessionActor(p ?? {})))
  /** تنظیمات بکاپ خودکار: مسیر ذخیره‌سازی و بازه‌ی زمانی (مورد ۶) */
  handle(IPC.backupConfig, () => backupService.config())
  handle(IPC.backupConfigSave, async (p) => backupService.saveConfig(await withOptionalSessionActor(p ?? {})))
  handle(IPC.backupPickDir, async (p) => backupService.pickAutoDir(await withOptionalSessionActor(p ?? {})))

  // ---- سبک‌سازی و نگهداری دیتابیس ----
  handle(IPC.dbStats, () => maintenanceService.stats())
  handle(IPC.maintenancePreview, (p) => maintenanceService.preview(p ?? {}))
  /**
   * آرشیو فیزیکی فقط با رمز مدیر و actor واقعی نشست باز مجاز است؛ userId ارسالی
   * از renderer عمداً نادیده گرفته می‌شود.
   */
  handle(IPC.maintenanceArchivePurge, async (p) =>
    maintenanceService.archivePurge(await withSessionActor(p ?? {}))
  )
  handle(IPC.maintenanceVacuum, () => maintenanceService.vacuum())

  // ---- سیستم و تنظیمات ----
  /**
   * 🔴 نشست ۱۸۴ — allowlist **خواندن**، آینه‌ی allowlist نوشتن.
   *
   * `settings:set` از نشست ۱۸۰ allowlist دارد، ولی سمت خواندن هیچ فیلتری
   * نبود: با `{ key: 'manager.auth' }` مقدار خام برمی‌گشت — یعنی `salt` و
   * هش scrypt رمز مدیر. رمز پیش‌فرض ۴ رقمی است و ۱۰٬۰۰۰ حالتش را می‌شود
   * آفلاین امتحان کرد. همین برای `panel.auth` (رمزهای دوم و سوم) هم صادق بود.
   *
   * قاعده fail-closed است: هر کلیدی که صراحتاً امن اعلام نشده باشد، مسدود.
   * پس کلید تازه‌ای که فردا اضافه شود هم به‌طور پیش‌فرض بیرون نمی‌رود.
   */
  handle(IPC.settingsGet, async (p) => {
    const key = String(p?.key ?? '')
    if (!RAW_SETTING_READABLE_KEYS.has(key))
      throw new BusinessError(
        `خواندن مستقیم تنظیم «${key}» از این مسیر مجاز نیست. ` +
          'اگر به این مقدار نیاز دارید، از کانال اختصاصی همان بخش استفاده کنید.'
      )
    return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null
  })
  handle(IPC.settingsSet, (p) => setRawSetting(p))
  handle(IPC.settingsBundle, () => settingsService.bundle())
  // نشست ۱۵۴ (S151-b، S153-D4) — تغییر سیاست تخفیف از این کانال هم رمز پنل تنظیمات می‌خواهد
  handle(IPC.settingsSaveBundle, async (p) => settingsService.saveBundle(await withOptionalSessionActor(p ?? {})))
  /** سوییچ «تعیین شیفت بر اساس ساعت» — ذخیره‌ی فوری، مستقل از فرم تنظیمات (مورد ۱) */
  // نشست ۱۵۷ (Y13، S157-D3) — actor از نشست باز، نه userId رندرر؛ گیت رمز مدیر در سرویس
  handle(IPC.settingsShiftByTime, async (p) => settingsService.setShiftByTime(await withOptionalSessionActor(p ?? { byTime: false })))
  handle(IPC.settingsShiftOvertimeMax, async (p) => settingsService.setShiftOvertimeMax(await withOptionalSessionActor(p ?? { minutes: 0 })))
  /** بند ۹ — «تاریخ و ساعت رسمی»: افست دستی + بررسی ساعت سیستم (بدون اینترنت) */
  handle(IPC.settingsOfficialTime, () => settingsService.officialTime())
  handle(IPC.settingsOfficialTimeSet, async (p) => settingsService.saveOfficialTime(await withOptionalSessionActor(p ?? {})))
  handle(IPC.settingsTimeCheck, () => settingsService.timeCheck())
  handle(IPC.exportCsv, (p) => exportTableFile(p))
  handle(IPC.exportExcel, (p) => exportTableFile(p))

  // ---- مدیر: رمز پنل تنظیمات / کالاها / فاکتور خرید ----
  handle(IPC.managerVerify, async (p) => {
    const res = await authService.verify(p ?? {})
    if (res?.ok) notePanelUnlocked('__manager__', 'MANAGER')
    return res
  })
  handle(IPC.managerLogout, () => {
    clearPanelSessions()
    return { ok: true as const }
  })
  handle(IPC.managerChangePassword, async (p) => authService.changePassword(await withOptionalSessionActor(p ?? {})))
  handle(IPC.managerInfo, () => authService.info())
  /**
   * «رمز دوم اختصاصی» پنل‌های قفل‌دار. رمز مدیر همیشه همه را باز می‌کند؛ رمز دوم
   * فقط همان یک پنل را (بدون شروع نشست مدیر).
   */
  handle(IPC.managerPanelInfo, () => authService.panelInfo())
  /**
   * 🔴 نشست ۱۸۲ · بند ۴-۲۱ — همان تصمیمِ باز کردن قفل، در main هم ثبت می‌شود.
   *
   * تا امروز «کدام پنل باز است» فقط یک آرایه در state رندرر بود. یعنی
   * کانال‌های خواندنیِ حساس (فهرست اعتبار، داشبورد، جزئیات) با یک فراخوانی
   * مستقیم IPC بدون هیچ قفلی جواب می‌دادند. حالا نتیجه‌ی همین تأیید، در
   * `panelSession` می‌نشیند تا آن کانال‌ها بتوانند مستقل بسنجند.
   */
  handle(IPC.managerPanelVerify, async (p) => {
    const res = await authService.verifyPanel(p ?? {})
    if (res?.ok) notePanelUnlocked(res.panel ?? p?.panel, res.scope)
    return res
  })
  handle(IPC.managerPanelSetPassword, async (p) => authService.setPanelPassword(await withOptionalSessionActor(p ?? {})))
  handle(IPC.managerPanelShiftSetPassword, async (p) =>
    authService.setPanelShiftPassword(await withOptionalSessionActor(p ?? {}))
  )
  handle(IPC.managerPanelReveal, async (p) => authService.revealPanelPassword(await withOptionalSessionActor(p ?? {})))
  /** وضعیت قفل موقت یک گیت ورود رمز (بخش ۲) — برای شمارش معکوس در صفحه‌ی رمز */
  handle(IPC.managerGateStatus, (p) => authService.gateStatus(p ?? {}))
  /**
   * ---- بند ۱: «قفل ماژول‌ها» ----
   * خواندن بدون رمز (هر گیت در لحظه‌ی رندر لازمش دارد)، نوشتن فقط با رمز مدیر.
   */
  handle(IPC.managerPanelLocks, () => authService.panelLocks())
  handle(IPC.managerPanelLocksSet, async (p) => authService.setPanelLocks(await withOptionalSessionActor(p ?? {})))

  // ---- بند ۴: ماژول «تخفیف و افزایش/کاهش قیمت» ----
  // نشست ۱۵۰ · بند ۴-۳۹ — mutationهای تغییر گروهی قیمت: گیت در سرویس، actor فقط از نشست main
  // پیش‌نمایش و تاریخچه می‌توانند فی خرید فعلی/گذشته را برگردانند؛ مثل خود صفحه،
  // این مسیرهای خواندنی هم گیت نشستِ سروریِ ماژول را رعایت می‌کنند.
  handle(IPC.priceAdjustPreview, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.priceAdjust, 'دیدن پیش‌نمایش قیمت کالاها')
    return priceAdjustService.preview(p)
  })
  handle(IPC.priceAdjustApply, async (p) => priceAdjustService.apply(await withOptionalSessionActor(p ?? {})))
  handle(IPC.priceAdjustBatches, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.priceAdjust, 'دیدن سابقهٔ تغییر قیمت کالاها')
    return priceAdjustService.batches(p ?? {})
  })
  handle(IPC.priceAdjustBatchLines, async (p) => {
    await assertPanelUnlocked(PANEL_KEYS.priceAdjust, 'دیدن ردیف‌های سابقهٔ تغییر قیمت')
    return priceAdjustService.batchLines(p ?? {})
  })
  handle(IPC.priceAdjustRevert, async (p) => priceAdjustService.revert(await withOptionalSessionActor(p ?? {})))
  handle(IPC.priceAdjustBatchEdit, async (p) => priceAdjustService.editBatch(await withOptionalSessionActor(p ?? {})))
  handle(IPC.priceAdjustBatchesDelete, async (p) =>
    priceAdjustService.deleteBatches(await withOptionalSessionActor(p ?? {}))
  )
  handle(IPC.priceAdjustActiveDiscounts, (p) => priceAdjustService.activeDiscounts(p ?? {}))
  handle(IPC.priceAdjustRunSchedule, () => priceAdjustService.runDueSchedules())
  // ---- بند ۳: سیاست تخفیف پنل فروش ----
  handle(IPC.discountPolicyGet, () => settingsService.discountPolicy())
  handle(IPC.discountPolicySave, async (p) => settingsService.saveDiscountPolicy(await withOptionalSessionActor(p ?? {})))

  // مورد ۸ — انتقال از انبار مرکزی به انبار فروشگاه
  handle(IPC.secondaryStockToStore, async (p) => secondaryStockService.toStore(await withOptionalSessionActor(p ?? {})))
  /**
   * جلسه ۵۴ — «ساخت کالای جدید + انتقال»، اتمیک در یک تراکنش.
   * ⚠️ مثل `cardTransfer:pay` و `sale:create`، رمزها فقط از همین payload به
   * سرویس می‌رسند و *سرویس* خودش `assertPanelPassword` را برای هر دو کلید
   * (`secondaryToStore` و `products`) صدا می‌زند — پس قفل فقط رندرری نیست و یک
   * تماس مستقیم IPC هم دورش نمی‌زند.
   */
  handle(IPC.secondaryStockToStoreNew, async (p) => secondaryStockService.toStoreNewVariant(await withOptionalSessionActor(p ?? {})))
  handle(IPC.secondaryStoreCandidates, (p) => secondaryStockService.storeCandidates((p ?? {}) as any))

  // ---- عوارض و مالیات / حق سرویس بر اساس دسته‌بندی کالا (اسکوپ‌دار) ----
  /** هر چهار ترکیب: { pos: { tax, service }, wholesale: { tax, service } } */
  handle(IPC.chargesGet, () => settingsService.charges())
  // نشست ۱۵۵ (S151-c1): actor از نشست؛ گیت رمز پنل در خود سرویس
  handle(IPC.chargesSave, async (p) => settingsService.saveCharge(await withOptionalSessionActor(p ?? {})))
  handle(IPC.printers, () => printService.printers())
  /**
   * نشست ۲۲۲ · فاز ۳ — فهرست زنده‌ی چاپگرها با «پیش‌فرض ویندوز» و نام نمایشی.
   * کانال قدیمی `printers` (فقط نام‌ها) دست‌نخورده می‌ماند تا هیچ مصرف‌کننده‌ای نشکند.
   */
  handle(IPC.printersDetailed, () => listPrintersDetailed())
  /**
   * ذخیره‌ی «چاپگر پیش‌فرض این بخش» — رمز نمی‌خواهد (تصمیم مالک برای فاز ۳).
   *
   * سه قرارداد:
   *   ۱) نام فقط در main و با فهرست زنده اعتبارسنجی می‌شود (نام ساختگی از renderer رد می‌شود).
   *   ۲) کل bundle از renderer گرفته نمی‌شود؛ فقط همان یک فیلد روی مقدار *تازه‌ی*
   *      دیتابیس نوشته می‌شود (خطر «ذخیره‌ی کهنه» S168-D1).
   *   ۳) برای رسید از مقدار خام استفاده می‌شود (نه `receiptTemplate()` که لوگو را
   *      از لیبل ارث می‌دهد) تا منطق `receiptLogoForSave` نشکند.
   */
  handle(IPC.printSetDefault, async (p) => {
    const profile = String(p?.profile ?? '').toUpperCase()
    if (profile !== 'INVOICE' && profile !== 'WHOLESALE' && profile !== 'LABEL')
      throw new BusinessError('پروفایل چاپ نامعتبر است.')
    const printerName = String(p?.printerName ?? '').trim()
    if (!printerName) throw new BusinessError('نام چاپگر برای ذخیره خالی است.')
    const printers = await listPrintersDetailed()
    if (!printers.some((x) => x.name === printerName)) throw new BusinessError(printerNotFoundMessage(printerName))
    return settingsService.setPrinterDefault({ profile, printerName })
  })
  /**
   * نشست ۲۲۲ · فاز ۴ (بخش ۷.۴) — چاپ آزمایشی.
   *
   * عمداً اینجا (و نه داخل بلوک چاپ قدیمی) اضافه شد: ترتیب هندلرهای قدیمی و
   * بازه‌ی `printLabels`…`printDiagnose` دست‌نخورده می‌ماند (تست ساختاری فاز ۲).
   * ورودی از renderer فقط «کدام بخش» و «کدام چاپگر» است؛ اعتبارسنجی نام و
   * خواندن قالب و اندازه‌ی کاغذ همه سمت main انجام می‌شود.
   */
  handle(IPC.printTestPage, (p) => runPrintTestPage(p ?? {}))
  /**
   * «چاپ فاکتور نمونه» کارت‌های تکی/عمده — فاکتور واقعی با داده‌ی نمونه (نه برگه‌ی
   * کالیبراسیون). resolver، روش ذخیره‌شده و موتور همان مسیر فاکتور واقعی است.
   */
  handle(IPC.printSampleInvoice, (p) => runPrintSampleInvoice(p ?? {}))

  // =======================================================================
  // جلسه ۱۷ — بندهای ۱ تا ۶
  // =======================================================================
  // بند ۱ — درخواست‌های کارت‌به‌کارت توسط مدیر
  handle(IPC.cardTransferList, (p) => cardTransferService.list(p ?? {}))
  handle(IPC.cardTransferGet, (p) => cardTransferService.get(p ?? {}))
  /**
   * ⚠️ جلسه ۴۱ · کار ب — `pay` و `cancel` هر دو `managerPassword` را از همین
   * payload به سرویس می‌رسانند و سرویس خودش `assertPanelPassword` را صدا می‌زند.
   * `withUser` همه‌ی فیلدهای payload را دست‌نخورده پاس می‌دهد (فقط `userId` را
   * پر می‌کند)، پس رمز مدیر در همین مسیر به گیت سمت سرور می‌رسد. قفل رندرر
   * دیگر تنها خط دفاع نیست: این دو کانال موجودی انبار را عوض می‌کنند.
   */
  handle(IPC.cardTransferPay, async (p) => cardTransferService.pay(await cardTransferActor(p, 'ثبت پرداخت کارت‌به‌کارت')))
  handle(IPC.cardTransferCancel, async (p) => cardTransferService.cancel(await cardTransferActor(p, 'رد/لغو درخواست کارت‌به‌کارت')))
  handle(IPC.cardTransferAdjust, async (p) => cardTransferService.adjust(await cardTransferActor(p, 'ثبت رویداد اصلاحی کارت‌به‌کارت')))
  handle(IPC.cardTransferOutOfSales, (p) => cardTransferService.outOfSales(p ?? {}))

  /**
   * جلسه ۴۱ · کار ب — خلاصه‌ی «معلق برگشتی» برای پنج صفحه.
   * فقط خواندنی و بدون هیچ گیت نوشتنی: خودِ عدد یک هشدار است، نه یک عملیات.
   * (هر صفحه در قفل خودش می‌ماند؛ این کانال هیچ قفلی را دور نمی‌زند چون هیچ
   * داده‌ی حساس‌تری از آنچه همان صفحه از قبل نشان می‌دهد برنمی‌گرداند.)
   */
  handle(IPC.pendingRestockSummary, () => pendingRestockService.summary())

  // بند ۴ — شمارش فیزیکی انبار و گزارش مغایرت
  handle(IPC.stockCountVariants, (p) => stockCountService.variants(p ?? {}))
  handle(IPC.stockCountSubmit, async (p) => stockCountService.submit({ ...(await withOptionalSessionActor(p ?? {})), userName: null } as any))
  handle(IPC.stockCountList, (p) => stockCountService.list(p ?? {}))
  handle(IPC.stockCountGet, (p) => stockCountService.get(p ?? {}))
  handle(IPC.stockCountDiscrepancy, (p) => stockCountService.discrepancy(p ?? {}))

  // بند ۵ — یادآوری انبارگردانی فیزیکی
  handle(IPC.stocktakeScheduleGet, () => stocktakeReminderService.get())
  // نشست ۱۵۷ (Y13، S157-D2/D3) — گیت رمز پنل انبارگردانی در سرویس؛ actor از نشست
  handle(IPC.stocktakeScheduleSet, async (p) => stocktakeReminderService.set(await withOptionalSessionActor(p ?? {})))
  handle(IPC.stocktakeDue, () => stocktakeReminderService.due())
  // نشست ۱۶۶ (S166-D1) — گیت رمز پنل انبارگردانی در سرویس؛ actor از نشست (نه userId رندرر)
  handle(IPC.stocktakeDismiss, async (p) => stocktakeReminderService.dismiss(await withOptionalSessionActor(p ?? {})))
  handle(IPC.debtReminderDue, () => debtReminderService.due())
  handle(IPC.debtReminderDismiss, async (p) => debtReminderService.dismiss(await withOptionalSessionActor(p ?? {})))

  // بندهای ۲، ۳ و ۶ — عملکرد کارمندان، تخفیف غیرعادی، خارج از بازه‌ی شیفت
  handle(IPC.staffList, () => staffReportService.staff())
  handle(IPC.staffPerformance, (p) => staffReportService.performance(p ?? {}))
  handle(IPC.staffTransactions, (p) => staffReportService.transactions(p ?? {}))
  handle(IPC.staffAbnormalDiscounts, (p) => staffReportService.abnormalDiscounts(p ?? {}))
  handle(IPC.staffOutOfShift, (p) => staffReportService.outOfShift(p ?? {}))

  // =======================================================================
  // کارمندان فروشگاه — ثبت / ویرایش / غیرفعال‌سازی (دست‌نخورده)
  //
  // ⚠️ جلسه ۱۹ — کانال‌های «کارمند فعالِ پشت سیستم» حذف شدند: منبع «چه کسی پشت
  // صندوق است» حالا کارمند همان *نشست* است (بند ۳)، نه یک تنظیم سراسری.
  // =======================================================================
  handle(IPC.staffDirectory, (p) => staffService.list(p ?? {}))
  // نشست ۱۶۰ · Y9 (S160-D3) — ثبت/ویرایش/غیرفعال‌سازی کارمند: actor نشست main، نه userId رندرر (بند ۴-۳۰)
  handle(IPC.staffSave, async (p) => staffService.save(await withOptionalSessionActor(p ?? {})))

  const assertMgmt = (what: string) => assertPanelUnlocked(PANEL_KEYS.managementReports, what)
  const canSeeMgmtProfit = async () => {
    try {
      await assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود و فی خرید در گزارش مدیریت')
      return true
    } catch {
      return false
    }
  }
  handle(IPC.mgmtTrend, async (p) => {
    await assertMgmt('دیدن روند فروش در گزارش مدیریت')
    return trendService.trend(p ?? {})
  })
  handle(IPC.mgmtCompare, async (p) => {
    await assertMgmt('مقایسهٔ بازه‌ها در گزارش مدیریت')
    return trendService.compare(p ?? {})
  })
  handle(IPC.mgmtStaff, async (p) => {
    await assertMgmt('مقایسهٔ فروشنده در گزارش مدیریت')
    await assertPanelUnlocked(PANEL_KEYS.staffPerformance, 'دیدن عملکرد فروشنده در گزارش مدیریت')
    return trendService.staff(p ?? {})
  })
  handle(IPC.mgmtStaffOptions, async () => {
    await assertMgmt('فهرست فروشنده‌ها در گزارش مدیریت')
    return trendService.staffOptions()
  })
  handle(IPC.mgmtSnapshot, async (p) => {
    await assertMgmt('خلاصهٔ فروش در گزارش مدیریت')
    return trendService.snapshot(p ?? {})
  })
  handle(IPC.mgmtCategory, async (p) => {
    await assertMgmt('فروش دسته در گزارش مدیریت')
    return trendService.category(p ?? {})
  })
  handle(IPC.mgmtHeatmap, async (p) => {
    await assertMgmt('ساعت شلوغ در گزارش مدیریت')
    return trendService.heatmap(p ?? {})
  })
  handle(IPC.mgmtStock, async (p) => {
    await assertMgmt('مانده و کم‌فروش در گزارش مدیریت')
    return stockInsightService.stock(p ?? {}, { withCost: await canSeeMgmtProfit() })
  })
  handle(IPC.mgmtAbc, async (p) => {
    await assertMgmt('ABC کالا در گزارش مدیریت')
    return stockInsightService.abc(p ?? {}, { withCost: await canSeeMgmtProfit() })
  })
  handle(IPC.mgmtSizeCurve, async (p) => {
    await assertMgmt('منحنی سایز در گزارش مدیریت')
    return stockInsightService.sizeCurve(p ?? {})
  })
  handle(IPC.mgmtPurchaseVsSale, async (p) => {
    await assertMgmt('خرید در برابر فروش در گزارش مدیریت')
    return stockInsightService.purchaseVsSale(p ?? {}, { withCost: await canSeeMgmtProfit() })
  })
  handle(IPC.mgmtProfit, async (p) => {
    await assertMgmt('سود در گزارش مدیریت')
    await assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود و تورم در گزارش مدیریت')
    return profitService.profit(p ?? {})
  })
  handle(IPC.mgmtCostEngineStatus, async () => {
    await assertMgmt('وضعیت دفتر هزینه')
    return costEngine.status()
  })
  handle(IPC.mgmtCostEngineRun, async () => {
    await assertMgmt('پردازش دفتر هزینه')
    return costEngine.run()
  })
  handle(IPC.mgmtCostEngineRebuild, async (p) => {
    await assertMgmt('بازسازی دفتر هزینه')
    await assertManagerPassword((p as any)?.managerPassword, 'بازسازی دفتر هزینه گزارش مدیریت')
    return costEngine.rebuild()
  })
  handle(IPC.mgmtTargetGet, async (p) => {
    await assertMgmt('دیدن هدف فروش ماهانه')
    return targetService.get(p ?? {})
  })
  handle(IPC.mgmtTargetSet, async (p) => {
    await assertMgmt('ثبت هدف فروش ماهانه')
    // B11 (بازبینی هشتم) — رد پای «چه کسی هدف را عوض کرد» در لاگ ممیزی.
    // actor فقط از main (نشست کارمندِ باز)؛ مقدار ارسالی رندرر پذیرفته نمی‌شود.
    return targetService.set({ ...(p ?? {}), actorUserId: await shiftService.currentStaffId() })
  })

  // =========================================================================
  // پنل پیامکی
  //
  // ⚠️ مرزها:
  //   • هیچ‌کدام از این هندلرها به فروش/برگشت/تعویض/اعتبار **نمی‌نویسند**.
  //   • هیچ‌کدام داخل تراکنش مالی صدا زده نمی‌شوند (ارسال، کارِ صف است).
  //   • همه پشت قفل پنل‌اند؛ قفل UI به‌تنهایی کافی نیست.
  // =========================================================================
  const assertSms = (what: string) => assertPanelUnlocked(PANEL_KEYS.smsPanel, what)
  const assertSmsProvider = (what: string) => assertPanelUnlocked(PANEL_KEYS.smsProvider, what)
  const assertSmsDanger = (what: string) => assertPanelUnlocked(PANEL_KEYS.smsDanger, what)

  handle(IPC.smsDashboard, async () => {
    await assertSms('دیدن داشبورد پنل پیامکی')
    return smsService.dashboard()
  })
  handle(IPC.smsList, async (p) => {
    await assertSms('دیدن فهرست پیام‌ها')
    return smsService.list(p ?? {})
  })
  handle(IPC.smsDetail, async (p) => {
    await assertSms('دیدن جزئیات یک پیام')
    return smsService.detail((p as any)?.id)
  })
  handle(IPC.smsEstimate, async (p) => {
    await assertSms('برآورد هزینه‌ی پیامک')
    return smsService.estimate(p ?? {})
  })
  // actor فقط از نشست main می‌آید (مثل بقیه‌ی کانال‌های ثبت)
  handle(IPC.smsSendManual, async (p) => {
    // ⚠️ قفل پنل اینجا هم لازم است: `ManagerGate` فقط UI را می‌پوشاند؛ هر
    // تماس IPC باید خودش قفل را چک کند، وگرنه «ارسال دستی» از راه دیگری
    // ممکن می‌شد. قفلِ خودِ عملیات ارسال، `smsPanel` است (نه `smsDanger`).
    await assertSms('ارسال دستی پیام')
    return smsService.sendManual(await withOptionalSessionActor(p ?? {}))
  })
  handle(IPC.smsRunNow, async () => {
    await assertSms('اجرای صف پیامک')
    return smsService.runNow(await shiftService.currentStaffId())
  })
  handle(IPC.smsCancel, async (p) => {
    // لغو یک پیام، عملیات روزمره‌ی پنل است (نه کار حساسِ «لغو گروهی»)،
    // ولی مثل بقیه از همان قفل پنل رد می‌شود.
    await assertSms('لغو یک پیام ارسال‌نشده')
    return smsService.queue.cancel((p as any)?.id, {
      reason: (p as any)?.reason,
      userId: await shiftService.currentStaffId()
    })
  })
  handle(IPC.smsRequeue, async (p) => {
    /**
     * «برگرداندن به صف» دو چهره دارد و قفلش هم باید دو حالت داشته باشد:
     * برگرداندن یک پیام روزمره که اشتباهی لغو شده کارِ روزمره است؛ ولی
     * برگرداندن ردیفِ **کمپین** دقیقاً همان راهی است که «لغو گروهی» را دور
     * می‌زند (لغو ۱۰۰۰ پیام تبلیغاتی، بعد برگرداندن یکی‌یکی) — پس برای کمپین،
     * همان قفل حساسِ `smsDanger` لازم است.
     */
    const meta = await smsService.queue.meta((p as any)?.id)
    if (meta.isCampaign) await assertSmsDanger('برگرداندن پیام کمپین به صف')
    else await assertSms('برگرداندن پیام به صف')
    return smsService.queue.requeue(meta.id, { userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsCancelBulk, async (p) => {
    await assertSmsDanger('لغو گروهی پیام‌های ارسال‌نشده')
    return smsService.queue.cancelBulk((p as any)?.ids, {
      reason: (p as any)?.reason,
      userId: await shiftService.currentStaffId()
    })
  })
  handle(IPC.smsRetryNow, async (p) => {
    await assertSmsDanger('تلاش مجدد دستی روی پیام ناموفق')
    return smsService.queue.retryNow((p as any)?.id, { userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsSettingsGet, async () => {
    await assertSms('دیدن تنظیمات پنل پیامکی')
    return smsService.settings()
  })
  handle(IPC.smsSettingsSet, async (p) => {
    await assertSms('تغییر تنظیمات پنل پیامکی')
    return smsService.saveSettings(p ?? {}, await shiftService.currentStaffId())
  })
  handle(IPC.smsTemplates, async () => {
    await assertSms('دیدن قالب‌های پیام')
    return smsService.templates.list()
  })
  handle(IPC.smsTemplateSave, async (p) => {
    await assertSms('ویرایش قالب پیام')
    return smsService.templates.save({ ...(p ?? {}), userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsTemplateReset, async (p) => {
    await assertSms('بازگرداندن قالب پیام به پیش‌فرض')
    return smsService.templates.reset((p as any)?.code, await shiftService.currentStaffId())
  })
  handle(IPC.smsProviders, async () => {
    await assertSmsProvider('دیدن تنظیمات سرویس‌دهنده‌ی پیامک')
    return smsService.providers.list()
  })
  handle(IPC.smsProviderSave, async (p) => {
    await assertSmsProvider('تنظیمات سرویس‌دهنده‌ی پیامک')
    // ⚠️ عوض‌کردن کلید API، جدا از قفل پنل، رمز مدیر هم می‌خواهد — داخل
    // خودِ سرویس بررسی می‌شود (`assertManagerPassword`) تا این مسیر قابل دور زدن نباشد.
    return smsService.providers.save({ ...(p ?? {}), userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsProviderActivate, async (p) => {
    await assertSmsProvider('فعال‌کردن سرویس‌دهنده‌ی پیامک')
    return smsService.providers.activate((p as any)?.id, await shiftService.currentStaffId())
  })
  handle(IPC.smsProviderTest, async (p) => {
    await assertSmsProvider('تست اتصال سرویس‌دهنده‌ی پیامک')
    return smsService.providers.test((p as any)?.id, await shiftService.currentStaffId())
  })

  // -------------------------------------------------------------------------
  // فاز ۴ — پیامک انبوه تبلیغاتی («لغو ۱۱» + لغو گروهی)
  //
  // ⚠️ «ثبت کمپین» و «لغو گروهی» قفل `smsDanger` می‌خواهند: این دو عمل،
  // مستقیم روی هزینه و روی هزار شماره‌ی واقعی اثر می‌گذارند. بقیه (دیدن
  // دفترچه/پیش‌نمایش/فهرست) فقط با قفل خودِ پنل باز می‌شوند.
  // -------------------------------------------------------------------------
  handle(IPC.smsCampaignBank, async () => {
    await assertSms('دیدن دفترچه‌ی شماره‌های برنامه')
    return smsCampaignService.bank()
  })
  handle(IPC.smsCampaignPreview, async (p) => {
    await assertSms('پیش‌نمایش کمپین پیامک')
    return smsCampaignService.preview(p ?? {})
  })
  handle(IPC.smsCampaignCreate, async (p) => {
    await assertSmsDanger('ثبت کمپین پیامک انبوه')
    return smsCampaignService.create({ ...(p ?? {}), userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsCampaignList, async (p) => {
    await assertSms('دیدن فهرست کمپین‌ها')
    return smsCampaignService.list(p ?? {})
  })
  handle(IPC.smsCampaignDetail, async (p) => {
    await assertSms('دیدن جزئیات کمپین')
    return smsCampaignService.detail((p as any)?.id)
  })
  handle(IPC.smsCampaignCancel, async (p) => {
    await assertSmsDanger('لغو گروهی کمپین پیامکی')
    return smsCampaignService.cancel((p as any)?.id, {
      reason: (p as any)?.reason,
      userId: await shiftService.currentStaffId()
    })
  })
  handle(IPC.smsOptOutList, async (p) => {
    await assertSms('دیدن فهرست «لغو ۱۱»')
    return smsOptOutService.list(p ?? {})
  })
  handle(IPC.smsOptOutAdd, async (p) => {
    await assertSms('ثبت شماره در فهرست «لغو ۱۱»')
    return smsOptOutService.add({ ...(p ?? {}), userId: await shiftService.currentStaffId() })
  })
  handle(IPC.smsOptOutRemove, async (p) => {
    await assertSms('حذف شماره از فهرست «لغو ۱۱»')
    return smsOptOutService.remove((p as any)?.id, { userId: await shiftService.currentStaffId() })
  })
}
