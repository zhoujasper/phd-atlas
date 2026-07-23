import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function extractReleaseNotes(markdown, version) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid release-note version: ${version || "(empty)"}`);
  }
  const normalized = String(markdown).replace(/\r\n?/g, "\n");
  const targetHeading = `v${version}`;
  const headings = [...normalized.matchAll(/^##[ \t]+([^\n]+?)[ \t]*$/gm)].map(
    (match) => ({
      heading: match[1].trim(),
      index: match.index,
      end: match.index + match[0].length,
    }),
  );
  const matching = headings.filter((entry) => entry.heading === targetHeading);
  if (matching.length !== 1) {
    throw new Error(
      `RELEASE_NOTES.md must contain exactly one "## ${targetHeading}" section; found ${matching.length}.`,
    );
  }

  const section = matching[0];
  const nextHeading = headings.find((entry) => entry.index > section.index);
  const body = normalized
    .slice(section.end, nextHeading?.index ?? normalized.length)
    .trim();
  if (!body) {
    throw new Error(`Release-note section "## ${targetHeading}" is empty.`);
  }
  return body;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const supported = new Set([
    "--check",
    "--input",
    "--output",
    "--package",
    "--version",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--") || !supported.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (argument !== "--check") index += 1;
  }

  const inputPath = path.resolve(
    readOption(args, "--input") ?? "RELEASE_NOTES.md",
  );
  const packagePath = path.resolve(
    readOption(args, "--package") ?? "package.json",
  );
  const explicitVersion = readOption(args, "--version");
  const version =
    explicitVersion ?? JSON.parse(await readFile(packagePath, "utf8")).version;
  const notes = extractReleaseNotes(await readFile(inputPath, "utf8"), version);
  const output = readOption(args, "--output");

  if (output) {
    await writeFile(path.resolve(output), `${notes}\n`, "utf8");
    console.log(`Wrote release notes for v${version} to ${output}.`);
  } else if (args.includes("--check")) {
    console.log(`Validated release notes for v${version}.`);
  } else {
    process.stdout.write(`${notes}\n`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
