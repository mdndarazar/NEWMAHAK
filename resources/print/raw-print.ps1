# ===========================================================================
# نشست ۲۲۲ · فاز ۵ طرح چاپ — «ارسال کار خام (RAW) به چاپگر ویندوز».
#
# چرا این اسکریپت؟ ارسال بایت خام به صف چاپ ویندوز بدون ماژول native ممکن نیست؛
# اینجا با Add-Type توابع winspool.drv صدا زده می‌شوند و فایل باینری بدون هیچ
# تغییری به صف چاپگر فرستاده می‌شود (datatype = RAW).
#
# کدهای خروج (که در sendRaw.ts به پیام فارسی ترجمه می‌شوند):
#   0 = ارسال به صف انجام شد
#   2 = چاپگر پیدا نشد / باز نشد
#   3 = خطای شروع سند در صف
#   4 = فایل کار خوانده نشد
#   5 = اجرای اسکریپت مسدود شد (سیاست اجرای PowerShell)
#
# ⚠️ موفقیت این اسکریپت = «به صف ویندوز تحویل شد»، نه «کاغذ چاپ شد».
# ===========================================================================

param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -LiteralPath $File)) { exit 4 }
  [byte[]]$bytes = [System.IO.File]::ReadAllBytes($File)
} catch {
  exit 4
}

$signature = @'
using System;
using System.Runtime.InteropServices;

public class MahakRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
'@

try {
  Add-Type -TypeDefinition $signature -ErrorAction Stop
} catch {
  # معمولاً یعنی سیاست اجرا/امضای سازمانی اجازه‌ی کامپایل در زمان اجرا نمی‌دهد.
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 5
}

$handle = [IntPtr]::Zero
try {
  if (-not [MahakRawPrint]::OpenPrinter($Printer, [ref]$handle, [IntPtr]::Zero)) {
    exit 2
  }

  $doc = New-Object MahakRawPrint+DOCINFOW
  $doc.pDocName = 'MAHAK RAW'
  $doc.pOutputFile = $null
  $doc.pDataType = 'RAW'

  if ([MahakRawPrint]::StartDocPrinter($handle, 1, [ref]$doc) -eq 0) { exit 3 }
  try {
    if (-not [MahakRawPrint]::StartPagePrinter($handle)) { exit 3 }

    $unmanaged = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $unmanaged, $bytes.Length)
      $written = 0
      if (-not [MahakRawPrint]::WritePrinter($handle, $unmanaged, $bytes.Length, [ref]$written)) { exit 3 }
      if ($written -ne $bytes.Length) {
        [Console]::Error.WriteLine("WritePrinter wrote $written of $($bytes.Length) bytes")
        exit 3
      }
    } finally {
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($unmanaged)
    }

    if (-not [MahakRawPrint]::EndPagePrinter($handle)) { exit 3 }
  } finally {
    [void][MahakRawPrint]::EndDocPrinter($handle)
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 3
} finally {
  if ($handle -ne [IntPtr]::Zero) { [void][MahakRawPrint]::ClosePrinter($handle) }
}

exit 0
