/**
 * Renders the settings panel with real React and asserts on the markup.
 *
 * This runs with no browser, no DSH and no network. It exists because the client
 * half is the part a static read cannot vouch for: a missing key, an access on
 * an undefined field, or a hook used outside a component only shows up when the
 * component actually renders.
 *
 * React is resolved from a scratch install rather than from this package — the
 * plugin ships no dependencies on purpose (the browser module table supplies
 * React at runtime), so the test supplies it instead:
 *
 *     mkdir scratch && cd scratch && pnpm add react@18 react-dom@18
 *     MC_TEST_MODULES=/path/to/scratch node test/client-render.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client', 'client.js')

const modulesDir = process.env.MC_TEST_MODULES ?? 'D:/emmm/GoworkDeepseek/_clienttest'
const requireFrom = createRequire(pathToFileURL(join(modulesDir, 'package.json')).href)
const React = requireFrom('react')
const { renderToStaticMarkup } = requireFrom('react-dom/server')

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    process.stdout.write(`  ok   ${label}\n`)
  } else {
    failed += 1
    process.stdout.write(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`)
}

// ── load the bundle the way the browser module loader would ────────────────

let spec = null
const windowStub = {
  location: { pathname: '/' },
  __ModuleLoader__: { load: (value) => { spec = value } },
}

// Evaluated as a function body so the bundle's `var`/`const` stay contained.
new Function('window', readFileSync(clientPath, 'utf8'))(windowStub)

section('bundle')
check('registers one module', spec !== null && spec.id === 'dsh-model-cognition', spec && spec.id)
check('exports a factory', typeof spec?.factory === 'function')

const requested = []
const exports_ = spec.factory((id) => {
  requested.push(id)
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
check('requires only react', requested.length === 1 && requested[0] === 'react', requested.join(','))
check('exports apply', typeof exports_.apply === 'function')
check('declares the slots service', Array.isArray(exports_.inject) && exports_.inject.includes('slots'))

const T = exports_.__test
check('exposes the render seam', T !== undefined && typeof T.ProvidersTab === 'function')

// ── apply() against a stub socket ──────────────────────────────────────────

section('registration')

const styleTags = []
const effects = []
const registrations = []

globalThis.document = {
  head: { appendChild: (node) => styleTags.push(node) },
  createElement: () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value }, textContent: '' }),
}

const slotsStub = {
  inject(slotId, factory) {
    registrations.push({ slotId, entry: factory() })
    return () => {}
  },
  register(options, Component) {
    return { options, Component }
  },
}

const ctxStub = {
  get: (name) => (name === 'slots' ? slotsStub : undefined),
  effect(fn) {
    effects.push(fn())
    return () => {}
  },
}

let applyThrew = null
try {
  exports_.apply(ctxStub)
} catch (error) {
  applyThrew = error
}
check('apply does not throw', applyThrew === null, applyThrew && applyThrew.message)
check('owns one stylesheet', styleTags.length === 1)
check('marks the stylesheet as its own', styleTags[0]?.attributes['data-plugin'] === 'dsh-model-cognition')
// A literal colour is allowed only as the fallback half of a token reference.
// A bare `color: #eee` would ignore the theme and every skin, so this walks the
// declarations and requires each coloured one to name a --dsw- token.
const bareColors = (styleTags[0]?.textContent ?? '')
  .split(/[;{}]/)
  .map((declaration) => declaration.trim())
  .filter((declaration) => /#[0-9a-f]{3,8}\b/i.test(declaration))
  .filter((declaration) => !/var\(\s*--dsw-/.test(declaration))
check('colours are token references with fallbacks', bareColors.length === 0, bareColors.join(' | '))
check('registers one settings.section', registrations.length === 1 && registrations[0].slotId === 'settings.section')
check('the entry is addressable by id', registrations[0]?.entry.options.id === 'model-cognition')
check('the entry sorts after the host rows', registrations[0]?.entry.options.order > 40)
check('the entry labels itself', registrations[0]?.entry.options.label() === 'Model Cognition')
check('the entry declares its locale namespace', registrations[0]?.entry.options.locale === 'dsh-model-cognition')
check('the host injects t', typeof registrations[0]?.entry.options.inject().t === 'function')
check('the entry has a component', typeof registrations[0]?.entry.Component === 'function')

// ── fixtures ───────────────────────────────────────────────────────────────

const MESSAGES = T.MESSAGES

function translate(key, params) {
  const template = MESSAGES.zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, name) => (params[name] === undefined ? '' : String(params[name])))
}

const state = {
  settings: {
    defaultModel: 'deepseek/deepseek-chat',
    temperature: 0.7,
    maxTokens: 2048,
    timeoutMs: 120000,
    concurrency: 4,
    maxCostPerCallUsd: 0.5,
    maxCostPerDayUsd: 5,
    autoApproveUnderUsd: 0.05,
    includeUsageInPrompt: true,
  },
  presets: [
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', keyless: false },
    { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai', keyless: true },
  ],
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      keyMode: 'record',
      keyless: false,
      keyConfigured: true,
      keySource: 'record',
      keyWritable: true,
      enabled: true,
      notes: '',
      maxTokensParam: 'max_tokens',
      extraHeaders: {},
      models: [
        { id: 'deepseek-chat', inputPer1M: 0.27, outputPer1M: 1.1 },
        { id: 'deepseek-reasoner', inputPer1M: null, outputPer1M: null },
      ],
    },
    {
      id: 'ollama',
      label: 'Ollama（本地）',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      keyMode: 'none',
      keyless: true,
      keyConfigured: false,
      keySource: 'none',
      keyWritable: true,
      enabled: false,
      notes: '',
      maxTokensParam: 'max_tokens',
      extraHeaders: {},
      models: [{ id: 'qwen2.5:14b', inputPer1M: null, outputPer1M: null }],
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyMode: 'record',
      keyless: false,
      keyConfigured: false,
      keySource: null,
      keyWritable: true,
      enabled: true,
      notes: '',
      maxTokensParam: 'max_tokens',
      extraHeaders: {},
      models: [],
    },
  ],
  approvals: [
    {
      id: 'ap-m3k2x9-4f1a2b',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      usd: 0.0123,
      preview: '请评审下面的限流方案，指出它在什么情况下会失效……',
      createdAt: '2026-10-17T00:20:00.000Z',
    },
  ],
  usage: {
    todayUsd: 0.0123,
    totals: { calls: 4, costUsd: 0.041, promptTokens: 1200, completionTokens: 800, failed: 1 },
    records: [
      {
        at: '2026-10-17T00:18:00.000Z',
        provider: 'deepseek',
        model: 'deepseek-chat',
        promptTokens: 1200,
        completionTokens: 800,
        costUsd: 0.001204,
        ms: 940,
        ok: true,
        estimated: false,
      },
      {
        at: '2026-10-17T00:19:00.000Z',
        provider: 'ollama',
        model: 'qwen2.5:14b',
        promptTokens: 40,
        completionTokens: 180,
        costUsd: null,
        ms: 4200,
        ok: false,
        estimated: true,
      },
    ],
  },
}

const emptyState = { settings: state.settings, presets: state.presets, providers: [], approvals: [], usage: { todayUsd: 0, totals: {}, records: [] } }

/** Render one screen and run the same sanity checks on every markup. */
function render(label, element) {
  let markup = ''
  let threw = null
  try {
    markup = renderToStaticMarkup(element)
  } catch (error) {
    threw = error
  }
  check(`${label}: renders`, threw === null, threw && threw.stack?.split('\n').slice(0, 3).join(' | '))
  check(`${label}: no undefined leaked`, !/undefined|NaN|\[object Object\]/.test(markup))
  const rawKeys = markup.match(/\b(?:common|state|providers|editor|general|budget)\.[a-zA-Z]+\b/g) ?? []
  check(`${label}: every string resolved`, rawKeys.length === 0, rawKeys.join(','))
  return markup
}

