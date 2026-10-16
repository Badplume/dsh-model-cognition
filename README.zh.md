# dsh-model-cognition

在 DeepSeek Harness 的对话里**调用其他模型** —— 用自己的供应商密钥，中间隔着一道预算闸门，
设置面板直接长在桌面端里。

[English](README.md)

---

## 为什么

一个模型就是一个观点。有时候你需要第二个：用便宜的模型跑量、用推理模型啃硬骨头，
或者同时问两家不同的厂商 —— 它们的分歧本身就是信息。

`dsh-model-cognition` 给 agent 加了四个工具和五个 skill，让它能做这件事：问另一个模型、
一次问一排、并把花掉的钱记在账上。中间没有中转服务，你的密钥直接发给你自己配置的厂商。

**它不是子代理。** 子代理是另一个*你*，有工具、有文件系统。`model_ask` 是向一个陌生人
提一个纯文本问题：没有工具、没有文件、除了你写进 prompt 的内容它什么都不知道。
这正是它的价值 —— 便宜、快、碰不到任何东西。

## 它给你什么

| | |
|---|---|
| **4 个 agent 工具** | `model_list`、`model_ask`、`model_panel`、`model_usage` |
| **5 个 skill** | 路由、多模型会审、难题外包、预算、配置 |
| **1 个设置页** | 设置 → Model Cognition，三个标签页 |
| **2 种协议** | OpenAI 兼容（`/chat/completions`）与 Anthropic（`/v1/messages`） |

---

## 安装

### 用插件管理器

```
dsh plugin --profile <你的 profile> add dsh-model-cognition
```

然后确认 profile 的 `package.json` 里 `dsh.profile.bundles` 有 `dsh-model-cognition`。

### 从本地检出安装

```jsonc
// <profile>/package.json
"dependencies": {
  "dsh-model-cognition": "link:/绝对路径/dsh-model-cognition"
},
"dsh": { "profile": { "bundles": [ /* … */ "dsh-model-cognition" ] } }
```

装完要重启应用：bundle 只在启动时解析。

> 任何东西都不会写进包目录。设置和用量账本放在
> `$DSH_HOME/data/dsh-model-cognition/`，因为包一旦更新，包内的东西就全被换掉了。

---

## 配置一个供应商（五分钟）

打开 **设置 → Model Cognition → 供应商**。

1. **新增供应商** —— 选一个预设，或者手填。
2. **Base URL** —— 必须自带版本段。插件自己会拼 `/chat/completions`（OpenAI 协议）
   或 `/v1/messages`（Anthropic 协议）。

   | 厂商 | Base URL |
   |---|---|
   | DeepSeek | `https://api.deepseek.com/v1` |
   | OpenAI | `https://api.openai.com/v1` |
   | Anthropic | `https://api.anthropic.com` |
   | Google（OpenAI 兼容） | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | OpenRouter | `https://openrouter.ai/api/v1` |
   | Moonshot | `https://api.moonshot.cn/v1` |
   | 百炼（通义） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
   | 智谱 | `https://open.bigmodel.cn/api/paas/v4` |
   | 硅基流动 | `https://api.siliconflow.cn/v1` |
   | Ollama（本地） | `http://127.0.0.1:11434/v1` |
   | LM Studio（本地） | `http://127.0.0.1:1234/v1` |

3. **API Key** —— 默认存进 Harness 的凭据存储；浏览器只能看到「配没配」，读不回密钥。
   **密钥框留空保存不会删除密钥**；要删除请用 *清除密钥*。
4. **模型** —— 一个模型一行，id 必须和厂商文档里完全一致。价格按每**百万** token 填。
   不知道就留空：未定价的模型不被任何预算闸门拦住，面板会显示「未定价」而不是一个错数字。
   *不要凭记忆填价格* —— 填错比不填更糟。
5. **测试连接** 在保存之前就能用，打错一个字不花钱。

---

## 预算：三道闸

| 闸门 | 含义 | agent 能过吗 |
|---|---|---|
| **单次上限** `maxCostPerCallUsd` | 一次调用的硬顶 | **不能** |
| **每日上限** `maxCostPerDayUsd` | 当天累计的硬顶 | **不能** |
| **自动放行阈值** `autoApproveUnderUsd` | 低于它就照常发 | **能，但要你批准** |

每次调用前都会预估花费（中日韩字符约 1 token/字，拉丁文约 4 字符 1 token，再加上
`maxTokens` 作为上界）。超过软线时工具**不会**发出请求，而是返回 `pending_approval`
和 `approvalId`，该次调用出现在面板的 **用量与预算** 标签页里。在那里批准，授权的
是*那一次调用*：同一个供应商、同一个模型、同一个 prompt 摘要，30 分钟内有效。
之后 agent 带上 `approvalId` 重试。

未定价的模型豁免全部三道闸。这是故意的 —— 插件不会为了拦住你而编一个数字出来 ——
但代价是未定价的贵模型等于没有计量。在意的话就把价格填上。

---

## 四个工具

### `model_list`

无参数。列出已配置的供应商、所有可用的 `providerId/modelId`、默认模型和当前预算状态。
skill 会要求 agent 先调它。

### `model_ask`

| 参数 | | |
|---|---|---|
| `model` | 可选 | `providerId/modelId`。如果只有一个供应商有这个裸 id，也可以只写模型 id。省略则用默认模型。 |
| `prompt` | **必填** | 问题本身，必须自包含。 |
| `system` | 可选 | system 提示。 |
| `messages` | 可选 | 之前几轮对话，用于追问。 |
| `temperature`、`maxTokens` | 可选 | 采样参数。 |
| `purpose` | 可选 | 一句话用途，记进账本。 |
| `approvalId` | 可选 | 上一次 `pending_approval` 返回的 id。 |

