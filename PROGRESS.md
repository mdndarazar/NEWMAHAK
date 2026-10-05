## نشست ۱۰۶

- خوشه G: دفتر رویداد اکنون برای فاکتور، برگشت/تعویض، وصول نسیه‌ی بازه‌های قبل، چک پاس‌شده و مصرف اعتبار `count` واقعی و متادیتای `totalCount/truncated` دارد؛ هشدارها تعداد واقعی و سقف نمایش را می‌گویند.
- خوشه G: `ShiftService.list` و `ShiftService.overrides` دیگر برش‌های ۲۰۰/۵۰۰۰ را بی‌اعلام رها نمی‌کنند؛ فهرست نشست آرایه‌ی سازگار قبلی را با `page/warnings` نگه می‌دارد.
- سقف‌های چاپ عمدی در `PrintService` طبق تصمیم S106-2 دست‌نخورده ماندند؛ این‌ها سقف گزارش نیستند و پاسخ چاپ `capped` را برمی‌گرداند.
- تست جدید: `tests/audit-fixes/fix-s106-report-pagination-followups.mjs` (قراردادی).
- محدودیت: npm، Prisma Client تولیدی، Electron، چاپگر واقعی و typecheck کامل در محیط حاضر نیستند.

## نشست ۱۰۷

- خوشه G/F: `PrintService.creditBatchIds` برای دسته‌ی چاپ اعتبار دیگر از `take: 5000` به‌عنوان تعداد واقعی استفاده نمی‌کند؛ تعداد واقعی از `storeCreditService.list().page.totalCount` می‌آید و فقط idهای لازم برای سقف رندر خوانده می‌شوند.
- سقف عملیاتی چاپ ۲۰۰۰ سند حذف نشد؛ پاسخ اکنون `requested` واقعی و `capped` درست دارد تا هشدار چاپ گمراه‌کننده نباشد.
- تست جدید: `tests/audit-fixes/fix-s107-credit-batch-count.mjs`.
- محدودیت: npm، Prisma Client تولیدی، Electron، چاپگر واقعی و typecheck کامل همچنان در محیط حاضر نیستند.
### نشست ۱۰۳ · خوشه G
- ✅ ریزتراکنش‌های عملکرد کارمند دیگر روی `take: 2000` بی‌صدا بریده نمی‌شوند؛ چهار مجموعه‌ی فاکتور، برگشت/تعویض، کارت‌به‌کارت و مصرف اعتبار `count()` واقعی، `skip/take` و metadata مستقل `page` دارند.
- ✅ برای هر برش هشدار فارسی صریح برگشت داده می‌شود؛ آرایه‌های چهارگانه‌ی قدیمی حفظ شده‌اند و metadata در کنار آن‌ها اضافه شده است.
- ✅ پنل ریزتراکنش دکمه‌های «صفحه‌ی قبل/بعد» دارد و فقط وقتی یکی از چهار مجموعه `truncated` است صفحه‌ی بعد را فعال می‌کند.
- تست قبل: `MAHAK_ROOT=<کپی zip نشست ۱۰۲> node tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs` ⇒ **۰ موفق · ۱۰ ناموفق**.
- تست بعد: همان تست روی خروجی نشست ۱۰۳ ⇒ **۱۰ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**.
- esbuild روی `StaffReportService.ts` و `StaffPerformancePanel.tsx` ⇒ **۲ فایل PASS**.
- رگرسیون: **۵۱ فایل، ۵۱ PASS · ۰ FAIL**؛ شکست اولیه‌ی `fix-s65` با حفظ الگوی `voidedAt: null` در query فاکتور اصلاح و دوباره PASS شد.
- `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند؛ npm/npx در محیط موجود نیست.
- فایل‌های تغییرکرده: `src/main/services/StaffReportService.ts`، `src/renderer/src/components/StaffPerformancePanel.tsx` و `tests/audit-fixes/fix-s103-staff-transactions-pagination.mjs`.

### نشست ۱۰۴ · خوشه G
- ✅ `FraudService.review` دیگر داده‌های کسری صندوق، برگشت‌ها، فروش‌ها، اعتبارهای صادرشده و overrideهای Audit را روی سقف‌های ثابت ۵۰۰/۲۰۰۰/۵۰۰۰/۲۰٬۰۰۰ بی‌صدا قطع نمی‌کند؛ خواندن صفحه‌ای تا پایان داده انجام می‌شود.
- ✅ lookupهای `IN` برای کاربران، شیفت‌ها و فاکتورهای مبدأ اعتبار به دسته‌های حداکثر ۵۰۰تایی شکسته شدند.
- تست قبل: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s104-fraud-review-scale.mjs` روی نسخه‌ی نشست ۱۰۳ ⇒ **۰ موفق · ۲ ناموفق**؛ مقدار کسری ۵۰۰ به‌جای ۵۰۱ بود.
- تست بعد: همان دستور روی نشست ۱۰۴ ⇒ **۲ موفق · ۰ ناموفق**؛ شمارش و جمع هر دو ۵۰۱.
- رگرسیون ضدتقلب: `fix-s84-fraud-audit-column.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ `fix-s89-return-rate.mjs` ⇒ **۴ موفق · ۰ ناموفق**.
- `node --check` تست نشست ۱۰۴ و esbuild واقعی روی `FraudService.ts` ⇒ **PASS**.
- `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند؛ npm/npx در محیط موجود نیست.
- فایل‌های تغییرکرده: `src/main/services/FraudService.ts` و `tests/audit-fixes/fix-s104-fraud-review-scale.mjs`.
- ✅ ادامه‌ی خوشه G: `CashboxService.shiftPaymentsOf` و `PendingRestockService.pendingReturns` از سقف بی‌هشدار ۵۰۰۰ خارج شدند؛ lookupهای `IN` آن‌ها به دسته‌های ۵۰۰تایی شکسته شد.
- ✅ `jalaliDaysBetween` دیگر بازه‌های بیشتر از ۷۳۰ روز را بی‌صدا قطع نمی‌کند.
- تست پیگیری ساختاری `fix-s104-report-scale-followups.mjs` ⇒ **۸ بررسی موفق · ۰ ناموفق**؛ تست بازه‌ی شمسی `fix-s104-jalali-range-scale.mjs` ⇒ **۳ موفق · ۰ ناموفق**.
- esbuild روی `CashboxService.ts`، `PendingRestockService.ts` و `jalali.ts` ⇒ **۳ فایل PASS**.

### نشست ۱۰۱ و ۱۰۲ · خوشه G
- ✅ صفحه‌ی بعد واقعی برای تب مدیریت اعتبار خرید: `creditUi` اکنون `skip` را به `creditList` می‌فرستد و `CreditManagementReport` metadata `page` را نگه می‌دارد؛ کنترل‌های «صفحه‌ی قبل/بعد» با `skip`/`take` واقعی اضافه شدند و با تغییر فیلتر به صفحه‌ی اول برمی‌گردند.
- ✅ سقف‌های بی‌هشدار گزارش تجمیعی کارمندان حذف شد: `performance`، تخفیف غیرعادی و هشدار خارج از شیفت دیگر روی ۲۰٬۰۰۰ ردیف truncate نمی‌شوند؛ lookupهای شناسه‌ای `StaffReportService` در دسته‌های حداکثر ۵۰۰تایی انجام می‌شوند.
- تست قبل از رفع ۱۰۱: **۰ موفق · ۷ ناموفق**؛ بعد از رفع: **۷ موفق · ۰ ناموفق**.
- تست قبل از رفع ۱۰۲: **۰ موفق · ۸ ناموفق**؛ بعد از رفع: **۸ موفق · ۰ ناموفق**.
- `node --check` تست‌های جدید: **PASS**؛ رگرسیون با هارنس داخلی: **۵۰ فایل PASS · ۰ فایل FAIL**.
- `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند؛ Prisma واقعی، Electron واقعی و typecheck همچنان اثبات‌نشده‌اند.
- فایل‌های تغییرکرده: `src/shared/creditUi.ts`، `src/renderer/src/pages/SalesReports.tsx`، `src/main/services/StaffReportService.ts`، `tests/audit-fixes/fix-s101-credit-list-next-page.mjs` و `tests/audit-fixes/fix-s102-staff-report-scale.mjs`.

### نشست ۱۰۰ · خوشه G
- `StoreCreditService.list` اکنون `PagedRows<StoreCreditRow>` برمی‌گرداند، ولی پاسخ همچنان آرایه‌ی سازگار با callerهای قدیمی است.
- `totalCount` واقعی، `skip`/`take`، `truncated` و هشدار فارسی اضافه شد؛ تیک «فقط دارای باقی‌مانده» قبل از صفحه‌بندی اعمال می‌شود.
- تب legacy اعتبار در `ReportExtraTables` برش را با نوار هشدار قرمز نشان می‌دهد.
- تست ساختاری جدید: `tests/audit-fixes/fix-s100-credit-list-pagination.mjs`.
- قبل از رفع: ۰ موفق و ۷ ناموفق؛ بعد از رفع: ۷ موفق و ۰ ناموفق.
- رگرسیون کامل audit-fixes: ۴۸ فایل موفق و ۰ فایل ناموفق؛ esbuild سه فایل لمس‌شده را PASS کرد.
- `npm install`، `npx prisma generate` و `npm run typecheck` همچنان به‌دلیل نبود npm/npx در محیط اجرا نشده‌اند.
# PROGRESS — نشست ۱ زنجیره رفع (ماژول گزارشات فروش)

قاعده این فایل: هر آیتم فقط وقتی «انجام شد» می‌شود که تستِ بازتولیدش قبل از رفع FAIL و بعد از رفع PASS داده باشد. هر چیزی که اجرا نشد، با دلیل نوشته می‌شود؛ ادعای بی‌اثبات ثبت نمی‌شود.

## گام ۰ — محیط و هارنس

| کار | وضعیت | توضیح |
| --- | --- | --- |
| `npm install` | **اجرا نشد** | در محیط اجرا npm و شبکه در دسترس نیست (فقط باینری `node` نسخه ۲۲.۲۳.۱). هیچ بسته‌ای نصب‌شدنی نیست. |
| `npx prisma generate` | **اجرا نشد** | همان دلیل: نه `npx` هست، نه بسته `prisma`/`@prisma/client`. پس «کلاینت واقعی Prisma» در این نشست قابل تولید نبود. |
| `npm run typecheck` (`tsc --noEmit`) | **اجرا نشد** | `typescript` نصب نیست. جایگزین اجرا شد: بارگذاری واقعی همه فایل‌های لمس‌شده در Node (type-stripping بومی نسخه ۲۲) + تست اجرایی. این «کامپایل‌شدن» را ثابت می‌کند، ولی جای type-check کامل را نمی‌گیرد. |
| رفع باگ کلید خارجی هارنس (`prismaLite.resolveRelation`) | ✅ انجام شد | تست کنترلی `test/fix-s56-harness.mjs` — قبل از رفع ۴ بررسی FAIL، بعد از رفع ۶/۶ PASS. |
| «`env.mjs` کلاینت واقعی را import کند» | **اجرا نشد** | فایلی به نام `env.mjs` در repo وجود ندارد؛ نقش آن را `test/harness/hooks.mjs` دارد که `@prisma/client` را به هارنس نگاشت می‌کند. تا وقتی `prisma generate` ممکن نیست، جایگزینی با کلاینت واقعی ممکن نیست. |

### سه موردی که گزارش‌ها با هم تناقض داشتند
با Prisma واقعی قابل قطعی‌کردن نبود (همان دلیل بالا). آنچه از روی schema و هارنس قطعی شد در `DECISIONS.md` بند ۰-۱ تا ۰-۳ آمده است.

### محدودیت‌های اجرانشده (صریح)
تست چندپردازه‌ای واقعی (race)، قطع برق وسط تراکنش، رندر واقعی Electron/React، timezone غیر تهران، حجم کامل ۵۰٬۰۰۰ ردیف، و migration روی داده تاریخی: هیچ‌کدام در این محیط اجرا نشدند.

## بک‌لاگ
وضعیت هر آیتم در جدول پایین همین فایل به‌روز می‌شود.

## جدول وضعیت آیتم‌های این نشست

| شناسه | خوشه | وضعیت | تست اثبات‌کننده |
| --- | --- | --- | --- |
| H-1 کلید خارجی هارنس | گام ۰ | ✅ رفع شد | `test/fix-s56-harness.mjs` |
| A1 اسکوپ رویداد (برگشت/وصول فاکتور بازه‌های قبل) | A | ✅ رفع شد | `test/fix-s56-reports.mjs` بند A1 و A1/ب |
| B1 نگاشت تسویه (`CASH_REFUND`/`CARD_REFUND`) | B | ✅ رفع شد | `test/fix-s56-reports.mjs` بند B1 |
| B1 `Payment` منفی در دریافتی‌ها | B | ✅ رفع شد | `test/fix-s56-reports.mjs` بند B1/ب |
| D1 مصرف اعتبار از دفتر مصرف | D | ✅ رفع شد | `test/fix-s56-reports.mjs` بند D1 |
| D2 تعهد اعتبار (`PARTIALLY_USED`/`SUSPENDED`، باقی‌مانده) | D | ✅ رفع شد | `test/fix-s56-reports.mjs` بند D2 |
| A2 بستن صندوق و وصول شیفت جاری | A | ⏳ انجام نشد (به این نشست نرسید) | — |
| A3 تراکنش/idempotency تجمیع و نشست | A | ⏳ انجام نشد | — |
| A4 `Payment.createdAt/createdByUserId/createdShiftId` | A | ⏳ انجام نشد (نیازمند migration) | — |
| A5 چکِ دوباره‌شمرده‌شده + پایان روز `.999` | A | ⏳ انجام نشد (ریشه تأیید شد: `endOfJalaliToday` با `23:59:59.000` در برابر `jalaliEndOfDay` با `.999`) | — |
| A6 فیلتر `shiftNumber` روی مالک واقعی رویداد | A | ✅ رفع شد (نشست ۷۲) | `tests/audit-fixes/fix-s72-shift-number.mjs` |
| C1 مبلغ برگشت از snapshot قلم | C | ✅ رفع شد (نشست ۵۷) | `tests/audit-fixes/fix-s57-returns.mjs` بندهای C1/الف تا C1/و |
| C5 تکرار saleItemId (ثبت و ویرایش) | C | ✅ رفع شد (نشست ۵۷) | `fix-s57-returns.mjs` بند C5 |
| C7 برگشت روی CANCELED/DRAFT (main + UI) | C | ✅ رفع شد (نشست ۵۷) | `fix-s57-returns.mjs` بند C7 |
| C2 remainingOf واحد · C3 recalcPaymentOverpay · C4 ردیف overpay در پل · C6 ویرایش/حذف تعویض | C | ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است | تست‌های نشست‌های ۵۸ تا ۶۶ |
| C-override مبلغ کاملِ برگشت با رمز و دلیل مدیر | C | ✅ رفع شد (نشست ۷۳) | `tests/audit-fixes/fix-s73-full-refund.mjs` |
| E، F تا M | … | ⏳ شروع نشده | — |

**رگرسیون:** همه‌ی سوییت‌های قبلی بعد از این رفع‌ها سبز ماندند: جلسه ۱۴ (۲۴)، ۲۱ (۳۴)، ۲۵ (۳۲)، ۳۵ (۲۰۴)، ۳۶ (۱۳۷)، ۴۰ (۱۸۵)، ۴۶ (۳۶)، ۴۷ (۹۷)، ۴۸ (۲۹)، ۵۴ (۹۲)، و سوییت‌های «مبدأ کسر» (۶۰+۶۰+۲۶+۳۳). تنها FAIL موجود (`stock-source-pick-session51.mjs`: ۱۰۷ PASS · ۱ FAIL) **از قبل** و عمدی است و روی نسخه‌ی دست‌نخورده هم همان یک FAIL را می‌دهد (مرحله‌ای که صریحاً «شروع نشده» علامت خورده).


## نشست ۲ زنجیره رفع (نشست ۵۷)
- گام ۰: `npm install`/`prisma generate`/`typecheck` باز هم **اجرا نشد** (محیط بدون شبکه؛ فقط Node 22.23 و esbuild). جایگزین: بارگذاری واقعی فایل‌ها در Node + بررسی نحوی TSX/TS با esbuild + تست دیتابیسی روی SQLite واقعی.
- رفع‌شده: C1، C5، C7 (جزئیات در TESTLOG).
- خوشه C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است (C2/C3/C4 باید با هم بروند).
- رگرسیون: همه‌ی سوییت‌های قبلی سبز؛ تنها FAIL از قبل و عمدی (`stock-source-pick-session51`).


## نشست ۳ زنجیره رفع (نشست ۵۸)
- گام ۰: npm install / prisma generate / typecheck باز هم **اجرا نشد** (محیط بدون شبکه؛ فقط Node 22.23). جایگزین: بارگذاری واقعی در Node + بررسی نحوی esbuild روی ۶ فایل لمس‌شده (همه OK؛ type-check نیست).
- ✅ C2 بدهی واحد remainingOf (برگشت + بازپرداخت از پول دریافتی) در recalcSettlement، addPayment، creditList، payments، chequeList، shapeSaleRow/reportRows، creditRemaining و drill-down «نسیه‌ی وصول‌نشده». recalcSettlement حالا بعد از ثبت/ویرایش/حذف برگشت هم صدا زده می‌شود.
- ✅ C3 recalcPaymentOverpay واحد (ثبت/ویرایش/حذف پرداخت، تغییر وضعیت چک، ثبت/ویرایش/حذف برگشت) + Audit قبل/بعد هر تغییر خودکار.
- ✅ C4 (بخش اول) ردیف overpayReceived با علامت منفی در پل تطبیق از aggregate واقعی + drill-down.
- ⚠️ ناتمام: بسته‌شدن کامل پل برای برگشت‌ها (پل برای هر برگشت از قبل باز است: بازپرداخت‌ها ردیف ندارند و علامت debtOnlyReturns غلط است؛ خوشه B / بند ۴-۵۴). مراحل ۲ و ۳ فلوی بند ۴-۳۵ (صدور کد اعتبار برای مبلغ اضافه) پیاده نشد.
- ❌ **رگرسیون تازه:** test/acceptance-session14.mjs از ۲۴/۰ به ۲۳/۱ رسید. بررسی نشد (به سقف اجرا رسیدم). خط FAIL: FAIL  [STRUCTURAL] 5. remaining = max(0, grandTotal - paid - returned) in shape AND recalcSettlement (تست ساختاری است: دنبال متن فرمول قدیمی «grandTotal - paid - returned» در کد می‌گردد؛ فرمول عمداً با remainingOf جایگزین شد. پس احتمالاً باید خودِ تست با دلیل در DECISIONS به remainingOf به‌روز شود، نه کد.) session 14 acceptance: 23 passed, 1 failed. احتمال: تغییر معنای settled در shapeSaleRow (حالا «بدهی صفر» است، قبلاً paidTotal ≥ grandTotal) یا remaining با بازپرداخت. **اولین کار نشست بعد.**
- خوشه C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است (باقی: رگرسیون session14، پل برگشت‌ها، فلوی اعتبار اضافه‌دریافت، C6، override مبلغ کامل).


## نشست ۵۹
- رفع شد: رگرسیون session14 (۲۴/۰)، ردیف‌های بازپرداخت پل (بند ۴-۵۴)، حذف debtOnlyReturns از پل + priorDebtReturns، بند ۴-۱۰ در تعهدی، حذف Payment منفی تعویض + ترمیم داده‌ی قدیمی، سقف واحد بازپرداخت و سقف اعتبار (۴-۳۷).
- تست: tests/audit-fixes/fix-s59-bridge-exchange.mjs — قبل ۶/۳۴، بعد ۴۵/۰. fix-s58 حالا ۲۷/۰ (بررسی پل فعال).
- خوشه B: بخش عمده رفع شد؛ باقی: تعویض روی فاکتور نسیه (کاهش بدهی به‌جای پول). خوشه C: ⚠️ ناتمام (اعتبار اضافه‌دریافت، C6، ۴-۱۱ بخش دوم، پل گزارش تاریخی).
- جزئیات کامل: بند ۱۰ فایل HANDOFF-PROMPT-next.txt.


## نشست ۶۰ (نشست ۵ زنجیره‌ی رفع)
- گام ۰: npm install / prisma generate / typecheck باز هم **اجرا نشد** (دستور npm در محیط نیست و شبکه ندارد؛ فقط Node 22.23 و esbuild). جایگزین: تست دیتابیسی روی SQLite واقعی با test/harness + بررسی نحوی esbuild روی ۷ فایل لمس‌شده (همه OK؛ type-check نیست).
- ✅ خوشه B کامل شد (بخش باقی‌مانده): تعویض روی فاکتور نسیه/نیمه‌پرداخت = کاهش بدهی فاکتور اصلی + فقط مازاد با روش انتخابی (بند ۴-۵، ۴-۳۷). پل تطبیق، صورت برگشت، دفتر رویداد و گزارش تعویض از یک تابع (exchangeRefundPartOf) می‌خوانند. فاکتور دوره‌ی قبل ⇒ ردیف priorDebtReturns.
- ✅ C6 (بخش تعویض): حذف/ویرایش تکی سند برگشت تعویض مسدود شد (قبلاً پل را باز می‌گذاشت). ⚠️ void اتمیک و حذف فیزیکی برگشت ساده هنوز باز است.
- تست: tests/audit-fixes/fix-s60-exchange-debt.mjs — قبل از رفع ۱۶ موفق/۳۷ ناموفق، بعد ۵۰/۰.
- رگرسیون: همه سبز؛ تنها FAIL قدیمی و عمدی stock-source-pick-session51 (۱۰۷/۱). یک رگرسیون موقت (session14 ۲۳/۱ به‌خاطر import در accounting.ts) همین نشست دیده و رفع شد (S60-4).
- خوشه C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است (باقی: فلوی اعتبار اضافه‌دریافت ۴-۳۵/۵۵، void اتمیک، ۴-۱۱ بخش دوم، پل گزارش تاریخی).
- جزئیات کامل: بند ۱۰ فایل HANDOFF-PROMPT-next.txt.


## نشست ۶۱ (نشست ۶ زنجیره‌ی رفع)
- گام ۰: npm install / prisma generate / typecheck باز هم **اجرا نشد** (دستور npm در محیط نیست و شبکه ندارد؛ فقط Node 22.23 و esbuild). جایگزین: تست دیتابیسی روی SQLite واقعی + بررسی نحوی esbuild روی ۸ فایل لمس‌شده (type-check نیست).
- ✅ خوشه C، بخش فلوی اضافه‌دریافت (بند ۴-۳۵ مراحل ۲ و ۳ سمت سرور، ۴-۵۵، ۴-۳۷، ۴-۳۲): addPayment با overpayAsCredit، سرویس overpayCreditIssue، منبع اعتبار OVERPAY، گیت پشتوانه در recalcSettlement، پل تطبیق بدون دوبار کسر، رد صدور گروهی جعلی.
- تست: tests/audit-fixes/fix-s61-overpay-credit.mjs — قبل از رفع ۲۱ موفق/۳۲ ناموفق (نسخه‌ی ۷ بخشی)، بعد ۵۴/۰.
- ⚠️ رفع نشد: UI دیالوگ دوم («کد اعتبار برای مبلغ اضافه صادر بشود؟») در InvoicePaymentsModal.tsx و چاپ کد؛ سرور آماده است (پرچم overpayAsCredit و کانال sale:overpay:credit).
- یافته‌ی تازه (خوشه D): اعتبار مدیریتی بدون فاکتور در ردیف storeCreditIssued پل کم می‌شود ولی فروشی پشتش نیست ⇒ پل به اندازه‌ی مبلغش باز می‌ماند.
- خوشه C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است (باقی: UI فلوی اضافه‌دریافت، void اتمیک، ۴-۱۱ بخش دوم، پل گزارش تاریخی).


## نشست ۶۲ (نشست ۷ زنجیره‌ی رفع)
- گام ۰: npm install / prisma generate / typecheck باز هم **اجرا نشد** (دستور npm و typescript در محیط نیست، شبکه ندارد؛ فقط Node 22.23 و esbuild). جایگزین: تست دیتابیسی روی SQLite واقعی + esbuild روی ۷ فایل (type-check نیست).
- ✅ باگ تازه: اضافه‌دریافت بی‌صدا در sale:create (بند ۴-۳۵ «در فروش معمولی») رفع شد؛ پل بسته.
- ✅ رمز مدیر اعتبار اضافه‌دریافت قبل از تراکنش (ریسک بن‌بست SQLite).
- ✅ UI فلوی چهارمرحله‌ای در پنجره‌ی پرداخت‌ها + دکمه‌ی صدور از اضافه‌دریافت + چاپ کد؛ «غیرقابل نقد شدن» روی هر سند چاپی اعتبار.
- تست: tests/audit-fixes/fix-s62-overpay-flow.mjs — قبل ۱۲/۶۷، بعد ۷۸/۰. رگرسیون: همه سبز؛ تنها FAIL قدیمی و عمدی stock-source-pick-session51 (۱۰۷/۱).
- خوشه C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است (باقی: فلو در SalesInvoice.tsx، void اتمیک، ۴-۱۱ بخش دوم، پل گزارش تاریخی).


## نشست ۶۳ (نشست ۸ زنجیره)
گام ۰: اجرا نشد، دلیل: محیط باز هم npm/typescript/شبکه ندارد (فقط Node 22.23 و esbuild). جایگزین: SQLite واقعی با test/harness + بررسی نحوی esbuild.
رفع‌شده (تست tests/audit-fixes/fix-s63-edit-overpay-lock.mjs — قبل ۱۸ موفق/۳۹ ناموفق، بعد ۵۷/۰):
- خوشه C / بند ۴-۳۵: sale:update که اضافه‌دریافت می‌سازد (پرداخت صریح بیشتر از جمع، یا کم‌کردن اقلام زیر پرداختی با keepPayments) قبلاً بی‌هشدار بود؛ حالا همان فلوی چهارمرحله‌ای (S63-1).
- سیم‌کشی فلو در SalesInvoice.tsx (ثبت و ویرایش، رمز سقف اعتبار، چاپ خودکار کد، نگه‌داشتن برنامه‌ی مبدأ کسر) (S63-4).
- ریسک بن‌بست + باگ امنیتی تازه: رمز مدیر دوره‌ی بسته (periodLockService.assertOpen در ۶ مسیر) و سقف اعتبار تعویض وسط تراکنش سنجیده می‌شد؛ رمز غلط failCount را داخل تراکنش می‌نوشت که rollback می‌شد ⇒ شمارنده‌ی ضد brute-force هیچ‌وقت بالا نمی‌رفت. حالا preverify قبل از تراکنش (S63-2، S63-3).
⚠️ ناتمام: ابطال اتمیک برگشت ساده (void). تست آماده در tests/audit-fixes/pending/fix-s63-return-void.mjs (قبل از رفع ۱۵/۲۹؛ خروجی در TESTLOG-s63-void-before.txt). پیاده‌سازی نیمه‌کاره عمداً برگردانده شد چون بدون فیلتر voidedAt روی همه‌ی خوانش‌ها، سند باطل هنوز در بدهی/گزارش شمرده می‌شد.


## نشست ۶۴
- ✅ خوشه C / بند ۴-۲۲: ابطال اتمیک برگشت ساده (returnDelete ⇒ void با دلیل، reverse اتمیک، رسیدگی مدیر برای برگشت‌ناپذیرها، فیلتر voidedAt در همه‌ی خوانش‌ها، UI دلیل ابطال). تست tests/audit-fixes/fix-s64-return-void.mjs: قبل ۱۵/۲۹، بعد ۴۳/۰.
- ⚠️ خوشه C هنوز ناتمام: گراف تعویض، deletePayment، بند ۴-۱۱ بخش دوم، پل تاریخی.
- محیط: npm/npx/typescript/prisma در دسترس نبود؛ typecheck اجرا نشد. فقط esbuild نحوی روی ۱۳ فایل تغییریافته: همه ok.


## نشست ۶۵
- رفع‌شده: خوشه C / بند ۴-۲۲ — ابطال اتمیک گراف تعویض؛ مسدودیت حذف S60-2 باز شد (ویرایش تکی همچنان بسته). تست tests/audit-fixes/fix-s65-exchange-void.mjs: قبل ۱۹ موفق/۴۹ ناموفق، بعد ۶۴/۰.
- فایل‌ها: prisma/schema.prisma (SaleInvoice.voidedAt/voidedByUserId/voidReason + ایندکس)، prisma/migrations/20270928100000_sale_invoice_void (جدید)، src/main/services/SalesService.ts (saleWhere، assertNotExchangeReturn فقط ویرایش، returnDelete گراف تعویض)، ShiftService.ts، StaffReportService.ts، CashboxService.ts، src/renderer/src/pages/SalesReports.tsx (دکمه و دیالوگ ابطال تعویض).
- باقی: deletePayment به void؛ مهر «باطل» در چاپ برگشت؛ override مبلغ کامل ۴-۱۱؛ پل گزارش‌های تاریخی؛ خوشه A و بقیه.

## نشست ۶۶
- ✅ بخشی از خوشه C / بند ۴-۲۲: `Payment` دیگر فیزیکی حذف نمی‌شود. ستون‌های افزایشی `voidedAt`، `voidedByUserId` و `voidReason` اضافه شد؛ `deletePayment` ردیف را با مهر زمان/کاربر/دلیل باطل می‌کند، از محاسبه‌ها و فهرست‌های فعال بیرون می‌برد و Audit با `VOID` می‌سازد.
- ✅ مهر «باطل» و دلیل روی رسید برگشت اضافه شد.
- تست: `tests/audit-fixes/fix-s66-payment-void.mjs`، ۱۱/۰؛ `test/acceptance-db-session36.mjs`، ۱۳۸/۰؛ رگرسیون `fix-s64-return-void.mjs`، ۴۳/۰ و `fix-s65-exchange-void.mjs`، ۶۴/۰.
- ⚠️ محدودیت: `npm install`، `npx prisma generate` و `npm run typecheck` همچنان به‌دلیل نبود npm/npx/شبکه اجرا نشدند؛ تست‌ها با SQLite داخلی Node 22 اجرا شدند.

## نشست ۶۷
- ✅ خوشه A، بخش actor پرداخت: پنج mutation حساس در مرز IPC (`salePaymentAdd`، `saleOverpayCredit`، `salePaymentUpdate`، `salePaymentDelete` و `saleChequeStatus`) دیگر `userId` ارسالی renderer را قبول نمی‌کنند؛ actor فقط از نشست باز خوانده می‌شود و نبود نشست با پیام فارسی متوقف می‌شود.
- فایل‌های تغییرکرده: `src/main/ipc/index.ts` و `tests/audit-fixes/fix-s67-payment-actor.mjs`.
- تست جدید: `node tests/audit-fixes/fix-s67-payment-actor.mjs`، ۱۰/۰.
- رگرسیون‌های اجراشده: `fix-s66-payment-void.mjs`، ۱۱/۰؛ `fix-s65-exchange-void.mjs`، ۶۴/۰.
- ⚠️ این نشست فقط شکاف actor در مرز IPC را بست؛ schema/migration واقعی Prisma، `createdByUserId`/`createdShiftId`/`clearedShiftId` روی Payment، close/consolidation اتمیک، تاریخچه‌ی چک و سایر بخش‌های خوشه A هنوز باز هستند.
- ⚠️ محدودیت محیط مثل نشست‌های قبل برقرار است: npm/npx/typescript/prisma در دسترس نیست؛ typecheck واقعی و رندر Electron اجرا نشد.


## نشست ۶۸
- ✅ خوشه A، provenance پرداخت: migration افزایشی `20270930100000_payment_provenance` چهار ستون `Payment.createdAt`، `createdByUserId`، `createdShiftId` و `clearedShiftId` را اضافه و داده‌ی تاریخی را با fallback امن backfill می‌کند.
- ✅ مسیرهای ساخت Payment، شامل فروش اولیه، پرداخت مرحله‌ای، تعویض و مصرف اعتبار، actor و نشست ثبت را روی خود سند ذخیره می‌کنند؛ `paidAt` همچنان تاریخ کسب‌وکاری است و `createdAt` زمان واقعی ثبت. پاس‌شدن چک `clearedShiftId` را ثبت می‌کند و ثبت پرداخت بدون نشست باز رد می‌شود.
- تست اثباتی `tests/audit-fixes/fix-s68-payment-provenance.mjs`: قبل از رفع ۱ PASS · ۱۱ FAIL، بعد از رفع ۱۲ PASS · ۰ FAIL. رگرسیون‌ها: session36، fix-s65، fix-s66 و fix-s67 همگی سبز.
- ⚠️ `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون npm/npx در محیط موجود نیست. close/consolidation اتمیک و تاریخچه‌ی append-only وضعیت چک هنوز باز است و نباید رفع‌شده اعلام شود.

