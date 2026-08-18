import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256 } from "../src/canonical.js";
import { runCli, type CliIO } from "../src/cli.js";
import {
  RelationshipStore,
  defaultRelationshipPaths,
  loadRelationshipValidation,
  relationshipAssertionId,
  relationshipBundleHash,
  validateRelationshipArtifacts,
} from "../src/relationship-store.js";
import type { RelationshipAssertionBundle } from "../src/relationship-types.js";

const temporaryDirectories: string[] = [];
after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

const paths = defaultRelationshipPaths();
const trackedBundle = JSON.parse(readFileSync(paths.bundlePath, "utf8")) as RelationshipAssertionBundle;
const trackedBenchmark = JSON.parse(readFileSync(paths.benchmarkPath, "utf8"));
const localNativeRoot = fileURLToPath(new URL("../data/local/stage3a", import.meta.url));
const hasLocalNativeData =
  existsSync(join(localNativeRoot, "bundles/icbe.json")) &&
  existsSync(join(localNativeRoot, "mh17/bundles/ucdp.json"));

function cloneBundle(): RelationshipAssertionBundle {
  return structuredClone(trackedBundle);
}

function diagnosticCodes(bundle: RelationshipAssertionBundle): string[] {
  return validateRelationshipArtifacts(bundle, trackedBenchmark).map(({ code }) => code);
}

function assertionForReview(reviewItem: number) {
  return trackedBundle.assertions.find((assertion) => assertion.review_item === reviewItem)!;
}

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

