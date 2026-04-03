import type { EnergyUnit, MeterType } from "@/generated/prisma/client";

export type PortfolioManagerUnitCompatibilityStatus =
  | "EXACT"
  | "SUPPORTED_CONVERSION"
  | "UNSUPPORTED";

export type PortfolioManagerRemoteMeterDefinition = {
  meterType: MeterType;
  rawType: string;
  rawUnitOfMeasure: string;
  remoteUnitKey: string;
  kbtuPerUnit: number;
  preferredLocalUnit: EnergyUnit;
  exactLocalUnit: EnergyUnit | null;
};

export type PortfolioManagerUnitCompatibility = {
  status: PortfolioManagerUnitCompatibilityStatus;
  reason: string | null;
  remote: PortfolioManagerRemoteMeterDefinition | null;
};

type MeterCreationDefinition = {
  rawType: string;
  rawUnitOfMeasure: string;
};

const PM_METER_TYPE_LABELS: Partial<Record<MeterType, string>> = {
  ELECTRIC: "Electric",
  GAS: "Natural Gas",
  STEAM: "District Steam",
  WATER_INDOOR: "Potable Indoor Meter",
  WATER_OUTDOOR: "Potable Outdoor Meter",
  WATER_RECYCLED: "Recycled Water Meter",
};

const LOCAL_KBTU_FACTORS: Record<MeterType, Partial<Record<EnergyUnit, number>>> = {
  ELECTRIC: {
    KWH: 3.412,
    KBTU: 1,
    MMBTU: 1000,
  },
  GAS: {
    THERMS: 100,
    KBTU: 1,
    MMBTU: 1000,
  },
  STEAM: {
    THERMS: 100,
    KBTU: 1,
    MMBTU: 1000,
  },
  WATER_INDOOR: {},
  WATER_OUTDOOR: {},
  WATER_RECYCLED: {},
  OTHER: {},
};

