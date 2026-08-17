import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { adaptAcled } from "../src/adapters/acled.js";
import { adaptUcdp } from "../src/adapters/ucdp.js";
import { sha256 } from "../src/canonical.js";
import { AlderaStore } from "../src/store.js";
import { validateStore } from "../src/validation.js";

const fixture = fileURLToPath(new URL("../fixtures/synthetic", import.meta.url));
const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function fixtureCopy(): string {
  const directory = mkdtempSync(join(tmpdir(), "aldera-test-"));
  temporaryDirectories.push(directory);
  cpSync(fixture, directory, { recursive: true });
  return directory;
}

const crimeaQuery = {
  datasets: ["acled", "ucdp"] as const,
  place: "Crimea",
  from: "2014-02-01",
  to: "2014-03-31",
};

describe("explicit native adapters", () => {
  test("read only the UCDP fields needed for search", () => {
    const native = new AlderaStore(fixture).record("ucdp:UCDP-SYN-001")?.native;
    assert.ok(native);
    assert.deepEqual(adaptUcdp(native), {
      dataset: "ucdp",
      nativeId: "UCDP-SYN-001",
      places: ["Ukraine", "Crimea", "Simferopol International Airport"],
      dateFrom: "2014-02-27",
      dateTo: "2014-02-27",
      actors: ["Government of Ukraine", "Synthetic armed group"],
    });
  });

  test("read only the ACLED fields needed for search", () => {
    const native = new AlderaStore(fixture).record("acled:ACLED-SYN-001")?.native;
    assert.ok(native);
    assert.deepEqual(adaptAcled(native), {
      dataset: "acled",
      nativeId: "ACLED-SYN-001",
      places: ["Ukraine", "Crimea", "Simferopol International Airport"],
      dateFrom: "2014-02-27",
      dateTo: "2014-02-27",
      actors: ["Synthetic armed group", "Military Forces of Ukraine"],
    });
  });
});

