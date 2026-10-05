/**
 * سوییت منطق خالصِ «مدیریت اعتبار خرید» — جلسه ۲۸.
 *
 * دو چیز را تست می‌کند که تا دیروز هیچ تستی نداشتند:
 *   ۱) **بخش ۸ جلسه ۲۷** (`breakdownRow`, `dashboardExportRows`,
 *      `describeRestrictions`, `holderFacts`, `creditLinkFacts`,
 *      `creditCartCoverage`, `isLineExcluded`) — ساخته شد ولی نه مصرف شد و نه
 *      تست.
 *   ۲) **بخش ۹ جلسه ۲۸** (`opFields`, `prefillOpDraft`, `setTypeRule`,
 *      `reminderFilter`, `posPreviewPayload`, `creditExport`, `detailFactBlocks`)
 *      — همان تصمیم‌هایی که فرم‌های تازه رویشان سوارند.
 *
 * اجرا: node --experimental-strip-types test/credit-ui-logic-session28.ts
 *
 * ⚠️ همان الگوی جلسه ۲۲ برای import: سورس اصلی دست‌نخورده می‌ماند و فقط یک کپی
 * با پسوندِ اصلاح‌شده در پوشه‌ی موقت اجرا می‌شود، پس *همان کد واقعی* تست می‌شود.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui28-'))
fs.writeFileSync(path.join(tmp, 'credit.ts'), fs.readFileSync('src/shared/credit.ts'))
fs.writeFileSync(
  path.join(tmp, 'creditUi.ts'),
  fs.readFileSync('src/shared/creditUi.ts', 'utf8').replace(/from '\.\/credit'/g, "from './credit.ts'")
)
const ui: any = await import(path.join(tmp, 'creditUi.ts'))
const rules: any = await import(path.join(tmp, 'credit.ts'))

const {
  CREDIT_ALPHABET_OPTIONS,
  CREDIT_BATCH_HEADERS,
  CREDIT_BREAKDOWN_HEADERS,
  CREDIT_DASHBOARD_HEADERS,
  CREDIT_LIST_HEADERS,
  CREDIT_PAPER_OPTIONS,
  CREDIT_REDEMPTION_HEADERS,
  CREDIT_REMINDER_HEADERS,
  CREDIT_REMINDER_LOG_HEADERS,
  CREDIT_TIMELINE_HEADERS,
  CreditOp,
  breakdownRow,
  buildOpPayload,
  creditCartCoverage,
  creditExport,
  creditLinkFacts,
  dashboardCards,
  dashboardExportRows,
  describeRestrictions,
  detailFactBlocks,
  holderFacts,
  isLineExcluded,
  opFields,
  posPreviewPayload,
  prefillOpDraft,
  reminderFilter,
  setTypeRule,
  usesModeOf
} = ui
const { DEFAULT_CREDIT_SETTINGS, CreditRestrictScope } = rules

let pass = 0
let fail = 0
const out: string[] = []
const t = (title: string, fn: () => boolean) => {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e: any) {
    ok = false
    err = String(e?.message ?? e)
  }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err ? ' -> ' + err : ''}`)
}

const DASH = {
  issuedCount: 12,
  issuedTotal: 1200,
  usedTotal: 500,
  remainingTotal: 700,
  activeCount: 5,
  activeValue: 400,
  unusedCount: 3,
  fullyUsedCount: 2,
  expiredCount: 1,
  canceledCount: 1,
  suspendedCount: 0,
  draftCount: 0,
  nearExpiryCount: 2,
  todayCount: 1,
  liability: 650,
  liabilityReported: true,
  byStatus: [
    { status: 'ACTIVE', statusLabel: 'فعال', count: 5, amount: 800, usedAmount: 100 },
    { status: 'USED', statusLabel: 'مصرف‌شده', count: 2, amount: 400, usedAmount: 400 }
  ],
  bySource: [{ source: 'MANUAL', sourceLabel: 'صادرشده توسط مدیریت', count: 7, amount: 1200, usedAmount: 500 }]
}

// ===========================================================================
// بخش ۸ جلسه ۲۷ — گزارش تفکیکی، جزئیات، سبد
// ===========================================================================

t('breakdownRow: باقی‌مانده محاسبه می‌شود و هم‌طولِ سرستون است', () => {
  const r = breakdownRow({ statusLabel: 'فعال', count: 5, amount: 800, usedAmount: 100 })
  return r.length === CREDIT_BREAKDOWN_HEADERS.length && r[0] === 'فعال' && r[2] === 800 && r[4] === 700
})
t('breakdownRow: مصرف بیشتر از مبلغ، باقی‌مانده‌ی منفی نمی‌سازد', () =>
  breakdownRow({ count: 1, amount: 100, usedAmount: 400 })[4] === 0)
t('breakdownRow: بدون برچسب، از خود کلید وضعیت/نوع استفاده می‌کند', () =>
  breakdownRow({ source: 'MANUAL', count: 1, amount: 1, usedAmount: 0 })[0] === 'MANUAL')

t('dashboardExportRows: هر کارت یک ردیف، و واحدها درست', () => {
  const rows = dashboardExportRows(DASH)
  const cards = dashboardCards(DASH)
  return (
    rows.length === cards.length &&
    rows.every((r: any[]) => r.length === CREDIT_DASHBOARD_HEADERS.length) &&
    rows[0][2] === 'ریال' &&
    rows.some((r: any[]) => r[2] === 'تعداد')
  )
})
t('dashboardExportRows: کارت «تعهد فروشگاه» فقط با روشن‌بودن گزارش تعهد می‌آید', () => {
  const on = dashboardExportRows(DASH).some((r: any[]) => String(r[0]).includes('تعهد'))
  const off = dashboardExportRows({ ...DASH, liabilityReported: false }).some((r: any[]) => String(r[0]).includes('تعهد'))
  return on === true && off === false
})
t('dashboardExportRows: داشبورد خالی ⇒ آرایه‌ی خالی', () => dashboardExportRows(null).length === 0)

t('describeRestrictions: بدون محدودیت هم یک جمله می‌دهد', () => describeRestrictions({}).includes('همه‌ی کالاها'))
t('describeRestrictions: دسته‌بندی ⇒ تعداد یکتا و فهرست مرتبِ شناسه‌ها', () => {
  const s = describeRestrictions({ restrictScope: 'CATEGORY', restrictCategoryIds: [3, 1, 1] })
  return s.includes('2 دسته‌بندی') && s.includes('1، 3')
})
t('describeRestrictions: کالا + حداقل خرید + سقف تراکنش + قفل مشتری', () => {
  const s = describeRestrictions({
    restrictScope: 'VARIANTS',
    restrictVariantIds: [9],
    minPurchase: 500,
    maxPerTransaction: 200,
    customerLocked: true
  })
  return s.includes('کالای مشخص') && s.includes('500') && s.includes('200') && s.includes('همان مشتری')
})

t('holderFacts: فیلدهای خالی حذف می‌شوند', () => {
  const f = holderFacts({ customerName: 'علی', holderCompany: '   ', holderPhone: '0912' })
  return f.length === 2 && f.map((x: any) => x.key).join(',') === 'customerName,holderPhone'
})
t('holderFacts: رکورد بی‌گیرنده ⇒ آرایه‌ی خالی (بلوک نمایش داده نمی‌شود)', () => holderFacts({}).length === 0)
t('holderFacts: قفل مشتری و Opt-out یادآوری هم یک «خبر»اند', () => {
  const keys = holderFacts({ customerLocked: true, reminderOptOut: true }).map((x: any) => x.key)
  return keys.includes('customerLocked') && keys.includes('reminderOptOut')
})

t('creditLinkFacts: شماره فیش کنار شناسه‌ی فاکتور می‌آید', () => {
  const f = creditLinkFacts({ credit: { sourceInvoiceId: 5, sourceReceiptNo: 77 } })
  return f.length === 1 && f[0].value === '#5 (فیش 77)'
})
t('creditLinkFacts: اعتبار باقی‌مانده و دسته و دلیل استثنا دیده می‌شوند', () => {
  const f = creditLinkFacts({
    credit: { settingsOverride: true, overrideReason: 'مصوبه‌ی مدیر' },
    remainderCredit: { id: 2, code: 'CR2', amount: 300 },
    batch: { id: 4, title: 'نوروز' }
  })
  const keys = f.map((x: any) => x.key)
  return keys.includes('remainder') && keys.includes('batch') && keys.includes('override')
})
t('creditLinkFacts: رکورد بی‌پیوند ⇒ آرایه‌ی خالی', () => creditLinkFacts({ credit: {} }).length === 0)

t('isLineExcluded: مقایسه‌ی عددی، مقاوم به رشته و ورودی خراب', () =>
  isLineExcluded('7', [7, 8]) === true && isLineExcluded(7, null) === false)

const CART = [
  { variantId: 1, lineTotal: 1000 },
  { variantId: 2, lineTotal: 500 },
  { variantId: 3, lineTotal: 250 }
]
t('creditCartCoverage: بدون محدودیت، هیچ ردیفی علامت نمی‌خورد', () => {
  const c = creditCartCoverage({ lines: CART, excludedVariantIds: [] })
  return c.restricted === false && c.coveredTotal === 1750 && c.excludedTotal === 0 && c.message === null
})
t('creditCartCoverage: تقسیم سبد و مبلغ هر طرف درست است', () => {
  const c = creditCartCoverage({ lines: CART, excludedVariantIds: [2] })
  return c.restricted === true && c.coveredIds.join(',') === '1,3' && c.coveredTotal === 1250 && c.excludedTotal === 500
})
t('creditCartCoverage: وقتی هیچ قلمی در دامنه نیست، پیام «قابل استفاده نیست» می‌دهد', () => {
  const c = creditCartCoverage({ lines: CART, excludedVariantIds: [1, 2, 3], scopeLabel: 'فقط لبنیات' })
  return c.coveredIds.length === 0 && String(c.message).includes('هیچ‌کدام') && String(c.message).includes('فقط لبنیات')
})
t('creditCartCoverage: پیام جزئی، تعداد و مبلغ خارج از دامنه را می‌گوید', () => {
  const c = creditCartCoverage({ lines: CART, excludedVariantIds: [3] })
  return String(c.message).includes('2 قلم') && String(c.message).includes('250')
})

// ===========================================================================
// بخش ۹ جلسه ۲۸ — فرم عملیات، تنظیمات، یادآوری، پیش‌نمایش POS، خروجی اکسل
// ===========================================================================

t('opFields: هر ۹ عملیات یک فهرست دارند و ابطال/تعلیق/حذف فیلد اضافه نمی‌خواهند', () => {
  const ops = Object.values(CreditOp) as string[]
  return (
    ops.length === 9 &&
    ops.every((op) => Array.isArray(opFields(op))) &&
    opFields(CreditOp.VOID).length === 0 &&
    opFields(CreditOp.SUSPEND).length === 0 &&
    opFields(CreditOp.DELETE).length === 0
  )
})
t('opFields: چهار عملیاتِ گمشده‌ی UI حالا فیلد مخصوص خودشان را دارند', () =>
  opFields(CreditOp.EXPIRY).join() === 'expiry' &&
  opFields(CreditOp.USES).join() === 'uses' &&
  opFields(CreditOp.HOLDER).join() === 'holder' &&
  opFields(CreditOp.RESTRICTION).join() === 'restriction')
t('opFields: تغییری در خروجی، فهرست اصلی را دست‌کاری نمی‌کند (کپی برمی‌گردد)', () => {
  const a = opFields(CreditOp.USES)
  a.push('holder')
  return opFields(CreditOp.USES).length === 1
})

t('usesModeOf: یک‌بارمصرف / چندباره تا N / چندباره تا پایان مبلغ', () =>
  usesModeOf({ multiUse: false, maxUses: 1 }) === 'single' &&
  usesModeOf({ multiUse: true, maxUses: 4 }) === 'count' &&
  usesModeOf({ multiUse: true, maxUses: 1 }) === 'unlimited')

const CREDIT = {
  id: 9,
  amount: 500000,
  usedAmount: 0,
  usedCount: 0,
  maxUses: 3,
  multiUse: true,
  expiresAtJalali: '1405/07/01',
  customerId: 4,
  customerName: 'شرکت الف',
  customerLocked: true,
  holderCompany: 'الف صنعت',
  holderNationalId: '10101',
  holderPhone: '02100',
  holderAddress: 'تهران',
  holderAgent: 'رضا',
  holderNote: 'تحویل انبار',
  reminderOptOut: true,
  restrictScope: 'CATEGORY',
  restrictCategoryIds: [4, 2],
  restrictVariantIds: [],
  minPurchase: 100000,
  maxPerTransaction: 50000
}

t('prefillOpDraft: EXPIRY تاریخ فعلی را می‌آورد', () => prefillOpDraft(CreditOp.EXPIRY, CREDIT).expiresAtJalali === '1405/07/01')
t('prefillOpDraft: AMOUNT مبلغ فعلی را می‌آورد', () => prefillOpDraft(CreditOp.AMOUNT, CREDIT).amount === 500000)
t('prefillOpDraft: USES حالت و سقف تراکنش فعلی را می‌آورد', () => {
  const d = prefillOpDraft(CreditOp.USES, CREDIT)
  return d.usesMode === 'count' && d.maxUses === 3 && d.maxPerTransaction === 50000
})
t('prefillOpDraft: HOLDER کل بلوک گیرنده را می‌آورد (وگرنه تغییر تلفن، آدرس را پاک می‌کرد)', () => {
  const d = prefillOpDraft(CreditOp.HOLDER, CREDIT)
  return (
    d.holderCompany === 'الف صنعت' &&
    d.holderNationalId === '10101' &&
    d.holderAddress === 'تهران' &&
    d.holderAgent === 'رضا' &&
    d.holderNote === 'تحویل انبار' &&
    d.customerId === 4 &&
    d.customerLocked === true &&
    d.reminderOptOut === true
  )
})
t('prefillOpDraft + buildOpPayload: تغییر تلفن، بقیه‌ی فیلدهای گیرنده را حفظ می‌کند', () => {
  const d = { ...prefillOpDraft(CreditOp.HOLDER, CREDIT), managerPassword: 'x', reason: 'اصلاح تلفن', holderPhone: '02199' }
  const r = buildOpPayload(d, CREDIT)
  const p: any = r.payload
  return r.ok === true && p.holderPhone === '02199' && p.holderAddress === 'تهران' && p.holderCompany === 'الف صنعت'
})
t('prefillOpDraft: RESTRICTION دامنه و دسته‌های فعلی را می‌آورد', () => {
  const d = prefillOpDraft(CreditOp.RESTRICTION, CREDIT)
  return d.restrictScope === CreditRestrictScope.CATEGORY && d.restrictCategoryIds.join(',') === '2,4' && d.minPurchase === 100000
})
t('prefillOpDraft: ورودی خالی هم Draft سالم می‌دهد (بدون پرتاب خطا)', () => prefillOpDraft(CreditOp.HOLDER, null).id === 0)
t('prefillOpDraft: عملیات بی‌فیلد، همان Draft خالی است', () => prefillOpDraft(CreditOp.VOID, CREDIT).reason === '')

const S: any = DEFAULT_CREDIT_SETTINGS
t('setTypeRule: فقط همان نوع عوض می‌شود و بقیه دست‌نخورده می‌مانند', () => {
  const next = setTypeRule(S, 'MANUAL', { days: 90 })
  return next.types.MANUAL.days === 90 && next.types.EXCHANGE.days === S.types.EXCHANGE.days && S.types.MANUAL.days === 30
})
t('setTypeRule: فیلد نفرستاده‌شده حفظ می‌شود', () => {
  const next = setTypeRule(S, 'MANUAL', { multiUse: true })
  return next.types.MANUAL.multiUse === true && next.types.MANUAL.maxUses === S.types.MANUAL.maxUses
})
t('setTypeRule: مقدار بی‌معنا پاک می‌شود (دفعات هیچ‌وقت زیر ۱)', () => setTypeRule(S, 'MANUAL', { maxUses: -5 }).types.MANUAL.maxUses === 1)

const CANDS = [
  { should: true, credit: { id: 1 } },
  { should: false, credit: { id: 2 } },
  { should: true, credit: { id: 3 } }
]
t('reminderFilter: «فقط واجد شرایط» دو ردیف می‌دهد و شمارش‌ها درست است', () => {
  const r = reminderFilter(CANDS, true)
  return r.rows.length === 2 && r.eligible === 2 && r.total === 3 && r.hidden === 1
})
t('reminderFilter: خاموش‌بودن فیلتر، همه‌ی ردیف‌ها را با دلیلشان نگه می‌دارد', () => {
  const r = reminderFilter(CANDS, false)
  return r.rows.length === 3 && r.hidden === 0
})
t('reminderFilter: ورودی خراب ⇒ فهرست خالی، نه پرتاب خطا', () => reminderFilter(null as any, true).total === 0)

t('posPreviewPayload: بدون کد یا بدون سبد، هیچ درخواستی ساخته نمی‌شود', () =>
  posPreviewPayload({ code: '  ', payable: 100, requested: null, customerId: null, lines: [{ variantId: 1, qty: 1, lineTotal: 10 }] }) === null &&
  posPreviewPayload({ code: 'CR1', payable: 100, requested: null, customerId: null, lines: [] }) === null)
t('posPreviewPayload: شناسه‌ی مشتری و دسته‌بندی هر خط واقعاً فرستاده می‌شوند (باگ جلسه ۲۷)', () => {
  const p: any = posPreviewPayload({
    code: 'cr7',
    payable: 900,
    requested: 300,
    customerId: 12,
    lines: [{ variantId: 5, qty: 2, categoryId: 3, lineTotal: 600 }]
  })
  return p.customerId === 12 && p.lines[0].categoryId === 3 && p.lines[0].lineTotal === 600 && p.code === 'CR7'
})
t('posPreviewPayload: مبلغ منفی و خط بی‌واریانت پاک می‌شوند', () => {
  const p: any = posPreviewPayload({
    code: 'CR1',
    payable: -5,
    requested: null,
    customerId: null,
    lines: [
      { variantId: 0, qty: 1, lineTotal: 100 },
      { variantId: 4, qty: 1, lineTotal: -50 }
    ]
  })
  return p.lines.length === 1 && p.lines[0].lineTotal === 0 && p.applicable === 0 && p.invoiceTotal === 0
})

const LIST_ROW = { code: 'CR1', amount: 100, usedAmount: 40, remaining: 60, maxUses: 1, usedCount: 1 }
t('creditExport: گزارش خالی ⇒ null (فایل بی‌ردیف ساخته نمی‌شود)', () =>
  creditExport('list', []) === null &&
  creditExport('dashboard', null) === null &&
  creditExport('byStatus', { byStatus: [] }) === null &&
  creditExport('redemptions', []) === null &&
  creditExport('timeline', []) === null &&
  creditExport('reminders', []) === null &&
  creditExport('reminderLogs', []) === null &&
  creditExport('batches', []) === null)
t('creditExport: هر گزارش، سرستون درست خودش را می‌گیرد (جابه‌جایی ممکن نیست)', () => {
  const pairs: [string, any, string[]][] = [
    ['list', [LIST_ROW], CREDIT_LIST_HEADERS],
    ['dashboard', DASH, CREDIT_DASHBOARD_HEADERS],
    ['byStatus', DASH, CREDIT_BREAKDOWN_HEADERS],
    ['bySource', DASH, CREDIT_BREAKDOWN_HEADERS],
    ['redemptions', [{ seq: 1, amount: 40, remainderAfter: 60 }], CREDIT_REDEMPTION_HEADERS],
    ['timeline', [{ action: 'CREDIT_ISSUE' }], CREDIT_TIMELINE_HEADERS],
    ['reminders', [{ credit: { code: 'CR1' }, should: true }], CREDIT_REMINDER_HEADERS],
    ['reminderLogs', [{ code: 'CR1', kind: 'EXPIRY' }], CREDIT_REMINDER_LOG_HEADERS],
    ['batches', [{ id: 1, count: 3, amountEach: 100, totalAmount: 300 }], CREDIT_BATCH_HEADERS]
  ]
  return pairs.every(([kind, data, headers]) => {
    const sheet = creditExport(kind as any, data)
    return !!sheet && sheet.headers === headers && sheet.rows.every((r: any[]) => r.length === headers.length)
  })
})
t('creditExport: تفکیک وضعیت، ردیف جمع درست دارد', () => {
  const sheet: any = creditExport('byStatus', DASH)
  return sheet.rows.length === 2 && sheet.totals[1] === 7 && sheet.totals[2] === 1200 && sheet.totals[3] === 500 && sheet.totals[4] === 700
})
t('creditExport: جمع دفتر مصرف، هم‌طولِ سرستون است (اکسل کج نمی‌شود)', () => {
  const sheet: any = creditExport('redemptions', [{ seq: 1, amount: 40 }, { seq: 2, amount: 60 }])
  return sheet.totals.length === CREDIT_REDEMPTION_HEADERS.length && sheet.totals[3] === 100
})
t('creditExport: جمع دسته‌ها هم‌طول است و مبلغ کل را می‌شمارد', () => {
  const sheet: any = creditExport('batches', [{ id: 1, count: 2, amountEach: 50, totalAmount: 100 }])
  return sheet.totals.length === CREDIT_BATCH_HEADERS.length && sheet.totals[2] === 2 && sheet.totals[4] === 100
})
t('creditExport: نوع ناشناس ⇒ null', () => creditExport('whatever' as any, [1]) === null)

t('CREDIT_ALPHABET_OPTIONS و CREDIT_PAPER_OPTIONS: برچسب فارسی دارند', () =>
  CREDIT_ALPHABET_OPTIONS.length === 3 &&
  CREDIT_PAPER_OPTIONS.length === 6 &&
  CREDIT_ALPHABET_OPTIONS.every((o: any) => o.label && o.label !== o.value) &&
  CREDIT_PAPER_OPTIONS.every((o: any) => o.label && o.label !== o.value))

t('detailFactBlocks: بلوک محدودیت همیشه هست، بلوک گیرنده‌ی خالی نیست', () => {
  const blocks = detailFactBlocks({ credit: { restrictScope: 'ALL' } })
  const keys = blocks.map((b: any) => b.key)
  return keys.includes('restriction') && !keys.includes('holder')
})
t('detailFactBlocks: صادرکننده اول پیوندها می‌نشیند', () => {
  const blocks = detailFactBlocks({ credit: { sourceInvoiceId: 3 }, issuedByName: 'مدیر' })
  const links = blocks.find((b: any) => b.key === 'links')
  return links.facts[0].key === 'issuedBy' && links.facts[0].value === 'مدیر'
})
t('detailFactBlocks: گیرنده‌ی پرشده یک بلوک کامل می‌سازد', () => {
  const blocks = detailFactBlocks({ credit: CREDIT })
  const holder = blocks.find((b: any) => b.key === 'holder')
  return !!holder && holder.facts.length >= 6
})

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 28): ${pass} PASS · ${fail} FAIL`)
process.exit(fail ? 1 : 0)
