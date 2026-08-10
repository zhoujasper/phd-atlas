import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ProfileAssetExportLimitError,
  toProfileAssetPdfBuffer,
  toProfileAssetWordBuffer,
} from "./profileAssetExport.js";

const PRIVATE_SECTION_TITLE = "PRIVATE SECTION CANARY TITLE";
const PRIVATE_SECTION_CONTENT = "PRIVATE SECTION CANARY CONTENT";
const execFileAsync = promisify(execFile);

const asset = {
  name: "Research statement",
  kind: "ResearchStatement",
  description:
    "# Research direction\n\nI study **reliable systems**.\n\n- Verification\n- Human-centered tooling",
  notes: "PRIVATE: do not export this editorial note",
  writingBrief: {
    requirements: "PRIVATE: official prompt for internal drafting only",
    sourceUrl: "https://example.edu/private-requirements",
    wordLimit: 1_000,
    pageLimit: 2,
    customFields: [],
    sections: [
      {
        id: "private-section",
        title: PRIVATE_SECTION_TITLE,
        content: PRIVATE_SECTION_CONTENT,
        width: "half",
      },
    ],
  },
};

function normalizeVolatilePdfMetadata(buffer) {
  return buffer
    .toString("latin1")
    .replace(/\(D:\d{14}Z\)/g, "(D:DATEZ)")
    .replace(/\/ID \[<[^>]+> <[^>]+>\]/g, "/ID [<ID> <ID>]");
}

