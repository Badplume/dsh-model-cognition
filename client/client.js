/**
 * dsh-model-cognition — browser half (plain JS, no build step).
 *
 * Registered as a `window.__ModuleLoader__` module, like every other profile
 * bundle's client half. It contributes one `settings.section` page with three
 * tabs: providers, general settings, and usage/budget.
 *
 * Three decisions worth knowing before editing this file:
 *
 * 1. **No Harness client package is required.** The product's plugin guidance
 *    forbids `require('@deepseek-ai/dsh-client-ui-primitives')` and friends, so
 *    the controls below copy the primitives' markup and CSS (same class
 *    recipes, same `--dsw-alias-*` tokens) under an `mc-` prefix instead. That
 *    also means this file needs no build step.
 * 2. **The stylesheet is added, never assumed.** CSS Modules are unavailable
 *    without a bundler, so one `<style>` element is owned by `ctx.effect` and
 *    removed with the plugin. Nothing else touches the document: no app root
 *    replacement, no second application, no reads of another plugin's markup.
 * 3. **The host is the authority.** Every write posts to the plugin's own route
 *    and then re-reads `/state`, so the UI cannot drift from what the tools
 *    will actually do.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-cognition',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-model-cognition'
    const SECTION_ID = 'model-cognition'

    // ── transport ──────────────────────────────────────────────────────────

    /**
     * The route prefix, resolved against the document rather than the origin.
     *
     * A root-absolute path breaks a sub-path deployment; a purely relative one
     * breaks when the app is served from a path without a trailing slash. The
     * page URL tells us which directory we are in, so build the prefix from it.
     */
    const PREFIX = (() => {
      const path = window.location.pathname
      if (path === '' || path === '/') return '/model-cognition'
      const directory = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1)
      return `${directory}model-cognition`
    })()

    /** One request against the plugin's host routes. */
    async function api(path, { method = 'GET', body } = {}) {
      const init = { method, cache: 'no-store' }
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      let response
      try {
        response = await fetch(`${PREFIX}${path}`, init)
      } catch (error) {
        throw new Error(`无法连接 DSH 主机：${error && error.message ? error.message : String(error)}`)
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
      }
      return payload
    }

    // ── copy ───────────────────────────────────────────────────────────────

    const MESSAGES = {
      zh: {
        nav: 'Model Cognition',
        title: 'Model Cognition',
        subtitle: '在对话里调用其他模型：自带密钥、可比较、花费可见可批准。',
        'tab.providers': '供应商',
        'tab.general': '常规',
        'tab.budget': '用量与预算',

        'common.save': '保存',
        'common.saving': '保存中…',
        'common.cancel': '取消',
        'common.edit': '编辑',
        'common.delete': '删除',
        'common.close': '关闭',
        'common.test': '测试连接',
        'common.testing': '测试中…',
        'common.add': '添加',
        'common.remove': '移除',
        'common.retry': '重试',
        'common.none': '无',
        'common.optional': '可选',
        'common.required': '必填',

        'state.loading': '正在读取配置…',
        'state.unreachable': '读不到插件状态',
        'state.unreachableHint':
          '设置面板通过本机回环接口与 DSH 主机通信。如果你是从另一台机器打开的界面，写操作会被拒绝——这是有意的安全边界。',

        'providers.empty': '还没有配置任何供应商',
        'providers.emptyHint': '添加一个供应商，填入你自己的 API Key，就能在对话里调用它的模型。',
        'providers.add': '新增供应商',
        'providers.count': '共 {n} 个供应商',
        'providers.models': '{n} 个模型',
        'providers.noModels': '未配置模型',
        'providers.keyOk': '密钥已配置',
        'providers.keyMissing': '缺少密钥',
        'providers.keyless': '无需密钥',
        'providers.keyEnv': '来自环境变量',
        'providers.disabled': '已停用',
        'providers.enabled': '已启用',
        'providers.priced': '已定价',
        'providers.unpriced': '未定价',

        'editor.new': '新增供应商',
        'editor.edit': '编辑 {label}',
        'editor.preset': '预设',
        'editor.presetHint': '选一个预设会填好地址与协议，之后仍可修改。',
        'editor.label': '显示名称',
        'editor.id': '标识（id）',
        'editor.idHint': '小写字母开头，只能含小写字母、数字、连字符。用于模型引用 “id/模型”。',
        'editor.protocol': '协议',
        'editor.protocolOpenai': 'OpenAI 兼容（/chat/completions）',
        'editor.protocolAnthropic': 'Anthropic（/v1/messages）',
        'editor.baseUrl': 'Base URL',
        'editor.baseUrlHint': '要写到版本段为止，插件只往后追加操作路径。例如 https://api.deepseek.com/v1',
        'editor.key': 'API Key',
        'editor.keyKeep': '留空表示保留原有密钥',
        'editor.keyStored': '已存入凭据存储',
        'editor.keyInlineHint': '本机没有凭据服务，密钥会存在插件自己的数据文件里（权限 0600）。',
        'editor.keyClear': '清除密钥',
        'editor.keyClearDone': '密钥已清除',
        'editor.keyless': '无需密钥',
        'editor.keylessHint': '本地模型或内网服务用这个。',
        'editor.models': '模型',
        'editor.modelsHint': '模型 id 必须和供应商文档完全一致。价格是每百万 token 的美元单价，留空表示未定价。',
        'editor.modelId': '模型 id',
        'editor.priceIn': '输入 $/M',
        'editor.priceOut': '输出 $/M',
        'editor.addModel': '添加一行',
        'editor.discovered': '从供应商拉取',
        'editor.discoveredAddAll': '全部添加',
        'editor.discoveredAdd': '添加',
        'editor.discoveredAdded': '已添加',
        'editor.advanced': '高级',
        'editor.extraHeaders': '额外请求头',
        'editor.extraHeadersHint': 'JSON 对象，例如 {"X-Title":"DeepSeek Harness"}。留空表示不发送。',
        'editor.extraHeadersBad': '不是合法的 JSON 对象',
        'editor.maxTokensParam': '最大 token 参数名',
        'editor.maxTokensParamHint': '有些推理模型只接受 max_completion_tokens。默认为 max_tokens。',
        'editor.maxTokensParamNone': '不发送',
        'editor.notes': '备注',
        'editor.saved': '已保存',
        'editor.testFirst': '连接成功，可以先添加下面的模型',
        'editor.testFailed': '连接失败',
        'editor.deleteConfirm': '删除这个供应商？密钥也会一并清除。',
        'editor.deleteYes': '确认删除',

        'general.defaultModel': '默认模型',
        'general.defaultModelHint': '调用工具时不写模型就用它。',
        'general.defaultModelNone': '（未设置）',
        'general.temperature': '采样温度',
        'general.temperatureHint': '越高越发散。事实类任务建议 0.2–0.5。',
        'general.maxTokens': '输出上限',
        'general.maxTokensHint': '同时是成本估算的上界。',
        'general.timeout': '请求超时（秒）',
        'general.timeoutHint': '本地大模型可以调大。',
        'general.concurrency': '并行数',
        'general.concurrencyHint': 'model_panel 同时问几个模型。',
        'general.framing': '在提示中加入用法说明',
        'general.framingHint': '给外部模型加一句“你正在被另一个 AI 咨询”，让它直接作答。',
        'general.saved': '设置已保存',

        'budget.pending': '待批准的调用',
        'budget.pendingEmpty': '没有等待批准的调用。',
        'budget.pendingHint': '这些调用超过自动放行阈值，需要你点一下才会发出。批准只对这一次请求有效。',
        'budget.approve': '批准',
        'budget.deny': '拒绝',
        'budget.estimate': '预估 {usd}',
        'budget.caps': '预算闸门',
        'budget.capsHint': '单位是美元。单次与每日上限是硬线——超过会直接拒绝，不能批准。',
        'budget.perCall': '单次上限',
        'budget.perCallHint': '任何一次调用预估超过它就拒绝。',
        'budget.perDay': '每日上限',
        'budget.perDayHint': '今日累计加上本次预估超过它就拒绝。',
        'budget.auto': '自动放行阈值',
        'budget.autoHint': '不超过它直接执行；超过则生成待批准项。设为 0 表示每笔都要批准。',
        'budget.unpriced': '{n} 个模型未定价，它们不会被闸门拦住。',
        'budget.usage': '用量账本',
        'budget.today': '今日',
        'budget.total': '累计',
        'budget.calls': '调用次数',
        'budget.failed': '失败',
        'budget.tokens': 'tokens',
        'budget.reset': '重置账本',
        'budget.resetConfirm': '清空所有用量记录？配置和密钥不受影响。',
        'budget.resetYes': '确认清空',
        'budget.noRecords': '还没有调用记录。',
        'budget.estimatedNote': '标记 ≈ 的记录是供应商没有返回用量时的字符估算值。',
      },
      en: {
        nav: 'Model Cognition',
        title: 'Model Cognition',
        subtitle: 'Consult other models from a conversation: your own keys, comparable results, visible and approvable spending.',
        'tab.providers': 'Providers',
        'tab.general': 'General',
        'tab.budget': 'Usage & budget',

        'common.save': 'Save',
        'common.saving': 'Saving…',
        'common.cancel': 'Cancel',
        'common.edit': 'Edit',
        'common.delete': 'Delete',
        'common.close': 'Close',
        'common.test': 'Test connection',
        'common.testing': 'Testing…',
        'common.add': 'Add',
        'common.remove': 'Remove',
        'common.retry': 'Retry',
        'common.none': 'None',
        'common.optional': 'optional',
        'common.required': 'required',

        'state.loading': 'Reading configuration…',
        'state.unreachable': 'Cannot read plugin state',
        'state.unreachableHint':
          'This panel talks to the DSH host over a loopback route. If you opened the interface from another machine, writes are refused - that boundary is deliberate.',

        'providers.empty': 'No providers configured yet',
        'providers.emptyHint': 'Add a provider, paste your own API key, and its models become available in the conversation.',
        'providers.add': 'Add provider',
        'providers.count': '{n} provider(s)',
        'providers.models': '{n} models',
        'providers.noModels': 'no models',
        'providers.keyOk': 'key configured',
        'providers.keyMissing': 'no key',
        'providers.keyless': 'no key needed',
        'providers.keyEnv': 'from environment',
        'providers.disabled': 'disabled',
        'providers.enabled': 'enabled',
        'providers.priced': 'priced',
        'providers.unpriced': 'unpriced',

        'editor.new': 'Add provider',
        'editor.edit': 'Edit {label}',
        'editor.preset': 'Preset',
        'editor.presetHint': 'A preset fills in the address and protocol; you can still change both.',
        'editor.label': 'Display name',
        'editor.id': 'Identifier (id)',
        'editor.idHint': 'Lowercase, may contain digits and dashes. Used in model references as "id/model".',
        'editor.protocol': 'Protocol',
        'editor.protocolOpenai': 'OpenAI-compatible (/chat/completions)',
        'editor.protocolAnthropic': 'Anthropic (/v1/messages)',
        'editor.baseUrl': 'Base URL',
        'editor.baseUrlHint': 'Include the version segment; only the operation is appended. For example https://api.deepseek.com/v1',
        'editor.key': 'API key',
        'editor.keyKeep': 'leave empty to keep the stored key',
        'editor.keyStored': 'stored in the credential store',
        'editor.keyInlineHint': 'This host has no credential service, so the key is kept in the plugin data file (mode 0600).',
        'editor.keyClear': 'Clear key',
        'editor.keyClearDone': 'Key cleared',
        'editor.keyless': 'No key needed',
        'editor.keylessHint': 'For a local model or an intranet service.',
        'editor.models': 'Models',
        'editor.modelsHint': 'The id must match the vendor exactly. Prices are USD per million tokens; leave empty for unpriced.',
        'editor.modelId': 'model id',
        'editor.priceIn': 'input $/M',
        'editor.priceOut': 'output $/M',
        'editor.addModel': 'Add a row',
        'editor.discovered': 'Fetch from vendor',
        'editor.discoveredAddAll': 'Add all',
        'editor.discoveredAdd': 'Add',
        'editor.discoveredAdded': 'Added',
        'editor.advanced': 'Advanced',
        'editor.extraHeaders': 'Extra headers',
        'editor.extraHeadersHint': 'A JSON object, e.g. {"X-Title":"DeepSeek Harness"}. Empty means none.',
        'editor.extraHeadersBad': 'not a JSON object',
        'editor.maxTokensParam': 'Max-token parameter',
        'editor.maxTokensParamHint': 'Some reasoning models only accept max_completion_tokens. Default is max_tokens.',
        'editor.maxTokensParamNone': 'do not send',
        'editor.notes': 'Notes',
        'editor.saved': 'Saved',
        'editor.testFirst': 'Connected - add models from the list below',
        'editor.testFailed': 'Connection failed',
        'editor.deleteConfirm': 'Delete this provider? Its stored key is removed too.',
        'editor.deleteYes': 'Delete',

        'general.defaultModel': 'Default model',
        'general.defaultModelHint': 'Used by the tools when no model is named.',
        'general.defaultModelNone': '(not set)',
        'general.temperature': 'Temperature',
        'general.temperatureHint': 'Higher is more varied. Factual work likes 0.2-0.5.',
        'general.maxTokens': 'Max output tokens',
        'general.maxTokensHint': 'Also the upper bound of a cost estimate.',
        'general.timeout': 'Timeout (seconds)',
        'general.timeoutHint': 'A local large model may need more.',
        'general.concurrency': 'Concurrency',
        'general.concurrencyHint': 'How many models model_panel asks at once.',
        'general.framing': 'Add usage framing to the prompt',
        'general.framingHint': 'Tells the other model it is being consulted by an AI and to answer directly.',
        'general.saved': 'Settings saved',

        'budget.pending': 'Calls awaiting approval',
        'budget.pendingEmpty': 'Nothing is waiting for approval.',
        'budget.pendingHint': 'These exceed the auto-approve threshold. A grant covers one request only.',
        'budget.approve': 'Approve',
        'budget.deny': 'Deny',
        'budget.estimate': 'estimated {usd}',
        'budget.caps': 'Budget gates',
        'budget.capsHint': 'All values are USD. The per-call and daily caps are hard: exceeding one refuses the call outright.',
        'budget.perCall': 'Per-call cap',
        'budget.perCallHint': 'A call estimated above this is refused.',
        'budget.perDay': 'Daily cap',
        'budget.perDayHint': "Today's total plus this estimate above it is refused.",
        'budget.auto': 'Auto-approve under',
        'budget.autoHint': 'At or below this a call runs; above it the call waits for you. 0 approves nothing.',
        'budget.unpriced': '{n} model(s) are unpriced, so no gate can stop them.',
        'budget.usage': 'Usage ledger',
        'budget.today': 'Today',
        'budget.total': 'Total',
        'budget.calls': 'Calls',
        'budget.failed': 'failed',
        'budget.tokens': 'tokens',
        'budget.reset': 'Reset ledger',
        'budget.resetConfirm': 'Clear every usage record? Configuration and keys are untouched.',
        'budget.resetYes': 'Clear',
        'budget.noRecords': 'No calls recorded yet.',
        'budget.estimatedNote': 'Rows marked ≈ were estimated from characters because the vendor sent no usage report.',
      },
    }

    // ── styles ─────────────────────────────────────────────────────────────

    /**
     * The control recipes are copied from `dsh-client-ui-primitives`
     * (`Button.module.css`, `Input.module.css`, `Switch.module.css`) with the
     * class names moved under `mc-`. Every colour is a `--dsw-alias-*` token, so
     * the panel follows the host theme and every skin. A literal colour appears
     * twice only as a last-resort fallback for a token an older host may not
     * define.
     *
     * `!important` on form surfaces is not decoration: skins restyle bare
     * `button`/`input` elements, and this page must keep the host's own look.
     */
    const STYLES = `
.mc-root { display:flex; flex-direction:column; gap:16px; max-width:760px; font-size:13px; line-height:1.6;
  color: var(--dsw-alias-label-primary, #eee); }
.mc-head { display:flex; flex-direction:column; gap:2px; }
.mc-title { font-size:15px; font-weight:600; }
.mc-sub { font-size:12px; color: var(--dsw-alias-label-tertiary, #888); }

.mc-tabs { display:inline-flex; gap:2px; padding:2px; align-self:flex-start;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14)); border-radius: var(--dsw-radius-md, 8px); }
.mc-tab { appearance:none; border:0 !important; cursor:pointer; font:inherit; font-size:12.5px;
  padding:4px 12px; border-radius: var(--dsw-radius-sm, 6px);
  background:transparent !important; color: var(--dsw-alias-label-secondary, #999) !important; }
.mc-tab:hover { color: var(--dsw-alias-label-primary, #eee) !important; }
.mc-tab[aria-selected='true'] { background: var(--dsw-alias-bg-layer-1, #1c1c1f) !important;
  color: var(--dsw-alias-label-primary, #eee) !important; box-shadow: var(--dsw-shadow-lv3, 0 1px 2px rgba(0,0,0,.18)); }

.mc-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:4px;
  height:28px; padding:0 10px; border:0; border-radius: var(--dsw-radius-sm, 6px); cursor:pointer;
  font:inherit; font-size:12px; line-height:18px; white-space:nowrap;
  background:transparent !important; color: var(--dsw-alias-label-primary, #eee) !important; }
.mc-btn:disabled { cursor:not-allowed; opacity:.4; }
.mc-btn-primary { background: var(--dsw-alias-button-primary-fill, #4d6bfe) !important;
  color: var(--dsw-alias-label-primary-foreground, #fff) !important; }
.mc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #3f5ce0) !important; }
.mc-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.15)) !important; }
.mc-btn-ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.22)) !important; }
.mc-btn-danger { color: var(--dsw-alias-state-error-primary, #f85149) !important; }
.mc-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(248,81,73,.14)) !important; }
.mc-btn-md { height:32px; padding:0 14px; font-size:14px; border-radius: var(--dsw-radius-md, 8px); }

.mc-input { box-sizing:border-box; width:100%; height:30px; padding:0 8px; font:inherit; font-size:13px;
  border:0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.35)) !important;
  border-radius: var(--dsw-radius-md, 8px); outline:none;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.08)) !important;
  color: var(--dsw-alias-label-primary, #eee) !important; }
.mc-input:focus { border-color: var(--dsw-alias-state-business-primary, #4d6bfe) !important; }
.mc-input::placeholder { color: var(--dsw-alias-label-dimmed, #777); }
.mc-input:disabled { opacity:.55; }
.mc-input-mono { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size:12px; }
.mc-textarea { height:auto; min-height:56px; padding:6px 8px; resize:vertical; }
.mc-input-sm { height:26px; font-size:12px; }

.mc-switch { box-sizing:border-box; position:relative; flex:0 0 auto; width:36px; height:20px; padding:2px;
  border:0 !important; border-radius:999px; corner-shape:round; cursor:pointer;
  background: var(--dsw-alias-border-l3, rgba(127,127,127,.4)) !important; }
.mc-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary, #4d6bfe) !important; }
.mc-switch:disabled { cursor:default; opacity:.5; }
.mc-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe)); outline-offset:2px; }
.mc-thumb { display:block; width:16px; height:16px; border-radius:50%; corner-shape:round;
  background: var(--dsw-alias-label-primary-foreground, #fff); transition: transform 120ms ease; }
.mc-switch[aria-checked='false'] .mc-thumb { background: var(--dsw-alias-switch-thumb, #ccc); }
.mc-switch[aria-checked='true'] .mc-thumb { transform: translateX(16px); }

.mc-card { border:0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3));
  border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-alias-bg-layer-1, transparent); }
.mc-card + .mc-card { margin-top:8px; }
.mc-row { display:flex; align-items:center; gap:8px; padding:10px 12px; }
.mc-row-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.mc-row-name { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500; }
.mc-row-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
  font-size:11.5px; color: var(--dsw-alias-label-tertiary, #888); }
.mc-body { padding:12px; display:flex; flex-direction:column; gap:12px;
  border-top:0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3)); }

.mc-dot { width:7px; height:7px; flex:0 0 auto; border-radius:50%; background: var(--dsw-alias-state-idle-primary, #888); }
.mc-dot-ok { background: var(--dsw-alias-state-success-primary, #3fb950); }
.mc-dot-warn { background: var(--dsw-alias-state-warn-primary, #d29922); }
.mc-dot-err { background: var(--dsw-alias-state-error-primary, #f85149); }

.mc-badge { font-size:11px; line-height:16px; padding:0 6px; border-radius:999px; white-space:nowrap;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.16)); color: var(--dsw-alias-label-secondary, #999); }
.mc-badge-warn { color: var(--dsw-alias-state-warn-label, #d29922); }
.mc-badge-err { color: var(--dsw-alias-state-error-primary, #f85149); }
.mc-mono { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size:11.5px; }

.mc-field { display:grid; grid-template-columns: 130px 1fr; gap:6px 12px; align-items:start; }
.mc-field > .mc-label { padding-top:5px; }
.mc-label { font-size:12px; color: var(--dsw-alias-label-secondary, #999); }
.mc-stack { display:flex; flex-direction:column; gap:5px; min-width:0; }
.mc-hint { font-size:11.5px; line-height:1.5; color: var(--dsw-alias-label-dimmed, #777); }
.mc-inline { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.mc-grid-models { display:grid; grid-template-columns: 1fr 92px 92px 26px; gap:6px; align-items:center; }
.mc-grid-models .mc-head { font-size:11px; color: var(--dsw-alias-label-dimmed, #777); }

.mc-banner { display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-radius: var(--dsw-radius-md, 8px);
  font-size:12px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  border:0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3)); }
.mc-banner-err { border-color: var(--dsw-alias-state-error-primary, #f85149); color: var(--dsw-alias-state-error-primary, #f85149); }
.mc-banner-warn { border-color: var(--dsw-alias-state-warn-primary, #d29922); }
.mc-banner-ok { border-color: var(--dsw-alias-state-success-primary, #3fb950); }
.mc-banner-body { flex:1; min-width:0; }

.mc-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:28px 12px; text-align:center;
  border:1px dashed var(--dsw-alias-border-l3, rgba(127,127,127,.35)); border-radius: var(--dsw-radius-lg, 10px); }
.mc-empty-title { font-size:13px; }
.mc-empty-hint { font-size:12px; color: var(--dsw-alias-label-tertiary, #888); max-width:44ch; }

.mc-approval { display:flex; gap:10px; align-items:flex-start; padding:10px 12px;
  border:0.5px solid var(--dsw-alias-state-warn-primary, #d29922); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent); }
.mc-approval + .mc-approval { margin-top:6px; }
.mc-approval-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.mc-preview { font-size:11.5px; color: var(--dsw-alias-label-tertiary, #888);
  overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }

.mc-stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:8px; }
.mc-stat { padding:8px 10px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); }
.mc-stat-label { font-size:11px; color: var(--dsw-alias-label-tertiary, #888); }
.mc-stat-value { font-size:14px; font-weight:600; }

.mc-table { width:100%; border-collapse:collapse; font-size:11.5px; }
.mc-table th { text-align:left; font-weight:500; color: var(--dsw-alias-label-dimmed, #777);
  padding:4px 6px; border-bottom:0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3)); }
.mc-table td { padding:4px 6px; border-bottom:0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.16));
  color: var(--dsw-alias-label-secondary, #999); }
.mc-table tr:last-child td { border-bottom:0; }
.mc-scroll { max-height:260px; overflow:auto; }

.mc-sep { height:1px; background: var(--dsw-alias-border-l3, rgba(127,127,127,.3)); }
.mc-section-title { font-size:12.5px; font-weight:600; }
`

    // ── primitives ─────────────────────────────────────────────────────────

    function cx(...parts) {
      return parts.filter(Boolean).join(' ')
    }

    function Button({ kind = 'ghost', size = 'sm', children, ...rest }) {
      return h('button', {
        type: 'button',
        className: cx('mc-btn', `mc-btn-${kind}`, size === 'md' ? 'mc-btn-md' : undefined),
        ...rest,
      }, children)
    }

    function Switch({ checked, onChange, disabled, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled,
        className: 'mc-switch',
        onClick: () => onChange(!checked),
      }, h('span', { className: 'mc-thumb' }))
    }

    function TextInput({ value, onChange, mono, small, ...rest }) {
      return h('input', {
        className: cx('mc-input', mono && 'mc-input-mono', small && 'mc-input-sm'),
        value: value ?? '',
        onChange: (event) => onChange(event.target.value),
        ...rest,
      })
    }

    function Select({ value, onChange, options, ...rest }) {
      return h('select', {
        className: 'mc-input',
        value,
        onChange: (event) => onChange(event.target.value),
        ...rest,
      }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
    }

    /** One labelled control, laid out in the shared two-column field grid. */
    function Field({ label, hint, children, action }) {
      return h('div', { className: 'mc-field' },
        h('div', { className: 'mc-label' }, label),
        h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-inline' }, children, action),
          hint ? h('div', { className: 'mc-hint' }, hint) : null))
    }

    function Badge({ children, tone }) {
      return h('span', { className: cx('mc-badge', tone === 'warn' && 'mc-badge-warn', tone === 'err' && 'mc-badge-err') }, children)
    }

    function Dot({ tone }) {
      return h('span', { className: cx('mc-dot', tone && `mc-dot-${tone}`) })
    }

    function Banner({ tone, children, action }) {
      return h('div', { className: cx('mc-banner', tone && `mc-banner-${tone}`) },
        h('div', { className: 'mc-banner-body' }, children),
        action ?? null)
    }

    function Stats({ items }) {
      return h('div', { className: 'mc-stats' }, items.map((item) => h('div', { key: item.label, className: 'mc-stat' },
        h('div', { className: 'mc-stat-label' }, item.label),
        h('div', { className: 'mc-stat-value' }, item.value))))
    }

    // ── formatting ─────────────────────────────────────────────────────────

    /** A USD amount, keeping sub-cent precision where it carries meaning. */
    function usd(amount) {
      if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
      if (amount === 0) return '$0'
      if (amount < 0.01) return `$${amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
      if (amount < 1) return `$${amount.toFixed(4)}`
      return `$${amount.toFixed(2)}`
    }

    /** A number with thousands separators, or a dash. */
    function num(value) {
      return Number.isFinite(value) ? value.toLocaleString() : '—'
    }

    /** `2026-10-16T09:31:00.000Z` as a compact local time. */
    function clock(iso) {
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return iso ?? ''
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** A price field's text as a number, or null when it means "unpriced". */
    function parsePrice(text) {
      const trimmed = String(text ?? '').trim()
      if (trimmed === '') return null
      const value = Number(trimmed)
      return Number.isFinite(value) && value >= 0 ? value : null
    }

    /** A stored price as editable text. */
    function priceText(value) {
      return value === null || value === undefined ? '' : String(value)
    }

    // ── providers tab ──────────────────────────────────────────────────────

    /** The empty state a fresh install shows. */
    function ProvidersEmpty({ t, onAdd }) {
      return h('div', { className: 'mc-empty' },
        h('div', { className: 'mc-empty-title' }, t('providers.empty')),
        h('div', { className: 'mc-empty-hint' }, t('providers.emptyHint')),
        h(Button, { kind: 'primary', size: 'md', onClick: onAdd }, t('providers.add')))
    }

    /** One provider's card: a summary row, and the editor when it is open. */
    function ProviderCard({ provider, t, expanded, onToggle, onEdit, onDelete, onToggleEnabled, onSaved, busy }) {
      const tone = provider.enabled === false
        ? undefined
        : provider.keyConfigured ? 'ok' : 'warn'
      const priced = provider.models.some((model) => model.inputPer1M !== null || model.outputPer1M !== null)
      return h('div', { className: 'mc-card' },
        h('div', { className: 'mc-row' },
          h(Dot, { tone }),
          h('div', { className: 'mc-row-main' },
            h('div', { className: 'mc-row-name' },
              provider.label || provider.id,
              h(Badge, null, provider.id),
              provider.enabled === false ? h(Badge, { tone: 'warn' }, t('providers.disabled')) : null),
            h('div', { className: 'mc-row-meta' },
              h('span', { className: 'mc-mono' }, provider.baseUrl),
              h('span', null, '·'),
              h('span', null, provider.models.length === 0 ? t('providers.noModels') : t('providers.models', { n: provider.models.length })),
              h('span', null, '·'),
              h('span', null, provider.keyless ? t('providers.keyless')
                : provider.keyConfigured ? t('providers.keyOk') : t('providers.keyMissing')),
              provider.models.length > 0 ? h('span', null, '·') : null,
              provider.models.length > 0 ? h('span', null, priced ? t('providers.priced') : t('providers.unpriced')) : null)),
          h(Switch, {
            checked: provider.enabled !== false,
            disabled: busy,
            label: provider.enabled === false ? t('providers.enabled') : t('providers.disabled'),
            onChange: (next) => onToggleEnabled(provider, next),
          }),
          h(Button, { onClick: () => onToggle(provider.id) }, expanded ? t('common.close') : t('common.edit')),
          h(Button, { kind: 'danger', disabled: busy, onClick: () => onDelete(provider) }, t('common.delete'))),
        expanded ? h(ProviderEditor, { provider, t, onDone: onToggle, onSaved }) : null)
    }

    /** One model row inside the editor. */
    function ModelRow({ model, t, onChange, onRemove }) {
      return h('div', { className: 'mc-grid-models' },
        h(TextInput, {
          mono: true,
          small: true,
          value: model.id,
          placeholder: t('editor.modelId'),
          onChange: (value) => onChange({ ...model, id: value }),
        }),
        h(TextInput, {
          small: true,
          value: model.input,
          placeholder: t('editor.priceIn'),
          inputMode: 'decimal',
          onChange: (value) => onChange({ ...model, input: value }),
        }),
        h(TextInput, {
          small: true,
          value: model.output,
          placeholder: t('editor.priceOut'),
          inputMode: 'decimal',
          onChange: (value) => onChange({ ...model, output: value }),
        }),
        h(Button, { kind: 'danger', onClick: onRemove, title: t('common.remove') }, '×'))
    }

    /**
     * The provider editor.
     *
     * The draft is local: nothing is written until 保存, so a half-typed Base URL
     * never reaches the store. The key field starts empty even for a saved
     * provider — the host never sends key bytes back, so "empty" means "keep"
     * and a separate action clears it.
     */
    function ProviderEditor({ provider, t, onDone, onSaved }) {
      const isNew = provider.__new === true
      const [draft, setDraft] = React.useState(() => ({
        id: provider.id ?? '',
        label: provider.label ?? '',
        protocol: provider.protocol ?? 'openai',
        baseUrl: provider.baseUrl ?? '',
        keyMode: provider.keyMode ?? 'record',
        keyless: provider.keyless === true,
        enabled: provider.enabled !== false,
        notes: provider.notes ?? '',
        maxTokensParam: provider.maxTokensParam ?? 'max_tokens',
        extraHeaders: provider.extraHeaders && Object.keys(provider.extraHeaders).length > 0
          ? JSON.stringify(provider.extraHeaders, null, 2)
          : '',
        models: (provider.models ?? []).map((model) => ({
          id: model.id,
          input: priceText(model.inputPer1M),
          output: priceText(model.outputPer1M),
        })),
      }))
      const [apiKey, setApiKey] = React.useState('')
      const [advanced, setAdvanced] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [discovered, setDiscovered] = React.useState(null)

      const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

      /**
       * Leave the editor after a write. The parent owns the list state, so it
       * has to re-read: collapsing without a reload leaves a saved provider
       * invisible until the whole page is refreshed.
       */
      function close() {
        if (onSaved) onSaved()
        else if (onDone) onDone()
      }

      const keyState = provider.keyless
        ? t('providers.keyless')
        : provider.keyConfigured
          ? (provider.keySource === 'store' ? t('editor.keyStored') : t('providers.keyOk'))
          : t('providers.keyMissing')

      /** Read the header textarea, reporting a bad JSON object inline. */
      function headers() {
        const text = draft.extraHeaders.trim()
        if (text === '') return {}
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          throw new Error(t('editor.extraHeadersBad'))
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t('editor.extraHeadersBad'))
        }
        const out = {}
        for (const [name, value] of Object.entries(parsed)) out[name] = String(value)
        return out
      }

      /** The row to send, with prices parsed and blank models dropped. */
      function composed() {
        return {
          id: draft.id.trim(),
          label: draft.label.trim() || draft.id.trim(),
          protocol: draft.protocol,
          baseUrl: draft.baseUrl.trim(),
          keyMode: draft.keyless ? 'none' : draft.keyMode,
          keyless: draft.keyless,
          enabled: draft.enabled,
          notes: draft.notes,
          maxTokensParam: draft.maxTokensParam,
          extraHeaders: headers(),
          models: draft.models
            .filter((model) => model.id.trim() !== '')
            .map((model) => ({
              id: model.id.trim(),
              inputPer1M: parsePrice(model.input),
              outputPer1M: parsePrice(model.output),
            })),
        }
      }

      async function save() {
        setBusy(true)
        setNotice(null)
        try {
          await api('/providers', { method: 'POST', body: { provider: composed(), apiKey } })
          setNotice({ tone: 'ok', text: t('editor.saved') })
          close()
        } catch (error) {
          setNotice({ tone: 'err', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      async function test() {
        setBusy(true)
        setNotice(null)
        setDiscovered(null)
        try {
          const body = composed()
          const result = await api('/test', { method: 'POST', body: { provider: body, apiKey } })
          if (result.ok) {
            setDiscovered(result.models ?? [])
            setNotice({ tone: 'ok', text: t('editor.testFirst') })
          } else {
            setNotice({ tone: 'err', text: `${t('editor.testFailed')}：${result.error ?? ''}` })
          }
        } catch (error) {
          setNotice({ tone: 'err', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      async function clearKey() {
        if (!provider.id) return
        setBusy(true)
        try {
          await api(`/providers/${encodeURIComponent(provider.id)}/key`, { method: 'PUT', body: { apiKey: '' } })
          setApiKey('')
          setNotice({ tone: 'ok', text: t('editor.keyClearDone') })
          close()
        } catch (error) {
          setNotice({ tone: 'err', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      /** Apply a preset's address and protocol without touching the user's models. */
      function applyPreset(id) {
        const preset = (presetList ?? []).find((entry) => entry.id === id)
        if (preset === undefined) return
        patch({
          protocol: preset.protocol ?? draft.protocol,
          baseUrl: preset.baseUrl ?? '',
          keyless: preset.keyless === true,
          label: draft.label === '' || presetList.some((entry) => entry.label === draft.label) ? preset.label : draft.label,
          id: isNew && (draft.id === '' || presetList.some((entry) => entry.id === draft.id)) ? preset.id : draft.id,
        })
      }

      const presetList = provider.__presets ?? []
      const alreadyAdded = new Set(draft.models.map((model) => model.id.trim()))
      const canKey = !draft.keyless

      return h('div', { className: 'mc-body' },
        notice ? h(Banner, { tone: notice.tone }, notice.text) : null,

        h(Field, { label: t('editor.preset'), hint: t('editor.presetHint') },
          h('div', { style: { minWidth: 240, flex: '1 1 240px' } },
            h(Select, {
              value: '',
              onChange: applyPreset,
              options: [{ value: '', label: '—' }].concat(presetList.map((entry) => ({ value: entry.id, label: entry.label }))),
            }))),

        h(Field, { label: t('editor.label') },
          h('div', { style: { minWidth: 200, flex: '1 1 200px' } },
            h(TextInput, { value: draft.label, onChange: (value) => patch({ label: value }) }))),

        h(Field, { label: t('editor.id'), hint: t('editor.idHint') },
          h('div', { style: { minWidth: 200, flex: '1 1 200px' } },
            h(TextInput, {
              mono: true,
              value: draft.id,
              disabled: !isNew && provider.id !== '',
              onChange: (value) => patch({ id: value.toLowerCase().replace(/[^a-z0-9-]/g, '') }),
            }))),

        h(Field, { label: t('editor.protocol') },
          h('div', { style: { minWidth: 240, flex: '1 1 240px' } },
            h(Select, {
              value: draft.protocol,
              onChange: (value) => patch({ protocol: value }),
              options: [
                { value: 'openai', label: t('editor.protocolOpenai') },
                { value: 'anthropic', label: t('editor.protocolAnthropic') },
              ],
            }))),

        h(Field, { label: t('editor.baseUrl'), hint: t('editor.baseUrlHint') },
          h('div', { style: { minWidth: 260, flex: '1 1 260px' } },
            h(TextInput, { mono: true, value: draft.baseUrl, onChange: (value) => patch({ baseUrl: value }) }))),

        h(Field, {
          label: t('editor.keyless'),
          hint: canKey ? t('editor.keylessHint') : null,
        },
        h(Switch, {
          checked: draft.keyless,
          label: t('editor.keyless'),
          onChange: (next) => patch({ keyless: next, keyMode: next ? 'none' : 'record' }),
        })),

        canKey ? h(Field, {
          label: t('editor.key'),
          hint: provider.keySource === 'inline' ? t('editor.keyInlineHint') : keyState,
        },
        h('div', { style: { minWidth: 240, flex: '1 1 240px' } },
          h(TextInput, {
            mono: true,
            type: 'password',
            autoComplete: 'off',
            value: apiKey,
            placeholder: provider.keyConfigured ? t('editor.keyKeep') : 'sk-…',
            onChange: setApiKey,
          })),
        !isNew && provider.keyConfigured && provider.keyWritable !== false
          ? h(Button, { kind: 'danger', disabled: busy, onClick: clearKey }, t('editor.keyClear'))
          : null) : null,

        h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-section-title' }, t('editor.models')),
          h('div', { className: 'mc-hint' }, t('editor.modelsHint')),
          h('div', { className: 'mc-grid-models' },
            h('div', { className: 'mc-head' }, t('editor.modelId')),
            h('div', { className: 'mc-head' }, t('editor.priceIn')),
            h('div', { className: 'mc-head' }, t('editor.priceOut')),
            h('div')),
          draft.models.map((model, index) => h(ModelRow, {
            key: index,
            model,
            t,
            onChange: (next) => patch({ models: draft.models.map((row, at) => (at === index ? next : row)) }),
            onRemove: () => patch({ models: draft.models.filter((_row, at) => at !== index) }),
          })),
          h('div', { className: 'mc-inline' },
            h(Button, {
              onClick: () => patch({ models: draft.models.concat({ id: '', input: '', output: '' }) }),
            }, t('editor.addModel')),
            h(Button, { disabled: busy, onClick: test }, busy ? t('common.testing') : t('editor.discovered')))),

        discovered !== null ? h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-inline' },
            h('div', { className: 'mc-hint' }, t('providers.models', { n: discovered.length })),
            h(Button, {
              onClick: () => patch({
                models: draft.models.concat(discovered
                  .filter((model) => !alreadyAdded.has(model.id))
                  .map((model) => ({ id: model.id, input: '', output: '' }))),
              }),
            }, t('editor.discoveredAddAll'))),
          h('div', { className: 'mc-scroll' },
            h('table', { className: 'mc-table' },
              h('tbody', null, discovered.map((model) => h('tr', { key: model.id },
                h('td', { className: 'mc-mono' }, model.id),
                h('td', { style: { width: 70, textAlign: 'right' } },
                  alreadyAdded.has(model.id)
                    ? h('span', { className: 'mc-hint' }, t('editor.discoveredAdded'))
                    : h(Button, {
                      onClick: () => patch({
                        models: draft.models.concat({ id: model.id, input: '', output: '' }),
                      }),
                    }, t('editor.discoveredAdd'))))))))) : null,

        h('div', { className: 'mc-stack' },
          h(Button, { onClick: () => setAdvanced(!advanced) }, advanced ? '▾ ' + t('editor.advanced') : '▸ ' + t('editor.advanced')),
          advanced ? h('div', { className: 'mc-stack' },
            h(Field, { label: t('editor.maxTokensParam'), hint: t('editor.maxTokensParamHint') },
              h('div', { style: { minWidth: 220, flex: '1 1 220px' } },
                h(Select, {
                  value: draft.maxTokensParam,
                  onChange: (value) => patch({ maxTokensParam: value }),
                  options: [
                    { value: 'max_tokens', label: 'max_tokens' },
                    { value: 'max_completion_tokens', label: 'max_completion_tokens' },
                    { value: 'none', label: t('editor.maxTokensParamNone') },
                  ],
                }))),
            h(Field, { label: t('editor.extraHeaders'), hint: t('editor.extraHeadersHint') },
              h('div', { style: { minWidth: 260, flex: '1 1 260px' } },
                h('textarea', {
                  className: 'mc-input mc-input-mono mc-textarea',
                  value: draft.extraHeaders,
                  onChange: (event) => patch({ extraHeaders: event.target.value }),
                }))),
            h(Field, { label: t('editor.notes') },
              h('div', { style: { minWidth: 260, flex: '1 1 260px' } },
                h(TextInput, { value: draft.notes, onChange: (value) => patch({ notes: value }) })))) : null),

        h('div', { className: 'mc-inline' },
          h(Button, { kind: 'primary', size: 'md', disabled: busy, onClick: save },
            busy ? t('common.saving') : t('common.save')),
          h(Button, { disabled: busy, onClick: test }, busy ? t('common.testing') : t('common.test')),
          h(Button, { disabled: busy, onClick: onDone }, t('common.cancel'))))
    }

    function ProvidersTab({ state, t, reload, setError }) {
      const [openId, setOpenId] = React.useState(null)
      const [draftNew, setDraftNew] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [confirmId, setConfirmId] = React.useState(null)
      const providers = state.providers ?? []

      async function run(work) {
        setBusy(true)
        try {
          await work()
          await reload()
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }

      async function setEnabled(provider, enabled) {
        await run(() => api('/providers', {
          method: 'POST',
          body: { provider: { ...provider, enabled } },
        }))
      }

      return h('div', { className: 'mc-stack' },
        h('div', { className: 'mc-inline', style: { justifyContent: 'space-between' } },
          h('div', { className: 'mc-hint' }, t('providers.count', { n: providers.length })),
          h(Button, {
            kind: 'primary',
            onClick: () => { setDraftNew(true); setOpenId(null) },
          }, t('providers.add'))),

        providers.length === 0 && !draftNew
          ? h(ProvidersEmpty, { t, onAdd: () => setDraftNew(true) })
          : null,

        draftNew ? h('div', { className: 'mc-card' },
          h('div', { className: 'mc-row' },
            h('div', { className: 'mc-row-main' },
              h('div', { className: 'mc-row-name' }, t('editor.new')))),
          h(ProviderEditor, {
            provider: { __new: true, __presets: state.presets, keyMode: 'record', protocol: 'openai', models: [] },
            t,
            onDone: () => setDraftNew(false),
            onSaved: async () => { setDraftNew(false); await reload() },
          })) : null,

        providers.map((provider) => (confirmId === provider.id
          ? h('div', { key: provider.id, className: 'mc-card' },
            h('div', { className: 'mc-row' },
              h('div', { className: 'mc-row-main' }, t('editor.deleteConfirm')),
              h(Button, { kind: 'danger', disabled: busy, onClick: () => run(async () => {
                await api(`/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' })
                setConfirmId(null)
              }) }, t('editor.deleteYes')),
              h(Button, { onClick: () => setConfirmId(null) }, t('common.cancel'))))
          : h(ProviderCard, {
            key: provider.id,
            provider: { ...provider, __presets: state.presets },
            t,
            busy,
            expanded: openId === provider.id,
            onToggle: (id) => setOpenId(openId === id ? null : id),
            onDelete: (row) => setConfirmId(row.id),
            onToggleEnabled: setEnabled,
            onSaved: async () => { setOpenId(null); await reload() },
          }))))
    }

    // ── general tab ────────────────────────────────────────────────────────

    function GeneralTab({ state, t, reload, setError }) {
      const settings = state.settings ?? {}
      const [draft, setDraft] = React.useState(settings)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)

      React.useEffect(() => {
        setDraft(settings)
        setDirty(false)
      }, [state.settings])

      const patch = (fields) => {
        setDraft((current) => ({ ...current, ...fields }))
        setDirty(true)
        setNotice(null)
      }

      async function save() {
        setBusy(true)
        try {
          await api('/settings', { method: 'PUT', body: { settings: draft } })
          setNotice({ tone: 'ok', text: t('general.saved') })
          setDirty(false)
          await reload()
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }

      const modelOptions = [{ value: '', label: t('general.defaultModelNone') }]
        .concat((state.providers ?? []).flatMap((provider) => provider.models.map((model) => ({
          value: `${provider.id}/${model.id}`,
          label: `${provider.id}/${model.id}${provider.enabled === false ? ` · ${t('providers.disabled')}` : ''}`,
        }))))

      return h('div', { className: 'mc-stack' },
        notice ? h(Banner, { tone: notice.tone }, notice.text) : null,

        h(Field, { label: t('general.defaultModel'), hint: t('general.defaultModelHint') },
          h('div', { style: { minWidth: 240, flex: '1 1 240px' } },
            h(Select, {
              value: draft.defaultModel ?? '',
              onChange: (value) => patch({ defaultModel: value }),
              options: modelOptions,
            }))),

        h(Field, { label: t('general.temperature'), hint: t('general.temperatureHint') },
          h('div', { style: { width: 90 } },
            h(TextInput, {
              value: String(draft.temperature ?? ''),
              inputMode: 'decimal',
              onChange: (value) => patch({ temperature: value === '' ? '' : Number(value) }),
            }))),

        h(Field, { label: t('general.maxTokens'), hint: t('general.maxTokensHint') },
          h('div', { style: { width: 120 } },
            h(TextInput, {
              value: String(draft.maxTokens ?? ''),
              inputMode: 'numeric',
              onChange: (value) => patch({ maxTokens: value === '' ? '' : Number(value) }),
            }))),

        h(Field, { label: t('general.timeout'), hint: t('general.timeoutHint') },
          h('div', { style: { width: 120 } },
            h(TextInput, {
              value: String(Math.round((Number(draft.timeoutMs) || 0) / 1000)),
              inputMode: 'numeric',
              onChange: (value) => patch({ timeoutMs: Math.max(1, Number(value) || 0) * 1000 }),
            }))),

        h(Field, { label: t('general.concurrency'), hint: t('general.concurrencyHint') },
          h('div', { style: { width: 90 } },
            h(TextInput, {
              value: String(draft.concurrency ?? ''),
              inputMode: 'numeric',
              onChange: (value) => patch({ concurrency: value === '' ? '' : Number(value) }),
            }))),

        h(Field, { label: t('general.framing'), hint: t('general.framingHint') },
          h(Switch, {
            checked: draft.includeUsageInPrompt !== false,
            label: t('general.framing'),
            onChange: (next) => patch({ includeUsageInPrompt: next }),
          })),

        h('div', { className: 'mc-inline' },
          h(Button, { kind: 'primary', size: 'md', disabled: busy || !dirty, onClick: save },
            busy ? t('common.saving') : t('common.save'))))
    }

    // ── budget tab ─────────────────────────────────────────────────────────

    /** The approvals waiting for the user, each with its own decision. */
    function Approvals({ approvals, t, reload, setError }) {
      const [busy, setBusy] = React.useState('')
      async function decide(id, decision) {
        setBusy(id)
        try {
          await api(`/approvals/${encodeURIComponent(id)}`, { method: 'POST', body: { decision } })
          await reload()
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy('')
        }
      }
      if (approvals.length === 0) {
        return h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-section-title' }, t('budget.pending')),
          h('div', { className: 'mc-hint' }, t('budget.pendingEmpty')))
      }
      return h('div', { className: 'mc-stack' },
        h('div', { className: 'mc-section-title' }, t('budget.pending')),
        h('div', { className: 'mc-hint' }, t('budget.pendingHint')),
        approvals.map((row) => h('div', { key: row.id, className: 'mc-approval' },
          h('div', { className: 'mc-approval-main' },
            h('div', { className: 'mc-inline' },
              h(Badge, { tone: 'warn' }, t('budget.estimate', { usd: usd(row.usd) })),
              h('span', { className: 'mc-mono' }, `${row.provider}/${row.model}`),
              h('span', { className: 'mc-hint' }, clock(row.createdAt))),
            row.preview ? h('div', { className: 'mc-preview' }, row.preview) : null),
          h(Button, { kind: 'primary', disabled: busy === row.id, onClick: () => decide(row.id, 'approve') }, t('budget.approve')),
          h(Button, { kind: 'danger', disabled: busy === row.id, onClick: () => decide(row.id, 'deny') }, t('budget.deny')))))
    }

    /** The ledger: totals, then the most recent calls. */
    function UsageLedger({ usage, t }) {
      const totals = usage.totals ?? {}
      return h('div', { className: 'mc-stack' },
        h(Stats, {
          items: [
            { label: t('budget.today'), value: usd(usage.todayUsd) },
            { label: t('budget.total'), value: usd(totals.costUsd) },
            { label: t('budget.calls'), value: `${num(totals.calls)}` },
            { label: t('budget.tokens'), value: `${num(totals.promptTokens)}+${num(totals.completionTokens)}` },
          ],
        }),
        (usage.records ?? []).length === 0
          ? h('div', { className: 'mc-hint' }, t('budget.noRecords'))
          : h('div', { className: 'mc-scroll' },
            h('table', { className: 'mc-table' },
              h('thead', null, h('tr', null,
                h('th', null, ''),
                h('th', null, 'model'),
                h('th', null, 'tokens'),
                h('th', null, 'cost'),
                h('th', null, 'ms'))),
              h('tbody', null, (usage.records ?? []).map((record, index) => h('tr', { key: `${record.at}-${index}` },
                h('td', { style: { whiteSpace: 'nowrap' } }, clock(record.at)),
                h('td', { className: 'mc-mono' },
                  `${record.provider}/${record.model}`,
                  record.ok ? null : h('span', { className: 'mc-badge mc-badge-err', style: { marginLeft: 6 } }, t('budget.failed'))),
                h('td', null, `${num(record.promptTokens)}+${num(record.completionTokens)}`),
                h('td', null, `${record.costUsd === null ? t('providers.unpriced') : usd(record.costUsd)}${record.estimated ? ' ≈' : ''}`),
                h('td', null, num(record.ms))))))),
        h('div', { className: 'mc-hint' }, t('budget.estimatedNote')))
    }

    function BudgetTab({ state, t, reload, setError }) {
      const settings = state.settings ?? {}
      const [draft, setDraft] = React.useState(settings)
      const [busy, setBusy] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)
      const [confirmReset, setConfirmReset] = React.useState(false)

      React.useEffect(() => {
        setDraft(settings)
        setDirty(false)
      }, [state.settings])

      const patch = (fields) => {
        setDraft((current) => ({ ...current, ...fields }))
        setDirty(true)
      }

      async function save() {
        setBusy(true)
        try {
          await api('/settings', { method: 'PUT', body: { settings: draft } })
          setDirty(false)
          await reload()
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }

      async function reset() {
        setBusy(true)
        try {
          await api('/usage/reset', { method: 'POST' })
          setConfirmReset(false)
          await reload()
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }

      const unpriced = (state.providers ?? [])
        .filter((provider) => provider.enabled !== false)
        .reduce((count, provider) => count + provider.models.filter((model) => model.inputPer1M === null && model.outputPer1M === null).length, 0)

      return h('div', { className: 'mc-stack' },
        h(Approvals, { approvals: state.approvals ?? [], t, reload, setError }),

        h('div', { className: 'mc-sep' }),

        h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-section-title' }, t('budget.caps')),
          h('div', { className: 'mc-hint' }, t('budget.capsHint')),

          h(Field, { label: t('budget.perCall'), hint: t('budget.perCallHint') },
            h('div', { style: { width: 110 } },
              h(TextInput, {
                value: String(draft.maxCostPerCallUsd ?? ''),
                inputMode: 'decimal',
                onChange: (value) => patch({ maxCostPerCallUsd: value === '' ? '' : Number(value) }),
              }))),

          h(Field, { label: t('budget.perDay'), hint: t('budget.perDayHint') },
            h('div', { style: { width: 110 } },
              h(TextInput, {
                value: String(draft.maxCostPerDayUsd ?? ''),
                inputMode: 'decimal',
                onChange: (value) => patch({ maxCostPerDayUsd: value === '' ? '' : Number(value) }),
              }))),

          h(Field, { label: t('budget.auto'), hint: t('budget.autoHint') },
            h('div', { style: { width: 110 } },
              h(TextInput, {
                value: String(draft.autoApproveUnderUsd ?? ''),
                inputMode: 'decimal',
                onChange: (value) => patch({ autoApproveUnderUsd: value === '' ? '' : Number(value) }),
              }))),

          unpriced > 0 ? h(Banner, { tone: 'warn' }, t('budget.unpriced', { n: unpriced })) : null,

          h('div', { className: 'mc-inline' },
            h(Button, { kind: 'primary', size: 'md', disabled: busy || !dirty, onClick: save },
              busy ? t('common.saving') : t('common.save')))),

        h('div', { className: 'mc-sep' }),

        h('div', { className: 'mc-stack' },
          h('div', { className: 'mc-inline', style: { justifyContent: 'space-between' } },
            h('div', { className: 'mc-section-title' }, t('budget.usage')),
            confirmReset
              ? h('div', { className: 'mc-inline' },
                h('span', { className: 'mc-hint' }, t('budget.resetConfirm')),
                h(Button, { kind: 'danger', disabled: busy, onClick: reset }, t('budget.resetYes')),
                h(Button, { onClick: () => setConfirmReset(false) }, t('common.cancel')))
              : h(Button, { onClick: () => setConfirmReset(true) }, t('budget.reset'))),
          h(UsageLedger, { usage: state.usage ?? {}, t })))
    }

    // ── root ───────────────────────────────────────────────────────────────

    /**
     * The page shell.
     *
     * `__state` seeds the store so `test/client-render.mjs` can mount the loaded
     * page; without it the panel starts empty and asks the host for state.
     */
    function Root(props) {
      const t = props.t ?? ((key) => key)
      const seeded = props.__state ?? null
      const [tab, setTab] = React.useState('providers')
      const [state, setState] = React.useState(seeded)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(seeded === null)

      const reload = React.useCallback(async () => {
        try {
          const next = await api('/state')
          setState(next)
          setError('')
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        if (props.__state === undefined) reload()
      }, [reload])

      const tabs = [
        { id: 'providers', label: t('tab.providers') },
        { id: 'general', label: t('tab.general') },
        { id: 'budget', label: t('tab.budget') },
      ]

      return h('div', { className: 'mc-root' },
        h('div', { className: 'mc-head' },
          h('div', { className: 'mc-title' }, t('title')),
          h('div', { className: 'mc-sub' }, t('subtitle'))),

        error !== ''
          ? h(Banner, { tone: 'err', action: h(Button, { onClick: reload }, t('common.retry')) },
            h('div', null, h('strong', null, t('state.unreachable'))),
            h('div', { className: 'mc-hint' }, error),
            h('div', { className: 'mc-hint' }, t('state.unreachableHint')))
          : null,

        loading && state === null
          ? h('div', { className: 'mc-hint' }, t('state.loading'))
          : null,

        state === null ? null : h(React.Fragment, null,
          h('div', { className: 'mc-tabs', role: 'tablist' }, tabs.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === entry.id ? 'true' : 'false',
            className: 'mc-tab',
            onClick: () => setTab(entry.id),
          }, entry.label))),

          tab === 'providers'
            ? h(ProvidersTab, { state, t, reload, setError })
            : tab === 'general'
              ? h(GeneralTab, { state, t, reload, setError })
              : h(BudgetTab, { state, t, reload, setError })))
    }

    // ── entry ──────────────────────────────────────────────────────────────

    /**
     * Register the settings page.
     *
     * Both waits are declarative, not polling: the slot registry service must
     * exist before it can be asked for a slot, and `settings.section` must be
     * *declared* by the settings shell before an entry may be added to it.
     * Registering eagerly throws, and a throwing client `apply` fails the whole
     * GUI boot — so every step here is also guarded.
     */
    function apply(ctx) {
      let t = (key, params) => {
        const template = MESSAGES.zh[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (_match, name) => (params[name] === undefined ? '' : String(params[name])))
      }

      try {
        const locale = ctx.get('locale')
        if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, MESSAGES), `${NS}: dictionaries`)
          const bound = locale.bind(NS)
          t = (key, params) => {
            const text = bound(key, params)
            // `bind` returns the key itself when a string is missing, and a raw
            // key in the UI is worse than the fallback dictionary's copy.
            return text === key ? (MESSAGES.zh[key] ?? key) : text
          }
        }
      } catch (error) {
        console.warn(`[${NS}] 语言包注册失败，改用内置文案`, error)
      }

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', NS)
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => {
          if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
        }
      }, `${NS}: styles`)

      const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) ?? ctx.slots
      if (slots === undefined || slots === null || typeof slots.inject !== 'function') {
        console.warn(`[${NS}] slots 服务不可用，设置面板未注册`)
        return
      }

      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        // The Host's own rows end at 40, so this lands after them.
        order: 60,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, (props) => h(Root, props)))
    }

    // The loader reads only `name`, `inject` and `apply`. `__test` is a seam for
    // `test/client-render.mjs`, which mounts every screen with real React so the
    // panel's markup is checked without a browser.
    module.exports = {
      name: NS,
      inject: ['slots'],
      apply,
      __test: { Root, ProvidersTab, GeneralTab, BudgetTab, ProviderEditor, MESSAGES, PREFIX, usd, clock, parsePrice },
    }
    return module.exports
  },
})
