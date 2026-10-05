> # وضعیت پایان جلسه ۵۳ (آخرین نشست) — از همین‌جا ادامه بده
> * ✅ **مرحله ۴ کامل شد و با آن کل کار «انتخاب انبار مبدأ کسر» بسته است** (مراحل ۱، ۱-ب، ۲، ۲-ب، ۳، ۴ + بند ۰). شرح کامل در `CHANGELOG-جلسه۵۳.md`.
> * **متن قفل:** `shared/panels.ts` ردیف `PANEL_KEYS.posCentralWithdrawToggle` — `hint` حالا می‌گوید همین رمز دوم هم تیک «برداشت خودکار» و هم **انتخاب انبار مبدأ کسر در فروش تکی** را باز می‌کند. `key`/`title`/خود قفل دست نخوردند.
> * **رسید و چاپ A4:** `ReceiptData.stockSource` (`lines`/`short`/`hasNegative`) در `print/templates.ts` · `PrintService.receiptDataFor` از `stockAllocationService.summaryOf(invoiceId)` داخل `try` · بلوک `stockBlock` در `receiptHtml` بین `pays` و `codeBlock`، با استایل **inline** (پس `<style>` رسید و سه قالب دیگر دست‌نخورده‌اند). **بی‌دفتر ⇒ رشته‌ی خالی ⇒ رسید مو‌به‌مو مثل قبل.**
> * **کانال تازه لازم نشد:** `sale:stockSources` و `sale:stockSourcesMany` از جلسه ۴۷ بودند. تنها افزوده‌ی رندرر: **`hooks/useSaleStockSources.ts`** — تنها نقطه‌ی خواندن «مبدأ کسر» در UI (سقف ۵۰۰ شناسه · خطا ⇒ ستون خالی · کلید متنی برای پایداری `useEffect`).
> * **فهرست عمده:** ستون «مبدأ کسر» بعد از «کسر موجودی»، **`colSpan={12}` ⇒ `13`**.
> * **گزارش فروش:** ستون به `SUMMARY_HEADERS` (آخرین ستون داده) · `summaryRowValues(r, source = '')` ⇒ جدول + چاپ A4 + اکسل یکی · `ShiftGroups` با prop `sourceOf` · ردیف‌های جمع `colSpan={2}` ⇒ `3` · ستون «مبدأ برداشت» تب تعویض (جلسه ۵۰) **دست نخورد**.
> * متن‌ها یک‌جا در `STOCK_PICK_TEXT`: `columnTitle` · `columnExplainer` · `emptyCell` · `receiptTitle` · `receiptNegativeNote` (+ `summaryHasNegative` در `shared/stockSource.ts`).
> * ⛔ `npm install` · `db:generate` · `typecheck` · `tsc` و رگرسیون کامل **اجرا نشدند**. فقط `tools/tsx-parse-check.mjs` (۷ فایل PASS) و سوییت تازه‌ی **ایستا**: **`test/stock-source-display-session53.mjs` ⇒ ۶۰ PASS · ۰ FAIL**. انتظار رگرسیون کامل: ۹۱۵ + ۶۰ = **۹۷۵ PASS**. مرجع نهایی `npm run typecheck`.
> * ⛔ **هیچ چاپی گرفته نشد، هیچ اکسلی ساخته نشد، هیچ migration/schema ای عوض نشد، هیچ عدد مالی و هیچ موجودی‌ای عوض نشد.** `SalesService` و `StockAllocationService` یک کاراکتر هم عوض نشدند.
>
> ## ❌ نشست بعد — کار باقی‌ماندهٔ این پرونده: **هیچ.** این‌ها فقط نکات باز و بی‌خطرند
> ۱) **تست دستی مالک** (فهرست کامل پایین `CHANGELOG-جلسه۵۳.md`): چاپ رسید با مبدأ غیرفروشگاه، رسید فاکتور قدیمیِ بی‌دفتر (باید مو‌به‌مو مثل قبل باشد)، ستون فهرست و گزارش، چاپ A4 و اکسل، و متن تازه‌ی قفل در تنظیمات.
> ۲) **سند تعویض و سند برگشت** (`exchangeReceiptHtml` · `returnReceiptHtml`) عمداً بلوک «مبدأ کسر» نگرفتند — مالک نخواسته بود و تب تعویض ستون «مبدأ برداشت» خودش را از جلسه ۵۰ دارد. اگر روزی خواست، همان `stockBlock` را با `summaryOf` سند مربوطه تکرار کنید.
> ۳) نکته‌ی باز جلسه ۵۲ **همان‌طور باز است** (بی‌خطر): ویرایش فیشِ فروش تکیِ دفتردار را `SalesService.update` رد می‌کند (خط ~۱۸۳۰ فقط `WHOLESALE` را برای `editPlan` می‌پذیرد). امروز مسیر کاربری‌اش وجود ندارد؛ اگر روزی ویرایش فیش اضافه شد، همان دو خط باید `INTERNAL`ـِ تأییدشده را هم بپذیرند.
> ۴) گزارش فروش، تب سرجمع، برای هر بازه یک `saleStockSourcesMany` می‌زند (سقف ۵۰۰ شناسه). اگر روزی بازه‌های خیلی بزرگ کند شد، صفحه‌بندی یا کش سمت سرویس اضافه شود — امروز نیازی دیده نشد.
> ۵) بعد از هر تغییر: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json` و مقایسه با ۱۹۶ خطای شیم — **هر خطای تازه در فایل‌های لمس‌شده واقعی است**.

> # وضعیت پایان جلسه ۵۲ (آخرین نشست) — از همین‌جا ادامه بده
> * ✅ **بند ۰ (رفع سرور) و مرحله ۳ (فروش تکی با قفل) کامل و بی بخش نیمه‌کاره‌اند**
>   (شرح کامل در `CHANGELOG-جلسه۵۲.md`).
> * **بند ۰:** `SalesService.update` خط **~۱۸۵۷** ⇒ `if (editPlan && !hadAllocations) throw`.
>   فاکتور بی‌دفتر + `stockPlan` حالا با پیام روشن **رد** می‌شود (نه «لحاظ کردن `delta.increase`»
>   که HANDOFF جلسه ۵۱ پیشنهاد داده بود: `delta` نمی‌داند کسر قبلی از کدام انبار بوده، پس هر
>   برگشتی حدس است). شرط عمداً **قبل از** `allocationPath`/`reverseWholeInvoice`/`dropAllocations`
>   است ⇒ خطا هیچ نوشتنی ندارد. **این گپ بسته شد.**
> * **مرحله ۳:** `Pos.tsx` — `stockPickUnlocked` (خط ~۳۵۳) · `usePanelLock` (~۳۶۰) ·
>   `stockChain`/`stockPlanNote` (~۳۶۳) · `nameOfVariant` (~۶۹۹) · `askStockChain` (~۷۰۵) ·
>   `resolveStockPlan` (~۷۳۷) · حلقه‌ی ثبت با سقف تلاش در `settle` (~۸۶۳) · کادر آبی (~۱۴۹۵) ·
>   `<StockSourceModal>` (~۱۹۰۸). قفل سرور: `SalesService.create` **~۱۴۲۹**
>   (`posPlanRequested` + `assertPanelPassword` **بیرونِ** تراکنش) و گیت ~**۱۴۹۴**.
>   **کلید قفل تازه ساخته نشد** — همان `posCentralWithdrawToggle` (خواستِ مالک: یک قفل واحد)،
>   پس قانون `shared/panels.ts` و چک‌لیست README لازم نشد.
> * قفل بسته ⇒ فروشنده **هیچ سؤالی نمی‌بیند** و هیچ `stockPlan` ای نمی‌رود (سه `return undefined`
>   در `resolveStockPlan`). موجودی کافی هم ⇒ برنامه فرستاده نمی‌شود (سرعت صندوق، بی دفتر اضافه).
>   منوی انتخاب انبار مبدأ در فروش تکی **عمداً ساخته نشد**.
> * ⛔ `npm install` · `db:generate` · `typecheck` · `tsc` و رگرسیون کامل **اجرا نشدند**.
>   فقط `tools/tsx-parse-check.mjs` (۶ فایل PASS) و سوییت تازه‌ی **ایستا**:
>   **`test/stock-source-pos-session52.mjs` ⇒ ۳۳ PASS · ۰ FAIL** (بی node_modules اجرا می‌شود).
>   انتظار رگرسیون کامل: ۸۸۲ + ۳۳ = **۹۱۵ PASS**. مرجع نهایی `npm run typecheck`.
> * ⚠️ **هیچ‌چیز در زمان اجرا تست نشد:** سوییت این نشست ممیزی *کد* است، نه اجرای Prisma.
>   رمز درست/اشتباه، قفل موقت، `STOCK_PLAN_STALE` و زنجیره‌ی پنجره در فروش تکی فقط با تست
>   دستی (فهرست پایین `CHANGELOG-جلسه۵۲.md`) تأیید می‌شوند.
>
> ## ❌ نشست بعد دقیقاً از اینجا شروع کند — تنها کار باقی‌مانده: **مرحله ۴**
> ۱) **`ReceiptData` خط ~۴۴ در `src/main/print/templates.ts`** + `PrintService.receiptDataFor`
>    از `stockAllocationService.summaryOf(invoiceId)` + سه قالب `receiptHtml`.
> ۲) ستون «مبدأ کسر» در فهرست فاکتورهای عمده (`SalesInvoice.tsx` ⇒ `colSpan={12}` باید ۱۳ شود)
>    و در گزارش فروش از `CH.saleStockSourcesMany` (فیلد `short`).
> ۳) **فاکتورهای قدیمیِ بی‌دفتر مثل قبل نمایش داده شوند** (خالی ⇒ همان رفتار فعلی، نه خطا).
> ۴) الگوی آماده: ستون «مبدأ برداشت» تب تعویض در `SalesReports.tsx` (جلسه ۵۰) — هدر،
>    `exchangeRowValues`، `<td>`. **رسیدهای فروش تکی هم حالا می‌توانند مبدأ داشته باشند** (تازه).
> ۵) یک نکته‌ی باز و بی‌خطر: اگر روزی فیشِ فروش تکیِ **دفتردار** ویرایش شود،
>    `update` آن را رد می‌کند (خط ~۱۸۳۰ فقط `WHOLESALE` را برای `editPlan` می‌پذیرد و ~۱۸۶۲
>    ویرایشِ بی‌برنامه‌ی فاکتور دفتردار را رد می‌کند). امروز **مسیر کاربری‌اش وجود ندارد**
>    (پنل فروش تکی صفحه‌ی ویرایش فیش ندارد؛ برگشت/تعویض مسیر جداست)، پس عمداً دست نزدیم.
>    اگر روزی ویرایش فیش اضافه شد، همان دو خط باید `INTERNAL` تأییدشده را هم بپذیرند.
> ۶) بعد از هر مرحله: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json`
>    و مقایسه با ۱۹۶ خطای شیم — **هر خطای تازه در فایل‌های لمس‌شده واقعی است**.

> # وضعیت پایان جلسه ۵۱ (آخرین نشست) — از همین‌جا ادامه بده
> * ✅ **مرحله ۲ کامل، سبز و بی بخش نیمه‌کاره است** (شرح کامل در `CHANGELOG-جلسه۵۱.md`):
>   منوی «کسر از انبار» در `pages/SalesInvoice.tsx` (پیش‌فرض «انبار فروشگاه» · «انبار مرکزی» ·
>   هر انبار فعال X، از همان `CH.secondaryWarehouseList`) + `preview` قبل از ثبت +
>   **`components/StockSourceModal.tsx` (۲-ب) ساخته و وصل شد** (زنجیره‌ی سؤال‌ها، همه‌ی اقلام در
>   یک پنجره، خلاصه قبل از تأیید، لغو در هر مرحله، اجرای دوباره با `STOCK_PLAN_STALE`) +
>   کادر آبی «مبدأ کسر این فاکتور» بعد از ثبت.
> * منطق همه در `src/shared/stockSource.ts` (افزایشی محض): `stockPickOptions` ·
>   `buildSingleSourcePlan` · `stockPathFor` · `resolveChain` · `pendingQuestionText` ·
>   `shortageHeadline`/`shortageTextLines` · `isStalePlanMessage` · `planShortLine` ·
>   `STOCK_PICK_TEXT`. پنجره و صفحه **هیچ منطقی پیاده نمی‌کنند**.
> * ⛔ **مرحله ۳ و ۴ طبق پرامپت شروع نشدند.** `Pos.tsx` · `panels.ts` · `PrintService.ts` ·
>   `templates.ts` · schema · migration ها · **کل لایه‌ی سرور** دست نخوردند و
>   `colSpan={12}` فهرست عمده همان ۱۲ ماند. نقشه‌ی مرحله ۳ و ۴ در بلوک «جلسه ۵۰» پایین‌تر
>   **عیناً معتبر** است (فقط شماره‌ی خط‌های `SalesInvoice.tsx` جابه‌جا شده‌اند).
> * ⛔ `npm install` · `db:generate` · `typecheck` · `tsc` و رگرسیون کامل طبق «قواعد صرفه‌جویی»
>   پرامپت **اجرا نشدند**. فقط `tools/tsx-parse-check.mjs` (سه فایل PASS) و سوییت تازه:
>   **`test/stock-source-pick-session51.mjs` ⇒ ۱۰۸ PASS · ۰ FAIL**. انتظار رگرسیون کامل:
>   ۷۷۴ + ۱۰۸ = **۸۸۲ PASS**. مرجع نهایی همان `npm run typecheck` است.
>
> ## ❌ نشست بعد دقیقاً از اینجا شروع کند — ترتیب مالک: ۳ ← ۴ (+ یک رفع سرور)
> ۱) **گپ سرور (اول این، یک خط است):** `SalesService.update` — `allocationPath = hadAllocations || !!editPlan`
>    ولی `increase = reverted?.storeLines ?? []` و برگشت فقط با `hadAllocations` می‌زند. پس
>    فرستادن برنامه برای فاکتورِ **بی‌دفتر** ⇒ کسر دوباره. فعلاً سمت UI گرفته شده
>    (`stockPathFor(...).legacyEdit` ⇒ منو قفل، برنامه فرستاده نمی‌شود). رفع ریشه‌ای: در آن حالت
>    `delta.increase` هم لحاظ شود. تا آن وقت، ویرایشِ فاکتورهای قدیمی با انتخاب انبار ممکن نیست.
> ۲) **مرحله ۳ — فروش تکی (`pages/Pos.tsx`) با قفل:** `settle` خط ~۶۳۶ · الگوی قفل سمت سرور
>    `CardTransferService.pay` (همان `assertPanelPassword` بیرونِ `prisma.$transaction`) با
>    `PANEL_KEYS.posCentralWithdrawToggle` · رمز در `CreateSaleInput` (`panelPassword?`) · بی رمز
>    ⇒ `stockPlan` رد شود. ⚠️ گیت سرور `if (stockPlan && orderType !== OrderType.WHOLESALE)`
>    (خط ~۱۴۵۱) باید برای فروش تکی مشروط شود. **`StockSourceModal` آماده و قابل استفاده است**
>    (props: `open` · `preview` · `primaryKey` · `onCancel` · `onConfirm(plan)`).
> ۳) **مرحله ۴ — نمایش مبدأ:** `ReceiptData` در `print/templates.ts` + `PrintService.receiptDataFor`
>    از `stockAllocationService.summaryOf(invoiceId)` + سه قالب `receiptHtml` · ستون «مبدأ کسر»
>    در فهرست فاکتورهای عمده (`colSpan={12}` ⇒ ۱۳) و گزارش فروش از `CH.saleStockSourcesMany`
>    (فیلد `short`). فاکتورهای قدیمیِ بی‌دفتر مثل قبل نمایش داده شوند. الگوی آماده: ستون
>    «مبدأ برداشت» تب تعویض در `SalesReports.tsx` (جلسه ۵۰) — هدر، `exchangeRowValues`، `<td>`.
> ۴) بعد از هر مرحله: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json`
>    و مقایسه با ۱۹۶ خطای شیم — **هر خطای تازه در فایل‌های لمس‌شده واقعی است**.

> # وضعیت پایان جلسه ۵۰ (آخرین نشست) — از همین‌جا ادامه بده
> * ✅ **مرحله ۱-ب تمام، تست‌شده و سبز است** (شرح کامل در `CHANGELOG-جلسه۵۰.md`): برداشت
>   انبار مرکزی در «تعویض کالا» حالا در `SaleReturn.note` (با تگ ثابت `CENTRAL_WITHDRAW_TAG`)،
>   در `audit(SALE_EXCHANGE)`، در نتیجه‌ی `createExchange` و در دو نقطه‌ی نمایش ثبت می‌شود.
>   **رفتار برداشت هیچ تغییری نکرد** — `coverShortage` سر جای خودش است.
> * ⛔ **مرحله ۲ شروع نشد** (سقف اجرای نشست). `StockSourceModal.tsx` **ساخته نشد** و
>   `SalesInvoice.tsx` · `Pos.tsx` · `panels.ts` · `PrintService.ts` · `templates.ts` ·
>   schema · migration ها **دست نخوردند**. کاربر هنوز منوی «کسر از انبار» را در فاکتور عمده
>   نمی‌بیند. مرحله ۳ و ۴ هم طبق پرامپت مالک عمداً شروع نشدند.
> * رگرسیون کامل سبز: ۲۶ (تازه) + ۲۹ + ۶۰ + ۹۷ + ۲۰۴ + ۱۳۷ + ۱۸۵ + ۳۶ = **۷۷۴ PASS · ۰ FAIL**.
> * typecheck شیم: **۱۹۶ خطا، مو‌به‌مو همان ۱۹۶ خطای جلسه ۴۹** (فقط شماره‌ی خط‌ها جابه‌جا شده‌اند).
>   `typescript@5.6.3` روی محیط بود و به `node_modules/typescript` وصل شد. `npm` باز هم نبود.
>
> ## ❌ نشست بعد دقیقاً از اینجا شروع کند — ترتیب مالک: ۲ ← ۳ ← ۴
> نقشه‌ی مرحله ۲ و ۳ و ۴ در «وضعیت پایان جلسه ۴۸/۴۹» (پایین‌تر در همین فایل) و
> `CHANGELOG-جلسه۴۷.md` بخش «کارِ باقی‌مانده / ۱» **عیناً معتبر است**. شماره‌خط‌های
> **به‌روزشده‌ی امروز** (فایل‌های لمس‌نشده همان عددهای جلسه ۴۹ را دارند):
>
> ### مرحله ۲ — فاکتور فروش عمده (`pages/SalesInvoice.tsx`) + `components/StockSourceModal.tsx`
> * `save = useCallback(…)` خط **{L_SI_SAVE}** (این فایل دست نخورد) · `autoCentralWithdraw: autoCentral`
>   داخل همان `payload` (همان‌جا `stockPlan` اضافه می‌شود) · نتیجه در `setWarn(inv.stockWarnings…)`
>   و `flash(...)` بلافاصله بعدش (خلاصه‌ی `inv.stockSources.lines` همان‌جا).
> * تیک خودکار: `autoCentralBox` خط **{L_SI_AUTO}** و JSX اش از `<ManagerGate>` خط **{L_SI_GATE}** تا
>   `</ManagerGate>` — برای «انبار مرکزی/X» باید `disabled`/پنهان شود.
> * فهرست فاکتورهای عمده: `colSpan={12}` خط **{L_SI_SPAN}** باید ۱۳ شود (ستون «مبدأ کسر»).
> * ⚠️ سرور `stockPlan` + `autoCentralWithdraw: true` را **با هم رد می‌کند** —
>   `SalesService.create` خط **{L_CREATE_GATE}** و `update` خط **{L_UPDATE_GATE}**. پس با فرستادن برنامه،
>   `autoCentralWithdraw: false` بفرست.
> * قرارداد پنجره از قبل کامل است در `shared/stockSource.ts`: `resolveLine` · `optionKey` ·
>   `summarizePlan` · `summaryTextLines` · `summaryShortLine` · `planShapeErrors` ·
>   `STOCK_SOURCE_TEXT` (همه‌ی متن‌های فارسی نوشته شده‌اند) · `STOCK_PLAN_STALE_CODE`.
> * سه کانال IPC خواننده آماده‌اند: `CH.stockSourcePreview` · `CH.saleStockSources` ·
>   `CH.saleStockSourcesMany` (`src/main/ipc/index.ts` خط ۲۲۳–۲۲۵).
> ### مرحله ۳ — فروش تکی (`pages/Pos.tsx`) با قفل
> * `settle = useCallback(…)` خط **{L_POS}** (این فایل دست نخورد) · الگوی آماده‌ی قفل سمت سرور:
>   `CardTransferService.pay` خط **{L_CARD}** (`assertPanelPassword(...)` **بیرون و قبل از**
>   `prisma.$transaction`). عیناً همان با `PANEL_KEYS.posCentralWithdrawToggle` در
>   `SalesService.create`/`update`، و گیتِ فعلیِ داخل تراکنش (خط‌های بالا) باید **مشروط** شود.
>   رمز باید در `CreateSaleInput` فیلد تازه بگیرد (مثل `panelPassword?: string | null`).
>   بی رمز ⇒ `stockPlan` رد شود.
> ### مرحله ۴ — نمایش انبار مبدأ روی رسید / فهرست / گزارش
> * `ReceiptData` در `src/main/print/templates.ts` خط **{L_RCPT}** (فیلد تازه مثل
>   `stockSourceLines?: string[]`)، پر کردنش در `PrintService.receiptDataFor` (خط ~۶۳) از
>   `stockAllocationService.summaryOf(invoiceId)` ⇒ `{ groups, lines, short }`، و چاپش کنار
>   `footers.push(...)` در **سه** قالب `receiptHtml`.
> * فهرست فاکتورهای عمده و گزارش فروش: ستون «مبدأ کسر» از `CH.saleStockSourcesMany` (فیلد
>   `short`، که منفی‌ها را با ⚠ علامت می‌زند). **فاکتورهای قدیمیِ بی‌دفتر مثل قبل** نمایش داده شوند.
> * ⚠️ الگوی آماده برای همین کار همین نشست ساخته شد: ستون «مبدأ برداشت» تب تعویض در
>   `SalesReports.tsx` (خط ~{L_RCOL}) — سه نقطه‌ی هم‌زمان: هدر، `exchangeRowValues` (چاپ/اکسل)، و `<td>`.
> ### و بعد از هر مرحله
> `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json` و مقایسه با
> **۱۹۶** خطای شیمی: **هر خطای تازه‌ای در فایل‌های لمس‌شده، واقعی است.**

> # وضعیت پایان جلسه ۴۹ (آخرین نشست) — از همین‌جا ادامه بده
> * ⛔ **مرحله ۱-ب، ۲، ۳ و ۴ پرامپت هنوز شروع نشده‌اند.** این نشست فقط بند «محیط/typecheck»
>   پرامپت را انجام داد. `StockSourceModal.tsx` ساخته نشد و `SalesInvoice.tsx` · `Pos.tsx` ·
>   `SalesService.ts` · `panels.ts` · `PrintService.ts` · schema · migration ها و **کل رندرر
>   دست نخوردند**. رفتار برنامه مو‌به‌مو همان پایان جلسه ۴۸ است.
> * ✅ **برای اولین بار در پروژه، کل `src` تایپ‌چک شد.** `npm` باز هم نبود، ولی خودِ
>   `typescript@5.6.3` در دسترس بود؛ با شیمِ تازه (`tsconfig.typecheck.json` +
>   `tools/typecheck-shim.d.ts`) وابستگی‌های نصب‌نشده `any` می‌شوند و کدِ خود پروژه واقعاً سنجیده
>   می‌شود: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json`.
> * ✅ **شش خطای تایپ واقعی رفع شد** (شرح کامل در `CHANGELOG-جلسه۴۹.md`): امضای
>   `(v: unknown) => string` در `pendingRestock.ts` که `faDigits` را در **۱۰ نقطه** رد می‌کرد ·
>   `ExchangeSaleInput.full` که تایپ نشده بود · `CreditTone` تعریف‌نشده در `creditUi.ts` ·
>   `let closedShift = null` در `CashboxService` · آرایه‌ی `never[]` در `VariantPurgeService`.
>   **هیچ رفتار اجرایی، عدد مالی، schema یا migration عوض نشد** — فقط تایپ.
> * ۱۹۶ خطای باقی‌ماندهٔ شیم **همه اثر `@prisma/client = any` و `electron = any`اند** (الگوها و
>   دلیلشان در CHANGELOG). با `npm install` + `db:generate` نباید ظاهر شوند؛ اگر شدند، آن‌وقت
>   واقعی‌اند.
> * رگرسیون کامل سبز: ۲۹ + ۶۰ + ۹۷ + ۲۰۴ + ۱۳۷ + ۱۸۵ + ۳۶ = **۷۴۸ PASS · ۰ FAIL**.
> * ⚠️ `tools/tsx-parse-check.mjs` یک «رشته‌ی بسته‌نشده»ی **دروغ** گزارش می‌دهد؛ `tsc` هیچ خطای
>   نحوی (`TS1xxx`) نداد. از این به بعد `tsc` مرجع است.
>
> ## ❌ نشست بعد دقیقاً از اینجا شروع کند — ترتیب پرامپت مالک: ۱-ب ← ۲ ← ۳ ← ۴
> نقشه‌ی مرحله ۲ و ۳ و ۴ در «وضعیت پایان جلسه ۴۸» (پایین‌تر در همین فایل) و
> `CHANGELOG-جلسه۴۷.md` بخش «کارِ باقی‌مانده / ۱» **عیناً معتبر است**. چیزهایی که این نشست
> در کد پیدا کرد و وقت‌گیرترین بخش مطالعه بودند — با شماره‌ی خط، تا نشست بعد صفر شروع نکند:
>
> ### مرحله ۱-ب (تعویض، قابل‌ردیابی شدن برداشت) — نقطه‌های دقیق
> * `SalesService.createExchange`: صدا زدن `coverShortage` در **خط ۲۷۸۲** است
>   (`central = deductInventory && input.autoCentralWithdraw === true ? …`)، و **قبل از**
>   ساخته‌شدن `exchangeInvoice` (خط ~۲۸۲۲) و بعد از ساخته‌شدن `back` (`runReturn`، خط ۲۶۹۵).
>   پس `refId` سند تعویض در آن لحظه وجود ندارد ⇒ **جای `coverShortage` را عوض نکن** (رفتار
>   برداشت نباید تغییر کند)؛ ثبت/نمایش را *بعد از* ساخته شدن سند انجام بده.
> * `central.taken` (`CentralWithdrawLine[]`) از جلسه ۴۸ **`warehouseName` روی خود قلم و روی
>   هر `sources[]` دارد** — داده آماده است و لازم نیست چیزی حساب شود.
> * ⚠️ نتیجه‌ی `createExchange` (خط ~۳۲۰۶) **هیچ‌وقت `central` را برنمی‌گرداند** (برخلاف
>   `create` که `centralWithdrawals`/`centralWithdrawnQty` دارد، خط ~۱۶۸۲). پس سه کار کوچک:
>   ۱) به return اضافه شود: `centralWithdrawals: central.taken` · `centralWithdrawnQty:
>      central.totalTaken` (+ فیلدهای معادل در `ExchangeSaleResult` در `shared/types.ts`).
>   ۲) پایدارسازی بی‌migration: نام انبار و تعداد به `SaleReturn.note` اضافه شود
>      (`tx.saleReturn.update({ where: { id: back.id }, … })` بعد از ساخته شدن سند) — چون
>      `exchangeList` **از قبل** `note: r.note ?? ''` را در هر ردیف گزارش برمی‌گرداند
>      (خط ~۳۳۸۲)، پس ستون گزارش بی هیچ ستون تازه‌ای داده‌دار می‌شود.
>      برای اینکه استخراجش تطبیق متن شکننده نشود، یک **تگ ثابت** در `shared/stockSource.ts`
>      بساز (مثل `CENTRAL_WITHDRAW_TAG`) + دو تابع خالص `buildCentralWithdrawNote` /
>      `parseCentralWithdrawNote` و همان‌جا تستش کن (فایل `shared` بی import از main/renderer
>      است، پس بی `node_modules` هم تست می‌شود).
>   ۳) note ی `audit(AuditAction.SALE_EXCHANGE)` (خط ~۳۱۷۹) همان جمله را بگیرد.
> * نمایش: `pages/SalesReturn.tsx` نتیجه‌ی تعویض را نشان می‌دهد (همان جا که `stockWarnings`
>   را می‌گذارد) · ستون تازه در تب «تعویض کالا»ی `SalesReports.tsx` از همان `note`/فیلد تازه.
> ### آنچه برای مرحله ۲ و ۳ از قبل آماده است (دوباره دنبالش نگرد)
> * قرارداد کامل پنجره در `src/shared/stockSource.ts`: `resolveLine` · `optionKey` ·
>   `summarizePlan` · `summaryTextLines` · `summaryShortLine` · `planShapeErrors` ·
>   `STOCK_SOURCE_TEXT` (همه‌ی متن‌های فارسی پنجره **از قبل نوشته شده‌اند**) ·
>   `STOCK_PLAN_STALE_CODE`.
> * `Modal.tsx` قرارداد سبک پروژه است: `{open, title, onClose, children, footer, width}` و
>   میزبان باید hotkey هایش را با `enabled=false` خاموش کند (`SalesInvoice` از قبل
>   `modalOpen` دارد و `useHotkeys(…, tab === 'form' && !modalOpen)`).
> * نقطه‌ی اتصال در `SalesInvoice.tsx`: `save = useCallback(…)` خط **۴۱۷**؛ `payload` خط ۴۲۳ و
>   `autoCentralWithdraw: autoCentral` خط ۴۵۶ (همان‌جا `stockPlan` اضافه می‌شود)؛ نتیجه در
>   `setWarn(inv.stockWarnings…)` خط ۴۷۷ و `flash(...)` خط ۴۷۸ (خلاصه‌ی `inv.stockSources.lines`
>   همان‌جا). تیک خودکار: `autoCentralBox` خط ۲۱۱ و JSX اش خط ۷۶۲ تا ۷۹۳ (برای «انبار
>   مرکزی/X» باید `disabled`/پنهان شود). فهرست فاکتورهای عمده: `<thead>` خط ۱۲۴۵ و
>   بدنه خط ۱۲۶۲ (ستون «مبدأ کسر» + `colSpan={12}` خط ۱۳۲۲ باید ۱۳ شود).
> * نقطه‌ی اتصال در `Pos.tsx`: `settle = useCallback(…)` خط ۶۳۶، `call(CH.saleCreate, …)` خط
>   ۶۹۵ با `autoCentralWithdraw: autoCentral` خط ۷۰۷؛ `usePanelOpen(PANEL_KEYS.posCentralWithdrawToggle)`
>   از `hooks/usePanelLocks` همان بولینِ «قفل باز است؟» را می‌دهد (دقیقاً همان چیزی که
>   `useAutoCentralWithdraw.ts` خط ~۶۸ استفاده می‌کند).
> * قفل سمت سرور مرحله ۳ — الگوی آماده در `CardTransferService.pay` **خط ۲۶۴**:
>   `assertPanelPassword(PANEL_KEYS.cardTransfers, payload?.managerPassword ?? null, '…')`
>   که **بیرون و قبل از** `prisma.$transaction` است (خط ۲۶۹). عیناً همین را با
>   `PANEL_KEYS.posCentralWithdrawToggle` در `SalesService.create`/`update` بگذار — ولی
>   ⚠️ **قبل از `prisma.$transaction`**، نه داخل بلوک فعلی: گیت فعلیِ POS داخل تراکنش است
>   (`create` خط **۱۴۴۰–۱۴۴۹**: `if (stockPlan && orderType !== OrderType.WHOLESALE) throw …`
>   و `if (stockPlan && input.autoCentralWithdraw === true) throw …`). همان خط ۱۴۴۱ است که
>   باید مشروط شود، و رمز باید در `CreateSaleInput` (`shared/types.ts`) فیلد تازه بگیرد
>   (مثل `panelPassword?: string | null`). در `update` هم خط ۱۷۷۵–۱۷۷۸ همین وضع را دارد.
> * مرحله ۴ · رسید: `ReceiptData` در `src/main/print/templates.ts` **خط ۴۴** (فیلد تازه مثل
>   `stockSourceLines?: string[]` کنار `footer?: string` خط ۷۰)، پر کردنش در
>   `PrintService.receiptDataFor` **خط ۶۳** (return از خط ۸۸)، و چاپش در `receiptHtml` کنار
>   `footers.push(...)` خط ۱۸۳/۵۱۶/۶۸۷ (سه قالب). داده از
>   `stockAllocationService.summaryOf(invoiceId)` ⇒ `{ groups, lines, short }`.
> * سه کانال IPC خواننده از قبل هستند: `CH.stockSourcePreview` · `CH.saleStockSources` ·
>   `CH.saleStockSourcesMany` (`src/main/ipc/index.ts` خط ۲۲۳–۲۲۵).
> ### و بعد از هر مرحله
> `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json` را اجرا کن و
> با ۱۹۶ خطای «شیمی» جلسه ۴۹ مقایسه کن: **هر خطای تازه‌ای در فایل‌های لمس‌شده، واقعی است.**

