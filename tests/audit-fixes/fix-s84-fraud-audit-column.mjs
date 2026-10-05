/**
 * نشست ۸۴ · خوشه I
 *
 * FraudService.review روی AuditLog با ستون ناموجود createdAt فیلتر می‌کرد (ستون
 * واقعی schema «at» است)؛ پس کل تابع throw می‌کرد و تب ضدتقلب همیشه کور بود.
 * این تست ثابت می‌کند review بدون خطا برمی‌گردد و رکورد override داخل بازه
 * شمرده می‌شود ولی رکورد خارج از بازه نه.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-fraud-audit-column.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}

const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8')
const auditModel = schema.match(/model AuditLog \{[\s\S]*?\n\}/)?.[0] ?? ''
eq('AuditLog در schema ستون at دارد', /\n\s+at\s+DateTime/.test(auditModel), true)
eq('AuditLog در schema ستون createdAt ندارد', /\n\s+createdAt\s/.test(auditModel), false)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s84-fraud-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const manager = seed.user('مدیر')
seed.insert('AuditLog', { at: Date.now(), userId: manager, action: 'CLOSED_PERIOD_OVERRIDE', entity: 'SaleInvoice', entityId: 1, note: 'داخل بازه' })
seed.insert('AuditLog', { at: Date.now() - 40 * 86400000, userId: manager, action: 'CLOSED_PERIOD_OVERRIDE', entity: 'SaleInvoice', entityId: 2, note: 'خارج بازه' })

let result = null
let error = null
try {
  result = await fraudService.review({ fromJalali: today, toJalali: today })
} catch (e) {
  error = e
}
eq('review بدون خطا برمی‌گردد', error ? String(error.message).slice(0, 120) : null, null)
const flag = result?.flags?.find((f) => f.key === 'closedPeriodOverride')
eq('override داخل بازه دقیقاً یک‌بار شمرده می‌شود', flag?.count ?? null, 1)
eq('رکورد خارج بازه وارد نمی‌شود', flag?.sources?.some((s) => String(s.label).includes('خارج بازه')) ?? null, false)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
