import PasswordField from './PasswordField'
import type { AutoCentralWithdraw } from '../hooks/useAutoCentralWithdraw'

/**
 * نشست ۱۵۵ (S151-c1، S155-D2) — کادر رمز کنار چک‌باکس «برداشت خودکار از انبار مرکزی».
 * سرور تغییر این گزینه را با رمز پنل posCentralWithdrawToggle می‌سنجد (قفل خاموش ⇒ بی‌رمز)،
 * پس وقتی قفل روشن است و چک‌باکس برای کاربر باز است، رمز همین‌جا گرفته و همراه ذخیره
 * فرستاده می‌شود. یک کامپوننت مشترک برای هر سه پنل (فروش تکی، فاکتور عمده، انبار مرکزی).
 */
export default function AutoCentralPasswordBox({ box }: { box: AutoCentralWithdraw }) {
  if (!box.needPassword || box.locked) return null
  return (
    <div className="mt-1 max-w-xs" title="رمز مدیر یا رمز دوم همین گزینه؛ بعد از هر تلاش پاک می‌شود">
      <PasswordField
        value={box.password}
        placeholder="رمز تغییر برداشت خودکار"
        onChange={(e) => box.setPassword(e.target.value)}
      />
    </div>
  )
}
