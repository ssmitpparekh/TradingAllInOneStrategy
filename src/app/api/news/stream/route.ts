import { NextRequest } from "next/server";
import {
  analyzeNewsItem,
  type NewsImpactEvent,
  type NewsSourceTier
} from "@/lib/news/impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedDefinition = {
  name: string;
  url: string;
  region: NewsImpactEvent["region"];
  tier: NewsSourceTier;
};

const OFFICIAL_FEEDS: FeedDefinition[] = [
  {
    name: "RBI Press Releases",
    url: "https://rbi.org.in/pressreleases_rss.xml",
    region: "INDIA",
    tier: "OFFICIAL"
  },
  {
    name: "RBI Notifications",
    url: "https://rbi.org.in/notifications_rss.xml",
    region: "INDIA",
    tier: "OFFICIAL"
  },
  {
    name: "SEBI",
    url: "https://www.sebi.gov.in/sebirss.xml",
    region: "INDIA",
    tier: "OFFICIAL"
  },
  {
    name: "Federal Reserve Monetary Policy",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    region: "US",
    tier: "OFFICIAL"
  },
  {
    name: "ECB",
    url: "https://www.ecb.europa.eu/rss/press.html",
    region: "EU",
    tier: "OFFICIAL"
  }
];

const GDELT_URL =
  "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
  encodeURIComponent(
    "(markets OR stocks OR central bank OR inflation OR tariff OR sanctions OR war OR ceasefire OR oil OR crude OR gold OR bitcoin OR ethereum)"
  ) +
  "&mode=artlist&maxrecords=50&format=json&sort=datedesc";

function encodeSse(event: string, payload: unknown) {
  return new TextEncoder().encode(
    "event: " +
      event +
      "\n" +
      "data: " +
      JSON.stringify(payload) +
      "\n\n"
  );
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function xmlValue(block: string, names: string[]) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const match = block.match(
      new RegExp(
        "<" +
          escaped +
          "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" +
          escaped +
          ">",
        "i"
      )
    );
    if (match?.[1]) return decodeXml(match[1]);
  }
  return "";
}

function parseRss(
  xml: string,
  feed: FeedDefinition
): NewsImpactEvent[] {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [])
  ];

  return blocks.slice(0, 30).flatMap((block, index) => {
    const headline = xmlValue(block, ["title"]);
    if (!headline) return [];

    const rawLink =
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      xmlValue(block, ["link"]);
    const published = xmlValue(block, [
      "pubDate",
      "published",
      "updated",
      "dc:date"
    ]);
    const timestamp = published ? Date.parse(published) : NaN;
    const guid = xmlValue(block, ["guid", "id"]);

    return [
      analyzeNewsItem({
        id:
          guid ||
          [
            feed.name,
            headline,
            Number.isFinite(timestamp) ? timestamp : index
          ].join("|"),
        headline,
        url: rawLink || null,
        source: feed.name,
        sourceTier: feed.tier,
        region: feed.region,
        publishedAt: Number.isFinite(timestamp) ? timestamp : null
      })
    ];
  });
}

function parseGdelt(payload: unknown): NewsImpactEvent[] {
  const articles =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { articles?: unknown[] }).articles)
      ? (payload as { articles: Array<Record<string, unknown>> }).articles
      : [];

  return articles.slice(0, 50).flatMap((article) => {
    const headline = String(article.title ?? "").trim();
    if (!headline) return [];

    const seenDate = String(
      article.seendate ?? article.date ?? ""
    ).trim();
    let publishedAt: number | null = null;

    if (/^\d{14}$/.test(seenDate)) {
      const year = Number(seenDate.slice(0, 4));
      const month = Number(seenDate.slice(4, 6));
      const day = Number(seenDate.slice(6, 8));
      const hour = Number(seenDate.slice(8, 10));
      const minute = Number(seenDate.slice(10, 12));
      const second = Number(seenDate.slice(12, 14));
      publishedAt = Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second
      );
    } else {
      const parsed = Date.parse(seenDate);
      if (Number.isFinite(parsed)) publishedAt = parsed;
    }

    const sourceDomain = String(article.domain ?? "GDELT");
    const sourceCountry = String(
      article.sourcecountry ?? ""
    ).toUpperCase();

    let region: NewsImpactEvent["region"] = "GLOBAL";
    if (sourceCountry === "INDIA") region = "INDIA";
    else if (sourceCountry === "UNITED STATES") region = "US";

    return [
      analyzeNewsItem({
        id: String(article.url ?? headline),
        headline,
        url: String(article.url ?? "") || null,
        source: "GDELT · " + sourceDomain,
        sourceTier: "GLOBAL_AGGREGATOR",
        region,
        publishedAt
      })
    ];
  });
}

