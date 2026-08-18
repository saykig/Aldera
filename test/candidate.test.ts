import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CandidateStore, evaluateCandidatePair } from "../src/candidate-store.js";
import { ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY } from "../src/candidate-contract.js";
import { sha256 } from "../src/canonical.js";
import { adaptIcbe } from "../src/adapters/icbe.js";
import { makeIcbeSourceLocator } from "../src/icbe-source-locator.js";
import type { CandidateSourceBundle, CandidateSourceRecord } from "../src/types.js";

const temporaryDirectories: string[] = [];
after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

const source = {
  artifact_url: "https://example.test/pinned",
  artifact_filename: "pinned.zip",
  artifact_sha256: `sha256:${"1".repeat(64)}`,
  extracted_artifact_filename: "native.data",
  extracted_artifact_sha256: `sha256:${"2".repeat(64)}`,
};
const selection = {
  case: "synthetic adapter test only",
  place: "Donbas",
  from: "2014-04-07",
  to: "2014-04-24",
};

function envelope(
  dataset: "icbe" | "ucdp",
  version: string,
  identity: CandidateSourceRecord["native_identity"],
  native: Record<string, unknown>,
): CandidateSourceRecord {
  return {
    ref: `${dataset}:${identity.value}`,
    dataset,
    dataset_version: version,
    native_identity: identity,
    native_sha256: sha256(native),
    native,
  };
}

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "aldera-candidate-test-"));
  temporaryDirectories.push(directory);
  const icbeNative = {
    crisno: 471,
    sentence_number_int_aligned: 30,
    sentence_span_text: "Pro-Russian militants in Donbass took control of government buildings.",
    event_type: "action",
    date_earliest_day: "7",
    date_earliest_month: "4",
    date_earliest_year: "2014",
    date_latest_day: "",
    date_latest_month: "",
    date_latest_year: "",
    interact_location: "donbass;government buildings;target",
    do_actor_a: "dpr/lpr",
    do_actor_b: "Ukraine",
  };
  const ucdpNative = {
    id: "395636",
    country: "Ukraine",
    adm_1: "Donetsk oblast",
    where_prec: "4",
    date_start: "2014-04-08 00:00:00.000",
    date_end: "2014-04-08 00:00:00.000",
    side_a: "Government of Ukraine",
    side_b: "DPR",
  };
  const bundles: CandidateSourceBundle[] = [
    {
      schema_version: "0.1.0",
      dataset: "icbe",
      dataset_version: "ICBe V1.1 test shape",
      source,
      selection,
      records: [
        envelope(
          "icbe",
          "ICBe V1.1 test shape",
          makeIcbeSourceLocator({
            datasetVersion: "ICBe V1.1 test shape",
            source,
            rowNumber: 18416,
            native: icbeNative,
          }),
          icbeNative,
        ),
      ],
    },
    {
      schema_version: "0.1.0",
      dataset: "ucdp",
      dataset_version: "UCDP GED Global 26.1 test shape",
      source,
      selection,
      records: [
        envelope(
          "ucdp",
          "UCDP GED Global 26.1 test shape",
          { kind: "native_id", value: "395636", native_fields: ["id"] },
          ucdpNative,
        ),
      ],
    },
  ];
  for (const bundle of bundles) {
    writeFileSync(join(directory, `${bundle.dataset}.json`), JSON.stringify(bundle));
  }
  return directory;
}

function hasNumericConfidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNumericConfidence);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      (key.toLowerCase().includes("confidence") && typeof child === "number") ||
      hasNumericConfidence(child),
  );
}

