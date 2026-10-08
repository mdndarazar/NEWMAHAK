import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { faDigits } from '@shared/jalali'
import {
  STOCK_PICK_TEXT,
  STOCK_SOURCE_TEXT,
  StockSourceKind,
  buildSingleSourcePlan,
  optionKey,
  pendingQuestionText,
  resolveChain,
  shortageHeadline,
  shortageTextLines,
  sourceLabel,
  summaryTextLines,
  summarizePlan,
  type StockAllocationPlan,
  type StockChainLine,
  type StockLineDecision,
  type StockSourcePreview
} from '@shared/stockSource'

/**
 * ===========================================================================
 * جلسه ۵۱ · مرحله ۲-ب — پنجره‌ی «از کدام انبار کسر شود؟» (فاکتور فروش عمده)
 * ---------------------------------------------------------------------------
 * فقط وقتی باز می‌شود که موجودیِ انبارِ انتخاب‌شده برای قلمی کم بیاید (و تیک
 * «برداشت خودکار از انبار مرکزی» خاموش باشد، یا مبدأ انتخابی انبار فروشگاه
 * نباشد). زنجیره‌ی بند ۲ مالک، عیناً:
 *
 *   موجودی تمام شد ← «این کالا در این انبارها موجود است (نام و موجودی)» ←
 *   یا یکی از آن انبارها را انتخاب کن، یا «ادامه با منفی شدن همان انبار» ←
 *   اگر انبار بعدی هم تمام شد، **دوباره همین سؤال**.
 *
 * قاعده‌های ثابت:
 *   • **همه‌ی اقلام کسری‌دار در یک پنجره** (نه یک پنجره برای هر قلم).
 *   • خلاصه‌ی کسری‌ها **قبل از** تأیید نهایی دیده می‌شود.
 *   • «لغو کل فاکتور» در هر مرحله ممکن است (و هیچ چیزی ثبت نشده است، چون
 *     `preview` هیچ‌وقت نمی‌نویسد).
 *   • هیچ منطقی اینجا پیاده نشده: کل تصمیم‌ها با `resolveChain`/`resolveLine`
 *     در `@shared/stockSource` حساب می‌شوند (همان تابعی که سرور هم داخل تراکنش
 *     دوباره اجرا می‌کند) و همان `summarizePlan` خلاصه را می‌سازد. پس پنجره و
 *     سند ثبت‌شده هیچ‌وقت دو عدد متفاوت نمی‌گویند.
 *   • با `STOCK_PLAN_STALE`، میزبان `preview` تازه می‌دهد و همین پنجره از صفر
 *     دوباره اجرا می‌شود (تصمیم‌ها با عوض شدن `preview` پاک می‌شوند).
 * ===========================================================================
 */
