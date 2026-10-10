import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_CHUNK, INTERVALS, MAX_KLINES, detectTransport, fetchFundingRates, fetchKlines, fetchPremiumIndex, fetchSymbols, fetchTickers, fundingByBoundary, resetFeedCache, type FeedOptions } from '../src/feed';

const STEP = 60_000;
const BASE = 1_700_000_000_000;
const SPOT = 'https://api.binance.com';

const response = (body: unknown, status = 200) => ({
  status, ok: status === 200,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
}) as unknown as Response;

/** One raw Binance kline row; numbers travel as strings on the wire. */
const row = (timeMs: number, open = 100, high = 110, low = 90, close = 105, volume = 12): unknown[] =>
  [String(timeMs), String(open), String(high), String(low), String(close), String(volume)];

/** A `size`-bar window ending at `endTime` (inclusive), the way Binance answers an endTime page. */
const page_ = (endTime: number, size: number) => Array.from({ length: size }, (_, i) => row(endTime - (size - 1 - i) * STEP));

const symbol = (symbol_: string, base: string, quote = 'USDT', status = 'TRADING') => ({ symbol: symbol_, baseAsset: base, quoteAsset: quote, status });

function recorder(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const urls: URL[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const raw = String(input);
    calls.push(raw);
    urls.push(new URL(raw, 'http://local.test'));
    return await handler(urls[urls.length - 1]);
  }) as unknown as typeof fetch;
  return { calls, urls, impl };
}

const direct = (impl: typeof fetch, over: FeedOptions = {}): FeedOptions => ({ fetchImpl: impl, transport: 'direct', ...over });

beforeEach(() => { resetFeedCache(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('intervals', () => {
  it('exposes six replay periods with their minute spans', () => {
    expect(INTERVALS).toHaveLength(6);
    expect(INTERVALS[0]).toEqual({ value: '1m', label: '1分', minutes: 1 });
    expect(INTERVALS[5]).toEqual({ value: '1d', label: '1天', minutes: 1440 });
    expect(INTERVALS.map(entry => entry.minutes)).toEqual([1, 5, 15, 60, 240, 1440]);
  });
});

describe('fetchKlines', () => {
  it('numericises string rows and returns ascending candles with seconds timestamps', async () => {
    const { calls, impl } = recorder(() => response([row(BASE, 100, 110, 90, 105, 12), row(BASE - STEP, 96, 101, 95, 99, 3)]));
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 10 }, direct(impl));
    expect(bars).toEqual([
      { time: (BASE - STEP) / 1000, open: 96, high: 101, low: 95, close: 99, volume: 3 },
      { time: BASE / 1000, open: 100, high: 110, low: 90, close: 105, volume: 12 },
    ]);
    expect(calls[0]).toBe(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=10`);
  });

  it('drops rows without a positive time or finite OHLC', async () => {
    const { impl } = recorder(() => response([
      row(BASE), ['0', '1', '2', '3', '4', '5'], ['1700000000000', 'abc', '1', '2', '3', '4'],
      ['1700000000000', '1', '2', 'Infinity', '3', '4'], 'nope', null, row(BASE - STEP),
    ]));
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 10 }, direct(impl));
    expect(bars.map(bar => bar.time)).toEqual([(BASE - STEP) / 1000, BASE / 1000]);
  });

  it('pages backwards with endTime and merges one ascending window', async () => {
    const { calls, impl } = recorder(url => {
      const size = Number(url.searchParams.get('limit'));
      const end = Number(url.searchParams.get('endTime') ?? BASE);
      return response(page_(end, size));
    });
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 1500 }, direct(impl));
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain('endTime');
    expect(calls[1]).toBe(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500&endTime=${BASE - 999 * STEP - 1}`);
    expect(bars).toHaveLength(1500);
    expect(bars[0].time).toBe((BASE - 999 * STEP - 1 - 499 * STEP) / 1000);
    expect(bars[1499].time).toBe(BASE / 1000);
    expect(bars.every((bar, i) => i === 0 || bar.time > bars[i - 1].time)).toBe(true);
  });

  it('stops paging as soon as a page comes back short', async () => {
    const { calls, impl } = recorder(url => {
      const size = Number(url.searchParams.get('limit'));
      const end = Number(url.searchParams.get('endTime') ?? BASE);
      return response(page_(end, calls.length === 1 ? size : 300));
    });
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 2000 }, direct(impl));
    expect(calls).toHaveLength(2);
    expect(bars).toHaveLength(1300);
  });

  it('keeps paging until the requested depth (old 12-page cap removed)', async () => {
    const { calls, impl } = recorder(url => {
      const size = Number(url.searchParams.get('limit'));
      const end = Number(url.searchParams.get('endTime') ?? BASE);
      return response(page_(end, size));
    });
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1h', limit: 20_000 }, direct(impl));
    expect(calls).toHaveLength(20);
    expect(bars).toHaveLength(20_000);
  });

  it('dedupes identical in-flight requests into a single network call', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { calls, impl } = recorder(async () => { await gate; return response(page_(BASE, 5)); });
    const query = { symbol: 'BTCUSDT', interval: '5m', limit: 5 };
    const first = fetchKlines(query, direct(impl));
    const second = fetchKlines(query, direct(impl));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it('serves a finished window from cache for three seconds', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { calls, impl } = recorder(() => response(page_(BASE, 5)));
    const query = { symbol: 'BTCUSDT', interval: '5m', limit: 5 };
    await fetchKlines(query, direct(impl));
    await fetchKlines(query, direct(impl));
    expect(calls).toHaveLength(1);
    clock.mockReturnValue(1_003_500);
    await fetchKlines(query, direct(impl));
    expect(calls).toHaveLength(2);
  });

  it('uses the futures endpoint and forwards an explicit endTime', async () => {
    const { calls, impl } = recorder(() => response([row(BASE)]));
    await fetchKlines({ symbol: 'ETHUSDT', interval: '15m', limit: 20, endTime: 1_699_999_000_000, market: 'futures' }, direct(impl));
    expect(calls[0]).toBe('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=15m&limit=20&endTime=1699999000000');
  });

  it('switches to the data-api mirror when asked', async () => {
    const { calls, impl } = recorder(() => response([row(BASE)]));
    await fetchKlines({ symbol: 'BTCUSDT', interval: '1d', limit: 30 }, direct(impl, { dataApi: true }));
    expect(calls[0]).toBe('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30');
  });
});

