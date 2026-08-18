import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CandidateStore } from "./candidate-store.js";
import { ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY } from "./candidate-contract.js";
import {
  RelationshipStore,
  loadRelationshipValidation,
  normalizeEquivalenceSafety,
  normalizeRelationshipIdentity,
  normalizeRelationshipRelatedness,
  normalizeRelationshipScope,
} from "./relationship-store.js";
import { CLI_FORMAT_VERSION } from "./types.js";
import type {
  RelationshipAssertion,
  RelationshipOutput,
  RelationshipSearchQuery,
} from "./relationship-types.js";
import type {
  CandidateDatasetId,
  CandidateQuery,
  CandidateSearchResponse,
} from "./types.js";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

export const processIO: CliIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const USAGE = [
  "aldera — ICBe ↔ UCDP real-data interoperability proving ground",
  "",
  "Usage:",
  "  aldera inspect [<relationships|assertion-id|icbe|ucdp|source-ref>] [--json]",
  "                 [--data-dir <stage3a-root>]",
  "  aldera validate [--json] [--data-dir <stage3a-root>]",
  "  aldera map <source-ref> [target-ref] [--json] [--data-dir <stage3a-root>]",
  "  aldera search [--identity <value>] [--relatedness <value>] [--scope <value>]",
  "                [--equivalence-safety <value>] [--assertion-id <id>]",
  "                [--source-ref <ref>] [--target-ref <ref>] [--json]",
  "                [--place <text>] [--from <date>] [--to <date>] [--actor <text>]",
  "                [--data-dir <stage3a-root>]",
  "  aldera search --candidate-pairs [--place <text>] [--from <date>] [--to <date>]",
  "                [--datasets icbe,ucdp] [--actor <text>] [--json]",
  "                --data-dir <stage3a-bundles>",
  "",
  "Relationship metadata works from the tracked assertion bundle on a clean clone.",
  "Stage 3A search results remain non-authoritative candidate pairs.",
  "Native-field filters and candidate discovery require reconstructed source bundles.",
].join("\n");

function commonOptions() {
  return {
    json: { type: "boolean" as const, default: false },
    "data-dir": { type: "string" as const },
  };
}

function outputJson(value: unknown, io: CliIO): void {
  io.out(JSON.stringify(value, null, 2));
}

function normalizedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizedDate(value: string | undefined, flag: string): string | undefined {
  const normalized = normalizedText(value);
  if (normalized !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`--${flag} must use YYYY-MM-DD`);
  }
  return normalized;
}

function candidateDataDirectory(value: string | undefined): string {
  const requested = resolve(value ?? resolve(process.cwd(), "data/local/stage3a/bundles"));
  const directory = existsSync(resolve(requested, "icbe.json"))
    ? requested
    : resolve(requested, "bundles");
  if (!existsSync(resolve(directory, "icbe.json")) || !existsSync(resolve(directory, "ucdp.json"))) {
    throw new Error(
      `ICBe/UCDP source bundles are not available at ${directory}; reconstruct the pinned local bundles described in docs/stage3a.md or pass --data-dir`,
    );
  }
  return directory;
}

function candidateStore(dataDirectory: string | undefined): CandidateStore {
  return new CandidateStore(candidateDataDirectory(dataDirectory));
}

function relationshipStore(dataDirectory: string | undefined): RelationshipStore {
  return new RelationshipStore({
    ...(dataDirectory ? { nativeDataRoot: dataDirectory } : {}),
  });
}

