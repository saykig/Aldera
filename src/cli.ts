import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CandidateStore } from "./candidate-store.js";
import { ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY } from "./candidate-contract.js";
import { CLI_FORMAT_VERSION } from "./types.js";
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
  "  aldera inspect [<icbe|ucdp|source-ref>] [--json] [--data-dir <path>]",
  "  aldera validate [--json] [--data-dir <path>]",
  "  aldera map <source-ref> [target-ref] [--json] [--data-dir <path>]",
  "  aldera search [--candidate-pairs] [--place <text>] [--from <date>] [--to <date>]",
  "                [--datasets icbe,ucdp] [--actor <text>]",
  "                [--json] [--data-dir <path>]",
  "",
  "Current searches expose non-authoritative candidate pairs only.",
  "Native source bundles must be reconstructed locally; see docs/stage3a.md.",
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

function currentDataDirectory(value: string | undefined): string {
  const directory = resolve(value ?? resolve(process.cwd(), "data/local/stage3a/bundles"));
  if (!existsSync(resolve(directory, "icbe.json")) || !existsSync(resolve(directory, "ucdp.json"))) {
    throw new Error(
      `ICBe/UCDP source bundles are not available at ${directory}; reconstruct the pinned local bundles described in docs/stage3a.md or pass --data-dir`,
    );
  }
  return directory;
}

function currentStore(dataDirectory: string | undefined): CandidateStore {
  return new CandidateStore(currentDataDirectory(dataDirectory));
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

function runInspect(args: readonly string[], io: CliIO): number {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: commonOptions(),
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new Error("inspect accepts at most one target");
  const store = currentStore(values["data-dir"]);
  const target = positionals[0];
  let result: unknown;
  if (!target) {
    result = {
      product: "Aldera",
      empirical_direction: "icbe-ucdp",
      current_mode: "non_authoritative_candidate_discovery",
      datasets: (["icbe", "ucdp"] as const).map((dataset) => datasetSummary(store, dataset)),
      candidate_contract: ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY,
      native_record_count: store.records().length,
      relationship_assertion_count: 0,
    };
  } else if (target === "icbe" || target === "ucdp") {
    result = datasetSummary(store, target);
  } else {
    const record = store.record(target);
    if (!record) throw new Error(`No current dataset or source record named ${target}`);
    result = {
      kind: "native_source_record",
      ...record,
      mapping_authority: false,
      relationship_assertions: [],
    };
  }
  if (values.json) outputJson({ format_version: CLI_FORMAT_VERSION, result }, io);
  else printInspect(result, io);
  return 0;
}

function printInspect(result: unknown, io: CliIO): void {
  const item = result as Record<string, unknown>;
  if (item.product === "Aldera") {
    io.out("Aldera — ICBe ↔ UCDP");
    io.out(`Native records: ${item.native_record_count}`);
    io.out("Relationship assertions: 0 (Stage 3B is not implemented)");
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
  const store = currentStore(values["data-dir"]);
  const result = {
    format_version: CLI_FORMAT_VERSION,
    valid: true,
    empirical_direction: "icbe-ucdp",
    candidate_contract: ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY,
    dataset_versions: {
      icbe: store.bundles.icbe.dataset_version,
      ucdp: store.bundles.ucdp.dataset_version,
    },
    checked: {
      native_records: store.records().length,
      relationship_assertions: 0,
    },
    notice:
      "Candidate source integrity is valid. No relationship-assertion schema or bundle exists before Stage 3B.",
  };
  if (values.json) outputJson(result, io);
  else {
    io.out(`OK: ${result.checked.native_records} native ICBe/UCDP records validated.`);
    io.out(result.notice);
  }
  return 0;
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
  const store = currentStore(values["data-dir"]);
  const [source, target] = positionals as [string, string?];
  if (!store.record(source)) throw new Error(`Unknown source record ${source}`);
  if (target !== undefined && !store.record(target)) throw new Error(`Unknown target record ${target}`);
  const result = {
    format_version: CLI_FORMAT_VERSION,
    mode: "relationship_assertions",
    source_ref: source,
    ...(target ? { target_ref: target } : {}),
    relationship_assertions: [],
    notice:
      "No current relationship assertion exists. Candidate pairs are non-authoritative, and Stage 3B is not implemented.",
  };
  if (values.json) outputJson(result, io);
  else {
    io.out(result.notice);
  }
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
    },
    allowPositionals: false,
  });
  const from = normalizedDate(values.from, "from");
  const to = normalizedDate(values.to, "to");
  const place = normalizedText(values.place);
  const actor = normalizedText(values.actor);
  if (from && to && from > to) throw new Error("--from must not be after --to");
  const query: Partial<CandidateQuery> = {
    candidate_pairs: true,
    datasets: normalizeCurrentDatasets(values.datasets),
    ...(place ? { place } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
  };
  const response = currentStore(values["data-dir"]).search(query);
  if (values.json) outputJson(response, io);
  else printCandidateSearch(response, io);
  return 0;
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
