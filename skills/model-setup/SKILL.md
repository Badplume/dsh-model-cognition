---
name: model-setup
description: "配置 Model Cognition：新增供应商、填写 API Key、设置 Base URL 与协议、填入模型与价格、测试连通性、调整预算与默认模型。当用户说“我要怎么加一个模型”“密钥填哪里”“怎么让它便宜点”，或调用外部模型报密钥/地址/模型不存在的错误时用它。"
disable-model-invocation: false
---

# 配置供应商与模型

所有配置都在 **设置 → Model Cognition** 里，分三个页面：**供应商**、**常规**、**用量与预算**。
配置会立刻生效，不需要重启应用。

## 第一个模型：五分钟

1. 打开 **设置 → Model Cognition → 供应商**，点**新增供应商**。
2. 选择**预设**（DeepSeek / OpenAI / Anthropic / OpenRouter / Ollama …）。
   预设会填好 Base URL 和协议，只需要补密钥。
3. **填 API Key**。密钥默认存进凭据存储（`~/.dsh/.credentials.yaml` 的 records 段），
   **不写进这个插件的数据文件**。界面上只显示"已配置"，永远不会回显密钥。
4. 点**测试连接**。成功会列出该供应商提供的模型 id。
5. 把要用的模型加进列表。**填价格**（输入/输出，每百万 token 的美元单价）。
6. 到**常规**页把**默认模型**设成你最常用的那个。之后调用可以省掉模型参数。

## Base URL 怎么填

**Base URL 要自带版本段**，插件只往后追加操作路径：

| 协议 | 插件拼出的地址 |
| --- | --- |
| `openai` | `<Base URL>/chat/completions` |
| `anthropic` | `<Base URL>/v1/messages` |

所以大多数情况要写到版本段为止：

| 供应商 | Base URL | 协议 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | openai |
| OpenAI | `https://api.openai.com/v1` | openai |
| Anthropic | `https://api.anthropic.com` | anthropic |
| OpenRouter | `https://openrouter.ai/api/v1` | openai |
| 阿里云百炼（兼容模式） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | openai |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | openai |
| 硅基流动 | `https://api.siliconflow.cn/v1` | openai |
| Ollama（本地） | `http://127.0.0.1:11434/v1` | openai（无需密钥） |
| LM Studio（本地） | `http://127.0.0.1:1234/v1` | openai（无需密钥） |

云端供应商几乎都是 `openai` 协议。**Anthropic 官方接口不是**统一格式，
要选 `anthropic` 协议；但很多中转服务把 Anthropic 模型包成了 OpenAI 格式，
那种情况选 `openai`，并按其文档填 Base URL。

**本地模型**（Ollama / LM Studio）记得打开"无需密钥"，否则插件会要求填一个不存在的 key。

## 模型与价格

- 模型 id 必须和供应商文档里写的**完全一致**（大小写、日期后缀都算）。
  不确定就点**测试连接**，它会从供应商拉取真实列表。
- 价格是**可选**的，但强烈建议填：
  - 填了价格 → 单次/每日上限和自动放行阈值才会生效。
  - 没填价格 → 显示"未定价"，**任何预算闸门都不会拦它**（无法估算）。
- 单价按**每百万 token** 填，输入和输出分开。
- **不要凭记忆填历史价格**。价格会变，填错了比不填更糟——
  它会安静地给出错误的预算判断。请以供应商定价页为准。

## 密钥存在哪里

| 模式 | 存放位置 | 适用 |
| --- | --- | --- |
| **凭据存储**（默认） | `~/.dsh/.credentials.yaml` 的 `records` 段，键为 `dsh-model-cognition/<供应商 id>` | 推荐；不进插件数据文件 |
| **随行存储** | 插件自己的数据文件 `$DSH_HOME/data/dsh-model-cognition/store.json`（权限 0600） | 临时端点、或没有凭据服务的最小环境 |
| **无需密钥** | 不存 | 本地模型、内网服务 |

界面上任何地方都**不会回显密钥**：已配置时输入框留空并提示"留空表示保留原有密钥"。
**要清空密钥，用该供应商的"清除密钥"操作**——留空保存不会删除它。

密钥也可能来自环境变量（`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 等）。
**环境变量的优先级更高**，而且在界面上是只读的；如果某个密钥改不动，
先检查是不是被环境变量接管了。

## 常规设置

| 设置 | 说明 |
| --- | --- |
| **默认模型** | 调用时不写模型就用它 |
| `temperature` | 默认采样温度 |
| `maxTokens` | 默认输出上限；也是成本估算的上界 |
| `timeoutMs` | 单次请求超时（默认 120 秒）；本地大模型可以调大 |
| `concurrency` | `model_panel` 的并行数 |
| **在提示中加入用法说明** | 给外部模型加一句"你正在被另一个 AI 咨询"，让它直接作答 |

## 用量与预算

| 设置 | 说明 |
| --- | --- |
| `maxCostPerCallUsd` | 单次预估上限，**超过直接拒绝，不可批准** |
| `maxCostPerDayUsd` | 今日累计上限，**超过直接拒绝** |
| `autoApproveUnderUsd` | 不超过它直接执行；超过则生成**待批准项** |
| **重置账本** | 清空用量记录（不改变配置） |

超过自动放行阈值的调用会停在**待批准**列表里，需要在这里点**批准**或**拒绝**。
批准的是一次**具体请求**（绑定模型与 prompt），一次性有效，30 分钟内不使用会过期。

## 数据与备份

- **配置文件**：`$DSH_HOME/data/dsh-model-cognition/store.json`（供应商、设置、用量账本、待批准项）
- **密钥**：`~/.dsh/.credentials.yaml` 的 `records` 段
- 数据文件损坏时会**改名保留**为 `store.json.corrupt-<时间戳>`，不会静默删除。
- 想只看配置不看待批准项，用 `/model-cognition/export` 接口导出（其中不含密钥）。

## 常见问题

**"还没有配置 API Key"** —— 供应商的密钥没填，或环境变量没生效。到供应商页面填一次。

**401 / invalid api key** —— 密钥本身无效、复制时带了空格、或该密钥没有这个模型的权限。

**404 / model not found** —— 模型 id 拼错了，或该账号没有开通。点**测试连接**看真实列表。

**"无法连接 …"** —— Base URL 写错了。检查协议（`http` vs `https`）、
端口、以及有没有漏掉 `/v1` 这样的版本段。本地模型确认服务已启动。

**返回 400 且提到 `max_tokens`** —— 该供应商的推理模型改用别的字段。
在供应商的高级设置里把"最大 token 参数名"改掉（例如 `max_completion_tokens`），
或设为"不发送"。

**测试连接失败但实际能用** —— 有些兼容服务没有实现 `/models` 接口。
手动把模型 id 填进去即可，不影响实际调用。
