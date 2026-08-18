import type { CandidateSourceRecord } from "./types.js";

export const RELATIONSHIP_SCHEMA_VERSION = "0.1.0";
export const RELATIONSHIP_SEARCH_CONTRACT_VERSION = "0.1";

export const IDENTITIES = ["same", "not_same", "uncertain"] as const;
export type RelationshipIdentity = (typeof IDENTITIES)[number];

export const RELATEDNESS_VALUES = ["related", "not_related", "uncertain"] as const;
export type RelationshipRelatedness = (typeof RELATEDNESS_VALUES)[number];

export const SCOPES = [
  "source_broader",
  "target_broader",
  "no_broader_narrower_asserted",
  "uncertain",
] as const;
export type RelationshipScope = (typeof SCOPES)[number];

export const EQUIVALENCE_SAFETY_VALUES = [
  "safe_as_equivalent",
  "unsafe_as_equivalent",
  "uncertain",
] as const;
export type EquivalenceSafety = (typeof EQUIVALENCE_SAFETY_VALUES)[number];

export interface RelationshipDimensions {
  identity: RelationshipIdentity;
  relatedness: RelationshipRelatedness;
  scope: RelationshipScope;
  equivalence_safety: EquivalenceSafety;
}

export interface RelationshipAssertion {
  kind: "relationship_assertion";
  id: string;
  review_item: number;
  source_ref: string;
  target_ref: string;
  dimensions: RelationshipDimensions;
  human_note?: string;
  rationale?: string;
  meaning_preserved?: string[];
  meaning_lost?: string[];
  uncertainty_note?: string;
}

export interface RelationshipNativeSourceSet {
  id: string;
  relative_directory: string;
  bundles: {
    icbe: { version: string; sha256: string };
    ucdp: { version: string; sha256: string };
  };
}

export interface RelationshipAssertionBundleBody {
  schema_version: string;
  assertion_bundle_version: string;
  relationship_authority: true;
  comparison: { source_collection: "icbe"; target_collection: "ucdp" };
  benchmark_provenance: {
    path: string;
    sha256: string;
    review_date: string;
  };
  native_source_sets: RelationshipNativeSourceSet[];
  assertions: RelationshipAssertion[];
}

export interface RelationshipAssertionBundle extends RelationshipAssertionBundleBody {
  bundle_sha256: string;
}

export interface RelationshipSearchQuery {
  identity?: RelationshipIdentity;
  relatedness?: RelationshipRelatedness;
  scope?: RelationshipScope;
  equivalence_safety?: EquivalenceSafety;
  assertion_id?: string;
  source_ref?: string;
  target_ref?: string;
  place?: string;
  from?: string;
  to?: string;
  actor?: string;
}

export interface RelationshipReceiptBody {
  search_contract_version: string;
  relationship_schema_version: string;
  assertion_bundle_version: string;
  assertion_bundle_sha256: string;
  benchmark_sha256: string;
  parameters: { command: "map" | "search" } & Record<string, unknown>;
  assertion_ids: string[];
  opaque_refs: string[];
  native_content: "not_loaded" | "loaded_and_validated";
  native_records: Array<{ ref: string; native_sha256: string }>;
}

export interface RelationshipReceipt extends RelationshipReceiptBody {
  receipt_sha256: string;
}

export interface RelationshipOutput {
  format_version: string;
  mode: "relationship_assertions";
  relationship_authority: true;
  native_content: "not_loaded" | "loaded_and_validated";
  native_content_notice: string;
  assertions: RelationshipAssertion[];
  records: CandidateSourceRecord[];
  receipt: RelationshipReceipt;
}

export interface RelationshipDiagnostic {
  code: string;
  severity: "error" | "info";
  path: string;
  message: string;
}
