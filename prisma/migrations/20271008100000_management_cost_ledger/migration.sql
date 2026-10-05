-- گزارش مدیریت: دفتر هزینه (لات خرید + قفل فی فروش).
-- فقط CREATE TABLE / INDEX. هیچ ALTER روی جدول موجود نیست.
-- بدون FOREIGN KEY تا حذف کالا یا ادغام بکاپ سابقه را نشکند.

CREATE TABLE IF NOT EXISTS "PurchaseLot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseInvoiceId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "qtyIn" INTEGER NOT NULL DEFAULT 0,
    "qtyLeft" INTEGER NOT NULL DEFAULT 0,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "lotDate" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PURCHASE',
    "approx" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PurchaseLot_variantId_lotDate_id_idx" ON "PurchaseLot"("variantId", "lotDate", "id");
CREATE INDEX IF NOT EXISTS "PurchaseLot_purchaseInvoiceId_idx" ON "PurchaseLot"("purchaseInvoiceId");

CREATE TABLE IF NOT EXISTS "SaleItemCost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saleItemId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "fifoCost" BIGINT NOT NULL DEFAULT 0,
    "replacementCost" BIGINT NOT NULL DEFAULT 0,
    "revenue" BIGINT NOT NULL DEFAULT 0,
    "costStatus" TEXT NOT NULL DEFAULT 'EXACT',
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SaleItemCost_saleItemId_key" ON "SaleItemCost"("saleItemId");
CREATE INDEX IF NOT EXISTS "SaleItemCost_invoiceId_idx" ON "SaleItemCost"("invoiceId");
CREATE INDEX IF NOT EXISTS "SaleItemCost_variantId_idx" ON "SaleItemCost"("variantId");

CREATE TABLE IF NOT EXISTS "CostConsumption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "movementId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "saleItemId" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CostConsumption_movementId_idx" ON "CostConsumption"("movementId");
CREATE INDEX IF NOT EXISTS "CostConsumption_lotId_idx" ON "CostConsumption"("lotId");
CREATE INDEX IF NOT EXISTS "CostConsumption_saleItemId_idx" ON "CostConsumption"("saleItemId");

CREATE TABLE IF NOT EXISTS "CostEngineState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "lastMovementId" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" DATETIME,
    "openingMode" TEXT NOT NULL DEFAULT 'fromActivation'
);
