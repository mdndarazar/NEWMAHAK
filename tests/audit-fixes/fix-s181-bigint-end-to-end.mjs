// نشست ۱۸۱: تست قبل/بعد خوشه M بند ۴-۲۸ الف — رفتار سرتاسری بعد از مهاجرت BigInt.
/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف — مرحله ۴ (تطبیق کد)
 *
 * سه مرحله‌ی قبل ثابت کردند که *ستون* و *سریال‌سازی* درست شده‌اند. این تست
 * چیز دیگری را می‌سنجد: آیا **کد** بعد از مهاجرت درست رفتار می‌کند؟
 *
 * قبل از رفع (مرحله ۴): ۱۳۲ خطای typecheck. سه دسته‌ی واقعاً خطرناکشان:
 *   ۱) `Math.round(bigintValue)` ⇒ استثنای زمان اجرا وسط ثبت فروش.
 *   ۲) `number + bigint` ⇒ «Cannot mix BigInt and other types».
 *   ۳) 🔴 `before.salePrice !== v.salePrice` ⇒ **همیشه true**، چون یک طرف
 *      bigint است و دیگری number. یعنی هر ذخیره‌ی کالا «تغییر حساس» شمرده
 *      می‌شد: گیت رمز بی‌دلیل بالا می‌آمد و سابقه‌ی ممیزی پر از «تغییر قیمت»
 *      دروغین می‌شد. این یکی هیچ‌وقت crash نمی‌کرد — بی‌صدا دروغ می‌گفت.
 *
 * انتظار بعد: هر سه رفع شده، مبلغ بزرگ سرتاسر مسیر سالم می‌ماند، و هیچ‌جا
 * دقت **بی‌صدا** از دست نمی‌رود (اگر عددی از محدوده‌ی امن بیرون بزند، خطای
 * صریح می‌گیریم، نه عدد غلط).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s181-bigint-end-to-end.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s181-e2e-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
/**
 * ⚠️ این تست عمداً هارنس را در حالت «وفادار به BigInt» اجرا می‌کند
 * (`test/harness/prismaLite.mjs` را ببینید). بدون این پرچم، هارنس مبالغ را
 * `number` می‌دهد و بخش ۶ اصلاً همان چیزی را نمی‌سنجد که باید.
 */
process.env.HARNESS_BIGINT = '1'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const g = typeof got === 'bigint' ? `${got}n` : JSON.stringify(got)
  const w = typeof want === 'bigint' ? `${want}n` : JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${g} · انتظار ${w}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)
const throws = (label, fn, ctor) => {
  try { fn(); fail++; console.log(`  ✗ ${label} · استثنایی پرتاب نشد`) }
  catch (e) {
    if (ctor && !(e instanceof ctor)) { fail++; console.log(`  ✗ ${label} · ${e?.constructor?.name} به‌جای ${ctor.name}`) }
    else { pass++; console.log(`  ✓ ${label}`) }
  }
}
/** فراخوانی‌ای که نباید استثنا بدهد؛ اگر داد، متنش گزارش می‌شود (نه crash). */
const noThrow = (label, fn) => {
  try { const v = fn(); pass++; console.log(`  ✓ ${label}`); return v }
  catch (e) { fail++; console.log(`  ✗ ${label} · THREW: ${String(e?.message ?? e).split('\n')[0]}`); return undefined }
}

const MAX_SAFE = 9007199254740991n

