# جلسه ۴۸ — مرحله ۱ («برداشت خودکار فقط از انبار مرکزی») **تمام و سبز** · مرحله ۲/۳/۴ شروع نشد

## صداقت فنی (اول از همه)
* `npm` **بیست‌وششمین نشست پیاپی** نبود. `node` هست (v22.23.1) ولی `npm`/`npx` روی سیستم
  نیستند و شبکه هم در دسترس نیست ⇒ `npm install` · `prisma generate` · `npm run typecheck`
  **اجرا نشد**. پس:
  * **هیچ فایلی `tsc` ندیده** (نه فایل‌های این جلسه، نه ارث جلسه‌های ۴۲–۴۷).
  * `@prisma/client` تازه تولید نشد؛ هارنس خودمان (`test/harness`) جایش کار کرد.
  * **هیچ UI ای رندر نشد** (نه در این جلسه چیزی رندری نوشته شد، نه می‌شد رندر کرد).
* چیزی که **واقعاً اجرا شد و سبز است**:

  | سوییت | نتیجه |
  |---|---|
  | `test/acceptance-db-session48.mjs` (**تازه**) | **۲۹ PASS · ۰ FAIL** |
  | `test/stock-source-logic-session47.mjs` | ۶۰ PASS · ۰ FAIL (بی رگرسیون) |
  | `test/acceptance-db-session47.mjs` | ۹۷ PASS · ۰ FAIL (بی رگرسیون) |
  | `test/acceptance-db-session35.mjs` | ۲۰۴ PASS · ۰ FAIL (بی رگرسیون) |
  | `test/acceptance-db-session36.mjs` | ۱۳۷ PASS · ۰ FAIL (بی رگرسیون) |
  | `test/acceptance-db-session40.mjs` | ۱۸۵ PASS · ۰ FAIL (بی رگرسیون) |
  | `test/acceptance-src-session46.mjs` | ۳۶ PASS · ۰ FAIL (بی رگرسیون) |
  | `tools/tsx-parse-check.mjs` روی ۲ فایل لمس‌شده | هر ۲ سالم |

  سرجمع: **۷۴۸ PASS · ۰ FAIL**.
* ⛔ **مرحله‌ی ۲، ۳ و ۴ پرامپت شروع نشد** (سقف اجرا رسید). `StockSourceModal.tsx` ساخته نشد و
  `SalesInvoice.tsx` / `Pos.tsx` **دست نخوردند**. یعنی کاربر هنوز پنجره‌ی «از کدام انبار کسر
  شود؟» را نمی‌بیند و رفتار آن دو پنل — جز اثر مرحله ۱ — مو‌به‌مو همان قبل است.
  جزئیات کامل و نقطه‌ی شروع در `HANDOFF-ادامه-توسعه.md`.

---

## ⚠️ تغییر رفتار (مالک تأییدش کرده بود — قاعده‌ی نهایی)

### `secondaryStockService.coverShortage` فقط از **انبار مرکزی پیش‌فرض** برمی‌دارد
تا جلسه ۴۷، این تابع `SecondaryStockItem` را **بی هیچ فیلتر `warehouseId`** می‌خواند. یعنی
تیک «برداشت خودکار از انبار مرکزی» در عمل «برداشت خودکار از هر انباری که تطبیق بخورد» بود و
موجودی یک شعبه‌ی دیگر می‌توانست بی‌خبر خالی شود. از این نسخه:

* منبع برداشت خودکار فقط «انبار مرکزی پیش‌فرض» است. تعریفش **عیناً** همان قرارداد بخش ۵ و
  همان تصمیمی است که `warehouseList` و `StockAllocationService.preview` می‌گیرند:
  ردیف‌های `warehouseId = NULL` **به‌علاوه‌ی** ردیف‌های وصل به ردیف واقعیِ `isDefault`
  (در دیتابیس واقعی، آن ردیف از migration وجود دارد: «انبار مرکزی»). پس سه‌جا یک تعریف
  دارند، نه سه تعریف.
* هر انبار دیگری (شعبه، اجاره‌ای، …) **مطلقاً دست نمی‌خورد**.
* باقی‌ماندهٔ پوشش‌داده‌نشده **مثل قبل** روی موجودی فروشگاه منفی می‌رود و هشدار زرد می‌گیرد.
  این قسمت عمداً عوض نشد.

**اثرش روی سه مسیر است و هر سه تست شدند:** `SalesService.create` (فروش تکی **و** فاکتور
عمده) · `SalesService.update` (ویرایش) · `SalesService.createExchange` (تعویض).

### مبدأ کسر در پیام/نتیجه روشن شد
* متن هشدار حالا **نام انبار مبدأ** را می‌گوید (`… از «انبار مرکزی» کسر شد`) و هر ردیف را
  با انبارش نشان می‌دهد (`انبار مرکزی → ردیف الف: ۳ عدد برداشته شد، ۱ باقی ماند`).
