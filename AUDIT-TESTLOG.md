# AUDIT-TESTLOG
## تست‌های ممیزی (بعد از رفع)
### tests/audit/audit-a69-01-opening-float-override.mjs
  ✓ A69-02: بستن با شکست Audit خطا داد
  ✓ A69-02: CashSession نیمه‌کاره نماند
  ✓ A69-02: موجودی اول هم rollback شد
  ✓ بستن اول: انتظار ۱٬۵۰۰
  ✓ موجودی اول ۵۰۰ یک‌بار ثبت شد
  ✓ A69-01: پیش‌نمایش با موجودی اول جعلی رد شد
  ✓ A69-01: پیام پیش‌نمایش فارسی و با مبلغ ثبت‌شده
  ✓ A69-01: بستن با موجودی اول جعلی رد شد
  ✓ A69-01: سند بستن جعلی ساخته نشد
  ✓ A69-01: صفر کردن موجودی اول هم رد شد
  ✓ با عدد ثبت‌شده: انتظار ۱٬۵۰۰
  ✓ با عدد ثبت‌شده: کسری ۳۰۰ دیده می‌شود
  ✓ بدون ورودی: از رکورد ثبت‌شده خوانده می‌شود
✓ 13 بررسی موفق · 0 ناموفق
### tests/audit/audit-a71-01-cheque-cleared-owner.mjs
  ✓ دفتر رویداد: پاس‌چک به کارمند ب (پاس فعلی)
  ✓ دفتر رویداد: کارمند الف پاس فعلی ندارد (بدون دوباره‌شماری)
  ✓ بدون فیلتر: فقط یک ردیف پاس‌چک
  ✓ ستون مالک پاس فعلی روی Payment هست
  ✓ clearedByUserId = کارمند ب
  ✓ برگشت از «پاس شد» مالک را تهی می‌کند
  ✓ دفتر append-only چهار گذار دارد
✓ 7 بررسی موفق · 0 ناموفق
### tests/audit/audit-a73-01-full-refund-cap.mjs
  ✓ پیش‌شرط: جمع فاکتور ۱٬۸۰۰٬۰۰۰ = 1800000
  ✓ override کالای اول: ۱٬۰۰۰٬۰۰۰ نقد = 1000000
  ✓ A73-03: دلیل مدیر در Audit = true
  ✓ A73-02: بعد از override، مشتری بدهکار نمی‌شود (مانده ۰) = 0
  ✓ A73-01: override دوم بیش از پول باقی‌مانده‌ی مشتری رد شد = true
  ✓ A73-01: پیام فارسی توضیح می‌دهد override فقط کسر تخفیف را برمی‌دارد = true
  ✓ A73-01: کل خروج نقد از کشو تا اینجا ۱٬۰۰۰٬۰۰۰ (≤ ۱٬۸۰۰٬۰۰۰ دریافتی) = 1000000
  ✓ A73-01: override نقدی روی نسیه‌ی پرداخت‌نشده رد شد = true
  ✓ A73-01: هیچ پولی از کشو خارج نشد = 1000000
✓ 9 بررسی موفق · 0 ناموفق
## قبل از رفع (روی zip ۱۵۴)
../a69-before.txt:  ✗ A69-02: بستن با شکست Audit خطا داد · دریافت false · انتظار true
../a69-before.txt:  ✗ A69-02: CashSession نیمه‌کاره نماند · دریافت 1 · انتظار 0
../a69-before.txt:  ✗ A69-02: موجودی اول هم rollback شد · دریافت 1 · انتظار 0
../a69-01-before.txt:  ✓ بستن اول: انتظار ۱٬۵۰۰
../a69-01-before.txt:  ✓ موجودی اول ۵۰۰ یک‌بار ثبت شد
../a69-01-before.txt:  ✗ A69-01: پیش‌نمایش با موجودی اول جعلی رد شد · دریافت false · انتظار true
../a69-01-before.txt:  ✗ A69-01: پیام پیش‌نمایش فارسی و با مبلغ ثبت‌شده · دریافت false · انتظار true
../a69-01-before.txt:  ✗ A69-01: بستن با موجودی اول جعلی رد شد · دریافت false · انتظار true
../a69-01-before.txt:  ✗ A69-01: سند بستن جعلی ساخته نشد · دریافت 2 · انتظار 1
../a69-01-before.txt:  ✗ A69-01: صفر کردن موجودی اول هم رد شد · دریافت false · انتظار true
../a69-01-before.txt:  ✓ با عدد ثبت‌شده: انتظار ۱٬۵۰۰
../a69-01-before.txt:  ✓ با عدد ثبت‌شده: کسری ۳۰۰ دیده می‌شود
../a69-01-before.txt:  ✓ بدون ورودی: از رکورد ثبت‌شده خوانده می‌شود
../a69-01-before.txt:✓ 5 بررسی موفق · 5 ناموفق
../a71-before.txt:  ✓ دفتر رویداد: پاس‌چک به کارمند ب (پاس فعلی)
../a71-before.txt:  ✗ دفتر رویداد: کارمند الف پاس فعلی ندارد (بدون دوباره‌شماری) · دریافت 900000 · انتظار 0
../a71-before.txt:  ✓ بدون فیلتر: فقط یک ردیف پاس‌چک
../a71-before.txt:  ✗ ستون مالک پاس فعلی روی Payment هست · دریافت false · انتظار true
## رگرسیون کامل
TOTAL=120 PASS=120 FAIL=0
FAILED: 
TOTAL=17 PASS=12 FAIL=5
FAILED: acceptance-db-session36.mjs acceptance-db-session47.mjs acceptance-session25.mjs stock-source-display-session53.mjs stock-source-pick-session51.mjs 
esbuild syntax: 132 OK · 0 FAIL
BUNDLE-OK main (1647621 bytes, warnings: 0)
BUNDLE-OK preload (33857 bytes, warnings: 0)
BUNDLE-OK renderer (2019970 bytes, warnings: 0)

