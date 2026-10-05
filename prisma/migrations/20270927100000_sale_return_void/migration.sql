-- نشست ۶۴ · خوشه C / بند ۴-۲۲: «حذف» برگشت ساده = ابطال (void) با مهر کی/کِی/چرا
-- افزایشی؛ همه‌ی برگشت‌های موجود voidedAt = NULL (فعال) می‌مانند ⇒ رفتار قبلی.
ALTER TABLE "SaleReturn" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "SaleReturn" ADD COLUMN "voidedByUserId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "voidReason" TEXT;
CREATE INDEX "SaleReturn_voidedAt_idx" ON "SaleReturn"("voidedAt");
