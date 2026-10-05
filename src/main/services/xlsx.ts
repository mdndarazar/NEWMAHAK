import { deflateRawSync } from 'node:zlib'

/**
 * ---------------------------------------------------------------------------
 * نویسنده‌ی فایل اکسل استاندارد (xlsx) — بدون هیچ وابستگی جدید.
 *
 * چرا از صفر؟ خروجی قبلی یک فایل CSV بود که پسوند اکسل داشت؛ اکسل فارسی آن را
 * به‌هم‌ریخته باز می‌کرد (همه‌ی ستون‌ها در یک ستون، یا هشدار «قالب فایل با
 * پسوندش نمی‌خواند»). نصب کتابخانه هم برای این برنامه‌ی آفلاین گزینه‌ی خوبی
 * نیست، پس یک نویسنده‌ی کوچک و کامل نوشته شده است:
 *
 *   • ساختار واقعی OOXML (workbook + worksheet + styles) داخل یک فایل ZIP.
 *   • رشته‌ها به‌صورت inlineStr و عددها به‌صورت عدد واقعی ذخیره می‌شوند، پس
 *     در اکسل قابل جمع زدن و مرتب کردن‌اند (نه متن).
 *   • برگه راست‌به‌چپ است، سرستون‌ها ثابت (freeze) و فیلتردار، و عرض ستون‌ها
 *     از طول محتوا حساب می‌شود تا جدول از اول ستون‌بندی‌شده باز شود.
 *   • قالب عددی #,##0 برای مبالغ ریالی.
 *
 * ZIP هم دستی ساخته می‌شود (deflateRaw + CRC32)، چون Node کتابخانه‌ی ZIP
 * ندارد ولی zlib دارد.
 * ---------------------------------------------------------------------------
 */

export type CellValue = string | number | null | undefined

export interface XlsxSheetInput {
  /** نام برگه (اکسل کاراکترهای \ / ? * [ ] : را نمی‌پذیرد) */
  name?: string
  headers: string[]
  rows: CellValue[][]
  /** ردیف جمع (پررنگ، انتهای جدول) */
  totals?: CellValue[]
  /** عنوان اختیاری بالای جدول (مثلاً «گزارش سرجمع فروش — از … تا …») */
  title?: string
}

// ---------------------------------------------------------------- CRC32
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------- ZIP
interface ZipEntry {
  name: string
  data: Buffer
}

