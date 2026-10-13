import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

/**
 * تنها پل renderer و Main. رشته‌ی دلخواه به ipcRenderer عبور نمی‌کند: هر کانال
 * باید یکی از قراردادهای مشترک `IPC` باشد. مجوز واقعی همچنان فقط در Main
 * سنجیده می‌شود؛ این allowlist صرفاً سطح حمله و خطای typo را کوچک می‌کند.
 */
type IpcChannel = (typeof IPC)[keyof typeof IPC]
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

const allowedChannels = new Set<string>(Object.values(IPC))

const api = {
  invoke: <T = unknown>(channel: IpcChannel, payload?: unknown): Promise<IpcResult<T>> => {
    if (!allowedChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: 'این مسیر ارتباطی در نسخهٔ معتبر برنامه مجاز نیست.',
        code: 'IPC_CHANNEL_NOT_ALLOWED'
      })
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>
  },
  channels: IPC
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