describe('fetchSymbols', () => {
  const price = (symbol_: string, last = '1') => ({ symbol: symbol_, price: last });
  const allPrices = (list: unknown[]) => response(list);

  it('keeps only USDT pairs', async () => {
    const { impl } = recorder(() => allPrices([
      price('BTCUSDT'), price('ETHBTC'), price('SOLUSDT'), price('XRPUSDT'),
    ]));
    const list = await fetchSymbols(direct(impl));
    expect(list.map(entry => entry.symbol)).toEqual(['BTCUSDT', 'SOLUSDT', 'XRPUSDT']);
    expect(list[0]).toEqual({ symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' });
  });

  it('drops leveraged tokens and stablecoin bases', async () => {
    const { impl } = recorder(() => allPrices([
      price('BTCUSDT'), price('BTCUPUSDT'), price('ETHDOWNUSDT'),
      price('XLMBULLUSDT'), price('TRXBEARUSDT'),
      price('USDCUSDT'), price('FDUSDUSDT'), price('TUSDUSDT'),
      price('BUSDUSDT'), price('DAIUSDT'), price('USDPUSDT'), price('USDEUSDT'),
      price('JUPUSDT'), price('DOGEUSDT'),
    ]));
    const list = await fetchSymbols(direct(impl));
    expect(list.map(entry => entry.symbol)).toEqual(['BTCUSDT', 'DOGEUSDT', 'JUPUSDT']);
  });

  it('sorts mainstream bases first and keeps exchange order afterwards', async () => {
    const { impl } = recorder(() => allPrices([
      price('ZECUSDT'), price('XRPUSDT'), price('AAAUSDT'),
      price('BTCUSDT'), price('SOLUSDT'), price('ETHUSDT'), price('BBBUSDT'),
    ]));
    const list = await fetchSymbols(direct(impl));
    expect(list.map(entry => entry.base)).toEqual(['BTC', 'ETH', 'SOL', 'XRP', 'ZEC', 'AAA', 'BBB']);
  });

  it('hits the light all-symbols price list once and then serves the six-hour cache', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const { calls, impl } = recorder(() => allPrices([price('BTCUSDT')]));
    await fetchSymbols(direct(impl));
    await fetchSymbols(direct(impl));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${SPOT}/api/v3/ticker/price`);
    clock.mockReturnValue(2_000_000 + 5 * 60 * 60 * 1000);
    await fetchSymbols(direct(impl));
    expect(calls).toHaveLength(1);
    clock.mockReturnValue(2_000_000 + 7 * 60 * 60 * 1000);
    await fetchSymbols(direct(impl));
    expect(calls).toHaveLength(2);
  });

  it('survives a malformed payload without inventing symbols', async () => {
    const { impl } = recorder(() => response([null, 'BTCUSDT', { baseAsset: 'BTC' }, { symbol: 42 }, { symbol: 'USDT' }]));
    await expect(fetchSymbols(direct(impl))).resolves.toEqual([]);
  });
});

describe('mirror fallback', () => {
  it('retries spot requests on the data-api mirror when the primary host fails', async () => {
    const seen: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const raw = String(input);
      seen.push(raw);
      if (raw.startsWith(SPOT)) throw new TypeError('primary down');
      return response([row(BASE)]);
    }) as unknown as typeof fetch;
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, direct(impl));
    expect(bars).toHaveLength(1);
    expect(seen[0]).toBe(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5`);
    expect(seen[1]).toBe(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5`);
  });

  it('does not double-fetch when the mirror itself was requested', async () => {
    const { calls, impl } = recorder(() => response([row(BASE)]));
    await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, direct(impl, { dataApi: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5');
  });

  it('surfaces the mirror failure when both routes fail', async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith(SPOT)) throw new TypeError('primary down');
      throw new TypeError('mirror down');
    }) as unknown as typeof fetch;
    await expect(fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, direct(impl))).rejects.toThrow('mirror down');
  });
});

describe('fetchTickers', () => {
  const tick = (symbol_: string, last: string, change: string, quote: string) =>
    ({ symbol: symbol_, lastPrice: last, priceChangePercent: change, quoteVolume: quote });

  it('short-circuits an empty symbol list without any request', async () => {
    const { calls, impl } = recorder(() => response([]));
    await expect(fetchTickers([], direct(impl))).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('sends the symbols as one encoded JSON array parameter', async () => {
    const { calls, impl } = recorder(() => response([]));
    await fetchTickers(['BTCUSDT', 'ETHUSDT'], direct(impl));
    expect(calls[0].startsWith(`${SPOT}/api/v3/ticker/24hr?`)).toBe(true);
    expect(decodeURIComponent(calls[0].slice(calls[0].indexOf('?') + 1))).toBe('symbols=["BTCUSDT","ETHUSDT"]');
  });

  it('maps lastPrice, priceChangePercent and quoteVolume', async () => {
    const { impl } = recorder(() => response([tick('BTCUSDT', '65000.5', '2.5', '1234567.8'), tick('ETHUSDT', '3200', '-1.25', '800000')]));
    await expect(fetchTickers(['BTCUSDT', 'ETHUSDT'], direct(impl))).resolves.toEqual([
      { symbol: 'BTCUSDT', price: 65000.5, changePercent: 2.5, volume: 1234567.8 },
      { symbol: 'ETHUSDT', price: 3200, changePercent: -1.25, volume: 800000 },
    ]);
  });

  it('filters unusable rows', async () => {
    const { impl } = recorder(() => response([
      tick('BTCUSDT', '65000', '1', '10'), null, 'x', { lastPrice: '1' }, tick('ETHUSDT', 'oops', '1', '10'),
    ]));
    const list = await fetchTickers(['BTCUSDT', 'ETHUSDT'], direct(impl));
    expect(list.map(entry => entry.symbol)).toEqual(['BTCUSDT']);
  });

  it('caches quotes for fifteen seconds and forgets them on reset', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(3_000_000);
    const { calls, impl } = recorder(() => response([tick('BTCUSDT', '65000', '1', '10')]));
    await fetchTickers(['BTCUSDT'], direct(impl));
    await fetchTickers(['BTCUSDT'], direct(impl));
    expect(calls).toHaveLength(1);
    clock.mockReturnValue(3_000_000 + 10_000);
    await fetchTickers(['BTCUSDT'], direct(impl));
    expect(calls).toHaveLength(1);
    clock.mockReturnValue(3_000_000 + 20_000);
    await fetchTickers(['BTCUSDT'], direct(impl));
    expect(calls).toHaveLength(2);
    resetFeedCache();
    await fetchTickers(['BTCUSDT'], direct(impl));
    expect(calls).toHaveLength(3);
  });
});

describe('transport', () => {
  const ORIGIN = 'http://127.0.0.1:5188';

  it('uses the shell proxy once /api/health reports mac-app', async () => {
    vi.stubGlobal('location', { origin: ORIGIN });
    const { calls, impl } = recorder(url => url.pathname === '/api/health' ? response({ ok: true, name: '交易训练室', mode: 'mac-app' }) : response(page_(BASE, 5)));
    await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, { fetchImpl: impl });
    expect(calls[0]).toBe(`${ORIGIN}/api/health`);
    expect(calls[1]).toBe(`${ORIGIN}/api/market/proxy?url=${encodeURIComponent(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5`)}`);
  });

  it('stays direct when health carries no mac-app mode', async () => {
    vi.stubGlobal('location', { origin: ORIGIN });
    const { calls, impl } = recorder(url => url.pathname === '/api/health' ? response({ ok: true }) : response([row(BASE)]));
    await expect(detectTransport({ fetchImpl: impl })).resolves.toBe('direct');
    await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, { fetchImpl: impl });
    expect(calls[1]).toBe(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5`);
  });

  it('retries a failing probe once and then falls back to direct', async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const raw = String(input);
      calls.push(raw);
      if (raw.endsWith('/api/health')) throw new Error('offline');
      return response([row(BASE)]);
    }) as unknown as typeof fetch;
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, { fetchImpl: impl });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0].endsWith('/api/health')).toBe(true);
    expect(calls[2]).toBe(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5`);
    expect(bars).toHaveLength(1);
  });

  it('treats a non-200 health answer as direct after the retry', async () => {
    vi.stubGlobal('location', { origin: ORIGIN });
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const raw = String(input);
      calls.push(raw);
      if (raw.endsWith('/api/health')) return response('not found', 404);
      return response([row(BASE)]);
    }) as unknown as typeof fetch;
    await expect(detectTransport({ fetchImpl: impl })).resolves.toBe('direct');
    expect(calls.filter(url => url.endsWith('/api/health'))).toHaveLength(2);
  });

  it('probes the transport only once for repeated feed calls', async () => {
    vi.stubGlobal('location', { origin: ORIGIN });
    const { calls, impl } = recorder(url => url.pathname === '/api/health' ? response({ mode: 'mac-app' }) : response([row(BASE)]));
    await fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, { fetchImpl: impl });
    await fetchTickers(['BTCUSDT'], { fetchImpl: impl });
    expect(calls.filter(url => url.endsWith('/api/health'))).toHaveLength(1);
    await expect(detectTransport()).resolves.toBe('shell');
  });

  it('keeps a failing proxy status as an HTTP error', async () => {
    vi.stubGlobal('location', { origin: ORIGIN });
    const { impl } = recorder(url => url.pathname === '/api/health' ? response({ mode: 'mac-app' }) : response('boom', 500));
    await expect(fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, { fetchImpl: impl })).rejects.toThrow('Binance HTTP 500');
  });
});

