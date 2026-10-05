-- -----------------------------------------------------------------------------
-- جلسه ۴۰ · کار ب — «کالای در انتظار تأیید مدیر» (برگشت/تعویض با پرداخت مدیر).
--
-- مسئله‌ای که این migration پایه‌اش را می‌گذارد: تا امروز کالای برگشتی همان
-- لحظه‌ی ثبتِ فروشنده با `inventoryService.increase` به موجودی قابل‌فروش
-- اضافه می‌شد، حتی وقتی بازپرداختش «کارت‌به‌کارت توسط مدیر» بود و مدیر هنوز
-- یک ریال هم نپرداخته بود. یعنی فروشگاه کالا را داشت، پول را نداده بود، و
-- کالا به‌عنوان «قابل فروش» در گزارش می‌نشست.
--
-- از این نسخه: کالای برگشتیِ «کارت‌به‌کارت مدیر» معلق می‌ماند (`restockPending`)
-- و تنها با زدن «پرداخت شد» در پنل قفل‌دارِ مدیر به موجودی قابل‌فروش برمی‌گردد.
--
-- ⚠️ قاعده‌ی همیشگی پروژه رعایت شده است: فقط ستون *جدید* اضافه می‌شود، هر کدام
-- با DEFAULT یا Nullable. هیچ ستونی حذف نمی‌شود، هیچ نوعی عوض نمی‌شود، و
-- **هیچ UPDATE ی روی ردیف‌های موجود نیست**. پس:
--   • همه‌ی برگشت‌های قبلی `restockPending = 0` می‌مانند ⇒ کالایشان از قبل در
--     انبار است و دوباره اضافه نمی‌شود (خطر واقعی همین بود).
--   • درخواست‌های کارت‌به‌کارتِ PENDING قدیمی هیچ کالای معلقی نمی‌سازند.
--   • شمارش‌های فیزیکی قبلی `pendingRestockQty = 0` می‌گیرند ⇒ عدد مغایرتشان
--     مو‌به‌مو همان عدد قبلی است.
-- -----------------------------------------------------------------------------

-- ۱) سند برگشت: معلق بودن کالا + لحظه‌ی آزادسازی
ALTER TABLE "SaleReturn" ADD COLUMN "restockPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleReturn" ADD COLUMN "restockReleasedAt" DATETIME;
ALTER TABLE "SaleReturn" ADD COLUMN "restockReleasedAtJalali" TEXT;

-- کوئری «معلق‌های برگشتی» (انبار، گزارش فروش، انبارگردانی، بستن صندوق) فقط
-- همین ستون را فیلتر می‌کند، پس ایندکسش لازم است.
CREATE INDEX IF NOT EXISTS "SaleReturn_restockPending_idx" ON "SaleReturn"("restockPending");

-- ۲) درخواست کارت‌به‌کارت: مسیر رد/لغو و ردِ آزادسازی انبار
ALTER TABLE "CardTransferRequest" ADD COLUMN "canceledAt" DATETIME;
ALTER TABLE "CardTransferRequest" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "CardTransferRequest" ADD COLUMN "stockReleasedAt" DATETIME;
ALTER TABLE "CardTransferRequest" ADD COLUMN "stockReleasedQty" INTEGER;

-- ۳) شمارش فیزیکی انبار: snapshot «معلق برگشتی» در لحظه‌ی شمارش
ALTER TABLE "StockCountItem" ADD COLUMN "pendingRestockQty" INTEGER NOT NULL DEFAULT 0;
