import PDFDocument from "pdfkit";
import { PacketRenderError } from "@/server/lib/errors";

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;

export type PacketDocumentTone = "success" | "warning" | "danger" | "info" | "muted";

export type PacketDocumentEntry = {
  label: string;
  value: string;
};

export type PacketDocumentTable = {
  columns: string[];
  rows: string[][];
};

export type PacketDocumentSection = {
  title: string;
  paragraphs?: string[];
  entries?: PacketDocumentEntry[];
  bullets?: string[];
  table?: PacketDocumentTable;
};

export type PacketDocumentAppendix = {
  title: string;
  content: string;
};

export type PacketRenderDocument = {
  title: string;
  subtitle?: string;
  disposition?: {
    label: string;
    tone: PacketDocumentTone;
  };
  metadata?: PacketDocumentEntry[];
  summary?: string[];
  sections: PacketDocumentSection[];
  appendices?: PacketDocumentAppendix[];
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEntriesHtml(entries: PacketDocumentEntry[]) {
  return `
    <dl class="kv-grid">
      ${entries
        .map(
          (entry) => `
            <div class="kv-item">
              <dt>${escapeHtml(entry.label)}</dt>
              <dd>${escapeHtml(entry.value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
}

function renderTableHtml(table: PacketDocumentTable) {
  return `
    <table>
      <thead>
        <tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${table.rows
          .map(
            (row) => `
              <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

export function renderPacketDocumentHtml(document: PacketRenderDocument) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(document.title)}</title>`,
    "<style>",
    `
      @page { margin: 24mm 16mm 20mm 16mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Helvetica, Arial, sans-serif;
        color: #18181b;
        background: #ffffff;
        font-size: 12px;
        line-height: 1.45;
      }
      .document {
        width: 100%;
      }
      .cover {
        border-bottom: 2px solid #e4e4e7;
        padding-bottom: 16px;
        margin-bottom: 18px;
      }
      .eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #71717a;
        margin-bottom: 10px;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
      }
      .subtitle {
        margin-top: 8px;
        color: #52525b;
        font-size: 13px;
      }
      .badge {
        display: inline-block;
        margin-top: 12px;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .badge.success { background: #dcfce7; color: #166534; }
      .badge.warning { background: #fef3c7; color: #92400e; }
      .badge.danger { background: #fee2e2; color: #991b1b; }
      .badge.info { background: #dbeafe; color: #1d4ed8; }
      .badge.muted { background: #f4f4f5; color: #52525b; }
      .kv-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 16px;
        margin: 0;
      }
      .kv-item {
        border: 1px solid #e4e4e7;
        border-radius: 10px;
        padding: 10px 12px;
        background: #fafafa;
      }
      .kv-item dt {
        margin: 0;
        font-size: 10px;
        font-weight: 700;
        color: #71717a;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .kv-item dd {
        margin: 6px 0 0;
        font-size: 13px;
        font-weight: 600;
        color: #18181b;
        white-space: pre-wrap;
      }
      .summary {
        margin: 16px 0 0;
        padding-left: 18px;
      }
      section {
        margin-top: 18px;
        page-break-inside: avoid;
      }
      h2 {
        margin: 0 0 10px;
        font-size: 15px;
        line-height: 1.3;
      }
      p {
        margin: 0 0 10px;
        color: #3f3f46;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li { margin: 0 0 6px; }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      thead th {
        text-align: left;
        background: #f4f4f5;
        border: 1px solid #d4d4d8;
        padding: 8px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      tbody td {
        border: 1px solid #e4e4e7;
        padding: 8px;
        vertical-align: top;
        font-size: 11px;
        color: #27272a;
        white-space: pre-wrap;
        word-break: break-word;
      }
      pre {
        margin: 0;
        padding: 12px;
        background: #fafafa;
        border: 1px solid #e4e4e7;
        border-radius: 10px;
        font-family: "Courier New", monospace;
        font-size: 10px;
        white-space: pre-wrap;
      }
    `,
    "</style>",
    "</head>",
    "<body>",
    '<main class="document">',
    '<header class="cover">',
    '<div class="eyebrow">Quoin compliance delivery packet</div>',
    `<h1>${escapeHtml(document.title)}</h1>`,
    document.subtitle ? `<p class="subtitle">${escapeHtml(document.subtitle)}</p>` : "",
    document.disposition
      ? `<div class="badge ${document.disposition.tone}">${escapeHtml(document.disposition.label)}</div>`
      : "",
    document.metadata?.length ? renderEntriesHtml(document.metadata) : "",
    document.summary?.length
      ? `<ul class="summary">${document.summary
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "",
    "</header>",
    ...document.sections.map((section) =>
      [
        "<section>",
        `<h2>${escapeHtml(section.title)}</h2>`,
        ...(section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
        section.entries?.length ? renderEntriesHtml(section.entries) : "",
        section.bullets?.length
          ? `<ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : "",
        section.table ? renderTableHtml(section.table) : "",
        "</section>",
      ].join(""),
    ),
    ...(document.appendices ?? []).map((appendix) =>
      [
        "<section>",
        `<h2>${escapeHtml(appendix.title)}</h2>`,
        `<pre>${escapeHtml(appendix.content)}</pre>`,
        "</section>",
      ].join(""),
    ),
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function ensurePdfSpace(doc: PdfDocumentInstance, height: number) {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > limit) {
    doc.addPage();
  }
}

function toneColors(tone: PacketDocumentTone) {
  switch (tone) {
    case "success":
      return { fill: "#dcfce7", text: "#166534" };
    case "warning":
      return { fill: "#fef3c7", text: "#92400e" };
    case "danger":
      return { fill: "#fee2e2", text: "#991b1b" };
    case "info":
      return { fill: "#dbeafe", text: "#1d4ed8" };
    default:
      return { fill: "#f4f4f5", text: "#52525b" };
  }
}

function renderPdfEntries(doc: PdfDocumentInstance, entries: PacketDocumentEntry[]) {
  for (const entry of entries) {
    ensurePdfSpace(doc, 28);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#71717a")
      .text(entry.label.toUpperCase(), { continued: false });
    doc
      .moveDown(0.15)
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#18181b")
      .text(entry.value || "-", {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
    doc.moveDown(0.5);
  }
}

function renderPdfBullets(doc: PdfDocumentInstance, bullets: string[]) {
  for (const bullet of bullets) {
    ensurePdfSpace(doc, 20);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#27272a")
      .text(`- ${bullet}`, {
        indent: 12,
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
  }
  doc.moveDown(0.5);
}

function renderPdfTable(doc: PdfDocumentInstance, table: PacketDocumentTable) {
  const startX = doc.page.margins.left;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const columnCount = Math.max(table.columns.length, 1);
  const columnWidth = (availableWidth - gap * (columnCount - 1)) / columnCount;

  const renderRow = (
    row: string[],
    options: {
      bold?: boolean;
      fill?: string;
      stroke?: string;
      text?: string;
    } = {},
  ) => {
    const heights = row.map((cell) =>
      doc.heightOfString(cell || "-", {
        width: columnWidth,
        align: "left",
      }),
    );
    const rowHeight = Math.max(...heights, 16) + 8;
    ensurePdfSpace(doc, rowHeight + 10);
    const top = doc.y;

    if (options.fill) {
      doc.save();
      doc.rect(startX, top - 2, availableWidth, rowHeight + 4).fill(options.fill);
      doc.restore();
    }

    let x = startX;
    row.forEach((cell, index) => {
      doc
        .font(options.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(options.bold ? 9 : 10)
        .fillColor(options.text ?? (options.bold ? "#3f3f46" : "#18181b"))
        .text(cell || "-", x, top + 2, {
          width: columnWidth,
        });
      x += columnWidth + gap;
      if (index < row.length - 1) {
        doc
          .save()
          .moveTo(x - gap / 2, top)
          .lineTo(x - gap / 2, top + rowHeight)
          .strokeColor("#e4e4e7")
          .lineWidth(0.5)
          .stroke()
          .restore();
      }
    });

    doc
      .save()
      .moveTo(startX, top + rowHeight + 2)
      .lineTo(startX + availableWidth, top + rowHeight + 2)
      .strokeColor(options.stroke ?? "#d4d4d8")
      .lineWidth(0.5)
      .stroke()
      .restore();

    doc.y = top + rowHeight + 8;
  };

  renderRow(table.columns, {
    bold: true,
    fill: "#f4f4f5",
    stroke: "#d4d4d8",
    text: "#3f3f46",
  });

  for (const row of table.rows) {
    renderRow(row);
  }
}

export async function renderPacketDocumentPdfBase64(document: PacketRenderDocument) {
  return new Promise<string>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        autoFirstPage: true,
        compress: false,
        margin: 50,
        size: "LETTER",
        info: {
          Title: document.title,
          Author: "Quoin",
          Subject: "Compliance delivery packet",
        },
      });

      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("error", (error: Error) =>
        reject(
          new PacketRenderError("Packet PDF rendering failed.", {
            cause: error,
          }),
        ),
      );
      doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));

      doc.font("Helvetica-Bold").fontSize(10).fillColor("#71717a").text(
        "QUOIN COMPLIANCE DELIVERY PACKET",
        { characterSpacing: 1.2 },
      );
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(22).fillColor("#18181b").text(document.title);

      if (document.subtitle) {
        doc.moveDown(0.35);
        doc.font("Helvetica").fontSize(12).fillColor("#52525b").text(document.subtitle);
      }

      if (document.disposition) {
        const colors = toneColors(document.disposition.tone);
        doc.moveDown(0.75);
        doc.font("Helvetica-Bold").fontSize(10);
        const width = doc.widthOfString(document.disposition.label) + 18;
        const top = doc.y;
        doc.save();
        doc.roundedRect(doc.page.margins.left, top, width, 22, 10).fill(colors.fill);
        doc.restore();
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(colors.text)
          .text(document.disposition.label.toUpperCase(), doc.page.margins.left + 9, top + 6);
        doc.y = top + 28;
      } else {
        doc.moveDown(0.5);
      }

      if (document.metadata?.length) {
        renderPdfEntries(doc, document.metadata);
      }

      if (document.summary?.length) {
        renderPdfBullets(doc, document.summary);
      }

      for (const section of document.sections) {
        ensurePdfSpace(doc, 36);
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(15).fillColor("#18181b").text(section.title);
        doc.moveDown(0.3);

        for (const paragraph of section.paragraphs ?? []) {
          ensurePdfSpace(doc, 28);
          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor("#3f3f46")
            .text(paragraph, {
              width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            });
          doc.moveDown(0.4);
        }

        if (section.entries?.length) {
          renderPdfEntries(doc, section.entries);
        }

        if (section.bullets?.length) {
          renderPdfBullets(doc, section.bullets);
        }

        if (section.table) {
          renderPdfTable(doc, section.table);
        }
      }

      for (const appendix of document.appendices ?? []) {
        ensurePdfSpace(doc, 48);
        doc.addPage();
        doc.font("Helvetica-Bold").fontSize(15).fillColor("#18181b").text(appendix.title);
        doc.moveDown(0.5);
        doc
          .font("Courier")
          .fontSize(8)
          .fillColor("#27272a")
          .text(appendix.content, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          });
      }

      doc.end();
    } catch (error) {
      reject(
        new PacketRenderError("Packet PDF rendering failed.", {
          cause: error,
        }),
      );
    }
  });
}