> # وضعیت پایان جلسه ۴۸ (آخرین نشست) — از همین‌جا ادامه بده
> * ✅ **مرحله ۱ پرامپت تمام و سبز است — و یک «تغییر رفتار» واقعی دارد:**
>   `secondaryStockService.coverShortage` از این نسخه **فقط از انبار مرکزی پیش‌فرض** برمی‌دارد
>   (`warehouseId = NULL` + ردیف واقعیِ `isDefault`، همان تعریف `warehouseList` و `preview`).
>   قبلاً از **هر** انباری برمی‌داشت، پس موجودی شعبه‌ها می‌توانست بی‌خبر خالی شود. اثرش روی هر سه
>   صدازننده است: `create` (فروش تکی **و** عمده) · `update` · `createExchange` — هر سه تست شدند.
>   باقی‌ماندهٔ کمبود **مثل قبل** موجودی فروشگاه را منفی می‌کند و هشدار می‌گیرد (عوض نشد).
>   هشدارها حالا نام انبار مبدأ را می‌گویند و اگر کالا در شعبه‌ای باشد، صریحاً می‌گویند کجاست و
>   چرا از آن برداشته نشد. `CentralWithdrawLine` دو فیلد گرفت (افزایشی محض).
> * ⛔ **مرحله ۲، ۳ و ۴ شروع نشد** (سقف اجرای نشست). `StockSourceModal.tsx` **ساخته نشد** و
>   `SalesInvoice.tsx` / `Pos.tsx` / `panels.ts` / `SalesService.ts` / schema / migration ها و
>   **کل رندرر دست نخوردند**. کاربر هنوز پنجره‌ی «از کدام انبار کسر شود؟» را نمی‌بیند.
> * `npm` بیست‌وششمین نشست نبود (npm/npx نصب نیستند و شبکه نیست) ⇒ `install`/`db:generate`/
>   `typecheck` **اجرا نشد**. هیچ فایلی از جلسه ۴۲ تا ۴۸ `tsc` ندیده است.
>   اجرا شد و سبز: session48 ⇒ **۲۹** · session47-logic ⇒ ۶۰ · session47-db ⇒ ۹۷ · session35 ⇒ ۲۰۴ ·
>   session36 ⇒ ۱۳۷ · session40 ⇒ ۱۸۵ · src46 ⇒ ۳۶ (سرجمع **۷۴۸ PASS · ۰ FAIL**، بی رگرسیون).
> * تصمیم «ب»ی جلسه ۴۷ (فیلتر `coverShortage`) با همین نشست **بسته شد**. تصمیم «الف» (تفسیر
>   تیک) هم با قاعده‌ی نهایی مالک قطعی شد: تیک روشن ⇒ فقط انبار مرکزی، بی سؤال؛ خاموش ⇒ زنجیره‌ی سؤال.
>
> ## ❌ نشست بعد دقیقاً از اینجا شروع کند — به همین ترتیب
> ### مرحله ۲ — فاکتور فروش عمده (`pages/SalesInvoice.tsx`) + `components/StockSourceModal.tsx`
> نقشه‌ی خط‌به‌خطش در `CHANGELOG-جلسه۴۷.md` بخش «کارِ باقی‌مانده / ۱» است و **هنوز عیناً معتبر**
> است (هیچ‌کدامش انجام نشد). نکته‌های سرور که هنگام نوشتن UI باید بدانی:
> * یک انتخاب «کسر از انبار» با پیش‌فرض «انبار فروشگاه»؛ گزینه‌ها از `preview.options`
>   (`call(CH.stockSourcePreview, { lines })`).
> * **برنامه چه وقت لازم است:** انبار انتخابی ≠ فروشگاه ⇒ همیشه لازم است (حتی بی کمبود) ·
>   انبار = فروشگاه ⇒ فقط وقتی کمبود دارد **و** تیک خودکار خاموش است. اگر لازم نبود، برنامه
>   **نفرست** تا مسیر «بی‌دفتر = مو‌به‌مو مثل قبل» حفظ شود.
> * ⚠️ سرور `stockPlan` + `autoCentralWithdraw: true` را **با هم رد می‌کند**. پس با فرستادن
>   برنامه، `autoCentralWithdraw: false` بفرست؛ و تیک را فقط برای انتخاب «انبار فروشگاه»
>   فعال نگه دار (برای مرکزی/X غیرفعال یا پنهان).
> * ویرایش فاکتورِ دفتر‌دار **باید** برنامه بفرستد وگرنه سرور با پیام روشن ردش می‌کند. تشخیصش
>   در رندرر: `call(CH.saleStockSources, { invoiceId })` ⇒ `groups.length > 0`.
> * `STOCK_PLAN_STALE` در پیام خطا ⇒ پنجره را **دوباره** اجرا کن (متن‌های آماده:
>   `STOCK_SOURCE_TEXT.staleTitle` / `staleHint`). بعد از ثبت، `inv.stockSources.lines` را نشان بده.
> * خلاصه‌ی کسری‌ها با `summarizePlan` + `summaryTextLines` (قبل از تأیید نهایی **و** بعد از ثبت)،
>   و دکمه‌ی «لغو کل ثبت فاکتور» در هر مرحله (`STOCK_SOURCE_TEXT.cancelAll`).
> ### مرحله ۳ — فروش تکی (`pages/Pos.tsx`): فروشنده حق انتخاب ندارد
> * قفل بسته (پیش‌فرض) ⇒ **هیچ سؤالی و هیچ منوی انباری**. تیک روشن ⇒ مرحله ۱؛ تیک خاموش ⇒
>   رفتار فعلی (کسر از فروشگاه، منفی، هشدار). منوی «انبار مبدأ» در POS **لازم نیست** (سرعت صندوق).
> * فقط با باز شدن قفل `PANEL_KEYS.posCentralWithdrawToggle` (همان کلید موجود — کلید تازه نساز؛
>   مکانیزم: ManagerGate / رمز مدیر / رمز دوم اختصاصی / قفل موقت) پنجره‌ی کمبود در POS فعال شود.
>   سمت رندرر `usePanelOpen(PANEL_KEYS.posCentralWithdrawToggle)` همان تصمیم را به‌صورت بولین می‌دهد.
> * ⚠️ **کار سمت‌سروری که باید انجام شود و نشده:** الآن `SalesService.create` (و `update`) صریحاً
>   `stockPlan` را برای `orderType !== WHOLESALE` **رد می‌کنند**، پس POS هنوز نمی‌تواند برنامه
>   بفرستد. الگوی درستِ موجود در پروژه برای همین کار **هست** و اختراع لازم نیست:
>   `assertPanelPassword(PANEL_KEYS.posCentralWithdrawToggle, input.panelPassword, '…')` از
>   `AuthService.ts` — همان چیزی که جلسه ۴۰ برای `cardTransfer:pay` استفاده کرد (رمز مدیر، رمز دوم
>   پنل، رمز سوم شیفت، قفل موقت، و سیاست «قفل ماژول‌ها» ⇒ بی رمز `scope: 'OPEN'`).
>   ⚠️ **حتماً *قبل* از باز کردن `prisma.$transaction`** صدا زده شود (قاعده‌ی صریح بالای
>   `assertPanelPassword`: `readLock/writeLock` با کلاینت سراسری می‌نویسند و SQLite تک‌نویسنده است).
>   پس قفل فقط رندرری نمی‌ماند و در گزارش هم همین را بنویس.
> * تعویض (`SalesReturn`) فقط از مرحله ۱ اثر می‌گیرد؛ پنجره برایش **نساز**، و اگر لازم دیدی فقط گزارش بده.
> ### مرحله ۴ — نمایش (بر اساس `SaleItemStockAllocation`)
> * رسید چاپی: `ReceiptData` یک فیلد تازه (مثل `stockSourceLines?: string[]`)،
>   `PrintService.receiptDataFor` آن را از `stockAllocationService.summaryOf(invoiceId)` پر کند،
>   `receiptHtml` مثل `d.footer` چاپش کند (الگوی آماده: `footers.push(...)`).
> * فهرست فاکتورهای عمده و گزارش فروش: یک ستون «مبدأ کسر» از `CH.saleStockSourcesMany`
>   (فیلد `short`، که منفی‌ها را با ⚠ علامت می‌زند).
> * **فاکتورهای قدیمیِ بی‌دفتر مثل قبل نمایش داده شوند** (نبودِ ردیف = کسر از انبار فروشگاه).
> ### تست‌هایی که هنوز نوشته نشده‌اند
> تیک خاموش با زنجیره‌ی سؤال‌ها از UI · فروش تکی با قفل بسته (بی سؤال) و با قفل باز (با سؤال) ·
> ویرایش فاکتوری که از چند انبار تأمین شده (سرورش در session47 تست شده، مسیر UI نه) ·
> فاکتور قدیمی در نمایش‌های مرحله ۴. سوییت این جلسه: `test/acceptance-db-session48.mjs`.

> # وضعیت پایان جلسه ۴۷ (آخرین نشست) — از همین‌جا ادامه بده
> * **«فاکتور فروش عمده و انتخاب انبار» شروع شد** (مالک صریحاً خواست؛ ممنوعیت جلسه‌های ۴۰–۴۶
>   برداشته شد). **لایه‌ی داده + منطق مشترک + سرویس + IPC تمام و سبز · UI نوشته نشد.**
> * ⛔ **اولین کار نشست بعد: پنجره‌ی «از کدام انبار کسر شود؟»** —
>   `components/StockSourceModal.tsx` (تازه) + وصل‌کردنش به `pages/SalesInvoice.tsx`.
>   تا آن لحظه کاربر این قابلیت را **نمی‌بیند**؛ همه‌چیزِ پشتش آماده و تست‌شده است و پنل
>   مو‌به‌مو مثل قبل کار می‌کند (هیچ چیزی نشکسته). فهرست خط‌به‌خط: `CHANGELOG-جلسه۴۷.md`
>   بخش «کارِ باقی‌مانده».
> * تازه: `src/shared/stockSource.ts` (تنها منبع حقیقتِ قواعد — `resolveLine` زنجیره‌ی
>   سؤال‌ها، `summarizePlan` خلاصه‌ی کسری‌ها، `STOCK_PLAN_STALE`) ·
>   `src/main/services/StockAllocationService.ts` (`preview` بی‌نویسنده · `applyPlan` با
>   اعتبارسنجی دوباره داخل تراکنش · برگشت LIFO از دفتر) · `model SaleItemStockAllocation`
>   با migration **افزایشی محض** (هم `prisma/migrations` هم `prisma/manual`، یکسان).
> * وصل شد: `create` · `update` · `runReturn` · `purge` · `PendingRestockService.releaseReturnStock`.
>   **همه‌جا قاعده‌ی «بی‌دفتر = بی‌تغییر» رعایت شده**: فاکتور قدیمی و فروش تکی مو‌به‌مو مثل قبل.
> * `npm` بیست‌وپنجمین نشست نبود ⇒ `typecheck`/`prisma generate` **اجرا نشد**.
>   اجرا شد و سبز: session47-logic ⇒ ۶۰ · session47-db ⇒ ۹۷ · session40 ⇒ ۱۸۵ · session36 ⇒ ۱۳۷ ·
>   session35 ⇒ ۲۰۴ · src46 ⇒ ۳۶ (سرجمع **۷۱۹ PASS · ۰ FAIL**، بدون رگرسیون) + parse-check ۹ فایل.
> * ⚠️ **دو چیز منتظر تصمیم مالک است** (شرحشان در `CHANGELOG-جلسه۴۷.md`):
>   ۱) تفسیر بند ۴ تیک «برداشت خودکار» (پیاده‌شده طبق پرامپت، قفلش دست نخورد).
>   ۲) `coverShortage` هنوز از **همه‌ی انبارها** برمی‌دارد نه فقط انبار مرکزی — بی‌خبر عوض نشد؛
>      پیشنهاد: محدود کردنش به انبار پیش‌فرض.
> * پنل فروش تکی، تعویض، `panels.ts` و هیچ فایل رندرری عوض نشد. هیچ عدد مالی عوض نشد.

