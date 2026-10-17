"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
  type Time
} from "lightweight-charts";
import type { TechnicalContext } from "@/lib/analysis/indicators";
import {
  orderFlowPercentages,
  type OrderFlowBucket
} from "@/lib/analysis/order-flow";
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
  technicalContext?: TechnicalContext | null;
  showFib?: boolean;
  showTrendFib?: boolean;
  showStructure?: boolean;
  showFvg?: boolean;
  showLiquidity?: boolean;
  showOrderBlocks?: boolean;
  showVolume?: boolean;
  showVwap?: boolean;
  showProfile?: boolean;
  showEma?: boolean;
  market?: string;
  resolution?: string;
  showSessionBreaks?: boolean;
  orderFlowBuckets?: OrderFlowBucket[];
  showOrderFlow?: boolean;
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
  technicalContext = null,
  showFib = true,
  showTrendFib = true,
  showStructure = true,
  showFvg = true,
  showLiquidity = true,
  showOrderBlocks = true,
  showVolume = true,
  showVwap = true,
  showProfile = true,
  showEma = true,
  market = "NSE",
  resolution = "15",
  showSessionBreaks = true,
  orderFlowBuckets = [],
  showOrderFlow = true
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sessionVwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const anchoredVwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const buyFlowSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sellFlowSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const analysisLinesRef = useRef<IPriceLine[]>([]);
  const [hovered, setHovered] = useState<ChartCandle | null>(null);
  const [sessionBreakPositions, setSessionBreakPositions] = useState<
    Array<{ time: number; x: number }>
  >([]);

  const orderFlowByTime = useMemo(
    () => new Map(orderFlowBuckets.map((bucket) => [bucket.time, bucket])),
    [orderFlowBuckets]
  );

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

    const chart = createChart(host, {
      width: host.clientWidth,
      height: chartHeightForHost(host),
      layout: {
        background: { type: ColorType.Solid, color: "#0a0f16" },
        textColor: "#9ca8ba",
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
        vertLines: { color: "#15202e" },
        horzLines: { color: "#15202e" }
      },
      rightPriceScale: {
        borderColor: "#263143",
        autoScale: true
      },
      timeScale: {
        borderColor: "#263143",
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
          color: "#77839a",
          width: 1,
          labelBackgroundColor: "#263143"
        },
        horzLine: {
          color: "#77839a",
          width: 1,
          labelBackgroundColor: "#263143"
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

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale("").applyOptions({
      scaleMargins: {
        top: 0.88,
        bottom: 0
      }
    });

    const buyFlowSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "orderFlow",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false
    });

    const sellFlowSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "orderFlow",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false
    });

    chart.priceScale("orderFlow").applyOptions({
      scaleMargins: {
        top: 0.68,
        bottom: 0.13
      },
      visible: false
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

    const ema20Series = chart.addSeries(LineSeries, {
      color: "#56b4ff",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "EMA20"
    });

    const ema50Series = chart.addSeries(LineSeries, {
      color: "#f5b942",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "EMA50"
    });

    const ema200Series = chart.addSeries(LineSeries, {
      color: "#d67cff",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "EMA200"
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    sessionVwapSeriesRef.current = sessionVwapSeries;
    anchoredVwapSeriesRef.current = anchoredVwapSeries;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;
    ema200SeriesRef.current = ema200Series;
    buyFlowSeriesRef.current = buyFlowSeries;
    sellFlowSeriesRef.current = sellFlowSeries;

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
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      sessionVwapSeriesRef.current = null;
      anchoredVwapSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      ema200SeriesRef.current = null;
      buyFlowSeriesRef.current = null;
      sellFlowSeriesRef.current = null;
    };
  }, []);

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

    if (showStructure && structure) {
      if (structure.activeSwingHigh) {
        analysisLinesRef.current.push(
          series.createPriceLine({
            price: structure.activeSwingHigh.price,
            color: "#8b96aa",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "Swing H"
          })
        );
      }

      if (structure.activeSwingLow) {
        analysisLinesRef.current.push(
          series.createPriceLine({
            price: structure.activeSwingLow.price,
            color: "#8b96aa",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "Swing L"
          })
        );
      }

      if (structure.latestEvent) {
        analysisLinesRef.current.push(
          series.createPriceLine({
            price: structure.latestEvent.brokenLevel,
            color:
              structure.latestEvent.direction === "bullish"
                ? "#45d483"
                : "#ff7477",
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${structure.latestEvent.type} ${structure.latestEvent.direction === "bullish" ? "↑" : "↓"}`
          })
        );
      }
    }

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

    if (showLiquidity && imbalance?.latestSweep) {
      analysisLinesRef.current.push(
        series.createPriceLine({
          price: imbalance.latestSweep.level,
          color:
            imbalance.latestSweep.direction === "bullish"
              ? "#69d6c5"
              : "#ff9b6a",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Sweep ${imbalance.latestSweep.direction === "bullish" ? "↑" : "↓"}`
        })
      );
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
    const volumeSeries = volumeSeriesRef.current;
    if (!volumeSeries) return;

    if (!showVolume || !volumeAnalytics?.available) {
      volumeSeries.setData([]);
      return;
    }

    volumeSeries.setData(
      candles
        .filter((candle) => Number(candle.volume ?? 0) > 0)
        .map((candle) => ({
          time: candle.time as Time,
          value: Number(candle.volume ?? 0),
          color: "rgba(132, 145, 166, 0.34)"
        }))
    );
  }, [candles, volumeAnalytics, showVolume]);

  useEffect(() => {
    const buySeries = buyFlowSeriesRef.current;
    const sellSeries = sellFlowSeriesRef.current;
    if (!buySeries || !sellSeries) return;

    if (!showOrderFlow || orderFlowBuckets.length === 0) {
      buySeries.setData([]);
      sellSeries.setData([]);
      return;
    }

    buySeries.setData(
      orderFlowBuckets.map((bucket) => ({
        time: bucket.time as Time,
        value: bucket.buyVolume,
        color: "rgba(40, 199, 111, 0.76)"
      }))
    );

    sellSeries.setData(
      orderFlowBuckets.map((bucket) => ({
        time: bucket.time as Time,
        value: -bucket.sellVolume,
        color: "rgba(234, 84, 85, 0.76)"
      }))
    );
  }, [orderFlowBuckets, showOrderFlow]);

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
    const ema20Series = ema20SeriesRef.current;
    const ema50Series = ema50SeriesRef.current;
    const ema200Series = ema200SeriesRef.current;

    if (!ema20Series || !ema50Series || !ema200Series) return;

    if (!showEma || !technicalContext) {
      ema20Series.setData([]);
      ema50Series.setData([]);
      ema200Series.setData([]);
      return;
    }

    ema20Series.setData(
      technicalContext.ema20.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );
    ema50Series.setData(
      technicalContext.ema50.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );
    ema200Series.setData(
      technicalContext.ema200.map((point) => ({
        time: point.time as Time,
        value: point.value
      }))
    );
  }, [technicalContext, showEma]);

  useEffect(() => {
    if (fitNonce > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [fitNonce]);

  const readout = hovered ?? latest;
  const readoutOrderFlow = readout
    ? orderFlowByTime.get(readout.time) ?? null
    : null;
  const readoutOrderFlowStats = readoutOrderFlow
    ? orderFlowPercentages(readoutOrderFlow)
    : null;

  return (
    <div className="marketChartShell">
      {readout ? (
        <div className="crosshairReadout">
          <span>{formatIst(readout.time)}</span>
          <span>O <strong>{readout.open.toLocaleString("en-IN")}</strong></span>
          <span>H <strong>{readout.high.toLocaleString("en-IN")}</strong></span>
          <span>L <strong>{readout.low.toLocaleString("en-IN")}</strong></span>
          <span>C <strong>{readout.close.toLocaleString("en-IN")}</strong></span>
          {readoutOrderFlow && readoutOrderFlowStats ? (
            <>
              <span className="flowBuy">
                BUY <strong>{readoutOrderFlowStats.buyPercent.toFixed(1)}%</strong>
              </span>
              <span className="flowSell">
                SELL <strong>{readoutOrderFlowStats.sellPercent.toFixed(1)}%</strong>
              </span>
              <span>
                Δ <strong>{readoutOrderFlowStats.deltaPercent >= 0 ? "+" : ""}{readoutOrderFlowStats.deltaPercent.toFixed(1)}%</strong>
              </span>
              <span>
                {readoutOrderFlow.partial ? "PARTIAL" : readoutOrderFlow.quality.toUpperCase()}
              </span>
            </>
          ) : null}
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
