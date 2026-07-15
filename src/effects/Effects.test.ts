// import { Effect, EffectType, gainDbToLinear, replaceEffectRegion } from './Effects'

// describe('replaceEffectRegion', () => {
//   it('replaces overlapping gain regions with trimmed edges', () => {
//     const existing: Effect[] = [
//       {
//         type: EffectType.GAIN,
//         startPosition: 10,
//         length: 20,
//         gainDb: -6,
//       },
//       {
//         type: EffectType.GAIN,
//         startPosition: 40,
//         length: 20,
//         gainDb: 3,
//       },
//     ]

//     const updated = replaceEffectRegion(existing, {
//       type: EffectType.GAIN,
//       startPosition: 20,
//       length: 30,
//       gainDb: 0,
//     })

//     expect(updated).toEqual([
//       {
//         type: EffectType.GAIN,
//         startPosition: 10,
//         length: 10,
//         gainDb: -6,
//       },
//       {
//         type: EffectType.GAIN,
//         startPosition: 20,
//         length: 30,
//         gainDb: 0,
//       },
//       {
//         type: EffectType.GAIN,
//         startPosition: 50,
//         length: 10,
//         gainDb: 3,
//       },
//     ])
//   })

//   it('keeps non-overlapping regions untouched', () => {
//     const existing: Effect[] = [
//       {
//         type: EffectType.GAIN,
//         startPosition: 0,
//         length: 10,
//         gainDb: -3,
//       },
//     ]

//     const updated = replaceEffectRegion(existing, {
//       type: EffectType.GAIN,
//       startPosition: 20,
//       length: 5,
//       gainDb: 6,
//     })

//     expect(updated).toEqual([
//       {
//         type: EffectType.GAIN,
//         startPosition: 0,
//         length: 10,
//         gainDb: -3,
//       },
//       {
//         type: EffectType.GAIN,
//         startPosition: 20,
//         length: 5,
//         gainDb: 6,
//       },
//     ])
//   })

//   it('leaves other effect types untouched', () => {
//     const existing: Effect[] = [
//       {
//         type: EffectType.EQ,
//         startPosition: 10,
//         length: 20,
//         filters: [],
//       },
//     ]

//     const updated = replaceEffectRegion(existing, {
//       type: EffectType.GAIN,
//       startPosition: 15,
//       length: 5,
//       gainDb: 6,
//     })

//     expect(updated).toEqual([
//       {
//         type: EffectType.EQ,
//         startPosition: 10,
//         length: 20,
//         filters: [],
//       },
//       {
//         type: EffectType.GAIN,
//         startPosition: 15,
//         length: 5,
//         gainDb: 6,
//       },
//     ])
//   })

//   it('converts gain dB to linear gain', () => {
//     expect(gainDbToLinear(0)).toBeCloseTo(1)
//     expect(gainDbToLinear(6)).toBeCloseTo(1.995262)
//     expect(gainDbToLinear(-6)).toBeCloseTo(0.501187)
//   })
// })
