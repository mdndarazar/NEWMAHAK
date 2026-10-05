-- -----------------------------------------------------------------------------
-- جلسه ۱۷: «کارت‌به‌کارت توسط مدیر» + «شمارش فیزیکی دوره‌ای انبار»
-- فقط جدول و ایندکس *جدید* می‌سازد. هیچ ستون قدیمی حذف یا تغییر نوع نمی‌دهد،
-- پس روی دیتابیس پرِ فروش امن است و رفتار رکوردهای قبلی مو‌به‌مو حفظ می‌شود.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CardTransferRequest" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "kind" TEXT NOT NULL DEFAULT 'REQUEST',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "operationKind" TEXT NOT NULL DEFAULT 'RETURN',
  "returnId" INTEGER NOT NULL,
  "sourceInvoiceId" INTEGER,
  "sourceReceiptNo" INTEGER,
  "exchangeInvoiceId" INTEGER,
  "exchangeReceiptNo" INTEGER,
  "invoiceTotal" INTEGER NOT NULL DEFAULT 0,
  "returnTotal" INTEGER NOT NULL DEFAULT 0,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "itemsJson" TEXT,
  "stockNote" TEXT,
  "userId" INTEGER,
  "userName" TEXT,
  "shiftId" INTEGER,
  "shiftName" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAtJalali" TEXT NOT NULL DEFAULT '',
  "createdAtTime" TEXT NOT NULL DEFAULT '',
  "paidAmount" INTEGER,
  "paidAt" DATETIME,
  "paidAtJalali" TEXT,
  "paidAtTime" TEXT,
  "paidMethod" TEXT,
  "trackingNo" TEXT,
  "paidByUserId" INTEGER,
  "paidByUserName" TEXT,
  "paidShiftId" INTEGER,
  "paidShiftName" TEXT,
  "adjustsRequestId" INTEGER,
  "adjustReason" TEXT,
  "note" TEXT
);
CREATE INDEX IF NOT EXISTS "CardTransferRequest_status_idx" ON "CardTransferRequest"("status");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_kind_idx" ON "CardTransferRequest"("kind");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_returnId_idx" ON "CardTransferRequest"("returnId");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_sourceInvoiceId_idx" ON "CardTransferRequest"("sourceInvoiceId");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_createdAt_idx" ON "CardTransferRequest"("createdAt");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_userId_idx" ON "CardTransferRequest"("userId");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_shiftId_idx" ON "CardTransferRequest"("shiftId");
CREATE INDEX IF NOT EXISTS "CardTransferRequest_adjustsRequestId_idx" ON "CardTransferRequest"("adjustsRequestId");

CREATE TABLE IF NOT EXISTS "StockCountSession" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "countedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "countedAtJalali" TEXT NOT NULL DEFAULT '',
  "countedAtTime" TEXT NOT NULL DEFAULT '',
  "userId" INTEGER,
  "userName" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StockCountSession_countedAt_idx" ON "StockCountSession"("countedAt");
CREATE INDEX IF NOT EXISTS "StockCountSession_countedAtJalali_idx" ON "StockCountSession"("countedAtJalali");

CREATE TABLE IF NOT EXISTS "StockCountItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "sessionId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "code" TEXT,
  "countedQty" INTEGER NOT NULL DEFAULT 0,
  "systemQty" INTEGER NOT NULL DEFAULT 0,
  "diffQty" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  CONSTRAINT "StockCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "StockCountItem_sessionId_idx" ON "StockCountItem"("sessionId");
CREATE INDEX IF NOT EXISTS "StockCountItem_variantId_idx" ON "StockCountItem"("variantId");
