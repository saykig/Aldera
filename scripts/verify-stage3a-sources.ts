import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface SourceMetadata {
  sources: Record<"icbe" | "ucdp", {
    artifact_sha256: string;
    extracted_artifact_sha256: string;
  }>;
}

const scriptArgs = process.argv.slice(2);
if (scriptArgs[0] === "--") scriptArgs.shift();
const [metadataArg, icbeArchiveArg, icbeExtractedArg, ucdpArchiveArg, ucdpExtractedArg] = scriptArgs;
if (!metadataArg || !icbeArchiveArg || !icbeExtractedArg || !ucdpArchiveArg || !ucdpExtractedArg) {
  throw new Error(
    "usage: verify-stage3a-sources.ts <metadata> <ICBe archive> <ICBe RDS> <UCDP archive> <UCDP CSV>",
  );
}
const metadata = JSON.parse(readFileSync(resolve(metadataArg), "utf8")) as SourceMetadata;

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(resolve(path))) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

for (const [label, path, expected] of [
  ["ICBe archive", icbeArchiveArg, metadata.sources.icbe.artifact_sha256],
  ["ICBe extracted RDS", icbeExtractedArg, metadata.sources.icbe.extracted_artifact_sha256],
  ["UCDP archive", ucdpArchiveArg, metadata.sources.ucdp.artifact_sha256],
  ["UCDP extracted CSV", ucdpExtractedArg, metadata.sources.ucdp.extracted_artifact_sha256],
] as const) {
  const actual = await fileSha256(path);
  if (actual !== expected) throw new Error(`${label} hash ${actual} does not match ${expected}`);
  process.stdout.write(`${label}: ${actual}\n`);
}
