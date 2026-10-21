# ALLINONEVIEW Smart Flow — Research & Promotion Policy

This feature is **research-only until explicitly promoted**. It must not be imported
into the live chart, scanner, alerts or trade-plan engine before the gates below pass.

## Goal

Create an original, transparent flow/trend indicator using only data we legally
receive from FYERS, Kraken and OANDA. Do not reproduce or reverse-engineer any
third-party proprietary formula.

## Data rules

1. Signals use only the current **closed** candle and older candles.
2. A signal generated on candle T can enter no earlier than candle T+1 open.
3. No future candle may affect rolling normalization, EMA, ATR, thresholds or
   signal state.
4. FYERS/Kraken volume is treated as exchange/provider trade volume.
5. OANDA candle volume is tick/price-count activity and is down-weighted; it is
   never described as centralized exchange volume.
6. Backtests must include transaction cost + slippage assumptions.
7. Delisted/survivorship-safe universes are preferable; where point-in-time
   constituents are unavailable, the report must clearly say so.

## Candidate v1 calculation

Research parameters start from:
- range = 70
- flow smoothing length = 10
- threshold factor = 1.2
- fast EMA = 10
- slow EMA = 30

Closed-candle pressure:
- Close Location Value (CLV): close near high -> positive; close near low -> negative.
- Candle body pressure: (close - open) / (high - low).
- Relative activity: current volume/tick-count versus EMA(volume, length).
- Smoothed pressure is normalized against its own rolling range window.
- Trend confirmation uses fast-vs-slow EMA distance normalized by ATR.
- Composite = 70% normalized flow + 30% normalized trend.
- BULL requires composite >= factor, fast EMA > slow EMA, close >= fast EMA.
- BEAR is the exact mirror.

This is deliberately explainable and independent of any proprietary indicator.

## Backtest protocol

### Parameter grid
Use one shared grid across markets, not per-symbol optimization:
- range: 50, 70, 90
- length: 8, 10, 14
- factor: 1.0, 1.2, 1.4

The EMA pair remains fixed at 10/30 for v1.

### Chronological split
For every symbol/timeframe:
- first 60% = development/train
- next 20% = validation
- final 20% = untouched test

Select at most one global parameter set using validation aggregate results.
Never choose separate "best" parameters for each instrument.

### Trade simulation
- signal appears after candle close
- entry = next candle open
- exit = next opposite confirmed signal, or end of test window
- long return = (exit-entry)/entry
- short return = (entry-exit)/entry
- subtract round-trip costs and slippage

Also record forward directional returns after 1, 3, 6 and 12 bars.

### Required output
Per market, timeframe and symbol:
- signal count
- win rate
- average and median net return
- expectancy
- profit factor
- maximum drawdown
- average favorable/adverse excursion
- 1/3/6/12-bar directional accuracy
- long/short split
- parameter stability

Aggregate results must also show contribution concentration so one exceptional
symbol cannot make a weak model look good.

## Promotion gates

The live indicator is blocked unless all are true on the untouched test set:

1. No look-ahead/invariant test failures.
2. At least 200 aggregate completed signals, with representation from multiple
   markets/timeframes.
3. Positive net expectancy after costs.
4. Aggregate profit factor >= 1.20.
5. Median symbol/timeframe expectancy is non-negative.
6. No single symbol contributes > 30% of aggregate net profit.
7. Adjacent parameter sets remain broadly profitable (anti-overfit check).
8. Long and short logic both function; neither side may silently dominate due
   to a coding error.
9. Candle-close replay produces the same signals as batch calculation.
10. Paper-trading/shadow mode is completed before the feature can influence
    the core trade-taking strategy.

If the model fails, it stays research-only and is revised or discarded.

## UI safety rules after promotion

- Separate route/component first; do not modify MarketChart overlays until logic is proven.
- All drawings anchor to candle time + price, never fixed screen coordinates.
- Closed by default.
- No labels/objects may bleed into price scale.
- No overlay may steal crosshair/pointer behavior.
- No per-overlay redraw listeners; use a shared throttled redraw model.
- Provider provenance must be visible.
- "Exact", "derived", "tick-volume" and "proxy" data must never be conflated.
