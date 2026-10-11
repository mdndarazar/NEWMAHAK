/** نشست ۱۸۱ (S181-D1) — اولین چیزی که در فرایند main بار می‌شود: پچ BigInt→JSON. */
import '@shared/bigintJson'
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { prisma, databaseFile } from './db/client'
import { runMigrations } from './db/migrator'
import { seed } from './db/seed'
import { registerIpcHandlers } from './ipc'
import { scheduleBackup } from './services/BackupService'
import { schedulePriceAdjust } from './services/PriceAdjustService'
import { smsService, smsNotificationSender, setSmsReminderSource, setSmsOutcomeHook } from './services/sms'
import { storeCreditService } from './services/StoreCreditService'
import { setNotificationSender } from './services/NotificationSender'
import { startWooSyncScheduler } from './services/WooSyncService'

let mainWindow: BrowserWindow | null = null

/**
 * آماده‌سازی دیتابیس قبل از هر کوئری.
 *
 * ⚠️ رفع باگ ریشه‌ای: نسخه‌ی قبلی migration را فقط وقتی `app.isPackaged` بود
 * (با `prisma migrate deploy` در یک subprocess) اجرا می‌کرد. یعنی در حالت
 * توسعه، schema.prisma جلو می‌رفت ولی فایل واقعی shop.db عقب می‌ماند و نتیجه‌اش
 * خطاهایی مثل «The column main.SaleInvoice.deductInventory does not exist»
 * در SalesService.create / list بود.
 *
 * حالا در هر دو حالت dev و packaged از یک مسیر واحد رد می‌شویم
 * (src/main/db/migrator.ts) که migration های رسمی prisma/migrations را روی
 * دیتابیس اعمال می‌کند. اگر شکست بخورد، پیام فارسیِ روشن نشان داده می‌شود و
 * برنامه با احترام بسته می‌شود — نه کرش خام Prisma در میانه‌ی ثبت فاکتور.
 */
async function prepareDatabase(): Promise<boolean> {
  await mkdir(join(app.getPath('userData'), 'data'), { recursive: true })
  try {
    const report = await runMigrations()
    if (report.baselined.length)
      console.log('[migrate] baselined (دیتابیس موجود، بدون اجرا):', report.baselined.join(', '))
    if (report.applied.length) console.log('[migrate] applied:', report.applied.join(', '))
    if (report.skipped.length) console.log('[migrate] skipped (از قبل اعمال شده بود):', report.skipped.join(' | '))
    if (!report.applied.length && !report.baselined.length) console.log('[migrate] ساختار دیتابیس به‌روز است')
  } catch (e: any) {
    console.error('[migrate] failed', e)
    dialog.showErrorBox(
      'آماده‌سازی دیتابیس ناموفق بود',
      String(e?.message ?? e) + `\n\nفایل دیتابیس:\n${databaseFile()}`
    )
    return false
  }

  try {
    await prisma.$connect()
    await seed()
    // نشست ۵۹ · خوشه B — ترمیم idempotent پرداختی‌های منفیِ قدیمی (با Audit)؛ شکستش برنامه را نمی‌بندد
    try {
      const { repairLegacyNegativePayments } = await import('./services/SalesService')
      const r = await repairLegacyNegativePayments()
      if (r.fixed) console.log('[repair] legacy negative payments', r)
    } catch (e) {
      console.error('[repair] legacy negative payments failed', e)
    }
  } catch (e: any) {
    console.error('[db] connect/seed failed', e)
    dialog.showErrorBox(
      'اتصال به دیتابیس ناموفق بود',
      'برنامه نتوانست به فایل دیتابیس متصل شود.\n\n' +
        `فایل دیتابیس:\n${databaseFile()}\n\n` +
        'اگر برنامه‌ی دیگری همین فایل را باز کرده است (مثلاً Prisma Studio) آن را ببندید و دوباره تلاش کنید.'
    )
    return false
  }
  return true
}

/**
 * نشست ۸۴ · خوشه H · تصمیم مالک ۴-۳۶: در build نهایی (app.isPackaged) صندوق‌دار
 * هیچ راهی به DevTools ندارد: devTools:false روی پنجره و منوی سفارشی Electron
 * فقط با نقش‌های ویرایش متن (بدون reload/toggleDevTools). در حالت توسعه رفتار
 * قبلی حفظ می‌شود تا کار برنامه‌نویس مختل نشود.
 */
export const DEVTOOLS_ALLOWED = !app.isPackaged

export function productionMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'ویرایش',
      submenu: [
        { role: 'undo', label: 'واگرد' },
        { role: 'redo', label: 'انجام دوباره' },
        { type: 'separator' },
        { role: 'cut', label: 'برش' },
        { role: 'copy', label: 'رونوشت' },
        { role: 'paste', label: 'چسباندن' },
        { role: 'selectAll', label: 'انتخاب همه' }
      ]
    }
  ]
}

