# CHANGELOG — جلسه ۲۰ · ماژول «مدیریت اعتبار خرید» (فاز ۱: مدل داده + موتور قواعد + دسترسی)

> این جلسه **عمداً نیمه‌تمام تحویل داده شده و نیمه‌کاره قطع نشده**: هر خطی که نوشته شد کامل،
> سازگار و بی‌شکستگی است؛ لایه‌ی سرویس/UI هنوز شروع نشده. دلیلش سقف گام همین نشست است
> (§۲۵ سند مرجع: «توقف تمیز با هندآف دقیق، مهم‌تر از کمی بیشتر پیش رفتن»).

## ۱) گزارش معماری (خلاصه‌ی تصمیم‌ها)

### مدل داده — گسترش StoreCredit، بدون مدل موازی (§۱)
`StoreCredit` همان مدل قبلی است و **۳۲ ستون جدید** گرفته که *همه* Nullable یا Default دارند،
پس رکوردهای تاریخیِ اعتبار تعویض مو‌به‌مو مثل قبل رفتار می‌کنند
(`source='EXCHANGE'`, `maxUses=1`, `multiUse=false`, `usedAmount=0`, `restrictScope='ALL'`).

سه جدول *کمکی* اضافه شد (هیچ‌کدام «مدل اعتبار دوم» نیست):
- `StoreCreditRedemption` — **دفتر مصرف**. لازم بود چون «چندباره تا سقف مبلغ» یعنی یک اعتبار N
  مصرف دارد و هر مصرف مبلغ/فاکتور/پرداختی/کاربر خودش را می‌خواهد. ستون‌های قدیمی
  `usedAt/usedInvoiceId/usedReceiptNo/usedPaymentId` روی StoreCredit **دست‌نخورده** ماندند و
  همیشه «آخرین مصرف» را نشان می‌دهند تا هیچ گزارش قدیمی نشکند.
  `idempotencyKey` یکتاست ⇒ رسیدن دوباره‌ی همان درخواست، درج دوم را رد می‌کند (§۲۱).
- `StoreCreditBatch` — snapshot قواعد یک دسته‌ی تولید گروهی (§۵) + مبنای PDF چندصفحه‌ای.
- `CreditReminderLog` — زیرساخت یادآوری (§۱۴)، بدون هیچ اتصال واقعی پیامک.

### وضعیت‌ها (§۱۱) — تصمیم اصلاحی آگاهانه
سند مرجع `FULLY_USED` / `VOIDED` پیشنهاد داده بود. این دو **پیاده نشدند به‌عنوان مقدار جدید**،
چون `USED` و `CANCELED` همین حالا در دیتابیس فروشگاه، در `STORE_CREDIT_STATUS_LABELS` و در
`SalesService` / `accountingReport` / `CashboxService` استفاده می‌شوند؛ تغییر نامشان = مهاجرت داده
+ ریسک شکستن کد سالم، بدون هیچ سود عملی. پس در `src/shared/credit.ts`:
`CREDIT_STATUS_ALIASES = { FULLY_USED: USED, VOIDED: CANCELED }` و سه وضعیت **واقعاً جدید**
اضافه شد: `DRAFT`, `PARTIALLY_USED`, `SUSPENDED`. هیچ قابلیتی حذف نشد، فقط نام‌گذاری تاریخی حفظ شد.
Status Machine کامل با شرط هر Transition در `CREDIT_TRANSITIONS` + `canCreditTransition` است و
هیچ مسیری نباید ستون status را مستقیم عوض کند.

### یکتایی واقعی کد (§۶)
`code` حالا در سطح دیتابیس `@unique` است. migration قبل از ساختن UNIQUE INDEX، کدهای
تکراریِ *تاریخی* را نجات می‌دهد: کد اصلی در ستون جدید `legacyCode` می‌ماند و ردیف‌های
قدیمی‌تر با پسوند `X<id>` بی‌تصادم می‌شوند — **جدیدترین ردیف هر کد، کدش را نگه می‌دارد** تا
بارکدی که دست مشتری است همچنان کار کند.

### موتور قواعد مشترک (§۴، §۱۸، §۲۱)
`src/shared/credit.ts` (۱۰۹۵ خط، خالص و بدون DB) تنها منبع حقیقت قواعد است تا UI و Backend
هیچ‌وقت دو حرف متفاوت نزنند؛ ولی **نقطه‌ی اعمال** فقط سرویس main است (UI هیچ‌وقت مرجع نیست).
مهم‌ترین توابعش:
- `decideRedeem()` — همزمان وضعیت، باقی‌مانده، دفعات باقی‌مانده، تاریخ انقضا، قفل مشتری،
  حداقل خرید، محدودیت کالا/دسته، سقف هر تراکنش و مبلغ درخواستی را با هم چک می‌کند (نه یکی‌یکی).
- `statusAfterRedeem()` — تفکیک قطعی «یک‌بارمصرف» از «چندباره»: یک‌بارمصرف با اولین مصرف
  حتی جزئی، قطعاً می‌بندد.
