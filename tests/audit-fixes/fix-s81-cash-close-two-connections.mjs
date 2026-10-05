/**
 * نشست ۸۱ · خوشه A · race واقعیِ دو اتصال برای بستن صندوق
 *
 * این تست دو اتصال مستقل به یک فایل SQLite را در دو Worker باز می‌کند.
 * اتصال اول transaction را نگه می‌دارد؛ اتصال دوم فقط بعد از آزادشدن قفل
 * transaction را می‌گیرد و predicate داخل transaction را دوباره می‌خواند.
 * نتیجه باید دقیقاً یک snapshot و یک OPENING_FLOAT باشد.
 *
 * محدودیت صریح: این تست لایه‌ی SQLite/transaction را با دو اتصال مستقل اثبات
 * می‌کند، اما اجرای Electron/Prisma تولیدی در این محیط انجام نمی‌شود.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync(resolve('src/main/services/CashboxService.ts'), 'utf8')

if (!isMainThread) {
  const db = new DatabaseSync(workerData.file)
  db.exec('PRAGMA busy_timeout = 2000')
  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
  const control = new Int32Array(workerData.control)

  if (workerData.role === 'first') {
    db.exec('BEGIN IMMEDIATE')
    const prior = db.prepare('SELECT id FROM CashSession WHERE shiftId = ? LIMIT 1').get(workerData.shiftId)
    if (prior) {
      db.exec('ROLLBACK')
      parentPort.postMessage({ type: 'failed', message: 'caller اول پیش از درج snapshot سابقه دید' })
      process.exit(1)
    }
    parentPort.postMessage({ type: 'locked' })
    while (Atomics.load(control, 0) === 0) await sleep(1)
    db.prepare('INSERT INTO CashMovement (shiftId, type, amount) VALUES (?, ?, ?)').run(workerData.shiftId, 'OPENING_FLOAT', 500)
    db.prepare('INSERT INTO CashSession (shiftId, expectedCash) VALUES (?, ?)').run(workerData.shiftId, 1500)
    db.exec('COMMIT')
    parentPort.postMessage({ type: 'committed' })
  } else {
    // شروع caller دوم عمداً هم‌زمان با transaction اول است؛ BEGIN IMMEDIATE
    // تا زمان commit اول منتظر می‌ماند، سپس predicate محصول را اجرا می‌کند.
    db.exec('BEGIN IMMEDIATE')
    const prior = db.prepare('SELECT id FROM CashSession WHERE shiftId = ? LIMIT 1').get(workerData.shiftId)
    if (prior) {
      db.exec('ROLLBACK')
      parentPort.postMessage({ type: 'rejected', message: 'این نشست هم‌زمان توسط درخواست دیگری بسته شد' })
    } else {
      db.prepare('INSERT INTO CashSession (shiftId, expectedCash) VALUES (?, ?)').run(workerData.shiftId, 1500)
      db.exec('COMMIT')
      parentPort.postMessage({ type: 'unexpected-commit' })
    }
  }
  process.exit(0)
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

eq('گیت دوم داخل transaction قبل از ساخت snapshot است', source.indexOf('concurrentPrior') < source.indexOf('tx.cashSession.create'), true)
eq('بستن دوباره بدون تأیید همچنان رد می‌شود', /if \(!input\.allowRepeatClose\)/.test(source), true)

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s81-cash-close-two-connections-'))
const file = join(dir, 'race.db')
const db = new DatabaseSync(file)
db.exec(`
  CREATE TABLE CashSession (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shiftId INTEGER NOT NULL,
    expectedCash INTEGER NOT NULL
  );
  CREATE TABLE CashMovement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shiftId INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL
  );
`)

const control = new SharedArrayBuffer(4)
const first = new Worker(new URL(import.meta.url), {
  workerData: { file, role: 'first', shiftId: 81, control }
})
const firstMessages = []
first.on('message', (message) => firstMessages.push(message))

await new Promise((resolveReady, rejectReady) => {
  const timer = setTimeout(() => rejectReady(new Error('caller اول transaction را شروع نکرد')), 3000)
  first.on('message', (message) => {
    if (message.type === 'locked') {
      clearTimeout(timer)
      resolveReady()
    }
    if (message.type === 'failed') {
      clearTimeout(timer)
      rejectReady(new Error(message.message))
    }
  })
  first.on('error', rejectReady)
})

const second = new Worker(new URL(import.meta.url), {
  workerData: { file, role: 'second', shiftId: 81, control }
})
// caller دوم در حال رقابت برای همان قفل است؛ حالا caller اول commit می‌کند.
await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
Atomics.store(new Int32Array(control), 0, 1)
Atomics.notify(new Int32Array(control), 0)
await new Promise((resolveDone, rejectDone) => {
  const timer = setTimeout(() => rejectDone(new Error('caller اول commit نکرد')), 3000)
  first.on('message', (message) => {
    if (message.type === 'committed') {
      clearTimeout(timer)
      resolveDone()
    }
  })
  first.on('error', rejectDone)
})
const secondResult = await new Promise((resolveSecond, rejectSecond) => {
  const timer = setTimeout(() => rejectSecond(new Error('caller دوم در زمان مقرر تمام نشد')), 5000)
  second.on('message', (message) => {
    if (message.type === 'rejected' || message.type === 'unexpected-commit') {
      clearTimeout(timer)
      resolveSecond(message)
    }
  })
  second.on('error', rejectSecond)
})
await Promise.all([first.terminate(), second.terminate()])

eq('caller دوم بدون تأیید رد شد', secondResult.type, 'rejected')
eq('دو اتصال مستقل فقط یک snapshot ساختند', db.prepare('SELECT COUNT(*) AS n FROM CashSession WHERE shiftId = ?').get(81).n, 1)
eq('OPENING_FLOAT فقط یک بار ثبت شد', db.prepare('SELECT COUNT(*) AS n FROM CashMovement WHERE shiftId = ? AND type = ?').get(81, 'OPENING_FLOAT').n, 1)
eq('expectedCash دوباره اعمال نشد', db.prepare('SELECT COALESCE(SUM(expectedCash), 0) AS n FROM CashSession WHERE shiftId = ?').get(81).n, 1500)
eq('caller اول واقعاً commit کرد', firstMessages.some((message) => message.type === 'committed'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
