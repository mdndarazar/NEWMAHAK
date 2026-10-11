import type { Api } from '../../../preload/index'

declare global {
  interface Window { api: Api }
}

/** فراخوانی IPC با throw کردن خطای فارسی؛ تا صفحات فقط try/catch بزنند. */
export async function call<T = any>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.api.invoke<T>(channel, payload)
  if (!res.ok) {
    const err = new Error(res.error) as Error & { code?: string; printCancelled?: boolean; printOutcomeUnknown?: boolean }
    err.code = res.code
    if (res.code === 'PRINT_CANCELLED') err.printCancelled = true
    if (res.code === 'PRINT_OUTCOME_UNKNOWN') err.printOutcomeUnknown = true
    throw err
  }
  return res.data
}

export const CH = window.api?.channels
