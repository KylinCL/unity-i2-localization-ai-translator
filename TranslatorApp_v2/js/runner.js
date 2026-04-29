import {
  CONSTANTS,
  LQA_AUTO_APPLY_ISSUE_TYPES,
  LQA_AUTO_APPLY_SEVERITIES,
  LQA_ISSUE_TYPE_LABELS,
  LQA_SEVERITY_LABELS,
  patchState,
  resetTaskState,
  state,
  syncWindowState,
  updateLastTaskStatus
} from "./store.js";
import {
  buildProofreadRequestBody,
  buildTranslationRequestBody,
  extractAnalysisResponse,
  postChatCompletion,
  probeModel
} from "./api.js";
import {
  addLog,
  buildLogElementId,
  buildLqaLogClassName,
  buildLqaLogHtml,
  closeCommitModal,
  getDom,
  normalizeLqaLogDetail,
  renderTableWithScrollPreservation,
  syncPendingLqaState,
  updateStats,
  updateTokenLabel
} from "./ui.js";
import {
  buildLocalFormatIssueNote,
  chunkArray,
  findDescColumnName,
  findKeyColumnName,
  getDeterministicFormatIssues,
  hasForbiddenFullwidthPunctuation,
  isAbortError,
  isWesternLanguage,
  normalizeNewlineRepresentationToBase,
  normalizeConcurrency,
  parseModelJsonObject,
  waitWithAbort
} from "./utils.js";

const activeAbortControllers = new Set();

export function getSelectedTargetLanguages() {
  const targetLangs = Array.from(document.querySelectorAll(".target-language-checkbox:checked"))
    .map((item) => item.value)
    .filter((lang) => lang && lang !== state.selectedBaseLanguage);
  patchState({ selectedTargetLanguages: targetLangs });
  return targetLangs;
}

export function buildContextString(endRow, targetLangs, depth) {
  if (depth <= 0 || endRow <= 0) {
    return "";
  }

  const startRow = Math.max(0, endRow - depth);
  const contextRows = state.csvData.slice(startRow, endRow);
  const currentDescCol = findDescColumnName(state.csvHeaders, state.descColumnName);
  let result = "";

  contextRows.forEach((row) => {
    const descText = currentDescCol ? String(row?.[currentDescCol] ?? "").replace(/\n/g, " ") : "";
    const baseText = String(row?.[state.selectedBaseLanguage] ?? "").replace(/\n/g, " ");
    if (!baseText) {
      return;
    }

    const targetTexts = [];
    (targetLangs || []).forEach((lang) => {
      const tText = String(row?.[lang] ?? "").replace(/\n/g, " ");
      if (tText) {
        targetTexts.push(`[${lang}]: ${tText}`);
      }
    });

    const descPrefix = descText ? `[场景/Desc: ${descText}] ` : "";
    if (targetTexts.length > 0) {
      result += `${descPrefix}原文: ${baseText} | 译文: ${targetTexts.join(", ")}\n`;
    } else {
      result += `${descPrefix}原文: ${baseText}\n`;
    }
  });

  return result;
}

export function buildReadonlyContextRows(endRow, targetLangs, depth) {
  if (depth <= 0 || endRow <= 0) {
    return [];
  }

  const startRow = Math.max(0, endRow - depth);
  const currentDescCol = findDescColumnName(state.csvHeaders, state.descColumnName);
  const keyColumn = findKeyColumnName(state.csvHeaders);
  const rows = [];

  state.csvData.slice(startRow, endRow).forEach((row, offset) => {
    const rowIndex = startRow + offset;
    const baseText = String(row?.[state.selectedBaseLanguage] ?? "");
    if (!baseText.trim()) {
      return;
    }

    const currentTranslations = {};
    (targetLangs || []).forEach((lang) => {
      const text = String(row?.[lang] ?? "");
      if (text.trim()) {
        currentTranslations[lang] = text;
      }
    });

    rows.push({
      role: "readonly_context",
      row: rowIndex,
      lineNumber: rowIndex + 1,
      key: keyColumn ? String(row?.[keyColumn] ?? "") : "",
      desc: currentDescCol ? String(row?.[currentDescCol] ?? "") : "",
      baseText,
      currentTranslations
    });
  });

  return rows;
}

export function clearLastTaskState() {
  resetTaskState();
}

export function refreshLastTaskStatusFromSnapshot() {
  if (!state.lastTaskSnapshot || !Array.isArray(state.lastTaskSnapshot.batches) || !state.lastTaskSnapshot.batches.length) {
    clearLastTaskState();
    return;
  }

  const completedBatchNumbers = new Set(state.lastTaskSnapshot.completedBatchNumbers || []);
  let contiguousCompleted = 0;
  for (let batchNumber = 1; batchNumber <= state.lastTaskSnapshot.batches.length; batchNumber += 1) {
    if (!completedBatchNumbers.has(batchNumber)) {
      break;
    }
    contiguousCompleted = batchNumber;
  }

  updateLastTaskStatus({
    type: state.lastTaskSnapshot.type,
    totalBatches: state.lastTaskSnapshot.batches.length,
    lastSuccessBatch: contiguousCompleted
  });
}

