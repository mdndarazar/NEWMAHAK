-- ---------------------------------------------------------------------------
-- چهار قابلیت این نسخه، همه با ستون/جدولِ «بی‌خطر روی دیتابیس پر»:
--
-- ۱) قفل موقت بعد از ورود رمز اشتباه  → جدول جدید AuthLockout
-- ۲) انبار مرکزی چند‌انباره + تاریخچه → جدول‌های SecondaryWarehouse و
--    SecondaryStockLog + دو ستون روی SecondaryStockItem (warehouseId, minQty)
-- ۳) تعویض کالا                        → ستون‌های تعویض روی SaleReturn و دو کلید
--    ردیابی روی SaleInvoice
-- ۴) بارکد اعتبار خرید بعدی            → جدول جدید StoreCredit
--    (+ ستون overpayAmount روی Payment برای «مبلغ اضافه‌ی دریافتی» — بخش ۸)
--
-- همه‌ی ستون‌های افزوده‌شده nullable یا با DEFAULT اند و همه‌ی جدول‌ها جدیدند، پس
-- روی دیتابیس فعلی بدون هیچ ریسکی اجرا می‌شوند و رفتار فعلی برنامه مو‌به‌مو حفظ
-- می‌گردد:
--   • SaleReturn.kind پیش‌فرض 'RETURN' ⇒ همه‌ی برگشت‌های قبلی «برگشت ساده» می‌مانند.
--   • SecondaryStockItem.warehouseId پیش‌فرض NULL ⇒ همه‌ی ردیف‌های قبلی به
--     «انبار مرکزی» (انبار پیش‌فرض) تعلق دارند و منطق فعلی ماژول عوض نمی‌شود.
--   • Payment.overpayAmount پیش‌فرض ۰ ⇒ هیچ پرداختی قدیمی‌ای تغییر نمی‌کند.
-- ---------------------------------------------------------------------------

-- ======================= ۱) قفل موقت رمز =======================
CREATE TABLE "AuthLockout" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "gate" TEXT NOT NULL,
  "failCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailAt" DATETIME,
  "lockedUntil" DATETIME,
  "lockCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "AuthLockout_gate_key" ON "AuthLockout"("gate");
CREATE INDEX IF NOT EXISTS "AuthLockout_lockedUntil_idx" ON "AuthLockout"("lockedUntil");

-- ================ ۲) انبار مرکزی: چند انبار + تاریخچه ================
CREATE TABLE "SecondaryWarehouse" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "location" TEXT,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SecondaryWarehouse_name_key" ON "SecondaryWarehouse"("name");
CREATE INDEX IF NOT EXISTS "SecondaryWarehouse_isActive_idx" ON "SecondaryWarehouse"("isActive");
CREATE INDEX IF NOT EXISTS "SecondaryWarehouse_sortOrder_idx" ON "SecondaryWarehouse"("sortOrder");

-- انبار پیش‌فرض: همان «انبار مرکزی» فعلی. ردیف‌های موجود (warehouseId = NULL) به
-- همین انبار نسبت داده می‌شوند و لازم نیست هیچ داده‌ای جابه‌جا شود.
INSERT INTO "SecondaryWarehouse" ("name", "isDefault", "note", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT 'انبار مرکزی', true, 'انبار پیش‌فرض ماژول انبار مرکزی (قابل حذف نیست)', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "SecondaryWarehouse" WHERE "isDefault" = true);

CREATE TABLE "SecondaryStockLog" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "itemId" INTEGER,
  "warehouseId" INTEGER,
  "warehouseName" TEXT,
  "action" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "qtyBefore" INTEGER NOT NULL DEFAULT 0,
  "qtyAfter" INTEGER NOT NULL DEFAULT 0,
  "delta" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "userId" INTEGER,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atJalali" TEXT NOT NULL DEFAULT '',
  "atTime" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "SecondaryStockLog_itemId_idx" ON "SecondaryStockLog"("itemId");
CREATE INDEX IF NOT EXISTS "SecondaryStockLog_warehouseId_idx" ON "SecondaryStockLog"("warehouseId");
CREATE INDEX IF NOT EXISTS "SecondaryStockLog_at_idx" ON "SecondaryStockLog"("at");
CREATE INDEX IF NOT EXISTS "SecondaryStockLog_action_idx" ON "SecondaryStockLog"("action");

-- AlterTable
ALTER TABLE "SecondaryStockItem" ADD COLUMN "warehouseId" INTEGER;
ALTER TABLE "SecondaryStockItem" ADD COLUMN "minQty" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "SecondaryStockItem_warehouseId_idx" ON "SecondaryStockItem"("warehouseId");

-- ===================== ۳) تعویض کالا =====================
-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN "returnedAtTime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaleReturn" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'RETURN';
ALTER TABLE "SaleReturn" ADD COLUMN "exchangeInvoiceId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "exchangeReceiptNo" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "exchangeTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleReturn" ADD COLUMN "exchangeDiff" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleReturn" ADD COLUMN "exchangeSettlement" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "storeCreditId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "storeCreditCode" TEXT;
CREATE INDEX IF NOT EXISTS "SaleReturn_kind_idx" ON "SaleReturn"("kind");
CREATE INDEX IF NOT EXISTS "SaleReturn_exchangeInvoiceId_idx" ON "SaleReturn"("exchangeInvoiceId");

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN "exchangeReturnId" INTEGER;
ALTER TABLE "SaleInvoice" ADD COLUMN "sourceInvoiceId" INTEGER;
CREATE INDEX IF NOT EXISTS "SaleInvoice_exchangeReturnId_idx" ON "SaleInvoice"("exchangeReturnId");
CREATE INDEX IF NOT EXISTS "SaleInvoice_sourceInvoiceId_idx" ON "SaleInvoice"("sourceInvoiceId");

-- =============== ۴) بارکد اعتبار خرید بعدی + مبلغ اضافه‌ی دریافتی ===============
CREATE TABLE "StoreCredit" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "code" TEXT NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedAtJalali" TEXT NOT NULL DEFAULT '',
  "issuedAtTime" TEXT NOT NULL DEFAULT '',
  "expiresAt" DATETIME,
  "expiresAtJalali" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "returnId" INTEGER,
  "exchangeInvoiceId" INTEGER,
  "sourceInvoiceId" INTEGER,
  "customerId" INTEGER,
  "customerName" TEXT,
  "usedAt" DATETIME,
  "usedAtJalali" TEXT,
  "usedAtTime" TEXT,
  "usedInvoiceId" INTEGER,
  "usedReceiptNo" INTEGER,
  "usedPaymentId" INTEGER,
  "remainderCreditId" INTEGER,
  "note" TEXT,
  "userId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StoreCredit_code_idx" ON "StoreCredit"("code");
CREATE INDEX IF NOT EXISTS "StoreCredit_status_idx" ON "StoreCredit"("status");
CREATE INDEX IF NOT EXISTS "StoreCredit_issuedAt_idx" ON "StoreCredit"("issuedAt");
CREATE INDEX IF NOT EXISTS "StoreCredit_usedInvoiceId_idx" ON "StoreCredit"("usedInvoiceId");
CREATE INDEX IF NOT EXISTS "StoreCredit_returnId_idx" ON "StoreCredit"("returnId");

-- AlterTable (بخش ۸ — مبلغ اضافه‌ی دریافتی روی همان رکورد پرداختی)
ALTER TABLE "Payment" ADD COLUMN "overpayAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "storeCreditId" INTEGER;
