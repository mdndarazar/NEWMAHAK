# نشست ۱۸۰ — گام ۰ واقعی + پاک‌سازی baseline تایپ (پیش‌نیاز خوشه M)

## خلاصه در یک خط
برای اولین بار در زنجیره، **گام ۰ پرامپت واقعاً اجرا شد** (`npm install` + `prisma generate` + `typecheck`)، و ۶۶ خطای typecheck که ۱۷۹ نشست قبلی هرگز ندیده بودند به **صفر** رسید — بدون هیچ رگرسیونی.

---

## گام ۰ (بند ۲ پرامپت) — اجرا شد

| دستور | نتیجه |
|---|---|
| `npm install` | ✅ added 555 packages in 46s |
| `npx prisma generate` | ✅ Generated Prisma Client (v5.22.0) in 412ms |
| `npm run typecheck` | ❌ **۶۶ خطا** (قبل) → ✅ **۰ خطا** (بعد) |

لاگ کامل خطاهای اولیه: `TYPECHECK-baseline-gam0.txt`

### نکته‌ی محیطی مهم برای نشست‌های بعد
هارنس `test/harness/` به دو چیز نیاز دارد که تا الان مستند نشده بود:
1. **Node ≥ 22.18** — چون هیچ `load` hook برای ترنسپایل `.ts` وجود ندارد و به type-stripping داخلی Node تکیه می‌کند. با Node 20 یا حتی 22.11 کل ۱۶۸ تست با `ERR_UNKNOWN_FILE_EXTENSION` می‌افتند.
2. **`--experimental-sqlite`** — `prismaLite.mjs` از `node:sqlite` استفاده می‌کند.

دستور درست اجرا:
```bash
export NODE_OPTIONS="--experimental-sqlite --no-warnings"   # با Node 22.20
bash tools/run-regression.sh <repo> <out> 4
```

---

## رفع‌ها

### S180-D1 · اعلان تایپ کتابخانه‌های بدون تایپ
- **فایل**: `src/types/vendor.d.ts` (جدید)، `tsconfig.json`
- **قبل**: `jalaali-js` هیچ `.d.ts` نداشت (TS7016)؛ `bwip-js` به‌خاطر نبود شرط `default` در exports map و نبود `customConditions` در tsconfig اصلاً resolve نمی‌شد (TS2307).
- **بعد**: اعلان دقیق `jalaali-js` از روی کاربرد واقعی؛ `bwip-js` با `paths` به `dist/bwip-js-node.d.ts` (تایپ واقعی، نه ambient) وصل شد.
- **ریسک زمان اجرا**: صفر (`paths` فقط روی typecheck اثر دارد؛ باندل با electron-vite alias جدا دارد).

### S180-D2 · `as const` روی orderBy — ریشه‌ی ۲۴ خطا
- **فایل**: `src/main/services/SalesLedger.ts` (دو کوئری: `invoiceQuery`، `returnsQuery`)
- **قبل**: `orderBy: [...] as const` یک تاپل readonly می‌ساخت که به آرگومان `findMany` اسایْن نمی‌شد (TS2345). TypeScript در نتیجه کل نتیجه را به تایپ پیش‌فرض (بدون `select`) برمی‌گرداند و ۲۲ خطای آبشاری «`payments`/`items`/`customer`/`user`/`shift` وجود ندارد» می‌ساخت.
- **بعد**: `satisfies Prisma.SaleInvoiceFindManyArgs` / `satisfies Prisma.SaleReturnFindManyArgs` — هم literalهای `'asc'` حفظ می‌شوند، هم شکل آرگومان همان‌جا اعتبارسنجی می‌شود.
- **اثر**: ۲۴ → ۰ خطا با یک رفع ریشه‌ای.

### S180-D3 · `readAll` بدون استنتاج تایپ
- **فایل**: `src/main/services/PendingRestockService.ts`
- **قبل**: `client: any` ⇒ `findMany` تایپ `any` ⇒ `readAll<T>` نمی‌توانست `T` را استنتاج کند ⇒ `unknown[]` و ۱۰ خطای TS18046 روی `r`.
- **بعد**: تایپ صریح `PendingReturnRow` دقیقاً مطابق `include` کوئری و schema (`qty`/`restockedQty` هر دو `Int` غیرنال).

