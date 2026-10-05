# جلسه ۴۳ — کار ب: دو صفحه‌ی نمایشی از چهار صفحه بسته شد (کالاها + گزارشات فروش)

## صداقت فنی (اول از همه)
* `npm` **بیست‌ویکمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit`
  **اجرا نشد**. هیچ typecheck ی روی درخت انجام نشده و UI رندر/اجرا نشده است.
* اجرا شد و سبز است: `node tools/tsx-parse-check.mjs` روی هر ۳ فایل دست‌خورده ⇒ سالم ·
  `test/acceptance-db-session36.mjs` ⇒ **۱۳۷ PASS · ۰ FAIL** · `test/acceptance-db-session35.mjs` ⇒
  **۲۰۴ PASS · ۰ FAIL** (هم قبل و هم بعد از تغییرها ⇒ بدون رگرسیون).
* **سوییت `test/acceptance-db-session40.mjs` باز هم نوشته نشد.** مسیرهای تازه‌ی جلسه ۴۲ (دو هندلر IPC و
  snapshot انبارگردانی) و تغییرهای همین نشست **تست خودکار ندارند**. این مهم‌ترین بند باقی‌مانده است.
* **کار الف دست نخورد** (تمام‌شده و سبز از جلسه ۴۱). به «فاکتور فروش عمده و انتخاب انبار» دست نخورد.
* حالت فعلی **سالم و ناشکسته** است: هیچ عدد مالی و هیچ عدد انباری عوض نشد؛ این نشست فقط *دیده شدنِ*
  معلق‌ها را در دو صفحه اضافه کرد.

## ✅ انجام‌شده

### ۱) `src/renderer/src/hooks/usePendingRestock.ts` (تازه) — تنها نقطه‌ی خواندن در رندرر
یک هوک مشترک برای همه‌ی صفحه‌های نمایشی، تا چهار صفحه هیچ‌وقت دو عدد و دو جمله‌ی متفاوت نسازند:
`summary`, `totalQty`, `tone`, `headline`, `shiftWarning`, `qtyOfVariant()`, `qtyOfReturn()`,
`itemsOfVariant()`, `ready`, `error`, `reload`. سه قاعده‌اش:
1. **فقط خواندنی** — تنها کانال `pendingRestock:summary`. هیچ مسیری برای بازگرداندن کالا نمی‌سازد.
2. **بازه‌ی تاریخ نمی‌گیرد** (همان تصمیم جلسه ۴۲): کالای معلقِ سه ماه پیش هم امروز روی قفسه است.
3. **هیچ‌وقت صفحه را نمی‌شکند** — خطای کانال ⇒ عدد صفر + `error`، بدون استثنا و بدون اثر روی گزارش میزبان.
همراهش `pendingToneBox(tone)` برای هم‌رنگ بودن کادر هشدار با `PendingStockBadge`.

### ۲) `src/renderer/src/pages/Products.tsx` — انبار فروشگاه
* ستون تازه‌ی «معلق برگشتی (در انتظار تأیید مدیر)» کنار «موجودی»، با نشان `PendingStockBadge`.
* `title` هر سلول: موجودی فیزیکیِ مورد انتظار روی قفسه (`expectedPhysicalQty`) + متن توضیحی مشترک.
* کادر هشدار بالای جدول از `pendingRestockHeadline` (فقط در نمای «کالاها»؛ سطل آشغال معلق ندارد).
* ردیف جمع، جمعِ معلق ردیف‌های دیده‌شده را هم نشان می‌دهد. `colSpan`ها (۱۲ ⇒ ۱۳) به‌روز شد.
* **ستون «موجودی» عیناً دست‌نخورده است** (موجودی قابل‌فروش)؛ معلق یک ستون جداست.

### ۳) `src/renderer/src/pages/SalesReports.tsx` — تب برگشت/تعویض
* `RETURN_HEADERS`: ستون `PENDING_RESTOCK_COLUMN` **کنار** «برگشت به انبار» (آن عدد = چقدر واقعاً به
  موجودی قابل‌فروش رفت، این عدد = چقدر هنوز نرفته؛ جمعشان = تعداد برگشتی).
* مقدار ستون از خودِ ردیف سرور (`r.pendingRestockQty`، آماده از جلسه ۴۰) و در نبودش از خلاصه‌ی مشترک
  (`qtyOfReturn`) ⇒ یک منبع، بدون عدد موازی.
* جمع ستون در `tfoot`، ستون در خروجی اکسل تب، و کادر هشدار `headline` بالای تب.
* صفحه در قفل `salesReports` خودش ماند و **هیچ دکمه‌ی تأیید/بازگشت به انبار ساخته نشد**.

## ❌ کارِ باقی‌مانده — نشست بعد دقیقاً از همین‌جا
1. `pages/Stocktake.tsx` — ستون معلق + `expectedPhysicalQty` در جدول مغایرت، قضاوت روی
   `diffAtCountWithPending` (سرور از جلسه ۴۲ هر سه عدد را می‌دهد)، متن `PENDING_RESTOCK_STOCKTAKE_NOTE`،
   و یک کارت خلاصه. `DISC_HEADERS` و `exportDisc` هم باید همین دو ستون را بگیرند. صفحه در قفل
   `stocktake` خودش می‌ماند. (`DiscrepancyRow` در همان فایل باید سه فیلد `pendingRestockQty`,
   `expectedPhysicalQty`, `diffAtCountWithPending`, `hasPending` را بگیرد.)
2. `pages/CashClose.tsx` — ردیف هشدار با `pendingRestockShiftWarning` (فقط هشدار؛ **نباید** روی
   `expectedCash` و کسری/اضافی اثر بگذارد). جای پیشنهادی: یک ردیف در بخش «ردیف‌های فقط نمایشی» جدول
   «نقد داخل کشو — فرمول کامل» + یک خط در چاپ حرارتی وقتی `totalQty > 0`.
3. تب «تعویض کالا» (`ExchangeTable`) — ستون معلق **عمداً در این نشست اضافه نشد**: `EXCHANGE_HEADERS` و
   بدنه و `tfoot` و `exchangeRowValues` و totals چاپ A4 باید با هم عوض شوند و نیمه‌کاره رهاکردنشان
   ستون‌ها را جابه‌جا می‌کرد. ردیف‌های تعویض از همین حالا با تیک «تعویض‌ها را هم نشان بده» در تب برگشت
   با ستون معلق دیده می‌شوند. (`r.returnId` در ردیف تعویض هست ⇒ `pending.qtyOfReturn(r.returnId)`.)
4. **سوییت `test/acceptance-db-session40.mjs`** طبق الگوی `acceptance-db-session36.mjs` (هر سناریو شیفت
   مستقل خودش) — همان فهرست سناریوهای `CHANGELOG-جلسه۴۲.md`.

## فایل‌های تغییرکرده‌ی این نشست
`src/renderer/src/hooks/usePendingRestock.ts` (تازه) · `src/renderer/src/pages/Products.tsx` ·
`src/renderer/src/pages/SalesReports.tsx` · `CHANGELOG-جلسه۴۳.md` (تازه) · `HANDOFF-ادامه-توسعه.md` (سرِ فایل).
**هیچ فایل دیگری عوض نشد** — نه schema، نه migration، نه `SalesService`، نه `CardTransferService`، نه
`PendingRestockService`، نه `StockCountService`، نه `accounting.ts`، نه `panels.ts`، نه IPC.

## دستورهایی که کاربر باید اجرا کند
### کار الف (تمام‌شده — فقط تأیید)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا prisma/manual/20270923_payment_destination.sql
npm run typecheck
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs
```
### کار ب (ناتمام)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا prisma/manual/20270924_pending_restock_manager_payment.sql
npm run typecheck
node tools/tsx-parse-check.mjs src/renderer/src/pages/Products.tsx src/renderer/src/pages/SalesReports.tsx
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
# بعد: Stocktake ⇒ CashClose ⇒ ستون تب تعویض ⇒ سوییت test/acceptance-db-session40.mjs
```
