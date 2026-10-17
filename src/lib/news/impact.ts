export type NewsSourceTier = "OFFICIAL" | "X" | "GLOBAL_AGGREGATOR";
export type NewsSeverityClass = "INFO" | "WATCH" | "HIGH" | "CRITICAL";
export type NewsBias =
  | "RISK_ON"
  | "RISK_OFF"
  | "HAWKISH"
  | "DOVISH"
  | "COMMODITY_UP"
  | "COMMODITY_DOWN"
  | "COMPANY_POSITIVE"
  | "COMPANY_NEGATIVE"
  | "NEUTRAL"
  | "UNKNOWN";

export type NewsImpactEvent = {
  id: string;
  headline: string;
  url: string | null;
  source: string;
  sourceTier: NewsSourceTier;
  region: "INDIA" | "US" | "EU" | "GLOBAL" | "CRYPTO";
  publishedAt: number | null;
  receivedAt: number;
  latencyMs: number | null;
  severity: number;
  severityClass: NewsSeverityClass;
  trust: number;
  bias: NewsBias;
  confidence: number;
  horizon: "MINUTES" | "INTRADAY" | "MULTI_DAY";
  tags: string[];
  symbols: string[];
  rationale: string;
  hardGate: boolean;
  expiresAt: number;
};

type RawNewsItem = {
  id?: string;
  headline: string;
  url?: string | null;
  source: string;
  sourceTier: NewsSourceTier;
  region: NewsImpactEvent["region"];
  publishedAt?: number | null;
};

const CRITICAL_TERMS = [
  "emergency",
  "unscheduled",
  "war",
  "missile",
  "invasion",
  "attack",
  "sanction",
  "capital control",
  "market closed",
  "market closure",
  "trading halt",
  "default",
  "bankruptcy",
  "cyberattack",
  "rate decision",
  "repo rate",
  "interest rate decision",
  "intervention",
  "ceasefire"
];

const HIGH_TERMS = [
  "rate hike",
  "rate cut",
  "inflation",
  "consumer price",
  "cpi",
  "jobs report",
  "payroll",
  "unemployment",
  "gdp",
  "tariff",
  "ban",
  "approval",
  "rejection",
  "guidance cut",
  "profit warning",
  "earnings miss",
  "earnings beat",
  "merger",
  "acquisition",
  "stimulus",
  "liquidity"
];

const RISK_OFF_TERMS = [
  "war",
  "attack",
  "missile",
  "invasion",
  "sanction",
  "default",
  "bankruptcy",
  "cyberattack",
  "profit warning",
  "guidance cut",
  "earnings miss",
  "tariff",
  "ban",
  "emergency"
];

const RISK_ON_TERMS = [
  "ceasefire",
  "stimulus",
  "rate cut",
  "approval",
  "earnings beat",
  "guidance raised",
  "record profit",
  "liquidity support"
];

const HAWKISH_TERMS = [
  "rate hike",
  "higher for longer",
  "inflation remains elevated",
  "tighten",
  "tightening"
];

const DOVISH_TERMS = [
  "rate cut",
  "easing",
  "liquidity support",
  "accommodative"
];

const COMMODITY_UP_TERMS = [
  "supply disruption",
  "production cut",
  "export ban",
  "pipeline outage",
  "oilfield attack"
];

const COMMODITY_DOWN_TERMS = [
  "production increase",
  "output increase",
  "supply increase"
];

const COMPANY_NEGATIVE_TERMS = [
  "fraud",
  "default",
  "bankruptcy",
  "profit warning",
  "guidance cut",
  "regulatory action",
  "investigation"
];

const COMPANY_POSITIVE_TERMS = [
  "earnings beat",
  "guidance raised",
  "contract win",
  "order win",
  "buyback",
  "dividend increase"
];

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function trustFor(sourceTier: NewsSourceTier, source: string) {
  if (sourceTier === "OFFICIAL") return 98;
  if (sourceTier === "X") {
    return /official|rbi|sebi|nse|federal reserve|ecb/i.test(source)
      ? 92
      : 74;
  }
  return 72;
}

