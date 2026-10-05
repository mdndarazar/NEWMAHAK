-- -----------------------------------------------------------------------------
-- جلسه ۲۰ — ماژول «مدیریت اعتبار خرید».
--
-- قاعده‌ی همیشگی این پروژه رعایت شده است: هیچ ستونی حذف نمی‌شود، هیچ نوعی عوض
-- نمی‌شود و هیچ ردیفی پاک نمی‌شود. همه‌ی ستون‌های تازه Nullable یا Default‌دارند،
-- پس روی دیتابیس پرِ فروشگاه امن است و رکوردهای «اعتبار تعویض کالا»ی قبلی
-- مو‌به‌مو مثل قبل کار می‌کنند (source = EXCHANGE · maxUses = 1 · usedAmount = 0).
--
-- تنها کار *غیرافزایشی* این فایل، یکتا کردن واقعیِ ستون code است (§۶ سند مرجع).
-- چون یکتایی قبلی فقط سطح اپلیکیشن و فقط بین کدهای ACTIVE بود، ممکن است در
-- دیتابیس قدیمی چند رکورد هم‌کد وجود داشته باشد. پس قبل از ساخت ایندکس یکتا:
--   ۱) کد اصلی آن رکوردهای تکراری در ستون تازه‌ی legacyCode نگه داشته می‌شود
--      (هیچ سابقه‌ای گم نمی‌شود)،
--   ۲) کد رکوردهای *قدیمی‌ترِ* تکراری با پسوند X<id> بی‌تصادم می‌گردد. جدیدترین
--      رکورد هر کد، کد خودش را عیناً نگه می‌دارد تا بارکدهای در گردشِ مشتری‌ها
--      همچنان کار کنند.
-- -----------------------------------------------------------------------------

-- ============================ ۱) ستون‌های تازه‌ی StoreCredit ============================
ALTER TABLE "StoreCredit" ADD COLUMN "legacyCode" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'EXCHANGE';
ALTER TABLE "StoreCredit" ADD COLUMN "usedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "usedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "maxUses" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StoreCredit" ADD COLUMN "multiUse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreCredit" ADD COLUMN "settingsOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreCredit" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "issuedDays" INTEGER;
ALTER TABLE "StoreCredit" ADD COLUMN "restrictScope" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "StoreCredit" ADD COLUMN "restrictCategoryIdsJson" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "restrictVariantIdsJson" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "minPurchase" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "maxPerTransaction" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "customerLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreCredit" ADD COLUMN "holderCompany" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "holderNationalId" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "holderPhone" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "holderAddress" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "holderAgent" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "holderNote" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "batchId" INTEGER;
ALTER TABLE "StoreCredit" ADD COLUMN "prefix" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "printCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "lastPrintedAt" DATETIME;
ALTER TABLE "StoreCredit" ADD COLUMN "reminderOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreCredit" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreCredit" ADD COLUMN "lastReminderAt" DATETIME;
ALTER TABLE "StoreCredit" ADD COLUMN "lastReminderKind" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "StoreCredit" ADD COLUMN "voidedReason" TEXT;
ALTER TABLE "StoreCredit" ADD COLUMN "suspendedAt" DATETIME;
ALTER TABLE "StoreCredit" ADD COLUMN "deletedAt" DATETIME;

-- ==================== ۲) یکتا کردن واقعیِ کد (§۶) ====================
-- الف) کد اصلیِ رکوردهای تکراریِ قدیمی‌تر را نگه می‌داریم
UPDATE "StoreCredit"
   SET "legacyCode" = "code"
 WHERE "code" IN (SELECT "code" FROM "StoreCredit" GROUP BY "code" HAVING COUNT(*) > 1)
   AND "id" NOT IN (SELECT MAX("id") FROM "StoreCredit" GROUP BY "code");

-- ب) و همان رکوردها را با پسوند X<id> بی‌تصادم می‌کنیم (id یکتاست، پس نتیجه هم یکتاست)
UPDATE "StoreCredit"
   SET "code" = "code" || 'X' || "id"
 WHERE "legacyCode" IS NOT NULL;

-- ج) ایندکس غیر‌یکتای قبلی جایش را به ایندکس یکتای واقعی می‌دهد
DROP INDEX IF EXISTS "StoreCredit_code_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCredit_code_key" ON "StoreCredit"("code");

