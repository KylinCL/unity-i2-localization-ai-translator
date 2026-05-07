import {
  CONSTANTS,
  STORAGE_KEYS,
  initializeStore,
  patchState,
  state,
  syncWindowState
} from "./store.js";
import {
  fetchModelList,
  extractAnalysisResponse,
  isLikelyTextModelId,
  postChatCompletion,
  probeModel
} from "./api.js";
import {
  abortActiveRequests,
  applyBatchProofreading,
  applyBatchTranslations,
  buildDynamicBatches,
  buildProofreadJobs,
  buildTranslationJobs,
  clearLastTaskState,
  commitPendingLqaChanges,
  createTaskSnapshot,
  discardAllLqaChanges,
  executeTaskFromSnapshot,
  getNextPendingBatchNumber,
  getSelectedTargetLanguages,
  hasResumableTask,
  runProofreadBatch,
  runTranslationBatch,
  validateSelectedChatModel
} from "./runner.js";
import {
  addLog,
  addTaskDividerLog,
  buildCellElementId,
  buildCommitSummaryHtml,
  buildLogElementId,
  buildLqaLogClassName,
  buildLqaLogHtml,
  closeCommitModal,
  closePromptModal,
  closeSettingsModal,
  flashAfterSmartScroll,
  getDom,
  hideLogScrollTip,
  initDomRefs,
  isLogViewAtBottom,
  normalizeLqaLogDetail,
  openCommitModal,
  openPromptModal,
  openSettingsModal,
  renderEmptyTableState,
  renderLanguageConfig,
  renderModelOptions,
  renderTable,
  renderTableWithScrollPreservation,
  scrollLogViewToBottom,
  setDropZoneActive,
  syncAllVisibleRowSelectionDom,
  syncPendingLqaState,
  syncSelectAllCheckboxState,
  syncSelectionUi,
  syncSettingsForm,
  updateApiKeyVisibility,
  updatePromptPreview,
  updateStats,
  updateStepperButtons,
  updateTokenLabel
} from "./ui.js";
import {
  buildExportRows,
  findDescColumnName,
  getStoredBoolean,
  getStoredValue,
  normalizeBaseUrl,
  normalizeConcurrency,
  normalizeContextDepth
} from "./utils.js";

function on(element, eventName, handler) {
  element?.addEventListener(eventName, handler);
}

function setCsvData(parsedRows) {
  const csvData = (parsedRows || []).map((row) => {
    if (!row || typeof row !== "object") {
      return row;
    }
    return {
      ...row,
      _selected: row._selected !== false
    };
  });

  patchState({
    csvData,
    lastCheckedIndex: null,
    hasPendingLQA: false
  });
  clearLastTaskState();
  const dom = getDom();
  if (dom.commitModal?.classList.contains("show")) {
    closeCommitModal();
  }
  syncPendingLqaState({ hasResumableTask });
}

function getStoredValueWithLog(key, fallbackValue) {
  return getStoredValue(key, fallbackValue, (error) => {
    addLog("读取本地设置失败: " + error.message, "warning");
  });
}

function loadSettingsFromStorage() {
  const dom = getDom();
  patchState({
    apiKey: getStoredValueWithLog(STORAGE_KEYS.apiKey, ""),
    baseUrl: getStoredValueWithLog(STORAGE_KEYS.baseUrl, "https://api.openai.com/v1"),
    modelName: getStoredValueWithLog(STORAGE_KEYS.modelName, "GPT-5.4"),
    descColumnName: (getStoredValueWithLog(STORAGE_KEYS.descColumnName, "Desc").trim() || "Desc"),
    settingsConcurrency: normalizeConcurrency(getStoredValueWithLog(STORAGE_KEYS.concurrency, "5")),
    contextDepth: normalizeContextDepth(getStoredValueWithLog(STORAGE_KEYS.contextDepth, "50")),
    lqaFreezeEnabled: getStoredBoolean(STORAGE_KEYS.lqaFreezeEnabled, false, (error) => {
      addLog("读取本地设置失败: " + error.message, "warning");
    })
  });

  const storedSystemPrompt = getStoredValueWithLog(STORAGE_KEYS.systemPrompt, null);
  if (storedSystemPrompt !== null && dom.systemPrompt) {
    dom.systemPrompt.value = storedSystemPrompt;
  }
}

function isLqaFreezeSettingEnabled() {
  const dom = getDom();
  return dom.settingsFreezeConfirmedLqa
    ? Boolean(dom.settingsFreezeConfirmedLqa.checked)
    : Boolean(state.lqaFreezeEnabled);
}

function getAnalysisSettings() {
  const dom = getDom();
  const currentApiKey = dom.settingsApiKey?.value.trim()
    || state.apiKey
    || getStoredValueWithLog(STORAGE_KEYS.apiKey, "");
  const currentBaseUrl = normalizeBaseUrl(dom.settingsBaseUrl?.value)
    || normalizeBaseUrl(state.baseUrl)
    || "https://api.openai.com/v1";
  const currentModelName = dom.settingsModelName?.value.trim()
    || state.modelName
    || getStoredValueWithLog(STORAGE_KEYS.modelName, "GPT-5.4");

  return {
    apiKey: currentApiKey,
    baseUrl: currentBaseUrl,
    modelName: currentModelName
  };
}

