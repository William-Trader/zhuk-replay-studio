"""示例指标：EMA 快慢线（主图叠加）。

参数：fast=12, slow=26
在应用内可修改参数后重新"运行测试"查看效果。
"""


def ema(values, period):
    out = []
    multiplier = 2.0 / (period + 1)
    previous = None
    for value in values:
        previous = value if previous is None else value * multiplier + previous * (1 - multiplier)
        out.append(previous)
    return out


def compute(candles, params):
    closes = candles.get("c", [])
    if not closes:
        return {"pane": "main", "plots": []}
    fast_n = int(params.get("fast", 12))
    slow_n = int(params.get("slow", 26))
    return {
        "pane": "main",
        "plots": [
            {"title": f"EMA{fast_n}", "type": "line", "data": ema(closes, fast_n), "color": "#2962ff"},
            {"title": f"EMA{slow_n}", "type": "line", "data": ema(closes, slow_n), "color": "#ff9800"},
        ],
    }
