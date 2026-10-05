/** زیردسته‌ها برای فیلتر گزارش مدیریت — بدون دست زدن به ProductService. */
import { prisma } from '../../db/client'

export async function categoryWithDescendants(rootId: number): Promise<number[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<number, number[]>()
  for (const c of all) {
    if (c.parentId == null) continue
    const list = childrenOf.get(c.parentId) ?? []
    list.push(c.id)
    childrenOf.set(c.parentId, list)
  }
  const out: number[] = []
  const seen = new Set<number>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as number
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return out
}
