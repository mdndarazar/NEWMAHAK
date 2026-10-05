-- -----------------------------------------------------------------------------
-- جلسه ۱۳: داده‌های افزایشی حسابداری فروش، بازپرداخت و بستن صندوق
-- این migration فقط ستون و جدول جدید اضافه می‌کند. هیچ ستون قدیمی حذف یا
-- تغییر نوع نمی‌دهد؛ بنابراین روی دیتابیس پرِ فروش امن و قابل برگشت است.
-- برگشت‌های قدیمی refundMethod ندارند و در گزارش با برچسب «فرض‌شده از داده‌ی
-- قدیمی» نمایش داده می‌شوند؛ از حدس بی‌ثبت درباره‌ی خروج وجه خودداری می‌کنیم.
-- -----------------------------------------------------------------------------
ALTER TABLE "SaleReturn" ADD COLUMN "refundMethod" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "refundAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleReturn" ADD COLUMN "refundPaymentId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "refundedAt" DATETIME;
ALTER TABLE "SaleReturn" ADD COLUMN "refundedAtJalali" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "refundedAtTime" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "refundReference" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "refundNote" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "legacyAssumption" TEXT;
ALTER TABLE "CashSession" ADD COLUMN "openingFloat" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cashSales" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cardSales" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "otherSales" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "clearedChequeSales" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "priorCreditSettlements" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cashReturnRefunds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cardReturnRefunds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cashExchangeRefunds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "storeCreditIssued" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "storeCreditUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "pendingCheques" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "bouncedCheques" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "withdrawals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "deposits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "expectedCash" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "cashDifference" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "accountingSnapshotJson" TEXT;
ALTER TABLE "CashSession" ADD COLUMN "reportVersion" TEXT;
CREATE TABLE IF NOT EXISTS "CashMovement" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "amount" INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");
CREATE INDEX IF NOT EXISTS "CashMovement_occurredAt_idx" ON "CashMovement"("occurredAt");
CREATE INDEX IF NOT EXISTS "CashMovement_type_idx" ON "CashMovement"("type");
CREATE INDEX IF NOT EXISTS "CashMovement_refType_refId_idx" ON "CashMovement"("refType", "refId");
