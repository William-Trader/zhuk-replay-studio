#!/usr/bin/env python3
"""逐K复盘室 · Python 指标运行器。

协议（与 Mac 壳之间）：
  标准输入 stdin (JSON):
    {
      "code": "def compute(candles, params): ...",   # 指标源码（必填）
      "file": "my_indicator.py",                      # 展示用的文件名
      "candles": {"t": [..], "o": [..], "h": [..], "l": [..], "c": [..], "v": [..]},
      "params": {...}
    }
  标准输出 stdout (JSON):
    {"ok": true, "result": {"pane": "main"|"sub", "plots": [...], "levels": [...]}}
    或 {"ok": false, "error": "...", "traceback": "..."}

指标文件约定：
  def compute(candles, params) -> dict
  - candles: dict，键 t/o/h/l/c/v，值为与K线等长的数字列表（时间单位为秒）
  - 返回: {"pane": "main" 或 "sub",
           "plots": [{"title": str, "type": "line"|"histogram"|"area"|"dots",
                      "data": [float|None, ...], "color": "#rrggbb"(可选)}],
           "levels": [{"value": float, "title"(可选), "color"(可选)}]}
"""
import io
import json
import math
import sys
import traceback
import contextlib


def clean(value):
    """Recursively replace non-finite floats with None so the result is valid JSON."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    return value


def main():
    payload = json.load(sys.stdin)
    code = payload.get("code") or ""
    candles = payload.get("candles") or {}
    params = payload.get("params") or {}
    namespace = {"__name__": "__zhuk_indicator__"}

    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        exec(compile(code, payload.get("file") or "indicator.py", "exec"), namespace)
        compute = namespace.get("compute")
        if not callable(compute):
            raise ValueError("指标文件必须定义 compute(candles, params) 函数")
        result = compute(candles, params)

    if not isinstance(result, dict) or "plots" not in result:
        raise ValueError("compute 必须返回包含 'plots' 的字典")

    output = {"ok": True, "result": clean(result)}
    debug = captured.getvalue().strip()
    if debug:
        output["debug"] = debug[-2000:]
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - the shell needs the message verbatim
        print(json.dumps({
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc()[-4000:],
        }, ensure_ascii=False))
