import type { NativeAdapter } from "./types.js";
import { optionalString, requiredString } from "./types.js";

export const adaptAcled: NativeAdapter = (native) => {
  const eventDate = requiredString(native, "event_date");
  return {
    dataset: "acled",
    nativeId: requiredString(native, "event_id_cnty"),
    places: [
      ...optionalString(native, "country"),
      ...optionalString(native, "admin1"),
      ...optionalString(native, "location"),
    ],
    dateFrom: eventDate,
    dateTo: eventDate,
    actors: [
      ...optionalString(native, "actor1"),
      ...optionalString(native, "actor2"),
      ...optionalString(native, "assoc_actor_1"),
      ...optionalString(native, "assoc_actor_2"),
    ],
  };
};