function parseXPost(
  post: Record<string, unknown>,
  users: Map<string, Record<string, unknown>>
) {
  const headline = String(post.text ?? "").trim();
  if (!headline) return null;

  const authorId = String(post.author_id ?? "");
  const user = users.get(authorId);
  const username = String(user?.username ?? authorId || "X");
  const displayName = String(user?.name ?? username);
  const createdAt = Date.parse(String(post.created_at ?? ""));
  const region: NewsImpactEvent["region"] =
    /rbi|sebi|nse|india|modi|finance/i.test(
      username + " " + displayName
    )
      ? "INDIA"
      : /federalreserve|treasury|whitehouse|secgov/i.test(
            username + " " + displayName
          )
        ? "US"
        : /ecb/i.test(username + " " + displayName)
          ? "EU"
          : /bitcoin|crypto|ethereum/i.test(headline)
            ? "CRYPTO"
            : "GLOBAL";

  return analyzeNewsItem({
    id: String(post.id ?? headline),
    headline,
    url:
      post.id && username
        ? "https://x.com/" +
          encodeURIComponent(username) +
          "/status/" +
          encodeURIComponent(String(post.id))
        : null,
    source: "X · @" + username,
    sourceTier: "X",
    region,
    publishedAt: Number.isFinite(createdAt) ? createdAt : null
  });
}

async function fetchRecentX(): Promise<NewsImpactEvent[]> {
  const token = process.env.NEWS_X_BEARER_TOKEN?.trim();
  if (!token) return [];

  const query =
    process.env.NEWS_X_QUERY?.trim() ||
    '(markets OR stocks OR RBI OR SEBI OR "Federal Reserve" OR inflation OR tariff OR sanctions OR war OR oil OR bitcoin OR ethereum) -is:retweet';

  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "25");
  url.searchParams.set("tweet.fields", "created_at,author_id,lang");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set(
    "user.fields",
    "username,name,verified,verified_type"
  );

  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) return [];

  const body = await response.json();
  const users = new Map<string, Record<string, unknown>>();

  for (const user of body?.includes?.users ?? []) {
    users.set(String(user.id ?? ""), user);
  }

  return (body?.data ?? []).flatMap(
    (post: Record<string, unknown>) => {
      const item = parseXPost(post, users);
      return item ? [item] : [];
    }
  );
}

async function pumpXStream(
  enqueue: (event: NewsImpactEvent) => void,
  signal: AbortSignal
) {
  const streamUrl = process.env.NEWS_X_STREAM_URL?.trim();
  const token = process.env.NEWS_X_BEARER_TOKEN?.trim();

  if (!streamUrl || !token) return;

  try {
    const response = await fetch(streamUrl, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json"
      },
      signal,
      cache: "no-store"
    });

    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const payload = JSON.parse(trimmed);
          const post = payload?.data ?? payload;
          if (!post || typeof post !== "object") continue;

          const users = new Map<string, Record<string, unknown>>();
          for (const user of payload?.includes?.users ?? []) {
            users.set(String(user.id ?? ""), user);
          }

          const item = parseXPost(
            post as Record<string, unknown>,
            users
          );
          if (item) enqueue(item);
        } catch {
          // Streaming feeds can include keepalive/non-JSON lines.
        }
      }
    }
  } catch {
    // Optional X stream failure falls back to recent-search polling.
  }
}

