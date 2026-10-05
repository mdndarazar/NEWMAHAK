-- ---------------------------------------------------------------------------
-- «حذف همیشگی کالا» (مورد ۸) — برداشتن کلید خارجی ProductVariant از
-- جدول‌های سابقه.
--
-- ⚠️ لازم نیست این فایل را دستی اجرا کنید: خودِ برنامه اولین باری که دکمه‌ی
-- «حذف همیشگی» را بزنید همین کار را داخل یک تراکنش انجام می‌دهد
-- (src/main/services/VariantPurgeService.ts → dropVariantForeignKeys) و
-- ساختار را از خود دیتابیس می‌خواند، پس با هر نسخه‌ای از دیتابیس سازگار است.
-- این فایل فقط برای شفافیت و برای حالتی است که بخواهید از قبل و دستی
-- (مثلاً در DB Browser for SQLite) انجامش دهید.
--
-- چرا لازم است؟ سه جدول سابقه به کالا کلید خارجی دارند و ردیف‌هایشان باید
-- بمانند، پس تا وقتی این کلیدها باشند SQLite اجازه‌ی حذف رکورد کالا را
-- نمی‌دهد. نام و کد کالا قبل از حذف داخل همان ردیف‌ها (variantName /
-- variantCode) نوشته می‌شود، پس فاکتور قدیمی هم خوانا می‌ماند.
--
-- ترتیب جمله‌ها عمداً طوری است که با فعال بودن PRAGMA foreign_keys هم هیچ
-- نقض کلید خارجی رخ نمی‌دهد؛ همه را داخل یک تراکنش اجرا کنید.
-- (این ترتیب روی یک دیتابیس واقعی SQLite با داده‌ی نمونه تست شده است:
--  داده‌ها دست‌نخورده ماندند و PRAGMA foreign_key_check پاک بود.)
--
-- کلیدهای دیگر (ردیف→فاکتور، ردیف برگشت→ردیف فاکتور، ردیف خرید→فاکتور خرید)
-- عیناً حفظ می‌شوند؛ فقط ارجاع به ProductVariant برداشته می‌شود.
-- ---------------------------------------------------------------------------
BEGIN;

-- ۱) فاکتور خرید (مستقل)
CREATE TABLE "PurchaseInvoiceItem__new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "variantName" TEXT,
    "variantCode" TEXT,
    CONSTRAINT "PurchaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "PurchaseInvoiceItem__new" ("id","invoiceId","variantId","warehouseId","qty","unitPrice","lineTotal","variantName","variantCode")
  SELECT "id","invoiceId","variantId","warehouseId","qty","unitPrice","lineTotal","variantName","variantCode" FROM "PurchaseInvoiceItem";
DROP TABLE "PurchaseInvoiceItem";
ALTER TABLE "PurchaseInvoiceItem__new" RENAME TO "PurchaseInvoiceItem";
CREATE INDEX IF NOT EXISTS "PurchaseInvoiceItem_invoiceId_idx" ON "PurchaseInvoiceItem"("invoiceId");

-- ۲) ردیف فاکتور فروش + ردیف برگشت (زوجی، با ترتیب امن)
CREATE TABLE "SaleInvoiceItem__new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "lineTotal" INTEGER NOT NULL,
    "variantName" TEXT,
    "variantCode" TEXT,
    CONSTRAINT "SaleInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "SaleInvoiceItem__new" ("id","invoiceId","variantId","qty","unitPrice","discount","tax","lineTotal","variantName","variantCode")
  SELECT "id","invoiceId","variantId","qty","unitPrice","discount","tax","lineTotal","variantName","variantCode" FROM "SaleInvoiceItem";

CREATE TABLE "SaleReturnItem__new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnId" INTEGER NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "removedFromStock" BOOLEAN NOT NULL DEFAULT false,
    "restockedQty" INTEGER NOT NULL DEFAULT 0,
    "variantName" TEXT,
    "variantCode" TEXT,
    CONSTRAINT "SaleReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleInvoiceItem__new" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "SaleReturnItem__new" ("id","returnId","saleItemId","variantId","qty","unitPrice","lineTotal","removedFromStock","restockedQty","variantName","variantCode")
  SELECT "id","returnId","saleItemId","variantId","qty","unitPrice","lineTotal","removedFromStock","restockedQty","variantName","variantCode" FROM "SaleReturnItem";

DROP TABLE "SaleReturnItem";
DROP TABLE "SaleInvoiceItem";
-- با تغییر نام، خود SQLite ارجاع FK جدول برگشت را هم به نام نهایی اصلاح می‌کند
ALTER TABLE "SaleInvoiceItem__new" RENAME TO "SaleInvoiceItem";
ALTER TABLE "SaleReturnItem__new" RENAME TO "SaleReturnItem";

CREATE INDEX IF NOT EXISTS "SaleInvoiceItem_invoiceId_idx" ON "SaleInvoiceItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "SaleInvoiceItem_variantId_idx" ON "SaleInvoiceItem"("variantId");
CREATE INDEX IF NOT EXISTS "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");
CREATE INDEX IF NOT EXISTS "SaleReturnItem_variantId_idx" ON "SaleReturnItem"("variantId");

COMMIT;
-- کنترل نهایی (باید خروجی خالی بدهد):
-- PRAGMA foreign_key_check;