const noop = async () => {}
const props = { state, t: translate, reload: noop, setError: () => {} }

// ── screens ────────────────────────────────────────────────────────────────

section('providers tab')
const providers = render('providers', React.createElement(T.ProvidersTab, props))
check('lists the first provider', providers.includes('DeepSeek'))
check('lists the second provider', providers.includes('Ollama（本地）'))
check('shows the reference grammar', providers.includes('deepseek/deepseek-chat') || providers.includes('deepseek'))
check('reports a configured key', providers.includes('密钥已配置'))
check('reports a missing key', providers.includes('缺少密钥'))
check('reports the keyless provider', providers.includes('无需密钥'))
check('reports a disabled provider', providers.includes('已停用'))
check('counts the models', providers.includes('2 个模型'))
check('reports a provider with no models', providers.includes('未配置模型'))
check('counts every provider', providers.includes('共 3 个供应商'))
check('marks the unpriced provider', providers.includes('未定价'))
check('offers a new provider', providers.includes('新增供应商'))
check('renders no editor while collapsed', !providers.includes('Base URL'))

section('providers tab (empty)')
const empty = render('providers-empty', React.createElement(T.ProvidersTab, { ...props, state: emptyState }))
check('shows the empty state', empty.includes('还没有配置任何供应商'))
check('stops counting providers at zero', empty.includes('共 0 个供应商'))

