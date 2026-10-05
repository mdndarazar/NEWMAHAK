/**
 * نشست ۱۲۹ · ماک کنترل‌پذیر Electron برای تست‌های چاپ و خروجی.
 *
 * فقط رفتارهای مستند را بازتولید می‌کند:
 *   - `WebContents::LoadURL` در Electron هر URL بلندتر از `url::kMaxURLChars`
 *     کرومیوم (2 * 1024 * 1024) را با did-fail-load / ERR_INVALID_URL (-300) رد
 *     می‌کند؛ `loadURL` در JS همان را reject می‌کند.
 *   - callback `webContents.print(options, (success, failureReason))`.
 *   - رویدادهای `render-process-gone` (webContents)، `destroyed` و `closed`.
 *   - صدا زدن متد روی پنجره‌ی ازبین‌رفته ⇒ TypeError('Object has been destroyed').
 * این ماک اجرای واقعی Electron/چاپگر نیست.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CHROMIUM_MAX_URL_CHARS = 2 * 1024 * 1024

export const state = {
  tempRoot: mkdtempSync(join(tmpdir(), 's129-os-temp-')),
  userData: mkdtempSync(join(tmpdir(), 's129-userdata-')),
  documents: mkdtempSync(join(tmpdir(), 's129-docs-')),
  windows: [],
  loads: [],
  printCalls: [],
  pdfCalls: [],
  dialogCalls: [],
  revealed: [],
  focused: null,
  allWindows: null,
  printOutcome: 'success',
  pdfOutcome: 'success',
  dialogResult: { canceled: true, filePath: undefined },
  // نشست ۲۲۲ · فاز ۰ طرح چاپ — اندازه‌گیری ارتفاع محتوا (`executeJavaScript`)
  // و فهرست چاپگرها. پیش‌فرض‌ها رفتار قبلی را حفظ می‌کنند: فهرست چاپگر خالی و
  // اندازه‌گیری «نامعلوم» تا هیچ تست قدیمی‌ای تحت تأثیر قرار نگیرد.
  executeJavaScriptCalls: [],
  executeJavaScriptOutcome: null,
  printers: [],
  /**
   * نشست ۲۲۲ · بازبینی مستقل فاز ۰ (باگ ۷) — تعداد صفحه‌ی PDF ساختگی.
   * پیش‌فرض `null` یعنی رفتار قبلی (بدنه‌ی HTML به‌عنوان PDF برگردد) تا هیچ
   * تستی بی‌خبر از این قابلیت عوض نشود؛ تست‌های شمارش صریحاً عدد را ست می‌کنند.
   */
  pdfPages: null,
  /**
   * نشست ۲۲۲ · فاز ۵ طرح چاپ — خروجی `capturePage` برای مسیر خام (RAW).
   * پیش‌فرض `null` یعنی «تصویر سفید یکدست» (همه‌ی بیت‌ها صفر) تا هیچ تست
   * قدیمی‌ای تحت تأثیر نباشد؛ تست‌های خام صریحاً الگو/بافر می‌دهند (تابع هم
   * پذیرفته می‌شود: `(rect) => Buffer`).
   */
  captureBitmap: null,
  captureCalls: [],
  zoomCalls: [],
  contentSizeCalls: []
}

export function reset() {
  state.windows.length = 0
  state.loads.length = 0
  state.printCalls.length = 0
  state.pdfCalls.length = 0
  state.dialogCalls.length = 0
  state.revealed.length = 0
  state.focused = null
  state.allWindows = null
  state.printOutcome = 'success'
  state.pdfOutcome = 'success'
  state.dialogResult = { canceled: true, filePath: undefined }
  state.executeJavaScriptCalls.length = 0
  state.executeJavaScriptOutcome = null
  state.printers.length = 0
  state.pdfPages = null
  state.captureBitmap = null
  state.captureCalls.length = 0
  state.zoomCalls.length = 0
  state.contentSizeCalls.length = 0
}

const destroyedError = () => new TypeError('Object has been destroyed')

