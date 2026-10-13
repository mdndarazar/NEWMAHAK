-- Phase 3b: POS operator identity is evidence separate from drawer custody.
-- Existing invoices deliberately remain without a manufactured operator record.
CREATE TABLE "CustodySaleEvidence" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "invoiceId" INTEGER NOT NULL UNIQUE,
  "custodyShiftId" INTEGER NOT NULL,
  "custodianUserId" INTEGER NOT NULL,
  "operatorKind" TEXT NOT NULL,
  "operatorUserId" INTEGER,
  "authMethod" TEXT NOT NULL,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CustodySaleEvidence_shift_at_idx" ON "CustodySaleEvidence"("custodyShiftId", "at");
CREATE INDEX "CustodySaleEvidence_operator_at_idx" ON "CustodySaleEvidence"("operatorUserId", "at");