describe("non-authoritative candidate discovery", () => {
  test("preserves ICBe fields and the absence of a native event-ID column", () => {
    const store = new CandidateStore(fixtureDirectory());
    const [record] = store.bundles.icbe.records;
    assert.equal(record?.native.crisno, 471);
    assert.equal(record?.native.sentence_number_int_aligned, 30);
    assert.equal(record?.native_identity.kind, "source_row_locator");
    assert.equal("native_id" in (record?.native ?? {}), false);
    assert.equal("aldera_id" in (record?.native ?? {}), false);
  });

  test("preserves the native UCDP ID and fields", () => {
    const store = new CandidateStore(fixtureDirectory());
    const [record] = store.bundles.ucdp.records;
    assert.equal(record?.native_identity.kind, "native_id");
    assert.equal(record?.native_identity.value, "395636");
    assert.equal(record?.native.id, "395636");
    assert.equal(record?.native.where_prec, "4");
  });

  test("is deterministic and exposes individual reasons", () => {
    const store = new CandidateStore(fixtureDirectory());
    const first = store.search({ candidate_pairs: true, datasets: ["ucdp", "icbe"] });
    const second = store.search({ candidate_pairs: true, datasets: ["icbe", "ucdp"] });
    assert.deepEqual(first.candidate_pairs, second.candidate_pairs);
    assert.equal(first.receipt.receipt_sha256, second.receipt.receipt_sha256);
    assert.equal(first.candidate_pairs.length, 1);
    assert.deepEqual(first.candidate_pairs[0]?.reasons, [
      "date_within_one_day",
      "geographic_context_overlap",
      "actor_overlap",
    ]);
    assert.deepEqual(first.receipt.candidate_contract, ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY);
    assert.equal(first.receipt.search_contract_version, "0.4");
    assert.deepEqual(
      first.candidate_pairs[0]?.reason_evidence.geographic_context[0]?.icbe_native_values,
      [
      { field: "interact_location", value: "donbass;government buildings;target" },
      {
        field: "sentence_span_text",
        value: "Pro-Russian militants in Donbass took control of government buildings.",
      },
      ],
    );
    assert.deepEqual(first.candidate_pairs[0]?.reason_evidence.actors[0]?.ucdp_native_values, [
      { field: "side_a", value: "Government of Ukraine" },
    ]);
  });

  test("cannot be mistaken for accepted mappings and has no numeric confidence", () => {
    const result = new CandidateStore(fixtureDirectory()).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    assert.equal(result.mode, "candidate_pairs");
    assert.equal(result.mapping_authority, false);
    assert.deepEqual(result.mappings, []);
    assert.equal(result.candidate_pairs[0]?.kind, "candidate_pair");
    assert.equal("relation" in (result.candidate_pairs[0] ?? {}), false);
    assert.equal(hasNumericConfidence(result), false);
    assert.match(result.no_candidate_notice, /does not mean aldera:unmapped/);
  });

  test("permits coarse dates only with regional place, specific locality, and two actors", () => {
    const directory = fixtureDirectory();
    const path = join(directory, "icbe.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    const native = bundle.records[0].native;
    native.date_earliest_day = "";
    native.date_earliest_month = "";
    native.date_latest_day = "";
    native.date_latest_month = "";
    native.do_actor_a = "DPR and Ukraine";
    native.sentence_span_text += " in Sloviansk.";
    bundle.records[0].native_identity = makeIcbeSourceLocator({
      datasetVersion: bundle.dataset_version,
      source: bundle.source,
      rowNumber: bundle.records[0].native_identity.extracted_table.row_number,
      native,
    });
    bundle.records[0].ref = `icbe:${bundle.records[0].native_identity.value}`;
    bundle.records[0].native_sha256 = sha256(native);
    writeFileSync(path, JSON.stringify(bundle));
    const ucdpPath = join(directory, "ucdp.json");
    const ucdpBundle = JSON.parse(readFileSync(ucdpPath, "utf8"));
    ucdpBundle.records[0].native.where_description = "Sloviansk town";
    ucdpBundle.records[0].native_sha256 = sha256(ucdpBundle.records[0].native);
    writeFileSync(ucdpPath, JSON.stringify(ucdpBundle));
    const result = new CandidateStore(directory).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    assert.equal(result.candidate_pairs.length, 1);
    assert.deepEqual(result.candidate_pairs[0]?.reasons.slice(0, 3), [
      "coarse_date_overlap",
      "geographic_context_overlap",
      "locality_overlap",
    ]);
    assert.deepEqual(
      result.candidate_pairs[0]?.reason_evidence.actors.map(({ key }) => key),
      ["ukraine", "dpr"],
    );
  });

  test("never creates a candidate from broad date overlap alone", () => {
    const directory = fixtureDirectory();
    const path = join(directory, "icbe.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    const native = bundle.records[0].native;
    native.date_earliest_day = "";
    native.date_earliest_month = "";
    native.date_latest_day = "";
    native.date_latest_month = "";
    native.do_actor_a = "Ukraine";
    native.do_actor_b = "";
    native.sentence_span_text = "An action occurred somewhere.";
    native.interact_location = "";
    bundle.records[0].native_sha256 = sha256(native);
    writeFileSync(path, JSON.stringify(bundle));
    const store = new CandidateStore(directory);
    const evaluation = evaluateCandidatePair(
      store.bundles.icbe.records[0]!,
      store.bundles.ucdp.records[0]!,
    );
    assert.equal(evaluation?.reason_evidence.temporal.reason, "coarse_date_overlap");
    assert.equal(evaluation?.candidate, false);
    assert.ok(evaluation?.exclusion_reasons.includes("no_geographic_context_overlap"));
    assert.ok(evaluation?.exclusion_reasons.includes("coarse_date_requires_two_actor_aliases"));
  });

  test("rejects an ICBe locator that no longer binds its exact row", () => {
    const directory = fixtureDirectory();
    const path = join(directory, "icbe.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    bundle.records[0].native_identity.extracted_table.row_number = 18417;
    writeFileSync(path, JSON.stringify(bundle));
    assert.throws(() => new CandidateStore(directory), /source locator does not bind/);
  });

  test("derives the ICBe locator label from source and version metadata", () => {
    const store = new CandidateStore(fixtureDirectory());
    const identity = store.bundles.icbe.records[0]?.native_identity;
    assert.equal(identity?.kind, "source_row_locator");
    assert.match(identity?.value ?? "", /^icbe-v1-1-test-shape-native-data-sha256-/);
    assert.doesNotMatch(identity?.value ?? "", /ICBe-V1\.1/);
  });

  test("uses the least precise relevant ICBe date bound for interval precision", () => {
    const store = new CandidateStore(fixtureDirectory());
    const native = { ...store.bundles.icbe.records[0]!.native };
    native.date_latest_year = "2014";
    native.date_latest_month = "5";
    native.date_latest_day = "";
    const view = adaptIcbe(native);
    assert.equal(view.dateFrom, "2014-04-07");
    assert.equal(view.dateTo, "2014-05-31");
    assert.equal(view.datePrecision, "month");
  });

  test("binds exact source bundles and changes the receipt when a native input changes", () => {
    const directory = fixtureDirectory();
    const before = new CandidateStore(directory).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    const path = join(directory, "icbe.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    bundle.records[0].native.sentence_span_text += " Changed exact input.";
    bundle.records[0].native_sha256 = sha256(bundle.records[0].native);
    writeFileSync(path, JSON.stringify(bundle));
    const after = new CandidateStore(directory).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    assert.equal(after.receipt.inputs.icbe.version, before.receipt.inputs.icbe.version);
    assert.notEqual(
      after.receipt.inputs.icbe.source_bundle_sha256,
      before.receipt.inputs.icbe.source_bundle_sha256,
    );
    assert.equal(
      after.receipt.inputs.ucdp.source_bundle_sha256,
      before.receipt.inputs.ucdp.source_bundle_sha256,
    );
    assert.notEqual(after.receipt.receipt_sha256, before.receipt.receipt_sha256);
  });

  test("binds a changed raw-artifact hash even when the human version label is unchanged", () => {
    const directory = fixtureDirectory();
    const before = new CandidateStore(directory).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    const path = join(directory, "ucdp.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    bundle.source.artifact_sha256 = `sha256:${"9".repeat(64)}`;
    writeFileSync(path, JSON.stringify(bundle));
    const after = new CandidateStore(directory).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    assert.equal(after.receipt.inputs.ucdp.version, before.receipt.inputs.ucdp.version);
    assert.notEqual(after.receipt.inputs.ucdp.artifact_sha256, before.receipt.inputs.ucdp.artifact_sha256);
    assert.notEqual(after.receipt.receipt_sha256, before.receipt.receipt_sha256);
  });

  test("remains consumable by the independent Python standard-library consumer", () => {
    const result = new CandidateStore(fixtureDirectory()).search({
      candidate_pairs: true,
      datasets: ["icbe", "ucdp"],
    });
    const directory = mkdtempSync(join(tmpdir(), "aldera-candidate-interop-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "search.json");
    writeFileSync(outputPath, JSON.stringify(result));
    const consumer = fileURLToPath(new URL("./interop/consume_search.py", import.meta.url));
    const consumed = JSON.parse(execFileSync("python3", [consumer, outputPath], { encoding: "utf8" }));
    assert.deepEqual(consumed.native_refs, result.records.map((record) => record.ref));
    assert.deepEqual(consumed.candidate_pairs, result.receipt.candidate_pairs.map((pair) => ({
      icbe_ref: pair.icbe_ref,
      ucdp_ref: pair.ucdp_ref,
      reasons: pair.reasons,
    })));
  });
});

const localRealBundles = fileURLToPath(new URL("../data/local/stage3a/bundles", import.meta.url));
const mainSourceMetadata = fileURLToPath(
  new URL("../fixtures/real/icbe-ucdp-stage3a/source-metadata.json", import.meta.url),
);
test(
  "the pinned local real-data slice preserves 22 native records and evaluates all 120 pairs",
  { skip: !existsSync(join(localRealBundles, "icbe.json")) },
  () => {
    const store = new CandidateStore(localRealBundles);
    const result = store.search({ candidate_pairs: true, datasets: ["icbe", "ucdp"] });
    const evaluations = store.pairEvaluations({ candidate_pairs: true, datasets: ["icbe", "ucdp"] });
    assert.equal(result.records.length, 22);
    assert.equal(result.candidate_pairs.length, 7);
    assert.equal(result.not_prioritized_refs.length, 12);
    assert.equal(evaluations.length, 120);
    assert.ok(
      evaluations.some(
        (evaluation) => evaluation.reason_evidence.temporal.reason === "coarse_date_overlap",
      ),
    );
    assert.equal(
      result.candidate_pairs.some((pair) => pair.reasons.includes("coarse_date_overlap")),
      false,
    );
    assert.equal(result.mappings.length, 0);
    const declaredHashes = JSON.parse(readFileSync(mainSourceMetadata, "utf8"))
      .canonical_parsed_bundle_sha256;
    assert.equal(
      result.receipt.inputs.icbe.source_bundle_sha256,
      declaredHashes.icbe,
    );
    assert.equal(
      result.receipt.inputs.ucdp.source_bundle_sha256,
      declaredHashes.ucdp,
    );
    const ucdp = store.bundles.ucdp.records.find((record) => record.ref === "ucdp:149866");
    assert.equal(ucdp?.native.id, "149866");
    const icbe = store.bundles.icbe.records.find(
      (record) =>
        record.native_identity.kind === "source_row_locator" &&
        record.native_identity.extracted_table.row_number === 18416,
    );
    assert.equal(icbe?.native.crisno, 471);
    assert.equal(icbe?.native.sentence_number_int_aligned, 30);
    assert.equal("source_row" in (icbe?.native ?? {}), false);
    assert.equal(icbe?.native_identity.kind, "source_row_locator");
    if (icbe?.native_identity.kind === "source_row_locator") {
      assert.equal(icbe.native_identity.dataset_version, store.bundles.icbe.dataset_version);
      assert.equal(
        icbe.native_identity.raw_artifact.sha256,
        store.bundles.icbe.source.artifact_sha256,
      );
      assert.equal(
        icbe.native_identity.extracted_table.sha256,
        store.bundles.icbe.source.extracted_artifact_sha256,
      );
      assert.deepEqual(icbe.native_identity.native_coordinates, {
        crisno: 471,
        sentence_number_int_aligned: 30,
      });
    }
  },
);

const localMh17Bundles = fileURLToPath(
  new URL("../data/local/stage3a/mh17/bundles", import.meta.url),
);
const mh17SourceMetadata = fileURLToPath(
  new URL("../fixtures/real/icbe-ucdp-stage3a/mh17-source-metadata.json", import.meta.url),
);
test(
  "the unchanged candidate rules surface the MH17 positive-control pair",
  { skip: !existsSync(join(localMh17Bundles, "icbe.json")) },
  () => {
    const store = new CandidateStore(localMh17Bundles);
    const result = store.search({ candidate_pairs: true, datasets: ["icbe", "ucdp"] });
    const evaluations = store.pairEvaluations({ candidate_pairs: true, datasets: ["icbe", "ucdp"] });
    assert.equal(store.bundles.icbe.records.length, 2);
    assert.equal(store.bundles.ucdp.records.length, 13);
    assert.equal(evaluations.length, 26);
    assert.equal(result.candidate_pairs.length, 6);
    const declaredHashes = JSON.parse(readFileSync(mh17SourceMetadata, "utf8"))
      .canonical_parsed_bundle_sha256;
    assert.equal(result.receipt.inputs.icbe.source_bundle_sha256, declaredHashes.icbe);
    assert.equal(result.receipt.inputs.ucdp.source_bundle_sha256, declaredHashes.ucdp);
    const mh17 = result.candidate_pairs.find(
      (pair) =>
        pair.ucdp_ref === "ucdp:154679" &&
        pair.icbe_ref.includes("-row-18436-crisis-471-sentence-44"),
    );
    assert.deepEqual(mh17?.reasons, [
      "same_date",
      "geographic_context_overlap",
      "actor_overlap",
    ]);
    assert.deepEqual(result.mappings, []);
  },
);

test(
  "the generated human-review checkpoint leaves judgments blank",
  {
    skip:
      !existsSync(join(localRealBundles, "icbe.json")) ||
      !existsSync(join(localMh17Bundles, "icbe.json")),
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "aldera-human-review-test-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "human-review.md");
    const renderer = fileURLToPath(
      new URL("../scripts/render-stage3a-human-review.ts", import.meta.url),
    );
    execFileSync(
      process.execPath,
      ["--import", "tsx", renderer, localRealBundles, localMh17Bundles, output],
      { encoding: "utf8" },
    );
    const review = readFileSync(output, "utf8");
    assert.match(review, /## A\. Current prioritized candidates/);
    assert.match(review, /## B\. Challenge non-candidates/);
    assert.match(review, /ICBe row 18424 ↔ UCDP 152957/);
    assert.match(review, /## C\. Positive control/);
    assert.match(review, /ICBe row 18436 ↔ UCDP 154679/);
    assert.match(review, /do_interact_kind=/);
    assert.match(review, /interact_escalate=/);
    assert.match(review, /interact_geoscope=/);
    assert.match(review, /do_duration=/);
    assert.equal((review.match(/^HUMAN REVIEW:$/gm) ?? []).length, 16);
    assert.doesNotMatch(review, /\[[xX]\]/);
    assert.match(review, /substantive relationship judgments remain pending human review/);
  },
);

const humanBenchmark = fileURLToPath(
  new URL("../fixtures/real/icbe-ucdp-stage3a/human-review-benchmark.json", import.meta.url),
);
test(
  "the sanitized human benchmark is tracked, pinned, and non-authoritative",
  () => {
    const benchmark = JSON.parse(readFileSync(humanBenchmark, "utf8"));
    assert.equal(benchmark.kind, "human_review_benchmark");
    assert.equal(benchmark.mapping_authority, false);
    assert.equal(benchmark.not_a_mapping_bundle, true);
    assert.equal(benchmark.review_date, "2026-08-18");
    assert.equal(benchmark.cases.length, 16);
    assert.equal(benchmark.cases.filter((item: any) => item.aldera.prioritized).length, 13);
    assert.equal(
      benchmark.cases.filter(
        (item: any) => item.human_judgment.same_underlying_occurrence === "yes",
      ).length,
      1,
    );
    assert.equal(
      benchmark.cases.filter((item: any) => item.human_judgment.meaningfully_related === "yes")
        .length,
      16,
    );
    assert.equal(
      benchmark.cases.filter((item: any) => item.human_judgment.broader_narrower === "yes")
        .length,
      8,
    );
    assert.equal(
      benchmark.cases.filter(
        (item: any) =>
          item.human_judgment.safe_or_unsafe_equivalence === "unsafe_as_equivalent",
      ).length,
      15,
    );
    assert.equal("mappings" in benchmark, false);
    for (const item of benchmark.cases) {
      assert.deepEqual(Object.keys(item).sort(), ["aldera", "human_judgment", "pair", "review_item"]);
      assert.equal("native" in item, false);
      assert.equal("reason_evidence" in item.aldera, false);
      assert.equal("description" in item, false);
    }
  },
);

test(
  "the tracked human benchmark renders exactly one choice per question",
  {
    skip:
      !existsSync(join(localRealBundles, "icbe.json")) ||
      !existsSync(join(localMh17Bundles, "icbe.json")),
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "aldera-completed-review-test-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "human-review.md");
    const renderer = fileURLToPath(
      new URL("../scripts/render-stage3a-human-review.ts", import.meta.url),
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        renderer,
        localRealBundles,
        localMh17Bundles,
        output,
        humanBenchmark,
      ],
      { encoding: "utf8" },
    );
    const completed = readFileSync(output, "utf8");
    assert.equal((completed.match(/\[x\]/g) ?? []).length, 64);
    assert.match(completed, /ICBe row 18436 ↔ UCDP 154679/);
    assert.match(completed, /Same underlying occurrence\? \[x\] yes/);
    assert.match(completed, /Human review completed 2026-08-18/);
  },
);
