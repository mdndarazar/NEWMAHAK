/**
 * ===========================================================================
 * نشست ۳۵۳ — ردیف‌های جایگزین‌شونده‌ی فروش/برگشت، بدون پاک‌شدنِ مدرک
 *
 * SaleInvoiceItem و SaleReturnItem به‌دلیل ارجاع‌های زنده‌ی انبار و saleItemId
 * هنوز با delete/create ویرایش می‌شوند. این تست تضمین می‌کند که پیش از delete:
 *   - snapshot کامل، قابل پرس‌وجو و JSON-safe در AuditLog می‌نشیند؛
 *   - شناسه و snapshot ردیف‌های تازه هم در timeline سند ثبت می‌شود؛
 *   - اگر نوشتن snapshot شکست بخورد، delete و کل ویرایش rollback می‌شود.
 *
 *   node --import ./test/harness/register.mjs tests/audit-fixes/fix-s353-item-revision-snapshots.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s353-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const ROOT = new URL('../../', import.meta.url).pathname
const serviceSource = readFileSync(join(ROOT, 'src/main/services/SalesService.ts'), 'utf8')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const truthy = (label, value, extra = '') => {
  if (value) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const msg = String(e?.message ?? e)
    if (!msg.startsWith('HARNESS:') && (!needle || msg.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${msg.split('\n')[0]})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${msg.split('\n')[0]}`) }
  }
}

const userId = seed.user('مدیر تست نشست ۳۵۳')
const categoryId = seed.category('کالای تست')
const productId = seed.product('پیراهن تست', categoryId)
const shiftId = seed.insert('Shift', {
  name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 60_000, userId
})
let serial = 0
const variant = (price) => {
  const id = seed.variant(productId, `مدل ${++serial}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const line = (variantId, qty, unitPrice, discount = 0, tax = 0) => ({ variantId, qty, unitPrice, discount, tax })
const sale = async (lines) => salesService.create({ userId, shiftId, lines, payments: [] })
const invoiceItems = (invoiceId) => seed.rows(
  'SELECT id, invoiceId, variantId, variantName, variantCode, qty, unitPrice, discount, tax, lineTotal FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id',
  invoiceId
)
const returnItems = (returnId) => seed.rows(
  'SELECT id, returnId, saleItemId, variantId, variantName, variantCode, qty, unitPrice, lineTotal, removedFromStock, restockedQty FROM "SaleReturnItem" WHERE returnId = ? ORDER BY id',
  returnId
)
const revision = (entity, entityId) => {
  const row = seed.one('SELECT id, action, entity, entityId, before, after FROM "AuditLog" WHERE entity = ? AND entityId = ? ORDER BY id DESC LIMIT 1', entity, entityId)
  return row ? { ...row, before: JSON.parse(row.before), after: JSON.parse(row.after) } : null
}
const timeline = (action, entity, entityId) => {
  const row = seed.one('SELECT id, before, after FROM "AuditLog" WHERE action = ? AND entity = ? AND entityId = ? ORDER BY id DESC LIMIT 1', action, entity, entityId)
  return row ? { ...row, before: JSON.parse(row.before), after: JSON.parse(row.after) } : null
}

console.log('\n۱) سیم‌کشی: snapshot fail-closed باید پیش از هر delete باشد')
const updateStart = serviceSource.indexOf('async update(input: UpdateSaleInput)')
const updateEnd = serviceSource.indexOf('\n  get(id: number)', updateStart)
const updateBody = serviceSource.slice(updateStart, updateEnd)
const returnStart = serviceSource.indexOf('async returnUpdate(input: UpdateReturnInput)')
const returnEnd = serviceSource.indexOf('\n  /**\n   * حذف یک برگشت', returnStart)
const returnBody = serviceSource.slice(returnStart, returnEnd)
for (const [label, body, entity, deletion] of [
  ['فاکتور', updateBody, 'SaleInvoiceItemRevision', 'saleInvoiceItem.deleteMany'],
  ['برگشت', returnBody, 'SaleReturnItemRevision', 'saleReturnItem.deleteMany']
]) {
  const auditAt = body.indexOf(`entity: '${entity}'`)
  const throwAt = body.indexOf('auditOrThrow', Math.max(0, auditAt - 300))
  const deleteAt = body.indexOf(deletion)
  truthy(`${label}: دفتر revision تعریف شده`, auditAt >= 0)
  truthy(`${label}: auditOrThrow پیش از delete است`, throwAt >= 0 && deleteAt >= 0 && throwAt < deleteAt)
}

console.log('\n۲) ویرایش فاکتور: ردیف پاک می‌شود، اما snapshot کامل و قابل‌پرس‌وجو می‌ماند')
const oldVariant = variant(1_000)
const replacementVariant = variant(700)
const invoice = await sale([line(oldVariant, 2, 1_000, 100)])
const oldInvoiceRows = invoiceItems(invoice.id)
await salesService.update({
  id: invoice.id,
  userId,
  shiftId,
  keepPayments: true,
  lines: [line(replacementVariant, 3, 700, 50)]
})
const liveInvoiceRows = invoiceItems(invoice.id)
const invoiceRevision = revision('SaleInvoiceItemRevision', invoice.id)
const invoiceTimeline = timeline('SALE_UPDATE', 'SaleInvoice', invoice.id)
eq('ردیف زنده‌ی قدیمی دیگر وجود ندارد', liveInvoiceRows.some((r) => r.id === oldInvoiceRows[0].id), false)
eq('فقط ردیف جایگزین زنده است', liveInvoiceRows.length, 1)
eq('دفتر invoice با entity/entityId قابل‌پرس‌وجو است', invoiceRevision?.entity, 'SaleInvoiceItemRevision')
eq('نسخه‌ی snapshot فاکتور', invoiceRevision?.before?.version, 1)
eq('شناسه‌ی قلم قدیمی در snapshot مانده', Number(invoiceRevision?.before?.rows?.[0]?.id), Number(oldInvoiceRows[0].id))
eq('invoiceId قلم قدیمی در snapshot مانده', Number(invoiceRevision?.before?.rows?.[0]?.invoiceId), invoice.id)
eq('variantId قلم قدیمی در snapshot مانده', Number(invoiceRevision?.before?.rows?.[0]?.variantId), oldVariant)
eq('qty قدیمی در snapshot مانده', Number(invoiceRevision?.before?.rows?.[0]?.qty), 2)
eq('unitPrice قدیمی lossless است', String(invoiceRevision?.before?.rows?.[0]?.unitPrice), '1000')
eq('discount قدیمی lossless است', String(invoiceRevision?.before?.rows?.[0]?.discount), '100')
eq('tax قدیمی lossless است', String(invoiceRevision?.before?.rows?.[0]?.tax), '0')
eq('lineTotal قدیمی lossless است', String(invoiceRevision?.before?.rows?.[0]?.lineTotal), '1900')
eq('snapshot بعدی از ردیف validated است', Number(invoiceRevision?.after?.rows?.[0]?.variantId), replacementVariant)
eq('timeline فاکتور شناسه‌ی ردیف تازه را دارد', Number(invoiceTimeline?.after?.items?.[0]?.id), Number(liveInvoiceRows[0].id))
truthy('نام/کد snapshot کالا در دفتر حاضر است', Object.hasOwn(invoiceRevision?.before?.rows?.[0] ?? {}, 'variantName') && Object.hasOwn(invoiceRevision?.before?.rows?.[0] ?? {}, 'variantCode'))

console.log('\n۳) ویرایش برگشت: پیوند saleItemId و اثر واقعی restock در دفتر می‌ماند')
const returnVariant = variant(900)
const returnInvoice = await sale([line(returnVariant, 2, 900)])
const sourceItem = invoiceItems(returnInvoice.id)[0]
const ret = await salesService.createReturn({
  invoiceId: returnInvoice.id,
  full: false,
  lines: [{ saleItemId: sourceItem.id, qty: 1 }],
  refundMethod: RefundMethod.NONE,
  confirmOverpay: true,
  userId
})
const oldReturnRows = returnItems(ret.id)
await salesService.returnUpdate({
  id: ret.id,
  userId,
  lines: [{ saleItemId: sourceItem.id, qty: 2 }],
  managerPassword: DEFAULT_MANAGER_PASSWORD,
  overrideReason: 'اصلاح تست snapshot ردیف برگشت'
})
const liveReturnRows = returnItems(ret.id)
const returnRevision = revision('SaleReturnItemRevision', ret.id)
const returnTimeline = timeline('SALE_RETURN', 'SaleReturn', ret.id)
eq('ردیف زنده‌ی برگشتِ قدیمی دیگر وجود ندارد', liveReturnRows.some((r) => r.id === oldReturnRows[0].id), false)
eq('ردیف جایگزین برگشت زنده است', liveReturnRows.length, 1)
eq('دفتر return با entity/entityId قابل‌پرس‌وجو است', returnRevision?.entity, 'SaleReturnItemRevision')
eq('شناسه‌ی قلم برگشت قدیمی در snapshot مانده', Number(returnRevision?.before?.rows?.[0]?.id), Number(oldReturnRows[0].id))
eq('پیوند saleItemId در snapshot مانده', Number(returnRevision?.before?.rows?.[0]?.saleItemId), Number(sourceItem.id))
eq('returnId در snapshot مانده', Number(returnRevision?.before?.rows?.[0]?.returnId), Number(ret.id))
eq('qty قدیمی برگشت در snapshot مانده', Number(returnRevision?.before?.rows?.[0]?.qty), 1)
eq('unitPrice قدیمی برگشت lossless است', String(returnRevision?.before?.rows?.[0]?.unitPrice), '900')
eq('lineTotal قدیمی برگشت lossless است', String(returnRevision?.before?.rows?.[0]?.lineTotal), '900')
eq('restockedQty واقعی در snapshot مانده', Number(returnRevision?.before?.rows?.[0]?.restockedQty), 1)
eq('ردیف بعدی validated همان saleItemId را دارد', Number(returnRevision?.after?.rows?.[0]?.saleItemId), Number(sourceItem.id))
eq('timeline برگشت شناسه‌ی ردیف تازه را دارد', Number(returnTimeline?.after?.items?.[0]?.id), Number(liveReturnRows[0].id))

console.log('\n۴) شکست نوشتن دفتر ⇒ rollback: delete و replace commit نمی‌شوند')
const rollbackOldVariant = variant(400)
const rollbackNewVariant = variant(600)
const rollbackInvoice = await sale([line(rollbackOldVariant, 1, 400)])
const beforeFailure = invoiceItems(rollbackInvoice.id)
sql.exec(`
  CREATE TRIGGER "reject_item_revision_audit"
  BEFORE INSERT ON "AuditLog"
  WHEN NEW.entity = 'SaleInvoiceItemRevision'
  BEGIN
    SELECT RAISE(ABORT, 'forced item revision audit failure');
  END;
`)
await rejects(
  'ویرایش با AuditLog ناموفق رد می‌شود',
  () => salesService.update({ id: rollbackInvoice.id, userId, shiftId, keepPayments: true, lines: [line(rollbackNewVariant, 1, 600)] }),
  'ثبت «سابقه‌ی عملیات»'
)
sql.exec('DROP TRIGGER "reject_item_revision_audit"')
const afterFailure = invoiceItems(rollbackInvoice.id)
eq('rollback: تعداد ردیف‌های فاکتور همان است', afterFailure.length, beforeFailure.length)
eq('rollback: شناسه‌ی قلم قدیمی حفظ شده', Number(afterFailure[0]?.id), Number(beforeFailure[0]?.id))
eq('rollback: variant قلم قدیمی حفظ شده', Number(afterFailure[0]?.variantId), rollbackOldVariant)
eq('rollback: دفتر revision ناقص ننشسته', seed.rows('SELECT id FROM "AuditLog" WHERE entity = ? AND entityId = ?', 'SaleInvoiceItemRevision', rollbackInvoice.id).length, 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
