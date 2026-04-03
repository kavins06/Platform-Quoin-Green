function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

export function calculateMaximumAlternativeComplianceAmount(input: {
  grossSquareFeet: number;
  penaltyPerSquareFoot: number;
  maxPenaltyCap: number;
}) {
  const rawAmount = Math.max(0, input.grossSquareFeet) * input.penaltyPerSquareFoot;
  const maxAmount = Math.min(rawAmount, input.maxPenaltyCap);

  return {
    formulaKey: "DC_BEPS_CYCLE_1_P_MAX",
    maxAmount,
    rawAmount,
    capApplied: rawAmount > input.maxPenaltyCap,
  };
}

export function calculatePerformancePenaltyAdjustment(input: {
  maxAmount: number;
  achievedReductionFraction: number;
  requiredReductionFraction: number;
}) {
  const penaltyReductionFraction = clampFraction(
    input.achievedReductionFraction / input.requiredReductionFraction,
  );
  const remainingPenaltyFraction = 1 - penaltyReductionFraction;
  const adjustedAmount = Math.round(input.maxAmount * remainingPenaltyFraction);

  return {
    formulaKey: "DC_BEPS_CYCLE_1_PERFORMANCE_ADJUSTMENT",
    penaltyReductionFraction,
    remainingPenaltyFraction,
    adjustedAmount,
  };
}

export function calculatePrescriptivePenaltyAdjustment(input: {
  maxAmount: number;
  pointsEarned: number;
  pointsNeeded: number;
}) {
  const penaltyReductionFraction = clampFraction(input.pointsEarned / input.pointsNeeded);
  const remainingPenaltyFraction = 1 - penaltyReductionFraction;
  const adjustedAmount = Math.round(input.maxAmount * remainingPenaltyFraction);

  return {
    formulaKey: "DC_BEPS_CYCLE_1_PRESCRIPTIVE_ADJUSTMENT",
    penaltyReductionFraction,
    remainingPenaltyFraction,
    adjustedAmount,
  };
}

export function calculateStandardTargetPenaltyAdjustment(input: {
  maxAmount: number;
  initialGap: number;
  maxGap: number;
  achievedSavings: number;
  requiredSavings: number;
}) {
  const step1ReductionFraction = clampFraction(1 - input.initialGap / input.maxGap);
  const step2ReductionFraction = clampFraction(
    input.requiredSavings <= 0 ? 1 : input.achievedSavings / input.requiredSavings,
  );
  const remainingPenaltyFraction =
    (1 - step1ReductionFraction) * (1 - step2ReductionFraction);
  const adjustedAmount = Math.round(input.maxAmount * remainingPenaltyFraction);

  return {
    formulaKey: "DC_BEPS_CYCLE_1_STANDARD_TARGET_ADJUSTMENT",
    step1ReductionFraction,
    step2ReductionFraction,
    remainingPenaltyFraction,
    adjustedAmount,
  };
}

export function calculateAgreementAdjustedAmount(input: {
  maxAmount: number;
  agreementMultiplier: number;
  floorAmount: number;
}) {
  const agreementRemainingPenaltyFraction = clampFraction(input.agreementMultiplier);
  const agreementAmount = Math.round(input.maxAmount * agreementRemainingPenaltyFraction);
  const adjustedAmount = Math.max(agreementAmount, input.floorAmount);

  return {
    formulaKey: "DC_BEPS_CYCLE_1_ALTERNATIVE_COMPLIANCE_AGREEMENT",
    agreementRemainingPenaltyFraction,
    agreementAmount,
    adjustedAmount,
    floorAmount: input.floorAmount,
  };
}

export function calculateTrajectoryPenaltyAdjustment(input: {
  maxAmount: number;
  metTargetYears: number;
  totalTargetYears: number;
  finalTargetMet: boolean;
}) {
  const annualProgressFraction =
    input.totalTargetYears <= 0
      ? 0
      : clampFraction(input.metTargetYears / input.totalTargetYears);
  const remainingPenaltyFraction = input.finalTargetMet ? 0 : 1 - annualProgressFraction;
  const adjustedAmount = Math.round(input.maxAmount * remainingPenaltyFraction);

  return {
    formulaKey: "DC_BEPS_TRAJECTORY_ADJUSTMENT",
    annualProgressFraction,
    remainingPenaltyFraction,
    adjustedAmount,
  };
}
