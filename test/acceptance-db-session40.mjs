/**
 * ===========================================================================
 * جلسه ۴۵ — سوییت پذیرش «کار ب: برگشت/تعویض با پرداخت مدیر، کالای در انتظار
 * تأیید، قفل سمت سرور، و انبارگردانی».
 * (فایل با همان نامی ساخته شد که پنج جلسه در HANDOFF وعده داده بود:
 *  `test/acceptance-db-session40.mjs`.)
 * ---------------------------------------------------------------------------
 * روی همان هارنس واقعی جلسه ۳۵ اجرا می‌شود: SQLite داخل خودِ Node، جدول‌ها از
 * **فایل‌های migration واقعی پروژه**، و سرویس‌های واقعی (`SalesService.ts`،
 * `CardTransferService.ts`، `PendingRestockService.ts`، `StockCountService.ts`،
 * `CashboxService.ts`، `AuthService.ts`). هیچ چیزی mock نشده؛ هر عددی که این
 * فایل می‌سنجد، همان عددی است که پنل می‌بیند.
 *
 * چیزی که می‌سنجد (فهرست تست پرامپت کار ب + فهرست `CHANGELOG-جلسه۴۲.md`):
 *   ۰ توابع خالصِ `@shared/pendingRestock` (تعریف رسمی «معلق برگشتی»)
 *   ۱ برگشت کارت‌به‌کارت **بدون** پرداخت ⇒ موجودی قابل‌فروش تغییر نکند، معلق دیده شود
 *   ۲ `pay` با تأیید مدیر ⇒ آزادسازی در همان تراکنش + AuditLog + stockNote
 *   ۳ `pay` **بدون** تأیید مدیر و با رمز غلط ⇒ رد شود و هیچ چیزی عوض نشود
 *   ۴ `pay` دوباره روی درخواست پرداخت‌شده ⇒ رد، و کالا دو بار اضافه نشود
 *   ۵ برگشت نقدی ⇒ مو‌به‌مو مثل قبل، همان لحظه به انبار
 *   ۶ تعویض با مابه‌التفاوت کارت‌به‌کارت ⇒ جایگزین همان لحظه کم، برگشتی بعد از پرداخت
 *   ۷ تعویض با انتخاب کارت‌به‌کارت ولی مابه‌التفاوت به نفع فروشگاه ⇒ آزادسازی آگاهانه
 *   ۸ `cancel` با و بدون `releaseStock`
 *   ۹ حذف برگشتِ معلق ⇒ بی‌حرکت انباری، درخواست لغو می‌شود
 *  ۱۰ ویرایش برگشتِ معلق ⇒ بی‌حرکت انباری، معلق می‌ماند (درِ پشتی بسته)
 *  ۱۱ انبارگردانی: snapshot معلق، «موجودی فیزیکیِ مورد انتظار»، مغایرت کاذب نسازد
 *  ۱۲ بستن صندوق و گزارش‌ها: معلق روی کسری/اضافی اثر نگذارد
 *  ۱۳ داده‌ی قدیمی (`restockedQty = qty`) ⇒ هیچ‌جا معلق شمرده نشود
 *  ۱۴ یادآوری بر اساس سن درخواست
 *
 * هر سناریو **شیفت خودش** و **کالای خودش** را دارد، پس نه عددهای مالی و نه
 * عددهای انباری سناریوها به هم نمی‌ریزند.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-session40-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { salesService } = await import('../src/main/services/SalesService.ts')
const { cardTransferService } = await import('../src/main/services/CardTransferService.ts')
const { pendingRestockService } = await import('../src/main/services/PendingRestockService.ts')
const { stockCountService } = await import('../src/main/services/StockCountService.ts')
const { cashboxService } = await import('../src/main/services/CashboxService.ts')
const {
  AuditAction,
  CardTransferStatus,
  CardTransferKind,
  RefundMethod
} = await import('@shared/enums')
const {
  PENDING_RESTOCK_LABEL,
  PENDING_RESTOCK_COLUMN,
  PENDING_RESTOCK_EXPLAINER,
  PENDING_RESTOCK_STOCKTAKE_NOTE,
  PENDING_RESTOCK_ALERT_DAYS,
  ageInDays,
  expectedPhysicalQty,
  itemNeedsRestock,
  pendingQtyOfItems,
  pendingRestockHeadline,
  pendingRestockLine,
  pendingRestockShiftWarning,
  pendingRestockTone,
  pendingStockNote,
  releasedStockNote
} = await import('@shared/pendingRestock')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, faDigits } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

// ------------------------------------------------------------------ گزارش‌گر
let pass = 0
const failures = []
const section = (title) => console.log(`\n— ${title}`)
const ok = (name, cond, detail) => {
  if (cond) {
    pass++
    return true
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  return false
}
const eq = (name, got, want) =>
  ok(name, got === want, `دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
const throwsWith = async (name, fn, needle) => {
  try {
    await fn()
    return ok(name, false, 'هیچ خطایی پرتاب نشد')
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (msg.startsWith('HARNESS:')) return ok(name, false, msg)
    return ok(name, needle ? msg.includes(needle) : true, `پیام: ${msg.split('\n')[0]}`)
  }
}

// ------------------------------------------------------------- داده‌ی پایه
const PW = DEFAULT_MANAGER_PASSWORD
const userId = seed.user('مدیر تست کار ب')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار مردانه', cat)

const METHOD = {
  cash: seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 }),
  card: seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
}

const UNIT = 5_000_000
const HOUR = 3_600_000
let shiftSeq = 0
let variantSeq = 0

/** یک شیفتِ بازِ مستقل برای هر سناریو (مرز عددهای مالی) */
const makeShift = (name) =>
  seed.insert('Shift', {
    name,
    number: ++shiftSeq,
    dayJalali: toJalaliDate(new Date()),
    openedAt: Date.now() - HOUR,
    userId
  })

