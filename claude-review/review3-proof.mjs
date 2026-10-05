/**
 * ===========================================================================
 * بازبینی سوم — اثبات سه باگ بحرانی (تست بازبین؛ بخشی از محصول نیست)
 *
 *     node --import ./test/harness/register.mjs claude-review/review3-proof.mjs
 *
 * هر سه ادعا اینجا **رفتار درست** را می‌سنجند (نه وجود باگ)، پس:
 *   • قبل از رفع ⇒ «×» (باگ اثبات می‌شود)
 *   • بعد از رفع ⇒ «✓» و همان فایل می‌شود تست نگهبان
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-review3-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../test/harness/seed.mjs')
const { runSmsQueueOnce, smsQueueService } = await import('../src/main/services/sms/SmsQueue.ts')
const { smsCredentialService } = await import('../src/main/services/sms/SmsCredentials.ts')
const { smsService } = await import('../src/main/services/sms/SmsService.ts')
const { smsCampaignService } = await import('../src/main/services/sms/SmsCampaignService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر بازبینی')

let bad = 0
let ok = 0
const show = (label, cond, extra = '') => {
  if (cond) ok++
  else bad++
  console.log(`  ${cond ? '✓ رفتار درست' : '× باگ'} · ${label}${extra ? ' · ' + extra : ''}`)
}

/** صف را کامل خالی می‌کند (هر دور فقط ۵ ردیف برمی‌دارد). */
const drain = async () => {
  for (let i = 0; i < 60; i++) {
    const r = await runSmsQueueOnce()
    if (!r.picked) break
  }
}
const sentTo = (phone) =>
  sql.prepare(`SELECT COUNT(*) n FROM "SmsOutbox" WHERE phoneSnapshot = ? AND status = 'SENT'`).get(phone).n

await smsCredentialService.save({ providerKey: 'LOG_ONLY', name: 'یک‌خط', purpose: 'BOTH', isActive: true, userId })

// ---------------------------------------------------------------------------
console.log('\nR3-1) ثبت دوباره‌ی همان کمپین (دو Enter در دیالوگ تأیید) ⇒ هر مشتری دو تبلیغ؟')
{
  const input = {
    name: 'حراج',
    body: 'حراج پاییزه',
    phones: '09121110001\n09121110002',
    includeBank: false,
    userId
  }
  const first = await smsCampaignService.create(input)
  let secondBlocked = false
  let secondId = null
  try {
    const second = await smsCampaignService.create(input)
    secondId = second?.campaign?.id ?? null
  } catch {
    secondBlocked = true
  }
  console.log(`  کمپین‌ها: ${first?.campaign?.id ?? '؟'} و ${secondBlocked ? 'رد شد' : secondId ?? '؟'}`)
  await drain()
  const n = sentTo('09121110001')
  show('کمپین کاملاً یکسانِ دوم ساخته نشود (یا رد شود)', secondBlocked, `دومی: ${secondBlocked ? 'BusinessError' : `ساخته شد #${secondId}`}`)
  show('و یک شماره فقط یک تبلیغ کمپین بگیرد', n === 1, `ارسال‌شده=${n}`)
}

// ---------------------------------------------------------------------------
console.log('\nR3-2) تبلیغ دستی: گارد «دو کلیک ⇒ یک پیام» کار می‌کند؟')
{
  const a = { phone: '09121110003', body: 'تخفیف ویژه', advertising: true, userId }
  const r1 = await smsService.sendManual(a)
  const r2 = await smsService.sendManual(a)
  await drain()
  const n = sentTo('09121110003')
  show('درخواست دوم تکراری شناخته شود', r2.duplicate === true, `duplicate=${r2.duplicate} · id1=${r1.id} id2=${r2.id}`)
  show('مشتری فقط یک تبلیغ بگیرد', n === 1, `ارسال‌شده=${n}`)

  // کنترل: پیام خدماتی از قبل درست کار می‌کرد
  const m = { phone: '09121110004', body: 'پیام خدماتی', userId }
  await smsService.sendManual(m)
  const m2 = await smsService.sendManual(m)
  show('(کنترل) پیام خدماتی دستی تکراری شناخته می‌شود', m2.duplicate === true)
}

// ---------------------------------------------------------------------------
console.log('\nR3-3) لغو و ثبت دوباره‌ی همان متن ظرف ۹۰ ثانیه ⇒ «ثبت شد» ولی هرگز نمی‌رود؟')
{
  const tomorrow = new Date(Date.now() + 24 * 3600_000)
  const a = await smsService.sendManual({
    phone: '09121110005',
    body: 'سفارش شما آماده است',
    scheduledAt: tomorrow,
    userId
  })
  await smsQueueService.cancel(a.id, { reason: 'زمان اشتباه', userId })
  const b = await smsService.sendManual({ phone: '09121110005', body: 'سفارش شما آماده است', userId })
  await drain()
  const live = sql
    .prepare(
      `SELECT COUNT(*) n FROM "SmsOutbox" WHERE phoneSnapshot = '09121110005' AND status IN ('PENDING','PROCESSING','SENT')`
    )
    .get().n
  show(
    'ثبت دوم یک پیام زنده بسازد (نه ردیف لغوشده)',
    live === 1,
    `پاسخ: ok=${b.ok} duplicate=${b.duplicate} id=${b.id} (همان ردیف لغوشده=${b.id === a.id}) · زنده/ارسال‌شده=${live}`
  )
}

console.log(`\nخلاصه: ${ok} رفتار درست · ${bad} باگ اثبات‌شده`)
process.exit(bad === 0 ? 0 : 1)
