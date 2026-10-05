/**
 * نشست ۱۱۴ · خوشه G · بند ۴-۴۶ و ۴-۴۷
 *
 * باگ: «سابقه‌ی بستن صندوق» (cash:sessions) و «سابقه‌ی تجمیع»
 * (consolidation:list) هر دو با `take: 200` ثابت و بی‌صدا بریده می‌شدند.
 * مدیر در بازه‌ی ماهانه‌ی شلوغ جدولی می‌دید که «کامل به نظر می‌رسید» ولی
 * بستن‌های قدیمی‌تر (از جمله بستن دوباره‌ی مشکوک یا مغایرت منفی) در آن نبود.
 *
 * بعد از رفع: تا ۵٬۰۰۰ ردیف یک‌جا، totalCount واقعی، skip/take، و هشدار
 * فارسی هنگام برش — با همان قرارداد PagedRows (آرایه + page + warnings).
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی/Electron را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s114-history-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

const N = 205
const now = Date.now()
for (let i = 0; i < N; i++) {
  seed.insert('CashSession', { dayJalali: today, fromDate: now, toDate: now, closedAt: now, createdAt: now })
  seed.insert('Consolidation', { dayJalali: today, fromDate: now, toDate: now, createdAt: now })
}

const range = { fromJalali: today, toJalali: today }

const s = await cashboxService.sessions(range)
eq('سابقه‌ی صندوق: هر ۲۰۵ ردیف بدون برش بی‌صدا برمی‌گردد', s.length, N)
eq('سابقه‌ی صندوق: totalCount واقعی دارد', s.page?.totalCount, N)
eq('سابقه‌ی صندوق: وقتی کامل است truncated=false', s.page?.truncated, false)
eq('سابقه‌ی صندوق: وقتی کامل است هشدار ندارد', (s.warnings ?? ['x']).length, 0)

const s50 = await cashboxService.sessions({ ...range, take: 50 })
eq('سابقه‌ی صندوق: take=50 فقط ۵۰ ردیف', s50.length, 50)
eq('سابقه‌ی صندوق: برش صریح truncated=true', s50.page?.truncated, true)
eq('سابقه‌ی صندوق: هشدار فارسی «نمایش ۵۰ از ۲۰۵»', /نمایش ۵۰ از ۲۰۵/.test((s50.warnings ?? []).join(' ')), true)
const sLast = await cashboxService.sessions({ ...range, take: 50, skip: 200 })
eq('سابقه‌ی صندوق: صفحه‌ی آخر (skip=200) ۵ ردیف', sLast.length, 5)
eq('سابقه‌ی صندوق: صفحه‌ی آخر دیگر برش ندارد', sLast.page?.truncated, false)
const ids = new Set([...s50, ...sLast].map((r) => r.id))
eq('سابقه‌ی صندوق: صفحه‌ها هم‌پوشانی ندارند', ids.size, 55)
const sHuge = await cashboxService.sessions({ ...range, take: 999999 })
eq('سابقه‌ی صندوق: take بیش از سقف به ۵۰۰۰ محدود می‌شود', sHuge.page?.take, 5000)
const sBad = await cashboxService.sessions({ ...range, take: -3, skip: -9 })
eq('سابقه‌ی صندوق: take/skip نامعتبر امن می‌شود', sBad.page?.take === 1 && sBad.page?.skip === 0, true)

const c = await cashboxService.list(range)
eq('سابقه‌ی تجمیع: هر ۲۰۵ ردیف بدون برش بی‌صدا برمی‌گردد', c.length, N)
eq('سابقه‌ی تجمیع: totalCount واقعی دارد', c.page?.totalCount, N)
const c20 = await cashboxService.list({ ...range, take: 20 })
eq('سابقه‌ی تجمیع: برش صریح truncated=true', c20.page?.truncated, true)
eq('سابقه‌ی تجمیع: هشدار فارسی «نمایش ۲۰ از ۲۰۵»', /نمایش ۲۰ از ۲۰۵/.test((c20.warnings ?? []).join(' ')), true)

const clone = structuredClone(s50)
eq('metadata صفحه از structured clone (IPC الکترون) عبور می‌کند', clone.page?.totalCount, N)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
