"""示例指标：RSI 相对强弱（副图）。

参数：period=14
"""


def rsi(values, period):
    out = [None] * len(values)
    if len(values) <= period:
        return out
    gains = 0.0
    losses = 0.0
    for index in range(1, period + 1):
        diff = values[index] - values[index - 1]
        gains += max(diff, 0.0)
        losses += max(-diff, 0.0)
    avg_gain = gains / period
    avg_loss = losses / period
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    for index in range(period + 1, len(values)):
        diff = values[index] - values[index - 1]
        avg_gain = (avg_gain * (period - 1) + max(diff, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-diff, 0.0)) / period
        out[index] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    return out


def compute(candles, params):
    period = int(params.get("period", 14))
    values = rsi(candles.get("c", []), period)
    return {
        "pane": "sub",
        "plots": [{"title": f"RSI({period})", "type": "line", "data": values, "color": "#9c27b0"}],
        "levels": [{"value": 70, "color": "#ff1744"}, {"value": 30, "color": "#00ad94"}],
    }
