# جلسه ۳۴ — بخش ۹.۳ و ۹.۴ `credit.ts` · بخش ۱۴ `creditUi.ts` · **دوازده بند هارنس از STRUCTURAL به REAL**

## محیط (گام ۰)
`node v22.23.1` هست، **`npm` نیست** (دوازدهمین نشست پیاپی: ۲۳ تا ۳۴) ⇒ **گام ۱ (هارنس واقعی §۲۳ روی
`@prisma/client`) طبق شرط خودِ پرامپت اجرا نشد.** کل گام ۲ (الف/ب/ج) تمام شد و گام ۳ بررسی شد.

## (ب) بخش ۹.۳ تازه `src/shared/credit.ts` — «یک کاغذ بیرون آمد» چه چیزی در دیتابیس و در لاگ می‌نویسد
بخش ۹.۲ (نشست ۳۳) فقط *آستانه‌ی* «نسخه‌ی مجدد» را یکی کرد؛ بقیه‌ی تصمیم‌های همین مسیر داخل
`PrintService`/`StoreCreditService` گیر بودند و هارنس ۲۵ مجبور بود بندهای ۷ تا ۱۴ و ۱۷ را با regex روی
*متنِ* سرویس بسنجد. یعنی جابه‌جا شدن یک کلید در `after` یا عوض شدن موجودیت لاگ از `StoreCredit` به
`StoreCreditBatch` هیچ‌وقت لو نمی‌رفت.

* `creditShouldMarkPrinted` + `CREDIT_MARK_PRINTED_NONE` — «پیش‌فرض روشن» سه بار دستی نوشته شده بود
  (`markPrinted !== false` در دو مسیر، `=== false` در یکی). این قاعده‌ی ضدتقلبِ §۲۴ است: خاموش بماند،
  از یک اعتبار بی‌نهایت «اصل» بیرون می‌آید بی‌هیچ ردی در AuditLog.
* `creditPrintAudit` / `creditPrintNote` / `creditBatchPrintAudit` / `creditPdfAuditOnly` —
  **شکلِ ردیف AuditLog** (عمل، موجودیت، `before`/`after`، متن) یک تصمیم شد. تا دیروز `after`ِ مسیر تکی
  و مسیر گروهی دو کلید متفاوت داشتند و هیچ گزاره‌ای نمی‌توانست بگوید کدام درست است. عمل به‌صورت
  *کلید* برمی‌گردد (`AuditAction[log.action]`) و رقم فارسی تزریق می‌شود (`fa`)، چون `credit.ts` عمداً به
  `enums.ts`/`jalali.ts` وابسته نیست.
* `creditPdfSaveOutcome` · `creditPdfMarkPlan` · `creditPdfRenderPlan` · `creditPrintBatchResult` —
  لغوِ پنجره‌ی ذخیره (هیچ فایلی، هیچ شمارشی، هیچ لاگی)، انتخاب مسیر شمارش، «چند بار رندر» (باگ کاراییِ
  جلسه ۲۴ حالا یک عددِ اجراشدنی است)، و شکل خروجی که `capped` را تا خودِ UI بالا می‌آورد.
* `CREDIT_PRINT_CHANNELS`/`_TITLES`/`_LABELS` + `creditPrintChannel` و `CREDIT_REPRINT_LABEL`.

## (الف) بخش ۹.۴ تازه — هر نامی که این ماژول به Prisma می‌دهد، یک جا نوشته می‌شود
ادامه‌ی مستقیم بندهای ۲۵ تا ۳۱ نشست ۳۳ (که همین کار را برای `where` کرد). `orderBy`، `select` و
کلیدهای `data` در `create`/`update` همچنان داخل سرویس تایپ می‌شدند: یک `orderBy` روی ستونی که وجود
ندارد، خطای *زمان اجرا*ی Prisma است و در این محیط هیچ‌وقت اجرا نمی‌شود.

* `CREDIT_PRINT_WRITE_FIELDS` · `CREDIT_PRINT_SELECT` · `creditPrintSetData` ·
  `creditPrintIncrementData` · `creditIdsWhere`.
