# dsh-model-cognition

Call **other models** from inside a DeepSeek Harness conversation — with your own
provider keys, a budget guard between you and your wallet, and a settings panel
that lives in the Desktop app.

[中文说明](README.zh.md)

---

## Why

A single model is a single opinion. Sometimes you want a second one: a cheaper
model for bulk work, a reasoning model for a hard call, or two vendors side by
side so their disagreement tells you something.

`dsh-model-cognition` adds four agent tools and five skills that let the agent do
exactly that — ask another model, poll several at once, and keep a ledger of what
it spent. Nothing is proxied through a service: your key goes straight to the
vendor you configured.

**It is not a subagent.** A subagent is another copy of *you*, with tools and a
filesystem. `model_ask` is a text question to a stranger: no tools, no files, no
memory beyond what you put in the prompt. That is the point — it is cheap, fast,
and cannot touch anything.

## What you get

| | |
|---|---|
| **4 agent tools** | `model_list`, `model_ask`, `model_panel`, `model_usage` |
| **5 skills** | routing, multi-model review, escalation, budget, setup |
| **1 settings page** | Settings → Model Cognition, three tabs |
| **2 protocols** | OpenAI-compatible (`/chat/completions`) and Anthropic (`/v1/messages`) |

---

## Install

### From the plugin manager

```
dsh plugin --profile <your-profile> add dsh-model-cognition
```

then make sure `dsh-model-cognition` is listed under `dsh.profile.bundles` in the
profile's `package.json`.

### From a checkout

```jsonc
// <profile>/package.json
"dependencies": {
  "dsh-model-cognition": "link:/absolute/path/to/dsh-model-cognition"
},
"dsh": { "profile": { "bundles": [ /* … */ "dsh-model-cognition" ] } }
```

Restart the app afterwards: bundles are resolved at startup.

> Nothing here is installed into the package directory. Settings and the usage
> ledger live in `$DSH_HOME/data/dsh-model-cognition/`, because a package update
> replaces everything inside the package.

---

## Configure a provider (five minutes)

Open **Settings → Model Cognition → 供应商 / Providers**.

