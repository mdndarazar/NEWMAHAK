-- Auto-timeout custody: expected values are ledger snapshots, not physical counts.
ALTER TABLE "CustodyResolution" ADD COLUMN "expectedCard" BIGINT;
ALTER TABLE "CustodyResolution" ADD COLUMN "effectiveAt" DATETIME;
ALTER TABLE "CustodyResolution" ADD COLUMN "detectedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "CustodyResolution_evidence_status_idx" ON "CustodyResolution"("evidence", "status");
