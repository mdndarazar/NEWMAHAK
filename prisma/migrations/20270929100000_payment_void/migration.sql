-- نشست ۶۶ · بند ۴-۲۲: ابطال پرداخت به‌جای حذف فیزیکی
ALTER TABLE "Payment" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "voidedByUserId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "voidReason" TEXT;
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");
