/**
 * نام روی فاکتور خرید = همان فهرست تامین‌کننده؛ تکراری ساخته نمی‌شود.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-supplier-ensure.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-ens-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { partyService } = await import('../../src/main/services/PartyService.ts')

harnessClient()

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 280))
  }
}

const a = await partyService.ensureSupplier({ name: 'ارکاجین' })
eq('نام تازه ردیف می‌سازد', a.name, 'ارکاجین')
eq('کد میان‌بر ۱', String(a.code), '1')
const again = await partyService.ensureSupplier({ name: 'ارکاجین' })
eq('همان نام دوباره ردیف تازه نمی‌سازد', again.id, a.id)
const byCode = await partyService.ensureSupplier({ name: '1' })
eq('عدد ۱ همان ارکاجین است', byCode.id, a.id)
const b = await partyService.ensureSupplier({ name: 'علی محمدی' })
eq('نام دوم کد ۲', String(b.code), '2')
eq('دو ردیف در فهرست', (await partyService.suppliers()).length, 2)
let threw = false
try {
  await partyService.ensureSupplier({ name: '9' })
} catch {
  threw = true
}
eq('کد ناموجود تامین‌کننده نمی‌سازد', threw, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