function getTranslationSettings() {
  const dom = getDom();
  const currentSettings = getAnalysisSettings();
  const currentSystemPrompt = dom.systemPrompt?.value.trim() || CONSTANTS.DEFAULT_TRANSLATION_SYSTEM_PROMPT;
  const currentConcurrency = normalizeConcurrency(dom.settingsConcurrencyInput?.value || state.settingsConcurrency || getStoredValueWithLog(STORAGE_KEYS.concurrency, "5"));
  const currentContextDepth = normalizeContextDepth(dom.settingsContextDepthInput?.value || state.contextDepth || getStoredValueWithLog(STORAGE_KEYS.contextDepth, "50"));

  return {
    ...currentSettings,
    systemPrompt: currentSystemPrompt,
    concurrency: currentConcurrency,
    contextDepth: currentContextDepth,
    lqaFreezeEnabled: isLqaFreezeSettingEnabled()
  };
}

function saveSettings() {
  const dom = getDom();
  const nextState = {
    apiKey: dom.settingsApiKey?.value.trim() || "",
    baseUrl: normalizeBaseUrl(dom.settingsBaseUrl?.value) || "https://api.openai.com/v1",
    modelName: dom.settingsModelName?.value.trim() || "GPT-5.4",
    descColumnName: dom.settingsDescColumnName?.value.trim() || "Desc",
    settingsConcurrency: normalizeConcurrency(dom.settingsConcurrencyInput?.value),
    contextDepth: normalizeContextDepth(dom.settingsContextDepthInput?.value),
    lqaFreezeEnabled: Boolean(dom.settingsFreezeConfirmedLqa?.checked)
  };

  patchState(nextState);
  if (dom.settingsDescColumnName) dom.settingsDescColumnName.value = nextState.descColumnName;
  if (dom.settingsConcurrencyInput) dom.settingsConcurrencyInput.value = nextState.settingsConcurrency;
  if (dom.settingsContextDepthInput) dom.settingsContextDepthInput.value = nextState.contextDepth;
  updateStepperButtons();

  try {
    localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
    localStorage.setItem(STORAGE_KEYS.baseUrl, state.baseUrl);
    localStorage.setItem(STORAGE_KEYS.modelName, state.modelName);
    localStorage.setItem(STORAGE_KEYS.descColumnName, state.descColumnName);
    localStorage.setItem(STORAGE_KEYS.concurrency, String(state.settingsConcurrency));
    localStorage.setItem(STORAGE_KEYS.contextDepth, String(state.contextDepth));
    localStorage.setItem(STORAGE_KEYS.systemPrompt, dom.systemPrompt?.value || "");
    localStorage.setItem(STORAGE_KEYS.lqaFreezeEnabled, String(state.lqaFreezeEnabled));
    addLog("偏好设置已保存到 localStorage。", "success");
  } catch (error) {
    addLog("保存本地设置失败: " + error.message, "error");
  }

  closeSettingsModal();
}

function clearStoredSettings() {
  const confirmed = window.confirm("确定要清空本地缓存吗？这会删除 API Key、Base URL、模型、并发设置、Desc 字段名、背景设定和 LQA 冻结开关。当前已导入的 CSV 数据不会被清空。");
  if (!confirmed) {
    return;
  }

  const dom = getDom();
  try {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    addLog("清空本地缓存失败: " + error.message, "error");
    return;
  }

  state.csvData.forEach((row) => {
    if (row && row._lqaFreeze) {
      delete row._lqaFreeze;
    }
  });

  patchState({
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    modelName: "GPT-5.4",
    descColumnName: "Desc",
    settingsConcurrency: 5,
    contextDepth: 50,
    lqaFreezeEnabled: false,
    csvData: state.csvData
  });

  if (dom.systemPrompt) {
    dom.systemPrompt.value = "";
  }
  syncSettingsForm();
  updatePromptPreview();
  addLog("已清空 API Key 与本地偏好缓存。", "success");
}

function getModelOptionIds() {
  const dom = getDom();
  return Array.from(dom.modelOptions?.options || [])
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);
}

async function refreshModelList() {
  const dom = getDom();
  const currentApiKey = dom.settingsApiKey?.value.trim() || "";
  const currentBaseUrl = normalizeBaseUrl(dom.settingsBaseUrl?.value) || "https://api.openai.com/v1";

  if (!currentApiKey) {
    addLog("刷新模型列表失败：请先填写 API Key。", "error");
    return;
  }

  if (dom.refreshModelsBtn) {
    dom.refreshModelsBtn.disabled = true;
    dom.refreshModelsBtn.textContent = "刷新中...";
  }
  addLog("正在获取模型列表: " + currentBaseUrl + "/models", "info");

  try {
    const payload = await fetchModelList(currentApiKey, currentBaseUrl);
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.data)
        ? payload.data.data
        : [];
    const modelIds = rawModels
      .map((item) => item && item.id ? String(item.id) : "")
      .filter(Boolean);
    const candidateModelIds = modelIds.filter((modelId) => isLikelyTextModelId(modelId));

    if (!candidateModelIds.length) {
      throw new Error("返回结果中没有可用的模型 ID。");
    }

    renderModelOptions(candidateModelIds, false);
    const filteredCount = modelIds.length - candidateModelIds.length;
    const filteredHint = filteredCount > 0
      ? "，已粗略排除 " + filteredCount + " 个明显非文本模型"
      : "";
    addLog("模型列表刷新成功，共载入 " + candidateModelIds.length + " 个候选模型" + filteredHint + "。", "success");
  } catch (error) {
    addLog("获取模型列表失败: " + error.message, "error");
  } finally {
    if (dom.refreshModelsBtn) {
      dom.refreshModelsBtn.disabled = false;
      dom.refreshModelsBtn.textContent = "刷新 🔄";
    }
  }
}