> # وضعیت پایان جلسه ۴۶ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار الف: تمام و سبز** (جلسه ۴۱) · **کار ب: تمام و سبز** (جلسه ۴۰–۴۵). هیچ‌کدام بازنویسی نشد.
> * **تنها بندِ بازِ جلسه ۴۵ بسته شد:** `src/shared/types.ts` ⇒ `ExchangeSaleInput.refundMode` حالا
>   `'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | null` است. یونیون فقط *گسترده* شد؛ هیچ
>   مصرف‌کننده‌ای روی آن `switch` جامع ندارد (همه‌جا `===`/`includes`)، پس هیچ مسیری تنگ‌تر نشد.
> * **`test/acceptance-src-session46.mjs` (تازه) ⇒ ۳۶ PASS · ۰ FAIL:** نگهبانِ قاعده‌های *شکلیِ*
>   پرامپت که تا حالا هیچ تستی نداشتند — یک منبع حقیقتِ `refundMode` (سه نقطه با هم) · قاعده‌ی
>   فقط‌خواندنی (در کل رندرر فقط `CardTransferPanel` کانال نویسنده دارد) · قفل سمت سرورِ
>   `pay`/`cancel` با همان `assertPanelPassword` · «سایر» دونفره با «کارت» جمع نشود ·
>   بی‌`UPDATE` بودن هر دو migration و **برابری statement-به-statement با `prisma/manual`** ·
>   parse-check ۱۲ فایلِ هرگز-typecheck-نشده.
> * برای اثبات بی‌اثر نبودن، چهار رفتار موقتاً شکسته شد (یونیون، یک `cardTransferPay` در
>   `CashClose`، جمع دونفره در `ShiftService`، یک `UPDATE` در migration الف) ⇒ ۳ و ۱ و ۱ و ۲ گزاره
>   سرخ شد؛ بعد درخت با `sha256sum -c` بیت‌به‌بیت برگشت.
> * اجرا شد و سبز: session46 ⇒ ۳۶ · session40 ⇒ ۱۸۵ · session36 ⇒ ۱۳۷ · session35 ⇒ ۲۰۴
>   (سرجمع **۵۶۲ PASS · ۰ FAIL**، بدون رگرسیون).
> * `npm` بیست‌وچهارمین نشست نبود ⇒ `typecheck`/`prisma generate` **اجرا نشد**. هیچ فایلی از جلسه
>   ۴۲ تا ۴۶ `tsc` ندیده است (parse-check فقط نحو را می‌گیرد، نه تایپ).
> * **کارِ باقی‌مانده‌ی پروژه فقط محیطی است:** `install` + `db:generate` + `typecheck` روی کل درخت،
>   و یک نگاه چشمی به ستون‌های تب تعویض و کارت‌های «معلق» در چهار صفحه‌ی نمایشی.
>   جزئیات: `CHANGELOG-جلسه۴۶.md`.
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۵
> * **کار الف: تمام و سبز** (جلسه ۴۱؛ در این نشست هم دست نخورد).
> * **کار ب: تمام و سبز.** تنها بند باقی‌مانده‌اش (سوییت پذیرش) در این نشست نوشته شد:
>   `test/acceptance-db-session40.mjs` ⇒ **۱۸۵ PASS · ۰ FAIL** روی هارنس واقعی، ۱۵ بند شامل هر هشت
>   سناریوی پرامپت: برگشت کارت‌به‌کارت با/بدون پرداخت · `pay` بدون رمز مدیر (رد می‌شود) · `pay` دوباره
>   (idempotent) · تعویض با مابه‌التفاوت کارت‌به‌کارت و حالتِ به‌نفعِ فروشگاه · برگشت نقدی · `cancel` با و
>   بدون `releaseStock` · حذف و ویرایش برگشتِ معلق · مغایرت انبارگردانی با کالای معلق · اثر صفر روی
>   کسری/اضافی صندوق · داده‌ی قدیمی · یادآوری بر اساس سن.
> * برای اثبات اینکه سوییت بی‌اثر نیست، دو رفتار اصلی موقتاً شکسته شد (برداشتن `deferRestock` و
>   برداشتن گیت سرور از `pay`) و ۱۱ و ۶ گزاره سرخ شدند؛ بعد درخت عیناً برگشت.
> * **هیچ فایل برنامه‌ای عوض نشد** — نه schema، نه migration، نه سرویس، نه IPC، نه `panels.ts`، نه
>   رندرر. فقط `test/acceptance-db-session40.mjs` (تازه) و `test/harness/prismaLite.mjs` (مترجم هارنس
>   حالا `update` با `items: { create: [...] }` را می‌فهمد؛ بی این، «ویرایش برگشتِ معلق» تست‌شدنی نبود).
> * `npm` بیست‌وسومین نشست نبود ⇒ `typecheck`/`prisma generate` **اجرا نشد**. اجرا شد: session40 ⇒
>   ۱۸۵ PASS، session36 ⇒ ۱۳۷ PASS، session35 ⇒ ۲۰۴ PASS (همه ۰ FAIL، بدون رگرسیون).
> * **کار باقی‌مانده‌ی پروژه فقط محیطی است:** با اولین `npm` ⇒ `install` + `db:generate` + `typecheck`
>   روی کل درخت (۹ فایل جلسه ۴۲ و ۳ فایل جلسه ۴۴ هیچ‌وقت typecheck نشده‌اند) + یک نگاه چشمی به
>   ستون‌های تب تعویض + افزودن `'CARD_TO_CARD'` به یونیون `ExchangeSaleInput.refundMode`
>   (`shared/types.ts` خط ۱۴۰۰ — الان خطا نمی‌دهد چون از `withUser` با تایپ `any` رد می‌شود، ولی تایپ
>   واقعیت را نمی‌گوید). جزئیات: `CHANGELOG-جلسه۴۵.md`.
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۴
> * **کار الف: تمام و سبز** (جلسه ۴۱؛ در این نشست هم دست نخورد).
> * **کار ب — هر چهار صفحه‌ی نمایشی بسته شد:** `Stocktake.tsx` (ستون معلق + «موجودی فیزیکیِ مورد
>   انتظار» + مغایرت بر اساس `diffAtCountWithPending` + کارت خلاصه + دو ستون در اکسل) ·
>   `CashClose.tsx` (ردیف هشدار در جدول فرمول، خط چاپ حرارتی، پاراگراف تأیید بستن — **بدون هیچ اثری
>   روی `expectedCash` و کسری/اضافی**) · ستون معلق در `ExchangeTable` (هر پنج نقطه با هم: هدر، بدنه،
>   tfoot، `exchangeRowValues`، totals چاپ/اکسل).
> * **تنها بند باقی‌ماندهٔ کار ب: سوییت `test/acceptance-db-session40.mjs`** (فهرست سناریوها در
>   `CHANGELOG-جلسه۴۲.md`، الگو: `acceptance-db-session36.mjs`). مسیرهای جلسه ۴۲ تا ۴۴ همچنان تست
>   خودکار ندارند.
> * `npm` بیست‌ودومین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد. اجرا شد: parse-check ۳ فایل
>   (سالم)، session36 ⇒ ۱۳۷ PASS · ۰ FAIL، session35 ⇒ ۲۰۴ PASS · ۰ FAIL (بدون رگرسیون).
> * هیچ عدد مالی/انباری، schema، migration، سرویس، IPC و `panels.ts` در این نشست عوض نشد.
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۳ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار الف: تمام و سبز** (جلسه ۴۱؛ در این نشست هم دست نخورد).
> * **کار ب — دو صفحه‌ی نمایشی از چهار صفحه بسته شد:** هوک مشترک
>   `hooks/usePendingRestock.ts` (تنها نقطه‌ی خواندن در رندرر، فقط خواندنی، بی‌فیلتر تاریخ، بی‌شکستن صفحه)
>   + `Products.tsx` (ستون و نشان معلق، کادر هشدار، جمع ستون) + `SalesReports.tsx` (ستون معلق در تب
>   برگشت/تعویض، جمع در tfoot، خروجی اکسل، کادر هشدار).
> * **باقی‌مانده‌ی کار ب (به همین ترتیب):** `Stocktake.tsx` (ستون معلق + `diffAtCountWithPending` +
>   `PENDING_RESTOCK_STOCKTAKE_NOTE`) · `CashClose.tsx` (ردیف هشدار `pendingRestockShiftWarning`، بدون
>   اثر روی کسری/اضافی) · ستون معلق در `ExchangeTable` (عمداً دست‌نخورده ماند تا ستون‌ها جابه‌جا نشوند) ·
>   و **سوییت `test/acceptance-db-session40.mjs`**. فهرست خط‌به‌خط در `CHANGELOG-جلسه۴۳.md`.
> * ⚠️ مسیرهای تازه‌ی جلسه ۴۲ و ۴۳ **تست خودکار ندارند**؛ سوییت کار ب هنوز نوشته نشده است.
> * `npm` بیست‌ویکمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد. اجرا شد: parse-check ۳ فایل
>   (سالم)، session36 ⇒ ۱۳۷ PASS · ۰ FAIL، session35 ⇒ ۲۰۴ PASS · ۰ FAIL (بدون رگرسیون).
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۲ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار الف: تمام و سبز** (جلسه ۴۱؛ در این نشست دست نخورد).
> * **کار ب — بند «الف» (IPC) بسته شد و پنل قفل‌دار مدیر کامل شد:** دو کانال تازه
>   (`cardTransfer:cancel` و `pendingRestock:summary`)، ردیف `LOCKED_PANELS` به‌روز، snapshot معلق در
>   `StockCountService.submit` و ردیف‌های «فقط معلق» در `discrepancy`، و در `CardTransferPanel`:
>   فیلد رمز مدیر روی «پرداخت شد»، ستون و نشان «در انتظار تأیید مدیر»، نوار خلاصه، و دکمه‌ی «رد/لغو»
>   با دلیل اجباری و چک‌باکس آزادسازی.
> * **باقی‌مانده‌ی کار ب (به همین ترتیب):** چهار صفحه‌ی نمایشیِ فقط خواندنی — `Products.tsx`،
>   `SalesReports.tsx` (تب برگشت/تعویض + بلوک خلاصه)، `Stocktake.tsx` (ستون معلق و
>   `diffAtCountWithPending`)، `CashClose.tsx` (ردیف هشدار) — و بعد **سوییت
>   `test/acceptance-db-session40.mjs`**. فهرست خط‌به‌خط + متن‌ها و نشانِ آماده در `CHANGELOG-جلسه۴۲.md`.
> * ⚠️ مسیرهای تازه‌ی این نشست **تست خودکار ندارند**؛ سوییت کار ب هنوز نوشته نشده است.
> * `npm` بیستمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد. اجرا شد: parse-check ۹ فایل (سالم)،
>   session36 ⇒ ۱۳۷ PASS · ۰ FAIL، session35 ⇒ ۲۰۴ PASS · ۰ FAIL (بدون رگرسیون).
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۱ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار الف: تمام شد.** سوییت پذیرش `test/acceptance-db-session36.mjs` نوشته و سبز شد
>   (**۱۳۷ PASS · ۰ FAIL**) و هارنس جلسه ۳۵ هم **۲۰۴ PASS · ۰ FAIL** داد (بدون رگرسیون).
>   جزئیات و سه رفتاری که تست تثبیت کرد: `CHANGELOG-جلسه۴۱.md`.
> * **کار ب: در جلسه ۴۱ هیچ فایلی از آن عوض نشد** ⇒ وضعیتش عیناً پایان جلسه ۴۰ است: لایه‌ی داده،
>   سرویس و قفل سمت سرور بسته؛ **IPC، UI پنج صفحه و سوییت تست نوشته‌نشده**. فهرست خط‌به‌خطِ ادامه در
>   `CHANGELOG-جلسه۴۰.md` بخش «کارِ باقی‌مانده» — اول الف (IPC)، بعد ب (UI)، بعد ج (تست).
> * برای تست کار ب از الگوی همین سوییت تازه استفاده کن (هر سناریو شیفت مستقل خودش).
> * `npm` نوزدهمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد.
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۴۰ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار ب: لایه‌ی داده + سرویس + قفل سمت سرور بسته شد.** migration، `shared/pendingRestock.ts`،
>   `PendingRestockService`، `CardTransferService.pay` (گیت سرور + آزادسازی انبار در همان تراکنش) و
>   `cancel`، و هر پنج نقطه‌ی `SalesService` (`runReturn`/`createReturn`/`createExchange`/
>   `returnUpdate`/`returnDelete`).
> * **کار ب: UI هیچ صفحه‌ای و هیچ سوییت تستی نوشته نشد.** حالت فعلی **سالم و ناشکسته** است (برنامه درست
>   رفتار می‌کند؛ فقط معلق‌ها در پنج صفحه *دیده* نمی‌شوند). فهرست خط‌به‌خطِ ادامه در `CHANGELOG-جلسه۴۰.md`
>   بخش «کارِ باقی‌مانده» — اول بند الف (IPC)، بعد ب (UI)، بعد ج (تست).
> * **کار الف: دست نخورد.** تنها بند باقی‌ماندهٔ آن همچنان `test/acceptance-db-session36.mjs` است.
> * `npm` هجدهمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد. اجرا شد: parse-check ۷ فایل (سالم) و
>   هارنس session35 ⇒ **۲۰۴ PASS · ۰ FAIL** (بدون رگرسیون).
> * به «فاکتور فروش عمده و انتخاب انبار» دست نزن.

> # وضعیت پایان جلسه ۳۹ (آخرین نشست)
> * **کار الف: کل UI بسته شد** — `CashClose` (به‌علاوه‌ی رفع باگ کلید `clearedCheques` ⇒ `clearedCashCheques`)،
>   `ShiftDetailModal`، `Pos` + مشتق کردن مقصد در `initialPaymentRows`، `Settings`، و رسید چاپی.
> * **تستِ ناپایدار جلسه ۳۵ پیدا و تثبیت شد** (اشکال در خودِ گزاره بود: `\d` لاتین روی متنِ رقم‌فارسی).
>   هشت اجرای پشت سر هم ⇒ **۲۰۴ PASS · ۰ FAIL**.
> * **تنها کار باقی‌ماندهٔ کار الف:** سوییت `test/acceptance-db-session36.mjs`.
> * **کار ب هنوز دست‌نخورده است.** جزئیات خط‌به‌خط در `CHANGELOG-جلسه۳۹.md`.
> * `npm` هفدهمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد.

> ## ⏩ آخرین وضعیت (جلسه ۳۷ · کار الف)

> ## ⏱ وضعیت پایان جلسه ۳۸ (آخرین نشست) — از همین‌جا ادامه بده
> * **کار الف — لایه‌ی سرور: تمام. UI: نیمه‌کاره ولی سالم.** انجام‌شده: کادر مشترک مقصد پول
>   (`components/PaymentDestinationBox.tsx`)، توابع مشترک ستون‌ها (`lib/destinationCells.ts`)،
>   `InvoicePaymentsModal` (پاس شدن چک + ثبت پرداختی + ستون مقصد)، و `SalesReports` (سه ستون جای «کارت»).
> * **اولین کار نشست بعد:** در `pages/CashClose.tsx` کلید `components.clearedCheques` به
>   `clearedCashCheques` **نام عوض کرده** (خطوط ۴۳۷ و ۷۲۹) و الان `undefined` ⇒ صفر نشان می‌دهد.
> * بعد از آن: `ShiftDetailModal`، `Pos.tsx` (+ مشتق کردن مقصد در `initialPaymentRows`)،
>   `Settings.tsx` ۴۱۴۷/۴۱۵۹، `PrintService.ts` ۱۱۶، سوییت `test/acceptance-db-session36.mjs`،
>   و تستِ ناپایدار session35.
> * **کار ب دست‌نخورده است** (هیچ حالت نصفه‌کاره‌ای ندارد). به «فاکتور فروش عمده و انتخاب انبار» دست نزن.
> * `npm` شانزدهمین نشست نبود ⇒ `typecheck`/`prisma generate` اجرا نشد. اجرا شد: parse-check ۵۲ فایل
>   رندرر (سالم) و هارنس session35 ⇒ ۲۰۲ PASS · ۰ FAIL. جزئیات خط‌به‌خط در `CHANGELOG-جلسه۳۸.md`.

> لایه‌ی داده، مالی، سرویس و **همه‌ی مصرف‌کننده‌های سمت سرور** بسته شده‌اند (گزارش فروش، بستن
> صندوق، جزئیات شیفت، IPC). **UI و سوییت تست کار الف نوشته نشده‌اند و کار ب شروع نشده است.**
> فهرست خط‌به‌خطِ ادامه‌ی کار در `CHANGELOG-جلسه۳۷.md` است. `npm` باز هم نبود، پس
> `prisma generate` و `tsc` اجرا نشد؛ هارنس دیتابیس ۲۰۲ PASS · ۰ FAIL داد (با یک تستِ ناپایدار).

# وضعیت این تحویل — نشست چهارم (پایان پروژه)

ادامه‌ی مستقیم نشست سوم. **لایه‌ی داده دست نخورد**: هیچ migration جدیدی نوشته
نشد، `schema.prisma` · `shared/types.ts` · `shared/enums.ts` · `shared/ipc.ts` ·
`reportShape.ts` همه دست‌نخورده‌اند. این نشست فقط UI ساخت، به بک‌اند آماده وصل
کرد، و پنج کانال باقی‌مانده‌ی بخش ۵ را هندلر داد.

## قبل از اجرا
```bash
npm install
npm run db:generate
npm run typecheck
```

> ⚠️ صداقت فنی — دقیقاً مثل دو نشست قبل: این نشست هم در محیطی انجام شد که
> **بدون دسترسی به شبکه و بدون node_modules** بود، پس `npm install`،
> `prisma generate` و `tsc --noEmit` اجرا **نشدند** و هیچ‌کدام از مسیرها روی
> برنامه‌ی اجرا‌شده تست نشد. کد با رعایت مو‌به‌موی تایپ‌های `shared/types.ts`،
> امضای سرویس‌ها و نام کانال‌های `shared/ipc.ts` نوشته شده است، ولی **اولین کار
> شما باید همان سه دستور بالا باشد** و اگر خطای تایپی ماند، همان‌جا اصلاحش کنید.
> «تست جامع ۸ حالته» (اولویت ۸ پرامپ) به همین دلیل انجام نشده و تنها کار
> باقی‌مانده‌ی پروژه است؛ ترتیبش پایین همین فایل آمده.

---

## ✅ در این نشست انجام شد — هر ۷ اولویت کدنویسی

### بخش ۷ — نسیه و پرداخت جزئی (اولویت ۱) ✔
**`src/renderer/src/pages/Pos.tsx`**
- کادر «فروش نسیه / پرداخت جزئی» بالای دکمه‌های پرداخت: چک‌باکس + فیلد «مبلغ
  پرداختی» + سه دکمه‌ی میان‌بر (نسیه‌ی کامل / کل مبلغ / نصف) + **«بدهی باقی‌مانده»
  زنده** (`creditRemaining`).
- `settle()` مبلغ دریافتی را `paidNow` حساب می‌کند و
  `payments: paidNow > 0 ? [{…}] : []` می‌فرستد — سرویس `create()` از قبل
  `settledAt = null` می‌گذارد، پس هیچ تغییری در لایه‌ی داده لازم نبود.
- کادر «فاکتور ثبت‌شده» یک برچسب زرد «نسیه · باقی‌ماندهٔ بدهی …» گرفت و پیام
  موفقیت هم مبلغ دریافتی و بدهی مانده را صریح می‌گوید.
- خاموش بودن تیک = **رفتار مو‌به‌موی قبل** (کل «قابل پرداخت» دریافت می‌شود).

**`src/renderer/src/pages/SalesReports.tsx`** — تب جدید **«نسیه 🔒»**
- از `IPC.saleCreditList` / `CreditReportResult`، با **دو جدول**:
  «بدهکاران این بازه» (۱۸ ستون: جمع کل، پرداختی، باقی‌ماندهٔ بدهی، وضعیت، چک در
  جریان، تعداد و تاریخ آخرین پرداختی، سن بدهی، اضافه دریافتی، …) و
  «تسویه‌ی نسیه‌ی بازه‌های قبل» (از `priorSettlements`، با همان برچسب سرویس).
- چک‌باکس «فاکتورهای تسویه‌شده‌ی این بازه هم نمایش داده شوند» (`includeSettled`).
- دکمه‌ی **«ثبت پرداختی»** هر ردیف ⇒ همان پنجره‌ی `InvoicePaymentsModal` (عمداً
  یک فرم دوم و موازی ساخته نشد: چک، اضافه‌پرداخت و حذف پرداختی اشتباه همه همان‌جا
  هست و دو محل هیچ‌وقت دو عدد متفاوت نمی‌دهند).
- چاپ A4 + خروجی اکسل تب، و یک خروجی اکسل جدا برای جدول تسویه‌ها. عرض ستون‌ها با
  کلیدهای `sales-credit` و `sales-credit-settlements` ذخیره می‌شود.
- **قفل**: تا `PANEL_KEYS.salesCredit` باز نشده، حتی درخواست هم فرستاده نمی‌شود
  (`creditOpen` از `useManagerSession().canOpen`).

**`src/renderer/src/components/InvoicePaymentsModal.tsx`**
- فیلد **«ساعت دریافت پول»** (پیش‌فرض همین لحظه، دکمه‌ی «الآن»، قابل تغییر دستی)
  اضافه و `paidAtTime` به `addPayment` فرستاده شد — همان چیزی که نشست قبل کم بود.

### بخش ۲ — تنظیمات قفل موقت + شمارش معکوس (اولویت ۲) ✔
- **`SettingsService`**: `security: SecurityConfig` به `SettingsBundle` اضافه شد،
  `securityConfig()` خواننده‌اش، و `saveBundle` با `parseSecurityConfig` نویسنده‌اش
  (همان کلید `security.config` که `AuthService` می‌خواند — یک منبع حقیقت).
- **`useSettings`**: `security` در `SettingsBundle` و `FALLBACK` و مسیر `reload`.
- **`Settings.tsx` → تب مدیریت → بخش «رمز و امنیت»**: سه فیلد
  `lockoutEnabled` / `maxAttempts` / `lockMinutes` + دکمه‌ی **ذخیره‌ی فوری**
  (مثل سوییچ «شیفت بر اساس ساعت»: تاثیرش امنیتی است و نباید منتظر دکمه‌ی کلی بماند).
- **`ManagerGate.tsx`**: `setInterval` یک‌ثانیه‌ای روی `manager:gate:status` ⇒
  شمارش معکوس روی دکمه («۲:۳۵ قفل شده» → «۲:۳۴» → …)، غیرفعال شدن دکمه و فیلد
  رمز تا پایان قفل، پیام «قفل باز شد — حالا می‌توانید دوباره تلاش کنید»، و کادر
  «n تلاش دیگر تا قفل شدن». رمز اشتباه، وضعیت را همان لحظه تازه می‌کند.

### بخش ۴ — رفع تنگی UI (اولویت ۳) ✔
الگوی `SalesInvoice.tsx` (`flex-1 overflow-auto min-h-… max-h-…` + `thead sticky`)
روی **جدول اقلام `Pos.tsx`** (`min-h-[240px] max-h-[46vh]`)، **سابقه‌ی بستن صندوق
`CashClose.tsx`** (`min-h-[180px] max-h-[34vh]`) و **سابقه‌ی تجمیع
`Consolidation.tsx`** (`min-h-[160px] max-h-[32vh]`) پیاده شد.

### بخش ۳ — اضافه‌کردن ساعت (اولویت ۴) ✔
- **`CashboxService.sessions`**: فیلد `toClock` (HH:MM از `closedAt`، و در نبودش
  `createdAt`).
- **`CashboxService.list`**: فیلد `finalizedAtTime`.
- **`CashClose.tsx`**: ستون «ساعت بستن» + ساعت شروع/پایان شیفت روی چاپ A4 و چاپ
  حرارتی (`shiftClockMeta`، از `ShiftService.info`).
- **`Consolidation.tsx`**: ستون «ساعت» در سابقه‌ی تجمیع.

### بخش ۵ — انبار چندشعبه‌ای (اولویت ۵) ✔
**`src/main/services/SecondaryStockService.ts`** (متدهای جدید — قبلاً *وجود نداشتند*)
- `warehouseList` · `warehouseUpsert` · `warehouseRemove` · `transfer` · `history`
- `upsert` حالا `warehouseId` و `minQty` را **واقعاً ذخیره می‌کند** (باگ نشست قبل).
- `logStock()` هر تغییر را در `SecondaryStockLog` ثبت می‌کند (CREATE / UPDATE /
  DELETE / TRANSFER_IN / TRANSFER_OUT) و هیچ‌وقت خطا پرتاب نمی‌کند.
- **شرط قطعی رعایت شد**: `warehouseId = NULL` = انبار پیش‌فرض (ردیف مجازی با
  شناسه‌ی صفر؛ اگر ردیف واقعیِ `isDefault` باشد همان استفاده می‌شود). پس هیچ
  مهاجرتی لازم نشد و همه‌ی ردیف‌های قبلی سر جایشان ماندند.
- حذف یک انبار، موجودی‌اش را **پاک نمی‌کند**: ردیف‌هایش به انبار پیش‌فرض منتقل
  می‌شوند و انبار پیش‌فرض قابل حذف نیست.
- انتقال بیشتر از موجودی ردیف = **هشدار قابل‌تایید** (`force`)، نه دیوار — با همان
  جمله‌ی «تایید کنید تا انجام شود» که UI می‌شناسد.
- **استقلال از انبار فروشگاه دست‌نخورده**: انتقال بین انبارها به
  `ProductVariant.stock` دست نمی‌زند؛ تنها استثنا همان `coverShortage` است.

**`src/main/ipc/index.ts`** — پنج کانال آخر هندلر گرفتند:
`secondaryWarehouseList` · `secondaryWarehouseUpsert` · `secondaryWarehouseDelete`
· `secondaryStockTransfer` · `secondaryStockHistory`.

**`src/renderer/src/pages/SecondaryStock.tsx`** — سه نما:
- **موجودی**: ستون‌های «انبار» و «حد هشدار» (با رنگ زرد برای زیر حد هشدار)،
  فیلتر «فقط انبار …»، دکمه‌ی «انتقال» هر ردیف، و فیلدهای انبار/حد هشدار در فرم.
- **انبارها**: جدول نام/محل/تعداد ردیف/جمع موجودی/زیر حد هشدار/وضعیت +
  **«+ افزودن انبار جدید»** (مودال نام + شهر + توضیح) + ویرایش + حذف با تایید.
- **تاریخچه انتقالات**: با چک‌باکس «فقط انتقال بین انبارها».
- **خروجی اکسل** برای هر سه نما.

### بخش ۱ — گیت هشتم `salesCredit` (اولویت ۶) ✔
`<ManagerGate panel={PANEL_KEYS.salesCredit} … inline>` دور **خودِ تب نسیه** در
`SalesReports.tsx` نشست (نه دور کل پنل گزارشات). با این، هر ۱۸ کلید `LOCKED_PANELS`
وصل‌شده‌اند.

### README (اولویت ۷) ✔
بخش «افزودن ماژول جدید: چک‌لیست» از سرِ `src/shared/panels.ts` به `README.md`
منتقل شد (چهار قدم + دو قاعده‌ی ثابت + قفل موقت + فهرست ۱۸ کلید).

---

## ❌ تنها کار باقی‌مانده — تست جامع (اولویت ۸)

هیچ‌کدام از این هشت مسیر روی برنامه‌ی اجرا‌شده تست نشد (نبود node_modules).
به همین ترتیب اجرا کنید:

1. `npm install && npm run db:generate && npm run typecheck`
2. فروش عادی (چک‌باکس «چاپ فاکتور» روشن و خاموش).
3. فروش با بارکد اعتبار ⇒ نمایش در رسید و در خلاصه‌ی فاکتور.
4. تعویض کالا با مابه‌التفاوت مثبت / منفی / صفر ⇒ چاپ سند تعویض.
5. اضافه‌پرداخت با «بله، ثبت کن» (`confirmOverpay`) ⇒ ستون «اضافه دریافتی».
6. **فروش نسیه**: تیک نسیه، مبلغ پرداختی صفر و جزئی ⇒ تب «نسیه» ⇒ «ثبت پرداختی»
   با تاریخ و **ساعت** دستی ⇒ صفر شدن باقی‌مانده و علامت «تسویه‌شده».
7. ورود مدیر با رمز مدیر و با رمز دوم، روی تک‌تک **۸ گیت جدید** (و جدا روی
   چک‌باکس «چاپ فاکتور»). بعد: قفل موقت را در تنظیمات روی ۳ تلاش / ۱ دقیقه
   بگذارید، سه رمز اشتباه بزنید و **شمارش معکوس** را ببینید؛ بعد از ۰۰:۰۰ ورود
   موفق.
