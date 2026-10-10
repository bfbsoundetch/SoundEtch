import { Analyzable } from 'analyzers/Analyzable'

/** Paths of the three sound waves, quietest first, in a 500x500 viewBox. */
const WAVES = [
  'M 315 200 A 75 75 0 0 1 315 300',
  'M 365 170 A 120 120 0 0 1 365 330',
  'M 415 140 A 165 165 0 0 1 415 360',
]

/** Level in dBFS at or above which each successive wave becomes visible. */
const WAVE_THRESHOLDS = [-60, -35, -15]

/** White body with a dark rim so the icon reads on both dark and light video. */
const BODY = '#fff'
const OUTLINE = 'rgba(0, 0, 0, 0.75)'

/** Speaker icon whose sound waves (0 to 3) indicate the level of an Analyzable. */
export class SpeakerMeterController {
  readonly svg: SVGSVGElement
  private readonly waves = new Array<SVGGElement>()
  private stopped = false

  constructor(
    parentDiv: HTMLDivElement,
    private analyzable: Analyzable,
  ) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    parentDiv.appendChild(this.svg)
    this.svg.setAttribute('aria-hidden', 'true')
    this.svg.setAttribute('viewBox', '0 0 500 500')

    const speaker = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    speaker.setAttribute('points', '200 230 200 270 270 320 270 180')
    speaker.style.fill = BODY
    speaker.style.stroke = OUTLINE
    speaker.style.strokeWidth = '24'
    // Paint the outline first so the fill covers its inner half, leaving a rim around the body.
    speaker.style.paintOrder = 'stroke fill'
    speaker.style.strokeLinejoin = 'round'
    this.svg.appendChild(speaker)

    for (const wavePath of WAVES) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.style.opacity = '0'
      group.style.transition = 'opacity 120ms'

      // Wider dark stroke underneath the white body leaves a rim around the wave.
      // Round caps keep the rim wrapping around the wave tips, not just the sides.
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      outline.setAttribute('d', wavePath)
      outline.setAttribute('fill', 'none')
      outline.setAttribute('stroke', OUTLINE)
      outline.setAttribute('stroke-width', '52')
      outline.setAttribute('stroke-linecap', 'round')
      group.appendChild(outline)

      const body = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      body.setAttribute('d', wavePath)
      body.setAttribute('fill', 'none')
      body.setAttribute('stroke', BODY)
      body.setAttribute('stroke-width', '28')
      body.setAttribute('stroke-linecap', 'round')
      group.appendChild(body)

      this.svg.appendChild(group)
      this.waves.push(group)
    }
  }

  draw(self: SpeakerMeterController) {
    if (this.stopped) {
      return
    }
    const level = self.analyzable.getLevel()
    let visibleWaves = 0
    while (visibleWaves < WAVE_THRESHOLDS.length && level > WAVE_THRESHOLDS[visibleWaves]) {
      ++visibleWaves
    }
    for (let wave = 0; wave < self.waves.length; ++wave) {
      self.waves[wave].style.opacity = wave < visibleWaves ? '1' : '0'
    }
    requestAnimationFrame((_) => self.draw(self))
  }

  stop() {
    this.stopped = true
  }

  remove() {
    this.svg.remove()
  }
}
