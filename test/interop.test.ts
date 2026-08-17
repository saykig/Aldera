import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli, type CliIO } from "../src/cli.js";

test("a Python standard-library consumer reads search output without native-schema knowledge", async () => {
  const lines: string[] = [];
  const io: CliIO = { out: (line) => lines.push(line), err: () => undefined };
  const exitCode = await runCli(
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
    io,
  );
  assert.equal(exitCode, 0);

  const directory = mkdtempSync(join(tmpdir(), "aldera-interop-"));
  try {
    const outputPath = join(directory, "search.json");
    writeFileSync(outputPath, lines.join("\n"));
    const consumer = fileURLToPath(new URL("./interop/consume_search.py", import.meta.url));
    const stdout = execFileSync("python3", [consumer, outputPath], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.format_version, "0.1");
    assert.deepEqual(result.native_refs, ["acled:ACLED-SYN-001", "ucdp:UCDP-SYN-001"]);
    assert.deepEqual(result.mapping_relations, ["aldera:close"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
