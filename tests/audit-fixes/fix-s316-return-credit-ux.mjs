/**
 * نشست ۳۱۶ — سه اصلاح جریان برگشت/اعتبار (خواسته‌ی مالک، با تصاویر):
 *   1) «چاپ دوباره‌ی کد اعتبار» آزاد نباشد: پشتِ رمز مدیر/رمز دوم/رمز سومِ ماژول اعتبار.
 *   2) ورودی «مبلغ بازپرداخت» هنگام تایپ سه‌رقم‌سه‌رقم نمایش داده شود (state خام رقمی می‌ماند).
 *   3) رسید برگشت = سند حسابداری شیفت: هیچ بارکد/کد اعتباری داخلش چاپ نشود؛ فقط سطرهای مبلغی.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s316-return-credit-ux.mjs
 *
 * ترکیب ساختاری (قفل قرارداد) + رفتاری (moneyInput و قالب رسید برگشت واقعاً رندر می‌شوند).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

const printService = read('src/main/services/PrintService.ts')
const salesService = read('src/main/services/SalesService.ts')
const templates = read('src/main/print/templates.ts')
const overpay = read('src/renderer/src/components/OverpayFlowDialogs.tsx')
const invoicePayments = read('src/renderer/src/components/InvoicePaymentsModal.tsx')
const salesInvoice = read('src/renderer/src/pages/SalesInvoice.tsx')
const salesReturn = read('src/renderer/src/pages/SalesReturn.tsx')

console.log('\n— ۱) چاپ دوباره‌ی سند اعتبار فقط با رمز (مدیر/رمز دوم/رمز سوم)')
{
  const start = printService.indexOf('async printCredit(input:')
  const end = printService.indexOf('/**\n   * -------------------------------------------------------------------------', start)
  const printCredit = printService.slice(start, end)
  check('printCredit گیت reprint را قبل از هر رندر اعمال می‌کند', [
    /reprint\?: boolean/.test(printCredit),
    /password\?: string \| null/.test(printCredit),
    /input\?\.reprint === true/.test(printCredit),
    /assertPanelPasswordStrict/.test(printCredit),
    /PANEL_KEYS\.creditManagement, input\?\.password, 'چاپ دوباره‌ی سند اعتبار خرید'/.test(printCredit)
  ], [true, true, true, true, true])
  check('گیت قبل از خواندن قالب/رندر است (ترتیب امن)', [
    printCredit.indexOf('input?.reprint === true') > -1 &&
      printCredit.indexOf('input?.reprint === true') < printCredit.indexOf('creditDocDataFor')
  ], [true])

  check('مودال کد صادرشده مرحله‌ی رمزِ چاپ دوباره را دارد', [
    /const \[reprintAsk, setReprintAsk\]/.test(overpay),
    /onClick=\{\(\) => setReprintAsk\(true\)\}/.test(overpay),
    /onReprint\(reprintPw\.trim\(\)\)/.test(overpay),
    /onReprint: \(password: string\) => void/.test(overpay),
    /چاپ دوباره‌ی کد \(با رمز\)|فقط اگر برگه‌ای بیرون نیامده: چاپ دوباره \(با رمز\)/.test(overpay)
  ], [true, true, true, true, true])
  check('helper چاپ، پرچم reprint و رمز را به IPC می‌فرستد', [
    /reprint: opts\?\.reprint === true \? true : undefined/.test(overpay),
    /password: opts\?\.password \?\? undefined/.test(overpay)
  ], [true, true])

  const parents = { invoicePayments, salesInvoice, salesReturn }
  for (const [name, src] of Object.entries(parents)) {
    check(`${name}: چاپ اول بدون رمز می‌ماند و reprint با رمز می‌رود`, [
      /reprintPassword\?: string/.test(src),
      /\{ reprint: true, password: opts\.reprintPassword \}/.test(src),
      /onReprint=\{\(pw\) => void printIssued\w+\([^,]+, \{ reprintPassword: pw \}\)\}/.test(src)
    ], [true, true, true])
  }
}

console.log('\n— ۲) ورودی «مبلغ بازپرداخت» سه‌رقم‌سه‌رقم (state خام)')
{
  check('SalesReturn به moneyInput وصل است و state را خام نگه می‌دارد', [
    /from '\.\.\/lib\/moneyInput'/.test(salesReturn),
    /value=\{groupThousands\(refundAmount\)\}/.test(salesReturn),
    /onChange=\{\(e\) => setRefundAmount\(digitsOnly\(e\.target\.value\)\)\}/.test(salesReturn),
    /placeholder=\{groupThousands\(String\(totals\.amount\)\)\}/.test(salesReturn),
    /inputMode="numeric"/.test(salesReturn)
  ], [true, true, true, true, true])

  const { digitsOnly, groupThousands } = await import(resolve(root, 'src/renderer/src/lib/moneyInput.ts'))
  check('groupThousands نمایش زنده‌ی سه‌رقم‌سه‌رقم (جداکننده‌ی ٬)', [
    groupThousands('10000000'),
    groupThousands('1598')
  ], ['10٬000٬000', '1٬598'])
  check('groupThousands رقم فارسی/جداکننده‌ی واردشده را هم هضم می‌کند', [
    groupThousands('۱٬۲۳۴٬۵۶۷'),
    groupThousands('۵۹۸٬۰۰۰')
  ], ['1٬234٬567', '598٬000'])
  check('ورودی خالی و صفر ابتدایی شکسته نمی‌شود', [
    groupThousands(''),
    groupThousands('007'),
    groupThousands('0')
  ], ['', '7', '0'])
  check('digitsOnly رفت‌و‌برگشت: خام(state) از نمایش بازیابی می‌شود', [
    digitsOnly(groupThousands('59800012')),
    digitsOnly('۱٬۲۳4 abc')
  ], ['59800012', '1234'])
}

console.log('\n— ۳) رسید برگشت بدون کد/بارکد اعتبار + لینک اعتبار به سند برگشت')
{
  const iocStart = salesService.indexOf('async function issueOverpayCreditTx(')
  check('issueOverpayCreditTx ورودی returnId می‌گیرد و به issueStoreCredit می‌دهد', [
    /returnId\?: number \| null/.test(salesService.slice(iocStart, iocStart + 1500)),
    /returnId: input\.returnId \?\? null/.test(salesService)
  ], [true, true])
  check('مسیر برگشت هنگام صدور اعتبار overpay شناسه‌ی سند را سوار می‌کند', [
    /managerApproved: opts\.overpayManagerApproved,\s*\/\/ نشست ۳۱۶[\s\S]{0,160}?returnId: ret\.id/.test(salesService)
  ], [true])

  const rdfStart = printService.indexOf('async returnDataFor(')
  const rdfEnd = printService.indexOf('/** HTML رسید برگشت', rdfStart)
  const returnDataFor = printService.slice(rdfStart, rdfEnd)
  check('returnDataFor اعتبارها را با returnId + storeCreditId و بدون بارکد می‌آورد', [
    /storeCredit\.findMany/.test(returnDataFor),
    /\{ returnId: ret\.id \}/.test(returnDataFor),
    /storeCredits = credits\.map/.test(returnDataFor),
    !/storeCreditBarcodeDataUrl/.test(returnDataFor),
    !/barcodePng/.test(returnDataFor),
    /CreditSource\.OVERPAY/.test(returnDataFor)
  ], [true, true, true, true, true, true])

  const tplStart = templates.indexOf('export function returnReceiptHtml(')
  const tplEnd = templates.indexOf('export function debtPaymentReceiptHtml', tplStart)
  const returnTpl = templates.slice(tplStart, tplEnd)
  check('قالب رسید برگشت هیچ مسیر چاپ کد/بارکد ندارد', [
    !/storeCreditCode/.test(returnTpl),
    !/BarcodeDataUrl/.test(returnTpl),
    /اعتبارهای صادرشده از این برگشت \(بدون کد\/بارکد\)/.test(returnTpl),
    /کد\/بارکد اعتبار روی این رسید چاپ نمی‌شود؛ سند اعتبار جداگانه صادر و چاپ می‌گردد/.test(returnTpl),
    /\(باطل‌شده\)/.test(returnTpl)
  ], [true, true, true, true, true])

  // رفتاری: قالب واقعاً رندر شود — سناریوی کاربر: برگشت کامل ۱٬۵۹۸٬۰۰۰ = ۱٬۰۰۰٬۰۰۰ تسویه + ۵۹۸٬۰۰۰ اعتبار
  const { returnReceiptHtml } = await import(resolve(root, 'src/main/print/templates.ts'))
  const baseData = {
    returnId: 12,
    sourceReceiptNo: 345,
    dateJalali: '1404/07/16',
    time: '12:00:00',
    shopName: 'فروشگاه',
    customerName: 'عمومی',
    cashierName: 'فروشنده',
    shiftName: null,
    items: [{ name: 'کالا', qty: 1, unitPrice: 1_598_000, lineTotal: 1_598_000 }],
    total: 1_598_000,
    refundMethod: 'CASH',
    refundMethodLabel: 'نقدی از صندوق',
    refundAmount: 1_000_000,
    refundReference: null,
    voidedAt: null,
    voidReason: null,
    restocked: true,
    restockedQty: 1,
    hasRemovedItems: false,
    storeCredits: [
      { label: 'اعتبار باقیمانده (اضافه‌دریافت)', amount: 598_000, expiresJalali: '1405/01/01', status: 'ACTIVE' }
    ],
    note: undefined
  }
  const html = returnReceiptHtml(baseData)
  check('رندر رسید: سناریوی ۱٬۵۹۸٬۰۰۰ ⇒ مبلغ اعتبار بدون هیچ کد/بارکد', [
    html.includes('اعتبارهای صادرشده از این برگشت'),
    html.includes('۵۹۸٬۰۰۰'),
    html.includes('code">') === false,
    /src="data:image/.test(html) === false,
    html.includes('کد/بارکد اعتبار روی این رسید چاپ نمی‌شود'),
    /[A-Z0-9]{6,}/.test(html.replace(/<[a-z/][^>]*>/g, '')) === false // هیچ توکن انگلیسی شبه‌کد (EXHLD7/EG28V4) در متن
  ], [true, true, true, true, true, true])
  const noCreditHtml = returnReceiptHtml({ ...baseData, storeCredits: [] })
  check('برگشت بدون اعتبار بلوک اعتبار ندارد', [noCreditHtml.includes('اعتبارهای صادرشده') === false], [true])
}

console.log('\n— ۴) بلوک «مبدأ کسر» از رسید مشتری حذف شده (نشست ۳۱۶ · پیام دوم مالک)')
{
  const rcStart = templates.indexOf('export function receiptHtml(')
  const rcEnd = templates.indexOf('/** گزارش A4', rcStart)
  const receiptHtml = templates.slice(rcStart, rcEnd)
  check('قالب رسید فروش نه stockSource می‌داند نه STOCK_PICK_TEXT', [
    !/stockSource/.test(receiptHtml),
    !/stockBlock/.test(receiptHtml),
    !/STOCK_PICK_TEXT/.test(receiptHtml)
  ], [true, true, true])
  const rdataStart = templates.indexOf('export interface ReceiptData {')
  const rdataEnd = templates.indexOf('}', templates.indexOf('footer?: string', rdataStart))
  const receiptData = templates.slice(rdataStart, rdataEnd)
  check('ReceiptData دیگر فیلد stockSource ندارد', [!/stockSource/.test(receiptData)], [true])
  const rdfStart2 = printService.indexOf('async receiptDataFor(')
  const rdfEnd2 = printService.indexOf('/** بارکد کد فاکتور', rdfStart2)
  const receiptDataFor = printService.slice(rdfStart2, rdfEnd2)
  check('receiptDataFor دیگر summaryOf/مبدأ کسر نمی‌خواند (فراخوانی واقعی، نه اشاره‌ی توضیح)', [
    !/summaryOf\(/.test(receiptDataFor),
    !/stockAllocationService\./.test(receiptDataFor)
  ], [true, true])

  // رفتاری: رسید فروشِ دارای مبدأ قدیمی هم بدون نامی از انبار رندر می‌شود
  const { receiptHtml: renderReceipt } = await import(resolve(root, 'src/main/print/templates.ts'))
  const receiptOut = renderReceipt({
    receiptNo: 345,
    items: [{ name: 'کالا', qty: 1, unitPrice: 100, lineTotal: 100 }],
    goodsTotal: 100,
    grandTotal: 100
  })
  check('رندر واقعی رسید: نامِ «مبدأ کسر» در خروجی نیست', [
    !/مبدأ کسر/.test(receiptOut)
  ], [true])
}

console.log('\n— ۵) سند اعتبار مشتری جزئیات کامل صدور را خودش می‌گوید')
{
  check('CreditDocData فیلد issueLines دارد و بدنه‌ی سند «جزئیات صدور» را چاپ می‌کند', [
    /issueLines\?: string\[\]/.test(templates),
    /جزئیات صدور:<\/b>/.test(templates)
  ], [true, true])
  check('سازنده‌ی سطرها برگشت/تعویض/اقلام/مابه‌التفاوت را پوشش می‌دهد', [
    /creditIssueLinesForDoc/.test(printService),
    /بابت برگشت از فروش فاکتور/.test(printService),
    /بابت تعویض کالای فاکتور/.test(printService),
    /اقلام برگشتی: /.test(printService),
    /کالای جایگزین: /.test(printService),
    /مابه‌التفاوت: /.test(printService),
    /issueLines: await creditIssueLinesForDoc\(c\)/.test(printService)
  ], [true, true, true, true, true, true, true])

  const { creditDocHtml } = await import(resolve(root, 'src/main/print/templates.ts'))
  const credit = (extra) =>
    creditDocHtml({
      code: 'EG28V4',
      amount: 598000,
      usedAmount: 0,
      remaining: 598000,
      sourceLabel: 'اضافه‌دریافت',
      statusLabel: 'فعال',
      issuedJalali: '1404/07/16',
      issuedTime: '12:00:00',
      expiresJalali: '1405/01/01',
      usesLabel: 'یک بار',
      maxUses: 1,
      usedCount: 0,
      restrictLabel: null,
      minPurchase: 0,
      maxPerTransaction: 0,
      holderName: 'مشتری',
      holderCompany: null,
      holderPhone: null,
      holderAgent: null,
      holderAddress: null,
      holderNationalId: null,
      barcodeDataUrl: null,
      shopName: 'فروشگاه',
      rulesText: '',
      showRules: false,
      showHolder: true,
      showRemaining: true,
      reprint: false,
      voided: false,
      printCount: 1,
      linkedReceiptNo: 345,
      ...extra
    })
  const withStory = credit({
    issueLines: [
      'بابت برگشت از فروش فاکتور ۳۴۵ (سند برگشت ۱۲)',
      'اقلام برگشتی: شلوار ×۱',
      'مبلغ کل برگشت: ۱٬۵۹۸٬۰۰۰ ریال',
      'تسویه در همان لحظه: ۱٬۰۰۰٬۰۰۰ ریال (نقدی)',
      'باقیمانده‌ی ۵۹۸٬۰۰۰ ریال به‌صورت اعتبار خرید (همین سند) صادر شد'
    ]
  })
  check('کد اعتبار و داستان صدور، هر دو روی سند مشتری چاپ می‌شوند', [
    withStory.includes('EG28V4'),
    withStory.includes('جزئیات صدور'),
    withStory.includes('اقلام برگشتی: شلوار ×۱'),
    withStory.includes('۵۹۸٬۰۰۰ ریال به‌صورت اعتبار خرید (همین سند) صادر شد')
  ], [true, true, true, true])
  const withoutStory = credit({ issueLines: [] })
  check('اعتبارِ بی‌داستان (صدور دستی) جعبه‌ی خالی نمی‌سازد', [!withoutStory.includes('جزئیات صدور')], [true])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
