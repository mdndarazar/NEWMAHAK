# جلسه ۳۳ — سخت‌کردنِ همان چیزی که نوشته‌ایم: بخش ۱۲ و ۱۳ `creditUi.ts` · بخش ۹.۲ `credit.ts` · پنج بند هارنس از STRUCTURAL به REAL

## محیط (گام ۰)
`node v22.23.1` هست، **`npm` نیست** (یازدهمین نشست پیاپی: ۲۳ تا ۳۳) ⇒ **گام ۱ (هارنس واقعی §۲۳ روی
`@prisma/client`) طبق شرط خودِ پرامپت اجرا نشد.** کل گام ۲ (الف/ب/ج) تمام شد و گام ۳ بررسی شد.

## (ج) تصمیم‌هایی که در JSX جا مانده بودند

### بخش ۱۲ تازه `src/shared/creditUi.ts` — «فهرست اعتبار روی صفحه»
* `CREDIT_LIST_SCREEN_COLUMNS` (=۱۴) و `CREDIT_LIST_SCREEN_HEADERS` — عددِ ۱۴ در سه نقطه‌ی JSX
  تکرار شده بود (دو `<thead>` + `colSpan={14}`) و هیچ‌جا نوشته نبود از کجا آمده.
* `creditListScreenRow(r)` = برشِ همان `creditListRow` ⇒ **ردیفِ روی صفحه و ردیفِ فایل اکسل یک
  تابع‌اند.** تا دیروز هر جدول چهارده `<td>` دست‌نویس داشت؛ دو پیامدش: (۱) اضافه‌شدن یک ستون *وسط*
  `CREDIT_LIST_HEADERS` بی‌صدا داده را زیر سرستون اشتباه می‌برد (همان کلاس باگ ردیف جمع در جلسه ۳۲)،
  (۲) یک واگرایی واقعی که همین حالا وجود داشت: تب گزارشات `r.sourceLabel` را **بی‌fallback**
  می‌نوشت، پس ستون «نوع» برای ردیف‌های قدیمی خالی می‌ماند و در صفحه‌ی مدیریت اعتبار پر.
* `creditListCellFormat` + `CREDIT_LIST_MONEY_COLUMNS`/`CREDIT_LIST_COUNT_COLUMNS` و
  `creditBreakdownCellFormat` — «این ستون پول است یا شمارش» دیگر نه `money(r.amount)` پخش‌شده در دو
  فایل است و نه `typeof cell === 'number'`/`j === 1` حدس‌زدنی. تست، نامِ سرستونِ هر ستونِ مبلغی و
  شمارشی را می‌سنجد، پس جابه‌جا شدن ستون لو می‌رود.
* `creditListScreenTotals` + `creditListTotalsLabel` و `CREDIT_VIEW_TABS` (نوار تب‌ها؛ `VIEW_TITLES`
  دست‌ساز و آرایه‌ی موازی‌اش حذف شدند).

### بخش ۱۳ تازه `src/shared/creditUi.ts` — «هر نما از کدام کانال، با چه بار داده‌ای»
* `CREDIT_VIEW_CHANNELS` · `creditViewRequest(view, filter)` · `creditReportRequests(filter)` ·
  `creditTake`/`CREDIT_LIST_TAKE` · `CREDIT_LIST_ONLY_FILTERS` · `CREDIT_LIST_ONLY_HINT`.
* **تله‌ی واقعیِ این نشست:** `onlyWithRemaining` را فقط `creditList` اعمال می‌کند (سرویس بعد از کوئری
  روی ردیف‌ها)، ولی تب گزارشات همان شیء فیلتر را به `creditDashboard` هم می‌داد ⇒ کاربر تیک را
  می‌زد، جدول کم می‌شد و کارت‌های بالا دست‌نخورده می‌ماندند، بدون هیچ توضیحی. حالا کلید سهواً
  فرستاده نمی‌شود، و متنِ همین محدودیت (`CREDIT_LIST_ONLY_HINT`) کنار تیک دیده می‌شود.
* `take` یک عدد مشترک شد (صفحه ۵۰۰ می‌فرستاد و تب ۱۰۰۰، بدون هیچ دلیل نوشته‌شده‌ای) و تست می‌سنجد
  که داخل کلمپ **واقعی** سرویس (`clampInt(take ?? 1000, 1, 5000)`) بماند.
* بازه‌ی خالی هیچ کلیدی نمی‌سازد (وگرنه پیش‌فرض «امروز»ِ `creditList` خراب می‌شود) و
  `creditSettingsGet` بار داده‌ی `null` می‌گیرد.