async function verifyAllModels() {
  const dom = getDom();
  const currentApiKey = dom.settingsApiKey?.value.trim() || "";
  const currentBaseUrl = normalizeBaseUrl(dom.settingsBaseUrl?.value) || "https://api.openai.com/v1";
  const candidateModelIds = getModelOptionIds();

  if (!currentApiKey) {
    addLog("批量校验失败：请先填写 API Key。", "error");
    return;
  }

  if (!candidateModelIds.length) {
    addLog("当前没有可校验的模型候选，请先点击刷新。", "warning");
    return;
  }

  const restoreUiState = () => {
    if (dom.refreshModelsBtn) dom.refreshModelsBtn.disabled = false;
    if (dom.verifyModelsBtn) {
      dom.verifyModelsBtn.disabled = false;
      dom.verifyModelsBtn.textContent = "批量校验";
    }
    if (dom.analyzeContextBtn) dom.analyzeContextBtn.disabled = false;
    syncPendingLqaState({ hasResumableTask });
  };

  if (dom.refreshModelsBtn) dom.refreshModelsBtn.disabled = true;
  if (dom.verifyModelsBtn) dom.verifyModelsBtn.disabled = true;
  if (dom.analyzeContextBtn) dom.analyzeContextBtn.disabled = true;
  if (dom.translateBtn) dom.translateBtn.disabled = true;
  if (dom.proofreadBtn) dom.proofreadBtn.disabled = true;
  if (dom.resumeTaskBtn) dom.resumeTaskBtn.disabled = true;

  let completedCount = 0;
  const totalCount = candidateModelIds.length;
  const compatibleIds = [];

  try {
    const PROBE_CONCURRENCY = 4;
    const PROBE_DELAY_MS = 400;

    for (let index = 0; index < candidateModelIds.length; index += PROBE_CONCURRENCY) {
      const modelChunk = candidateModelIds.slice(index, index + PROBE_CONCURRENCY);
      const probeResults = await Promise.all(modelChunk.map(async (modelId) => {
        try {
          const result = await probeModel(modelId, currentApiKey, currentBaseUrl);
          return { modelId, compatible: result.compatible };
        } catch (error) {
          return { modelId, error };
        }
      }));

      for (const result of probeResults) {
        completedCount += 1;
        if (dom.verifyModelsBtn) {
          dom.verifyModelsBtn.textContent = "校验中 (" + completedCount + "/" + totalCount + ")...";
        }

        if (result.error) {
          throw result.error;
        }

        if (result.compatible) {
          compatibleIds.push(result.modelId);
        }
      }

      if (index + PROBE_CONCURRENCY < candidateModelIds.length) {
        await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS));
      }
    }

    renderModelOptions(compatibleIds, false);
    addLog("✅ 批量校验完成，共发现 " + compatibleIds.length + " 个完美兼容当前工具的模型，已更新至列表。", "success");
  } catch (error) {
    addLog("批量校验失败：" + error.message + "，已保留当前模型列表。", "error");
  } finally {
    restoreUiState();
  }
}

function buildAnalysisTextRows(baseLanguage) {
  const currentDescColumnName = findDescColumnName(state.csvHeaders, state.descColumnName);
  const availableRows = [];

  state.csvData.forEach((row) => {
    const baseText = String(row?.[baseLanguage] ?? "").replace(/\s+/g, " ").trim();
    if (!baseText) {
      return;
    }

    const descText = currentDescColumnName
      ? String(row?.[currentDescColumnName] ?? "").replace(/\s+/g, " ").trim()
      : "";

    availableRows.push(`[Desc: ${descText}] ${baseText}`);
  });

  return {
    descColumnName: currentDescColumnName,
    totalRows: availableRows.length,
    wasTruncated: availableRows.length > CONSTANTS.ANALYSIS_MAX_ROWS,
    rows: availableRows.slice(0, CONSTANTS.ANALYSIS_MAX_ROWS)
  };
}

