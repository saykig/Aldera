import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli, type CliIO } from "../src/cli.js";

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

const localStage3aBundles = fileURLToPath(
  new URL("../data/local/stage3a/bundles", import.meta.url),
);
const hasLocalStage3aBundles =
  existsSync(join(localStage3aBundles, "icbe.json")) &&
  existsSync(join(localStage3aBundles, "ucdp.json"));
const benchmarkPath = fileURLToPath(
  new URL("../fixtures/real/icbe-ucdp-stage3a/human-review-benchmark.json", import.meta.url),
);
const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8"));
const icbeRef = benchmark.cases[0].pair.icbe_ref as string;
const ucdpRef = benchmark.cases[0].pair.ucdp_ref as string;

describe("aldera CLI", () => {
  test("help presents only the current ICBe/UCDP empirical direction", async () => {
    const captured = capture();
    assert.equal(await runCli(["help"], captured.io), 0);
    const output = captured.out.join("\n");
    assert.match(output, /ICBe ↔ UCDP/);
    assert.match(output, /non-authoritative candidate pairs/);
    assert.match(output, /--datasets icbe,ucdp/);
  });

  test("retired relation and dataset options are not accepted", async () => {
    const relation = capture();
    assert.equal(await runCli(["search", "--relation", "close"], relation.io), 1);
    assert.match(relation.err.join("\n"), /Unknown option/);

    const dataset = capture();
    assert.equal(
      await runCli(["search", "--candidate-pairs", "--datasets", "ucdp,example"], dataset.io),
      1,
    );
    assert.match(dataset.err.join("\n"), /Unknown dataset/);
  });

  test("validate reports the tracked relationship bundle on a clean clone", async () => {
      const captured = capture();
      assert.equal(await runCli(["validate", "--json"], captured.io), 0);
      const result = JSON.parse(captured.out.join("\n"));
      assert.equal(result.format_version, "0.1");
      assert.equal(result.valid, true);
      assert.equal(result.validation_mode, "metadata_only");
      assert.equal(result.checked.relationship_assertions, 16);
      assert.equal(result.native_content, "not_loaded");
      assert.deepEqual(captured.err, []);
  });

  test(
    "inspect exposes opaque ICBe and UCDP identities without a shared native-ID assumption",
    { skip: !hasLocalStage3aBundles },
    async () => {
      const icbe = capture();
      assert.equal(
        await runCli(["inspect", icbeRef, "--data-dir", localStage3aBundles, "--json"], icbe.io),
        0,
      );
      const icbeRecord = JSON.parse(icbe.out.join("\n")).result;
      assert.equal(icbeRecord.dataset, "icbe");
      assert.equal(icbeRecord.native_identity.kind, "source_row_locator");
      assert.equal("native_id" in icbeRecord, false);

      const ucdp = capture();
      assert.equal(
        await runCli(["inspect", ucdpRef, "--data-dir", localStage3aBundles, "--json"], ucdp.io),
        0,
      );
      const ucdpRecord = JSON.parse(ucdp.out.join("\n")).result;
      assert.equal(ucdpRecord.dataset, "ucdp");
      assert.equal(ucdpRecord.native_identity.kind, "native_id");
    },
  );

  test("map returns a reviewed assertion without requiring native data", async () => {
      const captured = capture();
      assert.equal(
        await runCli(["map", icbeRef, ucdpRef, "--json"], captured.io),
        0,
      );
      const output = JSON.parse(captured.out.join("\n"));
      assert.equal(output.mode, "relationship_assertions");
      assert.deepEqual(output.receipt.assertion_ids, ["relationship:icbe-ucdp:0001"]);
      assert.equal(output.native_content, "not_loaded");
  });

  test(
    "search is explicitly non-authoritative ICBe/UCDP candidate discovery",
    { skip: !hasLocalStage3aBundles },
    async () => {
      const captured = capture();
      assert.equal(
        await runCli(
          [
            "search",
            "--candidate-pairs",
            "--datasets",
            "icbe,ucdp",
            "--data-dir",
            localStage3aBundles,
            "--json",
          ],
          captured.io,
        ),
        0,
      );
      const result = JSON.parse(captured.out.join("\n"));
      assert.equal(result.format_version, "0.1");
      assert.equal(result.mode, "candidate_pairs");
      assert.equal(result.mapping_authority, false);
      assert.equal(result.records.length, 22);
      assert.equal(result.candidate_pairs.length, 7);
      assert.deepEqual(result.mappings, []);
      assert.equal(result.receipt.search_contract_version, "0.4");
    },
  );
});