function severityClass(severity: number): NewsSeverityClass {
  if (severity >= 85) return "CRITICAL";
  if (severity >= 70) return "HIGH";
  if (severity >= 45) return "WATCH";
  return "INFO";
}

function inferBias(text: string): NewsBias {
  if (containsAny(text, HAWKISH_TERMS)) return "HAWKISH";
  if (containsAny(text, DOVISH_TERMS)) return "DOVISH";
  if (containsAny(text, COMMODITY_UP_TERMS)) return "COMMODITY_UP";
  if (containsAny(text, COMMODITY_DOWN_TERMS)) return "COMMODITY_DOWN";
  if (containsAny(text, COMPANY_NEGATIVE_TERMS)) return "COMPANY_NEGATIVE";
  if (containsAny(text, COMPANY_POSITIVE_TERMS)) return "COMPANY_POSITIVE";
  if (containsAny(text, RISK_OFF_TERMS)) return "RISK_OFF";
  if (containsAny(text, RISK_ON_TERMS)) return "RISK_ON";
  return "UNKNOWN";
}

function inferTags(
  text: string,
  region: NewsImpactEvent["region"],
  source: string
) {
  const tags = new Set<string>();

  if (region === "INDIA") {
    tags.add("INDIA");

    if (
      /^RBI\b/i.test(source) ||
      /\b(repo rate|monetary policy|inflation|gdp|fiscal|budget|rupee|liquidity)\b/i.test(
        text
      )
    ) {
      tags.add("INDIA_MACRO");
      tags.add("NIFTY");
    }

    if (
      /^SEBI\b/i.test(source) &&
      /\b(circular|regulation|derivative|f&o|margin|short selling|market|mutual fund)\b/i.test(
        text
      )
    ) {
      tags.add("INDIA_MARKET_RULE");
      tags.add("NIFTY");
    }

    if (/^PIB Economic/i.test(source)) {
      tags.add("INDIA_MACRO");
      tags.add("NIFTY");
    }
  }
  if (region === "US") {
    tags.add("US");
    tags.add("US_STOCKS");
    tags.add("USD");
  }
  if (region === "EU") {
    tags.add("EU");
    tags.add("EUR");
  }
  if (region === "CRYPTO") tags.add("CRYPTO");
  if (region === "GLOBAL") tags.add("GLOBAL");

  if (/bank|rbi|repo rate|credit|liquidity/i.test(text)) {
    tags.add("BANKS");
    tags.add("BANKNIFTY");
    tags.add("INR");
  }
  if (/oil|crude|opec|pipeline|middle east/i.test(text)) {
    tags.add("OIL");
    tags.add("MCX_CRUDE");
  }
  if (/gold|bullion|safe haven/i.test(text)) {
    tags.add("GOLD");
    tags.add("MCX_GOLD");
  }
  if (/bitcoin|btc|crypto|ethereum|eth|stablecoin|sec crypto|etf/i.test(text)) {
    tags.add("CRYPTO");
    tags.add("BTC");
    tags.add("ETH");
  }
  if (/inflation|cpi|payroll|jobs|unemployment|federal reserve|fed/i.test(text)) {
    tags.add("MACRO");
    tags.add("USD");
    tags.add("US_STOCKS");
    tags.add("CRYPTO");
    tags.add("GOLD");
  }
  if (/war|missile|attack|sanction|ceasefire/i.test(text)) {
    tags.add("GEOPOLITICS");
    tags.add("GLOBAL_RISK");
    tags.add("OIL");
    tags.add("GOLD");
    tags.add("CRYPTO");
  }

  return [...tags];
}

