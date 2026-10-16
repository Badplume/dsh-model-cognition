/**
 * The one place a model is actually called.
 *
 * Every caller — each agent tool, the panel's connection test, a future
 * scheduled job — goes through here, so the budget guard, the usage ledger and
 * the "you are talking to another agent" framing cannot drift apart between
 * entry points. The product's own guidance is that one operation gets one
 * implementation and several callers, never one implementation per caller.
 *
 * A call is split into {@link plan} (resolve, price, decide) and
 * {@link consult} (send, book, return) so the approval flow can price a request
 * without sending it, and so a failed call is still recorded.
 *
 * @module dsh-model-cognition/host/consult
 */
import { createHash } from 'node:crypto'
import { costOf, roughTokens, usageOf } from './cost.js'
import { ModelCallError, complete, resolveRef } from './providers.js'
import { readProviderKey } from './secrets.js'

/**
 * A stable digest of exactly what a call would send.
 *
 * An approval is a decision about one question at one price. Binding the grant
 * to this digest means the retry must send the same provider, model and prompt
 * text, so a grant cannot be redirected at a different question later.
 */
export function digestOf(providerId, modelId, promptText) {
  return createHash('sha256').update(`${providerId}\n${modelId}\n${promptText}`).digest('hex').slice(0, 32)
}

/** The framing this plugin adds when settings ask it to. */
const AGENT_FRAMING = [
  'You are being consulted by another AI agent inside the DeepSeek Harness.',
  'Answer the request directly and completely: no preamble, no offer to help further,',
  'no reference to being a model. Your reply is read as data by the requesting agent.',
].join(' ')

/** Assemble the message list one consult sends. */
function messagesFor(store, { system, prompt, messages }) {
  if (Array.isArray(messages) && messages.length > 0) return messages
  const parts = []
  if (typeof system === 'string' && system.trim() !== '') parts.push(system.trim())
  if (store.settings.includeUsageInPrompt) parts.push(AGENT_FRAMING)
  return [
    { role: 'system', content: parts.join('\n\n') === '' ? AGENT_FRAMING : parts.join('\n\n') },
    { role: 'user', content: typeof prompt === 'string' ? prompt : '' },
  ]
}

/**
 * Decide whether a call may run, and whether the user must approve it first.
 *
 * Two independent limits: one call may not exceed the per-call cap, and today's
 * total may not cross the daily cap. A call whose price is unknown is never
 * blocked — refusing to act on a number nobody supplied would make every
 * unpriced provider unusable, and the panel shows the user that pricing is
 * missing.
 *
 * @returns `{ blocked, needsApproval, reason, usd, todayUsd }`.
 */
export function checkBudget(store, modelId, callEstimate) {
  const settings = store.settings
  const usd = callEstimate.usd
  const todayUsd = store.costToday()
  const verdict = { blocked: false, needsApproval: false, reason: '', usd, todayUsd }
  if (usd === null) {
    verdict.reason = '该模型未定价，无法估算成本'
    return verdict
  }
  const perCall = Number(settings.maxCostPerCallUsd)
  if (Number.isFinite(perCall) && perCall > 0 && usd > perCall) {
    verdict.blocked = true
    verdict.reason = `单次预估 $${usd.toFixed(6)} 超过单次上限 $${perCall}（可在 设置 → Model Cognition 里调整）`
    return verdict
  }
  const perDay = Number(settings.maxCostPerDayUsd)
  if (Number.isFinite(perDay) && perDay > 0 && todayUsd + usd > perDay) {
    verdict.blocked = true
    verdict.reason = `今日已用 $${todayUsd.toFixed(4)}，本次 $${usd.toFixed(6)} 会超过每日上限 $${perDay}`
    return verdict
  }
  const auto = Number(settings.autoApproveUnderUsd)
  if (!Number.isFinite(auto) || auto <= 0 || usd > auto) {
    verdict.needsApproval = true
    verdict.reason = auto > 0
      ? `预估 $${usd.toFixed(6)}，超过自动放行阈值 $${auto}`
      : '自动放行阈值为 0，每次计费调用都需要批准'
  }
  return verdict
}

/**
 * Resolve, price and judge a call without sending it.
 *
 * @param store - the plugin store.
 * @param options - `ref`, `prompt` or `messages`, `system`, `maxTokens`.
 * @returns `{ provider, modelId, messages, promptText, maxTokens, estimate, verdict }`.
 * @throws {ModelCallError} with `code: 'config'` when the reference is unusable.
 */
export function plan(store, options) {
  const { provider, modelId } = resolveRef(store, options.ref)
  const messages = messagesFor(store, options)
  const promptText = messages.map((message) => message.content).join('\n')
  const settings = store.settings
  const maxTokens = Number.isFinite(Number(options.maxTokens))
    ? Number(options.maxTokens)
    : Number(settings.maxTokens)
  const promptTokens = roughTokens(promptText)
  const estimate = { promptTokens, maxTokens, usd: costOf(provider, modelId, promptTokens, maxTokens) }
  return {
    provider,
    modelId,
    messages,
    promptText,
    maxTokens,
    estimate,
    verdict: checkBudget(store, modelId, estimate),
    digest: digestOf(provider.id, modelId, promptText),
  }
}

/**
 * Send one planned call and book the result.
 *
 * The caller owns the approval decision; this function performs the call and
 * records it either way, because a failed call is as interesting in the ledger
 * as a successful one.
 *
 * @param ctx - host plugin context.
 * @param store - the plugin store.
 * @param planned - the result of {@link plan}.
 * @param options - `temperature`, `purpose`, `signal`.
 * @returns `{ text, reasoning, finishReason, provider, modelId, usage, costUsd,
 *           estimated, ms }`.
 * @throws {ModelCallError} on a configuration, network or provider failure.
 */
export async function consult(ctx, store, planned, options = {}) {
  const { provider, modelId, messages, promptText, maxTokens } = planned
  const apiKey = await readProviderKey(ctx, provider)
  const temperature = options.temperature === undefined
    ? Number(store.settings.temperature)
    : Number(options.temperature)
  const started = Date.now()
  try {
    const result = await complete(ctx, {
      provider,
      apiKey,
      modelId,
      messages,
      temperature,
      maxTokens,
      timeoutMs: Number(store.settings.timeoutMs),
      signal: options.signal,
    })
    const usage = usageOf(result.usage, promptText, result.text)
    const costUsd = costOf(provider, modelId, usage.promptTokens, usage.completionTokens)
    store.recordUsage({
      at: new Date().toISOString(),
      provider: provider.id,
      model: modelId,
      purpose: options.purpose ?? '',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd,
      ms: result.ms,
      ok: true,
    })
    return {
      text: result.text,
      reasoning: result.reasoning,
      finishReason: result.finishReason,
      provider: provider.id,
      modelId,
      usage,
      costUsd,
      estimated: usage.estimated,
      ms: result.ms,
    }
  } catch (error) {
    store.recordUsage({
      at: new Date().toISOString(),
      provider: provider.id,
      model: modelId,
      purpose: options.purpose ?? '',
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      ms: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export { ModelCallError }
