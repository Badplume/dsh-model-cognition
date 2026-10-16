/**
 * The agent tools: how a running agent asks another model something.
 *
 * These are plain `ToolDefinition` objects rather than `defineTool(...)` calls.
 * The desktop profile ships no `@deepseek-ai/*` runtime packages next to a
 * plugin, so importing `dsh-tools` would fail at load; the verified field set a
 * registered tool actually uses is
 * `{ name, description, parameters, output: { schema, render }, timeoutMs,
 *    isConcurrencySafe, execute(args, exec) }`.
 *
 * The approval flow lives here because it needs the tool's own call shape: a
 * call priced above the auto-approve threshold is recorded as a pending
 * approval and reported back instead of being sent, and the retry carries the
 * approval id the user's click produced.
 *
 * @module dsh-model-cognition/host/tools
 */
import { formatUsd } from './cost.js'
import { consult, plan } from './consult.js'
import { catalog } from './providers.js'
import { describeProviderKey } from './secrets.js'

/** The tools this plugin contributes, in the order the Host lists them. */
export const TOOL_NAMES = ['model_list', 'model_ask', 'model_panel', 'model_usage']

/** How long the Host lets one of these tools run before it gives up. */
const TOOL_TIMEOUT_MS = 10 * 60 * 1000

/** A one-line summary of every configured model, for the tool descriptions. */
function configuredSummary(store) {
  const rows = catalog(store)
  if (rows.length === 0) return '（还没有配置任何模型）'
  return rows.join('、')
}

/** A short, model-readable report of the settings a caller cannot change. */
function settingsLine(store) {
  const settings = store.settings
  return [
    `默认模型 ${settings.defaultModel === '' ? '（未设置）' : settings.defaultModel}`,
    `单次上限 ${formatUsd(Number(settings.maxCostPerCallUsd) || 0)}`,
    `每日上限 ${formatUsd(Number(settings.maxCostPerDayUsd) || 0)}`,
    `自动放行 ${formatUsd(Number(settings.autoApproveUnderUsd) || 0)}`,
  ].join('，')
}

/** Wrap a token count as a compact string. */
function tokens(usage) {
  const prompt = Number(usage?.promptTokens) || 0
  const completion = Number(usage?.completionTokens) || 0
  return `${prompt}+${completion}`
}

/** The text one successful call renders as. */
function askText(result) {
  const cost = result.costUsd === null || result.costUsd === undefined ? '未定价' : formatUsd(result.costUsd)
  return [
    `[${result.provider}/${result.model}] ${tokens(result.usage)} tokens · ${cost} · ${result.ms} ms`,
    '',
    result.text === '' || result.text === undefined ? '（模型返回了空内容）' : result.text,
  ].join('\n')
}

/**
 * Turn a plan into either a call, a pending approval, or a refusal.
 *
 * @returns `{ status, ... }` — never throws for a budget decision.
 */
