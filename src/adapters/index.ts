import { adaptAcled } from "./acled.js";
import { adaptUcdp } from "./ucdp.js";
import type { DatasetId } from "../types.js";
import type { NativeAdapter } from "./types.js";

const adapters: Record<DatasetId, NativeAdapter> = {
  ucdp: adaptUcdp,
  acled: adaptAcled,
};

export function adapterFor(dataset: DatasetId): NativeAdapter {
  return adapters[dataset];
}
