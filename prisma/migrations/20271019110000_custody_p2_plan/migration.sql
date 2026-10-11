-- Custody phase 2: independent, unbounded staffing plans. Plans never block sales.
CREATE TABLE IF NOT EXISTS "ShiftPlan" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
  "daysMask" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "reminderRepeatMin" INTEGER NOT NULL DEFAULT 15,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ShiftPlan_active_sort_idx" ON "ShiftPlan"("isActive", "sortOrder", "id");
CREATE TABLE IF NOT EXISTS "ShiftPlanStaff" (
  "planId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  PRIMARY KEY ("planId", "userId")
);
CREATE INDEX IF NOT EXISTS "ShiftPlanStaff_user_idx" ON "ShiftPlanStaff"("userId");
