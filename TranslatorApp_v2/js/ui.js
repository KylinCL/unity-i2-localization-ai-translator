import {
  LQA_ISSUE_TYPE_LABELS,
  LQA_SEVERITY_LABELS,
  excludedLanguageColumns,
  patchState,
  state,
  syncWindowState
} from "./store.js";
import {
  escapeHtml,
  escapeTitleText,
  findDefaultBaseLanguage,
  findDescColumnName,
  findKeyColumnName
} from "./utils.js";

const dom = {};

const DOM_IDS = {
  csvFileInput: "csvFileInput",
  dropZone: "dropZone",
  fileMeta: "fileMeta",
  tableWrap: "tableWrap",
  logView: "logView",
  logScrollTip: "logScrollTip",
  clearLogBtn: "clearLogBtn",
  rowCountChip: "rowCountChip",
  columnCountChip: "columnCountChip",
  exportBtn: "exportBtn",
  translateBtn: "translateBtn",
  proofreadBtn: "proofreadBtn",
  deepLqaModeToggle: "deepLqaModeToggle",
  resumeTaskBtn: "resumeTaskBtn",
  commitBtn: "commitBtn",
  stopTranslateBtn: "stopTranslateBtn",
  tokenLabel: "tokenLabel",
  languageConfigContainer: "languageConfigContainer",
  systemPrompt: "systemPrompt",
  systemPromptPreview: "systemPromptPreview",
  promptMeta: "promptMeta",
  selectionSummary: "selectionSummary",
  analyzeContextBtn: "analyzeContextBtn",
  editPromptBtn: "editPromptBtn",
  promptModal: "promptModal",
  promptCancelBtn: "promptCancelBtn",
  promptSaveBtn: "promptSaveBtn",
  settingsBtn: "settingsBtn",
  settingsModal: "settingsModal",
  settingsApiKey: "settingsApiKey",
  settingsBaseUrl: "settingsBaseUrl",
  settingsConcurrencyInput: "settingsConcurrency",
  concurrencyMinusBtn: "concurrencyMinus",
  concurrencyPlusBtn: "concurrencyPlus",
  settingsContextDepthInput: "settingsContextDepth",
  settingsModelName: "settingsModelName",
  modelOptions: "modelOptions",
  settingsDescColumnName: "settingsDescColumnName",
  settingsFreezeConfirmedLqa: "settingsFreezeConfirmedLqa",
  settingsCancelBtn: "settingsCancelBtn",
  settingsSaveBtn: "settingsSaveBtn",
  settingsClearStorageBtn: "settingsClearStorageBtn",
  toggleApiKeyVisibilityBtn: "toggleApiKeyVisibilityBtn",
  refreshModelsBtn: "refreshModelsBtn",
  verifyModelsBtn: "verifyModelsBtn",
  commitModal: "commitModal",
  commitSummaryContent: "commitSummaryContent",
  commitRevertAllBtn: "commitRevertAllBtn",
  commitCancelBtn: "commitCancelBtn",
  commitConfirmBtn: "commitConfirmBtn",
  commitCloseBtn: "commitCloseBtn"
};

export function initDomRefs(root = document) {
  Object.entries(DOM_IDS).forEach(([key, id]) => {
    dom[key] = root.getElementById(id);
  });
  return dom;
}

export function getDom() {
  return dom;
}

export function isLogViewAtBottom() {
  if (!dom.logView) {
    return true;
  }
  return (dom.logView.scrollHeight - dom.logView.scrollTop - dom.logView.clientHeight) < 50;
}

export function showLogScrollTip() {
  dom.logScrollTip?.classList.add("is-visible");
}

export function hideLogScrollTip() {
  dom.logScrollTip?.classList.remove("is-visible");
}

export function scrollLogViewToBottom() {
  if (!dom.logView) {
    return;
  }
  dom.logView.scrollTop = dom.logView.scrollHeight;
  hideLogScrollTip();
}

export function addLog(message, type = "info", options = {}) {
  if (!dom.logView) {
    return null;
  }

  const { html = false, className = "", id = "" } = options;
  const isAtBottom = isLogViewAtBottom();
  const entry = document.createElement("div");
  entry.className = "log-entry " + type + (className ? " " + className : "");
  if (id) {
    entry.id = id;
  }
  const timestamp = "[" + new Date().toLocaleTimeString() + "]";
  if (html) {
    entry.innerHTML = "<span class=\"log-time\">" + escapeHtml(timestamp) + "</span> " + message;
  } else {
    entry.textContent = timestamp + " " + message;
  }
  dom.logView.appendChild(entry);
  if (isAtBottom) {
    scrollLogViewToBottom();
  } else {
    showLogScrollTip();
  }
  return entry;
}

