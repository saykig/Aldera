/** A transient filter view. It is never stored or returned as an Aldera event. */
export interface NativeSearchView {
  dataset: "ucdp";
  nativeId: string;
  places: string[];
  dateFrom: string;
  dateTo: string;
  datePrecision?: "day" | "month" | "year";
  actors: string[];
}
export type NativeAdapter = (native: Record<string, unknown>) => NativeSearchView;

/** ICBe has no native event ID, so candidate search uses a distinct signal view. */
export interface IcbeCandidateView {
  dataset: "icbe";
  places: string[];
  dateFrom: string;
  dateTo: string;
  datePrecision: "day" | "month" | "year";
  actors: string[];
}
export type IcbeAdapter = (native: Record<string, unknown>) => IcbeCandidateView;

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

export function requiredInteger(native: Record<string, unknown>, field: string): number {
  const value = native[field];
  if (!Number.isInteger(value)) throw new Error(`native field ${field} must be an integer`);
  return value as number;
}
