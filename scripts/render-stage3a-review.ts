import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adaptIcbe } from "../src/adapters/icbe.js";
import { CandidateStore } from "../src/candidate-store.js";
import type {
  AliasEvidence,
  CandidatePairEvaluation,
  CandidateSourceRecord,
  NativeFieldValue,
} from "../src/types.js";

const scriptArgs = process.argv.slice(2);
if (scriptArgs[0] === "--") scriptArgs.shift();
const [bundleDirectoryArg, outputPathArg] = scriptArgs;
if (!bundleDirectoryArg || !outputPathArg) {
  throw new Error("usage: render-stage3a-review.ts <bundle directory> <output Markdown path>");
}

const store = new CandidateStore(bundleDirectoryArg);
const query = { candidate_pairs: true as const, datasets: ["icbe", "ucdp"] as const };
const result = store.search(query);
const evaluations = store.pairEvaluations(query);
const records = new Map(result.records.map((record) => [record.ref, record]));

function value(record: CandidateSourceRecord, field: string): string {
  const found = record.native[field];
  return found === null || found === undefined || found === "" ? "—" : String(found);
}

function clean(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

function nativeValues(values: NativeFieldValue[]): string {
  return values.map(({ field, value }) => `${field}=${clean(value)}`).join("; ") || "—";
}

function aliasValues(evidence: AliasEvidence[]): string {
  return (
    evidence
      .map(
        ({ key, icbe_native_values, ucdp_native_values }) =>
          `${key}: ICBe[${nativeValues(icbe_native_values)}] ↔ UCDP[${nativeValues(ucdp_native_values)}]`,
      )
      .join(" / ") || "—"
  );
}

function icbeRow(record: CandidateSourceRecord): number {
  if (record.native_identity.kind !== "source_row_locator") {
    throw new Error(`${record.ref} is not an ICBe source locator`);
  }
  return record.native_identity.extracted_table.row_number;
}

function shortRef(record: CandidateSourceRecord): string {
  return record.dataset === "icbe" ? `ICBe row ${icbeRow(record)}` : `UCDP ${value(record, "id")}`;
}

function temporalCell(evaluation: Pick<CandidatePairEvaluation, "reason_evidence">): string {
  const { temporal } = evaluation.reason_evidence;
  const reason = temporal.reason ?? "none";
  return clean(
    `${reason}; ICBe ${temporal.icbe.interpreted_from}..${temporal.icbe.interpreted_to} (${temporal.icbe.precision}; ${nativeValues(temporal.icbe.native_values)}); UCDP ${temporal.ucdp.interpreted_from}..${temporal.ucdp.interpreted_to} (${temporal.ucdp.interval_days}d, date_prec=${temporal.ucdp.native_date_prec}; ${nativeValues(temporal.ucdp.native_values)})`,
  );
}

function icbeSection(record: CandidateSourceRecord): string[] {
  if (record.native_identity.kind !== "source_row_locator") {
    throw new Error(`${record.ref} has an invalid ICBe identity`);
  }
  const locator = record.native_identity;
  return [
    `#### ICBe native representation — row ${locator.extracted_table.row_number}`,
    "",
    `- Stable source locator: \`${locator.value}\`.`,
    `- Exact source binding: dataset \`${locator.dataset_version}\`; raw \`${locator.raw_artifact.filename}\` / \`${locator.raw_artifact.sha256}\`; extracted table \`${locator.extracted_table.filename}\` / \`${locator.extracted_table.sha256}\`; source row \`${locator.extracted_table.row_number}\`.`,
    `- Native crisis / sentence coordinates: \`${locator.native_coordinates.crisno}\` / \`${locator.native_coordinates.sentence_number_int_aligned}\`. These are coordinates, not a native event ID.`,
    `- Native earliest date fields: year \`${value(record, "date_earliest_year")}\`, month \`${value(record, "date_earliest_month")}\`, day \`${value(record, "date_earliest_day")}\``,
    `- Native latest date fields: year \`${value(record, "date_latest_year")}\`, month \`${value(record, "date_latest_month")}\`, day \`${value(record, "date_latest_day")}\``,
    `- Native place field \`interact_location\`: ${value(record, "interact_location")}`,
    `- Native actors: do_actor_a=${value(record, "do_actor_a")}; do_actor_b=${value(record, "do_actor_b")}; say_actor_a=${value(record, "say_actor_a")}; say_actor_b=${value(record, "say_actor_b")}; think_actor_a=${value(record, "think_actor_a")}`,
    `- Native event/action fields: event_type=${value(record, "event_type")}; do_kind=${value(record, "do_kind")}; act_uncooperative=${value(record, "act_uncooperative")}; act_escalate=${value(record, "act_escalate")}; act_deescalate=${value(record, "act_deescalate")}`,
    `- Native sentence: ${value(record, "sentence_span_text")}`,
    `- Native SHA-256: \`${record.native_sha256}\``,
    "",
  ];
}

function ucdpSection(record: CandidateSourceRecord): string[] {
  return [
    `#### UCDP GED native representation — ${record.ref}`,
    "",
    `- Native ID: \`${value(record, "id")}\``,
    `- Native dates: \`date_start=${value(record, "date_start")}\`; \`date_end=${value(record, "date_end")}\`; \`date_prec=${value(record, "date_prec")}\``,
    `- Native places: country=${value(record, "country")}; adm_1=${value(record, "adm_1")}; adm_2=${value(record, "adm_2")}; where_coordinates=${value(record, "where_coordinates")}; where_description=${value(record, "where_description")}; where_prec=${value(record, "where_prec")}`,
    `- Native actors: side_a=${value(record, "side_a")}; side_b=${value(record, "side_b")}; dyad_name=${value(record, "dyad_name")}`,
    `- Native event/category fields: type_of_violence=${value(record, "type_of_violence")}; conflict_name=${value(record, "conflict_name")}; best=${value(record, "best")}; high=${value(record, "high")}; low=${value(record, "low")}`,
    `- Native source description: source_headline=${value(record, "source_headline")}; source_original=${value(record, "source_original")}`,
    `- Native SHA-256: \`${record.native_sha256}\``,
    "",
  ];
}

function unmatchedSummary(record: CandidateSourceRecord): string {
  if (record.dataset === "icbe") {
    const view = adaptIcbe(record.native);
    return `${shortRef(record)} — ${view.dateFrom}..${view.dateTo} (${view.datePrecision}); ${clean(value(record, "sentence_span_text"))}`;
  }
  return `${shortRef(record)} — ${value(record, "date_start")}..${value(record, "date_end")}; ${clean(value(record, "source_headline"))}`;
}

const lines = [
  "# Aldera Stage 3A candidate review — ICBe ↔ UCDP GED",
  "",
  "> Candidate generation is only a deterministic prioritization aid. This artifact contains no accepted mapping assertions and assigns no Aldera relation or confidence score. No candidate does not mean `aldera:unmapped`.",
  "",
  "## Pinned provenance and candidate contract",
  "",
  `- Search contract: \`${result.receipt.search_contract_version}\`; receipt: \`${result.receipt.receipt_sha256}\``,
  `- Candidate contract: \`${result.receipt.candidate_contract.id}\` version \`${result.receipt.candidate_contract.version}\`; \`${result.receipt.candidate_contract.sha256}\``,
  `- ICBe: ${result.receipt.inputs.icbe.version}; raw archive \`${result.receipt.inputs.icbe.artifact_sha256}\`; parsed bundle \`${result.receipt.inputs.icbe.source_bundle_sha256}\``,
  `- UCDP: ${result.receipt.inputs.ucdp.version}; raw archive \`${result.receipt.inputs.ucdp.artifact_sha256}\`; parsed bundle \`${result.receipt.inputs.ucdp.source_bundle_sha256}\``,
  `- Normalized parameters: \`${JSON.stringify(result.receipt.parameters)}\``,
  `- Returned native records: ${result.records.length}; evaluated pairs: ${evaluations.length}; candidate pairs: ${result.candidate_pairs.length}; mappings: ${result.mappings.length}`,
  "",
  "## Complete 12 × 10 review matrix",
  "",
  "Every pair is shown, including pairs that were not prioritized. Native values shown here are evidence; aliases never replace the native records.",
  "",
  "| ICBe | UCDP | Temporal native evidence | Donbas place evidence | Specific locality evidence | Actor evidence | Candidate | Exclusions |",
  "|---|---|---|---|---|---|---:|---|",
];

for (const evaluation of evaluations) {
  const icbe = records.get(evaluation.icbe_ref);
  const ucdp = records.get(evaluation.ucdp_ref);
  if (!icbe || !ucdp) throw new Error("review evaluation has an unresolved record");
  lines.push(
    `| row ${icbeRow(icbe)} | ${value(ucdp, "id")} | ${temporalCell(evaluation)} | ${clean(aliasValues(evaluation.reason_evidence.places))} | ${clean(aliasValues(evaluation.reason_evidence.localities))} | ${clean(aliasValues(evaluation.reason_evidence.actors))} | ${evaluation.candidate ? "yes" : "no"} | ${evaluation.exclusion_reasons.join(", ") || "—"} |`,
  );
}

lines.push("", "## Candidate pairs", "");
for (const [index, pair] of result.candidate_pairs.entries()) {
  const icbe = records.get(pair.icbe_ref);
  const ucdp = records.get(pair.ucdp_ref);
  if (!icbe || !ucdp) throw new Error(`candidate ${pair.id} has an unresolved record`);
  lines.push(
    `### ${index + 1}. ${shortRef(icbe)} ↔ ${shortRef(ucdp)}`,
    "",
    `Candidate ID: \`${pair.id}\`; reasons: \`${pair.reasons.join("`, `")}\`.`,
    "",
    `- Temporal evidence: ${temporalCell(pair)}`,
    `- Donbas place evidence: ${aliasValues(pair.reason_evidence.places)}`,
    `- Specific locality evidence: ${aliasValues(pair.reason_evidence.localities)}`,
    `- Actor evidence: ${aliasValues(pair.reason_evidence.actors)}`,
    "",
    ...icbeSection(icbe),
    ...ucdpSection(ucdp),
  );
}

lines.push(
  "## Human inspection finding",
  "",
  "None of the seven prioritized pairs is a plausible same-occurrence pair. The four 7 April ICBe codings describe building seizures, declarations, and the broader outbreak of war, while UCDP 395636 records a lethal incident on 8 April. The two 14 April pairs describe an operation announcement versus distinct 13 April fatalities. The 23/24 April pair compares Russian troop exercises with a Ukrainian assault at Sloviansk. These may concern a connected episode, but that is not a same-occurrence assertion and no mapping is created.",
  "",
  "Recommended follow-up: use a separate narrow 2014-07-16 through 2014-07-18 Donbas window. In the same pinned sources, ICBe source row 18436 describes the 17 July downing of Malaysia Airlines Flight 17, while UCDP native ID 154679 is a day-precise 17 July record at the MH17 crash site. That is a better test for a possible same-occurrence relation; it still requires human review.",
  "",
  "## Native records with no candidate",
  "",
  result.no_candidate_notice,
  "",
);
for (const ref of result.unmatched_refs) {
  const record = records.get(ref);
  if (!record) throw new Error(`unmatched ref ${ref} is unresolved`);
  lines.push(`- ${unmatchedSummary(record)}`);
}
lines.push("");

writeFileSync(resolve(outputPathArg), `${lines.join("\n")}\n`);
