/**
 * ===========================================================================
 * پنل پیامکی — نگهبانِ سیم‌کشی (ساختاری، بدون دیتابیس).
 *
 * چرا این تست لازم است: قفل‌های `ManagerGate` فقط UI را می‌پوشانند. اگر یک
 * کانال IPC بدون `assertPanelUnlocked` اضافه شود، همان قفل از بیرونِ UI دور
 * زده می‌شود — و هیچ تست اجرایی این را نمی‌بیند. همین‌طور این تست تضمین می‌کند
 * ماژول پیامک به فروش/اعتبار/گزارش‌ها **دست نزده** باشد (شرط صریح کاربر).
 *
 *     node --import ./test/harness/register.mjs tests/sms/sms-wiring.mjs
 * ===========================================================================
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(new URL('.', import.meta.url).pathname, '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

let ok = 0
let bad = 0
const ok_ = (label, cond, detail = '') => {
  if (cond) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ' · ' + detail : ''}`)
  }
}

const ipcMain = read('src/main/ipc/index.ts')
const ipcShared = read('src/shared/ipc.ts')
const panel = read('src/renderer/src/pages/SmsPanel.tsx')
const routes = read('src/renderer/src/main.tsx')
const shell = read('src/renderer/src/components/Shell.tsx')
const boot = read('src/main/index.ts')

/**
 * بدنه‌ی هندلر یک کانال IPC.
 *
 * ⚠️ چرا شمارش پرانتز کار نمی‌کند: کامنت‌های فارسی همین فایل فهرست‌های
 * شماره‌دار دارند (`۱)`، `۲)`، `۳)`) که پرانتزهای نامتوازن می‌سازند و
 * استخراج‌کننده‌ی ساده را وسط کامنت می‌بُرند (یک بار همین اتفاق افتاد و
 * چهار گزاره را بی‌دلیل قرمز کرد). پس مرز پایان را از خودِ قرارداد فایل
 * می‌گیریم: هر هندلر با یک خط `  })` بسته می‌شود.
 */
function handlerBody(name) {
  const start = ipcMain.indexOf(`handle(IPC.${name}`)
  if (start < 0) return null
  const end = ipcMain.indexOf('\n  })', start)
  if (end < 0) return null
  return ipcMain.slice(start, end + 5)
}

