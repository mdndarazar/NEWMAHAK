import type { Api } from '../../../preload/index'

declare global {
  interface Window { api: Api }
}

/** فراخوانی IPC با throw کردن خطای فارسی؛ تا صفحات فقط try/catch بزنند. */
export async function call<T = any>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.api.invoke<T>(channel, payload)
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export const CH = window.api?.channels
