import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import {
  computeSmartFlow,
  stateTransitions
} from "./lib/smart-flow-research.mjs";

const { Pool } = pg;

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const text = readFileSync(".env.local", "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(
    /([?&])sslmode=require(?=&|$)/,
    "$1sslmode=verify-full"
  );
}

loadLocalEnv();

const databaseUrl = strictSslUrl(
  process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    ""
);

if (!databaseUrl) {
  throw new Error(
    "Smart Flow backtest needs DATABASE_URL. Pull Neon env first."
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const COST_BPS = Math.max(
  0,
  Number(process.env.SMART_FLOW_COST_BPS ?? 8)
);
const MAX_SERIES = Math.max(
  3,
  Number(process.env.SMART_FLOW_MAX_SERIES ?? 60)
);
const MAX_CANDLES = Math.max(
  500,
  Number(process.env.SMART_FLOW_MAX_CANDLES ?? 50_000)
);
const MIN_SERIES_CANDLES = Math.max(
  250,
  Number(process.env.SMART_FLOW_MIN_CANDLES ?? 800)
);

const parameterGrid = [];
for (const range of [50, 70, 90]) {
  for (const length of [8, 10, 14]) {
    for (const factor of [1.0, 1.2, 1.4]) {
      parameterGrid.push({
        range,
        length,
        factor,
        fastEma: 10,
        slowEma: 30
      });
    }
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeReturns(returns) {
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, value) => sum + value, 0)
  );

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    trades: returns.length,
    wins: wins.length,
    losses: losses.length,
    winRate: returns.length ? wins.length / returns.length : 0,
    averageReturn: returns.length
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : 0,
    medianReturn: median(returns),
    totalReturn: returns.reduce((sum, value) => sum + value, 0),
    profitFactor:
      grossLoss > 0
        ? grossWin / grossLoss
        : grossWin > 0
          ? Number.POSITIVE_INFINITY
          : 0,
    maxDrawdown
  };
}

function simulate(candles, points, startIndex, endIndex) {
  const transitions = stateTransitions(points).filter(
    (signal) =>
      signal.index >= startIndex &&
      signal.index < endIndex - 1
  );

  const returns = [];
  const trades = [];
  let active = null;

  for (const signal of transitions) {
    const entryIndex = signal.index + 1;
    if (entryIndex >= endIndex) break;

    if (!active) {
      active = {
        direction: signal.direction,
        signalIndex: signal.index,
        entryIndex,
        entry: Number(candles[entryIndex].open)
      };
      continue;
    }

    if (signal.direction === active.direction) continue;

    const exitIndex = Math.min(entryIndex, endIndex - 1);
    const exit = Number(candles[exitIndex].open);
    const gross =
      active.direction === "LONG"
        ? (exit - active.entry) / active.entry
        : (active.entry - exit) / active.entry;
    const net = gross - COST_BPS / 10_000;

    returns.push(net);
    trades.push({
      ...active,
      exitIndex,
      exit,
      net
    });

    active = {
      direction: signal.direction,
      signalIndex: signal.index,
      entryIndex,
      entry: Number(candles[entryIndex].open)
    };
  }

  if (active && endIndex - 1 > active.entryIndex) {
    const exitIndex = endIndex - 1;
    const exit = Number(candles[exitIndex].close);
    const gross =
      active.direction === "LONG"
        ? (exit - active.entry) / active.entry
        : (active.entry - exit) / active.entry;
    const net = gross - COST_BPS / 10_000;
    returns.push(net);
    trades.push({
      ...active,
      exitIndex,
      exit,
      net
    });
  }

  const forward = {
    1: [],
    3: [],
    6: [],
    12: []
  };

  for (const signal of transitions) {
    const entryIndex = signal.index + 1;
    if (entryIndex >= endIndex) continue;
    const entry = Number(candles[entryIndex].open);

    for (const horizon of [1, 3, 6, 12]) {
      const targetIndex = entryIndex + horizon - 1;
      if (targetIndex >= endIndex) continue;
      const target = Number(candles[targetIndex].close);
      const directional =
        signal.direction === "LONG"
          ? (target - entry) / entry
          : (entry - target) / entry;
      forward[horizon].push(directional);
    }
  }

  const base = summarizeReturns(returns);
  const longTrades = trades.filter((trade) => trade.direction === "LONG");
  const shortTrades = trades.filter((trade) => trade.direction === "SHORT");

  return {
    ...base,
    longTrades: longTrades.length,
    shortTrades: shortTrades.length,
    forwardAccuracy: Object.fromEntries(
      Object.entries(forward).map(([horizon, values]) => [
        horizon,
        values.length
          ? values.filter((value) => value > 0).length / values.length
          : 0
      ])
    )
  };
}

