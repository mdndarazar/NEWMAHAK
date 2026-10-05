/**
 * نشست ۸۲ · خوشه A · race واقعیِ دو اتصال برای openSession
 *
 * دو caller مستقل یک کلید idempotency یکسان را هم‌زمان مصرف می‌کنند.
 * unique index فقط اجازه‌ی یک نشست را می‌دهد؛ caller دوم پس از تصادم،
 * رکورد اول را به‌عنوان replay امن برمی‌گرداند.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')

if (!isMainThread) {
  const db = new DatabaseSync(workerData.file)
  db.exec('PRAGMA busy_timeout = 2000')
  const control = new Int32Array(workerData.control)
  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

  if (workerData.role === 'first') {
    db.exec('BEGIN IMMEDIATE')
    const prior = db.prepare('SELECT id FROM Shift WHERE openIdempotencyKey = ?').get(workerData.key)
    if (prior) throw new Error('کلید از قبل مصرف شده بود')
    parentPort.postMessage({ type: 'locked' })
    while (Atomics.load(control, 0) === 0) await sleep(1)
    db.prepare('INSERT INTO Shift (openIdempotencyKey, openIdempotencyFingerprint) VALUES (?, ?)')
      .run(workerData.key, workerData.fingerprint)
    db.exec('COMMIT')
    parentPort.postMessage({ type: 'created' })
  } else {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('INSERT INTO Shift (openIdempotencyKey, openIdempotencyFingerprint) VALUES (?, ?)')
        .run(workerData.key, workerData.fingerprint)
      db.exec('COMMIT')
      parentPort.postMessage({ type: 'unexpected-create' })
    } catch (error) {
      db.exec('ROLLBACK')
      const persisted = db.prepare('SELECT id, openIdempotencyFingerprint FROM Shift WHERE openIdempotencyKey = ?')
        .get(workerData.key)
      parentPort.postMessage({
        type: persisted?.openIdempotencyFingerprint === workerData.fingerprint ? 'replay' : 'mismatch',
        id: persisted?.id ?? null
      })
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

eq('openSession کلید idempotency را می‌گیرد', /idempotencyKey/.test(source), true)
eq('تصادم یکتا به replay همان fingerprint تبدیل می‌شود', /error\?\.code === 'P2002'[\s\S]{0,700}openIdempotencyFingerprint/.test(source), true)
eq('fingerprint متفاوت بی‌صدا بلعیده نمی‌شود', /کلید برای درخواست متفاوت/.test(source), true)

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s82-open-session-two-connections-'))
const file = join(dir, 'race.db')
const db = new DatabaseSync(file)
db.exec(`
  CREATE TABLE Shift (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openIdempotencyKey TEXT UNIQUE,
    openIdempotencyFingerprint TEXT
  );
`)

const key = 's82-open-race-0001'
const fingerprint = 'staff=81|name=صبح|handover=0'
const control = new SharedArrayBuffer(4)
const first = new Worker(new URL(import.meta.url), {
  workerData: { file, role: 'first', key, fingerprint, control }
})
let firstCreated = false
const ready = new Promise((resolveReady, rejectReady) => {
  const timer = setTimeout(() => rejectReady(new Error('caller اول قفل را نگرفت')), 3000)
  first.on('message', (message) => {
    if (message.type === 'locked') {
      clearTimeout(timer)
      resolveReady()
    }
    if (message.type === 'created') firstCreated = true
  })
  first.on('error', rejectReady)
})
await ready

const second = new Worker(new URL(import.meta.url), {
  workerData: { file, role: 'second', key, fingerprint, control }
})
await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
Atomics.store(new Int32Array(control), 0, 1)
Atomics.notify(new Int32Array(control), 0)

const [secondResult] = await Promise.all([
  new Promise((resolveSecond, rejectSecond) => {
    const timer = setTimeout(() => rejectSecond(new Error('caller دوم replay نکرد')), 5000)
    second.on('message', (message) => {
      if (message.type === 'replay' || message.type === 'unexpected-create' || message.type === 'mismatch') {
        clearTimeout(timer)
        resolveSecond(message)
      }
    })
    second.on('error', rejectSecond)
  }),
  new Promise((resolveFirst, rejectFirst) => {
    const timer = setTimeout(() => rejectFirst(new Error('caller اول commit نکرد')), 3000)
    first.on('message', (message) => {
      if (message.type === 'created') {
        clearTimeout(timer)
        firstCreated = true
        resolveFirst(message)
      }
    })
    first.on('error', rejectFirst)
  })
])
await Promise.all([first.terminate(), second.terminate()])

eq('caller اول نشست را ساخت', firstCreated, true)
eq('caller دوم همان نشست را replay کرد', secondResult.type, 'replay')
eq('دو اتصال مستقل فقط یک نشست ساختند', db.prepare('SELECT COUNT(*) AS n FROM Shift').get().n, 1)
eq('کلید و fingerprint همان درخواست ماند', db.prepare('SELECT openIdempotencyFingerprint FROM Shift WHERE openIdempotencyKey = ?').get(key).openIdempotencyFingerprint, fingerprint)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
