/**
 * Self-test for the host half: no DSH, no network, no real key.
 *
 * It stands up a mock OpenAI-compatible endpoint, points a provider at it, and
 * drives the four agent tools plus the panel's HTTP surface through the same
 * store and adapters the product uses. Run it with:
 *
 *   node test/self-test.mjs
 *
 * The point is to catch the failures that only show up once everything is
 * wired together — a schema the Host would reject, a budget rule that blocks
 * when it should not, a route that answers the wrong verb — without needing a
 * rebuilt desktop bundle for each iteration.
 */
import { createServer, request as httpRequest } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../host/store.js'
import { buildTools } from '../host/tools.js'
import { createHandler } from '../host/routes.js'
import { registerSkills } from '../host/skills.js'

let failures = 0
let checks = 0

/** Assert one condition, printing a compact result line. */
function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`)
    return
  }
  failures += 1
  process.stdout.write(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}\n`)
}

/** The mock vendor: two models, one of which answers with reasoning content. */
function mockVendor() {
  const seenAuth = []
  const server = createServer((req, res) => {
    // Every request's credentials, so a test can prove the key actually left
    // the host rather than merely being stored.
    seenAuth.push(req.headers.authorization ?? '')
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      send(200, { data: [{ id: 'mock-small' }, { id: 'mock-large' }] })
      return
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const body = JSON.parse(raw)
        if (body.model === 'mock-fail') {
          send(400, { error: { message: 'no such model' } })
          return
        }
        send(200, {
          model: body.model,
          choices: [{
            finish_reason: 'stop',
            message: {
              content: `echo:${body.messages.at(-1).content.slice(0, 24)}`,
              reasoning_content: body.model === 'mock-large' ? 'thought about it' : '',
            },
          }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        })
      })
      return
    }
    send(404, { error: 'not found' })
  })
  server.seenAuth = seenAuth
  return server
}

/** A host context stand-in: one home directory, a silent logger, a service map. */
function fakeContext(home) {
  const services = new Map([
    ['dshHomePath', (...segments) => join(home, ...segments)],
  ])
  return {
    home,
    services,
    logger: { warn: (message) => process.stdout.write(`  warn ${message}\n`) },
    get: (service) => services.get(service),
  }
}

/**
 * The credential store's document contract, mirrored from the real provider.
 *
 * `@deepseek-ai/dsh-credentials-local/lib/index.js` admits two record tags and
 * refuses any field the tag does not define (`parseRecord` -> `assertFields`).
 * It enforces that only when reading the document back: `modifyRecord` merely
 * calls `assertStorableApiKey`, which checks the key and env values and nothing
 * else. So a record with an invented field is written happily and then fails the
 * *required* `credentials` plugin at the next boot, and the whole host refuses
 * to start. Mirroring the parser here is what turns that outage into a red test.
 */
const RECORD_FIELDS = { 'api-key': ['kind', 'key', 'env'], grant: ['kind', 'payload'] }

function recordProblem(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return 'must be a mapping'
  if (record.kind === undefined) return 'has no kind'
  const allowed = RECORD_FIELDS[record.kind]
  if (allowed === undefined) return `has unknown kind ${JSON.stringify(record.kind)}`
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) return `has unknown field "${field}"`
  }
  if (record.kind === 'api-key' && record.key !== undefined) {
    if (typeof record.key !== 'string' || record.key === '') return 'has a non-string or empty key'
  }
  if (record.kind === 'grant' && !('payload' in record)) return 'has no payload'
  return null
}

/** An in-memory stand-in for the credential service, contract included. */
function credentialStore() {
  const records = new Map()
  return {
    records,
    /** The stored record as written, for shape assertions. */
    raw: (key) => records.get(key),
    /** The parser's verdict on every stored record: an emulated next boot. */
    reparse: () => {
      for (const [key, record] of records) {
        const problem = recordProblem(record)
        if (problem !== null) return `record "${key}" ${problem}`
      }
      return null
    },
    admits: recordProblem,
    readRecord: async (key) => records.get(key),
    describeRecord: async (key) => (records.has(key)
      ? { configured: true, kind: records.get(key).kind, writable: true }
      : { configured: false, writable: true }),
    listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      if (next === undefined) return records.get(key)
      const problem = recordProblem(next)
      if (problem !== null) throw new Error(`credentials-local: record "${key}" ${problem}`)
      records.set(key, next)
      return next
    },
    deleteRecord: async (key) => { records.delete(key) },
  }
}