function inferSymbols(text: string) {
  const symbols = new Set<string>();

  const map: Array<[RegExp, string]> = [
    [/reliance/i, "NSE:RELIANCE-EQ"],
    [/hdfc bank|hdfcbank/i, "NSE:HDFCBANK-EQ"],
    [/icici bank|icicibank/i, "NSE:ICICIBANK-EQ"],
    [/tcs|tata consultancy/i, "NSE:TCS-EQ"],
    [/infosys|infy/i, "NSE:INFY-EQ"],
    [/sbi|state bank of india/i, "NSE:SBIN-EQ"],
    [/nifty bank|bank nifty/i, "NSE:NIFTYBANK-INDEX"],
    [/nifty 50|nifty/i, "NSE:NIFTY50-INDEX"],
    [/sensex/i, "BSE:SENSEX-INDEX"],
    [/bitcoin|btc/i, "BTC/USD"],
    [/ethereum|eth/i, "ETH/USD"]
  ];

  for (const [pattern, symbol] of map) {
    if (pattern.test(text)) symbols.add(symbol);
  }

  return [...symbols];
}

function baseSeverity(text: string, sourceTier: NewsSourceTier) {
  let score = sourceTier === "OFFICIAL" ? 34 : sourceTier === "X" ? 28 : 20;

  if (containsAny(text, CRITICAL_TERMS)) score += 46;
  else if (containsAny(text, HIGH_TERMS)) score += 32;

  if (/breaking|urgent|flash/i.test(text)) score += 8;
  if (/unexpected|surprise|unscheduled/i.test(text)) score += 8;

  return Math.max(0, Math.min(100, score));
}

function confidenceFor(
  trust: number,
  severity: number,
  bias: NewsBias,
  sourceTier: NewsSourceTier
) {
  let confidence = Math.round(trust * 0.55 + severity * 0.25);
  if (bias !== "UNKNOWN" && bias !== "NEUTRAL") confidence += 10;
  if (sourceTier === "OFFICIAL") confidence += 6;
  return Math.max(0, Math.min(100, confidence));
}

function horizonFor(severity: number, text: string): NewsImpactEvent["horizon"] {
  if (
    severity >= 85 &&
    /war|sanction|rate decision|repo rate|tariff|default|bankruptcy/i.test(text)
  ) {
    return "MULTI_DAY";
  }

  if (severity >= 70) return "INTRADAY";
  return "MINUTES";
}

function expiryFor(
  severity: number,
  horizon: NewsImpactEvent["horizon"],
  receivedAt: number
) {
  const duration =
    horizon === "MULTI_DAY"
      ? 24 * 60 * 60
      : horizon === "INTRADAY"
        ? 4 * 60 * 60
        : severity >= 70
          ? 45 * 60
          : 15 * 60;

  return receivedAt + duration * 1000;
}

export function analyzeNewsItem(raw: RawNewsItem): NewsImpactEvent {
  const receivedAt = Date.now();
  const text = raw.headline.toLowerCase();
  const trust = trustFor(raw.sourceTier, raw.source);
  const bias = inferBias(text);
  const severity = baseSeverity(text, raw.sourceTier);
  const confidence = confidenceFor(
    trust,
    severity,
    bias,
    raw.sourceTier
  );
  const horizon = horizonFor(severity, text);
  const tags = inferTags(text, raw.region, raw.source);
  const symbols = inferSymbols(raw.headline);
  const publishedAt =
    raw.publishedAt && raw.publishedAt > 0 ? raw.publishedAt : null;
  const latencyMs =
    publishedAt !== null
      ? Math.max(0, receivedAt - publishedAt)
      : null;

  const hardGate =
    severity >= 85 &&
    confidence >= 70 &&
    trust >= 80;

  return {
    id:
      raw.id ??
      [
        raw.source,
        raw.headline,
        publishedAt ?? receivedAt
      ].join("|"),
    headline: raw.headline,
    url: raw.url ?? null,
    source: raw.source,
    sourceTier: raw.sourceTier,
    region: raw.region,
    publishedAt,
    receivedAt,
    latencyMs,
    severity,
    severityClass: severityClass(severity),
    trust,
    bias,
    confidence,
    horizon,
    tags,
    symbols,
    rationale:
      severity >= 85
        ? "Potentially market-moving event. Technical structure should be subordinated until price response stabilizes."
        : severity >= 70
          ? "High-impact event. Existing technical setups require confirmation against the news response."
          : severity >= 45
            ? "Relevant event. Use as a confluence modifier, not a standalone trade trigger."
            : "Low immediate market-impact estimate.",
    hardGate,
    expiresAt: expiryFor(severity, horizon, receivedAt)
  };
}

