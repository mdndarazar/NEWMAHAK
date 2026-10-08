// نشست ۱۸۲: تست قبل/بعد سه مورد بحرانیِ بازبینی مستقل (بندهای ۴-۱، ۴-۱۵/۴-۲۲، ۴-۲۸ الف).
/**
 * ===========================================================================
 * نشست ۱۸۲ — سه موردی که بازبینی مستقل «بحرانی» علامت زد
 *
 * ۱) فروش بدون نشست بازِ کارمند انجام می‌شد (نقض ۴-۱).
 * ۲) ویرایش برگشتِ تسویه‌شده بدون رمز، و بازپرداخت دست‌نخورده می‌ماند
 *    (نقض ۴-۱۵ و ۴-۲۲ — مسیر مستقیم دزدی).
 * ۳) مهاجرت BigInt رابط کاربری را می‌شکست: ردیف خام Prisma از IPC رد می‌شد و
 *    اولین محاسبه در renderer با «Cannot mix BigInt» کل صفحه را می‌انداخت.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s182-critical-three.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s182-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

let pass = 0
let fail = 0
const show = (v) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v))
const eq = (label, got, want) => {
  if (show(got) === show(want)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${show(got)} · انتظار ${show(want)}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)

const IPC = readFileSync('src/main/ipc/index.ts', 'utf-8')
const SALES = readFileSync('src/main/services/SalesService.ts', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۱) بند ۴-۱: فروش نشست بازِ کارمند لازم دارد —')
/**
 * `withOptionalSessionActor` نبودِ نشست را رد نمی‌کند و `userId` را null
 * می‌گذارد؛ بعد `ensureCurrent()` یک نشست AUTO بدون کارمند می‌سازد و فروش
 * ثبت می‌شود. برگشت و تعویض از قبل `withSessionActor` داشتند.
 */
ok('saleCreate دیگر withOptionalSessionActor نیست',
  !/IPC\.saleCreate[^\n]*withOptionalSessionActor/.test(IPC))
ok('saleUpdate هم همین‌طور',
  !/IPC\.saleUpdate[^\n]*withOptionalSessionActor/.test(IPC))
ok('saleCreate از withSessionActor استفاده می‌کند',
  /IPC\.saleCreate[^\n]*withSessionActor\(p \?\? \{\}, 'ثبت فاکتور فروش'\)/.test(IPC))
