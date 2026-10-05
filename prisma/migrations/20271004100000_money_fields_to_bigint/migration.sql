-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CardTransferRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL DEFAULT 'REQUEST',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "operationKind" TEXT NOT NULL DEFAULT 'RETURN',
    "returnId" INTEGER NOT NULL,
    "sourceInvoiceId" INTEGER,
    "sourceReceiptNo" INTEGER,
    "exchangeInvoiceId" INTEGER,
    "exchangeReceiptNo" INTEGER,
    "invoiceTotal" BIGINT NOT NULL DEFAULT 0,
    "returnTotal" BIGINT NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "itemsJson" TEXT,
    "stockNote" TEXT,
    "userId" INTEGER,
    "userName" TEXT,
    "shiftId" INTEGER,
    "shiftName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAtJalali" TEXT NOT NULL DEFAULT '',
    "createdAtTime" TEXT NOT NULL DEFAULT '',
    "paidAmount" BIGINT,
    "paidAt" DATETIME,
    "paidAtJalali" TEXT,
    "paidAtTime" TEXT,
    "paidMethod" TEXT,
    "trackingNo" TEXT,
    "paidByUserId" INTEGER,
    "paidByUserName" TEXT,
    "paidShiftId" INTEGER,
    "paidShiftName" TEXT,
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "stockReleasedAt" DATETIME,
    "stockReleasedQty" INTEGER,
    "adjustsRequestId" INTEGER,
    "adjustReason" TEXT,
    "note" TEXT
);
INSERT INTO "new_CardTransferRequest" ("adjustReason", "adjustsRequestId", "amount", "cancelReason", "canceledAt", "createdAt", "createdAtJalali", "createdAtTime", "exchangeInvoiceId", "exchangeReceiptNo", "id", "invoiceTotal", "itemsJson", "kind", "note", "operationKind", "paidAmount", "paidAt", "paidAtJalali", "paidAtTime", "paidByUserId", "paidByUserName", "paidMethod", "paidShiftId", "paidShiftName", "returnId", "returnTotal", "shiftId", "shiftName", "sourceInvoiceId", "sourceReceiptNo", "status", "stockNote", "stockReleasedAt", "stockReleasedQty", "trackingNo", "userId", "userName") SELECT "adjustReason", "adjustsRequestId", "amount", "cancelReason", "canceledAt", "createdAt", "createdAtJalali", "createdAtTime", "exchangeInvoiceId", "exchangeReceiptNo", "id", "invoiceTotal", "itemsJson", "kind", "note", "operationKind", "paidAmount", "paidAt", "paidAtJalali", "paidAtTime", "paidByUserId", "paidByUserName", "paidMethod", "paidShiftId", "paidShiftName", "returnId", "returnTotal", "shiftId", "shiftName", "sourceInvoiceId", "sourceReceiptNo", "status", "stockNote", "stockReleasedAt", "stockReleasedQty", "trackingNo", "userId", "userName" FROM "CardTransferRequest";
DROP TABLE "CardTransferRequest";
ALTER TABLE "new_CardTransferRequest" RENAME TO "CardTransferRequest";
CREATE INDEX "CardTransferRequest_status_idx" ON "CardTransferRequest"("status");
CREATE INDEX "CardTransferRequest_kind_idx" ON "CardTransferRequest"("kind");
CREATE INDEX "CardTransferRequest_returnId_idx" ON "CardTransferRequest"("returnId");
CREATE INDEX "CardTransferRequest_sourceInvoiceId_idx" ON "CardTransferRequest"("sourceInvoiceId");
CREATE INDEX "CardTransferRequest_createdAt_idx" ON "CardTransferRequest"("createdAt");
CREATE INDEX "CardTransferRequest_userId_idx" ON "CardTransferRequest"("userId");
CREATE INDEX "CardTransferRequest_shiftId_idx" ON "CardTransferRequest"("shiftId");
CREATE INDEX "CardTransferRequest_adjustsRequestId_idx" ON "CardTransferRequest"("adjustsRequestId");
CREATE TABLE "new_CashMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "amount" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAtJalali" TEXT,
    "occurredAtTime" TEXT,
    "shiftId" INTEGER,
    "userId" INTEGER,
    "description" TEXT,
    "refType" TEXT,
    "refId" INTEGER,
    "auditLogId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CashMovement" ("amount", "auditLogId", "createdAt", "description", "id", "occurredAt", "occurredAtJalali", "occurredAtTime", "refId", "refType", "shiftId", "type", "userId") SELECT "amount", "auditLogId", "createdAt", "description", "id", "occurredAt", "occurredAtJalali", "occurredAtTime", "refId", "refType", "shiftId", "type", "userId" FROM "CashMovement";
