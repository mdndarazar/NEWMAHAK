// نشست ۱۷۹: تست قبل/بعد مشاهده‌های P3 ردیف ۱۱۱ AUDIT-PROGRESS (actor مرور ضدتقلب؛ چک تکراری).
/**
 * ===========================================================================
 * نشست ۱۷۹ · بند ۴-۳۰ («هر actor در Audit»)، بند ۵ (audit با actor واقعی) و هدف «فهمیدن دزدی»
 *
 * قبل از رفع:
 *   ۱) FraudService.review در Audit «مرور ضدتقلب» userId *فیلتر کارمند* را actor می‌نوشت:
 *      مدیر گزارش کارمند «ب» را می‌بیند ⇒ سابقه می‌گوید «ب» خودش هشدارهای خودش را مرور کرد.
 *      IPC هم هیچ actor نشستی نمی‌داد.
 *   ۲) «چک با شماره‌ی تکراری» فقط داخل بازه‌ی گزارش گروه می‌کرد ⇒ چکی که ماه قبل یک بار و
 *      امروز دوباره خرج شده هرگز هشدار نمی‌گرفت؛ «۱۲۳۴۵» و «۱۲۳۴۵» (رقم فارسی) یا «12 345» دو
 *      شماره‌ی جدا شمرده می‌شدند؛ ترتیب منابع (برش ۲۰۰) قطعی نبود.
 * انتظار بعد: actor = کارمند نشست باز main (بدون نشست ⇒ null)، فیلتر در after؛ تکرار
 * همه‌ی زمان‌ها با کلید نرمال‌شده، به شرط حداقل یک استفاده در بازه؛ مبلغ = جمع همان بازه؛
 * چک باطل‌شده شمرده نمی‌شود؛ ترتیب منابع بر اساس شماره.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s179-fraud-actor-duplicate-cheque.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s179-fraud-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
/**
 * نشست Main-first owner را فقط از webContents معتبر می‌گیرد. این harness قبلاً
 * event=null می‌داد، بنابراین پیش از رسیدن به سنجش actor به‌درستی رد می‌شد و
 * دیگر رفتار واقعی IPC را نمی‌سنجید.
 */
const owner = 17901
const sender = { id: owner, isDestroyed: () => false, once: () => {} }
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { notePanelUnlocked, runWithPanelSessionOwner } = await import('../../src/main/services/panelSession.ts')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { jalaliToday, jalaliStartOfDay, jalaliAddDays: addDaysJalali } = await import('@shared/jalali')
registerIpcHandlers()
/** گزارش ضدتقلب فقط از پنل گزارشات همان webContents خوانده می‌شود. */
runWithPanelSessionOwner(owner, () => notePanelUnlocked('sales-reports', 'PANEL'))
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const lastReview = () => seed.one('SELECT id, userId, after FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'FRAUD_REVIEW')

const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const OLD = T0 - 35 * 86400_000 // ماه قبل
const cashier = seed.user('صندوق‌دار نشست باز ۱۷۹')
const staffB = seed.user('فروشنده‌ی ب ۱۷۹')
const forged = seed.user('کارمند جعلی ۱۷۹')

console.log('۱) actor مرور ضدتقلب')
{
  // بدون نشست باز: فراخوانی مستقیم با فیلتر کارمند ب ⇒ actor نباید «ب» باشد
  await fraudService.review({ fromJalali: today, toJalali: today, userId: staffB })
  const a0 = lastReview()
  truthy('ردیف Audit مرور ساخته شد', !!a0)
  eq('بدون نشست: actor ≠ فیلتر کارمند (null)', a0?.userId == null ? null : Number(a0.userId), null)
  truthy('فیلتر کارمند در after ثبت شده (filterUserId)', String(a0?.after ?? '').includes(`"filterUserId":${staffB}`))

  seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: cashier })
  const r = await ipc(IPC.saleFraudReview, { fromJalali: today, toJalali: today, userId: staffB, actorId: forged })
  truthy('IPC مرور موفق', r?.ok === true)
  const a1 = lastReview()
  eq('با نشست باز: actor = صندوق‌دار نشست (نه فیلتر، نه actorId جعلی)', a1?.userId == null ? null : Number(a1.userId), cashier)
  truthy('after: filterUserId = ب', String(a1?.after ?? '').includes(`"filterUserId":${staffB}`))
  const r2 = await ipc(IPC.saleFraudReview, { fromJalali: today, toJalali: today })
  eq('IPC بدون فیلتر ⇒ actor همان صندوق‌دار', Number(lastReview()?.userId), cashier)
  truthy('IPC بدون فیلتر موفق', r2?.ok === true)
}