describe("Stage 3B relationship assertions", () => {
  test("exactly transcribes the 16 reviewed dimensions without invented semantics", () => {
    const store = new RelationshipStore();
    const assertions = store.assertions();
    assert.equal(assertions.length, 16);
    assert.equal(assertions.filter(({ dimensions }) => dimensions.identity === "same").length, 1);
    assert.equal(
      assertions.filter(({ dimensions }) => dimensions.identity === "not_same").length,
      15,
    );
    assert.equal(
      assertions.filter(({ dimensions }) => dimensions.relatedness === "related").length,
      16,
    );
    assert.equal(
      assertions.filter(({ dimensions }) =>
        ["source_broader", "target_broader"].includes(dimensions.scope),
      ).length,
      8,
    );
    assert.equal(
      assertions.filter(
        ({ dimensions }) => dimensions.equivalence_safety === "unsafe_as_equivalent",
      ).length,
      15,
    );
    assert.equal(assertions.filter(({ human_note }) => human_note !== undefined).length, 4);
    assert.deepEqual(trackedBundle.authority_provenance, {
      authority_basis: "explicit_human_approval",
      approval_date: trackedBenchmark.review_date,
      benchmark_sha256: sha256(trackedBenchmark),
    });
  });

  test("identifies only the MH17 pair as occurrence-level safe same-identity", () => {
    const [same] = new RelationshipStore()
      .assertions()
      .filter(({ dimensions }) => dimensions.identity === "same");
    assert.equal(same?.id, "relationship:icbe-ucdp:53611ff435e21e953cf93d63");
    assert.match(same?.source_ref ?? "", /row-18436-crisis-471-sentence-44$/);
    assert.equal(same?.target_ref, "ucdp:154679");
    assert.equal(same?.dimensions.scope, "no_broader_narrower_asserted");
    assert.equal(same?.dimensions.equivalence_safety, "safe_as_equivalent");
    assert.equal(
      same?.human_note,
      "Both represent the MH17 downing, while preserving different native details.",
    );
    assert.equal("native_equivalence" in (same ?? {}), false);
  });

  test("preserves the three challenge non-candidates as authoritative relationships", () => {
    const store = new RelationshipStore();
    for (const reviewItem of [8, 9, 10]) {
      const benchmarkCase = trackedBenchmark.cases.find(
        (item: any) => item.review_item === reviewItem,
      );
      assert.equal(benchmarkCase.aldera.prioritized, false);
      const assertion = store.assertion(
        relationshipAssertionId(benchmarkCase.pair.icbe_ref, benchmarkCase.pair.ucdp_ref),
      );
      assert.equal(assertion?.review_item, reviewItem);
      assert.equal(assertion?.dimensions.relatedness, "related");
    }
  });

  test("validates schema, keys, hashes, transcription, and deterministic ordering", () => {
    assert.deepEqual(validateRelationshipArtifacts(trackedBundle, trackedBenchmark), []);

    const malformed = cloneBundle();
    (malformed.assertions[0]!.dimensions.identity as string) = "maybe";
    assert.ok(diagnosticCodes(malformed).includes("ALD-REL-SCHEMA"));

    const duplicateId = cloneBundle();
    duplicateId.assertions[1]!.id = duplicateId.assertions[0]!.id;
    assert.ok(diagnosticCodes(duplicateId).includes("ALD-REL-ID-DUPLICATE"));

    const duplicatePair = cloneBundle();
    duplicatePair.assertions[1]!.source_ref = duplicatePair.assertions[0]!.source_ref;
    duplicatePair.assertions[1]!.target_ref = duplicatePair.assertions[0]!.target_ref;
    assert.ok(diagnosticCodes(duplicatePair).includes("ALD-REL-PAIR-DUPLICATE"));

    const badRef = cloneBundle();
    badRef.assertions[0]!.source_ref = "row:18416";
    assert.ok(diagnosticCodes(badRef).includes("ALD-REL-SCHEMA"));

    const badBenchmark = cloneBundle();
    badBenchmark.benchmark_provenance.sha256 = `sha256:${"0".repeat(64)}`;
    assert.ok(diagnosticCodes(badBenchmark).includes("ALD-REL-BENCHMARK-HASH"));

    const drift = cloneBundle();
    drift.assertions[0]!.dimensions.scope = "source_broader";
    assert.ok(diagnosticCodes(drift).includes("ALD-REL-TRANSCRIPTION-DRIFT"));

    const inventedSemantics = cloneBundle() as RelationshipAssertionBundle & {
      assertions: Array<RelationshipAssertionBundle["assertions"][number] & { rationale?: string }>;
    };
    inventedSemantics.assertions[0]!.rationale = "Invented.";
    assert.ok(diagnosticCodes(inventedSemantics).includes("ALD-REL-SCHEMA"));

    assert.doesNotThrow(() => validateRelationshipArtifacts({}, trackedBenchmark));
    assert.ok(
      validateRelationshipArtifacts({}, trackedBenchmark).some(({ code }) => code === "ALD-REL-SCHEMA"),
    );
    const malformedDirectory = mkdtempSync(join(tmpdir(), "aldera-malformed-bundle-"));
    temporaryDirectories.push(malformedDirectory);
    const malformedPath = join(malformedDirectory, "relationship-assertions.json");
    writeFileSync(malformedPath, "{}\n");
    assert.doesNotThrow(() => loadRelationshipValidation({ bundlePath: malformedPath }));
    assert.ok(
      loadRelationshipValidation({ bundlePath: malformedPath }).diagnostics.some(
        ({ code }) => code === "ALD-REL-SCHEMA",
      ),
    );

    const badHash = cloneBundle();
    badHash.bundle_sha256 = `sha256:${"f".repeat(64)}`;
    assert.ok(diagnosticCodes(badHash).includes("ALD-REL-BUNDLE-HASH"));

    const unordered = cloneBundle();
    unordered.assertions.reverse();
    assert.ok(diagnosticCodes(unordered).includes("ALD-REL-ORDER"));
  });

  test("assertion content changes bundle and bound receipt hashes while IDs remain stable", () => {
    const store = new RelationshipStore();
    const original = store.search({ identity: "same" });
    const changed = cloneBundle();
    changed.assertions[10]!.human_note += " Changed.";
    const changedBundleHash = relationshipBundleHash(changed);
    assert.notEqual(changedBundleHash, trackedBundle.bundle_sha256);

    const { receipt_sha256: _oldReceiptHash, ...receiptBody } = original.receipt;
    const changedReceiptHash = sha256({
      ...receiptBody,
      assertion_bundle_sha256: changedBundleHash,
    });
    assert.notEqual(changedReceiptHash, original.receipt.receipt_sha256);

    const regeneratedIds = (cases: typeof trackedBenchmark.cases) =>
      new Map(
        cases.map((item: any) => [
          `${item.pair.icbe_ref}\u0000${item.pair.ucdp_ref}`,
          relationshipAssertionId(item.pair.icbe_ref, item.pair.ucdp_ref),
        ]),
      );
    assert.deepEqual(
      regeneratedIds([...trackedBenchmark.cases].reverse()),
      regeneratedIds(trackedBenchmark.cases),
    );
    const mh17 = assertionForReview(11);
    assert.equal(
      relationshipAssertionId(mh17.source_ref, mh17.target_ref),
      mh17.id,
      "the stable ID is derived only from the ordered endpoint refs",
    );
  });

  test("normalizes parameters and orders assertions, refs, and receipts deterministically", () => {
    const store = new RelationshipStore();
    const target = assertionForReview(11).target_ref;
    const first = store.search({ target_ref: `  ${target}  ` });
    const second = store.search({ target_ref: target });
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.assertions.map(({ id }) => id),
      [...first.assertions.map(({ id }) => id)].sort(),
    );
    assert.deepEqual(first.receipt.opaque_refs, [...first.receipt.opaque_refs].sort());
    assert.equal(first.receipt.receipt_sha256, second.receipt.receipt_sha256);
  });

  test("metadata-only inspect, map, search, and validate work without native content", async () => {
    const validate = capture();
    assert.equal(await runCli(["validate", "--json"], validate.io), 0);
    const validation = JSON.parse(validate.out.join("\n"));
    assert.equal(validation.validation_mode, "metadata_only");
    assert.equal(validation.native_content, "not_loaded");
    assert.equal(validation.checked.relationship_assertions, 16);

    const invalidNativeDirectory = mkdtempSync(join(tmpdir(), "aldera-missing-native-"));
    temporaryDirectories.push(invalidNativeDirectory);
    const invalidNative = capture();
    assert.equal(
      await runCli(["validate", "--data-dir", invalidNativeDirectory, "--json"], invalidNative.io),
      1,
    );
    const invalidValidation = JSON.parse(invalidNative.out.join("\n"));
    assert.equal(invalidValidation.valid, false);
    assert.equal(invalidValidation.native_content, "loaded_but_invalid");
    assert.equal(invalidValidation.checked.native_endpoint_occurrences, 0);
    assert.match(invalidValidation.notice, /no validated-native claim/);

    const inspect = capture();
    const mh17 = assertionForReview(11);
    assert.equal(
      await runCli(["inspect", mh17.id, "--json"], inspect.io),
      0,
    );
    const inspected = JSON.parse(inspect.out.join("\n")).result;
    assert.equal(inspected.review_item, 11);
    assert.equal(inspected.native_content, "not_loaded");
    assert.match(inspected.native_content_notice, /not loaded or validated/);
    assert.equal(inspected.assertion_bundle_sha256, trackedBundle.bundle_sha256);
    assert.equal(inspected.benchmark_sha256, sha256(trackedBenchmark));
    assert.equal(inspected.authority_provenance.authority_basis, "explicit_human_approval");

    const map = capture();
    assert.equal(await runCli(["map", mh17.source_ref, mh17.target_ref, "--json"], map.io), 0);
    const output = JSON.parse(map.out.join("\n"));
    assert.equal(output.native_content, "not_loaded");
    assert.deepEqual(output.records, []);
    assert.deepEqual(output.receipt.native_records, []);
    assert.match(output.native_content_notice, /not loaded, validated, or returned/);
    assert.deepEqual(output.receipt.assertion_ids, [mh17.id]);

    const emptyMap = new RelationshipStore().map("icbe:not-reviewed", "ucdp:not-reviewed");
    assert.equal(emptyMap.assertions.length, 0);
    assert.match(emptyMap.assertion_absence_notice ?? "", /does not assert.*not_related/i);
    assert.match(emptyMap.assertion_absence_notice ?? "", /globally absent/i);

    const emptySearch = new RelationshipStore().search({ assertion_id: "relationship:missing" });
    assert.equal(emptySearch.assertions.length, 0);
    assert.match(emptySearch.assertion_absence_notice ?? "", /does not assert.*not_related/i);

    const nativeFilter = capture();
    assert.equal(await runCli(["search", "--place", "Donbas", "--json"], nativeFilter.io), 1);
    assert.match(nativeFilter.err.join("\n"), /requires reconstructed native bundles/);
  });

  test("relationship output is independently consumable without native-schema knowledge", () => {
    const output = new RelationshipStore().search({ identity: "same" });
    const directory = mkdtempSync(join(tmpdir(), "aldera-relationship-consumer-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "relationships.json");
    writeFileSync(outputPath, JSON.stringify(output));
    const consumer = fileURLToPath(new URL("./interop/consume_relationships.py", import.meta.url));
    const consumed = JSON.parse(execFileSync("python3", [consumer, outputPath], { encoding: "utf8" }));
    assert.equal(consumed.relationship_authority, true);
    assert.equal(consumed.native_content, "not_loaded");
    assert.deepEqual(consumed.receipt.assertion_ids, [assertionForReview(11).id]);
    assert.equal(consumed.assertions[0].dimensions.identity, "same");
  });

  test(
    "local native validation resolves every endpoint and binds returned native hashes",
    { skip: !hasLocalNativeData },
    () => {
      assert.deepEqual(
        validateRelationshipArtifacts(trackedBundle, trackedBenchmark, localNativeRoot),
        [],
      );
      const store = new RelationshipStore({ nativeDataRoot: localNativeRoot });
      const mh17 = store.assertion(assertionForReview(11).id)!;
      const output = store.map(mh17.source_ref, mh17.target_ref);
      assert.equal(output.native_content, "loaded_and_validated");
      assert.equal(output.records.length, 2);
      assert.equal(output.receipt.native_records.length, 2);
      assert.deepEqual(
        output.receipt.native_records.map(({ ref }) => ref),
        output.receipt.opaque_refs,
      );
      assert.ok(output.receipt.native_records.every(({ native_sha256 }) => /^sha256:/.test(native_sha256)));

      const nativeFiltered = store.search({ place: "Donbas" });
      assert.equal(nativeFiltered.native_content, "loaded_and_validated");
      assert.ok(nativeFiltered.assertions.length > 0);
      assert.ok(nativeFiltered.records.length > 0);
      assert.ok(nativeFiltered.receipt.native_records.length > 0);
    },
  );
});
