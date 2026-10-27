import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getExpiredFnoContracts,
  getExpiredFnoExpiryDates,
  getExpiredFnoHistory,
  getHistory,
  getQuote,
  type FyersCandle
} from "../src/lib/fyers";
import { readFyersSession } from "../src/lib/fyers-session";

const IST_OFFSET_MINUTES = 330;
const NIFTY = "NSE:NIFTY50-INDEX";
const CACHE_DIR = path.join(
  process.cwd(),
  ".data",
  "nifty-options-backtest",
  "cache"
);
const OUTPUT_DIR = path.join(
  process.cwd(),
  ".data",
  "nifty-options-backtest"
);

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;

  const text = readFileSync(file, "utf8");
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

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

type OptionSide = "CE" | "PE";

type OptionContract = {
  strike: number;
  side: OptionSide;
  symbol: string;
};

type DayRow = {
  date: string;
  expiry: string;
  spot915: number | null;
  atmStrike: number | null;
  atmCall915: number | null;
  atmPut915: number | null;
  atmTotal: number | null;
  rawUpper: number | null;
  rawLower: number | null;
  tradeCallStrike: number | null;
  tradePutStrike: number | null;
  tradeCall915: number | null;
  tradePut915: number | null;
  triggeredSide: OptionSide | "BOTH" | "NONE" | "PENDING";
  triggeredStrike: number | null;
  triggerTime: string;
  entry: number | null;
  tp: number | null;
  sl: number | null;
  reached100: "YES" | "NO" | "";
  exitTime: string;
  outcome:
    | "TP"
    | "SL"
    | "AMBIGUOUS"
    | "NO_BREAK"
    | "EOD_OPEN"
    | "BOTH_TRIGGERED_SAME_MINUTE"
    | "DATA_MISSING"
    | "PENDING_DATA"
    | "PENDING_EXPIRY_NOT_EXPIRED";
  worked: "YES" | "NO" | "AMBIGUOUS" | "UNRESOLVED" | "NO_TRADE" | "PENDING";
  notes: string;
};

function arg(name: string) {
  const prefix = "--" + name + "=";
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function isoTodayIndia() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function addMonths(value: string, months: number) {
  const date = parseIsoDate(value);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(originalDay, last));
  return isoDate(date);
}

function mondayIndex(value: string) {
  const day = parseIsoDate(value).getUTCDay();
  return (day + 6) % 7;
}

function weekTuesday(value: string) {
  return addDays(value, 1 - mondayIndex(value));
}

function epochIst(
  value: string,
  hour: number,
  minute: number,
  second = 0
) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(
    (Date.UTC(year, month - 1, day, hour, minute, second) -
      IST_OFFSET_MINUTES * 60_000) /
      1000
  );
}

function istParts(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(epoch * 1000));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: get("year") + "-" + get("month") + "-" + get("day"),
    time: get("hour") + ":" + get("minute")
  };
}

function timeLabel(epoch: number | null) {
  if (epoch === null) return "";
  const value = istParts(epoch);
  return value.time;
}

function nearestStrike(
  strikes: number[],
  value: number,
  side?: OptionSide
) {
  return [...strikes].sort((a, b) => {
    const da = Math.abs(a - value);
    const db = Math.abs(b - value);
    if (da !== db) return da - db;

    // Exact tie: keep the selected option farther OTM.
    if (side === "CE") return b - a;
    if (side === "PE") return a - b;
    return a - b;
  })[0] ?? null;
}

function expiryCodes(expiry: string) {
  const date = parseIsoDate(expiry);
  const yy = String(date.getUTCFullYear()).slice(-2);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const month = date.getUTCMonth() + 1;
  const monthly = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC"
  ][month - 1];
  const weeklyMonth =
    month <= 9
      ? String(month)
      : month === 10
        ? "O"
        : month === 11
          ? "N"
          : "D";

  return {
    monthly: yy + monthly,
    weekly: yy + weeklyMonth + dd
  };
}