8. **انبار چندشعبه‌ای**: ساخت انبار جدید ⇒ انتقال موجودی (یک بار بیشتر از موجودی
   برای دیدن هشدار قابل‌تایید) ⇒ تاریخچه انتقالات ⇒ خروجی اکسل ⇒ حذف انبار و
   بازگشت ردیف‌ها به انبار پیش‌فرض.
9. ستون «ساعت بستن» در سابقه‌ی بستن صندوق و ستون «ساعت» در سابقه‌ی تجمیع.

## قاعده‌ای که باید ادامه پیدا کند
هر گزینه/صفحه‌ی حساس جدید ⇒ چهار قدم: کلید در `PANEL_KEYS` + ردیف در
`LOCKED_PANELS` + `<ManagerGate>` + تست. متن کامل این قرارداد از این نشست در
**`README.md` → «افزودن ماژول جدید: چک‌لیست»** است.


---

# جلسه ۲۰ — ماژول «مدیریت اعتبار خرید» · فاز ۱ انجام شد، ادامه‌اش از اینجا

شرح کامل تصمیم‌های معماری در `CHANGELOG-جلسه۲۰.md` است. خلاصه‌ی لازم برای ادامه:

## قطعی‌ها (دوباره تصمیم نگیر)
1. **گسترش `StoreCredit`، بدون مدل موازی.** «اعتبار مدیریتی» فقط `source='MANUAL'` است.
2. `USED` = همان `FULLY_USED` و `CANCELED` = همان `VOIDED` (alias در `src/shared/credit.ts`).
   وضعیت‌های واقعاً جدید: `DRAFT`, `PARTIALLY_USED`, `SUSPENDED`.
3. `src/shared/credit.ts` تنها منبع حقیقتِ *قواعد* است؛ تنها نقطه‌ی *اعمال*، سرویس main.
4. دسترسی = رمز دوم پنل (`creditManagement`, `creditBulkIssue`, `creditVoid`, `creditSettings`).
5. Rate Limit کد = گیت `CREDIT_CODE_GATE` روی همان `AuthLockout`؛ **هرگز داخل تراکنش باز**.
6. یادآوری = فقط زیرساخت، بدون هیچ تماس با API خارجی.
7. `StoreCreditRedemption` دفتر مصرف است؛ ستون‌های `used*` روی StoreCredit «آخرین مصرف» می‌مانند.

## نشست بعدی دقیقاً از اینجا شروع کند
**گام ۱ — `src/main/services/StoreCreditService.ts` (بازنویسیِ گسترشی، بدون شکستن امضاهای فعلی):**
- `readCreditSettings(client)` از `SETTING_KEYS.creditSettings` با `parseCreditSettings`.
- `generateStoreCreditCode` → الفبا/طول/پیشوند از تنظیمات، یکتایی از **UNIQUE INDEX دیتابیس**
  (برخورد ⇒ retry روی خطای P2002)، نه `findFirst`. پیشوند پیش‌فرض تعویض همان `E` بماند.
- `issueStoreCredit` → پارامترهای تازه: `source`, `maxUses`, `multiUse`, `restrict*`,
  `minPurchase`, `maxPerTransaction`, `customerLocked`, `holder*`, `settingsOverride`,
  `overrideReason`, `issuedDays`, `batchId`, `prefix`. پیش‌فرض `source='EXCHANGE'` تا مسیر
  تاریخی عیناً حفظ شود. قواعد نوع در **Backend** اعمال شود (§۱۹).
- `redeemStoreCredit` → قلب کار: `decideRedeem()` + `updateMany` با شرط خوش‌بینانه روی
  `{id, status: {in:[ACTIVE,PARTIALLY_USED]}, usedAmount: <قبلی>, usedCount: <قبلی>}` ⇒
  count!==1 یعنی مصرف همزمان؛ سپس `Payment` + ردیف `StoreCreditRedemption` با
  `idempotencyKey`. تکرار همان کلید ⇒ برگرداندن نتیجه‌ی قبلی، بدون کسر دوباره.
  باقی‌مانده‌ی اعتبار **یک‌بارمصرف** مثل قبل به اعتبار جدید می‌رود؛ چندباره روی خود رکورد می‌ماند.
  چک اعتبار فاکتور: `SaleInvoice.status !== 'CANCELED'`.
- عملیات مدیریتی با `assertManagerPassword` + audit مقدار قبل/بعد/دلیل:
  void / suspend / reactivate / تغییر انقضا / تغییر مبلغ (برای اعتبار مصرف‌شده **ممنوع**) /
  تغییر دفعات / تغییر دارنده / تغییر محدودیت.
- حذف: بدون هیچ مصرف ⇒ حذف واقعی؛ با مصرف ⇒ `deletedAt` (Soft Delete) تا سابقه‌ی حسابداری نشکند.
- `TX_OPTIONS` از `src/main/db/tx.ts` برای هر تراکنش interactive؛ `audit(tx, …)` با tx به‌عنوان آرگومان اول.

**گام ۲ تا ۱۱ (به همین ترتیب):** `NotificationSender.ts` (فقط لاگ) → `shared/types.ts` →
`shared/ipc.ts` + `main/ipc/index.ts` → سند اعتبار در `print/templates.ts` + `PrintService.ts`
(اندازه از `creditPaperSize`، هویت چاپ از همان `ReceiptTemplate`، PDF گروهی یک‌جا، برچسب
«نسخه‌ی مجدد» از `printCount>=2`) → `SettingsService.creditSettings/saveCreditSettings` →
`SalesService` (lines/idempotency) → `Pos.tsx` (پرداخت ترکیبی + اقلام واجد شرایط) →
صفحه‌های renderer (داشبورد/فهرست/جزئیات+Timeline/Wizard صدور/تولید گروهی/یادآوری/تنظیمات) با
`ManagerGate` + ثبت route در `main.tsx` و nav در `Shell.tsx` → `SalesReports.tsx` (تب اعتبار +
Excel/CSV با `ExportService`) → `test/acceptance-session20.mjs` طبق الگوی
`test/acceptance-session14.mjs` (بدون node_modules: assertion ساختاری روی سورس واقعی +
parse با `node --experimental-strip-types` + سوییت منطق خالص روی `src/shared/credit.ts`).

**تعهد (Liability) §۱۵:** بله، اعتبار صادرشده‌ی مصرف‌نشده بدهی فروشگاه است.
`DEFAULT_CREDIT_SETTINGS.reportLiability = true` گذاشته شده و عدد باید
`Σ(amount − usedAmount)` روی اعتبارهای زنده باشد؛ اتصال واقعی به حسابداری، فاز بعد.

---

# جلسه ۲۱ — فاز ۲ انجام شد (سرویس/IPC/چاپ/تنظیمات/تست)، ادامه‌اش از اینجا

شرح کامل در `CHANGELOG-جلسه۲۱.md`. خلاصه‌ی لازم برای ادامه:

## قطعی‌های تازه (دوباره تصمیم نگیر)
1. `StoreCreditService.ts` **تنها نقطه‌ی اعمال** است و امضاهای تاریخی‌اش حفظ شده‌اند.
2. مصرف = سه لایه: `idempotencyKey` یکتا + `decideRedeem` + `updateMany` با شرط
   `usedAmount/usedCount` قبلی. هیچ مسیر جدیدی نباید این سه را دور بزند.
3. اقلام سبد برای محدودیت کالا/دسته **از دیتابیس** خوانده می‌شوند (`linesForInvoice`).
4. تغییر مبلغ روی اعتبار مصرف‌شده **ممنوع** است (ابطال + صدور جدید).
5. حذف: بدون مصرف ⇒ واقعی · با مصرف ⇒ `deletedAt`.
6. `multiUse` با `maxUses < 2` ⇒ `1000` («چندباره تا پایان مبلغ»).
7. `guardCreditCode` **همیشه بیرون تراکنش**؛ داخل تراکنش صدا زدنش = بن‌بست SQLite.
8. تولید گروهی: بسته‌های ۲۰۰تایی، هر بسته تراکنش خودش، و گزارش «تعداد واقعی».

## نشست بعدی دقیقاً از اینجا شروع کند (گام ۱ = UI)
تمام بک‌اند آماده است؛ کافی است کانال‌ها مصرف شوند (`src/shared/ipc.ts` → `credit*`):

1. **`src/renderer/src/pages/CreditManagement.tsx` (جدید)** — چهار تب، هر تب پشت
   `<ManagerGate panel={PANEL_KEYS.creditManagement} …>`:
   داشبورد (`creditDashboard`) · فهرست + جست‌وجو (`creditList`) · جزئیات + Timeline
   (`creditDetail`) · یادآوری (`creditReminderCandidates` / `creditReminderQueue`).
2. **Wizard صدور تکی** (`creditIssue`) و **تولید گروهی** (`creditBulkIssue`, پشت
   `PANEL_KEYS.creditBulkIssue`) — پیام `lengthMessage` و `warnings` خروجی باید *دیده* شوند.
3. **عملیات مدیریتی** (`creditVoid/Suspend/Reactivate/ExpiryChange/AmountChange/UsesChange/
   HolderChange/RestrictionChange/Delete`, پشت `PANEL_KEYS.creditVoid`): هر فرم باید
   «رمز مدیر» + «دلیل» بگیرد، چون سرویس بدون این دو رد می‌کند.
4. **صفحه‌ی تنظیمات اعتبار** (`creditSettingsGet/Set`, پشت `PANEL_KEYS.creditSettings`).
5. **چاپ/PDF** (`printCredit`, `printCreditBatch`, `creditPdf`, `creditPreviewHtml`).
6. **`Pos.tsx`** — پرداخت ترکیبی: فیلد «مبلغ مصرف اعتبار» ⇒ `storeCreditAmount`، یک
   `storeCreditIdempotencyKey` تصادفی برای هر بار زدن دکمه‌ی ثبت، و علامت‌گذاری اقلام
   واجد شرایط با خروجی `creditPreview` (`eligibleVariantIds`).
7. **`SalesReports.tsx`** — تب «اعتبار خرید» + خروجی Excel با `exportTableFile`.
8. **`main.tsx` / `Shell.tsx`** — route و آیتم منو. **`useSettings`** — افزودن `credit`.
9. آخر از همه: اتصال `reverseInvoiceRedemptions` به مسیر ابطال/برگشت فاکتور در
   `SalesService` (تابع نوشته و تست شده، فقط صدا زده نمی‌شود).

## اجرا
`npm install && npx prisma generate && npm run typecheck && npm run build`
تست‌های آفلاین این ماژول: `node test/acceptance-session21.mjs` (۳۴ مورد) و
`node --experimental-strip-types test/credit-logic-session21.ts` (۴۴ مورد منطق خالص).

---

# جلسه ۲۲ — لایه‌ی نمایشِ خالص ساخته شد؛ خودِ صفحه‌ها هنوز نه

شرح کامل در `CHANGELOG-جلسه۲۲.md`. این جلسه زود به سقف خورد، پس فقط یک قدم
جلو رفت **ولی یک قدم کامل**: `src/shared/creditUi.ts` + ۳۲ تست واقعی.
هیچ فایل موجودی تغییر نکرد.

## قطعی‌های تازه (دوباره تصمیم نگیر)
1. **`src/shared/creditUi.ts` تنها جای «تصمیم»های فرم است.** صفحه‌های `.tsx`
   باید نازک باشند و اعتبارسنجی/شکل‌دهی Payload را از همین فایل بگیرند. دلیلش
   تست‌پذیری در محیط بدون node_modules است. این فایل **قاعده نمی‌سازد** — قواعد
   همان `credit.ts` است و اعمال همان سرویس main.
2. دو اجبارِ سمت UI که Backend ندارد و باید بماند: «دلیل استثنا» در صدور، و
   «رمز مدیر + دلیل» در هر ۹ عملیات مدیریتی.
3. مبلغ «حداکثر ممکن» در پنل فروش باید `storeCreditAmount = null` بفرستد، نه
   عدد محاسبه‌شده‌ی UI (`posCreditPlan.requested`). قفل‌کردن عدد سمت UI یعنی
   دور زدن `decideRedeem`.

## ⚠️ تصمیم معماری لازم برای گام آخر (در جلسه ۲۱ دیده نشده بود)
اتصال `reverseInvoiceRedemptions` به مسیر برگشت فاکتور **به‌تنهایی یک باگ مالی
می‌سازد**: در `SalesService.runReturn`، سقف بازپرداخت نقدی از
`invoice.paidTotal` می‌آید و `paidTotal` **شامل ردیف پرداختیِ اعتبار خرید هم
هست**. پس اگر فاکتوری ۶۰ نقد + ۴۰ اعتبار تسویه شده باشد و کامل برگشت بخورد،
هم ۱۰۰ نقد قابل بازپرداخت است و هم ۴۰ اعتبار برمی‌گردد ⇒ ۱۴۰ برگشت برای ۱۰۰
دریافتی. مسیر درست (پیشنهاد این جلسه، با دلیل):
1. در `runReturn`، سقف بازپرداخت **نقدی/کارتی** را از پرداختی‌های اعتباری پاک
   کن: `receivedOnInvoice = paidTotal − قبلی‌ها − Σ(مصرف‌های برگشت‌نخورده‌ی همین فاکتور)`.
   امضای `resolveRefund` دست نخورد؛ فقط عددِ ورودی‌اش درست شود. برای فاکتورهای
   بی‌اعتبار، عدد **عیناً** مثل قبل است ⇒ صفر تغییر رفتار.
2. `fullyReturned` را **قبل از** resolveRefund حساب کن (داده‌اش همان‌جا هست:
   `invoice.items` + `returnedByItem` + `items`) و فقط در همان حالت، بعد از
   ساخت سند برگشت و داخل همان `tx`، `reverseInvoiceRedemptions` را صدا بزن.
   برگشت جزئی نباید مصرف را برگرداند (تابع all-or-nothing است).
3. مبلغ برگشت‌داده‌شده‌ی اعتبار را از سقف بازپرداخت با روش `STORE_CREDIT` هم کم
   کن، وگرنه مشتری هم اعتبار قدیمش را پس می‌گیرد و هم یک اعتبار جدید.
4. عدد برگشتی تابع را در خروجی `createReturn` و در رسید/پیام پنل نشان بده.

## نشست بعدی دقیقاً از اینجا شروع کند (گام ۱ = UI، عیناً فهرست جلسه ۲۱)
فهرست ۹ گامیِ بخش «جلسه ۲۱» **بدون هیچ تغییری** معتبر است؛ فقط حالا
`creditUi.ts` آماده است و باید مصرف شود. آدرس‌های لازم، همه بررسی‌شده:

* **الگوی صفحه‌ی چندنما**: `SecondaryStock.tsx` (ریشه `<div className="page">`،
  `type View`, دکمه‌های نما، کادر `tbl-card` + `thead sticky`, `exportTable`).
* **قفل**: `<ManagerGate panel={PANEL_KEYS.creditManagement} title reason inline>`
  برای قفل *یک تب*؛ `usePanelOpen(PANEL_KEYS.creditBulkIssue)` برای غیرفعال‌کردن
  یک دکمه بدون صفحه‌ی رمز. کلیدها از قبل در `LOCKED_PANELS` هستند (۴ کلید).
* **رمز مدیر داخل فرم**: `<PasswordField>` (همان چشم 👁) + `ConfirmDialog` +
  `Modal` (عرض با `width="max-w-4xl"`).
* **تاریخ**: `<JalaliDateInput value onChange />` · اعداد `faDigits` · مبلغ `money`.
* **انتخاب مشتری**: `<PartyPicker kind="customer" value onChange />` (شکل `Party`).
* **انتخاب کالا**: `<AllProductsModal>` یا `<VariantSearchBox>` · **دسته‌بندی**:
  کانال `CH.categoryTree` ⇒ `CategoryNode[]` با `{id,name,parentId,depth}`.
* **اکسل**: `exportTable({ fileName, headers, rows, totals?, sheetName?, title? })`
  از `lib/exportCsv` (خودش پنجره‌ی «ذخیره به‌عنوان» را باز می‌کند).
* **امضای سرویس‌ها** (همه از `storeCreditService`): `preview`, `dashboard(filter)`,
  `list(filter)`, `detail({id|code})`, `issueManual(IssueCreditInput)`,
  `bulkIssue(BulkIssueInput)`, `batches({fromJalali,toJalali,take})`,
  `void/suspend/reactivate/changeExpiry/changeAmount/changeUses/changeHolder/
  changeRestrictions/remove({id, reason, managerPassword})`, `markPrinted({id})`,
  `reminderCandidates({onlyDue,source,take}) ⇒ {enabled, rows}`,
  `queueReminder({id, force})`, `reminderLogs({...})`, `settings()`.
  فیلتر فهرست: `{fromJalali,toJalali,mode:'issued'|'used',status,source,customerId,
  batchId,search,includeArchived,onlyWithRemaining,take,skip}` —
  **بدون `search`/`batchId`، پیش‌فرض `fromJalali` امروز است** (پس برای جست‌وجوی
  کل تاریخ، بازه را صریح بده).
* **چاپ/PDF**: `printCredit({id,copies,silent,markPrinted})` ·
  `printCreditBatch({batchId|ids,perPage})` · `creditPdf({id|batchId|ids,ask,reveal})`
  (سقف عمدی ۲۰۰۰ سند در هر فایل) · `creditPreviewHtml({id})`.
* **`SalesReports.tsx`**: تب موجودِ `storeCredits` **همان تب قدیمی و legacy** است
  (کانال `storeCreditList` + `ReportExtraTables`). دست به آن نزن؛ تب تازه‌ی
  «مدیریت اعتبار» را با کلید جدید و کانال `creditList`/`creditDashboard` اضافه کن.
* **`useSettings`**: `credit` هم باید به `SettingsBundle` سمت main اضافه شود
  (`SettingsService.bundle()` — همان‌جا که `security` و `discount` اضافه شدند) و
  هم به `FALLBACK`/`reload` سمت renderer با `parseCreditSettings`.
  ⚠️ توجه: `bundle()` همین حالا `time` را برمی‌گرداند ولی `useSettings` آن را
  ندارد؛ موقع دست‌زدن به این فایل، همان را هم درست کن.

## اجرا
```
npm install && npx prisma generate && npm run typecheck && npm run build
node test/acceptance-session21.mjs
node --experimental-strip-types test/credit-logic-session21.ts
node --experimental-strip-types test/credit-ui-logic-session22.ts
```

# جلسه ۲۳ — اتصال UI مدیریت اعتبار

صفحه‌ی جدید `CreditManagement.tsx` ساخته و به route و nav وصل شد. جریان‌های فهرست، داشبورد، جزئیات/Timeline، Reminder، Batch، صدور تکی/گروهی، عملیات مدیریتی و تنظیمات به کانال‌های آماده متصل‌اند. POS حالا preview و مبلغ ترکیبی و idempotency را می‌فرستد. `reverseInvoiceRedemptions` در برگشت کامل فاکتور، داخل همان تراکنش، اجرا می‌شود و مبلغ مصرف اعتبار از سقف بازپرداخت نقدی کم می‌شود.

کار بعدی: بعد از فراهم شدن `npm install`، `npm run db:generate`, `npm run typecheck`, `npm run build` را اجرا کنید و خطاهای type-only صفحه‌ی TSX را اصلاح کنید؛ سپس تب اعتبار جدید را در `SalesReports.tsx` اضافه کنید و چاپ/PDF و عملیات مدیریتی را روی برنامه‌ی واقعی smoke-test بگیرید.

---

# جلسه ۲۴ — رفع باگ‌های کامپایل + اتصال چاپ/PDF در UI + تب گزارشات

شرح کامل در `CHANGELOG-جلسه۲۴.md`.

## ⚠️ محدودیت واقعی این نشست (صادقانه، بدون ادعای اضافه)
این نشست هم **دسترسی شبکه نداشت**: `npm` روی محیط نصب نبود، پس
`npm install` / `npx prisma generate` / `npm run build` / اجرای واقعی Electron
**انجام نشد**. یعنی **اولویت ۴ (Smoke Test روی برنامه‌ی اجراشده) دست‌نخورده
باقی مانده است** — نه بخشی از آن انجام شد، نه ادعایی درباره‌اش می‌شود.

به‌جایش، یک تایپ‌چکِ **واقعی** با `tsc 5.6.3` روی کل پروژه گرفته شد (با
اعلان‌های ambient برای پکیج‌های نصب‌نشده: electron / @prisma/client / node:* /
react-router-dom). خروجی‌اش قابل‌اعتماد است برای همه‌ی خطاهایی که ریشه‌شان
Prisma Client نیست — و هر سه خطای واقعیِ باقی‌مانده پیدا و رفع شد.
تنها خطاهای باقی‌مانده در tsc، همه از نوع `{}`/`unknown` روی نتیجه‌ی
`groupBy`/`aggregate` پریزما هستند (`MergeService`, `PriceAdjustService`,
`SalesLedger`, `StockCountService`, `SecondaryStockService`, `MaintenanceService`,
`SalesService:1954`, `accountingReport:716-719`) و همان‌طور که جلسه ۲۳ پیش‌بینی
کرده بود، **بعد از `npm run db:generate` خودبه‌خود از بین می‌روند**. اگر نرفتند،
تک‌تک درستشان کنید.

## ✅ اولویت ۱ — سه باگ کامپایلِ build-breaking رفع شد (هر سه با tsc تأیید شد)
1. `src/renderer/src/pages/CreditManagement.tsx` — `type CreditOp` از انتهای
   ایمپورت `@shared/creditUi` حذف شد (`Duplicate identifier 'CreditOp'`).
   `export const CreditOp` + `export type CreditOp` در `creditUi.ts` با یک
   ایمپورت هم مقدار و هم تایپ را می‌دهند.
2. همان فایل، تابع `Detail` — سه مورد `CREDIT_OP` (که هرگز وجود نداشت) به
   `CreditOp` اصلاح شد: `Object.values(CreditOp)`, `CreditOp.VOID`, `CreditOp.DELETE`.
3. **جدا از ماژول اعتبار (میراث بازطراحی گزارشات فروش/بستن صندوق):**
   * `src/main/services/accountingReport.ts` — شیء `out` در `returnStatement`
     دو عضو `ReturnTotals` را کم داشت. `cardToCardPending` و
     `exchangeCardToCardPending` اضافه و **پر** شدند، با همان تفکیکی که
     `calculateReturnTotals` در `src/shared/accounting.ts` دارد
     (`refundMethod === CARD_TO_CARD` و `exchangeSettlement === CARD_TO_CARD`).
     فقط اضافه‌کردن فیلد با صفر، عدد را دروغ می‌کرد.
   * `src/renderer/src/pages/SalesReports.tsx` — تابع `emptyTotals()` پنج عضو
     افزوده‌ی جلسه ۱۴ را کم داشت (`exchangeReturnedTotal`, `refundCashTotal`,
     `refundCardTotal`, `refundDebtOnlyTotal`, `legacyRefundCount`). این خطا در
     پیام نشست قبل نبود ولی همان‌قدر جلوی build را می‌گرفت.

## ✅ اولویت ۲ — چاپ/PDF واقعاً به UI وصل شد (`CreditManagement.tsx`)
هیچ منطق تازه‌ای ساخته نشد؛ فقط چهار کانالِ آماده‌ی جلسه ۲۱ مصرف شدند.
* چهار هندلر تازه در بدنه‌ی صفحه: `printOne(id, copies)` ⇒ `CH.printCredit`
  (با `markPrinted: true`) · `printBatch({batchId|ids})` ⇒ `CH.printCreditBatch` ·
  `savePdf({id|batchId|ids})` ⇒ `CH.creditPdf` (با `ask`/`reveal`) ·
  `openPreview(id)` ⇒ `CH.creditPreviewHtml`.
* **نمای جزئیات:** «چاپ سند» · «پیش‌نمایش / چاپ PDF» · «ذخیره‌ی PDF» +
  شمارنده‌ی «چاپ‌شده: N بار» و برچسب هشدار «چاپ بعدی نسخه‌ی مجدد خواهد بود»
  وقتی `printCount >= 1` (رفتار بک‌اند از تست ۲۳ جلسه ۲۱، فقط حالا از UI دیده
  می‌شود). بعد از چاپ، `openDetail` دوباره صدا زده می‌شود تا شمارنده تازه شود.
* **پیش‌نمایش:** `Modal` + `iframe srcDoc` — عیناً الگوی پیش‌نمایش رسید در
  `Settings.tsx`. دکمه‌های «چاپ سند» و «ذخیره‌ی PDF» داخل خودِ همان Modal.
* **نمای دسته‌ها:** ستون تازه‌ی «چاپ» با «چاپ دسته‌ای» (⇒ `printCreditBatch`
  با `batchId`، یعنی **یک Job چندصفحه‌ای**، نه چاپ تک‌تک) و «PDF دسته».
