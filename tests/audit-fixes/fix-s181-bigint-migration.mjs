// نشست ۱۸۱: تست قبل/بعد خوشه M بند ۴-۲۸ الف — مهاجرت ۸۳ فیلد مالی به BigInt.
/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف — مهاجرت واقعی
 *
 * قبل از رفع: ۸۳ ستون مالی از نوع `Int` بودند. Prisma آن‌ها را به `number`
 * نگاشت می‌کرد، پس هر مبلغی بالای `Number.MAX_SAFE_INTEGER` بی‌صدا گرد می‌شد.
 *
 * انتظار بعد: همان ۸۳ ستون `BigInt`اند، **داده‌ی موجود مو‌به‌مو حفظ شده**، و
 * مبالغ بزرگ بدون افت دقت رفت‌وبرگشت می‌کنند.
 *
 * این تست migration را روی یک دیتابیس **واقعی** (`node:sqlite`) و از مسیر
 * **همان فایل‌های migration واقعی پروژه** اجرا می‌کند — نه شبیه‌سازی.
 *
 * دو سناریو جدا سنجیده می‌شود، چون ریسکشان فرق دارد:
 *   الف) دیتابیس **تازه**: همه‌ی ۲۷ migration از صفر.
 *   ب) دیتابیس **موجود با داده**: ۲۶ migration، داده‌ی واقعی، بعد migration ۲۷.
 *      این حالتِ مشتری واقعی است و تنها جایی است که از دست رفتن داده ممکن است.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s181-bigint-migration.mjs
 * ===========================================================================
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MIGRATIONS_DIR = join(ROOT, 'prisma/migrations')
const NEW_MIGRATION = '20271004100000_money_fields_to_bigint'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const g = typeof got === 'bigint' ? `${got}n` : JSON.stringify(got)
  const w = typeof want === 'bigint' ? `${want}n` : JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${g} · انتظار ${w}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)

// ⚠️ اولین migration پروژه `0_init` نام دارد، نه یک مهرزمانی ۱۴ رقمی. فیلتر باید
// «هر پوشه‌ای که migration.sql دارد» باشد، وگرنه جدول‌های پایه ساخته نمی‌شوند.
// مرتب‌سازی لغوی درست است چون '0' < '2' و بقیه هم‌طولِ مهرزمانی‌اند.
const allMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, 'migration.sql')))
  .map((d) => d.name)
  .sort()

/**
 * یک دیتابیس تازه می‌سازد و migrationها را تا `upTo` (شاملش) اجرا می‌کند.
 * ⚠️ مسیر موقت ثبت می‌شود تا در پایان پاک شود: `/tmp` در این محیط یک tmpfs
 * کوچک است و چند اجرای پشت سر هم آن را پر می‌کند — که بعد به شکل خطای
 * گیج‌کننده‌ی «database or disk is full» در تست‌های *دیگر* ظاهر می‌شود.
 */
const tempDirs = []
function buildDb(upTo = null) {
  const dir = mkdtempSync(join(tmpdir(), 'mahak-s181-mig-'))
  tempDirs.push(dir)
  const db = new DatabaseSync(join(dir, 'shop.db'))
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of allMigrations) {
    if (upTo && name > upTo) break
    const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8')
    try {
      db.exec(sql)
    } catch (e) {
      throw new Error(`migration «${name}» اجرا نشد: ${e.message}`)
    }
  }
  return db
}

/** نوع اعلام‌شده‌ی یک ستون را از `PRAGMA table_info` می‌خواند. */
function columnType(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all()
  const row = rows.find((r) => r.name === column)
  return row ? row.type : null
}

// ---------------------------------------------------------------------------
console.log('\n— ۰) خودِ هارنس: آیا migrationها اصلاً اجرا می‌شوند؟ —')
ok(`تعداد migrationها (${allMigrations.length})`, allMigrations.length >= 28)
// نشست ۱۸۳: دیگر لازم نیست آخرین باشد؛ فقط باید وجود داشته باشد و در جای خودش بماند.
ok('migration مهاجرت پول در فهرست هست', allMigrations.includes(NEW_MIGRATION))

