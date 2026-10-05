/**
 * ممیزی A77-01 — هر ردِ «بستن تکراری» در main باید در UI قابل‌تأیید باشد.
 * قبلاً UI فقط تطابق دقیق بازه/نشستِ فهرست بارگذاری‌شده را می‌دید؛ بستن بازه‌ی
 * ۰۱ تا ۰۲ بعد از بستن روز ۰۱ در main رد می‌شد ولی دکمه‌ی «بستن دوباره» هرگز
 * ظاهر نمی‌شد ⇒ بستن صندوق عملاً ناممکن. همچنین پیام race درون تراکنش.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const ui = readFileSync(resolve('src/renderer/src/pages/CashClose.tsx'), 'utf8')
const svc = readFileSync(resolve('src/main/services/CashboxService.ts'), 'utf8')
eq('UI: رد تکراری main به تأیید «بستن دوباره» تبدیل می‌شود', /isRepeatCloseRejection\(msg\)[\s\S]{0,80}setRepeatRequired\(true\)/.test(ui), true)
eq('UI: تأیید با پرچم main ارسال می‌شود', /doClose\(priorCloseForTarget \|\| repeatRequired\)/.test(ui), true)
eq('main: پیام race داخل تراکنش هم قابل‌تأیید است', (svc.match(/بستن دوباره را تأیید کنید/g) ?? []).length >= 2, true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a77-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const user = seed.user('کارمند')
const product = seed.product('کالا', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
await salesService.create({ userId: user, lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
sql.exec('UPDATE "Shift" SET closedAt = NULL')
await cashboxService.close({ fromJalali: today, toJalali: today, userId: user, closeShift: false, explicitShift: true, shiftId: null })
let msg = ''
try { await cashboxService.close({ fromJalali: today, toJalali: today, userId: user, closeShift: false, explicitShift: true, shiftId: null }) } catch (e) { msg = String(e.message) }
const uiMatcher = /بستن دوباره را تأیید کنید/
eq('main بستن تکراری بازه را رد کرد', msg.length > 0, true)
eq('پیام رد با تشخیص UI جور است', uiMatcher.test(msg), true)
const again = await cashboxService.close({ fromJalali: today, toJalali: today, userId: user, closeShift: false, explicitShift: true, shiftId: null, allowRepeatClose: true })
eq('با تأیید، snapshot دوم ثبت شد', !!again?.session?.id, true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
