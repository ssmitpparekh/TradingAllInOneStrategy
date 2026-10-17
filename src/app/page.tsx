"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketChart, {
  type ChartCandle,
  type TradeChartMarker
} from "@/components/MarketChart";
import PwaInstallButton from "@/components/PwaInstallButton";
import OpportunityScanner from "@/components/OpportunityScanner";
import NewsImpactPanel from "@/components/NewsImpactPanel";
import { buildTechnicalContext } from "@/lib/analysis/indicators";
import { buildVolumeAnalytics } from "@/lib/analysis/volume";
import { buildReversalEngine } from "@/lib/analysis/confluence";
import { buildSimpleTradePlan } from "@/lib/analysis/trade-plan";
import { buildReactionTradePlan } from "@/lib/analysis/reaction-trade";
import {
  buildNewsGate,
  type NewsImpactEvent
} from "@/lib/news/impact";
import {
  buildOpeningConfirmation,
  indianSessionOpenEpoch,
  isIndianOpeningWindow
} from "@/lib/analysis/opening-confirmation";
import {
  makeTradeId,
  reconcileTradeWithCandles,
  summarizeTrades,
  updateTradeWithPrice,
  type JournalTrade
} from "@/lib/analysis/trade-journal";
import {
  orderFlowBucketStart,
  orderFlowPercentages,
  type OrderFlowBucket
} from "@/lib/analysis/order-flow";
import {
  calculateCandleClock,
  formatCountdown
} from "@/lib/market/candle-clock";
import {
  buildFibonacciSetup,
  buildImbalanceLiquiditySnapshot,
  buildMarketStructure,
  buildOrderBlockSnapshot
} from "@/lib/analysis/market-structure";

type Quote = {
  symbol: string;
  lp: number;
  ch: number;
  chp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  bid: number;
  ask: number;
};

type DerivativeLeg = {
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

type DerivativesData = {
  available: boolean;
  reason?: string;
  underlying?: string;
  future?: {
    symbol: string;
    expiry: number | null;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    oi: number | null;
    previousOi: number | null;
    oiChange: number | null;
    oiChangePercent: number | null;
    basis: number | null;
    basisPercent: number | null;
  } | null;
  options?: {
    callOi: number;
    putOi: number;
    pcr: number | null;
    indiaVix: number | null;
    futuresPrice: number | null;
    nearestExpiry: { date: string; expiry: number } | null;
    expiries: Array<{ date: string; expiry: number }>;
    atm: {
      strike: number | null;
      call: DerivativeLeg | null;
      put: DerivativeLeg | null;
    };
    callOiWalls: DerivativeLeg[];
    putOiWalls: DerivativeLeg[];
    callOiBuild: DerivativeLeg[];
    putOiBuild: DerivativeLeg[];
    callUnwinding: DerivativeLeg[];
    putUnwinding: DerivativeLeg[];
  } | null;
};

type Instrument = {
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
};

type Resolution =
  | "1" | "2" | "3" | "5" | "10" | "15" | "20" | "30" | "45"
  | "60" | "120" | "180" | "240" | "1D" | "1W" | "1M";

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";
type ThemeMode = "dark" | "light" | "system";

const DEFAULT_INSTRUMENT: Instrument = {
  symbol: "NSE:NIFTY50-INDEX",
  name: "NIFTY 50",
  market: "NSE",
  segment: "INDEX",
  type: "INDEX",
  underlying: "NIFTY50",
  expiry: null,
  strike: null,
  optionType: null
};

const RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1", label: "1m" },
  { value: "2", label: "2m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "10", label: "10m" },
  { value: "15", label: "15m" },
  { value: "20", label: "20m" },
  { value: "30", label: "30m" },
  { value: "45", label: "45m" },
  { value: "60", label: "1H" },
  { value: "120", label: "2H" },
  { value: "180", label: "3H" },
  { value: "240", label: "4H" },
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" }
];

const RANGES: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "MAX"];
const MARKET_FILTERS = ["ALL", "NSE", "BSE", "MCX", "KRAKEN"];
const TYPE_FILTERS = ["ALL", "INDEX", "EQUITY", "ETF", "SGB", "MF", "FUTURE", "OPTION", "COMMODITY", "CURRENCY", "CRYPTO"];

const LAST_VIEW_KEY = "allinoneview:last-view:v1";
const TRADE_JOURNAL_KEY = "allinoneview:trade-journal:v1";
const THEME_KEY = "allinoneview:theme:v1";

const KRAKEN_RESOLUTIONS = new Set<Resolution>([
  "1", "5", "15", "30", "60", "240", "1D", "1W"
]);

const LIVE_GLOBAL_SHORTCUTS: Instrument[] = [
  {
    symbol: "BTC/USD",
    name: "BTC / USD",
    market: "KRAKEN",
    segment: "SPOT",
    type: "CRYPTO",
    underlying: "BTC",
    expiry: null,
    strike: null,
    optionType: null
  },
  {
    symbol: "ETH/USD",
    name: "ETH / USD",
    market: "KRAKEN",
    segment: "SPOT",
    type: "CRYPTO",
    underlying: "ETH",
    expiry: null,
    strike: null,
    optionType: null
  },
  {
    symbol: "SOL/USD",
    name: "SOL / USD",
    market: "KRAKEN",
    segment: "SPOT",
    type: "CRYPTO",
    underlying: "SOL",
    expiry: null,
    strike: null,
    optionType: null
  }
];

function resolvePrimaryAnalysisSymbol(instrument: Instrument) {
  if (instrument.market === "KRAKEN") return instrument.symbol;
  if (instrument.market === "MCX") return instrument.symbol;
  if (instrument.type !== "FUTURE" && instrument.type !== "OPTION") {
    return instrument.symbol;
  }

  const underlying = instrument.underlying
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const known: Record<string, string> = {
    NIFTY: "NSE:NIFTY50-INDEX",
    NIFTY50: "NSE:NIFTY50-INDEX",
    BANKNIFTY: "NSE:NIFTYBANK-INDEX",
    NIFTYBANK: "NSE:NIFTYBANK-INDEX",
    FINNIFTY: "NSE:FINNIFTY-INDEX",
    MIDCPNIFTY: "NSE:NIFTYMIDSELECT-INDEX",
    SENSEX: "BSE:SENSEX-INDEX",
    BANKEX: "BSE:BANKEX-INDEX"
  };

  if (known[underlying]) return known[underlying];

  if (instrument.market === "NSE" && instrument.underlying) {
    return `NSE:${instrument.underlying.toUpperCase()}-EQ`;
  }

  return instrument.symbol;
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(timestamp * 1000));
}

function tradePieBackground(stats: ReturnType<typeof summarizeTrades>) {
  const total = Math.max(1, stats.total);
  const wins = (stats.wins / total) * 100;
  const losses = (stats.losses / total) * 100;
  const breakeven = (stats.breakeven / total) * 100;
  const ambiguous = (stats.ambiguous / total) * 100;
  const open = (stats.open / total) * 100;
  const stop1 = wins;
  const stop2 = stop1 + losses;
  const stop3 = stop2 + breakeven;
  const stop4 = stop3 + ambiguous;
  const stop5 = stop4 + open;

  return {
    background:
      "conic-gradient(" +
      "#28c76f 0% " +
      stop1 +
      "%, #ea5455 " +
      stop1 +
      "% " +
      stop2 +
      "%, #9ca8ba " +
      stop2 +
      "% " +
      stop3 +
      "%, #f5b942 " +
      stop3 +
      "% " +
      stop4 +
      "%, #4d8dff " +
      stop4 +
      "% " +
      stop5 +
      "%, #182230 " +
      stop5 +
      "% 100%)"
  };
}

