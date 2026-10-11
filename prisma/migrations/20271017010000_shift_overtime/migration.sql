-- نشست ۳۱۰ · فاز ۲ «اضافه‌کاری شیفت شب»
-- سه ستون nullable (داده‌ی موجود NULL می‌ماند؛ بدون backfill — یعنی «اعلام نشده»).
-- طبق قواعد AGENTS.md: migration جدید به‌جای ویرایش migration نصب‌شده.

ALTER TABLE "Shift" ADD COLUMN "overtimeDeclaredAt" DATETIME;
ALTER TABLE "Shift" ADD COLUMN "overtimeUntil" DATETIME;
ALTER TABLE "Shift" ADD COLUMN "overtimeReason" TEXT;
