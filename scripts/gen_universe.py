#!/usr/bin/env python3
"""生成应用内置的完整品种清单快照（现货 + 全类别合约 + 外汇）。

复盘工具要求"打开就能看到所有品种"，不能等网络。这个脚本把 Binance 的
现货/合约品种表拉下来生成两个 TS 模块（src/uniSpot.ts / src/uniFutures.ts），
应用离线也能列出全部标的；联网时再由后台静默刷新成实时表。

用法：python3 scripts/gen_universe.py [--proxy http://127.0.0.1:17890]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import ssl
import urllib.request

SPOT = "https://api.binance.com/api/v3/exchangeInfo"
FAPI = "https://fapi.binance.com/fapi/v1/exchangeInfo"
FX_PAIRS = ["EURUSD", "USDJPY", "GBPUSD", "USDCNY", "AUDUSD", "USDCHF", "EURJPY", "EURGBP", "USDCAD", "USDHKD"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fetch(url: str, proxy: str | None):
    handlers = [urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile="/etc/ssl/cert.pem"))]
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    with opener.open(urllib.request.Request(url, headers={"User-Agent": "zk-universe/1.0"}), timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def spot_rows(payload) -> list[dict]:
    rows = []
    for entry in (payload or {}).get("symbols", []):
        if entry.get("status") != "TRADING" or entry.get("quoteAsset") != "USDT":
            continue
        base = entry.get("baseAsset") or ""
        if not base or not base.isalnum():
            continue
        if any(token in base for token in ("UP", "DOWN", "BULL", "BEAR")):
            continue
        rows.append({"symbol": entry["symbol"], "base": base})
    rows.sort(key=lambda item: item["symbol"])
    return rows


def futures_rows(payload) -> list[dict]:
    rows = []
    for entry in (payload or {}).get("symbols", []):
        contract = str(entry.get("contractType") or "")
        if not contract.endswith("PERPETUAL") or entry.get("status") != "TRADING" or entry.get("quoteAsset") != "USDT":
            continue
        rows.append({"symbol": entry["symbol"], "base": entry.get("baseAsset", ""), "kind": entry.get("underlyingType") or "COIN"})
    rows.sort(key=lambda item: item["symbol"])
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy", default=os.environ.get("ZK_PROXY", "http://127.0.0.1:17890"))
    args = parser.parse_args()

    spot = spot_rows(fetch(SPOT, args.proxy))
    futures = futures_rows(fetch(FAPI, args.proxy))
    print("现货 USDT 交易对:", len(spot))
    print("USDT 永续:", len(futures), dict(collections.Counter(row["kind"] for row in futures)))

    spot_lines = ["/** Binance 现货 USDT 品种快照（scripts/gen_universe.py 生成）。",
                  " *  离线时用于立即列出全部品种；联网后会被实时表静默替换。 */",
                  "export interface SnapshotSymbol { symbol: string; base: string }",
                  "export const SPOT_SNAPSHOT: SnapshotSymbol[] = ["]
    spot_lines += [f"  {{ symbol: '{row['symbol']}', base: '{row['base']}' }}," for row in spot]
    spot_lines.append("];")
    with open(os.path.join(ROOT, "src/uniSpot.ts"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(spot_lines) + "\n")

    future_lines = ["/** Binance USDT 本位永续品种快照（scripts/gen_universe.py 生成）。",
                    " *  fapi 被墙/离线时用于填充分类清单与搜索；K线仍需联网（联网时会被实时表覆盖）。 */",
                    "export interface SnapshotSymbol { symbol: string; base: string; kind: string }",
                    "export const FUTURES_SNAPSHOT: SnapshotSymbol[] = ["]
    future_lines += [f"  {{ symbol: '{row['symbol']}', base: '{row['base']}', kind: '{row['kind']}' }}," for row in futures]
    future_lines.append("];")
    with open(os.path.join(ROOT, "src/uniFutures.ts"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(future_lines) + "\n")

    print("已写出 src/uniSpot.ts 与 src/uniFutures.ts")
    print("外汇清单（保持不变）:", " ".join(FX_PAIRS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
