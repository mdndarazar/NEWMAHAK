# مهک — گزارش جلسه ۵ (۸ درخواست جدید)

> این فایل را در شروع جلسه‌ی بعد اول بخوانید. تمام تصمیم‌ها و ادامه‌ی کار اینجاست.

## ⚠️ نکته‌ی صداقتی (مثل جلسات قبل)
در این محیط **اینترنت و `node_modules` وجود ندارد**، پس این دستورها اجرا نشده‌اند:
`npm install` · `npm run db:generate` (prisma generate) · `npm run typecheck` · `npm run dev`.
کد دقیقاً بر اساس امضاها و تایپ‌های موجود پروژه نوشته شده، اما **قبل از هر کاری** روی سیستم خودتان:

```bash
npm install
npm run db:generate     # لازم است: دو مدل جدید به schema اضافه شده
npm run typecheck
npm run dev
```

مهاجرت جدید: `prisma/migrations/20270601000000_price_change_batches/` (نسخه‌ی دستی هم در `prisma/manual/`).

## ✅ تمام‌شده (شامل سرور/منطق/IPC)

**مورد ۱ — قفل رمز دوم ماژولار**
- `src/shared/panels.ts`: `ALWAYS_LOCKED_PANELS`, `isAlwaysLocked`, `PanelLockConfig`, `allLockedConfig`, `parsePanelLocks`, `isPanelLockEnabled`, `openPanelCount`.
- سیاست: **پیش‌فرض همه قفل**؛ فقط مقدار صریح `false` روی یک کلید معتبر قفل را باز می‌کند (تنظیمات خراب/ناقص هرگز «باز» تفسیر نمی‌شود).
- نوشتن سیاست فقط با **رمز مدیر** (نه رمز دوم پنل تنظیمات) — وگرنه کسی که رمز تنظیمات را دارد می‌توانست کل برنامه را باز کند.
- پنل «تنظیمات» خودش در `ALWAYS_LOCKED_PANELS` است (پشتیبان‌گیری/بازگردانی و پاک‌سازی گزارش‌ها داخلش است).
- `AuthService`: `panelLocks()`, `setPanelLocks()` (audit: `PANEL_LOCKS_UPDATE`), `panelInfo()` حالا `lockEnabled`/`alwaysLocked` می‌دهد، `verifyPanel()` برای ماژول بازشده `scope:'OPEN'`.

**مورد ۳ (سرور) — سیاست تخفیف**: `DiscountPolicyMode` = `FREE | FIXED | OFF` + سقف‌ها در `src/shared/priceAdjust.ts`، `settingsService.discountPolicy()/saveDiscountPolicy()`، `discount` در `SettingsBundle`. پیش‌فرض `FREE` تا رفتار فعلی عوض نشود.
سه کلید قفل جدید: `posDiscount`, `priceAdjust`, `secondaryToStore` → مجموعاً **۲۰ پنل قفل‌دار**.

**مورد ۴ (سرور) — ماژول تخفیف/افزایش/کاهش قیمت**: `src/shared/priceAdjust.ts` (حالت‌ها، دامنه‌ها، `nextPrice` با کفِ قیمت و محافظت از کالای زیر کف، رُند به پله) + `src/main/services/PriceAdjustService.ts` (۵۵۶ خط): `preview` (هیچ‌وقت نمی‌نویسد) → `apply` (یک تراکنش، قیمت‌ها داخل تراکنش دوباره خوانده می‌شوند، قیمت قبلی هر قلم ذخیره می‌شود) → `batches` / `batchLines` / `revert` (قیمت قبلی را برمی‌گرداند، نه فرمول معکوس). مدل‌های `PriceChangeBatch` و `PriceChangeItem`. **فاکتورهای ثبت‌شده هرگز دست‌کاری نمی‌شوند.**

**مورد ۸ — انتقال انبار مرکزی → انبار فروشگاه**: `secondaryStockService.toStore()` و `storeCandidates()` + دو هندلر IPC.
- موجودی منفی درست لحاظ می‌شود: **۳- + ۱۰ = ۷** و عدد جبران‌شده در `shortageCovered` برمی‌گردد و در سابقه/پیام دیده می‌شود.
- مقصد باید `variantId` صریح باشد؛ تطبیق نام/کد فقط *پیشنهاد* می‌دهد (این ماژول عمداً relation با کالاها ندارد).
- انتقال بیشتر از موجودی مبدأ فقط با `force` (تأیید آگاهانه).

**زیرساخت ۶ و ۷**: `SaleChannel` + `channelOfOrderType` + `orderTypesForChannels` (تکی = INTERNAL/DELIVERY/PHONE/EXCHANGE، عمده = WHOLESALE)، `SaleReportFilter.channels` (آرایه‌ی خالی = هیچ، نه «همه»)، `creditRemainingTotal` و `priorSettlementTotal` در `SaleReportTotals` + `reportShape.ts`.

## ⏳ باقی‌مانده (همه سمت رابط کاربری)
1. **مورد ۲** — حذف دکمه‌های «دستی» حق سرویس/مالیات (`ChargeRow`, `taxOverride`, `serviceOverride`) از `Pos.tsx` و `SalesInvoice.tsx`؛ مقادیر فقط خواندنی از ماژول عوارض. `settle()` همان مقادیر خودکار را بفرستد تا فاکتور/رسید عین قبل بماند.
2. **مورد ۳ (UI)** — ستون تخفیف قلم و کادر تخفیف فاکتور داخل `<ManagerGate panel={PANEL_KEYS.posDiscount} inline>`؛ اعمال `DiscountPolicy` در `totals` و `settle()`.
3. **مورد ۴ (UI)** — صفحه‌ی `pages/PriceAdjust.tsx` (سه بخش، کشویی درصدی/مبلغی، سه روش انتخاب، پیش‌نمایش زنده، تاریخچه + بازگردانی، خروجی اکسل) + route و NAV در `Shell.tsx` + فرم سیاست تخفیف مورد ۳.
4. **مورد ۵** — الگوی `flex-1 overflow-auto min-h-[…] max-h-[…]` + `thead sticky` برای همه‌ی جداول گزارش همه‌ی ماژول‌ها.
5. **مورد ۶** — چک‌باکس‌های «همه / تکی / عمده» در `ReportFilterBar` برای پنج بخش + اعمال `channels` در `saleWhere` و کوئری‌های برگشت/تعویض/نسیه.
6. **مورد ۷** — بلوک خلاصه با همه‌ی اقلام حتی صفر، در قالب `+/-` خودِ شما، چک‌باکس زنده‌ی «نسیه» که قلم را **هم از نمایش و هم از محاسبه‌ی خالص** حذف کند + پر کردن `priorSettlementTotal` در `reportRows`.
7. **مورد ۸ (UI)** — گزینه‌ی «انتقال به انبار فروشگاه» در مودال انتقال `SecondaryStock.tsx` با `<ManagerGate panel={PANEL_KEYS.secondaryToStore}>`.
8. `useSettings` حامل `discount`؛ `ManagerGate`/`useManagerSession` وقتی قفل یک ماژول خاموش است بدون پرسیدن رمز بچه‌ها را رندر کند؛ بخش «رمز» تنظیمات کلیدهای قفل هر ماژول را نشان دهد.

## قانون همیشگی پروژه
هر ماژول/گزینه‌ی حساس جدید باید: کلید در `PANEL_KEYS` + ردیف در `LOCKED_PANELS` + `<ManagerGate>` + تست.
