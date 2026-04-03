import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractHeuristicUtilityBillCandidatesFromText } from "@/server/utility-bills/extract";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("utility bill upload", () => {
  it("extracts the Pepco billed-period reading and ignores the history table", () => {
    const candidates = extractHeuristicUtilityBillCandidatesFromText(`
      Account number: 1234 5678 910
      January 29, 2025 to February 25, 2025
      Details of your Electric Charges
      Electricity you used this period

      Meter Number ABC123456789
      Energy Type Use (kWh)
      End Date Feb 25 2025
      Start Date Jan 29 2025
      Number Of Days 28
      Total Use 996

      Billing Period: Jan 29, 2025 to Feb 25, 2025 (28 days)
      Your monthly Electricity use in kWh
      Energy Usage History
      Feb 24 Mar 24 Apr 24 May 24 Jun 24 Jul 24 Aug 24 Sep 24 Oct 24 Nov 24 Dec 24 Jan 25 Feb 25
      kWh 766 650 553 433 398 634 442 423 360 395 834 1233 996
    `);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.utilityType).toBe("ELECTRIC");
    expect(candidates[0]?.unit).toBe("KWH");
    expect(candidates[0]?.consumption).toBe(996);
    expect(candidates[0]?.periodStart.toISOString().slice(0, 10)).toBe("2025-01-29");
    expect(candidates[0]?.periodEnd.toISOString().slice(0, 10)).toBe("2025-02-25");
    expect(candidates[0]?.sourceSnippet?.toLowerCase()).not.toContain("energy usage history");
  });

  it("wires bill upload through review before the building table shows bill-derived rows", () => {
    const uploadModalSource = readRepoFile("src/components/building/upload-modal.tsx");
    const uploadRouteSource = readRepoFile("src/app/api/upload-bill/route.ts");
    const serviceSource = readRepoFile("src/server/utility-bills/service.ts");
    const overviewSource = readRepoFile("src/components/building/building-overview-tab.tsx");

    expect(uploadModalSource).toContain("Bill upload");
    expect(uploadModalSource).toContain("Review extracted bill data");
    expect(uploadModalSource).toContain("Confirm and save");
    expect(uploadRouteSource).toContain("createUtilityBillUpload");
    expect(serviceSource).toContain('source: "BILL_UPLOAD"');
    expect(serviceSource).toContain("UTILITY_BILL_BUCKET");
    expect(serviceSource).toContain("utility-bill-");
    expect(overviewSource).toContain('case "BILL_UPLOAD"');
    expect(overviewSource).toContain("Bill upload");
  });
});