export type NewsGate = {
  blocked: boolean;
  riskLevel: "NONE" | "WATCH" | "HIGH" | "CRITICAL";
  direction:
    | "bullish"
    | "bearish"
    | "two-sided"
    | "unknown";
  confidence: number;
  event: NewsImpactEvent | null;
  reason: string;
};

function eventAppliesTo(
  event: NewsImpactEvent,
  symbol: string,
  market: string
) {
  if (event.symbols.includes(symbol)) return true;

  const tags = new Set(event.tags);
  if (market === "KRAKEN" && tags.has("CRYPTO")) return true;
  if (
    (market === "NSE" || market === "BSE" || market === "MCX") &&
    (tags.has("INDIA_MACRO") ||
      tags.has("INDIA_MARKET_RULE") ||
      tags.has("GLOBAL_RISK"))
  ) {
    return true;
  }
  if (
    market === "NSE" &&
    symbol.includes("NIFTYBANK") &&
    tags.has("BANKNIFTY")
  ) {
    return true;
  }
  if (market === "MCX" && /CRUDE/i.test(symbol) && tags.has("OIL")) {
    return true;
  }
  if (market === "MCX" && /GOLD/i.test(symbol) && tags.has("GOLD")) {
    return true;
  }

  return false;
}

function directionalImpact(
  event: NewsImpactEvent,
  market: string,
  symbol: string
): NewsGate["direction"] {
  const equityLike =
    market === "NSE" ||
    market === "BSE" ||
    market === "KRAKEN";

  if (event.bias === "RISK_OFF" && equityLike) return "bearish";
  if (event.bias === "RISK_ON" && equityLike) return "bullish";

  if (event.bias === "HAWKISH") {
    if (market === "KRAKEN") return "bearish";
    if (market === "NSE" || market === "BSE") return "bearish";
  }

  if (event.bias === "DOVISH") {
    if (market === "KRAKEN") return "bullish";
    if (market === "NSE" || market === "BSE") return "bullish";
  }

  if (event.bias === "COMMODITY_UP" && /CRUDE|GOLD/i.test(symbol)) {
    return "bullish";
  }
  if (event.bias === "COMMODITY_DOWN" && /CRUDE|GOLD/i.test(symbol)) {
    return "bearish";
  }

  if (event.bias === "COMPANY_POSITIVE") return "bullish";
  if (event.bias === "COMPANY_NEGATIVE") return "bearish";

  return "unknown";
}

export function buildNewsGate(input: {
  events: NewsImpactEvent[];
  symbol: string;
  market: string;
  now?: number;
}): NewsGate {
  const now = input.now ?? Date.now();

  const relevant = input.events
    .filter(
      (event) =>
        event.expiresAt > now &&
        eventAppliesTo(event, input.symbol, input.market)
    )
    .sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return b.receivedAt - a.receivedAt;
    });

  const top = relevant[0] ?? null;

  if (!top) {
    return {
      blocked: false,
      riskLevel: "NONE",
      direction: "unknown",
      confidence: 0,
      event: null,
      reason: "No active material news risk mapped to this instrument."
    };
  }

  const direction = directionalImpact(
    top,
    input.market,
    input.symbol
  );

  return {
    blocked: top.hardGate,
    riskLevel:
      top.severityClass === "INFO"
        ? "NONE"
        : top.severityClass,
    direction,
    confidence: top.confidence,
    event: top,
    reason: top.hardGate
      ? "Critical verified news overrides technical entry timing until the market response is confirmed."
      : top.severity >= 70
        ? "High-impact news must be reconciled with price before acting on the technical setup."
        : "News is relevant but does not override confirmed structure."
  };
}
