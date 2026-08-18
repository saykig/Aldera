import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adaptIcbe } from "../src/adapters/icbe.js";
import { CandidateStore } from "../src/candidate-store.js";
import type {
  AliasEvidence,
  CandidatePairEvaluation,
  CandidateSourceRecord,
} from "../src/types.js";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const [mainBundleDirectory, controlBundleDirectory, outputPath, benchmarkPath] = args;
if (!mainBundleDirectory || !controlBundleDirectory || !outputPath) {
  throw new Error(
    "usage: render-stage3a-human-review.ts <main bundles> <MH17 control bundles> <output Markdown> [human benchmark JSON]",
  );
}

const query = { candidate_pairs: true as const, datasets: ["icbe", "ucdp"] as const };
const mainStore = new CandidateStore(mainBundleDirectory);
const mainResult = mainStore.search(query);
const mainEvaluations = mainStore.pairEvaluations(query);
const controlStore = new CandidateStore(controlBundleDirectory);
const controlResult = controlStore.search(query);
const controlEvaluations = controlStore.pairEvaluations(query);

type ReviewChoice = "yes" | "no" | "unsure";
type ScopeDirection =
  | "icbe_broader_ucdp_narrower"
  | "ucdp_broader_icbe_narrower"
  | null;

interface HumanBenchmarkCase {
  review_item: number;
  pair: { icbe_ref: string; ucdp_ref: string };
  aldera: {
    prioritized: boolean;
    candidate_id: string | null;
    reasons: string[];
    exclusion_reasons: string[];
  };
  human_judgment: {
    same_underlying_occurrence: ReviewChoice;
    meaningfully_related: ReviewChoice;
    broader_narrower: ReviewChoice;
    broader_narrower_direction: ScopeDirection;
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
  candidate_contract: { id: string; version: string; sha256: string };
  search_receipts: { main: string; mh17_control: string };
  cases: HumanBenchmarkCase[];
}

const benchmark = benchmarkPath
  ? (JSON.parse(readFileSync(resolve(benchmarkPath), "utf8")) as HumanBenchmark)
  : undefined;

if (benchmark) {
  if (
    benchmark.kind !== "human_review_benchmark" ||
    benchmark.mapping_authority !== false ||
    benchmark.not_a_mapping_bundle !== true
  ) {
    throw new Error("human benchmark must be explicitly non-authoritative");
  }
  if (benchmark.review_date !== "2026-08-18") {
    throw new Error(`unexpected human review date ${benchmark.review_date}`);
  }
  if (
    JSON.stringify(benchmark.candidate_contract) !==
      JSON.stringify(mainResult.receipt.candidate_contract) ||
    JSON.stringify(benchmark.candidate_contract) !==
      JSON.stringify(controlResult.receipt.candidate_contract)
  ) {
    throw new Error("human benchmark candidate-contract identity does not match the cases");
  }
  if (benchmark.cases.length !== 16) throw new Error("human benchmark must contain 16 cases");
  if (new Set(benchmark.cases.map(({ review_item }) => review_item)).size !== 16) {
    throw new Error("human benchmark review-item numbers must be unique");
  }
  if (
    benchmark.search_receipts.main !== mainResult.receipt.receipt_sha256 ||
    benchmark.search_receipts.mh17_control !== controlResult.receipt.receipt_sha256
  ) {
    throw new Error("human benchmark search receipts do not match the pinned cases");
  }
  for (const item of benchmark.cases) {
    const judgment = item.human_judgment;
    if (
      (judgment.broader_narrower === "yes") !==
      (judgment.broader_narrower_direction !== null)
    ) {
      throw new Error(`human benchmark item ${item.review_item} has inconsistent scope direction`);
    }
  }
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function rawFields(record: CandidateSourceRecord, fields: readonly string[]): string {
  const values = fields.flatMap((field) =>
    present(record.native[field]) ? [`${field}=\`${String(record.native[field])}\``] : [],
  );
  return values.join("; ") || "No listed native field is populated.";
}

function rowNumber(record: CandidateSourceRecord): number {
  if (record.native_identity.kind !== "source_row_locator") {
    throw new Error(`${record.ref} is not an ICBe source locator`);
  }
  return record.native_identity.extracted_table.row_number;
}

function recordsFor(
  store: CandidateStore,
  evaluation: CandidatePairEvaluation,
): { icbe: CandidateSourceRecord; ucdp: CandidateSourceRecord } {
  const icbe = store.bundles.icbe.records.find((record) => record.ref === evaluation.icbe_ref);
  const ucdp = store.bundles.ucdp.records.find((record) => record.ref === evaluation.ucdp_ref);
  if (!icbe || !ucdp) throw new Error("review pair has an unresolved native record");
  return { icbe, ucdp };
}

function aliasSignal(label: string, evidence: AliasEvidence[]): string {
  if (evidence.length === 0) return `${label}: none`;
  return `${label}: ${evidence
    .map(
      ({ key, icbe_native_values, ucdp_native_values }) =>
        `${key} (ICBe ${icbe_native_values.map(({ field, value }) => `${field}=\`${value}\``).join(", ")}; UCDP ${ucdp_native_values.map(({ field, value }) => `${field}=\`${value}\``).join(", ")})`,
    )
    .join("; ")}`;
}

function algorithmExplanation(evaluation: CandidatePairEvaluation): string[] {
  const temporal = evaluation.reason_evidence.temporal;
  return [
    evaluation.candidate
      ? `- Outcome: surfaced as a prioritized candidate; required signal names: \`${evaluation.reasons.join("`, `")}\`.`
      : `- Outcome: excluded from the prioritized candidate list by: \`${evaluation.exclusion_reasons.join("`, `")}\`.`,
    `- Temporal signal: \`${temporal.reason ?? "none"}\`; ICBe ${temporal.icbe.interpreted_from} through ${temporal.icbe.interpreted_to} (${temporal.icbe.precision}); UCDP ${temporal.ucdp.interpreted_from} through ${temporal.ucdp.interpreted_to} (${temporal.ucdp.interval_days} day interval; native date_prec=\`${temporal.ucdp.native_date_prec}\`).`,
    `- ${aliasSignal("Shared geographic context", evaluation.reason_evidence.geographic_context)}`,
    `- ${aliasSignal("Specific locality", evaluation.reason_evidence.localities)}`,
    `- ${aliasSignal("Actor", evaluation.reason_evidence.actors)}`,
  ];
}

const ICBE_ACTION_FIELDS = [
  "event_type",
  "do_interact_kind",
  "do_kind",
  "do_duration",
  "duration",
  "do_timing",
  "interact_escalate",
  "interact_deescalate",
  "interact_increasecoop",
  "interact_decreasecoop",
  "interact_geoscope",
  "interact_domains",
  "interact_forces",
  "interact_territory",
  "interact_units",
  "interact_fatalities",
  "act_uncooperative",
  "act_cooperative",
  "act_escalate",
  "act_deescalate",
] as const;

function reviewItem(
  index: number,
  store: CandidateStore,
  evaluation: CandidatePairEvaluation,
): string[] {
  const { icbe, ucdp } = recordsFor(store, evaluation);
  const icbeView = adaptIcbe(icbe.native);
  const reviewed = benchmark?.cases.find((item) => item.review_item === index);
  if (reviewed) {
    if (
      reviewed.pair.icbe_ref !== evaluation.icbe_ref ||
      reviewed.pair.ucdp_ref !== evaluation.ucdp_ref
    ) {
      throw new Error(`human benchmark item ${index} does not identify the rendered pair`);
    }
    if (
      reviewed.aldera.prioritized !== evaluation.candidate ||
      reviewed.aldera.candidate_id !== evaluation.candidate_id ||
      JSON.stringify(reviewed.aldera.reasons) !== JSON.stringify(evaluation.reasons) ||
      JSON.stringify(reviewed.aldera.exclusion_reasons) !==
        JSON.stringify(evaluation.exclusion_reasons)
    ) {
      throw new Error(`human benchmark item ${index} does not match Aldera's pinned output`);
    }
  }
  const checkbox = (choice: ReviewChoice | undefined, option: ReviewChoice): string =>
    choice === option ? "[x]" : "[ ]";
  const judgment = reviewed?.human_judgment;
  const unsafeChoice: ReviewChoice | undefined = judgment
    ? judgment.safe_or_unsafe_equivalence === "unsafe_as_equivalent"
      ? "yes"
      : judgment.safe_or_unsafe_equivalence === "safe_as_equivalent"
        ? "no"
        : "unsure"
    : undefined;
  const direction =
    judgment?.broader_narrower_direction === "icbe_broader_ucdp_narrower"
      ? "ICBe broader; UCDP narrower"
      : judgment?.broader_narrower_direction === "ucdp_broader_icbe_narrower"
        ? "UCDP broader; ICBe narrower"
        : "—";
  return [
    `### ${index}. ICBe row ${rowNumber(icbe)} ↔ UCDP ${String(ucdp.native.id)}`,
    "",
    "ICBe record:",
    "",
    `- Date: ${icbeView.dateFrom} through ${icbeView.dateTo}; interpreted precision \`${icbeView.datePrecision}\`. Native components: ${rawFields(icbe, ["date_earliest_year", "date_earliest_month", "date_earliest_day", "date_latest_year", "date_latest_month", "date_latest_day"])} `,
    `- Native description: ${String(icbe.native.sentence_span_text)}`,
    `- Important native coded action/category: ${rawFields(icbe, ICBE_ACTION_FIELDS)}`,
    `- Actors: ${rawFields(icbe, ["do_actor_a", "do_actor_b", "say_actor_a", "say_actor_b", "think_actor_a"])}`,
    `- Geography: ${rawFields(icbe, ["interact_location", "interact_geoscope"])}`,
    "",
    "UCDP record:",
    "",
    `- Date: ${rawFields(ucdp, ["date_start", "date_end", "date_prec"])}`,
    `- Native event/source description: ${rawFields(ucdp, ["source_headline", "source_original"])}`,
    `- Actors: ${rawFields(ucdp, ["side_a", "side_b", "dyad_name"])}`,
    `- Geography: ${rawFields(ucdp, ["country", "adm_1", "adm_2", "where_coordinates", "where_description", "where_prec"])}`,
    `- Fatalities/category: ${rawFields(ucdp, ["best", "low", "high", "type_of_violence", "conflict_name"])}`,
    "",
    "Aldera surfaced/excluded this pair because:",
    "",
    ...algorithmExplanation(evaluation),
    "",
    "HUMAN REVIEW:",
    "",
    `Same underlying occurrence? ${checkbox(judgment?.same_underlying_occurrence, "yes")} yes ${checkbox(judgment?.same_underlying_occurrence, "no")} no ${checkbox(judgment?.same_underlying_occurrence, "unsure")} unsure`,
    `Meaningfully related?       ${checkbox(judgment?.meaningfully_related, "yes")} yes ${checkbox(judgment?.meaningfully_related, "no")} no ${checkbox(judgment?.meaningfully_related, "unsure")} unsure`,
    `Broader/narrower relation?  ${checkbox(judgment?.broader_narrower, "yes")} yes ${checkbox(judgment?.broader_narrower, "no")} no ${checkbox(judgment?.broader_narrower, "unsure")} unsure`,
    `Direction: ${direction}`,
    `Not safely comparable?      ${checkbox(unsafeChoice, "yes")} yes ${checkbox(unsafeChoice, "no")} no ${checkbox(unsafeChoice, "unsure")} unsure`,
    `Notes: ${judgment?.note ?? ""}`,
    "",
    "",
  ];
}

function evaluationFor(
  evaluations: CandidatePairEvaluation[],
  store: CandidateStore,
  row: number,
  ucdpId: string,
): CandidatePairEvaluation {
  const icbe = store.bundles.icbe.records.find(
    (record) =>
      record.native_identity.kind === "source_row_locator" &&
      record.native_identity.extracted_table.row_number === row,
  );
  const found = evaluations.find(
    (evaluation) => evaluation.icbe_ref === icbe?.ref && evaluation.ucdp_ref === `ucdp:${ucdpId}`,
  );
  if (!found) throw new Error(`review pair ICBe row ${row} ↔ UCDP ${ucdpId} is absent`);
  return found;
}

const lines = [
  "# Aldera Stage 3A human-review checkpoint",
  "",
  benchmark
    ? `> Human review completed ${benchmark.review_date}. These judgments are preserved exactly in a non-authoritative benchmark; they are not mapping assertions.`
    : "> No substantive relationship judgment has been pre-filled. Aldera candidate status is only an algorithmic prioritization result. Stage 3A substantive relationship judgments remain pending human review.",
  "",
  "## A. Current prioritized candidates",
  "",
  `The current bounded slice has ${mainResult.candidate_pairs.length} prioritized pairs.`,
  "",
];

let itemNumber = 1;
for (const pair of mainResult.candidate_pairs) {
  const evaluation = mainEvaluations.find(
    (candidate) => candidate.icbe_ref === pair.icbe_ref && candidate.ucdp_ref === pair.ucdp_ref,
  );
  if (!evaluation) throw new Error(`candidate ${pair.id} has no pair evaluation`);
  lines.push(...reviewItem(itemNumber++, mainStore, evaluation));
}

lines.push(
  "## B. Challenge non-candidates",
  "",
  "These pairs were selected as false-negative challenges. Their inclusion here is not a substantive relationship judgment; only the contract's exclusion reason is stated.",
  "",
);
for (const [row, ucdpId] of [
  [18424, "152957"],
  [18422, "155086"],
  [18420, "149876"],
] as const) {
  const evaluation = evaluationFor(mainEvaluations, mainStore, row, ucdpId);
  if (evaluation.candidate) throw new Error(`challenge pair ${row}/${ucdpId} is prioritized`);
  lines.push(...reviewItem(itemNumber++, mainStore, evaluation));
}

const mh17Evaluation = evaluationFor(controlEvaluations, controlStore, 18436, "154679");
lines.push(
  "## C. Positive control — 2014-07-16 through 2014-07-18",
  "",
  `The separate pinned slice contains ${controlStore.bundles.icbe.records.length} ICBe and ${controlStore.bundles.ucdp.records.length} UCDP native records (${controlEvaluations.length} evaluated pairs). The unchanged candidate rules prioritized ${controlResult.candidate_pairs.length} pairs. ICBe row 18436 ↔ UCDP 154679 was ${mh17Evaluation.candidate ? "surfaced" : "excluded"} by the contract. This is an algorithmic result, not a substantive judgment.`,
  "",
  "All prioritized control pairs are included so the reviewer can assess both the intended control and possible false positives.",
  "",
);
for (const pair of controlResult.candidate_pairs) {
  const evaluation = controlEvaluations.find(
    (candidate) => candidate.icbe_ref === pair.icbe_ref && candidate.ucdp_ref === pair.ucdp_ref,
  );
  if (!evaluation) throw new Error(`control candidate ${pair.id} has no pair evaluation`);
  lines.push(...reviewItem(itemNumber++, controlStore, evaluation));
}

writeFileSync(resolve(outputPath), `${lines.join("\n")}\n`);
