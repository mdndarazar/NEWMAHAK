import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import Shell from './components/Shell'
import Dashboard from './pages/Dashboard'
import Pos from './pages/Pos'
import Products from './pages/Products'
import PurchaseInvoice from './pages/PurchaseInvoice'
import SalesInvoice from './pages/SalesInvoice'
import SalesReports from './pages/SalesReports'
import ManagementReports from './pages/ManagementReports'
import SmsPanel from './pages/SmsPanel'
import WooSync from './pages/WooSync'
import CashClose from './pages/CashClose'
import Consolidation from './pages/Consolidation'
import SalesReturn from './pages/SalesReturn'
import Settings from './pages/Settings'
import CategoryCharges from './pages/CategoryCharges'
import ManagerGate from './components/ManagerGate'
import { ManagerSessionProvider } from './hooks/useManagerSession'
import SecondaryStock from './pages/SecondaryStock'
import Stocktake from './pages/Stocktake'
import PriceAdjust from './pages/PriceAdjust'
import CreditManagement from './pages/CreditManagement'
import { enableRowResize } from './lib/rowResize'
import { enableColResize } from './lib/colResize'
import { enableTableLayoutFab } from './lib/tableLayoutFab'
import { PANEL_KEYS, type PanelKey } from '@shared/panels'

/**
 * پنل «عوارض و مالیات» و «حق سرویس» پشت قفل رمز مدیر (مورد ۴).
 * همان `ManagerGate` پنل تنظیمات/کالاها/فاکتور خرید، با همان رمز و همان نشست
 * مدیر؛ پس یک بار ورود مدیر، همه‌ی این پنل‌ها را تا «خروج مدیر» باز می‌کند.
 */
