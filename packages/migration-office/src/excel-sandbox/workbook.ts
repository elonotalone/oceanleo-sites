import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import {
  EXCEL_SANDBOX_DEFAULT_COLUMN_LIMIT,
  EXCEL_SANDBOX_DEFAULT_ROW_LIMIT,
  EXCEL_SANDBOX_MAX_SAMPLE_ITEMS,
  EXCEL_SANDBOX_PREVIEW_COLUMN_LIMIT,
  EXCEL_SANDBOX_PREVIEW_ROW_LIMIT,
} from "./constants";
import type {
  FileAnalysisMeta,
  InferredScalarType,
  SamplingConfig,
  SamplingStrategy,
  SchemaColumn,
  SheetProfile,
} from "./types";

const SPREADSHEET_EXTENSIONS = new Set<string>([".xlsx", ".xls", ".csv", ".tsv"]);
const WORD_EXTENSIONS = new Set<string>([".doc", ".docx"]);
const MAX_TEXT_ROWS = 100_000;
const MAX_TEXT_CELL_CHARS = 2_000;

function clampToPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < 1) return 1;
  return Math.min(rounded, max);
}

export function normalizeSamplingConfig(
  input?: Partial<SamplingConfig> | null
): SamplingConfig {
  const strategy: SamplingStrategy =
    input?.strategy === "interval" ? "interval" : "head";
  return {
    strategy,
    rowLimit: clampToPositiveInt(
      input?.rowLimit,
      EXCEL_SANDBOX_DEFAULT_ROW_LIMIT,
      EXCEL_SANDBOX_MAX_SAMPLE_ITEMS
    ),
    columnLimit: clampToPositiveInt(
      input?.columnLimit,
      EXCEL_SANDBOX_DEFAULT_COLUMN_LIMIT,
      EXCEL_SANDBOX_MAX_SAMPLE_ITEMS
    ),
  };
}

function normalizeCellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.trim();
  return String(raw);
}

function decodeBufferText(buffer: Buffer): string {
  return buffer.toString("utf8");
}

function countWords(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/u).filter(Boolean).length;
}

function countNonEmptyLines(text: string): number {
  if (!text.trim()) return 0;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function buildTextAnalysisMeta(
  parser: FileAnalysisMeta["parser"],
  text: string,
  extra?: Partial<FileAnalysisMeta>
): FileAnalysisMeta {
  const normalizedText = text || "";
  return {
    parser,
    textCharCount: normalizedText.length,
    wordCount: countWords(normalizedText),
    lineCount: countNonEmptyLines(normalizedText),
    ...extra,
  };
}

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index).toLowerCase();
}

export function isSpreadsheetExtension(extension: string): boolean {
  return SPREADSHEET_EXTENSIONS.has((extension || "").toLowerCase());
}

export function defaultSheetNameForExtension(extension: string): string {
  const normalized = (extension || "").toLowerCase();
  if (normalized === ".json") return "JSON";
  if (normalized === ".md") return "Markdown";
  if (normalized === ".pdf") return "PDF";
  if (WORD_EXTENSIONS.has(normalized)) return "Word";
  return "Text";
}

export function formatFileSize(sizeBytes: number): string {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${Math.floor(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function inferScalarType(raw: unknown): Exclude<InferredScalarType, "mixed"> {
  if (raw === null || raw === undefined || raw === "") return "empty";
  if (typeof raw === "number" && Number.isFinite(raw)) return "number";
  if (typeof raw === "boolean") return "boolean";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "empty";
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) return "date";
    const numberLike = Number(trimmed.replace(/,/g, ""));
    if (Number.isFinite(numberLike) && trimmed !== "") return "number";
    if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
      return "boolean";
    }
    return "string";
  }
  return "string";
}

function inferColumnType(values: unknown[]): InferredScalarType {
  const counter: Record<string, number> = {
    number: 0,
    boolean: 0,
    date: 0,
    string: 0,
    empty: 0,
  };
  for (const value of values) {
    counter[inferScalarType(value)] += 1;
  }
  const nonEmptyKinds = (["number", "boolean", "date", "string"] as const).filter(
    (key) => counter[key] > 0
  );
  if (nonEmptyKinds.length === 0) return "empty";
  if (nonEmptyKinds.length > 1) return "mixed";
  return nonEmptyKinds[0];
}

function toSampleValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "string") return raw.slice(0, 120);
  return String(raw).slice(0, 120);
}

function truncateTextCell(value: string): string {
  return value.length > MAX_TEXT_CELL_CHARS ? `${value.slice(0, MAX_TEXT_CELL_CHARS)}…` : value;
}

