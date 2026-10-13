/**
 * Phase 5 — terminal custody evidence is exposed read-only to the manager
 * report: physical counts, expected ledger, immutable difference, recovery
 * resolution, and final cash disposition. No report read may change custody.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s386-custody-terminal-evidence-report.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-terminal-report-s386-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const minutes = (date) => date.getHours() * 60 + date.getMinutes()
const hm = (total) => {
  const minute = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

const manager = seed.user('مدیر گزارش نهایی S386')
const custodian = seed.user('مسئول کشو S386')
const witness = seed.user('شاهد صبح S386')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', custodian, witness)
/** A real scheduled expiry keeps the cash-movement window honest: no direct
 * timestamp mutation is used to manufacture a terminal recovery scenario. */
const now = new Date()
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true,
  custodyMode: 'SINGLE_SHIFT',
  overtimeMaxMinutes: 30,
  templates: [{
    id: 's386-terminal', name: 'شیفت گزارش نهایی S386', startTime: hm(minutes(now) - 5), endTime: hm(minutes(now) + 5),
    isActive: true, daysMask: 127, staffIds: [custodian, witness], reminderRepeatMin: 15, allowMidDayHandover: true
  }]
})
await custodyService.setPin({ userId: manager, newPassword: 'Manager386!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager386!' })
for (const [id, temporary, permanent] of [[custodian, 'CustodyTemp386!', 'CustodyFinal386!'], [witness, 'WitnessTemp386!', 'WitnessFinal386!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager386!', reason: 'راه‌اندازی آزمون گزارش شواهد نهایی' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

// A normal terminal close: count, immutable ledger difference, and an
// independently-confirmed destination record must all remain visible.
const closed = await custodyService.open({ userId: custodian, password: 'CustodyFinal386!', countedCash: 1000 })
const closedResult = await custodyService.finalClose({
  password: 'CustodyFinal386!',
  countedCash: 920,
  note: 'شمارش نهایی با کسری مستند برای گزارش پایان شیفت.',
  dispositions: [{ kind: 'TO_MANAGER', amount: 920, recipientUserId: manager, destinationLabel: 'گاوصندوق شب', trackingNo: 'S386-FINAL-TRACK' }]
})
const finalDisposition = seed.one('SELECT id FROM "CustodyDisposition" WHERE shiftId=?', closed.shiftId)
await custodyService.confirmDisposition({ dispositionId: finalDisposition?.id, userId: manager, password: 'Manager386!' })

// A separate unattended segment proves that recovery terminal evidence is
// reported independently and never assigned to the prior custodian by name.
const unattended = await custodyService.open({ userId: custodian, password: 'CustodyFinal386!', countedCash: 1000 })
const scheduledExpiry = seed.one('SELECT rolloverAt FROM "CustodyShiftMeta" WHERE shiftId=?', unattended.shiftId)
const rollover = await custodyService.ensureRolledOver(new Date(new Date(scheduledExpiry?.rolloverAt).getTime() + 1))
const recoveryNote = 'شاهد صبح، شمارش مستقلِ بخش شبِ پایان‌یافته را ثبت کرد.'
await custodyService.recoverUnattended({
  resolutionId: rollover?.resolutionId,
  userId: witness,
  password: 'WitnessFinal386!',
  countedCash: 940,
  note: recoveryNote
})

const beforeRead = {
  counts: seed.count('CustodyCount'),
  resolutions: seed.count('CustodyResolution'),
  dispositions: seed.count('CustodyDisposition'),
  sessions: seed.count('CashSession')
}
const report = await custodyService.report({ managerUserId: manager, managerPassword: 'Manager386!', take: 50 })
const afterRead = {
  counts: seed.count('CustodyCount'),
  resolutions: seed.count('CustodyResolution'),
  dispositions: seed.count('CustodyDisposition'),
  sessions: seed.count('CashSession')
}
const closingCount = report.counts.find((row) => row.shiftId === closed.shiftId && row.kind === 'CLOSING')
const witnessCount = report.counts.find((row) => row.shiftId === unattended.shiftId && row.kind === 'MORNING_WITNESS')
const resolution = report.resolutions.find((row) => row.shiftId === unattended.shiftId)
const disposition = report.dispositions.find((row) => row.shiftId === closed.shiftId)

eq('خواندن گزارش هیچ evidence یا CashSession تازه‌ای نمی‌سازد', JSON.stringify(afterRead), JSON.stringify(beforeRead))
eq('شمارش نهایی گزارش همان segment بسته‌شده است', closingCount?.shiftId, closed.shiftId)
eq('شمارش فیزیکی نهایی immutable است', Number(closingCount?.countedCash), 920)
eq('ledger موردانتظار نهایی مستقل و قابل گزارش است', Number(closingCount?.expectedCash), 1000)
eq('مغایرت نهایی بدون محاسبهٔ Renderer گزارش می‌شود', Number(closingCount?.differenceCash), -80)
eq('شمارش‌کنندهٔ نهایی custodian واقعی است', closingCount?.countedByName, 'مسئول کشو S386')
eq('روش احراز شمارش نهایی credential خام نیست', closingCount?.authMethod, 'CUSTODY_PIN')
eq('یادداشت نهایی append-only در گزارش می‌ماند', closingCount?.note, 'شمارش نهایی با کسری مستند برای گزارش پایان شیفت.')
eq('destination نهایی مبلغ واقعی شمارش را نگه می‌دارد', Number(disposition?.amount), 920)
eq('destination نهایی نوع تحویل به مدیر را نگه می‌دارد', disposition?.kind, 'TO_MANAGER')
eq('destination نهایی فقط پس از PIN مدیر confirmed است', disposition?.confirmStatus, 'CONFIRMED')
eq('گزارش نام مدیر تأییدکننده را از evidence می‌خواند', disposition?.confirmedByName, 'مدیر گزارش نهایی S386')
eq('tracking نهایی بدون ساختن سند تازه گزارش می‌شود', disposition?.trackingNo, 'S386-FINAL-TRACK')
eq('شمارش شاهد صبح به segment منقضی خودش وصل است', witnessCount?.shiftId, unattended.shiftId)
eq('شمارش شاهد صبح شخص واقعی شمارش‌کننده را دارد', witnessCount?.countedByName, 'شاهد صبح S386')
eq('یادداشت شاهد صبح کنار evidence پایدار است', witnessCount?.note, recoveryNote)
eq('پروندهٔ recovery evidence صریح دارد', resolution?.evidence, 'MORNING_WITNESS')
eq('پروندهٔ recovery resolved است', resolution?.status, 'RESOLVED')
eq('پروندهٔ recovery همان اختلاف immutable شمارش شاهد را نگه می‌دارد', Number(resolution?.provisionalDifference), Number(witnessCount?.differenceCash))
eq('اختلاف واقعی witness از شمارش ۹۴۰ در برابر ledger ۱۰۰۰ می‌آید', Number(resolution?.provisionalDifference), -60)
eq('recovery بدون تصمیم مدیر، مسئولیت را به شاهد نسبت نمی‌دهد', resolution?.attributedToName, null)
eq('recovery بدون تصمیم مدیر، انتساب فردی ندارد', resolution?.differenceAttribution, 'UNASSIGNED')

const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
eq('report فقط فیلدهای غیرمحرمانهٔ Count را نگاشت می‌کند', service.includes('authMethod: row.authMethod') && service.includes('note: row.note ?? null') && !service.includes('hash: row.hash'), true)
eq('report نام تصمیم‌گیرنده/منتسب را server-side resolve می‌کند', service.includes('attributedToName: row.attributedToUserId ? userName.get'), true)
eq('UI شواهد را فقط به‌عنوان خواندنی و غیرمحاسباتی معرفی می‌کند', ui.includes('شواهد نهایی و تطبیق') && ui.includes('مبلغ موردانتظار هرگز در Renderer محاسبه نمی‌شود'), true)
eq('UI نوع terminal evidence و وضعیت disposition را به برچسب ایمن تبدیل می‌کند', ui.includes('custodyCountKindLabel') && ui.includes('custodyDispositionStatusLabel'), true)
eq('بازشدن segment تازه، اسناد نهایی segment پیشین را پنهان نمی‌کند', ui.includes("row.kind !== 'OPENING'") && ui.includes('همهٔ segmentها'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