async function attempt(ctx, store, planned, options) {
  const { verdict } = planned
  if (verdict.blocked) {
    return { status: 'blocked', provider: planned.provider.id, model: planned.modelId, reason: verdict.reason }
  }
  if (verdict.needsApproval) {
    const approvalId = options.approvalId
    if (typeof approvalId === 'string' && store.approvalUsable(approvalId, planned.digest)) {
      store.consumeApproval(approvalId)
    } else {
      const record = store.addApproval({
        id: `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        provider: planned.provider.id,
        model: planned.modelId,
        purpose: options.purpose ?? '',
        promptTokens: planned.estimate.promptTokens,
        maxTokens: planned.estimate.maxTokens,
        usd: planned.estimate.usd,
        digest: planned.digest,
        preview: planned.promptText.slice(0, 280),
      })
      return {
        status: 'pending_approval',
        approvalId: record.id,
        provider: planned.provider.id,
        model: planned.modelId,
        estimateUsd: record.usd,
        reason: verdict.reason,
        hint: `已提交待批准（id ${record.id}）。请用户在 设置 → Model Cognition → 用量与预算 中批准或拒绝，`
          + `然后用同一个 model 与 prompt 调用 model_ask 并带上 approvalId=${record.id} 重试。`,
      }
    }
  }
  const result = await consult(ctx, store, planned, options)
  if (result.text === '' && result.reasoning !== '') {
    // A reasoning model that spent its whole budget thinking produced no answer;
    // saying so is more useful than returning an empty string as a success.
    return {
      status: 'ok',
      text: result.text,
      warning: '模型只返回了推理内容，没有最终回答；可以调高 maxTokens 后重试。',
      provider: result.provider,
      model: result.modelId,
      usage: result.usage,
      costUsd: result.costUsd,
      estimated: result.estimated,
      ms: result.ms,
      reasoning: result.reasoning,
    }
  }
  return {
    status: 'ok',
    text: result.text,
    provider: result.provider,
    model: result.modelId,
    usage: result.usage,
    costUsd: result.costUsd,
    estimated: result.estimated,
    ms: result.ms,
    reasoning: result.reasoning,
  }
}

/** Run `worker` over `items` with at most `limit` in flight, keeping order. */
async function pooled(items, limit, worker) {
  const size = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length))
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/** The common `model`/`prompt`/`system` parameter block. */
function askParameters({ modelRequired }) {
  return {
    model: {
      type: 'string',
      required: modelRequired,
      description: '模型引用，格式 providerId/modelId（例如 deepseek/deepseek-chat）。'
        + '省略时使用设置里的默认模型；若只写模型 id 且只有一个供应商提供它，也会自动匹配。',
    },
    prompt: { type: 'string', required: true, description: '要问这个模型的问题或指令。' },
    system: { type: 'string', description: '可选的 system 提示，用来固定该模型的角色或输出格式。' },
    temperature: { type: 'number', description: '可选的采样温度，覆盖设置里的默认值。' },
    maxTokens: { type: 'number', description: '可选的回复长度上限，覆盖设置里的默认值。' },
    purpose: { type: 'string', description: '可选的一句话用途说明，会记录进用量账本，便于复盘花费。' },
  }
}

/**
 * Build every tool this plugin registers.
 *
 * @param ctx - host plugin context.
 * @param store - the plugin store.
 * @returns an array of plain tool definitions.
 */
export function buildTools(ctx, store) {
  const modelList = {
    name: 'model_list',
    description: '列出本机 Model Cognition 已配置的供应商、模型与预算设置。'
      + '在调用其他模型之前先用它确认可用的模型 id，以及单次/每日花费上限。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          models: { type: 'array', items: { type: 'string' }, description: '可用的 providerId/modelId 列表。' },
          providers: { type: 'array', items: { type: 'object' }, description: '供应商摘要。' },
          defaultModel: { type: 'string' },
          budget: { type: 'object' },
        },
      },
      render: (_args, value) => {
        const models = Array.isArray(value?.models) ? value.models : []
        return [{
          type: 'text',
          text: models.length === 0
            ? '还没有配置任何模型。请在 设置 → Model Cognition → 供应商 里添加。'
            : `可用模型（${models.length}）：\n${models.map((id) => `- ${id}`).join('\n')}\n\n默认模型：${value?.defaultModel || '（未设置）'}`,
        }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: true,
    async execute() {
      const providers = []
      for (const provider of store.providers) {
        const key = await describeProviderKey(ctx, provider)
        providers.push({
          id: provider.id,
          label: provider.label,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled !== false,
          keyless: provider.keyless === true,
          keyConfigured: key.configured,
          models: provider.models.map((model) => model.id),
          priced: provider.models.some((model) => model.inputPer1M !== null || model.outputPer1M !== null),
        })
      }
      const settings = store.settings
      return {
        models: catalog(store),
        providers,
        defaultModel: settings.defaultModel,
        budget: {
          maxCostPerCallUsd: settings.maxCostPerCallUsd,
          maxCostPerDayUsd: settings.maxCostPerDayUsd,
          autoApproveUnderUsd: settings.autoApproveUnderUsd,
          costTodayUsd: store.costToday(),
        },
      }
    },
  }

  const modelAsk = {
    name: 'model_ask',
    description: '把一个单独的问题发给另一个模型，返回它的答复。'
      + `当前可用：${configuredSummary(store)}。`
      + `当前预算：${settingsLine(store)}。`
      + '超过自动放行阈值的调用不会立刻发出，而是返回 pending_approval 与 approvalId，'
      + '需要用户在设置面板批准后用同样的 model 与 prompt 带上 approvalId 重试。',
    parameters: {
      ...askParameters({ modelRequired: false }),
      approvalId: {
        type: 'string',
        description: '上一次返回 pending_approval 时的 approvalId；用户批准后带上它重试同一次调用。',
      },
    },
    output: {
      // The output schema is advisory, so it deliberately omits
      // `additionalProperties: false`: the value carries provider diagnostics
      // (reason, hint, warning) that would otherwise be stripped from the
      // result the requesting agent gets to read.
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'pending_approval', 'blocked'] },
          text: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reason: { type: 'string' },
          hint: { type: 'string' },
          warning: { type: 'string' },
          approvalId: { type: 'string' },
          estimateUsd: { type: 'number' },
          costUsd: { type: 'number' },
          estimated: { type: 'boolean' },
          ms: { type: 'number' },
          usage: { type: 'object' },
          reasoning: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.status === 'pending_approval') {
          return [{ type: 'text', text: `⏸ 需要用户批准：${value.reason ?? ''}\n${value.hint ?? ''}` }]
        }
        if (value.status === 'blocked') {
          return [{ type: 'text', text: `⛔ 已按预算上限拒绝：${value.reason ?? ''}` }]
        }
        return [{ type: 'text', text: askText(value) }]
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: true,
    async execute(args, exec) {
      const planned = plan(store, {
        ref: args.model,
        prompt: args.prompt,
        system: args.system,
        maxTokens: args.maxTokens,
      })
      return attempt(ctx, store, planned, {
        temperature: args.temperature,
        purpose: args.purpose ?? 'model_ask',
        approvalId: args.approvalId,
        signal: exec?.signal,
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Consult ${args.model ?? 'default model'}`,
      kind: 'other',
      rawInput: { model: args.model, prompt: args.prompt },
    }),
  }

  const modelPanel = {
    name: 'model_panel',
    description: '把同一个问题并行发给多个模型，分别返回它们的答复，便于比较不同模型的看法。'
      + `当前可用：${configuredSummary(store)}。`
      + '并发数跟随后台设置；任何一个模型失败都不影响其它模型的结果。',
    parameters: {
      models: {
        type: 'array',
        required: true,
        description: '要咨询的模型列表，每项为 providerId/modelId。',
        items: { type: 'string' },
      },
      prompt: { type: 'string', required: true, description: '同时发给所有模型的问题或指令。' },
      system: { type: 'string', description: '可选的 system 提示，对所有模型生效。' },
      temperature: { type: 'number', description: '可选的采样温度，对所有模型生效。' },
      maxTokens: { type: 'number', description: '可选的回复长度上限，对所有模型生效。' },
      purpose: { type: 'string', description: '可选的一句话用途说明，会记录进用量账本。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: { type: 'array', items: { type: 'object' } },
          totalCostUsd: { type: 'number' },
          priced: { type: 'boolean' },
          skipped: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, value) => {
        const rows = Array.isArray(value?.results) ? value.results : []
        return [{
          type: 'text',
          text: rows.map((row) => [
            `===== ${row.model} · ${row.status}${row.costUsd === null || row.costUsd === undefined ? '' : ` · ${formatUsd(row.costUsd)}`}${row.ms === undefined ? '' : ` · ${row.ms} ms`} =====`,
            row.status === 'ok' ? row.text : row.reason ?? '',
          ].join('\n')).join('\n\n'),
        }]
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: true,
    async execute(args, exec) {
      const requested = Array.isArray(args.models) ? args.models.filter((id) => typeof id === 'string' && id.trim() !== '') : []
      if (requested.length === 0) throw new Error('models 不能为空')
      // Plan every call first so one unusable reference does not abort the rest
      // after several other models have already been paid for.
      const planned = []
      const skipped = []
      for (const ref of requested) {
        try {
          planned.push({ ref, plan: plan(store, { ref, prompt: args.prompt, system: args.system, maxTokens: args.maxTokens }) })
        } catch (error) {
          skipped.push({ model: ref, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      const results = await pooled(planned, Number(store.settings.concurrency), async (entry) => {
        try {
          const result = await attempt(ctx, store, entry.plan, {
            temperature: args.temperature,
            purpose: args.purpose ?? 'model_panel',
            signal: exec?.signal,
          })
          return { model: `${result.provider}/${result.model}`, status: result.status, ...result }
        } catch (error) {
          return {
            model: `${entry.plan.provider.id}/${entry.plan.modelId}`,
            status: 'error',
            reason: error instanceof Error ? error.message : String(error),
          }
        }
      })
      const priced = results.every((row) => row.costUsd !== null && row.costUsd !== undefined)
      const totalCostUsd = results.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
      return { results, totalCostUsd, priced, skipped }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Consult ${Array.isArray(args.models) ? args.models.length : 0} models`,
      kind: 'other',
      rawInput: { models: args.models, prompt: args.prompt },
    }),
  }

  const modelUsage = {
    name: 'model_usage',
    description: '查看本插件的用量与花费账本：每次调用的模型、token、耗时、成本，以及今日合计。'
      + '想知道自己刚才花了多少、或预算还剩多少时用它。',
    parameters: {
      limit: { type: 'number', description: '返回最近多少条记录，默认 20，最大 200。' },
      onlyFailures: { type: 'boolean', description: '只看失败的调用。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          records: { type: 'array', items: { type: 'object' } },
          totals: { type: 'object' },
          todayUsd: { type: 'number' },
          pendingApprovals: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, value) => {
        const totals = value?.totals ?? { calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
        const pending = Array.isArray(value?.pendingApprovals) ? value.pendingApprovals : []
        const records = Array.isArray(value?.records) ? value.records : []
        const lines = [
          `累计 ${totals.calls} 次调用（失败 ${totals.failed}），`
          + `tokens ${totals.promptTokens}+${totals.completionTokens}，`
          + `合计 ${formatUsd(totals.costUsd)}，今日 ${formatUsd(value?.todayUsd ?? 0)}`,
        ]
        if (pending.length > 0) {
          lines.push('', `待批准 ${pending.length} 条：`)
          for (const row of pending) {
            lines.push(`- ${row.id} · ${row.provider}/${row.model} · 预估 ${formatUsd(row.usd)}`)
          }
        }
        lines.push('', '最近记录：')
        for (const record of records) {
          lines.push(`- ${record.at} · ${record.provider}/${record.model} · ${record.ok ? 'ok' : 'failed'}`
            + ` · ${record.promptTokens}+${record.completionTokens} · ${formatUsd(record.costUsd)} · ${record.ms}ms`
            + (record.purpose === '' ? '' : ` · ${record.purpose}`)
            + (record.error === undefined ? '' : ` · ${record.error}`))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: true,
    async execute(args) {
      const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit)) || 20, 200))
      const records = store.doc.usage.records.filter((record) => args.onlyFailures !== true || !record.ok)
      return {
        records: records.slice(-limit).reverse(),
        totals: store.doc.usage.totals,
        todayUsd: store.costToday(),
        pendingApprovals: store.pendingApprovals().map((row) => ({
          id: row.id,
          provider: row.provider,
          model: row.model,
          usd: row.usd,
          createdAt: row.createdAt,
        })),
      }
    },
  }

  return [modelList, modelAsk, modelPanel, modelUsage]
}

export { settingsLine }
