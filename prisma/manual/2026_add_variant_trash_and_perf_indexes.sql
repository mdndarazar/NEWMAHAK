-- ---------------------------------------------------------------------------
-- ۱) «سطل آشغال» کالاها: تاریخ حذف نرم روی واریانت
--    (حذف کالا از قبل soft-delete بود: isActive = false. حالا لحظه‌ی حذف هم
--     ثبت می‌شود تا در سطل آشغال قابل نمایش و مرتب‌سازی باشد.)
-- ۲) ایندکس‌های سبک‌سازی: گزارش‌گیری و پاک‌سازی روی جدول‌های پرترافیک
--    (SaleInvoice, SaleInvoiceItem, StockMovement, AuditLog, ...) حتی با
--     میلیون‌ها ردیف بدون اسکن کامل جدول انجام شود.
-- ---------------------------------------------------------------------------
ALTER TABLE "ProductVariant" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX IF NOT EXISTS "ProductVariant_isActive_idx" ON "ProductVariant"("isActive");
CREATE INDEX IF NOT EXISTS "ProductVariant_deletedAt_idx" ON "ProductVariant"("deletedAt");
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId");

CREATE INDEX IF NOT EXISTS "SaleInvoice_issuedAt_idx" ON "SaleInvoice"("issuedAt");
CREATE INDEX IF NOT EXISTS "SaleInvoice_issuedAtJalali_orderType_idx" ON "SaleInvoice"("issuedAtJalali", "orderType");
CREATE INDEX IF NOT EXISTS "SaleInvoice_customerId_idx" ON "SaleInvoice"("customerId");

CREATE INDEX IF NOT EXISTS "SaleInvoiceItem_variantId_idx" ON "SaleInvoiceItem"("variantId");

CREATE INDEX IF NOT EXISTS "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

CREATE INDEX IF NOT EXISTS "Payment_methodId_idx" ON "Payment"("methodId");

CREATE INDEX IF NOT EXISTS "SaleReturn_returnedAt_idx" ON "SaleReturn"("returnedAt");

CREATE INDEX IF NOT EXISTS "PurchaseInvoice_issuedAt_idx" ON "PurchaseInvoice"("issuedAt");