export function createTaskSnapshot(type, batches, settings) {
  patchState({
    lastTaskSnapshot: {
      type,
      batches: Array.isArray(batches) ? batches.slice() : [],
      settings: settings ? { ...settings } : {},
      completedBatchNumbers: []
    }
  });
  refreshLastTaskStatusFromSnapshot();
}

export function markBatchCompleted(batchNumber) {
  if (!state.lastTaskSnapshot) {
    return;
  }

  if (!state.lastTaskSnapshot.completedBatchNumbers.includes(batchNumber)) {
    state.lastTaskSnapshot.completedBatchNumbers.push(batchNumber);
    state.lastTaskSnapshot.completedBatchNumbers.sort((a, b) => a - b);
  }

  refreshLastTaskStatusFromSnapshot();
}

export function getPendingBatchItems() {
  if (!state.lastTaskSnapshot || !Array.isArray(state.lastTaskSnapshot.batches) || !state.lastTaskSnapshot.batches.length) {
    return [];
  }

  const completedBatchNumbers = new Set(state.lastTaskSnapshot.completedBatchNumbers || []);
  return state.lastTaskSnapshot.batches
    .map((batchData, index) => ({
      batchNumber: index + 1,
      batchData
    }))
    .filter(({ batchNumber }) => !completedBatchNumbers.has(batchNumber));
}

export function getNextPendingBatchNumber() {
  const pendingBatchItems = getPendingBatchItems();
  return pendingBatchItems.length ? pendingBatchItems[0].batchNumber : 0;
}

export function hasResumableTask() {
  return !state.isTranslating
    && Boolean(state.lastTaskStatus.type)
    && state.lastTaskStatus.totalBatches > 0
    && state.lastTaskStatus.lastSuccessBatch < state.lastTaskStatus.totalBatches
    && Boolean(state.lastTaskSnapshot)
    && getPendingBatchItems().length > 0;
}

export function formatBatchDispatchLabel(batchItems) {
  const batchNumbers = batchItems.map((item) => item.batchNumber);
  if (!batchNumbers.length) {
    return "";
  }

  if (batchNumbers.length === 1) {
    return "第 " + batchNumbers[0] + " 批请求";
  }

  const isContiguous = batchNumbers.every((batchNumber, index) => index === 0 || batchNumber === batchNumbers[index - 1] + 1);
  return isContiguous
    ? "第 " + batchNumbers[0] + " 到 " + batchNumbers[batchNumbers.length - 1] + " 批请求"
    : "未完成批次 " + batchNumbers.join(", ") + " 请求";
}

export function buildTranslationJobs(targetLangs, mode) {
  const currentDescColumnName = findDescColumnName(state.csvHeaders, state.descColumnName);
  const jobs = [];

  state.csvData.forEach((row, index) => {
    if (row?._selected === false) {
      return;
    }
    const baseText = String(row?.[state.selectedBaseLanguage] ?? "");
    if (!baseText.trim()) {
      return;
    }

    const rowMissingLangs = mode === "force-overwrite"
      ? targetLangs
      : targetLangs.filter((lang) => !String(row?.[lang] ?? "").trim());

    if (!rowMissingLangs.length) {
      return;
    }

    jobs.push({
      row: index,
      desc: currentDescColumnName ? String(row?.[currentDescColumnName] ?? "") : "",
      text: baseText,
      translateTo: rowMissingLangs
    });
  });

  return jobs;
}

export function buildProofreadJobs(targetLangs, options = {}) {
  const currentDescColumnName = findDescColumnName(state.csvHeaders, state.descColumnName);
  const keyColumnName = findKeyColumnName(state.csvHeaders);
  const jobs = [];
  const localFormatFindings = [];
  const shouldSkipFrozen = Boolean(options?.lqaFreezeEnabled);
  let skippedFrozenCells = 0;

  state.csvData.forEach((row, index) => {
    if (row?._selected === false) {
      return;
    }
    const baseText = String(row?.[state.selectedBaseLanguage] ?? "");
    if (!baseText.trim()) {
      return;
    }

    const currentTranslations = {};
    const preScanIssues = {};
    const descText = currentDescColumnName ? String(row?.[currentDescColumnName] ?? "") : "";
    targetLangs.forEach((lang) => {
      const currentText = String(row?.[lang] ?? "");
      if (currentText.trim()) {
        if (shouldSkipFrozen && isLqaCellFrozen(row, lang, baseText, descText, currentText)) {
          skippedFrozenCells += 1;
          return;
        }

        const formatIssues = getDeterministicFormatIssues(baseText, currentText);
        if (formatIssues.length) {
          localFormatFindings.push({
            row: index,
            lineNumber: index + 1,
            key: keyColumnName ? String(row?.[keyColumnName] ?? "") : "",
            lang,
            desc: descText,
            descColumnName: currentDescColumnName,
            baseText,
            currentText,
            note: buildLocalFormatIssueNote(formatIssues)
          });
          preScanIssues[lang] = formatIssues;
        }

        currentTranslations[lang] = currentText;
      }
    });

    if (!Object.keys(currentTranslations).length) {
      return;
    }

    jobs.push({
      role: "target",
      row: index,
      lineNumber: index + 1,
      key: keyColumnName ? String(row?.[keyColumnName] ?? "") : "",
      desc: descText,
      baseText,
      currentTranslations,
      ...(Object.keys(preScanIssues).length ? { preScanIssues } : {})
    });
  });

  jobs.skippedFrozenCells = skippedFrozenCells;
  jobs.localFormatFindings = localFormatFindings;
  return jobs;
}

