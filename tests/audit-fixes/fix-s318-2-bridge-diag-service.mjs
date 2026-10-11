/*
 * نشست ۳۱۸ · فاز ۲ — نمای تشخیص پل تطبیق: پنل، نشست، سرویس، IPC.
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s318-2-bridge-diag-service.mjs
 *
 * چه چیزی ثابت است (طرح برنده «کامیلا»):
 *   ۱) PANEL_KEYS.bridgeDiagnostics='bridge-diagnostics' + ردیف LOCKED_PANELS.
 *   ۲) گیت یک‌تابه‌ی جدید `assertPanelUnlockedStrict` در panelSession:
 *      open همیشه رمز تازه می‌خواهد (مثل assertPanelPasswordStrict)، بعد
 *      notePanelUnlocked ثبت می‌شود تا sources/notes بدون رمز کار کنند.
 *   ۳) TTL نشست همان ۵ دقیقه‌ی panelSession است و در تست با
 *      applyPanelSessionTtlMs کم می‌شود.
 *   ۴) open ردیف‌های bridge را همان‌طور که reportRows می‌دهد پس می‌دهد
 *      (هیچ محاسبه‌ی جدیدی در سرویس نیست) + notes از AuditLog.
 *   ۵) sources فقط با نشست باز؛ notes/noteAdd هم همین‌طور؛ noteAdd با
 *      auditOrThrow می‌نشیند (fail-closed) و حداکثر ۳۰۰ کاراکتر.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s318-2-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want))
const errOf = async (fn) => {
  try { await fn(); return null } catch (e) { return String(e?.message ?? e) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliStartOfDay } = await import('@shared/jalali')
const { PANEL_KEYS, LOCKED_PANELS, allLockedConfig, isPanelLockEnabled } = await import('../../src/shared/panels.ts')
const panelsMod = await import('../../src/main/services/panelSession.ts')
const {
  assertPanelUnlocked, assertPanelUnlockedStrict, applyPanelSessionTtlMs,
  clearPanelSessions, isPanelUnlocked, notePanelUnlocked, PANEL_SESSION_TTL_MS
} = panelsMod
const { authService } = await import('../../src/main/services/AuthService.ts')
const { bridgeDiagnosticsService: svc } = await import('../../src/main/services/bridgeDiagnosticsService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')

const PANEL = PANEL_KEYS.bridgeDiagnostics
const db = harnessClient()
const sql = db.$harness.db

// ===========================================================================
// الف) ثابت‌ها و سیم‌کشی (بدون DB)
// ===========================================================================
eq('کلید پنل', PANEL, 'bridge-diagnostics')
check('ردیف LOCKED_PANELS دارد', LOCKED_PANELS.some((p) => p.key === PANEL && /پل تطبیق/.test(p.title)))
check('پیش‌فرض نصب تازه: قفل پنل روشن است', allLockedConfig()[PANEL] === true)
check('isPanelLockEnabled قابل اتکا است', isPanelLockEnabled({}, PANEL) === true)

const panelsSrc = readFileSync('src/shared/panels.ts', 'utf8')
check('کلید تک‌خطی تعریف شده', /bridgeDiagnostics:\s*'bridge-diagnostics'/.test(panelsSrc))

const sessionSrc = readFileSync('src/main/services/panelSession.ts', 'utf8')
check('assertPanelUnlocked دست‌نخورده مانده (backdoor خاموش-قفل فقط در نسخه‌ی soft)', /export async function assertPanelUnlocked\(panel: string, action: string\)[\s\S]{0,400}?isPanelLockEnabled\(await readPanelLocks\(\), key\)/.test(sessionSrc))
check('نسخه‌ی strict رمز تازه می‌خواهد (assertPanelPasswordStrict)', /export async function assertPanelUnlockedStrict[\s\S]*?assertPanelPasswordStrict\(panel, password, action\)[\s\S]*?notePanelUnlocked\(panel, scope\)/.test(sessionSrc))
check('به چیز دیگری در panelSession دستی نرفته: همان سه export قبلی هنوز هستند',
  /export function notePanelUnlocked/.test(sessionSrc) && /export function clearPanelSessions/.test(sessionSrc) && /export function isPanelUnlocked/.test(sessionSrc))

const ipcSrc = readFileSync('src/main/ipc/index.ts', 'utf8')
for (const ch of ['saleReportBridgeDiagOpen', 'saleReportBridgeDiagSources', 'saleReportBridgeDiagNotes', 'saleReportBridgeDiagNoteAdd'])
  check(`هندلر IPC ${ch}`, new RegExp(`handle\\(IPC\\.${ch}`).test(ipcSrc))

const svcSrc = readFileSync('src/main/services/bridgeDiagnosticsService.ts', 'utf8')
check('سرویس از reportRows می‌خواند (نه خودش حساب)', /salesService\.reportRows\(/.test(svcSrc))
check('noteAdd با auditOrThrow می‌نشیند (fail-closed)', /auditOrThrow\(/.test(svcSrc))
check('یادداشت‌ها از AuditLog خوانده می‌شوند', /auditLog\.findMany/.test(svcSrc))
check('بدون کش/بافر — computedAtIso همین لحظه', /new Date\(\)\.toISOString\(\)/.test(svcSrc))
check('prior* نشان تاریخ نمی‌گیرد', /startsWith\('prior'\)/.test(svcSrc))

// ===========================================================================
// ب) نشست و رمز
// ===========================================================================
clearPanelSessions()
applyPanelSessionTtlMs(PANEL_SESSION_TTL_MS)

check('پنل در شروع بسته است', !isPanelUnlocked(PANEL))

const scope = { fromJalali: '1405/06/01', toJalali: '1405/06/01' }
check('open بدون رمز رد می‌شود', /رمز/.test(await errOf(() => svc.open(scope, null)) ?? ''))
check('open بدون رمز نشستی نساخت', !isPanelUnlocked(PANEL))
check('open با رمز اشتباه رد می‌شود', (await errOf(() => svc.open(scope, '9999-wrong'))) != null)
check('open اشتباه هم نشستی نساخت', !isPanelUnlocked(PANEL))

// ===========================================================================
// ج) فیکسچر روز ثابت (نقدیِ ساده — همان الگوی فاز ۰)
// ===========================================================================
const seed = makeSeeder(db)
const userId = seed.user('کاربر نشست ۳۱۸-۲')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار تست-۲', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH-2', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const variantId = seed.variant(product, 'سایز تست-۲')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(100_000, variantId)

await shiftService.openSession({ staffId: userId, name: 'شیفت تست سرویس' })
const invoice = await salesService.create({
  userId,
  lines: [{ variantId, qty: 1, unitPrice: 100_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
})
const at = (day) => jalaliStartOfDay(day).getTime() + 36_000_046
sql
  .prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?')
  .run(at('1405/06/01'), '1405/06/01', at('1405/06/01'), invoice.id)
sql
  .prepare('UPDATE "Payment" SET paidAt = ?, createdAt = ?, paidAtJalali = ?, paidAtTime = ? WHERE invoiceId = ?')
  .run(at('1405/06/01'), at('1405/06/01'), '1405/06/01', '10:00:00', invoice.id)

// ===========================================================================
// د) باز کردن نما با رمز مدیر
// ===========================================================================
const opened = await svc.open(scope, DEFAULT_MANAGER_PASSWORD)
check('open با رمز مدیر موفق است', opened?.ok === true)
check('نشست ثبت شد (sources بدون رمز دوباره کار می‌کند)', isPanelUnlocked(PANEL))
const view = opened.view
check('۱۸ ردیف پل برگشت', Array.isArray(view.rows) && view.rows.length === 18)
eq('explainedTotal دقیقاً همان معادله است', view.bridge.explainedTotal, 100_000)
eq('target', view.bridge.target, 100_000)
eq('balanced=true (پل بسته)', view.bridge.balanced, true)
check('computedAtIso رشته‌ی ISO است', typeof view.computedAtIso === 'string' && view.computedAtIso.includes('T'))
check('guide آرایه است (در پل بسته خالی)', Array.isArray(view.guide) && view.guide.length === 0)
check('پل بسته: هیچ ردیفی flag ندارد', view.rows.every((r) => Array.isArray(r.flags) && r.flags.length === 0))
check('period متادیتای گزارش است', view.period?.fromJalali === '1405/06/01' && view.period?.toJalali === '1405/06/01')
check('notes اولیه خالی است', Array.isArray(view.notes) && view.notes.length === 0)

// ===========================================================================
// ه) sources / notes
// ===========================================================================
const srcRes = await svc.sources(scope, 'realCash')
check('sources برای ردیف واقعی کار می‌کند', srcRes?.ok === true)
check('sources: روKey صحیح', srcRes.result?.rowKey === 'realCash' && srcRes.result?.rowLabel === 'وجه واقعی این بازه')
check('sources: اسناد سندسازی واقعی همان معادله (فاکتور نقدی)', Array.isArray(srcRes.result?.sources) && srcRes.result.sources.length >= 1)
check('sources: تاریخ‌ها در بازه ⇒ نشان نیست', srcRes.result.sources.every((s) => Array.isArray(s.flags) && s.flags.length === 0))
check('ردیف ناموجود رد می‌شود', (await errOf(() => svc.sources(scope, 'nope-row')) ?? '').length > 0)

clearPanelSessions()
check('sources بدون نشست رد می‌شود', /قفل|نشست|رمز/.test(await errOf(() => svc.sources(scope, 'realCash')) ?? ''))
check('notes بدون نشست رد می‌شود', /قفل|نشست|رمز/.test(await errOf(() => svc.notes(scope)) ?? ''))
check('noteAdd بدون نشست رد می‌شود', /قفل|نشست|رمز/.test(await errOf(() => svc.noteAdd(scope, 'تست')) ?? ''))

// ===========================================================================
// و) یادداشت (phase-۴): auditOrThrow + حداکثر طول
// ===========================================================================
await svc.open(scope, DEFAULT_MANAGER_PASSWORD)
const added = await svc.noteAdd(scope, 'پرداخت این فاکتور قبل از بازه کشیده شده است.')
check('noteAdd موفق', added?.ok === true && added?.note?.text === 'پرداخت این فاکتور قبل از بازه کشیده شده است.')
const auditRow = sql.prepare("SELECT action, entity, after FROM \"AuditLog\" WHERE action = 'BRIDGE_DIAG_NOTE_ADD' ORDER BY id DESC LIMIT 1").get()
check('ردیف AuditLog ساخته شد', !!auditRow && auditRow.entity === 'BridgeDiagNote')
check('periodKey در after است', !!auditRow && String(auditRow.after).includes('1405/06/01/1405/06/01'))

const listed = await svc.notes(scope)
check('notes همان یک یادداشت را دارد', Array.isArray(listed.notes) && listed.notes.length === 1 && listed.notes[0].text.includes('کشیده شده'))
check('actorLabel نمایشی است (از displayName)', listed.notes[0].actorLabel === 'کاربر نشست ۳۱۸-۲')

check('یادداشت بلند (۳۰۱+) رد می‌شود', /۳۰۰|300/.test(await errOf(() => svc.noteAdd(scope, 'م'.repeat(301))) ?? ''))
check('یادداشت خالی رد می‌شود', /خالی/.test(await errOf(() => svc.noteAdd(scope, '  ')) ?? ''))

// باز کردن نمای دوره‌ی دیگر: یادداشت دوره‌ی قبلی دیده نمی‌شود (جدایی دوره)
const otherScope = { fromJalali: '1405/06/02', toJalali: '1405/06/02' }
const emptyOther = await svc.notes(otherScope)
check('یادداشت‌ها به دوره‌ی خودشان محدودند', Array.isArray(emptyOther.notes) && emptyOther.notes.length === 0)

// ===========================================================================
// ز) TTL قابل‌کم‌شونده
// ===========================================================================
clearPanelSessions()
applyPanelSessionTtlMs(50)
notePanelUnlocked(PANEL, 'PANEL')
check('نشست تازه زنده است', isPanelUnlocked(PANEL))
await sleep(90)
check('بعد از ۵۰ms+ استراحت منقضی شد', !isPanelUnlocked(PANEL))
check('sources منقضی‌شده رد می‌شود', /قفل|نشست|رمز/.test(await errOf(() => svc.sources(scope, 'realCash')) ?? ''))
applyPanelSessionTtlMs(PANEL_SESSION_TTL_MS)

// ===========================================================================
// ح) رمز دوم پنل (scope=PANEL — جدا از نشست مدیر)
// ===========================================================================
await authService.setPanelPassword({ panel: PANEL, managerPassword: DEFAULT_MANAGER_PASSWORD, password: 'diag-2026' })
clearPanelSessions()
const okSecond = await svc.open(scope, 'diag-2026')
check('open با رمز دوم پنل کار می‌کند', okSecond?.ok === true)
check('نشست PANEL ساخته شد', isPanelUnlocked(PANEL))

clearPanelSessions()
eq('عملکرد رمز مدیر بعد از تعریف رمز دوم هنوز کار می‌کند', (await svc.open(scope, DEFAULT_MANAGER_PASSWORD))?.ok, true)

clearPanelSessions()
console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
