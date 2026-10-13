-- Canonical Shift Settings identity is JSON-backed; this additive snapshot link lets
-- custody history retain the selected template identity without converting or
-- deleting any legacy ShiftPlan/ShiftPlanStaff record.
ALTER TABLE "CustodyShiftMeta" ADD COLUMN "templateId" TEXT;
CREATE INDEX IF NOT EXISTS "CustodyShiftMeta_templateId_idx" ON "CustodyShiftMeta"("templateId");
