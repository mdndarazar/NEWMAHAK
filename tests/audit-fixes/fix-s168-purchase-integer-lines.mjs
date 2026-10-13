/**
 * ===========================================================================
 * نشست ۱۶۸ · S168-D3 — تعداد و قیمت واحد اعشاری در فاکتور خرید (مشاهده‌ی باز AUDIT-PROGRESS ۱۴۵، P2، خوشه E/K؛
 * بند ۳ «کمیت فقط عدد صحیح» و «مبالغ به ریال»، بند ۴-۴۲، بند ۵ «هر گیت در main»).
 *
 * باگ: PurchaseService.update تعداد و قیمت اعشاری را بی‌صدا Math.round می‌کرد (۲٫۵ ⇒ ۳ عدد به موجودی، بی‌هیچ
 * پیام) و create هیچ سنجش عدد صحیحی نداشت (قیمت ۱۰۰۰٫۵ عیناً در سند و قیمت خرید کالا می‌نشست؛ Prisma واقعی
 * روی ستون Int خطای انگلیسی می‌داد). رفع: cleanLines (مشترک ثبت و ویرایش) هر ردیف با تعداد غیرصحیح/غیرمثبت یا
 * قیمت واحد غیرصحیح را پیش از رمز و تراکنش با پیام فارسی (شماره‌ی ردیف + مقدار + علت) رد می‌کند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s168-purchase-integer-lines.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s168-purchase-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// فقط درخواستِ وابسته به پنجرهٔ معتبر باید به سنجش یکپارچگی ردیف‌های خرید برسد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15105, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)

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
const ipcRejects = async (label, ch, payload, needles) => {
  const r = await ipc(ch, payload)
  const msg = String(r?.error)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(msg) && needles.every((n) => msg.includes(n))) { ok++; console.log(`  ✓ ${label} (رد شد: ${msg.slice(0, 140)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'پذیرفته شد' : 'پیام نامنتظره: ' + msg.slice(0, 180)}`) }
}
const stock = (id) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id)?.stock)
const pprice = (id) => Number(seed.one('SELECT purchasePrice FROM "ProductVariant" WHERE id = ?', id)?.purchasePrice)
const itemsOf = (inv) => seed.rows('SELECT qty, unitPrice, lineTotal FROM "PurchaseInvoiceItem" WHERE invoiceId = ? ORDER BY id', inv).map((r) => [Number(r.qty), Number(r.unitPrice), Number(r.lineTotal)])

const actor = seed.user('انباردار نشست ۱۶۸')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
seed.setting(SETTING_KEYS.panelLocks, {})
const pid = seed.product('شلوار جین خرید ۱۶۸', seed.category('پوشاک ۱۶۸'))
const v1 = seed.insert('ProductVariant', { productId: pid, code: 'P168-1', barcode: 'B168-1', salePrice: 1_000_000, purchasePrice: 500_000, stock: 0 })
const v2 = seed.insert('ProductVariant', { productId: pid, code: 'P168-2', barcode: 'B168-2', salePrice: 1_000_000, purchasePrice: 500_000, stock: 0 })
const purchase = (lines, o = {}) => ({ settlementType: 'CASH', paidTotal: 0, panelPassword: PW, lines, ...o })

console.log('\n۱) ثبت فاکتور خرید: تعداد اعشاری ⇒ رد فارسی، بدون هیچ نوشتن')
let pn = seed.count('PurchaseInvoice')
await ipcRejects('تعداد ۲٫۵ در ردیف ۲', IPC.purchaseCreate, purchase([{ variantId: v1, qty: 1, unitPrice: 600_000 }, { variantId: v2, qty: 2.5, unitPrice: 600_000 }]), ['ردیف ۲', 'عدد صحیح'])
eq('فاکتوری ثبت نشد', seed.count('PurchaseInvoice'), pn)
eq('موجودی v1 دست‌نخورده', stock(v1), 0)
eq('موجودی v2 دست‌نخورده', stock(v2), 0)

console.log('\n۲) ثبت فاکتور خرید: قیمت واحد اعشاری (ریال) ⇒ رد فارسی')
await ipcRejects('قیمت ۶۰۰۰۰۰٫۵', IPC.purchaseCreate, purchase([{ variantId: v1, qty: 1, unitPrice: 600_000.5 }]), ['ردیف ۱', 'ریال'])
eq('فاکتوری ثبت نشد', seed.count('PurchaseInvoice'), pn)
eq('قیمت خرید کالا دست‌نخورده', pprice(v1), 500_000)
await ipcRejects('تعداد متنی/نامعتبر', IPC.purchaseCreate, purchase([{ variantId: v1, qty: 'abc', unitPrice: 600_000 }]), ['ردیف ۱'])
eq('فاکتوری ثبت نشد', seed.count('PurchaseInvoice'), pn)

console.log('\n۳) ثبت عادی با عدد صحیح ⇒ پذیرفته')
const inv = await ipcOk('ثبت ۲ عدد × ۶۰۰٬۰۰۰', IPC.purchaseCreate, purchase([{ variantId: v1, qty: 2, unitPrice: 600_000 }]))
const invId = Number(inv?.id)
eq('موجودی v1 = ۲', stock(v1), 2)
eq('اقلام', itemsOf(invId), [[2, 600_000, 1_200_000]])

console.log('\n۴) ویرایش: تعداد ۲٫۵ دیگر بی‌صدا ۳ نمی‌شود ⇒ رد فارسی، سند و موجودی دست‌نخورده')
await ipcRejects('ویرایش با تعداد ۲٫۵', IPC.purchaseUpdate, { ...purchase([{ variantId: v1, qty: 2.5, unitPrice: 600_000 }]), id: invId }, ['ردیف ۱', 'عدد صحیح'])
eq('موجودی v1 هنوز ۲', stock(v1), 2)
eq('اقلام دست‌نخورده', itemsOf(invId), [[2, 600_000, 1_200_000]])
await ipcRejects('ویرایش با قیمت ۶۰۰۰۰۰٫۴', IPC.purchaseUpdate, { ...purchase([{ variantId: v1, qty: 2, unitPrice: 600_000.4 }]), id: invId }, ['ردیف ۱', 'ریال'])
eq('اقلام دست‌نخورده', itemsOf(invId), [[2, 600_000, 1_200_000]])

console.log('\n۵) ویرایش عادی با عدد صحیح ⇒ پذیرفته')
await ipcOk('ویرایش به ۳ عدد × ۶۱۰٬۰۰۰', IPC.purchaseUpdate, { ...purchase([{ variantId: v1, qty: 3, unitPrice: 610_000 }]), id: invId })
eq('موجودی v1 = ۳', stock(v1), 3)
eq('اقلام', itemsOf(invId), [[3, 610_000, 1_830_000]])

console.log('\n۶) رفتار قبلی حفظ: ردیف تعداد صفر نادیده، قیمت منفی فقط با force')
await ipcRejects('قیمت منفی بی‌force', IPC.purchaseCreate, purchase([{ variantId: v2, qty: 1, unitPrice: -10 }]), ['منفی'])
await ipcOk('ردیف صفر کنار ردیف معتبر ⇒ پذیرفته', IPC.purchaseCreate, purchase([{ variantId: v2, qty: 0, unitPrice: 1 }, { variantId: v2, qty: 1, unitPrice: 700_000 }]))
eq('موجودی v2 = ۱', stock(v2), 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
