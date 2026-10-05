/**
 * امنیت گزارش مدیریت — قیمت خرید کالا و خودِ فاکتور خرید فقط در مسیرهای مجاز.
 * قفل خاموش طبق سیاست برنامه آزاد است؛ درخواستِ renderer برای includePurchasePrice نادیده گرفته می‌شود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-sensitive-cost-read-gates.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-cost-read-gate-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { IPC } = await import('../../src/shared/ipc.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { clearPanelSessions, notePanelUnlocked } = await import('../../src/main/services/panelSession.ts')
const electron = await import('../../test/harness/stubs/electron.mjs')

const handlers = new Map()
electron.ipcMain.handle = (channel, fn) => handlers.set(channel, fn)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 360))
  }
}
const invoke = async (channel, payload = {}) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`IPC handler ثبت نشده: ${channel}`)
  return handler(undefined, payload)
}
const readData = (reply) => (reply?.ok ? reply.data : undefined)

const categoryId = seed.category('کیف')
const productId = seed.product('کیف دستی', categoryId)
const variantId = seed.variant(productId, 'قهوه‌ای')
const trashedVariantId = seed.variant(productId, 'آبی')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 500000, purchasePrice = 123456 WHERE id = ?').run(variantId)
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 450000, purchasePrice = 654321, isActive = 0, deletedAt = ? WHERE id = ?').run(Date.now(), trashedVariantId)
const barcode = sql.prepare('SELECT barcode FROM "ProductVariant" WHERE id = ?').get(variantId).barcode
const purchaseId = seed.insert('PurchaseInvoice', {
  invoiceNo: 881,
  issuedAtJalali: '1405/01/01',
  goodsTotal: 123456,
  discountTotal: 0,
  grandTotal: 123456,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: purchaseId, variantId, qty: 1, unitPrice: 123456, lineTotal: 123456 })

registerIpcHandlers()
clearPanelSessions()

const lockedProductList = await invoke(IPC.productList, { take: 10, includePurchasePrice: true })
const lockedRow = readData(lockedProductList)?.[0]
eq('فهرست عمومی کالا با قفل روشن همچنان قابل خواندن است', lockedProductList?.ok, true)
eq('payload دلخواه نمی‌تواند فی خرید را از productList بیرون بکشد', Object.hasOwn(lockedRow ?? {}, 'purchasePrice'), false)

const trashReply = await invoke(IPC.productTrash, { includePurchasePrice: true })
eq('سطل آشغال هم در حالت قفل، قیمت خرید را افشا نمی‌کند', Object.hasOwn(readData(trashReply)?.[0] ?? {}, 'purchasePrice'), false)
const searchReply = await invoke(IPC.variantSearch, { search: 'کیف', includePurchasePrice: true })
eq('جست‌وجوی انتخابگر/POS قیمت خرید را برنمی‌گرداند', Object.hasOwn(readData(searchReply)?.[0] ?? {}, 'purchasePrice'), false)
const barcodeReply = await invoke(IPC.variantByBarcode, { barcode })
eq('خواندن با بارکد قیمت خرید را برنمی‌گرداند', Object.hasOwn(readData(barcodeReply) ?? {}, 'purchasePrice'), false)

const lockedPurchases = await invoke(IPC.purchaseList, {})
eq('خواندن فهرست فاکتور خرید بدون نشست سروری رد می‌شود', lockedPurchases?.ok, false)
const lockedPurchase = await invoke(IPC.purchaseGet, { id: purchaseId })
eq('خواندن جزئیات فاکتور خرید بدون نشست سروری رد می‌شود', lockedPurchase?.ok, false)

const purchasePreviewInput = { scope: 'ALL', target: 'PURCHASE', kind: 'INCREASE', mode: 'AMOUNT', value: 1 }
eq('پیش‌نمایشِ قیمت خریدِ گروهی بدون نشست ماژولش رد می‌شود', (await invoke(IPC.priceAdjustPreview, purchasePreviewInput))?.ok, false)
eq('فهرست تاریخچهٔ تغییر قیمت بدون نشست ماژولش رد می‌شود', (await invoke(IPC.priceAdjustBatches, {}))?.ok, false)
eq('ردیف‌های تاریخچهٔ قیمت بدون نشست ماژولش رد می‌شود', (await invoke(IPC.priceAdjustBatchLines, { batchId: 1 }))?.ok, false)

notePanelUnlocked(PANEL_KEYS.products, 'PANEL')
const unlockedProductList = await invoke(IPC.productList, { take: 10 })
eq('پس از بازشدن سروریِ پنل کالا، فرم کالا فی خرید را می‌گیرد', Number(readData(unlockedProductList)?.[0]?.purchasePrice), 123456)
eq('بازبودن پنل کالا، قفل مستقل فاکتور خرید را دور نمی‌زند', (await invoke(IPC.purchaseGet, { id: purchaseId }))?.ok, false)

notePanelUnlocked(PANEL_KEYS.purchase, 'PANEL')
eq('پس از بازشدن سروریِ پنل خرید، جزئیات فاکتور خوانده می‌شود', (await invoke(IPC.purchaseGet, { id: purchaseId }))?.ok, true)
eq('پس از بازشدن سروریِ پنل خرید، فهرست فاکتور خوانده می‌شود', (await invoke(IPC.purchaseList, {}))?.ok, true)

notePanelUnlocked(PANEL_KEYS.priceAdjust, 'PANEL')
const pricePreview = await invoke(IPC.priceAdjustPreview, purchasePreviewInput)
eq('پس از بازشدن سروریِ ماژول تغییر قیمت، پیش‌نمایش قیمت خرید باز می‌شود', pricePreview?.ok, true)
eq('پیش‌نمایش مجاز دقیقاً قیمت خرید کارت را نشان می‌دهد', Number(readData(pricePreview)?.lines?.[0]?.oldPrice), 123456)
eq('پس از بازشدن ماژول، تاریخچهٔ تغییر قیمت خوانده می‌شود', (await invoke(IPC.priceAdjustBatches, {}))?.ok, true)
eq('پس از بازشدن ماژول، ردیف‌های تاریخچه خوانده می‌شوند', (await invoke(IPC.priceAdjustBatchLines, { batchId: 1 }))?.ok, true)

// قفل خاموش باید مثل سیاست موجود، بدون نشست هم آزاد بماند.
sql.prepare('INSERT INTO "Setting" (key, value) VALUES (?, ?)').run(
  'panel.locks',
  JSON.stringify({ products: false, purchase: false })
)
clearPanelSessions()
const openProductList = await invoke(IPC.productList, { take: 10, includePurchasePrice: false })
eq('قفل خاموش پنل کالا، فی خرید را حتی بدون نشست مجاز می‌کند', Number(readData(openProductList)?.[0]?.purchasePrice), 123456)
eq('قفل خاموش پنل خرید، فهرست فاکتورها را بدون رمز/نشست آزاد می‌کند', (await invoke(IPC.purchaseList, {}))?.ok, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
