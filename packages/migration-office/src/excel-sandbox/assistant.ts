import { gatewayChat, GatewayAuthError } from "./gateway";
import { EXCEL_SANDBOX_MAX_SAMPLE_ITEMS } from "./constants";
import { normalizeSamplingConfig } from "./workbook";
import type {
  ClarifyingQuestionSet,
  FileAnalysisMeta,
  GeneratedPythonPlan,
  PythonPlanDecision,
  SamplingConfig,
  SheetProfile,
} from "./types";

// In LeoSheet the LLM is always reachable via the OceanLeo gateway (platform
// key mode), as long as we have the signed-in user's bearer token. The API
// route extracts the token from the Authorization header and threads it in.
const GATEWAY_MODEL_TAG = "oceanleo-gateway";

interface GeneratePythonPlanInput {
  token: string | null;
  requirement: string;
  answers?: string;
  sampling?: Partial<SamplingConfig> | null;
  targetFileId: string;
  targetFileName: string;
  targetSheetName: string;
  files: Array<{
    fileId: string;
    fileName: string;
    extension: string;
    sizeBytes: number;
    analysisMeta?: FileAnalysisMeta;
    sheetName: string;
    profile: SheetProfile;
  }>;
}

function tryParseJson<T>(raw: string): T | null {
  const text = raw.trim();
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatBytes(sizeBytes: number): string {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${Math.floor(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildSchemaDigest(profile: SheetProfile): string {
  const sampledHeaders = profile.headers.slice(0, 12);
  const sampledColumns = sampledHeaders
    .map((header) => profile.columns.find((column) => column.name === header))
    .filter(Boolean) as SheetProfile["columns"];

  const headerDigest = sampledHeaders.length > 0 ? sampledHeaders.join(" | ") : "(none)";
  const columnDigest = sampledColumns
    .map((column) => {
      const samples = column.sampleValues.length > 0 ? column.sampleValues.join(" | ") : "(空)";
      return `- ${column.name} | type=${column.inferredType} | nonEmpty=${column.nonEmptyCount} | samples=${samples}`;
    })
    .join("\n");

  const previewRows = profile.previewRows
    .slice(0, 12)
    .map((row, index) => {
      const cells = sampledHeaders
        .map((header) => `${header}: ${stringifyCell(row[header])}`)
        .join(", ");
      return `${index + 1}. ${cells}`;
    })
    .join("\n");

  return [
    `sheetName: ${profile.sheetName}`,
    `totalRows: ${profile.totalRows}`,
    `totalColumns: ${profile.totalColumns}`,
    `headersTop12: ${headerDigest}`,
    "columns:",
    columnDigest || "(no columns)",
    "previewRowsTop12:",
    previewRows || "(no preview rows)",
  ].join("\n");
}

function buildFileDigest(
  item: GeneratePythonPlanInput["files"][number],
  isTarget: boolean
): string {
  const meta = item.analysisMeta ?? { parser: "unknown" as const };
  return [
    `target: ${isTarget ? "yes" : "no"}`,
    `fileId: ${item.fileId}`,
    `fileName: ${item.fileName}`,
    `extension: ${item.extension}`,
    `size: ${formatBytes(item.sizeBytes)}`,
    `parser: ${meta.parser}`,
    `pageCount: ${meta.pageCount ?? "n/a"}`,
    `textCharCount: ${meta.textCharCount ?? "n/a"}`,
    `wordCount: ${meta.wordCount ?? "n/a"}`,
    `lineCount: ${meta.lineCount ?? "n/a"}`,
    `sheet: ${item.sheetName}`,
    buildSchemaDigest(item.profile),
  ].join("\n");
}

function normalizeDecision(raw: unknown): PythonPlanDecision {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (text === "direct_answer" || text === "direct") {
    return "direct_answer";
  }
  return "python";
}

function estimateAutoSampling(
  input: GeneratePythonPlanInput,
  targetProfile: SheetProfile
): SamplingConfig {
  const targetFile = input.files.find((item) => item.fileId === input.targetFileId) ?? input.files[0];
  const rows = Number(targetProfile.totalRows || 0);
  const cols = Number(targetProfile.totalColumns || 0);
  const lineCount = Number(targetFile?.analysisMeta?.lineCount || 0);
  const textChars = Number(targetFile?.analysisMeta?.textCharCount || 0);

  let strategy: SamplingConfig["strategy"] = "head";
  let rowLimit = 30;
  let columnLimit = 18;

  if (rows > 0) {
    if (rows <= 30) {
      strategy = "head";
      rowLimit = Math.max(10, rows);
    } else if (rows <= 300) {
      strategy = "head";
      rowLimit = 25;
    } else if (rows <= 3000) {
      strategy = "interval";
      rowLimit = 45;
    } else {
      strategy = "interval";
      rowLimit = 35;
    }

    if (cols > 0) {
      if (cols <= 8) {
        columnLimit = cols;
      } else if (cols <= 24) {
        columnLimit = 14;
      } else if (cols <= 80) {
        columnLimit = 18;
      } else {
        columnLimit = 12;
      }
    }
  } else if (lineCount > 0 || textChars > 0) {
    if (lineCount <= 80 && textChars <= 15_000) {
      strategy = "head";
      rowLimit = Math.max(12, Math.min(lineCount || 18, 40));
    } else if (lineCount <= 1000 && textChars <= 200_000) {
      strategy = "interval";
      rowLimit = 40;
    } else {
      strategy = "interval";
      rowLimit = 30;
    }
    columnLimit = 8;
  }

  return normalizeSamplingConfig({
    strategy,
    rowLimit,
    columnLimit,
  });
}

function fallbackQuestions(profile: SheetProfile): string[] {
  const dateColumns = profile.columns.filter((column) => column.inferredType === "date");
  const numericColumns = profile.columns.filter((column) => column.inferredType === "number");
  const textColumns = profile.columns.filter((column) => column.inferredType === "string");
  const questions: string[] = [];
  questions.push("这份表格你最关心的业务目标是什么（例如趋势分析、异常检测、对比排名）？");
  if (dateColumns.length > 0) {
    questions.push(`是否需要按时间维度分析？建议选择时间列：${dateColumns[0].name}`);
  }
  if (numericColumns.length > 0) {
    questions.push(`希望重点计算哪些指标列？例如：${numericColumns.slice(0, 3).map((c) => c.name).join("、")}`);
  }
  if (textColumns.length > 0) {
    questions.push(`是否按类别分组？可选维度示例：${textColumns.slice(0, 3).map((c) => c.name).join("、")}`);
  }
  return questions.slice(0, 4);
}

function extractHeadTrimRowCount(requirement: string): number | null {
  const normalized = requirement.trim();
  if (!normalized) return null;

  const rangeMatch =
    normalized.match(/line\s*=?\s*1\s*(?:-|~|～|—|to)\s*(\d{1,6})/i) ||
    normalized.match(/行号\s*=?\s*1\s*(?:-|~|～|—|到)\s*(\d{1,6})/i);
  if (rangeMatch?.[1]) {
    const value = Number(rangeMatch[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 500_000) {
      return Math.floor(value);
    }
  }

  const actionLike = /(去掉|删除|移除|剔除|drop|remove)/i.test(normalized);
  if (!actionLike) return null;

  const countMatch = normalized.match(
    /(?:前|头部|开头|头)\s*(\d{1,6})\s*(?:行|条|rows?|lines?|records?)/i
  );
  if (!countMatch?.[1]) return null;
  const value = Number(countMatch[1]);
  if (!Number.isFinite(value) || value < 1 || value > 500_000) return null;
  return Math.floor(value);
}


function shouldReindexLine(requirement: string): boolean {
  const normalized = requirement.toLowerCase();
  const keepOriginal = /(保留原始行号|不重排|不重新编号|keep original|do not reindex)/i.test(normalized);
  if (keepOriginal) return false;
  return /(重新编号|重排|连续编号|从\s*1\s*开始|reindex|renumber)/i.test(normalized);
}

function buildDeleteHeadRowsCode(rowCount: number, reindexLine: boolean): string {
  return [
    "def _to_int(value):",
    "    if value is None:",
    "        return None",
    "    if isinstance(value, bool):",
    "        return None",
    "    if isinstance(value, int):",
    "        return value",
    "    text = str(value).strip()",
    "    if not text:",
    "        return None",
    "    try:",
    "        return int(float(text))",
    "    except ValueError:",
    "        return None",
    "",
    "def process(rows, mode, context, files=None):",
    "    source_rows = rows if isinstance(rows, list) else []",
    `    remove_before_or_equal = ${rowCount}`,
    `    should_reindex = ${reindexLine ? "True" : "False"}`,
    "    kept_rows = []",
    "    for idx, item in enumerate(source_rows, start=1):",
    "        if not isinstance(item, dict):",
    "            continue",
    "        line_value = _to_int(item.get('line'))",
    "        effective_line = line_value if line_value is not None else idx",
    "        if effective_line <= remove_before_or_equal:",
    "            continue",
    "        kept_rows.append(dict(item))",
    "",
    "    if should_reindex:",
    "        for idx, item in enumerate(kept_rows, start=1):",
    "            item['line'] = idx",
    "",
    "    removed_count = max(0, len(source_rows) - len(kept_rows))",
    "    summary = f'已删除前{remove_before_or_equal}行（实际删除 {removed_count} 行），剩余 {len(kept_rows)} 行。'",
    "    if should_reindex:",
    "        summary += ' line 已按 1..N 连续重排。'",
    "    else:",
    "        summary += ' 已保留原始 line 行号。'",
    "",
    "    return {",
    "        'summary': summary,",
    "        'rows': kept_rows[:100],",
    "        'file_rows': kept_rows,",
    "    }",
  ].join("\n");
}


function tryBuildRuleBasedPlan(
  input: GeneratePythonPlanInput,
  sampling: SamplingConfig
): GeneratedPythonPlan | null {
  const headTrimRows = extractHeadTrimRowCount(input.requirement);
  if (!headTrimRows) return null;

  const reindexLine = shouldReindexLine(input.requirement);
  const code = buildDeleteHeadRowsCode(headTrimRows, reindexLine);
  const directAnswer = reindexLine
    ? `已确定执行：删除前 ${headTrimRows} 行，并将剩余记录的 line 字段重新从 1 连续编号。`
    : `已确定执行：删除前 ${headTrimRows} 行，并保留剩余记录的原始 line 行号。`;

  return {
    decision: "direct_answer",
    directAnswer,
    pythonCode: code,
    notes: "命中快速处理规则：删除前 N 行。已直接生成可执行程序并可自动运行。",
    suggestedSampling: normalizeSamplingConfig({
      strategy: "head",
      rowLimit: Math.min(100, Math.max(15, headTrimRows + 5)),
      columnLimit: sampling.columnLimit,
    }),
    followUpQuestions: [],
  };
}

function fallbackPythonCode(requirement: string, sampling: SamplingConfig): string {
  const escapedRequirement = requirement.replace(/\r?\n/g, " ").trim();
  return [
    "from collections import defaultdict",
    "",
    "def _to_float(value):",
    "    if value is None:",
    "        return None",
    "    if isinstance(value, (int, float)):",
    "        return float(value)",
    "    text = str(value).strip().replace(',', '')",
    "    if not text:",
    "        return None",
    "    try:",
    "        return float(text)",
    "    except ValueError:",
    "        return None",
    "",
    "def process(rows, mode, context, files=None):",
    "    # rows: 主数据集 list[dict]；files: 其他文件数据",
    "    if not isinstance(rows, list):",
    "        return {'summary': '输入 rows 不是列表', 'rows': []}",
    "",
    "    if len(rows) == 0:",
    "        return {'summary': '当前数据为空', 'rows': []}",
    "",
    "    files = files if isinstance(files, list) else []",
    "    numeric_candidates = []",
    "    sample_row = rows[0] if isinstance(rows[0], dict) else {}",
    "    for key in sample_row.keys():",
    "        values = [_to_float(item.get(key)) for item in rows if isinstance(item, dict)]",
    "        valid = [v for v in values if v is not None]",
    "        if len(valid) >= max(3, len(rows) // 5):",
    "            numeric_candidates.append(key)",
    "",
    "    summary_lines = []",
    `    summary_lines.append('需求描述: ${escapedRequirement || '未提供'}')`,
    "    summary_lines.append(f\"模式: {mode}\")",
    "    summary_lines.append(f\"主数据输入行数: {len(rows)}\")",
    "    summary_lines.append(f\"上传文件数量: {len(files)}\")",
    `    summary_lines.append('默认抽样策略: ${sampling.strategy}, rowLimit=${sampling.rowLimit}, columnLimit=${sampling.columnLimit}')`,
    "",
    "    metrics = {'file_count': len(files), 'main_rows': len(rows)}",
    "    if numeric_candidates:",
    "        target = numeric_candidates[0]",
    "        numeric_values = [_to_float(item.get(target)) for item in rows if isinstance(item, dict)]",
    "        numeric_values = [v for v in numeric_values if v is not None]",
    "        if numeric_values:",
    "            metrics[target] = {",
    "                'count': len(numeric_values),",
    "                'min': min(numeric_values),",
    "                'max': max(numeric_values),",
    "                'avg': round(sum(numeric_values) / len(numeric_values), 4),",
    "            }",
    "            summary_lines.append(f\"已计算数值列 {target} 的基础统计\")",
    "",
    "    preview_rows = rows[:100]",
    "    chart = None",
    "    if numeric_candidates:",
    "        chart_col = numeric_candidates[0]",
    "        chart_rows = []",
    "        for idx, row in enumerate(rows[:30], start=1):",
    "            value = _to_float(row.get(chart_col)) if isinstance(row, dict) else None",
    "            if value is None:",
    "                continue",
    "            chart_rows.append({'x': idx, 'y': value})",
    "        if chart_rows:",
    "            chart = {",
    "                'type': 'line',",
    "                'title': f'{chart_col} 样本走势',",
    "                'xField': 'x',",
    "                'yField': 'y',",
    "                'rows': chart_rows,",
    "            }",
    "",
    "    # 如需跨文件处理，可在 files 中遍历每个文件：",
    "    # {'fileId','fileName','sheetName','rows','sourceRowsCount', ...}",
    "    return {",
    "        'summary': '\\n'.join(summary_lines),",
    "        'rows': preview_rows,",
    "        'file_rows': rows,",
    "        'metrics': metrics,",
    "        'chart': chart,",
    "    }",
    "",
    "# 可选：如果你希望自定义 sample 抽样，可定义 extract_sample(rows, context[, files])。",
    `# 系统会限制 sample 行数 <= ${EXCEL_SANDBOX_MAX_SAMPLE_ITEMS}。`,
  ].join("\n");
}

function buildFallbackRequirementAnalysis(input: GeneratePythonPlanInput, sampling: SamplingConfig): string {
  const targetFile = input.files.find((item) => item.fileId === input.targetFileId) ?? input.files[0];
  const profile = targetFile?.profile;
  const rows = Number(profile?.totalRows || 0);
  const cols = Number(profile?.totalColumns || 0);
  const requirement = input.requirement.trim().replace(/\s+/g, " ").slice(0, 180);
  const scaleLabel =
    rows <= 0
      ? "文本/半结构化数据"
      : rows > 10_000
        ? "大规模表格数据"
        : rows > 1_000
          ? "中等规模表格数据"
          : "小规模表格数据";
  return [
    `已识别目标：${targetFile?.fileName || input.targetFileName} / ${profile?.sheetName || input.targetSheetName}。`,
    `数据规模判断：${scaleLabel}（约 ${rows} 行，${cols} 列），建议采用 ${sampling.strategy === "interval" ? "等间隔抽样" : "头部抽样"} 进行快速验证。`,
    `需求理解：${requirement || "未提供明确需求"}。下一步将基于该理解生成可执行 Python，并对上传文件进行处理。`,
  ].join("\n");
}

function normalizeQuestionList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const list = raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return list.length > 0 ? list : fallback;
}

export async function generateClarifyingQuestions(
  profile: SheetProfile,
  token: string | null
): Promise<ClarifyingQuestionSet> {
  const fallback = fallbackQuestions(profile);
  if (!token) return { questions: fallback };

  const systemPrompt = [
    "你是 Excel 数据分析问答助手。",
    "你会根据给定的表结构和前几十行样本，生成 2-4 个澄清问题。",
    "问题必须帮助用户明确：目标指标、分组维度、时间范围、输出方式（表格/图表）。",
    "只输出 JSON：{\"questions\":[\"...\", \"...\"]}",
  ].join("\n");

  let raw = "";
  try {
    raw = await gatewayChat({
      token,
      siteId: "excel",
      system: systemPrompt,
      messages: [{ role: "user", content: buildSchemaDigest(profile) }],
      maxTokens: 800,
    });
  } catch (error) {
    if (error instanceof GatewayAuthError) throw error;
    return { questions: fallback };
  }

  const parsed = tryParseJson<{ questions?: unknown }>(raw);
  const questions = normalizeQuestionList(parsed?.questions, fallback);
  return {
    questions,
    usedProvider: "oceanleo",
    usedModel: GATEWAY_MODEL_TAG,
  };
}

function parsePythonCode(rawText: string): string | null {
  const jsonParsed = tryParseJson<{ pythonCode?: unknown }>(rawText);
  if (jsonParsed?.pythonCode && typeof jsonParsed.pythonCode === "string") {
    return jsonParsed.pythonCode.trim();
  }
  const fencedMatch = rawText.match(/```python\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  return null;
}

export async function generatePythonPlan(
  input: GeneratePythonPlanInput
): Promise<GeneratedPythonPlan> {
  const targetFile = input.files.find((item) => item.fileId === input.targetFileId) ?? input.files[0];
  const targetProfile: SheetProfile = targetFile?.profile ?? {
    sheetName: input.targetSheetName || "Sheet1",
    totalRows: 0,
    totalColumns: 0,
    headers: [],
    columns: [],
    previewRows: [],
  };
  const autoSampling = estimateAutoSampling(input, targetProfile);
  const normalizedSampling = input.sampling ? normalizeSamplingConfig(input.sampling) : autoSampling;
  const fallbackQuestionsList = fallbackQuestions(targetProfile);
  const fallbackCode = fallbackPythonCode(input.requirement, normalizedSampling);
  const ruleBasedPlan = tryBuildRuleBasedPlan(input, normalizedSampling);
  if (ruleBasedPlan) {
    return ruleBasedPlan;
  }
  if (!input.token) {
    return {
      decision: "python",
      directAnswer: buildFallbackRequirementAnalysis(input, normalizedSampling),
      pythonCode: fallbackCode,
      notes: "未登录或登录已过期，已返回本地模板代码。请登录后重试以使用 AI 生成。",
      suggestedSampling: normalizedSampling,
      followUpQuestions: fallbackQuestionsList,
    };
  }

  const fileDigest = input.files
    .map((item) => buildFileDigest(item, item.fileId === input.targetFileId))
    .join("\n\n---\n\n");
  const userDescription = [
    `targetFileId: ${input.targetFileId}`,
    `targetFileName: ${input.targetFileName}`,
    `targetSheetName: ${input.targetSheetName}`,
    `requirement: ${input.requirement || "(空)"}`,
    `answers: ${input.answers || "(空)"}`,
    input.sampling
      ? `userProvidedSampling: ${JSON.stringify(normalizedSampling)}`
      : `samplingHint(auto-estimated): ${JSON.stringify(autoSampling)}`,
    `uploadedFilesCount: ${input.files.length}`,
    "",
    "files:",
    fileDigest || "(no files)",
  ].join("\n");

  const systemPrompt = [
    "你是 Smart Python 数据处理助手（可处理多文件、多格式）。",
    "你可以判断：当前问题是否可直接回答（decision=direct_answer）。",
    "无论 decision 是 direct_answer 还是 python，都必须返回可执行 pythonCode。",
    "当 decision=direct_answer 时，directAnswer 用于给用户可编辑说明；pythonCode 必须与 directAnswer 含义一致并可执行。",
    "必须输出 requirementAnalysis（2-4 句，简短、面向执行前确认），内容要结合用户需求与文件结构/规模，不要泛泛而谈。",
    "输入中已包含：文件大小、页数(如有)、文字数(如有)、行列数(如有)、表头、前十几行/列样本。",
    "若 answers 中包含“上一轮执行失败”的报错信息和失败代码，你必须先定位报错根因，再返回修复后的完整 pythonCode（不要只解释，不要省略代码）。",
    "涉及 PDF/Word/二进制文件处理时，优先从 context.target.downloadUrl 或 context.target.url 读取原文件字节；其次使用 context.sourceFiles[*].downloadUrl/url；再次兜底 files[*].downloadUrl/url。",
    "files 与 context.sourceFiles 可能包含 sourceBase64/contentBase64（源文件完整字节的 base64）；若有该字段可直接解码，不必再下载。",
    "如果无法获取源字节，必须抛出带诊断信息的 ValueError（包含 files[0] / context.target / context.sourceFiles[0] 的可用 keys）。",
    "samplingSuggestion 必须由你动态决定，严禁固定为某个值。请依据数据规模、列复杂度、文本长度决定。",
    "当文件规模很大、结构复杂或需求不明确时，优先给出“先做数据探查再正式分析”的两阶段 Python 策略。",
    "必须优先支持多文件处理，能对 files 中多个文件进行联合清洗、关联、合并、比对、聚合。",
    "不要只针对单文件思路，也不要写死某一种具体业务场景。",
    "Python 输入数据包括：rows(list[dict], 主数据集) 与 files(list[dict], 全部文件数据)。",
    "process 函数签名建议：process(rows, mode, context, files)。",
    "process 返回值建议为 dict，并显式包含 rows 与 file_rows（均为 list[dict]），便于预览与导出结果文件。",
    "若需要输出二进制结果文件（如 PDF、DOCX、图片等），请在返回对象中提供 artifacts 数组：[{fileName,mimeType,base64}]。",
    "artifacts.base64 必须是文件完整字节的 base64。系统会自动保存并提供下载链接。",
    "对于 PDF 页级操作（删除/移动/旋转/拆分/合并等），必须返回 artifacts，且 mimeType 使用 application/pdf。",
    "如果无法产出结构化表格，也请返回 rows/file_rows 的空数组，并把解释放进 summary 或 textOutput。",
    "可选定义 extract_sample(rows, context, files) 以自定义 sample 抽样；系统会限制 sample <= 100 行。",
    "可使用运行环境中可用的 Python 库（标准库或已安装第三方库）处理文件；若某库不可用需明确报错。",
    "如果执行结果除了结构化表格，还应输出文字说明，可在返回对象中加入 textOutput 字段。",
    "chart 如需可视化可返回：{type:'line'|'bar'|'pie', title, xField, yField, rows:[...]}。",
    "followUpQuestions 返回 0-4 条澄清问题，便于用户补充约束。",
    "samplingSuggestion 必须包含 strategy(head|interval)、rowLimit(1-100)、columnLimit(1-100)。",
    "只输出 JSON：",
    "{\"decision\":\"direct_answer|python\",\"requirementAnalysis\":\"...\",\"directAnswer\":\"...\",\"pythonCode\":\"...\",\"notes\":\"...\",\"followUpQuestions\":[\"...\"],\"samplingSuggestion\":{\"strategy\":\"head\",\"rowLimit\":32,\"columnLimit\":14},\"artifacts\":[{\"fileName\":\"result.pdf\",\"mimeType\":\"application/pdf\",\"base64\":\"...\"}]}",
  ].join("\n");

  let raw = "";
  try {
    raw = await gatewayChat({
      token: input.token,
      siteId: "excel",
      system: systemPrompt,
      messages: [{ role: "user", content: userDescription }],
      maxTokens: 2200,
    });
  } catch (error) {
    if (error instanceof GatewayAuthError) throw error;
    return {
      decision: "python",
      directAnswer: buildFallbackRequirementAnalysis(input, normalizedSampling),
      pythonCode: fallbackCode,
      notes: `AI 生成失败（${error instanceof Error ? error.message : "unknown"}），已返回本地模板代码。`,
      suggestedSampling: normalizedSampling,
      followUpQuestions: fallbackQuestionsList,
    };
  }

  const parsed =
    tryParseJson<{
      decision?: unknown;
      requirementAnalysis?: unknown;
      directAnswer?: unknown;
      pythonCode?: unknown;
      notes?: unknown;
      followUpQuestions?: unknown;
      samplingSuggestion?: Partial<SamplingConfig>;
    }>(raw) ?? null;

  let decision = normalizeDecision(parsed?.decision);
  const directAnswer = typeof parsed?.directAnswer === "string" ? parsed.directAnswer.trim() : "";
  const parsedCode =
    (typeof parsed?.pythonCode === "string" && parsed.pythonCode.trim()) ||
    parsePythonCode(raw) ||
    fallbackCode;
  const notes =
    (typeof parsed?.notes === "string" && parsed.notes.trim()) || "已按当前需求生成 Smart Python 策略。";
  const followUpQuestions = normalizeQuestionList(parsed?.followUpQuestions, fallbackQuestionsList);
  const suggestedSampling = normalizeSamplingConfig(parsed?.samplingSuggestion ?? normalizedSampling);
  const requirementAnalysis =
    (typeof parsed?.requirementAnalysis === "string" && parsed.requirementAnalysis.trim()) ||
    directAnswer ||
    buildFallbackRequirementAnalysis(input, suggestedSampling);
  if (decision === "direct_answer" && !directAnswer && !requirementAnalysis) {
    decision = "python";
  }

  return {
    decision,
    directAnswer: requirementAnalysis,
    pythonCode: parsedCode,
    notes,
    suggestedSampling,
    followUpQuestions,
    usedProvider: "oceanleo",
    usedModel: GATEWAY_MODEL_TAG,
  };
}
