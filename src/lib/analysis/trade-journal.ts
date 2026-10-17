export type JournalDirection = "long" | "short";
export type JournalStatus = "OPEN" | "CLOSED";
export type JournalOutcome = "OPEN" | "SL" | "BREAKEVEN" | "T1_LOCK" | "T3";

export type JournalTarget = {
  label: "T1" | "T2" | "T3";
  price: number;
  rr: number | null;
  source: string;
};

export type JournalTrade = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  direction: JournalDirection;
  signalTime: number;
  confirmationTimeframe: "1m" | "5m" | "15m";
  entry: number;
  initialStop: number;
  currentStop: number;
  targets: JournalTarget[];
  trigger: string;
  score: number;
  status: JournalStatus;
  outcome: JournalOutcome;
  highestTargetHit: 0 | 1 | 2 | 3;
  resultR: number | null;
  closedTime: number | null;
  createdAt: number;
};

export type TradeStats = {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalR: number;
  averageR: number;
};

export function makeTradeId(input: {
  market: string;
  symbol: string;
  direction: JournalDirection;
  signalTime: number;
  entry: number;
}) {
  return [
    input.market,
    input.symbol,
    input.direction,
    input.signalTime,
    input.entry.toFixed(8)
  ].join("|");
}

export function updateTradeWithPrice(
  trade: JournalTrade,
  price: number,
  time: number
): JournalTrade {
  if (trade.status === "CLOSED" || !(price > 0)) return trade;

  const isLong = trade.direction === "long";
  const crossedTarget = (target: number) =>
    isLong ? price >= target : price <= target;
  const crossedStop = (stop: number) =>
    isLong ? price <= stop : price >= stop;

  let next = { ...trade };
  const [t1, t2, t3] = trade.targets;

  if (t3 && crossedTarget(t3.price)) {
    return {
      ...next,
      highestTargetHit: 3,
      status: "CLOSED",
      outcome: "T3",
      resultR: t3.rr,
      closedTime: time
    };
  }

  if (t2 && crossedTarget(t2.price) && next.highestTargetHit < 2) {
    next = {
      ...next,
      highestTargetHit: 2,
      currentStop: t1?.price ?? next.entry
    };
  } else if (t1 && crossedTarget(t1.price) && next.highestTargetHit < 1) {
    next = {
      ...next,
      highestTargetHit: 1,
      currentStop: next.entry
    };
  }

  if (!crossedStop(next.currentStop)) return next;

  if (next.highestTargetHit >= 2) {
    const lockedR = t1?.rr ?? 0;
    return {
      ...next,
      status: "CLOSED",
      outcome: "T1_LOCK",
      resultR: lockedR,
      closedTime: time
    };
  }

  if (next.highestTargetHit === 1) {
    return {
      ...next,
      status: "CLOSED",
      outcome: "BREAKEVEN",
      resultR: 0,
      closedTime: time
    };
  }

  return {
    ...next,
    status: "CLOSED",
    outcome: "SL",
    resultR: -1,
    closedTime: time
  };
}

export function summarizeTrades(trades: JournalTrade[]): TradeStats {
  const closedTrades = trades.filter(
    (trade) => trade.status === "CLOSED" && trade.resultR !== null
  );
  const wins = closedTrades.filter((trade) => (trade.resultR ?? 0) > 0).length;
  const losses = closedTrades.filter((trade) => (trade.resultR ?? 0) < 0).length;
  const breakeven = closedTrades.filter((trade) => trade.resultR === 0).length;
  const totalR = closedTrades.reduce(
    (sum, trade) => sum + (trade.resultR ?? 0),
    0
  );

  return {
    total: trades.length,
    open: trades.filter((trade) => trade.status === "OPEN").length,
    closed: closedTrades.length,
    wins,
    losses,
    breakeven,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
    totalR,
    averageR: closedTrades.length ? totalR / closedTrades.length : 0
  };
}
