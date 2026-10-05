/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف — منبع واحدِ «کدام فیلد پول است»
 * ---------------------------------------------------------------------------
 * این فایل عمداً یک **فهرست صریح** است، نه یک heuristic روی نام فیلد.
 *
 * چرا: یک regex مثل /total|amount|price/ هم `invoiceCount` را جا می‌اندازد و هم
 * `movementCount` را اشتباه می‌گیرد، و بدتر — `qty`، `stock` و `sortOrder` را با
 * مبلغ قاطی می‌کند. تبدیل اشتباهِ یک فیلد تعداد به BigInt یعنی هر جای کد که
 * `qty` را در محاسبه‌ی عدد به کار می‌برد در زمان اجرا می‌ترکد؛ و جا انداختنِ یک
 * فیلد پول یعنی همان سرریزی که کل این کار برای رفعش انجام می‌شود.
 *
 * پس هر ۲۶۴ فیلد `Int` اسکیما دقیقاً یک بار در یکی از سه گروه زیر می‌آید و
 * `tools/check-money-fields.mjs` تضمین می‌کند هیچ فیلدی از قلم نیفتاده و هیچ
 * فیلدی هم دو بار نیامده. اگر فردا کسی فیلد `Int` جدیدی به اسکیما اضافه کند،
 * آن بررسی قرمز می‌شود و مجبور است تصمیم بگیرد این فیلد پول هست یا نه.
 * ===========================================================================
 */

/**
 * گروه ۱ — **مبلغ ریالی** ⇒ باید `BigInt` شود.
 * معیار: مقدارش یک مبلغ پول به ریال است و می‌تواند از جمع شدن بزرگ شود.
 */
