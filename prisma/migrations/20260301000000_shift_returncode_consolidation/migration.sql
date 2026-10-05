-- ---------------------------------------------------------------------------
-- مرحله‌ی جدید: کد فاکتور (برگشت از فروش)، شیفت‌بندی روز، و وضعیت تجمیع هر روز.
--
-- همه‌چیز با ALTER TABLE ADD COLUMN انجام می‌شود، پس هیچ داده‌ای بازنویسی یا
-- حذف نمی‌شود و دیتابیس فعلی فروشگاه سالم باقی می‌ماند.
--
--  SaleInvoice.returnCode / returnCodeExpiresAt
--      کد کوتاه رندوم روی هر فاکتور فروش تکی + پایان اعتبار آن (پیش‌فرض یک
--      هفته). یکتایی *فقط* در بازه‌ی اعتبار لازم است، پس ایندکس معمولی است نه
--      UNIQUE؛ کد منقضی‌شده می‌تواند دوباره برای فاکتور جدیدی تولید شود.
--  SaleInvoice.tableNo
--      شماره میز / توضیح نوع سفارش که روی رسید چاپ می‌شود (اختیاری).
--  Shift.number / dayJalali / note
--      سه شیفت در روز. فروش‌ها به شیفت *باز* همان روز گره می‌خورند تا گزارش
--      فروش به تفکیک شیفت قابل تهیه باشد.
--  CashSession.*
--      سابقه‌ی کامل‌تر «بستن صندوق» (جمع کل، تعداد فاکتور، مبلغ شمرده‌شده).
--  Consolidation.dayJalali / invoiceCount / movementCount
--      کلید تشخیص «این روز قبلاً تجمیع شده است»؛ مبنای پنل تجمیع با تأخیر.
--  SaleReturn / SaleReturnItem
--      ثبت این‌که کالای یک قلم برگشتی از فهرست انبار حذف شده بوده و چه تعدادی
--      واقعاً به موجودی برگشته است.
-- ---------------------------------------------------------------------------

-- AlterTable: SaleInvoice
ALTER TABLE "SaleInvoice" ADD COLUMN "returnCode" TEXT;
ALTER TABLE "SaleInvoice" ADD COLUMN "returnCodeExpiresAt" DATETIME;
ALTER TABLE "SaleInvoice" ADD COLUMN "tableNo" TEXT;

-- AlterTable: Shift
ALTER TABLE "Shift" ADD COLUMN "number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Shift" ADD COLUMN "dayJalali" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Shift" ADD COLUMN "note" TEXT;

-- AlterTable: CashSession
ALTER TABLE "CashSession" ADD COLUMN "dayJalali" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CashSession" ADD COLUMN "otherTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "grandTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "invoiceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "countedTotal" INTEGER;

-- AlterTable: Consolidation
ALTER TABLE "Consolidation" ADD COLUMN "dayJalali" TEXT;
ALTER TABLE "Consolidation" ADD COLUMN "invoiceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Consolidation" ADD COLUMN "movementCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: SaleReturn
ALTER TABLE "SaleReturn" ADD COLUMN "userId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "shiftId" INTEGER;
ALTER TABLE "SaleReturn" ADD COLUMN "hasRemovedItems" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: SaleReturnItem
ALTER TABLE "SaleReturnItem" ADD COLUMN "removedFromStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleReturnItem" ADD COLUMN "restockedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SaleInvoice_returnCode_idx" ON "SaleInvoice"("returnCode");
CREATE INDEX "SaleInvoice_shiftId_idx" ON "SaleInvoice"("shiftId");
CREATE INDEX "Shift_dayJalali_idx" ON "Shift"("dayJalali");
CREATE INDEX "Shift_closedAt_idx" ON "Shift"("closedAt");
CREATE INDEX "CashSession_dayJalali_idx" ON "CashSession"("dayJalali");
CREATE INDEX "CashSession_shiftId_idx" ON "CashSession"("shiftId");
CREATE INDEX "Consolidation_dayJalali_idx" ON "Consolidation"("dayJalali");
CREATE INDEX "SaleReturn_returnedAtJalali_idx" ON "SaleReturn"("returnedAtJalali");
CREATE INDEX "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");
CREATE INDEX "SaleReturnItem_variantId_idx" ON "SaleReturnItem"("variantId");
