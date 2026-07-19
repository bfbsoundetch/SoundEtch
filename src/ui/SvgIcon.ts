const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

export type ArrowIconStyle = 'line' | 'block'

type SvgIconOptions = {
  className?: string
  label?: string
}

const arrowSymbolIds: Record<ArrowIconStyle, string> = {
  line: 'arrow-right',
  block: 'arrow-block-right',
}

export function createArrowIcon(style: ArrowIconStyle = 'line', options: SvgIconOptions = {}) {
  return createSvgIcon(arrowSymbolIds[style], options)
}

export function createSvgIcon(symbolId: string, options: SvgIconOptions = {}) {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  icon.setAttribute('viewBox', '0 0 500 500')
  icon.classList.add('svg-icon')
  if (options.className) {
    icon.classList.add(...options.className.split(' ').filter(Boolean))
  }
  if (options.label) {
    icon.setAttribute('role', 'img')
    icon.setAttribute('aria-label', options.label)
  } else {
    icon.setAttribute('aria-hidden', 'true')
    icon.setAttribute('focusable', 'false')
  }

  const use = document.createElementNS(SVG_NAMESPACE, 'use')
  use.setAttribute('href', `#${symbolId}`)
  use.setAttributeNS(XLINK_NAMESPACE, 'href', `#${symbolId}`)
  icon.appendChild(use)
  return icon
}
