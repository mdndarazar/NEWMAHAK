/**
 * ممیزی نشست ۱۳۹ (S139) — ورودی‌های صندوق، actor کانال‌های صندوق و هشدار تحویل نقد، رفتاری.
 *   • recordCashMovement بعد از S139 مبلغ ۰ را رد می‌کند ⇒ برگشت فقط-کاهش-بدهی، تعویض هم‌ارزش و
 *     تعویض بدهی‌کاه، و بستن صندوق با موجودی اول ۰ نباید بشکنند.
 *   • actor بستن صندوق، بستن نشست و واریز/برداشت از مسیر IPC واقعی = کارمند نشست باز، نه userId جعلی.
 *   • AUDIT-S139-01: واریز/برداشت با shiftId ارسالی renderer روی نشست بسته‌ی دیگری ثبت می‌شد (occurredAt
 *     الان، بیرون از پنجره‌ی آن نشست) ⇒ از «نقد مورد انتظار» هر دو نشست غایب.
 *   • AUDIT-S139-02: هشدار تحویل «نشست قبلی» را با closedAt ردیف CashSession ≤ شروع نشست جدید می‌یافت ⇒
 *     بستن دوباره‌ی نشست قبلی (D47) بعد از تحویل نادیده، و بستن بازه‌ای (بی‌نشست) به‌جای نشست قبلی.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s139a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { cashboxService } = await import(join(root, 'src/main/services/CashboxService.ts'))
const { cashMovementService } = await import(join(root, 'src/main/services/CashMovementService.ts'))
const { shiftService } = await import(join(root, 'src/main/services/ShiftService.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 400) } } }
const H = 3600_000
const today = jalaliToday()
seed.setting('panel.locks', { products: false })

/**
 * ⚠️ به‌روزرسانی نشست ۱۸۲ — این سه خط رفتار سنجیده‌شده را عوض نمی‌کنند.
 *
 * از نشست ۱۸۲، «برداشت نقدی» و «موجودی اول صندوق» در سمت *سرور* هم گیت
 * دارند (بند ۴-۴۱): تا وقتی قفل صفحه‌ی بستن صندوق باز نشده باشد، IPC ردشان
 * می‌کند. قبلاً قفل فقط در UI بود و یک فراخوانی مستقیم می‌توانست پول را از
 * کشو خارج نشان دهد یا `expectedCash` را متورم کند تا کسری پنهان شود.
 *
 * این تست درباره‌ی *نشست و شیفتِ* گردش نقدی است، نه درباره‌ی قفل. پس همان
 * کاری را می‌کند که کاربر واقعی می‌کند: اول قفل را باز می‌کند، بعد ثبت.
 * (تست اختصاصی خودِ گیت: `tests/audit-fixes/fix-s182-high-priority.mjs`)
 */
const { notePanelUnlocked } = await import(join(root, 'src/main/services/panelSession.ts'))
const { PANEL_KEYS } = await import(join(root, 'src/shared/panels.ts'))
notePanelUnlocked(PANEL_KEYS.cashClose, 'MANAGER')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const actor = seed.user('صندوق‌دار نشست باز ۱۳۹')
const forged = seed.user('کارمند جعلی ۱۳۹')
const ghost = seed.user('کارمند قبلی ۱۳۹')

console.log('\n— ۰) بدون نشست باز: کانال‌های صندوق رد می‌شوند')
{
  const r1 = await ipc(IPC.cashboxMovementAdd, { type: 'DEPOSIT', amount: 100000, userId: forged })
  eq('واریز بی‌نشست رد (پیام نشست باز)', r1?.ok === false && /نشست باز/.test(String(r1?.error)), true)
  const r2 = await ipc(IPC.cashClose, { countedCash: 0, userId: forged, closeShift: false })
  eq('بستن صندوق بی‌نشست رد', r2?.ok === false && /نشست باز/.test(String(r2?.error)), true)
  eq('هیچ گردش/صندوقی ساخته نشد', [seed.count('CashMovement', '1=1'), seed.count('CashSession', '1=1')], [0, 0])
}

// نشست قبلی (صبح) ۸ تا ۱۴ امروز-نسبی: بسته و شمرده‌شده ۱٬۰۰۰٬۰۰۰
const T = Date.now()
const prevShift = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T - 6 * H, closedAt: T - 3 * H, userId: ghost, staffConfirmed: 1 })
const openShift = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: T - 2 * H, userId: actor, staffConfirmed: 1 })
seed.insert('CashSession', { shiftId: prevShift, fromDate: T - 6 * H, toDate: T - 3 * H, dayJalali: today, countedTotal: 1000000, closedAt: T - 3 * H, createdAt: T - 3 * H })