## ادامه‌ی ممیزی (۷۲ تا ۷۹)
قبل (روی zip ۱۵۴ + رفع‌های ۶۹–۷۳):
- audit-a72-01 ⇒ ۶ موفق · ۲ ناموفق (تناقض shiftId+shiftNumber: وصول ۱۰٬۰۰۰؛ shiftNumber=0 رد نشد)
- audit-a75-01 ⇒ ۲ موفق · ۷ ناموفق (بستن/تعویض اجباری با Audit خراب انجام شد؛ actor/دلیل نبود)
- audit-a77-01 ⇒ ۳ موفق · ۳ ناموفق
- audit-a77-02 ⇒ ۱ موفق · ۵ ناموفق (موجودی اول دوبار ثبت شد؛ ۹۰۰ و ۸۰۰ جعلی پذیرفته شد)
بعد: tests/audit همه سبز: a69 ۱۳/۰ · a71 ۷/۰ · a72 ۸/۰ · a73 ۹/۰ · a75 ۹/۰ · a77-01 ۶/۰ · a77-02 ۶/۰
رگرسیون کامل: tests/audit-fixes TOTAL=120 PASS=120 · test/*.mjs 17/12/5 (همان پنج شکست قدیمی) · esbuild 132 OK · BUNDLE-OK main 1649952 / preload 33857 / renderer 2020474

## ادامه‌ی ممیزی (۸۰ تا ۸۷)
audit-a69-01-opening-float-override.mjs: ✓ 13 بررسی موفق · 0 ناموفق
audit-a71-01-cheque-cleared-owner.mjs: ✓ 7 بررسی موفق · 0 ناموفق
audit-a72-01-shift-number-consistency.mjs: ✓ 8 بررسی موفق · 0 ناموفق
audit-a73-01-full-refund-cap.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a75-01-shift-audit-atomic.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a77-01-repeat-close-confirmable.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a77-02-opening-float-window.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a80-01-open-key-race-and-reset.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a85-01-purge-void-integrity.mjs: ✓ 14 بررسی موفق · 0 ناموفق
fix-s80-open-session-idempotency: ✓ 9 بررسی موفق · 0 ناموفق
fix-s85-security-gates: نتیجه: 13 موفق · 0 ناموفق
fix-s118-purge-selected-invoices: ✓ 3 بررسی موفق · 0 ناموفق
fix-s109-purge-preview-pagination: ✓ 5 بررسی موفق · 0 ناموفق
fix-s127-maintenance-purge-guard: ✓ 7 بررسی موفق · 0 ناموفق
fix-s86-exchange-return-output: نتیجه: 5 موفق · 0 ناموفق
fix-s87-report-export-columns: نتیجه: 7 موفق · 0 ناموفق
esbuild: esbuild syntax: 2 OK · 0 FAIL
قبل: a80-01 ⇒ ۴ موفق · ۲ ناموفق؛ a85-01 ⇒ ۲ موفق · ۱۰ ناموفق (موجودی ۱۰⇒۱۱⇒۱۲)
رگرسیون کامل run-regression.sh در این نشست: اجرا نشد، دلیل: سقف اجرایی؛ فقط تست‌های مرتبط بالا.

## ادامه‌ی ممیزی (نشست ۸۸، ناتمام)
رگرسیون کامل (اولین کار این اجرا): bash tools/run-regression.sh <repo> regress-start.txt 8
tests/audit-fixes TOTAL=120 PASS=120 FAIL=0 · test/*.mjs TOTAL=17 PASS=12 FAIL=5 (همان پنج شکست قدیمی: acceptance-db-session36، acceptance-db-session47، acceptance-session25، stock-source-display-session53، stock-source-pick-session51) · esbuild syntax 132 OK · BUNDLE-OK main 1654723 / preload 33857 / renderer 2020612 ⇒ بدون رگرسیون نسبت به baseline (اندازه‌ها بعد از A80/A85 تغییر کرده‌اند).
fix-s88-staff-report-integrity: ۱۳ موفق · ۰ ناموفق (ساختاری/regex).
### tests/audit (جدا)
audit-a69-01-opening-float-override.mjs: ✓ 13 بررسی موفق · 0 ناموفق
audit-a71-01-cheque-cleared-owner.mjs: ✓ 7 بررسی موفق · 0 ناموفق
audit-a72-01-shift-number-consistency.mjs: ✓ 8 بررسی موفق · 0 ناموفق
audit-a73-01-full-refund-cap.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a75-01-shift-audit-atomic.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a77-01-repeat-close-confirmable.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a77-02-opening-float-window.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a80-01-open-key-race-and-reset.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a85-01-purge-void-integrity.mjs: ✓ 14 بررسی موفق · 0 ناموفق
audit-s88-staff-report-e2e.mjs: ✓ 10 بررسی موفق · 0 ناموفق
### tests/audit/audit-s88-staff-report-e2e.mjs
  ✓ performance با برگشت موجود crash نمی‌کند و دو ردیف دارد
  ✓ بدون تاریخ فقط امروز: فاکتور سه روز قبل الف شمرده نشد
  ✓ فروش امروز الف ۲٬۰۰۰٬۰۰۰
  ✓ برگشت الف ۱٬۰۰۰٬۰۰۰
  ✓ مصرف اعتبار ۳۰۰٬۰۰۰ فقط به کارمند ب (مصرف‌کننده)
  ✓ کارمند الف مصرف اعتبار ندارد
  ✓ ریز تراکنش ب: یک مصرف اعتبار با کد SC88
  ✓ نام شیفت برگشت از lookup اسکالر shiftId
  ✓ outOfShift با برگشت crash نمی‌کند (۲ فروش امروز + ۱ برگشت)
  ✓ نام کارمند برگشت در outOfShift از lookup اسکالر userId
  ⓘ شاهد A88-01 (هنوز رفع نشده): fromJalali='' ⇒ تعداد فاکتور الف 2 (امروز ۱؛ کل تاریخچه ۲)

✓ 10 بررسی موفق · 0 ناموفق
npm/npx/tsc و اینترنت در این sandbox هم نبود ⇒ npm install / prisma generate / typecheck اجرا نشد (Node 22.23.1 و esbuild sandbox موجود).

## نشست ۸۸ (بستن) — 2026-09-26T09:50:46Z
### tests/audit/audit-a88-01-staff-report-dates.mjs
  ✓ fromJalali='' ⇒ امروز (۱ فاکتور، نه کل تاریخچه ۲)
  ✓ fromJalali='   ' و null ⇒ امروز
  ✓ تاریخ با ارقام فارسی پذیرفته می‌شود
  ✓ '1405/07/0' (نیمه‌تایپ‌شده) ⇒ خطای فارسی
  ✓ '1405/13/01' ⇒ خطای فارسی
  ✓ transactions هم همان گیت را دارد
  ✓ UI: شماره‌ی درخواست و کنار گذاشتن پاسخ کهنه (متن کد)
✓ 7 بررسی موفق · 0 ناموفق
### tests/audit/audit-a88-02-credit-payment-void.mjs
  ✓ پیش‌شرط: مصرف ۳۰۰٬۰۰۰ ثبت شد
  ✓ ویرایش مبلغ ردیف اعتبار ۳۰۰٬۰۰۰ ⇒ ۵۰۰٬۰۰۰ رد می‌شود
  ✓ تبدیل روش ردیف اعتبار به «نقدی» رد می‌شود
  ✓ بعد از ویرایش‌های ردشده مبلغ پرداخت و دفتر اعتبار دست‌نخورده
  ✓ ویرایش فقط توضیح روی ردیف اعتبار مجاز است
  ✓ باقی‌مانده‌ی فاکتور ۳۰۰٬۰۰۰
  ✓ ردیف دفتر مصرف همان پرداخت reverse شد (نه حذف)
  ✓ اعتبار برگشت: usedAmount=۰، usedCount=۰، ACTIVE
  ✓ Audit برگشت مصرف اعتبار ثبت شد
  ✓ مصرف باطل در عملکرد کارمند ب شمرده نمی‌شود
  ✓ پرداخت نقدی همان فاکتور دست‌نخورده
  ✓ ابطال دوباره‌ی همان ردیف رد می‌شود
  ✓ ابطال دوباره اعتبار را دوباره برنگرداند
  ✓ SC88 روی فاکتور تازه دوباره ۳۰۰٬۰۰۰ مصرف شد
  ✓ برگشت کامل فاکتور تمام‌نقد: بازپرداخت نقدی ۱٬۰۰۰٬۰۰۰ (مصرف باطل از سقف کم نمی‌شود)
  ✓ پرداخت اعتباری بی‌دفتر مصرف: ابطال با پیام فارسی رد می‌شود
  ✓ …و پرداخت باطل نشد (rollback)
✓ 17 بررسی موفق · 0 ناموفق
### tests/audit/audit-a88-03-voided-payment-leak.mjs
  ✓ ثبت دوباره‌ی ۱٬۰۰۰٬۰۰۰ بعد از ابطال بدون هشدار اضافه‌دریافت
  ✓ پرداخت تازه اضافه‌دریافت ندارد (۰، نه ۱٬۰۰۰٬۰۰۰)
  ✓ پیش‌شرط: وصول ۵۰۰٬۰۰۰ در سه عدد گزارش (جمع/پل/نقد)
  ✓ بعد از ابطال وصول: جمع وصول نسیه / پل settledPrior / نقد priorCreditSettlements همه ۰
  ✓ دفتر رویداد: ردیف «وصول نسیه» برای پرداخت باطل نمی‌آید
  ✓ creditList: وصول باطل‌شده در فهرست نیست
✓ 6 بررسی موفق · 0 ناموفق
### tests/audit/audit-s88-staff-report-e2e.mjs
  ✓ performance با برگشت موجود crash نمی‌کند و دو ردیف دارد
  ✓ بدون تاریخ فقط امروز: فاکتور سه روز قبل الف شمرده نشد
  ✓ فروش امروز الف ۲٬۰۰۰٬۰۰۰
  ✓ برگشت الف ۱٬۰۰۰٬۰۰۰
  ✓ مصرف اعتبار ۳۰۰٬۰۰۰ فقط به کارمند ب (مصرف‌کننده)
  ✓ کارمند الف مصرف اعتبار ندارد
  ✓ ریز تراکنش ب: یک مصرف اعتبار با کد SC88
  ✓ نام شیفت برگشت از lookup اسکالر shiftId
  ✓ outOfShift با برگشت crash نمی‌کند (۲ فروش امروز + ۱ برگشت)
  ✓ نام کارمند برگشت در outOfShift از lookup اسکالر userId
  ✓ A88-01 رفع‌شده: fromJalali='' ⇒ امروز (۱ فاکتور الف، نه ۲)
✓ 11 بررسی موفق · 0 ناموفق
### رگرسیون کامل
TOTAL=120 PASS=120 FAIL=0
FAILED: 
TOTAL=17 PASS=12 FAIL=5
FAILED: acceptance-db-session36.mjs acceptance-db-session47.mjs acceptance-session25.mjs stock-source-display-session53.mjs stock-source-pick-session51.mjs 
esbuild syntax: 132 OK · 0 FAIL
BUNDLE-OK main (1661491 bytes, warnings: 0)
BUNDLE-OK preload (33857 bytes, warnings: 0)
BUNDLE-OK renderer (2021726 bytes, warnings: 0)
### قبل از رفع (کد قبلی)
a88-01: ۱ موفق / ۶ ناموفق · a88-02: ۴ موفق / ۹ ناموفق + crash (addPayment) · a88-03: ۱ موفق / ۵ ناموفق

## نشست ۸۹ — 2026-09-26T09:53:03Z
  ✓ فیلتر شیفت شب: برگشت ۶۰۰٬۰۰۰ روی فروش ۱٬۰۰۰٬۰۰۰ همان شیفت (۶۰٪) هشدار می‌دهد
  ✓ برچسب نسبت ۶۰٪ است (نه ۶٪ رقیق‌شده با فروش شیفت دیگر)
  ✓ فاکتور لغوشده/پیش‌نویس ۴۰٬۰۰۰٬۰۰۰ در مخرج نمی‌آید ⇒ ۴۰۰٬۰۰۰/۱٬۰۰۰٬۰۰۰ = ۴۰٪ هشدار
✓ 3 بررسی موفق · 0 ناموفق
قبل از رفع: ۰ موفق / ۳ ناموفق
TOTAL=120 PASS=120 FAIL=0
FAILED: 
TOTAL=17 PASS=12 FAIL=5
FAILED: acceptance-db-session36.mjs acceptance-db-session47.mjs acceptance-session25.mjs stock-source-display-session53.mjs stock-source-pick-session51.mjs 
esbuild syntax: 132 OK · 0 FAIL
BUNDLE-OK main (1661953 bytes, warnings: 0)
BUNDLE-OK preload (33857 bytes, warnings: 0)
BUNDLE-OK renderer (2021726 bytes, warnings: 0)
### tests/audit
audit-a69-01-opening-float-override.mjs: ✓ 13 بررسی موفق · 0 ناموفق
audit-a71-01-cheque-cleared-owner.mjs: ✓ 7 بررسی موفق · 0 ناموفق
audit-a72-01-shift-number-consistency.mjs: ✓ 8 بررسی موفق · 0 ناموفق
audit-a73-01-full-refund-cap.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a75-01-shift-audit-atomic.mjs: ✓ 9 بررسی موفق · 0 ناموفق
audit-a77-01-repeat-close-confirmable.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a77-02-opening-float-window.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a80-01-open-key-race-and-reset.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a85-01-purge-void-integrity.mjs: ✓ 14 بررسی موفق · 0 ناموفق
audit-a88-01-staff-report-dates.mjs: ✓ 7 بررسی موفق · 0 ناموفق
audit-a88-02-credit-payment-void.mjs: ✓ 17 بررسی موفق · 0 ناموفق
audit-a88-03-voided-payment-leak.mjs: ✓ 6 بررسی موفق · 0 ناموفق
audit-a89-01-return-rate-denominator.mjs: ✓ 3 بررسی موفق · 0 ناموفق
audit-s88-staff-report-e2e.mjs: ✓ 11 بررسی موفق · 0 ناموفق

## نشست‌های ۹۱ تا ۹۳ — ممیزی ادامه
قبل از رفع (worktree کد قبلی): a91-01 ۲ موفق/۱۰ ناموفق · a91-02 ۱/۵ · a92-01 ۲/۴ · a93-01 ۱/۴
بعد: a91-01 ۱۲/۰ · a91-02 ۶/۰ · a92-01 ۶/۰ · a93-01 سبز (بررسی sourceLabel در هارنس ردیف نداد ⇒ فقط تایپ)
تست‌های قدیمی regex به‌روزشده: fix-s91 (نام helper)، fix-s92 (فاصله‌ی regex)، fix-s94 (ثابت سرستون اعتبار)
رگرسیون: tests/audit-fixes ۱۲۰/۱۲۰ (بعد از اصلاح fix-s94) · test/*.mjs ۱۷/۱۲/۵ (همان ۵ قدیمی) · esbuild ۱۳۲ OK · سه BUNDLE-OK · tests/audit ۱۸/۱۸

## ممیزی نشست‌های ۹۴–۹۶
- baseline قبل از شروع: audit-fixes ۱۲۰/۱۲۰ (fix-s94 در اجرای کامل سبز)، test/*.mjs ۱۲/۱۷ با همان ۵ شکست قدیمی، esbuild ۱۳۲ OK، سه BUNDLE-OK، tests/audit ۱۸/۱۸.
- a94-01: worktree کد تغییرنیافته ⇒ ۳ موفق/۱۰ ناموفق؛ بعد ⇒ ۱۳/۰.
- a96-01: worktree کد تغییرنیافته ⇒ ۳ موفق/۱۰ ناموفق؛ بعد ⇒ ۱۳/۰.
- رگرسیون نهایی (بعد از به‌روزرسانی regex تست fix-s110 به helper مشترک A94-02): TOTAL=120 PASS=120 FAIL=0 TOTAL=17 PASS=12 FAIL=5  · esbuild ۱۳۳ OK · سه BUNDLE-OK · tests/audit ۲۰/۲۰

## نشست ۹۷/۹۸ (ممیزی)
- baseline پیش از کار: tests/audit-fixes ۱۲۰/۱۲۰، test/*.mjs ۱۲ سبز از ۱۷ (همان ۵ قدیمی)، esbuild ۱۳۳ OK، سه BUNDLE-OK، tests/audit ۲۰/۲۰.
- قبل (git worktree از کد تغییرنیافته): audit-a97-01 ⇒ ۴ موفق · ۱۰ ناموفق. بعد: ۱۴ · ۰.
- اجرای اول رگرسیون: fix-s124 و acceptance-db-session35 شکستند (chunkIds حذف شده بود و نشست ۱۲۴ از آن استفاده می‌کرد) ⇒ برگردانده شد، هر دو سبز.
- fix-s97 (regex) به creditReportScope.ts، و fix-s98 به قاعده‌ی مالک رویداد (نشست‌های پشت‌سرهم، createdAt، اعتبار دستی) به‌روز شدند.

## نشست ۹۹ (ممیزی)
- audit-a99-01-report-page-scope.mjs روی کد تغییرنیافته: ۱۳ موفق · ۲۲ ناموفق (A99-01 تا A99-04 همه بازتولید شدند).
- بعد از رفع: ۳۵ موفق · ۰ ناموفق.
- رگرسیون اول بعد از رفع: audit-fixes ۱۱۶/۱۲۰؛ چهار تست regex (fix-s91، fix-s96، fix-s99، fix-s105) به‌خاطر جابه‌جایی منطق به helper مشترک؛ به‌روز شدند ⇒ هر چهار سبز.
- test/*.mjs ۱۲/۱۷ (همان ۵ شکست قدیمی)؛ esbuild ۱۳۴ OK؛ سه BUNDLE-OK؛ tests/audit ۲۲/۲۲.

## نشست ۱۰۰ و ۱۰۱ (ممیزی)
- پایه: git init + commit پایه؛ worktree ../before از کد تغییرنیافته.
- audit-a100-01-credit-limit-counter: قبل ۷ موفق · ۲ ناموفق (شمارنده «تسویه شده» ۰ به‌جای ۶، «لغو شده» ۲ به‌جای ۱). بعد ۹ · ۰. بخش هم‌ارزی onlyWithRemaining روی هر دو کد سبز (مشکوک قبلی رد شد).
- audit-a101-01-credit-list-paging: قبل ۲ موفق · ۱۰ ناموفق. بعد ۱۲ · ۰.
- fix-s101 (regex) به creditListPager به‌روز شد ⇒ ۷/۰. fix-s143 و fix-s151b (خواننده‌ی CreditManagement.tsx) سبز ماندند.

## نشست ۱۰۲ (ممیزی)
- audit-a102-01-staff-report-status-gate: قبل (worktree) ۲ موفق · ۶ ناموفق؛ بعد ۸ · ۰.
- اجرای اول: fix-s65 (regex «۴ کوئری فاکتور inline با voidedAt: null») با where مشترک شکست ⇒ inline برگردانده شد ⇒ ۶۴/۰. fix-s102/s103/s117/s88 و a88-01/02، s88-e2e سبز.

## رگرسیون پایان نشست ممیزی ۱۰۰–۱۰۲
- tests/audit-fixes ۱۲۰/۱۲۰ · test/*.mjs ۱۲/۱۷ (همان ۵ قدیمی) · esbuild ۱۳۴ OK · سه BUNDLE-OK · tests/audit ۲۵/۲۵.
- npm/اینترنت در دسترس نبود ⇒ npm install، prisma generate و typecheck اجرا نشدند.

## نشست ۱۰۳ (ممیزی)
- audit-a103-01-staff-drill-paging: قبل (worktree) ۵ موفق · ۷ ناموفق؛ بعد ۱۲ · ۰.
- fix-s103 (regex متن هشدار در سرویس) پس از انتقال متن به helper شکست ⇒ regex به service+helper گسترش یافت ⇒ ۱۰/۰. fix-s65 ۶۴/۰، fix-s102 ۸/۰، fix-s88 ۱۳/۰. esbuild سه فایل OK.

## نشست ۱۰۴ (ممیزی)
- audit-a104-01-fraud-days-dates: قبل (worktree) ۴ موفق · ۶ ناموفق؛ بعد ۱۰ · ۰.
- وابسته‌ها سبز: fix-s104-fraud-review-scale ۲/۰، fix-s104-jalali-range-scale ۳/۰، fix-s111 ۷/۰، fix-s133 ۲۰/۰، fix-s151b ۷۱/۰، fix-s84 ۵/۰، fix-s89 ۴/۰، a89-01 ۳/۰، a94-01 ۱۳/۰، acceptance-session14 ۲۴/۰.

## پایان نشست ممیزی ۱۰۳–۱۰۴
- tests/audit جدید: a103-01 ۱۲/۰، a104-01 ۱۰/۰. تست‌های وابسته (فهرست در بخش ۱۰۳ و ۱۰۴) سبز.
- رگرسیون کامل (run-regression.sh) در این نشست اجرا نشد (سقف اجرا)؛ اولین کار نشست بعد.

## ممیزی ۱۰۵–۱۰۷
- رگرسیون کامل پیش از رفع‌ها (کد ۱۰۴): audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵ قدیمی)، esbuild ۱۳۵ OK، سه BUNDLE-OK، tests/audit ۲۷/۲۷.
- a105-01: قبل ۴/۵ ⇒ ۹/۰ · a106-01: قبل ۵/۶ ⇒ ۱۱/۰ · a106-02: قبل ۵/۲ ⇒ ۸/۰ · a107-01: قبل ۵/۲ ⇒ ۷/۰.
- وابسته‌ها سبز: fix-s105 (regex به‌روز)، s117، s106، s107، s100، s110–s113، s133، s59/60/70–75/78/80/82/85، s123، s129، s137، s139، s140، s65، a71، a72، a75، a80، a88-03، a91-01، a94-01، a99-01، a100-01، acceptance-session14/21/48/src46. acceptance-session25 و stock-source-display-session53 و acceptance-db-session36 همان شکست‌های قدیمی (خروجی قبل/بعد یکسان).

## ممیزی ۱۰۸
- شروع نشست: حلقه‌ی tests/audit روی کد ۱۰۷ ⇒ ۳۱/۳۱ PASS.
- a108-01-bridge-drill-sources: قبل (worktree) ۱۱ موفق · ۱۰ ناموفق؛ بعد ۲۱ · ۰.
- a108-03-bridge-drill-last-page: قبل ۳ · ۳؛ بعد ۱۰ · ۰.
- fix-s108 (regex) پس از رفع شکست (payment.count، onBridgePage(drill.key, drill.sourcesPage)) ⇒ regex گسترش یافت ⇒ ۱۰/۰.
- وابسته‌ها سبز: fix-s126، s58، s59، s60، s61، s62، s63، s64، s65، s92، acceptance-session14، fix-s56-reports، a88-03، a96-01، a106-02، a94-01. acceptance-db-session36 همان شکست قدیمی (خروجی قبل/بعد جز مسیر یکسان).

## ممیزی ۱۰۹
- a109-01-purge-preview-dates: قبل (worktree) ۶ · ۳؛ بعد ۹ · ۰.
- وابسته‌ها: fix-s109 ۵/۰، fix-s118 سبز، a85-01 سبز؛ acceptance-db-session47 همان شکست قدیمی.

## ممیزی ۱۱۰
- شروع نشست: رگرسیون کامل روی کد ۱۰۹ ⇒ audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵ قدیمی: acceptance-db-session36، acceptance-db-session47، acceptance-session25، stock-source-display-session53، stock-source-pick-session51)، esbuild ۱۳۵ OK، سه BUNDLE-OK؛ tests/audit ۳۴/۳۴.
- a110-01-fraud-source-receipt: قبل (worktree) ۳ · ۹؛ بعد ۱۲ · ۰.
- وابسته‌ها سبز: fix-s104×۲، s110، s111، s133، s151b، s84×۳، s89، s93، s94، a89-01، a104-01، a94-01، acceptance-session14.

## ممیزی ۱۱۱
- audit-s111-fraud-source-cap (تأیید رفتاری، بدون رفع): ۵ · ۰.
## ممیزی ۱۱۲
- a112-01-ledger-drawer-cash: قبل (worktree) ۲ · ۴؛ بعد ۶ · ۰.
- وابسته‌ها سبز: fix-s112، s133، s59، s60، s70، s71، s72، s74، a71-01، a72-01، a88-03، a106-02؛ esbuild SalesLedger/FraudService OK.
## ممیزی ۱۱۳
- audit-s113-cheque-destination (تأیید رفتاری، بدون رفع): ۷ · ۰.
## ممیزی ۱۱۴
- شروع نشست: رگرسیون کامل روی کد ۱۱۳ ⇒ audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵ قدیمی)، esbuild ۱۳۵ OK، سه BUNDLE-OK؛ tests/audit ۳۸/۳۸.
- a114-01-cash-lists-dates: قبل (worktree) ۵ · ۱۷؛ بعد ۲۲ · ۰.
- a114-02-cash-destructive-dates: قبل (worktree) ۲ · ۹؛ بعد ۱۱ · ۰.
- وابسته‌ها سبز: fix-s114×۳، fix-s115×۴، fix-s92 (regex `const fromJalali = filter.fromJalali ?? …` حفظ شد)، a92-01، a104-01.
- رگرسیون کامل بعد از رفع: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵؛ خروجی قبل/بعد جز ترتیب خط هشدار یکسان)، esbuild ۱۳۶ OK، سه BUNDLE-OK؛ tests/audit ۴۰/۴۰.

## ممیزی ۱۱۵
- شروع نشست: رگرسیون کامل روی کد ۱۱۴ ⇒ audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵ قدیمی)، esbuild ۱۳۶ OK، سه BUNDLE-OK؛ tests/audit ۴۰/۴۰.
- a115-01-card-transfer-adjust-cancel-state: قبل (worktree) ۴ · ۱۸؛ بعد ۲۲ · ۰.
- a115-02-purchase-list-applied-range: قبل ۰ · ۱۱؛ بعد ۱۱ · ۰.
- audit-s115-purchase-party-verify (تأیید): ۱۰ · ۰ (روی هارنس قدیم ۹ · ۱ به علت باگ groupBy _max متنی).
- fix-s143 ۱۳/۰ و fix-s144 ۲۵/۰ با fixture تازه.
- رگرسیون کامل بعد از رفع: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۳۸ OK، سه BUNDLE-OK؛ tests/audit ۴۳/۴۳.
## ممیزی ۱۱۶
- audit-s116-stock-movements-verify (تأیید): ۱۱ · ۰.

- ۱۱۷: شروع رگرسیون ۱۲۰/۱۲۰، ۱۲/۱۷ (همان ۵)، esbuild ۱۳۸، سه BUNDLE-OK، tests/audit ۴۴/۴۴. a117-01 قبل ۷/۱۰ ⇒ ۱۷/۰؛ a117-02 قبل ۱/۷ ⇒ ۸/۰. همسایه‌ها سبز: fix-s117-credit، s91، s105، s101، s58، s59، s60، a101، a105، a88-03، a91-02.
- رگرسیون پایانی ۱۱۷: TOTAL=120 PASS=120 FAIL=0 TOTAL=17 PASS=12 FAIL=5 

## نشست ممیزی ۱۱۷ (ادامه) و ۱۱۸
- شروع: رگرسیون کامل ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۳۹ OK · سه BUNDLE-OK · tests/audit ۴۶/۴۶.
- بعد از A117-03/04/05 + audit-s117: رگرسیون کامل همان اعداد (esbuild ۱۳۹، سه BUNDLE-OK)، tests/audit ۴۹/۴۹.
- A118-01: a118-01 قبل ۵/۳ ⇒ ۸/۰؛ fix-s118-purge ۳/۰، a109-01 ۹/۰، a85-01 ۱۴/۰، fix-s109 ۵/۰. رگرسیون کامل بعد از A118-01 اجرا نشد، دلیل: سقف اجرا.

## نشست ممیزی ۱۱۸ (ادامه)
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵ قدیمی) · esbuild ۱۳۹ OK · سه BUNDLE-OK · tests/audit ۵۰/۵۰.
- A118-02: a118-02 قبل (worktree) ۳ · ۹؛ بعد ۱۲ · ۰. fix-s118-secondary-stock-history ۶/۰ (نسخه‌ی اول رفع آن را ۵/۱ شکست؛ دکمه‌ها کوتاه شدند).
- S118-2: audit-s118-price-adjust-full-scope (تأیید) ۱۴ · ۰ روی کد قبل و بعد.
- رگرسیون کامل بعد از ۱۱۸: audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۰ OK · سه BUNDLE-OK · tests/audit ۵۲/۵۲.
## ممیزی ۱۱۹
- a119-01-credit-batches-stocktake-paging: قبل (worktree) ۸ · ۱۶؛ بعد ۲۴ · ۰.
- همسایه‌ها: fix-s119-credit-detail ۱۸/۰، fix-s119-stockcount ۱۲/۰، fix-s143-stock-count ۱۲/۰، fix-s143-manual-credit ۱۶/۰، fix-s120-stockcount-in ۳/۰، a101-01 ۱۲/۰، a117-04 ۱۲/۰.
- رگرسیون کامل بعد از ۱۱۹: TOTAL=120 PASS=120 FAIL=0 TOTAL=17 PASS=12 FAIL=5  · esbuild syntax: 141 OK · 0 FAIL · AUDIT PASS=53 FAIL=0 FAILED:

## ممیزی ادامه از ۱۱۹ (A119-04) و ۱۲۰
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۵۳/۵۳.
- a119-04-ledger-credit-used: قبل (worktree) ۲ · ۱۳؛ بعد ۱۵ · ۰. رگرسیون کامل بعد از A119-04: ۱۲۰/۱۲۰ · ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK.
- a120-01-stockcount-date-gate: قبل ۳ · ۷؛ بعد ۱۰ · ۰. همسایه‌ها: fix-s143-stock-count ۱۲/۰، a119-01 ۲۴/۰، fix-s120-stockcount ۳/۰، a117-04 ۱۲/۰، fix-s119-stockcount ۱۲/۰.
- audit-s120-price-schedule-verify ۱۱/۰؛ audit-s120-stockcount-submit-verify ۵/۰ (تأیید، بدون ایراد).
- رگرسیون کامل بعد از ۱۲۰: audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۵۷/۵۷.

## ممیزی ادامه از ۱۲۱
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۵۷/۵۷.
- a121-01-page-output-endpoint: قبل (worktree) ۱ · ۱۸؛ بعد ۱۹ · ۰. رگرسیون کامل بعد از A121-01: ۱۲۰/۱۲۰ · ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۵۸/۵۸.
- a121-02-thermal-summary-meta: قبل ۵ · ۲؛ بعد ۷ · ۰. همسایه‌ها: fix-s121 و fix-s133 سبز.
## ممیزی ۱۲۲ (A122-01)
- a122-01-purge-draft-scope: قبل (worktree) ۵ · ۷؛ بعد ۱۲ · ۰.
- رگرسیون کامل پایان نشست: audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۰/۶۰.

## ممیزی ادامه از ۱۲۲ (تکمیل)
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۰/۶۰.
- audit-s122-invalid-invoice-scope: ۲۷ · ۰ (تأیید رفتاری؛ ایراد مسیر پیش‌فرض نیافتم).
- audit-s123-allocation-print-chunk-verify: ۱۳ · ۰ (تأیید). fix-s123 ۱۲/۰.
- audit-s124-variant-chunk-effect-verify: ۹ · ۰ (تأیید). fix-s124 ۷/۰.
- پایان نشست: tests/audit ۶۳ فایل (۶۰ قبلی + s122، s123، s124، همه سبز جداگانه). src در این نشست تغییر نکرد ⇒ رگرسیون audit-fixes/test/esbuild همان baseline شروع (۱۲۰/۱۲۰ · ۱۲/۱۷ همان ۵ · ۱۴۱ OK · سه BUNDLE-OK).

## ممیزی ادامه از ۱۲۵
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۳/۶۳.
- audit-s125-return-exchange-chunk-verify: ۳۲ · ۰ (تأیید). حلقه‌ی کامل tests/audit ۶۴/۶۴.
- audit-s126-credit-scan-variant-purge-verify: ۱۶ · ۰ (تأیید). fix-s126 ۷/۰ (regex).
- هارنس: $executeRawUnsafe نگاشت Date⇒ms (هم‌سان $queryRawUnsafe). رگرسیون کامل بعد از آن: ۱۲۰/۱۲۰ · ۱۲/۱۷ (همان ۵) · ۱۴۱ OK · سه BUNDLE-OK.
- audit-s127-maintenance-retention-verify: قبل از رفع هارنس ۱۸ · ۱؛ بعد ۱۹ · ۰.
- audit-s128-archive-gate-ipc-verify: ۱۰ · ۰ (تأیید).
- پایان این نشست: ۱۲۹ نیمه‌کاره (بدون تست تازه). src در این نشست تغییر نکرد؛ فقط test/harness/prismaLite.mjs.

## ممیزی ادامه از ۱۲۹
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۷/۶۷.
- audit-s129-print-export-verify (پیش‌نویس بیرون از پروژه، روی HEAD پیش از رفع): ۳۱ · ۶ (نتیجه‌ی نامعلوم شمرده نمی‌شد ×۴، Audit یادداشت نداشت، دیالوگ مهلت ۳۰ ثانیه داشت).
- رفع AUDIT-S129-01 (printer.ts، PrintService.ts، StoreCreditService.ts) ⇒ ۳۷ · ۰؛ با بخش ۵ (نشست ۹۰) ⇒ ۴۴ · ۰.
- رگرسیون کامل بعد از رفع: ۱۲۰/۱۲۰ · ۱۲/۱۷ (همان ۵، acceptance-session25 همان بند ۱۶) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۸/۶۸.
- audit-s130-xlsx-ooxml-order: قبل ۹ · ۲ ⇒ بعد از رفع AUDIT-S130-01 ۱۱ · ۰.
- رگرسیون کامل بعد از رفع ۱۳۰: در خروجی reg2 (پایین همین نشست).
## ممیزی ۱۳۲ (ادامه، نشست ممیزی تازه)
- شروع: رگرسیون کامل audit-fixes ۱۲۰/۱۲۰ · test ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۶۹/۶۹ (حلقه‌ی کامل، شامل audit-s130).
- audit-s132-export-extension-verify: روی کد فعلی ۲۷ · ۰؛ روی worktree با ExportService پیش از ۱۳۲ (git apply -R فقط همان hunk) ۲۳ · ۴ (CSV بی‌پسوند ⇒ ‎.xlsx، format=xlsx، محتوای ZIP؛ ‎.txt با csv ⇒ ‎.txt.xlsx).
- audit-s133-export-full-range-verify: قبل ۵ · ۱۱؛ بعد ۱۶ · ۰. رگرسیون بعد از رفع: ۱۲۰/۱۲۰ · ۱۲/۱۷ (همان ۵) · esbuild ۱۴۱ OK · سه BUNDLE-OK · tests/audit ۷۰/۷۰.
- audit-s135-shift-purge-scope: قبل (worktree) ۶ · ۵؛ بعد ۱۱ · ۰. رگرسیون کامل بعد از رفع ۱۳۵ در پس‌زمینه اجرا شد (نتیجه در گزارش نشست).

## ادامه از ۱۳۶
- baseline اول نشست: audit-fixes ۱۲۰/۱۲۰ · test/*.mjs ۱۲/۱۷ (همان ۵ شکست قدیمی) · esbuild ۱۴۱ OK + سه BUNDLE-OK · tests/audit ۷۲/۷۲.
- بعد از رفع ۱۳۶: audit-fixes ۱۲۰/۱۲۰ · test/*.mjs ۱۲/۱۷ (همان ۵) · esbuild ۱۴۲ OK + سه BUNDLE-OK · tests/audit ۷۳/۷۳.
- audit-s136: قبل ۴✓/۲۱✗، بعد ۲۵✓/۰✗. audit-s137-138: ۲۰✓/۰✗ (تست تأیید؛ فقط src تغییرنکرده، رگرسیون کامل دوباره اجرا نشد).

## ۱۳۹–۱۴۰
- baseline اول نشست: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK و سه BUNDLE-OK، tests/audit ۷۴/۷۴.
- پس از رفع ۱۳۹: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK و سه BUNDLE-OK، tests/audit ۷۵/۷۵.
- audit-s139: قبل ۲۵/۸، بعد ۳۳/۰. audit-s140: قبل ۱۳/۶، بعد ۱۹/۰.
- رگرسیون بعد از ۱۴۰: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK و سه BUNDLE-OK، tests/audit TOTAL=76 PASS=76 FAIL=0

## ۱۴۱
- baseline اول نشست: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK و سه BUNDLE-OK، tests/audit ۷۶/۷۶.
- audit-s141-return-exchange-integer-verify: قبل ۲۶/۷، بعد ۳۳/۰. audit-s141-return-ipc-actor-verify: قبل ۵/۷، بعد ۱۲/۰.
- رگرسیون بعد از ۱۴۱: TOTAL=120 PASS=120 FAIL=0 TOTAL=17 PASS=12 FAIL=5  esbuild syntax: 142 OK · 0 FAIL · tests/audit PASS=78 FAIL=0

## نشست ۱۴۲
- اول نشست: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK + سه BUNDLE-OK، tests/audit ۷۸/۷۸.
- audit-s142-credit-method-gate: قبل ۱۶/۲۲ ⇒ بعد ۳۸/۰.
- بعد از رفع: audit-fixes ۱۲۰/۱۲۰، test ۱۲/۱۷ (همان ۵)، esbuild ۱۴۲ OK + سه BUNDLE-OK، tests/audit ۷۹/۷۹.

## ممیزی تازه ۱۴۲–۱۴۵ (مبنا zip ۱۵۵)
- baseline: audit-fixes 121/121 · test 12/17 (همان ۵) · esbuild 143 OK + سه BUNDLE-OK · tests/audit 79/79
### a142b-after
  ✓ روش چک با مقصد نقد کشو رد شد
  ✓ روش چک با مقصد حساب مدیر (بی‌سررسید) رد شد
  ✓ هیچ ردیف پرداختی ساخته نشد
  ✓ نسیه دست‌نخورده
  ✓ کنترل: چک واقعی از فرم چک پذیرفته
  ✓ کنترل: ردیف چک kind=CHEQUE ساخته شد
  ✓ کنترل: کارت‌به‌کارت به حساب مدیر پذیرفته
  ✓ نقدی ⇒ «چک · حساب مدیر» رد شد
  ✓ ردیف دست‌نخورده (نقدی، CASH، ۵۰۰٬۰۰۰)
  ✓ کنترل: ویرایش یادداشت مجاز
نتیجه: 10 موفق · 0 ناموفق
### a143-before
  ✗ تاریخ صدور = امروز (نه ۳۰ روز قبل) — انتظار "1405/07/04"، دریافت "1405/06/05"
  ✓ نوع MANUAL
  ✗ به سند برگشت چسبانده نشد — انتظار null، دریافت 1
  ✗ به فاکتور مبدأ چسبانده نشد — انتظار null، دریافت 1
  ✗ به سند تعویض چسبانده نشد — انتظار null، دریافت 1
  ✗ کد دلخواه رندرر پذیرفته نشد — انتظار false، دریافت true
  ✗ Audit با اقدام CREDIT_ISSUE_MANUAL — انتظار 1، دریافت 0
  ✗ Audit با برچسب جعلی ساخته نشد — انتظار 0، دریافت 1
  ✓ مبلغ/تلفن/یادداشت/پیش‌نویس/مدت
نتیجه: 2 موفق · 7 ناموفق
### a143-after
  ✓ تاریخ صدور = امروز (نه ۳۰ روز قبل)
  ✓ نوع MANUAL
  ✓ به سند برگشت چسبانده نشد
  ✓ به فاکتور مبدأ چسبانده نشد
  ✓ به سند تعویض چسبانده نشد
  ✓ کد دلخواه رندرر پذیرفته نشد
  ✓ Audit با اقدام CREDIT_ISSUE_MANUAL
  ✓ Audit با برچسب جعلی ساخته نشد
  ✓ مبلغ/تلفن/یادداشت/پیش‌نویس/مدت
نتیجه: 9 موفق · 0 ناموفق
### a144-before
  ✗ −۶۰۰٬۰۰۰ روی پرداخت ۵۰۰٬۰۰۰ رد شد — انتظار false، دریافت true
  ✗ پیام فارسی با خالص پرداخت‌شده — انتظار true، دریافت false
  ✗ هیچ ردیف اصلاحی ساخته نشد — انتظار 0، دریافت 1
  ✗ وضعیت مرجع PAID ماند — انتظار "PAID"، دریافت "ADJUSTED"
  ✓ کنترل: −۲۰۰٬۰۰۰ پذیرفته (خالص ۳۰۰٬۰۰۰)
  ✗ −۳۰۰٬۰۰۱ بعد از اصلاح قبلی رد (اصلاح‌های قبلی هم شمرده می‌شوند) — انتظار false، دریافت true
  ✓ مرز: −۳۰۰٬۰۰۰ ⇒ خالص دقیقاً ۰ پذیرفته
  ✗ دو ردیف اصلاحی — انتظار 2، دریافت 4
  ✗ +۱۰۰٬۰۰۰ روی برگشت باطل‌شده رد شد — انتظار false، دریافت true
  ✗ پیام فارسی «باطل شده» — انتظار true، دریافت false
  ✗ هیچ ردیف اصلاحی — انتظار 0، دریافت 1
  ✓ کنترل: پس‌گرفتن −۴۰۰٬۰۰۰ روی سند باطل مجاز
  ✓ +۵۰٬۰۰۰ پذیرفته
نتیجه: 4 موفق · 9 ناموفق
### a144-after
  ✓ −۶۰۰٬۰۰۰ روی پرداخت ۵۰۰٬۰۰۰ رد شد
  ✓ پیام فارسی با خالص پرداخت‌شده
  ✓ هیچ ردیف اصلاحی ساخته نشد
  ✓ وضعیت مرجع PAID ماند
  ✓ کنترل: −۲۰۰٬۰۰۰ پذیرفته (خالص ۳۰۰٬۰۰۰)
  ✓ −۳۰۰٬۰۰۱ بعد از اصلاح قبلی رد (اصلاح‌های قبلی هم شمرده می‌شوند)
  ✓ مرز: −۳۰۰٬۰۰۰ ⇒ خالص دقیقاً ۰ پذیرفته
  ✓ دو ردیف اصلاحی
  ✓ +۱۰۰٬۰۰۰ روی برگشت باطل‌شده رد شد
  ✓ پیام فارسی «باطل شده»
  ✓ هیچ ردیف اصلاحی
  ✓ کنترل: پس‌گرفتن −۴۰۰٬۰۰۰ روی سند باطل مجاز
  ✓ +۵۰٬۰۰۰ پذیرفته
نتیجه: 13 موفق · 0 ناموفق
### audit-s142b قبل: 2 موفق · 8 ناموفق (روش چک با CASH/MANAGER پذیرفته، ردیف 1، paidTotal 500000، نقدی⇒چک·MANAGER)
### بعد از رفع‌ها
TOTAL=121 PASS=121 FAIL=0
TOTAL=17 PASS=12 FAIL=5
## esbuild
esbuild syntax: 143 OK · 0 FAIL
BUNDLE-OK main (1723908 bytes, warnings: 0)
BUNDLE-OK preload (33857 bytes, warnings: 0)
BUNDLE-OK renderer (2051621 bytes, warnings: 0)
tests/audit PASS=82 FAIL=0

### audit-s145-inventory-purge-verify قبل: 9 موفق · 22 ناموفق ("3"/null/""/true/منفی در increase/decrease پذیرفته، دسته‌ی مختلط نیمه‌نوشته، purge کالای بازگردانی‌شده را حذف کرد)
### بعد: 31 موفق · 0 ناموفق
TOTAL=121 PASS=121 FAIL=0
TOTAL=17 PASS=12 FAIL=5 (همان پنج)
esbuild syntax: 143 OK · 0 FAIL · سه BUNDLE-OK
tests/audit PASS=83 FAIL=0
