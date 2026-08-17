export const DATASETS = ["ucdp", "acled"] as const;
export type DatasetId = (typeof DATASETS)[number];

export const CLI_FORMAT_VERSION = "0.1";
export const SEARCH_CONTRACT_VERSION = "0.1";

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
