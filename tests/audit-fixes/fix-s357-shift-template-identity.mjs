/**
 * شناسهٔ پایدار قالب شیفت:
 * - نام/ساعت identity نیستند و هر قالب یک id پایدار دارد؛
 * - parser id ذخیره‌شده را در read/write حفظ می‌کند؛
 * - پیکربندی قدیمیِ بی-id synthetic id قطعی می‌گیرد (نه random در هر read)؛
 * - UI در زمان افزودن قالب id تازه می‌سازد، نه از جایگاه آرایه.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s357-shift-template-identity.mjs
 */
import { readFileSync } from 'node:fs'

const { DEFAULT_SHIFT_CONFIG, parseShiftConfig } = await import('../../src/shared/receipt.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const same = (label, got, want) => eq(label, JSON.stringify(got), JSON.stringify(want))

const defaultIds = DEFAULT_SHIFT_CONFIG.templates.map((t) => t.id)
eq('قالب‌های پیش‌فرض شناسه دارند', defaultIds.every((id) => /^template-/.test(id)), true)
eq('شناسهٔ قالب‌های پیش‌فرض یکتاست', new Set(defaultIds).size, defaultIds.length)

const stored = {
  byTime: true,
  templates: [
    { id: 'morning-v1', name: 'صبح', startTime: '08:00', endTime: '14:00' },
    { id: 'night-v1', name: 'شب', startTime: '20:00', endTime: '02:00' }
  ]
}
const parsed = parseShiftConfig(stored)
same('parser شناسهٔ ذخیره‌شده را بی‌تغییر نگه می‌دارد', parsed.templates.map((t) => t.id), ['morning-v1', 'night-v1'])
const renamed = parseShiftConfig({ ...parsed, templates: [{ ...parsed.templates[0], name: 'صبحِ جدید', startTime: '07:30' }, parsed.templates[1]] })
eq('ویرایش نام/ساعت شناسهٔ قالب را عوض نمی‌کند', renamed.templates[0].id, 'morning-v1')
same('read/write parser شناسه را حفظ می‌کند', parseShiftConfig(JSON.stringify(renamed)).templates.map((t) => t.id), renamed.templates.map((t) => t.id))

const legacyRaw = {
  byTime: true,
  templates: [
    { name: 'صبح', startTime: '08:00', endTime: '14:00' },
    { name: 'صبح', startTime: '08:00', endTime: '14:00' }
  ]
}
const legacyA = parseShiftConfig(legacyRaw)
const legacyB = parseShiftConfig(legacyRaw)
same('legacy بی-id در خواندن‌های تکراری id یکسان می‌گیرد', legacyA.templates.map((t) => t.id), legacyB.templates.map((t) => t.id))
eq('قالب‌های legacy هم‌نام identity یکتا می‌گیرند', new Set(legacyA.templates.map((t) => t.id)).size, 2)
same('id legacy بعد از نخستین ذخیره/خواندن حفظ می‌شود', parseShiftConfig(legacyA).templates.map((t) => t.id), legacyA.templates.map((t) => t.id))

const settings = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
eq('UI افزودن قالب از generator شناسه استفاده می‌کند', settings.includes('id: createShiftTemplateId()'), true)
eq('UI ویرایش سطر قالب id قبلی را spread می‌کند', /const templates = p\.templates\.map\(\(t, i\) => \(i === idx \? \{ \.\.\.t, \.\.\.patch \}/.test(settings), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
