/**
 * نشست ۱۷۸ (S178-D4) — مشاهده‌ی P3 ردیف ۱۲۶ AUDIT-PROGRESS: پیش‌نمایش «حذف همیشگی کالا» مانع‌های واقعی purge
 * (کالای هنوز فعال، مهلت ۷۳۰ روز سطل آشغال، حرکت انبار) را به‌صورت تصمیم نمی‌گفت؛ پیش‌نمایش کالای تازه‌حذف را بی‌هیچ
 * هشداری فهرست می‌کرد و دکمه‌ی «بله، برای همیشه پاک کن» فعال بود، ولی purge رد می‌کرد (پیش‌نمایش ≠ عملیات، D53/D59).
 * رفع: preview برای هر ردیف blockedReason فارسی و در کل blockers + canPurge برمی‌گرداند؛ همان شرط‌های purge.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s178vp-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { variantPurgeService } = await import(join(root, 'src/main/services/VariantPurgeService.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 400) } } }
const DAY = 86400000
const p = seed.product('جین', seed.category('پوشاک'))
const mk = (size, deletedAt, active = 0) => { const id = seed.variant(p, size); sql.prepare('UPDATE "ProductVariant" SET isActive = ?, deletedAt = ? WHERE id = ?').run(active, deletedAt, id); return id }
const vActive = mk('۲۸', null, 1)
const vRecent = mk('۳۰', Date.now() - 10 * DAY)
const vNull = mk('۳۱', null)
const vOk = mk('۳۲', Date.now() - 731 * DAY)
const vMove = mk('۳۴', Date.now() - 731 * DAY)
seed.insert('StockMovement', { variantId: vMove, delta: 1, reason: 'INITIAL', createdAt: Date.now() - 800 * DAY })
const line = (pv, id) => (pv?.lines ?? []).find((l) => l.variantId === id)

console.log('— ۱) پیش‌نمایش مانع‌ها را همان‌طور می‌گوید که purge رد می‌کند')
const pRecent = await safe(() => variantPurgeService.preview({ variantIds: [vRecent] }))
eq('تازه‌حذف (۱۰ روز): canPurge = false', pRecent?.canPurge, false)
eq('تازه‌حذف: مانع ردیف پیام مهلت ۷۳۰ روز دارد', /۷۳۰ روز/.test(line(pRecent, vRecent)?.blockedReason ?? ''), true)
eq('تازه‌حذف: blockers کل پیش‌نمایش پیام فارسی مهلت دارد', (pRecent?.blockers ?? []).some((b) => /۱ کالا.*۷۳۰ روز/.test(b)), true)
const rRecent = await safe(() => variantPurgeService.purge({ variantIds: [vRecent], managerPassword: PW }))
eq('purge همان کالا رد می‌شود (پیش‌نمایش = عملیات)', /روز کامل در سطل آشغال نمانده/.test(rRecent?.__error ?? ''), true)
const pNull = await safe(() => variantPurgeService.preview({ variantIds: [vNull] }))
eq('بدون deletedAt: canPurge = false با پیام مهلت', [pNull?.canPurge, /۷۳۰ روز/.test(line(pNull, vNull)?.blockedReason ?? '')], [false, true])
const pActive = await safe(() => variantPurgeService.preview({ variantIds: [vActive] }))
eq('کالای فعال: canPurge = false و پیام «هنوز در فهرست کالاهای فعال»', [pActive?.canPurge, /فعال/.test(line(pActive, vActive)?.blockedReason ?? '')], [false, true])
const pMove = await safe(() => variantPurgeService.preview({ variantIds: [vMove] }))
eq('دارای حرکت انبار: canPurge = false و پیام دفتر گردش', [pMove?.canPurge, /حرکت انبار/.test(line(pMove, vMove)?.blockedReason ?? '')], [false, true])
const rMove = await safe(() => variantPurgeService.purge({ variantIds: [vMove], managerPassword: PW }))
eq('purge کالای دارای حرکت رد می‌شود', typeof rMove?.__error === 'string', true)
const pMixed = await safe(() => variantPurgeService.preview({ variantIds: [vOk, vRecent] }))
eq('مخلوط (مجاز + تازه): canPurge = false (همه یا هیچ) و فقط ردیف تازه مانع دارد', [pMixed?.canPurge, line(pMixed, vOk)?.blockedReason ?? null, !!line(pMixed, vRecent)?.blockedReason], [false, null, true])
const pMissing = await safe(() => variantPurgeService.preview({ variantIds: [vOk, 999999] }))
eq('شناسه‌ی ناموجود: هشدار «پیدا نشد» ولی مانع حذف موارد موجود نیست (purge هم فقط موجودها را می‌گیرد)', [pMissing?.canPurge, (pMissing?.blockers ?? []).length, (pMissing?.notices ?? []).some((b) => /پیدا نشد/.test(b))], [true, 0, true])

console.log('\n— ۲) مسیر مجاز')
const pOk = await safe(() => variantPurgeService.preview({ variantIds: [vOk] }))
eq('۷۳۱ روز بی‌حرکت: canPurge = true، بدون مانع', [pOk?.canPurge, pOk?.blockers, line(pOk, vOk)?.blockedReason ?? null], [true, [], null])
eq('فیلدهای قبلی پیش‌نمایش حفظ شد', [pOk?.lines?.length, pOk?.historyRows, pOk?.movements], [1, 0, 0])
const rOk = await safe(() => variantPurgeService.purge({ variantIds: [vOk], managerPassword: PW }))
eq('purge همان کالا انجام می‌شود', rOk?.deleted, 1)
const pEmpty = await safe(() => variantPurgeService.preview({ variantIds: [] }))
eq('انتخاب خالی: canPurge = false با پیام انتخاب', [pEmpty?.canPurge, (pEmpty?.blockers ?? []).some((b) => /حداقل یک کالا/.test(b))], [false, true])
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
