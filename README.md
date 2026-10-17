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
- No order placement / no trading permissions

## Delivery standard

Every feature must be implemented and validated as one production unit:

- Desktop responsive behavior
- Mobile responsive behavior for iOS and Android screen sizes
- Touch-friendly chart/navigation controls
- Installable PWA behavior where applicable
- TypeScript validation
- Production Next.js build
- No secrets exposed to the browser or repository
- No stale market-data caching in service workers
- Graceful loading/error/reconnect states

Do not defer mobile or production hardening to the end of the project.

## Required before project completion
The project must not be called finished until these agreed items are implemented and validated:

- Live active-candle countdown / time remaining, TradingView-style, for every supported timeframe and provider
- Installable iOS and Android experience from the shared codebase; preserve an App Store / Google Play packaging path
- Countdown must remain correct across market timezones, session boundaries, weekends/holidays, and 24/7 markets
- Universal analysis engine: swings, Fibonacci, Trend Fibonacci, BOS/CHoCH, Order Blocks, FVG, liquidity
- VWAP / Anchored VWAP / volume profile where applicable
- Futures and options OI / delta OI / options analytics where data permits
- Reversal confluence scoring, invalidation, stop-loss logic and targets
- Provider-aware behavior across Indian and global markets
- Final regression, performance and data-consistency validation

## Security
Never commit:
- FYERS App Secret
- access tokens
- refresh tokens
- passwords / PIN / OTP

Use `.env.local` for local credentials.
