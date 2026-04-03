import {
  PortfolioManagerSetupComponentStatus,
  PortfolioManagerSetupStatus,
} from "@/generated/prisma/client";
import { getBuildingProfileMissingInputMessage } from "@/lib/buildings/property-use-profile";

export function getPortfolioManagerSetupMissingInputMessage(code: string) {
  if (code.startsWith("BUILDING_PROFILE_")) {
    return getBuildingProfileMissingInputMessage(code);
  }

  switch (code) {
    case "PM_LINKAGE_REQUIRED":
      return "Available after Portfolio Manager linkage.";
    case "PM_SETUP_OTHER_UNSUPPORTED":
      return "This building type needs manual PM setup review.";
    case "PM_SETUP_OFFICE_OCCUPANCY_REVIEW_REQUIRED":
      return "Low occupancy needs manual PM setup review.";
    case "PM_SETUP_OFFICE_ROW_REQUIRED":
      return "Office setup details are still required.";
    case "PM_SETUP_MULTIFAMILY_ROW_REQUIRED":
      return "Multifamily setup details are still required.";
    case "PM_SETUP_MIXED_USE_BREAKDOWN_REQUIRED":
      return "Mixed-use breakdown is still required.";
    case "PM_SETUP_COMPONENT_AREA_TOTAL_MISMATCH":
      return "Mixed-use area must match the building GSF.";
    case "PM_SETUP_INVALID_SINGLE_USE_CONFIGURATION":
      return "The saved PM setup structure is invalid.";
    case "PM_SETUP_COMPONENT_NAME_REQUIRED":
      return "Each PM use row needs a name.";
    case "PM_SETUP_OFFICE_HOURS_REQUIRED":
      return "Office weekly hours are required.";
    case "PM_SETUP_OFFICE_WORKERS_REQUIRED":
      return "Office workers on main shift are required.";
    case "PM_SETUP_OFFICE_COMPUTERS_REQUIRED":
      return "Office computer count is required.";
    case "PM_SETUP_MULTIFAMILY_UNITS_REQUIRED":
      return "Residential unit count is required.";
    case "PM_SETUP_MULTIFAMILY_BEDROOMS_REQUIRED":
      return "Bedroom count is required.";
    case "PM_SETUP_REMOTE_CONFLICT":
      return "Existing PM property uses need review before setup can be applied.";
    case "PM_SETUP_REMOTE_TYPE_CONFLICT":
      return "Saved PM setup does not match the remote property-use structure.";
    case "PM_METER_SETUP_REQUIRED":
      return "Meters still need to be selected or linked.";
    case "PM_METER_ASSOCIATIONS_REQUIRED":
      return "Linked meters still need property associations.";
    case "PM_METER_UNSUPPORTED":
      return "At least one meter needs manual PM review.";
    case "PM_METER_REMOTE_CONFLICT":
      return "Existing PM meter state needs review before setup can continue.";
    case "PM_METER_REMOTE_ACCESS_INCOMPLETE":
      return "Portfolio Manager meter access is incomplete. Share the supported property meters Quoin should import before continuing.";
    default:
      return "Portfolio Manager setup needs additional input.";
  }
}

