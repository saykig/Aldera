# Aldera

Aldera is an experimental interoperability layer for research data. Its first proving ground asks whether UCDP and ACLED conflict-event representations can be connected while both datasets remain native and authoritative.

Aldera asks the following: Where did this come from? What does it measure? What can it legitimately be compared with? Where are the representations commensurable, partially commensurable, or incompatible? What information is lost in moving between them?

## Try it

Requires Node.js 22 or newer.

```sh
pnpm install
pnpm test
pnpm aldera validate
pnpm aldera inspect ucdp:UCDP-SYN-001
pnpm aldera map ucdp:UCDP-SYN-001 acled:ACLED-SYN-001
pnpm aldera search --place Crimea --from 2014-02-01 --to 2014-03-31 --datasets ucdp,acled
```

Every command accepts `--json`. Installed packages expose the same interface as `aldera`.

The JSON envelope declares `format_version: "0.1"`. A standard-library-only example consumer is available at `test/interop/consume_search.py`; it reads native references and mapping relations without importing Aldera or understanding either native dataset schema.

The included records are explicitly synthetic and must not be cited as UCDP or ACLED research data. They cover one close match, one related/non-equivalent pair, one incompatibility, and one explicitly unmapped source record.

## Data model

- `fixtures/synthetic/ucdp.json` and `acled.json` hold native-shaped records. The object under `native` is never rewritten; its source identifier remains its own.
- `datasets.json` records exact dataset versions and native-ID field names.
- Explicit UCDP and ACLED adapters read the minimum native fields needed for search without producing a canonical event.
- `mappings.json` declares the governed UCDP → ACLED comparison and holds relationship assertions, rationale, optional scope and uncertainty notes, semantic preservation/loss, and provenance.
- Search JSON has `format_version: "0.1"` and includes full native records, relevant mappings, exact bundle hashes, normalized parameters, and a deterministic receipt.

The event-record vocabulary is deliberately Aldera-owned and contains only relations demonstrated by the fixture:

- `aldera:close`: both records are asserted to represent substantially the same underlying occurrence, but native definitions or event boundaries prevent treating them as identical.
- `aldera:related`: the records concern connected activity or the same broader episode, but Aldera does not assert that they represent the same occurrence.
- `aldera:incompatible`: the records are plausible comparison candidates because they overlap on relevant signals, but within the asserted scope their representations cannot safely be treated as the same unit. This does not imply either native dataset is factually wrong.
- `aldera:unmapped`: no counterpart in the declared target dataset is asserted within this pinned mapping bundle. It does not imply absence from the full target dataset or from other datasets.

These relations describe relationships between representations, not objective historical truth. SKOS remains intellectual inspiration for future concept or vocabulary mappings, but its properties are not applied to event records.

More detail is in [docs/architecture.md](docs/architecture.md).

## Commands

`aldera inspect [target]` shows the catalog, a dataset descriptor, a native record, or a mapping assertion.

`aldera validate` performs schema and cross-file checks: source references, versions, namespaces, native hashes, mapping direction, and bounded unmapped semantics.

`aldera map <source> [target]` is read-only and inspects assertions involving the source or between the specified records.

`aldera search` supports dataset, place, date range, actor, relation, and source-identifier filters. Pass another bundle with `--data-dir`.
