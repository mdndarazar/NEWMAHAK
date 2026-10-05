# جلسه ۳۶ — کار الف (مقصد پول): لایه‌ی داده و لایه‌ی مالی ساخته شد · **نشست به سقف رسید، کار الف ناتمام است**

## ⛔ صداقت فنی — این نشست کار الف را **تمام نکرد**
سقف نشست وسط کار الف رسید. برخلاف خواسته‌ی پرامپت، کار الف **تحویلِ کامل و سالم نیست**:
لایه‌ی داده، لایه‌ی مالی و سرویس پرداخت انجام شده‌اند، ولی **مصرف‌کننده‌های این تایپ‌های تازه
به‌روز نشده‌اند**، پس درخت کد در وضعیت فعلی **typecheck نمی‌شود** و هیچ تستی نوشته و اجرا نشده است.
فهرست دقیقِ «چه چیزی مانده» و ترتیبش پایین همین فایل و در HANDOFF است. کار ب **شروع نشد**.

## محیط (گام ۰)
`node v22.23.1` هست، **`npm` همچنان نیست** (چهاردهمین نشست: ۲۳ تا ۳۶).
پس `npm install` / `prisma generate` / `tsc --noEmit` **اجرا نشد**.
هارنس جلسه ۳۵ **قبل از شروع تغییرات** اجرا و تأیید شد:
`node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs` ⇒ **۲۰۲ PASS · ۰ FAIL**.
بعد از تغییرات این نشست **دوباره اجرا نشد** (بودجه تمام شد). این اولین کاری است که نشست بعد باید بکند.

## باگ‌هایی که در بررسی کد پیدا شد (مبنای طراحی)
۱. **چکِ پاس‌شده دو بار در انتظارهای صندوق شمرده می‌شد.** در `paymentStatement` کل
   `clearedCheques` داخل `clearedCashCheques` می‌نشست و از راه `clearedCashChequeAmount` به
   «نقد مورد انتظار» می‌رفت؛ همان مبلغ در `reportShape.paymentSplit` (روش چک، `kind = CUSTOM`) به
   سبد «سایر» می‌رفت و در سطح **ردیف** با `cardTotal + otherTotal` به «انتظار کارتخوان» اضافه
   می‌شد. نتیجه: کسری/اضافه‌ی بی‌دلیل هنگام بستن صندوق — دقیقاً شکایت مالک.
۲. **ردیف‌های جدول و جمع پایین جدول واگرا بودند.** `reportRows` بعد از ساختن ردیف‌ها،
   `totals.otherTotal` را با `a.cash.otherReceived` رونویسی می‌کند (که چک در آن **نیست**)، ولی
   ستون «کارت» هر ردیف در `SalesReports.tsx`/`CashClose.tsx` از خود ردیف می‌آید (که چک در آن
   **هست**). پس ستون و جمعِ همان ستون یک عدد نمی‌دادند.
۳. **`priorCashSettlements` سهم کارت را هم به «نقد مورد انتظار» می‌برد** (`priorPeriod` =
   نقد + کارت + اعتباری + سایر).
۴. **`priorPeriod` در همه‌ی مسیرهای واقعی صفر است** (باگ مستقل، حل‌نشده): `saleWhere` وقتی بازه
   دارد `issuedAt ≥ from` می‌گذارد و کوئری `prior` هم `issuedAt < from` می‌خواهد ⇒ تناقض؛ با
   `shiftId` هم فاکتورهای شیفت همه بعد از `openedAt` صادر شده‌اند ⇒ باز صفر. یعنی «وصول نسیه‌ی
   بازه‌های قبل» عملاً هیچ‌وقت در بستن صندوق دیده نمی‌شود. **این خارج از کار الف است و دست‌نخورده
   ماند؛ فقط ثبت شد.**