DROP TABLE "CashMovement";
ALTER TABLE "new_CashMovement" RENAME TO "CashMovement";
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");
CREATE INDEX "CashMovement_occurredAt_idx" ON "CashMovement"("occurredAt");
CREATE INDEX "CashMovement_type_idx" ON "CashMovement"("type");
CREATE INDEX "CashMovement_refType_refId_idx" ON "CashMovement"("refType", "refId");
CREATE TABLE "new_CashSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shiftId" INTEGER,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "dayJalali" TEXT NOT NULL DEFAULT '',
    "cashTotal" BIGINT NOT NULL DEFAULT 0,
    "cardTotal" BIGINT NOT NULL DEFAULT 0,
    "creditTotal" BIGINT NOT NULL DEFAULT 0,
    "otherTotal" BIGINT NOT NULL DEFAULT 0,
    "grandTotal" BIGINT NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "countedTotal" BIGINT,
    "openingFloat" BIGINT NOT NULL DEFAULT 0,
    "cashSales" BIGINT NOT NULL DEFAULT 0,
    "cardSales" BIGINT NOT NULL DEFAULT 0,
    "otherSales" BIGINT NOT NULL DEFAULT 0,
    "clearedChequeSales" BIGINT NOT NULL DEFAULT 0,
    "priorCreditSettlements" BIGINT NOT NULL DEFAULT 0,
    "cashReturnRefunds" BIGINT NOT NULL DEFAULT 0,
    "cardReturnRefunds" BIGINT NOT NULL DEFAULT 0,
    "cashExchangeRefunds" BIGINT NOT NULL DEFAULT 0,
    "storeCreditIssued" BIGINT NOT NULL DEFAULT 0,
    "storeCreditUsed" BIGINT NOT NULL DEFAULT 0,
    "pendingCheques" BIGINT NOT NULL DEFAULT 0,
    "bouncedCheques" BIGINT NOT NULL DEFAULT 0,
    "withdrawals" BIGINT NOT NULL DEFAULT 0,
    "deposits" BIGINT NOT NULL DEFAULT 0,
    "expectedCash" BIGINT NOT NULL DEFAULT 0,
    "cashDifference" BIGINT NOT NULL DEFAULT 0,
    "managerAccountReceived" BIGINT NOT NULL DEFAULT 0,
    "destinationUnknownReceived" BIGINT NOT NULL DEFAULT 0,
    "accountingSnapshotJson" TEXT,
    "reportVersion" TEXT,
    "closedAt" DATETIME,
    "closedBy" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CashSession" ("accountingSnapshotJson", "bouncedCheques", "cardReturnRefunds", "cardSales", "cardTotal", "cashDifference", "cashExchangeRefunds", "cashReturnRefunds", "cashSales", "cashTotal", "clearedChequeSales", "closedAt", "closedBy", "countedTotal", "createdAt", "creditTotal", "dayJalali", "deposits", "destinationUnknownReceived", "expectedCash", "fromDate", "grandTotal", "id", "invoiceCount", "managerAccountReceived", "note", "openingFloat", "otherSales", "otherTotal", "pendingCheques", "priorCreditSettlements", "reportVersion", "shiftId", "storeCreditIssued", "storeCreditUsed", "toDate", "withdrawals") SELECT "accountingSnapshotJson", "bouncedCheques", "cardReturnRefunds", "cardSales", "cardTotal", "cashDifference", "cashExchangeRefunds", "cashReturnRefunds", "cashSales", "cashTotal", "clearedChequeSales", "closedAt", "closedBy", "countedTotal", "createdAt", "creditTotal", "dayJalali", "deposits", "destinationUnknownReceived", "expectedCash", "fromDate", "grandTotal", "id", "invoiceCount", "managerAccountReceived", "note", "openingFloat", "otherSales", "otherTotal", "pendingCheques", "priorCreditSettlements", "reportVersion", "shiftId", "storeCreditIssued", "storeCreditUsed", "toDate", "withdrawals" FROM "CashSession";
DROP TABLE "CashSession";
ALTER TABLE "new_CashSession" RENAME TO "CashSession";
CREATE INDEX "CashSession_dayJalali_idx" ON "CashSession"("dayJalali");
CREATE INDEX "CashSession_shiftId_idx" ON "CashSession"("shiftId");
CREATE TABLE "new_Consolidation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "dayJalali" TEXT,
    "shiftId" INTEGER,
    "goodsTotal" BIGINT NOT NULL DEFAULT 0,
    "taxTotal" BIGINT NOT NULL DEFAULT 0,
    "serviceTotal" BIGINT NOT NULL DEFAULT 0,
    "discountTotal" BIGINT NOT NULL DEFAULT 0,
    "deliveryTotal" BIGINT NOT NULL DEFAULT 0,
    "grandTotal" BIGINT NOT NULL DEFAULT 0,
    "receivedTotal" BIGINT NOT NULL DEFAULT 0,
    "returnedTotal" BIGINT NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "movementCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Consolidation" ("createdAt", "dayJalali", "deliveryTotal", "discountTotal", "finalizedAt", "fromDate", "goodsTotal", "grandTotal", "id", "invoiceCount", "movementCount", "receivedTotal", "returnedTotal", "serviceTotal", "shiftId", "taxTotal", "toDate") SELECT "createdAt", "dayJalali", "deliveryTotal", "discountTotal", "finalizedAt", "fromDate", "goodsTotal", "grandTotal", "id", "invoiceCount", "movementCount", "receivedTotal", "returnedTotal", "serviceTotal", "shiftId", "taxTotal", "toDate" FROM "Consolidation";