function mergeLiveCandle(
  base: ChartCandle[],
  live: ChartCandle | null
) {
  if (!live) return base;

  const last = base[base.length - 1];

  if (!last) return [live];

  if (last.time === live.time) {
    return [...base.slice(0, -1), live];
  }

  if (live.time > last.time) {
    return [...base, live];
  }

  return base;
}

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Instrument>(DEFAULT_INSTRUMENT);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [resolution, setResolution] = useState<Resolution>("15");
  const [range, setRange] = useState<RangeKey>("1M");
  const [message, setMessage] = useState("Checking FYERS connection…");
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamMessage, setStreamMessage] = useState("Stream waiting…");
  const [socketDiagnostic, setSocketDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [historyMeta, setHistoryMeta] = useState<{ from: number | null; to: number | null; note: string | null }>({
    from: null,
    to: null,
    note: null
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchResults, setSearchResults] = useState<Instrument[]>([]);
  const [searching, setSearching] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [liveCandle, setLiveCandle] = useState<ChartCandle | null>(null);
  const [showFib, setShowFib] = useState(false);
  const [showTrendFib, setShowTrendFib] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [showFvg, setShowFvg] = useState(false);
  const [showLiquidity, setShowLiquidity] = useState(false);
  const [showOrderBlocks, setShowOrderBlocks] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [showSessionBreaks, setShowSessionBreaks] = useState(false);
  const [showOrderFlow, setShowOrderFlow] = useState(true);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const [orderFlowBuckets, setOrderFlowBuckets] = useState<OrderFlowBucket[]>([]);
  const [derivatives, setDerivatives] = useState<DerivativesData | null>(null);
  const [loadingDerivatives, setLoadingDerivatives] = useState(false);
  const [context4h, setContext4h] = useState<ChartCandle[]>([]);
  const [context1h, setContext1h] = useState<ChartCandle[]>([]);
  const [context15m, setContext15m] = useState<ChartCandle[]>([]);
  const [context5m, setContext5m] = useState<ChartCandle[]>([]);
  const [context1m, setContext1m] = useState<ChartCandle[]>([]);
  const [contextPrice, setContextPrice] = useState<number | null>(null);
  const [tradeJournal, setTradeJournal] = useState<JournalTrade[]>([]);
  const [journalReady, setJournalReady] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const [newsEvents, setNewsEvents] = useState<NewsImpactEvent[]>([]);
  const [newsConnected, setNewsConnected] = useState(false);
  const [newsXConfigured, setNewsXConfigured] = useState(false);
  const [newsXStreaming, setNewsXStreaming] = useState(false);
  const [tradeCapitalInput, setTradeCapitalInput] = useState("");
  const [selectedMarginPerLot, setSelectedMarginPerLot] =
    useState<number | null>(null);
  const historyRequestId = useRef(0);
  const orderFlowNeedsPartialRef = useRef(true);
  const orderFlowPartialBucketRef = useRef<number | null>(null);

  const selectedIsKraken = selected.market === "KRAKEN";
  const liveAnalysisCandles = useMemo(
    () => mergeLiveCandle(candles, liveCandle),
    [candles, liveCandle]
  );
  const latestOrderFlow =
    orderFlowBuckets[orderFlowBuckets.length - 1] ?? null;
  const latestOrderFlowStats = latestOrderFlow
    ? orderFlowPercentages(latestOrderFlow)
    : null;
  const currentCandleStart =
    liveCandle?.time ??
    candles[candles.length - 1]?.time ??
    null;
  const candleClock = useMemo(
    () =>
      calculateCandleClock({
        nowMs: clockNow,
        candleStart: currentCandleStart,
        resolution,
        market: selected.market
      }),
    [
      clockNow,
      currentCandleStart,
      resolution,
      selected.market
    ]
  );
  const primaryAnalysisSymbol = useMemo(
    () => resolvePrimaryAnalysisSymbol(selected),
    [selected]
  );
  const fibonacci = useMemo(
    () => buildFibonacciSetup(candles),
    [candles]
  );
  const structure = useMemo(
    () => buildMarketStructure(candles),
    [candles]
  );
  const imbalance = useMemo(
    () => buildImbalanceLiquiditySnapshot(liveAnalysisCandles),
    [liveAnalysisCandles]
  );
  const orderBlocks = useMemo(
    () => buildOrderBlockSnapshot(candles),
    [candles]
  );
  const volumeAnalytics = useMemo(
    () =>
      buildVolumeAnalytics(liveAnalysisCandles, {
        timeZone: selectedIsKraken ? "UTC" : "Asia/Kolkata",
        anchorTime: fibonacci.anchorA?.time ?? null
      }),
    [liveAnalysisCandles, selectedIsKraken, fibonacci.anchorA?.time]
  );
  const technicalContext = useMemo(
    () => buildTechnicalContext(liveAnalysisCandles),
    [liveAnalysisCandles]
  );
  const closedContext1m = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return context1m.filter((candle) => candle.time + 60 <= now);
  }, [context1m]);

  const closedContext5m = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return context5m.filter((candle) => candle.time + 5 * 60 <= now);
  }, [context5m]);

  const fastLatestTime =
    closedContext1m[closedContext1m.length - 1]?.time ??
    closedContext5m[closedContext5m.length - 1]?.time ??
    null;
  const openingSessionStart = useMemo(() => {
    if (
      fastLatestTime === null ||
      (selected.market !== "NSE" && selected.market !== "BSE") ||
      !isIndianOpeningWindow(fastLatestTime)
    ) {
      return null;
    }

    return indianSessionOpenEpoch(fastLatestTime);
  }, [fastLatestTime, selected.market]);

  const planContext4h = useMemo(() => {
    if (openingSessionStart === null) return context4h;
    const prior = context4h.filter(
      (candle) => candle.time < openingSessionStart
    );
    return prior.length >= 30 ? prior : context4h;
  }, [context4h, openingSessionStart]);

  const planContext1h = useMemo(() => {
    if (openingSessionStart === null) return context1h;
    const prior = context1h.filter(
      (candle) => candle.time < openingSessionStart
    );
    return prior.length >= 30 ? prior : context1h;
  }, [context1h, openingSessionStart]);

  const htfTechnical = useMemo(
    () => buildTechnicalContext(planContext4h),
    [planContext4h]
  );
  const htfFib = useMemo(
    () => buildFibonacciSetup(planContext4h),
    [planContext4h]
  );
  const htfStructure = useMemo(
    () => buildMarketStructure(planContext4h),
    [planContext4h]
  );
  const refineFib = useMemo(
    () => buildFibonacciSetup(planContext1h),
    [planContext1h]
  );
  const refineImbalance = useMemo(
    () => buildImbalanceLiquiditySnapshot(planContext1h),
    [planContext1h]
  );
  const refineOrderBlocks = useMemo(
    () => buildOrderBlockSnapshot(planContext1h),
    [planContext1h]
  );
  const refineVolume = useMemo(
    () =>
      buildVolumeAnalytics(planContext1h, {
        timeZone: selectedIsKraken ? "UTC" : "Asia/Kolkata",
        anchorTime: htfFib.anchorA?.time ?? null
      }),
    [planContext1h, selectedIsKraken, htfFib.anchorA?.time]
  );
  const liveContext15m = useMemo(() => {
    const canUseSelectedLive =
      resolution === "15" &&
      selected.symbol === primaryAnalysisSymbol &&
      liveCandle !== null;

    return canUseSelectedLive
      ? mergeLiveCandle(context15m, liveCandle)
      : context15m;
  }, [
    context15m,
    liveCandle,
    primaryAnalysisSymbol,
    resolution,
    selected.symbol
  ]);

  const confirmation15m = useMemo(
    () => buildMarketStructure(liveContext15m),
    [liveContext15m]
  );
  const structure5m = useMemo(
    () => buildMarketStructure(closedContext5m, { confirmationBars: 2 }),
    [closedContext5m]
  );
  const structure1m = useMemo(
    () => buildMarketStructure(closedContext1m, { confirmationBars: 2 }),
    [closedContext1m]
  );
  const imbalance5m = useMemo(
    () => buildImbalanceLiquiditySnapshot(closedContext5m),
    [closedContext5m]
  );
  const imbalance1m = useMemo(
    () => buildImbalanceLiquiditySnapshot(closedContext1m),
    [closedContext1m]
  );
  const orderBlocks5m = useMemo(
    () => buildOrderBlockSnapshot(closedContext5m),
    [closedContext5m]
  );
  const reversalEngine = useMemo(
    () =>
      buildReversalEngine({
        price:
          contextPrice ??
          context1h[context1h.length - 1]?.close ??
          quote?.lp ??
          0,
        htfAtr: htfFib.atr14,
        refineAtr: refineFib.atr14,
        htfReady: planContext4h.length >= 30,
        confirmation15mReady: context15m.length >= 30,
        fibonacci: htfFib,
        structure: htfStructure,
        imbalance: refineImbalance,
        orderBlocks: refineOrderBlocks,
        volume: refineVolume,
        confirmation15m,
        derivatives: derivatives
          ? {
              available: derivatives.available,
              future: derivatives.future
                ? {
                    change: derivatives.future.change,
                    oiChange: derivatives.future.oiChange,
                    oiChangePercent:
                      derivatives.future.oiChangePercent
                  }
                : null,
              options: derivatives.options
                ? {
                    pcr: derivatives.options.pcr,
                    callOiBuild: derivatives.options.callOiBuild,
                    putOiBuild: derivatives.options.putOiBuild
                  }
                : null
            }
          : null
      }),
    [
      contextPrice,
      context1h,
      planContext4h,
      context15m,
      quote?.lp,
      htfFib,
      refineFib.atr14,
      htfStructure,
      refineImbalance,
      refineOrderBlocks,
      refineVolume,
      confirmation15m,
      derivatives
    ]
  );

  const openingConfirmation = useMemo(
    () =>
      buildOpeningConfirmation({
        market: selected.market,
        latestTime: fastLatestTime,
        direction: reversalEngine.selected.direction,
        structure1m,
        structure5m,
        imbalance1m,
        imbalance5m,
        orderBlocks5m
      }),
    [
      selected.market,
      fastLatestTime,
      reversalEngine.selected.direction,
      structure1m,
      structure5m,
      imbalance1m,
      imbalance5m,
      orderBlocks5m
    ]
  );

  const simpleTradePlan = useMemo(
    () =>
      buildSimpleTradePlan({
        price:
          contextPrice ??
          context1h[context1h.length - 1]?.close ??
          quote?.lp ??
          0,
        latestTime:
          fastLatestTime ??
          context1h[context1h.length - 1]?.time ??
          null,
        htfTechnical,
        htfStructure,
        fibonacci: htfFib,
        imbalance: refineImbalance,
        orderBlocks: refineOrderBlocks,
        reversal: reversalEngine.selected,
        refineAtr: refineFib.atr14,
        openingConfirmation,
        confirmation15m
      }),
    [
      contextPrice,
      context1h,
      fastLatestTime,
      quote?.lp,
      htfTechnical,
      htfStructure,
      htfFib,
      refineImbalance,
      refineOrderBlocks,
      reversalEngine.selected,
      refineFib.atr14,
      openingConfirmation,
      confirmation15m
    ]
  );

  const reactionImbalance15m = useMemo(
    () => buildImbalanceLiquiditySnapshot(liveContext15m),
    [liveContext15m]
  );
  const reactionFib15m = useMemo(
    () => buildFibonacciSetup(liveContext15m),
    [liveContext15m]
  );
  const reactionTradePlan = useMemo(
    () =>
      buildReactionTradePlan({
        price:
          primaryAnalysisSymbol === selected.symbol
            ? quote?.lp ?? contextPrice ?? 0
            : contextPrice ?? 0,
        candles15m: liveContext15m,
        imbalance15m: reactionImbalance15m,
        structure15m: confirmation15m,
        primaryPlan: simpleTradePlan,
        atr15m: reactionFib15m.atr14
      }),
    [
      primaryAnalysisSymbol,
      selected.symbol,
      quote?.lp,
      contextPrice,
      liveContext15m,
      reactionImbalance15m,
      confirmation15m,
      simpleTradePlan,
      reactionFib15m.atr14
    ]
  );

  const newsGate = useMemo(
    () =>
      buildNewsGate({
        events: newsEvents,
        symbol: primaryAnalysisSymbol,
        market: selected.market
      }),
    [newsEvents, primaryAnalysisSymbol, selected.market]
  );

  const newsDirectionConflictsPrimary =
    newsGate.direction !== "unknown" &&
    simpleTradePlan.trend !== "neutral" &&
    newsGate.direction !== simpleTradePlan.trend;

  const primaryNewsBlocked =
    newsGate.blocked ||
    (newsGate.riskLevel === "HIGH" &&
      newsGate.confidence >= 75 &&
      newsDirectionConflictsPrimary);

  const reactionNewsBlocked =
    newsGate.blocked ||
    (newsGate.riskLevel === "HIGH" &&
      newsGate.confidence >= 75 &&
      reactionTradePlan.direction !== null &&
      newsGate.direction !== "unknown" &&
      newsGate.direction !== reactionTradePlan.direction);

  const tradeCapital = Math.max(
    0,
    Number(tradeCapitalInput || 0)
  );
  const activePlannerPlan =
    !reactionNewsBlocked &&
    reactionTradePlan.state === "READY" &&
    reactionTradePlan.entry !== null &&
    reactionTradePlan.stopLoss !== null
      ? {
          setup: "REACTION" as const,
          moveClass: reactionTradePlan.moveClass,
          direction: reactionTradePlan.direction,
          entry: reactionTradePlan.entry,
          stopLoss: reactionTradePlan.stopLoss,
          targets: reactionTradePlan.targets
        }
      : !primaryNewsBlocked &&
          simpleTradePlan.state === "READY" &&
          simpleTradePlan.entry !== null &&
          simpleTradePlan.stopLoss !== null
        ? {
            setup: "PRIMARY" as const,
            moveClass: simpleTradePlan.moveClass,
            direction: simpleTradePlan.trend,
            entry: simpleTradePlan.entry,
            stopLoss: simpleTradePlan.stopLoss,
            targets: simpleTradePlan.targets
          }
        : null;

  const selectedLotSize =
    selected.lotSize && selected.lotSize > 0
      ? selected.lotSize
      : null;
  const capitalCurrency =
    selected.market === "KRAKEN" ? "$" : "₹";
  const selectedLivePrice =
    quote?.lp && quote.lp > 0 ? quote.lp : null;
  const planMatchesSelectedPrice =
    primaryAnalysisSymbol === selected.symbol;
  const isDerivative =
    selected.type === "OPTION" || selected.type === "FUTURE";

  const optionBuyCostPerLot =
    selected.type === "OPTION" &&
    selectedLotSize &&
    selectedLivePrice
      ? selectedLivePrice * selectedLotSize
      : null;
  const maxBuyLots =
    optionBuyCostPerLot && tradeCapital > 0
      ? Math.floor(tradeCapital / optionBuyCostPerLot)
      : null;
  const maxMarginLots =
    selectedMarginPerLot && tradeCapital > 0
      ? Math.floor(tradeCapital / selectedMarginPerLot)
      : null;

  const cashSizingPrice =
    !isDerivative
      ? activePlannerPlan?.entry ?? selectedLivePrice
      : null;
  const affordableUnits =
    tradeCapital > 0 && cashSizingPrice && cashSizingPrice > 0
      ? selected.market === "KRAKEN"
        ? tradeCapital / cashSizingPrice
        : Math.floor(tradeCapital / cashSizingPrice)
      : null;
  const deployedCapital =
    affordableUnits !== null && cashSizingPrice
      ? affordableUnits * cashSizingPrice
      : null;

  const derivativeLots =
    selected.type === "OPTION"
      ? maxBuyLots
      : selected.type === "FUTURE"
        ? maxMarginLots
        : null;
  const derivativeQuantity =
    derivativeLots !== null && selectedLotSize
      ? derivativeLots * selectedLotSize
      : null;

  const sizedQuantity =
    !isDerivative
      ? affordableUnits
      : planMatchesSelectedPrice
        ? derivativeQuantity
        : null;

  const moneyRiskAtStop =
    activePlannerPlan &&
    sizedQuantity !== null &&
    sizedQuantity > 0 &&
    planMatchesSelectedPrice
      ? Math.abs(
          activePlannerPlan.entry - activePlannerPlan.stopLoss
        ) * sizedQuantity
      : null;

  const targetMoney = (label: "T1" | "T2" | "T3") => {
    const target = activePlannerPlan?.targets.find(
      (item) => item.label === label
    );

    if (
      !activePlannerPlan ||
      !target ||
      sizedQuantity === null ||
      !(sizedQuantity > 0) ||
      !planMatchesSelectedPrice
    ) {
      return null;
    }

    return (
      Math.abs(target.price - activePlannerPlan.entry) *
      sizedQuantity
    );
  };

  const t1Money = targetMoney("T1");
  const t2Money = targetMoney("T2");
  const t3Money = targetMoney("T3");

  const analysisTrades = useMemo(
    () =>
      tradeJournal.filter(
        (trade) => trade.symbol === primaryAnalysisSymbol
      ),
    [tradeJournal, primaryAnalysisSymbol]
  );
  const chartTrades = useMemo(
    () =>
      tradeJournal.filter(
        (trade) => trade.symbol === selected.symbol
      ),
    [tradeJournal, selected.symbol]
  );
  const overallTradeStats = useMemo(
    () => summarizeTrades(tradeJournal),
    [tradeJournal]
  );
  const symbolTradeStats = useMemo(
    () => summarizeTrades(analysisTrades),
    [analysisTrades]
  );
  const tradeMarkers = useMemo<TradeChartMarker[]>(
    () =>
      chartTrades.map((trade) => ({
        id: trade.id,
        time: trade.signalTime,
        price: trade.entry,
        direction: trade.direction,
        status: trade.status,
        outcome: trade.outcome,
        setupType: trade.setupType ?? "PRIMARY",
        moveClass: trade.moveClass ?? "TACTICAL"
      })),
    [chartTrades]
  );

  async function fetchAnalysisContext(signal?: AbortSignal) {
    if (!selectedIsKraken && !connected) {
      setContext4h([]);
      setContext1h([]);
      setContext15m([]);
      setContext5m([]);
      setContext1m([]);
      setContextPrice(null);
      return;
    }

    setLoadingContext(true);

    try {
      const endpoint =
        selectedIsKraken
          ? "/api/kraken/history"
          : "/api/fyers/history";
      const quoteEndpoint =
        selectedIsKraken
          ? "/api/kraken/quote"
          : "/api/fyers/quote";

      const historyRequest = (
        resolutionValue: string,
        rangeValue: string
      ) =>
        fetch(
          `${endpoint}?symbol=${encodeURIComponent(primaryAnalysisSymbol)}&resolution=${encodeURIComponent(resolutionValue)}&range=${encodeURIComponent(rangeValue)}`,
          { cache: "no-store", signal }
        ).then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.ok) {
            throw new Error(
              data.error || "Unable to load analysis context."
            );
          }
          return data.candles as ChartCandle[];
        });

      const [h4, h1, m15, m5, m1, priceResponse] = await Promise.all([
        historyRequest("240", "6M"),
        historyRequest("60", "3M"),
        historyRequest("15", "1M"),
        historyRequest("5", "5D"),
        historyRequest("1", "5D"),
        fetch(
          `${quoteEndpoint}?symbol=${encodeURIComponent(primaryAnalysisSymbol)}`,
          { cache: "no-store", signal }
        ).then((response) => response.json())
      ]);

      if (signal?.aborted) return;

      setContext4h(h4);
      setContext1h(h1);
      setContext15m(m15);
      setContext5m(m5);
      setContext1m(m1);
      setContextPrice(
        priceResponse?.ok
          ? Number(priceResponse.quote?.lp ?? 0) || null
          : h1[h1.length - 1]?.close ?? null
      );
    } catch {
      if (signal?.aborted) return;
      setContext4h([]);
      setContext1h([]);
      setContext15m([]);
      setContext5m([]);
      setContext1m([]);
      setContextPrice(null);
    } finally {
      if (!signal?.aborted) setLoadingContext(false);
    }
  }

  async function fetchFastOpeningContext(
    signal?: AbortSignal
  ) {
    if (
      !viewReady ||
      !connected ||
      (selected.market !== "NSE" && selected.market !== "BSE")
    ) {
      return;
    }

    try {
      const endpoint = "/api/fyers/history";
      const request = (resolutionValue: string) =>
        fetch(
          endpoint +
            "?symbol=" +
            encodeURIComponent(primaryAnalysisSymbol) +
            "&resolution=" +
            encodeURIComponent(resolutionValue) +
            "&range=5D",
          { cache: "no-store", signal }
        ).then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.ok) {
            throw new Error("Unable to refresh fast opening context.");
          }
          return data.candles as ChartCandle[];
        });

      const [m1, m5] = await Promise.all([
        request("1"),
        request("5")
      ]);

      if (signal?.aborted) return;
      setContext1m(m1);
      setContext5m(m5);
    } catch {
      // Fast opening refresh failure must not destroy the slower context.
    }
  }

  async function fetchDerivatives(
    silent = false,
    signal?: AbortSignal
  ) {
    if (!viewReady || selectedIsKraken || !connected) {
      setDerivatives(null);
      return;
    }

    if (!silent) setLoadingDerivatives(true);

    try {
      const params = new URLSearchParams({
        symbol: selected.symbol,
        market: selected.market,
        type: selected.type,
        underlying: selected.underlying || "",
        spotPrice: String(
          contextPrice ??
            (primaryAnalysisSymbol === selected.symbol
              ? quote?.lp ?? 0
              : 0)
        )
      });

      const response = await fetch(
        `/api/fyers/derivatives?${params.toString()}`,
        { cache: "no-store", signal }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "Unable to load derivatives confirmation."
        );
      }

      setDerivatives(data);
    } catch (error) {
      if (signal?.aborted) return;

      setDerivatives({
        available: false,
        reason:
          error instanceof Error
            ? error.message
            : "Unable to load derivatives confirmation."
      });
    } finally {
      if (!signal?.aborted && !silent) {
        setLoadingDerivatives(false);
      }
    }
  }

  async function refreshStatus() {
    try {
      const response = await fetch("/api/fyers/status", { cache: "no-store" });
      const data = await response.json();
      const isConnected = Boolean(data.connected);
      setConnected(isConnected);
      setMessage(
        isConnected
          ? "FYERS connected. Market-data access is ready."
          : "FYERS is not connected yet."
      );
    } catch {
      setConnected(false);
      setMessage("Unable to read FYERS connection status.");
    }
  }

  async function fetchQuote(
    silent = false,
    symbol = selected.symbol,
    market = selected.market
  ) {
    if (!silent) setLoadingQuote(true);

    try {
      const endpoint =
        market === "KRAKEN"
          ? "/api/kraken/quote"
          : "/api/fyers/quote";

      const response = await fetch(
        `${endpoint}?symbol=${encodeURIComponent(symbol)}`,
        { cache: "no-store" }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Quote request failed.");
      }

      setQuote(data.quote);
      if (market !== "KRAKEN") {
        setConnected(true);
      }
      if (!silent) {
        setMessage(
          `${market === "KRAKEN" ? "Kraken" : "FYERS"} quote received successfully.`
        );
      }
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "Unable to fetch the quote.");
      }
    } finally {
      if (!silent) setLoadingQuote(false);
    }
  }

  async function fetchHistory(
    nextResolution = resolution,
    nextRange = range,
    symbol = selected.symbol,
    signal?: AbortSignal,
    market = selected.market
  ) {
    const requestId = ++historyRequestId.current;
    setLoadingChart(true);
    setHistoryError(null);
    setCandles([]);
    setHistoryMeta({ from: null, to: null, note: null });

    try {
      const endpoint =
        market === "KRAKEN"
          ? "/api/kraken/history"
          : "/api/fyers/history";

      const response = await fetch(
        `${endpoint}?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(nextResolution)}&range=${encodeURIComponent(nextRange)}`,
        { cache: "no-store", signal }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Historical candle request failed.");
      }

      if (requestId !== historyRequestId.current || signal?.aborted) return;

      setCandles(data.candles);
      setHistoryMeta({
        from: data.candles?.[0]?.time ?? data.from ?? null,
        to: data.candles?.[data.candles.length - 1]?.time ?? data.to ?? null,
        note: data.appliedLimit ?? data.note ?? null
      });
    } catch (error) {
      if (signal?.aborted) return;
      const detail =
        error instanceof Error ? error.message : "Unable to load candles.";
      if (requestId === historyRequestId.current) {
        setHistoryError(detail);
        setMessage(detail);
      }
    } finally {
      if (requestId === historyRequestId.current && !signal?.aborted) {
        setLoadingChart(false);
      }
    }
  }

  async function selectInstrument(instrument: Instrument) {
    setSelected(instrument);
    setSearchQuery("");
    setSearchResults([]);
    setQuote(null);
    setCandles([]);
    setLiveCandle(null);
    setOrderFlowBuckets([]);
    orderFlowNeedsPartialRef.current = true;
    orderFlowPartialBucketRef.current = null;
    setHistoryMeta({ from: null, to: null, note: null });
    setTradeCapitalInput("");
    setSelectedMarginPerLot(null);
    setFitNonce((value) => value + 1);

    if (
      instrument.market === "KRAKEN" &&
      !KRAKEN_RESOLUTIONS.has(resolution)
    ) {
      setResolution("15");
    }
  }

  function resetChartView() {
    setShowFib(false);
    setShowTrendFib(false);
    setShowStructure(false);
    setShowFvg(false);
    setShowLiquidity(false);
    setShowOrderBlocks(false);
    setShowVwap(false);
    setShowProfile(false);
    setShowEma(false);
    setShowSessionBreaks(false);
    setShowOrderFlow(true);
    setShowAdvancedAnalysis(false);
    setFitNonce((value) => value + 1);
    setMessage("Chart reset to the clean default view.");
  }

  async function toggleFullscreen() {
    const terminal = document.getElementById("market-terminal");
    if (!terminal) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await terminal.requestFullscreen();
      }
    } catch {
      setMessage("Your browser blocked fullscreen mode.");
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_VIEW_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          selected?: Instrument;
          resolution?: Resolution;
          range?: RangeKey;
        };

        if (
          parsed.selected?.symbol &&
          parsed.selected?.market &&
          parsed.selected?.name
        ) {
          setSelected(parsed.selected);
        }

        if (
          parsed.resolution &&
          RESOLUTIONS.some((item) => item.value === parsed.resolution)
        ) {
          setResolution(parsed.resolution);
        }

        if (parsed.range && RANGES.includes(parsed.range)) {
          setRange(parsed.range);
        }
      }
    } catch {
      // Ignore corrupt local view state and use the safe default.
    } finally {
      setViewReady(true);
    }
  }, []);

  useEffect(() => {
    if (!viewReady) return;

    window.localStorage.setItem(
      LAST_VIEW_KEY,
      JSON.stringify({
        selected,
        resolution,
        range
      })
    );
  }, [viewReady, selected, resolution, range]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TRADE_JOURNAL_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTradeJournal(parsed as JournalTrade[]);
        }
      }
    } catch {
      // A corrupt local journal must not break the market terminal.
    } finally {
      setJournalReady(true);
    }
  }, []);

  useEffect(() => {
    if (!journalReady) return;
    window.localStorage.setItem(
      TRADE_JOURNAL_KEY,
      JSON.stringify(tradeJournal)
    );
  }, [journalReady, tradeJournal]);

  useEffect(() => {
    if (
      !journalReady ||
      primaryNewsBlocked ||
      simpleTradePlan.state !== "READY" ||
      simpleTradePlan.signalTime === null ||
      simpleTradePlan.confirmationTimeframe === null ||
      simpleTradePlan.entry === null ||
      simpleTradePlan.stopLoss === null ||
      !simpleTradePlan.trigger ||
      simpleTradePlan.targets.length < 3
    ) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const maxSignalAge =
      simpleTradePlan.confirmationTimeframe === "1m"
        ? 3 * 60
        : simpleTradePlan.confirmationTimeframe === "5m"
          ? 12 * 60
          : 35 * 60;

    if (now - simpleTradePlan.signalTime > maxSignalAge) {
      return;
    }

    const direction =
      simpleTradePlan.trend === "bullish" ? "long" : "short";
    const id = makeTradeId({
      market: selected.market,
      symbol: primaryAnalysisSymbol,
      setupType: "PRIMARY",
      direction,
      signalTime: simpleTradePlan.signalTime
    });

    setTradeJournal((current) => {
      if (current.some((trade) => trade.id === id)) return current;

      const record: JournalTrade = {
        id,
        symbol: primaryAnalysisSymbol,
        name:
          primaryAnalysisSymbol === selected.symbol
            ? selected.name
            : primaryAnalysisSymbol,
        market: selected.market,
        setupType: "PRIMARY",
        moveClass: simpleTradePlan.moveClass ?? "TACTICAL",
        direction,
        signalTime: simpleTradePlan.signalTime!,
        confirmationTimeframe:
          simpleTradePlan.confirmationTimeframe!,
        entry: simpleTradePlan.entry!,
        initialStop: simpleTradePlan.stopLoss!,
        currentStop: simpleTradePlan.stopLoss!,
        targets: simpleTradePlan.targets.slice(0, 3),
        trigger: simpleTradePlan.trigger!,
        score: simpleTradePlan.score,
        status: "OPEN",
        outcome: "OPEN",
        highestTargetHit: 0,
        resultR: null,
        closedTime: null,
        ambiguityReason: null,
        createdAt: Date.now()
      };

      return [...current, record];
    });
  }, [
    journalReady,
    primaryNewsBlocked,
    simpleTradePlan,
    selected.market,
    selected.name,
    selected.symbol,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    if (
      !journalReady ||
      reactionNewsBlocked ||
      reactionTradePlan.state !== "READY" ||
      reactionTradePlan.direction === null ||
      reactionTradePlan.signalTime === null ||
      reactionTradePlan.entry === null ||
      reactionTradePlan.stopLoss === null ||
      !reactionTradePlan.trigger ||
      reactionTradePlan.targets.length < 3
    ) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    if (now - reactionTradePlan.signalTime > 35 * 60) {
      return;
    }

    const direction =
      reactionTradePlan.direction === "bullish" ? "long" : "short";

    const id = makeTradeId({
      market: selected.market,
      symbol: primaryAnalysisSymbol,
      setupType: "REACTION",
      direction,
      signalTime: reactionTradePlan.signalTime
    });

    setTradeJournal((current) => {
      if (current.some((trade) => trade.id === id)) return current;

      const record: JournalTrade = {
        id,
        symbol: primaryAnalysisSymbol,
        name:
          primaryAnalysisSymbol === selected.symbol
            ? selected.name
            : primaryAnalysisSymbol,
        market: selected.market,
        setupType: "REACTION",
        moveClass: reactionTradePlan.moveClass ?? "TACTICAL",
        direction,
        signalTime: reactionTradePlan.signalTime!,
        confirmationTimeframe: "15m",
        entry: reactionTradePlan.entry!,
        initialStop: reactionTradePlan.stopLoss!,
        currentStop: reactionTradePlan.stopLoss!,
        targets: reactionTradePlan.targets.slice(0, 3),
        trigger: reactionTradePlan.trigger!,
        score: reactionTradePlan.score,
        status: "OPEN",
        outcome: "OPEN",
        highestTargetHit: 0,
        resultR: null,
        closedTime: null,
        ambiguityReason: null,
        createdAt: Date.now()
      };

      return [...current, record];
    });
  }, [
    journalReady,
    reactionNewsBlocked,
    reactionTradePlan,
    selected.market,
    selected.name,
    selected.symbol,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    if (!journalReady || !quote?.lp || !(quote.lp > 0)) return;

    const now = Math.floor(Date.now() / 1000);
    const symbol = selected.symbol;

    setTradeJournal((current) => {
      let changed = false;
      const next = current.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "OPEN") {
          return trade;
        }

        const updated = updateTradeWithPrice(trade, quote.lp, now);
        if (
          updated.status !== trade.status ||
          updated.highestTargetHit !== trade.highestTargetHit ||
          updated.currentStop !== trade.currentStop
        ) {
          changed = true;
        }
        return updated;
      });

      return changed ? next : current;
    });
  }, [journalReady, quote?.lp, selected.symbol]);

  useEffect(() => {
    if (
      !journalReady ||
      closedContext1m.length === 0 ||
      !primaryAnalysisSymbol
    ) {
      return;
    }

    setTradeJournal((current) => {
      let changed = false;

      const next = current.map((trade) => {
        if (
          trade.symbol !== primaryAnalysisSymbol ||
          trade.status !== "OPEN"
        ) {
          return trade;
        }

        const relevant = closedContext1m.filter(
          (candle) => candle.time >= trade.signalTime
        );
        if (!relevant.length) return trade;

        const updated = reconcileTradeWithCandles(
          trade,
          relevant
        );

        if (
          updated.status !== trade.status ||
          updated.highestTargetHit !== trade.highestTargetHit ||
          updated.currentStop !== trade.currentStop ||
          updated.outcome !== trade.outcome
        ) {
          changed = true;
        }

        return updated;
      });

      return changed ? next : current;
    });
  }, [
    journalReady,
    closedContext1m,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    setSelectedMarginPerLot(null);

    if (
      !connected ||
      (selected.type !== "OPTION" &&
        selected.type !== "FUTURE") ||
      !selected.lotSize ||
      selected.lotSize <= 0
    ) {
      return;
    }

    const controller = new AbortController();

    void fetch("/api/fyers/margin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: selected.symbol,
        qty: selected.lotSize,
        side:
          selected.type === "OPTION"
            ? -1
            : activePlannerPlan?.direction === "bearish"
              ? -1
              : 1,
        productType: "MARGIN"
      }),
      signal: controller.signal
    })
      .then((response) => response.json())
      .then((data) => {
        if (
          !controller.signal.aborted &&
          data?.ok &&
          Number(data.marginTotal) > 0
        ) {
          setSelectedMarginPerLot(Number(data.marginTotal));
        }
      })
      .catch(() => {
        // Margin is optional. Do not estimate it when FYERS cannot return it.
      });

    return () => controller.abort();
  }, [
    connected,
    selected.symbol,
    selected.type,
    selected.lotSize,
    activePlannerPlan?.direction
  ]);

  useEffect(() => {
    const source = new EventSource("/api/news/stream");

    source.addEventListener("status", (event) => {
      try {
        const payload = JSON.parse(
          (event as MessageEvent<string>).data
        ) as {
          connected?: boolean;
          xConfigured?: boolean;
          xStreaming?: boolean;
        };

        setNewsConnected(Boolean(payload.connected));
        setNewsXConfigured(Boolean(payload.xConfigured));
        setNewsXStreaming(Boolean(payload.xStreaming));
      } catch {
        setNewsConnected(false);
      }
    });

    source.addEventListener("news", (event) => {
      try {
        const item = JSON.parse(
          (event as MessageEvent<string>).data
        ) as NewsImpactEvent;

        if (!item?.id || !item.headline) return;

        setNewsEvents((current) => {
          const next = [
            item,
            ...current.filter(
              (existing) => existing.id !== item.id
            )
          ]
            .filter(
              (candidate) =>
                candidate.expiresAt > Date.now() - 24 * 60 * 60_000
            )
            .sort((a, b) => b.receivedAt - a.receivedAt)
            .slice(0, 250);

          return next;
        });
      } catch {
        // Ignore malformed external news events.
      }
    });

    source.onerror = () => {
      setNewsConnected(false);
    };

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    const initialMode: ThemeMode =
      saved === "dark" || saved === "light" || saved === "system"
        ? saved
        : "system";

    setThemeMode(initialMode);

    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (mode: ThemeMode) => {
      const next =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
      setResolvedTheme(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.dataset.themeMode = mode;
    };

    apply(initialMode);

    const onChange = () => {
      if (initialMode === "system") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, themeMode);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const next =
      themeMode === "system"
        ? media.matches
          ? "dark"
          : "light"
        : themeMode;

    setResolvedTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.themeMode = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    void refreshStatus();

    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!viewReady || (!selectedIsKraken && !connected)) return;

    const controller = new AbortController();

    void fetchQuote(true, selected.symbol, selected.market);
    void fetchHistory(
      resolution,
      range,
      selected.symbol,
      controller.signal,
      selected.market
    );

    return () => controller.abort();
  }, [
    viewReady,
    connected,
    selected.symbol,
    selected.market,
    selectedIsKraken,
    resolution,
    range
  ]);

  useEffect(() => {
    if (!viewReady || (!selectedIsKraken && !connected)) return;

    setLiveCandle(null);
    setOrderFlowBuckets([]);
    orderFlowNeedsPartialRef.current = true;
    orderFlowPartialBucketRef.current = null;

    if (!selectedIsKraken) {
      void fetch("/api/fyers/socket-diagnostic", { cache: "no-store" })
        .then((response) => response.json())
        .then((data) => setSocketDiagnostic(data))
        .catch(() =>
          setSocketDiagnostic({
            ok: false,
            problem: "Diagnostic request failed."
          })
        );
    }

    const endpoint = selectedIsKraken
      ? `/api/kraken/stream?symbol=${encodeURIComponent(selected.symbol)}&resolution=${encodeURIComponent(resolution)}`
      : `/api/fyers/stream?symbol=${encodeURIComponent(selected.symbol)}`;

    const source = new EventSource(endpoint);

    const onStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamConnected(Boolean(payload.connected));
        setStreamMessage(
          payload.connected
            ? `Live: ${selected.symbol}`
            : payload.opening
              ? `Opening ${selectedIsKraken ? "Kraken" : "FYERS"} stream…`
              : payload.error ||
                `${selectedIsKraken ? "Kraken" : "FYERS"} stream disconnected`
        );
      } catch {
        setStreamConnected(false);
        setStreamMessage("Unable to read stream status.");
      }
    };

    const onFyersTick = (event: MessageEvent<string>) => {
      try {
        const tick = JSON.parse(event.data);
        if (tick.symbol && tick.symbol !== selected.symbol) return;

        if (typeof tick.ltp === "number") {
          setQuote((current) =>
            current
              ? {
                  ...current,
                  lp: tick.ltp,
                  ch: typeof tick.ch === "number" ? tick.ch : current.ch,
                  chp: typeof tick.chp === "number" ? tick.chp : current.chp,
                  open:
                    typeof tick.open_price === "number"
                      ? tick.open_price
                      : current.open,
                  high:
                    typeof tick.high_price === "number"
                      ? tick.high_price
                      : current.high,
                  low:
                    typeof tick.low_price === "number"
                      ? tick.low_price
                      : current.low,
                  previousClose:
                    typeof tick.prev_close_price === "number"
                      ? tick.prev_close_price
                      : current.previousClose,
                  volume:
                    typeof tick.vol_traded_today === "number"
                      ? tick.vol_traded_today
                      : current.volume,
                  bid: typeof tick.bid === "number" ? tick.bid : current.bid,
                  ask: typeof tick.ask === "number" ? tick.ask : current.ask
                }
              : current
          );
        }
      } catch {
        // Keep last good quote.
      }
    };

    const onKrakenTicker = (event: MessageEvent<string>) => {
      try {
        const tick = JSON.parse(event.data);
        if (tick.symbol && tick.symbol !== selected.symbol) return;

        const last = Number(tick.last ?? 0);
        const change = Number(tick.change ?? 0);
        const changePct = Number(tick.change_pct ?? 0);

        setQuote((current) => ({
          symbol: selected.symbol,
          lp: last || current?.lp || 0,
          ch: change,
          chp: changePct,
          open:
            current?.open ||
            (last && Number.isFinite(change) ? last - change : 0),
          high: Number(tick.high ?? current?.high ?? 0),
          low: Number(tick.low ?? current?.low ?? 0),
          previousClose:
            current?.previousClose ||
            (last && Number.isFinite(change) ? last - change : 0),
          volume: Number(tick.volume ?? current?.volume ?? 0),
          bid: Number(tick.bid ?? current?.bid ?? 0),
          ask: Number(tick.ask ?? current?.ask ?? 0)
        }));
      } catch {
        // Keep last good quote.
      }
    };

    const onKrakenTrade = (event: MessageEvent<string>) => {
      try {
        const trade = JSON.parse(event.data) as {
          symbol?: string;
          side?: "buy" | "sell";
          qty?: number;
          price?: number;
          time?: number;
        };

        if (trade.symbol && trade.symbol !== selected.symbol) return;

        const qty = Number(trade.qty ?? 0);
        const tradeTime = Number(trade.time ?? 0);

        if (
          (trade.side !== "buy" && trade.side !== "sell") ||
          !(qty > 0) ||
          !Number.isFinite(tradeTime)
        ) {
          return;
        }

        const bucketTime = orderFlowBucketStart(
          tradeTime,
          resolution
        );
        if (bucketTime === null) return;

        if (orderFlowNeedsPartialRef.current) {
          orderFlowPartialBucketRef.current = bucketTime;
          orderFlowNeedsPartialRef.current = false;
        }

        const isPartial =
          orderFlowPartialBucketRef.current === bucketTime;

        setOrderFlowBuckets((current) => {
          const next = [...current];
          const existingIndex = next.findIndex(
            (bucket) => bucket.time === bucketTime
          );

          if (existingIndex >= 0) {
            const existing = next[existingIndex];
            next[existingIndex] = {
              ...existing,
              buyVolume:
                existing.buyVolume +
                (trade.side === "buy" ? qty : 0),
              sellVolume:
                existing.sellVolume +
                (trade.side === "sell" ? qty : 0),
              trades: existing.trades + 1,
              partial: existing.partial || isPartial
            };
          } else {
            next.push({
              time: bucketTime,
              buyVolume: trade.side === "buy" ? qty : 0,
              sellVolume: trade.side === "sell" ? qty : 0,
              trades: 1,
              partial: isPartial,
              quality: "exact",
              source: "Kraken taker-side trades"
            });
          }

          next.sort((a, b) => a.time - b.time);
          return next.slice(-240);
        });

        if (
          orderFlowPartialBucketRef.current !== null &&
          bucketTime > orderFlowPartialBucketRef.current
        ) {
          orderFlowPartialBucketRef.current = null;
        }
      } catch {
        // Ignore malformed trade updates.
      }
    };

    const onKrakenCandle = (event: MessageEvent<string>) => {
      try {
        const candle = JSON.parse(event.data) as ChartCandle & {
          symbol?: string;
        };

        if (candle.symbol && candle.symbol !== selected.symbol) return;

        if (
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
        ) {
          setLiveCandle(candle);
        }
      } catch {
        // Ignore malformed candle updates.
      }
    };

    source.addEventListener("status", onStatus as EventListener);

    if (selectedIsKraken) {
      source.addEventListener("ticker", onKrakenTicker as EventListener);
      source.addEventListener("candle", onKrakenCandle as EventListener);
      source.addEventListener("trade", onKrakenTrade as EventListener);
    } else {
      source.addEventListener("tick", onFyersTick as EventListener);
    }

    source.onerror = () => {
      if (selectedIsKraken) {
        orderFlowNeedsPartialRef.current = true;
      }
      setStreamConnected(false);
      setStreamMessage(
        `${selectedIsKraken ? "Kraken" : "FYERS"} live stream reconnecting…`
      );
    };

    return () => {
      source.close();
      setStreamConnected(false);
      setLiveCandle(null);
    };
  }, [
    viewReady,
    connected,
    selected.symbol,
    selected.market,
    selectedIsKraken,
    resolution
  ]);

  useEffect(() => {
    if (!viewReady || selectedIsKraken || !connected) {
      setDerivatives(null);
      return;
    }

    const controller = new AbortController();

    void fetchDerivatives(false, controller.signal);

    const timer = window.setInterval(() => {
      void fetchDerivatives(true);
    }, 30_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    viewReady,
    connected,
    selectedIsKraken,
    selected.symbol,
    selected.market,
    selected.type,
    selected.underlying,
    contextPrice,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    if (!viewReady || (!selectedIsKraken && !connected)) return;

    const controller = new AbortController();

    void fetchAnalysisContext(controller.signal);

    const timer = window.setInterval(() => {
      void fetchAnalysisContext();
    }, 5 * 60_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    viewReady,
    connected,
    selectedIsKraken,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    if (
      !viewReady ||
      !connected ||
      (selected.market !== "NSE" && selected.market !== "BSE")
    ) {
      return;
    }

    const controller = new AbortController();

    const refreshIfOpening = () => {
      const now = Math.floor(Date.now() / 1000);
      if (isIndianOpeningWindow(now)) {
        void fetchFastOpeningContext(controller.signal);
      }
    };

    refreshIfOpening();
    const timer = window.setInterval(refreshIfOpening, 15_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    viewReady,
    connected,
    selected.market,
    primaryAnalysisSymbol
  ]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    const timer = window.setTimeout(() => {
      const wantsKraken =
        (marketFilter === "ALL" || marketFilter === "KRAKEN") &&
        (typeFilter === "ALL" || typeFilter === "CRYPTO");

      const wantsFyers =
        marketFilter !== "KRAKEN" &&
        typeFilter !== "CRYPTO";

      const requests: Promise<Instrument[]>[] = [];

      if (wantsFyers) {
        const fyersMarket =
          marketFilter === "ALL" ? "ALL" : marketFilter;
        requests.push(
          fetch(
            `/api/fyers/instruments?q=${encodeURIComponent(query)}&market=${encodeURIComponent(fyersMarket)}&type=${encodeURIComponent(typeFilter)}`,
            { cache: "no-store" }
          )
            .then((response) => response.json())
            .then((data) => (data.ok ? data.instruments : []))
            .catch(() => [])
        );
      }

      if (wantsKraken) {
        requests.push(
          fetch(
            `/api/kraken/instruments?q=${encodeURIComponent(query)}`,
            { cache: "no-store" }
          )
            .then((response) => response.json())
            .then((data) => (data.ok ? data.instruments : []))
            .catch(() => [])
        );
      }

      void Promise.all(requests)
        .then((groups) => {
          const merged = groups.flat();
          const unique = [
            ...new Map(
              merged.map((item) => [
                `${item.market}:${item.symbol}`,
                item
              ])
            ).values()
          ].slice(0, 100);

          setSearchResults(unique);
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery, marketFilter, typeFilter]);

  const changeClass = useMemo(() => {
    if (!quote) return "";
    return quote.ch >= 0 ? "positive" : "negative";
  }, [quote]);

  if (!viewReady) {
    return (
      <main className="shell wide">
        <section className="card restoringView">
          <p className="eyebrow">ALLINONEVIEW</p>
          <h2>Restoring your last chart…</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="shell wide scannerLayout">
      <section className="hero compactHero">
        <p className="eyebrow">ALL MARKETS · ONE VIEW</p>
        <div className="heroRow">
          <div>
            <h1>ALLINONEVIEW</h1>
            <p className="lead">
              Read-only analysis across Indian markets and connected global data providers.
            </p>
          </div>
          <div className="connectionStack">
            <div className="themeControl" aria-label="Theme">
              {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={
                    themeMode === mode
                      ? "themeOption active"
                      : "themeOption"
                  }
                  onClick={() => setThemeMode(mode)}
                  title={
                    mode === "light"
                      ? "Light theme"
                      : mode === "dark"
                        ? "Dark theme"
                        : "Follow system theme"
                  }
                >
                  {mode === "light"
                    ? "☀"
                    : mode === "dark"
                      ? "☾"
                      : "◐"}
                </button>
              ))}
            </div>
            <PwaInstallButton />
            <div className={connected ? "connectionPill online" : "connectionPill"}>
              <span className="dot" />
              {connected ? "FYERS CONNECTED" : "FYERS OFFLINE"}
            </div>
            <div className={streamConnected ? "connectionPill online" : "connectionPill"}>
              <span className="dot" />
              {streamConnected
                ? selectedIsKraken
                  ? "KRAKEN LIVE"
                  : "LIVE SOCKET"
                : selectedIsKraken
                  ? "KRAKEN WAITING"
                  : "SOCKET WAITING"}
            </div>
          </div>
        </div>
      </section>

      {!connected && !selectedIsKraken ? (
        <section className="card">
          <div className="row">
            <div>
              <p className="label">FYERS connection</p>
              <p className="status">Not connected</p>
            </div>
            <a className="button" href="/api/auth/fyers/login">
              Connect FYERS
            </a>
          </div>
          <p className="message">{message}</p>
        </section>
      ) : null}

      <section className="instrumentPanel">
        <div className="instrumentSearchRow">
          <div className="searchBox">
            <span className="searchIcon">⌕</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search NIFTY, Reliance, Gold, Crude, BTC/USD, ETH/USD…"
              autoComplete="off"
            />
            {searching ? <span className="searching">Searching…</span> : null}
          </div>
          <div className="filterRow">
            {MARKET_FILTERS.map((item) => (
              <button
                key={item}
                className={marketFilter === item ? "filterChip active" : "filterChip"}
                onClick={() => setMarketFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="liveNowRow">
          <span className="toolbarLabel">LIVE NOW · 24/7 GLOBAL TEST</span>
          <div className="filterRow">
            {LIVE_GLOBAL_SHORTCUTS.map((instrument) => (
              <button
                key={instrument.symbol}
                className={
                  selected.market === "KRAKEN" &&
                  selected.symbol === instrument.symbol
                    ? "liveShortcut active"
                    : "liveShortcut"
                }
                onClick={() => void selectInstrument(instrument)}
              >
                <span className="liveDot" />
                {instrument.symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="filterRow typeFilters">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item}
              className={typeFilter === item ? "filterChip active" : "filterChip"}
              onClick={() => setTypeFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {searchQuery.trim() ? (
          <div className="searchResults">
            {searchResults.length ? (
              searchResults.map((instrument) => (
                <button
                  key={instrument.symbol}
                  className="instrumentResult"
                  onClick={() => void selectInstrument(instrument)}
                >
                  <div>
                    <strong>{instrument.name}</strong>
                    <span>{instrument.symbol}</span>
                  </div>
                  <div className="instrumentBadges">
                    <span>{instrument.market}</span>
                    <span>{instrument.type}</span>
                    {instrument.expiry ? <span>{instrument.expiry}</span> : null}
                    {instrument.strike && instrument.optionType ? (
                      <span>{instrument.strike} {instrument.optionType}</span>
                    ) : null}
                  </div>
                </button>
              ))
            ) : !searching ? (
              <p className="emptySearch">No matching current FYERS instruments found.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <OpportunityScanner
        fyersConnected={Boolean(connected)}
        newsEvents={newsEvents}
        onOpen={(instrument) =>
          void selectInstrument(instrument as Instrument)
        }
      />

      <section className="terminalCard" id="market-terminal">
        <div className="marketHeader">
          <div>
            <p className="label">
              {selected.market} · {selected.type}
              {selected.expiry ? ` · EXP ${selected.expiry}` : ""}
            </p>
            <div className="priceRow">
              <h2>{selected.name}</h2>
              {quote ? (
                <>
                  <strong className="bigPrice">
                    {quote.lp.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </strong>
                  <span className={`marketChange ${changeClass}`}>
                    {quote.ch >= 0 ? "+" : ""}
                    {quote.ch.toFixed(2)} ({quote.chp.toFixed(2)}%)
                  </span>
                </>
              ) : (
                <span className="marketChange">Loading quote…</span>
              )}
            </div>
            <p className="symbolLine">{selected.symbol}</p>
            <div className="candleClock">
              <span className="clockDot" />
              <span>CANDLE CLOSE</span>
              <strong>
                {candleClock.status === "counting"
                  ? formatCountdown(candleClock.remainingSeconds)
                  : candleClock.status === "market_closed"
                    ? "MARKET CLOSED"
                    : "WAITING"}
              </strong>
            </div>
          </div>

          <div className="headerActions">
            <button
              className="button secondary compactButton"
              onClick={() => setFitNonce((value) => value + 1)}
            >
              Fit
            </button>
            <button
              className="button secondary compactButton"
              onClick={resetChartView}
            >
              Reset chart
            </button>
            <button
              className="button secondary compactButton"
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
            <button
              className="button secondary compactButton"
              onClick={() =>
                void fetchQuote(false, selected.symbol, selected.market)
              }
              disabled={loadingQuote}
            >
              {loadingQuote ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="chartToolbar stackedToolbar">
          <div className="toolbarGroup">
            <span className="toolbarLabel">TIMEFRAME</span>
            <div className="timeframes scrollable">
              {RESOLUTIONS.map((item) => (
                <button
                  key={item.value}
                  className={resolution === item.value ? "timeframe active" : "timeframe"}
                  onClick={() => setResolution(item.value)}
                  disabled={
                    selectedIsKraken &&
                    !KRAKEN_RESOLUTIONS.has(item.value)
                  }
                  title={
                    selectedIsKraken &&
                    !KRAKEN_RESOLUTIONS.has(item.value)
                      ? "Kraken does not stream this candle interval."
                      : undefined
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbarGroup rangeGroup">
            <span className="toolbarLabel">RANGE</span>
            <div className="timeframes">
              {RANGES.map((item) => (
                <button
                  key={item}
                  className={range === item ? "timeframe active" : "timeframe"}
                  onClick={() => setRange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbarGroup chartViewGroup">
            <span className="toolbarLabel">VIEW</span>
            <button
              type="button"
              className="timeframe chartResetButton"
              onClick={resetChartView}
            >
              Reset
            </button>
          </div>

          <div className="historyStatus">
            <span>
              {loadingChart
                ? `Loading ${RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}…`
                : `${candles.length.toLocaleString()} candles · ${RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}`}
            </span>
            <span>{formatDate(historyMeta.from)} → {formatDate(historyMeta.to)}</span>
          </div>
        </div>

        {historyError ? (
          <div className="historyError">
            Candle request failed for {resolution}: {historyError}
          </div>
        ) : null}
        {historyMeta.note ? <div className="historyNotice">{historyMeta.note}</div> : null}

        <MarketChart
          key={selected.market + ":" + selected.symbol}
          candles={candles}
          liveCandle={liveCandle}
          fitNonce={fitNonce}
          rangeKey={range}
          fibonacci={fibonacci}
          structure={structure}
          imbalance={imbalance}
          orderBlocks={orderBlocks}
          volumeAnalytics={volumeAnalytics}
          technicalContext={technicalContext}
          showFib={showFib}
          showTrendFib={showTrendFib}
          showStructure={showStructure}
          showFvg={showFvg}
          showLiquidity={showLiquidity}
          showOrderBlocks={showOrderBlocks}
          showVwap={showVwap}
          showProfile={showProfile}
          showEma={showEma}
          market={selected.market}
          resolution={resolution}
          showSessionBreaks={showSessionBreaks}
          orderFlowBuckets={orderFlowBuckets}
          showOrderFlow={showOrderFlow}
          tradeMarkers={tradeMarkers}
          theme={resolvedTheme}
          instrumentKey={selected.market + ":" + selected.symbol}
        />

        {quote ? (
          <div className="ohlcStrip">
            <span>O <strong>{quote.open.toLocaleString("en-IN")}</strong></span>
            <span>H <strong>{quote.high.toLocaleString("en-IN")}</strong></span>
            <span>L <strong>{quote.low.toLocaleString("en-IN")}</strong></span>
            <span>C <strong>{quote.lp.toLocaleString("en-IN")}</strong></span>
            {quote.volume ? <span>VOL <strong>{quote.volume.toLocaleString("en-IN")}</strong></span> : null}
            <span className="feedNote">{streamMessage}</span>
          </div>
        ) : null}
      </section>

      {reactionTradePlan.state !== "NONE" ? (
        <section
          className={
            "card reactionPlanCard " +
            reactionTradePlan.state.toLowerCase()
          }
        >
          <div className="reactionPlanHeader">
            <div>
              <p className="label">
                REACTION TRADE · COUNTER-TREND · 15m LIQUIDITY SWEEP
              </p>
              <h3>
                {reactionNewsBlocked
                  ? "NEWS HOLD — " + reactionTradePlan.headline
                  : reactionTradePlan.headline}
              </h3>
              {reactionTradePlan.state === "READY" &&
              reactionTradePlan.moveClass ? (
                <span
                  className={
                    "moveClassBadge " +
                    reactionTradePlan.moveClass.toLowerCase()
                  }
                >
                  CONFIRMED {reactionTradePlan.moveClass} MOVE
                </span>
              ) : null}
              <p>{reactionTradePlan.instruction}</p>
            </div>
            <div
              className={
                "reactionDirection " +
                (reactionTradePlan.direction ?? "neutral")
              }
            >
              <span>REACTION LEG</span>
              <strong>
                {reactionTradePlan.direction
                  ? reactionTradePlan.direction === "bullish"
                    ? "LONG"
                    : "SHORT"
                  : "WATCH"}
              </strong>
              <small>{reactionTradePlan.score || "—"}/100</small>
            </div>
          </div>

          <div className="simplePlanGrid">
            <div>
              <span>ENTRY NOW</span>
              <strong>
                {!reactionNewsBlocked &&
                reactionTradePlan.state === "READY" &&
                reactionTradePlan.entry !== null
                  ? reactionTradePlan.entry.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })
                  : reactionNewsBlocked
                    ? "NEWS HOLD"
                    : "WAIT"}
              </strong>
              <small>
                {reactionTradePlan.trigger ??
                  "Needs fresh liquidity sweep + reversal"}
              </small>
            </div>
            <div>
              <span>STRICT SL</span>
              <strong>
                {reactionTradePlan.stopLoss !== null
                  ? reactionTradePlan.stopLoss.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })
                  : "—"}
              </strong>
              <small>Beyond the sweep extreme + ATR buffer</small>
            </div>
            <div>
              <span>PRIMARY TRADE AFTERWARD</span>
              <strong>
                {simpleTradePlan.trend === "bearish"
                  ? "LOOK FOR SHORT"
                  : simpleTradePlan.trend === "bullish"
                    ? "LOOK FOR LONG"
                    : "WAIT"}
              </strong>
              <small>
                {simpleTradePlan.zone
                  ? simpleTradePlan.zone.low.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    }) +
                    " – " +
                    simpleTradePlan.zone.high.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })
                  : "No primary zone"}
              </small>
            </div>
          </div>

          <div className="simpleTargets">
            {(["T1", "T2", "T3"] as const).map((label) => {
              const target = reactionTradePlan.targets.find(
                (item) => item.label === label
              );

              return (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {target
                      ? target.price.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })
                      : "—"}
                  </strong>
                  <small>
                    {target?.rr !== null && target?.rr !== undefined
                      ? target.rr.toFixed(1) + "R"
                      : target?.source ?? "Waiting for valid target"}
                  </small>
                </div>
              );
            })}
          </div>

          <div className="simplePlanFooter">
            <p>{reactionTradePlan.reason}</p>
          </div>
        </section>
      ) : null}

      <section className={"card simplePlanCard " + simpleTradePlan.state.toLowerCase()}>
        <div className="simplePlanHeader">
          <div>
            <p className="label">
              SWING TRADE PLAN · 4H/1H CONTEXT · 15m CONFIRMATION · 1m/5m OPENING TRIGGER ONLY
            </p>
            <h3>
              {loadingContext
                ? "Building real-data context…"
                : primaryNewsBlocked
                  ? "NEWS HOLD — " + simpleTradePlan.headline
                  : simpleTradePlan.headline}
            </h3>
            {simpleTradePlan.state === "READY" && simpleTradePlan.moveClass ? (
              <span className={"moveClassBadge " + simpleTradePlan.moveClass.toLowerCase()}>
                CONFIRMED {simpleTradePlan.moveClass} MOVE
              </span>
            ) : null}
            <p>{simpleTradePlan.instruction}</p>
          </div>
          <div className={"simpleTrend " + simpleTradePlan.trend}>
            <span>OVERALL TREND</span>
            <strong>{simpleTradePlan.trend.toUpperCase()}</strong>
            <small>{simpleTradePlan.score}/100 confluence</small>
          </div>
        </div>

        <div className="simplePlanGrid">
          <div>
            <span>WAIT / ENTRY ZONE</span>
            <strong>
              {simpleTradePlan.zone
                ? simpleTradePlan.zone.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) +
                  " – " +
                  simpleTradePlan.zone.high.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                : "WAIT"}
            </strong>
            <small>Fib retracement refined by valid OB/sweep context</small>
          </div>
          <div>
            <span>ENTRY</span>
            <strong>
              {!primaryNewsBlocked &&
              simpleTradePlan.state === "READY" &&
              simpleTradePlan.entry !== null
                ? simpleTradePlan.entry.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : primaryNewsBlocked
                  ? "NEWS HOLD"
                  : "WAIT"}
            </strong>
            <small>
              {simpleTradePlan.trigger ?? "Needs liquidity sweep / Order Block reaction"}
              {simpleTradePlan.confirmationTimeframe
                ? " · " + simpleTradePlan.confirmationTimeframe + " confirmation"
                : ""}
            </small>
          </div>
          <div>
            <span>STRICT SL</span>
            <strong>
              {simpleTradePlan.stopLoss !== null
                ? simpleTradePlan.stopLoss.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                : "—"}
            </strong>
            <small>Beyond real invalidation; never tightened inside the invalidation point</small>
          </div>
        </div>

        <div className="simpleTargets">
          {(["T1", "T2", "T3"] as const).map((label) => {
            const target = simpleTradePlan.targets.find((item) => item.label === label);
            return (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {target
                    ? target.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                    : "—"}
                </strong>
                <small>{target?.rr !== null && target?.rr !== undefined ? target.rr.toFixed(1) + "R" : target?.source ?? "Waiting for valid target"}</small>
              </div>
            );
          })}
        </div>

        <div className="simplePlanFooter">
          <p>{simpleTradePlan.reason}</p>
          <button
            className="button secondary compactButton"
            onClick={() => setShowAdvancedAnalysis((value) => !value)}
          >
            {showAdvancedAnalysis ? "Hide advanced analysis" : "Show advanced analysis"}
          </button>
        </div>
      </section>

      <section className="card tradeCapitalPlanner">
        <div className="tradeCapitalHeader">
          <div>
            <p className="label">TRADE & CAPITAL PLANNER · CURRENT CHART</p>
            <h3>{selected.name}</h3>
            <p>
              Capital is entered here for this chart only. Trade levels always come
              from the confirmed market setup; position size never changes the signal.
            </p>
          </div>
          <div className="tradeCapitalInputWrap">
            <span>CAPITAL</span>
            <label>
              <b>{capitalCurrency}</b>
              <input
                inputMode="decimal"
                value={tradeCapitalInput}
                onChange={(event) =>
                  setTradeCapitalInput(
                    event.target.value.replace(/[^0-9.]/g, "")
                  )
                }
                placeholder="e.g. 100000"
              />
            </label>
          </div>
        </div>

        <div className="tradeCapitalGrid">
          <div>
            <span>SETUP</span>
            <strong>
              {activePlannerPlan
                ? (activePlannerPlan.moveClass ?? "TACTICAL") +
                  " " +
                  activePlannerPlan.setup
                : "WAIT"}
            </strong>
            <small>
              {activePlannerPlan?.direction
                ? activePlannerPlan.direction.toUpperCase()
                : "No confirmed trade yet"}
            </small>
          </div>
          <div>
            <span>ENTRY</span>
            <strong>
              {activePlannerPlan
                ? activePlannerPlan.entry.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>
              {selected.type === "OPTION"
                ? "Underlying strategy entry"
                : "Confirmed chart entry"}
            </small>
          </div>
          <div>
            <span>STRICT SL</span>
            <strong>
              {activePlannerPlan
                ? activePlannerPlan.stopLoss.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>
              {selected.type === "OPTION"
                ? "Underlying invalidation level"
                : "Real structure invalidation"}
            </small>
          </div>
          {(["T1", "T2", "T3"] as const).map((label) => {
            const target = activePlannerPlan?.targets.find(
              (item) => item.label === label
            );
            return (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {target
                    ? target.price.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })
                    : "—"}
                </strong>
                <small>
                  {selected.type === "OPTION"
                    ? "Underlying target"
                    : target?.rr !== null &&
                        target?.rr !== undefined
                      ? target.rr.toFixed(1) + "R"
                      : "Waiting"}
                </small>
              </div>
            );
          })}
        </div>

        <div className="capitalSizingSummary">
          <div>
            <span>CAPITAL ENTERED</span>
            <strong>
              {tradeCapital > 0
                ? capitalCurrency +
                  tradeCapital.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>
              {tradeCapital > 0
                ? activePlannerPlan
                  ? "Sizing against the confirmed setup"
                  : "Capital saved — waiting for a confirmed setup"
                : "Enter capital above"}
            </small>
          </div>

          {!isDerivative ? (
            <>
              <div>
                <span>MAX AFFORDABLE QTY</span>
                <strong>
                  {affordableUnits !== null
                    ? selected.market === "KRAKEN"
                      ? affordableUnits.toLocaleString("en-IN", {
                          maximumFractionDigits: 6
                        })
                      : Math.floor(affordableUnits).toLocaleString(
                          "en-IN"
                        )
                    : "—"}
                </strong>
                <small>
                  {deployedCapital !== null
                    ? "Deploys " +
                      capitalCurrency +
                      deployedCapital.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })
                    : "Based on current/confirmed entry price"}
                </small>
              </div>
              <div className="capitalRiskCell">
                <span>MONEY AT STRICT SL</span>
                <strong>
                  {moneyRiskAtStop !== null
                    ? "-" +
                      capitalCurrency +
                      moneyRiskAtStop.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })
                    : "—"}
                </strong>
                <small>
                  {activePlannerPlan
                    ? "If the max affordable quantity is used"
                    : "Appears when a trade becomes READY"}
                </small>
              </div>
              {(["T1", "T2", "T3"] as const).map((label) => {
                const amount =
                  label === "T1"
                    ? t1Money
                    : label === "T2"
                      ? t2Money
                      : t3Money;
                return (
                  <div className="capitalProfitCell" key={label}>
                    <span>PROJECTED {label} P/L</span>
                    <strong>
                      {amount !== null
                        ? "+" +
                          capitalCurrency +
                          amount.toLocaleString("en-IN", {
                            maximumFractionDigits: 2
                          })
                        : "—"}
                    </strong>
                    <small>
                      {activePlannerPlan
                        ? "At the strategy " + label + " level"
                        : "Appears when a trade becomes READY"}
                    </small>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div>
                <span>
                  {selected.type === "OPTION"
                    ? "BUY · MAX LOTS"
                    : "MAX FUTURES LOTS"}
                </span>
                <strong>
                  {selected.type === "OPTION"
                    ? maxBuyLots ?? "—"
                    : maxMarginLots ?? "—"}
                </strong>
                <small>
                  {selected.type === "OPTION"
                    ? optionBuyCostPerLot
                      ? "1 lot costs " +
                        capitalCurrency +
                        Math.round(
                          optionBuyCostPerLot
                        ).toLocaleString("en-IN")
                      : "Needs live premium + lot size"
                    : selectedMarginPerLot
                      ? "FYERS margin/lot " +
                        capitalCurrency +
                        Math.round(
                          selectedMarginPerLot
                        ).toLocaleString("en-IN")
                      : "Waiting for FYERS margin"}
                </small>
              </div>
              {selected.type === "OPTION" ? (
                <div>
                  <span>SELL · MAX LOTS</span>
                  <strong>{maxMarginLots ?? "—"}</strong>
                  <small>
                    {selectedMarginPerLot
                      ? "FYERS margin/lot " +
                        capitalCurrency +
                        Math.round(
                          selectedMarginPerLot
                        ).toLocaleString("en-IN")
                      : "Waiting for exact FYERS margin"}
                  </small>
                </div>
              ) : null}
              <div>
                <span>CONTRACT QUANTITY</span>
                <strong>
                  {derivativeQuantity !== null
                    ? derivativeQuantity.toLocaleString("en-IN")
                    : "—"}
                </strong>
                <small>
                  {selectedLotSize
                    ? "Lot size " + selectedLotSize
                    : "Lot size unavailable"}
                </small>
              </div>
              <div>
                <span>MONEY RISK / TARGETS</span>
                <strong>
                  {planMatchesSelectedPrice &&
                  moneyRiskAtStop !== null
                    ? "-" +
                      capitalCurrency +
                      moneyRiskAtStop.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })
                    : "UNDERLYING LEVELS"}
                </strong>
                <small>
                  {planMatchesSelectedPrice
                    ? "Calculated from this contract's own confirmed setup"
                    : "Not fabricated from underlying moves"}
                </small>
              </div>
            </>
          )}
        </div>

        {selected.type === "OPTION" ? (
          <div className="optionCapitalGrid">
            <div>
              <span>OPTION PREMIUM NOW</span>
              <strong>
                {quote?.lp
                  ? quote.lp.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })
                  : "—"}
              </strong>
              <small>{selected.symbol}</small>
            </div>
            <div>
              <span>LOT SIZE</span>
              <strong>{selectedLotSize ?? "—"}</strong>
              <small>From FYERS instrument master</small>
            </div>
            <div>
              <span>BUY · 1 LOT COST</span>
              <strong>
                {optionBuyCostPerLot
                  ? "₹" +
                    Math.round(optionBuyCostPerLot).toLocaleString(
                      "en-IN"
                    )
                  : "—"}
              </strong>
              <small>
                {tradeCapital > 0 && maxBuyLots !== null
                  ? "Capital fits " + maxBuyLots + " lot(s)"
                  : "Enter capital to size"}
              </small>
            </div>
            <div>
              <span>SELL · MARGIN / LOT</span>
              <strong>
                {selectedMarginPerLot
                  ? "₹" +
                    Math.round(selectedMarginPerLot).toLocaleString(
                      "en-IN"
                    )
                  : "—"}
              </strong>
              <small>
                {tradeCapital > 0 && maxMarginLots !== null
                  ? "Capital fits " + maxMarginLots + " lot(s)"
                  : "Exact FYERS margin when available"}
              </small>
            </div>
          </div>
        ) : (
          <p className="tradeCapitalNote">
            Open a specific option contract from a confirmed trade to see its
            exact premium, FYERS lot size, buy cost per lot and sell margin here.
          </p>
        )}

        {selected.type === "OPTION" ? (
          <p className="tradeCapitalNote">
            Capital sizing is live. For NSE/BSE options, the strategy is built on
            the underlying, so premium SL/targets are deliberately not invented.
            The contract's live premium, exact lot size, buy cost and FYERS sell
            margin update independently.
          </p>
        ) : null}
      </section>

      <section className={showAdvancedAnalysis ? "card orderFlowCard" : "card orderFlowCard advancedHidden"}>
        <div className="orderFlowHeader">
          <div>
            <p className="label">TRUE BUY / SELL ORDER FLOW</p>
            <h3>
              {selectedIsKraken
                ? streamConnected
                  ? "Exact taker-side volume is live"
                  : "Waiting for exact live trades"
                : "Exact order flow unavailable from the current FYERS market feed"}
            </h3>
          </div>
          <span
            className={
              selectedIsKraken && streamConnected
                ? "orderFlowQuality exact"
                : "orderFlowQuality unavailable"
            }
          >
            {selectedIsKraken
              ? streamConnected
                ? "EXACT"
                : "WAITING"
              : "NO ESTIMATE"}
          </span>
        </div>

        {selectedIsKraken && latestOrderFlow && latestOrderFlowStats ? (
          <>
            <div className="orderFlowMeter" aria-label="Buy sell volume split">
              <div
                className="orderFlowBuy"
                style={{ width: `${latestOrderFlowStats.buyPercent}%` }}
              />
              <div
                className="orderFlowSell"
                style={{ width: `${latestOrderFlowStats.sellPercent}%` }}
              />
            </div>

            <div className="orderFlowStats">
              <div>
                <span>BUY VOLUME</span>
                <strong>{latestOrderFlowStats.buyPercent.toFixed(1)}%</strong>
                <small>{latestOrderFlow.buyVolume.toLocaleString("en-IN", { maximumFractionDigits: 6 })}</small>
              </div>
              <div>
                <span>SELL VOLUME</span>
                <strong>{latestOrderFlowStats.sellPercent.toFixed(1)}%</strong>
                <small>{latestOrderFlow.sellVolume.toLocaleString("en-IN", { maximumFractionDigits: 6 })}</small>
              </div>
              <div>
                <span>DELTA</span>
                <strong className={latestOrderFlowStats.deltaPercent >= 0 ? "positive" : "negative"}>
                  {latestOrderFlowStats.deltaPercent >= 0 ? "+" : ""}
                  {latestOrderFlowStats.deltaPercent.toFixed(1)}%
                </strong>
                <small>{latestOrderFlowStats.delta.toLocaleString("en-IN", { maximumFractionDigits: 6 })}</small>
              </div>
              <div>
                <span>TRADES SEEN</span>
                <strong>{latestOrderFlow.trades.toLocaleString("en-IN")}</strong>
                <small>{latestOrderFlow.partial ? "PARTIAL CURRENT CANDLE" : "COMPLETE FROM CANDLE OPEN"}</small>
              </div>
            </div>

            {latestOrderFlow.partial ? (
              <p className="orderFlowNote">
                This candle started before ALLINONEVIEW joined the trade stream, so only trades observed after connection are shown. The next full candle will be complete.
              </p>
            ) : null}
          </>
        ) : selectedIsKraken ? (
          <p className="orderFlowNote">
            ALLINONEVIEW will start automatically with the first real trade received from Kraken. No candle-colour or bid/ask estimate is used.
          </p>
        ) : (
          <p className="orderFlowNote">
            FYERS does not expose an aggressor-side field for every market trade in the current market-data feed. ALLINONEVIEW therefore shows no buyer/seller percentage rather than inventing one. The chart, volume, OI, VWAP and other real data remain available.
          </p>
        )}
      </section>

      <section className={showAdvancedAnalysis ? "card reversalCard" : "card reversalCard advancedHidden"}>
        <div className="reversalHeader">
          <div>
            <p className="label">MULTI-TIMEFRAME REVERSAL ENGINE</p>
            <h3>
              {loadingContext
                ? "Building 4H → 1H → 15m context…"
                : `${reversalEngine.selected.classification} ${reversalEngine.selected.direction === "bullish" ? "Bullish" : "Bearish"} Setup`}
            </h3>
            <p className="contextSource">
              Primary analysis: {primaryAnalysisSymbol} · 4H zone · 1H refinement · 15m confirmation
            </p>
          </div>
          <div className={`scoreBadge ${reversalEngine.selected.classification.toLowerCase()}`}>
            <strong>{reversalEngine.selected.score}</strong>
            <span>/100</span>
          </div>
        </div>

        <div className="directionScores">
          <div className={reversalEngine.selected.direction === "bullish" ? "directionScore selected bullish" : "directionScore bullish"}>
            <span>BULLISH</span>
            <strong>{reversalEngine.bullish.score}</strong>
          </div>
          <div className={reversalEngine.selected.direction === "bearish" ? "directionScore selected bearish" : "directionScore bearish"}>
            <span>BEARISH</span>
            <strong>{reversalEngine.bearish.score}</strong>
          </div>
          <div className="entryStateBox">
            <span>ENTRY CONFIRMATION</span>
            <strong className={`entryState ${reversalEngine.selected.entryState.toLowerCase()}`}>
              {reversalEngine.selected.entryState}
            </strong>
          </div>
          <div>
            <span>AVAILABLE WEIGHT</span>
            <strong>
              {reversalEngine.selected.availablePoints}/100
            </strong>
            <small>Missing inputs are redistributed</small>
          </div>
        </div>

        <div className="scoreBreakdown">
          {reversalEngine.selected.components.map((component) => (
            <div
              className={
                component.available
                  ? "scoreComponent"
                  : "scoreComponent unavailable"
              }
              key={component.key}
            >
              <div>
                <span>{component.label}</span>
                <strong>
                  {component.available
                    ? `${component.points}/${component.maxPoints}`
                    : "N/A"}
                </strong>
              </div>
              <p>{component.detail}</p>
            </div>
          ))}
        </div>

        <div className="reversalPlan">
          <div>
            <span>REVERSAL ZONE</span>
            <strong>
              {reversalEngine.selected.reversalZone
                ? `${reversalEngine.selected.reversalZone.low.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })} – ${reversalEngine.selected.reversalZone.high.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>INVALIDATION</span>
            <strong>
              {reversalEngine.selected.invalidation !== null
                ? reversalEngine.selected.invalidation.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>ATR-BUFFERED SL</span>
            <strong>
              {reversalEngine.selected.stopLoss !== null
                ? reversalEngine.selected.stopLoss.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>0.25× ATR beyond invalidation</small>
          </div>
        </div>

        {reversalEngine.selected.targets.length ? (
          <div className="targetGrid">
            {reversalEngine.selected.targets.map((target) => (
              <div key={target.label}>
                <span>{target.label}</span>
                <strong>
                  {target.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}
                </strong>
                <small>{target.source}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="analysisWaiting">
            Targets will appear when confirmed directional structure provides valid levels.
          </p>
        )}
      </section>

      <section
        className={
          showAdvancedAnalysis
            ? "card performanceCard"
            : "card performanceCard advancedHidden"
        }
      >
        <div className="performanceHeader">
          <div>
            <p className="label">PLATFORM TRADE JOURNAL · REAL SIGNAL HISTORY</p>
            <h3>P/L analytics in R-multiples</h3>
            <p>
              Signals are stored locally and remain on the chart after refresh.
              No account size or position size is assumed.
            </p>
          </div>
        </div>

        <div className="performanceGrid">
          {[
            {
              title: "ALL SYMBOLS",
              stats: overallTradeStats,
              style: tradePieBackground(overallTradeStats)
            },
            {
              title: primaryAnalysisSymbol,
              stats: symbolTradeStats,
              style: tradePieBackground(symbolTradeStats)
            }
          ].map((item) => (
            <div className="performancePanel" key={item.title}>
              <div className="performancePie" style={item.style}>
                <div>
                  <strong>{item.stats.totalR.toFixed(1)}R</strong>
                  <span>TOTAL</span>
                </div>
              </div>
              <div className="performanceNumbers">
                <span>{item.title}</span>
                <strong>
                  {item.stats.winRate.toFixed(1)}% win rate
                </strong>
                <small>
                  {item.stats.wins} wins · {item.stats.losses} losses ·{" "}
                  {item.stats.breakeven} BE · {item.stats.ambiguous} ambiguous ·{" "}
                  {item.stats.open} open
                </small>
                <small>
                  Avg {item.stats.averageR.toFixed(2)}R ·{" "}
                  {item.stats.closed} closed
                </small>
              </div>
            </div>
          ))}
        </div>

        <div className="tradeHistoryTableWrap">
          <table className="tradeHistoryTable">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Symbol</th>
                <th>Setup</th>
                <th>Move</th>
                <th>Side</th>
                <th>TF</th>
                <th>Entry</th>
                <th>SL / Live Stop</th>
                <th>Outcome</th>
                <th>P/L</th>
              </tr>
            </thead>
            <tbody>
              {tradeJournal.length ? (
                tradeJournal
                  .slice()
                  .sort((a, b) => b.signalTime - a.signalTime)
                  .slice(0, 100)
                  .map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        {new Date(trade.signalTime * 1000).toLocaleString(
                          "en-IN",
                          {
                            timeZone:
                              trade.market === "KRAKEN"
                                ? "UTC"
                                : "Asia/Kolkata",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit"
                          }
                        )}
                      </td>
                      <td>{trade.symbol}</td>
                      <td>{trade.setupType ?? "PRIMARY"}</td>
                      <td>{trade.moveClass ?? "TACTICAL"}</td>
                      <td className={trade.direction}>
                        {trade.direction.toUpperCase()}
                      </td>
                      <td>{trade.confirmationTimeframe}</td>
                      <td>
                        {trade.entry.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                      </td>
                      <td>
                        {trade.currentStop.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                      </td>
                      <td title={trade.ambiguityReason ?? undefined}>
                        {trade.outcome}
                      </td>
                      <td
                        className={
                          (trade.resultR ?? 0) > 0
                            ? "positive"
                            : (trade.resultR ?? 0) < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {trade.resultR === null
                          ? "OPEN"
                          : (trade.resultR > 0 ? "+" : "") +
                            trade.resultR.toFixed(2) +
                            "R"}
                      </td>
                    </tr>
                  ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    No platform trades have been issued yet. The journal starts
                    automatically with the first confirmed READY signal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={showAdvancedAnalysis ? "card analysisCard" : "card analysisCard advancedHidden"}>
        <div className="analysisHeader">
          <div>
            <p className="label">AUTOMATIC MARKET ANALYSIS</p>
            <h3>
              {fibonacci.direction === "bullish"
                ? "Bullish swing"
                : fibonacci.direction === "bearish"
                  ? "Bearish swing"
                  : "Waiting for confirmed swing"}
            </h3>
          </div>
          <div className="analysisToggles">
            <button
              className={showFib ? "analysisToggle active" : "analysisToggle"}
              onClick={() => setShowFib((value) => !value)}
            >
              Fib {showFib ? "ON" : "OFF"}
            </button>
            <button
              className={
                showTrendFib
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowTrendFib((value) => !value)}
            >
              Trend Fib {showTrendFib ? "ON" : "OFF"}
            </button>
            <button
              className={
                showStructure
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowStructure((value) => !value)}
            >
              Structure {showStructure ? "ON" : "OFF"}
            </button>
            <button
              className={showFvg ? "analysisToggle active" : "analysisToggle"}
              onClick={() => setShowFvg((value) => !value)}
            >
              FVG {showFvg ? "ON" : "OFF"}
            </button>
            <button
              className={
                showLiquidity
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowLiquidity((value) => !value)}
            >
              Liquidity {showLiquidity ? "ON" : "OFF"}
            </button>
            <button
              className={
                showOrderBlocks
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowOrderBlocks((value) => !value)}
            >
              Order Blocks {showOrderBlocks ? "ON" : "OFF"}
            </button>
            <button
              className={
                showVwap ? "analysisToggle active" : "analysisToggle"
              }
              onClick={() => setShowVwap((value) => !value)}
              disabled={!volumeAnalytics.available}
            >
              VWAP {showVwap ? "ON" : "OFF"}
            </button>
            <button
              className={
                showProfile ? "analysisToggle active" : "analysisToggle"
              }
              onClick={() => setShowProfile((value) => !value)}
              disabled={!volumeAnalytics.available}
            >
              Profile {showProfile ? "ON" : "OFF"}
            </button>
            <button
              className={showEma ? "analysisToggle active" : "analysisToggle"}
              onClick={() => setShowEma((value) => !value)}
            >
              EMA {showEma ? "ON" : "OFF"}
            </button>
            <button
              className={
                showSessionBreaks
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowSessionBreaks((value) => !value)}
            >
              Sessions {showSessionBreaks ? "ON" : "OFF"}
            </button>
            <button
              className={
                showOrderFlow
                  ? "analysisToggle active"
                  : "analysisToggle"
              }
              onClick={() => setShowOrderFlow((value) => !value)}
              disabled={!selectedIsKraken}
            >
              Buy/Sell Vol {showOrderFlow ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div className="structureStrip">
          <div>
            <span>STRUCTURE TREND</span>
            <strong className={`structureTrend ${structure.trend}`}>
              {structure.trend.toUpperCase()}
            </strong>
          </div>
          <div>
            <span>LATEST EVENT</span>
            <strong>
              {structure.latestEvent
                ? `${structure.latestEvent.type} ${structure.latestEvent.direction === "bullish" ? "↑" : "↓"}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>BROKEN LEVEL</span>
            <strong>
              {structure.latestEvent
                ? structure.latestEvent.brokenLevel.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>ACTIVE STRUCTURE</span>
            <strong>
              {structure.activeSwingLow && structure.activeSwingHigh
                ? `${structure.activeSwingLow.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })} ↔ ${structure.activeSwingHigh.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}`
                : "—"}
            </strong>
          </div>
        </div>

        <div className="imbalanceStrip">
          <div>
            <span>ACTIVE FVGs</span>
            <strong>{imbalance.activeFvgs.length}</strong>
          </div>
          <div>
            <span>LATEST SWEEP · LIVE</span>
            <strong
              className={
                imbalance.latestSweep
                  ? `sweepDirection ${imbalance.latestSweep.direction}`
                  : ""
              }
            >
              {imbalance.latestSweep
                ? `${imbalance.latestSweep.direction.toUpperCase()} ${imbalance.latestSweep.direction === "bullish" ? "↑" : "↓"}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>SWEEP LEVEL</span>
            <strong>
              {imbalance.latestSweep
                ? imbalance.latestSweep.level.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>FVG STATE</span>
            <strong>
              {imbalance.activeFvgs.length
                ? `${imbalance.activeFvgs.filter((gap) => gap.status === "active").length} active · ${imbalance.activeFvgs.filter((gap) => gap.status === "touched").length} touched`
                : "None nearby"}
            </strong>
          </div>
        </div>

        <div className="orderBlockStrip">
          <div>
            <span>VALID ORDER BLOCKS</span>
            <strong>{orderBlocks.activeBlocks.length}</strong>
          </div>
          <div>
            <span>BULLISH OBs</span>
            <strong>
              {orderBlocks.activeBlocks.filter((block) => block.direction === "bullish").length}
            </strong>
          </div>
          <div>
            <span>BEARISH OBs</span>
            <strong>
              {orderBlocks.activeBlocks.filter((block) => block.direction === "bearish").length}
            </strong>
          </div>
          <div>
            <span>TOUCHED</span>
            <strong>
              {orderBlocks.activeBlocks.filter((block) => block.status === "touched").length}
            </strong>
          </div>
        </div>

        <div className="volumeStrip">
          <div>
            <span>VOLUME DATA</span>
            <strong className={volumeAnalytics.available ? "available" : "unavailable"}>
              {volumeAnalytics.available ? "AVAILABLE" : "UNAVAILABLE"}
            </strong>
          </div>
          <div>
            <span>SESSION VWAP</span>
            <strong>
              {volumeAnalytics.latestSessionVwap !== null
                ? volumeAnalytics.latestSessionVwap.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>ANCHORED VWAP</span>
            <strong>
              {volumeAnalytics.latestAnchoredVwap !== null
                ? volumeAnalytics.latestAnchoredVwap.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>VOL vs AVG20</span>
            <strong>
              {volumeAnalytics.volumeRatio20 !== null
                ? `${volumeAnalytics.volumeRatio20.toFixed(2)}×`
                : "—"}
            </strong>
          </div>
        </div>

        <div className="profileStrip">
          <div>
            <span>POC</span>
            <strong>
              {volumeAnalytics.profile.poc !== null
                ? volumeAnalytics.profile.poc.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>VAH</span>
            <strong>
              {volumeAnalytics.profile.vah !== null
                ? volumeAnalytics.profile.vah.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>VAL</span>
            <strong>
              {volumeAnalytics.profile.val !== null
                ? volumeAnalytics.profile.val.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>PROFILE TYPE</span>
            <strong>
              {volumeAnalytics.available
                ? "CANDLE-DERIVED"
                : "NOT APPLICABLE"}
            </strong>
          </div>
        </div>

        {!volumeAnalytics.available ? (
          <p className="volumeUnavailableNote">
            This instrument does not provide usable traded volume in the loaded
            candles. VWAP/profile confirmation is disabled here and will be
            dynamically excluded from the future confluence score.
          </p>
        ) : null}

        <section className="derivativesPanel">
          <div className="derivativesHeader">
            <div>
              <span className="toolbarLabel">DERIVATIVES CONFIRMATION</span>
              <strong>
                {selectedIsKraken
                  ? "Not connected for this provider"
                  : loadingDerivatives
                    ? "Loading FYERS futures/options…"
                    : derivatives?.available
                      ? derivatives.underlying || "FYERS F&O"
                      : "Unavailable for this instrument"}
              </strong>
            </div>
            {!selectedIsKraken && derivatives?.available ? (
              <span className="derivativesBadge">FYERS F&O</span>
            ) : null}
          </div>

          {!selectedIsKraken && derivatives?.available ? (
            <>
              <div className="derivativesSummary">
                <div>
                  <span>NEAREST FUTURE</span>
                  <strong>
                    {derivatives.future?.symbol
                      ? derivatives.future.symbol.replace(/^.*:/, "")
                      : "—"}
                  </strong>
                  <small>
                    {derivatives.future?.expiry
                      ? new Date(
                          derivatives.future.expiry * 1000
                        ).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          day: "2-digit",
                          month: "short",
                          year: "numeric"
                        })
                      : ""}
                  </small>
                </div>
                <div>
                  <span>FUTURE PRICE / BASIS</span>
                  <strong>
                    {derivatives.future
                      ? derivatives.future.price.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })
                      : "—"}
                  </strong>
                  <small>
                    {derivatives.future?.basis !== null &&
                    derivatives.future?.basis !== undefined
                      ? `Basis ${derivatives.future.basis >= 0 ? "+" : ""}${derivatives.future.basis.toFixed(2)} (${derivatives.future.basisPercent?.toFixed(2) ?? "—"}%)`
                      : ""}
                  </small>
                </div>
                <div>
                  <span>FUTURES OI / ΔOI</span>
                  <strong>
                    {derivatives.future?.oi !== null &&
                    derivatives.future?.oi !== undefined
                      ? derivatives.future.oi.toLocaleString("en-IN")
                      : "—"}
                  </strong>
                  <small>
                    {derivatives.future?.oiChange !== null &&
                    derivatives.future?.oiChange !== undefined
                      ? `ΔOI ${derivatives.future.oiChange >= 0 ? "+" : ""}${derivatives.future.oiChange.toLocaleString("en-IN")}`
                      : ""}
                  </small>
                </div>
                <div>
                  <span>PCR · CALL OI / PUT OI</span>
                  <strong>
                    {derivatives.options?.pcr !== null &&
                    derivatives.options?.pcr !== undefined
                      ? derivatives.options.pcr.toFixed(2)
                      : "—"}
                  </strong>
                  <small>
                    {derivatives.options
                      ? `CE ${derivatives.options.callOi.toLocaleString("en-IN")} · PE ${derivatives.options.putOi.toLocaleString("en-IN")}`
                      : ""}
                  </small>
                </div>
              </div>

              {derivatives.options ? (
                <div className="derivativesSummary secondary">
                  <div>
                    <span>NEAREST EXPIRY</span>
                    <strong>
                      {derivatives.options.nearestExpiry?.date ?? "—"}
                    </strong>
                  </div>
                  <div>
                    <span>ATM STRIKE</span>
                    <strong>
                      {derivatives.options.atm.strike !== null
                        ? derivatives.options.atm.strike.toLocaleString("en-IN")
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>ATM CE IV / Δ</span>
                    <strong>
                      {derivatives.options.atm.call?.greeks
                        ? `${derivatives.options.atm.call.greeks.iv.toFixed(2)}% / ${derivatives.options.atm.call.greeks.delta.toFixed(3)}`
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>ATM PE IV / Δ</span>
                    <strong>
                      {derivatives.options.atm.put?.greeks
                        ? `${derivatives.options.atm.put.greeks.iv.toFixed(2)}% / ${derivatives.options.atm.put.greeks.delta.toFixed(3)}`
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>INDIA VIX</span>
                    <strong>
                      {derivatives.options.indiaVix !== null
                        ? derivatives.options.indiaVix.toFixed(2)
                        : "—"}
                    </strong>
                  </div>
                </div>
              ) : null}

              {derivatives.options ? (
                <div className="oiWallsGrid">
                  <div className="oiWallPanel">
                    <span className="toolbarLabel">TOP CALL OI WALLS</span>
                    {derivatives.options.callOiWalls.map((leg) => (
                      <div className="oiWallRow call" key={leg.symbol}>
                        <span>{leg.strike.toLocaleString("en-IN")} CE</span>
                        <strong>{leg.oi.toLocaleString("en-IN")}</strong>
                        <small>
                          Δ {leg.oiChange >= 0 ? "+" : ""}
                          {leg.oiChange.toLocaleString("en-IN")}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="oiWallPanel">
                    <span className="toolbarLabel">TOP PUT OI WALLS</span>
                    {derivatives.options.putOiWalls.map((leg) => (
                      <div className="oiWallRow put" key={leg.symbol}>
                        <span>{leg.strike.toLocaleString("en-IN")} PE</span>
                        <strong>{leg.oi.toLocaleString("en-IN")}</strong>
                        <small>
                          Δ {leg.oiChange >= 0 ? "+" : ""}
                          {leg.oiChange.toLocaleString("en-IN")}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="oiWallPanel">
                    <span className="toolbarLabel">CALL OI BUILD</span>
                    {derivatives.options.callOiBuild.map((leg) => (
                      <div className="oiWallRow call" key={leg.symbol}>
                        <span>{leg.strike.toLocaleString("en-IN")} CE</span>
                        <strong>
                          +{leg.oiChange.toLocaleString("en-IN")}
                        </strong>
                        <small>{leg.oiChangePercent.toFixed(1)}%</small>
                      </div>
                    ))}
                  </div>
                  <div className="oiWallPanel">
                    <span className="toolbarLabel">PUT OI BUILD</span>
                    {derivatives.options.putOiBuild.map((leg) => (
                      <div className="oiWallRow put" key={leg.symbol}>
                        <span>{leg.strike.toLocaleString("en-IN")} PE</span>
                        <strong>
                          +{leg.oiChange.toLocaleString("en-IN")}
                        </strong>
                        <small>{leg.oiChangePercent.toFixed(1)}%</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="derivativesUnavailable">
              {selectedIsKraken
                ? "Kraken spot is currently analysed without FYERS futures/options confirmation. The future confluence score will redistribute this unavailable input."
                : derivatives?.reason ||
                  "No current futures/options chain is available for this instrument. This input will be excluded rather than scored as negative."}
            </p>
          )}
        </section>

        <div className="technicalStrip">
          <div>
            <span>TREND STATE</span>
            <strong className={`technicalTrend ${technicalContext.trendState}`}>
              {technicalContext.trendState.replaceAll("_", " ").toUpperCase()}
            </strong>
          </div>
          <div>
            <span>RSI(14)</span>
            <strong>
              {technicalContext.rsi14 !== null
                ? technicalContext.rsi14.toFixed(1)
                : "—"}
            </strong>
          </div>
          <div>
            <span>ADX(14)</span>
            <strong>
              {technicalContext.adx14 !== null
                ? technicalContext.adx14.toFixed(1)
                : "—"}
            </strong>
          </div>
          <div>
            <span>ATR / PRICE</span>
            <strong>
              {technicalContext.atrPercent !== null
                ? `${technicalContext.atrPercent.toFixed(2)}%`
                : "—"}
            </strong>
            <small>{technicalContext.volatilityState.toUpperCase()} VOLATILITY</small>
          </div>
          <div>
            <span>EMA20</span>
            <strong>
              {technicalContext.latestEma20 !== null
                ? technicalContext.latestEma20.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>EMA50</span>
            <strong>
              {technicalContext.latestEma50 !== null
                ? technicalContext.latestEma50.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
          <div>
            <span>EMA200</span>
            <strong>
              {technicalContext.latestEma200 !== null
                ? technicalContext.latestEma200.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
        </div>

        <div className="analysisSummary">
          <div>
            <span>SWING A</span>
            <strong>
              {fibonacci.anchorA
                ? fibonacci.anchorA.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>
              {fibonacci.anchorA
                ? new Date(fibonacci.anchorA.time * 1000).toLocaleString(
                    "en-IN",
                    {
                      timeZone: selectedIsKraken
                        ? "UTC"
                        : "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    }
                  )
                : ""}
            </small>
          </div>

          <div>
            <span>SWING B</span>
            <strong>
              {fibonacci.anchorB
                ? fibonacci.anchorB.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
            <small>
              {fibonacci.anchorB
                ? new Date(fibonacci.anchorB.time * 1000).toLocaleString(
                    "en-IN",
                    {
                      timeZone: selectedIsKraken
                        ? "UTC"
                        : "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    }
                  )
                : ""}
            </small>
          </div>

          <div>
            <span>GOLDEN ZONE 61.8–78.6</span>
            <strong>
              {fibonacci.goldenZone
                ? `${fibonacci.goldenZone.low.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })} – ${fibonacci.goldenZone.high.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}`
                : "—"}
            </strong>
          </div>

          <div>
            <span>ATR(14)</span>
            <strong>
              {fibonacci.atr14
                ? fibonacci.atr14.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })
                : "—"}
            </strong>
          </div>
        </div>

        {fibonacci.retracements.length ? (
          <div className="fibTables">
            <div className="fibTable">
              <div className="fibTableTitle">RETRACEMENT LEVELS</div>
              {fibonacci.retracements.map((level) => (
                <div
                  className={
                    level.ratio === 0.618 ||
                    level.ratio === 0.705 ||
                    level.ratio === 0.786
                      ? "fibRow important"
                      : "fibRow"
                  }
                  key={level.ratio}
                >
                  <span>{level.label}</span>
                  <strong>
                    {level.price.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })}
                  </strong>
                </div>
              ))}
            </div>

            <div className="fibTable">
              <div className="fibTableTitle">TREND FIB EXTENSIONS</div>
              {fibonacci.trendExtension ? (
                <>
                  <div className="extensionMeta">
                    {fibonacci.trendExtension.direction.toUpperCase()} ·
                    A→B→C confirmed
                  </div>
                  {fibonacci.trendExtension.levels.map((level) => (
                    <div
                      className={
                        level.ratio === 1.272 ||
                        level.ratio === 1.618
                          ? "fibRow extension important"
                          : "fibRow extension"
                      }
                      key={level.ratio}
                    >
                      <span>{level.label}</span>
                      <strong>
                        {level.price.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                      </strong>
                    </div>
                  ))}
                </>
              ) : (
                <p className="analysisWaiting">
                  Waiting for a confirmed A→B→C three-swing structure.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="analysisWaiting">
            More confirmed candles are needed before automatic Fib anchors can
            be selected.
          </p>
        )}

        {orderBlocks.activeBlocks.length ? (
          <div className="orderBlockPanel">
            <span className="toolbarLabel">VALID / TOUCHED ORDER BLOCKS</span>
            <div className="orderBlockRows">
              {orderBlocks.activeBlocks
                .slice()
                .reverse()
                .map((block) => (
                  <div
                    className={`orderBlockRow ${block.direction} ${block.status}`}
                    key={`${block.sourceTime}-${block.direction}`}
                  >
                    <div>
                      <strong>
                        {block.direction === "bullish" ? "Bull OB" : "Bear OB"}
                      </strong>
                      <span>
                        {block.createdByEventType} · {block.status.toUpperCase()}
                      </span>
                    </div>
                    <div>
                      {block.lower.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })}
                      {" – "}
                      {block.upper.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {imbalance.activeFvgs.length ? (
          <div className="imbalanceGrid">
            <div className="imbalancePanel">
              <span className="toolbarLabel">ACTIVE / TOUCHED FVGs</span>
              <div className="fvgRows">
                {imbalance.activeFvgs
                  .slice()
                  .reverse()
                  .map((gap) => (
                    <div
                      className={`fvgRow ${gap.direction} ${gap.status}`}
                      key={`${gap.createdTime}-${gap.direction}`}
                    >
                      <div>
                        <strong>
                          {gap.direction === "bullish" ? "Bull FVG" : "Bear FVG"}
                        </strong>
                        <span>{gap.status.toUpperCase()}</span>
                      </div>
                      <div>
                        {gap.lower.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                        {" – "}
                        {gap.upper.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="imbalancePanel">
              <span className="toolbarLabel">RECENT LIQUIDITY SWEEPS</span>
              {imbalance.recentSweeps.length ? (
                <div className="eventChips">
                  {imbalance.recentSweeps
                    .slice()
                    .reverse()
                    .map((sweep) => (
                      <span
                        className={`eventChip ${sweep.direction}`}
                        key={`${sweep.time}-${sweep.direction}-${sweep.level}`}
                      >
                        Sweep {sweep.direction === "bullish" ? "↑" : "↓"}{" "}
                        {sweep.level.toLocaleString("en-IN", {
                          maximumFractionDigits: 2
                        })}
                      </span>
                    ))}
                </div>
              ) : (
                <p className="analysisWaiting">
                  No confirmed liquidity sweep in the loaded window.
                </p>
              )}
            </div>
          </div>
        ) : imbalance.recentSweeps.length ? (
          <div className="imbalancePanel standalone">
            <span className="toolbarLabel">RECENT LIQUIDITY SWEEPS</span>
            <div className="eventChips">
              {imbalance.recentSweeps
                .slice()
                .reverse()
                .map((sweep) => (
                  <span
                    className={`eventChip ${sweep.direction}`}
                    key={`${sweep.time}-${sweep.direction}-${sweep.level}`}
                  >
                    Sweep {sweep.direction === "bullish" ? "↑" : "↓"}{" "}
                    {sweep.level.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        {structure.recentEvents.length ? (
          <div className="structureEvents">
            <span className="toolbarLabel">RECENT BOS / CHoCH EVENTS</span>
            <div className="eventChips">
              {structure.recentEvents
                .slice()
                .reverse()
                .map((event) => (
                  <span
                    className={`eventChip ${event.direction}`}
                    key={`${event.time}-${event.type}-${event.direction}`}
                  >
                    {event.type}{" "}
                    {event.direction === "bullish" ? "↑" : "↓"}{" "}
                    {event.brokenLevel.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        {fibonacci.recentSwings.length ? (
          <div className="recentSwings">
            <span className="toolbarLabel">RECENT CONFIRMED SWINGS</span>
            <div className="swingChips">
              {fibonacci.recentSwings.map((swing) => (
                <span
                  className={
                    swing.type === "high"
                      ? "swingChip high"
                      : "swingChip low"
                  }
                  key={`${swing.time}-${swing.type}`}
                >
                  {swing.type === "high" ? "H" : "L"}{" "}
                  {swing.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <NewsImpactPanel
        events={newsEvents}
        gate={newsGate}
        connected={newsConnected}
        xConfigured={newsXConfigured}
        xStreaming={newsXStreaming}
      />

      {!selectedIsKraken && connected && !streamConnected && socketDiagnostic ? (
        <section className={showAdvancedAnalysis ? "card" : "card advancedHidden"}>
          <p className="label">Safe socket diagnostic</p>
          <div className="quoteGrid">
            <div><span>SDK loaded</span><strong>{socketDiagnostic.sdkLoaded ? "Yes" : "No"}</strong></div>
            <div><span>Data Socket found</span><strong>{socketDiagnostic.sdkHasDataSocket ? "Yes" : "No"}</strong></div>
            <div><span>getInstance found</span><strong>{socketDiagnostic.sdkHasGetInstance ? "Yes" : "No"}</strong></div>
            <div><span>Token is JWT</span><strong>{socketDiagnostic.tokenLooksLikeJwt ? "Yes" : "No"}</strong></div>
            <div><span>Token has hsm_key</span><strong>{socketDiagnostic.tokenHasHsmKey ? "Yes" : "No"}</strong></div>
            <div><span>SDK error</span><strong>{String(socketDiagnostic.sdkError || "None")}</strong></div>
          </div>
        </section>
      ) : null}

      <section className="card roadmap">
        <p className="label">PLATFORM RULE</p>
        <p>
          ALLINONEVIEW uses real market data and deterministic analysis. The simple
          plan stays in WAIT / NO TRADE unless the required trend, retracement,
          liquidity or Order Block trigger, confirmation, invalidation and
          reward/risk conditions are actually present.
        </p>
      </section>
    </main>
  );
}
