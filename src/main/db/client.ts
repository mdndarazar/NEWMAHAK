/**
 * نشست ۱۸۱ (S181-D1، خوشه M مرحله ۲) — سریال‌سازی امن BigInt.
 * import جانبی و عمدی: با اولین بارگذاری لایه‌ی دیتابیس، `BigInt.prototype.toJSON`
 * نصب می‌شود تا هیچ `JSON.stringify` ای (به‌ویژه ۱۵۶ نقطه‌ی `audit()`) بعد از
 * مهاجرت مبالغ به BigInt بی‌صدا crash نکند. جزئیات دلیل در خود ماژول.
 */
import '@shared/bigintJson'
import { app } from 'electron'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

/** فایل دیتابیس در userData نگه داشته می‌شود تا نصب/آپدیت برنامه داده را پاک نکند. */
export function databaseFile(): string {
  return join(app.getPath('userData'), 'data', 'shop.db')
}

process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${databaseFile()}`

export const prisma = new PrismaClient({ log: ['warn', 'error'] })
