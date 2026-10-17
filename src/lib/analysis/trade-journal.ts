export type JournalDirection = "long" | "short";
export type JournalStatus = "OPEN" | "CLOSED";
export type JournalOutcome =
  | "OPEN"
  | "SL"
  | "BREAKEVEN"
  | "T1_LOCK"
  | "T3"
  | "AMBIGUOUS";

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
  setupType?: "PRIMARY" | "REACTION";
  moveClass?: "TACTICAL" | "MAJOR";
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
  ambiguityReason?: string | null;
  createdAt: number;
};

export type TradeStats = {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  ambiguous: number;
  winRate: number;
  totalR: number;
  averageR: number;
};

export function makeTradeId(input: {
  market: string;
  symbol: string;
  direction: JournalDirection;
  signalTime: number;
  setupType?: "PRIMARY" | "REACTION";
}) {
  return [
    input.market,
    input.symbol,
    input.setupType ?? "PRIMARY",
    input.direction,
    input.signalTime
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

export type JournalCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function touches(
  direction: JournalDirection,
  candle: JournalCandle,
  price: number,
  kind: "target" | "stop"
) {
  if (kind === "target") {
    return direction === "long"
      ? candle.high >= price
      : candle.low <= price;
  }

  return direction === "long"
    ? candle.low <= price
    : candle.high >= price;
}

export function reconcileTradeWithCandles(
  trade: JournalTrade,
  candles: JournalCandle[]
): JournalTrade {
  if (trade.status === "CLOSED") return trade;

  let current = { ...trade };

  for (const candle of candles) {
    if (
      candle.time < trade.signalTime ||
      current.status === "CLOSED"
    ) {
      continue;
    }

    const [t1, t2, t3] = current.targets;
    const stopTouched = touches(
      current.direction,
      candle,
      current.currentStop,
      "stop"
    );

    const nextTarget =
      current.highestTargetHit === 0
        ? t1
        : current.highestTargetHit === 1
          ? t2
          : current.highestTargetHit === 2
            ? t3
            : null;
    const targetTouched =
      nextTarget &&
      touches(
        current.direction,
        candle,
        nextTarget.price,
        "target"
      );

    if (stopTouched && targetTouched) {
      return {
        ...current,
        status: "CLOSED",
        outcome: "AMBIGUOUS",
        resultR: null,
        closedTime: candle.time,
        ambiguityReason:
          "The same 1-minute candle touched both the active stop and the next target; intrabar sequence cannot be proven."
      };
    }

    if (targetTouched && nextTarget) {
      if (nextTarget.label === "T3") {
        return {
          ...current,
          highestTargetHit: 3,
          status: "CLOSED",
          outcome: "T3",
          resultR: nextTarget.rr,
          closedTime: candle.time,
          ambiguityReason: null
        };
      }

      if (nextTarget.label === "T2") {
        current = {
          ...current,
          highestTargetHit: 2,
          currentStop: t1?.price ?? current.entry
        };
      } else {
        current = {
          ...current,
          highestTargetHit: 1,
          currentStop: current.entry
        };
      }
      continue;
    }

    if (stopTouched) {
      if (current.highestTargetHit >= 2) {
        return {
          ...current,
          status: "CLOSED",
          outcome: "T1_LOCK",
          resultR: t1?.rr ?? 0,
          closedTime: candle.time,
          ambiguityReason: null
        };
      }

      if (current.highestTargetHit === 1) {
        return {
          ...current,
          status: "CLOSED",
          outcome: "BREAKEVEN",
          resultR: 0,
          closedTime: candle.time,
          ambiguityReason: null
        };
      }

      return {
        ...current,
        status: "CLOSED",
        outcome: "SL",
        resultR: -1,
        closedTime: candle.time,
        ambiguityReason: null
      };
    }
  }

  return current;
}

export function summarizeTrades(trades: JournalTrade[]): TradeStats {
  const closedTrades = trades.filter(
    (trade) => trade.status === "CLOSED" && trade.resultR !== null
  );
  const wins = closedTrades.filter((trade) => (trade.resultR ?? 0) > 0).length;
  const losses = closedTrades.filter((trade) => (trade.resultR ?? 0) < 0).length;
  const breakeven = closedTrades.filter((trade) => trade.resultR === 0).length;
  const ambiguous = trades.filter(
    (trade) => trade.outcome === "AMBIGUOUS"
  ).length;
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
    ambiguous,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
    totalR,
    averageR: closedTrades.length ? totalR / closedTrades.length : 0
  };
}
