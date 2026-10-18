import { createHash } from "node:crypto";

const FYERS_AUTH_BASE = "https://api-t1.fyers.in/api/v3";
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

export type FyersConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

export type FyersTokenResponse = {
  s: "ok" | "error";
  code: number;
  message?: string;
  access_token?: string;
  refresh_token?: string;
};

export type FyersQuote = {
  symbol: string;
  lp: number;
  ch: number;
  chp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  bid: number;
  ask: number;
  timestamp: number | string;
};

export function getFyersConfig(): FyersConfig {
  const appId = process.env.FYERS_APP_ID?.trim();
  const appSecret = process.env.FYERS_APP_SECRET?.trim();
  const redirectUri = process.env.FYERS_REDIRECT_URI?.trim();

  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "Missing FYERS configuration. Set FYERS_APP_ID, FYERS_APP_SECRET and FYERS_REDIRECT_URI in .env.local."
    );
  }

  return { appId, appSecret, redirectUri };
}

export function buildAuthorizationUrl(state: string): string {
  const { appId, redirectUri } = getFyersConfig();
  const url = new URL(`${FYERS_AUTH_BASE}/generate-authcode`);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeAuthCode(
  authCode: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const { appId, appSecret } = getFyersConfig();
  const appIdHash = createHash("sha256")
    .update(`${appId}:${appSecret}`, "utf8")
    .digest("hex");

  const response = await fetch(`${FYERS_AUTH_BASE}/validate-authcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      appIdHash,
      code: authCode
    }),
    cache: "no-store"
  });

  const body = (await response.json()) as FyersTokenResponse;

  if (!response.ok || body.s !== "ok" || !body.access_token) {
    throw new Error(
      `FYERS token exchange failed: ${body.message || `HTTP ${response.status}`}`
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token
  };
}

export async function getQuote(
  accessToken: string,
  symbol = "NSE:NIFTY50-INDEX"
): Promise<FyersQuote> {
  const { appId } = getFyersConfig();
  const url = new URL(`${FYERS_DATA_BASE}/quotes`);
  url.searchParams.set("symbols", symbol);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `${appId}:${accessToken}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const body = await response.json();

  if (!response.ok || body?.s !== "ok" || !Array.isArray(body?.d)) {
    const message = body?.message || `HTTP ${response.status}`;
    throw new Error(`FYERS quote request failed: ${message}`);
  }

  const entry = body.d.find((item: { n?: string }) => item?.n === symbol) ?? body.d[0];

  if (!entry || entry.s !== "ok" || !entry.v) {
    throw new Error(`No valid FYERS quote returned for ${symbol}.`);
  }

  const v = entry.v;
  return {
    symbol,
    lp: Number(v.lp ?? 0),
    ch: Number(v.ch ?? 0),
    chp: Number(v.chp ?? 0),
    open: Number(v.open_price ?? 0),
    high: Number(v.high_price ?? 0),
    low: Number(v.low_price ?? 0),
    previousClose: Number(v.prev_close_price ?? 0),
    volume: Number(v.volume ?? 0),
    bid: Number(v.bid ?? 0),
    ask: Number(v.ask ?? 0),
    timestamp: v.tt ?? 0
  };
}


export type FyersCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
};

export async function getHistory(
  accessToken: string,
  options: {
    symbol?: string;
    resolution?: string;
    from: number;
    to: number;
    includeOi?: boolean;
  }
): Promise<FyersCandle[]> {
  const { appId } = getFyersConfig();
  const symbol = options.symbol ?? "NSE:NIFTY50-INDEX";
  const resolution = options.resolution ?? "15";

  const url = new URL(`${FYERS_DATA_BASE}/history`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("resolution", resolution);
  url.searchParams.set("date_format", "0");
  url.searchParams.set("range_from", String(options.from));
  url.searchParams.set("range_to", String(options.to));
  const derivativeSymbol = /(?:FUT|CE|PE)$/.test(symbol);
  if (derivativeSymbol) {
    url.searchParams.set("cont_flag", "1");
  }
  if (options.includeOi && derivativeSymbol) {
    url.searchParams.set("oi_flag", "1");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `${appId}:${accessToken}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const body = await response.json();

  if (body?.s === "no_data" && Array.isArray(body?.candles)) {
    return [];
  }

  if (!response.ok || body?.s !== "ok" || !Array.isArray(body?.candles)) {
    const detail =
      body?.data && typeof body.data === "object"
        ? " " + JSON.stringify(body.data)
        : "";
    const message = body?.message || `HTTP ${response.status}`;
    throw new Error(
      `FYERS history request failed: ${message}${detail}`
    );
  }

  return body.candles.map((row: unknown[]) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] ?? 0),
    ...(row.length > 6 ? { oi: Number(row[6] ?? 0) } : {})
  }));
}


export type FyersFuturesChainEntry = {
  symbol: string;
  fyToken: string;
  lp: number;
  ch: number;
  chp: number;
  expiry: number | null;
  volume: number;
};

export type FyersDepth = {
  symbol: string;
  ltp: number;
  volume: number;
  oi: number;
  previousOi: number;
  oiPercent: number;
  expiry: string;
  totalBuyQty: number;
  totalSellQty: number;
};

export type FyersOptionGreeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
};

export type FyersOptionLeg = {
  symbol: string;
  optionType: "CE" | "PE";
  strike: number;
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  oi: number;
  oiChange: number;
  oiChangePercent: number;
  previousOi: number;
  greeks: FyersOptionGreeks | null;
};

export type FyersOptionExpiry = {
  date: string;
  expiry: number;
};

export type FyersOptionChain = {
  callOi: number;
  putOi: number;
  futuresPrice: number | null;
  futuresChange: number | null;
  futuresChangePercent: number | null;
  indiaVix: number | null;
  expiryData: FyersOptionExpiry[];
  legs: FyersOptionLeg[];
};

function fyersHeaders(accessToken: string) {
  const { appId } = getFyersConfig();
  return {
    Authorization: `${appId}:${accessToken}`,
    Accept: "application/json"
  };
}

export async function getFuturesChain(
  accessToken: string,
  symbol: string
): Promise<FyersFuturesChainEntry[]> {
  const url = new URL(`${FYERS_DATA_BASE}/futures-chain`);
  url.searchParams.set("symbol", symbol);

  const response = await fetch(url, {
    method: "GET",
    headers: fyersHeaders(accessToken),
    cache: "no-store"
  });

  const body = await response.json();

  if (!response.ok || body?.s !== "ok" || !Array.isArray(body?.data)) {
    const message = body?.message || `HTTP ${response.status}`;
    throw new Error(`FYERS futures chain request failed: ${message}`);
  }

  return body.data.map((entry: Record<string, unknown>) => ({
    symbol: String(entry.symbol ?? ""),
    fyToken: String(entry.fyToken ?? ""),
    lp: Number(entry.lp ?? 0),
    ch: Number(entry.ch ?? 0),
    chp: Number(entry.chp ?? 0),
    expiry:
      entry.expiry === "" || entry.expiry == null
        ? null
        : Number(entry.expiry),
    volume: Number(entry.volume ?? 0)
  }));
}

export async function getMarketDepth(
  accessToken: string,
  symbol: string
): Promise<FyersDepth> {
  const url = new URL(`${FYERS_DATA_BASE}/depth`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("ohlcv_flag", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: fyersHeaders(accessToken),
    cache: "no-store"
  });

  const body = await response.json();
  const entry = body?.d?.[symbol];

  if (!response.ok || body?.s !== "ok" || !entry) {
    const message = body?.message || `HTTP ${response.status}`;
    throw new Error(`FYERS market depth request failed: ${message}`);
  }

  return {
    symbol,
    ltp: Number(entry.ltp ?? 0),
    volume: Number(entry.v ?? 0),
    oi: Number(entry.oi ?? 0),
    previousOi: Number(entry.pdoi ?? 0),
    oiPercent: Number(entry.oipercent ?? 0),
    expiry: String(entry.expiry ?? ""),
    totalBuyQty: Number(entry.totalbuyqty ?? 0),
    totalSellQty: Number(entry.totalsellqty ?? 0)
  };
}

export async function getOptionChain(
  accessToken: string,
  symbol: string,
  options?: {
    strikeCount?: number;
    timestamp?: number | null;
    greeks?: boolean;
  }
): Promise<FyersOptionChain> {
  const url = new URL(`${FYERS_DATA_BASE}/options-chain-v3`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set(
    "strikecount",
    String(Math.min(50, Math.max(1, options?.strikeCount ?? 10)))
  );
  url.searchParams.set(
    "timestamp",
    options?.timestamp ? String(options.timestamp) : ""
  );
  url.searchParams.set("greeks", options?.greeks === false ? "0" : "1");

  const response = await fetch(url, {
    method: "GET",
    headers: fyersHeaders(accessToken),
    cache: "no-store"
  });

  const body = await response.json();
  const data = body?.data;

  if (!response.ok || body?.s !== "ok" || !data) {
    const message = body?.message || `HTTP ${response.status}`;
    throw new Error(`FYERS option chain request failed: ${message}`);
  }

  const optionsChain = Array.isArray(data.optionsChain)
    ? data.optionsChain
    : [];

  const underlying = optionsChain.find(
    (entry: Record<string, unknown>) =>
      Number(entry.strike_price ?? 0) === -1
  );

  const legs: FyersOptionLeg[] = optionsChain
    .filter((entry: Record<string, unknown>) => {
      const type = String(entry.option_type ?? "");
      return type === "CE" || type === "PE";
    })
    .map((entry: Record<string, unknown>) => {
      const rawGreeks =
        entry.greeks && typeof entry.greeks === "object"
          ? (entry.greeks as Record<string, unknown>)
          : null;

      return {
        symbol: String(entry.symbol ?? ""),
        optionType: String(entry.option_type) as "CE" | "PE",
        strike: Number(entry.strike_price ?? 0),
        ltp: Number(entry.ltp ?? 0),
        bid: Number(entry.bid ?? 0),
        ask: Number(entry.ask ?? 0),
        volume: Number(entry.volume ?? 0),
        oi: Number(entry.oi ?? 0),
        oiChange: Number(entry.oich ?? 0),
        oiChangePercent: Number(entry.oichp ?? 0),
        previousOi: Number(entry.prev_oi ?? 0),
        greeks: rawGreeks
          ? {
              delta: Number(rawGreeks.delta ?? 0),
              gamma: Number(rawGreeks.gamma ?? 0),
              theta: Number(rawGreeks.theta ?? 0),
              vega: Number(rawGreeks.vega ?? 0),
              iv: Number(rawGreeks.iv ?? 0)
            }
          : null
      };
    });

  const expiryData: FyersOptionExpiry[] = Array.isArray(data.expiryData)
    ? data.expiryData.map((entry: Record<string, unknown>) => ({
        date: String(entry.date ?? ""),
        expiry: Number(entry.expiry ?? 0)
      }))
    : [];

  return {
    callOi: Number(data.callOi ?? 0),
    putOi: Number(data.putOi ?? 0),
    futuresPrice:
      underlying && Number.isFinite(Number(underlying.fp))
        ? Number(underlying.fp)
        : null,
    futuresChange:
      underlying && Number.isFinite(Number(underlying.fpch))
        ? Number(underlying.fpch)
        : null,
    futuresChangePercent:
      underlying && Number.isFinite(Number(underlying.fpchp))
        ? Number(underlying.fpchp)
        : null,
    indiaVix:
      data.indiavixData &&
      Number.isFinite(Number(data.indiavixData.ltp))
        ? Number(data.indiavixData.ltp)
        : null,
    expiryData,
    legs
  };
}
