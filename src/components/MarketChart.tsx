"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time
} from "lightweight-charts";

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
  fitNonce?: number;
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

export default function MarketChart({ candles, fitNonce = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [hovered, setHovered] = useState<ChartCandle | null>(null);

  const latest = useMemo(
    () => (candles.length ? candles[candles.length - 1] : null),
    [candles]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      width: host.clientWidth,
      height: Math.max(520, host.clientHeight || 520),
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

    chartRef.current = chart;
    seriesRef.current = series;

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
        height: Math.max(520, host.clientHeight || 520)
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    const data: CandlestickData<Time>[] = candles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    }));

    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (fitNonce > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [fitNonce]);

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
      <div ref={hostRef} className="marketChart" />
    </div>
  );
}
