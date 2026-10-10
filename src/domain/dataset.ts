/*!
 * src/domain/dataset.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-5746EACB
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 数据集 / 回放窗口的生命周期规则（纯函数，可单测）。
 *
 *  这些规则原先散落在 App.tsx 的事件回调里，是本项目历史上最容易出 bug 的地方：
 *   1. 数据集切换判定 —— 占位数据（内置样本）被真实数据替换，不能被当成"用户切换"，
 *      否则会 clearTrades() 清掉用户刚下的单（现象："开空自己会平仓"）。
 *   2. 游标落地 —— 数据落地时不能把游标推到用户没看过的K线上，否则持仓会被"瞬间模拟"掉。
 *   3. 回放区间有效性 —— 区间按时间记忆，换品种/周期后可能只剩末尾几根（现象："一点复盘就是结果"）。
 *
 *  抽成纯函数的目的：让这些规则可被测试固定下来，不再依赖"某次改动记得同步三处"。
 */
import type { Candle } from '../market';

/** 用户/系统"想打开"的数据集标识（品种|周期|市场）。 */
export interface DatasetIntent {
  symbol: string;
  interval: string;
  kind: string;
}

export const intentOf = (symbol: string, interval: string, kind: string): DatasetIntent => ({ symbol, interval, kind });

/** 稳定字符串键：用于比较"意图"是否真的变了。 */
export const intentKey = (intent: DatasetIntent): string => `${intent.symbol}|${intent.interval}|${intent.kind}`;

/** 是否属于"用户主动换了数据集"（只有这种才允许清空模拟记录）。
 *  - 首次落地（previous 为空）不是切换：那时并没有用户记录需要清
 *  - 同一意图的重复落地（占位样本 → 真实数据、后台补齐、重复 apply）不是切换 */
export function isUserSwitch(previousKey: string, nextKey: string): boolean {
  return previousKey !== '' && previousKey !== nextKey;
}

/** 加载请求令牌：每次"打开数据集"自增一个，异步落地前用它判断自己是否已被更新的请求取代。
 *  没有这道闸门时，先发出的请求后落地会覆盖新请求 —— 表现为"品种是 A、数据却是 B"（实测）。 */
export function isStaleRequest(currentToken: number, requestToken: number): boolean {
  return currentToken !== requestToken;
}

export interface CursorInput {
  /** 落地后的数据集根数。 */
  barCount: number;
  /** 当前游标。 */
  current: number;
  /** 存档恢复的游标（可选）。 */
  restore?: number;
  /** 是否处于复盘会话：会话期间游标不得被数据落地挪动（只做夹取）。 */
  session: boolean;
  /** 最小可用游标（包含前端预留的K线数）。 */
  min: number;
}

/** 数据落地后的游标：
 *  - 复盘会话中：只在 [min, barCount] 内夹取当前值，绝不跳到别处
 *  - 非会话：优先用存档游标（夹取），否则落到最新一根（live 图的默认行为） */
export function cursorAfterApply(input: CursorInput): number {
  const { barCount, current, restore, session, min } = input;
  const clamp = (value: number) => Math.max(min, Math.min(value, Math.max(min, barCount)));
  if (session) return clamp(current);
  if (restore !== undefined) return clamp(restore);
  return Math.max(min, barCount);
}

export interface RangeFitInput {
  bars: readonly Candle[];
  from: number | null;
  to: number | null;
  /** 时间 → 游标（由调用方提供，便于在离线/内置样本上复用）。 */
  cursorAt: (time: number) => number;
}

export interface RangeFit {
  /** 区间是否仍然有意义（false 表示应当退回全区间）。 */
  fits: boolean;
  fromCursor: number;
  toCursor: number;
  /** 区间在新数据上覆盖的根数。 */
  span: number;
  /** 判定阈值：低于它视为"已失效"。 */
  floor: number;
}

/** 区间在新数据集上是否还有意义。
 *  阈值取 max(20 根, 数据集的 5%, 上限 200 根)：既照顾小数据集，也避免长区间被误判。 */
export function rangeFits(input: RangeFitInput): RangeFit {
  const { bars, from, to, cursorAt } = input;
  if (!bars.length || from === null || to === null) {
    return { fits: true, fromCursor: 0, toCursor: bars.length, span: bars.length, floor: 0 };
  }
  const fromCursor = cursorAt(from);
  const toCursor = cursorAt(to);
  const span = toCursor - fromCursor;
  const floor = Math.max(20, Math.min(200, Math.floor(bars.length * 0.05)));
  return { fits: span >= floor, fromCursor, toCursor, span, floor };
}
