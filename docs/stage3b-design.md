# Stage 3B relationship-model design note

Status: design question only. No Stage 3B schema, relation, mapping assertion, or mapping-authority behavior is implemented by this note.

## Problem exposed by Stage 3A

The current `MappingRelation` enum is deliberately small:

- `aldera:close`
- `aldera:related`
- `aldera:incompatible`
- `aldera:unmapped`

That single-label model cannot faithfully preserve several judgments recorded at once during Stage 3A. A reviewed pair can simultaneously be:

- not the same occurrence;
- meaningfully related;
- broader or narrower in scope; and
- unsafe to treat as equivalent.

Selecting only `related` loses scope and comparability. Selecting only `incompatible` loses the positive relatedness judgment and may be misread as a factual disagreement. Selecting `close` would overstate identity. The problem is not a missing fifth label; it is that the observed properties are not mutually exclusive.

## Smallest structure that preserves the judgments

Stage 3B should evaluate a multidimensional relationship assessment with four explicit axes:

```yaml
identity:
  same | not_same | uncertain

relatedness:
  related | not_related | uncertain

scope:
  equivalent | source_broader | target_broader | overlapping | none | uncertain

comparability:
  safe_as_equivalent | unsafe_as_equivalent | conditional | uncertain
```

Here, `source` and `target` refer to the declared direction of the dataset comparison or future assertion, not record chronology.

Four axes appear to be the smallest representation that preserves the completed review without forcing mutually exclusive labels:

- identity records whether the native records represent the same occurrence;
- relatedness records connection even when identity differs;
- scope preserves broader/narrower direction or partial overlap;
- comparability records whether equivalence-based downstream use is safe.

The axes should remain independent. For example, `not_same` does not imply `not_related`, and `related` does not imply `safe_as_equivalent`. `uncertain` is explicit on every dimension so absence of evidence is not converted into a negative assertion.

## Recommendation for Stage 3B planning

Use the four-axis structure as the leading design candidate, but do not implement it until additional human-reviewed examples include at least some `not_related`, uncertain, overlapping-scope, and conditionally comparable cases. Evaluate whether the existing four `MappingRelation` values should become derived presentation summaries, remain only for backward-compatible synthetic fixtures, or be retired from new assertions. Do not decide that migration from the Stage 3A sample alone.

Candidate signals must not populate these dimensions automatically. They may select records for review, while relationship dimensions require separate asserted provenance and mapping authority. The local Stage 3A benchmark is evaluation evidence, not an assertion source.

## Versioned evaluation loop

Any future rule or schema change should follow an explicit loop:

```text
human-reviewed examples
        ↓
pinned benchmark
        ↓
new candidate-contract or relationship-schema version
        ↓
rerun benchmark
        ↓
compare improved and regressed cases by dimension
        ↓
publish the new version and deterministic hash
```

Aldera must not self-learn or silently mutate rules from review results. Every change remains inspectable, reproducible, and attributable to a versioned contract or schema decision.
