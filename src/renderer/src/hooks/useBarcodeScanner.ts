import { useEffect, useRef } from 'react'

/**
 * تشخیص ورودی بارکدخوان HID.
 *
 * بارکدخوان مثل کیبورد تایپ می‌کند، اما بسیار سریع و بی‌وقفه، و در پایان Enter
 * می‌زند. کاراکترها در یک بافر جمع می‌شوند و «اسکن» فقط وقتی شناخته می‌شود که
 * سرعت *میانگین* تایپ از maxGap تندتر و طول رشته از minLength بیشتر باشد. تایپ
 * انسان هیچ‌وقت به این سرعت نمی‌رسد، پس جستجوی دستی سالم می‌ماند.
 *
 * ⚠️ رفع باگ تداخل با فیلد جستجو: نسخه‌ی قبلی روی هر Enter با بافر ≥ minLength
 * دست به `preventDefault` می‌زد. نتیجه این بود که تایپ دستی داخل فیلد جستجو هم
 * به‌عنوان بارکد گرفته می‌شد و Enter کاربر خورده می‌شد.
 *
 * ⚠️ رفع باگ بارکدهای حرف‌دار (کد فاکتور برگشت از فروش): نسخه‌ی قبلی هر کلیدی
 * که طول نامش ۱ نبود بافر را پاک می‌کرد. اسکنر برای حروف بزرگ اول `Shift` را
 * می‌فرستد، پس بافر وسط اسکن پاک می‌شد و کدهای حرف‌دار هیچ‌وقت شناخته
 * نمی‌شدند. الان کلیدهای «تغییردهنده» (Shift، CapsLock، AltGraph و ...) بافر
 * را دست‌نخورده رد می‌کنند.
 *
 * ⚠️ سازگاری با اسکنرهای کندتر: قبلاً فقط فاصله‌ی *آخرین* کلید تا Enter بررسی
 * می‌شد (۳۵ms). بعضی اسکنرها بین آخرین کاراکتر و Enter وقفه دارند و همان‌جا رد
 * می‌شدند. الان معیار، میانگین سرعت کل رشته است و فاصله‌ی Enter آستانه‌ی
 * جداگانه و بازتری دارد.
 *
 * listener سراسری است (روی document با فاز capture) تا اسکن، مستقل از این‌که
 * فوکوس کجاست، کار کند.
 */

/** کلیدهایی که خودشان کاراکتر نیستند ولی وسط اسکن می‌آیند و نباید بافر را پاک کنند. */
const PASSIVE_KEYS = new Set(['Shift', 'CapsLock', 'AltGraph', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified'])

export function useBarcodeScanner(
  onScan: (barcode: string) => void,
  opts: { enabled?: boolean; minLength?: number; maxGap?: number } = {}
) {
  const { enabled = true, minLength = 4, maxGap = 55 } = opts
  const buffer = useRef('')
  const lastAt = useRef(0)
  const startAt = useRef(0)
  /** ref تا عوض شدن onScan، listener را وسط یک اسکن قطع و بافر را پاک نکند. */
  const handler = useRef(onScan)

  useEffect(() => {
    handler.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!enabled) {
      buffer.current = ''
      return
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) {
        buffer.current = ''
        return
      }
      if (PASSIVE_KEYS.has(e.key)) return

      const now = performance.now()
      const gap = now - lastAt.current
      lastAt.current = now

      if (e.key === 'Enter') {
        const code = buffer.current
        const elapsed = now - startAt.current
        buffer.current = ''
        if (code.length < minLength) return
        // میانگین سرعت تایپ کل رشته = معیار اصلی «اسکن بودن»
        const avgGap = elapsed / Math.max(1, code.length)
        const scanned = avgGap <= maxGap && gap <= maxGap * 6
        if (scanned) {
          e.preventDefault()
          e.stopPropagation()
          handler.current(code)
        }
        return
      }

      if (e.key.length !== 1) {
        buffer.current = ''
        return
      }

      // وقفه‌ی بلندتر از maxGap = تایپ انسان ⇒ بافر از همین کاراکتر شروع می‌شود
      if (gap > maxGap * 6 || !buffer.current) {
        buffer.current = e.key
        startAt.current = now
      } else {
        buffer.current += e.key
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      buffer.current = ''
    }
  }, [enabled, minLength, maxGap])
}

/**
 * همان تشخیص، ولی برای *یک فیلد ورودی* (نه سراسری).
 *
 * چرا لازم است؟ فیلد «کد یا بارکد کالا را وارد کنید یا نام را جستجو کنید» باید
 * هر دو کار را هم‌زمان بکند: تایپ نام برای جستجو، و اسکن بارکد برای افزودن
 * مستقیم کالا. این هوک به فیلد می‌گوید «این Enter از اسکنر آمد یا از انگشت
 * کاربر؟» و صفحه بر همان اساس تصمیم می‌گیرد.
 *
 * خروجی:
 *   onKeyDown  → روی input بگذارید (فقط زمان‌سنجی می‌کند، جلوی چیزی را نمی‌گیرد)
 *   isScan()   → آیا محتوای فعلی فیلد با سرعت اسکنر تایپ شده است؟
 *   reset()    → پاک کردن زمان‌سنج بعد از افزودن کالا
 */
export function useFieldScanDetector(opts: { minLength?: number; maxGap?: number } = {}) {
  const { minLength = 4, maxGap = 55 } = opts
  const count = useRef(0)
  const startAt = useRef(0)
  const lastAt = useRef(0)

  const reset = () => {
    count.current = 0
    startAt.current = 0
    lastAt.current = 0
  }

  const onKeyDown = (e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return reset()
    if (PASSIVE_KEYS.has(e.key)) return
    if (e.key === 'Enter') return
    const now = performance.now()
    if (e.key.length !== 1) return reset()
    const gap = now - lastAt.current
    lastAt.current = now
    if (!count.current || gap > maxGap * 6) {
      count.current = 1
      startAt.current = now
      return
    }
    count.current++
  }

  /** آیا رشته‌ی فعلی به‌اندازه‌ی کافی بلند و به‌اندازه‌ی کافی سریع تایپ شده؟ */
  const isScan = (value: string) => {
    const len = value.trim().length
    if (len < minLength || count.current < minLength) return false
    const elapsed = (lastAt.current || performance.now()) - (startAt.current || performance.now())
    const avg = elapsed / Math.max(1, count.current)
    return avg <= maxGap
  }

  return { onKeyDown, isScan, reset }
}
