import { useMemo } from 'react'
import PasswordField from './PasswordField'
// نشست ۳۱۷ — کارت چاپ سند اعتبار (فونت/حاشیه/پیش‌نمایش/چاپ آزمایشی)
import CreditPrintCard from './CreditPrintCard'
import JalaliDateInput from './JalaliDateInput'
import { CheckField, HolderFields, NumberField, ScopePicker, SelectField, TextField } from './CreditPickers'
import type { Party } from './PartyPicker'
import { faDigits, money } from '@shared/jalali'
import {
  CREDIT_ALPHABET_OPTIONS,
  CREDIT_EXPIRY_MODE_OPTIONS,
  CREDIT_OP_HELP,
  CREDIT_PAPER_OPTIONS,
  CREDIT_USES_MODE_OPTIONS,
  CreditOp,
  buildBulkPayload,
  buildIssuePayload,
  buildOpPayload,
  opFields,
  previewCodeSpace,
  setTypeRule,
  settingsWarnings,
  type BulkDraft,
  type IssueDraft,
  type OpDraft
} from '@shared/creditUi'
import { CREDIT_PLACEHOLDERS, CREDIT_RULE_LABELS, CreditPaper, type CreditSettings } from '@shared/credit'

/**
 * ===========================================================================
 * فرم‌های ماژول «مدیریت اعتبار خرید» (جلسه ۲۸).
 *
 * سه فرم این ماژول تا جلسه ۲۷ روی هم ۳ خط JSX بودند و همین باعث شده بود:
 *   • فرم صدور  ⇒ هر اعتباری «همه‌ی کالاها، بدون سقف، بدون گیرنده» صادر شود.
 *   • فرم تنظیمات ⇒ ۱۸ تنظیمِ موجود در Backend هیچ‌وقت قابل تغییر نباشد.
 *   • فرم عملیات ⇒ چهار عملیات از ۹ عملیات مدیریتی از UI *غیرقابل انجام* باشد.
 *
 * هیچ‌کدام از این سه، گپِ Backend نبود: `buildIssuePayload` / `buildSettingsPayload`
 * / `buildOpPayload` از جلسه ۲۲ همه‌ی این فیلدها را می‌گرفتند و اعتبارسنجی
 * می‌کردند. فقط از UI پر نمی‌شدند. این فایل همان پرکردن است.
 *
 * ⚠️ هر سه فرم نتیجه‌ی همان `build*Payload` را **زنده** نشان می‌دهند (خطای
 * مسدودکننده + هشدارها)، پس کاربر پیام فارسی را قبل از زدن دکمه می‌بیند و
 * هشدارها دیگر بی‌صدا رد نمی‌شوند (§۱۰ و §۱۸).
 * ===========================================================================
 */

function Problems({ error, warnings }: { error: string | null; warnings: string[] }) {
  return (
    <>
      {error && <div className="bg-rose-50 border border-rose-300 rounded p-2 whitespace-pre-line">{error}</div>}
      {warnings.map((w) => (
        <div className="bg-amber-50 border border-amber-300 rounded p-2 whitespace-pre-line" key={w}>
          {w}
        </div>
      ))}
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: any }) {
  return (
    <div className="border rounded p-2 space-y-2">
      <b>{title}</b>
      {hint && <div className="kbd">{hint}</div>}
      {children}
    </div>
  )
}

/* ===========================================================================
 * ۱) فرم صدور تکی و تولید گروهی (§۳ · §۵ · §۶ · §۱۲ · §۱۸)
 * ======================================================================== */