console.log('\n۱) هر کانال IPC از قفل پنل رد می‌شود')
{
  // کانال‌های تعریف‌شده در لایه‌ی مشترک
  const channelKeys = [...ipcShared.matchAll(/^\s{2}(sms[A-Za-z]+):\s*'([^']+)'/gm)].map((m) => m[1])
  ok_('کانال‌های پیامکی در ipc.ts تعریف شده‌اند', channelKeys.length >= 28, `تعداد: ${channelKeys.length}`)

  const guards = { smsPanel: 'assertSms(', smsProvider: 'assertSmsProvider(', smsDanger: 'assertSmsDanger(' }
  const providerOnly = new Set(['smsProviders', 'smsProviderSave', 'smsProviderActivate', 'smsProviderTest'])
  const dangerOnly = new Set(['smsCancelBulk', 'smsRetryNow', 'smsCampaignCreate', 'smsCampaignCancel'])

  const unguarded = []
  const wrongGuard = []
  for (const key of channelKeys) {
    const body = handlerBody(key)
    if (!body) {
      unguarded.push(`${key} (هندلر ندارد)`)
      continue
    }
    const used = Object.entries(guards).filter(([, call]) => body.includes(call)).map(([g]) => g)
    if (!used.length) unguarded.push(key)
    // کانال‌های سرویس‌دهنده باید قفل سرویس‌دهنده داشته باشند و کانال‌های حساس، قفل حساس
    else if (providerOnly.has(key) && !used.includes('smsProvider')) wrongGuard.push(key)
    else if (dangerOnly.has(key) && !used.includes('smsDanger')) wrongGuard.push(key)
    else if (!providerOnly.has(key) && !dangerOnly.has(key) && !used.includes('smsPanel')) wrongGuard.push(key)
  }
  ok_('هیچ کانال بدون قفلی نمانده', unguarded.length === 0, unguarded.join(', '))
  ok_('قفل هر کانال همان قفلِ درست است', wrongGuard.length === 0, wrongGuard.join(', '))

  // هندلرهای پنل هم باید بلوک قفل را داشته باشند (نه فرض بر این‌که UI قفل کرده)
  ok_('هندلر داشبورد قفل دارد', /assertSms\('/.test(handlerBody('smsDashboard') ?? ''))
  ok_('هندلر ارسال دستی قفل دارد', /assertSms\('/.test(handlerBody('smsSendManual') ?? ''))
  ok_('هندلر لغو تک‌پیام قفل دارد', /assertSms\('/.test(handlerBody('smsCancel') ?? ''))
  ok_('هندلر برگرداندن به صف قفل دارد', /assertSms\('/.test(handlerBody('smsRequeue') ?? ''))

  // actor فقط از نشست main؛ هیچ کانالی userId را از payload نمی‌گیرد
  ok_('هیچ کانالی userId را از ورودی برنمی‌دارد', !/handle\(IPC\.sms[\s\S]*?\.userId\b/.test(ipcMain))
  ok_('لغو/برگرداندن actor را از نشست می‌گیرند', /shiftService\.currentStaffId\(\)/.test(handlerBody('smsCancel') ?? ''))
}

console.log('\n۲) کلید API فقط با رمز مدیر')
{
  const cred = read('src/main/services/sms/SmsCredentials.ts')
  ok_('ذخیره‌ی راز، رمز مدیر می‌خواهد', /assertManagerPassword\(/.test(cred))
  ok_('راز با گاوصندوق مهر می‌شود', /sealSecret\(/.test(cred))
  ok_('فایل هیچ‌جا راز را چاپ نمی‌کند', !/console\.(log|info|error)\([^)]*apiKey/i.test(cred))
  ok_('کلید خام در پیام‌های فارسی چاپ نمی‌شود', !/note:[^\n]*apiKey/.test(cred))
}

console.log('\n۳) جداسازی: ماژول پیامک به فروش/اعتبار/گزارش دست نمی‌زند')
{
  const dir = join(ROOT, 'src/main/services/sms')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  const all = files.map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n')
  const forbidden = ['SalesService', 'StoreCreditService', 'AccountingReport', 'accountingReport', 'CashboxService', 'SalesLedger', 'MergeService']
  const hit = forbidden.filter((n) => all.includes(`from '../${n}'`) || all.includes(`from './${n}'`))
  ok_('هیچ سرویس فروش/اعتبار/گزارشی import نمی‌شود', hit.length === 0, hit.join(', '))

  // جهت مخالف: سرویس‌های موجود نباید به ماژول پیامک وابسته شوند (جز بوت/IPC)
  const dependents = []
  for (const f of readdirSync(join(ROOT, 'src/main/services')).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(join(ROOT, 'src/main/services', f), 'utf-8')
    if (/from '\.\/sms'/.test(src)) dependents.push(f)
  }
  ok_('هیچ سرویس موجودی به ماژول پیامک وصل نشده', dependents.length === 0, dependents.join(', '))

  // و ماژول در هیچ تراکنش مالی صدا زده نمی‌شود
  const sales = read('src/main/services/SalesService.ts')
  ok_('SalesService هیچ ارجاعی به پیامک ندارد', !/sms/i.test(sales))
  ok_('بوت، صف را fire-and-forget روشن می‌کند', /void smsService[\s\S]{0,40}?\.start\(\)/.test(boot))
  ok_('بوت، صف را await نمی‌کند', !/await smsService\.start\(\)/.test(boot))

  // تنها اتصال مجاز به فروش در فاز بعد: NotificationSender (که هنوز دست‌نخورده است)
  const notify = read('src/main/services/NotificationSender.ts')
  ok_('فرستنده‌ی قدیمی دست‌نخورده مانده (اتصال واقعی هنوز تزریق نشده)', !/sms/i.test(notify) || /پنل پیامک/.test(notify))
}

console.log('\n۴) سیم‌کشی UI')
{
  ok_('صفحه route دارد', /path: 'sms-panel'/.test(routes))
  ok_('صفحه پشت ManagerGate است', /<ManagerGate[\s\S]{0,400}?<SmsPanel \/>/.test(routes))
  ok_('قفل صفحه smsPanel است', /panel=\{PANEL_KEYS\.smsPanel\}/.test(routes))
  ok_('آیتم ناوبری دارد', /to: '\/sms-panel'/.test(shell))

  const dashboard = read('src/renderer/src/pages/Dashboard.tsx')
  ok_('کاشی صفحه‌ی اصلی دارد', /to: '\/sms-panel'/.test(dashboard))

  // هر کانال تعریف‌شده باید در UI مصرف شود، و هر مصرف باید تعریف شده باشد
  const defined = new Set([...ipcShared.matchAll(/^\s{2}(sms[A-Za-z]+):/gm)].map((m) => m[1]))
  const used = new Set([...panel.matchAll(/CH\.(sms[A-Za-z]+)/g)].map((m) => m[1]))
  const unused = [...defined].filter((k) => !used.has(k))
  const undefined_ = [...used].filter((k) => !defined.has(k))
  ok_('هیچ کانالی در UI بی‌استفاده نمانده', unused.length === 0, unused.join(', '))
  ok_('هیچ کانال ناشناسی صدا زده نمی‌شود', undefined_.length === 0, undefined_.join(', '))

  // هر سه قفل ماژول در UI به‌کار رفته‌اند
  for (const key of ['smsPanel', 'smsProvider', 'smsDanger'])
    ok_(`قفل ${key} در UI مصرف شده`, new RegExp(`PANEL_KEYS\\.${key}\\b`).test(panel) || new RegExp(`PANEL_KEYS\\.${key}\\b`).test(routes))

  // پنل نباید رکورد مالی بخواند: تنها کانال‌هایی که صدا می‌زند باید sms:* باشند
  const called = [...panel.matchAll(/call<[^>]*>\(CH\.([A-Za-z]+)|call\(CH\.([A-Za-z]+)/g)].map(
    (m) => m[1] ?? m[2]
  )
  const nonSms = [...new Set(called)].filter((k) => !k.startsWith('sms'))
  ok_('پنل هیچ کانال غیرپیامکی صدا نمی‌زند', nonSms.length === 0, nonSms.join(', '))
  ok_(
    'پنل هیچ ماژول مالی import نمی‌کند',
    !/from '@shared\/(credit|receipt)'/.test(panel) && !/services\/(StoreCredit|SalesService)/.test(panel)
  )
}

console.log('\n۵) قلاب «تشکر از خرید» بیرون از تراکنش فروش است')
{
  /**
   * ساختار عمدی: هندلر `sale:create` یک‌خطی مانده (نگهبان ساختاری نشست ۱۸۲
   * می‌گوید همین خط باید `withSessionActor(...)` را داشته باشد) و قلاب تشکر در
   * هلپر `afterSaleThankYou` است. پس هر دو چیز اینجا سنجیده می‌شود.
   */
  const helperAt = ipcMain.indexOf('const afterSaleThankYou')
  const helper = helperAt < 0 ? '' : ipcMain.slice(helperAt, ipcMain.indexOf('\n  handle(IPC.saleCreate', helperAt))
  ok_('هلپر «تشکر از خرید» وجود دارد', helper.length > 0)
  ok_('هلپر پیام را در صف می‌گذارد', /smsService\s*\.\s*notifySaleCreated\(/.test(helper))
  ok_('و آن را await نمی‌کند (فروش منتظر پیامک نمی‌ماند)', !/await\s+smsService\s*\.\s*notifySaleCreated/.test(helper))
  ok_('fire-and-forget است', /void\s+smsService/.test(helper))
  ok_('خطای احتمالی هم گرفته می‌شود', /\.catch\(/.test(helper))
  ok_('فاکتور دست‌نخورده برمی‌گردد', /return invoice/.test(helper))
  ok_('هلپر فقط فاکتورِ ساخته‌شده را await می‌کند (نه پیامک را)', /const invoice = await created/.test(helper))

  // ⚠️ باید خطِ *خودِ کد* پیدا شود نه کامنتی که همین نام را نقل می‌کند
  const saleLine = ipcMain.split('\n').find((l) => l.trim().startsWith('handle(IPC.saleCreate')) ?? ''
  ok_('خط sale:create هم قلاب را دارد', /afterSaleThankYou\(/.test(saleLine))
  ok_('و هم نشست بازِ کارمند را (قرارداد نشست ۱۸۲ دست‌نخورده)', /withSessionActor\(p \?\? \{\}, 'ثبت فاکتور فروش'\)/.test(saleLine))

  const notify = read('src/main/services/sms/SmsSaleNotify.ts')
  ok_('خودِ تابع هم هرگز throw نمی‌کند (try/catch سراسری)', /catch \(e/.test(notify))
  ok_('کلید یکتا روی خودِ فاکتور بسته می‌شود', /entityType: 'SaleInvoice'/.test(notify) && /entityId: invoice\.id/.test(notify))
  ok_('سند تعویض پیام تشکر نمی‌گیرد', /SKIP_ORDER_TYPES/.test(notify) && /OrderType\.EXCHANGE/.test(notify))
  ok_('عمده قالب جداگانه دارد', /SALE_THANK_YOU_WHOLESALE/.test(notify))
  ok_('سرویس فروش را import نمی‌کند (وابستگی یک‌طرفه)', !/from '\.\.\/SalesService'/.test(notify))
  ok_('پیش‌فرض کلید تشکر، خاموش است', /DEFAULT_SMS_THANK_YOU = false/.test(read('src/shared/sms.ts')))
}

console.log('\n۶) هیچ import مضری در لایه‌ی رندرر نیست')
{
  // الگوی اشتباه گذشته: require(...) داخل render — در ESM/rnderer می‌ترکد
  ok_('در صفحه‌ی پنل require( نیست', !/\brequire\(/.test(panel))
  ok_('jalaliAtClock در بالای فایل import شده', /import \{[^}]*jalaliAtClock[^}]*\} from '@shared\/jalali'/.test(panel))
  ok_('از window/node مستقیم استفاده نمی‌شود', !/\bwindow\.(require|process)\b/.test(panel))
}

console.log('\n۷) آداپتورهای واقعی — امنیت و صداقت')
{
  const providers = read('src/main/services/sms/providers.ts')
  ok_('فقط https — هیچ آدرس ناامنی نیست', !/['"`]http:\/\//.test(providers))
  ok_('کلید API هرگز چاپ نمی‌شود', !/console\.(log|info|error)\([^)]*apiKey/i.test(providers))
  ok_('هر دو سرویس‌دهنده «زنده» علامت خورده‌اند', /key: 'SMS_IR'[\s\S]{0,200}live: true/.test(providers) && /key: 'KAVENEGAR'[\s\S]{0,200}live: true/.test(providers))
  ok_('پیش‌نیاز ناقص ⇒ بدون تماس شبکه', /PROVIDER_NOT_CONFIGURED/.test(providers) && /if \(missing\.length\) return notConfigured/.test(providers))
  ok_('مهلت ⇒ «نامعلوم» نه «شکست»', /PROVIDER_TIMEOUT/.test(providers) && /unknown: true/.test(providers))
  ok_('خطای شبکه ⇒ تلاش مجدد', /PROVIDER_UNREACHABLE/.test(providers) && /retryable: true/.test(providers))
  ok_('تست اتصال واقعاً به سرویس‌دهنده وصل می‌شود', /async probe\(/.test(providers) && /provider\.probe\(cfg\)/.test(read('src/main/services/sms/SmsCredentials.ts')))
}

console.log('\n۸) فاز ۴ — کمپین، «لغو ۱۱» و قفل‌ها')
{
  const queue = read('src/main/services/sms/SmsQueue.ts')
  const camp = read('src/main/services/sms/SmsCampaignService.ts')
  const ipcShared = read('src/shared/ipc.ts')

  ok_('پیام تبلیغاتی برای شماره‌ی لغوکرده صف نمی‌شود', /smsNeedsOptOutNote\(input\.eventType\)/.test(queue) && /smsOptOut[\s\S]{0,120}findUnique/.test(queue))
  ok_('جمله‌ی لغو در خودِ صف هم تضمین می‌شود (نه فقط UI)', /body = smsWithOptOutNote\(body, note\)/.test(queue))
  ok_('جمله‌ی لغو از تنظیمات می‌آید نه از ثابت کد', /readOptOutNote\([^)]*\)[\s\S]*SMS_SETTING_KEYS\.optOutNote/s.test(queue))

  ok_('کمپین هیچ جدول مالی‌ای را نمی‌نویسد', !/prisma as any\)\.(saleInvoice|storeCredit|payment|saleReturn|cheque)/.test(camp))
  ok_('کمپین فقط صف می‌کند (ارسال فوری ندارد)', /enqueueSms\(/.test(camp) && !/runSmsQueueOnce|provider\.send/.test(camp))
  ok_('اولویت کمپین از shared می‌آید (۷)', /SMS_CAMPAIGN_PRIORITY/.test(camp))
  ok_('لغو گروهی فقط ارسال‌نشده‌ها را می‌گیرد', /SMS_CANCELABLE_STATUSES/.test(camp) && /campaignId: id, status: \{ in:/.test(camp))
  ok_('snapshot جمله‌ی لغو در کمپین ذخیره می‌شود', /optOutNote: note/.test(camp))

  const channels = [
    'smsCampaignBank', 'smsCampaignPreview', 'smsCampaignCreate', 'smsCampaignList',
    'smsCampaignDetail', 'smsCampaignCancel', 'smsOptOutList', 'smsOptOutAdd', 'smsOptOutRemove'
  ]
  ok_('همه‌ی کانال‌های کمپین تعریف شده‌اند', channels.every((c) => ipcShared.includes(`  ${c}: `)))
  ok_(
    'همه‌ی کانال‌ها هندلر دارند',
    channels.every((c) => ipcMain.includes(`IPC.${c}`))
  )
  ok_(
    'ثبت کمپین و لغو گروهی قفل عملیات حساس دارند',
    /IPC\.smsCampaignCreate[\s\S]{0,120}assertSmsDanger/.test(ipcMain) &&
      /IPC\.smsCampaignCancel[\s\S]{0,120}assertSmsDanger/.test(ipcMain)
  )
  ok_('بقیه فقط قفل خودِ پنل را دارند (نه بیشتر)', /IPC\.smsOptOutAdd[\s\S]{0,80}assertSms\(/.test(ipcMain))

  ok_('تب «ارسال انبوه» در UI هست', /id: 'campaign', label: 'ارسال انبوه'/.test(panel))
  ok_('و کامپوننتش رندر می‌شود', /tab === 'campaign' && <CampaignTab/.test(panel))
  ok_('پیش‌نمایش قبل از ثبت اجباری است', /!freshPreview \|\| !\(pv\?\.sendable > 0\)/.test(panel))
}

console.log('\n۹) پلِ یادآوری اعتبار ← صف پیامک')
{
  const port = read('src/main/services/NotificationSender.ts')
  ok_(
    'درزِ فرستنده دست‌نخورده مانده (بدون شبکه، بدون import از پیامک)',
    !/fetch\(|axios/.test(port) && !/from '\.\/sms|from '\.\.\/services\/sms/.test(port)
  )
  ok_('پیش‌فرضِ درز همچنان «بدون ارسال واقعی» است', /live: false/.test(port))

  const bridge = read('src/main/services/sms/SmsNotificationSender.ts')
  ok_('پل، درز را از سمت پیامک پر می‌کند (import یک‌طرفه)', /from '\.\.\/NotificationSender'/.test(bridge))
  ok_('پل پیام را در صف می‌گذارد (نه ارسال فوری)', /enqueueSms\(/.test(bridge) && !/provider\.send|fetch\(/.test(bridge))
  ok_('اولویت تراکنشی است (۳)', /priority: 3/.test(bridge))
  ok_('دو بار کلیک در یک روز ⇒ یک پیام', /smsDedupeKey\(/.test(bridge) && /res\.duplicate/.test(bridge))

  ok_('بوت، پل را تزریق می‌کند (تنها نقطه‌ی اتصال)', /setNotificationSender\(smsNotificationSender\)/.test(boot))
  ok_('بوت، منبع یادآوری را هم تزریق می‌کند', /setSmsReminderSource\(\{/.test(boot))
  ok_('و فهرست کاندیدها فقط «واجد شرایط» را می‌گیرد', /reminderCandidates\(\{ onlyDue: true/.test(boot))

  const svc = read('src/main/services/sms/SmsService.ts')
  ok_('تزریق از سمت پیامک است، نه import اعتبار', !/from '.*StoreCreditService/.test(svc))
  ok_('زمان‌بند، «یک بار در روز» را در دیتابیس نگه می‌دارد', /SMS_SETTING_KEYS\.autoLastRun/.test(svc))
  ok_(
    'روز *قبل* از پردازش نشان‌گذاری می‌شود (خطا حلقه‌ی روزانه نمی‌سازد)',
    svc.indexOf('writeSetting(SMS_SETTING_KEYS.autoLastRun') < svc.indexOf('reminderSource.candidates({')
  )
  ok_('زمان‌بند در start() روشن می‌شود', /startSmsAuto\(\)/.test(svc))
  ok_('و خاک‌اندازش برنامه را بیدار نگه نمی‌دارد', /unref\(\)/.test(svc))
  ok_('و ماژول اعتبار هیچ importی از پیامک ندارد', !/from '.*sms/i.test(read('src/main/services/StoreCreditService.ts')))
}

// ---------------------------------------------------------------------------
console.log('\n۱۰) دو خط: خدماتی جدا از تبلیغاتی (ساختاری)')
{
  const shared = read('src/shared/sms.ts')
  const cred = read('src/main/services/sms/SmsCredentials.ts')
  const queue = read('src/main/services/sms/SmsQueue.ts')
  const schema = read('prisma/schema.prisma')

  ok_('ستون کاربرد خط در اسکیما هست (پیش‌فرض هر دو کاره)', /purpose\s+String\s+@default\("BOTH"\)/.test(schema))
  const migDir = readdirSync(join(ROOT, 'prisma', 'migrations')).find((d) => d.includes('sms_line_purpose'))
  ok_(
    'مهاجرت افزایشی ستون را اضافه می‌کند',
    Boolean(migDir) && /ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'BOTH'/.test(read(join('prisma', 'migrations', migDir, 'migration.sql')))
  )
  ok_('کاربرد خط و انتخابگرش در shared تعریف شده‌اند', /SMS_LINE_PURPOSES/.test(shared) && /pickSmsLine/.test(shared))
  ok_(
    'صف خطِ هر پیام را جدا انتخاب می‌کند (نه یکی برای همه)',
    /pickSmsLine\(lines, wanted\)/.test(queue) && /smsLinePurposeForEvent\(row\.eventType\)/.test(queue)
  )
  ok_('ردیف «فقط اولین سرویس‌دهنده‌ی فعال» حذف شده', !/const active = await \(prisma as any\)\.smsProviderConfig/.test(queue))
  ok_('فعال‌سازی، رقبا را (با نرمال‌سازی) خاموش می‌کند', /smsLineMatchesPurpose\(r\.purpose/.test(cred) && /SMS_LINE_PURPOSES\.BOTH/.test(cred))
  ok_('خطِ هر ارسال در سابقه ثبت می‌شود', /providerConfigId: providerCfg\.id/.test(queue))
  ok_('پنل ستون «کاربرد خط» و انتخابگرش را دارد', /کاربرد خط/.test(panel) && /SMS_LINE_PURPOSE_LABELS/.test(panel))
  ok_('و نوار هشدار «خط مناسب فعال نیست» را نشان می‌دهد', /خط خدماتی فعال ندارید/.test(panel) && /خط تبلیغاتی فعال ندارید/.test(panel))
  ok_('داشبورد هر دو خط را جدا می‌دهد', /providerService/.test(panel) && /providerAds/.test(panel))
}

// ---------------------------------------------------------------------------
console.log('\n۱۱) قفل‌های تازه‌ی رفع‌باگ‌ها (بازبینی دوم)')
{
  const queue = read('src/main/services/sms/SmsQueue.ts')
  const cred = read('src/main/services/sms/SmsCredentials.ts')
  const shared = read('src/shared/sms.ts')
  const sender = read('src/main/services/sms/SmsNotificationSender.ts')

  ok_(
    'لغو/تلاش مجدد شرطی می‌نویسند (نه روی ردیفِ کارگر)',
    /status: \{ in: \[\.\.\.SMS_CANCELABLE_STATUSES\] \}/.test(queue) &&
      /updateMany\(\{[\s\S]{0,120}status: \{ in: allowed \}/.test(queue)
  )
  ok_(
    'ردیف «در پرواز» هنگام خطای ثبت، UNKNOWN می‌شود',
    /RESULT_NOT_RECORDED/.test(queue) && /inFlight/.test(queue)
  )
  ok_('بازیابی قفل یتیم هم «در پرواز» را جدا می‌کند', /SENDING_MARKER/.test(queue) && /neverStarted/.test(queue))
  ok_('گرسنگی صف با فیلتر نوع رویداد بسته شده', /eventFilter/.test(queue) && /canAds/.test(queue))
  ok_('لغو ۱۱ شکست‌بسته شده (fail-closed)', /sms:optout\] read failed/.test(queue))
  ok_('«برگرداندن به صف» برای ردیف کمپین قفل حساس می‌خواهد', /meta\.isCampaign/.test(ipcMain) && /assertSmsDanger\('برگرداندن پیام کمپین به صف'\)/.test(ipcMain))
  ok_('متای پیام از خود سرویس می‌آید (بدون خواندن مستقیم دیتابیس در IPC)', /async meta\(/.test(queue))
  ok_(
    'تغییر مقصد کلید (baseUrl/نوع) رمز مدیر می‌خواهد',
    /routeChanged/.test(cred) && /تغییر مقصد\/نوع اتصال کلید API پیامک/.test(cred)
  )
  ok_('نبودِ providerKey مقدار قبلی را دست‌نخورده می‌گذارد', /input\?\.providerKey != null/.test(cred))
  ok_('یادآوری تکراری سهمیه مصرف نمی‌کند', /ok: false[\s\S]{0,160}سهمیه مصرف نشد/.test(sender))
  ok_('زمان‌بند بازه‌ی جبران دارد', /SMS_AUTO_CATCHUP_MINUTES/.test(shared) && /catchupMinutes/.test(shared))
  ok_('پیام UNKNOWN صریحاً از تلاش خودکار کنار گذاشته شده', /SMS_RETRY_BLOCKED_STATUSES/.test(shared))

  /**
   * «نتیجه نامعلوم» تنها وضعیتی است که تصمیمش با آدم است. اگر UI توضیح ندهد،
   * اپراتور یا بی‌خیال رد می‌شود یا بی‌احتیاط «تلاش مجدد» می‌زند (پیام دوم).
   */
  ok_('در فهرست، ردیف UNKNOWN هشدار متنی دارد', /ممکن است رسیده باشد — با احتیاط/.test(panel))
  ok_('در جزئیات پیام، توضیح و راهنمای تصمیم هست', /نتیجه‌اش ثبت نشد؛ ممکن است رسیده باشد/.test(panel))
  ok_(
    'و دیالوگ تلاش مجدد برای UNKNOWN متن اختصاصی می‌دهد (نه هشدار عمومی)',
    /retryTarget\?\.status === 'UNKNOWN'/.test(panel) && /ممکن است رسیده باشد\. تلاش مجدد می‌تواند پیام دوم/.test(panel)
  )
}

// ---------------------------------------------------------------------------
console.log('\n۱۲) گاردهای «دوباره زدن» — باگ اول بازبینی سوم')
{
  const dialog = read('src/renderer/src/components/ConfirmDialog.tsx')
  const camp = read('src/main/services/sms/SmsCampaignService.ts')
  const sharedSms = read('src/shared/sms.ts')
  const svcSms = read('src/main/services/sms/SmsService.ts')

  ok_(
    'Enter در دیالوگ تأیید وقتی کار در جریان است کار نمی‌کند',
    /e\.key === 'Enter' && !busy/.test(dialog)
  )
  ok_('و busy در وابستگی‌های شنونده هست', /\[open, onCancel, onConfirm, busy\]/.test(dialog))
  ok_('پنل، گارد ورود دوباره‌ی کارها دارد', /actBusyRef/.test(panel) && /return null/.test(panel))

  ok_('کمپین، قفل ساخت هم‌زمان دارد', /createInFlight/.test(camp))
  ok_('و گارد «همان کمپین» با اثرانگشت متن+شماره‌ها+زمان', /campaignFingerprint/.test(camp) && /sha1/.test(camp))
  ok_('و اثرانگشت فقط بعد از ثبت موفق نگه داشته می‌شود', /recentFingerprints\.set\(fingerprint/.test(camp))

  ok_('فهرست وضعیت‌های «تکراری» در shared تعریف شده', /SMS_DUPLICATE_GUARD_STATUSES/.test(sharedSms))
  const guardBlock = sharedSms.match(/SMS_DUPLICATE_GUARD_STATUSES[^]*?\n\]/)?.[0] ?? ''
  ok_('و ردیف لغو/ناموفق‌قطعی در آن نیست (وگرنه پیام گم می‌شد)', !/CANCELED|FAILED_FINAL/.test(guardBlock))
  ok_('و SmsService از همان فهرست استفاده می‌کند', /SMS_DUPLICATE_GUARD_STATUSES/.test(svcSms))
  ok_(
    'و متنِ مقایسه با «لغو ۱۱» ساخته می‌شود (نه متن خام)',
    /const twinBody = smsNeedsOptOutNote\(eventType\)[^]*?smsWithOptOutNote\(body,/.test(svcSms)
  )
}

// ---------------------------------------------------------------------------
console.log('\n۱۳) گارد «سهمیه‌ی یادآوری» — باگ‌های بازبینی چهارم')
{
  const sharedSms = read('src/shared/sms.ts')
  const queue = read('src/main/services/sms/SmsQueue.ts')
  const bridge2 = read('src/main/services/sms/SmsNotificationSender.ts')
  const svc = read('src/main/services/sms/SmsService.ts')

  ok_('گارد خالص «یادآوریِ سهمیه‌آزادشده» در shared هست', /export function smsReminderManualResendBlocked/.test(sharedSms))
  ok_('و requeue سرویس را می‌بندد (قوی‌تر از گارد IPC)', /async requeue\([^)]*source\?: 'panel' \| 'credit_bridge'/.test(queue))
  ok_('و retryNow هم همین گارد را دارد', /async retryNow[^]*?smsReminderManualResendBlocked/.test(queue))
  ok_('پل اعتبار با `credit_bridge` از گارد رد می‌شود (مسیر درست باز است)', /source: 'credit_bridge'/.test(bridge2))

  ok_('فهرست پنل دکمه‌ی بازگرداندن را برای این ردیف‌ها خاموش می‌کند', /canRequeue: isSmsRequeueable\(status\) && !blockedManualResend/.test(svc))
  ok_('و پرچم راهنما به UI می‌دهد', /reminderNeedsCreditPanel/.test(svc) && /reminderNeedsCreditPanel/.test(panel))
  ok_('و UI به‌جای دکمه، «از پنل اعتبار بفرستید» نشان می‌دهد', /از پنل اعتبار بفرستید/.test(panel))

  ok_('لغو گروهی فقط ردیف‌های لغوپذیر را می‌خواند (نه هر id فهرست)', /const cancelable = await[^]*?SmsOutboxStatus\.PENDING[^]*?findMany/.test(queue))
  ok_('و فقط برای همان‌ها رویداد می‌فرستد', /const stillCanceled = await[^]*?emitOutcome/.test(queue))
  ok_('و `emitOutcome` رویداد مربوط به ردیفِ غیرآخرین یادآوری را دور می‌ریزد', /const latest = await[^]*?CREDIT_REMINDER[^]*?orderBy: { id: 'desc' }/.test(queue))
}

// ---------------------------------------------------------------------------
console.log('\n۱۴) قفل و `force` کانال یادآوری اعتبار — باگ بازبینی پنجم')
{
  const ipc = read('src/main/ipc/index.ts')
  const creditShared = read('src/shared/credit.ts')
  const creditSvc = read('src/main/services/StoreCreditService.ts')
  const providers = read('src/main/services/sms/providers.ts')

  const start = ipc.indexOf('handle(IPC.creditReminderQueue')
  const end = ipc.indexOf('handle(IPC.creditReminderLogs')
  const queueHandler = start < 0 ? '' : ipc.slice(start, end > start ? end : start + 2500)
  ok_('کانال یادآوری اعتبار، قفل پنل دارد (دیگر بدون گیت نیست)', /await assertCreditPanel\(|await assertCreditRead\(/.test(queueHandler))
  ok_(
    'و `force` را از payload رندرر عبور نمی‌دهد (فقط id)',
    /withOptionalSessionActor\(\{ id:/.test(queueHandler) && !/withOptionalSessionActor\(p \?\? \{\}\)/.test(queueHandler)
  )
  ok_('و قفل نوشتنی هم به همان کلید پنل اعتبار وصل است', /const assertCreditPanel = \(what: string\) => assertPanelUnlocked\(CREDIT_READ_PANEL/.test(ipc))

  ok_('دلیل‌های «قابل‌رد» و «غیرقابل‌رد» در shared کد ماشین‌خوان دارند', /REMINDER_FORCEABLE_CODES/.test(creditShared))
  ok_('و `force` فقط از همان‌ها رد می‌شود', /input\.force === true && isReminderForceable\(decision\.code\)/.test(creditSvc))
  const sharedSms = read('src/shared/sms.ts')
  const queueSrc = read('src/main/services/sms/SmsQueue.ts')
  ok_('«منتظرِ شرایط» ثابت‌های خودش را دارد (فاصله‌ی ثابت + سقف سنی)', /SMS_WAITING_BACKOFF_MS/.test(sharedSms) && /SMS_WAITING_MAX_AGE_MS/.test(sharedSms))
  ok_('صف در این حالت بودجه‌ی تلاش را پس می‌نویسد (نمی‌سوزاند)', /attemptCount: budgetBurned \? nextCount : attemptsMade/.test(queueSrc))
  ok_('و سنِ انتظار از اولین تلاش WAITING شمرده می‌شود، نه از createdAt', /result: 'WAITING'/.test(queueSrc) && /waitingSince/.test(queueSrc))
  const creditSvcSrc = read('src/main/services/StoreCreditService.ts')
  ok_('کاندیدهای یادآوری، پیش‌فیلتر سررسید دارند (نه فیلتر بعد از take)', /function duePrefilter/.test(creditSvcSrc))
  ok_('و پویش صفحه‌به‌صفحه تا جمع شدن take ردیفِ واجد شرایط', /maxPages/.test(creditSvcSrc) && /skip \+= rows\.length/.test(creditSvcSrc))
  /**
   * 🔴 بازبینی دهم: شرط مثبتِ پیش‌فیلتر فقط وقتی اضافه می‌شود که
   * `minDaysSinceIssue > 0` باشد؛ وگرنه اعتبارهای بدون‌انقضا می‌افتند.
   */
  const prefilter = creditSvcSrc.slice(creditSvcSrc.indexOf('function duePrefilter'))
  ok_('پیش‌فیلتر: شرط مثبت فقط با minDaysSinceIssue>۰ ساخته می‌شود', /if \(settings\.minDaysSinceIssue > 0\) \{/.test(prefilter))
  ok_('و «نزدیک انقضا» هم داخل همان شرط است (نه OR جدا)', !/if \(positive\.length\) and\.push/.test(prefilter))

  /**
   * 🔴 بازبینی دهم: خواندن‌های enqueueSms داخل تراکنش نباید `prisma` سراسری بزنند.
   */
  ok_('جمله‌ی لغو با کلاینتِ داده‌شده خوانده می‌شود', /readOptOutNote\(client: any = prisma\)/.test(queueSrc))
  ok_('و بررسی «لغو ۱۱» هم با همان کلاینت است، نه prisma سراسری', /db\.smsOptOut\.findUnique/.test(queueSrc))
  const enqueueBody = queueSrc.slice(queueSrc.indexOf('export async function enqueueSms'), queueSrc.indexOf('async function pickDue'))
  ok_('و هیچ خواندن سراسری‌ای در enqueueSms نمانده', !/\(prisma as any\)\.(smsOptOut|setting)/.test(enqueueBody))
  ok_('و نتیجه‌ی تلاش WAITING ثبت می‌شود', /'WAITING'/.test(queueSrc))
  const forceable =
    creditShared.match(/REMINDER_FORCEABLE_CODES:[^=]*=\s*\[([^\]]*)\]/)?.[1] ??
    creditShared.slice(creditShared.indexOf('REMINDER_FORCEABLE_CODES'), creditShared.indexOf('REMINDER_FORCEABLE_CODES') + 200)
  ok_('فهرست «قابل‌رد» فقط چهار دلیل زمان‌بندی/سهمیه است', /DISABLED/.test(forceable) && /MAX_COUNT/.test(forceable) && /'GAP'/.test(forceable) && /NOT_DUE/.test(forceable))
  ok_('و کد باطل/مصرف‌شده/Opt-out در آن نیست', !/'STATUS'/.test(forceable) && !/'OPTOUT'/.test(forceable) && !/'NO_PHONE'/.test(forceable))

  /**
   * کد «اعتبار کافی نیست»: کاوه‌نگار ۴۱۸ (نه ۴۰۲) و sms.ir کد وضعیت ۱۰۲.
   * اگر قطعی حساب شوند، بعد از شارژ حساب هیچ پیامی خودکار نمی‌رود.
   */
  ok_('کاوه‌نگار: ۴۱۸ ⇒ موقتی', /status === 402 \|\| status === 409 \|\| status === 418/.test(providers))
  ok_('sms.ir: کد وضعیت ۱۰۲ ⇒ موقتی', /const creditShort = code === 102/.test(providers))
  ok_('و HTTP 402/408/429/503 موقتی‌اند (شارژ/دیرشدن ⇒ تأخیر، نه گم‌شدن)', /status === 402 \|\| status === 408 \|\| status === 429 \|\| status === 503/.test(providers))

  /**
   * 🔴 بازبینی ششم:
   *  • کاوه‌نگار وقتی همان کد را در HTTP هم برمی‌گرداند (۴۱۸/۴۰۹)، باید از
   *    **بدنه** طبقه‌بندی شود، نه از کد HTTP (وگرنه قطعی می‌شود).
   *  • ۵۰۰/۵۰۲/۵۰۴ «نامعلوم»اند، نه «قابل تلاش مجدد» (پیام دوم نرود).
   */
  ok_('کاوه‌نگار: مرجعِ خطا بدنه‌ی return.status است، نه کد HTTP', /bodyStatus > 0/.test(providers))
  ok_('و ۵xx (جز ۵۰۳) «نامعلوم» می‌شود، نه قابل‌تلاش‌مجدد', /const ambiguous = status >= 500 && status !== 503/.test(providers))
  ok_('و همان شرط، پرچم unknown را ست می‌کند', /ambiguous \? \{ unknown: true \}/.test(providers))
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
