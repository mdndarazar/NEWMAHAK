/**
 * نشست ۱۸۱ · S181-D1 — خوشه M، مرحله ۲: سریال‌سازی امن BigInt
 *
 * چه چیزی را اثبات می‌کند؟
 *   ۱) بدون پچ، `JSON.stringify` روی BigInt استثنا می‌دهد (پایه‌ی مسئله).
 *   ۲) بعد از بارگذاری `@shared/bigintJson`، همان فراخوان به رشته‌ی ده‌دهی
 *      تبدیل می‌شود، **بدون از دست رفتن دقت** حتی بالای MAX_SAFE_INTEGER.
 *   ۳) خروجی داده‌های بدون BigInt بایت‌به‌بایت مثل قبل می‌ماند (بدون رگرسیون).
 *   ۴) مسیر واقعی `audit()` با مبلغ BigInt دیگر بی‌صدا از بین نمی‌رود و ردیف
 *      AuditLog با مقدار درست نوشته می‌شود — این همان «مدرک ضدسرقت» است.
 *
 * اجرای قبل از رفع: بررسی‌های ۲ و ۴ باید FAIL بدهند.
 */
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// دیتابیس واقعیِ هارنس (همان الگوی بقیه‌ی تست‌های این پوشه) — برای بخش ۶
const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s181-bigint-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  try {
    assert.deepStrictEqual(got, want)
    console.log(`  ✓ ${name}`)
    pass++
  } catch {
    console.log(`  ✗ ${name} · دریافت ${JSON.stringify(String(got))} · انتظار ${JSON.stringify(String(want))}`)
    fail++
  }
}
const ok = (name, cond) => eq(name, !!cond, true)
/**
 * `JSON.stringify` امن برای خودِ تست: در حالت «قبل از رفع» استثنا می‌دهد و
 * نباید اجرای بقیه‌ی بررسی‌ها را قطع کند (وگرنه گزارش قبل/بعد ناقص می‌شود).
 */
const tryJson = (value, space) => {
  try {
    return JSON.stringify(value, undefined, space)
  } catch (e) {
    return `THREW: ${String(e?.message ?? e)}`
  }
}

// ---------------------------------------------------------------------------
console.log('\n— ۱) رفتار پایه‌ی جاوااسکریپت (بدون پچ) —')
// این بررسی عمداً *قبل* از import ماژول انجام می‌شود.
{
  const proto = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON')
  ok('در شروع تست هیچ toJSON روی BigInt.prototype نیست', proto === undefined)

  let threw = false
  try {
    JSON.stringify({ grandTotal: 1000n })
  } catch (e) {
    threw = e instanceof TypeError && /BigInt/i.test(String(e.message))
  }
  ok('JSON.stringify روی BigInt استثنای TypeError می‌دهد (مسئله‌ی اصلی)', threw)
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) بعد از نصب پچ —')
const { jsonSafe, bigIntReplacer, installBigIntJson } = await import('../../src/shared/bigintJson.ts')

{
  let threw = false
  let out = null
  try {
    out = JSON.stringify({ grandTotal: 1000n })
  } catch {
    threw = true
  }
  ok('JSON.stringify دیگر استثنا نمی‌دهد', !threw)
  eq('BigInt به رشته‌ی ده‌دهی سریال می‌شود', out, '{"grandTotal":"1000"}')
}

{
  // مبلغ ریالیِ بزرگ‌تر از Number.MAX_SAFE_INTEGER — دقیقاً دلیل رفتن سراغ BigInt
  const huge = 9007199254740993n // = MAX_SAFE_INTEGER + 2
  eq('مبلغ بالای MAX_SAFE_INTEGER بدون از دست رفتن دقت', tryJson({ v: huge }), '{"v":"9007199254740993"}')
  // اثبات اینکه انتخاب «رشته به‌جای Number» لازم بوده:
  ok('اگر با Number سریال می‌شد، عدد غلط می‌شد', String(Number(huge)) !== huge.toString())
}

eq('مقدار منفی هم درست سریال می‌شود', tryJson({ v: -250000n }), '{"v":"-250000"}')
eq('صفر BigInt', tryJson({ v: 0n }), '{"v":"0"}')
eq('BigInt تودرتو داخل آرایه', tryJson({ rows: [{ amount: 5n }, { amount: 7n }] }), '{"rows":[{"amount":"5"},{"amount":"7"}]}')