console.log('\n— ۱) actor واریز/برداشت از مسیر IPC')
{
  const r = await ipc(IPC.cashboxMovementAdd, { type: 'DEPOSIT', amount: 250000, userId: forged, shiftId: openShift })
  eq('واریز روی نشست باز انجام شد', r?.ok ? true : r?.error, true)
  const row = seed.one('SELECT userId, shiftId, amount FROM "CashMovement" ORDER BY id DESC LIMIT 1')
  eq('actor گردش = کارمند نشست باز، نه userId جعلی', [Number(row?.userId), Number(row?.shiftId), Number(row?.amount)], [actor, openShift, 250000])
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE action = 'CASH_MOVEMENT' ORDER BY id DESC LIMIT 1`)
  eq('actor Audit گردش = کارمند نشست باز', Number(a?.userId), actor)
}

console.log('\n— ۲) AUDIT-S139-01: گردش دستی فقط روی نشست باز')
{
  const before = seed.count('CashMovement', '1=1')
  const r = await ipc(IPC.cashboxMovementAdd, { type: 'WITHDRAWAL', amount: 500000, shiftId: prevShift })
  eq('برداشت ۵۰۰٬۰۰۰ با shiftId نشست بسته‌ی قبلی رد می‌شود', r?.ok === false && /نشست باز/.test(String(r?.error)), true)
  eq('هیچ گردشی روی نشست بسته ننشست', seed.count('CashMovement', 'shiftId = ?', prevShift), 0)
  eq('تعداد گردش‌ها ثابت', seed.count('CashMovement', '1=1'), before)
  const r2 = await ipc(IPC.cashboxMovementAdd, { type: 'WITHDRAWAL', amount: 500000, shiftId: 999999 })
  eq('shiftId ناموجود هم رد می‌شود', r2?.ok === false, true)
  const r3 = await safe(() => cashMovementService.add({ type: 'DEPOSIT', amount: 100, shiftId: prevShift, userId: actor }))
  eq('سرویس مستقیم هم گردش روی نشست بسته را رد می‌کند', /نشست باز/.test(String(r3?.__error)), true)
  const r4 = await ipc(IPC.cashboxMovementAdd, { type: 'WITHDRAWAL', amount: 50000 })
  eq('بدون shiftId ⇒ همان نشست باز', r4?.ok ? Number(seed.one('SELECT shiftId FROM "CashMovement" ORDER BY id DESC LIMIT 1')?.shiftId) : r4?.error, openShift)
  const exp = await cashboxService.expected({ shiftId: openShift })
  eq('نقد مورد انتظار نشست باز = ۲۵۰٬۰۰۰ واریز − ۵۰٬۰۰۰ برداشت', exp?.expectedCash ?? exp?.result?.expectedCash ?? exp, 200000)
}

console.log('\n— ۳) صفر به recordCashMovement نمی‌رسد (برگشت/تعویض/بستن)')
{
  const cat = seed.category('شلوار ۱۳۹'); const p = seed.product('جین ۱۳۹', cat)
  const v1 = seed.variant(p, '32'); const v2 = seed.variant(p, '34'); const v3 = seed.variant(p, '36')
  sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000000 WHERE id IN (?, ?)').run(v1, v2)
  sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 700000 WHERE id = ?').run(v3)
  // نسیه ۱٬۰۰۰٬۰۰۰ ⇒ برگشت NONE (فقط کاهش بدهی)
  const credit = await safe(() => salesService.create({ userId: actor, shiftId: openShift, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [] }))
  eq('فروش نسیه ساخته شد', credit?.__error ?? 'ok', 'ok')
  const creditId = credit?.id ?? credit?.invoice?.id
  const r = await safe(() => salesService.createReturn({ invoiceId: creditId, full: true, refundMethod: 'NONE', userId: actor, shiftId: openShift }))
  eq('برگشت کامل نسیه با «بدون بازپرداخت» بدون خطا', r?.__error ?? 'ok', 'ok')
  eq('برگشت نسیه هیچ گردش نقدی نساخت', seed.count('CashMovement', `type IN ('RETURN_REFUND','EXCHANGE_REFUND')`), 0)
  // فروش نقدی ۱٬۰۰۰٬۰۰۰ ⇒ تعویض هم‌ارزش (مابه‌التفاوت ۰)
  const sold = await safe(() => salesService.create({ userId: actor, shiftId: openShift, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] }))
  const soldId = sold?.id ?? sold?.invoice?.id
  const item = seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', soldId)
  const ex = await safe(() => salesService.createExchange({ invoiceId: soldId, lines: [{ saleItemId: item?.id, qty: 1 }], replacements: [{ variantId: v2, qty: 1 }], userId: actor, shiftId: openShift }))
  eq('تعویض هم‌ارزش (مابه‌التفاوت ۰) بدون خطا', ex?.__error ?? 'ok', 'ok')
  // نسیه ۱٬۰۰۰٬۰۰۰ ⇒ تعویض با کالای ارزان‌تر ۷۰۰٬۰۰۰ ⇒ کل مابه‌التفاوت صرف کاهش بدهی (owed ≤ ۰)
  const credit2 = await safe(() => salesService.create({ userId: actor, shiftId: openShift, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [] }))
  const c2 = credit2?.id ?? credit2?.invoice?.id
  const item2 = seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', c2)
  const ex2 = await safe(() => salesService.createExchange({ invoiceId: c2, lines: [{ saleItemId: item2?.id, qty: 1 }], replacements: [{ variantId: v3, qty: 1 }], userId: actor, shiftId: openShift }))
  eq('تعویض ارزان‌تر روی نسیه (فقط کاهش بدهی) بدون خطا', ex2?.__error ?? 'ok', 'ok')
  eq('هیچ گردش بازپرداختی ساخته نشد', seed.count('CashMovement', `type IN ('RETURN_REFUND','EXCHANGE_REFUND')`), 0)
}

console.log('\n— ۴) validation شمارش/موجودی اول/آستانه')
{
  for (const [lbl, extra, needle] of [
    ['آستانه‌ی منفی', { differenceThreshold: -1 }, 'آستانه'],
    ['آستانه‌ی اعشاری', { differenceThreshold: 1.5 }, 'آستانه'],
    ['شمارش NaN', { countedCash: Number.NaN }, 'شمارش'],
    ['شمارش متنی', { countedCash: '۱۰۰' }, 'شمارش'],
    ['موجودی اول اعشاری', { openingFloat: 0.5 }, 'موجودی اول'],
  ]) {
    const r = await safe(() => cashboxService.expected({ shiftId: openShift, ...extra }))
    eq(`expected: ${lbl} با پیام هدف رد می‌شود`, String(r?.__error ?? 'پذیرفته شد').includes(needle), true)
  }
  const r = await safe(() => shiftService.confirmStaff({ shiftId: openShift, staffId: actor + 0.5, userId: actor }))
  eq('confirmStaff با شناسه‌ی اعشاری رد (عدد صحیح)', /عدد صحیح/.test(String(r?.__error)), true)
}

console.log('\n— ۵) AUDIT-S139-02: هشدار تحویل از آخرین شمارش نشست قبلی')
{
  const w0 = await cashboxService.expected({ shiftId: openShift, openingFloat: 1000000 })
  eq('موجودی اول برابر شمارش نشست قبلی ⇒ بدون هشدار تحویل', (w0.warnings ?? []).some((w) => /اختلاف شمارش نقد/.test(w)), false)
  // صبح دوباره بسته شد (D47) بعد از باز شدن نشست شب: شمارش اصلاحی ۹۰۰٬۰۰۰
  seed.insert('CashSession', { shiftId: prevShift, fromDate: T - 6 * H, toDate: T - 1 * H, dayJalali: today, countedTotal: 900000, closedAt: T - 1 * H, createdAt: T - 1 * H })
  const w1 = await cashboxService.expected({ shiftId: openShift, openingFloat: 1000000 })
  eq('بستن دوباره‌ی نشست قبلی بعد از تحویل ⇒ هشدار با آخرین شمارش ۹۰۰٬۰۰۰', (w1.warnings ?? []).some((w) => /اختلاف شمارش نقد/.test(w) && w.includes('۹۰۰٬۰۰۰')), true)
  const w2 = await cashboxService.expected({ shiftId: openShift, openingFloat: 900000 })
  eq('موجودی اول ۹۰۰٬۰۰۰ = آخرین شمارش ⇒ بدون هشدار کاذب', (w2.warnings ?? []).some((w) => /اختلاف شمارش نقد/.test(w)), false)
  // بستن بازه‌ای بی‌نشست پیش از شروع نشست شب نباید «نشست قبلی» فرض شود
  seed.insert('CashSession', { shiftId: null, fromDate: T - 10 * H, toDate: T - 2.5 * H, dayJalali: today, countedTotal: 5000000, closedAt: T - 2.5 * H, createdAt: T - 2.5 * H })
  const w3 = await cashboxService.expected({ shiftId: openShift, openingFloat: 900000 })
  eq('بستن بازه‌ای بی‌نشست جای نشست قبلی را نمی‌گیرد', (w3.warnings ?? []).some((w) => /اختلاف شمارش نقد/.test(w)), false)
}

console.log('\n— ۶) actor بستن صندوق و بستن نشست از مسیر IPC')
{
  const r = await ipc(IPC.cashClose, { shiftId: openShift, explicitShift: true, countedCash: 200000, openingFloat: 0, userId: forged, note: 'بستن ۱۳۹', closeShift: false })
  eq('بستن صندوق با موجودی اول ۰ انجام شد', r?.ok ? true : r?.error, true)
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'CashSession' ORDER BY id DESC LIMIT 1`)
  eq('actor Audit بستن صندوق = کارمند نشست باز', Number(a?.userId), actor)
  const r2 = await ipc(IPC.shiftClose, { userId: forged })
  eq('بستن نشست انجام شد', r2?.ok ? true : r2?.error, true)
  const b = seed.one(`SELECT userId FROM "AuditLog" WHERE action = 'SHIFT_CLOSE' ORDER BY id DESC LIMIT 1`)
  eq('actor Audit بستن نشست = کارمند نشست باز', Number(b?.userId), actor)
}
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
