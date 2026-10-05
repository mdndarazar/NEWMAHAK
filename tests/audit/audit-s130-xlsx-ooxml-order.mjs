/**
 * ممیزی نشست ۱۳۰ (S130-2) — ترتیب عناصر OOXML در xlsx خروجی.
 * fix-s130 فقط وجود رشته‌ها را می‌سنجید. طرح‌واره‌ی CT_Worksheet (ECMA-376 بخش ۱، ۱۸.۳.۱.۹۹) دنباله‌ی
 * ترتیبی است و sheetPr باید اولین فرزند worksheet باشد؛ Excel فایل با ترتیب غلط را «محتوای ناخوانا» می‌داند
 * و پیشنهاد تعمیر می‌دهد (خروجی مالی بی‌اعتبار). این تست ترتیب فرزندان worksheet و workbook را با دنباله‌ی
 * طرح‌واره می‌سنجد، و Print_Titles/fitToPage/ارتفاع آزاد و ماندن همه‌ی ردیف‌ها را هم.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const { buildXlsx } = await import(join(root, 'src/main/services/xlsx.ts'))
const WS_SEQ = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
const WB_SEQ = ['fileVersion', 'fileSharing', 'workbookPr', 'workbookProtection', 'bookViews', 'sheets', 'functionGroups', 'externalReferences', 'definedNames', 'calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']
/** نام فرزندان مستقیم ریشه (با شمارش عمق، نه regex سطحی). */
function topChildren(xml, rootTag) {
  const body = xml.slice(xml.indexOf(`<${rootTag}`)); const names = []; let depth = 0
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m
    if (close) { depth--; continue }
    if (depth === 1) names.push(name)
    if (!self) depth++
  }
  return names
}
const inOrder = (names, seq) => { let last = -1; for (const n of names) { const i = seq.indexOf(n); if (i < 0 || i < last) return `${n} خارج از ترتیب` ; last = i } return 'ok' }
const dir = mkdtempSync(join(tmpdir(), 'mahak-a130-'))
try {
  for (const [label, input, rep] of [
    ['با عنوان', { name: "گزارش's/تعویض", title: 'گزارش تعویض', headers: ['فیش', 'مبلغ'], rows: Array.from({ length: 120 }, (_, i) => [`F-${i + 1}`, 1000 * (i + 1)]), totals: ['جمع', 7_260_000] }, 3],
    ['بدون عنوان', { name: 'فروش', headers: ['فیش', 'مبلغ'], rows: [['A', 1]] }, 1]
  ]) {
    const file = join(dir, `${rep}.xlsx`)
    writeFileSync(file, buildXlsx(input))
    const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
    const wb = execFileSync('unzip', ['-p', file, 'xl/workbook.xml'], { encoding: 'utf8' })
    const ws = topChildren(sheet, 'worksheet')
    eq(`${label}: فرزندان worksheet به ترتیب طرح‌واره (sheetPr اول)`, [inOrder(ws, WS_SEQ), ws[0]], ['ok', 'sheetPr'])
    eq(`${label}: فرزندان workbook به ترتیب طرح‌واره`, inOrder(topChildren(wb, 'workbook'), WB_SEQ), 'ok')
    eq(`${label}: Print_Titles ردیف ۱ تا ${rep} (عنوان + فاصله + سرستون)`, new RegExp(`!\\$1:\\$${rep}<`).test(wb), true)
    eq(`${label}: fitToPage + عرض یک صفحه + ارتفاع آزاد`, /<pageSetUpPr fitToPage="1"\/>/.test(sheet) && /fitToWidth="1" fitToHeight="0"/.test(sheet), true)
    const rowsN = (sheet.match(/<row /g) ?? []).length
    eq(`${label}: هیچ ردیف داده‌ای بریده نشد`, rowsN, (rep === 3 ? 2 : 0) + 1 + input.rows.length + (input.totals ? 1 : 0))
  }
  const wb = execFileSync('unzip', ['-p', join(dir, '3.xlsx'), 'xl/workbook.xml'], { encoding: 'utf8' }).replace(/&apos;/g, "'")
  eq("آپاستروف نام برگه در فرمول Print_Titles دوتایی شد", wb.includes("'گزارش''s تعویض'!$1:$3"), true)
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
