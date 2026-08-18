# Stage 3A: ICBe ↔ UCDP GED real-data proving ground

Stage 3A asks whether Aldera can surface real ICBe/UCDP comparison candidates while keeping both native representations unchanged. It creates no accepted real mappings.

## Exact sources and redistribution

- **ICBe:** ICBe V1.1 from Harvard Dataverse dataset version 1.0, DOI `10.7910/DVN/MNVUEP`, released 2024-04-04. The exact archive is `ICBe_Dataverse_replication.tar.gz`, datafile `10040265`, under CC BY-NC-SA 4.0. It has unrestricted access; reuse is subject to the applicable license. The authoritative event table inside it is `ICBe_V1.1_events_agreed.Rds`; the package has no CSV/TSV version of that table.
- **UCDP:** UCDP GED Global 26.1 from the official `ged261-csv.zip` download. UCDP states that its current downloadable datasets are CC BY 4.0 and may be redistributed with the requested citations.

The pinned artifact and extracted-file SHA-256 values are in `fixtures/real/icbe-ucdp-stage3a/source-metadata.json`. Raw archives, extracted files, parsed bundles, CLI output, and the detailed review artifact stay under gitignored `data/local/`. This avoids mixing ICBe's non-commercial/share-alike terms into Aldera's Apache-2.0 source tree.

## Bounded selection

The selected comparison window is **2014-04-07 through 2014-04-24** in **Donbas**:

- ICBe: coded rows in crisis `471` whose native location or sentence fields name Donbas/Donetsk/Luhansk and whose native date interval overlaps the window;
- UCDP: Ukraine records in `Donetsk oblast` or `Luhansk oblast` whose native `date_start`/`date_end` interval overlaps the window.

Inspection, not an advance assumption, produced this window. It yields 12 ICBe rows and 10 UCDP records (22 total), while including exact-day, month/range, and year-precision ICBe records and both short and long UCDP intervals. That makes precision and unit-of-analysis failures visible without producing hundreds of comparisons.

## Explicit adapter semantics

The ICBe adapter reads only these native fields:

- identity context: `crisno`, `sentence_number_int_aligned`;
- date interval: `date_earliest_day`, `date_earliest_month`, `date_earliest_year`, `date_latest_day`, `date_latest_month`, `date_latest_year`;
- place evidence: `interact_location`, `sentence_span_text`;
- actors: `do_actor_a`, `do_actor_b`, `say_actor_a`, `say_actor_b`, `think_actor_a`;
- review description/category fields remain native and are displayed without being merged.

ICBe's event table has no event-ID column. Aldera therefore records a stable source locator in the envelope while leaving it out of the native object. The locator binds the exact dataset version, raw archive filename and SHA-256, extracted RDS filename and SHA-256, one-based source row, and native `crisno` and `sentence_number_int_aligned` coordinates. A locator such as `ICBe-V1.1-sha256-8f34...7769d-row-18416-crisis-471-sentence-30` identifies where the native row came from; it does not invent a native ICBe event ID or assert that crisis/sentence coordinates are unique event identity.

The existing explicit UCDP adapter remains in place. For real GED CSV values it removes the time suffix from `date_start`/`date_end` only in the transient search view; the returned native timestamps remain unchanged.

## Candidate semantics

`aldera search --candidate-pairs --datasets icbe,ucdp` is a separate, non-authoritative mode of the existing `search` command. The checked-in source tree contains no real mapping bundle.

A small, comparison-specific contract in `src/candidate-contract.ts` defines the rules. Its current identity is `aldera:icbe-ucdp-candidate-contract` version `0.2.0`; its deterministic SHA-256 is included in every candidate receipt. This is a pinned ICBe/UCDP rule set, not a generic ontology or matching framework.

Text comparison applies Unicode NFKC normalization and locale-lowercasing, but every reason retains the actual native field names and values that matched. The bounded aliases are:

- Donbas place: `donbas`, `donbass`, `donetsk`, `luhansk` by case-insensitive substring;
- actors: `ukrain` and `russia` by case-insensitive substring; `dpr`/`lpr` as tokens or the phrases `donetsk people`/`luhansk people`;
- specific localities used only to guard coarse-date candidates: spelling variants of Sloviansk, plus Mariupol, Kramatorsk, and Donetsk city/town.

A precise-date pair is surfaced only when all of the following are true:

1. ICBe has day precision and the UCDP interval spans no more than three days;
2. the date intervals overlap or are exactly one day apart;
3. both native place representations match the explicit Donbas alias;
4. at least one bounded actor alias matches.

