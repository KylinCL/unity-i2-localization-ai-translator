import {
  LQA_ISSUE_TYPES,
  LQA_SEVERITIES
} from "./store.js";

export async function probeModel(modelId, apiKey, baseUrl) {
  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "user", content: "hi" }
      ],
      max_tokens: 1
    })
  });

  const responseText = await response.text();
  const normalizedErrorText = String(responseText || "").toLowerCase();
  const endpointMismatch = response.status === 404
    || /not a chat model/.test(normalizedErrorText)
    || /not supported in the v1\/chat\/completions endpoint/.test(normalizedErrorText)
    || /did you mean to use v1\/completions/.test(normalizedErrorText);
  const authFailure = response.status === 401
    || response.status === 403
    || /unauthorized/.test(normalizedErrorText)
    || /invalid api key/.test(normalizedErrorText)
    || /authentication/.test(normalizedErrorText)
    || /forbidden/.test(normalizedErrorText);
  const quotaLike = response.status === 429
    || /rate limit/.test(normalizedErrorText)
    || /quota/.test(normalizedErrorText)
    || /insufficient_quota/.test(normalizedErrorText)
    || /billing/.test(normalizedErrorText)
    || /exceeded your current quota/.test(normalizedErrorText);

  if (authFailure) {
    const authError = new Error("鉴权失败，无法完成批量校验。");
    authError.code = "AUTH";
    throw authError;
  }

  return {
    compatible: response.ok || quotaLike || !endpointMismatch,
    endpointMismatch,
    quotaLike,
    response,
    responseText
  };
}

export function isLikelyTextModelId(modelId) {
  const normalizedModelId = String(modelId || "").trim().toLowerCase();
  if (!normalizedModelId) {
    return false;
  }

  const excludedPatterns = [
    /^dall-e/,
    /embedding/,
    /whisper/,
    /tts/,
    /moderation/,
    /image/,
    /audio/,
    /realtime/
  ];

  return !excludedPatterns.some((pattern) => pattern.test(normalizedModelId));
}

export async function fetchModelList(apiKey, baseUrl) {
  const response = await fetch(baseUrl + "/models", {
    headers: {
      Authorization: "Bearer " + apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("HTTP " + response.status + " " + response.statusText + " - " + errorText.slice(0, 200));
  }

  return response.json();
}

export function extractAnalysisResponse(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

export async function postChatCompletion(settings, body, signal) {
  const response = await fetch(settings.baseUrl + "/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + settings.apiKey
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  let payload = {};

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (parseError) {
    throw new Error("服务端返回了无法解析的响应: " + responseText.slice(0, 200));
  }

  if (!response.ok) {
    const apiErrorMessage = payload?.error?.message || responseText.slice(0, 200) || (response.status + " " + response.statusText);
    throw new Error("HTTP " + response.status + " " + response.statusText + " - " + apiErrorMessage);
  }

  return payload;
}

export function getProofreadBatchLanguages(batchData) {
  return [...new Set(
    (batchData || []).flatMap((item) => Object.keys(item?.currentTranslations || {}))
  )].filter(Boolean);
}

export function buildProofreadResponseFormat(batchData) {
  const rowIndexes = [...new Set(
    (batchData || [])
      .map((item) => Number(item?.row))
      .filter((row) => Number.isInteger(row))
  )];
  const languages = getProofreadBatchLanguages(batchData);

  const rowSchema = rowIndexes.length
    ? { type: "integer", enum: rowIndexes }
    : { type: "integer" };
  const langSchema = languages.length
    ? { type: "string", enum: languages }
    : { type: "string" };

  return {
    type: "json_schema",
    json_schema: {
      name: "lqa_findings",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                row: rowSchema,
                lang: langSchema,
                issueType: { type: "string", enum: LQA_ISSUE_TYPES },
                severity: { type: "string", enum: LQA_SEVERITIES },
                shouldApply: { type: "boolean" },
                evidence: { type: "string" },
                decision: { type: "string" },
                newText: { type: "string" },
                reason: { type: "string" }
              },
              required: ["row", "lang", "issueType", "severity", "shouldApply", "evidence", "decision", "newText", "reason"]
            }
          }
        },
        required: ["findings"]
      }
    }
  };
}

