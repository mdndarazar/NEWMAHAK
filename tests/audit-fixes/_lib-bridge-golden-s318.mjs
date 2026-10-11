/*
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۰ — مشترک‌سازیِ برش‌های متنِ مبغوه و
 * ساخت سه فیکسچر golden برای پل تطبیق. فقط ابزار آفلاین تست‌هاست؛ هر دو
 * نسخه‌ی «بازتولید» (_regen) و «مقایسه» (fix-s318-0) از همین خوانده می‌شوند تا
 * هر دو دقیقاً یک راه ببینند.
 *
 * هر فایلِ قبل از پسوند _ به دلیل قانون رانر اجرا نمی‌شود.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

export const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

export const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
}

/**
 * سه برش متنِ مبغوه که «گاردِ هش» فازهای ۱ تا ۶ به آن‌ها قفل می‌ماند. اگر هر
 * کدام تغییر کند تست قرمز می‌شود و پیاده‌ساز مجبور می‌شود هش تازه را با
 * کامیت جداگانه ثبت کند — همان جلوگیری پیش‌نمایش از «ریفکتور پنهانی» است.
 */
export function bridgeTextSlices() {
  const acc = readFileSync(resolve(ROOT, 'src/shared/accounting.ts'), 'utf8')
  const rep = readFileSync(resolve(ROOT, 'src/main/services/accountingReport.ts'), 'utf8')

  const eqStart = acc.indexOf('export function calculateReconciliationBridge(input: BridgeInput = {}): ReconciliationBridge {')
  if (eqStart < 0) throw new Error('نشانه‌ی شروع calculateReconciliationBridge پیدا نشد')
  const eqEnd = acc.indexOf('\n}\n', eqStart) + 3
  if (eqEnd <= eqStart + 10) throw new Error('پایان calculateReconciliationBridge پیدا نشد')

  const hintsStart = rep.indexOf('const HINTS: Record<string, string> = {')
  if (hintsStart < 0) throw new Error('نشانه‌ی HINTS پیدا نشد')
  const hintsEnd = rep.indexOf('\n  }', hintsStart) + 4
  if (hintsEnd <= hintsStart + 10) throw new Error('پایان HINTS پیدا نشد')

  const blockStart = rep.indexOf('const bridgeRaw = calculateReconciliationBridge({')
  if (blockStart < 0) throw new Error('نشانه‌ی بلوک ورودی‌های پل پیدا نشد')
  const blockEnd = rep.indexOf('  /** نشست ۱۷۰ · S169-D4', blockStart)
  if (blockEnd <= blockStart + 50) throw new Error('پایان بلوک ورودی‌های پل پیدا نشد')

  return {
    equation: acc.slice(eqStart, eqEnd),
    hints: rep.slice(hintsStart, hintsEnd),
    bridgeInputBlock: rep.slice(blockStart, blockEnd)
  }
}

/** روزهای ثابتِ سه فیکسچر (فاصله‌دار تا رویداد جا به‌جا شده در هیچ بازه نیفتد). */
export const FIXTURE_DAYS = { closed: '1405/06/01', posInvoice: '1405/06/05', posPayBefore: '1405/06/04', overpay: '1405/06/10' }

const asSlice = (res) => {
  const b = res?.accounting?.bridge
  if (!b) throw new Error('خروجی reportRows.accounting.bridge ندارد')
  return {
    period: res.accounting.period ?? null,
    bridge: {
      rows: (b.rows ?? []).map((r) => ({ key: r.key, label: r.label, amount: Number(r.amount), sign: Number(r.sign) })),
      target: Number(b.target),
      explainedTotal: Number(b.explainedTotal),
      unexplained: Number(b.unexplained),
      balanced: b.balanced === true
    },
    warnings: Array.isArray(res.warnings) ? [...res.warnings] : []
  }
}

/**
 * ساخت هر سه فیکسچر در یک دیتابیس روز-جداکرده و خروجی برش هر یک:
 *   closed     — پل بسته: فروش نقدی کاملِ همان روز
 *   posInvoice — unexplained > 0: فاکتور این بازه با پرداختِ پس‌تاریخ‌شده به قبل از بازه
 *   overpay    — unexplained < 0: پرداختیِ بزرگ‌تر از صورت‌حساب بدون overpayAmount (داده‌ی قدیمی)
 * همه‌ی ستون‌های تاریخی سند به روزهای ثابت می‌آیند تا golden روزِ باز نباشد.
 */
