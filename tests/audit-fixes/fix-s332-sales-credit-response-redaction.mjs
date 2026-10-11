// @ts-check
/**
 * نشست ۳۳۲ — پاسخ‌ عملیات فروش credential نیست
 *
 * مسیرهای create/update/addPayment/createReturn/createExchange و صدور اعتبار
 * اضافه‌دریافت باید فقط DTO امن بدهند. ساخت و چاپ کد داخل main باقی می‌ماند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s332-sales-credit-response-redaction.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sales = readFileSync('src/main/services/SalesService.ts', 'utf8')
const types = readFileSync('src/shared/types.ts', 'utf8')
const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
const invoice = readFileSync('src/renderer/src/pages/SalesInvoice.tsx', 'utf8')
const returns = readFileSync('src/renderer/src/pages/SalesReturn.tsx', 'utf8')
const overpayUi = readFileSync('src/renderer/src/components/OverpayFlowDialogs.tsx', 'utf8')
const flow = readFileSync('src/shared/overpayFlow.ts', 'utf8')

const ok = (label, predicate) => {
  assert.ok(predicate, label)
  console.log(`  ✓ ${label}`)
}

console.log('--- ۱. مرز خروجی فروش DTO امن می‌سازد ---')
ok('shapeStoreCreditSafe کد و legacyCode را حذف می‌کند', /function shapeStoreCreditSafe[\s\S]{0,350}\{ code: _redeemableCode, legacyCode: _legacyCode, \.\.\.safe \}/.test(sales))
ok('shapeOverpayCreditSafe کد را حذف می‌کند', /function shapeOverpayCreditSafe[\s\S]{0,250}\{ code: _redeemableCode, \.\.\.safe \}/.test(sales))
ok('ثبت فروش اعتبار مصرفی و باقی‌مانده را امن shape می‌کند', /storeCredit = shapeStoreCreditSafe\(redeemed\.credit\)[\s\S]{0,180}storeCreditRemainder = redeemed\.remainder \? shapeStoreCreditSafe/.test(sales))
ok('ثبت فروش اعتبار اضافه‌دریافت را امن shape می‌کند', /overpayCredit: shapeOverpayCreditSafe\(overpayCredit\)/.test(sales))
ok('برگشت storeCreditCode خام را قبل از return کنار می‌گذارد', /storeCreditCode: _storeCreditCode,/.test(sales) && /storeCredit: rawStoreCredit \? shapeStoreCreditSafe\(rawStoreCredit\) : null/.test(sales))
ok('برگشت اعتبار اضافه‌دریافت را امن shape می‌کند', /overpayCredit: shapeOverpayCreditSafe\(rawOverpayCredit\)/.test(sales))
ok('تعویض اعتبار را امن shape می‌کند', /storeCredit: credit \? shapeStoreCreditSafe\(credit\) : null/.test(sales))
ok('صدور مستقل اضافه‌دریافت تنها DTO امن اعلام می‌کند', /Promise<OverpayCreditSafeResult & \{ available: number \}>/.test(sales))
ok('قرارداد نتیجه تعویض DTO امن است', /storeCredit: StoreCreditSafeRow \| null/.test(types))

console.log('--- ۲. credential وارد UI/پیام عادی نمی‌شود ---')
ok('POS کد اعتبار خروجی فروش را رندر نمی‌کند', !/last\.storeCredit(?:Remainder)?\.code/.test(pos))
ok('فاکتور عمده کد اعتبار باقی‌مانده را رندر نمی‌کند', !/storeCreditRemainder\.code/.test(invoice))
ok('برگشت و تعویض کد اعتبار خروجی را رندر نمی‌کنند', !/retResult\.storeCredit\.code|exResult\.storeCredit\.code/.test(returns))
ok('پنجره صدور اعتبار کد را رندر نمی‌کند', !/\{issuedCredit\?\.code\}/.test(overpayUi))
ok('پیام اضافه‌دریافت فقط مرجع امن نشان می‌دهد', /const reference = credit\?\.publicReference/.test(flow) && !/کد اعتبار خرید «\$\{String\(credit\?\.code/.test(flow))

console.log('\nنتیجه: پاسخ‌های استاندارد فروش و UI بدون credential هستند؛ چاپ با شناسه ادامه دارد.')
