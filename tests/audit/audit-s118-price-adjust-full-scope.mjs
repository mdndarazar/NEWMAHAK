/**
 * ممیزی نشست ۱۱۸ — S118-2 (تأیید رفتاری): تست fix-s118-price-adjust-full-scope فقط regex بود.
 * این تست رفتار واقعی PriceAdjustService را روی هارنس می‌سنجد:
 *   ۵٬۰۰۳ واریانت فعال (+۱ غیرفعال) ⇒ preview با scope ALL باید ۵٬۰۰۳ خط بدهد و apply با رمز مدیر قیمت همه‌ی ۵٬۰۰۳،
 *   از جمله idهای بالای ۵٬۰۰۰ (مرز PRICE_ADJUST_READ_BATCH)، را عوض کند و ۵٬۰۰۳ PriceChangeItem بسازد.
 *   activeDiscounts با ۵٬۰۰۳ PriceChangeItem باید برای هر ۵٬۰۰۳ کالا تخفیف فعال برگرداند (نه ۵٬۰۰۰).
 *   بدون رمز (قفل روشن) ⇒ رد فارسی و هیچ قیمتی عوض نشود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s118pa-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const db = harnessClient(); const seed = makeSeeder(db)
const p = seed.product('شلوار جین تست')
const raw = db.$harness.db
const cols = raw.prepare('PRAGMA table_info(ProductVariant)').all()
const now = Date.now()
const base = { productId: p, salePrice: 100_000, purchasePrice: 50_000, stock: 1, minStock: 0, isActive: 1, createdAt: now, updatedAt: now }
for (const c of cols) if (c.notnull && !c.pk && !(c.name in base) && c.name !== 'code' && c.name !== 'barcode') base[c.name] = c.type.includes('INT') || c.type.includes('BOOL') ? 0 : ''
const names = [...Object.keys(base), 'code', 'barcode']
const ins = raw.prepare(`INSERT INTO ProductVariant (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
raw.exec('BEGIN')
for (let i = 0; i < 5004; i++) {
  const r = { ...base, isActive: i === 5003 ? 0 : 1, code: `PA${i}`, barcode: `BCPA${i}` }
  ins.run(...names.map((n) => r[n]))
}
raw.exec('COMMIT')
const active = seed.count('ProductVariant', 'isActive = 1')
const maxId = Number(seed.one('SELECT MAX(id) AS m FROM "ProductVariant" WHERE isActive = 1').m)
eq('fixture: ۵٬۰۰۳ واریانت فعال', active >= 5003, true)

const rule = { kind: 'DISCOUNT', mode: 'PERCENT', value: 10, scope: 'ALL' }
const pv = await priceAdjustService.preview(rule)
eq('preview ALL همه‌ی واریانت‌های فعال را می‌آورد (نه ۵٬۰۰۰)', [pv.count, pv.lines.length, pv.changedCount], [active, active, active])
eq('preview شامل بالاترین id فعال و بدون غیرفعال', [pv.lines.some((l) => l.variantId === maxId), pv.lines.some((l) => l.variantId === maxId + 1)], [true, false])
eq('preview چیزی ننوشت', seed.count('ProductVariant', 'salePrice = 90000'), 0)

// قفل روشن ⇒ بدون رمز رد
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.priceAdjust]: true })
let msg = null
try { await priceAdjustService.apply({ ...rule, password: '' }) } catch (e) { msg = String(e?.message ?? e) }
eq('apply بدون رمز با قفل روشن رد فارسی می‌خورد و قیمتی عوض نمی‌شود', [!!msg && /[\u0600-\u06FF]/.test(msg) && !msg.startsWith('HARNESS'), seed.count('ProductVariant', 'salePrice = 90000')], [true, 0])

const res = await priceAdjustService.apply({ ...rule, password: PW })
eq('apply با رمز: changedCount = همه', res.changedCount, active)
eq('قیمت همه‌ی واریانت‌های فعال ۹۰٬۰۰۰ شد', seed.count('ProductVariant', 'isActive = 1 AND salePrice = 90000'), active)
eq('idهای بالای ۵٬۰۰۰ هم عوض شدند', seed.count('ProductVariant', 'isActive = 1 AND id > 5000 AND salePrice = 90000'), seed.count('ProductVariant', 'isActive = 1 AND id > 5000'))
eq('واریانت غیرفعال دست نخورد', Number(seed.one('SELECT salePrice FROM "ProductVariant" WHERE isActive = 0').salePrice), 100_000)
eq('PriceChangeItem برای همه ساخته شد', seed.count('PriceChangeItem', 'batchId = ?', res.batchId), active)
eq('deltaTotal = −۱۰٬۰۰۰ × تعداد', res.deltaTotal, -10_000 * active)

// activeDiscounts با بیش از ۵٬۰۰۰ PriceChangeItem
const ad = await priceAdjustService.activeDiscounts({})
eq('activeDiscounts همه‌ی کالاهای تخفیف‌خورده را برمی‌گرداند', ad.length, active)
const top = ad.find((a) => a.variantId === maxId)
eq('activeDiscounts برای بالاترین id: پایه ۱۰۰٬۰۰۰، فروش ۹۰٬۰۰۰، ۱۰٪', top ? [top.basePrice, top.salePrice, top.discountPercent] : null, [100_000, 90_000, 10])
const one = await priceAdjustService.activeDiscounts({ variantIds: [maxId] })
eq('activeDiscounts با variantIds فقط همان کالا', one.map((a) => a.variantId), [maxId])
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
