# نشست ۱۳۰ · خوشه J

- ✅ S130-1 · `src/main/print/templates.ts`: `body` قالب گزارش A4 با `box-sizing:border-box` داخل عرض ۲۱۰mm ماند؛ بیرون‌زدگی RTL رفع شد.
- ✅ S130-2 · `src/main/services/xlsx.ts`: `fitToPage`، `fitToHeight="0"` و `_xlnm.Print_Titles` اضافه شد؛ عنوان/سرستون در صفحات چاپ Excel تکرار می‌شود.
- تست A4 Chromium: ۵/۵؛ چهار صفحه A4، بدون overflow، تکرار سرستون، حفظ آخرین فیش و جمع.
- تست xlsx XML: ۴/۴؛ LibreOffice: PDF پنج‌صفحه‌ای A4 landscape با آخرین ردیف و ردیف جمع سالم.
- رگرسیون `tests/audit-fixes/*.mjs`: ۹۶ PASS · ۰ FAIL.
- محدودیت‌های باز: npm/Prisma/typecheck، Electron و چاپگر/Save dialog واقعی، قفل واقعی Excel، migration تاریخی، race چندپردازه‌ای و crash وسط transaction.
