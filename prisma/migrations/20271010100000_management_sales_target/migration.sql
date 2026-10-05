-- هدف فروش ماهانه گزارش مدیریت. بدون FK به فروش.
CREATE TABLE IF NOT EXISTS "MgmtTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "monthJalali" TEXT NOT NULL,
    "userId" INTEGER NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MgmtTarget_monthJalali_userId_key" ON "MgmtTarget"("monthJalali", "userId");
