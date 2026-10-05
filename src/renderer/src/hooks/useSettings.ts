import { useCallback, useEffect, useState } from 'react'
import { call, CH } from '../lib/api'
import {
  DEFAULT_LABEL_TEMPLATE,
  DEFAULT_RECEIPT_TEMPLATE,
  DEFAULT_SALE_DEFAULTS,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_SHIFT_CONFIG,
  parseLabelTemplate,
  parseSecurityConfig,
  parseShiftConfig,
  parseOfficialTimeConfig,
  type LabelTemplate,
  type ReceiptTemplate,
  type SaleDefaults,
  type SecurityConfig,
  type ShiftConfig,
  type OfficialTimeConfig
} from '@shared/receipt'
import { parseCategoryCharge, type CategoryChargeConfig } from '@shared/charges'
import { DEFAULT_DISCOUNT_POLICY, parseDiscountPolicy, type DiscountPolicy } from '@shared/priceAdjust'
import { DEFAULT_CREDIT_SETTINGS, parseCreditSettings, type CreditSettings } from '@shared/credit'

export interface ScopedCharges {
  tax: CategoryChargeConfig
  service: CategoryChargeConfig
}

export interface SettingsBundle {
  receipt: ReceiptTemplate
  sale: SaleDefaults
  shift: ShiftConfig
  /** تنظیمات چاپ لیبل (چاپگر لیبل‌زن و ابعاد لیبل) — مستقل از قالب فاکتور */
  label: LabelTemplate
  /**
   * عوارض و مالیات / حق سرویس، *تفکیک‌شده برای هر پنل*:
   * تنظیمات پنل فروش خرد (pos) و فاکتور فروش عمده (wholesale) کاملاً مستقل‌اند.
   */
  charges: { pos: ScopedCharges; wholesale: ScopedCharges }
  /**
   * تنظیمات امنیتی «قفل موقت بعد از رمز اشتباه» (بخش ۲): فعال/غیرفعال، حداکثر
   * تلاش ناموفق، و مدت قفل به دقیقه. فرمش در «تنظیمات → مدیریت» است و همان
   * مقداری است که `AuthService` برای قفل کردن گیت‌ها می‌خواند.
   */
  security: SecurityConfig
  /**
   * بند ۳ — «سیاست تخفیف پنل فروش»: آزاد / فقط تخفیف ثابت مدیر / غیرفعال، به
   * همراه سقف‌ها و دو سوییچ «تخفیف روی کالا» و «تخفیف کل فاکتور».
   *
   * پنل فروش همین مقدار را می‌خواند و سقف اختیار فروشنده را از آن می‌گیرد، پس
   * تنظیمش در یک جا (ماژول «تخفیف و افزایش/کاهش قیمت») روی همه‌ی پنل‌های فروش
   * اثر می‌گذارد. پیش‌فرض `FREE` است تا رفتار نسخه‌های قبل عوض نشود.
   */
  discount: DiscountPolicy
  credit: CreditSettings
  time: OfficialTimeConfig
}

const EMPTY_CHARGE: CategoryChargeConfig = { enabled: true, rules: [], fallback: null }

/**
 * ---------------------------------------------------------------------------
 * رویداد «تنظیمات عوض شد» — همگام‌سازی زنده‌ی چند پنل باز (مورد ۱).
 *
 * چند پنل مختلف یک تنظیم مشترک را نشان می‌دهند (مثلاً چک‌باکس «برداشت خودکار از
 * انبار مرکزی» در پنل فروش تکی، فاکتور فروش عمده و تنظیمات انبار مرکزی). هر
 * پنل با باز شدن، تنظیمات را از دیتابیس می‌خواند؛ این رویداد همان کار را برای
 * پنل‌هایی که *همین حالا باز‌اند* انجام می‌دهد، پس سه محل هیچ‌وقت وضعیت متفاوت
 * نشان نمی‌دهند.
 * ---------------------------------------------------------------------------
 */
export const SETTINGS_CHANGED_EVENT = 'mahak:settings-changed'

/** بعد از هر ذخیره‌ی تنظیمات صدا زده می‌شود تا پنل‌های باز خودشان را تازه کنند. */
export function broadcastSettingsChanged(): void {
  try {
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
  } catch {
    /* رویداد یک «سهولت» است؛ اگر نشد، هر پنل با باز شدن دوباره می‌خواند */
  }
}

const FALLBACK: SettingsBundle = {
  receipt: DEFAULT_RECEIPT_TEMPLATE,
  sale: DEFAULT_SALE_DEFAULTS,
  shift: DEFAULT_SHIFT_CONFIG,
  label: DEFAULT_LABEL_TEMPLATE,
  security: DEFAULT_SECURITY_CONFIG,
  discount: DEFAULT_DISCOUNT_POLICY,
  credit: DEFAULT_CREDIT_SETTINGS,
  time: { offsetHours: 0 },
  charges: {
    pos: { tax: EMPTY_CHARGE, service: EMPTY_CHARGE },
    wholesale: { tax: EMPTY_CHARGE, service: EMPTY_CHARGE }
  }
}

/**
 * خواندن تنظیمات (قالب رسید، پیش‌فرض‌های فروش، شیفت‌ها، و مقدارهای عوارض و
 * مالیات / حق سرویس هر دسته‌بندی کالا برای هر دو پنل).
 * اگر خواندن به هر دلیلی نشد، پیش‌فرض‌ها برگردانده می‌شوند تا هیچ صفحه‌ای
 * به‌خاطر تنظیمات از کار نیفتد.
 */
export function useSettings() {
  const [settings, setSettings] = useState<SettingsBundle>(FALLBACK)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const s = await call<SettingsBundle>(CH.settingsBundle)
      if (s)
        setSettings({
          receipt: { ...FALLBACK.receipt, ...s.receipt },
          sale: { ...FALLBACK.sale, ...s.sale },
          shift: parseShiftConfig(s.shift),
          label: parseLabelTemplate(s.label),
          charges: {
            pos: {
              tax: parseCategoryCharge(s.charges?.pos?.tax),
              service: parseCategoryCharge(s.charges?.pos?.service)
            },
            wholesale: {
              tax: parseCategoryCharge(s.charges?.wholesale?.tax),
              service: parseCategoryCharge(s.charges?.wholesale?.service)
            }
          },
          security: parseSecurityConfig(s.security),
          discount: parseDiscountPolicy(s.discount),
          credit: parseCreditSettings(s.credit),
          time: parseOfficialTimeConfig(s.time)
        })
    } catch {
      setSettings(FALLBACK)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // همگام‌سازی زنده: هر پنلی که تنظیمات را ذخیره کند، این پنل هم تازه می‌شود
  useEffect(() => {
    const onChanged = () => void reload()
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged)
  }, [reload])

  return { settings, setSettings, reload, loading }
}