// ---------------------------------------------------------------------------
console.log('\n— ۱) قالب‌بندی مبلغ: `money()` مقدار BigInt را دقیق چاپ می‌کند —')
{
  const { money } = await import('../../src/shared/jalali.ts')
  eq('مبلغ معمولی مثل قبل', money(1234567, false), '1٬234٬567')
  eq('BigInt همان خروجی number را می‌دهد', money(1234567n, false), money(1234567, false))
  eq('ارقام فارسی هم کار می‌کند', money(1000n), '۱٬۰۰۰')
  eq('صفر', money(0n, false), '0')
  eq('منفی', money(-5000n, false), '-5٬000')
  eq('null مثل قبل صفر', money(null, false), '0')

  /**
   * مهم‌ترین بررسی این بخش: مسیر قدیمی (`Math.round(Number(v))`) این عدد را
   * **بی‌صدا** غلط چاپ می‌کرد. یعنی جمع سالانه روی گزارش، عدد اشتباه بود.
   */
  const huge = 9007199254740993n
  eq('مبلغ بالای MAX_SAFE_INTEGER دقیق چاپ می‌شود', money(huge, false), '9٬007٬199٬254٬740٬993')
  ok('و مسیر قدیمیِ Number() همین را غلط می‌داد', String(Number(huge)) !== huge.toString())
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) موتور حسابداری ردیف Prisma را مستقیم می‌پذیرد —')
{
  const acc = await import('../../src/shared/accounting.ts')

  // همان شکلی که `prisma.saleInvoice.findUnique` بعد از مهاجرت برمی‌گرداند
  const prismaRow = {
    goodsTotal: 1_000_000n,
    discountTotal: 100_000n,
    taxTotal: 90_000n,
    serviceCharge: 0n,
    deliveryFee: 20_000n
  }
  const totals = noThrow('calculateInvoiceTotals با ردیف BigInt استثنا نمی‌دهد', () =>
    acc.calculateInvoiceTotals(prismaRow)
  )
  eq('جمع کل درست است', totals?.grandTotal, 1_010_000)
  eq('خروجی همچنان number است (قرارداد رابط کاربری)', typeof totals?.grandTotal, 'number')

  // و دقیقاً همان نتیجه‌ی ورودی number (اثبات نبود رگرسیون)
  const asNumbers = acc.calculateInvoiceTotals({
    goodsTotal: 1_000_000, discountTotal: 100_000, taxTotal: 90_000, serviceCharge: 0, deliveryFee: 20_000
  })
  eq('ورودی BigInt و number نتیجه‌ی یکسان می‌دهند', JSON.stringify(totals), JSON.stringify(asNumbers))

  eq('درصد تخفیف با ردیف BigInt', acc.invoiceDiscountPercent(prismaRow), 10)
  eq('exchangeRefundPartOf با BigInt', acc.exchangeRefundPartOf({ exchangeDiff: -50_000n, debtReduction: 10_000n }), 40_000)
}