## نشست ۶۹
- ✅ خوشه A، retry تجمیع: `CashboxService.finalize` فاکتورها را داخل تراکنش دوباره بررسی می‌کند؛ retry پس از تجمیع، سند مستقل و Audit می‌سازد ولی `invoiceCount=0` و `movementCount=0` دارد. فاکتور باطل هم دیگر وارد تجمیع تازه نمی‌شود.
- ✅ خوشه A، اتمیک‌سازی بستن صندوق: ساخت `CashSession`، ثبت `OPENING_FLOAT` در صورت نیاز و Audit در یک تراکنش قرار گرفتند. retry بستن صندوق مستقل است و موجودی اول را دوباره ثبت نمی‌کند.
- ✅ خوشه A، تاریخچه‌ی چک: مدل و migration `PaymentChequeStatusHistory` اضافه شد و هر تغییر وضعیت چک یک ردیف append-only می‌سازد؛ گذار `CLEARED → BOUNCED → CLEARED` مقصد/تاریخ قبلی را نگه می‌دارد.
- ✅ مرز روز: `endOfJalaliToday` به `.999` اصلاح شد تا با `jalaliEndOfDay` یکسان باشد.
- تست‌های اثباتی: `fix-s69-consolidation-retry.mjs`، ۶/۰؛ `fix-s69-cash-close-atomic.mjs`، ۵/۰؛ `fix-s69-cheque-history.mjs`، ۹/۰؛ `fix-s69-day-boundary.mjs`، ۱/۰.
- رگرسیون: `fix-s68`، ۱۲/۰؛ `fix-s67`، ۱۰/۰؛ `fix-s66`، ۱۱/۰؛ `fix-s65`، ۶۴/۰؛ `acceptance-db-session36`، ۱۳۸/۰.
- ⚠️ محدودیت‌ها برقرارند: npm/npx/typecheck واقعی، Prisma generate، race چندپردازه‌ای، قطع برق وسط تراکنش، رندر Electron/React، timezone غیر تهران، حجم ۵۰٬۰۰۰+ و migration روی داده‌ی واقعی اجرا نشدند.

## نشست ۷۰
- ✅ خوشه A / A1: دفتر رویداد دیگر برای برگشت، وصول نسیه و پاس‌شدن چک، تاریخ صدور فاکتور را به‌عنوان فیلتر رویداد تحمیل نمی‌کند؛ helper مشترک `eventSaleWhere` قید `issuedAt` را حذف می‌کند و هر query تاریخ خودش را مصرف می‌کند.
- ✅ تاریخچه‌ی append-only چک در `chequeList` از رابطه‌ی `PaymentChequeStatusHistory` خوانده و به شکل `chequeHistoryText` به UI، چاپ A4 و Excel رسیده است؛ منبع نمایش دیگر فقط snapshot فعلی Payment نیست.
- ✅ تب چک آرایه‌ی خام endpoint را هم می‌خواند؛ مشکل `pick()` که باعث خالی‌نمایی تب چک می‌شد بسته شد. چاپ و Excel دفتر رویداد و تب چک دیگر به شاخه‌ی برگشت fallback نمی‌شوند.
- تست اثباتی: `tests/audit-fixes/fix-s70-event-scope.mjs`، قبل از رفع ۳ موفق/۴ ناموفق ساختاری، بعد از رفع ۱۰ موفق/۰ ناموفق؛ تست شامل برگشت فاکتور ماه قبل، تاریخچه‌ی دو گذار چک، UI خام‌خوان و مسیر چاپ/Excel است.
- فایل‌های src تغییرکرده: `src/main/services/SalesService.ts`، `src/main/services/SalesLedger.ts`، `src/shared/types.ts`، `src/renderer/src/components/ReportExtraTables.tsx`، `src/renderer/src/pages/SalesReports.tsx`.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون `npm`/`npx` در محیط موجود نیستند. esbuild نحوی برای پنج فایل تغییرکرده سبز است.
- ⚠️ خوشه A هنوز کامل نیست: فیلتر مالک رویداد بر اساس actor/createdShiftId و تست race واقعی چندپردازه‌ای، قطع برق وسط تراکنش و migration/Prisma واقعی باز مانده‌اند.

## نشست ۷۱
- ✅ خوشه A: فیلتر مالک رویداد از فاکتور مادر جدا شد. پرداخت عادی با `createdByUserId/createdShiftId`، پاس‌چک با `clearedShiftId` و history گذار `CLEARED`، و برگشت/تعویض با `SaleReturn.userId/shiftId` فیلتر می‌شود.
- ✅ دفتر رویداد نام واقعی ثبت‌کننده و نشست وصول نسیه و نام واقعی نشست/کاربر پاس‌چک را نمایش می‌دهد؛ فاکتور قدیمی دیگر مالکیت رویداد امروز را می‌قاپد.
- ✅ `accountingReport` نیز همین مالکیت را در صورت پرداخت، چک، برگشت، پل تطبیق، وصول دوره‌های قبل و اضافه‌دریافت مصرف می‌کند.
- تست اثباتی: `tests/audit-fixes/fix-s71-event-owner.mjs`، ۹/۰؛ رگرسیون `fix-s70-event-scope.mjs`، ۱۰/۰ و تست‌های s65 تا s69 همگی سبز.
- parse نحوی سه فایل تغییرکرده با esbuild سبز شد؛ `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند چون `npm`/`npx` در محیط موجود نیستند.
- ⚠️ باز: race چندپردازه‌ای، crash/قطع برق، رندر واقعی Electron/React، Prisma واقعی و migration روی داده‌ی تاریخی؛ همچنین در نشست بعد باید فیلتر `shiftNumber` را برای مالک رویداد به شناسه‌های نشست resolve کرد.

## نشست ۷۳
- ✅ خوشه C / بند ۴-۱۱: override «مبلغ کامل بدون کسر تخفیف» اضافه شد. مسیر main اکنون `managerFullRefund` را فقط با رمز مدیر و دلیل اجباری می‌پذیرد؛ UI هم کنترل و ورودی جدا دارد.
- ✅ مبلغ override از snapshot `unitPrice` و سهم مالیات قلم محاسبه می‌شود؛ برای CASH/CARD/CARD_TO_CARD سقف مبلغ دریافتی با تایید مدیر باز می‌شود، اما STORE_CREDIT همچنان سقف پول واقعی دریافت‌شده را رعایت می‌کند.
- ✅ اثر نقدی و Audit با پرچم `fullAmountOverride` ثبت می‌شوند؛ سند برگشت (`total`) همچنان ارزش واقعی پرداخت‌شده‌ی قلم را نگه می‌دارد تا گزارش ارزش کالا با مبلغ بازپرداخت قاطی نشود.
- تست قبل از رفع: اجرای `fix-s73-full-refund.mjs` روی `SalesService.ts` نسخه‌ی zip نشست ۷۲ ⇒ ۱ موفق · ۶ ناموفق؛ override بدون گیت انجام می‌شد و مبلغ ۹۵۰ به‌جای ۱۰۵۰ بازپرداخت می‌شد.
- تست بعد از رفع: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s73-full-refund.mjs` ⇒ ۷ موفق · ۰ ناموفق.
- رگرسیون: `fix-s57-returns.mjs` ⇒ ۱۴/۰، `fix-s72-shift-number.mjs` ⇒ ۷/۰، `fix-s71-event-owner.mjs` ⇒ ۹/۰، `fix-s70-event-scope.mjs` ⇒ ۱۰/۰، `fix-s64-return-void.mjs` ⇒ ۴۳/۰، `fix-s65-exchange-void.mjs` ⇒ ۶۴/۰.
- esbuild نحوی فایل‌های `src/shared/types.ts`، `src/shared/returnValue.ts`، `src/main/services/SalesService.ts` و `src/renderer/src/pages/SalesReturn.tsx` سبز شد. `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند: npm/npx/typescript در محیط موجود نیست.
- ⚠️ خوشه C هنوز کامل نیست: پل/remaining و گراف تعویض موارد قبلی طبق backlog باقی‌اند. Prisma واقعی، migration واقعی، Electron/React واقعی، race چندپردازه‌ای، crash/قطع برق، timezone غیر تهران و حجم ۵۰٬۰۰۰+ همچنان اثبات نشده‌اند.

## نشست ۷۴
- ✅ خوشه A، دوباره‌شماری چک در دفتر رویداد رفع شد: چک حتی اگر در همان بازه پاس شده باشد، دیگر در `SALE.cashEffect` نمی‌نشیند و فقط در ردیف مستقل `CHEQUE_CLEARED` اثر می‌گذارد.
- تست اثباتی: `tests/audit-fixes/fix-s74-cluster-a.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ سناریو شامل فاکتور ۵۰۰٬۰۰۰، پرداخت چک و پاس‌شدن همان چک در یک بازه است و جمع اثر نقدی را دقیقاً ۵۰۰٬۰۰۰ اثبات می‌کند.
- فایل src تغییرکرده: `src/main/services/SalesLedger.ts`؛ فایل تست تازه: `tests/audit-fixes/fix-s74-cluster-a.mjs`.
- خوشه A همچنان کامل اعلام نمی‌شود: race چندپردازه‌ای/قطع برق، Prisma واقعی، migration روی داده‌ی تاریخی و idempotency/شرایط هم‌زمانی ساخت نشست هنوز در این محیط اثبات نشده‌اند.
- گام صفر: `npm install`، `npx prisma generate` و `npm run typecheck` با `command not found` اجرا نشدند؛ ابزار قابل اجرا فقط Node 22.23.1 و SQLite داخلی هارنس بود.

## نشست ۷۵
- ✅ خوشه A: بستن نشست قبلی و ساخت نشست تازه در `ShiftService.openSession` به یک تراکنش اتمیک منتقل شد؛ اگر ساخت نشست تازه fail شود، نشست قبلی باز می‌ماند و صندوق بدون نشست رها نمی‌شود.
- ✅ `ShiftService.close` نیز انتخاب نشست، به‌روزرسانی شرطی `closedAt: null` و Audit را داخل تراکنش انجام می‌دهد تا race روی بستن نشست اثر جعلی نسازد.
- تست قبل از رفع `fix-s75-shift-atomic.mjs`: **۲ موفق · ۳ ناموفق**؛ نشست قبلی بعد از شکست ساخت نشست تازه بسته می‌ماند.
- تست بعد از رفع: `fix-s75-shift-atomic.mjs` ⇒ **۵ موفق · ۰ ناموفق**؛ rollback واقعی SQLite بررسی شد.
- ⚠️ این رفع هنوز جایگزین race واقعی بین دو پردازه Electron نیست؛ idempotency key مستقل برای درخواست‌های بازکردن نشست هنوز باز است.

## نشست ۷۶
- ✅ خوشه A / مرز روز: `CardTransferService.jalaliRange` از `jalaliStartOfDay` و `jalaliEndOfDay` مشترک استفاده می‌کند؛ فیلتر روز انتخابی دیگر از ظهر تا ظهر روز بعد نمی‌لغزد.
- تست قبل از رفع `fix-s76-card-transfer-day-boundary.mjs`: **۱ موفق · ۵ ناموفق**؛ شروع بازه ساعت ۱۲ و پایان بازه ساعت ۱۱ روز بعد بود.
- تست بعد از رفع: `fix-s76-card-transfer-day-boundary.mjs` ⇒ **۶ موفق · ۰ ناموفق**؛ پایان روز `23:59:59.999` اثبات شد.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: همه‌ی ۲۲ تست سبز؛ `test/acceptance-db-session36.mjs` همچنان **۷ ناموفق** قدیمی درباره‌ی سبد پرداخت‌های بدون مقصد دارد.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند.
- فایل‌های src تغییرکرده در این نشست: `src/main/services/ShiftService.ts` و `src/main/services/CardTransferService.ts`.

## نشست ۷۷
- ✅ خوشه A / بند ۴-۴۷: `CashboxService.close` اجرای دوم بستن صندوق را در main بدون `allowRepeatClose` رد می‌کند و هشدار فارسی می‌دهد؛ با تأیید صریح فقط snapshot و Audit مستقل ساخته می‌شود.
- ✅ اجرای دوباره موجودی اول صندوق را دوباره در `CashMovement` ثبت نمی‌کند و `expectedCash`/اثر خالص نقد و انبار را دوباره اعمال نمی‌کند.
- ✅ `CashClose.tsx` سابقه‌ی همان نشست/بازه را قبل از تأیید به کاربر نشان می‌دهد و متن/دکمه‌ی «بستن دوباره» را جدا می‌کند؛ گیت سمت main مستقل باقی مانده است.
- تست قبل از رفع همین تست روی snapshot نشست ۷۶ ⇒ **۲ موفق · ۴ ناموفق**؛ اجرای دوم بدون تأیید پذیرفته می‌شد و snapshot/Audit اضافه می‌ساخت. تست بعد از رفع `tests/audit-fixes/fix-s77-cash-close-repeat.mjs` ⇒ **۶ موفق · ۰ ناموفق**؛ بدون تأیید درخواست دوم رد شد، با تأیید snapshot دوم ثبت شد، دفتر موجودی اول یک ردیف ماند و Audit دو تلاش را نگه داشت.
- تست قبلی `fix-s69-cash-close-atomic.mjs` برای قرارداد تازه با `allowRepeatClose: true` به‌روز شد و ⇒ **۵ موفق · ۰ ناموفق**.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: همه‌ی ۲۳ تست اجراشده سبز شدند؛ هیچ `FAIL` یا `✗`ی در خروجی نبود.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند.
- بررسی نحوی esbuild برای `CashboxService.ts`، `CashClose.tsx` و `shared/types.ts` سبز شد؛ این جایگزین typecheck واقعی Prisma/TypeScript نیست.
- فایل‌های src تغییرکرده در این نشست: `src/shared/types.ts`، `src/main/services/CashboxService.ts`، `src/renderer/src/pages/CashClose.tsx`.
- ⚠️ خوشه A هنوز کامل نیست: race چندپردازه‌ای واقعی، قطع برق وسط تراکنش، Prisma واقعی، migration روی داده‌ی تاریخی و idempotency مستقل درخواست بازکردن نشست هنوز اثبات نشده‌اند.

## نشست ۷۸
- ✅ خوشه A / گیت تعویض نشست: `ShiftService.openSession` دیگر نمی‌تواند نشستِ کارمند دیگر را بی‌رمز ببندد؛ رمز مدیر و دلیل اجباری قبل از تراکنش بررسی می‌شوند.
- ✅ تعویض تأییدشده با `openedVia='HANDOVER_FORCED'` ثبت می‌شود و Audit بستن نشست صریحاً تعویض اجباری با تأیید مدیر را اعلام می‌کند.
- ✅ `ShiftSessionModal.tsx` رمز مدیر را فقط وقتی کارمند انتخابی با صاحب نشست فعلی فرق دارد درخواست و به main ارسال می‌کند.
- تست جدید `tests/audit-fixes/fix-s78-open-session-gate.mjs` ⇒ **۸ موفق · ۰ ناموفق**؛ رد بدون رمز، بازماندن نشست قبلی، ساخت نشست تأییدشده و برچسب مستقل بررسی شد.
- رگرسیون `fix-s75-shift-atomic.mjs` ⇒ **۷ موفق · ۰ ناموفق** و `fix-s77-cash-close-repeat.mjs` ⇒ **۶ موفق · ۰ ناموفق**.
- رفتار قبل: caller با `staffId` تازه می‌توانست نشست کارمند قبلی را بدون رمز ببندد و آن را handover عادی جا بزند. رفتار بعد: بدون رمز/دلیل هیچ mutationای انجام نمی‌شود؛ با تأیید مدیر، سابقه‌ی forced قابل تشخیص است.
- فایل‌های src تغییرکرده: `src/main/services/ShiftService.ts`، `src/renderer/src/components/ShiftSessionModal.tsx`.
- ⚠️ race واقعی چندپردازه‌ای، idempotency key مستقل، Prisma/typecheck واقعی، crash/قطع برق و migration تاریخی هنوز اجرا نشده‌اند.

## نشست ۷۹
- ✅ خوشه A / بند ۴-۴۷: گیت تکرار بستن صندوق داخل همان transaction ساخت `CashSession` دوباره بررسی می‌شود؛ بررسی بیرونی فقط هشدار سریع است و دیگر تنها سد race نیست.
- ✅ اگر دو caller بدون تأیید برای یک نشست هم‌زمان برسند، caller اول snapshot می‌سازد و caller دوم بعد از commit اول با پیام فارسی رد می‌شود؛ `expectedCash` و `OPENING_FLOAT` دوباره اعمال نمی‌شوند.
- تست اثباتی تازه `tests/audit-fixes/fix-s79-cash-close-race.mjs` ⇒ **۷ موفق · ۰ ناموفق**؛ SQLite واقعی یک snapshot و جمع `expectedCash=۱۵۰۰` را اثبات کرد.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۲۵ تست PASS · ۰ تست FAIL**؛ همه‌ی تست‌های نشست‌های ۵۷ تا ۷۹ سبز هستند.
- گام صفر همچنان اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` شکست خوردند؛ Node `v22.23.1` و SQLite داخلی هارنس در دسترس است.
- ⚠️ این تست شبیه‌سازی transaction روی SQLite داخلی هارنس است، نه race واقعی دو پردازه‌ی Electron/Prisma؛ crash/قطع برق، Prisma واقعی، migration تاریخی و render واقعی هنوز اثبات نشده‌اند.
- فایل‌های src تغییریافته در این نشست: `src/main/services/CashboxService.ts`؛ فایل تست تازه: `tests/audit-fixes/fix-s79-cash-close-race.mjs`.

## نشست ۸۰
- ✅ خوشه A / idempotency بازکردن نشست: `openSession` اکنون کلید اختیاری یکتا و fingerprint درخواست را روی خود `Shift` ذخیره می‌کند؛ retry همان درخواست همان نشست را برمی‌گرداند و نشست/بستن صندوق دوم نمی‌سازد.
- ✅ استفاده‌ی همان کلید با پارامتر متفاوت رد می‌شود؛ تصادم یکتاییِ هم‌زمان نیز پس از commit caller اول به retry امن تبدیل می‌شود، نه ساخت نشست تازه.
- ✅ `ShiftSessionModal.tsx` برای بازکردن/تعویض نشست یک کلید پایدار تا پایان retry تولید و به main می‌فرستد.
- تست قبل از رفع `fix-s80-open-session-idempotency.mjs` روی snapshot نشست ۷۹: **۴ بررسی ناموفق**؛ دو بار اجرای همان درخواست دو نشست ساخت و schema/قرارداد کلید نداشت.
- تست بعد از رفع `tests/audit-fixes/fix-s80-open-session-idempotency.mjs` ⇒ **۹ موفق · ۰ ناموفق**؛ mismatch کلید و یکتایی نشست هم بررسی شد.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۲۷ تست PASS · ۰ تست FAIL**.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ esbuild CLI نیز در این محیط در دسترس نبود.
- فایل‌های src تغییریافته: `src/main/services/ShiftService.ts` و `src/renderer/src/components/ShiftSessionModal.tsx`; schema/migration و تست idempotency نیز اضافه شدند.
- ⚠️ race واقعی دو پردازه‌ی Electron/Prisma، Prisma generate/typecheck، crash/قطع برق، migration روی داده‌ی تاریخی و render واقعی UI همچنان اثبات نشده‌اند.

## نشست ۸۱ و ۸۲
- ✅ خوشه A / بستن صندوق: `tests/audit-fixes/fix-s81-cash-close-two-connections.mjs` دو اتصال مستقل به یک فایل SQLite را هم‌زمان در دو Worker اجرا می‌کند؛ caller دوم پس از آزادشدن قفل، predicate داخل transaction را می‌خواند و بدون تأیید رد می‌شود.
- ✅ در همین سناریو فقط یک `CashSession`، فقط یک `OPENING_FLOAT` و فقط یک اثر `expectedCash=۱۵۰۰` ثبت شد؛ این تست از تست تک‌اتصالی نشست ۷۹ قوی‌تر است.
- ✅ خوشه A / بازکردن نشست: `tests/audit-fixes/fix-s82-open-session-two-connections.mjs` تصادم هم‌زمان دو اتصال روی `openIdempotencyKey` را با unique index اجرا می‌کند؛ caller دوم همان fingerprint را replay می‌کند و نشست دوم نمی‌سازد.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۲۹ تست PASS · ۰ تست FAIL**.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` با `command not found` اجرا نشدند؛ `node` برابر `v22.23.1` است.
- ⚠️ این دو تست race را در سطح دو اتصال مستقل SQLite اثبات می‌کنند، نه با Prisma/Electron تولیدی. race چندپردازه‌ای واقعی Electron، crash/قطع برق، migration روی داده‌ی تاریخی و render واقعی UI هنوز اجرا نشده‌اند.
- نقطه‌ی دقیق ادامه: بعد از فراهم‌شدن npm/Prisma، همین دو سناریو را با دو client واقعی Prisma اجرا کن؛ سپس با یک تست یکپارچه، `remainingOf`، پل تطبیق، برگشت/تعویض تاریخی، بازپرداخت، اعتبار و دوره‌ی بسته را cross-check کن. تا آن زمان خوشه C را تکه‌تکه نکن.

## نشست ۸۳
- گام ۰ اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه به‌دلیل `command not found` قابل اجرا نبودند؛ `node --version` برابر `v22.23.1` است.
- رگرسیون کامل `tests/audit-fixes/*.mjs` با `node --import ./test/harness/register.mjs` روی SQLite هارنس: **۲۹ فایل PASS · ۰ فایل FAIL**، جمعاً **۵۸۰ بررسی موفق**. اجرای خام `fix-s69-day-boundary.mjs` به‌علت نبود `jalaali-js` شکست محیطی داشت، اما اجرای همان تست با resolver رسمی هارنس سبز شد.
- هیچ فایل `src` تغییر نکرد. این نشست فقط صحت بسته‌ی نشست‌های ۸۱ و ۸۲ و قابلیت بازتولید تست‌ها را دوباره کنترل کرد؛ بنابراین خوشه A هنوز در Prisma/Electron واقعی کامل و اثبات‌شده اعلام نمی‌شود و خوشه C نیز تکه‌تکه نشده است.
- محدودیت‌های باز: Prisma generate/typecheck واقعی، race دو پردازه‌ی Electron/Prisma، crash/قطع برق وسط transaction، رندر واقعی Electron/React، timezone غیر Asia/Tehran، حجم ۵۰٬۰۰۰+ با Prisma واقعی و migration روی داده‌ی تاریخی واقعی.
- نقطه‌ی ادامه: ابتدا گام ۰ را در محیط دارای npm/Prisma اجرا کن؛ سپس s81 و s82 را با دو Prisma Client واقعی بازاجرا کن؛ بعد تنها با یک تست یکپارچه سراغ `remainingOf`، پل تطبیق، برگشت/تعویض تاریخی، بازپرداخت، اعتبار و دوره‌ی بسته برو.

## نشست ۸۴
- گام ۰ دوباره اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه `command not found`؛ `node --version` = `v22.23.1`؛ شبکه در محیط نیست.
- چون خوشه A فقط در محیط Prisma/Electron واقعی قابل پیشروی است و خوشه C نباید تکه‌تکه شود، سه باگ **مستقل و غیرگره‌خورده** (که رفعشان هیچ کسری کاذب یا دوباره‌شماری نمی‌سازد) رفع شد (دلیل در DECISIONS S84-1):
- ✅ خوشه I / FraudService: کوئری override روی `AuditLog` با ستون ناموجود `createdAt` فیلتر می‌کرد و کل `review` throw می‌کرد (تب ضدتقلب همیشه کور). به ستون واقعی `at` اصلاح شد. تست `fix-s84-fraud-audit-column.mjs`: قبل **۲ موفق · ۳ ناموفق**، بعد **۵ موفق · ۰ ناموفق**.
- ✅ خوشه J / xlsx: کلاس regex در `xmlEscape` با «-» شروع می‌شد (بازه‌ی NUL گم شده بود) و هر خط‌تیره‌ی متنی (شماره فیش، کد رهگیری، کد رنگ) را فاصله می‌کرد و کاراکترهای کنترلی واقعی را هم حذف نمی‌کرد. به `[\x00-\x08\x0b\x0c\x0e-\x1f]` اصلاح شد. تست `fix-s84-xlsx-dash.mjs`: قبل **۱ موفق · ۵ ناموفق**، بعد **۶ موفق · ۰ ناموفق**.
- ✅ خوشه H (بخش DevTools، تصمیم ۴-۳۶): `devTools: !app.isPackaged` روی پنجره‌ی اصلی و منوی سفارشی فارسی فقط با نقش‌های ویرایش (بدون reload/toggleDevTools) در build نهایی. تست ایستای `fix-s84-devtools-lock.mjs`: قبل **۲ موفق · ۵ ناموفق**، بعد **۷ موفق · ۰ ناموفق**. اجرای واقعی Electron: اجرا نشد، دلیل: Electron/npm در محیط نیست.
- ⚠️ خوشه H نیمه‌کاره است: `settingsSet` allowlist و گیت `sale:purge` هنوز رفع نشده‌اند. خوشه J نیمه‌کاره است: ردیف جمع تعویض، `pick()`، شاخه‌ی چاپ اختصاصی هر تب و سه ستون چاپ برگشت باقی‌اند. خوشه I نیمه‌کاره است: فرمول نرخ برگشت، بازه‌ی «امروز» کارمند، outOfShift و ستون تعویض باقی‌اند.
- رگرسیون کامل: **۳۲ فایل PASS · ۰ فایل FAIL**، جمعاً **۶۲۷ علامت ✓** (شمارش با `grep -c ✓` روی خروجی هر فایل).
- فایل‌های src تغییریافته: `src/main/services/FraudService.ts`، `src/main/services/xlsx.ts`، `src/main/index.ts`.

