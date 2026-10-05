-- ممیزی A71-01 — کارمندِ *پاس‌کننده‌ی فعلی* چک روی خود Payment.
--
-- فیلتر «کارمند» گزارش برای پاس‌چک با `history.some(CLEARED, userId)` کار می‌کرد؛
-- چکی که کارمند الف پاس کرده، بعد برگشت خورده و کارمند ب دوباره پاس کرده،
-- در گزارش هر دو کارمند شمرده می‌شد (دوباره‌شماری). ستون تازه فقط پاس فعلی را دارد.
ALTER TABLE "Payment" ADD COLUMN "clearedByUserId" INTEGER;

-- backfill فقط برای چک‌هایی که *الان* پاس‌شده‌اند، از آخرین گذار CLEARED دفتر.
UPDATE "Payment"
SET "clearedByUserId" = (
  SELECT h."userId" FROM "PaymentChequeStatusHistory" h
  WHERE h."paymentId" = "Payment"."id" AND h."status" = 'CLEARED'
  ORDER BY h."id" DESC LIMIT 1
)
WHERE "kind" = 'CHEQUE' AND "chequeStatus" = 'CLEARED';

CREATE INDEX IF NOT EXISTS "Payment_clearedByUserId_idx" ON "Payment"("clearedByUserId");