function aggregateSeries(seriesResults) {
  const allReturns = seriesResults.flatMap((item) => item.returns);
  const summary = summarizeReturns(allReturns);
  const expectancies = seriesResults.map((item) => item.summary.averageReturn);
  const profitableSeries = seriesResults.filter(
    (item) => item.summary.totalReturn > 0
  ).length;

  const positiveContributions = seriesResults
    .map((item) => Math.max(0, item.summary.totalReturn))
    .filter((value) => value > 0);
  const totalPositive = positiveContributions.reduce(
    (sum, value) => sum + value,
    0
  );
  const maxContributionShare =
    totalPositive > 0 && positiveContributions.length
      ? Math.max(...positiveContributions) / totalPositive
      : 0;

  return {
    ...summary,
    series: seriesResults.length,
    profitableSeries,
    profitableSeriesShare: seriesResults.length
      ? profitableSeries / seriesResults.length
      : 0,
    medianSeriesExpectancy: median(expectancies),
    maxPositiveContributionShare,
    longTrades: seriesResults.reduce(
      (sum, item) => sum + item.summary.longTrades,
      0
    ),
    shortTrades: seriesResults.reduce(
      (sum, item) => sum + item.summary.shortTrades,
      0
    )
  };
}

async function discoverSeries() {
  const result = await pool.query(
    `select provider, market, symbol, resolution, count(*)::int as candles
     from public.market_candles
     where provider in ('FYERS','KRAKEN','OANDA')
       and resolution in ('5','15','60','240','1D')
     group by provider, market, symbol, resolution
     having count(*) >= $1
     order by
       case provider when 'FYERS' then 1 when 'KRAKEN' then 2 else 3 end,
       count(*) desc
     limit $2`,
    [MIN_SERIES_CANDLES, MAX_SERIES]
  );

  return result.rows;
}

async function loadCandles(meta) {
  const result = await pool.query(
    `select candle_time as time, open, high, low, close, volume
     from (
       select candle_time, open, high, low, close, volume
       from public.market_candles
       where provider=$1 and market=$2 and symbol=$3 and resolution=$4
       order by candle_time desc
       limit $5
     ) recent
     order by candle_time asc`,
    [
      meta.provider,
      meta.market,
      meta.symbol,
      meta.resolution,
      MAX_CANDLES
    ]
  );

  return result.rows.map((row) => ({
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0)
  }));
}

function paramKey(params) {
  return `r${params.range}-l${params.length}-f${params.factor}`;
}

function neighborParams(selected) {
  return parameterGrid.filter((candidate) => {
    const differences = [
      candidate.range !== selected.range,
      candidate.length !== selected.length,
      candidate.factor !== selected.factor
    ].filter(Boolean).length;

    if (differences !== 1) return false;

    const rangeNear =
      candidate.range === selected.range ||
      Math.abs(candidate.range - selected.range) <= 20;
    const lengthNear =
      candidate.length === selected.length ||
      Math.abs(candidate.length - selected.length) <= 6;
    const factorNear =
      candidate.factor === selected.factor ||
      Math.abs(candidate.factor - selected.factor) <= 0.21;

    return rangeNear && lengthNear && factorNear;
  });
}

function replayInvariant(candles, params, tickVolume) {
  const full = computeSmartFlow(candles, params, { tickVolume });
  const start = Math.max(params.range, params.slowEma) + 5;
  if (candles.length <= start + 5) return { checks: 0, failures: 0 };

  const checks = Math.min(12, candles.length - start - 1);
  let failures = 0;

  for (let k = 0; k < checks; k += 1) {
    const index =
      start +
      Math.floor(
        ((candles.length - start - 2) * k) /
          Math.max(1, checks - 1)
      );
    const prefix = candles.slice(0, index + 1);
    const replay = computeSmartFlow(prefix, params, { tickVolume });
    const a = full[index];
    const b = replay[replay.length - 1];

    if (
      a.state !== b.state ||
      Math.abs(a.composite - b.composite) > 1e-10
    ) {
      failures += 1;
    }
  }

  return { checks, failures };
}