export function buildCellElementId(row, lang) {
  return "cell-" + row + "-" + String(lang ?? "");
}

export function buildLogElementId(row, lang) {
  return "log-" + row + "-" + String(lang ?? "");
}

export function flashTargetElement(element) {
  if (!element) {
    return;
  }
  element.classList.remove("flash-target");
  void element.offsetWidth;
  element.classList.add("flash-target");
}

function getScrollFocusDistance(scroller, target) {
  if (!scroller || !target) {
    return 0;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollerCenter = scrollerRect.top + (scrollerRect.height / 2);
  const targetCenter = targetRect.top + (targetRect.height / 2);
  return Math.abs(targetCenter - scrollerCenter);
}

export function flashAfterSmartScroll(scroller, scrollTarget, flashTarget) {
  if (!scrollTarget || !flashTarget) {
    return;
  }

  const effectiveScroller = scroller || scrollTarget.parentElement;
  const distance = getScrollFocusDistance(effectiveScroller, scrollTarget);
  const immediateThreshold = effectiveScroller
    ? Math.max(80, effectiveScroller.clientHeight * 0.16)
    : 80;

  scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });

  if (!effectiveScroller || distance <= immediateThreshold) {
    flashTargetElement(flashTarget);
    return;
  }

  let settledFrames = 0;
  let lastScrollTop = effectiveScroller.scrollTop;
  const startTime = performance.now();
  const maxWaitMs = 1800;

  const checkSettled = (now) => {
    const currentScrollTop = effectiveScroller.scrollTop;
    if (Math.abs(currentScrollTop - lastScrollTop) < 1) {
      settledFrames += 1;
    } else {
      settledFrames = 0;
      lastScrollTop = currentScrollTop;
    }

    if (settledFrames >= 4 || (now - startTime) >= maxWaitMs) {
      flashTargetElement(flashTarget);
      return;
    }

    window.requestAnimationFrame(checkSettled);
  };

  window.requestAnimationFrame(checkSettled);
}

export function parseLegacyLqaNote(note) {
  const text = String(note ?? "").trim();
  const result = {};
  const headerMatch = text.match(/^\[([^/\]]+)\s*\/\s*([^\]]+)\]\s*([\s\S]*)$/);
  const body = headerMatch ? headerMatch[3] : text;

  if (headerMatch) {
    result.severityLabel = headerMatch[1].trim();
    result.issueLabel = headerMatch[2].trim();
  }

  const evidenceMatch = body.match(/(?:^|；)证据：([\s\S]*?)(?=；(?:判定|说明)：|$)/);
  const decisionMatch = body.match(/(?:^|；)判定：([\s\S]*?)(?=；说明：|$)/);
  const reasonMatch = body.match(/(?:^|；)说明：([\s\S]*)$/);

  if (evidenceMatch) {
    result.evidence = evidenceMatch[1].trim();
  }
  if (decisionMatch) {
    result.decision = decisionMatch[1].trim();
  }
  if (reasonMatch) {
    result.reason = reasonMatch[1].trim();
  }

  return result;
}

export function normalizeLqaLogDetail(detailOrNote, fallback = {}) {
  const detail = detailOrNote && typeof detailOrNote === "object" && !Array.isArray(detailOrNote)
    ? detailOrNote
    : {};
  const fallbackNote = String(fallback?.note ?? "").trim();
  const rawNote = typeof detailOrNote === "string" ? detailOrNote : (detail.note ?? fallbackNote);
  const parsed = parseLegacyLqaNote(rawNote);
  const source = String(detail.source ?? fallback?.source ?? "");
  const severity = String(detail.severity || fallback?.severity || (source === "local_format_scan" ? "critical" : "")).toLowerCase();
  const issueType = String(detail.issueType || fallback?.issueType || "");
  const severityLabel = String(
    detail.severityLabel
    || parsed.severityLabel
    || LQA_SEVERITY_LABELS[severity]
    || (severity ? severity : "未分级")
  );
  const issueLabel = String(
    detail.issueLabel
    || parsed.issueLabel
    || LQA_ISSUE_TYPE_LABELS[issueType]
    || (issueType ? issueType : "LQA")
  );
  const reasonFallback = parsed.reason || rawNote || fallbackNote || "未提供说明";

  return {
    severity,
    issueType,
    severityLabel,
    issueLabel,
    evidence: String(detail.evidence || parsed.evidence || "未提供结构化证据").trim(),
    decision: String(detail.decision || parsed.decision || "按 LQA 规则处理").trim(),
    reason: String(detail.reason || reasonFallback).trim(),
    note: String(rawNote || reasonFallback).trim(),
    source
  };
}

