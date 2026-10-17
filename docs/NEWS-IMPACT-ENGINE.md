# News Impact Engine

ALLINONEVIEW treats news as a market-risk layer above technical structure, not as a standalone trading trigger.

## Source tiers

### Official
Polled frequently from machine-readable official feeds:
- RBI Press Releases
- RBI Notifications
- SEBI
- NSE Corporate Announcements
- NSE Corporate Actions
- NSE Board Meetings
- BSE Notices
- PIB Economic releases
- Federal Reserve monetary-policy releases
- ECB press feed

Official sources receive the highest trust score.

### X
Optional.

Configuration:
- `NEWS_X_BEARER_TOKEN`
- optional `NEWS_X_STREAM_URL`
- optional `NEWS_X_QUERY`
- optional `NEWS_X_POLL_MS`

When an entitled streaming endpoint is configured, ALLINONEVIEW consumes it continuously.
Without a streaming endpoint, X falls back to recent-search polling when a bearer token is present.

X access and latency depend on the user's X API entitlement. The application must never describe a polled X feed as millisecond real-time.

### Global aggregator
GDELT is used as a broad worldwide fallback. GDELT's update cycle is slower than an exchange/newswire/X streaming feed, so each event retains its measured arrival latency and lower source trust.

## Impact model

Every incoming headline is scored for:
- source trust
- impact severity
- region
- affected asset tags
- explicitly mapped symbols where possible
- risk bias
- directional impact estimate
- confidence
- likely time horizon
- measured publication-to-receipt latency when a publication timestamp exists

Severity labels:
- INFO
- WATCH
- HIGH
- CRITICAL

Bias labels can include:
- RISK_ON
- RISK_OFF
- HAWKISH
- DOVISH
- COMMODITY_UP
- COMMODITY_DOWN
- COMPANY_POSITIVE
- COMPANY_NEGATIVE
- UNKNOWN

These are deterministic impact estimates, not guarantees.

## Trade priority rules

1. CRITICAL + trusted + sufficiently confident:
   - new technical entries are placed in NEWS HOLD
   - no new platform trade is journaled
   - price response must confirm the post-news direction before technical entries resume

2. HIGH + strong confidence + opposite the technical setup:
   - new entry is suppressed as NEWS HOLD

3. HIGH + aligned with the technical setup:
   - setup remains eligible
   - scanner prioritises it as NEWS + STRUCTURE

4. News alone:
   - never creates a LONG/SHORT
   - appears as WAIT FOR PRICE CONFIRMATION

5. Existing open journal trades:
   - remain historically intact
   - the UI surfaces current news risk rather than rewriting historical outcomes

## Broad-vs-company mapping

A company-specific NSE/BSE announcement must not freeze the entire Indian market.

Broad Indian indices are gated only by events tagged as:
- INDIA_MACRO
- INDIA_MARKET_RULE
- GLOBAL_RISK

Company-specific news gates an instrument only when that company/symbol can be mapped.

## Latency

The UI shows measured source latency where possible.

- X streaming can be sub-second/seconds depending on entitlement and network path.
- Official RSS polling is frequent but cannot honestly be called millisecond real-time.
- GDELT is a broad fallback and is intentionally treated as slower.

ALLINONEVIEW must never hide this distinction.
