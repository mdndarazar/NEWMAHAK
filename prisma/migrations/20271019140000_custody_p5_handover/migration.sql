-- Custody phase 5: authenticated drawer handover. One pending handover for the single main drawer.
CREATE TABLE IF NOT EXISTS "CustodyHandover" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "fromShiftId" INTEGER NOT NULL,
  "fromUserId" INTEGER NOT NULL,
  "selectedRecipientUserId" INTEGER NOT NULL,
  "finalCustodianUserId" INTEGER,
  "acceptedByUserId" INTEGER,
  "managerApproverUserId" INTEGER,
  "resolutionKind" TEXT,
  "resolutionReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "outCountId" INTEGER NOT NULL,
  "expectedAtStart" BIGINT NOT NULL,
  "countedAtStart" BIGINT NOT NULL,
  "differenceCash" BIGINT NOT NULL,
  "ledgerWatermark" TEXT NOT NULL,
  "toShiftId" INTEGER,
  "fenceEpochAtStart" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "stateKey" TEXT NOT NULL DEFAULT 'MAIN',
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 1,
  "operationalDay" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustodyHandover_one_pending"
  ON "CustodyHandover"("stateKey") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "CustodyHandover_fromShift_idx" ON "CustodyHandover"("fromShiftId");
