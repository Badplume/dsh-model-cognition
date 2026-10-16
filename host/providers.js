/**
 * The two wire adapters, and the model reference grammar the tools speak.
 *
 * A reference is `providerId/modelId` — for example `deepseek/deepseek-chat` —
 * split at the *first* slash so a provider may host model ids that contain
 * slashes (OpenRouter and SiliconFlow both do). A bare model id is accepted when
 * exactly one configured provider offers it, which keeps the common case short
 * without ever guessing between two vendors.
 *
 * The base URL always includes the version segment, because that segment is not
 * uniform across vendors: OpenAI, OpenRouter and SiliconFlow answer on
 * `<base>/chat/completions`, Alibaba's compatible mode on
 * `<base>/compatible-mode/v1/chat/completions`, and Zhipu on `<base>/api/paas/v4/…`.
 * Appending a version ourselves would be right for some vendors and wrong for
 * the rest, so the preset carries the whole prefix and the adapter appends only
 * the operation.
 *
 * @module dsh-model-cognition/host/providers
 */

/** A failed model call, carrying enough structure for the panel to explain it. */
export class ModelCallError extends Error {
  /**
   * @param message - a human-readable summary.
   * @param options - `code` classifies the failure; `status` is an HTTP status
   *                  when there was one; `detail` is the provider's own words.
   */
  constructor(message, { code = 'error', status, detail, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ModelCallError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** Trim a base URL and drop its trailing slashes; '' stays ''. */
function normalizeBase(baseUrl) {
  return typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : ''
}

/** The request URL for one operation on one provider. */
function endpoint(provider, operation) {
  const base = normalizeBase(provider.baseUrl)
  if (base === '') throw new ModelCallError(`供应商 ${provider.id} 还没有填写 Base URL`, { code: 'config' })
  if (provider.protocol === 'anthropic') {
    if (operation === 'chat') return `${base}/v1/messages`
    if (operation === 'models') return `${base}/v1/models`
  }
  if (operation === 'chat') return `${base}/chat/completions`
  if (operation === 'models') return `${base}/models`
  throw new ModelCallError(`未知操作 ${operation}`, { code: 'config' })
}

/** The headers one provider's protocol needs, with or without a key. */
function headersFor(provider, apiKey) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (apiKey !== undefined && apiKey !== '') {
    if (provider.protocol === 'anthropic') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.authorization = `Bearer ${apiKey}`
    }
  }
  for (const [name, value] of Object.entries(provider.extraHeaders ?? {})) headers[name.toLowerCase()] = value
  return headers
}

/**
 * Combine the caller's cancellation with this call's own timeout.
 *
 * A missing `AbortSignal.any` (older runtimes) falls back to the timeout alone:
 * losing the outer cancellation is survivable, losing the timeout is not.
 */
function signalFor(timeoutMs, outer) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (timeout === undefined) return outer
  if (outer === undefined || outer === null) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outer, timeout])
  return timeout
}

/** Pull a provider's error text out of a JSON or plain-text body. */
function errorDetail(body, status) {
  if (typeof body === 'string' && body.trim() !== '') return body.trim().slice(0, 600)
  if (body !== null && typeof body === 'object') {
    const error = body.error ?? body.message ?? body
    if (typeof error === 'string') return error.slice(0, 600)
    if (error !== null && typeof error === 'object') {
      const text = error.message ?? error.msg ?? error.detail ?? error.type
      if (typeof text === 'string') return text.slice(0, 600)
      return JSON.stringify(error).slice(0, 600)
    }
  }
  return `HTTP ${status}`
}