DROP TABLE "Consolidation";
ALTER TABLE "new_Consolidation" RENAME TO "Consolidation";
CREATE INDEX "Consolidation_dayJalali_idx" ON "Consolidation"("dayJalali");
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isWholesale" BOOLEAN NOT NULL DEFAULT false,
    "manualPurchaseTotal" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Customer" ("address", "code", "createdAt", "id", "isDefault", "isWholesale", "manualPurchaseTotal", "name", "phone") SELECT "address", "code", "createdAt", "id", "isDefault", "isWholesale", "manualPurchaseTotal", "name", "phone" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");
CREATE INDEX "Customer_isWholesale_idx" ON "Customer"("isWholesale");
CREATE TABLE "new_Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "methodId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- نشست ۱۸۱: عمداً `DATETIME` بدون NOT NULL/DEFAULT، دقیقاً مثل قبل از این
    -- migration. خروجی خام `prisma migrate diff` این ستون را «تعمیر» می‌کرد،
    -- ولی این migration فقط اجازه دارد *نوع ستون‌های پول* را عوض کند.
    "createdAt" DATETIME,
    "createdByUserId" INTEGER,
    "createdShiftId" INTEGER,
    "clearedShiftId" INTEGER,
    "clearedByUserId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'CASH',
    "seq" INTEGER NOT NULL DEFAULT 1,
    "paidAtJalali" TEXT,
    "paidAtTime" TEXT,
    "note" TEXT,
    "chequeNo" TEXT,
    "bankName" TEXT,
    "dueDate" DATETIME,
    "dueDateJalali" TEXT,
    "chequeStatus" TEXT,
    "clearedAt" DATETIME,
    "clearedAtJalali" TEXT,
    "overpayAmount" BIGINT NOT NULL DEFAULT 0,
    "storeCreditId" INTEGER,
    "destination" TEXT,
    "voidedAt" DATETIME,
    "voidedByUserId" INTEGER,
    "voidReason" TEXT,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "bankName", "chequeNo", "chequeStatus", "clearedAt", "clearedAtJalali", "clearedByUserId", "clearedShiftId", "createdAt", "createdByUserId", "createdShiftId", "destination", "dueDate", "dueDateJalali", "id", "invoiceId", "kind", "methodId", "note", "overpayAmount", "paidAt", "paidAtJalali", "paidAtTime", "reference", "seq", "storeCreditId", "voidReason", "voidedAt", "voidedByUserId") SELECT "amount", "bankName", "chequeNo", "chequeStatus", "clearedAt", "clearedAtJalali", "clearedByUserId", "clearedShiftId", "createdAt", "createdByUserId", "createdShiftId", "destination", "dueDate", "dueDateJalali", "id", "invoiceId", "kind", "methodId", "note", "overpayAmount", "paidAt", "paidAtJalali", "paidAtTime", "reference", "seq", "storeCreditId", "voidReason", "voidedAt", "voidedByUserId" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_methodId_idx" ON "Payment"("methodId");
CREATE INDEX "Payment_kind_idx" ON "Payment"("kind");
CREATE INDEX "Payment_chequeStatus_idx" ON "Payment"("chequeStatus");
CREATE INDEX "Payment_dueDate_idx" ON "Payment"("dueDate");
CREATE INDEX "Payment_destination_idx" ON "Payment"("destination");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX "Payment_createdByUserId_idx" ON "Payment"("createdByUserId");
CREATE INDEX "Payment_createdShiftId_idx" ON "Payment"("createdShiftId");
CREATE INDEX "Payment_clearedShiftId_idx" ON "Payment"("clearedShiftId");
CREATE INDEX "Payment_clearedByUserId_idx" ON "Payment"("clearedByUserId");
CREATE INDEX "Payment_clearedAt_destination_idx" ON "Payment"("clearedAt", "destination");
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");
CREATE TABLE "new_PriceChangeBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "target" TEXT NOT NULL DEFAULT 'SALE',
    "scope" TEXT NOT NULL,
    "categoryId" INTEGER,
    "categoryName" TEXT,
    "roundStep" BIGINT NOT NULL DEFAULT 1,
    "minPrice" BIGINT NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "deltaTotal" BIGINT NOT NULL DEFAULT 0,
    "userId" INTEGER,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atJalali" TEXT NOT NULL DEFAULT '',
    "atTime" TEXT NOT NULL DEFAULT '',
    "revertedAt" DATETIME,
    "revertedAtJalali" TEXT,
    "state" TEXT NOT NULL DEFAULT 'APPLIED',
    "startAt" DATETIME,
    "startAtJalali" TEXT,
    "startAtTime" TEXT,
    "endAt" DATETIME,
    "endAtJalali" TEXT,
    "endAtTime" TEXT,
    "autoStartedAt" DATETIME,
    "autoEndedAt" DATETIME,
    "variantIdsJson" TEXT,
    "editedAt" DATETIME,
    "editedAtJalali" TEXT,
    "editCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_PriceChangeBatch" ("at", "atJalali", "atTime", "autoEndedAt", "autoStartedAt", "categoryId", "categoryName", "deltaTotal", "editCount", "editedAt", "editedAtJalali", "endAt", "endAtJalali", "endAtTime", "id", "itemCount", "kind", "minPrice", "mode", "note", "revertedAt", "revertedAtJalali", "roundStep", "scope", "startAt", "startAtJalali", "startAtTime", "state", "target", "title", "userId", "value", "variantIdsJson") SELECT "at", "atJalali", "atTime", "autoEndedAt", "autoStartedAt", "categoryId", "categoryName", "deltaTotal", "editCount", "editedAt", "editedAtJalali", "endAt", "endAtJalali", "endAtTime", "id", "itemCount", "kind", "minPrice", "mode", "note", "revertedAt", "revertedAtJalali", "roundStep", "scope", "startAt", "startAtJalali", "startAtTime", "state", "target", "title", "userId", "value", "variantIdsJson" FROM "PriceChangeBatch";