/** یک کالای مستقل با موجودی معلوم برای هر سناریو (مرز عددهای انباری) */
const makeVariant = (stock = 100, label) => {
  const id = seed.variant(product, label ?? `سایز ${++variantSeq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(stock, UNIT, id)
  return id
}

const stockOf = (variantId) =>
  Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(variantId).stock)
const itemsOf = (invoiceId) =>
  seed.rows('SELECT id, variantId, qty FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const returnRow = (id) => seed.one('SELECT * FROM "SaleReturn" WHERE id = ?', id)
const returnItems = (id) => seed.rows('SELECT * FROM "SaleReturnItem" WHERE returnId = ? ORDER BY id', id)
const requestRow = (id) => seed.one('SELECT * FROM "CardTransferRequest" WHERE id = ?', id)
const auditRows = (action, entityId) =>
  seed.rows('SELECT * FROM "AuditLog" WHERE action = ? AND entityId = ? ORDER BY id', action, entityId)
const movementsOf = (returnId) =>
  seed.rows(
    'SELECT * FROM "StockMovement" WHERE refType = ? AND refId = ? ORDER BY id',
    'SaleReturn',
    returnId
  )

/** فاکتورِ نقدیِ کاملاً تسویه‌شده (سقف بازپرداخت = همان مبلغ) */
const paidSale = async (shiftId, variantId, qty = 2) => {
  const inv = await salesService.create({
    userId,
    shiftId,
    lines: [{ variantId, qty, unitPrice: UNIT, discount: 0, tax: 0 }],
    payments: [{ methodId: METHOD.cash, amount: UNIT * qty }]
  })
  return { id: inv.id, receiptNo: inv.receiptNo, items: itemsOf(inv.id), total: UNIT * qty }
}

/** برگشتِ کارت‌به‌کارتِ مدیر (کالا باید معلق بماند) */
const cardToCardReturn = (invoiceId, lines, amount) =>
  salesService.createReturn({
    invoiceId,
    full: false,
    lines,
    refundMethod: RefundMethod.CARD_TO_CARD,
    refundAmount: amount,
    userId
  })

const summary = () => pendingRestockService.summary()
const pendingQtyOf = (s, returnId) =>
  s.items.filter((i) => i.returnId === returnId).reduce((t, i) => t + i.qty, 0)

// ===========================================================================
section('بند ۰ · تعریف رسمی «معلق برگشتی» — توابع خالص @shared/pendingRestock')
// ===========================================================================
{
  eq('معلق یک سند = Σ(qty − restockedQty)', pendingQtyOfItems([{ qty: 3, restockedQty: 0 }, { qty: 2, restockedQty: 1 }]), 4)
  eq('قلمِ آزادشده سهمی در معلق ندارد', pendingQtyOfItems([{ qty: 2, restockedQty: 2 }]), 0)
  eq('restockedQty بیشتر از qty معلقِ منفی نمی‌سازد', pendingQtyOfItems([{ qty: 1, restockedQty: 5 }, { qty: 3, restockedQty: 0 }]), 3)
  eq('itemNeedsRestock فقط قلمِ ناتمام را true می‌کند', itemNeedsRestock({ qty: 2, restockedQty: 1 }), true)
  eq('و قلمِ تمام‌شده را false', itemNeedsRestock({ qty: 2, restockedQty: 2 }), false)
  eq('موجودی فیزیکیِ مورد انتظار = قابل‌فروش + معلق', expectedPhysicalQty(7, 2), 9)
  eq('بی‌معلق، موجودی فیزیکی همان قابل‌فروش است', expectedPhysicalQty(7, 0), 7)
  eq('سن درخواست به روز', ageInDays(Date.now() - 3 * 86_400_000 - 1000), 3)
  eq('سن نامعلوم ⇒ صفر (بدون حدس)', ageInDays(null), 0)
  eq('تُنِ بی‌معلق: none', pendingRestockTone(10, 0), 'none')
  eq('تُنِ تازه: info', pendingRestockTone(0, 1), 'info')
  eq('تُنِ سه‌روزه: warn', pendingRestockTone(3, 1), 'warn')
  eq('تُنِ هفت‌روزه: alert', pendingRestockTone(PENDING_RESTOCK_ALERT_DAYS, 1), 'alert')
  eq('خلاصه‌ی خالی هیچ کادری نمی‌سازد', pendingRestockHeadline({ totalQty: 0, returnCount: 0, pendingAmount: 0, oldestAgeDays: 0 }), null)
  ok('هشدار شیفتِ خالی هم null است', pendingRestockShiftWarning(null) === null)
  ok(
    'جمله‌ی نمونه‌ی خواسته‌ی مالک ساخته می‌شود',
    pendingRestockLine({ name: 'شلوار', qty: 2 }, faDigits).includes('در موجودی قابل‌فروش نیست'),
    pendingRestockLine({ name: 'شلوار', qty: 2 }, faDigits)
  )
  ok('برچسب ستون و متن انبارگردانی ثابت‌اند', PENDING_RESTOCK_COLUMN.includes(PENDING_RESTOCK_LABEL) && PENDING_RESTOCK_STOCKTAKE_NOTE.includes('قابل‌فروش + معلق'))
  ok('متن توضیحی مشترک به پنل قفل‌دار ارجاع می‌دهد', PENDING_RESTOCK_EXPLAINER.includes('پرداخت شد'))
}

// ===========================================================================
section('بند ۱ · برگشت کارت‌به‌کارت بدون پرداخت ⇒ موجودی قابل‌فروش تغییر نمی‌کند')
// ===========================================================================
let scenario1 = null
{
  const shiftId = makeShift('نشست برگشت معلق')
  const variantId = makeVariant(100, 'سایز ۳۸')
  const inv = await paidSale(shiftId, variantId, 2)
  const afterSale = stockOf(variantId)
  eq('فروش، موجودی را کم کرد (پایه‌ی مقایسه)', afterSale, 98)

  const before = await summary()
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 2 }], UNIT * 2)

  eq('سند برگشت پرچم معلق گرفت', ret.restockPending, true)
  eq('تعداد معلقِ همین سند', ret.pendingRestockQty, 2)
  eq('موجودی قابل‌فروش یک عدد هم عوض نشد', stockOf(variantId), afterSale)
  eq('هیچ حرکت انباری برای این برگشت ثبت نشد', movementsOf(ret.id).length, 0)
  eq('restockedQty اقلام صفر ثبت شد (منبع حقیقتِ تعداد)', returnItems(ret.id).every((i) => i.restockedQty === 0), true)
  eq('درخواست کارت‌به‌کارت با وضعیت «در انتظار پرداخت» ساخته شد', ret.cardTransfer.status, CardTransferStatus.PENDING)
  eq('مبلغ درخواست = مبلغ بازپرداخت', ret.cardTransfer.amount, UNIT * 2)
  ok(
    'stockNote همان لحظه راست می‌گوید (کالا به انبار نرفت)',
    requestRow(ret.cardTransfer.id).stockNote === pendingStockNote(2, faDigits),
    requestRow(ret.cardTransfer.id).stockNote
  )

  const s = await summary()
  eq('تابع مشترک، معلق را دید', pendingQtyOf(s, ret.id), 2)
  eq('معلق به تفکیک کالا (صفحه‌ی انبار/انبارگردانی)', s.byVariant[variantId], 2)
  eq('جمع کل معلق دو عدد بالا رفت', s.totalQty - before.totalQty, 2)
  eq('تعداد اسناد معلق یکی بالا رفت', s.returnCount - before.returnCount, 1)
  eq('مبلغ در انتظار پرداخت مدیر شمرده شد', s.pendingAmount - before.pendingAmount, UNIT * 2)
  eq('ردیف «نیازمند رسیدگی» ساخته نشد (درخواست باز است)', s.needsAttentionQty, before.needsAttentionQty)
  const row = s.items.find((i) => i.returnId === ret.id)
  eq('ردیف معلق به درخواست گره خورده است', row.requestId, ret.cardTransfer.id)
  eq('ردیف معلق شماره فیش فاکتور اصلی را دارد', row.receiptNo, inv.receiptNo)
  eq('ردیف معلق نوع عملیات را می‌گوید', row.operationKind, 'RETURN')
  eq('ردیف معلق «رد‌شده» علامت نخورده', row.canceled, false)
  ok('جمله‌ی خلاصه برای صفحه‌ها ساخته شد', (pendingRestockHeadline(s, faDigits, faDigits) ?? '').includes('در انتظار پرداخت مدیر'))

  // گزارش برگشت/تعویض (تب گزارشات فروش) همان عدد را می‌بیند
  const list = await salesService.returnList({ shiftId })
  const lrow = list.find((r) => r.id === ret.id)
  eq('گزارش برگشت: پرچم معلق', lrow.restockPending, true)
  eq('گزارش برگشت: تعداد معلق', lrow.pendingRestockQty, 2)
  eq('گزارش برگشت: هیچ عددی به انبار برنگشت', lrow.restockedQty, 0)
  eq('گزارش برگشت: روش بازپرداخت کارت‌به‌کارت', lrow.refundMethod, RefundMethod.CARD_TO_CARD)

  // بستن صندوق: کارت‌به‌کارت نه از کشو پول می‌برد و نه در کارتخوان می‌نشیند
  const exp = await cashboxService.expected({ shiftId, countedCash: UNIT * 2 })
  eq('نقد مورد انتظار = فقط پولِ همان فروش', exp.expectedCash, UNIT * 2)
  eq('کسری/اضافی صفر ماند (معلق اثری ندارد)', exp.cashDifference, 0)
  ok('هشدار شیفت برای معلق‌ها ساخته می‌شود', (pendingRestockShiftWarning(s, faDigits) ?? '').includes('کسری/اضافی'))

  scenario1 = { shiftId, variantId, inv, ret, requestId: ret.cardTransfer.id, stockAfterSale: afterSale }
}

// ===========================================================================
section('بند ۲ · `pay` بدون تأیید مدیر و با رمز غلط ⇒ رد، و هیچ چیزی عوض نمی‌شود')
// ===========================================================================
{
  const { variantId, ret, requestId, stockAfterSale } = scenario1
  await throwsWith(
    'فراخوانی `pay` بدون رمز مدیر رد می‌شود (قفل سمت سرور)',
    () => cardTransferService.pay({ id: requestId, userId }),
    'تأیید مدیر'
  )
  eq('بعد از رد شدن، موجودی قابل‌فروش دست‌نخورده است', stockOf(variantId), stockAfterSale)
  eq('و وضعیت درخواست همان «در انتظار پرداخت» است', requestRow(requestId).status, CardTransferStatus.PENDING)
  eq('و سند برگشت همچنان معلق است', returnRow(ret.id).restockPending, 1)

  await throwsWith(
    'رمز غلط هم رد می‌شود',
    () => cardTransferService.pay({ id: requestId, managerPassword: 'غلط-غلط', userId }),
    ''
  )
  eq('رمز غلط هیچ کالایی آزاد نکرد', stockOf(variantId), stockAfterSale)
  eq('رمز غلط هیچ حرکت انباری نساخت', movementsOf(ret.id).length, 0)
  await throwsWith(
    'لغو بدون رمز مدیر هم رد می‌شود (همان گیت)',
    () => cardTransferService.cancel({ id: requestId, reason: 'تست', userId }),
    'تأیید مدیر'
  )
}

// ===========================================================================
section('بند ۳ · `pay` با تأیید مدیر ⇒ آزادسازی در همان تراکنش')
// ===========================================================================
{
  const { variantId, ret, requestId, stockAfterSale } = scenario1
  const beforeSum = await summary()
  const paid = await cardTransferService.pay({ id: requestId, managerPassword: PW, userId })

  eq('وضعیت درخواست پرداخت‌شده شد', paid.status, CardTransferStatus.PAID)
  eq('تعداد آزادشده در پاسخ برگشت داده شد', paid.releasedQty, 2)
  eq('کالای برگشتی به موجودی قابل‌فروش برگشت', stockOf(variantId), stockAfterSale + 2)
  eq('یک حرکت انباری مثبت ثبت شد', movementsOf(ret.id).length, 1)
  eq('جهت حرکت انباری مثبت است', movementsOf(ret.id)[0].delta, 2)
  eq('restockedQty برابر qty شد (منبع حقیقت)', returnItems(ret.id).every((i) => i.restockedQty === i.qty), true)
  eq('پرچم معلق برداشته شد', returnRow(ret.id).restockPending, 0)
  ok('تاریخ آزادسازی روی سند ثبت شد', !!returnRow(ret.id).restockReleasedAt)
  eq('ستون تعداد آزادشده روی درخواست', requestRow(requestId).stockReleasedQty, 2)
  ok(
    'stockNote بعد از پرداخت به‌روز شد',
    requestRow(requestId).stockNote === releasedStockNote(2, faDigits),
    requestRow(requestId).stockNote
  )

  const s = await summary()
  eq('معلق این سند صفر شد', pendingQtyOf(s, ret.id), 0)
  eq('جمع کل معلق دو عدد پایین آمد', beforeSum.totalQty - s.totalQty, 2)
  eq('کالا از نقشه‌ی معلق‌ها بیرون رفت', s.byVariant[variantId] ?? 0, 0)

  const restockLog = auditRows(AuditAction.CARD_TRANSFER_RESTOCK, ret.id)
  eq('ورود کالا به انبار در AuditLog ثبت شد', restockLog.length, 1)
  ok('سند حسابرسی تعداد آزادشده را دارد', JSON.parse(restockLog[0].after ?? '{}').releasedQty === 2, restockLog[0].after)
  ok('سند حسابرسی می‌گوید با پرداخت مدیر آزاد شد', (restockLog[0].note ?? '').includes('پرداخت کارت‌به‌کارت'), restockLog[0].note)
  const payLog = auditRows(AuditAction.CARD_TRANSFER_PAID, requestId)
  ok('AuditLog پرداخت، تعداد آزادشده را هم نوشت', JSON.parse(payLog.at(-1)?.after ?? '{}').releasedQty === 2, payLog.at(-1)?.after)
  ok('AuditLog پرداخت، رمزِ تأییدکننده را نوشت', JSON.parse(payLog.at(-1)?.after ?? '{}').approvedWith === 'MANAGER', payLog.at(-1)?.after)

  // ---- پرداخت دوباره: نه رکورد، نه انبار ----
  await throwsWith(
    'پرداخت دوباره‌ی همان درخواست رد می‌شود',
    () => cardTransferService.pay({ id: requestId, managerPassword: PW, userId }),
    'قبلاً پرداخت شده'
  )
  eq('و کالا دو بار اضافه نشد', stockOf(variantId), stockAfterSale + 2)
  eq('و حرکت انباری دوم ساخته نشد', movementsOf(ret.id).length, 1)
}

// ===========================================================================
section('بند ۴ · idempotent بودن خودِ آزادسازی (مسیر مستقیم سرویس)')
// ===========================================================================
{
  const shiftId = makeShift('نشست idempotent')
  const variantId = makeVariant(50, 'سایز ۴۰')
  const inv = await paidSale(shiftId, variantId, 1)
  const base = stockOf(variantId)
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 1 }], UNIT)

  const first = await pendingRestockService.releaseReturnStock(db, {
    returnId: ret.id,
    userId,
    reason: 'تست مستقیم آزادسازی'
  })
  eq('بار اول یک عدد آزاد شد', first.releasedQty, 1)
  eq('موجودی یک عدد بالا رفت', stockOf(variantId), base + 1)

  const second = await pendingRestockService.releaseReturnStock(db, {
    returnId: ret.id,
    userId,
    reason: 'تست مستقیم آزادسازی (بار دوم)'
  })
  eq('بار دوم بی‌صدا رد شد', second.releasedQty, 0)
  eq('و alreadyDone را گفت', second.alreadyDone, true)
  eq('موجودی دوباره بالا نرفت', stockOf(variantId), base + 1)

  await throwsWith(
    'سند برگشتِ ناموجود، بی‌صدا رد نمی‌شود',
    () => pendingRestockService.releaseReturnStock(db, { returnId: 999_999, userId, reason: 'سند ناموجود' }),
    'پیدا نشد'
  )
  const zero = await pendingRestockService.releaseReturnStock(db, { returnId: 0, userId, reason: 'شناسه‌ی خالی' })
  eq('شناسه‌ی خالی هیچ کاری نمی‌کند', zero.releasedQty, 0)
  eq('و alreadyDone برمی‌گرداند', zero.alreadyDone, true)
}

// ===========================================================================
section('بند ۵ · برگشت نقدی ⇒ مو‌به‌مو مثل قبل، همان لحظه به انبار')
// ===========================================================================
{
  const shiftId = makeShift('نشست برگشت نقدی')
  const variantId = makeVariant(30, 'سایز ۴۲')
  const inv = await paidSale(shiftId, variantId, 2)
  const base = stockOf(variantId)
  const before = await summary()

  const ret = await salesService.createReturn({
    invoiceId: inv.id,
    full: false,
    lines: [{ saleItemId: inv.items[0].id, qty: 1 }],
    refundMethod: RefundMethod.CASH,
    refundAmount: UNIT,
    userId
  })
  eq('برگشت نقدی معلق نمی‌شود', ret.restockPending, false)
  eq('کالا همان لحظه به انبار برگشت', stockOf(variantId), base + 1)
  eq('restockedQty برابر qty ثبت شد', returnItems(ret.id)[0].restockedQty, 1)
  eq('درخواست کارت‌به‌کارتی ساخته نشد', ret.cardTransfer, null)
  const s = await summary()
  eq('در فهرست معلق‌ها نیامد', pendingQtyOf(s, ret.id), 0)
  eq('جمع معلق‌ها دست‌نخورده ماند', s.totalQty, before.totalQty)

  const exp = await cashboxService.expected({ shiftId })
  eq('بازپرداخت نقدی از نقد مورد انتظار کم شد (رفتار قبلی)', exp.expectedCash, UNIT * 2 - UNIT)
}

// ===========================================================================
section('بند ۶ · تعویض با مابه‌التفاوت کارت‌به‌کارت')
// ===========================================================================
{
  const shiftId = makeShift('نشست تعویض کارت‌به‌کارت')
  const backVariant = makeVariant(20, 'برگشتی ۴۴')
  const repVariant = makeVariant(20, 'جایگزین ارزان')
  sql.prepare('UPDATE "ProductVariant" SET salePrice = ? WHERE id = ?').run(UNIT / 2, repVariant)

  const inv = await paidSale(shiftId, backVariant, 2)
  const backBase = stockOf(backVariant)
  const repBase = stockOf(repVariant)

  const ex = await salesService.createExchange({
    invoiceId: inv.id,
    lines: [{ saleItemId: inv.items[0].id, qty: 2 }],
    replacements: [{ variantId: repVariant, qty: 1 }],
    refundMode: 'CARD_TO_CARD',
    userId
  })

  eq('مابه‌التفاوت به نفع مشتری است', ex.diff, UNIT / 2 - UNIT * 2)
  eq('تعهد کارت‌به‌کارت ساخته شد', ex.cardToCard, UNIT * 2 - UNIT / 2)
  eq('کالای برگشتی معلق ماند', ex.restockPending, true)
  eq('تعداد معلق سند تعویض', ex.pendingRestockQty, 2)
  eq('کالای برگشتی به موجودی قابل‌فروش اضافه نشد', stockOf(backVariant), backBase)
  eq('کالای جایگزین همان لحظه از انبار کم شد (نباید عوض شود)', stockOf(repVariant), repBase - 1)

  const s = await summary()
  eq('معلق تعویض در تابع مشترک دیده شد', pendingQtyOf(s, ex.returnId), 2)
  eq('نوع عملیاتِ ردیف معلق EXCHANGE است', s.items.find((i) => i.returnId === ex.returnId).operationKind, 'EXCHANGE')
  ok(
    'stockNote می‌گوید جایگزین کم شد ولی برگشتی معلق است',
    (requestRow(ex.cardTransfer.id).stockNote ?? '').includes('جایگزین همان لحظه از انبار کم شد'),
    requestRow(ex.cardTransfer.id).stockNote
  )

  const exList = await salesService.exchangeList({ shiftId })
  const exRow = exList.rows.find((r) => r.returnId === ex.returnId)
  ok('تب تعویض این سند را می‌بیند', !!exRow, 'ردیف تعویض پیدا نشد')

  // پرداخت مدیر ⇒ فقط کالای برگشتی آزاد می‌شود، جایگزین دست‌نخورده
  const paid = await cardTransferService.pay({ id: ex.cardTransfer.id, managerPassword: PW, userId })
  eq('پرداخت مدیر دو عدد برگشتی را آزاد کرد', paid.releasedQty, 2)
  eq('برگشتی بعد از پرداخت به انبار آمد', stockOf(backVariant), backBase + 2)
  eq('کالای جایگزین با پرداخت مدیر تغییر نکرد', stockOf(repVariant), repBase - 1)
  const s2 = await summary()
  eq('معلقِ سند تعویض صفر شد', pendingQtyOf(s2, ex.returnId), 0)
}

// ===========================================================================
section('بند ۷ · انتخاب کارت‌به‌کارت ولی مابه‌التفاوت به نفع فروشگاه ⇒ آزادسازی آگاهانه')
// ===========================================================================
{
  const shiftId = makeShift('نشست تعویض بی‌بدهی')
  const backVariant = makeVariant(20, 'برگشتی ارزان')
  const repVariant = makeVariant(20, 'جایگزین گران')
  sql.prepare('UPDATE "ProductVariant" SET salePrice = ? WHERE id = ?').run(UNIT * 2, repVariant)

  const inv = await paidSale(shiftId, backVariant, 1)
  const backBase = stockOf(backVariant)
  const repBase = stockOf(repVariant)
  const before = await summary()

  const ex = await salesService.createExchange({
    invoiceId: inv.id,
    lines: [{ saleItemId: inv.items[0].id, qty: 1 }],
    replacements: [{ variantId: repVariant, qty: 1 }],
    refundMode: 'CARD_TO_CARD',
    methodId: METHOD.cash,
    userId
  })

  ok('مابه‌التفاوت به نفع فروشگاه است', ex.diff > 0, String(ex.diff))
  eq('هیچ تعهد کارت‌به‌کارتی ساخته نشد', ex.cardToCard, 0)
  eq('درخواست پرداخت مدیر ساخته نشد', ex.cardTransfer, null)
  eq('کالای برگشتی همان لحظه آزاد شد (نه معلقِ همیشگی)', stockOf(backVariant), backBase + 1)
  eq('پرچم معلق روی پاسخ برداشته شد', ex.restockPending, false)
  eq('تعداد معلق صفر برگشت', ex.pendingRestockQty, 0)
  eq('پرچم معلق روی رکورد هم برداشته شد', returnRow(ex.returnId).restockPending, 0)
  eq('کالای جایگزین از انبار کم شد', stockOf(repVariant), repBase - 1)
  const s = await summary()
  eq('هیچ معلقی جا نماند', s.totalQty, before.totalQty)
}

// ===========================================================================
section('بند ۸ · رد/لغو درخواست: با و بدون آزادسازی کالا')
// ===========================================================================
{
  // ---- ۸-الف: لغو بدون آزادسازی ⇒ کالا معلق و «نیازمند رسیدگی» ----
  const shiftA = makeShift('نشست لغو بی‌آزادسازی')
  const vA = makeVariant(20, 'سایز ۴۶')
  const invA = await paidSale(shiftA, vA, 1)
  const baseA = stockOf(vA)
  const retA = await cardToCardReturn(invA.id, [{ saleItemId: invA.items[0].id, qty: 1 }], UNIT)

  await throwsWith(
    'لغو بدون دلیل رد می‌شود (سابقه باید خودگویا باشد)',
    () => cardTransferService.cancel({ id: retA.cardTransfer.id, reason: '  ', managerPassword: PW, userId }),
    'دلیل'
  )

  const canceled = await cardTransferService.cancel({
    id: retA.cardTransfer.id,
    reason: 'مدیر پرداخت را نپذیرفت',
    managerPassword: PW,
    userId
  })
  eq('وضعیت لغو شد', canceled.status, CardTransferStatus.CANCELED)
  eq('رکورد حذف/بازنویسی نشد (دلیل ثبت شد)', requestRow(retA.cardTransfer.id).cancelReason, 'مدیر پرداخت را نپذیرفت')
  eq('لغو به‌خودی‌خود کالا را برنگرداند', stockOf(vA), baseA)
  eq('و پاسخ صریح گفت کالا معلق مانده', canceled.stillPending, true)
  const sA = await summary()
  eq('کالا هنوز در فهرست معلق‌هاست', pendingQtyOf(sA, retA.id), 1)
  ok('ردیفِ «نیازمند رسیدگی» ساخته شد', sA.needsAttentionQty >= 1, String(sA.needsAttentionQty))
  eq('ردیف معلق برچسب رد/لغو خورد', sA.items.find((i) => i.returnId === retA.id).canceled, true)
  eq('مبلغِ درخواستِ لغوشده دیگر «در انتظار پرداخت» شمرده نمی‌شود', sA.items.find((i) => i.returnId === retA.id).requestId, retA.cardTransfer.id)
  ok(
    'stockNote تکلیف کالا را توضیح می‌دهد',
    (requestRow(retA.cardTransfer.id).stockNote ?? '').includes('در انتظار تکلیف'),
    requestRow(retA.cardTransfer.id).stockNote
  )

  // ---- ۸-ب: همان درخواستِ لغوشده، این بار با آزادسازی صریح مدیر ----
  const released = await cardTransferService.cancel({
    id: retA.cardTransfer.id,
    reason: 'برگشت اشتباه ثبت شده بود؛ مشتری طلبی ندارد',
    releaseStock: true,
    managerPassword: PW,
    userId
  })
  eq('آزادسازی صریح یک عدد برگرداند', released.releasedQty, 1)
  eq('موجودی قابل‌فروش بالا رفت', stockOf(vA), baseA + 1)
  eq('پرچم معلق برداشته شد', returnRow(retA.id).restockPending, 0)
  const sB = await summary()
  eq('از فهرست معلق‌ها بیرون رفت', pendingQtyOf(sB, retA.id), 0)
  const relLog = auditRows(AuditAction.CARD_TRANSFER_RESTOCK, retA.id)
  ok('آزادسازی بی‌پرداخت هم در AuditLog نشست', (relLog.at(-1)?.note ?? '').includes('آزادسازی صریح مدیر'), relLog.at(-1)?.note)

  await throwsWith(
    'درخواست پرداخت‌شده لغو نمی‌شود',
    async () => {
      const shiftC = makeShift('نشست لغو بعد از پرداخت')
      const vC = makeVariant(10, 'سایز ۴۸')
      const invC = await paidSale(shiftC, vC, 1)
      const retC = await cardToCardReturn(invC.id, [{ saleItemId: invC.items[0].id, qty: 1 }], UNIT)
      await cardTransferService.pay({ id: retC.cardTransfer.id, managerPassword: PW, userId })
      await cardTransferService.cancel({ id: retC.cardTransfer.id, reason: 'تلاش برای لغو', managerPassword: PW, userId })
    },
    'پرداخت شده'
  )
}

// ===========================================================================
section('بند ۹ · حذف برگشتِ معلق ⇒ بی‌حرکت انباری، درخواست لغو می‌شود')
// ===========================================================================
{
  const shiftId = makeShift('نشست حذف برگشت معلق')
  const variantId = makeVariant(20, 'سایز ۵۰')
  const inv = await paidSale(shiftId, variantId, 2)
  const base = stockOf(variantId)
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 2 }], UNIT * 2)
  eq('پیش‌فرض: کالا معلق است', stockOf(variantId), base)

  // نشست ۶۴ · بند ۴-۲۲ — «حذف» = ابطال با دلیل؛ سند با مهر باطل می‌ماند
  const del = await salesService.returnDelete({ id: ret.id, userId, reason: 'ثبت اشتباه برگشت' })
  eq('حذف، هیچ چیزی از انبار کم نکرد (دو بار کم/اضافه نشد)', stockOf(variantId), base)
  eq('تعداد برگشت‌خورده‌ی گزارش حذف صفر است', del.reversedQty, 0)
  eq('سند برگشت باطل شد (نه حذف فیزیکی)', returnRow(ret.id)?.voidedAt != null, true)
  eq('درخواست بی‌مرجع، لغو شد (رکورد مالی حذف نشد)', requestRow(ret.cardTransfer.id).status, CardTransferStatus.CANCELED)
  ok(
    'دلیل لغو، ابطال سند مرجع را می‌گوید',
    (requestRow(ret.cardTransfer.id).cancelReason ?? '').includes('باطل'),
    requestRow(ret.cardTransfer.id).cancelReason
  )
  const s = await summary()
  eq('هیچ معلقی از این سند نماند', s.byVariant[variantId] ?? 0, 0)
}

// ===========================================================================
section('بند ۱۰ · ویرایش برگشتِ معلق ⇒ درِ پشتی بسته است')
// ===========================================================================
{
  const shiftId = makeShift('نشست ویرایش برگشت معلق')
  const variantId = makeVariant(20, 'سایز ۵۲')
  const inv = await paidSale(shiftId, variantId, 3)
  const base = stockOf(variantId)
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 3 }], UNIT * 3)

  const upd = await salesService.returnUpdate({
    id: ret.id,
    lines: [{ saleItemId: inv.items[0].id, qty: 1 }],
    userId
  })
  eq('مبلغ سند اصلاح شد', upd.total, UNIT)
  eq('ویرایش هیچ کالایی به موجودی قابل‌فروش برنگرداند', stockOf(variantId), base)
  eq('هیچ حرکت انباری ساخته نشد', movementsOf(ret.id).length, 0)
  eq('restockedQty اقلامِ تازه هم صفر است', returnItems(ret.id).every((i) => i.restockedQty === 0), true)
  eq('سند همچنان معلق است', returnRow(ret.id).restockPending, 1)
  const s = await summary()
  eq('معلق با تعداد جدید حساب شد', pendingQtyOf(s, ret.id), 1)

  // و بعد از پرداخت مدیر، فقط همان تعداد نهایی آزاد می‌شود (نه سه عدد اولیه)
  const paid = await cardTransferService.pay({ id: ret.cardTransfer.id, managerPassword: PW, userId })
  eq('فقط تعداد نهایی آزاد شد', paid.releasedQty, 1)
  eq('موجودی فقط یک عدد بالا رفت', stockOf(variantId), base + 1)
}

// ===========================================================================
section('بند ۱۱ · انبارگردانی: معلق، مغایرت کاذب نمی‌سازد')
// ===========================================================================
{
  const shiftId = makeShift('نشست انبارگردانی معلق')
  const variantId = makeVariant(10, 'شلوار انبارگردانی')
  const inv = await paidSale(shiftId, variantId, 2)
  const sellable = stockOf(variantId) // ۸
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 2 }], UNIT * 2)
  eq('موجودی قابل‌فروش هنوز هشت است', stockOf(variantId), sellable)

  // فروشنده ۱۰ عدد روی قفسه می‌شمارد: ۸ قابل‌فروش + ۲ معلق
  const submitted = await stockCountService.submit({
    items: [{ variantId, countedQty: sellable + 2 }],
    userId,
    userName: 'مدیر تست کار ب'
  })
  eq('معلقِ همین شمارش snapshot شد', submitted.pendingRestockQty, 2)
  eq('این ردیف «مورد اختلاف» شمرده نشد (شمارش = قابل‌فروش + معلق)', submitted.mismatchedCount, 0)
  const item = seed.one('SELECT * FROM "StockCountItem" WHERE sessionId = ?', submitted.id)
  eq('ستون خامِ diffQty دست‌نخورده و تاریخی ماند', item.diffQty, 2)
  eq('و معلق در همان ردیف ذخیره شد', item.pendingRestockQty, 2)

  const list = await stockCountService.list({})
  const lrow = list.find((r) => r.id === submitted.id)
  eq('فهرست شمارش‌ها همان قاعده را دارد', lrow.mismatchedCount, 0)
  eq('و جمع معلق را نشان می‌دهد', lrow.pendingRestockQty, 2)

  const disc = await stockCountService.discrepancy({})
  const drow = disc.rows.find((r) => r.variantId === variantId)
  eq('گزارش مغایرت معلق را دارد', drow.pendingRestockQty, 2)
  eq('موجودی فیزیکیِ مورد انتظار = قابل‌فروش + معلق', drow.expectedPhysicalQty, sellable + 2)
  eq('مغایرت نیازمند بررسی صفر است (شلوار معلق «اضافه»ی کاذب نساخت)', drow.diffAtCountWithPending, 0)
  eq('ستون خامِ بی‌معلق کنارش ماند تا معلوم باشد تفاضل از کجاست', drow.diffAtCount, 2)
  eq('این ردیف نیازمند بررسی علامت نخورد', drow.needsReview, false)
  eq('ولی «معلق‌دار» علامت خورد', drow.hasPending, true)
  ok('جمع معلقِ زنده برای نوار هشدار بالای جدول', disc.pendingRestockQty >= 2, String(disc.pendingRestockQty))

  // شمارشِ غلط (بی‌احتساب معلق) همان کسری واقعی را نشان می‌دهد
  const wrong = await stockCountService.submit({ items: [{ variantId, countedQty: sellable }], userId })
  eq('شمارشِ بی‌معلق یک مورد اختلاف واقعی است', wrong.mismatchedCount, 1)

  // کالایی که هیچ شمارشی ندارد ولی معلق دارد ⇒ ردیفش ساخته می‌شود، بی‌عدد مغایرت
  const shift2 = makeShift('نشست ردیف فقط‌معلق')
  const v2 = makeVariant(10, 'کالای بی‌شمارش')
  const inv2 = await paidSale(shift2, v2, 1)
  const ret2 = await cardToCardReturn(inv2.id, [{ saleItemId: inv2.items[0].id, qty: 1 }], UNIT)
  const disc2 = await stockCountService.discrepancy({ onlyMismatched: true })
  const orow = disc2.rows.find((r) => r.variantId === v2)
  ok('ردیفِ «فقط معلق» حتی با onlyMismatched هم حذف نشد', !!orow, 'ردیف پیدا نشد')
  eq('این ردیف شمارش ندارد', orow.hasCount, false)
  eq('پس هیچ عدد مغایرتی برایش ساخته نشد', orow.diffAtCountWithPending, 0)
  eq('ولی معلقش دیده می‌شود', orow.pendingRestockQty, 1)

  // snapshot دیروز با پرداخت امروز عوض نمی‌شود
  await cardTransferService.pay({ id: ret.cardTransfer.id, managerPassword: PW, userId })
  const after = seed.one('SELECT * FROM "StockCountItem" WHERE sessionId = ?', submitted.id)
  eq('snapshot شمارشِ ثبت‌شده با آزادسازی امروز تکان نخورد', after.pendingRestockQty, 2)
  await cardTransferService.cancel({
    id: ret2.cardTransfer.id,
    reason: 'پایان سناریو انبارگردانی',
    releaseStock: true,
    managerPassword: PW,
    userId
  })
}

// ===========================================================================
section('بند ۱۲ · معلق‌ها و پول: هیچ اثری روی صندوق و سرجمع فروش ندارند')
// ===========================================================================
{
  const shiftId = makeShift('نشست مالیِ معلق')
  const variantId = makeVariant(20, 'سایز ۵۴')
  const inv = await paidSale(shiftId, variantId, 2)
  const before = await cashboxService.expected({ shiftId, countedCash: UNIT * 2 })
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 1 }], UNIT)
  const after = await cashboxService.expected({ shiftId, countedCash: UNIT * 2 })

  eq('نقد مورد انتظار عوض نشد (پولی از کشو بیرون نرفت)', after.expectedCash, before.expectedCash)
  eq('کسری/اضافی عوض نشد', after.cashDifference, before.cashDifference)
  eq('ردیف «دریافتی به حساب مدیرِ» کار الف صفر ماند (دو مفهوم جدا)', after.managerAccountReceived, 0)
  eq('انتظار کارتخوان عوض نشد', after.components.cardExpected, before.components.cardExpected)

  const outOf = await cardTransferService.outOfSales({})
  ok('کارت‌به‌کارت در بلوک «خارج از فروش» دیده می‌شود', outOf.rows.some((r) => r.returnId === ret.id))
  ok('و متنش می‌گوید در سرجمع فروش نمی‌آید', outOf.note.includes('سرجمع فروش'))

  // پرداخت مدیر هم هیچ پولی به صندوق اضافه/کم نمی‌کند
  await cardTransferService.pay({ id: ret.cardTransfer.id, managerPassword: PW, userId })
  const paidView = await cashboxService.expected({ shiftId, countedCash: UNIT * 2 })
  eq('بعد از پرداخت مدیر هم نقد مورد انتظار همان است', paidView.expectedCash, before.expectedCash)
  eq('و کسری/اضافی همان', paidView.cashDifference, before.cashDifference)
}

// ===========================================================================
section('بند ۱۳ · داده‌ی قدیمی: برگشت‌های قبلی هیچ‌وقت معلق شمرده نمی‌شوند')
// ===========================================================================
{
  const shiftId = makeShift('نشست داده‌ی قدیمی')
  const variantId = makeVariant(20, 'سایز قدیمی')
  const inv = await paidSale(shiftId, variantId, 2)
  const base = stockOf(variantId)

  // برگشتِ نقدیِ عادی = همان شکلِ داده‌ی قبل از جلسه ۴۰ (restockedQty = qty)
  const legacy = await salesService.createReturn({
    invoiceId: inv.id,
    full: false,
    lines: [{ saleItemId: inv.items[0].id, qty: 1 }],
    refundMethod: RefundMethod.CASH,
    refundAmount: UNIT,
    userId
  })
  eq('داده‌ی قدیمی پرچم معلق ندارد', returnRow(legacy.id).restockPending, 0)
  const s = await summary()
  eq('و در هیچ شکلی معلق شمرده نمی‌شود', pendingQtyOf(s, legacy.id), 0)
  eq('موجودی هم همان لحظه برگشته بود', stockOf(variantId), base + 1)

  // فاکتور بدون کسر موجودی: `restockedQty = 0` ولی معلق نیست (تله‌ی تعریف)
  const wholesale = await salesService.create({
    userId,
    shiftId,
    deductInventory: false,
    lines: [{ variantId, qty: 1, unitPrice: UNIT, discount: 0, tax: 0 }],
    payments: [{ methodId: METHOD.cash, amount: UNIT }]
  })
  const wItems = itemsOf(wholesale.id)
  const stockBefore = stockOf(variantId)
  const noDeduct = await salesService.createReturn({
    invoiceId: wholesale.id,
    full: false,
    lines: [{ saleItemId: wItems[0].id, qty: 1 }],
    refundMethod: RefundMethod.CARD_TO_CARD,
    refundAmount: UNIT,
    userId
  })
  eq('فاکتور بدون کسر موجودی هیچ‌وقت معلق نمی‌شود', noDeduct.restockPending, false)
  eq('restockedQty صفر است ولی معنایش «کالایی در کار نیست» است', returnItems(noDeduct.id)[0].restockedQty, 0)
  eq('موجودی انبار دست‌نخورده ماند', stockOf(variantId), stockBefore)
  const s2 = await summary()
  eq('و در فهرست معلق‌ها نیامد (کسری کاذب انبارگردانی ساخته نشد)', pendingQtyOf(s2, noDeduct.id), 0)
}

// ===========================================================================
section('بند ۱۴ · یادآوری بر اساس سن درخواست')
// ===========================================================================
{
  const shiftId = makeShift('نشست سن درخواست')
  const variantId = makeVariant(20, 'سایز کهنه')
  const inv = await paidSale(shiftId, variantId, 1)
  const ret = await cardToCardReturn(inv.id, [{ saleItemId: inv.items[0].id, qty: 1 }], UNIT)

  const fresh = await summary()
  eq('درخواست تازه سنش صفر است', fresh.items.find((i) => i.returnId === ret.id).ageDays, 0)

  const nineDaysAgo = Date.now() - 9 * 86_400_000
  sql.prepare('UPDATE "CardTransferRequest" SET createdAt = ? WHERE id = ?').run(nineDaysAgo, ret.cardTransfer.id)

  const aged = await summary()
  eq('سن درخواست از روی تاریخ ثبت حساب شد', aged.items.find((i) => i.returnId === ret.id).ageDays, 9)
  eq('قدیمی‌ترین سنِ خلاصه هم به‌روز شد', aged.oldestAgeDays, 9)
  eq('تُنِ هشدار به «alert» رسید', pendingRestockTone(aged.oldestAgeDays, aged.totalQty), 'alert')
  ok(
    'هشدار بستن شیفت عقب‌افتادگی را می‌گوید',
    (pendingRestockShiftWarning(aged, faDigits) ?? '').includes('عقب افتاده'),
    pendingRestockShiftWarning(aged, faDigits)
  )
  ok(
    'خلاصه‌ی بالای صفحه‌ها سن قدیمی‌ترین را می‌گوید',
    (pendingRestockHeadline(aged, faDigits, faDigits) ?? '').includes('قدیمی‌ترین درخواست'),
    pendingRestockHeadline(aged, faDigits, faDigits)
  )
  ok('ردیف‌ها از قدیمی‌ترین مرتب شده‌اند', aged.items[0].returnId === ret.id, String(aged.items[0]?.returnId))
}

// --------------------------------------------------------------------- پایان
console.log(`\nسوییت کار ب (کالای در انتظار تأیید مدیر · جلسه ۴۰/۴۵): ${pass} PASS · ${failures.length} FAIL`)
if (failures.length) {
  console.log('\nناموفق‌ها:')
  for (const f of failures) console.log(`  • ${f}`)
}
console.log(`دیتابیس تست: ${process.env.HARNESS_DB}`)
process.exit(failures.length ? 1 : 0)
