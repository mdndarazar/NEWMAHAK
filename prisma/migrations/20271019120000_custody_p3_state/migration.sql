-- Custody phase 3: one main drawer state, session metadata, counts, and application append-only events.
CREATE TABLE IF NOT EXISTS "CustodyState" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "state" TEXT NOT NULL DEFAULT 'NO_SESSION',
  "activeShiftId" INTEGER,
  "pendingHandoverId" INTEGER,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO "CustodyState" ("key", "state", "epoch", "updatedAt") VALUES ('MAIN', 'NO_SESSION', 0, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS "CustodyShiftMeta" (
  "shiftId" INTEGER NOT NULL PRIMARY KEY,
  "custodianUserId" INTEGER NOT NULL,
  "openAuth" TEXT NOT NULL,
  "openCountId" INTEGER,
  "planId" INTEGER,
  "planTitle" TEXT,
  "scheduledEndAt" DATETIME,
  "rolloverAt" DATETIME NOT NULL,
  "dayCutoverSnapshot" INTEGER NOT NULL DEFAULT 300,
  "operationalDay" TEXT NOT NULL,
  "endKind" TEXT,
  "endedAt" DATETIME,
  "cashSessionId" INTEGER,
  "countStatus" TEXT NOT NULL DEFAULT 'COUNT_PENDING',
  "openEpoch" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "CustodyShiftMeta_custodian_idx" ON "CustodyShiftMeta"("custodianUserId");
CREATE INDEX IF NOT EXISTS "CustodyShiftMeta_end_idx" ON "CustodyShiftMeta"("endKind", "operationalDay");

CREATE TABLE IF NOT EXISTS "CustodyCount" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "shiftId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "countedCash" BIGINT NOT NULL,
  "expectedCash" BIGINT,
  "differenceCash" BIGINT,
  "countedByUserId" INTEGER NOT NULL,
  "authMethod" TEXT NOT NULL,
  "note" TEXT,
  "handoverId" INTEGER,
  "epochAtCount" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operationalDay" TEXT NOT NULL,
  UNIQUE ("shiftId", "kind", "idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "CustodyCount_shift_at_idx" ON "CustodyCount"("shiftId", "at");

CREATE TABLE IF NOT EXISTS "CustodyEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "type" TEXT NOT NULL,
  "shiftId" INTEGER,
  "handoverId" INTEGER,
  "resolutionId" INTEGER,
  "actorUserId" INTEGER,
  "actorKind" TEXT NOT NULL,
  "authMethod" TEXT,
  "managerUserId" INTEGER,
  "epochBefore" INTEGER,
  "epochAfter" INTEGER,
  "payloadJson" TEXT,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operationalDay" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "CustodyEvent_shift_at_idx" ON "CustodyEvent"("shiftId", "at");
CREATE INDEX IF NOT EXISTS "CustodyEvent_type_at_idx" ON "CustodyEvent"("type", "at");
