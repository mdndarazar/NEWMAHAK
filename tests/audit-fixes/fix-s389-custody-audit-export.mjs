/**
 * Phases 8/10 — a manager can export a bounded custody audit page, but the
 * final file must be generated from Main's newly authorized report query, not
 * from renderer-provided evidence rows.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s389-custody-audit-export.mjs
 */
import { readFileSync } from 'node:fs'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

const cashClose = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
const custody = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const exportService = readFileSync(new URL('../../src/main/services/ExportService.ts', import.meta.url), 'utf8')
const xlsx = readFileSync(new URL('../../src/main/services/xlsx.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const exportFn = cashClose.slice(cashClose.indexOf('const exportCustodyTimeline = async'), cashClose.indexOf('useEffect(() => {\n    let live = true', cashClose.indexOf('const exportCustodyTimeline = async')))

eq('Renderer export فقط با manager UI و coverage حاضر آغاز می‌شود', exportFn.includes('if (!isManager || !custodyTimeline || custodyExportBusy) return') && exportFn.includes('if (!coverage)'), true)
eq('Renderer فقط bounded scope را می‌فرستد، نه evidence rows', exportFn.includes('from: custodyTimeline.from') && exportFn.includes('to: custodyTimeline.to') && exportFn.includes('skip: coverage.skip') && exportFn.includes('take: coverage.take'), true)
eq('Renderer دیگر serializer یا exportTable را برای audit custody صدا نمی‌زند', exportFn.includes('CH.custodyReportExport') && !exportFn.includes('exportTable({') && !cashClose.includes('function custodyExportRows'), true)
eq('Main ابتدا report را از منبع حقیقت خودش می‌خواند', custody.includes('async exportReport') && custody.includes('const report = await this.report({ ...input, managerSession: true })'), true)
eq('Main فقط از report Main ردیف‌های export را می‌سازد', custody.includes('rows: custodyAuditExportRows(report)') && custody.includes('Renderer selects only its bounded scope'), true)
eq('Main دقت bigint را به decimal text حفظ می‌کند', custody.includes("typeof value === 'bigint' ? value.toString() : String(value)"), true)
eq('IPC export manager-session اجباری دارد', ipc.includes("assertManagerSession('خروجی گزارش کنترل حضانت')") && ipc.includes('IPC.custodyReportExport'), true)
eq('IPC rows/headers/title جعلی Renderer را صریحاً حذف می‌کند', ipc.includes('rows: _rows') && ipc.includes('headers: _headers') && ipc.includes('title: _title'), true)
eq('عنوان فایل Main از coverage واقعی incomplete بودن صفحه را می‌گوید', custody.includes('coverage?.hasMoreAny') && custody.includes('این خروجی فقط صفحهٔ فعلی است'), true)
eq('Main outcome export را بدون مسیر/هویت جعلی در AuditLog ثبت می‌کند', custody.includes("action: 'CUSTODY_REPORT_EXPORT'") && custody.includes('userId: null') && custody.includes("outcome: result.canceled ? 'CANCELED' : 'SAVED'"), true)
eq('CSV عمومی از formula injection متنی محافظت می‌کند', exportService.includes('CSV_FORMULA_PREFIX') && exportService.includes("'${raw}"), true)
eq('XLSX عمومی رشته‌ها را inlineStr می‌نویسد، نه formula cell', xlsx.includes('t="inlineStr"') && !xlsx.includes('<f>'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