* **نمای فهرست:** چک‌باکس هر ردیف + چک‌باکس «انتخاب همه» در سرستون +
  «چاپ گروهی انتخاب‌شده‌ها» و «PDF انتخاب‌شده‌ها» (⇒ با `ids`) + شمارنده‌ی
  انتخاب‌شده‌ها. انتخاب با هر تغییر فیلتر پاک می‌شود. در ستون عملیات هر ردیف هم
  «چاپ» و «پیش‌نمایش» اضافه شد.

## ✅ اولویت ۳ — تب تازه‌ی «مدیریت اعتبار خرید» در `SalesReports.tsx`
* تب legacy `storeCredits` (کانال `CH.storeCreditList`) **مطلقاً دست نخورد**.
* تب تازه: `Tab = … | 'creditManagement'` با دکمه‌ی «مدیریت اعتبار خرید 🔒».
* بدنه‌اش کامپوننت **مستقل** `CreditManagementReport` در انتهای همان فایل است
  (عیناً الگوی جلسه ۱۸: قفل و فیلتر و درخواست، همه داخل خودش) ⇒ `load()` صفحه‌ی
  میزبان با یک `return` زودهنگام هیچ درخواستی برایش نمی‌فرستد و هیچ state
  مشترکی با تب‌های سالم ندارد. از دو wrapper بزرگِ جدول اصلی و نوار پایین هم
  صریحاً بیرون گذاشته شد.
* محتوا: کارت‌های داشبورد از `dashboardCards(CH.creditDashboard)` + فهرست
  فیلترپذیر از `CH.creditList` (وضعیت/نوع/جست‌وجو/«فقط دارای باقی‌مانده») +
  خروجی اکسل با `exportTable` روی `CREDIT_LIST_HEADERS`/`creditListRow` (همان
  شکل صفحه‌ی اصلی، پس دو خروجی هیچ‌وقت واگرا نمی‌شوند) + tfoot با جمع
  مبلغ/مصرف/باقی‌مانده.
* پشت `<ManagerGate panel={PANEL_KEYS.creditManagement} … inline>` و **تا قفل
  باز نشده هیچ درخواستی فرستاده نمی‌شود** (همان قاعده‌ی تب نسیه).
* بازه‌ی تاریخ **همیشه صریح** فرستاده می‌شود، چون `creditList` بدون
  `search`/`batchId` پیش‌فرض `fromJalali` را «امروز» می‌گذارد (قطعیِ جلسه ۲۲).

## ❌ اولویت ۴ — Smoke Test روی برنامه‌ی اجراشده: **انجام نشد**
هر ۱۰ بند فهرست نشست ۲۳ دست‌نخورده است. دلیل: نبودِ `npm`/شبکه/Electron.

## تست‌های آفلاین (واقعاً اجرا شد، همین نشست)
```
node test/acceptance-session21.mjs                              ⇒ 34 PASS · 0 FAIL
node --experimental-strip-types test/credit-logic-session21.ts   ⇒ 44 PASS · 0 FAIL
node --experimental-strip-types test/credit-ui-logic-session22.ts⇒ 32 PASS · 0 FAIL
node test/acceptance-session14.mjs                               ⇒ 22 PASS · 2 FAIL
```
دو FAIL جلسه ۱۴ **قبل از این نشست هم وجود داشت** (روی زیپ دست‌نخورده هم عیناً
همین دو تا FAIL می‌شوند) و هر دو **assertion کهنه**اند، نه رگرسیون:
* تست ۸ دنبال نام `resolvePeriod` در `SalesService` است؛ همان منطق زنده است
  (خط ~۴۱۱ تا ۴۳۱: `shift.openedAt` تا `shift.closedAt ?? now`) ولی نام تابع در
  نشست‌های بعدی عوض شد.
* تست ۱۲ دنبال `updateMany({ … status: StoreCreditStatus.ACTIVE` است؛ جلسه ۲۱
  عمداً آن را به `status: { in: [...REDEEMABLE_STATUSES] }` تبدیل کرد که
  **سخت‌گیرانه‌تر** است. regex کهنه شده، نه کد.
⇒ پیشنهاد: این دو assertion را در نشست بعد به‌روز کنید، یا صریحاً skip کنید تا
کسی دنبال باگِ ناموجود نگردد.

## نشست بعدی دقیقاً از اینجا شروع کند
1. `npm install && npx prisma generate && npm run typecheck && npm run build`.
   خطاهای `{}`/`unknown` بالا باید صفر شوند؛ اگر نشدند تک‌تک درستشان کنید.
2. **کل اولویت ۴ (هر ۱۰ بند smoke test فهرست نشست ۲۳) از صفر** — صدور تکی،
   تولید گروهی ۵۰تایی + یکتایی کد + چاپ دسته‌ای PDF، مصرف در POS (تک/ترکیبی +
   Idempotency با دوبار زدن دکمه‌ی ثبت)، محدودیت کالا/دسته با سبد مخلوط، تعویض ⇒
   صدور خودکار `source=EXCHANGE`، برگشت کامل فاکتورِ نیمه‌اعتباری (باگ مالی
   جلسه ۲۲ + `reverseInvoiceRedemptions`)، هر ۹ عملیات مدیریتی با رمز+دلیل و
   بررسی Timeline/Audit، هر ۴ کلید رمز دوم جداگانه، و تب تازه‌ی
   `SalesReports.tsx` + خروجی اکسلش.
3. تازه‌های همین نشست که **فقط تایپ‌چک شده‌اند و هرگز روی برنامه‌ی واقعی اجرا
   نشده‌اند** و باید اول از همه چشمی تست شوند: دکمه‌های چاپ/PDF/پیش‌نمایش نمای
   جزئیات، انتخاب چندتایی + چاپ گروهی نمای فهرست، «چاپ دسته‌ای» نمای دسته‌ها،
   و تب `creditManagement` در گزارشات فروش.
4. کارهای باز و **بی‌ربط به ماژول اعتبار** (قاطی نکنید): به‌روزرسانی دو
   assertion کهنه‌ی `acceptance-session14.mjs`؛ و موردِ باقی‌مانده‌ی جلسه ۲۲ که
   `useSettings` هنوز `time` و `credit` را از `bundle()` نمی‌خواند.

---

# جلسه ۲۵ — رفع سه باگ واقعی چاپ/PDF + هارنس قرارداد UI↔بک‌اند

شرح کامل در `CHANGELOG-جلسه۲۵.md`.

## ⚠️ اولویت ۴ (Smoke Test روی برنامه‌ی اجراشده) هنوز انجام نشده است
سه نشست پشت‌سرهم محیط بدون `npm`/شبکه/Electron بوده. این نشست هم `npm install`،
`prisma generate`، `build` و اجرای برنامه **ممکن نبود** و هیچ بندی از ۱۰ بند فهرست
نشست ۲۳ اجرا نشد. هیچ ادعایی جز این نکنید.

## ✅ در این نشست انجام شد
1. **تایپ‌چک واقعی (`tsc 5.6.3`)**: هیچ خطای واقعی نمانده؛ `renderer` و `shared` صفر
   خطا. باقی‌مانده‌ها همان کلاس Prisma/electron اعلان‌نشده‌اند و با `db:generate` می‌روند.
2. **باگ §۱۳+§۱۰**: چاپ دسته‌ای/گروهی و PDF شمارنده‌ی چاپ را نمی‌زدند ⇒
   `markPrintedMany` (یک `updateMany` با `increment`) + `auditMany` + لاگ روی خودِ هر
   اعتبار. حالا نسخه‌ی دوم یک دسته هم «نسخه‌ی مجدد» می‌خورد.
3. **باگ §۱۰**: `creditPdf` مسیر دسته‌ای را `CREDIT_BULK_GENERATE` لاگ می‌کرد ⇒ `CREDIT_PRINT`.
4. **باگ §۲۱**: `perPage` ورودی renderer کلمپ شد (۱..۱۲).
5. **باگ کارایی §۵**: PDF دسته‌ای دو بار رندر می‌شد ⇒ `creditBatchRender` یک‌باره؛
   `count`/`total`/`capped` تا UI بالا می‌آید.
6. **`src/shared/creditPrint.ts`** تازه (الگوی `creditUi.ts`) + دو سوییت تست تازه.
7. دو assertion کهنه‌ی `acceptance-session14.mjs` به‌روز شد ⇒ ۰ FAIL. موردِ
   `useSettings`/`time`/`credit` **کهنه بود و بسته است** (تست ۲۹ جلسه ۲۵).

## قطعی‌های تازه (دوباره تصمیم نگیر)
* هر مسیری که سند اعتبار را بیرون می‌دهد (کاغذ یا PDF، تکی یا دسته‌ای) `printCount` را
  بالا می‌برد و لاگ می‌زند؛ استثنا فقط `markPrinted: false` صریح.
* تصمیم‌های چاپ در `@shared/creditPrint` می‌مانند تا تست‌پذیر بمانند. سقف ۲۰۰۰ سند در
  هر فایل و کلمپ `perPage` قاعده‌ی مشترک هر دو مسیر است.
* لاگ چاپ گروهی روی *هر اعتبار* نوشته می‌شود (نه فقط روی دسته)، چون Timeline جزئیات با
  `entity='StoreCredit' AND entityId=id` خوانده می‌شود.

## نشست بعدی دقیقاً از اینجا شروع کند
1. `npm install && npx prisma generate && npm run typecheck && npm run build` — خطاهای
   `{}`/`unknown` پریزما باید صفر شوند؛ اگر نشدند تک‌تک درستشان کنید.
2. **کل اولویت ۴ از صفر** (هر ۱۰ بند فهرست نشست ۲۳): صدور تکی، تولید گروهی ۵۰تایی +
   یکتایی کد، مصرف در POS (تک/ترکیبی + Idempotency با دوبار کلیک)، محدودیت کالا/دسته با
   سبد مخلوط، تعویض ⇒ `source=EXCHANGE`، برگشت کامل فاکتور نیمه‌اعتباری، هر ۹ عملیات
   مدیریتی با رمز+دلیل و بررسی Timeline، و هر ۴ کلید رمز دوم.
3. **اول از همه تازه‌های جلسه‌های ۲۴ و ۲۵ که هرگز روی برنامه اجرا نشده‌اند:** دکمه‌های
   چاپ/PDF/پیش‌نمایش جزئیات، انتخاب چندتایی + چاپ گروهی فهرست، چاپ دسته‌ای نمای دسته‌ها،
   تب `creditManagement` گزارشات + خروجی اکسلش، و مخصوصاً **شمارنده‌ی چاپ مسیر گروهی**:
   یک دسته را دو بار چاپ کنید و ببینید بار دوم روی هر سند «نسخه‌ی مجدد» می‌خورد و در
   Timeline هر اعتبار دو ردیف چاپ ثبت شده است.
4. **ریسک کارایی که باید روی دیتای واقعی سنجیده شود:** `creditBatchDocs` برای هر سند یک
   `storeCreditService.detail()` کامل صدا می‌زند (≈۴ کوئری + بارکد). روی ۲۰۰۰ سند این
   کند است. اگر چاپ دسته‌ای بزرگ کند بود، یک `creditDocDataForMany` با یک کوئری گروهی
   بنویسید — ساختارش آماده است (`creditBatchRender` تنها ورودی‌اش است).
5. کار باز بی‌ربط به اعتبار: هیچ. (فهرست جلسه ۲۴ خالی شد.)

---

# جلسه ۲۶ — سقف محیط در گام ۱؛ ممیزی ایستای مسیرهای هرگز-اجرانشده + کمی‌سازی ریسک کارایی

شرح کامل در `CHANGELOG-جلسه۲۶.md`. چک‌لیست اجرایی در `SMOKE-TEST-اولویت۴.md`.

## ⛔ واقعیت محیط — گام ۱ اجرا نشد (بدون تعارف)
* `npm` به‌کل روی PATH نیست: `node v22.23.1` هست، ولی `npm` / `npx` / `pnpm` / `yarn` / `bun` **هیچ‌کدام** نصب نیستند.
* شبکه بسته است (`registry.npmjs.org` در دسترس نیست) ⇒ `npm install` حتی اگر باینری بود هم جواب نمی‌داد.
* `electron` / `chromium` / `tsc` نصب نیستند ⇒ هیچ پنجره‌ای بالا نمی‌آید و `printHtml` / `pdfFromHtml`
  (که روی `BrowserWindow` سوارند) قابل اجرا نیستند. `prisma generate` هم ممکن نیست.

⇒ **گام ۱ اجرا نشد. گام ۲ (۱۰ بند Smoke Test) به‌طور ساختاری ممکن نبود: ۰ از ۱۰ بند روی برنامه‌ی
اجراشده تست شد. گام ۳ (سنجش زمان واقعی چاپ گروهی) هم اندازه‌گیری نشد.** هیچ ادعای دیگری نکنید.

این چهارمین نشست پی‌درپی (۲۳، ۲۴، ۲۵، ۲۶) است که به همین دیوار خورده. **نتیجه‌گیری قطعی:
اولویت ۴ در این نوع محیط هرگز انجام نمی‌شود.** یا باید روی ماشین ویندوزیِ خودِ کاربر
(`npm install && npm run dev`) اجرا شود، یا باید محیطی با `npm` + شبکه + نمایشگر (یا `xvfb`) داده شود.
نشست بعدی اگر دوباره محیط بدون `npm` بود، **همان اول کار همین را اعلام کند و وقت را صرف
کدنویسی جدید نکند** — انبار کدِ تایپ‌چک‌شده‌ی اجرانشده همین‌قدر که هست بس است.

## ✅ آنچه واقعاً همین نشست اجرا شد (۶ سوییت، صفر FAIL)
```
node test/acceptance-session14.mjs                                ⇒ 24 PASS · 0 FAIL
node test/acceptance-session21.mjs                                ⇒ 34 PASS · 0 FAIL
node test/acceptance-session25.mjs                                ⇒ 32 PASS · 0 FAIL
node --experimental-strip-types test/credit-logic-session21.ts     ⇒ 44 PASS · 0 FAIL
node --experimental-strip-types test/credit-ui-logic-session22.ts  ⇒ 32 PASS · 0 FAIL
node --experimental-strip-types test/credit-print-logic-session25.ts ⇒ 24 PASS · 0 FAIL
```
⇒ زیپ جلسه ۲۵ سالم و بدون رگرسیون است. دو FAIL کهنه‌ی جلسه ۱۴ واقعاً بسته شده‌اند (۲۴/۰).
**هیچ فایل کدی در این نشست تغییر نکرد** (فقط سه فایل مستند اضافه شد) — پس پروژه دقیقاً همان‌قدر
کامپایل‌شونده است که کاربر با `tsc` واقعی تأییدش کرده بود.

## 🔍 ممیزی ایستا — بند ۹ فهرست (این «تست» نیست، ردیابی کد است)
چون اجرای واقعی ممکن نبود، کل زنجیره‌ی تازه‌های جلسه ۲۴/۲۵ **از دکمه تا دیتابیس** دستی ردیابی شد.
هدف: پیدا کردن آن دسته خرابی‌هایی که `tsc` نمی‌بیند (کانال IPC ثبت‌نشده، نام کانال غلط، رشته‌ی
هدرنویسی‌شده). نتیجه: **هیچ حلقه‌ی گم‌شده‌ای پیدا نشد.**
* هر ۵ کانالِ مسیر چاپ در سه جا موجود و هم‌نام‌اند —
  `CreditManagement.tsx:73/116/124/136/148` ⇒ `shared/ipc.ts:112/143/145/147/149` ⇒
  `main/ipc/index.ts:153/169/170/171/172`.
* `preload/index.ts:6` یک پل عمومی (`invoke(channel, payload)`) است، نه فهرست سفید ⇒
  کانال تازه هیچ‌وقت در preload جا نمی‌ماند.
* زنجیره‌ی برچسب «نسخه‌ی مجدد» کامل است: `printCount` ⇒ `creditDocDataFor`
  (`PrintService.ts:487-488`: `reprint: c.printCount >= 1`) ⇒ `creditDocBody`
  (`print/templates.ts:786-787`) و `creditBatchHtml` (`:865`) همان `creditDocBody` را صدا می‌زند ⇒
  مسیر دسته‌ای هم مهر می‌خورد.
* دو ردیف جدا (نه یک ردیف تجمیعی) در Timeline: `markPrintedMany` با `auditMany` برای **هر اعتبار**
  یک ردیف `entity='StoreCredit', entityId=id` می‌نویسد (`StoreCreditService.ts:2404-2426`) و
  `detail()` تایم‌لاین را با همان کلید می‌خواند (`:2134`) ⇒ ساختاراً دو ردیف می‌شود؛ ردیف تجمیعیِ
  `StoreCreditBatch` (`:2428-2437`) جداست و در تایم‌لاین جزئیات دیده نمی‌شود.
⚠️ **این‌ها فقط می‌گویند «سیم‌کشی درست است»، نه «رفتار درست است».** ترتیب رندر، CSS صفحه‌بندی
(`page-break-after`)، رفتار واقعی چاپگر، و دیالوگ ذخیره‌ی PDF هیچ‌کدام بدون اجرای برنامه قابل تأیید
نیستند. بند ۹ همچنان **باز** است.

## 📉 گام ۳ — ریسک کارایی: از کد کمی شد (نه اندازه‌گیری‌شده)
`creditBatchDocs` (`PrintService.ts:555-561`) در یک حلقه‌ی `for` با `await` ترتیبی، برای **هر سند**
`creditDocDataFor` را صدا می‌زند و آن هم یک `detail()` کامل. شمارش دقیق رفت‌وبرگشت‌ها به‌ازای هر سند:
1. `setting.findUnique` — `readCreditSettings` (`StoreCreditService.ts:154`)، **هیچ کشی ندارد**
2. `storeCredit.findUnique` (`:2126`)
3. `storeCreditRedemption.findMany` (`:2133`)
4. `auditLog.findMany` با `take: 500` (`:2134`)
5. `creditReminderLog.findMany` با `take: 100` (`:2135`)
6. `storeCreditBatch.findUnique` (`:2136`) — در چاپ دسته‌ای همیشه اجرا می‌شود
7. `user.findMany` — `userNameMap` (`:1971`)
8. `saleInvoice.findMany` — `receiptNoMap` (`:2146`)
9. (گاهی) `storeCredit.findUnique` برای `remainderCreditId` (`:2165`)

⇒ **۸ تا ۹ کوئری ترتیبی برای هر سند** + یک `barcodePng`. روی ۲۰۰۰ سند ≈ **۱۶٬۰۰۰ تا ۱۸٬۰۰۰
رفت‌وبرگشت** پیش از آن‌که رندر HTML شروع شود.

و نکته‌ی اصلی که تا حالا جایی نوشته نشده بود: **`creditDocDataFor` از کل خروجی `detail()` فقط
`detail.credit` را مصرف می‌کند.** `redemptions`، `timeline`، `reminders`، `batch`،
`remainderCredit` و `issuedByName` ساخته می‌شوند و دور ریخته می‌شوند — یعنی موردهای ۳ تا ۷ و ۹
(از جمله **دو تای سنگین‌تر**: تایم‌لاین تا ۵۰۰ ردیف و یادآوری تا ۱۰۰ ردیف به‌ازای هر سند) صد درصد
هدرند. بدتر: هر چاپ دسته‌ای خودش به‌ازای هر اعتبار یک ردیف `auditLog` می‌نویسد، پس **هر بار چاپ
مجدد همان دسته، چاپ بعدی را کندتر می‌کند** تا سقف `take: 500`. ریسک واقعی و ساختاری است، نه فرضی.

### شکل هدفِ `creditDocDataForMany` (آماده‌ی پیاده‌سازی، عمداً پیاده نشد)
کل داده‌ی لازم برای `CreditDocData` با **۴ کوئری ثابت** درمی‌آید، مستقل از N:
`readCreditSettings` یک‌بار + `settingsService.receiptTemplate()` یک‌بار +
`storeCredit.findMany({ where: { id: { in: ids } } })` یک‌بار + `receiptNoMap(prisma, rows)` یک‌بار
(همین حالا هم دسته‌ای است — `StoreCreditService.ts:432`)، بعد `shapeStoreCredit(row, map)` و
`barcodePng` به‌ازای هر ردیف در حافظه.
* **مانع پیاده‌سازی که باید بدانید:** `shapeStoreCredit` و `receiptNoMap` در
  `StoreCreditService.ts` ماژول-خصوصی‌اند و export نشده‌اند. راه تمیز: یک متد تازه
  **داخل خودِ `StoreCreditService`** (مثلاً `rowsForPrint(ids: number[])`) که
  `StoreCreditRow[]` را با همان دو تابع برمی‌گرداند، و `PrintService.creditDocDataForMany`
  فقط همان را به `CreditDocData` تبدیل کند. از `PrintService` مستقیم به `prisma.storeCredit`
  نزنید؛ قاعده‌ی پروژه این نیست.
* ترتیب را صریح حفظ کنید: `findMany` ترتیب `ids` را تضمین نمی‌کند، ولی سند کاغذی باید به ترتیب
  `ids` (مرتبِ صعودیِ `cleanCreditIds`) بیرون بیاید.
* خروجی باید **دقیقاً** `CreditDocData[]` بماند تا `creditBatchHtml` / `creditBatchPerPage` و
  سوییت `credit-print-logic-session25.ts` نشکنند. تنها ورودی‌اش `creditBatchRender` است.
* **چرا این نشست ننوشتمش:** بدون `tsc` و بدون اجرا، افزودن یک متد سرویسی تازه یعنی کد
  تأییدنشده‌ی بیشتر روی انباری که همین حالا هم تأییدنشده است — و گام ۳ صریحاً می‌گفت «اول بسنج،
  اگر کند بود بنویس». سنجش ممکن نبود. اصلِ «توقف تمیز مهم‌تر از کمی جلوتر رفتن» اجرا شد.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* `creditDocDataFor` فقط به `credit` نیاز دارد؛ استفاده از `detail()` در مسیر چاپ یک انتخاب
  اشتباهِ کارایی است، نه یک نیاز داده‌ای. هر بازنویسی باید همین را مبنا بگیرد.
* هیچ کد جدیدی در محیط بدون `tsc` + بدون اجرا اضافه نمی‌شود.

## نشست بعدی دقیقاً از اینجا شروع کند
1. **اول از همه جواب این را روشن کن: آیا `npm` و امکان اجرای Electron داری؟**
   `node -v; npm -v` و وجود `electron`. اگر نه ⇒ همین را بنویس، `SMOKE-TEST-اولویت۴.md` را به
   کاربر بده تا خودش روی ویندوز اجرا کند، و **هیچ فیچر جدیدی نساز**.
2. اگر بله: `npm install && npx prisma generate && npm run typecheck && npm run build` ⇒ خطاهای
   `{}`/implicit-any پریزما در `StoreCreditService.ts` / `PrintService.ts` باید صفر شوند.
3. بعد **کل اولویت ۴ از صفر** با `SMOKE-TEST-اولویت۴.md` (هر ۱۰ بند، به همان ترتیب، نتیجه‌ی واقعی
   هر بند را در همان فایل و سپس در بخش «جلسه ۲۷» همین HANDOFF بنویس).
4. بعد گام ۳: یک دسته‌ی ۲۰۰۰تایی واقعی بساز، زمان `printCreditBatch` و `creditPdf` را بگیر، و اگر
   کند بود `creditDocDataForMany` را عیناً با نقشه‌ی بالا بنویس.
5. کار باز بی‌ربط به اعتبار: هیچ.

---

# جلسه ۲۷ — ممیزی کامل ۲۵ بند روی کد واقعی؛ لایه‌ی مشترکِ گزارش/جزئیات/سبد اضافه شد

شرح کامل در `CHANGELOG-جلسه۲۷.md`. ممیزی بند‌به‌بند با ارجاع `file:line` در `docs/ممیزی-جلسه۲۷/`.

## ⛔ محیط — پنجمین نشست پیاپی بدون npm (۲۳، ۲۴، ۲۵، ۲۶، ۲۷)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند و شبکه بسته است. پس **هیچ بندی از
اولویت ۴ (Smoke Test) این نشست هم اجرا نشد** و `typecheck`/`build` ممکن نبود. کاربر صریحاً گفت
خودش روی ویندوز تست می‌کند، پس `SMOKE-TEST-اولویت۴.md` دست کاربر است و دست‌نخورده ماند.