export function buildTranslationUserPrompt(batchData, contextString = "") {
  const contextPrefix = contextString
    ? "【前置剧情与语境参考（只读）】：以下是长达数十行的前置剧情，包含场景Desc、原文与已有译文。请务必参考这些前文以确保当前批次中【物品名称】、【角色称谓】和【语气】的 100% 连贯性。严禁对前文内容进行任何修改或重复翻译！\n"
      + contextString
      + "\n\n"
    : "";
  const userPrompt = "请严格按照每个对象中 'translateTo' 数组指定的语种，对 'text' 进行翻译，并参考 'desc' 语气。\n"
    + "【代码与格式绝对保留】：富文本标签（如 <color>）、占位符（如 {0}）与换行符（\\n）必须与原文 100% 对齐。禁止丢失、禁止随意增减、禁止改写顺序。\n"
    + "【排版本地化强制规范】：必须严格遵循目标语言母语排版，严禁跨语种标点污染！\n"
    + "  - 半角隔离：English, French, Spanish, German, Portuguese, Russian, Italian 必须使用纯半角标点（如 , . ! ? ()），绝对禁止混入中文全角标点！\n"
    + "  - 专属引号：French/Russian 必须用角引号 « »；German 用 „ “；Japanese/Traditional Chinese 用 「 」 或 『 』；其余西欧语言用双引号 \"\"。\n"
    + "  - 特殊语种约束：French 必须在 ! ? : ; 与法式引号内侧加不换行空格；Spanish 必须在感叹/疑问句首加 ¿ 和 ¡；Korean 必须使用半角标点加后置空格。\n"
    + "【绝对禁止无意义的解释】：99% 的常规翻译【绝对不允许】输出 '_note' 字段！只有当你使用了极其特殊的本地化技巧、双关语或特殊意译时，才极度克制地输出 '_note' 简短说明。若确需输出 '_note'，必须使用简体中文；不得解释普通直译；不得为每行生成模板化说明。违背此规则将导致严重的解析错误！\n"
    + "【输出规则】：必须返回合法 JSON 格式的对象。在返回每行的结果时，除了目标语种外，还可以附加一个 '_note' 字段。\n"
    + "格式必须严格如下：\n"
    + "{\"行索引1\": {\"语种A\": \"译文\", \"_note\": \"解释...\"}, \"行索引2\": {\"语种A\": \"译文\", \"语种B\": \"译文\"}}\n"
    + "待翻译数据如下：\n"
    + JSON.stringify(batchData);
  return contextPrefix + userPrompt;
}

export function buildTranslationRequestBody(batchData, settings, contextString = "") {
  return {
    model: settings.modelName,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: buildTranslationUserPrompt(batchData, contextString) }
    ]
  };
}

