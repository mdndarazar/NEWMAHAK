-- MAHAK ↔ WooCommerce stock-only sync (inventory quantity only).
-- افزایشی: فقط جدول‌های همگام‌سازی سایت و indexهای لازم؛ هیچ داده‌ی فروش/مالی لمس نمی‌شود.

CREATE TABLE IF NOT EXISTS "WooProductLink" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "variantId" INTEGER NOT NULL,
  "wooProductId" INTEGER NOT NULL,
  "wooVariationId" INTEGER,
  "holderKey" TEXT NOT NULL,
  "sku" TEXT,
  "remoteName" TEXT,
  "manageStock" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastWooQty" INTEGER NOT NULL DEFAULT 0,
  "lastMahakQty" INTEGER NOT NULL DEFAULT 0,
  "lastPushedMovementId" INTEGER,
  "pauseReason" TEXT,
  "pausedAt" DATETIME,
  "pausedBy" INTEGER,
  "pauseNote" TEXT,
  "pauseSeqFloor" INTEGER,
  "resumedAt" DATETIME,
  "resumedBy" INTEGER,
  "resumeDecision" TEXT,
  "relinkSeqFloor" INTEGER,
  "lastRelinkId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooProductLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WooSyncOutbox" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "linkId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL,
  "movementId" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'STOCK_PUSH',
  "expectedWooQty" INTEGER,
  "targetQty" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" DATETIME,
  CONSTRAINT "WooSyncOutbox_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "WooProductLink" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WooInboundEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventUuid" TEXT NOT NULL,
  "seq" INTEGER,
  "linkId" INTEGER,
  "variantId" INTEGER,
  "holderKey" TEXT NOT NULL,
  "orderId" TEXT,
  "orderItemId" TEXT,
  "oldQty" INTEGER,
  "newQty" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "source" TEXT,
  "requestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "movementId" INTEGER,
  "relinkId" TEXT,
  "payloadJson" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" DATETIME,
  CONSTRAINT "WooInboundEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "WooProductLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WooSyncLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "level" TEXT NOT NULL DEFAULT 'INFO',
  "action" TEXT NOT NULL,
  "linkId" INTEGER,
  "variantId" INTEGER,
  "message" TEXT NOT NULL,
  "payloadJson" TEXT
);

CREATE INDEX IF NOT EXISTS "WooProductLink_variantId_idx" ON "WooProductLink"("variantId");
CREATE INDEX IF NOT EXISTS "WooProductLink_holderKey_idx" ON "WooProductLink"("holderKey");
CREATE INDEX IF NOT EXISTS "WooProductLink_status_idx" ON "WooProductLink"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "WooProductLink_variant_active_unique" ON "WooProductLink"("variantId") WHERE "status" <> 'UNLINKED';
CREATE UNIQUE INDEX IF NOT EXISTS "WooProductLink_holder_active_unique" ON "WooProductLink"("holderKey") WHERE "status" <> 'UNLINKED';

CREATE UNIQUE INDEX IF NOT EXISTS "WooSyncOutbox_idempotency_unique" ON "WooSyncOutbox"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "WooSyncOutbox_status_idx" ON "WooSyncOutbox"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WooSyncOutbox_link_status_idx" ON "WooSyncOutbox"("linkId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "WooInboundEvent_eventUuid_unique" ON "WooInboundEvent"("eventUuid");
CREATE INDEX IF NOT EXISTS "WooInboundEvent_status_idx" ON "WooInboundEvent"("status", "seq");
CREATE INDEX IF NOT EXISTS "WooInboundEvent_link_status_idx" ON "WooInboundEvent"("linkId", "status");
CREATE INDEX IF NOT EXISTS "WooInboundEvent_holder_seq_idx" ON "WooInboundEvent"("holderKey", "seq");

CREATE INDEX IF NOT EXISTS "WooSyncLog_at_idx" ON "WooSyncLog"("at");
CREATE INDEX IF NOT EXISTS "WooSyncLog_link_idx" ON "WooSyncLog"("linkId", "at");

-- قفل Idempotency برای رویداد ورودی سایت: هر رویداد فقط یک StockMovement می‌سازد.
CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_wooInboundEvent_unique" ON "StockMovement"("refType", "refId") WHERE "refType" = 'WooInboundEvent';