function installApplicationMenu() {
  if (DEVTOOLS_ALLOWED) return
  Menu.setApplicationMenu(Menu.buildFromTemplate(productionMenuTemplate()))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    show: false,
    autoHideMenuBar: true,
    title: 'فروش و انبارداری',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEVTOOLS_ALLOWED
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.maximize())
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    // فقط لینک‌های واقعی بیرون باز می‌شوند؛ about:blank و پنجره‌های خالی نه
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' as const }
  })

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  const ready = await prepareDatabase()
  if (!ready) {
    app.quit()
    return
  }
  registerIpcHandlers()
  scheduleBackup()
  // همگام‌سازی خودکار موجودی سایت WooCommerce (فقط stock_quantity؛ خطایش فروشگاه را نمی‌خواباند)
  startWooSyncScheduler()
  // زمان‌بندی خودکار تغییر قیمت گروهی (شروع/پایان سر وقت)
  schedulePriceAdjust()
  /**
   * پنل پیامکی: ساخت قالب‌های سیستمی جاافتاده + آزادکردن قفل‌های یتیم + روشن
   * کردن کارگرِ صف.
   *
   * ⚠️ عمداً `await` نمی‌شود و خطایش برنامه را نمی‌بندد: اگر پیامک کار نکند،
   * فروش و صندوق و گزارش‌ها باید بی‌هیچ اختلالی کار کنند. کارگر هم خودش
   * هیچ‌وقت داخل تراکنش مالی نمی‌رود.
   */
  /**
   * دوزن‌کردنِ «یادآوری اعتبار» به «صف پیامک».
   *
   * ⚠️ این تنها تغییر لازم در سمت اعتبار است: ماژول اعتبار از روز اول پشت درزِ
   * `notificationSender()` نوشته شده بود و هیچ خطی از منطق یادآوری عوض نمی‌شود.
   * ماژول پیامک هم ماژول اعتبار را import نمی‌کند؛ فقط همین‌جا، در نقطه‌ی
   * ترکیب برنامه، به هم دوخته می‌شوند.
   */
  setNotificationSender(smsNotificationSender)

  /**
   * وصل‌کردن زمان‌بند «یادآوری خودکار اعتبار».
   *
   * ⚠️ تصمیم‌گیری سمت اعتبار می‌ماند (`reminderCandidates` همان قاعده‌های
   * سهمیه/فاصله/انصراف را اعمال می‌کند) و ماژول پیامک فقط «کی بفرستد» را
   * می‌داند. هیچ‌کدام از دو ماژول، دیگری را import نمی‌کند.
   */
  setSmsReminderSource({
    name: 'یادآوری اعتبار خرید',
    candidates: async ({ limit }) => {
      const res = await storeCreditService.reminderCandidates({ onlyDue: true, take: limit ?? 200 })
      return (res?.rows ?? []).map((r: any) => ({ id: r?.credit?.id ?? r?.id })).filter((r: any) => Number.isFinite(r.id))
    },
    queue: async ({ id, userId }) => storeCreditService.queueReminder({ id, userId: userId ?? null })
  })

  /**
   * وصل‌کردن «سرانجامِ پیام» به ماژول اعتبار.
   *
   * چرا لازم است: سهمیه‌ی یادآوری در لحظه‌ی پذیرش مصرف می‌شود، ولی پیام می‌تواند
   * بعداً در صف شکست بخورد یا لغو شود. این هوک همان لحظه به اعتبار خبر می‌دهد تا
   * سهمیه آزاد شود و یادآوری «گم» نشود. باز هم هیچ‌کدام از دو ماژول، دیگری را
   * import نمی‌کند؛ فقط همین نقطه‌ی بوت آن‌ها را می‌دوزد.
   */
  setSmsOutcomeHook((e) => {
    if (String(e?.eventType ?? '') !== 'CREDIT_REMINDER') return
    if (e.outcome !== 'FAILED_FINAL' && e.outcome !== 'CANCELED') return
    // نتیجه را برنمی‌گردانیم: هوک «fire-and-forget» است و صف نباید منتظر بماند.
    void storeCreditService.onReminderUndelivered({
      creditId: e.relatedEntityId,
      phone: e.phone,
      outboxId: e.outboxId,
      outcome: e.outcome,
      detail: e.detail
    })
  })
  void smsService
    .start()
    .then((r) => {
      if (r.templatesCreated || r.recovered)
        console.log(`[sms] قالب‌های ساخته‌شده: ${r.templatesCreated} · قفل‌های آزادشده: ${r.recovered}`)
    })
    .catch((e) => console.error('[sms] راه‌اندازی ماژول پیامک ناموفق بود', e))
  installApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await prisma.$disconnect()
  if (process.platform !== 'darwin') app.quit()
})