- `assessCodeSpace()` — قبل از شروع، کفایت فضای کد را حساب می‌کند؛ ناکافی ⇒ خطای فارسی با
  تعداد کدهای ممکن + پیشنهاد افزایش طول (بدون silently fail/overwrite)، و اگر
  «افزایش خودکار طول» روشن باشد، طول رشد می‌کند و **قابل مشاهده** گزارش می‌شود (`grown`).
- `evaluateEligibility()` — کدام اقلام سبد با محدودیت این اعتبار پوشش داده می‌شوند (با
  پشتیبانی دسته‌ی پدر از طریق `categoryPath`).
- `reminderDecision()` — منطق «باید بفرستد یا نه» کامل کار می‌کند (Opt-out، فاصله‌ی مجاز،
  سقف تعداد، نزدیک انقضا، N روز از صدور) درحالی‌که هیچ پیامکی ارسال نمی‌شود.
- `parseCreditSettings()` / `DEFAULT_CREDIT_SETTINGS` — تنظیمات §۲۲ با پیش‌فرض
  MANUAL = ۳۰ روز/۱ بار و EXCHANGE = ۷ روز/۱ بار.

### دسترسی (§۲۰) — بدون RBAC جدید
چهار کلید طبق قرارداد رسمی بالای `panels.ts`: `creditManagement`, `creditBulkIssue`,
`creditVoid`, `creditSettings` (کلید + ردیف `LOCKED_PANELS`). چهار تا و نه یکی، چون سه سطح
خطرِ متفاوت است (دیدن/صدور تکی ≠ تولید گروهی ≠ ابطال و تغییر مبلغ).

### Rate Limit کد اعتبار (§۸) — بدون سیستم جدید
گیت مستقل `CREDIT_CODE_GATE = '__credit_code__'` روی **همان** جدول `AuthLockout` و همان
`securityConfig`. سه تابع صادرشده در `AuthService.ts`: `assertCreditCodeGateOpen`,
`noteCreditCodeFailure`, `noteCreditCodeSuccess`.
⚠️ قاعده‌ی ثبت‌شده: این توابع هرگز داخل `$transaction` باز صدا زده نمی‌شوند (نوشتن با
کلاینت سراسری وسط تراکنش = همان بن‌بست SQLite که AuditService توضیح داده)؛ نقطه‌ی اعمال،
مسیر *جست‌وجوی* کد است — که سطح حمله‌ی واقعی هم همان است.

## ۲) چه چیزی کامل شد (با نام فایل)

| فایل | وضعیت |
|---|---|
| `prisma/schema.prisma` | ✅ `code @unique` + ۳۲ ستون جدید StoreCredit + سه مدل جدید + ۶ ایندکس تازه |
| `prisma/migrations/20270922100000_credit_management/migration.sql` | ✅ additive، با نجات کدهای تکراری تاریخی |
| `prisma/manual/20270922_credit_management.sql` | ✅ نسخه‌ی قرینه (قرارداد پروژه) |
| `src/shared/credit.ts` | ✅ **جدید** — موتور قواعد خالص (۱۰۹۵ خط) |
| `src/shared/enums.ts` | ✅ وضعیت‌های جدید + ۱۸ `AuditAction` تازه‌ی اعتبار |
| `src/shared/panels.ts` | ✅ ۴ کلید پنل + ۴ ردیف `LOCKED_PANELS` + `CREDIT_CODE_GATE` + `gateTitle` |
| `src/shared/receipt.ts` | ✅ `SETTING_KEYS.creditSettings = 'credit.settings'` |
| `src/main/services/AuthService.ts` | ✅ سه تابع گیت کد اعتبار روی همان AuthLockout |

## ۳) چه چیزی **اصلاً شروع نشد**
`StoreCreditService.ts` (دست‌نخورده، همان رفتار قبلی)، `NotificationSender.ts`،
`src/shared/types.ts`، `src/shared/ipc.ts` + `src/main/ipc/index.ts`،
`print/templates.ts` + `PrintService.ts` (سند اعتبار و PDF گروهی)، `SettingsService`
(creditSettings)، `SalesService` (مسیر مصرف چندباره/idempotency)، `Pos.tsx`،
`SalesReturn.tsx`، `SalesReports.tsx`، همه‌ی صفحه‌های renderer ماژول، `main.tsx`/`Shell.tsx`،
و `test/acceptance-session20.mjs`.

## ۴) سازگاری
هیچ رفتار موجودی عوض نشده: تمام تغییرها یا افزودنی‌اند یا پیش‌فرضشان دقیقاً همان رفتار قبل است.
تنها تغییر «سخت» یکتا شدن `code` است که migration خودش بی‌خطر اعمالش می‌کند.
مثل جلسه‌های قبل، قبل از استفاده در فروشگاه:
`npm install && npx prisma generate && npm run typecheck && npm run build`.
