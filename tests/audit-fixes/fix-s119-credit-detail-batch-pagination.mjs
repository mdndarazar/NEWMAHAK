/**
 * نشست ۱۱۹ · خوشه G · اعتبار خرید
 *
 * باگ: جزئیات اعتبار، Timeline را با take=500 و لاگ یادآوری را با take=100
 * بی‌صدا می‌برید؛ فهرست دسته‌های تولید گروهی هم take=200 ثابت داشت. هر سه
 * مسیر سند/مدرک مالی بودند اما نه totalCount داشتند نه هشدار برش.
 *
 * قرارداد بعد از رفع: آرایه‌ی قدیمی حفظ می‌شود، ولی page و warnings واقعی از
 * همان query برمی‌گردد و skip/take از IPC قابل عبور است.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
 
const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s119-credit-pages-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { creditViewRequest } = await import('../../src/shared/creditUi.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const now = Date.now()
const creditId = seed.insert('StoreCredit', {
  code: 'S119TEST',
  amount: 1_000_000,
  source: 'MANUAL',
  issuedAt: now,
  createdAt: now,
  updatedAt: now
})

for (let i = 0; i < 503; i++) {
  seed.insert('AuditLog', {
    at: now + i,
    action: 'CREDIT_EDIT',
    entity: 'StoreCredit',
    entityId: creditId,
    note: `رویداد ${i + 1}`
  })
}
for (let i = 0; i < 103; i++) {
  seed.insert('CreditReminderLog', {
    creditId,
    code: 'S119TEST',
    plannedAt: now + i,
    text: `یادآوری ${i + 1}`
  })
}
for (let i = 0; i < 205; i++) {
  seed.insert('StoreCreditBatch', {
    title: `دسته ${i + 1}`,
    source: 'MANUAL',
    count: 1,
    amountEach: 10_000,
    totalAmount: 10_000,
    createdAt: now + i
  })
}

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
const truthy = (label, value) => eq(label, !!value, true)

const first = await storeCreditService.detail({ id: creditId })
eq('جزئیات: Timeline صفحه‌ی اول ۵۰۰ ردیف دارد', first.timeline.length, 500)
eq('جزئیات: تعداد واقعی Timeline = ۵۰۳', first.timelinePage?.totalCount, 503)
eq('جزئیات: برش Timeline صریح است', first.timelinePage?.truncated, true)
truthy('جزئیات: هشدار فارسی Timeline وجود دارد', (first.timelineWarnings ?? []).some((w) => /نمایش/.test(w)))
eq('جزئیات: لاگ یادآوری صفحه‌ی اول ۱۰۰ ردیف دارد', first.reminders.length, 100)
eq('جزئیات: تعداد واقعی یادآوری = ۱۰۳', first.remindersPage?.totalCount, 103)
eq('جزئیات: برش یادآوری صریح است', first.remindersPage?.truncated, true)

const second = await storeCreditService.detail({ id: creditId, timelineSkip: 500, reminderSkip: 100 })
eq('جزئیات: صفحه‌ی دوم Timeline سه ردیف دارد', second.timeline.length, 3)
eq('جزئیات: صفحه‌ی دوم یادآوری سه ردیف دارد', second.reminders.length, 3)
eq('جزئیات: page از structured clone عبور می‌کند', structuredClone(second).timelinePage?.skip, 500)

const batches = await storeCreditService.batches()
eq('فهرست دسته‌ها همچنان آرایه است', Array.isArray(batches), true)
eq('فهرست دسته‌ها صفحه‌ی اول ۲۰۰ ردیف دارد', batches.length, 200)
eq('فهرست دسته‌ها totalCount واقعی دارد', batches.page?.totalCount, 205)
eq('فهرست دسته‌ها برش بی‌صدا نیست', batches.page?.truncated, true)
truthy('فهرست دسته‌ها هشدار فارسی دارد', (batches.warnings ?? []).some((w) => /نمایش/.test(w)))

const last = await storeCreditService.batches({ take: 50, skip: 200 })
eq('فهرست دسته‌ها صفحه‌ی آخر ۵ ردیف دارد', last.length, 5)
eq('فهرست دسته‌ها صفحه‌ی آخر برش ندارد', last.page?.truncated, false)
eq('درخواست UI دسته‌ها skip را به IPC می‌فرستد', creditViewRequest('batches', { take: 50, skip: 200 })?.payload?.skip, 200)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
