# جلسه ۳۸ — کار الف: UI شروع شد (کادر مقصد پول + گزارش سرجمع) · بقیه‌ی UI و تست‌ها مانده · کار ب دست‌نخورده

## صداقت فنی (اول از همه)
* `npm` **شانزدهمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit` **اجرا نشد**.
* اجرا شد: `node tools/tsx-parse-check.mjs` روی **۵۲ فایل** رندرر ⇒ همه سالم،
  و `test/acceptance-db-session35.mjs` ⇒ **۲۰۲ PASS · ۰ FAIL** (بعد از تغییرهای این نشست هم).
* **کار الف تمام نشد.** بند ۱ فهرست جلسه ۳۷ (UI) *نیمی* انجام شد، سوییت تست کار الف (بند ۲) و
  تستِ ناپایدار (بند ۳) **انجام نشد**. **کار ب دست‌نخورده است** ⇒ هیچ حالت نصفه‌کاره‌ای در ب نیست.
* هیچ فایل سمت سرور در این نشست عوض نشد ⇒ هیچ عدد گزارشی نمی‌تواند عوض شده باشد. تغییرها فقط نمایشی‌اند.

## چه چیزی اضافه شد
### ۱) `components/PaymentDestinationBox.tsx` — **تازه**
کادر مشترک «مقصد پول»: سه دکمه از `PAYMENT_DESTINATIONS`، **بدون پیش‌فرض**، متن هر گزینه از
`PAYMENT_DESTINATION_HINTS`، و فهرست گزینه‌ها از همان `allowedDestinationsFor(methodKind)` که سرور
(`assertDestination`) با آن اعتبارسنجی می‌کند ⇒ هیچ‌وقت گزینه‌ای نشان داده نمی‌شود که سرور ردش کند.
انتخاب «حساب مدیر» یک توضیح زرد نشان می‌دهد که این پول در کسری/اضافی صندوق نمی‌آید.

### ۲) `lib/destinationCells.ts` — **تازه**
تنها جای تبدیل «عدد سرور ⇒ ستون جدول»: `cardOnlyOf` · `managerAccountOf` · `otherOrUnknownOf` ·
`destinationCells()` · `DESTINATION_HEADERS`. دلیلش: تا امروز هر جدول خودش `cardTotal + otherTotal`
را جمع می‌زد؛ با یک تابع مشترک، سه صفحه نمی‌توانند سه عدد بدهند. `?? 0` روی دو فیلد تازه عمدی است
(رکوردهای سابقه‌ی قبل از migration جلسه ۳۷ `null` دارند و هیچ عدد ساختگی جایشان نمی‌نشیند).

### ۳) `components/InvoicePaymentsModal.tsx`
* دکمه‌ی **«پاس شد» دیگر بی‌واسطه ثبت نمی‌کند**: یک `Modal` باز می‌شود، مقصد پرسیده می‌شود و
  `saleChequeStatus` با `destination` صدا زده می‌شود. بدون انتخاب، هشدار فارسی محلی می‌آید (به سرور
  نمی‌رود) و دکمه هم قفل نمی‌شود — همان سیاست پروژه.
* فرم «ثبت پرداختی جدید»: کادر مقصد اجباری برای `kind = CASH`؛ برای ثبت خودِ چک عمداً پرسیده
  **نمی‌شود** و همین در UI توضیح داده شده. `destination` بعد از هر ثبت موفق **پاک** می‌شود.
* ستون تازه‌ی «مقصد پول» در جدول تاریخچه (چکِ پاس‌نشده `—`، داده‌ی قدیمی «نامشخص»، حساب مدیر زرد و
  با `title` توضیحی) · `colSpan` خالی ۱۰ ⇒ ۱۱.
* `interface Method` یک `kind?: string | null` اختیاری گرفت (اگر صفحه‌ی میزبان ندهد، هر سه گزینه باز
  است و اعتبارسنجی نهایی سمت سرور می‌ماند).

### ۴) `pages/SalesReports.tsx`
* `CH.paymentMethods` حالا `kind` را هم نگه می‌دارد و به مودال پاس می‌دهد.
* `cardOf` ⇒ `cardOnlyOf` (بدون «سایر»). ستون تکیِ «کارت» در `SUMMARY_HEADERS` جایش را به **سه**
  ستون داد: «کارت» · «دریافتی به حساب مدیر» · «سایر / نامشخص» — در جدول، `tfoot`، جدول تفکیک شیفت،
  چاپ A4، چاپ حرارتی، خروجی اکسل و خط `kbd` پایین صفحه، همه از همان سه تابع مشترک.
* خط «کنترل کارت‌خوان و صندوق» دو جمله‌ی تازه گرفت: مبلغ حساب مدیر و مبلغ نامشخص، **بیرون** از
  «پولی که باید در صندوق و کارت‌خوان باشد».
* عرض ستون‌های ذخیره‌شده خودبه‌خود بازنشانی می‌شود، چون `loadWidths` با تغییر تعداد ستون `null`
  برمی‌گرداند (بررسی شد؛ نیازی به کار دستی کاربر نیست).

## ❌ باقی‌ماندهٔ کار الف — نشست بعد دقیقاً از همین‌جا
۱. **UI باقی‌مانده** (هیچ‌کدام دست‌نخورده و همه هنوز `cardTotal + otherTotal` را جمع می‌زنند؛ این
   نمایشِ *قدیمی* است، نه غلط‌شدن عدد — سرور درست می‌دهد):
   * `pages/CashClose.tsx` — کلید `components.clearedCheques` **نام عوض کرده** به `clearedCashCheques`
     (خط ۴۳۷ چاپ حرارتی و خط ۷۲۹ جدول «فرمول کامل»؛ الان `undefined` می‌خواند و صفر نشان می‌دهد ⇒
     **اولین کار نشست بعد**). ردیف‌های تازه‌ای که باید اضافه شوند: `clearedUnknownCheques`،
     `clearedCardCheques`، `clearedManagerCheques`، `managerAccountReceived`،
     `destinationUnknownReceived`، `cardExpected`، `priorCreditSettlementsCard/Other`. فقط ردیف‌هایی
     که در `expectedCash` هستند علامت + بگیرند؛ بقیه «فقط نمایشی» برچسب بخورند.
     خطوط ۲۱۱، ۳۷۰، ۴۰۸، ۴۲۹، ۶۰۲، ۶۲۴ هم `cardTotal + otherTotal` دارند و `HEADERS` باید سه‌ستونی شود.
   * `components/ShiftDetailModal.tsx` — خطوط ۵۱، ۱۲۷، ۲۲۰، ۲۴۴، ۵۲۱، ۵۴۳ · `payTotals` پیش‌فرض باید
     چهار عدد تازه (`cashTotal`/`cardTotal`/`managerTotal`/`unknownTotal`) و جدول پرداختی‌ها ستون
     «مقصد پول» + نشان `byClearedAt` بگیرد (`colSpan` ۱۳ ⇒ ۱۴ و `tfoot` ۹ ⇒ ۱۰).
   * `pages/Pos.tsx` — کادر مقصد در بلوک «فروش نسیه / پرداخت جزئی» (فقط وقتی `creditPaid > 0`).
     ⚠️ تصمیم طراحی که باید همراهش انجام شود: `saleCreate` هنوز مقصد نمی‌گیرد و
     `initialPaymentRows` (SalesService خط ۵۳۳) مقصد نمی‌نویسد ⇒ پرداختی لحظه‌ی فروش `destination = null`
     می‌ماند و در گزارش با `kind` روش پرداخت سبدبندی می‌شود (همان رفتار قبلی، هیچ عددی عوض نشده) ولی
     در پنجره‌ی اقساط برچسب «نامشخص» می‌خورد. راه درست و کم‌ریسک: `initialPaymentRows` را `async` کن،
     `kind` روش‌ها را یک‌جا بخوان و `destination = destinationFromMethodKind(kind)` بنویس (و اگر ورودی
     صریح آمد، از `assertDestination` رد کن). این همان چیزی است که پرامپ خواسته: «مقصد را از روش
     پرداخت مشتق کن». برای CUSTOM همان `null` بماند.
   * `pages/Settings.tsx` خطوط ۴۱۴۷ و ۴۱۵۹ (جدول حذف واریانت) — ساده‌ترین کار: `destinationCells`.
   * `PrintService.ts` خط ۱۱۶ — روی رسید، پرداختیِ مقصد‌مدیر با متن «— به حساب مدیر» مشخص شود.
     (`shared/receipt.ts`، `main/print/templates.ts`، `xlsx.ts` و `ExportService.ts` بررسی شدند:
     هیچ تفکیک کارت/سایری ندارند و **نیازی به تغییر ندارند** — فهرست جلسه ۳۷ اینجا سخاوتمند بود.)
۲. **سوییت تست کار الف** (`test/acceptance-db-session36.mjs`) — دست‌نخورده. سناریوها در CHANGELOG
   جلسه ۳۷ بند ۲ فهرست شده‌اند و همان‌ها معتبرند.
۳. **تستِ ناپایدار session35** — پیدا نشد (در دو اجرای این نشست هر دو بار ۲۰۲/۰ داد).

## کار ب — **شروع نشد** (عیناً مثل پایان جلسه ۳۷)
`runReturn`، `createReturn`، `createExchange`، `CardTransferService.pay`، `StockCountService`،
`Stocktake.tsx`، `shared/panels.ts`، `main/ipc/index.ts`، `CardTransferPanel.tsx` همه دست‌نخورده‌اند.
نکته‌ی آماده: هندلرهای `cardTransfer:list|get|pay|adjust|outOfSales` در `src/main/ipc/index.ts` هیچ
بررسی سمت سرور ندارند؛ الگوی موجود پروژه `PeriodLockService.assertOpen` با `managerPassword` و
`AuthService.verifyPanel` است و همان باید روی `cardTransfer:pay` بنشیند.

## فایل‌های تغییرکرده‌ی این نشست
| فایل | وضعیت |
|---|---|
| `src/renderer/src/components/PaymentDestinationBox.tsx` | **تازه** |
| `src/renderer/src/lib/destinationCells.ts` | **تازه** |
| `src/renderer/src/components/InvoicePaymentsModal.tsx` | تغییر |
| `src/renderer/src/pages/SalesReports.tsx` | تغییر |

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا اجرای دستی prisma/manual/20270923*.sql (از جلسه ۳۷)
npm run typecheck
node tools/tsx-parse-check.mjs src/renderer/src/pages/*.tsx src/renderer/src/components/*.tsx
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
```