describe("Aldera store", () => {
  test("validates the bounded synthetic fixture", () => {
    assert.deepEqual(validateStore(new AlderaStore(fixture)), []);
  });

  test("keeps native source identifiers and objects intact", () => {
    const store = new AlderaStore(fixture);
    const ucdp = store.record("ucdp:UCDP-SYN-001");
    const acled = store.record("acled:ACLED-SYN-001");
    assert.equal(ucdp?.native_id, "UCDP-SYN-001");
    assert.equal(acled?.native_id, "ACLED-SYN-001");
    assert.equal(ucdp?.native.id, "UCDP-SYN-001");
    assert.equal(acled?.native.event_id_cnty, "ACLED-SYN-001");
    assert.equal("aldera_id" in (ucdp?.native ?? {}), false);
    assert.equal("aldera_id" in (acled?.native ?? {}), false);
  });

  test("implements only relations demonstrated by fixtures", () => {
    const bundle = new AlderaStore(fixture).mappingBundle;
    assert.deepEqual(bundle.comparison, { source_dataset: "ucdp", target_dataset: "acled" });
    const relations = new Set(bundle.mappings.map((item) => item.relation));
    assert.deepEqual(relations, new Set([
      "aldera:close",
      "aldera:related",
      "aldera:incompatible",
      "aldera:unmapped",
    ]));
  });

  test("produces identical records, mappings, and receipt for identical searches", () => {
    const store = new AlderaStore(fixture);
    const first = store.search({ ...crimeaQuery, datasets: [...crimeaQuery.datasets] });
    const second = store.search({
      ...crimeaQuery,
      datasets: ["ucdp", "acled"],
      place: " Crimea ",
    });
    assert.deepEqual(first.records, second.records);
    assert.deepEqual(first.mappings, second.mappings);
    assert.equal(first.receipt.receipt_sha256, second.receipt.receipt_sha256);
    assert.match(first.receipt.receipt_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.records.length, 7);
    assert.equal(first.mappings.length, 4);
    assert.equal(first.format_version, "0.1");
    assert.equal(first.receipt.search_contract_version, "0.1");
    assert.deepEqual(
      first.receipt.native_records.map((record) => record.ref),
      first.records.map((record) => record.ref),
    );
    assert.deepEqual(first.receipt.mapping_ids, first.mappings.map((mapping) => mapping.id));
    assert.deepEqual(
      first.records.map((record) => record.ref),
      first.records.map((record) => record.ref).sort(),
    );
    assert.deepEqual(
      first.mappings.map((mapping) => mapping.id),
      first.mappings.map((mapping) => mapping.id).sort(),
    );
  });

  test("binds exact UCDP, ACLED, and mapping bundles even when labels do not change", () => {
    const before = new AlderaStore(fixture).search({
      ...crimeaQuery,
      datasets: [...crimeaQuery.datasets],
    });

    const ucdpDirectory = fixtureCopy();
    const ucdpPath = join(ucdpDirectory, "ucdp.json");
    const ucdpBundle = JSON.parse(readFileSync(ucdpPath, "utf8"));
    ucdpBundle.records[0].native.best = 99;
    ucdpBundle.records[0].native_sha256 = sha256(ucdpBundle.records[0].native);
    writeFileSync(ucdpPath, JSON.stringify(ucdpBundle));
    const changedUcdpStore = new AlderaStore(ucdpDirectory);
    assert.deepEqual(validateStore(changedUcdpStore), []);
    const afterUcdp = changedUcdpStore.search({
      ...crimeaQuery,
      datasets: [...crimeaQuery.datasets],
    });
    assert.equal(afterUcdp.receipt.inputs.ucdp.version, before.receipt.inputs.ucdp.version);
    assert.notEqual(
      afterUcdp.receipt.inputs.ucdp.source_bundle_sha256,
      before.receipt.inputs.ucdp.source_bundle_sha256,
    );
    assert.equal(
      afterUcdp.receipt.inputs.acled.source_bundle_sha256,
      before.receipt.inputs.acled.source_bundle_sha256,
    );
    assert.notEqual(afterUcdp.receipt.receipt_sha256, before.receipt.receipt_sha256);

    const acledDirectory = fixtureCopy();
    const acledPath = join(acledDirectory, "acled.json");
    const acledBundle = JSON.parse(readFileSync(acledPath, "utf8"));
    acledBundle.records[0].native.fatalities = 2;
    acledBundle.records[0].native_sha256 = sha256(acledBundle.records[0].native);
    writeFileSync(acledPath, JSON.stringify(acledBundle));
    const changedAcledStore = new AlderaStore(acledDirectory);
    assert.deepEqual(validateStore(changedAcledStore), []);
    const afterAcled = changedAcledStore.search({
      ...crimeaQuery,
      datasets: [...crimeaQuery.datasets],
    });
    assert.equal(afterAcled.receipt.inputs.acled.version, before.receipt.inputs.acled.version);
    assert.notEqual(
      afterAcled.receipt.inputs.acled.source_bundle_sha256,
      before.receipt.inputs.acled.source_bundle_sha256,
    );
    assert.equal(
      afterAcled.receipt.inputs.ucdp.source_bundle_sha256,
      before.receipt.inputs.ucdp.source_bundle_sha256,
    );
    assert.notEqual(afterAcled.receipt.receipt_sha256, before.receipt.receipt_sha256);

    const mappingDirectory = fixtureCopy();
    const mappingPath = join(mappingDirectory, "mappings.json");
    const mappingBundle = JSON.parse(readFileSync(mappingPath, "utf8"));
    mappingBundle.mappings[0].rationale += " Exact-input mutation.";
    writeFileSync(mappingPath, JSON.stringify(mappingBundle));
    const changedMappingStore = new AlderaStore(mappingDirectory);
    assert.deepEqual(validateStore(changedMappingStore), []);
    const afterMapping = changedMappingStore.search({
      ...crimeaQuery,
      datasets: [...crimeaQuery.datasets],
    });
    assert.equal(afterMapping.receipt.inputs.mapping.version, before.receipt.inputs.mapping.version);
    assert.notEqual(
      afterMapping.receipt.inputs.mapping.mapping_bundle_sha256,
      before.receipt.inputs.mapping.mapping_bundle_sha256,
    );
    assert.notEqual(afterMapping.receipt.receipt_sha256, before.receipt.receipt_sha256);
  });

  test("filters native records through explicit adapters without returning a canonical event", () => {
    const result = new AlderaStore(fixture).search({
      datasets: ["acled", "ucdp"],
      actor: "local res",
    });
    assert.deepEqual(result.records.map((record) => record.ref), ["acled:ACLED-SYN-002"]);
    assert.equal(result.records[0]?.native.event_type, "Protests");
    assert.equal("place" in (result.records[0] ?? {}), false);
    assert.equal("dateFrom" in (result.records[0] ?? {}), false);
  });

  test("uses case-insensitive place matching and inclusive date overlap", () => {
    const result = new AlderaStore(fixture).search({
      datasets: ["ucdp", "acled"],
      place: "sevas",
      from: "2014-03-02",
      to: "2014-03-02",
    });
    assert.deepEqual(result.records.map((record) => record.ref), [
      "acled:ACLED-SYN-002",
      "ucdp:UCDP-SYN-002",
    ]);
  });

  test("uses mapping relation as a record and assertion filter", () => {
    const result = new AlderaStore(fixture).search({
      datasets: ["acled", "ucdp"],
      place: "Crimea",
      relation: "aldera:close",
    });
    assert.deepEqual(result.records.map((record) => record.ref), [
      "acled:ACLED-SYN-001",
      "ucdp:UCDP-SYN-001",
    ]);
    assert.equal(result.mappings.length, 1);
    assert.equal(result.mappings[0]?.relation, "aldera:close");
  });
});

describe("semantic validation", () => {
  test("detects native-record tampering", () => {
    const directory = fixtureCopy();
    const path = join(directory, "ucdp.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    bundle.records[0].native.best = 99;
    writeFileSync(path, JSON.stringify(bundle));
    const diagnostics = validateStore(new AlderaStore(directory));
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "ALD-HASH-MISMATCH"));
  });

  test("detects an envelope identifier that differs from the native identifier", () => {
    const directory = fixtureCopy();
    const path = join(directory, "acled.json");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    bundle.records[0].native_id = "WRONG";
    writeFileSync(path, JSON.stringify(bundle));
    const diagnostics = validateStore(new AlderaStore(directory));
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "ALD-NATIVE-ID-MISMATCH"));
  });
});
