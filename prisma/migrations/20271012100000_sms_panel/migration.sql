-- ===========================================================================
-- پنل پیامکی — ساختار پایه.
--
-- ⚠️ این migration **فقط DDL افزودنی** است: هیچ جدول/ستون موجودی لمس نمی‌شود و
-- هیچ داده‌ای خوانده یا نوشته نمی‌شود. جدول‌های مالی پروژه (SaleInvoice،
-- Payment، StoreCredit و ...) هیچ کلید خارجی‌ای به این‌ها ندارند.
--
-- رابطه‌ها عمداً scalar هستند (`relatedEntityId`، `customerId` بدون FK)، پس:
--   • حذف یک مشتری، سابقه‌ی پیام‌ها را پاک نمی‌کند،
--   • ابطال/حذف یک فاکتور، صف پیام را خراب نمی‌کند.
-- این همان اصلی است که در `SecondaryStockLog` هم رعایت شده.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "SmsProviderConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'LOG_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "senderNumber" TEXT,
    "patternId" TEXT,
    "credentialsEncrypted" TEXT,
    "credentialsVersion" INTEGER NOT NULL DEFAULT 1,
    "lastHealthCheckAt" DATETIME,
    "lastHealthStatus" TEXT,
    "lastHealthNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SmsProviderConfig_isActive_idx" ON "SmsProviderConfig"("isActive");
CREATE INDEX IF NOT EXISTS "SmsProviderConfig_providerKey_idx" ON "SmsProviderConfig"("providerKey");

CREATE TABLE IF NOT EXISTS "SmsTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SYSTEM',
    "body" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsTemplate_code_key" ON "SmsTemplate"("code");
CREATE INDEX IF NOT EXISTS "SmsTemplate_category_idx" ON "SmsTemplate"("category");
CREATE INDEX IF NOT EXISTS "SmsTemplate_isActive_idx" ON "SmsTemplate"("isActive");

CREATE TABLE IF NOT EXISTS "SmsOutbox" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dedupeKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "templateId" INTEGER,
    "providerConfigId" INTEGER,
    "customerId" INTEGER,
    "phoneSnapshot" TEXT NOT NULL DEFAULT '',
    "customerNameSnapshot" TEXT,
    "bodySnapshot" TEXT NOT NULL DEFAULT '',
    "variablesJson" TEXT,
    "relatedEntity" TEXT,
    "relatedEntityId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lastAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "canceledAt" DATETIME,
    "canceledByUserId" INTEGER,
    "cancelReason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- کلید جلوگیری از تکرار: «دو بار کلیک ⇒ یک پیام» واقعاً در سطح دیتابیس تضمین می‌شود.
CREATE UNIQUE INDEX IF NOT EXISTS "SmsOutbox_dedupeKey_key" ON "SmsOutbox"("dedupeKey");
-- ایندکس کارگر: «چه چیزی الان باید برود؟» — بدون اسکن کامل جدول بزرگ.
CREATE INDEX IF NOT EXISTS "SmsOutbox_status_nextAttemptAt_idx" ON "SmsOutbox"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "SmsOutbox_scheduledAt_idx" ON "SmsOutbox"("scheduledAt");
CREATE INDEX IF NOT EXISTS "SmsOutbox_eventType_idx" ON "SmsOutbox"("eventType");
CREATE INDEX IF NOT EXISTS "SmsOutbox_customerId_idx" ON "SmsOutbox"("customerId");
CREATE INDEX IF NOT EXISTS "SmsOutbox_relatedEntity_relatedEntityId_idx" ON "SmsOutbox"("relatedEntity", "relatedEntityId");
CREATE INDEX IF NOT EXISTS "SmsOutbox_createdAt_idx" ON "SmsOutbox"("createdAt");

CREATE TABLE IF NOT EXISTS "SmsAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "outboxId" INTEGER NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "result" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "responseMetadataJson" TEXT
);

CREATE INDEX IF NOT EXISTS "SmsAttempt_outboxId_idx" ON "SmsAttempt"("outboxId");
CREATE INDEX IF NOT EXISTS "SmsAttempt_result_idx" ON "SmsAttempt"("result");