console.log('۲) چک تکراری بین بازه‌ها و با رقم فارسی/فاصله')
{
  const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
  const inv = seed.insert('SaleInvoice', { receiptNo: 9001, userId: staffB, status: 'SETTLED', grandTotal: 9_000_000, paidTotal: 9_000_000, issuedAt: T0 + 3600_000, issuedAtJalali: today })
  const pay = (chequeNo, amount, at, extra = {}) =>
    seed.insert('Payment', { invoiceId: inv, methodId: cheque, kind: 'CHEQUE', chequeNo, amount, paidAt: at, createdAt: at, ...extra })
  // الف) ماه قبل یک بار، امروز دوباره ⇒ باید هشدار بگیرد
  pay('55501', 2_000_000, OLD)
  pay('55501', 2_000_000, T0 + 2 * 3600_000)
  // ب) همان شماره با رقم فارسی و فاصله ⇒ یک چک
  pay('۷۷ ۷۰۲', 3_000_000, T0 + 3 * 3600_000)
  pay('77702', 3_000_000, T0 + 4 * 3600_000)
  // ج) فقط یک بار (امروز) ⇒ هشدار نه
  pay('11103', 1_000_000, T0 + 5 * 3600_000)
  // د) تکرار فقط در گذشته ⇒ در گزارش امروز نه
  pay('33304', 500_000, OLD)
  pay('33304', 500_000, OLD + 3600_000)
  // هـ) استفاده‌ی دوم باطل‌شده ⇒ تکرار نیست
  pay('44405', 700_000, OLD)
  pay('44405', 700_000, T0 + 6 * 3600_000, { voidedAt: T0 + 7 * 3600_000 })
  // و) داخل همان روز دو بار (رفتار قبلی حفظ شود)
  pay('00906', 400_000, T0 + 8 * 3600_000)
  pay('00906', 400_000, T0 + 9 * 3600_000)

  const res = await fraudService.review({ fromJalali: today, toJalali: today })
  const f = res.flags.find((x) => x.key === 'duplicateCheques')
  truthy('هشدار چک تکراری وجود دارد', !!f)
  const labels = (f?.sources ?? []).map((s) => s.label)
  console.log('    منابع:', JSON.stringify(labels))
  eq('تعداد شماره‌های تکراری = ۳ (55501، 77702، 00906)', f?.count, 3)
  truthy('55501 (ماه قبل + امروز) گرفته شد', labels.some((l) => l.includes('55501')))
  truthy('77702 (فارسی/فاصله) گرفته شد', labels.some((l) => l.includes('77702')))
  truthy('00906 (دو بار امروز) هنوز گرفته می‌شود', labels.some((l) => l.includes('00906')))
  truthy('11103 (یک بار) هشدار ندارد', !labels.some((l) => l.includes('11103')))
  truthy('33304 (تکرار فقط در گذشته) در گزارش امروز نیست', !labels.some((l) => l.includes('33304')))
  truthy('44405 (دومی باطل) هشدار ندارد', !labels.some((l) => l.includes('44405')))
  eq('مبلغ = جمع استفاده‌های داخل بازه (۲م + ۶م + ۰٫۸م)', f?.amount, 2_000_000 + 6_000_000 + 800_000)
  eq('ترتیب منابع قطعی بر اساس شماره', labels.map((l) => (l.match(/\d{5}/) ?? [''])[0]), ['00906', '55501', '77702'])
  truthy('برچسب 55501 استفاده در بازه‌ی دیگر را می‌گوید', labels.some((l) => l.includes('55501') && l.includes('بازه')))
  const src = f?.sources?.find((s) => s.label.includes('55501'))
  eq('منبع 55501: مبلغ همان بازه', src?.amount, 2_000_000)

  // گزارش ماه قبل: 55501 و 33304 و 44405 (هر کدام حداقل یک استفاده آن روز)
  const oldDay = addDaysJalali ? addDaysJalali(today, -35) : null
  if (oldDay) {
    const r2 = await fraudService.review({ fromJalali: oldDay, toJalali: oldDay })
    const f2 = r2.flags.find((x) => x.key === 'duplicateCheques')
    const l2 = (f2?.sources ?? []).map((s) => s.label)
    truthy('گزارش ماه قبل: 55501 (تکرار بعدی) هم دیده می‌شود', l2.some((l) => l.includes('55501')))
    truthy('گزارش ماه قبل: 33304 دیده می‌شود', l2.some((l) => l.includes('33304')))
    truthy('گزارش ماه قبل: 44405 (دومی باطل) دیده نمی‌شود', !l2.some((l) => l.includes('44405')))
  } else truthy('addDaysJalali در دسترس', false)
}

console.log(`\nنتیجه: ${ok} موفق، ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
