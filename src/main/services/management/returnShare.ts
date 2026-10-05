/** نسبت برگشت به تعداد خط فاکتور — سقف ۱. سود، ABC و خرید/فروش باید یکی باشند. */
export function shopReturnRatio(returnQty: number, lineQty: number): number {
  const line = Number(lineQty) || 0
  if (line <= 0) return 0
  return Math.min(1, Math.max(0, Number(returnQty) || 0) / line)
}

/**
 * «چیزی که از این قلم فروش واقعاً به قفسه (به لات) برگشته» فقط از خودِ دفتر هزینه
 * خوانده می‌شود: ردیف‌های `CostConsumption` با `kind = 'RETURN'` که `restoreFromReturn`
 * می‌نویسد. عمداً از `SaleReturnItem.restockedQty` نمی‌خوانیم — آن فیلد `@default(0)`
 * است و برای هر برگشتِ پیش از این قابلیت صفر می‌آید، یعنی سودِ هر برگشت قدیمی بی‌صدا
 * صفرِ جنس برمی‌گشت. نبودِ ردیفِ بازگشت = جنس برنگشته (ایرادی/در صفِ انبار مرکزی).
 *
 * یک جا نشسته تا تب سود، ABC و خرید/فروش سه قاعدهٔ متفاوت نداشته باشند (B5 — بازبینی
 * نهم: ABC کل `(درآمد − فی)` را با نسبتِ برگشت کم می‌کرد و قاعدهٔ «برگشتِ برنگشته» را
 * نداشت ⇒ کالای پربازگشتِ ایرادی در ABC سودِ بالاتر از تب سود می‌گرفت).
 */
export type RestockShares = {
  /** کلِ «برگشته به لات» به‌ازای هر قلم فروش — سقفِ مجموعِ برگشت‌های همان قلم. */
  byItem: Map<number, number>
  /** همان عدد ولی تفکیک‌شده به «هر برگشت»: `saleItemId:returnId`. */
  byReturn: Map<string, number>
  /**
   * سهمِ برگشتی که به هیچ برگشتی وصل نیست (ردیفِ کهنه/دستی که حرکتش `refId` ندارد).
   * بدونِ این، برگشتِ *برنگشتنی* که زودتر از برگشتِ سالم در حلقه می‌آید می‌توانست
   * استخرِ قلم را بخورد و یادآوری به قلمِ اشتباه بچسبد (جمعِ پول درست می‌ماند، ولی
   * «کدام برگشت جنسش برگشته» قاطی می‌شد).
   */
  byItemUnattributed: Map<number, number>
}

type ReturnConsumption = { movementId?: number | null; [key: string]: any }

/**
 * پیوندِ مصرفِ لات به برگشت و وضعیتِ همان سند. `CostConsumption` عمداً رابطه‌ی
 * مستقیم با `StockMovement` ندارد، پس دو مرحله‌ی lookup لازم است. فقط ردیفی که
 * بتوان آن را به سندِ برگشتِ ابطال‌شده وصل کرد حذف می‌شود؛ مصرفِ قدیمی/بی‌ارجاع
 * دست‌نخورده می‌ماند تا داده‌ی ناقص را به‌اشتباه «باطل» فرض نکنیم.
 */
export async function activeReturnConsumptions(
  db: any,
  rows: ReturnConsumption[]
): Promise<{ rows: ReturnConsumption[]; moveToReturn: Map<number, number> }> {
  const movementIds = [...new Set(rows.map((r) => Number(r.movementId)).filter((id) => id > 0))]
  const movementById = new Map<number, any>()
  const CHUNK = 400
  for (let i = 0; i < movementIds.length; i += CHUNK) {
    const moves = await db.stockMovement
      .findMany({
        where: { id: { in: movementIds.slice(i, i + CHUNK) } },
        select: { id: true, refType: true, refId: true }
      })
    for (const move of moves as any[]) movementById.set(Number(move.id), move)
  }

  const moveToReturn = new Map<number, number>()
  for (const [movementId, move] of movementById) {
    if (String(move.refType) === 'SaleReturn' && Number(move.refId) > 0)
      moveToReturn.set(movementId, Number(move.refId))
  }
  const returnIds = [...new Set(moveToReturn.values())]
  const voidedReturnIds = new Set<number>()
  for (let i = 0; i < returnIds.length; i += CHUNK) {
    const returns = await db.saleReturn
      .findMany({
        where: { id: { in: returnIds.slice(i, i + CHUNK) } },
        select: { id: true, voidedAt: true }
      })
    for (const ret of returns as any[]) if (ret.voidedAt != null) voidedReturnIds.add(Number(ret.id))
  }

  return {
    rows: rows.filter((row) => {
      const returnId = moveToReturn.get(Number(row.movementId))
      return !returnId || !voidedReturnIds.has(returnId)
    }),
    moveToReturn
  }
}