export function IssueForm({
  value,
  setValue,
  party,
  setParty,
  settings,
  bulk = false,
  busy = false,
  onSubmit
}: {
  value: IssueDraft & Partial<BulkDraft>
  setValue: (fn: (v: any) => any) => void
  party: Party | null
  setParty: (p: Party | null) => void
  settings: CreditSettings
  bulk?: boolean
  busy?: boolean
  onSubmit: () => void
}) {
  const set = (patch: Record<string, unknown>) => setValue((v: any) => ({ ...v, ...patch }))

  /** همان تابعی که لحظه‌ی ثبت هم صدا زده می‌شود ⇒ پیش‌نمایش خطا/هشدار بدون رفت‌و‌برگشت. */
  const check = useMemo(
    () => (bulk ? buildBulkPayload(value as BulkDraft, settings) : buildIssuePayload(value, settings)),
    [bulk, value, settings]
  )

  /** §۶ — «فضای کد کافی است؟» قبل از زدن دکمه، نه بعد از خطای Backend. */
  const space = useMemo(
    () => (bulk ? previewCodeSpace(Number(value.count ?? 0), settings, Number(value.codeLength ?? 0), value.prefix ?? '') : null),
    [bulk, value.count, value.codeLength, value.prefix, settings]
  )

  return (
    <div className="space-y-3">
      <Section title="مبلغ و تعداد">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <NumberField
            label={bulk ? 'مبلغ هر اعتبار (ریال)' : 'مبلغ اعتبار (ریال)'}
            value={value.amount}
            onChange={(v) => set({ amount: v })}
            hint={value.amount > 0 ? `${money(value.amount)} ریال` : 'الزامی'}
          />
          {bulk && (
            <NumberField
              label="تعداد اعتبارها"
              value={Number(value.count ?? 0)}
              onChange={(v) => set({ count: v })}
              min={1}
              max={settings.bulkMaxCount}
              hint={`سقف تنظیمات: ${faDigits(settings.bulkMaxCount)}`}
            />
          )}
          {bulk && (
            <NumberField
              label="طول کد این دسته (۰ = طول پیش‌فرض تنظیمات)"
              value={Number(value.codeLength ?? 0)}
              onChange={(v) => set({ codeLength: v })}
              hint={space ? `فضای ممکن با این تنظیمات: ${faDigits(space.capacity)} کد · طول مؤثر ${faDigits(space.length)}` : undefined}
            />
          )}
        </div>
        {bulk && <TextField label="عنوان دسته" value={String(value.title ?? '')} onChange={(v) => set({ title: v })} placeholder="مثلاً جشنواره‌ی نوروز" />}
        {bulk && !!value.count && (
          <div className="kbd">
            جمع مبلغ این دسته: {money(Math.max(0, Math.round(value.amount || 0)) * Math.max(0, Math.round(Number(value.count) || 0)))} ریال
          </div>
        )}
      </Section>

      <Section title="اعتبار زمانی و دفعات مصرف" hint="خروج از پیش‌فرضِ نوع، «دلیل استثنا» می‌خواهد و روی همان رکورد ثبت می‌شود (§۳).">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <SelectField
            label="مدت اعتبار"
            value={value.expiryMode}
            onChange={(v) => set({ expiryMode: v })}
            options={CREDIT_EXPIRY_MODE_OPTIONS as any}
          />
          <NumberField
            label="تعداد روز"
            value={value.days}
            onChange={(v) => set({ days: v, expiryMode: 'days' })}
            min={1}
            disabled={value.expiryMode !== 'days'}
          />
          <SelectField label="دفعات مصرف" value={value.usesMode} onChange={(v) => set({ usesMode: v })} options={CREDIT_USES_MODE_OPTIONS as any} />
        </div>
        {value.usesMode === 'count' && (
          <NumberField label="حداکثر دفعات" value={value.maxUses} onChange={(v) => set({ maxUses: v })} min={2} />
        )}
      </Section>

      <Section title="دامنه‌ی مصرف و محدودیت‌ها (§۱۸)">
        <ScopePicker
          scope={value.restrictScope}
          categoryIds={value.restrictCategoryIds}
          variantIds={value.restrictVariantIds}
          minPurchase={value.minPurchase}
          maxPerTransaction={value.maxPerTransaction}
          onChange={set}
        />
      </Section>

      <HolderFields value={value} onChange={set} party={party} setParty={setParty} />

      <Section title="کد، وضعیت و توضیح">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <TextField
            label="پیشوند کد (خالی = پیشوند پیش‌فرض همین نوع)"
            value={value.prefix}
            onChange={(v) => set({ prefix: v })}
            ltr
            hint={`پیش‌فرض مدیریتی: ${settings.prefixManual || '—'}`}
          />
          <TextField label="توضیح اعتبار" value={value.note} onChange={(v) => set({ note: v })} />
        </div>
        {!bulk && (
          <CheckField
            label="به‌صورت «پیش‌نویس» ساخته شود"
            checked={value.asDraft === true}
            onChange={(v) => set({ asDraft: v })}
            hint="پیش‌نویس تا فعال‌سازی قابل مصرف نیست."
          />
        )}
        <TextField
          label="دلیل استثنا"
          value={value.overrideReason}
          onChange={(v) => set({ overrideReason: v })}
          placeholder="اگر قواعد پیش‌فرض این نوع را تغییر می‌دهید، دلیل اجباری است"
          hint={check.override ? 'این صدور از پیش‌فرض نوعش فاصله دارد ⇒ دلیل اجباری است.' : 'این صدور روی پیش‌فرض نوعش است ⇒ دلیل لازم نیست.'}
        />
      </Section>

      <Problems error={check.error} warnings={check.warnings} />
      <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !check.ok}>
        {busy ? 'در حال ثبت…' : bulk ? 'تولید گروهی' : 'ثبت اعتبار'}
      </button>
    </div>
  )
}

