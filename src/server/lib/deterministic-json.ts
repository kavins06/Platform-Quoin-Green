import crypto from "node:crypto";

export function stableStringify(value: unknown): string {
  if (typeof value === "bigint") {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof (value as { toJSON?: () => unknown }).toJSON === "function") {
    return stableStringify((value as { toJSON: () => unknown }).toJSON());
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function stringifyDeterministicJson(value: unknown) {
  return JSON.stringify(JSON.parse(stableStringify(value)) as unknown, null, 2);
}

export function hashDeterministicJson(value: unknown) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function slugifyFileSegment(value: string | null | undefined, fallback = "packet") {
  return (value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}
