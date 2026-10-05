-- ---------------------------------------------------------------------------
-- نشست دهم — مورد ۱ (زمان‌بندی خودکار تخفیف/افزایش/کاهش گروهی) و
--             مورد ۲ (ویرایش و حذف سابقه‌ی تغییر قیمت).
--
-- فقط ستون‌های *جدید و اختیاری* به جدول موجود `PriceChangeBatch` اضافه می‌شوند.
-- هیچ ستونی حذف یا تغییر نوع نمی‌دهد و هیچ داده‌ای دست نمی‌خورد:
--
--   • `state` با پیش‌فرض 'APPLIED' پر می‌شود، پس همه‌ی دسته‌های قبلی همان
--     «اعمال‌شده»ی همیشگی می‌مانند و بعد از آن با یک UPDATE، دسته‌هایی که قبلاً
--     بازگردانی شده بودند به 'REVERTED' منتقل می‌شوند (فقط برچسب، نه رفتار).
--   • ستون‌های زمان‌بندی (`startAt` / `endAt` / ...) همه NULL می‌مانند، و NULL
--     یعنی «مثل قبل: دائمی تا بازگردانی دستی».
--
-- بقیه‌ی موارد این نشست (رمز قابل‌بازیابی، رمز سوم شیفتی، پرداختی‌های نسیه در
-- جزئیات شیفت، تغییر اندازه‌ی ستون‌ها) عمداً هیچ تغییری در لایه‌ی داده لازم
-- نداشتند: رمزها روی همان `Setting` می‌نشینند، پرداختی‌ها از جدول موجود
-- `Payment` خوانده می‌شوند و تغییر اندازه‌ی ستون یک تنظیم نمایشی است.
-- ---------------------------------------------------------------------------

ALTER TABLE "PriceChangeBatch" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'APPLIED';
ALTER TABLE "PriceChangeBatch" ADD COLUMN "startAt" DATETIME;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "startAtJalali" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "startAtTime" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "endAt" DATETIME;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "endAtJalali" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "endAtTime" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "autoStartedAt" DATETIME;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "autoEndedAt" DATETIME;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "variantIdsJson" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "editedAt" DATETIME;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "editedAtJalali" TEXT;
ALTER TABLE "PriceChangeBatch" ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0;

-- دسته‌هایی که قبلاً دستی بازگردانی شده‌اند، برچسب درست خودشان را بگیرند.
UPDATE "PriceChangeBatch" SET "state" = 'REVERTED' WHERE "revertedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "PriceChangeBatch_state_idx" ON "PriceChangeBatch"("state");
CREATE INDEX IF NOT EXISTS "PriceChangeBatch_startAt_idx" ON "PriceChangeBatch"("startAt");
CREATE INDEX IF NOT EXISTS "PriceChangeBatch_endAt_idx" ON "PriceChangeBatch"("endAt");
