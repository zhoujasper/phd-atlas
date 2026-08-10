import { describe, expect, it } from "vitest";
import {
  countProfileDocumentWords,
  supportsProfileWritingBrief,
  writingBriefHasContent,
} from "./profileWritingBrief";

describe("profile writing brief", () => {
  it("recognizes authored application documents but not evidence bundles", () => {
    expect(supportsProfileWritingBrief("SOP")).toBe(true);
    expect(supportsProfileWritingBrief("CV")).toBe(true);
    expect(supportsProfileWritingBrief("Transcript")).toBe(false);
  });

  it("counts Latin words and CJK characters deterministically", () => {
    expect(countProfileDocumentWords("Research fit and 方法。")).toBe(5);
    expect(
      countProfileDocumentWords("## A focused plan\n\n- test-driven"),
    ).toBe(4);
  });

  it("treats limits and custom planning fields as brief content", () => {
    expect(writingBriefHasContent({ wordLimit: 1_000 })).toBe(true);
    expect(
      writingBriefHasContent({
        customFields: [
          { id: "x", label: "", value: "", includeInExport: false },
        ],
      }),
    ).toBe(false);
  });

  it("recognizes either a title or authored content in private writing sections", () => {
    expect(
      writingBriefHasContent({
        sections: [
          {
            id: "title-only",
            title: "Programme fit",
            content: "",
            width: "full",
          },
        ],
      }),
    ).toBe(true);
    expect(
      writingBriefHasContent({
        sections: [
          {
            id: "content-only",
            title: "",
            content: "Evidence to revisit",
            width: "half",
          },
        ],
      }),
    ).toBe(true);
    expect(
      writingBriefHasContent({
        sections: [{ id: "empty", title: "  ", content: "\n", width: "full" }],
      }),
    ).toBe(false);
  });
});