class MockWebContents extends EventEmitter {
  constructor(win) {
    super()
    this._win = win
  }
  print(options, callback) {
    if (this._win._destroyed) throw destroyedError()
    state.printCalls.push({ options })
    const outcome = state.printOutcome
    setImmediate(() => {
      if (outcome === 'success') return callback?.(true, '')
      if (outcome === 'canceled') return callback?.(false, 'canceled')
      if (outcome === 'invalid-device') return callback?.(false, 'Invalid deviceName provided')
      if (outcome === 'no-printers') return callback?.(false, 'No printers available on the network')
      if (outcome === 'failed') return callback?.(false, 'failed')
      if (outcome === 'crash') return this.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
      if (outcome === 'close') return this._win.destroy()
      // 'hang': هیچ پاسخی (شبیه درایوری که هرگز callback نمی‌دهد)
    })
  }
  printToPDF(options) {
    if (this._win._destroyed) return Promise.reject(destroyedError())
    state.pdfCalls.push({ options })
    const outcome = state.pdfOutcome
    if (outcome === 'crash') {
      setImmediate(() => this.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 }))
      return new Promise(() => {})
    }
    if (outcome === 'reject') return Promise.reject(Object.assign(new Error('Failed to generate PDF'), {}))
    // نشست ۲۲۲ · بازبینی مستقل (باگ ۷) — PDF ساختگی با تعداد صفحه‌ی کنترل‌شده.
    const pages = Number(state.pdfPages)
    if (Number.isFinite(pages) && pages > 0) {
      const objs = Array.from({ length: pages }, () => '<< /Type /Page /Parent 1 0 R >>').join('\n')
      return Promise.resolve(
        Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >> endobj\n${objs}\n%%EOF`)
      )
    }
    const html = this._win._html ?? ''
    return Promise.resolve(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(html, 'utf8')]))
  }
  /**
   * نشست ۲۲۲ · فاز ۵ — zoom مسیر خام: `dpi/96` تا هر CSS px یک پیکسل دستگاه شود.
   * (فقط ثبت می‌شود؛ آزمون سخت‌افزاری مالک اندازه‌ی واقعی را تأیید می‌کند.)
   */
  setZoomFactor(factor) {
    if (this._win._destroyed) throw destroyedError()
    state.zoomCalls.push({ factor })
  }
  /**
   * نشست ۲۲۲ · فاز ۵ — `capturePage` ماک: اندازه از `rect` می‌آید و بافر
   * BGRA سفید (یا الگوی تزریق‌شده در `state.captureBitmap`) برمی‌گردد.
   */
  async capturePage(rect) {
    if (this._win._destroyed) throw destroyedError()
    state.captureCalls.push({ rect })
    const width = Math.max(1, Math.round(rect?.width ?? 1))
    const height = Math.max(1, Math.round(rect?.height ?? 1))
    const custom =
      typeof state.captureBitmap === 'function' ? state.captureBitmap(rect) : state.captureBitmap
    const data = custom ? Buffer.from(custom) : Buffer.alloc(width * height * 4, 0xff)
    return {
      toBitmap: () => data,
      getSize: () => ({ width, height }),
      isEmpty: () => false
    }
  }
  async getPrintersAsync() {
    // نشست ۲۲۲ · فاز ۰ — پیش‌فرض همان `[]` قبلی است؛ تست‌های تازه می‌توانند
    // `state.printers` را پر کنند (شیء یا رشته؛ هر دو پشتیبانی می‌شود).
    return state.printers.map((p) =>
      typeof p === 'string' ? { name: p, displayName: p, isDefault: false, status: 0 } : p
    )
  }
  /**
   * نشست ۲۲۲ · فاز ۰ طرح چاپ — اندازه‌گیری ارتفاع محتوا در main از همین متد
   * استفاده می‌کند. مقدار پیش‌فرض `null` است تا هیچ تستی بی‌خبر از این قابلیت
   * رفتار تازه نبیند؛ تست‌های اندازه‌گیری صریحاً عدد را ست می‌کنند.
   */
  async executeJavaScript(code, userGesture) {
    if (this._win._destroyed) throw destroyedError()
    state.executeJavaScriptCalls.push({ code, userGesture })
    const outcome = state.executeJavaScriptOutcome
    if (typeof outcome === 'function') return outcome(code)
    if (outcome === 'reject') throw new Error('executeJavaScript failed')
    if (outcome === 'hang') return new Promise(() => {})
    return outcome
  }
}

export class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super()
    this._options = options
    this._destroyed = false
    this._visible = options.show !== false
    this._html = null
    this._webContents = new MockWebContents(this)
    state.windows.push(this)
  }
  get webContents() {
    return this._webContents
  }
  static getFocusedWindow() {
    return state.focused
  }
  static getAllWindows() {
    if (state.allWindows) return state.allWindows.filter((w) => !w._destroyed)
    return state.windows.filter((w) => !w._destroyed)
  }
  async loadURL(url) {
    if (this._destroyed) throw destroyedError()
    if (url.length > CHROMIUM_MAX_URL_CHARS) {
      const err = new Error(`ERR_INVALID_URL (-300) loading '${url.slice(0, 2048)}'`)
      Object.assign(err, { errno: -300, code: 'ERR_INVALID_URL', url })
      throw err
    }
    const prefix = 'data:text/html;charset=utf-8,'
    this._html = url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : url
    state.loads.push({ via: 'url', chars: url.length, html: this._html })
  }
  async loadFile(path) {
    if (this._destroyed) throw destroyedError()
    this._html = readFileSync(path, 'utf8')
    state.loads.push({ via: 'file', path, html: this._html })
  }
  /** نشست ۲۲۲ · فاز ۵ — اندازه‌ی محتوای پنجره‌ی مخفی مسیر خام (فقط ثبت). */
  setContentSize(width, height) {
    if (this._destroyed) throw destroyedError()
    state.contentSizeCalls.push({ width, height })
  }
  isDestroyed() {
    return this._destroyed
  }
  isVisible() {
    if (this._destroyed) throw destroyedError()
    return this._visible
  }
  destroy() {
    if (this._destroyed) throw destroyedError()
    this._destroyed = true
    this._webContents.emit('destroyed')
    this.emit('closed')
  }
}

export const app = {
  getPath: (name) => (name === 'temp' ? state.tempRoot : name === 'documents' ? state.documents : state.userData),
  /** نشست ۲۲۲ · فاز ۵ — مسیر سورس در dev (برای پیدا کردن `resources/print/raw-print.ps1`). */
  getAppPath: () => process.env.MAHAK_ROOT || process.cwd(),
  getVersion: () => '0.1.0-s129-mock',
  getName: () => 'MahakPOS',
  isPackaged: false,
  on: () => {},
  whenReady: async () => {},
  quit: () => {}
}

export const dialog = {
  async showSaveDialog(parentOrOptions, maybeOptions) {
    const hasParent = maybeOptions !== undefined
    state.dialogCalls.push({ parent: hasParent ? parentOrOptions : null, options: hasParent ? maybeOptions : parentOrOptions })
    return typeof state.dialogResult === 'function' ? state.dialogResult() : state.dialogResult
  }
}

export const shell = {
  showItemInFolder: (p) => state.revealed.push(p),
  openPath: async () => ''
}

export const ipcMain = { handle: () => {}, on: () => {} }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8')
}

export default { app, BrowserWindow, dialog, shell, ipcMain, safeStorage }