describe('errors', () => {
  it('throws Binance HTTP <status> on a non-200 response', async () => {
    const { impl } = recorder(() => response('rate limited', 429));
    await expect(fetchKlines({ symbol: 'BTCUSDT', interval: '1m', limit: 5 }, direct(impl))).rejects.toThrow('Binance HTTP 429');
  });

  it('throws a readable error when the body is not JSON', async () => {
    const { impl } = recorder(() => response('<html>gateway</html>'));
    await expect(fetchSymbols(direct(impl))).rejects.toThrow(/invalid JSON/);
  });

  it('rethrows network failures untouched', async () => {
    const failure = new TypeError('Failed to fetch');
    const impl = (async () => { throw failure; }) as unknown as typeof fetch;
    await expect(fetchTickers(['BTCUSDT'], direct(impl))).rejects.toBe(failure);
  });
});

describe('historical funding rates', () => {
  it('fetches and normalises the futures funding history', async () => {
    const calls: string[] = [];
    const { impl } = recorder(url => { calls.push(url.href); return response([
      { symbol: 'BTCUSDT', fundingTime: 1788883200000, fundingRate: '0.00010000' },
      { symbol: 'BTCUSDT', fundingTime: 1788854400000, fundingRate: '-0.00005' },
      { symbol: 'BTCUSDT', fundingTime: 0, fundingRate: 'x' },
    ]); });
    const rates = await fetchFundingRates('BTCUSDT', { fetchImpl: impl, transport: 'direct' });
    expect(calls[0]).toContain('/fapi/v1/fundingRate');
    expect(calls[0]).toContain('symbol=BTCUSDT');
    expect(rates).toEqual([{ time: 1788854400, rate: -.00005 }, { time: 1788883200, rate: .0001 }]);
    const map = fundingByBoundary(rates);
    expect(map.get(1788883200)).toBe(.0001);
    expect(map.size).toBe(2);
    expect(fundingByBoundary([]).size).toBe(0);
  });
  it('reads the live funding rate and next settlement from premiumIndex', async () => {
    const { impl } = recorder(url => response(url.pathname.includes('premiumIndex')
      ? { symbol: 'BTCUSDT', lastFundingRate: '0.00010000', nextFundingTime: 1788900000000 }
      : []));
    const premium = await fetchPremiumIndex('BTCUSDT', { fetchImpl: impl, transport: 'direct' });
    expect(premium).toEqual({ symbol: 'BTCUSDT', rate: .0001, nextFundingTime: 1788900000 });
    resetFeedCache();
    const { impl: bad } = recorder(() => response({ msg: 'nope' }));
    expect(await fetchPremiumIndex('BTCUSDT', { fetchImpl: bad, transport: 'direct' })).toBeNull();
  });
  it('returns an empty list for a malformed payload', async () => {
    const { impl } = recorder(() => response({ msg: 'nope' }));
    expect(await fetchFundingRates('BTCUSDT', { fetchImpl: impl, transport: 'direct' })).toEqual([]);
  });
});

