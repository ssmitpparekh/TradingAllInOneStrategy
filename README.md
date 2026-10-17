# ALLINONEVIEW

Read-only market analysis platform for Indian and global markets, using provider adapters such as FYERS and Kraken.

## Current foundation
- Secure FYERS OAuth authorization-code flow
- Server-side token handling
- Universal NSE / BSE / MCX instrument search
- Kraken public crypto adapter for global 24/7 live-market testing
- Historical candles, live quotes and live sockets
- Interactive candlestick chart with range/timeframe controls
- Fullscreen, fit, zoom, pan and crosshair support
- Mobile-first responsive terminal for iOS and Android
- Installable PWA with a shared web/app codebase
- Production health/error/security baseline
- No order placement / no trading permissions

## Delivery standard

Every feature must ship as one production unit:

- Desktop responsive behavior
- iOS and Android responsive behavior
- Touch-friendly controls and chart interactions
- PWA compatibility
- TypeScript and production build validation
- Production-server smoke tests
- Server-side credential protection
- Graceful loading, reconnect and error states

Mobile and production hardening must not be deferred until launch.

## Required before project completion
The project must not be called finished until these agreed items are implemented and validated:

- Live active-candle countdown / time remaining, TradingView-style, for every supported timeframe and provider
- Countdown must remain correct across market timezones, session boundaries, weekends/holidays, and 24/7 markets
- Universal analysis engine: swings, Fibonacci, Trend Fibonacci, BOS/CHoCH, Order Blocks, FVG, liquidity
- VWAP / Anchored VWAP / volume profile where applicable
- Futures and options OI / delta OI / options analytics where data permits
- Reversal confluence scoring, invalidation, stop-loss logic and targets
- Provider-aware behavior across Indian and global markets
- Final regression, performance and data-consistency validation
- Installable mobile experience on both iOS and Android
- PWA support (home-screen install / standalone app shell) plus a maintained path to native App Store / Google Play packaging from the same ALLINONEVIEW codebase

## Security
Never commit:
- FYERS App Secret
- access tokens
- refresh tokens
- passwords / PIN / OTP

Use `.env.local` for local credentials.
