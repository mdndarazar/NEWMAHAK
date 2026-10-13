# نشست ۳۱۸ · فاز ۰ — شناسایی «مدخل تشخیص پل تطبیق» (طرح برنده: کامیلا)

این سند ثبت می‌کند که نقاط اتصال طرح قبل از هر تغییری تأیید شدند، و دو
انحرافِ اجباری از طرح را مستند می‌کند (تا فازهای بعدی از آن پیروی کنند، نه
از متن طرح).

## ۱) نقاط اتصال تأییدشده (خطوط از همین کد)

| # | موضوع | محل تأییدشده | وضعیت |
|---|---|---|---|
| R1 | معادله‌ی پل: **۱۸ ردیف** علامت‌دار، `explainedTotal = Σ sign×amount`، `unexplained = target − explainedTotal`، `target = netAccrualSales` | `src/shared/accounting.ts:1030` (`calculateReconciliationBridge`) | دست‌نخورده — گارد sha256 |
| R2 | ورودی‌های پل + `HINTS` هر ردیف + ساخت هشدار «پل تطبیق بسته نشد: |ریال| …» | `src/main/services/accountingReport.ts:1868` (بلوک `const bridgeRaw = calculateReconciliationBridge({ … })`) · `:1906` (HINTS) · `:1999-2004` (هشدار) | دست‌نخورده — گارد sha256 |
| R3 | drill-in: `bridgeSources(scope, key, skip, take)` + `bridgeDrillPager` | `accountingReport.ts:1406` · `src/shared/reportExtraOutput.ts:120` | بازاستفاده‌ی کامل |
| R4 | هشدار **دو بار** رندر می‌شود: باکس مستقل ⚠ در صفحه و بلوک «هشدارهای گزارش» | `src/renderer/src/pages/SalesReports.tsx:2416-2423` · `src/renderer/src/components/AccountingBlocks.tsx:162-166` | نقطه‌ی ورود تشخیص باید **یک دکمه** باشد (جذب از طرح دوم) |
| R5 | کانال‌های گزارش در main **گیت ندارند**: `saleReportSummary` / `saleReportRows` / `saleReportByShift` / `saleReportItems` | `src/main/ipc/index.ts:721-724` | ریسکِ از‌پیش‌موجود (خارج از دامنه — گزارش در بخش ۳) |
| R6 | `withDrillDown` / `bridgeSourceKey` / `bridgeSourceSkip` / `bridgeSourceTake` مستقیم از payload فیلتر خوانده می‌شوند | `src/main/services/SalesService.ts:4886-4890` | همان مسیر برای drill (بین‌طباق) بازاستفاده می‌شود؛ ورودی مودال سفت پاک‌سازی می‌شود |
| R7 | `assertPanelPasswordStrict(panel, password, action)` موجود؛ با قفل‌خاموش هم همیشه رمز می‌خواهد | `src/main/services/AuthService.ts:632-645` | گیت تشخیص Strict است |
| R8 | `assertPanelUnlocked` با قفل‌خاموش بی‌صدا عبور می‌دهد | `src/main/services/panelSession.ts:98` | برای کانال‌های بعدی تابع **جدید** `assertPanelUnlockedStrict` اضافه می‌شود (قبلی دست نمی‌خورد) |
| R9 | نشست پنل: `PANEL_SESSION_TTL_MS = 5دقیقه`، `applyPanelSessionTtlMinutes/Ms`، `panelSessionTtlMs`، `notePanelUnlocked`، `isPanelUnlocked`، `clearPanelSessions` | `panelSession.ts:32-98` | بازاستفاده |
| R10 | AuditService: `audit` (fail-open) :76, `auditOrThrow` (fail-closed) :116, `auditMany` :53؛ `action` رشته‌ی آزاد است (`AuditInput.action: string`) | `src/main/services/AuditService.ts` · `AuditAction` فقط مجموعه‌ی نام‌های شناخته‌شده است (`src/shared/enums.ts:545`)، نه enum سخت‌گیر | actionهای `BRIDGE_DIAG_*` تازه با FraudService تداخل ندارند — هیچ `BRIDGE` actionی در `src` نیست (جست‌وجوی کامل) |
| R11 | قرارداد کلید پنل: `PANEL_KEYS` + ردیف `LOCKED_PANELS` (عنوان+یک خط) + `ManagerGate` + تست سه‌حالته؛ تنظیمات رمز خودکار ردیف را نشان می‌دهد | `src/shared/panels.ts:1-45` (توضیح چهار قدم) · `:219` (LOCKED_PANELS) | کلید جدید: `bridgeDiagnostics: 'bridge-diagnostics'` |
| R12 | `SaleReportFilter`: فیلدهای مجاز از `types.ts:721-770` (fromJalali, toJalali, from, to, shiftId, shiftNumber, userId, customerId, status, orderType, receiptNo, returnCode, customerSearch, productSearch, onlyNotConsolidated, invoiceIds, channels, take, skip, withDrillDown, bridgeSourceKey/Skip/Take) | `src/shared/types.ts` | `cleanFilter` فقط همین‌ها را کپی می‌کند؛ هر کلید دیگر دور ریخته می‌شود |
| R13 | `reportRows` خروجی `{ rows, totals, groups, accounting, page, warnings }` دارد | `SalesService.ts:4805` و بازگشت `:5074-5088` | نمای تشخیصی از **reportRows** تغذیه می‌شود (نه summary — بخش ۲) |

