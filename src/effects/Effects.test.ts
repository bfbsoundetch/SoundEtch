import { Effect, replaceEffectRegion } from './Effects'

describe('replaceEffectRegion', () => {
  it('replaces overlapping gain regions with trimmed edges', () => {
    const existing: Effect[] = [
      {
        id: 'left',
        effect: 'gain',
        startSample: 10,
        length: 20,
        value: -6,
      },
      {
        id: 'right',
        effect: 'gain',
        startSample: 40,
        length: 20,
        value: 3,
      },
    ]

    const updated = replaceEffectRegion(existing, {
      id: 'middle',
      effect: 'gain',
      startSample: 20,
      length: 30,
      value: 0,
    })

    expect(updated).toEqual([
      {
        id: 'left',
        effect: 'gain',
        startSample: 10,
        length: 10,
        value: -6,
      },
      {
        id: 'middle',
        effect: 'gain',
        startSample: 20,
        length: 30,
        value: 0,
      },
      {
        id: 'right',
        effect: 'gain',
        startSample: 50,
        length: 10,
        value: 3,
      },
    ])
  })

  it('keeps non-overlapping regions untouched', () => {
    const existing: Effect[] = [
      {
        id: 'first',
        effect: 'gain',
        startSample: 0,
        length: 10,
        value: -3,
      },
    ]

    const updated = replaceEffectRegion(existing, {
      id: 'second',
      effect: 'gain',
      startSample: 20,
      length: 5,
      value: 6,
    })

    expect(updated).toEqual([
      {
        id: 'first',
        effect: 'gain',
        startSample: 0,
        length: 10,
        value: -3,
      },
      {
        id: 'second',
        effect: 'gain',
        startSample: 20,
        length: 5,
        value: 6,
      },
    ])
  })
})
