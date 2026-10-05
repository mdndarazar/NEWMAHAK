/**
 * جلسه ۳۵ · هارنس §۲۳ — جایگزین `@prisma/client`.
 * `new PrismaClient()` یک *نمونه‌ی مشترک* روی همان فایل SQLite برمی‌گرداند
 * (singleton)، چون `db/client.ts` در همه‌ی سرویس‌ها یک `prisma` می‌سازد و تست
 * باید دقیقاً همان اتصال را ببیند.
 */
import { createClient } from '../prismaLite.mjs'

const FILE = process.env.HARNESS_DB
if (!FILE) throw new Error('HARNESS_DB تعیین نشده است')

let shared = null
export function harnessClient() {
  if (!shared) shared = createClient(FILE)
  return shared
}

export class PrismaClient {
  constructor() {
    return harnessClient()
  }
}
export const Prisma = {
  TransactionIsolationLevel: { Serializable: 'Serializable' },
  sql: () => {
    throw new Error('HARNESS: Prisma.sql پشتیبانی نمی‌شود')
  }
}
export default { PrismaClient, Prisma }