function normalizeCurrentDatasets(value: string | undefined): CandidateDatasetId[] {
  const datasets = (value ?? "icbe,ucdp")
    .split(",")
    .map((dataset) => dataset.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set<CandidateDatasetId>(["icbe", "ucdp"]);
  for (const dataset of datasets) {
    if (!allowed.has(dataset as CandidateDatasetId)) throw new Error(`Unknown dataset: ${dataset}`);
  }
  const normalized = [...new Set(datasets as CandidateDatasetId[])].sort();
  if (normalized.join(",") !== "icbe,ucdp") {
    throw new Error("the current proving ground requires exactly --datasets icbe,ucdp");
  }
  return normalized;
}

function datasetSummary(store: CandidateStore, dataset: CandidateDatasetId) {
  const bundle = store.bundles[dataset];
  return {
    kind: "native_source_dataset",
    id: dataset,
    version: bundle.dataset_version,
    identity_mechanism: dataset === "icbe" ? "source_row_locator" : "native_id",
    source: bundle.source,
    selection: bundle.selection,
    record_count: bundle.records.length,
  };
}

export async function runCli(argv: readonly string[], io: CliIO = processIO): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === "inspect") return runInspect(args, io);
    if (command === "validate") return runValidate(args, io);
    if (command === "map") return runMap(args, io);
    if (command === "search") return runSearch(args, io);
    if (command === "help" || command === "--help" || command === "-h") {
      io.out(USAGE);
      return 0;
    }
    if (command === undefined) {
      io.out(USAGE);
      return 0;
    }
    io.err(`error: unknown command ${command}`);
    io.err(USAGE);
    return 2;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function relationshipMetadata(store: RelationshipStore) {
  return {
    kind: "relationship_assertion_bundle",
    schema_version: store.bundle.schema_version,
    assertion_bundle_version: store.bundle.assertion_bundle_version,
    bundle_sha256: store.bundle.bundle_sha256,
    relationship_authority: store.bundle.relationship_authority,
    comparison: store.bundle.comparison,
    benchmark_provenance: store.bundle.benchmark_provenance,
    assertion_count: store.bundle.assertions.length,
    native_content: store.nativeRecords ? "loaded_and_validated" : "not_loaded",
  };
}

function runInspect(args: readonly string[], io: CliIO): number {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: commonOptions(),
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new Error("inspect accepts at most one target");
  const store = relationshipStore(values["data-dir"]);
  const target = positionals[0];
  let result: unknown;
  if (!target || target === "relationships") {
    result = relationshipMetadata(store);
  } else {
    const assertion = store.assertion(target);
    if (assertion) {
      result = { ...assertion, relationship_authority: true };
    } else if (target === "icbe" || target === "ucdp") {
      if (!values["data-dir"]) {
        throw new Error("native dataset inspection requires reconstructed bundles; pass --data-dir");
      }
      result = datasetSummary(candidateStore(values["data-dir"]), target);
    } else {
      if (!values["data-dir"]) {
        throw new Error(
          "opaque source-ref inspection requires reconstructed native bundles; assertion inspection works metadata-only",
        );
      }
      const record = store.nativeRecord(target);
      if (!record) throw new Error(`No assertion or reconstructed source record named ${target}`);
      result = {
        kind: "native_source_record",
        ...record,
        relationship_assertions: store
          .assertions()
          .filter(({ source_ref, target_ref }) => source_ref === target || target_ref === target)
          .map(({ id }) => id),
      };
    }
  }
  if (values.json) outputJson({ format_version: CLI_FORMAT_VERSION, result }, io);
  else printInspect(result, io);
  return 0;
}

function printInspect(result: unknown, io: CliIO): void {
  const item = result as Record<string, unknown>;
  if (item.kind === "relationship_assertion_bundle") {
    io.out(
      `Relationship assertions ${item.assertion_bundle_version}  ${item.bundle_sha256}  (${item.assertion_count})`,
    );
    io.out(`Native content: ${item.native_content}`);
    return;
  }
  if (item.kind === "relationship_assertion") {
    printRelationshipAssertion(item as unknown as RelationshipAssertion, io);
    return;
  }
  if (item.kind === "native_source_dataset") {
    io.out(`${item.id}@${item.version}  [${item.identity_mechanism}]`);
    io.out(`Native records: ${item.record_count}`);
    return;
  }
  if (item.kind === "native_source_record") {
    io.out(`${item.ref}  [native ${item.dataset}@${item.dataset_version}]`);
    io.out(`Identity: ${JSON.stringify(item.native_identity)}`);
    io.out(`Hash: ${item.native_sha256}`);
    io.out(JSON.stringify(item.native, null, 2));
    return;
  }
  io.out(JSON.stringify(result, null, 2));
}

