"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildScannerStaticContext,
  evaluateScannerContext,
  scannerBucketStart,
  type ScannerInstrument,
  type ScannerLiveState,
  type ScannerOpportunity,
  type ScannerStaticContext
} from "@/lib/scanner/engine";
import type { ChartCandle } from "@/components/MarketChart";
import {
  buildNewsGate,
  type NewsImpactEvent
} from "@/lib/news/impact";

type Props = {
  fyersConnected: boolean;
  newsEvents: NewsImpactEvent[];
  onOpen: (instrument: {
    symbol: string;
    name: string;
    market: string;
    segment: string;
    type: string;
    underlying: string;
    expiry: string | null;
    strike: number | null;
    optionType: string | null;
    lotSize?: number | null;
    tickSize?: number | null;
  }) => void;
};

type UniverseResponse = {
  fyers: ScannerInstrument[];
  kraken: ScannerInstrument[];
  coverage: {
    fyersSymbols: number;
    reservedFyersSlots: number;
    standardSocketLimit: number;
    primeSocketLimit: number;
  };
};

type OptionLeg = {
  symbol: string;
  optionType: "CE" | "PE";
  strike: number;
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  oi: number;
  oiChange: number;
  oiChangePercent: number;
  previousOi: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    iv: number;
  } | null;
};

type OptionSizing = {
  action: string;
  symbol: string;
  strike: number;
  optionType: "CE" | "PE";
  ltp: number;
  lotSize: number | null;
  perLotCapital: number | null;
  maxLots: number | null;
  maxQuantity: number | null;
  source: "PREMIUM" | "FYERS_MARGIN";
};

type DerivativeIdea = {
  underlying: string;
  direction: "bullish" | "bearish";
  buy: OptionSizing | null;
  sell: OptionSizing | null;
  fetchedAt: number;
};

type DerivativeWatch = {
  instrument: ScannerInstrument;
  direction: "bullish" | "bearish";
  score: number;
  pcr: number | null;
  futureSymbol: string | null;
  futurePrice: number | null;
  futureOiChange: number | null;
  reason: string;
  idea: DerivativeIdea | null;
  updatedAt: number;
};

type LiveRuntime = ScannerLiveState & {
  bucket: number;
};

const CACHE_PREFIX = "allinoneview:scanner-history:v1:";
const CACHE_MS = 15 * 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cacheKey(instrument: ScannerInstrument) {
  return CACHE_PREFIX + instrument.market + ":" + instrument.symbol;
}

function loadCachedCandles(instrument: ScannerInstrument) {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(instrument));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      candles?: ChartCandle[];
    };

    if (
      !parsed.savedAt ||
      Date.now() - parsed.savedAt > CACHE_MS ||
      !Array.isArray(parsed.candles)
    ) {
      return null;
    }

    return parsed.candles;
  } catch {
    return null;
  }
}

function saveCachedCandles(
  instrument: ScannerInstrument,
  candles: ChartCandle[]
) {
  try {
    window.sessionStorage.setItem(
      cacheKey(instrument),
      JSON.stringify({
        savedAt: Date.now(),
        candles: candles.slice(-900)
      })
    );
  } catch {
    // Session storage can be unavailable or full; scanner still works.
  }
}

function toOpenInstrument(instrument: ScannerInstrument) {
  return {
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    segment:
      instrument.market === "KRAKEN"
        ? "SPOT"
        : instrument.type === "FUTURE"
          ? "COMMODITY"
          : instrument.type === "INDEX"
            ? "INDEX"
            : "CASH",
    type:
      instrument.market === "KRAKEN"
        ? "CRYPTO"
        : instrument.type,
    underlying: instrument.underlying,
    expiry: null,
    strike: null,
    optionType: null,
    lotSize: instrument.lotSize,
    tickSize: null
  };
}

function newsRiskPriority(level: string) {
  if (level === "CRITICAL") return 4;
  if (level === "HIGH") return 3;
  if (level === "WATCH") return 2;
  return 1;
}

function opportunityPriority(
  opportunity: ScannerOpportunity,
  events: NewsImpactEvent[]
) {
  const gate = buildNewsGate({
    events,
    symbol: opportunity.instrument.symbol,
    market: opportunity.instrument.market
  });

  const structurePriority =
    opportunity.state === "STRONG"
      ? 3
      : opportunity.state === "LIVE SWEEP"
        ? 2
        : 1;

  return (
    newsRiskPriority(gate.riskLevel) * 1000 +
    (gate.direction === opportunity.direction ? 100 : 0) +
    structurePriority * 10 +
    opportunity.score
  );
}

