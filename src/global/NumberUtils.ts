/**
 * Throws an error if the argument is not a positive number.
 * @param {number} n The number
 */
export function checkIsPositive(n: number) {
  if (n <= 0) {
    throw Error('Argument is not positive: ' + n)
  }
}

/**
 * Throws an error if the argument is a negative number.
 * @param {number} n The number
 */
export function checkIsNonNegative(n: number) {
  if (n < 0) {
    throw Error('Argument is negative: ' + n)
  }
}
