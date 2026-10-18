import { NextRequest, NextResponse } from "next/server";
import {
  getFuturesChain,
  getMarketDepth,
  getOptionChain,
  type FyersOptionLeg
} from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUnderlying(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveUnderlyingCandidates(options: {
  symbol: string;
  market: string;
  type: string;
  underlying: string;
}) {
  const { symbol, market, type, underlying } = options;
  const normalized = normalizeUnderlying(underlying);

  const known: Record<string, string> = {
    NIFTY: "NSE:NIFTY50-INDEX",
    NIFTY50: "NSE:NIFTY50-INDEX",
    BANKNIFTY: "NSE:NIFTYBANK-INDEX",
    NIFTYBANK: "NSE:NIFTYBANK-INDEX",
    FINNIFTY: "NSE:FINNIFTY-INDEX",
    NIFTYFINANCIALSERVICES: "NSE:FINNIFTY-INDEX",
    MIDCPNIFTY: "NSE:NIFTYMIDSELECT-INDEX",
    NIFTYMIDSELECT: "NSE:NIFTYMIDSELECT-INDEX",
    SENSEX: "BSE:SENSEX-INDEX",
    BANKEX: "BSE:BANKEX-INDEX"
  };

  const candidates: string[] = [];

  if (type === "INDEX" || type === "EQUITY") {
    candidates.push(symbol);
  }

  if (known[normalized]) {
    candidates.push(known[normalized]);
  }

  if (
    underlying &&
    market === "NSE" &&
    !known[normalized]
  ) {
    candidates.push(`NSE:${underlying.toUpperCase()}-EQ`);
  }

  if (market === "MCX") {
    candidates.push(symbol);
  }

  candidates.push(symbol);

  return [...new Set(candidates.filter(Boolean))];
}

function topBy(
  legs: FyersOptionLeg[],
  selector: (leg: FyersOptionLeg) => number,
  count = 3
) {
  return legs
    .slice()
    .sort((a, b) => selector(b) - selector(a))
    .slice(0, count);
}

function findAtmPair(
  legs: FyersOptionLeg[],
  referencePrice: number | null
) {
  if (!legs.length) {
    return {
      strike: null as number | null,
      call: null as FyersOptionLeg | null,
      put: null as FyersOptionLeg | null
    };
  }

  const strikes = [...new Set(legs.map((leg) => leg.strike))]
    .filter((strike) => Number.isFinite(strike))
    .sort((a, b) => a - b);

  if (!strikes.length) {
    return { strike: null, call: null, put: null };
  }

  const target =
    referencePrice && referencePrice > 0
      ? referencePrice
      : strikes[Math.floor(strikes.length / 2)];

  const strike = strikes.reduce((closest, current) =>
    Math.abs(current - target) < Math.abs(closest - target)
      ? current
      : closest
  );

  return {
    strike,
    call:
      legs.find(
        (leg) => leg.strike === strike && leg.optionType === "CE"
      ) ?? null,
    put:
      legs.find(
        (leg) => leg.strike === strike && leg.optionType === "PE"
      ) ?? null
  };
}

export async function GET(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "FYERS is not connected." },
      { status: 401 }
    );
  }

  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "";
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ||
    "NSE";
  const type =
    request.nextUrl.searchParams.get("type")?.trim().toUpperCase() ||
    "";
  const underlying =
    request.nextUrl.searchParams.get("underlying")?.trim() || "";
  const spotPrice = Number(
    request.nextUrl.searchParams.get("spotPrice") ?? 0
  );
  const expiryTimestamp = Number(
    request.nextUrl.searchParams.get("expiry") ?? 0
  );

  if (!symbol) {
    return NextResponse.json(
      { ok: false, error: "A symbol is required." },
      { status: 400 }
    );
  }

  if (market === "KRAKEN") {
    return NextResponse.json({
      ok: true,
      available: false,
      reason:
        "FYERS derivatives confirmation is only available for supported Indian-market underlyings."
    });
  }

  const candidates = resolveUnderlyingCandidates({
    symbol,
    market,
    type,
    underlying
  });

  let resolvedUnderlying: string | null = null;
  let futuresChain:
    | Awaited<ReturnType<typeof getFuturesChain>>
    | null = null;
  let optionChain:
    | Awaited<ReturnType<typeof getOptionChain>>
    | null = null;
  const errors: string[] = [];

  for (const candidate of candidates) {
    const [futuresResult, optionsResult] = await Promise.allSettled([
      getFuturesChain(session.accessToken, candidate),
      getOptionChain(session.accessToken, candidate, {
        strikeCount: 24,
        timestamp:
          Number.isFinite(expiryTimestamp) && expiryTimestamp > 0
            ? expiryTimestamp
            : null,
        greeks: true
      })
    ]);

    const nextFutures =
      futuresResult.status === "fulfilled"
        ? futuresResult.value
        : null;
    const nextOptions =
      optionsResult.status === "fulfilled"
        ? optionsResult.value
        : null;

    if (nextFutures || nextOptions) {
      resolvedUnderlying = candidate;
      futuresChain = nextFutures;
      optionChain = nextOptions;
      break;
    }

    if (futuresResult.status === "rejected") {
      errors.push(
        futuresResult.reason instanceof Error
          ? futuresResult.reason.message
          : String(futuresResult.reason)
      );
    }
    if (optionsResult.status === "rejected") {
      errors.push(
        optionsResult.reason instanceof Error
          ? optionsResult.reason.message
          : String(optionsResult.reason)
      );
    }
  }

  if (!resolvedUnderlying || (!futuresChain && !optionChain)) {
    return NextResponse.json({
      ok: true,
      available: false,
      reason:
        "No currently available FYERS futures/options chain was found for this instrument.",
      diagnostics: errors.slice(-2)
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const futureContracts = (futuresChain ?? [])
    .filter(
      (entry) =>
        entry.expiry !== null &&
        entry.symbol !== resolvedUnderlying
    )
    .sort(
      (a, b) =>
        Number(a.expiry ?? Number.MAX_SAFE_INTEGER) -
        Number(b.expiry ?? Number.MAX_SAFE_INTEGER)
    );

  const nearestFuture =
    futureContracts.find(
      (entry) => Number(entry.expiry ?? 0) >= now - 24 * 60 * 60
    ) ??
    futureContracts[0] ??
    null;

  let depth:
    | Awaited<ReturnType<typeof getMarketDepth>>
    | null = null;

  if (nearestFuture) {
    try {
      depth = await getMarketDepth(
        session.accessToken,
        nearestFuture.symbol
      );
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const callLegs =
    optionChain?.legs.filter((leg) => leg.optionType === "CE") ?? [];
  const putLegs =
    optionChain?.legs.filter((leg) => leg.optionType === "PE") ?? [];

  const referencePrice =
    optionChain?.futuresPrice ??
    (nearestFuture?.lp ? nearestFuture.lp : null) ??
    (spotPrice > 0 ? spotPrice : null);

  const atm = findAtmPair(
    optionChain?.legs ?? [],
    referencePrice
  );

  const callOi = optionChain?.callOi ?? 0;
  const putOi = optionChain?.putOi ?? 0;
  const pcr = callOi > 0 ? putOi / callOi : null;

  const futureOiChange =
    depth && depth.oi > 0
      ? depth.oi - depth.previousOi
      : null;

  const futureBasis =
    nearestFuture && spotPrice > 0
      ? nearestFuture.lp - spotPrice
      : null;

  return NextResponse.json({
    ok: true,
    available: true,
    underlying: resolvedUnderlying,
    future: nearestFuture
      ? {
          symbol: nearestFuture.symbol,
          expiry: nearestFuture.expiry,
          price: nearestFuture.lp,
          change: nearestFuture.ch,
          changePercent: nearestFuture.chp,
          volume: depth?.volume || nearestFuture.volume,
          oi: depth?.oi ?? null,
          previousOi: depth?.previousOi ?? null,
          oiChange: futureOiChange,
          oiChangePercent: depth?.oiPercent ?? null,
          basis: futureBasis,
          basisPercent:
            futureBasis !== null && spotPrice > 0
              ? (futureBasis / spotPrice) * 100
              : null
        }
      : null,
    options: optionChain
      ? {
          callOi,
          putOi,
          pcr,
          indiaVix: optionChain.indiaVix,
          futuresPrice: optionChain.futuresPrice,
          nearestExpiry:
            optionChain.expiryData[0] ?? null,
          expiries: optionChain.expiryData,
          atm,
          callOiWalls: topBy(callLegs, (leg) => leg.oi),
          putOiWalls: topBy(putLegs, (leg) => leg.oi),
          callOiBuild: topBy(
            callLegs.filter((leg) => leg.oiChange > 0),
            (leg) => leg.oiChange
          ),
          putOiBuild: topBy(
            putLegs.filter((leg) => leg.oiChange > 0),
            (leg) => leg.oiChange
          ),
          callUnwinding: topBy(
            callLegs.filter((leg) => leg.oiChange < 0),
            (leg) => Math.abs(leg.oiChange)
          ),
          putUnwinding: topBy(
            putLegs.filter((leg) => leg.oiChange < 0),
            (leg) => Math.abs(leg.oiChange)
          )
        }
      : null,
    diagnostics: errors.slice(-2)
  });
}
