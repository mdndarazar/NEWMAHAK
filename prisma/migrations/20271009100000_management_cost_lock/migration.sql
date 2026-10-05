-- قفل اجرای هم‌زمان دفتر هزینه و فهرست حرکت‌های ناموفق.
-- فقط CREATE TABLE. هیچ ALTER روی جدول موجود نیست.

CREATE TABLE IF NOT EXISTS "CostEngineLock" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "busyAt" DATETIME
);

CREATE TABLE IF NOT EXISTS "CostEngineFailure" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "movementId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CostEngineFailure_movementId_key" ON "CostEngineFailure"("movementId");
