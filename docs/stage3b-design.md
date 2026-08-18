# Stage 3B relationship-assertion design

Status: approved v0.1 design. This note defines the bounded Stage 3B implementation; it does not itself create an assertion.

## Why the old relation enum is not one variable

The original values answer different questions:

- `aldera:close` approximates occurrence identity;
- `aldera:related` expresses relatedness;
- `aldera:incompatible` warns against equivalence; and
- `aldera:unmapped` says that no target counterpart was asserted within a pinned comparison bundle.

They are not mutually exclusive relationship types. Stage 3A showed that a pair can be not the same occurrence, meaningfully related, broader or narrower, and unsafe to treat as an equivalent unit at the same time.

Stage 3B therefore moves `unmapped` out of the relationship model. A future no-counterpart or coverage assertion has no target record and is structurally separate from a relationship between two records. The legacy enum remains only in the synthetic UCDP/ACLED proving fixture while its compatibility path is evaluated.

## Relationship assertion v0.1

The smallest model supported by the completed review has four independent dimensions:

```yaml
identity: same | not_same | uncertain
relatedness: related | not_related | uncertain
scope: source_broader | target_broader | neither | uncertain
equivalence_safety: safe_as_equivalent | unsafe_as_equivalent | uncertain
```

`source` and `target` refer to the declared direction of the assertion. Stage 3B does not add `equivalent`, `overlapping`, or `conditional`: the Stage 3A questions did not establish those categories. Later source pairs can challenge and version the model.

The dimensions do not replace the existing explanatory payload. Every assertion also preserves:

- a human rationale;
- `meaning_preserved`;
- `meaning_lost`;
- explicit uncertainty; and
- human provenance, including review date and the benchmark evidence used.

In particular, `unsafe_as_equivalent` does not mean records cannot be compared. It means downstream consumers must not treat them as interchangeable units.

## Stable opaque source references

Relationship endpoints are stable Aldera source references, not a closed dataset enum plus conventional `native_id`. An endpoint may resolve through a native event ID, source-row locator, composite key, or another pinned native identity mechanism. Aldera requires a reproducible pointer back to the native object; it does not require research systems to identify objects in the same way.

This permits ICBe row locators and UCDP native IDs to participate in the same assertion layer without pretending ICBe has a native event ID or merely adding `icbe` to the old `DatasetId` union.

## Candidate discovery remains subordinate

Candidate signals may prioritize pairs for review but must never populate relationship dimensions. Stage 3B encodes all 16 completed human reviews, including the three challenge pairs the candidate contract did not prioritize. This proves that an authoritative human-reviewed assertion can exist independently of candidate discovery.

The bounded proving loop is:

```text
native research objects
        ↓
reproducible opaque references
        ↓
non-authoritative candidate discovery
        ↓
human judgment
        ↓
multidimensional relationship assertion
        ↓
provenance and semantic preservation/loss
        ↓
reproducible map/search result
```

The tracked Stage 3A benchmark remains evaluation evidence, not mapping authority. Stage 3B assertions separately record the human authority and source benchmark. Aldera never silently self-learns or mutates rules.

## Bounded implementation decision

Proceed with v0.1 now. Do not wait for a perfect benchmark, and do not change candidate rules from these 16 examples. The implementation ends the initial ICBe/UCDP proving ground once all 16 assertions validate and are reproducibly consumable through `inspect`, `map`, and `search`. The next empirical test should use a substantially different source pair rather than extending this proving ground into a Stage 3C.
