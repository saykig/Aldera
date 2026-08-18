import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterFor } from "./adapters/index.js";
import { sha256 } from "./canonical.js";
import { CLI_FORMAT_VERSION, SEARCH_CONTRACT_VERSION } from "./types.js";
import type {
  DatasetCatalog,
  DatasetDescriptor,
  DatasetId,
  MappingAssertion,
  MappingBundle,
  MappingRelation,
  SearchQuery,
  SearchResponse,
  SearchResultRecord,
  SourceBundle,
} from "./types.js";

function defaultDataDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "fixtures/synthetic"),
    resolve(here, "../fixtures/synthetic"),
    resolve(here, "../../fixtures/synthetic"),
  ];
  const found = candidates.find((candidate) => existsSync(resolve(candidate, "datasets.json")));
  if (!found) throw new Error("Cannot locate fixtures/synthetic; pass --data-dir <path>.");
  return found;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function contains(haystacks: readonly string[], needle: string): boolean {
  const normalized = needle.toLowerCase();
  return haystacks.some((value) => value.toLowerCase().includes(normalized));
}

function normalizeQuery(query: SearchQuery): SearchQuery {
  const datasets = [...new Set(query.datasets)].sort();
  const place = query.place?.trim();
  const from = query.from?.trim();
  const to = query.to?.trim();
  const actor = query.actor?.trim();
  const sourceId = query.source_id?.trim();
  return {
    datasets,
    ...(place ? { place } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
    ...(query.relation ? { relation: query.relation } : {}),
    ...(sourceId ? { source_id: sourceId } : {}),
  };
}

export class AlderaStore {
  readonly dataDirectory: string;
  readonly catalog: DatasetCatalog;
  readonly bundles: SourceBundle[];
  readonly mappingBundle: MappingBundle;

  constructor(dataDirectory = defaultDataDirectory()) {
    this.dataDirectory = resolve(dataDirectory);
    this.catalog = readJson<DatasetCatalog>(resolve(this.dataDirectory, "datasets.json"));
    this.bundles = this.catalog.datasets.map((dataset) =>
      readJson<SourceBundle>(resolve(this.dataDirectory, `${dataset.id}.json`)),
    );
    this.mappingBundle = readJson<MappingBundle>(resolve(this.dataDirectory, "mappings.json"));
  }

  descriptors(): DatasetDescriptor[] {
    return [...this.catalog.datasets].sort((a, b) => a.id.localeCompare(b.id));
  }

  records(): SearchResultRecord[] {
    return this.bundles
      .flatMap((bundle) =>
        bundle.records.map((record) => ({
          ...record,
          dataset: bundle.dataset,
          dataset_version: bundle.dataset_version,
        })),
      )
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  record(ref: string): SearchResultRecord | undefined {
    return this.records().find((record) => record.ref === ref);
  }

  mapping(id: string): MappingAssertion | undefined {
    return this.mappingBundle.mappings.find((mapping) => mapping.id === id);
  }

  mappingsBetween(source: string, target?: string): MappingAssertion[] {
    return this.mappingBundle.mappings
      .filter((mapping) => {
        if (target === undefined) return mapping.source === source || mapping.target === source;
        return (
          (mapping.source === source && mapping.target === target) ||
          (mapping.source === target && mapping.target === source)
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  search(inputQuery: SearchQuery): SearchResponse {
    const query = normalizeQuery(inputQuery);
    let records = this.records().filter((record) => {
      if (!query.datasets.includes(record.dataset)) return false;
      const view = adapterFor(record.dataset)(record.native);
      if (view.nativeId !== record.native_id) {
        throw new Error(`${record.ref} envelope native_id does not match its native record`);
      }
      if (query.source_id && !(record.ref === query.source_id || view.nativeId === query.source_id)) {
        return false;
      }
      if (query.place && !contains(view.places, query.place)) return false;
      if (query.actor && !contains(view.actors, query.actor)) return false;
      if (query.from && view.dateTo < query.from) return false;
      if (query.to && view.dateFrom > query.to) return false;
      return true;
    });

    if (query.relation) {
      const relatedRefs = new Set(
        this.mappingBundle.mappings
          .filter((mapping) => mapping.relation === query.relation)
          .flatMap((mapping) => [mapping.source, ...(mapping.target ? [mapping.target] : [])]),
      );
      records = records.filter((record) => relatedRefs.has(record.ref));
    }

    const refs = new Set(records.map((record) => record.ref));
    const mappings = this.mappingBundle.mappings
      .filter((mapping) => {
        if (query.relation && mapping.relation !== query.relation) return false;
        return refs.has(mapping.source) || (mapping.target !== null && refs.has(mapping.target));
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const sourceBundles = Object.fromEntries(
      this.bundles.map((bundle) => [bundle.dataset, bundle]),
    ) as Record<DatasetId, SourceBundle>;
    const receiptBody = {
      search_contract_version: SEARCH_CONTRACT_VERSION,
      inputs: {
        ucdp: {
          version: sourceBundles.ucdp.dataset_version,
          source_bundle_sha256: sha256(sourceBundles.ucdp),
        },
        acled: {
          version: sourceBundles.acled.dataset_version,
          source_bundle_sha256: sha256(sourceBundles.acled),
        },
        mapping: {
          version: this.mappingBundle.mapping_version,
          mapping_bundle_sha256: sha256(this.mappingBundle),
        },
      },
      parameters: query,
      native_records: records.map((record) => ({
        ref: record.ref,
        native_sha256: record.native_sha256,
      })),
      mapping_ids: mappings.map((mapping) => mapping.id),
    };
    const receipt_sha256 = sha256(receiptBody);

    return {
      format_version: CLI_FORMAT_VERSION,
      records,
      mappings,
      receipt: { ...receiptBody, receipt_sha256 },
    };
  }
}

export function normalizeDatasets(value: string | undefined): DatasetId[] {
  const requested = (value ?? "ucdp,acled")
    .split(",")
    .map((dataset) => dataset.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set<DatasetId>(["ucdp", "acled"]);
  for (const dataset of requested) {
    if (!allowed.has(dataset as DatasetId)) throw new Error(`Unknown dataset: ${dataset}`);
  }
  return [...new Set(requested as DatasetId[])].sort();
}

export function normalizeRelation(value: string | undefined): MappingRelation | undefined {
  if (value === undefined) return undefined;
  const aliases: Record<string, MappingRelation> = {
    close: "aldera:close",
    related: "aldera:related",
    incompatible: "aldera:incompatible",
    unmapped: "aldera:unmapped",
  };
  const normalized = aliases[value] ?? value;
  const allowed = new Set<MappingRelation>([
    "aldera:close",
    "aldera:related",
    "aldera:incompatible",
    "aldera:unmapped",
  ]);
  if (!allowed.has(normalized as MappingRelation)) throw new Error(`Unknown relation: ${value}`);
  return normalized as MappingRelation;
}