* `CREDIT_ORDER_BY` (هشت مرتب‌سازی) + `CREDIT_ORDER_BY_MODELS` ⇒ **هیچ `orderBy: {`ِ دستی در سرویس
  نمانده** و سوییت هر ستون را با مدل واقعیِ خودش در `schema.prisma` تطبیق می‌دهد.
* فهرست کلیدهای `data`: `CREDIT_REDEMPTION_CREATE_FIELDS` (۱۵ کلید) · `CREDIT_REDEMPTION_REVERSE_FIELDS` ·
  `CREDIT_REDEMPTION_SEARCH_COLUMNS` · `CREDIT_REDEMPTION_KEY_COLUMNS` · `CREDIT_BATCH_CREATE_FIELDS`
  (۲۶ کلید) · `CREDIT_BATCH_TOTAL_FIELDS` · `CREDIT_REMINDER_LOG_CREATE_FIELDS` (۱۳ کلید) ·
  `CREDIT_REMINDER_MARK_FIELDS` · `CREDIT_PRISMA_MODELS`.
  سوییت **کلیدهای واقعیِ بلوک `data`ِ سرویس را استخراج می‌کند** (هم `key: value` هم shorthand) و با این
  فهرست‌ها *و* با مدل Prisma مقایسه می‌کند ⇒ اضافه/کم/تغییرِنامِ یک ستون بی‌صدا رد نمی‌شود.

## (ج) بخش ۱۴ تازه `src/shared/creditUi.ts` — آخرین تصمیم‌هایی که در JSX مانده بودند
* `creditCellText` + `CREDIT_EMPTY_CELL` — *چاپِ* یک سلول **دو کپیِ جدا** داشت (`cellText` در
  `CreditManagement.tsx` و `creditCell` در `SalesReports.tsx`): امروز بایت‌به‌بایت یکی بودند، فردا یکی‌شان
  `null` را `—` می‌کرد و دیگری `۰`. حالا یک تابع است و قالب‌گرها (`money`/`faDigits`) تزریق می‌شوند.
* `CREDIT_SELECTION_RESET_KEYS` + `creditSelectionResetSignature` + `creditAllSelected` /
  `creditToggleAll` / `creditToggleRow` — **تله‌ی واقعیِ این نشست:** فهرست فیلترهایی که انتخاب را پاک
  می‌کنند، یک آرایه‌ی دستی در `useEffect` بود (`[from, to, search, source, status]`). اگر فیلتر تازه‌ای به
  بار داده‌ی `creditList` اضافه شود و به آن آرایه نه، کاربر با فیلترِ عوض‌شده **کاغذِ اعتبارهای قبلی را
  چاپ می‌کند** — با شمارنده و AuditLog واقعی. گزاره‌ی تازه: هیچ کلیدِ بار داده‌ی فهرست (به‌جز `take`) از
  این فهرست جا نمانده باشد.
* `CREDIT_PRINT_OP_CHANNELS` + `creditPrintOpRequest` — بار داده‌ی چاپ/PDF در پنج نقطه‌ی JSX دستی ساخته
  می‌شد، از جمله `markPrinted: true` (قاعده، نه سلیقه) و `ask`/`reveal`. اولویت هدف (ids > batchId > id)
  و سقف پنج نسخه هم همین‌جا نشست.
* `creditPrintFlash` — متنِ نتیجه (سقف‌خوردگی با عدد واقعی، تعداد نسخه‌ی مجدد، «لغو شد») یک جا شد.
* `creditDetailPrintBadges` — «چاپ بعدی نسخه‌ی مجدد خواهد بود» یک مقایسه‌ی دستی با آستانه در JSX بود،
  یعنی همان چیزی که بخش ۹.۲ یکی‌اش کرده بود. حالا از `isCreditReprint` می‌آید.
* `creditRangeExportDisabled` — «این دکمه‌ی خروجی همین حالا داده دارد؟» از `creditRangeExportOrigin`
  ساخته می‌شود (خروجی‌های `lazy` هیچ‌وقت به این دلیل غیرفعال نمی‌شوند).
