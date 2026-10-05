-- نشست ۸۰ · خوشه A
-- retry امنِ درخواست بازکردن نشست بعد از timeout نباید نشست دوم بسازد.
ALTER TABLE "Shift" ADD COLUMN "openIdempotencyKey" TEXT;
ALTER TABLE "Shift" ADD COLUMN "openIdempotencyFingerprint" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Shift_openIdempotencyKey_key" ON "Shift"("openIdempotencyKey");
