-- نشست ۶۰ · خوشه B (بند ۴-۵): کاهش بدهی فاکتور اصلی از مابه‌التفاوت منفی تعویض
ALTER TABLE "SaleReturn" ADD COLUMN "debtReduction" INTEGER NOT NULL DEFAULT 0;