export function getLqaSeverityClass(detailOrNote, source = "") {
  const detail = normalizeLqaLogDetail(detailOrNote, { source });
  if (["critical", "major", "minor", "suggestion"].includes(detail.severity)) {
    return "lqa-severity-" + detail.severity;
  }

  if (detail.severityLabel === "严重") {
    return "lqa-severity-critical";
  }
  if (detail.severityLabel === "重要") {
    return "lqa-severity-major";
  }

  return "lqa-severity-default";
}

export function buildLqaLogClassName(detailOrNote, source = "") {
  return "lqa lqa-card " + getLqaSeverityClass(detailOrNote, source);
}

function buildLqaDetailRow(label, value, className = "") {
  return "<div class=\"lqa-detail-row" + (className ? " " + escapeHtml(className) : "") + "\">"
    + "<span class=\"lqa-detail-label\">" + escapeHtml(label) + "</span>"
    + "<span class=\"lqa-detail-value\">" + escapeHtml(value) + "</span>"
    + "</div>";
}

export function buildLqaLogHtml(row, lang, detailOrNote, actionLabel = "LQA 修正") {
  const detail = normalizeLqaLogDetail(detailOrNote);
  const rowId = "table-row-" + row;
  const safeLang = String(lang ?? "");
  return "<div class=\"lqa-card-content\">"
    + "<div class=\"lqa-card-header\">"
    + "<div class=\"lqa-card-title\">"
    + "<span aria-hidden=\"true\">🛠️</span>"
    + "<a href=\"#" + escapeHtml(rowId) + "\" class=\"table-row-link\" data-target-row=\"" + escapeHtml(rowId) + "\" data-row=\"" + row + "\" data-lang=\"" + escapeHtml(safeLang) + "\">行 [" + (row + 1) + "]</a>"
    + "<span class=\"lqa-lang\">[" + escapeHtml(lang) + "]</span>"
    + "<span class=\"lqa-action-label\">" + escapeHtml(actionLabel) + "</span>"
    + "</div>"
    + "<span class=\"lqa-badge\">" + escapeHtml(detail.severityLabel + " / " + detail.issueLabel) + "</span>"
    + "</div>"
    + "<div class=\"lqa-card-details\">"
    + buildLqaDetailRow("🔍 证据：", detail.evidence)
    + buildLqaDetailRow("🧭 判定：", detail.decision)
    + buildLqaDetailRow("📝 说明：", detail.reason, "reason")
    + "</div>"
    + "</div>";
}

export function setDropZoneActive(isActive) {
  dom.dropZone?.classList.toggle("is-dragover", isActive);
}

export function updateSelectionSummary(rows = state.csvData) {
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const selectedRows = Array.isArray(rows)
    ? rows.filter((row) => row?._selected !== false).length
    : 0;
  if (dom.selectionSummary) {
    dom.selectionSummary.textContent = "当前已选中 " + selectedRows + " / " + totalRows + " 行";
  }
}

export function updateStats(headers = state.csvHeaders, rows = state.csvData) {
  if (dom.rowCountChip) {
    dom.rowCountChip.textContent = "Rows: " + rows.length;
  }
  if (dom.columnCountChip) {
    dom.columnCountChip.textContent = "Columns: " + headers.length;
  }
  updateSelectionSummary(rows);
}

export function renderEmptyTableState(title, description) {
  updateSelectionSummary([]);
  if (!dom.tableWrap) {
    return;
  }
  dom.tableWrap.innerHTML = `
    <div class="placeholder">
      <div class="placeholder-card">
        <strong>${escapeHtml(title)}</strong>
        ${escapeHtml(description)}
      </div>
    </div>
  `;
}

