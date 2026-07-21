export const MEBIBYTE = 1024 * 1024;

export const EXCEL_SANDBOX_LIMITS = Object.freeze({
  maxFileBytes: 30 * MEBIBYTE,
  maxTotalBytes: 80 * MEBIBYTE,
  maxFiles: 10,
  allowedExtensions: Object.freeze([
    ".xlsx",
    ".xls",
    ".csv",
    ".tsv",
    ".json",
    ".txt",
    ".md",
    ".pdf",
    ".doc",
    ".docx",
  ]),
});

export const WORD_DOCUMENT_EXTENSIONS = Object.freeze([
  ".doc",
  ".docx",
  ".txt",
  ".md",
]);

export const CONVERTER_AUDIO_EXTENSIONS = Object.freeze([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
]);

export const CONVERTER_AUDIO_MAX_BYTES = 50 * MEBIBYTE;

export const OFFICE_FILE_POLICIES = Object.freeze({
  ppt: Object.freeze({
    summary:
      "PPT artifacts use the shared durable artifact library; the legacy frontend has no dedicated upload route.",
    maxFileBytes: null,
  }),
  excel: Object.freeze({
    summary:
      "Up to 10 files, 30 MiB per file and 80 MiB total in one sandbox upload.",
    maxFileBytes: EXCEL_SANDBOX_LIMITS.maxFileBytes,
    maxTotalBytes: EXCEL_SANDBOX_LIMITS.maxTotalBytes,
    maxFiles: EXCEL_SANDBOX_LIMITS.maxFiles,
  }),
  word: Object.freeze({
    summary:
      "The document parser accepts DOC, DOCX, TXT and Markdown; the legacy route declares no byte cap.",
    maxFileBytes: null,
  }),
  converter: Object.freeze({
    summary:
      "Only ASR audio uploads are accepted and each file is limited to 50 MiB.",
    maxFileBytes: CONVERTER_AUDIO_MAX_BYTES,
  }),
  resume: Object.freeze({
    summary:
      "Resume artifacts use the shared durable artifact library; the legacy frontend has no dedicated upload route.",
    maxFileBytes: null,
  }),
});
