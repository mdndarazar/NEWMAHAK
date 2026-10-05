# جلسه ۲۸ — گلوگاه renderer باز شد (گام ۱ کامل) + رفع باگ مالی §۸ + رفع ابزار .tsx

## محیط (گام ۰ — ششمین نشست پیاپی با همین دیوار)
`node v22.23.1` هست. `npm` / `npx` / `tsc` / `electron` نیستند و شبکه بسته است ⇒ `typecheck`،
`build`، `prisma generate` و اجرای برنامه ممکن نبود. طبق دستور کاربر («خودم روی ویندوز تست
می‌کنم») این نشست کدنویسی کرد و اعتبارسنجی را با دو ابزارِ در-دسترس انجام داد: سوییت‌های خالص
`--experimental-strip-types` و `tools/tsx-parse-check.mjs` (که همین نشست **درست شد**).

## ✅ گام ۱ — UI: هر ۸ بند هندآف جلسه ۲۷ انجام شد
معماری: فرم‌ها از دل صفحه بیرون آمدند (توصیه‌ی هندآف)، پس JSX چندخطی و قابل‌بازبینی شد.
* **فایل‌های تازه:** `components/CreditForms.tsx` (IssueForm · OpForm · SettingsForm) ·
  `components/CreditPickers.tsx` (دسته/کالا/دامنه/گیرنده + فیلدهای کوچک) ·
  `components/CreditDetailView.tsx` (صفحه‌ی جزئیات). `pages/CreditManagement.tsx` بازنویسی شد.
* **بند ۱ — IssueForm (§۳/§۵/§۶/§۱۲/§۱۸):** دامنه‌ی مصرف (ALL/CATEGORY/VARIANTS) + چندانتخابی
  دسته از `category:tree` + چندانتخابی کالا با `VariantSearchBox`/`AllProductsModal`؛
  `minPurchase`؛ `maxPerTransaction`؛ `customerLocked`؛ کل بلوک گیرنده (`holderCompany`,
  `holderNationalId`, `holderPhone`, `holderAddress`, `holderAgent`, `holderNote`)؛ `note`؛
  `prefix`؛ `asDraft`؛ `reminderOptOut`؛ `expiryMode`؛ و در حالت گروهی `codeLength` +
  نمایش `previewCodeSpace`. نام فیلد همان `restrictVariantIds` است.
* **بند ۲ — SettingsForm (§۶/§۷/§۱۳/§۱۴/§۱۵/§۲۲):** هر ۱۸ تنظیم غایب اضافه شد: `codeAlphabet`،
  `excludeSimilar`، `autoGrowLength`، `bulkCapacityRatio`، `barcodeIncludeText`،
  `barcodeHeightMm`، `paper`، `customWidthMm`، `customHeightMm`، `showRules`، `showHolder`،
  `showRemaining`، `rulesText`، هر ۶ فیلد `reminder`، `reportLiability`، و `types[*].multiUse`.
* **بند ۳ — OpForm (§۱۰/§۱۱):** چهار عملیاتِ EXPIRY/USES/HOLDER/RESTRICTION که از UI
  غیرقابل‌انجام بودند، حالا فرم کامل دارند (تاریخ جلالی، حالت دفعات + سقف تراکنش، بلوک گیرنده،
  دامنه + دسته/کالا). فرم با **مقدار فعلی همان اعتبار** پیش‌پر می‌شود (`prefillOpDraft`) چون این
  عملیات‌ها مقدار را *جایگزین* می‌کنند: فرم خالی یعنی پاک‌شدن ناخواسته‌ی آدرس/شرکت/دامنه.
  هشدارهای `buildOpPayload` و `result.warnings` سرویس هم دیده می‌شوند.
* **بند ۴ — صفحه‌ی جزئیات (§۱۲/§۱۶/§۱۸/§۱۹ و Q1):** بلوک گیرنده، خلاصه‌ی محدودیت، پیوندهای سند
  (فاکتور اصلی/تعویض/برگشتی/فاکتور مصرف/اعتبار باقی‌مانده/دسته/استثنا) + `issuedByName`، و سه
  جدول تازه: **دفتر مصرف**، Timeline، و **لاگ یادآوری** — هر سه با خروجی اکسل.
* **بند ۵ — گیت‌ها (§۲۰):** `PANEL_KEYS.creditBulkIssue` و `PANEL_KEYS.creditVoid` که تعریف
  شده بودند و هیچ‌جا استفاده نمی‌شدند، حالا روی مودال تولید گروهی و مودال عملیات نشسته‌اند.
* **بند ۶ — خروجی اکسل هر گزارش (§۱۵ و Q3):** داشبورد، تفکیک `byStatus`/`bySource` (با ردیف
  جمع)، دفتر مصرف، Timeline، لاگ یادآوری، نامزدهای یادآوری، دسته‌ها و فهرست — همه از
  `creditExport` (یک تصمیم تست‌شده ⇒ سرستون هیچ گزارشی با ردیف گزارش دیگر جفت نمی‌شود).