function parseOptionContract(
  symbol: string,
  expiry: string
): OptionContract | null {
  if (!symbol.startsWith("NSE:NIFTY")) return null;
  const side = symbol.endsWith("CE")
    ? "CE"
    : symbol.endsWith("PE")
      ? "PE"
      : null;
  if (!side) return null;

  const body = symbol.slice("NSE:NIFTY".length, -2);
  const codes = expiryCodes(expiry);
  const prefix = body.startsWith(codes.monthly)
    ? codes.monthly
    : body.startsWith(codes.weekly)
      ? codes.weekly
      : null;
  if (!prefix) return null;

  const strike = Number(body.slice(prefix.length));
  if (!Number.isFinite(strike) || strike <= 0) return null;

  return { strike, side, symbol };
}

function contractBook(symbols: string[], expiry: string) {
  const contracts = symbols
    .map((symbol) => parseOptionContract(symbol, expiry))
    .filter((item): item is OptionContract => item !== null);

  const book = new Map<
    number,
    { CE?: string; PE?: string }
  >();

  for (const contract of contracts) {
    const value = book.get(contract.strike) ?? {};
    value[contract.side] = contract.symbol;
    book.set(contract.strike, value);
  }

  return book;
}

function candleAt915(rows: FyersCandle[], date: string) {
  const epoch = epochIst(date, 9, 15);
  return rows.find((row) => row.time === epoch) ?? null;
}

function dayCandles(rows: FyersCandle[], date: string) {
  const from = epochIst(date, 9, 15);
  const to = epochIst(date, 15, 30);
  return rows
    .filter((row) => row.time >= from && row.time <= to)
    .sort((a, b) => a.time - b.time);
}

function firstBreak(rows: FyersCandle[], date: string) {
  const session = dayCandles(rows, date);
  const first = session[0];
  if (!first || first.time !== epochIst(date, 9, 15)) return null;

  let previous = first.open;

  for (let index = 0; index < session.length; index += 1) {
    const candle = session[index];
    if (previous <= 50 && candle.close > 50) {
      return {
        candle,
        index,
        session
      };
    }
    previous = candle.close;
  }

  return null;
}

function evaluateTrade(
  rows: FyersCandle[],
  date: string,
  triggerTime: number,
  entry: number
) {
  const session = dayCandles(rows, date);
  const triggerIndex = session.findIndex(
    (row) => row.time === triggerTime
  );
  const tp = entry + 50;
  const sl = entry - 25;
  let reached100 = entry >= 100;

  if (triggerIndex < 0) {
    return {
      tp,
      sl,
      reached100,
      outcome: "DATA_MISSING" as const,
      exitTime: null as number | null
    };
  }

  for (let index = triggerIndex + 1; index < session.length; index += 1) {
    const candle = session[index];
    if (candle.high >= 100) reached100 = true;

    const hitTp = candle.high >= tp;
    const hitSl = candle.low <= sl;

    if (hitTp && hitSl) {
      return {
        tp,
        sl,
        reached100,
        outcome: "AMBIGUOUS" as const,
        exitTime: candle.time
      };
    }
    if (hitTp) {
      return {
        tp,
        sl,
        reached100,
        outcome: "TP" as const,
        exitTime: candle.time
      };
    }
    if (hitSl) {
      return {
        tp,
        sl,
        reached100,
        outcome: "SL" as const,
        exitTime: candle.time
      };
    }
  }

  return {
    tp,
    sl,
    reached100,
    outcome: "EOD_OPEN" as const,
    exitTime: null as number | null
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text)
    ? '"' + text.replaceAll('"', '""') + '"'
    : text;
}

function toCsv(rows: DayRow[]) {
  const columns: Array<keyof DayRow> = [
    "date",
    "expiry",
    "spot915",
    "atmStrike",
    "atmCall915",
    "atmPut915",
    "atmTotal",
    "rawUpper",
    "rawLower",
    "tradeCallStrike",
    "tradePutStrike",
    "tradeCall915",
    "tradePut915",
    "triggeredSide",
    "triggeredStrike",
    "triggerTime",
    "entry",
    "tp",
    "sl",
    "reached100",
    "exitTime",
    "outcome",
    "worked",
    "notes"
  ];

  return [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(",")
    )
  ].join("\n");
}

