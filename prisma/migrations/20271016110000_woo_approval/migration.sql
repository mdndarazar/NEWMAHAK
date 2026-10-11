-- Woo stock approval workflow and loop-fuse guard.
-- فقط برای تصمیم‌های موجودی است؛ هیچ فروش/مشتری/قیمت سایت وارد MAHAK نمی‌شود.

CREATE TABLE IF NOT EXISTS "WooApproval" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "linkId" INTEGER,
  "variantId" INTEGER,
  "holderKey" TEXT,
  "sourceType" TEXT,
  "sourceId" INTEGER,
  "reason" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payloadJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  "resolvedBy" INTEGER,
  "resolution" TEXT,
  "resolutionNote" TEXT,
  CONSTRAINT "WooApproval_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "WooProductLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WooApproval_status_created_idx" ON "WooApproval"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WooApproval_link_status_idx" ON "WooApproval"("linkId", "status");
CREATE INDEX IF NOT EXISTS "WooApproval_source_idx" ON "WooApproval"("sourceType", "sourceId", "status");

CREATE INDEX IF NOT EXISTS "WooSyncOutbox_link_created_idx" ON "WooSyncOutbox"("linkId", "createdAt");
