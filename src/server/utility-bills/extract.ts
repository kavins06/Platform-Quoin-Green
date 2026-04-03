import type {
  EnergyUnit,
  UtilityBillExtractionMethod,
  UtilityBillUtilityType,
} from "@/generated/prisma/client";
import { getOptionalGeminiConfig, getOcrSpaceApiKey } from "@/server/lib/config";
import { createLogger } from "@/server/lib/logger";
import { createSignedStorageUrl } from "@/server/lib/supabase-admin";
import { fetchWithRetry } from "@/server/lib/external-fetch";

export const UTILITY_BILL_BUCKET = "utility-bills";

export interface ExtractedUtilityBillCandidate {
  utilityType: UtilityBillUtilityType;
  unit: EnergyUnit;
  periodStart: Date;
  periodEnd: Date;
  consumption: number;
  confidence: number;
  extractionMethod: UtilityBillExtractionMethod;
  sourcePage: number | null;
  sourceSnippet: string | null;
  rawResult: Record<string, unknown>;
}

export interface UtilityBillExtractionResult {
  textSourceMethod: UtilityBillExtractionMethod;
  rawText: string;
  rawOcr: Record<string, unknown>;
  rawHeuristic: Record<string, unknown>;
  rawGemini: Record<string, unknown>;
  candidates: ExtractedUtilityBillCandidate[];
}

type DateMatch = {
  start: Date;
  end: Date;
  snippet: string;
  index: number;
};

type UsageMatch = {
  consumption: number;
  unit: EnergyUnit;
  snippet: string;
  index: number;
  score: number;
};

const MONTH_NAME_PATTERN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripOrdinals(value: string) {
  return value.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
}