describe('deep history paging', () => {
  it('exposes a far larger ceiling than the old 12k cap', () => {
    expect(MAX_KLINES).toBeGreaterThanOrEqual(300_000);
    expect(HISTORY_CHUNK).toBe(10_000);
    expect(HISTORY_CHUNK).toBeLessThanOrEqual(MAX_KLINES);
  });
  it('pages backwards across many pages until the requested depth is reached', async () => {
    // 每页返回满 1000 根，时间往前推；验证 5 页请求链能凑满 5000 根且严格有序不重复。
    const seenPages: number[] = [];
    const { impl } = recorder(url => {
      const endTime = Number(new URL(url.href).searchParams.get('endTime') ?? Date.now());
      const last = Math.floor(endTime / STEP) * STEP;
      seenPages.push(last);
      const rows = Array.from({ length: 1000 }, (_, index) => {
        const close = 100 + index * .01;
        const open = (last - (999 - index) * STEP) / STEP;
        return [(last - (999 - index) * STEP), String(close), String(close + 1), String(close - 1), String(open), '10'];
      });
      return response(rows);
    });
    resetFeedCache();
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '15m', limit: 5000 }, { fetchImpl: impl, transport: 'direct' });
    expect(bars).toHaveLength(5000);
    expect(new Set(bars.map(bar => bar.time)).size).toBe(5000);
    expect(bars[0].time).toBeLessThan(bars[bars.length - 1].time);
    expect(seenPages.length).toBeGreaterThanOrEqual(5);
    // 相邻页之间要往前挪（endTime 递减），否则会重复拉同一段
    expect(seenPages[1]).toBeLessThan(seenPages[0]);
  });
  it('stops cleanly when the exchange returns an empty page', async () => {
    let calls = 0;
    const { impl } = recorder(url => {
      calls++;
      const endTime = Number(new URL(url.href).searchParams.get('endTime') ?? Date.now());
      if (calls === 1) {
        const last = Math.floor(endTime / STEP) * STEP;
        return response(Array.from({ length: 1000 }, (_, index) => {
          const time = last - (999 - index) * STEP;
          return [time, '100', '101', '99', '100', '10'];
        }));
      }
      return response([]);
    });
    resetFeedCache();
    const bars = await fetchKlines({ symbol: 'BTCUSDT', interval: '15m', limit: 12_000 }, { fetchImpl: impl, transport: 'direct' });
    expect(bars).toHaveLength(1000);
    expect(calls).toBe(2);
  });
});