export async function GET(request: NextRequest) {
  const streamAbort = new AbortController();
  const seen = new Map<string, number>();
  let rssTimer: ReturnType<typeof setInterval> | null = null;
  let gdeltTimer: ReturnType<typeof setInterval> | null = null;
  let xTimer: ReturnType<typeof setInterval> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeSend = (event: string, payload: unknown) => {
        if (!closed) controller.enqueue(encodeSse(event, payload));
      };

      const emit = (item: NewsImpactEvent) => {
        const seenAt = seen.get(item.id);
        if (seenAt && Date.now() - seenAt < 48 * 60 * 60_000) {
          return;
        }

        seen.set(item.id, Date.now());
        safeSend("news", item);
      };

      const fetchFeed = async (feed: FeedDefinition) => {
        try {
          const response = await fetch(feed.url, {
            headers: {
              "User-Agent":
                "ALLINONEVIEW/0.2 market-news-monitor"
            },
            cache: "no-store",
            signal: streamAbort.signal
          });
          if (!response.ok) return;

          const xml = await response.text();
          for (const item of parseRss(xml, feed)) emit(item);
        } catch {
          // One source should never stop the rest of the news engine.
        }
      };

      const pollOfficial = async () => {
        await Promise.all(
          OFFICIAL_FEEDS.map((feed) => fetchFeed(feed))
        );
      };

      const pollGdelt = async () => {
        try {
          const response = await fetch(GDELT_URL, {
            headers: {
              "User-Agent":
                "ALLINONEVIEW/0.2 market-news-monitor"
            },
            cache: "no-store",
            signal: streamAbort.signal
          });
          if (!response.ok) return;
          const body = await response.json();
          for (const item of parseGdelt(body)) emit(item);
        } catch {
          // GDELT is a fallback source only.
        }
      };

      const pollX = async () => {
        if (process.env.NEWS_X_STREAM_URL?.trim()) return;
        try {
          const items = await fetchRecentX();
          for (const item of items) emit(item);
        } catch {
          // X is optional until credentials/access are configured.
        }
      };

      safeSend("status", {
        connected: true,
        officialFeeds: OFFICIAL_FEEDS.length,
        xConfigured: Boolean(
          process.env.NEWS_X_BEARER_TOKEN?.trim()
        ),
        xStreaming: Boolean(
          process.env.NEWS_X_STREAM_URL?.trim()
        ),
        gdelt: true,
        startedAt: Date.now()
      });

      void pollOfficial();
      void pollGdelt();
      void pollX();
      void pumpXStream(emit, streamAbort.signal);

      rssTimer = setInterval(pollOfficial, 10_000);
      gdeltTimer = setInterval(pollGdelt, 60_000);

      const xPollMs = Math.max(
        5_000,
        Number(process.env.NEWS_X_POLL_MS ?? 15_000)
      );
      xTimer = setInterval(pollX, xPollMs);

      keepaliveTimer = setInterval(() => {
        safeSend("keepalive", {
          ts: Date.now(),
          seen: seen.size
        });
      }, 10_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        streamAbort.abort();
        if (rssTimer) clearInterval(rssTimer);
        if (gdeltTimer) clearInterval(gdeltTimer);
        if (xTimer) clearInterval(xTimer);
        if (keepaliveTimer) clearInterval(keepaliveTimer);
      };

      request.signal.addEventListener("abort", cleanup, {
        once: true
      });
    },
    cancel() {
      streamAbort.abort();
      if (rssTimer) clearInterval(rssTimer);
      if (gdeltTimer) clearInterval(gdeltTimer);
      if (xTimer) clearInterval(xTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
