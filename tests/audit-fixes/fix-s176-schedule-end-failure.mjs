/**
 * ===========================================================================
 * نشست ۱۷۶ · خوشه D · S176-D2 — «پایان خودکار» ناموفق تغییر قیمت نباید دسته را «تمام‌شده» جا بزند
 *
 * قبل از رفع: اگر endScheduledBatch به هر دلیلی خطا می‌داد (مثلاً همان سقف IN در S176-D1)،
 * تراکنش rollback می‌شد و قیمت‌ها تخفیف‌خورده می‌ماندند، ولی markScheduleFailure دسته را
 * state=ENDED + revertedAt می‌زد. نتیجه: revert با پیام «قیمت‌ها همان موقع برگشته‌اند» رد می‌شد
 * و deleteBatches(restorePrices) هم آن را بی‌صدا رد می‌کرد ⇒ تخفیف برای همیشه و بی‌راه برگشت
 * روی کالا می‌ماند و سابقه دروغ می‌گفت.
 * انتظار: دسته APPLIED بماند، endAt پاک شود (بدون تلاش بی‌پایان)، یادداشت و Audit صریح، و
 * بازگردانی دستی بعدش قیمت‌ها را دقیقاً برگرداند. شکست «شروع خودکار» مثل قبل ENDED می‌خورد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s176-schedule-end-failure.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s176b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 240)}`) }
}
const run = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطا: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}

const pid = seed.product('کت ۱۷۶', seed.category('پوشاک ۱۷۶'))
const ids = [0, 1, 2].map((i) => seed.insert('ProductVariant', { productId: pid, code: `E176-${i}`, barcode: `EB176-${i}`, salePrice: 1000, purchasePrice: 500, stock: 1 }))
const prices = () => seed.rows('SELECT salePrice p FROM "ProductVariant" ORDER BY id').map((r) => Number(r.p))
const row = (id) => seed.rows('SELECT state, endAt, revertedAt, note FROM "PriceChangeBatch" WHERE id = ?', id)[0] ?? {}

console.log('\n۱) تخفیف ۱۰٪ و شکست عمدی پایان خودکار')
const B = await run('apply', () => priceAdjustService.apply({ kind: 'DISCOUNT', mode: 'PERCENT', value: 10, scope: 'ALL', password: PW }))
eq('قیمت‌ها پس از تخفیف', prices(), [900, 900, 900])
sql.prepare('UPDATE "PriceChangeBatch" SET endAt = ? WHERE id = ?').run(Date.now() - 60_000, B?.batchId ?? -1)
const origUpdate = prisma.productVariant.update.bind(prisma.productVariant)
prisma.productVariant.update = async () => { throw new Error('خطای شبیه‌سازی‌شده‌ی دیسک ۱۷۶') }
const origErr = console.error
console.error = () => {}
const due = await run('runDueSchedules', () => priceAdjustService.runDueSchedules(new Date()))
console.error = origErr
prisma.productVariant.update = origUpdate
eq('ended/failed', due ? [due.ended, due.failed] : null, [0, 1])
eq('قیمت‌ها هنوز تخفیف‌خورده (rollback)', prices(), [900, 900, 900])
const r1 = row(B?.batchId ?? -1)
eq('دسته در جریان ماند (APPLIED)', r1.state ?? null, 'APPLIED')
eq('revertedAt خالی', r1.revertedAt ?? null, null)
eq('endAt پاک شد (بدون تلاش بی‌پایان)', r1.endAt ?? null, null)
eq('یادداشت صریح «برنگشتند»', String(r1.note ?? '').includes('برنگشتند'), true)
eq('Audit شکست پایان خودکار', Number(seed.rows(`SELECT COUNT(*) c FROM "AuditLog" WHERE action = 'PRICE_SCHEDULE_END' AND entityId = ? AND note LIKE '%برنگشتند%'`, B?.batchId ?? -1)[0].c), 1)

console.log('\n۲) نوبت بعدی زمان‌بند همان دسته را دوباره نمی‌گیرد')
const due2 = await run('runDueSchedules 2', () => priceAdjustService.runDueSchedules(new Date()))
eq('ended/failed نوبت دوم', due2 ? [due2.ended, due2.failed] : null, [0, 0])

console.log('\n۳) بازگردانی دستی قیمت‌ها را دقیقاً برمی‌گرداند')
const rv = await run('revert', () => priceAdjustService.revert({ batchId: B?.batchId, password: PW }))
eq('restoredCount', rv?.restoredCount ?? null, 3)
eq('قیمت‌ها پس از بازگردانی', prices(), [1000, 1000, 1000])
eq('وضعیت پس از بازگردانی', row(B?.batchId ?? -1).state ?? null, 'REVERTED')

console.log('\n۴) شکست «شروع خودکار» مثل قبل ENDED می‌خورد (قیمتی عوض نشده)')
const S = seed.insert('PriceChangeBatch', { kind: 'DISCOUNT', mode: 'PERCENT', value: 10, target: 'SALE', scope: 'ALL', title: 'شروع خراب ۱۷۶', state: 'SCHEDULED', startAt: new Date(Date.now() - 60_000), itemCount: 0, deltaTotal: 0, at: new Date() })
console.error = () => {}
prisma.productVariant.update = async () => { throw new Error('خطای شبیه‌سازی‌شده‌ی دیسک ۱۷۶ (شروع)') }
const due3 = await run('runDueSchedules 3', () => priceAdjustService.runDueSchedules(new Date()))
prisma.productVariant.update = origUpdate
console.error = origErr
eq('started/failed', due3 ? [due3.started, due3.failed] : null, [0, 1])
eq('شروع خراب ⇒ ENDED', row(S).state ?? null, 'ENDED')
eq('قیمت‌ها دست‌نخورده', prices(), [1000, 1000, 1000])

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
