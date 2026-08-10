import { describe, expect, it } from "vitest";
import {
  ProfileAssetCreateSchema,
  UserSettingsPatchSchema,
  parseOrThrow,
} from "./validation.js";
import { preserveUnspecifiedWritingBriefSections } from "./index.js";

describe("profile document and recommender workflow validation", () => {
  it("accepts private full/half sections while preserving legacy exportable custom fields", () => {
    const asset = parseOrThrow(ProfileAssetCreateSchema, {
      name: "Cambridge SOP",
      kind: "SOP",
      description: "Draft body",
      writingBrief: {
        requirements: "Explain research fit.",
        sourceUrl: "https://example.edu/sop",
        wordLimit: 1_000,
        pageLimit: 2,
        customFields: [
          {
            id: "fit",
            label: "Faculty fit",
            value: "Prof. Ada",
            includeInExport: true,
            placement: "afterBody",
          },
        ],
        sections: [
          {
            id: "programme-fit",
            title: "Programme fit",
            content: "Why this programme supports the proposed work.",
            width: "full",
          },
          {
            id: "evidence",
            title: "Evidence",
            content: "Two concise examples.",
            width: "half",
          },
        ],
      },
    });

    expect(asset.writingBrief.wordLimit).toBe(1_000);
    expect(asset.writingBrief.customFields[0].includeInExport).toBe(true);
    expect(asset.writingBrief.customFields[0].placement).toBe("afterBody");
    expect(asset.writingBrief.sections).toEqual([
      expect.objectContaining({ id: "programme-fit", width: "full" }),
      expect.objectContaining({ id: "evidence", width: "half" }),
    ]);
  });

  it("keeps saved sections when an older patch omits the key, but honors an explicit clear", () => {
    const savedSections = [
      {
        id: "saved-context",
        title: "Project context",
        content: "Private evidence",
        width: "half",
      },
    ];
    const asset = { writingBrief: { sections: savedSections } };
    const omittedPatch = { writingBrief: { requirements: "Updated prompt", sections: [] } };

    preserveUnspecifiedWritingBriefSections(
      omittedPatch,
      { writingBrief: { requirements: "Updated prompt" } },
      asset,
    );

    expect(omittedPatch.writingBrief.sections).toEqual(savedSections);
    expect(omittedPatch.writingBrief.sections).not.toBe(savedSections);

    const explicitClear = { writingBrief: { requirements: "Updated prompt", sections: [] } };
    preserveUnspecifiedWritingBriefSections(
      explicitClear,
      { writingBrief: { requirements: "Updated prompt", sections: [] } },
      asset,
    );
    expect(explicitClear.writingBrief.sections).toEqual([]);
  });

  it("accepts the personal recommender library and rejects malformed emails", () => {
    const valid = parseOrThrow(UserSettingsPatchSchema, {
      profileRecommenders: [
        { id: "rec-1", name: "Prof. Ada", email: "ada@example.edu" },
      ],
    });
    expect(valid.profileRecommenders[0].name).toBe("Prof. Ada");

    expect(() =>
      parseOrThrow(UserSettingsPatchSchema, {
        profileRecommenders: [
          { id: "rec-2", name: "Prof. Grace", email: "not-an-email" },
        ],
      }),
    ).toThrow();
  });
});
