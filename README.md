# Aldera

Aldera is an experimental interoperability layer for research data. Its current proving ground examines real ICBe and UCDP GED records while both sources remain native and authoritative.

Aldera asks: Where did this come from? What does it measure? What can it legitimately be compared with? Where are the representations commensurable, partially commensurable, or unsafe to align? What information is lost when researchers treat different units as equivalent?

Aldera does **not** define a universal event ontology and does not convert records into an “Aldera format.” It owns stable source references, two explicit source adapters, non-authoritative candidate objects, provenance, validation, and deterministic evidence receipts.

## Current state

Stage 3A provides deterministic, non-authoritative candidate discovery for a bounded ICBe ↔ UCDP slice. Human review is preserved in a tracked sanitized benchmark, but that benchmark is not mapping authority. On the unmerged `stage3b-v0.1` branch, a separate tracked assertion bundle is the authority for the 16 reviewed relationships.

Native source content is not committed. Reconstruct the pinned local bundles according to [docs/stage3a.md](docs/stage3a.md). Access is unrestricted; reuse is subject to the applicable license.

## Try it

Requires Node.js 22 or newer.

```sh
pnpm install
pnpm test

pnpm aldera validate --json
pnpm aldera inspect relationships --json
pnpm aldera search --identity same --json

pnpm aldera validate --data-dir data/local/stage3a --json
pnpm aldera inspect ucdp:149866 --data-dir data/local/stage3a --json
pnpm aldera search --candidate-pairs --datasets icbe,ucdp \
  --data-dir data/local/stage3a/bundles --json
```

`map` reads the tracked relationship authority without requiring native data:

```sh
pnpm aldera map <icbe-source-ref> <ucdp-source-ref> \
  --json
```

Every machine-readable response declares `format_version: "0.1"`. A Python standard-library consumer at `test/interop/consume_search.py` reads candidate-search output without importing Aldera or understanding either native schema.

## Current data model

- Reconstructed ICBe and UCDP source bundles preserve the complete native objects.
- ICBe uses a stable source-row locator binding the exact artifact, extracted table, row, and native crisis/sentence coordinates. Aldera does not pretend ICBe published an event ID.
- UCDP preserves its native `id`.
- Explicit ICBe and UCDP adapters read only the native fields needed for candidate discovery; their transient views are never returned as canonical events.
- Candidate pairs carry explicit evidence, `mapping_authority: false`, no relationship type, and no numeric confidence.
- Candidate receipts bind the exact source bundles, artifact hashes, candidate-contract identity/hash, normalized parameters, ordered native refs/hashes, ordered candidates, and a deterministic receipt hash.
- The separate Stage 3B assertion bundle contains exactly the four reviewed dimensions, stable ICBe/UCDP refs, exact supplied human notes, explicit human-approval provenance, versions, and a deterministic canonical bundle hash. Assertion IDs derive from the exact ordered endpoint refs rather than worksheet numbering.
- Relationship map/search receipts bind the assertion schema/bundle, exact benchmark hash, normalized parameters, assertion IDs, opaque refs, and native hashes only when reconstructed records were actually loaded.

The repository tracks source metadata, hashes, and the sanitized Stage 3A human-review benchmark. Native content and reconstructive review output remain under gitignored `data/local/`.

More detail is in [docs/architecture.md](docs/architecture.md), [docs/stage3a.md](docs/stage3a.md), [docs/stage3b.md](docs/stage3b.md), and the [Stage 3B design](docs/stage3b-design.md).

## Commands

`aldera inspect [target]` inspects tracked relationship metadata or assertions on a clean clone, and opaque native source references when reconstructed bundles are available.

`aldera validate` validates the relationship schema, bundle hash, benchmark and authority provenance, exact transcription, stable IDs/refs, and ordering on a clean clone. With `--data-dir`, it additionally validates reconstructed endpoint records and hashes. Failed native loading or validation reports `loaded_but_invalid`, never `loaded_and_validated`.

`aldera map <source> [target]` returns reviewed relationship assertions from tracked metadata. It never requires candidate prioritization.

`aldera search` filters tracked relationship assertions by dimensions or opaque refs. `--candidate-pairs` selects the unchanged deterministic, non-authoritative Stage 3A mode.

Empty relationship map/search results explicitly state that absence from this pinned bundle does not assert `not_related`, incompatibility, no counterpart, or global absence.

## Scope

This bounded proving ground has no graphical frontend, database, network ingestion, universal event schema, generic adapter framework, automated mapping classifier, or inherited product corpus.
