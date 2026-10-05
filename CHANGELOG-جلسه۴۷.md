# جلسه ۴۷ — «از کدام انبار کسر شود؟» (فقط فاکتور فروش عمده) — **لایه‌ی سرور تمام، UI نوشته نشد**

## صداقت فنی (اول از همه)
* `npm` **بیست‌وپنجمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit`
  **اجرا نشد**. `node` هست (v22). پس: هارنس دیتابیسِ خودمان + parse-check + منطق خالص.
  **هیچ فایلی typecheck نشده و هیچ UI ای رندر نشده است.**
* ⛔ **بندی که انجام *نشد* و کار نشست بعد است: پنجره‌ی رابط کاربری (بند ۲ و ۳ پرامپت).**
  `StockSourceModal.tsx` و وصل‌کردنش به `SalesInvoice.tsx` نوشته نشده. یعنی
  **کاربر امروز این قابلیت را نمی‌بیند**؛ همه‌ی منطق و قفل‌ها و دفترش آماده و تست‌شده است،
  ولی نقطه‌ی ورودش (`stockPlan`) از پنل فرستاده نمی‌شود. تا آن لحظه، رفتار پنل فاکتور عمده
  **مو‌به‌مو همان قبل** است (هیچ چیزی نشکسته).
* چیزی که **اجرا شد و سبز است**:

  | سوییت | نتیجه |
  |---|---|
  | `test/stock-source-logic-session47.mjs` (**تازه**، منطق خالص) | **۶۰ PASS · ۰ FAIL** |
  | `test/acceptance-db-session47.mjs` (**تازه**، هارنس واقعی) | **۹۷ PASS · ۰ FAIL** |
  | `test/acceptance-db-session35.mjs` | ۲۰۴ PASS · ۰ FAIL (بدون رگرسیون) |
  | `test/acceptance-db-session36.mjs` (کار الف) | ۱۳۷ PASS · ۰ FAIL (بدون رگرسیون) |
  | `test/acceptance-db-session40.mjs` (کار ب) | ۱۸۵ PASS · ۰ FAIL (بدون رگرسیون) |
  | `test/acceptance-src-session46.mjs` | ۳۶ PASS · ۰ FAIL (بدون رگرسیون) |
  | `tools/tsx-parse-check.mjs` روی ۹ فایل لمس‌شده | هر ۹ سالم |

  سرجمع: **۷۱۹ PASS · ۰ FAIL**.
* پنل فروش تکی، تعویض، و مسیر تیک «برداشت خودکار» **عوض نشدند** (تست ۹ همین را قفل می‌کند).

---

## معماری — چهار لایه، با مرزهای عمدی

### ۱) `src/shared/stockSource.ts` (**تازه**) — تنها منبع حقیقتِ قواعد
منطق خالص، بی import از main/renderer، بی هیچ نوشتنی. هم پنجره و هم سرویس **همین** را
صدا می‌زنند، پس هیچ‌وقت دو جواب متفاوت نمی‌دهند:
* `resolveLine(line, primaryKey, decisions)` — **قلب زنجیره‌ی سؤال‌های بند ۲**. ورودی:
  انباری که کاربر انتخاب کرده + پاسخ‌های «بله (کدام انبار)» / «نه». خروجی: ردیف‌های کسر تا
  این لحظه، و اگر کسری مانده، **سؤال بعدی** (`pending`) با `taken` / `shortfall` /
  `candidates`. `candidates` فقط انبارهایی است که **همین کالا را دارند و موجودی‌شان > ۰ و
  هنوز مصرف نشده‌اند** ⇒ خالی بودنش دقیقاً همان حالت سومِ بند ۲ است («سؤال از دیگری نپرس،
  فقط تأیید منفی بگیر»).
* `planShapeErrors` · `normalizePlan` — قاعده‌های شکلی برنامه (جمع هر قلم = تعداد فروش،
  بی منبع تکراری، بی قلمِ بی‌برنامه).
* `summarizePlan` + `summaryTextLines` — **خلاصه‌ی کسری‌های بند ۳**، به تفکیک انبار، با
  جمله‌ی خودِ مالک: `انبار X: شلوار ۳ (بعد از کسر ۲−)`.
* `STOCK_PLAN_STALE_CODE = 'STOCK_PLAN_STALE'` — کد ثابت «برنامه کهنه شد» (نه تطبیق متن فارسی).

### ۲) `SecondaryStockService.ts` — تطبیق متنی، **یک پیاده‌سازی برای هر دو مسیر**
`matchRank(row, variant)` و `variantTitle` و `MATCH_REASON_LABELS` صادر شدند و خودِ
`matchRows` (مسیر تیک خودکار) هم روی همان `matchRank` بازنویسی شد. پس مسیر تیک و مسیر
پنجره **هیچ‌وقت دو تطبیق متفاوت پیدا نمی‌کنند**. هیچ رفتاری عوض نشد.

### ۳) `src/main/services/StockAllocationService.ts` (**تازه**)
* **`preview()` — هیچ چیزی نمی‌نویسد.** برای هر قلم: انبار فروشگاه + انبار پیش‌فرض +
  هر `SecondaryWarehouse` **فعال**، با موجودی هر کدام و **نام و کد هر ردیف تطبیق‌خورده و
  دلیل تطبیقش** (تا کاربر ببیند تطبیق متنی چه پیدا کرده). تست ۱ بی‌نویسنده بودنش را با
  شمردن ردیف/لاگ/حرکت قبل و بعد اثبات می‌کند.
* **`applyPlan(tx, …)`** — داخل همان تراکنشِ فاکتور: **اول اعتبارسنجی کامل، بعد نوشتن.**
  هر ردیفی که کاربر منفی‌شدنش را تأیید نکرده و دیگر موجودی ندارد ⇒ `StalePlanError`
  (`STOCK_PLAN_STALE`) و برگشتِ کل تراکنش. سهم انبارها مستقیم از ردیف‌های همان
  `warehouseId` با ترتیب رتبه‌ی فعلی کم می‌شود و در `SecondaryStockLog` با اکشن تازه
  `SALE_WHOLESALE` و شماره فاکتور ثبت می‌گردد. **موجودی فروشگاه در این بخش دست نمی‌خورد.**
  سهم `STORE` برگردانده می‌شود تا صدازننده با همان `inventoryService.decrease`
  (`reason: 'SALE'`, `state: PENDING`) کمش کند — یعنی حرکت انبار فروشگاه عیناً همان شکل قبل.
* **«نه» روی انباری که ردیف ندارد**: یک ردیف تازه با نام/کد همان کالا و موجودی **منفی**
  ساخته می‌شود. عمداً «ساختن» است نه «نادیده گرفتن»، وگرنه بدهی آن انبار هیچ‌جا دیده نمی‌شد.
* **`reverseForSaleItems` / `reverseWholeInvoice`** — برگشت/ویرایش/حذف **دقیقاً از دفتر**،
  ترتیب **LIFO** (آخرین انباری که کاربر آگاهانه انتخابش کرد، اول پر می‌شود)، و برگشت به
  **همان ردیف‌های** `rowDetails`؛ ردیف حذف‌شده ⇒ تطبیق متنی در همان انبار ⇒ وگرنه ردیف تازه.
  کالا هیچ‌وقت گم نمی‌شود. `restoredQty` روی هر ردیفِ دفتر، دفتر مصرفِ برگشت است، پس
  برگشت‌های جزئیِ پشت‌سرهم هیچ انباری را دو بار پر نمی‌کنند.
* **`summaryOf` / `summaryForInvoices`** — خلاصه‌ی کسری‌های یک/چند فاکتور ثبت‌شده (برای رسید
  چاپی، فهرست فاکتورهای عمده و گزارش فروش). فقط خواندن.

### ۴) لایه‌ی داده
`model SaleItemStockAllocation` + migration **افزایشی محض**:
`prisma/migrations/20270925100000_sale_item_stock_allocation/migration.sql` و
`prisma/manual/20270925_sale_item_stock_allocation.sql` (**statement-به-statement یکی**).
فقط `CREATE TABLE IF NOT EXISTS` + چهار `CREATE INDEX`. **هیچ `UPDATE`/`DELETE`/`DROP`/
`RENAME`/`ALTER` ای ندارد.** عمداً بی هیچ FOREIGN KEY (قاعده‌ی `SecondaryStockLog`: دفتر
سابقه با حذف کالا/انبار نباید نابود شود) و نام انبار snapshot می‌شود.
**«نبودِ ردیف» معنای صریح دارد: فاکتور از انبار فروشگاه کسر شده.** پس هر فاکتور قبلِ این
نسخه بی هیچ مهاجرتی مو‌به‌مو مثل قبل رفتار می‌کند (تست ۱۳).

---

## نقاطی که وصل شدند
| مسیر | رفتار بی‌دفتر (فاکتور قدیمی/فروش تکی) | رفتار با دفتر |
|---|---|---|
| `SalesService.create` | **مو‌به‌مو قبل** | برنامه اعتبارسنجی و اعمال می‌شود؛ فقط سهم فروشگاه به `inventoryService` می‌رسد |
| `SalesService.update` | **مو‌به‌مو قبل** (همان delta) | کل مبدأهای قبلی به انبارهایشان برمی‌گردد و برنامه‌ی تازه از نو اعمال می‌شود. **بی برنامه، ویرایش رد می‌شود** (هیچ حدسی زده نمی‌شود) |
| `runReturn` | **مو‌به‌مو قبل** | کالا LIFO به همان انبارها؛ فقط سهم فروشگاه `increase` می‌خورد |
| `purge` (حذف) | **مو‌به‌مو قبل** | سهم انبارها به انبارها، و نقشه‌ی بازگشتِ فروشگاه به همان اندازه کم می‌شود (دوباره‌برگشت نمی‌شود) |
| `PendingRestockService.releaseReturnStock` | **مو‌به‌مو قبل** | سهم انبارها همان‌جا آزاد می‌شود. «تنها نقطه‌ی آزادسازی» بودنش دست‌نخورده ماند |

`IPC`: سه کانال تازه — `stockSourcePreview` (`stock:sourcePreview`) · `saleStockSources` ·
`saleStockSourcesMany`. هر سه فقط خواننده‌اند.

---

## دو تصمیمی که باید مالک تأییدشان کند

### الف) تفسیر بند ۴ (تیک «برداشت خودکار»)
پیاده‌شده **دقیقاً** طبق پرامپت: تیک **خاموش (پیش‌فرض) = همیشه سؤال** · تیک **روشن = فقط
انبار فروشگاه، مثل رفتار فعلی، بی سؤال**. قفلش (`posCentralWithdrawToggle`) **عوض نشد** و
کلید قفل تازه‌ای هم ساخته نشد (`wholesaleInvoiceModule` که کل صفحه را پوشانده کافی است، و
چک‌لیست README برای «گزینه‌ی حساس تازه» الزامی نمی‌آورد چون گزینه‌ی تازه‌ای اضافه نشده).
سرور صریحاً **تیک روشن + برنامه‌ی کسر را با هم رد می‌کند** (تست ۹): دو مسیر هیچ‌وقت با هم
اجرا نمی‌شوند، وگرنه یک کمبود دو بار پوشش داده می‌شد.

**نظرم:** این تفسیر با «سیستم نباید سرخود عمل کند» ناسازگار *نیست*، چون تیک یک اجازه‌ی
صریح و قفل‌دارِ مالک است. ولی **یک ناسازگاری واقعی سر جایش مانده و دست نزدم:**

### ب) ⚠️ `coverShortage` هنوز از **همه‌ی انبارها** برمی‌دارد، نه از انبار مرکزی
`coverShortage` ردیف‌های `SecondaryStockItem` را **بی فیلتر `warehouseId`** می‌خواند. یعنی
تیک «برداشت خودکار از انبار مرکزی» در عمل «برداشت خودکار از هر انباری که پیدا شود» است.
**بی‌خبر عوضش نکردم** (پرامپت هم همین را خواست).

**پیشنهادم برای تصمیم مالک:** یک خط فیلتر روی `coverShortage` که فقط انبار پیش‌فرض را
ببیند (`warehouseId: null` + ردیف واقعیِ `isDefault`). سه دلیل: (۱) اسم گزینه همین را
می‌گوید و کاربر همین را امضا کرده؛ (۲) الآن موجودی یک شعبه‌ی دیگر می‌تواند بی‌خبر خالی شود؛
(۳) هر که برداشتِ چندانباری بخواهد، از همین جلسه پنجره‌ی صریحش را دارد. یک خط کد است و
یک تست. **منتظر تأییدم.**

---

## فایل‌های تغییرکرده‌ی این نشست
**تازه:** `src/shared/stockSource.ts` · `src/main/services/StockAllocationService.ts` ·
`prisma/migrations/20270925100000_sale_item_stock_allocation/migration.sql` ·
`prisma/manual/20270925_sale_item_stock_allocation.sql` ·
`test/stock-source-logic-session47.mjs` · `test/acceptance-db-session47.mjs` ·
`CHANGELOG-جلسه۴۷.md`

**ویرایش‌شده:** `prisma/schema.prisma` (فقط مدل تازه در انتها) ·
`src/shared/enums.ts` (`SALE_WHOLESALE` / `SALE_WHOLESALE_RESTORE` + برچسب‌ها، و
`SALE_STOCK_SOURCE` / `SALE_STOCK_SOURCE_RESTORE`) · `src/shared/types.ts`
(`CreateSaleInput.stockPlan`) · `src/shared/ipc.ts` (سه کانال) · `src/main/ipc/index.ts`
(سه هندلر) · `src/main/services/SalesService.ts` (create / update / runReturn / purge) ·
`src/main/services/SecondaryStockService.ts` (صادر کردن `matchRank`/`variantTitle`) ·
`src/main/services/PendingRestockService.ts` (تقسیم آزادسازی) · `HANDOFF-ادامه-توسعه.md`

**هیچ فایل رندرری عوض نشد. هیچ عدد مالی عوض نشد. `panels.ts` دست نخورد.**

---

## ❌ کارِ باقی‌مانده — به همین ترتیب

### ۱) پنجره‌ی انتخاب انبار (کار اصلی نشست بعد)
`src/renderer/src/components/StockSourceModal.tsx` (تازه) — **یک پنجره، نه پاپ‌آپ پشت‌سرهم**:
* با باز شدن: `call(CH.stockSourcePreview, { lines })`.
* سؤال اول «از کدام انبار کسر شود؟» **بی هیچ پیش‌فرض** (`STOCK_SOURCE_TEXT.question`)،
  گزینه‌ها از `preview.options`.
* برای هر قلمِ کسری، زنجیره‌ی بند ۲ را با `resolveLine(line, primaryKey, decisions)` جلو ببر:
  `pending.candidates.length > 0` ⇒ سؤال «در انبار A تمام شد … در B و C موجود است … از آن‌ها
  کم کنم؟» با موجودی هر کدام · `=== 0` ⇒ فقط تأیید صریح منفی. «نه» ⇒ `{type:'NEGATIVE'}`.
* پای پنجره: **خلاصه‌ی کسری‌ها** از `summarizePlan` + `summaryTextLines` و تأیید نهایی.
* **دکمه‌ی «لغو کل ثبت فاکتور» در هر مرحله** (`STOCK_SOURCE_TEXT.cancelAll`).
* خروجی: `{ lines: [{ variantId, entries }] }` ⇒ همان `stockPlan`.

`SalesInvoice.tsx`:
* در `save()`: اگر `deductInventory && !autoCentral` ⇒ اول پنجره، بعد `stockPlan` در payload.
* اگر `autoCentral` روشن است ⇒ پنجره **باز نشود** و `stockPlan` نرود (مسیر فعلی).
  و برعکس: وقتی پنجره مسیر فعال است، تیک باید **غیرفعال/پنهان** شود (بند ۴).
* خطای شاملِ `STOCK_PLAN_STALE` ⇒ پنجره را **دوباره** اجرا کن (متن آماده:
  `STOCK_SOURCE_TEXT.staleTitle` / `staleHint`).
* بعد از ثبت: `inv.stockSources.lines` را در کادر نتیجه نشان بده.
* ویرایش فاکتورِ دفتر‌دار هم **باید** پنجره را اجرا کند، وگرنه سرور با پیام روشن ردش می‌کند.

### ۲) نمایش مبدأ/خلاصه در سه جای دیگر
* رسید چاپی: `ReceiptData` یک فیلد تازه (مثل `stockSourceLines?: string[]`) بگیرد،
  `PrintService.receiptDataFor` آن را از `stockAllocationService.summaryOf(invoiceId)` پر کند و
  `receiptHtml` مثل `footer` چاپش کند.
* فهرست فاکتورهای عمده (تب «فاکتورهای عمده») و گزارش فروش: یک ستون «مبدأ کسر» از
  `CH.saleStockSourcesMany` (فیلد `short`، که منفی‌ها را با ⚠ علامت می‌زند).

### ۳) محیطی (تغییری نکرده)
`npm install` · `npm run db:generate` · `npm run typecheck` روی **کل درخت**. هنوز هیچ فایلی
از جلسه ۴۲ تا ۴۷ `tsc` ندیده است.

### ۴) تصمیم مالک روی بند «ب» بالا (فیلتر `coverShortage`).

---

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npm run typecheck

# migration این جلسه (افزایشی محض: فقط یک جدول تازه و ایندکس‌هایش)
npx prisma migrate deploy          # یا: prisma/manual/20270925_sale_item_stock_allocation.sql

# تست‌های این جلسه (بی node_modules)
node --import ./test/harness/register.mjs test/stock-source-logic-session47.mjs   # ⇒ ۶۰ PASS
node --import ./test/harness/register.mjs test/acceptance-db-session47.mjs        # ⇒ ۹۷ PASS

# بدون رگرسیون (سوییت‌های قبلی)
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs        # ⇒ ۲۰۴ PASS
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs        # ⇒ ۱۳۷ PASS
node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs        # ⇒ ۱۸۵ PASS
node test/acceptance-src-session46.mjs                                           # ⇒ ۳۶ PASS
```