function runValidate(args: readonly string[], io: CliIO): number {
  const { values } = parseArgs({ args: [...args], options: commonOptions(), allowPositionals: false });
  const validation = loadRelationshipValidation({
    ...(values["data-dir"] ? { nativeDataRoot: values["data-dir"] } : {}),
  });
  const errors = validation.diagnostics.filter(({ severity }) => severity === "error");
  const result = {
    format_version: CLI_FORMAT_VERSION,
    valid: errors.length === 0,
    validation_mode: values["data-dir"] ? "metadata_and_native" : "metadata_only",
    native_content: values["data-dir"] ? "loaded_and_validated" : "not_loaded",
    relationship_schema_version: validation.bundle.schema_version,
    assertion_bundle_version: validation.bundle.assertion_bundle_version,
    assertion_bundle_sha256: validation.bundle.bundle_sha256,
    benchmark_sha256: validation.bundle.benchmark_provenance.sha256,
    checked: {
      relationship_assertions: validation.bundle.assertions.length,
      native_endpoint_occurrences: values["data-dir"]
        ? validation.bundle.assertions.length * 2
        : 0,
    },
    diagnostics: validation.diagnostics,
    notice: values["data-dir"]
      ? "Relationship metadata and reconstructed native endpoint records were validated."
      : "Metadata-only validation: native ICBe/UCDP content was not loaded or validated.",
  };
  if (values.json) outputJson(result, io);
  else {
    io.out(
      result.valid
        ? `OK: ${result.checked.relationship_assertions} relationship assertions validated (${result.validation_mode}).`
        : `INVALID: ${errors.length} error(s)`,
    );
    io.out(result.notice);
    for (const diagnostic of result.diagnostics) {
      io.out(`  [${diagnostic.severity}] ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`);
    }
  }
  return result.valid ? 0 : 1;
}

function runMap(args: readonly string[], io: CliIO): number {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: commonOptions(),
    allowPositionals: true,
  });
  if (positionals.length < 1 || positionals.length > 2) {
    throw new Error("map requires a source reference and optionally a target reference");
  }
  const [source, target] = positionals as [string, string?];
  const output = relationshipStore(values["data-dir"]).map(source, target);
  if (values.json) outputJson(output, io);
  else printRelationshipOutput(output, io);
  return 0;
}

