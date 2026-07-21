export type SamplingStrategy = "head" | "interval";
export type PythonExecutionMode = "sample" | "full";

export interface SamplingConfig {
  strategy: SamplingStrategy;
  rowLimit: number;
  columnLimit: number;
}

export type InferredScalarType = "number" | "boolean" | "date" | "string" | "mixed" | "empty";

export interface SchemaColumn {
  name: string;
  inferredType: InferredScalarType;
  nonEmptyCount: number;
  emptyCount: number;
  emptyRatio: number;
  sampleValues: string[];
}

export interface SheetProfile {
  sheetName: string;
  totalRows: number;
  totalColumns: number;
  headers: string[];
  columns: SchemaColumn[];
  previewRows: Record<string, unknown>[];
}

export interface FileAnalysisMeta {
  parser: "spreadsheet" | "json" | "text" | "markdown" | "pdf" | "word" | "unknown";
  pageCount?: number;
  textCharCount?: number;
  wordCount?: number;
  lineCount?: number;
}

export interface SessionTarget {
  fileId: string;
  sheetName: string;
}

export interface UploadedDataFileRecord {
  fileId: string;
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  filePath: string;
  storagePath?: string;
  sheetNames: string[];
  activeSheet: string;
  profiles: Record<string, SheetProfile>;
  analysisMeta?: FileAnalysisMeta;
}

export interface ExcelSessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  files: UploadedDataFileRecord[];
  activeTarget: SessionTarget;
  lastSampling: SamplingConfig;
}

export interface ClarifyingQuestionSet {
  questions: string[];
  usedProvider?: string;
  usedModel?: string;
}

export type PythonPlanDecision = "direct_answer" | "python";

export interface GeneratedPythonPlan {
  decision: PythonPlanDecision;
  directAnswer?: string;
  pythonCode: string;
  notes: string;
  suggestedSampling: SamplingConfig;
  followUpQuestions: string[];
  usedProvider?: string;
  usedModel?: string;
}

export interface PythonExecutionOutput {
  summary: string;
  textOutput?: string;
  previewRows: Record<string, unknown>[];
  exportRows: Record<string, unknown>[];
  totalOutputRows: number;
  truncated: boolean;
  chart?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  artifacts?: Array<{
    fileName: string;
    mimeType?: string;
    base64: string;
    description?: string;
  }>;
}
