-- -----------------------------------------------------------------------------
-- جلسه ۴۷ — «از کدام انبار کسر شود؟» برای فاکتور فروش عمده.
--
-- مسئله: تا امروز مبدأ کسر موجودی یک فاکتور هیچ‌جا ثبت نمی‌شد. اگر کالایی از
-- انبار مرکزی برداشته می‌شد (تیک «برداشت خودکار»)، فقط یک سطر در
-- `SecondaryStockLog` می‌ماند و رابطه‌اش با قلمِ فاکتور از بین می‌رفت. پس ویرایش
-- و حذف و برگشتِ همان فاکتور نمی‌توانست کالا را به همان انبار برگرداند.
--
-- از این نسخه یک «دفتر مبدأ کسر» داریم: برای هر قلم فاکتور، فهرست صریحِ
-- {منبع، انبار، تعداد، منفی‌شده؟}. ویرایش، حذف و برگشت *دقیقاً* از همین جدول
-- برمی‌گردند.
--
-- ⚠️ قاعده‌ی همیشگی پروژه رعایت شده است: این migration **فقط یک جدول تازه و
-- ایندکس‌هایش** را می‌سازد. هیچ ستونی به جدول‌های موجود اضافه/حذف/تغییر نمی‌شود،
-- هیچ `UPDATE`/`DELETE`/`DROP`/`RENAME` ی ندارد. پس:
--   • فاکتورهای قبلی هیچ ردیفی در این جدول ندارند ⇒ «نبودِ ردیف» دقیقاً همان
--     معنای «همه از انبار فروشگاه» را دارد و هیچ عددی عوض نمی‌شود.
--   • مسیر تیکِ «برداشت خودکار از انبار مرکزی» هم دست‌نخورده است.
--
-- ⚠️ عمداً هیچ FOREIGN KEY ای روی `invoiceId` / `saleItemId` / `variantId` /
-- `warehouseId` گذاشته نشده — دقیقاً به همان دلیل `SecondaryStockLog`: این جدول
-- یک «دفتر سابقه» است و حذف همیشگیِ کالا یا انبار نباید سابقه را پاک کند.
-- نامِ انبار هم به‌صورت snapshot نگه داشته می‌شود تا تغییر نام انبار، سابقه را
-- نخواند-نکند.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SaleItemStockAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    -- STORE = انبار فروشگاه (ProductVariant.stock) · WAREHOUSE = انبار ماژول انبار مرکزی
    "sourceKind" TEXT NOT NULL,
    -- NULL = انبار پیش‌فرض ماژول انبار مرکزی («انبار مرکزی»)، یا منبعِ فروشگاه
    "warehouseId" INTEGER,
    "warehouseName" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL DEFAULT 0,
    -- موجودی همان منبع بعد از کسر (snapshot) — برای «خلاصه‌ی کسری‌ها»
    "balanceAfter" INTEGER,
    "wentNegative" BOOLEAN NOT NULL DEFAULT false,
    -- ردیف‌های واقعیِ SecondaryStockItem که از آن‌ها کم شد (JSON snapshot)
    "rowDetails" TEXT,
    -- چه مقدار از همین برداشت دوباره برگشته است (برگشت از فروش / ویرایش / حذف)
    "restoredQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SaleItemStockAllocation_invoiceId_idx" ON "SaleItemStockAllocation"("invoiceId");
CREATE INDEX IF NOT EXISTS "SaleItemStockAllocation_saleItemId_idx" ON "SaleItemStockAllocation"("saleItemId");
CREATE INDEX IF NOT EXISTS "SaleItemStockAllocation_variantId_idx" ON "SaleItemStockAllocation"("variantId");
CREATE INDEX IF NOT EXISTS "SaleItemStockAllocation_warehouseId_idx" ON "SaleItemStockAllocation"("warehouseId");