function runSearch(args: readonly string[], io: CliIO): number {
  const { values } = parseArgs({
    args: [...args],
    options: {
      ...commonOptions(),
      place: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      datasets: { type: "string" },
      actor: { type: "string" },
      "candidate-pairs": { type: "boolean", default: false },
      identity: { type: "string" },
      relatedness: { type: "string" },
      scope: { type: "string" },
      "equivalence-safety": { type: "string" },
      "assertion-id": { type: "string" },
      "source-ref": { type: "string" },
      "target-ref": { type: "string" },
    },
    allowPositionals: false,
  });
  const from = normalizedDate(values.from, "from");
  const to = normalizedDate(values.to, "to");
  const place = normalizedText(values.place);
  const actor = normalizedText(values.actor);
  if (from && to && from > to) throw new Error("--from must not be after --to");

  if (values["candidate-pairs"]) {
    if (
      values.identity ||
      values.relatedness ||
      values.scope ||
      values["equivalence-safety"] ||
      values["assertion-id"] ||
      values["source-ref"] ||
      values["target-ref"]
    ) {
      throw new Error("candidate mode does not accept relationship-assertion filters");
    }
    const query: Partial<CandidateQuery> = {
      candidate_pairs: true,
      datasets: normalizeCurrentDatasets(values.datasets),
      ...(place ? { place } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(actor ? { actor } : {}),
    };
    const response = candidateStore(values["data-dir"]).search(query);
    if (values.json) outputJson(response, io);
    else printCandidateSearch(response, io);
    return 0;
  }

  if (values.datasets) throw new Error("--datasets is available only with --candidate-pairs");
  const query: RelationshipSearchQuery = {
    ...(normalizeRelationshipIdentity(values.identity)
      ? { identity: normalizeRelationshipIdentity(values.identity)! }
      : {}),
    ...(normalizeRelationshipRelatedness(values.relatedness)
      ? { relatedness: normalizeRelationshipRelatedness(values.relatedness)! }
      : {}),
    ...(normalizeRelationshipScope(values.scope)
      ? { scope: normalizeRelationshipScope(values.scope)! }
      : {}),
    ...(normalizeEquivalenceSafety(values["equivalence-safety"])
      ? { equivalence_safety: normalizeEquivalenceSafety(values["equivalence-safety"])! }
      : {}),
    ...(normalizedText(values["assertion-id"])
      ? { assertion_id: normalizedText(values["assertion-id"])! }
      : {}),
    ...(normalizedText(values["source-ref"])
      ? { source_ref: normalizedText(values["source-ref"])! }
      : {}),
    ...(normalizedText(values["target-ref"])
      ? { target_ref: normalizedText(values["target-ref"])! }
      : {}),
    ...(place ? { place } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
  };
  const output = relationshipStore(values["data-dir"]).search(query);
  if (values.json) outputJson(output, io);
  else printRelationshipOutput(output, io);
  return 0;
}

function printRelationshipAssertion(assertion: RelationshipAssertion, io: CliIO): void {
  io.out(assertion.id);
  io.out(`${assertion.source_ref}  →  ${assertion.target_ref}`);
  io.out(
    `identity=${assertion.dimensions.identity} relatedness=${assertion.dimensions.relatedness} scope=${assertion.dimensions.scope} equivalence_safety=${assertion.dimensions.equivalence_safety}`,
  );
  if (assertion.human_note) io.out(`Human note: ${assertion.human_note}`);
}

function printRelationshipOutput(output: RelationshipOutput, io: CliIO): void {
  io.out(`Relationship receipt ${output.receipt.receipt_sha256}`);
  io.out(output.native_content_notice);
  io.out(`Assertions (${output.assertions.length}):`);
  for (const assertion of output.assertions) printRelationshipAssertion(assertion, io);
}

function printCandidateSearch(response: CandidateSearchResponse, io: CliIO): void {
  io.out(`Candidate receipt ${response.receipt.receipt_sha256}`);
  io.out(
    `Contract ${response.receipt.candidate_contract.id}@${response.receipt.candidate_contract.version} ${response.receipt.candidate_contract.sha256}`,
  );
  io.out("Candidate pairs are non-authoritative and are not relationship assertions.");
  io.out(`Native records (${response.records.length}):`);
  for (const record of response.records) io.out(`  ${record.ref}  ${record.native_sha256}`);
  io.out(`Candidate pairs (${response.candidate_pairs.length}):`);
  for (const pair of response.candidate_pairs) {
    io.out(`  ${pair.icbe_ref}  ~  ${pair.ucdp_ref}  [${pair.reasons.join(", ")}]`);
    const temporal = pair.reason_evidence.temporal;
    io.out(
      `    dates: ICBe ${temporal.icbe.native_values.map(({ field, value }) => `${field}=${value}`).join("; ")} -> ${temporal.icbe.interpreted_from}..${temporal.icbe.interpreted_to} (${temporal.icbe.precision}); UCDP ${temporal.ucdp.native_values.map(({ field, value }) => `${field}=${value}`).join("; ")} -> ${temporal.ucdp.interpreted_from}..${temporal.ucdp.interpreted_to}`,
    );
    for (const [label, aliases] of [
      ["geographic context", pair.reason_evidence.geographic_context],
      ["localities", pair.reason_evidence.localities],
      ["actors", pair.reason_evidence.actors],
    ] as const) {
      for (const alias of aliases) {
        io.out(
          `    ${label}/${alias.key}: ICBe ${alias.icbe_native_values.map(({ field, value }) => `${field}=${value}`).join("; ")}  ~  UCDP ${alias.ucdp_native_values.map(({ field, value }) => `${field}=${value}`).join("; ")}`,
        );
      }
    }
  }
  io.out(`Not prioritized (${response.not_prioritized_refs.length}):`);
  for (const ref of response.not_prioritized_refs) io.out(`  ${ref}`);
  io.out(response.no_candidate_notice);
}
