-- ---------------------------------------------------------------------------
-- نسخه‌ی دستی (fallback) همان migration مرحله‌ی شیفت/کد فاکتور/تجمیع روزانه.
-- برنامه این تغییرات را خودش هنگام اجرا اعمال می‌کند (src/main/db/migrator.ts)
-- و اجرای دوباره‌ی این فایل هم بی‌خطر است: خطای «duplicate column name»
-- به‌عنوان «از قبل اعمال شده» نادیده گرفته می‌شود.
--
-- اجرا با ابزار خط فرمان SQLite روی فایل دیتابیس:
--   sqlite3 "%APPDATA%\MahakPOS\data\shop.db" < 2026_add_shift_returncode_consolidation.sql
-- ---------------------------------------------------------------------------

ALTER TABLE "SaleInvoice" ADD COLUMN "returnCode" TEXT;
ALTER TABLE "SaleInvoice" ADD COLUMN "returnCodeExpiresAt" DATETIME;
ALTER TABLE "SaleInvoice" ADD COLUMN "tableNo" TEXT;

ALTER TABLE "Shift" ADD COLUMN "number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Shift" ADD COLUMN "dayJalali" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Shift" ADD COLUMN "note" TEXT;

ALTER TABLE "CashSession" ADD COLUMN "dayJalali" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CashSession" ADD COLUMN "otherTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "grandTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "invoiceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "countedTotal" INTEGER;

ALTER TABLE "Consolidation" ADD COLUMN "dayJalali" TEXT;
ALTER TABLE "Consolidation" ADD COLUMN "invoiceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Consolidation" ADD COLUMN "movementCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SaleReturn" ADD COLUMN "userId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "shiftId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "hasRemovedItems" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SaleReturnItem" ADD COLUMN "removedFromStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleReturnItem" ADD COLUMN "restockedQty" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "SaleInvoice_returnCode_idx" ON "SaleInvoice"("returnCode");
CREATE INDEX IF NOT EXISTS "SaleInvoice_shiftId_idx" ON "SaleInvoice"("shiftId");
CREATE INDEX IF NOT EXISTS "Shift_dayJalali_idx" ON "Shift"("dayJalali");
CREATE INDEX IF NOT EXISTS "Shift_closedAt_idx" ON "Shift"("closedAt");
CREATE INDEX IF NOT EXISTS "CashSession_dayJalali_idx" ON "CashSession"("dayJalali");
CREATE INDEX IF NOT EXISTS "CashSession_shiftId_idx" ON "CashSession"("shiftId");
CREATE INDEX IF NOT EXISTS "Consolidation_dayJalali_idx" ON "Consolidation"("dayJalali");
CREATE INDEX IF NOT EXISTS "SaleReturn_returnedAtJalali_idx" ON "SaleReturn"("returnedAtJalali");
CREATE INDEX IF NOT EXISTS "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");
CREATE INDEX IF NOT EXISTS "SaleReturnItem_variantId_idx" ON "SaleReturnItem"("variantId");
