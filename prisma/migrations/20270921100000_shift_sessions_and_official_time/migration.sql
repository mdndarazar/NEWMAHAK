-- -----------------------------------------------------------------------------
-- جلسه ۱۹: «نشست شیفت» (Session) به‌جای یک رکورد ثابت به ازای هر بازه‌ی ساعتی.
--
-- فقط ستون *جدید* با مقدار پیش‌فرض اضافه می‌شود؛ هیچ ستونی حذف نمی‌شود، هیچ نوعی
-- عوض نمی‌شود و هیچ ردیفی پاک نمی‌شود. پس روی دیتابیس پرِ فروشگاه امن است و
-- رکوردهای قبلی مو‌به‌مو سر جای خودشان می‌مانند (هر شیفت قدیمی = نشست ۱).
-- -----------------------------------------------------------------------------
ALTER TABLE "Shift" ADD COLUMN "sessionSeq" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Shift" ADD COLUMN "suggestedName" TEXT;
ALTER TABLE "Shift" ADD COLUMN "suggestedSlot" INTEGER;
ALTER TABLE "Shift" ADD COLUMN "slotNumber" INTEGER;
ALTER TABLE "Shift" ADD COLUMN "nameOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "Shift" ADD COLUMN "staffConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN "openedVia" TEXT NOT NULL DEFAULT 'AUTO';

-- گروه‌بندی «همه‌ی نشست‌های یک نام شیفت در یک روز» (سرجمع شیفت در گزارش‌ها)
CREATE INDEX IF NOT EXISTS "Shift_dayJalali_name_idx" ON "Shift"("dayJalali", "name");