section('provider editor (saved)')
const editorState = render('editor', React.createElement(T.ProviderEditor, {
  provider: { ...state.providers[0], __presets: state.presets },
  t: translate,
  onDone: () => {},
}))
check('shows the base url field', editorState.includes('Base URL'))
check('shows the base url value', editorState.includes('https://api.deepseek.com/v1'))
check('shows a password key input', editorState.includes('type="password"'))
check('offers to keep the stored key', editorState.includes('留空表示保留原有密钥'))
check('offers to clear the key', editorState.includes('清除密钥'))
check('lists the model rows', editorState.includes('deepseek-chat') && editorState.includes('deepseek-reasoner'))
check('prefills a price', editorState.includes('0.27'))
check('leaves an unpriced model blank', editorState.includes('value=""'))
check('offers a model row', editorState.includes('添加一行'))
check('hides advanced settings until asked', !editorState.includes('额外请求头'))

section('provider editor (new)')
const editorNew = render('editor-new', React.createElement(T.ProviderEditor, {
  provider: { __new: true, __presets: state.presets, keyMode: 'record', protocol: 'openai', models: [] },
  t: translate,
  onDone: () => {},
}))
check('offers the presets', editorNew.includes('DeepSeek') && editorNew.includes('Ollama（本地）'))
check('starts with no models', editorNew.includes('添加一行'))
check('has no clear-key action yet', !editorNew.includes('清除密钥'))

section('provider editor (keyless)')
const editorKeyless = render('editor-keyless', React.createElement(T.ProviderEditor, {
  provider: { ...state.providers[1], __presets: state.presets },
  t: translate,
  onDone: () => {},
}))
check('hides the api key field', !editorKeyless.includes('API Key'))
check('keeps the keyless switch on', editorKeyless.includes('aria-checked="true"'))

section('general tab')
const general = render('general', React.createElement(T.GeneralTab, props))
check('offers the default model', general.includes('默认模型'))
check('lists a qualified model', general.includes('deepseek/deepseek-chat'))
check('marks the disabled provider in the list', general.includes('已停用'))
check('shows the temperature', general.includes('0.7'))
check('converts the timeout to seconds', general.includes('value="120"'))
check('shows the concurrency', general.includes('4'))
check('disables save until dirty', general.includes('disabled=""'))
check('renders the framing switch', general.includes('role="switch"'))

