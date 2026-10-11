-- Custody phase 4: post-count allocation plan. Amounts are immutable application records.
CREATE TABLE IF NOT EXISTS "CustodyDisposition" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "cashSessionId" INTEGER NOT NULL,
  "shiftId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "recipientUserId" INTEGER,
  "destinationLabel" TEXT,
  "trackingNo" TEXT,
  "confirmStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "claimedByUserId" INTEGER,
  "confirmedByUserId" INTEGER,
  "confirmedAt" DATETIME,
  "allocationKey" TEXT NOT NULL,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "countBeforeWithdrawal" TEXT NOT NULL DEFAULT 'COUNT_BEFORE',
  UNIQUE ("cashSessionId", "allocationKey")
);
CREATE INDEX IF NOT EXISTS "CustodyDisposition_session_idx" ON "CustodyDisposition"("cashSessionId");
CREATE INDEX IF NOT EXISTS "CustodyDisposition_status_idx" ON "CustodyDisposition"("confirmStatus");
