# CHANGELOG — جلسه ۲۴

## محدودیت محیط
بدون `npm` و بدون شبکه. پس `npm install` / `prisma generate` / `build` / اجرای
Electron **انجام نشد** و اولویت ۴ (Smoke Test) دست‌نخورده ماند. تایپ‌چک واقعی با
`tsc 5.6.3` و اعلان ambient برای پکیج‌های نصب‌نشده گرفته شد.

## ۱) سه باگ build-breaking (همه با tsc تأیید و رفع شد)
| فایل | خطا | اصلاح |
|---|---|---|
| `src/renderer/src/pages/CreditManagement.tsx` | TS2300 Duplicate identifier 'CreditOp' | `type CreditOp` از ایمپورت خط ۱۷ حذف شد |
| همان فایل، `Detail` | TS2552 Cannot find name 'CREDIT_OP' (۳ مورد) | به `CreditOp` اصلاح شد |
| `src/main/services/accountingReport.ts` | TS2322 نبودِ `cardToCardPending` / `exchangeCardToCardPending` در `ReturnTotals` | هر دو عضو اضافه و **پر** شدند، عیناً مثل `calculateReturnTotals` |
| `src/renderer/src/pages/SalesReports.tsx` | TS2739 `emptyTotals()` پنج عضو جلسه ۱۴ را کم داشت | پنج عضو اضافه شد |

دو مورد آخر **میراث بازطراحی گزارشات فروش/بستن صندوق**اند و ربطی به ماژول
اعتبار ندارند؛ فقط چون جلوی build کامل را می‌گرفتند در همین گذر تمیز شدند.

## ۲) چاپ/PDF در UI (`CreditManagement.tsx`)
`printOne` / `printBatch` / `savePdf` / `openPreview` ⇒ چهار کانال آماده‌ی جلسه
۲۱ (`printCredit`, `printCreditBatch`, `creditPdf`, `creditPreviewHtml`).
جزئیات: چاپ سند + پیش‌نمایش (iframe/srcDoc، الگوی `Settings.tsx`) + PDF +
شمارنده‌ی چاپ و هشدار «نسخه‌ی مجدد» از `printCount`.
دسته‌ها: «چاپ دسته‌ای» با `batchId` ⇒ یک PDF/Job چندصفحه‌ای.
فهرست: چک‌باکس هر ردیف + انتخاب همه + «چاپ گروهی/PDF انتخاب‌شده‌ها» با `ids`.
هیچ قاعده‌ی تازه‌ای ساخته نشد؛ `creditUi.ts` و سرویس main دست نخوردند.

## ۳) تب تازه‌ی «مدیریت اعتبار خرید» در `SalesReports.tsx`
کامپوننت مستقل `CreditManagementReport` (الگوی جلسه ۱۸) پشت
`ManagerGate(PANEL_KEYS.creditManagement)`، روی `CH.creditDashboard` +
`CH.creditList`، با فیلتر مستقل و خروجی اکسل از `CREDIT_LIST_HEADERS` /
`creditListRow`. تب legacy `storeCredits` دست‌نخورده.

## ۴) تست
۱۱۰ مورد آفلاین ماژول اعتبار: PASS واقعی (۳۴ + ۴۴ + ۳۲).
`acceptance-session14.mjs`: ۲۲ PASS · ۲ FAIL — **از قبل** و هر دو assertion
کهنه (`resolvePeriod` تغییر نام داده · `updateMany` عمداً سخت‌گیرانه‌تر شده).
