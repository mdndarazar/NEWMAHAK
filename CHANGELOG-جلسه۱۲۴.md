# نشست ۱۲۴

- S124-1: گیت موجودی در `InventoryService.checkAvailability` برای lookup واریانت‌ها chunkهای ۵۰۰تایی دارد.
- S124-2: `StoreCreditService.linesForInvoice` همه‌ی اقلام فاکتور را برای enforce محدودیت اعتبار خرید، با lookupهای chunk‌شده می‌خواند.
- S124-3: برداشت خودکار انبار مرکزی در `SecondaryStockService.coverShortage` برای فاکتور پرقلم از `IN` بزرگ عبور نمی‌کند.
- تست تازه: `fix-s124-financial-variant-in-chunking.mjs`، قبل ۰/۷ و بعد ۷/۰.
- رگرسیون نهایی audit: ۸۶ PASS، ۰ FAIL.
- npm، Prisma تولیدی، typecheck، Electron، چاپگر واقعی و Excel دسکتاپ در این محیط اجرا نشدند.
