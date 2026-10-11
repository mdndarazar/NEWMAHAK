/*
 * نشست ۳۱۸ · فاز ۴ — یادداشت مدیر در نمای تشخیص پل.
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s318-4-bridge-diag-notes.mjs
 *
 * قوانین قفل‌شده (طرح برنده «کامیلا»):
 *   ۱) append-only: هر noteAdd یک AuditLog جدید می‌سازد؛ هیچ update/delete
 *      روی AuditLog در این مسیر نیست. یادداشت دوم هیچ‌وقت اولی را بازنویسی
 *      نمی‌کند.
 *   ۲) fail-closed: auditOrThrow (نه audit) — اگر لاگ ننشیند عمل هم خطاست.
 *   ۳) حداکثر طول ۳۰۰ (NOTE_MAX) و رد متن خالی.
 *   ۴) actor از main (shiftService.currentStaffId) می‌آید و actorLabel از
 *      displayName چاپ می‌شود؛ بعد از جدا شدن دوره‌ی صدا، یادداشت‌ها به
 *      خودِ همان periodKey متصل‌اند.
 *   ۵) متن خالص می‌ماند: HTML-تگ برگردانده می‌شود اما به‌صورت متن در بعد
 *      (رندرر آن را escape می‌کند؛ جایی در سرویس HTML ساخته نمی‌شود).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s318-4-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const errOf = async (fn) => {
  try { await fn(); return null } catch (e) { return String(e?.message ?? e) }
}

// ---- ایستا ---------------------------------------------------------------
const svcSrc = readFileSync('src/main/services/bridgeDiagnosticsService.ts', 'utf8')
check('هیچ update/delete روی AuditLog در این سرویس نیست (append-only)', !/auditLog\.(update|updateMany|delete|deleteMany)\b/.test(svcSrc))
check('noteAdd با auditOrThrow لاگ می‌نویسد (fail-closed)', /await auditOrThrow\(prisma,/.test(svcSrc))
check('NOTE_MAX=300', /NOTE_MAX\s*=\s*300/.test(svcSrc))
check('actor از main خوانده می‌شود (currentStaffId)', /shiftService\.currentStaffId\(\)/.test(svcSrc))
check('note خواندن: مرتب‌صعودی بر اساس id (ترتیب append)', /orderBy: \{ id: 'asc' \}/.test(svcSrc))

// ---- سیم‌بندی رفتاری -----------------------------------------------------
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliStartOfDay } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { bridgeDiagnosticsService: svc } = await import('../../src/main/services/bridgeDiagnosticsService.ts')
const { clearPanelSessions } = await import('../../src/main/services/panelSession.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

const userId = seed.user('تست یادداشت نشست ۳۱۸')
const cat = seed.category('پوشاک۴')
const product = seed.product('شلوار تست-۴', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH-4', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const variantId = seed.variant(product, 'سایز تست-۴')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(100_000, variantId)

await shiftService.openSession({ staffId: userId, name: 'شیفت یادداشت' })
const invoice = await salesService.create({
  userId,
  lines: [{ variantId, qty: 1, unitPrice: 100_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
})
const at = (day) => jalaliStartOfDay(day).getTime() + 36_000_046
const DAY = '1405/06/20'
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?').run(at(DAY), DAY, at(DAY), invoice.id)
sql.prepare('UPDATE "Payment" SET paidAt = ?, createdAt = ?, paidAtJalali = ?, paidAtTime = ? WHERE invoiceId = ?').run(at(DAY), at(DAY), DAY, '10:00:00', invoice.id)

const scope = { fromJalali: DAY, toJalali: DAY }
clearPanelSessions()
await svc.open(scope, DEFAULT_MANAGER_PASSWORD)

// ---- رفتار ----------------------------------------------------------------
const before = Number(sql.prepare("SELECT COUNT(*) AS c FROM \"AuditLog\" WHERE entity = 'BridgeDiagNote'").get().c)

const first = await svc.noteAdd(scope, 'اولین یادداشت: مغایرت نقد/کارت برگشتی است.')
check('noteAdd اول موفق', first?.ok === true)
const second = await svc.noteAdd(scope, 'دومین یادداشت (append).')
check('noteAdd دوم موفق', second?.ok === true)

const after = Number(sql.prepare("SELECT COUNT(*) AS c FROM \"AuditLog\" WHERE entity = 'BridgeDiagNote'").get().c)
check('دو ردیف جدید (append) — هیچ بازنویسی', Number(after) - Number(before) === 2)

const rows = sql.prepare("SELECT id, action, userId, after FROM \"AuditLog\" WHERE entity = 'BridgeDiagNote' ORDER BY id ASC").all()
check('هر دو ADMIN action یک‌سویه', rows.length >= 2 && rows.every((r) => r.action === 'BRIDGE_DIAG_NOTE_ADD'))
check('userId از نشست آمده (actor از main)', rows.every((r) => Number(r.userId) === userId))
check('یادداشت اول در ردیف اول ماندند و ردیف دوم متن دوم را دارد',
  String(rows[rows.length - 2].after).includes('اولین یادداشت') && String(rows[rows.length - 1].after).includes('دومین یادداشت'))

const listed = await svc.notes(scope)
check('notes هر دو را به ترتیب id می‌آورد', listed.notes.length >= 2 && listed.notes[listed.notes.length - 2].text.includes('اولین') && listed.notes[listed.notes.length - 1].text.includes('دومین'))
check('actorLabel از displayName کارمند', listed.notes[listed.notes.length - 1].actorLabel === 'تست یادداشت نشست ۳۱۸')

check('متن خالی رد می‌شود', /خالی/.test(await errOf(() => svc.noteAdd(scope, '')) ?? ''))
check('متن بیش از ۳۰۰ رد می‌شود', (await errOf(() => svc.noteAdd(scope, 'الف'.repeat(301))) ?? '').includes('۳۰۰') || (await errOf(() => svc.noteAdd(scope, 'الف'.repeat(301))) ?? '').includes('300'))
const html = await svc.noteAdd(scope, 'تست با <b>تگ</b> HTML')
check('متن HTML هم به‌صورت خالص پذیرفته و ذخیره می‌شود (escape در رندر است نه در سرویس)', html?.ok === true && html.note.text === 'تست با <b>تگ</b> HTML')

// جدایی دوره
const otherDay = '1405/06/25'
const otherScope = { fromJalali: otherDay, toJalali: otherDay }
salesService && true
const isolated = await svc.notes(otherScope)
check('یادداشت‌های دوره‌ی دیگر جداست', (isolated?.notes ?? []).length === 0)

clearPanelSessions()
check('بدون نشست باز noteAdd رد می‌شود', (await errOf(() => svc.noteAdd(scope, 'دیگری'))) != null)
check('بدون نشست باز notes رد می‌شود', (await errOf(() => svc.notes(scope))) != null)

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