export function buildDynamicBatches(jobs, maxBatchSize = CONSTANTS.TRANSLATION_BATCH_SIZE) {
  const batches = [];
  let currentBatch = [];
  let currentBatchCharCount = 0;

  jobs.forEach((job) => {
    const textLength = String(job.text ?? job.baseText ?? "").length;
    if (currentBatch.length > 0 && (currentBatch.length >= maxBatchSize || currentBatchCharCount + textLength > 1500)) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchCharCount = 0;
    }

    currentBatch.push(job);
    currentBatchCharCount += textLength;
  });

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export function createRequestAbortController() {
  const controller = new AbortController();
  activeAbortControllers.add(controller);
  return controller;
}

export function releaseRequestAbortController(controller) {
  activeAbortControllers.delete(controller);
}

export function abortActiveRequests() {
  let abortedCount = 0;
  activeAbortControllers.forEach((controller) => {
    if (!controller.signal.aborted) {
      controller.abort();
      abortedCount += 1;
    }
  });
  return abortedCount;
}

export function buildAbortedBatchResult(batchData, batchNumber, totalBatches) {
  return {
    success: false,
    aborted: true,
    batchNumber,
    totalBatches,
    batchData
  };
}

export function showStopTranslateButton() {
  const dom = getDom();
  dom.stopTranslateBtn?.classList.remove("hidden");
}

export function hideStopTranslateButton() {
  const dom = getDom();
  if (dom.stopTranslateBtn) {
    dom.stopTranslateBtn.disabled = false;
    dom.stopTranslateBtn.classList.add("hidden");
  }
}

export function beginQueueRun(activeButton, busyLabel) {
  const dom = getDom();
  activeAbortControllers.clear();
  patchState({ isTranslating: true });
  if (dom.translateBtn) dom.translateBtn.disabled = true;
  if (dom.proofreadBtn) dom.proofreadBtn.disabled = true;
  dom.commitBtn?.classList.add("hidden");
  dom.resumeTaskBtn?.classList.add("hidden");
  if (activeButton) {
    activeButton.textContent = busyLabel;
  }
  if (dom.stopTranslateBtn) {
    dom.stopTranslateBtn.disabled = false;
  }
  showStopTranslateButton();
}

export function endQueueRun(activeButton, originalLabel) {
  patchState({ isTranslating: false });
  if (activeButton) {
    activeButton.textContent = originalLabel;
  }
  hideStopTranslateButton();
  syncPendingLqaState({ hasResumableTask });
}

export async function waitForQueueDelay(ms) {
  const stepMs = 100;
  let elapsedMs = 0;
  while (state.isTranslating && elapsedMs < ms) {
    const delayMs = Math.min(stepMs, ms - elapsedMs);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    elapsedMs += delayMs;
  }
}

