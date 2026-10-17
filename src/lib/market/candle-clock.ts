export type CandleClockStatus =
  | "counting"
  | "market_closed"
  | "waiting";

export type CandleClockResult = {
  status: CandleClockStatus;
  closeTime: number | null;
  remainingSeconds: number | null;
};

function intervalSeconds(
  resolution: string,
  candleStart: number
): number | null {
  if (/^\d+$/.test(resolution)) {
    return Number(resolution) * 60;
  }

  if (resolution === "1D") return 24 * 60 * 60;
  if (resolution === "1W") return 7 * 24 * 60 * 60;

  if (resolution === "1M") {
    const date = new Date(candleStart * 1000);
    const next = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    );
    return Math.floor(next / 1000) - candleStart;
  }

  return null;
}

function istNowParts(nowMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date(nowMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: get("weekday"),
    hour: Number(get("hour") || 0),
    minute: Number(get("minute") || 0),
    second: Number(get("second") || 0)
  };
}

function isIndianCashSessionOpen(nowMs: number) {
  const now = istNowParts(nowMs);

  if (now.weekday === "Sat" || now.weekday === "Sun") {
    return false;
  }

  const seconds =
    now.hour * 3600 + now.minute * 60 + now.second;
  const open = 9 * 3600 + 15 * 60;
  const close = 15 * 3600 + 30 * 60;

  return seconds >= open && seconds < close;
}

function secondsUntilIndianClose(nowMs: number) {
  const now = istNowParts(nowMs);
  const seconds =
    now.hour * 3600 + now.minute * 60 + now.second;
  const close = 15 * 3600 + 30 * 60;

  return Math.max(0, close - seconds);
}

function isIndianExchange(market: string) {
  return market === "NSE" || market === "BSE";
}

export function calculateCandleClock(options: {
  nowMs: number;
  candleStart: number | null;
  resolution: string;
  market: string;
}): CandleClockResult {
  const { nowMs, candleStart, resolution, market } = options;

  if (!candleStart) {
    return {
      status: "waiting",
      closeTime: null,
      remainingSeconds: null
    };
  }

  if (isIndianExchange(market) && !isIndianCashSessionOpen(nowMs)) {
    return {
      status: "market_closed",
      closeTime: null,
      remainingSeconds: null
    };
  }

  const interval = intervalSeconds(resolution, candleStart);

  if (!interval || interval <= 0) {
    return {
      status: "waiting",
      closeTime: null,
      remainingSeconds: null
    };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  let closeTime = candleStart + interval;

  // If the provider sends the current candle start but the local clock has
  // crossed the boundary, advance to the live interval boundary.
  if (closeTime <= nowSeconds) {
    const elapsed = nowSeconds - candleStart;
    const intervalsElapsed = Math.floor(elapsed / interval);
    closeTime =
      candleStart + (intervalsElapsed + 1) * interval;
  }

  if (isIndianExchange(market) && /^\d+$/.test(resolution)) {
    const untilSessionClose = secondsUntilIndianClose(nowMs);
    closeTime = Math.min(
      closeTime,
      nowSeconds + untilSessionClose
    );
  }

  return {
    status: "counting",
    closeTime,
    remainingSeconds: Math.max(0, closeTime - nowSeconds)
  };
}

export function formatCountdown(
  remainingSeconds: number | null
) {
  if (remainingSeconds === null) return "—";

  const total = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}