// ---------------------------------------------------------------------------
console.log('\n— ۳) نبودِ رگرسیون روی داده‌ی بدون BigInt —')
{
  const sample = {
    action: 'VOID',
    entity: 'SaleReturn',
    entityId: 12,
    userId: null,
    total: 1000000,
    ratio: 0.5,
    flag: true,
    name: 'کالای تستی',
    nested: { list: [1, 2, 3], nothing: null }
  }
  // مقدار مرجع، دستی نوشته شده (نه با همان تابع) تا تست خودش را تأیید نکند
  const expected =
    '{"action":"VOID","entity":"SaleReturn","entityId":12,"userId":null,"total":1000000,' +
    '"ratio":0.5,"flag":true,"name":"کالای تستی","nested":{"list":[1,2,3],"nothing":null}}'
  eq('خروجی داده‌ی معمولی بایت‌به‌بایت تغییر نکرده', tryJson(sample), expected)
  eq('jsonSafe همان خروجی JSON.stringify را می‌دهد', (() => { try { return jsonSafe(sample) } catch (e) { return `THREW: ${e?.message}` } })(), expected)
  eq('space مثل اصل پشتیبانی می‌شود', (() => { try { return jsonSafe({ a: 1n }, 2) } catch (e) { return `THREW: ${e?.message}` } })(), '{\n  "a": "1"\n}')
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) replacer صریح، مستقل از پچ prototype —')
{
  eq('bigIntReplacer مقدار BigInt را رشته می‌کند', bigIntReplacer('amount', 42n), '42')
  eq('bigIntReplacer بقیه را دست نمی‌زند', bigIntReplacer('qty', 3), 3)
  eq('bigIntReplacer روی null', bigIntReplacer('x', null), null)
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) idempotent بودن نصب —')
{
  const first = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON')?.value
  installBigIntJson()
  installBigIntJson()
  const second = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON')?.value
  ok('نصب دوباره تابع را بازنویسی نمی‌کند', first === second)
  ok('toJSON غیرقابل شمارش است (در for..in و Object.keys دیده نمی‌شود)',
    Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON')?.enumerable === false)
}

// ---------------------------------------------------------------------------
console.log('\n— ۶) مسیر واقعی audit() با مبلغ BigInt —')
{
  const { prisma } = await import('../../src/main/db/client.ts')
  const { audit } = await import('../../src/main/services/AuditService.ts')

  const before = await prisma.auditLog.count()
  await audit(prisma, {
    action: 'VOID',
    entity: 'SaleInvoice',
    entityId: 4242,
    userId: null,
    // دقیقاً همان شکلی که بعد از مهاجرت BigInt از Prisma برمی‌گردد
    before: tryJson({ grandTotal: 1500000n, paidTotal: 500000n }),
    after: tryJson({ grandTotal: 0n, voided: true }),
    note: 'تست S181 — ابطال با مبالغ BigInt'
  })
  const after = await prisma.auditLog.count()
  eq('ردیف Audit واقعاً نوشته شد (قبلاً fail-open بی‌صدا رد می‌شد)', after - before, 1)

  const row = await prisma.auditLog.findFirst({
    where: { entity: 'SaleInvoice', entityId: 4242 },
    orderBy: { id: 'desc' }
  })
  ok('ردیف پیدا شد', !!row)
  eq('مقدار before با مبلغ درست ثبت شده', row?.before, '{"grandTotal":"1500000","paidTotal":"500000"}')
  eq('مقدار after با مبلغ درست ثبت شده', row?.after, '{"grandTotal":"0","voided":true}')
}

// ---------------------------------------------------------------------------
console.log('\n— ۷) زنجیره‌ی import جانبی (بدون import صریح ماژول) —')
/**
 * جهش M5 نشست ۱۸۱ نشان داد بخش‌های بالا این را *نمی‌سنجند*: چون خودِ تست
 * `@shared/bigintJson` را مستقیم import می‌کند، پچ در هر حالتی نصب است. پس
 * حذف `import '@shared/bigintJson'` از AuditService بی‌صدا از تست رد می‌شد.
 *
 * این بخش در یک **پروسه‌ی جدا** فقط و فقط ماژول هدف را بار می‌کند و می‌پرسد
 * آیا پچ نصب شده. یعنی واقعاً همان چیزی را می‌سنجد که در برنامه اتفاق می‌افتد.
 */
{
  const { execFileSync } = await import('node:child_process')
  const probe = (moduleSpecifier) => {
    const code =
      `await import(${JSON.stringify(moduleSpecifier)});` +
      `const d = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON');` +
      `process.stdout.write(typeof d?.value === 'function' ? 'INSTALLED' : 'MISSING')`
    try {
      return execFileSync(
        process.execPath,
        ['--experimental-sqlite', '--no-warnings', '--import', './test/harness/register.mjs', '--input-type=module', '--eval', code],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
      ).trim()
    } catch (e) {
      return `ERROR: ${String(e?.message ?? e).split('\n')[0]}`
    }
  }

  eq('بار کردن تنهای AuditService پچ را نصب می‌کند', probe('./src/main/services/AuditService.ts'), 'INSTALLED')
  eq('بار کردن تنهای db/client پچ را نصب می‌کند', probe('./src/main/db/client.ts'), 'INSTALLED')

  /**
   * صداقت درباره‌ی حدِ این سنجش (جهش M5' نشست ۱۸۱):
   * `AuditService` خودش `../db/client` را import می‌کند، پس پچ به‌صورت *گذرا*
   * نصب می‌شود و probe بالا با حذف importِ مستقیمِ AuditService هم سبز می‌ماند.
   * آن import عمدی و «دفاع در عمق» است: اگر روزی مسیری `db/client` را جایگزین
   * یا mock کند، ۱۵۶ نقطه‌ی audit نباید بی‌محافظ بمانند. چون رفتار قابل
   * تفکیک نیست، قرارداد متنی سنجیده می‌شود.
   */
  const { readFileSync } = await import('node:fs')
  ok('AuditService خودش هم import جانبی صریح دارد (دفاع در عمق)',
    /import\s+['"]@shared\/bigintJson['"]/.test(readFileSync('src/main/services/AuditService.ts', 'utf-8')))
  ok('db/client هم import جانبی صریح دارد',
    /import\s+['"]@shared\/bigintJson['"]/.test(readFileSync('src/main/db/client.ts', 'utf-8')))
}

// ---------------------------------------------------------------------------
console.log('\n— ۸) قرارداد: نقطه‌ی ورود main هم پچ را بار می‌کند —')
{
  // `src/main/index.ts` عوارض جانبی سنگین دارد (پنجره، migration)، پس به‌جای
  // بارکردن، قرارداد متنی سنجیده می‌شود.
  const { readFileSync } = await import('node:fs')
  const entry = readFileSync('src/main/index.ts', 'utf-8')
  ok("src/main/index.ts ماژول bigintJson را import می‌کند", /import\s+['"]@shared\/bigintJson['"]/.test(entry))
  ok('این import قبل از import الکترون است',
    entry.indexOf("@shared/bigintJson") < entry.indexOf("from 'electron'"))
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
