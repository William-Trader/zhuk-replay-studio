#!/usr/bin/env python3
"""把「所有能读到的标的」的历史K线预抓取到交易训练室的本地缓存。

为什么独立成脚本：复盘工具应当离线可用（cache-first）。这个脚本一次性把
加密现货 / 加密合约 / 美股 / 港股 / 韩A股 / 指数 / 大宗 / 外汇 的历史K线
落盘，之后应用启动就直接读本地，不再依赖网络。

缓存格式与 macOS 壳 (HistoryStore) 完全一致：
  文件名  <symbol>_<market>_<interval>.json     market ∈ spot | futures | fx
  内容    {"symbol","interval","market","savedAt","candles":[[t,o,h,l,c,v],...]}

用法：
  python3 scripts/prefetch_history.py                      # 默认 15m + 1d，全部标的
  python3 scripts/prefetch_history.py --intervals 15m 1h 1d
  python3 scripts/prefetch_history.py --classes equity,commodity
  python3 scripts/prefetch_history.py --limit-symbols 20 --force
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROXY = os.environ.get("ZK_PROXY", "http://127.0.0.1:17890")
CACHE_DIR = os.environ.get("ZK_CACHE_DIR") or os.path.expanduser("~/Library/Application Support/ZhukReplay/history")
SPOT = "https://api.binance.com/api/v3"
FAPI = "https://fapi.binance.com/fapi/v1"
FX = "https://api.frankfurter.app"

# 与 src/universe.ts 保持一致
FX_PAIRS = ["EURUSD", "USDJPY", "GBPUSD", "USDCNY", "AUDUSD", "USDCHF", "EURJPY", "EURGBP", "USDCAD", "USDHKD"]
COMMODITY_SPOT_FALLBACK = ["PAXGUSDT", "XAUTUSDT"]          # fapi 拿不到时用现货代币化商品兜底
KIND_CLASS = {
    "COIN": "crypto-perp", "EQUITY": "equity", "PREMARKET": "equity",
    "HK_EQUITY": "hk-equity", "KR_EQUITY": "other-equity", "CN_EQUITY": "other-equity",
    "INDEX": "index", "COMMODITY": "commodity",
}


def ssl_context() -> ssl.SSLContext:
    """用系统根证书（python.org 版自带的 certifi 不认本机钥匙串里的根，会报自签名链错误）。"""
    for candidate in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl/cert.pem"):
        if os.path.exists(candidate):
            return ssl.create_default_context(cafile=candidate)
    return ssl.create_default_context()


def log(message: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def http_json(url: str, tries: int = 4, timeout: int = 25):
    """通过隧道代理取 JSON；429/5xx 退避重试。"""
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPSHandler(context=ssl_context()),
    )
    delay = 1.0
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "zk-prefetch/1.0"})
            with opener.open(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (418, 429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except Exception:
            if attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    return None


def to_rows(raw) -> list[list[float]]:
    """Binance klines → [time, open, high, low, close, volume]，剔除坏行。"""
    rows: list[list[float]] = []
    for entry in raw or []:
        try:
            row = [float(entry[0]) / 1000, float(entry[1]), float(entry[2]), float(entry[3]), float(entry[4]), float(entry[5])]
        except (TypeError, ValueError, IndexError):
            continue
        if row[4] <= 0 or row[2] < row[3]:
            continue
        rows.append([int(row[0]), row[1], row[2], row[3], row[4], row[5]])
    rows.sort(key=lambda item: item[0])
    return rows


def fx_rows(base: str, quote: str) -> list[list[float]]:
    """外汇：Frankfurter 日线收盘 → 合成 OHLC（与 src/universe.ts 的 synthesiseOhlc 同口径）。"""
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = http_json(f"{FX}/2015-01-01..{end}?from={base}&to={quote}")
    rates = payload.get("rates", {}) if isinstance(payload, dict) else {}
    series = sorted((day, value.get(quote)) for day, value in rates.items() if isinstance(value, dict) and value.get(quote))
    rows: list[list[float]] = []
    previous = None
    for day, rate in series:
        try:
            stamp = int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) - 8 * 3600
        except ValueError:
            continue
        open_rate = previous if previous is not None else rate
        rows.append([stamp, open_rate, max(open_rate, rate), min(open_rate, rate), rate, 0.0])
        previous = rate
    return rows


def write_cache(symbol: str, interval: str, market: str, rows: list[list[float]]) -> int:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{symbol}_{market}_{interval}.json")
    payload = {"symbol": symbol, "interval": interval, "market": market,
               "savedAt": time.time(), "candles": rows}
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    os.replace(temporary, path)
    return os.path.getsize(path)


def fresh_enough(path: str, interval_seconds: int) -> bool:
    """已有缓存且最新一根距今不超过 2 个周期 → 视为新鲜，跳过。"""
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        candles = payload.get("candles") or []
        if len(candles) < 2:
            return False
        return (time.time() - candles[-1][0]) < interval_seconds * 2
    except Exception:
        return False


INTERVAL_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}


def collect_instruments(classes: set[str], limit_symbols: int | None) -> list[dict]:
    """汇总所有可读标的：现货 / 合约（按 underlyingType 分类）/ 外汇。"""
    out: list[dict] = []
    log("读取 Binance 现货品种表…")
    spot = http_json(f"{SPOT}/exchangeInfo")
    spot_bases = set()
    for entry in (spot or {}).get("symbols", []):
        if entry.get("status") != "TRADING" or entry.get("quoteAsset") != "USDT":
            continue
        base = entry.get("baseAsset") or ""
        if not base or not base.isalnum() or any(token in base for token in ("UP", "DOWN", "BULL", "BEAR")):
            continue
        spot_bases.add(base)
        if "crypto-spot" in classes:
            out.append({"symbol": entry["symbol"], "base": base, "quote": "USDT", "market": "spot", "class": "crypto-spot"})
    log(f"  现货 {len(spot_bases)} 个基础币")

    log("读取 Binance 合约品种表…")
    futures = http_json(f"{FAPI}/exchangeInfo")
    perps = []
    for entry in (futures or {}).get("symbols", []):
        contract = str(entry.get("contractType") or "")
        if not contract.endswith("PERPETUAL") or entry.get("status") != "TRADING" or entry.get("quoteAsset") != "USDT":
            continue   # TradFi 合约（美股/港股/大宗）是 TRADIFI_PERPETUAL
        kind = entry.get("underlyingType") or "COIN"
        perps.append({"symbol": entry["symbol"], "base": entry.get("baseAsset", ""), "quote": "USDT",
                      "market": "futures", "class": KIND_CLASS.get(kind, "crypto-perp"), "kind": kind})
    log(f"  合约 {len(perps)} 个（COIN {sum(1 for p in perps if p['kind'] == 'COIN')}）")
    out += [item for item in perps if item["class"] == "crypto-perp" and "crypto-perp" in classes or item["class"] != "crypto-perp" and item["class"] in classes]

    if "commodity" in classes:
        # 代币化商品（现货）作为合约商品的补充，两者都能读
        for symbol in COMMODITY_SPOT_FALLBACK:
            out.append({"symbol": symbol, "base": symbol[:-4], "quote": "USDT", "market": "spot", "class": "commodity"})

    if "forex" in classes:
        for pair in FX_PAIRS:
            out.append({"symbol": pair, "base": pair[:3], "quote": pair[3:], "market": "fx", "class": "forex"})

    # 去重（同 symbol+market）
    seen = set()
    unique = []
    for item in out:
        key = (item["symbol"], item["market"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    if limit_symbols is not None:
        unique = unique[:limit_symbols]
    return unique


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--intervals", nargs="+", default=["15m", "1d"])
    parser.add_argument("--classes", default="crypto-spot,crypto-perp,equity,hk-equity,other-equity,index,commodity,forex")
    parser.add_argument("--limit-symbols", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="已有缓存也重抓")
    parser.add_argument("--sleep", type=float, default=0.08)
    parser.add_argument("--depth", type=int, default=3, help="盘中周期翻页数（每页 1000 根），日线固定 1 页")
    parser.add_argument("--state", default="/tmp/zk-prefetch/state.json")
    parser.add_argument("--shard", default=None, help="I/N：只处理第 I 个分片（0 起），用于多进程并行")
    parser.add_argument("--cache-dir", default=None, help="缓存目录（默认 macOS 应用目录；服务器上跑时指定）")
    args = parser.parse_args()
    global CACHE_DIR
    if args.cache_dir:
        CACHE_DIR = os.path.expanduser(args.cache_dir)

    classes = {name.strip() for name in args.classes.split(",") if name.strip()}
    os.makedirs(os.path.dirname(args.state), exist_ok=True)
    instruments = collect_instruments(classes, args.limit_symbols)
    if args.shard:
        part, total = (int(piece) for piece in args.shard.split("/"))
        instruments = [item for position, item in enumerate(instruments) if position % total == part]
        log(f"分片 {part}/{total} → 本片 {len(instruments)} 个标的")
    log(f"标的合计 {len(instruments)} 个 × 周期 {args.intervals} → 最多 {len(instruments) * len(args.intervals)} 个数据集")

    done = skipped = failed = 0
    consecutive = 0
    started = time.time()
    failures: list[dict] = []
    for index, item in enumerate(instruments, 1):
        for interval in args.intervals:
            path = os.path.join(CACHE_DIR, f"{item['symbol']}_{item['market']}_{interval}.json")
            if not args.force and fresh_enough(path, INTERVAL_SECONDS.get(interval, 900)):
                skipped += 1
                continue
            try:
                if item["market"] == "fx":
                    if interval != "1d":
                        continue
                    rows = fx_rows(item["base"], item["quote"])
                else:
                    host = FAPI if item["market"] == "futures" else SPOT
                    pages = 1 if interval == "1d" else max(1, args.depth)
                    collected: dict[int, list[float]] = {}
                    end_time = None
                    for _ in range(pages):
                        url = f"{host}/klines?symbol={urllib.parse.quote(item['symbol'])}&interval={interval}&limit=1000"
                        if end_time is not None:
                            url += f"&endTime={end_time}"
                        page = to_rows(http_json(url))
                        if not page:
                            break
                        for row in page:
                            collected[row[0]] = row
                        if len(page) < 1000:
                            break
                        end_time = int(page[0][0] * 1000) - 1
                    rows = [collected[key] for key in sorted(collected)]
                if len(rows) < 2:
                    raise RuntimeError("无可用量K线")
                size = write_cache(item["symbol"], interval, item["market"], rows)
                done += 1
                consecutive = 0
                if done % 25 == 0:
                    log(f"进度 {index}/{len(instruments)} · 写入 {done} · 跳过 {skipped} · 失败 {failed} · 最新 {item['symbol']} {interval} {len(rows)} 根 {size // 1024}KB")
            except Exception as error:  # 单个标的失败不影响整体
                failed += 1
                consecutive += 1
                failures.append({"symbol": item["symbol"], "interval": interval, "market": item["market"], "error": str(error)[:120]})
                # 代理/网络整体抖动时不要空转把全部标的记成失败：连续失败就歇一会儿。
                if consecutive >= 8:
                    log(f"连续 {consecutive} 次失败，歇 30 秒后继续（多为代理抖动）…")
                    time.sleep(30)
                    consecutive = 0
            time.sleep(args.sleep)
        if index % 100 == 0:
            log(f"…已处理 {index}/{len(instruments)} 个标的 · 写入 {done} · 失败 {failed}")

    summary = {
        "instruments": len(instruments), "intervals": args.intervals,
        "written": done, "skipped": skipped, "failed": failed,
        "cacheDir": CACHE_DIR, "seconds": round(time.time() - started, 1),
        "failures": failures[:40],
        "bytes": sum(os.path.getsize(os.path.join(CACHE_DIR, name)) for name in os.listdir(CACHE_DIR)) if os.path.isdir(CACHE_DIR) else 0,
        "finishedAt": time.time(),
    }
    with open(args.state, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    log(f"完成：写入 {done} · 跳过 {skipped} · 失败 {failed} · 用时 {summary['seconds']}s · 缓存总计 {summary['bytes'] / 1048576:.1f}MB")
    log(f"状态文件 {args.state}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
