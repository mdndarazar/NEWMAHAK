-- ===========================================================================
-- پنل پیامکی — فاز ۴: کمپین تبلیغاتی و انصراف («لغو ۱۱»).
--
-- مثل migration قبلی، **فقط DDL افزودنی** است:
--   • هیچ جدول/ستون موجودی حذف یا بازتعریف نمی‌شود،
--   • هیچ داده‌ای خوانده/نوشته نمی‌شود،
--   • صف پیام یک ستون nullable می‌گیرد (`campaignId`) که نبودش یعنی
--     «پیام تراکنشی/دستی»، پس همه‌ی ردیف‌های قبلی معتبر می‌مانند.
--
-- چرا «انصراف» جدول جدا دارد: «لغو ۱۱» یعنی *این شماره* دیگر تبلیغ نگیرد؛
-- مرجع باید شماره باشد نه مشتری، وگرنه با عوض‌شدن شماره‌ی مشتری، شماره‌ی
-- قبلی دوباره پیام تبلیغاتی می‌گیرد.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "SmsOptOut" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PANEL',
    "reason" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsOptOut_phone_key" ON "SmsOptOut"("phone");
CREATE INDEX IF NOT EXISTS "SmsOptOut_createdAt_idx" ON "SmsOptOut"("createdAt");

CREATE TABLE IF NOT EXISTS "SmsCampaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" INTEGER,
    "audienceSource" TEXT NOT NULL DEFAULT 'BANK',
    "optOutNote" TEXT NOT NULL DEFAULT '',
    "audienceCount" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "optOutSkipped" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "costEstimate" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" INTEGER,
    "canceledAt" DATETIME,
    "canceledByUserId" INTEGER,
    "cancelReason" TEXT
);

CREATE INDEX IF NOT EXISTS "SmsCampaign_status_createdAt_idx" ON "SmsCampaign"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "SmsCampaign_createdAt_idx" ON "SmsCampaign"("createdAt");

-- ستون گروه‌بندی روی صف. SQLite برای ADD COLUMN پشتیبانی «IF NOT EXISTS»
-- ندارد؛ اجرای این migration یک بار روی هر دیتابیس انجام می‌شود.
ALTER TABLE "SmsOutbox" ADD COLUMN "campaignId" INTEGER;
CREATE INDEX IF NOT EXISTS "SmsOutbox_campaignId_idx" ON "SmsOutbox"("campaignId");
