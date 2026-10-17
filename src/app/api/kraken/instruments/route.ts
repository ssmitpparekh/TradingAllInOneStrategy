import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KrakenInstrument = {
  symbol: string;
  name: string;
  market: "KRAKEN";
  segment: "SPOT";
  type: "CRYPTO";
  underlying: string;
  expiry: null;
  strike: null;
  optionType: null;
};

let cache: { fetchedAt: number; instruments: KrakenInstrument[] } | null = null;
const CACHE_MS = 30 * 60 * 1000;

async function loadPairs(): Promise<KrakenInstrument[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return cache.instruments;
  }

  const response = await fetch("https://api.kraken.com/0/public/AssetPairs", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  const body = await response.json();

  if (!response.ok || !body?.result) {
    throw new Error("Unable to download Kraken spot instruments.");
  }

  const instruments: KrakenInstrument[] = Object.values(
    body.result as Record<string, Record<string, unknown>>
  )
    .map((pair): KrakenInstrument | null => {
      const wsname = typeof pair.wsname === "string" ? pair.wsname : "";
      if (!wsname || !wsname.includes("/")) return null;

      const [base, quote] = wsname.split("/");
      return {
        symbol: wsname,
        name: `${base} / ${quote}`,
        market: "KRAKEN",
        segment: "SPOT",
        type: "CRYPTO",
        underlying: base,
        expiry: null,
        strike: null,
        optionType: null
      };
    })
    .filter((item): item is KrakenInstrument => Boolean(item));

  const deduped = [...new Map(instruments.map((item) => [item.symbol, item])).values()]
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  cache = { fetchedAt: Date.now(), instruments: deduped };
  return deduped;
}

function score(item: KrakenInstrument, query: string) {
  const q = query.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const symbol = item.symbol.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const name = item.name.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const underlying = item.underlying.toUpperCase();

  if (symbol === q) return 1000;
  if (underlying === q) return 950;
  if (symbol.startsWith(q)) return 850;
  if (underlying.startsWith(q)) return 800;
  if (name.includes(q) || symbol.includes(q)) return 600;
  return 0;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  try {
    const instruments = await loadPairs();

    const results = (q
      ? instruments
          .map((item) => ({ item, score: score(item, q) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol))
          .slice(0, 80)
          .map(({ item }) => item)
      : instruments.filter((item) =>
          ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"].includes(item.symbol)
        )
    );

    return NextResponse.json({ ok: true, instruments: results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to search Kraken instruments."
      },
      { status: 502 }
    );
  }
}
