-- Custody phase 1: additive staff profile and separate personal custody credentials.
CREATE TABLE IF NOT EXISTS "StaffProfile" (
  "userId" INTEGER NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'STAFF',
  "jobTitle" TEXT,
  "phone" TEXT,
  "employmentStartJalali" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "StaffProfile_one_bootstrap_owner"
  ON "StaffProfile"("kind") WHERE "kind" = 'BOOTSTRAP_OWNER';
CREATE INDEX IF NOT EXISTS "StaffProfile_kind_idx" ON "StaffProfile"("kind");

CREATE TABLE IF NOT EXISTS "CustodyCredential" (
  "userId" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'CUSTODY_PIN',
  "algo" TEXT NOT NULL DEFAULT 'scrypt-v1',
  "salt" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "mustChange" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "setAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "setByUserId" INTEGER,
  "setKind" TEXT NOT NULL DEFAULT 'SELF',
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("userId", "purpose")
);
CREATE INDEX IF NOT EXISTS "CustodyCredential_status_idx" ON "CustodyCredential"("status");