## ۲) دو انحراف اجباری از متنِ طرح (مستند برای فازهای بعدی)

**انحراف اول — مسیر داده‌ی نما `reportRows` است، نه `summary`.**
طرح می‌گفت «نما مستقیم `salesService.summary` را صدا می‌زند». در کد، `summary`
(:5234) فقط تعداد/جمع‌ها/rows را برمی‌گرداند و اصلاً `accounting`/bridge ندارد؛
پل فقط در `reportRows` (که همان را هم صدا می‌زند) می‌آید. نمای تشخیصی در فاز ۲
`salesService.reportRows(cleanFilter)` را صدا می‌زند و فقط
`accounting.bridge`/`period`/`warnings` را بیرون می‌کشد. با این حال «بنا به
ساختار همان اعداد» حفظ می‌شود چون هر دو به یک نقطه‌ی واحد متصل‌اند.

**انحراف دوم — تصحیح تصریحِ «actor فقط از نشست main».**
`withSessionActor` (در `src/main/ipc/index.ts:165`) خودش از
`shiftService.currentStaffId()` می‌خواند. یعنی همان کارمندِ پشت صندوق در لحظه‌ی
عمل ثبت می‌شود نه «کاربر رندرر» — در عمل دو طرح به یک نتیجه می‌رسیدند. قاعده‌ی
باقی‌مانده تحت هر دو خوانش همسوست: هیچ userId از payload برنامه‌نویس (به‌ویژه
رندرر) پذیرفته نمی‌شود (تست‌های فاز ۲ payload مسموم را اندازه‌گیری می‌کنند).

## ۳) ریسک‌های خارج از دامنه که باید بمانند

- R5 (گیت‌نداشتن کانال‌های گزارش) **مدت‌هاست وجود دارد**؛ این طرح آن را بدتر
  نمی‌کند اما با ساختِنمایِ گیت‌دار («تشخیص») دید بهتری به مدیر می‌دهد. پیشنهاد
  همان D6 است: «نشست امنیتی جدا» برای گیت‌دار کردن گزارشات فروش.
- عدد خود هشدار («بدون توضیح مانده است») برای فروشنده دیده می‌ماند — تصمیم D1
  «ماسک نه» (بلوک ۷ همان را نشان می‌دهد و هشدارِ متن‌باز بخشی از خروجی گزارش
  است). راه واقعی «قفل پنل گزارشات فروش» است.

## ۴) baseline ثبت‌شده (فایل‌های نگه‌داشت)

- `tests/audit-fixes/golden/bridge-baseline-s318.json` — sha256 سه برش
  متنِ مبغوه (`equation`/`hints`/`bridgeInputBlock`) + طول هر برش.
- `tests/audit-fixes/golden/bridge-summary-s318.json` — خروجی گزارش روی سه
  فیکسچر روز-ثابت (1405/06/01 پل‌بسته، 1405/06/05 با پرداختِ پس‌تاریخ‌شده به
  1405/06/04 ⇒ `unexplained=+100000`، 1405/06/10 با اضافه‌دریافتِ بدون ردیابی
  ⇒ `unexplained=−50000`).
- `tests/audit-fixes/_lib-bridge-golden-s318.mjs` — برش/هش/فیکسچرها (عمومی
  برای بازتولید و تست).
- `tests/audit-fixes/_regen-bridge-golden-s318.mjs` — بازتولید golden با دستور.
- `tests/audit-fixes/fix-s318-0-bridge-baseline.mjs` — گاردِ مقایسه (۱۰ چک).

## ۵) جمع‌بندی فاز ۰

- فرضیه‌های بخش ۱ طرح (الف/ب/ج) از دید کد قابل تشکیل‌اند؛ همه‌ی سه حالت معیار
  (بسته/مثبت/منفی) با فیکسچر تولید و قفل شد.
- هیچ تغییری در `src` انجام نشد (گارد خودِ تست این را تأیید می‌کند چون baseline
  با محتوای فعلی کاملاً سازگار است).
- کم‌خطر بودن «یادداشت مدیر» روی AuditLog تأیید شد (بدون migration).