ok('saleUpdate از withSessionActor استفاده می‌کند',
  /IPC\.saleUpdate[^\n]*withSessionActor\(p \?\? \{\}, 'ویرایش فاکتور فروش'\)/.test(IPC))
{
  // و خودِ withSessionActor واقعاً throw می‌کند (نه اینکه فقط نام مشابه باشد)
  const body = IPC.slice(IPC.indexOf('async function withSessionActor'), IPC.indexOf('async function withOptionalSessionActor'))
  // نشست ۳۰۷: قرارداد تقویت شد — BusinessError با code=SESSION_REQUIRED و پیام وضعیت‌محور (قفل runtime در s307)
  ok("withSessionActor در نبودِ نشست خطا می‌دهد", /actorId != null[\s\S]*throw new BusinessError\(message, 'SESSION_REQUIRED'\)/.test(body))
}
{
  // برگشت و تعویض نباید عقب‌گرد کرده باشند
  ok('ثبت برگشت هنوز گیت نشست دارد', /IPC\.saleReturn,[^\n]*withSessionActor/.test(IPC))
  ok('ویرایش برگشت هم گیت نشست دارد', /IPC\.saleReturnUpdate,[^\n]*withSessionActor/.test(IPC))
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) بند ۴-۱۵/۴-۲۲: ویرایش برگشتِ تسویه‌شده —')
{
  // برش از خودِ تعریف تابع (نه از اولین اشاره‌ی متنی در یک کامنت)
  const start = SALES.indexOf('async returnUpdate(input: UpdateReturnInput)')
  const fn = SALES.slice(start, start + 22000)
  ok('تابع returnUpdate پیدا شد', start > 0)
  ok('اثرهای مالی وابسته خوانده می‌شوند (اعتبار)', /storeCredit\.findFirst\(\{\s*\n?\s*where: \{ returnId: ret\.id/.test(fn))
  ok('اثرهای مالی وابسته خوانده می‌شوند (کارت‌به‌کارت)', /cardTransferRequest\.findFirst\(\{\s*\n?\s*where: \{ returnId: ret\.id/.test(fn))
  ok('بازپرداخت انجام‌شده خوانده می‌شود', /toNumberRial\(ret\.refundAmount/.test(SALES) && /refundedAmount/.test(fn))
  ok('وجود اثر مالی تشخیص داده می‌شود', /hasMoneyEffect/.test(fn) && /returnUpdateFinancialGate/.test(SALES))
  ok('بدون «دلیل» رد می‌شود', /باید «دلیل» بنویسید/.test(fn))
  ok('رمز مدیر خواسته می‌شود', /assertPanelPassword\(\s*\n?\s*PANEL_KEYS\.salesReturn/.test(fn))
  ok('ارزش جدید هرگز کمتر از بازپرداخت نمی‌شود', /hasMoneyEffect && total < refundedAmount/.test(fn))
  ok('و پیام، کاربر را به مسیر درست (ابطال) هدایت می‌کند', /اول همین سند را «باطل» کنید/.test(fn))

  /**
   * ترتیب حیاتی: گیت باید **قبل از** نوشتن انجام شود، وگرنه یک تلاش ناموفق هم
   * ردیف‌های برگشت را پاک کرده است.
   */
  const iGate = fn.indexOf('assertPanelPassword(')
  const iTx = fn.indexOf('prisma.$transaction')
  const iDelete = fn.indexOf('saleReturnItem.deleteMany')
  const iUpdate = fn.indexOf('saleReturn.update(')
  ok('گیت قبل از حذف ردیف‌های قبلی است', iGate > 0 && iGate < iDelete)
  ok('گیت قبل از به‌روزرسانی سند است', iGate > 0 && iGate < iUpdate)
  ok('گیت قبل از باز شدن تراکنش است', iGate > 0 && iTx > 0 && iGate < iTx)
  ok('داخل تراکنش دوباره رمز نمی‌سنجد', !(fn.slice(Math.max(0, iTx)).includes('assertPanelPassword(')))
  ok('بررسی مبلغ هم قبل از نوشتن است', fn.indexOf('total < refundedAmount') < iDelete)
}

// ---------------------------------------------------------------------------
console.log('\n— ۳) بند ۴-۲۸ الف: هیچ BigInt ای به رابط کاربری نمی‌رسد —')
ok('گلوگاه IPC تبدیل می‌کند', /return \{ ok: true, data: stripBigInts\(await fn\(payload\), channel\) \}/.test(IPC))
ok('و فقط یک گلوگاه وجود دارد', (IPC.match(/ipcMain\.handle\(/g) || []).length === 1)

{
  const { stripBigInts } = await import('../../src/shared/money.ts')

  // ساده
  eq('bigint تکی به number', stripBigInts(5n), 5)
  eq('آبجکت تودرتو', JSON.stringify(stripBigInts({ a: { b: [1n, 2n] } })), '{"a":{"b":[1,2]}}')
  eq('null و undefined دست‌نخورده', JSON.stringify(stripBigInts({ a: null })), '{"a":null}')

  // بدون رگرسیون: داده‌ی بدون bigint باید **همان مرجع** برگردد (بدون کپی بی‌مورد)
  {
    const src = { a: 1, b: 'x', c: [1, 2, { d: true }] }
    ok('داده‌ی بدون BigInt همان مرجع قبلی است (بدون کپی)', stripBigInts(src) === src)
  }

  // Date نباید مثله شود
  {
    const d = new Date('2026-01-01T00:00:00Z')
    const out = stripBigInts({ at: d, v: 1n })
    ok('Date دست‌نخورده می‌ماند', out.at instanceof Date && out.at.getTime() === d.getTime())
    eq('و مقدار کنارش تبدیل شده', out.v, 1)
  }

  /**
   * 🔴 مهم‌ترین بررسی این بخش: الگوی `PagedRows` این پروژه یک **آرایه با
   * پراپرتی اضافه** است (`Object.assign(rows, { page, warnings })`). اگر مبدل
   * فقط اندیس‌ها را کپی کند، صفحه‌بندی و هشدار «نتیجه بریده شد» بی‌صدا ناپدید
   * می‌شوند — همان «سقف بی‌صدا»یی که خوشه G برای رفعش ساخته شد.
   */
  {
    const rows = Object.assign([{ total: 10n }, { total: 20n }], {
      page: { skip: 0, take: 50, totalCount: 120, truncated: true },
      warnings: ['نتیجه بریده شد']
    })
    const out = stripBigInts(rows)
    ok('آرایه آرایه می‌ماند', Array.isArray(out))
    eq('مقادیر تبدیل شدند', JSON.stringify(out.map((r) => r.total)), '[10,20]')
    eq('پراپرتی page حفظ شد', out.page?.totalCount, 120)
    eq('پرچم truncated حفظ شد', out.page?.truncated, true)
    eq('هشدارها حفظ شدند', JSON.stringify(out.warnings), '["نتیجه بریده شد"]')
  }

  // خارج از محدوده‌ی امن: خطا، نه عدد غلط
  {
    let msg = null
    try { stripBigInts({ grandTotal: 9007199254740993n }, 'گزارش') } catch (e) { msg = String(e.message) }
    ok(`مبلغ خارج از محدوده خطا می‌دهد (${String(msg).slice(0, 48)}…)`, msg && /محدوده‌ی امن/.test(msg))
    ok('و مسیرِ دقیقِ فیلد را می‌گوید', msg && msg.includes('grandTotal'))
  }

  // حلقه‌ی ارجاعی نباید بی‌نهایت شود
  {
    const a = { v: 1n }
    a.self = a
    let threw = null
    try { const o = stripBigInts(a); eq('حلقه‌ی ارجاعی: مقدار تبدیل شد', o.v, 1) } catch (e) { threw = e.message }
    ok('و بی‌نهایت بازگشت نکرد', threw === null)
  }
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) مسیر واقعی: خروجی خام سرویس دیگر BigInt ندارد —')
{
  const electron = await import('electron')
  const handlers = new Map()
  electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

  const { prisma } = await import('../../src/main/db/client.ts')
  const { makeSeeder } = await import('../../test/harness/seed.mjs')
  const seed = makeSeeder(prisma)

  const invoiceId = seed.insert('SaleInvoice', {
    receiptNo: 7001,
    status: 'FINAL',
    grandTotal: 1_500_000,
    paidTotal: 1_500_000,
    goodsTotal: 1_500_000,
    issuedAtJalali: '۱۴۰۴/۰۷/۰۵'
  })

  const raw = await prisma.saleInvoice.findUnique({ where: { id: invoiceId } })
  const { stripBigInts } = await import('../../src/shared/money.ts')
  const clean = stripBigInts(raw, 'saleInvoice')

  /** هر مقدار bigint باقی‌مانده در خروجی، یعنی یک صفحه‌ی خراب در رابط کاربری. */
  const leftovers = []
  const scan = (v, p) => {
    if (typeof v === 'bigint') return leftovers.push(p)
    if (v && typeof v === 'object' && !(v instanceof Date))
      for (const [k, x] of Object.entries(v)) scan(x, `${p}.${k}`)
  }
  scan(clean, 'inv')
  eq(`هیچ BigInt ای در خروجی نماند${leftovers.length ? ` (${leftovers.join(', ')})` : ''}`, leftovers.length, 0)

  // و همان محاسبه‌ای که در renderer می‌شکست، حالا کار می‌کند
  let calcErr = null
  try { const x = clean.grandTotal + clean.paidTotal; eq('جمع مثل کد رندرر کار می‌کند', x, 3_000_000) } catch (e) { calcErr = e.message }
  ok('و «Cannot mix BigInt» نمی‌دهد', calcErr === null)
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