## ⚠️ یک تناقض که باید حل شود
کاربر نوشت «پرامپت اصلی ۵۴ بخش دارد و عیناً پیوست است» و به «بخش ۳۳» و «بخش ۳۵» ارجاع داد، ولی
نسخه‌ی پیوست‌شده **۲۶ بخش (۰ تا ۲۵)** دارد و شماره‌هایش با ارجاع‌های کاربر یکی نیست (جزئیات =
§۱۶ نه §۱، ضدتقلب = §۸ نه §۱۰، گزارش/اکسل = §۱۵ نه §۳۳/§۳۵). ممیزی روی همان ۲۶ بخشِ موجود انجام
شد و سه پرسش صریح کاربر جدا جواب داده شد. **نشست بعد اول از کاربر نسخه‌ی ۵۴ بخشی را بخواهد** تا
معلوم شود بندی بیرون از این ۲۶ بند جا نمانده است.

## ✅ حکم ممیزی — کامل / ناقص (با شماره‌ی بند پرامپت اصلی)
* **کامل:** §۱ (گسترش StoreCredit بدون مدل موازی) · §۴ (تک/چندباره و مصرف جزئی) · §۷ (بارکد
  بدون مبلغ) · §۹ (تراکنش اتمیک و همزمانی) · §۱۷ (پرداخت ترکیبی POS) · §۲۵ (مستندات)
* **ناقص:** §۲ §۳ §۵ §۶ §۸ §۱۰ §۱۱ §۱۲ §۱۳ §۱۴ §۱۵ §۱۶ §۱۸ §۱۹ §۲۰ §۲۱ §۲۲ §۲۳ §۲۴
* **یافته‌ی مرکزی:** بک‌اند تقریباً کامل است؛ **گلوگاه renderer است.** ۲۱ export از
  `creditUi.ts` و ۶۰+ از `credit.ts` هرگز در هیچ فایل renderer import نشده‌اند.

## ✅ در این نشست انجام شد
۱. ممیزی مستقل ۲۵ بند + سه پرسش کاربر (Q1 جزئیات، Q2 ضدتقلب واقعی یا تئوریک، Q3 اکسل هر گزارش).
۲. بخش ۸ تازه در `src/shared/creditUi.ts` — تنها فایل کدیِ تغییریافته:
   `CREDIT_BREAKDOWN_HEADERS`/`breakdownRow`، `CREDIT_DASHBOARD_HEADERS`/`dashboardExportRows`،
   `describeRestrictions`، `holderFacts`، `creditLinkFacts`، `creditCartCoverage`، `isLineExcluded`.
۳. `tools/tsx-parse-check.mjs` — بررسی نحوی `.tsx` بدون `tsc` (⚠️ باگ‌دار، پایین را بخوان).
۴. شش سوییت آفلاین دوباره اجرا شد ⇒ ۱۹۰ PASS · ۰ FAIL، بدون رگرسیون.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* هر «تصمیم» تازه‌ی UI در `@shared/creditUi.ts` می‌نشیند، نه در JSX — چون در این محیط فقط `.ts`
  قابل اجرا/تست است و `.tsx` نه. بخش ۸ همین قاعده را ادامه می‌دهد.
* خروجی اکسل داشبورد از **همان** `dashboardCards` ساخته می‌شود (`dashboardExportRows`) تا کارت
  روی صفحه و ردیف اکسل هیچ‌وقت از هم جدا نشوند.
* `excludedVariantIds` که `credit:preview` برمی‌گرداند قرارداد رسمی §۱۸ برای علامت‌گذاری سبد است؛
  `creditCartCoverage` تنها مرجع آن تقسیم است.

## نشست بعدی دقیقاً از اینجا شروع کند — به همین ترتیب

### گام ۱ — UI (بزرگ‌ترین گپ؛ همه‌ی افزوده‌های بخش ۸ برای همین ساخته شده‌اند)
`src/renderer/src/pages/CreditManagement.tsx` (۲۲۵ خط، JSX یک‌خطیِ فشرده). پیشنهاد معماری:
فرم‌ها را به فایل‌های تازه‌ی `components/CreditForms.tsx` + `components/CreditPickers.tsx` ببر تا
JSX چندخطی و قابل‌بازبینی شود، بعد از صفحه import کن.
1. **`IssueForm` (§۱۸ + §۱۲ + §۳ + §۵/§۶)** — الان فقط مبلغ/تعداد/عنوان/مشتری/روز/دفعات/دلیل دارد.
   اضافه شود: انتخابگر «دامنه‌ی مصرف» (`ALL`/`CATEGORY`/`VARIANTS`) + چندانتخابی دسته از
   `CH.categoryTree` (`{id,name,parentId,depth}` — همان الگوی `PriceAdjust.tsx:461`) + چندانتخابی
   کالا با `AllProductsModal`/`VariantSearchBox`؛ `minPurchase`؛ `maxPerTransaction`؛ `customerLocked`؛
   بلوک گیرنده (`holderCompany`, `holderNationalId`, `holderPhone`, `holderAddress`, `holderAgent`,
   `holderNote`)؛ `note`; `prefix`; `asDraft`; `reminderOptOut`; `expiryMode` = `default`/`none`/`days`؛
   و در حالت گروهی `codeLength` + نمایش `previewCodeSpace`.
   ⚠️ نام فیلد در Draft **`restrictVariantIds`** است (نه `restrictProductIds`).
   `buildIssuePayload`/`buildBulkPayload` این فیلدها را از قبل می‌گیرند و اعتبارسنجی می‌کنند —
   فقط از UI پر نمی‌شوند. الان هر اعتباری «همه‌ی کالاها، بدون سقف» صادر می‌شود.
2. **`SettingsForm` (§۲۲ + §۶ + §۱۳ + §۱۴ + §۷ + §۱۵)** — الان فقط `codeLength`, `bulkMaxCount`,
   دو `prefix`, و `types[MANUAL|EXCHANGE].days/maxUses` دارد. غایب‌اند: `codeAlphabet`
   (از `CREDIT_ALPHABET_LABELS`)، `excludeSimilar`، `autoGrowLength`، `bulkCapacityRatio`،
   `barcodeIncludeText`، `barcodeHeightMm`، `paper` (از `CREDIT_PAPER_LABELS`)، `customWidthMm`،
   `customHeightMm`، `showRules`، `showHolder`، `showRemaining`، `rulesText`، هر ۶ فیلد
   `reminder`، `reportLiability`، و `types[*].multiUse`. از `buildSettingsPayload` استفاده کن.
3. **`OpForm` (§۱۰/§۱۱)** — **۴ عملیات از ۹ عملیات مدیریتی از UI قابل انجام نیستند**، چون فرم
   فقط `managerPassword`/`reason`/`extendDays`/`amount` را می‌گیرد: `EXPIRY` (تاریخ جلالی با
   `JalaliDateInput`)، `USES` (`usesMode`+`maxUses`+`maxPerTransaction`)، `HOLDER` (کل بلوک گیرنده)،
   `RESTRICTION` (دامنه + دسته/کالا + `minPurchase` + `maxPerTransaction`). `buildOpPayload` همه‌شان
   را از قبل پشتیبانی می‌کند. هشدارهای `result.warnings` هم باید دیده شوند.
4. **صفحه‌ی جزئیات (§۱۶ + §۱۲ + §۱۸ + §۱۹ + Q1)** — الان فقط ۸ فیلد + Timeline. غایب‌اند:
   `holderFacts`، `describeRestrictions`، `creditLinkFacts`، جدول `detail.redemptions`
   (`CREDIT_REDEMPTION_HEADERS`/`redemptionRow`)، جدول `detail.reminders`
   (`CREDIT_REMINDER_LOG_HEADERS`/`reminderLogRow`)، و `issuedByName`. سرویس همه‌ی این‌ها را
   **از جلسه ۲۱ برمی‌گرداند و دور ریخته می‌شود.**
5. **گیت‌ها (§۲۰)** — `PANEL_KEYS.creditBulkIssue` و `PANEL_KEYS.creditVoid` تعریف و در
   `LOCKED_PANELS` ثبت‌اند ولی **هیچ‌جا استفاده نمی‌شوند**: مودال تولید گروهی و مودال عملیات باید
   با `ManagerGate` مخصوص خودشان پوشیده شوند.
6. **خروجی اکسل هر گزارش (§۱۵ + Q3)** — الان فقط فهرست. اضافه شود: داشبورد
   (`dashboardExportRows`)، تفکیک `byStatus`/`bySource` (`breakdownRow`)، سوابق مصرف، Timeline،
   لاگ یادآوری، و دسته‌ها (`batchRow`).
7. **یادآوری (§۱۴)** — فیلتر «فقط واجد شرایط» (الان همیشه `onlyDue:false`)، و مصرف کانال
   `CH.creditReminderLogs` که ثبت شده و هرگز صدا زده نمی‌شود.
8. **`Pos.tsx` (§۱۸، فاز اول است نه آینده)** — `creditPreview` همین حالا `excludedVariantIds` و
   `notes` را می‌گیرد و **دور می‌ریزد** (`Pos.tsx:486-488` فقط `.applied` را برمی‌دارد). با
   `creditCartCoverage` اقلام خارج از دامنه را در سبد علامت بزن و `plan.notes` را نشان بده.
   همچنین payload پیش‌نمایش (`Pos.tsx:500-507`) `customerId: null` می‌فرستد و `categoryId` هر خط
   را نمی‌فرستد ⇒ پیش‌نمایش دسته/مشتری وفادار نیست.

### گام ۲ — بک‌اند (به ترتیب اهمیت)
1. **§۸ باگ مالی واقعی:** مسیر پاک‌سازی گزارش‌ها (`SalesService.ts:4223-4258`) فاکتور و پرداخت را
   حذف می‌کند ولی `reverseInvoiceRedemptions` را صدا نمی‌زند ⇒ اعتبار «مصرف‌شده» می‌ماند در حالی که
   فاکتورش نیست.
2. **§۵/§۲۴ اتمیک نبودن تولید گروهی:** `StoreCreditService.ts:1810-1823` چانکِ خطادار را می‌بلعد و
   `created < count` برمی‌گرداند؛ و `:1733` دسته را *قبل* از تولید کدها می‌سازد ⇒ دسته‌ی خالی ممکن است.
3. **§۶ پیش‌سنجش فضای کد فقط در مسیر گروهی است** (`:1700`)؛ مسیر صدور تکی (`:590-655`) فقط
   retry loop دارد.
4. **§۲/§۱۱/§۱۵ وضعیت منقضی:** داشبورد روی `status` خام groupBy می‌کند (`:2253-2298`) نه
   `effectiveStatus` ⇒ رکورد ACTIVEِ تاریخ‌گذشته «فعال» شمرده می‌شود.
5. **§۱۱:** `reverseInvoiceRedemptions` (`:1137-1165`) بدون `canCreditTransition` مستقیم `status` می‌نویسد.
6. **§۱۶ جست‌وجو** (`:1916-1926`): شناسه‌ی اعتبار، شماره مشتری، شماره فاکتور/فیش جست‌وجو نمی‌شوند.
7. **§۱۳:** `copies > 1` همان HTML را تکرار می‌کند ولی `markPrinted` را یک بار می‌زند
   (`PrintService.ts:519-528`) ⇒ نسخه‌های دوم به بعد «نسخه‌ی مجدد» نمی‌خورند. و سند اعتبار لوگو
   ندارد چون `ReceiptTemplate` فیلد لوگو ندارد (تصمیم لازم: افزودن لوگو به قالب مشترک).
8. **§۱۰:** `AuditService.ts:69-84` خطای نوشتن Audit را می‌بلعد (fail-open)؛ و مسیر
   `MaintenanceService.ts:251` می‌تواند ردیف‌های AuditLog را بدون رمز مدیر پاک کند.
9. **§۳:** مسیرهای تعویض/برگشت (`SalesService.ts:1064`, `:2628`) `defaults.returnCodeDays` را
   می‌فرستند و پیش‌فرض `types.EXCHANGE.days` تنظیمات اعتبار را دور می‌زنند.

### گام ۳ — تست (§۲۳)
۵ بند از ۱۴ بندِ §۲۳ اصلاً تست ندارند و بقیه **ساختاری/خالص‌اند نه روی سرویس واقعی**: دو صندوق
همزمان، ارسال تکراری با همان Idempotency Key، دستکاری مبلغ/تاریخ/دفعات، لینک تعویض، کامل بودن
AuditLog، و Rollback روی خطای دیتابیس. هارنس واقعی **به `@prisma/client` نیاز دارد ⇒ در این محیط
غیرممکن است**؛ اولین نشستی که `npm` دارد باید همین را بسازد.

### گام ۴ — ابزار
`tools/tsx-parse-check.mjs` روی ۱۹ فایل `.tsx` سالمِ موجود False Positive می‌دهد (باگ خودش در
تشخیص `<` جنریک/مقایسه). تا درست نشود به آن تکیه نکن.

## کار باز بی‌ربط به اعتبار: هیچ.


# جلسه ۲۸ — گام ۱ (UI) کامل شد · باگ مالی §۸ رفع شد · ابزار .tsx درست شد

شرح کامل در `CHANGELOG-جلسه۲۸.md`.

## ⛔ محیط — ششمین نشست پیاپی بدون npm (۲۳ تا ۲۸)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند. پس اولویت ۴ (Smoke Test) این نشست هم
اجرا نشد و `SMOKE-TEST-اولویت۴.md` دست‌نخورده ماند.

## ✅ کدام بندهای پرامپت این نشست تکمیل شد
* **گام ۱ — هر ۸ بند:** IssueForm · SettingsForm (۱۸ تنظیم) · OpForm (۴ عملیات گمشده) ·
  صفحه‌ی جزئیات (گیرنده/محدودیت/پیوندها/دفتر مصرف/لاگ یادآوری) · گیت‌های `creditBulkIssue` و
  `creditVoid` · خروجی اکسل هر گزارش · فیلتر «فقط واجد شرایط» + کانال `creditReminderLogs` ·
  علامت‌گذاری سبد در `Pos.tsx` + payload وفادار پیش‌نمایش.
* **گام ۲ بند ۱ (§۸):** رفع باگ مالی مسیر حذف گزارشات.
* **گام ۴:** رفع `tools/tsx-parse-check.mjs` ⇒ همه‌ی 47 فایل نحواً سالم‌اند.
* سوییت تازه: `test/credit-ui-logic-session28.ts` (credit-ui-logic (session 28): 51 PASS · 0 FAIL).

## ❌ چه چیزی با شماره‌ی بند باقی ماند (نشست بعد از همین‌جا شروع کند)
### اولویت ۱ — گام ۲ بک‌اند، بندهای ۲ تا ۹ (عیناً فهرست «جلسه ۲۷ › گام ۲»)
۲. §۵/§۲۴ اتمیک نبودن تولید گروهی (`StoreCreditService.ts:1810-1823` چانکِ خطادار را می‌بلعد؛
   `:1733` دسته را قبل از تولید کدها می‌سازد ⇒ دسته‌ی خالی ممکن است).
۳. §۶ پیش‌سنجش فضای کد فقط در مسیر گروهی است (`:1700`)؛ صدور تکی (`:590-655`) فقط retry دارد.
۴. §۲/§۱۱/§۱۵ داشبورد روی `status` خام groupBy می‌کند (`:2253-2298`) نه `effectiveStatus`.
۵. §۱۱ `reverseInvoiceRedemptions` (`:1137-1165`) بدون `canCreditTransition` مستقیم `status` می‌نویسد.
۶. §۱۶ جست‌وجو (`:1916-1926`): شناسه‌ی اعتبار، شماره مشتری و شماره فاکتور/فیش جست‌وجو نمی‌شوند.
   ⚠️ placeholder فیلد جست‌وجوی UI در جلسه ۲۸ این‌ها را *وعده* می‌دهد ⇒ یا Backend را کامل کن یا متن را کم کن.
۷. §۱۳ `copies > 1` یک بار `markPrinted` می‌زند (`PrintService.ts:519-528`)؛ و لوگوی سند اعتبار.
۸. §۱۰ `AuditService.ts:69-84` خطای Audit را می‌بلعد؛ `MaintenanceService.ts:251` می‌تواند
   AuditLog را بدون رمز مدیر پاک کند. §۱۲ هم `before` تغییر گیرنده ناقص است (`:1475-1485`).
۹. §۳ مسیرهای تعویض/برگشت (`SalesService.ts:1064`, `:2628`) `defaults.returnCodeDays` می‌فرستند و
   پیش‌فرض `types.EXCHANGE.days` را دور می‌زنند. §۱۹ هم `source` تغییرپذیر است (immutable نیست).
### اولویت ۲ — گام ۳ (§۲۳): هارنس واقعی روی `@prisma/client`. **فقط اگر npm داشتی.**
### اولویت ۳ — کارهای UI که این نشست عمداً دست نزد
* `SalesReports.tsx` تب اعتبار: فقط خروجی فهرست دارد؛ با `creditExport` می‌شود همان ۹ گزارش را داد.
* §۱۸ در `Pos.tsx`: فقط *علامت‌گذاری* شد؛ «غیرفعال‌کردن» ردیف خارج از دامنه عمداً انجام نشد
  (سبد نباید به‌خاطر اعتبار قفل شود).

## قطعی‌های تازه (دوباره تصمیم نگیر)
* UI این ماژول چهار فایل است: `pages/CreditManagement.tsx` + `components/CreditForms.tsx` +
  `components/CreditPickers.tsx` + `components/CreditDetailView.tsx`.
* هر «تصمیم» تازه در `@shared/creditUi.ts` (بخش ۹ ادامه دارد) و تستش در
  `test/credit-ui-logic-session28.ts`.
* خروجی اکسل هر گزارش فقط و فقط از `creditExport` می‌آید.
* عملیات مدیریتیِ «جایگزین‌کننده» همیشه با `prefillOpDraft` پیش‌پر می‌شود.
* `tools/tsx-parse-check.mjs` حالا قابل اعتماد است؛ قبل از تحویل روی همه‌ی `.tsx` بزن.


# جلسه ۲۹ — ۴ بند از ۸ بندِ اولویت ۱ بک‌اند انجام شد؛ سقف نشست وسط گام ۱

شرح کامل در `CHANGELOG-جلسه۲۹.md`.

## ⛔ محیط — هفتمین نشست پیاپی بدون npm (۲۳ تا ۲۹)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند. پس **گام ۲ پرامپت (هارنس واقعی §۲۳
روی `@prisma/client`) طبق شرط خودش اجرا نشد** و اولویت ۴ (Smoke Test) هم مثل شش نشست قبل
باقی ماند. `SMOKE-TEST-اولویت۴.md` دست‌نخورده است.

## ✅ کدام بندها این نشست تکمیل شد
* **بند ۲ (§۵/§۲۴) — تولید گروهی اتمیک شد.** کدها قبل از ساختن دسته تولید می‌شوند (دیگر
  «دسته‌ی خالی» ممکن نیست) و اولین بسته‌ی خطادار ⇒ پاک شدن ردیف‌ها + حذف دسته + یک ردیف
  AuditLog دائمی از شکست + خطای فارسی. `created < requested` دیگر وجود ندارد.
* **بند ۵ (§۱۱) — `reverseInvoiceRedemptions` از `canReverseTransition` رد می‌شود.** جدول
  تازه‌ی `CREDIT_REVERSAL_TRANSITIONS`: `USED ⇒ ACTIVE` فقط از مسیر برگشت فاکتور مجاز است،
  `CANCELED` پایانی و `SUSPENDED` محفوظ می‌مانند و دلیلِ نوشته‌نشدن وضعیت در AuditLog می‌نشیند.
* **بند ۸ بخش اول (§۱۰) — Audit اعتبار fail-closed شد.** `auditOrThrow` در `AuditService.ts` و
  `import { auditOrThrow as audit }` در کل `StoreCreditService`؛ چون همه داخل `$transaction`
  هستند، شکست لاگ خودِ تغییر را rollback می‌کند. `markPrinted` تکی هم تراکنشی شد.
* **بخش ۹ تازه در `src/shared/credit.ts`** (نه `creditUi.ts` — چون این‌ها قاعده‌ی مالی/امنیتی‌اند
  و هدر `creditUi.ts` آن را ممنوع کرده): `creditStatusWhere`، `rollExpiredBuckets`،
  `planRedemptionReversal`/`canReverseTransition`، `sourceChangeError`، `exchangeCreditDays`،
  `creditCopyPlan`، `isProtectedAuditRow`، `creditSearchPlan`.
* **سوییت تازه:** `test/credit-ui-logic-session29.ts` ⇒ **۳۸ PASS · ۰ FAIL** (هر هشت تصمیم بالا
  واقعاً اجرا و تست می‌شود). جمع هشت سوییت: **۲۷۸ PASS · ۱ FAIL**.

## ❌ چه چیزی با شماره‌ی بند باقی ماند — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — ادامه‌ی گام ۱ بک‌اند: بندهای ۳، ۴، ۶، ۷، ۹ و نیمه‌ی دوم بند ۸
⚠️ **خبر خوب: تصمیمِ پنج بند از این‌ها از قبل نوشته و تست شده است** (بخش ۹ `credit.ts`). کار
باقی‌مانده «مصرف کردن» آن‌ها در سرویس است، نه طراحی دوباره. import هایشان عمداً از
`StoreCreditService` برداشته شد تا `typecheck` هشدار بی‌استفاده ندهد؛ اول برشان گردانید.

۳. **§۶ — پیش‌سنجش فضای کد در مسیر صدور تکی** (`StoreCreditService.ts:590-655`؛ الان فقط
   retry loop دارد و `assertCodeSpace` را صدا نمی‌زند، در حالی که مسیر گروهی `:1700` می‌زند).
   با `count: 1` صدا بزنید، طولِ رشدیافته (`space.length`) را به `generateStoreCreditCode`
   بدهید و رشد را در note همان AuditLog صدور بنویسید. ⚠️ وقتی `input.code` از پیش آمده
   (مسیر گروهی) پیش‌سنجش نباید دوباره اجرا شود.
۴. **§۲/§۱۱/§۱۵ — داشبورد روی وضعیت مؤثر** (`:2253-2298`). ابزار آماده است: یک `groupBy` دوم
   با شرط `expiresAt <= now` بگیرید و با `rollExpiredBuckets(all, expiring)` سطل‌ها را جابه‌جا
   کنید؛ و `creditStatusWhere(filter.status, now)` را در `whereFromFilter` (`:1904`) داخل
   `where.AND` بگذارید (نه `where.OR` — وگرنه `OR`ِ جست‌وجو خراب می‌شود).
۶. **§۱۶ — جست‌وجوی شناسه اعتبار/شماره مشتری/شماره فاکتور و فیش** (`:1916-1926`).
   `creditSearchPlan(term)` تصمیم را می‌دهد. ⚠️ نکته‌ی واقعی: بین `StoreCredit` و
   `StoreCreditRedemption` هیچ relation پریزمایی نیست (فقط ستون scalar)، پس شماره فاکتور/فیش
   دو مرحله‌ای است: اول `SaleInvoice.receiptNo` ⇒ idها، بعد تطبیق با
   `sourceInvoiceId`/`exchangeInvoiceId`/`usedInvoiceId` + یک کوئری روی
   `storeCreditRedemption.receiptNo|invoiceId` ⇒ `creditId`ها. یعنی `whereFromFilter` باید
   async شود یا یک `searchExtensions(filter)` جدا بگیرد. placeholder فیلد جست‌وجوی UI این‌ها
   را از جلسه ۲۸ *وعده* می‌دهد.
۷. **§۱۳ — `copies > 1` و لوگوی سند.** `PrintService.ts:519-528` همان یک HTML را N بار چاپ
   می‌کند و `markPrinted` را یک بار می‌زند. `creditCopyPlan(prevPrintCount, copies)` تصمیمش
   آماده است: برای هر کاغذ HTML را *دوباره* رندر کنید و بعدش `markPrinted` بزنید تا کاغذ دوم
   به بعد «نسخه‌ی مجدد» بخورد. لوگو: `ReceiptTemplate` (`src/shared/receipt.ts:212`) فیلد لوگو
   ندارد ولی `LabelTemplate:494` یک `logoDataUrl` *مشترک همه‌ی قالب‌ها* دارد ⇒ تصمیم پیشنهادی:
   `showLogo`/`logoHeightMm`/`logoDataUrl` به `ReceiptTemplate` اضافه شود و
   `SettingsService.receiptTemplate()` وقتی خالی است از همان لوگوی لیبل پر کند (کاربر دو بار
   لوگو آپلود نکند)، بعد `creditDocBody` (`templates.ts:784`) بالای نام فروشگاه رندرش کند.
