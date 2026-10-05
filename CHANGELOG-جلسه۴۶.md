# جلسه ۴۶ — بستنِ بدهیِ تایپِ `refundMode` + نگهبان ساختاری برای قاعده‌های شکلیِ کار الف و ب

## صداقت فنی (اول از همه)
* `npm` **بیست‌وچهارمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit`
  **اجرا نشد**. هیچ typecheck ی روی درخت انجام نشده و UI در این نشست هم رندر/اجرا نشده است.
  `node` هست (v22)، `npm` نیست؛ پس همان مسیر همیشگی: هارنس دیتابیسِ خودمان + parse-check.
* **کار الف و کار ب هر دو از قبل تمام و سبز بودند** (جلسه ۴۱ و ۴۵). این نشست هیچ‌کدام را بازنویسی
  نکرد؛ فقط (۱) تنها بند باز مانده‌شان را بست و (۲) قاعده‌های *شکلیِ* پرامپت را که هیچ نگهبانی
  نداشتند قفل کرد.
* چیزی که **اجرا شد و سبز است**:

  | سوییت | نتیجه |
  |---|---|
  | `test/acceptance-src-session46.mjs` (**تازه**) | **۳۶ PASS · ۰ FAIL** |
  | `test/acceptance-db-session40.mjs` (کار ب) | ۱۸۵ PASS · ۰ FAIL (بدون رگرسیون) |
  | `test/acceptance-db-session36.mjs` (کار الف) | ۱۳۷ PASS · ۰ FAIL (بدون رگرسیون) |
  | `test/acceptance-db-session35.mjs` (هارنس) | ۲۰۴ PASS · ۰ FAIL (بدون رگرسیون) |
  | `tools/tsx-parse-check.mjs` روی ۱۲ فایلِ هرگز-typecheck-نشده | هر ۱۲ سالم |

  سرجمع: **۵۶۲ PASS · ۰ FAIL**.
* به «فاکتور فروش عمده و انتخاب انبار» **دست نخورد**. هیچ عدد مالی و هیچ عدد انباری عوض نشد.
  نه migration تازه‌ای ساخته شد، نه `schema.prisma`، نه سرویس، نه IPC، نه `panels.ts`، نه هیچ
  فایل رندرری.

---

## ✅ کار ۱ — `ExchangeSaleInput.refundMode` حالا واقعیت را می‌گوید
تنها بند «تصمیمِ نشست بعد» که جلسه ۴۵ باز گذاشته بود.

**`src/shared/types.ts`** (همان یونیون، خط ~۱۴۰۰):

```diff
- refundMode?: 'CASH' | 'CARD' | 'STORE_CREDIT' | null
+ refundMode?: 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | null
```

* چرا لازم بود: `SalesService.createExchange` از جلسه ۱۷ `'CARD_TO_CARD'` را می‌پذیرد
  (`['CASH','CARD','STORE_CREDIT','CARD_TO_CARD'].includes(...)`) و `SalesReturn.tsx` خط ۱۷۵ هم
  همان چهار مقدار را در state دارد؛ فقط تایپِ مشترک عقب مانده بود. خطا نمی‌داد چون مسیر IPC از
  `withUser` با `any` رد می‌شود — یعنی تایپ، دروغ *بی‌صدا* می‌گفت.
* چرا امن است: این تغییر یونیون را فقط **گسترده** می‌کند. کل درخت گشته شد؛ هیچ مصرف‌کننده‌ای روی
  این یونیون `switch` جامع یا نگاشت کامل ندارد (`refundMode` همه‌جا با `===` یا `includes` سنجیده
  می‌شود و در سرویس اول `String(...).toUpperCase()` می‌شود). پس هیچ مسیری تنگ‌تر نمی‌شود.
* کامنت بالای فیلد هم به‌روز شد تا بگوید این مقدار **عمداً جدا از `CARD`** است و از جلسه ۴۰ به
  `deferRestock` (معلق‌ماندن کالای برگشتی تا تأیید مدیر) وصل است.
* بی `tsc` نمی‌توانم بگویم «typecheck سبز شد»؛ ولی سه چیز انجام شد: parse-check فایل (سالم)،
  بررسی دستیِ همه‌ی ۲۰ نقطه‌ی `refundMode` در درخت، و گزاره‌ی ۲ و ۳ سوییتِ تازه که از این به بعد
  **هر سه نقطه را با هم می‌سنجد** — اگر یکی عوض شود و دیگری نه، تست سرخ می‌شود.

---

## ✅ کار ۲ — `test/acceptance-src-session46.mjs` (تازه): ۳۶ گزاره
دو سوییت دیتابیسیِ موجود *رفتار* را تست می‌کنند و خوب هم تست می‌کنند. ولی چند قاعده‌ی پرامپت
اصلاً رفتار اجرایی نیست، «شکلِ درخت» است، و بی `tsc`/بی رندر **هیچ نگهبانی نداشت**. این سوییت
همان‌ها را قفل می‌کند. روی `node` خالی اجرا می‌شود، بی دیتابیس و بی node_modules.

| بند | چه چیزی قفل شد |
|---|---|
| ۱ (۴ گزاره) | **یک منبع حقیقت برای `refundMode`**: یونیون `types.ts` = فهرست معتبرهای `createExchange` = state `SalesReturn.tsx` (مقایسه‌ی *مجموعه‌ای*، نه grep ساده) + وصل‌بودن `CARD_TO_CARD` به `deferRestock` |
| ۲ (۵ گزاره) | **قاعده‌ی فقط‌خواندنیِ کار ب**: در **کل رندرر** فقط `CardTransferPanel.tsx` کانال‌های نویسنده (`pay`/`cancel`/`adjust`/`releaseStock`) را می‌شناسد · هوک مشترک فقط `pendingRestockSummary` را صدا می‌زند · هر چهار صفحه‌ی نمایشی از همان هوک می‌خوانند · هیچ صفحه‌ای خودش `qty − restockedQty` را بازنمی‌سازد · تعریفِ معلق فقط در `@shared/pendingRestock` و `PendingRestockService` |
| ۳ (۵ گزاره) | **قفل**: ردیف `LOCKED_PANELS.cardTransfers` هست و صریح می‌گوید آزادسازی انبار هم با همین قفل است · `pay` و `cancel` هر دو سمت سرور `assertPanelPassword(PANEL_KEYS.cardTransfers, …)` می‌زنند · گیت از همان `AuthService` می‌آید (مکانیزم جدید ساخته نشده) · سه هندلر با `withUser` رد می‌شوند · هر چهار صفحه‌ی نمایشی در قفل خودشان مانده‌اند (`products`/`salesReports`/`stocktake`/`cashClose`) |
| ۴ (۵ گزاره) | **کار الف**: هیچ‌جای کد «سایر» را **دونفره** با «کارت» جمع نمی‌کند · هر سه مصرف‌کننده‌ی سرور ردیف جدای «حساب مدیر» و «نامشخص» دارند · `shiftPaymentsOf` هم `clearedAt` را می‌بیند هم `paidAt` · مقصد از روش پرداخت مشتق می‌شود (`destinationFromMethodKind` + `allowedDestinationsFor`) · حساب مدیر ردیف و متن توضیحی جدا دارد |
| ۵ (۵ گزاره) | **داده‌ی قدیمی**: هیچ `UPDATE`/`DROP`/`RENAME`/`DELETE` در هیچ‌یک از دو migration · ستون `destination` nullable و بی `DEFAULT` ⇒ قدیمی‌ها «نامشخص» · **برابری statement-به-statement `prisma/migrations` با `prisma/manual`** برای هر دو کار · `restockPending`/`pendingRestockQty` با DEFAULT خنثی ⇒ برگشت‌های قدیمی دوباره اضافه نمی‌شوند · دو مفهوم قاطی نشده‌اند (هیچ `destination` در migration ب، هیچ `restock` در migration الف) |
| ۶ (۱۲ گزاره) | **parse-check** هر ۱۲ فایلی که هیچ‌وقت typecheck نشده‌اند (۶ فایل جلسه ۴۲ · ۳ فایل جلسه ۴۳ · ۳ فایل جلسه ۴۴، به‌علاوه‌ی `types.ts` و `SalesReturn.tsx` که این نشست لمس/بررسی شدند) |

### چهار جهشِ عمدی برای اثبات اینکه سوییت «گاز می‌گیرد»
تست سبزِ بی‌اثر بی‌ارزش است. چهار رفتار موقتاً شکسته شد، سوییت دوباره اجرا شد، بعد درخت **عیناً**
برگشت (هر چهار فایل با `sha256sum -c` بیت‌به‌بیت تأیید شدند):

| جهش | نتیجه |
|---|---|
| برگرداندن یونیون `refundMode` به حالت قبلِ این نشست | ۳ گزاره سرخ (۱، ۲، ۳) |
| افزودن یک `call(CH.cardTransferPay, …)` به `CashClose.tsx` | ۱ گزاره سرخ (۵) |
| `cardTotal: totals.cardTotal + totals.otherTotal` در `ShiftService` (رفتار قبل از جلسه ۳۶) | ۱ گزاره سرخ (۱۵) |
| افزودن یک `UPDATE … SET destination='CARD'` به migration کار الف | ۲ گزاره سرخ (۲۰، ۲۲) |

### دو چیزی که همین جهش‌ها اصلاح کردند (و ارزشِ خودِ روش را نشان داد)
1. گزاره‌ی «جمعِ دونفره» اول با `cardTotal + otherTotal` نوشته شده بود و جهشِ
   `totals.cardTotal + totals.otherTotal` را **نگرفت**. حالا زنجیره‌ی جمع را *می‌شمارد*.
2. همان گزاره یک مورد واقعی پیدا کرد که **تخلف نیست**:
   `CashboxService` خط ۸۸۹ برای `receivedTotal` سرجمعِ **پنج** سبد را می‌زند
   (نقد + کارت + سایر + نامشخص + اعتباری، **بدون** حساب مدیر) و این عمدی و مستند است. پس معیار
   دقیق شد: ممنوع = جمعِ *دونفره‌ی* کارت و سایر، نه هر جمعی که اسمشان در آن باشد.

---

## بررسی‌های این نشست که تغییری لازم نداشتند (برای اینکه دوباره وقت نرود)
* **کار الف**: ستون + دو ایندکس در schema و هر دو نسخه‌ی SQL · `PaymentDestination` و
  `allowedDestinationsFor`/`destinationFromMethodKind` در `enums.ts` · ردیف جدای
  `managerAccountTotal` و `destinationUnknownTotal` در `ShiftService` (خط ~۷۱۶)، `CashboxService`
  و `SalesService` · ناسازگاریِ `paidAt`/`clearedAt` در `shiftPaymentsOf` **واقعاً درست شده و
  کامنتِ دلیلش سرجایش است**.
* **کار ب**: گیت سرورِ `pay` و `cancel` · idempotency روی `restockedQty < qty` در
  `PendingRestockService` · ردیف `LOCKED_PANELS` · چهار صفحه‌ی نمایشیِ فقط‌خواندنی و قفل هرکدام
  در `main.tsx`.
* «فاکتور فروش عمده و انتخاب انبار»: نزدیکش هم نشدم.

## ❌ کارِ باقی‌مانده (تغییری نکرده: فقط محیطی)
1. با اولین `npm`: `npm install` · `npm run db:generate` · `npm run typecheck` روی **کل درخت**.
   هنوز هیچ فایلی از جلسه ۴۲ تا ۴۶ `tsc` ندیده است؛ parse-check فقط خطای نحوی می‌گیرد، نه تایپ.
2. یک نگاه چشمی به چیدمان ستون‌های تب تعویض و کارت‌های «معلق» در چهار صفحه‌ی نمایشی.
3. (اختیاری) اگر `tsc` روی یونیون تازه‌ی `refundMode` جایی خطا داد، همان‌جا اصلاح شود — انتظارش
   را ندارم، ولی بی `tsc` قطعیت نمی‌فروشم.

## فایل‌های تغییرکرده‌ی این نشست
### کار الف و ب (مشترک)
* `src/shared/types.ts` — یونیون `ExchangeSaleInput.refundMode` + کامنت (تنها فایل *برنامه‌ای* این نشست)
* `test/acceptance-src-session46.mjs` (**تازه**) — ۳۶ گزاره
* `CHANGELOG-جلسه۴۶.md` (**تازه**) · `HANDOFF-ادامه-توسعه.md` (سرِ فایل)

**هیچ فایل دیگری عوض نشد.**

## دستورهایی که کاربر باید اجرا کند
### مشترک (یک بار)
```bash
npm install
npm run db:generate
npm run typecheck
node test/acceptance-src-session46.mjs           # ⇒ ۳۶ PASS · ۰ FAIL (بی دیتابیس، بی node_modules)
```
### کار الف (تمام‌شده — فقط تأیید)
```bash
npx prisma migrate deploy   # یا prisma/manual/20270923_payment_destination.sql
                            #    + prisma/manual/20270923b_cashsession_destination_totals.sql
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs   # ⇒ ۱۳۷ PASS · ۰ FAIL
```
### کار ب (تمام‌شده — فقط تأیید)
```bash
npx prisma migrate deploy   # یا prisma/manual/20270924_pending_restock_manager_payment.sql
node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs   # ⇒ ۱۸۵ PASS · ۰ FAIL
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs   # ⇒ ۲۰۴ PASS · ۰ FAIL
```