## نشست ۸۵
- ✅ خوشه H / مسیر خام `settings:set`: کلیدهای ناشناس fail-closed رد می‌شوند؛ کلیدهای حساس فقط با `assertManagerPassword` پذیرفته می‌شوند؛ actor از نشست واقعی خوانده و تغییر در `AuditLog` ثبت می‌شود. کلیدهای رمز مدیر/پنل عمداً از این مسیر خام قابل نوشتن نیستند.
- ✅ خوشه H / پاک‌سازی گزارش فروش: IPC اکنون نشست باز و رمز مدیر می‌خواهد؛ `SalesService.purge` قفل دوره را بیرون و داخل تراکنش می‌سنجد و اسناد فروش، پرداخت، برگشت و اعتبار صادرشده را با مهر void نگه می‌دارد؛ `deleteMany/delete` روی بدنه‌ی purge حذف شد. اعتبار برگشتِ قبلاً مصرف‌شده باعث rollback و ارجاع به رسیدگی مدیر می‌شود.
- ✅ UI تنظیمات: رمز مدیر و دلیل پاک‌سازی به main فرستاده می‌شوند و نتیجه به‌جای «حذف» با عنوان «ابطال» نمایش داده می‌شود.
- تست قبل از رفع `fix-s85-security-gates.mjs` روی zip خام نشست ۸۴: **۲ موفق · ۱۱ ناموفق**؛ purge فیزیکی حذف می‌کرد و هیچ گیت رمز/قفل دوره‌ای نداشت، و settings:set مسیر آزاد داشت.
- تست بعد از رفع `tests/audit-fixes/fix-s85-security-gates.mjs`: **۱۳ موفق · ۰ ناموفق**؛ تست ایستا است.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۳۳ فایل PASS · ۰ فایل FAIL**؛ هیچ تست هارنس شکست نخورد.
- گام صفر همچنان ناقص است: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبود npm/npx اجرا نشدند. اجرای واقعی Electron/Prisma و migration داده‌ی تاریخی هنوز اثبات نشده‌اند.
- فایل‌های src تغییریافته: `src/main/ipc/index.ts`، `src/main/services/SalesService.ts`، `src/renderer/src/pages/Settings.tsx`؛ تست تازه: `tests/audit-fixes/fix-s85-security-gates.mjs`.
- ⚠️ خوشه H هنوز کامل نیست: پنجره‌های پنهان چاپ/بکاپ با Electron واقعی بررسی نشده‌اند. خوشه‌های I/J و C طبق وضعیت قبل باقی‌اند و خوشه C همچنان نباید تکه‌تکه شود.

## نشست ۸۶
- ✅ خوشه J / ردیف جمع تب تعویض: بعد از «جمع جایگزین» سلول خالیِ «مبدأ برداشت» اضافه شد تا `diffTotal`، نحوه‌ی تسویه و دریافت نقد در ستون درست بمانند؛ این اصلاح فقط نمایش است و عدد مالی را تغییر نمی‌دهد.
- ✅ خوشه J / رسید چاپی برگشت: خلاصه‌ی چاپی اکنون سه ستون صریح دارد: ارزش کالای برگشتی، نحوه‌ی تسویه، و پول واقعاً خارج‌شده از کشو. اثر نقدی چاپی فقط برای روش `CASH` از `refundAmount` می‌آید؛ کارت/اعتبار/کاهش بدهی صفر چاپ می‌شوند.
- تست قبل از رفع `fix-s86-exchange-return-output.mjs` روی zip خام نشست ۸۵: **۱ موفق · ۴ ناموفق**.
- تست بعد از رفع `tests/audit-fixes/fix-s86-exchange-return-output.mjs`: **۵ موفق · ۰ ناموفق**؛ تست ساختاری است.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۳۴ فایل PASS · ۰ فایل FAIL**، **۶۴۵ بررسی موفق**.
- فایل‌های src تغییریافته: `src/renderer/src/pages/SalesReports.tsx` و `src/main/print/templates.ts`; تست تازه: `tests/audit-fixes/fix-s86-exchange-return-output.mjs`.
- ⚠️ Excel تب برگشت از قبل ستون‌های متناظر را داشت و در این نشست بازنویسی نشد؛ شاخه‌های چاپ اختصاصی تب‌ها، اجرای واقعی Electron/چاپگر، Prisma واقعی و typecheck همچنان اثبات نشده‌اند.

## نشست ۸۷
- ✅ خوشه J / چاپ و Excel برگشت: قرارداد `RETURN_HEADERS` اکنون صریحاً «ارزش کالای برگشتی»، «نحوه‌ی تسویه» و «پول واقعاً خارج‌شده از کشو» را دارد؛ چاپ A4 و Excel از همان قرارداد و همان ترتیب ردیف استفاده می‌کنند.
- ✅ خوشه J / جمع خروجی تعویض: جمع چاپ A4 و جمع Excel بعد از `exchangeTotal` برای ستون متنی «مبدأ برداشت» سلول خالی دارند و `diffTotal` زیر سرستون درست می‌ماند؛ Excel اکنون ردیف جمع واقعی دارد.
- تست قبل از رفع `fix-s87-report-export-columns.mjs` روی zip خام نشست ۸۶: **۳ موفق · ۴ ناموفق**.
- تست بعد از رفع `tests/audit-fixes/fix-s87-report-export-columns.mjs`: **۷ موفق · ۰ ناموفق**؛ تست ساختاری است.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۳۵ فایل PASS · ۰ فایل FAIL**، **۶۵۲ بررسی موفق · ۰ ناموفق**.
- فایل‌های src تغییریافته: `src/renderer/src/pages/SalesReports.tsx`; تست تازه: `tests/audit-fixes/fix-s87-report-export-columns.mjs`.
- ⚠️ خوشه J هنوز کامل اعلام نمی‌شود: ساخت فایل Excel واقعی، چاپگر/Electron واقعی، شاخه‌های چاپ پنجره‌های پنهان و typecheck با Prisma تولیدی اجرا نشده‌اند.

## نشست ۸۸
- ✅ خوشه I / تب عملکرد کارمند: مصرف‌های واقعی `StoreCreditRedemption` با `userId` مصرف‌کننده و مبلغ هر ردیف دفتر به عملکرد همان کارمند اضافه شد؛ کارمندِ فقط مصرف‌کننده هم ردیف عملکرد می‌گیرد.
- ✅ خوشه I / ریز عملکرد: مصرف اعتبار با کد، شماره فیش، مبلغ، تاریخ و ساعت به drill-down اضافه شد.
- ✅ خوشه I / Prisma SaleReturn: relationهای ناموجود `user` و `shift` از selectهای `SaleReturn` حذف و lookup با `userId`/`shiftId` انجام شد؛ این مسیر در Prisma واقعی دیگر به relation جعلی وابسته نیست.
- ✅ خوشه I / بازه پیش‌فرض: performance، transactions، abnormalDiscounts و outOfShift بدون فیلتر تاریخ فقط بازه‌ی امروز را می‌خوانند.
- تست قبل روی zip خام نشست ۸۷: `fix-s88-staff-report-integrity.mjs` ⇒ **۰ موفق · ۱۳ ناموفق**.
- تست بعد: همان تست ⇒ **۱۳ موفق · ۰ ناموفق**.
- رگرسیون بعد: **۳۶ فایل PASS · ۰ فایل FAIL**؛ تست جدید و منطق shared اجرا شد.
- فایل‌های تغییرکرده: `src/shared/accounting.ts`، `src/main/services/StaffReportService.ts`، `src/renderer/src/components/StaffPerformancePanel.tsx`، `tests/audit-fixes/fix-s88-staff-report-integrity.mjs`.
- ⚠️ خوشه I کامل نیست: فرمول نرخ برگشت غیرعادی، اجرای Prisma Client/typecheck واقعی، رندر واقعی Electron/React و داده‌ی تاریخی هنوز اثبات نشده‌اند.

## نشست ۸۹
- ✅ خوشه I / ضدتقلب: منطق قبلیِ «بیش از دو برابر میانگین مبلغ برگشت» با یک فروشنده هیچ‌وقت هشدار نمی‌داد و مبلغ فروش را هم در مخرج نمی‌آورد. helper مستقل `detectReturnRateOutliers` اکنون نسبت برگشت به فروش همان بازه را محاسبه می‌کند، با میانه‌ی همتایان و کف مطلق ۲۵٪ در نمونه‌ی تک‌فروشنده؛ حداقل دو برگشت لازم است و برگشت‌های تکراری بدون فروش هم‌بازه پنهان نمی‌مانند.
- ✅ `FraudService.review` فروش‌های غیر void همان بازه را برای مخرج نرخ می‌خواند و source هشدار نسبت و تعداد برگشت را نشان می‌دهد.
- تست قبل از رفع روی کد نشست ۸۸: `fix-s89-return-rate.mjs` به‌دلیل نبود helper شکست خورد (`detectReturnRateOutliers is not a function`).
- تست بعد: `fix-s89-return-rate.mjs` ⇒ **۴ موفق · ۰ ناموفق**.
- رگرسیون: **۳۷ فایل PASS · ۰ فایل FAIL**؛ تست‌های هارنس با resolver رسمی اجرا شدند.
- محدودیت‌ها همان قبلی‌اند: npm/npx/Prisma/Electron واقعی، typecheck، چاپ/Excel واقعی، migration تاریخی و race/crash واقعی اجرا نشدند.

## نشست ۹۰
- ✅ خوشه J / پنجره‌های مخفی چاپ: `printHtml` و `listPrinters` اکنون تمام مسیرهای خطا را با `try/finally` می‌بندند؛ callback چاپ دیگر تنها محل cleanup نیست و خطای `loadURL`، چاپ یا فهرست‌کردن چاپگر پنجره را نشت نمی‌دهد.
- تست قبل: `fix-s90-printer-cleanup.mjs` ⇒ **۱ موفق · ۴ ناموفق**؛ روی کد نشست ۸۹ فقط نبود cleanup در مسیر خطا قابل مشاهده بود.
- تست بعد: همان تست ⇒ **۵ موفق · ۰ ناموفق**؛ تست ساختاری است چون Electron در محیط موجود نیست.
- رگرسیون بعد: **۳۸ فایل PASS · ۰ فایل FAIL**، **۶۷۵ بررسی موفق**.
- گام صفر این نشست: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ `node --version` برابر `v22.23.1` است.
- فایل‌های تغییرکرده: `src/main/print/printer.ts` و `tests/audit-fixes/fix-s90-printer-cleanup.mjs`.
- ⚠️ اجرای واقعی Electron/چاپگر، Prisma تولیدی، typecheck، Excel واقعی، migration تاریخی، race دو پردازه و crash وسط تراکنش همچنان اثبات نشده‌اند.