function normalizeObjectRow(value: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = String(key || "").trim() || "value";
    if (typeof raw === "string") {
      row[normalizedKey] = truncateTextCell(raw);
    } else if (raw && typeof raw === "object") {
      row[normalizedKey] = JSON.stringify(raw).slice(0, MAX_TEXT_CELL_CHARS);
    } else {
      row[normalizedKey] = normalizeCellValue(raw);
    }
  }
  return row;
}

function normalizeArrayRows(rows: unknown[]): Record<string, unknown>[] {
  const normalized: Record<string, unknown>[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      normalized.push(normalizeObjectRow(item as Record<string, unknown>));
      continue;
    }
    if (Array.isArray(item)) {
      const row: Record<string, unknown> = {};
      for (let col = 0; col < item.length; col += 1) {
        row[`column_${col + 1}`] = normalizeCellValue(item[col]);
      }
      normalized.push(row);
      continue;
    }
    normalized.push({
      index: index + 1,
      value: normalizeCellValue(item),
    });
  }
  return normalized;
}

function pickRowsFromUnknownJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return normalizeArrayRows(value);
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const candidateArrays = Object.entries(objectValue)
      .filter(([, field]) => Array.isArray(field))
      .map(([key, field]) => ({
        key,
        rows: normalizeArrayRows(field as unknown[]),
      }))
      .filter((item) => item.rows.length > 0)
      .sort((a, b) => b.rows.length - a.rows.length);
    if (candidateArrays.length > 0) {
      return candidateArrays[0].rows;
    }
    return Object.entries(objectValue).map(([key, raw]) => {
      if (typeof raw === "string") {
        return {
          key,
          value: truncateTextCell(raw),
        };
      }
      if (raw && typeof raw === "object") {
        return {
          key,
          value: JSON.stringify(raw).slice(0, MAX_TEXT_CELL_CHARS),
        };
      }
      return {
        key,
        value: normalizeCellValue(raw),
      };
    });
  }
  return [{ value: normalizeCellValue(value) }];
}

export function parseRowsFromJsonText(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text);
    return pickRowsFromUnknownJson(parsed);
  } catch {
    return [{ value: truncateTextCell(text.trim()) }];
  }
}

export function parseRowsFromText(text: string): Record<string, unknown>[] {
  if (text.length === 0) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u0000/g, ""))
    .slice(0, MAX_TEXT_ROWS);
  return lines.map((line, index) => ({
    line: index + 1,
    content: truncateTextCell(line),
  }));
}

