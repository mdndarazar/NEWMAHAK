/**
 * ===========================================================================
 * نشست ۱۶۹ · S169-D2 — ویرایش واریانت موجود با کادر «کد»/«بارکد» خالی، کد داخلی ثابت را عوض می‌کرد
 * (مشاهده‌ی باز AUDIT-PROGRESS ۱۴۵، P3؛ بند ۴-۳۴ «جستجو/فیلتر کالا در گزارش‌ها همیشه بر اساس کد داخلی ثابت»).
 *
 * باگ: ProductService.upsert برای هر واریانت `code: v.code || nextCode()` و `barcode: v.barcode || nextBarcode()`
 * می‌ساخت، حتی وقتی واریانت از قبل وجود داشت. فرم کالا کادر خالی را undefined می‌فرستد (placeholder «خودکار»)
 * ⇒ پاک کردن کادر در ویرایش = کد/بارکد تازه، بی‌هیچ Audit؛ گزارش‌های فیلترشده با کد قدیم و برچسب‌های چاپ‌شده
 * با بارکد قدیم بی‌صدا از کار می‌افتادند.
 * رفع: برای واریانت موجود، کد/بارکد خالی = «همان قبلی» (در schema هر دو NOT NULL و unique‌اند، پس قبلی همیشه هست؛
 * برای احتیاط اگر قبلی خالی بود خودکار ساخته می‌شود). تغییر صریح کد/بارکد (مقدار غیرخالی) مثل قبل مجاز است. واریانت تازه مثل قبل خودکار می‌گیرد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s169-variant-code-keep.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s169-code-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 200)}`) }
  return r?.data
}
const v = (id) => seed.one('SELECT code, barcode FROM "ProductVariant" WHERE id = ?', id)
const codeOf = (id) => v(id)?.code ?? null
const bcOf = (id) => v(id)?.barcode ?? null

seed.setting('panelLocks', {})
const cat = seed.category('پوشاک ۱۶۹')
const pid = seed.product('شلوار جین ۱۶۹', cat)
const a = seed.insert('ProductVariant', { productId: pid, code: '5001', barcode: 'BC-5001', size: '32', salePrice: 1_000_000, purchasePrice: 500_000, stock: 3 })
const b = seed.insert('ProductVariant', { productId: pid, code: '5002', barcode: 'BC-5002', size: '34', salePrice: 1_000_000, purchasePrice: 500_000, stock: 2 })
const base = (variants, o = {}) => ({ id: pid, name: 'شلوار جین ۱۶۹', categoryId: cat, unit: 'عدد', variants, ...o })
const same = (id, extra = {}) => ({ id, size: id === a ? '32' : '34', color: null, salePrice: 1_000_000, purchasePrice: 500_000, ...extra })

console.log('\n۱) ویرایش بی‌تغییر قیمت با کادر کد/بارکد خالی (undefined، همان چیزی که فرم می‌فرستد) ⇒ کد و بارکد ثابت می‌مانند')
await ipcOk('ذخیره‌ی فرم', IPC.productUpsert, base([same(a), same(b)]))
eq('کد a', codeOf(a), '5001')
eq('بارکد a', bcOf(a), 'BC-5001')
eq('کد b', codeOf(b), '5002')
eq('بارکد b', bcOf(b), 'BC-5002')

console.log('\n۲) رشته‌ی خالی صریح هم «همان قبلی» است')
await ipcOk('ذخیره با code:"" و barcode:""', IPC.productUpsert, base([same(a, { code: '', barcode: '' }), same(b)]))
eq('کد a', codeOf(a), '5001')
eq('بارکد a', bcOf(a), 'BC-5001')

console.log('\n۳) تغییر صریح کد/بارکد (غیرخالی) مثل قبل مجاز است')
await ipcOk('کد صریح 5009', IPC.productUpsert, base([same(a, { code: '5009', barcode: 'BC-5009' }), same(b)]))
eq('کد a', codeOf(a), '5009')
eq('بارکد a', bcOf(a), 'BC-5009')

console.log('\n۴) واریانت تازه بدون کد ⇒ مثل قبل کد/بارکد خودکار یکتا')
await ipcOk('افزودن واریانت ۳۶', IPC.productUpsert, base([same(a), same(b), { size: '36', color: null, salePrice: 1_000_000, purchasePrice: 500_000, stock: 0 }]))
const c = seed.one('SELECT id, code, barcode FROM "ProductVariant" WHERE productId = ? AND size = ?', pid, '36')
eq('کد تازه ساخته شد', Boolean(c?.code) && !['5001', '5002', '5009'].includes(c.code), true)
eq('بارکد تازه ساخته شد', Boolean(c?.barcode), true)
eq('کد a هنوز 5009', codeOf(a), '5009')
eq('کد b هنوز 5002', codeOf(b), '5002')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
