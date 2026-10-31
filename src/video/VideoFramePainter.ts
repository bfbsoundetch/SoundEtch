import type { VideoSample } from 'mediabunny'

/** Paints in canvas coordinates; optional overflow storage is owned and reused by the caller. */
export function paintVideoFrame(
  context: CanvasRenderingContext2D,
  frame: VideoSample,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'contain' | 'cover',
  cropX = 0.5,
  cropY = 0.5,
  cornerRadius = 0,
  overflow?: { x: number; y: number },
): void {
  if (overflow) {
    overflow.x = 0
    overflow.y = 0
  }
  if (width <= 0 || height <= 0) return
  // Display dimensions include pixel aspect ratio and rotation; VideoSample.draw applies both.
  const cover = fit === 'cover'
  const scale = cover
    ? Math.max(width / frame.displayWidth, height / frame.displayHeight)
    : Math.min(width / frame.displayWidth, height / frame.displayHeight)
  // Keep floating-point rounding from opening a hairline at the slot edge.
  const drawWidth = cover ? Math.max(width, frame.displayWidth * scale) : frame.displayWidth * scale
  const drawHeight = cover ? Math.max(height, frame.displayHeight * scale) : frame.displayHeight * scale
  const overflowX = Math.max(0, drawWidth - width)
  const overflowY = Math.max(0, drawHeight - height)
  if (overflow) {
    overflow.x = overflowX
    overflow.y = overflowY
  }
  const drawX = x + (cover ? -overflowX * Math.max(0, Math.min(1, cropX)) : (width - drawWidth) / 2)
  const drawY = y + (cover ? -overflowY * Math.max(0, Math.min(1, cropY)) : (height - drawHeight) / 2)
  context.save()
  try {
    // Unlike a preview's separate canvases, output slots share a canvas. Always confine overflow.
    context.beginPath()
    context.rect(x, y, width, height)
    context.clip()
    if (cornerRadius > 0) {
      const clipWidth = cover ? width : drawWidth
      const clipHeight = cover ? height : drawHeight
      context.beginPath()
      context.roundRect(
        cover ? x : drawX,
        cover ? y : drawY,
        clipWidth,
        clipHeight,
        Math.min(cornerRadius, clipWidth / 2, clipHeight / 2),
      )
      context.clip()
    }
    frame.draw(context, drawX, drawY, drawWidth, drawHeight)
  } finally {
    context.restore()
  }
}