/** Send one request and decode the response body. */
async function request(url, { method, headers, body, signal, timeoutMs }) {
  const bound = signalFor(timeoutMs, signal)
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: bound,
    })
  } catch (cause) {
    if (cause?.name === 'TimeoutError') {
      throw new ModelCallError(`请求超时（${timeoutMs} ms）`, { code: 'timeout', cause })
    }
    if (cause?.name === 'AbortError') {
      throw new ModelCallError('请求已取消', { code: 'abort', cause })
    }
    throw new ModelCallError(`无法连接 ${new URL(url).host}：${cause?.message ?? cause}`, { code: 'network', cause })
  }
  const text = await response.text()
  let parsed
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!response.ok) {
    const detail = errorDetail(parsed ?? text, response.status)
    throw new ModelCallError(
      `${response.status} ${response.statusText || '请求被拒绝'}：${detail}`,
      { code: response.status === 401 || response.status === 403 ? 'auth' : 'http', status: response.status, detail },
    )
  }
  if (parsed === null) {
    throw new ModelCallError('供应商返回了无法解析的响应体', { code: 'parse', detail: text.slice(0, 600) })
  }
  return parsed
}

/** Split an internal message list into an Anthropic `system` plus turns. */
function anthropicMessages(messages) {
  const system = []
  const turns = []
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }
    turns.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })
  }
  // The Messages API refuses an empty turn list, and a lone system prompt is a
  // legitimate way to ask a model something.
  if (turns.length === 0) turns.push({ role: 'user', content: '请开始。' })
  return { system: system.join('\n\n'), turns }
}

/** Read one OpenAI-compatible chat completion. */
function readOpenAi(payload) {
  const choice = payload?.choices?.[0]
  const message = choice?.message ?? {}
  let text = typeof message.content === 'string' ? message.content : ''
  // Some vendors answer with content parts rather than a string.
  if (text === '' && Array.isArray(message.content)) {
    text = message.content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  const reasoning = typeof message.reasoning_content === 'string'
    ? message.reasoning_content
    : typeof message.reasoning === 'string' ? message.reasoning : ''
  return {
    text,
    reasoning,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : '',
    usage: {
      promptTokens: payload?.usage?.prompt_tokens,
      completionTokens: payload?.usage?.completion_tokens,
    },
  }
}

/** Read one Anthropic Messages response. */
function readAnthropic(payload) {
  const parts = Array.isArray(payload?.content) ? payload.content : []
  const text = parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  const reasoning = parts
    .filter((part) => part?.type === 'thinking' && typeof part.thinking === 'string')
    .map((part) => part.thinking)
    .join('')
  return {
    text,
    reasoning,
    finishReason: typeof payload?.stop_reason === 'string' ? payload.stop_reason : '',
    usage: {
      promptTokens: payload?.usage?.input_tokens,
      completionTokens: payload?.usage?.output_tokens,
    },
  }
}

/**
 * Run one completion.
 *
 * @param ctx - host plugin context (unused directly; kept for symmetry with the
 *              key lookup its caller performs).
 * @param options - `provider`, `apiKey`, `modelId`, `messages`, `temperature`,
 *                  `maxTokens`, `timeoutMs`, `signal`.
 * @returns `{ text, reasoning, finishReason, usage, model, ms }`.
 * @throws {ModelCallError} for a configuration, network, auth, HTTP or parse failure.
 */
export async function complete(_ctx, options) {
  const { provider, apiKey, modelId, messages, temperature, maxTokens, timeoutMs, signal } = options
  if (provider === undefined || provider === null) throw new ModelCallError('没有指定供应商', { code: 'config' })
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new ModelCallError('没有指定模型', { code: 'config' })
  }
  if (provider.keyless !== true && (apiKey === undefined || apiKey === '')) {
    throw new ModelCallError(
      `供应商 ${provider.id} 还没有配置 API Key`,
      { code: 'config', detail: '在 设置 → Model Cognition → 供应商 里填入密钥。' },
    )
  }
  const url = endpoint(provider, 'chat')
  const headers = headersFor(provider, apiKey)
  const started = Date.now()
  let body
  if (provider.protocol === 'anthropic') {
    const { system, turns } = anthropicMessages(messages)
    body = { model: modelId, messages: turns, max_tokens: maxTokens }
    if (system !== '') body.system = system
    if (Number.isFinite(temperature)) body.temperature = temperature
  } else {
    body = { model: modelId, messages, stream: false }
    if (Number.isFinite(temperature)) body.temperature = temperature
    // A vendor that renamed or refuses the token field says so here (reasoning
    // models on some hosts take `max_completion_tokens` and reject `max_tokens`).
    if (provider.maxTokensParam !== 'none' && Number.isFinite(maxTokens)) {
      body[provider.maxTokensParam ?? 'max_tokens'] = maxTokens
    }
  }
  const payload = await request(url, { method: 'POST', headers, body, signal, timeoutMs })
  const read = provider.protocol === 'anthropic' ? readAnthropic(payload) : readOpenAi(payload)
  return { ...read, model: payload?.model ?? modelId, ms: Date.now() - started }
}

