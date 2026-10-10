import type { GuidanceNotice } from '@shared/returnGuidance'

export default function GuidanceNotices({ notices }: { notices: GuidanceNotice[] }) {
  if (!notices || !notices.length) return null

  return (
    <div className="space-y-1.5 my-2">
      {notices.map((n, i) => {
        let borderClass = 'border-blue-300 bg-blue-50 text-blue-900'
        if (n.tone === 'warn') borderClass = 'border-amber-300 bg-amber-50 text-amber-900'
        if (n.tone === 'danger') borderClass = 'border-rose-300 bg-rose-50 text-rose-900'

        return (
          <div key={i} className={`rounded border p-2 text-xs leading-5 flex items-start gap-2 ${borderClass}`}>
            <span className="font-bold">💡</span>
            <span>{n.text}</span>
          </div>
        )
      })}
    </div>
  )
}
