/**
 * نشست ۱۴۱ · خوشه E/C
 *
 * qty و مبلغ‌های برگشت/تعویض ورودی renderer هستند. قبل از این رفع، چند مسیر
 * با Math.round اعشار را بی‌صدا تغییر می‌دادند؛ این تست قرارداد ضدسرقت جدید را
 * روی مسیر ثبت و ویرایش، و روی helper تجمیع، می‌سنجد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sales = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
const returnValue = readFileSync(resolve('src/shared/returnValue.ts'), 'utf8')
let ok = 0
let bad = 0
const truthy = (label, value) => value ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`))

truthy('گیت سختِ فهرست اقلام برگشت وجود دارد', /function validateReturnLines\(/.test(sales))
truthy('گیت برگشت شناسه فاکتور و مبلغ را قبل از تراکنش می‌سنجد', /function validateReturnMutation[\s\S]{0,900}assertSafeInteger\(input\?\.invoiceId[\s\S]{0,900}refundAmount/.test(sales))
truthy('گیت تعویض تعداد، قیمت، تخفیف و مالیات را می‌سنجد', /function validateExchangeMutation[\s\S]{0,1800}row\.qty[\s\S]{0,900}row\.unitPrice[\s\S]{0,900}row\.discount[\s\S]{0,900}row\.tax/.test(sales))
truthy('ثبت برگشت قبل از هر side-effect اعتبارسنجی می‌شود', /async createReturn\(input: ReturnSaleInput\) \{[\s\S]{0,180}validateReturnMutation\(input\)/.test(sales))
truthy('ثبت تعویض قبل از هر side-effect اعتبارسنجی می‌شود', /async createExchange\(input: ExchangeSaleInput\): Promise<ExchangeSaleResult> \{[\s\S]{0,180}validateExchangeMutation\(input\)/.test(sales))
truthy('ویرایش برگشت همان گیت عددی را دارد', /async returnUpdate\(input: UpdateReturnInput\) \{[\s\S]{0,180}validateReturnUpdateMutation\(input\)/.test(sales))
truthy('qty برگشت داخل هسته دیگر بی‌صدا round نمی‌شود', !/const qty = Math\.round\(t\.qty\)/.test(sales))
truthy('qty تعویض داخل فیلتر و ردیف فروش بی‌صدا round نمی‌شود', !/Math\.round\(r\.qty\)/.test(sales))
truthy('helper تجمیع هم اعشار را round نمی‌کند', !/Math\.round\(Number\(t\.qty\)/.test(returnValue))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
