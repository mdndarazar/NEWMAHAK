/** نگاشت میان‌برهای محک. تغییر اینجا = تغییر در کل برنامه. */
export const SHORTCUTS = {
  pos: 'F2',            // پنل فروش
  purchaseInvoice: 'F3', // فاکتور خرید
  newItem: 'F4',
  edit: 'F5',
  review: 'F6',
  deleteSelected: 'F7',
  products: 'F8',        // کالاها
  salesReports: 'F9',    // گزارشات فروش
  cashClose: 'F10',      // بستن صندوق
  consolidation: 'F11',  // تجمیع و انتقال
  print: 'F8',
  advancedSearch: 'Ctrl+F10',
  /** ذخیره‌ی فاکتور (خرید و فروش عمده). F2/F3 در Shell به ناوبری گره خورده‌اند،
   *  پس برای «ذخیره» از Ctrl+S استفاده می‌شود تا میان‌برها تعارض نکنند. */
  save: 'Ctrl+S'
} as const

export const ROUTE_BY_SHORTCUT: Record<string, string> = {
  F2: '/pos',
  F3: '/purchase',
  F8: '/products',
  F9: '/sales-reports',
  F10: '/cash-close',
  F11: '/consolidation'
}
