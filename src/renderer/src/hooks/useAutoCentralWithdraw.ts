import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { call, CH } from '../lib/api'
import { useManagerSession } from './useManagerSession'
import { usePanelOpen, usePanelLock } from './usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import { broadcastSettingsChanged, type SettingsBundle } from './useSettings'
import { withFreshSale, type SaleDefaults } from '@shared/receipt'

/**
 * ===========================================================================
 * چک‌باکس «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی» — یک تنظیم، سه پنل.
 *
 * سه محلی که این چک‌باکس دیده می‌شود کاملاً همگام‌اند، چون همه‌ی سه‌تا یک مقدار
 * واحد را می‌خوانند و می‌نویسند: `sale.autoCentralWithdraw` روی جدول Setting.
 *   ۱) پنل فروش تکی (Pos)
 *   ۲) پنل فاکتور فروش عمده (SalesInvoice)
 *   ۳) پنل تنظیمات انبار مرکزی (SecondaryStock)
 * مدیر که آن را در یکی روشن کند، بعد از ذخیره‌ی همان لحظه، رویداد
 * `mahak:settings-changed` پخش می‌شود و هر پنل بازِ دیگری هم فوراً روشن نشانش
 * می‌دهد (و هر پنلی که بعداً باز شود، مقدار را از دیتابیس می‌خواند).
 *
 * ⚠️ قفل این گزینه (مورد ۱، و از نشست نهم: مورد ۴).
 * تا قبل از این، تغییر این گزینه *فقط* با «نشست مدیر» ممکن بود. حالا — دقیقاً
 * مثل چک‌باکس «چاپ فاکتور» (`posPrintToggle`) و بخش «تخفیف» (`posDiscount`) —
 * کلید قفل مستقل خودش را دارد: `PANEL_KEYS.posCentralWithdrawToggle`. پس:
 *   • رمز مدیر مثل همیشه بازش می‌کند (نشست مدیر = همه‌کاره)،
 *   • یا مدیر می‌تواند برای همین یک گزینه «رمز دوم اختصاصی» بگذارد و آن را به
 *     سرشیفت/انباردار بدهد، بدون افشای رمز مدیریتی،
 *   • یا (اگر خودش بخواهد) قفل همین کلید را از «تنظیمات → رمز → قفل ماژول‌ها»
 *     خاموش کند.
 * کارمندی که هیچ‌کدام را ندارد، مثل قبل نمی‌تواند این گزینه را عوض کند.
 * رفتار خودِ «برداشت خودکار» مو‌به‌مو همان قبل است؛ فقط راهِ باز کردن قفلش
 * یک گزینه‌ی بیشتر دارد.
 * ===========================================================================
 */
export interface AutoCentralWithdraw {
  /** وضعیت فعلی چک‌باکس */
  value: boolean
  /** مدیر پشت سیستم است؟ */
  isManager: boolean
  /** قفل این گزینه باز است؟ (نشست مدیر، یا رمز دوم همین کلید، یا قفل خاموش) */
  unlocked: boolean
  /** چک‌باکس قفل است؟ (کارمند) */
  locked: boolean
  /** آخرین خطای ذخیره (یا پیام قفل) — بعد از نمایش، خودتان پاکش کنید */
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  /** تغییر وضعیت (نمایش فوری + ذخیره‌ی همان لحظه + پخش رویداد همگام‌سازی) */
  toggle: (next: boolean) => Promise<void>
  /** متن راهنمای قفل، برای نمایش کنار چک‌باکس */
  lockHint: string
  /**
   * نشست ۱۵۵ (S151-c1، S155-D2) — سرور تغییر این گزینه را با رمز پنل
   * posCentralWithdrawToggle می‌سنجد (قفل خاموش ⇒ بی‌رمز). وقتی قفل روشن است، پنل‌ها کنار
   * چک‌باکس یک کادر رمز نشان می‌دهند؛ رمز بعد از هر تلاش پاک می‌شود.
   */
  needPassword: boolean
  password: string
  setPassword: Dispatch<SetStateAction<string>>
}

export const AUTO_CENTRAL_LOCK_MESSAGE =
  'این گزینه قفل است. با «رمز مدیر» یا با «رمز دوم اختصاصیِ همین گزینه» (تنظیمات → رمز دوم اختصاصی پنل‌ها → چک‌باکس «برداشت خودکار از انبار مرکزی») باز می‌شود.'

export function useAutoCentralWithdraw(
  sale: SaleDefaults,
  setSettings: Dispatch<SetStateAction<SettingsBundle>>
): AutoCentralWithdraw {
  const { isManager } = useManagerSession()
  /**
   * مورد ۴ — همان تصمیمی که `ManagerGate` با این کلید می‌گیرد، به‌صورت یک بولین:
   * نشست مدیر، یا رمز دومِ همین کلید، یا قفلی که مدیر آگاهانه خاموشش کرده.
   */
  const unlocked = usePanelOpen(PANEL_KEYS.posCentralWithdrawToggle) || isManager
  const { lockEnabled, loaded } = usePanelLock(PANEL_KEYS.posCentralWithdrawToggle)
  const needPassword = !loaded || lockEnabled
  const [password, setPassword] = useState('')
  const [value, setValue] = useState(sale.autoCentralWithdraw === true)
  const [error, setError] = useState<string | null>(null)

  // مقدار ذخیره‌شده (و هر تغییری که پنل دیگری ثبت کرده باشد)
  useEffect(() => {
    setValue(sale.autoCentralWithdraw === true)
  }, [sale.autoCentralWithdraw])

  const toggle = useCallback(
    async (next: boolean) => {
      if (!unlocked) {
        setValue(sale.autoCentralWithdraw === true)
        setError(AUTO_CENTRAL_LOCK_MESSAGE)
        return
      }
      if (needPassword && !password.trim()) {
        setValue(sale.autoCentralWithdraw === true)
        setError('برای تغییر این گزینه، رمز مدیر (یا رمز دوم همین گزینه) را در کادر کنار آن وارد کنید.')
        return
      }
      setError(null)
      setValue(next) // نمایش فوری
      try {
        /** نشست ۱۶۸ (S168-D2) — sale تازه‌ی سرور + فقط autoCentralWithdraw (نه sale لحظه‌ی بازشدن پنل). */
        const fresh = await call<{ sale: SaleDefaults }>(CH.settingsBundle)
        const nextSale = withFreshSale(fresh.sale, { autoCentralWithdraw: next })
        await call(CH.settingsSaveBundle, { sale: nextSale, panelPassword: needPassword ? password : undefined })
        setSettings((p) => ({ ...p, sale: nextSale }))
        broadcastSettingsChanged()
      } catch (e: any) {
        setValue(!next)
        setError(`ذخیره‌ی این گزینه انجام نشد: ${e.message}`)
      } finally {
        setPassword('')
      }
    },
    [unlocked, sale, setSettings, needPassword, password]
  )

  return {
    value,
    isManager,
    unlocked,
    locked: !unlocked,
    error,
    setError,
    toggle,
    needPassword,
    password,
    setPassword,
    lockHint: unlocked
      ? 'قفل این گزینه باز است، پس قابل تغییر است.'
      : 'قفل است: با رمز مدیر یا رمز دوم اختصاصی همین گزینه باز می‌شود.'
  }
}
