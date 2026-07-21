export type KnowledgeSiteKey =
  | "bizdev"
  | "meeting"
  | "paper"
  | "law"
  | "study"
  | "edu";

export interface KnowledgeWorkflow {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly agentId: string;
}

export interface KnowledgeTenantConfig {
  readonly siteKey: KnowledgeSiteKey;
  readonly name: string;
  readonly accent: string;
  readonly defaultWorkflowId: string;
  readonly workflows: readonly KnowledgeWorkflow[];
  readonly streamingProtocol: "shared-function-agent-task-stream";
  readonly historyProtocol: "durable-workspace-session";
}

type WorkflowSeed = readonly [id: string, title: string, icon: string];

function workflows(
  agentId: string,
  seeds: readonly WorkflowSeed[],
): readonly KnowledgeWorkflow[] {
  return seeds.map(([id, title, icon]) =>
    Object.freeze({ id, title, icon, agentId }),
  );
}

function tenant(
  input: Omit<
    KnowledgeTenantConfig,
    "streamingProtocol" | "historyProtocol"
  >,
): KnowledgeTenantConfig {
  return Object.freeze({
    ...input,
    workflows: Object.freeze([...input.workflows]),
    streamingProtocol: "shared-function-agent-task-stream",
    historyProtocol: "durable-workspace-session",
  });
}

const BIZDEV_WORKFLOWS = Object.freeze([
  ...workflows("bizdev.reply", [
    ["reply", "智能回复", "📨"],
    ["inquiry-reply", "询盘回复", "📨"],
    ["complaint-reply", "投诉处理回复", "🛎️"],
    ["whatsapp-reply", "WhatsApp 快回", "💬"],
    ["negotiation-reply", "谈判议价回复", "🤝"],
    ["order-confirm-reply", "订单确认回复", "✅"],
  ]),
  ...workflows("bizdev.dev-letter", [
    ["dev-letter", "开发信", "✉️"],
    ["cold-email", "开发信", "✉️"],
    ["reactivate-email", "唤醒沉睡客户", "🔔"],
    ["exhibition-invite", "展会邀请函", "🎪"],
    ["product-intro-letter", "产品推介信", "📦"],
    ["follow-up", "报价跟进信", "📮"],
  ]),
  ...workflows("bizdev.research", [
    ["research", "公司调研", "🔍"],
    ["company-research", "客户公司调研", "🔍"],
    ["market-entry", "目标市场分析", "🗺️"],
    ["customer-profile", "客户画像分析", "🧑‍💼"],
  ]),
  ...workflows("bizdev.competition", [
    ["competition", "竞品分析", "📊"],
    ["competitor-report", "竞品对比报告", "📊"],
    ["selling-points", "差异化卖点提炼", "💎"],
    ["pricing-strategy", "报价策略建议", "🏷️"],
  ]),
  ...workflows("bizdev.trade-talk", [
    ["trade-talk", "外贸翻译", "🌐"],
    ["trade-translate", "外贸翻译", "🌐"],
    ["term-localize", "术语本地化", "🔤"],
    ["multilang-notice", "多语通知函", "📣"],
  ]),
]);

const MEETING_WORKFLOWS = Object.freeze([
  ...workflows("meeting.agenda", [
    ["agenda", "议程助手", "🗓️"],
    ["weekly-agenda", "周会议程", "🗓️"],
    ["kickoff-agenda", "项目启动会议程", "🚀"],
    ["review-agenda", "评审/复盘会议程", "🔍"],
    ["brainstorm-agenda", "头脑风暴会议程", "💡"],
    ["client-agenda", "客户会议议程", "🤝"],
    ["interview-agenda", "面试/宣讲会议程", "🎓"],
  ]),
  ...workflows("meeting.meeting", [
    ["process", "会议处理", "🎙️"],
    ["minutes", "会议纪要", "🧾"],
    ["action-items", "待办清单提取", "✅"],
    ["chapters", "会议章节摘要", "📑"],
    ["translate", "会议内容翻译", "🌐"],
  ]),
  ...workflows("meeting.followup", [
    ["followup", "会后跟进", "✉️"],
    ["followup-email", "会后跟进邮件", "✉️"],
    ["im-broadcast", "群播报文案", "📣"],
    ["thanks-letter", "感谢信/致辞", "💐"],
    ["next-agenda", "下次会议议程草案", "📝"],
    ["decision-memo", "决议备忘录", "📌"],
  ]),
  ...workflows("meeting.polish", [
    ["polish", "发言润色", "🎤"],
    ["speech-polish", "发言稿润色", "🎤"],
    ["report-speech", "工作汇报稿", "📊"],
    ["campaign-speech", "竞聘/演讲稿", "🏆"],
    ["toast-speech", "致辞/祝酒词", "🥂"],
  ]),
]);