const REMOTE_UNIT_DEFINITIONS: Record<string, Omit<PortfolioManagerRemoteMeterDefinition, "rawType" | "rawUnitOfMeasure">> = {
  "ELECTRIC:kwh": {
    meterType: "ELECTRIC",
    remoteUnitKey: "kwh",
    kbtuPerUnit: 3.412,
    preferredLocalUnit: "KWH",
    exactLocalUnit: "KWH",
  },
  "ELECTRIC:mwh": {
    meterType: "ELECTRIC",
    remoteUnitKey: "mwh",
    kbtuPerUnit: 3412,
    preferredLocalUnit: "KWH",
    exactLocalUnit: null,
  },
  "ELECTRIC:kbtu": {
    meterType: "ELECTRIC",
    remoteUnitKey: "kbtu",
    kbtuPerUnit: 1,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: "KBTU",
  },
  "ELECTRIC:mmbtu": {
    meterType: "ELECTRIC",
    remoteUnitKey: "mmbtu",
    kbtuPerUnit: 1000,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: "MMBTU",
  },
  "ELECTRIC:gj": {
    meterType: "ELECTRIC",
    remoteUnitKey: "gj",
    kbtuPerUnit: 947.817,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: null,
  },
  "GAS:therms": {
    meterType: "GAS",
    remoteUnitKey: "therms",
    kbtuPerUnit: 100,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: "THERMS",
  },
  "GAS:cf": {
    meterType: "GAS",
    remoteUnitKey: "cf",
    kbtuPerUnit: 1.026,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: null,
  },
  "GAS:ccf": {
    meterType: "GAS",
    remoteUnitKey: "ccf",
    kbtuPerUnit: 102.6,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: null,
  },
  "GAS:kcf": {
    meterType: "GAS",
    remoteUnitKey: "kcf",
    kbtuPerUnit: 1026,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: null,
  },
  "GAS:mcf": {
    meterType: "GAS",
    remoteUnitKey: "mcf",
    kbtuPerUnit: 1_026_000,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: null,
  },
  "GAS:kbtu": {
    meterType: "GAS",
    remoteUnitKey: "kbtu",
    kbtuPerUnit: 1,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: "KBTU",
  },
  "GAS:mmbtu": {
    meterType: "GAS",
    remoteUnitKey: "mmbtu",
    kbtuPerUnit: 1000,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: "MMBTU",
  },
  "GAS:gj": {
    meterType: "GAS",
    remoteUnitKey: "gj",
    kbtuPerUnit: 947.817,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: null,
  },
  "STEAM:lbs": {
    meterType: "STEAM",
    remoteUnitKey: "lbs",
    kbtuPerUnit: 1.194,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: null,
  },
  "STEAM:klbs": {
    meterType: "STEAM",
    remoteUnitKey: "klbs",
    kbtuPerUnit: 1194,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: null,
  },
  "STEAM:mlbs": {
    meterType: "STEAM",
    remoteUnitKey: "mlbs",
    kbtuPerUnit: 1_194_000,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: null,
  },
  "STEAM:therms": {
    meterType: "STEAM",
    remoteUnitKey: "therms",
    kbtuPerUnit: 100,
    preferredLocalUnit: "THERMS",
    exactLocalUnit: "THERMS",
  },
  "STEAM:kbtu": {
    meterType: "STEAM",
    remoteUnitKey: "kbtu",
    kbtuPerUnit: 1,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: "KBTU",
  },
  "STEAM:mmbtu": {
    meterType: "STEAM",
    remoteUnitKey: "mmbtu",
    kbtuPerUnit: 1000,
    preferredLocalUnit: "MMBTU",
    exactLocalUnit: "MMBTU",
  },
  "STEAM:gj": {
    meterType: "STEAM",
    remoteUnitKey: "gj",
    kbtuPerUnit: 947.817,
    preferredLocalUnit: "KBTU",
    exactLocalUnit: null,
  },
  "WATER_INDOOR:gal": {
    meterType: "WATER_INDOOR",
    remoteUnitKey: "gal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "GAL",
    exactLocalUnit: "GAL",
  },
  "WATER_INDOOR:kgal": {
    meterType: "WATER_INDOOR",
    remoteUnitKey: "kgal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "KGAL",
    exactLocalUnit: "KGAL",
  },
  "WATER_INDOOR:ccf": {
    meterType: "WATER_INDOOR",
    remoteUnitKey: "ccf",
    kbtuPerUnit: 0,
    preferredLocalUnit: "CCF",
    exactLocalUnit: "CCF",
  },
  "WATER_OUTDOOR:gal": {
    meterType: "WATER_OUTDOOR",
    remoteUnitKey: "gal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "GAL",
    exactLocalUnit: "GAL",
  },
  "WATER_OUTDOOR:kgal": {
    meterType: "WATER_OUTDOOR",
    remoteUnitKey: "kgal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "KGAL",
    exactLocalUnit: "KGAL",
  },
  "WATER_OUTDOOR:ccf": {
    meterType: "WATER_OUTDOOR",
    remoteUnitKey: "ccf",
    kbtuPerUnit: 0,
    preferredLocalUnit: "CCF",
    exactLocalUnit: "CCF",
  },
  "WATER_RECYCLED:gal": {
    meterType: "WATER_RECYCLED",
    remoteUnitKey: "gal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "GAL",
    exactLocalUnit: "GAL",
  },
  "WATER_RECYCLED:kgal": {
    meterType: "WATER_RECYCLED",
    remoteUnitKey: "kgal",
    kbtuPerUnit: 0,
    preferredLocalUnit: "KGAL",
    exactLocalUnit: "KGAL",
  },
  "WATER_RECYCLED:ccf": {
    meterType: "WATER_RECYCLED",
    remoteUnitKey: "ccf",
    kbtuPerUnit: 0,
    preferredLocalUnit: "CCF",
    exactLocalUnit: "CCF",
  },
};

