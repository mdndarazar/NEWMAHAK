-- نشست ۶۸ · خوشه A / بند ۴-۲: مبدأ واقعی ثبت و تسویه‌ی Payment
--
-- این ستون‌ها عمداً nullable هستند تا ردیف‌های تاریخیِ بدون actor/نشست جعل
-- نشوند. برای ردیف‌های موجود، createdAt از paidAt و actor/نشست از فاکتور
-- مرجع backfill می‌شود؛ مسیرهای جدید همه‌ی این مقادیر را صریح می‌نویسند.
ALTER TABLE "Payment" ADD COLUMN "createdAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "createdByUserId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "createdShiftId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "clearedShiftId" INTEGER;

UPDATE "Payment"
SET "createdAt" = COALESCE("paidAt", CURRENT_TIMESTAMP)
WHERE "createdAt" IS NULL;

UPDATE "Payment"
SET
  "createdByUserId" = (
    SELECT "userId" FROM "SaleInvoice"
    WHERE "SaleInvoice"."id" = "Payment"."invoiceId"
  ),
  "createdShiftId" = (
    SELECT "shiftId" FROM "SaleInvoice"
    WHERE "SaleInvoice"."id" = "Payment"."invoiceId"
  )
WHERE "createdByUserId" IS NULL OR "createdShiftId" IS NULL;

UPDATE "Payment"
SET "clearedShiftId" = "createdShiftId"
WHERE "kind" = 'CHEQUE' AND "chequeStatus" = 'CLEARED' AND "clearedShiftId" IS NULL;

CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX "Payment_createdByUserId_idx" ON "Payment"("createdByUserId");
CREATE INDEX "Payment_createdShiftId_idx" ON "Payment"("createdShiftId");
CREATE INDEX "Payment_clearedShiftId_idx" ON "Payment"("clearedShiftId");
