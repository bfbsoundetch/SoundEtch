import type { OutputCaptionCue, OutputCaptionSettings } from '../project/OutputCaptions'

type CaptionContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface CaptionLayout {
  cue: OutputCaptionCue
  fontFamily: string
  fontSize: number
  borderWidth: number
  letterSpacing: string
  width: number
  height: number
  font: string
  scale: number
  edgeInset: number
  textHeight: number
  words: { text: string; x: number; y: number }[]
}

// A context retains only its current cue, never a project's transcript or settings/track references.
const layouts = new WeakMap<CaptionContext, CaptionLayout>()

function createLayout(
  context: CaptionContext,
  cue: OutputCaptionCue,
  settings: Readonly<OutputCaptionSettings>,
  width: number,
  height: number,
  borderWidth: number,
): CaptionLayout {
  const viewportScale = Math.min(width / 1920, height / 1080)
  const font = `700 ${settings.fontSize}px ${settings.fontFamily}`
  context.font = font
  // Reserve the outline's two half-widths between glyphs, retaining the browser's kerning.
  const letterSpacing = `${borderWidth}px`
  context.letterSpacing = letterSpacing
  const space = context.measureText(' ').width
  const widths: number[] = []
  const prefix = [0]
  let ascent = settings.fontSize * 0.8
  let descent = settings.fontSize * 0.2
  for (const word of cue.words) {
    const metrics = context.measureText(word.text)
    widths.push(metrics.width)
    prefix.push(prefix[prefix.length - 1] + metrics.width + space)
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent)
    descent = Math.max(descent, metrics.actualBoundingBoxDescent)
  }
  const lineWidth = (start: number, end: number): number => prefix[end] - prefix[start] - space
  const availableWidth = width / viewportScale - 2 * 116
  const fullWidth = lineWidth(0, cue.words.length)
  let split = cue.words.length
  let widest = fullWidth
  if (fullWidth > availableWidth) {
    // The most balanced word-boundary split gives the largest legible font when two lines need shrinking.
    for (let index = 1; index < cue.words.length; ++index) {
      const candidate = Math.max(lineWidth(0, index), lineWidth(index, cue.words.length))
      if (candidate < widest) {
        widest = candidate
        split = index
      }
    }
  }
  const lines = split === cue.words.length ? [cue.words.length] : [split, cue.words.length]
  const lineHeight = Math.max(settings.fontSize, ascent + descent) * 1.25
  const textHeight = ascent + descent + (lines.length - 1) * lineHeight
  const shrink = Math.min(1, availableWidth / Math.max(1, widest), (height / viewportScale * 0.3) / textHeight)
  const scale = viewportScale * shrink
  const words: CaptionLayout['words'] = []
  let start = 0
  lines.forEach((end, line) => {
    let wordX = -lineWidth(start, end) / 2
    const wordY = -descent - (lines.length - line - 1) * lineHeight
    for (let index = start; index < end; ++index) {
      words.push({ text: cue.words[index].text, x: wordX, y: wordY })
      wordX += widths[index] + space
    }
    start = end
  })
  return {
    cue,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    borderWidth,
    letterSpacing,
    width,
    height,
    font,
    scale,
    edgeInset: 72 * viewportScale,
    textHeight: textHeight * scale,
    words,
  }
}

/** Paints the final, horizontally centered overlay in the supplied 16:9 viewport without clearing or resetting transforms. */
export function paintOutputCaption(
  context: CaptionContext,
  cue: OutputCaptionCue,
  activeWord: number,
  settings: Readonly<OutputCaptionSettings>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!settings.enabled || !cue.words.length || width <= 0 || height <= 0 || settings.fontSize <= 0) return
  const borderWidth = settings.borderEnabled === false ? 0 : Math.max(3, settings.fontSize * 0.1)
  context.save()
  try {
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.direction = 'ltr'
    context.fontKerning = 'normal'
    let layout = layouts.get(context)
    if (
      !layout ||
      layout.cue !== cue ||
      layout.fontFamily !== settings.fontFamily ||
      layout.fontSize !== settings.fontSize ||
      layout.borderWidth !== borderWidth ||
      layout.width !== width ||
      layout.height !== height
    ) {
      layout = createLayout(context, cue, settings, width, height, borderWidth)
      layouts.set(context, layout)
    }
    context.font = layout.font
    context.letterSpacing = layout.letterSpacing
    const bottom = settings.position === 'top'
      ? layout.edgeInset + layout.textHeight
      : settings.position === 'middle'
        ? (height + layout.textHeight) / 2
        : height - layout.edgeInset
    context.translate(x + width / 2, y + bottom)
    context.scale(layout.scale, layout.scale)
    context.globalCompositeOperation = 'source-over'
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetX = 0
    context.shadowOffsetY = 0
    if (borderWidth > 0) {
      context.lineJoin = 'round'
      context.lineWidth = borderWidth
      context.strokeStyle = settings.borderColor ?? 'rgba(0, 0, 0, 0.95)'
      for (const word of layout.words) context.strokeText(word.text, word.x, word.y)
    }
    for (let index = 0; index < layout.words.length; ++index) {
      const word = layout.words[index]
      context.fillStyle = index === activeWord ? settings.highlightColor : settings.color
      context.fillText(word.text, word.x, word.y)
    }
  } finally {
    context.restore()
  }
}
