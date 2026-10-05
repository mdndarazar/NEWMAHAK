# جلسه ۴۰ — کار ب: لایه‌ی داده + سرویس بسته شد · UI و تست‌ها نوشته نشدند

## صداقت فنی (اول از همه)
* `npm` **هجدهمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit` **اجرا نشد**.
* اجرا شد: `node tools/tsx-parse-check.mjs` روی هر ۷ فایل تغییرکرده ⇒ سالم، و
  `test/acceptance-db-session35.mjs` ⇒ **۲۰۴ PASS · ۰ FAIL** (بدون رگرسیون).
* **کار الف:** هیچ تغییری نکرد. تنها بند باقی‌ماندهٔ آن (`test/acceptance-db-session36.mjs`) **همچنان نوشته نشده**.
* **کار ب:** لایه‌ی داده، مالی، سرویس، قفل و امنیت **کامل و سازگار** است. **UI هیچ صفحه‌ای و هیچ سوییت تستی
  نوشته نشد.** حالت فعلی نصفه‌کاره ولی **سالم و ناشکسته** است: برنامه درست رفتار می‌کند (کالا معلق می‌ماند و با
  پرداخت مدیر آزاد می‌شود)؛ چیزی که کم است، *دیده شدنِ* معلق‌ها در پنج صفحه است.

## تصمیم‌های معماری (دوباره تصمیم نگیر)
1. **منبع حقیقتِ تعداد = `SaleReturnItem.restockedQty`** (هیچ جدول موجودی جدیدی ساخته نشد). در حالت معلق
   صفر ثبت می‌شود و در `pay` برابر `qty` می‌گردد و همان‌جا `inventoryService.increase` می‌خورد.
2. **منبع حقیقتِ «معلق بودن» = `SaleReturn.restockPending`** و *نه* «`restockedQty` صفر است». چون
   `restockedQty = 0` یک معنای دومی هم دارد: «فاکتور بدون کسر از موجودی بود». بدون این ستون، برگشتِ فروش
   عمده هم «معلق» شمرده می‌شد و انبارگردانی یک کسری کاذب می‌ساخت.
3. **تنها نقطه‌ی آزادسازی** = `pendingRestockService.releaseReturnStock` و **idempotent** است (فقط
   `restockedQty < qty`). سه صدازننده دارد و بس: `pay`، `cancel({releaseStock:true})`، و مسیر تعویضی که
   آخر معلوم شد پرداخت مدیری ندارد.
4. **پرداخت کمتر/بیشتر از `amount`: کالا در هر حالت کامل برمی‌گردد.** تکلیف کالا یک واقعیت فیزیکی است نه
   نسبت مالی؛ اختلاف مبلغ همان‌جایی حل می‌شود که برایش ساخته شده (ردیف `ADJUSTMENT`). اختلاف در `note` و
   AuditLog صریح ثبت می‌شود تا بی‌صدا نماند.
5. **قفل سمت سرور با همان مکانیزم موجود**: `assertPanelPassword(PANEL_KEYS.cardTransfers, …)` که فقط یک
   بسته‌بندی روی `authService.verifyPanel` است (رمز مدیر / رمز دوم پنل / رمز سوم شیفت + قفل موقت + سیاست
   قفل ماژول‌ها). **هیچ مکانیزم جدیدی ساخته نشد.** مثل `assertManagerPassword`، همیشه *بیرون* تراکنش صدا
   زده می‌شود (نوشتن روی `AuthLockout` وسط تراکنشِ باز = بن‌بست SQLite).
6. **انبارگردانی**: `pendingRestockQty` در لحظه‌ی شمارش **snapshot** می‌شود (مثل `systemQty`)، چون معلق‌ها
   فردا آزاد می‌شوند و عدد بازمحاسبه‌شده دیگر آن چیزی نیست که آن روز روی قفسه بود.
   `expectedPhysicalQty = systemQtyAtCount + pendingRestockQty` و `needsReview` روی
   `diffAtCountWithPending` قضاوت می‌کند. برای همه‌ی داده‌ی قدیمی (`pending = 0`) عدد **عیناً** همان قبلی است.
7. **کالای جایگزین تعویض دست نخورد**: همان لحظه‌ی تحویل از انبار کم می‌شود (خواسته‌ی بند ۲).

## فایل‌های تغییرکرده
| فایل | وضعیت |
|---|---|
| `prisma/schema.prisma` | تغییر — `SaleReturn.restockPending/restockReleasedAt/restockReleasedAtJalali` + ایندکس · `CardTransferRequest.canceledAt/cancelReason/stockReleasedAt/stockReleasedQty` · `StockCountItem.pendingRestockQty` |
| `prisma/migrations/20270924100000_pending_restock_manager_payment/migration.sql` | **تازه** — فقط ستون جدید، هیچ UPDATE ی روی ردیف‌های موجود |
| `prisma/manual/20270924_pending_restock_manager_payment.sql` | **تازه** (نسخه‌ی دستی، عیناً همان) |
| `src/shared/pendingRestock.ts` | **تازه** — تعریف رسمی «معلق برگشتی» + همه‌ی متن‌ها + توابع خالص |
| `src/shared/enums.ts` | تغییر — `CardTransferStatus.CANCELED` + برچسب · `AuditAction.CARD_TRANSFER_RESTOCK` و `CARD_TRANSFER_CANCEL` |
| `src/shared/accounting.ts` | تغییر — `pendingRestockQty` / `expectedPhysicalQty` / `diffAtCountWithPending` / `hasPending` در مغایرت انبارگردانی |
| `src/main/services/PendingRestockService.ts` | **تازه** — `summary` (تابع مشترک پنج صفحه) · `byVariant` · `releaseReturnStock` |
| `src/main/services/AuthService.ts` | تغییر — `assertPanelPassword` |
| `src/main/services/CardTransferService.ts` | تغییر — `pay` با گیت سرور + آزادسازی انبار در همان تراکنش · متد تازه‌ی `cancel` · `shapeRow` |
| `src/main/services/SalesService.ts` | تغییر — `runReturn` (گزینه‌ی `deferRestock` + `restockNow`) · `createReturn` (stockNote واقعی) · `createExchange` (معلق + آزادسازی آگاهانه) · `returnUpdate` (درِ پشتی بسته شد) · `returnDelete` (لغو درخواست بی‌مرجع) · `returnList` |

## ❌ کارِ باقی‌مانده — نشست بعد دقیقاً از همین‌جا
### الف) IPC (کوچک ولی **حتماً اول**؛ بدون این، UI به سرور وصل نیست)
1. `src/shared/ipc.ts`: `pendingRestockSummary: 'pendingRestock:summary'` و `cardTransferCancel: 'cardTransfer:cancel'`.
2. `src/main/ipc/index.ts`: دو هندلر تازه + **مهم:** `cardTransferPay` باید `managerPassword` را از payload رد کند
   (همین حالا `withUser(p)` همه‌ی فیلدها را پاس می‌دهد، پس فقط تست لازم است).
3. `src/shared/types.ts`: تایپ `PendingRestockSummary` روی سیم (یا `import type` از `@shared/pendingRestock`).
4. `src/shared/panels.ts`: ردیف `LOCKED_PANELS` کلید `cardTransfers` باید در توضیحش بگوید «بازگرداندن کالای
   برگشتی به موجودی قابل‌فروش هم با همین قفل انجام می‌شود» (قاعده‌ی بالای همان فایل + چک‌لیست README).
5. `StockCountService.submit`: `pendingRestockQty` را از `pendingRestockService.byVariant(tx)` بخوان و
   snapshot کن. `discrepancy`: همان را به `calculateStockDiscrepancies` بده و واریانت‌های «فقط معلق» را هم
   به `variantIds` اضافه کن.

### ب) UI — پنج صفحه، همه **فقط خواندنی** جز پنل قفل‌دار
6. `components/CardTransferPanel.tsx`: فیلد **رمز مدیر** در فرم «پرداخت شد» (الگوی `<PasswordField>`)،
   ستون «وضعیت موجودی کالا» با نشان «در انتظار تأیید مدیر»، و دکمه‌ی «رد/لغو» با دلیل اجباری +
   چک‌باکس «کالا را بدون پرداخت به موجودی برگردان».
7. `pages/Products.tsx` · `pages/SalesReports.tsx` (تب برگشت/تعویض + بلوک خلاصه) · `pages/Stocktake.tsx`
   (ستون معلق در جدول مغایرت + `expectedPhysicalQty`) · `pages/CashClose.tsx` (ردیف هشدار).
   متن‌ها **همه آماده‌اند** در `@shared/pendingRestock`: `PENDING_RESTOCK_LABEL`، `PENDING_RESTOCK_COLUMN`،
   `pendingRestockHeadline`، `pendingRestockLine`، `pendingRestockShiftWarning`، `pendingRestockTone`.
   هیچ صفحه‌ای نباید دکمه‌ی تأیید/بازگشت به انبار بسازد و هر صفحه در قفل خودش می‌ماند.

### ج) تست
8. `test/acceptance-db-session36.mjs` — **بند باقی‌ماندهٔ کار الف** (سناریوها در `CHANGELOG-جلسه۳۹.md`).
9. `test/acceptance-db-session40.mjs` — سناریوهای کار ب: برگشت کارت‌به‌کارت + پرداخت · بدون پرداخت
   (موجودی قابل‌فروش تغییر نکند، معلق دیده شود) · تعویض با مابه‌التفاوت کارت‌به‌کارت · تعویض با
   مابه‌التفاوت صفر/مثبت (آزادسازی آگاهانه) · برگشت نقدی (مثل قبل) · پرداخت دوباره (نباید دو بار اضافه
   کند) · حذف و ویرایش برگشتِ معلق · `pay` بدون رمز مدیر (باید رد شود) · مغایرت انبارگردانی با کالای معلق.

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا اجرای دستی prisma/manual/20270924_pending_restock_manager_payment.sql
npm run typecheck
node tools/tsx-parse-check.mjs src/renderer/src/pages/*.tsx src/renderer/src/components/*.tsx
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
```