const PAPER_WORKFLOWS = Object.freeze([
  ...workflows("paper.write", [
    ["write", "论文写作", "✍️"],
    ["course-paper", "课程论文", "📄"],
    ["reading-report", "读书报告", "📖"],
    ["essay", "议论文/随笔", "✒️"],
    ["thesis", "毕业论文", "🎓"],
    ["proposal", "开题报告", "🧭"],
    ["lit-review", "文献综述", "🗂️"],
    ["research-plan", "研究计划书", "📋"],
    ["experiment-report", "实验报告", "🧪"],
    ["case-study", "案例分析报告", "🔍"],
    ["defense-speech", "答辩陈述稿", "🎤"],
    ["polish-academic", "论文润色", "✨"],
    ["reduce-dup", "论文降重", "♻️"],
    ["continue-writing", "论文续写扩写", "🖊️"],
    ["english-polish", "英文论文润色", "🇬🇧"],
    ["academic-translate", "学术翻译", "🌐"],
    ["abstract-keywords", "摘要+关键词", "🔑"],
    ["citation-format", "参考文献整理", "📑"],
  ]),
  ...workflows("paper.summarize", [
    ["summarize", "摘要总结", "📝"],
    ["paper-summary", "文献总结", "📝"],
    ["multi-paper-digest", "多文献速览", "📚"],
    ["note-digest", "读书笔记/摘录", "🗒️"],
  ]),
]);

const LAW_WORKFLOWS = Object.freeze([
  ...workflows("law.consult", [
    ["divorce-consult", "离婚咨询", "💔"],
    ["divorce-agreement", "离婚协议起草", "📝"],
    ["inheritance-consult", "继承咨询", "🕊️"],
    ["contract-draft", "合同起草", "📑"],
    ["company-charter", "公司章程起草", "🏢"],
    ["debt-collection", "欠款追讨", "💸"],
    ["demand-letter", "律师函/催款函", "✉️"],
    ["consumer-consult", "消费维权", "🛒"],
    ["rent-dispute", "租房纠纷", "🏠"],
    ["general-consult", "综合法律咨询", "⚖️"],
  ]),
  ...workflows("law.consultation", [
    ["custody-consult", "抚养权咨询", "👨‍👩‍👧"],
    ["labor-arbitration", "劳动仲裁咨询", "⚖️"],
    ["ip-consult", "知识产权咨询", "💡"],
    ["traffic-consult", "交通事故", "🚗"],
  ]),
  ...workflows("law.advice", [
    ["work-injury", "工伤赔偿", "🦺"],
    ["legal-opinion", "法律意见书", "🧠"],
  ]),
  ...workflows("law.calculator", [
    ["severance-calc", "经济补偿测算", "🧮"],
    ["interest-calc", "利息违约金测算", "📈"],
  ]),
  ...workflows("law.doc", [
    ["labor-complaint", "劳动仲裁申请书", "📄"],
    ["complaint-doc", "起诉状生成", "🧾"],
    ["statement-doc", "声明/承诺书", "📃"],
  ]),
  ...workflows("law.review", [["contract-review", "合同审查", "🔎"]]),
  ...workflows("law.search", [["law-search", "法规检索", "📘"]]),
  ...workflows("law.cases", [["case-search", "类案检索", "📚"]]),
]);

const STUDY_WORKFLOWS = Object.freeze([
  ...workflows("study.study", [
    ["study", "学习助手", "📚"],
    ["homework", "作业解答", "📝"],
    ["concept-explain", "知识点讲解", "💡"],
    ["review-outline", "复习提纲", "🗂️"],
    ["wrong-question", "错题解析", "❌"],
    ["mock-quiz", "模拟测验", "🧪"],
    ["flashcards", "闪卡卡片", "🃏"],
    ["word-memory", "单词记忆", "🔤"],
    ["grammar-explain", "语法精讲", "📐"],
    ["text-translate", "翻译精读", "🌏"],
    ["oral-practice", "口语陪练", "🗣️"],
    ["paper-outline", "论文提纲", "📄"],
    ["literature-summary", "文献速读", "📑"],
    ["study-plan", "学习计划", "📅"],
    ["presentation", "课堂展示", "📊"],
    ["essay-coach", "作文批改", "🖊️"],
    ["exam-strategy", "应试技巧", "🎯"],
    ["memory-hacks", "速记口诀", "🧠"],
    ["reading-guide", "名著导读", "📚"],
    ["science-explain", "科普解惑", "🔭"],
    ["parent-tutor", "家长辅导锦囊", "👨‍👧"],
    ["quiz-parent", "亲子出题", "🎲"],
  ]),
  ...workflows("study.homework-helper", [
    ["homework-helper", "作业速解", "📝"],
  ]),
  ...workflows("study.writing-templates", [
    ["writing-templates", "模板写作", "✍️"],
  ]),
  ...workflows("study.ai-tutor", [["ai-tutor", "AI 家教", "🎓"]]),
  ...workflows("study.math-solver", [["math-solver", "数学求解", "➗"]]),
  ...workflows("study.ai-answer-generator", [
    ["ai-answer-generator", "答案生成", "✅"],
  ]),
  ...workflows("study.ai-note-taker", [
    ["ai-note-taker", "AI 笔记", "📒"],
  ]),
  ...workflows("study.ai-flashcard-maker", [
    ["ai-flashcard-maker", "AI 闪卡", "🃏"],
  ]),
  ...workflows("study.ai-quiz-generator", [
    ["ai-quiz-generator", "AI 测验", "🧪"],
  ]),
  ...workflows("study.ai-lecture-note-taker", [
    ["ai-lecture-note-taker", "讲座笔记", "🎙️"],
  ]),
  ...workflows("study.ai-pdf-summarizer", [
    ["ai-pdf-summarizer", "PDF 摘要", "📄"],
  ]),
  ...workflows("study.ai-video-summarizer", [
    ["ai-video-summarizer", "视频摘要", "🎬"],
  ]),
  ...workflows("study.ai-detector", [["ai-detector", "AI 检测", "🔎"]]),
  ...workflows("study.ai-humanizer", [
    ["ai-humanizer", "AI 人性化", "🧑"],
  ]),
  ...workflows("study.ai-paraphraser", [
    ["ai-paraphraser", "改写", "♻️"],
  ]),
  ...workflows("study.citation-generator", [
    ["citation-generator", "引用生成", "🔖"],
  ]),
  ...workflows("study.plagiarism-checker", [
    ["plagiarism-checker", "查重", "🧾"],
  ]),
]);

