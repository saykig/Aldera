import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { AlderaStore, normalizeDatasets, normalizeRelation } from "./store.js";
import { CandidateStore } from "./candidate-store.js";
import { validateStore } from "./validation.js";
import { CLI_FORMAT_VERSION } from "./types.js";
import type {
  CandidateQuery,
  CandidateSearchResponse,
  MappingAssertion,
  SearchQuery,
  SearchResponse,
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
  "aldera — research-data interoperability playground",
  "",
  "Usage:",
  "  aldera inspect [<dataset|source-ref|mapping-id>] [--json] [--data-dir <path>]",
  "  aldera validate [--json] [--data-dir <path>]",
  "  aldera map <source-ref> [target-ref] [--json] [--data-dir <path>]",
  "  aldera search [--place <text>] [--from <date>] [--to <date>]",
  "                [--datasets ucdp,acled] [--actor <text>] [--relation <relation>]",
  "                [--candidate-pairs --datasets icbe,ucdp]",
  "                [--source-id <id>] [--json] [--data-dir <path>]",
  "",
  "Relations: close, related, incompatible, unmapped",
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
  const store = new AlderaStore(values["data-dir"]);
  const target = positionals[0];
  let result: unknown;
  if (!target) {
    result = {
      product: "Aldera",
      datasets: store.descriptors(),
      mapping_version: store.mappingBundle.mapping_version,
      record_count: store.records().length,
      mapping_count: store.mappingBundle.mappings.length,
    };
  } else {
    const record = store.record(target);
    const mapping = store.mapping(target);
    const dataset = store.descriptors().find((item) => item.id === target);
    result = record
      ? { kind: "native_source_record", ...record, mappings: store.mappingsBetween(record.ref) }
      : mapping
        ? { kind: "mapping_assertion", ...mapping }
        : dataset
          ? { kind: "dataset", ...dataset }
          : undefined;
    if (!result) throw new Error(`No dataset, source record, or mapping named ${target}`);
  }
  if (values.json) outputJson({ format_version: CLI_FORMAT_VERSION, result }, io);
  else printInspect(result, io);
  return 0;
}

function printInspect(result: unknown, io: CliIO): void {
  const item = result as Record<string, unknown>;
  if (item.product === "Aldera") {
    io.out(`Aldera  mapping ${item.mapping_version}`);
    io.out(`Native records: ${item.record_count}  Mapping assertions: ${item.mapping_count}`);
    for (const dataset of item.datasets as Array<{ id: string; version: string; title: string }>) {
      io.out(`  ${dataset.id.padEnd(6)} ${dataset.version}  ${dataset.title}`);
    }
    return;
  }
  if (item.kind === "native_source_record") {
    io.out(`${item.ref}  [native ${item.dataset}@${item.dataset_version}]`);
    io.out(`Native ID: ${item.native_id}`);
    io.out(`Hash: ${item.native_sha256}`);
    io.out(JSON.stringify(item.native, null, 2));
    const mappings = item.mappings as MappingAssertion[];
    if (mappings.length) {
      io.out("Mappings:");
      for (const mapping of mappings) io.out(`  ${mapping.id}  ${mapping.relation}`);
    }
    return;
  }
  if (item.kind === "mapping_assertion") {
    printMapping(item as unknown as MappingAssertion, io);
    return;
  }
  io.out(JSON.stringify(result, null, 2));
}