const CREATION_DEFINITIONS: Record<string, MeterCreationDefinition> = {
  "ELECTRIC:KWH": {
    rawType: "Electric",
    rawUnitOfMeasure: "kWh (thousand Watt-hours)",
  },
  "ELECTRIC:KBTU": {
    rawType: "Electric",
    rawUnitOfMeasure: "kBtu (thousand Btu)",
  },
  "ELECTRIC:MMBTU": {
    rawType: "Electric",
    rawUnitOfMeasure: "MBtu (million Btu)",
  },
  "GAS:THERMS": {
    rawType: "Natural Gas",
    rawUnitOfMeasure: "therms",
  },
  "GAS:KBTU": {
    rawType: "Natural Gas",
    rawUnitOfMeasure: "kBtu (thousand Btu)",
  },
  "GAS:MMBTU": {
    rawType: "Natural Gas",
    rawUnitOfMeasure: "MBtu (million Btu)",
  },
  "STEAM:THERMS": {
    rawType: "District Steam",
    rawUnitOfMeasure: "therms",
  },
  "STEAM:KBTU": {
    rawType: "District Steam",
    rawUnitOfMeasure: "kBtu (thousand Btu)",
  },
  "STEAM:MMBTU": {
    rawType: "District Steam",
    rawUnitOfMeasure: "MBtu (million Btu)",
  },
  "WATER_INDOOR:GAL": {
    rawType: "Potable Indoor Meter",
    rawUnitOfMeasure: "Gallons (US)",
  },
  "WATER_INDOOR:KGAL": {
    rawType: "Potable Indoor Meter",
    rawUnitOfMeasure: "kGal (thousand gallons) (US)",
  },
  "WATER_INDOOR:CCF": {
    rawType: "Potable Indoor Meter",
    rawUnitOfMeasure: "CCF (hundred cubic feet)",
  },
  "WATER_OUTDOOR:GAL": {
    rawType: "Potable Outdoor Meter",
    rawUnitOfMeasure: "Gallons (US)",
  },
  "WATER_OUTDOOR:KGAL": {
    rawType: "Potable Outdoor Meter",
    rawUnitOfMeasure: "kGal (thousand gallons) (US)",
  },
  "WATER_OUTDOOR:CCF": {
    rawType: "Potable Outdoor Meter",
    rawUnitOfMeasure: "CCF (hundred cubic feet)",
  },
  "WATER_RECYCLED:GAL": {
    rawType: "Recycled Water Meter",
    rawUnitOfMeasure: "Gallons (US)",
  },
  "WATER_RECYCLED:KGAL": {
    rawType: "Recycled Water Meter",
    rawUnitOfMeasure: "kGal (thousand gallons) (US)",
  },
  "WATER_RECYCLED:CCF": {
    rawType: "Recycled Water Meter",
    rawUnitOfMeasure: "CCF (hundred cubic feet)",
  },
};

const WATER_VOLUME_CONVERSIONS: Record<EnergyUnit, number> = {
  GAL: 1,
  KGAL: 1000,
  CCF: 748.052,
  KWH: 0,
  THERMS: 0,
  KBTU: 0,
  MMBTU: 0,
};

export function isBenchmarkEnergyMeterType(meterType: MeterType) {
  return meterType === "ELECTRIC" || meterType === "GAS" || meterType === "STEAM";
}

export function isWaterMeterType(meterType: MeterType) {
  return (
    meterType === "WATER_INDOOR" ||
    meterType === "WATER_OUTDOOR" ||
    meterType === "WATER_RECYCLED"
  );
}

function normalizeRemoteUnitToken(rawUnit: string | null): string | null {
  const normalized = (rawUnit ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("mmbtu") || normalized.includes("mbtu") || normalized.includes("million btu")) {
    return "mmbtu";
  }
  if (/\bkwh\b/.test(normalized) || normalized.includes("kilowatt")) {
    return "kwh";
  }
  if (/\bmwh\b/.test(normalized) || normalized.includes("megawatt")) {
    return "mwh";
  }
  if (/\btherms?\b/.test(normalized)) {
    return "therms";
  }
  if (/\bkbtu\b/.test(normalized) || normalized.includes("thousand btu")) {
    return "kbtu";
  }
  if (/\bgj\b/.test(normalized) || normalized.includes("gigajoule")) {
    return "gj";
  }
  if (/\bmlbs?\b/.test(normalized) || normalized.includes("million lbs") || normalized.includes("million pounds")) {
    return "mlbs";
  }
  if (/\bklbs?\b/.test(normalized) || normalized.includes("thousand lbs") || normalized.includes("thousand pounds")) {
    return "klbs";
  }
  if (/\blbs?\b/.test(normalized) || normalized.includes("pound")) {
    return "lbs";
  }
  if (/\bkcf\b/.test(normalized)) {
    return "kcf";
  }
  if (/\bmcf\b/.test(normalized)) {
    return "mcf";
  }
  if (/\bccf\b/.test(normalized) || /\bhcf\b/.test(normalized)) {
    return "ccf";
  }
  if (
    /\bkgal\b/.test(normalized) ||
    normalized.includes("thousand gallon") ||
    normalized.includes("1000 gallon")
  ) {
    return "kgal";
  }
  if (
    /\bgal\b/.test(normalized) ||
    normalized.includes("gallon")
  ) {
    return "gal";
  }
  if (/\bcf\b/.test(normalized) || normalized.includes("cubic feet")) {
    return "cf";
  }

  return null;
}

