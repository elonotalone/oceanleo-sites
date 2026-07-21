// LeoSheet stub for generator's generation-storage.
//
// In generator this uploaded every result to a Supabase "generation-outputs"
// bucket + indexed it in a generation_outputs table (service-role). LeoSheet
// does NOT mirror that table; the Excel sandbox already serves results via the
// local /api/excel-sandbox/download route (see run route — local download is
// always preferred over the persisted artifact). This stub keeps the run route
// import resolving while making persistence an explicit no-op.

export type GenerationResultKind = "text" | "image" | "video" | "spreadsheet";

export type PersistGenerationInput = {
  fileType: string;
  generationMode: "draft" | "final";
  resultKind: GenerationResultKind;
  prompt: string;
  provider?: string;
  model?: string;
  sourceUrl?: string;
  content?: string;
  contentType?: string;
  extension?: string;
  metadata?: Record<string, unknown>;
};

export type PersistedGenerationArtifact = {
  id?: string;
  bucket: string;
  path: string;
  fileName: string;
  downloadUrl: string;
  contentType: string;
};

export type PersistGenerationResult = {
  artifact: PersistedGenerationArtifact | null;
  warning?: string;
};

export async function persistGenerationResult(
  _input: PersistGenerationInput
): Promise<PersistGenerationResult> {
  // Intentionally a no-op: results are downloaded through the local
  // /api/excel-sandbox/download endpoint, no central artifact index needed.
  return { artifact: null };
}