DROP TABLE "PriceChangeBatch";
ALTER TABLE "new_PriceChangeBatch" RENAME TO "PriceChangeBatch";
CREATE INDEX "PriceChangeBatch_at_idx" ON "PriceChangeBatch"("at");
CREATE INDEX "PriceChangeBatch_kind_idx" ON "PriceChangeBatch"("kind");
CREATE INDEX "PriceChangeBatch_revertedAt_idx" ON "PriceChangeBatch"("revertedAt");
CREATE INDEX "PriceChangeBatch_state_idx" ON "PriceChangeBatch"("state");
CREATE INDEX "PriceChangeBatch_startAt_idx" ON "PriceChangeBatch"("startAt");
CREATE INDEX "PriceChangeBatch_endAt_idx" ON "PriceChangeBatch"("endAt");
CREATE TABLE "new_PriceChangeItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT,
    "oldPrice" BIGINT NOT NULL DEFAULT 0,
    "newPrice" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "PriceChangeItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceChangeBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PriceChangeItem" ("batchId", "code", "id", "name", "newPrice", "oldPrice", "variantId") SELECT "batchId", "code", "id", "name", "newPrice", "oldPrice", "variantId" FROM "PriceChangeItem";
DROP TABLE "PriceChangeItem";
ALTER TABLE "new_PriceChangeItem" RENAME TO "PriceChangeItem";
CREATE INDEX "PriceChangeItem_batchId_idx" ON "PriceChangeItem"("batchId");
CREATE INDEX "PriceChangeItem_variantId_idx" ON "PriceChangeItem"("variantId");
CREATE TABLE "new_ProductVariant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "salePrice" BIGINT NOT NULL DEFAULT 0,
    "purchasePrice" BIGINT NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "ledgerAccountCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "externalSku" TEXT,
    "woocommerceProductId" INTEGER,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductVariant" ("barcode", "code", "color", "createdAt", "deletedAt", "externalSku", "id", "isActive", "lastSyncedAt", "ledgerAccountCode", "minStock", "productId", "purchasePrice", "salePrice", "size", "stock", "updatedAt", "woocommerceProductId") SELECT "barcode", "code", "color", "createdAt", "deletedAt", "externalSku", "id", "isActive", "lastSyncedAt", "ledgerAccountCode", "minStock", "productId", "purchasePrice", "salePrice", "size", "stock", "updatedAt", "woocommerceProductId" FROM "ProductVariant";
DROP TABLE "ProductVariant";
ALTER TABLE "new_ProductVariant" RENAME TO "ProductVariant";
CREATE UNIQUE INDEX "ProductVariant_code_key" ON "ProductVariant"("code");
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");
CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant"("barcode");
CREATE INDEX "ProductVariant_code_idx" ON "ProductVariant"("code");
CREATE INDEX "ProductVariant_externalSku_idx" ON "ProductVariant"("externalSku");
CREATE INDEX "ProductVariant_isActive_idx" ON "ProductVariant"("isActive");
CREATE INDEX "ProductVariant_deletedAt_idx" ON "ProductVariant"("deletedAt");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE TABLE "new_PurchaseInvoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceNo" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAtJalali" TEXT NOT NULL,
    "goodsTotal" BIGINT NOT NULL DEFAULT 0,
    "discountTotal" BIGINT NOT NULL DEFAULT 0,
    "grandTotal" BIGINT NOT NULL DEFAULT 0,
    "paidTotal" BIGINT NOT NULL DEFAULT 0,
    "settlementType" TEXT NOT NULL DEFAULT 'CASH',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "note" TEXT,
    CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseInvoice" ("discountTotal", "goodsTotal", "grandTotal", "id", "invoiceNo", "issuedAt", "issuedAtJalali", "note", "paidTotal", "settlementType", "status", "supplierId") SELECT "discountTotal", "goodsTotal", "grandTotal", "id", "invoiceNo", "issuedAt", "issuedAtJalali", "note", "paidTotal", "settlementType", "status", "supplierId" FROM "PurchaseInvoice";
