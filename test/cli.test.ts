import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

describe("aldera CLI", () => {
  test("validate reports a clean fixture", async () => {
    const captured = capture();
    assert.equal(await runCli(["validate", "--json"], captured.io), 0);
    const result = JSON.parse(captured.out.join("\n"));
    assert.equal(result.format_version, "0.1");
    assert.equal(result.valid, true);
    assert.deepEqual(captured.err, []);
  });

  test("inspect exposes an untouched UCDP native record", async () => {
    const captured = capture();
    assert.equal(await runCli(["inspect", "ucdp:UCDP-SYN-001", "--json"], captured.io), 0);
    const output = JSON.parse(captured.out.join("\n"));
    assert.equal(output.format_version, "0.1");
    const result = output.result;
    assert.equal(result.kind, "native_source_record");
    assert.equal(result.native_id, "UCDP-SYN-001");
    assert.equal(result.native.id, "UCDP-SYN-001");
    assert.equal(result.mappings[0].relation, "aldera:close");
  });

  test("inspect exposes an untouched ACLED native record", async () => {
    const captured = capture();
    assert.equal(await runCli(["inspect", "acled:ACLED-SYN-001", "--json"], captured.io), 0);
    const result = JSON.parse(captured.out.join("\n")).result;
    assert.equal(result.native_id, "ACLED-SYN-001");
    assert.equal(result.native.event_id_cnty, "ACLED-SYN-001");
  });

  test("map is read-only and explains preservation, loss, provenance, and uncertainty", async () => {
    const captured = capture();
    assert.equal(
      await runCli(["map", "ucdp:UCDP-SYN-001", "acled:ACLED-SYN-001", "--json"], captured.io),
      0,
    );
    const output = JSON.parse(captured.out.join("\n"));
    assert.equal(output.format_version, "0.1");
    const [mapping] = output.mappings;
    assert.equal(mapping.relation, "aldera:close");
    assert.equal(typeof mapping.uncertainty, "string");
    assert.ok(mapping.meaning_preserved.length > 0);
    assert.ok(mapping.meaning_lost.length > 0);
    assert.ok(mapping.provenance.evidence.length > 0);
    assert.equal("confidence" in mapping, false);
    assert.equal("revision" in mapping, false);
    assert.equal("review" in mapping, false);
    assert.equal("supersedes" in mapping, false);
  });

  test("map rejects removed authoring flags", async () => {
    const captured = capture();
    assert.equal(
      await runCli(
        [
          "map",
          "ucdp:UCDP-SYN-001",
          "acled:ACLED-SYN-001",
          "--relation",
          "related",
        ],
        captured.io,
      ),
      1,
    );
    assert.match(captured.err.join("\n"), /Unknown option/);
  });

  test("search supports the requested vertical-slice query and explicit receipt", async () => {
    const captured = capture();
    const args = [
      "search",
      "--place",
      "Crimea",
      "--from",
      "2014-02-01",
      "--to",
      "2014-03-31",
      "--datasets",
      "ucdp,acled",
      "--json",
    ];
    assert.equal(await runCli(args, captured.io), 0);
    const result = JSON.parse(captured.out.join("\n"));
    assert.equal(result.records.length, 7);
    assert.equal(result.mappings.length, 4);
    assert.equal(result.format_version, "0.1");
    assert.equal(result.receipt.search_contract_version, "0.1");
    assert.equal(result.receipt.inputs.ucdp.version, "synthetic-0.1.0");
    assert.match(result.receipt.inputs.ucdp.source_bundle_sha256, /^sha256:/);
    assert.equal(result.receipt.inputs.acled.version, "synthetic-0.1.0");
    assert.match(result.receipt.inputs.acled.source_bundle_sha256, /^sha256:/);
    assert.equal(result.receipt.inputs.mapping.version, "0.1.0");
    assert.match(result.receipt.inputs.mapping.mapping_bundle_sha256, /^sha256:/);
    assert.match(result.receipt.receipt_sha256, /^sha256:/);
  });

  test("relation-constrained search returns only records in qualifying mappings", async () => {
    const captured = capture();
    assert.equal(
      await runCli(
        [
          "search",
          "--place",
          "Crimea",
          "--datasets",
          "ucdp,acled",
          "--relation",
          "aldera:close",
          "--json",
        ],
        captured.io,
      ),
      0,
    );
    const result = JSON.parse(captured.out.join("\n"));
    assert.deepEqual(result.receipt.native_records.map((record: { ref: string }) => record.ref), [
      "acled:ACLED-SYN-001",
      "ucdp:UCDP-SYN-001",
    ]);
    assert.deepEqual(result.receipt.mapping_ids, ["map:crimea-airport-001"]);
    assert.deepEqual(result.mappings.map((mapping: { relation: string }) => mapping.relation), [
      "aldera:close",
    ]);
  });

  test(
    "candidate-pair search is explicitly non-authoritative",
    { skip: !existsSync(localStage3aBundles) },
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