export default function StockSourceModal({
  open,
  preview,
  primaryKey,
  busy = false,
  confirmLabel = 'تأیید و ثبت فاکتور',
  passwordRequired = false,
  passwordLabel = 'رمز مدیر (یا رمز دوم اختصاصی همین گزینه)',
  passwordHint,
  onCancel,
  onConfirm
}: {
  open: boolean
  /** خروجی `stock:sourcePreview` — فقط خواندنی */
  preview: StockSourcePreview | null
  /** انباری که کاربر در منوی «کسر از انبار» انتخاب کرده است */
  primaryKey: string
  busy?: boolean
  /** متن دکمه‌ی تأیید (فاکتور عمده: «…ثبت فاکتور» · فروش تکی: «…ثبت فیش») */
  confirmLabel?: string
  /**
   * جلسه ۵۲ · مرحله ۳ — پنجره رمز هم بگیرد؟
   * فقط پنل فروش تکی `true` می‌دهد و فقط وقتی قفل `posCentralWithdrawToggle`
   * **روشن** است: سرور خودش `assertPanelPassword` را صدا می‌زند، پس رمز باید
   * همراه همان درخواست ثبت برود. قفل خاموش ⇒ `false` ⇒ پنجره عیناً مثل قبل.
   * فاکتور عمده هیچ‌وقت `true` نمی‌دهد (رفتار جلسه ۵۱ دست‌نخورده).
   */
  passwordRequired?: boolean
  passwordLabel?: string
  passwordHint?: string
  onCancel: () => void
  /** `password` فقط وقتی معنا دارد که `passwordRequired` باشد؛ وگرنه `null` است. */
  onConfirm: (plan: StockAllocationPlan, password: string | null) => void
}) {
  /** پاسخ‌های کاربر، به تفکیک کالا و به همان ترتیبی که پرسیده شده‌اند. */
  const [decisions, setDecisions] = useState<Record<number, StockLineDecision[]>>({})

  /** جلسه ۵۲ — رمز تأیید (فقط فروش تکی با قفل روشن). هیچ‌وقت ذخیره نمی‌شود. */
  const [password, setPassword] = useState('')

  /** `preview` تازه (اجرای دوباره پس از `STOCK_PLAN_STALE`) ⇒ زنجیره از صفر. */
  useEffect(() => {
    setDecisions({})
  }, [preview, primaryKey])

  /** بسته شدن پنجره ⇒ رمز از حافظه پاک شود (در state نمی‌ماند). */
  useEffect(() => {
    if (!open) setPassword('')
  }, [open])

  const chain = useMemo(
    () => resolveChain(preview?.lines, primaryKey, (id) => decisions[id] ?? []),
    [preview, primaryKey, decisions]
  )

  const nameOf = useMemo(() => {
    const map = new Map((preview?.lines ?? []).map((l) => [l.variantId, l.name]))
    return (id: number) => map.get(id) ?? `کالای ${faDigits(id)}`
  }, [preview])

  /** کسری‌های *اولیه* (قبل از هر تصمیمی) — سر پنجره می‌گوید چرا باز شده است. */
  const initialShortages = useMemo(
    () => buildSingleSourcePlan(preview?.lines, primaryKey).shortages,
    [preview, primaryKey]
  )

  const summary = useMemo(() => summaryTextLines(summarizePlan(chain.plan, nameOf), faDigits), [chain.plan, nameOf])
  const negativeRows = useMemo(
    () => chain.lines.flatMap((r) => r.entries.filter((e) => e.wentNegative).map((e) => ({ row: r, entry: e }))),
    [chain.lines]
  )

  /**
   * بند امنیتیِ دقیق: رمز مدیر فقط وقتی لازم است که برنامه‌ی نهایی حداقل یک
   * مبدأ *غیر از انبار فروشگاه* داشته باشد (همان چیزی که راهنمای داخل کادر هم
   * می‌گوید و سرور هم با `assertPanelPassword` می‌سنجد). برای برنامه‌ی «همه از
   * انبار فروشگاه — با منفی شدن» هیچ رمزی لازم نیست: رضایت فروشنده همان دکمه‌ی
   * تأیید است. قبلاً `passwordRequired && !password` این مسیر فروشگاهی را هم
   * قفل می‌کرد و دکمه‌ی تأیید بدون رمز کار نمی‌کرد.
   */
  const hasForeignSource = useMemo(
    () => (chain.plan?.lines ?? []).some((l) => l.entries.some((e) => e.kind !== StockSourceKind.STORE)),
    [chain.plan]
  )

  const push = (variantId: number, d: StockLineDecision) =>
    setDecisions((prev) => ({ ...prev, [variantId]: [...(prev[variantId] ?? []), d] }))
  const undo = (variantId: number) =>
    setDecisions((prev) => ({ ...prev, [variantId]: (prev[variantId] ?? []).slice(0, -1) }))

  /** وضعیت یک قلمِ تمام‌شده، به زبان آدم. */
  const doneText = (r: StockChainLine): string =>
    r.entries.map((e) => `${sourceLabel(e.kind, e.warehouseName)} ${faDigits(e.qty)}${e.wentNegative ? ' ⚠' : ''}`).join(' · ') ||
    '—'

  return (
    <Modal
      open={open}
      title={STOCK_SOURCE_TEXT.question}
      onClose={onCancel}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {STOCK_SOURCE_TEXT.cancelAll}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !chain.complete || !chain.plan || (passwordRequired && hasForeignSource && !password.trim())}
            onClick={() => chain.plan && onConfirm(chain.plan, passwordRequired && hasForeignSource ? password.trim() : null)}
            title={
              !chain.complete
                ? 'اول به سؤال همه‌ی قلم‌های کسری‌دار جواب بدهید'
                : passwordRequired && hasForeignSource && !password.trim()
                  ? 'برای کسر از انبار دیگر، رمز مدیر یا رمز دوم همین گزینه لازم است'
                  : 'فاکتور با همین مبدأها ثبت می‌شود'
            }
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {!!initialShortages.length && (
        <div className="rounded px-3 py-2 border bg-slate-50 border-slate-300 whitespace-pre-line leading-6">
          <div className="font-bold">{shortageHeadline(initialShortages, faDigits)}</div>
          {shortageTextLines(initialShortages, faDigits).join('\n')}
        </div>
      )}

      {!!chain.errors.length && (
        <div className="rounded px-3 py-2 border bg-rose-50 border-rose-300 whitespace-pre-line leading-6">
          {chain.errors.join('\n')}
        </div>
      )}

      {/* ---------- سؤال‌های باز: یک بلوک برای هر قلمِ کسری‌دار ---------- */}
      {chain.open.map((r) => (
        <div key={r.variantId} className="rounded p-2 border-2 bg-amber-50 border-amber-400 space-y-2">
          <div className="font-bold whitespace-pre-line leading-6">{pendingQuestionText(r, faDigits)}</div>
          {r.pending!.candidates.length ? (
            <>
              <div className="kbd">{STOCK_SOURCE_TEXT.askOther}</div>
              <div className="flex flex-wrap gap-2">
                {r.pending!.candidates.map((c) => (
                  <button
                    key={`${r.variantId}:${optionKey(c)}`}
                    className="btn"
                    onClick={() => push(r.variantId, { type: 'PICK', key: optionKey(c) })}
                    title={c.location ?? undefined}
                  >
                    {sourceLabel(c.kind, c.name)} (موجودی {faDigits(c.available)})
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="kbd">هیچ انبار دیگری این کالا را ندارد، پس فقط «ادامه با موجودی منفی» ممکن است.</div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <button
              className="btn btn-danger"
              onClick={() => push(r.variantId, { type: 'NEGATIVE' })}
              title={`باقی‌مانده از «${sourceLabel(r.pending!.source.kind, r.pending!.source.name)}» کم می‌شود و موجودی همان انبار منفی می‌ماند`}
            >
              ادامه با منفی شدن «{sourceLabel(r.pending!.source.kind, r.pending!.source.name)}»
            </button>
            {r.steps > 0 && (
              <button className="btn" onClick={() => undo(r.variantId)}>
                یک قدم به عقب
              </button>
            )}
          </div>
        </div>
      ))}

      {/* ---------- وضعیت همه‌ی اقلام (چه کسری‌دار، چه تمام‌شده) ---------- */}
      <table className="tbl text-sm">
        <thead>
          <tr>
            <th>کالا</th>
            <th>تعداد</th>
            <th>مبدأ کسر</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {chain.lines.map((r) => (
            <tr key={r.variantId} className={r.complete ? '' : 'bg-amber-50'}>
              <td>{r.itemName}</td>
              <td className="text-center">
                {faDigits(r.requested)} {r.unit}
              </td>
              <td>{doneText(r)}</td>
              <td className="kbd">{r.complete ? 'تمام' : r.error ? r.error : 'در انتظار پاسخ شما'}</td>
            </tr>
          ))}
          {!chain.lines.length && (
            <tr>
              <td colSpan={4} className="text-center p-3">
                قلمی برای بررسی نیست.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ---------- خلاصه‌ی کسری‌ها، قبل از تأیید نهایی (بند ۳) ---------- */}
      {chain.complete && !!summary.length && (
        <div className="rounded px-3 py-2 border bg-sky-50 border-sky-300 whitespace-pre-line leading-6">
          <div className="font-bold">{STOCK_SOURCE_TEXT.shortageTitle}</div>
          {summary.join('\n')}
          {!!negativeRows.length && (
            <div className="mt-1 text-rose-700">
              {`موجودی این انبارها منفی می‌شود: ` +
                negativeRows
                  .map(
                    ({ row, entry }) =>
                      `${sourceLabel(entry.kind, entry.warehouseName)} («${row.itemName}» ⇒ ${faDigits(
                        entry.balanceAfter ?? 0
                      )})`
                  )
                  .join(' · ')}
            </div>
          )}
        </div>
      )}

      {/**
        * ---------- جلسه ۵۲ · مرحله ۳ — رمز تأیید (فقط فروش تکی با قفل روشن) ----------
        * سرور این ثبت را با `assertPanelPassword(PANEL_KEYS.posCentralWithdrawToggle, …)`
        * می‌سنجد، پس این کادر «قفل رندرری» نیست: بی رمز معتبر، سرور رد می‌کند و
        * هیچ موجودی‌ای عوض نمی‌شود. اگر مدیر قفل همین گزینه را خاموش کرده باشد،
        * میزبان `passwordRequired={false}` می‌دهد و این کادر اصلاً ساخته نمی‌شود.
        * نکته‌ی دوم: کادر فقط وقتی دیده می‌شود که برنامه‌ی نهایی واقعاً مبدأی
        * «غیر از انبار فروشگاه» داشته باشد (`hasForeignSource`) — برای مسیر
        * «همه از انبار فروشگاه + منفی» رمزی لازم نیست و این کادر دیده نمی‌شود.
        */}
      {passwordRequired && hasForeignSource && chain.complete && (
        <div className="rounded px-3 py-2 border-2 bg-violet-50 border-violet-400 space-y-1">
          <label className="block font-bold">{passwordLabel}</label>
          <input
            type="password"
            className="inp w-64"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز را وارد کنید"
          />
          <div className="kbd leading-5">
            {passwordHint ??
              'کسر از انباری غیر از انبار فروشگاه تأیید مدیر لازم دارد. این رمز ذخیره نمی‌شود و فقط همین یک ثبت را تأیید می‌کند.'}
          </div>
        </div>
      )}

      <div className="kbd">{STOCK_PICK_TEXT.summaryTitle} بعد از ثبت هم در نتیجه‌ی فاکتور نشان داده می‌شود.</div>
    </Modal>
  )
}
