# جلسه ۴۹ — **اولین typecheck واقعی پروژه** انجام شد · شش خطای تایپ واقعی رفع شد · مرحله ۱-ب/۲/۳/۴ شروع نشد

## صداقت فنی (اول از همه)
* `npm` **بیست‌وهفتمین نشست پیاپی** نبود (`npm`/`npx` نصب نیستند و شبکه نیست) ⇒
  `npm install` · `npm run db:generate` · `npm run typecheck` **اجرا نشد**.
* ⛔ **مرحله ۱-ب، ۲، ۳ و ۴ این پرامپت شروع نشد** (سقف اجرای نشست وسط مطالعه‌ی کد رسید).
  `StockSourceModal.tsx` **ساخته نشد**؛ `SalesInvoice.tsx` · `Pos.tsx` · `SalesService.ts` ·
  `panels.ts` · `PrintService.ts` · schema · migration ها · **کل رندرر دست نخوردند**.
  یعنی رفتار برنامه برای کاربر **مو‌به‌مو همان پایان جلسه ۴۸** است و هیچ چیزی نشکسته.
* ✅ ولی یک گره‌ی ۲۷-نشستی باز شد: **خودِ کامپایلر TypeScript روی این محیط موجود بود**
  (`typescript@5.6.3` — دقیقاً همان نسخه‌ی `package.json`). تنها مانع، *تایپ وابستگی‌های
  نصب‌نشده* بود. با یک شیم، **همه‌ی ۱۸۲ فایل `src` برای اولین بار از جلسه ۴۲ به بعد
  کامپایل شدند** و شش خطای تایپ **واقعی** پیدا و رفع شد.

---