section('budget tab')
const budget = render('budget', React.createElement(T.BudgetTab, props))
check('lists the pending approval', budget.includes('ap-m3k2x9-4f1a2b') || budget.includes('claude-sonnet-4'))
check('prices the approval', budget.includes('$0.0123'))
check('offers approve and deny', budget.includes('批准') && budget.includes('拒绝'))
check('shows today', budget.includes('今日'))
check('shows the ledger totals', budget.includes('累计'))
check('renders a usage row', budget.includes('deepseek-chat'))
check('marks an estimated row', budget.includes('≈'))
check('marks an unpriced row', budget.includes('未定价'))
check('marks a failed row', budget.includes('失败'))
check('shows the gates', budget.includes('单次上限') && budget.includes('每日上限') && budget.includes('自动放行阈值'))
check('warns about unpriced models', budget.includes('不会被闸门拦住'))
check('offers a ledger reset', budget.includes('重置账本'))

section('budget tab (nothing pending)')
const budgetIdle = render('budget-idle', React.createElement(T.BudgetTab, {
  ...props,
  state: { ...state, approvals: [], usage: { todayUsd: 0, totals: {}, records: [] } },
}))
check('says nothing is waiting', budgetIdle.includes('没有等待批准的调用'))
check('says the ledger is empty', budgetIdle.includes('还没有调用记录'))

section('root shell')
const root = render('root', React.createElement(T.Root, { t: translate }))
check('shows the title', root.includes('Model Cognition'))
check('shows the subtitle', root.includes('在对话里调用其他模型'))
check('waits for the host before rendering a tab', root.includes('正在读取配置'))
check('hides the tabs until the host answers', !root.includes('用量与预算'))

const rootLoaded = render('root-loaded', React.createElement(T.Root, { t: translate, __state: state }))
check('shows every tab once loaded',
  rootLoaded.includes('供应商') && rootLoaded.includes('常规') && rootLoaded.includes('用量与预算'))
check('marks the active tab', rootLoaded.includes('aria-selected="true"'))
check('opens on the providers tab', rootLoaded.includes('新增供应商') && rootLoaded.includes('role="tablist"'))
check('stops reporting loading', !rootLoaded.includes('正在读取配置'))

section('english')
const en = (key, params) => {
  const template = MESSAGES.en[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, name) => (params[name] === undefined ? '' : String(params[name])))
}
// The zh and en dictionaries must stay in lockstep, or a language switch shows
// raw keys in one of them.
const zhKeys = Object.keys(MESSAGES.zh).sort()
const enKeys = Object.keys(MESSAGES.en).sort()
check('the dictionaries have the same keys',
  zhKeys.length === enKeys.length && zhKeys.every((key, index) => key === enKeys[index]),
  zhKeys.filter((key) => !(key in MESSAGES.en)).concat(enKeys.filter((key) => !(key in MESSAGES.zh))).join(','))
const enProviders = render('providers-en', React.createElement(T.ProvidersTab, { ...props, t: en }))
check('renders in english', enProviders.includes('Add provider') && enProviders.includes('key configured'))

section('helpers')
check('usd keeps sub-cent precision', T.usd(0.001204) === '$0.001204', T.usd(0.001204))
check('usd rounds above a cent', T.usd(0.0123) === '$0.0123', T.usd(0.0123))
check('usd handles zero', T.usd(0) === '$0', T.usd(0))
check('usd handles a missing price', T.usd(null) === '—', T.usd(null))
check('parsePrice reads blank as unpriced', T.parsePrice('') === null && T.parsePrice('  ') === null)
check('parsePrice reads a number', T.parsePrice('1.25') === 1.25)
check('parsePrice rejects nonsense', T.parsePrice('abc') === null && T.parsePrice('-3') === null)
check('the route prefix is absolute at the root', T.PREFIX === '/model-cognition', T.PREFIX)

process.stdout.write(`\n${passed}/${passed + failed} checks passed\n`)
process.exit(failed === 0 ? 0 : 1)
