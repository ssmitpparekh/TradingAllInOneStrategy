import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScannerInstrument = {
  symbol: string;
  name: string;
  market: "NSE" | "BSE" | "MCX" | "KRAKEN";
  type: "INDEX" | "EQUITY" | "FUTURE" | "CRYPTO";
  underlying: string;
  lotSize: number | null;
};

const FYERS_STATIC: ScannerInstrument[] = [
  {
    symbol: "NSE:NIFTY50-INDEX",
    name: "NIFTY 50",
    market: "NSE",
    type: "INDEX",
    underlying: "NIFTY50",
    lotSize: null
  },
  {
    symbol: "NSE:NIFTYBANK-INDEX",
    name: "NIFTY BANK",
    market: "NSE",
    type: "INDEX",
    underlying: "NIFTYBANK",
    lotSize: null
  },
  {
    symbol: "NSE:FINNIFTY-INDEX",
    name: "FINNIFTY",
    market: "NSE",
    type: "INDEX",
    underlying: "FINNIFTY",
    lotSize: null
  },
  {
    symbol: "NSE:NIFTYIT-INDEX",
    name: "NIFTY IT",
    market: "NSE",
    type: "INDEX",
    underlying: "NIFTYIT",
    lotSize: null
  },
  {
    symbol: "NSE:NIFTYMIDCAP50-INDEX",
    name: "NIFTY MIDCAP 50",
    market: "NSE",
    type: "INDEX",
    underlying: "NIFTYMIDCAP50",
    lotSize: null
  },
  {
    symbol: "BSE:SENSEX-INDEX",
    name: "SENSEX",
    market: "BSE",
    type: "INDEX",
    underlying: "SENSEX",
    lotSize: null
  },

  ...[
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "INFY",
    "TCS",
    "SBIN",
    "BHARTIARTL",
    "LT",
    "ITC",
    "AXISBANK",
    "KOTAKBANK",
    "HINDUNILVR",
    "MARUTI",
    "M&M",
    "BAJFINANCE",
    "BAJAJFINSV",
    "SUNPHARMA",
    "TATAMOTORS",
    "TATASTEEL",
    "JSWSTEEL",
    "HCLTECH",
    "TECHM",
    "WIPRO",
    "ULTRACEMCO",
    "NTPC",
    "POWERGRID",
    "COALINDIA",
    "ONGC",
    "ADANIENT",
    "ADANIPORTS",
    "GRASIM",
    "DRREDDY",
    "CIPLA",
    "APOLLOHOSP",
    "ASIANPAINT",
    "TITAN",
    "TRENT",
    "EICHERMOT",
    "HEROMOTOCO",
    "BPCL",
    "BRITANNIA",
    "BEL",
    "JIOFIN",
    "SHRIRAMFIN",
    "ETERNAL",
    "INDUSINDBK",
    "HDFCLIFE",
    "SBILIFE",
    "DIVISLAB",
    "NESTLEIND",
    "HINDALCO",
    "TATACONSUM",
    "BAJAJ-AUTO"
  ].map(
    (ticker): ScannerInstrument => ({
      symbol: `NSE:${ticker}-EQ`,
      name: ticker,
      market: "NSE",
      type: "EQUITY",
      underlying: ticker,
      lotSize: null
    })
  )
];

const KRAKEN: ScannerInstrument[] = [
  {
    symbol: "BTC/USD",
    name: "BTC / USD",
    market: "KRAKEN",
    type: "CRYPTO",
    underlying: "BTC",
    lotSize: null
  },
  {
    symbol: "ETH/USD",
    name: "ETH / USD",
    market: "KRAKEN",
    type: "CRYPTO",
    underlying: "ETH",
    lotSize: null
  },
  {
    symbol: "SOL/USD",
    name: "SOL / USD",
    market: "KRAKEN",
    type: "CRYPTO",
    underlying: "SOL",
    lotSize: null
  }
];

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

function expiryEpoch(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

async function loadMcxNearestFutures(): Promise<ScannerInstrument[]> {
  const response = await fetch(
    "https://public.fyers.in/sym_details/MCX_COM.csv",
    { cache: "no-store" }
  );

  if (!response.ok) return [];

  const desired = new Map([
    ["GOLD", "MCX GOLD"],
    ["SILVER", "MCX SILVER"],
    ["CRUDEOIL", "MCX CRUDE OIL"],
    ["NATURALGAS", "MCX NATURAL GAS"],
    ["COPPER", "MCX COPPER"]
  ]);
  const now = Math.floor(Date.now() / 1000);

  const rows = (await response.text())
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((row) => row.length >= 18 && row[9]);

  const grouped = new Map<
    string,
    Array<{
      symbol: string;
      expiry: number;
      lotSize: number | null;
    }>
  >();

  for (const row of rows) {
    const underlying = (row[13] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!desired.has(underlying)) continue;

    const optionType = (row[16] ?? "").toUpperCase();
    if (optionType === "CE" || optionType === "PE") continue;

    const expiry = expiryEpoch(row[8] ?? "");
    if (!(expiry >= now - 24 * 60 * 60)) continue;

    const list = grouped.get(underlying) ?? [];
    list.push({
      symbol: row[9].trim(),
      expiry,
      lotSize:
        Number(row[3]) > 0 && Number.isFinite(Number(row[3]))
          ? Number(row[3])
          : null
    });
    grouped.set(underlying, list);
  }

  return [...desired.entries()].flatMap(([underlying, name]) => {
    const next = (grouped.get(underlying) ?? []).sort(
      (a, b) => a.expiry - b.expiry
    )[0];

    return next
      ? [
          {
            symbol: next.symbol,
            name,
            market: "MCX" as const,
            type: "FUTURE" as const,
            underlying,
            lotSize: next.lotSize
          }
        ]
      : [];
  });
}

export async function GET() {
  const mcx = await loadMcxNearestFutures();

  const fyers = [...FYERS_STATIC, ...mcx].slice(0, 90);

  return NextResponse.json({
    ok: true,
    fyers,
    kraken: KRAKEN,
    coverage: {
      fyersSymbols: fyers.length,
      reservedFyersSlots: Math.max(0, 100 - fyers.length),
      standardSocketLimit: 100,
      primeSocketLimit: 5000
    }
  });
}
