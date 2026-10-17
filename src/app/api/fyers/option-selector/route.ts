import { NextRequest, NextResponse } from "next/server";
import {
  getFyersConfig,
  getMarketDepth,
  getOptionChain,
  type FyersDepth,
  type FyersOptionLeg
} from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Direction = "bullish" | "bearish";
type StrategySide = "BUY" | "SELL";

type MasterRow = {
  symbol: string;
  lotSize: number;
};

const masterCache = new Map<
  string,
  { fetchedAt: number; rows: Map<string, MasterRow> }
>();
const MASTER_CACHE_MS = 30 * 60_000;

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function parseCsvLine(line: string) {
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

async function loadLotSizes(market: string) {
  const url =
    market === "BSE"
      ? "https://public.fyers.in/sym_details/BSE_FO.csv"
      : "https://public.fyers.in/sym_details/NSE_FO.csv";
  const cached = masterCache.get(url);

  if (cached && Date.now() - cached.fetchedAt < MASTER_CACHE_MS) {
    return cached.rows;
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load FYERS option lot sizes.");
  }

  const rows = new Map<string, MasterRow>();

  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line) continue;
    const row = parseCsvLine(line);
    const symbol = row[9]?.trim();
    const lotSize = Number(row[3] ?? 0);
    const optionType = row[16]?.trim();

    if (
      symbol &&
      (optionType === "CE" || optionType === "PE") &&
      Number.isFinite(lotSize) &&
      lotSize > 0
    ) {
      rows.set(symbol, { symbol, lotSize });
    }
  }

  masterCache.set(url, { fetchedAt: Date.now(), rows });
  return rows;
}

function baseScore(
  leg: FyersOptionLeg,
  side: StrategySide,
  maxima: { oi: number; volume: number; oiChange: number }
) {
  if (!(leg.ltp > 0)) return -Infinity;

  const absDelta = Math.abs(leg.greeks?.delta ?? 0);
  const targetDelta = side === "BUY" ? 0.55 : 0.3;
  const deltaTolerance = side === "BUY" ? 0.35 : 0.25;
  const deltaScore = clamp(
    1 - Math.abs(absDelta - targetDelta) / deltaTolerance
  );

  const mid =
    leg.bid > 0 && leg.ask > 0 ? (leg.bid + leg.ask) / 2 : leg.ltp;
  const spreadPct =
    mid > 0 && leg.ask >= leg.bid && leg.bid > 0
      ? ((leg.ask - leg.bid) / mid) * 100
      : 5;
  const spreadScore = clamp(1 - spreadPct / 3);

  const oiScore =
    maxima.oi > 0
      ? Math.log1p(Math.max(0, leg.oi)) /
        Math.log1p(maxima.oi)
      : 0;
  const volumeScore =
    maxima.volume > 0
      ? Math.log1p(Math.max(0, leg.volume)) /
        Math.log1p(maxima.volume)
      : 0;
  const oiChangeScore =
    maxima.oiChange > 0
      ? Math.log1p(Math.max(0, leg.oiChange)) /
        Math.log1p(maxima.oiChange)
      : 0;

  const iv = Math.max(0, leg.greeks?.iv ?? 0);
  const ivTarget = side === "BUY" ? 25 : 35;
  const ivScore = iv > 0 ? clamp(1 - Math.abs(iv - ivTarget) / 60) : 0.5;

  const theta = Math.abs(leg.greeks?.theta ?? 0);
  const thetaToPremium = leg.ltp > 0 ? theta / leg.ltp : 1;
  const thetaScore =
    side === "BUY"
      ? clamp(1 - thetaToPremium * 5)
      : clamp(thetaToPremium * 4);

  return (
    deltaScore * 26 +
    spreadScore * 22 +
    oiScore * 18 +
    volumeScore * 14 +
    oiChangeScore * 10 +
    ivScore * 6 +
    thetaScore * 4
  );
}

