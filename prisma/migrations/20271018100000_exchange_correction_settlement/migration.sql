-- تعویض ممکن است «پولِ مشتری را پس بدهد»؛ این دو ستون اثر واقعیِ امروز را جدا
-- از مبلغ بازیافتی نگه می‌دارند تا کشوی شیفت و دفتر جبرانی هم‌زمان قابل تطبیق باشند.
ALTER TABLE "ReturnCorrection" ADD COLUMN "cashPaidOut" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "ReturnCorrection" ADD COLUMN "cardPaidOut" BIGINT NOT NULL DEFAULT 0;
