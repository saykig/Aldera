import { sha256 } from "./canonical.js";

/**
 * Bounded ICBe ↔ UCDP candidate contract. This is intentionally comparison-
 * specific data, not a generic ontology or matching framework.
 */
export const ICBE_UCDP_CANDIDATE_CONTRACT = {
  id: "aldera:icbe-ucdp-candidate-contract",
  version: "0.2.0",
  comparison: { source_dataset: "icbe", target_dataset: "ucdp" },
  native_fields: {
    icbe: {
      dates: [
        "date_earliest_day",
        "date_earliest_month",
        "date_earliest_year",
        "date_latest_day",
        "date_latest_month",
        "date_latest_year",
      ],
      places: ["interact_location", "sentence_span_text"],
      actors: ["do_actor_a", "do_actor_b", "say_actor_a", "say_actor_b", "think_actor_a"],
    },
    ucdp: {
      dates: ["date_start", "date_end", "date_prec"],
      places: ["adm_1", "adm_2", "where_coordinates", "where_description"],
      actors: ["side_a", "side_b"],
    },
  },
  normalization: {
    text: "Unicode NFKC, locale-lowercase; native values are retained in evidence",
    place_aliases: [
      {
        key: "donbas",
        rule: "case-insensitive substring",
        terms: ["donbas", "donbass", "donetsk", "luhansk"],
      },
    ],
    locality_aliases: [
      {
        key: "sloviansk",
        rule: "case-insensitive substring",
        terms: ["sloviansk", "slavyansk", "slaviansk"],
      },
      { key: "mariupol", rule: "case-insensitive substring", terms: ["mariupol"] },
      { key: "kramatorsk", rule: "case-insensitive substring", terms: ["kramatorsk"] },
      {
        key: "donetsk-city",
        rule: "case-insensitive phrase",
        terms: ["donetsk town", "donetsk city"],
      },
    ],
    actor_aliases: [
      { key: "ukraine", rule: "case-insensitive substring", terms: ["ukrain"] },
      { key: "russia", rule: "case-insensitive substring", terms: ["russia"] },
      {
        key: "dpr",
        rule: "token dpr or case-insensitive phrase",
        terms: ["dpr", "donetsk people"],
      },
      {
        key: "lpr",
        rule: "token lpr or case-insensitive phrase",
        terms: ["lpr", "luhansk people"],
      },
    ],
  },
  temporal_rules: {
    precise_ucdp_max_interval_days: 3,
    near_date_max_gap_days: 1,
    coarse_date_overlap:
      "Any overlapping interval where ICBe is not day-precise or UCDP spans more than three days",
  },
  candidate_rules: {
    precise:
      "A precise temporal signal, at least one place-alias match, and at least one actor-alias match",
    coarse:
      "coarse_date_overlap, a Donbas place-alias match, a more specific locality-alias match, and at least two actor-alias matches",
    negative_result:
      "No candidate means only that this contract did not prioritize the pair; it is not aldera:unmapped",
  },
} as const;

export const ICBE_UCDP_CANDIDATE_CONTRACT_IDENTITY = {
  id: ICBE_UCDP_CANDIDATE_CONTRACT.id,
  version: ICBE_UCDP_CANDIDATE_CONTRACT.version,
  sha256: sha256(ICBE_UCDP_CANDIDATE_CONTRACT),
};