export type ReturnSourceInput = {
  saleItemId: number
  returnId: number
  variantId: number
  qty: number
  /** تعداد برگشتی‌ای که طبق سند به موجودی قابل‌فروش/انبار برگشته است. */
  restockedQty?: number | null
}

export type StoreReturnAttribution = { storeQty: number; ambiguousQty: number }

/**
 * منشأ برگشت را فقط وقتی به فروشگاه نسبت می‌دهد که داده آن را ثابت کند.
 *
 * نبودِ دفتر تخصیص = فروش قدیمی و طبق قرارداد همه‌ی خط از فروشگاه بوده است. در
 * تخصیص‌های STORE-only / WAREHOUSE-only منشأ هر واحد هم معلوم است. برای خطِ مختلط،
 * حرکتِ `SALE_RETURN` با `refId` خودِ برگشت تعدادِ فیزیکیِ واردشده به موجودی
 * فروشگاه را ثابت می‌کند؛ هر بخشِ غیر-restock‌شده منشأ مشخصی ندارد و به‌جای حدس،
 * در `ambiguousQty` برمی‌گردد. اگر چند قلمِ هم‌کالا در یک برگشت باشند یا یک سند
 * چند حرکتِ متضاد/تکراری داشته باشد (مثل مسیرهای ویرایشِ خارج از این اصلاح)، حرکتِ
 * تجمیعی را نمی‌توان به خطِ درست چسباند و منشأ عمداً مبهم می‌ماند.
 */
