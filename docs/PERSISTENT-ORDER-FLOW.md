# Persistent Buyer / Seller Volume Recorder

The chart must not be responsible for historical order-flow recording.

ALLINONEVIEW therefore has two separate responsibilities:

1. **Always-on collector** — receives the exchange trade tape whether or not a browser is open.
2. **Chart** — reads stored 1-minute buyer/seller history and aggregates it into the selected timeframe.

## What is exact today

Kraken's public trade stream identifies the aggressor/taker side for every trade.
The collector records:

- provider
- market
- symbol
- Kraken trade ID
- exchange timestamp
- price
- quantity
- taker side: buy or sell

The database deduplicates by provider + symbol + trade ID.

Permanent 1-minute bars are rebuilt from that raw trade tape:

- exact buy volume
- exact sell volume
- number of trades
- exact buy-trade count
- exact sell-trade count

The UI then aggregates those 1-minute records into 2m, 3m, 5m, 10m, 15m,
20m, 30m, 45m, 1H, 2H, 3H, 4H, 1D and 1W bars.

## Why the recorder is separate

A browser cannot collect trades while it is closed.

Running `npm run dev` is also not sufficient if the computer itself is off.

For true unattended history, `scripts/order-flow-collector.mjs` must be deployed as
an always-on process on a server/container with persistent internet connectivity.

The chart can then be opened at any time and the stored bars will appear on the
historical candles even though no user had that chart open when the trades occurred.

## Neon database setup

ALLINONEVIEW uses Neon Postgres for persistent order-flow storage.

The project-level Neon configuration is in `neon.ts`. For local development, pull the
current branch connection variables into `.env.local`:

```
neon env pull --service postgres
```

This provides:

```
DATABASE_URL=
DATABASE_URL_UNPOOLED=
NEON_BRANCH=
```

`DATABASE_URL` is the pooled connection string used by the app and collector.
`DATABASE_URL_UNPOOLED` is used by the schema setup script.

Apply the schema with:

```
npm run db:setup
```

Verify the database with the rollback-safe smoke test:

```
npm run db:smoke
```

Never expose either database connection string to browser/client code.

## Starting the collector

Locally, for testing:

```
npm run collector:orderflow
```

The script reads `.env.local` automatically.

For production, run the same command as a continuously running worker/service.
A serverless request route is not appropriate for an always-open market WebSocket.

## Coverage

`ORDER_FLOW_KRAKEN_SYMBOLS` is the recording universe.

The default recording universe is:

```
BTC/USD,ETH/USD,SOL/USD,XRP/USD
```

Those symbols are recorded continuously whether or not anyone opens them in the UI.
Increase the list deliberately as storage/network capacity is planned.

Do not subscribe to every possible exchange pair blindly: exact trade tape storage can
be large on high-volume markets.

## Indian markets

FYERS currently supplies quote/depth/OI data used elsewhere in ALLINONEVIEW, but the
current feed does not give ALLINONEVIEW a proven exchange aggressor-side trade tape
equivalent to Kraken's `side=buy/sell` records.

Therefore:

- do not label candle colour as buyer/seller volume;
- do not infer exact buyer/seller percentages from OHLC;
- persist exact Indian taker-side order flow only after a provider/feed that actually
  supplies that data is connected.

This is an intentional data-integrity rule.

## Browser fallback

The browser also stores completed exact buckets locally. This fixes the old behaviour
where completed bars disappeared as soon as a new candle began.

Local browser storage is only a convenience cache. The always-on Neon collector is
the source required for history recorded while the user is offline.
