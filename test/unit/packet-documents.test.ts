import { describe, expect, it } from "vitest";
import {
  renderPacketDocumentHtml,
  renderPacketDocumentPdfBase64,
} from "@/server/rendering/packet-documents";

describe("packet document rendering", () => {
  it("renders a sparse but valid packet document to HTML and PDF", async () => {
    const document = {
      title: "Benchmark Verification Packet",
      subtitle: "Example building - reporting year 2025",
      disposition: {
        label: "Blocked",
        tone: "danger" as const,
      },
      metadata: [
        { label: "Building", value: "Example building" },
        { label: "Reporting year", value: "2025" },
      ],
      summary: ["Resolve missing verifier support."],
      sections: [
        {
          title: "Blockers and warnings",
          bullets: ["DC Real Property Unique ID is missing."],
        },
      ],
    };

    const html = renderPacketDocumentHtml(document);
    const pdfBase64 = await renderPacketDocumentPdfBase64(document);
    const pdfText = Buffer.from(pdfBase64, "base64").toString("latin1");

    expect(html).toContain("Benchmark Verification Packet");
    expect(html).toContain("Resolve missing verifier support.");
    expect(pdfBase64.startsWith("JVBER")).toBe(true);
    expect(pdfText).toContain("%PDF-1.3");
    expect(pdfText).toContain("Benchmark Verification Packet");
  });
});