async function parsePdfBuffer(buffer: Buffer): Promise<{
  text: string;
  pageCount?: number;
}> {
  type PdfParseResult = {
    text?: string;
    numpages?: number;
  };
  type PdfParseFn = (data: Buffer) => Promise<PdfParseResult>;
  type Pdf2JsonTextRun = {
    T?: string;
  };
  type Pdf2JsonTextItem = {
    R?: Pdf2JsonTextRun[];
    x?: number;
    y?: number;
  };
  type Pdf2JsonPage = {
    Texts?: Pdf2JsonTextItem[];
  };
  type Pdf2JsonData = {
    Pages?: Pdf2JsonPage[];
  };
  type Pdf2JsonError = {
    parserError?: Error | string;
  };
  type Pdf2JsonParser = {
    on: (event: string, listener: (payload: unknown) => void) => void;
    parseBuffer: (data: Buffer) => void;
  };
  type Pdf2JsonCtor = new (context?: unknown, verbosity?: number) => Pdf2JsonParser;

  function decodePdf2JsonToken(raw: string): string {
    const normalized = raw.replace(/\+/g, " ");
    try {
      return decodeURIComponent(normalized);
    } catch {
      return normalized;
    }
  }

  function textFromPdf2JsonData(data: Pdf2JsonData): string {
    const pages = Array.isArray(data.Pages) ? data.Pages : [];
    const pageTexts = pages.map((page) => {
      const texts = Array.isArray(page.Texts) ? page.Texts : [];
      const sorted = [...texts].sort((left, right) => {
        const yDiff = Number(left.y ?? 0) - Number(right.y ?? 0);
        if (Math.abs(yDiff) > 0.001) return yDiff;
        return Number(left.x ?? 0) - Number(right.x ?? 0);
      });
      return sorted
        .map((item) =>
          (Array.isArray(item.R) ? item.R : [])
            .map((run) => decodePdf2JsonToken(String(run.T || "")))
            .join("")
        )
        .filter(Boolean)
        .join("\n");
    });
    return pageTexts.filter(Boolean).join("\n\n");
  }

  async function parseByPdfParse(): Promise<{ text: string; pageCount?: number }> {
    const pdfParseModule = (await import("pdf-parse")) as unknown as { default?: PdfParseFn };
    const pdfParseFn = pdfParseModule.default;
    if (!pdfParseFn) {
      throw new Error("pdf-parse 加载失败");
    }
    const parsed = await pdfParseFn(buffer);
    return {
      text: String(parsed.text || ""),
      pageCount: Number.isFinite(parsed.numpages) ? Number(parsed.numpages) : undefined,
    };
  }

  async function parseByPdf2Json(): Promise<{ text: string; pageCount?: number }> {
    const pdf2jsonModule = (await import("pdf2json")) as unknown as { default?: Pdf2JsonCtor };
    const Pdf2Json = pdf2jsonModule.default;
    if (!Pdf2Json) {
      throw new Error("pdf2json 加载失败");
    }
    const parser = new Pdf2Json(null, 0);
    const data = await new Promise<Pdf2JsonData>((resolve, reject) => {
      parser.on("pdfParser_dataReady", (payload) => resolve(payload as Pdf2JsonData));
      parser.on("pdfParser_dataError", (payload) => {
        const parsed = payload as Pdf2JsonError;
        const parserError = parsed?.parserError;
        reject(
          parserError instanceof Error
            ? parserError
            : new Error(String(parserError || "pdf2json 解析失败"))
        );
      });
      parser.parseBuffer(buffer);
    });
    const pages = Array.isArray(data.Pages) ? data.Pages : [];
    return {
      text: textFromPdf2JsonData(data),
      pageCount: pages.length > 0 ? pages.length : undefined,
    };
  }

  const errors: string[] = [];
  try {
    return await parseByPdfParse();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "pdf-parse 解析失败");
  }

  try {
    return await parseByPdf2Json();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "pdf2json 解析失败");
  }

  throw new Error(`pdf 解析失败：${errors.join("；")}`);
}

async function parseWordBuffer(buffer: Buffer): Promise<string> {
  type MammothModule = {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
  };
  const mammoth = (await import("mammoth")) as unknown as MammothModule;
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || "");
}

async function parseRowsFromNonSpreadsheetBuffer(
  extension: string,
  buffer: Buffer
): Promise<{
  sheetName: string;
  rows: Record<string, unknown>[];
  analysisMeta: FileAnalysisMeta;
}> {
  const normalizedExtension = (extension || "").toLowerCase();
  const sheetName = defaultSheetNameForExtension(normalizedExtension);

  if (normalizedExtension === ".json") {
    const text = decodeBufferText(buffer);
    return {
      sheetName,
      rows: parseRowsFromJsonText(text),
      analysisMeta: buildTextAnalysisMeta("json", text),
    };
  }

  if (normalizedExtension === ".txt") {
    const text = decodeBufferText(buffer);
    return {
      sheetName,
      rows: parseRowsFromText(text),
      analysisMeta: buildTextAnalysisMeta("text", text),
    };
  }

  if (normalizedExtension === ".md") {
    const text = decodeBufferText(buffer);
    return {
      sheetName,
      rows: parseRowsFromText(text),
      analysisMeta: buildTextAnalysisMeta("markdown", text),
    };
  }

  if (normalizedExtension === ".pdf") {
    const parsed = await parsePdfBuffer(buffer);
    const text = parsed.text || "";
    return {
      sheetName,
      rows: parseRowsFromText(text),
      analysisMeta: buildTextAnalysisMeta("pdf", text, { pageCount: parsed.pageCount }),
    };
  }

  if (WORD_EXTENSIONS.has(normalizedExtension)) {
    let text = "";
    try {
      text = await parseWordBuffer(buffer);
    } catch {
      // 兼容老式 .doc 文件：提取失败时退化为 utf8 文本读取。
      text = decodeBufferText(buffer);
    }
    return {
      sheetName,
      rows: parseRowsFromText(text),
      analysisMeta: buildTextAnalysisMeta("word", text),
    };
  }

  throw new Error(`不支持的文件扩展名: ${normalizedExtension || "(empty)"}`);
}

export function readWorkbookFromBuffer(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    dense: false,
    cellText: true,
  });
}

export async function readWorkbookFromFile(filePath: string): Promise<XLSX.WorkBook> {
  const raw = await fs.readFile(filePath);
  return readWorkbookFromBuffer(raw);
}

