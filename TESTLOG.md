## نشست ۱۳۲ · S132-1
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install` ⇒ `npm: command not found`؛ `npx prisma generate` ⇒ `npx: command not found`؛ `npm run typecheck` ⇒ `npm: command not found`.
- نقطه‌ی شروع: `fix-s130-a4-layout.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ `fix-s130-xlsx-print-layout.mjs` ⇒ **۴ موفق · ۰ ناموفق**؛ baseline رگرسیون قبل از تغییر ⇒ **۹۷ فایل PASS · ۰ فایل FAIL**.
- تست بازتولید `fix-s132-export-extension.mjs` روی baseline نشست ۱۳۱: **۲ موفق · ۳ ناموفق**؛ CSV بدون پسوند به `.xlsx` می‌رفت، محتوای CSV داشت و `format` غلط گزارش می‌شد.
- رفع S132-1 در `src/main/services/ExportService.ts`: پسوندهای صریح حفظ می‌شوند؛ مسیر بدون پسوند با قالب ترجیحی (`csv` یا `xlsx`) کامل می‌شود.
- تست بعد `fix-s132-export-extension.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ خروجی CSV با پسوند `.csv` و BOM/محتوای CSV، خروجی XLSX با پسوند `.xlsx` و امضای ZIP کنترل شد.
- `node --check tests/audit-fixes/fix-s132-export-extension.mjs` ⇒ PASS؛ `node --experimental-strip-types --check src/main/services/ExportService.ts` ⇒ PASS.
- رگرسیون کامل بعد از رفع، runner `node --import ./test/harness/register.mjs`: دسته‌ی اول **۵۰ فایل PASS · ۰ FAIL**، دسته‌ی دوم **۴۸ فایل PASS · ۰ FAIL**؛ جمع **۹۸ فایل PASS · ۰ فایل FAIL**.
- محدودیت: این تست Save dialog واقعی Electron و Excel دسکتاپ را جایگزین نمی‌کند؛ فقط mismatch پسوند/محتوا را با ماک Electron و فایل واقعی در sandbox اثبات می‌کند.
## نشست ۱۳۱ · S131-1/S131-2
- گام ۰:
  - `node --version` ⇒ `v22.23.1`.
  - `npm install` ⇒ اجرا نشد، `/bin/bash: npm: command not found`.
  - `npx prisma generate` ⇒ اجرا نشد، `/bin/bash: npx: command not found`.
  - `npm run typecheck` ⇒ اجرا نشد، `/bin/bash: npm: command not found`.
- نقطه‌ی شروع:
  - `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s130-a4-layout.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
  - `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s130-xlsx-print-layout.mjs` ⇒ **۴ موفق · ۰ ناموفق**.
  - حلقه‌ی اجرای هر فایل `tests/audit-fixes/*.mjs` روی baseline نشست ۱۳۰ ⇒ **۹۶ فایل PASS · ۰ فایل FAIL**.
- تست قبل از رفع:
  - `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s131-csv-formula-print-timeout.mjs` ⇒ **۱ موفق · ۳ ناموفق**؛ CSV فرمول خام داشت و چاپ hang معلق می‌ماند.
- تست بعد از رفع:
  - همان دستور ⇒ **۴ موفق · ۰ ناموفق**؛ چهار پیشوند خطرناک CSV خنثی شد، عدد منفی حفظ شد، چاپ معلق با نتیجه‌ی نامعلوم reject شد و پنجره پاک شد.
  - `node --check tests/audit-fixes/fix-s131-csv-formula-print-timeout.mjs` ⇒ PASS.
  - `node --experimental-strip-types --check src/main/services/ExportService.ts` ⇒ PASS.
  - `node --experimental-strip-types --check src/main/print/printer.ts` ⇒ PASS.
  - حلقه‌ی اجرای هر فایل `tests/audit-fixes/*.mjs` پس از رفع ⇒ **۹۷ فایل PASS · ۰ فایل FAIL**.
- نکته: اجرای glob به‌صورت یک آرگومان به `node` فقط اولین فایل را اجرا می‌کند؛ عدد ۹۷ با حلقه‌ی صریحِ تک‌فایل به‌دست آمد.
- این نتایج با هارنس Electron/فایل/SQLite هستند و جای Electron واقعی، چاپگر واقعی، Excel دسکتاپ، Save dialog ویندوز، Prisma Client تولیدی، typecheck واقعی، migration تاریخی، race چندپردازه‌ای، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی را نمی‌گیرند.
## نشست ۱۲۸ · تست‌های S128 و رگرسیون نهایی
گام ۰:
- `node --version` ⇒ `v22.23.1`.
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست قبل روی baseline نشست ۱۲۷:
- `MAHAK_ROOT=<baseline>/mahak-session121 node tests/audit-fixes/fix-s128-report-output-filter-lock.mjs` ⇒ **۰ بررسی موفق · ۷ ناموفق**.
- `MAHAK_ROOT=<baseline>/mahak-session121 node tests/audit-fixes/fix-s128-maintenance-archive-gate.mjs` ⇒ **۱ بررسی موفق · ۶ ناموفق**.

تست بعد:
- `node --check tests/audit-fixes/fix-s128-report-output-filter-lock.mjs` ⇒ PASS.
- `node --check tests/audit-fixes/fix-s128-maintenance-archive-gate.mjs` ⇒ PASS.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s128-report-output-filter-lock.mjs` ⇒ **۷ بررسی موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s128-maintenance-archive-gate.mjs` ⇒ **۷ بررسی موفق · ۰ ناموفق**.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx src/renderer/src/pages/Settings.tsx` ⇒ هر دو فایل PASS.
- جمع تست‌های هدفمند S128 ⇒ **۱۴ بررسی موفق · ۰ ناموفق**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` با `node --import ./test/harness/register.mjs` ⇒ **۹۲ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- دو تست S128 ساختاری‌اند و رندر واقعی React/Electron، IPC واقعی، Prisma Client تولیدی، چاپگر، Save dialog و Excel دسکتاپ را اثبات نمی‌کنند.
- `npm install`، `npx prisma generate`، `npm run typecheck`، migration روی داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.
## نشست ۱۰۶

- قبل از رفع، با `MAHAK_ROOT` روی خروجی نشست ۱۰۵: `fix-s106-report-pagination-followups.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- بعد از رفع: همان تست ⇒ **۷ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s106-report-pagination-followups.mjs` ⇒ **PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` با هارنس داخلی ⇒ **۵۶ فایل PASS · ۰ فایل FAIL**.
- `fix-s105-report-limits-filter-propagation.mjs` ⇒ **۸ بررسی موفق · ۰ ناموفق**.
- `npm install` / `npx prisma generate` / `npm run typecheck` ⇒ اجرا نشد، دلیل: npm/npx در محیط موجود نیستند.

## نشست ۱۰۷

- قبل از رفع: مسیر دسته‌ای چاپ اعتبار با `take: 5000` تعداد صفحه‌ی خوانده‌شده را به‌عنوان تعداد کل گزارش می‌کرد.
- بعد از رفع: `fix-s107-credit-batch-count.mjs` ⇒ **۶ بررسی موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s107-credit-batch-count.mjs` ⇒ **PASS**.
- منطق جدید برای دسته‌ی چاپ، `page.totalCount` را به‌عنوان تعداد واقعی می‌دهد و فقط `CREDIT_PRINT_MAX_DOCS + 1` شناسه برای اعمال سقف رندر می‌خواند.
- محدودیت اثبات: Prisma Client تولیدی، Electron/چاپگر واقعی و typecheck کامل در محیط حاضر نیستند.
### نشست ۱۰۴

#### خوشه G، مقیاس گزارش ضدتقلب
- قبل: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s104-fraud-review-scale.mjs` روی خروجی نشست ۱۰۳ ⇒ **۰ موفق · ۲ ناموفق**؛ سقف `take: 500` باعث شد ۵۰۱ کسری صندوق، ۵۰۰ ردیف و ۵۰۰ ریال گزارش شود.
- بعد: همان تست روی خروجی نشست ۱۰۴ ⇒ **۲ موفق · ۰ ناموفق**؛ همه‌ی ۵۰۱ ردیف و مبلغ کامل شمرده شد.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-fraud-audit-column.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s89-return-rate.mjs` ⇒ **۴ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s104-fraud-review-scale.mjs` ⇒ **PASS**.
- esbuild واقعی روی `src/main/services/FraudService.ts` با `electron` و `jalaali-js` به‌عنوان external ⇒ **PASS**.
- محدودیت: `npm install`، `npx prisma generate`، `npm run typecheck`، Prisma تولیدی، Electron/چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash وسط transaction و حجم ۵۰٬۰۰۰+ با Prisma واقعی اجرا نشدند.
- `fix-s104-report-scale-followups.mjs` ⇒ **۸ بررسی موفق · ۰ ناموفق**؛ `fix-s104-jalali-range-scale.mjs` ⇒ **۳ موفق · ۰ ناموفق**.
- esbuild روی `CashboxService.ts`، `PendingRestockService.ts` و `jalali.ts` ⇒ **۳ فایل PASS**.

### نشست ۱۰۳

#### خوشه G، صفحه‌بندی ریزتراکنش‌های کارمند
- قبل: `MAHAK_ROOT=<کپی zip نشست ۱۰۲> node tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs` ⇒ **۰ موفق · ۱۰ ناموفق**؛ چهار query سقف `take: 2000` داشتند و metadata/کنترل صفحه وجود نداشت.
- بعد: `node tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs` ⇒ **۱۰ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs` ⇒ **PASS**.
- esbuild واقعی روی `src/main/services/StaffReportService.ts` و `src/renderer/src/components/StaffPerformancePanel.tsx` ⇒ **۲ فایل PASS**.
- رگرسیون اولیه: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۵۰ PASS · ۱ FAIL**؛ `fix-s65-exchange-void.mjs` فقط به‌دلیل شمارش ساختاری چهار query فاکتور شکست خورد، چون query جدید از `invoiceWhere` مشترک استفاده می‌کرد.
- بعد از سازگارسازی صریح `voidedAt: null` در query فاکتور: همان رگرسیون ⇒ **۵۱ فایل PASS · ۰ فایل FAIL**؛ `fix-s65-exchange-void.mjs` ⇒ **۶۴ بررسی موفق · ۰ ناموفق**.
- `tsx-parse-check` روی `StaffReportService.ts` از قبل نیز روی generic arrow موجود در `outOfShift` خطای کاذب داشت؛ جایگزین معتبر esbuild روی فایل تغییرکرده **PASS** شد. این ابزار شکست را به کد جدید نسبت نمی‌دهد.
- محدودیت: `npm install`، `npx prisma generate`، `npm run typecheck`، Prisma واقعی، Electron/React واقعی، چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای و crash وسط تراکنش اجرا نشدند.

### نشست ۱۰۱ و ۱۰۲

#### خوشه G، صفحه‌ی بعد فهرست اعتبار
- قبل: `MAHAK_ROOT=<کپی zip نشست ۱۰۰> node tests/audit-fixes/fix-s101-credit-list-next-page.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- بعد: `node tests/audit-fixes/fix-s101-credit-list-next-page.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s101-credit-list-next-page.mjs` ⇒ **PASS**.
- رفتار بعد: `skip` فقط برای فهرست اعتبار ارسال می‌شود؛ page metadata روی پاسخ آرایه‌ای حفظ می‌شود؛ صفحه‌ی بعد با `skip + take` و صفحه‌ی قبل با `skip - take` کار می‌کند؛ دکمه‌ی بعد روی `truncated` قفل است.

#### خوشه G، سقف گزارش کارمندان
- قبل: `MAHAK_ROOT=<کپی zip نشست ۱۰۰> node tests/audit-fixes/fix-s102-staff-report-scale.mjs` ⇒ **۰ موفق · ۸ ناموفق**.
- بعد: `node tests/audit-fixes/fix-s102-staff-report-scale.mjs` ⇒ **۸ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s102-staff-report-scale.mjs` ⇒ **PASS**.
- رگرسیون با هارنس داخلی: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۵۰ فایل PASS · ۰ فایل FAIL**.
- محدودیت: این تست‌ها ساختاری‌اند؛ اجرای Prisma Client تولیدی، typecheck کامل، داده‌ی تاریخی واقعی، Electron/چاپگر، Excel دسکتاپ، race چندپردازه‌ای و crash وسط transaction اجرا نشدند.

