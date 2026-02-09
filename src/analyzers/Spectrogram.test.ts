// function partitionIntoN(arrayLength: number, n: number) {
//     let total = Math.log2(arrayLength) + 1 // top level: log2 buckets
//     let layer = 0
//     for (; layer < Math.log2(arrayLength) - 1; ++layer) {
//         const newItems = (2 ** layer) * (Math.log2(arrayLength) - 1 - layer)
//         console.log('layer ' + layer + ' total ' + total + ' newItems' + newItems)
//         if (total + newItems > n) {
//             return
//         }
//         total += newItems
//     }
// }

function partitionByPowersOf2(array: Float32Array, maxNumber: number) {}

test('bucketTest1', async () => {
  // for (let i = 0; i < 14; ++i) {
  //     console.log('starting i = ' + i)
  //     partitionIntoN(2 ** i, 99999999)
  // }
})
