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
