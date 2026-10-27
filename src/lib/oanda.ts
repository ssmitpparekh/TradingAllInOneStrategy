export type OandaInstrument = {
  name: string;
  type: "CURRENCY" | "CFD" | "METAL";
  displayName: string;
  pipLocation?: number;
  displayPrecision?: number;
};

export type OandaCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function oandaBaseUrl() {
  const configured = env("OANDA_API_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  return env("OANDA_ENVIRONMENT").toLowerCase() === "practice"
    ? "https://api-fxpractice.oanda.com"
    : "https://api-fxtrade.oanda.com";
}

export function oandaStreamBaseUrl() {
  const configured = env("OANDA_STREAM_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  return env("OANDA_ENVIRONMENT").toLowerCase() === "practice"
    ? "https://stream-fxpractice.oanda.com"
    : "https://stream-fxtrade.oanda.com";
}

function oandaToken() {
  const token = env("OANDA_API_TOKEN");
  if (!token) {
    throw new Error(
      "OANDA_API_TOKEN is not configured in .env.local."
    );
  }
  return token;
}

async function oandaFetch(path: string) {
  const response = await fetch(oandaBaseUrl() + path, {
    headers: {
      Accept: "application/json",
      "Accept-Datetime-Format": "UNIX",
      Authorization: `Bearer ${oandaToken()}`
    },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body?.errorMessage ||
        body?.errorCode ||
        `OANDA HTTP ${response.status}`
    );
  }

  return body;
}

let resolvedAccount: { id: string; fetchedAt: number } | null = null;

export async function getOandaAccountId() {
  const configured = env("OANDA_ACCOUNT_ID");
  if (configured) return configured;

  if (
    resolvedAccount &&
    Date.now() - resolvedAccount.fetchedAt < 30 * 60 * 1000
  ) {
    return resolvedAccount.id;
  }

  const body = await oandaFetch("/v3/accounts");
  const id = String(body?.accounts?.[0]?.id ?? "");
  if (!id) {
    throw new Error(
      "No OANDA v20 account was returned for this access token."
    );
  }

  resolvedAccount = { id, fetchedAt: Date.now() };
  return id;
}

export async function getOandaInstruments(): Promise<OandaInstrument[]> {
  const accountId = await getOandaAccountId();
  const body = await oandaFetch(
    `/v3/accounts/${encodeURIComponent(accountId)}/instruments`
  );
  const items: Record<string, unknown>[] = Array.isArray(body?.instruments)
    ? (body.instruments as Record<string, unknown>[])
    : [];

  return items
    .map((item): OandaInstrument | null => {
      const name = String(item.name ?? "");
      const type = String(item.type ?? "") as OandaInstrument["type"];
      if (
        !name ||
        !["CURRENCY", "CFD", "METAL"].includes(type)
      ) {
        return null;
      }

      return {
        name,
        type,
        displayName: String(item.displayName ?? name),
        pipLocation:
          item.pipLocation === undefined
            ? undefined
            : Number(item.pipLocation),
        displayPrecision:
          item.displayPrecision === undefined
            ? undefined
            : Number(item.displayPrecision)
      };
    })
    .filter((item: OandaInstrument | null): item is OandaInstrument =>
      Boolean(item)
    );
}

export async function openOandaPricingStream(
  symbol: string,
  signal?: AbortSignal
) {
  const accountId = await getOandaAccountId();
  const query = new URLSearchParams({
    instruments: symbol,
    snapshot: "true"
  });

  const response = await fetch(
    `${oandaStreamBaseUrl()}/v3/accounts/${encodeURIComponent(accountId)}/pricing/stream?${query.toString()}`,
    {
      headers: {
        Accept: "application/octet-stream",
        "Accept-Datetime-Format": "UNIX",
        Authorization: `Bearer ${oandaToken()}`
      },
      cache: "no-store",
      signal
    }
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = raw;

    try {
      const parsed = JSON.parse(raw);
      detail =
        parsed?.errorMessage ||
        parsed?.errorCode ||
        raw;
    } catch {
      // Keep raw upstream detail when it is not JSON.
    }

    throw new Error(
      detail || `OANDA streaming HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error("OANDA pricing stream returned no response body.");
  }

  return response;
}

export async function getOandaQuote(symbol: string) {
  const accountId = await getOandaAccountId();
  const body = await oandaFetch(
    `/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=${encodeURIComponent(symbol)}`
  );
  const price = body?.prices?.[0];
  if (!price) {
    throw new Error(`No OANDA price returned for ${symbol}.`);
  }

  const bids = Array.isArray(price.bids) ? price.bids : [];
  const asks = Array.isArray(price.asks) ? price.asks : [];
  const bid = Number(bids[0]?.price ?? price.closeoutBid ?? 0);
  const ask = Number(asks[0]?.price ?? price.closeoutAsk ?? 0);
  const mid =
    bid > 0 && ask > 0
      ? (bid + ask) / 2
      : Number(price.closeoutBid ?? price.closeoutAsk ?? 0);

  return {
    symbol,
    lp: mid,
    ch: 0,
    chp: 0,
    open: mid,
    high: mid,
    low: mid,
    previousClose: mid,
    volume: 0,
    bid,
    ask
  };
}

const GRANULARITY: Record<string, string> = {
  "1": "M1",
  "2": "M2",
  "3": "M3",
  "4": "M4",
  "5": "M5",
  "10": "M10",
  "15": "M15",
  "30": "M30",
  "60": "H1",
  "120": "H2",
  "180": "H3",
  "240": "H4",
  "1D": "D",
  "1W": "W",
  "1M": "M"
};

export function oandaGranularity(resolution: string) {
  const value = GRANULARITY[resolution];
  if (!value) {
    throw new Error(
      `OANDA does not provide ${resolution} candles directly.`
    );
  }
  return value;
}

export async function getOandaCandles(options: {
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}): Promise<OandaCandle[]> {
  const granularity = oandaGranularity(options.resolution);
  const query = new URLSearchParams({
    price: "M",
    granularity,
    from: String(options.from),
    to: String(options.to),
    smooth: "false",
    includeFirst: "true"
  });

  // Historical candlesticks are instrument-scoped in OANDA v20.
  // Do not use the account-scoped latest-candles/pricing routes here.
  const body = await oandaFetch(
    `/v3/instruments/${encodeURIComponent(options.symbol)}/candles?${query.toString()}`
  );

  const candles: Record<string, unknown>[] = Array.isArray(body?.candles)
    ? (body.candles as Record<string, unknown>[])
    : [];

  return candles
    .flatMap((candle) => {
      const mid = candle.mid as Record<string, unknown> | undefined;
      if (!mid) return [];

      const time = Math.floor(Number(candle.time));
      const open = Number(mid.o);
      const high = Number(mid.h);
      const low = Number(mid.l);
      const close = Number(mid.c);

      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return [];
      }

      return [{
        time,
        open,
        high,
        low,
        close,
        volume: Number(candle.volume ?? 0)
      } satisfies OandaCandle];
    });
}