DROP TABLE "PurchaseInvoice";
ALTER TABLE "new_PurchaseInvoice" RENAME TO "PurchaseInvoice";
CREATE UNIQUE INDEX "PurchaseInvoice_invoiceNo_key" ON "PurchaseInvoice"("invoiceNo");
CREATE INDEX "PurchaseInvoice_issuedAtJalali_idx" ON "PurchaseInvoice"("issuedAtJalali");
CREATE INDEX "PurchaseInvoice_issuedAt_idx" ON "PurchaseInvoice"("issuedAt");
CREATE TABLE "new_PurchaseInvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "variantName" TEXT,
    "variantCode" TEXT,
    "warehouseId" INTEGER,
    "qty" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    CONSTRAINT "PurchaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseInvoiceItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseInvoiceItem" ("id", "invoiceId", "lineTotal", "qty", "unitPrice", "variantCode", "variantId", "variantName", "warehouseId") SELECT "id", "invoiceId", "lineTotal", "qty", "unitPrice", "variantCode", "variantId", "variantName", "warehouseId" FROM "PurchaseInvoiceItem";
DROP TABLE "PurchaseInvoiceItem";
ALTER TABLE "new_PurchaseInvoiceItem" RENAME TO "PurchaseInvoiceItem";
CREATE INDEX "PurchaseInvoiceItem_invoiceId_idx" ON "PurchaseInvoiceItem"("invoiceId");
CREATE TABLE "new_SaleInvoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptNo" INTEGER NOT NULL,
    "customerId" INTEGER,
    "userId" INTEGER,
    "shiftId" INTEGER,
    "consolidationId" INTEGER,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAtJalali" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "orderType" TEXT NOT NULL DEFAULT 'INTERNAL',
    "deductInventory" BOOLEAN NOT NULL DEFAULT true,
    "wholesaleDiscountPercent" INTEGER,
    "returnCode" TEXT,
    "returnCodeExpiresAt" DATETIME,
    "tableNo" TEXT,
    "goodsTotal" BIGINT NOT NULL DEFAULT 0,
    "taxTotal" BIGINT NOT NULL DEFAULT 0,
    "serviceCharge" BIGINT NOT NULL DEFAULT 0,
    "discountTotal" BIGINT NOT NULL DEFAULT 0,
    "deliveryFee" BIGINT NOT NULL DEFAULT 0,
    "grandTotal" BIGINT NOT NULL DEFAULT 0,
    "paidTotal" BIGINT NOT NULL DEFAULT 0,
    "settledAt" DATETIME,
    "settledAtJalali" TEXT,
    "exchangeReturnId" INTEGER,
    "sourceInvoiceId" INTEGER,
    "voidedAt" DATETIME,
    "voidedByUserId" INTEGER,
    "voidReason" TEXT,
    "note" TEXT,
    CONSTRAINT "SaleInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleInvoice_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleInvoice_consolidationId_fkey" FOREIGN KEY ("consolidationId") REFERENCES "Consolidation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SaleInvoice" ("consolidationId", "customerId", "deductInventory", "deliveryFee", "discountTotal", "exchangeReturnId", "goodsTotal", "grandTotal", "id", "issuedAt", "issuedAtJalali", "note", "orderType", "paidTotal", "receiptNo", "returnCode", "returnCodeExpiresAt", "serviceCharge", "settledAt", "settledAtJalali", "shiftId", "sourceInvoiceId", "status", "tableNo", "taxTotal", "userId", "voidReason", "voidedAt", "voidedByUserId", "wholesaleDiscountPercent") SELECT "consolidationId", "customerId", "deductInventory", "deliveryFee", "discountTotal", "exchangeReturnId", "goodsTotal", "grandTotal", "id", "issuedAt", "issuedAtJalali", "note", "orderType", "paidTotal", "receiptNo", "returnCode", "returnCodeExpiresAt", "serviceCharge", "settledAt", "settledAtJalali", "shiftId", "sourceInvoiceId", "status", "tableNo", "taxTotal", "userId", "voidReason", "voidedAt", "voidedByUserId", "wholesaleDiscountPercent" FROM "SaleInvoice";
DROP TABLE "SaleInvoice";
ALTER TABLE "new_SaleInvoice" RENAME TO "SaleInvoice";
CREATE UNIQUE INDEX "SaleInvoice_receiptNo_key" ON "SaleInvoice"("receiptNo");
CREATE INDEX "SaleInvoice_issuedAtJalali_idx" ON "SaleInvoice"("issuedAtJalali");
CREATE INDEX "SaleInvoice_status_idx" ON "SaleInvoice"("status");
CREATE INDEX "SaleInvoice_consolidationId_idx" ON "SaleInvoice"("consolidationId");
CREATE INDEX "SaleInvoice_orderType_idx" ON "SaleInvoice"("orderType");
CREATE INDEX "SaleInvoice_returnCode_idx" ON "SaleInvoice"("returnCode");
CREATE INDEX "SaleInvoice_shiftId_idx" ON "SaleInvoice"("shiftId");
CREATE INDEX "SaleInvoice_issuedAt_idx" ON "SaleInvoice"("issuedAt");
CREATE INDEX "SaleInvoice_issuedAtJalali_orderType_idx" ON "SaleInvoice"("issuedAtJalali", "orderType");
CREATE INDEX "SaleInvoice_customerId_idx" ON "SaleInvoice"("customerId");
CREATE INDEX "SaleInvoice_settledAt_idx" ON "SaleInvoice"("settledAt");
CREATE INDEX "SaleInvoice_exchangeReturnId_idx" ON "SaleInvoice"("exchangeReturnId");
CREATE INDEX "SaleInvoice_sourceInvoiceId_idx" ON "SaleInvoice"("sourceInvoiceId");
CREATE INDEX "SaleInvoice_voidedAt_idx" ON "SaleInvoice"("voidedAt");
CREATE TABLE "new_SaleInvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "variantName" TEXT,
    "variantCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "lineTotal" BIGINT NOT NULL,
    CONSTRAINT "SaleInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleInvoiceItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaleInvoiceItem" ("discount", "id", "invoiceId", "lineTotal", "qty", "tax", "unitPrice", "variantCode", "variantId", "variantName") SELECT "discount", "id", "invoiceId", "lineTotal", "qty", "tax", "unitPrice", "variantCode", "variantId", "variantName" FROM "SaleInvoiceItem";
