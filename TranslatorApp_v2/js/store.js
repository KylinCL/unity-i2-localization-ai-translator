export const STORAGE_KEYS = {
  apiKey: "translatorTool.apiKey",
  baseUrl: "translatorTool.baseUrl",
  modelName: "translatorTool.modelName",
  descColumnName: "translatorTool.descColumnName",
  concurrency: "translatorTool.concurrency",
  contextDepth: "translatorTool.contextDepth",
  systemPrompt: "translatorTool.systemPrompt",
  lqaFreezeEnabled: "translatorTool.lqaFreezeEnabled"
};

export const CONSTANTS = {
  ANALYSIS_MAX_ROWS: 3000,
  ANALYSIS_SYSTEM_PROMPT: "你是一个资深的游戏本地化专家和剧情分析师。",
  TRANSLATION_BATCH_SIZE: 30,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT: "你是一个专业的游戏本地化翻译专家。请严格遵守要求，并只返回合法 JSON。",
  MIN_CONCURRENCY: 1,
  MAX_CONCURRENCY: 20
};

export const LQA_ISSUE_TYPES = [
  "tag_mismatch",
  "placeholder_mismatch",
  "newline_mismatch",
  "omission",
  "mistranslation",
  "terminology",
  "context_consistency",
  "punctuation_pollution",
  "style_only",
  "no_issue"
];

export const LQA_SEVERITIES = ["critical", "major", "minor", "suggestion"];

export const LQA_ISSUE_TYPE_LABELS = {
  tag_mismatch: "富文本标签不一致",
  placeholder_mismatch: "占位符不一致",
  newline_mismatch: "换行符不一致",
  omission: "漏译",
  mistranslation: "错译",
  terminology: "术语不一致",
  context_consistency: "上下文不一致",
  punctuation_pollution: "标点污染",
  style_only: "仅风格建议",
  no_issue: "无问题"
};

export const LQA_SEVERITY_LABELS = {
  critical: "严重",
  major: "重要",
  minor: "轻微",
  suggestion: "建议"
};

export const LQA_AUTO_APPLY_ISSUE_TYPES = new Set([
  "tag_mismatch",
  "placeholder_mismatch",
  "newline_mismatch",
  "omission",
  "mistranslation",
  "terminology",
  "context_consistency",
  "punctuation_pollution"
]);

export const LQA_AUTO_APPLY_SEVERITIES = new Set(["critical", "major"]);

export const excludedLanguageColumns = new Set(["key", "type", "desc"]);

const initialState = {
  csvData: [],
  csvHeaders: [],
  dragDepth: 0,
  totalTokens: 0,
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  modelName: "GPT-5.4",
  descColumnName: "Desc",
  settingsConcurrency: 5,
  contextDepth: 50,
  lqaFreezeEnabled: false,
  selectedBaseLanguage: "",
  selectedTargetLanguages: [],
  lastCheckedIndex: null,
  pendingRowSelectShift: false,
  analysisTimer: null,
  hasPendingLQA: false,
  lastTaskStatus: { type: null, totalBatches: 0, lastSuccessBatch: 0 },
  lastTaskSnapshot: null,
  isTranslating: false,
  promptDraftValue: ""
};

export const state = { ...initialState };

export function getState(key) {
  return key ? state[key] : state;
}

export function setState(key, value) {
  state[key] = value;
  syncWindowState();
  return state[key];
}

export function patchState(patch = {}) {
  Object.assign(state, patch);
  syncWindowState();
  return state;
}

export function resetTaskState() {
  state.lastTaskSnapshot = null;
  state.lastTaskStatus = { type: null, totalBatches: 0, lastSuccessBatch: 0 };
  syncWindowState();
}

export function updateLastTaskStatus(patch = {}) {
  state.lastTaskStatus = {
    type: patch.type !== undefined ? patch.type : state.lastTaskStatus.type,
    totalBatches: patch.totalBatches !== undefined ? Math.max(0, Number(patch.totalBatches) || 0) : state.lastTaskStatus.totalBatches,
    lastSuccessBatch: patch.lastSuccessBatch !== undefined ? Math.max(0, Number(patch.lastSuccessBatch) || 0) : state.lastTaskStatus.lastSuccessBatch
  };
  syncWindowState();
  return state.lastTaskStatus;
}

export function syncWindowState() {
  window.csvData = state.csvData;
  window.totalTokens = state.totalTokens;
  window.isTranslating = state.isTranslating;
  window.hasPendingLQA = state.hasPendingLQA;
  window.lastTaskStatus = { ...state.lastTaskStatus };
}

export function initializeStore() {
  syncWindowState();
  return state;
}
