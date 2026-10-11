-- Custody phase 6: unresolved overnight custody is separate from the active drawer state.
CREATE TABLE IF NOT EXISTS "CustodyResolution" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "shiftId" INTEGER NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "nightExpectedCash" BIGINT,
  "nightEvidenceCountId" INTEGER,
  "morningWitnessCountId" INTEGER,
  "provisionalDifference" BIGINT,
  "evidence" TEXT NOT NULL DEFAULT 'NONE',
  "differenceAttribution" TEXT NOT NULL DEFAULT 'PENDING_DECISION',
  "attributedToUserId" INTEGER,
  "decisionByUserId" INTEGER,
  "decisionReason" TEXT,
  "cashSessionId" INTEGER,
  "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "CustodyResolution_status_idx" ON "CustodyResolution"("status", "openedAt");
