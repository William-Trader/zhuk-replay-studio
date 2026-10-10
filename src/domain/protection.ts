/*!
 * src/domain/protection.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-4E8A112F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 仓位保护（止损/止盈/跟踪）的规则（纯函数，可单测）。
 *
 *  两条历史 bug 的教训：
 *   1. 方向反了的止损/止盈过去只提示、仍然写入委托日志 → 引擎下一根立即触发，
 *      表现为"刚开仓就被止损"。方向不对的价位必须**拒绝**而不是放行。
 *   2. 保护在过去是"当前K线立即生效"，而提示写着"下一根K线起生效" —— 当前K线已经走过的
 *      路径（含开仓价之前的价格）也能打到止损，属于前视误差。保护必须从**下一根K线**起生效。
 */
export interface ProtectionInput {
  side: 'long' | 'short';
  /** 参考价：开仓成交价（或已有持仓的标记价）。 */
  reference: number;
  sl?: number;
  tp?: number;
  /** 跟踪止损百分比（0~100）。 */
  trailPercent?: number;
}

export interface ProtectionPlan {
  sl?: number;
  tp?: number;
  trailBps?: number;
  /** 被拒绝的条目与原因（用于如实告知用户，绝不静默放行）。 */
  rejected: string[];
}

const positive = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && (value as number) > 0 ? (value as number) : undefined;

/** 校验并产出保护方案：方向不对的价位被剔除并说明原因。 */
export function planProtection(input: ProtectionInput): ProtectionPlan {
  const rejected: string[] = [];
  const sl = positive(input.sl);
  const tp = positive(input.tp);
  const trailPercent = Number.isFinite(input.trailPercent) && (input.trailPercent as number) > 0 ? (input.trailPercent as number) : undefined;

  const stopOk = sl === undefined
    ? undefined
    : input.side === 'long' ? sl < input.reference : sl > input.reference;
  const targetOk = tp === undefined
    ? undefined
    : input.side === 'long' ? tp > input.reference : tp < input.reference;

  if (sl !== undefined && !stopOk) rejected.push(input.side === 'long' ? '止损价应低于参考价（多单），已忽略' : '止损价应高于参考价（空单），已忽略');
  if (tp !== undefined && !targetOk) rejected.push(input.side === 'long' ? '止盈价应高于参考价（多单），已忽略' : '止盈价应低于参考价（空单），已忽略');

  return {
    sl: stopOk ? sl : undefined,
    tp: targetOk ? tp : undefined,
    trailBps: trailPercent !== undefined ? trailPercent * 100 : undefined,
    rejected,
  };
}

/** 保护从哪一根K线起生效：必须是当前K线的**下一根**。
 *  当前K线用自身的开盘价/最高最低价判定止损会引入前视（那些价格发生在用户下单之前）。 */
export function protectionStartTime(currentBarTime: number, nextBarTime: number | undefined, barSeconds: number): number {
  if (nextBarTime !== undefined && nextBarTime > currentBarTime) return nextBarTime;
  return currentBarTime + Math.max(1, barSeconds);
}
