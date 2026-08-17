import type { DatasetId } from "../types.js";

/** A transient filter view. It is never stored or returned as an Aldera event. */
export interface NativeSearchView {
  dataset: DatasetId;
  nativeId: string;
  places: string[];
  dateFrom: string;
  dateTo: string;
  actors: string[];
}
export type NativeAdapter = (native: Record<string, unknown>) => NativeSearchView;

export function requiredString(native: Record<string, unknown>, field: string): string {
  const value = native[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`native field ${field} must be a non-empty string`);
  }
  return value;
}

export function optionalString(native: Record<string, unknown>, field: string): string[] {
  const value = native[field];
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") throw new Error(`native field ${field} must be a string`);
  return [value];
}