۵. **`CashboxService.shiftPaymentsOf` با `paidAt` فیلتر می‌کند** ولی چکِ پاس‌شده را «دریافت‌شده»
   می‌شمارد ⇒ چکی که در شیفت A ثبت و در شیفت B پاس شده، در جمع دریافتیِ **شیفت A** می‌نشیند،
   در حالی که گزارش فروش همان مبلغ را با `clearedAt` در **شیفت B** می‌شمارد. **ناسازگاری واقعی
   است** (همان چیزی که پرامپت خواست بررسی شود) و **هنوز رفع نشده** (بند ۲ فهرست باقی‌مانده).

## تصمیم معماری: یک منبع حقیقت (خواسته‌ی صریح پرامپت)
`Payment.destination` **تنها** مبنای سبدبندی دریافتی‌هاست؛ `methodId` همان «مشتری با چه ابزاری
پرداخت کرد» می‌ماند. برای این‌که هرگز دو عدد ساخته نشود، در لحظه‌ی *نوشتن* اعتبارسنجی می‌شود:
روش با `kind = CASH` ⇒ مقصد فقط `CASH` یا `MANAGER` · روش با `kind = CARD` ⇒ فقط `CARD` یا
`MANAGER` · چک و روش‌های `CUSTOM`/`CREDIT` ⇒ هر سه. پس «مشتق کردن از روش پرداخت» و «پرسیدن از
کاربر» به یک عدد می‌رسند و ردیف متناقض («روش نقدی، مقصد کارت») ساخته نمی‌شود.
سبدبندی در **یک تابع خالص** جمع شد: `receiptBucketOf()` در `src/shared/accounting.ts`.
همه‌ی مسیرها باید از همان رد شوند.

## رفتار داده‌ی قدیمی (`destination = null`) — و تناقضی که ناچار حل شد
پرامپت دو قاعده داد که برای چکِ پاس‌شده‌ی قدیمی با هم جمع نمی‌شوند: «هیچ حدسی نزن» و «هیچ عدد
گزارش قدیمی عوض نشود» (چون همان مبلغ قبلاً *دو جا* شمرده می‌شد، پس هیچ عدد قدیمی‌ای درست نبود).
تصمیم، خط‌به‌خط و مستند در کد:
* مقصد هیچ ردیفی حدس زده **نمی‌شود** و هیچ `UPDATE`ی در migration نیست.
* چکِ پاس‌شده‌ی بی‌مقصد از سبد «سایر» بیرون آمد و سبد و برچسب خودش را گرفت
  (`destinationUnknown` / «نامشخص») ⇒ دیگر بی‌صدا در «انتظار کارتخوان» جمع نمی‌شود.
* برای دست‌نخوردن جمع‌های قبلی، همین مبلغ **همچنان** در `receivedTotal`، در `netCashMovement`
  و در `expectedCash` می‌آید — ولی از راه ورودیِ **جداگانه‌ی** `clearedUnknownChequeAmount` تا
  پنل بتواند با برچسب «نامشخص» و متن توضیحی نشانش دهد. برای داده‌ی تازه این شاخه همیشه صفر است.
* پرداختیِ *غیرچکیِ* قدیمی مو‌به‌مو همان سبد قبلی را از `kind` روش پرداخت می‌گیرد.

