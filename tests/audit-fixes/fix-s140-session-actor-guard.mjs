/**
 * نشست ۱۴۰ · خوشه E/A
 *
 * mutationهای بازکردن نشست و تأیید کارمند نباید actor حسابرسی را از
 * userId ارسالی renderer قبول کنند. نبود نشست قبلی برای اولین نشست مجاز است،
 * اما اگر نشست باز وجود داشته باشد actor باید از main خوانده شود.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
let ok = 0
let bad = 0
const truthy = (label, value) => value ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`))

truthy('helper actor اختیاری برای چرخه نشست وجود دارد', /async function withOptionalSessionActor/.test(source))
truthy('helper actor اختیاری userId را از main می‌نویسد', /withOptionalSessionActor[\s\S]{0,500}return \{ \.\.\.\(payload \?\? \{\}\), userId: actorId \}/.test(source))
truthy('بازکردن نشست از actor اختیاری main استفاده می‌کند', /handle\(IPC\.shiftSessionOpen, async \(p\) => shiftService\.openSession\(await withOptionalSessionActor\(p \?\? \{\}\)\)\)/.test(source))
truthy('تأیید کارمند از actor اختیاری main استفاده می‌کند', /handle\(IPC\.shiftSessionStaff, async \(p\) => shiftService\.confirmStaff\(await withOptionalSessionActor\(p \?\? \{\}\)\)\)/.test(source))
truthy('این دو مسیر payload خام را مستقیم به سرویس نمی‌دهند', !/handle\(IPC\.shiftSession(?:Open|Staff), \(p\) =>/.test(source))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