async function startContextAnalysisRequest() {
  const dom = getDom();
  if (state.analysisTimer) {
    clearInterval(state.analysisTimer);
    patchState({ analysisTimer: null });
  }

  if (!state.csvData.length || !state.csvHeaders.length) {
    addLog("请先上传并解析 CSV 文件，再进行全文分析。", "error");
    return;
  }

  if (!state.selectedBaseLanguage) {
    addLog("请先在语言配置中选择基准语言。", "error");
    return;
  }

  const { apiKey, baseUrl, modelName } = getAnalysisSettings();
  if (!apiKey) {
    addLog("请先在偏好设置中填写 API Key，再进行全文分析。", "error");
    return;
  }

  const originalButtonLabel = dom.analyzeContextBtn?.textContent || "全文分析";
  if (dom.analyzeContextBtn) {
    dom.analyzeContextBtn.disabled = true;
    dom.analyzeContextBtn.textContent = "分析中...";
  }

  if (!await validateSelectedChatModel(modelName, "全文分析模型", { apiKey, baseUrl })) {
    if (dom.analyzeContextBtn) {
      dom.analyzeContextBtn.disabled = false;
      dom.analyzeContextBtn.textContent = originalButtonLabel;
    }
    return;
  }

  const analysisRows = buildAnalysisTextRows(state.selectedBaseLanguage);
  if (!analysisRows.rows.length) {
    if (dom.analyzeContextBtn) {
      dom.analyzeContextBtn.disabled = false;
      dom.analyzeContextBtn.textContent = originalButtonLabel;
    }
    addLog("当前基准语言列没有可用于分析的文本内容。", "error");
    return;
  }

  if (analysisRows.wasTruncated) {
    addLog("可分析文本超过 3000 行，已自动截取前 3000 行以避免超出模型上下文上限。", "warning");
  }

  const userPrompt = "这是我们悬疑解谜游戏的核心文本。请阅读并提炼出用于指导后续AI翻译的全局背景设定。\n"
    + "【极其重要：为了节省Token，请务必使用极其精简、高信息密度的格式输出，总字符数绝对不能超过 1000 字！去掉所有多余的解释、排版和客套话。】\n"
    + "请严格按照以下格式输出：\n"
    + "[核心背景] 用关键词高度提炼故事世界观与氛围。\n"
    + "[人物画像] 用少量形容词概括主要人物（如里格斯、威尔等）的说话语气。\n"
    + "[Desc文风] 严格规定不同Desc（如Name、Guide、Tips、Item、Comment、Click、Reason、Aside）的翻译基调（名称/引导/提示/道具/旁白/按钮/原因说明等）。\n"
    + "[关键原则] 总结本地化翻译的绝对禁忌与核心重点（如保持悬疑感、保留黑色幽默等）。\n"
    + "---核心术语表---\n"
    + "【核心高频专有名词表（Top 30）】：只提取在文本中多次出现、具有独特代表性、且极容易导致跨章节翻译不一致的关键专有名词。仅限关键道具名、角色名/称谓、特殊地名或 UI 专有名词。绝对不要提取普通词汇（如“苹果”“跑”“剑”等非特指词汇）。若不足 30 条则按实际提取，不要为了凑数加入普通词。\n"
    + "术语表输出格式必须为清晰列表，例如：- [原文名词] = [简短说明及建议倾向]\n"
    + "文本内容如下：\n"
    + analysisRows.rows.join("\n");

  addLog("🚀 正在分析全文剧情，请稍候...（这可能需要几十秒）", "info");

  try {
    const payload = await postChatCompletion(
      { apiKey, baseUrl },
      {
        model: modelName,
        messages: [
          { role: "system", content: CONSTANTS.ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ]
      }
    );

    const analysisContent = extractAnalysisResponse(payload);
    if (!analysisContent) {
      throw new Error("接口返回成功，但没有拿到有效的分析正文。");
    }

    if (dom.systemPrompt) {
      dom.systemPrompt.value = analysisContent;
    }
    patchState({
      promptDraftValue: analysisContent,
      totalTokens: state.totalTokens + (Number(payload?.usage?.total_tokens) || 0)
    });
    updatePromptPreview();
    updateTokenLabel();

    addLog("✅ 全文背景分析完成，已自动填入设定区！本次消耗 Token: " + (Number(payload?.usage?.total_tokens) || 0), "success");
  } catch (error) {
    addLog("全文背景分析失败: " + error.message, "error");
  } finally {
    if (dom.analyzeContextBtn) {
      dom.analyzeContextBtn.disabled = false;
      dom.analyzeContextBtn.textContent = originalButtonLabel;
    }
  }
}

function handleCsvFile(file) {
  const dom = getDom();
  if (!file) {
    return;
  }

  if (dom.fileMeta) {
    dom.fileMeta.textContent = file.name + " (" + Math.max(1, Math.round(file.size / 1024)) + " KB)";
  }
  addLog("开始解析文件: " + file.name, "info");

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete(results) {
      const headers = results.meta.fields || [];
      const rows = (results.data || []).filter((row) =>
        Object.values(row).some((value) => String(value ?? "").trim() !== "")
      );

      patchState({ csvHeaders: headers });
      setCsvData(rows);
      renderTable(state.csvHeaders, state.csvData);
      updateStats(state.csvHeaders, state.csvData);
      renderLanguageConfig(state.csvHeaders, languageConfigCallbacks);

      if (results.errors && results.errors.length) {
        addLog("解析完成，但发现 " + results.errors.length + " 个格式问题。", "warning");
        results.errors.slice(0, 3).forEach((error) => {
          addLog("第 " + (error.row ?? "?") + " 行: " + error.message, "warning");
        });
      } else {
        addLog("CSV 解析成功，已载入 " + state.csvData.length + " 行数据。", "success");
      }

      if (!headers.length) {
        addLog("未检测到表头，请确认第一行为字段名。", "error");
      } else {
        addLog("检测到表头: " + headers.join(", "), "info");
      }
    },
    error(error) {
      patchState({ csvHeaders: [] });
      setCsvData([]);
      renderLanguageConfig(state.csvHeaders, languageConfigCallbacks);
      renderEmptyTableState("CSV 解析失败", "请检查文件格式或编码后重试。");
      updateStats(state.csvHeaders, state.csvData);
      addLog("CSV 解析失败: " + error.message, "error");
    }
  });
}

