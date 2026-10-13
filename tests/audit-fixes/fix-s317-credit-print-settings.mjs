/**
 * نشست ۳۱۷ · طرح کلاد (برنده) — «تنظیمات چاپ سند اعتبار به سطح فاکتور/لیبل»:
 * کاغذ/ابعاد دستی + فونت + حاشیه + پیش‌نمایش + چاپ آزمایشی.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s317-credit-print-settings.mjs
 *
 * بخش اجرایی (بدون DB):
 *   • خروجی CSS با تنظیمات پیش‌فرض باید **بایت‌به‌بایت** همان رشته‌ی تاریخی
 *     باشد (golden گرفته‌شده از قالب قبل از این نشست — صفر رگرسیون)
 *   • creditLayout: جدول px برای فونت ۶/۸/۱۱/۱۴/۲۲ و clamp حاشیه بر اساس کاغذ
 *   • creditEffectivePerPage «هرگز بیشتر نمی‌شود» + parse clamp + describe
 *   • بنر «نمونه» روی سند آزمایشی
 * بخش ایستا:
 *   • همه‌ی سایت‌های چاپ اعتبار از creditRenderSpec واحد استفاده می‌کنند
 *   • مسیر آزمایشی هیچ DB-write/شمارنده/audit ندارد
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const golden = JSON.parse(read('tests/audit-fixes/golden/creditCss-legacy-s317.json'))

const { creditCss, creditDocHtml } = await import('../../src/main/print/templates.ts')
const {
  creditLayout,
  creditEffectivePerPage,
  creditBatchPerPage,
  CREDIT_PRINT_LEGACY_FONT_PX,
  CREDIT_PER_PAGE_MAX
} = await import('../../src/shared/creditPrint.ts')
const { parseCreditSettings, DEFAULT_CREDIT_SETTINGS, describeCreditSettings, CreditPaper } = await import(
  '../../src/shared/credit.ts'
)
const { creditRenderSpec, creditPerPageWith } = await import('../../src/main/print/creditSpec.ts')
const { creditPrintWarnings, CREDIT_FONT_SIZE_OPTIONS } = await import('../../src/shared/creditUi.ts')

const templates = read('src/main/print/templates.ts')
const printService = read('src/main/services/PrintService.ts')
const creditSpecSrc = read('src/main/print/creditSpec.ts')
const sampleCreditSrc = read('src/main/print/sampleCredit.ts')
const creditUiSrc = read('src/shared/creditUi.ts')
const creditFormsSrc = read('src/renderer/src/components/CreditForms.tsx')
const cardSrc = read('src/renderer/src/components/CreditPrintCard.tsx')
const ipcChannels = read('src/shared/ipc.ts')
const ipcHandlers = read('src/main/ipc/index.ts')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}
const eq = (a, b) => a === b
const round1 = (n) => Math.round(n * 10) / 10

// ===== ۱) خروجی پیش‌فرض بایت‌به‌بایت (صفر رگرسیون) ==========================
console.log('— خروجی تاریخی بایت‌به‌بایت')
const papers = { A4: [210, 297], A5: [148, 210], A6: [105, 148], T80: [80, null], T58: [58, null], CUSTOM: [100, 150] }
for (const [k, [w, h]] of Object.entries(papers))
  check(`legacy CSS «${k}» دقیقاً همان رشته‌ی قدیمی است (${golden[k].length} کاراکتر)`, eq(creditCss(w, h), golden[k]))
check('layout تاریخیِ صریح هم همان رشته‌ی قدیمی است', eq(creditCss(210, 297, creditLayout(DEFAULT_CREDIT_SETTINGS, { widthMm: 210, heightMm: 297 })), golden.A4))
check('creditRenderSpec پیش‌فرض: کاغذ A6 + layout تاریخی', (() => { const s = creditRenderSpec(DEFAULT_CREDIT_SETTINGS); return s.widthMm === 105 && s.heightMm === 148 && s.layout.isLegacy === true })())

// ===== ۲) ماتریس layout ==================================================
console.log('— creditLayout (فونت/ضریب/hاشیه)')
const lay11 = creditLayout({ printFontPx: 11, printMarginXMm: 4, printMarginYMm: 5 }, { widthMm: 105, heightMm: 148 })
check('فونت ۱۱: scale دقیقاً ۱ و نقش‌ها تاریخی', lay11.scale === 1 && lay11.px.h1 === 14 && lay11.px.kind === 12 && lay11.px.amount === 17 && lay11.px.code === 15 && lay11.px.rules === 9 && lay11.px.reprint === 10 && lay11.letterSpacingPx === 1.5)
check('فونت ۱۱: isLegacy', lay11.isLegacy === true)
const lay22 = creditLayout({ printFontPx: 22, printMarginXMm: 4, printMarginYMm: 5 }, { widthMm: 210, heightMm: 297 })
check('فونت ۲۲: scale=۲ و نقش‌ها دو برابر', lay22.scale === 2 && lay22.px.amount === 34 && lay22.px.code === 30 && lay22.letterSpacingPx === 3 && lay22.isLegacy === false)
const lay6 = creditLayout({ printFontPx: 6, printMarginXMm: 4, printMarginYMm: 5 }, { widthMm: 105, heightMm: 148 })
check('فونت ۶: نقش‌ها با ضریب ۶/۱۱ و گرد ۰٫۱', lay6.px.h1 === round1((14 * 6) / 11) && lay6.px.rules === round1((9 * 6) / 11) && lay6.letterSpacingPx === round1((1.5 * 6) / 11))
const layCl = creditLayout({}, { widthMm: 58, heightMm: null })
check('ورودی نامعتبر ⇒ پیش‌فرض‌ها', layCl.fontPx === CREDIT_PRINT_LEGACY_FONT_PX && layCl.marginXMm === 4 && layCl.marginYMm === 5)
check('fontPx بالای بازه ⇒ ۲۲ / پایین بازه ⇒ ۶', creditLayout({ printFontPx: 30 }, { widthMm: 210, heightMm: 297 }).fontPx === 22 && creditLayout({ printFontPx: 3 }, { widthMm: 210, heightMm: 297 }).fontPx === 6)
check('clamp دوم حاشیه روی T58: ۲۰ ⇒ ۱۴', creditLayout({ printMarginXMm: 20, printMarginYMm: 20 }, { widthMm: 58, heightMm: null }).marginXMm === 14)
check('T58 ارتفاع ندارد ⇒ حاشیه‌ی عمودی ۲۰ clamp نمی‌شود', creditLayout({ printMarginXMm: 20, printMarginYMm: 20 }, { widthMm: 58, heightMm: null }).marginYMm === 20)
check('CUSTOM ۱۰۰×۱۵۰ با ۲۰/۲۰ ⇒ بدون clamp', (() => { const l = creditLayout({ printMarginXMm: 20, printMarginYMm: 20 }, { widthMm: 100, heightMm: 150 }); return l.marginXMm === 20 && l.marginYMm === 20 })())
check('isLegacy حتی با کلیدهای مؤثرِ کلیدخورده اندازه‌ی پیش‌فرض: (۶ نمی‌شود ۱۱)', creditLayout({ printFontPx: 5 }, { widthMm: 210, heightMm: 297 }).isLegacy === false)

// ===== ۳) CSS حساب‌شده ======================================================
console.log('— creditCss با layout')
const css16 = creditCss(58, null, creditLayout({ printFontPx: 16, printMarginXMm: 2, printMarginYMm: 2 }, { widthMm: 58, heightMm: null }))
check('فونت/حاشیه‌ی درخواستی در CSS می‌نشیند', css16.includes('font-size:16px') && css16.includes('padding:2mm 2mm'))
check('نقش °amount درشت‌ترین است', css16.includes(`font-size:${round1((17 * 16) / 11)}px`))
check('@page برای T58 ارتفاع auto', css16.includes('@page { size: 58mm auto'))
check('CSS حساب‌شده با رشته‌ی تاریخی برابر نیست', css16 !== golden.T58)
check('box-sizing در شاخه‌ی حساب‌شده هست', css16.includes('box-sizing:border-box'))

// ===== ۴) perPage =========================================================
console.log('— creditEffectivePerPage')
const a4 = { widthMm: 210, heightMm: 297 }
const baseA4 = creditBatchPerPage(a4)
check('scale ≤ ۱ ⇒ هرگز بیشتر نمی‌شود', creditEffectivePerPage(baseA4, creditLayout({ printFontPx: 6 }, a4)) === baseA4)
check('scale = ۲ ⇒ کفِ نصف', creditEffectivePerPage(baseA4, creditLayout({ printFontPx: 22 }, a4)) === Math.max(1, Math.floor(baseA4 / 2)))
check('ورودی بی‌ربط ⇒ بازه‌ی امن [۱..MAX]', creditEffectivePerPage('abc', lay22) === 1 && creditEffectivePerPage(9999, lay11) === CREDIT_PER_PAGE_MAX)
check('creditPerPageWith روی پیش‌فرض با creditBatchPerPage فرق ندارد', creditPerPageWith(creditRenderSpec(DEFAULT_CREDIT_SETTINGS)) === creditBatchPerPage(creditRenderSpec(DEFAULT_CREDIT_SETTINGS)))
check('creditPerPageWith + فونت ۲۲ روی A4 ⇒ کمتر', (() => { const a4Def = { ...DEFAULT_CREDIT_SETTINGS, paper: CreditPaper.A4 }; return creditPerPageWith(creditRenderSpec({ ...a4Def, printFontPx: 22 })) < creditPerPageWith(creditRenderSpec(a4Def)) })())
check('روی کفِ ۱ (رول حرارتی) فونت ۲۲ هرگز صفر نمی‌شود', (() => { const heat = { ...DEFAULT_CREDIT_SETTINGS, paper: CreditPaper.T58, printFontPx: 22 }; return creditPerPageWith(creditRenderSpec(heat)) === 1 })())

// ===== ۵) parse / describe ================================================
console.log('— parseCreditSettings و describeCreditSettings')
const p30 = parseCreditSettings({ ...DEFAULT_CREDIT_SETTINGS, printFontPx: 30, printMarginXMm: -3, printMarginYMm: 99 })
check('parse clamp: ۳۰⇒۲۲ / -۳⇒۰ / ۹۹⇒۲۰', p30.printFontPx === 22 && p30.printMarginXMm === 0 && p30.printMarginYMm === 20)
const pNaN = parseCreditSettings({ ...DEFAULT_CREDIT_SETTINGS, printFontPx: 'حرف' })
check('parse NaN ⇒ ۱۱', pNaN.printFontPx === 11)
check('تنظیمات قدیمی (بدون فیلد) ⇒ پیش‌فرض ۱۱/۴/۵', (() => { const s = parseCreditSettings({}); return s.printFontPx === 11 && s.printMarginXMm === 4 && s.printMarginYMm === 5 })())
const dDefault = describeCreditSettings(DEFAULT_CREDIT_SETTINGS)
check('describe پیش‌فرض بدون عبارت «چاپ سند»', !dDefault.includes('چاپ سند'))
const dMod = describeCreditSettings({ ...DEFAULT_CREDIT_SETTINGS, printFontPx: 14 })
check('describe تغییریافته با عبارت «فونت 14px»', dMod.includes('چاپ سند') && dMod.includes('فونت 14px') && dMod.includes('حاشیه 4×5mm'))

// ===== ۶) بنر نمونه =======================================================
console.log('— بنر «نمونه»')
const sampleDoc = {
  code: 'SMPL-1404', amount: 1, usedAmount: 0, remaining: 1, sourceLabel: 'نمونه', statusLabel: 'فعال',
  issuedJalali: '1404/01/01', issuedTime: '10:00', expiresJalali: '1404/02/01',
  usesLabel: 'یک‌بارمصرف', maxUses: 1, usedCount: 0, restrictLabel: null, minPurchase: 0, maxPerTransaction: 0,
  holderName: null, holderCompany: null, holderPhone: null, holderAgent: null, holderAddress: null, holderNationalId: null,
  barcodeDataUrl: null, shopName: 'فروشگاه', rulesText: 'قانون', showRules: true, showHolder: false, showRemaining: false,
  reprint: false, printCount: 1, sample: true, linkedReceiptNo: null, issueLines: null, note: null, footer: null
}
const sampleHtml = creditDocHtml(sampleDoc)
check('بنر نمونه رندر می‌شود', sampleHtml.includes('نمونه — این برگه هیچ ارزش خریدی ندارد'))
check('بدون sample بنر نیست', !creditDocHtml({ ...sampleDoc, sample: false }).includes('ارزش خریدی ندارد'))
check('پیش‌نمایش پیش‌فرض CSS تاریخی (A6) را دارد', sampleHtml.includes(golden.A6))

// ===== ۷) هشدارهای UI =====================================================
console.log('— creditPrintWarnings')
check('پیش‌فرض بدون هشدار', creditPrintWarnings(DEFAULT_CREDIT_SETTINGS).length === 0)
check('T58 + فونت ۱۴ ⇒ هشدار کاغذ باریک', creditPrintWarnings({ ...DEFAULT_CREDIT_SETTINGS, paper: CreditPaper.T58, printFontPx: 14 }).some((w) => w.includes('کاغذ باریک')))
check('T58 + حاشیه ۱۰ ⇒ هشدار حاشیه پهن', creditPrintWarnings({ ...DEFAULT_CREDIT_SETTINGS, paper: CreditPaper.T58, printMarginXMm: 10 }).some((w) => w.includes('حاشیه')))
check('فونت ۸ ⇒ هشدار خوانایی', creditPrintWarnings({ ...DEFAULT_CREDIT_SETTINGS, printFontPx: 8 }).some((w) => w.includes('فونت ریز')))
check('گزینه‌ی پیش‌فرض ۱۱ در لیست فونت‌هاست', CREDIT_FONT_SIZE_OPTIONS.some((o) => o.value === '11'))

// ===== ۸) گاردهای ایستا ===================================================
console.log('— گاردهای ایستا (وایرینگ و ایمنی مسیر آزمایشی)')
check('creditSpec: مشخصات واحد کاغذ+layout', /export function creditRenderSpec/.test(creditSpecSrc) && /creditLayout\(settings, paper\)/.test(creditSpecSrc))
check('creditSpec: perPage با گارد layout', /creditEffectivePerPage\(creditBatchPerPage/.test(creditSpecSrc))
check('PrintService: creditPaperSize مستقیم حذف شده', !/creditPaperSize\(/.test(printService))
check('PrintService: چهار سایت از creditRenderSpec', (printService.match(/creditRenderSpec\(settings\)/g) ?? []).length >= 4)
check('PrintService: batch از creditPerPageWith', /const perPage = creditPerPageWith\(paper, input\?\.perPage\)/.test(printService))
check('templates: شاخه‌ی دوتایی (تاریخی/حساب‌شده) + export creditCss', /export const creditCss/.test(templates) && /if \(layout && !layout\.isLegacy\) return creditCssFromLayout/.test(templates))
check('templates: لیتوال تاریخی دست‌نخورده (padding/fon-size)', templates.includes('padding:5mm 4mm; font-size:11px;'))
check('templates: بنر نمونه + فیلد sample', /if \(d\.sample\) parts\.push/.test(templates) && /sample\?: boolean/.test(templates))
check('sampleCredit: بدون storeCreditService./markPrinted/creditCopyPlan (در کد؛ نه کامنت)', !/storeCreditService\.|markPrinted|creditCopyPlan/.test(sampleCreditSrc.replace(/\/\*[\s\S]*?\*\//g, '')))
check('sampleCredit: تنظیمات ذخیره‌شده + resolvePrintTargetName + silent بازیابی', /await readCreditSettings\(\)/.test(sampleCreditSrc) && /resolvePrintTargetName/.test(sampleCreditSrc) && /silent/.test(sampleCreditSrc))
check('sampleCredit: کد نمونه خارج از الفبای تولید (خط‌تیره)', sampleCreditSrc.includes("'SMPL-1404'"))
check('ipc: دو کانال آزمایشی تعریف و سپر haveCredit', /creditSampleHtml: 'credit:sampleHtml'/.test(ipcChannels) && /creditSamplePrint: 'credit:samplePrint'/.test(ipcChannels) && /handle\(IPC\.creditSampleHtml/.test(ipcHandlers) && /handle\(IPC\.creditSamplePrint/.test(ipcHandlers))
check('creditUi: گزینه‌های فونت + هشدارها', /export const CREDIT_FONT_SIZE_OPTIONS/.test(creditUiSrc) && /export function creditPrintWarnings/.test(creditUiSrc))
check('کارت نصب شد و iframe sandbox دارد', /<CreditPrintCard settings=\{settings\} set=\{set\} \/>/.test(creditFormsSrc) && /sandbox=""/.test(cardSrc))
check('کارت: پیش‌نمایش پیش‌نویس / چاپ آزمایشی کانال ذخیره‌شده', /CH\.creditSampleHtml/.test(cardSrc) && /CH\.creditSamplePrint/.test(cardSrc))

console.log(`\nنتیجه: ${ok} قبول، ${bad} رد`)
if (bad > 0) process.exit(1)
