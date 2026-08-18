# Aldera

Aldera is an experimental interoperability layer for research data. Its current proving ground examines real ICBe and UCDP GED records while both sources remain native and authoritative.

Aldera asks: Where did this come from? What does it measure? What can it legitimately be compared with? Where are the representations commensurable, partially commensurable, or unsafe to align? What information is lost when researchers treat different units as equivalent?

Aldera does **not** define a universal event ontology and does not convert records into an “Aldera format.” It owns stable source references, two explicit source adapters, non-authoritative candidate objects, provenance, validation, and deterministic evidence receipts.

## Current state

Stage 3A provides deterministic, non-authoritative candidate discovery for a bounded ICBe ↔ UCDP slice. Human review is preserved in a tracked sanitized benchmark, but that benchmark is not mapping authority. Stage 3B relationship assertions are not implemented on `main`.

Native source content is not committed. Reconstruct the pinned local bundles according to [docs/stage3a.md](docs/stage3a.md). Access is unrestricted; reuse is subject to the applicable license.

## Try it

Requires Node.js 22 or newer.

```sh
pnpm install
pnpm test

pnpm aldera validate --data-dir data/local/stage3a/bundles
pnpm aldera inspect ucdp:149866 --data-dir data/local/stage3a/bundles
pnpm aldera search --candidate-pairs --datasets icbe,ucdp \
  --data-dir data/local/stage3a/bundles --json
```

`map` remains one of Aldera’s four verbs, but before Stage 3B it reports that no relationship-assertion layer exists:

```sh
pnpm aldera map <icbe-source-ref> <ucdp-source-ref> \
  --data-dir data/local/stage3a/bundles --json
```

Every machine-readable response declares `format_version: "0.1"`. A Python standard-library consumer at `test/interop/consume_search.py` reads candidate-search output without importing Aldera or understanding either native schema.

## Current data model

- Reconstructed ICBe and UCDP source bundles preserve the complete native objects.
- ICBe uses a stable source-row locator binding the exact artifact, extracted table, row, and native crisis/sentence coordinates. Aldera does not pretend ICBe published an event ID.
- UCDP preserves its native `id`.
- Explicit ICBe and UCDP adapters read only the native fields needed for candidate discovery; their transient views are never returned as canonical events.
- Candidate pairs carry explicit evidence, `mapping_authority: false`, no relationship type, and no numeric confidence.
- Candidate receipts bind the exact source bundles, artifact hashes, candidate-contract identity/hash, normalized parameters, ordered native refs/hashes, ordered candidates, and a deterministic receipt hash.

The repository tracks source metadata, hashes, and the sanitized Stage 3A human-review benchmark. Native content and reconstructive review output remain under gitignored `data/local/`.

More detail is in [docs/architecture.md](docs/architecture.md), [docs/stage3a.md](docs/stage3a.md), and the proposed [Stage 3B design](docs/stage3b-design.md).

## Commands

`aldera inspect [target]` inspects the current source-bundle metadata or an opaque native source reference when reconstructed bundles are available.

`aldera validate` validates reconstructed bundle integrity, native hashes, stable identities, and the pinned ICBe/UCDP comparison window.

`aldera map <source> [target]` currently reports that no relationship assertions exist. It does not promote candidates.

`aldera search --candidate-pairs` runs the deterministic, non-authoritative ICBe/UCDP candidate contract.

## Scope

This bounded proving ground has no graphical frontend, database, network ingestion, universal event schema, generic adapter framework, automated mapping classifier, or inherited product corpus.
