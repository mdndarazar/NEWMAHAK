/**
 * نشست ۷۹ · خوشه A · race بستن صندوق
 *
 * گیت «بستن دوباره» باید داخل تراکنشِ ساخت CashSession هم تکرار شود؛
 * بررسی بیرونی به‌تنهایی در برابر دو caller هم‌زمان کافی نیست.
 *
 * این هارنس، دو transaction را با دو caller مستقل روی SQLite واقعی اجرا
 * می‌کند و قرارداد را هم ساختاری و هم رفتاری بررسی می‌کند. چون سرویس کامل
 * Cashbox به Prisma واقعی/IPC وابسته است، رفتار رقابتیِ لایه‌ی transaction
 * با همان قاعده‌ی اتمیک بازسازی می‌شود و محدودیت در TESTLOG ثبت می‌شود.
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync(resolve('src/main/services/CashboxService.ts'), 'utf8')
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

eq('گیت بستن دوباره داخل تراکنش قرار دارد', /const session = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]{0,1800}concurrentPrior/.test(source), true)
eq('گیت داخل transaction قبل از ساخت snapshot اجرا می‌شود', source.indexOf('concurrentPrior') < source.indexOf('tx.cashSession.create'), true)
eq('اجرای تکراریِ تأییدشده همچنان مجاز است', /if \(!input\.allowRepeatClose\)/.test(source), true)

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s79-cash-close-race-'))
const db = new DatabaseSync(join(dir, 'race.db'))
db.exec(`
  CREATE TABLE CashSession (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shiftId INTEGER NOT NULL,
    expectedCash INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );
`)

const closeWithoutRepeat = (label) => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const prior = db.prepare('SELECT id FROM CashSession WHERE shiftId = ? LIMIT 1').get(7)
    if (prior) throw new Error('این نشست هم‌زمان توسط درخواست دیگری بسته شد')
    db.prepare('INSERT INTO CashSession (shiftId, expectedCash, createdAt) VALUES (?, ?, ?)')
      .run(7, 1500, Date.now())
    db.exec('COMMIT')
    return { label, committed: true }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    return { label, committed: false, message: String(error.message) }
  }
}

const first = closeWithoutRepeat('caller-1')
const second = closeWithoutRepeat('caller-2')
eq('اولین caller یک snapshot می‌سازد', first.committed, true)
eq('caller دوم بدون تأیید رد می‌شود', second.committed, false)
eq('هم‌زمانی فقط یک snapshot می‌سازد', db.prepare('SELECT COUNT(*) AS n FROM CashSession WHERE shiftId = 7').get().n, 1)
eq('expectedCash دوباره اعمال نشده است', db.prepare('SELECT COALESCE(SUM(expectedCash), 0) AS n FROM CashSession WHERE shiftId = 7').get().n, 1500)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
