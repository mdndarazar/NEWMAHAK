/** تنها منبع نام کانال‌های IPC. main و renderer هر دو از همین فایل می‌خوانند. */
export const IPC = {
  // کالا / انبار
  productList: 'product:list',
  productUpsert: 'product:upsert',
  productDelete: 'product:delete',
  variantByBarcode: 'variant:byBarcode',
  variantSearch: 'variant:search',
  categoryTree: 'category:tree',
  categoryUpsert: 'category:upsert',
  stockAdjust: 'stock:adjust',
  stockMovements: 'stock:movements',
  /** WooCommerce stock sync — فقط موجودی انبار، نه قیمت/سفارش/مشتری. */
  wooStatus: 'woo:status',
  wooSettingsSave: 'woo:settings:save',
  wooTest: 'woo:test',
  wooCatalog: 'woo:catalog',
  wooLinks: 'woo:links',
  wooLinkCreate: 'woo:links:create',
  wooLinksPause: 'woo:links:pause',
  wooLinksResumePreview: 'woo:links:resumePreview',
  wooLinksResumeApply: 'woo:links:resumeApply',
  wooLinksUnlink: 'woo:links:unlink',
  wooSyncNow: 'woo:sync:now',
  wooParkedRetry: 'woo:parked:retry',
  wooLogs: 'woo:logs',

  // فروش
  saleCreate: 'sale:create',
  saleUpdate: 'sale:update',
  saleList: 'sale:list',
  saleGet: 'sale:get',
  saleReturn: 'sale:return',
  /** پیدا کردن فاکتور فروش تکی با «کد فاکتور» (تایپ یا اسکن بارکد) */
  saleByReturnCode: 'sale:byReturnCode',
  /** فهرست برگشت‌های ثبت‌شده (تب برگشت از فروش در گزارشات) */
  saleReturnList: 'sale:return:list',
  /** یک برگشت ثبت‌شده با اقلامش (برای فرم ویرایش در پنل برگشت از فروش) */
  saleReturnGet: 'sale:return:get',
  /** ویرایش تعداد/اقلام یک برگشت ثبت‌شده؛ اختلاف روی موجودی انبار اعمال می‌شود */
  saleReturnUpdate: 'sale:return:update',
  /** حذف یک برگشت ثبت‌شده؛ اثر آن روی موجودی انبار برگردانده (reverse) می‌شود */
  saleReturnDelete: 'sale:return:delete',
  /**
   * پیش‌نمایش حذف گزارشات فروش (بدون هیچ تغییری در داده).
   * با `invoiceIds` = فقط همان فاکتورهای تیک‌خورده (حذف تکی/چندتایی — مورد ۱).
   */
  salePurgePreview: 'sale:purge:preview',
  /** حذف گزارشات فروش یک بازه، با انتخاب بازگشت یا نبازگشتِ موجودی به انبار */
  salePurge: 'sale:purge',
  /**
   * ---------------------------------------------------------------------
   * فروش نسیه (اقساطی): پرداختی چندمرحله‌ای و چک روی یک فاکتور.
   * ---------------------------------------------------------------------
   */
  /** تاریخچه‌ی کامل پرداختی‌های یک فاکتور + باقی‌مانده و وضعیت تسویه */
  salePayments: 'sale:payments',
  /** ثبت یک پرداختی جدید (پرداختی دوم، سوم، ...) — نقدی یا چک */
  salePaymentAdd: 'sale:payment:add',
  /** ویرایش یک پرداختی/چک ثبت‌شده */
  salePaymentUpdate: 'sale:payment:update',
  /** حذف یک پرداختی/چک ثبت‌شده (اشتباه ثبت شده بود) */
  salePaymentDelete: 'sale:payment:delete',
  /** نشست ۶۱ · بند ۴-۳۵/۵۵ — صدور کد اعتبار خرید از اضافه‌دریافت موجود یک فاکتور */
  saleOverpayCredit: 'sale:overpay:credit',
  /** تغییر وضعیت یک چک: پاس شد / برگشت خورد / در جریان */
  saleChequeStatus: 'sale:cheque:status',
  /** فهرست چک‌های ثبت‌شده (سررسید، وضعیت، فاکتور) */
  saleChequeList: 'sale:cheque:list',
  /**
   * ---------------------------------------------------------------------
   * تعویض کالا (بخش ۶) و «بارکد اعتبار خرید بعدی».
   * ---------------------------------------------------------------------
   */
  /** ثبت یک تعویض: برگشت اقلام + فروش اقلام جایگزین در یک تراکنش */
  saleExchangeCreate: 'sale:exchange:create',
  /** فهرست تعویض‌های یک بازه با جزئیات کامل (تب «تعویض کالا» گزارشات) */
  saleExchangeList: 'sale:exchange:list',
  /** یک تعویض ثبت‌شده با همه‌ی جزئیاتش */
  saleExchangeGet: 'sale:exchange:get',
  /** چاپ «سند تعویض» (با بارکد اعتبار خرید بعدی، اگر صادر شده باشد) */
  printExchange: 'print:exchange',
  /**
   * ==================== افزوده‌های جلسه ۱۴ ====================
   * نام‌گذاری دقیقاً هم‌سبک کانال‌های موجود: `<دامنه>:<موضوع>:<عمل>`.
   */
  /** بند ۱۳ — چاپ رسید «برگشت از فروش» (خواهرِ print:exchange) */
  printReturn: 'print:return',
  /** فیش وصول نسیه (بعد از commit پرداخت؛ به ثبت پول وصل نیست) */
  printDebtPayment: 'print:debtPayment',
  /** HTML همان فیش برای تست/پیش‌نمایش (بدون چاپ) */
  printDebtPaymentPreviewHtml: 'print:debtPaymentPreviewHtml',
  /** بند ۱۶ — ثبت موجودی اول صندوق / برداشت / واریز وسط شیفت */
  cashboxMovementAdd: 'cashbox:movement:add',
  /** فهرست گردش‌های نقدی یک شیفت یا بازه */
  cashboxMovementList: 'cashbox:movement:list',
  /** پیش‌نمایش شفافِ فرمول expectedCash قبل از زدن دکمه‌ی نهایی بستن صندوق */
  cashboxExpected: 'cashbox:expected',
  /** بند ۷ — بخش هشدارهای مدیریتی (ضدتقلب) */
  saleFraudReview: 'sale:fraud:review',
  /** بند ۴-۱۶ — شماره‌های جاافتاده/باطل‌شده‌ی فیش (فقط خواندنی) */
  saleReceiptGaps: 'sale:receipt:gaps',
  /** سیاست حسابداری (آستانه‌ی مغایرت، سقف اعتبار، گیت‌ها) */
  settingsAccountingPolicy: 'settings:accountingPolicy:get',
  settingsAccountingPolicySet: 'settings:accountingPolicy:set',
  /** بررسی یک بارکد اعتبار (مصرف‌نشده؟ منقضی؟ چه مبلغی؟) — بدون مصرف کردنش */
  storeCreditLookup: 'storeCredit:lookup',
  /** فهرست بارکدهای اعتبار یک بازه (صادرشده / مصرف‌شده) */
  storeCreditList: 'storeCredit:list',

  /**
   * =====================================================================
   * جلسه ۲۱ · ماژول «مدیریت اعتبار خرید».
   *
   * ⚠️ دو کانال بالا (`storeCreditLookup` / `storeCreditList`) عمداً دست‌نخورده
   * ماندند تا پنل فروش و فاکتور عمده یک خط هم عوض نشوند؛ همه‌ی قابلیت‌های تازه
   * کانال *جدید* گرفتند. هر کانالی که کار حساس می‌کند، سمت سرویس هم رمز مدیر
   * می‌خواهد (§۲۱: هیچ قاعده‌ای فقط به UI متکی نیست).
   * =====================================================================
   */
  /** پیش‌نمایش مصرف روی یک سبد، بدون تغییر چیزی (مبلغ قابل جذب + اقلام واجد شرایط) */
  creditPreview: 'credit:preview',
  /** داشبورد اعتبار: مجموع صادرشده/مصرف‌شده/باقی‌مانده/فعال/منقضی/تعهد فروشگاه */
  creditDashboard: 'credit:dashboard',
  /** فهرست اعتبارها با فیلتر نوع/وضعیت/مشتری/دسته/جست‌وجوی متنی */
  creditList: 'credit:list',
  /** جزئیات یک اعتبار + دفتر مصرف + Timeline کامل رویدادها */
  creditDetail: 'credit:detail',
  /** صدور تکیِ اعتبار توسط مدیریت (source = MANUAL) */
  creditIssue: 'credit:issue',
  /** تولید گروهی (۱ تا هزاران) با Batch Insert و سنجش ظرفیت کد */
  creditBulkIssue: 'credit:bulk:issue',
  /** فهرست دسته‌های تولید گروهی (مبنای چاپ دسته‌ای) */
  creditBatchList: 'credit:batch:list',
  /** ابطال (تغییر وضعیت، نه حذف) — رمز مدیر + دلیل اجباری */
  creditVoid: 'credit:void',
  /** تعلیق موقت */
  creditSuspend: 'credit:suspend',
  /** فعال‌سازی مجدد (از تعلیق یا انقضا، با تمدید تاریخ) */
  creditReactivate: 'credit:reactivate',
  /** تغییر تاریخ انقضا */
  creditExpiryChange: 'credit:expiry:change',
  /** تغییر مبلغ (روی اعتبار مصرف‌شده ممنوع است) */
  creditAmountChange: 'credit:amount:change',
  /** تغییر دفعات مجاز مصرف / حالت چندباره / سقف هر تراکنش */
  creditUsesChange: 'credit:uses:change',
  /** تغییر دارنده و اطلاعات گیرنده */
  creditHolderChange: 'credit:holder:change',
  /** تغییر محدودیت کالا/دسته/حداقل خرید */
  creditRestrictionChange: 'credit:restriction:change',
  /** حذف واقعی (بدون مصرف) یا آرشیو (با مصرف) */
  creditDelete: 'credit:delete',
  /** ثبت چاپ سند اعتبار (نسخه‌ی دوم به بعد «نسخه‌ی مجدد» می‌خورد) */
  creditMarkPrinted: 'credit:markPrinted',
  /** فهرست «اعتبارهای واجد شرایط یادآوری» + دلیل فارسی هر ردیف */
  creditReminderCandidates: 'credit:reminder:candidates',
  /** ثبت یک یادآوری در صف (بدون هیچ ارسال واقعی پیامک) */
  creditReminderQueue: 'credit:reminder:queue',
  /** لاگ یادآوری‌های ثبت‌شده */
  creditReminderLogs: 'credit:reminder:logs',
  /** تنظیمات مرکزی اعتبار خرید (§۲۲) */
  creditSettingsGet: 'credit:settings:get',
  creditSettingsSet: 'credit:settings:set',
  /** چاپ سند اعتبار (نسخه‌ی دوم به بعد «نسخه‌ی مجدد») */
  printCredit: 'print:credit',
  /** چاپ گروهی یک دسته — یک Job چندصفحه‌ای، نه هزاران Job */
  printCreditBatch: 'print:credit:batch',
  /** خروجی PDF سند اعتبار (تکی یا چندصفحه‌ای) */
  creditPdf: 'credit:pdf',
  /** HTML پیش‌نمایش سند اعتبار (بدون چاپ) */
  creditPreviewHtml: 'credit:previewHtml',
  /** فهرست فاکتورهای نسیه (تسویه‌نشده/جزئی) + تسویه‌های نسیه‌ی بازه‌های قبل */
  saleCreditList: 'sale:credit:list',
  saleReportSummary: 'sale:report:summary',
  /** ردیف‌های آماده‌ی جدول «سرجمع فروش» + جمع‌ها */
  saleReportRows: 'sale:report:rows',
  /** همان گزارش، ولی تفکیک‌شده به شیفت‌های هر روز */
  saleReportByShift: 'sale:report:byShift',
  /** ردیف‌های «جزئیات فروش» (سطر کالا به کالا) */
  saleReportItems: 'sale:report:items',
  /**
   * ==================== افزوده‌های جلسه ۱۵ ====================
   * «دفتر رویداد» بازه: هر ردیف یک رویداد مالی/انباری با نوع رویداد، اثر روی
   * نقد، اثر روی موجودی و لینک به سند مبدأ (بخش ۵ سند مرجع).
   */
  saleReportLedger: 'sale:report:ledger',
  /**
   * ==================== افزوده‌ی جلسه ۱۶ ====================
   * بند ۵ — «سقف نمایش در برابر تعداد کل واقعی» برای *هر* جدول گزارش.
   *
   * چرا یک کانال جدا؟ چون تب‌های «جزئیات فروش»، «برگشت»، «تعویض»، «چک» و
   * «اعتبار خرید» هرکدام یک آرایه‌ی ساده برمی‌گردانند و جای امنی برای حمل
   * «تعداد کل» ندارند. اگر شکل آن پنج کانال عوض می‌شد، همه‌ی مصرف‌کننده‌های
   * موجود (پنل برگشت، جزئیات شیفت) هم‌زمان می‌شکستند. این کانال فقط *می‌شمارد*
   * و هیچ داده‌ای را تغییر نمی‌دهد، پس نوار قرمز «نمایش N از M ردیف» بدون هیچ
   * ریسکی روی همه‌ی تب‌ها می‌آید.
   */
  saleReportLimits: 'sale:report:limits',
  /** بند ۱۷ — این تاریخ در دوره‌ی بسته‌شده است؟ (فقط خواندن، بدون تغییر داده) */
  salePeriodLock: 'sale:periodLock:status',
  paymentMethods: 'payment:methods',

  // خرید
  purchaseCreate: 'purchase:create',
  purchaseUpdate: 'purchase:update',
  purchaseList: 'purchase:list',
  purchaseGet: 'purchase:get',
  purchaseNextNo: 'purchase:nextNo',

  // اشخاص (مشتری / تامین‌کننده) — لازم برای فاکتور خرید و فاکتور فروش عمده
  customerList: 'customer:list',
  customerCreate: 'customer:create',
  /** ویرایش دستی یک مشتری (نام، تلفن، نوع، مبلغ خرید دستی) — پنل مشتریان */
  customerUpdate: 'customer:update',
  /** حذف یک مشتری از پنل مشتریانِ تنظیمات (با تایید آگاهانه) */
  customerDelete: 'customer:delete',
  /** پیدا کردن مشتری با شماره تلفن (فیلد مشتری پنل فروش) */
  customerByPhone: 'customer:byPhone',
  /** «بانک شماره مشتریان» در تنظیمات: همه‌ی مشتری‌ها + تعداد و جمع خریدشان */
  customerDirectory: 'customer:directory',
  supplierList: 'supplier:list',
  supplierCreate: 'supplier:create',
  /** نام روی فاکتور خرید: موجود را برمی‌گرداند یا ردیف تازه در همان فهرست می‌سازد */
  supplierEnsure: 'supplier:ensure',

  // انبار مرکزی (کاملاً مستقل از موجودی فروشگاه)
  secondaryStockList: 'secondaryStock:list',
  secondaryStockUpsert: 'secondaryStock:upsert',
  secondaryStockDelete: 'secondaryStock:delete',
  /** چند انبار / چند شعبه (بخش ۵) */
  secondaryWarehouseList: 'secondaryStock:warehouse:list',
  secondaryWarehouseUpsert: 'secondaryStock:warehouse:upsert',
  secondaryWarehouseDelete: 'secondaryStock:warehouse:delete',
  /** انتقال کالا بین دو انبار */
  secondaryStockTransfer: 'secondaryStock:transfer',
  /**
   * بند ۸ — انتقال از یک انبار این ماژول به **انبار فروشگاه** (موجودی واقعی
   * کالا). موجودی منفی فروشگاه هم درست لحاظ می‌شود: ۳− + ۱۰ = ۷.
   */
  secondaryStockToStore: 'secondaryStock:toStore',
  /**
   * ============ جلسه ۵۴ — «ساخت کالای جدید هنگام انتقال به فروشگاه» ============
   * مسیر *دوم* و کاملاً جدا از `secondaryStockToStore`: وقتی ردیف انبار مرکزی
   * هیچ کالای متناظری در انبار فروشگاه ندارد، همین کانال کالا/واریانت را
   * می‌سازد و **در همان تراکنش** انتقال را هم انجام می‌دهد (اتمیک).
   *
   * قفل: سرور برای این کانال *هر دو* کلید `secondaryToStore` و `products` را با
   * `assertPanelPassword` می‌سنجد (بیرون از `$transaction`)، چون هم موجودی
   * فروشگاه زیاد می‌شود و هم یک کالای تازه در ماژول کالاها ساخته می‌شود.
   * مسیر «انتقال به کالای موجود» مو‌به‌مو دست‌نخورده است.
   */
  secondaryStockToStoreNew: 'secondaryStock:toStoreNew',
  /** کالاهای پیشنهادی فروشگاه برای یک ردیف انبار مرکزی (تطبیق کد/بارکد/نام) */
  secondaryStoreCandidates: 'secondaryStock:storeCandidates',
  /** تاریخچه‌ی تغییرات یک ردیف / یک انبار */
  secondaryStockHistory: 'secondaryStock:history',

  /**
   * ================== جلسه ۴۷ — «از کدام انبار کسر شود؟» ==================
   * پیش‌نمایش **بدون هیچ نوشتنی**: برای هر قلم، موجودی همه‌ی منبع‌ها (انبار
   * فروشگاه + ردیف‌های تطبیق‌خورده‌ی هر انبار، با نام و کد هر ردیف). پنجره‌ی
   * انتخاب انبار با همین داده زنجیره‌ی سؤال‌ها را جلو می‌برد.
   */
  stockSourcePreview: 'stock:sourcePreview',
  /** «خلاصه‌ی کسری‌ها»ی یک فاکتور ثبت‌شده (رسید، فهرست فاکتورها، گزارش فروش) */
  saleStockSources: 'sale:stockSources',
  /** همان خلاصه برای چند فاکتور با هم (ستون فهرست و گزارش) */
  saleStockSourcesMany: 'sale:stockSourcesMany',

  // شیفت (جلسه ۱۹: هر رکورد شیفت = یک «نشست»)
  shiftCurrent: 'shift:current',
  shiftOpen: 'shift:open',
  shiftClose: 'shift:close',
  shiftList: 'shift:list',
  /**
   * =================== جلسه ۱۹ · مدل «نشست» ===================
   * داده‌ی فرم «باز کردن نشست / تعویض کارمند»: نام پیشنهادی سیستم بر اساس ساعت،
   * فهرست شیفت‌های تعریف‌شده، کارمندان فعال، و کارمند پیش‌فرض (آخرین نشست).
   */
  shiftSessionForm: 'shift:session:form',
  /** باز کردن یک نشست تازه (کارمند اجباری · override نام با دلیل اجباری) */
  shiftSessionOpen: 'shift:session:open',
  /** تأیید/ثبت کارمند همان نشست باز (بند ۳ — کارمند اجباری) */
  shiftSessionStaff: 'shift:session:staff',
  /** گزارش مستقل «نشست‌های با نام override‌شده» (سیگنال کنترل داخلی) */
  shiftOverrides: 'shift:overrides',
  /**
   * مورد ۵ — جزئیات کامل یک شیفت بسته‌شده (فروش‌ها، برگشت‌ها و تعویض‌ها، نسیه و
   * جمع‌بندی) — همان گزارش، ولی قفل‌شده روی یک شیفت.
   */
  shiftDetail: 'shift:detail',

  // صندوق و تجمیع
  cashClose: 'cash:close',
  cashSummary: 'cash:summary',
  cashSessions: 'cash:sessions',
  consolidationPreview: 'consolidation:preview',
  consolidationFinalize: 'consolidation:finalize',
  /** وضعیت تجمیع هر روز یک بازه (برای تجمیع با تأخیر) */
  consolidationDays: 'consolidation:days',
  /** تجمیع یک یا چند روز عقب‌افتاده، هر روز به‌صورت جدا */
  consolidationFinalizeDays: 'consolidation:finalizeDays',
  consolidationList: 'consolidation:list',

  // چاپ و بارکد
  printReceipt: 'print:receipt',
  /** چاپ رسید یک فاکتور ثبت‌شده (داده از دیتابیس + قالب تنظیمات) */
  printInvoice: 'print:invoice',
  /** HTML رسید برای پیش‌نمایش زنده در پنل تنظیمات (بدون چاپ) */
  printPreviewHtml: 'print:previewHtml',
  /** HTML یک لیبل نمونه برای «پیش‌نمایش زنده‌ی لیبل» در پنل تنظیمات (بدون چاپ) */
  printLabelPreviewHtml: 'print:labelPreviewHtml',
  /** چاپ حرارتی جمع‌های یک گزارش (گزارش فروش / بستن صندوق) */
  printThermalSummary: 'print:thermalSummary',
  printA4: 'print:a4',
  printLabels: 'print:labels',
  /**
   * نشست ۲۲۲ · فاز ۰ طرح چاپ — «آزمایش‌گر چاپ».
   * ابزار تشخیصیِ فنی: برگه‌ی اندازه‌گیری با/بدون `pageSize` می‌فرستد تا معلوم شود
   * درایور چاپگر چه اندازه‌ای را می‌پذیرد. رفتار هیچ چاپ دیگری را عوض نمی‌کند.
   */
  printDiagnose: 'print:diagnose',
  /**
   * نشست ۲۲۲ · فاز ۳ طرح چاپ (بخش ۶.۳) — resolver چاپگر.
   * `printersDetailed` فهرست زنده‌ی چاپگرها با «پیش‌فرض ویندوز» و نوع حدسی است
   * (کانال قدیمی `printers` فقط نام‌ها را می‌دهد و دست‌نخورده می‌ماند).
   * `printSetDefault` فقط `printerName` یک پروفایل را در main عوض می‌کند و نام را
   * با فهرست زنده اعتبارسنجی می‌کند (هیچ fallback خودکاری وجود ندارد).
   */
  printersDetailed: 'print:printersDetailed',
  printSetDefault: 'print:setDefaultPrinter',
  /**
   * نشست ۲۲۲ · فاز ۴ طرح چاپ (بخش ۷.۴) — «چاپ آزمایشی».
   * یک برگه‌ی اندازه‌گیری با همان `pageSize` پروفایل، از همان resolver و همان
   * `printHtml` مسیر واقعی چاپ می‌شود تا اگر برگه درست آمد، فاکتور/لیبل هم درست باشد.
   * ورودی هیچ قالبی ندارد: تنظیمات *ذخیره‌شده* سمت main خوانده می‌شود.
   */
  printTestPage: 'print:testPage',
  barcodePng: 'barcode:png',

  // مدیر (رمز تنظیمات / کالاها / فاکتور خرید و «نشست مدیر»)
  /** بررسی رمز مدیریتی؛ ورود موفق = شروع نشست مدیر */
  managerVerify: 'manager:verify',
  /** بند ۴-۴۰ — خروج نشست مدیر / قفل خودکار بی‌کاری؛ نشست پنل سمت سرور پاک می‌شود */
  managerLogout: 'manager:logout',
  /** تغییر رمز مدیریتی از داخل پنل تنظیمات */
  managerChangePassword: 'manager:changePassword',
  /** آیا رمز از حالت پیش‌فرض عوض شده است (فقط برای نمایش راهنما) */
  managerInfo: 'manager:info',
  /**
   * ---------------------------------------------------------------------
   * «رمز دوم اختصاصی» پنل‌های قفل‌دار.
   *
   * رمز مدیر همیشه همه‌ی قفل‌ها را باز می‌کند؛ رمز دوم فقط همان یک پنل را.
   * ---------------------------------------------------------------------
   */
  /** وضعیت رمز دوم همه‌ی پنل‌ها (فعال/غیرفعال + تاریخ تغییر) */
  managerPanelInfo: 'manager:panel:info',
  /** باز کردن یک پنل قفل‌دار با رمز مدیر یا رمز دوم همان پنل */
  managerPanelVerify: 'manager:panel:verify',
  /** تعریف/تغییر/حذف رمز دوم یک پنل (رمز مدیر لازم است) */
  managerPanelSetPassword: 'manager:panel:setPassword',
  /**
   * ---------------------------------------------------------------------
   * نشست دهم — مورد ۷: «رمز سوم»، مختص هر ترکیب «پنل × شیفت».
   *
   * اولویت بدون استثنا: رمز مدیر > رمز دوم پنل (همه‌ی شیفت‌ها) > رمز سوم
   * همان شیفت جاری. تعریف/تغییر/حذفش — مثل رمز دوم — رمز مدیر می‌خواهد.
   * ---------------------------------------------------------------------
   */
  managerPanelShiftSetPassword: 'manager:panel:shift:setPassword',
  /**
   * مورد ۴ — نمایش دوباره‌ی رمز دوم/سوم ذخیره‌شده (رمز مدیر لازم است).
   * توضیح کامل تصمیم رمزنگاری در بالای بخش «گاوصندوق» در AuthService.
   */
  managerPanelReveal: 'manager:panel:reveal',
  /**
   * وضعیت «قفل موقت» یک گیت ورود رمز (بخش ۲): قفل است؟ چند ثانیه مانده؟ چند
   * تلاش ناموفق تا قفل شدن؟ صفحه‌ی ورود رمز با همین، شمارش معکوس نشان می‌دهد.
   */
  managerGateStatus: 'manager:gate:status',
  /**
   * ---------------------------------------------------------------------
   * بند ۱ — «قفل ماژول‌ها»: برای هر ماژول، قفل رمز دوم روشن است یا خاموش.
   *
   * خواندنش آزاد است (هر گیتی در لحظه‌ی رندر لازمش دارد) ولی *نوشتنش* رمز
   * مدیر می‌خواهد، نه رمز دوم پنل تنظیمات.
   * ---------------------------------------------------------------------
   */
  managerPanelLocks: 'manager:panel:locks',
  managerPanelLocksSet: 'manager:panel:locks:set',

  // عوارض و مالیات / حق سرویس بر اساس دسته‌بندی کالا (اسکوپ‌دار: pos | wholesale)
  chargesGet: 'charges:get',
  chargesSave: 'charges:save',

  /**
   * ---------------------------------------------------------------------
   * بند ۴ — ماژول «تخفیف و افزایش/کاهش قیمت» (تغییر گروهی قیمت کالاها).
   *
   * همیشه دو مرحله است: `preview` هیچ چیزی را عوض نمی‌کند و فقط می‌گوید «چه
   * کالایی از چه قیمتی به چه قیمتی می‌رود»؛ `apply` بعد از دیدن همان
   * پیش‌نمایش اجرا می‌شود. `revert` یک دسته‌ی ثبت‌شده را به قیمت‌های قبلش
   * برمی‌گرداند (تنها راه امنِ «اشتباه زدم، برگرد»).
   * ---------------------------------------------------------------------
   */
  priceAdjustPreview: 'priceAdjust:preview',
  priceAdjustApply: 'priceAdjust:apply',
  /** سابقه‌ی دسته‌های تغییر قیمت */
  priceAdjustBatches: 'priceAdjust:batches',
  /** کالاهای یک دسته‌ی ثبت‌شده (قیمت قبل و بعد) */
  priceAdjustBatchLines: 'priceAdjust:batch:lines',
  /** بازگردانی یک دسته به قیمت‌های قبلش */
  priceAdjustRevert: 'priceAdjust:revert',
  /**
   * ---------------------------------------------------------------------
   * نشست دهم — مورد ۲: ویرایش دامنه‌ی یک دسته‌ی ثبت‌شده و حذف ردیف‌های سابقه.
   *
   * ویرایش فقط *دامنه* را عوض می‌کند (نه فرمول): کالاهای بیرون‌رفته به قیمت
   * قبل برمی‌گردند، کالاهای تازه‌وارد با همان قاعده قیمت می‌گیرند و بقیه
   * دست‌نخورده می‌مانند. حذف، صریحاً می‌پرسد «قیمت‌ها هم برگردند یا نه».
   * ---------------------------------------------------------------------
   */
  priceAdjustBatchEdit: 'priceAdjust:batch:edit',
  priceAdjustBatchesDelete: 'priceAdjust:batches:delete',
  /**
   * مورد ۱ — «تخفیف گروهیِ در جریان» هر کالا، برای نمایش در پنل فروش
   * (قیمت قبل + درصد/مبلغ تخفیف). هیچ عددی را عوض نمی‌کند، فقط می‌خواند.
   */
  priceAdjustActiveDiscounts: 'priceAdjust:activeDiscounts',
  /**
   * مورد ۱ — اجرای فوریِ زمان‌بندهای رسیده. برنامه خودش هر لحظه این کار را
   * می‌کند؛ این کانال فقط برای دکمه‌ی «بازخوانی» صفحه است تا جدول سابقه
   * هیچ‌وقت عقب‌تر از واقعیت نباشد.
   */
  priceAdjustRunSchedule: 'priceAdjust:schedule:run',
  /** سیاست تخفیف پنل فروش (بند ۳) — خواندن و نوشتن */
  discountPolicyGet: 'discountPolicy:get',
  discountPolicySave: 'discountPolicy:save',

  // سطل آشغال کالاها (حذف نرم + بازگردانی + حذف همیشگی)
  productTrash: 'product:trash',
  productRestore: 'product:restore',
  /** پیش‌نمایش حذف همیشگی: چه سابقه‌ای به این کالاها وصل است (بدون تغییر داده) */
  productPurgePreview: 'product:purge:preview',
  /** حذف همیشگی و غیرقابل‌بازگشت واریانت‌های انتخاب‌شده از دیتابیس */
  productPurge: 'product:purge',

  // بکاپ و بازگردانی
  /** بکاپ خودکار/دستی در پوشه‌ی داخلی برنامه (بدون دیالوگ) */
  backupNow: 'system:backup',
  /** تهیه بکاپ با انتخاب مسیر توسط کاربر (دیالوگ ذخیره‌ی ویندوز) */
  backupCreate: 'system:backup:create',
  /** فهرست بکاپ‌های موجود (خودکار + واردشده) */
  backupList: 'system:backup:list',
  /** انتخاب یک فایل بکاپ از دیسک و افزودنش به فهرست */
  backupImport: 'system:backup:import',
  /** اعمال یک بکاپ: جایگزینی کامل یا ادغام با داده‌ی فعلی */
  backupApply: 'system:backup:apply',
  /** حذف یک فایل بکاپ از فهرست (فایل خودکار هم پاک می‌شود) */
  backupForget: 'system:backup:forget',
  /** تنظیمات بکاپ خودکار: مسیر ذخیره‌سازی + بازه‌ی زمانی (مورد ۶) */
  backupConfig: 'system:backup:config',
  backupConfigSave: 'system:backup:config:save',
  /** انتخاب پوشه‌ی بکاپ خودکار با پنجره‌ی ویندوز (مورد ۶) */
  backupPickDir: 'system:backup:pickDir',

  // سبک‌سازی و نگهداری دیتابیس
  dbStats: 'system:db:stats',
  maintenancePreview: 'system:maintenance:preview',
  maintenanceArchivePurge: 'system:maintenance:archivePurge',
  maintenanceVacuum: 'system:maintenance:vacuum',

  // سیستم
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** خواندن/نوشتن یک‌جای تنظیمات ساخت‌یافته (قالب رسید، فروش، شیفت) */
  settingsBundle: 'settings:bundle',
  settingsSaveBundle: 'settings:saveBundle',
  /**
   * ذخیره‌ی *فوری* سوییچ «تعیین شیفت بر اساس ساعت»، مستقل از دکمه‌ی ذخیره‌ی
   * کلی تنظیمات. تاثیر این سوییچ رفتاری و حیاتی است، پس نباید منتظر ذخیره‌ی
   * فرم بماند (مورد ۱).
   */
  settingsShiftByTime: 'settings:shift:byTime',
  /**
   * جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی»: خواندن، ذخیره‌ی افست دستی، و دکمه‌ی
   * «بررسی ساعت سیستم» (بدون نیاز به اینترنت).
   */
  settingsOfficialTime: 'settings:time',
  settingsOfficialTimeSet: 'settings:time:set',
  settingsTimeCheck: 'settings:time:check',
  /** خروجی CSV (قابل باز شدن در اکسل) از هر جدول گزارش */
  exportCsv: 'system:exportCsv',
  /** خروجی اکسل استاندارد (xlsx) با انتخاب مسیر ذخیره توسط کاربر */
  exportExcel: 'system:exportExcel',
  printers: 'system:printers',

  // =========================================================================
  // جلسه ۱۷ — کانال‌های تازه (نام‌گذاری: <domain>:<topic>:<action>)
  // =========================================================================
  /** بند ۱ — فهرست «درخواست‌های کارت‌به‌کارت» (فقط مدیر) */
  cardTransferList: 'cardTransfer:list',
  /** بند ۱ — جزئیات یک درخواست، با زنجیره‌ی رویدادهای اصلاحی‌اش */
  cardTransferGet: 'cardTransfer:get',
  /** بند ۱ — ثبت «پرداخت شد» توسط مدیر */
  cardTransferPay: 'cardTransfer:pay',
  /** بند ۱ — رویداد اصلاحی جدید (ویرایش/حذف ممکن نیست) */
  cardTransferAdjust: 'cardTransfer:adjust',
  /** بند ۱ — بلوک «جریان‌های مالی خارج از فروش» */
  cardTransferOutOfSales: 'cardTransfer:outOfSales',
  /**
   * جلسه ۴۱ · کار ب — «رد/لغو» یک درخواست کارت‌به‌کارت، با دلیل اجباری و یک
   * تصمیم صریح درباره‌ی تکلیف کالای معلق (`releaseStock`).
   * ⚠️ نویسنده است و موجودی انبار را عوض می‌کند ⇒ `managerPassword` می‌خواهد
   * (گیت سمت سرور `assertPanelPassword(PANEL_KEYS.cardTransfers, …)`).
   */
  cardTransferCancel: 'cardTransfer:cancel',

  /**
   * -----------------------------------------------------------------------
   * جلسه ۴۱ · کار ب — «کالای برگشتیِ در انتظار تأیید مدیر».
   *
   * تنها کانالِ خواندنِ این عدد. هر پنج صفحه (انبار فروشگاه، گزارشات فروش،
   * انبارگردانی، بستن صندوق، پنل کارت‌به‌کارت) از همین یک کانال می‌خوانند تا
   * هیچ‌وقت دو عدد متفاوت ساخته نشود.
   *
   * ⚠️ **فقط خواندنی.** هیچ صفحه‌ای از این مسیر نمی‌تواند کالا را به موجودی
   * قابل‌فروش برگرداند؛ آن کار فقط با `cardTransfer:pay` / `cardTransfer:cancel`
   * و پشت قفل `PANEL_KEYS.cardTransfers` انجام می‌شود.
   * -----------------------------------------------------------------------
   */
  pendingRestockSummary: 'pendingRestock:summary',

  /** بند ۴-الف — کالاهای آماده برای فرم شمارش فیزیکی (با موجودی سیستمی لحظه) */
  stockCountVariants: 'stockCount:variants',
  /** بند ۴-الف — ثبت یک جلسه‌ی شمارش فیزیکی */
  stockCountSubmit: 'stockCount:submit',
  /** بند ۴-الف — فهرست جلسه‌های شمارش */
  stockCountList: 'stockCount:list',
  /** بند ۴-الف — جزئیات یک جلسه‌ی شمارش */
  stockCountGet: 'stockCount:get',
  /** بند ۴-ب — گزارش «مغایرت نیازمند بررسی» */
  stockCountDiscrepancy: 'stockCount:discrepancy',

  /** بند ۵ — خواندن/نوشتن تنظیمات یادآوری انبارگردانی + وضعیت «امروز موعد است؟» */
  stocktakeScheduleGet: 'stocktake:schedule:get',
  stocktakeScheduleSet: 'stocktake:schedule:set',
  stocktakeDue: 'stocktake:due',
  stocktakeDismiss: 'stocktake:dismiss',

  /** یادآوری نسیه/چک سررسیدشده (هشدار قرمز بالای صفحه، قابل بستن) */
  debtReminderDue: 'debtReminder:due',
  debtReminderDismiss: 'debtReminder:dismiss',

  /** بند ۲ — فهرست کارمندان برای فیلتر «انتخاب کارمند (یا همه‌ی کارمندان)» */
  staffList: 'staff:list',
  /** بند ۲ — تب «عملکرد کارمندان» */
  staffPerformance: 'staff:performance:rows',
  /** بند ۲ — ریز تراکنش‌های یک کارمند */
  staffTransactions: 'staff:performance:transactions',
  /** بند ۳ — فاکتورهای با تخفیف بالاتر از آستانه */
  staffAbnormalDiscounts: 'staff:abnormalDiscounts',
  /** بند ۶ — تراکنش‌های خارج از بازه‌ی شیفت رسمی */
  staffOutOfShift: 'staff:outOfShift',

  // =========================================================================
  // «کارمندان فروشگاه» — ثبت/ویرایش/غیرفعال‌سازی (دست‌نخورده از جلسه ۱۸)
  //
  // `staff:list` بالا فقط یک فهرست خواندنیِ گزارشی است. این دو کانال خودِ
  // `StaffService` را به برنامه وصل می‌کنند.
  //
  // ⚠️ جلسه ۱۹ — کانال‌های «کارمند فعالِ پشت سیستم» (`staff:active` و
  // `staff:active:set`) حذف شدند: منبع «چه کسی پشت صندوق است» دیگر یک تنظیمِ
  // سراسری نیست، بلکه **کارمند همان نشست** است (بند ۳). ثبت/ویرایش/غیرفعال‌سازی
  // کارمندان دقیقاً مثل قبل سر جای خودش است.
  //
  // ⚠️ این یک سیستم ورود/احراز هویت نیست و هیچ قفل تجاری تازه‌ای نمی‌سازد.
  // =========================================================================
  /** فهرست کامل کارمندان + نقش‌های مجاز */
  staffDirectory: 'staff:directory',
  /** ثبت کارمند تازه یا ویرایش نام/نقش/فعال‌بودن یکی از قبلی‌ها */
  staffSave: 'staff:save',

  /**
   * گزارش مدیریت (ماژول جدا از گزارشات فروش). همه فقط‌خواندنی‌اند.
   * اعداد فروش از همان `sale:report:rows` می‌آیند؛ این کانال‌ها فرمول موازی نمی‌سازند.
   */
  mgmtTrend: 'mgmt:trend',
  mgmtCompare: 'mgmt:compare',
  mgmtStaff: 'mgmt:staff',
  mgmtStaffOptions: 'mgmt:staffOptions',
  mgmtSnapshot: 'mgmt:snapshot',
  mgmtCategory: 'mgmt:category',
  mgmtHeatmap: 'mgmt:heatmap',
  mgmtStock: 'mgmt:stock',
  mgmtAbc: 'mgmt:abc',
  mgmtSizeCurve: 'mgmt:sizeCurve',
  mgmtPurchaseVsSale: 'mgmt:purchaseVsSale',
  mgmtProfit: 'mgmt:profit',
  mgmtCostEngineStatus: 'mgmt:costEngine:status',
  mgmtCostEngineRun: 'mgmt:costEngine:run',
  mgmtCostEngineRebuild: 'mgmt:costEngine:rebuild',
  mgmtTargetGet: 'mgmt:target:get',
  mgmtTargetSet: 'mgmt:target:set',

  /**
   * پنل پیامکی — ماژول کاملاً مستقل.
   *
   * هیچ‌کدام از این کانال‌ها نه فروش را می‌خوانند و نه چیزی در فروش/برگشت/
   * اعتبار/گزارش‌ها می‌نویسند. تنها ارتباط، `sms:sendManual` است که کاربر
   * خودش صدا می‌زند.
   */
  smsDashboard: 'sms:dashboard',
  smsList: 'sms:list',
  smsDetail: 'sms:detail',
  /** ارسال دستیِ یک پیام (با زمان‌بندی اختیاری) */
  smsSendManual: 'sms:sendManual',
  /** برآورد تعداد بخش و هزینه، قبل از تأیید کاربر */
  smsEstimate: 'sms:estimate',
  /** «الان بفرست» — یک دور کامل صف، همین حالا */
  smsRunNow: 'sms:runNow',
  /** لغو یک پیام ارسال‌نشده (لغو ≠ حذف) */
  smsCancel: 'sms:cancel',
  /** لغو گروهی — قفل `smsDanger` */
  smsCancelBulk: 'sms:cancelBulk',
  /** برگرداندن یک پیام لغوشده/ناموفق‌قطعی به صف */
  smsRequeue: 'sms:requeue',
  /** تلاش مجدد دستی روی یک پیام ناموفق */
  smsRetryNow: 'sms:retryNow',
  smsSettingsGet: 'sms:settings:get',
  smsSettingsSet: 'sms:settings:set',
  smsTemplates: 'sms:templates',
  smsTemplateSave: 'sms:template:save',
  smsTemplateReset: 'sms:template:reset',
  smsProviders: 'sms:providers',
  smsProviderSave: 'sms:provider:save',
  smsProviderActivate: 'sms:provider:activate',
  smsProviderTest: 'sms:provider:test',

  // -------------------------------------------------------------------------
  // فاز ۴ — پیامک انبوه تبلیغاتی و دفتر «لغو ۱۱» (`panel: smsPanel`).
  // -------------------------------------------------------------------------
  /** دفترچه‌ی شماره‌های برنامه (چند نفر در دسترس‌اند) */
  smsCampaignBank: 'sms:campaign:bank',
  /** پیش‌نمایش: تعداد قابل ارسال، بخش‌ها، برآورد هزینه */
  smsCampaignPreview: 'sms:campaign:preview',
  /** ثبت کمپین (صف‌کردن، نه ارسال فوری) */
  smsCampaignCreate: 'sms:campaign:create',
  smsCampaignList: 'sms:campaign:list',
  smsCampaignDetail: 'sms:campaign:detail',
  /** لغو گروهی کمپین — قفل `smsDanger` */
  smsCampaignCancel: 'sms:campaign:cancel',
  /** دفتر انصراف‌ها («لغو ۱۱») */
  smsOptOutList: 'sms:optOut:list',
  smsOptOutAdd: 'sms:optOut:add',
  smsOptOutRemove: 'sms:optOut:remove'
} as const
