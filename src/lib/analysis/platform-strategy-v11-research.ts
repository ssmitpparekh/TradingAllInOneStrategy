import type { TechnicalContext } from "./indicators";
import type { MarketStructureSnapshot } from "./market-structure";
import {
  evaluatePlatformStrategy,
  type PlatformStrategyInput
} from "./platform-strategy";
import { buildSimpleTradePlan } from "./trade-plan";

export const RESEARCH_STRATEGY_V11_VERSION =
  "AIOV-1.1.0-RESEARCH";

type Direction = "bullish" | "bearish";

function technicalDirection(
  technical: TechnicalContext
): Direction | "neutral" {
  if (technical.trendState.includes("bullish")) return "bullish";
  if (technical.trendState.includes("bearish")) return "bearish";
  return "neutral";
}

function neutralTechnical(
  technical: TechnicalContext
): TechnicalContext {
  return {
    ...technical,
    trendState: "neutral"
  };
}

function neutralStructure(
  structure: MarketStructureSnapshot
): MarketStructureSnapshot {
  return {
    ...structure,
    trend: "neutral"
  };
}

export function evaluatePlatformStrategyV11Research(
  input: PlatformStrategyInput
) {
  const base = evaluatePlatformStrategy(input);
  const fibDirection = base.htfFib.direction;
  const technical = technicalDirection(base.htfTechnical);
  const structure = base.htfStructure.trend;

  const fibUsable =
    fibDirection !== "neutral" &&
    base.htfFib.goldenZone !== null;
  const technicalAgrees =
    fibUsable && technical === fibDirection;
  const structureAgrees =
    fibUsable && structure === fibDirection;

  // v1.0 required technical trend, 4H structure, Fib direction and selected
  // reversal direction to all align as hard gates. v1.1 keeps Fib as the
  // actual retracement framework but accepts it when either independent 4H
  // trend evidence OR confirmed 4H structure agrees.
  const researchBiasUsable =
    fibUsable && (technicalAgrees || structureAgrees);

  const htfTechnical =
    researchBiasUsable && !technicalAgrees && structureAgrees
      ? neutralTechnical(base.htfTechnical)
      : base.htfTechnical;

  const htfStructure =
    researchBiasUsable && technicalAgrees && !structureAgrees
      ? neutralStructure(base.htfStructure)
      : base.htfStructure;

  const directionalReversal =
    fibDirection === "bullish"
      ? base.reversalEngine.bullish
      : fibDirection === "bearish"
        ? base.reversalEngine.bearish
        : base.reversalEngine.selected;

  const latestTime =
    input.evaluationTime ??
    base.fastLatestTime ??
    input.context1h.at(-1)?.time ??
    null;
  const event = base.confirmation15m.latestEvent;
  const freshAligned15m =
    researchBiasUsable &&
    event?.direction === fibDirection &&
    latestTime !== null &&
    event.time <= latestTime &&
    latestTime - event.time <= 45 * 60;

  // v1.0's ReversalScore.entryState already embedded score>=75 + 15m
  // confirmation, then buildSimpleTradePlan required the same score again.
  // Research v1.1 makes entryState represent only the fresh structure event;
  // the unchanged score threshold remains enforced once inside trade-plan.
  const researchReversal = {
    ...directionalReversal,
    entryState: freshAligned15m
      ? ("CONFIRMED" as const)
      : directionalReversal.score >= 60
        ? ("CONFIRMING" as const)
        : ("WAIT" as const)
  };

  const simpleTradePlan = buildSimpleTradePlan({
    price: input.price,
    latestTime,
    htfTechnical,
    htfStructure,
    fibonacci: base.htfFib,
    imbalance: base.refineImbalance,
    orderBlocks: base.refineOrderBlocks,
    reversal: researchReversal,
    refineAtr: base.refineFib.atr14,
    openingConfirmation: base.openingConfirmation,
    confirmation15m: base.confirmation15m
  });

  return {
    ...base,
    simpleTradePlan,
    research: {
      version: RESEARCH_STRATEGY_V11_VERSION,
      fibUsable,
      technicalAgrees,
      structureAgrees,
      researchBiasUsable,
      freshAligned15m
    }
  };
}
