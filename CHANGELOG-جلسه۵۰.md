# جلسه ۵۰ — **مرحله ۱-ب تمام و سبز**: برداشت انبار در «تعویض کالا» قابل‌ردیابی شد · مرحله ۲/۳/۴ شروع نشد

## صداقت فنی (اول از همه)
* ⛔ **مرحله ۲ (فاکتور فروش عمده) این نشست شروع نشد.** `components/StockSourceModal.tsx`
  **ساخته نشد** و `pages/SalesInvoice.tsx` · `Pos.tsx` · `panels.ts` · `PrintService.ts` ·
  `templates.ts` · schema · migration ها **دست نخوردند**. کاربر هنوز منوی «کسر از انبار» و
  پنجره‌ی «از کدام انبار کسر شود؟» را در فاکتور عمده نمی‌بیند.
* ✅ طبق دستور صریح پرامپت («اگر جا کم آمد فقط بند اول را کامل تحویل بده»)، **مرحله ۱-ب کامل،
  تست‌شده و بی رفتار نیمه‌کاره** تحویل شد. هیچ بخش نصفه‌ای در کد نمانده است.
* ✅ `typescript@5.6.3` (همان نسخه‌ی `package.json`) روی این محیط پیدا شد و به
  `node_modules/typescript` وصل شد، پس شیم جلسه ۴۹ واقعاً اجرا شد:
  **۱۹۶ خطا — مو‌به‌مو همان ۱۹۶ خطای جلسه ۴۹، بی هیچ خطای تازه‌ای.** (تنها تفاوت، جابه‌جایی
  شماره‌ی خط‌ها بر اثر خط‌های اضافه‌شده است؛ متن و ستون هر خطا یکی است.)
* `npm` بیست‌وهشتمین نشست پیاپی نبود ⇒ `npm install` · `db:generate` · `npm run typecheck`
  واقعی **اجرا نشد**. مرجع نهایی همان است، نه شیم.
* ⚠️ **هیچ عدد مالی، هیچ رفتار برداشت، هیچ schema و هیچ migration ای عوض نشد.**

---

## مرحله ۱-ب — «از کدام انبار برداشته شد» در تعویض: ثبت + نمایش

### قاعده‌ای که *عوض نشد* (مهم‌ترین نکته)
`createExchange` همان‌طور که بود کمبود کالای جایگزین را **فقط با تیک روشن** و **فقط از انبار
مرکزی پیش‌فرض** برمی‌دارد. `coverShortage` **از جای خودش تکان نخورد** (خط 2803)، چون آن
لحظه هنوز سند تعویض ساخته نشده و `refId` وجود ندارد. تنها چیزی که اضافه شد **ثبت و نمایش** است،
*بعد از* ساخته شدن سند.

### ۱) لایه‌ی مشترک — `src/shared/stockSource.ts` (افزایشی محض، بی هیچ import تازه)
| نام | کار |
|---|---|
| `CENTRAL_WITHDRAW_TAG` | تگ ثابت `[برداشت-انبار]` — تا خواندن سابقه هیچ‌وقت «تطبیق متن فارسی» نشود |
| `centralWithdrawGroups(taken)` | `CentralWithdrawLine[]` ⇒ جمع برداشت **به تفکیک انبار** (از `sources[].warehouseName`، همان داده‌ی آماده‌ی جلسه ۴۸) |
| `centralWithdrawTotal` / `centralWithdrawShortLine` / `centralWithdrawSentence` | جمع و متن‌های نمایشی — **یک جمله**، سه مصرف‌کننده (پنل، سابقه، گزارش) |
| `buildCentralWithdrawNote` / `parseCentralWithdrawNote` / `stripCentralWithdrawNote` | نوشتن و خواندن و پاک‌کردن تگ در `SaleReturn.note` |