export function getRowElement(rowIndex) {
  return document.getElementById("table-row-" + rowIndex)
    || dom.tableWrap?.querySelector('[data-row-index="' + rowIndex + '"]');
}

export function syncRowSelectionDom(rowIndex, isSelected) {
  const rowElement = getRowElement(rowIndex);
  if (!rowElement) {
    return;
  }

  const checkbox = rowElement.querySelector(".row-select-checkbox");
  if (checkbox) {
    checkbox.checked = isSelected;
  }

  rowElement.classList.toggle("selected-row", isSelected);
  rowElement.classList.toggle("is-selected", isSelected);
  rowElement.classList.toggle("is-unselected", !isSelected);
}

export function syncAllVisibleRowSelectionDom() {
  dom.tableWrap?.querySelectorAll("tr[data-row-index]").forEach((rowElement) => {
    const rowIndex = Number(rowElement.dataset.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.csvData.length) {
      return;
    }

    syncRowSelectionDom(rowIndex, state.csvData[rowIndex]?._selected !== false);
  });
}

export function syncSelectAllCheckboxState() {
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  if (!selectAllCheckbox) {
    return;
  }

  const totalRows = Array.isArray(state.csvData) ? state.csvData.length : 0;
  const selectedRows = Array.isArray(state.csvData)
    ? state.csvData.filter((row) => row?._selected !== false).length
    : 0;

  selectAllCheckbox.checked = totalRows > 0 && selectedRows === totalRows;
  selectAllCheckbox.indeterminate = selectedRows > 0 && selectedRows < totalRows;
}

export function syncSelectionUi(rowIndexes = []) {
  if (Array.isArray(rowIndexes) && rowIndexes.length) {
    rowIndexes.forEach((rowIndex) => {
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.csvData.length) {
        return;
      }
      syncRowSelectionDom(rowIndex, state.csvData[rowIndex]?._selected !== false);
    });
  }

  syncSelectAllCheckboxState();
  updateStats(state.csvHeaders, state.csvData);
}

export function renderTableWithScrollPreservation(headers = state.csvHeaders, rows = state.csvData, afterRender) {
  const currentScrollTop = dom.tableWrap?.scrollTop || 0;
  renderTable(headers, rows);
  if (dom.tableWrap) {
    dom.tableWrap.scrollTop = currentScrollTop;
  }
  if (typeof afterRender === "function") {
    afterRender();
  }
}

export function renderTable(headers = state.csvHeaders, rows = state.csvData) {
  if (!dom.tableWrap) {
    return;
  }
  if (!headers.length || !rows.length) {
    renderEmptyTableState("没有可显示的数据", "请确认文件包含表头，并且至少有一行有效数据。");
    return;
  }

  const totalRows = rows.length;
  const selectedRows = rows.filter((row) => row?._selected !== false).length;
  const allSelected = totalRows > 0 && selectedRows === totalRows;

  const thead = [
    "<thead><tr>",
    '<th class="select-col"><input id="selectAllCheckbox" type="checkbox"' + (allSelected ? " checked" : "") + '></th>',
    '<th class="index-col">#</th>',
    ...headers.map((header) => "<th>" + escapeHtml(header) + "</th>"),
    "</tr></thead>"
  ].join("");

  const tbody = rows.map((row, index) => {
    const isSelected = row?._selected !== false;
    const cells = headers.map((header) => {
      const lqaHistory = row?._lqaHistory?.[header];
      const currentStatus = lqaHistory?.status === "original" ? "original" : "ai";
      const cellId = lqaHistory ? buildCellElementId(index, header) : "";
      const displayText = lqaHistory
        ? (currentStatus === "ai" ? String(lqaHistory.aiText ?? row[header] ?? "") : String(lqaHistory.originalText ?? row[header] ?? ""))
        : String(row[header] ?? "");
      const titleText = lqaHistory
        ? (currentStatus === "ai"
          ? "原译文: " + String(lqaHistory.originalText ?? "") + "\n原因: " + String(lqaHistory.note ?? "")
          : "AI译文: " + String(lqaHistory.aiText ?? "") + "\n原因: " + String(lqaHistory.note ?? ""))
        : "";
      const cellClass = lqaHistory
        ? ' class="' + (currentStatus === "ai" ? "lqa-updated-cell" : "lqa-original-cell") + '"'
        : "";
      const titleAttr = lqaHistory ? ' title="' + escapeTitleText(titleText) + '"' : "";
      const interactiveAttrs = lqaHistory
        ? ' id="' + escapeHtml(cellId) + '" data-row="' + index + '" data-lang="' + escapeHtml(header) + '"'
        : "";
      const toggleControl = lqaHistory
        ? ' <span class="lqa-toggle-btn" data-row="' + index + '" data-lang="' + escapeHtml(header) + '" title="'
          + escapeTitleText(titleText)
          + '">'
          + (currentStatus === "ai" ? "↩️" : "🔄")
          + "</span>"
        : "";

      return "<td" + cellClass + titleAttr + interactiveAttrs + "><span class=\"cell-text\">"
        + escapeHtml(displayText)
        + "</span>"
        + toggleControl
        + "</td>";
    }).join("");

    const selectionCell = '<td class="select-col"><input class="row-select-checkbox" type="checkbox" data-row="' + index + '"' + (isSelected ? " checked" : "") + "></td>";
    const rowClass = ' class="data-row ' + (isSelected ? "selected-row is-selected" : "is-unselected") + '"';
    return "<tr id=\"table-row-" + index + "\" data-row-index=\"" + index + "\"" + rowClass + ">" + selectionCell + "<td class=\"index-col\">" + (index + 1) + "</td>" + cells + "</tr>";
  }).join("");

  dom.tableWrap.innerHTML = "<table>" + thead + "<tbody>" + tbody + "</tbody></table>";
  syncSelectAllCheckboxState();
}

