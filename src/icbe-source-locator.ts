import type {
  CandidateSourceBundle,
  IcbeSourceLocatorIdentity,
} from "./types.js";

export function makeIcbeSourceLocator(input: {
  datasetVersion: string;
  source: CandidateSourceBundle["source"];
  rowNumber: number;
  native: Record<string, unknown>;
}): IcbeSourceLocatorIdentity {
  const crisno = input.native.crisno;
  const sentence = input.native.sentence_number_int_aligned;
  if (!Number.isInteger(crisno) || !Number.isInteger(sentence)) {
    throw new Error("ICBe source locator requires integer crisis and sentence coordinates");
  }
  const tableHash = input.source.extracted_artifact_sha256.replace(/^sha256:/, "");
  return {
    kind: "source_row_locator",
    value: `ICBe-V1.1-sha256-${tableHash}-row-${input.rowNumber}-crisis-${crisno}-sentence-${sentence}`,
    dataset_version: input.datasetVersion,
    raw_artifact: {
      filename: input.source.artifact_filename,
      sha256: input.source.artifact_sha256,
    },
    extracted_table: {
      filename: input.source.extracted_artifact_filename,
      sha256: input.source.extracted_artifact_sha256,
      row_number: input.rowNumber,
    },
    native_coordinates: {
      crisno: crisno as number,
      sentence_number_int_aligned: sentence as number,
    },
  };
}