/* ===========================================================================
 * ۲) فرم عملیات مدیریتی (§۱۰ · §۱۱ · §۱۲ · §۱۸)
 * ======================================================================== */

export function OpForm({
  value,
  setValue,
  credit,
  party,
  setParty
}: {
  value: OpDraft | null
  setValue: (fn: (v: any) => any) => void
  credit: any
  party: Party | null
  setParty: (p: Party | null) => void
}) {
  if (!value) return null
  const set = (patch: Record<string, unknown>) => setValue((v: any) => ({ ...v, ...patch }))
  const fields = opFields(value.op)
  const check = buildOpPayload(value, credit)

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-300 rounded p-2 whitespace-pre-line">{CREDIT_OP_HELP[value.op]}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block">
          <span>رمز مدیر</span>
          <PasswordField className="inp" value={value.managerPassword} onChange={(e: any) => set({ managerPassword: e.target.value })} />
        </label>
        <TextField label="دلیل (اجباری، در تاریخچه ثبت می‌شود)" value={value.reason} onChange={(v) => set({ reason: v })} />
      </div>

      {fields.includes('extendDays') && (
        <NumberField
          label="روز تمدید"
          value={value.extendDays}
          onChange={(v) => set({ extendDays: v })}
          hint="اعتبار منقضی بدون تمدید، یک ثانیه بعد دوباره منقضی است."
        />
      )}

      {fields.includes('expiry') && (
        <Section title="تاریخ انقضای جدید" hint="خالی = بدون انقضا. مقدار قبل و بعد در تاریخچه می‌نشیند.">
          <JalaliDateInput value={value.expiresAtJalali} onChange={(v) => set({ expiresAtJalali: v })} />
          {!!value.expiresAtJalali && (
            <button className="btn py-1" onClick={() => set({ expiresAtJalali: '' })}>
              پاک‌کردن تاریخ (بدون انقضا)
            </button>
          )}
        </Section>
      )}

      {fields.includes('amount') && (
        <NumberField
          label="مبلغ جدید (ریال)"
          value={value.amount}
          onChange={(v) => set({ amount: v })}
          hint="فقط روی اعتبار بدون هیچ مصرفی مجاز است."
        />
      )}

      {fields.includes('uses') && (
        <Section title="دفعات مصرف و سقف هر تراکنش">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <SelectField label="حالت دفعات" value={value.usesMode} onChange={(v) => set({ usesMode: v })} options={CREDIT_USES_MODE_OPTIONS as any} />
            <NumberField
              label="حداکثر دفعات"
              value={value.maxUses}
              onChange={(v) => set({ maxUses: v })}
              min={2}
              disabled={value.usesMode !== 'count'}
              hint={`دفعات مصرف‌شده تا حالا: ${faDigits(Math.max(0, Math.round(Number(credit?.usedCount ?? 0))))}`}
            />
            <NumberField label="سقف هر تراکنش (ریال)" value={value.maxPerTransaction} onChange={(v) => set({ maxPerTransaction: v })} hint="۰ = بدون سقف" />
          </div>
        </Section>
      )}

      {fields.includes('holder') && <HolderFields value={value} onChange={set} party={party} setParty={setParty} />}

      {fields.includes('restriction') && (
        <Section title="محدودیت مصرف جدید (§۱۸)" hint="این عملیات مقدار فعلی را *جایگزین* می‌کند، پس فرم با مقدار فعلی همین اعتبار پر شده است.">
          <ScopePicker
            scope={value.restrictScope}
            categoryIds={value.restrictCategoryIds}
            variantIds={value.restrictVariantIds}
            minPurchase={value.minPurchase}
            maxPerTransaction={value.maxPerTransaction}
            onChange={set}
          />
        </Section>
      )}

      <Problems error={check.error} warnings={check.warnings} />
    </div>
  )
}

