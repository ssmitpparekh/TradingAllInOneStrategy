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
  type IPriceLine,
  type ISeriesApi,
  type Time
} from "lightweight-charts";
import { emaSeries } from "@/lib/analysis/indicators";
import type { OrderFlowBucket } from "@/lib/analysis/order-flow";
import type { VolumeAnalytics } from "@/lib/analysis/volume";
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
  showFib?: boolean;
  showTrendFib?: boolean;
  showStructure?: boolean;
  showFvg?: boolean;
  showLiquidity?: boolean;
  showOrderBlocks?: boolean;
  showVwap?: boolean;
  showProfile?: boolean;
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
  return !["1D", "1W", "1M"].includes(resolution);
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
  showFib = true,
  showTrendFib = true,
  showStructure = true,
  showFvg = true,
  showLiquidity = true,
  showOrderBlocks = true,
  showVwap = true,
  showProfile = true,
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
  const sessionVwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const anchoredVwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRefs = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const analysisLinesRef = useRef<IPriceLine[]>([]);
  const [hovered, setHovered] = useState<ChartCandle | null>(null);
  const [activeOrderFlowTime, setActiveOrderFlowTime] = useState<number | null>(
    null
  );
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
  const [liquidityLevelPositions, setLiquidityLevelPositions] = useState<
    Array<{
      key: string;
      left: number;
      width: number;
      top: number;
      side: "buy" | "sell";
      importance: "minor" | "major";
      level: number;
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

  const drawingsStorageKey =
    "allinoneview:drawings:v1:" + instrumentKey;

  useEffect(() => {
    setActiveOrderFlowTime(null);
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
        vertLines: { color: isLight ? "#e5e7eb" : "#15202e" },
        horzLines: { color: isLight ? "#e5e7eb" : "#15202e" }
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
          if (!epoch) return "";
          const date = new Date(epoch * 1000);
          return new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short"
          }).format(date);
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

    const sessionVwapSeries = chart.addSeries(LineSeries, {
      color: "#4d8dff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "VWAP"
    });

    const anchoredVwapSeries = chart.addSeries(LineSeries, {
      color: "#c386ff",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "AVWAP"
    });

    chartRef.current = chart;
    seriesRef.current = series;
    sessionVwapSeriesRef.current = sessionVwapSeries;
    anchoredVwapSeriesRef.current = anchoredVwapSeries;

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

    const observer = new ResizeObserver(() => {
      chart.applyOptions({
        width: host.clientWidth,
        height: chartHeightForHost(host)
      });
      setDrawingRevision((value) => value + 1);
    });
    observer.observe(host);

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
      setDrawingRevision((value) => value + 1);
    };

    host.addEventListener("wheel", onVerticalWheel, {
      passive: false,
      capture: true
    });

    return () => {
      host.removeEventListener("wheel", onVerticalWheel, true);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      sessionVwapSeriesRef.current = null;
      anchoredVwapSeriesRef.current = null;
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
        vertLines: { color: isLight ? "#e5e7eb" : "#15202e" },
        horzLines: { color: isLight ? "#e5e7eb" : "#15202e" }
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
    chart.timeScale().subscribeVisibleLogicalRangeChange(updatePositions);
    window.addEventListener("resize", updatePositions);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updatePositions);
      window.removeEventListener("resize", updatePositions);
    };
  }, [sessionBreakTimes, showSessionBreaks]);

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
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateMarkers);
    window.addEventListener("resize", updateMarkers);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateMarkers);
      window.removeEventListener("resize", updateMarkers);
    };
  }, [tradeMarkers, candles, liveCandle]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const redraw = () => {
      setDrawingRevision((value) => value + 1);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
    };
  }, []);

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
    const series = seriesRef.current;
    if (!series) return;

    for (const line of analysisLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // A chart reset can remove a line before this cleanup runs.
      }
    }
    analysisLinesRef.current = [];

    if (showFvg && imbalance) {
      const visibleGaps = imbalance.activeFvgs.slice(-3);

      for (const gap of visibleGaps) {
        const color =
          gap.direction === "bullish" ? "#3fbf7f" : "#e66c70";
        const prefix =
          gap.direction === "bullish" ? "Bull FVG" : "Bear FVG";

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: gap.lower,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `${prefix} L`
          })
        );

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: gap.upper,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `${prefix} H`
          })
        );
      }
    }

    if (showOrderBlocks && orderBlocks) {
      for (const block of orderBlocks.activeBlocks.slice(-3)) {
        const color =
          block.direction === "bullish" ? "#5cbf8a" : "#dc7377";
        const prefix =
          block.direction === "bullish" ? "Bull OB" : "Bear OB";

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: block.lower,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: `${prefix} L`
          })
        );

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: block.upper,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: `${prefix} H`
          })
        );
      }
    }

    if (
      showProfile &&
      volumeAnalytics?.available &&
      volumeAnalytics.profile.poc !== null
    ) {
      const profileLevels = [
        {
          title: "POC",
          price: volumeAnalytics.profile.poc,
          color: "#f5b942",
          width: 2 as const
        },
        {
          title: "VAH",
          price: volumeAnalytics.profile.vah,
          color: "#7d8ba1",
          width: 1 as const
        },
        {
          title: "VAL",
          price: volumeAnalytics.profile.val,
          color: "#7d8ba1",
          width: 1 as const
        }
      ];

      for (const level of profileLevels) {
        if (level.price === null) continue;

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: level.price,
            color: level.color,
            lineWidth: level.width,
            lineStyle:
              level.title === "POC"
                ? LineStyle.Solid
                : LineStyle.Dashed,
            axisLabelVisible: true,
            title: level.title
          })
        );
      }
    }

    if (!fibonacci) return;

    if (showFib) {
      for (const level of fibonacci.retracements) {
        const important =
          level.ratio === 0.618 ||
          level.ratio === 0.705 ||
          level.ratio === 0.786;

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: level.price,
            color: important ? "#f5b942" : "#667085",
            lineWidth: important ? 2 : 1,
            lineStyle: important ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Fib ${level.label}`
          })
        );
      }
    }

    if (showTrendFib && fibonacci.trendExtension) {
      for (const level of fibonacci.trendExtension.levels) {
        const important = level.ratio === 1.272 || level.ratio === 1.618;

        analysisLinesRef.current.push(
          series.createPriceLine({
            price: level.price,
            color: important ? "#8b7cff" : "#536079",
            lineWidth: important ? 2 : 1,
            lineStyle: important ? LineStyle.Solid : LineStyle.Dotted,
            axisLabelVisible: true,
            title: `Trend ${level.label}`
          })
        );
      }
    }

    return () => {
      const activeSeries = seriesRef.current;
      if (!activeSeries) return;

      for (const line of analysisLinesRef.current) {
        try {
          activeSeries.removePriceLine(line);
        } catch {
          // no-op
        }
      }
      analysisLinesRef.current = [];
    };
  }, [
    fibonacci,
    structure,
    imbalance,
    orderBlocks,
    volumeAnalytics,
    showFib,
    showTrendFib,
    showStructure,
    showFvg,
    showLiquidity,
    showOrderBlocks,
    showProfile
  ]);

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

      const positions = imbalance.liquidityLevels.flatMap((level) => {
        const sourceX = chart.timeScale().timeToCoordinate(
          level.sourceSwing.time as Time
        );
        const y = series.priceToCoordinate(level.level);

        if (sourceX === null || y === null) return [];

        const rawLeft = Number(sourceX);

        if (rawLeft > hostWidth + 20) return [];

        const left = Math.max(0, rawLeft);
        const right = hostWidth;

        if (right - left < 2) return [];

        return [{
          key:
            level.importance +
            ":" +
            level.side +
            ":" +
            level.sourceSwing.time,
          left,
          width: right - left,
          top: Number(y),
          side: level.side,
          importance: level.importance,
          level: level.level
        }];
      });

      setLiquidityLevelPositions(positions);
    };

    updateLiquidity();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateLiquidity);
    window.addEventListener("resize", updateLiquidity);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateLiquidity);
      window.removeEventListener("resize", updateLiquidity);
    };
  }, [showLiquidity, imbalance, drawingRevision]);

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
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateStructure);
    window.addEventListener("resize", updateStructure);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateStructure);
      window.removeEventListener("resize", updateStructure);
    };
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
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateBars);
    window.addEventListener("resize", updateBars);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateBars);
      window.removeEventListener("resize", updateBars);
    };
  }, [orderFlowBuckets, showOrderFlow, cumulativeDeltaByTime]);

  useEffect(() => {
    const sessionSeries = sessionVwapSeriesRef.current;
    const anchoredSeries = anchoredVwapSeriesRef.current;
    if (!sessionSeries || !anchoredSeries) return;

    if (!showVwap || !volumeAnalytics?.available) {
      sessionSeries.setData([]);
      anchoredSeries.setData([]);
      return;
    }

    sessionSeries.setData(
      volumeAnalytics.sessionVwap.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );

    anchoredSeries.setData(
      volumeAnalytics.anchoredVwap.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );
  }, [volumeAnalytics, showVwap]);

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
      let series = emaSeriesRefs.current.get(period);

      if (!series) {
        const hue = (period * 47) % 360;
        series = chart.addSeries(LineSeries, {
          color: `hsl(${hue} 78% 55%)`,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: `EMA ${period}`
        });
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
                width: level.width
              }}
            >
              <span className="liquidityLevelLine" />
              <span className="liquidityLevelLabel">
                {level.importance === "major" ? "MAJOR" : "MINOR"}{" "}
                {level.side === "buy" ? "BSL" : "SSL"}{" "}
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
