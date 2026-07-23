import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function assertVersion(version, label, { allowEmpty = false } = {}) {
  if (allowEmpty && !version) return;
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(
      `${label} '${version || "(empty)"}' is not canonical SemVer.`,
    );
  }
}

function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(version);
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    if (leftVersion.core[index] > rightVersion.core[index]) return 1;
    if (leftVersion.core[index] < rightVersion.core[index]) return -1;
  }
  if (!leftVersion.prerelease.length && !rightVersion.prerelease.length)
    return 0;
  if (!leftVersion.prerelease.length) return 1;
  if (!rightVersion.prerelease.length) return -1;
  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

export function planPublicSync({
  sourceVersion,
  publicVersion,
  sourceSha,
  sourceTagTarget = "",
  publicTagExists = false,
  forceSync = false,
}) {
  assertVersion(sourceVersion, "Source version");
  assertVersion(publicVersion, "Public version", { allowEmpty: true });
  if (sourceVersion.includes("+")) {
    throw new Error(
      `Source version '${sourceVersion}' cannot contain build metadata because OCI tags cannot represent it safely.`,
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) {
    throw new Error(
      `Source SHA '${sourceSha || "(empty)"}' is not a full commit SHA.`,
    );
  }

  const tagName = `v${sourceVersion}`;
  const versionOrder = publicVersion
    ? compareVersions(sourceVersion, publicVersion)
    : 1;
  if (versionOrder < 0) {
    throw new Error(
      `Source version ${sourceVersion} is older than public version ${publicVersion}; refusing a public downgrade.`,
    );
  }

  if (versionOrder > 0) {
    if (publicTagExists) {
      throw new Error(
        `Public tag ${tagName} already exists while public package.json is still ${publicVersion || "(missing)"}.`,
      );
    }
    if (
      sourceTagTarget &&
      sourceTagTarget.toLowerCase() !== sourceSha.toLowerCase()
    ) {
      throw new Error(
        `${tagName} already targets ${sourceTagTarget}, not the source commit ${sourceSha}.`,
      );
    }
    return {
      mode: "release",
      reason: `Version advanced from ${publicVersion || "(none)"} to ${sourceVersion}.`,
      sourceVersion,
      publicVersion,
      tagName,
      syncPublic: true,
      publishVersion: true,
    };
  }

  if (!publicTagExists) {
    if (
      sourceTagTarget &&
      sourceTagTarget.toLowerCase() !== sourceSha.toLowerCase()
    ) {
      throw new Error(
        `${tagName} already targets ${sourceTagTarget}, not the source commit ${sourceSha}.`,
      );
    }
    return {
      mode: "resume-release",
      reason: `Version ${sourceVersion} is synchronized but its public tag is missing.`,
      sourceVersion,
      publicVersion,
      tagName,
      syncPublic: true,
      publishVersion: true,
    };
  }

  if (forceSync) {
    return {
      mode: "force-sync",
      reason: `Maintenance sync requested for existing ${sourceVersion}.`,
      sourceVersion,
      publicVersion,
      tagName,
      syncPublic: true,
      publishVersion: false,
    };
  }

  return {
    mode: "noop",
    reason: `Version ${sourceVersion} is unchanged and ${tagName} is already public.`,
    sourceVersion,
    publicVersion,
    tagName,
    syncPublic: false,
    publishVersion: false,
  };
}

function readOption(args, name, { required = true } = {}) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new Error(`${name} is required.`);
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

async function main() {
  const args = process.argv.slice(2);
  const plan = planPublicSync({
    sourceVersion: readOption(args, "--source-version"),
    publicVersion:
      readOption(args, "--public-version", { required: false }) ?? "",
    sourceSha: readOption(args, "--source-sha"),
    sourceTagTarget:
      readOption(args, "--source-tag-target", { required: false }) ?? "",
    publicTagExists: parseBoolean(
      readOption(args, "--public-tag-exists"),
      "--public-tag-exists",
    ),
    forceSync: parseBoolean(readOption(args, "--force-sync"), "--force-sync"),
  });

  const githubOutput = readOption(args, "--github-output", { required: false });
  if (githubOutput) {
    const outputs = {
      mode: plan.mode,
      reason: plan.reason,
      source_version: plan.sourceVersion,
      public_version: plan.publicVersion,
      tag_name: plan.tagName,
      sync_public: String(plan.syncPublic),
      publish_version: String(plan.publishVersion),
    };
    await appendFile(
      githubOutput,
      `${Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
      "utf8",
    );
  }

  console.log(JSON.stringify(plan));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