const EDU_WORKFLOWS = Object.freeze([
  ...workflows("edu.edu", [
    ["edu", "教学助手", "🍎"],
    ["lecture-script", "讲稿生成", "🎙️"],
    ["lesson-plan", "教案设计", "📋"],
    ["courseware-outline", "课件大纲", "🖥️"],
    ["knowledge-handout", "知识点讲义", "📚"],
    ["class-opening", "课前导入设计", "🚀"],
    ["open-class", "公开课设计", "🌟"],
    ["unit-quiz", "单元测验", "✅"],
    ["exam-paper", "期中期末试卷", "📝"],
    ["classroom-exercise", "课堂练习题", "✏️"],
    ["layered-homework", "分层作业设计", "🪜"],
    ["wrong-question", "错题讲解", "🔍"],
    ["essay-comment", "作文评语", "🖊️"],
    ["student-comment", "学生评语", "🌟"],
    ["parent-communication", "家长沟通话术", "💬"],
    ["parent-meeting", "家长会发言稿", "🎤"],
    ["class-meeting", "班会设计", "🎯"],
    ["class-plan", "班主任工作计划", "🗓️"],
    ["teaching-reflection", "教学反思", "🪞"],
    ["speech-draft", "说课稿", "🗣️"],
    ["peer-observation", "听课评课记录", "📝"],
    ["research-speech", "教研主题发言", "🧩"],
    ["teacher-report", "教师述职报告", "📈"],
    ["learning-objective", "教学目标撰写", "🎯"],
    ["experiment-design", "实验设计", "🧪"],
  ]),
]);

export const KNOWLEDGE_TENANT_CONFIGS: Readonly<
  Record<KnowledgeSiteKey, KnowledgeTenantConfig>
> = Object.freeze({
  bizdev: tenant({
    siteKey: "bizdev",
    name: "LeoBizDev",
    accent: "#0e7490",
    defaultWorkflowId: "inquiry-reply",
    workflows: BIZDEV_WORKFLOWS,
  }),
  meeting: tenant({
    siteKey: "meeting",
    name: "LeoMeet",
    accent: "#0d9488",
    defaultWorkflowId: "minutes",
    workflows: MEETING_WORKFLOWS,
  }),
  paper: tenant({
    siteKey: "paper",
    name: "LeoPaper",
    accent: "#2563eb",
    defaultWorkflowId: "course-paper",
    workflows: PAPER_WORKFLOWS,
  }),
  law: tenant({
    siteKey: "law",
    name: "LeoLaw",
    accent: "#2563eb",
    defaultWorkflowId: "general-consult",
    workflows: LAW_WORKFLOWS,
  }),
  study: tenant({
    siteKey: "study",
    name: "LeoStudy",
    accent: "#7c3aed",
    defaultWorkflowId: "homework",
    workflows: STUDY_WORKFLOWS,
  }),
  edu: tenant({
    siteKey: "edu",
    name: "LeoEdu",
    accent: "#059669",
    defaultWorkflowId: "lesson-plan",
    workflows: EDU_WORKFLOWS,
  }),
});

export function knowledgeTenantConfig(
  siteKey: KnowledgeSiteKey,
): KnowledgeTenantConfig {
  return KNOWLEDGE_TENANT_CONFIGS[siteKey];
}

export function resolveKnowledgeWorkflow(
  siteKey: KnowledgeSiteKey,
  workflowId: string | null | undefined,
): KnowledgeWorkflow | null {
  const id = workflowId?.trim();
  if (!id) return null;
  return (
    KNOWLEDGE_TENANT_CONFIGS[siteKey].workflows.find(
      (workflow) => workflow.id === id,
    ) ?? null
  );
}
