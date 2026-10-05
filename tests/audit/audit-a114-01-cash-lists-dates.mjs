/**
 * ممیزی نشست ۱۱۴ — CashMovementService.list، CardTransferService.list/outOfSales، CashboxService.sessions/list.
 * ادعای S114 (جمع کل بازه، page/warnings) در fix-s114×۳ رفتاری است؛ این تست تاریخ ورودی را می‌سنجد.
 * A114-01 (P3): تاریخ خالی/نامعتبر سنجیده نمی‌شد:
 *   • گردش صندوق و سابقه‌ی بستن/تجمیع: '' ⇒ jalaliStartOfDay('') ⇒ Invalid Date ⇒ فهرست و جمع خالیِ بی‌صدا
 *     (برداشت ۲۰۰٬۰۰۰ امروز ناپیدا) به‌جای «امروز» (بند ۴-۲۳).
 *   • کارت‌به‌کارت: '' ⇒ بدون قید تاریخ ⇒ کل تاریخچه با جمع «امروز» (دیروز ۷۰۰٬۰۰۰ در جمع امروز)؛
 *     تاریخ نامعتبر («۱۴۰۵/۱۳/۰۱») هم در try/catch بلعیده ⇒ کل تاریخچه‌ی بی‌قید.
 *   قاعده (AUDIT-D45): خالی ⇒ امروز، نامعتبر ⇒ خطای فارسی (الگوی shiftListDate/fraudReportDate).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return String(e?.message ?? e) } }
const faErr = (e) => !!e && /[\u0600-\u06FF]/.test(e) && !/Invalid|jalaali/i.test(e)
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11401-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
const { cardTransferService } = await import('../../src/main/services/CardTransferService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const Y = new Date(T0 - 12 * 3600_000) // دیروز ظهر
const N = new Date(T0 + 60_000) // امروز ۰۰:۰۱
const A = seed.user('فروشنده الف')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0, userId: A })
seed.insert('CashMovement', { amount: 200000, type: 'WITHDRAWAL', occurredAt: N.getTime(), occurredAtJalali: today, shiftId: S, userId: A })
seed.insert('CashMovement', { amount: 900000, type: 'WITHDRAWAL', occurredAt: Y.getTime(), occurredAtJalali: toJalaliDate(Y), shiftId: null, userId: A })
seed.insert('CardTransferRequest', { kind: 'REQUEST', status: 'PENDING', operationKind: 'RETURN', returnId: 1, amount: 300000, createdAt: N.getTime(), createdAtJalali: today })
seed.insert('CardTransferRequest', { kind: 'REQUEST', status: 'PENDING', operationKind: 'RETURN', returnId: 2, amount: 700000, createdAt: Y.getTime(), createdAtJalali: toJalaliDate(Y) })
seed.insert('CashSession', { shiftId: S, fromDate: N.getTime(), toDate: N.getTime(), dayJalali: today, closedAt: N.getTime(), createdAt: N.getTime() })
seed.insert('CashSession', { shiftId: null, fromDate: Y.getTime(), toDate: Y.getTime(), dayJalali: toJalaliDate(Y), closedAt: Y.getTime(), createdAt: Y.getTime() })
seed.insert('Consolidation', { fromDate: N.getTime(), toDate: N.getTime(), dayJalali: today, createdAt: N.getTime() })
seed.insert('Consolidation', { fromDate: Y.getTime(), toDate: Y.getTime(), dayJalali: toJalaliDate(Y), createdAt: Y.getTime() })
const rowsOf = (r) => (Array.isArray(r) ? r : r?.rows ?? [])

console.log('— کنترل: تاریخ صریح امروز')
const mv = await cashMovementService.list({ fromJalali: today, toJalali: today })
eq('گردش امروز: ۱ ردیف، برداشت ۲۰۰٬۰۰۰', [mv.rows.length, mv.totals.withdrawals], [1, 200000])
const ct = await cardTransferService.list({ fromJalali: today, toJalali: today })
eq('کارت‌به‌کارت امروز: ۱ ردیف', rowsOf(ct).length, 1)
eq('سابقه‌ی بستن امروز: ۱', rowsOf(await cashboxService.sessions({ fromJalali: today, toJalali: today })).length, 1)
eq('سابقه‌ی تجمیع امروز: ۱', rowsOf(await cashboxService.list({ fromJalali: today, toJalali: today })).length, 1)

console.log('— A114-01: «از/تا» خالی ⇒ امروز')
const e1 = await errOf(async () => { const r = await cashMovementService.list({ fromJalali: '', toJalali: '' }); if (r.rows.length !== 1 || r.totals.withdrawals !== 200000) throw new Error(`rows ${r.rows.length} w ${r.totals.withdrawals}`) })
eq('گردش صندوق خالی = امروز (۱ ردیف، ۲۰۰٬۰۰۰)', e1, null)
const e2 = await errOf(async () => { const r = await cardTransferService.list({ fromJalali: '', toJalali: '' }); if (rowsOf(r).length !== 1) throw new Error(`rows ${rowsOf(r).length}`) })
eq('کارت‌به‌کارت خالی = امروز (۱، نه کل تاریخچه)', e2, null)
const e3 = await errOf(async () => { const r = await cardTransferService.outOfSales({ fromJalali: '', toJalali: '' }); if (rowsOf(r).length !== 1) throw new Error(`rows ${rowsOf(r).length}`) })
eq('خارج از فروش خالی = امروز (۱)', e3, null)
const e4 = await errOf(async () => { const r = await cashboxService.sessions({ fromJalali: '', toJalali: '' }); if (rowsOf(r).length !== 1) throw new Error(`rows ${rowsOf(r).length}`) })
eq('سابقه‌ی بستن خالی = امروز (۱)', e4, null)
const e5 = await errOf(async () => { const r = await cashboxService.list({ fromJalali: '', toJalali: '' }); if (rowsOf(r).length !== 1) throw new Error(`rows ${rowsOf(r).length}`) })
eq('سابقه‌ی تجمیع خالی = امروز (۱)', e5, null)
const e6 = await errOf(async () => { const r = await cashMovementService.list({ shiftId: S, fromJalali: '', toJalali: '' }); if (r.rows.length !== 1) throw new Error(`rows ${r.rows.length}`) })
eq('گردش با shiftId و تاریخ خالی = کل نشست (قاعده‌ی A92-01 حفظ)', e6, null)

console.log('— A114-01: تاریخ نامعتبر ⇒ خطای فارسی')
for (const b of ['1405/13/01', '1405/0']) {
  eq(`گردش صندوق «${b}»`, faErr(await errOf(() => cashMovementService.list({ fromJalali: b, toJalali: today }))), true)
  eq(`کارت‌به‌کارت «${b}»`, faErr(await errOf(() => cardTransferService.list({ fromJalali: today, toJalali: b }))), true)
  eq(`خارج از فروش «${b}»`, faErr(await errOf(() => cardTransferService.outOfSales({ fromJalali: b, toJalali: today }))), true)
  eq(`سابقه‌ی بستن «${b}»`, faErr(await errOf(() => cashboxService.sessions({ fromJalali: b, toJalali: today }))), true)
  eq(`سابقه‌ی تجمیع «${b}»`, faErr(await errOf(() => cashboxService.list({ fromJalali: today, toJalali: b }))), true)
  eq(`گردش با shiftId «${b}» هم رد شود`, faErr(await errOf(() => cashMovementService.list({ shiftId: S, fromJalali: b }))), true)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