### S180-D4 · null-safety نگاشت‌های برگشت
- **فایل**: `src/main/services/StaffReportService.ts`
- **قبل**: `SaleReturn.userId/shiftId` در schema nullable اند، ولی همه‌ی مصرف‌کننده‌ها `map.get(r.shiftId)` می‌زدند (۸ خطای TS2345).
- **بعد**: دو helper `userOf()`/`shiftOf()` که `null` را می‌پذیرند و `undefined` می‌دهند — دقیقاً همان مسیر fallback «—»/«نامشخص» قبلی.

### ⚠️ S180-D5 · ایراد واقعی: `userId` گمشده در select
- **فایل**: `src/main/services/StaffReportService.ts` (بخش «تراکنش‌های کارمند»)
- **قبل**: از سه `prisma.saleReturn.findMany` این فایل، دو تا `userId: true` را انتخاب می‌کنند و **این یکی نمی‌کرد** — ولی نتیجه‌اش به `returnLookups()` داده می‌شد که روی `r.userId` نگاشت می‌زند. نتیجه: `userIds` همیشه خالی، lookup کاربر همیشه بی‌اثر.
- **بعد**: `userId: true` اضافه شد؛ قرارداد تابع برآورده می‌شود.
- **اثر عددی فعلی**: این بخش خروجی `userName` برای ردیف‌های برگشت تولید نمی‌کند (برخلاف ردیف‌های فاکتور)، پس عدد غلطی روی صفحه دیده نمی‌شد؛ ولی هر مصرف‌کننده‌ی بعدیِ `returnMaps.userOf()` در این بخش بی‌صدا «نامشخص» می‌گرفت.
- **مشاهده‌ی باز (خارج از دامنه‌ی این رفع)**: عدم‌تقارن «ردیف فاکتور `userName` دارد، ردیف برگشت ندارد» در همین بخش باقی است. افزودنش تغییر قرارداد UI است و باید تصمیم مالک بگیرد.

### S180-D6 · allowlist تنظیمات typecheck نمی‌شد
- **فایل**: `src/main/ipc/index.ts`
- **قبل**: `RAW_SETTING_SAFE_KEYS`/`RAW_SETTING_MANAGER_KEYS` بدون تایپ صریح، `Set` از literalها می‌شدند ⇒ `has(key: string)` خطای TS2345 می‌داد ⇒ همان allowlist امنیتی خوشه H عملاً بررسی تایپی نمی‌شد.
- **بعد**: `new Set<string>([...])`. همان مقادیر، همان رفتار.

### S180-D7 · `Awaited<ReturnType<typeof findMany>>` غلط
- **فایل‌ها**: `InventoryService.ts`، `StoreCreditService.ts`
- **قبل**: این الگو به تایپ *کاملِ* مدل حل می‌شد، نه شکل `select`؛ پس `v.product` وجود نداشت (TS2551) و `push` هم رد می‌شد.
- **بعد**: تایپ صریح دقیقاً مطابق ستون‌های انتخاب‌شده. حلقه‌ی ترتیبی (نه `Promise.all`) عمداً دست‌نخورده ماند تا رفتار همزمانی عوض نشود.

### S180-D8 · آرایه‌های `any[]` در SalesService
- **فایل**: `src/main/services/SalesService.ts` (`exchangeInvoices`، `invoices` در `creditList`)
- **بعد**: `Prisma.SaleInvoiceGetPayload<{ include: ... }>` دقیقاً از روی `include` همان کوئری.

### S180-D9 · false-positive narrowing روی `stage`
- **فایل**: `src/main/services/SalesService.ts` (ابطال سند برگشت/تعویض)
- **تشخیص**: `stage = 'effects'` داخل callback تراکنش نوشته می‌شود، پس control-flow analysis در `catch` همچنان `'validate'` می‌بیند (TS2367). **این باگ زمان اجرا نیست** — مسیر «مورد رسیدگی مدیر» بند ۴-۲۲ درست کار می‌کرده.
- **بعد**: `stageOf()` فقط narrowing را باز می‌کند. (قرینه‌اش `reviewCtx` بود که نویسنده‌ی قبلی همان‌جا با cast دستی حل کرده بود.)

