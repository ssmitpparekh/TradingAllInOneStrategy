import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { getHistory } from "../src/lib/fyers";
import { readFyersSession } from "../src/lib/fyers-session";
import { getOandaCandles } from "../src/lib/oanda";
import { readKrakenCompactCandles } from "../src/lib/server/kraken-compact";
import {
  BACKTEST_INSTRUMENTS
} from "../src/lib/strategy/catalog";
import {
  evaluatePlatformStrategy
} from "../src/lib/analysis/platform-strategy";
import {
  makeTradeId,
  reconcileTradeWithCandles,
  type JournalTrade
} from "../src/lib/analysis/trade-journal";

const { Pool } = pg;

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value: string) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

function upperBound(rows: Candle[], epoch: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time <= epoch) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lowerBound(rows: Candle[], epoch: number, highLimit?: number) {
  let low = 0;
  let high = highLimit ?? rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time < epoch) low = mid + 1;
    else high = mid;
  }
  return low;
}

function windowRows(rows: Candle[], from: number, throughOpenTime: number) {
  const end = upperBound(rows, throughOpenTime);
  const start = lowerBound(rows, from, end);
  return rows.slice(start, end);
}

function latestAt(rows: Candle[], epoch: number) {
  const end = upperBound(rows, epoch);
  return end > 0 ? rows[end - 1] : null;
}

loadLocalEnv();

const raw =
  process.env.DATABASE_URL?.trim() ||
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  "";
if (!raw) throw new Error("DATABASE_URL is required.");

