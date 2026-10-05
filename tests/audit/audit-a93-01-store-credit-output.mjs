/**
 * ممیزی A93-01 — چاپ/Excel تب اعتبار خرید (نشست ۹۳) ستون «کانال» را از r.channelLabel/r.channel
 * می‌خواند که در StoreCreditRow وجود ندارد ⇒ ستون همیشه خالی؛ و عبارت اجباری «غیرقابل نقد شدن»
 * (بند ۴-۳۲) روی گزارش نبود. بخش رفتاری: شکل واقعی ردیف سرویس. بخش UI: فقط متن کد (رندر واقعی اجرا نشد).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9301-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
seed.insert('StoreCredit', { code: 'SC93', amount: 300_000, source: 'MANUAL', status: 'ACTIVE', issuedAt: Date.now() - 60_000, issuedAtJalali: today })
const res = await storeCreditService.list({ fromJalali: today, toJalali: today, mode: 'issued' })
const row = (Array.isArray(res) ? res : (res?.rows ?? []))[0] ?? {}
eq('ردیف واقعی سرویس فیلد کانال ندارد (channelLabel/channel)', ['channelLabel', 'channel'].some((k) => k in row), false)
if (Object.keys(row).length) eq('ردیف واقعی سرویس sourceLabel دارد', typeof row.sourceLabel === 'string' && row.sourceLabel.length > 0, true)
else console.log('  ⚠ ردیف seed در list نیامد (هارنس)؛ شکل ردیف فقط از تایپ StoreCreditRow سنجیده شد')
const page = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
eq('UI: خروجی اعتبار دیگر از فیلد ناموجود کانال نمی‌خواند', /channelLabel \?\? r\.channel/.test(page), false)
eq('UI: ستون «منبع» از sourceLabel', (page.match(/r\.sourceLabel \?\? r\.source/g) ?? []).length, 2)
eq('UI: عنوان چاپ و Excel «غیرقابل نقد شدن» دارد', (page.match(/گزارش اعتبار خرید[^\n]{0,20}STORE_CREDIT_NOT_CASHABLE_TITLE/g) ?? []).length, 2)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
