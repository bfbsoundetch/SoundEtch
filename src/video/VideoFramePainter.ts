import type { VideoSample } from 'mediabunny'

/** Paints in canvas coordinates; optional overflow storage is owned and reused by the caller. */
export function paintVideoFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: VideoSample,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'contain' | 'cover',
  cropX = 0.5,
  cropY = 0.5,
  cornerRadius = 0,
  zoom = 1,
  margin = 0,
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
    ? Math.max(width / frame.displayWidth, height / frame.displayHeight) * Math.max(1, Math.min(4, zoom))
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
  // Margin reveals or hides the fixed picture; it never participates in fitting or panning.
  const inset = Math.max(0, margin)
  const clipX = Math.max(drawX, x + inset)
  const clipY = Math.max(drawY, y + inset)
  const clipRight = Math.min(drawX + drawWidth, x + width - inset)
  const clipBottom = Math.min(drawY + drawHeight, y + height - inset)
  const clipWidth = clipRight - clipX
  const clipHeight = clipBottom - clipY
  if (clipWidth <= 0 || clipHeight <= 0) return
  context.save()
  try {
    // Round the visible intersection, including a contained picture's letterboxed edges.
    // Always clip, even with square corners: output slots share a single canvas.
    context.beginPath()
    if (cornerRadius > 0) {
      context.roundRect(clipX, clipY, clipWidth, clipHeight, Math.min(cornerRadius, clipWidth / 2, clipHeight / 2))
    } else {
      context.rect(clipX, clipY, clipWidth, clipHeight)
    }
    context.clip()
    frame.draw(context, drawX, drawY, drawWidth, drawHeight)
  } finally {
    context.restore()
  }
}
