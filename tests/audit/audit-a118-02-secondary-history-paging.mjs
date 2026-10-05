/**
 * ممیزی نشست ۱۱۸ — A118-02 (P3، UI): تاریخچه‌ی انبار مرکزی (SecondaryStock.tsx).
 * قبل: historySkip در state جدا + effect جدای setHistorySkip(0) روی onlyTransfers. تیک «فقط انتقال‌ها» در صفحه‌ی ۲
 * دو درخواست هم‌زمان می‌فرستاد: اول با skip قدیم (۵٬۰۰۰) و فیلتر تازه، بعد با skip صفر؛ پاسخ دیرتر برنده بود.
 * مثال عددی: ۵٬۰۰۲ ردیف (۲ انتقال). صفحه‌ی ۲ (skip=۵٬۰۰۰) ⇒ تیک «فقط انتقال‌ها» ⇒ درخواست کهنه skip=۵٬۰۰۰ ⇒ ۰ ردیف
 * با نوار «نمایش ۵٬۰۰۱ تا ۵٬۰۰۰ از ۲»؛ اگر دیرتر برسد، ۲ انتقال واقعی دیده نمی‌شوند.
 * رفع: historySkipState {skip, signature} + creditEffectiveSkip در همان رندر + historyReq برای دور ریختن پاسخ کهنه (AUDIT-D54).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11802-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { secondaryStockService } = await import('../../src/main/services/SecondaryStockService.ts')
const { creditEffectiveSkip } = await import('../../src/shared/creditUi.ts')
let secondaryHistorySignature = null
try { ({ secondaryHistorySignature } = await import('../../src/shared/secondaryHistoryUi.ts')) } catch { /* قبل از رفع helper نیست */ }
const db = harnessClient()
await db.secondaryStockLog.count() // ساخت جدول‌ها
const raw = db.$harness.db
const cols = raw.prepare('PRAGMA table_info(SecondaryStockLog)').all()
const base = { itemId: null, warehouseId: 1, warehouseName: 'انبار ۱', action: 'UPDATE', name: 'کالا', code: null, qtyBefore: 0, qtyAfter: 1, delta: 1, note: null, userId: null, at: Date.now(), atJalali: '1405/07/04', atTime: '10:00' }
for (const c of cols) if (c.notnull && !c.pk && !(c.name in base)) base[c.name] = c.type.includes('INT') ? 0 : ''
const names = Object.keys(base)
const ins = raw.prepare(`INSERT INTO SecondaryStockLog (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
raw.exec('BEGIN')
for (let i = 0; i < 5002; i++) {
  const r = { ...base, action: i < 2 ? (i === 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN') : 'UPDATE' } // دو انتقال قدیمی‌ترین‌اند ⇒ ته صفحه‌ی ۲ «همه»
  ins.run(...names.map((n) => r[n]))
}
raw.exec('COMMIT')

// سرویس
const all1 = await secondaryStockService.history({ onlyTransfers: false, take: 5000, skip: 0 })
eq('همه: صفحه‌ی ۱ ۵٬۰۰۰ از ۵٬۰۰۲، truncated', [all1.length, all1.page.totalCount, all1.page.truncated], [5000, 5002, true])
const all2 = await secondaryStockService.history({ onlyTransfers: false, take: 5000, skip: 5000 })
eq('همه: صفحه‌ی ۲ همان ۲ انتقال قدیمی، بدون truncated', [all2.length, all2.map((r) => r.action).sort(), all2.page.truncated], [2, ['TRANSFER_IN', 'TRANSFER_OUT'], false])
const stale = await secondaryStockService.history({ onlyTransfers: true, take: 5000, skip: 5000 })
eq('(شاهد باگ) درخواست کهنه skip=۵٬۰۰۰ با فیلتر تازه ⇒ ۰ ردیف از ۲', [stale.length, stale.page.totalCount], [0, 2])

// helper: skip مؤثر در همان رندر، با امضای فیلتر
const sigOf = (v) => (secondaryHistorySignature ? secondaryHistorySignature({ onlyTransfers: v }) : null)
eq('امضای فیلتر برای true/false فرق دارد', sigOf(true) !== null && sigOf(true) !== sigOf(false), true)
const state = { skip: 5000, signature: sigOf(false) }
const effAfterToggle = creditEffectiveSkip(state, sigOf(true))
eq('بعد از تیک، skip مؤثر در همان رندر صفر است', secondaryHistorySignature ? effAfterToggle : 'no-helper', 0)
eq('بدون تغییر فیلتر skip صفحه حفظ می‌شود', secondaryHistorySignature ? creditEffectiveSkip(state, sigOf(false)) : 'no-helper', 5000)
const fixed = await secondaryStockService.history({ onlyTransfers: true, take: 5000, skip: secondaryHistorySignature ? effAfterToggle : 5000 })
eq('تنها درخواست بعد از تیک ⇒ ۲ انتقال، نوار ۱ تا ۲ از ۲', [fixed.length, fixed.page.skip, fixed.page.totalCount], [2, 0, 2])

// UI
const ui = readFileSync(resolve('src/renderer/src/pages/SecondaryStock.tsx'), 'utf8')
eq('effect جدای setHistorySkip(0) حذف شد', /setHistorySkip\(0\)/.test(ui), false)
eq('state صفحه با امضا: historySkipState', /const \[historySkipState, setHistorySkipState\] = useState/.test(ui), true)
eq('skip مؤثر با creditEffectiveSkip و امضای فیلتر', /const historySignature = secondaryHistorySignature\(\{ onlyTransfers \}\)/.test(ui) && /const historySkip = creditEffectiveSkip\(historySkipState, historySignature\)/.test(ui), true)
eq('پاسخ کهنه دور ریخته می‌شود (historyReq)', /const historyReq = useRef\(0\)/.test(ui) && /const seq = \+\+historyReq\.current/.test(ui) && (ui.match(/if \(seq !== historyReq\.current\) return/g) || []).length >= 2, true)
eq('دکمه‌های صفحه skip را با امضای فعلی ثبت می‌کنند', /setHistorySkipState\(\{ skip: Math.max\(0, skip\), signature: historySignature \}\)/.test(ui) && /goHistoryPage\(historyPage\.skip - historyPage\.take\)/.test(ui) && /goHistoryPage\(historyPage\.skip \+ historyPage\.take\)/.test(ui), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
