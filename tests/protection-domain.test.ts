import { describe, expect, it } from 'vitest';
import { planProtection, protectionStartTime } from '../src/domain/protection';

describe('protection plan', () => {
  it('keeps a normal long stop below and target above the reference', () => {
    const plan = planProtection({ side: 'long', reference: 100, sl: 95, tp: 110, trailPercent: 1 });
    expect(plan.sl).toBe(95);
    expect(plan.tp).toBe(110);
    expect(plan.trailBps).toBe(100);
    expect(plan.rejected).toEqual([]);
  });
  it('keeps a normal short stop above and target below the reference', () => {
    const plan = planProtection({ side: 'short', reference: 100, sl: 105, tp: 90 });
    expect(plan.sl).toBe(105);
    expect(plan.tp).toBe(90);
    expect(plan.rejected).toEqual([]);
  });
  it('rejects an inverted stop instead of silently arming it (instant stop-out bug)', () => {
    // 回归：方向反了的止损过去只提示、仍然写入日志 → 引擎下一根立刻触发，表现为"刚开仓就被止损"
    const plan = planProtection({ side: 'long', reference: 100, sl: 120 });
    expect(plan.sl).toBeUndefined();
    expect(plan.rejected.join()).toContain('止损价应低于参考价');
    const short = planProtection({ side: 'short', reference: 100, sl: 80 });
    expect(short.sl).toBeUndefined();
    expect(short.rejected.join()).toContain('止损价应高于参考价');
  });
  it('rejects an inverted target the same way', () => {
    expect(planProtection({ side: 'long', reference: 100, tp: 90 }).tp).toBeUndefined();
    expect(planProtection({ side: 'long', reference: 100, tp: 90 }).rejected.join()).toContain('止盈价应高于参考价');
    expect(planProtection({ side: 'short', reference: 100, tp: 120 }).rejected.join()).toContain('止盈价应低于参考价');
  });
  it('ignores non-positive or non-finite levels without complaining', () => {
    const plan = planProtection({ side: 'long', reference: 100, sl: 0, tp: Number.NaN, trailPercent: 0 });
    expect(plan).toEqual({ sl: undefined, tp: undefined, trailBps: undefined, rejected: [] });
  });
  it('keeps the valid half when only one side is wrong', () => {
    const plan = planProtection({ side: 'long', reference: 100, sl: 130, tp: 110 });
    expect(plan.tp).toBe(110);
    expect(plan.sl).toBeUndefined();
    expect(plan.rejected).toHaveLength(1);
  });
});

describe('protection start time', () => {
  it('arms from the next bar so the current bar cannot look ahead', () => {
    // 回归：保护过去从当前K线生效，会用该K线已经走过的路径（含开仓前价格）打到止损
    expect(protectionStartTime(1000, 1060, 60)).toBe(1060);
  });
  it('falls back to the bar step when there is no next bar yet', () => {
    expect(protectionStartTime(1000, undefined, 300)).toBe(1300);
    expect(protectionStartTime(1000, 1000, 300)).toBe(1300);
    expect(protectionStartTime(1000, 900, 0)).toBe(1001);
  });
});
