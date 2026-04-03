/** Maps to Prisma MeterType enum */
export type MeterType =
  | "ELECTRIC"
  | "GAS"
  | "STEAM"
  | "WATER_INDOOR"
  | "WATER_OUTDOOR"
  | "WATER_RECYCLED"
  | "OTHER";

/** Maps to Prisma EnergyUnit enum */
export type EnergyUnit = "KWH" | "THERMS" | "KBTU" | "MMBTU" | "GAL" | "KGAL" | "CCF";

/** What the CSV parser extracts from each row */
export interface ParsedRow {
  rowIndex: number;
  startDate: Date | null;
  endDate: Date | null;
  consumption: number | null;
  cost: number | null;
  unit: string | null;
  raw: Record<string, string>;
}

/** After normalization to kBtu */
export interface NormalizedReading {
  periodStart: Date;
  periodEnd: Date;
  consumptionKbtu: number;
  consumption: number;
  unit: EnergyUnit;
  cost: number | null;
  meterType: MeterType;
}

/** Validation result for a single reading */
export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/** Column mapping result */
export interface ColumnMapping {
  startDate: string | null;
  endDate: string | null;
  consumption: string | null;
  cost: string | null;
  unit: string | null;
  confidence: number;
  detectedMeterType: MeterType;
  detectedUnit: string;
}

/** Full upload result */
export interface UploadResult {
  success: boolean;
  buildingId: string;
  uploadBatchId: string;
  readingsCreated: number;
  readingsRejected: number;
  warnings: string[];
  errors: string[];
  columnMapping: ColumnMapping;
  dateRange: { start: Date; end: Date } | null;
}
