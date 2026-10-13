-- A responsibility segment retains the schedule policy that existed when it opened.
-- Existing history is deliberately NULL and uses the documented legacy fallback.
ALTER TABLE "CustodyShiftMeta" ADD COLUMN "scheduleSnapshotJson" TEXT;