function parseDateValue(value: string) {
  const parsed = new Date(stripOrdinals(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toEnergyUnit(unitText: string): EnergyUnit | null {
  const normalized = unitText.trim().toLowerCase();

  if (normalized === "kwh" || normalized === "kw-h" || normalized === "kilowatt hours") {
    return "KWH";
  }

  if (normalized === "therm" || normalized === "therms") {
    return "THERMS";
  }

  if (normalized === "gal" || normalized === "gallon" || normalized === "gallons") {
    return "GAL";
  }

  if (normalized === "kgal" || normalized === "thousand gallons") {
    return "KGAL";
  }

  if (normalized === "ccf" || normalized === "hcf") {
    return "CCF";
  }

  if (normalized === "kbtu") {
    return "KBTU";
  }

  if (normalized === "mmbtu" || normalized === "mbtu") {
    return "MMBTU";
  }

  return null;
}

function formatSnippet(text: string, index: number, span = 220) {
  const start = Math.max(0, index - span / 2);
  const end = Math.min(text.length, index + span / 2);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractBillingPeriod(text: string): DateMatch | null {
  const candidates: DateMatch[] = [];
  const patterns = [
    new RegExp(
      `billing period\\s*[:\\-]?\\s*(${MONTH_NAME_PATTERN}\\s+\\d{1,2},\\s+\\d{4})\\s*(?:to|-)\\s*(${MONTH_NAME_PATTERN}\\s+\\d{1,2},\\s+\\d{4})`,
      "gi",
    ),
    new RegExp(
      `(${MONTH_NAME_PATTERN}\\s+\\d{1,2},\\s+\\d{4})\\s*(?:to|-)\\s*(${MONTH_NAME_PATTERN}\\s+\\d{1,2},\\s+\\d{4})`,
      "gi",
    ),
    /billing period\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = parseDateValue(match[1] ?? "");
      const end = parseDateValue(match[2] ?? "");
      if (!start || !end || start > end) {
        continue;
      }

      candidates.push({
        start,
        end,
        snippet: match[0],
        index: match.index,
      });
    }
  }

  return candidates.sort((left, right) => left.index - right.index)[0] ?? null;
}

function looksLikeHistorySnippet(snippet: string) {
  const lower = snippet.toLowerCase();
  const historySignals = [
    "usage history",
    "energy usage history",
    "monthly electric use chart",
    "daily temperature averages",
  ];

  if (historySignals.some((signal) => lower.includes(signal))) {
    return true;
  }

  const monthMatches = lower.match(
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g,
  );
  return (monthMatches?.length ?? 0) >= 5;
}

function parseNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectUtilityTypes(text: string): UtilityBillUtilityType[] {
  const lower = text.toLowerCase();
  const types = new Set<UtilityBillUtilityType>();

  if (
    lower.includes("electricity") ||
    lower.includes("electric charges") ||
    lower.includes("electric supply") ||
    /\bkwh\b/i.test(text)
  ) {
    types.add("ELECTRIC");
  }

  if (
    lower.includes("natural gas") ||
    lower.includes("gas charges") ||
    /\btherms?\b/i.test(text)
  ) {
    types.add("GAS");
  }

  if (
    lower.includes("water") ||
    /\bkgal\b/i.test(text) ||
    /\bgallons?\b/i.test(text)
  ) {
    types.add("WATER");
  }

  if (types.size === 0 && /\bccf\b/i.test(text)) {
    types.add(lower.includes("gas") ? "GAS" : "WATER");
  }

  return Array.from(types);
}

function utilityUnitPatterns(
  utilityType: UtilityBillUtilityType,
): Array<{ regex: RegExp; unit: EnergyUnit; score: number }> {
  switch (utilityType) {
    case "ELECTRIC":
      return [
        {
          regex: /total use[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)\b/gi,
          unit: "KWH",
          score: 1,
        },
        {
          regex: /used this period[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)\b/gi,
          unit: "KWH",
          score: 0.95,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*kwh\b/gi,
          unit: "KWH",
          score: 0.8,
        },
      ];
    case "GAS":
      return [
        {
          regex: /total use[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)\b/gi,
          unit: "THERMS",
          score: 1,
        },
        {
          regex: /used this period[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)\b/gi,
          unit: "THERMS",
          score: 0.95,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*therms?\b/gi,
          unit: "THERMS",
          score: 0.8,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*ccf\b/gi,
          unit: "CCF",
          score: 0.7,
        },
      ];
    case "WATER":
      return [
        {
          regex: /total use[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)\b/gi,
          unit: "GAL",
          score: 0.9,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*kgal\b/gi,
          unit: "KGAL",
          score: 0.9,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*gallons?\b/gi,
          unit: "GAL",
          score: 0.8,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*gal\b/gi,
          unit: "GAL",
          score: 0.75,
        },
        {
          regex: /([0-9][0-9,]*(?:\.\d+)?)\s*ccf\b/gi,
          unit: "CCF",
          score: 0.7,
        },
      ];
  }
}

function extractUsageMatch(input: {
  text: string;
  utilityType: UtilityBillUtilityType;
  billingPeriod: DateMatch | null;
}) {
  const searchStart = input.billingPeriod
    ? Math.max(0, input.billingPeriod.index - 200)
    : 0;
  const searchEnd = input.billingPeriod
    ? Math.min(input.text.length, input.billingPeriod.index + 2_000)
    : Math.min(input.text.length, 2_500);
  const searchWindow = input.text.slice(searchStart, searchEnd);
  const matches: UsageMatch[] = [];

  for (const pattern of utilityUnitPatterns(input.utilityType)) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(searchWindow)) !== null) {
      const consumption = parseNumber(match[1] ?? "");
      if (consumption == null) {
        continue;
      }

      const absoluteIndex = searchStart + match.index;
      const snippet = formatSnippet(input.text, absoluteIndex);
      if (looksLikeHistorySnippet(snippet)) {
        continue;
      }

      const scoreBoost =
        input.billingPeriod &&
        absoluteIndex >= input.billingPeriod.index - 150 &&
        absoluteIndex <= input.billingPeriod.index + 1_200
          ? 0.1
          : 0;

      matches.push({
        consumption,
        unit: pattern.unit,
        snippet,
        index: absoluteIndex,
        score: pattern.score + scoreBoost,
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildHeuristicCandidates(text: string) {
  const billingPeriod = extractBillingPeriod(text);
  const utilityTypes = detectUtilityTypes(text);
  const candidates: ExtractedUtilityBillCandidate[] = [];

  for (const utilityType of utilityTypes) {
    const usage = extractUsageMatch({
      text,
      utilityType,
      billingPeriod,
    });

    if (!usage || !billingPeriod) {
      continue;
    }

    candidates.push({
      utilityType,
      unit: usage.unit,
      periodStart: billingPeriod.start,
      periodEnd: billingPeriod.end,
      consumption: usage.consumption,
      confidence: Math.min(0.99, usage.score),
      extractionMethod: "HEURISTIC",
      sourcePage: null,
      sourceSnippet: usage.snippet,
      rawResult: {
        billingPeriodSnippet: billingPeriod.snippet,
        usageSnippet: usage.snippet,
        usageIndex: usage.index,
      },
    });
  }

  return {
    billingPeriod,
    utilityTypes,
    candidates,
  };
}

export function extractHeuristicUtilityBillCandidatesFromText(rawText: string) {
  return buildHeuristicCandidates(normalizeText(rawText)).candidates;
}

async function extractPdfText(fileBuffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: fileBuffer });

  try {
    const parsed = await parser.getText();
    return parsed.text;
  } finally {
    await parser.destroy();
  }
}

function extractTextFromOcrResponse(response: Record<string, unknown>) {
  const parsedResults = Array.isArray(response.ParsedResults)
    ? (response.ParsedResults as Array<Record<string, unknown>>)
    : [];
  const text = parsedResults
    .map((result) => String(result.ParsedText ?? ""))
    .join("\n")
    .trim();

  return {
    text,
    firstPageNumber:
      typeof parsedResults[0]?.PageNumber === "number"
        ? (parsedResults[0]?.PageNumber as number)
        : null,
  };
}

async function runOcrSpace(input: {
  bucketName: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
}) {
  const signedUrl = await createSignedStorageUrl({
    bucketName: input.bucketName,
    storagePath: input.storagePath,
    expiresInSeconds: 10 * 60,
  });

  const formData = new FormData();
  formData.set("url", signedUrl);
  formData.set("language", "eng");
  formData.set("detectOrientation", "true");
  formData.set("scale", "true");
  formData.set("isTable", "true");
  formData.set("isOverlayRequired", "false");
  formData.set("OCREngine", "2");
  formData.set("filetype", input.mimeType === "application/pdf" ? "pdf" : "jpg");

  const response = await fetchWithRetry({
    url: "https://api.ocr.space/parse/image",
    timeoutMs: 45_000,
    maxAttempts: 3,
    init: {
      method: "POST",
      headers: {
        apikey: getOcrSpaceApiKey(),
      },
      body: formData,
    },
  });

  if (!response.ok) {
    throw new Error(`OCR.space request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.IsErroredOnProcessing === true) {
    const message =
      Array.isArray(payload.ErrorMessage) && payload.ErrorMessage.length > 0
        ? payload.ErrorMessage.join("; ")
        : typeof payload.ErrorMessage === "string"
          ? payload.ErrorMessage
          : "OCR.space could not parse the uploaded bill.";
    throw new Error(message);
  }

  return payload;
}

function pdfTextLooksReadable(text: string) {
  const normalized = normalizeText(text);
  return normalized.length >= 80 && /[A-Za-z]/.test(normalized) && /\d/.test(normalized);
}

function parseGeminiJson(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates)
    ? (payload.candidates as Array<Record<string, unknown>>)
    : [];
  const text = candidates
    .flatMap((candidate) => {
      const content = candidate.content;
      if (!content || typeof content !== "object") {
        return [];
      }

      const parts = Array.isArray((content as { parts?: unknown[] }).parts)
        ? ((content as { parts: Array<Record<string, unknown>> }).parts)
        : [];
      return parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter(Boolean);
    })
    .join("");

  if (!text) {
    return null;
  }

  return JSON.parse(text) as { candidates?: Array<Record<string, unknown>> };
}

async function runGeminiFallback(input: {
  rawText: string;
  heuristicSummary: Record<string, unknown>;
}) {
  const gemini = getOptionalGeminiConfig();
  if (!gemini) {
    return null;
  }

  const prompt = [
    "Extract only the current billed-period utility reading(s) from this utility bill text.",
    "Ignore any historical comparison charts, 12-month usage history tables, and year-over-year trend tables.",
    "Return an array of candidates, each with utilityType (ELECTRIC, GAS, WATER), startDate, endDate, usage, unit (KWH, THERMS, GAL, KGAL, CCF, KBTU, MMBTU), confidence (0-1), and sourceSnippet.",
    "If a field is not clearly present, omit that candidate instead of guessing.",
    "",
    "Heuristic summary:",
    JSON.stringify(input.heuristicSummary),
    "",
    "Bill text:",
    input.rawText.slice(0, 18_000),
  ].join("\n");

  const response = await fetchWithRetry({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${gemini.model}:generateContent`,
    timeoutMs: 30_000,
    maxAttempts: 3,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    },
  });

  if (!response.ok) {
    throw new Error(`Gemini fallback failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const parsed = parseGeminiJson(payload);
  if (!parsed) {
    return {
      raw: payload,
      candidates: [] as ExtractedUtilityBillCandidate[],
    };
  }

  const extracted = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: ExtractedUtilityBillCandidate[] = [];

  for (const candidate of extracted) {
    const utilityType = candidate.utilityType;
    const unit = candidate.unit;
    const periodStart = typeof candidate.startDate === "string"
      ? parseDateValue(candidate.startDate)
      : null;
    const periodEnd = typeof candidate.endDate === "string"
      ? parseDateValue(candidate.endDate)
      : null;
    const consumption =
      typeof candidate.usage === "number"
        ? candidate.usage
        : typeof candidate.usage === "string"
          ? parseNumber(candidate.usage)
          : null;
    const normalizedUnit = typeof unit === "string" ? toEnergyUnit(unit) : null;

    if (
      utilityType !== "ELECTRIC" &&
      utilityType !== "GAS" &&
      utilityType !== "WATER"
    ) {
      continue;
    }

    if (!periodStart || !periodEnd || !normalizedUnit || consumption == null) {
      continue;
    }

    candidates.push({
      utilityType,
      unit: normalizedUnit,
      periodStart,
      periodEnd,
      consumption,
      confidence:
        typeof candidate.confidence === "number"
          ? Math.min(1, Math.max(0, candidate.confidence))
          : 0.6,
      extractionMethod: "GEMINI_FALLBACK",
      sourcePage: null,
      sourceSnippet:
        typeof candidate.sourceSnippet === "string" ? candidate.sourceSnippet : null,
      rawResult: candidate,
    });
  }

  return {
    raw: payload,
    candidates,
  };
}

export async function extractUtilityBillCandidates(input: {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  bucketName: string;
  storagePath: string;
  requestId?: string | null;
}) {
  const logger = createLogger({
    requestId: input.requestId ?? null,
    procedure: "utilityBills.extract",
    fileName: input.fileName,
  });
  let rawText = "";
  let rawOcr: Record<string, unknown> = {};
  let rawGemini: Record<string, unknown> = {};
  let textSourceMethod: UtilityBillExtractionMethod = "OCR_SPACE";

  if (input.mimeType === "application/pdf") {
    try {
      const pdfText = await extractPdfText(input.fileBuffer);
      if (pdfTextLooksReadable(pdfText)) {
        rawText = normalizeText(pdfText);
        textSourceMethod = "PDF_TEXT";
      }
    } catch (error) {
      logger.warn("PDF text extraction failed; falling back to OCR", { error });
    }
  }

  if (!rawText) {
    rawOcr = await runOcrSpace({
      bucketName: input.bucketName,
      storagePath: input.storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });
    const ocr = extractTextFromOcrResponse(rawOcr);
    rawText = normalizeText(ocr.text);
    textSourceMethod = "OCR_SPACE";
  }

  if (!rawText) {
    throw new Error("No readable text was extracted from the uploaded bill.");
  }

  const heuristic = buildHeuristicCandidates(rawText);
  let candidates = heuristic.candidates;

  const shouldTryGemini =
    candidates.length === 0 || candidates.some((candidate) => candidate.confidence < 0.75);

  if (shouldTryGemini) {
    try {
      const gemini = await runGeminiFallback({
        rawText,
        heuristicSummary: {
          billingPeriod: heuristic.billingPeriod,
          utilityTypes: heuristic.utilityTypes,
          candidates: heuristic.candidates.map((candidate) => ({
            utilityType: candidate.utilityType,
            unit: candidate.unit,
            periodStart: candidate.periodStart.toISOString(),
            periodEnd: candidate.periodEnd.toISOString(),
            consumption: candidate.consumption,
            confidence: candidate.confidence,
          })),
        },
      });
      if (gemini) {
        rawGemini = gemini.raw;
        if (gemini.candidates.length > 0) {
          candidates = gemini.candidates;
          textSourceMethod = "GEMINI_FALLBACK";
        }
      }
    } catch (error) {
      logger.warn("Gemini fallback extraction failed", { error });
    }
  }

  return {
    textSourceMethod,
    rawText,
    rawOcr,
    rawHeuristic: {
      billingPeriod: heuristic.billingPeriod
        ? {
            start: heuristic.billingPeriod.start.toISOString(),
            end: heuristic.billingPeriod.end.toISOString(),
            snippet: heuristic.billingPeriod.snippet,
          }
        : null,
      utilityTypes: heuristic.utilityTypes,
      candidates: heuristic.candidates.map((candidate) => ({
        utilityType: candidate.utilityType,
        unit: candidate.unit,
        periodStart: candidate.periodStart.toISOString(),
        periodEnd: candidate.periodEnd.toISOString(),
        consumption: candidate.consumption,
        confidence: candidate.confidence,
        sourceSnippet: candidate.sourceSnippet,
      })),
    },
    rawGemini,
    candidates,
  } satisfies UtilityBillExtractionResult;
}
