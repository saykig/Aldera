# Architecture

## Current sovereignty boundary

```text
ICBe native records ── explicit ICBe adapter ─┐
                                             ├─ non-authoritative candidate pairs
UCDP native records ── explicit UCDP adapter ─┘
```

ICBe and UCDP remain native and authoritative. Aldera source envelopes attach only the metadata needed for reproducibility: stable opaque reference, source version, exact source/artifact hashes, and unchanged native content.

The two identity mechanisms deliberately differ:

- ICBe has no native event-ID column. Its stable source-row locator binds the exact dataset version, raw artifact, extracted table, row number, and native crisis/sentence coordinates.
- UCDP retains its published native `id`.

Aldera does not require sources to identify research objects in the same way.

## Explicit adapters

The ICBe adapter reads native crisis/sentence coordinates, earliest/latest date components, `interact_location`, narrative sentence, and the actor fields needed by the pinned candidate contract.

The UCDP adapter reads `id`, `country`, `adm_1`, `where_prec`, `date_start`, `date_end`, `side_a`, and `side_b`.

Each adapter returns a transient filtering view. Results preserve and return the untouched native object, never a canonical Aldera event. The implementations remain explicit; repeated behavior is not extracted into a generic adapter framework.

## Candidate boundary

Candidate discovery is a prioritization aid, not relationship authority. Candidate pairs:

- are structurally separate from future relationship assertions;
- carry the native values and normalization rules supporting each reason;
- declare `mapping_authority: false`;
- have no asserted relationship dimension or type;
- have no numeric confidence; and
- never turn a non-prioritized record into an “unmapped” claim.

Coarse temporal intervals remain reviewable but cannot create a candidate alone. The versioned, hashed ICBe/UCDP candidate contract requires the additional signals documented in [stage3a.md](stage3a.md).

## Reproducibility

A candidate-search receipt binds a canonical serialization of:

- the candidate search-contract version;
- the candidate-contract ID, version, and deterministic hash;
- normalized search parameters;
- the exact ICBe and UCDP versions;
- raw-artifact hashes and complete canonical source-bundle hashes;
- ordered returned source references and native-object hashes; and
- ordered candidate IDs, refs, reasons, and reason evidence.

The receipt hash is SHA-256 over the displayed receipt body before `receipt_sha256` is added. Canonical hashing is generic infrastructure and remains available for future schemas and bundles.

Receipts contain no timestamp, randomness, filesystem path, or consumer identity. Equal exact inputs and normalized parameters therefore produce equal output and receipt hashes.

## Current CLI behavior

- `inspect` reads current dataset metadata or a source record from reconstructed ICBe/UCDP bundles.
- `validate` checks source-bundle identity, unchanged native hashes, ICBe locators, UCDP IDs, and the shared selection window.
- `search --candidate-pairs` runs the Stage 3A candidate contract. Place and actor filtering use deterministic Unicode-normalized matching; date filtering uses inclusive interval overlap.
- `map` reports that no relationship-assertion layer exists before Stage 3B. It does not manufacture or promote mappings.

Datasets are fixed to the current ICBe/UCDP comparison. Records, pair evaluations, candidates, and receipt arrays use deterministic lexical ordering.

## Relationship boundary

No real relationship-assertion schema or bundle exists on `main` before Stage 3B. The proposed Stage 3B layer is separate from candidate discovery and will use stable opaque source refs rather than a closed dataset enum or shared native-ID assumption. See [stage3b-design.md](stage3b-design.md).