## فایل‌هایی که این نشست واقعاً عوض شدند (کار الف)
| فایل | چه شد |
|---|---|
| `prisma/schema.prisma` | `Payment.destination String?` + `@@index([destination])` + `@@index([clearedAt, destination])` |
| `prisma/migrations/20270923100000_payment_destination/migration.sql` | **تازه** — فقط `ADD COLUMN` + دو ایندکس؛ هیچ `UPDATE`/`DROP`ی نیست |
| `prisma/manual/20270923_payment_destination.sql` | **تازه** — نسخه‌ی دستیِ همان فایل (الگوی پروژه) |
| `src/shared/enums.ts` | `PaymentDestination` + `PAYMENT_DESTINATIONS` + `PAYMENT_DESTINATION_LABELS`/`_HINTS` + `PAYMENT_DESTINATION_UNKNOWN_LABEL` + `MANAGER_ACCOUNT_ROW_LABEL`/`_NOTE` + `DESTINATION_UNKNOWN_ROW_LABEL`/`_NOTE` + `normalizePaymentDestination` · `paymentDestinationLabel` · `allowedDestinationsFor` · `destinationFromMethodKind` · `destinationReachedStore` |
| `src/shared/accounting.ts` | `receiptBucketOf()` (منبع حقیقتِ سبدبندی) · `PaymentTotals`: `clearedCardCheques`/`clearedManagerCheques`/`clearedUnknownCheques`/`managerAccount`/`destinationUnknown`/`priorPeriodCash`/`priorPeriodCard`/`priorPeriodOther` (و معنای `clearedCashCheques` دقیق شد) · `CashStatement`: `managerAccountReceived`/`destinationUnknownReceived`/`clearedChequeTo*` · `ChequeTotals`: `clearedToCash/Card/Manager/Unknown` · `CashCloseInput`: `clearedUnknownChequeAmount`/`managerAccountReceived` · `CashCloseResult`: `managerAccountReceived`/`unknownDestinationInExpected` · `BridgeInput.managerAccountReceived` + ردیف تازه‌ی پل تطبیق |
| `src/shared/types.ts` | `InvoicePaymentRow`: `destination`/`destinationLabel`/`reachedStore` · `AddInvoicePaymentInput.destination` · `SaleReportRow`/`SaleReportTotals`: `managerAccountTotal`/`destinationUnknownTotal` · `SaleCashBlock` و `SaleChequeBlock` هم‌تراز `accounting.ts` · `ShiftPaymentRow`: `destination`/`destinationLabel`/`reachedStore`/`byClearedAt` · `shiftPaymentTotals`: `cashTotal`/`cardTotal`/`managerTotal`/`unknownTotal` · `ShiftInfo`: `managerAccountTotal`/`destinationUnknownTotal`/`otherTotal` |
| `src/main/services/reportShape.ts` | `paymentSplit` روی `receiptBucketOf` نشست؛ دو سبد تازه؛ `receivedTotal` مقصد‌مدیر را **بیرون** گذاشت و «نامشخص» را نگه داشت؛ `emptyTotals`/`sumTotals` دو عدد تازه را همیشه پر می‌کنند |
| `src/main/services/accountingReport.ts` | `destination` کلید `groupBy` شد (هر دو کوئری) · تفکیک چکِ پاس‌شده با یک `groupBy` جدا روی **همان `where`ِ `clearedAt`** تا با `cheques.cleared` واگرا نشود · `calculateCashStatement` تفکیک چک را از `pay.cheques` می‌گیرد · `realCash` سهم مدیر را بیرون گذاشت · ردیف تازه‌ی پل تطبیق + متن راهنما · `priorPeriod` سهم مدیر را نمی‌شمارد و به نقد/کارت/سایر تفکیک شد |
| `src/main/services/SalesService.ts` | `assertDestination()` (اجباری، بی‌پیش‌فرض، سازگار با روش پرداخت، پیام فارسی) · `methodKindOf()` · `shapePaymentRow` سه فیلد تازه · `addPayment` مقصد می‌گیرد و در AuditLog می‌نویسد (چکِ تازه عمداً `null`) · `setChequeStatus` برای `CLEARED` مقصد اجباری و برای بازگشت از «پاس شد» مقصد را **پاک** می‌کند · `updatePayment` ویرایش مقصد + اعتبارسنجی با روشِ جدید · `deletePayment` مقصدِ پاک‌شده را در AuditLog ثبت می‌کند |

