/**
 * ===========================================================================
 * جلسه ۳۵ — هارنس واقعی §۲۳ روی دیتابیس واقعی
 * ---------------------------------------------------------------------------
 * این فایل همان کاری را می‌کند که دوازده نشست (۲۳ تا ۳۴) «فقط با npm ممکن است»
 * نوشته شده بود. راهش npm نبود: موتور SQLite داخل خودِ Node است و جدول‌ها از
 * **فایل‌های migration واقعی پروژه** ساخته می‌شوند (`test/harness/`).
 *
 * تفاوت این سوییت با سیزده سوییت قبلی (که همه‌شان هنوز معتبرند):
 *   • آن‌ها *تصمیم* را می‌سنجند (`decideRedeem`, `creditPrintOpRequest`, ...).
 *   • این یکی *اجرا* را می‌سنجد: `StoreCreditService.ts` واقعی، با ایندکس یکتای
 *     واقعی، تراکنش واقعی، و AuditLog واقعی که در جدول می‌نشیند.
 *
 * فهرست §۲۳ پرامپت، بند به بند:
 *   ۱ ایجاد اعتبار · ۲ تکراری‌نبودن کد زیر بار همزمان · ۳ تولید حجیم ·
 *   ۴ فضای کد ناکافی · ۵ مصرف تک/چندباره · ۶ مصرف جزئی/کامل ·
 *   ۷ منقضی/باطل/معلق · ۸ دو درخواست همزمان روی یک اعتبار ·
 *   ۹ Idempotency · ۱۰ تغییر غیرمجاز مبلغ/تاریخ/دفعات · ۱۱ محدودیت کالا/دسته ·
 *   ۱۲ اتصال به تعویض کالا · ۱۳ Audit Log کامل · ۱۴ Rollback روی خطای دیتابیس
 * و افزوده‌های لازم: قفل موقت کد (§۸)، داشبورد/تعهد (§۱۵)، یادآوری (§۱۴)،
 * حذف/آرشیو (§۱۱)، شمارنده‌ی چاپ (§۱۳)، پرداخت ترکیبی POS (§۱۷).
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
/** برای تثبیت تستِ ناپایدار: مبلغ فارسیِ همان‌طور که متن یادآوری می‌سازد */
import { money } from '@shared/jalali'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = mkdtempSync(join(tmpdir(), 'mahak-session35-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const svc = await import('../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { DEFAULT_CREDIT_SETTINGS, remainingOf } = await import('@shared/credit')
const { StoreCreditStatus, AuditAction } = await import('@shared/enums')
const { BusinessError } = await import('../src/main/errors.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const PW = DEFAULT_MANAGER_PASSWORD
const DAY = 86_400_000

// ------------------------------------------------------------------ گزارش‌گر
let pass = 0
const failures = []
const section = (title) => console.log(`\n— ${title}`)
const ok = (name, cond, detail) => {
  if (cond) {
    pass++
    return true
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  return false
}
const eq = (name, got, want) => ok(name, got === want, `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
const throwsWith = async (name, fn, needle) => {
  try {
    await fn()
    return ok(name, false, 'هیچ خطایی پرتاب نشد')
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (String(msg).startsWith('HARNESS:')) return ok(name, false, msg)
    return ok(name, needle ? msg.includes(needle) : true, `پیام: ${msg.split('\n')[0]}`)
  }
}

const auditRows = (action, entityId) =>
  seed.rows(
    `SELECT * FROM "AuditLog" WHERE action = ?${entityId != null ? ' AND entityId = ?' : ''} ORDER BY id`,
    ...(entityId != null ? [action, entityId] : [action])
  )
const creditRow = (id) => seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', id)

// داده‌ی پایه‌ی مشترک
const userId = seed.user('مدیر تست')
const catClothes = seed.category('پوشاک')
const catShirts = seed.category('پیراهن', catClothes)
const catShoes = seed.category('کفش')
const shirtVariant = seed.variant(seed.product('پیراهن مردانه', catShirts))
const shoeVariant = seed.variant(seed.product('کفش چرم', catShoes))

const issue = (over = {}) =>
  svc.issueStoreCredit(db, { amount: 5_000_000, source: 'MANUAL', userId, ...over })

/** یک فاکتور ساده‌ی «همه‌کاره» با یک قلم پیراهن. */
const plainInvoice = (total = 20_000_000) =>
  seed.invoiceWithLines([{ variantId: shirtVariant, qty: 1, lineTotal: total, variantName: 'پیراهن مردانه' }])

// ===========================================================================
// بند ۱ · ایجاد اعتبار — قواعد نوع، انقضا، سند صدور
// ===========================================================================
section('بند ۱ · ایجاد اعتبار (§۱، §۲، §۳، §۱۲)')
{
  const manual = await issue({ amount: 7_000_000, holderCompany: 'شرکت الف', holderPhone: '09120000001' })
  const row = creditRow(manual.id)
  eq('اعتبار مدیریتی با source = MANUAL ذخیره شد', row.source, 'MANUAL')
  eq('وضعیت اولیه ACTIVE است', row.status, StoreCreditStatus.ACTIVE)
  eq('مبلغ اولیه دست‌نخورده ذخیره شد', row.amount, 7_000_000)
  eq('مصرف اولیه صفر است', `${row.usedAmount}/${row.usedCount}`, '0/0')
  eq('پیش‌فرض یک‌بارمصرف است (§۴)', `${row.maxUses}/${row.multiUse}`, '1/0')
  ok('کد با پیشوند نوع ساخته شد (§۲۲)', String(row.code).startsWith('CR'), row.code)
  eq(
    'مدت اعتبار پیش‌فرض نوع مدیریتی اعمال شد (§۳)',
    Math.round((row.expiresAt - row.issuedAt) / DAY),
    DEFAULT_CREDIT_SETTINGS.types.MANUAL.days
  )
  eq('اطلاعات گیرنده ثبت شد (§۱۲)', row.holderCompany, 'شرکت الف')
  const log = auditRows(AuditAction.CREDIT_ISSUE_MANUAL, manual.id)
  eq('یک ردیف AuditLog صدور ثبت شد (§۱۰)', log.length, 1)
  ok('متن سند صدور مبلغ و نوع را دارد', /صدور اعتبار خرید/.test(log[0]?.note ?? ''), log[0]?.note)

  const exchange = await issue({ amount: 3_000_000, source: 'EXCHANGE' })
  const exRow = creditRow(exchange.id)
  eq(
    'مدت اعتبار نوع تعویض جدا از نوع مدیریتی است (§۳)',
    Math.round((exRow.expiresAt - exRow.issuedAt) / DAY),
    DEFAULT_CREDIT_SETTINGS.types.EXCHANGE.days
  )
  ok('پیشوند نوع تعویض جداست', String(exRow.code).startsWith('E'), exRow.code)
  eq('سند صدور تعویض با action تاریخی ثبت شد', auditRows(AuditAction.STORE_CREDIT_ISSUE, exchange.id).length, 1)

  await throwsWith('مبلغ صفر رد می‌شود', () => issue({ amount: 0 }), 'بزرگ‌تر از صفر')
  await throwsWith(
    'محدودیت دسته بدون انتخاب دسته رد می‌شود',
    () => issue({ restrictScope: 'CATEGORY', restrictCategoryIds: [] }),
    'حداقل یک دسته‌بندی'
  )
  const override = await issue({ amount: 9_000_000, maxUses: 2, multiUse: true, overrideReason: 'قرارداد شرکت ب' })
  const ovRow = creditRow(override.id)
  eq('Override روی همان رکورد می‌نشیند (§۳)', ovRow.settingsOverride, 1)
  eq('دلیل استثنا روی رکورد می‌ماند', ovRow.overrideReason, 'قرارداد شرکت ب')
}

// ===========================================================================
// بند ۲ · یکتایی کد زیر بار همزمان — تضمین از UNIQUE INDEX دیتابیس
// ===========================================================================
section('بند ۲ · یکتایی کد زیر بار همزمان (§۶)')
{
  // الفبای تنگ + طول کوتاه ⇒ تصادم واقعی، نه فرضی
  seed.creditSettings({ codeLength: 6, codeAlphabet: 'NUM', excludeSimilar: false, autoGrowLength: false, prefixManual: '' })
  const results = await Promise.allSettled(Array.from({ length: 60 }, () => issue({ amount: 1_000_000, source: 'MANUAL' })))
  const created = results.filter((r) => r.status === 'fulfilled')
  eq('همه‌ی ۶۰ درخواست همزمان موفق شدند', created.length, 60)
  const dup = seed.one(
    'SELECT COUNT(*) AS n FROM (SELECT code FROM "StoreCredit" GROUP BY code HAVING COUNT(*) > 1)'
  )
  eq('هیچ کد تکراری در دیتابیس نیست', Number(dup.n), 0)
  const idx = seed.one(
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='StoreCredit_code_key'`
  )
  ok('ایندکس یکتای واقعی روی ستون code وجود دارد', /UNIQUE INDEX/.test(idx?.sql ?? ''), idx?.sql)
  // خودِ دیتابیس باید کد تکراری را رد کند (نه فقط کد اپلیکیشن)
  const sample = seed.one('SELECT code FROM "StoreCredit" LIMIT 1').code
  let raw = null
  try {
    seed.insert('StoreCredit', { code: sample, amount: 1 })
  } catch (e) {
    raw = String(e.message)
  }
  ok('درج دستی کد تکراری در سطح دیتابیس رد شد', /UNIQUE constraint failed/i.test(raw ?? ''), raw ?? 'بدون خطا!')
  seed.creditSettings(DEFAULT_CREDIT_SETTINGS)
}

// ===========================================================================
// بند ۳ · تولید حجیم — Batch Insert، همه‌یا‌هیچ، سند دسته
// ===========================================================================
section('بند ۳ · تولید گروهی حجیم (§۵)')
{
  const t0 = Date.now()
  const bulk = await svc.bulkIssueCredits({ managerPassword: PW,
    count: 1200,
    amountEach: 2_000_000,
    source: 'MANUAL',
    holderCompany: 'شرکت حجیم',
    userId
  })
  const ms = Date.now() - t0
  eq('همان تعداد درخواستی ساخته شد', bulk.created, 1200)
  eq('تعداد ردیف‌های دسته در دیتابیس', seed.count('StoreCredit', 'batchId = ?', bulk.batchId), 1200)
  const batch = seed.one('SELECT * FROM "StoreCreditBatch" WHERE id = ?', bulk.batchId)
  eq('جمع مبلغ دسته درست ذخیره شد', batch.totalAmount, 1200 * 2_000_000)
  eq('شمارنده‌ی دسته با ردیف‌های واقعی یکی است', batch.count, 1200)
  const dup = seed.one(
    'SELECT COUNT(*) AS n FROM (SELECT code FROM "StoreCredit" WHERE batchId = ? GROUP BY code HAVING COUNT(*) > 1)',
    bulk.batchId
  )
  eq('هیچ کد تکراری در دسته نیست', Number(dup.n), 0)
  eq('هر رکورد وضعیت و سابقه‌ی مستقل خودش را دارد', seed.count('StoreCredit', 'batchId = ? AND status = ?', bulk.batchId, 'ACTIVE'), 1200)
  eq('یک سند دسته در AuditLog ثبت شد (نه هزار سند)', auditRows(AuditAction.CREDIT_BULK_GENERATE, bulk.batchId).length, 1)
  eq(
    'برای دسته‌ی بزرگ‌تر از ۵۰، سند صدورِ تک‌تک ساخته نشد',
    seed.count('AuditLog', "action = 'CREDIT_ISSUE_MANUAL' AND entityId IN (SELECT id FROM \"StoreCredit\" WHERE batchId = ?)", bulk.batchId),
    0
  )
  ok(`کارایی ۱۲۰۰ رکورد قابل قبول بود (${ms} میلی‌ثانیه)`, ms < 20_000, `${ms}ms`)

  const small = await svc.bulkIssueCredits({ managerPassword: PW, count: 5, amountEach: 500_000, source: 'MANUAL', userId })
  eq('دسته‌ی کوچک هم ساخته شد', small.created, 5)
  eq(
    'برای دسته‌ی ≤۵۰ سند صدور تک‌تک ثبت می‌شود',
    seed.count('AuditLog', "action = 'CREDIT_ISSUE_MANUAL' AND entityId IN (SELECT id FROM \"StoreCredit\" WHERE batchId = ?)", small.batchId),
    5
  )
  await throwsWith(
    'درخواست بیشتر از سقف تنظیمات چیزی نمی‌سازد',
    () => svc.bulkIssueCredits({ managerPassword: PW, count: DEFAULT_CREDIT_SETTINGS.bulkMaxCount + 1, amountEach: 1_000, userId }),
    'سقف تولید گروهی'
  )
}

// ===========================================================================
// بند ۴ · فضای کد ناکافی — توقف با پیام فارسی، نه silently fail
// ===========================================================================
section('بند ۴ · فضای کد ناکافی (§۶)')
{
  const before = seed.count('StoreCredit')
  seed.creditSettings({ ...DEFAULT_CREDIT_SETTINGS, codeLength: 6, codeAlphabet: 'NUM', excludeSimilar: false, autoGrowLength: false, prefixManual: 'CR' })
  await throwsWith(
    'تولید گروهی با فضای ناکافی متوقف می‌شود',
    () => svc.bulkIssueCredits({ managerPassword: PW, count: 4000, amountEach: 1_000_000, source: 'MANUAL', userId }),
    'کد'
  )
  eq('هیچ اعتباری ساخته نشد', seed.count('StoreCredit'), before)
  const blocked = auditRows(AuditAction.CREDIT_CODE_SPACE_BLOCKED)
  ok('سند «کمبود فضای کد» در AuditLog ثبت شد', blocked.length >= 1)
  const payload = JSON.parse(blocked.at(-1)?.after ?? '{}')
  ok('تعداد کدهای ممکن در سند اعلام شد', Number(payload.capacity) > 0, JSON.stringify(payload))

  // با «افزایش خودکار طول» همان درخواست باید انجام شود و رشد طول دیده شود
  seed.creditSettings({ ...DEFAULT_CREDIT_SETTINGS, codeLength: 6, codeAlphabet: 'NUM', excludeSimilar: false, autoGrowLength: true, prefixManual: 'CR' })
  const grown = await svc.bulkIssueCredits({ managerPassword: PW, count: 900, amountEach: 1_000_000, source: 'MANUAL', userId })
  const batch = seed.one('SELECT * FROM "StoreCreditBatch" WHERE id = ?', grown.batchId)
  eq('رشد خودکار طول کد روی دسته ثبت شد و قابل مشاهده است', batch.lengthGrown, 1)
  ok('طول کد واقعاً بزرگ‌تر از درخواست شد', batch.codeLength > 6, String(batch.codeLength))
  seed.creditSettings(DEFAULT_CREDIT_SETTINGS)
}

// ===========================================================================
// بند ۵ و ۶ · مصرف تک/چندباره و جزئی/کامل
// ===========================================================================
section('بند ۵ و ۶ · مصرف تک/چندباره، جزئی/کامل (§۴)')
{
  // یک‌بارمصرف با مصرف جزئی ⇒ بسته می‌شود و باقی‌مانده اعتبار جدید می‌گیرد
  const single = await issue({ amount: 10_000_000 })
  const inv1 = plainInvoice(4_000_000)
  const r1 = await svc.redeemStoreCredit(db, {
    code: single.code,
    invoiceId: inv1.id,
    receiptNo: inv1.receiptNo,
    applicable: 4_000_000,
    invoiceTotal: 4_000_000,
    userId
  })
  eq('مصرف جزئی فقط تا سقف قابل‌پرداخت فاکتور است', r1.applied, 4_000_000)
  const singleRow = creditRow(single.id)
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۶ — باقی‌مانده روی همان بارکد می‌ماند، بارکد جانشین
   * ساخته نمی‌شود. پس مصرف جزئی دیگر سند را نمی‌بندد.
   */
  eq('مصرف جزئی، بارکد را باز نگه می‌دارد', singleRow.status, StoreCreditStatus.PARTIALLY_USED)
  ok('هیچ بارکد جانشینی ساخته نشد', r1.remainder == null && singleRow.remainderCreditId == null)
  eq('و باقی‌مانده روی همان رکورد است', Number(singleRow.amount) - Number(singleRow.usedAmount), 6_000_000)
  await throwsWith(
    'مصرف دوباره‌ی اعتبار یک‌بارمصرف رد می‌شود',
    () => svc.redeemStoreCredit(db, { code: single.code, invoiceId: inv1.id, receiptNo: inv1.receiptNo, userId }),
    'مصرف'
  )

  // چندباره تا سقف مبلغ
  const multi = await issue({ amount: 10_000_000, multiUse: true, maxUses: 3, overrideReason: 'قرارداد' })
  const amounts = [3_000_000, 3_000_000, 4_000_000]
  let seq = 0
  for (const amt of amounts) {
    const inv = plainInvoice(amt)
    const res = await svc.redeemStoreCredit(db, {
      code: multi.code,
      invoiceId: inv.id,
      receiptNo: inv.receiptNo,
      applicable: amt,
      invoiceTotal: amt,
      userId
    })
    seq++
    eq(`مصرف ${seq} از اعتبار چندباره`, res.applied, amt)
  }
  const multiRow = creditRow(multi.id)
  eq('دفعات مصرف دقیقاً شمرده شد', multiRow.usedCount, 3)
  eq('جمع مصرف با مبلغ اولیه برابر شد', multiRow.usedAmount, 10_000_000)
  eq('اعتبار چندباره پس از اتمام مبلغ بسته شد', multiRow.status, StoreCreditStatus.USED)
  eq('دفتر مصرف سه ردیف جدا دارد', seed.count('StoreCreditRedemption', 'creditId = ?', multi.id), 3)
  eq(
    'باقی‌مانده‌ی هر ردیف دفتر مصرف snapshot درست دارد',
    seed.rows('SELECT remainderAfter FROM "StoreCreditRedemption" WHERE creditId = ? ORDER BY seq', multi.id)
      .map((r) => r.remainderAfter)
      .join(','),
    '7000000,4000000,0'
  )
  ok('برای اعتبار چندباره، اعتبار باقی‌مانده‌ی جدید ساخته نشد', creditRow(multi.id).remainderCreditId == null)

  // سقف دفعات: چهارمین مصرف روی اعتباری که مبلغ دارد ولی دفعاتش تمام شده
  const capped = await issue({ amount: 10_000_000, multiUse: true, maxUses: 2, overrideReason: 'سقف دفعات' })
  for (const amt of [1_000_000, 1_000_000]) {
    const inv = plainInvoice(amt)
    await svc.redeemStoreCredit(db, { code: capped.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: amt, invoiceTotal: amt, userId })
  }
  const invX = plainInvoice(1_000_000)
  await throwsWith(
    'مصرف بیش از دفعات مجاز رد می‌شود، حتی با مبلغ باقی‌مانده',
    () => svc.redeemStoreCredit(db, { code: capped.code, invoiceId: invX.id, receiptNo: invX.receiptNo, applicable: 1_000_000, invoiceTotal: 1_000_000, userId }),
    'دفعات مجاز'
  )
  await throwsWith(
    'پیام خطا مبلغ باقی‌مانده را هم می‌گوید (یافته‌ی جلسه ۳۵)',
    () => svc.redeemStoreCredit(db, { code: capped.code, invoiceId: invX.id, receiptNo: invX.receiptNo, applicable: 1_000_000, invoiceTotal: 1_000_000, userId }),
    'باقی‌مانده'
  )
  const cappedRow = creditRow(capped.id)
  eq('دفعات ثبت‌شده هرگز از سقف بیشتر نشد', cappedRow.usedCount, 2)
  ok('موجودی اعتبار هیچ‌وقت منفی نشد', cappedRow.amount - cappedRow.usedAmount >= 0, `${cappedRow.amount - cappedRow.usedAmount}`)

  // پرداخت ترکیبی POS (§۱۷): بخشی اعتبار، بخشی کارت
  const combo = await issue({ amount: 8_000_000 })
  const invCombo = plainInvoice(20_000_000)
  const resCombo = await svc.redeemStoreCredit(db, {
    code: combo.code,
    invoiceId: invCombo.id,
    receiptNo: invCombo.receiptNo,
    applicable: 20_000_000,
    invoiceTotal: 20_000_000,
    requested: 5_000_000,
    userId
  })
  eq('مبلغ درخواستی کاربر در پرداخت ترکیبی رعایت شد (§۱۷)', resCombo.applied, 5_000_000)
  const payment = seed.one('SELECT * FROM "Payment" WHERE id = ?', resCombo.payment.id)
  eq('برای مصرف اعتبار یک ردیف پرداخت غیرنقدی ساخته شد', payment.amount, 5_000_000)
  eq('ردیف پرداخت به همان اعتبار گره خورد', payment.storeCreditId, combo.id)
}

// ===========================================================================
// بند ۷ · منقضی / باطل / معلق
// ===========================================================================
section('بند ۷ · منقضی، باطل، معلق (§۱۱)')
{
  const expired = await issue({ amount: 5_000_000, days: 1 })
  seed.rows('UPDATE "StoreCredit" SET expiresAt = ? WHERE id = ?', Date.now() - 5 * DAY, expired.id)
  const invE = plainInvoice(5_000_000)
  await throwsWith(
    'اعتبار منقضی مصرف نمی‌شود',
    () => svc.redeemStoreCredit(db, { code: expired.code, invoiceId: invE.id, receiptNo: invE.receiptNo, userId }),
    'اعتبار'
  )

  const voided = await issue({ amount: 5_000_000 })
  const voidRes = await svc.voidCredit({ id: voided.id, reason: 'اشتباه صدور شد', managerPassword: PW, userId })
  eq('ابطال، وضعیت را عوض می‌کند نه رکورد را حذف', creditRow(voided.id).status, StoreCreditStatus.CANCELED)
  ok('رکورد ابطال‌شده هنوز در دیتابیس هست (§۱۱)', creditRow(voided.id) != null)
  ok('دلیل ابطال ذخیره شد', creditRow(voided.id).voidedReason === 'اشتباه صدور شد')
  const invV = plainInvoice(5_000_000)
  await throwsWith(
    'اعتبار باطل‌شده مصرف نمی‌شود',
    () => svc.redeemStoreCredit(db, { code: voided.code, invoiceId: invV.id, receiptNo: invV.receiptNo, userId }),
    'باطل'
  )
  await throwsWith(
    'ابطال دوباره‌ی همان اعتبار مجاز نیست (Status Machine)',
    () => svc.voidCredit({ id: voided.id, reason: 'تکرار', managerPassword: PW, userId }),
    ''
  )

  const suspended = await issue({ amount: 5_000_000 })
  await svc.suspendCredit({ id: suspended.id, reason: 'بررسی مالی', managerPassword: PW, userId })
  eq('تعلیق وضعیت SUSPENDED می‌دهد', creditRow(suspended.id).status, StoreCreditStatus.SUSPENDED)
  const invS = plainInvoice(5_000_000)
  await throwsWith(
    'اعتبار معلق مصرف نمی‌شود',
    () => svc.redeemStoreCredit(db, { code: suspended.code, invoiceId: invS.id, receiptNo: invS.receiptNo, userId }),
    'معلق'
  )
  await svc.reactivateCredit({ id: suspended.id, reason: 'تایید شد', managerPassword: PW, userId })
  eq('فعال‌سازی مجدد از تعلیق برمی‌گرداند', creditRow(suspended.id).status, StoreCreditStatus.ACTIVE)
  const invS2 = plainInvoice(5_000_000)
  const afterReactivate = await svc.redeemStoreCredit(db, {
    code: suspended.code,
    invoiceId: invS2.id,
    receiptNo: invS2.receiptNo,
    applicable: 5_000_000,
    invoiceTotal: 5_000_000,
    userId
  })
  eq('اعتبار فعال‌شده دوباره قابل مصرف است', afterReactivate.applied, 5_000_000)
  await throwsWith(
    'فعال‌سازی اعتبار منقضی بدون تمدید تاریخ رد می‌شود',
    () => svc.reactivateCredit({ id: expired.id, reason: 'بدون تمدید', managerPassword: PW, userId }),
    'تمدید'
  )
}

// ===========================================================================
// بند ۸ · دو صندوق هم‌زمان روی یک اعتبار
// ===========================================================================
section('بند ۸ · دو درخواست هم‌زمان روی یک اعتبار (§۹)')
{
  const shared = await issue({ amount: 6_000_000 })
  const invA = plainInvoice(6_000_000)
  const invB = plainInvoice(6_000_000)
  const both = await Promise.allSettled([
    svc.redeemStoreCredit(db, { code: shared.code, invoiceId: invA.id, receiptNo: invA.receiptNo, applicable: 6_000_000, invoiceTotal: 6_000_000, userId }),
    svc.redeemStoreCredit(db, { code: shared.code, invoiceId: invB.id, receiptNo: invB.receiptNo, applicable: 6_000_000, invoiceTotal: 6_000_000, userId })
  ])
  const winners = both.filter((r) => r.status === 'fulfilled')
  eq('فقط یکی از دو صندوق موفق شد', winners.length, 1)
  const loser = both.find((r) => r.status === 'rejected')
  ok('صندوق دوم پیام فارسی روشن گرفت', /همین لحظه|مصرف/.test(String(loser?.reason?.message ?? '')), String(loser?.reason?.message ?? '').split('\n')[0])
  const row = creditRow(shared.id)
  eq('مبلغ فقط یک بار کم شد', row.usedAmount, 6_000_000)
  eq('دفعات فقط یک بار شمرده شد', row.usedCount, 1)
  eq('فقط یک ردیف در دفتر مصرف نشست', seed.count('StoreCreditRedemption', 'creditId = ?', shared.id), 1)
  eq('برای درخواست شکست‌خورده هیچ پرداختی ثبت نشد', seed.count('Payment', 'storeCreditId = ?', shared.id), 1)

  // چندباره تحت همزمانی: جمع مصرف هرگز از مبلغ بیشتر نمی‌شود
  const multi = await issue({ amount: 9_000_000, multiUse: true, maxUses: 5, overrideReason: 'تست همزمانی' })
  const invs = [plainInvoice(5_000_000), plainInvoice(5_000_000), plainInvoice(5_000_000)]
  await Promise.allSettled(
    invs.map((inv) =>
      svc.redeemStoreCredit(db, { code: multi.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId })
    )
  )
  const mRow = creditRow(multi.id)
  ok('جمع مصرف هرگز از مبلغ اعتبار بیشتر نشد', mRow.usedAmount <= mRow.amount, `${mRow.usedAmount} از ${mRow.amount}`)
  ok('دفعات ثبت‌شده از سقف بیشتر نشد', mRow.usedCount <= mRow.maxUses, `${mRow.usedCount}/${mRow.maxUses}`)
  eq(
    'جمع ردیف‌های دفتر مصرف با usedAmount رکورد یکی است',
    Number(seed.one('SELECT COALESCE(SUM(amount),0) AS s FROM "StoreCreditRedemption" WHERE creditId = ?', multi.id).s),
    mRow.usedAmount
  )
}

// ===========================================================================
// بند ۹ · Idempotency — همان درخواست، دو بار
// ===========================================================================
section('بند ۹ · Idempotency (§۲۱)')
{
  const credit = await issue({ amount: 4_000_000 })
  const inv = plainInvoice(4_000_000)
  const args = { code: credit.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 4_000_000, invoiceTotal: 4_000_000, userId, idempotencyKey: 'REQ-777' }
  const first = await svc.redeemStoreCredit(db, args)
  const second = await svc.redeemStoreCredit(db, args)
  eq('بار اول واقعاً مصرف شد', first.applied, 4_000_000)
  eq('بار دوم replay اعلام شد', second.replayed, true)
  eq('بار دوم همان مبلغ را گزارش کرد', second.applied, 4_000_000)
  eq('فقط یک ردیف دفتر مصرف ساخته شد', seed.count('StoreCreditRedemption', 'creditId = ?', credit.id), 1)
  eq('فقط یک ردیف پرداخت ساخته شد', seed.count('Payment', 'storeCreditId = ?', credit.id), 1)
  eq('مبلغ فقط یک بار کم شد', creditRow(credit.id).usedAmount, 4_000_000)
  const idx = seed.one(`SELECT sql FROM sqlite_master WHERE name = 'StoreCreditRedemption_idempotencyKey_key'`)
  ok('یکتایی کلید Idempotency در سطح دیتابیس است', /UNIQUE INDEX/.test(idx?.sql ?? ''), idx?.sql)
  // هم‌زمانیِ همان کلید (دو بار کلیک واقعی)
  const credit2 = await issue({ amount: 4_000_000 })
  const inv2 = plainInvoice(4_000_000)
  const dbl = { code: credit2.code, invoiceId: inv2.id, receiptNo: inv2.receiptNo, applicable: 4_000_000, invoiceTotal: 4_000_000, userId, idempotencyKey: 'REQ-888' }
  const race = await Promise.allSettled([svc.redeemStoreCredit(db, dbl), svc.redeemStoreCredit(db, dbl)])
  eq('دو ارسال هم‌زمانِ یک کلید، یک مصرف ساخت', seed.count('StoreCreditRedemption', 'creditId = ?', credit2.id), 1)
  eq('مبلغ با دو ارسال هم‌زمان دو بار کم نشد', creditRow(credit2.id).usedAmount, 4_000_000)
  ok('نتیجه‌ی هر دو ارسال هم‌زمان قابل‌فهم بود', race.filter((r) => r.status === 'fulfilled').length >= 1)
}

// ===========================================================================
// بند ۱۰ · تغییر غیرمجاز مبلغ / تاریخ / دفعات
// ===========================================================================
section('بند ۱۰ · تغییر غیرمجاز مبلغ/تاریخ/دفعات (§۸، §۱۰)')
{
  const fresh = await issue({ amount: 5_000_000 })
  await throwsWith('تغییر مبلغ بدون رمز مدیر رد می‌شود', () => svc.changeCreditAmount({ id: fresh.id, amount: 9_000_000, reason: 'تست', userId }), 'رمز مدیر')
  eq('مبلغ با درخواست بدون رمز تغییر نکرد', creditRow(fresh.id).amount, 5_000_000)
  await throwsWith('رمز مدیر اشتباه رد می‌شود', () => svc.changeCreditAmount({ id: fresh.id, amount: 9_000_000, reason: 'تست', managerPassword: 'غلط-غلط', userId }), '')
  eq('مبلغ با رمز اشتباه تغییر نکرد', creditRow(fresh.id).amount, 5_000_000)
  await throwsWith('تغییر بدون دلیل رد می‌شود (§۱۰)', () => svc.changeCreditAmount({ id: fresh.id, amount: 9_000_000, managerPassword: PW, userId }), 'دلیل')

  await svc.changeCreditAmount({ id: fresh.id, amount: 9_000_000, reason: 'اصلاح مبلغ قرارداد', managerPassword: PW, userId })
  eq('تغییر مجاز مبلغ اعمال شد', creditRow(fresh.id).amount, 9_000_000)
  const log = auditRows(AuditAction.CREDIT_AMOUNT_CHANGE, fresh.id)
  eq('یک سند تغییر مبلغ ثبت شد', log.length, 1)
  eq('مقدار قبل در سند هست', JSON.parse(log[0].before).amount, 5_000_000)
  eq('مقدار بعد در سند هست', JSON.parse(log[0].after).amount, 9_000_000)
  eq('دلیل تغییر در سند هست', JSON.parse(log[0].after).reason, 'اصلاح مبلغ قرارداد')
  eq('کاربر تغییر در سند هست', log[0].userId, userId)

  // اعتبارِ مصرف‌شده: تغییر مبلغ ممنوع
  const used = await issue({ amount: 5_000_000, multiUse: true, maxUses: 3, overrideReason: 'تست' })
  for (const n of [1, 2]) {
    const invU = plainInvoice(1_000_000)
    await svc.redeemStoreCredit(db, { code: used.code, invoiceId: invU.id, receiptNo: invU.receiptNo, applicable: 1_000_000, invoiceTotal: 1_000_000, userId, note: `مصرف ${n}` })
  }
  await throwsWith(
    'تغییر مبلغ اعتبارِ مصرف‌شده ممنوع است',
    () => svc.changeCreditAmount({ id: used.id, amount: 20_000_000, reason: 'دستکاری', managerPassword: PW, userId }),
    'مصرف شده'
  )
  eq('مبلغ اعتبار مصرف‌شده دست‌نخورده ماند', creditRow(used.id).amount, 5_000_000)
  await throwsWith(
    'سقف «یک بار» روی اعتبار چندباره با پیام روشن رد می‌شود (یافته‌ی جلسه ۳۵)',
    () => svc.changeCreditUses({ id: used.id, maxUses: 1, reason: 'کاهش سقف', managerPassword: PW, userId }),
    'چندباره'
  )
  eq('سقف دفعات با درخواست متناقض عوض نشد', creditRow(used.id).maxUses, 3)
  await throwsWith(
    'سقف دفعات کمتر از دفعات مصرف‌شده رد می‌شود',
    () => svc.changeCreditUses({ id: used.id, maxUses: 1, multiUse: false, reason: 'کاهش سقف', managerPassword: PW, userId }),
    'کمتر'
  )
  await svc.changeCreditUses({ id: used.id, maxUses: 4, multiUse: true, reason: 'افزایش سقف طبق قرارداد', managerPassword: PW, userId })
  eq('تغییر مجاز دفعات اعمال شد', creditRow(used.id).maxUses, 4)
  eq('سند تغییر دفعات با مقدار قبل/بعد ثبت شد', auditRows(AuditAction.CREDIT_USES_CHANGE, used.id).length, 1)

  // تاریخ انقضا
  await svc.changeCreditExpiry({ id: used.id, expiresAtJalali: '1406/01/15', reason: 'تمدید قرارداد سالانه', managerPassword: PW, userId })
  const expLog = auditRows(AuditAction.CREDIT_EXPIRY_CHANGE, used.id)
  eq('سند تغییر تاریخ ثبت شد', expLog.length, 1)
  eq('تاریخ جدید روی رکورد نشست', creditRow(used.id).expiresAtJalali, '1406/01/15')
  ok('تاریخ قبلی در سند تغییر هست', JSON.parse(expLog[0].before).expiresAtJalali != null)

  // تغییر دارنده
  await svc.changeCreditHolder({ id: used.id, holderCompany: 'شرکت جدید', reason: 'انتقال به شرکت خریدار', managerPassword: PW, userId })
  eq('دارنده عوض شد', creditRow(used.id).holderCompany, 'شرکت جدید')
  eq('سند تغییر دارنده ثبت شد', auditRows(AuditAction.CREDIT_HOLDER_CHANGE, used.id).length, 1)
}

// ===========================================================================
// بند ۱۱ · محدودیت کالا / دسته — اعمال در Backend، نه UI
// ===========================================================================
section('بند ۱۱ · محدودیت کالا/دسته (§۱۸، §۲۱)')
{
  const catCredit = await issue({ amount: 5_000_000, restrictScope: 'CATEGORY', restrictCategoryIds: [catClothes] })
  const shoesInvoice = seed.invoiceWithLines([{ variantId: shoeVariant, qty: 1, lineTotal: 5_000_000, variantName: 'کفش چرم' }])
  await throwsWith(
    'اعتبار محدود به دسته روی کالای دسته‌ی دیگر رد می‌شود',
    () => svc.redeemStoreCredit(db, { code: catCredit.code, invoiceId: shoesInvoice.id, receiptNo: shoesInvoice.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId }),
    ''
  )
  eq('هیچ مصرفی ثبت نشد', seed.count('StoreCreditRedemption', 'creditId = ?', catCredit.id), 0)

  // فرزندِ دسته‌ی مجاز باید پوشش داده شود
  const shirtInvoice = seed.invoiceWithLines([{ variantId: shirtVariant, qty: 1, lineTotal: 3_000_000, variantName: 'پیراهن مردانه' }])
  const okRes = await svc.redeemStoreCredit(db, {
    code: catCredit.code,
    invoiceId: shirtInvoice.id,
    receiptNo: shirtInvoice.receiptNo,
    applicable: 3_000_000,
    invoiceTotal: 3_000_000,
    userId
  })
  eq('زیرشاخه‌ی دسته‌ی مجاز پوشش داده شد', okRes.applied, 3_000_000)

  // سبد ترکیبی: فقط سهم اقلام مجاز پوشش داده می‌شود
  const mixCredit = await issue({ amount: 10_000_000, restrictScope: 'CATEGORY', restrictCategoryIds: [catShoes] })
  const mixInvoice = seed.invoiceWithLines([
    { variantId: shoeVariant, qty: 1, lineTotal: 4_000_000, variantName: 'کفش چرم' },
    { variantId: shirtVariant, qty: 1, lineTotal: 6_000_000, variantName: 'پیراهن مردانه' }
  ])
  const mixRes = await svc.redeemStoreCredit(db, {
    code: mixCredit.code,
    invoiceId: mixInvoice.id,
    receiptNo: mixInvoice.receiptNo,
    applicable: 10_000_000,
    invoiceTotal: 10_000_000,
    userId
  })
  eq('در سبد ترکیبی فقط سهم اقلام مجاز پوشش داده شد', mixRes.applied, 4_000_000)

  // ⚠️ همان تست ضدتقلبِ §۲۱: اقلام دروغینِ ورودی نباید محدودیت را دور بزند
  const liarCredit = await issue({ amount: 5_000_000, restrictScope: 'VARIANTS', restrictVariantIds: [shirtVariant] })
  const shoesOnly = seed.invoiceWithLines([{ variantId: shoeVariant, qty: 1, lineTotal: 5_000_000, variantName: 'کفش چرم' }])
  await throwsWith(
    'ارسال اقلام جعلی در Request محدودیت را دور نمی‌زند (§۲۱)',
    () =>
      svc.redeemStoreCredit(db, {
        code: liarCredit.code,
        invoiceId: shoesOnly.id,
        receiptNo: shoesOnly.receiptNo,
        applicable: 5_000_000,
        invoiceTotal: 5_000_000,
        lines: [{ variantId: shirtVariant, categoryId: catShirts, categoryPath: [catShirts, catClothes], qty: 1, lineTotal: 5_000_000 }],
        userId
      }),
    ''
  )
  eq('اعتبار محدود به کالا با اقلام جعلی مصرف نشد', creditRow(liarCredit.id).usedAmount, 0)

  // حداقل مبلغ خرید و سقف هر تراکنش
  const minCredit = await issue({ amount: 5_000_000, minPurchase: 8_000_000 })
  const smallInvoice = plainInvoice(3_000_000)
  await throwsWith(
    'حداقل مبلغ خرید در Backend اعمال شد',
    () => svc.redeemStoreCredit(db, { code: minCredit.code, invoiceId: smallInvoice.id, receiptNo: smallInvoice.receiptNo, applicable: 3_000_000, invoiceTotal: 3_000_000, userId }),
    ''
  )
  const capCredit = await issue({ amount: 10_000_000, multiUse: true, maxUses: 5, maxPerTransaction: 2_000_000 })
  const bigInvoice = plainInvoice(10_000_000)
  const capRes = await svc.redeemStoreCredit(db, {
    code: capCredit.code,
    invoiceId: bigInvoice.id,
    receiptNo: bigInvoice.receiptNo,
    applicable: 10_000_000,
    invoiceTotal: 10_000_000,
    userId
  })
  eq('سقف مبلغ هر تراکنش رعایت شد', capRes.applied, 2_000_000)

  // قفل مشتری
  const customerId = seed.customer('شرکت قفل‌شده', '09121110000')
  const lockedCredit = await issue({ amount: 5_000_000, customerId, customerLocked: true })
  const otherCustomer = seed.customer('مشتری دیگر', '09121110001')
  const otherInvoice = seed.invoiceWithLines([{ variantId: shirtVariant, qty: 1, lineTotal: 5_000_000, variantName: 'پیراهن' }], { customerId: otherCustomer })
  await throwsWith(
    'اعتبار قفل‌شده به مشتری، برای مشتری دیگر رد می‌شود',
    () => svc.redeemStoreCredit(db, { code: lockedCredit.code, invoiceId: otherInvoice.id, receiptNo: otherInvoice.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId }),
    ''
  )
}

// ===========================================================================
// بند ۱۲ · اتصال به تعویض کالا
// ===========================================================================
section('بند ۱۲ · ارتباط با تعویض کالا (§۱۹)')
{
  const sourceInvoice = plainInvoice(12_000_000)
  const exchangeInvoice = plainInvoice(4_000_000)
  const returnId = seed.insert('SaleReturn', { invoiceId: sourceInvoice.id, kind: 'EXCHANGE', total: 5_000_000, exchangeInvoiceId: exchangeInvoice.id })
  const credit = await svc.issueStoreCredit(db, {
    amount: 5_000_000,
    source: 'EXCHANGE',
    returnId,
    exchangeInvoiceId: exchangeInvoice.id,
    sourceInvoiceId: sourceInvoice.id,
    userId
  })
  const row = creditRow(credit.id)
  eq('لینک سند برگشت/تعویض حفظ شد', row.returnId, returnId)
  eq('لینک فاکتور تعویض حفظ شد', row.exchangeInvoiceId, exchangeInvoice.id)
  eq('لینک فاکتور اصلی حفظ شد', row.sourceInvoiceId, sourceInvoice.id)
  const detail = await svc.storeCreditService.detail({ id: credit.id })
  ok('صفحه‌ی جزئیات لینک‌ها را برمی‌گرداند', detail.credit.returnId === returnId && detail.credit.sourceInvoiceId === sourceInvoice.id)
  eq(
    'قواعد نوع تعویض از Backend آمد نه از ورودی',
    Math.round((row.expiresAt - row.issuedAt) / DAY),
    DEFAULT_CREDIT_SETTINGS.types.EXCHANGE.days
  )

  // برگشت فاکتور مرجع ⇒ مصرف برگشت می‌خورد (§۸)
  const inv = plainInvoice(5_000_000)
  await svc.redeemStoreCredit(db, { code: credit.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId })
  eq('اعتبار پس از مصرف بسته شد', creditRow(credit.id).status, StoreCreditStatus.USED)
  const reversed = await svc.reverseInvoiceRedemptions(db, { invoiceId: inv.id, reason: 'برگشت کامل فاکتور', userId })
  eq('یک مصرف برگشت خورد', reversed, 1)
  const after = creditRow(credit.id)
  eq('مبلغ مصرف‌شده به اعتبار برگشت', after.usedAmount, 0)
  eq('دفعات مصرف برگشت خورد', after.usedCount, 0)
  ok('ردیف دفتر مصرف حذف نشد، فقط برگشت خورد', seed.one('SELECT reversedAt FROM "StoreCreditRedemption" WHERE creditId = ?', credit.id)?.reversedAt != null)
  const invAgain = plainInvoice(5_000_000)
  const reuse = await svc.redeemStoreCredit(db, { code: credit.code, invoiceId: invAgain.id, receiptNo: invAgain.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId })
  eq('اعتبار برگشت‌خورده دوباره قابل استفاده است', reuse.applied, 5_000_000)

  // فاکتور باطل: اعتبار روی آن خرج نمی‌شود
  const canceledInvoice = seed.invoiceWithLines([{ variantId: shirtVariant, qty: 1, lineTotal: 5_000_000, variantName: 'پیراهن' }], { status: 'CANCELED' })
  const other = await issue({ amount: 5_000_000 })
  await throwsWith(
    'اعتبار روی فاکتور باطل‌شده مصرف نمی‌شود (§۸)',
    () => svc.redeemStoreCredit(db, { code: other.code, invoiceId: canceledInvoice.id, receiptNo: canceledInvoice.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId }),
    'باطل'
  )
  await throwsWith(
    'اعتبار روی فاکتور ناموجود مصرف نمی‌شود',
    () => svc.redeemStoreCredit(db, { code: other.code, invoiceId: 999_999, receiptNo: 1, applicable: 5_000_000, invoiceTotal: 5_000_000, userId }),
    'پیدا نشد'
  )
}

// ===========================================================================
// بند ۱۳ · Audit Log کامل + Timeline + قفل موقت کد
// ===========================================================================
section('بند ۱۳ · Audit Log و Timeline (§۱۰، §۱۶) و قفل موقت کد (§۸)')
{
  const credit = await issue({ amount: 6_000_000, multiUse: true, maxUses: 3, overrideReason: 'سند کامل' })
  const inv = plainInvoice(2_000_000)
  await svc.redeemStoreCredit(db, { code: credit.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 2_000_000, invoiceTotal: 2_000_000, userId })
  await svc.changeCreditExpiry({ id: credit.id, expiresAtJalali: '1406/06/01', reason: 'تمدید برای مشتری', managerPassword: PW, userId })
  await svc.suspendCredit({ id: credit.id, reason: 'بررسی', managerPassword: PW, userId })
  await svc.reactivateCredit({ id: credit.id, reason: 'تایید', managerPassword: PW, userId })
  await svc.voidCredit({ id: credit.id, reason: 'بسته شدن قرارداد', managerPassword: PW, userId })

  const detail = await svc.storeCreditService.detail({ id: credit.id })
  const actions = detail.timeline.map((e) => e.action ?? e.kind ?? '')
  for (const expected of ['CREDIT_ISSUE_MANUAL', 'STORE_CREDIT_REDEEM', 'CREDIT_EXPIRY_CHANGE', 'CREDIT_SUSPEND', 'CREDIT_REACTIVATE', 'CREDIT_VOID'])
    ok(`Timeline رویداد ${expected} را دارد`, JSON.stringify(detail.timeline).includes(expected))
  ok('Timeline خالی نیست و ترتیب دارد', detail.timeline.length >= 6, String(detail.timeline.length))
  eq('مبلغ مصرف‌شده در جزئیات درست است', detail.credit.usedAmount, 2_000_000)
  eq('باقی‌مانده در جزئیات درست است', detail.credit.remaining, 4_000_000)
  eq('دفعات استفاده‌شده در جزئیات درست است', detail.credit.usedCount, 1)
  eq('سوابق مصرف در جزئیات هست', detail.redemptions.length, 1)
  ok('هر سند مهم کاربر و زمان دارد', auditRows('CREDIT_VOID', credit.id).every((r) => r.userId === userId && r.at != null))

  // قفل موقت کد اشتباه (§۸ — همان الگوی AuthLockout)
  let lockMessage = ''
  for (let i = 0; i < 6; i++) {
    try {
      await svc.storeCreditService.lookup({ code: `ZZZ${i}0000`, userId })
    } catch (e) {
      lockMessage = String(e.message)
    }
  }
  ok('ورود مکرر کد اشتباه به قفل/هشدار رسید', /قفل|تلاش/.test(lockMessage), lockMessage.split('\n').slice(0, 2).join(' | '))
  ok('تلاش‌های ناموفق در AuditLog ثبت شدند', auditRows(AuditAction.CREDIT_REDEEM_BLOCKED).length >= 5)
  ok('گیت کد اعتبار روی جدول AuthLockout واقعی نشست', seed.count('AuthLockout') >= 1)
  // قفل باید بعد از تست باز شود تا بندهای بعدی مستقل بمانند
  seed.rows('DELETE FROM "AuthLockout"')
}

// ===========================================================================
// بند ۱۴ · Rollback روی خطای دیتابیس + fail-closed بودن AuditLog
// ===========================================================================
section('بند ۱۴ · Rollback و Data Integrity (§۲۴)')
{
  const credit = await issue({ amount: 5_000_000 })
  const before = creditRow(credit.id)

  // خطای واقعیِ دیتابیس وسط تراکنشِ ابطال: نه وضعیت عوض شود، نه سند نصفه بماند
  db.$harness.breakNext('AuditLog', 'create')
  await throwsWith('خطای دیتابیس وسط ابطال، عملیات را زمین می‌زند', () =>
    svc.voidCredit({ id: credit.id, reason: 'تست برگشت تراکنش', managerPassword: PW, userId })
  )
  db.$harness.clearBreak()
  const after = creditRow(credit.id)
  eq('وضعیت اعتبار برگشت خورد (ROLLBACK واقعی)', after.status, before.status)
  ok('هیچ سند ابطالی باقی نماند', auditRows(AuditAction.CREDIT_VOID, credit.id).length === 0)
  eq('اعتبار بعد از برگشت همان مبلغ را دارد', after.amount, before.amount)

  // مصرف: اگر ثبت دفتر مصرف بشکند، نباید مبلغ کم‌شده باقی بماند
  const credit2 = await issue({ amount: 5_000_000 })
  const inv = plainInvoice(5_000_000)
  await db.$transaction(async (tx) => {
    db.$harness.breakNext('StoreCreditRedemption', 'create')
    try {
      await svc.redeemStoreCredit(tx, { code: credit2.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId })
    } catch {
      /* انتظار داریم بشکند */
    }
    throw new Error('rollback')
  }).catch(() => {})
  db.$harness.clearBreak()
  const c2 = creditRow(credit2.id)
  eq('مبلغ مصرف‌شده‌ی نصفه برگشت خورد', c2.usedAmount, 0)
  eq('وضعیت اعتبار دست‌نخورده ماند', c2.status, StoreCreditStatus.ACTIVE)
  eq('هیچ ردیف دفتر مصرفی نماند', seed.count('StoreCreditRedemption', 'creditId = ?', credit2.id), 0)
  eq('هیچ پرداخت یتیمی نماند', seed.count('Payment', 'storeCreditId = ?', credit2.id), 0)
  // اعتبار باید همچنان سالم و قابل مصرف باشد
  const invOk = plainInvoice(5_000_000)
  const res = await svc.redeemStoreCredit(db, { code: credit2.code, invoiceId: invOk.id, receiptNo: invOk.receiptNo, applicable: 5_000_000, invoiceTotal: 5_000_000, userId })
  eq('همان اعتبار بعد از برگشت سالم مصرف شد', res.applied, 5_000_000)
}

// ===========================================================================
// افزوده ۱ · حذف واقعی در مقابل آرشیو (§۱۱)
// ===========================================================================
section('افزوده ۱ · حذف/آرشیو (§۱۱)')
{
  const unused = await issue({ amount: 2_000_000 })
  const del = await svc.deleteCredit({ id: unused.id, reason: 'اشتباه صادر شد', managerPassword: PW, userId })
  eq('اعتبار بدون مصرف «حذف» شد (mode سازگار)', del.mode, 'DELETED')
  // نشست ۱۶۰ · Y7 · بند ۴-۲۲ (S160-D1): حذف = void/آرشیو، نه پاک‌کردن فیزیکی؛ رکورد به‌عنوان مدرک می‌ماند
  ok('رکورد به‌عنوان مدرک ماند و deletedAt خورد', creditRow(unused.id) != null && creditRow(unused.id).deletedAt != null)
  eq('سند حذف در AuditLog ماند', auditRows(AuditAction.CREDIT_DELETE).length >= 1, true)

  const usedCredit = await issue({ amount: 3_000_000 })
  const inv = plainInvoice(3_000_000)
  await svc.redeemStoreCredit(db, { code: usedCredit.code, invoiceId: inv.id, receiptNo: inv.receiptNo, applicable: 3_000_000, invoiceTotal: 3_000_000, userId })
  const arch = await svc.deleteCredit({ id: usedCredit.id, reason: 'پاک‌سازی فهرست', managerPassword: PW, userId })
  eq('اعتبار مصرف‌شده آرشیو شد نه حذف', arch.mode, 'ARCHIVED')
  ok('رکورد و سابقه‌ی حسابداری‌اش ماند', creditRow(usedCredit.id) != null && creditRow(usedCredit.id).deletedAt != null)
  eq('ردیف دفتر مصرف حفظ شد', seed.count('StoreCreditRedemption', 'creditId = ?', usedCredit.id), 1)
  await throwsWith('اعتبار آرشیوشده قابل تغییر نیست', () => svc.voidCredit({ id: usedCredit.id, reason: 'تلاش روی آرشیو', managerPassword: PW, userId }), 'آرشیو')
}

// ===========================================================================
// افزوده ۲ · داشبورد، تعهد مالی و گزارش (§۱۵)
// ===========================================================================
section('افزوده ۲ · داشبورد و تعهد مالی (§۱۵)')
{
  const dash = await svc.storeCreditService.dashboard({})
  const totals = seed.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(usedAmount),0) AS used
     FROM "StoreCredit" WHERE deletedAt IS NULL`
  )
  eq('مجموع صادرشده‌ی داشبورد با دیتابیس یکی است', dash.issuedTotal, Number(totals.amount))
  eq('تعداد صادرشده‌ی داشبورد با دیتابیس یکی است', dash.issuedCount, Number(totals.n))
  eq('مجموع مصرف‌شده‌ی داشبورد با دیتابیس یکی است', dash.usedTotal, Number(totals.used))
  eq('مجموع باقی‌مانده = صادرشده − مصرف‌شده', dash.remainingTotal, Number(totals.amount) - Number(totals.used))
  /**
   * داشبورد روی **وضعیت مؤثر** حساب می‌کند (تصمیم جلسه ۳۰): یک ردیف `ACTIVE`ِ
   * تاریخ‌گذشته باید در سطل «منقضی» بنشیند، نه «فعال». پس گزاره هم باید همان
   * را بسنجد، وگرنه تست، باگ را «درست» جا می‌زد.
   */
  eq(
    'تعداد فعالِ داشبورد بر اساس وضعیت مؤثر است (نه ستون status)',
    dash.activeCount,
    seed.count('StoreCredit', "deletedAt IS NULL AND status IN ('ACTIVE','PARTIALLY_USED') AND (expiresAt IS NULL OR expiresAt > ?)", Date.now())
  )
  ok(
    'اعتبارِ تاریخ‌گذشته در سطل منقضی شمرده شد',
    dash.expiredCount >= seed.count('StoreCredit', "deletedAt IS NULL AND status IN ('ACTIVE','PARTIALLY_USED') AND expiresAt IS NOT NULL AND expiresAt <= ?", Date.now()),
    `expiredCount=${dash.expiredCount}`
  )
  eq(
    'جمع سطل‌های وضعیت با کل صادرشده می‌خواند (هیچ ردیفی گم/دوبار نشد)',
    dash.byStatus.reduce((s, b) => s + b.count, 0),
    dash.issuedCount
  )
  eq(
    'تعداد ابطال‌شده با دیتابیس یکی است',
    dash.canceledCount,
    seed.count('StoreCredit', "deletedAt IS NULL AND status = 'CANCELED'")
  )
  ok('تعداد منقضی گزارش می‌شود', Number.isInteger(dash.expiredCount))
  ok('تعداد نزدیک‌به‌انقضا گزارش می‌شود', Number.isInteger(dash.nearExpiryCount))
  ok('تعداد امروز گزارش می‌شود', Number.isInteger(dash.todayCount) && dash.todayCount > 0)
  ok('ارزش ریالی اعتبارهای فعال گزارش می‌شود', Number(dash.activeValue) >= 0)
  eq('تعهد فروشگاه (§۱۵) گزارش می‌شود', dash.liabilityReported, true)
  ok('تعهد = باقی‌مانده‌ی اعتبارهای زنده', Number(dash.liability) > 0, String(dash.liability))
  ok('تفکیک به وضعیت دارد', Array.isArray(dash.byStatus) && dash.byStatus.length > 0)
  ok('تفکیک به نوع دارد (مدیریتی/تعویض)', dash.bySource.some((r) => r.source === 'MANUAL') && dash.bySource.some((r) => r.source === 'EXCHANGE'))
  eq(
    'جمع تفکیک نوع با کل صادرشده می‌خواند',
    dash.bySource.reduce((s, r) => s + r.amount, 0),
    Number(totals.amount)
  )
  const list = await svc.storeCreditService.list({ take: 50 })
  ok('فهرست اعتبارها با فیلتر کار می‌کند', Array.isArray(list) && list.length > 0, String(list.length))
  const manualOnly = await svc.storeCreditService.list({ source: 'MANUAL', take: 500 })
  ok('فیلتر نوع «صادرشده توسط مدیریت» کار می‌کند', manualOnly.every((r) => r.source === 'MANUAL'))
  const batches = await svc.storeCreditService.batches({ take: 10 })
  ok('گزارش دسته‌های تولید گروهی داده دارد', batches.length >= 1, String(batches.length))
}

// ===========================================================================
// افزوده ۳ · یادآوری بدون اتصال پیامک (§۱۴)
// ===========================================================================
section('افزوده ۳ · زیرساخت یادآوری (§۱۴)')
{
  const customerId = seed.customer('شرکت یادآوری', '09129998877')
  const credit = await issue({ amount: 4_000_000, customerId, customerName: 'شرکت یادآوری', holderPhone: '09129998877' })
  seed.rows('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?', Date.now() - 40 * DAY, credit.id)

  const cand = await svc.storeCreditService.reminderCandidates({ take: 500 })
  const mine = cand.rows.find((r) => r.credit.id === credit.id)
  ok('اعتبار مصرف‌نشده‌ی قدیمی در فهرست واجدین یادآوری هست', mine != null)
  ok('دلیل فارسی تصمیم یادآوری موجود است', typeof mine?.reason === 'string' && mine.reason.length > 0, mine?.reason)

  const queued = await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const log = seed.one('SELECT * FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC', credit.id)
  ok('یادآوری در جدول CreditReminderLog ثبت شد', log != null)
  /**
   * ===================== تستِ ناپایدار (flaky) جلسه ۳۵ — پیدا و تثبیت شد =====================
   * علامتش: یک اجرا ۲۰۲ PASS · ۰ FAIL و اجرای بعدی ۲۰۱ · ۱، همیشه روی همین گزاره.
   *
   * علتش **در تست بود، نه در پروژه**: متن یادآوری همه‌ی عددهایش را با رقم فارسی
   * می‌سازد («۴٬۰۰۰٬۰۰۰ ریال»، «۱۴۰۵/۰۷/۲۸»)، ولی این گزاره با `\d` دنبال رقم
   * *لاتین* می‌گشت. تنها رقم لاتینی که می‌توانست در متن باشد، رقم‌های داخل کدِ
   * تصادفی اعتبار بود (الفبای پیش‌فرض `ALNUM`) — پس تست وقتی سبز می‌شد که قرعه‌ی
   * کد رقم داشت (مثل `CR7NLBQ2`) و وقتی قرمز می‌شد که نداشت (مثل `CRNLBQEH`).
   * یعنی گزاره اصلاً چیزی را که ادعا می‌کرد نمی‌سنجید.
   *
   * تثبیت: هم رقم فارسی و هم لاتین پذیرفته می‌شود (چیزی که واقعاً معنا دارد:
   * «جای placeholder عدد نشسته باشد») و علاوه بر آن، صریح بررسی می‌شود که مبلغ و
   * تاریخِ *همین* اعتبار داخل متن آمده باشد. با این تغییر، نتیجه دیگر به قرعه‌ی
   * کد وابسته نیست.
   * =========================================================================================
   */
  const reminderText = log?.text ?? ''
  ok(
    'متن نهایی با Placeholder های پرشده ذخیره شد',
    /[0-9\u06F0-\u06F9]/.test(reminderText) && !/\{\{/.test(reminderText),
    reminderText
  )
  ok('مبلغ همین اعتبار داخل متن یادآوری آمده است', reminderText.includes(money(4_000_000)), reminderText)
  ok('کد همین اعتبار داخل متن یادآوری آمده است', reminderText.includes(credit.code), credit.code)
  ok('شماره‌ی مقصد snapshot شد', log?.phone === '09129998877')
  ok('Placeholder ها به شکل JSON نگه داشته شدند', /credit_code|credit_amount/.test(log?.placeholdersJson ?? ''))
  ok('هیچ ارسال واقعی ادعا نشد (وضعیت آماده/لاگ‌شده)', ['READY', 'LOGGED'].includes(String(log?.status)), String(log?.status))

  const again = await svc.storeCreditService.queueReminder({ id: credit.id, userId })
  const logs = seed.rows('SELECT status FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id', credit.id)
  eq('یادآوری تکراری در فاصله‌ی مجاز رد شد (ضداسپم)', String(logs.at(-1).status), 'SKIPPED')
  eq('شمارنده‌ی یادآوری با تلاش ردشده بالا نرفت', creditRow(credit.id).reminderCount, 1)

  const optOut = await issue({ amount: 1_000_000, holderPhone: '09121234567', reminderOptOut: true })
  seed.rows('UPDATE "StoreCredit" SET issuedAt = ? WHERE id = ?', Date.now() - 40 * DAY, optOut.id)
  await svc.storeCreditService.queueReminder({ id: optOut.id, userId })
  eq(
    'مشتری Opt-out هیچ‌وقت پیام نمی‌گیرد',
    String(seed.one('SELECT status FROM "CreditReminderLog" WHERE creditId = ? ORDER BY id DESC', optOut.id)?.status),
    'OPTED_OUT'
  )
}

// ===========================================================================
// افزوده ۴ · شمارنده‌ی چاپ و «نسخه‌ی مجدد» (§۱۳)
// ===========================================================================
section('افزوده ۴ · شمارنده‌ی چاپ (§۱۳)')
{
  const credit = await issue({ amount: 2_500_000 })
  eq('اعتبار تازه هنوز چاپ نشده', creditRow(credit.id).printCount, 0)
  await svc.storeCreditService.markPrinted({ id: credit.id, userId, channel: 'PRINT' })
  eq('اولین چاپ شمرده شد', creditRow(credit.id).printCount, 1)
  ok('زمان آخرین چاپ ثبت شد', creditRow(credit.id).lastPrintedAt != null)
  await svc.storeCreditService.markPrinted({ id: credit.id, userId, channel: 'PRINT' })
  eq('چاپ دوم هم شمرده شد (مبنای برچسب نسخه‌ی مجدد)', creditRow(credit.id).printCount, 2)
  ok('چاپ مجدد اعتبار جدیدی نساخت', seed.count('StoreCredit', 'id > ?', credit.id) === 0)
  ok('سند چاپ در AuditLog ثبت شد', seed.count('AuditLog', "entityId = ? AND action LIKE '%PRINT%'", credit.id) >= 1)
}

// ===========================================================================
console.log('')
if (failures.length) {
  console.log('گزاره‌های ناموفق:')
  for (const f of failures) console.log(`  • ${f}`)
}
console.log(`\nهارنس واقعی دیتابیس (جلسه ۳۵): ${pass} PASS · ${failures.length} FAIL`)
console.log(`دیتابیس تست: ${process.env.HARNESS_DB}`)
process.exit(failures.length ? 1 : 0)