* کارت‌های داشبوردِ صفحه از `TONE_CLASS` رنگ می‌گیرند (تب گزارشات از دیروز همین را می‌زد و این صفحه یک
  زنجیره‌ی سه‌تایی `?:` دستی داشت).

## بندهای هارنس `test/acceptance-session25.mjs` که REAL شدند
| بند | قبل | حالا واقعاً چه اجرا می‌شود |
|---|---|---|
| ۴ | `CH.x` در متن JSX | `CREDIT_PRINT_OP_CHANNELS` (JSX دیگر `CH[req.channel]` می‌زند) |
| ۷ | regex روی `{ marked: 0, reprints: 0 }` | `creditShouldMarkPrinted` با ۷ ورودی + خروجیِ «شمارش نشد» |
| ۸ | regex روی `increment: 1` | `creditPrintIncrementData`/`creditPrintSetData`/`CREDIT_PRINT_SELECT`/`creditIdsWhere` + تطبیق با schema |
| ۹ | regex روی `entity: 'StoreCredit'` | `creditPrintAudit` گروهی + `creditBatchPrintAudit` + مدل بودنِ هر موجودیت |
| ۱۰ | (REAL از ۳۳) | مصرف‌کننده به `AuditAction[log.action]` به‌روز شد |
| ۱۱ | regex روی `CREDIT_BULK_GENERATE` | `creditPdfAuditOnly` تکی/گروهی |
| ۱۲ | regex روی امضای `markPrinted({…})` | `creditPdfMarkPlan` + کانال PDF در `after` و در متن |
| ۱۳ | ترتیب دو رشته در سورس | `creditPdfSaveOutcome` (۴ حالت) + ترتیب لغو/نوشتن/شمارش |
| ۱۴ | شمردن تکرارِ یک نام | `creditPdfRenderPlan` (۰ و ۱ رندر) |
| ۱۷ | regex روی `res.capped` | `creditPrintBatchResult` + `creditPrintFlash` (هشدار فقط وقتی سقف خورده) |
| ۱۸ | regex روی `printed >= 1` | `creditDetailPrintBadges` روی ۰/۱/۹ |
| ۲۰ | regex روی JSX | `creditAllSelected`/`creditToggleAll`/`creditToggleRow` |
| ۲۱ | regex روی آرایه‌ی deps | `creditSelectionResetSignature` + پوشش کامل کلیدهای فهرست |
| ۲۲ و ۲۳ | regex روی `{ ids: selected }` | `creditPrintOpRequest` (اولویت هدف، سقف نسخه، `markPrinted`) |

## تست
`test/credit-ui-logic-session34.ts` ⇒ **۴۲ PASS · ۰ FAIL**.
**جمع سیزده سوییت: ۴۶۹ PASS · ۰ FAIL.** هر ۴۷ فایل `.tsx` نحواً سالم.
گزاره‌ی وابسته‌ای که با نام تازه‌ی مصرف‌کننده **به‌روز شد (نه حذف)**: بند ۲۴ سوییت جلسه ۳۳.

## گام ۳ (کارایی مسیرهای گزارش روی داده‌ی بزرگ)
بررسی شد، تغییری لازم نبود و چیزی نصفه نماند: `creditList` و `creditDashboard` هر دو با
`clampInt(take, 1, 5000)` بسته‌اند و `CREDIT_LIST_TAKE` یک عدد مشترک است؛ ایندکس‌های
`@@index([status])`/`([issuedAt])`/`([source, status])`/`([batchId])`/`([deletedAt])` روی همان ستون‌هایی
هستند که `whereFromFilter`/`creditStatusWhere` می‌سازند؛ سقف ۲۰۰۰ سند روی هر فایل چاپ/PDF و «یک بار
رندر» (بند ۱۴) هم حالا اجراشدنی‌اند. **ریسکِ باقی‌مانده‌ی جلسه ۲۶ کمّی نشد**، چون بدون Prisma هیچ
اندازه‌گیری واقعی ممکن نیست: با npm باید روی ~۵۰٫۰۰۰ اعتبار زمانِ `creditDashboard` سنجیده شود.