۸. **نیمه‌ی دوم §۱۰ + §۱۲.** (الف) `MaintenanceService.ts:251` همچنان می‌تواند کل AuditLog را
   بدون رمز مدیر پاک کند: `isProtectedAuditRow` تصمیمِ «کدام ردیف حق حذف ندارد» را می‌دهد ⇒
   در SQL پاک‌سازی و در `preview` (`:124`) هر دو اعمال شود، و برای پاک‌سازی *بقیه‌ی* لاگ
   `assertManagerPassword` لازم شود. اگر رمز نیامد، بهتر است پاک‌سازی لاگ *رد شود* (با هشدار در
   خروجی) نه اینکه کل سبک‌سازی خطا بدهد؛ و فیلد رمز به بلوک سبک‌سازی `Settings.tsx:3921` اضافه
   شود وگرنه کاربر دیگر نمی‌تواند لاگ را پاک کند. (ب) `before` تغییر گیرنده (`:1475-1485`) فقط
   ۵ فیلد را snapshot می‌کند؛ `holderNationalId`/`holderAddress`/`holderAgent`/`holderNote`/
   `reminderOptOut` هم باید بیفتد.
۹. **§۳ و §۱۹.** (الف) `SalesService.ts:1072` و `:2635` هنوز `days: input.creditDays ??
   defaults.returnCodeDays` می‌فرستند و پیش‌فرض `types.EXCHANGE.days` را دور می‌زنند ⇒ با
   `exchangeCreditDays({ explicit: input.creditDays, exchangeDays: (await readCreditSettings(tx)).types.EXCHANGE.days, returnCodeDays: defaults.returnCodeDays })`
   جایگزین شود (`readCreditSettings` از `StoreCreditService` export شده است).
   (ب) §۱۹ `source` تغییرپذیر است ⇒ `sourceChangeError(row.source, data.source)` را در
   `managerChange` (`:1213-1248`) اعمال کنید. اگر گارد دیتابیسی هم می‌خواهید: تریگر SQLite
   ممکن است ولی `splitStatements` در `src/main/db/migrator.ts:106` بدنه‌ی
   `BEGIN … END;` را نصف می‌کند ⇒ اول باید آن را (بهتر است در یک فایل خالصِ جدا و تست‌پذیر)
   اصلاح کنید.
### اولویت ۲ — گام ۲ پرامپت (§۲۳): هارنس واقعی روی `@prisma/client`. **فقط اگر npm داشتی.**
### اولویت ۳ — گام ۳ پرامپت (UI؛ این نشست شروع نشد)
* تب اعتبارِ `SalesReports.tsx` (`:2180-2198`) هنوز فقط `CREDIT_LIST_HEADERS`/`creditListRow`
  را دستی جفت می‌کند ⇒ باید مثل `CreditManagement.tsx:338` از `creditExport` رد شود و هر ۹
  گزارش را بدهد (داشبورد/byStatus/bySource/... همه از دل همان `dashboard` و `rows` موجود).
* بند ۲۸ هارنس `test/acceptance-session25.mjs:164-166` **تنها FAIL پروژه** است و باید با
  واقعیت جلسه ۲۸ (خروجی اکسل فقط از `creditExport` می‌آید) به‌روز شود.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **قاعده‌ی مالی/امنیتی در `credit.ts` می‌نشیند، تصمیم نمایشی در `creditUi.ts`.** هدر
  `creditUi.ts` صریحاً اجازه‌ی نگه‌داشتن قاعده‌ی امنیتی را ندارد؛ بخش ۹ `credit.ts` خانه‌ی
  قواعد تازه است و تستش در `test/credit-ui-logic-session29.ts`.
* **Audit اعتبار خرید fail-closed است.** هر لاگ تازه در این ماژول باید با همان
  `auditOrThrow` (نام واردشده: `audit`) و با **کلاینت تراکنشی همان تغییر** نوشته شود.
* **تولید گروهی «همه یا هیچ» است.** هیچ مسیری نباید دوباره «دسته‌ی نصفه» تحویل بدهد.
* **`USED ⇒ ACTIVE` فقط از مسیر برگشت فاکتور مجاز است** (`CREDIT_REVERSAL_TRANSITIONS`)، نه
  از عملیات مدیریتی.

## کار باز بی‌ربط به اعتبار: هیچ.

# جلسه ۳۰ — بندهای ۳، ۴، ۶، §۱۲ از بند ۸، و بند ۹ تمام شد؛ سقف نشست وسط گام ۱

شرح کامل در `CHANGELOG-جلسه۳۰.md`.

## ⛔ محیط — هشتمین نشست پیاپی بدون npm (۲۳ تا ۳۰)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند ⇒ **گام ۲ پرامپت (هارنس
واقعی §۲۳) اجرا نشد** و اولویت Smoke Test هم دست‌نخورده ماند.

## ✅ این نشست تکمیل شد
* **بند ۳ (§۶)** پیش‌سنجش فضای کد در صدور تکی (`StoreCreditService.ts` — بلوک
  «بند ۳ (جلسه ۳۰)» قبل از retry loop). کدِ آماده ⇒ بدون پیش‌سنجش (`needsCodeSpaceCheck`).
* **بند ۴ (§۲/§۱۱/§۱۵)** داشبورد و فیلتر روی وضعیت مؤثر (`rollExpiredBuckets` +
  `creditStatusWhere` داخل `withAndClause`).
* **بند ۶ (§۱۶)** جست‌وجوی دومرحله‌ای؛ `whereFromFilter` async شد و هر دو صدازننده
  (`list`, `dashboard`) await می‌کنند.
* **نیمه‌ی دوم بند ۸ — فقط بخش §۱۲** snapshot کامل گیرنده با `holderSnapshot`.
* **بند ۹ (§۳ + §۱۹)** `exchangeCreditDays` در `SalesService` و `sourceChangeError`
  در `managerChange`.
* **بخش ۹.۱ `credit.ts` و بخش ۱۰ `creditUi.ts`** ساخته شدند (فهرست دقیق در CHANGELOG).
* **سوییت تازه:** `test/credit-ui-logic-session30.ts` ⇒ **35 PASS · 0 FAIL**.

## ❌ باقی‌مانده با شماره‌ی بند — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — باقی‌مانده‌ی گام ۱ بک‌اند
۷. **§۱۳ — `copies > 1` و لوگوی سند. (دست‌نخورده)** `PrintService.printCredit`
   (`:519-528`) همچنان یک HTML را N بار چاپ می‌کند و `markPrinted` را یک بار می‌زند.
   تصمیمش آماده است: `creditCopyPlan(prev, copies)` (بخش ۹ `credit.ts`) ⇒ برای هر
   کاغذ `creditDocHtml({ ...data, printCount: copy.printCount, reprint: copy.reprint })`
   دوباره رندر و بعدِ هر کاغذ `markPrinted` زده شود. `prev = data.printCount - 1`.
   **لوگو:** تصمیم نمایشی‌اش همین نشست ساخته و تست شد (`creditDocLogo` در بخش ۱۰
   `creditUi.ts`) ولی هنوز مصرف نشده ⇒ (الف) `showLogo`/`logoHeightMm`/`logoDataUrl`
   به `ReceiptTemplate` (`src/shared/receipt.ts:212` و `DEFAULT_RECEIPT_TEMPLATE:277`)
   اضافه شود، (ب) `SettingsService.receiptTemplate()` (`:137`) وقتی خالی است از
   `labelTemplate().logoDataUrl` پر کند، (ج) `creditDocBody` (`templates.ts:784`) بالای
   نام فروشگاه رندرش کند، (د) یک تیک + ارتفاع در `toggles` بلوک قالب رسید
   `Settings.tsx:1482-1505` (وگرنه پیش‌فرض `false` می‌ماند و کاربر راهی برای روشن کردنش ندارد).
۸. **نیمه‌ی دوم بند ۸ — بخش §۱۰ (دست‌نخورده).** `MaintenanceService.ts:252` همچنان
   `DELETE FROM "AuditLog" WHERE "at" < ?` خام است. ابزارش این نشست ساخته و روی
   **SQLite واقعی** تست شد: `auditPurgeableSql()` ⇒ `{ sql, params }`. کار باقی‌مانده:
   (الف) در `archivePurge` ⇒ `DELETE FROM "AuditLog" WHERE "at" < ? AND ${p.sql}` با
   `[cutoffDate, ...p.params]`؛ (ب) در `preview` (`:124`) همان شرط تا عدد پیش‌نمایش با
   واقعیت یکی باشد + یک فیلد تازه‌ی `auditLogsProtected` در `MaintenancePreview`
   (`src/shared/types.ts:2153`)؛ (ج) برای پاک‌سازی *بقیه‌ی* لاگ `assertManagerPassword`
   لازم شود و اگر رمز نیامد **فقط پاک‌سازی لاگ رد شود** (با هشدار در خروجی)، نه کل سبک‌سازی؛
   (د) فیلد رمز مدیر به بلوک سبک‌سازی `Settings.tsx:3921` + ارسالش در `runArchivePurge`
   (`:1289`) و `maintenanceArchivePurge` در `ipc/index.ts:316`.
### اولویت ۲ — گام ۲ پرامپت (§۲۳): هارنس واقعی روی `@prisma/client`. **فقط اگر npm داشتی.**
### اولویت ۳ — گام ۳ پرامپت (UI؛ این نشست شروع نشد)
* تب اعتبارِ `SalesReports.tsx` (`:2179-2198`) هنوز `CREDIT_LIST_HEADERS`/`creditListRow`
  را دستی جفت می‌کند و ردیف جمعش دست‌ساز است ⇒ از `creditExport` رد شود (الگوی
  `CreditManagement.tsx:338`). فهرست دکمه‌ها آماده است: `CREDIT_RANGE_EXPORTS` (۷ گزارش
  بازه‌ای؛ سه‌تایشان `lazy` یعنی داده‌شان فقط با کلیک از `creditBatchList` /
  `creditReminderCandidates` / `creditReminderLogs` گرفته شود). `redemptions`/`timeline`
  عمداً بازه‌ای نیستند (`CREDIT_DETAIL_EXPORT_KINDS`).
* **بند ۲۸ هارنس** `test/acceptance-session25.mjs:164` تنها FAIL پروژه است. ⚠️ نکته: با
  رفتن تب گزارشات روی `creditExport`، **بند ۲۷ همان هارنس** (`:155-163`) هم دیگر معنا
  ندارد (به `totals.amount`/`Array(len - 6)` دستی گره خورده) ⇒ هر دو با هم به «هر دو صفحه
  از `creditExport` + `creditListTotals` رد می‌شوند» به‌روز شوند.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **هر شرط تازه‌ی `where` در `AND` می‌نشیند** (`withAndClause`)، وگرنه `OR`ِ جست‌وجو رونویسی می‌شود.
* **تعریف «سابقه‌ی محافظت‌شده» دو نسخه دارد که از یک ثابت ساخته می‌شوند**: JS
  (`isProtectedAuditRow`) و SQL (`auditProtectedSql`). هیچ‌وقت یکی‌شان دستی نوشته نشود.
* **`source` تغییرناپذیر است و گاردش در `managerChange` است** (نه در یک عملیات خاص).
* **گزارش‌های تک‌اعتباری (`redemptions`/`timeline`) در تب بازه‌ای دکمه نمی‌گیرند.**

## کار باز بی‌ربط به اعتبار: هیچ.

# جلسه ۳۱ — بند ۷ و نیمه‌ی §۱۰ از بند ۸ تمام شد؛ **اولویت ۱ بسته شد**

شرح کامل در `CHANGELOG-جلسه۳۱.md`.

## ⛔ محیط — نهمین نشست پیاپی بدون npm (۲۳ تا ۳۱)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند ⇒ **گام ۲ پرامپت (هارنس واقعی §۲۳)
اجرا نشد** و Smoke Test هم دست‌نخورده ماند. سقف نشست وسط **گام ۳** رسید.

## ✅ این نشست تکمیل شد
* **بند ۷ (§۱۳)** `printCredit` برای هر نسخه دوباره رندر می‌کند (`creditCopyPlan`) و بعدِ هر کاغذ
  `markPrinted` می‌زند؛ لوگوی سند از قالب رسید می‌آید (`showLogo`/`logoHeightMm`/`logoDataUrl`) و
  اگر خالی باشد **زنده** از لوگوی لیبل ارث می‌برد (`receiptLogoInherit` + قرینه‌ی `receiptLogoForSave`).
  تیک و ارتفاعش در تنظیمات ← قالب رسید است.
* **نیمه‌ی §۱۰ از بند ۸** پاک‌سازی لاگ با `auditPurgeableSql` + دو عدد در پیش‌نمایش
  (`auditLogs` / `auditLogsProtected`) + رمز مدیر (شکستش فقط همین مرحله را رد می‌کند، با `warnings`).
* **سوییت تازه:** `test/credit-ui-logic-session31.ts` ⇒ **35 PASS · 0 FAIL** (جمع: ۳۴۸ PASS · ۱ FAIL).

## ❌ باقی‌مانده — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — **هیچ. بسته شد.**
### اولویت ۲ — گام ۲ پرامپت (§۲۳): هارنس واقعی روی `@prisma/client`. **فقط اگر npm داشتی.**
### اولویت ۳ — گام ۳ پرامپت (UI؛ این نشست شروع نشد)
* تب اعتبارِ `SalesReports.tsx` (`:2179-2198`) هنوز `CREDIT_LIST_HEADERS`/`creditListRow` را دستی
  جفت می‌کند و ردیف جمعش دست‌ساز است ⇒ از `creditExport` رد شود (الگوی `CreditManagement.tsx:338`)
  و دکمه‌هایش از `CREDIT_RANGE_EXPORTS` ساخته شوند (سه‌تای `lazy` داده‌شان فقط با کلیک از
  `creditBatchList`/`creditReminderCandidates`/`creditReminderLogs`). `redemptions`/`timeline`
  عمداً بازه‌ای نیستند (`CREDIT_DETAIL_EXPORT_KINDS`).
* **بندهای ۲۷ و ۲۸ هارنس** `test/acceptance-session25.mjs:155-166` با هم به‌روز شوند: ۲۸ تنها FAIL
  پروژه است و ۲۷ با رفتن تب گزارشات روی `creditExport` بی‌معنا می‌شود (به `totals.amount` و
  `Array(len - 6)` دستی گره خورده).

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **هر کاغذِ چاپ اعتبار = یک رندر + یک `markPrinted`.** شماره و برچسب هر کاغذ فقط از `creditCopyPlan`.
* **لوگوی قالب رسید از لوگوی لیبل *زنده* ارث می‌برد**: خواندن با `receiptLogoInherit`، ذخیره با
  `receiptLogoForSave`. هیچ‌وقت مقدار ارث‌بری‌شده ذخیره نشود.
* **پاک‌سازی لاگ = `auditPurgeableSql` + رمز مدیر.** شکست گیت رمز هرگز کل سبک‌سازی را رد نمی‌کند،
  فقط همان مرحله را (با `warnings` در خروجی).
* **رمز مدیر همیشه قبل از باز شدن تراکنش سنجیده می‌شود** (SQLite تک‌نویسنده است).

## کار باز بی‌ربط به اعتبار: هیچ.

# جلسه ۳۲ — تب گزارشاتِ اعتبار روی لایه‌ی مشترک نشست؛ **پروژه بدون هیچ FAIL**

شرح کامل در `CHANGELOG-جلسه۳۲.md`.

## ⛔ محیط — دهمین نشست پیاپی بدون npm (۲۳ تا ۳۲)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند ⇒ **گام ۱ پرامپت (هارنس واقعی §۲۳ روی
`@prisma/client`) طبق شرط خودش اجرا نشد** و Smoke Test دست‌نخورده ماند. گام ۲ (کار اصلی نشست) کامل شد.

## ✅ این نشست تکمیل شد
* **بخش ۱۱ `src/shared/creditUi.ts`** — «داده‌ی هر خروجی بازه‌ای از کجا می‌آید»:
  `creditRangeExportOrigin` (`rows`/`dashboard`/`fetch`/`none`) · `CREDIT_RANGE_EXPORT_CHANNELS` ·
  `creditRangeExportRequest` · `creditRangeExportRows` (باز کردن پاکت `{ enabled, rows }`).
* **تب اعتبارِ `SalesReports.tsx`** (`CreditManagementReport`) — دکمه‌های خروجی از
  `CREDIT_RANGE_EXPORTS` ساخته می‌شوند (`:2307-2334`)، `doExport(kind)` از `creditExport` رد می‌شود
  (`:2192-2232`)، و ردیف جمعِ صفحه و اکسل از `creditListTotals` می‌آید (`:2182-2190` و `:2372-2381`).
  `exportExcel` دست‌ساز، `Array(CREDIT_LIST_HEADERS.length - 6)` و `colSpan`های دستی حذف شدند.
* **بندهای ۲۷ و ۲۸ هارنس** `test/acceptance-session25.mjs` (`:170-216`) با هم بازنویسی شدند: ۲۷ حالا
  REAL است و خودِ `creditListTotals`/`creditExport` را اجرا می‌کند، ۲۸ «هر دو صفحه از `creditExport`»
  را می‌سنجد ⇒ **تنها FAIL پروژه بسته شد** (Session 25: ۳۲ PASS · ۰ FAIL).
* **سوییت تازه:** `test/credit-ui-logic-session32.ts` ⇒ **۳۹ PASS · ۰ FAIL** (شامل سنجش `payload` هر
  کانال با امضای واقعی `StoreCreditService` و ۱۰ گزاره روی *مصرف* واقعی در `SalesReports.tsx`).
* **جمع یازده سوییت: ۳۸۸ PASS · ۰ FAIL.** هر ۴۷ فایل `.tsx` نحواً سالم.

## ❌ باقی‌مانده — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — **هیچ.** (بک‌اند در ۳۱ بسته شد، UI در ۳۲.)
### اولویت ۲ — §۲۳: هارنس واقعی روی `@prisma/client` (دو صندوق همزمان، Idempotency تکراری،
دستکاری مبلغ/تاریخ/دفعات، لینک تعویض، کامل بودن AuditLog، Rollback). **فقط با npm.** ده نشست است منتظر است.
### اولویت ۳ — Smoke Test دستیِ ویندوز (`SMOKE-TEST-اولویت۴.md`): کار کاربر است، نه نشست.
### اولویت ۴ — مرور نهاییِ ممیزی ۲۵ بند با چشم تازه؛ هیچ بند *شناخته‌شده‌ی* بازی نمانده
(Q3 «خروجی جدا برای هر گزارش» با همین نشست کامل شد: ۹ نوع خروجی، ۷ دکمه‌ی بازه‌ای + ۲ خروجی تک‌اعتباری).

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **منبع داده‌ی هر خروجی بازه‌ای فقط از `creditRangeExportOrigin` می‌آید**؛ هیچ `switch` روی نوع گزارش در JSX.
* **کانال هر خروجی `lazy` فقط در `CREDIT_RANGE_EXPORT_CHANNELS`**؛ JSX با `CH[req.channel]` صدا می‌زند.
* **پاکتِ `{ enabled, rows }` فقط با `creditRangeExportRows` باز می‌شود** (هیچ `?.rows` در JSX).
* **نامزدهای یادآوری بازه ندارند** و `onlyDue: false` تصمیم لایه‌ی مشترک است.
* **ردیف جمعِ فهرست اعتبار همیشه `creditListTotals`** — هم روی صفحه، هم در فایل؛ هیچ pad یا `colSpan` دستی.
* **هارنس ۲۵ دیگر به پیاده‌سازیِ یک صفحه گره نمی‌خورد**: بندهای مربوط به خروجی، *لایه‌ی مشترک* را اجرا می‌کنند.

## کار باز بی‌ربط به اعتبار: هیچ.


# جلسه ۳۳ — سخت‌کردنِ نوشته‌ها: بخش ۱۲ و ۱۳ `creditUi.ts` · بخش ۹.۲ `credit.ts` · پنج بند هارنس REAL شد

شرح کامل در `CHANGELOG-جلسه۳۳.md`.

## ⛔ محیط — یازدهمین نشست پیاپی بدون npm (۲۳ تا ۳۳)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند ⇒ **گام ۱ پرامپت (هارنس واقعی §۲۳ روی
`@prisma/client`) طبق شرط خودش اجرا نشد** و Smoke Test ویندوز دست‌نخورده ماند. کل گام ۲ تمام شد.

## ✅ این نشست تکمیل شد
* **بخش ۱۲ `src/shared/creditUi.ts` — «فهرست اعتبار روی صفحه»:** `CREDIT_LIST_SCREEN_COLUMNS` /
  `CREDIT_LIST_SCREEN_HEADERS` / `creditListScreenRow` / `creditListScreenTotals` /
  `creditListTotalsLabel` / `creditListCellFormat` (+ `CREDIT_LIST_MONEY_COLUMNS` و
  `CREDIT_LIST_COUNT_COLUMNS`) / `creditBreakdownCellFormat` / `CREDIT_VIEW_TABS`.
  مصرف: `CreditManagement.tsx` (`:296-300` تب‌ها، `:560-566` فهرست، `:470` تفکیک) و
  `SalesReports.tsx` (`:2345-2352` سرستون و سلول، `:2375-2381` ردیف جمع).
  چهارده `<td>` دست‌نویسِ هر دو جدول، عددِ ۱۴ (سه نقطه) و `VIEW_TITLES` حذف شدند.
* **بخش ۱۳ `src/shared/creditUi.ts` — «هر نما از کدام کانال، با چه بار داده‌ای»:**
  `CREDIT_VIEW_CHANNELS` · `creditViewRequest` · `creditReportRequests` · `creditTake`/`CREDIT_LIST_TAKE`
  · `CREDIT_LIST_ONLY_FILTERS` · `CREDIT_LIST_ONLY_HINT`. مصرف: `CreditManagement.tsx` `load()`
  (پنج بلوک `if` رفت) و `SalesReports.tsx` `load()` تب اعتبار.
  **باگ واقعیِ بسته‌شده:** `onlyWithRemaining` فقط روی `creditList` اثر دارد ولی به `creditDashboard`
  هم فرستاده می‌شد ⇒ تیک زده می‌شد، جدول کم می‌شد، کارت‌ها نه. حالا فرستاده نمی‌شود و محدودیتش
  کنار تیک نوشته شده است.
* **بخش ۹.۲ `src/shared/credit.ts`:** `CREDIT_REPRINT_AFTER` · `isCreditReprint` · `creditPrintAction`
  · `creditReprintCount`. پنج آستانه‌ی دستیِ «نسخه‌ی مجدد» (در `creditCopyPlan`، `PrintService:495`،
  `markPrinted`، و دو نقطه‌ی `markPrintedMany`) به یک تصمیم تبدیل شدند؛ عمل AuditLog با
  `AuditAction[creditPrintAction(prev)]` نوشته می‌شود.
* **بندهای ۱۰، ۱۵، ۱۶، ۲۵، ۲۸ هارنس `acceptance-session25.mjs` از STRUCTURAL به REAL رفتند**
  (جدول دقیقش در CHANGELOG) و بندهای ۱ و ۳ حالا کانال‌ها را از جدول‌های لایه‌ی مشترک هم می‌خوانند،
  چون JSX دیگر همه‌ی کانال‌ها را تایپ نمی‌کند.
* **سوییت تازه:** `test/credit-ui-logic-session33.ts` ⇒ **۳۹ PASS · ۰ FAIL**؛ شامل قراردادِ تازه‌ای که
  هیچ نشستی نداشت: **هر نام ستونی که لایه‌ی مشترک به Prisma می‌دهد با `prisma/schema.prisma` واقعی
  سنجیده می‌شود** (§۱۶ جست‌وجوی دومرحله‌ای، §۲/§۱۵ وضعیت مؤثر، §۱۲ snapshot گیرنده، §۱۰ SQL محافظت لاگ)
  و بند ۳۱: هیچ عملِ `CREDIT_*`/`STORE_CREDIT_*`ِ `enums.ts` از `isProtectedAuditRow` جا نمی‌ماند.
* **جمع دوازده سوییت: ۴۲۷ PASS · ۰ FAIL.** هر ۴۷ فایل `.tsx` نحواً سالم.

## ❌ باقی‌مانده — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — **هیچ.** (بک‌اند در ۳۱، UI در ۳۲، سخت‌سازی و قرارداد اسکیمای Prisma در ۳۳.)
### اولویت ۲ — §۲۳: هارنس واقعی روی `@prisma/client` (دو صندوق همزمان، Idempotency تکراری، دستکاری
مبلغ/تاریخ/دفعات، لینک تعویض، کامل بودن AuditLog، Rollback). **فقط با npm.** یازده نشست است منتظر است.
### اولویت ۳ — Smoke Test دستیِ ویندوز (`SMOKE-TEST-اولویت۴.md`): کار کاربر است، نه نشست.
### اولویت ۴ — بندهای هارنس ۲۵ که هنوز STRUCTURAL‌اند و **بدون Prisma/Electron قابل REAL شدن نیستند**:
۶ (route/nav)، ۷ تا ۹، ۱۱ تا ۱۴، ۱۷ (منطقشان داخل `PrintService`/`StoreCreditService` است و هر دو به
`electron`/`@prisma/client` وابسته‌اند)، و ۱۸ تا ۲۴، ۲۶ (گزاره روی JSX؛ اجرایشان React لازم دارد).
اگر نشستی خواست این‌ها را هم REAL کند، راهش **بیرون کشیدن همان تصمیم به لایه‌ی مشترک** است، نه تغییر هارنس.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **ردیفِ روی صفحه‌ی فهرست اعتبار همیشه `creditListScreenRow` است** و قالب هر سلول
  `creditListCellFormat`؛ هیچ `<td>{money(r.x)}</td>` و هیچ عددِ ستون در JSX.
