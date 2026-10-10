# Python 指标目录

应用会从以下目录加载 `.py` 指标文件（首次启动自动放入示例文件）：

```
~/Library/Application Support/ZhukReplay/indicators/
```

## 编写约定

每个指标文件定义 `compute(candles, params)`：

```python
def compute(candles, params):
    # candles: {"t": [...], "o": [...], "h": [...], "l": [...], "c": [...], "v": [...]}
    #   —— 与当前回放已揭示的K线等长，时间为秒级时间戳
    # params:  {"period": 14, ...}  来自应用内的参数输入
    return {
        "pane": "main",              # "main"=叠加主图, "sub"=独立副图
        "plots": [
            {"title": "我的均线", "type": "line",      # line|histogram|area|dots
             "data": [...],                            # 与 candles 等长，预热期用 None
             "color": "#2962ff"},
        ],
        "levels": [{"value": 70, "color": "#ff1744"}], # 可选：水平参考线
    }
```

限制与提示：

- 仅标准库；不允许联网（运行在 15 秒超时内，超时会被终止）。
- 计算结果中的 NaN/Infinity 会被替换为 None；请保持数据长度与输入一致。
- `print()` 的输出会被捕获并附加在调试信息中，不影响结果解析。
