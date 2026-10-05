/**
 * ===========================================================================
 * جلسه ۴۹ — «تایپ‌چک بدون node_modules» (شیم).
 *
 * تا این جلسه هیچ فایلی از جلسه ۴۲ به بعد `tsc` ندیده بود، چون این محیط `npm`
 * ندارد. ولی خودِ کامپایلر TypeScript (همان نسخه‌ی ۵.۶.۳ که در
 * `package.json` است) در دسترس بود. تنها مانع، *تایپ‌های وابستگی‌ها* بود.
 *
 * این فایل آن مانع را برمی‌دارد: هر وابستگی‌ای که نصب نیست را به‌صورت `any`
 * اعلام می‌کند، تا `tsc` بتواند **کدِ خودِ پروژه** را واقعاً بسنجد.
 *
 * ⚠️⚠️ این جایگزین `npm run typecheck` **نیست** و ادعایش را هم نمی‌کند:
 *   • هر چیزی که تایپش از `@prisma/client` می‌آید اینجا `any` است ⇒ خطای
 *     نام ستون/رابطه‌ی Prisma **گرفته نمی‌شود**.
 *   • همین برای `electron`, `react-router-dom`, `bwip-js`, `jalaali-js`,
 *     `electron-updater` و تایپ‌های `node` هم صادق است.
 * چیزی که **گرفته می‌شود** و تا امروز هیچ ابزاری در این پروژه نمی‌گرفت:
 *   تایپ‌های خودِ پروژه (`shared/*`), امضای توابع و سرویس‌ها، props کامپوننت‌ها،
 *   متغیر/ایمپورت ناموجود، یونیون‌های ناسازگار، `strict` بودن null.
 *
 * اجرا:  node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json
 * (و بعد از `npm install` همیشه `npm run typecheck` را هم اجرا کنید.)
 * ===========================================================================
 */
declare module '@prisma/client' {
  export const PrismaClient: any
  export type PrismaClient = any
  export const Prisma: any
  export namespace Prisma {
    export type TransactionClient = any
    export type TransactionIsolationLevel = any
    export type PrismaClientKnownRequestError = any
    export type SaleInvoiceGetPayload = any
    export type Sql = any
  }
  const _default: any
  export default _default
}

/**
 * «اعلان کوتاه ماژول» (shorthand ambient module): بدنه‌ی خالی ⇒ TypeScript هر
 * ایمپورتِ نام‌دار از این ماژول را `any` می‌گیرد. دقیقاً همان چیزی که برای یک
 * شیم لازم است، بی نوشتن هزار امضای جعلی.
 */
declare module 'electron'
declare module 'electron-updater'
declare module 'bwip-js'
declare module 'jalaali-js'
declare module 'react-router-dom'
declare module 'electron-vite'
declare module 'vite'
declare module '@vitejs/plugin-react'
declare module 'better-sqlite3'

declare module 'node:fs'
declare module 'node:fs/promises'
declare module 'node:path'
declare module 'node:os'
declare module 'node:url'
declare module 'node:crypto'
declare module 'node:child_process'
declare module 'node:util'
declare module 'node:zlib'
declare module 'node:stream'
declare module 'node:module'
declare module 'fs'
declare module 'fs/promises'
declare module 'path'
declare module 'os'
declare module 'crypto'
declare module 'child_process'
declare module 'util'

declare var process: any
declare var Buffer: any
declare var __dirname: string
declare var __filename: string
declare var global: any
declare function require(id: string): any
declare namespace NodeJS {
  type Timeout = any
  type ProcessEnv = any
}
