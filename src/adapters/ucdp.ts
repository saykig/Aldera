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
  dateFrom: requiredString(native, "date_start").slice(0, 10),
  dateTo: requiredString(native, "date_end").slice(0, 10),
  actors: [...optionalString(native, "side_a"), ...optionalString(native, "side_b")],
});