export const MONEY_FIELDS = [
  // قیمت پایه‌ی کالا
  'ProductVariant.salePrice',
  'ProductVariant.purchasePrice',

  // جمع دستیِ خرید مشتری (سابقه‌ی قبل از سیستم)
  'Customer.manualPurchaseTotal',

  // صندوق — پرتکرارترین محل سرریز، چون همه‌ی فروش یک شیفت در آن جمع می‌شود
  'CashSession.cashTotal',
  'CashSession.cardTotal',
  'CashSession.creditTotal',
  'CashSession.otherTotal',
  'CashSession.grandTotal',
  'CashSession.countedTotal',
  'CashSession.openingFloat',
  'CashSession.cashSales',
  'CashSession.cardSales',
  'CashSession.otherSales',
  'CashSession.clearedChequeSales',
  'CashSession.priorCreditSettlements',
  'CashSession.cashReturnRefunds',
  'CashSession.cardReturnRefunds',
  'CashSession.cashExchangeRefunds',
  'CashSession.storeCreditIssued',
  'CashSession.storeCreditUsed',
  'CashSession.pendingCheques',
  'CashSession.bouncedCheques',
  'CashSession.withdrawals',
  'CashSession.deposits',
  'CashSession.expectedCash',
  'CashSession.cashDifference',
  'CashSession.managerAccountReceived',
  'CashSession.destinationUnknownReceived',

  'CashMovement.amount',

  // تجمیع — جمع چند شیفت، پس از صندوق هم بزرگ‌تر می‌شود
  'Consolidation.goodsTotal',
  'Consolidation.taxTotal',
  'Consolidation.serviceTotal',
  'Consolidation.discountTotal',
  'Consolidation.deliveryTotal',
  'Consolidation.grandTotal',
  'Consolidation.receivedTotal',
  'Consolidation.returnedTotal',

  // فاکتور فروش
  'SaleInvoice.goodsTotal',
  'SaleInvoice.taxTotal',
  'SaleInvoice.serviceCharge',
  'SaleInvoice.discountTotal',
  'SaleInvoice.deliveryFee',
  'SaleInvoice.grandTotal',
  'SaleInvoice.paidTotal',

  'SaleInvoiceItem.unitPrice',
  'SaleInvoiceItem.discount',
  'SaleInvoiceItem.tax',
  'SaleInvoiceItem.lineTotal',

  'Payment.amount',
  'Payment.overpayAmount',

  // برگشت و تعویض
  'SaleReturn.total',
  'SaleReturn.exchangeTotal',
  'SaleReturn.exchangeDiff',
  'SaleReturn.refundAmount',
  'SaleReturn.debtReduction',

  'SaleReturnItem.unitPrice',
  'SaleReturnItem.lineTotal',

  // خرید
  'PurchaseInvoice.goodsTotal',
  'PurchaseInvoice.discountTotal',
  'PurchaseInvoice.grandTotal',
  'PurchaseInvoice.paidTotal',

  'PurchaseInvoiceItem.unitPrice',
  'PurchaseInvoiceItem.lineTotal',

  // اعتبار فروشگاهی
  'StoreCredit.amount',
  'StoreCredit.usedAmount',
  'StoreCredit.minPurchase',
  'StoreCredit.maxPerTransaction',

  'StoreCreditRedemption.amount',
  'StoreCreditRedemption.remainderAfter',

  'StoreCreditBatch.amountEach',
  'StoreCreditBatch.totalAmount',
  'StoreCreditBatch.minPurchase',
  'StoreCreditBatch.maxPerTransaction',

  /**
   * تغییر قیمت گروهی.
   * ⚠️ `PriceChangeBatch.value` عمداً اینجاست با اینکه *گاهی درصد* است:
   * وقتی `mode === 'AMOUNT'` باشد مقدارش ریال است (`PriceAdjustService.ts:246`
   * حتی واحد را « ریال» چاپ می‌کند). چون یک ستون نمی‌تواند نیمی Int و نیمی
   * BigInt باشد، باید نوعِ بزرگ‌تر را بگیرد. درصدِ ۱۰ هم در BigInt بی‌مشکل است.
   */
  'PriceChangeBatch.value',
  'PriceChangeBatch.roundStep',
  'PriceChangeBatch.minPrice',
  'PriceChangeBatch.deltaTotal',

  'PriceChangeItem.oldPrice',
  'PriceChangeItem.newPrice',

  // کارت‌به‌کارت
  'CardTransferRequest.invoiceTotal',
  'CardTransferRequest.returnTotal',
  'CardTransferRequest.amount',
  'CardTransferRequest.paidAmount',

  // دفتر هزینه گزارش مدیریت (جداول تازه، نه ستون روی فروش)
  'PurchaseLot.unitCost',
  'SaleItemCost.fifoCost',
  'SaleItemCost.replacementCost',
  'SaleItemCost.revenue',
  'CostConsumption.unitCost',
  'MgmtTarget.amount'
]

/**
 * گروه ۲ — **شناسه و کلید خارجی** ⇒ `Int` می‌ماند.
 * تبدیل این‌ها فقط هزینه دارد: هر `where: { id }` و هر `include` را می‌شکند و
 * هیچ سرریزی هم جلوگیری نمی‌کند (شمارنده‌ی autoincrement هرگز به ۹ کوادریلیون
 * نمی‌رسد).
 */
