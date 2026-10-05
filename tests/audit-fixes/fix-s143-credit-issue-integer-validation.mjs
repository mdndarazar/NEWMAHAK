/**
 * ===========================================================================
 * نشست ۱۴۳ · خوشه E/D · بند ۴-۲۸(د) — validation عددی صدور اعتبار خرید
 *
 * قبل از رفع:
 *   ۱) issueStoreCredit مبلغ را Math.round می‌کرد (۱۰۰٬۰۰۰٫۶ ⇒ ۱۰۰٬۰۰۱) و متن «۵۰۰»
 *      یا 1e20 را هم می‌پذیرفت/گرد می‌کرد؛
 *   ۲) days منفی با clampInt(...) || null بی‌صدا «بدون انقضا» می‌شد و ۹۹۹۹ روز به ۳۶۵۰؛
 *   ۳) maxUses/minPurchase/maxPerTransaction اعشاری/منفی بی‌صدا گرد/صفر می‌شدند؛
 *   ۴) bulkIssueCredits تعداد ۲٫۶ را ۳ و مبلغ ۱۰۰٫۴ را ۱۰۰ می‌کرد.
 * انتظار: هر ورودی نامعتبر با پیام فارسی (با واحد) رد شود و صفر StoreCredit/Batch.
 * مسیرهای معتبر (days=null ⇒ بدون انقضا، days=0 ⇒ رفتار تاریخی بدون انقضا) حفظ شوند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s143-credit-issue-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s143b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — ورودی نامعتبر پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 90)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}
const credits = () => seed.count('StoreCredit', '1 = 1')
const batches = () => seed.count('StoreCreditBatch', '1 = 1')
const userId = seed.user('مدیر تست نشست ۱۴۳')
const issue = (extra) => storeCreditService.issueManual({ amount: 100000, userId, managerPassword: PW, ...extra })
const bulk = (extra) => storeCreditService.bulkIssue({ count: 2, amountEach: 100000, userId, managerPassword: PW, ...extra })

console.log('\n۱) صدور تکی: مبلغ نامعتبر ⇒ رد با واحد ریال')
await rejects('مبلغ اعشاری ۱۰۰۰۰۰٫۶', () => issue({ amount: 100000.6 }), 'ریال')
await rejects('مبلغ متنی «۵۰۰»', () => issue({ amount: '500' }), 'ریال')
await rejects('مبلغ خارج از سقف امن 1e20', () => issue({ amount: 1e20 }), 'ریال')
await rejects('مبلغ منفی', () => issue({ amount: -5 }), 'ریال')
console.log('\n۲) صدور تکی: مدت/دفعات/سقف‌ها نامعتبر ⇒ رد (نه «بدون انقضا» بی‌صدا)')
await rejects('days منفی (-5)', () => issue({ days: -5 }), 'روز')
await rejects('days اعشاری (2.5)', () => issue({ days: 2.5 }), 'روز')
await rejects('days بیش از ۳۶۵۰', () => issue({ days: 9999 }), 'روز')
await rejects('maxUses اعشاری (2.5)', () => issue({ maxUses: 2.5, multiUse: true }), 'بار')
await rejects('minPurchase منفی', () => issue({ minPurchase: -1000 }), 'ریال')
await rejects('maxPerTransaction اعشاری', () => issue({ maxPerTransaction: 10.5 }), 'ریال')
eq('StoreCredit پس از ده ورودی نامعتبر', credits(), 0)

console.log('\n۳) صدور گروهی: تعداد/مبلغ/مدت نامعتبر ⇒ رد و صفر Batch')
await rejects('تعداد اعشاری ۲٫۶', () => bulk({ count: 2.6 }), 'عدد')
await rejects('مبلغ هر اعتبار اعشاری ۱۰۰٫۴', () => bulk({ amountEach: 100.4 }), 'ریال')
await rejects('days منفی در گروهی', () => bulk({ days: -3 }), 'روز')
eq('StoreCredit پس از تلاش‌های گروهی نامعتبر', credits(), 0)
eq('StoreCreditBatch پس از تلاش‌های گروهی نامعتبر', batches(), 0)

console.log('\n۴) مسیرهای معتبر حفظ می‌شوند')
const a = await safe('صدور تکی ۱۰۰٬۰۰۰ ریال بدون انقضا', () => issue({ days: null }))
eq('مبلغ دقیق', Number(a?.amount), 100000)
const b = await safe('صدور تکی با days=30', () => issue({ days: 30 }))
eq('issuedDays ثبت‌شده', Number(seed.one('SELECT issuedDays FROM "StoreCredit" WHERE id = ?', b?.id)?.issuedDays), 30)
const g = await safe('صدور گروهی ۲ × ۱۰۰٬۰۰۰', () => bulk({}))
eq('تعداد ساخته‌شده', g?.created, 2)
eq('کل StoreCredit', credits(), 4)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
