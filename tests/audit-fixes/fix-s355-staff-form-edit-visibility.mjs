/**
 * رگرسیون UI فرم کارمندان:
 * - فرم بالای جدول است؛ کلیک ویرایش باید آن را در دید کاربر بیاورد و فوکوس دهد.
 * - دکمهٔ ذخیره باید بعد از همهٔ فیلدهای محرمانه باشد، نه قبل از آن‌ها.
 *
 * node tests/audit-fixes/fix-s355-staff-form-edit-visibility.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`)
  }
}

const editStart = source.indexOf('const editStaff = async')
const editEnd = source.indexOf('/**\n   * ⚠️ جلسه ۱۹', editStart)
const edit = source.slice(editStart, editEnd)
const personnelStart = source.indexOf('<fieldset className="rounded border border-rose-200')
const saveStart = source.indexOf("'ذخیرهٔ ویرایش کارمند'", personnelStart)
const publicFieldsStart = source.indexOf('نام کارمند')

eq('رف و فوکوس فرم کارمند تعریف شده‌اند', source.includes('staffFormRef') && source.includes('staffNameInputRef'), true)
eq('ویرایش موفق فرم را به دید کاربر می‌آورد', edit.includes("scrollIntoView({ behavior: 'smooth', block: 'start' })"), true)
eq('ویرایش موفق نام کارمند را فوکوس می‌کند', edit.includes('staffNameInputRef.current?.focus()'), true)
eq('فرم ثبت به ref اسکرول متصل است', source.includes('<div ref={staffFormRef}'), true)
eq('دکمهٔ ذخیره پس از فیلدهای محرمانه قرار دارد', saveStart > personnelStart && personnelStart > publicFieldsStart, true)
eq('خطای فرم همان‌جا به کاربر نشان داده می‌شود', source.includes('const [staffError, setStaffError]') && source.includes('role="alert"') && source.includes('showStaffError'), true)
eq('ذخیرهٔ فرم همچنان از مسیر اتمی کامل استفاده می‌کند', source.includes('CH.staffPersonnelSaveComplete'), true)
eq('UI پروندهٔ محرمانه را شرط ثبت پایه نمی‌کند', source.includes('const requiredPersonnel'), false)
eq('UI وضعیت تکمیل پرونده را بدون افشای مقدار نشان می‌دهد', source.includes('staffProfileProgress') && source.includes('پرونده در حال تکمیل است'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