function exportCsvFile() {
  if (state.hasPendingLQA) {
    alert("请先审阅并保存 LQA 修改结果！");
    return;
  }

  if (!Array.isArray(state.csvData) || state.csvData.length === 0) {
    addLog("当前没有可导出的数据，请先导入并成功解析 CSV/TXT 文件。", "warning");
    return;
  }

  const rowsForExport = buildExportRows(state.csvHeaders, state.csvData);
  const csvContent = Papa.unparse(rowsForExport, {
    columns: state.csvHeaders.length ? state.csvHeaders : undefined
  });
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/plain;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "Translated_Localization.csv.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);

  addLog("导出完成: Translated_Localization.csv.txt", "success");
}

function openFilePicker() {
  const dom = getDom();
  if (dom.csvFileInput) {
    dom.csvFileInput.value = "";
    dom.csvFileInput.click();
  }
}

function handleFileSelection(file, source) {
  if (!file) {
    addLog("未检测到可用文件。", "warning");
    return;
  }

  addLog("收到" + source + "文件: " + file.name, "info");
  handleCsvFile(file);
}

function handleProofreadNotes(applyPayload) {
  applyPayload.notes.forEach(({ row, lang, note, source, detail }) => {
    const actionLabel = source === "local_format_scan" ? "LQA 提醒" : "LQA 修正";
    const logDetail = detail || normalizeLqaLogDetail(note || "已根据 LQA 规则完成修正。", { note, source });
    addLog(buildLqaLogHtml(row, lang, logDetail, actionLabel), "info", {
      html: true,
      className: buildLqaLogClassName(logDetail, source),
      id: buildLogElementId(row, lang)
    });
  });
}