function newsMappedInstrument(
  event: NewsImpactEvent,
  universe: UniverseResponse | null
) {
  if (!universe) return null;
  const all = [...universe.fyers, ...universe.kraken];

  for (const symbol of event.symbols) {
    const exact = all.find((item) => item.symbol === symbol);
    if (exact) return exact;
  }

  if (event.tags.includes("BTC")) {
    return all.find((item) => item.symbol === "BTC/USD") ?? null;
  }
  if (event.tags.includes("ETH")) {
    return all.find((item) => item.symbol === "ETH/USD") ?? null;
  }
  if (event.tags.includes("BANKNIFTY")) {
    return (
      all.find((item) => item.symbol === "NSE:NIFTYBANK-INDEX") ??
      null
    );
  }
  if (event.tags.includes("NIFTY") || event.tags.includes("INDIA")) {
    return (
      all.find((item) => item.symbol === "NSE:NIFTY50-INDEX") ??
      null
    );
  }
  if (event.tags.includes("OIL")) {
    return (
      all.find(
        (item) =>
          item.market === "MCX" &&
          /CRUDE/i.test(item.name + item.symbol)
      ) ?? null
    );
  }
  if (event.tags.includes("GOLD")) {
    return (
      all.find(
        (item) =>
          item.market === "MCX" &&
          /GOLD/i.test(item.name + item.symbol)
      ) ?? null
    );
  }

  return null;
}

async function fetchLotSize(symbol: string) {
  const market = symbol.startsWith("BSE:") ? "BSE" : "NSE";
  const response = await fetch(
    "/api/fyers/instruments?q=" +
      encodeURIComponent(symbol) +
      "&market=" +
      market +
      "&type=OPTION",
    { cache: "no-store" }
  );
  const data = await response.json();

  if (!response.ok || !data.ok || !Array.isArray(data.instruments)) {
    return null;
  }

  const exact = data.instruments.find(
    (item: { symbol?: string }) => item.symbol === symbol
  );

  return Number(exact?.lotSize ?? 0) > 0
    ? Number(exact.lotSize)
    : null;
}

async function fetchSellMargin(symbol: string, lotSize: number) {
  const response = await fetch("/api/fyers/margin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      qty: lotSize,
      side: -1,
      productType: "MARGIN"
    })
  });
  const data = await response.json();

  return response.ok && data.ok && Number(data.marginTotal) > 0
    ? Number(data.marginTotal)
    : null;
}

function sizeBuyOption(
  action: string,
  leg: OptionLeg | null,
  lotSize: number | null,
  capital: number
): OptionSizing | null {
  if (!leg) return null;

  const perLotCapital =
    lotSize && leg.ltp > 0 ? lotSize * leg.ltp : null;
  const maxLots =
    perLotCapital && capital > 0
      ? Math.floor(capital / perLotCapital)
      : null;

  return {
    action,
    symbol: leg.symbol,
    strike: leg.strike,
    optionType: leg.optionType,
    ltp: leg.ltp,
    lotSize,
    perLotCapital,
    maxLots,
    maxQuantity:
      maxLots !== null && lotSize ? maxLots * lotSize : null,
    source: "PREMIUM"
  };
}

function sizeSellOption(
  action: string,
  leg: OptionLeg | null,
  lotSize: number | null,
  margin: number | null,
  capital: number
): OptionSizing | null {
  if (!leg) return null;

  const maxLots =
    margin && capital > 0 ? Math.floor(capital / margin) : null;

  return {
    action,
    symbol: leg.symbol,
    strike: leg.strike,
    optionType: leg.optionType,
    ltp: leg.ltp,
    lotSize,
    perLotCapital: margin,
    maxLots,
    maxQuantity:
      maxLots !== null && lotSize ? maxLots * lotSize : null,
    source: "FYERS_MARGIN"
  };
}

function formatPrice(value: number) {
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: value >= 1000 ? 2 : 4
  });
}