function runValidate(args: readonly string[], io: CliIO): number {
  const { values } = parseArgs({ args: [...args], options: commonOptions(), allowPositionals: false });
  const store = new AlderaStore(values["data-dir"]);
  const diagnostics = validateStore(store);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const result = {
    format_version: CLI_FORMAT_VERSION,
    valid: errors.length === 0,
    dataset_versions: Object.fromEntries(store.descriptors().map((item) => [item.id, item.version])),
    mapping_version: store.mappingBundle.mapping_version,
    checked: { records: store.records().length, mappings: store.mappingBundle.mappings.length },
    diagnostics,
  };
  if (values.json) outputJson(result, io);
  else if (result.valid) {
    io.out(
      `OK: ${result.checked.records} native records and ${result.checked.mappings} mapping assertions validated.`,
    );
    io.out(
      `Versions: UCDP ${result.dataset_versions.ucdp}; ACLED ${result.dataset_versions.acled}; mappings ${result.mapping_version}`,
    );
  } else {
    io.err(`INVALID: ${errors.length} error(s)`);
    for (const diagnostic of diagnostics) {
      io.err(
        `  [${diagnostic.severity}] ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
      );
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
  const store = new AlderaStore(values["data-dir"]);
  const [source, target] = positionals as [string, string?];
  if (!store.record(source)) throw new Error(`Unknown source record ${source}`);
  if (target !== undefined && !store.record(target)) throw new Error(`Unknown target record ${target}`);

  const mappings = store.mappingsBetween(source, target);
  if (!mappings.length) {
    io.out(`No asserted mapping for ${source}${target ? ` and ${target}` : ""}.`);
    return 0;
  }
  if (values.json) outputJson({ format_version: CLI_FORMAT_VERSION, mappings }, io);
  else for (const mapping of mappings) printMapping(mapping, io);
  return 0;
}

function printMapping(mapping: MappingAssertion, io: CliIO): void {
  io.out(mapping.id);
  io.out(`${mapping.source}  --${mapping.relation}-->  ${mapping.target ?? "∅"}`);
  io.out(`Rationale: ${mapping.rationale}`);
  if (mapping.uncertainty) io.out(`Uncertainty: ${mapping.uncertainty}`);
  io.out("Meaning preserved:");
  for (const item of mapping.meaning_preserved) io.out(`  + ${item}`);
  io.out("Meaning lost / not translated:");
  for (const item of mapping.meaning_lost) io.out(`  - ${item}`);
  io.out(
    `Provenance: ${mapping.provenance.asserted_by}; ${mapping.provenance.method}; evidence ${mapping.provenance.evidence.join(", ")}`,
  );
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
      relation: { type: "string" },
      "source-id": { type: "string" },
      "candidate-pairs": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const from = normalizedDate(values.from, "from");
  const to = normalizedDate(values.to, "to");
  if (from && to && from > to) throw new Error("--from must not be after --to");
  const relation = normalizeRelation(normalizedText(values.relation));
  const place = normalizedText(values.place);
  const actor = normalizedText(values.actor);
  const sourceId = normalizedText(values["source-id"]);
  if (values["candidate-pairs"]) {
    if (relation || sourceId) {
      throw new Error("candidate mode does not accept --relation or --source-id");
    }
    const datasets = (values.datasets ?? "icbe,ucdp")
      .split(",")
      .map((dataset) => dataset.trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set(["icbe", "ucdp"]);
    if (datasets.some((dataset) => !allowed.has(dataset))) {
      throw new Error("candidate mode currently supports only ICBe and UCDP");
    }
    const query: Partial<CandidateQuery> = {
      candidate_pairs: true,
      datasets: [...new Set(datasets)].sort() as Array<"icbe" | "ucdp">,
      ...(place ? { place } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(actor ? { actor } : {}),
    };
    const dataDirectory = values["data-dir"] ?? resolve(process.cwd(), "data/local/stage3a/bundles");
    const response = new CandidateStore(dataDirectory).search(query);
    if (values.json) outputJson(response, io);
    else printCandidateSearch(response, io);
    return 0;
  }
  const query: SearchQuery = {
    datasets: normalizeDatasets(values.datasets),
    ...(place ? { place } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
    ...(relation ? { relation } : {}),
    ...(sourceId ? { source_id: sourceId } : {}),
  };
  const response = new AlderaStore(values["data-dir"]).search(query);
  if (values.json) outputJson(response, io);
  else printSearch(response, io);
  return 0;
}

function printCandidateSearch(response: CandidateSearchResponse, io: CliIO): void {
  io.out(`Candidate receipt ${response.receipt.receipt_sha256}`);
  io.out(
    `Contract ${response.receipt.candidate_contract.id}@${response.receipt.candidate_contract.version} ${response.receipt.candidate_contract.sha256}`,
  );
  io.out("Candidate pairs are non-authoritative and are not mapping assertions.");
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

function printSearch(response: SearchResponse, io: CliIO): void {
  const { receipt } = response;
  io.out(`Receipt ${receipt.receipt_sha256}`);
  io.out(
    `Versions: ucdp@${receipt.inputs.ucdp.version}, acled@${receipt.inputs.acled.version}, mappings@${receipt.inputs.mapping.version}`,
  );
  io.out(`Records (${response.records.length}):`);
  for (const record of response.records) io.out(`  ${record.ref}  ${record.native_sha256}`);
  io.out(`Mappings (${response.mappings.length}):`);
  for (const mapping of response.mappings) {
    io.out(`  ${mapping.source} --${mapping.relation}--> ${mapping.target ?? "∅"}`);
  }
}
