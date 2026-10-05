/**
 * ===========================================================================
 * جلسه ۳۵ · هارنس واقعی §۲۳ — لایه‌ی ۳: داده‌ی پایه
 * ---------------------------------------------------------------------------
 * `insert` هر ستونِ NOT NULL بدون DEFAULT را خودش پر می‌کند، پس تست‌ها فقط
 * چیزی را می‌نویسند که *به موضوعشان مربوط است* (مثلاً مبلغ ردیف فاکتور)، نه
 * سی ستون بی‌ربط. اگر فردا ستون اجباری تازه‌ای به یک جدول اضافه شود، این هارنس
 * بی‌صدا نمی‌شکند.
 * ===========================================================================
 */
/** `bigint`هایی که در محدوده‌ی امن جا می‌شوند ⇒ `number`؛ بقیه دست‌نخورده. */
function shrinkBigInts(row) {
  if (!row || typeof row !== 'object') return row
  const out = {}
  for (const [k, v] of Object.entries(row))
    out[k] =
      typeof v === 'bigint' && v <= 9007199254740991n && v >= -9007199254740991n ? Number(v) : v
  return out
}

export function makeSeeder(client) {
  const { db, tables } = client.$harness
  const seq = { receipt: 1000, uid: 0 }
  const uid = () => `${++seq.uid}${Math.random().toString(36).slice(2, 7)}`

  const insert = (table, values = {}) => {
    const meta = tables.get(table)
    if (!meta) throw new Error(`HARNESS: جدول «${table}» وجود ندارد`)
    const row = {}
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue
      if (!meta.columns.has(k)) throw new Error(`HARNESS: ستون «${k}» در ${table} نیست`)
      row[k] = v instanceof Date ? v.getTime() : typeof v === 'boolean' ? (v ? 1 : 0) : v
    }
    const now = Date.now()
    for (const [name, col] of meta.columns) {
      if (col.pk || name in row) continue
      if (!col.notNull || col.hasDefault) continue
      if (col.type.includes('DATE') || col.type.includes('TIME')) row[name] = now
      else if (col.type.includes('INT') || col.type.includes('REAL') || col.type.includes('DECIMAL')) row[name] = 0
      else if (col.type.includes('BOOL')) row[name] = 0
      else row[name] = ''
    }
    const names = Object.keys(row)
    const info = db
      .prepare(
        `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names
          .map(() => '?')
          .join(', ')})`
      )
      .run(...names.map((n) => row[n]))
    return Number(info.lastInsertRowid)
  }

  const api = {
    insert,
    /** تنظیمات اعتبار (§۲۲) — همان کلیدی که `readCreditSettings` می‌خواند. */
    creditSettings(partial) {
      const key = 'credit.settings'
      const value = JSON.stringify(partial)
      const existing = db.prepare('SELECT key FROM "Setting" WHERE key = ?').get(key)
      if (existing) db.prepare('UPDATE "Setting" SET value = ? WHERE key = ?').run(value, key)
      else insert('Setting', { key, value })
    },
    setting(key, value) {
      const existing = db.prepare('SELECT key FROM "Setting" WHERE key = ?').get(key)
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      if (existing) db.prepare('UPDATE "Setting" SET value = ? WHERE key = ?').run(text, key)
      else insert('Setting', { key, value: text })
    },
    user(displayName = 'مدیر تست') {
      return insert('User', {
        displayName,
        username: `u${uid()}`,
        passwordHash: 'x',
        role: 'MANAGER'
      })
    },
    customer(name = 'شرکت نمونه', phone = '09120000000') {
      return insert('Customer', { name, phone, code: `C${uid()}` })
    },
    category(name, parentId = null) {
      return insert('Category', { name, parentId })
    },
    product(name, categoryId = null) {
      return insert('Product', { name, categoryId })
    },
    variant(productId, name = 'کالای تست') {
      return insert('ProductVariant', {
        productId,
        code: `V${uid()}`,
        barcode: `B${uid()}`,
        salePrice: 1_000_000,
        size: name
      })
    },
    invoice({ grandTotal = 0, status = 'FINAL', customerId = null, receiptNo } = {}) {
      const no = receiptNo ?? ++seq.receipt
      return { id: insert('SaleInvoice', { grandTotal, status, customerId, receiptNo: no }), receiptNo: no }
    },
    invoiceItem(invoiceId, { variantId, qty = 1, lineTotal = 0, variantName = 'کالای تست' }) {
      return insert('SaleInvoiceItem', { invoiceId, variantId, qty, lineTotal, variantName })
    },
    /** یک فاکتور کامل با اقلامش (برای تست محدودیت کالا/دسته §۱۸). */
    invoiceWithLines(lines, { status = 'FINAL', customerId = null } = {}) {
      const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0)
      const inv = api.invoice({ grandTotal, status, customerId })
      for (const l of lines) api.invoiceItem(inv.id, l)
      return { ...inv, grandTotal }
    },
    count(table, where = '1 = 1', ...params) {
      return Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`).get(...params).n)
    },
    /**
     * ⚠️ نشست ۱۸۱ — چرا این‌جا `bigint` به عدد برمی‌گردد.
     *
     * از این نشست، هارنس مقادیر را با `setReadBigInts` می‌خواند تا مبالغ مالیِ
     * بزرگ‌تر از `Number.MAX_SAFE_INTEGER` را از دست ندهد (بند ۴-۲۸ الف).
     * ولی `rows`/`one` دریچه‌ی SQL خامِ خودِ تست‌هاست و ده‌ها تست با آن
     * **شناسه** می‌خوانند و مستقیم به سرویس‌ها پاس می‌دهند؛ سرویس‌ها هم با
     * `Number.isSafeInteger` اعتبارسنجی می‌کنند و `bigint` را رد می‌کنند.
     *
     * پس قاعده این است: هر عددی که در محدوده‌ی امن جا می‌شود به `number`
     * برمی‌گردد (رفتار مو‌به‌موی قبل)، و فقط مقداری که **واقعاً** جا نمی‌شود
     * `bigint` می‌ماند — یعنی دقت هیچ‌جا قربانی راحتی نمی‌شود.
     */
    rows(sql, ...params) {
      return db.prepare(sql).all(...params).map(shrinkBigInts)
    },
    one(sql, ...params) {
      return shrinkBigInts(db.prepare(sql).get(...params))
    }
  }
  return api
}
