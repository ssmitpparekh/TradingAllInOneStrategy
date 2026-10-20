import type { ChartCandle } from "@/components/MarketChart";
import { buildTechnicalContext } from "./indicators";
import { buildVolumeAnalytics } from "./volume";
import {
  buildReversalEngine,
  type DerivativeConfirmationInput
} from "./confluence";
import { buildSimpleTradePlan } from "./trade-plan";
import { buildReactionTradePlan } from "./reaction-trade";
import {
  buildOpeningConfirmation,
  indianSessionOpenEpoch,
  isIndianOpeningWindow
} from "./opening-confirmation";
import {
  buildFibonacciSetup,
  buildImbalanceLiquiditySnapshot,
  buildMarketStructure,
  buildOrderBlockSnapshot
} from "./market-structure";

export const PLATFORM_STRATEGY_VERSION = "AIOV-1.0.0";

export type PlatformStrategyInput = {
  market: string;
  price: number;
  reactionPrice?: number;
  context4h: ChartCandle[];
  context1h: ChartCandle[];
  context15m: ChartCandle[];
  context5m: ChartCandle[];
  context1m: ChartCandle[];
  derivatives?: DerivativeConfirmationInput | null;
};

export function evaluatePlatformStrategy(
  input: PlatformStrategyInput
) {
  const fastLatestTime =
    input.context1m.at(-1)?.time ??
    input.context5m.at(-1)?.time ??
    null;

  const openingSessionStart =
    fastLatestTime !== null &&
    (input.market === "NSE" || input.market === "BSE") &&
    isIndianOpeningWindow(fastLatestTime)
      ? indianSessionOpenEpoch(fastLatestTime)
      : null;

  const planContext4h =
    openingSessionStart === null
      ? input.context4h
      : (() => {
          const prior = input.context4h.filter(
            (candle) => candle.time < openingSessionStart
          );
          return prior.length >= 30 ? prior : input.context4h;
        })();

  const planContext1h =
    openingSessionStart === null
      ? input.context1h
      : (() => {
          const prior = input.context1h.filter(
            (candle) => candle.time < openingSessionStart
          );
          return prior.length >= 30 ? prior : input.context1h;
        })();

  const htfTechnical = buildTechnicalContext(planContext4h);
  const htfFib = buildFibonacciSetup(planContext4h);
  const htfStructure = buildMarketStructure(planContext4h);
  const refineFib = buildFibonacciSetup(planContext1h);
  const refineImbalance =
    buildImbalanceLiquiditySnapshot(planContext1h);
  const refineOrderBlocks =
    buildOrderBlockSnapshot(planContext1h);
  const refineVolume = buildVolumeAnalytics(planContext1h, {
    timeZone: input.market === "KRAKEN" ? "UTC" : "Asia/Kolkata",
    anchorTime: htfFib.anchorA?.time ?? null
  });

  const confirmation15m = buildMarketStructure(input.context15m);
  const structure5m = buildMarketStructure(input.context5m, {
    confirmationBars: 2
  });
  const structure1m = buildMarketStructure(input.context1m, {
    confirmationBars: 2
  });
  const imbalance5m =
    buildImbalanceLiquiditySnapshot(input.context5m);
  const imbalance1m =
    buildImbalanceLiquiditySnapshot(input.context1m);
  const orderBlocks5m =
    buildOrderBlockSnapshot(input.context5m);

  const reversalEngine = buildReversalEngine({
    price: input.price,
    htfAtr: htfFib.atr14,
    refineAtr: refineFib.atr14,
    htfReady: planContext4h.length >= 30,
    confirmation15mReady: input.context15m.length >= 30,
    fibonacci: htfFib,
    structure: htfStructure,
    imbalance: refineImbalance,
    orderBlocks: refineOrderBlocks,
    volume: refineVolume,
    confirmation15m,
    derivatives: input.derivatives ?? null
  });

  const openingConfirmation = buildOpeningConfirmation({
    market: input.market,
    latestTime: fastLatestTime,
    direction: reversalEngine.selected.direction,
    structure1m,
    structure5m,
    imbalance1m,
    imbalance5m,
    orderBlocks5m
  });

  const simpleTradePlan = buildSimpleTradePlan({
    price: input.price,
    latestTime:
      fastLatestTime ??
      input.context1h.at(-1)?.time ??
      null,
    htfTechnical,
    htfStructure,
    fibonacci: htfFib,
    imbalance: refineImbalance,
    orderBlocks: refineOrderBlocks,
    reversal: reversalEngine.selected,
    refineAtr: refineFib.atr14,
    openingConfirmation,
    confirmation15m
  });

  const reactionImbalance15m =
    buildImbalanceLiquiditySnapshot(input.context15m);
  const reactionFib15m =
    buildFibonacciSetup(input.context15m);
  const reactionTradePlan = buildReactionTradePlan({
    price: input.reactionPrice ?? input.price,
    candles15m: input.context15m,
    imbalance15m: reactionImbalance15m,
    structure15m: confirmation15m,
    primaryPlan: simpleTradePlan,
    atr15m: reactionFib15m.atr14
  });

  return {
    fastLatestTime,
    openingSessionStart,
    planContext4h,
    planContext1h,
    htfTechnical,
    htfFib,
    htfStructure,
    refineFib,
    refineImbalance,
    refineOrderBlocks,
    refineVolume,
    confirmation15m,
    structure5m,
    structure1m,
    imbalance5m,
    imbalance1m,
    orderBlocks5m,
    reversalEngine,
    openingConfirmation,
    simpleTradePlan,
    reactionImbalance15m,
    reactionFib15m,
    reactionTradePlan
  };
}
