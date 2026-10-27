# ALLINONEVIEW Engineering Guardrails

These are standing project rules. New work must preserve them unless explicitly
changed by the owner.

## Money-sensitive logic

- Never promote a new trading signal directly from an idea/screenshot to live.
- Research -> historical backtest -> untouched out-of-sample test -> shadow/paper
  mode -> live display -> only then consider influence on trade-taking logic.
- No look-ahead bias. A closed candle may only use itself and older data.
- Entries in backtests occur no earlier than the next candle after confirmation.
- Transaction costs/slippage must be included.
- Provider provenance must remain explicit:
  - Kraken exact trade side where available.
  - FYERS OHLCV/OI as actually supplied.
  - OANDA midpoint OHLC + tick-count activity, never mislabeled exchange volume.
  - Derived/proxy values must be visibly labelled.
- No third-party proprietary algorithm is copied or represented as ours.

## Chart/UI regressions that must not return

Lessons carried forward from AllInOneTradingView Chat 1/2 and the visual fixes:

1. No overlay bleeding into the right price scale.
2. No fixed screen-coordinate market levels. Analytical objects anchor to candle
   time + price and recalculate with pan/zoom.
3. Lines extend only in their intended time direction and terminate by rule.
4. Custom overlays never steal the native crosshair/pointer experience.
5. Search/dropdowns must remain above chart/timeframe controls.
6. Features menus must remain scrollable and closable on desktop/mobile.
7. One shared/throttled chart redraw path; do not add independent redraw loops
   for every overlay.
8. No chart flickering/restoring loops caused by competing effects.
9. Volume/profile panes reserve layout space and never cover controls/price scale.
10. Main MarketChart stays isolated from unrelated dashboard-page experiments.
11. Left navigation overlays the app and is closed by default; it must not resize
    or shift the main chart.
12. Provider-specific code must not silently fall through to FYERS/Kraken/OANDA
    logic for another provider.

## Validation before promotion/merge

For material changes:

1. npm run typecheck
2. npm run build before deployment or major merge
3. npm run db:smoke when schema/database behavior changes
4. Relevant feature-specific test/backtest
5. Browser smoke test of affected page(s)
6. Recheck mobile/responsive behavior for visual work

A successful npm run dev only proves the dev server boots. It is recorded as a
successful runtime smoke check, not as proof that calculations are correct.

## Development validation log rule

Whenever the owner reports a successful local npm/typecheck/build/dev/backtest
run, carry that result forward in the project state before moving on. Do not ask
the owner to repeat already-reported validation output.