export function derivePortfolioManagerSetupSummary(input: {
  status: PortfolioManagerSetupStatus;
  propertyUsesStatus: PortfolioManagerSetupComponentStatus;
  metersStatus: PortfolioManagerSetupComponentStatus;
  associationsStatus: PortfolioManagerSetupComponentStatus;
  usageCoverageStatus: PortfolioManagerSetupComponentStatus;
  usageCoverageDetail?: string | null;
  metricsStatus?: string | null;
  missingInputCodes: string[];
  latestErrorMessage?: string | null;
}) {
  const needsAttention =
    input.status === "NEEDS_ATTENTION" ||
    input.propertyUsesStatus === "NEEDS_ATTENTION" ||
    input.metersStatus === "NEEDS_ATTENTION" ||
    input.associationsStatus === "NEEDS_ATTENTION" ||
    input.usageCoverageStatus === "NEEDS_ATTENTION";

  const readyForNextStep =
    input.propertyUsesStatus === "APPLIED" &&
    input.metersStatus === "APPLIED" &&
    input.associationsStatus === "APPLIED" &&
    input.usageCoverageStatus === "NOT_STARTED";
  const benchmarkReady =
    input.propertyUsesStatus === "APPLIED" &&
    input.metersStatus === "APPLIED" &&
    input.associationsStatus === "APPLIED" &&
    input.usageCoverageStatus === "APPLIED" &&
    input.metricsStatus === "SUCCEEDED";

  let summaryLine =
    input.latestErrorMessage ??
    input.usageCoverageDetail ??
    (input.missingInputCodes[0]
      ? getPortfolioManagerSetupMissingInputMessage(input.missingInputCodes[0])
      : null);

  if (!summaryLine) {
    if (input.propertyUsesStatus !== "APPLIED") {
      summaryLine = "Property-use setup is still incomplete.";
    } else if (input.metersStatus !== "APPLIED") {
      summaryLine = "Property uses are applied. Continue with meter setup next.";
    } else if (input.associationsStatus !== "APPLIED") {
      summaryLine = "Meters are linked. Continue with property associations next.";
    } else if (readyForNextStep) {
      summaryLine =
        "Property uses, meters, and associations are ready. Usage coverage comes next.";
    } else if (input.usageCoverageStatus !== "APPLIED") {
      summaryLine = "Usage coverage is still incomplete.";
    } else if (input.metricsStatus === "RUNNING" || input.metricsStatus === "QUEUED") {
      summaryLine = "Refreshing Portfolio Manager metrics.";
    } else if (benchmarkReady) {
      summaryLine = "Usage and Portfolio Manager metrics are ready for benchmark operations.";
    } else if (input.metricsStatus === "PARTIAL") {
      summaryLine =
        "Usage coverage is ready. Portfolio Manager metrics are only partially available.";
    } else if (input.metricsStatus === "FAILED") {
      summaryLine = "Portfolio Manager metrics refresh failed and needs review.";
    } else {
      summaryLine = "Usage coverage is ready for Portfolio Manager metrics.";
    }
  }

  return {
    summaryState: needsAttention
      ? ("NEEDS_ATTENTION" as const)
      : benchmarkReady
        ? ("BENCHMARK_READY" as const)
      : readyForNextStep
        ? ("READY_FOR_NEXT_STEP" as const)
        : ("SETUP_INCOMPLETE" as const),
    summaryLine,
  };
}

export function derivePortfolioManagerOverallSetupStatus(input: {
  propertyUsesStatus: PortfolioManagerSetupComponentStatus;
  metersStatus: PortfolioManagerSetupComponentStatus;
  associationsStatus: PortfolioManagerSetupComponentStatus;
  usageCoverageStatus: PortfolioManagerSetupComponentStatus;
}) {
  if (
    input.propertyUsesStatus === "NEEDS_ATTENTION" ||
    input.metersStatus === "NEEDS_ATTENTION" ||
    input.associationsStatus === "NEEDS_ATTENTION" ||
    input.usageCoverageStatus === "NEEDS_ATTENTION"
  ) {
    return PortfolioManagerSetupStatus.NEEDS_ATTENTION;
  }

  if (
    input.propertyUsesStatus === "APPLIED" &&
    input.metersStatus === "APPLIED" &&
    input.associationsStatus === "APPLIED" &&
    (input.usageCoverageStatus === "NOT_STARTED" ||
      input.usageCoverageStatus === "APPLIED")
  ) {
    return PortfolioManagerSetupStatus.APPLIED;
  }

  if (
    input.propertyUsesStatus === "READY_TO_APPLY" ||
    input.metersStatus === "READY_TO_APPLY" ||
    input.associationsStatus === "READY_TO_APPLY" ||
    input.usageCoverageStatus === "READY_TO_APPLY"
  ) {
    return PortfolioManagerSetupStatus.READY_TO_APPLY;
  }

  if (
    input.propertyUsesStatus === "INPUT_REQUIRED" ||
    input.metersStatus === "INPUT_REQUIRED" ||
    input.associationsStatus === "INPUT_REQUIRED" ||
    input.usageCoverageStatus === "INPUT_REQUIRED"
  ) {
    return PortfolioManagerSetupStatus.INPUT_REQUIRED;
  }

  return PortfolioManagerSetupStatus.NOT_STARTED;
}
