-- ZIP-AUDIT-HIGH-04
-- پرداخت‌ها قبلاً فقط با MAX(seq)+1 شماره می‌گرفتند و کلید retry نداشتند.
-- ابتدا داده‌ی قدیمیِ دارای seq تکراری به‌شکل پایدار (id صعودی) بازشماریِ افزایشی
-- می‌شود، سپس دو invariant دیتابیس برقرار می‌شوند. ردیفِ اول هر شماره دست‌نخورده
-- می‌ماند و فقط نسخه‌های اضافه بعد از بزرگ‌ترین شماره‌ی همان فاکتور قرار می‌گیرند.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "idempotencyFingerprint" TEXT;

WITH ranked AS (
  SELECT
    "id",
    "invoiceId",
    "seq",
    ROW_NUMBER() OVER (PARTITION BY "invoiceId", "seq" ORDER BY "id") AS "duplicateRank",
    MAX("seq") OVER (PARTITION BY "invoiceId") AS "maxSeq"
  FROM "Payment"
), extras AS (
  SELECT
    "id",
    "maxSeq" + ROW_NUMBER() OVER (PARTITION BY "invoiceId" ORDER BY "seq", "id") AS "newSeq"
  FROM ranked
  WHERE "duplicateRank" > 1
)
UPDATE "Payment"
SET "seq" = (SELECT "newSeq" FROM extras WHERE extras."id" = "Payment"."id")
WHERE "id" IN (SELECT "id" FROM extras);

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX "Payment_invoiceId_seq_key" ON "Payment"("invoiceId", "seq");
