import type {
  ImbalanceLiquiditySnapshot,
  MarketStructureSnapshot,
  OrderBlockSnapshot
} from "./market-structure";

export type OpeningConfirmation = {
  active: boolean;
  confirmed: boolean;
  timeframe: "1m" | "5m" | null;
  time: number | null;
  trigger:
    | "LIQUIDITY SWEEP"
    | "ORDER BLOCK"
    | "SWEEP + ORDER BLOCK"
    | null;
  reason: string;
};

function istParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp * 1000));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: get("weekday"),
    hour: Number(get("hour") || 0),
    minute: Number(get("minute") || 0)
  };
}

export function indianSessionOpenEpoch(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp * 1000));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const year = get("year");
  const month = get("month");
  const day = get("day");

  if (!year || !month || !day) return null;

  // 09:15 IST = 03:45 UTC. India has no daylight-saving shift.
  return Math.floor(Date.UTC(year, month - 1, day, 3, 45, 0) / 1000);
}

export function isIndianOpeningWindow(timestamp: number) {
  const now = istParts(timestamp);
  if (now.weekday === "Sat" || now.weekday === "Sun") return false;

  const minuteOfDay = now.hour * 60 + now.minute;
  const open = 9 * 60 + 15;
  const fastWindowEnd = 10 * 60 + 15;

  return minuteOfDay >= open && minuteOfDay <= fastWindowEnd;
}

function recentDirectionalEvent(
  structure: MarketStructureSnapshot,
  direction: "bullish" | "bearish",
  latestTime: number,
  maxAgeSeconds: number
) {
  const event = structure.latestEvent;
  if (!event || event.direction !== direction) return null;
  if (latestTime < event.time) return null;
  if (latestTime - event.time > maxAgeSeconds) return null;
  return event;
}

function recentSweep(
  imbalance: ImbalanceLiquiditySnapshot,
  direction: "bullish" | "bearish",
  latestTime: number,
  maxAgeSeconds: number
) {
  const sweep = imbalance.latestSweep;
  if (!sweep || sweep.direction !== direction) return null;
  if (latestTime < sweep.time) return null;
  if (latestTime - sweep.time > maxAgeSeconds) return null;
  return sweep;
}

function hasDirectionalBlock(
  blocks: OrderBlockSnapshot,
  direction: "bullish" | "bearish"
) {
  return blocks.activeBlocks.some((block) => block.direction === direction);
}

export function buildOpeningConfirmation(input: {
  market: string;
  latestTime: number | null;
  direction: "bullish" | "bearish" | "neutral";
  structure1m: MarketStructureSnapshot;
  structure5m: MarketStructureSnapshot;
  imbalance1m: ImbalanceLiquiditySnapshot;
  imbalance5m: ImbalanceLiquiditySnapshot;
  orderBlocks5m: OrderBlockSnapshot;
}): OpeningConfirmation {
  const {
    market,
    latestTime,
    direction,
    structure1m,
    structure5m,
    imbalance1m,
    imbalance5m,
    orderBlocks5m
  } = input;

  if (
    latestTime === null ||
    direction === "neutral" ||
    (market !== "NSE" && market !== "BSE") ||
    !isIndianOpeningWindow(latestTime)
  ) {
    return {
      active: false,
      confirmed: false,
      timeframe: null,
      time: null,
      trigger: null,
      reason: "Fast opening confirmation is inactive."
    };
  }

  const event5m = recentDirectionalEvent(
    structure5m,
    direction,
    latestTime,
    12 * 60
  );
  const event1m = recentDirectionalEvent(
    structure1m,
    direction,
    latestTime,
    3 * 60
  );
  const sweep5m = recentSweep(
    imbalance5m,
    direction,
    latestTime,
    15 * 60
  );
  const sweep1m = recentSweep(
    imbalance1m,
    direction,
    latestTime,
    5 * 60
  );
  const block = hasDirectionalBlock(orderBlocks5m, direction);

  if (event5m && (sweep5m || sweep1m || block)) {
    return {
      active: true,
      confirmed: true,
      timeframe: "5m",
      time: event5m.time,
      trigger:
        (sweep5m || sweep1m) && block
          ? "SWEEP + ORDER BLOCK"
          : sweep5m || sweep1m
            ? "LIQUIDITY SWEEP"
            : "ORDER BLOCK",
      reason:
        "Prior-session higher-timeframe setup has fresh 5m opening structure confirmation."
    };
  }

  if (event1m && sweep1m) {
    return {
      active: true,
      confirmed: true,
      timeframe: "1m",
      time: event1m.time,
      trigger: block ? "SWEEP + ORDER BLOCK" : "LIQUIDITY SWEEP",
      reason:
        "Prior-session higher-timeframe setup has an exact 1m opening sweep plus structure confirmation."
    };
  }

  return {
    active: true,
    confirmed: false,
    timeframe: null,
    time: null,
    trigger: null,
    reason:
      "Higher-timeframe context is carried into the open, but fresh 1m/5m confirmation is still missing."
  };
}