export async function executeTaskFromSnapshot(options) {
  const dom = getDom();
  const {
    type,
    activeButton,
    originalButtonLabel,
    busyLabel,
    taskLabel,
    startInfoMessage,
    groupStopMessage,
    batchRunner,
    applyResult,
    handleNotes
  } = options;

  if (!state.lastTaskSnapshot || state.lastTaskSnapshot.type !== type) {
    addLog("当前没有可继续的" + taskLabel + "任务。", "warning");
    clearLastTaskState();
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  const pendingBatchItems = getPendingBatchItems();
  if (!pendingBatchItems.length) {
    clearLastTaskState();
    syncPendingLqaState({ hasResumableTask });
    addLog("当前没有可继续的" + taskLabel + "批次。", "warning");
    return;
  }

  if (activeButton) {
    activeButton.disabled = true;
    activeButton.textContent = busyLabel;
  }
  if (dom.translateBtn) dom.translateBtn.disabled = true;
  if (dom.proofreadBtn) dom.proofreadBtn.disabled = true;
  if (dom.resumeTaskBtn) dom.resumeTaskBtn.disabled = true;

  const snapshotSettings = state.lastTaskSnapshot?.settings || {};
  if (!await validateSelectedChatModel(snapshotSettings.modelName, taskLabel + "模型", {
    apiKey: snapshotSettings.apiKey,
    baseUrl: snapshotSettings.baseUrl
  })) {
    if (activeButton) {
      activeButton.textContent = originalButtonLabel;
    }
    clearLastTaskState();
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  beginQueueRun(activeButton, busyLabel);
  let processedBatchCount = 0;
  let unchangedBatchCount = 0;
  let sessionTotalTokens = 0;
  let sessionModifiedCells = 0;

  try {
    const totalBatches = state.lastTaskSnapshot.batches.length;
    const concurrency = normalizeConcurrency(snapshotSettings.concurrency);
    const batchGroups = chunkArray(pendingBatchItems, concurrency);

    if (startInfoMessage) {
      addLog(startInfoMessage(totalBatches, concurrency, pendingBatchItems), "info");
    }

    let shouldStopAfterGroup = false;

    for (let groupIndex = 0; groupIndex < batchGroups.length; groupIndex += 1) {
      if (!state.isTranslating) {
        break;
      }

      const batchGroup = batchGroups[groupIndex];
      addLog("⏳ 正在向 AI 发送" + formatBatchDispatchLabel(batchGroup) + "...", "info");

      const results = await Promise.all(
        batchGroup.map(({ batchData, batchNumber }) => batchRunner(
          batchData,
          batchNumber,
          totalBatches,
          snapshotSettings
        ))
      );

      let groupTokenSum = 0;
      let groupFailed = false;
      let groupAborted = false;

      results.forEach((result) => {
        if (result?.aborted) {
          groupAborted = true;
          return;
        }

        if (!result?.success) {
          groupFailed = true;
          addLog(
            "第 " + result.batchNumber + "/" + result.totalBatches + " 批" + taskLabel + "失败：" + result.error.message,
            "error"
          );
          return;
        }

        const applyPayload = applyResult(result.batchData, result.resultMap);
        groupTokenSum += Number(result.consumedTokens) || 0;
        sessionTotalTokens += Number(result.consumedTokens) || 0;
        sessionModifiedCells += Number(applyPayload.cellsUpdated) || 0;
        markBatchCompleted(result.batchNumber);
        handleNotes?.(applyPayload, result);
        processedBatchCount += 1;

        if (applyPayload.cellsUpdated > 0) {
          addLog(
            "第 " + result.batchNumber + "/" + result.totalBatches + " 批" + taskLabel + "完成，已更新 "
              + applyPayload.rowsUpdated + " 行任务，"
              + applyPayload.cellsUpdated + " 个单元格。本批消耗 Token: "
              + result.consumedTokens,
            "success"
          );
        } else {
          unchangedBatchCount += 1;
        }
      });

      renderTableWithScrollPreservation(state.csvHeaders, state.csvData);
      updateStats(state.csvHeaders, state.csvData);
      patchState({ totalTokens: state.totalTokens + groupTokenSum });
      updateTokenLabel();

      if (groupFailed) {
        shouldStopAfterGroup = true;
      }

      if (groupAborted) {
        patchState({ isTranslating: false });
        addLog(groupStopMessage, "warning");
        break;
      }

      if (!state.isTranslating) {
        addLog(groupStopMessage, "warning");
        break;
      }

      if (shouldStopAfterGroup) {
        break;
      }

      if (groupIndex < batchGroups.length - 1) {
        await waitForQueueDelay(2000);
      }
    }

    const taskTypeName = type === "proofread" ? "校对" : "翻译";
    addLog("===========================================================================", "info", { className: "log-summary-divider" });
    addLog("🏁 ==== 本轮任务执行结束 ==== [" + taskTypeName + "]", "success", { className: "log-summary-title" });
    const summaryHtml = "📊 数据总览：共处理完成 <strong>"
      + processedBatchCount
      + "</strong> 个批次，跳过了 <strong>"
      + unchangedBatchCount
      + "</strong> 个无变动批次。实际修改/更新 <strong>"
      + sessionModifiedCells
      + "</strong> 个单元格。累计消耗 Token: <strong>"
      + sessionTotalTokens
      + "</strong>";
    addLog(summaryHtml, "info", { className: "log-summary-data", html: true });

    if (state.lastTaskSnapshot && getPendingBatchItems().length === 0) {
      clearLastTaskState();
    }
  } catch (error) {
    addLog("批量" + taskLabel + "失败: " + error.message, "error");
  } finally {
    endQueueRun(activeButton, originalButtonLabel);
  }
}

export function validateProofreadCandidate(item, lang, newText) {
  const baseText = String(item?.baseText ?? "");
  const currentText = String(item?.currentTranslations?.[lang] ?? "");
  const candidateText = String(newText ?? "");

  if (!candidateText.trim()) {
    return { ok: false, reason: "新译文为空" };
  }

  if (candidateText === currentText) {
    return { ok: false, reason: "新译文与当前译文完全相同" };
  }

  const checks = getDeterministicFormatIssues(baseText, candidateText);
  if (checks.length) {
    return { ok: false, reason: checks[0] };
  }

  if (isWesternLanguage(lang) && hasForbiddenFullwidthPunctuation(candidateText)) {
    return { ok: false, reason: "西欧/俄语目标语言中仍包含中文全角标点" };
  }

  return { ok: true, reason: "" };
}

export function formatLqaFindingReason(finding) {
  const issueType = String(finding?.issueType || "unknown");
  const severity = String(finding?.severity || "unknown");
  const issueLabel = LQA_ISSUE_TYPE_LABELS[issueType] || issueType;
  const severityLabel = LQA_SEVERITY_LABELS[severity] || severity;
  const evidence = String(finding?.evidence || "").trim();
  const decision = String(finding?.decision || "").trim();
  const reason = String(finding?.reason || "").trim();
  const parts = [];
  if (evidence) {
    parts.push("证据：" + evidence);
  }
  if (decision) {
    parts.push("判定：" + decision);
  }
  parts.push("说明：" + (reason || "模型未说明原因"));
  return "[" + severityLabel + " / " + issueLabel + "] " + parts.join("；");
}

export function normalizeProofreadResultMap(batchData, parsedResult, batchNumber, totalBatches) {
  if (!parsedResult || typeof parsedResult !== "object" || Array.isArray(parsedResult) || !Array.isArray(parsedResult.findings)) {
    throw new Error("模型校对结果缺少 findings 数组。");
  }

  const itemLookup = new Map();
  (batchData || []).forEach((item) => {
    Object.keys(item?.currentTranslations || {}).forEach((lang) => {
      itemLookup.set(String(item.row) + "\u0000" + lang, item);
    });
  });

  const resultMap = {};
  let ignoredFindingCount = 0;
  const blockedReasons = [];

  parsedResult.findings.forEach((finding) => {
    const row = Number(finding?.row);
    const lang = String(finding?.lang || "");
    const issueType = String(finding?.issueType || "");
    const severity = String(finding?.severity || "");
    const shouldApply = finding?.shouldApply === true;
    const item = itemLookup.get(String(row) + "\u0000" + lang);

    if (!item) {
      ignoredFindingCount += 1;
      return;
    }

    if (!shouldApply || !LQA_AUTO_APPLY_ISSUE_TYPES.has(issueType) || !LQA_AUTO_APPLY_SEVERITIES.has(severity)) {
      ignoredFindingCount += 1;
      return;
    }

    const normalizedNewText = normalizeNewlineRepresentationToBase(item?.baseText ?? "", finding?.newText);
    const validation = validateProofreadCandidate(item, lang, normalizedNewText);
    if (!validation.ok) {
      blockedReasons.push("行 " + (row + 1) + " / " + lang + ": " + validation.reason);
      return;
    }

    if (!resultMap[row]) {
      resultMap[row] = { _notes: {}, _details: {} };
    }
    resultMap[row]._details = resultMap[row]._details || {};

    const lqaDetail = normalizeLqaLogDetail({
      ...finding,
      note: formatLqaFindingReason(finding),
      source: "model"
    });
    resultMap[row][lang] = normalizedNewText;
    resultMap[row]._notes[lang] = lqaDetail.note;
    resultMap[row]._details[lang] = lqaDetail;
  });

  if (ignoredFindingCount > 0) {
    addLog("ℹ️ 第 " + batchNumber + "/" + totalBatches + " 批 LQA 忽略 " + ignoredFindingCount + " 条非自动修复建议或无效结果。", "info");
  }

  if (blockedReasons.length > 0) {
    const examples = blockedReasons.slice(0, 3).join("；");
    const suffix = blockedReasons.length > 3 ? " 等" : "";
    addLog("🧱 第 " + batchNumber + "/" + totalBatches + " 批 LQA 硬校验拦截 " + blockedReasons.length + " 条修改：" + examples + suffix, "warning");
  }

  return resultMap;
}

export function getMissingTranslationFields(batchData, resultMap) {
  const missingFields = [];

  (batchData || []).forEach((item) => {
    const rowResult = resultMap?.[String(item.row)] ?? resultMap?.[item.row];
    const targetLangs = Array.isArray(item?.translateTo) ? item.translateTo : [];

    if (!rowResult || typeof rowResult !== "object" || Array.isArray(rowResult)) {
      targetLangs.forEach((lang) => {
        missingFields.push({ row: item.row, lang });
      });
      return;
    }

    targetLangs.forEach((lang) => {
      const value = rowResult[lang];
      if (!(lang in rowResult) || value === undefined || value === null || String(value).trim() === "") {
        missingFields.push({ row: item.row, lang });
      }
    });
  });

  return missingFields;
}

export function assertCompleteTranslationResult(batchData, resultMap) {
  const missingFields = getMissingTranslationFields(batchData, resultMap);
  if (!missingFields.length) {
    return;
  }

  const examples = missingFields
    .slice(0, 5)
    .map(({ row, lang }) => "行 " + (Number(row) + 1) + " / " + lang)
    .join("；");
  const suffix = missingFields.length > 5 ? " 等" : "";
  throw new Error("模型返回缺少 " + missingFields.length + " 个必需翻译字段：" + examples + suffix);
}

export function applyBatchTranslations(batchData, resultMap) {
  let rowsUpdated = 0;
  let cellsUpdated = 0;
  const notes = [];

  batchData.forEach((item) => {
    const rowResult = resultMap?.[String(item.row)] ?? resultMap?.[item.row];
    if (!rowResult || typeof rowResult !== "object" || Array.isArray(rowResult)) {
      return;
    }

    let rowChanged = false;
    item.translateTo.forEach((lang) => {
      if (!(lang in rowResult) || rowResult[lang] === undefined || rowResult[lang] === null) {
        return;
      }

      const translatedText = String(rowResult[lang]);
      if (state.csvData[item.row][lang] !== translatedText) {
        state.csvData[item.row][lang] = translatedText;
        rowChanged = true;
        cellsUpdated += 1;
      }
    });

    const note = typeof rowResult._note === "string" ? rowResult._note.trim() : "";
    if (note) {
      notes.push({ row: item.row, note });
    }

    if (rowChanged) {
      rowsUpdated += 1;
    }
  });

  syncWindowState();
  return { rowsUpdated, cellsUpdated, notes };
}

export function applyBatchProofreading(batchData, resultMap) {
  const changedRows = new Set();
  let cellsUpdated = 0;
  const notes = [];
  let createdPendingHistory = false;

  batchData.forEach((item) => {
    const rowResult = resultMap?.[String(item.row)] ?? resultMap?.[item.row];
    const rowData = state.csvData[item.row];
    if (!rowData) {
      return;
    }

    rowData._lqaHistory = rowData._lqaHistory || {};
    const appliedLangs = new Set();
    let rowChanged = false;

    if (rowResult && typeof rowResult === "object" && !Array.isArray(rowResult)) {
      Object.keys(item.currentTranslations || {}).forEach((lang) => {
        if (!(lang in rowResult) || rowResult[lang] === undefined || rowResult[lang] === null) {
          return;
        }

        const proofreadText = String(rowResult[lang]);
        const oldText = String(rowData[lang] ?? "");
        if (oldText !== proofreadText) {
          const note = typeof rowResult._notes?.[lang] === "string"
            ? rowResult._notes[lang].trim()
            : (typeof rowResult._note === "string" ? rowResult._note.trim() : "");
          const detail = rowResult._details?.[lang]
            ? normalizeLqaLogDetail(rowResult._details[lang], { note, source: "model" })
            : normalizeLqaLogDetail(note, { note, source: "model" });
          rowData._lqaHistory[lang] = {
            originalText: oldText,
            aiText: proofreadText,
            note,
            lqaDetail: detail,
            baseLanguage: state.selectedBaseLanguage,
            baseText: item.baseText ?? "",
            descColumnName: findDescColumnName(state.csvHeaders, state.descColumnName),
            descText: item.desc ?? "",
            status: "ai",
            source: "model"
          };
          rowData[lang] = proofreadText;
          appliedLangs.add(lang);
          rowChanged = true;
          createdPendingHistory = true;
          cellsUpdated += 1;
          notes.push({ row: item.row, lang, note, source: "model", detail });
        }
      });
    }

    Object.keys(item.preScanIssues || {}).forEach((lang) => {
      if (appliedLangs.has(lang)) {
        return;
      }

      const currentText = String(rowData[lang] ?? "");
      if (!currentText.trim()) {
        return;
      }

      const remainingIssues = getDeterministicFormatIssues(item.baseText ?? "", currentText);
      if (!remainingIssues.length) {
        return;
      }

      const note = buildLocalFormatIssueNote(remainingIssues);
      const detail = normalizeLqaLogDetail({
        severity: "critical",
        issueType: "format_hard_error",
        severityLabel: "严重",
        issueLabel: "格式硬错误",
        evidence: remainingIssues.join("；"),
        decision: "模型未返回通过硬校验的修复，保留原译文等待人工确认。",
        reason: "本地格式预扫描确认该单元格仍存在格式不一致。",
        note,
        source: "local_format_scan"
      });
      rowData._lqaHistory[lang] = {
        originalText: currentText,
        aiText: currentText,
        note,
        lqaDetail: detail,
        baseLanguage: state.selectedBaseLanguage,
        baseText: item.baseText ?? "",
        descColumnName: findDescColumnName(state.csvHeaders, state.descColumnName),
        descText: item.desc ?? "",
        status: "original",
        source: "local_format_scan"
      };
      rowChanged = true;
      createdPendingHistory = true;
      cellsUpdated += 1;
      notes.push({ row: item.row, lang, note, source: "local_format_scan", detail });
    });

    if (rowChanged) {
      changedRows.add(item.row);
    } else if (rowData._lqaHistory && !Object.keys(rowData._lqaHistory).length) {
      delete rowData._lqaHistory;
    }
  });

  if (createdPendingHistory) {
    patchState({ hasPendingLQA: true });
  } else {
    syncWindowState();
  }

  return {
    rowsUpdated: changedRows.size,
    cellsUpdated,
    notes
  };
}

export function buildLqaFreezeRecord(baseText, descText, targetText, options = {}) {
  return {
    baseLanguage: options.baseLanguage || state.selectedBaseLanguage,
    descColumnName: options.descColumnName || findDescColumnName(state.csvHeaders, state.descColumnName),
    descText: String(descText ?? ""),
    baseText: String(baseText ?? ""),
    targetText: String(targetText ?? "")
  };
}

export function pruneEmptyLqaFreeze(row) {
  if (row?._lqaFreeze && !Object.keys(row._lqaFreeze).length) {
    delete row._lqaFreeze;
  }
}

export function setLqaFreeze(row, lang, baseText, descText, targetText, options = {}) {
  if (!row || !lang) {
    return;
  }

  row._lqaFreeze = row._lqaFreeze || {};
  row._lqaFreeze[lang] = buildLqaFreezeRecord(baseText, descText, targetText, options);
}

export function clearLqaFreeze(row, lang) {
  if (!row?._lqaFreeze || !lang) {
    return;
  }

  delete row._lqaFreeze[lang];
  pruneEmptyLqaFreeze(row);
}

export function isLqaCellFrozen(row, lang, baseText, descText, targetText) {
  const record = row?._lqaFreeze?.[lang];
  if (!record || typeof record !== "object") {
    return false;
  }

  const isMatch = record.baseLanguage === state.selectedBaseLanguage
    && record.descColumnName === findDescColumnName(state.csvHeaders, state.descColumnName)
    && record.descText === String(descText ?? "")
    && record.baseText === String(baseText ?? "")
    && record.targetText === String(targetText ?? "");

  if (!isMatch) {
    clearLqaFreeze(row, lang);
  }

  return isMatch;
}

export function commitPendingLqaChanges() {
  const dom = getDom();
  const shouldFreezeConfirmed = dom.settingsFreezeConfirmedLqa
    ? Boolean(dom.settingsFreezeConfirmedLqa.checked)
    : Boolean(state.lqaFreezeEnabled);
  const currentDescColumnName = findDescColumnName(state.csvHeaders, state.descColumnName);
  let frozenCellCount = 0;

  state.csvData.forEach((row) => {
    if (row && row._lqaHistory) {
      Object.entries(row._lqaHistory).forEach(([lang, history]) => {
        if (history?.status === "original") {
          row[lang] = history.originalText ?? "";
        } else {
          row[lang] = history?.aiText ?? row[lang] ?? "";
        }

        if (shouldFreezeConfirmed) {
          setLqaFreeze(
            row,
            lang,
            history?.baseText ?? row?.[state.selectedBaseLanguage] ?? "",
            history?.descText ?? (currentDescColumnName ? row?.[currentDescColumnName] ?? "" : ""),
            row?.[lang] ?? "",
            {
              baseLanguage: history?.baseLanguage || state.selectedBaseLanguage,
              descColumnName: history?.descColumnName || currentDescColumnName
            }
          );
          frozenCellCount += 1;
        } else {
          clearLqaFreeze(row, lang);
        }
      });
      delete row._lqaHistory;
    }
  });

  patchState({ hasPendingLQA: false });
  closeCommitModal();
  renderTableWithScrollPreservation(state.csvHeaders, state.csvData);
  updateStats(state.csvHeaders, state.csvData);
  syncPendingLqaState({ hasResumableTask });
  addLog("✅ 已保存并合并所有 LQA 修改。历史记录已清理。", "success");
  if (shouldFreezeConfirmed && frozenCellCount > 0) {
    addLog("🔒 已冻结 " + frozenCellCount + " 个确认后的 LQA 单元格；原文、Desc 或译文变化后会自动重新校对。", "info");
  }
}

export function discardAllLqaChanges() {
  if (!confirm("确定要放弃本轮所有的 LQA 修改吗？此操作将把所有标黄单元格恢复原样，且不可恢复。")) {
    return;
  }

  state.csvData.forEach((row) => {
    if (!row || !row._lqaHistory) {
      return;
    }

    Object.entries(row._lqaHistory).forEach(([lang, history]) => {
      row[lang] = history?.originalText ?? "";
    });

    delete row._lqaHistory;
  });

  patchState({ hasPendingLQA: false });
  closeCommitModal();
  renderTableWithScrollPreservation(state.csvHeaders, state.csvData);
  updateStats(state.csvHeaders, state.csvData);
  syncPendingLqaState({ hasResumableTask });
  addLog("🗑️ 用户已手动放弃本轮所有 LQA 修改，数据已恢复至校对前状态。", "warning");
}

export async function validateSelectedChatModel(modelId, actionLabel = "当前模型", options = {}) {
  const dom = getDom();
  const trimmedModelId = String(modelId || "").trim();
  if (!trimmedModelId) {
    addLog(actionLabel + "未填写，请先选择模型。", "error");
    return false;
  }

  const currentModelOptions = Array.from(dom.modelOptions?.options || []).map((option) => option.value);
  if (!currentModelOptions.includes(trimmedModelId)) {
    const currentApiKey = String(options.apiKey || dom.settingsApiKey?.value || state.apiKey || "").trim();
    const currentBaseUrl = String(options.baseUrl || dom.settingsBaseUrl?.value || state.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!currentApiKey) {
      addLog(actionLabel + "校验失败：缺少 API Key。", "error");
      return false;
    }

    addLog("⏳ 发现未知模型 [" + trimmedModelId + "]，正在自动校验其连通性...", "info");
    try {
      const probeResult = await probeModel(trimmedModelId, currentApiKey, currentBaseUrl);
      if (probeResult.compatible) {
        addLog("✅ [" + trimmedModelId + "] 校验通过，已自动放行。", "success");
        return true;
      }

      addLog("❌ 自动校验失败：模型 [" + trimmedModelId + "] 不支持当前工具的 Chat 接口，请求已终止。", "error");
      return false;
    } catch (error) {
      addLog("❌ 自动校验失败：模型 [" + trimmedModelId + "] 无法完成连通性探测（" + error.message + "），请求已终止。", "error");
      return false;
    }
  }

  return true;
}

export async function runTranslationBatch(batchData, batchNumber, totalBatches, settings) {
  const MAX_RETRIES = 3;
  const targetLangs = [...new Set(
    (batchData || []).flatMap((item) => Array.isArray(item?.translateTo) ? item.translateTo : [])
  )];
  const contextString = buildContextString(batchData?.[0]?.row ?? 0, targetLangs, settings.contextDepth);
  const controller = createRequestAbortController();

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const payload = await postChatCompletion(
          settings,
          buildTranslationRequestBody(batchData, settings, contextString),
          controller.signal
        );
        const rawContent = extractAnalysisResponse(payload);
        const resultMap = parseModelJsonObject(rawContent);
        assertCompleteTranslationResult(batchData, resultMap);

        return {
          success: true,
          batchNumber,
          totalBatches,
          batchData,
          resultMap,
          consumedTokens: Number(payload?.usage?.total_tokens) || 0
        };
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return buildAbortedBatchResult(batchData, batchNumber, totalBatches);
        }

        if (attempt < MAX_RETRIES) {
          addLog("⚠️ 第 " + batchNumber + "/" + totalBatches + " 批请求失败 (" + error.message + ")，正在进行第 " + attempt + " 次重试...", "warning");
          try {
            await waitWithAbort(attempt * 2000, controller.signal);
          } catch (waitError) {
            if (isAbortError(waitError) || controller.signal.aborted) {
              return buildAbortedBatchResult(batchData, batchNumber, totalBatches);
            }

            return { success: false, batchNumber, totalBatches, batchData, error: waitError };
          }
          continue;
        }

        return { success: false, batchNumber, totalBatches, batchData, error };
      }
    }
  } finally {
    releaseRequestAbortController(controller);
  }

  return { success: false, batchNumber, totalBatches, batchData, error: new Error("未知翻译批次状态") };
}

