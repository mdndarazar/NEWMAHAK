# جلسه ۱۰ — وضعیت واقعی کار (ناتمام، ادامه دارد)

> ⚠️ صادقانه: در این نشست **لایه‌ی داده و بک‌اند** موارد ۱(زمان‌بندی)، ۲، ۴ و ۷ کامل شد،
> ولی **UI (renderer)** هیچ‌کدام هنوز ساخته نشده. موارد ۳ (ریسایز همه‌ی جدول‌ها)،
> ۵ (هشدار زرد) و ۶ (پرداختی‌های نسیه در جزئیات شیفت) اصلاً شروع نشده‌اند.
> با npm هم build/typecheck نشده (محیط بدون Node بود).

## انجام‌شده

### داده و مدل
- `prisma/schema.prisma` → `PriceChangeBatch`: `state`, `startAt/startAtJalali/startAtTime`,
  `endAt/endAtJalali/endAtTime`, `autoStartedAt`, `autoEndedAt`, `variantIdsJson`,
  `editedAt/editedAtJalali`, `editCount` + ایندکس روی `state/startAt/endAt`. همه اختیاری،
  پس رفتار قبلی دست‌نخورده است.
- مهاجرت: `prisma/migrations/20270901000000_price_schedule_and_history_edit/migration.sql`
  (+ کپی در `prisma/manual/`). رکوردهای قدیمی خودکار `APPLIED`/`REVERTED` می‌شوند.

### مورد ۱ (زمان‌بندی) و مورد ۲ — `src/main/services/PriceAdjustService.ts`
- `apply()` با تاریخ شروع آینده ⇒ دسته‌ی `SCHEDULED` می‌سازد و **هیچ قیمتی را دست نمی‌زند**
  (قیمت قبلی سر لحظه‌ی واقعی شروع خوانده می‌شود، نه حالا).
- زمان‌بند خودش‌تنظیم (`schedulePriceAdjust()` در `src/main/index.ts`): سقف فاصله ۳۰ ثانیه،
  یک بار هم در لحظه‌ی باز شدن برنامه ⇒ قرارهای از‌دست‌رفته (حتی چند روز) فوراً تسویه می‌شوند.
- شروع/پایان خودکار در همان «سابقه‌ی تغییر قیمت» با برچسب ثبت می‌شوند
  (`PRICE_SCHEDULE_START` / `PRICE_SCHEDULE_END`).
- `editBatch()` — **فقط دامنه** را کم/زیاد می‌کند: خارج‌شده‌ها به قیمت قبل از همان دسته
  برمی‌گردند، داخل‌مانده‌ها دست‌نخورده (دوباره تخفیف نمی‌خورند). عوض کردن فرمول عمداً
  ممنوع است (باید بازگردانی + دسته‌ی جدید، تا سابقه سند بماند).
- `deleteBatches()` — تکی/گروهی، با پارامتر «قیمت‌ها هم برگردد یا نه» (همان سؤالی که خواستی).
- `activeDiscounts()` — فقط‌خواندنی، برای نمایش تخفیف در پنل فروش (مورد ۱-ب). عمداً
  `DECREASE` را تخفیف حساب نمی‌کند (همان فرق «تخفیف» و «کاهش قیمت»).

### مورد ۴ — `src/main/services/PanelVault.ts` (جدید)
تصمیم: هش scrypt **می‌ماند** (تایید ورود همیشه با آن)، و **علاوه بر آن** یک نسخه‌ی
AES-256-GCM بازگشت‌پذیر ذخیره می‌شود. کلید از یک بذر ۳۲ بایتی در فایل
`panel-vault.key` داخل `userData` مشتق می‌شود — **بیرون از `shop.db`**. نتیجه: هر کس فقط
فایل دیتابیس/بکاپ را بردارد رمزها را نمی‌بیند، ولی روی همین دستگاه تنظیمات می‌تواند رمز را
به تو نشان بدهد. رمز اصلی مدیر عمداً وارد این مسیر نشده و هش‌تنها مانده.
رمزهای ثبت‌شده‌ی *قبل* از این نسخه فقط هش دارند ⇒ `recoverable: false`؛ یک بار ثبت دوباره کافی است.

### مورد ۷ — `src/main/services/AuthService.ts`
- ذخیره‌سازی: **همان کلید `SETTING_KEYS.panelAuth`**، رمز سوم به‌صورت زیرشاخه‌ی همان پنل:
  `{ "<پنل>": { salt, hash, enc, enabled, changedAt, shifts: { "1": {salt,hash,enc,enabled,changedAt} } } }`
  (کلید = شماره‌ی شیفت ۱-based، همان ترتیب تنظیمات شیفت). نبودِ کلید = «تعریف‌نشده» (پیش‌فرض).
- اولویت، در `verifyPanel` و به همین ترتیب: **رمز مدیر → رمز دوم (همه‌ی شیفت‌ها) → رمز سوم شیفت جاری**.
  رمز سوم شیفت دیگر عمداً رد می‌شود. قفل موقت (AuthLockout) مشترک است تا حدس‌زدن بی‌نهایت ممکن نشود.
- «شیفت جاری» = شماره‌ی شیفتِ بازِ دیتابیس، وگرنه `findShiftSlot` طبق ساعت، وگرنه هیچ
  (هیچ = رفتار قبلی؛ نبودِ شیفت هیچ‌وقت قفل را باز نمی‌کند).
- متدهای جدید: `setPanelShiftPassword`, `revealPanelPassword`. `panelInfo()` حالا
  `recoverable` و فهرست کامل `shifts` را می‌دهد.
- قفل پنل‌ها (روشن/خاموش) **دست نخورده** و همان پیش‌فرض امن.

### اتصال‌ها
`src/shared/ipc.ts` + `src/main/ipc/index.ts`: `priceAdjust:batch:edit`,
`priceAdjust:batches:delete`, `priceAdjust:activeDiscounts`, `priceAdjust:schedule:run`,
`manager:panel:shift:setPassword`, `manager:panel:reveal`.
`src/shared/enums.ts`: ۶ `AuditAction` جدید. `src/shared/types.ts`: تایپ‌های جدید.

## باقی‌مانده برای نشست بعد
1. **مورد ۱-ب** نمایش تخفیف در پنل فروش (داده‌اش با `priceAdjust:activeDiscounts` آماده است).
2. **مورد ۱-ج/۲ UI** — فیلد تاریخ/ساعت شروع و پایان + ستون وضعیت + دکمه‌ی ویرایش + حذف چندتایی در `PriceAdjust.tsx`.
3. **مورد ۳** — ریسایز ستون در ۴۰+ جدول باقی‌مانده (با همان `useResizableColumns`/`ColGroup`/`ResizableHeaderCells`).
4. **مورد ۵** — هشدار زرد «اول رمز مدیر را وارد کنید» در `Settings.tsx`.
5. **مورد ۶** — `CashboxService.shiftDetail` + بخش جدید در `ShiftDetailModal.tsx` (تایپ‌هایش آماده و اختیاری‌اند).
6. **مورد ۷ UI** — آکاردئون «+/−» زیر هر ردیف پنل (بسته به‌صورت پیش‌فرض) + نمایش رمز با آیکون چشم.
7. `npm install && npm run typecheck` — کد این نشست کامپایل‌نشده است.
