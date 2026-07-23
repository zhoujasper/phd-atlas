import { describe, expect, it } from "vitest";
import { planPublicSync } from "../tools/plan-public-sync.mjs";

const sourceSha = "a".repeat(40);

describe("planPublicSync", () => {
  it("does nothing when the version and public tag are already current", () => {
    expect(
      planPublicSync({
        sourceVersion: "1.2.3",
        publicVersion: "1.2.3",
        sourceSha,
        sourceTagTarget: "b".repeat(40),
        publicTagExists: true,
      }),
    ).toMatchObject({
      mode: "noop",
      syncPublic: false,
      publishVersion: false,
    });
  });

  it("allows an explicit maintenance sync without republishing", () => {
    expect(
      planPublicSync({
        sourceVersion: "1.2.3",
        publicVersion: "1.2.3",
        sourceSha,
        publicTagExists: true,
        forceSync: true,
      }),
    ).toMatchObject({
      mode: "force-sync",
      syncPublic: true,
      publishVersion: false,
    });
  });

  it("publishes a strictly newer version", () => {
    expect(
      planPublicSync({
        sourceVersion: "1.3.0-beta.1",
        publicVersion: "1.2.3",
        sourceSha,
        publicTagExists: false,
      }),
    ).toMatchObject({
      mode: "release",
      tagName: "v1.3.0-beta.1",
      syncPublic: true,
      publishVersion: true,
    });
  });

  it("resumes a synchronized version whose public tag is missing", () => {
    expect(
      planPublicSync({
        sourceVersion: "1.2.3",
        publicVersion: "1.2.3",
        sourceSha,
        publicTagExists: false,
      }),
    ).toMatchObject({
      mode: "resume-release",
      syncPublic: true,
      publishVersion: true,
    });
  });

  it("rejects downgrades and conflicting immutable state", () => {
    expect(() =>
      planPublicSync({
        sourceVersion: "1.2.2",
        publicVersion: "1.2.3",
        sourceSha,
        publicTagExists: false,
      }),
    ).toThrow("refusing a public downgrade");
    expect(() =>
      planPublicSync({
        sourceVersion: "1.2.4",
        publicVersion: "1.2.3",
        sourceSha,
        publicTagExists: true,
      }),
    ).toThrow("already exists");
    expect(() =>
      planPublicSync({
        sourceVersion: "1.2.4",
        publicVersion: "1.2.3",
        sourceSha,
        sourceTagTarget: "b".repeat(40),
        publicTagExists: false,
      }),
    ).toThrow("already targets");
  });

  it("rejects invalid or OCI-ambiguous versions", () => {
    expect(() =>
      planPublicSync({
        sourceVersion: "next",
        publicVersion: "1.2.3",
        sourceSha,
      }),
    ).toThrow("canonical SemVer");
    expect(() =>
      planPublicSync({
        sourceVersion: "1.2.4+build.1",
        publicVersion: "1.2.3",
        sourceSha,
      }),
    ).toThrow("cannot contain build metadata");
  });
});
