/**
 * ===========================================================================
 * جلسه ۳۵ · هارنس واقعی §۲۳ — لایه‌ی ۲: مترجم Prisma → SQL روی `node:sqlite`
 * ---------------------------------------------------------------------------
 * این فایل *جای* `@prisma/client` را در محیط بدون npm می‌گیرد، نه جای دیتابیس.
 * جدول‌ها، ایندکس‌های یکتا و تراکنش‌ها واقعی‌اند (schema.mjs)؛ اینجا فقط
 * فراخوانی‌های Prisma به SQL ترجمه می‌شوند.
 *
 * قاعده‌ی سختِ این فایل (وگرنه کل هارنس بی‌ارزش است):
 * **هر ساختاری که پشتیبانی نشده، `throw` می‌شود.** یک `where` ناشناخته هرگز
 * نباید بی‌صدا به «همه‌ی ردیف‌ها» یا «هیچ ردیفی» ترجمه شود، چون آن وقت تست
 * سبزِ دروغ می‌دهد. هر خطای `HARNESS:` یعنی مترجم کم دارد، نه پروژه.
 *
 * چیزهایی که عمداً واقعی‌اند:
 *   • تصادم کد ⇒ خطای واقعی `UNIQUE constraint failed` که به `code = 'P2002'`
 *     ترجمه می‌شود (سرویس همین را می‌گیرد و retry می‌کند — §۶).
 *   • `$transaction` ⇒ BEGIN IMMEDIATE / COMMIT / ROLLBACK واقعی، و تراکنش
 *     تودرتو ⇒ SAVEPOINT واقعی. پس تست Rollback (§۲۴) واقعاً چیزی را برمی‌گرداند.
 *   • `updateMany` با شرط خوش‌بینانه ⇒ `changes` واقعیِ SQLite است، پس تست
 *     «دو صندوق هم‌زمان» (§۹) روی همان مکانیزمِ محصول اجرا می‌شود.
 * ===========================================================================
 */
import { DatabaseSync } from 'node:sqlite'
import { buildDatabase, introspect, parseSchema } from './schema.mjs'

const fail = (msg) => {
  throw new Error(`HARNESS: ${msg}`)
}

const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

const OPS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode'
])

