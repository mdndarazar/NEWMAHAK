/**
 * ممیزی نشست ۱۱۸ · A118-02 (AUDIT-D54) — امضای فیلتر تاریخچه‌ی انبار مرکزی.
 * skip صفحه همراه همین امضا ذخیره می‌شود و با `creditEffectiveSkip` در همان رندر سنجیده می‌شود؛
 * با عوض شدن فیلتر، skip مؤثر همان لحظه صفر است و درخواست دوم با skip کهنه ساخته نمی‌شود.
 */
export function secondaryHistorySignature(f: { onlyTransfers: boolean }): string {
  return String(!!f.onlyTransfers)
}
