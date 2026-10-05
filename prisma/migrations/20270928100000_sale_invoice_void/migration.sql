-- نشست ۶۵ · خوشه C / بند ۴-۲۲: ابطال اتمیک گراف تعویض — سند تعویض (SaleInvoice) با مهر کی/کِی/چرا
-- افزایشی؛ همه‌ی فاکتورهای موجود voidedAt = NULL (فعال) می‌مانند ⇒ رفتار قبلی.
ALTER TABLE "SaleInvoice" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "SaleInvoice" ADD COLUMN "voidedByUserId" INTEGER;
ALTER TABLE "SaleInvoice" ADD COLUMN "voidReason" TEXT;
CREATE INDEX "SaleInvoice_voidedAt_idx" ON "SaleInvoice"("voidedAt");
