# CHANGELOG — جلسه‌ی ۱۴ (Mahak POS)

> قانون گزارش‌دهی رعایت شده: هر بند یا خروجی اجرای واقعی دارد، یا صریح نوشته شده «نوشته شد ولی اجرا/تست نشد، چون …».

## ۰) محدودیت محیط — پنهان نشده
این sandbox **npm ندارد** (`npm: command not found`)، `node_modules` ندارد و اینترنت ندارد. پس این چهار مورد **اجرا نشدند**:
`npm install` · `npx prisma validate` · `npm run typecheck` (tsc --noEmit) · `npm run build`.
یعنی **هیچ فایلی type-check یا build نشده**. فقط Node v22.23.1 موجود بود.
چیزی که *واقعاً* اجرا شد: parse-check تک‌تک فایل‌های تغییرکرده با `node --experimental-strip-types` (خطای سینتکسی ندارند)، سوئیت خالص جلسه‌ی ۱۳ (PASS)، و harness جدید `test/acceptance-session14.mjs`.
سناریوهایی که نیاز به DB واقعی Prisma/SQLite یا IPC الکترون دارند **اجرا نشدند** (بدون node_modules ممکن نیست) و در harness با برچسب `STRUCTURAL` روی خودِ کد اثبات شده‌اند، نه روی داده‌ی زنده.

## ۰-۱) خرابی نشست قبلی که اصلاح شد
هر دو فایل `prisma/migrations/20270919180000_accounting_cash_and_refunds/migration.sql` و `prisma/manual/20270919_accounting_cash_and_refunds.sql` تمام خطوطشان با علامت `+` (زائده‌ی diff خام) شروع می‌شد — این migration در اولین اجرا کرش می‌کرد. اصلاح شد و تأیید شد صفر خط `+` باقی نمانده و هیچ `DROP`/`RENAME` ندارد.

## ۱) schema (فقط افزودنی — قانون طلایی رعایت شد)
`SaleReturn`: refundMethod, refundAmount, refundPaymentId, refundedAt/Jalali/Time, refundReference, refundNote, legacyAssumption.
`CashSession`: openingFloat, cashSales, cardSales, otherSales, clearedChequeSales, priorCreditSettlements, cashReturnRefunds, cardReturnRefunds, cashExchangeRefunds, storeCreditIssued/Used, pendingCheques, bouncedCheques, withdrawals, deposits, expectedCash, countedCash, cashDifference, accountingSnapshotJson, reportVersion.
`CashMovement` (مدل جدید): CASH_IN/CASH_OUT/RETURN_REFUND/EXCHANGE_REFUND/OPENING_FLOAT/DEPOSIT/WITHDRAWAL + مبلغ/تاریخ میلادی+شمسی+ساعت/شیفت/کاربر/refType/refId.
enum های جدید: RefundMethod، CashMovementType (جلسه ۱۳) + ExchangeSettlement.CASH_REFUND/CARD_REFUND و ۶ AuditAction جدید.

## ۲) کانال‌های IPC جدید
`print:return` · `cashbox:movement:add` · `cashbox:movement:list` · `cashbox:expected` · `sale:fraud:review` · `settings:accountingPolicy:get` · `settings:accountingPolicy:set` (در `shared/ipc.ts` و `main/ipc/index.ts` ثبت شدند؛ **preload هنوز به‌روز نشده** — کار نشست بعد).

## ۳) فرمول‌ها (تنها منبع: `src/shared/accounting.ts`)
- `remaining = max(0, grandTotal − paidTotal − returnedTotal(kind=RETURN))` — در `reportShape.shapeSaleRow` و `recalcSettlement`.
- `expectedCash = openingFloat + cashReceived + clearedCashCheque + priorCashSettlements + deposits − cashReturnRefunds − cashExchangeRefunds − withdrawals` ؛ `cashDifference = countedCash − expectedCash`. باگ `boxTotal` (نقد+کارت+سایر+اعتباری) حذف شد.
- صورت تعهدی بر `issuedAt`، وجه واقعی بر `paidAt`/`clearedAt`/`returnedAt`، پل تطبیق با drill-down هفت‌کلیدی (`bridgeSources`).
- تعویض هرگز به‌عنوان برگشت ساده از `netAccrualSales` کم نمی‌شود.