export function updateTokenLabel() {
  if (dom.tokenLabel) {
    dom.tokenLabel.textContent = "🪙 Token 消耗: " + state.totalTokens;
  }
  syncWindowState();
}

export function updateApiKeyVisibility(isVisible) {
  if (dom.settingsApiKey) {
    dom.settingsApiKey.type = isVisible ? "text" : "password";
  }
  if (dom.toggleApiKeyVisibilityBtn) {
    dom.toggleApiKeyVisibilityBtn.textContent = isVisible ? "🙈" : "👁️";
    dom.toggleApiKeyVisibilityBtn.setAttribute("aria-label", isVisible ? "隐藏 API Key" : "显示 API Key");
    dom.toggleApiKeyVisibilityBtn.setAttribute("title", isVisible ? "隐藏 API Key" : "显示 API Key");
  }
}

export function updatePromptPreview() {
  if (!dom.systemPrompt || !dom.systemPromptPreview || !dom.promptMeta) {
    return;
  }
  const value = dom.systemPrompt.value.trim();
  const preview = value
    ? value.split(/\n+/).slice(0, 4).join("\n")
    : "尚未填写游戏背景或翻译上下文。点击下方按钮后，可在二级窗口中集中编辑设定内容。";

  dom.systemPromptPreview.textContent = preview;
  dom.systemPromptPreview.classList.toggle("empty", !value);
  dom.promptMeta.textContent = value.length + " chars";
}

export function openPromptModal() {
  patchState({ promptDraftValue: dom.systemPrompt?.value || "" });
  dom.promptModal?.classList.add("show");
  dom.promptModal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  dom.systemPrompt?.focus();
}

