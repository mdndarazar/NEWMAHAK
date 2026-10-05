/**
 * ممیزی نشست ۱۱۹ — A119-01/02/03 (P2/P3): صفحه‌بندی و تاریخ فهرست‌های نشست ۱۱۹.
 * A119-01 (P3، UI + گیت main): فهرست دسته‌های اعتبار (CreditManagement): batchSkip با تغییر «از/تا» صفر نمی‌شد ⇒ از صفحه‌ی ۲
 *   (skip=۲) به روزی با ۱ دسته ⇒ جدول خالی «۰ از ۱ دسته»؛ StoreCreditService.batches «۱۴۰۵/۱۳/۰۱» را بی‌صدا سال بعد و بازه‌ی معکوس را خالی می‌گرفت.
 * A119-02 (P2، UI فرم شمارش): Stocktake.tsx دکمه‌های صفحه فقط state را عوض می‌کردند و بارگذاری نمی‌زدند (effect فقط روی tab)
 *   ⇒ کالاهای بعد از ۴۰۰ از راه صفحه‌بندی قابل شمارش نبودند؛ بعد از «صفحه‌ی بعد» جستجوی تازه با skip=۴۰۰ ⇒ ۰ ردیف در حالی که ۳ کالا منطبق است.
 * A119-03 (P3، گیت main): StockCountService.list تاریخ نامعتبر را بی‌صدا (jalaliRange) و بازه‌ی معکوس را خالی می‌گرفت (D52).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون خطا پذیرفته شد`) }
  catch (e) { const m = String(e?.message ?? e); if (m.includes(needle)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.slice(0, 160)}`) } }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11901-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
const { creditEffectiveSkip, creditSelectionResetSignature } = await import('../../src/shared/creditUi.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')
let H = null
try { H = await import('../../src/shared/stocktakePaging.ts') } catch { /* قبل از رفع helper نیست */ }
const db = harnessClient(); const seed = makeSeeder(db)
const raw = db.$harness.db
const fill = (table, row) => {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all()
  const r = { ...row }
  for (const c of cols) if (c.notnull && !c.pk && !(c.name in r) && c.dflt_value == null) r[c.name] = /INT|REAL|BOOL|DATE/i.test(c.type) ? 0 : ''
  const names = Object.keys(r)
  return Number(raw.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => r[n])).lastInsertRowid)
}
await db.storeCreditBatch.count(); await db.productVariant.count(); await db.stockCountSession.count()
const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const yMs = T0 - 12 * 3600_000; const yJ = toJalaliDate(new Date(yMs))
const tMs = Math.min(Date.now() - 1000, T0 + 60_000)
for (let i = 0; i < 3; i++) fill('StoreCreditBatch', { title: `دسته امروز ${i}`, count: 1, amountEach: 1000, totalAmount: 1000, createdAt: tMs, createdAtJalali: today, createdAtTime: '10:00', source: 'MANUAL' })
fill('StoreCreditBatch', { title: 'دسته دیروز', count: 1, amountEach: 5000, totalAmount: 5000, createdAt: yMs, createdAtJalali: yJ, createdAtTime: '10:00', source: 'MANUAL' })

// ---------- A119-01: دسته‌ها ----------
const b2 = await storeCreditService.batches({ fromJalali: today, toJalali: today, take: 2, skip: 2 })
eq('امروز صفحه‌ی ۲ (take=۲): ۱ دسته از ۳', [b2.length, b2.page.totalCount], [1, 3])
const staleB = await storeCreditService.batches({ fromJalali: yJ, toJalali: yJ, take: 2, skip: 2 })
eq('(شاهد باگ) skip کهنه روی دیروز ⇒ ۰ از ۱', [staleB.length, staleB.page.totalCount], [0, 1])
const sigT = creditSelectionResetSignature({ fromJalali: today, toJalali: today })
const sigY = creditSelectionResetSignature({ fromJalali: yJ, toJalali: yJ })
const effB = creditEffectiveSkip({ signature: sigT, skip: 2 }, sigY)
const fixedB = await storeCreditService.batches({ fromJalali: yJ, toJalali: yJ, take: 2, skip: effB })
eq('skip مؤثر بعد از تغییر بازه ۰ ⇒ دسته‌ی دیروز دیده می‌شود', [effB, fixedB.length, fixedB[0]?.totalAmount], [0, 1, 5000])
await rejects('batches: تاریخ نامعتبر ⇒ خطای فارسی هدف', () => storeCreditService.batches({ fromJalali: '1405/13/01', toJalali: '1405/13/01' }), '«از تاریخ» فهرست دسته‌های اعتبار معتبر نیست')
await rejects('batches: بازه‌ی معکوس ⇒ خطای فارسی هدف', () => storeCreditService.batches({ fromJalali: today, toJalali: yJ }), 'بازه‌ی فهرست دسته‌های اعتبار معکوس است')
const allB = await storeCreditService.batches({})
eq('batches بدون تاریخ همان رفتار قبل (بدون قید): ۴', allB.page.totalCount, 4)

