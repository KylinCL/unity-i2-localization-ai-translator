# LQA 回归测试期望结果

这个文档用于配合 `LQA_Regression_Sample.csv.txt` 做稳定性回归测试。每次你改 Prompt、换模型、改校对逻辑后，都可以拖入这个样本，检查“该改的是否改、不该改的是否没改”。

样本里的 `Desc` 已按真实项目风格压缩成 `Name`、`Guide`、`Tips`、`Item`、`Comment`、`Click` 等短标签，具体期望只写在本文档里，避免 CSV 本身把答案提示得过于明显。

## 使用步骤

1. 将 `LQA_Regression_Sample.csv.txt` 拖入工具。
2. 基准语言选择 `Chinese(Simplified)`。
3. 目标语言按需要勾选。一次完整测试可以勾选 `English`、`French`、`Japanese`、`Spanish`、`Russian`。
4. 点击 `开始校对`，不要点击翻译。
5. 涉及上下文一致性的案例建议保留 `Context Depth = 50`。如果普通校对没抓到上下文问题，可以用 Deep LQA 单独测试一个目标语言。
6. 校对完成后，打开审阅弹窗，对照下面的期望表检查结果。
7. 冻结功能测试：开启 `保存 LQA 后冻结已确认单元格`，接受并保存本轮 LQA 修改，然后不改表格内容再校对一次。已确认的单元格应被跳过或保持不变。

## 期望结果

| 工具行号 | Key | 目标语言 | 期望行为 | 主要问题 |
| --- | --- | --- | --- | --- |
| 1 | `LQA/PASS/EN/Correct` | English | 不修改 | 无问题 |
| 2 | `LQA/PASS/EN/StyleOnly` | English | 不修改 | 只是风格优化，应该忽略 |
| 3 | `LQA/PASS/EN/LocalizedPunctuation` | English | 不修改 | 英文标点已经本地化正确 |
| 4 | `LQA/FIX/EN/TagMissing` | English | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 富文本标签不一致 |
| 5 | `LQA/FIX/EN/PlaceholderMissing` | English | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 占位符不一致 |
| 6 | `LQA/FIX/EN/NamedPlaceholderMissing` | English | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 占位符不一致 |
| 7 | `LQA/FIX/EN/PrintfMissing` | English | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 占位符不一致 |
| 8 | `LQA/FIX/EN/NewlineMismatch` | English | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 换行符不一致 |
| 9 | `LQA/FIX/EN/Omission` | English | 应修复，译文需要包含“打开地下室的门” | 漏译 |
| 10 | `LQA/FIX/EN/MistranslationOpposite` | English | 应修复，不能把“不要按”翻成“按下” | 错译 |
| 11 | `LQA/CTX/EN/StableTerm_BlackStoneBracelet` | English | 不修改 | 术语种子行 |
| 12 | `LQA/FIX/EN/Terminology_BlackStoneBracelet` | English | 应修复，应使用 `Black Stone Bracelet`，不要用 `Obsidian Bracelet` | 术语不一致 |
| 13 | `LQA/FIX/EN/FullwidthQuestionMark` | English | 应修复，把 `？` 改成 `?` | 标点污染 |
| 14 | `LQA/PASS/FR/CorrectAngleQuotes` | French | 不修改 | 法语角引号和空格已经正确 |
| 15 | `LQA/FIX/FR/QuoteSpacing` | French | 应修复，建议类似 `Il a dit : « Vite ! »` | 标点污染 |
| 16 | `LQA/FIX/ES/InvertedQuestion` | Spanish | 应修复，建议类似 `¿Estás listo?` | 标点污染 |
| 17 | `LQA/CTX/JA/StableName_Alice` | Japanese | 不修改 | 术语种子行 |
| 18 | `LQA/FIX/JA/Terminology_Alice` | Japanese | 应修复，应使用 `アリス`，不要用 `アリサ` | 术语不一致 |
| 19 | `LQA/CTX/JA/StableTerm_OnDesk` | Japanese | 不修改 | 上下文种子行 |
| 20 | `LQA/FIX/JA/Context_OnDesk` | Japanese | 应修复，应沿用前文 `机の上`，不要改成 `テーブルの上` | 上下文不一致 |
| 21 | `LQA/FIX/JA/NewlineMismatch` | Japanese | 本地格式预扫描标记，并要求模型合并修复；若模型没修好则进入审阅提醒 | 换行符不一致 |
| 22 | `LQA/PASS/JA/CorrectJapaneseQuotes` | Japanese | 不修改 | 日语引号已经正确 |
| 23 | `LQA/PASS/RU/CorrectGuillemets` | Russian | 不修改 | 俄语角引号已经正确 |
| 24 | `LQA/FIX/RU/PunctuationPollution` | Russian | 应修复，把 `？` 改成 `?` | 标点污染 |

## 通过标准

- 所有 `PASS` 行不应进入审阅弹窗。
- 所有 `FIX` 行应该进入审阅弹窗，或者被本地格式预扫描/硬校验明确拦截并写入日志。
- LQA 日志里的问题标签应显示中文，例如 `[重要 / 术语不一致]`。
- 日志里的修改原因应尽量使用中文说明，并包含简短的“证据”和“判定”信息。
- 本地格式预扫描必须提前发现富文本标签、占位符、printf token 或必要换行符不一致的单元格，并把这些信息随校对请求发给模型合并修复。
- 如果模型未返回有效修复，或返回结果仍不满足硬格式校验，该单元格必须进入审阅提醒。
- 硬校验必须阻止模型提交会丢失富文本标签、占位符、printf token 或必要换行符的修改。
- 开启冻结功能并保存修改后，再次校对同一份未改动数据，不应对已确认单元格产生新修改。
