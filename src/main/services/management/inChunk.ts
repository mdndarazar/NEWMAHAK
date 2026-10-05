/**
 * B5 (بازبینی دوازدهم) — فهرست‌های `in` بی‌سقف.
 *
 * هر پرس‌وجو با مخرجِ مشترک (`saleItemId: { in: itemIds }`) یک پارامترِ SQLite به‌ازای هر
 * id می‌سازد و سقفِ متغیرها (SQLITE_MAX_VARIABLE_NUMBER) حدود ۳۲هزار است: روی پنجرهٔ
 * بزرگِ یک شعبهٔ پرفروش (ده‌هاهزار قلمِ قفل‌شده) خودِ پرس‌وجو خطا می‌دهد و تبِ سود/ABC/
 * خرید‌وفروش می‌ترکد. تا پیش از این فقط `returnShare` تکه‌تکه می‌کرد و `stock()` برای لات‌ها.
 *
 * اینجا همان کار یک‌جا شده: idها یک‌شده و سالم‌سازی می‌شوند، پرس‌وجو تکه‌تکه (۵۰۰تایی)
 * اجرا می‌شود و ردیف‌ها به همان ترتیبِ بلوک‌ها برگردانده می‌شوند. **هیچ عددی عوض نمی‌شود** —
 * فقط خطای احتمالی حذف می‌شود.
 */
export const IN_CHUNK = 500

export async function findByIds(
  db: any,
  model: string,
  field: string,
  ids: Array<number | string | null | undefined>,
  opts: { where?: any; select?: any; take?: number } = {}
): Promise<any[]> {
  const uniq = [...new Set((ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))]
  if (!uniq.length) return []
  const out: any[] = []
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const part = uniq.slice(i, i + IN_CHUNK)
    const where = { ...(opts.where || {}), [field]: { in: part } }
    const args: any = opts.select ? { where, select: opts.select } : { where }
    if (opts.take) args.take = Math.max(1, opts.take - out.length)
    const rows = await db[model].findMany(args)
    if (Array.isArray(rows)) out.push(...rows)
    if (opts.take && out.length >= opts.take) break
  }
  return opts.take ? out.slice(0, opts.take) : out
}
