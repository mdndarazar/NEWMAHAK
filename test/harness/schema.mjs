/**
 * ===========================================================================
 * جلسه ۳۵ · هارنس واقعی §۲۳ — لایه‌ی ۱: اسکیما و ساختن دیتابیس واقعی
 * ---------------------------------------------------------------------------
 * دوازده نشست (۲۳ تا ۳۴) گام «تست واقعی روی دیتابیس» با یک جمله بسته بود:
 * «npm نیست، پس @prisma/client نیست». این فایل همان بن‌بست را از راه دیگری باز
 * می‌کند: موتور دیتابیس **داخل خودِ Node است** (`node:sqlite`, Node 22) و
 * ساختار جدول‌ها از **همان فایل‌های migration واقعی پروژه** خوانده می‌شود.
 *
 * یعنی چیزی که این هارنس می‌سنجد، شبیه‌سازی نیست:
 *   • `UNIQUE INDEX "StoreCredit_code_key"` همان ایندکس واقعی migration است،
 *   • `UNIQUE INDEX "StoreCreditRedemption_idempotencyKey_key"` هم همین‌طور،
 *   • BEGIN/COMMIT/ROLLBACK واقعیِ SQLite است، نه یک آرایه در حافظه.
 *
 * تنها چیزی که «شبیه‌سازی» است، *مترجمِ* Prisma → SQL است (`prismaLite.mjs`) و
 * قاعده‌ی سختش این است: **هر چیزی که نمی‌فهمد، throw می‌کند** (هیچ‌وقت بی‌صدا
 * جواب اشتباه نمی‌دهد).
 * ===========================================================================
 */
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * پارس سبکِ `prisma/schema.prisma` — فقط چیزهایی که مترجم لازم دارد:
 * نام مدل‌ها، ستون‌های scalar، و روابط (برای `select`/`include` تودرتو).
 */
export function parseSchema(file = join(ROOT, 'prisma', 'schema.prisma')) {
  const text = readFileSync(file, 'utf8')
  const models = new Map()
  const re = /^model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm
  let m
  while ((m = re.exec(text))) {
    const name = m[1]
    const body = m[2]
    const fields = []
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('///') || line.startsWith('@@')) continue
      const f = /^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?(.*)$/.exec(line)
      if (!f) continue
      fields.push({
        name: f[1],
        type: f[2],
        list: !!f[3],
        optional: !!f[4],
        attrs: f[5] ?? '',
        relation: /@relation\(/.test(f[5] ?? '') ? f[5] : null
      })
    }
    models.set(name, { name, table: name, fields })
  }

  // روابط: سمتی که @relation(fields: [...]) دارد صاحب FK است؛ سمت دیگر برعکسش.
  const relations = new Map() // modelName -> { fieldName -> rel }
  for (const [name, model] of models) relations.set(name, {})
  for (const [name, model] of models) {
    for (const f of model.fields) {
      if (!models.has(f.type)) continue
      const own = /@relation\([^)]*fields:\s*\[([^\]]+)\]/.exec(f.attrs)
      if (own) {
        const refs = /references:\s*\[([^\]]+)\]/.exec(f.attrs)
        relations.get(name)[f.name] = {
          kind: 'one',
          target: f.type,
          localKey: own[1].split(',')[0].trim(),
          foreignKey: (refs ? refs[1].split(',')[0].trim() : 'id')
        }
      } else {
        // طرف مقابل: FK روی مدل مقابل است
        const other = models.get(f.type)
        const back = other.fields.find(
          (of) => of.type === name && /fields:\s*\[/.test(of.attrs)
        )
        if (!back) continue
        const bf = /fields:\s*\[([^\]]+)\]/.exec(back.attrs)
        const br = /references:\s*\[([^\]]+)\]/.exec(back.attrs)
        relations.get(name)[f.name] = {
          kind: f.list ? 'many' : 'oneReverse',
          target: f.type,
          localKey: br ? br[1].split(',')[0].trim() : 'id',
          foreignKey: bf[1].split(',')[0].trim()
        }
      }
    }
  }

  const byDelegate = new Map()
  for (const [name] of models) byDelegate.set(lowerFirst(name), name)
  return { models, relations, byDelegate }
}

/** همه‌ی migration های واقعی پروژه، به ترتیب، روی یک فایل دیتابیس تازه. */
export function buildDatabase(file) {
  if (existsSync(file)) rmSync(file, { force: true })
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF')
  const dir = join(ROOT, 'prisma', 'migrations')
  const applied = []
  for (const d of readdirSync(dir).sort()) {
    const sql = join(dir, d, 'migration.sql')
    if (!existsSync(sql)) continue
    db.exec(readFileSync(sql, 'utf8'))
    applied.push(d)
  }
  /**
   * ⚠️ نشست ۱۸۱ — این خط ضروری است، نه تزئینی.
   *
   * `PRAGMA foreign_keys` بالا یک بار خاموش می‌شود تا تست‌ها بتوانند فقط همان
   * چیزی را بسازند که به موضوعشان مربوط است (مثلاً یک `Payment` بدون ساختنِ
   * ردیف `PaymentMethod`). ولی هر migration ای که از نوع «بازتعریف جدول» باشد
   * — که Prisma برای تغییر نوع ستون در SQLite مجبور است بسازد — در انتهای خود
   * `PRAGMA foreign_keys=ON;` می‌گذارد و آن تصمیم را **برای بقیه‌ی اتصال**
   * برمی‌گرداند.
   *
   * نتیجه‌اش بی‌صدا و گیج‌کننده بود: با اضافه شدن migration مهاجرت به BigInt،
   * دو تستِ بی‌ربط با «FOREIGN KEY constraint failed» افتادند، بدون آنکه هیچ
   * ستون یا کلید خارجی‌ای واقعاً عوض شده باشد.
   *
   * پس حالت مورد نظر هارنس *بعد از* اجرای همه‌ی migrationها دوباره اعمال
   * می‌شود، تا رفتار هارنس به محتوای آخرین migration وابسته نباشد.
   */
  db.exec('PRAGMA foreign_keys = OFF')
  return { db, applied }
}

/** ستون‌های واقعیِ هر جدول از خودِ دیتابیس (نه از schema.prisma). */
export function introspect(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
  const out = new Map()
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all()
    out.set(t, {
      name: t,
      columns: new Map(
        cols.map((c) => [
          c.name,
          {
            name: c.name,
            type: String(c.type || '').toUpperCase(),
            notNull: !!c.notnull,
            hasDefault: c.dflt_value != null,
            pk: !!c.pk
          }
        ])
      )
    })
  }
  return out
}