* **بند ۷ — یادآوری (§۱۴):** فیلتر «فقط واجد شرایط» (به Backend هم `onlyDue` می‌رود) + نمای تازه‌ی
  «لاگ یادآوری» که کانال ثبت‌شده‌ی `creditReminderLogs` را **برای اولین بار** مصرف می‌کند.
* **بند ۸ — `Pos.tsx` (§۱۸):** اقلام خارج از دامنه در سبد علامت می‌خورند (`creditCartCoverage` +
  `isLineExcluded`)، پیام‌های `plan.notes` و سهم ریالی «در دامنه / خارج از دامنه» نمایش داده
  می‌شود، و payload پیش‌نمایش با `posPreviewPayload` وفادار شد: `customerId` واقعی + `categoryId`
  هر خط + مبلغ خالص ردیف (قبلاً `l.price * l.qty` بود؛ `price` روی `CartLine` وجود ندارد).

## ✅ گام ۲ — باگ مالی واقعی §۸ رفع شد (اولویت یک)
`SalesService.purge` فاکتور و پرداختی را حذف می‌کرد ولی `reverseInvoiceRedemptions` را صدا
نمی‌زد ⇒ اعتبار مشتری «مصرف‌شده» می‌ماند در حالی که فاکتور مصرفش دیگر وجود نداشت. حالا **قبل از**
حذف و **داخل همان تراکنش**، مصرف‌های هر فاکتورِ اعتبارمصرف‌کرده برگشت می‌خورد، تعدادش در AuditLog
و در خروجی عملیات ثبت می‌شود و در پیام UI (`Settings.tsx`) هم دیده می‌شود. سند قدیمیِ
«این تابع هیچ‌جا صدا زده نمی‌شود» هم اصلاح شد.

## ✅ گام ۴ — `tools/tsx-parse-check.mjs` درست شد
باگ: `lastTok` بین دو عبارتِ مستقل JSX نشت می‌کرد، پس `footer={<>…</>}` بعد از یک اتریبیوتِ
رشته‌ای، «کوچکتر» فهمیده می‌شد و Fragment خام می‌ماند ⇒ False Positive روی فایل‌های سالم.
حالا هر `{…}` با «ابتدای عبارت» شروع می‌شود. نتیجه: **همه‌ی 47 فایل نحواً سالم‌اند.** و خطاهای واقعی (تگ نبسته،
آکولاد نبسته، تگ ناهم‌نام) همچنان گرفته می‌شوند.

## ⛔ گام ۳ — انجام نشد (و نمی‌شد)
هارنس واقعی §۲۳ به `@prisma/client` نیاز دارد که در این محیط نیست. دست‌نخورده برای نشست بعد.

## بخش تازه در لایه‌ی مشترک
`src/shared/creditUi.ts` **بخش ۹**: `CREDIT_ALPHABET_OPTIONS`, `CREDIT_PAPER_OPTIONS`,
`CREDIT_EXPIRY_MODE_OPTIONS`, `CREDIT_USES_MODE_OPTIONS`, `opFields`, `usesModeOf`,
`prefillOpDraft`, `setTypeRule`, `reminderFilter`, `posPreviewPayload`, `creditExport`,
`detailFactBlocks`. قاعده‌ی «هر تصمیم در `.ts` نه در JSX» رعایت شد.

## اجرا (واقعاً اجرا شد، همین نشست)
```
test/acceptance-session14.mjs                        ⇒ session 14 acceptance: 24 passed, 0 failed
test/acceptance-session21.mjs                        ⇒ Session 21: 34 PASS · 0 FAIL
test/acceptance-session25.mjs                        ⇒ Session 25: 31 PASS · 1 FAIL
test/credit-logic-session21.ts                       ⇒ نتیجه‌ی سوییت منطق خالص: 44 PASS · 0 FAIL
test/credit-ui-logic-session22.ts                    ⇒ credit-ui-logic (session 22): 32 PASS · 0 FAIL
test/credit-print-logic-session25.ts                 ⇒ credit-print-logic (جلسه ۲۵): 24 PASS · 0 FAIL
test/credit-ui-logic-session28.ts                    ⇒ credit-ui-logic (session 28): 51 PASS · 0 FAIL
همه‌ی 47 فایل نحواً سالم‌اند.
```
جمع: **240 PASS · 1 FAIL**. سوییت تازه‌ی `credit-ui-logic-session28.ts` هم بخش ۸ جلسه ۲۷
(که هیچ تستی نداشت) و هم بخش ۹ جلسه ۲۸ را واقعاً اجرا می‌کند.

## ⚠️ صادقانه
* هیچ `typecheck`/`build`/Smoke Test اجرا نشد (npm نیست). تست ویندوزی دست کاربر است.
* `acceptance-session25.mjs` حالا هر چهار فایل UI ماژول را با هم می‌خواند، چون ساختار UI به
  چهار فایل رفت؛ خودِ بندهای سنجش عوض نشدند.
* یک باگ جانبی هم رفع شد: `setConfirm(() => void submitOp())` در نسخه‌ی قبل، تابع را به‌جای
  ذخیره **بلافاصله اجرا** می‌کرد (رفتار updater در React) ⇒ دیالوگ تایید عملاً بی‌اثر بود.
