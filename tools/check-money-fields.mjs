/**
 * ===========================================================================
 * نشست ۱۸۱ · نگهبانِ طبقه‌بندی فیلدهای مالی
 * ---------------------------------------------------------------------------
 * تضمین می‌کند که طبقه‌بندی `tools/money-fields.mjs` و `prisma/schema.prisma`
 * هیچ‌وقت از هم جدا نیفتند:
 *
 *   ۱) هر فیلد عددی اسکیما دقیقاً در **یک** گروه آمده باشد،
 *   ۲) هیچ گروهی به فیلدی اشاره نکند که در اسکیما وجود ندارد (بازمانده‌ی
 *      تغییرنامِ فراموش‌شده)،
 *   ۳) بعد از مهاجرت، دقیقاً همان فیلدهای گروه «پول» در اسکیما `BigInt` باشند
 *      و بقیه `Int` مانده باشند.
 *
 * اگر فردا کسی یک ستون مالی جدید اضافه کند و اینجا ثبتش نکند، این بررسی قرمز
 * می‌شود — یعنی «فراموش کردن» گران می‌شود، که تنها راه واقعیِ زنده ماندن یک
 * قاعده است.
 *
 *     node tools/check-money-fields.mjs
 * ===========================================================================
 */
import { readFileSync } from 'node:fs'
import { MONEY_FIELDS, ID_FIELDS, COUNT_FIELDS, parseIntFields, parseBigIntFields } from './money-fields.mjs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf-8')
const intFields = parseIntFields(schema)
const bigIntFields = parseBigIntFields(schema)

const problems = []
const money = new Set(MONEY_FIELDS)
const ids = new Set(ID_FIELDS)
const counts = new Set(COUNT_FIELDS)

// ۰) هیچ فیلدی دو بار در فهرست‌ها نیامده باشد (نه داخل یک گروه، نه بین گروه‌ها).
for (const [name, list, set] of [['MONEY', MONEY_FIELDS, money], ['ID', ID_FIELDS, ids], ['COUNT', COUNT_FIELDS, counts]]) {
  if (list.length !== set.size) {
    const seen = new Set()
    const dupes = list.filter((k) => (seen.has(k) ? true : (seen.add(k), false)))
    problems.push(`گروه ${name} تکراری دارد: ${[...new Set(dupes)].join(', ')}`)
  }
}
for (const k of money) {
  if (ids.has(k)) problems.push(`${k} هم در MONEY و هم در ID آمده`)
  if (counts.has(k)) problems.push(`${k} هم در MONEY و هم در COUNT آمده`)
}
for (const k of ids) if (counts.has(k)) problems.push(`${k} هم در ID و هم در COUNT آمده`)

// ۱) پوشش کامل: هر فیلد Int/BigInt اسکیما باید در یکی از سه گروه باشد.
const declared = new Set([...money, ...ids, ...counts])
const inSchema = new Set([...intFields, ...bigIntFields].map((f) => f.key))
for (const key of inSchema) {
  if (!declared.has(key)) problems.push(`فیلد «${key}» در اسکیما هست ولی در هیچ گروهی طبقه‌بندی نشده`)
}

// ۲) بدون بازمانده: هر فیلدِ فهرست‌شده باید واقعاً در اسکیما باشد.
for (const key of declared) {
  if (!inSchema.has(key)) problems.push(`فیلد «${key}» طبقه‌بندی شده ولی در اسکیما وجود ندارد`)
}

// ۳) تطابق نوع (فقط وقتی مهاجرت انجام شده باشد).
const migrated = bigIntFields.length > 0
if (migrated) {
  const bigSet = new Set(bigIntFields.map((f) => f.key))
  for (const key of money) {
    if (!bigSet.has(key)) problems.push(`فیلد پولِ «${key}» هنوز BigInt نشده`)
  }
  for (const key of bigSet) {
    if (!money.has(key)) problems.push(`فیلد «${key}» در اسکیما BigInt است ولی فیلد پول نیست`)
  }
}

const counted = money.size + ids.size + counts.size
console.log(`فیلدهای عددی اسکیما : ${inSchema.size}  (Int: ${intFields.length} · BigInt: ${bigIntFields.length})`)
console.log(`طبقه‌بندی‌شده        : ${counted}  (پول: ${money.size} · شناسه: ${ids.size} · تعداد/شمارنده: ${counts.size})`)
console.log(`وضعیت مهاجرت         : ${migrated ? 'انجام شده' : 'هنوز انجام نشده (همه Int)'}`)

if (problems.length) {
  console.log(`\n✗ ${problems.length} مشکل:`)
  for (const p of problems) console.log(`  • ${p}`)
  process.exit(1)
}
console.log('\n✓ طبقه‌بندی کامل و سازگار است')