export async function storeReturnAttributions(
  db: any,
  inputs: ReturnSourceInput[]
): Promise<Map<string, StoreReturnAttribution>> {
  const result = new Map<string, StoreReturnAttribution>()
  if (!inputs.length) return result
  const saleItemIds = [...new Set(inputs.map((r) => Number(r.saleItemId)).filter((id) => id > 0))]
  const returnIds = [...new Set(inputs.map((r) => Number(r.returnId)).filter((id) => id > 0))]
  const CHUNK = 400

  const allocationsByItem = new Map<number, { store: number; warehouse: number; unknown: boolean }>()
  const allocationReadFailed = new Set<number>()
  for (let i = 0; i < saleItemIds.length; i += CHUNK) {
    const chunk = saleItemIds.slice(i, i + CHUNK)
    let allocations: any[]
    try {
      allocations = await db.saleItemStockAllocation.findMany({
        where: { saleItemId: { in: chunk } },
        select: { saleItemId: true, sourceKind: true, qty: true }
      })
    } catch {
      for (const id of chunk) allocationReadFailed.add(id)
      continue
    }
    for (const allocation of allocations as any[]) {
      const itemId = Number(allocation.saleItemId)
      const cur = allocationsByItem.get(itemId) ?? { store: 0, warehouse: 0, unknown: false }
      const qty = Math.max(0, Math.round(Number(allocation.qty) || 0))
      const kind = String(allocation.sourceKind || '')
      if (kind === 'STORE') cur.store += qty
      else if (kind === 'WAREHOUSE') cur.warehouse += qty
      else cur.unknown = true
      allocationsByItem.set(itemId, cur)
    }
  }

  const movementByReturnVariant = new Map<string, { qty: number; count: number; hasNegative: boolean }>()
  const movementReadFailed = new Set<number>()
  for (let i = 0; i < returnIds.length; i += CHUNK) {
    const chunk = returnIds.slice(i, i + CHUNK)
    let moves: any[]
    try {
      moves = await db.stockMovement.findMany({
        where: { refType: 'SaleReturn', refId: { in: chunk }, reason: 'SALE_RETURN' },
        select: { refId: true, variantId: true, delta: true }
      })
    } catch {
      for (const id of chunk) movementReadFailed.add(id)
      continue
    }
    for (const move of moves as any[]) {
      const key = `${Number(move.refId)}:${Number(move.variantId)}`
      const delta = Number(move.delta || 0)
      const current = movementByReturnVariant.get(key) ?? { qty: 0, count: 0, hasNegative: false }
      current.qty += delta
      current.count += 1
      if (delta < 0) current.hasNegative = true
      movementByReturnVariant.set(key, current)
    }
  }

  const rowsPerReturnVariant = new Map<string, number>()
  for (const input of inputs) {
    const key = `${Number(input.returnId)}:${Number(input.variantId)}`
    rowsPerReturnVariant.set(key, (rowsPerReturnVariant.get(key) ?? 0) + 1)
  }

  for (const input of inputs) {
    const itemId = Number(input.saleItemId)
    const returnId = Number(input.returnId)
    const variantId = Number(input.variantId)
    const qty = Math.max(0, Math.round(Number(input.qty) || 0))
    const rawRestocked = Math.round(Number(input.restockedQty) || 0)
    const restocked = Math.max(0, Math.min(qty, rawRestocked))
    const invalidRestocked = rawRestocked < 0 || rawRestocked > qty
    const source = allocationsByItem.get(itemId)
    let storeQty = 0
    let ambiguousQty = 0

    // «نبود ردیف» در دفتر یعنی خطِ قدیمی و تماما فروشگاهی؛ دفترِ STORE-only هم
    // برای برگشتِ معیوب منشأ را ثابت می‌کند، حتی وقتی هیچ حرکتِ restock نداریم.
    if (allocationReadFailed.has(itemId)) {
      ambiguousQty = qty
    } else if (!source || (!source.unknown && source.warehouse === 0)) {
      storeQty = qty
    } else if (!source.unknown && source.store === 0 && source.warehouse > 0) {
      storeQty = 0
    } else if (source.unknown || source.store > 0 && source.warehouse > 0) {
      const returnVariantKey = `${returnId}:${variantId}`
      const movement = movementByReturnVariant.get(returnVariantKey) ?? { qty: 0, count: 0, hasNegative: false }
      const movementQty = movement.qty
      const uniqueLineForVariant = rowsPerReturnVariant.get(returnVariantKey) === 1
      if (
        movementReadFailed.has(returnId) ||
        !uniqueLineForVariant ||
        movement.count > 1 ||
        movement.hasNegative ||
        invalidRestocked ||
        movementQty < 0 ||
        movementQty > restocked
      ) {
        ambiguousQty = qty
      } else {
        // مثبتِ این حرکت فقط همان سهمی است که واقعاً در انبار فروشگاه ثبت شده.
        // restockedQty − movementQty به انبار مرکزی برگشته؛ qty − restockedQty منشأ
        // قابل اثبات ندارد و عمداً از سود فروشگاه بیرون از محاسبه می‌ماند.
        storeQty = Math.max(0, movementQty)
        ambiguousQty = Math.max(0, qty - restocked)
      }
    } else {
      // دفتر تخصیصِ غیرعادی/تهی‌مفهوم: منشأ ناشناخته را به STORE تبدیل نکن.
      ambiguousQty = qty
    }

    result.set(`${itemId}:${returnId}`, { storeQty, ambiguousQty })
  }
  return result
}

/**
 * B1 (بازبینی دهم) — اگر از یک قلم **چند بار** برگشت ثبت شود، جمعِ سادهٔ «برگشته به
 * لات» برای کل قلم فاجعه می‌سازد: قلمی با دو برگشت (یکی سالم و بازگشته به قفسه، یکی
 * ایرادیِ برنگشته) یک ردیف `RETURN` با تعداد ۱ دارد؛ اگر هر دو برگشت از همان یک
 * عدد «سهمِ برگشته» بردارند، بهای هر دو از سود کم می‌شود و ضررِ جنسِ ایرادی بی‌صدا
 * پاک می‌شود (سود بیشتر از واقعی، بدون هیچ یادآوری). پس نشانه از ردیفِ مصرف
 * **به‌ازای همان برگشت** خوانده می‌شود: `restoreFromReturn` ردیف `CostConsumption` را
 * با `movementId`ِ حرکتِ همان برگشت می‌نویسد و حرکتِ `SALE_RETURN` با
 * `refType='SaleReturn'` و `refId=returnId` به خودِ برگشت وصل است ⇒ قوسِ
 * `(قلم، برگشت)` دقیق است.
 * ردیف‌های بی‌ارجاع (حرکتِ بدون `refId` — دادهٔ دستی/کهنه) در استخرِ قلم می‌مانند و
 * فقط یک‌بار مصرف می‌شوند، نه به‌ازای هر برگشت.
 */
