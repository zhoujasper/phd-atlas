import { describe, expect, it } from "vitest";
import { extractReleaseNotes } from "../tools/extract-release-notes.mjs";

describe("extractReleaseNotes", () => {
  it("extracts only the exact version section", () => {
    const notes = [
      "# Notes",
      "",
      "## v1.2.3",
      "",
      "First body.",
      "",
      "### Detail",
      "",
      "More.",
      "",
      "## v1.2.2",
      "",
      "Older body.",
    ].join("\n");

    expect(extractReleaseNotes(notes, "1.2.3")).toBe(
      ["First body.", "", "### Detail", "", "More."].join("\n"),
    );
  });

  it("normalizes CRLF input", () => {
    expect(
      extractReleaseNotes(
        "## v0.1.0-beta.2\r\n\r\nBeta notes.\r\n",
        "0.1.0-beta.2",
      ),
    ).toBe("Beta notes.");
  });

  it("rejects missing, duplicate, and empty sections", () => {
    expect(() => extractReleaseNotes("## v1.0.0\n\nNotes.", "1.0.1")).toThrow(
      "found 0",
    );
    expect(() =>
      extractReleaseNotes("## v1.0.0\n\nOne.\n\n## v1.0.0\n\nTwo.", "1.0.0"),
    ).toThrow("found 2");
    expect(() => extractReleaseNotes("## v1.0.0\n\n", "1.0.0")).toThrow(
      "is empty",
    );
  });

  it("rejects non-SemVer version selectors", () => {
    expect(() => extractReleaseNotes("## vnext\n\nNotes.", "next")).toThrow(
      "Invalid release-note version",
    );
  });
});