function getSheetOrThrow(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`工作表不存在: ${sheetName}`);
  }
  return sheet;
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  return Array.isArray(matrix) ? matrix : [];
}

function resolveHeaders(headerCells: unknown[], fallbackColumnCount: number): string[] {
  const source = Array.isArray(headerCells) ? headerCells : [];
  const count = Math.max(source.length, fallbackColumnCount);
  const names: string[] = [];
  const used = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const raw = source[index];
    const preferred = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    let name = preferred || `column_${index + 1}`;
    while (used.has(name)) {
      name = `${name}_${index + 1}`;
    }
    used.add(name);
    names.push(name);
  }
  return names;
}

function matrixToRows(matrix: unknown[][], headers: string[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const rawRow = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const row: Record<string, unknown> = {};
    let hasAnyValue = false;
    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const value = normalizeCellValue(rawRow[colIndex]);
      if (value !== null && value !== "") hasAnyValue = true;
      row[headers[colIndex]] = value;
    }
    if (hasAnyValue) {
      rows.push(row);
    }
  }
  return rows;
}

export function getSheetHeaders(workbook: XLSX.WorkBook, sheetName: string): string[] {
  const sheet = getSheetOrThrow(workbook, sheetName);
  const matrix = sheetToMatrix(sheet);
  const headerCells = matrix[0] ?? [];
  const fallbackWidth =
    matrix.length > 1 && Array.isArray(matrix[1]) ? (matrix[1] as unknown[]).length : 0;
  return resolveHeaders(headerCells, fallbackWidth);
}

export function parseSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string
): Record<string, unknown>[] {
  const sheet = getSheetOrThrow(workbook, sheetName);
  const matrix = sheetToMatrix(sheet);
  if (matrix.length === 0) return [];
  const headers = resolveHeaders(
    matrix[0] ?? [],
    matrix.length > 1 && Array.isArray(matrix[1]) ? (matrix[1] as unknown[]).length : 0
  );
  return matrixToRows(matrix, headers);
}

function cropColumnsInRows(
  rows: Record<string, unknown>[],
  headers: string[],
  columnLimit: number
): { headers: string[]; rows: Record<string, unknown>[] } {
  const selectedHeaders = headers.slice(0, Math.max(1, columnLimit));
  const croppedRows = rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const header of selectedHeaders) {
      next[header] = normalizeCellValue(row[header]);
    }
    return next;
  });
  return { headers: selectedHeaders, rows: croppedRows };
}

function buildColumnSchema(headers: string[], previewRows: Record<string, unknown>[]): SchemaColumn[] {
  if (headers.length === 0) return [];
  return headers.map((header) => {
    const values = previewRows.map((row) => row[header]);
    const nonEmptyCount = values.filter((value) => value !== null && value !== "").length;
    const emptyCount = Math.max(values.length - nonEmptyCount, 0);
    const sampleValues = Array.from(
      new Set(values.map((value) => toSampleValue(value)).filter(Boolean))
    ).slice(0, 5);
    return {
      name: header,
      inferredType: inferColumnType(values),
      nonEmptyCount,
      emptyCount,
      emptyRatio: values.length === 0 ? 0 : Number((emptyCount / values.length).toFixed(3)),
      sampleValues,
    };
  });
}

function deriveHeadersFromRows(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const set = new Set<string>();
  const upperBound = Math.min(rows.length, 500);
  for (let idx = 0; idx < upperBound; idx += 1) {
    const row = rows[idx];
    for (const key of Object.keys(row)) {
      const normalized = String(key || "").trim();
      if (!normalized) continue;
      set.add(normalized);
      if (set.size >= 500) {
        break;
      }
    }
    if (set.size >= 500) break;
  }
  return Array.from(set);
}

export function buildSheetProfileFromRows(
  sheetName: string,
  sourceRows: Record<string, unknown>[]
): SheetProfile {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  const headers = deriveHeadersFromRows(rows);
  const previewRows = rows.slice(0, EXCEL_SANDBOX_PREVIEW_ROW_LIMIT);
  const { headers: previewHeaders, rows: previewRowsCropped } = cropColumnsInRows(
    previewRows,
    headers,
    EXCEL_SANDBOX_PREVIEW_COLUMN_LIMIT
  );
  const columnSchema = buildColumnSchema(previewHeaders, previewRowsCropped);
  return {
    sheetName,
    totalRows: rows.length,
    totalColumns: headers.length,
    headers,
    columns: columnSchema,
    previewRows: previewRowsCropped,
  };
}

