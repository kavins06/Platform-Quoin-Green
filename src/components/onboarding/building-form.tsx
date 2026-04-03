"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildDefaultPropertyUseDisplayName,
  getPropertyUseDefinition,
  listPropertyUseDefinitions,
  type BuildingPropertyUseKey,
  type PropertyUseFieldDefinition,
} from "@/lib/buildings/property-use-registry";
import { toSerializablePropertyUseDetails } from "@/lib/buildings/property-use-profile";
import {
  hasPortfolioManagerMailingAddress,
  PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
  PORTFOLIO_MANAGER_MAILING_ADDRESS_HELPER,
} from "@/lib/buildings/portfolio-manager-address";

type FormStep = "shell" | "uses" | "details";
type ConstructionStatus = "existing" | "planned";

type EditablePropertyUse = {
  clientId: string;
  id?: string | null;
  sortOrder: number;
  useKey: BuildingPropertyUseKey;
  displayName: string;
  grossSquareFeet: string;
  details: Record<string, string>;
};

export interface BuildingFormData {
  name: string;
  address: string;
  grossSquareFeet: number;
  yearBuilt: number | null;
  plannedConstructionCompletionYear: number | null;
  occupancyRate: number | null;
  irrigatedAreaSquareFeet: number | null;
  numberOfBuildings: number;
  propertyUses: Array<{
    id?: string | null;
    sortOrder: number;
    useKey: BuildingPropertyUseKey;
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, string | number | boolean | null>;
  }>;
}

interface BuildingFormProps {
  onSubmit: (data: BuildingFormData) => void;
  loading?: boolean;
  initialData?: Partial<BuildingFormData>;
  submitLabel?: string;
  mode?: "create" | "edit";
}

const STEPS: Array<{ key: FormStep; label: string; description: string }> = [
  { key: "shell", label: "Basics", description: "Property details" },
  { key: "uses", label: "Uses", description: "Split the floor area" },
  { key: "details", label: "Details", description: "Required ESPM fields" },
];

const STEP_COPY: Record<FormStep, { title: string; description: string }> = {
  shell: {
    title: "Basics",
    description: "Only the fields ESPM needs for every building.",
  },
  uses: {
    title: "Property uses",
    description: "Split the gross floor area by use.",
  },
  details: {
    title: "Required details",
    description: "Add the required fields for each use.",
  },
};

function createClientId() {
  return `property-use-${Math.random().toString(36).slice(2, 10)}`;
}

function isBlank(value: string | null | undefined) {
  return value == null || value.trim().length === 0;
}