## ۱) ابزار تازه — `tsconfig.typecheck.json` + `tools/typecheck-shim.d.ts`
اجرا (بی `node_modules` پروژه، فقط با یک نسخه‌ی `typescript` در دسترس):

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json
```

شیم هر وابستگی نصب‌نشده را با «اعلان کوتاه ماژول» (shorthand ambient module) `any` می‌کند:
`@prisma/client` · `electron` · `electron-updater` · `bwip-js` · `jalaali-js` ·
`react-router-dom` · تایپ‌های `node` (`process`/`Buffer`/`node:fs`/…).

**چه چیزی گرفته می‌شود:** تایپ‌های خودِ پروژه (`shared/*`)، امضای توابع و سرویس‌ها،
props کامپوننت‌ها، ایمپورت/نام ناموجود، یونیون ناسازگار، `strictNullChecks`،
`strictFunctionTypes`. ← **هیچ ابزاری در این پروژه تا امروز این‌ها را نمی‌گرفت**
(`tsx-parse-check.mjs` فقط نحو را می‌بیند، نه تایپ).

**چه چیزی گرفته نمی‌شود (و ادعا هم نمی‌شود):** هر چیزی که تایپش از `@prisma/client` و
`electron` می‌آید. پس `npm run typecheck` واقعی **هنوز لازم است** و جایگزین ندارد.
`noImplicitAny` در همین یک فایل کانفیگ خاموش است (وگرنه هر callback روی نتیجه‌ی `any`
یک خطای بی‌معنی می‌سازد)؛ در `tsconfig.json` اصلی دست‌نخورده و روشن است.

### نتیجه‌ی عددی
| مرحله | خطا |
|---|---|
| اولین اجرا (شیم اول، `noImplicitAny` روشن) | ۶۷۳ |
| شیم درست + `noImplicitAny: false` | ۲۱۴ |
| **بعد از رفع شش خطای واقعی** | **۱۹۶** |

و **هر ۱۹۶ خطای باقی‌مانده، اثر خودِ شیم است**، نه باگ پروژه. الگویشان چهار چیز است و
همه از یک ریشه می‌آیند (`@prisma/client` = `any`):
1. `new Map(anyRows.map(...))` ⇒ TS کلید/مقدار را `{}` استنتاج می‌کند ⇒ خطاهای
   «`'{}'` is not assignable to `number`/`string`» (SalesService · accountingReport ·
   PriceAdjustService · MergeService · StockCountService · SalesLedger · CashboxService ۲۲۴).
2. `Prisma.XWhereInput` ⇒ `TS2694` (شیم namespace ندارد).
3. `tx.$queryRaw<T>()` ⇒ `TS2347` «Untyped function calls may not accept type arguments».
4. `BrowserWindow`/`Buffer` به‌عنوان *تایپ* ⇒ `TS2709`/`TS2749`.

با `npm install` + `npm run db:generate` هیچ‌کدامشان نباید ظاهر شود. **اگر ظاهر شدند،
همان‌جا خطای واقعی است** — این فهرست را همان موقع مبنا بگیرید.

---

## ۲) شش خطای تایپ **واقعی** که رفع شد (هر شش‌تا در `npm run typecheck` واقعی هم خطا بودند)

| فایل | خطا | رفع |
|---|---|---|
| `src/shared/pendingRestock.ts` | امضای `digits: (v: unknown) => string` ⇒ `faDigits` با `strictFunctionTypes` **هیچ‌وقت** قابل پاس دادن نبود (contravariance). **۱۰ نقطه‌ی صدا زدن** سرخ بود: `SalesService` ۲۵۷۱/۳۱۵۳ · `CardTransferService` ۳۱۱/۳۶۱/۴۵۰/۴۷۷ · `PendingRestockService` ۲۸۴ · `CardTransferPanel.tsx` ۳۸۷ · `usePendingRestock.ts` ۱۲۸/۱۲۹ | همان امضایی که `creditUi.ts` از جلسه ۳۳ **درست** داشت: `(v: string \| number) => string`؛ و برای `money` که در پروژه `(n: number, persian?: boolean)` است: `(v: number) => string` |
| `src/shared/types.ts` | `ExchangeSaleInput` فیلد `full` نداشت ولی `SalesService.createExchange` خط ۲۶۴۸ می‌خواندش و پنل تعویض می‌فرستدش (`TS2339`) | `full?: boolean` — **افزایشی محض** |
| `src/shared/creditUi.ts` | `CreditBadge.tone: CreditTone` و **`CreditTone` هیچ‌جا تعریف نشده بود** (`TS2552`) | `export type CreditTone = …` و `DashboardCard.tone` هم روی همان نشست (یک تعریف، نه دو) |
| `src/main/services/CashboxService.ts` ۵۷۲ | `let closedShift = null` ⇒ با `strictNullChecks` تایپش `null` است، پس انتساب شیفت خطا بود (`TS2322`) | `let closedShift: Awaited<ReturnType<typeof shiftService.close>> \| null = null` |
| `src/main/services/VariantPurgeService.ts` ۲۰۰ | `const lines = []` ⇒ `never[]`، پس `push` و خواندن فیلدها خطا بود (۵ خطا) | تایپ صریح آرایه |

**هیچ عدد مالی، هیچ رفتار اجرایی، هیچ schema و migration ای عوض نشد.** هر پنج فایل فقط
*تایپ* و annotation گرفتند؛ خروجی زمان اجرا بیت‌به‌بیت همان است.

---

## ۳) رگرسیون — کامل و سبز (بعد از همین تغییرها)
| سوییت | نتیجه |
|---|---|
| `test/acceptance-db-session48.mjs` | ۲۹ PASS · ۰ FAIL |
| `test/stock-source-logic-session47.mjs` | ۶۰ PASS · ۰ FAIL |
| `test/acceptance-db-session47.mjs` | ۹۷ PASS · ۰ FAIL |
| `test/acceptance-db-session35.mjs` | ۲۰۴ PASS · ۰ FAIL |
| `test/acceptance-db-session36.mjs` | ۱۳۷ PASS · ۰ FAIL |
| `test/acceptance-db-session40.mjs` | ۱۸۵ PASS · ۰ FAIL |
| `test/acceptance-src-session46.mjs` | ۳۶ PASS · ۰ FAIL |

سرجمع: **۷۴۸ PASS · ۰ FAIL** (بی هیچ رگرسیونی). هیچ سوییت تازه‌ای این نشست نوشته نشد،
چون هیچ رفتار تازه‌ای هم اضافه نشد.

⚠️ `tools/tsx-parse-check.mjs` روی یکی از فایل‌های لمس‌شده «رشته‌ی بسته‌نشده» گزارش داد.
**اخطار دروغ است:** خودِ `tsc` هر ۱۸۲ فایل را کامل parse کرد و **هیچ خطای `TS1xxx`
(نحوی) نداد**. آن ابزار یک اسکنر سطحی است و با متن فارسی/کوتیشن داخل رشته گیج می‌شود؛
از این نشست به بعد **`tsc` مرجع است، نه parse-check**.

---

## فایل‌های تغییرکرده‌ی این نشست
**تازه:** `tsconfig.typecheck.json` · `tools/typecheck-shim.d.ts` · `CHANGELOG-جلسه۴۹.md`

**ویرایش‌شده (فقط تایپ):** `src/shared/pendingRestock.ts` · `src/shared/types.ts` ·
`src/shared/creditUi.ts` · `src/main/services/CashboxService.ts` ·
`src/main/services/VariantPurgeService.ts` · `HANDOFF-ادامه-توسعه.md`

**دست نخورد:** `SalesService.ts` · `StockAllocationService.ts` · `SecondaryStockService.ts` ·
`stockSource.ts` · `panels.ts` · `ipc` · schema · migration ها · **کل رندرر** ·
**هیچ عدد مالی**.

---

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npm run typecheck        # ← مرجع نهایی. فهرست «۱۹۶ خطای شیمی» بالا را برای مقایسه ببینید

# migration جلسه ۴۷ (اگر قبلاً اجرا نشده) — افزایشی محض
npx prisma migrate deploy      # یا: prisma/manual/20270925_sale_item_stock_allocation.sql
# این جلسه هیچ migration تازه‌ای ندارد.

# typecheck بی‌نیاز به npm (همان ابزار تازه‌ی این جلسه)
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json

# رگرسیون کامل (بی node_modules) ⇒ ۷۴۸ PASS
node --import ./test/harness/register.mjs test/acceptance-db-session48.mjs        # ۲۹
node --import ./test/harness/register.mjs test/stock-source-logic-session47.mjs   # ۶۰
node --import ./test/harness/register.mjs test/acceptance-db-session47.mjs        # ۹۷
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs        # ۲۰۴
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs        # ۱۳۷
node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs        # ۱۸۵
node test/acceptance-src-session46.mjs                                           # ۳۶
```
