"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type CandlestickData,
  type Coordinate,
  type IChartApi,
  LineStyle,
  type ISeriesApi,
  type Time
} from "lightweight-charts";
import { emaSeries } from "@/lib/analysis/indicators";
import type { OrderFlowBucket } from "@/lib/analysis/order-flow";
import type { DailyPivotLevels } from "@/lib/analysis/pivots";
import {
  calculateVwapOverlay,
  type VolumeAnalytics,
  type VwapSettings
} from "@/lib/analysis/volume";
import type {
  FibonacciSetup,
  ImbalanceLiquiditySnapshot,
  MarketStructureSnapshot,
  OrderBlockSnapshot
} from "@/lib/analysis/market-structure";

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  oi?: number;
};

type DrawingTool =
  | "cursor"
  | "trend"
  | "horizontal"
  | "measure"
  | "text"
  | "note";

type DrawingPoint = {
  time: number;
  price: number;
};

type ChartDrawing = {
  id: string;
  type: Exclude<DrawingTool, "cursor">;
  points: DrawingPoint[];
  text?: string;
};

export type TradeChartMarker = {
  id: string;
  time: number;
  price: number;
  direction: "long" | "short";
  status: "OPEN" | "CLOSED";
  outcome?: string;
  setupType?: "PRIMARY" | "REACTION";
  moveClass?: "TACTICAL" | "MAJOR";
};

type Props = {
  candles: ChartCandle[];
  liveCandle?: ChartCandle | null;
  fitNonce?: number;
  rangeKey?: "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";
  fibonacci?: FibonacciSetup | null;
  structure?: MarketStructureSnapshot | null;
  imbalance?: ImbalanceLiquiditySnapshot | null;
  orderBlocks?: OrderBlockSnapshot | null;
  volumeAnalytics?: VolumeAnalytics | null;
  emaPeriods?: number[];
  vwapSettings?: VwapSettings;
  pivotSets?: DailyPivotLevels[];
  showFib?: boolean;
  showTrendFib?: boolean;
  showStructure?: boolean;
  showFvg?: boolean;
  showLiquidity?: boolean;
  showOrderBlocks?: boolean;
  showVwap?: boolean;
  showProfile?: boolean;
  showPivots?: boolean;
  showEma?: boolean;
  market?: string;
  resolution?: string;
  showSessionBreaks?: boolean;
  orderFlowBuckets?: OrderFlowBucket[];
  showOrderFlow?: boolean;
  tradeMarkers?: TradeChartMarker[];
  theme?: "dark" | "light";
  instrumentKey?: string;
};

function formatIst(timestamp: number) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp * 1000));
}

function chartHeightForHost(host: HTMLDivElement) {
  if (document.fullscreenElement) {
    return Math.max(320, host.clientHeight || window.innerHeight - 180);
  }

  if (window.innerWidth <= 380) {
    return Math.max(350, Math.min(500, Math.round(window.innerHeight * 0.5)));
  }

  if (window.innerWidth <= 900) {
    return Math.max(380, Math.min(600, Math.round(window.innerHeight * 0.57)));
  }

  return Math.max(520, host.clientHeight || 560);
}

function sessionKey(timestamp: number, market: string) {
  const timeZone = market === "KRAKEN" ? "UTC" : "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp * 1000));

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function isIntradayResolution(resolution: string) {
  return !["1D", "1W", "1M", "D", "W", "M"].includes(resolution);
}

function resolutionSeconds(resolution: string) {
  const numeric = Number(resolution);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 60);
  }

  const map: Record<string, number> = {
    "1H": 60 * 60,
    "2H": 2 * 60 * 60,
    "3H": 3 * 60 * 60,
    "4H": 4 * 60 * 60,
    "1D": 24 * 60 * 60,
    D: 24 * 60 * 60,
    "1W": 7 * 24 * 60 * 60,
    W: 7 * 24 * 60 * 60,
    "1M": 30 * 24 * 60 * 60,
    M: 30 * 24 * 60 * 60
  };

  return map[resolution] ?? 60;
}

function indianMarketMinute(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp * 1000));

  const weekday =
    parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(
    parts.find((part) => part.type === "hour")?.value ?? 0
  );
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0
  );

  return {
    weekday,
    minuteOfDay: hour * 60 + minute
  };
}

function futureAxisTimes(
  lastTime: number,
  market: string,
  resolution: string,
  count = 80
) {
  const step = resolutionSeconds(resolution);
  const output: number[] = [];

  if (!isIntradayResolution(resolution)) {
    for (let index = 1; index <= count; index += 1) {
      output.push(lastTime + step * index);
    }
    return output;
  }

  let candidate = lastTime;

  while (output.length < count) {
    candidate += step;

    if (market === "KRAKEN") {
      output.push(candidate);
      continue;
    }

    const local = indianMarketMinute(candidate);
    const weekdayOkay =
      local.weekday !== "Sat" && local.weekday !== "Sun";
    const sessionOkay =
      local.minuteOfDay >= 9 * 60 + 15 &&
      local.minuteOfDay <= 15 * 60 + 30;

    if (weekdayOkay && sessionOkay) {
      output.push(candidate);
    }
  }

  return output;
}

function formatAxisTick(
  timestamp: number,
  market: string,
  resolution: string
) {
  const timeZone = market === "KRAKEN" ? "UTC" : "Asia/Kolkata";

  if (isIntradayResolution(resolution)) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp * 1000));
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short"
  }).format(new Date(timestamp * 1000));
}

function toEpoch(time: Time): number | null {
  if (typeof time === "number") return time;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  if (typeof time === "object" && time && "year" in time) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }
  return null;
}