/** یک فایل ZIP معتبر (deflate) از چند ورودی. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const raw = entry.data
    const deflated = deflateRawSync(raw, { level: 9 })
    // اگر فشرده‌سازی سود نداشت، بدون فشرده‌سازی ذخیره می‌شود (کاملاً مجاز)
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: نام فایل UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x2100, 12) // date (۱ ژانویه ۲۰۰۰)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    locals.push(local, body)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x2100, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuf, end])
}

// ---------------------------------------------------------------- XML
function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // کاراکترهای کنترلی در XML مجاز نیستند و فایل را در اکسل خراب می‌کنند
    // نشست ۸۴ · خوشه J: کلاس قبلی با «-» شروع می‌شد و خط‌تیره‌ی متنی (شماره فیش،
    // کد رهگیری، کد رنگ) را به فاصله تبدیل می‌کرد؛ فقط بازه‌ی واقعی کنترلی حذف شود.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
}

/** شماره‌ی ستون (۱-based) → حرف ستون اکسل: 1=A، 27=AA */
export function columnLetter(index: number): string {
  let n = Math.max(1, Math.round(index))
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** آیا این مقدار باید به‌عنوان «عدد» در اکسل ذخیره شود؟ */
function isNumeric(v: CellValue): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

/**
 * سبک‌ها (به ترتیب شماره‌ی s در سلول‌ها):
 *   0 = عادی · 1 = سرستون · 2 = متن · 3 = عدد (#,##0) · 4 = جمعِ متنی
 *   5 = جمعِ عددی · 6 = عنوان بالای جدول
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="3">
<font><sz val="11"/><color theme="1"/><name val="Tahoma"/><family val="2"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Tahoma"/><family val="2"/></font>
<font><b/><sz val="13"/><color theme="1"/><name val="Tahoma"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2EC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF9AA5B1"/></left><right style="thin"><color rgb="FF9AA5B1"/></right><top style="thin"><color rgb="FF9AA5B1"/></top><bottom style="thin"><color rgb="FF9AA5B1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
</styleSheet>`

/** نام برگه‌ی مجاز اکسل (حداکثر ۳۱ کاراکتر، بدون \\ / ? * [ ] :). */
export function safeSheetName(name: string | undefined): string {
  const clean = String(name || 'گزارش')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
  return (clean || 'گزارش').slice(0, 31)
}

function workbookXml(sheetName: string, repeatRows: number): string {
  const formulaSheetName = sheetName.replace(/'/g, "''")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>
<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${xmlEscape(formulaSheetName)}'!$1:$${repeatRows}</definedName></definedNames>
</workbook>`
}

/** عرض تقریبی هر ستون از طول محتوایش (حداقل ۹، حداکثر ۴۵ کاراکتر). */
function columnWidths(headers: string[], rows: CellValue[][], totals?: CellValue[]): number[] {
  const widths = headers.map((h) => String(h ?? '').length + 2)
  const scan = (row: CellValue[] | undefined) => {
    if (!row) return
    row.forEach((cell, i) => {
      if (i >= widths.length) return
      const text = isNumeric(cell) ? Math.round(cell).toLocaleString('en-US') : String(cell ?? '')
      if (text.length + 2 > widths[i]) widths[i] = text.length + 2
    })
  }
  for (const r of rows) scan(r)
  scan(totals)
  return widths.map((w) => Math.min(45, Math.max(9, Math.round(w))))
}

function cellXml(ref: string, value: CellValue, styleNumber: number, styleText: number): string {
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${styleText}"/>`
  if (isNumeric(value)) return `<c r="${ref}" s="${styleNumber}"><v>${value}</v></c>`
  return `<c r="${ref}" s="${styleText}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
}

function sheetXml(input: XlsxSheetInput): string {
  const headers = input.headers ?? []
  const rows = input.rows ?? []
  const colCount = Math.max(
    1,
    headers.length,
    ...rows.map((r) => r.length),
    input.totals ? input.totals.length : 0
  )
  const widths = columnWidths(headers, rows, input.totals)
  while (widths.length < colCount) widths.push(12)

  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  const out: string[] = []
  let r = 1

  // عنوان اختیاری (یک سلول، بدون merge تا هیچ‌وقت فایل خراب نشود)
  const hasTitle = !!(input.title && input.title.trim())
  if (hasTitle) {
    out.push(`<row r="${r}" ht="20" customHeight="1"><c r="A${r}" s="6" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
      input.title
    )}</t></is></c></row>`)
    r++
    out.push(`<row r="${r}"/>`)
    r++
  }

  const headerRow = r
  out.push(
    `<row r="${r}" ht="26" customHeight="1">` +
      headers.map((h, i) => cellXml(`${columnLetter(i + 1)}${r}`, String(h ?? ''), 1, 1)).join('') +
      '</row>'
  )
  r++

  for (const row of rows) {
    out.push(
      `<row r="${r}">` +
        row.map((cell, i) => cellXml(`${columnLetter(i + 1)}${r}`, cell, 3, 2)).join('') +
        '</row>'
    )
    r++
  }

  if (input.totals?.length) {
    out.push(
      `<row r="${r}">` +
        input.totals.map((cell, i) => cellXml(`${columnLetter(i + 1)}${r}`, cell, 5, 4)).join('') +
        '</row>'
    )
    r++
  }

  const lastRow = Math.max(headerRow, r - 1)
  const lastCol = columnLetter(colCount)
  const freezeCell = `A${headerRow + 1}`

  // ممیزی AUDIT-S130-01: CT_Worksheet یک دنباله‌ی ترتیبی است و sheetPr باید اولین فرزند باشد
  // (قبل از dimension)؛ وگرنه Excel فایل را «محتوای ناخوانا» می‌داند و پیشنهاد تعمیر می‌دهد.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="${freezeCell}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${freezeCell}" sqref="${freezeCell}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${cols}</cols>
<sheetData>${out.join('')}</sheetData>
<autoFilter ref="A${headerRow}:${lastCol}${headerRow}"/>
<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`
}

/** ساخت محتوای یک فایل xlsx کامل و سالم. */
export function buildXlsx(input: XlsxSheetInput): Buffer {
  const sheetName = safeSheetName(input.name)
  const repeatRows = input.title?.trim() ? 3 : 1
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(sheetName, repeatRows), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(input), 'utf8') }
  ])
}
