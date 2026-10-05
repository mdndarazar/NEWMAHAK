import { Fragment, useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { faDigits } from '@shared/jalali'

/**
 * «دسته‌بندی»: ساخت و ویرایش گروه و زیرگروه کالا.
 * IPC: category:tree (خواندن، لیست تخت با parentId) و category:upsert (ثبت/ویرایش).
 * محدودیت آگاهانه: فقط دو سطح (گروه ← زیرگروه)، چون فرم کالا و پنل فروش
 * دو سطح را نمایش می‌دهند. مدل Prisma خودش عمق بیشتری را پشتیبانی می‌کند.
 */
export default function CategoryModal({
  open,
  cats,
  onClose,
  onChanged
}: {
  open: boolean
  cats: any[]
  onClose: () => void
  onChanged: (cats: any[], msg: string) => void
}) {
  const [rows, setRows] = useState<any[]>(cats)
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows(cats)
    reset()
  }, [open, cats])

  const reset = () => {
    setEditId(null)
    setName('')
    setParentId(null)
    setErr(null)
  }

  const roots = useMemo(() => rows.filter((c) => !c.parentId), [rows])
  const childrenOf = (id: number) => rows.filter((c) => c.parentId === id)

  const save = async () => {
    if (!name.trim()) return setErr('نام گروه الزامی است')
    if (editId && parentId === editId) return setErr('یک گروه نمی‌تواند والد خودش باشد')
    setBusy(true)
    try {
      await call(CH.categoryUpsert, { id: editId ?? undefined, name: name.trim(), parentId })
      const fresh = await call<any[]>(CH.categoryTree)
      setRows(fresh)
      onChanged(fresh, editId ? 'گروه ویرایش شد' : 'گروه جدید ثبت شد')
      reset()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c: any) => {
    setEditId(c.id)
    setName(c.name)
    setParentId(c.parentId ?? null)
    setErr(null)
  }

  return (
    <Modal
      open={open}
      title="دسته‌بندی کالا"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <button className="btn" onClick={onClose}>
          بستن <span className="keycap">Esc</span>
        </button>
      }
    >
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-7 border border-slate-200 rounded overflow-auto max-h-[50vh]">
          <table className="tbl">
            <thead>
              <tr>
                <th>گروه / زیرگروه</th>
                <th>کد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roots.map((r) => (
                <Fragment key={r.id}>
                  <tr className={editId === r.id ? 'sel' : ''}>
                    <td className="font-bold">{r.name}</td>
                    <td>{faDigits(r.id)}</td>
                    <td>
                      <button className="text-brand" onClick={() => startEdit(r)}>
                        ویرایش
                      </button>
                      <button
                        className="text-brand ms-2"
                        onClick={() => {
                          reset()
                          setParentId(r.id)
                        }}
                      >
                        زیرگروه
                      </button>
                    </td>
                  </tr>
                  {childrenOf(r.id).map((c) => (
                    <tr key={c.id} className={editId === c.id ? 'sel' : ''}>
                      <td className="ps-6 text-slate-600">— {c.name}</td>
                      <td>{faDigits(c.id)}</td>
                      <td>
                        <button className="text-brand" onClick={() => startEdit(c)}>
                          ویرایش
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {!roots.length && (
                <tr>
                  <td colSpan={3} className="text-center py-8 text-slate-400">
                    هنوز گروهی ثبت نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="col-span-5 space-y-2">
          <div className="font-bold">{editId ? 'ویرایش گروه' : 'گروه جدید'}</div>
          <label className="block">
            <div className="mb-1">نام</div>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً شلوار" />
          </label>
          <label className="block">
            <div className="mb-1">زیرگروهِ</div>
            <select className="inp" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— گروه اصلی —</option>
              {roots
                .filter((r) => r.id !== editId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
            {editId && (
              <button className="btn" onClick={reset}>
                جدید
              </button>
            )}
          </div>
          {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
          <div className="kbd">حذف گروه در این نسخه فعال نیست تا کالاهای متصل بی‌گروه نشوند.</div>
        </div>
      </div>
    </Modal>
  )
}
