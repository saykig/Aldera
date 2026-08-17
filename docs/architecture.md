# Architecture

## Sovereignty boundary

```text
UCDP native records  ─┐
                      ├── Aldera descriptors, assertions, validation, search receipts
ACLED native records ─┘
```

Aldera source bundles use an envelope only to attach a stable reference, version, native identifier, and byte-independent canonical hash. The `native` object is the source representation. Two explicit adapters read the minimum searchable native fields:

- the UCDP adapter reads `id`, `country`, `adm_1`, `where_prec`, `date_start`, `date_end`, `side_a`, and `side_b`;
- the ACLED adapter reads `event_id_cnty`, `country`, `admin1`, `location`, `event_date`, and the four actor/associated-actor fields.

The adapters return only a transient search view used for filtering. Search results contain the untouched native object, never that view. The views are separate implementations because two datasets do not yet justify a generic projection framework.

## Mapping semantics

An assertion has a `source` and optional `target`. Its Aldera-owned relation describes two representations, not objective historical truth:

- `aldera:close`: both records are asserted to represent substantially the same underlying occurrence, but native definitions or event boundaries prevent treating them as identical.
- `aldera:related`: the records concern connected activity or the same broader episode, but Aldera does not assert that they represent the same occurrence.
- `aldera:incompatible`: the records are plausible comparison candidates because they overlap on relevant signals, but within the asserted scope their representations cannot safely be treated as the same unit. It does not imply either native dataset is factually wrong.
- `aldera:unmapped`: no counterpart in the declared target dataset is asserted within this pinned mapping bundle. It does not imply absence from the full target dataset or absence from other datasets.

SKOS mapping properties informed the decision to keep relationships explicit, but are not the normative vocabulary for event records. They may later be appropriate for dataset concepts or controlled vocabularies.

Provenance is a small native object containing the asserting agent, assertion time, evidence references, and comparison method.

## Reproducibility

A search receipt hashes a canonical serialization of:

- the Aldera search-contract version;
- normalized search parameters;
- the UCDP version and complete source-bundle hash;
- the ACLED version and complete source-bundle hash;
- the mapping version and complete mapping-bundle hash;
- ordered source references and their native-object hashes;
- ordered mapping identifiers.

Bundle roots are SHA-256 hashes of canonical JSON for each complete bundle, including every native record envelope and object. The receipt hash is the SHA-256 hash of the displayed receipt body before `receipt_sha256` is added.

The receipt intentionally contains no current timestamp, randomness, filesystem path, or consumer identity. Equal exact inputs and normalized parameters therefore produce the same records, relationships, and receipt hash. Interpretation can happen downstream without altering that evidence set.

## Current search semantics

- Place matching is a case-insensitive substring match against the explicit adapter's native place fields.
- Date matching uses inclusive interval overlap: a record matches when its end is on or after `--from` and its start is on or before `--to`. ACLED's single event date is both start and end.
- Actor matching is a case-insensitive substring match against the explicit adapter's native actor fields.
- Relation filtering first finds native records satisfying the other filters, then retains only records that participate in an assertion with the requested relation. It returns only qualifying assertions.
- Dataset parameters are deduplicated and sorted. Records are ordered lexicographically by native reference; mappings are ordered lexicographically by mapping ID. Receipt arrays preserve those orders.

Mapping lifecycle is deliberately limited to stable IDs, the mapping-bundle version, and Git history. Semantic revision, supersession, review workflow, and CLI authoring are deferred until a real correction case requires them.
