/**
 * جلسه ۳۵ · هارنس §۲۳ — قلاب resolve.
 * سه کاری که در محیط بدون npm لازم است:
 *   ۱) `@shared/*` → `src/shared/*.ts` (همان alias های electron.vite.config.ts)
 *   ۲) `@prisma/client` و `electron` → stub های این پوشه (تنها جایگزین‌ها)
 *   ۳) import های بی‌پسوند (`../errors`) → فایل `.ts` واقعی
 * هیچ کد پروژه‌ای برای تست تغییر نمی‌کند — همان فایل محصول اجرا می‌شود.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const EXTS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.json']

const firstExisting = (base) => {
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext
  for (const ext of EXTS) if (existsSync(join(base, 'index' + ext))) return join(base, 'index' + ext)
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier === '@prisma/client')
    return { url: pathToFileURL(join(HERE, 'stubs', 'prismaClient.mjs')).href, shortCircuit: true }
  if (specifier === 'electron')
    return { url: pathToFileURL(join(HERE, 'stubs', 'electron.mjs')).href, shortCircuit: true }
  if (specifier === 'electron-updater')
    return { url: pathToFileURL(join(HERE, 'stubs', 'electronUpdater.mjs')).href, shortCircuit: true }
  if (specifier === 'jalaali-js')
    return { url: pathToFileURL(join(HERE, 'stubs', 'jalaali.mjs')).href, shortCircuit: true }
  if (specifier === 'bwip-js')
    return { url: pathToFileURL(join(HERE, 'stubs', 'bwipjs.mjs')).href, shortCircuit: true }
  if (specifier.startsWith('@shared/')) {
    const hit = firstExisting(join(ROOT, 'src', 'shared', specifier.slice('@shared/'.length)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  if (specifier.startsWith('@renderer/')) {
    const hit = firstExisting(join(ROOT, 'src', 'renderer', 'src', specifier.slice('@renderer/'.length)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const base = join(dirname(fileURLToPath(context.parentURL)), specifier)
    if (!/\.[a-z]+$/i.test(specifier) || !existsSync(base)) {
      const hit = firstExisting(base)
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
