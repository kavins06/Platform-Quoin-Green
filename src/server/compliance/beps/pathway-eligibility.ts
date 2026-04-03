import { resolvePathwayRoutingConfig } from "./config";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsApplicabilityResult,
  BepsBuildingInput,
  BepsFactorConfig,
  BepsFinding,
  BepsPathwayEligibilityResult,
  BepsPathwayType,
  BepsRuleConfig,
  BepsSnapshotInput,
} from "./types";

function determineApplicablePathway(
  currentScore: number | null,
  bepsTargetScore: number,
  performanceScoreThreshold: number,
): "COMPLIANT" | "STANDARD_TARGET" | "PERFORMANCE" | "PENDING_DATA" {
  if (currentScore === null) {
    return "PENDING_DATA";
  }

  if (currentScore >= bepsTargetScore) {
    return "COMPLIANT";
  }

  if (currentScore > performanceScoreThreshold) {
    return "STANDARD_TARGET";
  }

  return "PERFORMANCE";
}

export function evaluateBepsPathwayEligibility(input: {
  applicability: BepsApplicabilityResult;
  building: BepsBuildingInput;
  snapshot: BepsSnapshotInput | null;
  isEnergyStarScoreEligible?: boolean | null;
  currentScore?: number | null;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}): BepsPathwayEligibilityResult {
  const findings: BepsFinding[] = [];
  const routingConfig = resolvePathwayRoutingConfig(
    input.applicability.cycle,
    input.ruleConfig ?? {},
    input.factorConfig ?? {},
  );
  const supportedPathways = routingConfig.supportedPathways;
  const eligiblePathways: BepsPathwayType[] = [];

  findings.push({
    code: BEPS_REASON_CODES.supportedPathwaysIdentified,
    status: "PASS",
    severity: "INFO",
    message: "Supported BEPS pathways were identified from the active rule package.",
    metadata: {
      supportedPathways,
    },
  });

  if (!input.applicability.applicable) {
    findings.push({
      code: BEPS_REASON_CODES.noEligiblePathways,
      status: "FAIL",
      severity: "ERROR",
      message: "No BEPS pathways are eligible because the building is not applicable for this cycle.",
    });

    return {
      supportedPathways,
      eligiblePathways,
      preferredPathway: null,
      reasonCodes: [BEPS_REASON_CODES.noEligiblePathways],
      findings,
    };
  }

  if (input.isEnergyStarScoreEligible === false) {
    if (supportedPathways.includes("PERFORMANCE")) {
      eligiblePathways.push("PERFORMANCE");
    }
    if (supportedPathways.includes("STANDARD_TARGET")) {
      eligiblePathways.push("STANDARD_TARGET");
    }
    findings.push({
      code: BEPS_REASON_CODES.supportedPathwaysIdentified,
      status: "PASS",
      severity: "INFO",
      message:
        "Building is treated as non-score-eligible, so performance and standard target remain available without score-based routing.",
    });
    if (
      routingConfig.prescriptiveAlwaysEligible &&
      supportedPathways.includes("PRESCRIPTIVE")
    ) {
      eligiblePathways.push("PRESCRIPTIVE");
      findings.push({
        code: BEPS_REASON_CODES.prescriptivePathwayEligible,
        status: "PASS",
        severity: "INFO",
        message: "Prescriptive pathway is available as an alternative compliance pathway.",
      });
    }

    if (supportedPathways.includes("TRAJECTORY")) {
      eligiblePathways.push("TRAJECTORY");
      findings.push({
        code: BEPS_REASON_CODES.trajectoryPathwayEligible,
        status: "PASS",
        severity: "INFO",
        message: "Trajectory pathway is available for this cycle and property type.",
      });
    }

    return {
      supportedPathways,
      eligiblePathways,
      preferredPathway:
        routingConfig.preferredPathway && eligiblePathways.includes(routingConfig.preferredPathway)
          ? routingConfig.preferredPathway
          : eligiblePathways.includes("TRAJECTORY")
            ? "TRAJECTORY"
            : null,
      reasonCodes: findings
        .filter((finding) => finding.status === "FAIL")
        .map((finding) => finding.code),
      findings,
    };
  }

  const currentScore = input.currentScore ?? input.snapshot?.energyStarScore ?? null;
  const preferredRoute =
    currentScore == null
      ? "PENDING_DATA"
      : determineApplicablePathway(
          currentScore,
          input.building.bepsTargetScore,
          routingConfig.performanceScoreThreshold,
        );

  let preferredPathway: BepsPathwayType | null = null;

  if (preferredRoute === "PENDING_DATA") {
    findings.push({
      code: BEPS_REASON_CODES.missingCurrentScoreForRouting,
      status: "FAIL",
      severity: "ERROR",
      message: "Current ENERGY STAR score is missing, so score-based pathway routing cannot be determined.",
    });
  } else if (preferredRoute === "COMPLIANT") {
    findings.push({
      code: BEPS_REASON_CODES.alreadyCompliantByScore,
      status: "PASS",
      severity: "INFO",
      message: "Current score already meets the BEPS target score.",
      metadata: {
        currentScore,
        targetScore: input.building.bepsTargetScore,
      },
    });
  } else if (preferredRoute === "PERFORMANCE") {
    eligiblePathways.push("PERFORMANCE");
    preferredPathway = "PERFORMANCE";
    findings.push({
      code: BEPS_REASON_CODES.performancePathwayEligible,
      status: "PASS",
      severity: "INFO",
      message: "Performance pathway is eligible based on current score routing.",
      metadata: {
        currentScore,
        thresholdScore: routingConfig.performanceScoreThreshold,
      },
    });
    findings.push({
      code: BEPS_REASON_CODES.standardTargetPathwayIneligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Standard target pathway is not the routed score-based pathway for this building.",
      metadata: {
        currentScore,
        thresholdScore: routingConfig.performanceScoreThreshold,
      },
    });
  } else if (preferredRoute === "STANDARD_TARGET") {
    eligiblePathways.push("STANDARD_TARGET");
    preferredPathway = "STANDARD_TARGET";
    findings.push({
      code: BEPS_REASON_CODES.standardTargetPathwayEligible,
      status: "PASS",
      severity: "INFO",
      message: "Standard target pathway is eligible based on current score routing.",
      metadata: {
        currentScore,
        thresholdScore: routingConfig.performanceScoreThreshold,
      },
    });
    findings.push({
      code: BEPS_REASON_CODES.performancePathwayIneligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Performance pathway is not the routed score-based pathway for this building.",
      metadata: {
        currentScore,
        thresholdScore: routingConfig.performanceScoreThreshold,
      },
    });
  }

  if (
    routingConfig.prescriptiveAlwaysEligible &&
    supportedPathways.includes("PRESCRIPTIVE")
  ) {
    eligiblePathways.push("PRESCRIPTIVE");
    findings.push({
      code: BEPS_REASON_CODES.prescriptivePathwayEligible,
      status: "PASS",
      severity: "INFO",
      message: "Prescriptive pathway is available as an alternative compliance pathway.",
    });
  }

  if (supportedPathways.includes("TRAJECTORY")) {
    eligiblePathways.push("TRAJECTORY");
    findings.push({
      code: BEPS_REASON_CODES.trajectoryPathwayEligible,
      status: "PASS",
      severity: "INFO",
      message: "Trajectory pathway is available for this cycle and property type.",
    });
  }

  if (
    routingConfig.preferredPathway &&
    eligiblePathways.includes(routingConfig.preferredPathway)
  ) {
    preferredPathway = routingConfig.preferredPathway;
  } else if (!preferredPathway && eligiblePathways.includes("TRAJECTORY")) {
    preferredPathway = "TRAJECTORY";
  }

  return {
    supportedPathways,
    eligiblePathways,
    preferredPathway,
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
  };
}
