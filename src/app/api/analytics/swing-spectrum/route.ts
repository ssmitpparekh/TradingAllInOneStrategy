import { NextResponse } from "next/server";
import { INDIA_CORE } from "@/lib/analytics/india-universe";
import { getPostgresPool } from "@/lib/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function max(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function min(values: number[]) {
  return values.length ? Math.min(...values) : null;
}

function pct(a: number, b: number) {
  return b !== 0 ? ((a - b) / b) * 100 : 0;
}

export async function GET() {
  try {
    const pool = getPostgresPool();
    const symbols = INDIA_CORE.map((item) => item.symbol);

    const result = await pool.query(
      `select symbol, candle_time, open, high, low, close, volume
       from public.market_candles
       where provider='FYERS'
         and market='NSE'
         and resolution='1D'
         and symbol = any($1::text[])
       order by symbol asc, candle_time asc`,
      [symbols]
    );

    const grouped = new Map<string, Candle[]>();
    for (const row of result.rows) {
      const list = grouped.get(String(row.symbol)) ?? [];
      list.push({
        time: Number(row.candle_time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0)
      });
      grouped.set(String(row.symbol), list);
    }

    const scans = {
      breakout10: [] as Record<string, unknown>[],
      breakout50: [] as Record<string, unknown>[],
      reversal: [] as Record<string, unknown>[],
      channel: [] as Record<string, unknown>[],
      nr7: [] as Record<string, unknown>[],
      weekly: [] as Record<string, unknown>[]
    };

    for (const instrument of INDIA_CORE) {
      const candles = grouped.get(instrument.symbol) ?? [];
      if (candles.length < 8) continue;

      const latest = candles.at(-1)!;
      const previous = candles.at(-2)!;
      const dayChange = pct(latest.close, previous.close);
      const base = {
        symbol: instrument.symbol,
        ticker: instrument.ticker,
        name: instrument.name,
        sector: instrument.sector,
        close: latest.close,
        changePercent: dayChange,
        time: latest.time
      };

      if (candles.length >= 11) {
        const prior10 = candles.slice(-11, -1);
        const high10 = max(prior10.map((c) => c.high));
        const low10 = min(prior10.map((c) => c.low));
        if (high10 !== null && latest.close > high10) {
          scans.breakout10.push({
            ...base,
            direction: "BULL",
            reference: high10,
            distancePercent: pct(latest.close, high10)
          });
        } else if (low10 !== null && latest.close < low10) {
          scans.breakout10.push({
            ...base,
            direction: "BEAR",
            reference: low10,
            distancePercent: pct(latest.close, low10)
          });
        }
      }

      if (candles.length >= 51) {
        const prior50 = candles.slice(-51, -1);
        const high50 = max(prior50.map((c) => c.high));
        const low50 = min(prior50.map((c) => c.low));
        if (high50 !== null && latest.close > high50) {
          scans.breakout50.push({
            ...base,
            direction: "BULL",
            reference: high50,
            distancePercent: pct(latest.close, high50)
          });
        } else if (low50 !== null && latest.close < low50) {
          scans.breakout50.push({
            ...base,
            direction: "BEAR",
            reference: low50,
            distancePercent: pct(latest.close, low50)
          });
        }
      }

      if (candles.length >= 21) {
        const prior20 = candles.slice(-21, -1);
        const channelHigh = max(prior20.map((c) => c.high));
        const channelLow = min(prior20.map((c) => c.low));
        const avgVolume =
          prior20.reduce((sum, c) => sum + c.volume, 0) / prior20.length;
        const volumeRatio = avgVolume > 0 ? latest.volume / avgVolume : 0;

        if (
          channelHigh !== null &&
          latest.close > channelHigh &&
          volumeRatio >= 1
        ) {
          scans.channel.push({
            ...base,
            direction: "BULL",
            reference: channelHigh,
            volumeRatio
          });
        } else if (
          channelLow !== null &&
          latest.close < channelLow &&
          volumeRatio >= 1
        ) {
          scans.channel.push({
            ...base,
            direction: "BEAR",
            reference: channelLow,
            volumeRatio
          });
        }
      }

      const last7 = candles.slice(-7);
      if (last7.length === 7) {
        const ranges = last7.map((c) => c.high - c.low);
        const latestRange = ranges.at(-1)!;
        if (latestRange <= Math.min(...ranges)) {
          scans.nr7.push({
            ...base,
            direction: dayChange >= 0 ? "BULL" : "BEAR",
            range: latestRange
          });
        }
      }

      if (candles.length >= 5) {
        const c1 = candles.at(-4)!;
        const c2 = candles.at(-3)!;
        const c3 = candles.at(-2)!;
        const bullishSequence = c1.close > c2.close && c2.close > c3.close;
        const bearishSequence = c1.close < c2.close && c2.close < c3.close;
        const bullishReversal =
          bullishSequence &&
          latest.close > previous.high &&
          latest.close > latest.open;
        const bearishReversal =
          bearishSequence &&
          latest.close < previous.low &&
          latest.close < latest.open;

        if (bullishReversal || bearishReversal) {
          scans.reversal.push({
            ...base,
            direction: bullishReversal ? "BULL" : "BEAR"
          });
        }
      }

      if (candles.length >= 6) {
        const weekStart = candles.at(-6)!.close;
        const weeklyChange = pct(latest.close, weekStart);
        if (Math.abs(weeklyChange) >= 2) {
          scans.weekly.push({
            ...base,
            direction: weeklyChange >= 0 ? "BULL" : "BEAR",
            weeklyChangePercent: weeklyChange
          });
        }
      }
    }

    const sortByStrength = (items: Record<string, unknown>[]) =>
      items
        .slice()
        .sort(
          (a, b) =>
            Math.abs(Number(b.changePercent ?? 0)) -
            Math.abs(Number(a.changePercent ?? 0))
        )
        .slice(0, 20);

    return NextResponse.json({
      ok: true,
      methodology: {
        timeframe: "1D",
        confirmation: "completed daily candle",
        breakout10: "close beyond prior 10-day high/low",
        breakout50: "close beyond prior 50-day high/low",
        channel:
          "close beyond prior 20-day high/low with >= 1x 20-day average volume",
        nr7: "latest daily range is the narrowest of the last seven sessions",
        reversal:
          "three-session directional sequence followed by a close through the prior day's extreme",
        weekly:
          "absolute five-session close-to-close move of at least 2%"
      },
      coverage: {
        requested: INDIA_CORE.length,
        withDailyHistory: grouped.size
      },
      scans: {
        breakout10: sortByStrength(scans.breakout10),
        breakout50: sortByStrength(scans.breakout50),
        reversal: sortByStrength(scans.reversal),
        channel: sortByStrength(scans.channel),
        nr7: sortByStrength(scans.nr7),
        weekly: scans.weekly
          .slice()
          .sort(
            (a, b) =>
              Math.abs(Number(b.weeklyChangePercent ?? 0)) -
              Math.abs(Number(a.weeklyChangePercent ?? 0))
          )
          .slice(0, 20)
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to build Swing Spectrum."
      },
      { status: 500 }
    );
  }
}
