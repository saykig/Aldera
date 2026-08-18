import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import _Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";
import { adaptIcbe } from "./adapters/icbe.js";
import { adaptUcdp } from "./adapters/ucdp.js";
import { CandidateStore } from "./candidate-store.js";
import { sha256 } from "./canonical.js";
import {
  EQUIVALENCE_SAFETY_VALUES,
  IDENTITIES,
  RELATEDNESS_VALUES,
  RELATIONSHIP_SCHEMA_VERSION,
  RELATIONSHIP_SEARCH_CONTRACT_VERSION,
  SCOPES,
} from "./relationship-types.js";
import type {
  RelationshipAssertion,
  RelationshipAssertionBundle,
  RelationshipAssertionBundleBody,
  RelationshipDiagnostic,
  RelationshipOutput,
  RelationshipReceipt,
  RelationshipSearchQuery,
} from "./relationship-types.js";
import { CLI_FORMAT_VERSION, type CandidateSourceRecord } from "./types.js";

export const TRACKED_BENCHMARK_PATH =
  "fixtures/real/icbe-ucdp-stage3a/human-review-benchmark.json";
export const TRACKED_RELATIONSHIP_BUNDLE_PATH =
  "fixtures/real/icbe-ucdp-stage3b/relationship-assertions.json";

type DefaultExport<T> = T extends { default: infer D } ? D : T;
const Ajv2020 = ((_Ajv2020 as { default?: unknown }).default ?? _Ajv2020) as DefaultExport<
  typeof _Ajv2020
>;
const addFormats = ((_addFormats as { default?: unknown }).default ?? _addFormats) as DefaultExport<
  typeof _addFormats
>;

interface HumanBenchmarkCase {
  review_item: number;
  pair: { icbe_ref: string; ucdp_ref: string };
  human_judgment: {
    same_underlying_occurrence: "yes" | "no" | "unsure";
    meaningfully_related: "yes" | "no" | "unsure";
    broader_narrower: "yes" | "no" | "unsure";
    broader_narrower_direction:
      | "icbe_broader_ucdp_narrower"
      | "ucdp_broader_icbe_narrower"
      | null;
    safe_or_unsafe_equivalence:
      | "safe_as_equivalent"
      | "unsafe_as_equivalent"
      | "uncertain";
    note: string | null;
  };
}

interface HumanBenchmark {
  kind: "human_review_benchmark";
  mapping_authority: false;
  not_a_mapping_bundle: true;
  review_date: string;
  cases: HumanBenchmarkCase[];
}