export default function OpportunityScanner({
  fyersConnected,
  newsEvents,
  onOpen
}: Props) {
  const [universe, setUniverse] = useState<UniverseResponse | null>(null);
  const [contextsVersion, setContextsVersion] = useState(0);
  const [opportunities, setOpportunities] = useState<ScannerOpportunity[]>([]);
  const [warming, setWarming] = useState(false);
  const [warmed, setWarmed] = useState(0);
  const [scannerLive, setScannerLive] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [capitalInput, setCapitalInput] = useState("");
  const [derivativeIdeas, setDerivativeIdeas] = useState<
    Record<string, DerivativeIdea>
  >({});
  const [derivativeWatches, setDerivativeWatches] = useState<
    DerivativeWatch[]
  >([]);

  const contextsRef = useRef(
    new Map<string, ScannerStaticContext>()
  );
  const liveRef = useRef(new Map<string, LiveRuntime>());
  const derivativeFetchRef = useRef(new Map<string, number>());
  const krakenSourcesRef = useRef<EventSource[]>([]);

  const capital = Math.max(0, Number(capitalInput || 0));

  const totalUniverse =
    (universe?.fyers.length ?? 0) + (universe?.kraken.length ?? 0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/scanner/universe", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.ok) {
          setUniverse(data as UniverseResponse);
        }
      })
      .catch(() => {
        // Scanner panel remains available and shows no warmed symbols.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!universe) return;

    let cancelled = false;

    const loadHistory = async (instrument: ScannerInstrument) => {
      const cached = loadCachedCandles(instrument);

      if (cached?.length) {
        const context = buildScannerStaticContext(
          instrument,
          cached
        );
        if (context) {
          contextsRef.current.set(instrument.symbol, context);
          setWarmed(contextsRef.current.size);
          setContextsVersion((value) => value + 1);
          return;
        }
      }

      const endpoint =
        instrument.market === "KRAKEN"
          ? "/api/kraken/history?symbol=" +
            encodeURIComponent(instrument.symbol) +
            "&resolution=15"
          : "/api/fyers/history?symbol=" +
            encodeURIComponent(instrument.symbol) +
            "&resolution=15&range=1M";

      const response = await fetch(endpoint, {
        cache: "no-store"
      });
      const data = await response.json();

      if (
        !response.ok ||
        !data.ok ||
        !Array.isArray(data.candles)
      ) {
        return;
      }

      const candles = data.candles as ChartCandle[];
      const context = buildScannerStaticContext(
        instrument,
        candles
      );

      if (!context) return;

      saveCachedCandles(instrument, candles);
      contextsRef.current.set(instrument.symbol, context);
      setWarmed(contextsRef.current.size);
      setContextsVersion((value) => value + 1);
    };

    const warm = async () => {
      setWarming(true);

      await Promise.all(
        universe.kraken.map((instrument) =>
          loadHistory(instrument).catch(() => undefined)
        )
      );

      if (fyersConnected) {
        for (const instrument of universe.fyers) {
          if (cancelled) break;
          await loadHistory(instrument).catch(() => undefined);
          // ~37 Data API calls/minute, leaving headroom under Standard 50/min.
          await sleep(1600);
        }
      }

      if (!cancelled) setWarming(false);
    };

    void warm();

    const refreshTimer = window.setInterval(() => {
      if (!cancelled) void warm();
    }, 60 * 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [universe, fyersConnected]);

  useEffect(() => {
    if (!universe || !fyersConnected || !universe.fyers.length) {
      return;
    }

    let cancelled = false;

    const batches: ScannerInstrument[][] = [];
    for (let index = 0; index < universe.fyers.length; index += 50) {
      batches.push(universe.fyers.slice(index, index + 50));
    }

    const applyQuotes = (
      batch: ScannerInstrument[],
      quotes: Array<{ symbol: string; ltp: number; timestamp?: number }>
    ) => {
      const bySymbol = new Map(batch.map((item) => [item.symbol, item]));

      for (const quote of quotes) {
        const instrument = bySymbol.get(quote.symbol);
        const price = Number(quote.ltp ?? 0);
        if (!instrument || !(price > 0)) continue;

        const time =
          Number(quote.timestamp ?? 0) > 1_000_000_000
            ? Number(quote.timestamp)
            : Math.floor(Date.now() / 1000);
        const bucket = scannerBucketStart(
          time,
          15,
          instrument.market
        );
        const previous = liveRef.current.get(quote.symbol);

        const next: LiveRuntime =
          !previous || previous.bucket !== bucket
            ? {
                price,
                observedHigh: price,
                observedLow: price,
                observedSince: time,
                updatedAt: Date.now(),
                bucket
              }
            : {
                ...previous,
                price,
                observedHigh: Math.max(previous.observedHigh, price),
                observedLow: Math.min(previous.observedLow, price),
                updatedAt: Date.now()
              };

        liveRef.current.set(quote.symbol, next);
      }

      if (quotes.length) {
        setLastTickAt(Date.now());
        setScannerLive(true);
      }
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        for (const batch of batches) {
          if (cancelled) return;

          const response = await fetch(
            "/api/fyers/quotes?symbols=" +
              encodeURIComponent(
                batch.map((item) => item.symbol).join(",")
              ),
            { cache: "no-store" }
          );
          const data = await response.json();

          if (response.ok && data.ok && Array.isArray(data.quotes)) {
            applyQuotes(batch, data.quotes);
          }
        }
      } catch {
        setScannerLive(false);
      }
    };

    void poll();

    // Standard-safe: all FYERS scanner symbols refresh about every 20s.
    // With <=90 symbols this uses at most two Quotes API calls/cycle.
    const timer = window.setInterval(poll, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [universe, fyersConnected]);

  useEffect(() => {
    for (const source of krakenSourcesRef.current) {
      source.close();
    }
    krakenSourcesRef.current = [];

    if (!universe) return;

    for (const instrument of universe.kraken) {
      const source = new EventSource(
        "/api/kraken/stream?symbol=" +
          encodeURIComponent(instrument.symbol) +
          "&resolution=15"
      );

      source.addEventListener("status", (event) => {
        try {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data
          );
          if (payload.connected) setScannerLive(true);
        } catch {
          // no-op
        }
      });

      source.addEventListener("ticker", (event) => {
        try {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data
          ) as {
            symbol?: string;
            last?: number;
          };
          const price = Number(payload.last ?? 0);
          if (!(price > 0)) return;

          const time = Math.floor(Date.now() / 1000);
          const bucket = scannerBucketStart(
            time,
            15,
            "KRAKEN"
          );
          const previous = liveRef.current.get(instrument.symbol);

          const next: LiveRuntime =
            !previous || previous.bucket !== bucket
              ? {
                  price,
                  observedHigh: price,
                  observedLow: price,
                  observedSince: time,
                  updatedAt: Date.now(),
                  bucket
                }
              : {
                  ...previous,
                  price,
                  observedHigh: Math.max(
                    previous.observedHigh,
                    price
                  ),
                  observedLow: Math.min(
                    previous.observedLow,
                    price
                  ),
                  updatedAt: Date.now()
                };

          liveRef.current.set(instrument.symbol, next);
          setLastTickAt(Date.now());
        } catch {
          // no-op
        }
      });

      source.addEventListener("candle", (event) => {
        try {
          const candle = JSON.parse(
            (event as MessageEvent<string>).data
          ) as ChartCandle & { symbol?: string };

          if (
            candle.symbol &&
            candle.symbol !== instrument.symbol
          ) {
            return;
          }

          const bucket = candle.time;
          const previous = liveRef.current.get(instrument.symbol);

          liveRef.current.set(instrument.symbol, {
            price: candle.close,
            observedHigh: candle.high,
            observedLow: candle.low,
            observedSince: candle.time,
            updatedAt: Date.now(),
            bucket:
              previous?.bucket === bucket
                ? previous.bucket
                : bucket
          });
          setLastTickAt(Date.now());
        } catch {
          // no-op
        }
      });

      krakenSourcesRef.current.push(source);
    }

    return () => {
      for (const source of krakenSourcesRef.current) {
        source.close();
      }
      krakenSourcesRef.current = [];
    };
  }, [universe]);

  const buildDerivativeIdea = async (
    instrument: ScannerInstrument,
    direction: "bullish" | "bearish",
    price: number,
    data: any
  ): Promise<DerivativeIdea | null> => {
    const atm = data.options?.atm;
    if (!atm) return null;

    const bullish = direction === "bullish";
    const buyLeg: OptionLeg | null = bullish ? atm.call : atm.put;
    const sellLeg: OptionLeg | null = bullish ? atm.put : atm.call;

    const [buyLotSize, sellLotSize] = await Promise.all([
      buyLeg ? fetchLotSize(buyLeg.symbol) : Promise.resolve(null),
      sellLeg ? fetchLotSize(sellLeg.symbol) : Promise.resolve(null)
    ]);

    const sellMargin =
      sellLeg && sellLotSize
        ? await fetchSellMargin(
            sellLeg.symbol,
            sellLotSize
          ).catch(() => null)
        : null;

    return {
      underlying: String(data.underlying ?? instrument.symbol),
      direction,
      buy: sizeBuyOption(
        bullish ? "BUY CALL" : "BUY PUT",
        buyLeg,
        buyLotSize,
        capital
      ),
      sell: sizeSellOption(
        bullish ? "SELL PUT" : "SELL CALL",
        sellLeg,
        sellLotSize,
        sellMargin,
        capital
      ),
      fetchedAt: Date.now()
    };
  };

  useEffect(() => {
    const evaluate = () => {
      void contextsVersion;
      const next: ScannerOpportunity[] = [];

      for (const [symbol, context] of contextsRef.current) {
        const live = liveRef.current.get(symbol);
        if (!live) continue;

        const staleAfter =
          context.instrument.market === "KRAKEN"
            ? 30_000
            : 90_000;

        if (Date.now() - live.updatedAt > staleAfter) continue;

        const opportunity = evaluateScannerContext(
          context,
          live
        );

        if (opportunity) next.push(opportunity);
      }

      next.sort((a, b) => {
        const priority =
          opportunityPriority(b, newsEvents) -
          opportunityPriority(a, newsEvents);
        if (priority !== 0) return priority;
        return b.score - a.score;
      });

      setOpportunities(next.slice(0, 20));
    };

    evaluate();
    const timer = window.setInterval(evaluate, 1000);
    return () => window.clearInterval(timer);
  }, [contextsVersion, newsEvents]);

  useEffect(() => {
    if (!fyersConnected || !opportunities.length) return;

    let cancelled = false;

    const hydrate = async (opportunity: ScannerOpportunity) => {
      if (opportunity.instrument.market === "KRAKEN") return;

      const key = opportunity.instrument.symbol;
      const previousFetch = derivativeFetchRef.current.get(key) ?? 0;
      if (Date.now() - previousFetch < 5 * 60_000) return;
      derivativeFetchRef.current.set(key, Date.now());

      try {
        const instrument = opportunity.instrument;
        const response = await fetch(
          "/api/fyers/derivatives?symbol=" +
            encodeURIComponent(instrument.symbol) +
            "&market=" +
            encodeURIComponent(instrument.market) +
            "&type=" +
            encodeURIComponent(instrument.type) +
            "&underlying=" +
            encodeURIComponent(instrument.underlying) +
            "&spotPrice=" +
            encodeURIComponent(String(opportunity.price)),
          { cache: "no-store" }
        );
        const data = await response.json();

        if (!response.ok || !data.ok || !data.available) return;

        const idea = await buildDerivativeIdea(
          instrument,
          opportunity.direction,
          opportunity.price,
          data
        );

        if (cancelled || !idea) return;

        setDerivativeIdeas((current) => ({
          ...current,
          [key]: idea
        }));
      } catch {
        // Derivative deep scan is optional; underlying opportunity remains.
      }
    };

    const topIndian = opportunities
      .filter(
        (item) =>
          item.instrument.market !== "KRAKEN" &&
          (item.state === "STRONG" ||
            item.state === "LIVE SWEEP")
      )
      .slice(0, 3);

    void Promise.all(topIndian.map(hydrate));

    const timer = window.setInterval(() => {
      void Promise.all(topIndian.map(hydrate));
    }, 5 * 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [opportunities, fyersConnected, capital]);

  const liveAge =
    lastTickAt === null
      ? null
      : Math.max(0, Math.floor((now - lastTickAt) / 1000));

  useEffect(() => {
    if (!universe || !fyersConnected) return;

    let cancelled = false;

    const indexSymbols = new Set([
      "NSE:NIFTY50-INDEX",
      "NSE:NIFTYBANK-INDEX",
      "NSE:FINNIFTY-INDEX",
      "BSE:SENSEX-INDEX"
    ]);

    const indices = universe.fyers.filter((instrument) =>
      indexSymbols.has(instrument.symbol)
    );

    const scan = async () => {
      const next: DerivativeWatch[] = [];

      for (const instrument of indices) {
        const live = liveRef.current.get(instrument.symbol);
        if (!live?.price) continue;

        try {
          const response = await fetch(
            "/api/fyers/derivatives?symbol=" +
              encodeURIComponent(instrument.symbol) +
              "&market=" +
              encodeURIComponent(instrument.market) +
              "&type=INDEX&underlying=" +
              encodeURIComponent(instrument.underlying) +
              "&spotPrice=" +
              encodeURIComponent(String(live.price)),
            { cache: "no-store" }
          );
          const data = await response.json();

          if (!response.ok || !data.ok || !data.available) continue;

          const options = data.options;
          const future = data.future;

          const callBuild = Array.isArray(options?.callOiBuild)
            ? options.callOiBuild.reduce(
                (sum: number, leg: OptionLeg) =>
                  sum + Math.max(0, Number(leg.oiChange ?? 0)),
                0
              )
            : 0;
          const putBuild = Array.isArray(options?.putOiBuild)
            ? options.putOiBuild.reduce(
                (sum: number, leg: OptionLeg) =>
                  sum + Math.max(0, Number(leg.oiChange ?? 0)),
                0
              )
            : 0;
          const pcr =
            options?.pcr === null || options?.pcr === undefined
              ? null
              : Number(options.pcr);

          let bullishPoints = 0;
          let bearishPoints = 0;
          const reasonsBull: string[] = [];
          const reasonsBear: string[] = [];

          if (pcr !== null && pcr >= 1.1) {
            bullishPoints += 1;
            reasonsBull.push("PCR " + pcr.toFixed(2));
          }
          if (pcr !== null && pcr <= 0.9) {
            bearishPoints += 1;
            reasonsBear.push("PCR " + pcr.toFixed(2));
          }

          if (putBuild > callBuild * 1.15 && putBuild > 0) {
            bullishPoints += 1;
            reasonsBull.push("Put OI build");
          }
          if (callBuild > putBuild * 1.15 && callBuild > 0) {
            bearishPoints += 1;
            reasonsBear.push("Call OI build");
          }

          const futureChange = Number(future?.change ?? 0);
          const futureOiChange = Number(future?.oiChange ?? 0);

          if (futureChange > 0 && futureOiChange > 0) {
            bullishPoints += 1;
            reasonsBull.push("Futures long build");
          }
          if (futureChange < 0 && futureOiChange > 0) {
            bearishPoints += 1;
            reasonsBear.push("Futures short build");
          }

          const direction =
            bullishPoints > bearishPoints
              ? "bullish"
              : bearishPoints > bullishPoints
                ? "bearish"
                : null;
          const points = Math.max(bullishPoints, bearishPoints);

          if (!direction || points < 2) continue;

          const idea = await buildDerivativeIdea(
            instrument,
            direction,
            live.price,
            data
          );

          next.push({
            instrument,
            direction,
            score: 50 + points * 10,
            pcr,
            futureSymbol: future?.symbol ?? null,
            futurePrice:
              Number(future?.price ?? 0) > 0
                ? Number(future.price)
                : null,
            futureOiChange:
              Number.isFinite(futureOiChange)
                ? futureOiChange
                : null,
            reason:
              direction === "bullish"
                ? reasonsBull.join(" · ")
                : reasonsBear.join(" · "),
            idea,
            updatedAt: Date.now()
          });
        } catch {
          // Keep the previous successful derivative watch if this pass fails.
        }
      }

      if (!cancelled) {
        setDerivativeWatches(next);
      }
    };

    void scan();
    const timer = window.setInterval(scan, 5 * 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [universe, fyersConnected, capital]);

  const activePriorityNews = useMemo(
    () =>
      newsEvents
        .filter(
          (event) =>
            event.expiresAt > Date.now() &&
            event.severity >= 70
        )
        .sort((a, b) => {
          if (b.severity !== a.severity) {
            return b.severity - a.severity;
          }
          return b.receivedAt - a.receivedAt;
        })
        .slice(0, 6),
    [newsEvents]
  );

  const strongCount = useMemo(
    () =>
      opportunities.filter((item) => item.state === "STRONG")
        .length,
    [opportunities]
  );

  const openOption = (
    sizing: OptionSizing,
    parent: ScannerOpportunity
  ) => {
    onOpen({
      symbol: sizing.symbol,
      name:
        sizing.action +
        " · " +
        sizing.strike.toLocaleString("en-IN") +
        " " +
        sizing.optionType,
      market: parent.instrument.market,
      segment: "F&O",
      type: "OPTION",
      underlying: parent.instrument.underlying,
      expiry: null,
      strike: sizing.strike,
      optionType: sizing.optionType,
      lotSize: sizing.lotSize,
      tickSize: null
    });
  };

  return (
    <aside className="opportunityScanner">
      <div className="scannerHeader">
        <div>
          <span>LIVE OPPORTUNITY SCANNER</span>
          <strong>{strongCount} strong now</strong>
        </div>
        <div
          className={
            scannerLive
              ? "scannerLiveBadge online"
              : "scannerLiveBadge"
          }
        >
          <i />
          {scannerLive ? "LIVE" : warming ? "WARMING" : "WAITING"}
        </div>
      </div>

      <div className="scannerMeta">
        <span>
          {warmed}/{totalUniverse || "—"} contexts
        </span>
        <span>
          {liveAge === null ? "no tick yet" : liveAge + "s ago"}
        </span>
        {universe ? (
          <span>
            FYERS {universe.coverage.fyersSymbols}/
            {universe.coverage.standardSocketLimit} Standard slots
          </span>
        ) : null}
      </div>

      <label className="scannerCapital">
        <span>OPTION CAPITAL · OPTIONAL</span>
        <div>
          <b>₹</b>
          <input
            inputMode="decimal"
            value={capitalInput}
            onChange={(event) =>
              setCapitalInput(
                event.target.value.replace(/[^0-9.]/g, "")
              )
            }
            placeholder="e.g. 100000"
          />
        </div>
        <small>
          Buy sizing uses exact premium × lot size. Sell sizing uses
          FYERS margin calculator where available.
        </small>
      </label>

      {activePriorityNews.length ? (
        <div className="scannerNewsSection">
          <div className="scannerNewsTitle">
            NEWS-FIRST MARKET RISK
          </div>
          {activePriorityNews.map((event) => {
            const mapped = newsMappedInstrument(event, universe);
            return (
              <button
                type="button"
                className={
                  "scannerNewsItem " +
                  event.severityClass.toLowerCase()
                }
                key={event.id}
                onClick={() => {
                  if (mapped) onOpen(toOpenInstrument(mapped));
                }}
                disabled={!mapped}
              >
                <div>
                  <span>
                    {event.severityClass} · {event.source}
                  </span>
                  <strong>{event.headline}</strong>
                </div>
                <small>
                  {event.bias.replaceAll("_", " ")} ·{" "}
                  {event.confidence}% confidence · WAIT FOR PRICE
                  CONFIRMATION
                </small>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="scannerList">
        {opportunities.length ? (
          opportunities.map((opportunity) => {
            const idea =
              derivativeIdeas[opportunity.instrument.symbol];
            const newsGate = buildNewsGate({
              events: newsEvents,
              symbol: opportunity.instrument.symbol,
              market: opportunity.instrument.market
            });
            const newsConflict =
              newsGate.riskLevel === "HIGH" &&
              newsGate.confidence >= 75 &&
              newsGate.direction !== "unknown" &&
              newsGate.direction !== opportunity.direction;
            const newsBlocked =
              newsGate.blocked || newsConflict;
            const age = Math.max(
              0,
              Math.floor(
                (now - opportunity.updatedAt) / 1000
              )
            );

            return (
              <article
                className={
                  "scannerOpportunity " +
                  opportunity.state.toLowerCase().replace(" ", "-") +
                  (newsBlocked ? " news-hold" : "") +
                  (newsGate.riskLevel === "HIGH" ||
                  newsGate.riskLevel === "CRITICAL"
                    ? " news-priority"
                    : "")
                }
                key={
                  opportunity.instrument.market +
                  ":" +
                  opportunity.instrument.symbol
                }
              >
                <button
                  type="button"
                  className="scannerOpportunityMain"
                  onClick={() =>
                    onOpen(
                      toOpenInstrument(opportunity.instrument)
                    )
                  }
                >
                  <div className="scannerOpportunityTop">
                    <div>
                      <strong>
                        {opportunity.instrument.name}
                      </strong>
                      <span>
                        {opportunity.instrument.market} ·{" "}
                        {opportunity.instrument.type}
                      </span>
                    </div>
                    <div
                      className={
                        "scannerDirection " +
                        opportunity.direction
                      }
                    >
                      {newsBlocked
                        ? "NEWS HOLD"
                        : opportunity.direction === "bullish"
                          ? "LONG"
                          : "SHORT"}
                    </div>
                  </div>

                  <div className="scannerScoreRow">
                    <span className="scannerState">
                      {newsBlocked
                        ? "NEWS HOLD"
                        : newsGate.riskLevel === "HIGH" &&
                            newsGate.direction === opportunity.direction
                          ? "NEWS + " + opportunity.state
                          : opportunity.state}
                    </span>
                    <b>{opportunity.score}/100</b>
                    <span>{formatPrice(opportunity.price)}</span>
                    <small>{age}s</small>
                  </div>

                  {newsGate.event &&
                  (newsGate.riskLevel === "HIGH" ||
                    newsGate.riskLevel === "CRITICAL") ? (
                    <p className="scannerNewsTrigger">
                      {newsGate.event.headline}
                    </p>
                  ) : null}
                  <p>{opportunity.trigger}</p>
                  {opportunity.zone ? (
                    <small>
                      Zone{" "}
                      {formatPrice(opportunity.zone.low)}
                      {" – "}
                      {formatPrice(opportunity.zone.high)}
                    </small>
                  ) : null}
                </button>

                {idea ? (
                  <div className="scannerDerivativeIdeas">
                    {[idea.buy, idea.sell]
                      .filter(Boolean)
                      .map((sizing) => {
                        const item = sizing as OptionSizing;
                        return (
                          <button
                            type="button"
                            key={item.symbol + item.action}
                            onClick={() =>
                              openOption(item, opportunity)
                            }
                          >
                            <span>{item.action}</span>
                            <strong>
                              {item.strike} {item.optionType}
                            </strong>
                            <small>
                              ₹{formatPrice(item.ltp)} · lot{" "}
                              {item.lotSize ?? "?"}
                            </small>
                            <small>
                              {item.perLotCapital
                                ? (item.source === "FYERS_MARGIN"
                                    ? "Margin"
                                    : "1 lot") +
                                  " ₹" +
                                  Math.round(
                                    item.perLotCapital
                                  ).toLocaleString("en-IN")
                                : "Capital requirement unavailable"}
                            </small>
                            {capital > 0 ? (
                              <small>
                                {item.maxLots !== null
                                  ? item.maxLots +
                                    " lot(s) · qty " +
                                    (item.maxQuantity ?? 0)
                                  : "Capital insufficient / unavailable"}
                              </small>
                            ) : null}
                          </button>
                        );
                      })}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="scannerEmpty">
            <strong>
              {warming
                ? "Warming real market context…"
                : "No strong current opportunity"}
            </strong>
            <p>
              The panel stays empty rather than manufacturing a setup.
              Live sweeps and confluence will appear automatically.
            </p>
          </div>
        )}
      </div>

      {derivativeWatches.length ? (
        <div className="derivativeWatchSection">
          <div className="derivativeWatchTitle">
            DERIVATIVES WATCH · OPTIONS / FUTURES
          </div>
          {derivativeWatches.map((watch) => (
            <article
              className="derivativeWatchCard"
              key={watch.instrument.symbol}
            >
              <div className="scannerOpportunityTop">
                <div>
                  <strong>{watch.instrument.name}</strong>
                  <span>{watch.reason}</span>
                </div>
                <div
                  className={
                    "scannerDirection " + watch.direction
                  }
                >
                  {watch.direction === "bullish"
                    ? "BULLISH"
                    : "BEARISH"}
                </div>
              </div>
              <div className="scannerScoreRow">
                <span className="scannerState">DERIVATIVES WATCH</span>
                <b>{watch.score}/80</b>
                {watch.pcr !== null ? (
                  <span>PCR {watch.pcr.toFixed(2)}</span>
                ) : null}
              </div>

              {watch.futureSymbol ? (
                <button
                  type="button"
                  className="derivativeFutureButton"
                  onClick={() =>
                    onOpen({
                      symbol: watch.futureSymbol!,
                      name: watch.instrument.name + " FUTURE",
                      market: watch.instrument.market,
                      segment: "F&O",
                      type: "FUTURE",
                      underlying: watch.instrument.underlying,
                      expiry: null,
                      strike: null,
                      optionType: null
                    })
                  }
                >
                  FUTURE · {watch.futureSymbol}
                  {watch.futurePrice
                    ? " · " + formatPrice(watch.futurePrice)
                    : ""}
                </button>
              ) : null}

              {watch.idea ? (
                <div className="scannerDerivativeIdeas">
                  {[watch.idea.buy, watch.idea.sell]
                    .filter(Boolean)
                    .map((sizing) => {
                      const item = sizing as OptionSizing;
                      const fakeOpportunity: ScannerOpportunity = {
                        instrument: watch.instrument,
                        direction: watch.direction,
                        state: "WATCH",
                        score: watch.score,
                        price: watch.futurePrice ?? 0,
                        trigger: "Derivatives watch",
                        reason: watch.reason,
                        zone: null,
                        observedSweep: false,
                        updatedAt: watch.updatedAt
                      };

                      return (
                        <button
                          type="button"
                          key={item.symbol + item.action}
                          onClick={() =>
                            openOption(item, fakeOpportunity)
                          }
                        >
                          <span>{item.action}</span>
                          <strong>
                            {item.strike} {item.optionType}
                          </strong>
                          <small>
                            ₹{formatPrice(item.ltp)} · lot{" "}
                            {item.lotSize ?? "?"}
                          </small>
                          <small>
                            {item.perLotCapital
                              ? (item.source === "FYERS_MARGIN"
                                  ? "Margin"
                                  : "1 lot") +
                                " ₹" +
                                Math.round(
                                  item.perLotCapital
                                ).toLocaleString("en-IN")
                              : "Capital requirement unavailable"}
                          </small>
                          {capital > 0 ? (
                            <small>
                              {item.maxLots !== null
                                ? item.maxLots +
                                  " lot(s) · qty " +
                                  (item.maxQuantity ?? 0)
                                : "Capital insufficient / unavailable"}
                            </small>
                          ) : null}
                        </button>
                      );
                    })}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <div className="scannerFooter">
        <span>Ranks every 1s · India refresh ~20s</span>
        <span>Crypto live · options deep-scan ~5m</span>
      </div>
    </aside>
  );
}
