import { money } from '@shared/jalali'

const TEAL = '#0f9b9b'
const TEAL_DARK = '#0b7c7c'
const AMBER = '#d97706'
const ROSE = '#e11d48'
const SLATE = '#64748b'
const INDIGO = '#6366f1'
const PALETTE = [TEAL, AMBER, INDIGO, ROSE, '#0ea5e9', '#84cc16', '#a855f7', SLATE]

function maxOf(nums: number[]): number {
  let m = 0
  for (const n of nums) if (n > m) m = n
  return m || 1
}

export function EmptyChart({ text = 'چیزی در این فیلتر نیست' }: { text?: string }) {
  return (
    <div className="h-48 flex items-center justify-center text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded">
      {text}
    </div>
  )
}

/** ستون فروش + خط تعداد فاکتور */
export function BarLineChart({
  points
}: {
  points: { label: string; sales: number; count: number; lastYear?: number }[]
}) {
  if (!points.length || points.every((p) => p.sales === 0 && p.count === 0 && !p.lastYear)) return <EmptyChart />
  const w = Math.max(640, points.length * 56)
  const h = 260
  const pad = { t: 16, r: 56, b: 56, l: 72 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  const minS = Math.min(0, ...points.map((p) => p.sales), ...points.map((p) => p.lastYear || 0))
  const maxS = Math.max(0, ...points.map((p) => p.sales), ...points.map((p) => p.lastYear || 0))
  const spanS = maxS - minS || 1
  const yOf = (v: number) => pad.t + ih - ((v - minS) / spanS) * ih
  const zeroY = yOf(0)
  const maxC = maxOf(points.map((p) => p.count))
  const hasLastYear = points.some((p) => (p.lastYear || 0) > 0)
  const bw = Math.max(8, (iw / points.length) * 0.55)
  const line = points
    .map((p, i) => {
      const x = pad.l + ((i + 0.5) * iw) / points.length
      const y = pad.t + ih - (p.count / maxC) * ih
      return `${i ? 'L' : 'M'}${x},${y}`
    })
    .join(' ')
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="bg-white">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + ih * (1 - t)
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#e2e8f0" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                {money(Math.round(minS + spanS * t))}
              </text>
              <text x={w - pad.r + 8} y={y + 4} fontSize="10" fill="#b45309">
                {Math.round(maxC * t)}
              </text>
            </g>
          )
        })}
        {points.map((p, i) => {
          const x = pad.l + ((i + 0.5) * iw) / points.length
          const yTop = p.sales >= 0 ? yOf(p.sales) : zeroY
          const bh = Math.abs(yOf(p.sales) - zeroY)
          return (
            <g key={p.label}>
              <rect x={x - bw / 2} y={yTop} width={bw} height={bh || 0} fill={p.sales < 0 ? '#e11d48' : TEAL} rx={2}>
                <title>{`${p.label}: ${money(p.sales)}${p.lastYear ? ` · پارسال ${money(p.lastYear)}` : ''}`}</title>
              </rect>
              <text
                x={x}
                y={h - 8}
                textAnchor="end"
                fontSize="10"
                fill="#475569"
                transform={`rotate(-40 ${x} ${h - 8})`}
              >
                {p.label}
              </text>
            </g>
          )
        })}
        {hasLastYear ? (
          <path
            d={points
              .map((p, i) => {
                const x = pad.l + ((i + 0.5) * iw) / points.length
                const y = yOf(p.lastYear || 0)
                return `${i ? 'L' : 'M'}${x},${y}`
              })
              .join(' ')}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}
        <path d={line} fill="none" stroke={AMBER} strokeWidth={2} />
        {points.map((p, i) => {
          const x = pad.l + ((i + 0.5) * iw) / points.length
          const y = pad.t + ih - (p.count / maxC) * ih
          return <circle key={`c${i}`} cx={x} cy={y} r={3} fill={AMBER} />
        })}
        <text x={w - pad.r} y={14} textAnchor="end" fontSize="11" fill={AMBER}>
          تعداد فاکتور
        </text>
        <text x={pad.l} y={14} fontSize="11" fill={TEAL}>
          فروش خالص تعهدی
        </text>
        {hasLastYear ? (
          <text x={pad.l + 130} y={14} fontSize="11" fill="#94a3b8">
            همین ماه پارسال
          </text>
        ) : null}
      </svg>
    </div>
  )
}

