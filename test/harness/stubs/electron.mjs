/** جلسه ۳۵ · هارنس — حداقلِ `electron` که `db/client.ts` و `PanelVault` لازم دارند. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = process.env.HARNESS_DIR || mkdtempSync(join(tmpdir(), 'mahak-harness-'))

export const app = {
  getPath: () => DIR,
  getAppPath: () => process.cwd(),
  getVersion: () => '0.1.0-harness',
  getName: () => 'MahakPOS',
  isPackaged: false,
  on: () => {},
  whenReady: async () => {},
  quit: () => {}
}
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8')
}
export const ipcMain = { handle: () => {}, on: () => {} }
export const BrowserWindow = class {}
export const dialog = { showSaveDialog: async () => ({ canceled: true }) }
export const shell = { openPath: async () => '' }
export default { app, safeStorage, ipcMain, BrowserWindow, dialog, shell }