/**
 * Ask one provider which models it serves.
 *
 * Used by the panel's connection test and by the model picker. Not every
 * OpenAI-compatible host implements `/models`; the panel treats a failure as
 * "type the id yourself" rather than as a broken provider.
 *
 * @returns `[{ id, label }]`.
 */
export async function listModels(_ctx, { provider, apiKey, timeoutMs, signal }) {
  if (provider === undefined || provider === null) throw new ModelCallError('没有指定供应商', { code: 'config' })
  if (provider.keyless !== true && (apiKey === undefined || apiKey === '')) {
    throw new ModelCallError(`供应商 ${provider.id} 还没有配置 API Key`, { code: 'config' })
  }
  const payload = await request(endpoint(provider, 'models'), {
    method: 'GET',
    headers: headersFor(provider, apiKey),
    signal,
    timeoutMs,
  })
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
  const seen = new Set()
  const models = []
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : typeof row?.name === 'string' ? row.name : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    models.push({ id, label: typeof row?.display_name === 'string' ? row.display_name : '' })
  }
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
}

/**
 * Turn a reference into the provider row and model id a call needs.
 *
 * @param store - the plugin store, whose providers and settings are consulted.
 * @param ref - `providerId/modelId`, a bare model id, or '' for the default.
 * @returns `{ provider, modelId }`.
 * @throws {ModelCallError} with `code: 'config'` and a message naming the
 *         candidates, when the reference is missing or ambiguous.
 */
export function resolveRef(store, ref) {
  const raw = typeof ref === 'string' ? ref.trim() : ''
  const wanted = raw === '' ? String(store.settings.defaultModel ?? '').trim() : raw
  if (wanted === '') {
    throw new ModelCallError('没有指定模型，也没有设置默认模型', {
      code: 'config',
      detail: '传入 providerId/modelId，或在 设置 → Model Cognition → 常规 里设置默认模型。',
    })
  }
  const slash = wanted.indexOf('/')
  if (slash > 0) {
    const providerId = wanted.slice(0, slash)
    const modelId = wanted.slice(slash + 1)
    const provider = store.provider(providerId)
    if (provider === undefined) {
      const known = store.providers.map((entry) => entry.id).join('、')
      throw new ModelCallError(`没有名为 ${providerId} 的供应商`, {
        code: 'config',
        detail: known === '' ? '还没有配置任何供应商。' : `已配置：${known}`,
      })
    }
    if (provider.enabled === false) throw new ModelCallError(`供应商 ${providerId} 已被停用`, { code: 'config' })
    if (modelId === '') throw new ModelCallError(`${providerId}/ 后面缺少模型 id`, { code: 'config' })
    return { provider, modelId }
  }
  // A bare id: accept it only when one configured provider claims it.
  const matches = []
  for (const provider of store.providers) {
    if (provider.enabled === false) continue
    if (provider.models.some((model) => model.id === wanted)) matches.push({ provider, modelId: wanted })
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    const candidates = matches.map((match) => `${match.provider.id}/${match.modelId}`).join('、')
    throw new ModelCallError(`模型 ${wanted} 出现在多个供应商里，请写明是哪一个`, { code: 'config', detail: candidates })
  }
  throw new ModelCallError(`没有配置名为 ${wanted} 的模型`, {
    code: 'config',
    detail: '请写成 providerId/modelId，或先在 设置 → Model Cognition 里把它加进某个供应商。',
  })
}

/** Every enabled `providerId/modelId` the user has configured, for prompts. */
export function catalog(store) {
  const rows = []
  for (const provider of store.providers) {
    if (provider.enabled === false) continue
    for (const model of provider.models) rows.push(`${provider.id}/${model.id}`)
  }
  return rows
}