export const ID_FIELDS = [
  'User.id', 'Category.id', 'Category.parentId', 'Warehouse.id',
  'Product.id', 'Product.categoryId', 'ProductVariant.id', 'ProductVariant.productId',
  'ProductVariant.woocommerceProductId',
  'StockMovement.id', 'StockMovement.variantId', 'StockMovement.warehouseId',
  'StockMovement.refId', 'StockMovement.consolidationId',
  'Customer.id', 'Supplier.id',
  'Shift.id', 'Shift.userId',
  'CashSession.id', 'CashSession.shiftId', 'CashSession.closedBy',
  'CashMovement.id', 'CashMovement.shiftId', 'CashMovement.userId',
  'CashMovement.refId', 'CashMovement.auditLogId',
  'Consolidation.id', 'Consolidation.shiftId',
  'PaymentMethod.id',
  'SaleInvoice.id', 'SaleInvoice.customerId', 'SaleInvoice.userId', 'SaleInvoice.shiftId',
  'SaleInvoice.consolidationId', 'SaleInvoice.exchangeReturnId', 'SaleInvoice.sourceInvoiceId',
  'SaleInvoice.voidedByUserId',
  'SaleInvoiceItem.id', 'SaleInvoiceItem.invoiceId', 'SaleInvoiceItem.variantId',
  'Payment.id', 'Payment.invoiceId', 'Payment.methodId', 'Payment.createdByUserId',
  'Payment.createdShiftId', 'Payment.clearedShiftId', 'Payment.clearedByUserId',
  'Payment.storeCreditId', 'Payment.voidedByUserId',
  'PaymentChequeStatusHistory.id', 'PaymentChequeStatusHistory.paymentId',
  'PaymentChequeStatusHistory.clearedShiftId', 'PaymentChequeStatusHistory.userId',
  'SaleReturn.id', 'SaleReturn.invoiceId', 'SaleReturn.exchangeInvoiceId',
  'SaleReturn.storeCreditId', 'SaleReturn.userId', 'SaleReturn.shiftId',
  'SaleReturn.refundPaymentId', 'SaleReturn.voidedByUserId',
  'SaleReturnItem.id', 'SaleReturnItem.returnId', 'SaleReturnItem.saleItemId',
  'SaleReturnItem.variantId',
  'PurchaseInvoice.id', 'PurchaseInvoice.supplierId',
  'PurchaseInvoiceItem.id', 'PurchaseInvoiceItem.invoiceId', 'PurchaseInvoiceItem.variantId',
  'PurchaseInvoiceItem.warehouseId',
  'SecondaryStockItem.id', 'SecondaryStockItem.warehouseId',
  'SecondaryWarehouse.id',
  'SecondaryStockLog.id', 'SecondaryStockLog.itemId', 'SecondaryStockLog.warehouseId',
  'SecondaryStockLog.userId',
  'StoreCredit.id', 'StoreCredit.batchId', 'StoreCredit.returnId',
  'StoreCredit.exchangeInvoiceId', 'StoreCredit.sourceInvoiceId', 'StoreCredit.customerId',
  'StoreCredit.usedInvoiceId', 'StoreCredit.usedPaymentId', 'StoreCredit.remainderCreditId',
  'StoreCredit.userId',
  'StoreCreditRedemption.id', 'StoreCreditRedemption.creditId', 'StoreCreditRedemption.invoiceId',
  'StoreCreditRedemption.paymentId', 'StoreCreditRedemption.userId', 'StoreCreditRedemption.shiftId',
  'StoreCreditBatch.id', 'StoreCreditBatch.customerId', 'StoreCreditBatch.userId',
  'CreditReminderLog.id', 'CreditReminderLog.creditId', 'CreditReminderLog.userId',
  'AuthLockout.id',
  'AuditLog.id', 'AuditLog.userId', 'AuditLog.entityId',
  'PriceChangeBatch.id', 'PriceChangeBatch.categoryId', 'PriceChangeBatch.userId',
  'PriceChangeItem.id', 'PriceChangeItem.batchId', 'PriceChangeItem.variantId',
  'CardTransferRequest.id', 'CardTransferRequest.returnId', 'CardTransferRequest.sourceInvoiceId',
  'CardTransferRequest.exchangeInvoiceId', 'CardTransferRequest.userId',
  'CardTransferRequest.shiftId', 'CardTransferRequest.paidByUserId',
  'CardTransferRequest.paidShiftId', 'CardTransferRequest.adjustsRequestId',
  'StockCountSession.id', 'StockCountSession.userId',
  'StockCountItem.id', 'StockCountItem.sessionId', 'StockCountItem.variantId',
  'SaleItemStockAllocation.id', 'SaleItemStockAllocation.invoiceId',
  'SaleItemStockAllocation.saleItemId', 'SaleItemStockAllocation.variantId',
  'SaleItemStockAllocation.warehouseId',
  'PurchaseLot.id', 'PurchaseLot.purchaseInvoiceId', 'PurchaseLot.variantId',
  'SaleItemCost.id', 'SaleItemCost.saleItemId', 'SaleItemCost.invoiceId', 'SaleItemCost.variantId',
  'CostConsumption.id', 'CostConsumption.movementId', 'CostConsumption.lotId', 'CostConsumption.saleItemId',
  'CostEngineState.lastMovementId',
  'CostEngineFailure.id', 'CostEngineFailure.movementId',
  /**
   * جدول «هدف ماه» گزارش مدیریت — دو ستون عددی غیرپول. `id` و `userId` شناسه‌اند
   * (مثل بقیه‌ی جدول‌ها `Int` می‌مانند) و فقط `amount` ریال است که در گروه ۱ ثبت شده.
   * بدون این دو خط، نگهبان `check-money-fields.mjs` (از نشست ۱۸۱: هر فیلد عددی اسکیما
   * باید دقیقاً در یک گروه باشد) قرمز می‌ماند.
   */
  'MgmtTarget.id', 'MgmtTarget.userId',
  /**
   * نشست SMS — جدول‌های پنل پیامکی.
   *
   * ⚠️ این‌ها **هیچ‌کدام پول نیستند** و عمداً در گروه «شناسه» و «شمارنده»
   * می‌مانند: پنل پیامکی هیچ محاسبه‌ی مالی پروژه را لمس نمی‌کند و تنها عدد
   * پولی‌اش (برآورد هزینه‌ی پیامک) در جدول `Setting` است، نه اینجا.
   *
   * بدون این خطوط، نگهبان `check-money-fields.mjs` (هر فیلد عددی اسکیما باید
   * دقیقاً در یک گروه باشد) قرمز می‌ماند.
   */
  'SaleItemCost.replacementPurchaseInvoiceId',
  'SmsProviderConfig.id',
  'SmsTemplate.id', 'SmsTemplate.createdByUserId', 'SmsTemplate.updatedByUserId',
  'SmsOutbox.id', 'SmsOutbox.templateId', 'SmsOutbox.providerConfigId', 'SmsOutbox.customerId',
  'SmsOutbox.relatedEntityId', 'SmsOutbox.canceledByUserId', 'SmsOutbox.createdByUserId',
  'SmsAttempt.id', 'SmsAttempt.outboxId',
  /* فاز ۴ — کمپین و دفتر «لغو ۱۱»: کلیدها و ارجاع‌ها (هیچ‌کدام مبلغ نیستند) */
  'SmsOutbox.campaignId',
  'SmsOptOut.id', 'SmsOptOut.createdByUserId',
  'SmsCampaign.id', 'SmsCampaign.templateId', 'SmsCampaign.createdByUserId', 'SmsCampaign.canceledByUserId'
]

