import { describe, it, expect } from 'vitest';
import {
  arcPath, channelOffset, circleThrough, fibPrices, fibTimeSlots, gannAngles, gannGrid, linePriceAt, pointOnCircle,
  projectAlong, quadraticPath, rangeStats, regressionChannel, rotatedRectangle, spiralPath,
} from '../src/drawingGeometry';

describe('fibonacci helpers', () => {
  it('maps ratios onto the price range', () => {
    expect(fibPrices(100, 200, [0, .5, 1])).toEqual([100, 150, 200]);
    expect(fibPrices(200, 100, [.618])[0]).toBeCloseTo(138.2, 6);
    expect(fibPrices(100, 200, [])).toEqual([]);
  });
  it('projects time slots from the anchor and unit', () => {
    expect(fibTimeSlots(1000, 100, [1, 2, 3])).toEqual([1100, 1200, 1300]);
    expect(fibTimeSlots(1000, 0, [1, 2])).toEqual([1000, 1000]);
  });
});

describe('channel and regression helpers', () => {
  it('reads the price of a line at an arbitrary time', () => {
    expect(linePriceAt({ time: 0, price: 100 }, { time: 100, price: 200 }, 50)).toBe(150);
    expect(linePriceAt({ time: 0, price: 100 }, { time: 0, price: 200 }, 50)).toBe(100);
  });
  it('measures the parallel offset through a third point', () => {
    const a = { time: 0, price: 100 }, b = { time: 100, price: 200 }, c = { time: 50, price: 200 };
    expect(channelOffset(a, b, c)).toBe(50);
    expect(channelOffset(a, b, { time: 50, price: 150 })).toBe(0);
  });
  it('fits a regression line and channel rails', () => {
    const line = [
      { time: 0, price: 100 }, { time: 10, price: 110 }, { time: 20, price: 120 }, { time: 30, price: 130 },
    ];
    const channel = regressionChannel(line, 2);
    expect(channel.ends[0].price).toBeCloseTo(100, 6);
    expect(channel.ends[1].price).toBeCloseTo(130, 6);
    expect(channel.upper).toBeCloseTo(0, 6);
    const noisy = regressionChannel([...line, { time: 40, price: 200 }], 1);
    expect(noisy.upper).toBeGreaterThan(0);
  });
});

describe('gann helpers', () => {
  it('scales the 1×1 slope into the nine classical angles', () => {
    const angles = gannAngles({ time: 0, price: 100 }, { time: 100, price: 200 });
    expect(angles.map(entry => entry.label)).toEqual(['1×8', '1×4', '1×3', '1×2', '1×1', '2×1', '3×1', '4×1', '8×1']);
    const oneByOne = angles.find(entry => entry.label === '1×1');
    expect(oneByOne?.slope).toBeCloseTo(1, 6);
    expect(angles[0].slope).toBeCloseTo(8, 6);
    expect(angles[angles.length - 1].slope).toBeCloseTo(1 / 8, 6);
    expect(gannAngles({ time: 0, price: 100 }, { time: 0, price: 200 }).every(entry => entry.slope === 0)).toBe(true);
  });
  it('subdivides a gann box into interior lines', () => {
    const grid = gannGrid({ time: 0, price: 100 }, { time: 100, price: 200 }, 4);
    expect(grid.prices).toEqual([125, 150, 175]);
    expect(grid.times).toEqual([25, 50, 75]);
    expect(gannGrid({ time: 0, price: 0 }, { time: 1, price: 1 }, 1)).toEqual({ prices: [], times: [] });
  });
});

describe('shape helpers', () => {
  it('finds the circle through three points and rejects collinear input', () => {
    const circle = circleThrough({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 });
    expect(circle?.center.x).toBeCloseTo(5, 6);
    expect(circle?.center.y).toBeCloseTo(0, 6);
    expect(circle?.radius).toBeCloseTo(5, 6);
    expect(circleThrough({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 })).toBeNull();
  });
  it('walks a circle by degrees', () => {
    const right = pointOnCircle({ x: 0, y: 0 }, 10, 0);
    expect(right.x).toBeCloseTo(10, 6);
    expect(right.y).toBeCloseTo(0, 6);
    const bottom = pointOnCircle({ x: 0, y: 0 }, 10, 90);
    expect(bottom.y).toBeCloseTo(10, 6);
  });
  it('builds arc, quadratic and spiral paths', () => {
    expect(arcPath({ x: 0, y: 0 }, 10, { x: 10, y: 0 }, { x: 0, y: 10 })).toMatch(/^M10 0A10 10 0 0 1 0 10$/);
    expect(arcPath({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe('');
    expect(quadraticPath({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })).toBe('M0 0Q5 10 10 0');
    const spiral = spiralPath({ x: 0, y: 0 }, 20, 1, 8);
    expect(spiral.startsWith('M')).toBe(true);
    expect(spiral.split('L')).toHaveLength(9);
    expect(spiralPath({ x: 0, y: 0 }, 0)).toBe('');
  });
  it('builds rotated rectangles and projections', () => {
    const corners = rotatedRectangle({ time: 0, price: 100 }, { time: 10, price: 100 }, { time: 5, price: 120 });
    expect(corners).toHaveLength(4);
    expect(corners[2].price).toBeCloseTo(120, 6);
    expect(corners[3].time).toBe(0);
    const projected = projectAlong({ time: 0, price: 100 }, { time: 10, price: 120 }, 1);
    expect(projected).toEqual({ time: 20, price: 140 });
  });
  it('reports range statistics for the measuring tools', () => {
    const stats = rangeStats({ time: 0, price: 100 }, { time: 900, price: 110 }, 15);
    expect(stats.change).toBeCloseTo(10, 6);
    expect(stats.percent).toBeCloseTo(10, 6);
    expect(stats.bars).toBe(1);
  });
});