export async function collectFixtures() {
  const DIR = mkdtempSync(join(tmpdir(), 'mahak-s318-golden-'))
  process.env.HARNESS_DIR = DIR
  process.env.HARNESS_DB = join(DIR, 'shop.db')
  process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

  const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
  const { makeSeeder } = await import('../../test/harness/seed.mjs')
  const { salesService } = await import('../../src/main/services/SalesService.ts')
  const { shiftService } = await import('../../src/main/services/ShiftService.ts')
  const { jalaliStartOfDay } = await import('@shared/jalali')

  const db = harnessClient()
  const seed = makeSeeder(db)
  const sql = db.$harness.db
  const at = (day, ms = 36_000_000 + 46) => jalaliStartOfDay(day).getTime() + ms

  const userId = seed.user('مدیر فیکسچر نشست ۳۱۸')
  const cat = seed.category('پوشاک')
  const product = seed.product('شلوار تست', cat)
  const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
  let x = 0
  const variant = (price) => {
    const id = seed.variant(product, `سایز تست ${++x}`)
    sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
    return id
  }

  // فروش فقط به «شیفت بازِ لحظه‌ی ثبت» گره می‌خورد (S156): اول هر سه سند را در
  // یک نشست امروزی می‌سازیم، سپس همه‌ی تاریخ‌ها را به روزهای ثابتِ فیکسچر
  // می‌کشیم و در پایان سه گزارش روزانه می‌خوانیم. این ترتیب جلوی نویز
  // «نشست جامانده»ی ensureCurrent را می‌گیرد (هیچ ثبت جدیدی بعد از کشیدن تاریخ رخ نمی‌دهد).
  await shiftService.openSession({ staffId: userId, name: 'صبح' })
  const shiftRow = sql.prepare('SELECT id FROM "Shift" ORDER BY id DESC LIMIT 1').get()

  // ---- ۱) ساخت هر سه سند در یک روز (فقط ثبت‌های خام) -----------------------
  const docs = []
  for (let i = 0; i < 3; i++) {
    const price = 100_000
    const invoice = await salesService.create({
      userId,
      lines: [{ variantId: variant(price), qty: 1, unitPrice: price, discount: 0, tax: 0 }],
      payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
    })
    const pay = sql.prepare('SELECT id FROM "Payment" WHERE invoiceId = ? LIMIT 1').get(invoice.id)
    docs.push({ invoice, payId: pay?.id ?? null })
  }

  // ---- ۲) کشیدن تاریخ‌ها به دوره‌های مجزای فیکسچر ---------------------------
  const moveDoc = (doc, invDay, payDay, payAmount) => {
    sql
      .prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?')
      .run(at(invDay), invDay, at(invDay), doc.invoice.id)
    if (doc.payId != null) {
      sql
        .prepare('UPDATE "Payment" SET paidAt = ?, createdAt = ?, paidAtJalali = ?, paidAtTime = ? WHERE id = ?')
        .run(at(payDay), at(payDay), payDay, '10:00:00', doc.payId)
      if (payAmount != null) sql.prepare('UPDATE "Payment" SET amount = ? WHERE id = ?').run(payAmount, doc.payId)
    }
  }
  moveDoc(docs[0], FIXTURE_DAYS.closed, FIXTURE_DAYS.closed, null)
  moveDoc(docs[1], FIXTURE_DAYS.posInvoice, FIXTURE_DAYS.posPayBefore, null)
  moveDoc(docs[2], FIXTURE_DAYS.overpay, FIXTURE_DAYS.overpay, 150_000)
  sql.prepare('UPDATE "Shift" SET dayJalali = ? WHERE id = ?').run(FIXTURE_DAYS.overpay, shiftRow.id)

  // ---- ۳) سه گزارش روزانه‌ی مجزا -------------------------------------------
  const closed = asSlice(await salesService.reportRows({ fromJalali: FIXTURE_DAYS.closed, toJalali: FIXTURE_DAYS.closed }))
  const posInvoice = asSlice(await salesService.reportRows({ fromJalali: FIXTURE_DAYS.posInvoice, toJalali: FIXTURE_DAYS.posInvoice }))
  const overpay = asSlice(await salesService.reportRows({ fromJalali: FIXTURE_DAYS.overpay, toJalali: FIXTURE_DAYS.overpay }))
  return { closed, posInvoice, overpay }
}
