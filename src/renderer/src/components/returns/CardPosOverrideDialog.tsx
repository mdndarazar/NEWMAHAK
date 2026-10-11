import { useState } from 'react'
import Modal from '../Modal'
import PasswordField from '../PasswordField'

export default function CardPosOverrideDialog({
  open,
  onClose,
  onConfirm
}: {
  open: boolean
  onClose: () => void
  onConfirm: (override: { managerPassword: string; reason: string; acknowledgedNoReverse: true }) => void
}) {
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleConfirm = () => {
    if (!password.trim()) return setErr('رمز مدیر را وارد کنید.')
    if (!reason.trim() || reason.trim().length < 3) return setErr('دلیل مدیر حداقل ۳ نویسه باشد.')
    if (!acknowledged) return setErr('تیک تعهد و اطلاع از عدم برگشت خودکار پوز را بزنید.')

    onConfirm({
      managerPassword: password.trim(),
      reason: reason.trim(),
      acknowledgedNoReverse: true
    })
    setPassword('')
    setReason('')
    setAcknowledged(false)
    setErr(null)
  }

  return (
    <Modal open={open} title="🔒 تأیید مدیر برای بازپرداخت کارتی (کارت‌خوان)" onClose={onClose} width="max-w-md">
      <div className="space-y-3 text-sm">
        <div className="rounded border-2 border-rose-400 bg-rose-50 p-2.5 text-rose-900 leading-6 text-xs font-semibold">
          ⚠ <b>هشدار مهم:</b> دستگاه‌های کارت‌خوان بانکی (پوز) در ایران امکان واریز برگشت مستقیم پول به کارت مشتری را ندارند.
          ثبت این گزینه بدون تراکنش فیزیکی باعث مغایرت در گزارش‌ها می‌شود. گزینه استاندارد، «کارت‌به‌کارت (تعهد مدیر)» است.
        </div>

        {err && <div className="rounded border border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">{err}</div>}

        <label className="flex items-start gap-2 rounded border p-2 bg-slate-50 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 mt-0.5"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="text-xs leading-5 text-slate-800 font-medium">
            می‌دانم که پوز بانکی پول را واریز نمی‌کند و مسئولیت واریز دستی/کارت‌به‌کارت بر عهده مدیریت است.
          </span>
        </label>

        <div>
          <label className="block text-xs font-bold mb-1">رمز مدیر</label>
          <PasswordField
            placeholder="رمز مدیر فروشگاه"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-bold mb-1">دلیل بازپرداخت کارتی (حداقل ۳ نویسه)</label>
          <input
            className="inp w-full text-xs"
            placeholder="مثلاً: برگشت وجه با کارت هدیه سازمانی / پوز ویژه"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn text-xs" onClick={onClose}>
            انصراف
          </button>
          <button
            className="btn btn-primary text-xs"
            disabled={!password || !reason || !acknowledged}
            onClick={handleConfirm}
          >
            تأیید و باز کردن قفل کارتی
          </button>
        </div>
      </div>
    </Modal>
  )
}