export function buildSheetProfile(workbook: XLSX.WorkBook, sheetName: string): SheetProfile {
  const rows = parseSheetRows(workbook, sheetName);
  return buildSheetProfileFromRows(sheetName, rows);
}

export function buildWorkbookProfiles(workbook: XLSX.WorkBook): Record<string, SheetProfile> {
  const profiles: Record<string, SheetProfile> = {};
  for (const sheetName of workbook.SheetNames) {
    profiles[sheetName] = buildSheetProfile(workbook, sheetName);
  }
  return profiles;
}

export async function buildFileProfilesFromBuffer(
  buffer: Buffer,
  extension: string
): Promise<{
  sheetNames: string[];
  profiles: Record<string, SheetProfile>;
  analysisMeta: FileAnalysisMeta;
}> {
  const normalizedExtension = (extension || "").toLowerCase();
  if (isSpreadsheetExtension(normalizedExtension)) {
    const workbook = readWorkbookFromBuffer(buffer);
    return {
      sheetNames: workbook.SheetNames,
      profiles: buildWorkbookProfiles(workbook),
      analysisMeta: {
        parser: "spreadsheet",
      },
    };
  }

  const parsed = await parseRowsFromNonSpreadsheetBuffer(normalizedExtension, buffer);
  return {
    sheetNames: [parsed.sheetName],
    profiles: {
      [parsed.sheetName]: buildSheetProfileFromRows(parsed.sheetName, parsed.rows),
    },
    analysisMeta: parsed.analysisMeta,
  };
}

export async function readRowsFromStoredFile(
  filePath: string,
  extension: string,
  preferredSheetName?: string
): Promise<{ rows: Record<string, unknown>[]; sheetName: string }> {
  const normalizedExtension = (extension || "").toLowerCase();
  if (isSpreadsheetExtension(normalizedExtension)) {
    const workbook = await readWorkbookFromFile(filePath);
    const sheetName =
      preferredSheetName && workbook.SheetNames.includes(preferredSheetName)
        ? preferredSheetName
        : workbook.SheetNames[0];
    if (!sheetName) {
      return { rows: [], sheetName: preferredSheetName || "Sheet1" };
    }
    return {
      rows: parseSheetRows(workbook, sheetName),
      sheetName,
    };
  }

  const raw = await fs.readFile(filePath);
  const parsed = await parseRowsFromNonSpreadsheetBuffer(normalizedExtension, raw);
  return { rows: parsed.rows, sheetName: parsed.sheetName };
}

function uniqueIncreasing(values: number[], maxExclusive: number): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const normalized = Math.min(Math.max(value, 0), maxExclusive - 1);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  result.sort((a, b) => a - b);
  return result;
}

export function pickRowIndexes(
  totalRows: number,
  rowLimit: number,
  strategy: SamplingStrategy
): number[] {
  if (totalRows <= 0) return [];
  const limit = Math.min(Math.max(rowLimit, 1), totalRows, EXCEL_SANDBOX_MAX_SAMPLE_ITEMS);
  if (strategy === "head" || totalRows <= limit) {
    return Array.from({ length: limit }, (_, index) => index);
  }
  if (limit === 1) return [0];
  const rough = Array.from({ length: limit }, (_, i) =>
    Math.round((i * (totalRows - 1)) / (limit - 1))
  );
  const deduped = uniqueIncreasing(rough, totalRows);
  if (deduped.length === limit) return deduped;
  const filler: number[] = [...deduped];
  for (let idx = 0; idx < totalRows && filler.length < limit; idx += 1) {
    if (!filler.includes(idx)) filler.push(idx);
  }
  filler.sort((a, b) => a - b);
  return filler.slice(0, limit);
}

export function applySampling(
  rows: Record<string, unknown>[],
  headers: string[],
  sampling: SamplingConfig
): { rows: Record<string, unknown>[]; indexes: number[]; selectedHeaders: string[] } {
  const rowIndexes = pickRowIndexes(rows.length, sampling.rowLimit, sampling.strategy);
  const sampledRows = rowIndexes.map((index) => rows[index]);
  const selectedHeaders = headers.slice(
    0,
    Math.min(Math.max(sampling.columnLimit, 1), EXCEL_SANDBOX_MAX_SAMPLE_ITEMS)
  );
  const croppedRows = sampledRows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const header of selectedHeaders) {
      next[header] = normalizeCellValue(row[header]);
    }
    return next;
  });
  return {
    rows: croppedRows,
    indexes: rowIndexes,
    selectedHeaders,
  };
}
