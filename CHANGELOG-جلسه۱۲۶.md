# نشست ۱۲۶

## S126-1: حذف برش بدهی در accountingReport
- `creditRemaining` دیگر فقط ۵۰٬۰۰۰ فاکتور اول را نمی‌خواند.
- صفحه‌های ۵٬۰۰۰تایی با `id ASC` تا پایان فاکتورهای تسویه‌نشده پردازش می‌شوند.
- تست بازتولید: `fix-s126-credit-remaining-full-range.mjs`، قبل ۰/۳، بعد ۳/۰.

## S126-2: حفاظت از ledger در purge کالا
- حذف فیزیکی فقط بعد از ۷۳۰ روز از `deletedAt` معتبر مجاز است.
- وجود هر `StockMovement` حذف را متوقف می‌کند؛ شمارش داخل تراکنش است.
- `StockMovement` هرگز purge نمی‌شود و مسیر `deleteMany` حذف شد.
- تست بازتولید: `fix-s126-variant-purge-retention-ledger.mjs`، قبل ۰/۷، بعد ۷/۰.

## اعتبارسنجی و محدودیت
- syntax checks و parser ساختاری PASS شدند.
- `npm`/`npx`/Prisma Client تولیدی/typecheck کامل و رگرسیون کامل با runner واقعی در این محیط در دسترس نبودند؛ اجرای خام ۸۹ تست به‌دلیل alias و moduleهای تولیدی کامل نشد و ۸۹/۰ ادعا نمی‌شود.