// ---------------------------------------------------------------------------
console.log('\n— ۱) دیتابیس تازه از کل ۲۷ migration —')
{
  const db = buildDb()
  ok('کل ۲۷ migration بدون خطا اجرا شد', true)

  // نمونه‌ای از هر سه گروه طبقه‌بندی
  eq('ستون پول BIGINT شد (SaleInvoice.grandTotal)', columnType(db, 'SaleInvoice', 'grandTotal'), 'BIGINT')
  eq('ستون پول BIGINT شد (Payment.amount)', columnType(db, 'Payment', 'amount'), 'BIGINT')
  eq('ستون پول BIGINT شد (CashSession.expectedCash)', columnType(db, 'CashSession', 'expectedCash'), 'BIGINT')
  eq('ستون پولِ nullable هم BIGINT شد (CashSession.countedTotal)', columnType(db, 'CashSession', 'countedTotal'), 'BIGINT')
  eq('شناسه INTEGER ماند (SaleInvoice.id)', columnType(db, 'SaleInvoice', 'id'), 'INTEGER')
  eq('کلید خارجی INTEGER ماند (SaleInvoiceItem.invoiceId)', columnType(db, 'SaleInvoiceItem', 'invoiceId'), 'INTEGER')
  eq('تعداد INTEGER ماند (SaleInvoiceItem.qty)', columnType(db, 'SaleInvoiceItem', 'qty'), 'INTEGER')
  eq('شماره‌ی فیش INTEGER ماند (SaleInvoice.receiptNo)', columnType(db, 'SaleInvoice', 'receiptNo'), 'INTEGER')
  eq('درصد INTEGER ماند (SaleInvoice.wholesaleDiscountPercent)',
    columnType(db, 'SaleInvoice', 'wholesaleDiscountPercent'), 'INTEGER')

  // ایندکس‌ها و یکتایی‌ها باید از بازسازی جدول جان سالم به در برده باشند.
  const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='SaleInvoice'`).all()
  ok('ایندکس‌های SaleInvoice بعد از بازسازی جدول باقی مانده‌اند', idx.length > 0)
  const uniq = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='SaleInvoice_receiptNo_key'`).all()
  eq('یکتایی شماره‌ی فیش حفظ شد', uniq.length, 1)
  db.close()
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) دیتابیس موجودِ دارای داده: هیچ ریالی گم نمی‌شود —')
/**
 * این مهم‌ترین بخش است. بازسازی جدول در SQLite یعنی
 * `CREATE new_X` → `INSERT ... SELECT` → `DROP X` → `RENAME`.
 * اگر یک ستون در فهرست `INSERT` جا بیفتد، آن ستون **بی‌صدا صفر/NULL** می‌شود.
 */
{
  // نشست ۱۸۳ — لنگر به migration پول، نه «یکی‌مانده‌به‌آخر» (migrationهای بعدی اضافه شده‌اند)
  const before = allMigrations[allMigrations.indexOf(NEW_MIGRATION) - 1]
  const db = buildDb(before)
  eq('ستون پول قبل از مهاجرت INTEGER بود', columnType(db, 'SaleInvoice', 'grandTotal'), 'INTEGER')

  db.exec(`INSERT INTO User (id, username, passwordHash, displayName, role, isActive, createdAt)
           VALUES (1, 'admin', 'x', 'مدیر', 'ADMIN', 1, CURRENT_TIMESTAMP)`)
  db.exec(`INSERT INTO SaleInvoice (id, receiptNo, userId, issuedAt, issuedAtJalali, status,
      goodsTotal, taxTotal, serviceCharge, discountTotal, deliveryFee, grandTotal, paidTotal)
      VALUES (1, 1001, 1, CURRENT_TIMESTAMP, '۱۴۰۴/۰۷/۰۵', 'PAID', 1500000, 135000, 0, 50000, 20000, 1605000, 0)`)
  db.exec(`INSERT INTO SaleInvoice (id, receiptNo, userId, issuedAt, issuedAtJalali, status,
      goodsTotal, taxTotal, serviceCharge, discountTotal, deliveryFee, grandTotal, paidTotal)
      VALUES (2, 1002, 1, CURRENT_TIMESTAMP, '۱۴۰۴/۰۷/۰۵', 'PAID', 0, 0, 0, 0, 0, -250000, 0)`)

  const rowsBefore = db.prepare('SELECT * FROM SaleInvoice ORDER BY id').all()

  // حالا migration مهاجرت را اجرا کن — دقیقاً مثل به‌روزرسانی یک نصبِ واقعی.
  const sql = readFileSync(join(MIGRATIONS_DIR, NEW_MIGRATION, 'migration.sql'), 'utf-8')
  db.exec(sql)

  eq('بعد از مهاجرت ستون BIGINT شد', columnType(db, 'SaleInvoice', 'grandTotal'), 'BIGINT')

  const rowsAfter = db.prepare('SELECT * FROM SaleInvoice ORDER BY id').all()
  eq('تعداد ردیف‌ها تغییر نکرد', rowsAfter.length, rowsBefore.length)

  // مقایسه‌ی ستون‌به‌ستونِ *همه‌ی* ستون‌ها، نه فقط آن‌هایی که حدس می‌زنیم مهم‌اند.
  let mismatch = null
  for (let i = 0; i < rowsBefore.length; i++) {
    for (const key of Object.keys(rowsBefore[i])) {
      const a = rowsBefore[i][key]
      const b = rowsAfter[i][key]
      if (String(a) !== String(b)) { mismatch ??= `ردیف ${i} ستون ${key}: ${a} ⇒ ${b}`; break }
    }
  }
  eq(`همه‌ی ستون‌های همه‌ی ردیف‌ها دست‌نخورده‌اند${mismatch ? ` (${mismatch})` : ''}`, mismatch, null)
  eq('مبلغ مشخص سالم ماند', String(rowsAfter[0].grandTotal), '1605000')
  eq('مبلغ منفی سالم ماند', String(rowsAfter[1].grandTotal), '-250000')
  eq('شماره‌ی فیش سالم ماند', String(rowsAfter[0].receiptNo), '1001')
  db.close()
}

