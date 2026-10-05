// نشست ۱۸۱: تست قبل/بعد — ممیزی MergeService و MaintenanceService زیر BigInt (بند ۴-۲۸ الف).
/**
 * ===========================================================================
 * نشست ۱۸۱ · کار باز «ممیزی MergeService» + مسیرهای `$queryRaw`
 *
 * قبل از رفع — یک الگوی یکسان در دو فایل، هر دو بی‌صدا:
 *
 *     const n = typeof v === 'bigint' ? Number(v) : Number(v)
 *                                       ^^^^^^^^^   ^^^^^^^^^
 *                                       هر دو شاخه یکی!
 *
 * کسی ternary را نوشته بود تا `bigint` را جدا مدیریت کند، ولی هر دو طرف همان
 * `Number(v)` بودند. تا وقتی ستون‌ها `Int` بودند بی‌ضرر بود. بعد از مهاجرت
 * بند ۴-۲۸ الف، `$queryRawUnsafe` روی ستون `BIGINT` مقدار `bigint` می‌دهد و
 * هر مبلغ بالای `Number.MAX_SAFE_INTEGER` **بی‌صدا** گرد می‌شد:
 *
 *   • `MergeService` — وسط عملیاتی که دفاتر مالی را انبوه می‌نویسد. یعنی
 *     ادغام یک بکاپ می‌توانست فاکتورهایی با مبلغ غلط وارد کند.
 *   • `MaintenanceService` — تنها مصرف‌کننده‌اش `SUM("grandTotal")` روی کل
 *     فاکتورهای قدیمی است؛ مدیر قبل از **پاک کردن همیشگی** داده، ممکن بود
 *     مبلغ غلط ببیند و بر اساس آن تصمیم بگیرد.
 *
 * انتظار بعد: مبالغ در MergeService اصلاً از `bigint` خارج نشوند، و هر جا
 * تبدیل به `number` لازم است، خارج از محدوده‌ی امن **خطا** بدهد نه عدد غلط.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s181-merge-maintenance-bigint.mjs
 * ===========================================================================
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
// ⚠️ خودِ این helper باید BigInt را تاب بیاورد — وگرنه تستی که درباره‌ی BigInt
// است، سر اولین مقدار BigInt با «Do not know how to serialize a BigInt» می‌میرد.
const show = (v) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v))
const eq = (label, got, want) => {
  const g = show(got)
  const w = show(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${g} · انتظار ${w}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)

const MERGE = readFileSync('src/main/services/MergeService.ts', 'utf-8')
const MAINT = readFileSync('src/main/services/MaintenanceService.ts', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۱) الگوی ternary بی‌اثر هیچ‌جای پروژه برنگشته باشد —')
/**
 * این بررسی کل `src/` را می‌گردد، نه فقط دو فایلِ شناخته‌شده. الگوی
 * `typeof x === 'bigint' ? Number(x) : Number(x)` هر بار که نوشته شود یک
 * «مدیریت BigInt» ظاهری می‌سازد که هیچ کاری نمی‌کند — و چون *به‌نظر* درست
 * می‌آید، در بازبینی کد هم رد می‌شود.
 */
{
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p)
    }
  }
  walk('src')
  const bad = []
  const deadTernary = /typeof\s+(\w+)\s*===\s*'bigint'\s*\?\s*Number\(\1\)\s*:\s*Number\(\1\)/
  for (const f of files) {
    const src = readFileSync(f, 'utf-8')
    src.split('\n').forEach((l, i) => {
      if (l.trimStart().startsWith('*') || l.trimStart().startsWith('//')) return // کامنت توضیحی مجاز
      if (deadTernary.test(l)) bad.push(`${f}:${i + 1}`)
    })
  }
  eq(`ternary بی‌اثر BigInt${bad.length ? ` (${bad.join(', ')})` : ''}`, bad.length, 0)
  ok('و اسکن واقعاً فایل دیده است', files.length > 100)
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) MergeService: مبالغ اصلاً از bigint خارج نمی‌شوند —')
ok('helper مخصوص پول وجود دارد', /const rial = \(v: unknown\): bigint/.test(MERGE))
{
  /**
   * هر فیلد مالی باید `rial(...)` باشد، نه `num(...)`. `num` برای شناسه و
   * تعداد است و خروجی‌اش `number`.
   */
  const { MONEY_FIELDS } = await import('../../tools/money-fields.mjs')
  const names = [...new Set(MONEY_FIELDS.map((k) => k.split('.')[1]))]
  const re = new RegExp(`^\\s*(${names.join('|')}):\\s*num\\(`)
  const leftovers = []
  MERGE.split('\n').forEach((l, i) => {
    if (re.test(l) && !l.includes('inv.g')) leftovers.push(`${i + 1}: ${l.trim()}`)
  })
  eq(`فیلد مالی که هنوز از num() رد می‌شود${leftovers.length ? ` (${leftovers[0]})` : ''}`, leftovers.length, 0)

  const rialCount = (MERGE.match(/:\s*rial\(/g) || []).length
  ok(`همه‌ی مبالغ به rial() رفته‌اند (${rialCount} نقطه)`, rialCount >= 36)
}
ok('num() دیگر بی‌صدا نمی‌بُرد (خارج از محدوده ⇒ خطا)',
  /از محدوده‌ی امن عدد جاوااسکریپت بیرون است/.test(MERGE))
ok('ادغام همچنان روی یک تراکنش است (خطا ⇒ هیچ‌چیز اضافه نمی‌شود)',
  MERGE.includes('await prisma.$transaction('))

// ---------------------------------------------------------------------------
console.log('\n— ۳) رفتار واقعی rial() و num() —')
{
  /**
   * توابع داخلی‌اند و export نمی‌شوند، پس رفتارشان از راه بازتولید همان منطق
   * سنجیده نمی‌شود — بلکه *قرارداد*شان در متن سنجیده شد (بالا) و این‌جا
   * معادلِ رفتاری‌اش با `@shared/money` مقایسه می‌شود تا مطمئن شویم همان
   * قاعده‌ی «هرگز افت دقت بی‌صدا» را دنبال می‌کنند.
   */
  const { toRial, toNumberRial } = await import('../../src/shared/money.ts')
  const huge = 9007199254740993n
  eq('toRial مبلغ بزرگ را دست‌نخورده نگه می‌دارد', toRial(huge), huge)
  let threw = false
  try { toNumberRial(huge) } catch { threw = true }
  ok('و تبدیل به number خارج از محدوده خطا می‌دهد', threw)
  ok('در حالی که Number() بی‌صدا غلط می‌داد', BigInt(Number(huge)) !== huge)
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) MaintenanceService: جمع پیش‌نمایش پاک‌سازی —')
ok('n() دیگر شاخه‌ی بی‌اثر ندارد', !/typeof v === 'bigint' \? Number\(v\) : Number\(v\)/.test(MAINT))
ok('خارج از محدوده ⇒ خطای فارسیِ قابل‌فهم', /از محدوده‌ی امن نمایش بیرون است/.test(MAINT))
ok('خطا از نوع BusinessError است (به کاربر پیام فارسی می‌رسد)',
  /throw new BusinessError\(\s*\n?\s*`جمع مبالغ این بازه/.test(MAINT))
ok('همان SUM("grandTotal") هنوز سر جایش است', MAINT.includes('SELECT SUM("grandTotal") AS g FROM "SaleInvoice"'))

// ---------------------------------------------------------------------------
console.log('\n— ۵) بقیه‌ی کوئری‌های خام ستون مالی را لمس نمی‌کنند —')
/**
 * ادعای بازبینی: «۴۲ مورد `$queryRaw`/`$executeRaw` بررسی نشده‌اند». شمردیم:
 * ۴۳ مورد است و فقط یکی‌شان (همان `SUM("grandTotal")` بالا) ستون مالی را لمس
 * می‌کند؛ بقیه روی شناسه، تاریخ و شمارش کار می‌کنند. این بررسی نمی‌گذارد
 * کوئری خامِ تازه‌ای بی‌سروصدا روی ستون مالی اضافه شود.
 */
{
  const { MONEY_FIELDS } = await import('../../tools/money-fields.mjs')
  const names = [...new Set(MONEY_FIELDS.map((k) => k.split('.')[1]))]
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.ts')) files.push(p)
    }
  }
  walk('src')

  let total = 0
  const touching = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf-8').split('\n')
    lines.forEach((l, i) => {
      if (!/\$(queryRaw|executeRaw)(Unsafe)?/.test(l)) return
      total++
      const ctx = lines.slice(i, i + 6).join(' ')
      if (names.some((m) => new RegExp(`"${m}"`).test(ctx))) touching.push(`${f}:${i + 1}`)
    })
  }
  ok(`کوئری خام شمرده شد (${total} مورد)`, total > 30)
  eq(
    `فقط کوئری‌های خامِ شناخته‌شده ستون مالی را لمس می‌کنند${touching.length > 1 ? ` (${touching.join(', ')})` : ''}`,
    touching.length,
    1
  )
  ok('و آن یکی همان MaintenanceService است', touching[0]?.includes('MaintenanceService'))
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