export function StackedBarChart({
  points,
  series
}: {
  points: { label: string; [k: string]: number | string }[]
  series: { key: string; label: string; color: string; on?: boolean }[]
}) {
  const active = series.filter((s) => s.on !== false)
  // هر ستون: جمعِ مثبت‌ها بالا و جمعِ منفی‌ها پایین (نقدِ روزِ پربازگشت منفی است).
  const cols = points.map((p) => {
    let top = 0
    let bot = 0
    for (const s of active) {
      const v = Number(p[s.key] || 0)
      if (v >= 0) top += v
      else bot += v
    }
    return { top, bot, net: top + bot }
  })
  if (!points.length || cols.every((c) => c.net === 0)) return <EmptyChart />
  const w = Math.max(640, points.length * 56)
  const h = 260
  const pad = { t: 28, r: 16, b: 56, l: 72 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  /**
   * B7 (بازبینی نهم) — این نمودار دو دروغ می‌گفت: (۱) `maxS` از **جمعِ** ستون‌ها
   * گرفته می‌شد ولی میله‌ها از صفر بریده می‌شدند، پس با نقد −۵ و کارت ۱۰، میلهٔ کارت
   * دو برابر کادر می‌شد و بیرون می‌زد؛ (۲) مقدار منفی با `Math.max(0, …)` حذف می‌شد،
   * یعنی نقدِ منفیِ همان روز اصلاً دیده نمی‌شد. حالا دامنه از کم‌ترین تا بیشترین
   * مقدارِ واقعی است، خطِ صفر وسط می‌نشیند و محورِ عدد هم اضافه می‌شود (ضعف «بدون
   * محور» در همان بندها). منطقِ عدد عوض نشده — فقط رسمش درست شده است.
   */
  const maxTop = Math.max(0, ...cols.map((c) => c.top))
  const minBot = Math.min(0, ...cols.map((c) => c.bot))
  const span = maxTop - minBot || 1
  const yOf = (v: number) => pad.t + ((maxTop - v) / span) * ih
  const zeroY = yOf(0)
  const bw = Math.max(8, (iw / points.length) * 0.55)
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="bg-white">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + ih * (1 - t)
          const v = minBot + span * t
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke={Math.abs(v) < 1 ? '#94a3b8' : '#e2e8f0'} />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                {money(Math.round(v))}
              </text>
            </g>
          )
        })}
        {active.map((s, i) => (
          <g key={s.key} transform={`translate(${pad.l + i * 110}, 8)`}>
            <rect width={10} height={10} fill={s.color} />
            <text x={14} y={10} fontSize="11" fill="#334155">
              {s.label}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = pad.l + ((i + 0.5) * iw) / points.length
          let yUp = zeroY
          let yDown = zeroY
          return (
            <g key={p.label}>
              {active.map((s) => {
                const v = Number(p[s.key] || 0)
                if (!v) return null
                const part = Math.abs(v)
                const bh = Math.max(1, (part / span) * ih)
                if (v > 0) {
                  yUp -= bh
                  return (
                    <rect key={s.key} x={x - bw / 2} y={yUp} width={bw} height={bh} fill={s.color}>
                      <title>{`${String(p.label)} · ${s.label}: ${money(v)}`}</title>
                    </rect>
                  )
                }
                const rect = (
                  <rect key={s.key} x={x - bw / 2} y={yDown} width={bw} height={bh} fill={s.color} opacity={0.55}>
                    <title>{`${String(p.label)} · ${s.label} (منفی): ${money(v)}`}</title>
                  </rect>
                )
                yDown += bh
                return rect
              })}
              <text
                x={x}
                y={h - 8}
                textAnchor="end"
                fontSize="10"
                fill="#475569"
                transform={`rotate(-40 ${x} ${h - 8})`}
              >
                {String(p.label)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function DonutChart({ rows }: { rows: { name: string; amount: number }[] }) {
  const pos = rows.filter((r) => r.amount > 0)
  const neg = rows.filter((r) => r.amount < 0)
  const total = pos.reduce((s, r) => s + r.amount, 0)
  if (total <= 0) return <EmptyChart text={neg.length ? 'در این فیلتر برگشت از فروش بیشتر است' : undefined} />
  const r = 70
  const cx = 90
  const cy = 90
  let a0 = -Math.PI / 2
  const slices = pos.map((row, i) => {
    const a1 = a0 + (row.amount / total) * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    const full = a1 - a0 >= Math.PI * 2 - 1e-6
    const d = full
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
      : `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
    a0 = a1
    return { d, color: PALETTE[i % PALETTE.length], i, ...row }
  })
  return (
    <div className="flex gap-4 items-center flex-wrap">
      <svg width={180} height={180}>
        {slices.map((s) => (
          <path key={`${s.name}-${s.i}`} d={s.d} fill={s.color} />
        ))}
        <circle cx={cx} cy={cy} r={42} fill="white" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11" fill="#334155">
          {money(total)}
        </text>
        {/* مرکز دونات جمع دسته‌های مثبت است، نه فروش خالص — ردیف‌های منفی زیر فهرست می‌آیند. */}
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#64748b">
          جمع دسته‌های فروش‌دار
        </text>
      </svg>
      <ul className="text-xs space-y-1">
        {slices.map((s) => (
          <li key={`${s.name}-${s.i}`} className="flex gap-2 items-center">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="tabular-nums text-slate-600">{money(s.amount)}</span>
          </li>
        ))}
        {neg.map((s, i) => (
          <li key={`neg-${s.name}-${i}`} className="text-rose-700">
            برگشت بیشتر از فروش: {s.name} {money(s.amount)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HBarChart({ rows, valueKey = 'value' }: { rows: { label: string; [k: string]: any }[]; valueKey?: string }) {
  /**
   * «موارد کم‌اثر» بازبینی هشتم — میله‌های منفی. قبلاً با مقدار منفی `pct` منفی
   * می‌شد (عرض منفی = هیچ میله‌ای) و اگر همه‌ی مقادیر منفی بودند `max <= 0` کل نمودار
   * را به «داده‌ای نیست» تبدیل می‌کرد؛ یعنی دقیقاً همان‌جا که زیان هست، صفحه خالی
   * می‌شد. مقیاس الان بر حسب بزرگ‌ترین قدر مطلق است و میلهٔ منفی قرمز و رو‌به‌چپ.
   */
  const max = maxOf(rows.map((r) => Math.abs(Number(r[valueKey] || 0))))
  if (!rows.length || max <= 0) return <EmptyChart />
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = Number(r[valueKey] || 0)
        const neg = v < 0
        const pct = (Math.abs(v) / max) * 100
        return (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <div className="w-36 truncate text-left" title={r.label}>
              {r.label}
            </div>
            <div className={`flex-1 h-5 bg-slate-100 rounded overflow-hidden flex ${neg ? 'justify-start' : 'justify-end'}`}>
              <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: neg ? '#e11d48' : TEAL }} />
            </div>
            <div className={`w-28 text-left tabular-nums ${neg ? 'text-rose-700 font-bold' : ''}`}>{money(v)}</div>
          </div>
        )
      })}
    </div>
  )
}

export function Heatmap({
  cells,
  weekdays
}: {
  cells: { dow: number; hour: number; count: number }[]
  weekdays: string[]
}) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let max = 0
  for (const c of cells) {
    grid[c.dow][c.hour] = c.count
    if (c.count > max) max = c.count
  }
  if (max === 0) return <EmptyChart />
  const cell = 16
  return (
    <div className="overflow-x-auto">
      <svg width={48 + 24 * cell} height={28 + 7 * cell}>
        {Array.from({ length: 24 }, (_, h) => (
          <text key={h} x={48 + h * cell + 8} y={12} fontSize="9" textAnchor="middle" fill="#64748b">
            {h}
          </text>
        ))}
        {weekdays.map((d, i) => (
          <g key={d}>
            {/*
             * B2 (بازبینی نهم) — خانه‌های ردیف i از y = 16 + i·cell شروع می‌شوند، ولی
             * برچسب با `28 + i·cell + 12` نوشته می‌شد، یعنی ۱۲ پیکسل (= تقریباً یک
             * ردیف) پایین‌تر: «شنبه» کنار ردیف یکشنبه و «جمعه» زیر جدول. حالا خطِ پایهٔ
             * برچسب وسط همان خانه است، پس روزی که می‌خوانی واقعاً روزِ همان ردیف است.
             */}
            <text x={4} y={16 + i * cell + 12} fontSize="10" fill="#475569">
              {d}
            </text>
            {Array.from({ length: 24 }, (_, h) => {
              const v = grid[i][h]
              const t = max ? v / max : 0
              const fill = v === 0 ? '#f1f5f9' : `rgba(15,155,155,${0.15 + t * 0.85})`
              return (
                <rect
                  key={h}
                  x={48 + h * cell}
                  y={16 + i * cell}
                  width={cell - 1}
                  height={cell - 1}
                  fill={fill}
                  rx={2}
                >
                  <title>{`${d} ساعت ${h}: ${v} فاکتور`}</title>
                </rect>
              )
            })}
          </g>
        ))}
      </svg>
      <div className="text-[11px] text-slate-500 mt-1">
        هر ردیف = یک روز هفته، هر ستون = یک ساعت. رنگ پررنگ‌تر = فاکتور بیشتر. منطق شیفت عوض نشده و این نمودار
        هیچ چیزی را قفل یا جابه‌جا نمی‌کند.
      </div>
    </div>
  )
}

export { TEAL, TEAL_DARK, AMBER, ROSE, SLATE, INDIGO }