function parseNullableInteger(value: string) {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableNumber(value: string) {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDefaultPropertyUseName(
  buildingName: string,
  useKey: BuildingPropertyUseKey,
) {
  return buildingName.trim().length > 0
    ? buildDefaultPropertyUseDisplayName(buildingName.trim(), useKey)
    : getPropertyUseDefinition(useKey).label;
}

function serializeFieldValue(field: PropertyUseFieldDefinition, rawValue: string) {
  if (isBlank(rawValue)) {
    return null;
  }

  switch (field.kind) {
    case "integer":
      return parseNullableInteger(rawValue);
    case "decimal":
      return parseNullableNumber(rawValue);
    case "boolean":
      return rawValue === "true";
    case "enum":
    case "text":
      return rawValue.trim();
    default:
      return rawValue.trim();
  }
}

function toEditableDetails(
  useKey: BuildingPropertyUseKey,
  details: Record<string, unknown> | undefined,
) {
  const normalized: Record<string, string> = {};
  const source = details ?? {};

  for (const field of getPropertyUseDefinition(useKey).requiredFields) {
    const value = source[field.key];
    if (typeof value === "boolean") {
      normalized[field.key] = value ? "true" : "false";
      continue;
    }

    if (typeof value === "number") {
      normalized[field.key] = String(value);
      continue;
    }

    if (typeof value === "string") {
      normalized[field.key] = value;
    }
  }

  return normalized;
}

function toEditableRows(
  buildingName: string,
  propertyUses: BuildingFormData["propertyUses"] | undefined,
) {
  return (propertyUses ?? []).map((propertyUse, index) => ({
    clientId: createClientId(),
    id: propertyUse.id ?? null,
    sortOrder: propertyUse.sortOrder ?? index,
    useKey: propertyUse.useKey,
    displayName:
      propertyUse.displayName.trim().length > 0
        ? propertyUse.displayName
        : getDefaultPropertyUseName(buildingName, propertyUse.useKey),
    grossSquareFeet: String(propertyUse.grossSquareFeet ?? ""),
    details: toEditableDetails(propertyUse.useKey, propertyUse.details),
  }));
}

function buildPayload(input: {
  name: string;
  address: string;
  grossSquareFeet: string;
  yearBuilt: string;
  plannedConstructionCompletionYear: string;
  occupancyRate: string;
  irrigatedAreaSquareFeet: string;
  numberOfBuildings: string;
  propertyUses: EditablePropertyUse[];
}) {
  const buildingName = input.name.trim();

  return {
    name: buildingName,
    address: input.address.trim(),
    grossSquareFeet: parseNullableInteger(input.grossSquareFeet) ?? 0,
    yearBuilt: parseNullableInteger(input.yearBuilt),
    plannedConstructionCompletionYear: parseNullableInteger(
      input.plannedConstructionCompletionYear,
    ),
    occupancyRate: parseNullableNumber(input.occupancyRate),
    irrigatedAreaSquareFeet: parseNullableInteger(input.irrigatedAreaSquareFeet),
    numberOfBuildings: parseNullableInteger(input.numberOfBuildings) ?? 1,
    propertyUses: input.propertyUses.map((row, index) => {
      const definition = getPropertyUseDefinition(row.useKey);
      const details = Object.fromEntries(
        definition.requiredFields.map((field) => [
          field.key,
          serializeFieldValue(field, row.details[field.key] ?? ""),
        ]),
      );

      return {
        id: row.id ?? null,
        sortOrder: index,
        useKey: row.useKey,
        displayName:
          row.displayName.trim().length > 0
            ? row.displayName.trim()
            : getDefaultPropertyUseName(buildingName, row.useKey),
        grossSquareFeet: parseNullableInteger(row.grossSquareFeet) ?? 0,
        details: toSerializablePropertyUseDetails(row.useKey, details) as Record<
          string,
          string | number | boolean | null
        >,
      };
    }),
  } satisfies BuildingFormData;
}

function renderFieldValue(
  field: PropertyUseFieldDefinition,
  value: string,
  onChange: (nextValue: string) => void,
  inputClassName: string,
) {
  if (field.kind === "boolean") {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        <option value="">Choose</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (field.kind === "enum") {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        <option value="">Choose</option>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "integer" || field.kind === "decimal") {
    return (
      <input
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={field.step ?? (field.kind === "integer" ? 1 : 0.1)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClassName}
    />
  );
}

function buildPropertyUseTitle(
  propertyUses: Array<{
    useKey: BuildingPropertyUseKey;
    sortOrder: number;
  }>,
  propertyUse: {
    useKey: BuildingPropertyUseKey;
    sortOrder: number;
  },
) {
  const definition = getPropertyUseDefinition(propertyUse.useKey);
  const siblings = propertyUses.filter((row) => row.useKey === propertyUse.useKey);

  if (siblings.length <= 1) {
    return definition.label;
  }

  const index = siblings.findIndex((row) => row.sortOrder === propertyUse.sortOrder);
  return `${definition.label} ${index + 1}`;
}

function buildEditablePropertyUseTitle(
  propertyUses: EditablePropertyUse[],
  propertyUse: EditablePropertyUse,
) {
  return buildPropertyUseTitle(
    propertyUses.map((row, index) => ({
      useKey: row.useKey,
      sortOrder: row.sortOrder ?? index,
    })),
    {
      useKey: propertyUse.useKey,
      sortOrder: propertyUse.sortOrder,
    },
  );
}

function getInitialConstructionStatus(
  initialData: Partial<BuildingFormData> | undefined,
): ConstructionStatus {
  return initialData?.plannedConstructionCompletionYear != null &&
    initialData.yearBuilt == null
    ? "planned"
    : "existing";
}

export function BuildingForm({
  onSubmit,
  loading = false,
  initialData,
  submitLabel,
  mode = "create",
}: BuildingFormProps) {
  const isCreateMode = mode === "create";
  const [step, setStep] = useState<FormStep>("shell");
  const [constructionStatus, setConstructionStatus] = useState<ConstructionStatus>(
    getInitialConstructionStatus(initialData),
  );
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [grossSquareFeet, setGrossSquareFeet] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [plannedConstructionCompletionYear, setPlannedConstructionCompletionYear] =
    useState("");
  const [occupancyRate, setOccupancyRate] = useState("");
  const [irrigatedAreaSquareFeet, setIrrigatedAreaSquareFeet] = useState("");
  const [numberOfBuildings, setNumberOfBuildings] = useState("1");
  const [propertyUses, setPropertyUses] = useState<EditablePropertyUse[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setConstructionStatus(getInitialConstructionStatus(initialData));
    setName(initialData?.name ?? "");
    setAddress(initialData?.address ?? "");
    setGrossSquareFeet(
      initialData?.grossSquareFeet != null ? String(initialData.grossSquareFeet) : "",
    );
    setYearBuilt(initialData?.yearBuilt != null ? String(initialData.yearBuilt) : "");
    setPlannedConstructionCompletionYear(
      initialData?.plannedConstructionCompletionYear != null
        ? String(initialData.plannedConstructionCompletionYear)
        : "",
    );
    setOccupancyRate(
      initialData?.occupancyRate != null ? String(initialData.occupancyRate) : "",
    );
    setIrrigatedAreaSquareFeet(
      initialData?.irrigatedAreaSquareFeet != null
        ? String(initialData.irrigatedAreaSquareFeet)
        : "",
    );
    setNumberOfBuildings(
      initialData?.numberOfBuildings != null
        ? String(initialData.numberOfBuildings)
        : "1",
    );
    setPropertyUses(toEditableRows(initialData?.name ?? "", initialData?.propertyUses));
  }, [initialData]);

  const propertyUseDefinitions = useMemo(() => listPropertyUseDefinitions(), []);
  const payload = useMemo(
    () =>
      buildPayload({
        name,
        address,
        grossSquareFeet,
        yearBuilt,
        plannedConstructionCompletionYear,
        occupancyRate,
        irrigatedAreaSquareFeet,
        numberOfBuildings,
        propertyUses,
      }),
    [
      address,
      grossSquareFeet,
      irrigatedAreaSquareFeet,
      name,
      numberOfBuildings,
      occupancyRate,
      plannedConstructionCompletionYear,
      propertyUses,
      yearBuilt,
    ],
  );
  const areaTotal = propertyUses.reduce(
    (sum, propertyUse) =>
      sum + Math.max(parseNullableInteger(propertyUse.grossSquareFeet) ?? 0, 0),
    0,
  );
  const propertyUsesNeedingDetails = payload.propertyUses.filter(
    (propertyUse) => getPropertyUseDefinition(propertyUse.useKey).requiredFields.length > 0,
  );

  function validateShell() {
    const nextErrors: Record<string, string> = {};

    if (!payload.name) {
      nextErrors.name = "Enter the building name.";
    }

    if (!payload.address) {
      nextErrors.address = "Enter the full mailing address.";
    } else if (!hasPortfolioManagerMailingAddress(payload.address)) {
      nextErrors.address = PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR;
    }

    if (!Number.isFinite(payload.grossSquareFeet) || payload.grossSquareFeet <= 0) {
      nextErrors.grossSquareFeet = "Enter gross floor area.";
    }

    if (constructionStatus === "existing") {
      if (payload.yearBuilt == null) {
        nextErrors.yearBuilt = "Enter the year built.";
      } else if (payload.yearBuilt < 1800 || payload.yearBuilt > 2030) {
        nextErrors.yearBuilt = "Enter a valid year.";
      }
    }

    if (constructionStatus === "planned") {
      if (payload.plannedConstructionCompletionYear == null) {
        nextErrors.plannedConstructionCompletionYear =
          "Enter the planned completion year.";
      } else if (
        payload.plannedConstructionCompletionYear < 1800 ||
        payload.plannedConstructionCompletionYear > 2100
      ) {
        nextErrors.plannedConstructionCompletionYear = "Enter a valid year.";
      }
    }

    if (payload.occupancyRate == null) {
      nextErrors.occupancyRate = "Enter occupancy.";
    } else if (payload.occupancyRate < 0 || payload.occupancyRate > 100) {
      nextErrors.occupancyRate = "Occupancy must be between 0 and 100.";
    }

    if (payload.irrigatedAreaSquareFeet == null) {
      nextErrors.irrigatedAreaSquareFeet = "Enter irrigated area. Use 0 if none.";
    } else if (payload.irrigatedAreaSquareFeet < 0) {
      nextErrors.irrigatedAreaSquareFeet = "Enter 0 or more.";
    }

    if (!Number.isFinite(payload.numberOfBuildings) || payload.numberOfBuildings < 1) {
      nextErrors.numberOfBuildings = "Enter at least 1 building.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function validateUses() {
    const nextErrors: Record<string, string> = {};

    if (propertyUses.length === 0) {
      nextErrors.propertyUses = "Add at least one property use.";
    }

    propertyUses.forEach((propertyUse) => {
      const parsedGrossSquareFeet = parseNullableInteger(propertyUse.grossSquareFeet);
      if (parsedGrossSquareFeet == null || parsedGrossSquareFeet <= 0) {
        nextErrors[`use:${propertyUse.clientId}:grossSquareFeet`] = "Enter square footage.";
      }
    });

    if (propertyUses.length > 0 && areaTotal !== payload.grossSquareFeet) {
      nextErrors.propertyUsesTotal = `Use areas must add up to ${payload.grossSquareFeet.toLocaleString()} sq ft.`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function validateDetails() {
    const nextErrors: Record<string, string> = {};

    for (const propertyUse of payload.propertyUses) {
      const editableRow =
        propertyUses.find((row) => row.id === propertyUse.id) ??
        propertyUses.find((row) => row.sortOrder === propertyUse.sortOrder);
      const definition = getPropertyUseDefinition(propertyUse.useKey);

      for (const field of definition.requiredFields) {
        const value = editableRow?.details[field.key] ?? "";
        if (isBlank(value)) {
          nextErrors[`detail:${editableRow?.clientId ?? propertyUse.sortOrder}:${field.key}`] =
            "Required.";
        }
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function addPropertyUse() {
    const useKey: BuildingPropertyUseKey = "OFFICE";
    setPropertyUses((current) => [
      ...current,
      {
        clientId: createClientId(),
        id: null,
        sortOrder: current.length,
        useKey,
        displayName: isCreateMode ? "" : getDefaultPropertyUseName(name, useKey),
        grossSquareFeet: "",
        details: {},
      },
    ]);
  }

  function goToNextStep() {
    if (step === "shell") {
      if (!validateShell()) {
        return;
      }

      if (isCreateMode && propertyUses.length === 0) {
        addPropertyUse();
      }

      setStep("uses");
      return;
    }

    if (step === "uses") {
      if (!validateUses()) {
        return;
      }

      setStep("details");
    }
  }

  function goToPreviousStep() {
    if (step === "details") {
      setStep("uses");
      return;
    }

    if (step === "uses") {
      setStep("shell");
    }
  }

  function updatePropertyUse(clientId: string, patch: Partial<EditablePropertyUse>) {
    setPropertyUses((current) =>
      current.map((propertyUse, index) =>
        propertyUse.clientId === clientId
          ? {
              ...propertyUse,
              ...patch,
              sortOrder: patch.sortOrder ?? index,
            }
          : {
              ...propertyUse,
              sortOrder: index,
            },
      ),
    );
  }

  function updatePropertyUseField(
    clientId: string,
    fieldKey: string,
    fieldValue: string,
  ) {
    setPropertyUses((current) =>
      current.map((propertyUse, index) =>
        propertyUse.clientId === clientId
          ? {
              ...propertyUse,
              sortOrder: index,
              details: {
                ...propertyUse.details,
                [fieldKey]: fieldValue,
              },
            }
          : {
              ...propertyUse,
              sortOrder: index,
            },
      ),
    );
  }

  function removePropertyUse(clientId: string) {
    setPropertyUses((current) =>
      current
        .filter((propertyUse) => propertyUse.clientId !== clientId)
        .map((propertyUse, index) => ({
          ...propertyUse,
          sortOrder: index,
        })),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!validateShell()) {
      setStep("shell");
      return;
    }

    if (!validateUses()) {
      setStep("uses");
      return;
    }

    if (!validateDetails()) {
      setStep("details");
      return;
    }

    onSubmit(payload);
  }

  const currentStepIndex = STEPS.findIndex((item) => item.key === step);
  const currentStep = STEP_COPY[step];
  const inputClassName =
    "mt-1.5 block w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-zinc-900/5";
  const labelClassName = "block text-sm font-medium text-zinc-700";
  const helperClassName = "mt-1.5 text-xs text-zinc-500";
  const errorClassName = "mt-1.5 text-xs font-medium text-red-600";
  const effectiveSubmitLabel =
    submitLabel ?? (mode === "edit" ? "Save changes" : "Create building");

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((item, index) => {
          const isActive = step === item.key;
          const isComplete = index < currentStepIndex;

          return (
            <div
              key={item.key}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm transition ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : isComplete
                    ? "bg-zinc-100 text-zinc-900"
                    : "bg-white text-zinc-500 ring-1 ring-inset ring-zinc-200"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive
                    ? "bg-white/15 text-white"
                    : isComplete
                      ? "bg-white text-zinc-900"
                      : "bg-zinc-50 text-zinc-500"
                }`}
              >
                {index + 1}
              </span>
              <span className="font-medium">{item.label}</span>
            </div>
          );
        })}
      </div>

      <section className="rounded-[28px] border border-zinc-200 bg-white/95 px-5 py-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)] sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Step {currentStepIndex + 1} of {STEPS.length}
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
              {currentStep.title}
            </h2>
            <p className="text-sm text-zinc-500">{currentStep.description}</p>
          </div>

          {step === "uses" ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                areaTotal === payload.grossSquareFeet
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-zinc-50 text-zinc-600"
              }`}
            >
              {areaTotal.toLocaleString()} of {payload.grossSquareFeet.toLocaleString()} sq ft
            </div>
          ) : null}
        </div>

        {step === "shell" ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label>
              <span className={labelClassName}>Building name</span>
              <input
                id="bld-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="640 Mass"
                className={inputClassName}
              />
              {errors.name ? <p className={errorClassName}>{errors.name}</p> : null}
            </label>

            <label>
              <span className={labelClassName}>Street address</span>
              <input
                id="bld-address"
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="640 Massachusetts Ave NW, Washington, DC 20001"
                className={inputClassName}
              />
              {!errors.address ? (
                <p className={helperClassName}>
                  {PORTFOLIO_MANAGER_MAILING_ADDRESS_HELPER}
                </p>
              ) : null}
              {errors.address ? <p className={errorClassName}>{errors.address}</p> : null}
            </label>

            <label>
              <span className={labelClassName}>Gross floor area (sq ft)</span>
              <input
                id="bld-sqft"
                type="number"
                inputMode="numeric"
                min={1}
                value={grossSquareFeet}
                onChange={(event) => setGrossSquareFeet(event.target.value)}
                placeholder="91000"
                className={inputClassName}
              />
              {errors.grossSquareFeet ? (
                <p className={errorClassName}>{errors.grossSquareFeet}</p>
              ) : null}
            </label>

            <label>
              <span className={labelClassName}>Buildings on this property</span>
              <input
                id="bld-number-of-buildings"
                type="number"
                inputMode="numeric"
                min={1}
                value={numberOfBuildings}
                onChange={(event) => setNumberOfBuildings(event.target.value)}
                className={inputClassName}
              />
              {errors.numberOfBuildings ? (
                <p className={errorClassName}>{errors.numberOfBuildings}</p>
              ) : null}
            </label>

            <div className="md:col-span-2">
              <span className={labelClassName}>Building status</span>
              <div className="mt-1.5 inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setConstructionStatus("existing");
                    setPlannedConstructionCompletionYear("");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    constructionStatus === "existing"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500"
                  }`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConstructionStatus("planned");
                    setYearBuilt("");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    constructionStatus === "planned"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500"
                  }`}
                >
                  New construction
                </button>
              </div>
            </div>

            {constructionStatus === "existing" ? (
              <label>
                <span className={labelClassName}>Year built</span>
                <input
                  id="bld-year-built"
                  type="number"
                  inputMode="numeric"
                  min={1800}
                  max={2030}
                  value={yearBuilt}
                  onChange={(event) => setYearBuilt(event.target.value)}
                  placeholder="1970"
                  className={inputClassName}
                />
                {errors.yearBuilt ? <p className={errorClassName}>{errors.yearBuilt}</p> : null}
              </label>
            ) : (
              <label>
                <span className={labelClassName}>Planned completion year</span>
                <input
                  id="bld-planned-year"
                  type="number"
                  inputMode="numeric"
                  min={1800}
                  max={2100}
                  value={plannedConstructionCompletionYear}
                  onChange={(event) =>
                    setPlannedConstructionCompletionYear(event.target.value)
                  }
                  placeholder="2027"
                  className={inputClassName}
                />
                {errors.plannedConstructionCompletionYear ? (
                  <p className={errorClassName}>{errors.plannedConstructionCompletionYear}</p>
                ) : null}
              </label>
            )}

            <label>
              <span className={labelClassName}>Occupancy (%)</span>
              <input
                id="bld-occupancy-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.1}
                value={occupancyRate}
                onChange={(event) => setOccupancyRate(event.target.value)}
                placeholder="100"
                className={inputClassName}
              />
              {errors.occupancyRate ? (
                <p className={errorClassName}>{errors.occupancyRate}</p>
              ) : (
                <p className={helperClassName}>Use the current occupied percentage.</p>
              )}
            </label>

            <label>
              <span className={labelClassName}>Irrigated area (sq ft)</span>
              <input
                id="bld-irrigated-area"
                type="number"
                inputMode="numeric"
                min={0}
                value={irrigatedAreaSquareFeet}
                onChange={(event) => setIrrigatedAreaSquareFeet(event.target.value)}
                placeholder="0"
                className={inputClassName}
              />
              {errors.irrigatedAreaSquareFeet ? (
                <p className={errorClassName}>{errors.irrigatedAreaSquareFeet}</p>
              ) : (
                <p className={helperClassName}>Enter 0 if none.</p>
              )}
            </label>
          </div>
        ) : null}

        {step === "uses" ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-zinc-500">
                Add one or more uses until the full floor area is assigned.
              </div>
              <button
                type="button"
                onClick={addPropertyUse}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                {propertyUses.length > 0 ? "Add another use" : "Add use"}
              </button>
            </div>

            {errors.propertyUses ? (
              <p className={errorClassName}>{errors.propertyUses}</p>
            ) : null}
            {errors.propertyUsesTotal ? (
              <p className={errorClassName}>{errors.propertyUsesTotal}</p>
            ) : null}

            {propertyUses.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                Add the first property use to continue.
              </div>
            ) : (
              <div className="space-y-3">
                {propertyUses.map((propertyUse) => {
                  const previousDefaultName = getDefaultPropertyUseName(
                    name,
                    propertyUse.useKey,
                  );

                  return (
                    <div
                      key={propertyUse.clientId}
                      className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4"
                    >
                      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                        {buildEditablePropertyUseTitle(propertyUses, propertyUse)}
                      </div>

                      <div
                        className={`grid gap-4 ${
                          isCreateMode
                            ? "md:grid-cols-[minmax(0,1.5fr)_180px_auto]"
                            : "md:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_180px_auto]"
                        }`}
                      >
                        <label>
                          <span className={labelClassName}>Property use</span>
                          <select
                            value={propertyUse.useKey}
                            onChange={(event) => {
                              const nextUseKey = event.target.value as BuildingPropertyUseKey;
                              const shouldResetDisplayName =
                                isCreateMode ||
                                isBlank(propertyUse.displayName) ||
                                propertyUse.displayName === previousDefaultName;

                              updatePropertyUse(propertyUse.clientId, {
                                useKey: nextUseKey,
                                displayName: shouldResetDisplayName
                                  ? isCreateMode
                                    ? ""
                                    : getDefaultPropertyUseName(name, nextUseKey)
                                  : propertyUse.displayName,
                                details: {},
                              });
                            }}
                            className={inputClassName}
                          >
                            {propertyUseDefinitions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {!isCreateMode ? (
                          <label>
                            <span className={labelClassName}>Use name</span>
                            <input
                              type="text"
                              value={propertyUse.displayName}
                              onChange={(event) =>
                                updatePropertyUse(propertyUse.clientId, {
                                  displayName: event.target.value,
                                })
                              }
                              className={inputClassName}
                            />
                          </label>
                        ) : null}

                        <label>
                          <span className={labelClassName}>Area (sq ft)</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={propertyUse.grossSquareFeet}
                            onChange={(event) =>
                              updatePropertyUse(propertyUse.clientId, {
                                grossSquareFeet: event.target.value,
                              })
                            }
                            className={inputClassName}
                          />
                          {errors[`use:${propertyUse.clientId}:grossSquareFeet`] ? (
                            <p className={errorClassName}>
                              {errors[`use:${propertyUse.clientId}:grossSquareFeet`]}
                            </p>
                          ) : null}
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removePropertyUse(propertyUse.clientId)}
                            className="rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {step === "details" ? (
          <div className="mt-6 space-y-4">
            {propertyUsesNeedingDetails.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                No extra details are needed for these uses.
              </div>
            ) : (
              propertyUsesNeedingDetails.map((propertyUse) => {
                const editableRow =
                  propertyUses.find((row) => row.id === propertyUse.id) ??
                  propertyUses.find((row) => row.sortOrder === propertyUse.sortOrder);
                const definition = getPropertyUseDefinition(propertyUse.useKey);

                return (
                  <div
                    key={editableRow?.clientId ?? `${propertyUse.useKey}-${propertyUse.sortOrder}`}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="text-base font-semibold tracking-tight text-zinc-900">
                        {buildPropertyUseTitle(payload.propertyUses, propertyUse)}
                      </h3>
                      <div className="text-sm font-medium text-zinc-500">
                        {propertyUse.grossSquareFeet.toLocaleString()} sq ft
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {definition.requiredFields.map((field) => {
                        const errorKey = `detail:${editableRow?.clientId ?? propertyUse.sortOrder}:${field.key}`;

                        return (
                          <label key={field.key}>
                            <span className={labelClassName}>{field.label}</span>
                            {renderFieldValue(
                              field,
                              editableRow?.details[field.key] ?? "",
                              (nextValue) =>
                                editableRow
                                  ? updatePropertyUseField(
                                      editableRow.clientId,
                                      field.key,
                                      nextValue,
                                    )
                                  : undefined,
                              inputClassName,
                            )}
                            {errors[errorKey] ? (
                              <p className={errorClassName}>{errors[errorKey]}</p>
                            ) : field.description ? (
                              <p className={helperClassName}>{field.description}</p>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5">
          <div className="flex flex-wrap gap-3">
            {step !== "shell" ? (
              <button
                type="button"
                onClick={goToPreviousStep}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Back
              </button>
            ) : null}

            {step !== "details" ? (
              <button
                type="button"
                onClick={goToNextStep}
                className="rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                Continue
              </button>
            ) : null}
          </div>

          {step === "details" ? (
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {loading ? "Saving..." : effectiveSubmitLabel}
            </button>
          ) : null}
        </div>
      </section>
    </form>
  );
}