/* ===========================================================================
 * ۳) تنظیمات مرکزی (§۶ · §۷ · §۱۳ · §۱۴ · §۱۵ · §۲۲)
 * ======================================================================== */

export function SettingsForm({
  settings,
  setSettings,
  onSave,
  busy = false,
  password,
  setPassword
}: {
  settings: CreditSettings
  setSettings: (fn: (s: CreditSettings) => CreditSettings) => void
  onSave: () => void
  busy?: boolean
  /**
   * نشست ۱۵۴ (S151-b) — رمز پنل creditSettings برای گیت سمت سرور. `undefined` =
   * قفل خاموش (کادر نمایش داده نمی‌شود)؛ رشته = کادر رمز و دکمه تا رمز خالی است غیرفعال.
   */
  password?: string
  setPassword?: (v: string) => void
}) {
  const set = (patch: Partial<CreditSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const setReminder = (patch: Record<string, unknown>) => setSettings((s) => ({ ...s, reminder: { ...s.reminder, ...patch } as any }))
  const setRule = (key: string, patch: Record<string, unknown>) => setSettings((s) => setTypeRule(s, key, patch))
  const warnings = settingsWarnings(settings)

  return (
    <div className="bg-white rounded shadow p-4 space-y-3">
      <Section title="کد اعتبار (§۶)">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <NumberField label="طول کد" value={settings.codeLength} onChange={(v) => set({ codeLength: v })} min={6} max={20} />
          <SelectField
            label="مجموعه‌ی کاراکترها"
            value={settings.codeAlphabet}
            onChange={(v) => set({ codeAlphabet: v as any })}
            options={CREDIT_ALPHABET_OPTIONS}
          />
          <TextField label="پیشوند اعتبار مدیریتی" value={settings.prefixManual} onChange={(v) => set({ prefixManual: v })} ltr />
          <TextField label="پیشوند اعتبار تعویض" value={settings.prefixExchange} onChange={(v) => set({ prefixExchange: v })} ltr />
        </div>
        <CheckField
          label="کاراکترهای مشابه (O/0/I/1/S/5) در کدهای جدید استفاده نشود"
          checked={settings.excludeSimilar}
          onChange={(v) => set({ excludeSimilar: v })}
          hint="روی کدهای قدیمی اثر ندارد؛ آن‌ها همچنان خوانده و مصرف می‌شوند."
        />
        <CheckField
          label="در صورت کمبود فضای کد، طول کد خودکار زیاد شود"
          checked={settings.autoGrowLength}
          onChange={(v) => set({ autoGrowLength: v })}
          hint="هر بار که این اتفاق بیفتد، در نتیجه‌ی تولید گروهی و در دسته گزارش می‌شود."
        />
      </Section>

      <Section title="تولید گروهی (§۵)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <NumberField label="سقف تعداد در هر تولید گروهی" value={settings.bulkMaxCount} onChange={(v) => set({ bulkMaxCount: v })} min={1} />
          <NumberField
            label="ضریب ایمنی فضای کد"
            value={settings.bulkCapacityRatio}
            onChange={(v) => set({ bulkCapacityRatio: v })}
            min={1}
            hint="۲۰ = حداکثر ۵٪ فضای کد پر شود (جلوگیری از تصادم پشت تصادم)."
          />
        </div>
      </Section>

      <Section title="قواعد پیش‌فرض هر نوع اعتبار (§۳)" hint="تغییر این قواعد فقط روی اعتبارهای آینده اثر دارد؛ snapshot تاریخ/مدت اعتبارهای قبلی دست‌نخورده می‌ماند.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.keys(settings.types).map((k) => (
            <div key={k} className="border rounded p-2 space-y-1">
              <b>{CREDIT_RULE_LABELS[k] ?? k}</b>
              {k === 'EXCHANGE' && (
                <div className="kbd leading-5">
                  این قاعده برای اعتبار صادرشده از برگشت فروش و مابه‌التفاوت تعویض مشترک است. تا زمانی که قاعدهٔ مستقلی برای
                  اضافه‌دریافت تعریف نشده، اعتبار اضافه‌دریافت نیز از همین قاعده ارث می‌برد.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="مدت (روز · ۰ = بدون انقضا)"
                  value={settings.types[k].days}
                  onChange={(v) => setRule(k, { days: v })}
                  hint="برای بدون انقضا، عدد ۰ را صریح وارد کنید. خالی‌کردن این فیلد نیز در نسخهٔ فعلی ۰ ذخیره می‌کند."
                />
                <NumberField label="حداکثر دفعات" value={settings.types[k].maxUses} onChange={(v) => setRule(k, { maxUses: v })} min={1} />
              </div>
              <CheckField
                label="چندباره‌مصرف باشد (تا ته پول، روی همین بارکد)"
                checked={settings.types[k].multiUse}
                onChange={(v) => setRule(k, { multiUse: v })}
                hint="روشن = مشتری می‌تواند چند بار از همین بارکد خرج کند تا مبلغش تمام شود."
              />
              {/*
                نشست ۱۸۳ — گزینه‌ی سوم. تا امروز فقط دو حالت وجود داشت و حالتِ
                «کوپن واقعاً یک‌بارمصرف» ممکن نبود؛ باقی‌مانده همیشه به بارکد
                جدید می‌رفت. حالا مالک برای هر نوع جداگانه تصمیم می‌گیرد.
                وقتی «چندباره» روشن است این گزینه معنا ندارد و غیرفعال می‌شود.
              */}
              {!settings.types[k].multiUse && (
                <CheckField
                  label="باقی‌مانده روی همین بارکد بماند"
                  checked={settings.types[k].carryRemainder}
                  onChange={(v) => setRule(k, { carryRemainder: v })}
                  hint={
                    'روشن (پیش‌فرض) = اعتبار ۱٬۰۰۰٬۰۰۰ که ۵۰۰٬۰۰۰ خرج شده، ۵۰۰٬۰۰۰ باقی‌مانده‌اش روی ' +
                    '«همین» بارکد می‌ماند و مشتری با همان کاغذ دفعه‌ی بعد خرجش می‌کند (بارکد جدیدی صادر نمی‌شود). ' +
                    'خاموش = کوپن یک‌بارمصرف؛ با یک مصرف — حتی جزئی — باقی‌مانده می‌سوزد. ' +
                    '⚠️ این تصمیم در لحظه‌ی صدور روی خودِ بارکد ثبت می‌شود، پس بارکدهای قبلی دست‌نخورده می‌مانند.'
                  }
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="بارکد و سند چاپی (§۷ و §۱۳)">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <NumberField label="ارتفاع بارکد (میلی‌متر)" value={settings.barcodeHeightMm} onChange={(v) => set({ barcodeHeightMm: v })} min={5} max={60} />
          <SelectField label="اندازه‌ی کاغذ" value={settings.paper} onChange={(v) => set({ paper: v as any })} options={CREDIT_PAPER_OPTIONS} />
          <NumberField
            label="عرض سفارشی (میلی‌متر)"
            value={settings.customWidthMm}
            onChange={(v) => set({ customWidthMm: v })}
            min={40}
            max={400}
            disabled={settings.paper !== CreditPaper.CUSTOM}
          />
          <NumberField
            label="ارتفاع سفارشی (میلی‌متر)"
            value={settings.customHeightMm}
            onChange={(v) => set({ customHeightMm: v })}
            min={40}
            max={600}
            disabled={settings.paper !== CreditPaper.CUSTOM}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <CheckField label="کد به‌صورت متن زیر بارکد چاپ شود" checked={settings.barcodeIncludeText} onChange={(v) => set({ barcodeIncludeText: v })} />
          <CheckField label="قوانین استفاده روی سند چاپ شود" checked={settings.showRules} onChange={(v) => set({ showRules: v })} />
          <CheckField label="اطلاعات گیرنده روی سند چاپ شود" checked={settings.showHolder} onChange={(v) => set({ showHolder: v })} />
          <CheckField label="مبلغ باقی‌مانده روی سند چاپ شود" checked={settings.showRemaining} onChange={(v) => set({ showRemaining: v })} />
        </div>
        <label className="block">
          <span>متن قوانین استفاده</span>
          <textarea className="inp h-20" value={settings.rulesText} onChange={(e) => set({ rulesText: e.target.value })} />
        </label>
      </Section>

      {/* نشست ۳۱۷ — کارت چاپ سند اعتبار (فونت/حاشیه/پیش‌نمایش/چاپ آزمایشی) */}
      <CreditPrintCard settings={settings} set={set} />

      <Section title="یادآوری (§۱۴)" hint="هیچ ارسال واقعی‌ای انجام نمی‌شود؛ پیام آماده و در لاگ ثبت می‌شود.">
        <CheckField label="یادآوری فعال باشد" checked={settings.reminder.enabled} onChange={(v) => setReminder({ enabled: v })} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <NumberField label="حداقل روز از صدور" value={settings.reminder.minDaysSinceIssue} onChange={(v) => setReminder({ minDaysSinceIssue: v })} />
          <NumberField label="حداقل فاصله بین دو یادآوری (روز)" value={settings.reminder.minGapDays} onChange={(v) => setReminder({ minGapDays: v })} />
          <NumberField label="حداکثر تعداد یادآوری" value={settings.reminder.maxCount} onChange={(v) => setReminder({ maxCount: v })} />
          <NumberField label="چند روز قبل از انقضا" value={settings.reminder.beforeExpiryDays} onChange={(v) => setReminder({ beforeExpiryDays: v })} />
        </div>
        <label className="block">
          <span>متن پیام یادآوری</span>
          <textarea className="inp h-24" value={settings.reminder.template} onChange={(e) => setReminder({ template: e.target.value })} />
          <span className="kbd">جای‌گذاری‌های مجاز: {CREDIT_PLACEHOLDERS.join(' · ')}</span>
        </label>
      </Section>

      <Section title="گزارش مالی (§۱۵)">
        <CheckField
          label="اعتبار صادرشده‌ی مصرف‌نشده به‌عنوان «تعهد فروشگاه» گزارش شود"
          checked={settings.reportLiability}
          onChange={(v) => set({ reportLiability: v })}
          hint="این عدد بدهی فروشگاه است، نه فروش."
        />
      </Section>

      {warnings.map((w) => (
        <div className="bg-amber-50 border border-amber-300 rounded p-2 whitespace-pre-line" key={w}>
          {w}
        </div>
      ))}
      {password !== undefined && (
        <label className="flex flex-col gap-1">
          <span className="kbd">رمز مدیر یا رمز دوم «تنظیمات اعتبار خرید» (سمت سرور هم بررسی می‌شود)</span>
          <PasswordField value={password} onChange={(e) => setPassword?.(e.target.value)} />
        </label>
      )}
      <button
        className="btn btn-primary"
        onClick={onSave}
        disabled={busy || (password !== undefined && !password.trim())}
      >
        {busy ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
      </button>
    </div>
  )
}