const seriesMeta = await discoverSeries();

if (seriesMeta.length < 3) {
  throw new Error(
    `Not enough cached history to backtest Smart Flow. Found ${seriesMeta.length} eligible series; backfill market/OANDA history first.`
  );
}

process.stdout.write(
  `Smart Flow research backtest: ${seriesMeta.length} series, ${parameterGrid.length} parameter sets, cost=${COST_BPS} bps round-trip.\n`
);

const datasets = [];
for (const meta of seriesMeta) {
  const candles = await loadCandles(meta);
  if (candles.length < MIN_SERIES_CANDLES) continue;
  datasets.push({
    meta,
    candles,
    trainEnd: Math.floor(candles.length * 0.6),
    validationEnd: Math.floor(candles.length * 0.8)
  });
}

const validationResults = [];

for (const params of parameterGrid) {
  const perSeries = [];

  for (const dataset of datasets) {
    const tickVolume = dataset.meta.provider === "OANDA";
    const points = computeSmartFlow(dataset.candles, params, {
      tickVolume
    });
    const summary = simulate(
      dataset.candles,
      points,
      dataset.trainEnd,
      dataset.validationEnd
    );

    // Reconstruct approximate trade returns from summary is not enough for
    // aggregation, so run a small local extraction using the same simulator
    // output convention by repeating transition exits here.
    const transitions = stateTransitions(points).filter(
      (signal) =>
        signal.index >= dataset.trainEnd &&
        signal.index < dataset.validationEnd - 1
    );
    const returns = [];
    let active = null;
    for (const signal of transitions) {
      const entryIndex = signal.index + 1;
      if (entryIndex >= dataset.validationEnd) break;
      if (!active) {
        active = {
          direction: signal.direction,
          entry: dataset.candles[entryIndex].open
        };
        continue;
      }
      if (signal.direction === active.direction) continue;
      const exit = dataset.candles[entryIndex].open;
      const gross =
        active.direction === "LONG"
          ? (exit - active.entry) / active.entry
          : (active.entry - exit) / active.entry;
      returns.push(gross - COST_BPS / 10_000);
      active = {
        direction: signal.direction,
        entry: dataset.candles[entryIndex].open
      };
    }

    perSeries.push({
      id: `${dataset.meta.provider}|${dataset.meta.market}|${dataset.meta.symbol}|${dataset.meta.resolution}`,
      summary,
      returns
    });
  }

  const aggregate = aggregateSeries(perSeries);
  const score =
    aggregate.averageReturn * 10_000 +
    Math.min(3, aggregate.profitFactor) * 0.4 +
    aggregate.profitableSeriesShare * 0.5 -
    aggregate.maxDrawdown * 100;

  validationResults.push({
    params,
    key: paramKey(params),
    aggregate,
    score
  });
}

const eligible = validationResults.filter(
  (item) => item.aggregate.trades >= 50
);
const ranked = (eligible.length ? eligible : validationResults)
  .slice()
  .sort((a, b) => b.score - a.score);

const selected = ranked[0];
const testSeries = [];
let replayChecks = 0;
let replayFailures = 0;

for (const dataset of datasets) {
  const tickVolume = dataset.meta.provider === "OANDA";
  const points = computeSmartFlow(dataset.candles, selected.params, {
    tickVolume
  });
  const summary = simulate(
    dataset.candles,
    points,
    dataset.validationEnd,
    dataset.candles.length
  );

  const transitions = stateTransitions(points).filter(
    (signal) =>
      signal.index >= dataset.validationEnd &&
      signal.index < dataset.candles.length - 1
  );
  const returns = [];
  let active = null;
  for (const signal of transitions) {
    const entryIndex = signal.index + 1;
    if (entryIndex >= dataset.candles.length) break;
    if (!active) {
      active = {
        direction: signal.direction,
        entry: dataset.candles[entryIndex].open
      };
      continue;
    }
    if (signal.direction === active.direction) continue;
    const exit = dataset.candles[entryIndex].open;
    const gross =
      active.direction === "LONG"
        ? (exit - active.entry) / active.entry
        : (active.entry - exit) / active.entry;
    returns.push(gross - COST_BPS / 10_000);
    active = {
      direction: signal.direction,
      entry: dataset.candles[entryIndex].open
    };
  }

  const invariant = replayInvariant(
    dataset.candles,
    selected.params,
    tickVolume
  );
  replayChecks += invariant.checks;
  replayFailures += invariant.failures;

  testSeries.push({
    provider: dataset.meta.provider,
    market: dataset.meta.market,
    symbol: dataset.meta.symbol,
    resolution: dataset.meta.resolution,
    candles: dataset.candles.length,
    summary,
    returns
  });
}

