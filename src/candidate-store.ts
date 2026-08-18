import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adaptIcbe } from "./adapters/icbe.js";
import { adaptUcdp } from "./adapters/ucdp.js";
import type { IcbeCandidateView, NativeSearchView } from "./adapters/types.js";
import {
  ICBE_UCDP_CANDIDATE_CONTRACT,
  ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY,
} from "./candidate-contract.js";
import { sha256 } from "./canonical.js";
import { makeIcbeSourceLocator } from "./icbe-source-locator.js";
import { CANDIDATE_SEARCH_CONTRACT_VERSION, CLI_FORMAT_VERSION } from "./types.js";
import type {
  AliasEvidence,
  CandidatePair,
  CandidatePairEvaluation,
  CandidateQuery,
  CandidateReason,
  CandidateReasonEvidence,
  CandidateSearchResponse,
  CandidateSourceBundle,
  CandidateSourceRecord,
  NativeFieldValue,
} from "./types.js";

type CandidateDataset = "icbe" | "ucdp";
type TemporalReason = Extract<
  CandidateReason,
  "same_date" | "date_overlap" | "date_within_one_day" | "coarse_date_overlap"
>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nativeValues(record: CandidateSourceRecord, fields: readonly string[]): NativeFieldValue[] {
  return fields.flatMap((field) => {
    const value = record.native[field];
    return typeof value === "string" && value.length > 0 ? [{ field, value }] : [];
  });
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function aliasMatches(value: string, key: string, terms: readonly string[]): boolean {
  const normalized = normalizedText(value);
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return terms.some((term) =>
    (key === "dpr" || key === "lpr") && term.length === 3
      ? tokens.has(term)
      : normalized.includes(term),
  );
}

function aliasEvidence(
  kind: "geographic_context" | "localities" | "actors",
  icbeRecord: CandidateSourceRecord,
  ucdpRecord: CandidateSourceRecord,
): AliasEvidence[] {
  const fieldContract = ICBE_UCDP_CANDIDATE_CONTRACT.native_fields;
  const fieldsKind = kind === "actors" ? "actors" : "geography";
  const aliases =
    kind === "geographic_context"
      ? ICBE_UCDP_CANDIDATE_CONTRACT.normalization.geographic_context_aliases
      : kind === "localities"
        ? ICBE_UCDP_CANDIDATE_CONTRACT.normalization.locality_aliases
        : ICBE_UCDP_CANDIDATE_CONTRACT.normalization.actor_aliases;
  const icbeValues = nativeValues(icbeRecord, fieldContract.icbe[fieldsKind]);
  const ucdpValues = nativeValues(ucdpRecord, fieldContract.ucdp[fieldsKind]);
  return aliases.flatMap((alias) => {
    const icbeMatches = icbeValues.filter(({ value }) => aliasMatches(value, alias.key, alias.terms));
    const ucdpMatches = ucdpValues.filter(({ value }) => aliasMatches(value, alias.key, alias.terms));
    if (icbeMatches.length === 0 || ucdpMatches.length === 0) return [];
    return [
      {
        key: alias.key,
        normalization_rule: `${alias.rule}: ${alias.terms.join(" | ")}`,
        icbe_native_values: icbeMatches,
        ucdp_native_values: ucdpMatches,
      },
    ];
  });
}

function temporalEvidence(
  icbeRecord: CandidateSourceRecord,
  ucdpRecord: CandidateSourceRecord,
  icbe: IcbeCandidateView,
  ucdp: NativeSearchView,
): CandidateReasonEvidence["temporal"] {
  const icbeFrom = dayNumber(icbe.dateFrom);
  const icbeTo = dayNumber(icbe.dateTo);
  const ucdpFrom = dayNumber(ucdp.dateFrom);
  const ucdpTo = dayNumber(ucdp.dateTo);
  const ucdpIntervalDays = ucdpTo - ucdpFrom + 1;
  const precise =
    icbe.datePrecision === "day" &&
    ucdpIntervalDays <=
      ICBE_UCDP_CANDIDATE_CONTRACT.temporal_rules.precise_ucdp_max_interval_days;
  let reason: TemporalReason | null = null;
  if (icbeFrom <= ucdpTo && ucdpFrom <= icbeTo) {
    reason = precise
      ? icbeFrom === icbeTo && ucdpFrom === ucdpTo && icbeFrom === ucdpFrom
        ? "same_date"
        : "date_overlap"
      : "coarse_date_overlap";
  } else if (precise) {
    const gap = Math.min(Math.abs(icbeFrom - ucdpTo), Math.abs(ucdpFrom - icbeTo));
    if (gap <= ICBE_UCDP_CANDIDATE_CONTRACT.temporal_rules.near_date_max_gap_days) {
      reason = "date_within_one_day";
    }
  }
  return {
    reason,
    icbe: {
      native_values: nativeValues(
        icbeRecord,
        ICBE_UCDP_CANDIDATE_CONTRACT.native_fields.icbe.dates,
      ),
      interpreted_from: icbe.dateFrom,
      interpreted_to: icbe.dateTo,
      precision: icbe.datePrecision,
    },
    ucdp: {
      native_values: nativeValues(
        ucdpRecord,
        ICBE_UCDP_CANDIDATE_CONTRACT.native_fields.ucdp.dates,
      ),
      interpreted_from: ucdp.dateFrom,
      interpreted_to: ucdp.dateTo,
      interval_days: ucdpIntervalDays,
      native_date_prec: String(ucdpRecord.native.date_prec ?? ""),
    },
  };
}

export function evaluateCandidatePair(
  icbeRecord: CandidateSourceRecord,
  ucdpRecord: CandidateSourceRecord,
): CandidatePairEvaluation {
  const icbe = adaptIcbe(icbeRecord.native);
  const ucdp = adaptUcdp(ucdpRecord.native);
  const temporal = temporalEvidence(icbeRecord, ucdpRecord, icbe, ucdp);
  const geographicContext = aliasEvidence("geographic_context", icbeRecord, ucdpRecord);
  const localities = aliasEvidence("localities", icbeRecord, ucdpRecord);
  const actors = aliasEvidence("actors", icbeRecord, ucdpRecord);
  const isCoarse = temporal.reason === "coarse_date_overlap";
  const requiredActorMatches = isCoarse ? 2 : 1;
  const exclusionReasons: string[] = [];
  if (temporal.reason === null) exclusionReasons.push("no_temporal_signal");
  if (geographicContext.length === 0) exclusionReasons.push("no_geographic_context_overlap");
  if (actors.length === 0) exclusionReasons.push("no_actor_overlap");
  if (isCoarse && localities.length === 0) {
    exclusionReasons.push("coarse_date_requires_locality_overlap");
  }
  if (isCoarse && actors.length < requiredActorMatches) {
    exclusionReasons.push("coarse_date_requires_two_actor_aliases");
  }
  const candidate = exclusionReasons.length === 0;
  const reasons: CandidateReason[] = candidate
    ? [
        temporal.reason!,
        "geographic_context_overlap",
        ...(isCoarse ? (["locality_overlap"] as const) : []),
        "actor_overlap",
      ]
    : [];
  const identity = { icbe_ref: icbeRecord.ref, ucdp_ref: ucdpRecord.ref, reasons };
  const candidateId = candidate
    ? `candidate:${sha256(identity).slice("sha256:".length, "sha256:".length + 20)}`
    : null;
  return {
    ...identity,
    candidate,
    candidate_id: candidateId,
    reason_evidence: { temporal, geographic_context: geographicContext, localities, actors },
    exclusion_reasons: exclusionReasons,
  };
}

function pairFromEvaluation(evaluation: CandidatePairEvaluation): CandidatePair | undefined {
  if (!evaluation.candidate || evaluation.candidate_id === null) return undefined;
  return {
    kind: "candidate_pair",
    id: evaluation.candidate_id,
    icbe_ref: evaluation.icbe_ref,
    ucdp_ref: evaluation.ucdp_ref,
    reasons: evaluation.reasons,
    reason_evidence: evaluation.reason_evidence,
  };
}

function valuesContain(values: readonly string[], query: string): boolean {
  const needle = normalizedText(query);
  if (needle === "donbas" || needle === "donbass") {
    return values.some((value) =>
      aliasMatches(value, "donbas", ["donbas", "donbass", "donetsk", "luhansk"]),
    );
  }
  return values.some((value) => normalizedText(value).includes(needle));
}

export class CandidateStore {
  readonly dataDirectory: string;
  readonly bundles: Record<CandidateDataset, CandidateSourceBundle>;

  constructor(dataDirectory: string) {
    this.dataDirectory = resolve(dataDirectory);
    this.bundles = {
      icbe: readJson(resolve(this.dataDirectory, "icbe.json")),
      ucdp: readJson(resolve(this.dataDirectory, "ucdp.json")),
    };
    this.validate();
  }

  records(): CandidateSourceRecord[] {
    return [...this.bundles.icbe.records, ...this.bundles.ucdp.records].sort((a, b) =>
      compareStrings(a.ref, b.ref),
    );
  }

  record(ref: string): CandidateSourceRecord | undefined {
    return this.records().find((record) => record.ref === ref);
  }

  private validate(): void {
    for (const dataset of ["icbe", "ucdp"] as const) {
      const bundle = this.bundles[dataset];
      if (bundle.dataset !== dataset) throw new Error(`${dataset}.json declares ${bundle.dataset}`);
      for (const record of bundle.records) {
        if (record.dataset !== dataset || !record.ref.startsWith(`${dataset}:`)) {
          throw new Error(`${record.ref} does not belong to ${dataset}`);
        }
        if (sha256(record.native) !== record.native_sha256) {
          throw new Error(`${record.ref} native hash does not match its unchanged fields`);
        }
        if (dataset === "ucdp") {
          if (
            record.native_identity.kind !== "native_id" ||
            record.native.id !== record.native_identity.value
          ) {
            throw new Error(`${record.ref} does not preserve the native UCDP id`);
          }
          adaptUcdp(record.native);
        } else {
          if (record.native_identity.kind !== "source_row_locator") {
            throw new Error(`${record.ref} must use an ICBe source-row locator`);
          }
          const expected = makeIcbeSourceLocator({
            datasetVersion: bundle.dataset_version,
            source: bundle.source,
            rowNumber: record.native_identity.extracted_table.row_number,
            native: record.native,
          });
          if (JSON.stringify(record.native_identity) !== JSON.stringify(expected)) {
            throw new Error(`${record.ref} ICBe source locator does not bind its artifact and row`);
          }
          if (record.ref !== `icbe:${expected.value}`) {
            throw new Error(`${record.ref} does not preserve its full ICBe source locator`);
          }
          adaptIcbe(record.native);
        }
      }
    }
    if (JSON.stringify(this.bundles.icbe.selection) !== JSON.stringify(this.bundles.ucdp.selection)) {
      throw new Error("candidate bundles do not declare the same comparison window");
    }
  }

  private normalizeQuery(input: Partial<CandidateQuery>): CandidateQuery {
    const selection = this.bundles.icbe.selection;
    const datasets = [...new Set(input.datasets ?? ["icbe", "ucdp"])].sort() as Array<
      "icbe" | "ucdp"
    >;
    if (datasets.join(",") !== "icbe,ucdp") {
      throw new Error("candidate mode currently requires exactly --datasets icbe,ucdp");
    }
    const query: CandidateQuery = {
      candidate_pairs: true,
      datasets,
      place: input.place?.trim() || "Donbas",
      from: input.from?.trim() || selection.from,
      to: input.to?.trim() || selection.to,
      ...(input.actor?.trim() ? { actor: input.actor.trim() } : {}),
    };
    if (query.from! > query.to!) throw new Error("--from must not be after --to");
    return query;
  }

  private selectedRecords(query: CandidateQuery): CandidateSourceRecord[] {
    return ([...this.bundles.icbe.records, ...this.bundles.ucdp.records] as CandidateSourceRecord[])
      .filter((record) => {
        const view = record.dataset === "icbe" ? adaptIcbe(record.native) : adaptUcdp(record.native);
        if (view.dateTo < query.from! || view.dateFrom > query.to!) return false;
        if (query.place && !valuesContain(view.places, query.place)) return false;
        if (query.actor && !valuesContain(view.actors, query.actor)) return false;
        return true;
      })
      .sort((a, b) => compareStrings(a.ref, b.ref));
  }

  pairEvaluations(input: Partial<CandidateQuery>): CandidatePairEvaluation[] {
    const records = this.selectedRecords(this.normalizeQuery(input));
    const icbeRecords = records.filter((record) => record.dataset === "icbe");
    const ucdpRecords = records.filter((record) => record.dataset === "ucdp");
    return icbeRecords
      .flatMap((icbe) => ucdpRecords.map((ucdp) => evaluateCandidatePair(icbe, ucdp)))
      .sort((a, b) =>
        compareStrings(`${a.icbe_ref}\u0000${a.ucdp_ref}`, `${b.icbe_ref}\u0000${b.ucdp_ref}`),
      );
  }

  search(input: Partial<CandidateQuery>): CandidateSearchResponse {
    const query = this.normalizeQuery(input);
    const records = this.selectedRecords(query);
    const evaluations = this.pairEvaluations(query);
    const candidatePairs = evaluations
      .map(pairFromEvaluation)
      .filter((pair): pair is CandidatePair => pair !== undefined);
    const participating = new Set(
      candidatePairs.flatMap((pair) => [pair.icbe_ref, pair.ucdp_ref]),
    );
    const notPrioritizedRefs = records
      .filter((record) => !participating.has(record.ref))
      .map((record) => record.ref);

    const receiptBody = {
      search_contract_version: CANDIDATE_SEARCH_CONTRACT_VERSION,
      candidate_contract: ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY,
      inputs: {
        icbe: {
          version: this.bundles.icbe.dataset_version,
          artifact_sha256: this.bundles.icbe.source.artifact_sha256,
          source_bundle_sha256: sha256(this.bundles.icbe),
        },
        ucdp: {
          version: this.bundles.ucdp.dataset_version,
          artifact_sha256: this.bundles.ucdp.source.artifact_sha256,
          source_bundle_sha256: sha256(this.bundles.ucdp),
        },
      },
      parameters: query,
      native_records: records.map(({ ref, native_sha256 }) => ({ ref, native_sha256 })),
      candidate_pairs: candidatePairs.map(
        ({ id, icbe_ref, ucdp_ref, reasons, reason_evidence }) => ({
          id,
          icbe_ref,
          ucdp_ref,
          reasons,
          reason_evidence,
        }),
      ),
    };

    return {
      format_version: CLI_FORMAT_VERSION,
      mode: "candidate_pairs",
      mapping_authority: false,
      records,
      candidate_pairs: candidatePairs,
      mappings: [],
      not_prioritized_refs: notPrioritizedRefs,
      no_candidate_notice:
        "No candidate means only that this pinned candidate contract did not prioritize the record; it does not mean aldera:unmapped.",
      receipt: { ...receiptBody, receipt_sha256: sha256(receiptBody) },
    };
  }
}
