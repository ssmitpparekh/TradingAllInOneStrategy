import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Instrument = {
  symbol: string;
  name: string;
  market: string;
  segment: string;
  type: string;
  underlying: string;
  expiry: string | null;
  strike: number | null;
  optionType: string | null;
};

const MASTER_FILES = [
  { market: "NSE", segment: "CASH", url: "https://public.fyers.in/sym_details/NSE_CM.csv" },
  { market: "NSE", segment: "F&O", url: "https://public.fyers.in/sym_details/NSE_FO.csv" },
  { market: "NSE", segment: "CURRENCY", url: "https://public.fyers.in/sym_details/NSE_CD.csv" },
  { market: "NSE", segment: "COMMODITY", url: "https://public.fyers.in/sym_details/NSE_COM.csv" },
  { market: "BSE", segment: "CASH", url: "https://public.fyers.in/sym_details/BSE_CM.csv" },
  { market: "BSE", segment: "F&O", url: "https://public.fyers.in/sym_details/BSE_FO.csv" },
  { market: "MCX", segment: "COMMODITY", url: "https://public.fyers.in/sym_details/MCX_COM.csv" }
] as const;

const CURATED_INDICES: Instrument[] = [
  { symbol: "NSE:NIFTY50-INDEX", name: "NIFTY 50", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "NIFTY50", expiry: null, strike: null, optionType: null },
  { symbol: "NSE:NIFTYBANK-INDEX", name: "NIFTY BANK", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "NIFTYBANK", expiry: null, strike: null, optionType: null },
  { symbol: "NSE:FINNIFTY-INDEX", name: "NIFTY FINANCIAL SERVICES", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "FINNIFTY", expiry: null, strike: null, optionType: null },
  { symbol: "NSE:NIFTYIT-INDEX", name: "NIFTY IT", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "NIFTYIT", expiry: null, strike: null, optionType: null },
  { symbol: "NSE:NIFTYMIDCAP50-INDEX", name: "NIFTY MIDCAP 50", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "NIFTYMIDCAP50", expiry: null, strike: null, optionType: null },
  { symbol: "NSE:INDIAVIX-INDEX", name: "INDIA VIX", market: "NSE", segment: "INDEX", type: "INDEX", underlying: "INDIAVIX", expiry: null, strike: null, optionType: null },
  { symbol: "BSE:SENSEX-INDEX", name: "SENSEX", market: "BSE", segment: "INDEX", type: "INDEX", underlying: "SENSEX", expiry: null, strike: null, optionType: null }
];

const cache = new Map<string, { fetchedAt: number; instruments: Instrument[] }>();
const CACHE_MS = 30 * 60 * 1000;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
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

function classify(symbol: string, segment: string, optionType: string): string {
  if (symbol.endsWith("-INDEX")) return "INDEX";
  if (optionType === "CE" || optionType === "PE") return "OPTION";
  if (symbol.endsWith("FUT")) return "FUTURE";
  if (segment === "COMMODITY") return "COMMODITY";
  if (segment === "CURRENCY") return "CURRENCY";
  return "EQUITY";
}

function normalizeExpiry(raw: string): string | null {
  if (!raw || raw === "0" || raw.toLowerCase() === "none") return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toISOString().slice(0, 10);
  }
  return raw;
}

async function loadMaster(entry: (typeof MASTER_FILES)[number]): Promise<Instrument[]> {
  const cached = cache.get(entry.url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.instruments;

  const response = await fetch(entry.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to download ${entry.market} ${entry.segment} symbol master.`);
  }

  const text = await response.text();
  const instruments = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((row) => row.length >= 18 && row[9])
    .map((row): Instrument => {
      const symbol = row[9].trim();
      const optionType = row[16]?.trim() || "XX";
      const strikeRaw = Number(row[15]);

      return {
        symbol,
        name: row[1]?.trim() || symbol,
        market: entry.market,
        segment: entry.segment,
        type: classify(symbol, entry.segment, optionType),
        underlying: row[13]?.trim() || "",
        expiry: normalizeExpiry(row[8]?.trim() || ""),
        strike: Number.isFinite(strikeRaw) && strikeRaw >= 0 ? strikeRaw : null,
        optionType: optionType === "CE" || optionType === "PE" ? optionType : null
      };
    });

  cache.set(entry.url, { fetchedAt: Date.now(), instruments });
  return instruments;
}

function scoreInstrument(instrument: Instrument, query: string): number {
  const q = query.toUpperCase();
  const symbol = instrument.symbol.toUpperCase();
  const name = instrument.name.toUpperCase();
  const underlying = instrument.underlying.toUpperCase();

  if (symbol === q || underlying === q) return 1000;
  if (symbol.startsWith(q) || underlying.startsWith(q)) return 800;
  if (name.startsWith(q)) return 700;
  if (symbol.includes(q)) return 600;
  if (underlying.includes(q)) return 550;
  if (name.includes(q)) return 500;
  return 0;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const market = request.nextUrl.searchParams.get("market")?.trim().toUpperCase() || "ALL";
  const type = request.nextUrl.searchParams.get("type")?.trim().toUpperCase() || "ALL";

  if (q.length < 1) {
    return NextResponse.json({ ok: true, instruments: CURATED_INDICES });
  }

  try {
    const files = MASTER_FILES.filter((entry) => market === "ALL" || entry.market === market);
    const loaded = await Promise.all(files.map(loadMaster));
    const pool = [...CURATED_INDICES, ...loaded.flat()];

    const instruments = pool
      .filter((item) => market === "ALL" || item.market === market)
      .filter((item) => type === "ALL" || item.type === type || item.segment === type)
      .map((item) => ({ item, score: scoreInstrument(item, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol))
      .slice(0, 80)
      .map(({ item }) => item);

    return NextResponse.json({ ok: true, query: q, instruments });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to search instruments." },
      { status: 502 }
    );
  }
}