// ---------- A119-02: فرم شمارش ----------
const p = seed.product('کالای شمارش')
raw.exec('BEGIN')
for (let i = 0; i < 405; i++) fill('ProductVariant', { productId: p, code: `SC${i}`, barcode: `BSC${i}`, salePrice: 1000, purchasePrice: 500, stock: 1, isActive: 1, createdAt: tMs, updatedAt: tMs, size: i >= 402 ? 'ویژه‌XL' : null })
raw.exec('COMMIT')
const v2 = await stockCountService.variants({ take: 400, skip: 400 })
eq('صفحه‌ی ۲ کالاها: ۵ از ۴۰۵', [v2.length, v2.page.totalCount], [5, 405])
const staleV = await stockCountService.variants({ search: 'SC40', take: 400, skip: 400 })
eq('(شاهد باگ) جستجوی تازه با skip=۴۰۰ ⇒ ۰ ردیف', [staleV.length, staleV.page.totalCount > 0], [0, true])
const applied = { search: '', skip: 400 }
const rq = H ? H.stocktakeReloadQuery(applied, ' SC40 ') : null
eq('جستجوی تازه ⇒ صفحه‌ی اول', rq, { search: 'SC40', skip: 0 })
const fixedV = rq ? await stockCountService.variants({ search: rq.search, take: 400, skip: rq.skip }) : []
eq('با درخواست صریح همه‌ی منطبق‌ها دیده می‌شوند', fixedV.length, staleV.page.totalCount)
eq('بازخوانی با همان جستجو صفحه را نگه می‌دارد', H ? H.stocktakeReloadQuery(applied, '') : null, { search: '', skip: 400 })
const p1 = await stockCountService.variants({ take: 400, skip: 0 })
const nq = H ? H.stocktakePageQuery({ search: '', skip: 0 }, p1.page, 'next') : null
eq('صفحه‌ی بعد روی جستجوی اعمال‌شده skip=۴۰۰', nq, { search: '', skip: 400 })
eq('صفحه‌ی آخر «بعد» ندارد و «قبل» دارد', H ? [H.stocktakePageQuery(applied, v2.page, 'next'), H.stocktakePageQuery(applied, v2.page, 'prev')] : null, [null, { search: '', skip: 0 }])
eq('نشان صریح صفحه‌ی آخر «نمایش ۴۰۱ تا ۴۰۵ از ۴۰۵ کالا»', H ? H.pageRangeLabel(v2.page, v2.length, 'کالا') : null, 'نمایش ۴۰۱ تا ۴۰۵ از ۴۰۵ کالا')

// ---------- A119-03: سابقه‌ی جلسه‌ها ----------
fill('StockCountSession', { countedAt: tMs, countedAtJalali: today, countedAtTime: '10:00', userName: 'الف' })
await rejects('list: تاریخ نامعتبر ⇒ خطای فارسی هدف', () => stockCountService.list({ fromJalali: '1405/13/01' }), '«از تاریخ» سابقه‌ی جلسه‌های شمارش معتبر نیست')
await rejects('list: بازه‌ی معکوس ⇒ خطای فارسی هدف', () => stockCountService.list({ fromJalali: today, toJalali: yJ }), 'بازه‌ی سابقه‌ی جلسه‌های شمارش معکوس است')
const ls = await stockCountService.list({})
eq('list بدون تاریخ همان رفتار قبل (بدون قید)', ls.page.totalCount, 1)

// ---------- UI ----------
const st = readFileSync(resolve('src/renderer/src/pages/Stocktake.tsx'), 'utf8')
eq('Stocktake: دیگر skip در state جدا بدون بارگذاری نیست', /setVariantSkip\(|setSessionSkip\(/.test(st), false)
eq('Stocktake: loadVariants درخواست صریح می‌گیرد و پاسخ کهنه را دور می‌ریزد', /const loadVariants = useCallback\(async \(q: StocktakeQuery\)/.test(st) && /if \(seq !== variantReq\.current\) return/.test(st) && /if \(seq !== sessionReq\.current\) return/.test(st), true)
eq('Stocktake: دکمه‌های صفحه بارگذاری می‌زنند (helper)', /stocktakePageQuery\(variantQuery, variantPage, 'next'\); if \(q\) void loadVariants\(q\)/.test(st) && /stocktakePageQuery\(null, sessionPage, 'next'\); if \(q\) void loadSessions\(q\.skip\)/.test(st), true)
eq('Stocktake: جستجو/بازخوانی با stocktakeReloadQuery', /stocktakeReloadQuery\(variantQuery, search\)/.test(st), true)
const cm = readFileSync(resolve('src/renderer/src/pages/CreditManagement.tsx'), 'utf8')
eq('CreditManagement: batchSkip گره‌خورده به امضای بازه', /const batchSkip = creditEffectiveSkip\(batchSkipState, batchSignature\)/.test(cm) && !/setBatchSkip\(/.test(cm), true)
eq('CreditManagement: پاسخ کهنه‌ی load دور ریخته می‌شود', /if \(seq !== loadReq\.current\) return/.test(cm), true)
eq('regex a101-01 حفظ شد', /view === 'list' \? listSkip/.test(cm) && /setListPage\(/.test(cm), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
