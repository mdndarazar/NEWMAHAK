# جلسه ۳۰ — بندهای ۳، ۴، ۶، نیمه‌ی دوم ۸ و بند ۹ از «اولویت ۱» انجام شد

## محیط (گام ۰)
`node v22.23.1` هست، **`npm` نیست** (هشتمین نشست پیاپی: ۲۳ تا ۳۰) ⇒ گام ۲ پرامپت
(هارنس واقعی §۲۳ روی `@prisma/client`) طبق شرط خودش اجرا نشد. سقف نشست وسط گام ۱ رسید.

## بخش ۹.۱ تازه در `src/shared/credit.ts` (ادامه‌ی بخش ۹ جلسه ۲۹)
`needsCodeSpaceCheck` · `codeGrowthOf` · `withAndClause` · `creditSearchWhere` +
`CREDIT_SEARCH_INVOICE_COLUMNS` · `holderSnapshot` + `HOLDER_AUDIT_FIELDS` +
`HOLDER_FIELD_LABELS` · `auditProtectedSql`/`auditPurgeableSql` +
`AUDIT_PROTECTED_ACTION_PREFIXES`.

## بخش ۱۰ تازه در `src/shared/creditUi.ts` (تصمیم نمایشی)
`creditListTotals` + `CREDIT_LIST_TOTAL_COLUMNS` · `creditDocLogo` ·
`CREDIT_RANGE_EXPORTS`/`CREDIT_RANGE_EXPORT_KINDS`/`CREDIT_DETAIL_EXPORT_KINDS`؛
و `creditExport('list')` حالا ردیف «جمع» می‌دهد (هر دو صفحه یک شکل).

## بندهای تکمیل‌شده
* **بند ۳ (§۶)** `issueStoreCredit` قبل از تولید کد `assertCodeSpace({ count: 1 })` می‌زند،
  طول رشدیافته را به `generateStoreCreditCode` می‌دهد و رشد را در note و `after` همان
  AuditLog صدور می‌نویسد. کدِ آماده‌ی مسیر گروهی پیش‌سنجش دوباره نمی‌گیرد.
* **بند ۴ (§۲/§۱۱/§۱۵)** داشبورد یک `groupBy` دومِ «تاریخ‌گذشته» می‌گیرد و با
  `rollExpiredBuckets` سطل‌ها را جابه‌جا می‌کند؛ فیلتر وضعیت با `creditStatusWhere` و
  داخل `AND` (`withAndClause`) می‌نشیند، پس `OR`ِ جست‌وجو خراب نمی‌شود.
* **بند ۶ (§۱۶)** `whereFromFilter` **async** شد: `creditSearchMatches` شماره فیش را از
  `SaleInvoice` و دفتر مصرف می‌گیرد و `creditSearchWhere` آن idها را به
  `sourceInvoiceId`/`exchangeInvoiceId`/`usedInvoiceId`/`id` می‌خورد.
* **نیمه‌ی دوم بند ۸ — بخش §۱۲** `before`/`after` تغییر گیرنده از `holderSnapshot`
  (۱۰ فیلد) می‌آید و note می‌گوید کدام فیلدها عوض شدند.
* **بند ۹ (§۳ و §۱۹)** هر دو صدازننده‌ی `SalesService` (`:1080` و `:2653`) از
  `exchangeCreditDays` رد می‌شوند؛ گارد تغییرناپذیری `source` در قالب مشترک
  `managerChange` نشست (پس هر عملیات مدیریتیِ آینده هم از همان در رد می‌شود).

## تست
سوییت تازه‌ی `test/credit-ui-logic-session30.ts` ⇒ **35 PASS · 0 FAIL**؛ شامل یک بررسی روی
**SQLite واقعی** (`node:sqlite` در پروسه‌ی فرزند) که خروجی `auditProtectedSql` را با
`isProtectedAuditRow` مقایسه می‌کند، و ۷ گزاره‌ی ساختاری که *مصرف* واقعی هر بند را می‌سنجد.
بقیه‌ی سوییت‌ها بدون رگرسیون: ۲۴ · ۳۴ · ۳۱(+۱ FAIL شناخته‌شده‌ی بند ۲۸) · ۴۴ · ۳۲ · ۲۴ · ۵۱ · ۳۸.
