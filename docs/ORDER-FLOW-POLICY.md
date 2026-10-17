# Exact Order Flow Policy

ALLINONEVIEW must never present estimated buying/selling pressure as real order flow.

## Directional volume rule

A candle may show Buy Volume, Sell Volume, Delta or Buy/Sell percentages only when the connected market-data source supplies real trade-side information for the underlying executions.

Never derive or label buyer/seller volume from:

- green/red candle colour
- close versus open
- price uptick/downtick alone
- bid/ask snapshot alone
- bid size versus ask size
- total buy quantity versus total sell quantity
- any heuristic classifier presented as exact data

## Kraken

Kraken Spot WebSocket trade events expose the taker side for each public trade.

ALLINONEVIEW may therefore aggregate:

- exact buy volume
- exact sell volume
- exact delta
- exact buy/sell percentages
- number of trades observed

If the application joins a candle after that candle already started, that candle must be labelled PARTIAL. The first candle observed from its opening trade onward may be labelled complete/exact.

If the WebSocket reconnects during a candle, that candle must remain PARTIAL unless a complete exact historical trade backfill proves the missing interval.

## FYERS / Indian markets

FYERS SymbolUpdate contains real price, volume, last-traded quantity and order-book fields, but does not expose the aggressor side of every public market trade.

FYERS index updates do not include traded volume or bid/ask fields.

The General WebSocket trade-side field represents executions against the authenticated user's own orders, not the whole market, and must not be used as market-wide buyer/seller volume.

Therefore, with the current FYERS feed:

- do not show a fabricated Buy/Sell percentage
- keep exact order flow marked unavailable
- for index analysis, continue using the underlying index for price/structure and its relevant futures contract for genuine volume/OI/VWAP inputs
- add exact directional order flow only when a future authorised provider supplies sufficient exchange trade-side data

## Closed-market behavior

Closed markets remain configured and ready.

- Historical price/volume/OI data may continue to display.
- Live exact order flow begins automatically when the exact-capability provider starts sending real trades after the market opens.
- No synthetic order flow is generated while the market is closed.
- If a provider reconnects mid-candle, that candle is explicitly partial.
- 24/7 markets such as Kraken crypto stay active continuously.

## Session breaks

Session separators are deterministic chart metadata, not an estimate.

- NSE/BSE/MCX-style instruments use the Asia/Kolkata trading date.
- Kraken crypto uses UTC day boundaries.
- Session separators display on intraday charts only.
