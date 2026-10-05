-- ---------------------------------------------------------------------------
-- ۱) «انبار جانبی» (مورد ۵): یک جدول کاملاً مستقل و اطلاعاتی.
--    هیچ کلید خارجی و هیچ ارتباطی با Product / ProductVariant ندارد و هیچ‌جای
--    برنامه از آن کسر یا به آن اضافه نمی‌کند. عمداً همین‌قدر ساده است.
--
-- ۲) snapshot نام و کد کالا روی ردیف‌های سابقه (لازمِ «حذف همیشگی» — مورد ۸):
--    وقتی یک کالا برای همیشه از دیتابیس پاک می‌شود، ردیف فاکتورهای گذشته‌اش
--    باید دست‌نخورده و *خوانا* بماند. پس قبل از حذف، نام و کد کالا داخل خود
--    ردیف فاکتور نوشته می‌شود و گزارش‌ها از همان می‌خوانند.
--    (هر دو ستون nullable و بدون پیش‌فرض‌اند، پس این migration روی دیتابیس
--     موجود هیچ داده‌ای را لمس نمی‌کند و برگشت‌پذیر است.)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE IF NOT EXISTS "SecondaryStockItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "SecondaryStockItem_name_idx" ON "SecondaryStockItem"("name");
CREATE INDEX IF NOT EXISTS "SecondaryStockItem_code_idx" ON "SecondaryStockItem"("code");

-- AlterTable (snapshot نام/کد کالا روی ردیف‌های سابقه)
ALTER TABLE "SaleInvoiceItem" ADD COLUMN "variantName" TEXT;
ALTER TABLE "SaleInvoiceItem" ADD COLUMN "variantCode" TEXT;

ALTER TABLE "SaleReturnItem" ADD COLUMN "variantName" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN "variantCode" TEXT;

ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "variantName" TEXT;
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "variantCode" TEXT;