export function mapRawEspmMeterType(rawType: string | null): MeterType {
  const normalized = (rawType ?? "").trim().toLowerCase();
  if (
    normalized.includes("potable indoor") ||
    (normalized.includes("potable water") && normalized.includes("indoor"))
  ) {
    return "WATER_INDOOR";
  }
  if (
    normalized.includes("potable outdoor") ||
    (normalized.includes("potable water") && normalized.includes("outdoor"))
  ) {
    return "WATER_OUTDOOR";
  }
  if (normalized.includes("reclaimed water") || normalized.includes("recycled water")) {
    return "WATER_RECYCLED";
  }
  if (normalized.includes("electric")) {
    return "ELECTRIC";
  }
  if (normalized.includes("gas")) {
    return "GAS";
  }
  if (normalized.includes("steam")) {
    return "STEAM";
  }
  return "OTHER";
}

export function defaultLocalUnitForMeterType(meterType: MeterType): EnergyUnit {
  switch (meterType) {
    case "ELECTRIC":
      return "KWH";
    case "GAS":
      return "THERMS";
    case "STEAM":
      return "MMBTU";
    case "WATER_INDOOR":
    case "WATER_OUTDOOR":
    case "WATER_RECYCLED":
      return "GAL";
    default:
      return "KBTU";
  }
}

export function getLocalKbtuFactorForMeter(
  meterType: MeterType,
  localUnit: EnergyUnit,
): number | null {
  return LOCAL_KBTU_FACTORS[meterType][localUnit] ?? null;
}

export function getPortfolioManagerRemoteMeterDefinition(input: {
  rawType: string | null;
  rawUnitOfMeasure: string | null;
}): PortfolioManagerRemoteMeterDefinition | null {
  const meterType = mapRawEspmMeterType(input.rawType);
  if (meterType === "OTHER") {
    return null;
  }

  const token = normalizeRemoteUnitToken(input.rawUnitOfMeasure);
  if (!token) {
    return null;
  }

  const definition = REMOTE_UNIT_DEFINITIONS[`${meterType}:${token}`];
  if (!definition) {
    return null;
  }

  return {
    ...definition,
    rawType: input.rawType ?? PM_METER_TYPE_LABELS[meterType] ?? "Unknown",
    rawUnitOfMeasure: input.rawUnitOfMeasure ?? token,
  };
}

export function classifyPortfolioManagerUnitCompatibility(input: {
  localMeterType: MeterType;
  localUnit: EnergyUnit;
  rawRemoteType: string | null;
  rawRemoteUnitOfMeasure: string | null;
}): PortfolioManagerUnitCompatibility {
  const remote = getPortfolioManagerRemoteMeterDefinition({
    rawType: input.rawRemoteType,
    rawUnitOfMeasure: input.rawRemoteUnitOfMeasure,
  });

  if (!remote) {
    const remoteType = mapRawEspmMeterType(input.rawRemoteType);
    return {
      status: "UNSUPPORTED",
      reason:
        remoteType === "OTHER"
          ? "This PM meter type is not supported for safe linkage in Quoin."
          : "This PM meter unit cannot be converted safely in Quoin.",
      remote: null,
    };
  }

  if (remote.meterType !== input.localMeterType) {
    return {
      status: "UNSUPPORTED",
      reason: "The PM meter type does not match the local Quoin meter type.",
      remote,
    };
  }

  if (isWaterMeterType(input.localMeterType)) {
    if (!isWaterMeterType(remote.meterType)) {
      return {
        status: "UNSUPPORTED",
        reason: "The PM meter type does not match the local Quoin meter type.",
        remote,
      };
    }

    const localFactor = WATER_VOLUME_CONVERSIONS[input.localUnit];
    if (!localFactor) {
      return {
        status: "UNSUPPORTED",
        reason: "The local Quoin water meter unit cannot be converted safely for Portfolio Manager.",
        remote,
      };
    }

    if (remote.exactLocalUnit === input.localUnit) {
      return {
        status: "EXACT",
        reason: null,
        remote,
      };
    }

    return {
      status: "SUPPORTED_CONVERSION",
      reason: null,
      remote,
    };
  }

  const localFactor = getLocalKbtuFactorForMeter(input.localMeterType, input.localUnit);
  if (localFactor == null) {
    return {
      status: "UNSUPPORTED",
      reason: "The local Quoin meter unit cannot be converted safely for Portfolio Manager.",
      remote,
    };
  }

  if (remote.exactLocalUnit === input.localUnit) {
    return {
      status: "EXACT",
      reason: null,
      remote,
    };
  }

  return {
    status: "SUPPORTED_CONVERSION",
    reason: null,
    remote,
  };
}

