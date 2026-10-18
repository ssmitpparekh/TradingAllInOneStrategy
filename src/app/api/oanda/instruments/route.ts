import { NextRequest, NextResponse } from "next/server";
import {
  getOandaInstruments,
  type OandaInstrument
} from "@/lib/oanda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstrumentResult = {
  symbol: string;
  name: string;
  market: "OANDA";
  segment: string;
  type: string;
  underlying: string;
  expiry: null;
  strike: null;
  optionType: null;
};

let cache:
  | { fetchedAt: number; instruments: InstrumentResult[] }
  | null = null;
const CACHE_MS = 30 * 60 * 1000;

function normalize(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function classify(item: OandaInstrument) {
  const haystack = normalize(item.name + " " + item.displayName);

  if (
    /BTC|BITCOIN|ETH|ETHEREUM|LTC|CRYPTO/.test(haystack)
  ) {
    return "CRYPTO";
  }

  if (
    item.type === "METAL" ||
    /XAU|GOLD|XAG|SILVER|XPT|PLATINUM|XPD|PALLADIUM/.test(
      haystack
    )
  ) {
    return "COMMODITY";
  }

  if (
    /WTI|BRENT|OIL|CRUDE|NATURAL GAS|NATGAS|CORN|WHEAT|SOY|SUGAR|COCOA|COFFEE|COPPER/.test(
      haystack
    )
  ) {
    return "COMMODITY";
  }

  if (
    /INDEX|SPX|S&P|NAS|NASDAQ|US30|DOW|DE30|GER|UK100|JP225|HK33|AU200|EU50|CH20|FR40|NL25|SG30/.test(
      haystack
    )
  ) {
    return "INDEX";
  }

  if (item.type === "CURRENCY") return "CURRENCY";
  if (/BOND|TREASURY|BUND|GILT/.test(haystack)) return "BOND";
  return "CFD";
}

function aliases(item: InstrumentResult) {
  const base = [
    item.symbol,
    item.name,
    item.underlying
  ];

  const symbol = item.symbol.toUpperCase();

  if (symbol.includes("XAU")) {
    base.push("GOLD", "XAUUSD", "GOLD USD");
  }
  if (symbol.includes("XAG")) {
    base.push("SILVER", "XAGUSD", "SILVER USD");
  }
  if (/WTI|WESTTEXAS|OIL/.test(symbol)) {
    base.push("OIL", "CRUDE", "CRUDE OIL", "WTI");
  }
  if (/BRENT/.test(symbol)) {
    base.push("BRENT", "BRENT OIL", "OIL");
  }
  if (/NAS|NASDAQ/.test(symbol + " " + item.name.toUpperCase())) {
    base.push("NASDAQ", "NASDAQ 100", "US TECH 100");
  }
  if (/SPX|SP500|S&P/.test(symbol + " " + item.name.toUpperCase())) {
    base.push("S&P 500", "SP500", "US 500");
  }

  return base.map(normalize);
}

function score(item: InstrumentResult, query: string) {
  const q = normalize(query);
  const variants = aliases(item);

  if (variants.some((value) => value === q)) return 10000;
  if (variants.some((value) => value.startsWith(q))) return 8500;
  if (variants.some((value) => value.includes(q))) return 6500;

  const terms = q.split(/\s+/).filter(Boolean);
  if (
    terms.length &&
    terms.every((term) =>
      variants.some((value) => value.includes(term))
    )
  ) {
    return 5000;
  }

  return 0;
}

async function load() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return cache.instruments;
  }

  const upstream = await getOandaInstruments();
  const instruments = upstream
    .map((item): InstrumentResult => ({
      symbol: item.name,
      name: item.displayName,
      market: "OANDA",
      segment: item.type,
      type: classify(item),
      underlying: item.name.split("_")[0] ?? item.name,
      expiry: null,
      strike: null,
      optionType: null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache = { fetchedAt: Date.now(), instruments };
  return instruments;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const type =
    request.nextUrl.searchParams.get("type")?.trim().toUpperCase() ||
    "ALL";

  try {
    const instruments = await load();
    const filtered = instruments
      .filter((item) => type === "ALL" || item.type === type)
      .map((item) => ({ item, score: q ? score(item, q) : 1 }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.item.name.localeCompare(b.item.name)
      )
      .slice(0, 100)
      .map(({ item }) => item);

    return NextResponse.json({
      ok: true,
      instruments: filtered
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to search OANDA instruments."
      },
      { status: 502 }
    );
  }
}
