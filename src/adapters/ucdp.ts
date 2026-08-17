import type { NativeAdapter } from "./types.js";
import { optionalString, requiredString } from "./types.js";

export const adaptUcdp: NativeAdapter = (native) => ({
  dataset: "ucdp",
  nativeId: requiredString(native, "id"),
  places: [
    ...optionalString(native, "country"),
    ...optionalString(native, "adm_1"),
    ...optionalString(native, "where_prec"),
  ],
  dateFrom: requiredString(native, "date_start"),
  dateTo: requiredString(native, "date_end"),
  actors: [...optionalString(native, "side_a"), ...optionalString(native, "side_b")],
});
