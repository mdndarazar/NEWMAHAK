import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

/** تنها پل بین renderer و main. renderer هیچ دسترسی مستقیمی به Node/DB ندارد. */
const api = {
  invoke: <T = unknown>(
    channel: string,
    payload?: unknown
  ): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: 'PRINT_CANCELLED' | 'PRINT_OUTCOME_UNKNOWN' | string }> =>
    ipcRenderer.invoke(channel, payload),
  channels: IPC
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
