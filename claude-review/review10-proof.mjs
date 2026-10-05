/**
 * ===========================================================================
 * بازبینی دهم — اثبات رفتاری (دیتابیس هارنس، پل واقعی بوت، زمان‌بند خودکار واقعی).
 *
 *     node --import ./test/harness/register.mjs claude-review/review10-proof.mjs
 *
 * SMS-R10-01 — پیش‌فیلتر SQL که در بازبینی نهم آمد (`duePrefilter`) وقتی
 *   «حداقل روز از صدور = ۰» باشد (مقدار مجاز: `parseCreditSettings` حداقل ۰ را
 *   می‌پذیرد) و «چند روز قبل از انقضا» > ۰ (پیش‌فرض ۳)، شرط مثبتِ «N روز از
 *   صدور» را کلاً حذف می‌کرد و فقط «پنجره‌ی نزدیک‌انقضا» می‌ماند. ولی
 *   `reminderDecision` برای همین اعتبار (بدون انقضا، تازه‌صادر، شماره‌دار)
 *   should=true می‌دهد. نتیجه: زمان‌بند خودکار آن را هرگز نمی‌دید ⇒ یادآوری
 *   بی‌صدا هرگز در صف نمی‌نشست، با اینکه دکمه‌ی دستی همان اعتبار را می‌فرستد.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-r10-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const svc = await import('../src/main/services/StoreCreditService.ts')
const credit = await import('../src/shared/credit.ts')
const notify = await import('../src/main/services/NotificationSender.ts')
const { runSmsAutoOnce, setSmsReminderSource } = await import('../src/main/services/sms/SmsService.ts')
const { smsNotificationSender } = await import('../src/main/services/sms/SmsNotificationSender.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')

const db = harnessClient()
const sql = db.$harness.db
const userId = makeSeeder(db).user('مدیر بازبینی ۱۰')
const DAY = 86_400_000
let bugs = 0
let good = 0
const check = (label, isBug, detail) => {
  if (isBug) bugs++
  else good++
  console.log(`  ${isBug ? '× باگ' : '✓ رفتار درست'} · ${label} · ${detail}`)
}

// پل واقعی بوت (main/index.ts)
notify.setNotificationSender(smsNotificationSender)
setSmsReminderSource({
  name: 'یادآوری اعتبار خرید',
  candidates: async ({ limit }) => {
    const res = await svc.storeCreditService.reminderCandidates({ onlyDue: true, take: limit ?? 200 })
    return (res?.rows ?? []).map((r) => ({ id: r?.credit?.id ?? r?.id })).filter((r) => Number.isFinite(r.id))
  },
  queue: async ({ id, userId: u }) => svc.storeCreditService.queueReminder({ id, userId: u ?? null })
})
await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'خط ۱۰', purpose: 'SERVICE', isActive: true, userId })

const KEY = 'credit.settings'
let day = 0
async function scenario(label, reminder, expectQueued) {
  day++
  const base = credit.parseCreditSettings(null)
  sql
    .prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)')
    .run(KEY, JSON.stringify({ ...base, reminder: { ...base.reminder, ...reminder } }))
  sql.prepare('DELETE FROM "SmsOutbox"').run()
  sql.prepare('DELETE FROM "StoreCredit"').run()
  sql
    .prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)')
    .run('sms.auto', JSON.stringify({ enabled: true, hour: 10, minute: 0, askOnEnable: false }))
  sql.prepare('DELETE FROM "Setting" WHERE key = ?').run('sms.auto.lastRun')

  const c = await svc.issueStoreCredit(db, { amount: 2_000_000, holderPhone: '09121234567', source: 'MANUAL', userId })
  // بدون انقضا، دو روز پیش صادر شده، هیچ یادآوری‌ای نگرفته، شماره‌ی معتبر دارد
  sql.prepare('UPDATE "StoreCredit" SET expiresAt = NULL, issuedAt = ? WHERE id = ?').run(Date.now() - 2 * DAY, c.id)

  const settings = await svc.readCreditSettings(db)
  const decision = credit.reminderDecision(
    {
      id: c.id,
      code: c.code,
      status: 'ACTIVE',
      amount: 2_000_000,
      usedAmount: 0,
      usedCount: 0,
      maxUses: 1,
      multiUse: false,
      expiresAt: null,
      issuedAt: new Date(Date.now() - 2 * DAY),
      lastReminderAt: null,
      reminderCount: 0,
      reminderOptOut: false,
      phone: '09121234567'
    },
    settings.reminder
  )
  const run = await runSmsAutoOnce(new Date(2026, 9, 4 + day, 10, 5), userId)
  const queued = sql.prepare(`SELECT COUNT(*) c FROM "SmsOutbox" WHERE eventType='CREDIT_REMINDER'`).get().c
  console.log(`\n${label}`)
  console.log(`   reminderDecision.should=${decision.should} (${decision.kind}) · زمان‌بند: ran=${run.ran} queued=${run.queued} · ردیف صف=${queued}`)
  check(`تصمیم‌گیر می‌گوید باید برود`, decision.should !== true, `should=${decision.should}`)
  check(`زمان‌بند خودکار هم آن را در صف می‌گذارد`, expectQueued && queued !== 1, `ردیف در صف=${queued}`)
}

await scenario('۱) minDaysSinceIssue=0 · beforeExpiryDays=3 (پیش‌فرض)', { minDaysSinceIssue: 0, beforeExpiryDays: 3 }, true)
await scenario('۲) ضدکنترل: minDaysSinceIssue=1 · beforeExpiryDays=3', { minDaysSinceIssue: 1, beforeExpiryDays: 3 }, true)
await scenario('۳) ضدکنترل: minDaysSinceIssue=0 · beforeExpiryDays=0', { minDaysSinceIssue: 0, beforeExpiryDays: 0 }, true)

console.log(`\n${good} رفتار درست · ${bugs} باگ اثبات‌شده`)
process.exit(bugs === 0 ? 0 : 1)