export async function runProofreadBatch(batchData, batchNumber, totalBatches, settings) {
  const MAX_RETRIES = 3;
  const deepMode = Boolean(settings?.isDeepMode);
  const deepTargetLangs = Array.isArray(batchData?.[0]?.translateTo) && batchData[0].translateTo.length
    ? batchData[0].translateTo
    : Object.keys(batchData?.[0]?.currentTranslations || {});
  const readonlyContextRows = deepMode
    ? buildReadonlyContextRows(batchData?.[0]?.row ?? 0, deepTargetLangs, settings.contextDepth)
    : [];
  const controller = createRequestAbortController();

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const payload = await postChatCompletion(
          settings,
          buildProofreadRequestBody(batchData, settings, readonlyContextRows),
          controller.signal
        );
        const rawContent = extractAnalysisResponse(payload);
        const parsedResult = parseModelJsonObject(rawContent);
        const resultMap = normalizeProofreadResultMap(batchData, parsedResult, batchNumber, totalBatches);

        return {
          success: true,
          batchNumber,
          totalBatches,
          batchData,
          resultMap,
          consumedTokens: Number(payload?.usage?.total_tokens) || 0
        };
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return buildAbortedBatchResult(batchData, batchNumber, totalBatches);
        }

        if (attempt < MAX_RETRIES) {
          addLog("⚠️ 第 " + batchNumber + "/" + totalBatches + " 批请求失败 (" + error.message + ")，正在进行第 " + attempt + " 次重试...", "warning");
          try {
            await waitWithAbort(attempt * 2000, controller.signal);
          } catch (waitError) {
            if (isAbortError(waitError) || controller.signal.aborted) {
              return buildAbortedBatchResult(batchData, batchNumber, totalBatches);
            }

            return { success: false, batchNumber, totalBatches, batchData, error: waitError };
          }
          continue;
        }

        return { success: false, batchNumber, totalBatches, batchData, error };
      }
    }
  } finally {
    releaseRequestAbortController(controller);
  }

  return { success: false, batchNumber, totalBatches, batchData, error: new Error("未知校对批次状态") };
}
