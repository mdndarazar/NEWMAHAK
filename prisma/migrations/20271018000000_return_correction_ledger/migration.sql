-- دفتر جبرانی اصلاح/ابطال برگشت: سند/اعتبار/حرکت اصلی هرگز حذف یا بازنویسی نمی‌شود.
-- هر SaleReturn حداکثر یک اصلاح جبرانی نهایی دارد؛ retry دوباره همان درخواست را
-- به جای دوبار کسر موجودی یا دوبار ثبت نقد، رد می‌کند.
CREATE TABLE "ReturnCorrection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'VOID_RECONCILIATION',
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "reason" TEXT NOT NULL,
    "originalUserId" INTEGER,
    "originalShiftId" INTEGER,
    "correctingUserId" INTEGER NOT NULL,
    "correctingShiftId" INTEGER NOT NULL,
    "approvingManagerId" INTEGER,
    "originalDayJalali" TEXT NOT NULL,
    "operationalDayJalali" TEXT NOT NULL,
    "originalSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "reconciliationJson" TEXT NOT NULL DEFAULT '{}',
    "cashRecovered" BIGINT NOT NULL DEFAULT 0,
    "cardRecovered" BIGINT NOT NULL DEFAULT 0,
    "unrecoveredAmount" BIGINT NOT NULL DEFAULT 0,
    "creditOutcome" TEXT NOT NULL DEFAULT 'NONE',
    "creditAffectedAmount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAtJalali" TEXT NOT NULL DEFAULT '',
    "createdAtTime" TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX "ReturnCorrection_returnId_key" ON "ReturnCorrection"("returnId");
CREATE INDEX "ReturnCorrection_createdAt_idx" ON "ReturnCorrection"("createdAt");
CREATE INDEX "ReturnCorrection_createdAtJalali_idx" ON "ReturnCorrection"("createdAtJalali");
CREATE INDEX "ReturnCorrection_correctingShiftId_idx" ON "ReturnCorrection"("correctingShiftId");
CREATE INDEX "ReturnCorrection_approvingManagerId_idx" ON "ReturnCorrection"("approvingManagerId");

CREATE TABLE "ReturnCorrectionEffect" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "correctionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "variantId" INTEGER,
    "cashMovementId" INTEGER,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAtJalali" TEXT NOT NULL DEFAULT '',
    "occurredAtTime" TEXT NOT NULL DEFAULT '',
    "shiftId" INTEGER,
    "userId" INTEGER
);
CREATE INDEX "ReturnCorrectionEffect_correctionId_idx" ON "ReturnCorrectionEffect"("correctionId");
CREATE INDEX "ReturnCorrectionEffect_type_idx" ON "ReturnCorrectionEffect"("type");
CREATE INDEX "ReturnCorrectionEffect_occurredAt_idx" ON "ReturnCorrectionEffect"("occurredAt");
CREATE INDEX "ReturnCorrectionEffect_shiftId_idx" ON "ReturnCorrectionEffect"("shiftId");