// ---------------------------------------------------------------------------
console.log('\n— ۳) هیچ‌جا دقت بی‌صدا از دست نمی‌رود —')
{
  const acc = await import('../../src/shared/accounting.ts')
  /**
   * این قاعده‌ی مرکزی مرحله ۴ است: اگر مبلغی از محدوده‌ی امن بیرون بزند،
   * برنامه باید **بایستد**، نه اینکه با اطمینان عدد غلط بدهد. یک گزارش که خطا
   * می‌دهد قابل تشخیص است؛ گزارشی که یک رقم را جا انداخته، نیست.
   */
  throws('موتور حسابداری روی مبلغ خارج از محدوده خطا می‌دهد (نه گرد کردن)',
    () => acc.calculateInvoiceTotals({ goodsTotal: MAX_SAFE + 2n }), RangeError)

  const { toNumberRial } = await import('../../src/shared/money.ts')
  throws('toNumberRial هم همین‌طور', () => toNumberRial(MAX_SAFE + 2n), RangeError)
  eq('ولی دقیقاً روی مرز، سالم رد می‌شود', toNumberRial(MAX_SAFE), Number.MAX_SAFE_INTEGER)
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) `accounting.ts` هنوز بدون وابستگی است —')
{
  /**
   * این فایل عمداً هیچ import ای ندارد تا بتواند مستقیم با Node خام اجرا شود
   * (`test/accounting-session13.ts` روی همین حساب می‌کند). در اولین اجرای
   * مرحله ۴ یک import نسبیِ بدون پسوند اضافه شد و آن تست را با
   * `ERR_MODULE_NOT_FOUND` شکست. این بررسی نگذارد دوباره تکرار شود.
   */
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/shared/accounting.ts', 'utf-8')
  const imports = src.split('\n').filter((l) => /^\s*import\s/.test(l))
  eq(`accounting.ts هیچ import ای ندارد${imports.length ? ` (${imports[0].trim()})` : ''}`, imports.length, 0)
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) 🔴 باگ واقعی: مقایسه‌ی قیمت دیگر همیشه‌true نیست —')
{
  /**
   * بازتولید دقیق شکلی که در `ProductService.isSensitiveEdit` می‌شکست:
   * `before` از دیتابیس (bigint) و `v` از فرم (number).
   */
  const { toRial } = await import('../../src/shared/money.ts')
  const before = { salePrice: 50_000n, purchasePrice: 30_000n, stock: 10 }
  const sameFromForm = { salePrice: 50_000, purchasePrice: 30_000, stock: 10 }

  ok('مقایسه‌ی خام (باگ) قیمتِ *یکسان* را «عوض‌شده» می‌دید',
    before.salePrice !== sameFromForm.salePrice)
  ok('با toRial، قیمت یکسان یعنی یکسان',
    toRial(before.salePrice) === toRial(sameFromForm.salePrice))
  ok('و قیمت واقعاً عوض‌شده هنوز تشخیص داده می‌شود',
    toRial(before.salePrice) !== toRial(60_000))

  // و قرارداد خودِ فایل: مقایسه‌ی خام برنگشته باشد
  const { readFileSync } = await import('node:fs')
  const prod = readFileSync('src/main/services/ProductService.ts', 'utf-8')
  ok('ProductService دیگر قیمت‌ها را خام مقایسه نمی‌کند',
    !prod.includes('before.salePrice !== v.salePrice') &&
      !prod.includes('before.purchasePrice !== v.purchasePrice'))
  ok('و مقایسه از toRial می‌گذرد',
    prod.includes('toRial(before.salePrice) !== toRial(v.salePrice)'))
}

// ---------------------------------------------------------------------------
console.log('\n— ۶) مسیر واقعی: ثبت فروش با مبلغ بزرگ، سرتاسر —')
{
  const electron = await import('electron')
  electron.ipcMain.handle = () => {}

  const { prisma } = await import('../../src/main/db/client.ts')
  const { makeSeeder } = await import('../../test/harness/seed.mjs')
  const seed = makeSeeder(prisma)

  // مبلغی که `number` نمی‌تواند دقیق نگه دارد
  const huge = 9007199254740993n
  const invoiceId = seed.insert('SaleInvoice', {
    receiptNo: 9001,
    status: 'FINAL',
    grandTotal: huge,
    paidTotal: huge,
    goodsTotal: huge,
    issuedAtJalali: '۱۴۰۴/۰۷/۰۵'
  })

  const row = await noThrow('خواندن فاکتور با Prisma استثنا نمی‌دهد', () =>
    prisma.saleInvoice.findUnique({ where: { id: invoiceId } })
  )
  const got = row ? (typeof row.grandTotal === 'bigint' ? row.grandTotal : BigInt(row.grandTotal)) : null
  eq('مبلغ از دیتابیس بدون افت دقت برگشت', got, huge)

  // سریال‌سازی برای سابقه‌ی ممیزی (زیرساخت مرحله ۲) روی همین مقدار واقعی
  const json = noThrow('JSON.stringify روی همین ردیف استثنا نمی‌دهد', () =>
    JSON.stringify({ grandTotal: huge, paidTotal: huge })
  )
  eq('و مبلغ در JSON دقیق است', json, '{"grandTotal":"9007199254740993","paidTotal":"9007199254740993"}')

  // و قالب‌بندی نمایشی همان عدد
  const { money } = await import('../../src/shared/jalali.ts')
  eq('نمایش همان مبلغ هم دقیق است', money(huge, false), '9٬007٬199٬254٬740٬993')
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
