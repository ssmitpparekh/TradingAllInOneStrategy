"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
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
};

type Props = {
  candles: ChartCandle[];
};

export default function MarketChart({ candles }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      width: host.clientWidth,
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0f16" },
        textColor: "#9ca8ba",
        attributionLogo: true
      },
      grid: {
        vertLines: { color: "#15202e" },
        horzLines: { color: "#15202e" }
      },
      rightPriceScale: {
        borderColor: "#263143"
      },
      timeScale: {
        borderColor: "#263143",
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: "#667085" },
        horzLine: { color: "#667085" }
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#28c76f",
      downColor: "#ea5455",
      borderUpColor: "#28c76f",
      borderDownColor: "#ea5455",
      wickUpColor: "#28c76f",
      wickDownColor: "#ea5455"
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth });
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

  return <div ref={hostRef} className="marketChart" />;
}
