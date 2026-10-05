# جلسه ۴۴ — کار ب: چهار صفحه‌ی نمایشی کامل شد (انبارگردانی + بستن صندوق + ستون تب تعویض)

## صداقت فنی (اول از همه)
* `npm` **بیست‌ودومین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit`
  **اجرا نشد**. هیچ typecheck ی روی درخت انجام نشده و UI رندر/اجرا نشده است.
* اجرا شد و سبز: `node tools/tsx-parse-check.mjs` روی هر ۳ فایل دست‌خورده ⇒ سالم ·
  `test/acceptance-db-session36.mjs` ⇒ **۱۳۷ PASS · ۰ FAIL** · `test/acceptance-db-session35.mjs` ⇒
  **۲۰۴ PASS · ۰ FAIL** (بعد از تغییرها ⇒ بدون رگرسیون).
* **سوییت `test/acceptance-db-session40.mjs` باز هم نوشته نشد** — تنها بند باقی‌ماندهٔ کار ب و
  مهم‌ترین کار نشست بعد. مسیرهای جلسه ۴۲/۴۳/۴۴ همچنان تست خودکار ندارند.
* **کار الف دست نخورد** (تمام و سبز از جلسه ۴۱). به «فاکتور فروش عمده و انتخاب انبار» دست نخورد.
* هیچ عدد مالی و هیچ عدد انباری عوض نشد: این نشست هم فقط *دیده شدنِ* معلق‌ها را اضافه کرد.
  نه schema، نه migration، نه سرویس، نه IPC، نه `panels.ts` عوض شد.

## ✅ انجام‌شده

### ۱) `pages/Stocktake.tsx` — انبارگردانی (بند ۴ خواسته‌ی مالک)
* `DiscrepancyRow` سه فیلد سرور را گرفت (`pendingRestockQty`, `expectedPhysicalQty`,
  `diffAtCountWithPending`, `hasPending`) — همه با `?` تا نسخه‌ی قدیمی‌تر main صفحه را نشکند.
* `DISC_HEADERS` از ۹ به ۱۲ ستون: `PENDING_RESTOCK_COLUMN` · «موجودی فیزیکیِ مورد انتظار
  (قابل‌فروش + معلق)» · و «مغایرت نیازمند بررسی» حالا **`diffAtCountWithPending`** است.
  ستون خام `diffAtCount` حذف نشد و کنارش ماند («اختلاف خام با لحظه‌ی شمارش (بی‌معلق)») تا معلوم
  باشد تفاضل از کجا آمده. برای داده‌ی بی‌معلق این دو عدد یکی‌اند ⇒ صفر تغییر در گزارش‌های قدیمی.
* سه هلپر `rowPendingQty` / `rowExpectedPhysical` / `rowDiffWithPending`: **اول عددِ خودِ ردیفِ
  سرور** (برای ردیف شمارش‌شده این همان snapshot لحظه‌ی شمارش است و عمداً با عددِ زنده جایگزین
  نمی‌شود) و فقط در نبودش از هوک مشترک ⇒ بدون عدد موازی.
* کارت خلاصه‌ی معلق (هم‌رنگ `pendingToneBox`)، کادر هشدار `headline`، متن
  `PENDING_RESTOCK_STOCKTAKE_NOTE`، نشان `PendingStockBadge` در هر ردیف، رنگ ملایم ردیف‌های معلق،
  و دو ستون تازه در خروجی اکسل + همان جمله در تیتر فایل.
* صفحه در قفل `stocktake` خودش ماند و **هیچ دکمه‌ی تأیید/بازگشت به انبار ساخته نشد**.

### ۲) `pages/CashClose.tsx` — بستن صندوق (فقط هشدار)
* آخرین ردیف جدول «نقد داخل کشو — فرمول کامل»، بعد از ردیف‌های «فقط نمایشی»: تعداد کالای معلق +
  `pendingRestockShiftWarning` + مبلغ کارت‌به‌کارت **در متن، نه در ستون ریالی**. دلیلش در کد نوشته
  شده: این ردیف کالا می‌شمارد نه ریال، و اگر مبلغش در ستون ریالی می‌نشست اولین کسی که جدول را جمع
  می‌زد یک عددِ بی‌ربط به کشو پیدا می‌کرد.
* یک خط در **چاپ حرارتی** (فقط وقتی `totalQty > 0`) و یک پاراگراف در **تأیید بستن صندوق** که صریح
  می‌گوید بستن صندوق را متوقف نمی‌کند.
* `expectedCash`، شمارش کشو، `cashDifference` و کسری/اضافی **هیچ‌کدام دست نخوردند** و به این هوک
  وابسته نیستند؛ خطای کانال فقط همین هشدار را پنهان می‌کند.
* در کد صریح نوشته شد که این ردیف با «دریافتی به حساب مدیر»ِ کار الف **قاطی نشود**: آن پولی است که
  *از مشتری* گرفته‌ایم، این پولی است که باید *به مشتری* برگردد.

### ۳) تب «تعویض کالا» (`ExchangeTable` در `SalesReports.tsx`) — پنج نقطه با هم
`EXCHANGE_HEADERS` (۱۶ ⇒ ۱۷ ستون، معلق **کنار بلوک برگشتی** چون کالای جایگزین هیچ‌وقت معلق نیست) ·
بدنه (نشان `PendingStockBadge`) · `tfoot` (جمع ستون) · `exchangeRowValues(r, pendingQty)` با
پیش‌فرض صفر · و totals چاپ A4 و خروجی اکسل. عدد از `pending.qtyOfReturn(r.returnId)` می‌آید
(`ExchangeReportRow` این فیلد را از سرور نمی‌گیرد و این فایل خودش حسابش نمی‌کند). `ExchangeTable`
پراپ تازه‌ی `pending: PendingRestockView` گرفت تا همان یک شیئِ مشترک را مصرف کند.

## ❌ کارِ باقی‌مانده — نشست بعد دقیقاً از همین‌جا
1. **`test/acceptance-db-session40.mjs`** (تنها بند باقی‌ماندهٔ کار ب) طبق الگوی
   `acceptance-db-session36.mjs` — هر سناریو شیفت مستقل خودش. فهرست سناریوها در
   `CHANGELOG-جلسه۴۲.md`: برگشت کارت‌به‌کارت و بعد پرداخت · برگشت بدون پرداخت · تعویض با
   مابه‌التفاوت کارت‌به‌کارت · برگشت نقدی · `pay` دوباره (idempotent) · حذف/ویرایش برگشتِ معلق ·
   `pay` بدون تأیید مدیر (باید رد شود) · مغایرت انبارگردانی با کالای معلق.
2. بعد از رسیدن `npm`: `typecheck` روی سه فایل این نشست و یک نگاه چشمی به چیدمان ستون‌های تب تعویض.

## فایل‌های تغییرکرده‌ی این نشست
`src/renderer/src/pages/Stocktake.tsx` · `src/renderer/src/pages/CashClose.tsx` ·
`src/renderer/src/pages/SalesReports.tsx` · `CHANGELOG-جلسه۴۴.md` (تازه) ·
`HANDOFF-ادامه-توسعه.md` (سرِ فایل). **هیچ فایل دیگری عوض نشد.**

## دستورهایی که کاربر باید اجرا کند
### کار الف (تمام‌شده — فقط تأیید)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا prisma/manual/20270923_payment_destination.sql
npm run typecheck
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs
```
### کار ب (فقط سوییت تست مانده)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا prisma/manual/20270924_pending_restock_manager_payment.sql
npm run typecheck
node tools/tsx-parse-check.mjs src/renderer/src/pages/Stocktake.tsx src/renderer/src/pages/CashClose.tsx src/renderer/src/pages/SalesReports.tsx
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
# بعد: سوییت test/acceptance-db-session40.mjs
```