### S180-D10 · امضای `reportShiftNumber`
- **قبل**: `Pick<SaleReportFilter,'shiftNumber'>` یعنی فقط `number | null`، ولی بدنه عمداً `as unknown` + `Number(raw)` می‌زند چون فیلترهای IPC رشته هم می‌فرستند و یک صداکننده دقیقاً `string | number | null` می‌داد.
- **بعد**: امضا با رفتار واقعی هم‌تراز شد. اعتبارسنجی و پیام خطای فارسی دست‌نخورده.

### S180-D11 · `.map(shapeSaleRow)`
- **فایل**: `src/main/services/ShiftService.ts`
- **قبل**: `Array.map` آرگومان دوم (index عددی) را به `opts?: ShapeSaleRowOptions` پاس می‌داد. زمان اجرا بی‌خطر بود، ولی هر گزینه‌ای که بعداً به `ShapeSaleRowOptions` اضافه می‌شد بی‌صدا از index خوانده می‌شد.
- **بعد**: `.map((inv) => shapeSaleRow(inv))`.

### S180-D12 · cast آرایه‌ی `PagedRows`
- `[] as PagedRows<ShiftInfo>` → `[] as unknown as PagedRows<ShiftInfo>` (همان پیشنهاد خود کامپایلر). الگوی «آرایه + ست‌کردن `page`/`warnings` بعدی» حفظ شد.

### S180-D13 · `result.page` اختیاری در reportLimits
- **فایل**: `src/main/services/reportLimits.ts`
- **بعد**: `result.page?.totalCount ?? result.rows.length`.
- **دلیل انتخاب fallback**: صفر یعنی «هیچ ردیفی نیست» و می‌توانست یک برش واقعی را پنهان کند — خلاف معیار مالک. `rows.length` حداقل دروغ نمی‌گوید.

---

## تست‌های قراردادی به‌روزشده (طبق رویه‌ی نشست ۱۷۷)

سه تست با regex روی *متن* کد assert می‌کردند و rename/annotation آن‌ها را شکست. معنای هر سه قرارداد دست‌نخورده است:

| تست | تغییر regex | دلیل |
|---|---|---|
| `fix-s88-staff-report-integrity.mjs` | `users\.get` → `(users\.get\|userOf)` | S180-D4 |
| `fix-s104-report-scale-followups.mjs` | `readAll\(` → `readAll(?:<\w+>)?\(` | S180-D3 |
| `fix-s105-report-limits-filter-propagation.mjs` | `page\.totalCount` → `page\??\.totalCount` + پنجره ۳۰۰→۷۰۰ | S180-D13 |

---

## رگرسیون نهایی

```
npm run typecheck          ✅ ۰ خطا   (قبل: ۶۶)
tests/audit-fixes          167/168 PASS
test/*.mjs (legacy)         17/17  PASS
tests/audit                 84/84  PASS
esbuild syntax             144 OK · 0 FAIL
```

**تنها شکست**: `fix-s130-a4-layout.mjs` — `ERR_MODULE_NOT_FOUND` برای `playwright` با مسیر hardcode‌شده‌ی `/opt/sd-artifact/node_modules/playwright`. روی نسخه‌ی **دست‌نخورده‌ی HEAD هم دقیقاً همین شکست را دارد** (تأیید شد)؛ مشکل محیطی است، نه رگرسیون.

فایل لاگ: `TESTLOG-s180-after.txt` + پوشه‌ی `TESTLOG-s180-after.logs/`

---

## فایل‌های تغییریافته

