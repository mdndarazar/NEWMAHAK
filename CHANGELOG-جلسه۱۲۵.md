# نشست ۱۲۵

- S125-1: lookupهای مستقیم `productVariant` در مسیرهای مالی `SalesService` (پاک‌سازی، ثبت/ویرایش برگشت، lookup فاکتور برگشت و تعویض) به helper مشترک با chunkهای ۵۰۰تایی منتقل شدند.
- تست تازه: `fix-s125-sales-product-variant-chunking.mjs`، قبل ۰/۶ و بعد ۶/۰؛ ۵۰۱ قلم کامل ماند.
- رگرسیون نهایی audit: ۸۷ PASS، ۰ FAIL.
- npm، Prisma Client تولیدی، typecheck، Electron، چاپگر واقعی و Excel دسکتاپ در این محیط اجرا نشدند.
