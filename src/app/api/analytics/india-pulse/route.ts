import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";
import {
  INDIA_CORE,
  INDIA_INDEXES,
  SECTOR_ORDER
} from "@/lib/analytics/india-universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function batchQuotes(token: string, symbols: string[]) {
  const output = [];
  for (let index = 0; index < symbols.length; index += 50) {
    output.push(
      ...(await getQuotes(token, symbols.slice(index, index + 50)))
    );
  }
  return output;
}

export async function GET() {
  const session = await readFyersSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "FYERS is not connected." },
      { status: 401 }
    );
  }

  try {
    const [stockQuotes, indexQuotes] = await Promise.all([
      batchQuotes(
        session.accessToken,
        INDIA_CORE.map((item) => item.symbol)
      ),
      batchQuotes(
        session.accessToken,
        INDIA_INDEXES.map((item) => item.symbol)
      )
    ]);

    const stockBySymbol = new Map(
      stockQuotes.map((quote) => [quote.symbol, quote])
    );
    const indexBySymbol = new Map(
      indexQuotes.map((quote) => [quote.symbol, quote])
    );

    const stocks = INDIA_CORE.flatMap((item) => {
      const quote = stockBySymbol.get(item.symbol);
      if (!quote) return [];
      return [{
        ...item,
        price: quote.lp,
        change: quote.ch,
        changePercent: quote.chp,
        volume: quote.volume
      }];
    });

    const advancing = stocks.filter((item) => item.changePercent > 0).length;
    const declining = stocks.filter((item) => item.changePercent < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const averageChange = stocks.length
      ? stocks.reduce((sum, item) => sum + item.changePercent, 0) /
        stocks.length
      : 0;

    const sectors = SECTOR_ORDER.flatMap((sector) => {
      const members = stocks.filter((item) => item.sector === sector);
      if (!members.length) return [];

      const up = members.filter((item) => item.changePercent > 0).length;
      const down = members.filter((item) => item.changePercent < 0).length;
      const avg =
        members.reduce((sum, item) => sum + item.changePercent, 0) /
        members.length;

      return [{
        sector,
        averageChangePercent: avg,
        advancing: up,
        declining: down,
        unchanged: members.length - up - down,
        breadthPercent: members.length
          ? ((up - down) / members.length) * 100
          : 0,
        members: members
          .slice()
          .sort(
            (a, b) =>
              Math.abs(b.changePercent) - Math.abs(a.changePercent)
          )
      }];
    });

    return NextResponse.json({
      ok: true,
      generatedAt: Math.floor(Date.now() / 1000),
      breadth: {
        advancing,
        declining,
        unchanged,
        total: stocks.length,
        advanceDeclineRatio:
          declining > 0 ? advancing / declining : advancing,
        averageChangePercent: averageChange
      },
      indexes: INDIA_INDEXES.flatMap((index) => {
        const quote = indexBySymbol.get(index.symbol);
        return quote
          ? [{
              ...index,
              price: quote.lp,
              change: quote.ch,
              changePercent: quote.chp
            }]
          : [];
      }),
      topGainers: stocks
        .slice()
        .sort((a, b) => b.changePercent - a.changePercent)
        .slice(0, 10),
      topLosers: stocks
        .slice()
        .sort((a, b) => a.changePercent - b.changePercent)
        .slice(0, 10),
      sectors,
      stocks
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to build India market pulse."
      },
      { status: 502 }
    );
  }
}