返回 `status: ok` 与 `text`，或 `pending_approval`，或 `blocked`。

### `model_panel`

`{ models: [...], prompt, system?, temperature?, maxTokens?, purpose? }` ——
把**同一个** prompt 并发发给多个模型（并发数受设置约束），返回 `results`、
`totalCostUsd` 与 `skipped`。

所有引用都会在发出任何请求之前先做一遍计划，所以一个拼错的 id 不会让已经付过钱的
调用白跑。两三个训练背景不同的厂商，比同一家的六个模型更能告诉你东西。

### `model_usage`

`{ limit?, onlyFailures? }` —— 账本里的最近调用：供应商、模型、token、花费、耗时，
以及这个数字是不是估算的。

---

## 五个 skill

agent 在情况匹配时自己加载。

| Skill | 什么时候 |
|---|---|
| `model-cognition` | 路由：这件事到底值不值得问外部模型，以及拿到答复该怎么看 |
| `model-panel` | 怎么跑多模型会审、怎么读结果而不骗自己 |
| `model-escalation` | 怎么把难题交出去：六段式说明，以及人们总会漏掉的两个细节 |
| `model-budget` | 三道闸的区别、预估怎么算、拿到 `pending_approval` 该怎么办 |
| `model-setup` | 供应商配置、Base URL、价格、密钥模式、疑难排查 |

---

## 你的数据在哪

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/data/dsh-model-cognition/store.json` | 供应商、设置、用量账本、待批准项（权限 0600，原子写入） |
| `$DSH_HOME/.credentials.yaml` → `records` | 各供应商的 API Key，键名 `dsh-model-cognition/<providerId>` |
| `~/.dsh/.credentials.yaml` | 默认安装下的同一个文件 |

数据文件损坏时会被改名成 `store.json.corrupt-<时间戳>` 而不是删掉，插件从默认值启动。数据文件**存在但读不出来**时不按「不存在」处理：插件会拒绝启动，而不是用一个空文档盖掉你仍然拥有的供应商。

数据文件是全机所有 Harness 进程共用的——桌面端和 `dsh web` 会话可以同时开着。每个进程在写入前都会重新读取文档，所以一个窗口里的保存不会删掉另一个窗口里刚添加的供应商。

`GET /model-cognition/export` 返回除密钥以外的整份文档 —— 设置、供应商、用量账本、
待批准的调用 —— 可用于备份。

## 安全

- **密钥不会到浏览器。** 面板的 `/state` 只报 `keyConfigured` 和 `keySource`；
  没有任何路由会返回密钥，渲染测试里有一条断言盯着这件事。
- **每个路由都有围栏。** 面板优先用宿主自己的 `connection.requestRejection`；
  没有这个服务时，要求 `Host` 是回环地址、`Sec-Fetch-Site` 是 `same-origin`/`none`、
  `Origin` 的主机名与 Host 头一致。
- **密钥不进日志**，`model_ask` 的输出只带 token 数与花费。
- **插件零依赖。** 用 `fetch` 直连厂商，用 Harness 的凭据服务读密钥 ——
  不装任何东西，运行时也不 import 任何 `@deepseek-ai/*`。

## 开发

```bash
node test/self-test.mjs        # 157 项：存储、工具、预算、skill、HTTP 面
node test/client-render.mjs    # 123 项：每一个设置界面，用真实 React 渲染
node test/runtime-contract.mjs # 31 项：对着真实的 DSH 工具注册表校验
```

宿主测试会起一个假的 OpenAI 兼容端点，拿真的工具和路由去打它 —— 不联网、不需要 DSH、
不需要真密钥。客户端测试用 `react-dom/server` 挂载面板，因此需要一份 React：

```bash
mkdir scratch && cd scratch && pnpm add react@18 react-dom@18
MC_TEST_MODULES=/path/to/scratch node test/client-render.mjs
```

契约测试专门用来抓那种「一声不响的失效」。DSH 的工具注册表对每份 schema 都强制一个
JSON Schema 子集，违反的插件会丢掉那个工具，而用户看不到任何报错。读那段校验代码不等于
跑过它，所以只要给出一棵 DSH 目录树，这个测试就会导入真正的模块，用真正的
`assertSupportedJsonSchema` 把本插件发布的每一份 schema 跑一遍：

```bash
DSH_TOOLS_ENTRY=/path/to/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js \
  node test/runtime-contract.mjs
```

没有它时测试以成功退出码跳过，这样检出本仓库的人依旧零依赖。客户端与契约测试在缺少输入时
都是跳过而不是失败。

### 已经在真实 Harness 里验证过什么

除了上面这些测试，本插件还在一个真实的 DSH profile 里端到端跑通过：设置面板在「设置」浮层
里渲染出来，从面板保存了供应商，并且有一轮真实的 agent 对话调用了 `model_ask` 打到一个假的
OpenAI 兼容端点，调用被记进了用量账本（128 输入 token、96 输出 token、按供应商自己的
价格算出 $0.000076）。

## 兼容性

- DSH `>= 0.1.7`（`dsh.manifestVersion: 1`），Node `>= 20`。
- 在 Windows 版 DSH 桌面端上测试通过。
- **刻意不用 `ctx.llm`**：那个服务只跟 Harness 自己配置好的供应商说话，而这个插件的
  全部意义就是接上 Harness 不认识的供应商。如果你想要的是让 Harness 本身认识你的供应商，
  `llm-pi-ai` 才是对的工具 —— 见 `skills/model-setup/SKILL.md`。

## 许可

MIT
