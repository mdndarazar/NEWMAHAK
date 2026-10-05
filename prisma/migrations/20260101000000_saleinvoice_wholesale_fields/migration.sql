-- ---------------------------------------------------------------------------
-- افزودن فیلدهای فاکتور فروش عمده به SaleInvoice + ایندکس orderType.
--
-- این همان چیزی است که تا امروز فقط در schema.prisma وجود داشت و هیچ‌وقت روی
-- دیتابیس واقعی اجرا نشده بود؛ نتیجه‌اش خطای
-- «The column main.SaleInvoice.deductInventory does not exist» در ثبت و نمایش
-- فاکتور بود. با ALTER TABLE هیچ داده‌ای بازنویسی یا حذف نمی‌شود.
--
--  deductInventory          : NOT NULL DEFAULT true → همه‌ی فاکتورهای قبلی
--                             «با کسر از موجودی» فرض می‌شوند (رفتار قبلی برنامه).
--  wholesaleDiscountPercent : NULL‑پذیر → فاکتورهای قبلی بدون درصد عمده.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN "deductInventory" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN "wholesaleDiscountPercent" INTEGER;

-- CreateIndex
CREATE INDEX "SaleInvoice_orderType_idx" ON "SaleInvoice"("orderType");