| فایل | خلاصه |
|---|---|
| `src/types/vendor.d.ts` | **جدید** — اعلان تایپ `jalaali-js` |
| `tsconfig.json` | مسیر تایپ `bwip-js` |
| `src/main/ipc/index.ts` | `Set<string>` برای allowlist تنظیمات |
| `src/main/services/SalesLedger.ts` | `satisfies` روی دو کوئری (ریشه‌ی ۲۴ خطا) |
| `src/main/services/PendingRestockService.ts` | تایپ `PendingReturnRow` |
| `src/main/services/StaffReportService.ts` | helperهای null-safe + **`userId: true` گمشده** |
| `src/main/services/SalesService.ts` | تایپ payload دو آرایه، `stageOf()`، امضای `reportShiftNumber` |
| `src/main/services/InventoryService.ts` | تایپ صریح شکل `select` |
| `src/main/services/StoreCreditService.ts` | تایپ صریح + null-guard در `filter` |
| `src/main/services/ShiftService.ts` | `map` صریح + cast `PagedRows` |
| `src/main/services/reportLimits.ts` | `page?.totalCount` با fallback امن |

patchها: `mahak-session180-fix.patch` (src + tsconfig) و `mahak-session180-tests.patch` (tests) — هر دو روی HEAD تمیز apply می‌شوند (`git apply --check` تأیید شد).

---

## وضعیت خوشه‌ها بعد از این نشست

بدون تغییر نسبت به ۱۰-۱۵۲، به‌علاوه:
- **گام ۰: ✅ برای اولین بار اجرا شد** — بدهی باز ۱۷۹ نشست بسته شد.
- **خوشه M: همچنان ⚠️ نیمه‌کاره.** `BigInt` هنوز انجام نشده (۰ مورد در schema، ۷۹ فیلد مالی `Int`).

## نقطه‌ی دقیق شروع نشست ۱۸۱ — مرحله ۲ خوشه M

پیش‌نیاز (baseline سبز) حالا برقرار است. ترتیب پیشنهادی:

1. **زیرساخت سریال‌سازی، قبل از هر تغییر schema.** `JSON.stringify(BigInt)` استثنا پرتاب می‌کند. در `src/main` **۱۸۷** فراخوان `JSON.stringify` هست که **۱۵۶** تای آن `before:`/`after:` داخل `audit()` است. لحظه‌ای که `grandTotal` به BigInt تبدیل شود، هر ۱۵۶ مسیر ثبت Audit در زمان اجرا crash می‌کنند — یعنی دقیقاً مدرک ضدسرقتی که هدف مالک است از بین می‌رود. اول یک `safeStringify` با replacer (`typeof v === 'bigint' ? v.toString() : v`) بساز و همه‌ی نقاط را به آن ببر، با تست قبل/بعد.
2. **لایه‌ی IPC.** structured clone خود BigInt را رد می‌کند، ولی هر `JSON.parse(JSON.stringify(...))` در مسیر preload/renderer نه. مسیرها را ممیزی کن.
3. **۴۲ `$queryRaw`/`$executeRaw`**: SQLite با BigInt رفتار متفاوتی دارد؛ هر کدام جدا سنجیده شود.
4. **migration**: ۷۹ فیلد مالی `Int` → `BigInt` + backfill + اجرا روی دیتابیس تازه‌ساخته از کل ۲۷ migration.
5. **۱۱٬۵۰۰ خط محاسبات** در `accounting.ts` + `accountingReport.ts` + `SalesService.ts`: هر `Math.round`/`+`/`>` روی مبالغ باید بازبینی شود (BigInt با number مخلوط نمی‌شود و `Math.*` روی BigInt استثنا می‌دهد).

**آیتم‌های باز دیگر** (بدون تغییر): گیت رمز `BackupService.apply` (نقطه‌ی شروع ثبت‌شده‌ی ۱۸۰ در هندآف قبلی) و ممیزی `MergeService`.

## محدودیت‌هایی که همچنان اجرا نشدند
رندر واقعی Electron/React · migration روی داده‌ی تاریخی مشتری · race چندپردازه‌ای بین دو پنجره · crash/قطع برق وسط تراکنش · timezone غیر Asia/Tehran · حجم ۵۰٬۰۰۰+ ردیف با Prisma واقعی.

**اما**: Prisma Client واقعی و typecheck واقعی دیگر جزو محدودیت‌ها نیستند — هر دو در این نشست اجرا شدند.
