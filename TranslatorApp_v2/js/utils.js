export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeTitleText(value) {
  return escapeHtml(String(value ?? "")).replace(/\r?\n/g, "&#10;");
}

export function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

export function normalizeConcurrency(value, min = 1, max = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(Math.max(5, min), max);
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function normalizeContextDepth(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(200, Math.max(0, Math.round(parsed)));
}

export function chunkArray(items, size) {
  const chunks = [];
  const normalizedSize = Math.max(1, Number(size) || 1);

  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }

  return chunks;
}

export function parseModelJsonObject(content) {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    throw new Error("模型没有返回可解析的 JSON 内容。");
  }

  const fencedMatch = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : normalized;
  return JSON.parse(jsonText);
}

export function extractRegexMatches(value, pattern) {
  return String(value ?? "").match(pattern) || [];
}

export function extractRichTextTags(value) {
  return extractRegexMatches(value, /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?>/g);
}

export function extractBracedPlaceholders(value) {
  return extractRegexMatches(value, /\{[^{}\r\n]+\}/g);
}

export function extractPrintfPlaceholders(value) {
  return extractRegexMatches(value, /%(?:\d+\$)?[+#0\- ]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[bcdeEfFgGosuxX]/g);
}

export function extractNewlineTokens(value) {
  return extractRegexMatches(value, /\\r\\n|\\n|\\r|\r\n|\r|\n/g).map((token) => token === "\r\n" || token === "\r" ? "\n" : token);
}

export function getPreferredNewlineToken(value) {
  const match = String(value ?? "").match(/\\r\\n|\\n|\\r|\r\n|\r|\n/);
  return match ? match[0] : "";
}

export function normalizeNewlineRepresentationToBase(baseText, candidateText) {
  const preferredToken = getPreferredNewlineToken(baseText);
  if (!preferredToken) {
    return String(candidateText ?? "");
  }

  return String(candidateText ?? "").replace(/\\r\\n|\\n|\\r|\r\n|\r|\n/g, preferredToken);
}

export function formatTokenForLog(token) {
  switch (token) {
    case "\n":
      return "实际换行";
    case "\r\n":
      return "实际 CRLF";
    case "\r":
      return "实际 CR";
    case "\\n":
      return "\\n";
    case "\\r\\n":
      return "\\r\\n";
    case "\\r":
      return "\\r";
    default:
      return token;
  }
}

export function formatTokenList(tokens) {
  return tokens.length ? tokens.map(formatTokenForLog).join(" ") : "无";
}

export function compareTokenSequence(label, expected, actual) {
  if (expected.length !== actual.length || expected.some((token, index) => token !== actual[index])) {
    return label + "不一致（原文: " + formatTokenList(expected) + "；新译文: " + formatTokenList(actual) + "）";
  }

  return "";
}

export function getDeterministicFormatIssues(baseText, targetText) {
  return [
    compareTokenSequence("富文本标签", extractRichTextTags(baseText), extractRichTextTags(targetText)),
    compareTokenSequence("花括号占位符", extractBracedPlaceholders(baseText), extractBracedPlaceholders(targetText)),
    compareTokenSequence("printf 占位符", extractPrintfPlaceholders(baseText), extractPrintfPlaceholders(targetText)),
    compareTokenSequence("换行符", extractNewlineTokens(baseText), extractNewlineTokens(targetText))
  ].filter(Boolean);
}

export function buildLocalFormatIssueNote(formatIssues) {
  return "[严重 / 格式硬错误] " + (formatIssues || []).join("；");
}

export function isWesternLanguage(lang) {
  const normalized = String(lang ?? "").trim().toLowerCase();
  return /english|french|spanish|german|portuguese|russian|italian/.test(normalized)
    || /^(en|fr|es|de|pt|ru|it)([-_].*)?$/.test(normalized);
}

export function hasForbiddenFullwidthPunctuation(value) {
  return /[，。！？；：（）【】《》“”‘’]/.test(String(value ?? ""));
}

export function findDescColumnName(headers = [], descColumnName = "Desc") {
  const normalizedExpected = String(descColumnName ?? "Desc").trim().toLowerCase();
  return headers.find((header) => String(header ?? "").trim().toLowerCase() === normalizedExpected) || "";
}

export function findKeyColumnName(headers = []) {
  return headers.find((header) => String(header ?? "").trim().toLowerCase() === "key") || "";
}

export function findDefaultBaseLanguage(headers = []) {
  const preferred = headers.find((header) => /chinese/i.test(header));
  return preferred || headers[0] || "";
}

export function buildExportRows(headers, rows) {
  if (!headers.length) {
    return rows;
  }

  return rows.map((row) => {
    const orderedRow = {};
    headers.forEach((header) => {
      orderedRow[header] = row[header] ?? "";
    });
    return orderedRow;
  });
}

export function getStoredValue(key, fallbackValue, onError) {
  try {
    const storedValue = localStorage.getItem(key);
    return storedValue !== null ? storedValue : fallbackValue;
  } catch (error) {
    if (typeof onError === "function") {
      onError(error);
    }
    return fallbackValue;
  }
}

export function getStoredBoolean(key, fallbackValue = false, onError) {
  const storedValue = getStoredValue(key, fallbackValue ? "true" : "false", onError);
  return storedValue === true || String(storedValue).toLowerCase() === "true";
}

export function createAbortError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  const abortError = new Error("Request aborted");
  abortError.name = "AbortError";
  return abortError;
}

export function isAbortError(error) {
  return error?.name === "AbortError";
}

export function waitWithAbort(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener?.("abort", handleAbort);
      resolve();
    }, ms);

    function handleAbort() {
      clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal?.addEventListener?.("abort", handleAbort, { once: true });
  });
}