export default function MarketChart({
  candles,
  liveCandle = null,
  fitNonce = 0,
  rangeKey = "1M",
  fibonacci = null,
  structure = null,
  imbalance = null,
  orderBlocks = null,
  volumeAnalytics = null,
  emaPeriods = [],
  pivotSets = [],
  vwapSettings = {
    hideOnDailyOrAbove: true,
    anchorPeriod: "session",
    source: "hlc3",
    offset: 0,
    bandsMode: "stdev",
    bands: [
      { enabled: true, multiplier: 1 },
      { enabled: false, multiplier: 2 },
      { enabled: false, multiplier: 3 }
    ]
  },
  showFib = true,
  showTrendFib = true,
  showStructure = true,
  showFvg = true,
  showLiquidity = true,
  showOrderBlocks = true,
  showVwap = true,
  showProfile = true,
  showPivots = false,
  showEma = true,
  market = "NSE",
  resolution = "15",
  showSessionBreaks = true,
  orderFlowBuckets = [],
  showOrderFlow = true,
  tradeMarkers = [],
  theme = "dark",
  instrumentKey = "default"
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const futureAxisSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const futureAxisAnchorRef = useRef<string | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const vwapBandSeriesRefs = useRef<
    Map<string, ISeriesApi<"Line">>
  >(new Map());
  const emaSeriesRefs = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const [hovered, setHovered] = useState<ChartCandle | null>(null);
  const [activeOrderFlowTime, setActiveOrderFlowTime] = useState<number | null>(
    null
  );
  const [fibLevelPositions, setFibLevelPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      label: string;
      important: boolean;
      anchor: boolean;
    }>
  >([]);
  const [fibGoldenZonePosition, setFibGoldenZonePosition] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);
  const [trendFibLevelPositions, setTrendFibLevelPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      label: string;
      important: boolean;
    }>
  >([]);
  const [orderBlockZonePositions, setOrderBlockZonePositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      height: number;
      direction: "bullish" | "bearish";
    }>
  >([]);
  const [volumeProfilePositions, setVolumeProfilePositions] = useState<
    Array<{
      key: string;
      left: number;
      top: number;
      height: number;
      buyWidth: number;
      sellWidth: number;
      totalWidth: number;
    }>
  >([]);
  const [volumeProfileLevelPositions, setVolumeProfileLevelPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      label: "POC" | "VAH" | "VAL";
    }>
  >([]);
  const [structureEventPositions, setStructureEventPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      type: "BOS" | "CHoCH";
      direction: "bullish" | "bearish";
    }>
  >([]);
  const [fvgZonePositions, setFvgZonePositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      height: number;
      direction: "bullish" | "bearish";
      status: "active" | "touched" | "filled";
    }>
  >([]);
  const [liquidityLevelPositions, setLiquidityLevelPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      height: number;
      side: "buy" | "sell";
      importance: "minor" | "major";
      level: number;
    }>
  >([]);
  const [pivotLinePositions, setPivotLinePositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      label: string;
      value: number;
      kind: "pivot" | "resistance" | "support";
    }>
  >([]);
  const [sessionBreakPositions, setSessionBreakPositions] = useState<
    Array<{ time: number; x: number }>
  >([]);
  const [orderFlowBarPositions, setOrderFlowBarPositions] = useState<
    Array<{
      time: number;
      x: number;
      width: number;
      totalHeight: number;
      buyHeight: number;
      sellHeight: number;
      partial: boolean;
      buyPercent: number;
      sellPercent: number;
      buyTrades: number;
      sellTrades: number;
      delta: number;
      deltaPercent: number;
      cumulativeDelta: number;
      oi: number | null;
      oiChange: number | null;
      buyVolume: number;
      sellVolume: number;
    }>
  >([]);
  const [tradeMarkerPositions, setTradeMarkerPositions] = useState<
    Array<TradeChartMarker & { x: number; y: number }>
  >([]);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [pendingDrawingPoint, setPendingDrawingPoint] =
    useState<DrawingPoint | null>(null);
  const [drawingRevision, setDrawingRevision] = useState(0);

  const visibleRangeInitRef = useRef<string | null>(null);

  const drawingsStorageKey =
    "allinoneview:drawings:v1:" + instrumentKey;

  useEffect(() => {
    setActiveOrderFlowTime(null);
    visibleRangeInitRef.current = null;
    futureAxisAnchorRef.current = null;
    try {
      const saved = window.localStorage.getItem(drawingsStorageKey);
      const parsed = saved ? JSON.parse(saved) : [];
      setDrawings(Array.isArray(parsed) ? parsed : []);
    } catch {
      setDrawings([]);
    }
    setPendingDrawingPoint(null);
    setDrawingTool("cursor");
  }, [drawingsStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(
      drawingsStorageKey,
      JSON.stringify(drawings)
    );
  }, [drawingsStorageKey, drawings]);

  const cumulativeDeltaByTime = useMemo(() => {
    let cumulative = 0;
    const map = new Map<number, number>();

    for (const bucket of [...orderFlowBuckets].sort(
      (a, b) => a.time - b.time
    )) {
      cumulative += bucket.buyVolume - bucket.sellVolume;
      map.set(bucket.time, cumulative);
    }

    return map;
  }, [orderFlowBuckets]);

  const latest = useMemo(
    () => liveCandle ?? (candles.length ? candles[candles.length - 1] : null),
    [candles, liveCandle]
  );

  const sessionBreakTimes = useMemo(() => {
    if (!showSessionBreaks || !isIntradayResolution(resolution)) return [];

    const source =
      liveCandle &&
      (!candles.length || liveCandle.time > candles[candles.length - 1].time)
        ? [...candles, liveCandle]
        : candles;

    if (source.length < 2) return [];

    const breaks: number[] = [];
    let previousSession = sessionKey(source[0].time, market);

    for (let index = 1; index < source.length; index += 1) {
      const currentSession = sessionKey(source[index].time, market);
      if (currentSession !== previousSession) {
        breaks.push(source[index].time);
        previousSession = currentSession;
      }
    }

    return breaks;
  }, [candles, liveCandle, market, resolution, showSessionBreaks]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const isLight = theme === "light";
    const chart = createChart(host, {
      width: host.clientWidth,
      height: chartHeightForHost(host),
      layout: {
        background: {
          type: ColorType.Solid,
          color: isLight ? "#ffffff" : "#0a0f16"
        },
        textColor: isLight ? "#475569" : "#9ca8ba",
        attributionLogo: true
      },
      localization: {
        locale: "en-IN",
        timeFormatter: (time: Time) => {
          const epoch = toEpoch(time);
          return epoch ? formatIst(epoch) : "";
        }
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: "transparent" }
      },
      rightPriceScale: {
        borderColor: isLight ? "#cbd5e1" : "#263143",
        autoScale: true
      },
      timeScale: {
        borderColor: isLight ? "#cbd5e1" : "#263143",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
        tickMarkFormatter: (time: Time) => {
          const epoch = toEpoch(time);
          return epoch ? formatAxisTick(epoch, market, resolution) : "";
        }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isLight ? "#64748b" : "#77839a",
          width: 1,
          labelBackgroundColor: isLight ? "#64748b" : "#263143"
        },
        horzLine: {
          color: isLight ? "#64748b" : "#77839a",
          width: 1,
          labelBackgroundColor: isLight ? "#64748b" : "#263143"
        }
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      },
      kineticScroll: {
        mouse: true,
        touch: true
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#28c76f",
      downColor: "#ea5455",
      borderUpColor: "#28c76f",
      borderDownColor: "#ea5455",
      wickUpColor: "#28c76f",
      wickDownColor: "#ea5455",
      priceLineVisible: true
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: "#f5b942",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "VWAP"
    });

    const futureAxisSeries = chart.addSeries(LineSeries, {
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: "future-axis"
    });

    chartRef.current = chart;
    seriesRef.current = series;
    vwapSeriesRef.current = vwapSeries;
    futureAxisSeriesRef.current = futureAxisSeries;

    chart.subscribeCrosshairMove((param) => {
      const item = param.seriesData.get(series);
      if (!item || !("open" in item) || !param.time) {
        setHovered(null);
        return;
      }

      const epoch = toEpoch(param.time);
      if (!epoch) {
        setHovered(null);
        return;
      }

      setHovered({
        time: epoch,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close)
      });
    });

    const scheduleOverlayRedraw = () => {
      if (overlayRafRef.current !== null) return;
      overlayRafRef.current = window.requestAnimationFrame(() => {
        overlayRafRef.current = null;
        setDrawingRevision((value) => value + 1);
      });
    };

    const observer = new ResizeObserver(() => {
      chart.applyOptions({
        width: host.clientWidth,
        height: chartHeightForHost(host)
      });
      scheduleOverlayRedraw();
    });
    observer.observe(host);

    chart.timeScale().subscribeVisibleLogicalRangeChange(
      scheduleOverlayRedraw
    );

    host.addEventListener("pointerup", scheduleOverlayRedraw, {
      passive: true
    });
    host.addEventListener("touchend", scheduleOverlayRedraw, {
      passive: true
    });
    window.addEventListener("resize", scheduleOverlayRedraw);

    const onVerticalWheel = (event: WheelEvent) => {
      const priceScale = chart.priceScale("right");
      const scaleWidth = priceScale.width();
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const overPriceScale =
        scaleWidth > 0 && x >= host.clientWidth - scaleWidth - 6;

      if (!overPriceScale && !event.altKey) return;

      const visible = priceScale.getVisibleRange();
      if (!visible) return;

      event.preventDefault();
      event.stopPropagation();

      const span = visible.to - visible.from;
      if (!(span > 0)) return;

      const yRatio = Math.max(
        0,
        Math.min(1, (event.clientY - rect.top) / Math.max(1, host.clientHeight))
      );
      const anchor = visible.to - yRatio * span;
      const factor = event.deltaY > 0 ? 1.12 : 0.88;
      const nextSpan = span * factor;

      priceScale.setAutoScale(false);
      priceScale.setVisibleRange({
        from: anchor - (1 - yRatio) * nextSpan,
        to: anchor + yRatio * nextSpan
      });
      scheduleOverlayRedraw();
    };

    host.addEventListener("wheel", onVerticalWheel, {
      passive: false,
      capture: true
    });

    return () => {
      host.removeEventListener("wheel", onVerticalWheel, true);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(
        scheduleOverlayRedraw
      );
      host.removeEventListener("pointerup", scheduleOverlayRedraw);
      host.removeEventListener("touchend", scheduleOverlayRedraw);
      window.removeEventListener("resize", scheduleOverlayRedraw);
      if (overlayRafRef.current !== null) {
        window.cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      vwapSeriesRef.current = null;
      futureAxisSeriesRef.current = null;
      futureAxisAnchorRef.current = null;
      vwapBandSeriesRefs.current.clear();
      emaSeriesRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const isLight = theme === "light";

    chart.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: isLight ? "#ffffff" : "#0a0f16"
        },
        textColor: isLight ? "#475569" : "#9ca8ba",
        attributionLogo: true
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: "transparent" }
      },
      rightPriceScale: {
        borderColor: isLight ? "#cbd5e1" : "#263143"
      },
      timeScale: {
        borderColor: isLight ? "#cbd5e1" : "#263143"
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isLight ? "#64748b" : "#77839a",
          width: 1,
          labelBackgroundColor: isLight ? "#64748b" : "#263143"
        },
        horzLine: {
          color: isLight ? "#64748b" : "#77839a",
          width: 1,
          labelBackgroundColor: isLight ? "#64748b" : "#263143"
        }
      }
    });
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const timeZone = market === "KRAKEN" ? "UTC" : "Asia/Kolkata";

    chart.applyOptions({
      localization: {
        locale: "en-IN",
        timeFormatter: (time: Time) => {
          const epoch = toEpoch(time);
          if (!epoch) return "";
          return new Intl.DateTimeFormat("en-GB", {
            timeZone,
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }).format(new Date(epoch * 1000));
        }
      }
    });

    chart.applyOptions({
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        ignoreWhitespaceIndices: false,
        tickMarkFormatter: (time: Time) => {
          const epoch = toEpoch(time);
          return epoch ? formatAxisTick(epoch, market, resolution) : "";
        }
      }
    });
  }, [market, resolution]);

  useEffect(() => {
    if (!seriesRef.current) return;

    if (candles.length === 0) {
      seriesRef.current.setData([]);
      return;
    }

    const data: CandlestickData<Time>[] = candles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    }));

    seriesRef.current.setData(data);

    const chart = chartRef.current;
    if (!chart) return;

    const historyKey =
      instrumentKey +
      ":" +
      rangeKey +
      ":" +
      candles[0].time +
      ":" +
      candles[candles.length - 1].time +
      ":" +
      candles.length;

    if (visibleRangeInitRef.current === historyKey) return;
    visibleRangeInitRef.current = historyKey;

    if (rangeKey === "MAX") {
      chart.timeScale().fitContent();
      return;
    }

    const secondsByRange: Record<Exclude<Props["rangeKey"], undefined | "MAX">, number> = {
      "1D": 24 * 60 * 60,
      "5D": 5 * 24 * 60 * 60,
      "1M": 31 * 24 * 60 * 60,
      "3M": 93 * 24 * 60 * 60,
      "6M": 186 * 24 * 60 * 60,
      "1Y": 366 * 24 * 60 * 60,
      "5Y": 5 * 366 * 24 * 60 * 60
    };

    const lastTime = candles[candles.length - 1].time;
    const firstTime = candles[0].time;
    const desiredFrom = lastTime - secondsByRange[rangeKey];

    chart.timeScale().setVisibleRange({
      from: Math.max(firstTime, desiredFrom) as Time,
      to: lastTime as Time
    });
  }, [candles, rangeKey]);

  useEffect(() => {
    const futureSeries = futureAxisSeriesRef.current;
    if (!futureSeries) return;

    const lastTime =
      liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;

    if (lastTime === null) {
      if (futureAxisAnchorRef.current !== null) {
        futureSeries.setData([]);
        futureAxisAnchorRef.current = null;
      }
      return;
    }

    const anchorKey = `${market}:${resolution}:${lastTime}`;

    if (futureAxisAnchorRef.current === anchorKey) return;

    futureSeries.setData(
      futureAxisTimes(lastTime, market, resolution).map((time) => ({
        time: time as Time
      }))
    );
    futureAxisAnchorRef.current = anchorKey;
  }, [candles, liveCandle?.time, market, resolution]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !host ||
      !showSessionBreaks ||
      sessionBreakTimes.length === 0
    ) {
      setSessionBreakPositions([]);
      return;
    }

    const updatePositions = () => {
      const width = host.clientWidth;
      const positions = sessionBreakTimes.flatMap((time) => {
        const coordinate = chart.timeScale().timeToCoordinate(time as Time);

        if (
          coordinate === null ||
          coordinate < 0 ||
          coordinate > width
        ) {
          return [];
        }

        return [
          {
            time,
            x: Number(coordinate)
          }
        ];
      });

      setSessionBreakPositions(positions);
    };

    updatePositions();
  }, [sessionBreakTimes, showSessionBreaks, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    const series = seriesRef.current;

    if (!chart || !host || !series || tradeMarkers.length === 0) {
      setTradeMarkerPositions([]);
      return;
    }

    const updateMarkers = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;

      setTradeMarkerPositions(
        tradeMarkers.flatMap((marker) => {
          const x = chart.timeScale().timeToCoordinate(marker.time as Time);
          const y = series.priceToCoordinate(marker.price);

          if (
            x === null ||
            y === null ||
            Number(x) < -40 ||
            Number(x) > width + 40 ||
            Number(y) < -40 ||
            Number(y) > height + 40
          ) {
            return [];
          }

          return [
            {
              ...marker,
              x: Number(x),
              y: Number(y)
            }
          ];
        })
      );
    };

    updateMarkers();
  }, [tradeMarkers, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    if (!liveCandle || !seriesRef.current) return;

    const latestHistoricalTime =
      candles.length > 0 ? candles[candles.length - 1].time : 0;

    // Kraken can send a snapshot candle before the REST tail we already loaded.
    // Lightweight Charts rejects out-of-order update() calls, so ignore those.
    if (liveCandle.time < latestHistoricalTime) return;

    seriesRef.current.update({
      time: liveCandle.time as Time,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close
    });
  }, [liveCandle, candles]);


  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !series ||
      !host ||
      !showFib ||
      !fibonacci?.anchorA ||
      !fibonacci.anchorB ||
      !fibonacci.retracements.length
    ) {
      setFibLevelPositions([]);
      setFibGoldenZonePosition(null);
      return;
    }

    const updateFib = () => {
      const hostWidth = host.clientWidth;
      const startX = chart.timeScale().timeToCoordinate(
        fibonacci.anchorA!.time as Time
      );
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);
      const anchorBX = chart.timeScale().timeToCoordinate(
        fibonacci.anchorB!.time as Time
      );

      if (startX === null) {
        setFibLevelPositions([]);
        setFibGoldenZonePosition(null);
        return;
      }

      const rawLeft = Number(startX);
      const rawRight =
        latestX !== null
          ? Number(latestX)
          : anchorBX !== null
            ? Number(anchorBX)
            : hostWidth;

      const left = Math.max(0, rawLeft);
      const right = Math.min(hostWidth, Math.max(rawLeft, rawRight));

      if (right - left < 2) {
        setFibLevelPositions([]);
        setFibGoldenZonePosition(null);
        return;
      }

      setFibLevelPositions(
        fibonacci.retracements.flatMap((level) => {
          const y = series.priceToCoordinate(level.price);
          if (y === null) return [];

          return [{
            key: `fib:${level.ratio}`,
            left,
            width: right - left,
            top: Number(y),
            label:
              `${level.ratio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} · ` +
              level.price.toLocaleString("en-IN", {
                maximumFractionDigits: 2
              }),
            important:
              level.ratio === 0.5 ||
              level.ratio === 0.618 ||
              level.ratio === 0.705 ||
              level.ratio === 0.786,
            anchor: level.ratio === 0 || level.ratio === 1
          }];
        })
      );

      if (fibonacci.goldenZone) {
        const upperY = series.priceToCoordinate(fibonacci.goldenZone.high);
        const lowerY = series.priceToCoordinate(fibonacci.goldenZone.low);

        if (upperY !== null && lowerY !== null) {
          const top = Math.min(Number(upperY), Number(lowerY));
          const bottom = Math.max(Number(upperY), Number(lowerY));
          setFibGoldenZonePosition({
            left,
            width: right - left,
            top,
            height: Math.max(2, bottom - top)
          });
        } else {
          setFibGoldenZonePosition(null);
        }
      } else {
        setFibGoldenZonePosition(null);
      }
    };

    updateFib();
  }, [showFib, fibonacci, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;
    const trend = fibonacci?.trendExtension;

    if (!chart || !series || !host || !showTrendFib || !trend) {
      setTrendFibLevelPositions([]);
      return;
    }

    const updateTrendFib = () => {
      const hostWidth = host.clientWidth;
      const startX = chart.timeScale().timeToCoordinate(
        trend.anchorC.time as Time
      );
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);

      if (startX === null) {
        setTrendFibLevelPositions([]);
        return;
      }

      const rawLeft = Number(startX);
      const rawRight = latestX === null ? hostWidth : Number(latestX);
      const left = Math.max(0, rawLeft);
      const right = Math.min(hostWidth, Math.max(rawLeft, rawRight));

      if (right - left < 2) {
        setTrendFibLevelPositions([]);
        return;
      }

      setTrendFibLevelPositions(
        trend.levels.flatMap((level) => {
          const y = series.priceToCoordinate(level.price);
          if (y === null) return [];

          return [{
            key: `trend-fib:${level.ratio}`,
            left,
            width: right - left,
            top: Number(y),
            label:
              `${level.label} · ` +
              level.price.toLocaleString("en-IN", {
                maximumFractionDigits: 2
              }),
            important:
              level.ratio === 1 ||
              level.ratio === 1.272 ||
              level.ratio === 1.618
          }];
        })
      );
    };

    updateTrendFib();
  }, [showTrendFib, fibonacci, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !series ||
      !host ||
      !showOrderBlocks ||
      !orderBlocks?.activeBlocks.length
    ) {
      setOrderBlockZonePositions([]);
      return;
    }

    const updateOrderBlocks = () => {
      const hostWidth = host.clientWidth;
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);
      const rightBoundary =
        latestX === null ? hostWidth : Math.min(hostWidth, Number(latestX));

      setOrderBlockZonePositions(
        orderBlocks.activeBlocks.flatMap((block) => {
          const startX = chart.timeScale().timeToCoordinate(
            block.sourceTime as Time
          );
          const upperY = series.priceToCoordinate(block.upper);
          const lowerY = series.priceToCoordinate(block.lower);

          if (startX === null || upperY === null || lowerY === null) return [];

          const rawLeft = Number(startX);
          if (rawLeft > rightBoundary) return [];

          const left = Math.max(0, rawLeft);
          const right = Math.max(left, rightBoundary);
          if (right - left < 2) return [];

          const top = Math.min(Number(upperY), Number(lowerY));
          const bottom = Math.max(Number(upperY), Number(lowerY));

          return [{
            key: `ob:${block.direction}:${block.sourceTime}`,
            left,
            width: right - left,
            top,
            height: Math.max(3, bottom - top),
            direction: block.direction
          }];
        })
      );
    };

    updateOrderBlocks();
  }, [showOrderBlocks, orderBlocks, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !series ||
      !host ||
      !showProfile ||
      !volumeAnalytics?.available ||
      !volumeAnalytics.profile.bins.length
    ) {
      setVolumeProfilePositions([]);
      setVolumeProfileLevelPositions([]);
      return;
    }

    const updateProfile = () => {
      const hostWidth = host.clientWidth;
      const priceScaleWidth = chart.priceScale("right").width();
      const plotRight = Math.max(80, hostWidth - priceScaleWidth);
      const maxProfileWidth = Math.max(48, plotRight * 0.1);
      const maxVolume = Math.max(
        ...volumeAnalytics.profile.bins.map((bin) => bin.volume),
        0
      );

      if (!(maxVolume > 0)) {
        setVolumeProfilePositions([]);
        setVolumeProfileLevelPositions([]);
        return;
      }

      setVolumeProfilePositions(
        volumeAnalytics.profile.bins.flatMap((bin, index) => {
          if (!(bin.volume > 0)) return [];

          const highY = series.priceToCoordinate(bin.high);
          const lowY = series.priceToCoordinate(bin.low);
          if (highY === null || lowY === null) return [];

          const top = Math.min(Number(highY), Number(lowY));
          const bottom = Math.max(Number(highY), Number(lowY));
          const totalWidth = Math.max(
            1,
            maxProfileWidth * (bin.volume / maxVolume)
          );
          const buyShare =
            bin.volume > 0 ? bin.buyVolume / bin.volume : 0.5;
          const buyWidth = totalWidth * buyShare;
          const sellWidth = Math.max(0, totalWidth - buyWidth);

          return [{
            key: `profile:${index}`,
            left: plotRight - totalWidth,
            top,
            height: Math.max(2, bottom - top - 1),
            buyWidth,
            sellWidth,
            totalWidth
          }];
        })
      );

      const profileLeft = plotRight - maxProfileWidth;
      const levels = [
        ["POC", volumeAnalytics.profile.poc],
        ["VAH", volumeAnalytics.profile.vah],
        ["VAL", volumeAnalytics.profile.val]
      ] as const;

      setVolumeProfileLevelPositions(
        levels.flatMap(([label, price]) => {
          if (price === null) return [];
          const y = series.priceToCoordinate(price);
          if (y === null) return [];
          return [{
            key: `profile-level:${label}`,
            left: profileLeft,
            width: maxProfileWidth,
            top: Number(y),
            label
          }];
        })
      );
    };

    updateProfile();
  }, [showProfile, volumeAnalytics, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !series ||
      !host ||
      !showFvg ||
      !imbalance?.recentFvgs.length
    ) {
      setFvgZonePositions([]);
      return;
    }

    const updateFvgs = () => {
      const hostWidth = host.clientWidth;
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);
      const activeRight =
        latestX === null ? hostWidth : Math.min(hostWidth, Number(latestX));

      const positions = imbalance.recentFvgs.flatMap((gap) => {
        const startX = chart.timeScale().timeToCoordinate(
          gap.createdTime as Time
        );
        const endX =
          gap.filledTime === null
            ? activeRight
            : chart.timeScale().timeToCoordinate(gap.filledTime as Time);

        const upperY = series.priceToCoordinate(gap.upper);
        const lowerY = series.priceToCoordinate(gap.lower);

        if (startX === null || upperY === null || lowerY === null) return [];

        const rawLeft = Number(startX);
        const rawRight = endX === null ? activeRight : Number(endX);

        if (rawRight < -20 || rawLeft > hostWidth + 20) return [];

        const left = Math.max(0, rawLeft);
        const right = Math.min(hostWidth, Math.max(rawLeft, rawRight));

        if (right - left < 2) return [];

        const top = Math.min(Number(upperY), Number(lowerY));
        const bottom = Math.max(Number(upperY), Number(lowerY));

        return [{
          key:
            gap.direction +
            ":" +
            gap.createdTime +
            ":" +
            gap.lower +
            ":" +
            gap.upper,
          left,
          width: right - left,
          top,
          height: Math.max(2, bottom - top),
          direction: gap.direction,
          status: gap.status
        }];
      });

      setFvgZonePositions(positions);
    };

    updateFvgs();
  }, [showFvg, imbalance, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (!chart || !series || !host || !showPivots || !pivotSets.length) {
      setPivotLinePositions([]);
      return;
    }

    const updatePivots = () => {
      const hostWidth = host.clientWidth;
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);
      const currentRight =
        latestX === null ? hostWidth : Math.min(hostWidth, Number(latestX));
      const positions: Array<{
        key: string;
        left: number;
        width: number;
        top: number;
        label: string;
        value: number;
        kind: "pivot" | "resistance" | "support";
      }> = [];

      for (const set of pivotSets) {
        const startX = chart.timeScale().timeToCoordinate(
          set.sessionStart as Time
        );
        const endX =
          set.sessionEnd === null
            ? currentRight
            : chart.timeScale().timeToCoordinate(set.sessionEnd as Time);

        if (startX === null) continue;

        const rawLeft = Number(startX);
        const rawRight = endX === null ? currentRight : Number(endX);

        if (rawRight < -20 || rawLeft > hostWidth + 20) continue;

        const left = Math.max(0, rawLeft);
        const right = Math.min(hostWidth, Math.max(rawLeft, rawRight));

        if (right - left < 2) continue;

        const levels: Array<{
          label: string;
          value: number;
          kind: "pivot" | "resistance" | "support";
        }> = [
          { label: "R5", value: set.r5, kind: "resistance" },
          { label: "R4", value: set.r4, kind: "resistance" },
          { label: "R3", value: set.r3, kind: "resistance" },
          { label: "R2", value: set.r2, kind: "resistance" },
          { label: "R1", value: set.r1, kind: "resistance" },
          { label: "P", value: set.p, kind: "pivot" },
          { label: "S1", value: set.s1, kind: "support" },
          { label: "S2", value: set.s2, kind: "support" },
          { label: "S3", value: set.s3, kind: "support" },
          { label: "S4", value: set.s4, kind: "support" },
          { label: "S5", value: set.s5, kind: "support" }
        ];

        for (const level of levels) {
          const y = series.priceToCoordinate(level.value);
          if (y === null) continue;

          positions.push({
            key: `${set.sessionKey}:${level.label}`,
            left,
            width: right - left,
            top: Number(y),
            label: level.label,
            value: level.value,
            kind: level.kind
          });
        }
      }

      setPivotLinePositions(positions);
    };

    updatePivots();
  }, [showPivots, pivotSets, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !series ||
      !host ||
      !showLiquidity ||
      !imbalance?.liquidityLevels.length
    ) {
      setLiquidityLevelPositions([]);
      return;
    }

    const updateLiquidity = () => {
      const hostWidth = host.clientWidth;
      const latestTime =
        liveCandle?.time ?? candles[candles.length - 1]?.time ?? null;
      const latestX =
        latestTime === null
          ? null
          : chart.timeScale().timeToCoordinate(latestTime as Time);
      const activeRight =
        latestX === null ? hostWidth : Math.min(hostWidth, Number(latestX));

      const positions = imbalance.liquidityLevels.flatMap((level) => {
        const sourceX = chart.timeScale().timeToCoordinate(
          level.sourceSwing.time as Time
        );
        const upperY = series.priceToCoordinate(level.zoneUpper);
        const lowerY = series.priceToCoordinate(level.zoneLower);

        if (sourceX === null || upperY === null || lowerY === null) return [];

        const rawLeft = Number(sourceX);

        if (rawLeft > hostWidth + 20) return [];

        const left = Math.max(0, rawLeft);
        const right = activeRight;

        if (right - left < 2) return [];

        const top = Math.min(Number(upperY), Number(lowerY));
        const bottom = Math.max(Number(upperY), Number(lowerY));

        return [{
          key:
            level.importance +
            ":" +
            level.side +
            ":" +
            level.sourceSwing.time,
          left,
          width: right - left,
          top,
          height: Math.max(
            level.importance === "major" ? 7 : 4,
            bottom - top
          ),
          side: level.side,
          importance: level.importance,
          level: level.level
        }];
      });

      setLiquidityLevelPositions(positions);
    };

    updateLiquidity();
  }, [showLiquidity, imbalance, candles, liveCandle, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;

    if (!chart || !series || !host || !showStructure || !structure?.events.length) {
      setStructureEventPositions([]);
      return;
    }

    const updateStructure = () => {
      const hostWidth = host.clientWidth;

      const positions = structure.events.flatMap((event) => {
        const sourceX = chart.timeScale().timeToCoordinate(
          event.sourceSwing.time as Time
        );
        const breakX = chart.timeScale().timeToCoordinate(event.time as Time);
        const y = series.priceToCoordinate(event.brokenLevel);

        if (sourceX === null || breakX === null || y === null) return [];

        const rawLeft = Math.min(Number(sourceX), Number(breakX));
        const rawRight = Math.max(Number(sourceX), Number(breakX));

        if (rawRight < -20 || rawLeft > hostWidth + 20) return [];

        const left = Math.max(0, rawLeft);
        const right = Math.min(hostWidth, rawRight);

        if (right - left < 2) return [];

        return [{
          key:
            event.type +
            ":" +
            event.direction +
            ":" +
            event.sourceSwing.time +
            ":" +
            event.time,
          left,
          width: right - left,
          top: Number(y),
          type: event.type,
          direction: event.direction
        }];
      });

      setStructureEventPositions(positions);
    };

    updateStructure();
  }, [showStructure, structure, drawingRevision]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;

    if (
      !chart ||
      !host ||
      !showOrderFlow ||
      orderFlowBuckets.length === 0
    ) {
      setOrderFlowBarPositions([]);
      return;
    }

    const updateBars = () => {
      const hostWidth = host.clientWidth;
      const maxPaneHeight = Math.max(
        48,
        Math.min(100, Math.round(host.clientHeight * 0.18))
      );

      const visible = orderFlowBuckets
        .map((bucket) => ({
          bucket,
          x: chart.timeScale().timeToCoordinate(bucket.time as Time)
        }))
        .filter(
          (
            item
          ): item is {
            bucket: OrderFlowBucket;
            x: Exclude<typeof item.x, null>;
          } =>
            item.x !== null &&
            Number(item.x) >= -20 &&
            Number(item.x) <= hostWidth + 20
        )
        .map((item) => ({
          bucket: item.bucket,
          x: Number(item.x)
        }))
        .sort((a, b) => a.x - b.x);

      if (!visible.length) {
        setOrderFlowBarPositions([]);
        return;
      }

      const totals = visible.map(
        ({ bucket }) => bucket.buyVolume + bucket.sellVolume
      );
      const maxTotal = Math.max(...totals, 0);

      const spacings = visible
        .slice(1)
        .map((item, index) => item.x - visible[index].x)
        .filter((spacing) => spacing > 1);
      const spacing = spacings.length
        ? Math.min(...spacings)
        : Math.max(6, chart.timeScale().options().barSpacing ?? 8);
      const width = Math.max(3, Math.min(52, spacing * 0.78));

      setOrderFlowBarPositions(
        visible.map(({ bucket, x }) => {
          const total = bucket.buyVolume + bucket.sellVolume;
          const totalHeight =
            maxTotal > 0
              ? Math.max(3, (total / maxTotal) * maxPaneHeight)
              : 0;
          const buyPercent =
            total > 0 ? (bucket.buyVolume / total) * 100 : 0;
          const sellPercent =
            total > 0 ? (bucket.sellVolume / total) * 100 : 0;
          const delta = bucket.buyVolume - bucket.sellVolume;
          const deltaPercent =
            total > 0 ? (delta / total) * 100 : 0;
          const buyHeight =
            total > 0 ? totalHeight * (bucket.buyVolume / total) : 0;
          const sellHeight = Math.max(0, totalHeight - buyHeight);
          const cumulativeDelta =
            cumulativeDeltaByTime.get(bucket.time) ?? delta;

          return {
            time: bucket.time,
            x,
            width,
            totalHeight,
            buyHeight,
            sellHeight,
            partial: bucket.partial,
            buyPercent,
            sellPercent,
            buyTrades: bucket.buyTrades,
            sellTrades: bucket.sellTrades,
            delta,
            deltaPercent,
            cumulativeDelta,
            oi: bucket.oi ?? null,
            oiChange: bucket.oiChange ?? null,
            buyVolume: bucket.buyVolume,
            sellVolume: bucket.sellVolume
          };
        })
      );
    };

    updateBars();
  }, [
    orderFlowBuckets,
    showOrderFlow,
    cumulativeDeltaByTime,
    drawingRevision
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const vwapSeries = vwapSeriesRef.current;
    if (!chart || !vwapSeries) return;

    const dailyOrAbove = ["1D", "1W", "1M"].includes(resolution);
    const visible =
      showVwap &&
      Boolean(volumeAnalytics?.available) &&
      !(vwapSettings.hideOnDailyOrAbove && dailyOrAbove);

    if (!visible) {
      vwapSeries.setData([]);
      for (const series of vwapBandSeriesRefs.current.values()) {
        try {
          chart.removeSeries(series);
        } catch {
          // Series may already be gone during chart teardown.
        }
      }
      vwapBandSeriesRefs.current.clear();
      return;
    }

    const source =
      liveCandle &&
      (!candles.length || liveCandle.time >= candles[candles.length - 1].time)
        ? liveCandle.time === candles[candles.length - 1]?.time
          ? [...candles.slice(0, -1), liveCandle]
          : [...candles, liveCandle]
        : candles;

    const overlay = calculateVwapOverlay(
      source,
      vwapSettings,
      market === "KRAKEN" ? "UTC" : "Asia/Kolkata"
    );

    vwapSeries.setData(
      overlay.vwap.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );

    const wanted = new Set<string>();

    overlay.bands.forEach((band, index) => {
      const bandNumber = index + 1;
      for (const side of ["upper", "lower"] as const) {
        const key = `${bandNumber}:${side}`;
        wanted.add(key);
        const existingSeries = vwapBandSeriesRefs.current.get(key);
        const series =
          existingSeries ??
          chart.addSeries(LineSeries, {
            color: ["#4d8dff", "#8b7cff", "#94a3b8"][index] ?? "#94a3b8",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            title: `VWAP B${bandNumber} ${side === "upper" ? "+" : "-"}`
          });

        if (!existingSeries) {
          vwapBandSeriesRefs.current.set(key, series);
        }

        series.setData(
          band[side].map((point) => ({
            time: point.time as Time,
            value: point.value
          }))
        );
      }
    });

    for (const [key, series] of vwapBandSeriesRefs.current.entries()) {
      if (wanted.has(key)) continue;
      try {
        chart.removeSeries(series);
      } catch {
        // Series may already be gone during chart teardown.
      }
      vwapBandSeriesRefs.current.delete(key);
    }
  }, [
    candles,
    liveCandle,
    market,
    resolution,
    showVwap,
    volumeAnalytics?.available,
    vwapSettings
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const normalizedPeriods = showEma
      ? [...new Set(emaPeriods)]
          .map((period) => Math.trunc(period))
          .filter((period) => Number.isFinite(period) && period > 0)
          .sort((a, b) => a - b)
      : [];

    const wanted = new Set(normalizedPeriods);

    for (const [period, series] of emaSeriesRefs.current.entries()) {
      if (wanted.has(period)) continue;
      try {
        chart.removeSeries(series);
      } catch {
        // Chart teardown can remove a dynamic EMA before this effect cleans it up.
      }
      emaSeriesRefs.current.delete(period);
    }

    const source =
      liveCandle &&
      (!candles.length || liveCandle.time >= candles[candles.length - 1].time)
        ? liveCandle.time === candles[candles.length - 1]?.time
          ? [...candles.slice(0, -1), liveCandle]
          : [...candles, liveCandle]
        : candles;

    for (const period of normalizedPeriods) {
      const existingSeries = emaSeriesRefs.current.get(period);
      const series =
        existingSeries ??
        chart.addSeries(LineSeries, {
          color: `hsl(${(period * 47) % 360} 78% 55%)`,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: `EMA ${period}`
        });

      if (!existingSeries) {
        emaSeriesRefs.current.set(period, series);
      }

      series.setData(
        emaSeries(source, period).map((point) => ({
          time: point.time as Time,
          value: point.value
        }))
      );
    }
  }, [candles, liveCandle, showEma, emaPeriods]);

  useEffect(() => {
    if (fitNonce > 0) {
      const chart = chartRef.current;
      chart?.priceScale("right").setAutoScale(true);
      chart?.timeScale().fitContent();
    }
  }, [fitNonce]);

  const toDrawingPoint = (
    clientX: number,
    clientY: number
  ): DrawingPoint | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;
    if (!chart || !series || !host) return null;

    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x as Coordinate);
    const price = series.coordinateToPrice(y as Coordinate);
    const epoch = time ? toEpoch(time) : null;

    if (epoch === null || price === null) return null;
    return { time: epoch, price: Number(price) };
  };

  const handleDrawingPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (drawingTool === "cursor") return;

    const point = toDrawingPoint(event.clientX, event.clientY);
    if (!point) return;

    if (drawingTool === "horizontal") {
      setDrawings((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          type: "horizontal",
          points: [point]
        }
      ]);
      return;
    }

    if (drawingTool === "text" || drawingTool === "note") {
      const text = window.prompt(
        drawingTool === "text" ? "Chart text" : "Chart note"
      );
      if (!text?.trim()) return;

      setDrawings((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          type: drawingTool,
          points: [point],
          text: text.trim()
        }
      ]);
      return;
    }

    if (!pendingDrawingPoint) {
      setPendingDrawingPoint(point);
      return;
    }

    setDrawings((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: drawingTool,
        points: [pendingDrawingPoint, point]
      }
    ]);
    setPendingDrawingPoint(null);
  };

  void drawingRevision;

  const drawingGeometry = drawings.flatMap((drawing) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;
    if (!chart || !series || !host) return [];

    const points = drawing.points.flatMap((point) => {
      const x = chart.timeScale().timeToCoordinate(point.time as Time);
      const y = series.priceToCoordinate(point.price);
      return x === null || y === null
        ? []
        : [{ x: Number(x), y: Number(y), ...point }];
    });

    if (points.length !== drawing.points.length) return [];

    return [
      {
        drawing,
        points,
        width: host.clientWidth,
        height: host.clientHeight
      }
    ];
  });

  const readout = hovered ?? latest;

  return (
    <div className="marketChartShell">
      {readout ? (
        <div className="crosshairReadout">
          <span>{formatIst(readout.time)}</span>
          <span>O <strong>{readout.open.toLocaleString("en-IN")}</strong></span>
          <span>H <strong>{readout.high.toLocaleString("en-IN")}</strong></span>
          <span>L <strong>{readout.low.toLocaleString("en-IN")}</strong></span>
          <span>C <strong>{readout.close.toLocaleString("en-IN")}</strong></span>
        </div>
      ) : null}
      <div className="chartToolRail" aria-label="Chart tools">
        {[
          ["cursor", "↖", "Cursor"],
          ["trend", "╱", "Trend line"],
          ["horizontal", "—", "Horizontal line"],
          ["measure", "↔", "Measure"],
          ["text", "T", "Text"],
          ["note", "✎", "Note"]
        ].map(([tool, icon, label]) => (
          <button
            type="button"
            key={tool}
            className={
              drawingTool === tool
                ? "chartTool active"
                : "chartTool"
            }
            title={label}
            onClick={() => {
              setDrawingTool(tool as DrawingTool);
              setPendingDrawingPoint(null);
            }}
          >
            {icon}
          </button>
        ))}
        <button
          type="button"
          className="chartTool danger"
          title="Clear drawings"
          onClick={() => {
            setDrawings([]);
            setPendingDrawingPoint(null);
            setDrawingTool("cursor");
          }}
        >
          ⌫
        </button>
      </div>

      <div
        className={
          drawingTool === "cursor"
            ? "drawingInteractionLayer inactive"
            : "drawingInteractionLayer"
        }
        onPointerDown={handleDrawingPointerDown}
        aria-hidden="true"
      />

      <svg
        className="drawingSvgLayer"
        aria-hidden="true"
      >
        {drawingGeometry.map(({ drawing, points, width }) => {
          const stroke =
            drawing.type === "measure"
              ? "#f5b942"
              : drawing.type === "horizontal"
                ? "#7c8cff"
                : "#58a6ff";

          if (drawing.type === "horizontal") {
            const point = points[0];
            return (
              <g key={drawing.id}>
                <line
                  x1={0}
                  y1={point.y}
                  x2={width}
                  y2={point.y}
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
                <text
                  x={8}
                  y={Math.max(12, point.y - 5)}
                  className="drawingText"
                >
                  {point.price.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}
                </text>
              </g>
            );
          }

          if (
            drawing.type === "text" ||
            drawing.type === "note"
          ) {
            const point = points[0];
            return (
              <g key={drawing.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill={stroke}
                />
                <text
                  x={point.x + 7}
                  y={point.y - 7}
                  className="drawingText"
                >
                  {drawing.text}
                </text>
              </g>
            );
          }

          const [start, end] = points;
          const priceMove = end.price - start.price;
          const percentMove =
            start.price !== 0
              ? (priceMove / start.price) * 100
              : 0;

          return (
            <g key={drawing.id}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={stroke}
                strokeWidth={1.7}
                strokeDasharray={
                  drawing.type === "measure" ? "5 4" : undefined
                }
              />
              <circle cx={start.x} cy={start.y} r={3} fill={stroke} />
              <circle cx={end.x} cy={end.y} r={3} fill={stroke} />
              {drawing.type === "measure" ? (
                <text
                  x={(start.x + end.x) / 2 + 6}
                  y={(start.y + end.y) / 2 - 6}
                  className="drawingText"
                >
                  {priceMove >= 0 ? "+" : ""}
                  {priceMove.toLocaleString("en-IN", {
                    maximumFractionDigits: 2
                  })}
                  {" · "}
                  {percentMove >= 0 ? "+" : ""}
                  {percentMove.toFixed(2)}%
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {showFib && fibLevelPositions.length ? (
        <div className="fibOverlayLayer" aria-hidden="true">
          {fibGoldenZonePosition ? (
            <div
              className="fibGoldenZone"
              style={{
                left: fibGoldenZonePosition.left,
                top: fibGoldenZonePosition.top,
                width: fibGoldenZonePosition.width,
                height: fibGoldenZonePosition.height
              }}
            />
          ) : null}
          {fibLevelPositions.map((level) => (
            <div
              className={
                "fibOverlayLevel " +
                (level.important ? "important " : "") +
                (level.anchor ? "anchor" : "")
              }
              key={level.key}
              style={{
                left: level.left,
                top: level.top,
                width: level.width
              }}
            >
              <span className="fibOverlayLine" />
              <span className="fibOverlayLabel">{level.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showTrendFib && trendFibLevelPositions.length ? (
        <div className="trendFibOverlayLayer" aria-hidden="true">
          {trendFibLevelPositions.map((level) => (
            <div
              className={
                "trendFibOverlayLevel " +
                (level.important ? "important" : "")
              }
              key={level.key}
              style={{
                left: level.left,
                top: level.top,
                width: level.width
              }}
            >
              <span className="trendFibOverlayLine" />
              <span className="trendFibOverlayLabel">{level.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showOrderBlocks && orderBlockZonePositions.length ? (
        <div className="orderBlockZoneLayer" aria-hidden="true">
          {orderBlockZonePositions.map((block) => (
            <div
              className={"orderBlockZone " + block.direction}
              key={block.key}
              style={{
                left: block.left,
                top: block.top,
                width: block.width,
                height: block.height
              }}
            >
              <span className="orderBlockZoneLabel">
                {block.direction === "bullish" ? "BUY OB" : "SELL OB"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {showProfile && volumeProfilePositions.length ? (
        <div className="volumeProfileLayer" aria-hidden="true">
          {volumeProfilePositions.map((bin) => (
            <div
              className="volumeProfileBin"
              key={bin.key}
              style={{
                left: bin.left,
                top: bin.top,
                width: bin.totalWidth,
                height: bin.height
              }}
            >
              <span
                className="volumeProfileSell"
                style={{ width: bin.sellWidth }}
              />
              <span
                className="volumeProfileBuy"
                style={{ width: bin.buyWidth }}
              />
            </div>
          ))}
          {volumeProfileLevelPositions.map((level) => (
            <div
              className={"volumeProfileLevel " + level.label.toLowerCase()}
              key={level.key}
              style={{
                left: level.left,
                top: level.top,
                width: level.width
              }}
            >
              <span>{level.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showFvg && fvgZonePositions.length ? (
        <div className="fvgZoneLayer" aria-hidden="true">
          {fvgZonePositions.map((gap) => (
            <div
              className={
                "fvgZone " +
                gap.direction +
                " " +
                gap.status
              }
              key={gap.key}
              style={{
                left: gap.left,
                top: gap.top,
                width: gap.width,
                height: gap.height
              }}
            >
              <span className="fvgZoneLabel">
                {gap.direction === "bullish" ? "BUY FVG" : "SELL FVG"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {showPivots && pivotLinePositions.length ? (
        <div className="pivotLevelLayer" aria-hidden="true">
          {pivotLinePositions.map((level) => (
            <div
              className={"pivotLevel " + level.kind}
              key={level.key}
              style={{
                left: level.left,
                top: level.top,
                width: level.width
              }}
            >
              <span className="pivotLevelLine" />
              <span className="pivotLevelLabel">
                {level.label}{" "}
                {level.value.toLocaleString("en-IN", {
                  maximumFractionDigits: 2
                })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {showLiquidity && liquidityLevelPositions.length ? (
        <div className="liquidityLevelLayer" aria-hidden="true">
          {liquidityLevelPositions.map((level) => (
            <div
              className={
                "liquidityLevel " +
                level.importance +
                " " +
                level.side
              }
              key={level.key}
              style={{
                left: level.left,
                top: level.top,
                width: level.width,
                height: level.height
              }}
            >
              <span className="liquidityLevelLine" />
              <span className="liquidityLevelLabel">
                {level.importance === "major" ? "MAJOR" : "MINOR"}{" "}
                {level.side === "buy" ? "SUPPLY" : "DEMAND"}{" "}
                {level.level.toLocaleString("en-IN", {
                  maximumFractionDigits: 2
                })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {showStructure && structureEventPositions.length ? (
        <div className="structureHistoryLayer" aria-hidden="true">
          {structureEventPositions.map((event) => (
            <div
              className={
                "structureHistoryEvent " +
                event.type.toLowerCase() +
                " " +
                event.direction
              }
              key={event.key}
              style={{
                left: event.left,
                top: event.top,
                width: event.width
              }}
            >
              <span className="structureHistoryLine" />
              <span className="structureHistoryLabel">
                {event.type} {event.direction === "bullish" ? "↑" : "↓"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {tradeMarkerPositions.length ? (
        <div className="tradeMarkerLayer" aria-hidden="true">
          {tradeMarkerPositions.map((marker) => (
            <div
              className={
                "tradeMarker " +
                marker.direction +
                " " +
                marker.status.toLowerCase()
              }
              key={marker.id}
              style={{
                left: marker.x,
                top: marker.y
              }}
            >
              <span className="tradeMarkerArrow">
                {marker.direction === "long" ? "▲" : "▼"}
              </span>
              <span className="tradeMarkerLabel">
                {marker.moveClass ? marker.moveClass + " " : ""}
                {marker.setupType === "REACTION" ? "REACTION " : ""}
                {marker.direction === "long" ? "LONG" : "SHORT"}
                {marker.status === "CLOSED" && marker.outcome
                  ? " · " + marker.outcome
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {showOrderFlow && orderFlowBarPositions.length ? (
        <div className="exactVolumeLayer">
          {orderFlowBarPositions.map((bar) => (
            <div
              className={
                "exactVolumeBar " +
                (bar.partial ? "partial " : "") +
                (activeOrderFlowTime === bar.time ? "active" : "")
              }
              key={bar.time}
              onClick={(event) => {
                event.stopPropagation();
                setActiveOrderFlowTime((current) =>
                  current === bar.time ? null : bar.time
                );
              }}
              style={{
                left: bar.x - bar.width / 2,
                width: bar.width,
                height: bar.totalHeight
              }}
            >
              <span
                className="exactVolumeStack"
                style={{ height: bar.totalHeight }}
              >
                <span
                  className="exactVolumeBuy"
                  style={{ height: bar.buyHeight }}
                />
                <span
                  className="exactVolumeSell"
                  style={{ height: bar.sellHeight }}
                />
              </span>

              <div className="exactVolumeTooltip" role="tooltip">
                <strong>{formatIst(bar.time)}</strong>
                <span className="flowBuy">
                  BUY {bar.buyPercent.toFixed(1)}% ·{" "}
                  {bar.buyVolume.toLocaleString("en-IN", {
                    maximumFractionDigits: 6
                  })}{" "}
                  · B#{bar.buyTrades}
                </span>
                <span className="flowSell">
                  SELL {bar.sellPercent.toFixed(1)}% ·{" "}
                  {bar.sellVolume.toLocaleString("en-IN", {
                    maximumFractionDigits: 6
                  })}{" "}
                  · S#{bar.sellTrades}
                </span>
                <span>
                  Δ {bar.deltaPercent >= 0 ? "+" : ""}
                  {bar.deltaPercent.toFixed(1)}% · CΔ{" "}
                  {bar.cumulativeDelta >= 0 ? "+" : ""}
                  {bar.cumulativeDelta.toLocaleString("en-IN", {
                    maximumFractionDigits: 6
                  })}
                </span>
                {bar.oi !== null ? (
                  <span>
                    OI {bar.oi.toLocaleString("en-IN")}
                    {bar.oiChange !== null
                      ? " · ΔOI " +
                        bar.oiChange.toLocaleString("en-IN")
                      : ""}
                  </span>
                ) : null}
                <small>
                  {bar.partial ? "LIVE PARTIAL BAR" : "EXACT CLOSED BAR"}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showSessionBreaks ? (
        <div className="sessionBreakLayer" aria-hidden="true">
          {sessionBreakPositions.map((item) => (
            <span
              className="sessionBreakLine"
              key={item.time}
              style={{ left: item.x }}
            />
          ))}
        </div>
      ) : null}
      <div ref={hostRef} className="marketChart" />
    </div>
  );
}