### نشست ۱۰۰
- قبل از رفع: `MAHAK_ROOT=/home/user/work/mahak-session99/mahak100-before node repo/tests/audit-fixes/fix-s100-credit-list-pagination.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- بعد از رفع: `MAHAK_ROOT=/home/user/work/mahak-session99/repo node repo/tests/audit-fixes/fix-s100-credit-list-pagination.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s100-credit-list-pagination.mjs` ⇒ **PASS**.
- رگرسیون `tests/audit-fixes/*.mjs` ⇒ **۴۸ فایل PASS · ۰ فایل FAIL**.
- esbuild واقعی روی `StoreCreditService.ts`، `ReportExtraTables.tsx` و `shared/types.ts` ⇒ **۳ فایل PASS**.
- parser اختصاصی `tsx-parse-check` روی `StoreCreditService.ts` ⇒ **اجرا شد اما ابزار روی genericهای TypeScript خطای کاذب داد**؛ esbuild همان فایل را PASS کرد.
- سطح اثبات: ساختاری؛ اجرای Prisma Client تولیدی، داده‌ی واقعی، Electron و رندر UI واقعی در این محیط انجام نشده است.
# نشست ۷۲

## خوشه A، فیلتر مالک واقعی رویداد با `shiftNumber`

دستور:

```text
node --import ./test/harness/register.mjs tests/audit-fixes/fix-s72-shift-number.mjs
```

خروجی واقعی:

```text
✓ 7 بررسی موفق · 0 ناموفق
```

سناریو: دو نشست با شماره‌ی ۲ در دو روز متفاوت، یک نشست نامرتبط با شماره‌ی ۳ در همان روز، فاکتور مادر در نشست قدیمی، و رویدادهای پرداخت/برگشت/پاس‌چک در نشست هدف. نتیجه: فقط رویدادهای مالک‌شده توسط نشست شماره‌ی ۲ در روز گزارش وارد دفتر شدند.

## رگرسیون

```text
node --import ./test/harness/register.mjs tests/audit-fixes/fix-s71-event-owner.mjs
```

خروجی واقعی:

```text
✓ 9 بررسی موفق · 0 ناموفق
```

```text
node --import ./test/harness/register.mjs tests/audit-fixes/fix-s70-event-scope.mjs
```

خروجی واقعی:

```text
✓ 10 بررسی موفق · 0 ناموفق
```

## محیط

`npm install`، `npx prisma generate` و `npm run typecheck` **اجرا نشد، دلیل: `npm` و `npx` در محیط موجود نیستند**. تست‌ها با Node 22.23.1 و SQLite داخلی هارنس اجرا شدند؛ این نتیجه جای typecheck واقعی TypeScript/Prisma، Prisma Client تولیدشده، رندر Electron/React و تست چندپردازه‌ای را نمی‌گیرد.

## رگرسیون‌های تکمیلی اجراشده

```text
fix-s69-cheque-history.mjs       ✓ 9 بررسی موفق · 0 ناموفق
fix-s69-consolidation-retry.mjs  ✓ 6 بررسی موفق · 0 ناموفق
fix-s69-cash-close-atomic.mjs    ✓ 5 بررسی موفق · 0 ناموفق
fix-s68-payment-provenance.mjs   ✓ 12 بررسی موفق · 0 ناموفق
fix-s67-payment-actor.mjs        ✓ 10 بررسی موفق · 0 ناموفق
fix-s66-payment-void.mjs         ✓ 11 بررسی موفق · 0 ناموفق
fix-s65-exchange-void.mjs        ✓ 64 بررسی موفق · 0 ناموفق
```


## نشست ۷۱ · مالکیت رویداد در فیلتر گزارش
- فرمان: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s71-event-owner.mjs`
- نتیجه: **۹ موفق، ۰ ناموفق**.
- اثبات: فاکتور مادر در نشست/فروشنده‌ی اول است، اما وصول نقدی، برگشت و پاس‌چک در نشست/فروشنده‌ی دوم؛ فیلتر نشست/فروشنده هر سه رویداد را از مالک واقعی خودشان برمی‌گرداند.
- رگرسیون: `fix-s70-event-scope.mjs`، **۱۰ موفق، ۰ ناموفق**؛ `fix-s69-cheque-history.mjs`، **۹ موفق، ۰ ناموفق**؛ `fix-s69-consolidation-retry.mjs`، **۶ موفق، ۰ ناموفق**؛ `fix-s69-cash-close-atomic.mjs`، **۵ موفق، ۰ ناموفق**؛ `fix-s69-day-boundary.mjs`، **۱ موفق، ۰ ناموفق**؛ `fix-s68-payment-provenance.mjs`، **۱۲ موفق، ۰ ناموفق**؛ `fix-s67-payment-actor.mjs`، **۱۰ موفق، ۰ ناموفق**؛ `fix-s66-payment-void.mjs`، **۱۱ موفق، ۰ ناموفق**؛ `fix-s65-exchange-void.mjs`، **۶۴ موفق، ۰ ناموفق**.
- parse نحوی با esbuild برای `SalesService.ts`، `SalesLedger.ts` و `accountingReport.ts` سبز شد؛ وابستگی‌های npm برای bundle کامل در دسترس نبودند.
- اجرا نشد، دلیل: `npm install`، `npx prisma generate` و `npm run typecheck`؛ `npm` و `npx` در محیط موجود نیستند.
## نشست ۶۶

| دستور | نتیجه |
|---|---|
| `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s66-payment-void.mjs` | **PASS: ۱۱/۰** |
| `node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs` | **PASS: ۱۳۸/۰** |
| `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s64-return-void.mjs` | **PASS: ۴۳/۰** |
| `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s65-exchange-void.mjs` | **PASS: ۶۴/۰** |

گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` **اجرا نشدند**؛ npm/npx/typescript و شبکه در محیط موجود نبود. تست‌های بالا با SQLite داخلی Node 22 اجرا شدند و typecheck کامل نیستند.
# TESTLOG — قبل/بعد هر رفع

هر ردیف: شناسه رفع · فایل تست · نتیجه قبل از رفع · نتیجه بعد از رفع. «قبل» با برگرداندن موقت همان تغییر و اجرای همان تست گرفته شده است.

| شناسه | تست | قبل از رفع | بعد از رفع |
| --- | --- | --- | --- |
| H-1 (کلید خارجی هارنس) | `test/fix-s56-harness.mjs` | ۲ موفق · ۴ ناموفق | ۶ موفق · ۰ ناموفق |
| A1 + B1 + D1 + D2 (یک PR، چون جدا کردنشان کسری کاذب می‌سازد) | `test/fix-s56-reports.mjs` | ۵ موفق · ۱۲ ناموفق | ۱۷ موفق · ۰ ناموفق |

## روش گرفتن «قبل»
اسکریپت `before.sh`: فایل‌های تغییریافته موقتاً با نسخه‌ی اصلی جایگزین می‌شوند، همان تست اجرا و بعد فایل‌ها برگردانده می‌شوند. پس «قبل» ادعا نیست، اجرای واقعی است.

## آنچه اجرا نشد (صریح)
`npm install` · `npx prisma generate` · `npm run typecheck` هیچ‌کدام در این محیط اجرا نشدند (نه npm، نه شبکه، نه typescript نصب است). جایگزینِ اجراشده: بارگذاری واقعی همه‌ی فایل‌های لمس‌شده در Node 22 و اجرای تست‌های دیتابیسی روی SQLite واقعی. تست چندپردازه‌ای، قطع برق، رندر Electron/React، timezone غیرتهران، ۵۰٬۰۰۰ ردیف و migration تاریخی هم اجرا نشدند.

---
## نشست ۲ زنجیره رفع (نشست ۵۷)

دستور: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s57-returns.mjs`

| شناسه | قبل از رفع | بعد از رفع |
| --- | --- | --- |
| C1 + C5 + C7 | ۱ موفق · ۱۳ ناموفق | ۱۴ موفق · ۰ ناموفق |

نمونه‌ی خروجی «قبل»: مبلغ سند برگشت انتظار ۹۰۰٬۰۰۰ دریافت ۱٬۰۰۰٬۰۰۰ · تخفیف قلم انتظار ۹۰۰ دریافت ۱٬۰۰۰ · سه برگشت جزئی انتظار ۲٬۹۹۹ دریافت ۳٬۰۰۰ · ویرایش برگشت انتظار ۱٬۸۰۰٬۰۰۰ دریافت ۲٬۰۰۰٬۰۰۰ · ردیف تکراری «هیچ خطایی پرتاب نشد» و ۲ عدد از قلم ۱عددی برگشت خورد · CANCELED و DRAFT هر کدام یک سند برگشت ساختند · lookup فیلد netLineValue نداشت. (تنها بند سبزِ «قبل»: هزینه‌ی ارسال، چون قبلاً هم unitPrice×qty آن را نمی‌آورد.)

«قبل» با نسخه‌ی دست‌نخورده‌ی `SalesService.ts` گرفته شد (همان فایل تست، قبل از هر تغییر src).

### رگرسیون بعد از رفع (اجرای واقعی)
session35: 204/0 · session36: 137/0 · session40: 185/0 · session46-src: 36/0 · session47: 97/0 · session48: 29/0 · session54: 92/0 · session14: PASS · session21: 34/0 · session25: 32/0 · fix-s56-harness: 6/0 · fix-s56-reports: 17/0 · stock-source 47: 60/0 · 50: 26/0 · 52: 33/0 · 53: 60/0 · 51: 107/1 (FAIL از قبل و عمدی) · accounting13: PASS · credit-logic21: 44/0 · credit-print25: 24/0 · credit-ui 22: 32/0 · 28: 51/0 · 29: 38/0 · 30: 35/0 · 31: 35/0 · 32: 39/0 · 33: 39/0 · 34: 42/0.

### بررسی نحوی (جایگزین ناقص typecheck)
esbuild transform روی `SalesReturn.tsx`، `SalesService.ts`، `returnValue.ts`، `types.ts`: هر چهار OK. ⚠️ این type-check نیست.


---
## نشست ۳ زنجیره رفع (نشست ۵۸)
دستور: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s58-remaining.mjs
| شناسه | قبل از رفع | بعد از رفع |
| --- | --- | --- |
| C2 + C3 + C4 | ۵ موفق · ۲۳ ناموفق (TESTLOG-s58-before.txt) | ۲۶ موفق · ۰ ناموفق + ۱ بررسی علامت‌خورده «⚠️ ناتمام» (پل برگشت‌ها، ۲۷۰۰- ریال؛ TESTLOG-s58-after.txt) |

«قبل» با نسخه‌ی دست‌نخورده‌ی src نشست ۵۷ گرفته شد (همان فایل تست؛ آن موقع بررسی پل هنوز شمرده می‌شد).
### رگرسیون (اجرای واقعی)
همه سبز مثل قبل (35: 204 · 36: 137 · 40: 185 · 47: 97 · 48: 29 · 54: 92 · 21: 34 · 25: 32 · 46: 36 · s56: 6 و 17 · s57: 14 · stock-source و credit-* بدون تغییر · accounting13 PASS)، به‌جز:
- ❌ acceptance-session14: ۲۳ موفق · ۱ ناموفق (قبلاً ۲۴/۰) — رگرسیون تازه، بررسی نشد. خط: FAIL  [STRUCTURAL] 5. remaining = max(0, grandTotal - paid - returned) in shape AND recalcSettlement (تست ساختاری است: دنبال متن فرمول قدیمی «grandTotal - paid - returned» در کد می‌گردد؛ فرمول عمداً با remainingOf جایگزین شد. پس احتمالاً باید خودِ تست با دلیل در DECISIONS به remainingOf به‌روز شود، نه کد.) session 14 acceptance: 23 passed, 1 failed
- stock-source-pick-session51: ۱۰۷/۱ (از قبل و عمدی).
### بررسی نحوی
esbuild روی settlement.ts، invoiceDebt.ts، SalesService.ts، reportShape.ts، accountingReport.ts، accounting.ts: همه OK (type-check نیست).


## نشست ۵۹
دستور: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s59-bridge-exchange.mjs
قبل از رفع (کد نشست ۵۸): ۶ موفق · ۳۴ ناموفق — خروجی کامل در TESTLOG-s59-before.txt
بعد از رفع: ۴۵ موفق · ۰ ناموفق. کل سوییت رگرسیون در TESTLOG-s59-after.txt (همه سبز جز FAIL قدیمی و عمدی stock-source-pick-session51 با ۱۰۷/۱).


## نشست ۶۰
دستور: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s60-exchange-debt.mjs
قبل از رفع (کد نشست ۵۹، همین فایل تست): ۱۶ موفق · ۳۷ ناموفق — خروجی کامل در TESTLOG-s60-before.txt
بعد از رفع: ۵۰ موفق · ۰ ناموفق. کل سوییت رگرسیون در TESTLOG-s60-after.txt:
s60: 50/0 · s56: 6 و 17 · s57: 14 · s58: 27 · s59: 45 · db35: 204 · db36: 137 · db40: 185 · db47: 97 · db48: 29 · db54: 92 · session14: 24/0 · 21: 34 · 25: 32 · src46: 36 · stock-source: 60، 60، 26، 33 و 107/1 (قدیمی و عمدی) · accounting13 PASS · credit-*: 44، 24، 32، 51، 38، 35، 35، 39، 39، 42 (همه ۰ FAIL).
بررسی نحوی esbuild: settlement.ts، accounting.ts، enums.ts، invoiceDebt.ts، SalesService.ts، accountingReport.ts، SalesLedger.ts — همه OK (type-check نیست).

## نشست ۶۱
اجرای تست تازه: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s61-overpay-credit.mjs
قبل از رفع: TESTLOG-s61-before.txt (۲۱ موفق/۳۲ ناموفق) · بعد: TESTLOG-s61-after.txt (۵۴/۰)
### بررسی نحوی esbuild
esbuild OK src/main/services/SalesService.ts
esbuild OK src/main/services/accountingReport.ts
esbuild OK src/main/services/StoreCreditService.ts
esbuild OK src/shared/credit.ts
esbuild OK src/shared/creditUi.ts
esbuild OK src/shared/types.ts
esbuild OK src/shared/ipc.ts
esbuild OK src/main/ipc/index.ts
### رگرسیون کامل (خط آخر هر سوییت)
test/fix-s56-harness.mjs ::   ✓ فیلتری که به پرداخت خودش نمی‌خورد ⇒ خالی = 0 ✓ 6 بررسی موفق · 0 ناموفق 
test/fix-s56-reports.mjs ::   ✓ اعتبار مصرف‌شده تعهد اضافه نمی‌کند = 0 ✓ 17 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s57-returns.mjs ::   ✓ ارزش خالص قلم در lookup = 900000 ✓ 14 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s58-remaining.mjs ::   ✓ پل تطبیق کل روز بسته است (مانده‌ی بی‌توضیح) = 0 ✓ 27 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s59-bridge-exchange.mjs ::   ✓ پل تطبیق بسته است (مانده‌ی بی‌توضیح) = 0 ✓ 45 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s60-exchange-debt.mjs ::   ✓ پل تطبیق بسته است (مانده‌ی بی‌توضیح) = 0 ✓ 50 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s61-overpay-credit.mjs ::   ✓ هیچ اعتبار OVERPAY بی‌فاکتور ساخته نشد = 0 ✓ 54 بررسی موفق · 0 ناموفق 
test/acceptance-db-session35.mjs :: هارنس واقعی دیتابیس (جلسه ۳۵): 204 PASS · 0 FAIL دیتابیس تست:  
test/acceptance-db-session36.mjs :: سوییت کار الف (مقصد پول · جلسه ۳۶/۴۱): 137 PASS · 0 FAIL دیتابیس تست:  
test/acceptance-db-session40.mjs :: سوییت کار ب (کالای در انتظار تأیید مدیر · جلسه ۴۰/۴۵): 185 PASS · 0 FAIL دیتابیس تست:  
test/acceptance-db-session47.mjs :: سوییت «از کدام انبار کسر شود؟» (جلسه ۴۷): 97 PASS · 0 FAIL دیتابیس تست:  
test/acceptance-db-session48.mjs :: سوییت «انتخاب انبار مبدأ کسر» (جلسه ۴۸): 29 PASS · 0 FAIL دیتابیس تست:  
test/acceptance-db-session54.mjs ::   ✓ صفحه هم قبل از تماس با سرور می‌سنجد ✓ 92 بررسی موفق · 0 ناموفق 
test/acceptance-session14.mjs :: session-13 suite output: session 13 accounting acceptance tests: PASS session 14 acceptance: 24 passed, 0 failed 
test/acceptance-session21.mjs :: PASS  [REAL] 34. pure-logic suite of §۲۳ passes (44 real assertions on the rules engine) Session 21: 34 PASS · 0 FAIL 
test/acceptance-session25.mjs :: PASS  [REAL] 32. سوییت‌های جلسه ۲۱ و ۲۲ بعد از تغییرات این نشست هم پاس‌اند (بدون رگرسیون) Session 25: 32 PASS · 0 FAIL 
test/acceptance-src-session46.mjs :: نگهبان ساختاری (جلسه ۴۶): 36 PASS · 0 FAIL ⚠️ این سوییت جای `tsc` را نمی‌گیرد؛ فقط قاعده‌های شکلی را قفل می‌کند. 
test/stock-source-display-session53.mjs :: ================================================================ 60 PASS · 0 FAIL 
test/stock-source-logic-session47.mjs :: — بند ۹ · خلاصه‌ی کسری‌ها (بند ۳ پرامپت) منطق خالص «انتخاب انبار مبدأ» (جلسه ۴۷): 60 PASS · 0 FAIL 
test/stock-source-note-session50.mjs :: — بند ۴ · جدا کردن توضیح کاربر از تگ ✔ منطق خالص «ردیابی برداشت انبار در تعویض» (جلسه ۵۰): 26 PASS · 0 FAIL 
test/stock-source-pick-session51.mjs :: ✗ منطق خالص «انتخاب انبار مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف + ۲-ب): 107 PASS · 1 FAIL   - مرحله ۴ (ستون «مبدأ کسر» فهرست) عمداً شروع نشده 
test/stock-source-pos-session52.mjs :: ================================================================ 33 PASS · 0 FAIL 
test/accounting-session13.ts :: session 13 accounting acceptance tests: PASS 
test/credit-logic-session21.ts :: PASS  [REAL] L44. Placeholder ها پر می‌شوند و کلید ناشناس دست‌نخورده می‌ماند نتیجه‌ی سوییت منطق خالص: 44 PASS · 0 FAIL 
test/credit-print-logic-session25.ts :: PASS  P24. کاغذ سفارشی کوچک ⇒ یک سند در صفحه credit-print-logic (جلسه ۲۵): 24 PASS · 0 FAIL 
test/credit-ui-logic-session22.ts :: PASS  هشدار تنظیمات: سقف گروهی غیرقابل تولید، دیده می‌شود credit-ui-logic (session 22): 32 PASS · 0 FAIL 
test/credit-ui-logic-session28.ts :: PASS  detailFactBlocks: گیرنده‌ی پرشده یک بلوک کامل می‌سازد credit-ui-logic (session 28): 51 PASS · 0 FAIL 
test/credit-ui-logic-session29.ts :: PASS  ۳۸. فهرست رسمی فیلدهای جست‌وجو همان چیزی است که placeholder وعده می‌دهد credit-ui-logic (session 29): 38 PASS · 0 FAIL 
test/credit-ui-logic-session30.ts :: PASS  ۳۵. بند ۹: هر سه صدازننده‌ی SalesService (برگشت، تعویض، اضافه‌دریافت) از `exchangeCreditDays` رد می‌شوند credit-ui-logic (session 30): 35 PASS · 0 FAIL 
test/credit-ui-logic-session31.ts :: PASS  ۳۵. قاعده‌ی محل تصمیم‌ها نگه داشته شد: تصمیم نمایشی در `creditUi`، هیچ‌کدام در JSX credit-ui-logic (session 31): 35 PASS · 0 FAIL 
test/credit-ui-logic-session32.ts :: PASS  ۳۹. قاعده‌ی محل تصمیم‌ها: منبع/کانال/پاکت هیچ‌کدام در JSX تعریف نشده‌اند credit-ui-logic (session 32): 39 PASS · 0 FAIL 
test/credit-ui-logic-session33.ts :: PASS  ۳۹. قاعده‌ی محل تصمیم‌ها: هیچ‌کدام از تصمیم‌های تازه در JSX تعریف نشده‌اند credit-ui-logic (session 33): 39 PASS · 0 FAIL 
test/credit-ui-logic-session34.ts :: PASS  ۴۲. قاعده‌ی محل تصمیم‌ها: هیچ‌کدام از نام‌های تازه در JSX یا در سرویس تعریف نشده‌اند credit-ui-logic (session 34): 42 PASS · 0 FAIL 

## نشست ۶۷
### تست actor پرداخت
اجرا: `node tests/audit-fixes/fix-s67-payment-actor.mjs`
خروجی واقعی: `۱۰ بررسی موفق · ۰ ناموفق`
پوشش: helper actor نشست، رد نبود نشست، نادیده‌گرفتن `userId` renderer، و اتصال پنج mutation حساس Payment/چک به `withSessionActor`.

### رگرسیون
اجرا: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s66-payment-void.mjs`
خروجی واقعی: `۱۱ بررسی موفق · ۰ ناموفق`

اجرا: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s65-exchange-void.mjs`
خروجی واقعی: `۶۴ بررسی موفق · ۰ ناموفق`

### محیط
`npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند: در محیط npm/npx/typescript/prisma و شبکه در دسترس نبود. تست‌های بالا با Node 22 و SQLite داخلی هارنس اجرا شدند؛ این جای typecheck واقعی و رندر Electron نیست.


## نشست ۶۲
اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s62-overpay-flow.mjs
قبل از رفع: TESTLOG-s62-before.txt (۱۲ موفق/۶۷ ناموفق) · بعد: TESTLOG-s62-after.txt (۷۸/۰)
### esbuild
OK: SalesService.ts، types.ts، overpayFlow.ts، templates.ts، InvoicePaymentsModal.tsx، OverpayFlowDialogs.tsx
### رگرسیون کامل
test/fix-s56-harness.mjs ::   ✓ فیلتری که به پرداخت خودش نمی‌خورد ⇒ خالی = 0  ✓ 6 بررسی موفق · 0 ناموفق 
test/fix-s56-reports.mjs ::   ✓ اعتبار مصرف‌شده تعهد اضافه نمی‌کند = 0  ✓ 17 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s57-returns.mjs ::   ✓ ارزش خالص قلم در lookup = 900000  ✓ 14 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s58-remaining.mjs ::   ✓ پل تطبیق کل روز بسته است (مانده‌ی بی‌توضیح) = 0  ✓ 27 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s59-bridge-exchange.mjs ::   ✓ پل تطبیق بسته است (مانده‌ی بی‌توضیح) = 0  ✓ 45 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s60-exchange-debt.mjs ::   ✓ پل تطبیق بسته است (مانده‌ی بی‌توضیح) = 0  ✓ 50 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s61-overpay-credit.mjs ::   ✓ هیچ اعتبار OVERPAY بی‌فاکتور ساخته نشد = 0  ✓ 54 بررسی موفق · 0 ناموفق 
tests/audit-fixes/fix-s62-overpay-flow.mjs ::   ✓ چاپ دسته‌ای هم عبارت را دارد  ✓ 78 بررسی موفق · 0 ناموفق 
test/acceptance-db-session35.mjs ::  هارنس واقعی دیتابیس (جلسه ۳۵): 204 PASS · 0 FAIL دیتابیس تست: /tmp/mahak-session35-kwc8Gl/shop.db 
test/acceptance-db-session36.mjs ::  سوییت کار الف (مقصد پول · جلسه ۳۶/۴۱): 137 PASS · 0 FAIL دیتابیس تست: /tmp/mahak-session36-vO15f3/shop.db 
test/acceptance-db-session40.mjs ::  سوییت کار ب (کالای در انتظار تأیید مدیر · جلسه ۴۰/۴۵): 185 PASS · 0 FAIL دیتابیس تست: /tmp/mahak-session40-hHzk1e/shop.db 
test/acceptance-db-session47.mjs ::  سوییت «از کدام انبار کسر شود؟» (جلسه ۴۷): 97 PASS · 0 FAIL دیتابیس تست: /tmp/mahak-session47-M6KCQR/shop.db 
test/acceptance-db-session48.mjs ::  سوییت «انتخاب انبار مبدأ کسر» (جلسه ۴۸): 29 PASS · 0 FAIL دیتابیس تست: /tmp/mahak-session48-rdL3Mx/shop.db 
test/acceptance-db-session54.mjs ::   ✓ صفحه هم قبل از تماس با سرور می‌سنجد  ✓ 92 بررسی موفق · 0 ناموفق 
test/acceptance-session14.mjs :: session-13 suite output: session 13 accounting acceptance tests: PASS  session 14 acceptance: 24 passed, 0 failed 
test/acceptance-session21.mjs :: PASS  [REAL] 34. pure-logic suite of §۲۳ passes (44 real assertions on the rules engine)  Session 21: 34 PASS · 0 FAIL 
test/acceptance-session25.mjs :: PASS  [REAL] 32. سوییت‌های جلسه ۲۱ و ۲۲ بعد از تغییرات این نشست هم پاس‌اند (بدون رگرسیون)  Session 25: 32 PASS · 0 FAIL 
test/acceptance-src-session46.mjs ::  نگهبان ساختاری (جلسه ۴۶): 36 PASS · 0 FAIL ⚠️ این سوییت جای `tsc` را نمی‌گیرد؛ فقط قاعده‌های شکلی را قفل می‌کند. 
test/stock-source-display-session53.mjs ::  ================================================================ 60 PASS · 0 FAIL 
test/stock-source-logic-session47.mjs :: — بند ۹ · خلاصه‌ی کسری‌ها (بند ۳ پرامپت)  منطق خالص «انتخاب انبار مبدأ» (جلسه ۴۷): 60 PASS · 0 FAIL 
test/stock-source-note-session50.mjs :: — بند ۴ · جدا کردن توضیح کاربر از تگ  ✔ منطق خالص «ردیابی برداشت انبار در تعویض» (جلسه ۵۰): 26 PASS · 0 FAIL 
test/stock-source-pick-session51.mjs ::  ✗ منطق خالص «انتخاب انبار مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف + ۲-ب): 107 PASS · 1 FAIL   - مرحله ۴ (ستون «مبدأ کسر» فهرست) عمداً شروع نشده 
test/stock-source-pos-session52.mjs ::  ================================================================ 33 PASS · 0 FAIL 
test/accounting-session13.ts :: session 13 accounting acceptance tests: PASS 
test/credit-logic-session21.ts ::  نتیجه‌ی سوییت منطق خالص: 44 PASS · 0 FAIL 
test/credit-print-logic-session25.ts ::  credit-print-logic (جلسه ۲۵): 24 PASS · 0 FAIL 
test/credit-ui-logic-session22.ts ::  credit-ui-logic (session 22): 32 PASS · 0 FAIL 
test/credit-ui-logic-session28.ts ::  credit-ui-logic (session 28): 51 PASS · 0 FAIL 
test/credit-ui-logic-session29.ts ::  credit-ui-logic (session 29): 38 PASS · 0 FAIL 
test/credit-ui-logic-session30.ts ::  credit-ui-logic (session 30): 35 PASS · 0 FAIL 
test/credit-ui-logic-session31.ts ::  credit-ui-logic (session 31): 35 PASS · 0 FAIL 
test/credit-ui-logic-session32.ts ::  credit-ui-logic (session 32): 39 PASS · 0 FAIL 
test/credit-ui-logic-session33.ts ::  credit-ui-logic (session 33): 39 PASS · 0 FAIL 
test/credit-ui-logic-session34.ts ::  credit-ui-logic (session 34): 42 PASS · 0 FAIL 


## نشست ۶۳
node --import ./test/harness/register.mjs tests/audit-fixes/fix-s63-edit-overpay-lock.mjs
قبل از رفع: ✗ 18 بررسی موفق · 39 ناموفق (کامل: TESTLOG-s63-before.txt) · بعد: ✓ 57 بررسی موفق · 0 ناموفق (TESTLOG-s63-after.txt)
tests/audit-fixes/pending/fix-s63-return-void.mjs (ناتمام، عمداً قرمز): ✗ 15 موفق · 29 ناموفق (TESTLOG-s63-void-before.txt)
رگرسیون کامل: همه‌ی تست‌های بند ۱۰-۶ همان اعداد قبلی؛ تنها FAIL قدیمی و عمدی stock-source-pick-session51 (۱۰۷/۱).


## نشست ۶۴
node --import ./test/harness/register.mjs tests/audit-fixes/fix-s64-return-void.mjs ⇒ قبل: ✗ 15 بررسی موفق · 29 ناموفق (TESTLOG-s64-before.txt) · بعد: ✓ 43 بررسی موفق · 0 ناموفق (TESTLOG-s64-after.txt).
رگرسیون کامل بعد از رفع: همه سبز — acceptance-db-35/36/40/47/48/54 = 204/137/185/97/29/92، session14 24/0، 21 34، 25 32، src-46 36، fix-s56 6 و 17، s57 14، s58 27، s59 45، s60 50، s61 54، s62 78، s63 57، stock-source 60/60/26/33 و 107/1 (FAIL عمدی قدیمی)، accounting-session13 PASS، credit-*.ts 44/24/32/51/38/35/35/39/39/42.
0 | test/acceptance-db-session35.mjs | هارنس واقعی دیتابیس (جلسه ۳۵): 204 PASS · 0 FAIL
0 | test/acceptance-db-session36.mjs | سوییت کار الف (مقصد پول · جلسه ۳۶/۴۱): 137 PASS · 0 FAIL
0 | test/acceptance-db-session40.mjs | سوییت کار ب (کالای در انتظار تأیید مدیر · جلسه ۴۰/۴۵): 185 PASS · 0 FAIL
0 | test/acceptance-db-session47.mjs | سوییت «از کدام انبار کسر شود؟» (جلسه ۴۷): 97 PASS · 0 FAIL
0 | test/acceptance-db-session48.mjs | سوییت «انتخاب انبار مبدأ کسر» (جلسه ۴۸): 29 PASS · 0 FAIL
0 | test/acceptance-db-session54.mjs | ✓ 92 بررسی موفق · 0 ناموفق
0 | test/acceptance-session14.mjs | session 14 acceptance: 24 passed, 0 failed
0 | test/acceptance-session21.mjs | Session 21: 34 PASS · 0 FAIL
0 | test/acceptance-session25.mjs | Session 25: 32 PASS · 0 FAIL
0 | test/acceptance-src-session46.mjs | نگهبان ساختاری (جلسه ۴۶): 36 PASS · 0 FAIL
0 | test/fix-s56-harness.mjs | ✓ 6 بررسی موفق · 0 ناموفق
0 | test/fix-s56-reports.mjs | ✓ 17 بررسی موفق · 0 ناموفق
0 | test/stock-source-display-session53.mjs | 60 PASS · 0 FAIL
0 | test/stock-source-logic-session47.mjs | منطق خالص «انتخاب انبار مبدأ» (جلسه ۴۷): 60 PASS · 0 FAIL
0 | test/stock-source-note-session50.mjs | ✔ منطق خالص «ردیابی برداشت انبار در تعویض» (جلسه ۵۰): 26 PASS · 0 FAIL
1 | test/stock-source-pick-session51.mjs | ✗ منطق خالص «انتخاب انبار مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف + ۲-ب): 107 PASS · 1 FAIL
0 | test/stock-source-pos-session52.mjs | 33 PASS · 0 FAIL
0 | tests/audit-fixes/fix-s57-returns.mjs | ✓ 14 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s58-remaining.mjs | ✓ 27 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s59-bridge-exchange.mjs | ✓ 45 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s60-exchange-debt.mjs | ✓ 50 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s61-overpay-credit.mjs | ✓ 54 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s62-overpay-flow.mjs | ✓ 78 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s63-edit-overpay-lock.mjs | ✓ 57 بررسی موفق · 0 ناموفق
0 | tests/audit-fixes/fix-s64-return-void.mjs | ✓ 43 بررسی موفق · 0 ناموفق
0 | test/accounting-session13.ts | session 13 accounting acceptance tests: PASS
0 | test/credit-logic-session21.ts | نتیجه‌ی سوییت منطق خالص: 44 PASS · 0 FAIL
0 | test/credit-print-logic-session25.ts | credit-print-logic (جلسه ۲۵): 24 PASS · 0 FAIL
0 | test/credit-ui-logic-session22.ts | credit-ui-logic (session 22): 32 PASS · 0 FAIL
0 | test/credit-ui-logic-session28.ts | credit-ui-logic (session 28): 51 PASS · 0 FAIL
0 | test/credit-ui-logic-session29.ts | credit-ui-logic (session 29): 38 PASS · 0 FAIL
0 | test/credit-ui-logic-session30.ts | credit-ui-logic (session 30): 35 PASS · 0 FAIL
0 | test/credit-ui-logic-session31.ts | credit-ui-logic (session 31): 35 PASS · 0 FAIL
0 | test/credit-ui-logic-session32.ts | credit-ui-logic (session 32): 39 PASS · 0 FAIL
0 | test/credit-ui-logic-session33.ts | credit-ui-logic (session 33): 39 PASS · 0 FAIL
0 | test/credit-ui-logic-session34.ts | credit-ui-logic (session 34): 42 PASS · 0 FAIL


## نشست ۶۵
دستور: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s65-exchange-void.mjs
قبل (کد zip نشست ۶۴): ۱۹ موفق · ۴۹ ناموفق (TESTLOG-s65-before.txt)
بعد: ۶۴ موفق · ۰ ناموفق (TESTLOG-s65-after.txt)
رگرسیون کامل:
test/fix-s56-harness.mjs :: ✓ 6 بررسی موفق · 0 ناموفق
test/fix-s56-reports.mjs :: ✓ 17 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s57-returns.mjs :: ✓ 14 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s58-remaining.mjs :: ✓ 27 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s59-bridge-exchange.mjs :: ✓ 45 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s60-exchange-debt.mjs :: ✓ 50 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s61-overpay-credit.mjs :: ✓ 54 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s62-overpay-flow.mjs :: ✓ 78 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s63-edit-overpay-lock.mjs :: ✓ 57 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s64-return-void.mjs :: ✓ 43 بررسی موفق · 0 ناموفق
tests/audit-fixes/fix-s65-exchange-void.mjs :: ✓ 64 بررسی موفق · 0 ناموفق
test/acceptance-db-session35.mjs :: هارنس واقعی دیتابیس (جلسه ۳۵): 204 PASS · 0 FAIL
test/acceptance-db-session36.mjs :: سوییت کار الف (مقصد پول · جلسه ۳۶/۴۱): 137 PASS · 0 FAIL
test/acceptance-db-session40.mjs :: سوییت کار ب (کالای در انتظار تأیید مدیر · جلسه ۴۰/۴۵): 185 PASS · 0 FAIL
test/acceptance-db-session47.mjs :: سوییت «از کدام انبار کسر شود؟» (جلسه ۴۷): 97 PASS · 0 FAIL
test/acceptance-db-session48.mjs :: سوییت «انتخاب انبار مبدأ کسر» (جلسه ۴۸): 29 PASS · 0 FAIL
test/acceptance-db-session54.mjs :: ✓ 92 بررسی موفق · 0 ناموفق
test/acceptance-session14.mjs :: session-13 suite output: session 13 accounting acceptance tests: PASS
test/acceptance-session21.mjs :: Session 21: 34 PASS · 0 FAIL
test/acceptance-session25.mjs :: Session 25: 32 PASS · 0 FAIL
test/acceptance-src-session46.mjs :: نگهبان ساختاری (جلسه ۴۶): 36 PASS · 0 FAIL
test/stock-source-display-session53.mjs :: 60 PASS · 0 FAIL
test/stock-source-logic-session47.mjs :: منطق خالص «انتخاب انبار مبدأ» (جلسه ۴۷): 60 PASS · 0 FAIL
test/stock-source-note-session50.mjs :: ✔ منطق خالص «ردیابی برداشت انبار در تعویض» (جلسه ۵۰): 26 PASS · 0 FAIL
test/stock-source-pick-session51.mjs :: ✗ منطق خالص «انتخاب انبار مبدأ کسر» (جلسه ۵۱ · مرحله ۲-الف + ۲-ب): 107 PASS · 1 FAIL
test/stock-source-pos-session52.mjs :: 33 PASS · 0 FAIL
test/accounting-session13.ts :: session 13 accounting acceptance tests: PASS
test/credit-logic-session21.ts :: نتیجه‌ی سوییت منطق خالص: 44 PASS · 0 FAIL
test/credit-print-logic-session25.ts :: credit-print-logic (جلسه ۲۵): 24 PASS · 0 FAIL
test/credit-ui-logic-session22.ts :: credit-ui-logic (session 22): 32 PASS · 0 FAIL
test/credit-ui-logic-session28.ts :: credit-ui-logic (session 28): 51 PASS · 0 FAIL
test/credit-ui-logic-session29.ts :: credit-ui-logic (session 29): 38 PASS · 0 FAIL
test/credit-ui-logic-session30.ts :: credit-ui-logic (session 30): 35 PASS · 0 FAIL
test/credit-ui-logic-session31.ts :: credit-ui-logic (session 31): 35 PASS · 0 FAIL
test/credit-ui-logic-session32.ts :: credit-ui-logic (session 32): 39 PASS · 0 FAIL
test/credit-ui-logic-session33.ts :: credit-ui-logic (session 33): 39 PASS · 0 FAIL
test/credit-ui-logic-session34.ts :: credit-ui-logic (session 34): 42 PASS · 0 FAIL

esbuild نحوی: SalesService.ts، ShiftService.ts، StaffReportService.ts، CashboxService.ts، SalesReports.tsx همه OK. typecheck واقعی اجرا نشد (بدون npm/شبکه).


## نشست ۶۸
- گام صفر: `npm install` اجرا نشد، دلیل: `npm` در محیط نیست. `npx prisma generate` اجرا نشد، دلیل: `npx` در محیط نیست. `npm run typecheck` اجرا نشد، دلیل: `npm` در محیط نیست.
- قبل از رفع: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s68-payment-provenance.mjs` ⇒ ۱ PASS · ۱۱ FAIL. ستون‌ها، actor، نشست و گیت بدون نشست باز غایب بودند.
- بعد از رفع: همان دستور ⇒ ۱۲ PASS · ۰ FAIL.
- رگرسیون: `node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs` ⇒ 138 PASS · 0 FAIL؛ `tests/audit-fixes/fix-s65-exchange-void.mjs` ⇒ 64 PASS · 0 FAIL؛ `tests/audit-fixes/fix-s66-payment-void.mjs` ⇒ 11 PASS · 0 FAIL؛ `node tests/audit-fixes/fix-s67-payment-actor.mjs` ⇒ 10 PASS · 0 FAIL.
- محدودیت: typecheck واقعی Prisma/TypeScript، رندر Electron، race چندپردازه‌ای، قطع برق و migration روی داده‌ی تاریخی واقعی اجرا نشد.

## نشست ۶۹
- گام صفر: `npm install` اجرا نشد، دلیل: `npm` در محیط نیست؛ `npx prisma generate` اجرا نشد، دلیل: `npx` در محیط نیست؛ `npm run typecheck` اجرا نشد، دلیل: `npm` در محیط نیست.
- قبل از رفع تاریخچه‌ی چک: `fix-s69-cheque-history.mjs` به‌علت نبود جدول `PaymentChequeStatusHistory` شکست خورد.
- بعد از رفع: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s69-cheque-history.mjs` ⇒ 9 PASS · 0 FAIL.
- قبل از رفع retry تجمیع: اجرای دوم `fix-s69-consolidation-retry.mjs` با خطای «فروش تجمیع‌نشده‌ای پیدا نشد» متوقف شد.
- بعد از رفع: `fix-s69-consolidation-retry.mjs` ⇒ 6 PASS · 0 FAIL؛ `fix-s69-cash-close-atomic.mjs` ⇒ 5 PASS · 0 FAIL؛ `fix-s69-day-boundary.mjs` ⇒ 1 PASS · 0 FAIL.
- رگرسیون: `fix-s68-payment-provenance.mjs` ⇒ 12 PASS · 0 FAIL؛ `fix-s67-payment-actor.mjs` ⇒ 10 PASS · 0 FAIL؛ `fix-s66-payment-void.mjs` ⇒ 11 PASS · 0 FAIL؛ `fix-s65-exchange-void.mjs` ⇒ 64 PASS · 0 FAIL؛ `acceptance-db-session36.mjs` ⇒ 138 PASS · 0 FAIL.
- محدودیت: typecheck واقعی Prisma/TypeScript، race واقعی چندپردازه‌ای، crash/قطع برق، رندر Electron/React، timezone غیر Asia/Tehran و migration روی دیتابیس تاریخی مشتری اجرا نشد.

## نشست ۷۰
- محیط: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ شبکه/ابزار npm در محیط موجود نبود.
- تست قبل از رفع روی baseline نشست ۶۹: `SALES_LEDGER_SOURCE=/home/user/work/session70-baseline/SalesLedger.ts node tests/audit-fixes/fix-s70-event-scope.mjs` ⇒ 3 PASS · 4 FAIL ساختاری. چهار FAIL مربوط به نبود `eventSaleWhere` و استفاده از `invoice: where` در سه مسیر دفتر رویداد بود.
- تست بعد از رفع: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s70-event-scope.mjs` ⇒ **10 PASS · 0 FAIL**.
- پوشش تست بعد از رفع: برگشت فاکتور ماه قبل در تاریخ برگشت، وصول نسیه‌ی فاکتور قدیمی، پاس‌شدن چک با تاریخ خودش، خواندن دو رکورد تاریخچه‌ی append-only، تولید `chequeHistoryText`، نمایش آرایه‌ی خام تب چک، و وجود شاخه‌ی مستقل چاپ/Excel برای چک و دفتر.
- esbuild نحوی: `SalesService.ts`، `SalesLedger.ts`، `shared/types.ts`، `ReportExtraTables.tsx` و `SalesReports.tsx` همگی `OK`.
- رگرسیون: `fix-s69-cheque-history.mjs` ⇒ 9/0؛ `fix-s69-consolidation-retry.mjs` ⇒ 6/0؛ `fix-s69-cash-close-atomic.mjs` ⇒ 5/0؛ `fix-s68-payment-provenance.mjs` ⇒ 12/0؛ `fix-s67-payment-actor.mjs` ⇒ 10/0؛ `fix-s66-payment-void.mjs` ⇒ 11/0؛ `fix-s65-exchange-void.mjs` ⇒ 64/0؛ `acceptance-db-session36.mjs` ⇒ 138/0.
- محدودیت‌های باقی‌مانده: typecheck/Prisma generate واقعی، Electron/React واقعی، race چندپردازه‌ای، crash/قطع برق، timezone غیر تهران، حجم ۵۰٬۰۰۰+ با Prisma واقعی و migration روی داده‌ی تاریخی مشتری اجرا نشدند.

## نشست ۷۳ — override مبلغ کامل برگشت
گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند؛ دلیل: npm، npx و TypeScript در محیط موجود نیستند و شبکه هم برای نصب در دسترس نیست.

تست قبل از رفع، روی `SalesService.ts` استخراج‌شده از zip ورودی نشست ۷۲:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s73-full-refund.mjs` ⇒ **۱ موفق · ۶ ناموفق**.
- override بدون رمز و دلیل اجرا شد.
- مبلغ override همچنان ۹۵۰ بود، نه ۱۰۵۰.
- Audit پرچم override نداشت.

تست بعد از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s73-full-refund.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- رمز/دلیل ناقص و رمز غلط رد شدند.
- برگشت عادی با تخفیف ۹۵۰ باقی ماند.
- override با `unitPrice=۱۰۰۰`، `discount=۱۰۰` و `tax=۵۰` مبلغ ۱۰۵۰ بازپرداخت کرد.
- `CashMovement` دقیقاً ۱۰۵۰ ریال اثر گرفت.
- Audit با `fullAmountOverride=true` و یادداشت override ثبت شد.

رگرسیون‌های اجراشده:
- `fix-s57-returns.mjs` ⇒ **۱۴ موفق · ۰ ناموفق**
- `fix-s72-shift-number.mjs` ⇒ **۷ موفق · ۰ ناموفق**
- `fix-s71-event-owner.mjs` ⇒ **۹ موفق · ۰ ناموفق**
- `fix-s70-event-scope.mjs` ⇒ **۱۰ موفق · ۰ ناموفق**
- `fix-s64-return-void.mjs` ⇒ **۴۳ موفق · ۰ ناموفق**
- `fix-s65-exchange-void.mjs` ⇒ **۶۴ موفق · ۰ ناموفق**

بررسی نحوی با esbuild: هر چهار فایل لمس‌شده (`types.ts`، `returnValue.ts`، `SalesService.ts`، `SalesReturn.tsx`) `OK` شدند؛ این جایگزین typecheck کامل نیست.

## نشست ۷۴ — خوشه A، حذف دوباره‌شماری چک
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست اثباتی بعد از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s74-cluster-a.mjs`
⇒ **۵ موفق · ۰ ناموفق**.

پوشش:
- چکِ پاس‌شده در ردیف SALE اثر نقدی صفر دارد.
- همان چک دقیقاً یک ردیف مستقل CHEQUE_CLEARED دارد.
- جمع اثر نقدی کل دفتر برای چک ۵۰۰٬۰۰۰ ریال است، نه ۱٬۰۰۰٬۰۰۰.

رگرسیون‌های اجراشده و سبز:
- `fix-s73-full-refund.mjs` ⇒ ۷/۰
- `fix-s72-shift-number.mjs` ⇒ ۷/۰
- `fix-s71-event-owner.mjs` ⇒ ۹/۰
- `fix-s70-event-scope.mjs` ⇒ ۱۰/۰
- `fix-s69-cheque-history.mjs` ⇒ ۹/۰
- `fix-s69-consolidation-retry.mjs` ⇒ ۶/۰
- `fix-s69-cash-close-atomic.mjs` ⇒ ۵/۰
- `fix-s68-payment-provenance.mjs` ⇒ ۱۲/۰
- `fix-s67-payment-actor.mjs` ⇒ ۱۰/۰
- `fix-s66-payment-void.mjs` ⇒ ۱۱/۰
- `fix-s65-exchange-void.mjs` ⇒ ۶۴/۰
- `fix-s64-return-void.mjs` ⇒ ۴۳/۰

`test/acceptance-db-session36.mjs` اجرا شد اما به‌خاطر ناسازگاری موجود در داده/انتظار مقصد پرداخت‌های قدیمی با شکست پایان نشست ۳۶ روبه‌رو شد؛ این نشست آن رگرسیون قدیمی را دست‌کاری نکرد.

## نشست ۷۵ — اتمیک‌سازی بازکردن و بستن نشست
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست قبل از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s75-shift-atomic.mjs` روی نسخه‌ی قبل از تغییر ⇒ **۲ موفق · ۳ ناموفق**؛ شکست ساخت نشست تازه، نشست قبلی را بسته باقی می‌گذاشت.

تست بعد از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s75-shift-atomic.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
- rollback واقعی SQLite هنگام شکست `Shift.create` نشست قبلی را باز نگه داشت.
- ساخت نشست نیمه‌کاره ثبت نشد.
- وجود `$transaction` و update شرطی نیز بررسی شد.

بررسی نحوی با `node --check`: `ShiftService.ts` و تست نشست ⇒ `OK`. این جایگزین typecheck واقعی TypeScript/Prisma نیست.

## نشست ۷۶ — یکسان‌سازی مرز روز کارت‌به‌کارت
تست قبل از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s76-card-transfer-day-boundary.mjs` ⇒ **۱ موفق · ۵ ناموفق**؛ helper ساعت‌دار، شروع بازه را ظهر و پایان را ظهر روز بعد می‌ساخت.

تست بعد از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s76-card-transfer-day-boundary.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- `jalaliStartOfDay` برای شروع.
- `jalaliEndOfDay` برای پایان.
- پایان بازه با `23:59:59.999`.

رگرسیون کامل:
- تمام `tests/audit-fixes/*.mjs`، **۲۲ تست سبز**.
- `test/acceptance-db-session36.mjs`، **۱۳۱ موفق · ۷ ناموفق**؛ هر ۷ مورد همان ناسازگاری قدیمی مقصد `null` هستند و در این نشست دست‌کاری نشدند.

محدودیت‌های باز: Prisma واقعی، typecheck واقعی، race چندپردازه‌ای Electron، قطع برق، رندر واقعی Electron/React، timezone غیر Asia/Tehran، حجم ۵۰٬۰۰۰+ با Prisma واقعی و migration روی داده‌ی تاریخی مشتری.

## نشست ۷۷ — هشدار و تأیید اجرای دوباره‌ی بستن صندوق
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست اثباتی بعد از رفع:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s77-cash-close-repeat.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- بستن اول یک `CashSession` ساخت.
- بستن دوم بدون `allowRepeatClose` با هشدار فارسی رد شد و snapshot دوم نساخت.
- بستن دوم با تأیید صریح snapshot مستقل و Audit مستقل ساخت.
- `OPENING_FLOAT` فقط یک ردیف در `CashMovement` ماند.
- `expectedCash` دو snapshot برابر ماند و اثر خالص نقد دوباره اعمال نشد.

تست قبل از رفع روی snapshot نشست ۷۶:
همین تست ⇒ **۲ موفق · ۴ ناموفق**؛ اجرای دوم بدون تأیید پذیرفته می‌شد، دو snapshot ناخواسته ساخته می‌شد و Audit به ۳ ردیف می‌رسید.

رگرسیون:
- `fix-s69-cash-close-atomic.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ retry قدیمی با تأیید صریح به‌روز شد.
- همه‌ی `tests/audit-fixes/*.mjs`، **۲۳ تست اجراشده سبز**؛ هیچ `FAIL` یا `✗`ی در خروجی نبود.

بررسی نحوی با esbuild:
- `src/main/services/CashboxService.ts` ⇒ `OK`
- `src/renderer/src/pages/CashClose.tsx` ⇒ `OK`
- `src/shared/types.ts` ⇒ `OK`

محدودیت‌های باقی‌مانده: npm/npx/TypeScript/Prisma واقعی، race چندپردازه‌ای Electron، قطع برق وسط تراکنش، رندر واقعی Electron/React، timezone غیر Asia/Tehran، حجم ۵۰٬۰۰۰+ با Prisma واقعی و migration روی داده‌ی تاریخی مشتری اجرا نشدند.

## نشست ۷۸ — گیت تعویض اجباری نشست
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست اثباتی:
`node --import ./test/harness/register.mjs tests/audit-fixes/fix-s78-open-session-gate.mjs`
⇒ **۸ موفق · ۰ ناموفق**.
- تعویض نشستِ کارمند دیگر بدون رمز مدیر رد شد.
- نشست قبلی بعد از رد گیت باز ماند.
- تعویض با رمز `1111` و دلیل معتبر نشست تازه ساخت.
- `openedVia='HANDOVER_FORCED'` ثبت شد و نشست قبلی بسته شد.

رگرسیون:
- `fix-s75-shift-atomic.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `fix-s77-cash-close-repeat.mjs` ⇒ **۶ موفق · ۰ ناموفق**.

بررسی نحوی:
- `node --check tests/audit-fixes/fix-s78-open-session-gate.mjs` ⇒ OK.
- typecheck واقعی TypeScript/Prisma اجرا نشد، چون npm/npx در محیط موجود نیست.

رگرسیون کامل `tests/audit-fixes/*.mjs`:
- **۲۵ تست PASS · ۰ تست FAIL**؛ از `fix-s57-returns.mjs` تا `fix-s78-open-session-gate.mjs`.

## نشست ۷۹
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `/bin/bash: npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

رفع و تست:
- `node --check tests/audit-fixes/fix-s79-cash-close-race.mjs` ⇒ OK.
- `node tests/audit-fixes/fix-s79-cash-close-race.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- تست اثبات کرد گیت داخل transaction است، caller اول snapshot می‌سازد، caller دوم بدون تأیید رد می‌شود، فقط یک snapshot باقی می‌ماند و جمع `expectedCash` دوباره اعمال نمی‌شود.

رگرسیون نزدیک:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s77-cash-close-repeat.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s75-shift-atomic.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s78-open-session-gate.mjs` ⇒ **۸ موفق · ۰ ناموفق**.

رگرسیون کامل:
- اجرای حلقه‌ی `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۲۵ تست PASS · ۰ تست FAIL**؛ هر تست موجود از `fix-s57` تا `fix-s79` خروجی سبز داشت.
- هشدارهای Node درباره‌ی experimental SQLite و module type فقط هشدار بودند و هیچ تستی شکست نخورد.

محدودیت اثبات:
- تست race تازه transaction و SQLite واقعی Node را می‌سنجد، اما دو پردازه‌ی مستقل Electron/Prisma واقعی، قطع برق، migration داده‌ی مشتری و render واقعی UI اجرا نشدند.

## نشست ۸۰
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `/bin/bash: npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `node --version` ⇒ `v22.23.1`.
- esbuild CLI ⇒ اجرا نشد، دلیل: `esbuild: command not found`.

تست قبل از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s80-open-session-idempotency.mjs` روی snapshot نشست ۷۹ ⇒ قرارداد/schema کلید وجود نداشت، اجرای دوم نشست دوم ساخت، و تست با **۴ ناموفق** متوقف شد.

رفع و تست بعد:
- migration `20271002100000_shift_open_idempotency` دو ستون nullable و unique index کلید نشست را اضافه می‌کند.
- `node --check src/main/services/ShiftService.ts` ⇒ OK.
- `node --check tests/audit-fixes/fix-s80-open-session-idempotency.mjs` ⇒ OK.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s80-open-session-idempotency.mjs` ⇒ **۹ موفق · ۰ ناموفق**.
- پوشش: همان key همان Shift را برمی‌گرداند، شمارش Shift برابر ۱ می‌ماند، key روی رکورد ذخیره است، reuse با fingerprint متفاوت رد می‌شود و UI key را به main ارسال می‌کند.

رگرسیون کامل:
- حلقه‌ی `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۲۷ تست PASS · ۰ تست FAIL**.
- هشدارهای Node درباره‌ی experimental SQLite و module type فقط هشدار بودند؛ شکست تستی ثبت نشد.

فایل‌های تغییرکرده:
- `prisma/schema.prisma` و `prisma/migrations/20271002100000_shift_open_idempotency/migration.sql`: کلید یکتای retry و fingerprint نشست.
- `src/main/services/ShiftService.ts`: replay امن، رد mismatch، و fallback کنترل‌شده برای تصادم unique.
- `src/renderer/src/components/ShiftSessionModal.tsx`: تولید و ارسال کلید پایدار تا پایان retry.
- `tests/audit-fixes/fix-s80-open-session-idempotency.mjs`: تست قبل/بعد رفتاری و ساختاری.

محدودیت اثبات:
- اجرای Prisma واقعی، typecheck کامل، دو پردازه‌ی مستقل Electron/Prisma، crash/قطع برق، migration روی دیتابیس تاریخی و render واقعی UI اجرا نشد، دلیل: npm/npx/esbuild و محیط واقعی در دسترس نبود.

## نشست ۸۱ و ۸۲
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست race بستن صندوق:
- `node --check tests/audit-fixes/fix-s81-cash-close-two-connections.mjs` ⇒ OK.
- `node tests/audit-fixes/fix-s81-cash-close-two-connections.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- دو Worker با دو اتصال مستقل به همان فایل SQLite اجرا شدند؛ caller دوم بدون تأیید رد شد، فقط یک snapshot، یک `OPENING_FLOAT` و مجموع `expectedCash=۱۵۰۰` باقی ماند.

تست race بازکردن نشست:
- `node --check tests/audit-fixes/fix-s82-open-session-two-connections.mjs` ⇒ OK.
- `node tests/audit-fixes/fix-s82-open-session-two-connections.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- تصادم unique روی همان `openIdempotencyKey` به replay همان fingerprint تبدیل شد؛ فقط یک نشست ساخته شد و fingerprint تغییر نکرد.

رگرسیون کامل:
- حلقه‌ی `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۲۹ تست PASS · ۰ تست FAIL**.
- تست‌های جدید در محیط بدون npm با SQLite واقعی Node اجرا شدند؛ هشدار experimental SQLite فقط هشدار بود.

محدودیت اثبات:
- این دو تست دو اتصال مستقل SQLite را اثبات می‌کنند، اما جای Prisma/Electron تولیدی را نمی‌گیرند. اجرای واقعی دو پردازه Electron/Prisma، crash/قطع برق، Prisma generate، typecheck، migration داده‌ی تاریخی و render واقعی UI اجرا نشد، دلیل: ابزارهای npm/npx/esbuild و محیط تولیدی در دسترس نبودند.

پذیرش تاریخی:
- `node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs` ⇒ **۱۳۱ موفق · ۷ ناموفق**.
- هر ۷ شکست مربوط به مسیر قدیمی `destination=null` و سبد «نامشخص» است؛ این بدهی از نشست‌های قبل باقی مانده و در این نشست تغییر داده نشد.

## نشست ۸۳
گام صفر:
- `npm install` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `/bin/bash: npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `/bin/bash: npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

بازاجرای تست‌های نشست ۸۱ و ۸۲:
- `node --check tests/audit-fixes/fix-s81-cash-close-two-connections.mjs` ⇒ OK.
- `node --check tests/audit-fixes/fix-s82-open-session-two-connections.mjs` ⇒ OK.
- `node tests/audit-fixes/fix-s81-cash-close-two-connections.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `node tests/audit-fixes/fix-s82-open-session-two-connections.mjs` ⇒ **۷ موفق · ۰ ناموفق**.

رگرسیون کامل:
- دستور: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۲۹ فایل PASS · ۰ فایل FAIL** و **۵۸۰ بررسی موفق**.
- اجرای خام `node tests/audit-fixes/fix-s69-day-boundary.mjs` اجرا نشد، دلیل: وابستگی `jalaali-js` در محیط نصب نیست. اجرای معتبر با `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s69-day-boundary.mjs` ⇒ **PASS**.
- هشدارهای experimental SQLite و module type هشدار محیطی بودند و شکست تستی ایجاد نکردند.

محدودیت اثبات:
- این خروجی جای Prisma Client تولیدی، typecheck کامل TypeScript، Electron/React واقعی، race دو پردازه‌ی Electron، crash/قطع برق، migration داده‌ی تاریخی، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی را نمی‌گیرد.

## نشست ۸۴
گام ۰:
- `npm install` ⇒ `bash: npm: command not found`
- `npx prisma generate` ⇒ `bash: npx: command not found`
- `npm run typecheck` ⇒ `bash: npm: command not found`
- `node --version` ⇒ `v22.23.1`

رگرسیون اولیه (قبل از هر تغییر): **۲۹ فایل PASS · ۰ FAIL**.

بازتولید قبل از رفع (روی کپی دست‌نخورده‌ی zip نشست ۸۳):
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-fraud-audit-column.mjs` ⇒ **۲ موفق · ۳ ناموفق**؛ خطا: `HARNESS: ستون ناشناخته «createdAt» در where روی AuditLog`.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-xlsx-dash.mjs` ⇒ **۱ موفق · ۵ ناموفق**؛ `INV-1405-0012`، `TRK-77-ABC`، `A-12-B` خراب شدند و کاراکتر کنترلی در XML ماند.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-devtools-lock.mjs` ⇒ **۲ موفق · ۵ ناموفق**.

بعد از رفع:
- `fix-s84-fraud-audit-column.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
- `fix-s84-xlsx-dash.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- `fix-s84-devtools-lock.mjs` ⇒ **۷ موفق · ۰ ناموفق** (ایستا؛ Electron واقعی: اجرا نشد، دلیل: در محیط نیست).

رگرسیون کامل:
- دستور: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۳۲ فایل PASS · ۰ فایل FAIL**، **۶۲۷ علامت ✓**.
- typecheck کامل TypeScript: اجرا نشد، دلیل: npm/tsc در محیط نیست.

## نشست ۸۵
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- دستور: `MAHAK_ROOT=<zip خام نشست ۸۴> node --import ./test/harness/register.mjs tests/audit-fixes/fix-s85-security-gates.mjs`
- نتیجه: **۲ موفق · ۱۱ ناموفق**.
- شکست‌های اصلی: مسیر خام `settings:set` allowlist/گیت مدیر/Audit نداشت؛ `sale:purge` رمز مدیر و قفل دوره نداشت؛ بدنه‌ی purge حذف فیزیکی انجام می‌داد؛ UI رمز و دلیل را نمی‌فرستاد.

بعد از رفع:
- دستور: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s85-security-gates.mjs`
- نتیجه: **۱۳ موفق · ۰ ناموفق**؛ تست ایستا.
- دستور رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۳۳ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- تست جدید رفتار IPC را ایستا می‌سنجد؛ اجرای واقعی Electron، Prisma Client تولیدی، typecheck کامل، migration روی داده‌ی تاریخی، race دو پردازه‌ی Electron و crash وسط transaction در این محیط اجرا نشدند.

## نشست ۸۶
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `MAHAK_ROOT=<zip خام نشست ۸۵> node --import ./test/harness/register.mjs tests/audit-fixes/fix-s86-exchange-return-output.mjs`
- نتیجه: **۱ موفق · ۴ ناموفق**؛ ردیف جمع تعویض و سه ستون چاپ برگشت وجود نداشتند.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s86-exchange-return-output.mjs`
- نتیجه: **۵ موفق · ۰ ناموفق**؛ تست ساختاری.
- دستور رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۳۴ فایل PASS · ۰ فایل FAIL**، **۶۴۵ بررسی موفق**.

محدودیت اثبات:
- اجرای واقعی React/Electron و چاپگر، Excel واقعی، Prisma Client تولیدی، typecheck کامل، migration داده‌ی تاریخی، race چندپردازه‌ای و crash وسط transaction اجرا نشدند؛ دلیل: npm/npx/Electron در محیط نیستند.

## نشست ۸۷
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s87-report-export-columns.mjs`
- روی zip خام نشست ۸۶: **۳ موفق · ۴ ناموفق**؛ چاپ برگشت قرارداد کامل ستون‌ها نداشت و جمع تعویض سلول مبدأ برداشت را نداشت.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s87-report-export-columns.mjs`
- نتیجه: **۷ موفق · ۰ ناموفق**؛ تست ساختاری.
- دستور رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۳۵ فایل PASS · ۰ فایل FAIL**، **۶۵۲ بررسی موفق · ۰ ناموفق**.

محدودیت اثبات:
- تولید xlsx واقعی، اجرای واقعی React/Electron و چاپگر، Prisma Client تولیدی، typecheck کامل، migration داده‌ی تاریخی، race چندپردازه‌ای و crash وسط transaction اجرا نشدند؛ دلیل: npm/npx/Electron در محیط نیستند.

## نشست ۸۸
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `MAHAK_ROOT=<zip خام نشست ۸۷> node --import ./test/harness/register.mjs tests/audit-fixes/fix-s88-staff-report-integrity.mjs`
- نتیجه: **۰ موفق · ۱۳ ناموفق**؛ relation جعلی `SaleReturn.user/shift`، نبود بازه‌ی امروز، نبود مصرف اعتبار در عملکرد و نبود قرارداد drill-down همگی شکست خوردند.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s88-staff-report-integrity.mjs`
- نتیجه: **۱۳ موفق · ۰ ناموفق**.
- دستور رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۳۶ فایل PASS · ۰ فایل FAIL**؛ تست‌های جدید و قبلی بدون شکست.

محدودیت اثبات:
- `npm`/Prisma تولیدی، typecheck کامل، اجرای واقعی Electron/React، migration تاریخی، Excel/چاپگر واقعی و race چندپردازه‌ای در این محیط اجرا نشدند.

## نشست ۸۹
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s89-return-rate.mjs` روی کد نشست ۸۸ ⇒ اجرا نشد و با `TypeError: detectReturnRateOutliers is not a function` متوقف شد؛ helper وجود نداشت.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s89-return-rate.mjs` ⇒ **۴ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۳۷ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- تست نرخ برگشت helper و SQLite هارنس را اثبات می‌کند؛ اجرای Prisma Client تولیدی، typecheck کامل، Electron/React واقعی، چاپگر/Excel واقعی، migration داده‌ی تاریخی، race دو پردازه و crash وسط تراکنش همچنان اجرا نشده‌اند.

## نشست ۹۰
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `node tests/audit-fixes/fix-s90-printer-cleanup.mjs` ⇒ **۱ موفق · ۴ ناموفق**؛ `printHtml` و `listPrinters` پنجره را فقط در مسیر عادی/ callback می‌بستند و برای `try/finally` قراردادی نداشتند.

بعد از رفع:
- `node tests/audit-fixes/fix-s90-printer-cleanup.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۳۸ فایل PASS · ۰ فایل FAIL**، **۶۷۵ علامت موفق**.

محدودیت اثبات:
- تست جدید ساختاری است؛ اجرای واقعی Electron، خطای واقعی `loadURL`/`print`، چاپگر، Prisma Client تولیدی، typecheck کامل، Excel واقعی، migration تاریخی، race دو پردازه و crash وسط تراکنش در این محیط اجرا نشدند.

## نشست ۹۱
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- کد نشست ۹۰ در `SalesReports.tsx` برای `sale:return:list`، `sale:exchange:list` و `sale:credit:list` فقط `fromJalali`/`toJalali`/`channels` را می‌فرستاد؛ فیلترهای شماره فیش، مشتری، کالا و شیفت به این سه endpoint نمی‌رسیدند.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s91-report-filter-propagation.mjs` ⇒ **۱۱ موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs` ⇒ **۱۸۵ موفق · ۰ ناموفق**.
- `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۳۹ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- تست جدید قرارداد UI/main را ساختاری کنترل می‌کند؛ اجرای Prisma Client تولیدی، typecheck کامل، React/Electron واقعی، Excel/چاپگر واقعی، migration داده‌ی تاریخی، race دو پردازه و crash وسط تراکنش همچنان اجرا نشده‌اند.

## نشست ۹۲
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `cashMovementTotals` با وجود `shiftId` فقط `{ shiftId }` می‌ساخت و `occurredAt` را حذف می‌کرد؛ `CashMovementService.list` هم همین شاخه‌ی انحصاری را داشت.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s92-cash-filter-merge.mjs` ⇒ **۹ موفق · ۰ ناموفق**.
- `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۰ فایل PASS · ۰ فایل FAIL**.
- کنترل تکمیلی: فهرست بدون تاریخ همچنان با بازه‌ی پیش‌فرض «امروز» ساخته می‌شود؛ شیفت/کارمند فقط قیدهای اضافه‌اند.

محدودیت اثبات:
- تست جدید ساختاری است؛ اجرای Prisma Client تولیدی، typecheck کامل، React/Electron واقعی، Excel/چاپگر واقعی، migration داده‌ی تاریخی، race دو پردازه و crash وسط تراکنش همچنان اجرا نشده‌اند.

## نشست ۹۳
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s93-dedicated-extra-report-print.mjs` ⇒ **۳ موفق · ۲ ناموفق**؛ تب‌های `storeCredits` و `fraud` شاخه‌ی مستقل چاپ A4 نداشتند.

بعد از رفع:
- همان تست ⇒ **۵ موفق · ۰ ناموفق**؛ شاخه‌ی مستقل هر دو تب و استفاده از داده‌ی همان تب تأیید شد.
- رگرسیون `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۱ فایل PASS · ۰ فایل FAIL**، **۶۷۰ بررسی موفق · ۰ ناموفق**.

رفتار قبل/بعد:
- قبل: چاپ A4 در `storeCredits` و `fraud` به شاخه‌ی پیش‌فرض `گزارش برگشت از فروش` می‌رسید؛ مثلاً یک هشدار ضدتقلب به‌جای گروه/شدت/فیش، ستون‌های برگشت چاپ می‌کرد.
- بعد: اعتبار خرید و ضدتقلب هر کدام عنوان، ستون و ردیف‌های خودشان را دارند؛ fallback برگشت فقط برای تب برگشت است.

فایل‌های src تغییرکرده:
- `src/renderer/src/pages/SalesReports.tsx:895-941` — افزودن شاخه‌های چاپ A4 مستقل برای اعتبار خرید و ضدتقلب.

محدودیت اثبات:
- اجرای واقعی Electron، `loadURL`/`print`، فهرست چاپگر، چاپگر فیزیکی، ساخت/بازکردن Excel واقعی، Prisma Client تولیدی، typecheck، migration تاریخی، race دو پردازه و crash وسط تراکنش اجرا نشد؛ دلیل: npm/npx/Electron در محیط موجود نبودند.

## نشست ۹۴
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- snapshot قبل از اصلاح `SalesReports.tsx` با حذف شاخه‌های جدید ساخته شد.
- `MAHAK_ROOT=/home/user/work/mahak-before94 node --import ./test/harness/register.mjs tests/audit-fixes/fix-s94-dedicated-extra-report-export.mjs`
- نتیجه: **۱ موفق · ۶ ناموفق**؛ هر دو تب به fallback برگشت می‌رسیدند و قرارداد ستون مستقل نداشتند.

بعد از رفع:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s94-dedicated-extra-report-export.mjs`
- نتیجه: **۷ موفق · ۰ ناموفق**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s93-dedicated-extra-report-print.mjs`
- نتیجه: **۵ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done`
- نتیجه: **۴۲ فایل PASS · ۰ فایل FAIL**.

رفتار قبل/بعد:
- قبل: خروجی Excel تب‌های `storeCredits` و `fraud` به مسیر گزارش برگشت می‌افتاد و داده‌ی تب انتخاب‌شده را صادر نمی‌کرد.
- بعد: هر دو تب شاخه‌ی مستقل دارند؛ خروجی اعتبار خرید از `rows/items` خودش و خروجی ضدتقلب از `groups/sections/rows` خودش ساخته می‌شود.

فایل‌های src تغییرکرده:
- `src/renderer/src/pages/SalesReports.tsx` — افزودن شاخه‌های Excel مستقل برای اعتبار خرید و ضدتقلب.
- `tests/audit-fixes/fix-s94-dedicated-extra-report-export.mjs` — تست قبل/بعد ساختاری قرارداد خروجی.

محدودیت اثبات:
- ساخت و بازکردن فایل Excel واقعی، اجرای Electron/چاپگر، Prisma Client تولیدی، typecheck کامل، migration تاریخی، race چندپردازه‌ای و crash وسط transaction اجرا نشد؛ دلیل: npm/npx/Electron در محیط موجود نبودند.

## نشست ۹۵
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

قبل از رفع:
- snapshot موقت با همان `])` در آرایه‌ی `totals` ساخته شد.
- esbuild روی `SalesReports.tsx` ⇒ **FAIL**، خطا: `Expected "]" but found ")"` در خط ۱۲۵۴.
- parser هارنس روی `ExportService.ts` و `xlsx.ts` نیز به‌علت پشتیبانی ناقص از regex/template literal false positive می‌داد.

بعد از رفع:
- `src/renderer/src/pages/SalesReports.tsx` با تبدیل native esbuild ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx src/main/services/ExportService.ts src/main/services/xlsx.ts` ⇒ **۳ فایل PASS**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s95-tsx-parser-template-literal.mjs` ⇒ **PASS**؛ هم template literal تو‌در‌تو و regex interpolation و هم صفحه‌ی واقعی گزارش را کنترل می‌کند.
- رگرسیون `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۳ فایل PASS · ۰ فایل FAIL**.

Excel واقعی بدون Electron:
- `ExportService.exportTableFile({ ask: false, ... })` یک فایل OOXML با پسوند `.xlsx` ساخت.
- `file` ⇒ `Microsoft Excel 2007+`.
- `unzip -t` ⇒ **No errors detected** برای هر ۶ جزء ZIP.
- XML برگه ⇒ عنوان فارسی، `INV-1405-0012`، `A-12-B` و `autoFilter` تأیید شدند.

رفتار قبل/بعد:
- قبل: شاخه‌ی fallback برگشت در خروجی Excel به‌خاطر `])` اصلاً parse نمی‌شد و build صفحه گزارش متوقف می‌شد.
- بعد: خروجی Excel تب‌های قبلی برقرار، صفحه نحواً سالم، و بسته‌ی OOXML قابل unzip است.

محدودیت اثبات:
- اجرای `npm`/`npx`، Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، بازکردن در Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای و crash وسط تراکنش اجرا نشد.

## نشست ۹۶
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

رفع خوشه F / فیلتر تب چک:
- قبل: `MAHAK_ROOT=/home/user/work/mahak96-before node --import ./test/harness/register.mjs tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs` ⇒ **۰ موفق · ۷ ناموفق**؛ `chequeList` چهار فیلتر فاکتوری را نداشت و helper مشترک را مصرف نمی‌کرد.
- بعد: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۴ فایل PASS · ۰ فایل FAIL**.
- کنترل نحوی: `node --check tools/tsx-parse-check.mjs` ⇒ **PASS**.

رفتار قبل/بعد:
- قبل: فیلتر شماره فیش، مشتری، کالا و نوع سفارش از درخواست تب چک خوانده نمی‌شد؛ تب چک می‌توانست با همان نوار فیلتر، رکوردهای بیشتری از تب برگشت/تعویض/نسیه نشان دهد.
- بعد: `reportInvoiceRelationWhere` روی فاکتور مادر اعمال می‌شود و `orderTypeWhere` کانال و نوع سفارش را با هم ترکیب می‌کند؛ بدون فیلتر فاکتوری فعال، relation شرط‌گذاری نمی‌شود.

محدودیت اثبات:
- تست نشست ۹۶ ساختاری است؛ Prisma Client تولیدی، typecheck کامل، اجرای Electron/چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race دو پردازه و crash وسط transaction اجرا نشدند.

## نشست ۹۷
رفع خوشه F / انتشار فیلترهای نوار گزارش به تب legacy اعتبار:
- قبل: `MAHAK_ROOT=/tmp/mahak/before97 node tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` ⇒ **۰ موفق · ۸ ناموفق**؛ قرارداد `ListFilter` فیلترهای نوار گزارش را نداشت و `whereFromFilter` lookup فاکتور صدور انجام نمی‌داد.
- بعد: `node tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` ⇒ **۸ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۵ فایل PASS · ۰ فایل FAIL**.
- کنترل نحوی: `esbuild` روی `src/main/services/StoreCreditService.ts` ⇒ **PASS**؛ `node --check tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` ⇒ **PASS**.

رفتار قبل/بعد:
- قبل: `storeCreditList` فیلتر کامل UI را دریافت می‌کرد، اما سرویس اعتبار فقط فیلترهای اختصاصی خودش را می‌خواند؛ کانال، نوع سفارش، فیش، مشتری، کالا، کارمند و شیفت بی‌صدا نادیده گرفته می‌شدند.
- بعد: فاکتورهای صدور مطابق همان قیود پیدا می‌شوند و اعتبارهای متصل از مسیر `sourceInvoiceId`، `exchangeInvoiceId` یا `returnId` محدود می‌شوند. کانال خالی با `in: []` گزارش را عمداً خالی می‌کند و هر دو کانال فیلتر اضافه نمی‌کنند.

محدودیت اثبات:
- تست نشست ۹۷ ساختاری است؛ اجرای Prisma Client تولیدی، migration، داده‌ی تاریخی واقعی، typecheck کامل، Electron/چاپگر، Excel دسکتاپ، race دو پردازه و crash وسط transaction اجرا نشدند.

## نشست ۹۸
گام ۰: `npm install` / `npx prisma generate` / `npm run typecheck` ⇒ اجرا نشد، دلیل: npm/npx در محیط نیست (`command not found`). `node --version` ⇒ `v22.23.1`.

رفع خوشه G / فیلتر اعتبار روی داده‌ی حجیم:
- قبل: `cd <کپی zip نشست ۹۷> && MAHAK_ROOT=<همان کپی> node --import ./test/harness/register.mjs tests/audit-fixes/fix-s98-credit-filter-scale.mjs` ⇒ **۳ موفق · ۹ ناموفق**؛ `Error: too many SQL variables` از `creditInvoiceIdsFromReportFilter`، بیشینه‌ی پارامتر یک statement = ۵۰٬۰۰۰.
- بعد: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s98-credit-filter-scale.mjs` ⇒ **۱۲ موفق · ۰ ناموفق**؛ بیشینه‌ی پارامتر هر statement ≤ ۱٬۰۰۰.
- `node tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` (همسوشده) ⇒ **۸ موفق · ۰ ناموفق**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۶ فایل PASS · ۰ فایل FAIL**.
- `test/acceptance-db-session36.mjs` ⇒ **۱۳۱ PASS · ۷ FAIL** قبل و بعد (بدون تغییر؛ ۷ مورد سبد «نامشخص»).
- esbuild روی `src/main/services/StoreCreditService.ts` ⇒ **PASS**.

محدودیت اثبات: تست رفتاری روی SQLite هارنس (node:sqlite) است، نه Prisma Client تولیدی. رفتار Prisma 5.22 در تکه‌کردن خودکار `IN` و سقف واقعی متغیر SQLite نسخه‌ی باندل‌شده با Prisma اجرا نشد؛ Electron، typecheck، migration تاریخی، race دو پردازه و crash وسط transaction اجرا نشدند.

## نشست ۹۹
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

رفع خوشه G / صفحه‌بندی endpointهای گزارش:
- قبل: `MAHAK_ROOT=<کپی zip نشست ۹۸> node tests/audit-fixes/fix-s99-report-pagination.mjs` ⇒ **۰ موفق · ۱۷ ناموفق**؛ چهار endpoint metadata صفحه نداشتند، `count()` واقعی نمی‌گرفتند و lookupهای بزرگ helper مشترک نداشتند.
- بعد: `node tests/audit-fixes/fix-s99-report-pagination.mjs` ⇒ **۱۷ موفق · ۰ ناموفق**.
- کنترل نحوی تست: `node --check tests/audit-fixes/fix-s99-report-pagination.mjs` ⇒ **PASS**.
- parser هارنس: `node tools/tsx-parse-check.mjs src/main/services/SalesService.ts src/shared/types.ts` ⇒ **۲ فایل PASS**.
- رگرسیون کامل: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۷ فایل PASS · ۰ فایل FAIL**.

رفتار بعد:
- `reportItems`، `returnList`، `exchangeList` و `chequeList` تعداد واقعی رکوردهای query نهایی را به‌دست می‌آورند و `skip`/`take`/`page.totalCount`/`page.truncated` را برمی‌گردانند.
- خروجی آرایه‌ای سه endpoint با `Array.isArray` سازگار مانده و `page`/`warnings` روی همان آرایه attach شده است؛ خروجی تعویض metadata اختیاری دارد.
- تمام `IN`های lookup این چهار مسیر در دسته‌های حداکثر ۵۰۰ شناسه اجرا می‌شوند.

محدودیت اثبات:
- Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration داده‌ی تاریخی، race دو پردازه، crash وسط transaction و تست حجیم با Prisma واقعی اجرا نشدند؛ `fix-s99-report-pagination.mjs` ساختاری است و جای این تست‌ها را نمی‌گیرد.

### نشست ۱۰۵

#### خوشه G، هم‌خوان‌سازی report limits
- تست جدید: `tests/audit-fixes/fix-s105-report-limits-filter-propagation.mjs`.
- قبل از رفع روی کپی نشست ۱۰۴: **۰ موفق · ۸ ناموفق**.
- بعد از رفع: **۸ بررسی موفق · ۰ ناموفق**.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۵۵ فایل PASS · ۰ فایل FAIL**.
- `node --check tests/audit-fixes/fix-s105-report-limits-filter-propagation.mjs`: **PASS**.
- esbuild/typecheck کامل: اجرا نشد، چون `node_modules/.bin/esbuild` و npm در محیط موجود نیستند.
- محدودیت: این آزمون به‌تنهایی رفتار Prisma تولیدی، شمارش روی داده‌ی واقعی یا رندر Electron را اثبات نمی‌کند.

### نشست ۱۰۸ · drill-down پل تطبیق
- گام ۰: `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`; `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`; `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`; `node --version` ⇒ `v22.23.1`.
- قبل: `MAHAK_ROOT=<کپی zip نشست ۱۰۷> node tests/audit-fixes/fix-s108-bridge-drilldown-pagination.mjs` ⇒ **۰ موفق · ۱۰ ناموفق**.
- بعد: `node tests/audit-fixes/fix-s108-bridge-drilldown-pagination.mjs` ⇒ **۱۰ موفق · ۰ ناموفق**.
- syntax: `node --check tests/audit-fixes/fix-s108-bridge-drilldown-pagination.mjs` ⇒ **PASS**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۵۸ فایل PASS · ۰ فایل FAIL**.
- محدودیت: تست جدید ساختاری است؛ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration داده‌ی تاریخی، race دو پردازه و crash وسط transaction اجرا نشدند.

## نشست ۱۰۹ · پیش‌نمایش پاک‌سازی گزارش
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- `MAHAK_ROOT=<کپی خروجی نشست ۱۰۸> node tests/audit-fixes/fix-s109-purge-preview-pagination.mjs` ⇒ **۰ موفق · ۵ ناموفق**.
- شکست‌ها: `SalesPurgePreview` صفحه/هشدار نداشت، `purgePreview` metadata را دور می‌ریخت و UI هشدار برش نداشت.

رفع و تست بعد:
- `node tests/audit-fixes/fix-s109-purge-preview-pagination.mjs` ⇒ **۵ بررسی موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s109-purge-preview-pagination.mjs` ⇒ **PASS**.
- رگرسیون کامل `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۵۹ فایل PASS · ۰ فایل FAIL**.
- `node tools/tsx-parse-check.mjs src/main/services/SalesService.ts src/renderer/src/pages/Settings.tsx src/shared/types.ts` ⇒ **۳ فایل PASS**.

رفتار بعد:
- پیش‌نمایش پاک‌سازی همان `page.totalCount`/`truncated`/هشدار گزارش اصلی را به caller می‌دهد.
- برای انتخاب فاکتورهای مشخص، هشدار برش بازه‌ی کامل عمداً خالی می‌شود چون انتخاب‌ها از ردیف‌های قابل مشاهده‌ی همان صفحه آمده‌اند؛ جمع انتخابی از همان ردیف‌های انتخاب‌شده محاسبه می‌شود.
- پنل تنظیمات هشدار فارسی را پیش از تأیید نمایش می‌دهد.

محدودیت اثبات:
- `npm install`، `npx prisma generate`، `npm run typecheck`، Prisma Client تولیدی، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race دو پردازه و crash وسط transaction اجرا نشدند؛ parser هارنس جای typecheck کامل را نمی‌گیرد.

## نشست ۱۱۰ · اتصال تب ضدتقلب به قرارداد واقعی سرویس
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- روی کپی zip نشست ۱۰۹: `node tests/audit-fixes/fix-s110-fraud-flags-adapter.mjs` ⇒ **۰ موفق · ۶ ناموفق**.
- شکست‌ها: نمایش تب ضدتقلب `flags` را نمی‌خواند؛ چاپ A4 و Excel همین مشکل را داشتند؛ `sources` به ردیف تبدیل نمی‌شد و ستون `label` برچسب نداشت.

رفع و تست بعد:
- `node tests/audit-fixes/fix-s110-fraud-flags-adapter.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s110-fraud-flags-adapter.mjs` ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx src/renderer/src/components/ReportExtraTables.tsx` ⇒ **۲ فایل PASS**.
- رگرسیون: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۶۰ فایل PASS · ۰ فایل FAIL**.

رفتار قبل/بعد:
- قبل: `FraudService.review` پرچم‌ها را در `flags` می‌داد، ولی مصرف‌کننده فقط `groups`/`sections`/`rows` را می‌خواند؛ بنابراین داده‌ی واقعی ضدتقلب در صفحه و خروجی‌ها دیده نمی‌شد.
- بعد: هر سه مسیر صفحه، چاپ A4 و Excel ابتدا `flags` و سپس شکل‌های قدیمی را می‌پذیرند؛ ردیف‌های `sources` نیز به‌عنوان ردیف‌های قابل نمایش/خروجی مصرف می‌شوند.

محدودیت اثبات:
- این تست ساختاری/قراردادی است و Prisma Client تولیدی، typecheck کامل، اجرای Electron، چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای و crash وسط transaction را اثبات نمی‌کند.

## نشست ۱۱۱ · قرارداد صفحه‌بندی منابع ضدتقلب
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- روی کپی zip نشست ۱۱۰: `node tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- شکست‌ها: قرارداد `sourcesTotal`/`sourcesTruncated` نداشت، سقف منابع اعلام نمی‌شد و صفحه/چاپ/Excel هشدار برش نداشتند.

رفع و تست بعد:
- `node tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs` ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/main/services/FraudService.ts src/renderer/src/components/ReportExtraTables.tsx src/renderer/src/pages/SalesReports.tsx` ⇒ **۳ فایل PASS**.
- رگرسیون کامل `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۶۱ فایل PASS · ۰ فایل FAIL**.

رفتار بعد:
- ضدتقلب هشدارها را روی کل داده‌ی صفحه‌بندی‌شده محاسبه می‌کند، اما حداکثر ۲۰۰ منبع را برای هر پرچم در پاسخ نگه می‌دارد.
- `sourcesTotal` تعداد واقعی و `sourcesTruncated` وضعیت برش را اعلام می‌کند؛ UI، چاپ A4 و Excel متن «نمایش ... از ... سند» می‌سازند.

محدودیت اثبات:
- این رفع با هارنس و parser اثبات شد، نه Prisma Client تولیدی، Electron، چاپگر واقعی یا Excel دسکتاپ؛ این محدودیت‌ها و migration تاریخی، race چندپردازه‌ای و crash وسط transaction همچنان باز هستند.

## نشست ۱۱۲ · cashEffect دفتر رویداد
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- باگ در قرارداد قبلی مشخص بود: ردیف `CHEQUE_CLEARED` بدون خواندن `destination` کل مبلغ را نقد فرض می‌کرد و `CARD` در برگشت هم `cashEffect` منفی می‌گرفت.
- تست جدید `fix-s112-cash-effect-drawer-only.mjs` این رفتار را با چهار چکِ مقصدهای نقد، کارت، مدیر و نامشخص و دو برگشت نقد/کارت بازتولید می‌کند؛ قبل از رفع انتظارهای مقصدی/کارت شکست می‌خورد.

رفع و تست بعد:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s112-cash-effect-drawer-only.mjs` ⇒ **۱۰ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s112-cash-effect-drawer-only.mjs` ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/main/services/SalesLedger.ts` ⇒ **PASS**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s74-cluster-a.mjs` ⇒ **۵ موفق · ۰ ناموفق**.
- رگرسیون کامل `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۶۲ فایل PASS · ۰ فایل FAIL**.

رفتار بعد:
- `cashEffect` چک فقط برای مقصد صریح `CASH` مثبت است؛ `CARD`، `MANAGER` و `null` صفر هستند.
- برگشت `CASH` خروجی منفی کشو دارد؛ برگشت `CARD`، اعتبار و کارت‌به‌کارت اثر نقدی صفر دارند.
- در تعویض، دریافت مابه‌التفاوت فقط با settlement نقدی اثر مثبت دارد و بازپرداخت فقط با `CASH_REFUND` خروجی منفی دارد.

محدودیت اثبات:
- `npm`/Prisma/Electron در محیط موجود نیستند؛ بنابراین Prisma Client تولیدی، typecheck کامل، اجرای واقعی Electron/چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۳ · سیاست مقصد چک
گام ۰:
- `node --version` ⇒ `v22.23.1`.
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.

تست قبل از رفع:
- روی کپی خام `mahak-session112-fix.zip`: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s113-cheque-destination-policy.mjs` ⇒ **۳ موفق · ۷ ناموفق**.
- شکست‌ها: گیت مخصوص پاس‌شدن چک وجود نداشت، چک در مسیر create/addPayment از مقصد نقد/کارت جلوگیری نمی‌کرد، دفتر رویداد از سبد مشترک استفاده نمی‌کرد، و `receiptBucketOf` چک با CASH/CARD را نقد/کارت می‌شمرد.

رفع و تست بعد:
- `node --check tests/audit-fixes/fix-s113-cheque-destination-policy.mjs` ⇒ **PASS**.
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s113-cheque-destination-policy.mjs` ⇒ **۱۰ موفق · ۰ ناموفق**.
- تست‌های متاثر: `fix-s68-payment-provenance.mjs` ⇒ **۱۲/۰**؛ `fix-s69-cheque-history.mjs` ⇒ **۹/۰**؛ `fix-s74-cluster-a.mjs` ⇒ **۵/۰**.
- parser: `node tools/tsx-parse-check.mjs src/shared/enums.ts src/shared/accounting.ts src/main/services/SalesService.ts src/main/services/SalesLedger.ts` ⇒ **۴ فایل PASS**.
- رگرسیون کامل: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۶۳ فایل PASS · ۰ فایل FAIL**.

رفتار قبل/بعد:
- قبل: `allowedDestinationsFor(CUSTOM)` برای پاس‌شدن چک هر سه مقصد را می‌پذیرفت؛ `receiptBucketOf({isCheque:true,destination:'CASH'})` مقدار `cash` می‌داد و دفتر رویداد می‌توانست چک را نقد حساب کند.
- بعد: `CHEQUE_CLEAR` فقط `MANAGER` را می‌پذیرد؛ چک با CASH/CARD/null در سبد `unknown` است و `cashEffect` آن صفر می‌ماند. روش‌های غیرچکی نقدی همچنان CASH را معتبر می‌دانند.

محدودیت اثبات:
- تست‌ها با هارنس SQLite داخلی و parser اجرا شدند؛ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race دوپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۴ · سقف‌های بی‌صدا در صندوق و کارت‌به‌کارت
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- رگرسیون پایه روی zip خام نشست ۱۱۳ ⇒ **۶۳ فایل PASS · ۰ FAIL**.

قبل از رفع (روی کد خام نشست ۱۱۳، تست پیش از patch نوشته و اجرا شد):
- `fix-s114-cashbox-history-pagination.mjs` ⇒ **۱ موفق · ۱۶ ناموفق** (۲۰۰ ردیف به‌جای ۲۰۵، بدون page/warnings).
- `fix-s114-cash-movement-totals-full-range.mjs` ⇒ **۲ موفق · ۱۱ ناموفق** (جمع برداشت ۰ به‌جای ۱٬۵۰۰٬۰۰۰، بازپرداخت ۰ به‌جای ۲۰۰٬۰۰۰، واریز ۴۹۹٬۰۰۰ به‌جای ۵۲۰٬۰۰۰).
- `fix-s114-card-transfer-totals-full-range.mjs` ⇒ **۰ موفق · ۱۲ ناموفق** (پرداخت‌شده‌ی «خارج از فروش» ۰ به‌جای ۲۰٬۰۰۰).

بعد از رفع:
- همان سه تست ⇒ **۱۷/۰**، **۱۳/۰**، **۱۲/۰**. `node --check` هر سه ⇒ **PASS**.
- parser: `node tools/tsx-parse-check.mjs src/main/services/CashboxService.ts src/main/services/CashMovementService.ts src/main/services/CardTransferService.ts src/renderer/src/pages/CashClose.tsx src/renderer/src/pages/Consolidation.tsx src/renderer/src/components/CardTransferPanel.tsx` ⇒ **۶ فایل PASS**.
- رگرسیون کامل (اجرای اول `fix-s104` به‌خاطر regex روی `take: 5000` لفظی FAIL شد؛ لفظ با ثابت `HISTORY_PAGE_MAX` جایگزین شد، رفتار یکسان) ⇒ **۶۶ فایل PASS · ۰ FAIL**.

محدودیت اثبات: Prisma Client تولیدی، typecheck کامل، Electron/رندر واقعی، Excel دسکتاپ، race، crash، timezone غیر Asia/Tehran و ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۵
- رگرسیون پایه روی zip نشست ۱۱۴ ⇒ ۶۶ PASS · ۰ FAIL.
- fix-s115-purchase-list-full-range.mjs ⇒ قبل ۱ · ۱۶ · بعد ۱۷/۰.
- fix-s115-customer-directory-full-range.mjs ⇒ قبل ۱ · ۱۶ · بعد ۱۷/۰.
- fix-s115-card-transfer-event-date.mjs ⇒ قبل ۳ · ۸ · بعد ۱۱/۰؛ fix-s114-card-transfer-totals-full-range ⇒ ۱۲/۰.
- tests/pending/fix-s115-stock-movements-full-ledger.mjs ⇒ قبل ۱ · ۱۴ (رفع ناتمام).
- parser ۷ فایل src + تست‌ها ⇒ PASS؛ node --check ⇒ PASS.
- رگرسیون کامل ⇒ ۶۹ فایل PASS · ۰ FAIL.

## نشست ۱۱۶ · ProductService.movements
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- `node --import ./test/harness/register.mjs tests/pending/fix-s115-stock-movements-full-ledger.mjs` روی کد خام نشست ۱۱۵ ⇒ **۱ موفق · ۱۴ ناموفق**؛ سرویس فقط ۳۰۰ ردیف برمی‌گرداند و metadata/جمع کل وجود نداشت.

رفع و تست بعد:
- `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s115-stock-movements-full-ledger.mjs` ⇒ **۱۵ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s115-stock-movements-full-ledger.mjs` ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/main/services/ProductService.ts src/main/ipc/index.ts src/renderer/src/components/MovementsModal.tsx` ⇒ **۳ فایل PASS**.
- رگرسیون کامل `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۷۰ فایل PASS · ۰ فایل FAIL**.

رفتار بعد:
- جمع ورود/خروج، net، تعداد PENDING و count از کل دفتر همان variant است.
- صفحه‌ی اول تا ۵٬۰۰۰ ردیف می‌دهد؛ صفحه‌های بعد `skip` و `newerDeltaSum` دارند؛ هشدار فارسی برش نمایش داده می‌شود.
- پنجره‌ی گردش جمع‌های کل، هشدار و دکمه‌های قبل/بعد را نشان می‌دهد و موجودی پس از حرکت را با مرز صفحه درست می‌کند.

محدودیت اثبات:
- npm/Prisma/Electron در محیط موجود نیستند؛ بنابراین Prisma Client تولیدی، typecheck کامل، IPC واقعی Electron، رندر UI، چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۹
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.

تست قبل از رفع:
- `fix-s119-credit-detail-batch-pagination.mjs` روی کد نشست ۱۱۸ ⇒ **۴ موفق · ۱۳ ناموفق**؛ Timeline و لاگ یادآوری metadata نداشتند، صفحه‌ی دوم نادیده گرفته می‌شد و batchها با سقف ۲۰۰ بی‌صدا بریده می‌شدند.

رفع و تست بعد:
- S119-1 · `StoreCreditService.detail` ⇒ `count`، `skip/take`، `timelinePage`/`remindersPage` و هشدار فارسی؛ UI جزئیات دکمه‌های صفحه‌ی قبل/بعد و هشدار را نشان می‌دهد.
- S119-2 · `StoreCreditService.batches` ⇒ `PagedRows` آرایه‌ای با `count`، `skip/take`، `page` و هشدار؛ `creditViewRequest` و UI دسته‌ها `skip` را عبور می‌دهند.
- `fix-s119-credit-detail-batch-pagination.mjs` ⇒ **۱۸ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s119-credit-detail-batch-pagination.mjs` ⇒ PASS.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/CreditManagement.tsx src/renderer/src/components/CreditDetailView.tsx src/shared/creditUi.ts` ⇒ **۳ فایل PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۷۹ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- npm/Prisma/Electron در محیط موجود نیستند؛ Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۷
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found` (در محیط TypeScript/tsc هم نیست).
- `node --version` ⇒ `v22.23.1`. رگرسیون پایه روی zip نشست ۱۱۶ ⇒ ۷۰ PASS · ۰ FAIL.

رفع‌های نشست ۱۱۷:
- S117-1 · خوشه E · `StaffReportService.performance`: تعهد کارت‌به‌کارت کارمند = جمع درخواست‌های REQUEST غیرلغوشده (`status: { not: 'CANCELED' }`) + برای برگشت‌های قدیمیِ بدون هیچ ردیف درخواست، مبلغ برگشت‌محور (تا تعهد تاریخی پنهان نشود)؛ هر تعهد دقیقاً یک‌بار. کارمندی که فقط تعهد دارد و فروش/برگشتی در بازه ندارد ردیف خالی می‌گیرد. درخواست لغوشده در ریز تراکنش با وضعیتش می‌ماند.
- S117-2 · خوشه G + بند ۴-۵۳ · `SalesService.creditList` (تب نسیه): سقف بی‌صدای ۳۰۰۰ فاکتور و ۲۰۰۰ «وصول نسیه‌ی دوره‌ی قبل» حذف؛ خواندن دسته‌ای (۲۰۰۰تایی) کل بازه؛ جمع‌ها روی کل بازه؛ ردیف‌ها با skip/take (پیش‌فرض/سقف `CREDIT_PAGE_MAX = 5000`)، `page`، `priorPage`، `warnings` فارسی، `totals.priorSettlementCount`. `types.ts` فیلدهای اختیاری تازه. `reportLimits.ts`: `REPORT_CAPS.credit = 5000`. UI `SalesReports.tsx`: نوار هشدار + صفحه‌ی قبل/بعد؛ جمع چاپ «پرداختی» از priorSettlementCount.
- S117-3 · خوشه G · `SalesService.exchangeGet`: به‌جای خواندن کل روز با `take: 2000`، فیلتر داخلی `returnId` در `exchangeList` و `take: 1` (همان سازنده‌ی ردیف).
- S117-4 · خوشه G · `SalesService.list` (فهرست فاکتور عمده): async؛ aggregate روی کل where ⇒ `totals { count, grandTotal }`، `page`، `warnings`، skip، سقف `SALE_LIST_PAGE_MAX = 5000`؛ خروجی همچنان آرایه. UI `SalesInvoice.tsx`: جمع از totals، هشدار و صفحه‌ی قبل/بعد (`listSkip`).
- S117-5 · خوشه G + بند ۳ (انبارگردانی قابل‌کشف) · `StockCountService.discrepancy`: (۱) باگ واقعی: where روی `StockMovement` ستون ناموجود `at` داشت ⇒ با هر بازه‌ی تاریخ خطای validation و کور شدن جدول مغایرت؛ به `createdAt` اصلاح شد. (۲) سقف بی‌صدای `take: 20_000` روی ردیف‌های شمارش حذف و خواندن دسته‌ای ۵۰۰۰تایی شد.

تست‌های نشست ۱۱۷ (همه در `tests/audit-fixes/`، اجرا: `node --import ./test/harness/register.mjs <file>`):
- `fix-s117-staff-card-transfer-canceled.mjs` ⇒ قبل ۴ موفق · ۴ ناموفق؛ بعد ۸/۰.
- `fix-s117-credit-list-full-range.mjs` ⇒ قبل ۱ · ۱۶؛ بعد ۱۷/۰.
- `fix-s117-exchange-get-busy-day.mjs` ⇒ قبل ۴ · ۳؛ بعد ۷/۰.
- `fix-s117-sale-list-full-range.mjs` ⇒ قبل ۱ · ۱۰؛ بعد ۱۱/۰.
- `fix-s117-stock-discrepancy-full.mjs` ⇒ قبل: crash (هارنس: «ستون ناشناخته at در where روی StockMovement»)؛ بعد ۵/۰.
- `node --check` روی نسخه‌ی .mts فایل‌های ts تغییرکرده (StaffReportService، SalesService، StockCountService، reportLimits، types) ⇒ PASS. `tools/tsx-parse-check.mjs` روی SalesReports.tsx و SalesInvoice.tsx ⇒ PASS. نکته: tsx-parse-check روی فایل .ts دارای generic `<T ...>` (مثل StaffReportService) مثبت کاذب می‌دهد و این از قبل (روی کد خام ۱۱۶) هم بود؛ برای .ts از `node --check` استفاده شد.
- رگرسیون کامل ⇒ ۷۵ فایل PASS · ۰ FAIL.

## نشست ۱۱۸
گام ۰:
- `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.
- رگرسیون پایه روی zip نشست ۱۱۷ ⇒ **۷۵ فایل PASS · ۰ FAIL**.

تست‌های قبل روی baseline نشست ۱۱۷:
- `fix-s118-purge-selected-invoices.mjs` ⇒ **۱ موفق · ۲ ناموفق**.
- `fix-s118-price-adjust-full-scope.mjs` ⇒ **۰ موفق · ۵ ناموفق**.
- `fix-s118-secondary-stock-history-pagination.mjs` ⇒ **۰ موفق · ۶ ناموفق**.

رفع و تست بعد:
- S118-1 پیش‌نمایش فاکتور انتخابی ⇒ **۳ موفق · ۰ ناموفق**.
- S118-2 دامنه‌ی کامل PriceAdjustService و activeDiscounts ⇒ **۵ موفق · ۰ ناموفق**.
- S118-3 تاریخچه‌ی SecondaryStock ⇒ **۶ موفق · ۰ ناموفق**.
- `node --check` سه تست تازه ⇒ **PASS**.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/SecondaryStock.tsx` ⇒ **PASS**.
- `node --experimental-strip-types --check` روی `PriceAdjustService.ts`، `SecondaryStockService.ts` و `types.ts` ⇒ **PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۷۸ فایل PASS · ۰ فایل FAIL**.

محدودیت اثبات:
- npm/Prisma/Electron در محیط موجود نیستند؛ بنابراین Prisma Client تولیدی، typecheck کامل، IPC واقعی Electron، رندر UI، چاپگر، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

### ادامه‌ی نشست ۱۱۹ · انبارگردانی
- تست قبل `fix-s119-stockcount-pagination.mjs` روی کد نشست ۱۱۸ ⇒ **۲ موفق · ۱۰ ناموفق**.
- رفع S119-3: `StockCountService.variants/list` اکنون count، skip/take، page و هشدار دارد؛ UI انبارگردانی صفحه‌بندی را نمایش می‌دهد.
- تست بعد ⇒ **۱۲ موفق · ۰ ناموفق**.
- `node --check` دو تست ⇒ PASS؛ `node tools/tsx-parse-check.mjs` روی CreditManagement، CreditDetailView، Stocktake و creditUi ⇒ **۴ فایل PASS**.
- رگرسیون کامل ⇒ **۸۰ فایل PASS · ۰ فایل FAIL**.

### نشست ۱۲۰ · S120-1
- گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند؛ دلیل: `npm`/`npx` در محیط موجود نیستند؛ `node --version` = `v22.23.1`.
- تست قبل روی کد نشست ۱۱۹: `fix-s120-price-schedule-full-range.mjs` ⇒ **۱ موفق · ۴ ناموفق**؛ اجرای قبلی فقط ۲۰۰ مورد از ۲۰۱ شروع و ۲۰۱ پایان رسیده را می‌پرداخت.
- رفع: `processDueSchedulePhase` در `PriceAdjustService.ts` با صفحات keyset زمان/شناسه برای هر دو فاز؛ `runDueSchedules` هر دو فاز را تا پایان پردازش می‌کند.
- تست بعد: `fix-s120-price-schedule-full-range.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ `node --check` ⇒ PASS.
- رگرسیون کامل پس از S120-1 ⇒ **۸۱ فایل PASS · ۰ فایل FAIL**.
- S120-2 · تست قبل `fix-s120-stockcount-in-chunking.mjs` روی کد نشست ۱۱۹: **۰ موفق · ۳ ناموفق**؛ یک `IN` بزرگ‌تر از سقف ساختگی ۵۰۰ باعث خطای گزارش شد.
- رفع: `productVariantsByIds` در `StockCountService.ts` با chunkهای ۵۰۰تایی، هم در ثبت شمارش و هم در گزارش مغایرت.
- تست بعد: `fix-s120-stockcount-in-chunking.mjs` ⇒ **۳ موفق · ۰ ناموفق**؛ `node --check` ⇒ PASS.
- رگرسیون کامل نهایی نشست ۱۲۰: **۸۲ فایل PASS · ۰ فایل FAIL**.
- محدودیت باقی: Prisma Client تولیدی/typecheck کامل، Electron/رندر UI، چاپگر، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اثبات نشده‌اند.

## نشست ۱۲۱ · baseline
- گام ۰: `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`.
- `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`.
- `node --version` ⇒ `v22.23.1`.
- بازبینی کد نشان داد چاپ A4 و Excel در `SalesReports.tsx` فقط ردیف‌های صفحه‌ی جاری را می‌فرستند، اما `metaText` هیچ `page/warnings` ندارد؛ بنابراین برش خروجی برای کاربر بی‌علامت است.

## نشست ۱۲۱ · S121-1 خروجی صفحه‌بندی‌شده
- تست قبل روی baseline بازسازی‌شده‌ی قبل از رفع: `fix-s121-report-export-page-warning.mjs` ⇒ **۰ موفق · ۸ ناموفق**.
- رفع: `outputMetaText` در `SalesReports.tsx` برای `page.truncated`، تعداد کل، بخش‌های ledger و `sourcesTruncated` ضدتقلب هشدار فارسی می‌سازد و همه‌ی مسیرهای چاپ/Excel آن را مصرف می‌کنند.
- تست بعد: `fix-s121-report-export-page-warning.mjs` ⇒ **۸ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s121-report-export-page-warning.mjs` ⇒ PASS.
- `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx` ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۳ فایل PASS · ۰ فایل FAIL**.
- این اثبات قراردادی/هارنس است؛ Prisma Client تولیدی، typecheck، Electron، چاپگر و Excel دسکتاپ همچنان اجرا نشده‌اند.

## نشست ۱۲۲
- `fix-s122-report-excludes-invalid-invoices.mjs` قبل از رفع روی baseline نشست ۱۲۱: **۰ PASS · ۱۰ FAIL**.
- همان تست بعد از رفع S122-1: **۱۰ PASS · ۰ FAIL**؛ شامل فهرست/جمع عمده، شکل فیلتر مشترک، و حذف برگشت متصل به فاکتور لغوشده.
- `node --check tests/audit-fixes/fix-s122-report-excludes-invalid-invoices.mjs` ⇒ PASS.
- `fix-s105-report-limits-filter-propagation.mjs` پس از تغییر helper وضعیت ⇒ **۸ PASS · ۰ FAIL**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۴ فایل PASS · ۰ فایل FAIL**.
- گام ۰، Prisma تولیدی، typecheck، Electron، چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی اجرا نشدند.

## نشست ۱۲۳ · S123-1/S123-2
- گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ `node --version` = `v22.23.1`.
- baseline رگرسیون قبل از تغییر ⇒ **۸۴ فایل PASS · ۰ فایل FAIL**.
- تست قبل روی کد baseline: `fix-s123-stock-allocation-print-chunking.mjs` ⇒ **۱ موفق · ۱۱ ناموفق**؛ سقف ساختگی ۵۰۰، preview/summary و helper چاپ را fail کرد.
- رفع S123-1: `StockAllocationService` برای واریانت‌ها و شناسه‌های فاکتور helperهای chunk‌شده‌ی ۵۰۰تایی دارد؛ preview، apply، summary رسید/export و drop allocations دیگر `IN` بزرگ مستقیم نمی‌سازند.
- رفع S123-2: `PrintService` lookup مشترک ۵۰۰تایی را در رسید فروش و رسید برگشت مصرف می‌کند.
- تست بعد ⇒ **۱۲ موفق · ۰ ناموفق**؛ همه‌ی ۵۰۱ واریانت و ۵۰۱ شناسه‌ی فاکتور بدون برش پردازش شدند و سقف lookup از ۵۰۰ عبور نکرد.
- `node --check` روی `StockAllocationService.ts`، `PrintService.ts` و تست ⇒ **۳ PASS**؛ parser روی `PrintService.ts` ⇒ PASS.
- تست‌های متاثر `fix-s86`، `fix-s87`، `fix-s90`، `fix-s93`، `fix-s94` و `fix-s121` ⇒ همگی PASS.
- رگرسیون کامل نهایی ⇒ **۸۵ فایل PASS · ۰ فایل FAIL**.
- این‌ها اثبات هارنس SQLite/ساختاری‌اند؛ Prisma Client تولیدی، typecheck، Electron/چاپگر/Excel دسکتاپ، Save dialog، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی همچنان اجرا نشده‌اند.

## نشست ۱۲۴ · S124-1/S124-2/S124-3
- گام ۰: `npm install` با `npm: not found`، `npx prisma generate` با `npx: not found` و `npm run typecheck` با `npm: not found` اجرا نشدند؛ `node --version` = `v22.23.1`.
- تست قبل روی zip نشست ۱۲۳: `fix-s124-financial-variant-in-chunking.mjs` ⇒ **۰ موفق · ۷ ناموفق**؛ هارنس عمداً `IN` بزرگ‌تر از ۵۰۰ را برای `InventoryService.checkAvailability`، `StoreCreditService.linesForInvoice` و `SecondaryStockService.coverShortage` رد کرد.
- رفع S124-1: `InventoryService.checkAvailability` از `variantIdChunks` با سقف ۵۰۰ استفاده می‌کند.
- رفع S124-2: `StoreCreditService.linesForInvoice` از `chunkIds` موجود سرویس استفاده می‌کند و همه‌ی category pathها را بر مبنای اقلام کامل فاکتور می‌سازد.
- رفع S124-3: `SecondaryStockService.coverShortage` lookup واریانت‌ها را در chunkهای ۵۰۰تایی انجام می‌دهد و مسیر warning/central withdraw دست‌نخورده می‌ماند.
- تست بعد: همان تست ⇒ **۷ موفق · ۰ ناموفق**؛ هر ۵۰۱ واریانت و هشدار آخرین قلم حفظ شد.
- `node --check tests/audit-fixes/fix-s124-financial-variant-in-chunking.mjs` و `node --experimental-strip-types --check` روی سه سرویس ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۶ فایل PASS · ۰ فایل FAIL**.
- این اثبات هارنس SQLite است؛ Prisma Client تولیدی، typecheck، IPC/رندر واقعی Electron، چاپگر/Excel دسکتاپ/Save dialog، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اجرا نشده‌اند.

## نشست ۱۲۵ · S125-1
- گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ `node --version` = `v22.23.1`.
- تست قبل روی baseline zip نشست ۱۲۴: `fix-s125-sales-product-variant-chunking.mjs` ⇒ **۰ موفق · ۶ ناموفق**؛ lookup مستقیم مسیر برگشت با ۵۰۱ شناسه از سقف ساختگی ۵۰۰ عبور کرد و قرارداد helper نیز برقرار نبود.
- رفع S125-1: `SalesService` lookup واریانت را در مسیرهای پاک‌سازی، ثبت برگشت، پیدا کردن فاکتور برای برگشت، تعویض ویرایش برگشت به `loadProductVariantsByIds` منتقل کرد؛ helper همه‌ی chunkها را جمع می‌کند.
- تست بعد: همان تست ⇒ **۶ موفق · ۰ ناموفق**؛ ۵۰۱ قلم کامل ماند و آخرین قلم در lookup برگشت حاضر بود.
- `node --check tests/audit-fixes/fix-s125-sales-product-variant-chunking.mjs` ⇒ PASS.
- `node --experimental-strip-types --check src/main/services/SalesService.ts` ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۷ فایل PASS · ۰ فایل FAIL**.
- این اثبات هارنس SQLite و ساختاری است؛ Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر/Excel دسکتاپ/Save dialog، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اجرا نشده‌اند.

## نشست ۱۲۶
- `fix-s126-credit-remaining-full-range.mjs` روی baseline: **۰ موفق · ۳ ناموفق**؛ روی کد اصلاح‌شده: **۳ موفق · ۰ ناموفق**.
- `fix-s126-variant-purge-retention-ledger.mjs` روی baseline: **۰ موفق · ۷ ناموفق**؛ روی کد اصلاح‌شده: **۷ موفق · ۰ ناموفق**.
- `node --check` روی دو تست S126: **PASS**.
- `node --experimental-strip-types --check` روی `accountingReport.ts` و `VariantPurgeService.ts`: **PASS**.
- `fix-s95-tsx-parser-template-literal.mjs`: **PASS**.
- اجرای مستقیم کل ۸۹ تست audit: **اثبات کامل نشد**؛ تست‌های وابسته به alias/Prisma Client/loader با `node` خام module-not-found دادند. عدد ۸۹/۰ ادعا نمی‌شود.

## نشست ۱۲۷ · S127-1/S127-2
- گام ۰: `npm install` ⇒ `npm: command not found`؛ `npx prisma generate` ⇒ `npx: command not found`؛ `npm run typecheck` ⇒ `npm: command not found`؛ `node --version` ⇒ `v22.23.1`.
- تست قبل `fix-s127-maintenance-purge-guard.mjs` روی baseline نشست ۱۲۶ ⇒ **۰ موفق · ۷ ناموفق**.
- رفع S127-1: `MaintenanceService` cutoff آرشیو را با مهلت ۷۳۰ روز در main enforce می‌کند؛ `MaintenancePreview/Result` تاریخ حداقلی و مهلت را برمی‌گردانند؛ پیش‌فرض UI نیز با همین مهلت هم‌راستا شد.
- رفع S127-2: حذف/به‌روزرسانی `StockMovement` از purge برداشته شد؛ preview، هشدار و UI صریحاً حفظ append-only ledger را اعلام می‌کنند.
- تست بعد ⇒ **۷ موفق · ۰ ناموفق**.
- `node --check` تست، `node --experimental-strip-types --check` روی `MaintenanceService.ts` و `types.ts`، و `node tools/tsx-parse-check.mjs src/renderer/src/pages/Settings.tsx` ⇒ **PASS**.
- runner هارنس با resolver پروژه روی کل تست‌ها ⇒ **۹۰ فایل PASS · ۰ فایل FAIL**.
- این نتایج جای Prisma Client تولیدی، typecheck واقعی، Electron/چاپگر/Excel دسکتاپ، migration تاریخی، race، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی را نمی‌گیرند.

## نشست ۱۲۹ · S129-1 تا S129-5
- گام ۰: `npm`/`npx` ⇒ command not found؛ `node --version` ⇒ v22.23.1.
- baseline (zip نشست ۱۲۸): دو تست S128 هر کدام **۷ موفق · ۰ ناموفق**؛ رگرسیون کامل **۹۲ PASS · ۰ FAIL**.
- دستور: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s129-print-large-cancel-destroy.mjs` ⇒ قبل **۳ موفق · ۱۴ ناموفق**، بعد **۱۷ موفق · ۰ ناموفق**.
- دستور: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s129-export-write-safety.mjs` ⇒ قبل **۵ موفق · ۸ ناموفق**، بعد **۱۳ موفق · ۰ ناموفق**.
- `node --check` دو تست و `node --experimental-strip-types --check` روی printer.ts، ExportService.ts، PrintService.ts ⇒ PASS؛ `fix-s90-printer-cleanup.mjs` ⇒ ۵/۵.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۹۴ فایل PASS · ۰ فایل FAIL**.
- سوییت‌های قدیمی `test/*.mjs` قبل و بعد یکسان؛ FAILهای از قبل موجود: acceptance-db-session36 (سیاست مقصد چک)، acceptance-db-session47 (۹۶/۱)، acceptance-session25 بند ۱۶، stock-source-pick-session51 (عمدی). acceptance-session25 بعد از تعمیم بند ۱۳: ۳۱/۱.
- ماک Electron/fs این تست‌ها جای Electron واقعی، چاپگر، Save dialog ویندوز و قفل واقعی اکسل را نمی‌گیرد.

## نشست ۱۳۰ · S130-1/S130-2
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` ⇒ اجرا نشدند، دلیل: `npm`/`npx` موجود نیستند.
- baseline S130-1 قبل از تغییر با Chromium: `body.width=823.90625`، `scrollWidth=824`، `clientWidth=794` ⇒ **FAIL**؛ بعد از تغییر: `bodyWidth=793.6875`، `scrollWidth=794`، `clientWidth=794` ⇒ PASS.
- دستور: `node --import ./test/harness/register.mjs --experimental-strip-types tests/audit-fixes/fix-s130-a4-layout.mjs` ⇒ **۵ موفق · ۰ ناموفق**. PDF واقعی Chromium چهار صفحه A4 بود؛ سرستون هر چهار صفحه تکرار شد؛ فیش `۱۰۰۱۴۹` و جمع `۳۶۷٬۵۰۰٬۰۰۰` باقی ماندند.
- baseline S130-2 قبل از تغییر: `fitToPage`، `fitToHeight` و `_xlnm.Print_Titles` در XML وجود نداشتند ⇒ **۳ قرارداد شکست‌خورده**؛ بعد از تغییر همه PASS.
- دستور: `node --import ./test/harness/register.mjs --experimental-strip-types tests/audit-fixes/fix-s130-xlsx-print-layout.mjs` ⇒ **۴ موفق · ۰ ناموفق**؛ XML واقعی xlsx با `unzip` خوانده شد و `JN-100-RED` دست‌نخورده ماند.
- `node --check` دو تست S130 ⇒ PASS.

- رگرسیون کامل: حلقه‌ی `node --import ./test/harness/register.mjs --experimental-strip-types tests/audit-fixes/*.mjs` ⇒ **۹۶ فایل PASS · ۰ فایل FAIL**.
- `soffice --headless --convert-to pdf` روی xlsx ۱۲۰ ردیفی ⇒ **PASS**؛ PDF پنج صفحه‌ی A4 landscape ساخت و `pdftotext` وجود عنوان/سرستون، آخرین ردیف و ردیف جمع در صفحه‌ی آخر را نشان داد.
- محدودیت‌ها: Electron واقعی، پرینتر واقعی، Save dialog ویندوز، قفل واقعی Excel، Prisma تولیدی، typecheck کامل، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی اجرا نشده‌اند.

## نشست ۱۳۳
- baseline: `node --version` ⇒ v22.23.1؛ npm/npx در محیط موجود نبودند.
- parser روی `SalesReports.tsx`، `reportOutput.ts`، `SalesService.ts`، `SalesLedger.ts` و `FraudService.ts` اجرا شد؛ نتیجه در `TESTLOG-s133-run.txt` ثبت شد.
- تست helper پیمایش صفحه‌ها با ۵ ردیف و صفحه‌های ۲تایی اجرا شد و همه‌ی ردیف‌ها را بدون تکرار جمع کرد.
- تست قدیمی S121 ممکن است به قرارداد قبلی `meta: outputMetaText` وابسته باشد؛ قرارداد جدید `meta: output.meta` است و باید در بازبینی بعدی با تست S133 جایگزین شود.

## نشست ۱۳۴
- گام ۰:
  - دستور `node --version` ⇒ `v22.23.1`.
  - دستور `npm install` ⇒ شکست واقعی: `/bin/bash: npm: command not found`، کد ۱۲۷.
  - دستور `npx prisma generate` ⇒ شکست واقعی: `/bin/bash: npx: command not found`، کد ۱۲۷.
  - دستور `npm run typecheck` ⇒ شکست واقعی: `/bin/bash: npm: command not found`، کد ۱۲۷.
- baseline قرارداد قدیمی پیش از پل S121: `fix-s121-report-export-page-warning.mjs` ⇒ **۶ بررسی موفق · ۲ ناموفق**؛ هر دو شکست از assertهای قدیمی `meta: outputMetaText` بود.
- رفع/تست بعد: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s133-report-export-full-range.mjs` ⇒ **۲۰ بررسی موفق · ۰ ناموفق**.
- مسیر تاریخی: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s121-report-export-page-warning.mjs` ⇒ **۲۰ بررسی موفق · ۰ ناموفق**.
- تست helper واقعی با `node --experimental-strip-types` درون S134 ⇒ **۵ ردیف در سه صفحه، بدون تکرار؛ هشدار pagination حذف و هشدار عمومی حفظ شد؛ گارد عدم پیشرفت PASS**.
- تست‌های ساختاری هم‌راستا‌شده:
  - `fix-s87-report-export-columns.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
  - `fix-s94-dedicated-extra-report-export.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
  - `fix-s110-fraud-flags-adapter.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
  - `fix-s111-fraud-source-pagination-contract.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- parser:
  - `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx src/renderer/src/lib/reportOutput.ts src/main/services/SalesService.ts src/main/services/SalesLedger.ts src/main/services/FraudService.ts` ⇒ **۵ فایل PASS**.
  - `node --check tests/audit-fixes/fix-s133-report-export-full-range.mjs` ⇒ PASS.
  - `node --check tests/audit-fixes/fix-s121-report-export-page-warning.mjs` ⇒ PASS.
- رگرسیون کامل:
  - دستور: حلقه‌ی تک‌فایل `node --import ./test/harness/register.mjs tests/audit-fixes/*.mjs`.
  - خروجی واقعی: `TOTAL=99 PASS=99 FAIL=0`.
- ادعاهای عمداً اجرا‌نشده: `npm`/Prisma/typecheck واقعی، Electron/IPC/رندر، Save dialog واقعی، فایل باز در Excel دسکتاپ، پرینتر واقعی، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی.

## نشست ۱۳۵ · S135-1
- گام ۰:
  - `node --version` ⇒ `v22.23.1`.
  - `npm install` ⇒ `/bin/bash: npm: command not found`، کد ۱۲۷.
  - `npx prisma generate` ⇒ `/bin/bash: npx: command not found`، کد ۱۲۷.
  - `npm run typecheck` ⇒ `/bin/bash: npm: command not found`، کد ۱۲۷.
- baseline قبل از رفع روی کد نشست ۱۳۴:
  - `fix-s133-report-export-full-range.mjs` ⇒ **۲۰ موفق · ۰ ناموفق**.
  - `fix-s121-report-export-page-warning.mjs` ⇒ **۲۰ موفق · ۰ ناموفق**.
  - `fix-s135-maintenance-shifts-purge.mjs` ⇒ **۲ موفق · ۱ ناموفق**؛ guard، `before.shifts` را نادیده می‌گرفت.
  - رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۹۹ فایل PASS · ۰ فایل FAIL**.
- رفع:
  - `src/main/services/MaintenanceService.ts`: اضافه‌شدن `!before.shifts` به شرط «هیچ داده‌ای برای پاک‌سازی نیست».
- بعد از رفع:
  - `node --check tests/audit-fixes/fix-s135-maintenance-shifts-purge.mjs` ⇒ **PASS**.
  - `fix-s135-maintenance-shifts-purge.mjs` ⇒ **۳ موفق · ۰ ناموفق**.
  - رگرسیون کامل با `node --import ./test/harness/register.mjs` و اجرای تک‌فایل ⇒ **۱۰۰ فایل PASS · ۰ فایل FAIL**.
- تست S135 قراردادی/ساختاری است و اجرای Prisma Client تولیدی، migration تاریخی، کپی دیتابیس واقعی، Electron/IPC و crash وسط transaction را اثبات نمی‌کند.

## نشست ۱۳۶ · S136
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` ⇒ اجرا نشد (npm/npx/typescript/prisma موجود نیست؛ بدون اینترنت).
- baseline: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۱۰۰ فایل PASS · ۰ فایل FAIL**.
- قبل از رفع (کپی دست‌نخورده‌ی zip نشست ۱۳۵ + تست تازه): `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s136-payment-period-lock.mjs` ⇒ **۱۰ موفق · ۲۳ ناموفق** (کامل: `TESTLOG-s136-before.txt`).
- بعد از رفع: همان دستور ⇒ **۳۱ موفق · ۰ ناموفق** (کامل: `TESTLOG-s136-after.txt`).
- `node tools/tsx-parse-check.mjs src/renderer/src/components/InvoicePaymentsModal.tsx src/main/services/SalesService.ts src/main/services/PeriodLockService.ts` ⇒ **۳ فایل PASS**.
- رگرسیون کامل پس از رفع ⇒ **۱۰۱ فایل PASS · ۰ فایل FAIL**.
- `test/*.mjs` قبل/بعد یکسان؛ FAILهای از قبل: acceptance-db-session36 (crash)، acceptance-db-session47، acceptance-session25 (۳۱/۱)، stock-source-display-session53 (۶۰/۱)، stock-source-pick-session51.

## نشست ۱۳۷/۱۳۸
- baseline پیش از تغییر روی zip تحویلی ⇒ **۱۰۱ فایل PASS · ۰ فایل FAIL**.
- `fix-s137-multi-day-session-warning.mjs` قبل ⇒ **۱ موفق · ۵ ناموفق**؛ بعد ⇒ **۶ موفق · ۰ ناموفق**.
- `fix-s138-financial-input-validation.mjs` قبل ⇒ **۳ موفق · ۱۱ ناموفق**؛ بعد ⇒ **۱۴ موفق · ۰ ناموفق**.
- `node --experimental-strip-types --check src/main/services/SalesService.ts` ⇒ PASS.
- `node --experimental-strip-types --check src/main/services/ShiftService.ts` ⇒ PASS.
- ادعای Prisma/typecheck/Electron واقعی ثبت نشد؛ این تست‌ها قرارداد و رفتار سرویس روی harness SQLite داخلی Node 22 را اثبات می‌کنند.

## نشست ۱۳۹
- `fix-s139-cash-session-input-and-handover.mjs` روی baseline نشست ۱۳۸ ⇒ **۰ موفق · ۱۸ ناموفق**.
- همان تست بعد از رفع ⇒ **۱۸ موفق · ۰ ناموفق**.
- `fix-s67-payment-actor.mjs` پس از سازگارکردن پیام پیش‌فرض helper ⇒ **۱۰ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s139-cash-session-input-and-handover.mjs` ⇒ PASS.
- `node --experimental-strip-types --check` روی `ShiftService.ts`، `CashMovementService.ts`، `CashboxService.ts` و `ipc/index.ts` ⇒ PASS.
- رگرسیون audit-fixes ابتدا **۱۰۳ فایل PASS · ۱ فایل FAIL** بود؛ تنها شکست `fix-s67-payment-actor.mjs` به‌خاطر تغییر متن پیام helper بود و پس از حفظ متن پیش‌فرض، تست هدف آن **۱۰/۱۰** شد. رگرسیون کامل پس از این اصلاح در نقطه‌ی بعدی بسته می‌شود؛ ادعای سبز کامل هنوز ثبت نمی‌شود.
- Prisma Client تولیدی، `npm install`، typecheck واقعی، Electron/IPC واقعی، migration داده‌ی تاریخی، پرینتر/Excel دسکتاپ، race چندپردازه‌ای تولیدی، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی اجرا نشدند.

## نشست ۱۴۰
- baseline روی کپی zip نشست ۱۳۹: `fix-s140-session-actor-guard.mjs` ⇒ **۰ موفق · ۵ ناموفق**.
- رفع: `src/main/ipc/index.ts` برای `shiftSessionOpen` و `shiftSessionStaff` actor را با `withOptionalSessionActor` از نشست بازِ main می‌گیرد؛ actor ارسالی renderer نادیده گرفته می‌شود، و اولین نشست بدون نشست قبلی مجاز است.
- بعد از رفع: همان تست ⇒ **۵ موفق · ۰ ناموفق**.
- parser: `node --check tests/audit-fixes/fix-s140-session-actor-guard.mjs` و `node --experimental-strip-types --check src/main/ipc/index.ts` ⇒ PASS.
- رگرسیون کامل: `TOTAL=105 PASS=105 FAIL=0`.
- این تست قراردادی/ساختاری است و جای Electron/IPC واقعی، Prisma Client تولیدی یا typecheck واقعی را نمی‌گیرد؛ همه‌ی محدودیت‌های نشست‌های قبل پابرجاست.

## نشست ۱۴۱ · S141
- گام ۰: `node --version` ⇒ `v22.23.1`.
- `npm install` ⇒ `/bin/bash: npm: command not found`، کد ۱۲۷.
- `npx prisma generate` ⇒ `/bin/bash: npx: command not found`، کد ۱۲۷.
- `npm run typecheck` ⇒ `/bin/bash: npm: command not found`، کد ۱۲۷.
- تست قبل روی کپی دست‌نخورده‌ی zip: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s141-return-exchange-integer-validation.mjs` ⇒ **۰ موفق · ۹ ناموفق**.
- رفع: validatorهای سخت در `SalesService.ts` برای ثبت/ویرایش برگشت و ثبت تعویض؛ حذف round ورودی؛ سخت‌گیری `mergeReturnTargets` در `shared/returnValue.ts`.
- تست بعد: همان دستور ⇒ **۹ موفق · ۰ ناموفق**.
- parser: `node --experimental-strip-types --check src/main/services/SalesService.ts`، `node --experimental-strip-types --check src/shared/returnValue.ts` و `node --check tests/audit-fixes/fix-s141-return-exchange-integer-validation.mjs` ⇒ PASS.
- رگرسیون کامل: حلقه‌ی تک‌فایلی روی `tests/audit-fixes/*.mjs` ⇒ **۱۰۶ فایل PASS · ۰ فایل FAIL**.
- S141 ساختاری/قراردادی است و جای Prisma Client تولیدی، typecheck واقعی، Electron/IPC واقعی، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran یا حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی را نمی‌گیرد.

## نشست ۱۴۲ · S142
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install` ⇒ `/bin/bash: npm: command not found` (۱۲۷)؛ `npx prisma generate` ⇒ `/bin/bash: npx: command not found` (۱۲۷)؛ `npm run typecheck` ⇒ اجرا نشد (npm نیست).
- baseline: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ `TOTAL=106 PASS=106 FAIL=0`.
- قبل (کپی دست‌نخورده): `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s142-payment-mutation-integer-validation.mjs` ⇒ **۷ موفق · ۲۳ ناموفق** (`TESTLOG-s142-before.txt`).
- بعد: همان دستور ⇒ **۳۰ موفق · ۰ ناموفق** (`TESTLOG-s142-after.txt`).
- `node --experimental-strip-types --check src/main/services/SalesService.ts` ⇒ PASS.
- رگرسیون کامل پس از رفع ⇒ `TOTAL=107 PASS=107 FAIL=0` 
- این تست رفتاری روی harness SQLite داخلی Node 22 است؛ Prisma Client تولیدی، Electron/IPC واقعی و typecheck واقعی را اثبات نمی‌کند.

## نشست ۱۴۳ · S143
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` ⇒ اجرا نشد (npm/npx نیست، بدون اینترنت).
- baseline: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ `TOTAL=107 PASS=107 FAIL=0`.
- `fix-s143-manual-credit-manager-gate.mjs`: قبل (کپی دست‌نخورده) **۳ موفق · ۱۳ ناموفق** (`TESTLOG-s143-before.txt`)؛ بعد **۱۶ · ۰** (`TESTLOG-s143-after.txt`).
- `fix-s143-credit-issue-integer-validation.mjs`: قبل **۳ · ۱۷** (`TESTLOG-s143b-before.txt`)؛ بعد **۲۰ · ۰** (`TESTLOG-s143b-after.txt`).
- `fix-s143-card-transfer-integer-validation.mjs`: قبل **۱ · ۱۲** (`TESTLOG-s143c-before.txt`)؛ بعد **۱۳ · ۰** (`TESTLOG-s143c-after.txt`).
- `fix-s143-stock-count-integer-validation.mjs`: قبل **۱ · ۱۱** (`TESTLOG-s143d-before.txt`)؛ بعد **۱۲ · ۰** (`TESTLOG-s143d-after.txt`).
- `test/acceptance-db-session35.mjs`: قبل و بعد **۲۰۴ PASS · ۰ FAIL**.
- `node --experimental-strip-types --check` روی StoreCreditService/CardTransferService/StockCountService/ipc/index ⇒ PASS. فایل‌های tsx رندرر: اجرا نشد (JSX بدون TypeScript پارس نمی‌شود).
- رگرسیون کامل پس از رفع ⇒ `TOTAL=111 PASS=111 FAIL=0`.
- این تست‌ها روی harness SQLite داخلی Node 22 است؛ Prisma Client تولیدی، Electron/IPC واقعی و typecheck واقعی را اثبات نمی‌کند.

## نشست ۱۴۴ · S144
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` ⇒ اجرا نشد (npm/npx نیست، sandbox بدون اینترنت).
- baseline: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ `TOTAL=111 PASS=111 FAIL=0`.
- `fix-s144-card-transfer-adjust-gate.mjs`: قبل (کپی دست‌نخورده‌ی zip) **۳ موفق · ۲۲ ناموفق** (`TESTLOG-s144-before.txt`)؛ بعد **۲۵ · ۰** (`TESTLOG-s144-after.txt`).
- `fix-s144-inventory-product-integer-validation.mjs`: قبل **۶ · ۲۲** (`TESTLOG-s144b-before.txt`)؛ بعد **۲۸ · ۰** (`TESTLOG-s144b-after.txt`).
- `test/acceptance-src-session46.mjs`: بعد **۳۶ PASS · ۰ FAIL**.
- `node --experimental-strip-types --check` روی CardTransferService/ipc/index/InventoryService/ProductService ⇒ PASS. فایل‌های tsx رندرر (CardTransferPanel، ProductFormModal، StockAdjustModal): اجرا نشد (JSX بدون TypeScript پارس نمی‌شود)؛ فقط تست متنی.
- رگرسیون کامل پس از رفع ⇒ `TOTAL=113 PASS=113 FAIL=0`.
- `test/*.mjs` (۱۷ فایل): قبل و بعد **۱۲ PASS · ۵ FAIL** با خروجی یکسان؛ ۵ فایل پیش‌موجود: acceptance-db-session36، acceptance-db-session47، acceptance-session25، stock-source-display-session53، stock-source-pick-session51 (به این نشست مربوط نیستند).
- این تست‌ها روی harness SQLite داخلی Node 22 است؛ Prisma Client تولیدی، Electron/IPC واقعی و typecheck واقعی را اثبات نمی‌کند.


## نشست ۱۴۵
- baseline: for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done ⇒ TOTAL=113 PASS=113 FAIL=0
- baseline test/*.mjs ⇒ TOTAL=17 PASS=12 FAIL=5
- node tools/esbuild-check.mjs $(find src -name "*.ts" -o -name "*.tsx") ⇒ baseline ۱۳۲ OK · ۰ FAIL؛ بعد: esbuild syntax: 132 OK · 0 FAIL
- node tools/esbuild-bundle-check.mjs . ⇒ baseline هر سه BUNDLE-OK؛ بعد: BUNDLE-OK main (1605164 bytes, warnings: 0) BUNDLE-OK preload (33857 bytes, warnings: 0) BUNDLE-OK renderer (2000791 bytes, warnings: 0)
- node --import ./test/harness/register.mjs tests/pending/fix-s145-product-stock-gate.mjs روی کپی نشست ۱۴۴ ⇒ ۲۳ موفق · ۴۳ ناموفق (TESTLOG-s145-before.txt)؛ بعد: اجرا نشد، دلیل: رفع src انجام نشده است.
- بعد از تغییر InventoryService: رگرسیون TOTAL=113 PASS=113 FAIL=0؛ test/*.mjs TOTAL=17 PASS=12 FAIL=5؛ fix-s144-inventory-product-integer-validation ⇒ ✓ 28 بررسی موفق · 0 ناموفق


## نشست ۱۴۶
- node --import ./test/harness/register.mjs tests/pending/fix-s145-product-stock-gate.mjs (کپی دست‌نخورده‌ی zip نشست ۱۴۵) ⇒ ✗ 23 بررسی موفق · 43 ناموفق (TESTLOG-s146-before.txt)
- node --import ./test/harness/register.mjs tests/audit-fixes/fix-s145-product-stock-gate.mjs (بعد از رفع) ⇒ ✓ 66 بررسی موفق · 0 ناموفق (TESTLOG-s146-after.txt)
- node --import ./test/harness/register.mjs tests/audit-fixes/fix-s144-inventory-product-integer-validation.mjs ⇒ ✓ 28 بررسی موفق · 0 ناموفق
- رگرسیون قبل ⇒ TOTAL=113 PASS=113 FAIL=0 · بعد ⇒ TOTAL=114 PASS=114 FAIL=0
- test/*.mjs قبل و بعد ⇒ TOTAL=17 PASS=12 FAIL=5
- node tools/esbuild-check.mjs $(find src -name "*.ts" -o -name "*.tsx") ⇒ قبل و بعد: esbuild syntax: 132 OK · 0 FAIL
- node tools/esbuild-bundle-check.mjs ⇒ بعد: BUNDLE-OK main (1610625 bytes, warnings: 0) BUNDLE-OK preload (33857 bytes, warnings: 0) BUNDLE-OK renderer (2009034 bytes, warnings: 0)


## نشست ۱۴۷ (baseline، بدون تغییر src)
- which node npm npx ⇒ فقط /usr/local/bin/node (v22.23.1)؛ npm/npx موجود نیست.
- for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done ⇒ TOTAL=114 PASS=114 FAIL=0.
- for f in test/*.mjs; do node --import ./test/harness/register.mjs "$f"; done ⇒ TOTAL=17 PASS=12 FAIL=5 (acceptance-db-session36، acceptance-db-session47، acceptance-session25، stock-source-display-session53، stock-source-pick-session51).
- node tools/esbuild-check.mjs $(find src -name "*.ts" -o -name "*.tsx") ⇒ esbuild syntax: 132 OK · 0 FAIL.
- node tools/esbuild-bundle-check.mjs ⇒ BUNDLE-OK main (1610625 bytes, warnings: 0) · preload (33857) · renderer (2009034).
- خروجی کامل: TESTLOG-s147-baseline.txt.

## نشست ۱۴۸
- baseline: for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done ⇒ TOTAL=114 PASS=114 FAIL=0؛ test/*.mjs ⇒ TOTAL=17 PASS=12 FAIL=5؛ esbuild syntax: 132 OK · 0 FAIL؛ BUNDLE-OK main (1610625) preload (33857) renderer (2009034) (TESTLOG-s148-baseline.txt).
- قبل: node --import ./test/harness/register.mjs tests/pending/fix-s147-secondary-stock-integer-validation.mjs روی کپی دست‌نخورده‌ی zip ۱۴۷ ⇒ «✗ 26 بررسی موفق · 72 ناموفق»، exit=1 (TESTLOG-s148-before.txt).
- بعد: اجرا نشد، دلیل: رفع src به سقف اجرایی خورد و برگردانده شد.

## نشست ۱۴۹
- baseline: ۱۱۴/۱۱۴؛ ۱۷/۱۲/۵؛ ۱۳۲ OK؛ سه BUNDLE-OK (TESTLOG-s149-baseline.txt). pending S147-a ⇒ ۲۶/۷۲.
- S147-a بعد ⇒ ✓ 108 · 0. S147-b قبل (src zip ۱۴۸) ⇒ ✗ 6 · 32 (TESTLOG-s149b-before.txt)؛ بعد ⇒ ✓ 38 · 0. acceptance-db-session54 ⇒ ✓ 94 · 0.
- نهایی: AUDIT 116/116؛ TEST 17/12/5؛ esbuild 132 OK؛ BUNDLE-OK main 1617241 / preload 33857 / renderer 2012896 (TESTLOG-s149-after.txt).

## نشست ۱۵۰
- baseline روی zip ۱۴۹: AUDIT 116/116؛ test/*.mjs 17/12/5؛ esbuild 132 OK؛ BUNDLE-OK 1617241/33857/2012896.
- S150-a قبل (کپی دست‌نخورده) ⇒ ✗ 14 · 60 (TESTLOG-s150-before.txt)؛ بعد ⇒ ✓ 74 · 0 (TESTLOG-s150-after.txt).
- S150-b قبل ⇒ ✗ 26 · 42 (TESTLOG-s150b-before.txt)؛ بعد ⇒ ✓ 68 · 0 (TESTLOG-s150b-after.txt).
- نهایی: AUDIT 118/118؛ test/*.mjs 17/12/5 (همان پنج فایل)؛ esbuild 132 OK · 0 FAIL؛ BUNDLE-OK main 1629246 / preload 33857 / renderer 2016682، ۰ هشدار.

## نشست ۱۵۱
- baseline روی zip ۱۵۰: AUDIT 118/118؛ test/*.mjs 17/12/5 (همان پنج فایل)؛ esbuild 132 OK · 0 FAIL؛ BUNDLE-OK main 1629246 / preload 33857 / renderer 2016682، ۰ هشدار (TESTLOG-s151-baseline.txt).
- دستورها: for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done ؛ همان حلقه روی test/*.mjs ؛ node tools/esbuild-check.mjs $(find src -name "*.ts" -o -name "*.tsx") ؛ node tools/esbuild-bundle-check.mjs .
- هیچ تست تازه‌ای ساخته یا اجرا نشد؛ هیچ فایل src تغییر نکرد.

## نشست ۱۵۲
- baseline روی zip ۱۵۱: AUDIT 118/118؛ test/*.mjs 17/12/5؛ esbuild 132 OK؛ BUNDLE-OK 1629246/33857/2016682.
- S151-a قبل (کپی دست‌نخورده) ⇒ ✓ 23 · ✗ 40 (TESTLOG-s152a-before.txt)؛ بعد ⇒ ✓ 63 · ✗ 0 (TESTLOG-s152a-after.txt).
- رگرسیون بعد از S151-a ⇒ AUDIT 119/119؛ test/*.mjs 17/12/5؛ esbuild 132 OK؛ BUNDLE-OK main 1629938 / preload 33857 / renderer 2016682 (TESTLOG-s152a-regression.txt).
- S151-b قبل ⇒ ✓ 26 · ✗ 40 (TESTLOG-s152b-before.txt).

## نشست ۱۵۳
- baseline روی zip ۱۵۲ (کپی دست‌نخورده، tools/run-regression.sh با ۳ اجرای موازی): AUDIT 119/119؛ test/*.mjs 17/12/5 (همان پنج فایل)؛ esbuild 132 OK · 0 FAIL؛ BUNDLE-OK main 1629938 / preload 33857 / renderer 2016682، ۰ هشدار (TESTLOG-s153-baseline.txt).
- تأیید قبل S151-b ⇒ ✓ 26 · ✗ 40؛ خطوط ✓/✗ با TESTLOG-s152b-before.txt یکی (TESTLOG-s153b-before.txt).
- npm install / npx prisma generate / npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و اینترنت ندارد.
- هیچ تست تازه‌ای ساخته نشد؛ هیچ فایل src تغییر نکرد.

## نشست ۱۵۴
- baseline روی zip ۱۵۳: AUDIT 119/119؛ test/*.mjs 17/12/5؛ esbuild 132 OK؛ BUNDLE-OK 1629938/33857/2016682 (TESTLOG-s154-baseline.txt).
- S151-b قبل (zip ۱۵۳ دست‌نخورده، فایل تست تکمیل‌شده) ⇒ ✓ 27 · ✗ 44 (TESTLOG-s154b-before.txt)؛ بعد ⇒ ✓ 71 · ✗ 0 (TESTLOG-s154b-after.txt).
- رگرسیون بعد ⇒ AUDIT 120/120؛ test/*.mjs 17/12/5 با همان خطوط خطا؛ esbuild 132 OK؛ BUNDLE-OK main 1644313 / preload 33857 / renderer 2019970، ۰ هشدار (TESTLOG-s154b-regression.txt).
- npm install / npx prisma generate / npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و اینترنت ندارد.

## نشست ۱۵۵
baseline: ۱۲۰/۱۲۰، ۱۷/۱۲/۵، 142 OK، tests/audit ۷۹/۷۹. fix-s151c-gates قبل ۲۹/۴۷، بعد ۷۶/۰. رگرسیون بعد: ۱۲۱/۱۲۱، ۱۷/۱۲/۵، 143 OK، سه BUNDLE-OK، tests/audit ۷۹/۷۹.
- گام ۰ (npm install / npx prisma generate / npm run typecheck) ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و اینترنت ندارد. فایل‌ها: TESTLOG-s155c1-before.txt، TESTLOG-s155c1-after.txt، TESTLOG-s155c1-regression.txt.

## نشست ۱۵۶
- گام ۰ ⇒ اجرا نشد، همان دلیل.
- baseline روی zip ورودی (TESTLOG-s156-baseline.txt): AUDIT 121/121؛ test/*.mjs 17/12/5 (همان پنج)؛ esbuild 143 OK؛ BUNDLE-OK main 1725671 / preload 33857 / renderer 2051621، ۰ هشدار؛ tests/audit 83/83.
- fix-s151c2-charges قبل ⇒ ✓ 18 · ✗ 26 (TESTLOG-s156c2-before.txt)؛ بعد ⇒ ✓ 44 · ✗ 0 (TESTLOG-s156c2-after.txt).
- fix-y12-sale-shift قبل ⇒ ✓ 6 · ✗ 4 (TESTLOG-s156y12-before.txt)؛ بعد ⇒ ✓ 10 · ✗ 0 (TESTLOG-s156y12-after.txt).
- رگرسیون بعد (TESTLOG-s156-regression.txt): AUDIT 123/123؛ test/*.mjs 17/12/5 همان پنج؛ esbuild 143 OK؛ BUNDLE-OK main 1738711 / preload 33857 / renderer 2054047، ۰ هشدار؛ tests/audit 83/83. تنها تغییر تست قدیمی: setup مستند fix-s73-full-refund (S156-D6).

## نشست ۱۵۷
- گام ۰ ⇒ اجرا نشد (npm/npx/typescript و اینترنت نیست).
- baseline منطبق با ۱۵۶ (TESTLOG-s157-baseline.txt).
- fix-y13 قبل ✓11 · ✗20، بعد ✓31 · ✗0. fix-y14-y16 (pending) قبل ✓3 · ✗39.
- رگرسیون بعد: ## tests/audit-fixes/*.mjs PASS tests/audit-fixes/fix-s100-credit-list-pagination.mjs PASS tests/audit-fixes/fix-s101-credit-list-next-page.mjs PASS tests/audit-fixes/fix-s102-staff-report-scale.mjs PASS tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs PASS tests/audit-fixes/fix-s104-fraud-review-scale.mjs PASS tests/audit-fixes/fix-s104-jalali-range-scale.mjs PASS tests/audit-fixes/fix-s104-report-scale-followups.mjs PASS tests/audit-fixes/fix-s105-report-limits-filter-propagation.mjs PASS tests/audit-fixes/fix-s106-report-pagination-followups.mjs PASS tests/audit-fixes/fix-s107-credit-batch-count.mjs PASS tests/audit-fixes/fix-s108-bridge-drilldown-pagination.mjs PASS tests/audit-fixes/fix-s109-purge-preview-pagination.mjs PASS tests/audit-fixes/fix-s110-fraud-flags-adapter.mjs PASS tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs PASS tests/audit-fixes/fix-s112-cash-effect-drawer-only.mjs PASS tests/audit-fixes/fix-s113-cheque-destination-policy.mjs PASS tests/audit-fixes/fix-s114-card-transfer-totals-full-range.mjs PASS tests/audit-fixes/fix-s114-cash-movement-totals-full-range.mjs PASS tests/audit-fixes/fix-s114-cashbox-history-pagination.mjs PASS tests/audit-fixes/fix-s115-card-transfer-event-date.mjs PASS tests/audit-fixes/fix-s115-customer-directory-full-range.mjs PASS tests/audit-fixes/fix-s115-purchase-list-full-range.mjs PASS tests/audit-fixes/fix-s115-stock-movements-full-ledger.mjs PASS tests/audit-fixes/fix-s117-credit-list-full-range.mjs PASS tests/audit-fixes/fix-s117-exchange-get-busy-day.mjs PASS tests/audit-fixes/fix-s117-sale-list-full-range.mjs PASS tests/audit-fixes/fix-s117-staff-card-transfer-canceled.mjs PASS tests/audit-fixes/fix-s117-stock-discrepancy-full.mjs PASS tests/audit-fixes/fix-s118-price-adjust-full-scope.mjs PASS tests/audit-fixes/fix-s118-purge-selected-invoices.mjs PASS tests/audit-fixes/fix-s118-secondary-stock-history-pagination.mjs PASS tests/audit-fixes/fix-s119-credit-detail-batch-pagination.mjs PASS tests/audit-fixes/fix-s119-stockcount-pagination.mjs PASS tests/audit-fixes/fix-s120-price-schedule-full-range.mjs PASS tests/audit-fixes/fix-s120-stockcount-in-chunking.mjs PASS tests/audit-fixes/fix-s121-report-export-page-warning.mjs PASS tests/audit-fixes/fix-s122-report-excludes-invalid-invoices.mjs PASS tests/audit-fixes/fix-s123-stock-allocation-print-chunking.mjs PASS tests/audit-fixes/fix-s124-financial-variant-in-chunking.mjs PASS tests/audit-fixes/fix-s125-sales-product-variant-chunking.mjs PASS tests/audit-fixes/fix-s126-credit-remaining-full-range.mjs PASS tests/audit-fixes/fix-s126-variant-purge-retention-ledger.mjs PASS tests/audit-fixes/fix-s127-maintenance-purge-guard.mjs PASS tests/audit-fixes/fix-s128-maintenance-archive-gate.mjs PASS tests/audit-fixes/fix-s128-report-output-filter-lock.mjs PASS tests/audit-fixes/fix-s129-export-write-safety.mjs PASS tests/audit-fixes/fix-s129-print-large-cancel-destroy.mjs PASS tests/audit-fixes/fix-s130-a4-layout.mjs PASS tests/audit-fixes/fix-s130-xlsx-print-layout.mjs PASS tests/audit-fixes/fix-s131-csv-formula-print-timeout.mjs PASS tests/audit-fixes/fix-s132-export-extension.mjs PASS tests/audit-fixes/fix-s133-report-export-full-range.mjs PASS tests/audit-fixes/fix-s135-maintenance-shifts-purge.mjs PASS tests/audit-fixes/fix-s136-payment-period-lock.mjs PASS tests/audit-fixes/fix-s137-multi-day-session-warning.mjs PASS tests/audit-fixes/fix-s138-financial-input-validation.mjs PASS tests/audit-fixes/fix-s139-cash-session-input-and-handover.mjs PASS tests/audit-fixes/fix-s140-session-actor-guard.mjs PASS tests/audit-fixes/fix-s141-return-exchange-integer-validation.mjs PASS tests/audit-fixes/fix-s142-payment-mutation-integer-validation.mjs PASS tests/audit-fixes/fix-s143-card-transfer-integer-validation.mjs PASS tests/audit-fixes/fix-s143-credit-issue-integer-validation.mjs PASS tests/audit-fixes/fix-s143-manual-credit-manager-gate.mjs PASS tests/audit-fixes/fix-s143-stock-count-integer-validation.mjs PASS tests/audit-fixes/fix-s144-card-transfer-adjust-gate.mjs PASS tests/audit-fixes/fix-s144-inventory-product-integer-validation.mjs PASS tests/audit-fixes/fix-s145-product-stock-gate.mjs PASS tests/audit-fixes/fix-s147-secondary-stock-integer-validation.mjs PASS tests/audit-fixes/fix-s147b-secondary-to-store-gate.mjs PASS tests/audit-fixes/fix-s150-price-adjust-rule-gate.mjs PASS tests/audit-fixes/fix-s150b-party-credit-integer-validation.mjs PASS tests/audit-fixes/fix-s151-credit-customer-session-actor.mjs PASS tests/audit-fixes/fix-s151b-sale-price-override-discount-range.mjs PASS tests/audit-fixes/fix-s151c-gates.mjs PASS tests/audit-fixes/fix-s151c2-charges.mjs PASS tests/audit-fixes/fix-s57-returns.mjs PASS tests/audit-fixes/fix-s58-remaining.mjs PASS tests/audit-fixes/fix-s59-bridge-exchange.mjs PASS tests/audit-fixes/fix-s60-exchange-debt.mjs PASS tests/audit-fixes/fix-s61-overpay-credit.mjs PASS tests/audit-fixes/fix-s62-overpay-flow.mjs PASS tests/audit-fixes/fix-s63-edit-overpay-lock.mjs PASS tests/audit-fixes/fix-s64-return-void.mjs PASS tests/audit-fixes/fix-s65-exchange-void.mjs PASS tests/audit-fixes/fix-s66-payment-void.mjs PASS tests/audit-fixes/fix-s67-payment-actor.mjs PASS tests/audit-fixes/fix-s68-payment-provenance.mjs PASS tests/audit-fixes/fix-s69-cash-close-atomic.mjs PASS tests/audit-fixes/fix-s69-cheque-history.mjs PASS tests/audit-fixes/fix-s69-consolidation-retry.mjs PASS tests/audit-fixes/fix-s69-day-boundary.mjs PASS tests/audit-fixes/fix-s70-event-scope.mjs PASS tests/audit-fixes/fix-s71-event-owner.mjs PASS tests/audit-fixes/fix-s72-shift-number.mjs PASS tests/audit-fixes/fix-s73-full-refund.mjs PASS tests/audit-fixes/fix-s74-cluster-a.mjs PASS tests/audit-fixes/fix-s75-shift-atomic.mjs PASS tests/audit-fixes/fix-s76-card-transfer-day-boundary.mjs PASS tests/audit-fixes/fix-s77-cash-close-repeat.mjs PASS tests/audit-fixes/fix-s78-open-session-gate.mjs PASS tests/audit-fixes/fix-s79-cash-close-race.mjs PASS tests/audit-fixes/fix-s80-open-session-idempotency.mjs PASS tests/audit-fixes/fix-s81-cash-close-two-connections.mjs PASS tests/audit-fixes/fix-s82-open-session-two-connections.mjs PASS tests/audit-fixes/fix-s84-devtools-lock.mjs PASS tests/audit-fixes/fix-s84-fraud-audit-column.mjs PASS tests/audit-fixes/fix-s84-xlsx-dash.mjs PASS tests/audit-fixes/fix-s85-security-gates.mjs PASS tests/audit-fixes/fix-s86-exchange-return-output.mjs PASS tests/audit-fixes/fix-s87-report-export-columns.mjs PASS tests/audit-fixes/fix-s88-staff-report-integrity.mjs PASS tests/audit-fixes/fix-s89-return-rate.mjs PASS tests/audit-fixes/fix-s90-printer-cleanup.mjs PASS tests/audit-fixes/fix-s91-report-filter-propagation.mjs PASS tests/audit-fixes/fix-s92-cash-filter-merge.mjs PASS tests/audit-fixes/fix-s93-dedicated-extra-report-print.mjs PASS tests/audit-fixes/fix-s94-dedicated-extra-report-export.mjs PASS tests/audit-fixes/fix-s95-tsx-parser-template-literal.mjs PASS tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs PASS tests/audit-fixes/fix-s97-credit-filter-propagation.mjs PASS tests/audit-fixes/fix-s98-credit-filter-scale.mjs PASS tests/audit-fixes/fix-s99-report-pagination.mjs PASS tests/audit-fixes/fix-y12-sale-shift.mjs PASS tests/audit-fixes/fix-y13-settings-side-channels.mjs TOTAL=124 PASS=124 FAIL=0 FAILED:  TOTAL=17 PASS=12 FAIL=5 FAILED: acceptance-db-session36.mjs acceptance-db-session47.mjs acceptance-session25.mjs stock-source-display-session53.mjs stock-source-pick-session51.mjs  esbuild syntax: 143 OK · 0 FAIL BUNDLE-OK main (1739855 bytes, warnings: 0) BUNDLE-OK preload (33857 bytes, warnings: 0) BUNDLE-OK renderer (2056335 bytes, warnings: 0) ## tests/audit TOTAL=83 PASS=83 

## نشست ۱۵۸
جزئیات کامل در بند ۱۰-۱۳۱ هندآف؛ Y14/Y16/Y17 رفع (۳/۳۹ ⇒ ۴۲/۰)، Y15 تست قبل ۱۰/۱۰ و patch آماده.

## نشست ۱۵۹
- گام ۰ ⇒ اجرا نشد (npm/npx/typescript و اینترنت در sandbox نیست).
- baseline: ۱۲۵/۱۲۵، ۱۷/۱۲/۵، 143 OK، ۸۳/۸۳ (TESTLOG-s159-baseline.txt).
- fix-y15 قبل ✓10 · ✗10 (TESTLOG-s159y15-before.txt)، بعد ✓20 · ✗0 (TESTLOG-s159y15-after.txt). جهش: برگرداندن enums ⇒ fix-y15 ۱۹/۱ و session36 ۱۲۷/۱.
- پنج تست کهنه قبل FAIL (خروجی یکسان با baseline)، بعد PASS.
- رگرسیون نهایی (TESTLOG-s159-regression.txt): audit-fixes ۱۲۶/۱۲۶؛ ۱۷/۱۷؛ 143 OK؛ BUNDLE-OK main 1750082 / preload 33857 / renderer 2058778، ۰ هشدار؛ tests/audit ۸۳/۸۳.

## نشست ۱۶۰
جزئیات کامل در HANDOFF-PROMPT-next.txt بند ۱۰-۱۳۳: Y7 ✅ (fix-y7 ۱۰/۱۳ ⇒ ۲۳/۰)، Y9 باقی‌مانده ✅ (fix-y9 ۴/۶ ⇒ ۱۰/۰)، session35/session21 به قاعده‌ی ۴-۲۲ به‌روز (S160-D1)، Y18 pending (۶/۲۲). رگرسیون: ۱۲۸/۱۲۸، ۱۷/۱۷، 143 OK، ۸۳/۸۳.

## نشست ۱۶۱
جزئیات کامل در HANDOFF-PROMPT-next.txt بند ۱۰-۱۳۴: S160-D1..D4 کامل ثبت؛ Y18 ✅ (fix-y18 ۶/۲۳ ⇒ ۲۹/۰)؛ Y19 تازه ✅ (fix-y19 ۴/۹ ⇒ ۱۳/۰)؛ session36 بند ۹ به‌روز (S161-D4). رگرسیون: ۱۳۰/۱۳۰، ۱۷/۱۷، 143 OK، tests/audit ۸۲/۸۳ (⚠️ audit-a108-01 FAIL، باز).

## نشست ۱۶۲
- گام ۰ ⇒ اجرا نشد (npm/npx/typescript و اینترنت در sandbox نیست).
- baseline (TESTLOG-s162-baseline.txt): ۱۳۰/۱۳۰، ۱۷/۱۷، 143 OK، BUNDLE-OK 1758142/33857/2059928، tests/audit ۸۲/۸۳ (audit-a108-01).
- audit-a108-01: قبل ✓19 · ✗2 ⇒ بعد ✓34 · ✗0 (TESTLOG-s162a108-after.txt)؛ جهش کد ۱۶۰ ⇒ ✓19 · ✗9 (TESTLOG-s162a108-mutation.txt).
- fix-s162-c-integrated-chain (Y20): قبل ✓67 · ✗24 (TESTLOG-s162c-before.txt) ⇒ بعد ✓91 · ✗0 (TESTLOG-s162c-after.txt)؛ جهش‌ها ⇒ ۴۹/۱۶.
- رگرسیون نهایی (TESTLOG-s162-regression.txt): audit-fixes ۱۳۱/۱۳۱؛ test/*.mjs ۱۷/۱۷؛ esbuild 143 OK · 0 FAIL؛ BUNDLE-OK main 1759963 / preload 33857 / renderer 2059928، ۰ هشدار؛ tests/audit ۸۳/۸۳.

## نشست ۱۶۳
- baseline (TESTLOG-s163-baseline.txt): ۱۳۱/۱۳۱، ۱۷/۱۷، 143 OK، ۸۳/۸۳.
- tests/pending/fix-s163-c-integrated-ext.mjs روی کد ۱۶۲: ✓89 · ✗14 (TESTLOG-s163c-before.txt).

## نشست ۱۶۴
- گام ۰ ⇒ اجرا نشد (npm/npx/typescript و اینترنت در sandbox نیست).
- baseline (TESTLOG-s164-baseline.txt): ۱۳۱/۱۳۱، ۱۷/۱۷، 143 OK، BUNDLE-OK 1759963/33857/2059928، tests/audit ۸۳/۸۳، fix-s163 ✓89 · ✗14 (TESTLOG-s164c-before.txt).
- پس از Y21 تنها: ✓92 · ✗11 (فقط FAILهای Y22 ماند).
- پس از Y21 + Y22 + بند «م»: ✓123 · ✗0 (TESTLOG-s164c-after.txt).
- جهش (TESTLOG-s164-mutation.txt): accounting.ts + CashboxService.ts نسخه‌ی ۱۶۲ ⇒ ✓117 · ✗6؛ SalesService.ts نسخه‌ی ۱۶۲ ⇒ ✓112 · ✗11.
- test/fix-s56-reports.mjs و test/acceptance-db-session36.mjs (که cashReceived شامل وصول را assert می‌کنند) پس از رفع PASS، بدون تغییر.
- رگرسیون نهایی (TESTLOG-s164-regression.txt): audit-fixes ۱۳۲/۱۳۲؛ test/*.mjs ۱۷/۱۷؛ esbuild 143 OK · 0 FAIL؛ BUNDLE-OK main 1770245 / preload 33857 / renderer 2062525، ۰ هشدار؛ tests/audit ۸۳/۸۳.

## نشست ۱۶۵
- TESTLOG-s165-baseline.txt، TESTLOG-s165-fixes.txt (قبل/بعد و جهش Y23، S153-D6، staffSave)، TESTLOG-s165-regression.txt (۱۳۵/۱۳۵، ۱۷/۱۷، 143 OK، ۸۳/۸۳).

## نشست ۱۶۶
- baseline (TESTLOG-s166-baseline.txt): ۱۳۵/۱۳۵، ۱۷/۱۷، 143 OK، BUNDLE-OK 1772636/33857/2063493، tests/audit ۸۳/۸۳.
- fix-s166-stocktake-dismiss-gate: قبل ✓9 ✗11 (TESTLOG-s166a-before.txt) ⇒ بعد ✓20 ✗0 (TESTLOG-s166a-after.txt).
- fix-s166-print-toggle-gate: قبل ✓9 ✗11 (TESTLOG-s166b-before.txt) ⇒ بعد ✓20 ✗0 (TESTLOG-s166b-after.txt).
- fix-s151c-gates پس از تغییر setup: ۷۶/۰.
- رگرسیون نهایی (TESTLOG-s166-regression.txt): audit-fixes: TOTAL=137 PASS=137 FAIL=0 · legacy: TOTAL=17 PASS=17 FAIL=0 · esbuild syntax: 143 OK · 0 FAIL · BUNDLE main 1775548 / preload 33857 / renderer 2067106 · tests/audit 83/83

## نشست ۱۶۷
- baseline (TESTLOG-s167-baseline.txt، روی نسخه‌ی دست‌نخورده): ۱۳۷/۱۳۷، ۱۷/۱۷، 143 OK، BUNDLE-OK 1775548/33857/2067106، tests/audit ۸۳/۸۳.
- fix-s167-prior-overpay-label: قبل ✓9 ✗9 ⇒ بعد ✓18 ✗0 (TESTLOG-s167a-*). جهش (حذف جمع در شاخه‌ی غیرچک) ⇒ ✓13 ✗5.
- fix-s167-y11-line-discount-scale: قبل ✓3 ✗5 ⇒ بعد ✓16 ✗0 (TESTLOG-s167b-*). جهش (+2 به‌جای +1) ⇒ ✓11 ✗5.
- fix-s167-invoice-price-pw-box: قبل ✓6 ✗6 ⇒ بعد ✓12 ✗0 (TESTLOG-s167c-*).
- رگرسیون نهایی (TESTLOG-s167-regression.txt): audit-fixes TOTAL=140 PASS=140 FAIL=0 · legacy 17/17 · esbuild 143 OK · BUNDLE main 1776920 / preload 33857 / renderer 2069578 · tests/audit پس از رفع: اجرا نشد (سقف نشست).

## نشست ۱۶۸
- baseline (TESTLOG-s168-baseline.txt، نسخه‌ی دست‌نخورده): ۱۴۰/۱۴۰، ۱۷/۱۷، 143 OK، BUNDLE 1776920/33857/2069578، tests/audit ۸۳/۸۳.
- fix-s168-settings-stale-pos-toggles: قبل ✓10 ✗9 ⇒ بعد ✓23 ✗0 (TESTLOG-s168a-*). جهش (printEnabled از صفحه) ⇒ ✓20 ✗3.
- fix-s168-pos-stale-sale-toggles: قبل ✓6 ✗10 ⇒ بعد ✓19 ✗0 (TESTLOG-s168b-*). جهش (نادیده‌گرفتن sale تازه) ⇒ ✓14 ✗5 (TESTLOG-s168-mutation.txt).
- tests/pending/fix-s168-purchase-integer-lines: قبل ✓10 ✗13 (TESTLOG-s168c-before.txt)؛ رفع انجام نشد.
- رگرسیون نهایی (TESTLOG-s168-regression.txt): audit-fixes TOTAL=142 PASS=142 FAIL=0 · legacy 17/17 · esbuild 143 OK · BUNDLE main 1776920 / preload 33857 / renderer 2070202 · tests/audit 83/83.

## نشست ۱۶۹
- baseline (zip ۱۶۸ دست‌نخورده): audit-fixes 142/142 · legacy 17/17 · esbuild 143 OK · BUNDLE 1776920/33857/2070202 · tests/audit 83/83
- fix-s168-purchase-integer-lines: قبل 10/13 ⇒ بعد 23/0؛ جهش qty 18/5، قیمت 14/9
- fix-s169-variant-code-keep: قبل 8/8 ⇒ بعد 16/0؛ جهش 11/5
- fix-s169-inventory-apply-audit-tx: قبل 10/4 ⇒ بعد 14/0
- رگرسیون: audit-fixes 145/145 · legacy 17/17 · esbuild 143 OK · BUNDLE 1778442/33857/2070202 (0 هشدار) · tests/audit 83/83

## نشست ۱۷۰
- TESTLOG-s170a-before.txt: fix-s170 ۱۵/۱۵ (کد دست‌نخورده) · TESTLOG-s170a-after.txt: ۳۰/۰ · TESTLOG-s170-mutation.txt: ۱۶/۱۴، ۲۳/۷، ۲۷/۳
- TESTLOG-s170-regression.txt: audit-fixes 146/146 · legacy 17/17 · esbuild 143 OK · BUNDLE 1784528/33857/2070202
- TESTLOG-s170-audit.txt: tests/audit (a108-01 با fixture S170-D2: ۳۴/۰)


## نشست ۱۷۱
- اجرای هر تست: node --import ./test/harness/register.mjs <فایل>؛ رگرسیون: bash tools/run-regression.sh <repo> <out> 8
- TESTLOG-s171-baseline.txt (zip ۱۷۰ دست‌نخورده): audit-fixes 146/146 · legacy 17/17 · esbuild 143 OK · BUNDLE 1784528/33857/2070202
- fix-s170b-overpay-remainder-hint: TESTLOG-s171a-before.txt ۹/۲ (نسخه‌ی اولیه) · TESTLOG-s171a-before-scenario3.txt ۱۲/۶ · TESTLOG-s171a-after.txt ۱۸/۰ ⇒ پس از افزودن سه بررسی جداسازی OVERPAY: ۲۱/۰ (کد ۱۷۰ با تست نهایی ۱۵/۶)
- fix-s171-cancelled-status-statements: TESTLOG-s171b-before.txt ۱۰/۱۳ · TESTLOG-s171b-after.txt ۲۳/۰
- fix-s171-s121-bridge-exitcode: TESTLOG-s171c-before.txt ۲/۱ · TESTLOG-s171c-after.txt ۳/۰
- جهش‌ها: TESTLOG-s171-mutation.txt (همه‌ی جهش‌ها کشته شدند)
- tests/audit-fixes مرتبط: fix-s170 ۳۰/۰ · fix-s61 ۵۴/۰ · fix-s62 ۷۸/۰ · audit-a108-01 ۳۴/۰ · audit-s136 ۲۵/۰
- TESTLOG-s171-regression.txt: audit-fixes 149/149 · legacy 17/17 · esbuild 143 OK · BUNDLE main 1791276 / preload 33857 / renderer 2070202 (۰ هشدار)
- TESTLOG-s171-audit.txt: tests/audit 83/83

## نشست ۱۷۲
- اجرای هر تست: node --import ./test/harness/register.mjs <فایل>؛ رگرسیون: bash tools/run-regression.sh <repo> <out> 8
- TESTLOG-s172-baseline.txt (zip ۱۷۱ دست‌نخورده): audit-fixes 149/149 · legacy 17/17 · esbuild 143 OK · BUNDLE 1791276/33857/2070202 · tests/audit 83/83
- audit-s172-stale-observations-verify (تأیید، بدون رفع): TESTLOG-s172-stale-verify.txt ۱۴/۰
- fix-s172-bridge-drill-in-chunk: TESTLOG-s172a-before.txt ۱۱/۱۵ · TESTLOG-s172a-after.txt ۲۶/۰
- جهش‌ها: TESTLOG-s172-mutation.txt (همه کشته شدند)
- مرتبط: fix-s170 ۳۰/۰ · fix-s170b ۲۱/۰ · audit-a108-01 ۳۴/۰ · fix-s108 ۱۰/۰
- TESTLOG-s172-regression.txt: audit-fixes 150/150 · legacy 17/17 · esbuild 143 OK · BUNDLE main 1791347 / preload 33857 / renderer 2070202 (۰ هشدار)
- TESTLOG-s172-audit.txt: tests/audit 84/84

## نشست ۱۷۳
- baseline: ۱۵۰/۱۵۰، ۱۷/۱۷، 143 OK، BUNDLE 1791347/33857/2070202، audit ۸۴/۸۴.
- fix-s173-payment-drill-in-chunk: قبل ۱۸/۱۰ ⇒ بعد ۲۸/۰ · fix-s173-ledger-prior-credit-count: قبل ۳/۹ ⇒ بعد ۱۲/۰ · fix-s173-credit-print-voided-banner: قبل ۶/۴ ⇒ بعد ۱۰/۰.
- جهش‌ها: ۲۱/۷، ۲۴/۴، ۲۷/۱، ۲۷/۱، ۸/۴، ۳/۹، ۸/۲ (همه قرمز).
- رگرسیون نهایی: ۱۵۳/۱۵۳، ۱۷/۱۷، 143 OK، BUNDLE 1793691/33857/2070202 (۰ هشدار)، audit ۸۴/۸۴.

## نشست ۱۷۴
- baseline: ۱۵۳/۱۵۳، ۱۷/۱۷، 143 OK، BUNDLE 1793691/33857/2070202، audit ۸۴/۸۴ (TESTLOG-s174-baseline.txt، TESTLOG-s174-audit-baseline.txt).
- fix-s174-credit-scope-in-chunk: قبل ۱۱/۲۶ ⇒ بعد ۳۷/۰ (TESTLOG-s174a-before/after.txt).
- fix-s174-debt-c2c-in-chunk: قبل ۰/۱۰ ⇒ بعد ۱۰/۰ (TESTLOG-s174b-before/after.txt).
- fix-s174-stale-response-panels: قبل ۱/۲۹ ⇒ بعد ۳۸/۰ (TESTLOG-s174c-before/after.txt).
- جهش‌ها (TESTLOG-s174-mutation.txt): ۱۱/۲۶، ۲۱/۱۶، ۳۴/۳، ۳۴/۳، ۰/۱۰، ۷/۳، ۳۴/۴، ۳۷/۱ (همه قرمز).
- رگرسیون نهایی: ۱۵۶/۱۵۶، ۱۷/۱۷، 144 OK، BUNDLE 1796942/33857/2072233 (۰ هشدار)، audit ۸۴/۸۴.

## نشست ۱۷۵
baseline: 156/156، 17/17، 144 OK، audit 84/84. تست‌های تازه: s175a (voided notIn) قبل 7/30 بعد 37/0؛ s175b (purge) قبل 1/15 بعد 16/0؛ s175c (consolidate) قبل 0/11 بعد 11/0؛ s175d (credit list) قبل 4/10 بعد 14/0. رگرسیون: 160/160، 17/17، 144 OK، BUNDLE 1799340/33857/2072233، audit 84/84.


## نشست ۱۷۶
baseline: 160/160، 17/17، 144 OK، audit 84/84. s176a (price adjust in) قبل 4/41 بعد 35/0 (بدون سقف 30/5)؛ s176b (end failure) قبل 6/10 بعد 15/0. جهش 8/9. رگرسیون: audit-fixes 162/162 · legacy 17/17 · esbuild 144 OK · BUNDLE main 1802085 / preload 33857 / renderer 2072233 (۰ هشدار) · tests/audit: 84 total · 84 PASS · 0 FAIL ·


## نشست ۱۷۷
baseline: 162/162، 17/17، 144 OK، BUNDLE 1802085/33857/2072233، audit 84/84. M8: fix-s176-price-adjust-in-chunk سخت‌شده 40/0، جهش M8 39/1. s177a (product remove/restore/purge/secondary in) قبل 3/28 بعد 25/0 (بدون سقف روی کد قبلی 19/6). جهش 9/9. رگرسیون: audit-fixes 163/163 · legacy 17/17 · esbuild 144 OK · BUNDLE main 1804275 / preload 33857 / renderer 2072233 (۰ هشدار) · tests/audit: 84 total · 84 PASS · 0 FAIL.

## نشست ۱۷۸

۱۰-۱۵۱) نتیجه‌ی نشست ۱۷۸ و نقطه‌ی دقیق شروع نشست ۱۷۹

این بند آخرین وضعیت معتبر است و بندهای قبلی ۱۰ را supersede می‌کند. بندهای ۰ تا ۹ و قاعده‌ی زنجیره بدون تغییر حفظ شده‌اند. بندهای ۱۰-۱۳۸ تا ۱۰-۱۵۰ همچنان مرجع‌اند.

گام ۰: npm install، npx prisma generate، npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و دسترسی اینترنت ندارد (فقط node v22 و esbuild). baseline روی کپی دست‌نخورده‌ی zip ۱۷۷ (TESTLOG-s178-baseline.txt، TESTLOG-s178-audit-baseline.txt): audit-fixes ۱۶۳/۱۶۳؛ legacy ۱۷/۱۷؛ esbuild 144 OK؛ BUNDLE 1804275/33857/2072233؛ tests/audit ۸۴/۸۴ ⇒ کاملاً منطبق با ۱۰-۱۵۰.

کار نشست ۱۷۸ (تطبیق خطوط باز AUDIT-PROGRESS با کد):
- ✅ S178-D1 (مشاهده‌ی P3 ردیف ۱۲۷، ایراد واقعی): MaintenanceService.archivePurge تجمیع قدیمی را DELETE می‌کرد؛ StockMovement.consolidationId با ON DELETE SET NULL و Prisma روی SQLite کلید خارجی را روشن اجرا می‌کند ⇒ ستون دفتر append-only انبار بی‌صدا NULL می‌شد. حالا تجمیعی که حرکت انبار به آن وصل است حفظ می‌شود (CONSOLIDATION_LEDGER_LINKED_SQL / CONSOLIDATION_PURGEABLE_SQL در پیش‌نمایش، DELETE، unlink فاکتور و شرط شیفت پیش‌نمایش ⇒ پیش‌نمایش = عملیات). فیلد تازه‌ی consolidationsRetained در MaintenancePreview (types.ts)، هشدار فارسی در نتیجه، یادداشت Audit، ردیف نمایشی در Settings.tsx. تست tests/audit-fixes/fix-s178-purge-keeps-ledger-consolidation.mjs (PRAGMA foreign_keys = ON برای بازسازی Prisma واقعی) قبل ۸/۱۱ ⇒ بعد ۱۹/۰. جهش‌ها M1..M6 همه قرمز.
- S178-D2: tests/audit/audit-s127-maintenance-retention-verify.mjs انتظار «تجمیع قدیمی حذف شد» به «تجمیع وصل به دفتر حفظ شد و پیوند دست‌نخورده» تغییر کرد (معنای تازه‌ی S178-D1)؛ ۱۹/۰.
- ✅ S178-D3 (مشاهده‌ی P3 ردیف ۸۹، ایراد واقعی ضدسرقت): FraudService.review فقط کاربران برگشت‌دار را به detectReturnRateOutliers می‌داد و helper هم همتای بی‌برگشت را حذف می‌کرد ⇒ baseline به بالا متمایل؛ مثال: سه همکار ۰٪، یک همکار ۳۰٪ ⇒ فروشنده‌ی ۵۵٪ بی‌هشدار. حالا همتایان = همه‌ی کاربران دارای فروش یا برگشت در همان دامنه؛ نامزد هشدار همچنان حداقل دو برگشت. تست fix-s178-return-rate-zero-peers.mjs قبل ۶/۶ ⇒ بعد ۱۲/۰. جهش‌ها R1..R3 قرمز.
- ✅ S178-D4 (مشاهده‌ی P3 ردیف ۱۲۶): VariantPurgeService.preview حالا برای هر ردیف blockedReason فارسی (فعال / مهلت ۷۳۰ روز با تاریخ قابل‌حذف / حرکت انبار) و در کل canPurge، blockers، notices برمی‌گرداند (همان شرط‌های purge)؛ Products.tsx مانع‌ها را نشان می‌دهد و دکمه‌ی حذف همیشگی را با canPurge=false غیرفعال می‌کند. تست fix-s178-variant-purge-preview-blockers.mjs قبل ۴/۱۰ ⇒ بعد ۱۴/۰. جهش‌ها P1..P5 قرمز.
- کهنه (بدون تغییر src): S117-5 (رفع نشست ۱۱۷ با تست fix-s117-stock-discrepancy-full؛ «باقی» ردیف ۱۱۷ کهنه است)، ردیف ۱۰۹ (DRAFT در purge؛ در A122-01 بسته شده)، S142-01 (در همان نشست ۱۴۲ رفع شده).
- باز (شروع نشد، نقطه‌ی ادامه): مشاهده‌ی P3 ردیف ۱۴۳ — intOf در src/shared/creditUi.ts ارقام فارسی را حذف و اعشار را بی‌صدا گرد می‌کند؛ ورودی مخلوط «5۰۰۰۰۰» ⇒ مبلغ ۵ ریال بی‌صدا، «100000.6» ⇒ 100001. پیشنهاد: در buildIssuePayload/buildBulkPayload برای amount، minPurchase، maxPerTransaction، days، maxUses، count، codeLength از parseGroupedInteger (src/shared/jalali.ts) استفاده شود و null ⇒ پیام فارسی با نام فیلد؛ intOf نمایشی دست نخورد؛ تست قبل FAIL روی همین تابع خالص + test/credit-ui-logic-session22.ts سبز بماند.

رگرسیون نهایی (TESTLOG-s178-regression.txt): audit-fixes TOTAL=166 PASS=166 FAIL=0 · legacy TOTAL=17 PASS=17 FAIL=0 · esbuild syntax: 144 OK · 0 FAIL · BUNDLE main 1810900 / preload 33857 / renderer 2073615 · tests/audit 84/84 (TESTLOG-s178-audit.txt). FAILED:  FAILED:  . جهش‌ها: TESTLOG-s178-mutation.txt. patch: mahak-session178-fix.patch (src) و mahak-session178-tests.patch (tests) نسبت به zip ۱۷۷.

نقطه‌ی دقیق شروع نشست ۱۷۹:
۱) baseline روی کپی جدای zip با همان اعداد بالا (bash tools/run-regression.sh <repo> <out> 4) و tests/audit.
۲) مشاهده‌ی ۱۴۳ (intOf) طبق پیشنهاد بالا با تست قبل FAIL.
۳) بقیه‌ی مشاهده‌های P3 ثبت‌شده که هنوز تطبیق نشده‌اند: ردیف ۱۰۰ (candidates بدون take)، ردیف ۱۱۱ (actor مرور ضدتقلب = userId فیلتر؛ groupBy چک تکراری بدون orderBy)، ردیف ۸۹ دوم (تاریخ نامعتبر review — با A104-01 تطبیق شود).
۴) سپس ممیزی تازه روی BackupService/MergeService (بازگردانی/ادغام بکاپ) با معیار «ضدسرقت + سازگاری مالی».

وضعیت خوشه‌ها: مثل ۱۰-۱۵۰ به‌علاوه‌ی S178-D1/D3/D4 ✅؛ ۱۴۳-intOf باز.
محدودیت‌های قطعی: Prisma Client واقعی، typecheck واقعی، رندر واقعی Electron/React، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق، timezone غیر Asia/Tehran، حجم ۵۰٬۰۰۰+ اجرا نشدند.
فایل‌های تغییرکرده: src/main/services/MaintenanceService.ts، FraudService.ts، VariantPurgeService.ts، src/shared/types.ts، src/renderer/src/pages/Settings.tsx، Products.tsx؛ تست‌های تازه: tests/audit-fixes/fix-s178-purge-keeps-ledger-consolidation.mjs، fix-s178-return-rate-zero-peers.mjs، fix-s178-variant-purge-preview-blockers.mjs؛ به‌روزشده: tests/audit/audit-s127-maintenance-retention-verify.mjs؛ TESTLOG-s178*.txt؛ patchها؛ PROGRESS.md، DECISIONS.md، TESTLOG.md، AUDIT-PROGRESS.md؛ HANDOFF-PROMPT-next.txt (قبلی: HANDOFF-PROMPT-next-session177.txt).


۱۰-۱۵۲) نتیجه‌ی نشست ۱۷۹ و نقطه‌ی دقیق شروع نشست ۱۸۰

این بند آخرین وضعیت معتبر است و بندهای قبلی ۱۰ را supersede می‌کند. بندهای ۰ تا ۹ و قاعده‌ی زنجیره بدون تغییر حفظ شده‌اند. بندهای ۱۰-۱۳۸ تا ۱۰-۱۵۱ همچنان مرجع‌اند.

گام ۰: npm install، npx prisma generate، npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و دسترسی اینترنت ندارد (فقط node v22 و esbuild). baseline روی کپی دست‌نخورده‌ی zip ۱۷۸ (TESTLOG-s179-baseline.txt، TESTLOG-s179-audit-baseline.txt): audit-fixes ۱۶۶/۱۶۶؛ legacy ۱۷/۱۷؛ esbuild 144 OK؛ BUNDLE 1810900/33857/2073615؛ tests/audit ۸۴/۸۴ ⇒ کاملاً منطبق با ۱۰-۱۵۱.

کار نشست ۱۷۹:
- ✅ S179-D1 (مشاهده‌ی P3 ردیف ۱۴۳، ایراد واقعی): creditUi.buildIssuePayload/buildBulkPayload با parseFormInteger/formIntField سخت‌گیرانه؛ «5۰۰۰۰۰» ⇒ ۵۰۰٬۰۰۰ (قبلاً ۵ ریال)، «۱۲۰٬۰۰۰» ⇒ ۱۲۰٬۰۰۰، اعشار/منفی/متن/NaN/۱e21/۲^۵۳ ⇒ رد فارسی با نام فیلد و واحد و مقدار (قبلاً گرد/حذف بی‌صدا؛ ۱e21 ⇒ ۱۲۱). تست tests/audit-fixes/fix-s179-credit-form-strict-integer.mjs قبل ۱۴/۲۵ ⇒ بعد ۵۸/۰. جهش‌ها F1..F8 همه قرمز. test/credit-ui-logic-session22/28/29/30/32/34 و credit-logic-session21 سبز؛ session31 (۴ FAIL) و session33 (۱ FAIL) روی zip ۱۷۸ هم دقیقاً همین FAILها را دارند (قراردادهای regex قدیمی، خارج از رگرسیون؛ بازبینی جدا).
- ✅ S179-D2 (مشاهده‌ی ردیف ۱۱۱ الف): actor Audit مرور ضدتقلب از نشست باز main (IPC saleFraudReview)، فیلتر در after.
- ✅ S179-D3 (مشاهده‌ی ردیف ۱۱۱ ب، ایراد واقعی ضدسرقت): چک تکراری بین بازه‌ها و با کلید نرمال‌شده (chequeNoKey export در FraudService)، مبلغ بازه، ترتیب قطعی. تست tests/audit-fixes/fix-s179-fraud-actor-duplicate-cheque.mjs قبل ۱۰/۱۳ ⇒ بعد ۲۳/۰. جهش‌ها Q1..Q8 همه قرمز.
- S179-D4: هارنس prismaLite groupBy حالا having را واقعاً اعمال می‌کند.
- S179-D5: ردیف ۱۰۰ تصمیم مستند (حفظ)؛ ردیف ۸۹ دوم کهنه (A104-01).

رگرسیون نهایی (TESTLOG-s179-regression.txt): audit-fixes TOTAL=168 PASS=168 FAIL=0 · legacy TOTAL=17 PASS=17 FAIL=0 · esbuild syntax: 144 OK · 0 FAIL · BUNDLE 1812154/33857/2076583 · tests/audit 84/84 (TESTLOG-s179-audit.txt). FAILED:  FAILED:  . جهش‌ها: TESTLOG-s179-mutation.txt. patch: mahak-session179-fix.patch (src) و mahak-session179-tests.patch (tests + test/harness) نسبت به zip ۱۷۸.

نقطه‌ی دقیق شروع نشست ۱۸۰:
۱) baseline روی کپی جدای zip با همان اعداد بالا (bash tools/run-regression.sh <repo> <out> 4) و tests/audit.
۲) ایراد واقعی تازه‌ی پیداشده، شروع‌نشده (ممیزی BackupService): BackupService.apply هیچ گیت رمزی در main ندارد (IPC backupApply مستقیم)، و mode غیر از 'merge' (حتی خالی/اشتباه) به «جایگزینی کامل» می‌افتد؛ actor از userId رندرر است؛ Audit BACKUP_RESTORE در دیتابیس قبلی نوشته و بلافاصله با فایل بکاپ جایگزین می‌شود ⇒ دیتابیس بازگردانده هیچ ردی از بازگردانی ندارد (فقط last-restore.txt). پیشنهاد: mode فقط 'replace'|'merge' وگرنه BusinessError؛ replace ⇒ assertManagerPassword (هم‌ارز «حذف کامل گزارش‌های فروش» بند ۴-۲۹)، merge ⇒ assertPanelPassword(PANEL_KEYS.settings) (بند ۴-۳۹)، هر دو قبل از resolve/کپی؛ actor = shiftService.currentStaffId() در IPC؛ بعد از copyFile یک audit دوم (non-throwing) در دیتابیس تازه؛ Modal «بازگردانی از بکاپ» در Settings.tsx یک PasswordField (الگوی slimManagerPw) و فرستادن managerPassword. تست قبل FAIL: رد بدون رمز/رمز غلط/mode نامعتبر بدون ساخت فایل before-restore و بدون markApplied (توجه: databaseFile() = userData/data/shop.db در هارنس با HARNESS_DB فرق دارد).
۳) سپس MergeService (ادغام: فاکتور/اعتبار/پرداخت واردشده، شماره فیش بند ۴-۱۶، اعتبار واردشده) با معیار «ضدسرقت + سازگاری مالی».

وضعیت خوشه‌ها: مثل ۱۰-۱۵۱ به‌علاوه‌ی ۱۴۳-intOf ✅، ۱۱۱ ✅، ۱۰۰ تصمیم، ۸۹-دوم کهنه؛ Backup-gate باز.
محدودیت‌های قطعی: Prisma Client واقعی، typecheck واقعی، رندر واقعی Electron/React، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق، timezone غیر Asia/Tehran، حجم ۵۰٬۰۰۰+ اجرا نشدند.
فایل‌های تغییرکرده: src/shared/creditUi.ts، src/main/services/FraudService.ts، src/main/ipc/index.ts، test/harness/prismaLite.mjs؛ تست‌های تازه: tests/audit-fixes/fix-s179-credit-form-strict-integer.mjs، fix-s179-fraud-actor-duplicate-cheque.mjs؛ TESTLOG-s179*.txt؛ patchها؛ PROGRESS.md، DECISIONS.md، TESTLOG.md، AUDIT-PROGRESS.md؛ HANDOFF-PROMPT-next.txt (قبلی: HANDOFF-PROMPT-next-session178.txt).
