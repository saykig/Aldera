import type { IcbeAdapter } from "./types.js";
import { optionalString, requiredInteger, requiredString } from "./types.js";

function dateBound(
  native: Record<string, unknown>,
  prefix: "date_earliest" | "date_latest",
  end: boolean,
): { value?: string; precision?: "day" | "month" | "year" } {
  const year = optionalString(native, `${prefix}_year`)[0];
  if (!year || !/^\d{4}$/.test(year)) return {};
  const month = optionalString(native, `${prefix}_month`)[0];
  if (!month || !/^\d{1,2}$/.test(month)) {
    return { value: `${year}-${end ? "12-31" : "01-01"}`, precision: "year" };
  }
  const paddedMonth = month.padStart(2, "0");
  const day = optionalString(native, `${prefix}_day`)[0];
  if (!day || !/^\d{1,2}$/.test(day)) {
    if (!end) return { value: `${year}-${paddedMonth}-01`, precision: "month" };
    const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    return { value: `${year}-${paddedMonth}-${String(last).padStart(2, "0")}`, precision: "month" };
  }
  return {
    value: `${year}-${paddedMonth}-${day.padStart(2, "0")}`,
    precision: "day",
  };
}

export const adaptIcbe: IcbeAdapter = (native) => {
  requiredInteger(native, "crisno");
  requiredInteger(native, "sentence_number_int_aligned");
  requiredString(native, "sentence_span_text");

  const earliest = dateBound(native, "date_earliest", false);
  const explicitLatest = dateBound(native, "date_latest", true);
  const inferredLatest = dateBound(native, "date_earliest", true);
  if (!earliest.value || !earliest.precision || !(explicitLatest.value ?? inferredLatest.value)) {
    throw new Error("ICBe candidate record must expose a parseable native date or date range");
  }

  return {
    dataset: "icbe",
    places: [
      ...optionalString(native, "interact_location"),
      ...optionalString(native, "sentence_span_text"),
    ],
    dateFrom: earliest.value,
    dateTo: explicitLatest.value ?? inferredLatest.value!,
    datePrecision: earliest.precision,
    actors: [
      ...optionalString(native, "do_actor_a"),
      ...optionalString(native, "do_actor_b"),
      ...optionalString(native, "say_actor_a"),
      ...optionalString(native, "say_actor_b"),
      ...optionalString(native, "think_actor_a"),
    ],
  };
};
