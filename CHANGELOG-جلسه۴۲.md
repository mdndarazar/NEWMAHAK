# جلسه ۴۲ — کار ب: بند «الف» (IPC) بسته شد · پنل قفل‌دار مدیر کامل شد · چهار صفحه‌ی نمایشی مانده

## صداقت فنی (اول از همه)
* `npm` **بیستمین نشست** پشت سر هم نبود ⇒ `npm install` / `prisma generate` / `tsc --noEmit` **اجرا نشد**.
  هیچ typecheck ی روی درخت انجام نشده و UI در این نشست اجرا/رندر نشده است.
* اجرا شد و سبز است: `node tools/tsx-parse-check.mjs` روی هر ۹ فایل دست‌خورده ⇒ سالم ·
  `test/acceptance-db-session36.mjs` ⇒ **۱۳۷ PASS · ۰ FAIL** · `test/acceptance-db-session35.mjs` ⇒
  **۲۰۴ PASS · ۰ FAIL** (بدون رگرسیون، قبل و بعد از تغییرها).
* **سوییت `test/acceptance-db-session40.mjs` (سناریوهای کار ب) نوشته نشد.** یعنی مسیرهای تازه‌ی این
  نشست (دو هندلر IPC و snapshot انبارگردانی) **تست خودکار ندارند** و فقط از راه خوانش کد و امضای
  سرویس‌ها تأیید شده‌اند. این مهم‌ترین بند باقی‌مانده است.
* **کار الف دست نخورد** (تمام‌شده و سبز از جلسه ۴۱).
* به «فاکتور فروش عمده و انتخاب انبار» دست نخورد.
* حالت فعلی **سالم و ناشکسته** است: قاعده‌ی معلق ماندن کالا و آزادسازی با پرداخت مدیر از جلسه ۴۰ کار
  می‌کرد؛ این نشست آن را به IPC و به پنل قفل‌دار مدیر **وصل** کرد. چیزی که کم مانده، *دیده شدنِ*
  معلق‌ها در چهار صفحه‌ی خواندنی است.

## ✅ بند الف — IPC و لایه‌ی میانی (کامل)
| فایل | چه شد |
|---|---|
| `src/shared/ipc.ts` | دو کانال تازه: `cardTransferCancel: 'cardTransfer:cancel'` و `pendingRestockSummary: 'pendingRestock:summary'` (با توضیح «فقط خواندنی») |
| `src/main/ipc/index.ts` | هندلر `cardTransfer:cancel` (با `withUser`، پس `managerPassword` و `userId` هر دو به سرویس می‌رسند) + هندلر خواندنیِ `pendingRestock:summary` ⇒ `pendingRestockService.summary()` |
| `src/shared/types.ts` | `export type { PendingRestockItem, PendingRestockSummary } from './pendingRestock'` — فقط دوباره‌صدور تایپ، بدون هیچ import زمان‌اجرا و بدون ساختن شکل موازی |
| `src/shared/panels.ts` | ردیف `LOCKED_PANELS` کلید `cardTransfers`: عنوان شد «پرداخت‌های مدیر — کارت‌به‌کارت» و توضیحش صریح می‌گوید **بازگرداندن کالای برگشتی به موجودی قابل‌فروش هم با همین قفل** و هم در رندرر و هم سمت سرور انجام می‌شود (قاعده‌ی بالای همان فایل + چک‌لیست README) |
| `src/main/services/StockCountService.ts` | `submit`: `pendingRestockQty` از `pendingRestockService.byVariant(tx)` خوانده و **snapshot** می‌شود · `discrepancy`: snapshot را به `calculateStockDiscrepancies` می‌دهد و واریانت‌های «فقط معلق» را هم به `variantIds` اضافه می‌کند |

### سه تصمیم این بند (دوباره تصمیم نگیر)
1. **`diffQty` ستون شمارش دست‌نخورده ماند** (`countedQty − systemQty`، همان عدد خام تاریخی). مغایرتِ
   *واقعی* فقط در `calculateStockDiscrepancies` و روی `diffAtCountWithPending` حساب می‌شود. پس هیچ
   عددِ ذخیره‌شده‌ی قبلی تکان نخورد.
2. **«مورد اختلاف» یک تعریف دارد**: تابع مشترک `countMismatches` در `StockCountService` که شمارش را با
   *موجودی فیزیکیِ مورد انتظار* (قابل‌فروش + معلق) می‌سنجد و هر سه مصرف‌کننده (`submit`، `list`، `get`)
   از همان می‌خوانند. برای هر ردیف بی‌معلق (یعنی تمام داده‌ی قبل از جلسه ۴۰) عیناً شرط قدیمی است.
3. **معلق در `discrepancy` دو منبع دارد و عمداً جدا**: ردیفِ شمارش‌شده ⇒ snapshot همان شمارش (مغایرت
   دیروز باید ثابت بماند) · ردیفِ بی‌شمارش ولی معلق‌دار ⇒ عدد زنده و `hasCount = false` (فقط دیده
   می‌شود، هیچ مغایرتی برایش ساخته نمی‌شود). با `onlyMismatched` هم ردیف‌های معلق حذف نمی‌شوند.

## ✅ بند ب — پنل قفل‌دار مدیر (`components/CardTransferPanel.tsx`) کامل
* **فیلد رمز مدیر** در فرم «پرداخت شد» با همان `<PasswordField>` پروژه، و متن صریح: «چون این دکمه
  موجودی انبار را هم عوض می‌کند، تأیید مدیر این بار در خودِ سرور بررسی می‌شود؛ باز بودن قفل صفحه
  به‌تنهایی کافی نیست». اگر قفل ماژول خاموش باشد، خالی گذاشتنش مجاز است (همان سیاست موجود پروژه).
