/**
 * Shared vocabulary for both halves of the plugin.
 *
 * `PACKAGE_NAME` is the client module id, the bundle key the Host's plugin page
 * addresses (`plugins.bundle.config` entries are keyed by the bundle's package
 * name) and the scope half of every credential record this plugin stores.
 * `ENTRY_ID` is the `cordis.patch.yml` row id, which is also the settings
 * namespace: a settings namespace IS a profile entry id and its schema IS that
 * entry's Config.
 */

/** The bundle's package name; the client module id and credential-key scope. */
export const PACKAGE_NAME = 'dsh-model-cognition'

/** The patch row id, and therefore the settings namespace this plugin owns. */
export const ENTRY_ID = 'model-cognition'

/** Route prefix the Host half owns under the Harness web server. */
export const ROUTE_PREFIX = '/model-cognition'

/** Maximum request body the Host half reads from one API call. */
export const BODY_LIMIT = 256 * 1024

/** How many usage records the store keeps before dropping the oldest. */
export const USAGE_KEEP = 500

/** How many budget approvals the store keeps, decided ones included. */
export const APPROVAL_KEEP = 100

/**
 * How long an approved-but-unused grant stays usable.
 *
 * A grant is a decision about one specific call at one specific price; letting
 * it sit for a day would let an agent spend it on a differently-shaped request
 * long after the user stopped thinking about it.
 */
export const APPROVAL_TTL_MS = 30 * 60 * 1000

/**
 * The settings the panel edits, and the seed for a fresh install.
 *
 * These are the *store's* settings, not the row's Config: the panel writes here
 * through the Host routes, and the row's Config only seeds a store that has no
 * value yet. Keeping one writer means the panel and the tools can never
 * disagree about what the current default is.
 */
export const SETTINGS_DEFAULTS = Object.freeze({
  /** `providerId/modelId` used when a caller names no model. */
  defaultModel: '',
  /** Sampling temperature for every call, unless the caller overrides it. */
  temperature: 0.7,
  /** Completion ceiling for one call, unless the caller overrides it. */
  maxTokens: 2048,
  /** Per-request timeout in milliseconds. */
  timeoutMs: 120000,
  /** How many models `model_panel` may consult at once. */
  concurrency: 4,
  /** Refuse a single call whose estimated cost exceeds this many USD. 0 disables. */
  maxCostPerCallUsd: 0.5,
  /** Refuse a call whose cost would take today's total past this many USD. 0 disables. */
  maxCostPerDayUsd: 5,
  /** A call estimated below this many USD runs without asking. 0 asks for every priced call. */
  autoApproveUnderUsd: 0.05,
  /** Tell the consulted model that another agent is asking, not a human. */
  includeUsageInPrompt: true,
})

/** Every settings key, in the order the panel shows them. */
export const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_DEFAULTS))

/**
 * Where a provider's key comes from.
 *
 * `record` is the product's credential store (`.credentials.yaml`), which keeps
 * secret values out of every configuration file; `inline` keeps the value in
 * this plugin's own store for a host with no credential service, or for a
 * throwaway endpoint the user does not want in the shared key store.
 */
export const KEY_MODES = Object.freeze(['record', 'inline', 'none'])

/**
 * The wire protocol one provider speaks.
 *
 * Both adapters are implemented in `providers.js`; every OpenAI-compatible
 * vendor (which is most of them, including local runtimes) uses `openai`, and
 * Anthropic's Messages API is the only other shape worth a dedicated adapter.
 */
export const PROTOCOLS = Object.freeze(['openai', 'anthropic'])

/**
 * Provider presets: an endpoint, a protocol and a few example model ids.
 *
 * Deliberately no prices. A wrong price is worse than a missing one: the panel
 * shows `未定价` and the cost guard stays out of the way until the user enters
 * the vendor's own numbers, instead of quoting a figure that silently drifts
 * away from the vendor's pricing page.
 */
export const PROVIDER_PRESETS = Object.freeze([
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: '在 platform.deepseek.com 创建',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-… 于 platform.openai.com',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o4-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyHint: 'sk-ant-… 于 console.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'AIza… 于 aistudio.google.com',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-… 于 openrouter.ai/keys',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro'],
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k'],
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 Qwen',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen-plus', 'qwen3-coder-plus'],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air'],
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3.2-Exp', 'Qwen/Qwen3-235B-A22B-Instruct-2507'],
  },
  {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-4-fast'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'magistral-medium-latest'],
  },
  {
    id: 'together',
    label: 'Together AI',
    protocol: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    id: 'ollama',
    label: 'Ollama（本机）',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyless: true,
    models: ['qwen3:8b', 'llama3.2'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本机）',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    keyless: true,
    models: [],
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    protocol: 'openai',
    baseUrl: '',
    models: [],
  },
])

/** The preset a fresh provider row starts from when the panel names none. */
export const FALLBACK_PRESET = PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]

/** Look one preset up by id. */
export function presetOf(id) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/** A provider id: lowercase, digits and hyphens, per the credential-key grammar. */
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,47}$/

/** Whether a raw string may be a provider id. */
export function isValidProviderId(value) {
  return typeof value === 'string' && PROVIDER_ID_RE.test(value)
}

/**
 * Derive a valid provider id from a label, for the panel's "add provider"
 * flow: lowercased ASCII, runs of anything else collapsed to one hyphen.
 *
 * @param label - the human label the user typed.
 * @param taken - ids already in use, so the result does not collide.
 * @returns a provider id matching {@link isValidProviderId}.
 */
export function deriveProviderId(label, taken = []) {
  const base = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const seed = /^[a-z]/.test(base) ? base : `p-${base}`.replace(/-+$/, '')
  const stem = isValidProviderId(seed) ? seed : 'provider'
  if (!taken.includes(stem)) return stem
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${stem}-${Date.now().toString(36)}`
}