نکته‌های عمدی:
* متن پشت تگ **خوانا**ست، نه JSON — چون همین `note` روی «سند برگشت/تعویض» چاپ می‌شود
  (`PrintService` ⇒ `d.note`) و در خروجی اکسل تب برگشت هم می‌آید.
* `parseCentralWithdrawNote` رقم **فارسی و عربی و لاتین** را می‌خواند (نرمال‌ساز محلی و خالص).
* نام انبار قبل از نشستن در تگ از جداکننده‌ها پاک می‌شود، پس خواندن دوباره هیچ‌وقت ابهام ندارد.
* `note` بی تگ ⇒ `null`، که **دقیقاً همان معنای «کسر از انبار فروشگاه»** است. پس هر تعویضِ
  قبل از جلسه ۵۰ بی هیچ migration ای درست نمایش داده می‌شود.

### ۲) `SalesService.createExchange`
* خط 3213 — `centralGroups` + `centralSentence` ساخته می‌شوند و اگر برداشتی بوده،
  `tx.saleReturn.update({ where: { id: back.id }, data: { note: buildCentralWithdrawNote(returnNote, …) } })`
  **داخل همان تراکنش**. متن پایه‌ی note به یک const (`returnNote`) تبدیل شد تا توضیح کاربر گم نشود.
* `audit(SALE_EXCHANGE)`: هم `after` (`centralWithdrawals` / `centralWithdrawnQty`) و هم
  `note` همان جمله را گرفتند.
* نتیجه‌ی `createExchange` (خط 3281) چهار فیلد گرفت: `centralWithdrawals` ·
  `centralWithdrawnQty` · `centralWithdrawSources` · `centralWithdrawText`.
  (تا این نسخه نتیجه‌ی تعویض **هیچ‌وقت** `central` را برنمی‌گرداند، برخلاف `create`.)
* `shared/types.ts` · `ExchangeSaleResult`: همان چهار فیلد، همه **اختیاری** ⇒ افزایشی محض.

### ۳) نمایش
* `pages/SalesReturn.tsx` — جمله در پیام `flash` (خط 558) **و** یک برچسب آبی «برداشت از
  انبار: …» در کادر نتیجه‌ی سند تعویض. بی برداشت ⇒ چیزی دیده نمی‌شود (مثل قبل).
* `pages/SalesReports.tsx` · تب «تعویض کالا» — ستون تازه‌ی **«مبدأ برداشت»** (خط 250)،
  چسبیده به بلوک *جایگزین*. داده از `parseCentralWithdrawNote(r.note)` — و `exchangeList` از
  قبل `note` را برمی‌گرداند (خط 3441
3726)، پس **هیچ ستون تازه‌ای در دیتابیس لازم نشد**.
  ستون در جدول، چاپ A4 و خروجی اکسل (`exchangeRowValues`) هر سه آمد. خالی = «—».
  عرض ستون‌ها خودکار بازنشانی می‌شود (`useResizableColumns` تغییر تعداد ستون را می‌فهمد).

---

## تست
| سوییت | نتیجه |
|---|---|
| **`test/stock-source-note-session50.mjs` (تازه)** | **۲۶ PASS · ۰ FAIL** |
| `test/acceptance-db-session48.mjs` | ۲۹ PASS · ۰ FAIL |
| `test/stock-source-logic-session47.mjs` | ۶۰ PASS · ۰ FAIL |
| `test/acceptance-db-session47.mjs` | ۹۷ PASS · ۰ FAIL |
| `test/acceptance-db-session35.mjs` | ۲۰۴ PASS · ۰ FAIL |
| `test/acceptance-db-session36.mjs` | ۱۳۷ PASS · ۰ FAIL |
| `test/acceptance-db-session40.mjs` | ۱۸۵ PASS · ۰ FAIL |
| `test/acceptance-src-session46.mjs` | ۳۶ PASS · ۰ FAIL |