/**
 * گروه ۳ — **تعداد، شمارنده، ترتیب، شماره‌ی سند، درصد و روز** ⇒ `Int` می‌ماند.
 * هیچ‌کدام مبلغ نیستند و هیچ‌کدام از محدوده‌ی امن رد نمی‌شوند.
 */
export const COUNT_FIELDS = [
  'ProductVariant.stock',          // تعداد موجودی
  'ProductVariant.minStock',       // تعداد
  'StockMovement.delta',           // تعداد (مثبت ورود، منفی خروج)
  'Shift.number', 'Shift.sessionSeq', 'Shift.suggestedSlot', 'Shift.slotNumber',
  'CashSession.invoiceCount',
  'Consolidation.invoiceCount', 'Consolidation.movementCount',
  'PaymentMethod.sortOrder',
  'SaleInvoice.receiptNo',                  // شماره‌ی فیش، نه مبلغ
  'SaleInvoice.wholesaleDiscountPercent',   // درصد
  'SaleInvoiceItem.qty',
  'Payment.seq',
  'SaleReturn.exchangeReceiptNo',           // شماره‌ی فیش
  'SaleReturnItem.qty', 'SaleReturnItem.restockedQty',
  'PurchaseInvoice.invoiceNo',              // شماره‌ی سند
  'PurchaseInvoiceItem.qty',
  'SecondaryStockItem.qty', 'SecondaryStockItem.minQty',
  'SecondaryWarehouse.sortOrder',
  'SecondaryStockLog.qtyBefore', 'SecondaryStockLog.qtyAfter', 'SecondaryStockLog.delta',
  'StoreCredit.usedCount', 'StoreCredit.maxUses', 'StoreCredit.issuedDays',
  'StoreCredit.printCount', 'StoreCredit.reminderCount', 'StoreCredit.usedReceiptNo',
  'StoreCreditRedemption.seq', 'StoreCreditRedemption.receiptNo',
  'StoreCreditBatch.count', 'StoreCreditBatch.days', 'StoreCreditBatch.maxUses',
  'StoreCreditBatch.codeLength',
  'AuthLockout.failCount', 'AuthLockout.lockCount',
  'PriceChangeBatch.itemCount', 'PriceChangeBatch.editCount',
  'CardTransferRequest.sourceReceiptNo', 'CardTransferRequest.exchangeReceiptNo',
  'CardTransferRequest.stockReleasedQty',
  'StockCountItem.countedQty', 'StockCountItem.systemQty', 'StockCountItem.diffQty',
  'StockCountItem.pendingRestockQty',
  'SaleItemStockAllocation.qty', 'SaleItemStockAllocation.balanceAfter',
  'SaleItemStockAllocation.restoredQty',
  'PurchaseLot.qtyIn', 'PurchaseLot.qtyLeft',
  'SaleItemCost.qty',
  'CostConsumption.qty',
  /* نشست SMS — شمارنده/ترتیب/بخش‌ها. هیچ‌کدام مبلغ نیستند. */
  'SmsProviderConfig.credentialsVersion',
  'SmsTemplate.version',
  'SmsOutbox.priority', 'SmsOutbox.attemptCount', 'SmsOutbox.maxAttempts', 'SmsOutbox.segments',
  'SmsAttempt.attemptNo', 'SmsAttempt.httpStatus',
  /* فاز ۴ — شمارنده‌های کمپین. «برآورد هزینه» هم عمداً اینجاست نه در گروه پول:
     هیچ تراکنش مالی‌ای با آن انجام نمی‌شود و فقط برای نمایش قبل از ارسال است
     (پولِ واقعی در جدول‌های فروش/اعتبار است، نه اینجا). */
  'SmsCampaign.audienceCount', 'SmsCampaign.queuedCount', 'SmsCampaign.skippedCount',
  'SmsCampaign.optOutSkipped', 'SmsCampaign.invalidCount', 'SmsCampaign.duplicateCount',
  'SmsCampaign.segments', 'SmsCampaign.costEstimate'
]

