"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, RotateCcw, Upload, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface UploadModalProps {
  buildingId: string;
  utilityScope: "electricity" | "gas" | "water";
  onClose: () => void;
  onSuccess: () => void;
}

type ReviewCandidateDraft = {
  candidateId: string;
  utilityType: "ELECTRIC" | "GAS" | "WATER";
  unit: "KWH" | "THERMS" | "KBTU" | "MMBTU" | "GAL" | "KGAL" | "CCF";
  periodStart: string;
  periodEnd: string;
  consumption: string;
};

const BILL_UNITS_BY_TYPE: Record<
  ReviewCandidateDraft["utilityType"],
  Array<ReviewCandidateDraft["unit"]>
> = {
  ELECTRIC: ["KWH", "KBTU", "MMBTU"],
  GAS: ["THERMS", "CCF", "KBTU", "MMBTU"],
  WATER: ["GAL", "KGAL", "CCF"],
};

const BILL_UPLOAD_CONFIG = {
  electricity: {
    utilityType: "ELECTRIC" as const,
    label: "electricity",
  },
  gas: {
    utilityType: "GAS" as const,
    label: "gas",
  },
  water: {
    utilityType: "WATER" as const,
    label: "water",
  },
} as const;

function formatIsoDate(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function utilityLabel(value: ReviewCandidateDraft["utilityType"]) {
  switch (value) {
    case "ELECTRIC":
      return "Electricity";
    case "GAS":
      return "Gas";
    case "WATER":
      return "Water";
  }
}

function ResultBlock({
  success,
  title,
  body,
}: {
  success: boolean;
  title: string;
  body: string;
}) {
  return (
    <div
      className="p-4"
      style={{
        borderLeft: success ? "3px solid #006b63" : "3px solid #9f403d",
        backgroundColor: "#f0f4f7",
      }}
    >
      <p
        className="font-sans text-sm font-semibold"
        style={{ color: success ? "#2a3439" : "#9f403d" }}
      >
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{body}</p>
    </div>
  );
}

export function UploadModal({
  buildingId,
  utilityScope,
  onClose,
  onSuccess,
}: UploadModalProps) {
  const utils = trpc.useUtils();

  const [billFile, setBillFile] = useState<File | null>(null);
  const [billUploading, setBillUploading] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);
  const [billDragOver, setBillDragOver] = useState(false);
  const [billUploadId, setBillUploadId] = useState<string | null>(null);
  const [billConfirmed, setBillConfirmed] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<ReviewCandidateDraft[]>([]);

  const billInputRef = useRef<HTMLInputElement>(null);
  const billConfig = BILL_UPLOAD_CONFIG[utilityScope];
  const lockedBillUtilityType = billConfig.utilityType;

  const reviewQuery = trpc.building.getUtilityBillUploadReview.useQuery(
    { buildingId, uploadId: billUploadId ?? "" },
    {
      enabled: billUploadId != null,
      retry: false,
      refetchInterval(query) {
        const status = query.state.data?.status;
        return status === "QUEUED" || status === "PROCESSING" ? 2000 : false;
      },
    },
  );

  useEffect(() => {
    if (!reviewQuery.data || reviewQuery.data.status !== "READY_FOR_REVIEW") {
      return;
    }

    setReviewDrafts((current) => {
      if (
        current.length > 0 &&
        current.every((draft) =>
          reviewQuery.data?.candidates.some((candidate) => candidate.id === draft.candidateId),
        )
      ) {
        return current;
      }

      return reviewQuery.data.candidates.map((candidate) => ({
        candidateId: candidate.id,
        utilityType: lockedBillUtilityType,
        unit: BILL_UNITS_BY_TYPE[lockedBillUtilityType].includes(candidate.unit)
          ? candidate.unit
          : BILL_UNITS_BY_TYPE[lockedBillUtilityType][0],
        periodStart: formatIsoDate(candidate.periodStart),
        periodEnd: formatIsoDate(candidate.periodEnd),
        consumption: String(candidate.consumption),
      }));
    });
  }, [lockedBillUtilityType, reviewQuery.data]);

  const retryBillUpload = trpc.building.retryUtilityBillUpload.useMutation({
    onSuccess: async () => {
      setBillError(null);
      await reviewQuery.refetch();
    },
    onError: (error) => setBillError(error.message),
  });

  const confirmBillUpload = trpc.building.confirmUtilityBillUpload.useMutation({
    onSuccess: async () => {
      setBillConfirmed(true);
      setBillError(null);
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.energyReadings.invalidate({ buildingId, months: 24 }),
        utils.building.utilityReadings.invalidate({ buildingId }),
        utils.building.complianceHistory.invalidate({ buildingId }),
      ]);
      onSuccess();
    },
    onError: (error) => setBillError(error.message),
  });

  const handleBillFile = useCallback((file: File) => {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setBillError("Bill file must be a PDF, PNG, JPG, or JPEG");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setBillError("Bill file is too large (max 20MB)");
      return;
    }

    setBillFile(file);
    setBillError(null);
    setBillUploadId(null);
    setBillConfirmed(false);
    setReviewDrafts([]);
  }, []);

  const handleBillUpload = async () => {
    if (!billFile) {
      return;
    }

    setBillUploading(true);
    setBillError(null);

    try {
      const formData = new FormData();
      formData.append("file", billFile);
      formData.append("buildingId", buildingId);
      formData.append("utilityType", lockedBillUtilityType);

      const response = await fetch("/api/upload-bill", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        billUploadId?: string;
        error?: string;
      };

      if (!response.ok || !payload.billUploadId) {
        setBillError(payload.error ?? "Bill upload failed");
      } else {
        setBillUploadId(payload.billUploadId);
        setReviewDrafts([]);
        setBillConfirmed(false);
      }
    } catch {
      setBillError("Bill upload failed. Please try again.");
    } finally {
      setBillUploading(false);
    }
  };

  const confirmDisabled = useMemo(() => {
    if (reviewDrafts.length === 0 || confirmBillUpload.isPending) {
      return true;
    }

    return reviewDrafts.some((draft) => {
      const consumption = Number(draft.consumption);
      return (
        !draft.periodStart ||
        !draft.periodEnd ||
        !Number.isFinite(consumption) ||
        consumption <= 0
      );
    });
  }, [confirmBillUpload.isPending, reviewDrafts]);

  const currentBillStatus = reviewQuery.data?.status ?? (billUploadId ? "QUEUED" : null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default outline-none"
        style={{ backgroundColor: "rgba(42,52,57,0.5)" }}
        onClick={onClose}
        aria-label="Close modal"
        tabIndex={-1}
      />

      <div
        className="relative w-full max-w-3xl p-6"
        style={{
          backgroundColor: "#ffffff",
          borderRadius: 0,
          boxShadow: "0 16px 48px 0 rgba(42,52,57,0.12)",
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p
              className="mb-1 font-sans text-[10px] font-medium uppercase tracking-[0.2em]"
              style={{ color: "#717c82" }}
            >
              Data Ingestion
            </p>
            <h2
              className="font-display text-lg font-semibold tracking-tight"
              style={{ color: "#2a3439" }}
            >
              {`Upload ${billConfig.label} bill`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 transition-colors"
            style={{ color: "#a9b4b9", borderRadius: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {!billUploadId ? (
            <>
              <button
                type="button"
                onDragOver={(event) => {
                  event.preventDefault();
                  setBillDragOver(true);
                }}
                onDragLeave={() => setBillDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setBillDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file) {
                    handleBillFile(file);
                  }
                }}
                onClick={() => billInputRef.current?.click()}
                className="w-full cursor-pointer px-4 py-10 text-center text-sm transition-colors focus:outline-none"
                style={{
                  border: billDragOver
                    ? "1px dashed #545f73"
                    : "1px dashed rgba(169,180,185,0.6)",
                  backgroundColor: billDragOver ? "#f0f4f7" : "transparent",
                  borderRadius: 0,
                }}
              >
                {billFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={20} style={{ color: "#545f73" }} />
                    <p className="font-sans text-sm font-medium" style={{ color: "#2a3439" }}>
                      {billFile.name}
                    </p>
                    <p className="font-sans text-[11px]" style={{ color: "#a9b4b9" }}>
                      {(billFile.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={20} style={{ color: "#a9b4b9" }} />
                    <p className="font-sans" style={{ color: "#566166" }}>
                      {`Drop a ${billConfig.label} bill here or click to browse`}
                    </p>
                    <p
                      className="font-sans text-[11px] uppercase tracking-widest"
                      style={{ color: "#a9b4b9" }}
                    >
                      .pdf Â· .png Â· .jpg Â· .jpeg Â· max 20 MB
                    </p>
                  </div>
                )}
              </button>
              <input
                ref={billInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleBillFile(file);
                  }
                }}
              />
              <p className="text-sm leading-6 text-zinc-600">
                {`Quoin stores the original bill privately, extracts the current billed-period ${billConfig.label} reading, and asks you to confirm it before saving.`}
              </p>
              {billError ? (
                <p className="font-sans text-xs uppercase tracking-wider text-[#9f403d]">
                  {billError}
                </p>
              ) : null}
              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 font-sans text-sm transition-colors"
                  style={{ color: "#566166" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBillUpload}
                  disabled={!billFile || billUploading}
                  className="px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-widest transition-colors disabled:opacity-40"
                  style={{
                    backgroundColor: "#545f73",
                    color: "#f6f7ff",
                    borderRadius: 0,
                  }}
                >
                  {billUploading ? "Uploading..." : `Upload ${billConfig.label} bill`}
                </button>
              </div>
            </>
          ) : currentBillStatus === "QUEUED" || currentBillStatus === "PROCESSING" ? (
            <>
              <ResultBlock
                success
                title="Extracting bill data..."
                body={`Quoin is reading the file, running OCR if needed, and extracting the current billed-period ${billConfig.label} reading for review.`}
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setBillUploadId(null);
                    setBillFile(null);
                    setBillError(null);
                  }}
                  className="px-4 py-2 font-sans text-sm transition-colors"
                  style={{ color: "#566166" }}
                >
                  Start over
                </button>
              </div>
            </>
          ) : currentBillStatus === "FAILED" ? (
            <>
              <ResultBlock
                success={false}
                title="Bill extraction failed"
                body={
                  reviewQuery.data?.latestErrorMessage ??
                  billError ??
                  "Quoin could not extract a current billed-period reading from this bill."
                }
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setBillUploadId(null);
                    setBillFile(null);
                    setBillError(null);
                  }}
                  className="px-4 py-2 font-sans text-sm transition-colors"
                  style={{ color: "#566166" }}
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!billUploadId) {
                      return;
                    }
                    retryBillUpload.mutate({
                      buildingId,
                      uploadId: billUploadId,
                    });
                  }}
                  disabled={retryBillUpload.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-widest transition-colors disabled:opacity-40"
                  style={{
                    backgroundColor: "#545f73",
                    color: "#f6f7ff",
                    borderRadius: 0,
                  }}
                >
                  <RotateCcw size={13} />
                  {retryBillUpload.isPending ? "Retrying..." : "Retry extraction"}
                </button>
              </div>
            </>
          ) : billConfirmed || currentBillStatus === "CONFIRMED" ? (
            <>
              <ResultBlock
                success
                title="Bill readings saved"
                body={`The confirmed ${billConfig.label} reading has been saved and will now appear in the building readings table.`}
              />
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 font-sans text-sm transition-colors"
                  style={{ color: "#566166" }}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Review extracted bill data
                  </div>
                  <div className="mt-1 text-sm text-zinc-600">
                    {`Confirm or correct the extracted ${billConfig.label} reading before Quoin saves it.`}
                  </div>
                </div>
                {reviewQuery.data?.fileUrl ? (
                  <a
                    href={reviewQuery.data.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-[#545f73] underline underline-offset-4"
                  >
                    Open original bill
                  </a>
                ) : null}
              </div>
              {billError ? (
                <p className="font-sans text-xs uppercase tracking-wider text-[#9f403d]">
                  {billError}
                </p>
              ) : null}
              <div className="space-y-4">
                {reviewDrafts.map((draft, index) => {
                  const reviewCandidate = reviewQuery.data?.candidates.find(
                    (candidate) => candidate.id === draft.candidateId,
                  );
                  const unitOptions = BILL_UNITS_BY_TYPE[draft.utilityType];

                  return (
                    <div
                      key={draft.candidateId}
                      className="rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-4"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold tracking-tight text-zinc-900">
                          Candidate {index + 1}
                        </div>
                        <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                          {reviewCandidate?.confidence != null
                            ? `Confidence ${Math.round(reviewCandidate.confidence * 100)}%`
                            : "Review required"}
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <label className="space-y-1 text-sm text-zinc-600">
                          <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                            Utility
                          </span>
                          <div className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
                            {utilityLabel(draft.utilityType)}
                          </div>
                        </label>
                        <label className="space-y-1 text-sm text-zinc-600">
                          <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                            Start date
                          </span>
                          <input
                            type="date"
                            value={draft.periodStart}
                            onChange={(event) =>
                              setReviewDrafts((current) =>
                                current.map((item) =>
                                  item.candidateId === draft.candidateId
                                    ? { ...item, periodStart: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                          />
                        </label>
                        <label className="space-y-1 text-sm text-zinc-600">
                          <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                            End date
                          </span>
                          <input
                            type="date"
                            value={draft.periodEnd}
                            onChange={(event) =>
                              setReviewDrafts((current) =>
                                current.map((item) =>
                                  item.candidateId === draft.candidateId
                                    ? { ...item, periodEnd: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                          />
                        </label>
                        <label className="space-y-1 text-sm text-zinc-600">
                          <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                            Usage
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.consumption}
                            onChange={(event) =>
                              setReviewDrafts((current) =>
                                current.map((item) =>
                                  item.candidateId === draft.candidateId
                                    ? { ...item, consumption: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                          />
                        </label>
                        <label className="space-y-1 text-sm text-zinc-600">
                          <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                            Unit
                          </span>
                          <select
                            value={draft.unit}
                            onChange={(event) =>
                              setReviewDrafts((current) =>
                                current.map((item) =>
                                  item.candidateId === draft.candidateId
                                    ? {
                                        ...item,
                                        unit: event.target.value as ReviewCandidateDraft["unit"],
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                          >
                            {unitOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {reviewCandidate?.sourceSnippet ? (
                        <div className="mt-4 rounded-xl border border-zinc-200/80 bg-[#fafbfc] px-3 py-2 text-sm leading-6 text-zinc-600">
                          {reviewCandidate.sourceSnippet}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setBillUploadId(null);
                    setBillFile(null);
                    setBillError(null);
                    setReviewDrafts([]);
                  }}
                  className="px-4 py-2 font-sans text-sm transition-colors"
                  style={{ color: "#566166" }}
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!billUploadId) {
                      return;
                    }
                    confirmBillUpload.mutate({
                      buildingId,
                      uploadId: billUploadId,
                      candidates: reviewDrafts.map((draft) => ({
                        candidateId: draft.candidateId,
                        utilityType: draft.utilityType,
                        unit: draft.unit,
                        periodStart: draft.periodStart,
                        periodEnd: draft.periodEnd,
                        consumption: Number(draft.consumption),
                      })),
                    });
                  }}
                  disabled={confirmDisabled}
                  className="px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-widest transition-colors disabled:opacity-40"
                  style={{
                    backgroundColor: "#545f73",
                    color: "#f6f7ff",
                    borderRadius: 0,
                  }}
                >
                  {confirmBillUpload.isPending ? "Saving..." : "Confirm and save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
