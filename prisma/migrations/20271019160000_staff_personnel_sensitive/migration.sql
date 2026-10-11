-- پروندهٔ پرسنلی مدیر-only: هیچ ستون حساس به جدول User/گزارش‌های عمومی اضافه نمی‌شود.
-- SQLite ADD COLUMN برای دیتابیس‌های موجود additive است و دادهٔ گذشته را دست‌نخورده می‌گذارد.
ALTER TABLE "StaffProfile" ADD COLUMN "nationalId" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "employmentEndJalali" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "employmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "StaffProfile" ADD COLUMN "bankName" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "bankAccountNo" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "bankIban" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "bankAccountHolder" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StaffProfile_nationalId_key" ON "StaffProfile"("nationalId");
CREATE INDEX IF NOT EXISTS "StaffProfile_employmentStatus_idx" ON "StaffProfile"("employmentStatus");
