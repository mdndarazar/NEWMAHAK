-- ثبتِ منبعِ فی جایگزینی، جدا از خودِ مبلغ؛ برابریِ قیمت به‌تنهایی منبع را ثابت نمی‌کند.
-- هیچ FK نداریم تا حذف/ادغام سوابق را نشکند (همان سیاستِ دفتر هزینه).
ALTER TABLE "SaleItemCost" ADD COLUMN "replacementSource" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "SaleItemCost" ADD COLUMN "replacementPurchaseInvoiceId" INTEGER;
CREATE INDEX "SaleItemCost_replacementPurchaseInvoiceId_idx"
    ON "SaleItemCost"("replacementPurchaseInvoiceId");

-- ردیف‌های قدیمی را تا جایی که تاریخ‌ها منبع را روشن می‌کنند backfill می‌کنیم:
-- آخرین فاکتورِ تاییدشده تا تاریخ فاکتور فروش، اگر لاتش موجود است؛ وگرنه آخرین لاتِ خریدِ
-- موجود تا همان لحظه؛ در نبود هر دو، منبع همان کارت کالا است. اگر فاکتور خریدِ دارای لات
-- در همان روز جلالیِ فروش صادر شده باشد، ترتیب واقعیِ «فروش قبل/بعد از خرید» از دادهٔ
-- قدیمی قابل اثبات نیست؛ آن ردیف LEGACY می‌ماند تا با مبلغِ مساوی منبعِ غلط نسازیم.
-- ردیف‌هایی که فاکتور فروششان دیگر وجود ندارد نیز عمداً LEGACY می‌مانند.
WITH candidates AS (
    SELECT
        c."saleItemId" AS saleItemId,
        c."variantId" AS variantId,
        si."issuedAt" AS saleAt,
        si."issuedAtJalali" AS saleJalali,
        (
            SELECT pi."id"
            FROM "PurchaseInvoice" pi
            WHERE pi."status" = 'CONFIRMED'
              AND pi."issuedAtJalali" <= si."issuedAtJalali"
              AND EXISTS (
                  SELECT 1 FROM "PurchaseInvoiceItem" pii
                  WHERE pii."invoiceId" = pi."id" AND pii."variantId" = c."variantId"
              )
            ORDER BY pi."issuedAtJalali" DESC, pi."id" DESC
            LIMIT 1
        ) AS candidateId,
        (
            SELECT pi."issuedAtJalali"
            FROM "PurchaseInvoice" pi
            WHERE pi."status" = 'CONFIRMED'
              AND pi."issuedAtJalali" <= si."issuedAtJalali"
              AND EXISTS (
                  SELECT 1 FROM "PurchaseInvoiceItem" pii
                  WHERE pii."invoiceId" = pi."id" AND pii."variantId" = c."variantId"
              )
            ORDER BY pi."issuedAtJalali" DESC, pi."id" DESC
            LIMIT 1
        ) AS candidateJalali
    FROM "SaleItemCost" c
    JOIN "SaleInvoice" si ON si."id" = c."invoiceId"
    WHERE c."costStatus" <> 'OUTSIDE' AND c."qty" > 0
), resolved AS (
    SELECT
        c.saleItemId,
        CASE
            WHEN c.candidateJalali = c.saleJalali AND EXISTS (
                SELECT 1 FROM "PurchaseLot" pl
                WHERE pl."purchaseInvoiceId" = c.candidateId
                  AND pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
            ) THEN NULL
            WHEN EXISTS (
                SELECT 1 FROM "PurchaseLot" pl
                WHERE pl."purchaseInvoiceId" = c.candidateId
                  AND pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
            ) THEN c.candidateId
            ELSE (
                SELECT pl."purchaseInvoiceId"
                FROM "PurchaseLot" pl
                WHERE pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
                  AND pl."lotDate" <= c.saleAt
                ORDER BY pl."lotDate" DESC, pl."id" DESC
                LIMIT 1
            )
        END AS sourceInvoiceId,
        CASE
            WHEN c.candidateJalali = c.saleJalali AND EXISTS (
                SELECT 1 FROM "PurchaseLot" pl
                WHERE pl."purchaseInvoiceId" = c.candidateId
                  AND pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
            ) THEN 'LEGACY'
            WHEN EXISTS (
                SELECT 1 FROM "PurchaseLot" pl
                WHERE pl."purchaseInvoiceId" = c.candidateId
                  AND pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
            ) THEN 'PURCHASE_INVOICE'
            WHEN EXISTS (
                SELECT 1 FROM "PurchaseLot" pl
                WHERE pl."variantId" = c.variantId
                  AND pl."source" = 'PURCHASE'
                  AND pl."lotDate" <= c.saleAt
            ) THEN CASE
                WHEN (
                    SELECT pl."purchaseInvoiceId"
                    FROM "PurchaseLot" pl
                    WHERE pl."variantId" = c.variantId
                      AND pl."source" = 'PURCHASE'
                      AND pl."lotDate" <= c.saleAt
                    ORDER BY pl."lotDate" DESC, pl."id" DESC
                    LIMIT 1
                ) IS NULL THEN 'NO_INVOICE'
                ELSE 'PURCHASE_INVOICE'
            END
            ELSE 'PRODUCT_CARD'
        END AS sourceKind
    FROM candidates c
)
UPDATE "SaleItemCost"
SET
    "replacementPurchaseInvoiceId" = (SELECT r.sourceInvoiceId FROM resolved r WHERE r.saleItemId = "SaleItemCost"."saleItemId"),
    "replacementSource" = (SELECT r.sourceKind FROM resolved r WHERE r.saleItemId = "SaleItemCost"."saleItemId")
WHERE "saleItemId" IN (SELECT saleItemId FROM resolved);