const testAggregate = aggregateSeries(testSeries);

const neighbors = neighborParams(selected.params);
const neighborResults = [];
for (const params of neighbors) {
  const returns = [];
  for (const dataset of datasets) {
    const points = computeSmartFlow(dataset.candles, params, {
      tickVolume: dataset.meta.provider === "OANDA"
    });
    const summary = simulate(
      dataset.candles,
      points,
      dataset.validationEnd,
      dataset.candles.length
    );
    returns.push(summary.averageReturn);
  }
  neighborResults.push({
    params,
    medianSeriesExpectancy: median(returns),
    positive: median(returns) > 0
  });
}

const positiveNeighborShare = neighborResults.length
  ? neighborResults.filter((item) => item.positive).length /
    neighborResults.length
  : 0;

const gates = {
  noLookAheadFailures: replayFailures === 0,
  enoughSignals: testAggregate.trades >= 200,
  positiveExpectancy: testAggregate.averageReturn > 0,
  profitFactor: testAggregate.profitFactor >= 1.2,
  medianSeriesExpectancy:
    testAggregate.medianSeriesExpectancy >= 0,
  contributionConcentration:
    testAggregate.maxPositiveContributionShare <= 0.3,
  parameterStability: positiveNeighborShare >= 0.5,
  bothDirections:
    testAggregate.longTrades > 0 && testAggregate.shortTrades > 0
};

const passed = Object.values(gates).every(Boolean);

const report = {
  generatedAt: new Date().toISOString(),
  researchOnly: true,
  promotedToLive: false,
  costs: {
    roundTripBps: COST_BPS
  },
  datasets: datasets.map((dataset) => ({
    provider: dataset.meta.provider,
    market: dataset.meta.market,
    symbol: dataset.meta.symbol,
    resolution: dataset.meta.resolution,
    candles: dataset.candles.length,
    trainEnd: dataset.trainEnd,
    validationEnd: dataset.validationEnd
  })),
  selectedValidationParameters: selected,
  untouchedTest: {
    aggregate: testAggregate,
    series: testSeries.map(({ returns, ...item }) => item),
    replay: {
      checks: replayChecks,
      failures: replayFailures
    },
    neighborResults,
    positiveNeighborShare
  },
  promotionGates: gates,
  promotionPassed: passed,
  note: passed
    ? "Backtest gates passed. Paper/shadow testing is still required before live strategy influence."
    : "Backtest gates failed. Smart Flow remains research-only and must not be wired into the live UI/strategy."
};

mkdirSync("reports", { recursive: true });
const filename =
  "reports/smart-flow-backtest-" +
  new Date().toISOString().replace(/[:.]/g, "-") +
  ".json";
writeFileSync(filename, JSON.stringify(report, null, 2));

process.stdout.write(
  "\nSelected parameters from VALIDATION only:\n" +
    JSON.stringify(selected.params) +
    "\n\nUntouched TEST aggregate:\n" +
    JSON.stringify(testAggregate, null, 2) +
    "\n\nReplay/look-ahead checks: " +
    replayChecks +
    " checks, " +
    replayFailures +
    " failures.\n" +
    "Promotion gates: " +
    JSON.stringify(gates, null, 2) +
    "\n\nRESULT: " +
    (passed ? "BACKTEST GATES PASSED" : "RESEARCH ONLY - GATES FAILED") +
    "\nReport: " +
    filename +
    "\n"
);

await pool.end();

if (!passed) {
  process.exitCode = 2;
}