export async function restockedReturnShares(db: any, saleItemIds: number[]): Promise<RestockShares> {
  const byItem = new Map<number, number>()
  const byReturn = new Map<string, number>()
  const byItemUnattributed = new Map<number, number>()
  const ids = [...new Set((saleItemIds || []).map((x) => Number(x)).filter((x) => x > 0))]
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.costConsumption
      .findMany({
        where: { saleItemId: { in: ids.slice(i, i + CHUNK) }, kind: 'RETURN' },
        select: { saleItemId: true, qty: true, movementId: true }
      })
    const active = await activeReturnConsumptions(db, rows as any[])
    for (const c of active.rows as any[]) {
      const key = Number(c.saleItemId)
      const qty = Number(c.qty || 0)
      if (!key || qty <= 0) continue
      byItem.set(key, (byItem.get(key) ?? 0) + qty)
      const returnId = active.moveToReturn.get(Number(c.movementId))
      if (returnId) byReturn.set(`${key}:${returnId}`, (byReturn.get(`${key}:${returnId}`) ?? 0) + qty)
      else byItemUnattributed.set(key, (byItemUnattributed.get(key) ?? 0) + qty)
    }
  }
  return { byItem, byReturn, byItemUnattributed }
}

/**
 * «چقدر از این برگشت به لات برگشته» — با استخرِ مصرف‌شونده‌ی هر قلم.
 * هر بار که یک برگشت چیزی از استخر برمی‌دارد، آن مقدار از بقیهٔ برگشت‌های همان قلم
 * کم می‌شود؛ پس مجموعِ کسری‌های برگشتی هیچ‌وقت از «واقعاً برگشته» بیشتر نمی‌شود.
 * یک کارِ تازه به‌ازای هر حلقه بسازید (`createRestockTaker(shares)`) — دو حلقهٔ تب سود
 * (سرجمع و تامین‌کننده) هر کدام استخرِ خودشان را دارند و یک عدد دو بار مصرف نمی‌شود.
 */
export function createRestockTaker(shares: RestockShares): (saleItemId: number, returnId: number | null, returnQty: number) => number {
  const used = new Map<number, number>()
  const usedLoose = new Map<number, number>()
  return (saleItemId: number, returnId: number | null, returnQty: number) => {
    const item = Number(saleItemId)
    const want = Math.max(0, Number(returnQty) || 0)
    const total = shares.byItem.get(item) ?? 0
    const left = Math.max(0, total - (used.get(item) ?? 0))
    if (!item || want <= 0 || left <= 0) return 0
    const precise =
      returnId != null && Number(returnId) > 0 ? shares.byReturn.get(`${item}:${Number(returnId)}`) : undefined
    // برگشتِ بی‌سهمِ مشخص فقط از استخرِ «بی‌اتصال» برداشت می‌کند — پس ترتیبِ حلقه در
    // «کدام برگشت جنسش برگشته» اثر نمی‌گذارد. برای دادهٔ کاملاً کهنه این دو استخر یکی
    // است، یعنی همان رفتارِ قبل (بدون صفر شدنِ اجباریِ سهمِ برگشت‌های قدیمی).
    let cap = left
    if (precise != null) cap = precise
    else {
      const looseLeft = Math.max(0, (shares.byItemUnattributed.get(item) ?? 0) - (usedLoose.get(item) ?? 0))
      cap = looseLeft
    }
    const got = Math.min(want, left, cap)
    if (got > 0) {
      used.set(item, (used.get(item) ?? 0) + got)
      if (precise == null) usedLoose.set(item, (usedLoose.get(item) ?? 0) + got)
    }
    return got
  }
}