-- ==================== ۳) ایندکس‌های داشبورد و گزارش (§۱۵) ====================
CREATE INDEX IF NOT EXISTS "StoreCredit_source_idx" ON "StoreCredit"("source");
CREATE INDEX IF NOT EXISTS "StoreCredit_customerId_idx" ON "StoreCredit"("customerId");
CREATE INDEX IF NOT EXISTS "StoreCredit_expiresAt_idx" ON "StoreCredit"("expiresAt");
CREATE INDEX IF NOT EXISTS "StoreCredit_batchId_idx" ON "StoreCredit"("batchId");
CREATE INDEX IF NOT EXISTS "StoreCredit_deletedAt_idx" ON "StoreCredit"("deletedAt");
CREATE INDEX IF NOT EXISTS "StoreCredit_source_status_idx" ON "StoreCredit"("source", "status");

-- ==================== ۴) دفتر مصرف‌ها (§۴، §۸، §۲۱) ====================
CREATE TABLE IF NOT EXISTS "StoreCreditRedemption" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "creditId" INTEGER NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "amount" INTEGER NOT NULL DEFAULT 0,
  "remainderAfter" INTEGER NOT NULL DEFAULT 0,
  "seq" INTEGER NOT NULL DEFAULT 1,
  "invoiceId" INTEGER,
  "receiptNo" INTEGER,
  "paymentId" INTEGER,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atJalali" TEXT NOT NULL DEFAULT '',
  "atTime" TEXT NOT NULL DEFAULT '',
  "userId" INTEGER,
  "shiftId" INTEGER,
  "idempotencyKey" TEXT,
  "reversedAt" DATETIME,
  "reversedReason" TEXT,
  "note" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCreditRedemption_idempotencyKey_key" ON "StoreCreditRedemption"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "StoreCreditRedemption_creditId_idx" ON "StoreCreditRedemption"("creditId");
CREATE INDEX IF NOT EXISTS "StoreCreditRedemption_invoiceId_idx" ON "StoreCreditRedemption"("invoiceId");
CREATE INDEX IF NOT EXISTS "StoreCreditRedemption_at_idx" ON "StoreCreditRedemption"("at");
CREATE INDEX IF NOT EXISTS "StoreCreditRedemption_code_idx" ON "StoreCreditRedemption"("code");

-- ==================== ۵) دسته‌های تولید گروهی (§۵) ====================
CREATE TABLE IF NOT EXISTS "StoreCreditBatch" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "count" INTEGER NOT NULL DEFAULT 0,
  "amountEach" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" INTEGER NOT NULL DEFAULT 0,
  "days" INTEGER,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "multiUse" BOOLEAN NOT NULL DEFAULT false,
  "codeLength" INTEGER NOT NULL DEFAULT 8,
  "prefix" TEXT,
  "alphabet" TEXT NOT NULL DEFAULT 'ALNUM',
  "excludeSimilar" BOOLEAN NOT NULL DEFAULT true,
  "lengthGrown" BOOLEAN NOT NULL DEFAULT false,
  "restrictScope" TEXT NOT NULL DEFAULT 'ALL',
  "restrictCategoryIdsJson" TEXT,
  "restrictVariantIdsJson" TEXT,
  "minPurchase" INTEGER NOT NULL DEFAULT 0,
  "maxPerTransaction" INTEGER NOT NULL DEFAULT 0,
  "customerId" INTEGER,
  "customerName" TEXT,
  "holderCompany" TEXT,
  "userId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAtJalali" TEXT NOT NULL DEFAULT '',
  "createdAtTime" TEXT NOT NULL DEFAULT '',
  "note" TEXT
);
CREATE INDEX IF NOT EXISTS "StoreCreditBatch_createdAt_idx" ON "StoreCreditBatch"("createdAt");
CREATE INDEX IF NOT EXISTS "StoreCreditBatch_source_idx" ON "StoreCreditBatch"("source");

-- ==================== ۶) زیرساخت یادآوری (§۱۴ — بدون ارسال واقعی) ====================
CREATE TABLE IF NOT EXISTS "CreditReminderLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "creditId" INTEGER NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'UNUSED',
  "status" TEXT NOT NULL DEFAULT 'READY',
  "phone" TEXT,
  "text" TEXT NOT NULL DEFAULT '',
  "placeholdersJson" TEXT,
  "reason" TEXT,
  "plannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" DATETIME,
  "atJalali" TEXT NOT NULL DEFAULT '',
  "atTime" TEXT NOT NULL DEFAULT '',
  "userId" INTEGER
);
CREATE INDEX IF NOT EXISTS "CreditReminderLog_creditId_idx" ON "CreditReminderLog"("creditId");
CREATE INDEX IF NOT EXISTS "CreditReminderLog_status_idx" ON "CreditReminderLog"("status");
CREATE INDEX IF NOT EXISTS "CreditReminderLog_plannedAt_idx" ON "CreditReminderLog"("plannedAt");
CREATE INDEX IF NOT EXISTS "CreditReminderLog_kind_idx" ON "CreditReminderLog"("kind");
