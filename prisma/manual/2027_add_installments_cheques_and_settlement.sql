-- ---------------------------------------------------------------------------
-- فروش نسیه (اقساطی): پرداختی چندمرحله‌ای + چک، و علامت «تسویه‌شده».
--
-- ۱) جدول Payment از این پس «تاریخچه‌ی پرداختی‌های یک فاکتور» است، نه یک ردیف
--    تسویه‌ی لحظه‌ی فروش. هر پرداختی تاریخ و ساعت خودش را دارد (paidAtJalali /
--    paidAtTime) و شماره‌ی ترتیبی‌اش (seq = پرداختی اول، دوم، ...).
--
-- ۲) چک: همان جدول Payment با kind = 'CHEQUE'. تا وقتی chequeStatus برابر
--    'CLEARED' نشده باشد، مبلغ چک پول دریافت‌شده به‌حساب نمی‌آید (نه در
--    SaleInvoice.paidTotal و نه در دریافتی‌های گزارش فروش / بستن صندوق).
--    مشخصات چک: مبلغ (amount)، سررسید (dueDate/dueDateJalali)، شماره چک
--    (chequeNo) و بانک (bankName).
--
-- ۳) SaleInvoice.settledAt = لحظه‌ای که باقی‌مانده صفر شد.
--    ⚠️ پیش‌فرض NULL، پس هیچ فاکتور موجودی تغییر نمی‌کند؛ وضعیت نمایشی همیشه
--    از مقایسه‌ی paidTotal با grandTotal حساب می‌شود و این ستون فقط «تاریخ
--    تسویه» را نگه می‌دارد.
--
-- همه‌ی ستون‌ها nullable یا با DEFAULT اند، پس روی دیتابیس پرِ فعلی بی‌خطر
-- اجرا می‌شوند و رفتار فعلی برنامه مو‌به‌مو حفظ می‌گردد.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE "Payment" ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payment" ADD COLUMN "paidAtJalali" TEXT;
ALTER TABLE "Payment" ADD COLUMN "paidAtTime" TEXT;
ALTER TABLE "Payment" ADD COLUMN "note" TEXT;
ALTER TABLE "Payment" ADD COLUMN "chequeNo" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "dueDateJalali" TEXT;
ALTER TABLE "Payment" ADD COLUMN "chequeStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN "clearedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "clearedAtJalali" TEXT;

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN "settledAt" DATETIME;
ALTER TABLE "SaleInvoice" ADD COLUMN "settledAtJalali" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payment_kind_idx" ON "Payment"("kind");
CREATE INDEX IF NOT EXISTS "Payment_chequeStatus_idx" ON "Payment"("chequeStatus");
CREATE INDEX IF NOT EXISTS "Payment_dueDate_idx" ON "Payment"("dueDate");
CREATE INDEX IF NOT EXISTS "SaleInvoice_settledAt_idx" ON "SaleInvoice"("settledAt");
