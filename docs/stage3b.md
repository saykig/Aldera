# Stage 3B: reviewed ICBe ↔ UCDP relationships

Stage 3B proves the complete path from native research objects through candidate discovery and human review to a separate, reproducible relationship authority. It does not change the Stage 3A candidate rules and does not introduce a universal event schema.

## Authority boundary

- `fixtures/real/icbe-ucdp-stage3a/human-review-benchmark.json` remains non-authoritative evaluation evidence with `mapping_authority: false`.
- `fixtures/real/icbe-ucdp-stage3b/relationship-assertions.json` is the explicit reviewed relationship authority.
- Its `authority_provenance` records `explicit_human_approval`, the approval date, and the exact approved benchmark hash without inventing a named approver.
- The assertion bundle mechanically transcribes the 16 approved dimension judgments with ICBe as source and UCDP as target.
- Only the four human notes actually present in the benchmark are copied. No rationale, semantic preservation/loss, or uncertainty explanation is invented.
- Candidate status is absent from the assertion bundle. Three assertions exist even though Stage 3A did not prioritize their pairs.

## v0.1 dimensions

```text
identity: same | not_same | uncertain
relatedness: related | not_related | uncertain
scope: source_broader | target_broader |
       no_broader_narrower_asserted | uncertain
equivalence_safety: safe_as_equivalent | unsafe_as_equivalent | uncertain
```

`no_broader_narrower_asserted` says only that neither endpoint was judged broader. It makes no equal-scope, overlap, or granularity claim.

Equivalence safety is occurrence-level only. `safe_as_equivalent` permits aligning records as the same underlying occurrence; it does not make native fields, definitions, measurements, values, categories, or records interchangeable. The MH17 assertion demonstrates this distinction.

## Clean-clone metadata operations

These commands use only tracked sanitized metadata:

```sh
pnpm aldera validate --json
pnpm aldera inspect relationships --json
pnpm aldera inspect relationship:icbe-ucdp:53611ff435e21e953cf93d63 --json
pnpm aldera search --identity same --json
pnpm aldera map <icbe-source-ref> <ucdp-source-ref> --json
```

Outputs explicitly declare `native_content: "not_loaded"`; they do not claim that native content was inspected or validated.

An empty relationship `map` or `search` result includes an explicit absence notice. No assertion in this pinned bundle does not mean `not_related`, incompatibility, no counterpart, or global absence.

## Reconstructed native operations

After rebuilding both Stage 3A windows under `data/local/stage3a/`:

```sh
pnpm aldera validate --data-dir data/local/stage3a --json
pnpm aldera inspect <opaque-source-ref> --data-dir data/local/stage3a --json
pnpm aldera map <icbe-source-ref> <ucdp-source-ref> \
  --data-dir data/local/stage3a --json
pnpm aldera search --place Donbas --data-dir data/local/stage3a --json
```

Native filtering retains an assertion when either endpoint satisfies all supplied native place/date/actor filters. Returned records are limited to endpoints of qualifying assertions and are ordered by opaque ref. Native bundle and record hashes are validated before output.

Native validation reports `loaded_and_validated` only when loading and every validation check succeeds. If `--data-dir` is supplied but native loading or validation fails, it reports `loaded_but_invalid`, `valid: false`, and no validated-native claim.

## Reproducibility and validation

The assertion-bundle schema is `0.1.0`; the assertion bundle is version `0.1.0`. The stored `bundle_sha256` is computed over canonical bundle content excluding that hash field itself.

Stable assertion IDs use a bounded SHA-256 digest of the exact ordered `{source_ref, target_ref}` pair; `review_item` remains separate provenance. Validation checks schema enums, stable ref namespaces, derived assertion IDs, duplicate IDs, duplicate endpoint pairs, authority and benchmark path/hash/date provenance, exact transcription, bundle hash, assertion order, and—when supplied—native bundle hashes and endpoint resolution.

Map/search receipts bind:

- relationship search-contract and schema versions;
- assertion-bundle version and exact canonical hash;
- exact benchmark hash;
- normalized parameters;
- ordered assertion IDs and opaque refs;
- native record hashes only when native content was loaded; and
- a deterministic receipt hash.

`test/interop/consume_relationships.py` independently consumes relationship JSON using only the Python standard library and no native-schema knowledge.