function ChargesGate({ kind, scope }: { kind: 'tax' | 'service'; scope: 'pos' | 'wholesale' }) {
  const title = kind === 'tax' ? 'عوارض و مالیات' : 'حق سرویس'
  const panel = scope === 'wholesale' ? 'فاکتور فروش عمده' : 'پنل فروش'
  const key: PanelKey =
    kind === 'tax'
      ? scope === 'wholesale'
        ? PANEL_KEYS.chargesTaxWholesale
        : PANEL_KEYS.chargesTaxPos
      : scope === 'wholesale'
        ? PANEL_KEYS.chargesServiceWholesale
        : PANEL_KEYS.chargesServicePos
  return (
    <ManagerGate
      panel={key}
      title={`${title} · ${panel}`}
      reason={`مقدار ${title} روی همه‌ی فاکتورهای ${panel} اثر می‌گذارد، پس فقط با رمز مدیریتی باز می‌شود و کارمند نمی‌تواند آن را ببیند یا تغییر دهد.`}
    >
      <CategoryCharges kind={kind} scope={scope} />
    </ManagerGate>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      {
        path: 'pos',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.pos}
            title="پنل فروش"
            reason="پنل فروش تکی با رمز باز می‌شود؛ رمز دوم اختصاصی‌اش را می‌توانید به فروشنده‌ی همان شیفت بدهید."
          >
            <Pos />
          </ManagerGate>
        )
      },
      {
        path: 'products',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.products}
            title="کالاها"
            reason="در پنل کالاها موجودی وارد و تغییر می‌شود و کالا تعریف یا حذف می‌گردد، پس فقط با رمز مدیریتی باز می‌شود."
          >
            <Products />
          </ManagerGate>
        )
      },
      {
        path: 'purchase',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.purchase}
            title="فاکتور خرید"
            reason="فاکتور خرید موجودی انبار را افزایش می‌دهد، پس فقط با رمز مدیریتی باز می‌شود."
          >
            <PurchaseInvoice />
          </ManagerGate>
        )
      },
      {
        path: 'sales-invoice',
        element: (
          <ManagerGate panel={PANEL_KEYS.wholesaleInvoiceModule} title="ماژول فاکتور فروش عمده" reason="صدور فاکتور فروش عمده روی موجودی انبار و بدهکاری مشتری اثر دارد، پس با رمز باز می‌شود. این قفل کاملاً جدا از قفل تب «فاکتورهای عمده» است.">
            <SalesInvoice />
          </ManagerGate>
        )
      },
      {
        path: 'sales-reports',
        element: (
          <ManagerGate panel={PANEL_KEYS.salesReports} title="گزارشات فروش" reason="گزارشات فروش سرجمع و جزئیات فروش، برگشت‌ها و تعویض‌ها را نشان می‌دهد، پس با رمز باز می‌شود.">
            <SalesReports />
          </ManagerGate>
        )
      },
      {
        path: 'management-reports',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.managementReports}
            title="گزارش مدیریت"
            reason="گزارش مدیریت نمودار روند، مقایسهٔ فروشنده و کالای مانده را نشان می‌دهد و جدا از گزارشات فروش است، پس با رمز باز می‌شود."
          >
            <ManagementReports />
          </ManagerGate>
        )
      },
      {
        /**
         * پنل پیامکی — صفحه‌ی مستقل.
         *
         * قفلِ خودِ صفحه با `smsPanel` است؛ تب‌های «سرویس‌دهنده» و «عملیات
         * حساس» قفل جداگانه‌ی خودشان را داخل صفحه دارند. این ماژول هیچ
         * ارتباطی با گزارش مدیریت، گزارشات فروش یا بستن صندوق ندارد.
         */
        path: 'sms-panel',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.smsPanel}
            title="پنل پیامکی"
            reason="پنل پیامکی صف ارسال، سابقه‌ی پیام مشتریان و قالب‌های متن را نشان می‌دهد و کلید سرویس‌دهنده را نگه می‌دارد، پس با رمز باز می‌شود."
          >
            <SmsPanel />
          </ManagerGate>
        )
      },
      {
        path: 'woo-sync',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.wooSync}
            title="همگام‌سازی موجودی سایت"
            reason="این بخش موجودی فروشگاه را به stock_quantity سایت WooCommerce وصل می‌کند و می‌تواند موجودی هر دو طرف را تغییر دهد؛ پس با رمز اختصاصی خودش باز می‌شود."
          >
            <WooSync />
          </ManagerGate>
        )
      },
      {
        path: 'cash-close',
        element: (
          <ManagerGate panel={PANEL_KEYS.cashClose} title="بستن صندوق" reason="بستن صندوق پایان شیفت را ثبت می‌کند و دریافتی‌های شیفت را نشان می‌دهد، پس با رمز باز می‌شود.">
            <CashClose />
          </ManagerGate>
        )
      },
      {
        path: 'consolidation',
        element: (
          <ManagerGate panel={PANEL_KEYS.consolidation} title="تجمیع و انتقال" reason="تجمیع، کسر موجودی انبار روز را قطعی می‌کند و برگشت‌ناپذیر است، پس با رمز باز می‌شود.">
            <Consolidation />
          </ManagerGate>
        )
      },
      {
        path: 'sales-return',
        element: (
          <ManagerGate panel={PANEL_KEYS.salesReturn} title="برگشت از فروش و تعویض کالا" reason="برگشت از فروش و تعویض کالا مستقیم روی موجودی انبار و پول اثر می‌گذارد، پس با رمز باز می‌شود.">
            <SalesReturn />
          </ManagerGate>
        )
      },
      /**
       * انبار مرکزی: یک فهرست مستقل و اطلاعاتی، ولی مثل بقیه‌ی پنل‌های حساس
       * (کالاها، فاکتور خرید و …) قفل رمزی دارد. پیش‌فرض با رمز مدیر باز می‌شود و
       * در صورت تمایل می‌توان از «تنظیمات → تنظیمات رمز» یک رمز دوم اختصاصی هم
       * برایش گذاشت و به انباردار داد.
       */
      {
        path: 'secondary-stock',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.secondaryStock}
            title="انبار مرکزی"
            reason="فهرست انبار مرکزی (انبار ذخیره) اطلاعات موجودی ذخیره‌ی فروشگاه است، پس با رمز باز می‌شود."
          >
            <SecondaryStock />
          </ManagerGate>
        )
      },
      /**
       * جلسه ۱۸ · بندهای ۴ و ۵ — ماژول «انبارگردانی»: فرم ثبت شمارش فیزیکی،
       * جلسه‌های شمارش، گزارش «مغایرت نیازمند بررسی» و تنظیمات یادآوری.
       *
       * قفلش طبق همان قانون همیشگی پروژه از `PANEL_KEYS.stocktake` می‌آید (ردیفش
       * از جلسه ۱۷ در `LOCKED_PANELS` هست)، پس مدیر می‌تواند از «تنظیمات → رمز»
       * یک رمز دوم اختصاصی برایش بگذارد و به انباردار بدهد.
       */
      {
        path: 'stocktake',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.stocktake}
            title="انبارگردانی"
            reason="ثبت شمارش فیزیکی قفسه و گزارش مغایرت موجودی، داده‌ی حساس انبار است، پس با رمز مدیر (یا رمز دوم اختصاصی همین ماژول) باز می‌شود. ثبت شمارش هیچ‌وقت موجودی انبار را تغییر نمی‌دهد."
          >
            <Stocktake />
          </ManagerGate>
        )
      },
      /**
       * تغییر قیمت گروهی. اینجا <ManagerGate> نمی‌گذاریم چون خودِ صفحه‌ی
       * PriceAdjust درونش گیت دارد (panel = priceAdjust)؛ دو گیت تودرتو یعنی دو
       * بار پرسیدن رمز برای یک کار.
       */
      { path: 'price-adjust', element: <PriceAdjust /> },
      {
        path: 'credit-management',
        element: <CreditManagement />
      },
      /**
       * چهار زیرپنل مستقل عوارض/حق سرویس (دو پنل × دو اسکوپ).
       * مسیرهای قدیمی بدون اسکوپ هم به نسخه‌ی «پنل فروش» می‌روند تا لینک‌های
       * قبلی نشکنند.
       *
       * ⚠️ قفل رمزی (مورد ۴): این دو پنل مقدار مالیات و حق سرویسِ *همه‌ی*
       * فاکتورها را تعیین می‌کنند، پس مثل پنل تنظیمات/کالاها/فاکتور خرید فقط با
       * رمز مدیریتی باز می‌شوند و کارمند به آن‌ها دسترسی ندارد. تا وقتی «نشست
       * مدیر» فعال باشد، بدون رمز دوباره باز می‌مانند (همان منطق قبلی).
       */
      { path: 'charges/tax', element: <ChargesGate kind="tax" scope="pos" /> },
      { path: 'charges/service', element: <ChargesGate kind="service" scope="pos" /> },
      { path: 'charges/tax/pos', element: <ChargesGate kind="tax" scope="pos" /> },
      { path: 'charges/service/pos', element: <ChargesGate kind="service" scope="pos" /> },
      { path: 'charges/tax/wholesale', element: <ChargesGate kind="tax" scope="wholesale" /> },
      { path: 'charges/service/wholesale', element: <ChargesGate kind="service" scope="wholesale" /> },
      {
        path: 'settings',
        element: (
          <ManagerGate
            panel={PANEL_KEYS.settings}
            title="تنظیمات"
            reason="تنظیمات برنامه فقط با رمز مدیریتی باز می‌شود. رمز اولیه ۱۱۱۱ است و بعد از ورود، از همین پنل قابل تغییر است."
          >
            <Settings />
          </ManagerGate>
        )
      }
    ]
  }
])

/**
 * تغییر اندازه‌ی جدول‌ها با ماوس، روی **همه‌ی** جدول‌های برنامه:
 *   • عرض ستون‌ها (مورد ۳ نشست یازدهم) — lib/colResize.ts
 *   • ارتفاع ردیف‌ها (مورد ۲ نشست‌های قبل) — lib/rowResize.ts
 * ترتیب عمدی است: ستون‌کش اول ثبت می‌شود تا وقتی نشانگر روی مرز *ستون* است،
 * همان کلیک را بردارد و ردیف‌کش سراغش نرود.
 */
enableColResize()
enableRowResize()
/**
 * دکمه‌ی شناور «↺ برگشت به پیش‌فرض» برای هر جدولی که چیدمان دستی دارد
 * (ستون با colResize، ردیف با rowResize) — بدون دست‌زدن به هیچ صفحه‌ای.
 */
enableTableLayoutFab()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* «نشست مدیر» باید بالاتر از روتر باشد تا با جابه‌جایی بین پنل‌ها از بین نرود */}
    <ManagerSessionProvider>
      <RouterProvider router={router} />
    </ManagerSessionProvider>
  </React.StrictMode>
)