describe("profile material export", () => {
  it("creates a complete PDF buffer with the expected PDF header", async () => {
    const pdf = await toProfileAssetPdfBuffer(asset, { language: "en" });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-16).toString()).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it("qualifies parallel minimal PDFs without one full-cap allocation per export", async () => {
    const minimal = {
      name: "Minimal statement",
      kind: "Document",
      description: "A short statement.",
      writingBrief: { customFields: [] },
    };
    const pdfs = await Promise.all(
      Array.from({ length: 4 }, () =>
        toProfileAssetPdfBuffer(minimal, { language: "en" }),
      ),
    );

    for (const pdf of pdfs) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      // Small Node buffers may share one 8 KiB pool, but must not retain the
      // former 12 MiB collector ceiling behind each response view.
      expect(pdf.buffer.byteLength).toBeLessThanOrEqual(8 * 1024);
    }
    expect(pdfs.reduce((bytes, pdf) => bytes + pdf.length, 0)).toBeLessThan(
      16 * 1024,
    );
  });

  it("keeps four parallel minimal PDFs inside a bounded isolated-process memory envelope", async () => {
    const moduleUrl = pathToFileURL(
      path.resolve(process.cwd(), "server/profileAssetExport.js"),
    ).href;
    const script = `
      import { toProfileAssetPdfBuffer } from ${JSON.stringify(moduleUrl)};
      const asset = { name: 'Minimal', kind: 'Document', description: 'A short statement.', writingBrief: { customFields: [] } };
      global.gc();
      const before = process.memoryUsage();
      const pdfs = await Promise.all(Array.from({ length: 4 }, () => toProfileAssetPdfBuffer(asset, { language: 'en' })));
      const after = process.memoryUsage();
      process.stdout.write(JSON.stringify({
        count: pdfs.length,
        externalDelta: Math.max(0, after.external - before.external),
        rssDelta: Math.max(0, after.rss - before.rss),
        maxBackingBytes: Math.max(...pdfs.map((pdf) => pdf.buffer.byteLength)),
      }));
    `;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--expose-gc", "--input-type=module", "--eval", script],
      { timeout: 30_000, maxBuffer: 64 * 1024 },
    );
    const evidence = JSON.parse(stdout);

    expect(evidence.count).toBe(4);
    expect(evidence.maxBackingBytes).toBeLessThanOrEqual(8 * 1024);
    // These envelopes leave generous allocator/CI headroom but catch the old
    // eager all-language font registration and four 12 MiB preallocations.
    expect(evidence.externalDelta).toBeLessThan(48 * 1024 * 1024);
    expect(evidence.rssDelta).toBeLessThan(128 * 1024 * 1024);
  });

  it("escapes authored markup and never exports private drafting context", () => {
    const word = toProfileAssetWordBuffer(
      {
        ...asset,
        name: "SOP <final>",
        description:
          '# Why this program\n\n<script>alert("unsafe")</script> & **evidence**',
      },
      { language: "zh-CN" },
    ).toString("utf8");

    expect(word).toContain("SOP &lt;final&gt;");
    expect(word).toContain(
      "&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; evidence",
    );
    expect(word).not.toContain("<script>");
    expect(word).not.toContain(asset.notes);
    expect(word).not.toContain(asset.writingBrief.requirements);
    expect(word).not.toContain(asset.writingBrief.sourceUrl);
    expect(word).not.toContain(PRIVATE_SECTION_TITLE);
    expect(word).not.toContain(PRIVATE_SECTION_CONTENT);
  });

  it("keeps private sections out of PDF and Word output", async () => {
    const withoutPrivateSections = {
      ...asset,
      writingBrief: { ...asset.writingBrief, sections: [] },
    };

    const [privatePdf, baselinePdf] = await Promise.all([
      toProfileAssetPdfBuffer(asset, { language: "en" }),
      toProfileAssetPdfBuffer(withoutPrivateSections, { language: "en" }),
    ]);
    const privateWord = toProfileAssetWordBuffer(asset, {
      language: "en",
    }).toString("utf8");

    expect(normalizeVolatilePdfMetadata(privatePdf)).toBe(
      normalizeVolatilePdfMetadata(baselinePdf),
    );
    expect(privateWord).not.toContain(PRIVATE_SECTION_TITLE);
    expect(privateWord).not.toContain(PRIVATE_SECTION_CONTENT);
  });

  it("includes only custom fields explicitly approved for export", () => {
    const word = toProfileAssetWordBuffer({
      ...asset,
      writingBrief: {
        ...asset.writingBrief,
        customFields: [
          {
            id: "audience",
            label: "Intended audience",
            value: "Admissions committee",
            includeInExport: true,
            placement: "beforeBody",
          },
          {
            id: "closing",
            label: "Closing emphasis",
            value: "Long-term collaboration",
            includeInExport: true,
            placement: "afterBody",
          },
          {
            id: "editor-note",
            label: "Internal angle",
            value: "Emphasize lab fit",
            includeInExport: false,
          },
          {
            id: "empty",
            label: "Empty field",
            value: "",
            includeInExport: true,
          },
        ],
      },
    }).toString("utf8");

    expect(word).toContain("Intended audience");
    expect(word).toContain("Admissions committee");
    expect(word).toContain("Closing emphasis");
    expect(word.indexOf("Intended audience")).toBeLessThan(
      word.indexOf("Research direction"),
    );
    expect(word.indexOf("Closing emphasis")).toBeGreaterThan(
      word.indexOf("Human-centered tooling"),
    );
    expect(word).not.toContain("Internal angle");
    expect(word).not.toContain("Emphasize lab fit");
    expect(word).not.toContain("Empty field");
  });

  it("rejects pathological many-heading input before PDF or Word rendering", async () => {
    const pathological = {
      ...asset,
      description: "# a\n\n".repeat(50_000),
    };

    await expect(toProfileAssetPdfBuffer(pathological)).rejects.toMatchObject({
      code: "PROFILE_ASSET_EXPORT_TOO_LARGE",
      status: 413,
    });
    expect(() => toProfileAssetWordBuffer(pathological)).toThrow(
      ProfileAssetExportLimitError,
    );
  });

  it("fails closed instead of truncating when either generated format crosses its byte cap", async () => {
    await expect(
      toProfileAssetPdfBuffer(asset, { maxOutputBytes: 1_024 }),
    ).rejects.toMatchObject({ code: "PROFILE_ASSET_EXPORT_TOO_LARGE" });
    expect(() =>
      toProfileAssetWordBuffer(asset, { maxOutputBytes: 1_024 }),
    ).toThrow(ProfileAssetExportLimitError);
  });

  it("rejects one pathological layout block before PDFKit measures it", async () => {
    const pathological = {
      ...asset,
      description: "a".repeat(64 * 1024 + 1),
    };

    await expect(toProfileAssetPdfBuffer(pathological)).rejects.toMatchObject({
      code: "PROFILE_ASSET_EXPORT_TOO_LARGE",
      reason: "block",
    });
    expect(() => toProfileAssetWordBuffer(pathological)).toThrow(
      ProfileAssetExportLimitError,
    );
  });
});
