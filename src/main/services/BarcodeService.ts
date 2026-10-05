import bwipjs from 'bwip-js'

/**
 * تولید تصویر بارکد Code128 برای چاپ لیبل یا نمایش در UI (dataURL).
 * `includetext` پیش‌فرض روشن است (ارقام زیر خطوط بارکد، مثل نمونه‌ی لیبل
 * فروشگاه)؛ در تنظیمات چاپ لیبل قابل خاموش کردن است.
 */
export async function barcodePng(
  text: string,
  opts?: { scale?: number; height?: number; includetext?: boolean }
): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: opts?.scale ?? 3,
    height: opts?.height ?? 12,
    includetext: opts?.includetext !== false,
    textxalign: 'center'
  })
  return `data:image/png;base64,${png.toString('base64')}`
}
