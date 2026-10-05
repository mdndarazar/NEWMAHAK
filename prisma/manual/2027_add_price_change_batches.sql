-- ---------------------------------------------------------------------------
-- بند ۴ (نشست پنجم) — سابقه‌ی «تغییر گروهی قیمت» و امکان بازگردانی آن.
--
-- فقط دو جدول *جدید* ساخته می‌شود و هیچ ستونی از جدول‌های موجود عوض نمی‌شود،
-- پس اجرای این migration روی دیتابیس پرِ فروشگاه هیچ ریسکی ندارد و رفتار فعلی
-- برنامه مو‌به‌مو دست‌نخورده می‌ماند.
--
-- بقیه‌ی بندهای این نشست (قفل ماژول‌ها، سیاست تخفیف، فیلتر تکی/عمده، انتقال به
-- انبار فروشگاه) عمداً هیچ تغییری در لایه‌ی داده لازم نداشتند: تنظیمات روی همان
-- جدول ساده‌ی `Setting` می‌نشیند، فیلترها فقط WHERE اند، و انتقال به انبار
-- فروشگاه از همان `StockMovement` موجود استفاده می‌کند.
-- ---------------------------------------------------------------------------

CREATE TABLE "PriceChangeBatch" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "kind" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "target" TEXT NOT NULL DEFAULT 'SALE',
  "scope" TEXT NOT NULL,
  "categoryId" INTEGER,
  "categoryName" TEXT,
  "roundStep" INTEGER NOT NULL DEFAULT 1,
  "minPrice" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL DEFAULT '',
  "note" TEXT,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "deltaTotal" INTEGER NOT NULL DEFAULT 0,
  "userId" INTEGER,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atJalali" TEXT NOT NULL DEFAULT '',
  "atTime" TEXT NOT NULL DEFAULT '',
  "revertedAt" DATETIME,
  "revertedAtJalali" TEXT
);
CREATE INDEX IF NOT EXISTS "PriceChangeBatch_at_idx" ON "PriceChangeBatch"("at");
CREATE INDEX IF NOT EXISTS "PriceChangeBatch_kind_idx" ON "PriceChangeBatch"("kind");
CREATE INDEX IF NOT EXISTS "PriceChangeBatch_revertedAt_idx" ON "PriceChangeBatch"("revertedAt");

CREATE TABLE "PriceChangeItem" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "batchId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "code" TEXT,
  "oldPrice" INTEGER NOT NULL DEFAULT 0,
  "newPrice" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PriceChangeItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceChangeBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PriceChangeItem_batchId_idx" ON "PriceChangeItem"("batchId");
CREATE INDEX IF NOT EXISTS "PriceChangeItem_variantId_idx" ON "PriceChangeItem"("variantId");