سرجمع: **۷۷۴ PASS · ۰ FAIL** (۷۴۸ قبلی + ۲۶ تازه، بی هیچ رگرسیونی).
سوییت تازه: گروه‌بندی به تفکیک انبار · جمع دو قلم از یک انبار · برداشت صفر · نام خالی ⇒ انبار
پیش‌فرض · رفت‌وبرگشت `build`/`parse` · **فاکتور قدیمی بی تگ ⇒ `null`** · تگ بی بدنه ·
رقم لاتین · نام انبار پرخطر (`:` و `؛` و `[]`) · جدا شدن توضیح کاربر از تگ.

⛔ **آنچه تست نشد (صادقانه):** سناریوهای مرحله ۲ (فاکتور عمده با انبار فروشگاه/مرکزی/X،
زنجیره‌ی سؤال‌ها، `STOCK_PLAN_STALE` از UI) — چون خودِ مرحله ۲ نوشته نشد. مسیر DB ی تعویض هم
سوییت تازه‌ی DB نگرفت؛ منطق خالصش کامل تست شد و `acceptance-db-session48` (که همین مسیر
تعویض را می‌زند) سبز ماند.

---

## فایل‌های تغییرکرده
**تازه:** `test/stock-source-note-session50.mjs` · `CHANGELOG-جلسه۵۰.md`

**ویرایش‌شده:** `src/shared/stockSource.ts` · `src/shared/types.ts` ·
`src/main/services/SalesService.ts` · `src/renderer/src/pages/SalesReturn.tsx` ·
`src/renderer/src/pages/SalesReports.tsx` · `HANDOFF-ادامه-توسعه.md`

**دست نخورد:** `SalesInvoice.tsx` · `Pos.tsx` · `StockSourceModal.tsx` (ساخته نشد) ·
`StockAllocationService.ts` · `SecondaryStockService.ts` · `panels.ts` · `ipc` ·
`PrintService.ts` · `templates.ts` · schema · migration ها · **هیچ عدد مالی**.

---

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npm run typecheck        # ← مرجع نهایی. باید همان الگوهای «۱۹۶ خطای شیمی» را *نبیند*

# این جلسه هیچ migration تازه‌ای ندارد.
# migration جلسه ۴۷ (اگر قبلاً اجرا نشده) — افزایشی محض:
npx prisma migrate deploy   # یا: prisma/manual/20270925_sale_item_stock_allocation.sql

# typecheck بی‌نیاز به npm (شیم جلسه ۴۹) ⇒ باید ۱۹۶ بدهد، نه بیشتر
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json

# رگرسیون کامل ⇒ ۷۷۴ PASS
node --import ./test/harness/register.mjs test/stock-source-note-session50.mjs   # ۲۶ (تازه)
node --import ./test/harness/register.mjs test/acceptance-db-session48.mjs       # ۲۹
node --import ./test/harness/register.mjs test/stock-source-logic-session47.mjs  # ۶۰
node --import ./test/harness/register.mjs test/acceptance-db-session47.mjs       # ۹۷
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs       # ۲۰۴
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs       # ۱۳۷
node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs       # ۱۸۵
node test/acceptance-src-session46.mjs                                          # ۳۶
```

### تست دستی که فقط کاربر می‌تواند بزند
۱) تعویض کالا با تیک **روشن** و کالای جایگزینی که موجودی فروشگاه کم دارد ⇒ در کادر نتیجه باید
   برچسب «برداشت از انبار: انبار مرکزی X» دیده شود، و در گزارشات فروش ← تب «تعویض کالا» ستون
   «مبدأ برداشت» همان را بگوید. «چاپ سند تعویض» هم باید همان جمله را در توضیح بیاورد.
۲) تعویض با تیک **خاموش** یا بی کمبود ⇒ هیچ برچسبی و ستون «—» (رفتار مو‌به‌مو مثل قبل).
۳) یک تعویضِ **قدیمی** (قبل از این نسخه) در گزارش ⇒ ستون «—»، بی هیچ خطایی.