* **ستون تازه «معلق برگشتی (در انتظار تأیید مدیر)»** در جدول و در خروجی اکسل، با نشانِ
  `PendingStockBadge` و رنگِ `pendingRestockTone` (info/warn/alert بر اساس سن درخواست).
* **نوار خلاصه‌ی بالای پنل** از `pendingRestockHeadline`، به‌علاوه‌ی خط قرمزِ `needsAttentionQty`
  (درخواست رد شده ولی کالا هنوز معلق) با راهنمای تکلیف.
* **دکمه‌ی «رد یا لغو این درخواست»**: دلیل اجباری + چک‌باکس «کالا را بدون پرداخت به موجودی قابل‌فروش
  برگردان» + رمز مدیر، وصل به `cardTransfer:cancel`. رکورد حذف/بازنویسی نمی‌شود.
* فیلتر وضعیت گزینه‌ی «رد/لغو‌شده» گرفت و `statusTone` رنگ `CANCELED` را دارد. پنجره‌ی جزئیات ردیف
  «معلق برگشتی» و «دلیل رد/لغو» را نشان می‌دهد.
* پیام موفقیتِ پرداخت حالا صریح می‌گوید چند عدد کالا همان لحظه آزاد شد (یا اینکه کالای معلقی نبود).
* ⚠️ عدد معلق **بازه‌ی تاریخ نمی‌گیرد** (برخلاف بقیه‌ی جدول): کالایی که سه ماه پیش معلق شده و پرداخت
  نشده، امروز هم روی قفسه است؛ فیلتر تاریخ دقیقاً همان چیزی را پنهان می‌کرد که این کار برای دیدنش است.

## ❌ کارِ باقی‌مانده — نشست بعد دقیقاً از همین‌جا
### الف) چهار صفحه‌ی نمایشیِ **فقط خواندنی** (هیچ‌کدام دکمه‌ی تأیید/بازگشت به انبار نمی‌سازد)
همه از کانال `CH.pendingRestockSummary` می‌خوانند (بدون فیلتر تاریخ) و همه‌ی متن‌ها از قبل در
`@shared/pendingRestock` آماده‌اند: `PENDING_RESTOCK_LABEL`, `PENDING_RESTOCK_COLUMN`,
`PENDING_RESTOCK_EXPLAINER`, `PENDING_RESTOCK_STOCKTAKE_NOTE`, `pendingRestockHeadline`,
`pendingRestockLine`, `pendingRestockShiftWarning`, `pendingRestockTone`. نشان آماده هم هست:
`PendingStockBadge` از `components/CardTransferPanel.tsx` (همان‌جا export شده).
1. `pages/Products.tsx` — ستون/نشان معلق کنار موجودی هر کالا (`summary.byVariant[variantId]`).
2. `pages/SalesReports.tsx` — تب برگشت/تعویض + بلوک خلاصه (صفحه در قفل `salesReports` خودش می‌ماند).
3. `pages/Stocktake.tsx` — ستون معلق و `expectedPhysicalQty` در جدول مغایرت، قضاوت روی
   `diffAtCountWithPending` (سرور از قبل هر سه را می‌دهد) + متن `PENDING_RESTOCK_STOCKTAKE_NOTE`.
   صفحه در قفل `stocktake` خودش می‌ماند.
4. `pages/CashClose.tsx` — ردیف هشدار با `pendingRestockShiftWarning` (فقط هشدار؛ روی هیچ عددِ
   کسری/اضافی اثر ندارد و نباید بگذارد).
### ب) تست — **مهم‌ترین بند**
`test/acceptance-db-session40.mjs` طبق الگوی `acceptance-db-session36.mjs` (هر سناریو شیفت مستقل خودش):
برگشت کارت‌به‌کارت + پرداخت · بدون پرداخت (موجودی قابل‌فروش تغییر نکند و معلق دیده شود) · تعویض با
مابه‌التفاوت کارت‌به‌کارت · تعویض با مابه‌التفاوت صفر/مثبت · برگشت نقدی (مثل قبل، همان لحظه) · پرداخت
دوباره (نباید دو بار اضافه کند) · حذف و ویرایش برگشتِ معلق · `pay` بدون رمز مدیر (باید رد شود) ·
`cancel` با و بدون `releaseStock` · مغایرت انبارگردانی با کالای معلق (snapshot + ردیف «فقط معلق»).

## فایل‌های تغییرکرده‌ی این نشست
`src/shared/ipc.ts` · `src/shared/types.ts` · `src/shared/panels.ts` · `src/main/ipc/index.ts` ·
`src/main/services/StockCountService.ts` · `src/renderer/src/components/CardTransferPanel.tsx` ·
`CHANGELOG-جلسه۴۲.md` (تازه) · `HANDOFF-ادامه-توسعه.md` (سرِ فایل).
**هیچ فایل دیگری عوض نشد** — نه schema، نه migration (هر دو از جلسه ۴۰ آماده‌اند)، نه `SalesService`،
نه `CardTransferService`، نه `PendingRestockService`، نه `accounting.ts`.

## دستورهایی که کاربر باید اجرا کند
### کار الف (تمام‌شده — فقط تأیید)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا اجرای دستی prisma/manual/20270923_payment_destination.sql
npm run typecheck
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs
```
### کار ب (ناتمام)
```bash
npm install
npm run db:generate
npx prisma migrate deploy   # یا prisma/manual/20270924_pending_restock_manager_payment.sql
npm run typecheck
node tools/tsx-parse-check.mjs src/renderer/src/components/CardTransferPanel.tsx
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs
# بعد: چهار صفحه‌ی نمایشی ⇒ سپس test/acceptance-db-session40.mjs
```
