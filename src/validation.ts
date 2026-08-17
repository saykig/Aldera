import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import _Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";
import { DATASETS, RELATIONS, type Diagnostic } from "./types.js";
import { sha256 } from "./canonical.js";
import { adapterFor } from "./adapters/index.js";
import type { AlderaStore } from "./store.js";

const SCHEMAS = ["dataset-catalog", "source-bundle", "mapping-bundle"] as const;
type SchemaName = (typeof SCHEMAS)[number];

function schemaPath(name: SchemaName): string {
  const candidates = [
    fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url)),
    fileURLToPath(new URL(`../../schemas/${name}.schema.json`, import.meta.url)),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Cannot locate schema ${name}`);
  return found;
}

type DefaultExport<T> = T extends { default: infer D } ? D : T;
const Ajv2020 = ((_Ajv2020 as { default?: unknown }).default ?? _Ajv2020) as DefaultExport<
  typeof _Ajv2020
>;
const addFormats = ((_addFormats as { default?: unknown }).default ?? _addFormats) as DefaultExport<
  typeof _addFormats
>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = Object.fromEntries(
  SCHEMAS.map((name) => {
    const schema = JSON.parse(readFileSync(schemaPath(name), "utf8"));
    return [name, ajv.compile(schema)];
  }),
) as Record<SchemaName, ValidateFunction>;

function schemaDiagnostics(name: SchemaName, value: unknown, path: string): Diagnostic[] {
  const validate = validators[name];
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error: ErrorObject) => ({
    code: "ALD-SCHEMA-INVALID",
    severity: "error" as const,
    path: `${path}${error.instancePath}`,
    message: error.message ?? error.keyword,
  }));
}

export function validateStore(store: AlderaStore): Diagnostic[] {
  const diagnostics: Diagnostic[] = [
    ...schemaDiagnostics("dataset-catalog", store.catalog, "datasets.json"),
    ...store.bundles.flatMap((bundle) =>
      schemaDiagnostics("source-bundle", bundle, `${bundle.dataset}.json`),
    ),
    ...schemaDiagnostics("mapping-bundle", store.mappingBundle, "mappings.json"),
  ];

  const descriptors = new Map(store.catalog.datasets.map((dataset) => [dataset.id, dataset]));
  const refs = new Set<string>();
  for (const bundle of store.bundles) {
    const descriptor = descriptors.get(bundle.dataset);
    if (!descriptor || descriptor.version !== bundle.dataset_version) {
      diagnostics.push({
        code: "ALD-VERSION-MISMATCH",
        severity: "error",
        path: `${bundle.dataset}.json/dataset_version`,
        message: `Bundle version ${bundle.dataset_version} does not match its catalog descriptor.`,
      });
    }
    const expectedIdField = bundle.dataset === "ucdp" ? "id" : "event_id_cnty";
    if (descriptor && descriptor.native_id_field !== expectedIdField) {
      diagnostics.push({
        code: "ALD-ID-FIELD-MISMATCH",
        severity: "error",
        path: `datasets.json/${bundle.dataset}/native_id_field`,
        message: `${bundle.dataset} must identify native records with ${expectedIdField}.`,
      });
    }
    for (const [index, record] of bundle.records.entries()) {
      const path = `${bundle.dataset}.json/records/${index}`;
      if (refs.has(record.ref)) {
        diagnostics.push({
          code: "ALD-REF-DUPLICATE",
          severity: "error",
          path: `${path}/ref`,
          message: `Duplicate source reference ${record.ref}.`,
        });
      }
      refs.add(record.ref);
      if (!record.ref.startsWith(`${bundle.dataset}:`)) {
        diagnostics.push({
          code: "ALD-REF-DATASET",
          severity: "error",
          path: `${path}/ref`,
          message: `Reference ${record.ref} does not use the ${bundle.dataset}: namespace.`,
        });
      }
      if (record.ref !== `${bundle.dataset}:${record.native_id}`) {
        diagnostics.push({
          code: "ALD-NATIVE-ID-MISMATCH",
          severity: "error",
          path: `${path}/native_id`,
          message: `Reference ${record.ref} must preserve native identifier ${record.native_id}.`,
        });
      }
      try {
        const view = adapterFor(bundle.dataset)(record.native);
        if (view.nativeId !== record.native_id) {
          diagnostics.push({
            code: "ALD-NATIVE-ID-MISMATCH",
            severity: "error",
            path: `${path}/native_id`,
            message: `Envelope identifier ${record.native_id} differs from native ${expectedIdField} ${view.nativeId}.`,
          });
        }
      } catch (error) {
        diagnostics.push({
          code: "ALD-NATIVE-SHAPE",
          severity: "error",
          path: `${path}/native`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const actual = sha256(record.native);
      if (actual !== record.native_sha256) {
        diagnostics.push({
          code: "ALD-HASH-MISMATCH",
          severity: "error",
          path: `${path}/native_sha256`,
          message: `Native record hash is ${actual}; stored hash is ${record.native_sha256}.`,
        });
      }
    }
  }

  const mappingIds = new Set<string>();
  const comparison = store.mappingBundle.comparison as
    | { source_dataset: string; target_dataset: string }
    | undefined;
  for (const [index, mapping] of store.mappingBundle.mappings.entries()) {
    const path = `mappings.json/mappings/${index}`;
    if (mappingIds.has(mapping.id)) {
      diagnostics.push({
        code: "ALD-MAPPING-DUPLICATE",
        severity: "error",
        path: `${path}/id`,
        message: `Duplicate mapping id ${mapping.id}.`,
      });
    }
    mappingIds.add(mapping.id);
    if (mapping.mapping_version !== store.mappingBundle.mapping_version) {
      diagnostics.push({
        code: "ALD-VERSION-MISMATCH",
        severity: "error",
        path: `${path}/mapping_version`,
        message: `Assertion version ${mapping.mapping_version} does not match bundle version ${store.mappingBundle.mapping_version}.`,
      });
    }
    if (!refs.has(mapping.source)) {
      diagnostics.push({
        code: "ALD-REF-MISSING",
        severity: "error",
        path: `${path}/source`,
        message: `Source reference ${mapping.source} does not resolve.`,
      });
    }
    if (mapping.target !== null && !refs.has(mapping.target)) {
      diagnostics.push({
        code: "ALD-REF-MISSING",
        severity: "error",
        path: `${path}/target`,
        message: `Target reference ${mapping.target} does not resolve.`,
      });
    }
    if ((mapping.relation === "aldera:unmapped") !== (mapping.target === null)) {
      diagnostics.push({
        code: "ALD-UNMAPPED-TARGET",
        severity: "error",
        path,
        message: "Only aldera:unmapped may have a null target, and it must have one.",
      });
    }
    if (comparison && !mapping.source.startsWith(`${comparison.source_dataset}:`)) {
      diagnostics.push({
        code: "ALD-COMPARISON-SOURCE",
        severity: "error",
        path: `${path}/source`,
        message: `Mapping source must belong to declared source dataset ${comparison.source_dataset}.`,
      });
    }
    if (
      comparison &&
      mapping.target !== null &&
      !mapping.target.startsWith(`${comparison.target_dataset}:`)
    ) {
      diagnostics.push({
        code: "ALD-COMPARISON-TARGET",
        severity: "error",
        path: `${path}/target`,
        message: `Mapping target must belong to declared target dataset ${comparison.target_dataset}.`,
      });
    }
    if (!(RELATIONS as readonly string[]).includes(mapping.relation)) {
      diagnostics.push({
        code: "ALD-RELATION-UNKNOWN",
        severity: "error",
        path: `${path}/relation`,
        message: `Unknown mapping relation ${mapping.relation}.`,
      });
    }
    for (const evidenceRef of mapping.provenance.evidence) {
      if (!refs.has(evidenceRef)) {
        diagnostics.push({
          code: "ALD-EVIDENCE-REF-MISSING",
          severity: "error",
          path: `${path}/provenance/evidence`,
          message: `Evidence reference ${evidenceRef} does not resolve.`,
        });
      }
    }
    const expectedEvidence = [mapping.source, ...(mapping.target ? [mapping.target] : [])];
    for (const expectedRef of expectedEvidence) {
      if (!mapping.provenance.evidence.includes(expectedRef)) {
        diagnostics.push({
          code: "ALD-EVIDENCE-INCOMPLETE",
          severity: "error",
          path: `${path}/provenance/evidence`,
          message: `Evidence must include mapped native reference ${expectedRef}.`,
        });
      }
    }
  }

  for (const dataset of DATASETS) {
    if (!descriptors.has(dataset)) {
      diagnostics.push({
        code: "ALD-DATASET-MISSING",
        severity: "error",
        path: "datasets.json/datasets",
        message: `Missing ${dataset} descriptor.`,
      });
    }
  }
  return diagnostics.sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`));
}
