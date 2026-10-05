/**
 * ===========================================================================
 * نشست ۱۶۷ · S153-D5 / هم‌رده‌ی S165-D2 (S167-D3) — کادر رمز مدیر در صفحه‌ی فاکتور عمده وقتی سرور برای
 * «قیمت کمتر از قیمت مرجع» رمز مدیر می‌خواهد.
 *
 * مسئله: سرور (درست) ویرایش/ثبت فاکتور عمده با قیمت کمتر از مرجع را بدون رمز مدیر رد می‌کند (مثلاً قیمت کالا
 * بعد از بارگذاری فاکتور گران شده، یا افزایش تعداد با قیمت قدیم ⇒ S165-D2). ولی SalesInvoice.tsx فقط وقتی کادر
 * رمز نشان می‌داد که عوارض/حق سرویس دستی کمتر از خودکار بود ⇒ فروشنده هیچ راهی برای وارد کردن رمز مدیر
 * (که تلفنی گرفته، بند ۴-۳۰) نداشت و باید اقلام را دوباره می‌ساخت.
 *
 * رفع: خطای needsManagerPassword (غیر از فلو اضافه‌دریافت) ⇒ state priceNeedPw ⇒ همان کادر PasswordField
 * (chargePw ⇒ managerPassword) با برچسب «قیمت کمتر از قیمت مرجع» نمایش داده می‌شود. سرور دست نمی‌خورد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s167-invoice-price-pw-box.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s167c-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')
const { needsManagerPassword, isOverpayWarning } = await import('@shared/overpayFlow')

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const eq = (label, got, want) => truthy(`${label} = ${JSON.stringify(want)}${got === want ? '' : ` (دریافت ${JSON.stringify(got)})`}`, got === want)

console.log('\n۱) قرارداد سرور (بدون تغییر): قیمت کمتر از مرجع بی‌رمز ⇒ پیام «رمز مدیر را وارد کنید»، با رمز ⇒ پذیرفته')
const actor = seed.user('فروشنده ۱۶۷ج')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const pid = seed.product('کت ۱۶۷', seed.category('پوشاک ۱۶۷ج'))
const v = seed.insert('ProductVariant', { productId: pid, code: 'PW-1', barcode: 'BPW-1', salePrice: 1_000_000, stock: 100 })
const sale = (o = {}) => ({ userId: actor, shiftId, deductInventory: false, payments: [], lines: [{ variantId: v, code: 'PW-1', barcode: 'BPW-1', name: 'کت', qty: 1, unitPrice: 800_000, discount: 0, tax: 0 }], ...o })
let msg = ''
try { await salesService.create(sale()); } catch (e) { msg = String(e?.message ?? e) }
truthy(`بی‌رمز رد شد (${msg.slice(0, 90)})`, msg.length > 0)
truthy('پیام با needsManagerPassword شناخته می‌شود', needsManagerPassword(msg))
truthy('پیام هشدار اضافه‌دریافت نیست (پس فلو اضافه‌دریافت آن را نمی‌گیرد)', !isOverpayWarning(msg))
truthy('پیام فارسی، با مبلغ واردشده و مرجع', /800[,٬]?000|۸۰۰٬۰۰۰/.test(msg) && /1[,٬]?000[,٬]?000|۱٬۰۰۰٬۰۰۰/.test(msg))
let inv = null
try { inv = await salesService.create(sale({ managerPassword: PW })) } catch (e) { console.log('   ', String(e?.message ?? e).slice(0, 160)) }
truthy('با رمز مدیر پذیرفته شد', !!inv?.id)

console.log('\n۲) SalesInvoice.tsx: خطای رمز مدیر ⇒ کادر رمز نمایش داده می‌شود')
const src = readFileSync(resolve('src/renderer/src/pages/SalesInvoice.tsx'), 'utf8')
truthy('state priceNeedPw تعریف شده', /const \[priceNeedPw, setPriceNeedPw\] = useState/.test(src))
truthy('در شاخه‌ی خطای عمومی needsManagerPassword ⇒ setPriceNeedPw', /needsManagerPassword\(message\)\)\s*setPriceNeedPw\(/.test(src))
truthy('کادر رمز با priceNeedPw هم نمایش داده می‌شود', /priceNeedPw \|\|\s*\(taxOverride != null/.test(src) || /\(taxOverride[\s\S]{0,200}\|\| priceNeedPw\)/.test(src))
truthy('برچسب «قیمت کمتر از قیمت مرجع» در کادر', src.includes('قیمت کمتر از قیمت مرجع'))
truthy('همان chargePw به managerPassword می‌رود (بدون مسیر تازه‌ی سرور)', /managerPassword: overpayReq\.managerPassword \?\? \(chargePw\.trim\(\) \|\| undefined\)/.test(src))
truthy('پس از ثبت موفق priceNeedPw پاک می‌شود', /setChargePw\(''\)\s*\n\s*setPriceNeedPw\(null\)/.test(src))
truthy('resetForm هم priceNeedPw را پاک می‌کند', /const resetForm = useCallback\([\s\S]{0,600}setPriceNeedPw\(null\)/.test(src))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
