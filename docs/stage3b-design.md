# Stage 3B relationship-assertion design

Status: **proposed v0.1 design — pending final approval**. This note defines a bounded implementation proposal; it does not create a schema, bundle, assertion, or mapping authority.

## Why the old relation enum is not one variable

The original values answer different questions:

- `aldera:close` approximates occurrence identity;
- `aldera:related` expresses relatedness;
- `aldera:incompatible` warns against occurrence-level equivalence; and
- `aldera:unmapped` says that no target counterpart was asserted within a pinned comparison bundle.

They are not mutually exclusive relationship types. Stage 3A showed that a pair can be not the same occurrence, meaningfully related, broader or narrower, and unsafe to align as the same occurrence at the same time.

Stage 3B therefore proposes moving `unmapped` out of the relationship model. A future no-counterpart or coverage assertion has no target record and is structurally separate from a relationship between two records. The legacy enum and legacy `MappingAssertion` schema remain intact for the synthetic UCDP/ACLED proving fixture.

## Relationship assertion v0.1

The smallest model supported by the completed review has four independent dimensions:

```yaml
identity: same | not_same | uncertain
relatedness: related | not_related | uncertain
scope: source_broader | target_broader | no_broader_narrower_asserted | uncertain
equivalence_safety: safe_as_equivalent | unsafe_as_equivalent | uncertain
```

`source` and `target` refer to the declared direction of the assertion.

`no_broader_narrower_asserted` means only that the human review did not judge either endpoint broader than the other. It does **not** assert equal scope, equivalent granularity, complete overlap, no overlap, or any other scope relationship. Stage 3B does not add `equivalent` or `overlapping`: Stage 3A did not review those questions.

For v0.1, equivalence safety is strictly occurrence-level:

- `safe_as_equivalent` means safe to align the endpoints as the same underlying occurrence at the occurrence level.
- `unsafe_as_equivalent` means they must not be aligned as the same underlying occurrence.

Neither value says that native records are interchangeable. It makes no claim that native fields, definitions, measurements, values, categories, event boundaries, or levels of detail are equivalent. In particular, the reviewed MH17 pair may be `identity: same` and `equivalence_safety: safe_as_equivalent` while its ICBe and UCDP native details remain different and authoritative in their own systems.

## What the human review contains

The non-authoritative Stage 3A human-review benchmark preserves only:

- the reviewed values for identity, relatedness, broader/narrower direction, and occurrence-level equivalence safety;
- the review date;
- the exact human note where one was supplied; and
- the candidate status and reproducibility metadata already present in the benchmark.

Stage 3B must not invent or attribute a human rationale, `meaning_preserved`, `meaning_lost`, uncertainty explanation, or other semantic interpretation. An assertion may carry the exact human note as `human_note` when present. For v0.1, `rationale`, `meaning_preserved`, `meaning_lost`, and `uncertainty_note` are optional and must be absent unless explicit reviewed evidence supports them. If they are added later, their own evidence and provenance must distinguish them from the Stage 3A dimensional judgments.

The tracked `human-review-benchmark.json` remains non-authoritative evaluation evidence and never becomes a mapping or relationship-assertion bundle. Stage 3B creates a separate explicit, tracked, sanitized relationship-assertion bundle. A deliberate build or authoring step may mechanically copy the exact reviewed dimension values and human notes into that bundle, but the resulting bundle must be reviewed and committed as its own authority. There is no runtime, implicit, or silent promotion of the benchmark into mapping authority.

The three challenge pairs may become relationship assertions even though candidate discovery did not prioritize them. Candidate signals may select records for review but must never populate relationship dimensions or determine assertion authority.

## Separate stable-reference layer

Stage 3B must not retrofit the real assertions into the legacy UCDP/ACLED `MappingAssertion` schema by adding `icbe` to `DatasetId`. The existing synthetic fixture and its commands remain working and unchanged.

The proposed real relationship layer uses stable opaque source references for both endpoints. An endpoint may resolve through a native event ID, source-row locator, composite key, or another pinned identity mechanism. Aldera requires a reproducible pointer back to a native object; it does not require research systems to identify objects in the same way.

This permits ICBe row locators and UCDP native IDs to participate in the same assertion layer without pretending ICBe has a conventional native event ID. The v0.1 layer should contain only what is needed to represent, validate, inspect, map, and search the 16 reviewed relationships.

## Reproducibility contract

Stage 3B must include:

- an explicit relationship schema version;
- an explicit assertion-bundle version;
- a deterministic assertion-bundle hash computed from canonical bundle content;
- stable, unique assertion IDs that do not change merely because presentation order changes;
- provenance binding to the exact tracked Stage 3A human-review benchmark path and deterministic benchmark hash;
- map and search receipts that bind the relationship schema version, assertion-bundle version, exact assertion-bundle hash, normalized parameters, returned opaque refs and native hashes when native records are loaded, returned assertion IDs, and receipt hash;
- deterministic assertion ordering by stable assertion ID and deterministic record ordering by opaque source reference; and
- a Python standard-library independent-consumer test that reads saved machine-readable relationship output without importing Aldera or knowing ICBe/UCDP native schemas.

The assertion bundle is the relationship authority; the benchmark hash in provenance identifies the human-review evidence from which its reviewed dimensions were transcribed. Changing the benchmark or assertion bundle changes the appropriate bound hash and receipt.

## Real-data reconstruction boundary

The sanitized relationship-assertion bundle, opaque refs, dimension values, exact human notes, provenance, versions, and hashes may be tracked in Git. Native ICBe/UCDP content and reconstructive outputs remain under the existing licensing and `data/local/` rules.

Assertion-list and assertion-detail inspection should work from tracked assertion metadata and opaque refs wherever native fields are unnecessary. Operations that filter or display native fields—such as place, actor, date, or native-description search—may require first reconstructing the exact pinned local ICBe and UCDP source bundles. The command must report that requirement clearly rather than pretending tracked assertion metadata contains the native records.

When native bundles are present, validation and receipts bind their exact hashes. When an operation is metadata-only, its output and receipt must make that boundary explicit and must not claim that native content was validated or returned.

## Bounded proving loop

```text
native research objects
        ↓
reproducible opaque references
        ↓
non-authoritative candidate discovery
        ↓
human review benchmark
        ↓ deliberate, reviewed transcription
separate relationship-assertion bundle
        ↓
reproducible inspect / map / search output
```

Aldera never silently self-learns or mutates candidate or assertion rules. Once the separately reviewed 16-assertion bundle validates and is reproducibly consumable, Stage 3B should end the initial ICBe/UCDP proving ground. The next empirical test should use a substantially different source pair rather than extending this proving ground into a Stage 3C.
