import { useEffect } from 'react'

/**
 * میان‌برهای صفحه‌کلید سازگار با محک. قابل تنظیم مجدد: کلیدها از
 * shortcuts.ts خوانده می‌شوند و در آینده می‌توان از جدول Setting پرش داد.
 */
export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.key]
        .filter(Boolean)
        .join('+')
      const fn = map[combo] ?? map[e.key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}
