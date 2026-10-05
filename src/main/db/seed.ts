import { prisma } from './client'
import { PaymentKind, CHEQUE_METHOD_KEY } from '@shared/enums'

/** داده‌های حداقلی لازم برای اولین اجرا. idempotent است. */
export async function seed(): Promise<void> {
  await prisma.warehouse.upsert({
    where: { name: 'انبار اصلی' },
    update: {},
    create: { name: 'انبار اصلی', isMain: true }
  })

  await prisma.customer.upsert({
    where: { code: '1000' },
    update: {},
    create: { code: '1000', name: 'مشتری عمومی', isDefault: true }
  })

  const methods = [
    { key: 'CASH', label: 'نقدی', kind: PaymentKind.CASH, sortOrder: 1 },
    { key: 'CARD', label: 'کارت', kind: PaymentKind.CARD, sortOrder: 2 },
    { key: 'SEPAH', label: 'سپه', kind: PaymentKind.CUSTOM, sortOrder: 3 },
    { key: 'MELLI', label: 'ملی', kind: PaymentKind.CUSTOM, sortOrder: 4 },
    { key: 'CREDIT', label: 'اعتباری', kind: PaymentKind.CREDIT, sortOrder: 5 }
  ]
  for (const m of methods) {
    await prisma.paymentMethod.upsert({ where: { key: m.key }, update: { label: m.label }, create: m })
  }

  /**
   * روش پرداخت «چک» (فروش نسیه).
   *
   * `isActive: false` عمدی است: چک از پنجره‌ی «پرداختی‌ها / اقساط» ثبت می‌شود،
   * پس نباید در فهرست روش‌های پرداختِ پنل فروش و فاکتور عمده ظاهر شود و آن
   * پنل‌ها مو‌به‌مو مثل قبل می‌مانند. فقط برای این است که هر ردیف پرداختی یک
   * روش پرداخت معتبر داشته باشد و در گزارش‌ها با برچسب «چک» دیده شود.
   */
  await prisma.paymentMethod.upsert({
    where: { key: CHEQUE_METHOD_KEY },
    update: {},
    create: { key: CHEQUE_METHOD_KEY, label: 'چک', kind: PaymentKind.CUSTOM, isActive: false, sortOrder: 90 }
  })
}