## ❌ باقی‌ماندهٔ کار الف — نشست بعد **دقیقاً از همین‌جا** شروع کند
> ⚠️ تا وقتی بندهای ۱ تا ۴ انجام نشوند درخت **typecheck نمی‌شود**: فیلدهای اجباریِ تازه‌ی
> `ShiftInfo`، `ShiftPaymentRow`، `shiftPaymentTotals`، `SaleReportRow` و `CashCloseResult` را
> تولیدکننده‌هایشان هنوز پر نمی‌کنند. این‌ها کار مکانیکی و کوچک‌اند، ولی **باید** انجام شوند.

۱. **`SalesService`** — (الف) در `reportRows` بعد از `buildStatements`:
   `totals.managerAccountTotal = a.cash.managerAccountReceived` و
   `totals.destinationUnknownTotal = a.cash.destinationUnknownReceived`؛ و `totals.receivedTotal`
   باید «نامشخص» را نگه دارد و سهم مدیر را نگیرد.
   (ب) در `summary()` خط `cardTotal: res.totals.cardTotal + res.totals.otherTotal` ⇒ دیگر «سایر»
   را بی‌صدا در کارت جمع نکند؛ `otherTotal`/`managerAccountTotal`/`destinationUnknownTotal` را
   جدا برگرداند.
۲. **`CashboxService`** — (الف) `close()`: `clearedCashChequeAmount: acc.cheques.clearedToCash` ·
   `clearedUnknownChequeAmount: acc.cheques.clearedUnknown` ·
   `managerAccountReceived: acc.cash.managerAccountReceived` ·
   `priorCashSettlements: acc.credit.settledPriorCash` (لازم است به `SaleAccountingStatements.credit`
   اضافه شود، از `pay.totals.priorPeriodCash`) · `s.cardTotal` دیگر `+ otherTotal` نشود ·
   ستون‌های `CashSession` و بلوک `cashClose.components` ردیف «حساب مدیر» و «نامشخص» بگیرند.
   (ب) `shiftPaymentsOf()`: فیلتر شیفت برای چکِ پاس‌شده با `clearedAt` (`OR: [{paidAt: range},
   {kind: CHEQUE, chequeStatus: CLEARED, clearedAt: range}]`)، پرچم `byClearedAt`، و تفکیک
   `totals` به `cashTotal`/`cardTotal`/`managerTotal`/`unknownTotal` با `receiptBucketOf`.
   ⚠️ `cumulative`/`remainingAfter` باید همان ترتیب فعلی را نگه دارد.
۳. **`ShiftService.info`** — `cardTotal` دیگر `+ totals.otherTotal` نباشد؛ `otherTotal`،
   `managerAccountTotal` و `destinationUnknownTotal` برگردند.
۴. **`src/shared/ipc.ts` / `src/preload` / `src/main/ipc/index.ts`** — کانال تازه لازم نیست؛ فقط
   امضای ورودی `salePaymentAdd`، `salePaymentUpdate` و `saleChequeStatus` باید `destination` را
   عبور دهد (بررسی شود که تایپِ ورودی جایی دستی تکرار نشده باشد).
۵. **UI** (هیچ‌کدام شروع نشد) — یک کامپوننت مشترک «کادر مقصد پول» (سه دکمه‌ی
   `PAYMENT_DESTINATIONS`، بدون پیش‌فرض، با `PAYMENT_DESTINATION_HINTS`، و فیلترشده با
   `allowedDestinationsFor(methodKind)`) بساز و در این نقاط استفاده کن:
   `components/InvoicePaymentsModal.tsx` (دکمه‌ی «پاس شد» ⇒ کادر اجباری؛ فرم ثبت پرداختی؛ ستون
   مقصد در جدول) · `pages/Pos.tsx` (کادر نسیه/پرداخت جزئی) · `pages/SalesReports.tsx`
   (`cardOf` در خط ۲۸۸ و هر `t.cardTotal + t.otherTotal` ⇒ ستون/ردیف جدا؛ ردیف
   `MANAGER_ACCOUNT_ROW_LABEL` + `MANAGER_ACCOUNT_ROW_NOTE` و ردیف «نامشخص» در بلوک خلاصه) ·
   `pages/CashClose.tsx` (خطوط ۲۱۱، ۳۷۰، ۴۰۸، ۴۲۹، ۶۰۲، ۶۲۴) · `components/ShiftDetailModal.tsx`
   (خطوط ۵۱، ۱۲۷، ۲۲۰، ۲۴۴، ۵۲۱، ۵۴۳) · `pages/Settings.tsx` (خطوط ۴۱۴۷، ۴۱۵۹) ·
   `shared/receipt.ts` + `main/print/templates.ts` + `services/xlsx.ts`/`ExportService.ts` برای
   چاپ و اکسل.
