/**
 * ===========================================================================
 * نشست ۱۷۳ · مشاهده‌ی باز ۱۰۶/۱۰۷ (AUDIT-PROGRESS) — چاپ دسته‌ای/تکی اعتبار باطل‌شده
 *
 * چاپ دسته‌ای همه‌ی اعتبارهای دسته را، از جمله باطل‌شده‌ها، چاپ می‌کند. بازخرید اعتبار باطل در
 * main رد می‌شود، ولی روی کاغذ سند باطل دقیقاً مثل سند معتبر بود: مبلغ درشت، کد، بارکد و فقط یک
 * ردیف کم‌رنگ «وضعیت: باطل شد». برگه‌ی چاپی که شبیه پول است ولی ارزشی ندارد ابزار فریب مشتری است.
 * انتظار (S173-D5): سند باطل‌شده بالای برگه نوار صریح «باطل شده — غیرقابل استفاده» بگیرد (در چاپ
 * دسته‌ای، تکی و PDF — همه از همان creditDocBody)، سند معتبر هیچ نواری نگیرد، و اعتبار باطل همچنان
 * در دسته چاپ و شمرده شود (سابقه‌ی چاپ حذف نمی‌شود).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s173-credit-print-voided-banner.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s173c-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { printService } = await import('../../src/main/services/PrintService.ts')
const { creditBatchHtml, creditDocHtml } = await import('../../src/main/print/templates.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 200)}`) }
}
const BANNER = 'باطل شده — غیرقابل استفاده'
const now = Date.now()
const mk = (code, status, extra = {}) => seed.insert('StoreCredit', {
  code, amount: 500_000, usedAmount: 0, status, source: 'MANUAL', issuedAt: now, issuedAtJalali: '1405/03/12', issuedAtTime: '10:00',
  maxUses: 1, usedCount: 0, ...extra
})
const active = mk('S173-OK', 'ACTIVE')
const voided = mk('S173-VOID', 'CANCELED', { voidedAt: now, voidedReason: 'برگشت باطل شد' })

console.log('\n۱) چاپ دسته‌ای (مسیر واقعی سرویس) با یک اعتبار معتبر و یک باطل')
let r
try { r = await printService.creditBatchRender({ ids: [active, voided], perPage: 4 }) } catch (e) { r = { error: String(e?.message ?? e) } }
eq('رندر بی‌خطا', r?.error ?? null, null)
const html = String(r?.html ?? '')
const docs = html.split('<div class="doc">').slice(1)
eq('هر دو سند چاپ شدند (باطل حذف نمی‌شود)', docs.length, 2)
eq('شناسه‌های چاپ‌شده هر دو', (r?.ids ?? []).slice().sort((a, b) => a - b), [active, voided].sort((a, b) => a - b))
const okDoc = docs.find((d) => d.includes('S173-OK')) ?? ''
const voidDoc = docs.find((d) => d.includes('S173-VOID')) ?? ''
eq('سند باطل نوار «باطل شده — غیرقابل استفاده» دارد', voidDoc.includes(BANNER), true)
eq('نوار سند باطل قبل از مبلغ آمده (بالای برگه)', voidDoc.indexOf(BANNER) >= 0 && voidDoc.indexOf(BANNER) < voidDoc.indexOf('class="amount"'), true)
eq('سند معتبر نوار باطل ندارد', okDoc.includes(BANNER), false)
eq('عبارت «غیرقابل نقد شدن» روی هر دو می‌ماند', [okDoc.includes('غیرقابل نقد شدن'), voidDoc.includes('غیرقابل نقد شدن')], [true, true])

console.log('\n۲) تابع خالص قالب (تکی و دسته‌ای) با voided صریح')
const base = {
  code: 'X1', amount: 1000, usedAmount: 0, remaining: 1000, sourceLabel: 'دستی', statusLabel: 'باطل شد', issuedJalali: '1405/01/01',
  issuedTime: '10:00', expiresJalali: null, usesLabel: 'یک‌بار', maxUses: 1, usedCount: 0, restrictLabel: null, minPurchase: 0,
  maxPerTransaction: 0, holderName: null, holderCompany: null, holderPhone: null, holderAgent: null, holderAddress: null,
  holderNationalId: null, barcodeDataUrl: null, rulesText: '', showRules: false, showHolder: false, showRemaining: false,
  reprint: false, printCount: 1
}
eq('تکی باطل ⇒ نوار', creditDocHtml({ ...base, voided: true }).includes(BANNER), true)
eq('تکی معتبر ⇒ بدون نوار', creditDocHtml({ ...base, statusLabel: 'فعال', voided: false }).includes(BANNER), false)
eq('دسته‌ای باطل ⇒ نوار', creditBatchHtml([{ ...base, voided: true }]).includes(BANNER), true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