## ۴) وضعیت مرحله‌به‌مرحله
- **مرحله ۱ — انجام شد (کد کامل، type-check نشده).** reportInclude(period) با فیلتر `paidAt`؛ RETURN_SELECT با `kind`+`returnedAt` (کد مرده‌ی جلسه ۱۳ زنده شد)؛ resolvePeriod (صریح/شیفت/ردیف‌ها)؛ جمع‌ها با `aggregate`/`groupBy` روی کل بازه + صفحه‌بندی واقعی `skip/take/totalCount` + هشدار برش؛ حذف کامل `force` روی تعداد برگشتی؛ `refundMethod` اجباری؛ `refundMode` اجباری برای `diff<0`؛ گیت مدیر روی قیمت دستی؛ فیلترهای کانال/شیفت/فروشنده روی همه‌ی بلوک‌ها با یادداشت «قابل تفکیک نیست» جایی که تفکیک ممکن نیست؛ `CashboxService.close` بازنویسی شد.
  - بند ۹ (مصرف اتمیک اعتبار) از قبل درست بود: `updateMany({ where: { status: ACTIVE } })` در `StoreCreditService`.
- **مرحله ۲ — انجام شد** (به‌جز `preload/index.ts`).
- **مرحله ۳ (UI) — انجام نشد.** `SalesReturn.tsx`، `CashClose.tsx`، `SalesReports.tsx` دست‌نخورده‌اند. سرویس و IPC آماده‌ی مصرف است.
- **مرحله ۴ — بخشی.** گیت مدیر + audit برای قیمت دستی و سقف اعتبار انجام شد. **قفل دوره‌ی بسته‌شده (CLOSED_PERIOD_OVERRIDE) فقط enum دارد، پیاده نشده.**
- **مرحله ۵ — انجام شد** (`returnReceiptHtml` + `printReturn`)، اجرا/چاپ آزمایشی نشده.
- **مرحله ۶ (اکسل/CSV) — انجام نشد.**
- **مرحله ۷ — انجام شد** (`FraudService` با ۹ گروه هشدار + drill-down)، روی داده‌ی واقعی اجرا نشده.
- **مرحله ۸ — بخشی.** harness جدید اجرا شد (خروجی واقعی پایین). تست از مسیر واقعی IPC/سرویس **اجرا نشد، چون node_modules/Prisma در دسترس نیست**.

## ۵) فرض‌های محافظه‌کارانه (مستند)
- بازپرداخت نقدی = رکورد `Payment` منفی (نه مدل Refund جدید)، چون Payment از قبل در بستن صندوق/تاریخچه/بکاپ خوانده می‌شود.
- `CashMovement.amount` همیشه مثبت؛ جهت از `type`. `OPENING_FLOAT` جدا از `deposits` تا دوبار شمرده نشود.
- برگشت‌های قدیمی با `refundMethod = null` محافظه‌کارانه «کاهش بدهی، بدون خروج نقد» فرض شده‌اند و برچسب «فرض‌شده از داده‌ی قدیمی» می‌گیرند.
- سقف‌های ایمنی: لیست ID اعتبار ۲۰٬۰۰۰ و اسکن بدهی ۵۰٬۰۰۰ ردیف؛ عبور از سقف = هشدار صریح، نه سکوت.
- جلسات قدیمی `CashSession` مغایرت‌شان `null` و `legacyRecord: true` است (عدد جعلی ساخته نمی‌شود).

## ۶) سود ناخالص
**سود ناخالص (gross profit) عمداً پیاده نشده**، چون `purchasePrice` هیچ snapshot قطعی در لحظه‌ی فروش ندارد و هر عددی که بسازیم گمراه‌کننده است.
