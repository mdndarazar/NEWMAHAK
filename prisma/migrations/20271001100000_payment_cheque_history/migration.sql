-- نشست ۶۹ · خوشه A / بند ۴-۵۲ — تاریخچه‌ی append-only وضعیت چک.
--
-- Payment وضعیت فعلی را برای خواندن سریع نگه می‌دارد؛ این دفتر همه‌ی گذارها
-- را جداگانه ثبت می‌کند تا CLEARED → BOUNCED → CLEARED سابقه‌ی قبلی را پاک نکند.
CREATE TABLE IF NOT EXISTS "PaymentChequeStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "destination" TEXT,
    "clearedAt" DATETIME,
    "clearedAtJalali" TEXT,
    "clearedShiftId" INTEGER,
    "userId" INTEGER,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAtJalali" TEXT
);

CREATE INDEX IF NOT EXISTS "PaymentChequeStatusHistory_paymentId_id_idx"
  ON "PaymentChequeStatusHistory"("paymentId", "id");
CREATE INDEX IF NOT EXISTS "PaymentChequeStatusHistory_status_idx"
  ON "PaymentChequeStatusHistory"("status");
CREATE INDEX IF NOT EXISTS "PaymentChequeStatusHistory_clearedAt_idx"
  ON "PaymentChequeStatusHistory"("clearedAt");

-- برای داده‌ی تاریخی، فقط snapshot وضعیت فعلی ساخته می‌شود؛ تاریخ جعل نمی‌کنیم.
INSERT INTO "PaymentChequeStatusHistory"
  ("paymentId", "status", "destination", "clearedAt", "clearedAtJalali",
   "clearedShiftId", "userId", "changedAt", "changedAtJalali")
SELECT
  "id", COALESCE("chequeStatus", 'PENDING'), "destination", "clearedAt",
  "clearedAtJalali", "clearedShiftId", "createdByUserId",
  COALESCE("createdAt", "paidAt", CURRENT_TIMESTAMP),
  COALESCE("paidAtJalali", '')
FROM "Payment"
WHERE "kind" = 'CHEQUE';