* اگر کالا در انباری **غیر از** مرکزی موجودی مثبت داشته باشد، هشدار **صریحاً** می‌گوید کجا
  هست، چرا از آن برداشته نشد، و راهش چیست: «تیک را خاموش کنید و انبار مبدأ را خودتان
  انتخاب کنید». هیچ برداشتی پنهان نمی‌ماند و هیچ کاربری گیج نمی‌شود.
* `CentralWithdrawLine` (در `shared/types.ts`) دو فیلد گرفت: `warehouseName` روی خود قلم، و
  `warehouseId`/`warehouseName` روی هر ردیف `sources`. پس مصرف‌کننده‌ی UI هم بی تطبیق متن
  می‌فهمد از کجا برداشته شده. **هیچ فیلدی حذف یا تنگ‌تر نشد** (افزایشی محض).
* یادداشت `AuditLog` هم نام انبار را می‌نویسد.

---

## فایل‌های تغییرکرده‌ی این نشست
**تازه:** `test/acceptance-db-session48.mjs` · `CHANGELOG-جلسه۴۸.md`

**ویرایش‌شده:** `src/main/services/SecondaryStockService.ts` (فیلتر `coverShortage` + متن
هشدارها + یادداشت AuditLog + سرفصل فایل) · `src/shared/types.ts` (`CentralWithdrawLine`،
افزایشی) · `HANDOFF-ادامه-توسعه.md`

**دست نخورد:** `panels.ts` · `prisma/schema.prisma` · هیچ migration · `stockSource.ts` ·
`StockAllocationService.ts` · `SalesService.ts` · `ipc` · **هیچ فایل رندرری** ·
**هیچ عدد مالی**.

---

## سوییت تازه — `test/acceptance-db-session48.mjs` (۲۹ گزاره)
۱) انبار مرکزی ۴ تا دارد و شعبه ۹۹ تا ⇒ فقط ۴ برداشته می‌شود، شعبه **۹۹ می‌ماند**، فروشگاه
   منفی می‌رود، هشدار هر دو را توضیح می‌دهد، و مسیر تیک **هیچ ردیف دفتری نمی‌سازد**.
۲) موجودی **فقط** در شعبه ⇒ هیچ برداشتی نمی‌شود، شعبه دست‌نخورده، فروشگاه منفی + هشدارِ
   «پیدا نشد» که محل واقعی کالا را هم می‌گوید. (همان سناریوی صریح پرامپت.)
۳) ردیف وصل به ردیف واقعیِ `isDefault` + ردیف بی‌انبار ⇒ **هر دو** مرکزی شمرده می‌شوند.
۴) سند تعویض با تیک روشن ⇒ همان قاعده، شعبه دست‌نخورده.
۵) ویرایش فاکتور با تیک روشن ⇒ همان قاعده روی *اختلاف*، شعبه دست‌نخورده.

---

## دستورهایی که کاربر باید اجرا کند
```bash
npm install
npm run db:generate
npm run typecheck                  # هنوز هیچ فایلی از جلسه ۴۲ تا ۴۸ tsc ندیده است

# migration جلسه ۴۷ (اگر قبلاً اجرا نشده) — افزایشی محض، فقط یک جدول تازه و ایندکس‌هایش
npx prisma migrate deploy          # یا: prisma/manual/20270925_sale_item_stock_allocation.sql
# این جلسه هیچ migration تازه‌ای ندارد.

# سوییت تازه‌ی این جلسه (بی node_modules)
node --import ./test/harness/register.mjs test/acceptance-db-session48.mjs   # ⇒ ۲۹ PASS

# بدون رگرسیون
node --import ./test/harness/register.mjs test/stock-source-logic-session47.mjs  # ⇒ ۶۰
node --import ./test/harness/register.mjs test/acceptance-db-session47.mjs       # ⇒ ۹۷
node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs       # ⇒ ۲۰۴
node --import ./test/harness/register.mjs test/acceptance-db-session36.mjs       # ⇒ ۱۳۷
node --import ./test/harness/register.mjs test/acceptance-db-session40.mjs       # ⇒ ۱۸۵
node test/acceptance-src-session46.mjs                                          # ⇒ ۳۶
```

## چشمی چک کنید (چون رندر نشد)
تیک «برداشت خودکار» را روشن کنید، کالایی بفروشید که موجودی فروشگاهش کم است و موجودی‌اش
**فقط در یک انبار شعبه** است: انتظار درست = موجودی شعبه **عوض نشود**، موجودی فروشگاه منفی
برود، و هشدار زرد بگوید کالا در آن شعبه هست ولی برداشت خودکار فقط از انبار مرکزی است.
