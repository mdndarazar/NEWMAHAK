#!/bin/bash
# usage: run-regression.sh <repo-dir> <out-file> [parallelism]
REPO="$1"; OUT="$2"; P="${3:-3}"
LOGDIR="${OUT%.txt}.logs"; rm -rf "$LOGDIR"; mkdir -p "$LOGDIR"
cd "$REPO" || exit 2
run_one() { f="$1"; logdir="$2"; name=$(echo "$f" | tr '/' '_'); if timeout 1200 node --import ./test/harness/register.mjs "$f" > "$logdir/$name.log" 2>&1; then echo "PASS $f"; else echo "FAIL $f (exit $?)"; fi; }
export -f run_one
suite() {
  local title="$1"; local glob="$2"; local tag="$3"
  echo "## $title"
  ls $glob | xargs -P "$P" -I{} bash -c 'run_one "$@"' _ {} "$LOGDIR" | sort -k2 > "$LOGDIR/$tag.txt"
  cat "$LOGDIR/$tag.txt"
  local T=$(wc -l < "$LOGDIR/$tag.txt"); local PS=$(grep -c '^PASS' "$LOGDIR/$tag.txt"); local F=$(grep -c '^FAIL' "$LOGDIR/$tag.txt")
  echo "TOTAL=$T PASS=$PS FAIL=$F"
  echo "FAILED: $(grep '^FAIL' "$LOGDIR/$tag.txt" | awk '{print $2}' | xargs -r -n1 basename | tr '\n' ' ')"
}
{
  date -u +"start %FT%TZ"
  # ---------------------------------------------------------------------------
  # 🔴 نشست ۱۸۵ — typecheck داخل *همین* لاگ اجرا می‌شود.
  #
  # تا امروز `npm run typecheck` جدا اجرا می‌شد و نتیجه‌اش هیچ‌جا در فایل
  # خروجی نمی‌نشست. بازبینی مستقل درست گرفت: لاگ تحویلی هیچ اثری از tsc
  # نداشت، پس ادعای «typecheck سبز است» از روی همان فایل **قابل راستی‌آزمایی
  # نبود**.
  #
  # حالا خروجی واقعی (یا دلیل اجرا نشدن) همیشه بالای همین فایل است.
  # ---------------------------------------------------------------------------
  echo "## typecheck"
  if [ -x ./node_modules/.bin/tsc ]; then
    if ./node_modules/.bin/tsc --noEmit -p tsconfig.json > "$LOGDIR/typecheck.txt" 2>&1; then
      echo "TYPECHECK_OK (0 error) · tsc $(./node_modules/.bin/tsc -v 2>/dev/null)"
    else
      echo "TYPECHECK_FAILED · $(grep -c 'error TS' "$LOGDIR/typecheck.txt") خطا"
      head -40 "$LOGDIR/typecheck.txt"
    fi
  else
    echo "TYPECHECK_SKIPPED · ./node_modules/.bin/tsc پیدا نشد (npm install اجرا نشده است)"
  fi
  echo "## guards"
  node tools/check-money-fields.mjs 2>&1 | tail -2
  node tools/check-test-coverage.mjs 2>&1 | tail -1
  suite "tests/audit-fixes/*.mjs" "tests/audit-fixes/*.mjs" af
  # 🔴 نشست ۱۸۱ — این خط جا افتاده بود و ۸۴ تست هرگز اجرا نمی‌شدند.
  #
  # پیامدش این بود که گزارش‌های «رگرسیون کامل، بدون افت» چند نشست پشت سر هم
  # یک پوشه‌ی کامل را اصلاً نمی‌دیدند. در نشست ۱۸۱ همین باعث شد شکستن
  # `tests/audit/audit-a107-01-credit-batch-scope.mjs` (که از یک تغییر ناخواسته
  # در migration می‌آمد) بی‌صدا از رگرسیون رد شود و فقط در بازبینی بیرونی
  # پیدا شود.
  #
  # قاعده: هر پوشه‌ی تستی که در مخزن هست باید در همین اسکریپت اجرا شود.
  suite "tests/audit/*.mjs" "tests/audit/*.mjs" audit
  # 🔴 بازبینی گزارش مدیریت — ۲۱ تست `tests/management/` هرگز در این اسکریپت
  # اجرا نمی‌شدند (همان خطایی که نشست ۱۸۱ برای tests/audit گرفته بود؛ نگهبان
  # `check-test-coverage.mjs` هم خودِ همین پوشه را رد می‌زند).
  suite "tests/management/*.mjs" "tests/management/*.mjs" mgmt
  # ماژول پیامکی: منطق خالص + اجرای واقعی صف روی دیتابیس هارنس.
  suite "tests/sms/*.mjs" "tests/sms/*.mjs" sms
  suite "test/*.mjs" "test/*.mjs" legacy
  echo "## esbuild"
  node tools/esbuild-check.mjs $(find src -name "*.ts" -o -name "*.tsx") | tail -1
  node tools/esbuild-bundle-check.mjs
  date -u +"end %FT%TZ"
  echo DONE
} > "$OUT" 2>&1