## نشست ۹۱
- ✅ خوشه F / فیلترهای تب‌های برگشت، تعویض و نسیه: UI اکنون همان `toServiceFilter()` کامل را به هر سه endpoint می‌فرستد؛ شماره فیش، مشتری، کالا، شیفت و کانال دیگر فقط روی سرجمع/جزئیات فروش اعمال نمی‌شوند.
- ✅ `SalesService.reportInvoiceRelationWhere` یک قرارداد مشترک برای فیلتر سند فاکتور مرجع دارد؛ جستجوی کالا روی barcode/code/name و snapshot نام/کد قلم هم اعمال می‌شود.
- تست قبل/بعد `tests/audit-fixes/fix-s91-report-filter-propagation.mjs`: **۱۱ موفق · ۰ ناموفق**؛ تست ساختاری است چون Prisma Client تولیدی و React/Electron واقعی در محیط موجود نیست.
- پذیرش مرتبط `test/acceptance-db-session40.mjs`: **۱۸۵ موفق · ۰ ناموفق**.
- رگرسیون `tests/audit-fixes/*.mjs`: **۳۹ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/main/services/SalesService.ts`، `src/renderer/src/pages/SalesReports.tsx`، `tests/audit-fixes/fix-s91-report-filter-propagation.mjs`.
- ⚠️ خوشه F کامل نیست: فیلترهای دفتر رویداد/گردش نقدی، تب‌های مستقل کارمند/چک/اعتبار مدیریتی، صفحه‌بندی واقعی همه‌ی endpointها، و تأیید Prisma/typecheck/Electron واقعی باقی است.

## نشست ۹۲
- ✅ خوشه F / گردش نقدی: `cashMovementTotals` دیگر بین `shiftId` و بازه‌ی زمانی یکی را انتخاب نمی‌کند؛ قیدهای شیفت، کارمند و `occurredAt` هم‌زمان اعمال می‌شوند.
- ✅ `SalesService.reportRows` اکنون `userId` گزارش را به محاسبه‌ی گردش نقد می‌دهد؛ عدد expectedCash با فیلتر کارمند هم‌خوان می‌ماند.
- ✅ `CashMovementService.list` همان قرارداد سه‌قیدی را برای جزئیات گردش نقدی اعمال می‌کند؛ فیلتر شیفت دیگر بازه‌ی تاریخ را حذف نمی‌کند و نبود تاریخ فقط «امروز» را می‌خواند.
- تست قبل/بعد `tests/audit-fixes/fix-s92-cash-filter-merge.mjs`: **۹ موفق · ۰ ناموفق**؛ تست ساختاری است چون Prisma Client تولیدی و Electron واقعی در محیط موجود نیست.
- رگرسیون `tests/audit-fixes/*.mjs`: **۴۰ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/main/services/accountingReport.ts`، `src/main/services/SalesService.ts`، `src/main/services/CashMovementService.ts`، `tests/audit-fixes/fix-s92-cash-filter-merge.mjs`.
- ⚠️ خوشه F کامل نیست: فیلترهای کامل مصرف اعتبار/تب‌های مستقل مدیریتی، صفحه‌بندی واقعی همه‌ی endpointها، و تأیید Prisma/typecheck/Electron واقعی باقی است.

## نشست ۹۳
- ✅ خوشه J / چاپ A4 تب اعتبار خرید قدیمی: `storeCredits` دیگر به fallback چاپ برگشت نمی‌افتد؛ ردیف‌ها از `rows/items` همان پاسخ خوانده و با ستون‌های کد، فیش مبدأ، صدور، انقضا، وضعیت، مبلغ، مصرف، مانده، مصرف و کانال چاپ می‌شوند.
- ✅ خوشه J / چاپ A4 ضدتقلب: گروه‌ها/بخش‌ها/ردیف‌های پاسخ `fraud` تخت می‌شوند و با گروه، شدت، تاریخ، ساعت، فیش، کاربر، مبلغ و توضیح چاپ می‌شوند؛ fallback برگشت فقط برای تب برگشت باقی ماند.
- تست قبل/بعد `tests/audit-fixes/fix-s93-dedicated-extra-report-print.mjs`: قبل **۳ موفق · ۲ ناموفق**، بعد **۵ موفق · ۰ ناموفق**؛ تست ساختاری است و Electron/چاپگر واقعی را اجرا نمی‌کند.
- رگرسیون `tests/audit-fixes/*.mjs`: **۴۱ فایل PASS · ۰ فایل FAIL**، **۶۷۰ بررسی موفق · ۰ ناموفق**.
- فایل‌های تغییرکرده: `src/renderer/src/pages/SalesReports.tsx`، `tests/audit-fixes/fix-s93-dedicated-extra-report-print.mjs`.
- ⚠️ خوشه J هنوز کامل نیست: پنجره‌های پنهان چاپ/بکاپ، چاپگر واقعی، Excel واقعی، شاخه‌های تب‌های مدیریتی خارج از چهار تب اصلی و typecheck/Prisma واقعی باقی است.

## نشست ۹۴
- ✅ خوشه J / خروجی Excel تب اعتبار خرید قدیمی: `exportCsvNow` دیگر برای `storeCredits` به fallback برگشت نمی‌افتد؛ ردیف‌های `rows/items` همان پاسخ با ستون‌های کد اعتبار، فیش مبدأ، صدور، انقضا، وضعیت، مبلغ، مصرف، مانده، تاریخ مصرف و کانال صادر می‌شوند و ردیف جمع دارند.
- ✅ خوشه J / خروجی Excel ضدتقلب: گروه‌ها/بخش‌ها/ردیف‌های `fraud` با گروه، شدت، تاریخ، ساعت، فیش، کاربر، مبلغ و توضیح به خروجی مستقل می‌روند؛ fallback برگشت فقط پس از شاخه‌های مستقل تب برگشت باقی مانده است.
- تست قبل/بعد `tests/audit-fixes/fix-s94-dedicated-extra-report-export.mjs`: snapshot قبل **۱ موفق · ۶ ناموفق**، بعد **۷ موفق · ۰ ناموفق**؛ تست ساختاری است.
- تست چاپ قبلی `fix-s93-dedicated-extra-report-print.mjs`: **۵ موفق · ۰ ناموفق**.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۴۲ فایل PASS · ۰ فایل FAIL**؛ تست جدید و قبلی با resolver رسمی هارنس اجرا شدند.
- ⚠️ خوشه J هنوز کامل نیست: ساخت/بازکردن Excel واقعی، Electron/چاپگر واقعی، پنجره‌های پنهان چاپ/بکاپ، شاخه‌های تب‌های مدیریتی خارج از چک/اعتبار قدیمی/دفتر رویداد/ضدتقلب و typecheck/Prisma واقعی باقی است.

## نشست ۹۵
- ✅ یک خطای نحوی واقعی در `src/renderer/src/pages/SalesReports.tsx` اصلاح شد: ردیف `totals` خروجی Excel برگشت با `])` بسته شده بود و صفحه با parser واقعی `esbuild` build نمی‌شد؛ بستن آرایه اکنون `]` است.
- ✅ هارنس `tools/tsx-parse-check.mjs` اصلاح شد تا interpolation در template literal، regex literal و backtickهای داخل کامنت‌ها را درست رد کند؛ این ابزار دیگر برای `ExportService.ts` و `xlsx.ts` خطای جعلی نمی‌سازد.
- تست قبل/بعد `tests/audit-fixes/fix-s95-tsx-parser-template-literal.mjs`: نمونه‌ی parser و خود `SalesReports.tsx` بعد از رفع **PASS**؛ snapshot موقت قبل با همان `])` روی esbuild با خطای `Expected "]" but found ")"` شکست خورد.
- parser اختصاصی روی `SalesReports.tsx`، `ExportService.ts` و `xlsx.ts`: **۳ فایل PASS**؛ esbuild native روی `SalesReports.tsx`: **PASS**.
- خروجی Excel واقعی از مسیر `ExportService` با `ask:false` ساخته شد؛ `file` نوع Microsoft Excel 2007+ بود، `unzip -t` بدون خطا گذشت و XML شامل عنوان فارسی، شناسه‌های خط‌تیره‌دار و `autoFilter` بود.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۴۳ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/renderer/src/pages/SalesReports.tsx`، `tools/tsx-parse-check.mjs`، `tests/audit-fixes/fix-s95-tsx-parser-template-literal.mjs` و سه فایل ثبت وضعیت.
- ⚠️ `npm install`، `npx prisma generate`، `npm run typecheck`، Electron واقعی، چاپگر واقعی، migration تاریخی، race چندپردازه‌ای و crash وسط تراکنش همچنان اجرا نشدند؛ بنابراین خوشه J و تکمیل تولیدی ادعا نمی‌شود.

## نشست ۹۶
- گام ۰ دوباره در این محیط کامل نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` اجرا نشدند؛ `node --version` برابر `v22.23.1` است.
- ✅ خوشه F / تب چک: `SalesService.chequeList` اکنون `receiptNo`، `customerSearch`، `productSearch` و `orderType` را می‌پذیرد و با `reportInvoiceRelationWhere` روی فاکتور مادر اعمال می‌کند؛ ترکیب کانال و نوع سفارش از `orderTypeWhere` مشترک می‌آید.
- رفتار قبل: تب چک فقط کانال، شیفت و فروشنده را روی فاکتور اعمال می‌کرد؛ شماره فیش، مشتری، کالا و نوع سفارش از payload نادیده گرفته می‌شد و با سایر تب‌ها واگرا بود.
- رفتار بعد: همان قرارداد فیلتر فاکتوریِ تب‌های برگشت/تعویض/نسیه روی چک هم اعمال می‌شود؛ اگر هیچ فیلتر فاکتوری فعالی نباشد، شرط relation اضافه نمی‌شود.
- تست قبل از رفع: `MAHAK_ROOT=/home/user/work/mahak96-before node --import ./test/harness/register.mjs tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- تست بعد از رفع: `node --import ./test/harness/register.mjs tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs` ⇒ **۷ موفق · ۰ ناموفق**.
- رگرسیون کامل: `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۴۴ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/main/services/SalesService.ts:6149-6184` و `tests/audit-fixes/fix-s96-cheque-filter-propagation.mjs`.
- ⚠️ این رفع ساختاری/هارنس است؛ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای و crash وسط transaction هنوز اثبات نشده‌اند.

## نشست ۹۷
- ✅ خوشه F / تب legacy اعتبار: `StoreCreditService.list` اکنون قرارداد فیلترهای `orderType`، `channels`، `receiptNo`، `customerSearch`، `productSearch`، `userId` و `shiftId` را می‌پذیرد.
- ✅ فیلترهای فاکتوری ابتدا با lookup مستقل روی فاکتور صدور resolve می‌شوند؛ سپس `sourceInvoiceId`، `exchangeInvoiceId` و اعتبارهای متصل از طریق `returnId` در `where` محدود می‌شوند. فیلتر کانال و نوع سفارش با `orderTypesForChannels` مشترک ترکیب می‌شود و فیلتر کالا هم نام/کد snapshot و رابطه‌ی واریانت را می‌بیند.
- رفتار قبل: تب legacy اعتبار payload کامل نوار گزارش را می‌گرفت، اما `ListFilter` و `whereFromFilter` آن را نادیده می‌گرفتند و نتیجه با تب‌های دیگر واگرا می‌شد.
- رفتار بعد: فیلتر روی فاکتورِ صدور اعتبار اعمال می‌شود، نه فاکتور مصرف؛ وقتی فیلتر فاکتوری فعال نیست lookup اضافه اجرا نمی‌شود.
- تست قبل از رفع: `MAHAK_ROOT=/tmp/mahak/before97 node tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` ⇒ **۰ موفق · ۸ ناموفق**.
- تست بعد از رفع: `node tests/audit-fixes/fix-s97-credit-filter-propagation.mjs` ⇒ **۸ موفق · ۰ ناموفق**.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۴۵ فایل PASS · ۰ فایل FAIL**.
- کنترل نحوی مستقل: esbuild روی `src/main/services/StoreCreditService.ts` ⇒ **PASS**؛ `node --check` روی تست ⇒ **PASS**.
- فایل‌های تغییرکرده: `src/main/services/StoreCreditService.ts`، `tests/audit-fixes/fix-s97-credit-filter-propagation.mjs`.
- ⚠️ `npm install`، `npx prisma generate`، `npm run typecheck`، Prisma Client تولیدی، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای و crash وسط transaction همچنان اجرا نشدند.

## نشست ۹۸
- گام ۰: `npm install` ⇒ اجرا نشد، دلیل: `npm: command not found`. `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: command not found`. `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: command not found`. `node --version` ⇒ `v22.23.1`. رگرسیون پایه قبل از هر تغییر: **۴۵ فایل PASS · ۰ فایل FAIL**.
- ✅ خوشه G / فیلتر اعتبار روی داده‌ی حجیم: helper نشست ۹۷ (`creditInvoiceIdsFromReportFilter`) فاکتورهای منطبق را با `take: 50000` می‌خواند (برش بی‌صدا) و همان آرایه را دو بار در `IN` می‌گذاشت (بیش از ۳۲٬۷۶۶ پارامتر ⇒ `too many SQL variables` و crash کل تب اعتبار). جایگزین شد با `reportInvoiceWhereFromFilter` (همان قیود نشست ۹۷، بدون تغییر معنا) و `creditIdsFromReportFilter` که از اعتبارهای کاندیدِ متصل به فاکتور/برگشت شروع می‌کند، برگشت‌ها و فاکتورهای مرجع را در دسته‌های ۵۰۰تایی می‌سنجد و فقط شناسه‌ی اعتبارهای منطبق را به `where` نهایی می‌دهد.
- هیچ `take` بی‌صدا در این مسیر نمانده. اگر اعتبارهای منطبق از `CREDIT_FILTER_MAX_IDS = 30000` بیشتر شوند، `BusinessError` فارسی با تعداد و راهنمای «فیلتر را محدودتر کنید» برمی‌گردد (نه برش بی‌صدا، نه crash خام).
- معنای فیلتر عوض نشد: مبنا همچنان فاکتور صدور اعتبار است (sourceInvoiceId / exchangeInvoiceId / فاکتورِ برگشتِ returnId)، برگشت باطل‌شده اتصال نمی‌دهد و بدون فیلتر فاکتوری lookup اضافه اجرا نمی‌شود.
- تست قبل از رفع (روی کپی zip نشست ۹۷): **۳ موفق · ۹ ناموفق** (crash با `too many SQL variables`، بیشینه‌ی پارامتر ۵۰٬۰۰۰).
- تست بعد از رفع: `tests/audit-fixes/fix-s98-credit-filter-scale.mjs` ⇒ **۱۲ موفق · ۰ ناموفق** (تست رفتاری روی SQLite هارنس با ۵۰٬۰۱۰ فاکتور و ۳۰٬۰۰۷ اعتبار).
- `tests/audit-fixes/fix-s97-credit-filter-propagation.mjs`: دو بررسی ساختاری آخرش به نام‌های جدید helper همسو شد (دلیل در DECISIONS S98-2)؛ ⇒ **۸ موفق · ۰ ناموفق**.
- رگرسیون کامل: **۴۶ فایل PASS · ۰ فایل FAIL**. پذیرش تاریخی `test/acceptance-db-session36.mjs` بدون تغییر: **۱۳۱ PASS · ۷ FAIL** (همان ۷ مورد سبد «نامشخص»، قبل و بعد یکسان).
- esbuild روی `src/main/services/StoreCreditService.ts` ⇒ **PASS**.
- فایل‌های تغییرکرده: `src/main/services/StoreCreditService.ts`، `tests/audit-fixes/fix-s98-credit-filter-scale.mjs` (جدید)، `tests/audit-fixes/fix-s97-credit-filter-propagation.mjs`.
- ⚠️ خوشه G کامل نیست: سایر takeهای بی‌هشدار (reportItems، exchangeList، returnList، chequeList، StaffReportService، FraudService، purgePreview، shiftPaymentsOf، PendingRestockService، jalaliDaysBetween) و خودِ `take`/`skip` لیست اعتبار (بدون totalCount/truncated) باقی‌اند.

## نشست ۹۹
- گام ۰ همچنان در این محیط قابل اجرای واقعی نیست: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبودن npm/npx اجرا نشدند؛ `node --version` برابر `v22.23.1` است.
- ✅ خوشه G / صفحه‌بندی چهار endpoint گزارش: `reportItems`، `returnList`، `exchangeList` و `chequeList` اکنون `count()` واقعیِ همان `where` را می‌گیرند و `skip`/`take` را اعمال می‌کنند؛ `totalCount` و `truncated` داخل metadata صفحه برمی‌گردد و در حالت برش هشدار فارسی تولید می‌شود.
- برای سازگاری با callerهای قدیمی، خروجی آرایه‌ای برگشت/چک/جزئیات فروش همچنان آرایه است و metadata به‌صورت `page` و `warnings` روی همان آرایه attach می‌شود؛ خروجی تعویض که از قبل wrapper داشت، `page` و `warnings` اختیاری گرفت.
- lookupهای `IN` در همین چهار مسیر با helper مشترک در تکه‌های حداکثر ۵۰۰ شناسه اجرا می‌شوند؛ فیلتر، ترتیب و معنای گزارش تغییر نکرده است.
- تست قبل از رفع: `MAHAK_ROOT=<کپی zip نشست ۹۸> node tests/audit-fixes/fix-s99-report-pagination.mjs` ⇒ **۰ موفق · ۱۷ ناموفق**.
- تست بعد از رفع: همان تست روی خروجی نشست ۹۹ ⇒ **۱۷ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**؛ parser هارنس روی `SalesService.ts` و `src/shared/types.ts` ⇒ **PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۴۷ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/main/services/SalesService.ts`، `src/shared/types.ts` و `tests/audit-fixes/fix-s99-report-pagination.mjs`.
- ⚠️ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash وسط transaction و تست ۵۰٬۰۰۰+ ردیف با Prisma واقعی هنوز اجرا نشده‌اند؛ این رفع با هارنس/بررسی ساختاری اثبات شده، نه محیط تولید.

### نشست ۱۰۵ · خوشه G
- ✅ `reportLimitsService` اکنون helper رسمی `reportInvoiceRelationWhere` را برای فیلترهای شماره فیش، مشتری، کالا، فروشنده و شیفت روی برگشت/تعویض/چک مصرف می‌کند.
- ✅ `orderType` و `channels` در شمارش فاکتور مادر با هم AND می‌شوند؛ انتخاب متناقض عمداً نتیجه‌ی خالی می‌دهد.
- ✅ شمارش تب legacy اعتبار از `storeCreditService.list(... take: 1)` و `page.totalCount` می‌آید؛ دیگر count خامِ بدون فیلتر نیست.
- ✅ شمارش نسیه با همان `where` فاکتور و حذف وضعیت `CANCELED` انجام می‌شود.
- تست ساختاری `fix-s105-report-limits-filter-propagation.mjs` ⇒ نتیجه بعد از رفع در TESTLOG ثبت شد.

### نشست ۱۰۸ · خوشه G، drill-down پل تطبیق
- ✅ سقف بی‌هشدار ۲۰۰ سند در `src/main/services/accountingReport.ts` حذف شد؛ شاخه‌های اعتبار، پرداخت، برگشت، نسیه و وجه نقد اکنون `count()` واقعی، `skip/take` و `SaleReportPage` دارند.
- ✅ برای برگشت‌ها و نسیه، صفحه بعد روی مجموعه‌ی کامل matching اعمال می‌شود؛ جمع‌های پل همچنان از aggregate محاسبه می‌شوند و از صفحه‌ی drill-down تغذیه نمی‌شوند.
- ✅ `SaleReportFilter` پارامترهای `bridgeSourceKey`، `bridgeSourceSkip` و `bridgeSourceTake` را دارد و `SalesService` آن‌ها را به `buildStatements` می‌رساند.
- ✅ `AccountingBlocks` metadata صفحه را نمایش می‌دهد و دکمه‌های صفحه قبل/بعد دارد؛ کلیک اول نیز drill-down را با همان فیلتر گزارش از سرور می‌گیرد.
- تست قبل از رفع: `MAHAK_ROOT=<کپی zip نشست ۱۰۷> node tests/audit-fixes/fix-s108-bridge-drilldown-pagination.mjs` ⇒ **۰ موفق · ۱۰ ناموفق**.
- تست بعد از رفع: همان تست روی خروجی نشست ۱۰۸ ⇒ **۱۰ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**.
- رگرسیون کامل `for f in tests/audit-fixes/*.mjs; do node --import ./test/harness/register.mjs "$f"; done` ⇒ **۵۸ فایل PASS · ۰ فایل FAIL**.
- گام ۰ همچنان اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبود npm/npx در محیط قابل اجرا نبودند.
- ⚠️ Prisma تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race دو پردازه و crash وسط transaction هنوز اثبات نشده‌اند.

### نشست ۱۰۹ · خوشه G، پیش‌نمایش پاک‌سازی گزارش
- ✅ `SalesService.purgePreview` اکنون `page` و `warnings` واقعیِ `reportRows` را به caller برمی‌گرداند؛ سقف نمایشی `take: 20000` دیگر بی‌اعلام نیست.
- ✅ `SalesPurgePreview` در `src/shared/types.ts` قرارداد اختیاری `page`/`warnings` دارد تا callerهای قدیمی نشکنند.
- ✅ پنل تنظیمات هشدار برش پیش‌نمایش را قبل از تأیید ابطال به فارسی نمایش می‌دهد؛ جمع کل همچنان از صورت حسابداری کل بازه می‌آید، نه از صفحه‌ی قابل مشاهده.
- تست قبل: `MAHAK_ROOT=<کپی خروجی نشست ۱۰۸> node tests/audit-fixes/fix-s109-purge-preview-pagination.mjs` ⇒ **۰ موفق · ۵ ناموفق**.
- تست بعد: همان تست روی خروجی نشست ۱۰۹ ⇒ **۵ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۵۹ فایل PASS · ۰ فایل FAIL**.
- parser هارنس روی `SalesService.ts`، `Settings.tsx` و `shared/types.ts` ⇒ **۳ فایل PASS**؛ esbuild/typecheck کامل اجرا نشد چون npm و esbuild در محیط نیستند.
- فایل‌های تغییرکرده: `src/main/services/SalesService.ts`، `src/shared/types.ts`، `src/renderer/src/pages/Settings.tsx`، `tests/audit-fixes/fix-s109-purge-preview-pagination.mjs`.
- ⚠️ خوشه G هنوز کامل نیست: سقف‌های باقی‌مانده‌ی مسیرهای export/print و فهرست‌های مدیریتی، و اثبات Prisma/Electron واقعی باز هستند. خوشه C همچنان نباید تکه‌تکه شود.

## نشست ۱۱۰ · خوشه J، اتصال واقعی خروجی ضدتقلب
- گام ۰ دوباره کامل نشد: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبود npm/npx اجرا نشدند؛ `node --version` برابر `v22.23.1` است.
- ✅ سرویس ضدتقلب پاسخ را در فیلد `flags` برمی‌گرداند، اما صفحه، چاپ A4 و Excel فقط `groups`/`sections`/`rows` را می‌خواندند؛ در نتیجه تب ضدتقلب با وجود هشدارهای واقعی خالی دیده و چاپ/export آن صفر می‌شد.
- ✅ `SalesReports.tsx` اکنون `flags` را به‌عنوان منبع اصلی گروه‌ها می‌خواند و ردیف‌های `sources` هر پرچم را برای چاپ و Excel تبدیل می‌کند.
- ✅ `ReportExtraTables.tsx` نیز `flags` و `sources` را می‌خواند و برای ستون `label` برچسب فارسی دارد.
- تست قبل از رفع روی zip خام نشست ۱۰۹: `fix-s110-fraud-flags-adapter.mjs` ⇒ **۰ موفق · ۶ ناموفق**.
- تست بعد از رفع: همان تست ⇒ **۶ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**؛ parser هارنس روی دو فایل TSX ⇒ **۲ فایل PASS**.
- رگرسیون کامل با resolver هارنس: **۶۰ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/renderer/src/pages/SalesReports.tsx`، `src/renderer/src/components/ReportExtraTables.tsx`، `tests/audit-fixes/fix-s110-fraud-flags-adapter.mjs` و بسته‌ی گزارش/هندآف.
- ⚠️ این رفع اتصال قرارداد renderer است؛ اجرای FraudService با Prisma تولیدی، رندر Electron، چاپگر واقعی و Excel دسکتاپ همچنان اثبات نشده‌اند.

## نشست ۱۱۱ · خوشه J، اعلام صریح برش منابع ضدتقلب
- گام ۰ اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` شکست خوردند؛ `node --version` برابر `v22.23.1` است.
- ✅ `FraudService.review` حالا تمام داده‌ی منطبق را برای محاسبه می‌خواند، اما برش نمایشی ۲۰۰ منبع را داخل قرارداد `sourcesTotal` و `sourcesTruncated` اعلام می‌کند؛ هیچ سقف محاسباتی بی‌هشدار اضافه نشد.
- ✅ تب ضدتقلب، چاپ A4 و Excel در عنوان گروه نشان می‌دهند چند سند از چند سند واقعی نمایش داده شده است.
- تست قبل: `MAHAK_ROOT=<کپی zip نشست ۱۱۰> node tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs` ⇒ **۰ موفق · ۷ ناموفق**.
- تست بعد: همان تست روی خروجی نشست ۱۱۱ ⇒ **۷ موفق · ۰ ناموفق**؛ `node --check` تست ⇒ **PASS**؛ parser هارنس روی سه فایل سرویس/renderer ⇒ **۳ فایل PASS**.
- رگرسیون کامل با resolver هارنس ⇒ **۶۱ فایل PASS · ۰ فایل FAIL**.
- فایل‌های تغییرکرده: `src/main/services/FraudService.ts`، `src/renderer/src/components/ReportExtraTables.tsx`، `src/renderer/src/pages/SalesReports.tsx` و `tests/audit-fixes/fix-s111-fraud-source-pagination-contract.mjs`.
- ⚠️ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اثبات نشده‌اند.

## نشست ۱۱۲ · cashEffect فقط کشوی فیزیکی
- 
## نشست ۱۱۳ · خوشه A، سیاست مقصد چک
- گام ۰ اجرا شد اما محیط تولیدی در دسترس نبود: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` شکست خوردند؛ `node --version` برابر `v22.23.1` است.
- ✅ هنگام پاس‌شدن چک فقط `MANAGER`/حساب مدیر-بانک مجاز است؛ `CASH` و `CARD` با پیام فارسی رد می‌شوند. ثبت اولیه‌ی روش `CHEQUE` نیز رد می‌شود تا چک فقط با شماره/سررسید از `addPayment` ثبت شود.
- ✅ `receiptBucketOf` برای چک فقط `MANAGER` را در سبد حساب مدیر می‌گذارد و `CASH`/`CARD`/`null` را «نامشخص» می‌کند؛ `SalesLedger` نیز از همین سبد مشترک استفاده می‌کند و اثر نقدی چک صفر است.
- تست قبل روی zip خام نشست ۱۱۲: `fix-s113-cheque-destination-policy.mjs` ⇒ **۳ موفق · ۷ ناموفق**؛ تست بعد ⇒ **۱۰ موفق · ۰ ناموفق**.
- تست‌های متاثر `fix-s68`، `fix-s69` و `fix-s74` به‌ترتیب **۱۲/۰**، **۹/۰** و **۵/۰**؛ parser چهار فایل تغییرکرده ⇒ **۴ PASS**؛ رگرسیون کامل ⇒ **۶۳ فایل PASS · ۰ فایل FAIL**.
- ⚠️ این رفع با هارنس SQLite و parser اثبات شد؛ Prisma Client تولیدی، typecheck کامل، race، Electron/چاپگر واقعی و migration تاریخی همچنان اجرا نشده‌اند. این بند، توضیح قدیمی نشست ۱۱۲ درباره‌ی مجازبودن CASH برای چک را supersede می‌کند.
- گام ۰ اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه به‌دلیل نبود `npm`/`npx` اجرا نشدند؛ `node --version` برابر `v22.23.1` است.
- ✅ در `src/main/services/SalesLedger.ts` اثر نقدی چکِ پاس‌شده اکنون فقط برای مقصد صریح `CASH` ثبت می‌شود؛ مقصدهای `CARD`، `MANAGER` و نامشخص (`null`) صفر هستند و در توضیح ردیف علت فارسی دارند.
- ✅ بازپرداخت کارت دیگر از `cashEffect` کشو کم نمی‌شود؛ بازپرداخت نقدی همچنان خروجی منفی است. مابه‌التفاوت تعویض نیز فقط `CASH`/`CASH_REFUND` را نقدی حساب می‌کند و کارت/کارت‌به‌کارت/اعتبار را صفر نگه می‌دارد.
- ✅ `destination` و `dueDate` چک در select دفتر رویداد خوانده می‌شوند؛ دسترسی به `dueDate` دیگر به فیلد انتخاب‌نشده وابسته نیست.
- تست اثباتی `tests/audit-fixes/fix-s112-cash-effect-drawer-only.mjs`: **۱۰ موفق · ۰ ناموفق**؛ `node --check` ⇒ **PASS**.
- تست رگرسیون `fix-s74-cluster-a.mjs` پس از صریح‌کردن مقصد نقدی: **۵ موفق · ۰ ناموفق**؛ parser `SalesLedger.ts` ⇒ **PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs`: **۶۲ فایل PASS · ۰ فایل FAIL**.
- ⚠️ این رفع با هارنس SQLite داخلی و parser اثبات شد؛ Prisma Client تولیدی، typecheck کامل، Electron/چاپگر واقعی، Excel دسکتاپ، migration تاریخی، race دوپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی هنوز اثبات نشده‌اند.

## نشست ۱۱۴ · خوشه G/A/E، سقف‌های بی‌صدا در صندوق و کارت‌به‌کارت
- گام ۰ اجرا شد اما محیط تولیدی در دسترس نبود: `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با `command not found` شکست خوردند؛ `node --version` برابر `v22.23.1` است. رگرسیون پایه روی zip نشست ۱۱۳ قبل از هر تغییر: **۶۳ فایل PASS · ۰ FAIL**.
- ✅ `CashboxService.sessions` (سابقه‌ی بستن صندوق) و `CashboxService.list` (سابقه‌ی تجمیع) دیگر با `take: 200` بی‌صدا بریده نمی‌شوند: تا ۵٬۰۰۰ ردیف یک‌جا، `skip/take`، `page.totalCount` واقعی و هشدار فارسی با قرارداد PagedRows (آرایه + page + warnings). صفحه‌ی بستن صندوق نوار هشدار و دکمه‌های «صفحه‌ی قبل/بعد» دارد؛ صفحه‌ی تجمیع نوار هشدار دارد.
- ✅ `CashMovementService.list`: جمع موجودی اول/واریز/برداشت/بازپرداخت قبلاً از ردیف‌های بریده (سقف ۵۰۰) حساب می‌شد؛ حالا با `groupBy` روی کل بازه. فهرست ردیف‌ها page/warnings دارد. `cashboxExpected` فهرست را تا ۵٬۰۰۰ می‌خواند، `movementsPage` برمی‌گرداند و هشدار برش را به `warnings` اضافه می‌کند؛ پنل بستن صندوق نوار هشدار دارد. (یادداشت صادقانه: فرمول «نقد انتظاری» خودش از `cashMovementTotals` کامل استفاده می‌کرد و غلط نبود؛ باگ در جمع‌های endpoint عمومی `cashbox:movement:list` و فهرست نمایشی بود.)
- ✅ `CardTransferService.list` و `outOfSales`: جمع در انتظار/پرداخت‌شده/اصلاحی/خالص کارت‌به‌کارت مدیر از ردیف‌های بریده (۵۰۰ و ۵۰۰۰) حساب می‌شد و بازپرداخت‌های قدیمی‌تر بی‌صدا حذف می‌شدند؛ حالا جمع با خواندن صفحه‌ای کامل روی کل بازه، و فهرست با page/warnings. پنل کارت‌به‌کارت نوار هشدار دارد.
- تست‌های تازه: `fix-s114-cashbox-history-pagination.mjs` (قبل ۱/۱۷ · بعد ۱۷/۱۷)، `fix-s114-cash-movement-totals-full-range.mjs` (قبل ۲/۱۳ · بعد ۱۳/۱۳)، `fix-s114-card-transfer-totals-full-range.mjs` (قبل ۰/۱۲ · بعد ۱۲/۱۲). رگرسیون کامل ⇒ **۶۶ فایل PASS · ۰ FAIL**.
- ⚠️ با هارنس SQLite و parser اثبات شد؛ Prisma Client تولیدی، typecheck کامل، Electron/رندر واقعی و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۱۵
- گام ۰: npm/prisma/typecheck اجرا نشد، دلیل: npm در محیط نیست (node v22.23.1). رگرسیون پایه ۶۶ PASS.
- خوشه G: `PurchaseService.list` (+UI `PurchaseInvoice.tsx`: جمع از totals کل بازه، هشدار و صفحه‌ی قبل/بعد). `PartyService.directory` (+UI `Settings.tsx`، `types.ts`: returnedTotal/skip).
- خوشه E: `CardTransferService.list/outOfSales` تاریخ رویداد؛ `accounting.ts` `calculateCardTransferTotals` برای ADJUSTED.
- ناتمام: `ProductService.movements` (سقف ۳۰۰) — تست `tests/pending/fix-s115-stock-movements-full-ledger.mjs` نوشته شد (قبل ۱/۱۴)، رفع انجام نشد؛ عمداً بیرون از audit-fixes تا رگرسیون دروغ سبز/قرمز نشود.

## نشست ۱۱۶ · تکمیل خوشه G، دفتر گردش انبار
- گام ۰ همچنان اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبود `npm`/`npx` در محیط قابل اجرا نیستند؛ `node --version` برابر `v22.23.1` است.
- ✅ `ProductService.movements` دیگر با `take: 300` بی‌صدا نمی‌بُرد: امضای عدد قدیمی و ورودی `{ variantId, take?, skip? }` هر دو پشتیبانی می‌شوند؛ فهرست با سقف ۵٬۰۰۰، `page` و هشدار فارسی برمی‌گردد.
- ✅ `totals` شامل `inTotal`، `outTotal`، `net`، `pendingCount` و `count` از کل دفتر همان کالا محاسبه می‌شود؛ `newerDeltaSum` جمع حرکت‌های جدیدتر از صفحه است تا موجودی پس از حرکت در صفحه‌های بعد درست بماند.
- ✅ IPC اکنون کل payload را به سرویس می‌دهد و `MovementsModal.tsx` جمع‌های کل دفتر، هشدار و صفحه‌های قبل/بعد را نمایش می‌دهد؛ محاسبه‌ی موجودی جدول از `stock - newerDeltaSum` شروع می‌شود.
- تست قبل روی کد نشست ۱۱۵ با resolver هارنس: `fix-s115-stock-movements-full-ledger.mjs` ⇒ **۱ موفق · ۱۴ ناموفق**.
- تست بعد: همان تست پس از رفع ⇒ **۱۵ موفق · ۰ ناموفق**؛ `node --check` ⇒ **PASS**؛ parser سه فایل تغییرکرده ⇒ **۳ فایل PASS**.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۷۰ فایل PASS · ۰ فایل FAIL**.
- فایل تست از `tests/pending/` به `tests/audit-fixes/` منتقل شد.
- ⚠️ Prisma Client تولیدی، typecheck کامل، Electron/رندر واقعی، چاپگر، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اثبات نشده‌اند.

## نشست ۱۱۷
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

## نشست ۱۱۸ · ادامه‌ی خوشه G، حذف برش‌های بی‌صدا
- گام ۰ دوباره اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` در محیط موجود نیستند؛ `node --version` برابر `v22.23.1` است. رگرسیون پایه روی zip نشست ۱۱۷: **۷۵ فایل PASS · ۰ FAIL**.
- ✅ S118-1 · `SalesService.purgePreview`: در حالت انتخاب فاکتورهای مشخص، شناسه‌ها حالا داخل `saleWhere` قبل از صفحه‌بندی اعمال می‌شوند؛ فاکتور انتخاب‌شده‌ای که بعد از صفحه‌ی اول است دیگر از پیش‌نمایش و جمع حذف نمی‌شود. قرارداد `SaleReportFilter.invoiceIds` اضافه شد.
- ✅ S118-2 · `PriceAdjustService`: preview، apply، ویرایش دامنه و اجرای زمان‌بندی‌شده دیگر با `take: 20000` بریده نمی‌شوند؛ helper `loadAllProductVariants` دامنه را صفحه‌ای ۵٬۰۰۰تایی کامل می‌خواند. `activeDiscounts` نیز `PriceChangeItem`ها را صفحه‌ای می‌خواند و سقف ۴۰٬۰۰۰ ندارد.
- ✅ S118-3 · `SecondaryStockService.history`: سقف بی‌صدای ۵۰۰ به صفحه‌بندی واقعی با `count`، `skip/take`، سقف ۵٬۰۰۰، `page` و هشدار فارسی تبدیل شد؛ شکل آرایه حفظ شد و UI تاریخچه دکمه‌های قبل/بعد و نوار هشدار دارد.
- تست قبل روی baseline نشست ۱۱۷: `fix-s118-purge-selected-invoices.mjs` **۱/۲**، `fix-s118-price-adjust-full-scope.mjs` **۰/۵**، `fix-s118-secondary-stock-history-pagination.mjs` **۰/۶**.
- تست بعد: به‌ترتیب **۳/۰**، **۵/۰** و **۶/۰**؛ `node --check` هر سه تست PASS؛ parser `SecondaryStock.tsx` PASS؛ رگرسیون کامل **۷۸ فایل PASS · ۰ FAIL**.
- ⚠️ Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اثبات نشده‌اند.

وضعیت خوشه‌ها:

## نشست ۱۱۹ · خوشه G، اعتبار خرید
- ✅ S119-1 · `StoreCreditService.detail`: سقف بی‌صدای Timeline (`take: 500`) و لاگ یادآوری (`take: 100`) به `count` واقعی، `skip/take`، `page` و هشدار فارسی تبدیل شد؛ آرایه‌های قدیمی حفظ شدند و metadata از IPC عبور می‌کند.
- ✅ S119-2 · `StoreCreditService.batches`: سقف ثابت ۲۰۰ به صفحه‌بندی واقعی با `count`، `skip/take`، `page` و هشدار فارسی تبدیل شد؛ UI دسته‌ها دکمه‌های قبل/بعد و هشدار برش را نشان می‌دهد و درخواست `skip` را به IPC می‌فرستد.
- تست `fix-s119-credit-detail-batch-pagination.mjs`: قبل از رفع **۴ موفق · ۱۳ ناموفق**؛ بعد از رفع **۱۸ موفق · ۰ ناموفق**.
- `node --check` تست جدید PASS؛ parser `CreditManagement.tsx`، `CreditDetailView.tsx` و `shared/creditUi.ts` PASS؛ رگرسیون کامل **۷۹ فایل PASS · ۰ فایل FAIL**.
- ⚠️ `npm install`، `npx prisma generate`، `npm run typecheck`، Prisma Client تولیدی، Electron/رندر واقعی، چاپگر، Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اجرا نشدند؛ علت: `npm`/`npx`/Electron در محیط موجود نیستند.

وضعیت خوشه‌ها:
- G، بسته‌شده تا نشست ۱۱۹: همه‌ی موارد ثبت‌شده‌ی نشست ۱۱۸ + Timeline و لاگ یادآوری اعتبار با metadata صفحه + فهرست دسته‌های تولید گروهی با صفحه‌بندی واقعی و UI.
- G، باقی‌مانده‌های ثبت‌شده: `StockCountService` فهرست‌های variants/list، `PartyService.customers/suppliers` در مسیر جست‌وجو، بررسی نهایی export/print و هر سقف مدیریتی تازه‌ای که روی جمع مالی یا مدرک اثر داشته باشد.
- یادداشت‌های باز: بازآزمایی Prisma واقعی، بررسی شمول CANCELED در aggregate فهرست فاکتور عمده‌ی S117-4، بررسی `productVariant IN` بزرگ در discrepancy و تست واقعی چاپ/Excel/Save dialog.
- A، B، C، D، E، F، H، I، J، K، L، M: وضعیت ثبت‌شده‌ی قبل پابرجاست؛ خوشه C فقط با تست یکپارچه ادامه یابد.

### ادامه‌ی نشست ۱۱۹ · انبارگردانی
- ✅ S119-3 · `StockCountService.variants/list`: سقف‌های فهرست کالاهای شمارش و سابقه‌ی جلسه به `count`، `skip/take`، سقف ۵٬۰۰۰، `page` و هشدار فارسی تبدیل شد؛ `Stocktake.tsx` صفحه‌های قبل/بعد و هشدار را نمایش می‌دهد.
- تست `fix-s119-stockcount-pagination.mjs`: قبل **۲ موفق · ۱۰ ناموفق**؛ بعد **۱۲ موفق · ۰ ناموفق**.
- رگرسیون نهایی `tests/audit-fixes/*.mjs` ⇒ **۸۰ فایل PASS · ۰ فایل FAIL**؛ parser چهار فایل UI/shared ⇒ PASS.

## نشست ۱۲۰ · خوشه G، اجرای کامل زمان‌بندی تغییر قیمت
- ✅ S120-1 · `PriceAdjustService.runDueSchedules`: سقف بی‌صدای `take: 200` برای شروع و پایان زمان‌بندی حذف شد؛ هر فاز با صفحه‌های keyset بر اساس زمان و شناسه تا انتها خوانده می‌شود، بدون این‌که تغییر وضعیت ردیف‌ها باعث ردشدن مورد بعدی شود.
- ✅ خطای هر ردیف همچنان با مهر سابقه کنار گذاشته می‌شود و مکان‌نمای صفحه قبل از پردازش جلو می‌رود؛ بنابراین خطای علامت‌گذاری، حلقه‌ی بی‌نهایت یا برش بی‌صدا نمی‌سازد.
- تست بازتولید روی نسخه‌ی قبل: `fix-s120-price-schedule-full-range.mjs` ⇒ **۱ موفق · ۴ ناموفق**؛ مورد ۲۰۱امِ شروع و پایان جا می‌ماند.
- تست بعد: همان تست با ۲۰۱ شروع و ۲۰۱ پایان رسیده ⇒ **۵ موفق · ۰ ناموفق**؛ `node --check` ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۱ فایل PASS · ۰ فایل FAIL**.
- ✅ S120-2 · `StockCountService.submit/discrepancy`: شناسه‌های واریانت دیگر در یک `IN` بزرگ فرستاده نمی‌شوند؛ helper مشترک آن‌ها را در دسته‌های ۵۰۰تایی می‌خواند تا سقف پارامتر SQLite گزارش یا ثبت شمارش را از کار نیندازد.
- تست بازتولید روی نسخه‌ی قبل: `fix-s120-stockcount-in-chunking.mjs` ⇒ **۰ موفق · ۳ ناموفق**؛ هارنس عمداً `IN` بزرگ‌تر از ۵۰۰ را رد کرد.
- تست بعد: همان تست با گزارش ۵۰۱ کالا ⇒ **۳ موفق · ۰ ناموفق**؛ رگرسیون نهایی پس از این رفع باید با ۸۲ تست ثبت شود.

## نشست ۱۲۱ · شروع بررسی خروجی گزارش
- گام ۰ دوباره بررسی شد: `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند؛ دلیل: `npm: command not found` و `npx: command not found`. `node --version` برابر `v22.23.1` است.
- نقطه‌ی شروع هندآف رعایت شد: مسیرهای چاپ A4 و خروجی Excel گزارشات فروش بررسی شدند. گزارش‌ها صفحه‌بندی دارند، اما `SalesReports.tsx` در چاپ/خروجی فقط ردیف‌های صفحه‌ی جاری را می‌فرستاد و `metaText` هیچ هشدار برش صفحه‌ای نداشت؛ در نتیجه کاربر می‌توانست فایل ناقص را بدون علامت تحویل بگیرد.
- ✅ S121-1 · `SalesReports.tsx`: متادیتای `page.truncated`، تعداد ردیف نمایش‌داده‌شده/کل، هشدار بخش‌های دفتر رویداد و برش منابع ضدتقلب حالا داخل meta چاپ A4، چاپ حرارتی و عنوان Excel می‌رود. خروجی همچنان عمداً صفحه‌ی جاری است، اما دیگر شبیه خروجی کامل تحویل نمی‌شود.
- تست قبل روی نسخه‌ی بازسازی‌شده‌ی قبل از رفع: `fix-s121-report-export-page-warning.mjs` ⇒ **۰ موفق · ۸ ناموفق**.
- تست بعد: همان تست ⇒ **۸ موفق · ۰ ناموفق**؛ `node --check` تست و `tools/tsx-parse-check.mjs` روی `SalesReports.tsx` ⇒ PASS؛ رگرسیون کامل ⇒ **۸۳ فایل PASS · ۰ فایل FAIL**.

## نشست ۱۲۲ · خوشه G، وضعیت فاکتور در گزارش
- گام ۰ همچنان اجرا نشد: `npm install`، `npx prisma generate` و `npm run typecheck` به‌دلیل نبود `npm`/`npx` در محیط موجود نیستند؛ `node --version` برابر `v22.23.1` است.
- ✅ S122-1: `saleWhere` در حالت گزارش عادی اکنون `DRAFT` و `CANCELED` را با `status.notIn` کنار می‌گذارد، نه فقط با `voidedAt: null`. این سوراخ داده‌ی قدیمی می‌توانست فاکتور لغوشده/پیش‌نویس را در فهرست عمده و جمع فروش وارد کند.
- ✅ `reportInvoiceRelationWhere` نیز `voidedAt: null` و همان فیلتر وضعیت را به برگشت/تعویض/چک/نسیه‌ی متصل منتقل می‌کند؛ `creditList` و شمارش `reportLimits` از helper مشترک استفاده می‌کنند.
- تست قبل روی baseline نشست ۱۲۱: `fix-s122-report-excludes-invalid-invoices.mjs` ⇒ **۰ موفق · ۱۰ ناموفق**؛ بعد از رفع ⇒ **۱۰ موفق · ۰ ناموفق**.
- `node --check` تست ⇒ PASS؛ رگرسیون نهایی پس از هم‌راستاسازی تست قراردادی S105 ⇒ **۸۴ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها پابرجاست: Prisma Client تولیدی، typecheck کامل، Electron/رندر واقعی، چاپگر/Excel دسکتاپ، migration تاریخی، race چندپردازه‌ای، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

## نشست ۱۲۳ · خوشه G، chunk کردن تخصیص موجودی و چاپ
- گام ۰: `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند؛ دلیل: `npm: command not found` و `npx: command not found`. `node --version` برابر `v22.23.1` است.
- baseline قبل از رفع: رگرسیون نشست ۱۲۲ **۸۴ فایل PASS · ۰ فایل FAIL**؛ تست تازه‌ی `fix-s123-stock-allocation-print-chunking.mjs` روی کد قبل از رفع **۱ موفق · ۱۱ ناموفق** بود.
- ✅ S123-1 · `StockAllocationService`: lookup واریانت‌ها در `preview`، `applyPlan`، `summaryOf` و `summaryForInvoices` اکنون با helper مشترک و chunkهای حداکثر ۵۰۰تایی انجام می‌شود؛ هیچ واریانتی حذف یا حدس زده نمی‌شود. lookup فاکتورهای export و `dropAllocations` نیز chunk شد و ترتیب ردیف‌های خلاصه حفظ می‌شود.
- ✅ S123-2 · `PrintService`: lookup واریانت‌های رسید فروش و برگشت از helper مشترک ۵۰۰تایی عبور می‌کند؛ فاکتور/برگشت پرقلم دیگر با یک `IN` بزرگ مسیر چاپ را نمی‌خواباند.
- تست بعد: `fix-s123-stock-allocation-print-chunking.mjs` ⇒ **۱۲ موفق · ۰ ناموفق**؛ سقف مصنوعی ۵۰۰ روی lookup واریانت/فاکتور enforce شد و تمام ۵۰۱ مورد کامل ماندند.
- `node --check` روی دو سرویس و تست ⇒ **۳ فایل PASS**؛ parser روی `PrintService.ts` ⇒ PASS؛ تست‌های متاثر S86، S87، S90، S93، S94، S121 و S123 همگی PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۵ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها پابرجاست: Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر واقعی، Excel دسکتاپ/Save dialog، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

نقطه‌ی دقیق ادامه‌ی بعد:
- اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S123 با Prisma واقعی؛ مخصوصاً عبور chunkها و metadata از IPC، رسید پرقلم، چاپ A4 و Excel.
- اگر محیط تولیدی فراهم نشد، ادامه‌ی خوشه G روی `productVariant IN`های بزرگ خارج از StockAllocation/print که هنوز به جمع یا مدرک ضدسرقت وصل‌اند، سپس migration/void purge و مسیرهای واقعی Save dialog/Cancel/error چاپ؛ بدون ادعای بسته‌شدن تست Electron.

## نشست ۱۲۴ · خوشه G، تکمیل lookupهای واریانت در مسیرهای مالی
- گام ۰ اجرا شد: `npm install` ⇒ اجرا نشد، دلیل: `npm: not found`؛ `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: not found`؛ `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: not found`؛ `node --version` ⇒ `v22.23.1`.
- ✅ S124-1 · `InventoryService.checkAvailability`: lookup واریانت‌های گیت موجودی از یک `IN` بزرگ به chunkهای حداکثر ۵۰۰تایی تبدیل شد؛ همه‌ی هشدارهای کمبود، از جمله آخرین قلم، حفظ می‌شوند.
- ✅ S124-2 · `StoreCreditService.linesForInvoice`: lookup کالا/دسته‌ی اقلام فاکتور برای enforce محدودیت اعتبار خرید با همان chunkهای ۵۰۰تایی انجام می‌شود؛ هیچ قلمی برای دورنزدن محدودیت حذف نمی‌شود.
- ✅ S124-3 · `SecondaryStockService.coverShortage`: lookup واریانت‌های برداشت خودکار انبار مرکزی chunk شد؛ هشدار کمبود و مسیر افزایش موجودی برای تمام اقلام بزرگ باقی می‌ماند.
- تست بازتولید `tests/audit-fixes/fix-s124-financial-variant-in-chunking.mjs`: روی baseline نشست ۱۲۳، **۰ موفق · ۷ ناموفق**؛ بعد از رفع، **۷ موفق · ۰ ناموفق** برای ۵۰۱ واریانت در هر سه مسیر.
- `node --check` تست و `node --experimental-strip-types --check` روی سه سرویس تغییرکرده ⇒ PASS؛ رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۶ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها پابرجاست: Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر/Excel دسکتاپ/Save dialog، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

وضعیت و نقطه‌ی دقیق ادامه‌ی بعد:
- G: lookupهای پرریسک موجودی، اعتبار خرید و برداشت خودکار تا سقف ۵۰۰ بسته شد؛ `SalesService` مسیرهای برگشت/تعویض/پاک‌سازی که هنوز `productVariant IN` مستقیم دارند، بازبینی و تست نشده‌اند.
- اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S124 با Prisma واقعی؛ سپس typecheck، عبور metadata از IPC، چاپ/Excel و Save dialog واقعی.
- اگر محیط تولیدی فراهم نشد، اول `SalesService` در مسیرهای purge/return/exchange و سپس migration/void purge و تست‌های واقعی export/print را ادامه بده؛ هیچ تست واقعی Electron/چاپگر/Excel را با هارنس معادل اعلام نکن.
- هر رفع تازه باید تست قبل/بعد در `tests/audit-fixes/` و ثبت هم‌زمان در `PROGRESS.md`، `DECISIONS.md` و `TESTLOG.md` داشته باشد؛ خوشه C فقط با تست یکپارچه ادامه یابد.

## نشست ۱۲۵ · خوشه G، chunk کردن lookupهای مالی SalesService
- گام ۰: `npm install` ⇒ اجرا نشد، دلیل: `npm: not found`؛ `npx prisma generate` ⇒ اجرا نشد، دلیل: `npx: not found`؛ `npm run typecheck` ⇒ اجرا نشد، دلیل: `npm: not found`؛ `node --version` ⇒ `v22.23.1`.
- ✅ S125-1 · `SalesService`: lookup مستقیم واریانت‌ها در `purgeStockPlan`، مسیر مشترک `runReturn` برای ثبت برگشت، `findByReturnCode`، `createExchange`، `returnGet` و `returnUpdate` به helper مشترک `loadProductVariantsByIds` منتقل شد؛ helper شناسه‌ها را dedupe و در chunkهای حداکثر ۵۰۰تایی می‌خواند و نتیجه‌ی همه‌ی chunkها را نگه می‌دارد.
- دامنه‌ی تغییر فقط lookup است؛ selectها، نام snapshot، کنترل کالای حذف‌شده/مفقود، محاسبه‌ی برگشت، موجودی و مسیر تعویض تغییر معنایی نکردند.
- تست تازه `tests/audit-fixes/fix-s125-sales-product-variant-chunking.mjs`: روی baseline نشست ۱۲۴ **۰ موفق · ۶ ناموفق**؛ بعد از رفع **۶ موفق · ۰ ناموفق**. هارنس سقف `IN` را روی ۵۰۰ گذاشت و lookup واقعی برگشت با ۵۰۱ قلم را کامل خواند؛ آخرین قلم حذف نشد.
- `node --check` تست و `node --experimental-strip-types --check src/main/services/SalesService.ts` ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۸۷ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها پابرجاست: Prisma Client تولیدی، typecheck کامل، IPC/رندر واقعی Electron، چاپگر/Excel دسکتاپ/Save dialog، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

وضعیت و نقطه‌ی دقیق ادامه‌ی بعد:
- G: lookupهای مستقیم باقی‌مانده‌ی پرریسک در مسیرهای مالی SalesService بسته شد؛ `PartyService.customers/suppliers` همچنان صرفاً جست‌وجویی‌اند و فقط در صورت اثر روی جمع/مدرک باید تغییر کنند. مسیرهای migration/void purge و export/print واقعی هنوز باز هستند.
- اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S125 با Prisma واقعی؛ سپس typecheck، عبور metadata از IPC، چاپ A4 و Excel و Save dialog واقعی.
- اگر محیط تولیدی فراهم نشد، مسیرهای migration/void purge و export/print را با اولویت اثر روی مدرک مالی/ضدسرقت ادامه بده؛ هیچ تست واقعی Electron/چاپگر/Excel را با هارنس معادل اعلام نکن.
- هر رفع تازه باید تست قبل/بعد در `tests/audit-fixes/` و ثبت هم‌زمان در سه دفتر داشته باشد؛ خوشه C فقط با تست یکپارچه ادامه یابد.

## نشست ۱۲۶ · خوشه G/H، دامنه‌ی مالی و حفاظت دفتر انبار
- گام ۰ دوباره بررسی شد: `node --version` برابر `v22.23.1` است؛ `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- ✅ S126-1 · `src/main/services/accountingReport.ts`: محاسبه‌ی `creditRemaining` دیگر روی ۵۰٬۰۰۰ فاکتور قطع نمی‌شود؛ خواندن فاکتورهای تسویه‌نشده با صفحه‌های ۵٬۰۰۰تایی و ترتیب پایدار `id ASC` تا انتها ادامه پیدا می‌کند.
- تست `fix-s126-credit-remaining-full-range.mjs`: قبل از رفع **۰ موفق · ۳ ناموفق**؛ بعد از رفع **۳ موفق · ۰ ناموفق**. فاکتور شماره‌ی ۵۰٬۰۰۱ نیز در بدهی لحاظ شد و هشدار برش حذف شد.
- ✅ S126-2 · `src/main/services/VariantPurgeService.ts`: حذف فیزیکی کالا فقط پس از مهلت ۷۳۰ روز، با `deletedAt` معتبر، و بدون هیچ حرکت ثبت‌شده‌ی انبار مجاز است؛ شمارش `StockMovement` داخل تراکنش انجام می‌شود و ledger هرگز حذف نمی‌شود. `types.ts` و `Products.tsx` نیز قرارداد پیش‌نمایش و متن UI را هم‌راستا کردند.
- تست `fix-s126-variant-purge-retention-ledger.mjs`: قبل از رفع **۰ موفق · ۷ ناموفق**؛ بعد از رفع **۷ موفق · ۰ ناموفق**. مسیر `stockMovement.deleteMany` حذف شد و نتیجه‌ی سازگار قدیمی `movements: 0` را به معنی «هیچ حرکت قابل حذف نیست» نگه می‌دارد.
- `node --check` دو تست S126 و `node --experimental-strip-types --check` روی `accountingReport.ts` و `VariantPurgeService.ts` ⇒ PASS؛ parser ساختاری TSX نشست ۹۵ نیز PASS.
- رگرسیون مستقیم ۸۹ فایل audit در این محیط کامل قابل اجرا نبود: تست‌های وابسته به aliasهای TypeScript، Prisma Client تولیدی و loaderهای پروژه با `node` خام خطای module-not-found دادند. ادعای ۸۹/۰ ثبت نمی‌شود؛ آخرین رگرسیون کامل معتبر قبل از S126-2 همان **۸۸ فایل PASS · ۰ فایل FAIL** پس از S126-1 است.
- محدودیت‌های Prisma واقعی، typecheck کامل، Electron/IPC/رندر، چاپگر واقعی، Excel دسکتاپ/Save dialog، migration تاریخی، race چندپردازه‌ای، crash/قطع برق، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی همچنان باز هستند.

نقطه‌ی دقیق ادامه‌ی نشست ۱۲۷:
۱) اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S126 را با Prisma واقعی انجام بده؛ سپس typecheck، مسیر IPC، چاپ/Excel و migration/void purge را بررسی کن.
۲) اگر محیط تولیدی فراهم نشد، همین مسیرهای migration/void purge و export/print را با تست قبل/بعد ادامه بده؛ مخصوصاً هر سقفی که روی جمع مالی یا مدرک ضدسرقت اثر دارد. `PartyService.customers/suppliers` را فقط با اثر ثابت‌شده تغییر بده.
۳) قبل از هر ادعای رگرسیون کامل، runner واقعی پروژه و alias/loader موردنیاز را پیدا کن؛ اجرای خام `node tests/audit-fixes/*.mjs` جای آن نیست.

## نشست ۱۲۷ · خوشه G/H، گیت آرشیو و حفاظت دفتر انبار
- گام ۰ اجرا شد: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` هر سه اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- runner واقعی هارنس شناسایی و بازسازی شد: اجرای `node --import ./test/harness/register.mjs` روی همه‌ی تست‌ها، **۹۰ فایل PASS · ۰ فایل FAIL**.
- تست قبل `fix-s127-maintenance-purge-guard.mjs` روی baseline نشست ۱۲۶ ⇒ **۰ موفق · ۷ ناموفق**.
- ✅ S127-1 · `MaintenanceService.archivePurge/preview`: حذف فیزیکی اکنون فقط با cutoff حداقل ۷۳۰ روز قدیمی مجاز است؛ گیت در `main` مستقل از UI و preview enforce می‌شود و تاریخ حداقلی در قرارداد/رابط نشان داده می‌شود.
- ✅ S127-2 · `MaintenanceService`: همه‌ی DELETE/UPDATEهای `StockMovement` از آرشیو حذف شدند؛ دفتر گردش انبار append-only باقی می‌ماند و تعداد ردیف‌های قدیمی به‌عنوان «حفظ‌شده» و هشدار فارسی گزارش می‌شود. گزینه‌ی UI که حذف حرکت انبار را وعده می‌داد هم حذف شد.
- تست بعد `fix-s127-maintenance-purge-guard.mjs` ⇒ **۷ موفق · ۰ ناموفق**؛ `node --check` تست، `node --experimental-strip-types --check` سرویس/انواع، و parser `Settings.tsx` همگی PASS.
- رگرسیون کامل هارنس پس از S127 ⇒ **۹۰ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها: Prisma Client تولیدی، typecheck واقعی، IPC/رندر Electron، چاپگر/Excel دسکتاپ/Save dialog، migration روی داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی هنوز اجرا نشده‌اند.

نقطه‌ی دقیق ادامه‌ی نشست ۱۲۸:
۱) اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S127 با Prisma واقعی؛ سپس migration/void purge و مسیرهای واقعی export/print را اجرا کن.
۲) اگر محیط تولیدی فراهم نشد، با کپی داده بررسی کن که آرشیو دو ساله اسناد وابسته را در Prisma واقعی و بدون dangling reference مدیریت می‌کند؛ سپس Save dialog، Cancel، خطای چاپ، destroy پنجره، A4 و Excel را با Electron واقعی اجرا کن.
۳) `PartyService.customers/suppliers` فقط در صورت اثبات اثر روی جمع یا مدرک تغییر کند؛ هیچ هارنس را جای تست تولیدی اعلام نکن.

## نشست ۱۲۸ · تکمیل خوشه‌های F/H، خروجی گزارش و گیت آرشیو
- گام ۰ دوباره بررسی شد: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` هر سه اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- ✅ S128-1 · خوشه F/J · `src/renderer/src/pages/SalesReports.tsx`: فیلتر فرم زنده از snapshot آخرین اجرای موفق جدا شد. `reportDataKey` تب، فیلترها، `includeExchanges`، `includeSettled`، `chequeDateMode` و دسترسی پنل اعتبار را در کلید خروجی می‌آورد؛ تا وقتی کلید زنده با کلید بارگذاری‌شده یکی نیست، چاپ حرارتی/A4، Excel و خروجی وصول نسیه قفل‌اند و هشدار فارسیِ «فیلتر گزارش تغییر کرده؛ ابتدا تهیه گزارش را بزنید» نمایش داده می‌شود. عنوان و metadata خروجی از `appliedFilters` می‌آید، نه از فرم تغییرکرده.
- ✅ S128-2 · خوشه H · `src/main/services/MaintenanceService.ts`: کل `archivePurge`، نه فقط `purgeAudit`، قبل از backup و تراکنش با `assertManagerPassword` محافظت می‌شود؛ نبود رمز دیگر حذف بقیه‌ی آرشیو را مجاز نمی‌کند.
- ✅ S128-3 · خوشه H · `src/main/ipc/index.ts`: actor عملیات آرشیو از `withSessionActor` و نشست باز main گرفته می‌شود و `userId` ارسالی renderer مبنای audit نیست.
- ✅ S128-4 · خوشه H · `src/renderer/src/pages/Settings.tsx`: رمز مدیر همیشه برای کل آرشیو ارسال می‌شود و متن UI الزام رمز را برای کل عملیات توضیح می‌دهد؛ پیام گمراه‌کننده‌ی «فقط حذف لاگ انجام نمی‌شود و بقیه ادامه دارد» حذف شد.
- تست‌های قبل روی baseline نشست ۱۲۷: `fix-s128-report-output-filter-lock.mjs` ⇒ **۰ موفق · ۷ ناموفق**؛ `fix-s128-maintenance-archive-gate.mjs` ⇒ **۱ موفق · ۶ ناموفق**.
- تست‌های بعد: هر دو تست S128 ⇒ **۷ موفق · ۰ ناموفق**؛ جمع S128 برابر **۱۴ بررسی موفق · ۰ ناموفق**.
- `node --check` هر دو تست ⇒ PASS؛ `node tools/tsx-parse-check.mjs src/renderer/src/pages/SalesReports.tsx src/renderer/src/pages/Settings.tsx` ⇒ PASS.
- رگرسیون کامل هارنس پس از S128 که در همین نشست اجرا شد ⇒ **۹۲ فایل PASS · ۰ فایل FAIL**.
- فهرست فایل‌های `src` تغییرکرده در این نشست: `src/renderer/src/pages/SalesReports.tsx`، `src/main/services/MaintenanceService.ts`، `src/main/ipc/index.ts`، `src/renderer/src/pages/Settings.tsx`.
- محدودیت‌ها پابرجاست: Prisma Client تولیدی، typecheck واقعی، IPC/رندر Electron، چاپگر و Save dialog/Excel دسکتاپ، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.

وضعیت خوشه‌ها پس از نشست ۱۲۸:
- F/J: بخش قفل خروجیِ فیلترنشده و هم‌راستایی metadata خروجی بسته شد؛ تست رندر واقعی، Save dialog، چاپگر و Excel دسکتاپ هنوز باز است.
- H: گیت مدیر برای کل archive و actor نشست واقعی بسته شد؛ purge/void و migration داده‌ی تاریخی و بازآزمایی Prisma واقعی همچنان باز است.
- G: رفع‌های S118 تا S127 و chunk/صفحه‌بندی/retention ثبت‌شده پابرجاست؛ بازآزمایی Prisma واقعی و مسیرهای واقعی چاپ/export باقی است.
- A، B، C، D، E، I، K، L، M: هیچ تغییر S128 نداشتند و وضعیت ثبت‌شده‌ی قبل پابرجاست؛ خوشه C فقط با تست یکپارچه ادامه یابد و تکه‌تکه نشود.

نقطه‌ی دقیق ادامه‌ی نشست ۱۲۹:
۱) اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S128 را با Prisma واقعی اجرا کن؛ سپس migration/void purge را روی کپی داده و مسیرهای واقعی export/print را بررسی کن.
۲) اگر محیط تولیدی فراهم نشد، ابتدا Save dialog/Cancel/خطای چاپ/destroy پنجره، چاپ A4 و Excel را با تست قبل/بعد ادامه بده؛ هیچ تست harness یا parser را تست واقعی Electron/چاپگر/Excel اعلام نکن.
۳) برای هر رفع تازه تست قبل/بعد در `tests/audit-fixes/` و ثبت هم‌زمان در `PROGRESS.md`، `DECISIONS.md` و `TESTLOG.md` الزامی است؛ `PartyService.customers/suppliers` فقط با اثر ثابت‌شده تغییر کند.

## نشست ۱۲۹ · خوشه J — چاپ A4 بزرگ، لغو/خطای چاپ، ازبین‌رفتن پنجره، ذخیره‌ی امن Excel/CSV/PDF
- تصحیح سابقه: بند ۱۰-۱۰۲ هندآف کهنه بود. روی zip تحویلی نشست ۱۲۸ دوباره اجرا شد: دو تست S128 هر کدام ۷/۷ و رگرسیون کامل ۹۲ PASS · ۰ FAIL؛ پس S128 کامل است.
- گام ۰: `node --version` ⇒ v22.23.1؛ `npm`/`npx` موجود نیستند ⇒ npm install، npx prisma generate و npm run typecheck اجرا نشدند.
- ✅ S129-1 · `src/main/print/printer.ts`: سندی که data URL آن از 1,900,000 کاراکتر بیشتر شود از فایل موقت خصوصی (mode 0600) با `loadFile` بار و همیشه پاک می‌شود؛ سند کوچک مثل قبل. قبل: چاپ A4 گزارش ۳٬۰۰۰ ردیفی (data URL = 2,426,359 > سقف 2,097,152 کرومیوم) و PDF دسته‌ی ۵۰۰ اعتباری با ERR_INVALID_URL و پیام کلی شکست می‌خورد.
- ✅ S129-2 · همان فایل: لغو/چاپگر نامعتبر/نبود چاپگر/خطا ⇒ پیام فارسی با علت؛ لغو همچنان reject است؛ `render-process-gone`/`destroyed`/`closed` پیش از callback ⇒ reject با پیام «معلوم نیست برگه چاپ شده باشد» به‌جای Promise معلق (در Pos.tsx معلق‌ماندن، busy و سبدِ فاکتورِ ثبت‌شده را قفل می‌کرد)؛ `pdfFromHtml` همان گارد و finally با `isDestroyed`.
- ✅ S129-3 · `src/main/services/ExportService.ts`: `writeFileAtomic` (موقت کنار مقصد + rename، ۵ تلاش کوتاه برای قفل گذرا، پاک‌کردن موقت در شکست) و `exportWriteErrorMessage` فارسی با نام فایل و علت.
- ✅ S129-4 · همان فایل: `dialogParentWindow` فقط پنجره‌ی زنده و دیده‌شدنی را والد Save dialog می‌کند.
- ✅ S129-5 · `src/main/services/PrintService.ts` (`creditPdf`): همان نوشتن امن و والد دیالوگ؛ `showItemInFolder` داخل try.
- `test/acceptance-session25.mjs` بند ۱۳: جست‌وجوی لفظی به `await writeFile(?:Atomic)?\(file, pdf\)` تعمیم یافت؛ قاعده‌ی ترتیب لغو ⇐ نوشتن ⇐ شمارش حفظ شد.
- تست‌ها: `fix-s129-print-large-cancel-destroy.mjs` قبل ۳/۱۷، بعد ۱۷/۱۷؛ `fix-s129-export-write-safety.mjs` قبل ۵/۱۳، بعد ۱۳/۱۳. رگرسیون کامل ⇒ ۹۴ PASS · ۰ FAIL.
- ناتمام (بدون تغییر src): probe چاپ A4 با Chromium بدون‌سر واقعی شروع شد (۱۵۰ ردیف ⇒ ۴ صفحه؛ عرض body ۸۲۴px در برابر جدول ۷۹۴px)؛ تحلیل PDF انجام نشد و ادعایی ثبت نمی‌شود.
- فایل‌های src تغییرکرده: `src/main/print/printer.ts`، `src/main/services/ExportService.ts`، `src/main/services/PrintService.ts`.

## نشست ۱۳۰ · خوشه J — چیدمان A4 و تنظیم چاپ Excel
- گام ۰ دوباره اجرا شد: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` هر سه اجرا نشدند چون `npm` و `npx` در محیط موجود نیستند.
- ✅ S130-1 · `src/main/print/templates.ts`: `body` قالب عمومی با `box-sizing:border-box` در عرض کاغذ محدود شد. baseline واقعی Chromium برای A4: عرض body برابر `823.90625px` و `scrollWidth=824` در برابر `clientWidth=794` بود؛ بعد از رفع: `bodyWidth=793.6875` و `scrollWidth=clientWidth=794`.
- ✅ S130-2 · `src/main/services/xlsx.ts`: `sheetPr/pageSetUpPr fitToPage="1"` و `fitToHeight="0"` اضافه شد و در `workbook.xml` نام تعریف‌شده‌ی `_xlnm.Print_Titles` برای تکرار ردیف عنوان/سرستون ثبت می‌شود؛ با وجود عنوان، سه ردیف اول تکرار می‌شوند و بدون عنوان فقط ردیف سرستون.
- تست‌های تازه: `fix-s130-a4-layout.mjs` ⇒ **۵ موفق · ۰ ناموفق** با Chromium headless، `page.pdf` چهارصفحه‌ای A4، تکرار سرستون در هر چهار صفحه و حفظ آخرین فیش/جمع؛ `fix-s130-xlsx-print-layout.mjs` ⇒ **۴ موفق · ۰ ناموفق** با unzip روی XML واقعی xlsx.
- رگرسیون کامل پس از S130: `tests/audit-fixes/*.mjs` ⇒ **۹۶ فایل PASS · ۰ فایل FAIL**؛ `node --check` دو تست تازه نیز PASS شد. اجرای Electron واقعی، Save dialog ویندوز، اکسل دسکتاپ/قفل فایل، Prisma تولیدی و typecheck واقعی همچنان اثبات نشده‌اند.
- بازآزمایی LibreOffice: یک xlsx واقعی ۱۲۰ ردیفی با `soffice --headless --convert-to pdf` به PDF پنج‌صفحه‌ای A4 landscape تبدیل شد؛ صفحه‌ی آخر عنوان/سرستون، آخرین ردیف و ردیف جمع را داشت.
- فایل‌های src تغییرکرده در این نشست: `src/main/print/templates.ts`، `src/main/services/xlsx.ts`.

نقطه‌ی دقیق ادامه‌ی نشست ۱۳۱:
۱) اجرای رگرسیون کامل `tests/audit-fixes/*.mjs` با runner هارنس و بازآزمایی S129/S130؛ سپس اگر امکان فراهم شد `npm install`، `npx prisma generate` و `npm run typecheck`.
۲) اجرای واقعی Electron برای Save dialog، لغو چاپ، فایل باز در اکسل و پرینتر؛ تست Chromium جای Electron واقعی را نمی‌گیرد.
۳) بررسی یافته‌ی باز CSV formula injection و هنگ‌کردن callback چاپگری که هرگز پاسخ نمی‌دهد؛ فقط با تست قبل/بعد تغییر کن.

## نشست ۱۳۱ · خوشه J، ایمن‌سازی CSV و پایان‌دادن به چاپ معلق
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- نقطه‌ی شروع رعایت شد: تست S130 A4 ⇒ **۵ موفق · ۰ ناموفق**؛ تست S130 Excel ⇒ **۴ موفق · ۰ ناموفق**؛ رگرسیون کامل قبل از رفع روی baseline نشست ۱۳۰ ⇒ **۹۶ فایل PASS · ۰ فایل FAIL**.
- تست بازتولید تازه `tests/audit-fixes/fix-s131-csv-formula-print-timeout.mjs` روی baseline ⇒ **۱ موفق · ۳ ناموفق**.
- ✅ S131-1 · `src/main/services/ExportService.ts`: `csvCell` برای مقدارهای متنی که با `=`, `+`, `-` یا `@` شروع می‌شوند apostrophe ایمن می‌گذارد تا Excel آن‌ها را فرمول اجرا نکند؛ عدد واقعی منفی به‌عنوان عدد دست‌نخورده می‌ماند. عنوان، سرستون، ردیف‌ها و جمع‌ها همگی از همین helper عبور می‌کنند.
- ✅ S131-2 · `src/main/print/printer.ts`: `guardWindowJob` اکنون timeout محدود دارد؛ پیش‌فرض `PRINT_CALLBACK_TIMEOUT_MS = 30_000` میلی‌ثانیه است. پایان timeout هرگز موفقیت چاپ فرض نمی‌شود، با پیام فارسی «معلوم نیست برگه چاپ شده باشد» reject می‌کند، listener/پنجره را پاک می‌کند و شمارنده‌ی چاپ/اعتبار را موفق ثبت نمی‌کند. برای تست، `timeoutMs` اختیاری به مسیر چاپ/PDF تزریق شده است.
- تست بعد: S131 ⇒ **۴ موفق · ۰ ناموفق**؛ `node --check` تست و `node --experimental-strip-types --check` روی `ExportService.ts` و `printer.ts` ⇒ PASS.
- رگرسیون کامل پس از رفع با runner هارنس ⇒ **۹۷ فایل PASS · ۰ فایل FAIL**.
- فایل‌های `src` تغییرکرده در این نشست: `src/main/services/ExportService.ts` و `src/main/print/printer.ts`.
- وضعیت J: S129-1 تا S129-5 و S130-1 تا S130-2 پابرجا؛ S131-1 و S131-2 بسته شدند. Electron/پرینتر/Save dialog/Excel دسکتاپ، Prisma Client تولیدی، typecheck واقعی، migration تاریخی، race چندپردازه‌ای، crash/قطع برق وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی هنوز اثبات نشده‌اند.

نقطه‌ی دقیق ادامه‌ی نشست ۱۳۲:
۱) اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S131 با Prisma/Electron واقعی؛ سپس Save dialog، فایل باز در Excel، timeout/پرینتر واقعی و migration/void purge روی کپی داده.
۲) اگر محیط تولیدی فراهم نشد، ادعاهای باقی‌مانده‌ی واقعی Excel/پرینتر/Save dialog را باز نگه دار و فقط با تست قبل/بعد روی اثر قابل‌اثبات ادامه بده؛ تست harness جای Electron واقعی نیست.
۳) رگرسیون فعلی مرجع: `tests/audit-fixes/*.mjs` ⇒ ۹۸ فایل PASS · ۰ فایل FAIL. هر رفع تازه باید در هر سه دفتر ثبت شود؛ خوشه C فقط با تست یکپارچه ادامه یابد.

## نشست ۱۳۲ · خوشه J، هم‌خوانی پسوند خروجی با قالب انتخاب‌شده
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` هر سه اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- نقطه‌ی شروع: تست S130 A4 ⇒ **۵ موفق · ۰ ناموفق**؛ تست S130 Excel ⇒ **۴ موفق · ۰ ناموفق**. رگرسیون baseline پیش از S132 ⇒ **۹۷ فایل PASS · ۰ فایل FAIL**.
- شکاف واقعی: `ExportService` وقتی Save dialog مسیر بدون پسوند و قالب CSV برمی‌گرداند، قبلاً اجباری `.xlsx` اضافه می‌کرد و فایل CSV با پسوند غلط می‌ساخت.
- ✅ S132-1 · `src/main/services/ExportService.ts`: پسوند صریح `.csv`/`.xlsx` حفظ می‌شود و مسیر بدون پسوند بر اساس قالب انتخاب‌شده کامل می‌شود؛ رفتار XLSX موجود تغییر نکرد.
- تست قبل/بعد `tests/audit-fixes/fix-s132-export-extension.mjs`: baseline ⇒ **۲ موفق · ۳ ناموفق**؛ بعد از رفع ⇒ **۵ موفق · ۰ ناموفق**. `node --check` تست و `node --experimental-strip-types --check src/main/services/ExportService.ts` ⇒ PASS.
- رگرسیون کامل پس از رفع با runner هارنس، در دو دسته‌ی ۵۰ و ۴۸تایی ⇒ **۹۸ فایل PASS · ۰ فایل FAIL**.
- فایل‌های `src` تغییرکرده در این نشست: فقط `src/main/services/ExportService.ts`.
- وضعیت J: S132-1 بسته شد؛ Save dialog واقعی، Excel دسکتاپ، پرینتر واقعی، Electron/IPC واقعی، Prisma Client تولیدی و typecheck کامل هنوز اثبات نشده‌اند. S121 همچنان باز است: خروجی گزارش‌های صفحه‌بندی‌شده فعلاً صفحه‌ی جاری را صادر می‌کند و هشدار می‌دهد؛ الزام master برای خروجی کامل فیلترشده هنوز باید با طراحی/تست جدا رفع شود.
- وضعیت A، B، C، D، E، F، G، H، I، K، L، M: بدون تغییر این نشست؛ محدودیت‌ها و وضعیت ثبت‌شده‌ی قبلی پابرجاست.

محدودیت‌های قطعی نشست ۱۳۲:
Prisma Client تولیدی، `npm install`، `npx prisma generate`، `npm run typecheck`، رندر/IPC واقعی Electron، Save dialog واقعی، Excel دسکتاپ و قفل فایل باز، پرینتر واقعی، migration روی داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند. تست S132 با ماک Electron و فایل واقعی تولیدشده در sandbox فقط قرارداد مسیر/قالب را اثبات می‌کند.

نقطه‌ی دقیق شروع نشست ۱۳۳:
۱) اگر npm/Prisma/Electron فراهم شد، گام ۰ و بازآزمایی S98 تا S132 با Prisma/Electron واقعی؛ سپس Save dialog، فایل باز در Excel، timeout/پرینتر واقعی و migration/void purge روی کپی داده.
۲) اگر محیط تولیدی فراهم نشد، ابتدا برای S121 یک طراحی کم‌ریسک و تست‌شده بساز که چاپ/Excel پیش‌فرض را از کل خروجی فیلترشده تهیه کند، نه فقط صفحه‌ی جاری؛ خروجی صفحه‌ی جاری فقط با اقدام صریح کاربر مجاز باشد. هیچ هارنس را جای Electron/Excel واقعی اعلام نکن.
۳) رگرسیون مرجع فعلی: `tests/audit-fixes/*.mjs` ⇒ **۹۸ فایل PASS · ۰ فایل FAIL**. هر رفع تازه باید تست قبل/بعد در `tests/audit-fixes/` و ثبت هم‌زمان در `PROGRESS.md`، `DECISIONS.md` و `TESTLOG.md` داشته باشد؛ خوشه C فقط با تست یکپارچه ادامه یابد.

## نشست ۱۳۳ · ادامه‌ی S121
- ✅ S133-1: خروجی پیش‌فرض چاپ/Excel از کل داده‌ی فیلترشده ساخته می‌شود، نه صفحه‌ی جاری؛ گزینه‌ی صفحه‌ی جاری با اقدام صریح اضافه شد.
- ✅ صفحه‌بندی مشترک، وصول نسیه‌ی دوره‌های قبل، دفتر رویداد و منابع ضدتقلب برای مسیر خروجی کامل پوشش داده شدند.
- ⚠️ اثبات واقعی Electron/Save dialog/Excel/پرینتر و npm/Prisma/typecheck همچنان باز است.
- نقطه‌ی ادامه: تست قرارداد جدید S133 را جایگزین تست قدیمی S121 کن، سپس رگرسیون کامل و تست واقعی Electron/Excel را اجرا کن.

## نشست ۱۳۴ · بستن بدهی تست S121 و قرارداد خروجی کامل
- گام ۰ دوباره اجرا شد: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- ✅ S134-1 · خوشه J/F/G · تست قراردادی `tests/audit-fixes/fix-s133-report-export-full-range.mjs` ساخته شد. تست، پیش‌فرض `all`، تیک صریح صفحه‌ی جاری، snapshot مشترک، تمام endpointهای `readAllReportPages`، صفحه‌بندی مستقل وصول نسیه، `fullRange/allSources` و helper واقعی را بررسی می‌کند.
- مسیر تاریخی `fix-s121-report-export-page-warning.mjs` به‌عنوان پل سازگار همان تست قرارداد S133 را اجرا می‌کند؛ assert قدیمی `meta: outputMetaText` دیگر معیار کد جدید نیست.
- تست‌های ساختاری S87، S94، S110 و S111 که به نام‌های قبل از refactor snapshot وابسته بودند، بدون تغییر رفتار مالی با قرارداد فعلی `output.*`/`fraudGroups` هم‌راستا شدند.
- نتیجه‌ی تست S134 ⇒ **۲۰ بررسی موفق · ۰ ناموفق**؛ اجرای مسیر تاریخی S121 با پل سازگار ⇒ **۲۰ موفق · ۰ ناموفق**.
- parser روی `SalesReports.tsx`، `reportOutput.ts`، `SalesService.ts`، `SalesLedger.ts` و `FraudService.ts` ⇒ **۵ فایل PASS**؛ `node --check` دو تست خروجی ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` با `node --import ./test/harness/register.mjs` ⇒ **۹۹ فایل PASS · ۰ فایل FAIL**.
- فایل‌های `src` در این نشست تغییر نکردند؛ تغییرات این نشست فقط تست‌های قرارداد و سه دفتر تحویل‌اند.
- وضعیت خوشه‌ها: J/F/G از نظر قرارداد کد خروجی کامل و تست harness بسته‌اند؛ Electron/IPC/Save dialog/Excel دسکتاپ/پرینتر، Prisma واقعی، typecheck و حجم کامل تاریخی هنوز اثبات نشده‌اند. H و A، B، C، D، E، I، K، L، M بدون تغییرند؛ خوشه C همچنان فقط با تست یکپارچه ادامه یابد.
- نقطه‌ی دقیق ادامه‌ی نشست ۱۳۵: ابتدا گام ۰ را در محیط دارای npm/Prisma اجرا کن؛ سپس S134 و S129 تا S133 را با Electron/Save dialog/Excel/پرینتر واقعی بازآزمایی کن. اگر محیط واقعی فراهم نبود، ادعای تولیدی نکن و سراغ migration/void purge روی کپی داده یا مورد باز خوشه‌های A تا M فقط با تست قبل/بعد برو.

## نشست ۱۳۵ · S135 · خوشه H، آرشیو شیفت‌های قدیمی
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` هر سه با کد ۱۲۷ اجرا نشدند، چون `npm` و `npx` در محیط موجود نیستند.
- baseline نقطه‌ی شروع: S133 و S121 هر کدام **۲۰ موفق · ۰ ناموفق**؛ رگرسیون کامل قبل از رفع ⇒ **۹۹ فایل PASS · ۰ فایل FAIL**.
- شکاف بازتولیدشده: `MaintenanceService.archivePurge` در preview شمارنده‌ی `shifts` را داشت و SQL حذف شیفت‌های قدیمی را اجرا می‌کرد، اما guard «هیچ داده‌ای برای پاک‌سازی نیست» فقط invoice/audit/cash/consolidation را بررسی می‌کرد؛ دیتابیسی که فقط شیفت قدیمیِ بی‌سند داشت بی‌دلیل متوقف می‌شد.
- ✅ S135-1 · `src/main/services/MaintenanceService.ts`: `before.shifts` به guard نبودن داده‌ی قابل‌پاک‌سازی اضافه شد؛ هیچ منطق حذف ledger یا وابستگی مالی تغییر نکرد.
- تست بازتولید `tests/audit-fixes/fix-s135-maintenance-shifts-purge.mjs`: روی baseline **۲ موفق · ۱ ناموفق**؛ بعد از رفع **۳ موفق · ۰ ناموفق**.
- `node --check tests/audit-fixes/fix-s135-maintenance-shifts-purge.mjs` ⇒ PASS؛ رگرسیون کامل پس از رفع ⇒ **۱۰۰ فایل PASS · ۰ فایل FAIL**.
- اثبات محدود: تست S135 قراردادی/ساختاری است؛ اجرای Prisma Client تولیدی، migration روی کپی دیتابیس و اجرای واقعی archive purge در این محیط انجام نشد.
- فایل‌های تغییرکرده در نشست ۱۳۵: `src/main/services/MaintenanceService.ts`، `tests/audit-fixes/fix-s135-maintenance-shifts-purge.mjs`، `PROGRESS.md`، `DECISIONS.md`، `TESTLOG.md`.
- نقطه‌ی دقیق شروع نشست بعد: گام ۰ را در محیط دارای npm/Prisma اجرا کن؛ سپس S135 و S127/S128 را روی Prisma واقعی و کپی دیتابیس بازآزمایی کن. در نبود محیط تولیدی، ادعای migration/void purge واقعی نکن و فقط با تست قبل/بعد سراغ شکاف بعدی برو.

## نشست ۱۳۶ · S136 · خوشه E، قفل دوره روی پرداخت‌ها و روز شمسی
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند، چون npm/npx/typescript/prisma در محیط نیستند و اینترنت در دسترس نیست.
- baseline پیش از تغییر ⇒ **۱۰۰ فایل PASS · ۰ فایل FAIL**.
- ✅ S136-1 · `PeriodLockService.status`: روزِ گذشته با هر صندوق بسته‌ی هم‌پوشان با آن روز شمسی بسته است؛ امروز همچنان لحظه‌ای.
- ✅ S136-2 · `SalesService`: گیت دوره‌ی بسته (preverify بیرون از تراکنش + Audit `CLOSED_PERIOD_OVERRIDE`) روی addPayment با تاریخ دستی، ویرایش مالی پرداخت، ابطال پرداخت و تغییر وضعیت چک.
- ✅ S136-3 · `InvoicePaymentsModal.tsx`: کادر رمز مدیر/دلیل پس از پیام دوره‌ی بسته برای ثبت، ابطال و وضعیت چک.
- تست `tests/audit-fixes/fix-s136-payment-period-lock.mjs`: baseline **۱۰ موفق · ۲۳ ناموفق**؛ بعد از رفع **۳۱ موفق · ۰ ناموفق**.
- رگرسیون کامل ⇒ **۱۰۱ فایل PASS · ۰ فایل FAIL**؛ سوییت‌های `test/*.mjs` قبل و بعد یکسان.
- ⚠️ اثبات Prisma واقعی/Electron/typecheck انجام نشد.
- نقطه‌ی ادامه: بند ۱۰-۱۱۰ در `HANDOFF-PROMPT-next.txt`.

## نشست ۱۳۷ و ۱۳۸ · خوشه E، هشدار نشست چندروزه و validation ورودی مالی
- گام ۰: `node --version` ⇒ `v22.23.1`؛ npm/npx/typescript/prisma در محیط نیستند و اینترنت sandbox در دسترس نیست، پس `npm install`، `npx prisma generate` و `npm run typecheck` اجرا نشدند.
- baseline هارنس پیش از رفع ⇒ **۱۰۱ فایل PASS · ۰ فایل FAIL**.
- ✅ S137 · `ShiftService.info` تاریخ واقعی باز تا بسته/اکنون را به روز شمسی تبدیل می‌کند و اگر نشست از نیمه‌شب عبور کرده باشد `multiDayWarning` فارسی برمی‌گرداند؛ `ShiftInfo` و `ShiftSessionModal`/نشان نشست آن را صریح و زرد نمایش می‌دهند. هشدار مانع فروش نیست، اما پوشش دو روز شمسی را پنهان نمی‌کند.
- تست S137 `tests/audit-fixes/fix-s137-multi-day-session-warning.mjs`: قبل **۱ موفق · ۵ ناموفق**؛ بعد **۶ موفق · ۰ ناموفق**.
- ✅ S138 · `SalesService`: validator مشترک create/update اکنون شناسه، qty، قیمت، تخفیف، مالیات، هزینه‌ها، پرداخت‌ها، درصد تخفیف و جمع‌های محاسبه‌شده را با `Number.isSafeInteger`/حداقل مجاز بررسی می‌کند؛ `addPayment` دیگر اعشار را با `Math.round` به مبلغ دیگری تبدیل نمی‌کند. NaN، Infinity، منفی، اعشار و مبلغ خارج از سقف امن با پیام فارسی رد می‌شوند و پیش از هر side-effect هستند.
- تست S138 `tests/audit-fixes/fix-s138-financial-input-validation.mjs`: قبل **۳ موفق · ۱۱ ناموفق**؛ بعد **۱۴ موفق · ۰ ناموفق**. parser TypeScript برای `SalesService.ts` و `ShiftService.ts` ⇒ PASS.
- محدودیت: تست‌ها روی SQLite harness داخلی Node 22 هستند؛ Prisma Client تولیدی، Electron/IPC واقعی، typecheck، migration تاریخی، race چندپردازه‌ای، crash وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی همچنان اجرا نشدند.
- نقطه‌ی دقیق شروع بعد: گام ۰ در محیط دارای npm/Prisma؛ سپس بازآزمایی S137/S138 روی Prisma واقعی و ادامه‌ی باقی‌مانده‌ی خوشه E با تست کامل، بدون ادعای تولیدی.

## نشست ۱۳۹ · خوشه E، ورودی‌های صندوق و تحویل نقد
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` همچنان اجرا نشدند؛ npm/npx/typescript/prisma در محیط نیستند و sandbox اینترنت ندارد.
- baseline تست S139 روی کد نشست ۱۳۸ ⇒ **۰ موفق · ۱۸ ناموفق**.
- ✅ S139 · `ShiftService.ts`: `openSession`، `createSession` و `confirmStaff` شناسه‌های اعشاری/NaN/منفی/خارج از سقف امن را قبل از lookup یا ساخت نشست رد می‌کنند و دیگر `Math.round` نمی‌کنند.
- ✅ S139 · `CashMovementService.ts`: واریز/برداشت و `recordCashMovement` فقط مبلغ صحیح مثبت را می‌پذیرند؛ `abs` و گردکردن حذف شد تا مبلغ منفی یا اعشاری به مبلغ دیگری تبدیل نشود.
- ✅ S139 · `CashboxService.ts`: `close` و `expected` برای شمارش نقد، موجودی اول، آستانه مغایرت و شناسه‌ها validation سخت دارند؛ ورودی نامعتبر قبل از snapshot/حرکت نقدی رد می‌شود.
- ✅ S139 · `CashboxService.ts` و `CashClose.tsx`: اگر شمارش نشست قبلی با موجودی اول نشست جدید اختلاف داشته باشد، هشدار فارسی با هر دو مبلغ در پاسخ main و نوار هشدار UI دیده می‌شود؛ عدد جایگزین یا بی‌صدا اصلاح نمی‌شود.
- ✅ S139 · `ipc/index.ts`: actor کانال‌های بستن صندوق، بستن نشست و واریز/برداشت از نشست باز خوانده می‌شود، نه از `userId` قابل‌جعل renderer.
- تست `tests/audit-fixes/fix-s139-cash-session-input-and-handover.mjs`: قبل **۰ موفق · ۱۸ ناموفق**؛ بعد **۱۸ موفق · ۰ ناموفق**.
- تست سازگاری `fix-s67-payment-actor.mjs` پس از تغییر پیام actor ⇒ **۱۰ موفق · ۰ ناموفق**.
- parser پنج فایل تغییرکرده و `node --check` تست S139 ⇒ PASS.
- وضعیت خوشه E: validation عددی مسیر فروش S138 و مسیر صندوق/نشست S139 بسته شد؛ بازآزمایی Prisma واقعی، typecheck واقعی، migration تاریخی و رندر واقعی Electron همچنان باز است. هشدار تحویل اطلاعاتی است و عمداً بستن صندوق را متوقف نمی‌کند.

## نشست ۱۴۰ · S140 · actor چرخه‌ی نشست در مرز IPC
- baseline تست تازه روی کپی دست‌نخورده‌ی نشست ۱۳۹ ⇒ **۰ موفق · ۵ ناموفق**.
- شکاف: `shiftSessionOpen` و `shiftSessionStaff` payload را مستقیم به سرویس می‌دادند؛ در نتیجه `userId` ارسالی renderer می‌توانست actor حسابرسیِ بازکردن نشست/تأیید کارمند را جعل کند.
- ✅ `src/main/ipc/index.ts`: helper `withOptionalSessionActor` اضافه شد؛ actor از نشست بازِ main خوانده می‌شود و برای اولین نشست، نبود actor قبلی مجاز می‌ماند. هر دو mutation (`shiftSessionOpen` و `shiftSessionStaff`) از این helper استفاده می‌کنند.
- تست `tests/audit-fixes/fix-s140-session-actor-guard.mjs`: قبل **۰ موفق · ۵ ناموفق**؛ بعد **۵ موفق · ۰ ناموفق**.
- `node --check` تست و `node --experimental-strip-types --check src/main/ipc/index.ts` ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` ⇒ **۱۰۵ فایل PASS · ۰ فایل FAIL**.
- محدودیت‌ها پابرجا: npm/Prisma/typecheck واقعی، Electron/IPC/رندر واقعی، migration تاریخی، Save dialog/Excel/پرینتر واقعی، race چندپردازه‌ای، crash وسط transaction، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ با Prisma واقعی اجرا نشدند.
- وضعیت خوشه E: validation عددی و هشدار تحویل نقد S138/S139 و actor چرخه نشست S140 با harness بسته‌اند؛ بازآزمایی تولیدی و گیت‌های قدیمیِ ثبت‌نشده هنوز بازند.
- نقطه‌ی دقیق ادامه: ابتدا گام ۰ و S136 تا S140 را در محیط دارای npm/Prisma/Electron بازآزمایی کن؛ در نبود آن، باقی‌مانده‌ی خوشه E را فقط با تست قبل/بعد و بدون ادعای تولیدی ادامه بده.

## نشست ۱۴۱ · S141 · خوشه E/C، رد سخت اعشار در برگشت و تعویض
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`، `npx prisma generate` و `npm run typecheck` به‌ترتیب با کد ۱۲۷ اجرا نشدند، چون `npm`/`npx` در محیط موجود نیستند.
- شکاف بازتولیدشده: `createReturn`، `createExchange` و `returnUpdate` در چند نقطه `Math.round` روی qty/قیمت/تخفیف/مالیات ورودی renderer داشتند؛ مقدار اعشاری بدون هشدار به عدد دیگری تبدیل می‌شد و می‌توانست مبلغ، تعداد برگشت یا موجودی را تغییر دهد.
- ✅ `src/main/services/SalesService.ts`: validatorهای مشترک `validateReturnMutation`، `validateReturnUpdateMutation` و `validateExchangeMutation` قبل از هر side-effect شناسه‌ها، تعدادها و مبالغ را با `Number.isSafeInteger` و پیام فارسی رد می‌کنند؛ گردکردن ورودی برگشت/تعویض حذف شد.
- ✅ `src/shared/returnValue.ts`: `mergeReturnTargets` دیگر qty اعشاری/خارج از سقف امن را round یا قبول نمی‌کند.
- تست قبل روی کپی دست‌نخورده‌ی zip: `fix-s141-return-exchange-integer-validation.mjs` ⇒ **۰ موفق · ۹ ناموفق**.
- تست بعد: همان تست ⇒ **۹ موفق · ۰ ناموفق**.
- parser: `node --experimental-strip-types --check` روی `SalesService.ts` و `returnValue.ts` و `node --check` تست ⇒ PASS.
- رگرسیون کامل `tests/audit-fixes/*.mjs` با runner هارنس ⇒ **۱۰۶ فایل PASS · ۰ فایل FAIL**.
- محدودیت: تست S141 ساختاری/قراردادی روی harness است؛ Prisma Client تولیدی، typecheck واقعی، Electron/IPC/رندر واقعی، migration داده‌ی تاریخی، race چندپردازه‌ای، crash/قطع برق وسط تراکنش، timezone غیر Asia/Tehran و حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی اجرا نشدند.
- وضعیت خوشه E: validation عددی فروش/پرداخت/صندوق/نشست و اکنون برگشت/تعویض روی harness بسته‌تر شد؛ بازآزمایی تولیدی و validation کامل سایر کانال‌های IPC هنوز باز است. خوشه C همچنان فقط با تست یکپارچه ادامه یابد.
- نقطه‌ی دقیق ادامه: در محیط دارای npm/Prisma، گام ۰ و S136 تا S141 را روی Prisma واقعی اجرا کن؛ در نبود آن، ابتدا validation عددی سایر mutationهای IPC را با تست قبل/بعد بررسی کن و هیچ ادعای تولیدی نکن.

## نشست ۱۴۲ · S142 · خوشه E، validation عددی mutationهای باقی‌مانده‌ی Payment
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` با کد ۱۲۷ اجرا نشدند (npm/npx نیست، بدون اینترنت).
- baseline پیش از تغییر ⇒ `TOTAL=106 PASS=106 FAIL=0`.
- ✅ `SalesService.updatePayment`: شناسه/مبلغ/methodId با `assertSafeInteger` پیش از هر lookup؛ حذف `Math.round` مبلغ؛ رد methodId ناموجود با پیام فارسی.
- ✅ `deletePayment`/`setChequeStatus`: رد شناسه‌ی اعشاری/منفی با پیام «عدد صحیح».
- ✅ `overpayCreditIssue`: رد مبلغ اعشاری/منفی و شناسه‌ی نامعتبر (قبل: ۱۰۰٫۴ ⇒ اعتبار ۱۰۰ صادر می‌شد).
- ✅ `addPayment`: methodId غیرچک باید صحیح مثبت و موجود باشد (helper `assertPaymentMethodExists`).
- تست `tests/audit-fixes/fix-s142-payment-mutation-integer-validation.mjs`: قبل **۷ موفق · ۲۳ ناموفق**، بعد **۳۰ موفق · ۰ ناموفق**.
- رگرسیون کامل پس از رفع ⇒ `TOTAL=107 PASS=107 FAIL=0` 
- ⚠️ یافته‌ی باز P0 (بند ۴-۲۹، خوشه D): `issueManual`/`bulkIssueCredits` گیت رمز مدیر در main ندارند؛ رفع نشد، اولویت اول نشست بعد.
- ⚠️ اثبات Prisma واقعی/Electron/typecheck انجام نشد؛ تست روی harness SQLite است.
- نقطه‌ی ادامه: بند ۱۰-۱۱۵ در `HANDOFF-PROMPT-next.txt`.

## نشست ۱۴۳ · S143 · خوشه D (بند ۴-۲۹) + validation عددی اعتبار/کارت‌به‌کارت/انبارگردانی
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` اجرا نشدند (npm/npx نیست، بدون اینترنت).
- baseline پیش از تغییر ⇒ `TOTAL=107 PASS=107 FAIL=0`.
- ✅ S143-a: `creditIssue`/`creditBulkIssue` با `withSessionActor`؛ `issueManual` و `bulkIssueCredits` در main پیش از هر نوشتن `assertManagerPassword`؛ `CreditManagement.tsx` رمز را می‌فرستد. تست: قبل **۳/۱۶**، بعد **۱۶/۱۶**.
- ✅ S143-b: `issueStoreCredit`/`bulkIssueCredits` بدون گرد/clamp بی‌صدای مبلغ، تعداد، days، maxUses، minPurchase، maxPerTransaction. تست: قبل **۳/۲۰**، بعد **۲۰/۲۰**.
- ✅ S143-c: `CardTransferService` (create/pay/cancel/adjust) بدون گرد مبلغ و با رد شناسه‌ی اعشاری. تست: قبل **۱/۱۳**، بعد **۱۳/۱۳**.
- ✅ S143-d: `StockCountService.submit` دیگر NaN/خالی/اعشار را به صفر/گرد تبدیل نمی‌کند (کسری کاذب)؛ `Stocktake.tsx` ارقام فارسی را لاتین می‌کند. تست: قبل **۱/۱۲**، بعد **۱۲/۱۲**.
- تست‌های وابسته به‌روز شد: `fix-s61-overpay-credit.mjs`، `test/acceptance-db-session35.mjs` (۲۰۴/۲۰۴).
- رگرسیون کامل پس از رفع ⇒ `TOTAL=111 PASS=111 FAIL=0`.
- ⚠️ یافته‌ی باز P0: `cardTransferService.adjust` گیت رمز ندارد و pay/cancel/adjust با `withUser` صدا زده می‌شوند؛ رفع نشد.
- ⚠️ اثبات Prisma واقعی/Electron/typecheck انجام نشد؛ تست‌ها روی harness SQLite است.
- نقطه‌ی ادامه: بند ۱۰-۱۱۶ در `HANDOFF-PROMPT-next.txt`.

## نشست ۱۴۴ · S144 · گیت adjust کارت‌به‌کارت (بند ۴-۳۹/۴-۳۰) + validation عددی موجودی/قیمت کالا
- گام ۰: `node --version` ⇒ `v22.23.1`؛ `npm install`/`npx prisma generate`/`npm run typecheck` اجرا نشدند (npm/npx در sandbox نیست و sandbox دسترسی اینترنت ندارد).
- baseline پیش از تغییر روی zip نشست ۱۴۳ ⇒ `TOTAL=111 PASS=111 FAIL=0` (با مرجع هندآف می‌خواند).
- ✅ S144-a: `CardTransferService.adjust` پیش از تراکنش `assertPanelPassword(PANEL_KEYS.cardTransfers, …, 'ثبت رویداد اصلاحی کارت‌به‌کارت')` و scope در Audit (`approvedWith`)؛ IPC `cardTransferPay/Cancel/Adjust` با helper تازه‌ی `cardTransferActor` (= `withSessionActor` + خنثی‌سازی userName/shiftId/shiftName ارسالی renderer)؛ `stockCountSubmit` با `withOptionalSessionActor` + `userName: null`؛ `CardTransferPanel.tsx` فیلد رمز فرم اصلاحی و ارسال `managerPassword`. تست: قبل **۳/۲۵**، بعد **۲۵/۲۵**.
- ✅ S144-b: `InventoryService.setStock` و `apply` (increase/decrease/اصلاح) بدون گرد؛ اعشار/NaN/متن/خارج از سقف پیش از اولین نوشتن رد می‌شود (قبلاً 1e20 در کش موجودی نشست و NaN خطای NOT NULL خام می‌داد). `ProductService.upsert` قیمت فروش/خرید و موجودی هر واریانت را پیش از تراکنش می‌سنجد؛ `createVariantInTx` بدون Math.round. `ProductFormModal.tsx` و `StockAdjustModal.tsx` دیگر پیش از ارسال گرد نمی‌کنند. تست: قبل **۶/۲۸**، بعد **۲۸/۲۸**.
- تست‌های وابسته به‌روز شد: `fix-s143-card-transfer-integer-validation.mjs` (adjust معتبر با رمز)، `test/acceptance-src-session46.mjs` چک ۱۳ (۳۶/۳۶).
- رگرسیون کامل پس از رفع ⇒ `TOTAL=113 PASS=113 FAIL=0`. سوییت‌های قدیمی `test/*.mjs`: قبل و بعد یکسان ۱۲ PASS · ۵ FAIL (همان ۵ فایل پیش‌موجود، با خروجی یکسان).
- ⚠️ یافته‌ی باز P0: `IPC.stockAdjust` نه actor دارد نه گیت سمت سرور؛ `IPC.productUpsert` payload خام و بدون گیت تغییر قیمت/موجودی (بند ۴-۳۹)؛ `productDelete/productRestore` actor از payload. رفع نشد.
- ⚠️ اثبات Prisma واقعی/Electron/typecheck انجام نشد؛ تست‌ها روی harness SQLite است.
- نقطه‌ی ادامه: بند ۱۰-۱۱۷ در `HANDOFF-PROMPT-next.txt`.


## نشست ۱۴۵ (⚠️ ناتمام)
- baseline: رگرسیون TOTAL=113 PASS=113 FAIL=0؛ test/*.mjs ۱۲ PASS · ۵ FAIL؛ esbuild syntax ۱۳۲ OK؛ bundle هر سه OK.
- S145-a (P0 بند ۴-۳۹/۴-۳۰/۴-۳۳: stockAdjust، productUpsert، productPurge، actor delete/restore): فقط تست قبل (tests/pending/fix-s145-product-stock-gate.mjs ⇒ ۲۳ موفق · ۴۳ ناموفق) و آماده‌سازی InventoryService (export assertStockInteger + MovementContext.auditNote، سازگار با قبل). رفع src انجام نشد؛ طرح کامل در بند ۱۰-۱۱۸ هندآف.
- یافته‌ی تازه: IPC.productPurge بدون رمز و با actor جعلی (P0).
- بعد از تغییر: رگرسیون TOTAL=113 PASS=113 FAIL=0؛ test/*.mjs TOTAL=17 PASS=12 FAIL=5.


## نشست ۱۴۶
- ✅ S146 (بستن S145-a) · خوشه E/K · بند ۴-۳۹/۴-۳۰/۴-۳۳/۴-۴۰: گیت پنل کالاها سمت سرور برای اصلاح دستی موجودی، تغییر قیمت فروش/خرید یا موجودی واریانت موجود در ویرایش کالا و حذف همیشگی کالا؛ actor همه‌ی IPCهای کالا از نشست باز main؛ PRICE_EDIT برای قیمت خرید؛ بازسنجی race داخل تراکنش؛ UI سه صفحه با PasswordField و قفل پنل؛ فرم کالا موجودی دست‌نخورده را نمی‌فرستد.
- تست: tests/audit-fixes/fix-s145-product-stock-gate.mjs قبل ۲۳ موفق · ۴۳ ناموفق ⇒ بعد ۶۶ موفق · ۰ ناموفق. رگرسیون ۱۱۴/۱۱۴. test/*.mjs ۱۲/۱۷ (بدون تغییر).
- فایل‌های src تغییرکرده: ProductService.ts (گیت + امضای شیئی adjustStock + race + PRICE_EDIT خرید)؛ VariantPurgeService.ts (گیت purge)؛ ipc/index.ts (actor نشست)؛ StockAdjustModal.tsx، ProductFormModal.tsx، Products.tsx (رمز در UI).
- باز: فهرست بند ۱۰-۱۱۹ هندآف (validation باقی‌مانده، override قیمت فروش عادی، بازه‌ی تخفیف ۴-۲۶، عوارض صفر ۴-۴۵، خوشه C ناتمام).


## نشست ۱۴۷ · ⚠️ ناتمام (بدون تغییر src)
- گام ۰: npm/npx/typescript در sandbox نیست و اینترنت ندارد ⇒ npm install/prisma generate/typecheck اجرا نشد.
- baseline: رگرسیون ۱۱۴ PASS · ۰ FAIL؛ test/*.mjs ۱۷/۱۲/۵ (همان پنج)؛ esbuild ۱۳۲ OK؛ bundle سه BUNDLE-OK. با هندآف ۱۴۶ می‌خواند.
- S147-a (validation عددی SecondaryStockService + UI انبار مرکزی): فقط تحلیل کد و طرح دقیق رفع (بند ۱۰-۱۲۰ هندآف). رفع نشد؛ تست نوشته نشد.
- S147-b (یافته‌ی تازه P0، بند ۴-۳۹ و ۵): toStore گیت سمت سرور ندارد و IPCهای انبار مرکزی actor را از payload می‌گیرند. رفع نشد.
- خوشه‌ی E همچنان نیمه‌کاره؛ C: ⚠️ ناتمام، رفع تکه‌تکه‌ی این خوشه خطرناک است.

## نشست ۱۴۸ (⚠️ ناتمام — هیچ فایل src تغییر نکرد)
- baseline: ۱۱۴/۱۱۴، test/*.mjs ۱۷/۱۲/۵، esbuild ۱۳۲ OK، سه BUNDLE-OK (مثل ۱۴۷).
- S147-a: تست قبل نوشته شد (tests/pending/fix-s147-secondary-stock-integer-validation.mjs) ⇒ روی zip ۱۴۷: ۲۶ موفق · ۷۲ ناموفق. رفع src نیمه‌کاره به سقف خورد و برگردانده شد؛ پیش‌نویس: mahak-session148-draft-S147a.patch.
- S147-b و بقیه‌ی فهرست E/K: شروع‌نشده. نقطه‌ی ادامه: بند ۱۰-۱۲۱ هندآف.

## نشست ۱۴۹
- baseline روی zip ۱۴۸: ۱۱۴/۱۱۴، test/*.mjs ۱۷/۱۲/۵، esbuild ۱۳۲ OK، سه BUNDLE-OK (مثل ۱۴۸). تست pending S147-a ⇒ ۲۶ موفق · ۷۲ ناموفق (تأیید قبل).
- ✅ S147-a (خوشه E/K · بند ۳، ۴-۴۲، ۴-۲۸(د)): validation عددی سخت در SecondaryStockService (upsert، transfer، toStore/toStoreWithin، toStoreNewVariant پیش از رمز، coverShortage با rollback کل سند)، سقف ۲٬۱۴۷٬۴۸۳٬۶۴۷ روی ورودی و حاصل‌ها، export assertPriceInteger، parseGroupedInteger در shared/jalali، UI (SecondaryStock.tsx و NewStoreProductModal.tsx) بدون گرد کردن. تست: قبل ۲۶/۷۲ ⇒ بعد ۱۰۸/۰؛ منتقل به tests/audit-fixes.
- ✅ S147-b (بند ۴-۳۹ و ۵): گیت سمت سرور toStore با PANEL_KEYS.secondaryToStore (scope در note Audit، قفل خاموش OPEN)؛ actor همه‌ی ۷ IPC تغییردهنده‌ی انبار مرکزی از نشست main؛ PasswordField در مودال انتقال (fail-closed). تست tests/audit-fixes/fix-s147b-secondary-to-store-gate.mjs: قبل ۶/۳۲ ⇒ بعد ۳۸/۰. acceptance-db-session54 طبق S147-D5 مستند به‌روز شد (۹۴/۰).
- رگرسیون نهایی ۱۱۶/۱۱۶؛ test/*.mjs ۱۷/۱۲/۵ (خروجی ✗ پنج فایل با قبل بایت‌به‌بایت یکی)؛ esbuild ۱۳۲ OK؛ سه BUNDLE-OK.
- طبقه‌بندی پنج شکست قدیمی test/*.mjs (هیچ‌کدام رگرسیون src نیست؛ تست‌ها دست نخوردند): session25#16 و stock-source-display-session53 و stock-source-pick-session51 = رانش ساختاری (regex روی نام/colSpan قدیمی: applyCreditPrintCap(list)، summaryRowValues(r, stockSources.shortOf…)، colSpan={12})؛ acceptance-db-session36 = تست کهنه در برابر قاعده‌ی مقصد بند ۴-۱۲/۴-۱۳؛ acceptance-db-session47 (purge انتظار حذف SaleItemStockAllocation) = نیاز به تصمیم (append-only بند ۳/۲۲ در برابر purge دوساله).
- باز: PriceAdjustService.ruleOf (Math.round روی value/round/minPrice) + گیت main تغییر گروهی قیمت، PartyService ۲۹۲/۳۳۷، changeCredit*، override قیمت دستی فروش عادی، بازه‌ی تخفیف ۴-۲۶، عوارض صفر ۴-۴۵. C: ⚠️ ناتمام، رفع تکه‌تکه خطرناک است.

## نشست ۱۵۰
- ✅ S150-a: PriceAdjustService.ruleOf سخت + سقف قیمت حاصل و deltaTotal + گیت main و actor نشست برای apply/revert/editBatch/deleteBatches + UI PriceAdjust.tsx. تست tests/audit-fixes/fix-s150-price-adjust-rule-gate.mjs: قبل ۱۴/۶۰ ⇒ بعد ۷۴/۰.
- ✅ S150-b: PartyService.manualPurchaseTotal (create/update) + StoreCredit changeCreditAmount/changeCreditUses/changeCreditRestrictions/reactivateCredit/loadCredit + Settings.tsx و CreditPickers NumberField. تست tests/audit-fixes/fix-s150b-party-credit-integer-validation.mjs: قبل ۲۶/۴۲ ⇒ بعد ۶۸/۰.
- باز: actor قابل‌جعل (withUser) در IPCهای مدیریتی اعتبار (void/suspend/reactivate/expiry/amount/uses/holder/restriction/delete) و customerCreate/Update/Delete؛ override قیمت دستی فروش عادی + بازه‌ی تخفیف ۴-۲۶؛ عوارض صفر ۴-۴۵؛ گیت ثبت خرید/chargesSave/حذف مشتری دارای فاکتور؛ تصمیم session47.

## نشست ۱۵۱ (⚠️ ناتمام، بدون تغییر src)
- baseline سبز و منطبق با هندآف ۱۵۰: ۱۱۸/۱۱۸، ۱۷/۱۲/۵، ۱۳۲ OK، سه BUNDLE-OK.
- یافته‌های تازه Y1 تا Y9 (فقط خواندن کد): گیت نداشتن setAccountingPolicy (بند ۴-۲۹)، discountPolicySave و creditSettingsSet؛ enforce نشدن قیمت/تخفیف در create/update (بند ۴-۲۶)؛ deleteCustomer غیراتمیک و بی‌گیت؛ Audit بی‌actor در createCustomer؛ حذف فیزیکی اعتبار بی‌مصرف؛ بازمحاسبه نشدن عوارض در main؛ فهرست کامل کانال‌های withUser. متن کامل و طرح رفع S151-a/b/c در بند ۱۰-۱۲۴ هندآف.
- وضعیت خوشه‌ها: E/K ⚠️ ناتمام؛ C ⚠️ ناتمام، رفع تکه‌تکه خطرناک است؛ بقیه بدون تغییر.

## نشست ۱۵۲
- ✅ S151-a (آیتم ۲ + Y6 مشتری): شانزده کانال اعتبار و customerCreate/Update/Delete با withOptionalSessionActor؛ createCustomer هر دو Audit CUSTOMER_CREATE با userId. تست tests/audit-fixes/fix-s151-credit-customer-session-actor.mjs: قبل ۲۳/۴۰ ⇒ بعد ۶۳/۰. سه کانال چاپ/PDF فقط چک ساختاری (نبود BrowserWindow واقعی).
- ⚠️ S151-b فقط تست قبل: tests/pending/fix-s151b-sale-price-override-discount-range.mjs ⇒ ۲۶/۴۰؛ Y1 تا Y4 اثبات شد.
- یافته‌های تازه: Y10 (P0، settingsSaveBundle بی‌گیت discountPolicy/securityConfig/saleDefaults/shiftConfig/officialTime/عوارض را می‌نویسد) و Y11 (گرد تخفیف ردیف POS پس از کوتاه‌شدن با سقف).
- رگرسیون ۱۱۹/۱۱۹؛ test/*.mjs ۱۷/۱۲/۵؛ esbuild ۱۳۲ OK؛ BUNDLE-OK 1629938/33857/2016682. تصمیم‌ها S152-D1 تا S152-D5 (در نشست ۱۵۳ کامل در DECISIONS.md ثبت شد).

## نشست ۱۵۳ (⚠️ ناتمام، بدون تغییر src)
- baseline روی zip ۱۵۲ سبز و منطبق با هندآف: ۱۱۹/۱۱۹، ۱۷/۱۲/۵، ۱۳۲ OK، BUNDLE-OK 1629938/33857/2016682. تأیید قبل S151-b ⇒ ۲۶/۴۰.
- کار نیمه‌تمام نشست ۱۵۲ بسته شد: S152-D1 تا S152-D5 کامل در DECISIONS.md و جزئیات ۱۵۲ در PROGRESS/TESTLOG.
- جزئیات تکمیلی طرح S151-b با شماره‌ی خط، تصمیم‌های S153-D1 تا S153-D7 و یافته‌ی تازه‌ی Y12 (shiftId ارسالی رندرر در SalesService.create) در بند ۱۰-۱۲۶ هندآف.
- tools/run-regression.sh: رگرسیون موازی (حدود ۱ تا ۲ دقیقه).
- وضعیت خوشه‌ها: E/K ⚠️ ناتمام؛ C ⚠️ ناتمام؛ بقیه بدون تغییر.

## نشست ۱۵۴
- ✅ S151-b: گیت قیمت دستی و بازه‌ی تخفیف سمت سرور در SalesService.create/update (preverifySalePolicy، Audit SALE_PRICE_OVERRIDE داخل تراکنش، FraudService)؛ رمز مدیر setAccountingPolicy، رمز پنل saveDiscountPolicy/saveCreditSettings/saveBundle(discount)؛ actor نشست در شش کانال IPC؛ UI با کادر رمز fail-closed. تست fix-s151b: قبل ۲۷/۴۴ ⇒ بعد ۷۱/۰.
- رگرسیون ۱۲۰/۱۲۰؛ test/*.mjs ۱۷/۱۲/۵؛ esbuild ۱۳۲ OK؛ BUNDLE-OK 1644313/33857/2019970.
- باقی: S151-c1 (گیت‌ها)، S151-c2 (عوارض صفر + Y8)، Y12. وضعیت خوشه‌ها: E/K ⚠️ ناتمام؛ C ⚠️ ناتمام.

## نشست ۱۵۵
- zip ورودی = zip ۱۵۴ + زنجیره‌ی ممیزی ۶۹ تا ۱۴۲ (tests/audit ۷۹ تست، جزو رگرسیون اجباری).
- ✅ S151-c1: گیت رمز saveCharge (کلید پنل عوارض/حق سرویس هر اسکوپ)، saveBundle بر اساس تغییر واقعی (security/shift/time ⇒ رمز مدیر؛ saleDefaults فیلدبه‌فیلد؛ charges ⇒ رمز پنل)، گیت ثبت/ویرایش خرید (PANEL_KEYS.purchase)، حذف مشتری (بدهکار ⇒ رد؛ باقی ⇒ رمز پنل تنظیمات + Audit اتمیک)، actor نشست در chargesSave/purchaseCreate/purchaseUpdate، کادرهای رمز UI (Settings، CategoryCharges، PurchaseInvoice، AutoCentralPasswordBox تازه در Pos/SalesInvoice/SecondaryStock). تست fix-s151c-gates قبل ۲۹/۴۷ ⇒ بعد ۷۶/۰.
- رگرسیون ۱۲۱/۱۲۱؛ ۱۷/۱۲/۵؛ esbuild 143 OK؛ BUNDLE-OK 1719880/33857/2051621؛ tests/audit ۷۹/۷۹. تصمیم‌ها S155-D1 تا D5 (در نشست ۱۵۷ کامل در DECISIONS.md ثبت شد).
- یافته‌های تازه: Y13، Y14، Y15.

## نشست ۱۵۶
- zip ورودی = zip ۱۵۵ + ممیزی ۱۴۲ تا ۱۴۵ (tests/audit ۸۳ تست). baseline ۱۲۱/۱۲۱، ۱۷/۱۲/۵، 143 OK، tests/audit ۸۳/۸۳.
- ✅ S151-c2 (بند ۴-۴۵ + Y8): charges.ts قانون value=0 = «عمداً صفر»؛ cleanCharge صفر را نگه می‌دارد؛ CategoryCharges.tsx دکمه‌های «عمداً صفر» و «حذف مقدار (ارث)»؛ SalesService.preverifySaleCharges (بازمحاسبه از تنظیمات و دسته‌ی واقعی کالا، تحمل ۱ ریال/ردیف؛ خرده ⇒ رد کامل؛ عمده ⇒ کاهش با رمز مدیر، افزایش بی‌رمز، Audit SALE_CHARGE_OVERRIDE؛ ویرایش با مقدار ذخیره‌شده ⇒ بدون بازمحاسبه)؛ FraudService؛ کادر رمز در SalesInvoice.tsx. تست fix-s151c2-charges قبل ۱۸/۲۶ ⇒ بعد ۴۴/۰.
- ✅ Y12: SalesService.create ⇒ shiftId = شیفت باز لحظه‌ی ثبت؛ shiftId متفاوت ⇒ رد فارسی. تست fix-y12-sale-shift قبل ۶/۴ ⇒ بعد ۱۰/۰.
- رگرسیون ۱۲۳/۱۲۳؛ ۱۷/۱۲/۵؛ esbuild 143 OK؛ BUNDLE-OK 1738711/33857/2054047؛ tests/audit ۸۳/۸۳. تصمیم‌ها S156-D1 تا D7 (در نشست ۱۵۷ کامل در DECISIONS.md ثبت شد). یافته‌ی تازه Y16.

## نشست ۱۵۷
- ✅ گام ۲: تصمیم‌های ۱۵۵/۱۵۶ کامل ثبت شد.
- ✅ Y13: رمز مدیر saveOfficialTime/setShiftByTime، رمز پنل stocktake برای یادآوری، actor نشست، کادر رمز UI. تست fix-y13 قبل ۱۱/۲۰ ⇒ بعد ۳۱/۰.
- ⚠️ Y14/Y16 و یافته‌ی تازه‌ی Y17 فقط تست قبل (tests/pending/fix-y14-y16-exchange-pricing.mjs ۳/۳۹)؛ طرح در بند ۱۰-۱۳۰ هندآف.

## نشست ۱۵۸
جزئیات کامل در بند ۱۰-۱۳۱ هندآف؛ Y14/Y16/Y17 رفع (۳/۳۹ ⇒ ۴۲/۰)، Y15 تست قبل ۱۰/۱۰ و patch آماده.

## نشست ۱۵۹
- baseline روی zip ۱۵۸ (TESTLOG-s159-baseline.txt): audit-fixes ۱۲۵/۱۲۵، ۱۷/۱۲/۵، 143 OK، BUNDLE-OK 1748627/33857/2058806، tests/audit ۸۳/۸۳ ⇒ رگرسیون کامل پس از S158-D6 تأیید شد.
- ✅ تصمیم‌های S157-D1..D3 و S158-D1..D6 با قالب کامل در DECISIONS.md.
- ✅ Y15 (بند ۴-۱۳): enums.allowedDestinationsFor(CASH)=[CASH]؛ assertDestination پیام «برداشت از صندوق». فقط دو hunk patch آماده (S159-D1). تست fix-y15-cash-destination (منتقل به audit-fixes) قبل ۱۰/۱۰ ⇒ بعد ۲۰/۰.
- ✅ پنج تست کهنه به‌روز شدند (S159-D2..D4): session36 ۱۲۸/۰، session47 ۹۹/۰، session25 ۳۲/۰، display53 ۶۰/۰، pick51 ۱۰۸/۰.
- یافته‌ی تازه Y18 (S159-D5).
- رگرسیون نهایی: audit-fixes ۱۲۶/۱۲۶؛ test/*.mjs ۱۷/۱۷/۰ (اولین بار)؛ esbuild 143 OK؛ BUNDLE-OK 1750082/33857/2058778؛ tests/audit ۸۳/۸۳.

## نشست ۱۶۰
جزئیات کامل در HANDOFF-PROMPT-next.txt بند ۱۰-۱۳۳: Y7 ✅ (fix-y7 ۱۰/۱۳ ⇒ ۲۳/۰)، Y9 باقی‌مانده ✅ (fix-y9 ۴/۶ ⇒ ۱۰/۰)، session35/session21 به قاعده‌ی ۴-۲۲ به‌روز (S160-D1)، Y18 pending (۶/۲۲). رگرسیون: ۱۲۸/۱۲۸، ۱۷/۱۷، 143 OK، ۸۳/۸۳.

## نشست ۱۶۱
جزئیات کامل در HANDOFF-PROMPT-next.txt بند ۱۰-۱۳۴: S160-D1..D4 کامل ثبت؛ Y18 ✅ (fix-y18 ۶/۲۳ ⇒ ۲۹/۰)؛ Y19 تازه ✅ (fix-y19 ۴/۹ ⇒ ۱۳/۰)؛ session36 بند ۹ به‌روز (S161-D4). رگرسیون: ۱۳۰/۱۳۰، ۱۷/۱۷، 143 OK، tests/audit ۸۲/۸۳ (⚠️ audit-a108-01 FAIL، باز).

## نشست ۱۶۲
- گام ۰ ⇒ اجرا نشد، دلیل: npm/npx/typescript در sandbox نیست و sandbox دسترسی اینترنت ندارد (فقط node 22).
- baseline روی zip ۱۶۱ (TESTLOG-s162-baseline.txt): audit-fixes ۱۳۰/۱۳۰، test/*.mjs ۱۷/۱۷، esbuild 143 OK، BUNDLE-OK 1758142/33857/2059928، tests/audit ۸۲/۸۳ (فقط audit-a108-01) ⇒ منطبق با هندآف ۱۶۱.
- ✅ audit-a108-01 (S162-D1): فقط انتظار کهنه بود؛ drill سه ردیف تازه درست است. تست به‌روز و گسترش یافت ۱۹/۲ ⇒ ۳۴/۰؛ جهش ⇒ ۱۹/۹، ۳۲/۲، ۳۱/۳. Y18 و Y19 حالا کاملاً بسته‌اند.
- ✅ خوشه C: تست یکپارچه‌ی tests/audit-fixes/fix-s162-c-integrated-chain.mjs (S162-D2) ساخته شد و یافته‌ی تازه‌ی Y20 را نشان داد.
- ✅ Y20 (S162-D4): نسیه‌ی وصول‌نشده‌ی بازه‌ی گذشته «در پایان بازه» (invoiceDebt.ts + accountingReport.ts). قبل ۶۷/۲۴ ⇒ بعد ۹۱/۰.
- S162-D3: اضافه‌دریافت روی فاکتور دوره‌ی قبل در «وصول نسیه‌ی دوره‌ی قبل» می‌ماند (طراحی ۵۸ · C4 حفظ شد؛ ریسک کم نمایشی).
- رگرسیون نهایی: audit-fixes ۱۳۱/۱۳۱، test/*.mjs ۱۷/۱۷، 143 OK، BUNDLE-OK 1759963/33857/2059928 (۰ هشدار)، tests/audit ۸۳/۸۳.

## نشست ۱۶۳ (در نشست ۱۶۴ ثبت شد)
- گام ۰ ⇒ اجرا نشد، دلیل: npm/npx/typescript در sandbox نیست و sandbox دسترسی اینترنت ندارد (فقط node 22).
- baseline روی zip ۱۶۲ (TESTLOG-s163-baseline.txt): ۱۳۱/۱۳۱، ۱۷/۱۷، 143 OK، BUNDLE-OK 1759963/33857/2059928، tests/audit ۸۳/۸۳.
- ✅ تست یکپارچه‌ی گسترش خوشه C (S163-D1): tests/pending/fix-s163-c-integrated-ext.mjs، ۱۰۳ بررسی؛ روی کد ۱۶۲ ⇒ ۸۹/۱۴.
- یافته‌های تازه: Y21 (P0، دوبارشماری وصول نسیه‌ی دوره‌ی قبل در نقد مورد انتظار و خالص وجه واقعی) و Y22 (P1، بند ۴-۵۲ پیاده نشده). هیچ فایل src تغییر نکرد.

## نشست ۱۶۴
- گام ۰ ⇒ اجرا نشد، دلیل: npm/npx/typescript در sandbox نیست و sandbox دسترسی اینترنت ندارد (فقط node v22.23.1).
- baseline روی zip ۱۶۳ پیش از هر تغییر (TESTLOG-s164-baseline.txt): audit-fixes ۱۳۱/۱۳۱، test/*.mjs ۱۷/۱۷، esbuild 143 OK، BUNDLE-OK 1759963/33857/2059928، tests/audit ۸۳/۸۳، tests/pending/fix-s163 ⇒ ۸۹/۱۴ ⇒ کاملاً منطبق با هندآف ۱۶۳.
- ✅ S163-D1..D3 با قالب کامل در DECISIONS.md؛ تصمیم‌های تازه S164-D1..D6.
- ✅ Y21 (S163-D2 + S164-D1/D3): src/shared/accounting.ts ⇒ calculateCashClose بدون priorCashSettlements (فیلد نمایشی priorCashSettlementsIncluded)، calculateCashStatement.netCashMovement بدون priorCreditSettlements؛ CashboxService ⇒ cardExpected بدون settledPriorCard + docblockها؛ CashClose.tsx ⇒ ردیف «وصول نسیه‌ی دوره‌ی قبل — سهم نقد» از فرمول + به ردیف‌های فقط نمایشی با برچسب «داخل نقد دریافتی» رفت (برگه‌ی چاپی هم)؛ AccountingBlocks.tsx ⇒ همان ردیف بلوک ۶ با sign=0.
- ✅ Y22 (S163-D3 + S164-D4/D5/D6): SalesService.ts ⇒ chequePolicyAfterReturn (انتهای runReturn، پس از recalcSettlement؛ remainingBefore>0 و remainingAfter≤0 ⇒ void خودکار + Audit VOID؛ وگرنه Audit CHEQUE_STATUS با needsManagerReview)، restoreChequesAfterReturnVoid (returnDelete ⇒ چک خودکارباطل‌شده‌ی همان سند برمی‌گردد + Audit)، chequeReviewNotes (علامت مشتق) در payments() (chequeNeedsReview/chequeReviewNote/chequeReviewCount) و chequeList؛ types.ts فیلدهای اختیاری؛ UI: نشان کهربایی در InvoicePaymentsModal، برچسب ستون در ReportExtraTables، پسوند «⚠️ نیاز به بازبینی» در چاپ/Excel تب چک.
- ✅ تست یکپارچه به tests/audit-fixes/fix-s163-c-integrated-ext.mjs منتقل و با بند «م» (وصول کارتی دوره‌ی قبل و چک قدیمی CASH پاس‌شده) گسترش یافت: قبل ۸۹/۱۴ ⇒ بعد ۱۲۳/۰. جهش: برگرداندن accounting.ts + CashboxService.ts ⇒ ۱۱۷/۶؛ برگرداندن SalesService.ts ⇒ ۱۱۲/۱۱.
- ✅ خوشه C روی هارنس «کامل» اعلام شد.
- رگرسیون نهایی (TESTLOG-s164-regression.txt): audit-fixes ۱۳۲/۱۳۲، test/*.mjs ۱۷/۱۷، esbuild 143 OK · 0 FAIL، BUNDLE-OK main 1770245 / preload 33857 / renderer 2062525، ۰ هشدار؛ tests/audit ۸۳/۸۳.

## نشست ۱۶۵
- baseline منطبق با هندآف ۱۶۴: ۱۳۲/۱۳۲، ۱۷/۱۷، 143 OK، BUNDLE 1770245/33857/2062525، tests/audit ۸۳/۸۳. گام ۰ اجرا نشد (npm/typescript/شبکه نیست).
- ✅ Y23 بررسی و قطعی شد (اثر امروز صفر) + اصلاح دفاعی accountingReport.paymentStatement (S165-D1). تست fix-y23-settled-current.mjs.
- ✅ S153-D6 رفع شد: SalesService.preverifySalePolicy + select qty در update (S165-D2/D3). تست fix-s165-edit-qty-price-reference.mjs (قبل ۱۰/۹، بعد ۱۹/۰).
- ✅ staffSave بی‌رمز رفع شد: StaffService.save + Settings.tsx (S165-D4/D5). تست fix-s165-staff-save-gate.mjs (قبل ۴/۱۳، بعد ۱۷/۰).
- رگرسیون: audit-fixes ۱۳۵/۱۳۵، test ۱۷/۱۷، 143 OK، BUNDLE 1772636/33857/2063493 (۰ هشدار)، tests/audit ۸۳/۸۳.

## نشست ۱۶۶
- گام ۰ اجرا نشد (npm/npx/typescript در sandbox نیست، دسترسی اینترنت ندارد؛ فقط node v22). baseline روی zip ۱۶۵ کاملاً منطبق: ۱۳۵/۱۳۵، ۱۷/۱۷، 143 OK، BUNDLE-OK 1772636/33857/2063493، tests/audit ۸۳/۸۳.
- ✅ dismiss یادآوری انبارگردانی بی‌رمز بسته شد (S166-D1..D3): StocktakeReminderService.ts، ipc/index.ts، StocktakeReminderBadge.tsx. تست fix-s166-stocktake-dismiss-gate.mjs: قبل ۹/۱۱ ⇒ بعد ۲۰/۰.
- ✅ posPrintToggle فقط UI بسته شد (S166-D4..D6): SettingsService.ts، Pos.tsx. تست fix-s166-print-toggle-gate.mjs: قبل ۹/۱۱ ⇒ بعد ۲۰/۰. fix-s151c-gates فقط setup (۷۶/۰).
- S166-D7: تنظیمات کهنه ⇒ ریسک باقی‌مانده (fail-closed).
- S162-D3 شروع نشد (فقط بررسی: طرح پیشنهادی در هندآف).
- رگرسیون نهایی: audit-fixes: TOTAL=137 PASS=137 FAIL=0 · legacy: TOTAL=17 PASS=17 FAIL=0 · esbuild syntax: 143 OK · 0 FAIL · BUNDLE main 1775548 / preload 33857 / renderer 2067106 · tests/audit 83/83

## نشست ۱۶۷
- گام ۰ اجرا نشد (npm/npx/typescript در sandbox نیست، دسترسی اینترنت ندارد؛ فقط node v22 و esbuild). baseline روی نسخه‌ی دست‌نخورده‌ی zip ۱۶۶ کاملاً منطبق: ۱۳۷/۱۳۷، ۱۷/۱۷، 143 OK، BUNDLE-OK 1775548/33857/2067106، tests/audit ۸۳/۸۳.
- ✅ S162-D3 (S167-D1): accounting.ts، types.ts، accountingReport.ts، AccountingBlocks.tsx. تست fix-s167-prior-overpay-label.mjs: قبل ۹/۹ ⇒ بعد ۱۸/۰؛ عددهای پل قبل/بعد یکسان؛ جهش ⇒ ۱۳/۵.
- ✅ Y11 (S167-D2): priceAdjust.ts (scaleLineDiscounts)، Pos.tsx. تست fix-s167-y11-line-discount-scale.mjs: قبل ۳/۵ ⇒ بعد ۱۶/۰؛ جهش ⇒ ۱۱/۵.
- ✅ S153-D5/هم‌رده‌ی S165-D2 (S167-D3): SalesInvoice.tsx. تست fix-s167-invoice-price-pw-box.mjs: قبل ۶/۶ ⇒ بعد ۱۲/۰.
- شروع‌نشده: ذخیره‌ی کهنه‌ی Settings.tsx روی printEnabled/autoCentralWithdraw (فقط بررسی؛ طرح در هندآف).
- رگرسیون نهایی: audit-fixes ۱۴۰/۱۴۰، test ۱۷/۱۷، 143 OK، BUNDLE 1776920/33857/2069578 (۰ هشدار). tests/audit پس از رفع اجرا نشد (دلیل: سقف اجرای نشست)؛ قبل از رفع ۸۳/۸۳.

## نشست ۱۶۸
- گام ۰ اجرا نشد (npm/npx/typescript در sandbox نیست، دسترسی اینترنت ندارد؛ فقط node v22 و esbuild sandbox). baseline روی نسخه‌ی دست‌نخورده‌ی zip ۱۶۷ کاملاً منطبق: ۱۴۰/۱۴۰، ۱۷/۱۷، 143 OK، BUNDLE 1776920/33857/2069578، tests/audit ۸۳/۸۳ (بدهی tests/audit نشست ۱۶۷ پاک شد).
- ✅ ذخیره‌ی کهنه‌ی Settings.tsx (S168-D1): receipt.ts (mergeFreshPosToggles)، Settings.tsx. تست fix-s168-settings-stale-pos-toggles.mjs: قبل ۱۰/۹ ⇒ بعد ۲۳/۰؛ جهش ⇒ ۲۰/۳.
- ✅ تنظیمات کهنه در صفحه‌ی باز فروش (S168-D2، S166-D7): receipt.ts (withFreshSale)، Pos.tsx، hooks/useAutoCentralWithdraw.ts. تست fix-s168-pos-stale-sale-toggles.mjs: قبل ۶/۱۰ ⇒ بعد ۱۹/۰؛ جهش ⇒ ۱۴/۵.
- ⚠️ ناتمام S168-D3 (خرید اعشاری): فقط تست قبل tests/pending/fix-s168-purchase-integer-lines.mjs (۱۰/۱۳)؛ src دست نخورده.
- رگرسیون نهایی: audit-fixes ۱۴۲/۱۴۲، test ۱۷/۱۷، 143 OK، BUNDLE 1776920/33857/2070202 (۰ هشدار)، tests/audit ۸۳/۸۳.

## نشست ۱۶۹
- baseline منطبق (۱۴۲/۱۷/143/BUNDLE/۸۳). ✅ S168-D3 خرید اعشاری (۲۳/۰). ✅ S169-D2 کد ثابت واریانت (۱۶/۰). ✅ S169-D3 Audit apply در تراکنش (۱۴/۰). 🔎 S169-D4 یادداشت S61 پل: تحلیل و طرح، رفع نشد. رگرسیون: ۱۴۵/۱۴۵، ۱۷/۱۷، 143 OK، BUNDLE 1778442/33857/2070202، tests/audit ۸۳/۸۳.

## نشست ۱۷۰
- گام ۰: npm install / prisma generate / typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و اینترنت ندارد. baseline روی کپی دست‌نخورده‌ی zip ۱۶۹: audit-fixes ۱۴۵/۱۴۵، legacy ۱۷/۱۷، esbuild 143 OK، BUNDLE 1778442/33857/2070202 ⇒ منطبق.
- ✅ S169-D4 / یادداشت S61 خوشه D بسته شد (S170-D1): src/main/services/accountingReport.ts ⇒ storeCreditBridgeSplit (سند‌دار/بی‌سند/باقی‌مانده)، ردیف پل = issuedBacked، drill-down همان predicate، hint و notes. src/shared/accounting.ts و types.ts فقط فیلد اختیاری افزایشی. تست tests/audit-fixes/fix-s170-bridge-unbacked-credit.mjs: قبل ۱۵/۱۵ ⇒ بعد ۳۰/۰؛ جهش‌ها ۱۶/۱۴، ۲۳/۷، ۲۷/۳. فرضیه‌ی (۳) باقی‌مانده با تست اثبات شد (پل ۶۰۰٬۰۰۰ باز بود).
- ⚠️ ناتمام S170-D3 (متن hint باقی‌مانده‌ی OVERPAY، P3).
- رگرسیون: audit-fixes ۱۴۶/۱۴۶، legacy ۱۷/۱۷، esbuild 143 OK، BUNDLE 1784528/33857/2070202 (۰ هشدار)؛ tests/audit: نتیجه در TESTLOG-s170-audit.txt.


## نشست ۱۷۱
- گام ۰: npm install / npx prisma generate / npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و دسترسی اینترنت ندارد (فقط node v22 و esbuild). baseline روی کپی دست‌نخورده‌ی zip ۱۷۰: audit-fixes ۱۴۶/۱۴۶، legacy ۱۷/۱۷، esbuild 143 OK، BUNDLE 1784528/33857/2070202 ⇒ کاملاً منطبق.
- ✅ S170-D3 بسته شد (S171-D1): src/main/services/accountingReport.ts (storeCreditBridgeSplit ⇒ overpayRemainder، hint overpayReceived، notes)، src/shared/accounting.ts و src/shared/types.ts (فیلد اختیاری افزایشی). تست tests/audit-fixes/fix-s170b-overpay-remainder-hint.mjs (از tests/pending منتقل و کامل شد + سناریوی ۳): قبل ۹/۲ (نسخه‌ی اولیه) و ۱۲/۶ (با سناریوی ۳) ⇒ بعد ۲۱/۰؛ کد نشست ۱۷۰ با تست نهایی ۱۵/۶؛ جهش ۱۵/۳، ۱۲/۶، ۱۸/۳.
- ✅ AUDIT-PROGRESS ردیف ۱۲۲ مشاهده‌ی باز P3 بسته شد (S171-D2): src/main/services/SalesService.ts، accountingReport.ts، SalesLedger.ts. تست tests/audit-fixes/fix-s171-cancelled-status-statements.mjs: قبل ۱۰/۱۳ ⇒ بعد ۲۳/۰؛ جهش ۱۶/۷، ۱۹/۴، ۲۰/۳، ۲۱/۲.
- ✅ AUDIT-PROGRESS ردیف ۱۳۶: جدول با وضعیت واقعی هماهنگ شد (audit-s136-period-lock-verify ۲۵/۰ دوباره اجرا شد؛ گیت‌ها در addPayment/updatePayment/deletePayment/setChequeStatus موجودند). src دست نخورد.
- ✅ AUDIT-PROGRESS ردیف ۱۳۴ (P3، فقط تست؛ S171-D3): tests/audit-fixes/fix-s121-report-export-page-warning.mjs ⇒ process.exit(process.exitCode ?? 0). تست tests/audit-fixes/fix-s171-s121-bridge-exitcode.mjs: قبل ۲/۱ ⇒ بعد ۳/۰.

## نشست ۱۷۲
- گام ۰: npm install / npx prisma generate / npm run typecheck ⇒ اجرا نشد، دلیل: npm/npx و typescript در sandbox نیست و دسترسی اینترنت ندارد (فقط node v22 و esbuild). baseline روی کپی دست‌نخورده‌ی zip ۱۷۱ (TESTLOG-s172-baseline.txt): audit-fixes ۱۴۹/۱۴۹، legacy ۱۷/۱۷، esbuild 143 OK، BUNDLE 1791276/33857/2070202، tests/audit ۸۳/۸۳ ⇒ کاملاً منطبق.
- ✅ سه خط کهنه‌ی AUDIT-PROGRESS (۱۴۰ withUser برگشت، ۱۴۱ سیاست تخفیف جایگزین تعویض، ۱۴۲ allowedDestinationsFor(CASH)) با کد تطبیق و خط‌خورده شدند (S172-D1). تست tests/audit/audit-s172-stale-observations-verify.mjs ۱۴/۰ از مسیر IPC واقعی؛ جهش‌ها ۱۱/۳، ۱۰/۴، ۱۳/۱. src دست نخورد.
- ✅ ردیف ۱۳۲ (P3): بررسی شد؛ محدودیت API Electron، رفع بی‌ریسک ندارد ⇒ رها (S172-D2). src دست نخورد.
- ✅ ریسک باقی‌مانده‌ی S170 (drill اعتبار سند‌دار با IN بی‌سقف) ⇒ ایراد واقعی، رفع شد (S172-D3): src/main/services/accountingReport.ts (فقط شاخه‌ی storeCreditIssued در bridgeSources). تست tests/audit-fixes/fix-s172-bridge-drill-in-chunk.mjs قبل ۱۱/۱۵ ⇒ بعد ۲۶/۰؛ جهش ۲۱/۵، ۲۵/۱، ۲۰/۶. fix-s108 (ساختاری) alternation افزایشی گرفت (S172-D5).
- ریسک S170 «اعتبار تعویضی تاریخی بی‌returnId» ⇒ عمداً «بی‌سند» با مبلغ در notes (S172-D4). هشدار دوگانه‌ی S171-D2 عمدی (S172-D6).
- رگرسیون: audit-fixes ۱۵۰/۱۵۰، legacy ۱۷/۱۷، esbuild 143 OK، BUNDLE 1791347/33857/2070202 (۰ هشدار)، tests/audit ۸۴/۸۴.

## نشست ۱۷۳
- ✅ S173-D1: chunk ۵۰۰تایی جزئیات صفحه‌ی drill پرداختی پل (accountingReport.paymentDrill).
- ✅ S173-D2: خطای drill پل ⇒ page.failed + هشدار فارسی با مبلغ ردیف (accountingReport.bridgeSources/buildStatements، types.SaleReportPage.failed).
- ✅ S173-D4: وصول دوره‌ی قبل دفتر رویداد مصرف اعتبار را پیش از take/count کنار می‌گذارد (SalesLedger).
- ✅ S173-D5: نوار «باطل شده — غیرقابل استفاده» روی سند چاپی اعتبار باطل (templates.creditDocBody، PrintService.creditDocDataFor).
- ⏳ S173-D3: in بی‌سقف storeCreditScopes (تا ۲۰٬۰۰۰) — باز، برنامه در HANDOFF بند ۱۰-۱۴۶.
- رگرسیون: audit-fixes ۱۵۳/۱۵۳، legacy ۱۷/۱۷، esbuild 143 OK، tests/audit ۸۴/۸۴. گام ۰ اجرا نشد (نبود npm/شبکه).

## نشست ۱۷۴
- ✅ S173-D3: storeCreditScopes حل دسته‌ای شناسه (scopedIds/issuedIds/redemptionIds) + جمع/شمارش/صفحه روی دسته‌های ۵۰۰تایی (accountingReport.storeCreditStatement/storeCreditBridgeSplit/bridgeSources، SalesLedger بخش مصرف اعتبار).
- ✅ invoiceDebt.debtAdjustmentsByInvoice: c2cIds دسته‌ای ۵۰۰تایی.
- ✅ «پاسخ کهنه» OutOfShiftPanel/CardTransferPanel/OverrideSessionsPanel/MovementsModal با گیت مشترک src/shared/latestRequest.ts.
- ⏳ S174-D5: notIn بی‌سقف notVoided — باز، برنامه در HANDOFF بند ۱۰-۱۴۷.
- رگرسیون: audit-fixes ۱۵۶/۱۵۶، legacy ۱۷/۱۷، esbuild 144 OK، BUNDLE 1796942/33857/2072233، tests/audit ۸۴/۸۴. گام ۰ اجرا نشد (نبود npm/شبکه).

## نشست ۱۷۵
کار نشست ۱۷۵ (همه با قاعده‌ی سقف IN ۵۰۰ گزارش‌ها، S99-2؛ همه‌ی تست‌ها spy سقف ۵۰۰ و کلید S175_NO_CAP=1 دارند که ثابت می‌کند اعداد مورد انتظار همان خروجی کد قبلی بدون سقف است):
- ✅ S174-D5 (رفع شد): notVoided (id notIn همه‌ی اعتبارهای برگشت باطل‌شده‌ی بازه) از همه‌ی where ها حذف شد. storeCreditScopes حالا voidedSet می‌سازد؛ baseWhere تابع creditIdsForReportScope فقط بازه است و خروجی‌اش در JS از باطل‌ها پاک می‌شود (پیش از سنجش ID_LIST_CAP)؛ اگر باطلی در بازه هست issuedIds همیشه آرایه‌ی صریح است (بدون فیلتر: findMany id روی issuedWhere بازه) منهای باطل‌ها، یکتا و id نزولی. issuedOverpay = { ...issuedWhere, source: OVERPAY } روی issuedIds. فیلد notVoided از خروجی storeCreditScopes حذف شد. بدون اعتبار باطل در بازه مسیر قبلی دست‌نخورده. تست tests/audit-fixes/fix-s175-voided-credit-notin.mjs (۵۲۰ اعتبار CANCELED با برگشت باطل + ۶ اعتبار معتبر؛ پل بی‌فیلتر، کارمند الف، کارمند ب، drill صادرشده) قبل ۷/۳۰ ⇒ بعد ۳۷/۰؛ بدون سقف روی کد قبلی ۳۴/۳ (فقط چک‌های سقف). جهش‌ها: باطل کنار گذاشته نشود ۳۱/۶، issuedIds بی‌فیلتر null بماند ۳۱/۶، issuedOverpay بدون issuedIds ۳۶/۱؛ حذف فیلتر دفاعی مسیر فیلتردار ۳۷/۰ (زنده، چون creditIdsForReportScope خودش اعتبار برگشت باطل را رد می‌کند؛ عمداً دفاعی نگه داشته شد).
- ✅ S175-D2 (ایراد واقعی تازه، رفع شد): salesService.purge (ابطال گزارش فروش) — تراکنش ابطال همه‌ی شناسه‌های بازه را بی‌سقف در in می‌گذاشت (saleReturn.findMany، دفتر مصرف اعتبار، اعتبارهای مرتبط returnId/sourceInvoiceId/exchangeInvoiceId، updateMany اعتبار/برگشت/پرداخت/فاکتور)، و در ابطال انتخابی id in picked و purgeStockPlan هم. حالا همه با reportIdChunks دسته‌ای داخل همان تراکنش؛ voided.count جمع دسته‌ها؛ returnCredits یکتا و id صعودی (پیام «اعتبار مصرف‌شده» همان کوچک‌ترین شناسه). تست tests/audit-fixes/fix-s175-purge-in-chunk.mjs (۵۲۱ فاکتور با پرداخت و قلم، ۵۱۰ برگشت دارای اعتبار فقط با پیوند returnId، ۵۱۰ مصرف اعتبار چندبارمصرف؛ ابطال بازه + ابطال انتخابی ۵۲۱ با بازگشت موجودی) قبل ۱/۱۵ ⇒ بعد ۱۶/۰؛ بدون سقف روی کد قبلی ۱۴/۲. جهش‌ها: پرداخت فقط دسته‌ی اول ۱۴/۲، اعتبار returnId فقط دسته‌ی اول ۱۵/۱ (پس از سخت‌گیرتر کردن تست)، شمارش = به‌جای += ۱۵/۱، نقشه‌ی موجودی دسته‌ی اول ۱۵/۱، مصرف‌ها دسته‌ی اول ۱۴/۲.
- ✅ S175-D3 (ایراد واقعی تازه، رفع شد): cashboxService.finalize (تجمیع) — saleInvoice.updateMany id in invoiceIds و InventoryService.finalizePendingForInvoices / pendingSummaryForInvoices (refId in) بی‌سقف. حالا دسته‌ای (chunksOf در CashboxService، helper تازه movementRefChunks در InventoryService)، شمارش جمع دسته‌ها. تست tests/audit-fixes/fix-s175-consolidate-in-chunk.mjs (۵۲۱ فاکتور + ۵۲۱ حرکت PENDING؛ تجمیع + retry S69) قبل ۰/۱۱ ⇒ بعد ۱۱/۰؛ بدون سقف روی کد قبلی ۱۰/۱. جهش‌ها: وصل فاکتور دسته‌ی اول ۹/۲، شمارش حرکت = ۹/۲. pendingSummaryForInvoices فقط متن‌کدی (مسیر پیش‌نمایش تست رفتاری ندارد).
- ✅ S175-D4 (ایراد واقعی تازه، رفع شد): StoreCreditService.list با «فقط دارای باقی‌مانده» شناسه‌های کل صفحه (take پیش‌فرض ۱٬۰۰۰ تا ۵٬۰۰۰) را یکجا در id in می‌گذاشت، و receiptNoMap شناسه‌ی همه‌ی فاکتورهای مرجع صفحه را یکجا. حالا دسته‌ای با chunkIds؛ صفحه به ترتیب همان remainingIds بازچینی می‌شود؛ reminderCandidates هم شناسه‌ی مشتری را دسته‌ای می‌خواند (فقط متن‌کدی). تست tests/audit-fixes/fix-s175-credit-list-in-chunk.mjs (۶۰۰ اعتبار دارای باقی‌مانده با فاکتور مرجع جدا + ۵۰ کاملاً مصرف‌شده؛ take پیش‌فرض، take=۵۰۰۰، صفحه‌بندی ۲۵۰) قبل ۴/۱۰ ⇒ بعد ۱۴/۰؛ بدون سقف روی کد قبلی ۱۲/۲. جهش‌ها: شماره فیش دسته‌ی اول ۱۲/۲، صفحه دسته‌ی اول ۱۲/۲.
- S175-D5 (تصمیم، تغییر داده نشد): whereFromFilter تب اعتبار (StoreCreditService، id in reportCreditIds تا CREDIT_SCOPE_MAX_IDS=۳۰٬۰۰۰) عمداً طبق S98-1 است (زیر سقف ۳۲٬۷۶۶ متغیر SQLite، list با orderBy/skip/take را نمی‌شود دسته کرد، عبور ⇒ خطای فارسی صریح). با قاعده‌ی ۵۰۰ ناسازگار است ولی تصمیم ثبت‌شده‌ی قبلی است؛ بازنگری فقط با Prisma واقعی.
- ممیزی کوتاه سایر in ها (accountingReport، SalesService، StoreCreditService، CashboxService، SalesLedger، StaffReportService، creditReportScope، invoiceDebt): بقیه یا دسته‌ای‌اند یا روی فهرست کوچک (روش‌های پرداخت، تک‌فاکتور).
- رگرسیون نهایی (TESTLOG-s175-regression.txt): audit-fixes TOTAL=160 PASS=160 FAIL=0 · legacy 17/17 · esbuild 144 OK · BUNDLE main 1799340 / preload 33857 / renderer 2072233 (۰ هشدار) · tests/audit ۸۴/۸۴ (TESTLOG-s175-audit.txt). جهش‌ها: TESTLOG-s175-mutation.txt. patch: mahak-session175-fix.patch (src) و mahak-session175-tests.patch (tests) نسبت به zip ۱۷۴.


## نشست ۱۷۶
- baseline (TESTLOG-s176-baseline.txt، TESTLOG-s176-audit-baseline.txt): ۱۶۰/۱۶۰، ۱۷/۱۷، 144 OK، BUNDLE 1799340/33857/2072233، audit ۸۴/۸۴ — دقیقاً مطابق هندآف.
- ✅ S176-D1 (ایراد واقعی تازه): PriceAdjustService — helperهای chunksOf/aliveVariantIds/idInOf/countProductVariants (PRICE_ADJUST_IN_CHUNK=۵۰۰)؛ loadAllProductVariants دامنه‌ی id in بزرگ را دسته‌ای و به ترتیب id می‌خواند؛ revert/endScheduledBatch/editBatch/deleteBatches/activeDiscounts/batches دسته‌ای. تست tests/audit-fixes/fix-s176-price-adjust-in-chunk.mjs (۶۲۰ کالا؛ ۹ سناریو) قبل ۴/۴۱ ⇒ بعد ۳۵/۰؛ بدون سقف روی کد قبلی ۳۰/۵ (فقط چک‌های سقف).
- ✅ S176-D2 (ایراد واقعی تازه): markScheduleFailure فاز END ⇒ APPLIED + endAt=null + note/Audit «قیمت‌ها برنگشتند». تست fix-s176-schedule-end-failure.mjs قبل ۶/۱۰ ⇒ بعد ۱۵/۰.
- جهش‌ها (TESTLOG-s176-mutation.txt): ۸ از ۹ گرفته شد؛ M8 (batches() اقلام فقط دسته‌ی اول، فقط روی متن هشدار revertWarning اثر دارد) رد شد ⇒ تست باید سخت‌تر شود (نشست بعد).
- S176-D3 تصمیم: ProductService/VariantPurge/SecondaryStock remove فعلاً دست نخورد.
- ممیزی in: بقیه‌ی سرویس‌ها (FraudService، PendingRestock، StockCount، StockAllocation، Inventory، SecondaryStock withdraw، PrintService) دسته‌ای‌اند؛ ReturnService/CheckService در repo وجود ندارند؛ SQL خام MaintenanceService فقط زیرکوئری است.
- رگرسیون نهایی: audit-fixes 162/162 · legacy 17/17 · esbuild 144 OK · BUNDLE main 1802085 / preload 33857 / renderer 2072233 (۰ هشدار) · tests/audit: 84 total · 84 PASS · 0 FAIL ·


## نشست ۱۷۷
- گام ۰ (npm install، npx prisma generate، npm run typecheck) اجرا نشد، دلیل: npm/npx/typescript و اینترنت در محیط نیست (فقط node v22 و esbuild).
- baseline روی کپی دست‌نخورده‌ی zip ۱۷۶ (TESTLOG-s177-baseline.txt، TESTLOG-s177-audit-baseline.txt): ۱۶۲/۱۶۲، ۱۷/۱۷، 144 OK، BUNDLE 1802085/33857/2072233، audit ۸۴/۸۴ — دقیقاً مطابق هندآف.
- ✅ M8 (جهش زنده‌ی ۱۷۶، بسته شد): tests/audit-fixes/fix-s176-price-adjust-in-chunk.mjs بخش ۸ حالا دو دسته‌ی APPLIED هم‌پوشان X1/X2 (VARIANTS روی ۳ کالا، +۱۰۰) را *قبل* از ۵۲۰ ردیف سابقه می‌سازد، جایگاه‌شان بعد از ردیف ۵۰۰ فهرست را چک می‌کند، هشدار X1 «روی ۳ مورد» و نبود هشدار X2 را می‌سنجد، بعد هر دو را با deleteBatches(restore) پاک می‌کند تا قیمت‌ها ۱۰۰۰ بمانند. تست ۴۰/۰؛ جهش M8 ⇒ ۳۹/۱ (گرفته شد). src دست نخورد.
- ✅ S176-D3 (رفع دفاعی، ثبت در DECISIONS): ProductService.remove/restore (helper تازه‌ی export شده variantIdChunksOf، PRODUCT_IN_CHUNK=۵۰۰، یکتا و صعودی؛ خواندن و نوشتن داخل یک prisma.$transaction با TX_OPTIONS؛ شمارش جمع دسته‌ها؛ Audit مثل قبل بعد از تراکنش)، VariantPurgeService.preview و purge (خواندن بیرون از تراکنش، و داخل تراکنش: خواندن دوباره با Map، شمارش دفتر گردش، deleteMany — همه دسته‌ای)، SecondaryStockService.remove (خواندن + deleteMany دسته‌ای داخل یک تراکنش؛ Audit و دفتر انبار مرکزی مثل قبل بعدش). تست tests/audit-fixes/fix-s177-product-remove-in-chunk.mjs (۶۲۰ کالا + کالای کنترل؛ حذف نرم با شناسه‌ی تکراری، بازگردانی، پیش‌نمایش حذف همیشگی، رد purge وقتی کالای دسته‌ی دوم حرکت انبار دارد، purge کامل با حذف محصول پایه، حذف ۶۲۰ ردیف انبار مرکزی + کنترل) قبل ۳/۲۸ ⇒ بعد ۲۵/۰؛ بدون سقف (S177_NO_CAP=1) روی کد قبلی ۱۹/۶ (فقط چک‌های سقف) ⇒ اعداد عوض نشده.
- regex قراردادی fix-s126-variant-purge-retention-ledger (شمارش حرکت داخل تراکنش) از «in: targets» به «in: (targets|chunk)» به‌روز شد؛ معنای چک (شمارش داخل tx پیش از حذف) دست نخورد.
- جهش‌ها (TESTLOG-s177-mutation.txt): M8 + N1..N8 همه گرفته شدند (۹ از ۹).
- ممیزی in بی‌سقف کل src/main پس از این رفع: همه‌ی فهرست‌های شناسه‌ی متغیر دسته‌ای‌اند؛ تنها استثناها: categoryIds در ProductService.list (درخت دسته، کوچک) و whereFromFilter تب اعتبار (تصمیم S98-1/S175-D5).
- رگرسیون نهایی (TESTLOG-s177-regression.txt): audit-fixes 163/163 · legacy 17/17 · esbuild 144 OK · BUNDLE main 1804275 / preload 33857 / renderer 2072233 (۰ هشدار) · tests/audit ۸۴/۸۴ (TESTLOG-s177-audit.txt). patch: mahak-session177-fix.patch (src) و mahak-session177-tests.patch (tests) نسبت به zip ۱۷۶.

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

## نشست ۱۸۷
- ✅ S187-D1: پنل تنظیمات مثل بقیه‌ی ماژول‌ها رمز دوم و رمز سوم شیفت می‌پذیرد (`MANAGER_ONLY_PANELS` خالی شد). ورود به صفحه همچنان همیشه قفل است (`ALWAYS_LOCKED`). تعریف رمز و تغییر قفل ماژول‌ها همچنان رمز مدیر می‌خواهد.
- تست: `tests/audit-fixes/fix-s187-settings-second-third-password.mjs` ۱۹/۰؛ `fix-s183` ۴۷/۰ (بخش ۸ به‌روز شد).
- ✅ S187-D2: اعتبار صادرشده بابت برگشت/تعویض در گزارش *دیده می‌شود* (بلوک ۳، تب اعتبار، ستون بارکد/مبلغ تب برگشت، خط کنترل صندوق) ولی به مبلغ کل فروش اضافه نمی‌شود. خط کنترل بند ۷ دیگر ارزش کالای برگشتی را از پول فیزیکی کم نمی‌کند — فقط بازپرداخت نقد/کارت واقعی. تست: `tests/audit-fixes/fix-s187-return-credit-in-report.mjs`.
- ✅ S187-D3: خط کنترل جمع مصرف را می‌گوید؛ با + همهٔ بارکدها (تا ۵۰۰۰) باز و با − جمع می‌شوند — سقف ۱۲ برداشته شد.

## نشست ۱۸۹
- بازبینی کلاد: موارد مالک‌بسته (رمز دوم اعتبار، ۴-۲۴، تنظیمات) دست نخورده.
- ✅ بکاپ mode نامعتبر رد می‌شود (دیگر به جایگزینی کامل نمی‌افتد).
- ✅ مابه‌التفاوت تعویض با چک رد می‌شود.
- ✅ چاپ/PDF/پیش‌نمایش اعتبار همان گیت فهرست را دارد.
- ✅ کارت‌به‌کارت لغوشده در ردیف فاکتور و سقف تعویض «در انتظار» نیست.
- ✅ ویرایش فاکتور قفل دوره را روی تاریخ *مقصد* هم می‌سنجد.
- ✅ TTL نشست پنل ۵ دقیقه.
- ✅ آخرین پرداختی نسیه بر اساس paidAt (+ نشان «ثبت با تاریخ قبل»).
- ✅ تولید گروهی: درج DRAFT، در شکست void نه delete؛ موفقیت ⇒ ACTIVE.
- ✅ فیلتر اعتبار با سقف شناسه دیگر کل بازه را حساب نمی‌کند.
- تست: `tests/audit-fixes/fix-s189-claude-review.mjs` ۲۴/۰؛ s186 ۴۳/۰؛ s188 ۱۶/۰؛ s187 ۴۱/۰.
- ✅ S189-D4 · بند ۴-۳۵/۴-۵۵: برگشت جزئی که اضافه‌دریافت می‌سازد دیگر بی‌صدا نیست — همان فلو «بله ثبت کن» / صدور کد / ردیف پول اضافه. تست: `fix-s189-return-overpay-flow.mjs` ۹/۰.
- ✅ S189-D5 · ۱-۵: بستن صندوق و بستن شیفت یک تراکنش؛ تجمیع عدد همان فاکتورهای داخل تراکنش و retry بدون سند خالی. تست: `fix-s189-cash-shift-atomic.mjs` ۱۸/۰.
- ✅ S189-D6 · ۱-۶: ریز پرداخت جزئیات شیفت با `createdShiftId`/`clearedShiftId` (نه پنجره‌ی paidAt). تست: `fix-s189-shift-payments-by-shift.mjs` ۶/۰.
- ✅ S189-D7 · باقی‌مانده: چک امروز معوق نیست؛ مبلغ تعویض = جایگزین؛ ساعت در paidAt؛ علامت تاریخ قبل. تست: `fix-s189-remaining-bugs.mjs` ۹/۰.