export function buildProofreadUserPrompt(batchData, settings, readonlyContextRows = []) {
  const deepMode = Boolean(settings?.isDeepMode);
  const proofreadPayload = {
    readonlyContext: readonlyContextRows,
    targets: batchData
  };
  const lqaOutputContract = "【判定与输出流程】：按顺序处理每个 target/lang。\n"
    + "1. 硬格式：先检查 preScanIssues、富文本标签、占位符、printf token、换行符是否与 baseText 对齐。\n"
    + "2. 文本语义：再检查漏译、错译、语义相反、角色/物品/命令理解错误。\n"
    + "3. 术语与上下文：结合 System 术语和 readonlyContext，检查专名、称谓、前后一致性。\n"
    + "4. 目标语言排版：最后检查中文全角标点污染、法语空格、西语倒标点、引号规范等排版问题。\n"
    + "5. 决策：只有客观且严重的问题才允许 shouldApply=true；issueType 必须是 tag_mismatch、placeholder_mismatch、newline_mismatch、omission、mistranslation、terminology、context_consistency 或 punctuation_pollution，severity 必须是 critical 或 major。\n"
    + "6. 跳过：完全合格的行不要返回；仅风格偏好、语序优化、同义词替换、语气微调必须视为 style_only/suggestion，并且 shouldApply=false。\n"
    + "targets 中的 preScanIssues 是程序本地已确认的硬格式问题。对应语言必须优先处理；如果同一单元格同时存在漏译、错译或术语错误，newText 必须一次性合并修复格式和文本问题。\n"
    + "newText 必须是该语言单元格的完整替换译文，不是局部补丁；shouldApply=false 时 newText 必须为空字符串。\n"
    + "每条 finding 必须填写 evidence 与 decision。evidence 只写可核验证据（如缺少 {0}、漏掉“地下室”、与第 17 行术语不一致），decision 只写处理结论（如应补回占位符并保留语义）。两者都必须是简体中文短句，不得输出长篇推理或思维链。\n"
    + "reason 是给用户看的最终说明，必须使用简体中文；术语、Key、原文片段和译文片段可以保留原文。\n"
    + "输入数据中 row 是内部索引，lineNumber 是界面显示行号；返回 findings 时必须使用 targets 中的 row。\n"
    + "readonlyContext 只可作为术语、语气和前文顺序参考；只有 targets 中的行可以返回 finding。\n"
    + "当术语冲突且没有更强证据时，优先沿用更早 lineNumber 中已经稳定出现的译法。\n"
    + "返回 JSON 顶层必须是 {\"findings\": []}。finding 字段：row（原始行索引）、lang、issueType、severity、shouldApply、evidence、decision、newText、reason。\n";

  return deepMode
    ? "你是极其严苛且极其克制的游戏 LQA 专家。当前处于【深度剧情监督模式】。\n"
      + "【工作目标】：只处理客观可证明的 LQA 问题，例如漏翻、错翻、术语冲突、代码格式丢失、严重排版污染或明确违背背景设定。质量合格的译文不要返回 finding。\n"
      + "【只读上下文规则】：输入 JSON 中的 readonlyContext 仅用于理解前文、术语、称谓和既有译法；只有 targets 中的行可以返回 finding。\n"
      + "【硬格式约束】：富文本标签（如 <color>）、占位符（如 {0}）与换行符（\\n）必须与原文 100% 对齐。\n"
      + "【排版本地化规范】：必须遵循目标语言母语排版，避免跨语种标点污染。\n"
      + "  - 半角隔离：English, French, Spanish, German, Portuguese, Russian, Italian 使用纯半角标点（如 , . ! ? ()），不要混入中文全角标点。\n"
      + "  - 专属引号：French/Russian 必须用角引号 « »；German 用 „ “；Japanese/Traditional Chinese 用 「 」 或 『 』；其余西欧语言用双引号 \"\"。\n"
      + "  - 特殊语种约束：French 必须在 ! ? : ; 与法式引号内侧加不换行空格；Spanish 必须在感叹/疑问句首加 ¿ 和 ¡；Korean 必须使用半角标点加后置空格。\n"
      + "【标点白名单】：俄语、法语等语言的母语规范就是使用角引号 « »；正确的角引号不是中文符号或排版污染。只有目标译文中残留中文全角标点（如 ， 。 ？ ！ “ ” 《 》）时，才属于需要清理的排版污染。\n"
      + "【屈折语语法】：对于俄语、德语、法语等具有变格、变位、阴阳性变化的屈折语，【术语表】提供的仅为词根/主格参考；允许术语在上下文中产生合理的后缀变化。\n"
      + "【修改触发条件】：\n"
      + "  1. 格式/代码丢失：漏掉富文本标签（<color>）、占位符（{0}）或换行符（\\n），或与原文无法 100% 对齐。\n"
      + "  2. 致命错误：语义相反、错翻、漏翻、违背背景设定或违背 System 中的强制术语表。\n"
      + "  3. 名词不一致：与【前置剧情】中已稳定出现的物品名、角色名、称谓或关键术语译法不一致。\n"
      + "  4. 排版污染：混用了中西文标点，或违背了目标语言专属排版（如法语漏掉标点前空格、西语漏掉倒标点、引文符号错误等）。\n"
      + lqaOutputContract
      + "待校对数据：\n"
      + JSON.stringify(proofreadPayload)
    : "你是极其专业且极其克制的游戏 LQA 质检专家。请对比 'baseText' 和 'currentTranslations'，并严格遵守 System 设定的背景与语气。\n"
      + "【工作目标】：只处理客观可证明的 LQA 问题，例如漏翻、错翻、术语冲突、代码格式丢失、严重排版污染或明确违背背景设定。质量合格的译文不要返回 finding。\n"
      + "【校对基准】：以 'baseText' 为唯一基准进行 1对1 校验，不要让其他目标语言互相干涉。\n"
      + "【硬格式约束】：富文本标签（如 <color>）、占位符（如 {0}）与换行符（\\n）必须与原文 100% 对齐。\n"
      + "【排版本地化规范】：必须遵循目标语言母语排版，避免跨语种标点污染。\n"
      + "  - 半角隔离：English, French, Spanish, German, Portuguese, Russian, Italian 使用纯半角标点（如 , . ! ? ()），不要混入中文全角标点。\n"
      + "  - 专属引号：French/Russian 必须用角引号 « »；German 用 „ “；Japanese/Traditional Chinese 用 「 」 或 『 』；其余西欧语言用双引号 \"\"。\n"
      + "  - 特殊语种约束：French 必须在 ! ? : ; 与法式引号内侧加不换行空格；Spanish 必须在感叹/疑问句首加 ¿ 和 ¡；Korean 必须使用半角标点加后置空格。\n"
      + "【标点白名单】：俄语、法语等语言的母语规范就是使用角引号 « »；正确的角引号不是中文符号或排版污染。只有目标译文中残留中文全角标点（如 ， 。 ？ ！ “ ” 《 》）时，才属于需要清理的排版污染。\n"
      + "【屈折语语法】：对于俄语、德语、法语等具有变格、变位、阴阳性变化的屈折语，【术语表】提供的仅为词根/主格参考；允许术语在上下文中产生合理的后缀变化。\n"
      + "【修改触发条件】：\n"
      + "  1. 格式/代码丢失：译文漏掉了富文本标签（如 <color>）、占位符（如 {0}）或换行符（\\n），或与原文无法 100% 对齐。\n"
      + "  2. 致命错误：存在语义相反、名词/术语错误、漏翻、或完全违背背景设定的情况。\n"
      + "  3. 排版污染：目标语言为西欧语言时，错误残留了中文全角标点（如全角括号、引号），或违背了目标语言专属排版。\n"
      + lqaOutputContract
      + "待校对数据如下：\n"
      + JSON.stringify(proofreadPayload);
}

export function buildProofreadRequestBody(batchData, settings, readonlyContextRows = []) {
  return {
    model: settings.modelName,
    response_format: buildProofreadResponseFormat(batchData),
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: buildProofreadUserPrompt(batchData, settings, readonlyContextRows) }
    ]
  };
}