// ---------------------------------------------------------------------------
console.log('\n— ۳) همان چیزی که کل این کار برای آن انجام شد: مبلغ بالای MAX_SAFE_INTEGER —')
{
  const db = buildDb()
  db.exec(`INSERT INTO User (id, username, passwordHash, displayName, role, isActive, createdAt)
           VALUES (1, 'admin', 'x', 'مدیر', 'ADMIN', 1, CURRENT_TIMESTAMP)`)

  // یک گردش سالانه‌ی چند همتی — بزرگ‌تر از ۹٬۰۰۷ تریلیارد.
  const huge = 9007199254740993n // MAX_SAFE_INTEGER + 2
  const stmt = db.prepare(`INSERT INTO SaleInvoice (id, receiptNo, userId, issuedAt, issuedAtJalali,
      status, goodsTotal, taxTotal, serviceCharge, discountTotal, deliveryFee, grandTotal, paidTotal)
      VALUES (1, 1, 1, CURRENT_TIMESTAMP, '۱۴۰۴/۰۷/۰۵', 'PAID', 0, 0, 0, 0, 0, ?, 0)`)
  stmt.run(huge)

  const readBig = db.prepare('SELECT grandTotal FROM SaleInvoice WHERE id = 1')
  readBig.setReadBigInts(true)
  eq('مبلغ بزرگ بدون افت دقت رفت‌وبرگشت کرد', readBig.get().grandTotal, huge)

  // و اثبات اینکه چرا `number` کافی نبود:
  ok('همین مقدار در number گرد می‌شد', BigInt(Number(huge)) !== huge)

  // جمع در سطح SQL هم باید دقیق بماند (گزارش‌ها از SUM استفاده می‌کنند).
  const s = db.prepare('SELECT SUM(grandTotal) AS t FROM SaleInvoice')
  s.setReadBigInts(true)
  eq('SUM در سطح SQL دقیق است', s.get().t, huge)
  db.close()
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) کلیدهای خارجی بعد از بازسازی ۱۸ جدول سالم‌اند —')
/**
 * بازسازی جدول با `PRAGMA foreign_keys=OFF` انجام می‌شود. اگر ترتیب
 * DROP/RENAME اشتباه باشد، ارجاع‌ها می‌توانند بی‌صدا بشکنند و تازه ماه‌ها بعد
 * به شکل «فاکتور بدون ردیف» خودشان را نشان دهند.
 */
{
  const db = buildDb()
  db.exec(`INSERT INTO User (id, username, passwordHash, displayName, role, isActive, createdAt)
           VALUES (1, 'admin', 'x', 'مدیر', 'ADMIN', 1, CURRENT_TIMESTAMP)`)
  db.exec(`INSERT INTO Category (id, name) VALUES (1, 'عمومی')`)
  db.exec(`INSERT INTO Product (id, name, categoryId, isActive, createdAt, updatedAt)
           VALUES (1, 'کالا', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
  db.exec(`INSERT INTO ProductVariant (id, productId, code, barcode, salePrice, purchasePrice,
           stock, minStock, isActive, createdAt, updatedAt)
           VALUES (1, 1, 'K-1', '111', 50000, 30000, 10, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
  db.exec(`INSERT INTO SaleInvoice (id, receiptNo, userId, issuedAt, issuedAtJalali, status,
      goodsTotal, taxTotal, serviceCharge, discountTotal, deliveryFee, grandTotal, paidTotal)
      VALUES (1, 1, 1, CURRENT_TIMESTAMP, '۱۴۰۴/۰۷/۰۵', 'PAID', 50000, 0, 0, 0, 0, 50000, 0)`)
  db.exec(`INSERT INTO SaleInvoiceItem (id, invoiceId, variantId, qty, unitPrice, discount, tax, lineTotal)
           VALUES (1, 1, 1, 1, 50000, 0, 0, 50000)`)

  const fkErrors = db.prepare('PRAGMA foreign_key_check').all()
  eq('PRAGMA foreign_key_check هیچ ارجاع شکسته‌ای پیدا نکرد', fkErrors.length, 0)

  // و محدودیت واقعاً فعال است (نه اینکه صرفاً چیزی برای شکستن نباشد).
  let rejected = false
  try {
    db.exec(`INSERT INTO SaleInvoiceItem (id, invoiceId, variantId, qty, unitPrice, discount, tax, lineTotal)
             VALUES (2, 999, 1, 1, 1, 0, 0, 1)`)
  } catch { rejected = true }
  ok('ارجاع به فاکتور ناموجود رد می‌شود (کلید خارجی واقعاً فعال است)', rejected)

  // آبشار حذف هم باید بعد از بازسازی سر جایش باشد.
  // ⚠️ اگر ON DELETE CASCADE در بازسازی جدول گم شود، خودِ DELETE استثنا می‌دهد.
  // بدون try/catch، تست به‌جای گزارشِ خوانا با stack trace می‌میرد (جهش M6).
  let cascadeResult
  try {
    db.exec('DELETE FROM SaleInvoice WHERE id = 1')
    cascadeResult = db.prepare('SELECT COUNT(*) AS c FROM SaleInvoiceItem').get().c
  } catch (e) {
    cascadeResult = `THREW: ${e.message}`
  }
  eq('حذف آبشاری ردیف‌های فاکتور کار می‌کند', cascadeResult, 0)
  db.close()
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) هیچ ستونی در INSERT ... SELECT جا نیفتاده —')
/**
 * بی‌صداترین شکستِ ممکن در بازسازی جدول: ستونی که در `INSERT` نیامده باشد.
 * به‌جای اعتماد به چشم، فهرست ستون‌های هر `INSERT INTO new_X` با تعداد ستون‌های
 * همان جدول در دیتابیس ساخته‌شده مقایسه می‌شود.
 */
{
  /**
   * نشست ۱۸۳ — دیتابیس فقط تا **همین** migration ساخته می‌شود.
   * اگر تا آخرِ فهرست جلو برویم، ستون‌هایی که migrationهای بعدی اضافه کرده‌اند
   * (مثل `StoreCredit.carryRemainder`) به‌عنوان «ستون جامانده» گزارش می‌شوند —
   * هشدار کاذبی که ربطی به این migration ندارد.
   */
  const db = buildDb(NEW_MIGRATION)
  const sql = readFileSync(join(MIGRATIONS_DIR, NEW_MIGRATION, 'migration.sql'), 'utf-8')
  const inserts = [...sql.matchAll(/INSERT INTO "new_(\w+)" \(([^)]*)\) SELECT ([^]*?) FROM "\1";/g)]
  eq('برای هر جدول بازتعریف‌شده یک INSERT هست', inserts.length,
    (sql.match(/^CREATE TABLE "new_/gm) || []).length)

  /**
   * تجزیه‌ی فهرست ستون‌ها باید پرانتزآگاه باشد: Prisma برای ستون‌هایی که
   * DEFAULT دیتابیسی‌شان برداشته می‌شود عبارتی مثل
   *   coalesce("createdAt", CURRENT_TIMESTAMP) AS "createdAt"
   * می‌نویسد که خودش کاما دارد. جدا کردن ساده با «,» عدد غلط می‌دهد.
   */
  const splitTop = (text) => {
    const out = []
    let depth = 0
    let cur = ''
    for (const ch of text) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
    }
    if (cur.trim()) out.push(cur)
    return out.map((c) => c.trim()).filter(Boolean)
  }
  /** نام مقصدِ یک عبارت SELECT: یا نام مستعار `AS "x"` یا خودِ ستون. */
  const targetName = (expr) => {
    const alias = /\sAS\s+"([^"]+)"\s*$/i.exec(expr)
    if (alias) return alias[1]
    const plain = /^"([^"]+)"$/.exec(expr)
    return plain ? plain[1] : expr
  }

  const bad = []
  for (const [, table, colsRaw, selRaw] of inserts) {
    const cols = splitTop(colsRaw).map((c) => c.replace(/"/g, ''))
    const sel = splitTop(selRaw).map(targetName)
    const actual = db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name)
    const missing = actual.filter((c) => !cols.includes(c))
    if (missing.length) bad.push(`${table}: ستون‌های جامانده ${missing.join(',')}`)
    if (cols.length !== sel.length) bad.push(`${table}: تعداد ستون INSERT (${cols.length}) با SELECT (${sel.length}) نمی‌خواند`)
    // ترتیب هم باید یکی باشد، وگرنه مقدار ستون A در ستون B می‌نشیند.
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] !== sel[i]) { bad.push(`${table}: ترتیب ستون ${i} — INSERT «${cols[i]}» ولی SELECT «${sel[i]}»`); break }
    }
  }
  eq(`هر ۱۸ جدول همه‌ی ستون‌هایشان را منتقل می‌کنند${bad.length ? ` (${bad[0]})` : ''}`, bad.length, 0)
  db.close()
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true })