### بخش ۹.۲ تازه `src/shared/credit.ts` — «نسخه‌ی مجدد» یک تصمیم است، نه پنج مقایسه
`isCreditReprint` · `creditPrintAction` · `creditReprintCount` · `CREDIT_REPRINT_AFTER`.
آستانه در پنج نقطه دستی نوشته شده بود: `creditCopyPlan` (`prev + i >= 1`)، `PrintService`
(`c.printCount >= 1`)، `markPrinted` (`next >= 2`)، شمارش `reprints` و انتخاب عمل AuditLog در
`markPrintedMany` (`prev >= 1`). اگر روزی یکی‌شان عوض می‌شد، کاغذ برچسب «اصل» می‌گرفت و لاگش
«چاپ مجدد» می‌ماند — و این همان سندی است که سرِ اختلاف با مشتری رو می‌شود. نام عمل به‌صورت **کلید**
برمی‌گردد (`AuditAction[creditPrintAction(prev)]`) و تست وجود هر دو کلید را در `enums.ts` واقعی می‌سنجد.

## (ب) بندهای هارنس `test/acceptance-session25.mjs` که REAL شدند
| بند | قبل | حالا واقعاً چه اجرا می‌شود |
|---|---|---|
| ۱۰ | گزاره روی متن سرویس | `isCreditReprint`/`creditPrintAction`/`creditReprintCount`/`creditCopyPlan` + وجود کلیدها در `enums.ts` + مصرفشان در سرویس |
| ۱۵ | regex روی `CREDIT_PER_PAGE_MAX` | `creditBatchPerPage` با `0`/منفی/`1e9`/رسید حرارتی/مقدار معتبر |
| ۱۶ | regex روی `= 2000` | `applyCreditPrintCap` و `creditPrintPlan` با ۲۰۰۱ سند (هر دو مسیر، یک قاعده) |
| ۲۵ | regex روی `CH.creditDashboard, filter` | `creditReportRequests`: بازه‌ی صریح، بازه‌ی خالی بی‌کلید، و نرفتنِ `CREDIT_LIST_ONLY_FILTERS` به داشبورد |
| ۲۸ | «نامِ `creditExport` در دو فایل» | `creditListScreenRow`/`creditListCellFormat` اجرا می‌شوند و هم‌طولیِ ردیف با سرستون سنجیده می‌شود |

بندهای ۱ و ۳ هم تقویت شدند: کانال‌های UI دیگر فقط از متن JSX درنمی‌آیند (JSX حالا `CH[req.channel]`
می‌زند)، بلکه از جدول‌های واقعی `CREDIT_VIEW_CHANNELS`/`CREDIT_RANGE_EXPORT_CHANNELS`/`CREDIT_OP_CHANNEL`
هم خوانده و با `shared/ipc.ts` و handler های `main/ipc` تطبیق می‌شوند.

## (الف) مرور ممیزی ۲۵ بند با چشم تازه — قراردادی که هیچ نشستی نداشت
هر §۹/§۹.۱ هم در تست دیده می‌شد و هم در سرویس مصرف می‌شد؛ ولی هیچ گزاره‌ای **نام ستون‌ها** را
نمی‌سنجید. یک نامِ غلط (`usedReceiptNo` ⇄ `usedInvoiceId`) تا لحظه‌ی اجرای واقعی روی ویندوز پیدا
نمی‌شد و در این محیط هیچ‌وقت اجرا نمی‌شود. پس بندهای ۲۵ تا ۳۱ سوییت تازه، خروجی توابع را **اجرا** و
هر نام ستون را با `prisma/schema.prisma` واقعی می‌سنجند:
`creditSearchWhere` (§۱۶، عددی و متنی) · `CREDIT_SEARCH_INVOICE_COLUMNS` · `creditStatusWhere` (§۲/§۱۵) ·
`HOLDER_AUDIT_FIELDS`/`holderSnapshot` (§۱۲) · `auditProtectedSql`/`auditPurgeableSql` روی مدل `AuditLog` (§۱۰).
به‌علاوه بند ۳۱: **هیچ عملِ AuditLogِ اعتبار از محافظت جا نمی‌ماند** — هر نام `CREDIT_*`/`STORE_CREDIT_*`
از `enums.ts` واقعی استخراج و به `isProtectedAuditRow` داده می‌شود (ادعای §۱۰ تا امروز فقط روی سه نام نمونه بود).

## تست
`test/credit-ui-logic-session33.ts` ⇒ **۳۹ PASS · ۰ FAIL**.
**جمع دوازده سوییت: ۴۲۷ PASS · ۰ FAIL** (+ `accounting-session13` که PASS است). هر ۴۷ فایل `.tsx` نحواً سالم.
گزاره‌های وابسته که با این تغییرها به‌روز شدند (نه حذف): بند ۲۳ `acceptance-session21.mjs`
(آستانه‌ی reprint حالا `isCreditReprint`) و بند ۳۵ سوییت جلسه ۳۲ (`creditListScreenTotals` و رفتنِ عددِ ۱۴).