/** استخراج همه‌ی فیلدهای `Int` از فایل اسکیما. */
export function parseIntFields(schemaText) {
  const out = []
  let model = null
  for (const line of schemaText.split('\n')) {
    const m = /^model\s+(\w+)\s*\{/.exec(line)
    if (m) { model = m.group?.(1) ?? m[1]; continue }
    if (/^\}/.test(line)) { model = null; continue }
    if (!model) continue
    const f = /^\s{2}(\w+)\s+Int(\?)?(\s|$)/.exec(line)
    if (f) out.push({ key: `${model}.${f[1]}`, model, field: f[1], optional: Boolean(f[2]) })
  }
  return out
}

/** همان، ولی برای فیلدهای `BigInt` (برای بررسی «بعد از مهاجرت»). */
export function parseBigIntFields(schemaText) {
  const out = []
  let model = null
  for (const line of schemaText.split('\n')) {
    const m = /^model\s+(\w+)\s*\{/.exec(line)
    if (m) { model = m[1]; continue }
    if (/^\}/.test(line)) { model = null; continue }
    if (!model) continue
    const f = /^\s{2}(\w+)\s+BigInt(\?)?(\s|$)/.exec(line)
    if (f) out.push({ key: `${model}.${f[1]}`, model, field: f[1], optional: Boolean(f[2]) })
  }
  return out
}
