# دستورالعمل ایجنت‌ها و توسعه‌دهندگان آینده (AGENTS)

این فایل برای هر عامل/توسعه‌دهنده‌ی بعدی است که روی این ریپو کار می‌کند. قبل از هر تغییر، قواعد زیر را بخوان و رعایت کن. تاریخچه‌ی تصمیمات فنی در `DECISIONS.md` است.

## کلیات محصول
نرم‌افزار دسکتاپ POS «مهاک» — Electron + React + Prisma + SQLite. منطق فروش/خرید/موجودی/انبار/حسابداری/صندوق/بدهی‌و‌اعتبار/شیفت/چاپ/SMS/WooCommerce **خراب‌نشدنی** است؛ تغییر فقط داخل مرز همان بخشِ درخواست‌شده.

## قواعد طلایی دیتابیس و migration (رفع باگ تاریخی startup)
1. **migration فقط از مسیر `prisma/migrations/<timestamp>_name/migration.sql`**: فایل migration نصب‌شده (رسیده به مشتری) را هرگز ویرایش نکن؛ برای تغییر جدید، migration جدید بساز. schema.prisma را همساز کن اما هرگز `prisma migrate reset` یا دست‌کاری دستی جدول `_prisma_migrations` را اجرا نکن.
2. اجراکننده‌ی داخل‌برنامه‌ای migration = `src/main/db/migrator.ts`. این runner عمداً:
   - migration را **هرگز خارج از تراکنش** اجرا نمی‌کند.
   - `BEGIN IMMEDIATE` را فقط روی **کلاینت تک‌اتصاله‌ی migration** (URL با `?connection_limit=1` — ساخته‌شده در خود migrator و در `MergeService.clientFor` برای فایل‌های بکاپ) اجرا می‌کند؛ `ROLLBACK` فقط بعد از BEGIN موفق؛ ثبت history فقط قبل از COMMIT.
   - قفل موقت SQLite (`database is locked`/`SQLITE_BUSY`) را با backoff محدود retry می‌کند و خطای SQL واقعی را retry نمی‌کند.
3. **هرگز `BEGIN`/`COMMIT`/`ROLLBACK` خام را روی کلاینت اصلی `prisma` (پول چنداتصاله) اجرا نکن.** این منشأ اصلی خطاهای `database is locked` و `cannot rollback - no transaction is active` در startup بود. برای تراکنش در کد سرویس‌ها فقط از `prisma.$transaction(async (tx) => …)` استفاده کن (به‌همراه retry policy موجود در `tx.ts`).
4. **هر دستوری که سطر برمی‌گرداند (SELECT، PRAGMAهای خروجی‌دار مثل `wal_checkpoint`) فقط با `$queryRawUnsafe` اجرا شود**؛ با `$executeRawUnsafe` خطای `Execute returned results, which is not allowed in SQLite` می‌گیری. `PRAGMA busy_timeout = N` (تنظیم، بدون خروجی) با execute درست است.
5. فایل دیتابیس (`userData/data/shop.db`) را پاک نکن و همیشه قبل از تغییرات دیتابیسی به کاربر بگو از BackupService استفاده کند.
6. خطاهای migration را swallow نکن و خطای قفل را با خطای SQL قاطی نکن؛ پیام‌های فارسی کاربرپسند باید بگویند چه اتفاقی افتاده و چه باید کرد.

## تست و راستی‌آزمایی
- مجموعه تست‌های audit: `node tests/audit-fixes/fix-s300-woo-stock-sync.mjs` (سوییت Woo) و تست‌های جدیدی که کنارشان ساخته می‌شوند — همان الگوی `node tests/audit-fixes/*.mjs` را دنبال کن.
- هنگام نبود `node_modules` در محیط ایجنت، typecheck/build را روی سیستم کاربر (ویندوز) اعلام کن: `npm run dev`، `npm run build`، `npm run dist:win`.
- هر پچ دیتابیسی باید با `git diff --check` تمیز باشد.

## استقرار افزونه‌ی WooCommerce
هر تغییری در `resources/woocommerce/mahak-stock-sync.php` نیازمند بازسازی zip (`resources/woocommerce/mahak-stock-sync.zip`) و یکنواختی محتوا (`unzip -p … | cmp - … .php`) است؛ zip در `.gitignore` است و با `git add -f` اضافه می‌شود.