export function createClient(file, { fresh = true } = {}) {
  // کلاینت اصلی هر تست از صفر ساخته می‌شود، اما PrismaClient موقتِ MergeService
  // باید یک backup موجود را *باز کند* نه این‌که با migrationها بازنویسی‌اش کند.
  const rawDb = fresh ? buildDatabase(file).db : new DatabaseSync(file)

  /**
   * ===========================================================================
   * نشست ۱۸۱ · بند ۴-۲۸ الف — «هارنس وفادار به BigInt» (پیش‌فرض: خاموش)
   * ---------------------------------------------------------------------------
   * بعد از مهاجرت ۸۳ ستون مالی به `BIGINT`، Prisma **واقعی** برای آن ستون‌ها
   * `bigint` برمی‌گرداند. این هارنس تا امروز `number` می‌داد؛ یعنی ۲۵۳ تست یک
   * دنیای number-محور را می‌سنجیدند در حالی که محصول bigint-محور شده بود.
   *
   * با `HARNESS_BIGINT=1` این شکاف بسته می‌شود: ستون `BIGINT` واقعاً `bigint`
   * می‌دهد و `_sum`/`_min`/`_max` رویش هم `bigint` (دقیقاً مثل Prisma).
   *
   * ⚠️ چرا پیش‌فرض خاموش است — این یک تصمیم آگاهانه است، نه فراموشی:
   *   • روشن کردنش در نشست ۱۸۱ **۵۷ شکست** را آشکار کرد.
   *   • ۳۷ موردش باگ واقعیِ محصول بود که همان نشست رفع شد (فهرست کامل در
   *     `CHANGELOG-جلسه۱۸۱-مرحله۴.md`) — آن رفع‌ها در کد ماندگارند و به این
   *     پرچم وابسته نیستند.
   *   • ۲۰ مورد باقی‌مانده عمدتاً *انتظارِ خودِ تست‌ها*ست (مقایسه‌ی `2` با `2n`)
   *     و رفعشان یعنی ویرایش ده‌ها فایل تست — کاری مستقل و بزرگ‌تر از خوشه M.
   *
   * تحویل خوشه M با یک مجموعه‌ی تست قرمز بدتر از تحویل سبز با یک شکافِ
   * اندازه‌گیری‌شده و مستند است. پس پرچم این‌جا می‌ماند تا نشست بعد با
   * `HARNESS_BIGINT=1` آن ۲۰ مورد را یکی‌یکی ببندد.
   * ===========================================================================
   */
  const FAITHFUL_BIGINT = process.env.HARNESS_BIGINT === '1'
  const db = FAITHFUL_BIGINT
    ? new Proxy(rawDb, {
        get(target, prop, receiver) {
          if (prop === 'prepare') {
            return (...args) => {
              const stmt = target.prepare(...args)
              stmt.setReadBigInts(true)
              return stmt
            }
          }
          const v = Reflect.get(target, prop, receiver)
          return typeof v === 'function' ? v.bind(target) : v
        }
      })
    : rawDb

  const tables = introspect(db)
  const { models, relations, byDelegate } = parseSchema()

  // ---------------------------------------------------------------- کدگذاری
  const colOf = (table, name) => tables.get(table)?.columns.get(name)

  const isDate = (col) => col && (col.type.includes('DATE') || col.type.includes('TIME'))
  const isBool = (col) => col && col.type.includes('BOOL')
  /** نشست ۱۸۱: فقط ستون‌های مالیِ مهاجرت‌کرده، نه هر ستون صحیحی. */
  const isBigIntCol = (col) => FAITHFUL_BIGINT && col && col.type.toUpperCase() === 'BIGINT'

  const enc = (table, name, value) => {
    const col = colOf(table, name)
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'boolean') return value ? 1 : 0
    if (isDate(col) && typeof value === 'string') return new Date(value).getTime()
    if (isBool(col) && typeof value === 'number') return value ? 1 : 0
    // نشست ۱۸۱: `bigint` مستقیم به SQLite داده می‌شود؛ تبدیل به `Number` دقیقاً
    // همان افت دقتی است که مهاجرت برای حذفش انجام شد.
    if (typeof value === 'bigint') return value
    if (typeof value === 'object') fail(`مقدار غیرقابل‌ذخیره برای ${table}.${name}: ${JSON.stringify(value)}`)
    return value
  }

  const dec = (table, row) => {
    if (!row) return row
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      const col = colOf(table, k)
      if (v === null) out[k] = null
      else if (isDate(col)) out[k] = typeof v === 'bigint' || typeof v === 'number' ? new Date(Number(v)) : new Date(String(v))
      else if (isBool(col)) out[k] = !!v
      /**
       * نشست ۱۸۱ — ستون `BIGINT` باید `bigint` برگرداند، عیناً مثل Prisma واقعی.
       * اگر این‌جا به `Number` تبدیل شود، هارنس یک دنیای number-محور را تست
       * می‌کند در حالی که محصول bigint-محور شده: هر باگِ «مخلوط کردن bigint و
       * number» بی‌صدا از تست‌ها رد می‌شود.
       */
      else if (isBigIntCol(col)) out[k] = typeof v === 'bigint' ? v : BigInt(v)
      // ستون‌های صحیحِ معمولی (شناسه، تعداد، شمارنده) همچنان `number`اند.
      else if (typeof v === 'bigint') out[k] = Number(v)
      else out[k] = v
    }
    return out
  }

  // ------------------------------------------------------------------ where
  const condition = (table, field, spec, params) => {
    const q = `"${field}"`
    if (spec === null) return `${q} IS NULL`
    if (!isPlain(spec)) {
      params.push(enc(table, field, spec))
      return `${q} = ?`
    }
    const keys = Object.keys(spec)
    for (const k of keys) if (!OPS.has(k)) fail(`عملگر ناشناخته «${k}» روی ${table}.${field}`)
    const parts = []
    const insensitive = spec.mode === 'insensitive'
    for (const [op, val] of Object.entries(spec)) {
      if (op === 'mode') continue
      switch (op) {
        case 'equals':
          if (val === null) parts.push(`${q} IS NULL`)
          else {
            params.push(enc(table, field, val))
            parts.push(`${q} = ?`)
          }
          break
        case 'not':
          if (val === null) parts.push(`${q} IS NOT NULL`)
          else if (isPlain(val)) parts.push(`NOT (${condition(table, field, val, params)})`)
          else {
            params.push(enc(table, field, val))
            parts.push(`(${q} IS NULL OR ${q} <> ?)`)
          }
          break
        case 'in': {
          const list = [...(val ?? [])]
          if (!list.length) parts.push('0 = 1')
          else {
            for (const v of list) params.push(enc(table, field, v))
            parts.push(`${q} IN (${list.map(() => '?').join(', ')})`)
          }
          break
        }
        case 'notIn': {
          const list = [...(val ?? [])]
          if (list.length) {
            for (const v of list) params.push(enc(table, field, v))
            parts.push(`(${q} IS NULL OR ${q} NOT IN (${list.map(() => '?').join(', ')}))`)
          }
          break
        }
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte': {
          const sym = { lt: '<', lte: '<=', gt: '>', gte: '>=' }[op]
          params.push(enc(table, field, val))
          parts.push(`${q} ${sym} ?`)
          break
        }
        case 'contains':
        case 'startsWith':
        case 'endsWith': {
          const like =
            op === 'contains' ? `%${val}%` : op === 'startsWith' ? `${val}%` : `%${val}`
          params.push(like)
          parts.push(insensitive ? `${q} LIKE ? COLLATE NOCASE` : `${q} LIKE ?`)
          break
        }
        default:
          fail(`عملگر پشتیبانی‌نشده «${op}»`)
      }
    }
    return parts.length ? `(${parts.join(' AND ')})` : '1 = 1'
  }

  const whereSql = (table, where, params) => {
    if (!where || !Object.keys(where).length) return '1 = 1'
    const parts = []
    for (const [key, spec] of Object.entries(where)) {
      if (spec === undefined) continue
      if (key === 'AND' || key === 'OR') {
        const list = Array.isArray(spec) ? spec : [spec]
        const inner = list.map((w) => `(${whereSql(table, w, params)})`)
        if (inner.length) parts.push(`(${inner.join(key === 'AND' ? ' AND ' : ' OR ')})`)
        continue
      }
      if (key === 'NOT') {
        const list = Array.isArray(spec) ? spec : [spec]
        for (const w of list) parts.push(`NOT (${whereSql(table, w, params)})`)
        continue
      }
      if (!colOf(table, key)) {
        const rel = relations.get(table)?.[key]
        if (rel) {
          parts.push(relationFilter(table, key, rel, spec, params))
          continue
        }
        fail(`ستون ناشناخته «${key}» در where روی ${table}`)
      }
      parts.push(condition(table, key, spec, params))
    }
    return parts.length ? parts.join(' AND ') : '1 = 1'
  }

  const modelOf = (table) => table

  /**
   * ------------------------------------------------------------------------
   * جلسه ۴۱ — فیلتر روی رابطه، با زیرکوئریِ `EXISTS` (نه join و نه حافظه).
   *
   * چرا لازم شد: کل لایه‌ی مالی روی این شکل نوشته شده — مثلاً
   * `payment.groupBy({ where: { invoice: saleWhere(filter) } })` در
   * `accountingReport.paymentStatement`. بدون این، سوییت کار الف به هیچ‌کدام از
   * عددهای «انتظار نقد/کارت» نمی‌رسید.
   *
   * شکل‌های فهمیده‌شده (بقیه throw می‌شوند، مثل همیشه):
   *   • رابطه‌ی تک (`invoice: {...}`) و `is` / `isNot` (و `is: null`)
   *   • رابطه‌ی چند (`items: { some | every | none: {...} }`)
   * معنای `every` عیناً پریزما است: «هیچ فرزندی که *نقض* کند وجود ندارد».
   * ------------------------------------------------------------------------
   */
  const relationFilter = (table, field, rel, spec, params) => {
    const child = rel.target
    if (!tables.has(child)) fail(`رابطه‌ی «${field}» به جدول ناشناخته «${child}» اشاره می‌کند`)
    // ستونی که دو طرف را وصل می‌کند
    const parentCol = rel.kind === 'one' ? rel.localKey : rel.localKey
    const childCol = rel.kind === 'one' ? rel.foreignKey : rel.foreignKey
    const exists = (inner) => {
      const sub = []
      const cond = inner && Object.keys(inner).length ? whereSql(child, inner, sub) : '1 = 1'
      params.push(...sub)
      return `EXISTS (SELECT 1 FROM "${child}" WHERE "${child}"."${childCol}" = "${table}"."${parentCol}" AND (${cond}))`
    }
    if (spec === null) return `"${table}"."${parentCol}" IS NULL`
    if (!isPlain(spec)) fail(`فیلتر نامعتبر روی رابطه‌ی «${field}» (${table})`)
    const keys = Object.keys(spec)
    const modifiers = new Set(['is', 'isNot', 'some', 'every', 'none'])
    const used = keys.filter((k) => modifiers.has(k))
    if (!used.length) {
      // شکل کوتاه: `invoice: {...}` = `invoice: { is: {...} }` برای رابطه‌ی تک،
      // و برای رابطه‌ی چند اصلاً معنا ندارد (پریزما هم نمی‌پذیرد).
      if (rel.kind === 'many') fail(`فیلتر رابطه‌ی چندگانه «${field}» باید some/every/none بگیرد (${table})`)
      return exists(spec)
    }
    if (used.length !== keys.length) fail(`ترکیب فیلتر رابطه‌ای «${field}» پشتیبانی نمی‌شود (${table})`)
    const parts = []
    for (const k of used) {
      const inner = spec[k]
      if (k === 'is') parts.push(inner === null ? `"${table}"."${parentCol}" IS NULL` : exists(inner))
      else if (k === 'isNot') parts.push(inner === null ? `"${table}"."${parentCol}" IS NOT NULL` : `NOT ${exists(inner)}`)
      else if (k === 'some') parts.push(exists(inner))
      else if (k === 'none') parts.push(`NOT ${exists(inner)}`)
      else if (k === 'every') {
        // «همه» = هیچ فرزند نقض‌کننده‌ای نیست
        parts.push(`NOT ${exists({ NOT: inner })}`)
      }
    }
    return `(${parts.join(' AND ')})`
  }

  // ---------------------------------------------------------------- orderBy
  const orderSql = (table, orderBy) => {
    if (!orderBy) return ''
    const list = Array.isArray(orderBy) ? orderBy : [orderBy]
    const parts = []
    for (const o of list) {
      for (const [field, dir] of Object.entries(o)) {
        if (!colOf(table, field)) fail(`orderBy روی ستون ناشناخته «${field}» (${table})`)
        if (dir !== 'asc' && dir !== 'desc') fail(`جهت مرتب‌سازی ناشناخته «${dir}»`)
        parts.push(`"${field}" ${dir.toUpperCase()}`)
      }
    }
    return parts.length ? ` ORDER BY ${parts.join(', ')}` : ''
  }

  // ------------------------------------------------- select / include (تودرتو)
  const scalarSelect = (table, select) => {
    if (!select) return null
    const cols = []
    for (const [k, v] of Object.entries(select)) {
      if (v === false || v === undefined) continue
      if (colOf(table, k)) cols.push(k)
    }
    return cols
  }

  const project = (table, row, { select, include }) => {
    if (!row) return row
    const rel = relations.get(table) ?? {}
    let out
    if (select) {
      out = {}
      for (const [k, v] of Object.entries(select)) {
        if (v === false || v === undefined) continue
        if (colOf(table, k)) out[k] = row[k]
        else if (rel[k]) out[k] = resolveRelation(table, row, k, v === true ? {} : v)
        else fail(`select روی «${k}» ناشناخته است (${table})`)
      }
    } else {
      out = { ...row }
    }
    if (include) {
      for (const [k, v] of Object.entries(include)) {
        if (v === false || v === undefined) continue
        if (!rel[k]) fail(`include روی رابطه‌ی ناشناخته «${k}» (${table})`)
        out[k] = resolveRelation(table, row, k, v === true ? {} : v)
      }
    }
    return out
  }

  const resolveRelation = (table, row, field, opts) => {
    const rel = relations.get(table)[field]
    const target = rel.target
    const localValue = row[rel.localKey]
    if (rel.kind === 'one') {
      if (localValue == null) return null
      return findOne(target, { [rel.foreignKey]: localValue }, opts)
    }
    if (rel.kind === 'oneReverse') {
      if (localValue == null) return null
      return findOne(target, { [rel.foreignKey]: localValue }, opts)
    }
    if (localValue == null) return []
    /**
     * نشست ۱ زنجیره رفع · هارنس — باگ بحرانی: `...opts` بعد از `where` می‌آمد،
     * پس اگر فراخوان خودش `where` داشت (مثل `include: { payments: { where: ... } }`)
     * شرط کلید خارجی **بازنویسی** می‌شد و رابطه به «همه‌ی ردیف‌های جدول» ترجمه
     * می‌گشت. نتیجه: پرداخت فاکتور دیگری به این فاکتور می‌چسبید و تست سبزِ دروغ
     * می‌داد. حالا کلید خارجی همیشه اعمال می‌شود و شرط فراخوان رویش می‌نشیند.
     */
    return findAll(target, { ...opts, where: { [rel.foreignKey]: localValue, ...(opts.where ?? {}) } })
  }

  const rawRows = (table, where, { orderBy, take, skip } = {}) => {
    const params = []
    let sql = `SELECT * FROM "${table}" WHERE ${whereSql(table, where, params)}${orderSql(table, orderBy)}`
    if (take != null) sql += ` LIMIT ${Math.max(0, Math.round(take))}`
    if (skip != null) sql += `${take == null ? ' LIMIT -1' : ''} OFFSET ${Math.max(0, Math.round(skip))}`
    return db.prepare(sql).all(...params).map((r) => dec(table, r))
  }

  /**
   * خواندن ردیفِ تازه‌ساخته‌شده با `rowid` (نه با کلید اصلی): بعضی جدول‌های این
   * پروژه کلید اصلیِ غیرعددی دارند (`Setting.key`)، پس `lastInsertRowid` تنها
   * راه *قطعیِ* رسیدن به همان ردیف است.
   */
  const byRowid = (table, rowid, opts = {}) => {
    const row = db.prepare(`SELECT * FROM "${table}" WHERE rowid = ?`).get(rowid)
    return row ? project(table, dec(table, row), opts) : null
  }

  const findOne = (table, where, opts = {}) => {
    const rows = rawRows(table, where, { orderBy: opts.orderBy, take: 1 })
    if (!rows.length) return null
    return project(table, rows[0], opts)
  }

  const findAll = (table, opts = {}) => {
    let rows = rawRows(table, opts.where, opts)
    if (opts.distinct) {
      const keys = Array.isArray(opts.distinct) ? opts.distinct : [opts.distinct]
      const seen = new Set()
      rows = rows.filter((r) => {
        const sig = keys.map((k) => String(r[k])).join('\u0000')
        if (seen.has(sig)) return false
        seen.add(sig)
        return true
      })
    }
    return rows.map((r) => project(table, r, opts))
  }

  // ------------------------------------------------------------------ writes
  const p2002 = (e) => {
    const msg = String(e?.message ?? '')
    if (/UNIQUE constraint failed/i.test(msg)) {
      const err = new Error(`\nInvalid prisma invocation:\nUnique constraint failed — ${msg}`)
      err.code = 'P2002'
      err.meta = { target: msg.split(':').pop()?.trim() }
      return err
    }
    return e
  }

  /**
   * تزریق خطای دیتابیس برای تست Rollback (§۲۳/§۲۴).
   * *خطا* شبیه‌سازی می‌شود، ولی برگشتِ تراکنش واقعی است (ROLLBACK خودِ SQLite).
   */
  let breakOn = null
  const maybeBreak = (table, op) => {
    if (!breakOn || breakOn.table !== table) return
    if (breakOn.op && breakOn.op !== op) return
    breakOn = null
    const err = new Error(`HARNESS-FAULT: نوشتن روی ${table} (${op}) عمداً شکست داده شد`)
    err.code = 'P2010'
    throw err
  }

  /**
   * ------------------------------------------------------------------------
   * جلسه ۴۱ — نوشتن تودرتو (`items: { create: [...] }` و `x: { connect: … }`).
   *
   * چرا اضافه شد: `salesService.create` فاکتور، اقلام و پرداختی‌ها را در **یک**
   * `saleInvoice.create` می‌نویسد (همان رفتار واقعی پریزما). بدون این، سوییت
   * کار الف اصلاً به لایه‌ی مالی نمی‌رسید. قاعده‌ی سختِ فایل دست‌نخورده است:
   * هر شکلی که پشتیبانی نمی‌شود `throw` می‌کند — فقط این سه شکل فهمیده می‌شود:
   *   • `{ create: {...} | [...] }` روی رابطه‌ی یک‌به‌چند (FK روی فرزند)
   *   • `{ connect: { <ref>: value } }` روی رابطه‌ای که FK روی همین ردیف است
   *   • `{ createMany: { data: [...] } }` (هم‌معنای `create: [...]`)
   * ------------------------------------------------------------------------
   */
  const nestedWrite = (table, field, rel, spec) => {
    const keys = Object.keys(spec ?? {})
    const known = new Set(['create', 'createMany', 'connect'])
    for (const k of keys) if (!known.has(k)) fail(`نوشتن تودرتوی «${k}» روی ${table}.${field} پشتیبانی نمی‌شود`)
    return spec
  }

  const createRow = (table, data) => {
    maybeBreak(table, 'create')
    const cols = tables.get(table).columns
    const row = {}
    /** رابطه‌هایی که باید *بعد از* ساخت این ردیف نوشته شوند (FK روی فرزند) */
    const deferred = []
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v === undefined) continue
      if (!cols.has(k)) {
        const rel = relations.get(table)?.[k]
        if (!rel) fail(`ستون ناشناخته «${k}» در create روی ${table}`)
        if (!isPlain(v)) fail(`مقدار نامعتبر برای رابطه‌ی «${k}» در create روی ${table}`)
        const spec = nestedWrite(table, k, rel, v)
        if (rel.kind === 'one') {
          // FK روی همین ردیف است ⇒ فقط `connect` معنا دارد
          if (!spec.connect) fail(`روی رابطه‌ی «${k}» (${table}) فقط connect پشتیبانی می‌شود`)
          const target = spec.connect[rel.foreignKey]
          if (target === undefined)
            fail(`connect روی ${table}.${k} باید «${rel.foreignKey}» را بدهد`)
          row[rel.localKey] = enc(table, rel.localKey, target)
        } else {
          const list = spec.createMany?.data ?? spec.create
          if (list === undefined) fail(`روی رابطه‌ی «${k}» (${table}) فقط create/createMany پشتیبانی می‌شود`)
          deferred.push({ rel, rows: Array.isArray(list) ? list : [list] })
        }
        continue
      }
      row[k] = enc(table, k, v)
    }
    // ستون‌های زمانیِ اجباری (createdAt/updatedAt/at/...) همیشه عددِ ms می‌گیرند
    // تا مقایسه‌های gte/lte هیچ‌وقت بین TEXT و INTEGER قفل نشود.
    const now = Date.now()
    for (const [name, col] of cols) {
      if (col.pk || name in row) continue
      if (isDate(col) && col.notNull) row[name] = now
    }
    const names = Object.keys(row)
    const sql = names.length
      ? `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
      : `INSERT INTO "${table}" DEFAULT VALUES`
    let info
    try {
      info = db.prepare(sql).run(...names.map((n) => row[n]))
    } catch (e) {
      throw p2002(e)
    }
    const rowid = Number(info.lastInsertRowid)
    // فرزندهای تودرتو: FK هرکدام از *همان* ردیفِ تازه‌ساخته‌شده پر می‌شود
    if (deferred.length) {
      const pkName = [...cols.values()].find((c) => c.pk)?.name ?? 'id'
      // نشست ۱۸۱: باید از `dec` بگذرد؛ وگرنه با `setReadBigInts` شناسه‌ی والد
      // `bigint` می‌ماند و به‌عنوان کلید خارجی داخل ردیف فرزند می‌نشیند.
      const parent = dec(table, db.prepare(`SELECT * FROM "${table}" WHERE rowid = ?`).get(rowid))
      for (const { rel, rows } of deferred) {
        const parentValue = parent[rel.localKey === 'id' ? pkName : rel.localKey]
        for (const child of rows) createRow(rel.target, { ...child, [rel.foreignKey]: parentValue })
      }
    }
    return rowid
  }

  const updateData = (table, data) => {
    const sets = []
    const params = []
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v === undefined) continue
      if (!colOf(table, k)) fail(`ستون ناشناخته «${k}» در update روی ${table}`)
      if (isPlain(v)) {
        const keys = Object.keys(v)
        if (keys.length !== 1) fail(`دستور update نامعتبر روی ${table}.${k}`)
        const [op] = keys
        if (op === 'set') {
          params.push(enc(table, k, v.set))
          sets.push(`"${k}" = ?`)
        } else if (op === 'increment' || op === 'decrement') {
          params.push(Math.round(Number(v[op])))
          sets.push(`"${k}" = COALESCE("${k}", 0) ${op === 'increment' ? '+' : '-'} ?`)
        } else if (op === 'multiply' || op === 'divide') {
          params.push(Number(v[op]))
          sets.push(`"${k}" = "${k}" ${op === 'multiply' ? '*' : '/'} ?`)
        } else fail(`دستور update پشتیبانی‌نشده «${op}» روی ${table}.${k}`)
      } else {
        params.push(enc(table, k, v))
        sets.push(`"${k}" = ?`)
      }
    }
    // `@updatedAt` پریزما سمت کلاینت پر می‌شود — همان رفتار اینجا هم لازم است.
    if (colOf(table, 'updatedAt') && !('updatedAt' in (data ?? {}))) {
      params.push(Date.now())
      sets.push('"updatedAt" = ?')
    }
    return { sets, params }
  }

  /**
   * جلسه ۴۵ · هارنس — `update` با فرزندِ تودرتو (`items: { create: [...] }`).
   *
   * چرا لازم شد: `SalesService.returnUpdate` (مسیر «ویرایش برگشت») اقلام را
   * `deleteMany` می‌کند و بعد در همان `saleReturn.update` دوباره `create` می‌زند.
   * بدون این پشتیبانی، سناریوی «ویرایش برگشتِ معلق» کار ب قابل تست نبود.
   *
   * قاعده‌ی سختِ هارنس عوض نشده: **فقط** `create`/`createMany` روی رابطه‌ی لیستی
   * فهمیده می‌شود و هر چیز دیگری (update/upsert/delete تودرتو) همان‌طور با خطای
   * صریح رد می‌شود، نه با یک جوابِ بی‌صدا و اشتباه.
   */
  const splitNestedWrites = (table, data) => {
    const scalars = {}
    const nested = []
    for (const [k, v] of Object.entries(data ?? {})) {
      if (colOf(table, k) || v === undefined) {
        scalars[k] = v
        continue
      }
      const rel = relations.get(table)?.[k]
      if (!rel || rel.kind === 'one' || !isPlain(v)) {
        scalars[k] = v // ⇒ همان خطای صریحِ `updateData`
        continue
      }
      const spec = nestedWrite(table, k, rel, v)
      const list = spec.createMany?.data ?? spec.create
      if (list === undefined)
        fail(`روی رابطه‌ی «${k}» (${table}) در update فقط create/createMany پشتیبانی می‌شود`)
      nested.push({ rel, rows: Array.isArray(list) ? list : [list] })
    }
    return { scalars, nested }
  }

  const runUpdate = (table, where, data) => {
    maybeBreak(table, 'update')
    const { scalars, nested } = splitNestedWrites(table, data)
    const { sets, params } = updateData(table, scalars)
    const wp = []
    const cond = whereSql(table, where, wp)
    let changes = 0
    if (sets.length) {
      try {
        const info = db.prepare(`UPDATE "${table}" SET ${sets.join(', ')} WHERE ${cond}`).run(...params, ...wp)
        changes = Number(info.changes)
      } catch (e) {
        throw p2002(e)
      }
    }
    if (nested.length) {
      const wp2 = []
      const cond2 = whereSql(table, where, wp2)
      const parents = db
        .prepare(`SELECT * FROM "${table}" WHERE ${cond2}`)
        .all(...wp2)
        .map((r) => dec(table, r)) // نشست ۱۸۱: همان دلیل بالا
      for (const parent of parents)
        for (const { rel, rows } of nested)
          for (const child of rows) createRow(rel.target, { ...child, [rel.foreignKey]: parent[rel.localKey] })
      if (!sets.length) changes = parents.length
    }
    return changes
  }

  const notFound = (table) => {
    const err = new Error(`\nInvalid prisma invocation:\nAn operation failed because it depends on one or more records that were required but not found. (${table})`)
    err.code = 'P2025'
    return err
  }

  // ------------------------------------------------------------- aggregates
  const aggregate = (table, args = {}) => {
    const params = []
    const cond = whereSql(table, args.where, params)
    const picks = []
    const map = []
    const push = (key, fn, field, scalar) => {
      picks.push(`${fn}(${field === '*' ? '*' : `"${field}"`}) AS "a${map.length}"`)
      map.push({ key, field, fn, scalar })
    }
    for (const [k, spec] of Object.entries(args)) {
      if (!k.startsWith('_')) continue
      const fn = { _sum: 'SUM', _count: 'COUNT', _avg: 'AVG', _min: 'MIN', _max: 'MAX' }[k]
      if (!fn) fail(`تابع تجمیعی ناشناخته «${k}»`)
      if (spec === true) push(k, fn, '*', true)
      else for (const [f, on] of Object.entries(spec)) if (on) push(k, fn, f === '_all' ? '*' : f, false)
    }
    if (!picks.length) fail('aggregate بدون تابع تجمیعی')
    const row = db.prepare(`SELECT ${picks.join(', ')} FROM "${table}" WHERE ${cond}`).get(...params)
    const out = {}
    map.forEach((m, i) => {
      const v = row[`a${i}`]
      /**
       * جلسه ۴۱ — `_min`/`_max` روی ستون تاریخ باید `Date` بدهد، نه عدد خام.
       * پریزمای واقعی همین کار را می‌کند و `resolveReportPeriod` روی خروجیِ
       * همین تجمیع `toJalaliDate()` صدا می‌زند؛ عددِ خام آن‌جا می‌شکست.
       */
      const dateish = m.field !== '*' && isDate(colOf(table, m.field)) && (m.fn === 'MIN' || m.fn === 'MAX')
      /**
       * نشست ۱۸۱ — `_sum`/`_min`/`_max` روی ستون `BIGINT` در Prisma واقعی
       * `bigint` برمی‌گرداند (و `_count`/`_avg` همیشه عدد). هارنس باید همان
       * باشد، وگرنه جمع‌های تجمیعی — که تنها جایی‌اند که واقعاً از محدوده‌ی امن
       * رد می‌شوند — در تست‌ها عددِ گردشده می‌گیرند و باگ دیده نمی‌شود.
       */
      const bigCol = m.field !== '*' && isBigIntCol(colOf(table, m.field)) && ['SUM', 'MIN', 'MAX'].includes(m.fn)
      const val =
        v == null
          ? m.fn === 'COUNT'
            ? 0
            : null
          : dateish
            ? new Date(Number(v))
            : (m.fn === 'MIN' || m.fn === 'MAX') && typeof v === 'string'
              ? v
              : bigCol
                ? (typeof v === 'bigint' ? v : BigInt(v))
                : Number(v)
      // شکلِ خروجی عیناً همان Prisma: `_count: true` ⇒ عدد، `_count: { _all: true }` ⇒ { _all: n }
      if (m.scalar) out[m.key] = val
      else {
        out[m.key] = out[m.key] ?? {}
        out[m.key][m.field === '*' ? '_all' : m.field] = val
      }
    })
    return out
  }

  const groupBy = (table, args = {}) => {
    const by = Array.isArray(args.by) ? args.by : [args.by]
    for (const b of by) if (!colOf(table, b)) fail(`groupBy روی ستون ناشناخته «${b}» (${table})`)
    const params = []
    const cond = whereSql(table, args.where, params)
    const picks = by.map((b) => `"${b}"`)
    const map = []
    for (const [k, spec] of Object.entries(args)) {
      if (!k.startsWith('_')) continue
      const fn = { _sum: 'SUM', _count: 'COUNT', _avg: 'AVG', _min: 'MIN', _max: 'MAX' }[k]
      if (!fn) fail(`تابع تجمیعی ناشناخته «${k}» در groupBy`)
      if (spec === true) {
        picks.push(`COUNT(*) AS "g${map.length}"`)
        map.push({ key: k, field: '_all', scalar: true })
      } else
        for (const [f, on] of Object.entries(spec)) {
          if (!on) continue
          picks.push(`${fn}(${f === '_all' ? '*' : `"${f}"`}) AS "g${map.length}"`)
          map.push({ key: k, field: f, scalar: false })
        }
    }
    /**
     * نشست ۱۷۹ — `having` قبلاً بی‌صدا نادیده گرفته می‌شد (گروه‌های تک‌عضوی هم برمی‌گشتند) و
     * رفتار هارنس با Prisma واقعی فرق داشت. حالا شکل `{ col: { _count|_sum|_min|_max|_avg: { gt|gte|lt|lte|equals: N } } }`
     * به HAVING واقعی SQL ترجمه می‌شود و هر شکل دیگر خطای صریح HARNESS می‌دهد (نه نتیجه‌ی دروغ).
     */
    const havingParts = []
    if (args.having != null) {
      for (const [col, aggs] of Object.entries(args.having)) {
        if (!colOf(table, col)) fail(`having روی ستون ناشناخته «${col}» (${table})`)
        for (const [agg, ops] of Object.entries(aggs ?? {})) {
          const fn = { _sum: 'SUM', _count: 'COUNT', _avg: 'AVG', _min: 'MIN', _max: 'MAX' }[agg]
          if (!fn || ops == null || typeof ops !== 'object') fail(`شکل having پشتیبانی نمی‌شود («${col}.${agg}»)`)
          for (const [op, val] of Object.entries(ops)) {
            const sqlOp = { gt: '>', gte: '>=', lt: '<', lte: '<=', equals: '=' }[op]
            if (!sqlOp || typeof val !== 'number') fail(`عملگر having پشتیبانی نمی‌شود («${col}.${agg}.${op}»)`)
            havingParts.push(`${fn}("${col}") ${sqlOp} ?`)
            params.push(val)
          }
        }
      }
    }
    const havingSql = havingParts.length ? ` HAVING ${havingParts.join(' AND ')}` : ''
    const rows = db
      .prepare(`SELECT ${picks.join(', ')} FROM "${table}" WHERE ${cond} GROUP BY ${by.map((b) => `"${b}"`).join(', ')}${havingSql}`)
      .all(...params)
    return rows.map((r) => {
      const out = {}
      for (const b of by) {
        const col = colOf(table, b)
        /**
         * 🔴 نشست ۱۸۲ — ستون کلیدِ گروه‌بندی باید از همان نگاشت نوعِ ردیف‌های
         * معمولی عبور کند.
         *
         * قبلاً مقدار **خام** برمی‌گشت. تا وقتی `HARNESS_BIGINT` خاموش بود
         * بی‌ضرر بود، ولی با روشن بودنش `setReadBigInts` هر عدد صحیحی را
         * `bigint` می‌داد — یعنی کلیدی مثل `methodId` (ستون `INTEGER`) به شکل
         * `bigint` بیرون می‌آمد، در حالی که Prisma واقعی `number` می‌دهد.
         * نتیجه: تست‌هایی که با `Map<number, …>` روی کلید گروه کار می‌کردند
         * بی‌صدا شکست می‌خوردند و خطا **به‌نظر باگ محصول** می‌آمد.
         */
        out[b] =
          r[b] === null
            ? null
            : isDate(col)
              ? new Date(Number(r[b]))
              : isBool(col)
                ? !!r[b]
                : isBigIntCol(col)
                  ? typeof r[b] === 'bigint'
                    ? r[b]
                    : BigInt(r[b])
                  : typeof r[b] === 'bigint'
                    ? Number(r[b])
                    : r[b]
      }
      map.forEach((m, i) => {
        const v = r[`g${i}`]
        // `_count` همیشه عدد است (هم در Prisma، هم این‌جا)
        if (m.scalar) out[m.key] = Number(v ?? 0)
        else {
          out[m.key] = out[m.key] ?? {}
          /**
           * ممیزی نشست ۱۱۵ — `_min`/`_max` روی ستون متنی (مثل issuedAtJalali) در Prisma واقعی همان رشته است و روی
           * ستون تاریخ `Date`؛ Number() رشته‌ی «۱۴۰۴/۰۱/۰۱» را NaN می‌کرد و «آخرین خرید» در هارنس همیشه null می‌شد.
           */
          const col = colOf(table, m.field)
          const mm = m.key === '_min' || m.key === '_max'
          /**
           * 🔴 نشست ۱۸۲ — `_sum`/`_min`/`_max` روی ستون `BIGINT` در Prisma واقعی
           * `bigint` برمی‌گرداند. این‌جا `Number(v)` می‌شد — یعنی دقیقاً برعکسِ
           * `aggregate()` که همین قاعده را درست پیاده کرده بود. دو مسیر تجمیع
           * رفتار متضاد داشتند و هر تستی که از `groupBy` استفاده می‌کرد،
           * دنیای غلطی می‌دید.
           *
           * `_count` و `_avg` عمداً همچنان عددند (مطابق Prisma).
           */
          const bigCol = isBigIntCol(col) && (m.key === '_sum' || mm)
          out[m.key][m.field] =
            v == null
              ? null
              : mm && col && isDate(col)
                ? new Date(Number(v))
                : mm && typeof v === 'string'
                  ? v
                  : bigCol
                    ? typeof v === 'bigint'
                      ? v
                      : BigInt(v)
                    : Number(v)
        }
      })
      return out
    })
  }

  // ----------------------------------------------------------- delegate ساخت
  const delegate = (table) => ({
    findUnique: async (args = {}) => findOne(table, args.where, args),
    findUniqueOrThrow: async (args = {}) => {
      const row = findOne(table, args.where, args)
      if (!row) throw notFound(table)
      return row
    },
    findFirst: async (args = {}) => findOne(table, args.where, args),
    findFirstOrThrow: async (args = {}) => {
      const row = findOne(table, args.where, args)
      if (!row) throw notFound(table)
      return row
    },
    findMany: async (args = {}) => findAll(table, args),
    create: async (args = {}) => {
      const rowid = createRow(table, args.data)
      return byRowid(table, rowid, args)
    },
    createMany: async (args = {}) => {
      const list = Array.isArray(args.data) ? args.data : [args.data]
      let count = 0
      for (const d of list) {
        try {
          createRow(table, d)
          count++
        } catch (e) {
          if (args.skipDuplicates && e?.code === 'P2002') continue
          throw e
        }
      }
      return { count }
    },
    update: async (args = {}) => {
      const before = findOne(table, args.where)
      if (!before) throw notFound(table)
      const pk = [...tables.get(table).columns.values()].find((c) => c.pk)?.name ?? 'id'
      runUpdate(table, { [pk]: before[pk] }, args.data)
      return findOne(table, { [pk]: before[pk] }, args)
    },
    updateMany: async (args = {}) => ({ count: runUpdate(table, args.where, args.data) }),
    upsert: async (args = {}) => {
      const existing = findOne(table, args.where)
      if (existing) {
        const pk = [...tables.get(table).columns.values()].find((c) => c.pk)?.name ?? 'id'
        runUpdate(table, { [pk]: existing[pk] }, args.update)
        return findOne(table, { [pk]: existing[pk] }, args)
      }
      const rowid = createRow(table, { ...args.where, ...args.create })
      return byRowid(table, rowid, args)
    },
    delete: async (args = {}) => {
      const row = findOne(table, args.where, args)
      if (!row) throw notFound(table)
      const pk = [...tables.get(table).columns.values()].find((c) => c.pk)?.name ?? 'id'
      const params = []
      const cond = whereSql(table, { [pk]: row[pk] }, params)
      db.prepare(`DELETE FROM "${table}" WHERE ${cond}`).run(...params)
      return row
    },
    deleteMany: async (args = {}) => {
      const params = []
      const cond = whereSql(table, args.where, params)
      const info = db.prepare(`DELETE FROM "${table}" WHERE ${cond}`).run(...params)
      return { count: Number(info.changes) }
    },
    count: async (args = {}) => {
      const params = []
      const cond = whereSql(table, args.where, params)
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${cond}`).get(...params)
      return Number(row.n ?? 0)
    },
    aggregate: async (args = {}) => aggregate(table, args),
    groupBy: async (args = {}) => groupBy(table, args)
  })

  // ------------------------------------------------------------- تراکنش واقعی
  let depth = 0
  let savepoint = 0

  const raw = async (sql, ...params) =>
    db
      .prepare(sql)
      .all(...params.map((p) => (p instanceof Date ? p.getTime() : typeof p === 'boolean' ? (p ? 1 : 0) : p)))

  const client = {}
  for (const [delegateName, modelName] of byDelegate) {
    if (!tables.has(modelName)) continue
    client[delegateName] = delegate(modelName)
  }

  client.$queryRawUnsafe = raw
  client.$executeRawUnsafe = async (sql, ...params) => {
    // ممیزی ۱۲۷ — همان نگاشت $queryRawUnsafe (Date ⇒ ms، boolean ⇒ 0/1)؛ قبلاً Date خام به SQLite می‌رفت و
    // شرط‌هایی مثل "toDate" < ? هرگز برقرار نمی‌شد (پاک‌سازی تجمیع/صندوق قدیمی در هارنس بی‌صدا هیچ).
    const info = db.prepare(sql).run(...params.map((p) => (p instanceof Date ? p.getTime() : typeof p === 'boolean' ? (p ? 1 : 0) : p)))
    return Number(info.changes)
  }
  client.$disconnect = async () => db.close()
  client.$harness = {
    db,
    tables,
    relations,
    /** فقط برای تست Rollback: بعدی‌ترین نوشتن روی این جدول خطا بدهد. */
    breakNext(table, op = null) {
      breakOn = { table, op }
    },
    clearBreak() {
      breakOn = null
    },
    get depth() {
      return depth
    }
  }

  client.$transaction = async (arg, _options) => {
    if (Array.isArray(arg)) {
      return client.$transaction(async () => {
        const out = []
        for (const p of arg) out.push(await p)
        return out
      })
    }
    const nested = depth > 0
    const name = `sp_${++savepoint}`
    if (nested) db.exec(`SAVEPOINT ${name}`)
    else db.exec('BEGIN IMMEDIATE')
    depth++
    try {
      const result = await arg(client)
      if (nested) db.exec(`RELEASE ${name}`)
      else db.exec('COMMIT')
      depth--
      return result
    } catch (e) {
      try {
        if (nested) db.exec(`ROLLBACK TO ${name}`)
        else db.exec('ROLLBACK')
      } catch {
        /* تراکنش از قبل بسته شده */
      }
      depth--
      throw e
    }
  }

  return client
}

/** همان امضای `new PrismaClient()` برای stub بستن روی `@prisma/client`. */
export function makePrismaClientClass(file) {
  return class PrismaClient {
    constructor() {
      return createClient(file)
    }
  }
}
