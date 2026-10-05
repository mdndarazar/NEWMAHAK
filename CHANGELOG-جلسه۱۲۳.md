# نشست ۱۲۳

- S123-1: lookupهای واریانت و فاکتور در StockAllocationService با chunkهای ۵۰۰تایی کامل شدند؛ preview، apply، خلاصه‌ی رسید/export و dropAllocations دیگر با IN بزرگ crash نمی‌کنند.
- S123-2: PrintService برای رسید فروش و برگشت از helper مشترک chunk واریانت استفاده می‌کند.
- تست تازه: fix-s123-stock-allocation-print-chunking.mjs، قبل ۱/۱۱ و بعد ۱۲/۰.
- رگرسیون نهایی audit: ۸۵ PASS، ۰ FAIL.
- npm، Prisma تولیدی، typecheck، Electron، چاپگر واقعی و Excel دسکتاپ در این محیط اجرا نشدند.