// ---------------------------------------------------------------------------
console.log('\n— ۶) migration *فقط* نوع ستون‌های پول را عوض می‌کند —')
/**
 * 🔴 درس نشست ۱۸۱ — این بررسی از یک باگ واقعی زاده شد.
 *
 * خروجی خام `prisma migrate diff` علاوه بر تغییر نوع، یک drift از-قبل-موجود را
 * هم «تعمیر» می‌کرد و بی‌صدا دو چیز دیگر را عوض کرد:
 *   • `StoreCredit.updatedAt` پیش‌فرض `CURRENT_TIMESTAMP` را از دست داد ⇒ هر
 *     `INSERT` خامی که آن ستون را نمی‌نوشت با «NOT NULL constraint failed»
 *     می‌افتاد. تست `tests/audit/audit-a107-01-credit-batch-scope.mjs` دقیقاً
 *     همین شد — و چون هارنس رگرسیون آن پوشه را اجرا نمی‌کرد، دیده نشد.
 *   • `Payment.createdAt` از nullable به `NOT NULL DEFAULT ...` رفت.
 *
 * یک migration «تغییر نوع ستون» نباید محدودیت‌های دیتابیسِ نصب‌های موجودِ
 * مشتری را جابه‌جا کند. این بررسی کل اسکیما را قبل و بعد مقایسه می‌کند و
 * اجازه می‌دهد **تنها** تفاوت مجاز `INTEGER → BIGINT` روی فیلدهای فهرست پول
 * باشد؛ هر ستون، پیش‌فرض، کلید خارجی یا ایندکسِ دیگری که تکان بخورد، قرمز است.
 */
{
  const { MONEY_FIELDS } = await import('../../tools/money-fields.mjs')
  const money = new Set(MONEY_FIELDS)

  const snapshot = (upTo) => {
    const db = buildDb(upTo)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
    const out = {}
    for (const t of tables) {
      for (const c of db.prepare(`PRAGMA table_info("${t}")`).all())
        out[`ستون ${t}.${c.name}`] = { type: c.type, notnull: c.notnull, def: c.dflt_value }
      for (const f of db.prepare(`PRAGMA foreign_key_list("${t}")`).all())
        out[`کلیدخارجی ${t}.${f.from}→${f.table}.${f.to}`] = { onDelete: f.on_delete, onUpdate: f.on_update }
      for (const x of db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ?")
        .all(t))
        out[`ایندکس ${x.name}`] = { sql: x.sql }
    }
    db.close()
    return out
  }

  /**
   * ⚠️ نشست ۱۸۳ — لنگر به **نام** migration پول، نه «آخرین migration».
   *
   * نسخه‌ی اول این بررسی `length - 2` را با `null` مقایسه می‌کرد، یعنی فرض
   * می‌گرفت migration پول همیشه آخری است. با اضافه شدن هر migration بعدی
   * (مثل `credit_carry_remainder`) این بررسی شروع می‌کرد به سنجیدنِ آن
   * migration بی‌ربط و قرمز می‌شد — یک هشدار کاذب که به‌مرور اعتمادش را از
   * دست می‌داد و کسی جدی نمی‌گرفتش.
   */
  const moneyIdx = allMigrations.indexOf(NEW_MIGRATION)
  ok('migration پول در فهرست پیدا شد', moneyIdx > 0)
  const before = snapshot(allMigrations[moneyIdx - 1])
  const after = snapshot(NEW_MIGRATION)

  const unexpected = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key]
    const a = after[key]
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    // تنها تفاوت مجاز: INTEGER ⇒ BIGINT روی ستونی که در فهرست پول است
    const m = /^ستون (\w+)\.(\w+)$/.exec(key)
    const allowed =
      m &&
      b &&
      a &&
      money.has(`${m[1]}.${m[2]}`) &&
      b.type === 'INTEGER' &&
      a.type === 'BIGINT' &&
      b.notnull === a.notnull &&
      String(b.def) === String(a.def)
    if (!allowed) unexpected.push(`${key}: ${JSON.stringify(b)} ⇒ ${JSON.stringify(a)}`)
  }
  eq(
    `هیچ تغییر ناخواسته‌ای در اسکیما نیست${unexpected.length ? ` (${unexpected[0]})` : ''}`,
    unexpected.length,
    0
  )

  // و آن‌طرفِ سکه: همه‌ی ۸۳ فیلد پول واقعاً عوض شده باشند (نه اینکه هیچ‌کدام)
  const converted = Object.entries(after).filter(([k, v]) => {
    const m = /^ستون (\w+)\.(\w+)$/.exec(k)
    return m && money.has(`${m[1]}.${m[2]}`) && v.type === 'BIGINT'
  }).length
  eq('هر ۸۳ ستون پول به BIGINT رفته‌اند', converted, MONEY_FIELDS.length)

  // بازتولید دقیق شکستی که در نشست ۱۸۱ رخ داد
  {
    const db = buildDb(null)
    let threw = null
    try {
      db.exec(
        `INSERT INTO StoreCredit (code, amount, usedAmount, status, source, issuedAt, issuedAtJalali)
         VALUES ('T1', 100000, 0, 'ACTIVE', 'MANUAL', CURRENT_TIMESTAMP, '۱۴۰۴/۰۷/۰۵')`
      )
    } catch (e) {
      threw = e.message
    }
    eq(`INSERT خام بدون updatedAt هنوز کار می‌کند${threw ? ` (${threw})` : ''}`, threw, null)
    db.close()
  }
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