DROP TABLE "SaleInvoiceItem";
ALTER TABLE "new_SaleInvoiceItem" RENAME TO "SaleInvoiceItem";
CREATE INDEX "SaleInvoiceItem_invoiceId_idx" ON "SaleInvoiceItem"("invoiceId");
CREATE INDEX "SaleInvoiceItem_variantId_idx" ON "SaleInvoiceItem"("variantId");
CREATE TABLE "new_SaleReturn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "isFull" BOOLEAN NOT NULL DEFAULT false,
    "total" BIGINT NOT NULL DEFAULT 0,
    "returnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAtJalali" TEXT NOT NULL,
    "returnedAtTime" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'RETURN',
    "exchangeInvoiceId" INTEGER,
    "exchangeReceiptNo" INTEGER,
    "exchangeTotal" BIGINT NOT NULL DEFAULT 0,
    "exchangeDiff" BIGINT NOT NULL DEFAULT 0,
    "exchangeSettlement" TEXT,
    "storeCreditId" INTEGER,
    "storeCreditCode" TEXT,
    "userId" INTEGER,
    "shiftId" INTEGER,
    "hasRemovedItems" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "refundMethod" TEXT,
    "refundAmount" BIGINT NOT NULL DEFAULT 0,
    "refundPaymentId" INTEGER,
    "debtReduction" BIGINT NOT NULL DEFAULT 0,
    "voidedAt" DATETIME,
    "voidedByUserId" INTEGER,
    "voidReason" TEXT,
    "refundedAt" DATETIME,
    "refundedAtJalali" TEXT,
    "refundedAtTime" TEXT,
    "refundReference" TEXT,
    "refundNote" TEXT,
    "legacyAssumption" TEXT,
    "restockPending" BOOLEAN NOT NULL DEFAULT false,
    "restockReleasedAt" DATETIME,
    "restockReleasedAtJalali" TEXT,
    CONSTRAINT "SaleReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaleReturn" ("debtReduction", "exchangeDiff", "exchangeInvoiceId", "exchangeReceiptNo", "exchangeSettlement", "exchangeTotal", "hasRemovedItems", "id", "invoiceId", "isFull", "kind", "legacyAssumption", "note", "refundAmount", "refundMethod", "refundNote", "refundPaymentId", "refundReference", "refundedAt", "refundedAtJalali", "refundedAtTime", "restockPending", "restockReleasedAt", "restockReleasedAtJalali", "returnedAt", "returnedAtJalali", "returnedAtTime", "shiftId", "storeCreditCode", "storeCreditId", "total", "userId", "voidReason", "voidedAt", "voidedByUserId") SELECT "debtReduction", "exchangeDiff", "exchangeInvoiceId", "exchangeReceiptNo", "exchangeSettlement", "exchangeTotal", "hasRemovedItems", "id", "invoiceId", "isFull", "kind", "legacyAssumption", "note", "refundAmount", "refundMethod", "refundNote", "refundPaymentId", "refundReference", "refundedAt", "refundedAtJalali", "refundedAtTime", "restockPending", "restockReleasedAt", "restockReleasedAtJalali", "returnedAt", "returnedAtJalali", "returnedAtTime", "shiftId", "storeCreditCode", "storeCreditId", "total", "userId", "voidReason", "voidedAt", "voidedByUserId" FROM "SaleReturn";
DROP TABLE "SaleReturn";
ALTER TABLE "new_SaleReturn" RENAME TO "SaleReturn";
CREATE INDEX "SaleReturn_invoiceId_idx" ON "SaleReturn"("invoiceId");
CREATE INDEX "SaleReturn_returnedAtJalali_idx" ON "SaleReturn"("returnedAtJalali");
CREATE INDEX "SaleReturn_returnedAt_idx" ON "SaleReturn"("returnedAt");
CREATE INDEX "SaleReturn_kind_idx" ON "SaleReturn"("kind");
CREATE INDEX "SaleReturn_exchangeInvoiceId_idx" ON "SaleReturn"("exchangeInvoiceId");
CREATE INDEX "SaleReturn_voidedAt_idx" ON "SaleReturn"("voidedAt");
CREATE INDEX "SaleReturn_restockPending_idx" ON "SaleReturn"("restockPending");
CREATE TABLE "new_SaleReturnItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnId" INTEGER NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "variantName" TEXT,
    "variantCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "removedFromStock" BOOLEAN NOT NULL DEFAULT false,
    "restockedQty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SaleReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleInvoiceItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaleReturnItem" ("id", "lineTotal", "qty", "removedFromStock", "restockedQty", "returnId", "saleItemId", "unitPrice", "variantCode", "variantId", "variantName") SELECT "id", "lineTotal", "qty", "removedFromStock", "restockedQty", "returnId", "saleItemId", "unitPrice", "variantCode", "variantId", "variantName" FROM "SaleReturnItem";