Broad records are not suppressed. Any overlapping pair for which ICBe is not day-precise or UCDP spans more than three days gets the explicit temporal signal `coarse_date_overlap` in the review matrix. A coarse pair becomes a candidate only with a Donbas match, a more specific locality match, and at least two actor-alias matches. Thus broad date overlap alone can never create a candidate, while a coarse record can still surface if independent native signals justify comparison.

The result exposes `same_date`, `date_overlap`, `date_within_one_day`, or `coarse_date_overlap`, along with actual native date values, interpreted intervals and precision; place, locality, and actor reasons likewise include the matching native fields and values on both sides. It emits no numeric score, relation, classification, or mapping authority.

Candidate receipts bind search contract `0.3`, candidate-contract ID/version/hash, both human-readable versions, both raw-artifact hashes, both canonical parsed-bundle hashes, normalized parameters, returned native refs/hashes, candidate IDs/refs/reasons/evidence, and the receipt hash. Machine-readable CLI format remains `0.1`.

The local review artifact includes all 120 ICBe×UCDP pair evaluations, not only surfaced candidates. Candidate generation is only a prioritization aid. `No candidate` means the pinned candidate contract did not prioritize a record; it does not mean `aldera:unmapped`, which would require a separately accepted assertion within a declared mapping bundle.

Human inspection found no plausible same-occurrence pair among the seven candidates in this window: the ICBe records concern building seizures, declarations, an operation announcement, the broader outbreak of war, or Russian exercises, while the paired UCDP records are distinct lethal events. Aldera therefore creates no `aldera:close` assertion. A better bounded follow-up is a separate **2014-07-16 through 2014-07-18** Donbas window: the pinned ICBe table's row 18436 describes the 17 July downing of Malaysia Airlines Flight 17, and UCDP native ID `154679` is a day-precise 17 July record at the MH17 crash site. This is a recommendation for human review, not a mapping.

## Findings that break synthetic assumptions

- ICBe events have no native event ID; crisis/sentence coordinates can also repeat because one sentence can generate multiple coded rows.
- ICBe commonly records narrative actions, speech, thoughts, sanctions, exercises, or broad episodes; UCDP GED records lethal organized-violence events. Similar dates and actors do not imply the same analytical unit.
- ICBe dates may be day, month, range, or year precision. UCDP also contains aggregated multi-day and multi-month records, including a 2014 Donetsk record spanning April to August.
- ICBe place evidence may be a tagged region in `interact_location`, only present in narrative text, or absent. UCDP has multiple geospatial precision fields and sometimes only an oblast-level location.
- Actor labels differ (`dpr/lpr`, `DPR`, government-qualified state names), and one ICBe narrative action can plausibly relate to several UCDP fatal events.
- Important ICBe actions such as declarations, troop exercises, and diplomatic measures often have no UCDP analogue because GED's inclusion rule is lethal organized violence.

These findings support keeping native opaque records and separate candidate/mapping objects. The only architecture change is a distinct candidate response/receipt plus ICBe source-row identity support; no generic adapter framework or canonical event was introduced.

## Local reproduction and review

After downloading the two official archives into `data/local/sources/` and extracting the named RDS/CSV files, verify the four exact files:

```sh
pnpm stage3a:verify-sources -- \
  fixtures/real/icbe-ucdp-stage3a/source-metadata.json \
  data/local/sources/icbe/ICBe_Dataverse_replication.tar.gz \
  data/local/extracted/icbe/ICBe_V1.1_events_agreed.Rds \
  data/local/sources/ucdp/ged261-csv.zip \
  data/local/extracted/ucdp/GEDEvent_v26_1.csv
```

Then extract the bounded native rows, build hashed local bundles, search, and render the review artifact:

```sh
Rscript scripts/extract-stage3a-native.R \
  data/local/extracted/icbe/ICBe_V1.1_events_agreed.Rds \
  data/local/extracted/ucdp/GEDEvent_v26_1.csv \
  data/local/stage3a/extracted-json

pnpm stage3a:build-bundles -- \
  data/local/stage3a/extracted-json \
  data/local/stage3a/bundles \
  fixtures/real/icbe-ucdp-stage3a/source-metadata.json

pnpm aldera search --candidate-pairs --datasets icbe,ucdp --json

pnpm stage3a:review -- \
  data/local/stage3a/bundles \
  data/local/stage3a/review.md
```

The detailed review keeps ICBe and UCDP fields in visibly separate sections for every candidate. It is local because it reproduces third-party native descriptions.