async function startTranslationRequest(options = {}) {
  const dom = getDom();
  const isResume = options?.resume === true;
  const originalButtonLabel = dom.translateBtn?.textContent || "开始翻译";

  if (isResume) {
    if (!state.lastTaskSnapshot || state.lastTaskSnapshot.type !== "translation") {
      clearLastTaskState();
      syncPendingLqaState({ hasResumableTask });
      addLog("当前没有可继续的翻译任务。", "warning");
      return;
    }

    const nextPendingBatchNumber = getNextPendingBatchNumber();
    if (!nextPendingBatchNumber) {
      clearLastTaskState();
      syncPendingLqaState({ hasResumableTask });
      addLog("当前没有可继续的翻译批次。", "warning");
      return;
    }

    await executeTaskFromSnapshot({
      type: "translation",
      activeButton: dom.translateBtn,
      originalButtonLabel,
      busyLabel: "翻译中...",
      taskLabel: "翻译",
      startInfoMessage(totalBatches, concurrency, pendingBatchItems) {
        return "🚀 正在继续剩余的 " + pendingBatchItems.length + " 批翻译任务，总批次: " + totalBatches + "，并发数: " + concurrency + "...";
      },
      groupStopMessage: "⚠️ 翻译队列已在当前并发组后停止。",
      batchRunner: runTranslationBatch,
      applyResult: applyBatchTranslations,
      handleNotes(applyPayload) {
        applyPayload.notes.forEach(({ row, note }) => {
          addLog("💡 行 [" + (row + 1) + "] AI 巧思：" + note, "success");
        });
      }
    });
    return;
  }

  if (!state.csvData.length || !state.csvHeaders.length) {
    addLog("请先上传并解析 CSV 文件，再开始翻译。", "error");
    return;
  }

  if (!state.selectedBaseLanguage) {
    addLog("请先在语言配置中选择基准语言。", "error");
    return;
  }

  const targetLangs = getSelectedTargetLanguages();
  if (!targetLangs.length) {
    addLog("请至少勾选一个目标语言。", "error");
    return;
  }

  const isDeepMode = Boolean(dom.deepLqaModeToggle?.checked);
  if (isDeepMode && targetLangs.length !== 1) {
    addLog("⚠️ 深度精修模式下，为了保证 AI 注意力，请在左侧仅勾选【一个】目标语言！", "error");
    return;
  }

  const settings = getTranslationSettings();
  if (!settings.apiKey) {
    addLog("请先在偏好设置中填写 API Key，再开始翻译。", "error");
    return;
  }

  clearLastTaskState();

  const mode = document.querySelector('input[name="mode"]:checked')?.value || "translate-empty";
  const translationJobs = buildTranslationJobs(targetLangs, mode);
  if (!translationJobs.length) {
    addLog("当前没有需要翻译的单元格。", "warning");
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  const batches = buildDynamicBatches(translationJobs);
  if (!batches.length) {
    addLog("当前没有可发送的翻译批次。", "warning");
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  createTaskSnapshot("translation", batches, settings);
  addTaskDividerLog("翻译");
  await executeTaskFromSnapshot({
    type: "translation",
    activeButton: dom.translateBtn,
    originalButtonLabel,
    busyLabel: "翻译中...",
    taskLabel: "翻译",
    startInfoMessage(totalBatches, currentConcurrency) {
      return "🚀 任务已动态切分为 " + totalBatches + " 批，并发数: " + currentConcurrency + "...";
    },
    groupStopMessage: "⚠️ 翻译队列已在当前并发组后停止。",
    batchRunner: runTranslationBatch,
    applyResult: applyBatchTranslations,
    handleNotes(applyPayload) {
      applyPayload.notes.forEach(({ row, note }) => {
        addLog("💡 行 [" + (row + 1) + "] AI 巧思：" + note, "success");
      });
    }
  });
}

async function startProofreadRequest(options = {}) {
  const dom = getDom();
  const isResume = options?.resume === true;
  const originalButtonLabel = dom.proofreadBtn?.textContent || "开始校对";

  if (isResume) {
    if (!state.lastTaskSnapshot || state.lastTaskSnapshot.type !== "proofread") {
      clearLastTaskState();
      syncPendingLqaState({ hasResumableTask });
      addLog("当前没有可继续的校对任务。", "warning");
      return;
    }

    const nextPendingBatchNumber = getNextPendingBatchNumber();
    if (!nextPendingBatchNumber) {
      clearLastTaskState();
      syncPendingLqaState({ hasResumableTask });
      addLog("当前没有可继续的校对批次。", "warning");
      return;
    }

    await executeTaskFromSnapshot({
      type: "proofread",
      activeButton: dom.proofreadBtn,
      originalButtonLabel,
      busyLabel: "校对中...",
      taskLabel: "校对",
      startInfoMessage(totalBatches, concurrency, pendingBatchItems) {
        return "🚀 正在继续剩余的 " + pendingBatchItems.length + " 批校对任务，总批次: " + totalBatches + "，并发数: " + concurrency + "...";
      },
      groupStopMessage: "⚠️ 校对队列已在当前并发组后停止。",
      batchRunner: runProofreadBatch,
      applyResult: applyBatchProofreading,
      handleNotes: handleProofreadNotes
    });
    return;
  }

  if (!state.csvData.length || !state.csvHeaders.length) {
    addLog("请先上传并解析 CSV 文件，再开始校对。", "error");
    return;
  }

  if (!state.selectedBaseLanguage) {
    addLog("请先在语言配置中选择基准语言。", "error");
    return;
  }

  const targetLangs = getSelectedTargetLanguages();
  if (!targetLangs.length) {
    addLog("请至少勾选一个目标语言。", "error");
    return;
  }

  const isDeepMode = Boolean(dom.deepLqaModeToggle?.checked);
  if (isDeepMode && targetLangs.length !== 1) {
    addLog("⚠️ 深度精修模式下，为了保证 AI 注意力，请在左侧仅勾选【一个】目标语言！", "error");
    return;
  }

  const settings = getTranslationSettings();
  if (!settings.apiKey) {
    addLog("请先在偏好设置中填写 API Key，再开始校对。", "error");
    return;
  }

  clearLastTaskState();

  const proofreadJobs = buildProofreadJobs(targetLangs, {
    lqaFreezeEnabled: settings.lqaFreezeEnabled
  });
  if (proofreadJobs.localFormatFindings.length > 0) {
    addLog("🧱 本地格式预扫描发现 " + proofreadJobs.localFormatFindings.length + " 个硬格式问题，已随校对请求发送给模型合并修复。", "warning");
  }
  if (settings.lqaFreezeEnabled && proofreadJobs.skippedFrozenCells > 0) {
    addLog("🔒 已跳过 " + proofreadJobs.skippedFrozenCells + " 个已冻结且未变化的 LQA 单元格。", "info");
  }
  if (!proofreadJobs.length) {
    addLog("当前没有需要校对的单元格。", "warning");
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  const batches = buildDynamicBatches(proofreadJobs, isDeepMode ? 10 : CONSTANTS.TRANSLATION_BATCH_SIZE);
  if (!batches.length) {
    addLog("当前没有可发送的校对批次。", "warning");
    syncPendingLqaState({ hasResumableTask });
    return;
  }

  createTaskSnapshot("proofread", batches, {
    ...settings,
    isDeepMode
  });

  addTaskDividerLog("校对");
  await executeTaskFromSnapshot({
    type: "proofread",
    activeButton: dom.proofreadBtn,
    originalButtonLabel,
    busyLabel: "校对中...",
    taskLabel: "校对",
    startInfoMessage(totalBatches, currentConcurrency) {
      return "🚀 校对任务已动态切分为 " + totalBatches + " 批，并发数: " + currentConcurrency + "...";
    },
    groupStopMessage: "⚠️ 校对队列已在当前并发组后停止。",
    batchRunner: runProofreadBatch,
    applyResult: applyBatchProofreading,
    handleNotes: handleProofreadNotes
  });
}

function bindEvents() {
  const dom = getDom();

  ["dragover", "drop"].forEach((eventName) => {
    window.addEventListener(eventName, (event) => {
      event.preventDefault();
    });
  });

  on(dom.dropZone, "click", (event) => {
    if (!event.target.closest(".file-input")) {
      openFilePicker();
    }
  });
  on(dom.dropZone, "keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  });
  on(dom.dropZone, "dragenter", (event) => {
    event.preventDefault();
    patchState({ dragDepth: state.dragDepth + 1 });
    setDropZoneActive(true);
  });
  on(dom.dropZone, "dragover", (event) => {
    event.preventDefault();
    setDropZoneActive(true);
  });
  on(dom.dropZone, "dragleave", (event) => {
    event.preventDefault();
    const nextDragDepth = Math.max(0, state.dragDepth - 1);
    patchState({ dragDepth: nextDragDepth });
    if (nextDragDepth === 0) {
      setDropZoneActive(false);
    }
  });
  on(dom.dropZone, "drop", (event) => {
    event.preventDefault();
    patchState({ dragDepth: 0 });
    setDropZoneActive(false);
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    handleFileSelection(file, "拖拽");
  });
  on(dom.csvFileInput, "change", (event) => {
    handleFileSelection(event.target.files[0], "选择");
  });

  on(dom.editPromptBtn, "click", openPromptModal);
  on(dom.promptCancelBtn, "click", () => {
    if (dom.systemPrompt) {
      dom.systemPrompt.value = state.promptDraftValue;
    }
    updatePromptPreview();
    closePromptModal();
  });
  on(dom.promptSaveBtn, "click", () => {
    updatePromptPreview();
    try {
      localStorage.setItem(STORAGE_KEYS.systemPrompt, dom.systemPrompt?.value || "");
      addLog("✅ 背景设定已保存至本地缓存", "info");
    } catch (error) {
      addLog("保存背景设定到本地缓存失败: " + error.message, "error");
    }
    closePromptModal();
  });
  on(dom.systemPrompt, "input", updatePromptPreview);

  on(dom.clearLogBtn, "click", () => {
    if (dom.logView) {
      dom.logView.innerHTML = "";
    }
    hideLogScrollTip();
  });
  on(dom.logScrollTip, "click", scrollLogViewToBottom);
  on(dom.logView, "scroll", () => {
    if (isLogViewAtBottom()) {
      hideLogScrollTip();
    }
  });

  on(dom.settingsBtn, "click", openSettingsModal);
  on(dom.toggleApiKeyVisibilityBtn, "click", () => {
    updateApiKeyVisibility(dom.settingsApiKey?.type === "password");
  });
  on(dom.refreshModelsBtn, "click", refreshModelList);
  on(dom.verifyModelsBtn, "click", verifyAllModels);
  on(dom.concurrencyMinusBtn, "click", () => {
    const currentValue = normalizeConcurrency(dom.settingsConcurrencyInput?.value);
    if (currentValue > CONSTANTS.MIN_CONCURRENCY && dom.settingsConcurrencyInput) {
      dom.settingsConcurrencyInput.value = currentValue - 1;
      updateStepperButtons();
    }
  });
  on(dom.concurrencyPlusBtn, "click", () => {
    const currentValue = normalizeConcurrency(dom.settingsConcurrencyInput?.value);
    if (currentValue < CONSTANTS.MAX_CONCURRENCY && dom.settingsConcurrencyInput) {
      dom.settingsConcurrencyInput.value = currentValue + 1;
      updateStepperButtons();
    }
  });
  on(dom.settingsConcurrencyInput, "input", updateStepperButtons);
  on(dom.settingsConcurrencyInput, "blur", () => {
    if (dom.settingsConcurrencyInput) {
      dom.settingsConcurrencyInput.value = normalizeConcurrency(dom.settingsConcurrencyInput.value);
      updateStepperButtons();
    }
  });
  on(dom.settingsCancelBtn, "click", closeSettingsModal);
  on(dom.settingsSaveBtn, "click", saveSettings);
  on(dom.settingsClearStorageBtn, "click", clearStoredSettings);

  on(dom.analyzeContextBtn, "click", startContextAnalysisRequest);
  on(dom.translateBtn, "click", startTranslationRequest);
  on(dom.stopTranslateBtn, "click", () => {
    if (!state.isTranslating) {
      return;
    }

    patchState({ isTranslating: false });
    if (dom.stopTranslateBtn) {
      dom.stopTranslateBtn.disabled = true;
    }
    const abortedCount = abortActiveRequests();
    const stopMessage = abortedCount > 0
      ? "⚠️ 用户已手动中止队列，正在取消当前 " + abortedCount + " 个请求..."
      : "⚠️ 用户已手动中止队列，正在等待当前批次收尾...";
    addLog(stopMessage, "warning");
  });
  on(dom.proofreadBtn, "click", startProofreadRequest);
  on(dom.resumeTaskBtn, "click", () => {
    const nextPendingBatchNumber = getNextPendingBatchNumber();
    if (!nextPendingBatchNumber || !state.lastTaskStatus.type) {
      clearLastTaskState();
      syncPendingLqaState({ hasResumableTask });
      addLog("当前没有可继续的未完成任务。", "warning");
      return;
    }

    addLog("正在从断点处（第 " + nextPendingBatchNumber + " 批）尝试恢复任务...", "info");

    if (state.lastTaskStatus.type === "proofread") {
      startProofreadRequest({ resume: true });
      return;
    }

    startTranslationRequest({ resume: true });
  });

  on(dom.commitBtn, "click", openCommitModal);
  on(dom.commitRevertAllBtn, "click", discardAllLqaChanges);
  on(dom.commitCancelBtn, "click", closeCommitModal);
  on(dom.commitConfirmBtn, "click", commitPendingLqaChanges);
  on(dom.commitCloseBtn, "click", closeCommitModal);
  on(dom.commitModal, "click", (event) => {
    if (event.target === dom.commitModal) {
      closeCommitModal();
    }
  });
  on(dom.commitSummaryContent, "click", (event) => {
    const toggleBtn = event.target.closest(".modal-toggle-btn");
    if (!toggleBtn) {
      return;
    }

    event.preventDefault();
    const rowIndex = Number(toggleBtn.dataset.row);
    const lang = toggleBtn.dataset.lang;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || !lang) {
      return;
    }

    const rowData = state.csvData[rowIndex];
    const history = rowData?._lqaHistory?.[lang];
    if (!rowData || !history) {
      return;
    }

    if (history.status === "original") {
      history.status = "ai";
      rowData[lang] = history.aiText ?? "";
    } else {
      history.status = "original";
      rowData[lang] = history.originalText ?? "";
    }

    patchState({ csvData: state.csvData });
    if (dom.commitSummaryContent) {
      dom.commitSummaryContent.innerHTML = buildCommitSummaryHtml();
    }
    renderTableWithScrollPreservation(state.csvHeaders, state.csvData);
    updateStats(state.csvHeaders, state.csvData);
  });

  on(dom.tableWrap, "click", (event) => {
    const toggleBtn = event.target.closest(".lqa-toggle-btn");
    if (toggleBtn) {
      event.preventDefault();
      const rowIndex = Number(toggleBtn.dataset.row);
      const lang = toggleBtn.dataset.lang;
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || !lang) {
        return;
      }

      const rowData = state.csvData[rowIndex];
      const history = rowData?._lqaHistory?.[lang];
      if (!rowData || !history) {
        return;
      }

      if (history.status === "original") {
        history.status = "ai";
        rowData[lang] = history.aiText ?? "";
      } else {
        history.status = "original";
        rowData[lang] = history.originalText ?? "";
      }

      patchState({ csvData: state.csvData });
      renderTableWithScrollPreservation(state.csvHeaders, state.csvData);
      updateStats(state.csvHeaders, state.csvData);
      return;
    }

    const targetCell = event.target.closest("td");
    if (!targetCell || !dom.tableWrap?.contains(targetCell)) {
      return;
    }

    const rowIndex = targetCell.dataset.row;
    const lang = targetCell.dataset.lang;
    if (!rowIndex || !lang) {
      return;
    }

    const matchingLogs = document.querySelectorAll("[id='" + buildLogElementId(rowIndex, lang) + "']");
    const logEntry = matchingLogs.length > 0 ? matchingLogs[matchingLogs.length - 1] : null;
    if (!logEntry) {
      return;
    }

    flashAfterSmartScroll(dom.logView, logEntry, logEntry);
  });

  on(dom.tableWrap, "pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    patchState({
      pendingRowSelectShift: target.classList.contains("row-select-checkbox")
        ? Boolean(event.shiftKey)
        : false
    });
  });

  on(dom.tableWrap, "change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.id === "selectAllCheckbox") {
      const isChecked = target.checked;
      state.csvData.forEach((row) => {
        if (row && typeof row === "object") {
          row._selected = isChecked;
        }
      });
      patchState({
        csvData: state.csvData,
        lastCheckedIndex: null
      });
      syncAllVisibleRowSelectionDom();
      syncSelectAllCheckboxState();
      updateStats(state.csvHeaders, state.csvData);
      return;
    }

    if (!target.classList.contains("row-select-checkbox")) {
      return;
    }

    const rowIndex = Number(target.dataset.row);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.csvData.length) {
      return;
    }

    const nextChecked = target.checked;
    const affectedRows = [];
    if (state.pendingRowSelectShift && state.lastCheckedIndex !== null && state.lastCheckedIndex >= 0 && state.lastCheckedIndex < state.csvData.length) {
      const start = Math.min(state.lastCheckedIndex, rowIndex);
      const end = Math.max(state.lastCheckedIndex, rowIndex);
      for (let index = start; index <= end; index += 1) {
        if (state.csvData[index] && typeof state.csvData[index] === "object") {
          state.csvData[index]._selected = nextChecked;
          affectedRows.push(index);
        }
      }
    } else if (state.csvData[rowIndex] && typeof state.csvData[rowIndex] === "object") {
      state.csvData[rowIndex]._selected = nextChecked;
      affectedRows.push(rowIndex);
    }

    patchState({
      csvData: state.csvData,
      lastCheckedIndex: rowIndex,
      pendingRowSelectShift: false
    });
    syncSelectionUi(affectedRows);
  });

  on(dom.logView, "click", (event) => {
    const rowLink = event.target.closest(".table-row-link");
    if (!rowLink) {
      return;
    }

    event.preventDefault();
    const targetId = rowLink.dataset.targetRow || String(rowLink.getAttribute("href") || "").replace(/^#/, "");
    if (!targetId) {
      return;
    }

    const targetRow = document.getElementById(targetId);
    const rowIndex = rowLink.dataset.row;
    const lang = rowLink.dataset.lang;
    if (!rowIndex || !lang) {
      return;
    }

    const targetCell = document.getElementById(buildCellElementId(rowIndex, lang));
    flashAfterSmartScroll(dom.tableWrap, targetRow, targetCell);
  });

  on(dom.exportBtn, "click", exportCsvFile);
}

const languageConfigCallbacks = {
  onBaseLanguageChange(baseLanguage) {
    addLog("基准语言已切换为: " + baseLanguage, "info");
  },
  onTargetLanguagesChange(targetLanguages) {
    addLog("目标语言已选择 " + targetLanguages.length + " 项。", "info");
  }
};

initializeStore();
initDomRefs();
loadSettingsFromStorage();
syncSettingsForm();
renderLanguageConfig([], languageConfigCallbacks);
updateTokenLabel();
updatePromptPreview();
syncPendingLqaState({ hasResumableTask });
bindEvents();
syncWindowState();

addLog("界面已初始化，支持点击或拖拽上传 CSV/TXT 文件。", "info");
addLog("本地偏好设置已载入，可通过“⚙️ 偏好设置”查看或修改。", "success");
addLog("安全提醒：处理商业机密文本时，请确认 Base URL 可信；第三方中转站可能记录 API Key 与待翻译文本。", "warning");
addLog("全局变量 window.csvData 与 window.totalTokens 已就绪。", "info");
