import { describe, expect, it } from 'vitest';
import { cursorAfterApply, intentKey, intentOf, isStaleRequest, isUserSwitch, rangeFits } from '../src/domain/dataset';
import type { Candle } from '../src/market';

const bar = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });
const bars = (count: number, step = 86400) => Array.from({ length: count }, (_, index) => bar(1000 + index * step));
/** 时间 → 游标：直接按时间顺序查（模拟回放里的 cursorForTimeIn）。 */
const cursorAt = (list: readonly Candle[]) => (time: number) => {
  let found = 0;
  for (let index = 0; index < list.length; index++) if (list[index].time <= time) found = index + 1;
  return found;
};

describe('dataset intent', () => {
  it('keys an intent stably', () => {
    expect(intentKey(intentOf('BTCUSDT', '15m', 'futures'))).toBe('BTCUSDT|15m|futures');
  });
  it('treats the first landing as no switch at all', () => {
    // 首次落地（占位样本 → 真实数据）不是切换：此时没有用户记录需要清空
    expect(isUserSwitch('', 'BTCUSDT|15m|spot')).toBe(false);
    expect(isUserSwitch('BTCUSDT|15m|spot', 'BTCUSDT|15m|spot')).toBe(false);
  });
  it('only reports a switch when the user really changed symbol, interval or market', () => {
    expect(isUserSwitch('BTCUSDT|15m|spot', 'ETHUSDT|15m|spot')).toBe(true);
    expect(isUserSwitch('BTCUSDT|15m|spot', 'BTCUSDT|1h|spot')).toBe(true);
    expect(isUserSwitch('BTCUSDT|15m|spot', 'BTCUSDT|15m|futures')).toBe(true);
  });
});

describe('load request tokens', () => {
  it('marks a result stale once a newer load started', () => {
    // 回归：两次加载竞态时，早发出的请求后落地曾覆盖新请求（symbol 与数据不一致）
    expect(isStaleRequest(3, 3)).toBe(false);
    expect(isStaleRequest(4, 3)).toBe(true);
    expect(isStaleRequest(3, 4)).toBe(true);
  });
});

describe('cursor after a dataset lands', () => {
  it('keeps a replay session cursor where it was, clamped into the new range', () => {
    // 会话进行中：游标绝不能因为数据落地而跳到别处，否则持仓会被"瞬间模拟"掉
    expect(cursorAfterApply({ barCount: 1000, current: 400, session: true, min: 60 })).toBe(400);
    expect(cursorAfterApply({ barCount: 300, current: 400, session: true, min: 60 })).toBe(300);
    expect(cursorAfterApply({ barCount: 1000, current: 10, session: true, min: 60 })).toBe(60);
  });
  it('restores a saved cursor outside a session', () => {
    expect(cursorAfterApply({ barCount: 2230, current: 5, restore: 800, session: false, min: 60 })).toBe(800);
    expect(cursorAfterApply({ barCount: 100, current: 5, restore: 800, session: false, min: 60 })).toBe(100);
  });
  it('defaults to the newest bar for a live chart', () => {
    expect(cursorAfterApply({ barCount: 1500, current: 12, session: false, min: 60 })).toBe(1500);
    // 数据集比最小游标还短时也不能给出非法游标
    expect(cursorAfterApply({ barCount: 3, current: 1, session: false, min: 60 })).toBe(60);
  });
});

describe('replay range validity across datasets', () => {
  it('accepts a range that still covers a meaningful slice', () => {
    const list = bars(1000);
    const fit = rangeFits({ bars: list, from: list[100].time, to: list[900].time, cursorAt: cursorAt(list) });
    expect(fit.fits).toBe(true);
    expect(fit.span).toBeGreaterThan(700);
  });
  it('drops a range that shrank to a sliver at the end (point-of-replay bug)', () => {
    const list = bars(2230);
    // 5 天区间遇到 1 天图：只剩约 5 根 → 必须判为失效
    const fit = rangeFits({ bars: list, from: list[2224].time, to: list[2229].time, cursorAt: cursorAt(list) });
    expect(fit.fits).toBe(false);
    expect(fit.span).toBeLessThan(20);
  });
  it('treats an unset range as always fitting', () => {
    const list = bars(500);
    expect(rangeFits({ bars: list, from: null, to: null, cursorAt: cursorAt(list) }).fits).toBe(true);
    expect(rangeFits({ bars: [], from: 1, to: 2, cursorAt: cursorAt([]) }).fits).toBe(true);
  });
  it('scales the threshold with the dataset size', () => {
    const small = bars(200);
    const big = bars(4000);
    const smallFit = rangeFits({ bars: small, from: small[10].time, to: small[40].time, cursorAt: cursorAt(small) });
    const bigFit = rangeFits({ bars: big, from: big[10].time, to: big[300].time, cursorAt: cursorAt(big) });
    expect(smallFit.floor).toBe(20);
    expect(bigFit.floor).toBe(200);
    expect(smallFit.fits).toBe(true);
    expect(bigFit.fits).toBe(true);
  });
});
