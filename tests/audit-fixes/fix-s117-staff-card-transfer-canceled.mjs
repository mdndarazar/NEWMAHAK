/**
 * نشست ۱۱۷ · خوشه E · بندهای ۴-۲ و ۴-۵۷ (گزارش عملکرد کارمند ردیابی‌پذیر و درست)
 *
 * باگ: `staffReportService.performance` ستون «تعهد کارت‌به‌کارت» کارمند را از
 * groupBy همه‌ی درخواست‌های REQUEST می‌ساخت، حتی درخواستی که مدیر «رد/لغو» کرده
 * (status = CANCELED). درخواست لغوشده پولی از حساب مدیر خارج نمی‌کند و تعهد باز
 * نیست؛ شمردنش عملکرد کارمند را بزرگ‌تر از واقعیت نشان می‌داد. همچنین اگر همه‌ی
 * درخواست‌های یک کارمند لغو شده بود، مقدار برگشت‌محورِ `calculateStaffPerformance`
 * (که لغو را نمی‌شناسد) بی‌تغییر می‌ماند.
 * بعد از رفع (S117-1): تعهد = جمع درخواست‌های REQUEST غیرلغوشده‌ی بازه + برای
 * برگشت‌های قدیمیِ بدون هیچ درخواست (داده‌ی تاریخی قبل از جدول درخواست) همان
 * مبلغ برگشت‌محور، تا هیچ تعهد تاریخی پنهان نشود.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s117-sct-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
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
const u1 = seed.user('فروشنده یک')
const u2 = seed.user('فروشنده دو')
const u3 = seed.user('فروشنده سه (داده‌ی قدیمی)')
const u4 = seed.user('فروشنده چهار')

const ret = (userId, amount) =>
  seed.insert('SaleReturn', {
    userId,
    kind: 'RETURN',
    total: amount,
    refundMethod: 'CARD_TO_CARD',
    refundAmount: amount,
    returnedAt: now,
    returnedAtJalali: today
  })
const req = (userId, returnId, amount, status, extra = {}) =>
  seed.insert('CardTransferRequest', {
    userId,
    returnId,
    amount,
    status,
    kind: 'REQUEST',
    createdAt: now,
    createdAtJalali: today,
    ...extra
  })

// کارمند ۱: یک درخواست باز ۴۰۰٬۰۰۰ + یک درخواست لغوشده ۲۵۰٬۰۰۰
req(u1, ret(u1, 400_000), 400_000, 'PENDING')
req(u1, ret(u1, 250_000), 250_000, 'CANCELED', { canceledAt: now, cancelReason: 'مشتری منصرف شد' })
// کارمند ۲: فقط یک درخواست لغوشده ۳۰۰٬۰۰۰
req(u2, ret(u2, 300_000), 300_000, 'CANCELED', { canceledAt: now, cancelReason: 'اشتباه ثبت' })
// کارمند ۳: برگشت کارت‌به‌کارت قدیمی بدون هیچ ردیف درخواست
ret(u3, 120_000)
// کارمند ۴: درخواست پرداخت‌شده ۵۰۰٬۰۰۰
req(u4, ret(u4, 500_000), 500_000, 'PAID', { paidAmount: 500_000, paidAt: now, paidAtJalali: today })

const perf = await staffReportService.performance({ fromJalali: today, toJalali: today })
const rowOf = (id) => perf.rows.find((r) => r.userId === id)

eq('کارمند ۱: درخواست لغوشده در تعهد شمرده نمی‌شود (۴۰۰٬۰۰۰)', rowOf(u1)?.cardToCardTotal, 400_000)
eq('کارمند ۲: فقط لغوشده ⇒ تعهد صفر', rowOf(u2)?.cardToCardTotal, 0)
eq('کارمند ۲: ردیف کارمند همچنان دیده می‌شود (برگشتش پنهان نمی‌شود)', rowOf(u2)?.returnCount, 1)
eq('کارمند ۳: برگشت قدیمیِ بدون درخواست پنهان نمی‌شود (۱۲۰٬۰۰۰)', rowOf(u3)?.cardToCardTotal, 120_000)
eq('کارمند ۴: درخواست پرداخت‌شده تعهد است (۵۰۰٬۰۰۰)', rowOf(u4)?.cardToCardTotal, 500_000)
const sum = perf.rows.reduce((s, r) => s + r.cardToCardTotal, 0)
eq('جمع ستون = ۴۰۰ + ۱۲۰ + ۵۰۰ هزار (هر تعهد دقیقاً یک‌بار)', sum, 1_020_000)

// فیلتر یک کارمند همان عدد را می‌دهد
const only1 = await staffReportService.performance({ fromJalali: today, toJalali: today, userId: u1 })
eq('فیلتر کارمند ۱ همان ۴۰۰٬۰۰۰', only1.rows.find((r) => r.userId === u1)?.cardToCardTotal, 400_000)

// ریز تراکنش: درخواست لغوشده حذف نمی‌شود، فقط با وضعیتش دیده می‌شود (مدرک ضدسرقت)
const tx = await staffReportService.transactions({ fromJalali: today, toJalali: today, userId: u1 })
eq('ریز تراکنش کارمند ۱: درخواست لغوشده با وضعیت CANCELED دیده می‌شود', tx.cardTransfers.some((t) => t.status === 'CANCELED'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