DROP TABLE "SaleReturnItem";
ALTER TABLE "new_SaleReturnItem" RENAME TO "SaleReturnItem";
CREATE INDEX "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");
CREATE INDEX "SaleReturnItem_variantId_idx" ON "SaleReturnItem"("variantId");
CREATE TABLE "new_StoreCredit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "legacyCode" TEXT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'EXCHANGE',
    "usedAmount" BIGINT NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "multiUse" BOOLEAN NOT NULL DEFAULT false,
    "settingsOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "issuedDays" INTEGER,
    "restrictScope" TEXT NOT NULL DEFAULT 'ALL',
    "restrictCategoryIdsJson" TEXT,
    "restrictVariantIdsJson" TEXT,
    "minPurchase" BIGINT NOT NULL DEFAULT 0,
    "maxPerTransaction" BIGINT NOT NULL DEFAULT 0,
    "customerLocked" BOOLEAN NOT NULL DEFAULT false,
    "holderCompany" TEXT,
    "holderNationalId" TEXT,
    "holderPhone" TEXT,
    "holderAddress" TEXT,
    "holderAgent" TEXT,
    "holderNote" TEXT,
    "batchId" INTEGER,
    "prefix" TEXT,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" DATETIME,
    "reminderOptOut" BOOLEAN NOT NULL DEFAULT false,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" DATETIME,
    "lastReminderKind" TEXT,
    "voidedAt" DATETIME,
    "voidedReason" TEXT,
    "suspendedAt" DATETIME,
    "deletedAt" DATETIME,
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
    -- نشست ۱۸۱: `DEFAULT CURRENT_TIMESTAMP` عمداً حفظ شد. برداشتنش (که خروجی
    -- خام ابزار انجام می‌داد) هر `INSERT` خامی را که این ستون را نمی‌نویسد
    -- می‌شکند — دقیقاً همان چیزی که تست `audit-a107-01` را انداخت.
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_StoreCredit" ("amount", "batchId", "code", "createdAt", "customerId", "customerLocked", "customerName", "deletedAt", "exchangeInvoiceId", "expiresAt", "expiresAtJalali", "holderAddress", "holderAgent", "holderCompany", "holderNationalId", "holderNote", "holderPhone", "id", "issuedAt", "issuedAtJalali", "issuedAtTime", "issuedDays", "lastPrintedAt", "lastReminderAt", "lastReminderKind", "legacyCode", "maxPerTransaction", "maxUses", "minPurchase", "multiUse", "note", "overrideReason", "prefix", "printCount", "remainderCreditId", "reminderCount", "reminderOptOut", "restrictCategoryIdsJson", "restrictScope", "restrictVariantIdsJson", "returnId", "settingsOverride", "source", "sourceInvoiceId", "status", "suspendedAt", "updatedAt", "usedAmount", "usedAt", "usedAtJalali", "usedAtTime", "usedCount", "usedInvoiceId", "usedPaymentId", "usedReceiptNo", "userId", "voidedAt", "voidedReason") SELECT "amount", "batchId", "code", "createdAt", "customerId", "customerLocked", "customerName", "deletedAt", "exchangeInvoiceId", "expiresAt", "expiresAtJalali", "holderAddress", "holderAgent", "holderCompany", "holderNationalId", "holderNote", "holderPhone", "id", "issuedAt", "issuedAtJalali", "issuedAtTime", "issuedDays", "lastPrintedAt", "lastReminderAt", "lastReminderKind", "legacyCode", "maxPerTransaction", "maxUses", "minPurchase", "multiUse", "note", "overrideReason", "prefix", "printCount", "remainderCreditId", "reminderCount", "reminderOptOut", "restrictCategoryIdsJson", "restrictScope", "restrictVariantIdsJson", "returnId", "settingsOverride", "source", "sourceInvoiceId", "status", "suspendedAt", "updatedAt", "usedAmount", "usedAt", "usedAtJalali", "usedAtTime", "usedCount", "usedInvoiceId", "usedPaymentId", "usedReceiptNo", "userId", "voidedAt", "voidedReason" FROM "StoreCredit";
DROP TABLE "StoreCredit";
ALTER TABLE "new_StoreCredit" RENAME TO "StoreCredit";
CREATE UNIQUE INDEX "StoreCredit_code_key" ON "StoreCredit"("code");
CREATE INDEX "StoreCredit_status_idx" ON "StoreCredit"("status");
CREATE INDEX "StoreCredit_issuedAt_idx" ON "StoreCredit"("issuedAt");
CREATE INDEX "StoreCredit_usedInvoiceId_idx" ON "StoreCredit"("usedInvoiceId");
CREATE INDEX "StoreCredit_returnId_idx" ON "StoreCredit"("returnId");
CREATE INDEX "StoreCredit_source_idx" ON "StoreCredit"("source");
CREATE INDEX "StoreCredit_customerId_idx" ON "StoreCredit"("customerId");
CREATE INDEX "StoreCredit_expiresAt_idx" ON "StoreCredit"("expiresAt");
CREATE INDEX "StoreCredit_batchId_idx" ON "StoreCredit"("batchId");
CREATE INDEX "StoreCredit_deletedAt_idx" ON "StoreCredit"("deletedAt");
CREATE INDEX "StoreCredit_source_status_idx" ON "StoreCredit"("source", "status");
CREATE TABLE "new_StoreCreditBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "count" INTEGER NOT NULL DEFAULT 0,
    "amountEach" BIGINT NOT NULL DEFAULT 0,
    "totalAmount" BIGINT NOT NULL DEFAULT 0,
    "days" INTEGER,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "multiUse" BOOLEAN NOT NULL DEFAULT false,
    "codeLength" INTEGER NOT NULL DEFAULT 8,
    "prefix" TEXT,
    "alphabet" TEXT NOT NULL DEFAULT 'ALNUM',
    "excludeSimilar" BOOLEAN NOT NULL DEFAULT true,
    "lengthGrown" BOOLEAN NOT NULL DEFAULT false,
    "restrictScope" TEXT NOT NULL DEFAULT 'ALL',
    "restrictCategoryIdsJson" TEXT,
    "restrictVariantIdsJson" TEXT,
    "minPurchase" BIGINT NOT NULL DEFAULT 0,
    "maxPerTransaction" BIGINT NOT NULL DEFAULT 0,
    "customerId" INTEGER,
    "customerName" TEXT,
    "holderCompany" TEXT,
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAtJalali" TEXT NOT NULL DEFAULT '',
    "createdAtTime" TEXT NOT NULL DEFAULT '',
    "note" TEXT
);
INSERT INTO "new_StoreCreditBatch" ("alphabet", "amountEach", "codeLength", "count", "createdAt", "createdAtJalali", "createdAtTime", "customerId", "customerName", "days", "excludeSimilar", "holderCompany", "id", "lengthGrown", "maxPerTransaction", "maxUses", "minPurchase", "multiUse", "note", "prefix", "restrictCategoryIdsJson", "restrictScope", "restrictVariantIdsJson", "source", "title", "totalAmount", "userId") SELECT "alphabet", "amountEach", "codeLength", "count", "createdAt", "createdAtJalali", "createdAtTime", "customerId", "customerName", "days", "excludeSimilar", "holderCompany", "id", "lengthGrown", "maxPerTransaction", "maxUses", "minPurchase", "multiUse", "note", "prefix", "restrictCategoryIdsJson", "restrictScope", "restrictVariantIdsJson", "source", "title", "totalAmount", "userId" FROM "StoreCreditBatch";
DROP TABLE "StoreCreditBatch";
ALTER TABLE "new_StoreCreditBatch" RENAME TO "StoreCreditBatch";
CREATE INDEX "StoreCreditBatch_createdAt_idx" ON "StoreCreditBatch"("createdAt");
CREATE INDEX "StoreCreditBatch_source_idx" ON "StoreCreditBatch"("source");
CREATE TABLE "new_StoreCreditRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "creditId" INTEGER NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "amount" BIGINT NOT NULL DEFAULT 0,
    "remainderAfter" BIGINT NOT NULL DEFAULT 0,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "invoiceId" INTEGER,
    "receiptNo" INTEGER,
    "paymentId" INTEGER,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atJalali" TEXT NOT NULL DEFAULT '',
    "atTime" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "shiftId" INTEGER,
    "idempotencyKey" TEXT,
    "reversedAt" DATETIME,
    "reversedReason" TEXT,
    "note" TEXT
);
INSERT INTO "new_StoreCreditRedemption" ("amount", "at", "atJalali", "atTime", "code", "creditId", "id", "idempotencyKey", "invoiceId", "note", "paymentId", "receiptNo", "remainderAfter", "reversedAt", "reversedReason", "seq", "shiftId", "userId") SELECT "amount", "at", "atJalali", "atTime", "code", "creditId", "id", "idempotencyKey", "invoiceId", "note", "paymentId", "receiptNo", "remainderAfter", "reversedAt", "reversedReason", "seq", "shiftId", "userId" FROM "StoreCreditRedemption";
DROP TABLE "StoreCreditRedemption";
ALTER TABLE "new_StoreCreditRedemption" RENAME TO "StoreCreditRedemption";
CREATE INDEX "StoreCreditRedemption_creditId_idx" ON "StoreCreditRedemption"("creditId");
CREATE INDEX "StoreCreditRedemption_invoiceId_idx" ON "StoreCreditRedemption"("invoiceId");
CREATE INDEX "StoreCreditRedemption_at_idx" ON "StoreCreditRedemption"("at");
CREATE INDEX "StoreCreditRedemption_code_idx" ON "StoreCreditRedemption"("code");
CREATE UNIQUE INDEX "StoreCreditRedemption_idempotencyKey_key" ON "StoreCreditRedemption"("idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