۶. **تست کار الف** (نوشته نشد) — سوییت تازه‌ی `test/acceptance-db-session36.mjs` طبق الگوی
   `test/acceptance-db-session35.mjs` و روی همان هارنس (migration تازه خودکار برداشته می‌شود،
   چون `buildDatabase` پوشه‌ی `prisma/migrations` را glob می‌کند). سناریوها: چک ۱۰٫۰۰۰٫۰۰۰ ریالی
   پاس‌شده به کارت / نقد / حساب مدیر · نسیه با همین سه حالت · «پاس شد» بدون مقصد (باید رد شود) ·
   مقصد ناسازگار با روش پرداخت (باید رد شود) · برگشت از «پاس شد» ⇒ `destination = null` ·
   حذف پرداختی · داده‌ی قدیمی با `destination = null` ⇒ برچسب «نامشخص» و دست‌نخوردن جمع‌ها ·
   و بعد از هر سناریو: `expectedCash`، انتظار کارت، ردیف «حساب مدیر» و بسته بودن پل تطبیق.
۷. **رگرسیون** — `node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs` و
   سیزده سوییت قبلی باید دوباره ۶۷۱ PASS · ۰ FAIL بدهند. اگر `prismaLite.mjs` برای
   `groupBy` با کلید چهارم (`destination`) یا برای `groupBy: ['destination']` خطای
   `HARNESS: ...` داد، **مترجم کم دارد، نه پروژه** — همان‌جا مترجم را کامل کن و مدارا‌کننده‌اش نکن.

## کار ب — **شروع نشد**
هیچ فایلی برای کار ب عوض نشده است: `runReturn`، `createReturn`، `createExchange`،
`CardTransferService.pay`، `StockCountService`، `Stocktake.tsx`، `shared/panels.ts`،
`main/ipc/index.ts` و `CardTransferPanel.tsx` همه دست‌نخورده‌اند. پس هیچ حالت نصفه‌کاره یا
ناسازگاری در کار ب وجود ندارد. شرح کامل خواسته و طراحیِ پیشنهادی در خودِ پرامپت جلسه ۳۶ است و
باید **بعد از بسته شدن کار الف** شروع شود.
یک نکته‌ی بررسی‌شده که برای شروع کار ب لازم است: `CardTransferPanel.tsx` با
`<ManagerGate panel={PANEL_KEYS.cardTransfers}>` قفل است ولی هندلرهای
`cardTransfer:list|get|pay|adjust|outOfSales` در `src/main/ipc/index.ts` **هیچ بررسی سمت سرور
ندارند**؛ الگوی موجودِ پروژه برای تأیید سمت سرور `PeriodLockService.assertOpen` با
`managerPassword` و `AuthService.verifyPanel` است و همان باید روی `cardTransfer:pay` بنشیند.

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate          # ستون destination را به @prisma/client اضافه می‌کند
npx prisma migrate deploy    # یا: اجرای دستی prisma/manual/20270923_payment_destination.sql
npm run typecheck            # ⚠️ تا بندهای ۱ تا ۴ بالا انجام نشوند خطا می‌دهد
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
```