1. **新增供应商 / Add provider** — pick a preset or fill in the blank one.
2. **Base URL** — must include the version segment. The plugin appends
   `/chat/completions` (OpenAI protocol) or `/v1/messages` (Anthropic protocol)
   itself.

   | Vendor | Base URL |
   |---|---|
   | DeepSeek | `https://api.deepseek.com/v1` |
   | OpenAI | `https://api.openai.com/v1` |
   | Anthropic | `https://api.anthropic.com` |
   | Google (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | OpenRouter | `https://openrouter.ai/api/v1` |
   | Moonshot | `https://api.moonshot.cn/v1` |
   | DashScope (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
   | Zhipu | `https://open.bigmodel.cn/api/paas/v4` |
   | SiliconFlow | `https://api.siliconflow.cn/v1` |
   | Ollama (local) | `http://127.0.0.1:11434/v1` |
   | LM Studio (local) | `http://127.0.0.1:1234/v1` |

3. **API Key** — stored in the Harness credential store by default; the browser
   never reads it back, only whether one is configured. **Saving an empty field
   keeps the existing key**; use *清除密钥 / Clear key* to remove it.
4. **Models** — add one row per model id, exactly as the vendor spells it.
   Prices are per **million** tokens. Leave them blank if you do not know them:
   an unpriced model is never blocked by a budget gate, and the panel shows
   "未定价" rather than a wrong number. *Do not fill in prices from memory* —
   a wrong price is worse than no price.
5. **测试连接 / Test connection** works before saving, so a typo costs nothing.

---

## Budget: three gates

| Gate | Meaning | Can the agent pass it? |
|---|---|---|
| **单次上限** `maxCostPerCallUsd` | hard ceiling for one call | **no** |
| **每日上限** `maxCostPerDayUsd` | hard ceiling for the day | **no** |
| **自动放行阈值** `autoApproveUnderUsd` | under this, calls just happen | **yes, with your approval** |

An estimate is computed before every call (CJK ≈ 1 token/char, Latin ≈ 1 token
per 4 chars, plus `maxTokens` as the ceiling). Over the soft line, the tool does
**not** call the vendor — it returns `pending_approval` with an `approvalId`, and
the call appears in the panel's **用量与预算 / Budget** tab. Approving it there
authorises *that one call*: same provider, same model, same prompt digest, valid
for 30 minutes. The agent then retries with the `approvalId`.

Models with no price are exempt from all three gates. That is deliberate — the
plugin will not invent a number to block you with — but it also means an
unpriced expensive model is unmetered. Set prices if you care.

---

## The tools

### `model_list`

No parameters. Lists configured providers, every available `providerId/modelId`,
the default model, and the current budget state. The agent is told to call this
first.

### `model_ask`

| Parameter | | |
|---|---|---|
| `model` | optional | `providerId/modelId`. A bare model id works if exactly one provider has it. Falls back to the default model. |
| `prompt` | **required** | The question. Must be self-contained. |
| `system` | optional | System prompt. |
| `messages` | optional | Prior turns, for a follow-up. |
| `temperature`, `maxTokens` | optional | Sampling. |
| `purpose` | optional | One line recorded in the ledger. |
| `approvalId` | optional | From a previous `pending_approval`. |

Returns `status: ok` with `text`, or `pending_approval`, or `blocked`.

### `model_panel`

`{ models: [...], prompt, system?, temperature?, maxTokens?, purpose? }` — sends
the **same** prompt to several models concurrently (bounded by the concurrency
setting) and returns `results`, `totalCostUsd` and `skipped`.

Every reference is planned before anything is sent, so one typo cannot waste the
calls that were already paid for. Two or three vendors with different training
tell you more than six models from one family.

### `model_usage`

`{ limit?, onlyFailures? }` — recent calls from the ledger: provider, model,
tokens, cost, latency, whether the number is an estimate.

---

## The skills

Skills the agent loads on its own when the situation matches.

| Skill | When |
|---|---|
| `model-cognition` | the router: is this worth asking an outside model at all, and how to read the answer |
| `model-panel` | how to run and read a multi-model review without fooling yourself |
| `model-escalation` | how to hand a hard problem over: the six-part brief, and the two details people always omit |
| `model-budget` | how the three gates differ, how the estimate is computed, what to do with `pending_approval` |
| `model-setup` | provider setup, base URLs, pricing, key modes, troubleshooting |

---

## Where your data lives

| Path | Contents |
|---|---|
| `$DSH_HOME/data/dsh-model-cognition/store.json` | providers, settings, usage ledger, pending approvals (mode 0600, atomic writes) |
| `$DSH_HOME/.credentials.yaml` → `records` | provider API keys, under `dsh-model-cognition/<providerId>` |
| `~/.dsh/.credentials.yaml` | the same file on a default install |

A corrupt store is renamed `store.json.corrupt-<timestamp>` rather than deleted,
and the plugin starts from defaults. A store that exists but cannot be read is
**not** treated as absent: the plugin refuses to start rather than seed an empty
document over providers you still have.

The store file is shared by every Harness process on the machine — the Desktop
app and a `dsh web` session can both be open. Each process re-reads the document
before it writes, so a save in one window cannot delete a provider added in the
other.

`GET /model-cognition/export` returns the whole document except keys —
settings, providers, the usage ledger and the pending approvals — for a backup.

## Security

- **Keys never reach the browser.** The panel's `/state` reports `keyConfigured`
  and `keySource`; there is no route that returns a key, and the render test
  asserts it.
- **Every route is fenced.** The panel prefers the Host's own
  `connection.requestRejection`; failing that it requires a loopback `Host`, a
  `Sec-Fetch-Site` of `same-origin`/`none`, and an `Origin` whose host matches.
- **No key is ever logged**, and `model_ask` output carries token counts and
  costs, not credentials.
- **The plugin ships zero dependencies.** It talks to vendors with `fetch` and
  reads keys through the Harness credential service — nothing is installed, and
  nothing is imported from `@deepseek-ai/*` at runtime.

## Development

```bash
node test/self-test.mjs       # 157 checks: store, tools, budget, skills, HTTP surface
node test/client-render.mjs   # 123 checks: every settings screen, rendered with real React
node test/runtime-contract.mjs # 31 checks against the real DSH tool registry
```

The host suite spins up a mock OpenAI-compatible vendor and drives the real
tools and routes against it — no network, no DSH, no real key. The client suite
mounts the panel with `react-dom/server`, which needs React from somewhere:

```bash
mkdir scratch && cd scratch && pnpm add react@18 react-dom@18
MC_TEST_MODULES=/path/to/scratch node test/client-render.mjs
```

The contract suite is the one that catches a silent failure. The DSH tool
registry enforces a JSON Schema subset on every schema a definition carries, and
a plugin that violates it loses the tool without an error the user ever sees.
Reading that checker is not the same as running it, so given a DSH tree this
suite imports the genuine module and runs the genuine `assertSupportedJsonSchema`
over every schema this plugin ships:

```bash
DSH_TOOLS_ENTRY=/path/to/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js \
  node test/runtime-contract.mjs
```

Without it the suite skips with a success exit code, so the checkout stays
dependency-free for everyone else. Both the client and contract suites skip
rather than fail when their input is missing.

### What has been verified against a running Harness

Beyond the suites, this plugin has been driven end to end in a real DSH
profile — the settings panel rendered inside the Settings overlay, a provider
saved from it, and an agent turn that called `model_ask` against a mock
OpenAI-compatible vendor and booked the call in the usage ledger (128 prompt
tokens, 96 completion tokens, $0.000076 priced from the provider's own rates).

## Compatibility

- DSH `>= 0.1.7` (`dsh.manifestVersion: 1`), Node `>= 20`.
- Tested on the DSH Desktop app for Windows.
- `ctx.llm` is deliberately **not** used: that service speaks to the Harness's own
  configured providers, and this plugin's whole purpose is to reach providers the
  Harness does not know about. If you want the Harness itself to know about your
  provider, `llm-pi-ai` is the better tool — see `skills/model-setup/SKILL.md`.

## License

MIT
