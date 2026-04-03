import { describe, expect, it } from "vitest";
import {
  hashDeterministicJson,
  slugifyFileSegment,
  stableStringify,
  stringifyDeterministicJson,
} from "@/server/lib/deterministic-json";

describe("deterministic json helpers", () => {
  it("produces the same hash for logically equivalent objects", () => {
    const left = {
      beta: 2,
      alpha: 1,
      nested: {
        zeta: "value",
        eta: [3, 2, 1],
      },
    };
    const right = {
      nested: {
        eta: [3, 2, 1],
        zeta: "value",
      },
      alpha: 1,
      beta: 2,
    };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(hashDeterministicJson(left)).toBe(hashDeterministicJson(right));
    expect(stringifyDeterministicJson(left)).toBe(stringifyDeterministicJson(right));
  });

  it("handles bigint, dates, and safe file slugs deterministically", () => {
    const value = {
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      propertyId: BigInt("19879255"),
    };

    expect(stableStringify(value)).toContain("$bigint");
    expect(stableStringify(value)).toContain("2026-03-16T12:00:00.000Z");
    expect(slugifyFileSegment("  640 Mass / Cycle 2 Packet  ")).toBe(
      "640-mass-cycle-2-packet",
    );
  });
});