const pool = new Pool({
  connectionString: strictSslUrl(raw),
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const requestedInstrument =
  process.argv
    .find((arg) => arg.startsWith("--instrument="))
    ?.split("=")[1]
    ?.trim()
    .toUpperCase() ?? null;

function resolutionSeconds(resolution: string) {
  if (resolution === "1D") return 86400;
  const minutes = Number(resolution);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.floor(minutes * 60)
    : 900;
}

function mergeCandles(...groups: Candle[][]) {
  const byTime = new Map<number, Candle>();
  for (const group of groups) {
    for (const candle of group) {
      if (
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
      ) {
        byTime.set(candle.time, candle);
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function fetchKrakenRecent(
  symbol: string,
  resolution: string
): Promise<Candle[]> {
  const interval = Number(resolution);
  if (![1, 5, 15, 30, 60, 240].includes(interval)) return [];

  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", symbol);
  url.searchParams.set("interval", String(interval));
  url.searchParams.set("assetVersion", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ALLINONEVIEW-Backtest-Freshness/1.0"
    },
    cache: "no-store"
  });
  const body = await response.json();

  if (
    !response.ok ||
    (Array.isArray(body?.error) && body.error.length)
  ) {
    throw new Error(
      Array.isArray(body?.error) && body.error.length
        ? body.error.join(", ")
        : `Kraken HTTP ${response.status}`
    );
  }

  const result = body?.result ?? {};
  const pairKey = Object.keys(result).find((key) => key !== "last");
  const rows = pairKey ? result[pairKey] : [];

  return Array.isArray(rows)
    ? rows.map((row: unknown[]) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[6] ?? 0)
      }))
    : [];
}

async function fetchProviderTail(input: {
  provider: string;
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}): Promise<Candle[]> {
  if (input.from >= input.to) return [];

  if (input.provider === "KRAKEN") {
    return withRetry(
      "Kraken " + input.symbol + " " + input.resolution,
      () => fetchKrakenRecent(input.symbol, input.resolution)
    );
  }

  if (input.provider === "FYERS") {
    const session = await readFyersSession();
    if (!session?.accessToken) {
      throw new Error("FYERS is not connected for backtest freshness.");
    }

    const chunkSeconds =
      input.resolution === "1D" ? 365 * 86400 : 99 * 86400;
    const output: Candle[] = [];

    for (
      let from = input.from;
      from <= input.to;
      from += chunkSeconds + 1
    ) {
      const to = Math.min(input.to, from + chunkSeconds);
      output.push(
        ...(await withRetry(
          "FYERS " +
            input.symbol +
            " " +
            input.resolution +
            " " +
            from +
            "-" +
            to,
          () =>
            getHistory(session.accessToken, {
              symbol: input.symbol,
              resolution: input.resolution,
              from,
              to
            })
        ))
      );
    }

    return mergeCandles(output);
  }

  if (input.provider === "OANDA") {
    const step = resolutionSeconds(input.resolution);
    const chunkSeconds = Math.max(step, step * 4500);
    const output: Candle[] = [];

    for (
      let from = input.from;
      from <= input.to;
      from += chunkSeconds + 1
    ) {
      const to = Math.min(input.to, from + chunkSeconds);
      output.push(
        ...(await withRetry(
          "OANDA " +
            input.symbol +
            " " +
            input.resolution +
            " " +
            from +
            "-" +
            to,
          () =>
            getOandaCandles({
              symbol: input.symbol,
              resolution: input.resolution,
              from,
              to
            })
        ))
      );
    }

    return mergeCandles(output);
  }

  return [];
}

async function loadSeries(
  provider: string,
  market: string,
  symbol: string,
  resolution: string,
  cutoff: number
): Promise<Candle[]> {
  const result = await withRetry(
    "Neon candles " + provider + " " + symbol + " " + resolution,
    () =>
      pool.query(
        `select candle_time, open, high, low, close, volume
         from public.market_candles
         where provider=$1 and market=$2 and symbol=$3 and resolution=$4
           and candle_time < $5
         order by candle_time asc`,
        [provider, market, symbol, resolution, cutoff]
      )
  );

  const cached: Candle[] = result.rows.map((row) => ({
    time: Number(row.candle_time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0)
  }));

  // Continuous history sync is intentionally retired. At the official launch
  // boundary, refresh only the missing tail from the provider in memory so the
  // historical test reaches the immutable live cutoff without restarting the
  // old candle-storage architecture.
  const step = resolutionSeconds(resolution);
  const lastCached = cached.at(-1)?.time ?? null;
  const defaultTail =
    provider === "FYERS"
      ? resolution === "1D"
        ? 5 * 365 * 86400
        : 364 * 86400
      : provider === "OANDA"
        ? 366 * 86400
        : 720 * step;
  const firstCached = cached[0]?.time ?? null;
  const refreshFrom = Math.max(
    0,
    provider === "OANDA"
      ? firstCached !== null
        ? firstCached
        : cutoff - defaultTail
      : lastCached !== null
        ? lastCached + step
        : cutoff - defaultTail
  );

  let compactKraken: Candle[] = [];
  if (provider === "KRAKEN") {
    compactKraken = await readKrakenCompactCandles({
      symbol,
      resolution,
      from: 0,
      to: cutoff - 1
    });
  }

  let fresh: Candle[] = [];
  try {
    fresh = await fetchProviderTail({
      provider,
      symbol,
      resolution,
      from: refreshFrom,
      to: cutoff - 1
    });
  } catch (error) {
    process.stderr.write(
      `Freshness refresh failed for ${provider} ${symbol} ${resolution}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  const merged = mergeCandles(cached, compactKraken, fresh).filter(
    (candle) => candle.time < cutoff
  );

  if (requestedInstrument) {
    process.stdout.write(
      "Series " +
        provider +
        " " +
        symbol +
        " " +
        resolution +
        ": cached=" +
        cached.length +
        ", compact=" +
        compactKraken.length +
        ", providerFetched=" +
        fresh.length +
        ", merged=" +
        merged.length +
        "\n"
    );
  }

  return merged;
}

async function insertTrades(
  runId: string,
  instrument: (typeof BACKTEST_INSTRUMENTS)[number],
  trades: JournalTrade[],
  version: string
) {
  for (const trade of trades) {
    await withRetry(
      "Neon backtest trade " + trade.id,
      () => pool.query(
      `insert into public.strategy_backtest_trades (
         run_id, trade_id, strategy_version, instrument_key,
         provider, market, symbol, setup_type, move_class, direction,
         signal_time, confirmation_timeframe, entry, initial_stop,
         targets, score, status, outcome, highest_target_hit,
         result_r, closed_time, ambiguity_reason
       )
       values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15::jsonb,$16,$17,$18,$19,$20,$21,$22
       )
       on conflict (run_id, trade_id) do nothing`,
      [
        runId,
        trade.id,
        version,
        instrument.key,
        instrument.provider,
        instrument.market,
        instrument.symbol,
        trade.setupType ?? "PRIMARY",
        trade.moveClass ?? "TACTICAL",
        trade.direction,
        trade.signalTime,
        trade.confirmationTimeframe,
        trade.entry,
        trade.initialStop,
        JSON.stringify(trade.targets),
        trade.score,
        trade.status,
        trade.outcome,
        trade.highestTargetHit,
        trade.resultR,
        trade.closedTime,
        trade.ambiguityReason ?? null
      ]
      )
    );
  }
}

function incrementCount(
  map: Map<string, number>,
  key: string
) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topCounts(map: Map<string, number>, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function fmtEpoch(value: number | null) {
  return value === null
    ? "n/a"
    : new Date(value * 1000).toISOString();
}

function continuitySummary(
  rows: Candle[],
  resolution: string
) {
  const step = resolutionSeconds(resolution);
  if (rows.length < 2) {
    return {
      suspiciousGaps: 0,
      largestGapSeconds: 0,
      largestGaps: [] as Array<{
        from: number;
        to: number;
        seconds: number;
      }>
    };
  }

  let suspiciousGaps = 0;
  let largestGapSeconds = 0;
  const gaps: Array<{
    from: number;
    to: number;
    seconds: number;
  }> = [];

  for (let index = 1; index < rows.length; index += 1) {
    const from = rows[index - 1].time;
    const to = rows[index].time;
    const gap = to - from;
    largestGapSeconds = Math.max(largestGapSeconds, gap);

    if (gap > step * 3) {
      gaps.push({ from, to, seconds: gap });

      // Count obvious intraday/weekday holes and also very large holes.
      // Weekend closures usually land around 48-72h; the raw largest-gap
      // list below is authoritative and lets us distinguish them manually.
      if (gap < 36 * 60 * 60 || gap > 80 * 60 * 60) {
        suspiciousGaps += 1;
      }
    }
  }

  const largestGaps = gaps
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  return {
    suspiciousGaps,
    largestGapSeconds,
    largestGaps
  };
}

function transientMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function isTransientError(error: unknown) {
  const message = transientMessage(error);
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|network|connection terminated|connection reset|57P01|57P02|57P03/i.test(
    message
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  label: string,
  work: () => Promise<T>,
  attempts = 5
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error) || attempt === attempts) {
        throw error;
      }

      const delay = Math.min(
        20_000,
        1_500 * 2 ** (attempt - 1)
      );

      process.stderr.write(
        label +
          ": transient failure (" +
          transientMessage(error) +
          "), retry " +
          attempt +
          "/" +
          attempts +
          " after " +
          delay +
          "ms.\n"
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

async function main() {
  let runId = "";

try {
    const releaseResult = await pool.query(
      `select strategy_version, live_at
       from public.platform_strategy_releases
       where status='LIVE'
       order by live_at desc
       limit 1`
    );
  
    if (!releaseResult.rowCount) {
      throw new Error(
        "No official live boundary exists. Finish strategy/UI first, then run npm run strategy:go-live."
      );
    }
  
    const release = releaseResult.rows[0];
    const version = String(release.strategy_version);
    const cutoff = Math.floor(new Date(release.live_at).getTime() / 1000);
    runId = version + ":" + Date.now();
  
    await pool.query(
      `insert into public.strategy_backtest_runs (
         id, strategy_version, live_cutoff, status, full_strategy,
         data_profile, coverage, notes
       )
       values ($1,$2,$3,'RUNNING',false,$4,'{}'::jsonb,$5)`,
      [
        runId,
        version,
        new Date(cutoff * 1000).toISOString(),
        "DETERMINISTIC_TECHNICAL_CORE_FROM_PROVIDER_CACHE",
        "Uses the exact shared strategy evaluator with historical OHLCV. Historical live-only news/derivatives veto snapshots are not invented, so this run is explicitly not labelled full-strategy."
      ]
    );
  
    const coverage: Record<string, unknown> = {};
  
    const instruments = requestedInstrument
      ? BACKTEST_INSTRUMENTS.filter(
          (instrument) => instrument.key === requestedInstrument
        )
      : BACKTEST_INSTRUMENTS;

    if (requestedInstrument && instruments.length === 0) {
      throw new Error(
        "Unsupported instrument filter: " + requestedInstrument
      );
    }

    for (const instrument of instruments) {
      process.stdout.write("\nBacktesting " + instrument.key + "…\n");

      try {
      const [m1, m5, m15, h1, h4] = await Promise.all([
        loadSeries(instrument.provider, instrument.market, instrument.symbol, "1", cutoff),
        loadSeries(instrument.provider, instrument.market, instrument.symbol, "5", cutoff),
        loadSeries(instrument.provider, instrument.market, instrument.symbol, "15", cutoff),
        loadSeries(instrument.provider, instrument.market, instrument.symbol, "60", cutoff),
        loadSeries(instrument.provider, instrument.market, instrument.symbol, "240", cutoff)
      ]);
  
      const counts = {
        "1m": m1.length,
        "5m": m5.length,
        "15m": m15.length,
        "1h": h1.length,
        "4h": h4.length
      };

      const continuity = {
        "1m": continuitySummary(m1, "1"),
        "5m": continuitySummary(m5, "5"),
        "15m": continuitySummary(m15, "15"),
        "1h": continuitySummary(h1, "60"),
        "4h": continuitySummary(h4, "240")
      };
  
      const firstValues = [
        m1[0]?.time,
        m5[0]?.time,
        m15[0]?.time,
        h1[0]?.time,
        h4[0]?.time
      ].filter((value): value is number => Number.isFinite(value));
      const lastValues = [
        m1.at(-1)?.time,
        m5.at(-1)?.time,
        m15.at(-1)?.time,
        h1.at(-1)?.time,
        h4.at(-1)?.time
      ].filter((value): value is number => Number.isFinite(value));
      const first = firstValues.length ? Math.min(...firstValues) : null;
      const last = lastValues.length ? Math.max(...lastValues) : null;

      process.stdout.write(
        "Data coverage: " +
          "1m=" + counts["1m"] +
          ", 5m=" + counts["5m"] +
          ", 15m=" + counts["15m"] +
          ", 1h=" + counts["1h"] +
          ", 4h=" + counts["4h"] +
          "\nFrom " + fmtEpoch(first) +
          " to " + fmtEpoch(last) +
          "\nContinuity: " +
          "1m gaps=" + continuity["1m"].suspiciousGaps +
          ", 5m gaps=" + continuity["5m"].suspiciousGaps +
          ", 15m gaps=" + continuity["15m"].suspiciousGaps +
          ", 1h gaps=" + continuity["1h"].suspiciousGaps +
          ", 4h gaps=" + continuity["4h"].suspiciousGaps +
          "\nLargest raw gaps:\n" +
          ([
            ["1m", continuity["1m"]],
            ["5m", continuity["5m"]],
            ["15m", continuity["15m"]],
            ["1h", continuity["1h"]],
            ["4h", continuity["4h"]]
          ] as const)
            .map(([label, summary]) => {
              const top = summary.largestGaps[0];
              return top
                ? "  " +
                    label +
                    ": " +
                    Math.round(top.seconds / 3600) +
                    "h from " +
                    fmtEpoch(top.from) +
                    " to " +
                    fmtEpoch(top.to)
                : "  " + label + ": none";
            })
            .join("\n") +
          "\n"
      );
  
      const indiaFastConfirmation =
        instrument.market === "NSE" || instrument.market === "BSE";
  
      if (
        (indiaFastConfirmation &&
          (m1.length < 300 || m5.length < 200)) ||
        m15.length < 200 ||
        h1.length < 100 ||
        h4.length < 60
      ) {
        coverage[instrument.key] = {
          status: "SKIPPED_INSUFFICIENT_HISTORY",
          counts,
          continuity,
          from: first,
          to: last
        };
        process.stdout.write("Skipped: insufficient multi-timeframe history.\n");
        continue;
      }
  
      const candidates = new Map<string, JournalTrade>();

      const primaryStateCounts = new Map<string, number>();
      const primaryReasonCounts = new Map<string, number>();
      const reactionStateCounts = new Map<string, number>();
      const reactionReasonCounts = new Map<string, number>();
      let evaluatedWindows = 0;
      let maxPrimaryScore = 0;
      let maxReversalScore = 0;
      let confirmedReversalWindows = 0;
  
      for (const candle of m15) {
        const evaluationTime = candle.time + 15 * 60;
        if (evaluationTime >= cutoff) break;
  
        const context4h = windowRows(
          h4,
          evaluationTime - 186 * 86400,
          evaluationTime - 4 * 3600
        );
        const context1h = windowRows(
          h1,
          evaluationTime - 93 * 86400,
          evaluationTime - 3600
        );
        const context15m = windowRows(
          m15,
          evaluationTime - 31 * 86400,
          evaluationTime - 15 * 60
        );
        const context5m = indiaFastConfirmation
          ? windowRows(
              m5,
              evaluationTime - 5 * 86400,
              evaluationTime - 5 * 60
            )
          : context15m;
        const context1m = indiaFastConfirmation
          ? windowRows(
              m1,
              evaluationTime - 5 * 86400,
              evaluationTime - 60
            )
          : context15m;
  
        if (
          context4h.length < 30 ||
          context1h.length < 30 ||
          context15m.length < 30 ||
          (indiaFastConfirmation &&
            (context5m.length < 30 || context1m.length < 30))
        ) {
          continue;
        }
  
        const price =
          latestAt(m1, evaluationTime - 60)?.close ??
          latestAt(m15, evaluationTime - 15 * 60)?.close ??
          0;
        if (!(price > 0)) continue;
  
        const evaluated = evaluatePlatformStrategy({
          market: instrument.market,
          price,
          context4h,
          context1h,
          context15m,
          context5m,
          context1m,
          evaluationTime,
          derivatives: null
        });
  
        evaluatedWindows += 1;
      maxPrimaryScore = Math.max(
        maxPrimaryScore,
        Number(evaluated.simpleTradePlan.score ?? 0)
      );
      maxReversalScore = Math.max(
        maxReversalScore,
        Number(evaluated.reversalEngine.selected.score ?? 0)
      );
      if (
        evaluated.reversalEngine.selected.entryState === "CONFIRMED"
      ) {
        confirmedReversalWindows += 1;
      }

      incrementCount(
        primaryStateCounts,
        evaluated.simpleTradePlan.state
      );
      incrementCount(
        primaryReasonCounts,
        evaluated.simpleTradePlan.reason
      );
      incrementCount(
        reactionStateCounts,
        evaluated.reactionTradePlan.state
      );
      incrementCount(
        reactionReasonCounts,
        evaluated.reactionTradePlan.reason
      );

            const primary = evaluated.simpleTradePlan;
        if (
          primary.state === "READY" &&
          primary.signalTime !== null &&
          primary.confirmationTimeframe !== null &&
          primary.entry !== null &&
          primary.stopLoss !== null &&
          primary.trigger &&
          primary.targets.length >= 3
        ) {
          const direction =
            primary.trend === "bullish" ? "long" : "short";
          const id = makeTradeId({
            market: instrument.market,
            symbol: instrument.symbol,
            setupType: "PRIMARY",
            direction,
            signalTime: primary.signalTime
          });
          if (!candidates.has(id)) {
            candidates.set(id, {
              id,
              symbol: instrument.symbol,
              name: instrument.label,
              market: instrument.market,
              setupType: "PRIMARY",
              moveClass: primary.moveClass ?? "TACTICAL",
              direction,
              signalTime: primary.signalTime,
              confirmationTimeframe: primary.confirmationTimeframe,
              entry: primary.entry,
              initialStop: primary.stopLoss,
              currentStop: primary.stopLoss,
              targets: primary.targets.slice(0, 3),
              trigger: primary.trigger,
              score: primary.score,
              status: "OPEN",
              outcome: "OPEN",
              highestTargetHit: 0,
              resultR: null,
              closedTime: null,
              ambiguityReason: null,
              createdAt: primary.signalTime * 1000
            });
          }
        }
  
        const reaction = evaluated.reactionTradePlan;
        if (
          reaction.state === "READY" &&
          reaction.direction !== null &&
          reaction.signalTime !== null &&
          reaction.entry !== null &&
          reaction.stopLoss !== null &&
          reaction.trigger &&
          reaction.targets.length >= 3
        ) {
          const direction =
            reaction.direction === "bullish" ? "long" : "short";
          const id = makeTradeId({
            market: instrument.market,
            symbol: instrument.symbol,
            setupType: "REACTION",
            direction,
            signalTime: reaction.signalTime
          });
          if (!candidates.has(id)) {
            candidates.set(id, {
              id,
              symbol: instrument.symbol,
              name: instrument.label,
              market: instrument.market,
              setupType: "REACTION",
              moveClass: reaction.moveClass ?? "TACTICAL",
              direction,
              signalTime: reaction.signalTime,
              confirmationTimeframe: "15m",
              entry: reaction.entry,
              initialStop: reaction.stopLoss,
              currentStop: reaction.stopLoss,
              targets: reaction.targets.slice(0, 3),
              trigger: reaction.trigger,
              score: reaction.score,
              status: "OPEN",
              outcome: "OPEN",
              highestTargetHit: 0,
              resultR: null,
              closedTime: null,
              ambiguityReason: null,
              createdAt: reaction.signalTime * 1000
            });
          }
        }
      }
  
      process.stdout.write(
        "Replay diagnostics: evaluated=" +
          evaluatedWindows +
          ", max primary score=" +
          maxPrimaryScore +
          ", max reversal score=" +
          maxReversalScore +
          ", confirmed reversal windows=" +
          confirmedReversalWindows +
          "\nPrimary states: " +
          JSON.stringify(Object.fromEntries(primaryStateCounts)) +
          "\nReaction states: " +
          JSON.stringify(Object.fromEntries(reactionStateCounts)) +
          "\nTop primary reasons:\n" +
          topCounts(primaryReasonCounts)
            .map(([reason, count]) => "  " + count + " × " + reason)
            .join("\n") +
          "\nTop reaction reasons:\n" +
          topCounts(reactionReasonCounts)
            .map(([reason, count]) => "  " + count + " × " + reason)
            .join("\n") +
          "\n"
      );

            const accepted = [...candidates.values()]
        .sort((a, b) => a.signalTime - b.signalTime)
        .map((trade) => {
          const fromIndex = lowerBound(m1, trade.signalTime);
          const future = m1.slice(fromIndex).filter(
            (row) => row.time < cutoff
          );
          return reconcileTradeWithCandles(trade, future);
        });
  
      // Only accepted strategy signals reach persistence. Rejected/refused/
      // unverifiable candidates are never inserted into any trade table.
      await insertTrades(runId, instrument, accepted, version);
  
      coverage[instrument.key] = {
        status: "COMPLETED",
        counts,
        continuity,
        from: first,
        to: last,
        acceptedTrades: accepted.length
      };
  
      process.stdout.write(
        "Accepted " + accepted.length + " historical signals.\n"
      );
      } catch (error) {
        const message = transientMessage(error);

        coverage[instrument.key] = {
          status: isTransientError(error)
            ? "FAILED_TRANSIENT"
            : "FAILED",
          error: message
        };

        process.stderr.write(
          instrument.key +
            " backtest failed but suite will continue: " +
            message +
            "\n"
        );
      }
    }
  
    await withRetry(
      "Neon finalize backtest run",
      () => pool.query(
      `update public.strategy_backtest_runs
       set status='COMPLETED', coverage=$2::jsonb, completed_at=now()
       where id=$1`,
      [runId, JSON.stringify(coverage)]
      )
    );
  
    process.stdout.write(
      "\nBacktest run complete: " +
        runId +
        "\nLive cutoff: " +
        new Date(cutoff * 1000).toISOString() +
        "\n"
    );
  } catch (error) {
    process.stderr.write(
      "\nBacktest failed: " +
        (error instanceof Error ? error.message : String(error)) +
        "\n"
    );

    try {
      await pool.query(
        `update public.strategy_backtest_runs
         set status='FAILED', completed_at=now(),
             notes = notes || $2
         where id=$1 and status='RUNNING'`,
        [
          typeof runId === "string" ? runId : "",
          "\nRunner failure: " +
            (error instanceof Error ? error.message : String(error))
        ]
      );
    } catch {
      // Do not mask the original runner failure.
    }

    throw error;
  } finally {
    await pool.end();
  }
  
}

void main().catch(() => {
  process.exitCode = 1;
});
