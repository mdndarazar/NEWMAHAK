/**
 * سوییت منطق خالصِ لایه‌ی نمایش ماژول اعتبار (جلسه ۲۲) — بدون node_modules،
 * بدون دیتابیس، بدون React. هدفش این است که «تصمیم»های فرم‌ها واقعاً اجرا و
 * سنجیده شوند، نه این‌که فقط داخل JSX پنهان بمانند.
 * اجرا: node --experimental-strip-types test/credit-ui-logic-session22.ts
 */
/**
 * ⚠️ چرا import پویا و نه ساده؟ `src/shared/creditUi.ts` مثل بقیه‌ی فایل‌های
 * پروژه با مسیرِ بی‌پسوند (`./credit`) import می‌کند — قرارداد باندلر پروژه.
 * اجرای مستقیم با node ESM پسوند می‌خواهد، پس دو فایل را با پسوندِ اصلاح‌شده
 * در یک پوشه‌ی موقت کپی و همان‌ها را اجرا می‌کنیم. **سورس اصلی دست‌نخورده
 * می‌ماند** و همان کدِ واقعی تست می‌شود، نه یک نسخه‌ی بازنویسی‌شده.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-'))
fs.writeFileSync(path.join(tmp, 'credit.ts'), fs.readFileSync('src/shared/credit.ts'))
fs.writeFileSync(
  path.join(tmp, 'creditUi.ts'),
  fs.readFileSync('src/shared/creditUi.ts', 'utf8').replace(/from '\.\/credit'/g, "from './credit.ts'")
)
const ui: any = await import(path.join(tmp, 'creditUi.ts'))
const rules: any = await import(path.join(tmp, 'credit.ts'))

const {
  EMPTY_BULK_DRAFT, EMPTY_ISSUE_DRAFT, buildBulkPayload, buildIssuePayload, buildOpPayload, cleanIds,
  creditListRow, CREDIT_LIST_HEADERS, CreditOp, dashboardCards, emptyOpDraft, newIdempotencyKey,
  posCreditPlan, previewCodeSpace, settingsWarnings, statusTone, usesOf
} = ui
const { DEFAULT_CREDIT_SETTINGS, CreditRestrictScope, CreditStatus } = rules

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
const S: any = DEFAULT_CREDIT_SETTINGS

// ---- صدور تکی ----
t('مبلغ صفر رد می‌شود', () => buildIssuePayload({ ...EMPTY_ISSUE_DRAFT }, S).ok === false)
t('صدور ساده با پیش‌فرض نوع، بدون دلیل استثنا قبول می‌شود', () => {
  const r = buildIssuePayload({ ...EMPTY_ISSUE_DRAFT, amount: 500000 }, S)
  return r.ok === true && r.override === false && !('days' in (r.payload ?? {}))
})
t('خروج از پیش‌فرض بدون «دلیل استثنا» رد می‌شود', () =>
  buildIssuePayload({ ...EMPTY_ISSUE_DRAFT, amount: 100, usesMode: 'count', maxUses: 3 }, S).ok === false)
t('خروج از پیش‌فرض با دلیل، override و maxUses درست می‌دهد', () => {
  const r = buildIssuePayload(
    { ...EMPTY_ISSUE_DRAFT, amount: 100, usesMode: 'count', maxUses: 3, overrideReason: 'قرارداد شرکت الف' },
    S
  )
  return r.ok === true && r.override === true && (r.payload as any).maxUses === 3 && (r.payload as any).multiUse === true
})
t('«چندباره تا پایان مبلغ» دفعات نمی‌خواهد (maxUses=1 + multiUse)', () => {
  const u = usesOf({ usesMode: 'unlimited', maxUses: 1 })
  return u.maxUses === 1 && u.multiUse === true
})
t('محدودیت دسته بدون انتخاب دسته رد می‌شود', () =>
  buildIssuePayload(
    { ...EMPTY_ISSUE_DRAFT, amount: 100, restrictScope: CreditRestrictScope.CATEGORY, overrideReason: 'x1' },
    S
  ).ok === false)
t('محدودیت کالا بدون انتخاب کالا رد می‌شود', () =>
  buildIssuePayload(
    { ...EMPTY_ISSUE_DRAFT, amount: 100, restrictScope: CreditRestrictScope.VARIANTS, overrideReason: 'x1' },
    S
  ).ok === false)
t('«بدون انقضا» صریح، days=null می‌فرستد', () => {
  const r = buildIssuePayload({ ...EMPTY_ISSUE_DRAFT, amount: 100, expiryMode: 'none', overrideReason: 'بدون مهلت' }, S)
  return r.ok === true && (r.payload as any).days === null
})
t('قفل مشتری بدون مشتری = هشدار، نه دیوار', () => {
  const r = buildIssuePayload(
    { ...EMPTY_ISSUE_DRAFT, amount: 100, customerLocked: true, overrideReason: 'قفل مشتری' },
    S
  )
  return r.ok === true && r.warnings.length > 0
})

// ---- تولید گروهی ----
t('تعداد بیشتر از سقف تنظیمات رد می‌شود', () =>
  buildBulkPayload({ ...EMPTY_BULK_DRAFT, amount: 100, count: S.bulkMaxCount + 1 }, S).ok === false)
t('تولید گروهی معتبر، count و amountEach درست می‌دهد', () => {
  const r = buildBulkPayload({ ...EMPTY_BULK_DRAFT, amount: 250000, count: 50, title: 'جشنواره' }, S)
  return r.ok === true && (r.payload as any).count === 50 && (r.payload as any).amountEach === 250000
})
t('فضای کد ناکافی (۶۰۰۰۰ کد، طول ۶، فقط عدد) پیش از ارسال جلویش گرفته می‌شود', () => {
  const s = { ...S, codeAlphabet: 'NUM', codeLength: 6, autoGrowLength: false, excludeSimilar: false }
  return previewCodeSpace(60000, s, 0, '').ok === false
})
t('همان درخواست با «افزایش خودکار طول» قبول و طولش بزرگ‌تر می‌شود', () => {
  const s = { ...S, codeAlphabet: 'NUM', codeLength: 6, autoGrowLength: true, excludeSimilar: false }
  const r = previewCodeSpace(60000, s, 0, '')
  return r.ok === true && r.length > 6
})

// ---- عملیات مدیریتی ----
t('عملیات بدون رمز مدیر رد می‌شود', () =>
  buildOpPayload({ ...emptyOpDraft(CreditOp.VOID, 7), reason: 'سند اشتباه' }, {}).ok === false)
t('عملیات بدون دلیل رد می‌شود', () =>
  buildOpPayload({ ...emptyOpDraft(CreditOp.VOID, 7), managerPassword: '1111' }, {}).ok === false)
t('ابطال با رمز و دلیل، payload کامل می‌دهد', () => {
  const r = buildOpPayload({ ...emptyOpDraft(CreditOp.VOID, 7), managerPassword: '1111', reason: 'سند اشتباه' }, {})
  return r.ok === true && (r.payload as any).id === 7 && (r.payload as any).reason === 'سند اشتباه'
})
t('تغییر مبلغ روی اعتبار مصرف‌شده ممنوع است', () =>
  buildOpPayload(
    { ...emptyOpDraft(CreditOp.AMOUNT, 7), managerPassword: '1111', reason: 'اصلاح', amount: 500 },
    { usedAmount: 200, usedCount: 1 }
  ).ok === false)
t('تغییر مبلغ روی اعتبار بدون مصرف مجاز است', () =>
  buildOpPayload(
    { ...emptyOpDraft(CreditOp.AMOUNT, 7), managerPassword: '1111', reason: 'اصلاح', amount: 500 },
    { usedAmount: 0, usedCount: 0 }
  ).ok === true)
t('فعال‌سازی اعتبار منقضی بدون تمدید تاریخ رد می‌شود', () =>
  buildOpPayload(
    { ...emptyOpDraft(CreditOp.REACTIVATE, 7), managerPassword: '1111', reason: 'تمدید', extendDays: 0 },
    { status: CreditStatus.EXPIRED, expired: true }
  ).ok === false)
t('کم کردن سقف دفعات به کمتر از دفعات مصرف‌شده رد می‌شود', () =>
  buildOpPayload(
    { ...emptyOpDraft(CreditOp.USES, 7), managerPassword: '1111', reason: 'اصلاح', usesMode: 'count', maxUses: 2 },
    { usedCount: 4 }
  ).ok === false)
t('حذف اعتبار مصرف‌شده هشدار «آرشیو» می‌دهد، نه حذف واقعی', () => {
  const r = buildOpPayload(
    { ...emptyOpDraft(CreditOp.DELETE, 7), managerPassword: '1111', reason: 'تکراری' },
    { usedAmount: 100, usedCount: 1 }
  )
  return r.ok === true && r.warnings.some((w: string) => w.includes('آرشیو'))
})

// ---- پنل فروش: پرداخت ترکیبی ----
t('بدون پیش‌نمایش، کل مبلغ نقد است', () => {
  const p = posCreditPlan({ payable: 1000, preview: null, requestedInput: null })
  return p.applied === 0 && p.cashDue === 1000 && p.requested === null
})
t('حداکثر ممکن ⇒ requested=null و نقد کم می‌شود', () => {
  const p = posCreditPlan({
    payable: 1000,
    preview: { ok: true, applied: 400, error: null, notes: [], eligibleVariantIds: [1], excludedVariantIds: [] },
    requestedInput: null
  })
  return p.applied === 400 && p.cashDue === 600 && p.requested === null
})
t('پرداخت ترکیبی: مبلغ درخواستی کمتر، عیناً اعمال می‌شود', () => {
  const p = posCreditPlan({
    payable: 1000,
    preview: { ok: true, applied: 400, error: null, notes: [], eligibleVariantIds: [], excludedVariantIds: [] },
    requestedInput: 150
  })
  return p.applied === 150 && p.cashDue === 850 && p.requested === 150
})
t('مبلغ درخواستی بیشتر از سقف، کوتاه می‌شود و *گفته* می‌شود', () => {
  const p = posCreditPlan({
    payable: 1000,
    preview: { ok: true, applied: 400, error: null, notes: [], eligibleVariantIds: [], excludedVariantIds: [] },
    requestedInput: 900
  })
  return p.applied === 400 && p.notes.some((n: string) => n.includes('کوتاه شد'))
})
t('پیش‌نمایش ناموفق ⇒ اعتبار صفر و خطا حفظ می‌شود', () => {
  const p = posCreditPlan({
    payable: 1000,
    preview: { ok: false, applied: 0, error: 'باطل شده', notes: [], eligibleVariantIds: [], excludedVariantIds: [9] },
    requestedInput: 500
  })
  return p.applied === 0 && p.error === 'باطل شده' && p.excludedVariantIds[0] === 9
})

// ---- ریزه‌کاری‌ها ----
t('کلید Idempotency هر بار تازه است', () => newIdempotencyKey() !== newIdempotencyKey())
t('cleanIds تکراری/منفی/خراب را می‌اندازد', () => {
  const r = cleanIds([3, 3, -1, 0, 'x', 2])
  return r.length === 2 && r[0] === 2 && r[1] === 3
})
t('سرستون‌ها و ردیف اکسل هم‌طول‌اند', () => creditListRow({ code: 'CR1' }).length === CREDIT_LIST_HEADERS.length)
t('کارت تعهد فقط وقتی گزارش تعهد روشن است می‌آید', () => {
  const base: any = {
    issuedCount: 1, issuedTotal: 10, usedTotal: 2, remainingTotal: 8, activeCount: 1, activeValue: 8,
    unusedCount: 1, fullyUsedCount: 0, expiredCount: 0, canceledCount: 0, suspendedCount: 0, draftCount: 0,
    nearExpiryCount: 0, todayCount: 1, liability: 8
  }
  const on = dashboardCards({ ...base, liabilityReported: true }).some((c: any) => c.key === 'liability')
  const off = dashboardCards({ ...base, liabilityReported: false }).some((c: any) => c.key === 'liability')
  return on === true && off === false
})
t('رنگ وضعیت: فعال=good · باطل=bad · مصرف‌شده=muted', () =>
  statusTone(CreditStatus.ACTIVE) === 'good' && statusTone(CreditStatus.CANCELED) === 'bad' && statusTone(CreditStatus.USED) === 'muted')
t('هشدار تنظیمات: سقف گروهی غیرقابل تولید، دیده می‌شود', () =>
  settingsWarnings({ ...S, codeAlphabet: 'NUM', codeLength: 6, autoGrowLength: false, excludeSimilar: false, bulkMaxCount: 5000 }).length > 0)

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 22): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
