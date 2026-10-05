/**
 * نشست ۱۲۹ · ماک خطای فایل‌سیستم برای ExportService (فقط در تست).
 * رفتار پیش‌فرض همان fs واقعی است؛ خطا فقط با `globalThis.__s129fs` تزریق می‌شود.
 */
import * as real from 'node:fs/promises'
export * from 'node:fs/promises'

const cfg = () => globalThis.__s129fs ?? {}

function fsError(code, path, syscall) {
  const err = new Error(`${code}: simulated failure, ${syscall} '${path}'`)
  err.code = code
  err.syscall = syscall
  err.path = path
  return err
}

export async function writeFile(path, data, options) {
  const f = cfg()
  const p = String(path)
  if (f.lockedTarget && p === f.lockedTarget) throw fsError(f.lockCode ?? 'EBUSY', p, 'open')
  if (f.partialThen) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : new Uint8Array(data))
    await real.writeFile(path, buf.subarray(0, Math.floor(buf.length / 2)), options)
    throw fsError(f.partialThen, p, 'write')
  }
  return real.writeFile(path, data, options)
}

export async function rename(from, to) {
  const f = cfg()
  const target = String(to)
  if (f.lockedTarget && target === f.lockedTarget) throw fsError(f.lockCode ?? 'EBUSY', target, 'rename')
  if ((f.renameFailuresLeft ?? 0) > 0) {
    f.renameFailuresLeft--
    throw fsError(f.renameFailCode ?? 'EPERM', target, 'rename')
  }
  return real.rename(from, to)
}

export default { ...real, writeFile, rename }