export function closePromptModal() {
  dom.promptModal?.classList.remove("show");
  dom.promptModal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function renderModelOptions(modelIds, allowFallback = true) {
  if (!dom.modelOptions) {
    return;
  }
  const uniqueIds = [...new Set((modelIds || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  dom.modelOptions.innerHTML = "";

  if (!uniqueIds.length) {
    if (allowFallback) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = "GPT-5.4";
      dom.modelOptions.appendChild(fallbackOption);
    }
    return;
  }

  uniqueIds.forEach((modelId) => {
    const option = document.createElement("option");
    option.value = modelId;
    dom.modelOptions.appendChild(option);
  });
}

export function updateStepperButtons() {
  if (!dom.settingsConcurrencyInput) {
    return;
  }
  const value = parseInt(dom.settingsConcurrencyInput.value, 10);
  if (dom.concurrencyMinusBtn) {
    dom.concurrencyMinusBtn.disabled = value <= 1;
  }
  if (dom.concurrencyPlusBtn) {
    dom.concurrencyPlusBtn.disabled = value >= 20;
  }
}

export function syncSettingsForm() {
  if (dom.settingsApiKey) dom.settingsApiKey.value = state.apiKey;
  if (dom.settingsBaseUrl) dom.settingsBaseUrl.value = state.baseUrl;
  if (dom.settingsConcurrencyInput) dom.settingsConcurrencyInput.value = state.settingsConcurrency;
  if (dom.settingsContextDepthInput) dom.settingsContextDepthInput.value = state.contextDepth;
  if (dom.settingsModelName) {
    dom.settingsModelName.value = state.modelName;
    dom.settingsModelName.placeholder = "请选择或输入模型";
  }
  if (dom.settingsDescColumnName) dom.settingsDescColumnName.value = state.descColumnName;
  if (dom.settingsFreezeConfirmedLqa) dom.settingsFreezeConfirmedLqa.checked = state.lqaFreezeEnabled;
  if (!dom.modelOptions?.children.length) {
    renderModelOptions(["GPT-5.4"]);
  }
  updateApiKeyVisibility(false);
  updateStepperButtons();
}

export function openSettingsModal() {
  syncSettingsForm();
  dom.settingsModal?.classList.add("show");
  dom.settingsModal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  updateStepperButtons();
  dom.settingsApiKey?.focus();
}

export function closeSettingsModal() {
  dom.settingsModal?.classList.remove("show");
  dom.settingsModal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function buildCommitSummaryHtml() {
  const items = [];
  const keyColumn = findKeyColumnName(state.csvHeaders);
  const descColumn = findDescColumnName(state.csvHeaders, state.descColumnName);

  state.csvData.forEach((row, rowIndex) => {
    const historyMap = row?._lqaHistory;
    if (!historyMap) {
      return;
    }

    Object.entries(historyMap).forEach(([lang, history]) => {
      const isReverted = history?.status === "original";
      const keyValue = keyColumn ? String(row?.[keyColumn] ?? "") : "";
      const descValue = descColumn ? String(row?.[descColumn] ?? "") : "";
      items.push(
        "<div class=\"commit-item\">"
          + "<div class=\"commit-item-meta\">行 [" + (rowIndex + 1) + "] - [" + escapeHtml(lang) + "]</div>"
          + (keyValue || descValue
            ? "<div class=\"commit-item-context\">Key: " + escapeHtml(keyValue) + " | Desc: " + escapeHtml(descValue) + "</div>"
            : "")
          + "<div><span class=\"commit-label\">原译文</span>" + escapeHtml(history?.originalText ?? "") + "</div>"
          + "<div><span class=\"commit-arrow\">➔</span> " + escapeHtml(row?.[lang] ?? "") + "</div>"
          + "<div><span class=\"commit-label\">原因</span>" + escapeHtml(history?.note ?? "") + "</div>"
          + (isReverted ? "<div class=\"commit-item-context\">当前选择保留原译文。</div>" : "")
          + "<button class=\"modal-toggle-btn\" type=\"button\" data-row=\"" + rowIndex + "\" data-lang=\"" + escapeHtml(lang) + "\">"
          + (isReverted ? "切换为 AI 译文" : "切换为原译文")
          + "</button>"
        + "</div>"
      );
    });
  });

  return items.length
    ? items.join("")
    : '<div class="commit-empty">当前没有待确认的 LQA 修改。</div>';
}

export function openCommitModal() {
  if (dom.commitSummaryContent) {
    dom.commitSummaryContent.innerHTML = buildCommitSummaryHtml();
  }
  dom.commitModal?.classList.add("show");
  dom.commitModal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

export function closeCommitModal() {
  dom.commitModal?.classList.remove("show");
  dom.commitModal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function syncPendingLqaState({ hasResumableTask = () => false } = {}) {
  syncWindowState();

  if (state.isTranslating) {
    if (dom.translateBtn) dom.translateBtn.disabled = true;
    if (dom.proofreadBtn) dom.proofreadBtn.disabled = true;
    dom.commitBtn?.classList.add("hidden");
    dom.resumeTaskBtn?.classList.add("hidden");
    return;
  }

  if (hasResumableTask()) {
    dom.resumeTaskBtn?.classList.remove("hidden");
    if (dom.resumeTaskBtn) dom.resumeTaskBtn.disabled = false;
  } else {
    dom.resumeTaskBtn?.classList.add("hidden");
  }

  if (state.hasPendingLQA) {
    if (dom.translateBtn) dom.translateBtn.disabled = true;
    if (dom.proofreadBtn) dom.proofreadBtn.disabled = true;
    dom.commitBtn?.classList.remove("hidden");
  } else {
    if (dom.translateBtn) dom.translateBtn.disabled = false;
    if (dom.proofreadBtn) dom.proofreadBtn.disabled = false;
    dom.commitBtn?.classList.add("hidden");
  }
}

export function addTaskDividerLog(labelText = "") {
  const suffix = labelText
    ? " <span style=\"color:#9be7b3; font-size:0.92em;\">[" + escapeHtml(labelText) + "]</span>"
    : "";
  addLog(
    "<div style=\"margin: 20px 0 10px 0; border-top: 2px dashed #666; padding-top: 10px; font-weight: bold; color: #4CAF50; font-size: 1.1em;\">==== 🟢 新一轮任务开始 ====" + suffix + "</div>",
    "info",
    { html: true }
  );
}

export function renderLanguageConfig(headers, callbacks = {}) {
  const languageHeaders = (headers || []).filter((header) => {
    const normalizedHeader = String(header ?? "").trim().toLowerCase();
    return normalizedHeader && !excludedLanguageColumns.has(normalizedHeader);
  });

  if (!dom.languageConfigContainer) {
    return;
  }

  if (!languageHeaders.length) {
    patchState({
      selectedBaseLanguage: "",
      selectedTargetLanguages: []
    });
    dom.languageConfigContainer.innerHTML = '<div class="language-placeholder">请先上传文件以选择语言。</div>';
    return;
  }

  let selectedBaseLanguage = state.selectedBaseLanguage;
  let selectedTargetLanguages = state.selectedTargetLanguages;

  if (!selectedBaseLanguage || !languageHeaders.includes(selectedBaseLanguage)) {
    selectedBaseLanguage = findDefaultBaseLanguage(languageHeaders);
  }

  selectedTargetLanguages = selectedTargetLanguages.filter((header) => languageHeaders.includes(header) && header !== selectedBaseLanguage);
  if (!selectedTargetLanguages.length) {
    selectedTargetLanguages = languageHeaders.filter((header) => header !== selectedBaseLanguage);
  }

  patchState({
    selectedBaseLanguage,
    selectedTargetLanguages
  });

  const targetOptions = languageHeaders.filter((header) => header !== selectedBaseLanguage);
  const baseOptionsHtml = languageHeaders.map((header) => {
    const selected = header === selectedBaseLanguage ? " selected" : "";
    return `<option value="${escapeHtml(header)}"${selected}>${escapeHtml(header)}</option>`;
  }).join("");

  const targetsHtml = targetOptions.length
    ? targetOptions.map((header) => {
        const checked = selectedTargetLanguages.includes(header) ? " checked" : "";
        return `
          <label class="checkbox-item">
            <input type="checkbox" class="target-language-checkbox" value="${escapeHtml(header)}"${checked}>
            <span>${escapeHtml(header)}</span>
          </label>
        `;
      }).join("")
    : '<div class="language-placeholder">当前没有可选的目标语言列。</div>';

  dom.languageConfigContainer.innerHTML = `
    <div class="language-config-grid">
      <div class="field-group">
        <label for="baseLanguageSelect">基准语言 (Base)</label>
        <select id="baseLanguageSelect">${baseOptionsHtml}</select>
        <div class="hint">默认优先选择包含 “Chinese” 字样的表头。</div>
      </div>
      <div class="field-group">
        <label>目标语言 (Targets)</label>
        <div class="checkbox-list">${targetsHtml}</div>
      </div>
    </div>
  `;

  const baseLanguageSelect = document.getElementById("baseLanguageSelect");
  if (baseLanguageSelect) {
    baseLanguageSelect.addEventListener("change", (event) => {
      patchState({ selectedBaseLanguage: event.target.value });
      renderLanguageConfig(state.csvHeaders, callbacks);
      callbacks.onBaseLanguageChange?.(state.selectedBaseLanguage);
    });
  }

  document.querySelectorAll(".target-language-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const selected = Array.from(document.querySelectorAll(".target-language-checkbox:checked")).map((item) => item.value);
      patchState({ selectedTargetLanguages: selected });
      callbacks.onTargetLanguagesChange?.(selected);
    });
  });
}