* **کانال و بار داده‌ی هر نما فقط از `creditViewRequest`/`creditReportRequests`** می‌آید؛ `take` یک
  عدد مشترک (`CREDIT_LIST_TAKE`) است و بازه‌ی خالی هیچ کلیدی نمی‌سازد.
* **`onlyWithRemaining` فیلترِ فهرست است، نه داشبورد** (`CREDIT_LIST_ONLY_FILTERS`)؛ هر فیلتر تازه‌ای
  که سرویس فقط در یک مسیر اعمال می‌کند باید به همین فهرست اضافه شود.
* **آستانه‌ی «نسخه‌ی مجدد» فقط `isCreditReprint`/`creditPrintAction`** است (بخش ۹.۲)؛ هیچ `>= 1` دستی.
* **هر نام ستونی که به Prisma می‌رود باید در سوییت با `schema.prisma` سنجیده شود** — این ارزان‌ترین
  جایگزینِ اجرای واقعی در محیط بدون npm است.

## کار باز بی‌ربط به اعتبار: هیچ.

# جلسه ۳۴ — بخش ۹.۳ و ۹.۴ `credit.ts` · بخش ۱۴ `creditUi.ts` · **دوازده بند هارنس REAL شد**

شرح کامل در `CHANGELOG-جلسه۳۴.md`.

## ⛔ محیط — دوازدهمین نشست پیاپی بدون npm (۲۳ تا ۳۴)
`node v22.23.1` هست؛ `npm`/`npx`/`tsc`/`electron` نیستند ⇒ **گام ۱ پرامپت (هارنس واقعی §۲۳ روی
`@prisma/client`) طبق شرط خودش اجرا نشد** و Smoke Test ویندوز دست‌نخورده ماند (کار کاربر است).

## ✅ این نشست تکمیل شد
* **بخش ۹.۳ `src/shared/credit.ts` — «یک کاغذ بیرون آمد» چه چیزی می‌نویسد:**
  `creditShouldMarkPrinted` · `CREDIT_MARK_PRINTED_NONE` · `creditPrintAudit` · `creditPrintNote` ·
  `creditBatchPrintAudit` · `creditPdfAuditOnly` · `creditPdfSaveOutcome` · `creditPdfMarkPlan` ·
  `creditPdfRenderPlan` · `creditPrintBatchResult` · `CREDIT_PRINT_CHANNELS`/`_TITLES`/`_LABELS` ·
  `creditPrintChannel` · `CREDIT_PRINT_ENTITIES`/`creditPrintAuditEntity` · `CREDIT_REPRINT_LABEL`.
  مصرف: `StoreCreditService.markPrinted`/`markPrintedMany` و `PrintService.printCredit`/
  `printCreditBatch`/`creditPdf`.
* **بخش ۹.۴ `src/shared/credit.ts` — نام‌هایی که به Prisma می‌رود:** `CREDIT_ORDER_BY` (+`_MODELS`) ·
  `CREDIT_PRINT_SELECT` · `CREDIT_PRINT_WRITE_FIELDS` · `creditPrintSetData`/`creditPrintIncrementData` ·
  `creditIdsWhere` · فهرست کلیدهای `data`ِ `StoreCreditRedemption`/`StoreCreditBatch`/`CreditReminderLog` ·
  `CREDIT_PRISMA_MODELS`. **هیچ `orderBy: {`ِ دستی در `StoreCreditService` نمانده.**
* **بخش ۱۴ `src/shared/creditUi.ts`:** `creditCellText`/`CREDIT_EMPTY_CELL` ·
  `CREDIT_SELECTION_RESET_KEYS`/`creditSelectionResetSignature` · `creditAllSelected`/`creditToggleAll`/
  `creditToggleRow` · `CREDIT_PRINT_OP_CHANNELS`/`creditPrintOpRequest` · `creditPrintFlash` ·
  `creditDetailPrintBadges` · `creditRangeExportDisabled`.
  مصرف: `CreditManagement.tsx` (چاپ/PDF، انتخاب، سلول، کارت‌ها)، `CreditDetailView.tsx` (نشان‌ها)،
  `SalesReports.tsx` (سلول، دکمه‌های خروجی).
* **دو باگ/واگرایی واقعی که بسته شد:** (۱) دو کپیِ جداگانه‌ی «چاپِ سلول» در دو فایل UI؛
  (۲) فهرستِ دستیِ فیلترهایی که انتخاب را پاک می‌کنند — هر فیلتر تازه‌ای که به آن اضافه نمی‌شد، یعنی
  چاپ کاغذِ ردیف‌های قبلی با شمارنده و AuditLog واقعی.
* **دوازده بند هارنس ۲۵ از STRUCTURAL به REAL:** ۴، ۷، ۸، ۹، ۱۱، ۱۲، ۱۳، ۱۴، ۱۷، ۱۸، ۲۰، ۲۱، ۲۲، ۲۳
  (جدول دقیقش در CHANGELOG). **هارنس برای پاس شدن تغییر نکرد**؛ تصمیم‌ها به لایه‌ی مشترک منتقل شدند.
* **سوییت تازه:** `test/credit-ui-logic-session34.ts` ⇒ **۴۲ PASS · ۰ FAIL**.
  **جمع سیزده سوییت: ۴۶۹ PASS · ۰ FAIL.** هر ۴۷ فایل `.tsx` نحواً سالم.

## ❌ باقی‌مانده — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — **هیچ.** (بک‌اند ۳۱، UI ۳۲، سخت‌سازی ۳۳ و ۳۴.)
### اولویت ۲ — §۲۳: هارنس واقعی روی `@prisma/client` (دو صندوق همزمان روی یک اعتبار، Idempotency
تکراری، دستکاری مبلغ/تاریخ/دفعات، لینک تعویض، کامل بودن AuditLog، Rollback). **فقط با npm.**
دوازده نشست است منتظر است.
### اولویت ۳ — Smoke Test دستیِ ویندوز (`SMOKE-TEST-اولویت۴.md`): کار کاربر است، نه نشست.
### اولویت ۴ — بندهای هارنس ۲۵ که هنوز STRUCTURAL‌اند و **بدون Electron/React قابل REAL شدن نیستند**:
**۶** (route و آیتم ناوبری — نیاز به React Router)، **۱۹** (`iframe srcDoc` پیش‌نمایش)،
**۲۴** (گیت `ManagerGate` و «تا قفل باز نشود هیچ درخواستی»)، **۲۶** (تب legacy `storeCredits`).
هر چهار، گزاره روی *ساختار JSX*اند نه روی یک تصمیم؛ اگر نشستی خواست، راهش رندر واقعی React است
(یعنی npm)، نه بیرون کشیدن تصمیم — چون تصمیمی باقی نمانده.
### اولویت ۵ — کمّی‌کردن ریسک کارایی جلسه ۲۶ روی داده‌ی بزرگ (زمانِ `creditDashboard` روی ~۵۰٫۰۰۰
اعتبار). بدون Prisma قابل اندازه‌گیری نیست؛ تحلیل ایندکس‌ها در CHANGELOG جلسه ۳۴ نوشته شد.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **شکلِ ردیف AuditLogِ چاپ فقط از بخش ۹.۳ می‌آید** (`creditPrintAudit`/`creditBatchPrintAudit`/
  `creditPdfAuditOnly`)؛ هیچ `entity: 'StoreCredit'`ِ دستی در مسیر چاپ.
* **«شمارنده‌ی چاپ پیش‌فرض روشن است» یک قاعده است** (`creditShouldMarkPrinted`)، نه یک `!== false`.
* **لغوِ پنجره‌ی ذخیره = `creditPdfSaveOutcome`** و مسیر شمارش = `creditPdfMarkPlan`؛ ترتیب همیشه
  «لغو ⇒ بازگشت، بعد نوشتن فایل، بعد شمارش».
* **هر `orderBy`/`select`/کلیدِ `data` که به Prisma می‌رود در بخش ۹.۴ نوشته و با `schema.prisma`
  سنجیده می‌شود** — ارزان‌ترین جایگزینِ اجرای واقعی در محیط بدون npm.
* **چاپِ سلول فقط `creditCellText`** (با تزریق `money`/`faDigits`)؛ هیچ کپیِ محلی در JSX.
* **هر فیلتر تازه‌ی فهرست باید در `CREDIT_SELECTION_RESET_KEYS` باشد**، وگرنه انتخابِ کهنه می‌ماند.
* **بار داده‌ی چاپ/PDF فقط `creditPrintOpRequest`** و متن نتیجه فقط `creditPrintFlash`.

## کار باز بی‌ربط به اعتبار: هیچ.

# جلسه ۳۵ — اولویت ۲ (§۲۳: هارنس واقعی) **بسته شد**؛ سه باگ واقعی رفع شد

## ⛔ محیط — سیزدهمین نشست بدون npm، ولی این بار مانع نبود
`npm` نیست و نصب هیچ پکیجی ممکن نیست. راه‌حل: `node:sqlite` (داخل Node 22) + اجرای
**همان migration های واقعی پروژه**. پس §۲۳ بدون `@prisma/client` و بدون Electron اجرا شد.
اجرا: `node --import ./test/harness/register.mjs test/acceptance-db-session35.mjs`

## ✅ این نشست تکمیل شد
۱. `test/harness/` — دیتابیس واقعی از migration ها، مترجم Prisma→SQL (fail-loud)، seeder،
   قلاب resolve، و stub های `@prisma/client`/`electron`/`jalaali-js`(الگوریتم واقعی).
۲. `test/acceptance-db-session35.mjs` — هر ۱۴ بند §۲۳ + داشبورد/یادآوری/چاپ/حذف ⇒ ۲۰۲ PASS · ۰ FAIL.
۳. سه باگ واقعی رفع شد (جزئیات در `CHANGELOG-جلسه۳۵.md`):
   `CANCELED⇒CANCELED` (ابطال دوباره)، «سقف ۱ بار ⇒ ۱۰۰۰ بار» در `changeCreditUses`،
   و پیام غلط‌اندازِ «کامل مصرف شده» وقتی فقط دفعات تمام شده.
۴. جمع تست پروژه: **۶۷۱ PASS · ۰ FAIL** (۴۶۹ قبلی دست‌نخورده).

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **تست واقعی دیتابیس از این به بعد از `test/harness/` می‌آید**، نه از انتظار برای npm.
  هر رفتار تازه‌ی سرویس باید یک گزاره در `acceptance-db-session35.mjs` (یا جانشین نشست بعد) بگیرد.
* **مترجم هارنس باید fail-loud بماند.** هر `where`/`select`/عملگر پشتیبانی‌نشده `throw` می‌کند؛
  هیچ‌وقت آن را «مدارا‌کننده» نکن، وگرنه تست سبزِ دروغ می‌دهد.
* **stub ها نباید منطق جعلی داشته باشند** (به همین دلیل `jalaali-js` با الگوریتم واقعی پیاده شد).
* `CANCELED` وضعیت پایانی است — حتی «به خودش» Transition ندارد (`TERMINAL_CREDIT_STATUSES`).
* در *تغییر مدیریتی*، ورودی متناقض رد می‌شود؛ هیچ‌وقت به «سخاوتمندانه‌ترین تفسیر» تبدیل نمی‌شود.

## ❌ باقی‌مانده — نشست بعد دقیقاً از همین‌جا شروع کند
### اولویت ۱ — گسترش هارنس به مسیرهای همسایه
`SalesService` (ثبت فاکتور با پرداخت ترکیبی اعتبار، `createReturn`، `purge`) و `PrintService`
(`creditDocData`, PDF چندصفحه‌ای) هنوز زیر هارنس نرفته‌اند. همان الگو کار می‌کند؛ فقط stub های
لازم (مثل `electron.dialog`/فایل‌سیستم) باید اضافه شود. این بزرگ‌ترین شکافِ باقی‌مانده‌ی تست است.
### اولویت ۲ — کمّی‌کردن کارایی روی داده‌ی بزرگ
۱۲۰۰ رکورد سنجیده شد. تست ~۵۰٫۰۰۰ رکورد با همین هارنس **حالا ممکن است** (بدون npm) و جای
اندازه‌گیری `creditDashboard`/`creditList` است.
### اولویت ۳ — Smoke Test دستی ویندوز (`SMOKE-TEST-اولویت۴.md`): کار کاربر است، نه نشست.
### اولویت ۴ — چهار بند هارنس ۲۵ که به رندر واقعی React نیاز دارند (۶، ۱۹، ۲۴، ۲۶).
با `node:sqlite` حل نمی‌شوند؛ نیاز به react/react-dom دارند که بدون npm در دسترس نیست.

## کار باز بی‌ربط به اعتبار: هیچ.

---

# جلسه ۳۶ — کار الف (مقصد پول) **ناتمام ماند**؛ کار ب شروع نشد

## ⛔ وضعیت واقعی (بدون تعارف)
سقف نشست وسط کار الف رسید. شرح کامل در `CHANGELOG-جلسه۳۶.md`.
* لایه‌ی داده (`schema.prisma` + migration + manual)، لایه‌ی مالی (`accounting.ts`,
  `reportShape.ts`, `accountingReport.ts`) و سرویس پرداخت (`SalesService`: `addPayment`,
  `updatePayment`, `setChequeStatus`, `deletePayment`, `shapePaymentRow`) **انجام شد**.
* **مصرف‌کننده‌ها به‌روز نشدند**، پس درخت کد در وضعیت فعلی **typecheck نمی‌شود**:
  `CashboxService`, `ShiftService.info`, `SalesService.reportRows/summary` و کل UI.
* **هیچ تستی نوشته و اجرا نشد.** هارنس جلسه ۳۵ *قبل* از تغییرات اجرا و تأیید شد
  (۲۰۲ PASS · ۰ FAIL)، *بعد* از تغییرات نه.
* `npm` نبود (چهاردهمین نشست): `npm install` / `prisma generate` / `tsc --noEmit` اجرا نشد.
* **کار ب دست‌نخورده است** — هیچ فایلی از مسیر برگشت/تعویض/کارت‌به‌کارت/انبارگردانی عوض نشده،
  پس ناسازگاری نصفه‌کاره‌ای در کار ب وجود ندارد.
* «فاکتور فروش عمده و انتخاب انبار» طبق پرامپت دست‌نخورده ماند.

## نشست بعد دقیقاً از اینجا شروع کند
### اولویت ۱ — بستن کار الف
فهرست هفت‌بندی و شماره‌خطیِ «❌ باقی‌ماندهٔ کار الف» در `CHANGELOG-جلسه۳۶.md` را به همان ترتیب
اجرا کن (۱ سرویس گزارش، ۲ `CashboxService` شامل رفع `shiftPaymentsOf`، ۳ `ShiftService.info`،
۴ امضای IPC، ۵ UI، ۶ سوییت `test/acceptance-db-session36.mjs`، ۷ رگرسیون هارنس).
### اولویت ۲ — کار ب (برگشت/تعویض با پرداخت مدیر)
از صفر، طبق پرامپت جلسه ۳۶. **قبل از شروع، کار الف باید سبز و تست‌شده باشد.**
### اولویت ۳ — Smoke Test دستی ویندوز (`SMOKE-TEST-اولویت۴.md`): کار کاربر است، نه نشست.

## قطعی‌های تازه (دوباره تصمیم نگیر)
* **`Payment.destination` تنها منبع حقیقتِ سبدبندی دریافتی‌هاست**؛ `methodId` فقط «ابزار پرداخت».
  سبدبندی **فقط** از `receiptBucketOf()` در `src/shared/accounting.ts` می‌گذرد — هیچ `switch`
  دستیِ تازه‌ای روی `method.kind` ننویس.
* مقصد **اجباری و بدون پیش‌فرض** است و با `kind` روش پرداخت سازگار می‌شود
  (`allowedDestinationsFor`). ردیف متناقض ساخته نمی‌شود.
* چکِ «در جریان» مقصد ندارد (`null`)؛ مقصد لحظه‌ی `CLEARED` گرفته می‌شود و با برگشت از «پاس شد»
  **پاک** می‌گردد. حذف پرداختی هم مقصد را با خودش می‌برد.
* `destination = null` = «نامشخص». **هیچ حدسی زده نمی‌شود** و migration هیچ `UPDATE`ی ندارد.
  برای دست‌نخوردن جمع‌های قبلی، سهم «نامشخص» از ورودیِ جداگانه‌ی `clearedUnknownChequeAmount`
  به `expectedCash` می‌رود تا با برچسب خودش نمایش داده شود، نه لای نقد.
* «دریافتی به حساب مدیر» **هرگز** در `expectedCash`، `netCashMovement`، `realCash`،
  `currentPeriod`، `priorPeriod` و `receivedTotal` نمی‌آید — ولی **باید** ردیف پل تطبیق
  (`managerAccountReceived`) داشته باشد، وگرنه پل به اندازه‌ی همان مبلغ باز می‌ماند.
* «سایر» دیگر بی‌صدا در کارت جمع نمی‌شود؛ ردیف و برچسب خودش را دارد.

## دو باگِ ثبت‌شده و **حل‌نشده** (خارج از کار الف)
۱. `priorPeriod` در همه‌ی مسیرهای واقعی صفر است (`saleWhere` با `issuedAt ≥ from` در تناقض با
   کوئری `issuedAt < from`؛ و با `shiftId` هم همیشه صفر). یعنی «وصول نسیه‌ی بازه‌های قبل»
   هیچ‌وقت در بستن صندوق دیده نمی‌شود و پرداختیِ امروز روی فاکتور ماه قبل در انتظار صندوقِ
   امروز نمی‌آید. تنها جایی که دیده می‌شود پنل خواندنیِ `shiftPaymentsOf` است.
۲. `clearedCashChequeAmount` (همه‌ی چک‌های پاس‌شده‌ی بازه) و `priorCashSettlements` (که چکِ
   پاس‌شده‌ی فاکتورهای قبل را هم می‌شمرد) روی هم می‌افتادند؛ با تفکیک `priorPeriodCash/Card/Other`
   این هم‌پوشانی در کد این نشست برداشته شد، ولی چون بند ۱ صفرش می‌کند در عمل آزمایش‌نشده است.


---

# جلسه ۵۴ — «ساخت کالای جدید در فروشگاه هنگام انتقال از انبار مرکزی»

> جزئیات کامل: `CHANGELOG-جلسه۵۴.md`. سوییت این جلسه:
> `node --import ./test/harness/register.mjs test/acceptance-db-session54.mjs` ⇒ **۷۰ PASS · ۰ FAIL**.

**چه اضافه شد.** تا جلسه ۵۳، «انتقال به انبار فروشگاه» فقط به یک کالای *موجود* موجودی
اضافه می‌کرد (`variantId` اجباری). حالا اگر ردیف انبار مرکزی هیچ کالای متناظری نداشته
باشد، پنجره‌ی انتقال یک سؤال روشن می‌پرسد («پیدا نشد؛ به‌عنوان کالای جدید ثبت شود؟» با
بله/خیر) و با «بله» یک فرم باز می‌شود که کالا (یا فقط یک **واریانت تازه** برای کالای
موجود) را می‌سازد و **در همان تراکنش** انتقال را هم انجام می‌دهد. ساخت خودکار و بی‌صدا
هیچ‌جا وجود ندارد و قیمت فروش اجباری است.

**معماری — دو قاعده‌ای که باید نگه داشته شوند.**
1. بدنه‌ی انتقال یک تابع ماژولی است: `toStoreWithin(tx, input)` در
   `SecondaryStockService.ts`. `toStore` (مسیر کالای موجود) و `toStoreNewVariant`
   (مسیر کالای جدید) **هر دو** همان را صدا می‌زنند. هر تغییری در منطق انتقال باید
   فقط در همین تابع باشد، وگرنه دو مسیر واگرا می‌شوند.
2. ساخت کالا/واریانت با کلاینت تراکنشِ صدازننده در `ProductService.createVariantInTx`
   است (از همان `nextCode`/`nextBarcode`). `productService.upsert` خودش
   `prisma.$transaction` باز می‌کند، پس **هیچ‌وقت** از داخل یک تراکنش صدایش نزنید؛
   تراکنش تودرتو روی SQLite همان بن‌بست همیشگی است.

**قفل.** کانال تازه `secondaryStock:toStoreNew` سمت سرور **دو** کلید موجود را با
`assertPanelPassword` و **بیرون از `$transaction`** می‌سنجد: `secondaryToStore` و
`products`. کلید تازه‌ای ساخته نشده. چون `assertPanelPassword` هر بار یک کلید را
می‌سنجد، همان تابع دو بار صدا زده می‌شود؛ و اگر `productsPassword` خالی باشد همان
`toStorePassword` برای کلید دوم هم امتحان می‌شود (رمز مدیر هر پنلی را باز می‌کند). پس
یک فیلد رمز برای مدیر کافی است و فیلد دوم فقط برای «رمز دوم اختصاصی پنل کالاها» لازم
است. مسیر «انتقال به کالای موجود» عیناً مثل قبل است و رمز سمت سرور نمی‌خواهد.

**⚠️ اجرا نشده.** `typecheck`/`tsc`، `db:generate`، `build` و هیچ اجرای UI/Electron
انجام نشده است (قاعده‌ی صرفه‌جویی جلسه). اول `npm run typecheck` را بزنید. پذیرش «رمز
مدیر درستِ واقعی» هم فقط دستی قابل تست است. migration لازم نشد.

**دو FAIL از قبل موجود** (روی زیپ دست‌نخورده هم هستند، کار این جلسه نیستند):
`acceptance-db-session47.mjs` (۹۶/۱ — گیت سمت سرور جلسه ۵۲ انتظار قدیمی سوییت را کهنه
کرده) و `stock-source-display-session53.mjs` (۵۹/۱ — «بلوک استایل inline»).


---

# جلسه ۵۵ — چهار کار کوچک و جدا

جزئیات کامل در `CHANGELOG-جلسه۵۵.md`.

1. **قفل مستقل «ساخت کالای جدید هنگام انتقال»** — کلید تازه
   `PANEL_KEYS.secondaryToStoreNewProduct` (`'secondary-to-store-new-product'`) **جای**
   `PANEL_KEYS.products` را در مسیر `toStoreNewVariant` گرفت (سرور + مودال). قفل
   `secondaryToStore` سر جایش است. فیلد ورودی `productsPassword` شد
   `newProductPassword`. درسِ ماندنی و مهم: **قفل یک ماژول دیگر را برای کارِ حساسِ
   داخل ماژول خودت قرض نگیر** — همین نکته در چک‌لیست README هم نوشته شد.
2. **باگ فرم کالای جدید** — تعداد بیشتر از موجودی ردیف مبدأ حالا در خود فرم با پیام
   روشن رد می‌شود (بی `force`، ساده‌ترین حالت).
3. **تست جلسه ۵۳** — الگوی backslash در assertion «بلوک استایل inline» درست شد. کد
   `templates.ts` دست نخورد.
4. **تست جلسه ۴۷** — انتظار گیت فروش تکی با پیام جلسه ۵۲ («تأیید مدیر لازم دارد»)
   هماهنگ شد. کد دست نخورد.

## ⚠️ وضعیت تست در پایان این جلسه

**هیچ سوییتی اجرا نشد و هیچ typecheck ای گرفته نشد** (قواعد صرفه‌جویی این نشست:
نصب/اجرا ممنوع بود). اولین کار جلسه‌ی بعد:

```
npm run typecheck
node test/acceptance-db-session54.mjs
node test/stock-source-display-session53.mjs
node test/acceptance-db-session47.mjs
```

اگر `acceptance-db-session54` روی بند ۸ سبز شد، کار ۱ واقعاً تمام است. نکته‌ی احتمالی
شکستن: بند ۸ رمز دوم را با `authService.setPanelPassword` و رمز پیش‌فرض مدیر
(`DEFAULT_MANAGER_PASSWORD` = `1111`) می‌سازد؛ اگر هارنس روزی رمز مدیر را از قبل
بنشاند، آن بند باید با همان رمز هماهنگ شود.
