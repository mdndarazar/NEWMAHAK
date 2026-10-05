/**
 * نشست ۱۱۷ · خوشه G (بند ۴-۴۶ «صفحه‌بندی واقعی، نه سقف بی‌صدا» + ۴-۹ «در تب تعویض قابل ردیابی»)
 *
 * باگ: `salesService.exchangeGet` (چاپ دوباره/ریز یک تعویض) کل تعویض‌های همان روز
 * را با `take: 2000` و مرتب‌سازی id نزولی می‌خواند و ردیف را در حافظه پیدا می‌کرد.
 * در روزی با بیش از ۲٬۰۰۰ تعویض، قدیمی‌ترین سندها هرگز پیدا نمی‌شدند و خطای
 * «جزئیات این تعویض پیدا نشد» می‌داد؛ سند تعویض واقعی قابل ردیابی/چاپ نبود.
 * بعد از رفع (S117-3): `exchangeList` فیلتر داخلی `returnId` دارد و `exchangeGet`
 * دقیقاً همان یک سند را با همان سازنده‌ی ردیف (بدون فرمول تازه) می‌خواند.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s117-exg-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

const now = Date.now() - 60 * 1000
const today = toJalaliDate(new Date(now))
const { db: raw } = db.$harness
raw.exec('BEGIN')
const ids = []
for (let i = 0; i < 2050; i++) {
  const inv = seed.insert('SaleInvoice', { grandTotal: 1_000_000, status: 'FINAL', receiptNo: 20_000 + i, issuedAt: now, issuedAtJalali: today })
  ids.push(
    seed.insert('SaleReturn', {
      invoiceId: inv,
      kind: 'EXCHANGE',
      total: 1_000_000,
      exchangeTotal: 1_300_000 + i,
      exchangeDiff: 300_000 + i,
      returnedAt: now,
      returnedAtJalali: today
    })
  )
}
raw.exec('COMMIT')

let first = null
let err = null
try {
  first = await salesService.exchangeGet({ id: ids[0] })
} catch (e) {
  err = e.message
}
eq('قدیمی‌ترین تعویضِ روزِ شلوغ پیدا می‌شود (بدون خطا)', err, null)
eq('همان سند برگشت داده می‌شود', first?.returnId, ids[0])
eq('مبلغ جایگزین همان سند', first?.exchangeTotal, 1_300_000)

const last = await salesService.exchangeGet({ id: ids[ids.length - 1] })
eq('جدیدترین تعویض هم درست', last?.returnId, ids[ids.length - 1])

// ردیف exchangeGet با ردیف همان سند در فهرست یکی است (یک سازنده، بدون فرمول تازه)
const list = await salesService.exchangeList({ fromJalali: today, toJalali: today, take: 5 })
const inList = list.rows.find((r) => r.returnId === ids[ids.length - 1])
eq('ردیف exchangeGet = ردیف فهرست', JSON.stringify(last), JSON.stringify(inList))
eq('فهرست عمومی همچنان کل روز را می‌شمارد', list.page?.totalCount, 2050)

let voidErr = null
try {
  await salesService.exchangeGet({ id: 999_999 })
} catch (e) {
  voidErr = e.message
}
eq('سند ناموجود ⇒ خطای فارسی', typeof voidErr === 'string' && /تعویض/.test(voidErr), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