const home = mkdtempSync(join(tmpdir(), 'model-cognition-test-'))
const vendor = mockVendor()
await new Promise((resolve) => vendor.listen(0, '127.0.0.1', resolve))
const vendorUrl = `http://127.0.0.1:${vendor.address().port}/v1`

const ctx = fakeContext(home)
const credentials = credentialStore()
ctx.services.set('credentials', credentials)
const store = new Store(ctx, {})

try {
  process.stdout.write('\nstore\n')
  store.putProvider({
    id: 'mock',
    label: 'Mock 供应商',
    protocol: 'openai',
    baseUrl: vendorUrl,
    keyless: true,
    keyMode: 'none',
    models: [
      { id: 'mock-small', inputPer1M: 1, outputPer1M: 2 },
      { id: 'mock-large', inputPer1M: 10, outputPer1M: 20 },
      { id: 'mock-fail', inputPer1M: 1, outputPer1M: 1 },
    ],
  })
  check('provider persisted', store.provider('mock') !== undefined)
  check('store file written', readFileSync(store.path, 'utf8').includes('mock'))

  const tools = Object.fromEntries(buildTools(ctx, store).map((tool) => [tool.name, tool]))

  process.stdout.write('\ntool surface\n')
  for (const [toolName, tool] of Object.entries(tools)) {
    check(`${toolName} has a name and description`, tool.name === toolName && tool.description.length > 10)
    check(`${toolName} renders text`, Array.isArray(tool.output.render({}, {})))
    check(`${toolName} declares a schema`, typeof tool.output.schema === 'object')
  }
  // A tool registered as a plain object must carry JSON Schema itself: the
  // registry only converts `parameters` when the definition came from
  // `defineTool`. An empty object schema or a per-property `required` flag
  // would leave the model with no usable arguments.
  for (const [toolName, tool] of Object.entries(tools)) {
    check(`${toolName} parameters are an object schema`, tool.parameters.type === 'object')
    check(`${toolName} parameters declare properties`, typeof tool.parameters.properties === 'object'
      && tool.parameters.properties !== null)
    check(`${toolName} parameters forbid unknown arguments`, tool.parameters.additionalProperties === false)
    check(`${toolName} parameters keep required-ness on the parent`,
      Object.values(tool.parameters.properties)
        .every((property) => !Object.hasOwn(property, 'required')))
    check(`${toolName} required names exist as properties`,
      (tool.parameters.required ?? []).every((name) => Object.hasOwn(tool.parameters.properties, name)))
    check(`${toolName} output schema is an object schema`, tool.output.schema.type === 'object')
    check(`${toolName} declares a positive timeout`, Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0)
    // The runtime calls this as a function; a bare boolean would throw inside
    // its try/catch and silently degrade to exclusive scheduling.
    check(`${toolName} answers isConcurrencySafe with a boolean`,
      typeof tool.isConcurrencySafe === 'function'
      && typeof tool.isConcurrencySafe({}) === 'boolean')
  }
  check('model_ask requires a prompt but not a model',
    tools.model_ask.parameters.required.includes('prompt')
    && !tools.model_ask.parameters.required.includes('model'))
  check('model_ask accepts an approvalId',
    tools.model_ask.parameters.properties.approvalId.type === 'string')
  check('model_panel requires both models and prompt',
    tools.model_panel.parameters.required.includes('models')
    && tools.model_panel.parameters.required.includes('prompt'))
  check('model_panel models is an array of strings',
    tools.model_panel.parameters.properties.models.type === 'array'
    && tools.model_panel.parameters.properties.models.items.type === 'string')
  check('model_list takes no arguments',
    Object.keys(tools.model_list.parameters.properties).length === 0
    && tools.model_list.parameters.required === undefined)
  check('model_usage takes limit and onlyFailures',
    tools.model_usage.parameters.properties.limit.type === 'number'
    && tools.model_usage.parameters.properties.onlyFailures.type === 'boolean')
  check('the read-only tools may run in parallel',
    tools.model_list.isConcurrencySafe({}) === true
    && tools.model_usage.isConcurrencySafe({}) === true)
  check('the spending tools are serialized',
    tools.model_ask.isConcurrencySafe({}) === false
    && tools.model_panel.isConcurrencySafe({}) === false)

  process.stdout.write('\nmodel_list\n')
  const listed = await tools.model_list.execute({}, {})
  check('lists every configured model', listed.models.join(',') === 'mock/mock-small,mock/mock-large,mock/mock-fail')
  check('reports the credential state', listed.providers[0].keyConfigured === true)

  process.stdout.write('\nmodel_ask\n')
  const asked = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '你好，世界' }, {})
  check('returns ok', asked.status === 'ok', JSON.stringify(asked).slice(0, 200))
  check('returns the vendor text', asked.text.startsWith('echo:'), asked.text)
  check('books the vendor usage', asked.usage.promptTokens === 12 && asked.usage.completionTokens === 7)
  check('prices the call', Math.abs(asked.costUsd - ((12 / 1e6) * 1 + (7 / 1e6) * 2)) < 1e-9, String(asked.costUsd))
  check('renders a human line', tools.model_ask.output.render({}, asked)[0].text.includes('echo:'))

  const bare = await tools.model_ask.execute({ model: 'mock-small', prompt: '裸 id' }, {})
  check('resolves a bare model id', bare.status === 'ok' && bare.model === 'mock-small')

  const missing = await tools.model_ask.execute({ model: 'nope/model', prompt: 'x' }, {})
    .then(() => undefined, (error) => error)
  check('rejects an unknown provider', missing instanceof Error && missing.code === 'config', String(missing))

  const failed = await tools.model_ask.execute({ model: 'mock/mock-fail', prompt: 'x' }, {})
    .then(() => undefined, (error) => error)
  check('surfaces a vendor error', failed instanceof Error && failed.status === 400, String(failed))
  check('records the failure', store.doc.usage.totals.failed >= 1)

  process.stdout.write('\nbudget approval\n')
  store.updateSettings({ autoApproveUnderUsd: 0 })
  const pending = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '需要批准' }, {})
  check('holds the call', pending.status === 'pending_approval', JSON.stringify(pending).slice(0, 200))
  check('records a pending approval', store.pendingApprovals().length === 1)
  check('retry without approval stays held',
    (await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '需要批准' }, {})).status === 'pending_approval')
  check('retry with a stale id stays held',
    (await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '需要批准', approvalId: 'ap-nope' }, {})).status === 'pending_approval')

  const approvalId = pending.approvalId
  store.decideApproval(approvalId, 'approved')
  const approved = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '需要批准', approvalId }, {})
  check('runs once approved', approved.status === 'ok', JSON.stringify(approved).slice(0, 200))
  check('burns the grant', store.approval(approvalId).consumedAt !== '')
  check('a used grant cannot pay twice',
    (await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '需要批准', approvalId }, {})).status === 'pending_approval')

  const denied = store.addApproval({
    id: 'ap-denied', provider: 'mock', model: 'mock-small', usd: 1, digest: 'x', preview: 'y',
  })
  store.decideApproval(denied.id, 'denied')
  const planOnly = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '别的', approvalId: 'ap-denied' }, {})
  check('a denied grant does not authorize anything', planOnly.status === 'pending_approval')

  store.updateSettings({ autoApproveUnderUsd: 0.05, maxCostPerCallUsd: 0.000001 })
  const blocked = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '太贵' }, {})
  check('refuses above the per-call cap', blocked.status === 'blocked', JSON.stringify(blocked).slice(0, 200))
  store.updateSettings({ maxCostPerCallUsd: 0.5, maxCostPerDayUsd: 0.000001 })
  const dayBlocked = await tools.model_ask.execute({ model: 'mock/mock-small', prompt: '太贵' }, {})
  check('refuses above the daily cap', dayBlocked.status === 'blocked')
  store.updateSettings({ maxCostPerCallUsd: 0.5, maxCostPerDayUsd: 5 })

  process.stdout.write('\nunpriced models\n')
  store.putProvider({ id: 'free', label: 'Free', protocol: 'openai', baseUrl: vendorUrl, keyless: true, keyMode: 'none', models: [{ id: 'free-model' }] })
  const unpriced = await tools.model_ask.execute({ model: 'free/free-model', prompt: 'hi' }, {})
  check('an unpriced model still runs', unpriced.status === 'ok', JSON.stringify(unpriced).slice(0, 200))
  check('an unpriced call reports no cost', unpriced.costUsd === null)

  process.stdout.write('\nmodel_panel\n')
  const panel = await tools.model_panel.execute({ models: ['mock/mock-small', 'mock/mock-large', 'nope/x'], prompt: '比较一下' }, {})
  check('runs every usable model', panel.results.length === 2, JSON.stringify(panel.results.map((row) => row.model)))
  check('skips the unusable reference', panel.skipped.length === 1 && panel.skipped[0].model === 'nope/x')
  check('totals the cost', panel.totalCostUsd > 0)
  const partial = await tools.model_panel.execute({ models: ['mock/mock-small', 'mock/mock-fail'], prompt: '一个会失败' }, {})
  check('one failure does not stop the others',
    partial.results.some((row) => row.status === 'ok') && partial.results.some((row) => row.status === 'error'),
    JSON.stringify(partial.results.map((row) => row.status)))

  process.stdout.write('\nmodel_usage\n')
  const usage = await tools.model_usage.execute({ limit: 5 }, {})
  check('reports totals', usage.totals.calls > 0)
  check('reports today', usage.todayUsd >= 0)
  // The approval checks above deliberately left pending rows behind: a held
  // call that is never approved stays visible until the user decides.
  check('reports the pending approvals', usage.pendingApprovals.length > 0)
  check('a decided row is no longer pending',
    usage.pendingApprovals.every((row) => row.id !== 'ap-denied'))

  process.stdout.write('\nskills\n')
  let capturedProvider
  registerSkills(ctx, { skills: { registerProvider: (factory) => { capturedProvider = factory(); return () => {} } } }, store)
  check('registers a provider', typeof capturedProvider?.list === 'function')
  const candidates = await capturedProvider.list()
  check('finds every shipped skill', candidates.length >= 4, candidates.map((row) => row.name).join(','))
  for (const candidate of candidates) {
    check(`${candidate.name} has a kebab-case name`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name))
    check(`${candidate.name} has a description`, typeof candidate.description === 'string' && candidate.description.length > 10)
    check(`${candidate.name} has a numeric rank`, Number.isFinite(candidate.rank))
    const loaded = await capturedProvider.get(candidate)
    check(`${candidate.name} loads its body`, loaded.content.includes('---') && loaded.name === candidate.name)
    check(`${candidate.name} is model-invocable`, loaded.invocation.modelInvocable === true)
  }
  const missingSkill = candidates.find((candidate) => candidate.name === 'model-cognition')
  check('ships the router skill', missingSkill !== undefined)

  process.stdout.write('\nhttp surface\n')
  const handler = createHandler(ctx, store)
  const panelServer = createServer((req, res) => { handler(req, res).catch(() => { res.statusCode = 500; res.end() }) })
  await new Promise((resolve) => panelServer.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${panelServer.address().port}/model-cognition`
  const get = async (path, init) => {
    const response = await fetch(`${base}${path}`, { headers: { host: `127.0.0.1:${panelServer.address().port}` }, ...init })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  // Node's fetch refuses to send a forged `host`/`origin`, so the fence checks
  // below go through the raw client instead.
  const rawRequest = (port, path, headers) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode }))
    })
    req.on('error', reject)
    req.end()
  })

  const state = await get('/state')
  check('GET /state answers', state.status === 200 && Array.isArray(state.body.providers))
  check('GET /state never leaks a key', !JSON.stringify(state.body).includes('apiKey'))
  check('GET /state carries the presets', state.body.presets.length >= 10)

  const saved = await get('/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: { label: '新供应商', protocol: 'openai', baseUrl: vendorUrl, keyless: true, models: [{ id: 'm' }] } }),
  })
  check('POST /providers derives an id', saved.status === 200 && saved.body.provider.id.length > 0, JSON.stringify(saved.body))

  const badId = await get('/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: { id: 'Bad Id', label: 'x', baseUrl: vendorUrl } }),
  })
  check('POST /providers rejects a bad id', badId.status === 400)

  const tested = await get('/providers/mock/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('POST /providers/:id/test lists vendor models', tested.body.ok === true && tested.body.models.length === 2, JSON.stringify(tested.body))

  // A key must survive the round trip *and* the shape it is written in must be
  // one the credential loader will still parse at the next boot.
  const keyed = await get('/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: { id: 'keyed', label: '带密钥', protocol: 'openai', baseUrl: vendorUrl, keyMode: 'record', models: [{ id: 'mock-large', inputPer1M: 1, outputPer1M: 2 }] },
      apiKey: 'sk-test-key',
    }),
  })
  check('POST /providers stores a provider that owns a key', keyed.status === 200, JSON.stringify(keyed.body))
  const record = credentials.raw('dsh-model-cognition/keyed')
  check('the key lands in the credential store under the plugin namespace', record !== undefined, JSON.stringify(record))
  check('the record uses the api-key tag', record?.kind === 'api-key', JSON.stringify(record))
  check('the secret is the record\'s key field', record?.key === 'sk-test-key', JSON.stringify(record))
  check('no record would be rejected at the next boot', credentials.reparse() === null, String(credentials.reparse()))
  check('the guard would catch a payload-shaped record',
    credentials.admits({ kind: 'api-key', payload: { value: 'x' } }) === 'has unknown field "payload"',
    String(credentials.admits({ kind: 'api-key', payload: { value: 'x' } })))
  check('the panel reports the key as configured',
    (await get('/state')).body.providers.find((row) => row.id === 'keyed')?.keyConfigured === true)

  vendor.seenAuth.length = 0
  const keyedTest = await fetch(`${base}/test`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${panelServer.address().port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: { id: 'keyed', protocol: 'openai', baseUrl: vendorUrl, keyMode: 'record' } }),
  })
  const keyedBody = await keyedTest.json()
  check('a stored key is read back for a call', vendor.seenAuth.includes('Bearer sk-test-key'), JSON.stringify(vendor.seenAuth))
  check('reading the key back does not leak it', !JSON.stringify(keyedBody).includes('sk-test-key'))

  const cleared = await fetch(`${base}/providers/keyed/key`, {
    method: 'PUT',
    headers: { host: `127.0.0.1:${panelServer.address().port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: '' }),
  })
  check('PUT /providers/:id/key clears the record', cleared.status === 200 && credentials.raw('dsh-model-cognition/keyed') === undefined)

  const settingsSaved = await get('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { temperature: 0.25 } }),
  })
  check('PUT /settings persists', settingsSaved.body.settings.temperature === 0.25)
  check('PUT /settings keeps other keys', settingsSaved.body.settings.timeoutMs === 120000)

  const removed = await get('/providers/free', { method: 'DELETE' })
  check('DELETE /providers/:id removes', removed.status === 200 && store.provider('free') === undefined)
  check('unknown route 404s', (await get('/nope')).status === 404)

  const refused = await rawRequest(panelServer.address().port, '/model-cognition/state', { host: 'evil.example.com' })
  check('a foreign Host is refused', refused.status === 401 || refused.status === 403, String(refused.status))
  const crossSite = await rawRequest(panelServer.address().port, '/model-cognition/state', {
    'sec-fetch-site': 'cross-site',
  })
  check('a cross-site request is refused', crossSite.status === 403, String(crossSite.status))
  const foreignOrigin = await rawRequest(panelServer.address().port, '/model-cognition/state', {
    origin: 'http://evil.example.com',
  })
  check('a foreign Origin is refused', foreignOrigin.status === 403, String(foreignOrigin.status))
  const loopback = await rawRequest(panelServer.address().port, '/model-cognition/state', {})
  check('a plain loopback request passes', loopback.status === 200, String(loopback.status))

  const wrongVerb = await fetch(`${base}/settings`, { method: 'DELETE', headers: { host: `127.0.0.1:${panelServer.address().port}` } })
  check('a wrong verb is 405', wrongVerb.status === 405, String(wrongVerb.status))

  // The panel tests a row before it is saved, so this route must accept a draft
  // that is not in the store at all.
  const post = (path, payload) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${panelServer.address().port}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const draft = await post('/test', {
    provider: { id: 'draft', label: '草稿', protocol: 'openai', baseUrl: vendorUrl, keyMode: 'inline', apiKey: 'sk-draft' },
  })
  check('POST /test accepts an unsaved row', draft.status === 200, String(draft.status))
  const draftBody = await draft.json()
  check('POST /test reaches the vendor', draftBody.ok === true && draftBody.count >= 2, JSON.stringify(draftBody))
  check('POST /test lists the models', draftBody.models.some((m) => m.id === 'mock-large'), JSON.stringify(draftBody.models))
  check('POST /test never echoes the key', !JSON.stringify(draftBody).includes('sk-draft'))

  const unreachable = await post('/test', {
    provider: { id: 'draft', label: '草稿', protocol: 'openai', baseUrl: 'http://127.0.0.1:9/v1', keyMode: 'inline', apiKey: 'sk-x' },
  })
  const unreachableBody = await unreachable.json()
  check('POST /test reports a dead endpoint as a result, not a throw',
    unreachable.status === 200 && unreachableBody.ok === false && typeof unreachableBody.error === 'string',
    JSON.stringify(unreachableBody))

  const badDraft = await post('/test', { provider: { id: 'draft', protocol: 'telepathy', baseUrl: vendorUrl } })
  check('POST /test refuses an unknown protocol', badDraft.status === 400, String(badDraft.status))

  const exported = await get('/export')
  check('GET /export answers', exported.status === 200, String(exported.status))
  check('GET /export carries the providers', Array.isArray(exported.body.providers) && exported.body.providers.length > 0)
  check('GET /export leaves every secret behind', !JSON.stringify(exported.body).includes('sk-'))

  panelServer.close()

  // The store file is shared by every Harness process on the machine (the
  // desktop app and a `dsh web` session can both be open), and each process
  // holds a whole copy of the document. Writing that copy back without looking
  // first is how one window silently deletes another window's providers.
  process.stdout.write('\nstore: concurrent writers\n')
  const shared = new Store(ctx, {})
  shared.putProvider({ id: 'first', label: 'First', protocol: 'openai', baseUrl: vendorUrl })
  // A second process opens the same file, adds its own row, and writes.
  const other = new Store(ctx, {})
  check('a second process sees the first one\'s rows', other.provider('first') !== undefined)
  other.putProvider({ id: 'second', label: 'Second', protocol: 'openai', baseUrl: vendorUrl })
  // The first process now writes: it must not drop the other one's row.
  shared.updateSettings({ temperature: 0.3 })
  const reread = new Store(ctx, {})
  check('a write by one process keeps the other\'s rows',
    reread.provider('first') !== undefined && reread.provider('second') !== undefined,
    reread.providers.map((entry) => entry.id).join(','))
  check('the settings write landed', reread.settings.temperature === 0.3, String(reread.settings.temperature))
  check('a read notices an outside write',
    shared.provider('second') !== undefined)
  shared.destroy()

  process.stdout.write('\nstore: an unreadable document is not an absent one\n')
  const blockedHome = mkdtempSync(join(tmpdir(), 'model-cognition-blocked-'))
  const blockedPath = join(blockedHome, 'data', 'dsh-model-cognition', 'store.json')
  mkdirSync(blockedPath, { recursive: true })
  let refusal = null
  try {
    new Store(fakeContext(blockedHome), {})
  } catch (error) {
    refusal = error
  }
  check('an unreadable store refuses to start', refusal !== null)
  check('the refusal names the path', refusal?.message.includes('store.json') === true)
  check('the refusal explains why', refusal?.message.includes('overwritten') === true)
  check('the unreadable path was left alone',
    statSync(blockedPath, { throwIfNoEntry: false })?.isDirectory() === true)
  rmSync(blockedHome, { recursive: true, force: true })

  process.stdout.write('\nstore: a corrupt document is kept\n')
  const corruptHome = mkdtempSync(join(tmpdir(), 'model-cognition-corrupt-'))
  const corruptPath = join(corruptHome, 'data', 'dsh-model-cognition', 'store.json')
  mkdirSync(join(corruptHome, 'data', 'dsh-model-cognition'), { recursive: true })
  writeFileSync(corruptPath, '{ this is not json', 'utf8')
  const recovered = new Store(fakeContext(corruptHome), { temperature: 0.9 })
  const quarantined = readdirSync(join(corruptHome, 'data', 'dsh-model-cognition'))
    .filter((name) => name.includes('.corrupt-'))
  check('a corrupt document still yields a usable store', recovered.settings.temperature === 0.9)
  check('the corrupt bytes are moved aside, not deleted',
    quarantined.length === 1
    && readFileSync(join(corruptHome, 'data', 'dsh-model-cognition', quarantined[0]), 'utf8') === '{ this is not json')
  recovered.destroy()
  rmSync(corruptHome, { recursive: true, force: true })
} finally {
  vendor.close()
  rmSync(home, { recursive: true, force: true })
}

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
