import type { AnalysisCandle } from "./market-structure";

export type DailyPivotLevels = {
  sessionKey: string;
  sessionStart: number;
  sessionEnd: number | null;
  sourceSessionKey: string;
  sourceHigh: number;
  sourceLow: number;
  sourceClose: number;
  p: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
};

function sessionKey(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp * 1000));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function buildDailyTraditionalPivots(
  candles: AnalysisCandle[],
  options?: {
    timeZone?: string;
  }
): DailyPivotLevels[] {
  if (candles.length < 2) return [];

  const timeZone = options?.timeZone ?? "UTC";
  const sessions: Array<{
    key: string;
    start: number;
    end: number;
    high: number;
    low: number;
    close: number;
  }> = [];

  for (const candle of candles) {
    const key = sessionKey(candle.time, timeZone);
    const last = sessions[sessions.length - 1];

    if (!last || last.key !== key) {
      sessions.push({
        key,
        start: candle.time,
        end: candle.time,
        high: candle.high,
        low: candle.low,
        close: candle.close
      });
      continue;
    }

    last.end = candle.time;
    last.high = Math.max(last.high, candle.high);
    last.low = Math.min(last.low, candle.low);
    last.close = candle.close;
  }

  if (sessions.length < 2) return [];

  const result: DailyPivotLevels[] = [];

  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1];
    const current = sessions[index];
    const next = sessions[index + 1] ?? null;

    const p = (previous.high + previous.low + previous.close) / 3;
    const range = previous.high - previous.low;

    const r1 = p * 2 - previous.low;
    const s1 = p * 2 - previous.high;
    const r2 = p + range;
    const s2 = p - range;
    const r3 = p * 2 + (previous.high - 2 * previous.low);
    const s3 = p * 2 - (2 * previous.high - previous.low);
    const r4 = p * 3 + (previous.high - 3 * previous.low);
    const s4 = p * 3 - (3 * previous.high - previous.low);
    const r5 = p * 4 + (previous.high - 4 * previous.low);
    const s5 = p * 4 - (4 * previous.high - previous.low);

    result.push({
      sessionKey: current.key,
      sessionStart: current.start,
      sessionEnd: next?.start ?? null,
      sourceSessionKey: previous.key,
      sourceHigh: previous.high,
      sourceLow: previous.low,
      sourceClose: previous.close,
      p,
      r1,
      r2,
      r3,
      r4,
      r5,
      s1,
      s2,
      s3,
      s4,
      s5
    });
  }

  return result;
}