export function convertRemoteUsageToLocalUsage(input: {
  localMeterType: MeterType;
  localUnit: EnergyUnit;
  rawRemoteType: string | null;
  rawRemoteUnitOfMeasure: string | null;
  remoteUsage: number;
}) {
  const compatibility = classifyPortfolioManagerUnitCompatibility({
    localMeterType: input.localMeterType,
    localUnit: input.localUnit,
    rawRemoteType: input.rawRemoteType,
    rawRemoteUnitOfMeasure: input.rawRemoteUnitOfMeasure,
  });

  if (compatibility.status === "UNSUPPORTED" || compatibility.remote == null) {
    return {
      ok: false as const,
      reason:
        compatibility.reason ??
        "Portfolio Manager usage cannot be imported because the remote meter unit is unsupported.",
    };
  }

  if (isWaterMeterType(input.localMeterType)) {
    const remoteVolumeFactor = WATER_VOLUME_CONVERSIONS[compatibility.remote.preferredLocalUnit];
    const localVolumeFactor = WATER_VOLUME_CONVERSIONS[input.localUnit];

    if (!remoteVolumeFactor || !localVolumeFactor) {
      return {
        ok: false as const,
        reason: "The water meter unit cannot be converted safely for Portfolio Manager.",
      };
    }

    const gallons = input.remoteUsage * remoteVolumeFactor;
    const localConsumption = gallons / localVolumeFactor;

    return {
      ok: true as const,
      compatibility,
      localConsumption,
      consumptionKbtu: 0,
    };
  }

  const localFactor = getLocalKbtuFactorForMeter(input.localMeterType, input.localUnit);
  if (localFactor == null) {
    return {
      ok: false as const,
      reason: "The local Quoin meter unit cannot be converted safely for Portfolio Manager.",
    };
  }

  const consumptionKbtu = input.remoteUsage * compatibility.remote.kbtuPerUnit;
  const localConsumption = consumptionKbtu / localFactor;

  return {
    ok: true as const,
    compatibility,
    localConsumption,
    consumptionKbtu,
  };
}

export function convertLocalUsageToRemoteUsage(input: {
  localMeterType: MeterType;
  localUnit: EnergyUnit;
  rawRemoteType: string | null;
  rawRemoteUnitOfMeasure: string | null;
  localUsage: number;
}) {
  const compatibility = classifyPortfolioManagerUnitCompatibility({
    localMeterType: input.localMeterType,
    localUnit: input.localUnit,
    rawRemoteType: input.rawRemoteType,
    rawRemoteUnitOfMeasure: input.rawRemoteUnitOfMeasure,
  });

  if (compatibility.status === "UNSUPPORTED" || compatibility.remote == null) {
    return {
      ok: false as const,
      reason:
        compatibility.reason ??
        "Portfolio Manager usage cannot be pushed because the remote meter unit is unsupported.",
    };
  }

  if (isWaterMeterType(input.localMeterType)) {
    const remoteVolumeFactor = WATER_VOLUME_CONVERSIONS[compatibility.remote.preferredLocalUnit];
    const localVolumeFactor = WATER_VOLUME_CONVERSIONS[input.localUnit];

    if (!remoteVolumeFactor || !localVolumeFactor) {
      return {
        ok: false as const,
        reason: "The water meter unit cannot be converted safely for Portfolio Manager.",
      };
    }

    const gallons = input.localUsage * localVolumeFactor;
    const remoteUsage = gallons / remoteVolumeFactor;

    return {
      ok: true as const,
      compatibility,
      remoteUsage,
      consumptionKbtu: 0,
    };
  }

  const localFactor = getLocalKbtuFactorForMeter(input.localMeterType, input.localUnit);
  if (localFactor == null) {
    return {
      ok: false as const,
      reason: "The local Quoin meter unit cannot be converted safely for Portfolio Manager.",
    };
  }

  const consumptionKbtu = input.localUsage * localFactor;
  const remoteUsage = consumptionKbtu / compatibility.remote.kbtuPerUnit;

  return {
    ok: true as const,
    compatibility,
    remoteUsage,
    consumptionKbtu,
  };
}

export function getPortfolioManagerMeterCreationDefinition(input: {
  meterType: MeterType;
  unit: EnergyUnit;
}): MeterCreationDefinition | null {
  return CREATION_DEFINITIONS[`${input.meterType}:${input.unit}`] ?? null;
}

export function defaultRawMeterTypeForMeterType(meterType: MeterType): string | null {
  return PM_METER_TYPE_LABELS[meterType] ?? null;
}