function compactNumber(value: number | null) {
  return value === null ? "" : value.toFixed(2);
}

function toMarkdown(rows: DayRow[]) {
  const header =
    "| Date | Expiry | Spot 09:15 | ATM | ATM CE | ATM PE | Total | Raw + | Raw - | Trade CE | CE 09:15 | Trade PE | PE 09:15 | Trigger | Time | Entry | TP | SL | Hit 100 | Outcome | Worked |";
  const separator =
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---|---|---|";

  return [
    header,
    separator,
    ...rows.map((row) =>
      [
        row.date,
        row.expiry,
        compactNumber(row.spot915),
        row.atmStrike ?? "",
        compactNumber(row.atmCall915),
        compactNumber(row.atmPut915),
        compactNumber(row.atmTotal),
        compactNumber(row.rawUpper),
        compactNumber(row.rawLower),
        row.tradeCallStrike ?? "",
        compactNumber(row.tradeCall915),
        row.tradePutStrike ?? "",
        compactNumber(row.tradePut915),
        row.triggeredSide,
        row.triggerTime,
        compactNumber(row.entry),
        compactNumber(row.tp),
        compactNumber(row.sl),
        row.reached100,
        row.outcome,
        row.worked
      ].join(" | ")
    ).map((line) => "| " + line + " |")
  ].join("\n");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function main() {
  loadLocalEnv();

  const session = await readFyersSession();
  if (!session?.accessToken) {
    throw new Error(
      "FYERS is not connected. Connect FYERS in the app first so .data/fyers-session.json exists."
    );
  }
  const accessToken: string = session.accessToken;

  try {
    await getQuote(accessToken, NIFTY);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (
      /authenticate|expired|invalid access token|invalid token|unauthorized/i.test(
        message
      )
    ) {
      throw new Error(
        "FYERS session is expired or invalid. FYERS requires a fresh daily authentication. " +
          "Start the local app with 'npm run dev', open http://127.0.0.1:8080, click Connect FYERS, complete FYERS login/2FA, then rerun 'npm run backtest:nifty-options'. " +
          "Do not paste any access token or secret into CMD."
      );
    }

    throw error;
  }

  process.stdout.write("FYERS session verified for this run.\n");

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const to = arg("to") ?? isoTodayIndia();
  const from = arg("from") ?? addMonths(to, -6);
  const maxExpiredRequests = Math.max(
    0,
    Number(arg("max-expired-requests") ?? "10")
  );

  process.stdout.write(
    [
      "NIFTY OPTIONS REAL-DATA BACKTEST",
      "Range: " + from + " to " + to,
      "09:15 source: 1-minute candle OPEN",
      "Trigger: first CE/PE 1-minute CLOSE crossing <=50 to >50",
      "TP: +50 points | SL: -25 points",
      "Expiry: first actual NIFTY option expiry after the Tuesday of each calendar week",
      "Expired F&O request budget this run: " + maxExpiredRequests,
      ""
    ].join("\n")
  );

  const spotCache = path.join(
    CACHE_DIR,
    "nifty-spot-" + from + "-" + to + "-1m.json"
  );
  let spot = await readJson<FyersCandle[]>(spotCache);

  if (!spot) {
    spot = [];
    let cursor = from;
    while (cursor <= to) {
      const chunkTo = [
        addDays(cursor, 89),
        to
      ].sort()[0];

      process.stdout.write(
        "Fetching NIFTY spot " + cursor + " -> " + chunkTo + "\n"
      );
      const rows = await getHistory(accessToken, {
        symbol: NIFTY,
        resolution: "1",
        from: epochIst(cursor, 0, 0),
        to: epochIst(chunkTo, 23, 59)
      });
      spot.push(...rows);
      cursor = addDays(chunkTo, 1);
    }

    const byTime = new Map(
      spot.map((row) => [row.time, row] as const)
    );
    spot = [...byTime.values()].sort((a, b) => a.time - b.time);
    await writeJson(spotCache, spot);
  }

  const tradingDates = [
    ...new Set(
      spot
        .filter((row) => istParts(row.time).time === "09:15")
        .map((row) => istParts(row.time).date)
        .filter((date) => date >= from && date <= to)
    )
  ].sort();

  const expiryCache = path.join(
    CACHE_DIR,
    "nifty-expiries-" + from + "-" + to + ".json"
  );
  let expiries = await readJson<string[]>(expiryCache);
  if (!expiries) {
    expiries = await getExpiredFnoExpiryDates(accessToken, {
      symbol: NIFTY,
      from: addDays(from, -14),
      to: addDays(to, 14)
    });
    expiries = [...new Set(expiries)].sort();
    await writeJson(expiryCache, expiries);
  }

  const contractsCache = new Map<string, string[]>();
  const historyMemory = new Map<string, FyersCandle[]>();
  let expiredRequests = 0;
  let providerBudgetHit = false;

  async function contractsFor(expiry: string) {
    if (contractsCache.has(expiry)) {
      return contractsCache.get(expiry)!;
    }
    const file = path.join(CACHE_DIR, "contracts-" + expiry + ".json");
    let values = await readJson<string[]>(file);
    if (!values) {
      values = await getExpiredFnoContracts(accessToken, {
        symbol: NIFTY,
        expiryDate: expiry
      });
      await writeJson(file, values);
    }
    contractsCache.set(expiry, values);
    return values;
  }

  async function optionHistory(
    symbol: string,
    expiry: string
  ): Promise<FyersCandle[] | null> {
    if (historyMemory.has(symbol)) {
      return historyMemory.get(symbol)!;
    }

    const safe = symbol.replaceAll(":", "_").replaceAll("/", "_");
    const file = path.join(CACHE_DIR, "option-" + safe + "-1m.json");
    let rows = await readJson<FyersCandle[]>(file);

    if (!rows) {
      if (providerBudgetHit || expiredRequests >= maxExpiredRequests) {
        return null;
      }

      expiredRequests += 1;
      process.stdout.write(
        "Expired F&O request " +
          expiredRequests +
          "/" +
          maxExpiredRequests +
          ": " +
          symbol +
          "\n"
      );

      try {
        rows = await getExpiredFnoHistory(accessToken, {
          symbol,
          resolution: "1",
          from: addDays(expiry, -14),
          to: expiry
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (
          /rate|limit|too many|quota|requests per day/i.test(message)
        ) {
          providerBudgetHit = true;
          process.stderr.write(
            "FYERS expired-F&O intraday limit reached. Cached progress is safe; rerun later to continue.\n"
          );
          return null;
        }
        throw error;
      }

      await writeJson(file, rows);
    }

    historyMemory.set(symbol, rows);
    return rows;
  }

  const spotBy915 = new Map<string, FyersCandle>();
  for (const row of spot) {
    const value = istParts(row.time);
    if (value.time === "09:15") {
      spotBy915.set(value.date, row);
    }
  }

  const rows: DayRow[] = [];

  for (const date of tradingDates) {
    const base: DayRow = {
      date,
      expiry: "",
      spot915: null,
      atmStrike: null,
      atmCall915: null,
      atmPut915: null,
      atmTotal: null,
      rawUpper: null,
      rawLower: null,
      tradeCallStrike: null,
      tradePutStrike: null,
      tradeCall915: null,
      tradePut915: null,
      triggeredSide: "PENDING",
      triggeredStrike: null,
      triggerTime: "",
      entry: null,
      tp: null,
      sl: null,
      reached100: "",
      exitTime: "",
      outcome: "PENDING_DATA",
      worked: "PENDING",
      notes: ""
    };

    const spot915 = spotBy915.get(date);
    if (!spot915) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Missing NIFTY 09:15 spot candle."
      });
      continue;
    }

    base.spot915 = spot915.open;

    const tuesday = weekTuesday(date);
    const expiry = expiries.find(
      (value) => value > tuesday
    );

    if (!expiry) {
      rows.push({
        ...base,
        outcome: "PENDING_EXPIRY_NOT_EXPIRED",
        worked: "PENDING",
        notes:
          "Selected next-week expiry is not available in FYERS expired-contract data yet."
      });
      continue;
    }
    base.expiry = expiry;

    const symbols = await contractsFor(expiry);
    const book = contractBook(symbols, expiry);
    const pairedStrikes = [...book.entries()]
      .filter(([, value]) => value.CE && value.PE)
      .map(([strike]) => strike)
      .sort((a, b) => a - b);

    if (!pairedStrikes.length) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "No paired CE/PE strikes returned for expiry."
      });
      continue;
    }

    const atmStrike = nearestStrike(
      pairedStrikes,
      spot915.open
    );
    if (atmStrike === null) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Unable to determine ATM strike."
      });
      continue;
    }

    base.atmStrike = atmStrike;
    const atmPair = book.get(atmStrike)!;
    const atmCeHistory = await optionHistory(atmPair.CE!, expiry);
    const atmPeHistory = await optionHistory(atmPair.PE!, expiry);

    if (!atmCeHistory || !atmPeHistory) {
      rows.push({
        ...base,
        notes:
          "ATM option history not cached yet. Rerun to continue exact-data collection."
      });
      continue;
    }

    const atmCe915 = candleAt915(atmCeHistory, date);
    const atmPe915 = candleAt915(atmPeHistory, date);

    if (!atmCe915 || !atmPe915) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Missing ATM CE/PE 09:15 candle."
      });
      continue;
    }

    base.atmCall915 = atmCe915.open;
    base.atmPut915 = atmPe915.open;
    base.atmTotal = atmCe915.open + atmPe915.open;
    base.rawUpper = spot915.open + base.atmTotal;
    base.rawLower = spot915.open - base.atmTotal;

    const callStrike = nearestStrike(
      pairedStrikes,
      base.rawUpper,
      "CE"
    );
    const putStrike = nearestStrike(
      pairedStrikes,
      base.rawLower,
      "PE"
    );

    if (callStrike === null || putStrike === null) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Unable to determine trade CE/PE strikes."
      });
      continue;
    }

    base.tradeCallStrike = callStrike;
    base.tradePutStrike = putStrike;

    const callSymbol = book.get(callStrike)?.CE;
    const putSymbol = book.get(putStrike)?.PE;

    if (!callSymbol || !putSymbol) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Selected trade strike contract is missing."
      });
      continue;
    }

    const callHistory = await optionHistory(callSymbol, expiry);
    const putHistory = await optionHistory(putSymbol, expiry);

    if (!callHistory || !putHistory) {
      rows.push({
        ...base,
        notes:
          "Trade option history not cached yet. Rerun to continue exact-data collection."
      });
      continue;
    }

    const call915 = candleAt915(callHistory, date);
    const put915 = candleAt915(putHistory, date);
    base.tradeCall915 = call915?.open ?? null;
    base.tradePut915 = put915?.open ?? null;

    if (!call915 || !put915) {
      rows.push({
        ...base,
        outcome: "DATA_MISSING",
        worked: "UNRESOLVED",
        notes: "Missing selected CE/PE 09:15 candle."
      });
      continue;
    }

    const callBreak = firstBreak(callHistory, date);
    const putBreak = firstBreak(putHistory, date);

    if (!callBreak && !putBreak) {
      rows.push({
        ...base,
        triggeredSide: "NONE",
        outcome: "NO_BREAK",
        worked: "NO_TRADE",
        notes: "Neither selected option closed across ₹50."
      });
      continue;
    }

    if (
      callBreak &&
      putBreak &&
      callBreak.candle.time === putBreak.candle.time
    ) {
      rows.push({
        ...base,
        triggeredSide: "BOTH",
        triggerTime: timeLabel(callBreak.candle.time),
        outcome: "BOTH_TRIGGERED_SAME_MINUTE",
        worked: "AMBIGUOUS",
        notes:
          "CE and PE both crossed ₹50 on the same 1-minute close; no arbitrary side selection."
      });
      continue;
    }

    const chooseCall =
      callBreak !== null &&
      (putBreak === null ||
        callBreak.candle.time < putBreak.candle.time);

    const chosen = chooseCall ? callBreak! : putBreak!;
    const chosenSide: OptionSide = chooseCall ? "CE" : "PE";
    const chosenStrike = chooseCall ? callStrike : putStrike;
    const chosenHistory = chooseCall ? callHistory : putHistory;

    base.triggeredSide = chosenSide;
    base.triggeredStrike = chosenStrike;
    base.triggerTime = timeLabel(chosen.candle.time);
    base.entry = chosen.candle.close;

    const result = evaluateTrade(
      chosenHistory,
      date,
      chosen.candle.time,
      chosen.candle.close
    );

    base.tp = result.tp;
    base.sl = result.sl;
    base.reached100 = result.reached100 ? "YES" : "NO";
    base.exitTime = timeLabel(result.exitTime);
    base.outcome = result.outcome;
    base.worked =
      result.outcome === "TP"
        ? "YES"
        : result.outcome === "SL"
          ? "NO"
          : result.outcome === "AMBIGUOUS"
            ? "AMBIGUOUS"
            : "UNRESOLVED";

    if (result.outcome === "AMBIGUOUS") {
      base.notes =
        "TP and SL were both inside the same post-entry 1-minute candle; tick order is unknown.";
    } else if (result.outcome === "EOD_OPEN") {
      base.notes =
        "Neither +50 TP nor -25 SL was reached before session end; no invented EOD exit.";
    }

    rows.push(base);
  }

  const completed = rows.filter(
    (row) => row.outcome === "TP" || row.outcome === "SL"
  );
  const wins = completed.filter((row) => row.outcome === "TP").length;
  const losses = completed.filter((row) => row.outcome === "SL").length;
  const ambiguous = rows.filter(
    (row) =>
      row.outcome === "AMBIGUOUS" ||
      row.outcome === "BOTH_TRIGGERED_SAME_MINUTE"
  ).length;
  const pending = rows.filter(
    (row) =>
      row.outcome === "PENDING_DATA" ||
      row.outcome === "PENDING_EXPIRY_NOT_EXPIRED"
  ).length;

  const csvPath = path.join(
    OUTPUT_DIR,
    "nifty-options-" + from + "-to-" + to + ".csv"
  );
  const mdPath = path.join(
    OUTPUT_DIR,
    "nifty-options-" + from + "-to-" + to + ".md"
  );

  await writeFile(csvPath, toCsv(rows), "utf8");
  await writeFile(mdPath, toMarkdown(rows), "utf8");

  process.stdout.write(
    [
      "",
      "BACKTEST OUTPUT",
      "Rows: " + rows.length,
      "Resolved trades: " + completed.length,
      "TP wins: " + wins,
      "SL losses: " + losses,
      "Win rate (resolved only): " +
        (completed.length
          ? ((wins / completed.length) * 100).toFixed(2) + "%"
          : "n/a"),
      "Ambiguous: " + ambiguous,
      "Pending exact data: " + pending,
      "Expired F&O requests used this run: " + expiredRequests,
      "CSV: " + csvPath,
      "Markdown: " + mdPath,
      pending
        ? "Rerun the same command later; cached symbols will not be downloaded again."
        : "Exact-data backtest collection complete."
    ].join("\n") + "\n"
  );
}

void main().catch((error) => {
  process.stderr.write(
    "\nNIFTY options backtest failed: " +
      (error instanceof Error ? error.message : String(error)) +
      "\n"
  );
  process.exitCode = 1;
});
