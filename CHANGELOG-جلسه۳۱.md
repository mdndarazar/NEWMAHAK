# جلسه ۳۱ — بند ۷ و نیمه‌ی §۱۰ از بند ۸ تمام شد ⇒ **کل «اولویت ۱» بسته شد**

## محیط (گام ۰)
`node v22.23.1` هست، **`npm` نیست** (نهمین نشست پیاپی: ۲۳ تا ۳۱) ⇒ گام ۲ پرامپت
(هارنس واقعی §۲۳ روی `@prisma/client`) طبق شرط خودش اجرا نشد. سقف نشست وسط گام ۳ رسید.

## بند ۷ (§۱۳) — `copies > 1` و لوگوی سند
* **هر کاغذ دوباره رندر می‌شود.** `PrintService.printCredit` از `creditCopyPlan(data.printCount - 1, input.copies)`
  رد می‌شود، برای هر نسخه `creditDocHtml({ ...data, printCount: copy.printCount, reprint: copy.reprint })`
  می‌سازد و **بعدِ هر کاغذ** `markPrinted` می‌زند. پس چاپ سه‌نسخه‌ای دیگر سه «اصل» بیرون نمی‌دهد و
  `printCount`/AuditLog تعداد واقعی کاغذها را می‌دانند. `copies` برگشتی = `plan.length` (سقف ۵ از همان تابع).
* **لوگو:** سه فیلد تازه در `ReceiptTemplate` (`showLogo`/`logoHeightMm`/`logoDataUrl`، پیش‌فرض خاموش) ·
  `SettingsService.receiptTemplate()` با `receiptLogoInherit` از لوگوی **لیبل** ارث می‌برد و `saveBundle`
  با قرینه‌اش (`receiptLogoForSave`) همان مقدار ارث‌بری‌شده را ذخیره **نمی‌کند** (وگرنه کپیِ منجمد
  می‌نشست و عوض کردن لوگوی لیبل بی‌اثر می‌شد) · `creditDocBody` بالای نام فروشگاه با `creditDocLogo`
  رندر می‌کند (`.logo` در CSS سند) · تیک + ارتفاع در بلوک «فیلدهای رسید» تنظیمات.

## نیمه‌ی §۱۰ از بند ۸ — محافظت AuditLog در سبک‌سازی
* `MaintenanceService.archivePurge` ⇒ `DELETE FROM "AuditLog" WHERE "at" < ? AND ${auditPurgeableSql().sql}`.
* `preview` دو عدد می‌دهد: `auditLogs` (واقعاً پاک می‌شود) و `auditLogsProtected` (سابقه‌ی اعتبار، می‌ماند)
  — هر دو با همان شرطِ DELETE شمرده می‌شوند، پس عدد پیش‌نمایش با واقعیت یکی است.
* **رمز مدیر** برای پاک‌سازی بقیه‌ی لاگ لازم شد (`assertManagerPassword`) و **قبل از** باز شدن تراکنش
  صدا زده می‌شود (قاعده‌ی تک‌نویسنده‌ی SQLite). نبودن/غلط بودنش **فقط** همین مرحله را رد می‌کند:
  `auditPurged: false` + `warnings[]` در خروجی، بقیه‌ی سبک‌سازی طبق روال.
* قرارداد: `auditLogsProtected` در `MaintenancePreview` و `auditPurged`/`warnings` در `MaintenanceResult`.
* UI: فیلد رمز در بلوک سبک‌سازی (`Settings.tsx`)، ارسالش در `runArchivePurge`، نمایش عدد محافظت‌شده در
  پیش‌نمایش و در متن تایید، و نمایش هشدارها در کارت نتیجه. IPC هم از `withUser` رد می‌شود تا ردیف
  `DATA_ARCHIVE_PURGE` صاحب عمل را داشته باشد.

## تست
سوییت تازه‌ی `test/credit-ui-logic-session31.ts` ⇒ **35 PASS · 0 FAIL**؛ شامل یک بررسی روی
**SQLite واقعی** (`node:sqlite` در پروسه‌ی فرزند) که خروجی DELETE محافظت‌شده را با `isProtectedAuditRow`
مقایسه می‌کند، و ۱۷ گزاره‌ی ساختاری روی *مصرف* واقعی هر تصمیم.
جمع ده سوییت: **۳۴۸ PASS · ۱ FAIL** (همان FAIL شناخته‌شده‌ی بند ۲۸ که کار گام ۳ است).