function depthScore(depth: FyersDepth | null, side: StrategySide) {
  if (!depth) return { points: 0, imbalancePercent: null as number | null };

  const buy = Math.max(0, depth.totalBuyQty);
  const sell = Math.max(0, depth.totalSellQty);
  const total = buy + sell;

  if (!(total > 0)) {
    return { points: 0, imbalancePercent: 0 };
  }

  const imbalance = ((buy - sell) / total) * 100;
  const directional =
    side === "BUY" ? Math.max(0, imbalance) : Math.max(0, -imbalance);

  return {
    points: clamp(directional / 50) * 8,
    imbalancePercent: imbalance
  };
}

async function marginPerLot(
  accessToken: string,
  symbol: string,
  lotSize: number
) {
  const { appId } = getFyersConfig();
  const response = await fetch(
    "https://api-t1.fyers.in/api/v3/multiorder/margin",
    {
      method: "POST",
      headers: {
        Authorization: `${appId}:${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        data: [
          {
            symbol,
            qty: lotSize,
            side: -1,
            type: 2,
            productType: "MARGIN",
            limitPrice: 0,
            stopPrice: 0,
            stopLoss: 0,
            takeProfit: 0
          }
        ]
      }),
      cache: "no-store"
    }
  );

  const body = await response.json();
  const value = Number(body?.data?.margin_total ?? 0);

  return response.ok && body?.s === "ok" && value > 0
    ? value
    : null;
}

async function enrichCandidates(
  accessToken: string,
  candidates: Array<{ leg: FyersOptionLeg; base: number }>,
  lotSizes: Map<string, MasterRow>,
  side: StrategySide,
  capital: number
) {
  const shortlist = candidates.slice(0, 3);

  return Promise.all(
    shortlist.map(async ({ leg, base }) => {
      const lotSize = lotSizes.get(leg.symbol)?.lotSize ?? null;
      let depth: FyersDepth | null = null;

      try {
        depth = await getMarketDepth(accessToken, leg.symbol);
      } catch {
        depth = null;
      }

      const depthResult = depthScore(depth, side);
      const priceForBuy = leg.ask > 0 ? leg.ask : leg.ltp;
      const buyCostPerLot =
        lotSize && priceForBuy > 0 ? lotSize * priceForBuy : null;
      const sellMarginPerLot =
        side === "SELL" && lotSize
          ? await marginPerLot(
              accessToken,
              leg.symbol,
              lotSize
            ).catch(() => null)
          : null;

      const capitalPerLot =
        side === "BUY" ? buyCostPerLot : sellMarginPerLot;
      const maxLots =
        capital > 0 && capitalPerLot && capitalPerLot > 0
          ? Math.floor(capital / capitalPerLot)
          : null;
      const affordable =
        capital <= 0
          ? true
          : maxLots !== null && maxLots > 0;

      return {
        symbol: leg.symbol,
        optionType: leg.optionType,
        strike: leg.strike,
        ltp: leg.ltp,
        bid: leg.bid,
        ask: leg.ask,
        volume: leg.volume,
        oi: leg.oi,
        oiChange: leg.oiChange,
        oiChangePercent: leg.oiChangePercent,
        greeks: leg.greeks,
        lotSize,
        buyCostPerLot,
        sellMarginPerLot,
        maxLots,
        maxQuantity:
          maxLots !== null && lotSize ? maxLots * lotSize : null,
        affordable,
        depth: depth
          ? {
              totalBuyQty: depth.totalBuyQty,
              totalSellQty: depth.totalSellQty,
              imbalancePercent: depthResult.imbalancePercent
            }
          : null,
        exactTakerOrderFlowAvailable: false,
        score: Math.round(
          Math.max(0, Math.min(100, base + depthResult.points))
        )
      };
    })
  );
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
    request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ??
    "NSE";
  const direction =
    request.nextUrl.searchParams.get("direction") === "bearish"
      ? "bearish"
      : "bullish";
  const capital = Math.max(
    0,
    Number(request.nextUrl.searchParams.get("capital") ?? 0)
  );

  if (!symbol || (market !== "NSE" && market !== "BSE")) {
    return NextResponse.json({
      ok: true,
      available: false,
      reason:
        "Automatic option selection is available for supported NSE/BSE option underlyings."
    });
  }

  try {
    const [chain, lotSizes] = await Promise.all([
      getOptionChain(session.accessToken, symbol, {
        strikeCount: 20,
        greeks: true
      }),
      loadLotSizes(market)
    ]);

    const optionType = direction === "bullish" ? "CE" : "PE";
    const sellOptionType = direction === "bullish" ? "PE" : "CE";
    const relevant = chain.legs.filter(
      (leg) => leg.optionType === optionType
    );
    const sellRelevant = chain.legs.filter(
      (leg) => leg.optionType === sellOptionType
    );

    if (!relevant.length && !sellRelevant.length) {
      return NextResponse.json({
        ok: true,
        available: false,
        reason: "No live option contracts were returned for this underlying."
      });
    }

    const maximaFor = (legs: FyersOptionLeg[]) => ({
      oi: Math.max(0, ...legs.map((leg) => leg.oi)),
      volume: Math.max(0, ...legs.map((leg) => leg.volume)),
      oiChange: Math.max(0, ...legs.map((leg) => Math.max(0, leg.oiChange)))
    });

    const buyCandidates = relevant
      .map((leg) => ({
        leg,
        base: baseScore(leg, "BUY", maximaFor(relevant))
      }))
      .filter((item) => Number.isFinite(item.base))
      .sort((a, b) => b.base - a.base);

    const sellCandidates = sellRelevant
      .map((leg) => ({
        leg,
        base: baseScore(leg, "SELL", maximaFor(sellRelevant))
      }))
      .filter((item) => Number.isFinite(item.base))
      .sort((a, b) => b.base - a.base);

    const [buyEnriched, sellEnriched] = await Promise.all([
      enrichCandidates(
        session.accessToken,
        buyCandidates,
        lotSizes,
        "BUY",
        capital
      ),
      enrichCandidates(
        session.accessToken,
        sellCandidates,
        lotSizes,
        "SELL",
        capital
      )
    ]);

    const rank = <T extends { score: number; affordable: boolean }>(
      items: T[]
    ) =>
      items
        .slice()
        .sort((a, b) => {
          if (capital > 0 && a.affordable !== b.affordable) {
            return a.affordable ? -1 : 1;
          }
          return b.score - a.score;
        });

    const rankedBuy = rank(buyEnriched);
    const rankedSell = rank(sellEnriched);
    const bestBuy =
      (capital > 0
        ? rankedBuy.find((item) => item.affordable)
        : rankedBuy[0]) ?? null;
    const bestSell =
      (capital > 0
        ? rankedSell.find((item) => item.affordable)
        : rankedSell[0]) ?? null;

    return NextResponse.json({
      ok: true,
      available: Boolean(bestBuy || bestSell),
      direction,
      capital,
      underlying: symbol,
      expiry: chain.expiryData[0] ?? null,
      indiaVix: chain.indiaVix,
      pcr: chain.callOi > 0 ? chain.putOi / chain.callOi : null,
      buyAction: direction === "bullish" ? "BUY CALL" : "BUY PUT",
      sellAction: direction === "bullish" ? "SELL PUT" : "SELL CALL",
      bestBuy,
      bestSell,
      alternatives: {
        buy: rankedBuy.slice(0, 3),
        sell: rankedSell.slice(0, 3)
      },
      orderFlowNote:
        "FYERS option-chain/depth data provides live price, Greeks, OI, OI change, volume, bid/ask and depth imbalance. Exact taker-side option trade flow is not exposed by this feed, so ALLINONEVIEW does not fabricate it."
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to rank option contracts."
      },
      { status: 502 }
    );
  }
}
