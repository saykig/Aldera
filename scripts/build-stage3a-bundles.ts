import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "../src/canonical.js";
import { makeIcbeSourceLocator } from "../src/icbe-source-locator.js";
import type {
  CandidateSourceBundle,
  CandidateSourceRecord,
} from "../src/types.js";

interface ExtractedRecord {
  source_row: number;
  native: Record<string, unknown>;
}

interface SourceMetadata {
  selection: CandidateSourceBundle["selection"];
  sources: {
    icbe: CandidateSourceBundle["source"] & { version: string };
    ucdp: CandidateSourceBundle["source"] & { version: string };
  };
}

const scriptArgs = process.argv.slice(2);
if (scriptArgs[0] === "--") scriptArgs.shift();
const [extractedDirectoryArg, outputDirectoryArg, metadataPathArg] = scriptArgs;
if (!extractedDirectoryArg || !outputDirectoryArg || !metadataPathArg) {
  throw new Error(
    "usage: build-stage3a-bundles.ts <extracted JSON directory> <output directory> <source metadata JSON>",
  );
}
const extractedDirectory = resolve(extractedDirectoryArg);
const outputDirectory = resolve(outputDirectoryArg);
const metadata = JSON.parse(readFileSync(resolve(metadataPathArg), "utf8")) as SourceMetadata;
mkdirSync(outputDirectory, { recursive: true });

function readExtracted(dataset: "icbe" | "ucdp"): ExtractedRecord[] {
  return JSON.parse(
    readFileSync(resolve(extractedDirectory, `${dataset}-native.json`), "utf8"),
  ) as ExtractedRecord[];
}

function icbeRecord(row: ExtractedRecord): CandidateSourceRecord {
  const identity = makeIcbeSourceLocator({
    datasetVersion: metadata.sources.icbe.version,
    source: metadata.sources.icbe,
    rowNumber: row.source_row,
    native: row.native,
  });
  return {
    ref: `icbe:${identity.value}`,
    dataset: "icbe",
    dataset_version: metadata.sources.icbe.version,
    native_identity: identity,
    native_sha256: sha256(row.native),
    native: row.native,
  };
}

function ucdpRecord(row: ExtractedRecord): CandidateSourceRecord {
  const id = row.native.id;
  if (typeof id !== "string" || id.length === 0) throw new Error("UCDP row has no native id");
  return {
    ref: `ucdp:${id}`,
    dataset: "ucdp",
    dataset_version: metadata.sources.ucdp.version,
    native_identity: { kind: "native_id", value: id, native_fields: ["id"] },
    native_sha256: sha256(row.native),
    native: row.native,
  };
}

function bundle(dataset: "icbe" | "ucdp"): CandidateSourceBundle {
  const records = readExtracted(dataset)
    .map(dataset === "icbe" ? icbeRecord : ucdpRecord)
    .sort((a, b) => a.ref.localeCompare(b.ref));
  return {
    schema_version: "0.1.0",
    dataset,
    dataset_version: metadata.sources[dataset].version,
    source: metadata.sources[dataset],
    selection: metadata.selection,
    records,
  };
}

for (const dataset of ["icbe", "ucdp"] as const) {
  writeFileSync(resolve(outputDirectory, `${dataset}.json`), `${JSON.stringify(bundle(dataset), null, 2)}\n`);
}
