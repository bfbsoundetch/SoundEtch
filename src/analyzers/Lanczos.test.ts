import { lanczosInterpolate } from './PeakMeter'

function* inputGen(input: Array<number>) {
  for (const i of input) {
    yield i
  }
}

test('a', async () => {
  const result = lanczosInterpolate(inputGen([1, 2, 3, 4, 3, 2, 1]), 8)

  for await (const i of result) {
    console.log(':' + i)
  }
})
