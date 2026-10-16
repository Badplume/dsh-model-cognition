/**
 * Token accounting and cost estimation.
 *
 * Prices are per million tokens and are entered by the user, because a vendor's
 * price is not something this plugin can know: a hard-coded table drifts away
 * from the pricing page and then quietly lies in a budget guard. A model with no
 * price has an *unknown* cost, not a zero one, and every caller here keeps that
 * distinction — an unpriced call is never billed as free, and a budget guard
 * never blocks on a number nobody supplied.
 *
 * @module dsh-model-cognition/host/cost
 */

/**
 * A cheap pre-flight token estimate for prompt text.
 *
 * This exists only to decide whether a call needs an approval *before* it is
 * sent, which is the one moment no usage report is available. Latin text runs
 * about four characters per token and CJK closer to one, so the estimate counts
 * non-ASCII characters as whole tokens rather than pretending one ratio fits
 * both scripts. Wrong in both directions by design: the guard is advisory and
 * the real cost is booked from the provider's own usage numbers afterwards.
 */
export function roughTokens(text) {
  const value = typeof text === 'string' ? text : ''
  let ascii = 0
  let wide = 0
  for (const character of value) {
    if (character.codePointAt(0) > 0x7f) wide += 1
    else ascii += 1
  }
  return Math.ceil(ascii / 4) + wide
}

/** The price row for one model id, or null when the user has not priced it. */
export function priceOf(provider, modelId) {
  const model = provider?.models?.find((entry) => entry.id === modelId)
  if (model === undefined || model === null) return null
  if (model.inputPer1M === null && model.outputPer1M === null) return null
  return {
    inputPer1M: model.inputPer1M ?? 0,
    outputPer1M: model.outputPer1M ?? 0,
  }
}

/**
 * Cost in USD for one call, or null when the model is unpriced.
 *
 * @param provider - the provider row, whose `models` carry the prices.
 * @param modelId - the model that ran.
 * @param promptTokens - input tokens billed.
 * @param completionTokens - output tokens billed.
 */
export function costOf(provider, modelId, promptTokens, completionTokens) {
  const price = priceOf(provider, modelId)
  if (price === null) return null
  const usd = (promptTokens / 1e6) * price.inputPer1M + (completionTokens / 1e6) * price.outputPer1M
  // Sub-cent precision matters for a per-day budget that accumulates many small
  // calls, so round to six decimals rather than to cents.
  return Math.round(usd * 1e6) / 1e6
}

/**
 * The usage numbers to book for one call: the provider's own report when it
 * sent one, and a character-based estimate otherwise.
 *
 * @returns `{ promptTokens, completionTokens, estimated }`.
 */
export function usageOf(report, promptText, completionText) {
  const prompt = Number(report?.promptTokens)
  const completion = Number(report?.completionTokens)
  if (Number.isFinite(prompt) && Number.isFinite(completion)) {
    return { promptTokens: prompt, completionTokens: completion, estimated: false }
  }
  return {
    promptTokens: Number.isFinite(prompt) ? prompt : roughTokens(promptText),
    completionTokens: Number.isFinite(completion) ? completion : roughTokens(completionText),
    estimated: true,
  }
}

/**
 * A USD amount a human can read at a glance.
 *
 * Small amounts keep enough decimals to distinguish `$0.0004` from `$0.004`,
 * which a naive two-decimal format would both render as `$0.00`.
 */
export function formatUsd(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '未定价'
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
  if (amount < 1) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}
