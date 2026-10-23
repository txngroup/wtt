// A QR code as an SVG string, for a link a phone wallet opens. Low error correction keeps the code sparse, which phone
// cameras read more reliably off a screen. qrcode-generator loads on first use.
export async function qrSvg(text: string) {
  const q = (await import('qrcode-generator')).default(0, 'L')
  q.addData(text)
  q.make()
  return q.createSvgTag({ cellSize: 5, margin: 4 })
}