function locateTracked(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), relativePath),
    resolve(here, "..", relativePath),
    resolve(here, "../..", relativePath),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Cannot locate tracked Aldera artifact ${relativePath}`);
  return found;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const schema = readJson<Record<string, unknown>>(
  locateTracked("schemas/relationship-assertion-bundle.schema.json"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema) as ValidateFunction;

export function relationshipBundleBody(
  bundle: RelationshipAssertionBundle,
): RelationshipAssertionBundleBody {
  const { bundle_sha256: _storedHash, ...body } = bundle;
  return body;
}

export function relationshipBundleHash(bundle: RelationshipAssertionBundle): string {
  return sha256(relationshipBundleBody(bundle));
}

export function relationshipAssertionId(sourceRef: string, targetRef: string): string {
  const digest = sha256({ source_ref: sourceRef, target_ref: targetRef }).slice("sha256:".length);
  return `relationship:icbe-ucdp:${digest.slice(0, 24)}`;
}

export function defaultRelationshipPaths(): { bundlePath: string; benchmarkPath: string } {
  return {
    bundlePath: locateTracked(TRACKED_RELATIONSHIP_BUNDLE_PATH),
    benchmarkPath: locateTracked(TRACKED_BENCHMARK_PATH),
  };
}

function error(code: string, path: string, message: string): RelationshipDiagnostic {
  return { code, severity: "error", path, message };
}

function schemaDiagnostics(bundle: unknown): RelationshipDiagnostic[] {
  if (validateSchema(bundle)) return [];
  return (validateSchema.errors ?? []).map((item: ErrorObject) =>
    error(
      "ALD-REL-SCHEMA",
      `relationship-assertions.json${item.instancePath}`,
      item.message ?? item.keyword,
    ),
  );
}

function expectedDimensions(item: HumanBenchmarkCase): RelationshipAssertion["dimensions"] {
  const judgment = item.human_judgment;
  const identity =
    judgment.same_underlying_occurrence === "yes"
      ? "same"
      : judgment.same_underlying_occurrence === "no"
        ? "not_same"
        : "uncertain";
  const relatedness =
    judgment.meaningfully_related === "yes"
      ? "related"
      : judgment.meaningfully_related === "no"
        ? "not_related"
        : "uncertain";
  const scope =
    judgment.broader_narrower === "no"
      ? "no_broader_narrower_asserted"
      : judgment.broader_narrower === "unsure"
        ? "uncertain"
        : judgment.broader_narrower_direction === "icbe_broader_ucdp_narrower"
          ? "source_broader"
          : "target_broader";
  return {
    identity,
    relatedness,
    scope,
    equivalence_safety: judgment.safe_or_unsafe_equivalence,
  };
}

function normalizeNativeRoot(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolve(resolved, "icbe.json")) ? dirname(resolved) : resolved;
}

interface NativeLoad {
  records: Map<string, CandidateSourceRecord>;
  diagnostics: RelationshipDiagnostic[];
}

function loadNativeRecords(
  bundle: RelationshipAssertionBundle,
  nativeDataRoot: string,
): NativeLoad {
  const root = normalizeNativeRoot(nativeDataRoot);
  const records = new Map<string, CandidateSourceRecord>();
  const diagnostics: RelationshipDiagnostic[] = [];
  for (const sourceSet of bundle.native_source_sets) {
    const directory = resolve(root, sourceSet.relative_directory);
    let store: CandidateStore;
    try {
      store = new CandidateStore(directory);
    } catch (cause) {
      diagnostics.push(
        error(
          "ALD-REL-NATIVE-LOAD",
          sourceSet.relative_directory,
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
      continue;
    }
    for (const dataset of ["icbe", "ucdp"] as const) {
      const actualHash = sha256(store.bundles[dataset]);
      const expected = sourceSet.bundles[dataset];
      if (actualHash !== expected.sha256) {
        diagnostics.push(
          error(
            "ALD-REL-NATIVE-BUNDLE-HASH",
            `${sourceSet.id}/${dataset}`,
            `native source bundle hash is ${actualHash}; expected ${expected.sha256}`,
          ),
        );
      }
      if (store.bundles[dataset].dataset_version !== expected.version) {
        diagnostics.push(
          error(
            "ALD-REL-NATIVE-BUNDLE-VERSION",
            `${sourceSet.id}/${dataset}`,
            `native source bundle version is ${store.bundles[dataset].dataset_version}; expected ${expected.version}`,
          ),
        );
      }
    }
    for (const record of store.records()) {
      const prior = records.get(record.ref);
      if (prior && prior.native_sha256 !== record.native_sha256) {
        diagnostics.push(
          error(
            "ALD-REL-NATIVE-REF-CONFLICT",
            record.ref,
            "the same opaque ref resolves to different native hashes",
          ),
        );
      } else {
        records.set(record.ref, record);
      }
    }
  }
  for (const assertion of bundle.assertions) {
    for (const ref of [assertion.source_ref, assertion.target_ref]) {
      if (!records.has(ref)) {
        diagnostics.push(
          error("ALD-REL-ENDPOINT-MISSING", assertion.id, `native endpoint ${ref} does not resolve`),
        );
      }
    }
  }
  return { records, diagnostics };
}

export function validateRelationshipArtifacts(
  candidateBundle: unknown,
  benchmark: HumanBenchmark,
  nativeDataRoot?: string,
): RelationshipDiagnostic[] {
  const diagnostics = schemaDiagnostics(candidateBundle);
  if (diagnostics.length > 0) {
    return diagnostics.sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`));
  }
  const bundle = candidateBundle as RelationshipAssertionBundle;
  if (
    benchmark.kind !== "human_review_benchmark" ||
    benchmark.mapping_authority !== false ||
    benchmark.not_a_mapping_bundle !== true
  ) {
    diagnostics.push(
      error(
        "ALD-REL-BENCHMARK-AUTHORITY",
        TRACKED_BENCHMARK_PATH,
        "the Stage 3A benchmark must remain explicitly non-authoritative",
      ),
    );
  }
  const benchmarkHash = sha256(benchmark);
  if (bundle.benchmark_provenance.sha256 !== benchmarkHash) {
    diagnostics.push(
      error(
        "ALD-REL-BENCHMARK-HASH",
        "benchmark_provenance/sha256",
        `benchmark hash is ${benchmarkHash}; stored hash is ${bundle.benchmark_provenance.sha256}`,
      ),
    );
  }
  if (bundle.benchmark_provenance.path !== TRACKED_BENCHMARK_PATH) {
    diagnostics.push(
      error(
        "ALD-REL-BENCHMARK-PATH",
        "benchmark_provenance/path",
        `benchmark path must be ${TRACKED_BENCHMARK_PATH}`,
      ),
    );
  }
  if (bundle.benchmark_provenance.review_date !== benchmark.review_date) {
    diagnostics.push(
      error(
        "ALD-REL-REVIEW-DATE",
        "benchmark_provenance/review_date",
        "review date does not match the pinned benchmark",
      ),
    );
  }
  if (bundle.authority_provenance.benchmark_sha256 !== benchmarkHash) {
    diagnostics.push(
      error(
        "ALD-REL-AUTHORITY-BENCHMARK-HASH",
        "authority_provenance/benchmark_sha256",
        `authority provenance must bind benchmark hash ${benchmarkHash}`,
      ),
    );
  }
  if (bundle.authority_provenance.approval_date !== benchmark.review_date) {
    diagnostics.push(
      error(
        "ALD-REL-AUTHORITY-DATE",
        "authority_provenance/approval_date",
        "authority approval date does not match the reviewed and approved Stage 3A benchmark date",
      ),
    );
  }
  const actualBundleHash = relationshipBundleHash(bundle);
  if (bundle.bundle_sha256 !== actualBundleHash) {
    diagnostics.push(
      error(
        "ALD-REL-BUNDLE-HASH",
        "bundle_sha256",
        `bundle hash is ${actualBundleHash}; stored hash is ${bundle.bundle_sha256}`,
      ),
    );
  }
  if (bundle.schema_version !== RELATIONSHIP_SCHEMA_VERSION) {
    diagnostics.push(
      error(
        "ALD-REL-SCHEMA-VERSION",
        "schema_version",
        `expected relationship schema ${RELATIONSHIP_SCHEMA_VERSION}`,
      ),
    );
  }

  const ids = bundle.assertions.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    diagnostics.push(error("ALD-REL-ID-DUPLICATE", "assertions", "assertion IDs must be unique"));
  }
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
    diagnostics.push(
      error("ALD-REL-ORDER", "assertions", "assertions must be ordered by stable assertion ID"),
    );
  }
  const pairs = bundle.assertions.map(({ source_ref, target_ref }) => `${source_ref}\u0000${target_ref}`);
  if (new Set(pairs).size !== pairs.length) {
    diagnostics.push(
      error("ALD-REL-PAIR-DUPLICATE", "assertions", "v0.1 prohibits duplicate endpoint pairs"),
    );
  }

  const benchmarkCases = new Map(benchmark.cases.map((item) => [item.review_item, item]));
  if (bundle.assertions.length !== benchmark.cases.length) {
    diagnostics.push(
      error(
        "ALD-REL-TRANSCRIPTION-COUNT",
        "assertions",
        `bundle has ${bundle.assertions.length} assertions; benchmark has ${benchmark.cases.length}`,
      ),
    );
  }
  for (const assertion of bundle.assertions) {
    const item = benchmarkCases.get(assertion.review_item);
    if (!item) {
      diagnostics.push(
        error(
          "ALD-REL-TRANSCRIPTION-ITEM",
          assertion.id,
          `review item ${assertion.review_item} is not in the benchmark`,
        ),
      );
      continue;
    }
    const expectedId = relationshipAssertionId(item.pair.icbe_ref, item.pair.ucdp_ref);
    const expectedNote = item.human_judgment.note ?? undefined;
    if (
      assertion.id !== expectedId ||
      assertion.source_ref !== item.pair.icbe_ref ||
      assertion.target_ref !== item.pair.ucdp_ref ||
      JSON.stringify(assertion.dimensions) !== JSON.stringify(expectedDimensions(item)) ||
      assertion.human_note !== expectedNote
    ) {
      diagnostics.push(
        error(
          "ALD-REL-TRANSCRIPTION-DRIFT",
          assertion.id,
          "assertion does not exactly transcribe its approved benchmark item",
        ),
      );
    }
  }
  if (nativeDataRoot) diagnostics.push(...loadNativeRecords(bundle, nativeDataRoot).diagnostics);
  return diagnostics.sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`));
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function nativeMatches(record: CandidateSourceRecord, query: RelationshipSearchQuery): boolean {
  const view = record.dataset === "icbe" ? adaptIcbe(record.native) : adaptUcdp(record.native);
  if (query.place) {
    const needle = normalizedText(query.place);
    if (!view.places.some((value) => normalizedText(value).includes(needle))) return false;
  }
  if (query.actor) {
    const needle = normalizedText(query.actor);
    if (!view.actors.some((value) => normalizedText(value).includes(needle))) return false;
  }
  if (query.from && view.dateTo < query.from) return false;
  if (query.to && view.dateFrom > query.to) return false;
  return true;
}

function normalizeQuery(query: RelationshipSearchQuery): RelationshipSearchQuery {
  const text = (value: string | undefined): string | undefined => value?.trim() || undefined;
  return {
    ...(query.identity ? { identity: query.identity } : {}),
    ...(query.relatedness ? { relatedness: query.relatedness } : {}),
    ...(query.scope ? { scope: query.scope } : {}),
    ...(query.equivalence_safety ? { equivalence_safety: query.equivalence_safety } : {}),
    ...(text(query.assertion_id) ? { assertion_id: text(query.assertion_id)! } : {}),
    ...(text(query.source_ref) ? { source_ref: text(query.source_ref)! } : {}),
    ...(text(query.target_ref) ? { target_ref: text(query.target_ref)! } : {}),
    ...(text(query.place) ? { place: text(query.place)! } : {}),
    ...(text(query.from) ? { from: text(query.from)! } : {}),
    ...(text(query.to) ? { to: text(query.to)! } : {}),
    ...(text(query.actor) ? { actor: text(query.actor)! } : {}),
  };
}

export class RelationshipStore {
  readonly bundle: RelationshipAssertionBundle;
  readonly benchmark: HumanBenchmark;
  readonly nativeRecords: Map<string, CandidateSourceRecord> | undefined;

  constructor(options: {
    bundlePath?: string;
    benchmarkPath?: string;
    nativeDataRoot?: string;
  } = {}) {
    const defaults = defaultRelationshipPaths();
    this.bundle = readJson(options.bundlePath ?? defaults.bundlePath);
    this.benchmark = readJson(options.benchmarkPath ?? defaults.benchmarkPath);
    const diagnostics = validateRelationshipArtifacts(
      this.bundle,
      this.benchmark,
      options.nativeDataRoot,
    );
    const errors = diagnostics.filter(({ severity }) => severity === "error");
    if (errors.length) throw new Error(errors.map(({ code, message }) => `${code}: ${message}`).join("; "));
    this.nativeRecords = options.nativeDataRoot
      ? loadNativeRecords(this.bundle, options.nativeDataRoot).records
      : undefined;
  }

  assertions(): RelationshipAssertion[] {
    return [...this.bundle.assertions];
  }

  assertion(id: string): RelationshipAssertion | undefined {
    return this.bundle.assertions.find((item) => item.id === id);
  }

  nativeRecord(ref: string): CandidateSourceRecord | undefined {
    return this.nativeRecords?.get(ref);
  }

  private output(
    command: "map" | "search",
    parameters: Record<string, unknown>,
    assertions: RelationshipAssertion[],
  ): RelationshipOutput {
    const orderedAssertions = [...assertions].sort((a, b) => a.id.localeCompare(b.id));
    const refs = [...new Set(orderedAssertions.flatMap(({ source_ref, target_ref }) => [source_ref, target_ref]))].sort();
    const records = this.nativeRecords
      ? refs.flatMap((ref) => {
          const record = this.nativeRecords!.get(ref);
          return record ? [record] : [];
        })
      : [];
    const nativeContent = this.nativeRecords ? "loaded_and_validated" : "not_loaded";
    const receiptBody = {
      search_contract_version: RELATIONSHIP_SEARCH_CONTRACT_VERSION,
      relationship_schema_version: this.bundle.schema_version,
      assertion_bundle_version: this.bundle.assertion_bundle_version,
      assertion_bundle_sha256: this.bundle.bundle_sha256,
      benchmark_sha256: this.bundle.benchmark_provenance.sha256,
      parameters: { command, ...parameters },
      assertion_ids: orderedAssertions.map(({ id }) => id),
      opaque_refs: refs,
      native_content: nativeContent,
      native_records: records.map(({ ref, native_sha256 }) => ({ ref, native_sha256 })),
    } satisfies Omit<RelationshipReceipt, "receipt_sha256">;
    return {
      format_version: CLI_FORMAT_VERSION,
      mode: "relationship_assertions",
      relationship_authority: true,
      native_content: nativeContent,
      native_content_notice: this.nativeRecords
        ? "Native endpoint records were loaded from reconstructed bundles and their exact hashes were validated."
        : "Metadata-only output: native ICBe/UCDP content was not loaded, validated, or returned.",
      ...(orderedAssertions.length === 0
        ? {
            assertion_absence_notice:
              command === "map"
                ? "No reviewed relationship assertion exists for these references in this pinned bundle. This does not assert that the records are not_related, incompatible, lack a counterpart, or are globally absent."
                : "No reviewed relationship assertion matches this search in this pinned bundle. This does not assert that any records are not_related, incompatible, lack a counterpart, or are globally absent.",
          }
        : {}),
      assertions: orderedAssertions,
      records,
      receipt: { ...receiptBody, receipt_sha256: sha256(receiptBody) },
    };
  }

  map(sourceRef: string, targetRef?: string): RelationshipOutput {
    const source = sourceRef.trim();
    const target = targetRef?.trim();
    const assertions = this.bundle.assertions.filter((assertion) =>
      target
        ? assertion.source_ref === source && assertion.target_ref === target
        : assertion.source_ref === source || assertion.target_ref === source,
    );
    return this.output("map", { source_ref: source, ...(target ? { target_ref: target } : {}) }, assertions);
  }

  search(input: RelationshipSearchQuery): RelationshipOutput {
    const query = normalizeQuery(input);
    const nativeFilter = Boolean(query.place || query.from || query.to || query.actor);
    if (nativeFilter && !this.nativeRecords) {
      throw new Error(
        "place/date/actor relationship filtering requires reconstructed native bundles; pass --data-dir data/local/stage3a",
      );
    }
    const assertions = this.bundle.assertions.filter((assertion) => {
      const dimensions = assertion.dimensions;
      if (query.identity && dimensions.identity !== query.identity) return false;
      if (query.relatedness && dimensions.relatedness !== query.relatedness) return false;
      if (query.scope && dimensions.scope !== query.scope) return false;
      if (
        query.equivalence_safety &&
        dimensions.equivalence_safety !== query.equivalence_safety
      ) {
        return false;
      }
      if (query.assertion_id && assertion.id !== query.assertion_id) return false;
      if (query.source_ref && assertion.source_ref !== query.source_ref) return false;
      if (query.target_ref && assertion.target_ref !== query.target_ref) return false;
      if (nativeFilter) {
        const source = this.nativeRecords!.get(assertion.source_ref);
        const target = this.nativeRecords!.get(assertion.target_ref);
        if (!source || !target || (!nativeMatches(source, query) && !nativeMatches(target, query))) {
          return false;
        }
      }
      return true;
    });
    return this.output("search", query as Record<string, unknown>, assertions);
  }
}

export function loadRelationshipValidation(options: {
  bundlePath?: string;
  benchmarkPath?: string;
  nativeDataRoot?: string;
} = {}): {
  bundle: RelationshipAssertionBundle;
  benchmark: HumanBenchmark;
  diagnostics: RelationshipDiagnostic[];
} {
  const defaults = defaultRelationshipPaths();
  const bundle = readJson<RelationshipAssertionBundle>(options.bundlePath ?? defaults.bundlePath);
  const benchmark = readJson<HumanBenchmark>(options.benchmarkPath ?? defaults.benchmarkPath);
  return {
    bundle,
    benchmark,
    diagnostics: validateRelationshipArtifacts(bundle, benchmark, options.nativeDataRoot),
  };
}

export function normalizeRelationshipIdentity(value: string | undefined) {
  return normalizeEnum(value, IDENTITIES, "identity");
}

export function normalizeRelationshipRelatedness(value: string | undefined) {
  return normalizeEnum(value, RELATEDNESS_VALUES, "relatedness");
}

export function normalizeRelationshipScope(value: string | undefined) {
  return normalizeEnum(value, SCOPES, "scope");
}

export function normalizeEquivalenceSafety(value: string | undefined) {
  return normalizeEnum(value, EQUIVALENCE_SAFETY_VALUES, "equivalence safety");
}

function normalizeEnum<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  label: string,
): T[number] | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new Error(`Unknown ${label}: ${value}`);
  }
  return normalized as T[number];
}
