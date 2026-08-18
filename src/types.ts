export const DATASETS = ["ucdp", "acled"] as const;
export type DatasetId = (typeof DATASETS)[number];

export const CLI_FORMAT_VERSION = "0.1";
export const SEARCH_CONTRACT_VERSION = "0.1";
export const CANDIDATE_SEARCH_CONTRACT_VERSION = "0.4";

export const RELATIONS = [
  "aldera:close",
  "aldera:related",
  "aldera:incompatible",
  "aldera:unmapped",
] as const;
export type MappingRelation = (typeof RELATIONS)[number];

export interface DatasetDescriptor {
  id: DatasetId;
  title: string;
  version: string;
  fixture_kind: "synthetic" | "source";
  native_schema_documentation: string;
  native_id_field: "id" | "event_id_cnty";
}

export interface DatasetCatalog {
  schema_version: string;
  datasets: DatasetDescriptor[];
}

export interface NativeRecord {
  ref: string;
  native_id: string;
  native_sha256: string;
  native: Record<string, unknown>;
}

export interface SourceBundle {
  schema_version: string;
  dataset: DatasetId;
  dataset_version: string;
  fixture_notice: string;
  records: NativeRecord[];
}

export interface MappingProvenance {
  asserted_by: string;
  asserted_at: string;
  evidence: string[];
  method: string;
}

export interface MappingAssertion {
  id: string;
  mapping_version: string;
  source: string;
  target: string | null;
  relation: MappingRelation;
  rationale: string;
  scope?: { place?: string[]; temporal?: { from: string; to: string }; fields?: string[] };
  uncertainty?: string;
  meaning_preserved: string[];
  meaning_lost: string[];
  provenance: MappingProvenance;
}

export interface MappingBundle {
  schema_version: string;
  mapping_version: string;
  comparison: {
    source_dataset: DatasetId;
    target_dataset: DatasetId;
  };
  mappings: MappingAssertion[];
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
}

export interface SearchQuery {
  datasets: DatasetId[];
  place?: string;
  from?: string;
  to?: string;
  actor?: string;
  relation?: MappingRelation;
  source_id?: string;
}

export interface SearchResultRecord extends NativeRecord {
  dataset: DatasetId;
  dataset_version: string;
}

export interface SearchReceiptBody {
  search_contract_version: string;
  inputs: {
    ucdp: { version: string; source_bundle_sha256: string };
    acled: { version: string; source_bundle_sha256: string };
    mapping: {
      version: string;
      mapping_bundle_sha256: string;
    };
  };
  parameters: SearchQuery;
  native_records: Array<{
    ref: string;
    native_sha256: string;
  }>;
  mapping_ids: string[];
}

export interface SearchReceipt extends SearchReceiptBody {
  receipt_sha256: string;
}

export interface SearchResponse {
  format_version: string;
  records: SearchResultRecord[];
  mappings: MappingAssertion[];
  receipt: SearchReceipt;
}

export type CandidateReason =
  | "same_date"
  | "date_overlap"
  | "date_within_one_day"
  | "coarse_date_overlap"
  | "geographic_context_overlap"
  | "locality_overlap"
  | "actor_overlap";

export interface NativeIdIdentity {
  kind: "native_id";
  value: string;
  native_fields: string[];
}

export interface IcbeSourceLocatorIdentity {
  kind: "source_row_locator";
  value: string;
  dataset_version: string;
  raw_artifact: { filename: string; sha256: string };
  extracted_table: { filename: string; sha256: string; row_number: number };
  native_coordinates: {
    crisno: number;
    sentence_number_int_aligned: number;
  };
}

export type CandidateNativeIdentity = NativeIdIdentity | IcbeSourceLocatorIdentity;

export interface CandidateSourceRecord {
  ref: string;
  dataset: "icbe" | "ucdp";
  dataset_version: string;
  native_identity: CandidateNativeIdentity;
  native_sha256: string;
  native: Record<string, unknown>;
}

export interface CandidateSourceBundle {
  schema_version: "0.1.0";
  dataset: "icbe" | "ucdp";
  dataset_version: string;
  source: {
    artifact_url: string;
    artifact_filename: string;
    artifact_sha256: string;
    extracted_artifact_filename: string;
    extracted_artifact_sha256: string;
  };
  selection: {
    case: string;
    place: string;
    from: string;
    to: string;
  };
  records: CandidateSourceRecord[];
}

export interface CandidatePair {
  kind: "candidate_pair";
  id: string;
  icbe_ref: string;
  ucdp_ref: string;
  reasons: CandidateReason[];
  reason_evidence: CandidateReasonEvidence;
}

export interface NativeFieldValue {
  field: string;
  value: string;
}

export interface AliasEvidence {
  key: string;
  normalization_rule: string;
  icbe_native_values: NativeFieldValue[];
  ucdp_native_values: NativeFieldValue[];
}

export interface CandidateReasonEvidence {
  temporal: {
    reason: Extract<CandidateReason, "same_date" | "date_overlap" | "date_within_one_day" | "coarse_date_overlap"> | null;
    icbe: {
      native_values: NativeFieldValue[];
      interpreted_from: string;
      interpreted_to: string;
      precision: "day" | "month" | "year";
    };
    ucdp: {
      native_values: NativeFieldValue[];
      interpreted_from: string;
      interpreted_to: string;
      interval_days: number;
      native_date_prec: string;
    };
  };
  geographic_context: AliasEvidence[];
  localities: AliasEvidence[];
  actors: AliasEvidence[];
}

export interface CandidatePairEvaluation {
  icbe_ref: string;
  ucdp_ref: string;
  candidate: boolean;
  candidate_id: string | null;
  reasons: CandidateReason[];
  reason_evidence: CandidateReasonEvidence;
  exclusion_reasons: string[];
}

export interface CandidateQuery {
  candidate_pairs: true;
  datasets: Array<"icbe" | "ucdp">;
  place?: string;
  from?: string;
  to?: string;
  actor?: string;
}

export interface CandidateReceiptBody {
  search_contract_version: string;
  candidate_contract: { id: string; version: string; sha256: string };
  inputs: {
    icbe: {
      version: string;
      artifact_sha256: string;
      source_bundle_sha256: string;
    };
    ucdp: {
      version: string;
      artifact_sha256: string;
      source_bundle_sha256: string;
    };
  };
  parameters: CandidateQuery;
  native_records: Array<{ ref: string; native_sha256: string }>;
  candidate_pairs: Array<{
    id: string;
    icbe_ref: string;
    ucdp_ref: string;
    reasons: CandidateReason[];
    reason_evidence: CandidateReasonEvidence;
  }>;
}

export interface CandidateSearchResponse {
  format_version: string;
  mode: "candidate_pairs";
  mapping_authority: false;
  records: CandidateSourceRecord[];
  candidate_pairs: CandidatePair[];
  mappings: [];
  not_prioritized_refs: string[];
  no_candidate_notice: string;
  receipt: CandidateReceiptBody & { receipt_sha256: string };
}
