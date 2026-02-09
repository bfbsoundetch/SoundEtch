declare module 'cardinal-spline-js' {
  /*!	Curve function for canvas 2.3.8
   *	(c) Epistemex 2013-2018
   *	www.epistemex.com
   *	License: MIT
   */
  /**
   * Draws a cardinal spline through given point array. Points must be arranged
   * as: [x1, y1, x2, y2, ..., xn, yn]. It adds the points to the current path.
   *
   * There must be a minimum of two points in the input array but the function
   * is only useful where there are three points or more.
   *
   * The method continues previous path of the context. If you don't want that
   * then you need to use moveTo() with the first point from the input array.
   *
   * The points for the cardinal spline are returned as a new array.
   *
   * @param {CanvasRenderingContext2D} ctx - context to use
   * @param {Array} points - point array
   * @param {Number} [tension=0.5] - tension. Typically between [0.0, 1.0] but can be exceeded
   * @param {Number} [numOfSeg=25] - number of segments between two points (line resolution)
   * @param {Boolean} [close=false] - Close the ends making the line continuous
   * @returns {Float32Array} New array with the calculated points that was added to the path
   */
  export function curve(
    ctx: CanvasRenderingContext2D,
    points: any[],
    tension?: number,
    numOfSeg?: number,
    close?: boolean,
  ): Float32Array

  /*!	Curve calc function for canvas 2.3.8
   *	(c) Epistemex 2013-2018
   *	www.epistemex.com
   *	License: MIT
   */
  /**
   * Calculates an array containing points representing a cardinal spline through given point array.
   * Points must be arranged as: [x1, y1, x2, y2, ..., xn, yn].
   *
   * There must be a minimum of two points in the input array but the function
   * is only useful where there are three points or more.
   *
   * The points for the cardinal spline are returned as a new array.
   *
   * @param {Array} points - point array
   * @param {Number} [tension=0.5] - tension. Typically between [0.0, 1.0] but can be exceeded
   * @param {Number} [numOfSeg=25] - number of segments between two points (line resolution)
   * @param {Boolean} [close=false] - Close the ends making the line continuous
   * @returns {Float32Array} New array with the calculated points that was added to the path
   */
  export function getCurvePoints(points: any[], tension?: number, numOfSeg?: number, close?: boolean): Float32Array
}
